// The four-state CHANNEL PREDICATE (frozen contract §1 / T-48 D1) and its §3/§4 ladder.
//
// What this file pins, and why each assertion is falsifiable:
//   * a pure fold over an APPEND-ONLY event list classifies a member channel into exactly
//     ONE of OUTSTANDING / IN-FLIGHT / ALIVE / PARKED, with negative controls that remove
//     the ONE event that should change the verdict;
//   * a COMPLETED step is ALIVE forever (age is irrelevant);
//   * the old silence shape — a claimant with a stale stamp and no channel evidence — can
//     never produce a WARN through the channel path;
//   * §4's degradation WARNs exactly once with cause `silence-heartbeat` and can never
//     escalate or hold, no matter how long the silence lasts.
import { describe, expect, test } from "bun:test"
import { ChannelFold } from "../src/channel"
import { WatchdogMachine, WATCHDOG_DEFAULTS, readKnobs, streakKey, type SilenceCandidate } from "../src/machine"

/** A recorded `session/event` of one kind. */
function event(type: string, data: Record<string, unknown> = {}, time = 1_000): Record<string, unknown> {
  return { type, seq: 1, time, data }
}

/** Fold a whole recorded list for one session. */
function foldAll(sessionId: string, events: readonly Record<string, unknown>[]): ChannelFold {
  const fold = new ChannelFold()
  for (const entry of events) fold.apply(sessionId, entry)
  return fold
}

/** One candidate with the §3 defaults, carrying whatever channel verdict the case needs. */
function candidate(overrides: Partial<SilenceCandidate> = {}): SilenceCandidate {
  return {
    teamId: "team-a",
    taskId: "t1",
    attemptId: "att-1",
    assignee: "Architect",
    memberKey: "Architect",
    lastSeen: 1_000,
    lastKind: "step",
    everStampedForTask: true,
    inFlightSince: null,
    inFlightTool: null,
    ...overrides,
  }
}

