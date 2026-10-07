// The board's TERMINAL VERBS and the OWNER-FIRST pairing rule — both measured defects of 2026-10-07.
//
// DEFECT 1 (terminal verbs): the mpd-native plane could open a plan, add members and create tasks, and
// then nothing could close a row, because the official `team_task_*` verbs are disabled in a dsh-tui boot.
// Every dependency edge therefore stayed unsatisfied and the DAG could not advance.
//
// DEFECT 2 (owner-first pairing): `planDispatch` paired POSITIONALLY and never read `DispatchTask.ownerName`,
// although the caller populates it from the task's own `owner`. Measured on the wave's live board: T1
// (declared owner Plan Reviewer) went to Architect and T2 (the reverse) — a review task landing on a
// writer, which is exactly the independence the verification law rests on.
import { describe, expect, test } from "bun:test"

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { addTeamTask, addTeamMember, casCloseTask, createTeam, taskVisual, updateTeamTask } from "../src/team-store.ts"
import type { TeamRecord } from "../src/team-store.ts"
import { assign, dispatchNameKey, planDispatch } from "../src/dispatch.ts"
import type { DispatchMember, DispatchTask } from "../src/dispatch.ts"
import { normalizeTeamMemberKey } from "../../mpd-roles-plugin/src/team-guard.ts"

/** The instant every arm stamps, so the fixtures are deterministic. */
const NOW = new Date("2026-10-07T12:00:00.000Z")

/** Every sandbox workspace this file created, removed in one pass at the end of the module. */
const cleanup: string[] = []
process.on("exit", () => { for (const dir of cleanup) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* already gone */ } } })

/** A team record with the given tasks and members, built through the real additive functions. */
function board(
  tasks: Array<{ subject: string; owner?: string; blockedBy?: string[]; kind?: "work" | "review" | "integration" }>,
  memberNames: string[] = [],
): TeamRecord {
  // A SANDBOX workspace per board: `createTeam` is the real constructor and it persists, so the fixtures
  // never touch the repository's own `.mpd/` (AGENTS.md §7's third isolation rule).
  /** The throwaway workspace this board is created in. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-board-"))
  /** The empty record a fresh team starts from. */
  let record = createTeam(workspace, { name: "wave", description: "a board for the tests", leadSessionId: "lead-session" }, NOW)
  for (const name of memberNames) record = addTeamMember(record, { name, description: "" }, NOW)
  for (const task of tasks) {
    record = addTeamTask(record, {
      subject: task.subject,
      description: "acceptance",
      ...(task.owner === undefined ? {} : { owner: task.owner }),
      ...(task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy }),
      ...(task.kind === undefined ? {} : { kind: task.kind }),
    }, NOW)
  }
  cleanup.push(workspace)
  return record
}

