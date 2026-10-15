// THE C7 DISPATCH/LIFECYCLE GUARDS — the unit arms beside the guard code, at the function level.
//
// The plan amendment (tui-015-adaptation, C7, 2026-10-14) fixes three MEASURED defects with hard gates.
// These four assertions are the function-level half (the `team-dispatch-guard` QA case is the other):
//
//   (a) a task×member pairing across DIFFERENT teams is refused, naming BOTH team ids;
//   (b) a task with non-empty write scopes is never paired with a read-only specialist, and when every
//       free member is refused the reason is REPORTED instead of a wrong-but-free member being grabbed;
//   (c) resolution SKIPS a terminal/archived team (and a team whose plan was archived without approval),
//       falling through to the next candidate or to none, and the consistency pass marks it terminal;
//   (d) THE NEGATIVE CONTROL — a valid same-team, write-capable pairing still succeeds. The gate must not
//       over-block, so this arm is as load-bearing as the three refusals.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isReadonlyMemberName, pairingRefusal, planDispatch, readonlyMemberKeys, type DispatchMember, type DispatchTask } from "../src/dispatch"
import { isLiveTeam, isLiveTeamPhase, readArchivedPlanIndex, reapReapedTeams, resolveTeamRecord, type ArchivedPlanIndex } from "../src/team-lifecycle"
import { readTeam, writeTeam, type TeamPhase, type TeamRecord } from "../src/team-store"
import { ROLES } from "../../mpd-roles-plugin/src/roles.data"

/** A board task for the guard arms; only the fields a guard reads are varied. */
function task(id: string, over: Partial<DispatchTask> = {}): DispatchTask {
  return { id, subject: "task " + id, status: "pending", ready: true, ...over }
}

/** An idle roster member for the guard arms; only the fields a guard reads are varied. */
function member(id: string, name: string, over: Partial<DispatchMember> = {}): DispatchMember {
  return { id, name, status: "inactive", ...over }
}

/** A minimal team record; every field the lifecycle rules do not read keeps a fixed value. */
function record(over: Partial<TeamRecord> & { teamId: string }): TeamRecord {
  return {
    version: 1,
    name: "wave",
    description: "why",
    leadSessionId: "lead-1",
    phase: "active",
    createdAt: "2026-10-14T00:00:00.000Z",
    members: [],
    tasks: [],
    nextMemberNumber: 1,
    nextTaskNumber: 1,
    ...over,
  }
}

/** An archive index that carries no evidence, for the arms that do not exercise the archive arm. */
const EMPTY_INDEX: ArchivedPlanIndex = { approved: new Set<string>(), unapproved: new Set<string>() }

describe("C7-1 — a pairing may not cross teams", () => {
  test("(a) a task and a member from DIFFERENT teams are refused, naming BOTH team ids", () => {
    /** The task of team-a and the only free member, which belongs to team-b. */
    const plan = planDispatch({
      tasks: [task("T1", { teamId: "team-a" })],
      members: [member("m-foreign", "qa-reader-writer", { teamId: "team-b" })],
      ledger: {},
    })
    expect(plan.pairs).toEqual([])
    /** The one skip sentence; it must name the task's team AND the member's team. */
    const reason = plan.skipped[0]?.reason ?? ""
    expect(reason).toContain("CROSS-TEAM")
    expect(reason).toContain("team-a")
    expect(reason).toContain("team-b")
    expect(reason).toContain("qa-reader-writer")
  })

  test("(a2) the pure refusal function names both ids, and stays fail-open when a team id is undeclared", () => {
    expect(pairingRefusal(task("T1", { teamId: "team-a" }), member("m", "x", { teamId: "team-b" }))).toContain("team-a")
    expect(pairingRefusal(task("T1", { teamId: "team-a" }), member("m", "x", { teamId: "team-b" }))).toContain("team-b")
    // Fail-open: an undeclared team on EITHER side is not a reason to refuse (the pre-guard behaviour).
    expect(pairingRefusal(task("T1"), member("m", "x", { teamId: "team-b" }))).toBeUndefined()
    expect(pairingRefusal(task("T1", { teamId: "team-a" }), member("m", "x"))).toBeUndefined()
  })
})

