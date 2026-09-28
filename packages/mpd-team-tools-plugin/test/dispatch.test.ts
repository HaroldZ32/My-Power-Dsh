// The pairing rule, driven without a team. The arms are the ones whose absence produced the retired
// scheduler's two post-mortems: the same task going to two members, and a ledger that never frees a
// member again.
import { describe, expect, test } from "bun:test"
import { assign, dispatchMessage, planDispatch, reconcile, release, type DispatchLedger, type DispatchMember, type DispatchTask } from "../src/dispatch"

/** The frozen clock every `assignedAt` in this file is compared against. */
const NOW = new Date("2026-09-27T10:00:00.000Z")
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
    const ledger: DispatchLedger = { t0: { taskId: "t0", memberId: "m1", memberName: "member m1", assignedAt: NOW.toISOString() } }
    /** The pass whose only free member is m2, because the ledger above books m1. */
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1"), member("m2")], ledger })
    expect(plan.pairs.map((pair) => pair.memberId)).toEqual(["m2"])
  })

  test("THE SAME TASK IS NEVER DISPATCHED TWICE — the ledger is the reason, not the message", () => {
    /** The pass that pairs t1 with m1 for the first time. */
    const first = planDispatch({ tasks: [task("t1")], members: [member("m1")], ledger: {} })
    /** The ledger recording that pairing, which is what must prevent a second dispatch. */
    const ledger = assign({}, first.pairs[0], NOW)
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
    /** The ledger the assignment returned, which carries the new pairing. */
    const after = assign(before, { taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    expect(Object.keys(before)).toEqual([])
    expect(after.t1.memberName).toBe("one")
    expect(after.t1.assignedAt).toBe(NOW.toISOString())
  })

  test("release frees a pairing and reports whether there was one", () => {
    /** A ledger holding exactly one pairing, to be freed. */
    const ledger = assign({}, { taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    /** The release result: the new ledger plus whether an entry was really there. */
    const freed = release(ledger, "t1")
    expect(freed.released).toBe(true)
    expect(Object.keys(freed.ledger)).toEqual([])
    expect(release(ledger, "nope").released).toBe(false)
  })

  test("RECONCILE forgets a task that was deleted or completed out of band — a member must not stay busy forever", () => {
    /** A ledger with two pairings, both for tasks that will disappear from the board. */
    let ledger = assign({}, { taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    ledger = assign(ledger, { taskId: "t2", memberId: "m2", memberName: "two" }, NOW)
    /** The pruned ledger and the ids it dropped — t1 completed out of band and t2 is gone. */
    const { ledger: next, forgotten } = reconcile(ledger, [task("t1", true, "completed")])
    expect(forgotten).toEqual(["t1", "t2"])
    expect(Object.keys(next)).toEqual([])
    // and the member becomes dispatchable again
    const plan = planDispatch({ tasks: [task("t3")], members: [member("m1")], ledger: next })
    expect(plan.pairs).toHaveLength(1)
  })
})

describe("the message a dispatched member receives", () => {
  test("it names the task, carries the acceptance text, and says how to report back", () => {
    /** The message a dispatched member receives, rendered for a real task. */
    const text = dispatchMessage({ id: "t4", subject: "wire the gate", status: "pending", ready: true }, "acceptance: the gate is wired")
    expect(text).toContain("shared task t4: wire the gate")
    expect(text).toContain("acceptance: the gate is wired")
    expect(text).toContain("team_task_update")
    expect(text).toContain("do not wait for another member")
  })
})
