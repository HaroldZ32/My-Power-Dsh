// The WARN -> ESCALATE machine and its knobs.
//
// Acceptance this file backs: silence > warnSilenceMs emits exactly one WARN with a
// snapshot; the SAME task's third consecutive WARN emits exactly one ESCALATE and no
// fourth WARN; a retry with a NEW attemptId starts a clean streak; the four knobs come
// from the `mpd` namespace and are re-read on settings/document-updated; a claimed task
// whose owner never stamped is a non-escalating `never-started` observation.
import { describe, expect, test } from "bun:test"
import { WatchdogMachine, WATCHDOG_DEFAULTS, readKnobs, streakKey } from "../src/machine"
import { WatchdogEngine } from "../src/engine"
import { readHeartbeats } from "../src/store"
import { agent, sandbox, stubAdapter, testConfig, writeTeam, openOutstandingChannel } from "./support"

function stubCtx(dsh?: { onEvent: (event: string, handler: (...args: any[]) => unknown) => (() => void) | undefined }): { on: (event: string, handler: (...args: any[]) => unknown) => () => void } {
  return { on: () => () => {} }
}

// These cases assert the ARITHMETIC of the ladder (a strike every tick, a reset on any
// evidence, a clean streak per attempt) on the pre-redesign timings, so the timestamps in
// them stay readable. The FROZEN §3 defaults — 600 s, six strikes, `warn-only` — are
// asserted verbatim in the knobs describe block below.
const knobs = { ...WATCHDOG_DEFAULTS, warnSilenceMs: 90_000, warnStreakToEscalate: 3 }

describe("knobs", () => {
  test("an absent namespace resolves to the frozen defaults", () => {
    const resolved = readKnobs(undefined, {})
    expect(resolved.enabled).toBe(true)
    expect(resolved.warnSilenceMs).toBe(600_000)
    expect(resolved.tickIntervalMs).toBe(15_000)
    expect(resolved.warnStreakToEscalate).toBe(6)
    expect(resolved.actionOnEscalate).toBe("warn-only")
    expect(resolved.issues).toEqual([])
  })

  test("the watchdog section is read from the mpd namespace by its exact paths", () => {
    const resolved = readKnobs(
      { watchdog: { warnSilenceMs: 12_345, tickIntervalMs: 1_000, warnStreakToEscalate: 2, actionOnEscalate: "warn-only", enabled: false } },
      {},
    )
    expect(resolved.warnSilenceMs).toBe(12_345)
    expect(resolved.tickIntervalMs).toBe(1_000)
    expect(resolved.warnStreakToEscalate).toBe(2)
    expect(resolved.actionOnEscalate).toBe("warn-only")
    expect(resolved.enabled).toBe(false)
  })

  test("a cadence at or beyond the silence threshold is clamped loudly, not thrown", () => {
    const resolved = readKnobs({ watchdog: { warnSilenceMs: 1_000, tickIntervalMs: 5_000 } }, {})
    expect(resolved.tickIntervalMs).toBeLessThan(resolved.warnSilenceMs)
    expect(resolved.issues.length).toBe(1)
    expect(resolved.issues[0].path).toBe("watchdog.tickIntervalMs")
  })

  test("a bad knob type falls back with a recorded issue", () => {
    const resolved = readKnobs({ watchdog: { warnSilenceMs: "soon" } }, {})
    expect(resolved.warnSilenceMs).toBe(600_000)
    expect(resolved.issues.some((issue) => issue.path === "watchdog.warnSilenceMs")).toBe(true)
  })

  test("the env kill switch forces the watchdog off", () => {
    expect(readKnobs({ watchdog: { enabled: true } }, { MPD_DSH_TEAM_WATCHDOG: "off" }).enabled).toBe(false)
  })
})

