// The pairing rule, driven without a team. The arms are the ones whose absence produced the retired
// scheduler's two post-mortems: the same task going to two members, and a ledger that never frees a
// member again.
import { describe, expect, test } from "bun:test"
import { assign, dispatchMessage, forgetTeam, ledgerKey, ledgerOfTeam, planDispatch, reconcile, release, type DispatchLedger, type DispatchMember, type DispatchTask } from "../src/dispatch"

/** The frozen clock every `assignedAt` in this file is compared against. */
const NOW = new Date("2026-09-27T10:00:00.000Z")
/** The team the ledger arms write for; the second team exists only to prove the scoping. */
const TEAM = "team-a"
/** A second team in the SAME workspace, reusing the very task ids the first one uses. */
const OTHER_TEAM = "team-b"
/** A ready pending board task; the defaults are the shape each arm starts from. */
const task = (id: string, ready: boolean = true, status: string = "pending"): DispatchTask => ({ id, subject: "task " + id, status, ready })
/** An idle roster member; `inactive` is the one status dispatch accepts as free. */
const member = (id: string, status: string = "inactive"): DispatchMember => ({ id, name: "member " + id, status })

describe("one dispatch pass", () => {
  test("a ready task goes to an idle member, in board order", () => {
    /** One pass over a two-task board with two idle members. */
    const plan = planDispatch({ tasks: [task("t1"), task("t2")], members: [member("m1"), member("m2")], ledger: {} })
    expect(plan.pairs.map((pair) => [pair.taskId, pair.memberId])).toEqual([["t1", "m1"], ["t2", "m2"]])
    expect(plan.skipped).toEqual([])
  })

  test("a member already working something is NOT given a second task", () => {
    /** A ledger that already books m1, so this pass must leave that member alone. */
    const ledger: DispatchLedger = { [ledgerKey(TEAM, "t0")]: { teamId: TEAM, taskId: "t0", memberId: "m1", memberName: "member m1", assignedAt: NOW.toISOString() } }
    /** The pass whose only free member is m2, because the ledger above books m1. */
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1"), member("m2")], ledger })
    expect(plan.pairs.map((pair) => pair.memberId)).toEqual(["m2"])
  })

  test("THE SAME TASK IS NEVER DISPATCHED TWICE — the ledger is the reason, not the message", () => {
    /** The pass that pairs t1 with m1 for the first time. */
    const first = planDispatch({ tasks: [task("t1")], members: [member("m1")], ledger: {} })
    /** The ledger recording that pairing, which is what must prevent a second dispatch. */
    const ledger = assign({}, { teamId: TEAM, ...first.pairs[0] }, NOW)
    /** A second pass over the SAME task, now with a spare member available to take it. */
    const second = planDispatch({ tasks: [task("t1")], members: [member("m1"), member("m2")], ledger })
    expect(second.pairs).toEqual([])
    expect(second.skipped[0].reason).toContain("already dispatched to member m1")
  })

  test("a running member is not idle: the roster status is the gate", () => {
    /** The pass whose first member is running: only the second may receive the task. */
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1", "running"), member("m2", "inactive")], ledger: {} })
    expect(plan.pairs.map((pair) => pair.memberId)).toEqual(["m2"])
  })

  test("no idle member is reported per task, not as a silent no-op", () => {
    /** The pass whose only member is busy, so the task must be REPORTED rather than dropped. */
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1", "running")], ledger: {} })
    expect(plan.pairs).toEqual([])
    expect(plan.skipped).toEqual([{ taskId: "t1", subject: "task t1", reason: "no idle member is free" }])
  })

  test("a blocked task waits and says what blocks it; a completed one is skipped", () => {
    /** The pass over one blocked task and one completed one: neither may be paired. */
    const plan = planDispatch({
      tasks: [{ id: "t1", subject: "blocked", status: "pending", ready: false, blockedBy: ["t0"] }, task("t2", true, "completed")],
      members: [member("m1"), member("m2")],
      ledger: {},
    })
    expect(plan.pairs).toEqual([])
    expect(plan.skipped[0].reason).toBe("not ready (blocked by t0)")
    expect(plan.skipped[1].reason).toBe("already completed")
  })

  test("a HALT refuses the whole pass and names the reason — and touches nothing else", () => {
    /** The pass under a hold, which must refuse everything and pair nothing. */
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1")], ledger: {}, hold: "waiting for the user" })
    expect(plan.pairs).toEqual([])
    expect(plan.halted).toBe("waiting for the user")
    expect(plan.skipped).toEqual([])
  })

  test("the limit caps one pass and reports the rest as capped", () => {
    /** A two-task board with the pass limit set to one. */
    const plan = planDispatch({ tasks: [task("t1"), task("t2")], members: [member("m1"), member("m2")], ledger: {}, limit: 1 })
    expect(plan.pairs).toHaveLength(1)
    expect(plan.skipped[0].reason).toBe("the pass reached its limit")
  })
})

