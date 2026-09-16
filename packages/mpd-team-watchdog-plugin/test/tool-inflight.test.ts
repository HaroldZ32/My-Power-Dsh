// r6 — A LONG TOOL CALL MUST NOT LOOK LIKE SILENCE.
//
// DEFECT THIS FILE PINS (measured on the real machine, 2026-09-16): the watchdog HELD our own
// team (`mpd-default`) with `cause:{kind:"silence",ms:131049}` on an in_progress task whose
// owner was not wedged at all — it was running a lane that boots a real `dsh` for minutes. The
// heartbeat stamped on model steps and on tool COMPLETION only (W-9), so any tool call longer
// than `warnSilenceMs` was indistinguishable from a wedge: WARN, WARN, WARN, ESCALATE, HOLD.
//
// The fix has two halves and this file proves BOTH:
//   * the adapter's observe-only `tools/pre-execute` hook stamps `tool-start` (the call is now
//     OPEN in the durable store), and the POST stamp of the same `callId` closes it;
//   * the silence predicate treats an OPEN call as EXPLAINED activity, past a stated bound
//     reports it ONCE (WARN-class, never a hold), and `toolInFlightMaxMs: 0` disables the whole
//     rule — the falsifier that keeps this from being an unfalsifiable "the fix works" claim.
//
// Everything here runs against the REAL modules: the real vendored cordis waterfall (so a
// non-delegating listener would veto for real), the REAL adapter, the real engine/machine/store
// and a REAL child process that really burns the wall clock. The only thing not real is the
// harness's tool registry, which is the caller of the waterfall the harness itself calls.
import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Context } from "../../mpd-agent-teams-plugin/_deps/cordis/lib/index.js"
import { createDshAdapter, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { WatchdogEngine, type EngineContext } from "../src/engine"
import { inFlightFor, WatchdogMachine } from "../src/machine"
import { readHeartbeats, type HeartbeatStamp } from "../src/store"
import { agent, sandbox, stubAdapter, testConfig, writeTeam, type Sandbox } from "./support"

/** The thresholds these cases run with — small enough to be real-time, big enough to be safe. */
const FAST = { warnSilenceMs: 300, tickIntervalMs: 100, toolInFlightMaxMs: 5_000 }

/** The workspace override the adapter's root resolution honours (never the real repo tree). */
let previousRoot: string | undefined
function isolate(): void {
  previousRoot = process.env.DSH_WORKSPACE_ROOT
  // Set per case by `mountReal`: without it the adapter's exec-less fallback is `process.cwd()`,
  // i.e. THIS repo — whose `.mpd/team` holds real team records a tick must never touch.
  process.env.DSH_WORKSPACE_ROOT = "/nonexistent/until-mounted"
}
afterEach(() => {
  if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
  else process.env.DSH_WORKSPACE_ROOT = previousRoot
  previousRoot = undefined
})

/** Hold the harness's stdio listeners and the box open for the whole case. */
interface RealEngine {
  ctx: Context
  engine: WatchdogEngine
  adapter: DshAdapter
  warnings: string[]
  dispose: () => void
}

/**
 * Mount the REAL engine on a REAL cordis context through the REAL adapter.
 *
 * This is the production wiring: the engine subscribes `agent/*` on `ctx`, and the adapter
 * subscribes `tools/pre-execute` + `tools/post-execute` on the same context, so every stamp in
 * these cases travels the waterfall the installed harness dispatches.
 */
function mountReal(box: Sandbox, overrides: Partial<typeof FAST> = {}): RealEngine {
  process.env.DSH_WORKSPACE_ROOT = box.workspace
  const ctx = new Context()
  const adapter = createDshAdapter(ctx as unknown as Record<string, unknown>)
  const warnings: string[] = []
  const engineCtx = {
    on: (event: string, handler: (...args: any[]) => unknown) => ctx.on(event, handler as any),
    logger: { warn: (text: string) => warnings.push(text), info: (text: string) => warnings.push(text) },
  } as unknown as EngineContext
  const engine = new WatchdogEngine(adapter, engineCtx, testConfig({ stateDir: box.stateDir, ...FAST, ...overrides }))
  const disposers = engine.install()
  return { ctx, engine, adapter, warnings, dispose: () => { for (const off of disposers) off() } }
}

/** Dispatch the harness's pre-execute gate exactly as `dsh-tools` does. */
async function firePre(ctx: Context, exec: Record<string, unknown>): Promise<unknown> {
  return ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }))
}

