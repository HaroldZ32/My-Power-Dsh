// The mpd-owned team record is pure filesystem + plain data, so the whole lifecycle is driven here
// without a ctx, a harness or a model. The arms are chosen to be the ones that MATTER for the
// separation: that the record — not the official plane — holds the roster, the board, the review
// fields and the dependency edges; that ids are minted locally and never reused; that a
// `blocked` state is DERIVED and cannot be stored wrong; and that a malformed board (a cycle) is
// reported instead of hanging a render.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activeTeamId,
  addTeamMember,
  addTeamTask,
  bindActiveTeam,
  blockingDependencies,
  casClaimTask,
  createTeam,
  cycleIds,
  deleteTeam,
  derivePhase,
  idleMembers,
  listTeams,
  memberProgress,
  readTeam,
  readTeamsIndex,
  readyTasks,
  sanitizeId,
  summariseTeam,
  taskDepths,
  taskVisual,
  teamRecordPath,
  teamsDir,
  unbindActiveTeam,
  updateTeamMember,
  updateTeamTask,
  withDerivedPhase,
  writeTeam,
  type TeamRecord,
} from "../src/team-store"

/** Per-test sandbox workspace, recreated by the hooks below so no state leaks between arms. */
let sandbox = ""
/** The frozen clock every stored timestamp in this file is derived from. */
const NOW = new Date("2026-09-30T09:15:00.000Z")
/** A later frozen instant, for the arms that must show a mutation moved nothing else. */
const LATER = new Date("2026-09-30T11:45:00.000Z")

beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), "mpd-team-core-")) })
afterEach(() => { rmSync(sandbox, { recursive: true, force: true }) })

/** A team with one member and a two-task chain, which most arms below build on. */
function seeded(): TeamRecord {
  /** The freshly created record. */
  let record = createTeam(sandbox, { name: "wave-3", description: "split the team plane", leadSessionId: "sess-1" }, NOW)
  record = addTeamMember(record, { name: "Senior Engineer", description: "implements", role: "Senior Engineer" }, NOW)
  record = addTeamMember(record, { name: "Reviewer", description: "judges", role: "Reviewer" }, NOW)
  record = addTeamTask(record, { subject: "core", description: "own the record", kind: "requirement", owner: "Senior Engineer" }, NOW)
  record = addTeamTask(record, { subject: "review the core", description: "judge it", kind: "review", blockedBy: ["core"], owner: "Reviewer" }, NOW)
  writeTeam(sandbox, record)
  return record
}