describe("§1 — the four states, folded from the record stream", () => {
  test("an open step with no committed answer is OUTSTANDING, and it carries the clock", () => {
    const fold = foldAll("s1", [event("turn/start", { turn: 1 }, 1_000), event("step/start", { turn: 1, step: 1 }, 1_000)])
    const view = fold.view("s1")
    expect(view?.state).toBe("OUTSTANDING")
    expect(view?.outstandingSince).toBe(1_000)
    expect(view?.inFlightSince).toBeNull()
  })

  test("NEGATIVE CONTROL: the same list WITH its step/end is no longer OUTSTANDING", () => {
    const without = [event("turn/start", { turn: 1 }, 1_000), event("step/start", { turn: 1, step: 1 }, 1_000)]
    const withEnd = [...without, event("step/end", { turn: 1, step: 1 }, 1_400)]
    expect(foldAll("s1", without).view("s1")?.state).toBe("OUTSTANDING")
    // A completed step inside a turn that has not closed is ALIVE — never OUTSTANDING, and
    // never PARKED (the turn is still the member's).
    expect(foldAll("s1", withEnd).view("s1")?.state).toBe("ALIVE")
  })

  test("an answered step with an unmatched tool/call is IN-FLIGHT", () => {
    const fold = foldAll("s1", [
      event("turn/start", { turn: 1 }, 1_000),
      event("step/start", { turn: 1, step: 1 }, 1_000),
      event("assistant/message", { turn: 1, step: 1, message: {} }, 2_000),
      event("tool/call", { turn: 1, step: 1, callId: "c1", name: "bash" }, 2_100),
    ])
    const view = fold.view("s1")
    expect(view?.state).toBe("IN-FLIGHT")
    expect(view?.inFlightSince).toBe(2_100)
    expect(view?.inFlightTool).toBe("bash")
  })

  test("NEGATIVE CONTROL: dropping the answer makes it OUTSTANDING; adding the result makes it ALIVE", () => {
    const answered = [
      event("turn/start", { turn: 1 }, 1_000),
      event("step/start", { turn: 1, step: 1 }, 1_000),
      event("assistant/message", { turn: 1, step: 1, message: {} }, 2_000),
      event("tool/call", { turn: 1, step: 1, callId: "c1", name: "bash" }, 2_100),
    ]
    const unanswered = answered.filter((entry) => entry.type !== "assistant/message")
    expect(foldAll("s1", unanswered).view("s1")?.state).toBe("OUTSTANDING")
    const completed = [...answered, event("tool/result", { turn: 1, step: 1, message: { content: [{ toolCallId: "c1" }] } }, 2_200)]
    expect(foldAll("s1", completed).view("s1")?.state).toBe("ALIVE")
    expect(foldAll("s1", completed).view("s1")?.inFlightSince).toBeNull()
  })

  test("a turn that has not closed is ALIVE, and a CLOSED turn is PARKED", () => {
    const open = foldAll("s1", [event("turn/start", { turn: 1 }, 1_000)])
    expect(open.view("s1")?.state).toBe("ALIVE")
    const closed = foldAll("s1", [event("turn/start", { turn: 1 }, 1_000), event("turn/end", { turn: 1, reason: { kind: "completed" } }, 9_000_000)])
    expect(closed.view("s1")?.state).toBe("PARKED")
  })

  test("a completed step stays ALIVE forever: 24 h of age changes nothing", () => {
    const fold = foldAll("s1", [
      event("turn/start", { turn: 1 }, 1_000),
      event("step/start", { turn: 1, step: 1 }, 1_000),
      event("assistant/message", { turn: 1, step: 1, message: {} }, 2_000),
      event("step/end", { turn: 1, step: 1 }, 2_100),
    ])
    for (const now of [2_200, 86_400_000, 7 * 86_400_000]) {
      const view = fold.view("s1")
      expect(view?.state).toBe("ALIVE")
      expect(view?.outstandingSince).toBeNull()
      expect(now).toBeGreaterThan(2_100)
    }
  })

  test("the assistant-stream START frame is the §2 enrichment: OUTSTANDING flips to ALIVE", () => {
    const fold = foldAll("s1", [event("turn/start", { turn: 1 }, 1_000), event("step/start", { turn: 1, step: 1 }, 1_000)])
    expect(fold.view("s1")?.state).toBe("OUTSTANDING")
    expect(fold.noteStreamFrame("s1", { type: "start", turn: 1, step: 1 })).toBe(true)
    expect(fold.view("s1")?.state).toBe("ALIVE")
    // …and the settlement puts it back: without a committed answer the honest state is
    // OUTSTANDING again, which is exactly §1 rule 3's stated asymmetry.
    fold.noteStreamFrame("s1", { type: "end", turn: 1, step: 1 })
    expect(fold.view("s1")?.state).toBe("OUTSTANDING")
  })

  test("NO CHANNEL EVIDENCE is not PARKED: it is null (the §4 degradation seam)", () => {
    const fold = new ChannelFold()
    expect(fold.view("s1")).toBeNull()
    expect(fold.has("s1")).toBe(false)
    fold.apply(undefined, event("turn/start", { turn: 1 }))
    expect(fold.view("s1")).toBeNull()
    expect(fold.snapshot().unattributed).toBe(1)
  })

  test("an unknown (extension) event type changes no verdict", () => {
    const base = [event("turn/start", { turn: 1 }, 1_000), event("step/start", { turn: 1, step: 1 }, 1_000)]
    const withUnknown = [...base, event("mpd/something-new", { turn: 1, step: 1, payload: 42 }, 1_100)]
    expect(foldAll("s1", withUnknown).view("s1")?.state).toBe("OUTSTANDING")
  })

  test("the answer may be an `assistant/attempt` (a plugin-merged extension type)", () => {
    const fold = foldAll("s1", [
      event("turn/start", { turn: 1 }, 1_000),
      event("step/start", { turn: 1, step: 1 }, 1_000),
      event("assistant/attempt", { turn: 1, step: 1, stream: [] }, 2_000),
    ])
    expect(fold.view("s1")?.state).toBe("ALIVE")
  })
})