/** Dispatch the harness's post-execute waterfall exactly as `dsh-tools` does. */
async function firePost(ctx: Context, exec: Record<string, unknown>, result: Record<string, unknown>): Promise<unknown> {
  return ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A REAL long-running command: a genuine child process that really takes `ms`. */
function realLongCommand(ms: number): Promise<{ elapsed: number; status: number | null }> {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, " + ms + ")"], { stdio: "ignore" })
    child.on("exit", (status) => resolve({ elapsed: Date.now() - started, status }))
  })
}

const execFor = (box: Sandbox, callId: string, name = "bash") => ({
  name,
  callId,
  agent: agent("a1", box.workspace),
})

function stampsOf(box: Sandbox): HeartbeatStamp[] {
  return readHeartbeats(box.workspace, box.stateDir, "Architect")
}

describe("r6 — the in-flight derivation (pure)", () => {
  const stamp = (kind: HeartbeatStamp["kind"], at: number, callId?: string, tool?: string): HeartbeatStamp => ({
    kind,
    at,
    member: "Architect",
    memberKey: "Architect",
    teamId: "team-a",
    taskId: "t1",
    attemptId: "att-1",
    turnId: "Architect#1",
    ...(callId === undefined ? {} : { callId }),
    ...(tool === undefined ? {} : { tool }),
    workspace: "/ws",
  })

  test("a start with no completion is in flight; its completion closes it", () => {
    expect(inFlightFor([])).toBeNull()
    expect(inFlightFor([stamp("step", 1_000)])).toBeNull()
    const open = inFlightFor([stamp("step", 1_000), stamp("tool-start", 2_000, "c1", "bash")])
    expect(open).toEqual({ since: 2_000, tool: "bash" })
    expect(inFlightFor([stamp("tool-start", 2_000, "c1", "bash"), stamp("tool", 3_000, "c1")])).toBeNull()
  })

  test("callId pairing: a completed sibling cannot clear a still-running call", () => {
    const mixed = [
      stamp("tool-start", 1_000, "a"),
      stamp("tool-start", 1_100, "b"),
      stamp("tool", 1_200, "b"),
    ]
    expect(inFlightFor(mixed)).toEqual({ since: 1_000, tool: null })
  })

  test("a harness build without callIds falls back to the newest-stamp rule", () => {
    expect(inFlightFor([stamp("step", 1_000), stamp("tool-start", 2_000)])).toEqual({ since: 2_000, tool: null })
    expect(inFlightFor([stamp("tool-start", 2_000), stamp("step", 3_000)])).toBeNull()
  })
})

