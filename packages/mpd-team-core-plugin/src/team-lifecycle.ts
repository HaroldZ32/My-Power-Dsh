// The team LIFECYCLE rules: which records may still resolve, which archived plans are terminal, and the
// consistency pass that turns a reaped ghost into an honest terminal record.
//
// WHY IT EXISTS (plan amendment C7-3, 2026-10-14). The host executor reaped the idle conference-phase
// team and its record stayed `phase: active` with six ghost members, while the session→team index kept
// pointing at it — so the sidebar honestly read "a team exists with nothing in it". Three rules close
// that class:
//
//   1. a record is LIVE only while its phase is one of {@link LIVE_TEAM_PHASES} and it carries no
//      `endedAt` — the hand-patched `archived` spelling is therefore NOT live, without a schema edit;
//   2. a team whose staged plan was archived WITHOUT approval (discarded or replaced) is not live
//      either — `.mpd/team/archive/` is the evidence, read once per pass ({@link readArchivedPlanIndex});
//   3. {@link reapReapedTeams} rewrites such a record to `ended` WITH a reason, so a ghost cannot
//      survive on disk and `derivePhase` agrees with it afterwards.
//
// THE MEASURED BOUNDARY of rule 2, so nobody "fixes" it into an over-block: approval ARCHIVES the staged
// plan for EVERY team (`agent_teams_plan {action:"approve"}` calls `archivePlan`), so an APPROVED
// archived plan is the normal state of a live team. Treating "an archived plan exists" as terminal would
// skip every approved team, including the live one — measured on this workspace's own archive (21 plan
// directories, every live team's plan among them). Only an UNAPPROVED archived plan is terminal evidence.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { listTeams, recordNamesLead, recordNamesMember, teamRoot, writeTeam, type TeamRecord } from "./team-store"

/** The phases a team can still be WORKED in — the only values a live record may carry. */
export const LIVE_TEAM_PHASES: readonly string[] = ["staged", "active", "idle"]

/**
 * Whether a record phase still names a workable team.
 *
 * Everything else — `ended`, the hand-patched `archived`, or any future spelling — is terminal, which is
 * what makes the C7-3 skip independent of the `TeamPhase` union having been widened.
 * @param phase - the phase text a record carries.
 * @returns true for `staged`/`active`/`idle`, false for anything else.
 */
export function isLiveTeamPhase(phase: string): boolean {
  return LIVE_TEAM_PHASES.includes(phase)
}

/** The identity an archived plan and a team record share: the lead session and the team name. */
const ARCHIVED_PLAN_KEY_SEPARATOR = "\u0000"

/**
 * The archive index key for one plan identity.
 * @param sessionId - the plan's staging session (the team's lead session).
 * @param name - the plan's team name.
 * @returns the composite key, with a NUL separator so no name can be confused with a session id.
 */
function archivedPlanKey(sessionId: unknown, name: unknown): string {
  return String(sessionId ?? "") + ARCHIVED_PLAN_KEY_SEPARATOR + String(name ?? "")
}

/** What `.mpd/team/archive/` says, indexed by the plan identity a team record also carries. */
export interface ArchivedPlanIndex {
  /** Identities of archived plans that WERE approved — the normal archive of a live team. */
  approved: ReadonlySet<string>
  /** Identities of archived plans that were NEVER approved — discarded or replaced, hence terminal. */
  unapproved: ReadonlySet<string>
}

/**
 * Read `.mpd/team/archive/` once and classify every archived plan by its approval state.
 *
 * Never throws: an absent archive, a directory without a readable `plan.json` or invalid JSON all read as
 * "no evidence", so a caller's resolution is never taken down by a broken archive.
 * @param workspace - the workspace whose team archive is read.
 * @returns the approved and unapproved identity sets; both empty when nothing is archived.
 */
export function readArchivedPlanIndex(workspace: string): ArchivedPlanIndex {
  /** Identities of archived plans carrying an `approvedAt`. */
  const approved = new Set<string>()
  /** Identities of archived plans carrying no `approvedAt`. */
  const unapproved = new Set<string>()
  /** The archive's directory entries, or none when the archive does not exist. */
  let entries: string[] = []
  try {
    entries = readdirSync(join(teamRoot(workspace), "archive"))
  } catch {
    return { approved, unapproved }
  }
  for (const entry of entries) {
    try {
      /** The archived plan's raw JSON text. */
      const raw = readFileSync(join(teamRoot(workspace), "archive", entry, "plan.json"), "utf8")
      /** The parsed plan, read structurally: only the three fields this index classifies. */
      const plan = JSON.parse(raw) as { sessionId?: unknown; name?: unknown; approvedAt?: unknown }
      /** The identity this plan archives. */
      const key = archivedPlanKey(plan.sessionId, plan.name)
      ;(plan.approvedAt === undefined ? unapproved : approved).add(key)
    } catch {
      // A missing or malformed archived plan is evidence of nothing; it never blocks a resolution.
    }
  }
  return { approved, unapproved }
}

/**
 * Whether a team record is still LIVE, by the two C7-3 rules plus the archive evidence.
 * @param record - the record to classify.
 * @param index - the archive index for this workspace ({@link readArchivedPlanIndex}).
 * @returns true when the team may still resolve; false for a reaped/terminal ghost.
 */
