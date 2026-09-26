// The hold registry and the `mpdWatchdog` reader — the w7 contract (A2-1, option (b)).
//
// A sidecar alone cannot enforce the pause: `state.js` owns `team.json` and every
// reader goes through `readTeam`, so the scheduler's decline gates are blind to a
// sidecar. This package therefore keeps the sidecar as the DURABLE, authoritative
// record and publishes a stable SYNCHRONOUS reader:
//
//     ctx.get("mpdWatchdog", false)?.isHeld(teamId, workspace)?.held === true
//
// These tests pin the reader's shape, its hydration at apply, the file fallback that
// lets a second process learn of a hold, the fail-open rule, and the non-throwing
// guarantee a gate depends on.
import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { HOLD_GATE_CALL, HOLD_SERVICE, HoldRegistry } from "../src/holds"
import { apply } from "../src/index"
import { HOLD_TOOL, RESUME_TOOL, applyHold, applyResume } from "../src/actions"
import { readHold } from "../src/sidecars"
import { readHeartbeats } from "../src/store"
import { agent, pluginCtx, sandbox, stubAdapter, testConfig, writeTeam, openOutstandingChannel } from "./support"

function stubCtx(): { on: (event: string, handler: (...args: any[]) => unknown) => () => void } {
  return { on: () => () => {} }
}

/** Write a hold file the way ANOTHER process would (no registry involved). */
function foreignHold(box: { workspace: string; stateDir: string }, teamId: string, id: string): string {
  const dir = join(box.workspace, box.stateDir, "watchdog", "hold")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, teamId + ".json")
  writeFileSync(
    path,
    JSON.stringify({ id, teamId, since: 111, cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: 111 }, null, 2) + "\n",
  )
  return path
}

