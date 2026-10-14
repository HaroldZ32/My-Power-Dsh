#!/usr/bin/env bun
// Case team-dispatch-guard — the C7 amendment's HARD GATE (plan .mpd/plans/tui-015-adaptation.md,
// "Plan amendment (2026-10-14, user-mandated): C7"), landed by Lane Q.
//
// DRAFT (author: Guard Engineer, wave tui-015-adaptation). This file is CONTENT for Deep Worker to land
// at `skills/dsh-qa/scripts/team-dispatch-guard.ts` — it is NOT written into skills/** by its author
// (single-skills-writer rule, AGENTS.md §9). See ./HANDOFF.md for the landing checklist.
//
// WHAT IT PROVES. Three MEASURED defects, with the four assertions the plan freezes:
//   (a) C7-1 CROSS-TEAM: a task×member pairing across DIFFERENT teams is REFUSED, naming BOTH team ids.
//       HONEST BOUND: the mpd-native `agent_teams_dispatch` pass builds BOTH sides from ONE record, so a
//       cross-team pool is not constructible through the tool; the invariant is asserted at the PAIRING
//       SEAM (`planDispatch`/`pairingRefusal`), which is the code that decides every pairing.
//   (b) C7-2 READ-ONLY: through the REAL tool, a task carrying `write_scopes` is never paired with a
//       read-only specialist (its `readonly` flag comes from mpd-roles-plugin's OWN `mpdRoles` service),
//       and the refusal is REPORTED rather than a wrong-but-free member being grabbed.
//   (c) C7-3 PHANTOM TEAM: a team record whose phase is terminal/archived (or whose plan was archived
//       without approval) is SKIPPED by resolution and marked terminal by the consistency pass.
//   (d) THE NEGATIVE CONTROL: a valid same-team, write-capable pairing still SUCCEEDS. The gate must not
//       over-block, so every refusal arm is paired with the positive one.
//
// PREREQ: absent-toolchain-binary .toolchain/node_modules/.bin/bun "install the pinned toolchain (AGENTS.md §6)"
// PREREQ: absent-runtime packages/mpd-team-core-plugin/src/dispatch.ts "this lane is in-process over the bundle's own source (no dsh spawn)"
//
// Usage:
//   bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test
//   bun skills/dsh-qa/scripts/team-dispatch-guard.ts [--out <dir>]
// Evidence -> evidence/dsh-qa/team-dispatch-guard/<timestamp>/{result.json,output.log}
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exitOnRefusal, refuseOverwrite, writeImmutable } from "./lib/immutable-output.ts"
import { isReadonlyMemberName, pairingRefusal, planDispatch, readonlyMemberKeys, type DispatchMember, type DispatchTask } from "../../../packages/mpd-team-core-plugin/src/dispatch.ts"
import { isLiveTeam, isLiveTeamPhase, readArchivedPlanIndex, reapReapedTeams, resolveTeamRecord, type ArchivedPlanIndex } from "../../../packages/mpd-team-core-plugin/src/team-lifecycle.ts"
import { activeTeamId, bindActiveTeam, readTeam, writeTeam, type TeamPhase, type TeamRecord } from "../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { ROLES } from "../../../packages/mpd-roles-plugin/src/roles.data.ts"

/** The lane slug: the case name in cases.json and the evidence directory name. */
const SLUG = "team-dispatch-guard"

/** A board task for the guard arms; only the fields a guard reads are varied. */
function task(id: string, over: Partial<DispatchTask> = {}): DispatchTask {
  return { id, subject: "task " + id, status: "pending", ready: true, ...over }
}

/** An idle roster member for the guard arms; only the fields a guard reads are varied. */
function member(id: string, name: string, over: Partial<DispatchMember> = {}): DispatchMember {
  return { id, name, status: "inactive", ...over }
}

/** A minimal team record for the lifecycle arms; every field the rules do not read keeps a fixed value. */
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

/** An archive index carrying no evidence, for arms that do not exercise the archive rule. */
const EMPTY_INDEX: ArchivedPlanIndex = { approved: new Set<string>(), unapproved: new Set<string>() }