describe("the team record", () => {
  test("creating a team writes one record and binds it ACTIVE for its Lead session", () => {
    /** The freshly created record. */
    const record = createTeam(sandbox, { name: "wave-3", description: "why", leadSessionId: "sess-1" }, NOW)
    expect(record.teamId).toBe("team-20260930091500")
    expect(record.phase).toBe("staged")
    expect(record.approvedAt).toBeUndefined()
    expect(existsSync(teamRecordPath(sandbox, record.teamId))).toBe(true)
    expect(activeTeamId(sandbox, "sess-1")).toBe(record.teamId)
    // A SECOND session in the same workspace is not dragged along by the first one's binding.
    expect(activeTeamId(sandbox, "sess-2")).toBeUndefined()
  })

  test("a record survives a reload byte-for-byte in meaning", () => {
    /** The record written by the fixture. */
    const record = seeded()
    /** The same record read back from disk. */
    const reread = readTeam(sandbox, record.teamId)
    expect(reread).toEqual(record)
    // The review fields the official board has NO field for are the point of owning the record.
    expect(reread?.tasks[1].blockedBy).toEqual(["T1"])
    expect(reread?.tasks.map((task) => task.kind)).toEqual(["requirement", "review"])
  })

  test("ids are minted locally, monotonically, and never reused after a removal", () => {
    /** The seeded record, whose ids must not depend on any executor. */
    const record = seeded()
    expect(record.members.map((member) => member.id)).toEqual(["M1", "M2"])
    expect(record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
    expect(record.nextTaskNumber).toBe(3)
    // A duplicate member is refused rather than renumbered, so a name stays a stable key.
    expect(addTeamMember(record, { name: "Reviewer", description: "again" }, NOW)).toBe(record)
    // An empty subject is refused for the same reason.
    expect(addTeamTask(record, { subject: "   ", description: "x" }, NOW)).toBe(record)
  })

  test("a blocker written as a SUBJECT resolves to the task id, which is how a plan writes it", () => {
    /** The seeded record, whose second task was blocked by the first task's SUBJECT. */
    const record = seeded()
    expect(record.tasks[1].blockedBy).toEqual(["T1"])
    // A blocker that matches nothing is kept verbatim rather than silently dropped: an unknown id
    // BLOCKS (see blockingDependencies), so dropping it would make a task look ready.
    expect(addTeamTask(record, { subject: "third", description: "x", blockedBy: ["T-ghost"] }, NOW).tasks[2].blockedBy).toEqual(["T-ghost"])
  })

  test("updating a task bumps its revision and nothing else's", () => {
    /** The seeded record. */
    const record = seeded()
    /** The record after one task moved to in_progress. */
    const next = updateTeamTask(record, "T1", { status: "in_progress", attempt: 2 }, LATER)
    expect(next.tasks[0].status).toBe("in_progress")
    expect(next.tasks[0].attempt).toBe(2)
    expect(next.tasks[0].revision).toBe(2)
    expect(next.tasks[0].updatedAt).toBe(LATER.toISOString())
    // The untouched task keeps both its revision and its update stamp.
    expect(next.tasks[1].revision).toBe(1)
    expect(next.tasks[1].updatedAt).toBe(NOW.toISOString())
    // An unknown id changes nothing at all (the same object, so a caller can cheaply detect it).
    expect(updateTeamTask(record, "T-ghost", { status: "completed" }, LATER)).toBe(record)
  })

  test("an empty owner string CLEARS the owner instead of storing a blank one", () => {
    /** The seeded record, whose first task is owned. */
    const record = seeded()
    /** The record after the owner was cleared. */
    const next = updateTeamTask(record, "T1", { owner: "" }, LATER)
    expect(next.tasks[0].owner).toBeUndefined()
    expect("owner" in next.tasks[0]).toBe(false)
  })

  test("a member is addressable by NAME as well as by id, because a tool caller has the name", () => {
    /** The seeded record. */
    const record = seeded()
    /** The record after the Reviewer was marked running, addressed by name. */
    const next = updateTeamMember(record, "Reviewer", { status: "running", executorRef: "sess-abc" })
    expect(next.members[1].status).toBe("running")
    expect(next.members[1].executorRef).toBe("sess-abc")
    expect(updateTeamMember(record, "Nobody", { status: "running" })).toBe(record)
  })
})

describe("the derived state", () => {
  test("phase follows the record: staged until approved, active only while something is in flight", () => {
    /** The seeded record, which has never been approved. */
    const staged = seeded()
    expect(derivePhase(staged)).toBe("staged")
    // Approval with nobody spawned yet IS activity: `provisioning` is a spawn in flight, and a
    // record that was never approved can never read as active however its members look.
    expect(derivePhase({ ...staged, approvedAt: NOW.toISOString() })).toBe("active")
    // Every member settled and nothing in flight: the team is idle, not finished.
    /** The board with both members explicitly idle. */
    const settled = { ...staged, approvedAt: NOW.toISOString(), members: staged.members.map((member) => ({ ...member, status: "inactive" as const })) }
    expect(derivePhase(settled)).toBe("idle")
    expect(derivePhase(withDerivedPhase(updateTeamMember(settled, "Reviewer", { status: "running" })))).toBe("active")
    // A task in flight is enough on its own, even with every member idle.
    expect(derivePhase({ ...settled, tasks: [{ ...settled.tasks[0], status: "in_progress" as const }, settled.tasks[1]] })).toBe("active")
    // An explicit end is sticky and outranks everything above.
    expect(derivePhase({ ...settled, endedAt: NOW.toISOString() })).toBe("ended")
  })

  test("`blocked` is DERIVED, and OPT-1 releases a task whose blocker FAILED — counted apart", () => {
    /** The seeded record, whose second task waits on the first. */
    const record = seeded()
    expect(taskVisual(record.tasks[1], record.tasks)).toBe("blocked")
    // Completing the blocker makes the dependent READY.
    /** The board with the blocker closed. */
    const closed = updateTeamTask(record, "T1", { status: "completed" }, LATER)
    expect(taskVisual(closed.tasks[1], closed.tasks)).toBe("open")
    // OPT-1 (USER DECISION 2026-09-13): a FAILED blocker does NOT block. The dependent stays open and
    // dispatchable, and the failure is reported BESIDE the state so a reader can decide. This arm
    // exists so a later "fix" that makes a failure block again reddens with the decision attached.
    /** The board with a failed blocker. */
    const broken = updateTeamTask(record, "T1", { status: "failed" }, LATER)
    expect(taskVisual(broken.tasks[1], broken.tasks)).toBe("open")
    expect(blockingDependencies(broken.tasks, broken.tasks[1].blockedBy)).toEqual({ blocking: [], failed: ["T1"] })
    // ...and the SUMMARY keeps it out of the plain `ready` count, so "N ready" can never hide that
    // some of those are only ready because a prerequisite gave up.
    /** The summary of the board with a failed blocker. */
    const summary = summariseTeam(broken)
    expect(summary.releasedByFailure).toBe(1)
    expect(summary.ready).toBe(0)
    expect(summary.blocked).toBe(0)
    // `failed` counts a failed TASK, which is what T1 now is — not "a task with a failed blocker".
    expect(summary.failed).toBe(1)
    // A CANCELLED blocker releases its dependents the same way, and is NOT a failure.
    /** The board with a cancelled blocker. */
    const cancelled = updateTeamTask(record, "T1", { status: "cancelled" }, LATER)
    expect(taskVisual(cancelled.tasks[1], cancelled.tasks)).toBe("open")
    expect(summariseTeam(cancelled).releasedByFailure).toBe(0)
    expect(summariseTeam(cancelled).ready).toBe(1)
  })

  test("the graph maths: rank is the longest blocker path, and a cycle is REPORTED not hung on", () => {
    /** The seeded chain, whose second task is one rank below the first. */
    const record = seeded()
    /** Depth per task id for the sound board. */
    const depths = taskDepths(record.tasks)
    expect(depths.get("T1")).toBe(0)
    expect(depths.get("T2")).toBe(1)
    expect(cycleIds(record.tasks)).toEqual([])
    // A cycle must terminate AND be named: T1 blocked by T2 while T2 is blocked by T1.
    /** The board with its two tasks blocking each other. */
    const cyclic = { ...record, tasks: [record.tasks[0], { ...record.tasks[1], blockedBy: ["T1"] }].map((task) => task.id === "T1" ? { ...task, blockedBy: ["T2"] } : task) }
    expect(cycleIds(cyclic.tasks)).toEqual(["T1", "T2"])
    expect(taskDepths(cyclic.tasks).size).toBe(2)
    expect(summariseTeam(cyclic).cycles).toEqual(["T1", "T2"])
  })

  test("the summary separates ready from blocked, and counts only REAL edges", () => {
    /** The seeded record. */
    const record = seeded()
    /** The summary of the untouched pair. */
    const before = summariseTeam(record)
    expect(before.total).toBe(2)
    expect(before.ready).toBe(1)
    expect(before.blocked).toBe(1)
    expect(before.links).toBe(1)
    // An unknown blocker id blocks but is NOT an edge: it points at no task on the board.
    /** The record with a dangling blocker appended. */
    const dangling = addTeamTask(record, { subject: "orphan", description: "x", blockedBy: ["T-ghost"] }, NOW)
    expect(summariseTeam(dangling).links).toBe(1)
    expect(summariseTeam(dangling).blocked).toBe(2)
  })

  test("dispatch reads the record: only unblocked pending tasks and unowned running members", () => {
    /** The record with both members running and the chain half done. */
    let record = seeded()
    record = updateTeamMember(record, "Senior Engineer", { status: "running" })
    record = updateTeamMember(record, "Reviewer", { status: "running" })
    // The requirement is owned but still pending, so nobody is busy yet.
    expect(idleMembers(record).map((member) => member.name)).toEqual(["Senior Engineer", "Reviewer"])
    expect(readyTasks(record).map((task) => task.id)).toEqual(["T1"])
    // Claiming it takes its owner out of the idle pool, and the review stays blocked.
    record = updateTeamTask(record, "T1", { status: "in_progress" }, LATER)
    expect(idleMembers(record).map((member) => member.name)).toEqual(["Reviewer"])
    expect(readyTasks(record).map((task) => task.id)).toEqual([])
  })

  test("member progress names the current task and counts what is done", () => {
    /** The seeded record. */
    const record = seeded()
    expect(memberProgress(record, "Senior Engineer")).toEqual({ done: 0, total: 1, current: "T1" })
    expect(memberProgress(record, "Reviewer")).toEqual({ done: 0, total: 1, current: "T2" })
    /** The board after the first task closed. */
    const closed = updateTeamTask(record, "T1", { status: "completed" }, LATER)
    expect(memberProgress(closed, "Senior Engineer")).toEqual({ done: 1, total: 1 })
    // A member that owns nothing is not an error, it is an empty row.
    expect(memberProgress(record, "Nobody")).toEqual({ done: 0, total: 0 })
  })
})

describe("the index and the files", () => {
  test("an unknown index version reads as EMPTY rather than throwing", () => {
    /** The index directory, which nothing else in this arm creates. */
    mkdirSync(join(sandbox, ".mpd", "team"), { recursive: true })
    /** A hand-written index from a future version. */
    writeFileSync(join(sandbox, ".mpd", "team", "teams.json"), JSON.stringify({ version: 99, active: { "sess-1": "team-x" } }))
    expect(readTeamsIndex(sandbox).active).toEqual({})
    expect(activeTeamId(sandbox, "sess-1")).toBeUndefined()
    // An index whose `active` is not an object is equally unusable, and equally non-fatal.
    writeFileSync(join(sandbox, ".mpd", "team", "teams.json"), JSON.stringify({ version: 1, active: [] }))
    expect(readTeamsIndex(sandbox).active).toEqual({})
  })

  test("a record whose version is unknown is not a record", () => {
    /** A record file from a future version. */
    const record = seeded()
    writeFileSync(teamRecordPath(sandbox, record.teamId), JSON.stringify({ ...record, version: 2 }))
    expect(readTeam(sandbox, record.teamId)).toBeUndefined()
    // A record missing its arrays is equally unusable: a reader must never see a half-record.
    writeFileSync(teamRecordPath(sandbox, record.teamId), JSON.stringify({ version: 1, teamId: record.teamId, createdAt: record.createdAt }))
    expect(readTeam(sandbox, record.teamId)).toBeUndefined()
  })

  test("an id can never escape .mpd/team, however it was written", () => {
    expect(sanitizeId("../../etc/passwd")).toBe("etc-passwd")
    expect(sanitizeId("a/b")).toBe("a-b")
    expect(sanitizeId("...")).toBe("unnamed")
    expect(sanitizeId("team-20260930091500")).toBe("team-20260930091500")
    // The path is built from the SANITIZED id, so a traversal id lands inside the teams directory.
    expect(teamRecordPath(sandbox, "../../etc/passwd").startsWith(teamsDir(sandbox))).toBe(true)
  })

  test("listing is newest first, and a team can be dropped", () => {
    /** The older team. */
    const first = createTeam(sandbox, { name: "one", description: "x", leadSessionId: "s1" }, NOW)
    /** The newer team, staged by a different session in the same workspace. */
    const second = createTeam(sandbox, { name: "two", description: "y", leadSessionId: "s2" }, LATER)
    expect(listTeams(sandbox).map((record) => record.teamId)).toEqual([second.teamId, first.teamId])
    expect(deleteTeam(sandbox, first.teamId)).toBe(true)
    expect(deleteTeam(sandbox, first.teamId)).toBe(false)
    expect(listTeams(sandbox).map((record) => record.teamId)).toEqual([second.teamId])
  })

  test("unbinding one session leaves every other binding alone", () => {
    /** Two sessions bound in one workspace. */
    bindActiveTeam(sandbox, "s1", "team-a")
    bindActiveTeam(sandbox, "s2", "team-b")
    expect(unbindActiveTeam(sandbox, "s1")).toBe(true)
    expect(unbindActiveTeam(sandbox, "s1")).toBe(false)
    expect(activeTeamId(sandbox, "s1")).toBeUndefined()
    expect(activeTeamId(sandbox, "s2")).toBe("team-b")
  })

  test("a sessionless surface is keyed `workspace`, never the empty string", () => {
    bindActiveTeam(sandbox, undefined, "team-a")
    expect(activeTeamId(sandbox, undefined)).toBe("team-a")
    expect(activeTeamId(sandbox, "")).toBe("team-a")
    expect(readTeamsIndex(sandbox).active).toEqual({ workspace: "team-a" })
  })
})

describe("the compare-and-set claim (T2)", () => {
  // The dispatch pass writes the record AFTER an `await executor().send(...)`, so another caller may
  // have written it in between. `casClaimTask` is the guard: it patches the record that is on disk
  // NOW and refuses when the task moved, so a lost update is REPORTED instead of silently reverted.
  /** A one-member, one-task team, written to the sandbox. */
  function board(): TeamRecord {
    /** The record as `agent_teams_plan approve` leaves it: one task, pending. */
    const record = addTeamTask(
      createTeam(sandbox, { name: "wave", description: "cas", leadSessionId: "s1" }, NOW),
      { subject: "core", description: "own it", kind: "work" },
      NOW,
    )
    writeTeam(sandbox, record)
    return record
  }

  test("the patch lands on the FRESH record, so a concurrent write to ANOTHER task survives", () => {
    /** The record the pass opened with. */
    const opened = board()
    /** The second task another caller adds while the pass is suspended. */
    const concurrent = addTeamTask(opened, { subject: "other", description: "added mid-pass", kind: "work" }, NOW)
    writeTeam(sandbox, concurrent)
    /** The revision the pass based its decision on. */
    const expected = opened.tasks[0].revision
    /** The claim applied against the fresh read. */
    const claimed = casClaimTask(readTeam(sandbox, opened.teamId)!, "T1", "Senior Engineer", expected, NOW)
    expect(claimed.applied).toBe(true)
    if (claimed.applied) {
      // The fresh record's OTHER task is still there: the patch did not come from the stale snapshot.
      expect(claimed.record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
      expect(claimed.record.tasks[0].owner).toBe("Senior Engineer")
      expect(claimed.record.tasks[0].status).toBe("in_progress")
    }
  })

  test("a task that MOVED is refused by name, and the reason carries both revisions", () => {
    /** The record the pass opened with. */
    const opened = board()
    /** The revision the pass based its decision on. */
    const expected = opened.tasks[0].revision
    // A concurrent CLAIM of the SAME task — the case a stale whole-file write used to erase.
    writeTeam(sandbox, updateTeamTask(opened, "T1", { owner: "Reviewer", status: "in_progress", attempt: 1 }, NOW))
    /** The refusal. */
    const claimed = casClaimTask(readTeam(sandbox, opened.teamId)!, "T1", "Senior Engineer", expected, NOW)
    expect(claimed.applied).toBe(false)
    if (!claimed.applied) expect(claimed.reason).toContain(`revision ${expected} -> ${expected + 1}`)
  })

  test("a task that is GONE, or no longer pending, is refused with its own sentence", () => {
    /** The record under test. */
    const opened = board()
    /** The revision the pass based its decision on. */
    const expected = opened.tasks[0].revision
    // Gone: the id is not on the fresh board at all.
    expect(casClaimTask(opened, "T9", "Senior Engineer", expected, NOW)).toEqual({ applied: false, reason: "task T9 is no longer on the board" })
    // Not pending: a concurrent COMPLETION (same revision as far as this call is told, which is why
    // the status is checked separately — the caller may be replaying against a stale expectation).
    /** The board with T1 completed. */
    const done: TeamRecord = { ...opened, tasks: [{ ...opened.tasks[0], status: "completed" }] }
    expect(casClaimTask(done, "T1", "Senior Engineer", expected, NOW)).toEqual({ applied: false, reason: 'task T1 is now "completed"' })
  })
})
