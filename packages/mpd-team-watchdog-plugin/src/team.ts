// READ-ONLY projection of the team plane: the MPD TEAM RECORD first, the OFFICIAL readout second.
//
// 0.1.7 retired the vendored `mpd-agent-teams-plugin` and its `<stateDir>/<teamId>/team.json`
// record. Team state now lives in TWO places, and this module reads them in that order:
//
//   1. THE MPD TEAM RECORD (`<workspace>/.mpd/team/teams/<teamId>.json`, served by
//      `mpd-team-core-plugin` as the `mpdTeams` service) — the AUTHORITATIVE plane per AGENTS.md
//      §1. It is read first because it is the plane `agent_teams_dispatch` names, so its
//      `team-<stamp>` ids are the ids a hold is filed under and asked about.
//   2. THE OFFICIAL Agent Teams readout (`dsh.teamLiveTeams()`, folded by the adapter over the
//      live agent registry) — the FALLBACK for a composition that runs the official executor.
//
// Reading only the official fold (the shipped behaviour until this change) was a defect, not a
// choice: the adapter's DEFAULT executor backend is `native`, a native team is never registered
// with the official service, so `tryMembership` never answered `lead` and the watchdog watched
// exactly zero teams while its hold was filed under an id nothing asked about.
//
// This module never writes and never reads a team file itself: it PROJECTS either plane onto the
// vocabulary the watchdog's fold was written in, so the four-state machine, the heartbeat store and
// the scene schema keep their meaning. Every projection is field-for-field and named, because a
// silent mismatch here is a watchdog that watches the wrong thing.
//
// WHAT THE OFFICIAL VIEW DOES NOT CARRY, and what replaces it (stated, never hidden):
//   * `attemptId` — the official board has NO per-attempt id. It has a monotonic, every-mutation
//     `revision` (compare-and-set), which plays the SAME role: a re-claim, a re-open or an edit
//     starts a new generation, so a stale streak/stamp cannot be spent on it. `attemptId` is
//     therefore the revision rendered as a string. The mpd record carries the same pair.
//   * `createdAt`/`approvedAt` — the official view has no timestamps, so T-16's generation floor is
//     `null` (PERMISSIVE, the documented §0/A3 convention). The mpd record DOES carry them, and
//     `projectMpdTeam` maps them.
//   * `activityAt` — absent on both planes as far as this package is concerned; it only feeds the
//     r4 dead-record bound, and arming that bound is a separate decision (see `projectMpdTeam`).
//   * `halted`/`haltedAt` — neither plane exposes a halt; `phase` is DERIVED from the roster's live
//     statuses so the diagnostics keep a word for it.
import type { DshAdapter, DshTeamMemberView, DshTeamTaskView, DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"

/**
 * Task statuses the watchdog never considers live.
 *
 * The first two are the official `TeamTaskStatus` terminal values. `failed`/`cancelled` are
 * TOLERATED rather than produced: if a harness release ever adds one, reading it as live would
 * make the watchdog warn about a task nobody can advance.
 */
export const TERMINAL_STATUSES: readonly string[] = ["completed", "deleted", "failed", "cancelled"]

/**
 * The captain's key inside the projected record.
 *
 * The official roster names the Lead pseudo-row `lead`; `ownerName` on a Lead-owned task carries
 * that same word. The watchdog's whole captain path (stamps, `currentTask`, the scene's
 * `members[]`) was written against the retired record's `captain` key, so the projection
 * NORMALISES `lead` to this constant and nothing downstream has to know the difference.
 */
export const CAPTAIN_KEY = "captain"

/** The official Lead pseudo-row's model-facing name (the value normalised to {@link CAPTAIN_KEY}). */
export const OFFICIAL_LEAD_NAME = "lead"

/** One task of the projected record (only the fields the watchdog reads). */
export interface TeamTask {
  /** The OFFICIAL task id. */
  id: string
  /** The board status verbatim (`in_progress`, `pending`, `completed`, ...). */
  status: string
  /** The owning member's normalized name, when the board shows an owner. */
  assignee?: string
  /** The official board `revision` (the generation counter; see the module header). */
  attempt?: number
  /** The generation token: the revision as a string, or `undefined` for a hand-built fixture. */
  attemptId?: string
  /** Epoch ms of the board's last mutation, when the view carries one. */
  updatedAt?: number
  /**
   * T-20 (§8): the task ids this task depends on (the official `blockedBy`). Carried because the
   * watchdog derives "this member is blocked and has nothing claimable" from the readout ALONE —
   * no new member-facing wait tool is added, and no other process has to tell the watchdog.
   */
  dependencies?: string[]
  /**
   * Whether the board shows this task as HANDED to somebody.
   *
   * The official board sets an owner exactly at claim/reassign time, so an owned row IS a
   * dispatched row — that is the r7 dispatch precondition's new spelling (the retired record
   * carried a separate `attemptId` written at dispatch, which no longer exists).
   */
  dispatched?: boolean
}

/** One member of the projected record (only the fields the watchdog reads). */
export interface TeamMember {
  /** The member's Session id, which is the identity the agent registry keys on. */
  id: string
  /** The member's display name, or the normalized `captain` for the Lead row. */
  name: string
  /** The live status verbatim (`running`, `provisioning`, ...), when reported. */
  status?: string
}

/** The projected team, in the vocabulary the watchdog's fold and scene were written in. */
export interface TeamRecord {
  /** The official team identity: the Lead Session id (`TeamId(root.id)`). */
  id: string
  /** The team's display name, taken from the Lead row or the view's lead name. */
  name: string
  /** Derived word for diagnostics: `active` while the roster has live work, else `idle`. */
  phase?: string
  /** Always absent: the official service has no halt (kept so a consumer reads a real field). */
  halted?: boolean
  /** Always absent: the official service exposes no halt (kept for shape compatibility). */
  haltedAt?: number
  /** The Lead Session id, which is the captain's own session. */
  captainSessionId?: string
  /** The roster WITHOUT the Lead pseudo-row; the captain is addressed by session id. */
  members: TeamMember[]
  /** Every board task, projected field-for-field. */
  tasks: TeamTask[]
  /**
   * Always `null`: the official view carries no timestamps. Kept so the r4/freshness call sites
   * read one shape; `null` is the PERMISSIVE reading (see the module header).
   */
  activityAt: number | null
  /** Always `null`: no record creation time exists (T-16's floor is permissive by convention). */
  createdAt: number | null
  /** Always null: the official board carries no approval timestamp. */
  approvedAt: number | null
  /** The raw projected view, kept for byte-level honesty checks in tests/lanes. */
  raw: Record<string, unknown>
}

/** A live agent, as far as identity resolution needs to see it. */
export interface AgentLike {
  /** The agent's own id, when the payload carries one. */
  id?: unknown
  /** The agent's session sub-object, carrying the harness-side identity. */
  session?: { id?: unknown; header?: { cwd?: unknown } }
  [key: string]: unknown
}

/** What an agent's session says about who it is. */
export interface AgentIds {
  /** The agent id, or an empty string when it could not be read. */
  agentId: string
  /** The session id, or an empty string when it could not be read. */
  sessionId: string
  /** The session's workspace cwd, or undefined when the payload does not state one. */
  cwd: string | undefined
}

/**
 * Read the identity facts off a live agent (or a harness event payload).
 *
 * @param agent - the agent (or a payload wrapping one).
 * @returns the agent id, the session id and the session's workspace cwd.
 */
export function agentIds(agent: unknown): AgentIds {
  // The payload read as an agent shape, because callers pass whatever the harness emitted.
  const candidate = (agent ?? {}) as AgentLike
  // The agent id, accepted only as a string.
  const id = typeof candidate.id === "string" ? candidate.id : ""
  // The session id, accepted only as a string.
  const sessionId = typeof candidate.session?.id === "string" ? candidate.session.id : ""
  // The session's cwd, accepted only as a string; anything else reads as unstated.
  const cwd = typeof candidate.session?.header?.cwd === "string" ? candidate.session.header.cwd : undefined
  return { agentId: id, sessionId, cwd }
}

/**
 * Whether a live-team view is a TEAM the watchdog should watch.
 *
 * The adapter's readout is deliberately broad: the official service models every top-level
 * Session as the Lead of its own implicit Team, so a SOLO session appears there with exactly one
 * member (its own Lead row) and no tasks. Watching those would (a) report nothing — there is no
 * task to be silent on — and (b) key every solo session's heartbeats under the shared `captain`
 * member key instead of its own session key, which is a real regression for the store. A team is
 * therefore a view with at least one TEAMMATE row, or at least one task on its board.
 */
export function isWatchedTeam(view: DshTeamView): boolean {
  // The roster rows, read defensively because a view may carry a non-array.
  const members = Array.isArray(view.members) ? view.members : []
  if (members.some((member) => member.role === "teammate")) return true
  return Array.isArray(view.tasks) && view.tasks.length > 0
}

/** The generation token the watchdog's streak/stamp vocabulary uses for one task row. */
function generationToken(task: DshTeamTaskView): string | undefined {
  return typeof task.revision === "number" && Number.isFinite(task.revision) ? String(task.revision) : undefined
}

/** The Lead pseudo-row of a roster, or undefined when the view carries none. */
function leadRow(members: readonly DshTeamMemberView[]): DshTeamMemberView | undefined {
  return members.find((member) => member.role === "lead")
}

/**
 * Project one official Team view onto {@link TeamRecord}.
 *
 * The transform is total: a view with a missing/odd field yields the same record with that field
 * absent, never a throw — this runs inside a tick, and a watchdog that dies on a shape it did not
 * expect is worse than one that reports nothing about that team.
 *
 * @param view - one `dsh.teamLiveTeams()` row.
 * @returns the projected record.
 */
export function projectTeamView(view: DshTeamView): TeamRecord {
  // Roster rows as objects, dropping null or primitive entries a view may carry.
  const rawMembers = (Array.isArray(view.members) ? view.members : []).filter(
    (member): member is DshTeamMemberView => member !== null && typeof member === "object",
  )
  // The Lead pseudo-row, or undefined when the roster carries none.
  const lead = leadRow(rawMembers)
  // The Lead pseudo-row is NOT a roster member: it is the captain, and the captain is addressed
  // through `captainSessionId` (exactly the split the retired record used). Keeping it in
  // `members` would let a roster scan mistake the Lead for a teammate.
  const teammates = rawMembers.filter((member) => member.role !== "lead")
  // Board rows as objects, dropping null or primitive entries.
  const rawTasks = (Array.isArray(view.tasks) ? view.tasks : []).filter(
    (task): task is DshTeamTaskView => task !== null && typeof task === "object",
  )
  // The board tasks projected onto the watchdog's own task vocabulary.
  const tasks: TeamTask[] = rawTasks.map((task) => {
    // The task's owner name, when the board states a non-empty one.
    const owner = typeof task.ownerName === "string" && task.ownerName !== "" ? task.ownerName : undefined
    // The owner normalized so a Lead-owned task reads as the captain.
    const assignee = owner === OFFICIAL_LEAD_NAME ? CAPTAIN_KEY : owner
    // The generation token for this row: the board revision as a string, when numeric.
    const token = generationToken(task)
    return {
      id: String(task.id ?? ""),
      status: String(task.status ?? ""),
      ...(assignee === undefined ? {} : { assignee }),
      ...(typeof task.revision === "number" && Number.isFinite(task.revision) ? { attempt: task.revision } : {}),
      ...(token === undefined ? {} : { attemptId: token }),
      ...(owner === undefined ? {} : { dispatched: true }),
      ...(Array.isArray(task.blockedBy)
        ? { dependencies: (task.blockedBy as unknown[]).filter((id): id is string => typeof id === "string") }
        : {}),
    }
  })
  // Whether any teammate is live, which is what gives the roster its `active` phase word.
  const running = teammates.some((member) => member.status === "running" || member.status === "provisioning")
  return {
    id: String(view.teamId ?? ""),
    name: String(lead?.name ?? view.leadName ?? ""),
    // A word for the diagnostics: the roster has live work, or it is between dispatches.
    phase: running ? "active" : "idle",
    ...(typeof view.leadSessionId === "string" && view.leadSessionId !== "" ? { captainSessionId: view.leadSessionId } : {}),
    members: teammates.map((member) => ({
      id: String(member.id ?? ""),
      name: String(member.name ?? ""),
      ...(typeof member.status === "string" ? { status: member.status } : {}),
    })),
    tasks,
    activityAt: null,
    createdAt: null,
    approvedAt: null,
    raw: view as unknown as Record<string, unknown>,
  }
}

/**
 * The FACE of one MPD TEAM RECORD this plugin reads: the authoritative team plane's persisted shape
 * (`<workspace>/.mpd/team/teams/<teamId>.json`, owned by `mpd-team-core-plugin`).
 *
 * It is a NARROWED FACE rather than an import of that package's own `TeamRecord`, deliberately: the
 * two rows are separate packages and this bundle's cross-package coupling inventory
 * (`mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`) is FROZEN and may only
 * shrink, so a new compile-time dependency has to be argued in ANOTHER package's contract. Every
 * field below is one this module actually reads; a field the record grows is simply not seen, and
 * the test suite still types its fixtures with the RECORD's own type so the two are checked to agree.
 */
export interface MpdTeamRecord {
  /** mpd's own team identity (`team-<stamp>`), which is the id the dispatch gate asks about. */
  teamId?: string
  /** The team name the user reads. */
  name?: string
  /** The lifecycle word (`staged` | `active` | `idle` | `ended`). */
  phase?: string
  /** The Lead session this team belongs to. */
  leadSessionId?: string
  /** ISO instant the record was created; T-16's generation floor reads it. */
  createdAt?: string
  /** ISO instant the plan was approved, when it has been. */
  approvedAt?: string
  /** The roster, as far as this module reads it. */
  members?: ReadonlyArray<{ id?: string; name?: string; status?: string; executorRef?: string }>
  /** The board, as far as this module reads it. */
  tasks?: ReadonlyArray<{ id?: string; status?: string; owner?: string; revision?: number; blockedBy?: readonly string[] }>
}

/**
 * The structural face of the `mpdTeams` service — the AUTHORITATIVE team plane (AGENTS.md §1).
 *
 * It is resolved PER CALL by the caller (`ctx.get("mpdTeams", false)`), never captured at apply,
 * because the row that provides it may mount after this one and a composition may not run it at all.
 * `list` is synchronous and, in the shipped service, non-throwing; this module still guards it.
 */
export interface MpdTeamsRead {
  /** Every mpd team record in one workspace. */
  list(workspace: string): readonly MpdTeamRecord[]
}

/**
 * Whether an mpd record is a TEAM the watchdog should watch.
 *
 * The same rule {@link isWatchedTeam} applies to an official view: a record with no roster and no
 * board is a staged SHELL nothing has been spawned into, so watching it would report nothing while
 * keying heartbeats onto a team that has no members.
 *
 * @param record - one mpd team record.
 * @returns true when the record carries a roster row or a board row.
 */
export function isWatchedMpdRecord(record: MpdTeamRecord): boolean {
  // The roster rows, read defensively because a hand-written record may carry a non-array.
  const members = Array.isArray(record.members) ? record.members : []
  if (members.length > 0) return true
  return Array.isArray(record.tasks) && record.tasks.length > 0
}

/** One ISO instant read as epoch ms, or null when it is absent or unparseable. */
function epochOf(iso: string | undefined): number | null {
  /** The parsed instant, NaN when the field is absent or not a date. */
  const parsed = typeof iso === "string" ? Date.parse(iso) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Project one MPD TEAM RECORD onto {@link TeamRecord}.
 *
 * WHY THIS IS THE PRIMARY READ (T1/T3): the mpd record is the authoritative team plane, and it is
 * the plane `agent_teams_dispatch` asks about — its gate calls
 * `watchdog.isHeld(record.teamId, workspace)` with the mpd-minted `team-<stamp>`. Projecting the
 * record therefore makes the two id spaces COINCIDE (`id` is the record's own `teamId`), which is
 * what lets a hold filed under `team.id` be found again. Reading only the official fold kept the
 * watchdog keyed by the Lead Session id, so `isHeld` missed every hold and the ladder watched zero
 * teams in the DEFAULT (native) composition.
 *
 * A member's identity is the EXECUTOR's handle (the session id the agent registry keys on), never
 * mpd's short `M1`; a member that was never spawned has no handle and reads as the empty string,
 * the same "staged" convention this bundle's compaction uses.
 *
 * The transform is total: an odd or missing field yields the same record with that field absent.
 *
 * @param record - one `mpdTeams.list(workspace)` row.
 * @returns the projected record.
 */
export function projectMpdTeam(record: MpdTeamRecord): TeamRecord {
  // The roster, projected onto the fields the watchdog's identity resolution reads.
  const members: TeamMember[] = (Array.isArray(record.members) ? record.members : []).map((member) => ({
    id: typeof member.executorRef === "string" ? member.executorRef : "",
    name: String(member.name ?? ""),
    ...(typeof member.status === "string" ? { status: member.status } : {}),
  }))
  // The board, projected onto the watchdog's task vocabulary.
  const tasks: TeamTask[] = (Array.isArray(record.tasks) ? record.tasks : []).map((task) => {
    // The task's own mpd revision, which is the generation counter a stamp is scoped to.
    const revision = typeof task.revision === "number" && Number.isFinite(task.revision) ? task.revision : undefined
    // The owner, when the record names one; the empty string is the store's "unowned".
    const owner = typeof task.owner === "string" && task.owner !== "" ? task.owner : undefined
    return {
      id: String(task.id ?? ""),
      status: String(task.status ?? ""),
      ...(owner === undefined ? {} : { assignee: owner, dispatched: true }),
      ...(revision === undefined ? {} : { attempt: revision, attemptId: String(revision) }),
      ...(Array.isArray(task.blockedBy)
        // The parameter is annotated because `Array.isArray` widens a `readonly string[]` to `any[]`.
        ? { dependencies: task.blockedBy.filter((id: unknown): id is string => typeof id === "string") }
        : {}),
    }
  })
  return {
    // THE ID THAT MATTERS: mpd's own `team-<stamp>`, which is what the dispatch gate asks about.
    id: String(record.teamId ?? ""),
    name: String(record.name ?? ""),
    ...(typeof record.phase === "string" ? { phase: record.phase } : {}),
    ...(typeof record.leadSessionId === "string" && record.leadSessionId !== "" ? { captainSessionId: record.leadSessionId } : {}),
    members,
    tasks,
    // DELIBERATELY null, and NOT mapped from a task's `updatedAt`: this field arms the r4 dead-record
    // bound (`tickable: false` once the newest activity is older than `deadTeamGraceMs`), which is
    // inert while it is null. Arming it is a separate decision about a safety mechanism, not part of
    // reading the record, so the honest projection leaves it where the official plane left it.
    activityAt: null,
    // T-16's generation floor: the record DOES carry these, and a member only ever exists after the
    // instant its team was created, so the floor cannot drop a legitimate stamp.
    createdAt: epochOf(record.createdAt),
    approvedAt: epochOf(record.approvedAt),
    raw: record as unknown as Record<string, unknown>,
  }
}

/**
 * Every Team the bundle watches for one workspace, MPD record FIRST.
 *
 * The mpd record is the authoritative plane (AGENTS.md §1) and the one the dispatch gate names, so
 * it is read first; the OFFICIAL fold (`dsh.teamLiveTeams()`) stays as the FALLBACK for a
 * composition that runs the official executor and mounts no mpd record. The two are deliberately NOT
 * unioned: one team visible on both planes would be reported twice under two different ids, which is
 * the very drift this read exists to end.
 *
 * Degrade: `[]` when neither plane answers, and the official fold when the mpd read is absent,
 * empty or throwing. This is the read the tick, the actions and the status tool all use, so an
 * absent service reads as "no team to report" — never as an exception inside a tick.
 *
 * @param dsh - the adapter (the ONE harness contact surface).
 * @param workspace - the workspace whose mpd records are read; resolved per call by the caller.
 * @param mpdTeams - the `mpdTeams` service face, or undefined when this composition has none.
 * @returns the projected records, mpd records first when the mpd plane answers.
 */
export function readTeams(dsh: DshAdapter, workspace: string, mpdTeams?: MpdTeamsRead | undefined): TeamRecord[] {
  if (mpdTeams !== undefined) {
    try {
      // The mpd readout for this workspace; a half-mounted service that throws falls through.
      const records = mpdTeams.list(workspace)
      if (Array.isArray(records) && records.length > 0) {
        return records.filter(isWatchedMpdRecord).map(projectMpdTeam)
      }
    } catch {
      // fall through to the official fold: an unreadable mpd plane must not blind the watchdog
    }
  }
  // The adapter's live readout; an absent team service degrades to the empty list below.
  let views: DshTeamView[]
  try {
    views = dsh.teamLiveTeams() ?? []
  } catch {
    return []
  }
  return views.filter(isWatchedTeam).map(projectTeamView)
}

/**
 * One Team by id, or undefined when neither plane carries it.
 * @param dsh - the adapter.
 * @param workspace - the workspace whose mpd records are read.
 * @param teamId - the team id asked about (an mpd `team-<stamp>`, or an official Lead Session id).
 * @param mpdTeams - the `mpdTeams` service face, or undefined.
 * @returns the projected record, or undefined.
 */
export function readTeam(dsh: DshAdapter, workspace: string, teamId: string, mpdTeams?: MpdTeamsRead | undefined): TeamRecord | undefined {
  // The requested team id as a string, because a caller may pass a non-string.
  const wanted = String(teamId)
  return readTeams(dsh, workspace, mpdTeams).find((team) => team.id === wanted)
}

/**
 * The watched team ids in this workspace (sorted).
 * @param dsh - the adapter.
 * @param workspace - the workspace whose mpd records are read.
 * @param mpdTeams - the `mpdTeams` service face, or undefined.
 * @returns the sorted ids.
 */
export function listTeamIds(dsh: DshAdapter, workspace: string, mpdTeams?: MpdTeamsRead | undefined): string[] {
  return readTeams(dsh, workspace, mpdTeams)
    .map((team) => team.id)
    .sort()
}

/** Every non-terminal task of a team, in record order. */
export function liveTasks(team: TeamRecord): TeamTask[] {
  return team.tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status))
}

/**
 * T-20 (§8): is this member blocked on unfinished dependencies?
 *
 * A member whose ONLY open tasks are blocked by dependencies that are not terminal has
 * nothing claimable: it is WAITING, not silent, and the watchdog must report it `PARKED`
 * rather than warn about it. Derived from the readout alone.
 *
 * Two deliberate readings, both conservative in the SAFE direction for a watchdog:
 *   * a dependency naming a task that is NOT in the readout counts as unfinished — a task that
 *     cannot be shown finished has not been shown finished;
 *   * a member with NO open task is not "blocked" (there is nothing to wait for), which is the
 *     `candidateFor` precondition's job, not this one.
 *
 * @param team - the projected record.
 * @param assignee - the member name (or `captain`).
 * @returns whether every open task of that member waits on an unfinished dependency, with the
 *          blocking ids for diagnostics.
 */
export function dependencyBlocked(team: TeamRecord, assignee: string): { blocked: boolean; waiting: string[] } {
  // The member's non-terminal tasks, whose dependencies decide the blocked answer.
  const owned = liveTasks(team).filter((task) => task.assignee === assignee)
  if (owned.length === 0) return { blocked: false, waiting: [] }
  // Blocking dependency ids collected across those tasks, for diagnostics.
  const waiting: string[] = []
  // Whether EVERY open task of the member waits on an unfinished dependency.
  const blocked = owned.every((task) => {
    // The dependencies this task declares; absent means "no dependency".
    const deps = task.dependencies ?? []
    // Declared dependencies that are not terminal, or not present in the readout at all.
    const unfinished = deps.filter((id) => {
      // The dependency's task row, absent when the readout does not carry it.
      const target = team.tasks.find((candidate) => candidate.id === id)
      return target === undefined || !TERMINAL_STATUSES.includes(target.status)
    })
    waiting.push(...unfinished)
    return unfinished.length > 0
  })
  return { blocked, waiting: [...new Set(waiting)].sort() }
}

/**
 * The task one assignee currently owns, or undefined.
 *
 * Preference order: `in_progress`, then the official board's owned-and-pending row, then
 * `pending`. A member with an explicitly owned pooled task keeps it in every status the field
 * distinguishes, so the attempt the heartbeat is attributed to is the task the member is
 * actually expected to advance.
 */
export function currentTask(team: TeamRecord, assignee: string): TeamTask | undefined {
  // The member's non-terminal tasks; an empty list answers "owns nothing".
  const owned = liveTasks(team).filter((task) => task.assignee === assignee)
  if (owned.length === 0) return undefined
  for (const status of ["in_progress", "claimed", "pending"]) {
    // The task in the status now being considered, if the member has one.
    const found = owned.filter((task) => task.status === status)
    if (found.length > 0) return found[found.length - 1]
  }
  return owned[owned.length - 1]
}

/** Who a live agent is, in the team's vocabulary. */
export interface Identity {
  /** The member name (or `captain`), or null when the agent is not in this team. */
  member: string | null
  /** True when the agent is this team's Lead, matched by Lead Session id. */
  isCaptain: boolean
  /** The agent's own id. */
  agentId: string
  /** The agent's session id. */
  sessionId: string
}

/**
 * Resolve a live agent against a team record.
 *
 * The captain is matched by the team's Lead Session id; members are matched by agent id (which
 * the official roster carries as the member's Session id — the same identity the agent registry
 * keys on). An agent that matches neither belongs to no team of this workspace and is stamped
 * under a per-session key instead of being dropped (the stamp is still evidence that the process
 * is alive, and the file key keeps writers disjoint).
 */
export function resolveIdentity(team: TeamRecord | undefined, agent: unknown): Identity {
  // The identity facts read off the live agent.
  const ids = agentIds(agent)
  if (team === undefined) return { member: null, isCaptain: false, ...ids }
  if (ids.sessionId !== "" && team.captainSessionId === ids.sessionId) {
    return { member: CAPTAIN_KEY, isCaptain: true, ...ids }
  }
  // The roster row whose id is this agent, which is how a teammate is matched.
  const byAgent = team.members.find((entry) => entry.id !== "" && entry.id === ids.agentId)
  if (byAgent !== undefined) return { member: byAgent.name, isCaptain: false, ...ids }
  return { member: null, isCaptain: false, ...ids }
}

/**
 * The team in `teams` a live agent belongs to, or undefined.
 *
 * When the agent matches a member/captain of exactly one team that team wins.
 * When it belongs to none (a plain session, or a staged agent with no id yet)
 * the caller gets `undefined` and stamps under its session key.
 */
export function teamOf(teams: readonly TeamRecord[], agent: unknown): TeamRecord | undefined {
  for (const team of teams) {
    // This team's identity for the agent, non-null only when it resolves to a member.
    const identity = resolveIdentity(team, agent)
    if (identity.member !== null) return team
  }
  return undefined
}