/** The roster rows EXACTLY as mpd-roles-plugin's `mpdRoles` service publishes them. */
const ROSTER_ROWS = ROLES.map((role) => ({ name: role.name, readonly: role.readonly }))

/** The read-only key set the dispatch tool builds from that service, per call. */
const READONLY_KEYS = readonlyMemberKeys(ROSTER_ROWS)

/** One assertion's outcome, printed and written to evidence. */
interface Arm {
  /** The frozen assertion id: a | b | c | d. */
  id: string
  /** What the arm asserts, in one line. */
  claim: string
  /** True when the observed behaviour matches the claim. */
  ok: boolean
  /** The observed value, so a red arm is diagnosable without re-running. */
  observed: string
}

/** Run the four frozen assertions over the pure seam (the offline half and the whole falsifier). */
function arms(): Arm[] {
  /** The accumulated arms, in the plan's order. */
  const out: Arm[] = []
  /** (a) a cross-team pairing is refused, with BOTH ids in the sentence. */
  const cross = planDispatch({ tasks: [task("T1", { teamId: "team-a" })], members: [member("m-foreign", "qa-reader-writer", { teamId: "team-b" })], ledger: {} })
  /** The refusal sentence, which must name the task team and the member team. */
  const crossReason = cross.skipped[0]?.reason ?? ""
  out.push({ id: "a", claim: "cross-team pairing REFUSED, naming both team ids", ok: cross.pairs.length === 0 && crossReason.includes("team-a") && crossReason.includes("team-b") && crossReason.includes("CROSS-TEAM"), observed: crossReason })
  /** (b) a write task never pairs with a read-only specialist, and the reason is reported. */
  const readOnly = planDispatch({ tasks: [task("T5", { teamId: "team-a", writeScopes: ["packages/x"] })], members: [member("m-ro", "Plan Reviewer", { teamId: "team-a", readonly: isReadonlyMemberName("Plan Reviewer", READONLY_KEYS) })], ledger: {} })
  /** The refusal sentence for the read-only arm. */
  const readOnlyReason = readOnly.skipped[0]?.reason ?? ""
  out.push({ id: "b", claim: "write task × read-only member REFUSED, reason reported", ok: readOnly.pairs.length === 0 && readOnlyReason.includes("WRITE-TASK-ON-READ-ONLY") && readOnlyReason.includes("Plan Reviewer"), observed: readOnlyReason })
  /** (c) resolution skips a terminal team and falls through to the live one, or to none. */
  const ghost = record({ teamId: "team-ghost", phase: "archived" as TeamPhase, leadSessionId: "lead-1", createdAt: "2026-10-14T02:00:00.000Z" })
  /** The live team the same lead now works in. */
  const live = record({ teamId: "team-live", phase: "active", leadSessionId: "lead-1", createdAt: "2026-10-14T01:00:00.000Z" })
  /** The fall-through resolution (ghost newest first, so it would win without the skip). */
  const resolved = resolveTeamRecord({ teams: [ghost, live], sessionId: "lead-1", index: EMPTY_INDEX })
  /** The resolution when ONLY the ghost exists. */
  const none = resolveTeamRecord({ teams: [ghost], sessionId: "lead-1", index: EMPTY_INDEX })
  /** The archive arm: a live phase whose plan was archived WITHOUT approval is not live either. */
  const unapproved = isLiveTeam(record({ teamId: "team-x", phase: "active" }), { approved: new Set<string>(), unapproved: new Set<string>(["lead-1\u0000wave"]) })
  out.push({ id: "c", claim: "terminal/archived team SKIPPED, live team resolves, none when only a ghost", ok: resolved.record?.teamId === "team-live" && none.record === undefined && isLiveTeamPhase("active") && !isLiveTeamPhase("archived") && unapproved === false, observed: `resolved=${resolved.record?.teamId ?? "(none)"} onlyGhost=${none.record?.teamId ?? "(none)"}` })
  /** (d) THE NEGATIVE CONTROL: a valid same-team, write-capable pairing still succeeds. */
  const valid = planDispatch({ tasks: [task("T2", { teamId: "team-a", writeScopes: ["packages/x"] })], members: [member("m-w", "Senior Engineer", { teamId: "team-a", readonly: isReadonlyMemberName("Senior Engineer", READONLY_KEYS) })], ledger: {} })
  out.push({ id: "d", claim: "NEGATIVE CONTROL: a valid same-team write-capable pairing still SUCCEEDS", ok: valid.pairs.length === 1 && valid.pairs[0]?.memberId === "m-w" && valid.skipped.length === 0, observed: JSON.stringify(valid.pairs.map((pair) => [pair.taskId, pair.memberId])) })
  return out
}

