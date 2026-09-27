// Lane A2 (t13) — the hold LIFECYCLE and the WAITING member: T-16, T-17, T-19, T-20, §7.2/§7.3.
//
// Every assertion here exists because the pre-redesign watchdog got the OPPOSITE of it wrong,
// and each one is anchored to the frozen contract section that demands it:
//
//   T-16 (§6)  a stamp from a PREVIOUS generation of the team can no longer make a task SILENT
//              (so it can no longer earn a WARN or a hold) — while the dispatch precondition
//              stays permissive, which is what keeps the r7 pin green (§0/A3).
//   T-17 (§6)  every hold carries `ttlMs` and releases itself on the TTL or on ACTIVITY, with a
//              durable `hold-auto-released` incident and NOT ONE BYTE of team.json touched.
//   T-19 (§8)  the status view prints ONE pause state and ONE external mechanism
//              (`agent_teams_halt`), with the watchdog's preserving hold named ONLY as that
//              pause's INTERNAL implementation — text and json (wave-2 user ruling, t10).
//   T-20 (§8)  a member whose only open tasks wait on unfinished dependencies is PARKED, not
//              silent — derived from team.json alone; no new member-facing wait tool exists.
//   §7.2/§7.3  per knob: LIVE value, FILE value when it differs, `restartRequired`; ONE warning
//              per process naming both values.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { HOLD_TOOL, STATUS_TOOL, applyHold, applyResume } from "../src/actions"
import { WatchdogEngine, type EngineContext } from "../src/engine"
import { apply } from "../src/index"
import { candidateFor, knobReadings, WATCHDOG_DEFAULTS, WatchdogMachine } from "../src/machine"
import { readIncidents, readHold } from "../src/sidecars"
import { heartbeatPath } from "../src/paths"
import { readHeartbeats, type HeartbeatStamp } from "../src/store"
import { dependencyBlocked } from "../src/team"
import { agent, openOutstandingChannel, pluginCtx, sandbox, stubAdapter, teamViews, testConfig, writeTeam, type Sandbox, type StubAdapter } from "./support"

/** The engine context a direct construction needs. */
function stubCtx(dsh?: { onEvent: (event: string, handler: (...args: any[]) => unknown) => (() => void) | undefined }): EngineContext {
  return { on: () => () => {} } as unknown as EngineContext
}

/** One heartbeat stamp for the fixture team. */
function stamp(at: number, overrides: Partial<HeartbeatStamp> = {}): HeartbeatStamp {
  return {
    kind: "step",
    at,
    member: "Architect",
    memberKey: "Architect",
    teamId: "team-a",
    taskId: "t1",
    attemptId: "",
    turnId: "Architect#1",
    workspace: "/w",
    ...overrides,
  }
}

/** Mount an engine on the stub adapter. */
function mount(box: Sandbox, overrides: Partial<Parameters<typeof testConfig>[0]> = {}) {
  const stub = stubAdapter({ workspace: box.workspace })
  const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir, ...overrides }))
  const disposers = engine.install()
  return { stub, engine, dispose: () => { for (const off of disposers) off() } }
}

const holdFile = (box: Sandbox): string => join(box.workspace, box.stateDir, "watchdog", "hold", "team-a.json")

/**
 * Write one member's heartbeat file by hand.
 *
 * The path comes from the plugin's OWN `heartbeatPath` on purpose: `safeSegment` LOWERCASES the
 * member key, so a hand-built `<…>/Architect.jsonl` sits beside the real file and the candidate
 * would read as `never-started` (measured while writing the t8 driver).
 */
function writeStamps(box: Sandbox, memberKey: string, stamps: HeartbeatStamp[]): void {
  const path = heartbeatPath(box.workspace, box.stateDir, memberKey)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, stamps.map((entry) => JSON.stringify(entry)).join("\n") + "\n")
}