describe("C7-2 — a write task is never paired with a read-only specialist", () => {
  test("(b) the write task is refused the read-only member, and the reason is REPORTED", () => {
    /** The measured incident: a task with write scopes, and Plan Reviewer as the only free member. */
    const plan = planDispatch({
      tasks: [task("T5", { teamId: "team-a", writeScopes: ["packages/mpd-team-core-plugin/src"] })],
      members: [member("m-ro", "Plan Reviewer", { teamId: "team-a", readonly: true })],
      ledger: {},
    })
    expect(plan.pairs).toEqual([])
    /** The reported refusal, which must name the pairing's two sides. */
    const reason = plan.skipped[0]?.reason ?? ""
    expect(reason).toContain("WRITE-TASK-ON-READ-ONLY")
    expect(reason).toContain("T5")
    expect(reason).toContain("Plan Reviewer")
    expect(reason).toContain("write scopes")
  })

  test("(b2) a refused member is skipped while an ELIGIBLE one is still paired — no wrong-but-free grab", () => {
    /** A read-only member first in roster order, and a worker second: the worker must take the task. */
    const plan = planDispatch({
      tasks: [task("T6", { writeScopes: ["src/"] })],
      members: [
        member("m-ro", "Explorer", { readonly: true }),
        member("m-w", "Deep Worker", { readonly: false }),
      ],
      ledger: {},
    })
    expect(plan.pairs.map((pair) => [pair.taskId, pair.memberId])).toEqual([["T6", "m-w"]])
    expect(plan.skipped).toEqual([])
  })

  test("(b3) the read-only classification is the ROSTER's, not a local copy (C7-2 source)", () => {
    /** The roster rows EXACTLY as mpd-roles-plugin's own service publishes them. */
    const rows = ROLES.map((role) => ({ name: role.name, readonly: role.readonly }))
    /** The read-only key set the dispatch tool builds from that service, per call. */
    const keys = readonlyMemberKeys(rows)
    expect(isReadonlyMemberName("Plan Reviewer", keys)).toBe(true)
    expect(isReadonlyMemberName("plan-reviewer", keys)).toBe(true)
    expect(isReadonlyMemberName("explorer-2", keys)).toBe(true)
    expect(isReadonlyMemberName("Deep Worker", keys)).toBe(false)
    expect(isReadonlyMemberName("Senior Engineer", keys)).toBe(false)
    expect(isReadonlyMemberName("", keys)).toBe(false)
    // The classification IS the roster's own flag, for every member — the anti-drift assertion.
    for (const role of ROLES) expect(isReadonlyMemberName(role.name, keys)).toBe(role.readonly)
  })
})