/** Print the arms and return the exit code (0 = every assertion holds). */
function selfTest(): number {
  /** The arm outcomes. */
  const results = arms()
  for (const arm of results) console.log(`${arm.ok ? "ok  " : "FAIL"} (${arm.id}) ${arm.claim} — ${arm.observed}`)
  /** Whether every arm held. */
  const ok = results.every((arm) => arm.ok)
  console.log(ok ? "SELF-TEST: PASS (4/4 assertions incl. the negative control)" : "SELF-TEST: FAIL")
  return ok ? 0 : 1
}

/**
 * The real-lane arm: the guard behaviour over the REAL team store, driven through the resolution and
 * consistency-pass entry points. (The tool-level arm — `agent_teams_dispatch` over the mounted built
 * row — is the wiring Deep Worker adds beside this file's assertions; see HANDOFF.md.)
 * @returns the arms produced by this lane, so `main` can gate on them.
 */
function realLaneArms(): { arms: Arm[]; workspace: string } {
  /** The sandbox workspace every record is written into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-c7-lane-"))
  // (b) a write task and an idle read-only member: the record's own roster classifies the member.
  writeTeam(workspace, record({
    teamId: "team-guard",
    name: "guard",
    leadSessionId: "lead-gate",
    phase: "active",
    members: [
      { id: "M1", name: "Plan Reviewer", role: "Plan Reviewer", description: "read-only", status: "running", executorRef: "sess-ro", spawnedAt: "2026-10-14T00:00:00.000Z" },
      { id: "M2", name: "Senior Engineer", description: "writes", status: "running", executorRef: "sess-w", spawnedAt: "2026-10-14T00:00:00.000Z" },
    ],
    tasks: [
      { id: "T1", subject: "write task", description: "writes", kind: "work", status: "pending", blockedBy: [], writeScopes: ["packages/x"], revision: 1 },
    ],
    nextMemberNumber: 3,
    nextTaskNumber: 2,
  }))
  bindActiveTeam(workspace, "lead-gate", "team-guard")
  // The pass the tool performs: tasks and members both tagged with the resolved record's team id.
  /** The record under test. */
  const opened = readTeam(workspace, "team-guard")!
  /** The board in the dispatch engine's shape, exactly as the tool builds it. */
  const tasks = opened.tasks.map((t) => ({ id: t.id, subject: t.subject, status: t.status, ready: true, blockedBy: t.blockedBy, teamId: opened.teamId, writeScopes: t.writeScopes }))
  /** The roster in the dispatch engine's shape, exactly as the tool builds it (readonly from the service rows). */
  const members = opened.members.map((m) => ({ id: m.executorRef ?? m.id, name: m.name, status: "inactive", teamId: opened.teamId, readonly: isReadonlyMemberName(m.name, READONLY_KEYS) || (m.role !== undefined && isReadonlyMemberName(m.role, READONLY_KEYS)) }))
  /** A pass with ONLY the read-only member idle: the write task must be refused. */
  const refused = planDispatch({ tasks, members: members.filter((m) => m.readonly === true), ledger: {} })
  /** A pass with ONLY the write-capable member idle: the same task must pair (the negative control). */
  const paired = planDispatch({ tasks, members: members.filter((m) => m.readonly !== true), ledger: {} })
  // (c) the phantom: a terminal record bound for a lead.
  writeTeam(workspace, record({ teamId: "team-phantom", name: "phantom", leadSessionId: "lead-ghost", phase: "archived" as TeamPhase }))
  bindActiveTeam(workspace, "lead-ghost", "team-phantom")
  /** The archive index for this workspace. */
  const index = readArchivedPlanIndex(workspace)
  /** The resolution a bound ghost produces. */
  const resolved = resolveTeamRecord({ bound: readTeam(workspace, "team-phantom")!, teams: [record({ teamId: "team-phantom", name: "phantom", leadSessionId: "lead-ghost", phase: "archived" as TeamPhase })], sessionId: "lead-ghost", index })
  /** The ids the consistency pass marked terminal. */
  const reaped = reapReapedTeams(workspace, new Date("2026-10-14T10:00:00.000Z"))
  /** The repaired record. */
  const repaired = readTeam(workspace, "team-phantom")
  return {
    workspace,
    arms: [
      { id: "b-real", claim: "REAL store: the write task is refused the read-only member, reason reported", ok: refused.pairs.length === 0 && (refused.skipped[0]?.reason ?? "").includes("WRITE-TASK-ON-READ-ONLY"), observed: refused.skipped[0]?.reason ?? "(no skip)" },
      { id: "d-real", claim: "REAL store NEGATIVE CONTROL: the same task pairs with the write-capable member", ok: paired.pairs.length === 1 && paired.pairs[0]?.memberId === "sess-w", observed: JSON.stringify(paired.pairs.map((pair) => pair.memberId)) },
      { id: "c-real", claim: "REAL store: the bound phantom resolves NOTHING and is marked terminal with a reason", ok: resolved.record === undefined && reaped.includes("team-phantom") && repaired?.phase === "ended" && (repaired?.archivedReason ?? "").includes("not a live team phase"), observed: `resolved=${resolved.record?.teamId ?? "(none)"} reaped=${JSON.stringify(reaped)} phase=${repaired?.phase}` },
      { id: "registry-real", claim: "REAL store: the terminal team's OWN bound lead no longer resolves it", ok: activeTeamId(workspace, "lead-ghost") === "team-phantom" && resolveTeamRecord({ bound: repaired!, teams: [repaired!], sessionId: "lead-ghost", index }).record === undefined, observed: `bound=${activeTeamId(workspace, "lead-ghost")} resolved=${resolveTeamRecord({ bound: repaired!, teams: [repaired!], sessionId: "lead-ghost", index }).record?.teamId ?? "(none)"}` },
    ],
  }
}