describe("owner-first dispatch", () => {
  test("a declared owner is PREFERRED over roster order", () => {
    /** The board: a task owned by the SECOND member, whose declared owner must win. */
    const plan = planDispatch({
      tasks: [{ id: "T1", subject: "review the lane", status: "pending", ready: true, ownerName: "Reviewer" }],
      members: [{ id: "m1", name: "Architect", status: "inactive" }, { id: "m2", name: "Reviewer", status: "inactive" }],
      ledger: {},
    })
    expect(plan.pairs.map((pair) => pair.memberName)).toEqual(["Reviewer"])
    // No fallback note: this pairing is exactly what the board declared.
    expect(plan.pairs[0].note).toBeUndefined()
  })
  test("the order is preserved when NO owner is declared (the positional rule still holds)", () => {
    /** The dispatch plan this arm asserts on. */
    const plan = planDispatch({
      tasks: [{ id: "T1", subject: "x", status: "pending", ready: true }, { id: "T2", subject: "y", status: "pending", ready: true }],
      members: [{ id: "m1", name: "Architect", status: "inactive" }, { id: "m2", name: "Reviewer", status: "inactive" }],
      ledger: {},
    })
    expect(plan.pairs.map((pair) => pair.memberName)).toEqual(["Architect", "Reviewer"])
  })
  test("a BUSY owner falls back positionally AND the fallback is reported, never silent", () => {
    /** The owner is already working another task, so its id is in the ledger as busy. */
    const ledger = assign({}, { taskId: "T0", memberId: "m2", memberName: "Reviewer" }, NOW)
    /** The dispatch plan this arm asserts on. */
    const plan = planDispatch({
      tasks: [{ id: "T1", subject: "review the lane", status: "pending", ready: true, ownerName: "Reviewer" }],
      members: [{ id: "m1", name: "Architect", status: "inactive" }, { id: "m2", name: "Reviewer", status: "inactive" }],
      ledger,
    })
    expect(plan.pairs.map((pair) => pair.memberName)).toEqual(["Architect"])
    expect(plan.pairs[0].note).toContain("already working another task")
    expect(plan.pairs[0].note).toContain("Reviewer")
  })
  test("an ABSENT owner falls back and says so", () => {
    /** The dispatch plan this arm asserts on. */
    const plan = planDispatch({
      tasks: [{ id: "T1", subject: "review the lane", status: "pending", ready: true, ownerName: "Vision Analyst" }],
      members: [{ id: "m1", name: "Architect", status: "inactive" }],
      ledger: {},
    })
    expect(plan.pairs[0].memberName).toBe("Architect")
    expect(plan.pairs[0].note).toContain("is not on this team's roster")
  })
  test("the owner spelling collapses like the roster's own key", () => {
    // The board stores a DISPLAY name while a caller may spell it any way; the two must agree.
    for (const spelling of ["Plan Reviewer", "plan reviewer", "plan-reviewer", " Plan_Reviewer "]) {
      /** The dispatch plan this arm asserts on. */
      const plan = planDispatch({
        tasks: [{ id: "T1", subject: "x", status: "pending", ready: true, ownerName: "Plan Reviewer" }],
        members: [{ id: "m1", name: "Architect", status: "inactive" }, { id: "m2", name: spelling, status: "inactive" }],
        ledger: {},
      })
      expect(plan.pairs[0].memberName).toBe(spelling)
    }
    // PINNED AGAINST THE ROSTER'S OWN NORMALISER, so a future edit to either one reddens here.
    for (const name of ["Plan Reviewer", "Deep Worker", "Explorer", "plan_reviewer", " Junior Engineer "]) {
      expect(dispatchNameKey(name)).toBe(normalizeTeamMemberKey(name))
    }
  })
})

