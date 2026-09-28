// The §9 ACCEPTANCE ROWS at the ENGINE level (frozen contract §9: "RED before GREEN").
//
// These are the permanent pins for the three rows lane A1 owns — the same scenarios the
// evidence driver replays against `.mpd/red-baseline`:
//   (a) a member streaming/writing a long answer, 12 simulated minutes → NO warn, NO hold;
//   (b) a member whose open tasks are all dependency-blocked → NO warn, NO hold, PARKED;
//   (d) an OUTSTANDING request with no response → the FIRST warn only after `warnSilenceMs`,
//       then ESCALATE per the §3 ladder;
// plus §4's degradation: with no channel evidence the heartbeat rule WARNs ONCE and can
// never hold or escalate.
//
// Every row goes through the REAL engine, the REAL store and the REAL adapter seam
// (`dsh.onEvent`), so a wiring mistake cannot hide behind a unit-level fold.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { WatchdogEngine, type EngineContext } from "../src/engine"
import { readHeartbeats, type HeartbeatStamp } from "../src/store"
import { agent, sandbox, stubAdapter, testConfig, writeTeam, type Sandbox, type StubAdapter } from "./support"

/** The engine context a direct construction needs (no cordis): events are not used here. */
function stubCtx(dsh?: { onEvent: (event: string, handler: (...args: any[]) => unknown) => (() => void) | undefined }): EngineContext {
  return { on: () => () => {} } as unknown as EngineContext
}

/** §3's frozen ladder, with `pause` chosen explicitly so a hold is observable at all. */
const FROZEN = { warnSilenceMs: 600_000, warnStreakToEscalate: 6, actionOnEscalate: "pause" as const }

/** One recorded `session/event`. */
const ev = (type: string, data: Record<string, unknown> = {}, time: number = 0): Record<string, unknown> => ({ type, seq: 1, time, data })

/** The team every row uses: one member (`a1`), one in-progress task they own. */
function team(box: Sandbox): void {
  writeTeam(box, {
    id: "team-a",
    members: [{ id: "a1", name: "Architect" }],
    tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
  })
}

/** Mount the engine on the stub adapter and return everything the assertions need. */
function mount(box: Sandbox, overrides: Partial<Parameters<typeof testConfig>[0]> = {}): { stub: StubAdapter; engine: WatchdogEngine; dispose: () => void } {
  // The stub adapter the engine is mounted on.
  const stub: StubAdapter = stubAdapter({ workspace: box.workspace })
  // The engine under test, with the frozen ladder applied.
  const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir, ...FROZEN, ...overrides }))
  // Teardown callbacks for every subscription the engine installed.
  const disposers = engine.install()
  return { stub, engine, dispose: () => { for (const off of disposers) off() } }
}

/** The durable hold file the plugin writes for held teams. */
const holdFile = (box: Sandbox): string => join(box.workspace, box.stateDir, "watchdog", "hold", "team-a.json")

/** Every file under the watchdog root, for the "wrote nothing at all" assertions. */
function watchdogFiles(box: Sandbox): string[] {
  // The watchdog root under the sandbox's own workspace.
  const root = join(box.workspace, box.stateDir, "watchdog")
  // Every file path found under that root.
  const out: string[] = []
  // Recursively collect the files below one directory.
  const walk = (dir: string): void => {
    // Directory entries; an unreadable directory contributes nothing.
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      // Full path of this entry.
      const path = join(dir, entry)
      try {
        if (readdirSync(path).length >= 0) walk(path)
      } catch {
        out.push(path)
      }
    }
  }
  walk(root)
  return out.sort()
}

/** A stale stamp of a PREVIOUS generation: written by hand, `at` a day old, no attemptId. */
function staleStamp(box: Sandbox, at: number): HeartbeatStamp {
  // The heartbeat directory the hand-written stamp goes into.
  const dir = join(box.workspace, box.stateDir, "watchdog", "heartbeat")
  mkdirSync(dir, { recursive: true })
  // A completed step stamp of a previous generation, with no attempt id.
  const stamp: HeartbeatStamp = {
    kind: "step",
    at,
    member: "Architect",
    memberKey: "Architect",
    teamId: "team-a",
    taskId: "t1",
    attemptId: "",
    turnId: "Architect#0",
    workspace: box.workspace,
  }
  writeFileSync(join(dir, "Architect.jsonl"), JSON.stringify(stamp) + "\n")
  return stamp
}