describe("C7-3 — resolution skips a terminal/archived team", () => {
  test("a live phase is workable; the hand-patched `archived` spelling is not", () => {
    expect(isLiveTeamPhase("staged")).toBe(true)
    expect(isLiveTeamPhase("active")).toBe(true)
    expect(isLiveTeamPhase("idle")).toBe(true)
    expect(isLiveTeamPhase("ended")).toBe(false)
    expect(isLiveTeamPhase("archived")).toBe(false)
  })

  test("(c) the arms skip the ghost and fall through to the live team, or to none", () => {
    /** The reaped conference-phase team: hand-patched terminal, yet the newest record for this lead. */
    const ghost = record({ teamId: "team-ghost", phase: "archived" as TeamPhase, leadSessionId: "lead-1", createdAt: "2026-10-14T02:00:00.000Z" })
    /** The live team the same lead now works in. */
    const live = record({ teamId: "team-live", phase: "active", leadSessionId: "lead-1", createdAt: "2026-10-14T01:00:00.000Z" })
    /** Newest first, exactly as `listTeams` orders them: the ghost would win arm 2 without the skip. */
    expect(resolveTeamRecord({ teams: [ghost, live], sessionId: "lead-1", index: EMPTY_INDEX }).record?.teamId).toBe("team-live")
    // The BOUND ghost (the session→team index's fast path) also falls through.
    expect(resolveTeamRecord({ bound: ghost, teams: [ghost, live], sessionId: "lead-1", index: EMPTY_INDEX }).record?.teamId).toBe("team-live")
    // With only the ghost present, NOTHING resolves — never the ghost.
    expect(resolveTeamRecord({ teams: [ghost], sessionId: "lead-1", index: EMPTY_INDEX }).record).toBeUndefined()
  })

  test("(c2) the ARCHIVE arm and the consistency pass mark a reaped record terminal, with a reason", () => {
    /** The temp workspace whose team store and archive the arm drives. */
    const ws = mkdtempSync(join(tmpdir(), "mpd-c7-reap-"))
    try {
      /** The ghost: its phase still reads live, but its OWN plan was archived WITHOUT approval. */
      writeTeam(ws, record({ teamId: "team-ghost", name: "wave-x", leadSessionId: "lead-x", phase: "active", planId: "plan-1" }))
      /** The LIVE control: its plan was archived WITH approval — the normal state of an approved team. */
      writeTeam(ws, record({ teamId: "team-live", name: "wave-y", leadSessionId: "lead-y", phase: "active", planId: "plan-2" }))
      /** A second ghost whose phase is the hand-patched, non-schema `archived` spelling. */
      writeTeam(ws, record({ teamId: "team-phase", name: "wave-z", leadSessionId: "lead-z", phase: "archived" as TeamPhase }))
      mkdirSync(join(ws, ".mpd", "team", "archive", "plan-1"), { recursive: true })
      writeFileSync(join(ws, ".mpd", "team", "archive", "plan-1", "plan.json"), JSON.stringify({ version: 1, planId: "plan-1", sessionId: "lead-x", name: "wave-x" }))
      mkdirSync(join(ws, ".mpd", "team", "archive", "plan-2"), { recursive: true })
      writeFileSync(join(ws, ".mpd", "team", "archive", "plan-2", "plan.json"), JSON.stringify({ version: 1, planId: "plan-2", sessionId: "lead-y", name: "wave-y", approvedAt: "2026-10-14T00:00:00.000Z" }))
      /** The archive index the rules read from the two planted plans. */
      const index = readArchivedPlanIndex(ws)
      expect(isLiveTeam(readTeam(ws, "team-ghost")!, index)).toBe(false)
      expect(isLiveTeam(readTeam(ws, "team-live")!, index)).toBe(true)
      expect(isLiveTeam(readTeam(ws, "team-phase")!, index)).toBe(false)
      /** The ids the consistency pass marked terminal. */
      const reaped = reapReapedTeams(ws, new Date("2026-10-14T10:00:00.000Z"))
      expect(reaped.sort()).toEqual(["team-ghost", "team-phase"])
      /** The repaired ghost: terminal, stamped, and told WHY. */
      const ghost = readTeam(ws, "team-ghost")!
      expect(ghost.phase).toBe("ended")
      expect(ghost.endedAt).toBe("2026-10-14T10:00:00.000Z")
      expect(ghost.archivedReason).toContain("archived without approval")
      /** The phase ghost: repaired by the phase rule, naming the offending spelling. */
      expect(readTeam(ws, "team-phase")!.archivedReason).toContain("not a live team phase")
      /** THE NEGATIVE CONTROL for the archive arm: the approved team is left byte-identical. */
      expect(readTeam(ws, "team-live")).toEqual(record({ teamId: "team-live", name: "wave-y", leadSessionId: "lead-y", phase: "active", planId: "plan-2" }))
      // And a second pass is a no-op: an already-terminal record is not rewritten again.
      expect(reapReapedTeams(ws, new Date("2026-10-14T11:00:00.000Z"))).toEqual([])
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })
})

describe("(d) THE NEGATIVE CONTROL — a valid pairing must still succeed", () => {
  test("a same-team, write-capable member is paired exactly as before the guards existed", () => {
    /** A write task and a write-capable member of the SAME team: the gate must not over-block. */
    const plan = planDispatch({
      tasks: [task("T2", { teamId: "team-a", writeScopes: ["packages/mpd-team-core-plugin/src"] })],
      members: [member("m-w", "Senior Engineer", { teamId: "team-a", readonly: false })],
      ledger: {},
    })
    expect(plan.pairs.map((pair) => [pair.taskId, pair.memberId])).toEqual([["T2", "m-w"]])
    expect(plan.skipped).toEqual([])
    expect(pairingRefusal(task("T2", { teamId: "team-a", writeScopes: ["src/"] }), member("m-w", "Senior Engineer", { teamId: "team-a", readonly: false }))).toBeUndefined()
  })

  test("an UNTAGGED board and roster keep the pre-guard behaviour exactly (no teamId, no readonly)", () => {
    /** The legacy shape: neither side declares a team or a read-only flag. */
    const plan = planDispatch({ tasks: [task("t1"), task("t2")], members: [member("m1", "member m1"), member("m2", "member m2")], ledger: {} })
    expect(plan.pairs.map((pair) => [pair.taskId, pair.memberId])).toEqual([["t1", "m1"], ["t2", "m2"]])
    expect(plan.skipped).toEqual([])
  })
})
