#!/usr/bin/env bun
// CODE RABBIT CR1 probe (PR #93) — both findings measured on the fixed tree, with the OLD decision
// recomputed inline so each arm's non-vacuity is a measurement rather than a claim.
//
//   (a) a RECORDED Lead whose persona title contains a roster role must answer `{named:false}`; the old
//       ARM 3 (no lead guard) would have named that member — printed beside the new answer.
//   (b) an ending whose journal append THROWS must still be reported ok/changed:true, with the failure
//       logged on the row's sink, the record terminal, and a retry a reported no-op.
//
// Exit code: 0 when every expectation holds; 1 with the failure list otherwise.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { endTeam, type TeamActionCaller, type TeamActionDeps } from "../../../../../../packages/mpd-team-core-plugin/src/team-actions.ts"
import { addTeamMember, createTeam, memberIdentityOf, readTeam, recordNamesLead, writeTeam, type TeamMemberRecord, type TeamRecord } from "../../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The fixed clock every write is stamped with. */
const now = new Date("2026-11-03T00:00:00.000Z")
/** The recorded Lead session. */
const LEAD = "sess-lead"
/** The persona title that also contains the seat's roster role. */
const TITLE = "You are the Senior Engineer, the roster's implementation specialist; ..."
/** A W3-C-shaped seat row. */
const seat: TeamMemberRecord = { id: "M1", name: "senior-engineer-1", description: "d", role: "Senior Engineer", status: "running", spawnedAt: now.toISOString(), executorRef: "child-1" }
/** A record whose Lead and sole seat are those two identities. */
const record: TeamRecord = { version: 1, teamId: "team-probe", name: "p", description: "p", leadSessionId: LEAD, phase: "active", createdAt: now.toISOString(), members: [seat], tasks: [], nextMemberNumber: 2, nextTaskNumber: 1 }

/** Every measurement, printed as this probe's JSON. */
const out: Record<string, unknown> = {}
/** The expectations that failed. */
const failures: string[] = []

// (a) IDENTITY — the recorded Lead's title must not name a member.
/** The NEW reading for the recorded Lead. */
const leadReading = memberIdentityOf(record, LEAD, TITLE)
/** The OLD ARM 3 decision, recomputed inline: any seat whose role/name occurs in the title. */
const oldArmThree = record.members.filter((member) => {
  /** The seat's role text, folded. */
  const role = String(member.role ?? "").trim().toLowerCase()
  /** The seat's stored name, folded. */
  const name = String(member.name ?? "").trim().toLowerCase()
  return (role !== "" && TITLE.toLowerCase().includes(role)) || (name !== "" && TITLE.toLowerCase().includes(name))
})
out.identity = {
  recordedLead: recordNamesLead(record, [LEAD]),
  newReading: leadReading,
  oldArmThreeWouldName: oldArmThree.length === 1 ? oldArmThree[0]?.id : oldArmThree.length,
  churnedLeadReading: memberIdentityOf({ ...record, leadHistory: ["lead-fork-2"] }, "lead-fork-2", TITLE),
  controlMemberReading: memberIdentityOf(record, "member-resumed-77", TITLE),
}
if (leadReading.named !== false || leadReading.member !== undefined) failures.push("a RECORDED Lead's title named a member")
if (oldArmThree.length !== 1) failures.push("the OLD arm-3 recomputation did not reproduce the pre-fix match (arm is vacuous)")
if ((out.identity as any).churnedLeadReading.named !== false) failures.push("a leadHistory-recorded Lead's title named a member")
if ((out.identity as any).controlMemberReading.member?.id !== "M1") failures.push("the control member's title stopped naming its seat")

// (b) JOURNAL CONTAINMENT — an ending that already landed must survive a throwing journal append.
/** The sandbox workspace. */
const workspace = mkdtempSync(join(tmpdir(), "mpd-cr1-probe-"))
/** The real team the probe ends. */
const created = createTeam(workspace, { name: "cr1", description: "probe", leadSessionId: LEAD }, now)
writeTeam(workspace, addTeamMember(created, { name: "member-1", description: "seat", role: "Senior Engineer" }, now))
// A DIRECTORY where `journal.jsonl` belongs makes `appendFileSync` throw (EISDIR).
mkdirSync(join(workspace, ".mpd", "team", "journal.jsonl"), { recursive: true })
/** Every line the row's diagnostic sink received. */
const logs: string[] = []
/** The row seams `endTeam` reads, with the journal deliberately broken on disk. */
const deps: TeamActionDeps = {
  now: () => now,
  executor: (() => ({ kind: "unavailable", reason: "stub" })) as never,
  bundleApprovalEffects: async () => {},
  deriveParentTeam: () => undefined,
  resolveTeam: (ws: string) => {
    /** The team read fresh, so the retry sees the terminal record. */
    const fresh = readTeam(ws, created.teamId)
    return fresh === undefined ? {} : { record: fresh }
  },
  readWatchdogHold: () => ({ state: "free" }),
  service: () => undefined,
  log: (line: string) => { logs.push(line) },
  beginDispatch: () => () => {},
  assertPlanGraph: () => {},
  assertScopesOrdered: () => {},
}
/** The caller: the recorded Lead. */
const caller: TeamActionCaller = { workspace, sessionId: LEAD, lineage: [] }
/** The ending whose journal append throws. */
const first = await endTeam(deps, caller, { reason: "the wave landed" })
/** The repeated ending. */
const retry = await endTeam(deps, caller, { reason: "a retry" })
out.endJournal = {
  first: first.ok ? { ok: true, changed: first.changed, reason: first.reason, endedAt: first.endedAt } : first,
  recordPhase: readTeam(workspace, created.teamId)?.phase,
  recordReason: readTeam(workspace, created.teamId)?.archivedReason,
  logLines: logs,
  retry: retry.ok ? { ok: true, changed: retry.changed, reason: retry.reason, endedAt: retry.endedAt } : retry,
}
if (!first.ok || first.changed !== true) failures.push("the ending was reported as a failure although the record is terminal")
if (readTeam(workspace, created.teamId)?.phase !== "ended") failures.push("the record was not ended")
if (logs.length !== 1 || !String(logs[0]).includes(`team ${created.teamId} ended but its journal row was not written:`)) failures.push("the journal failure was not logged with the contract sentence")
if (!retry.ok || retry.changed !== false) failures.push("the retry was not the reported no-op")
if (logs.length !== 1) failures.push("the no-op retry appended a second log line")
rmSync(workspace, { recursive: true, force: true })

out.failures = failures
out.pass = failures.length === 0
console.log(JSON.stringify(out, null, 2))
console.log(failures.length === 0 ? "CR1 PROBE PASS" : "CR1 PROBE FAIL")
process.exit(failures.length === 0 ? 0 : 1)
