#!/usr/bin/env bun
// review-b5 — the T17 edge probe (my review-b4 edges, reconstructed durably + the T16 expectations).
// Pure predicate probe over team-store.ts#memberIdentityOf / titleMatchLength; no tool, no store writes.
import { memberIdentityOf, type TeamMemberRecord, type TeamRecord } from "../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** One roster row built for a probe case. */
const seat = (id: string, name: string, role: string, ref: string): TeamMemberRecord => ({ id, name, description: "d", role, status: "running", spawnedAt: "2026-11-03T00:00:00.000Z", executorRef: ref })
/** One team record around the given roster. */
const record = (members: TeamMemberRecord[]): TeamRecord => ({ version: 1, teamId: "team-x", name: "w", description: "d", leadSessionId: "sess-lead", phase: "active", createdAt: "2026-11-03T00:00:00.000Z", members, tasks: [], nextMemberNumber: members.length + 1, nextTaskNumber: 1 })
/** The single W3-C seat (stored name = workmate slug). */
const single = record([seat("M1", "senior-engineer-1", "Senior Engineer", "child-senior-engineer-1")])
/** The overlapping-role roster my review B4 measured: Reviewer + Plan Reviewer. */
const overlap = record([seat("M1", "reviewer-1", "Reviewer", "child-reviewer-1"), seat("M2", "plan-reviewer-1", "Plan Reviewer", "child-plan-reviewer-1")])
/** Two seats sharing ONE role: the genuine tie. */
const twins = record([seat("M1", "reviewer-1", "Reviewer", "child-reviewer-1"), seat("M2", "reviewer-2", "Reviewer", "child-reviewer-2")])
/** Every expectation, in one place. */
const cases: Array<{ name: string; got: { member?: TeamMemberRecord; named: boolean }; wantMember?: string; wantNamed: boolean }> = []
/** Record one case. */
function check(name: string, got: { member?: TeamMemberRecord; named: boolean }, wantNamed: boolean, wantMember?: string): void {
  cases.push({ name, got, ...(wantMember === undefined ? {} : { wantMember }), wantNamed })
}
// (a) LONGEST match: the Plan Reviewer's own title names ITS seat, not the shorter Reviewer seat.
check("plan-reviewer title on overlap roster", memberIdentityOf(overlap, "member-resumed-77", "You are the Plan Reviewer, the roster's plan-quality gate."), true, "M2")
check("reviewer title on overlap roster", memberIdentityOf(overlap, "member-resumed-77", "You are the Reviewer, the roster's adversarial reader."), true, "M1")
// (b) a genuine EQUAL-length tie stays fail-closed (named, no row).
check("equal-length tie (two Reviewer seats)", memberIdentityOf(twins, "member-resumed-77", "You are the Reviewer, ..."), true)
// (c) the stored-name rule, BOTH ways: the seat's ACTUAL stored name names it; a different seat's does not.
check("seat's own stored slug in the title", memberIdentityOf(single, "member-resumed-77", "You are senior-engineer-1, ..."), true, "M1")
check("a DIFFERENT seat's slug", memberIdentityOf(single, "member-resumed-77", "You are senior-engineer-9, ..."), false)
// (d) an unrelated fork title names nobody.
check("genuine fork title", memberIdentityOf(single, "sess-lead-fork", "You are the captain's fork."), false)
const failures: string[] = []
for (const c of cases) {
  const memberOk = c.wantMember === undefined ? c.got.member === undefined : c.got.member?.id === c.wantMember
  if (c.got.named !== c.wantNamed || !memberOk) failures.push(`${c.name}: named=${c.got.named} member=${c.got.member?.id ?? "<none>"} (want named=${c.wantNamed} member=${c.wantMember ?? "<none>"})`)
}
console.log(JSON.stringify({ cases: cases.map((c) => ({ name: c.name, named: c.got.named, member: c.got.member?.id ?? null })), failures }, null, 2))
console.log(failures.length === 0 ? "EDGE PROBE PASS" : "EDGE PROBE FAIL")
process.exit(failures.length === 0 ? 0 : 1)