describe("the ledger", () => {
  test("assign returns a NEW ledger and never mutates the old one", () => {
    /** The ledger before the assignment; `assign` must leave it untouched. */
    const before: DispatchLedger = {}
    /** The ledger the assignment returned, which carries the new pairing under its COMPOSITE key. */
    const after = assign(before, { teamId: TEAM, taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    expect(Object.keys(before)).toEqual([])
    // The key is team + separator + task, and the entry carries the team beside it.
    expect(Object.keys(after)).toEqual([ledgerKey(TEAM, "t1")])
    expect(after[ledgerKey(TEAM, "t1")].memberName).toBe("one")
    expect(after[ledgerKey(TEAM, "t1")].teamId).toBe(TEAM)
    expect(after[ledgerKey(TEAM, "t1")].assignedAt).toBe(NOW.toISOString())
  })

  test("release frees a pairing and reports whether there was one", () => {
    /** A ledger holding exactly one pairing, to be freed. */
    const ledger = assign({}, { teamId: TEAM, taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    /** The release result: the new ledger plus whether an entry was really there. */
    const freed = release(ledger, TEAM, "t1")
    expect(freed.released).toBe(true)
    expect(Object.keys(freed.ledger)).toEqual([])
    expect(release(ledger, TEAM, "nope").released).toBe(false)
  })

  test("RECONCILE forgets a task that was deleted or made terminal out of band — a member must not stay busy forever", () => {
    /** A ledger with three pairings, all for tasks that will disappear from the board. */
    let ledger = assign({}, { teamId: TEAM, taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    ledger = assign(ledger, { teamId: TEAM, taskId: "t2", memberId: "m2", memberName: "two" }, NOW)
    ledger = assign(ledger, { teamId: TEAM, taskId: "t3", memberId: "m3", memberName: "three" }, NOW)
    /** The pruned ledger and the ids it dropped — t1 completed, t2 failed, t3 is gone. */
    const { ledger: next, forgotten } = reconcile(ledger, TEAM, [task("t1", true, "completed"), task("t2", false, "failed")])
    expect(forgotten.sort()).toEqual(["t1", "t2", "t3"])
    expect(Object.keys(next)).toEqual([])
    // and the member becomes dispatchable again
    const plan = planDispatch({ tasks: [task("t4")], members: [member("m1")], ledger: next })
    expect(plan.pairs).toHaveLength(1)
  })

  test("TWO TEAMS IN ONE WORKSPACE NEVER SHADOW EACH OTHER — the same task id is two different pairings", () => {
    // THE MEASURED DEFECT (R1): the ledger was keyed by the bare task id, so a new team minting `T1`
    // inherited the PREVIOUS team's pairing and `agent_teams_dispatch` answered "already dispatched to
    // <a member of the old team>" while the new pairing was never recorded.
    /** Team A's ledger row for T1. */
    const teamA = assign({}, { teamId: TEAM, taskId: "T1", memberId: "m1", memberName: "one" }, NOW)
    /** Both teams holding a pairing for their OWN T1: the keys are distinct and both rows survive. */
    const both = assign(teamA, { teamId: OTHER_TEAM, taskId: "T1", memberId: "m9", memberName: "nine" }, NOW)
    expect(Object.keys(both).sort()).toEqual([ledgerKey(TEAM, "T1"), ledgerKey(OTHER_TEAM, "T1")].sort())
    // Each team's VIEW sees only its own row, so the second team's pass is not told "already dispatched".
    expect(Object.keys(ledgerOfTeam(both, OTHER_TEAM))).toEqual([ledgerKey(OTHER_TEAM, "T1")])
    /** Team B's own pass over its own T1: the row's member is B's, never A's. */
    const planB = planDispatch({ tasks: [task("T1")], members: [member("m9")], ledger: ledgerOfTeam(both, OTHER_TEAM) })
    expect(planB.pairs).toHaveLength(0)
    expect(planB.skipped[0].reason).toContain("already dispatched to nine")
    // A task B has NOT dispatched is dispatchable even though A already used that id.
    // A member B has NOT booked (m9 is busy with B's T1) takes a task whose id A also uses.
    /** A task id used by team A but absent from team B's view. */
    const planBNext = planDispatch({ tasks: [task("T2")], members: [member("m10")], ledger: ledgerOfTeam(both, OTHER_TEAM) })
    expect(planBNext.pairs.map((pair) => pair.taskId)).toEqual(["T2"])
  })

  test("release removes ONLY the named team's row", () => {
    /** Both teams holding a T1 pairing. */
    const both = assign(assign({}, { teamId: TEAM, taskId: "T1", memberId: "m1", memberName: "one" }, NOW), { teamId: OTHER_TEAM, taskId: "T1", memberId: "m9", memberName: "nine" }, NOW)
    /** Freeing team B's row leaves team A's pairing exactly where it was. */
    const freed = release(both, OTHER_TEAM, "T1")
    expect(freed.released).toBe(true)
    expect(Object.keys(freed.ledger)).toEqual([ledgerKey(TEAM, "T1")])
    // Releasing the same row twice reports the second one as absent, never as a success.
    expect(release(freed.ledger, OTHER_TEAM, "T1").released).toBe(false)
  })

  test("LEGACY bare-key rows are dropped by the first pass and REPORTED — no migration script", () => {
    // A ledger written before R1 has entries keyed by the bare task id and no `teamId` at all. It cannot
    // be attributed to a team, so the first reconcile DROPS it and says which ids it lost.
    /** A pre-R1 ledger as `JSON.parse` would hand it over: no teamId on either row. */
    const legacy = {
      T1: { taskId: "T1", memberId: "m1", memberName: "one", assignedAt: NOW.toISOString() },
      T3: { taskId: "T3", memberId: "m2", memberName: "two", assignedAt: NOW.toISOString() },
    } as unknown as DispatchLedger
    /** The pruned ledger and the legacy ids it forgot. */
    const { ledger: next, forgotten } = reconcile(legacy, TEAM, [task("T1"), task("T3")])
    expect(forgotten.sort()).toEqual(["T1", "T3"])
    expect(Object.keys(next)).toEqual([])
    // Idempotent: a second pass over the cleaned ledger reports nothing.
    expect(reconcile(next, TEAM, [task("T1"), task("T3")]).forgotten).toEqual([])
  })

  test("FORGET a TERMINAL team's rows: only that team's entries go, and the task ids are reported", () => {
    /** Two teams' rows, one of which belongs to a team that just reached the terminal phase. */
    const both = assign(assign({}, { teamId: TEAM, taskId: "T1", memberId: "m1", memberName: "one" }, NOW), { teamId: OTHER_TEAM, taskId: "T1", memberId: "m9", memberName: "nine" }, NOW)
    /** The prune of the ended team. */
    const pruned = forgetTeam(both, OTHER_TEAM)
    expect(pruned.forgotten).toEqual(["T1"])
    expect(Object.keys(pruned.ledger)).toEqual([ledgerKey(TEAM, "T1")])
    // An unknown team forgets nothing, and returns an equivalent ledger.
    expect(forgetTeam(both, "team-gone").forgotten).toEqual([])
  })
})

describe("the message a dispatched member receives", () => {
  test("it names the task, carries the acceptance text, and says how to report back", () => {
    /** The message a dispatched member receives, rendered for a real task. */
    const text = dispatchMessage({ id: "t4", subject: "wire the gate", status: "pending", ready: true }, "acceptance: the gate is wired")
    expect(text).toContain("shared task t4: wire the gate")
    expect(text).toContain("acceptance: the gate is wired")
    // MEASURED DEFECT, closed: the line used to name `team_task_update`, a verb NO member of this
    // composition carries — a dispatch message that names a tool the recipient does not have is a
    // message that guarantees a stranded row.
    expect(text).toContain('agent_teams_task {action:"complete"')
    expect(text).toContain("do not wait for another member")
  })
})