describe("the machine", () => {
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    teamId: "team-a",
    taskId: "t1",
    attemptId: "att-1",
    assignee: "Architect",
    memberKey: "Architect",
    lastSeen: 1_000,
    // The KIND of the newest stamp is part of the predicate: `turn-end` means the member
    // finished its turn and is between turns, so it is never a silence candidate.
    lastKind: "step",
    everStampedForTask: true,
    // r6: NO tool call is in flight in these silence cases. The in-flight rule only engages
    // on a `number` start time, so `null` here means "the member is not inside a tool call"
    // and every case below exercises the pre-r6 silence path unchanged.
    inFlightSince: null,
    inFlightTool: null,
    ...overrides,
  })

  test("exactly one WARN per silent tick, and the third WARN escalates once", () => {
    const machine = new WatchdogMachine()
    const first = machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 1, knobs)
    expect(first.map((d) => d.type)).toEqual(["warn"])
    const second = machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 2, knobs)
    expect(second.map((d) => d.type)).toEqual(["warn"])
    const third = machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 3, knobs)
    expect(third.map((d) => d.type)).toEqual(["escalate"])
    // No fourth WARN, no second ESCALATE, ever.
    const fourth = machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 4, knobs)
    expect(fourth).toEqual([])
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(true)
  })

  test("a new attemptId starts a clean streak", () => {
    const machine = new WatchdogMachine()
    machine.observe([candidate()], 200_000, knobs)
    machine.observe([candidate()], 200_001, knobs)
    const retry = machine.observe([candidate({ attemptId: "att-2" })], 200_002, knobs)
    expect(retry.map((d) => d.type)).toEqual(["warn"])
    expect(machine.snapshot().streaks[streakKey("team-a", "t1", "att-2")]).toBe(1)
  })

  test("any recent stamp resets the streak", () => {
    const machine = new WatchdogMachine()
    machine.observe([candidate()], 200_000, knobs)
    expect(machine.observe([candidate({ lastSeen: 200_010 })], 200_020, knobs)).toEqual([])
    expect(machine.snapshot().streaks).toEqual({})
  })

  test("a claimed task whose owner never stamped is never-started, and never escalates", () => {
    const machine = new WatchdogMachine()
    const decisions = machine.observe([candidate({ lastSeen: null, lastKind: null, everStampedForTask: false })], 999_999, knobs)
    expect(decisions.map((d) => d.type)).toEqual(["never-started"])
    const again = machine.observe([candidate({ lastSeen: null, lastKind: null, everStampedForTask: false })], 1_000_000, knobs)
    expect(again).toEqual([])
  })

  test("a COMPLETED turn is not a wedge: a turn-end newest stamp never warns or escalates", () => {
    const machine = new WatchdogMachine()
    const completed = candidate({ lastKind: "turn-end", lastSeen: 1_000 })
    // Well past the threshold, and for far longer than the 3-WARN streak would need.
    expect(machine.observe([completed], 1_000 + knobs.warnSilenceMs * 10, knobs)).toEqual([])
    expect(machine.observe([completed], 1_000 + knobs.warnSilenceMs * 20, knobs)).toEqual([])
    expect(machine.snapshot().escalated).toEqual([])
    // A stale streak must not survive the boundary and be spent on the next turn.
    expect(machine.snapshot().streaks).toEqual({})
  })

  test("a stale streak is RESET by the boundary (the completed turn cannot spend it later)", () => {
    const machine = new WatchdogMachine()
    machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 1, knobs)
    machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 2, knobs)
    expect(machine.snapshot().streaks[streakKey("team-a", "t1", "att-1")]).toBe(2)
    // The turn ends...
    expect(machine.observe([candidate({ lastKind: "turn-end" })], 1_000 + knobs.warnSilenceMs + 3, knobs)).toEqual([])
    // ...and the streak is gone, so the next silent tick is a FIRST warn, not an escalate.
    const resumed = machine.observe([candidate()], 1_000 + knobs.warnSilenceMs + 4, knobs)
    expect(resumed.map((d) => d.type)).toEqual(["warn"])
    expect(resumed[0].streak).toBe(1)
  })

  test("W11-1 REGRESSION (the Reviewer's exact probe shape): two teams, both tasks t1, BOTH with an empty attemptId, each observed once per tick", () => {
    // The finding, reproduced exactly: task ids are per-team, so BOTH teams have a `t1`, and a
    // `pending` task that carries an assignee with NO attemptId is reachable (the adopted amend
    // path). Under the removed `taskId\0attemptId` key BOTH tasks hashed to the SAME key
    // (`"t1\u0000"`), so their observations summed:
    //     removed key : tick1 A warn:1, B warn:2 -> tick2 A ESCALATE:3, B [] (and B never again)
    // A correct per-team machine escalates NEITHER team in that scenario — that is the falsifier.
    const machine = new WatchdogMachine()
    const teamA = candidate({ teamId: "team-a", taskId: "t1", attemptId: "" })
    const teamB = candidate({ teamId: "team-b", taskId: "t1", attemptId: "" })
    const now = 1_000 + knobs.warnSilenceMs + 1

    // (0) the two candidates must NOT share a key any more — the collision WAS the defect.
    expect(streakKey("team-a", "t1", "")).not.toBe(streakKey("team-b", "t1", ""))
    expect(streakKey("team-a", "t1", "")).toBe("team-a\u0000t1\u0000")
    // The single key the removed code produced for this scenario is no longer produced at all.
    expect([streakKey("team-a", "t1", ""), streakKey("team-b", "t1", "")]).not.toContain("t1\u0000")

    // (1) the reviewer's two ticks: both teams observed once per tick.
    const tick1 = machine.observe([teamA, teamB], now, knobs)
    const tick2 = machine.observe([teamA, teamB], now + 1, knobs)
    expect(tick1.map((d) => `${d.teamId}:${d.type}:${d.streak}`)).toEqual(["team-a:warn:1", "team-b:warn:1"])
    expect(tick2.map((d) => `${d.teamId}:${d.type}:${d.streak}`)).toEqual(["team-a:warn:2", "team-b:warn:2"])
    // THE FALSIFIER: in the reviewer's scenario a correct per-team machine escalates NOBODY.
    // (The removed key produced exactly one ESCALATE here, for the wrong team.)
    expect(tick1.some((d) => d.type === "escalate")).toBe(false)
    expect(tick2.some((d) => d.type === "escalate")).toBe(false)
    expect(machine.snapshot().escalated).toEqual([])

    // (2) only a team's OWN third consecutive warn escalates, and the keys stay distinct.
    const tick3 = machine.observe([teamA], now + 2, knobs)
    expect(tick3.map((d) => `${d.teamId}:${d.type}:${d.streak}`)).toEqual(["team-a:escalate:3"])
    expect(machine.hasEscalated("team-a", "t1", "")).toBe(true)
    expect(machine.hasEscalated("team-b", "t1", "")).toBe(false)
    expect(machine.snapshot().streaks[streakKey("team-b", "t1", "")]).toBe(2)

    const tick4 = machine.observe([teamB], now + 3, knobs)
    expect(tick4.map((d) => `${d.teamId}:${d.type}:${d.streak}`)).toEqual(["team-b:escalate:3"])
    expect(machine.snapshot().escalated.sort()).toEqual(["team-a\u0000t1\u0000", "team-b\u0000t1\u0000"].sort())
  })

  test("W11-2: a stamp from ANOTHER attempt does not satisfy the precondition (it is never-started, not silent)", () => {
    const machine = new WatchdogMachine()
    const fromAnotherAttempt = candidate({ taskId: "t1", attemptId: "", lastSeen: null, lastKind: null, everStampedForTask: false })
    // candidateFor() is what decides that; this asserts the OBSERVE half of the contract.
    expect(machine.observe([fromAnotherAttempt], 999_999, knobs).map((d) => d.type)).toEqual(["never-started"])
  })

  test("a disabled watchdog observes nothing", () => {
    const machine = new WatchdogMachine()
    expect(machine.observe([candidate()], 999_999, { ...knobs, enabled: false })).toEqual([])
  })
})