describe("T-16 (§6) — generation scoping: a previous generation can never be SILENT", () => {
  const tasks = [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }]
  const stampSource = (): HeartbeatStamp[] => [stamp(900_000, { attemptId: "" })]

  test("RED-first: a stamp PREDATING the record's createdAt is not this generation's work", () => {
    const candidates = candidateFor({ id: "team-a", tasks, createdAt: 1_000_000 }, stampSource, (assignee) => assignee)
    // Observable (the dispatch disjunction stays permissive, §0/A3) but NOT silent:
    expect(candidates.map((candidate) => candidate.taskId)).toEqual(["t1"])
    expect(candidates[0].everStampedForTask).toBe(false)
    expect(candidates[0].lastSeen).toBeNull()
  })

  test("the same candidate is reported `never-started`, and never escalates", () => {
    const machine = new WatchdogMachine()
    const candidate = candidateFor({ id: "team-a", tasks, createdAt: 1_000_000 }, stampSource, (assignee) => assignee)[0]
    const first = machine.observe([candidate], 9_000_000, WATCHDOG_DEFAULTS)
    expect(first.map((d) => d.type)).toEqual(["never-started"])
    for (const now of [9_100_000, 9_200_000, 9_300_000]) {
      expect(machine.observe([candidate], now, WATCHDOG_DEFAULTS)).toEqual([])
    }
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("a stamp AT OR AFTER createdAt IS this generation: silence still warns and escalates", () => {
    const fresh = candidateFor({ id: "team-a", tasks, createdAt: 1_000_000 }, () => [stamp(1_000_001, { attemptId: "att-1" })], (assignee) => assignee)
    expect(fresh[0].everStampedForTask).toBe(true)
    const machine = new WatchdogMachine()
    const verdicts = Array.from({ length: 3 }, (_, index) =>
      machine.observe([fresh[0]], 1_000_001 + WATCHDOG_DEFAULTS.warnSilenceMs + 1 + index, { ...WATCHDOG_DEFAULTS, warnStreakToEscalate: 3 }).map((d) => d.type),
    )
    expect(verdicts).toEqual([["warn"], ["warn"], ["escalate"]])
  })

  test("an ABSENT createdAt stays permissive (§0/A3 — the r7 convention, pinned)", () => {
    const candidates = candidateFor({ id: "team-a", tasks }, stampSource, (assignee) => assignee)
    expect(candidates[0].everStampedForTask).toBe(true)
    expect(candidates[0].lastSeen).toBe(900_000)
  })

  test("approvedAt counts too: the floor is the NEWER of the two", () => {
    const candidates = candidateFor({ id: "team-a", tasks, createdAt: 100, approvedAt: 1_000_000 }, stampSource, (assignee) => assignee)
    expect(candidates[0].everStampedForTask).toBe(false)
  })

  test("ENGINE: the measured leak shape (a day-old stamp of an EARLIER revision) holds nothing", async () => {
    const box = sandbox()
    try {
      const now = Date.now()
      writeTeam(box, {
        id: "team-a",
        createdAt: now,
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // A previous generation's stamp: written by hand, a day old, and naming revision `0` — the
      // task's CURRENT generation token is `1` (the projected official revision), so the stamp
      // belongs to an earlier generation. 0.1.7 REPLACED the retired record's createdAt/approvedAt
      // floor with this token: the official board carries no record timestamps at all, so a stamp
      // that carries NO attempt information can no longer be dated and is kept (permissive, §0/A3)
      // — the revision is what scopes a stamp to a generation now.
      writeStamps(box, "Architect", [stamp(now - 86_400_000, { attemptId: "0" })])
      const { engine, dispose } = mount(box)
      try {
        // `never-started` is a REPORT, not an action: it is written to the incident log (and
        // counted) rather than returned in `TickResult.decisions`, and it is reported ONCE per
        // task+attempt generation. No tick warns, escalates or holds.
        for (const offset of [1_000, 2_000, 3_000]) {
          const tick = await engine.tickOnce(now + offset)
          expect(tick.decisions).toEqual([])
          expect(tick.holds).toEqual([])
        }
        expect(engine.getStats().neverStarted).toBe(1)
        const logged = readIncidents(box.workspace, box.stateDir)
        expect(logged.filter((record) => record.kind === "never-started").length).toBe(1)
        expect(existsSync(holdFile(box))).toBe(false)
        expect(engine.getStats().holdsApplied).toBe(0)
        expect(engine.getStats().scenes).toBe(0)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("T-17 (§6) — the hold's TTL and activity auto-release, PRESERVING", () => {
  test("the resolved knob's TTL travels with a hold the ENGINE persists", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const { stub, engine, dispose } = mount(box, { warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" })
      try {
        engine.stamp("step", agent("a1", box.workspace))
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        openOutstandingChannel(stub, "a1", t0)
        await engine.tickOnce(t0 + 90_001)
        await engine.tickOnce(t0 + 90_002)
        await engine.tickOnce(t0 + 90_003)
        const hold = readHold(box.workspace, box.stateDir, "team-a")
        expect(hold).toBeDefined()
        expect(hold?.ttlMs).toBe(900_000)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("TTL path: the hold releases itself, writes the incident, and touches no team byte", async () => {
    const box = sandbox()
    try {
      const teamView = writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const applied = applyHold(box.workspace, box.stateDir, { team_id: "team-a", ttl_ms: 1_000 })
      expect(applied.applied).toBe(true)
      expect(applied.hold?.ttlMs).toBe(1_000)
      const since = applied.hold?.since ?? 0
      const { engine, dispose } = mount(box)
      try {
        // Before the bound: still held.
        await engine.tickOnce(since + 999)
        expect(existsSync(holdFile(box))).toBe(true)
        // Past the bound: released, once.
        await engine.tickOnce(since + 1_000)
        expect(existsSync(holdFile(box))).toBe(false)
        const releases = readIncidents(box.workspace, box.stateDir).filter((record) => record.kind === "hold-auto-released")
        expect(releases.length).toBe(1)
        expect(releases[0].cause).toMatchObject({ kind: "hold-auto-released", release: "ttl" })
        expect(releases[0].teamId).toBe("team-a")
        expect(releases[0].hold).toBe("not-requested")
        expect(releases[0].scene).toBeNull()
        expect(engine.getStats().holdsAutoReleased).toBe(1)
        // PRESERVING: not one byte of the adopted record moved.
        expect(teamViews(box)).toEqual([teamView])
        // A second tick changes nothing (the release is not repeated).
        await engine.tickOnce(since + 2_000)
        expect(readIncidents(box.workspace, box.stateDir).filter((record) => record.kind === "hold-auto-released").length).toBe(1)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("ACTIVITY path: a stamp earned AFTER the hold disproves the wedge", async () => {
    const box = sandbox()
    try {
      const teamView = writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // ttl_ms 0 = no TTL, so ONLY the activity path can release this one.
      const applied = applyHold(box.workspace, box.stateDir, { team_id: "team-a", ttl_ms: 0 })
      const since = applied.hold?.since ?? 0
      writeStamps(box, "Architect", [stamp(since - 5_000)])
      const { engine, dispose } = mount(box)
      try {
        // A stamp OLDER than the hold proves nothing.
        await engine.tickOnce(since + 100)
        expect(existsSync(holdFile(box))).toBe(true)
        // A stamp NEWER than the hold does.
        writeStamps(box, "Architect", [stamp(since + 50)])
        await engine.tickOnce(since + 200)
        expect(existsSync(holdFile(box))).toBe(false)
        const releases = readIncidents(box.workspace, box.stateDir).filter((record) => record.kind === "hold-auto-released")
        expect(releases.length).toBe(1)
        expect(releases[0].cause).toMatchObject({ kind: "hold-auto-released", release: "activity" })
        expect(teamViews(box)).toEqual([teamView])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("another team's stamp cannot release this team's hold", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const applied = applyHold(box.workspace, box.stateDir, { team_id: "team-a", ttl_ms: 0 })
      const since = applied.hold?.since ?? 0
      writeStamps(box, "Architect", [stamp(since + 10, { teamId: "other-team" })])
      const { engine, dispose } = mount(box)
      try {
        await engine.tickOnce(since + 100)
        expect(existsSync(holdFile(box))).toBe(true)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the HOLD tool carries ttl_ms and inherits the resolved knob when omitted", () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000, holdTtlMs: 4_242 })
      const runtime = ctx.__stub.adapter.toolRuntime()
      void runtime.execute({ name: HOLD_TOOL, arguments: { team_id: "team-a", ttl_ms: 5_000 } })
      expect(readHold(box.workspace, box.stateDir, "team-a")?.ttlMs).toBe(5_000)
      applyResume(box.workspace, box.stateDir, { team_id: "team-a" })
      void runtime.execute({ name: HOLD_TOOL, arguments: { team_id: "team-a" } })
      expect(readHold(box.workspace, box.stateDir, "team-a")?.ttlMs).toBe(4_242)
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("a legacy hold with no ttlMs reads as 0 (no bound is ever invented)", () => {
    const box = sandbox()
    try {
      const dir = join(box.workspace, box.stateDir, "watchdog", "hold")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "team-a.json"), JSON.stringify({ id: "h1", teamId: "team-a", since: 1, cause: "silence", taskId: null, attemptId: null, sceneAt: 0 }))
      expect(readHold(box.workspace, box.stateDir, "team-a")?.ttlMs).toBe(0)
    } finally {
      box.cleanup()
    }
  })
})

describe("the pause surface — the watchdog's preserving hold IS the only pause (0.1.7: no halt exists)", () => {
  /** Drive the real registered status tool and return both the payload and its rendered text. */
  async function statusOf(box: Sandbox, ctx: ReturnType<typeof pluginCtx>) {
    const definition = ctx.__stub.tools.get(STATUS_TOOL)
    expect(definition).toBeDefined()
    const payload = (await definition!.execute({}, {})) as Record<string, unknown>
    const blocks = definition!.output?.render?.({}, payload) as Array<{ text: string }>
    return { payload, text: blocks.map((block) => block.text).join("\n"), teams: payload.teams as Array<{ teamId: string; pause: { paused: boolean; mechanism: string; implementation: string; halted: boolean; held: boolean } }> }
  }

  test("the hold is the ONE pause reported; a halt that does not exist is never named", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      writeTeam(box, { id: "team-b", members: [{ id: "b1", name: "Engineer" }], tasks: [{ id: "t1", status: "pending", assignee: "Engineer" }] })
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      try {
        applyHold(box.workspace, box.stateDir, { team_id: "team-b" })
        const { payload, text, teams } = await statusOf(box, ctx)
        // ONE mechanism: the watchdog's own hold. `halted` stays `false` on BOTH rows because the
        // official team service exposes no halt to read it from.
        expect(teams.find((team) => team.teamId === "team-a")?.pause).toMatchObject({ paused: false, mechanism: "watchdog-hold", implementation: "none", halted: false, held: false })
        expect(teams.find((team) => team.teamId === "team-b")?.pause).toMatchObject({ paused: true, mechanism: "watchdog-hold", implementation: "watchdog-hold", halted: false, held: true })
        expect(text).toContain("team-a: not paused")
        expect(text).toContain("team-b: PAUSED — the watchdog's preserving hold")
        // FALSIFIABLE: the surface must not name a mechanism the official plane does not have.
        expect(text).not.toContain("agent_teams_halt")
        expect(text).not.toContain("halted since")
        const held = (payload.teams as Array<{ teamId: string; halted: boolean | null; held: boolean }>).find((team) => team.teamId === "team-b")
        expect(held?.halted).toBe(false)
        expect(held?.held).toBe(true)
        expect((payload.teams as Array<{ teamId: string }>).length).toBe(2)
      } finally {
        report.engine?.stop()
        ctx.__dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a team with no pause renders as not paused, and NO new resume verb was added", () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [{ id: "t1", status: "pending", assignee: "Architect" }] })
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      try {
        // The action surface is exactly the three documented tools (hold / resume / status).
        expect([...ctx.__stub.tools.keys()].sort()).toEqual(["session-watchdog-hold", "session-watchdog-resume", "session-watchdog-status"])
      } finally {
        report.engine?.stop()
        ctx.__dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("T-20 (§8) — a blocked member is PARKED, never silent", () => {
  test("the derivation reads the record alone", () => {
    const team = {
      id: "team-a",
      name: "team-a",
      members: [],
      createdAt: null,
      approvedAt: null,
      activityAt: null,
      raw: {},
      tasks: [
        { id: "t1", status: "in_progress", assignee: "Architect", dependencies: ["t9"] },
        { id: "t9", status: "pending" },
        { id: "t2", status: "in_progress", assignee: "Engineer", dependencies: ["t9"] },
      ],
    }
    expect(dependencyBlocked(team, "Architect")).toEqual({ blocked: true, waiting: ["t9"] })
    // A member with NO open task is not "blocked" — there is nothing to wait for.
    expect(dependencyBlocked(team, "Ghost")).toEqual({ blocked: false, waiting: [] })
    // An unknown dependency id counts as unfinished (it cannot be shown finished).
    expect(dependencyBlocked({ ...team, tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", dependencies: ["nope"] }] }, "Architect").blocked).toBe(true)
    // A finished dependency un-blocks.
    expect(dependencyBlocked({ ...team, tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", dependencies: ["t9"] }, { id: "t9", status: "completed" }] }, "Architect").blocked).toBe(false)
  })

  test("ENGINE: OUTSTANDING + blocked dependency is PARKED — no warn, no hold, no scene", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [
          { id: "t9", status: "pending" },
          { id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1", dependencies: ["t9"] },
        ],
      })
      const { stub, engine, dispose } = mount(box, { warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" })
      try {
        engine.stamp("step", agent("a1", box.workspace))
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        // A genuinely OUTSTANDING channel — which would warn and escalate if the member were
        // not waiting on an unfinished dependency.
        openOutstandingChannel(stub, "a1", t0)
        for (const offset of [90_001, 90_002, 90_003, 90_004]) {
          const tick = await engine.tickOnce(t0 + offset)
          expect(tick.decisions).toEqual([])
          expect(tick.holds).toEqual([])
        }
        expect(existsSync(holdFile(box))).toBe(false)
        expect(engine.getStats().channelDependencyBlocked).toBeGreaterThan(0)
        expect(engine.getStats().scenes).toBe(0)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("ENGINE: the suppression is DERIVED, not sticky — finishing the dependency warns again", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [
          { id: "t9", status: "pending" },
          { id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1", dependencies: ["t9"] },
        ],
      })
      const { stub, engine, dispose } = mount(box, { warnSilenceMs: 90_000 })
      try {
        engine.stamp("step", agent("a1", box.workspace))
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        openOutstandingChannel(stub, "a1", t0)
        expect((await engine.tickOnce(t0 + 90_001)).decisions).toEqual([])
        // The dependency completes: the same channel is now a real silence candidate.
        writeTeam(box, {
          id: "team-a",
          members: [{ id: "a1", name: "Architect" }],
          tasks: [
            { id: "t9", status: "completed" },
            { id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1", dependencies: ["t9"] },
          ],
        })
        engine.invalidate()
        const warned = await engine.tickOnce(t0 + 90_002)
        expect(warned.decisions.map((d) => d.type)).toEqual(["warn"])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("§7.2/§7.3 — the knobs' live-vs-file divergence", () => {
  test("knobReadings is pure: difference ⇒ restartRequired, equality ⇒ silence", () => {
    const readings = knobReadings(WATCHDOG_DEFAULTS, { warnSilenceMs: 900_000, actionOnEscalate: "warn-only" })
    const warn = readings.find((reading) => reading.knob === "warnSilenceMs")
    expect(warn).toMatchObject({ live: 600_000, file: 900_000, differs: true, restartRequired: true })
    expect(readings.find((reading) => reading.knob === "actionOnEscalate")).toMatchObject({ differs: false, restartRequired: false })
    // A file that states nothing is not a divergence.
    for (const reading of knobReadings(WATCHDOG_DEFAULTS, undefined)) {
      expect(reading.file).toBeUndefined()
      expect(reading.restartRequired).toBe(false)
    }
  })

  test("ENGINE: one warning per process, naming the file value and the live value", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // JSONC on purpose: comments and a trailing comma must not break the reading.
      writeFileSync(
        join(box.workspace, ".mpd", "mpd.jsonc"),
        '// my tuning\n{\n  "watchdog": {\n    "warnSilenceMs": 900000, // old value\n    "holdTtlMs": 60000,\n  }\n}\n',
      )
      const warnings: string[] = []
      const stub: StubAdapter = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, { on: () => () => {}, logger: { warn: (text: string) => warnings.push(text), info: () => {} } } as unknown as EngineContext, testConfig({ stateDir: box.stateDir }))
      const disposers = engine.install()
      try {
        await engine.tickOnce(1_000)
        await engine.tickOnce(2_000)
        const divergent = warnings.filter((line) => line.includes("KNOBS DIVERGE (§7.3)"))
        expect(divergent.length).toBe(1)
        // `testConfig` runs the engine on its own fast thresholds, so the LIVE values here are
        // 90_000 / 900_000 — the point is that BOTH are named, live first, file second.
        expect(divergent[0]).toContain("warnSilenceMs: live=90000 file=900000")
        expect(divergent[0]).toContain("holdTtlMs: live=900000 file=60000")
        const view = engine.knobDivergence()
        expect(view.restartRequired).toBe(true)
        expect(view.divergent.sort()).toEqual(["holdTtlMs", "warnSilenceMs"])
        expect(view.fileFound).toBe(true)
      } finally {
        for (const off of disposers) off()
        engine.stop()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the status view prints the per-knob table with restartRequired", async () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [{ id: "t1", status: "pending", assignee: "Architect" }] })
      writeFileSync(join(box.workspace, ".mpd", "mpd.jsonc"), '{"watchdog":{"warnSilenceMs":900000}}\n')
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      try {
        await report.engine!.tickOnce(1_000)
        const definition = ctx.__stub.tools.get(STATUS_TOOL)!
        const payload = (await definition.execute({}, {})) as Record<string, unknown>
        const text = (definition.output?.render?.({}, payload) as Array<{ text: string }>).map((block) => block.text).join("\n")
        expect(text).toContain("knobs (live vs")
        expect(text).toContain("warnSilenceMs=7200000 (file 900000, restartRequired)")
      } finally {
        report.engine?.stop()
        ctx.__dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})
