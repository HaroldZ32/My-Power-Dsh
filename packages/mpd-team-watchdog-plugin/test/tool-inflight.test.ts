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
// The vendored cordis build ships no declaration file, so this module resolves to `any`; the
// directive stays loud and self-healing rather than a blanket `@ts-ignore`.
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { Context } from "../../mpd-agent-teams-plugin/_deps/cordis/lib/index.ts"
import { createDshAdapter, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { WatchdogEngine, type EngineContext } from "../src/engine"
import { inFlightFor, WatchdogMachine, type SilenceCandidate } from "../src/machine"
import { readHeartbeats, type HeartbeatStamp } from "../src/store"
import { agent, openOutstandingChannel, provideTeamsOn, sandbox, stubAdapter, testConfig, writeTeam, type Sandbox } from "./support"

/** The thresholds these cases run with — small enough to be real-time, big enough to be safe. */
const FAST = { warnSilenceMs: 300, tickIntervalMs: 100, toolInFlightMaxMs: 5_000 }

/** The workspace override the adapter's root resolution honours (never the real repo tree). */
let previousRoot: string | undefined
/** Point the adapter's root resolution away from the real repo for this case. */
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

/**
 * The slice of the real vendored cordis context these arms drive.
 *
 * WHY AN ALIAS: `Context` is a real VALUE whose `on` / `emit` / `waterfall` / `get` members are
 * installed by a Proxy handler (`ReflectService.handler` in the vendored module), so they are absent
 * from the class's own type even though every runtime instance carries them. Naming the driven slice
 * keeps each call site checked instead of widening the context to `any`.
 */
interface DrivenContext {
  /** Subscribe to one bus event; returns the cordis disposer. */
  on(event: string, handler: unknown): unknown
  /** Emit one event through the real bus. */
  emit(event: string, ...args: unknown[]): unknown
  /** Run one waterfall step, exactly as the harness's own loop does. */
  waterfall(...args: unknown[]): Promise<unknown>
  /** Read one installed service, or undefined when it is absent. */
  get(name: string): unknown
}

/**
 * Create a real vendored cordis context, typed as the slice these arms drive.
 * @returns the real context; the alias above names the members its class type omits.
 */
function realContext(): DrivenContext {
  // A cast is the only way to name a runtime member the class's own type does not declare.
  return new Context() as unknown as DrivenContext
}

/** Hold the harness's stdio listeners and the box open for the whole case. */
interface RealEngine {
  /** The real cordis context the production wiring dispatches through. */
  ctx: DrivenContext
  /** The engine under test. */
  engine: WatchdogEngine
  /** The REAL adapter the engine reaches the harness through. */
  adapter: DshAdapter
  /** Lines the engine's logger channel produced. */
  warnings: string[]
  /** Tear every listener down; every case calls it from a finally. */
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
  // The real cordis context the production wiring uses. Its type is the vendored module's own
  // `Context` export, written down here because the module is untyped (see the import above).
  const ctx: DrivenContext = realContext()
  // The REAL adapter reaches the official plane through `ctx.get("agentTeams")` / `ctx.get("agents")`,
  // so the fixture team is installed as those services (a faithful minimal fake of the installed
  // host's — see `support.provideTeamsOn`). Without it the adapter's fold reports NO team, which is
  // the honest answer for a composition with no team service but not the case under test here.
  provideTeamsOn(ctx, box)
  // The REAL adapter, which resolves the team plane through ctx.get.
  const adapter = createDshAdapter(ctx as unknown as Record<string, unknown>)
  // Lines the engine's logger channel produced.
  const warnings: string[] = []
  // The engine context: real cordis events plus a recording logger.
  const engineCtx = {
    on: (event: string, handler: (...args: any[]) => unknown) => ctx.on(event, handler as any),
    logger: { warn: (text: string) => warnings.push(text), info: (text: string) => warnings.push(text) },
  } as unknown as EngineContext
  // The engine under test, with the fast thresholds.
  const engine = new WatchdogEngine(adapter, engineCtx, testConfig({ stateDir: box.stateDir, ...FAST, ...overrides }))
  // Teardown callbacks for every listener the engine installed.
  const disposers = engine.install()
  return { ctx, engine, adapter, warnings, dispose: () => { for (const off of disposers) off() } }
}

/**
 * Open an OUTSTANDING channel through the REAL cordis context.
 *
 * `session/event` is an emit dispatch; the adapter's `onEvent` registered the engine's fold as
 * a listener on this same context, so this reaches the production wiring and nothing else.
 */
function openChannel(ctx: DrivenContext, sessionId: string, at: number): void {
  ctx.emit("session/event", { id: sessionId }, { type: "turn/start", seq: 1, time: at, data: { turn: 1 } })
  ctx.emit("session/event", { id: sessionId }, { type: "step/start", seq: 2, time: at, data: { turn: 1, step: 1 } })
}

/** Dispatch the harness's pre-execute gate exactly as `dsh-tools` does. */
async function firePre(ctx: DrivenContext, exec: Record<string, unknown>): Promise<unknown> {
  return ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }))
}

