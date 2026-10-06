// THE DATA PLANE'S REPORT OF A BLOCKER THAT NAMES NOTHING (R21, defect 2026-10-06).
//
// WHAT WENT WRONG, in one sentence: a staged plan wrote its blockers as the plan's own POSITIONS
// (`["2"]`, `["7","8","9"]`), the record accepted every one of them, no reader could resolve them,
// and the whole dependency DAG flattened to a single column — with no warning at the moment the plan
// was written, at the moment it was approved, or anywhere afterwards.
//
// This file pins the three places the fact now lives, in the order a captain meets them:
//   1. WRITE TIME   — `classifyBlocker` reads each reference against the plan as written, so the
//                     `create_task` answer can say what will resolve and what names nothing yet;
//   2. ACCEPTANCE   — `resolveBlockers` splits the references, `addTeamTask` stores the unresolved
//                     half BESIDE `blockedBy`, and `updateTeamTask` keeps that report in step;
//   3. THE RECORD   — a reader can tell "no blockers" from "blockers that did not resolve", which is
//                     the distinction whose absence made the collapse invisible.
//
// The end-to-end arms (approval resolving positions, and the approval answer naming what it could not
// resolve) live in `team-record.test.ts`, beside the harness that drives the real tools.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addTeamTask, createTeam, resolveBlockers, taskDepths, updateTeamTask, type TeamRecord } from "../src/team-store"
import { addTask, classifyBlocker, type StagedPlan } from "../src/plan-store"

/** Every sandbox one arm created, removed even when the arm fails. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * A fresh record in a throwaway sandbox.
 * @returns the record and the workspace it was written into.
 */