describe("the machine over a real team record", () => {
  test("WARN then ESCALATE land on disk with the hold applied through the tool seam", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      const startedAt = 1_000_000
      engine.install()
      engine.stamp("step", agent("a1", box.workspace))
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      const silenceFrom = stamps[0].at
      // The §1 channel authority: an OUTSTANDING request (an open step with no committed
      // answer) is the only state the ladder warns/escalates from.
      openOutstandingChannel(stub, "a1", silenceFrom)

      const first = await engine.tickOnce(silenceFrom + 90_001)
      expect(first.decisions.map((d) => d.type)).toEqual(["warn"])
      expect(first.scenes.length).toBe(1)
      const second = await engine.tickOnce(silenceFrom + 90_002)
      expect(second.decisions.map((d) => d.type)).toEqual(["warn"])
      const third = await engine.tickOnce(silenceFrom + 90_003)
      expect(third.decisions.map((d) => d.type)).toEqual(["escalate"])
      expect(third.holds).toEqual(["team-a"])
      const fourth = await engine.tickOnce(silenceFrom + 90_004)
      expect(fourth.decisions).toEqual([])

      const stats = engine.getStats()
      expect(stats.scenes).toBe(3)
      expect(stats.holdsApplied).toBe(1)
      expect(stats.incidents).toBe(3)
      expect(stub.toolExecutes).toContain("session-watchdog-hold")
      void startedAt
    } finally {
      box.cleanup()
    }
  })

  test("a live knob change is picked up without a restart", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const stub = stubAdapter({
        workspace: box.workspace,
        settings: { watchdog: { warnSilenceMs: 90_000, tickIntervalMs: 15_000 } },
      })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.install()
      engine.stamp("step", agent("a1", box.workspace))
      const first = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at

      // 30 s of silence must NOT warn under the 90 s default.
      expect((await engine.tickOnce(first + 30_000)).decisions).toEqual([])

      // A live edit raises nothing but LOWERS the threshold: now 30 s of silence warns.
      stub.setSettings({ watchdog: { warnSilenceMs: 20_000, tickIntervalMs: 15_000 } })
      stub.emitSettings()
      const warned = await engine.tickOnce(first + 30_001)
      expect(warned.decisions.map((d) => d.type)).toEqual(["warn"])
      expect(engine.getKnobs().warnSilenceMs).toBe(20_000)
    } finally {
      box.cleanup()
    }
  })
})