/** The lane entry point: `--self-test`, else the real lane with evidence. */
function main(argv: readonly string[]): number {
  if (argv.includes("--self-test")) return selfTest()
  /** The explicit `--out` target, when the caller pinned one. */
  const outIndex = argv.indexOf("--out")
  /** The requested evidence directory, or undefined to derive one. */
  const requested = outIndex >= 0 ? argv[outIndex + 1] : undefined
  if (requested !== undefined) refuseOverwrite(requested, { label: "evidence dir", remedy: "pass a fresh --out directory" })
  /** The real-lane outcome, whose workspace this function owns and removes. */
  const lane = realLaneArms()
  try {
    /** Every arm: the four frozen assertions plus the real-store arms. */
    const all = [...arms(), ...lane.arms]
    for (const arm of all) console.log(`${arm.ok ? "ok  " : "FAIL"} (${arm.id}) ${arm.claim} — ${arm.observed}`)
    /** The derived evidence directory. */
    const dir = requested ?? join(process.cwd(), "evidence", "dsh-qa", SLUG, new Date().toISOString().replace(/[:.]/g, "-"))
    writeImmutable(join(dir, "result.json"), JSON.stringify({ case: SLUG, ok: all.every((arm) => arm.ok), arms: all }, null, 2) + "\n")
    console.log(`evidence -> ${dir}`)
    return all.every((arm) => arm.ok) ? 0 : 1
  } finally {
    rmSync(lane.workspace, { recursive: true, force: true })
  }
}

try {
  process.exit(main(process.argv.slice(2)))
} catch (error) {
  exitOnRefusal(error, SLUG)
}