describe("§3 — the ladder and the §4 degradation, per channel verdict", () => {
  test("PARKED and ALIVE never warn, however long the watchdog looks", () => {
    for (const state of ["PARKED", "ALIVE"] as const) {
      const machine = new WatchdogMachine()
      const verdicts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => machine.observe([candidate({ channelState: state })], 1_000 + n * 600_000, WATCHDOG_DEFAULTS))
      expect(verdicts.flat()).toEqual([])
      expect(machine.snapshot().escalated).toEqual([])
    }
  })

  test("OUTSTANDING warns only after warnSilenceMs SINCE THE REQUEST BECAME OUTSTANDING", () => {
    const machine = new WatchdogMachine()
    // 599 s of an outstanding request: below the frozen bound, no report at all.
    expect(machine.observe([candidate({ channelState: "OUTSTANDING", outstandingSince: 1_000 })], 1_000 + 599_999, WATCHDOG_DEFAULTS)).toEqual([])
    const warned = machine.observe([candidate({ channelState: "OUTSTANDING", outstandingSince: 1_000 })], 1_000 + 600_001, WATCHDOG_DEFAULTS)
    expect(warned.map((d) => d.type)).toEqual(["warn"])
    expect(warned[0]).toMatchObject({ cause: "silence-channel", state: "OUTSTANDING", streak: 1 })
  })

  test("the frozen ladder: six consecutive OUTSTANDING observations after the first warn", () => {
    const machine = new WatchdogMachine()
    const verdicts = Array.from({ length: 6 }, (_, index) =>
      machine.observe([candidate({ channelState: "OUTSTANDING", outstandingSince: 1_000 })], 1_000 + 600_001 + index, WATCHDOG_DEFAULTS).map((d) => d.type),
    )
    expect(verdicts).toEqual([["warn"], ["warn"], ["warn"], ["warn"], ["warn"], ["escalate"]])
    // Once escalated the key is DONE: no seventh report of any kind.
    expect(machine.observe([candidate({ channelState: "OUTSTANDING", outstandingSince: 1_000 })], 1_000 + 700_000, WATCHDOG_DEFAULTS)).toEqual([])
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(true)
  })

  test("an OUTSTANDING request that becomes ALIVE resets the streak (no stale escalation)", () => {
    const machine = new WatchdogMachine()
    const key = streakKey("team-a", "t1", "att-1")
    for (let index = 0; index < 4; index += 1) machine.observe([candidate({ channelState: "OUTSTANDING", outstandingSince: 1_000 })], 1_000 + 600_001 + index, WATCHDOG_DEFAULTS)
    expect(machine.snapshot().streaks[key]).toBe(4)
    expect(machine.observe([candidate({ channelState: "ALIVE" })], 1_000 + 600_100, WATCHDOG_DEFAULTS)).toEqual([])
    expect(machine.snapshot().streaks).toEqual({})
  })

  test("IN-FLIGHT past toolInFlightMaxMs is reported ONCE and never held", () => {
    const machine = new WatchdogMachine()
    const inFlight = candidate({ channelState: "IN-FLIGHT", channelInFlightSince: 5_000 })
    const first = machine.observe([inFlight], 5_000 + WATCHDOG_DEFAULTS.toolInFlightMaxMs + 1, WATCHDOG_DEFAULTS)
    expect(first.map((d) => d.type)).toEqual(["tool-expired"])
    expect(first[0]).toMatchObject({ since: 5_000, tool: null })
    expect(machine.observe([inFlight], 5_000 + 2 * WATCHDOG_DEFAULTS.toolInFlightMaxMs, WATCHDOG_DEFAULTS)).toEqual([])
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("§4: with NO channel evidence the heartbeat rule WARNs exactly once and never escalates", () => {
    const machine = new WatchdogMachine()
    const blind = candidate({ channelState: null, heartbeatFallback: true })
    const first = machine.observe([blind], 1_000 + 600_001, WATCHDOG_DEFAULTS)
    expect(first.map((d) => d.type)).toEqual(["warn"])
    expect(first[0]).toMatchObject({ cause: "silence-heartbeat", state: null, streak: 1 })
    // Ten more ticks and 20x the bound: still no second report and NO escalate — the
    // fallback is a report, never a pause.
    for (let index = 2; index <= 10; index += 1) {
      expect(machine.observe([blind], 1_000 + 600_000 * index, WATCHDOG_DEFAULTS)).toEqual([])
    }
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
    expect(machine.snapshot().streaks[streakKey("team-a", "t1", "att-1")]).toBe(10)
  })

  test("§1 rule 5: a candidate that never stamped is never-started, never a warn", () => {
    const machine = new WatchdogMachine()
    const decisions = machine.observe([candidate({ lastSeen: null, lastKind: null, everStampedForTask: false })], 9_999_999, WATCHDOG_DEFAULTS)
    expect(decisions.map((d) => d.type)).toEqual(["never-started"])
    expect(machine.hasEscalated("team-a", "t1", "att-1")).toBe(false)
  })

  test("the frozen §3 defaults are exactly the contract's table", () => {
    const resolved = readKnobs(undefined, {})
    expect({
      warnSilenceMs: resolved.warnSilenceMs,
      tickIntervalMs: resolved.tickIntervalMs,
      warnStreakToEscalate: resolved.warnStreakToEscalate,
      actionOnEscalate: resolved.actionOnEscalate,
      toolInFlightMaxMs: resolved.toolInFlightMaxMs,
      holdTtlMs: resolved.holdTtlMs,
    }).toEqual({
      warnSilenceMs: 600_000,
      tickIntervalMs: 15_000,
      warnStreakToEscalate: 6,
      actionOnEscalate: "warn-only",
      toolInFlightMaxMs: 900_000,
      holdTtlMs: 900_000,
    })
  })
})
