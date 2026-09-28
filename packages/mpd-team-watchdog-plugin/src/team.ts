// READ-ONLY projection of the OFFICIAL Agent Teams readout.
//
// 0.1.7 retired the vendored `mpd-agent-teams-plugin` and its `<stateDir>/<teamId>/team.json`
// record: team state now lives in the LEAD SESSION LOG of the official
// `@deepseek-ai/dsh-experimental-agent-team` service and is read through the adapter
// (`dsh.teamLiveTeams()`), which folds the live agent registry into one view per live Team.
//
// This module never writes and never reads a team file: it PROJECTS the adapter's
// {@link DshTeamView} onto the vocabulary the watchdog's fold was written in, so the four-state
// machine, the heartbeat store and the scene schema keep their meaning. Every projection below
// is field-for-field and named, because a silent mismatch here is a watchdog that watches the
// wrong thing.
//
// WHAT THE OFFICIAL VIEW DOES NOT CARRY, and what replaces it (stated, never hidden):
//   * `attemptId` — the official board has NO per-attempt id. It has a monotonic, every-mutation
//     `revision` (compare-and-set), which plays the SAME role: a re-claim, a re-open or an edit
//     starts a new generation, so a stale streak/stamp cannot be spent on it. `attemptId` is
//     therefore the revision rendered as a string.
//   * `createdAt`/`approvedAt` — no record timestamps exist, so T-16's generation floor is
//     `null` (PERMISSIVE, the documented §0/A3 convention): the revision in the streak key is
//     what scopes a stamp to a generation now.
//   * `activityAt` — likewise absent. It only fed the r4 dead-record fallback, and a team can no
//     longer APPEAR in the readout without a live agent, so a dead record cannot be read at all.
//   * `halted`/`haltedAt`/`phase` — the official service exposes no halt; `phase` is DERIVED
//     here from the roster's live statuses so the diagnostics keep a word for it.
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
 * Every Team the adapter's live readout reports, projected and filtered to REAL teams.
 *
 * Degrade: `[]` when the adapter cannot answer (no team service, no agent registry, or a stub
 * without the seam). This is the read the tick and the status tool both use, so an absent service
 * reads as "no team to report" — never as an exception inside a tick.
 *
 * @param dsh - the adapter (the ONE harness contact surface).
 * @returns the projected records, in adapter order.
 */
export function readTeams(dsh: DshAdapter): TeamRecord[] {
  // The adapter's live readout; an absent team service degrades to the empty list below.
  let views: DshTeamView[]
  try {
    views = dsh.teamLiveTeams() ?? []
  } catch {
    return []
  }
  return views.filter(isWatchedTeam).map(projectTeamView)
}

/** One Team by id, or undefined when the live readout does not carry it. */
export function readTeam(dsh: DshAdapter, teamId: string): TeamRecord | undefined {
  // The requested team id as a string, because a caller may pass a non-string.
  const wanted = String(teamId)
  return readTeams(dsh).find((team) => team.id === wanted)
}

/** The watched team ids in this process (sorted). */
export function listTeamIds(dsh: DshAdapter): string[] {
  return readTeams(dsh)
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