export function isLiveTeam(record: TeamRecord, index: ArchivedPlanIndex): boolean {
  if (record.endedAt !== undefined) return false
  if (!isLiveTeamPhase(record.phase)) return false
  /** This record's plan identity, as the archive index keys it. */
  const key = archivedPlanKey(record.leadSessionId, record.name)
  return !(index.unapproved.has(key) && !index.approved.has(key))
}

/** What a session's team resolution answered: the team, or the sentence that says why none resolved. */
export interface TeamResolution {
  /** The one team this session belongs to; absent when nothing (or more than one thing) resolved. */
  record?: TeamRecord
  /** Why nothing resolved, already a sentence a refusal quotes; absent when a record did resolve. */
  refusal?: string
}

/** What {@link resolveTeamRecord} reads: the bound record, every candidate and the archive evidence. */
export interface TeamResolutionInput {
  /** The record the session index bound, when the index still carries one. */
  bound?: TeamRecord
  /** EVERY team the workspace holds, NEWEST FIRST (as {@link listTeams} orders them). */
  teams: readonly TeamRecord[]
  /** The session whose team is wanted. */
  sessionId: string
  /**
   * Every OTHER id this caller's own session carries, as the harness recorded them (C7-4 F5).
   *
   * A FORKED or RESUMED session gets a fresh id while `teams.json` and the record keep the original, so
   * the caller's recorded ancestor (`agent.session.header.parentSession`) is the one durable link back to
   * its team. Empty for an ordinary session, and matching degrades to the exact id alone when it is.
   */
  alsoSessions?: readonly string[]
  /** The archive index for this workspace ({@link readArchivedPlanIndex}). */
  index: ArchivedPlanIndex
}

/**
 * The mpd team record bound to one session — the three arms, in order, over LIVE candidates only.
 *
 * The order is unchanged from the in-row version: (1) the bound index's team (the fast path), (2) the
 * newest record this session LEADS, (3) the sole record whose durable roster names this session. A
 * session on MORE THAN ONE roster resolves NONE and says so, because binding a board write to the wrong
 * team is worse than refusing it. The C7-3 difference is that every candidate is filtered by
 * {@link isLiveTeam} HERE, so a reaped ghost can never win any arm and resolution falls through to the
 * next candidate or to nothing. The C7-4 difference (F5) is that the lead arm reads the record's WHOLE
 * Lead identity (`leadSessionId` plus its churn `leadHistory`) and that the `alsoSessions` spelling a
 * forked/resumed session carries is accepted by the lead AND member arms — so captaincy survives a
 * session-id change without a hand rebind, and degrades to the plain id when the harness records none.
 * @param input - the bound record, every candidate and the archive index.
 * @returns the resolution; see {@link TeamResolution}.
 */
export function resolveTeamRecord(input: TeamResolutionInput): TeamResolution {
  /** Every spelling that identifies the caller: its own id plus the ancestors the harness recorded. */
  const spellings = [input.sessionId, ...(input.alsoSessions ?? [])].filter((value) => value !== "")
  if (input.bound !== undefined && isLiveTeam(input.bound, input.index)) return { record: input.bound }
  /** Every LIVE candidate, newest first — the only pool the two remaining arms draw from. */
  const live = input.teams.filter((record) => isLiveTeam(record, input.index))
  /** The newest LIVE team this session leads (by its current id OR a recorded historical one). */
  const leading = live.find((record) => recordNamesLead(record, spellings))
  if (leading !== undefined) return { record: leading }
  /** Every LIVE team whose durable roster names this session as a member. */
  const memberOf = live.filter((record) => recordNamesMember(record, spellings))
  if (memberOf.length === 1) return { record: memberOf[0] }
  if (memberOf.length > 1) {
    return { refusal: `this session is on the roster of ${memberOf.length} teams in this workspace (${memberOf.map((record) => record.teamId).join(", ")}) and the record does not say which one it works on — run this from the team's lead session, or remove the duplicate roster entry` }
  }
  return {}
}

/**
 * Mark every reaped team's record TERMINAL with a reason, instead of leaving `phase: active` ghosts.
 *
 * A record already carrying `endedAt` is consistent and is left byte-identical. Every other non-live
 * record is rewritten to `phase: ended` + `endedAt` + `archivedReason`, which is exactly what
 * `derivePhase` would answer for it afterwards — so the ghost cannot reappear as `active` on the next
 * derived read, and the reason says which rule caught it.
 * @param workspace - the workspace whose team records are repaired.
 * @param now - the instant stamped as `endedAt`.
 * @returns the team ids that were marked terminal by this pass, in file order.
 */
export function reapReapedTeams(workspace: string, now: Date): string[] {
  /** The archive index, read ONCE for the whole pass. */
  const index = readArchivedPlanIndex(workspace)
  /** The team ids this pass marked terminal. */
  const reaped: string[] = []
  for (const record of listTeams(workspace)) {
    if (isLiveTeam(record, index)) continue
    if (record.endedAt !== undefined) continue
    /** Why this record is not live, naming the rule that caught it. */
    const reason = !isLiveTeamPhase(record.phase)
      ? `record phase ${JSON.stringify(record.phase)} is not a live team phase (${LIVE_TEAM_PHASES.join(" | ")})`
      : `the plan for lead ${record.leadSessionId} / ${JSON.stringify(record.name)} is archived without approval (discarded or replaced)`
    writeTeam(workspace, { ...record, phase: "ended", endedAt: now.toISOString(), archivedReason: reason })
    reaped.push(record.teamId)
  }
  return reaped
}