describe("the terminal verbs", () => {
  test("the owner closes its row; a NON-owner is refused", () => {
    /** The board this arm works on. */
    const record = updateTeamTask(board([{ subject: "work" }], ["Senior Engineer", "Reviewer"]), "T1", { owner: "Senior Engineer", status: "in_progress" }, NOW)
    // A plain member that is not the owner: refused, with a sentence naming the owner.
    const refused = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Reviewer"], lead: false, now: NOW })
    expect(refused.applied).toBe(false)
    if (!refused.applied) {
      expect(refused.reason).toContain("Senior Engineer")
      expect(refused.reason).toContain("neither that owner nor this team's lead")
    }
    // The owner: applied, and the attempt counter is reported unchanged.
    const applied = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Senior Engineer"], lead: false, now: NOW })
    expect(applied.applied).toBe(true)
    if (applied.applied) {
      expect(applied.closedBy).toBe("owner")
      expect(applied.task.status).toBe("completed")
    }
  })
  test("a task with NO owner is refused: nobody has claimed the work", () => {
    /** The board this arm works on. */
    const record = board([{ subject: "work" }], ["Senior Engineer"])
    /** The decision under test, or its refusal. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Senior Engineer"], lead: false, now: NOW })
    expect(outcome.applied).toBe(false)
    if (!outcome.applied) expect(outcome.reason).toContain("no owner")
  })
  test("a STALE revision is refused rather than clobbering a concurrent write", () => {
    /** The board this arm works on. */
    const record = updateTeamTask(board([{ subject: "work" }], ["Senior Engineer"]), "T1", { owner: "Senior Engineer", status: "in_progress" }, NOW)
    /** The task the arm names. */
    const task = record.tasks[0]
    /** The compare-and-set refusal for a revision that has moved on. */
    const stale = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Senior Engineer"], lead: false, expectedRevision: task.revision - 1, now: NOW })
    expect(stale.applied).toBe(false)
    if (!stale.applied) expect(stale.reason).toContain("changed under you")
    // The CURRENT revision is accepted — the other direction.
    const fresh = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Senior Engineer"], lead: false, expectedRevision: task.revision, now: NOW })
    expect(fresh.applied).toBe(true)
  })
  test("a terminal row cannot be closed twice", () => {
    /** The board this arm works on. */
    const record = updateTeamTask(board([{ subject: "work" }], ["Senior Engineer"]), "T1", { owner: "Senior Engineer", status: "completed" }, NOW)
    /** The decision under test, or its refusal. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "failed", caller: ["Senior Engineer"], lead: false, now: NOW })
    expect(outcome.applied).toBe(false)
    if (!outcome.applied) expect(outcome.reason).toContain("already terminal")
  })
  test("the attempt counter is MONOTONIC across claims and closures", () => {
    /** The board this arm works on. */
    let record = board([{ subject: "work" }], ["Senior Engineer"])
    record = updateTeamTask(record, "T1", { owner: "Senior Engineer", status: "in_progress", attempt: 1 }, NOW)
    record = updateTeamTask(record, "T1", { status: "pending" }, NOW)
    record = updateTeamTask(record, "T1", { status: "in_progress", attempt: 2 }, NOW)
    /** The closed this arm uses. */
    const closed = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Senior Engineer"], lead: false, note: "done", now: NOW })
    expect(closed.applied).toBe(true)
    if (closed.applied) {
      expect(closed.attempt).toBe(2)
      expect(closed.task.note).toBe("done")
      expect(closed.status).toBe("completed")
    }
  })
  test("COMPLETING a row makes its dependent READY — the DAG can advance again", () => {
    /** A board where T2 is blocked by T1, owned by the same member. */
    let record = board([{ subject: "the blocker" }, { subject: "the dependent", owner: "Senior Engineer", blockedBy: ["T1"] }], ["Senior Engineer"])
    record = updateTeamTask(record, "T1", { owner: "Senior Engineer", status: "in_progress" }, NOW)
    // While T1 is open, T2 is BLOCKED and cannot be dispatched.
    expect(taskVisual(record.tasks[1], record.tasks)).toBe("blocked")
    /** The decision under test, or its refusal. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["Senior Engineer"], lead: false, now: NOW })
    expect(outcome.applied).toBe(true)
    if (outcome.applied) {
      expect(outcome.dependents.map((row) => [row.id, row.became])).toEqual([["T2", "ready"]])
      expect(taskVisual(outcome.record.tasks[1], outcome.record.tasks)).toBe("open")
      // AND THE DISPATCH PASS REALLY PAIRS IT, which is the whole point of the terminal verb.
      const plan = planDispatch({
        tasks: outcome.record.tasks.map((task) => ({ id: task.id, subject: task.subject, status: task.status, ready: taskVisual(task, outcome.record.tasks) === "open", ...(task.owner === undefined ? {} : { ownerName: task.owner }) })) as DispatchTask[],
        members: [{ id: "m1", name: "Senior Engineer", status: "inactive" }] as DispatchMember[],
        ledger: {},
      })
      expect(plan.pairs.map((pair) => pair.taskId)).toEqual(["T2"])
    }
  })
  test("FAILING a row RELEASES its dependent (OPT-1) and reports the release", () => {
    /** The board this arm works on. */
    let record = board([{ subject: "the blocker" }, { subject: "the dependent", owner: "Senior Engineer", blockedBy: ["T1"] }], ["Senior Engineer"])
    record = updateTeamTask(record, "T1", { owner: "Senior Engineer", status: "in_progress" }, NOW)
    /** The decision under test, or its refusal. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "failed", caller: ["Senior Engineer"], lead: false, note: "the upstream lane is broken", now: NOW })
    expect(outcome.applied).toBe(true)
    if (outcome.applied) {
      expect(outcome.dependents.map((row) => [row.id, row.became])).toEqual([["T2", "released-by-failure"]])
      // OPT-1: a FAILED blocker does NOT pin its dependents — the task stays dispatchable.
      expect(taskVisual(outcome.record.tasks[1], outcome.record.tasks)).toBe("open")
    }
  })
  test("the LEAD override closes a stranded row, and SAYS it was the lead", () => {
    /** The board this arm works on. */
    const record = updateTeamTask(board([{ subject: "work" }], ["Senior Engineer"]), "T1", { owner: "a member who is gone", status: "in_progress" }, NOW)
    /** The decision under test, or its refusal. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "failed", caller: ["lead-session"], lead: true, now: NOW })
    expect(outcome.applied).toBe(true)
    if (outcome.applied) expect(outcome.closedBy).toBe("lead")
  })
})