describe("r6 — the predicate: explained activity, the bound, and the falsifier", () => {
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    teamId: "team-a",
    taskId: "t1",
    attemptId: "att-1",
    assignee: "Architect",
    memberKey: "Architect",
    lastSeen: 1_000,
    lastKind: "step" as const,
    everStampedForTask: true,
    inFlightSince: null as number | null,
    inFlightTool: null as string | null,
    ...overrides,
  })
  const knobs = { enabled: true, warnSilenceMs: 90_000, tickIntervalMs: 15_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" as const, toolInFlightMaxMs: 900_000 }

  test("3x the threshold inside ONE call produces NO warn, NO escalate and NO hold", () => {
    const machine = new WatchdogMachine()
    const inFlight = candidate({ inFlightSince: 10_000, inFlightTool: "bash" })
    const decisions = [1, 2, 3].map((n) => machine.observe([inFlight], 10_000 + knobs.warnSilenceMs * n, knobs))
    expect(decisions.map((entry) => entry.map((d) => d.type))).toEqual([[], [], []])
    expect(machine.snapshot().inFlightSuppressed).toBe(3)
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("FALSIFIER: toolInFlightMaxMs 0 restores the pre-r6 escalation for the SAME input", () => {
    const machine = new WatchdogMachine()
    const inFlight = candidate({ inFlightSince: 10_000, inFlightTool: "bash" })
    const kinds = [1, 2, 3].map((n) => machine.observe([inFlight], 10_000 + knobs.warnSilenceMs * n, { ...knobs, toolInFlightMaxMs: 0 }).map((d) => d.type))
    expect(kinds).toEqual([["warn"], ["warn"], ["escalate"]])
    expect(machine.snapshot().inFlightSuppressed).toBe(0)
  })

  test("past the bound the entry STOPS suppressing: one tool-expired report, never an escalate", () => {
    const machine = new WatchdogMachine()
    const inFlight = candidate({ inFlightSince: 10_000, inFlightTool: "bash" })
    const first = machine.observe([inFlight], 10_000 + knobs.toolInFlightMaxMs + 1, knobs)
    expect(first.map((d) => d.type)).toEqual(["tool-expired"])
    expect(first[0]).toMatchObject({ inFlightMs: knobs.toolInFlightMaxMs + 1, since: 10_000, tool: "bash" })
    // Reported ONCE: the bound does not turn into a WARN every tick, and never escalates.
    const second = machine.observe([inFlight], 10_000 + knobs.toolInFlightMaxMs + 60_000, knobs)
    expect(second).toEqual([])
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("the WEDGE case is untouched: no in-flight entry still warns then escalates once", () => {
    const machine = new WatchdogMachine()
    const wedged = candidate()
    const kinds = [1, 2, 3, 4].map((n) => machine.observe([wedged], 1_000 + knobs.warnSilenceMs + n, knobs).map((d) => d.type))
    expect(kinds).toEqual([["warn"], ["warn"], ["escalate"], []])
  })

  test("a finished tool call is NOT in flight: the call that COMPLETED does not suppress", () => {
    const machine = new WatchdogMachine()
    const afterCompletion = candidate({ lastKind: "tool", inFlightSince: null })
    expect(machine.observe([afterCompletion], 1_000 + knobs.warnSilenceMs + 1, knobs).map((d) => d.type)).toEqual(["warn"])
  })
})

describe("r6 — the real engine, a real long command, and the durable store", () => {
  test("a member 4x the threshold inside ONE real command gets NO warn, NO escalate and NO hold — and is watched again when it completes", async () => {
    isolate()
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const real = mountReal(box)
      try {
        // 1) The harness's gate: the observe-only hook must let it through AND stamp the start.
        const exec = execFor(box, "call-long-1")
        const gate = await firePre(real.ctx, exec)
        expect(gate).toEqual({ kind: "allow" })
        const opened = stampsOf(box)
        expect(opened.map((stamp) => stamp.kind)).toEqual(["tool-start"])
        expect(opened[0].tool).toBe("bash")
        expect(opened[0].taskId).toBe("t1")
        expect(opened[0].attemptId).toBe("att-1")

        // 2) A REAL command, 1.6 s: the ticks below all land INSIDE it, past 4x the threshold.
        const running = realLongCommand(1_600)
        const ticks: Array<{ silenceMs: number; decisions: string[]; holds: number }> = []
        for (const wait of [400, 400, 400]) {
          await sleep(wait)
          const now = Date.now()
          const tick = await real.engine.tickOnce(now)
          ticks.push({ silenceMs: now - opened[0].at, decisions: tick.decisions.map((d) => d.type), holds: tick.holds.length })
        }
        const command = await running
        const stats = real.engine.getStats()
        const holdFile = join(box.workspace, box.stateDir, "watchdog", "hold", "team-a.json")

        // The three ticks really were inside the call (each one past the threshold, so each
        // would have warned on its own), and the LAST one is past 3x the threshold.
        expect(command.elapsed).toBeGreaterThanOrEqual(1_200)
        expect(ticks.every((tick) => tick.silenceMs > FAST.warnSilenceMs)).toBe(true)
        expect(ticks[ticks.length - 1].silenceMs).toBeGreaterThan(FAST.warnSilenceMs * 3)
        expect(ticks.map((tick) => tick.decisions)).toEqual([[], [], []])
        expect(ticks.every((tick) => tick.holds === 0)).toBe(true)
        expect(stats.holdsApplied).toBe(0)
        expect(stats.scenes).toBe(0)
        expect(stats.incidents).toBe(0)
        expect(real.engine.getMachineState().inFlightSuppressed).toBeGreaterThanOrEqual(3)
        expect(existsSync(holdFile)).toBe(false)

        // 3) The POST stamp closes the call, and the member is WATCHED AGAIN immediately:
        //    the very next tick past the threshold warns, exactly as before r6.
        const closed = await firePost(real.ctx, exec, { isError: false, value: { ok: true } })
        expect(closed).toEqual({ kind: "accept" })
        expect(stampsOf(box).map((stamp) => stamp.kind)).toEqual(["tool-start", "tool"])
        const resumed = await real.engine.tickOnce(Date.now() + FAST.warnSilenceMs + 1)
        expect(resumed.decisions.map((d) => d.type)).toEqual(["warn"])
        expect(stats.toolStarts).toBe(1)
      } finally {
        real.dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a tool that THROWS is closed by its POST (the harness routes tool failures through post-execute)", async () => {
    isolate()
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const real = mountReal(box)
      try {
        const exec = execFor(box, "call-throw")
        await firePre(real.ctx, exec)
        await sleep(350)
        // The error result the registry normalizes a throwing tool body into; it still reaches
        // tools/post-execute (`dsh-tools/lib/index.js:3203-3207`), so the entry is cleared.
        await firePost(real.ctx, exec, { isError: true, error: { message: "tool exploded" } })
        const tick = await real.engine.tickOnce(Date.now() + FAST.warnSilenceMs + 1)
        expect(real.engine.getStats().toolStarts).toBe(1)
        expect(tick.decisions.map((d) => d.type)).toEqual(["warn"])
      } finally {
        real.dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a PRE with NO POST (a killed call) is bounded: one tool-expired record, no scene, no hold, no repeat", async () => {
    isolate()
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const real = mountReal(box, { toolInFlightMaxMs: 600 })
      try {
        const exec = execFor(box, "call-killed")
        await firePre(real.ctx, exec)
        const started = stampsOf(box)[0].at
        // Inside the bound: nothing at all.
        const inside = await real.engine.tickOnce(started + 500)
        expect(inside.decisions).toEqual([])
        expect(inside.holds).toEqual([])
        // Past the bound: exactly one WARN-class record for this task+attempt, and no action.
        const expired = await real.engine.tickOnce(started + 700)
        expect(expired.decisions).toEqual([])
        expect(expired.scenes).toEqual([])
        expect(expired.holds).toEqual([])
        const incidents = readFileSync(join(box.workspace, box.stateDir, "watchdog", "incidents.jsonl"), "utf8")
          .split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
        expect(incidents).toHaveLength(1)
        expect(incidents[0]).toMatchObject({ kind: "tool-expired", scene: null, hold: "not-requested", taskId: "t1" })
        expect(incidents[0].cause).toMatchObject({ kind: "tool-expired", tool: "bash" })
        // Bounded, not silent: the record exists, and the report is NOT repeated every tick.
        await real.engine.tickOnce(started + 5_000)
        const after = readFileSync(join(box.workspace, box.stateDir, "watchdog", "incidents.jsonl"), "utf8")
          .split("\n").filter((line) => line.trim() !== "").length
        expect(after).toBe(1)
        const stats = real.engine.getStats()
        expect(stats.toolExpired).toBe(1)
        expect(stats.holdsApplied).toBe(0)
        expect(stats.scenes).toBe(0)
        expect(existsSync(join(box.workspace, box.stateDir, "watchdog", "hold", "team-a.json"))).toBe(false)
      } finally {
        real.dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a DENIED call is never marked in flight (nothing to explain, nothing leaked)", async () => {
    isolate()
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const real = mountReal(box)
      try {
        const gate = await real.ctx.waterfall(real.ctx, "tools/pre-execute", execFor(box, "call-denied"), () => Promise.resolve({ kind: "deny", reason: "scope" }))
        expect(gate).toEqual({ kind: "deny", reason: "scope" })
        expect(existsSync(join(box.workspace, box.stateDir, "watchdog", "heartbeat"))).toBe(false)
        expect(real.engine.getStats().toolStarts).toBe(0)
        // …and the silence rule still sees the wedge it has always seen.
        real.engine.stamp("step", agent("a1", box.workspace))
        const last = stampsOf(box)[0].at
        const kinds: string[][] = []
        for (const n of [1, 2, 3]) {
          const tick = await real.engine.tickOnce(last + FAST.warnSilenceMs + n)
          kinds.push(tick.decisions.map((d) => d.type))
        }
        expect(kinds).toEqual([["warn"], ["warn"], ["escalate"]])
        expect(real.engine.getStats().holdsApplied).toBe(1)
      } finally {
        real.dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the SEAM is soft-probed: an adapter without the pre hook warns and keeps the pre-r6 behaviour", async () => {
    isolate()
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      // The seam is absent, exactly as an older adapter or a harness without the event bus is.
      delete (stub.adapter as { onPreToolExecute?: unknown }).onPreToolExecute
      const warnings: string[] = []
      const engine = new WatchdogEngine(stub.adapter, {
        on: () => () => {},
        logger: { warn: (text: string) => warnings.push(text), info: (text: string) => warnings.push(text) },
      } as unknown as EngineContext, testConfig({ stateDir: box.stateDir, ...FAST }))
      const disposers = engine.install()
      try {
        expect(warnings.some((line) => line.includes("no pre-tool hook"))).toBe(true)
        engine.stamp("step", agent("a1", box.workspace))
        const last = stampsOf(box)[0].at
        const kinds: string[][] = []
        for (const n of [1, 2, 3]) kinds.push((await engine.tickOnce(last + FAST.warnSilenceMs + n)).decisions.map((d) => d.type))
        expect(kinds).toEqual([["warn"], ["warn"], ["escalate"]])
      } finally {
        for (const off of disposers) off()
      }
    } finally {
      box.cleanup()
    }
  })
})
