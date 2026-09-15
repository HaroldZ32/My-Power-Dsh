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
import { agent, sandbox, stubAdapter, testConfig, writeTeam } from "./support"

function stubCtx(): { on: (event: string, handler: (...args: any[]) => unknown) => () => void } {
  return { on: () => () => {} }
}

const knobs = { ...WATCHDOG_DEFAULTS }

describe("knobs", () => {
  test("an absent namespace resolves to the frozen defaults", () => {
    const resolved = readKnobs(undefined, {})
    expect(resolved.enabled).toBe(true)
    expect(resolved.warnSilenceMs).toBe(90_000)
    expect(resolved.tickIntervalMs).toBe(15_000)
    expect(resolved.warnStreakToEscalate).toBe(3)
    expect(resolved.actionOnEscalate).toBe("pause")
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
    expect(resolved.warnSilenceMs).toBe(90_000)
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
    stampedThisGeneration: true,
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
    expect(machine.hasEscalated("t1", "att-1")).toBe(true)
  })

  test("a new attemptId starts a clean streak", () => {
    const machine = new WatchdogMachine()
    machine.observe([candidate()], 200_000, knobs)
    machine.observe([candidate()], 200_001, knobs)
    const retry = machine.observe([candidate({ attemptId: "att-2" })], 200_002, knobs)
    expect(retry.map((d) => d.type)).toEqual(["warn"])
    expect(machine.snapshot().streaks[streakKey("t1", "att-2")]).toBe(1)
  })

  test("any recent stamp resets the streak", () => {
    const machine = new WatchdogMachine()
    machine.observe([candidate()], 200_000, knobs)
    expect(machine.observe([candidate({ lastSeen: 200_010 })], 200_020, knobs)).toEqual([])
    expect(machine.snapshot().streaks).toEqual({})
  })

  test("a claimed task whose owner never stamped is never-started, and never escalates", () => {
    const machine = new WatchdogMachine()
    const decisions = machine.observe([candidate({ lastSeen: null, stampedThisGeneration: false })], 999_999, knobs)
    expect(decisions.map((d) => d.type)).toEqual(["never-started"])
    const again = machine.observe([candidate({ lastSeen: null, stampedThisGeneration: false })], 1_000_000, knobs)
    expect(again).toEqual([])
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
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      const startedAt = 1_000_000
      engine.stamp("step", agent("a1", box.workspace))
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      const silenceFrom = stamps[0].at

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
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
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