function record(): { record: TeamRecord; workspace: string } {
  /** The sandbox workspace the record is bound to. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-blocker-report-"))
  sandboxes.push(workspace)
  return { record: createTeam(workspace, { name: "wave", description: "d", leadSessionId: "sess-1" }, new Date()), workspace }
}

/**
 * A staged plan with the given subjects, in order — no members, since these arms are about the board.
 *
 * The plan is assembled as PLAIN DATA, the way `stagePlan` persists one, so no sandbox is needed for a
 * reading that is a pure function of the document.
 * @param subjects - the subjects to stage, in order.
 * @returns the staged plan.
 */
function planOf(subjects: readonly string[]): StagedPlan {
  /** The plan as `agent_teams_plan {action:"create"}` stages it. */
  let plan: StagedPlan = {
    version: 1,
    planId: "plan-1",
    sessionId: "sess-1",
    name: "wave",
    description: "d",
    approval: "required",
    members: [],
    tasks: [],
    stagedAt: "2026-10-06T00:00:00.000Z",
  }
  for (const subject of subjects) plan = addTask(plan, { subject, description: "d" })
  return plan
}

describe("the split, at the point a reference is accepted", () => {
  test("an id and a subject resolve; a bare position does not — and the position is REPORTED", () => {
    /** The record, with one task whose subject a later reference can match. */
    const { record: base } = record()
    /** The board after one task. */
    const one = addTeamTask(base, { subject: "core", description: "d" }, new Date())
    /** What a mixed reference list splits into. */
    const split = resolveBlockers(one, ["T1", "core", "2", "the review task"])
    // The two resolvable spellings both land on T1 — the id verbatim, the subject through its match.
    expect(split.blockedBy).toEqual(["T1", "T1", "2", "the review task"])
    // The two that name nothing are named, in the caller's order, exactly as written.
    expect(split.unresolved).toEqual(["2", "the review task"])
  })

  test("an empty list splits into nothing on either side — not into one empty report", () => {
    /** A record with no tasks at all. */
    const { record: base } = record()
    expect(resolveBlockers(base, [])).toEqual({ blockedBy: [], unresolved: [] })
  })

  test("a repeated dangling reference is reported ONCE, so a typo does not read as two problems", () => {
    /** A record with no tasks. */
    const { record: base } = record()
    expect(resolveBlockers(base, ["ghost", "ghost"]).unresolved).toEqual(["ghost"])
    // The STORED list still carries the caller's text twice: deduplication is a reporting rule, never
    // a rewrite of what they wrote.
    expect(resolveBlockers(base, ["ghost", "ghost"]).blockedBy).toEqual(["ghost", "ghost"])
  })
})

describe("the record carries the report beside the references", () => {
  test("a dangling reference is stored verbatim AND named in unresolvedBlockers", () => {
    /** A record with no tasks. */
    const { record: base } = record()
    /** The board after one task blocked by a plan position. */
    const next = addTeamTask(base, { subject: "review", description: "d", blockedBy: ["2"] }, new Date())
    expect(next.tasks[0].blockedBy).toEqual(["2"])
    expect(next.tasks[0].unresolvedBlockers).toEqual(["2"])
  })

  test("a resolved reference leaves NO unresolvedBlockers key at all (absent, not empty)", () => {
    /** A record with one task a later task can be blocked by. */
    const { record: base } = record()
    /** The board after the dependency is expressed by SUBJECT. */
    const next = addTeamTask(addTeamTask(base, { subject: "core", description: "d" }, new Date()), { subject: "review", description: "d", blockedBy: ["core"] }, new Date())
    expect(next.tasks[1].blockedBy).toEqual(["T1"])
    // THE DISTINCTION THE DEFECT NEEDED: absent means "every blocker resolved", and a reader that only
    // filters `blockedBy` would otherwise see this task and the one above as the same empty edge set.
    expect("unresolvedBlockers" in next.tasks[1]).toBe(false)
    expect("unresolvedBlockers" in next.tasks[0]).toBe(false)
  })

  test("re-editing the blockers keeps the report in step: it clears when they resolve, and returns", () => {
    /** A board with one resolvable task and one task whose blocker is a plan position. */
    const { record: base } = record()
    /** The board before the repair. */
    const before = addTeamTask(addTeamTask(base, { subject: "core", description: "d" }, new Date()), { subject: "review", description: "d", blockedBy: ["2"] }, new Date())
    expect(before.tasks[1].unresolvedBlockers).toEqual(["2"])
    /** The same board after the reference is corrected to the task's subject. */
    const repaired = updateTeamTask(before, "T2", { blockedBy: ["core"] }, new Date())
    expect(repaired.tasks[1].blockedBy).toEqual(["T1"])
    expect("unresolvedBlockers" in repaired.tasks[1]).toBe(false)
    /** And the report comes BACK when an edit re-introduces a dangling reference. */
    const rebroken = updateTeamTask(repaired, "T2", { blockedBy: ["gone"] }, new Date())
    expect(rebroken.tasks[1].unresolvedBlockers).toEqual(["gone"])
  })

  test("the rank the graph draws is UNCHANGED: a dangling reference cannot invent a rank", () => {
    // The report explains the flat board; it must never become a reason to draw one. `taskDepths` still
    // derives from resolvable edges only, so the honest picture stays honest.
    /** A board whose only reference names nothing. */
    const { record: base } = record()
    /** That board: task `b` is blocked by text no task carries, so nothing resolves. */
    const board = addTeamTask(addTeamTask(base, { subject: "a", description: "d" }, new Date()), { subject: "b", description: "d", blockedBy: ["a-position-mistake"] }, new Date())
    expect(board.tasks[1].unresolvedBlockers).toEqual(["a-position-mistake"])
    expect(taskDepths(board.tasks).get("T1")).toBe(0)
    expect(taskDepths(board.tasks).get("T2")).toBe(0)
  })
})

describe("the write-time reading", () => {
  test("reads the four forms: a board id, a position, a staged subject, and text that names nothing", () => {
    /** A plan with one staged task, whose subject the fourth reference will NOT match. */
    const plan = planOf(["core review"])
    expect(classifyBlocker(plan, "T2")).toBe("board-id")
    expect(classifyBlocker(plan, "2")).toBe("position")
    expect(classifyBlocker(plan, "core review")).toBe("subject")
    expect(classifyBlocker(plan, "the review task")).toBe("unknown")
  })

  test("a FORWARD position reads as a position, never as a problem — the plan is written in order", () => {
    // The reading is advisory on purpose: `3` written on task 1 is legitimate, because task 3 is
    // simply not staged yet. Refusing it would be the redesign this fix deliberately avoids.
    /** A one-task plan; the reference points at a task that does not exist yet. */
    const plan = planOf(["first"])
    expect(classifyBlocker(plan, "3")).toBe("position")
  })
})