/** Dispatch the harness's post-execute waterfall exactly as `dsh-tools` does. */
async function firePost(ctx: DrivenContext, exec: Record<string, unknown>, result: Record<string, unknown>): Promise<unknown> {
  return ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }))
}

// Wait for `ms` milliseconds, so a real child process can burn the wall clock.
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A REAL long-running command: a genuine child process that really takes `ms`. */
function realLongCommand(ms: number): Promise<{ elapsed: number; status: number | null }> {
  return new Promise((resolve) => {
    // The wall-clock instant the child process was spawned.
    const started = Date.now()
    // A real child process that outlives `ms` while holding no stdio.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, " + ms + ")"], { stdio: "ignore" })
    child.on("exit", (status) => resolve({ elapsed: Date.now() - started, status }))
  })
}

// The exec payload the harness's tool waterfall receives.
const execFor = (box: Sandbox, callId: string, name: string = "bash"): { name: string; callId: string; agent: Record<string, unknown> } => ({
  name,
  callId,
  agent: agent("a1", box.workspace),
})

/** The member's heartbeat stamps, in file order. */
function stampsOf(box: Sandbox): HeartbeatStamp[] {
  return readHeartbeats(box.workspace, box.stateDir, "Architect")
}

describe("r6 — the in-flight derivation (pure)", () => {
  // Build one heartbeat stamp, adding the tool fields only when supplied.
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
    // The derivation for a start with no completion.
    const open = inFlightFor([stamp("step", 1_000), stamp("tool-start", 2_000, "c1", "bash")])
    expect(open).toEqual({ since: 2_000, tool: "bash" })
    expect(inFlightFor([stamp("tool-start", 2_000, "c1", "bash"), stamp("tool", 3_000, "c1")])).toBeNull()
  })

  test("callId pairing: a completed sibling cannot clear a still-running call", () => {
    // Two overlapping calls of which only the SECOND one completed.
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
  // Build a silence candidate, overriding only the fields a case needs.
  const candidate = (overrides: Record<string, unknown> = {}): SilenceCandidate => ({
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
  // The machine knobs these cases run with, on a 90 s silence bound. `holdTtlMs` is the frozen
  // default (900_000): the machine's own `observe` never reads it — the hold registry does.
  const knobs = { enabled: true, warnSilenceMs: 90_000, tickIntervalMs: 15_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" as const, toolInFlightMaxMs: 900_000, holdTtlMs: 900_000 }

  test("3x the threshold inside ONE call produces NO warn, NO escalate and NO hold", () => {
    // A machine with no prior observations.
    const machine = new WatchdogMachine()
    // A candidate inside one open tool call.
    const inFlight = candidate({ inFlightSince: 10_000, inFlightTool: "bash" })
    // One observation per threshold multiple, all inside the call.
    const decisions = [1, 2, 3].map((n) => machine.observe([inFlight], 10_000 + knobs.warnSilenceMs * n, knobs))
    expect(decisions.map((entry) => entry.map((d) => d.type))).toEqual([[], [], []])
    expect(machine.snapshot().inFlightSuppressed).toBe(3)
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("FALSIFIER: toolInFlightMaxMs 0 restores the pre-r6 escalation for the SAME input", () => {
    // A machine with no prior observations.
    const machine = new WatchdogMachine()
    // The same in-flight candidate as the previous case.
    const inFlight = candidate({ inFlightSince: 10_000, inFlightTool: "bash" })
    // The decision kinds with the in-flight bound disabled.
    const kinds = [1, 2, 3].map((n) => machine.observe([inFlight], 10_000 + knobs.warnSilenceMs * n, { ...knobs, toolInFlightMaxMs: 0 }).map((d) => d.type))
    expect(kinds).toEqual([["warn"], ["warn"], ["escalate"]])
    expect(machine.snapshot().inFlightSuppressed).toBe(0)
  })

  test("past the bound the entry STOPS suppressing: one tool-expired report, never an escalate", () => {
    // A machine with no prior observations.
    const machine = new WatchdogMachine()
    // A candidate inside one open tool call.
    const inFlight = candidate({ inFlightSince: 10_000, inFlightTool: "bash" })
    // The first observation past the in-flight bound.
    const first = machine.observe([inFlight], 10_000 + knobs.toolInFlightMaxMs + 1, knobs)
    expect(first.map((d) => d.type)).toEqual(["tool-expired"])
    expect(first[0]).toMatchObject({ inFlightMs: knobs.toolInFlightMaxMs + 1, since: 10_000, tool: "bash" })
    // Reported ONCE: the bound does not turn into a WARN every tick, and never escalates.
    const second = machine.observe([inFlight], 10_000 + knobs.toolInFlightMaxMs + 60_000, knobs)
    expect(second).toEqual([])
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("the WEDGE case is untouched: no in-flight entry still warns then escalates once", () => {
    // A machine with no prior observations.
    const machine = new WatchdogMachine()
    // A candidate with no open call: the pre-r6 wedge shape.
    const wedged = candidate()
    // The decision kinds over four silent ticks.
    const kinds = [1, 2, 3, 4].map((n) => machine.observe([wedged], 1_000 + knobs.warnSilenceMs + n, knobs).map((d) => d.type))
    expect(kinds).toEqual([["warn"], ["warn"], ["escalate"], []])
  })

  test("a finished tool call is NOT in flight: the call that COMPLETED does not suppress", () => {
    // A machine with no prior observations.
    const machine = new WatchdogMachine()
    // A candidate whose newest stamp closed its tool call.
    const afterCompletion = candidate({ lastKind: "tool", inFlightSince: null })
    expect(machine.observe([afterCompletion], 1_000 + knobs.warnSilenceMs + 1, knobs).map((d) => d.type)).toEqual(["warn"])
  })
})

describe("r6 — the real engine, a real long command, and the durable store", () => {
  test("a member 4x the threshold inside ONE real command gets NO warn, NO escalate and NO hold — and is watched again when it completes", async () => {
    isolate()
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The real engine on a real cordis context.
      const real = mountReal(box)
      try {
        // 1) The harness's gate: the observe-only hook must let it through AND stamp the start.
        const exec = execFor(box, "call-long-1")
        // The decision the harness's own gate would see.
        const gate = await firePre(real.ctx, exec)
        expect(gate).toEqual({ kind: "allow" })
        // The store right after the PRE hook: one open call, nothing else.
        const opened = stampsOf(box)
        expect(opened.map((stamp) => stamp.kind)).toEqual(["tool-start"])
        expect(opened[0].tool).toBe("bash")
        expect(opened[0].taskId).toBe("t1")
        // The projected generation token is the official board revision.
        expect(opened[0].attemptId).toBe("1")

        // 2) A REAL command, 1.6 s: the ticks below all land INSIDE it, past 4x the threshold.
        const running = realLongCommand(1_600)
        // One entry per tick taken while the command was running.
        const ticks: Array<{ silenceMs: number; decisions: string[]; holds: number }> = []
        for (const wait of [400, 400, 400]) {
          await sleep(wait)
          // This tick's clock.
          const now = Date.now()
          // This tick's result.
          const tick = await real.engine.tickOnce(now)
          ticks.push({ silenceMs: now - opened[0].at, decisions: tick.decisions.map((d) => d.type), holds: tick.holds.length })
        }
        // The child's own outcome, whose elapsed time proves the call was long.
        const command = await running
        // The engine counters after the three ticks.
        const stats = real.engine.getStats()
        // The hold path whose absence proves nothing was paused.
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
        // The first tick after the POST stamp closed the call.
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
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The real engine on a real cordis context.
      const real = mountReal(box)
      try {
        // The exec payload for a call whose tool body will throw.
        const exec = execFor(box, "call-throw")
        await firePre(real.ctx, exec)
        await sleep(350)
        // The error result the registry normalizes a throwing tool body into; it still reaches
        // tools/post-execute (`dsh-tools/lib/index.ts:3203-3207`), so the entry is cleared.
        await firePost(real.ctx, exec, { isError: true, error: { message: "tool exploded" } })
        // The first tick past the threshold after the call closed.
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
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The real engine with a 600 ms in-flight bound.
      const real = mountReal(box, { toolInFlightMaxMs: 600 })
      try {
        // The exec payload for a call whose POST never arrives.
        const exec = execFor(box, "call-killed")
        await firePre(real.ctx, exec)
        // The open call's start time, the clock the ticks are relative to.
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
        // The durable incident log, one parsed record per non-blank line.
        const incidents = readFileSync(join(box.workspace, box.stateDir, "watchdog", "incidents.jsonl"), "utf8")
          .split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
        expect(incidents).toHaveLength(1)
        expect(incidents[0]).toMatchObject({ kind: "tool-expired", scene: null, hold: "not-requested", taskId: "t1" })
        expect(incidents[0].cause).toMatchObject({ kind: "tool-expired", tool: "bash" })
        // Bounded, not silent: the record exists, and the report is NOT repeated every tick.
        await real.engine.tickOnce(started + 5_000)
        // The incident line count after a further, much later tick.
        const after = readFileSync(join(box.workspace, box.stateDir, "watchdog", "incidents.jsonl"), "utf8")
          .split("\n").filter((line) => line.trim() !== "").length
        expect(after).toBe(1)
        // The counters after the bounded report.
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
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The real engine on a real cordis context.
      const real = mountReal(box)
      try {
        // The decision a DENYing downstream gate produces. It arrives through the untyped vendored
        // `waterfall`, so it is held as `unknown` and compared as a whole by the assertion below.
        const gate: unknown = await real.ctx.waterfall(real.ctx, "tools/pre-execute", execFor(box, "call-denied"), () => Promise.resolve({ kind: "deny", reason: "scope" }))
        expect(gate).toEqual({ kind: "deny", reason: "scope" })
        expect(existsSync(join(box.workspace, box.stateDir, "watchdog", "heartbeat"))).toBe(false)
        expect(real.engine.getStats().toolStarts).toBe(0)
        // …and the silence rule still sees the wedge it has always seen — an OUTSTANDING
        // channel (open step, no committed answer) is what makes the §3 ladder available.
        real.engine.stamp("step", agent("a1", box.workspace))
        // The step stamp's time, which is the OUTSTANDING clock.
        const last = stampsOf(box)[0].at
        openChannel(real.ctx, "a1", last)
        // The decision kinds of the three silent ticks.
        const kinds: string[][] = []
        for (const n of [1, 2, 3]) {
          // This tick's result.
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
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The stub adapter, whose pre hook is deleted just below.
      const stub = stubAdapter({ workspace: box.workspace })
      // The seam is absent, exactly as an older adapter or a harness without the event bus is.
      delete (stub.adapter as { onPreToolExecute?: unknown }).onPreToolExecute
      // Lines the engine's logger channel produced.
      const warnings: string[] = []
      // The engine built on the seam-less adapter.
      const engine = new WatchdogEngine(stub.adapter, {
        on: () => () => {},
        logger: { warn: (text: string) => warnings.push(text), info: (text: string) => warnings.push(text) },
      } as unknown as EngineContext, testConfig({ stateDir: box.stateDir, ...FAST }))
      // Teardown callbacks for every listener the engine installed.
      const disposers = engine.install()
      try {
        expect(warnings.some((line) => line.includes("no pre-tool hook"))).toBe(true)
        engine.stamp("step", agent("a1", box.workspace))
        // The step stamp's time, which is the OUTSTANDING clock.
        const last = stampsOf(box)[0].at
        openOutstandingChannel(stub, "a1", last)
        // The decision kinds of the three silent ticks.
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
