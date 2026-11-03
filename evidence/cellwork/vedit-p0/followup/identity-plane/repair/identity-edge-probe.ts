#!/usr/bin/env bun
// T16 edge probe — the two identity Nits from review B4, re-measured on the fixed narrowing.
//
// BEFORE (the reviewer's own probe, `../review-b4/07-identity-edge-probe.log`):
//   · a title containing the seat's ACTUAL stored name (`senior-engineer-1`) NAMED it — so the report's
//     "never the workmate slug" wording was wrong (N2);
//   · a roster holding BOTH `Reviewer` and `Plan Reviewer` made the Plan Reviewer's own title match both
//     roles → `named:true, member:undefined` — fail-closed, but that seat lost claim/complete/handoff/
//     context (N1).
// AFTER: the stored-name arm is the documented rule, and the LONGEST title match wins, so the Plan
// Reviewer is named while a genuine equal-length tie stays ambiguous.
//
// Exit code: 0 when every expectation holds; 1 with the failure list otherwise.
import { memberIdentityOf, type TeamMemberRecord, type TeamRecord } from "../../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/**
 * Build a minimal one-team record over the given roster.
 * @param members - the roster rows.
 * @returns the record.
 */
function recordOf(members: TeamMemberRecord[]): TeamRecord {
  return {
    version: 1, teamId: "team-probe", name: "probe", description: "probe", leadSessionId: "sess-lead",
    phase: "active", createdAt: "2026-11-03T00:00:00.000Z", members, tasks: [], nextMemberNumber: members.length + 1, nextTaskNumber: 1,
  }
}

/** The W3-C slug seat the reviewer built: the stored name IS the workmate slug. */
const slugSeat: TeamMemberRecord = { id: "M1", name: "senior-engineer-1", description: "d", role: "Senior Engineer", status: "running", spawnedAt: "2026-11-03T00:00:00.000Z", executorRef: "child-1" }
/** A Reviewer seat. */
const reviewer: TeamMemberRecord = { ...slugSeat, id: "M1", name: "reviewer-1", role: "Reviewer", executorRef: "child-2" }
/** A Plan Reviewer seat, whose role CONTAINS the Reviewer role. */
const planReviewer: TeamMemberRecord = { ...slugSeat, id: "M2", name: "plan-reviewer-1", role: "Plan Reviewer", executorRef: "child-3" }

/** Every measurement, printed as this probe's JSON. */
const out: Record<string, unknown> = {}
/** The expectations that failed. */
const failures: string[] = []

// N2 — the STORED-NAME rule, both directions (the old unit arm used a DIFFERENT slug and proved nothing).
/** A title containing the seat's actual stored name. */
const sameSlug = memberIdentityOf(recordOf([slugSeat]), "member-resumed-77", "You are senior-engineer-1, ...")
/** A title containing another seat's slug. */
const differentSlug = memberIdentityOf(recordOf([slugSeat]), "member-resumed-77", "You are senior-engineer-9, ...")
out.sameSlugTitle = sameSlug
out.differentSlugTitle = differentSlug
if (sameSlug.member?.id !== "M1") failures.push("N2: the seat's ACTUAL stored name did not name it (the documented rule)")
if (differentSlug.named !== false) failures.push("N2: a DIFFERENT slug named the seat")

// N1 — longest match: the Plan Reviewer's own title names the Plan Reviewer, not "ambiguous".
/** The overlapping-role roster. */
const overlap = recordOf([reviewer, planReviewer])
/** The Plan Reviewer's persona title. */
const planTitle = memberIdentityOf(overlap, "member-resumed-plan", "You are the Plan Reviewer, the roster's ...")
/** The Reviewer's own persona title. */
const reviewTitle = memberIdentityOf(overlap, "member-resumed-rev", "You are the Reviewer, the roster's ...")
out.planReviewerTitle = planTitle
out.reviewerTitle = reviewTitle
if (planTitle.named !== true || planTitle.member?.id !== "M2") failures.push("N1: the Plan Reviewer's title did not name the Plan Reviewer seat")
if (reviewTitle.named !== true || reviewTitle.member?.id !== "M1") failures.push("N1: the Reviewer's title did not name the Reviewer seat")

// N1 boundary — a GENUINE tie at the same specificity stays fail-closed (two seats sharing one role).
/** Two seats with the SAME role. */
const twin = memberIdentityOf(recordOf([reviewer, { ...reviewer, id: "M3", name: "reviewer-2", executorRef: "child-4" }]), "member-resumed-77", "You are the Reviewer, ...")
out.equalSpecificityTie = twin
if (twin.named !== true || twin.member !== undefined) failures.push("N1: an equal-length tie was not kept fail-closed")

// The genuine fork still names NO seat (it keeps the C7-4 Lead lineage in the callers).
/** A forked captain's title. */
const fork = memberIdentityOf(recordOf([slugSeat]), "sess-lead-fork", "You are the captain's fork.")
out.forkTitle = fork
if (fork.named !== false) failures.push("a genuine fork's title named a member seat")

out.failures = failures
out.pass = failures.length === 0
console.log(JSON.stringify(out, null, 2))
console.log(failures.length === 0 ? "EDGE PROBE PASS" : "EDGE PROBE FAIL")
process.exit(failures.length === 0 ? 0 : 1)