describe("the mpdWatchdog reader (A2-1 option (b))", () => {
  test("an unknown team is not held, and a recorded hold makes it held", () => {
    const box = sandbox()
    try {
      const registry = new HoldRegistry(box.stateDir, box.workspace)
      expect(registry.isHeld("team-a", box.workspace)).toMatchObject({ held: false, holdId: null, source: "none" })
      registry.record(box.workspace, { id: "h1", teamId: "team-a", since: 5, cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: 5 })
      const view = registry.isHeld("team-a", box.workspace)
      expect(view.held).toBe(true)
      expect(view.holdId).toBe("h1")
      expect(view.at).toBe(5)
      expect(view.reason).toBe("silence")
      expect(view.source).toBe("memory")
      expect(registry.holds("team-a", box.workspace)).toBe(true)
      expect(registry.isHeld("other-team", box.workspace).held).toBe(false)
      // A team id is only unique inside its workspace.
      expect(registry.isHeld("team-a", join(box.workspace, "elsewhere")).held).toBe(false)
    } finally {
      box.cleanup()
    }
  })

  test("the file fallback answers for a hold ANOTHER process wrote (the cross-process caveat)", () => {
    const box = sandbox()
    try {
      const registry = new HoldRegistry(box.stateDir, box.workspace)
      registry.hydrate([box.workspace])
      expect(registry.isHeld("team-b", box.workspace).held).toBe(false)
      foreignHold(box, "team-b", "h-foreign")
      const view = registry.isHeld("team-b", box.workspace)
      expect(view.held).toBe(true)
      expect(view.holdId).toBe("h-foreign")
      expect(view.source).toBe("file")
      // Cached: the second call is answered from memory and costs no file read.
      expect(registry.isHeld("team-b", box.workspace).source).toBe("memory")
    } finally {
      box.cleanup()
    }
  })

  test("hydrate at apply loads the holds that already exist on disk", () => {
    const box = sandbox()
    try {
      foreignHold(box, "team-a", "h-existing")
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.applied).toBe(true)
      expect(report.holdService).toBe(HOLD_SERVICE)
      expect(report.hydratedHolds).toBe(1)
      const service = ctx.services.get(HOLD_SERVICE) as { isHeld: (t: string, w?: string) => { held: boolean; holdId: string | null } }
      expect(service.isHeld("team-a").held).toBe(true)
      expect(service.isHeld("team-a").holdId).toBe("h-existing")
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("the documented gate call shape returns exactly what a decline gate branches on", async () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      // THE gate expression w7 must use, verbatim.
      const gate = (teamId: string, workspace: string): boolean =>
        (ctx.get("mpdWatchdog", false) as { isHeld: (t: string, w?: string) => { held: boolean } } | undefined)?.isHeld(teamId, workspace)?.held === true
      expect(gate("team-a", box.workspace)).toBe(false)
      // The hold arrives the way the engine raises it: through the plugin's own action.
      await ctx.__stub.adapter.toolRuntime().execute({ name: HOLD_TOOL, arguments: { team_id: "team-a", task_id: "t1" } })
      expect(gate("team-a", box.workspace)).toBe(true)
      // A different workspace's team of the same name is NOT held.
      expect(gate("team-a", join(box.workspace, "nope"))).toBe(false)
      expect(HOLD_GATE_CALL).toContain("mpdWatchdog")
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("FAIL-OPEN: a context without ctx.provide publishes no service, and the gate expression is simply false", () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace) as { provide?: unknown }
      delete ctx.provide
      const report = apply(ctx as never, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.applied).toBe(true)
      expect(report.holdService).toBe(null)
      const watchdog = (ctx as unknown as { get: (id: string, strict?: boolean) => unknown }).get("mpdWatchdog", false)
      expect(watchdog).toBeUndefined()
      expect((watchdog as { isHeld?: unknown } | undefined)?.isHeld).toBeUndefined()
      report.engine?.stop()
      ;(ctx as unknown as { __dispose: () => void }).__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("never throws on a hostile path: the gates call it on every dispatch", () => {
    const box = sandbox()
    try {
      const registry = new HoldRegistry(box.stateDir, box.workspace)
      // The hold directory's PLACE is a regular file: reading it cannot succeed.
      mkdirSync(join(box.workspace, box.stateDir, "watchdog"), { recursive: true })
      writeFileSync(join(box.workspace, box.stateDir, "watchdog", "hold"), "not a directory\n")
      expect(registry.isHeld("team-a", box.workspace)).toMatchObject({ held: false, source: "none" })
      expect(registry.isHeld("", box.workspace).held).toBe(false)
      expect(registry.isHeld("team-a", box.workspace + "/does/not/exist").held).toBe(false)
    } finally {
      box.cleanup()
    }
  })

  test("a mutation through the plugin's own actions keeps the reader in step, both ways", async () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      const service = ctx.services.get(HOLD_SERVICE) as { isHeld: (t: string, w?: string) => { held: boolean } }
      const runtime = ctx.__stub.adapter.toolRuntime()
      await runtime.execute({ name: HOLD_TOOL, arguments: { team_id: "team-a", task_id: "t1", attempt_id: "att-1" } })
      expect(service.isHeld("team-a", box.workspace).held).toBe(true)
      await runtime.execute({ name: RESUME_TOOL, arguments: { team_id: "team-a" } })
      expect(service.isHeld("team-a", box.workspace).held).toBe(false)
      expect(readHold(box.workspace, box.stateDir, "team-a")).toBeUndefined()
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("a direct applyResume with no registry argument still works (the registry is optional)", () => {
    const box = sandbox()
    try {
      applyHold(box.workspace, box.stateDir, { team_id: "team-a" })
      expect(readHold(box.workspace, box.stateDir, "team-a")).toBeDefined()
      expect(applyResume(box.workspace, box.stateDir, { team_id: "team-a" }).resumed).toBe(true)
    } finally {
      box.cleanup()
    }
  })
})

describe("the engine keeps the reader in step with its own hold", () => {
  test("an ESCALATE hold lands in the registry through the plugin's own tool action", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, {
        stateDir: box.stateDir,
        teamCacheMs: 0,
        tickIntervalMs: 3_600_000,
        warnSilenceMs: 90_000,
        // §3: `pause` is no longer the default (`warn-only` is), so the hold path is asked
        // for explicitly — an ESCALATE holds ONLY when the resolved action says `pause`.
        warnStreakToEscalate: 3,
        actionOnEscalate: "pause",
      })
      const engine = report.engine!
      engine.stamp("step", agent("a1", box.workspace))
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      // OUTSTANDING channel: the only state the §3 ladder may escalate (and hold) from.
      openOutstandingChannel(ctx.__stub, "a1", from)
      await engine.tickOnce(from + 90_001)
      await engine.tickOnce(from + 90_002)
      const escalated = await engine.tickOnce(from + 90_003)
      expect(escalated.decisions.map((d) => d.type)).toEqual(["escalate"])
      const service = ctx.services.get(HOLD_SERVICE) as { isHeld: (t: string, w?: string) => { held: boolean; holdId: string | null } }
      expect(service.isHeld("team-a", box.workspace).held).toBe(true)
      expect(service.isHeld("team-a", box.workspace).holdId).toBe(report.engine ? readHold(box.workspace, box.stateDir, "team-a")?.id : null)
      expect(ctx.__stub.toolExecutes).toContain(HOLD_TOOL)
      engine.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("a namespace that registers AFTER apply still tunes the tick (per-tick knob re-read)", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // Apply BEFORE the namespace exists (mpd-config parks its registration on the
      // settings service, so this is the real mount order hazard).
      const ctx = pluginCtx(box.workspace, undefined)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      const engine = report.engine!
      engine.stamp("step", agent("a1", box.workspace))
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      openOutstandingChannel(ctx.__stub, "a1", from)
      expect((await engine.tickOnce(from + 30_000)).decisions).toEqual([])
      // The namespace appears now, with a much lower threshold.
      ctx.__stub.setSettings({ watchdog: { warnSilenceMs: 20_000, tickIntervalMs: 3_600_000 } })
      const warned = await engine.tickOnce(from + 30_001)
      expect(warned.decisions.map((d) => d.type)).toEqual(["warn"])
      expect(engine.getKnobs().warnSilenceMs).toBe(20_000)
      engine.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })
})

// w6b — the front-door reads the `mpdWatchdog` service carries, so a consumer (the TUI) never links
// this package's sidecar writers into its own build. Every member is synchronous and non-throwing
// (it is called on a render path); the acknowledge is the ONLY mutation and it happens HERE.
describe("the mpdWatchdog service's front-door reads (w6b)", () => {
  test("heldTeams lists the live hold index from disk, sorted, and answers [] with no store", () => {
    const box = sandbox()
    try {
      const registry = new HoldRegistry(box.stateDir, box.workspace)
      expect(registry.heldTeams(box.workspace)).toEqual([])
      foreignHold(box, "team-b", "hb")
      foreignHold(box, "team-a", "ha")
      expect(registry.heldTeams(box.workspace)).toEqual(["team-a", "team-b"])
      // A workspace with no store at all answers [] rather than throwing.
      expect(registry.heldTeams(join(box.workspace, "elsewhere"))).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("view / unread / acknowledge drive the durable watermark (byte-level) and never throw", () => {
    const box = sandbox()
    try {
      const registry = new HoldRegistry(box.stateDir, box.workspace)
      foreignHold(box, "team-a", "ha")
      const incidents = join(box.workspace, box.stateDir, "watchdog", "incidents.jsonl")
      mkdirSync(join(box.workspace, box.stateDir, "watchdog"), { recursive: true })
      writeFileSync(
        incidents,
        [
          { id: "i1", teamId: "team-a", kind: "warn", at: 1000, cause: { kind: "silence", ms: 1 }, taskId: null, attemptId: null, scene: null, hold: "not-requested", acknowledgedBy: [] },
          { id: "i2", teamId: "team-a", kind: "escalate", at: 2000, cause: { kind: "silence", ms: 1 }, taskId: null, attemptId: null, scene: null, hold: "applied", acknowledgedBy: [] },
        ]
          .map((record) => JSON.stringify(record))
          .join("\n") + "\n",
      )

      const view = registry.view("mpd-tui", box.workspace)
      expect(view.workspace).toBe(box.workspace)
      expect(view.holds).toEqual(["team-a"])
      expect(view.unread.map((record) => record.at)).toEqual([1000, 2000])
      expect(registry.unread("mpd-tui", box.workspace).map((record) => record.at)).toEqual([1000, 2000])

      // The acknowledge is the package's own write, and it moves only what was asked.
      const acked = registry.acknowledge("mpd-tui", 1000, box.workspace)
      expect(acked.ok).toBe(true)
      expect(acked.watermark).toBe(1000)
      expect(JSON.parse(readFileSync(join(box.workspace, box.stateDir, "watchdog", "read-watermark.json"), "utf8"))).toEqual({ "mpd-tui": 1000 })
      expect(registry.unread("mpd-tui", box.workspace).map((record) => record.at)).toEqual([2000])
      // Another reader is unaffected: the watermark is per reader.
      expect(registry.unread("someone-else", box.workspace).map((record) => record.at)).toEqual([1000, 2000])
      // A second acknowledge never moves the watermark backwards.
      expect(registry.acknowledge("mpd-tui", 500, box.workspace).watermark).toBe(1000)

      // Non-throwing with a workspace that does not exist yet: the reads answer empty, and the
      // acknowledge creates the store rather than throwing (the owner's writeFileAtomic mkdirs).
      const fresh = join(box.workspace, "fresh-ws")
      expect(registry.view("mpd-tui", fresh)).toEqual({ workspace: fresh, holds: [], unread: [] })
      expect(registry.acknowledge("mpd-tui", 1, fresh).ok).toBe(true)
      // A target that cannot be a directory at all is a REPORTED failure, never a throw.
      writeFileSync(join(box.workspace, "blocker"), "not a directory\n")
      const blocked = registry.acknowledge("mpd-tui", 1, join(box.workspace, "blocker", "ws"))
      expect(blocked.ok).toBe(false)
      expect(typeof blocked.error).toBe("string")
    } finally {
      box.cleanup()
    }
  })

  test("the published service carries every front-door member, and holdService is still mpdWatchdog", () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.holdService).toBe(HOLD_SERVICE)
      const service = ctx.services.get(HOLD_SERVICE) as Record<string, unknown>
      for (const member of ["isHeld", "holds", "list", "hydratedRoots", "hydrate", "heldTeams", "unread", "acknowledge", "view", "gateCall"])
        expect(typeof service[member]).toBe(member === "gateCall" ? "string" : "function")
      // The new reads answer through the published service object (not just the class).
      expect((service.view as (r: string, w?: string) => { holds: string[] })(  "mpd-tui", box.workspace).holds).toEqual([])
      expect((service.acknowledge as (r: string, u: number, w?: string) => { ok: boolean })(  "mpd-tui", 1, box.workspace).ok).toBe(true)
      expect(report.engine).not.toBe(null)
      report.engine?.stop()
    } finally {
      box.cleanup()
    }
  })
})
