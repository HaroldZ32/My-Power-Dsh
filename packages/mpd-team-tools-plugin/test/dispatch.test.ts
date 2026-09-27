// The pairing rule, driven without a team. The arms are the ones whose absence produced the retired
// scheduler's two post-mortems: the same task going to two members, and a ledger that never frees a
// member again.
import { describe, expect, test } from "bun:test"
import { assign, dispatchMessage, planDispatch, reconcile, release, type DispatchLedger } from "../src/dispatch"

const NOW = new Date("2026-09-27T10:00:00.000Z")
const task = (id: string, ready = true, status = "pending") => ({ id, subject: "task " + id, status, ready })
const member = (id: string, status = "inactive") => ({ id, name: "member " + id, status })

describe("one dispatch pass", () => {
  test("a ready task goes to an idle member, in board order", () => {
    const plan = planDispatch({ tasks: [task("t1"), task("t2")], members: [member("m1"), member("m2")], ledger: {} })
    expect(plan.pairs.map((pair) => [pair.taskId, pair.memberId])).toEqual([["t1", "m1"], ["t2", "m2"]])
    expect(plan.skipped).toEqual([])
  })

  test("a member already working something is NOT given a second task", () => {
    const ledger: DispatchLedger = { t0: { taskId: "t0", memberId: "m1", memberName: "member m1", assignedAt: NOW.toISOString() } }
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1"), member("m2")], ledger })
    expect(plan.pairs.map((pair) => pair.memberId)).toEqual(["m2"])
  })

  test("THE SAME TASK IS NEVER DISPATCHED TWICE — the ledger is the reason, not the message", () => {
    const first = planDispatch({ tasks: [task("t1")], members: [member("m1")], ledger: {} })
    const ledger = assign({}, first.pairs[0], NOW)
    const second = planDispatch({ tasks: [task("t1")], members: [member("m1"), member("m2")], ledger })
    expect(second.pairs).toEqual([])
    expect(second.skipped[0].reason).toContain("already dispatched to member m1")
  })

  test("a running member is not idle: the roster status is the gate", () => {
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1", "running"), member("m2", "inactive")], ledger: {} })
    expect(plan.pairs.map((pair) => pair.memberId)).toEqual(["m2"])
  })

  test("no idle member is reported per task, not as a silent no-op", () => {
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1", "running")], ledger: {} })
    expect(plan.pairs).toEqual([])
    expect(plan.skipped).toEqual([{ taskId: "t1", subject: "task t1", reason: "no idle member is free" }])
  })

  test("a blocked task waits and says what blocks it; a completed one is skipped", () => {
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
    const plan = planDispatch({ tasks: [task("t1")], members: [member("m1")], ledger: {}, hold: "waiting for the user" })
    expect(plan.pairs).toEqual([])
    expect(plan.halted).toBe("waiting for the user")
    expect(plan.skipped).toEqual([])
  })

  test("the limit caps one pass and reports the rest as capped", () => {
    const plan = planDispatch({ tasks: [task("t1"), task("t2")], members: [member("m1"), member("m2")], ledger: {}, limit: 1 })
    expect(plan.pairs).toHaveLength(1)
    expect(plan.skipped[0].reason).toBe("the pass reached its limit")
  })
})

describe("the ledger", () => {
  test("assign returns a NEW ledger and never mutates the old one", () => {
    const before: DispatchLedger = {}
    const after = assign(before, { taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    expect(Object.keys(before)).toEqual([])
    expect(after.t1.memberName).toBe("one")
    expect(after.t1.assignedAt).toBe(NOW.toISOString())
  })

  test("release frees a pairing and reports whether there was one", () => {
    const ledger = assign({}, { taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    const freed = release(ledger, "t1")
    expect(freed.released).toBe(true)
    expect(Object.keys(freed.ledger)).toEqual([])
    expect(release(ledger, "nope").released).toBe(false)
  })

  test("RECONCILE forgets a task that was deleted or completed out of band — a member must not stay busy forever", () => {
    let ledger = assign({}, { taskId: "t1", memberId: "m1", memberName: "one" }, NOW)
    ledger = assign(ledger, { taskId: "t2", memberId: "m2", memberName: "two" }, NOW)
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
    const text = dispatchMessage({ id: "t4", subject: "wire the gate", status: "pending", ready: true }, "acceptance: the gate is wired")
    expect(text).toContain("shared task t4: wire the gate")
    expect(text).toContain("acceptance: the gate is wired")
    expect(text).toContain("team_task_update")
    expect(text).toContain("do not wait for another member")
  })
})