describe("§9 row (a) — a long streaming answer is ALIVE, never a wedge", () => {
  test("12 simulated minutes of an uncommitted streaming answer: NO warn, NO hold, NO write", async () => {
    // An isolated workspace for this row.
    const box = sandbox()
    try {
      team(box)
      // The mounted engine plus the stub it is driven through.
      const { stub, engine, dispose } = mount(box)
      try {
        // The stamp just written, whose time is the request's clock.
        const started = engine.stamp("step", agent("a1", box.workspace)).at
        // The same time read back from disk, asserted equal below.
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        expect(started).toBe(t0)
        // The member opened a step, asked the model, and the model is STREAMING: the §2
        // enrichment's start frame is the first-token signal (contract §1 rule 3).
        stub.emit("session/event", { id: "a1" }, ev("turn/start", { turn: 1 }, t0))
        stub.emit("session/event", { id: "a1" }, ev("step/start", { turn: 1, step: 1 }, t0))
        stub.emit("agent/assistant-stream", { agent: agent("a1", box.workspace), frame: { type: "start", turn: 1, step: 1, revision: 1 } })
        // The watchdog tree before the tick, compared again after it.
        const before = watchdogFiles(box)

        // 12 minutes later — well past the 600 s bound that WOULD have fired on silence.
        const tick = await engine.tickOnce(t0 + 12 * 60_000)
        expect(tick.decisions).toEqual([])
        expect(tick.holds).toEqual([])
        expect(tick.scenes).toEqual([])
        expect(engine.predicateStatus().source).toBe("channel")
        expect(engine.predicateStatus().enrichment).toBe(true)
        expect(engine.predicateStatus().states.a1).toBe("ALIVE")
        expect(engine.getStats().holdsApplied).toBe(0)
        expect(existsSync(holdFile(box))).toBe(false)
        // Nothing was decided, so nothing was written: no scene, no incident.
        expect(watchdogFiles(box)).toEqual(before)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the same 12 minutes WITHOUT the enrichment stays OUTSTANDING (§1 rule 3's stated asymmetry)", async () => {
    // An isolated workspace for this row.
    const box = sandbox()
    try {
      team(box)
      // The mounted engine plus the stub it is driven through.
      const { stub, engine, dispose } = mount(box)
      try {
        engine.stamp("step", agent("a1", box.workspace))
        // The step stamp's time, which is the clock the fold sees.
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        stub.emit("session/event", { id: "a1" }, ev("turn/start", { turn: 1 }, t0))
        stub.emit("session/event", { id: "a1" }, ev("step/start", { turn: 1, step: 1 }, t0))
        expect(engine.predicateStatus().states.a1).toBe("OUTSTANDING")
        // The honest bound: with no first-token signal the state is OUTSTANDING, and the
        // 600 s bound is what protects a genuinely unanswered request.
        expect((await engine.tickOnce(t0 + 599_999)).decisions).toEqual([])
        // The tick past the bound, which must produce the single WARN.
        const warned = await engine.tickOnce(t0 + 600_001)
        expect(warned.decisions.map((d) => d.type)).toEqual(["warn"])
        expect(warned.holds).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("§9 row (b) — a member between turns is PARKED, not silent", () => {
  test("a closed turn with a STALE previous-generation stamp: NO warn, NO hold, and PARKED is named", async () => {
    // An isolated workspace for this row.
    const box = sandbox()
    try {
      team(box)
      // A day-old stamp of a previous generation, whose silence must not warn.
      const stale = staleStamp(box, Date.now() - 86_400_000)
      // The mounted engine plus the stub it is driven through.
      const { stub, engine, dispose } = mount(box)
      try {
        // The turn ran and ended: the member is waiting to be re-dispatched (T-20's
        // dependency-blocked member looks exactly like this from the record stream).
        stub.emit("session/event", { id: "a1" }, ev("turn/start", { turn: 1 }, stale.at))
        stub.emit("session/event", { id: "a1" }, ev("step/start", { turn: 1, step: 1 }, stale.at))
        stub.emit("session/event", { id: "a1" }, ev("assistant/message", { turn: 1, step: 1, message: {} }, stale.at + 1_000))
        stub.emit("session/event", { id: "a1" }, ev("step/end", { turn: 1, step: 1 }, stale.at + 2_000))
        stub.emit("session/event", { id: "a1" }, ev("turn/end", { turn: 1, reason: { kind: "completed" } }, stale.at + 3_000))
        // The watchdog tree before the tick, compared again after it.
        const before = watchdogFiles(box)

        // A day of silence on a stale generation: the pre-redesign machine held this team.
        const tick = await engine.tickOnce(stale.at + 86_400_000)
        expect(tick.decisions).toEqual([])
        expect(tick.holds).toEqual([])
        expect(engine.predicateStatus().states.a1).toBe("PARKED")
        expect(existsSync(holdFile(box))).toBe(false)
        expect(watchdogFiles(box)).toEqual(before)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("§9 row (d) — an OUTSTANDING request: the frozen ladder, end to end", () => {
  test("first WARN only after 600 s, then ESCALATE on the sixth observation, and the hold lands", async () => {
    // An isolated workspace for this row.
    const box = sandbox()
    try {
      team(box)
      // The mounted engine plus the stub it is driven through.
      const { stub, engine, dispose } = mount(box)
      try {
        engine.stamp("step", agent("a1", box.workspace))
        // The step stamp's time, which is the OUTSTANDING clock.
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        // An open step and NO assistant answer: the one state that may warn.
        stub.emit("session/event", { id: "a1" }, ev("turn/start", { turn: 1 }, t0))
        stub.emit("session/event", { id: "a1" }, ev("step/start", { turn: 1, step: 1 }, t0))

        expect((await engine.tickOnce(t0 + 599_999)).decisions).toEqual([])
        // The first tick past the bound: the ladder's first WARN.
        const warn = await engine.tickOnce(t0 + 600_001)
        expect(warn.decisions.map((d) => d.type)).toEqual(["warn"])
        expect(warn.decisions[0]).toMatchObject({ cause: "silence-channel", state: "OUTSTANDING", streak: 1 })
        expect(warn.scenes.length).toBe(1)
        expect(existsSync(holdFile(box))).toBe(false)

        for (let index = 2; index <= 5; index += 1) {
          expect((await engine.tickOnce(t0 + 600_000 + index)).decisions.map((d) => d.type)).toEqual(["warn"])
        }
        // The sixth observation, which escalates and persists the hold.
        const escalate = await engine.tickOnce(t0 + 600_006)
        expect(escalate.decisions.map((d) => d.type)).toEqual(["escalate"])
        expect(escalate.holds).toEqual(["team-a"])
        expect(existsSync(holdFile(box))).toBe(true)
        expect(engine.getStats().holdsApplied).toBe(1)
        // Once escalated the key is done: no seventh report of any kind.
        expect((await engine.tickOnce(t0 + 700_000)).decisions).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("§4 degradation — the heartbeat fallback reports once and never pauses", () => {
  test("no channel evidence at all: ONE warn (cause silence-heartbeat), no hold, source named", async () => {
    // An isolated workspace for this row.
    const box = sandbox()
    try {
      team(box)
      // The mounted engine, whose §4 fallback is the subject here.
      const { engine, dispose } = mount(box)
      try {
        engine.stamp("step", agent("a1", box.workspace))
        // The step stamp's time, which is the fallback's clock.
        const t0 = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
        // The first tick past the bound, which reports the fallback once.
        const first = await engine.tickOnce(t0 + 600_001)
        expect(first.decisions.map((d) => d.type)).toEqual(["warn"])
        expect(first.decisions[0]).toMatchObject({ cause: "silence-heartbeat", state: null })
        expect(first.holds).toEqual([])
        // Ten more ticks and 1.5 h of silence: no second report, NO escalate, NO hold.
        for (let index = 1; index <= 10; index += 1) {
          // A further tick inside the long silence, which must stay silent.
          const tick = await engine.tickOnce(t0 + 600_001 + index * 600_000)
          expect(tick.decisions).toEqual([])
          expect(tick.holds).toEqual([])
        }
        expect(engine.predicateStatus().source).toBe("heartbeat")
        expect(engine.predicateStatus().announced).toBe(true)
        expect(engine.getStats().holdsApplied).toBe(0)
        expect(existsSync(holdFile(box))).toBe(false)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})
