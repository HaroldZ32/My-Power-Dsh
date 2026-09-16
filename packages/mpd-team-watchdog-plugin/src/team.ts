// READ-ONLY view over the adopted agent-teams state.
//
// This module never writes: `team.json` belongs to `packages/mpd-agent-teams-plugin/lib/state.js`,
// which keeps sole ownership of the record (design §1.3 / §5-H2b). Everything the
// watchdog needs from it — the team's phase/halt flags, its tasks with their
// attempt ids, and its member roster — is read here and never mutated.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { teamPath } from "./paths.js"

/** Task statuses the watchdog never considers live (mirrors `TERMINAL_TASK_STATUSES`). */
export const TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"]

/** The captain's mailbox key inside the adopted record. */
export const CAPTAIN_KEY = "captain"

/** One task of the adopted record (only the fields the watchdog reads). */
export interface TeamTask {
  id: string
  status: string
  assignee?: string
  attempt?: number
  attemptId?: string
  updatedAt?: number
}

/** One member of the adopted record (only the fields the watchdog reads). */
export interface TeamMember {
  id: string
  name: string
  status?: string
}

/** The adopted team record, projected to what the watchdog reads. */
export interface TeamRecord {
  id: string
  name: string
  phase?: string
  halted?: boolean
  haltedAt?: number
  captainSessionId?: string
  members: TeamMember[]
  tasks: TeamTask[]
  /**
   * The newest activity timestamp in the record: the latest task `updatedAt`, else the record's
   * own `updatedAt`/`approvedAt`/`createdAt`. This is the input to the DEAD-TEAM fallback (r4): a
   * record nobody has touched for days cannot dispatch, so ticking it only manufactures noise.
   */
  activityAt: number | null
  /** The raw parsed record, kept for byte-level honesty checks in tests/lanes. */
  raw: Record<string, unknown>
}

/** A live agent, as far as identity resolution needs to see it. */
export interface AgentLike {
  id?: unknown
  session?: { id?: unknown; header?: { cwd?: unknown } }
  [key: string]: unknown
}

/** What an agent's session says about who it is. */
export interface AgentIds {
  agentId: string
  sessionId: string
  cwd: string | undefined
}

/**
 * Read the identity facts off a live agent (or a harness event payload).
 *
 * @param agent - the agent (or a payload wrapping one).
 * @returns the agent id, the session id and the session's workspace cwd.
 */
export function agentIds(agent: unknown): AgentIds {
  const candidate = (agent ?? {}) as AgentLike
  const id = typeof candidate.id === "string" ? candidate.id : ""
  const sessionId = typeof candidate.session?.id === "string" ? candidate.session.id : ""
  const cwd = typeof candidate.session?.header?.cwd === "string" ? candidate.session.header.cwd : undefined
  return { agentId: id, sessionId, cwd }
}

/** The newest activity timestamp a raw record carries, or null when it carries none. */
function recordActivityAt(raw: Record<string, unknown>): number | null {
  const candidates: number[] = []
  if (Array.isArray(raw.tasks)) {
    for (const task of raw.tasks as Record<string, unknown>[]) {
      if (task !== null && typeof task === "object" && typeof task.updatedAt === "number") candidates.push(task.updatedAt)
    }
  }
  for (const field of ["updatedAt", "approvedAt", "createdAt"]) {
    const value = raw[field]
    if (typeof value === "number") candidates.push(value)
  }
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

/** Parse one team record; `undefined` when it is absent or unreadable. */
export function readTeam(workspace: string, stateDir: string, teamId: string): TeamRecord | undefined {
  let text: string
  try {
    text = readFileSync(teamPath(workspace, stateDir, teamId), "utf8")
  } catch {
    return undefined
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw === null || typeof raw !== "object") return undefined
    const members = Array.isArray(raw.members) ? (raw.members as Record<string, unknown>[]) : []
    const tasks = Array.isArray(raw.tasks) ? (raw.tasks as Record<string, unknown>[]) : []
    return {
      id: String(raw.id ?? teamId),
      name: String(raw.name ?? raw.id ?? teamId),
      ...(typeof raw.phase === "string" ? { phase: raw.phase } : {}),
      ...(typeof raw.halted === "boolean" ? { halted: raw.halted } : {}),
      ...(typeof raw.haltedAt === "number" ? { haltedAt: raw.haltedAt } : {}),
      ...(typeof raw.captainSessionId === "string" ? { captainSessionId: raw.captainSessionId } : {}),
      members: members
        .filter((member) => member !== null && typeof member === "object")
        .map((member) => ({
          id: String(member.id ?? ""),
          name: String(member.name ?? ""),
          ...(typeof member.status === "string" ? { status: member.status } : {}),
        })),
      tasks: tasks
        .filter((task) => task !== null && typeof task === "object")
        .map((task) => ({
          id: String(task.id ?? ""),
          status: String(task.status ?? ""),
          ...(typeof task.assignee === "string" ? { assignee: task.assignee } : {}),
          ...(typeof task.attempt === "number" ? { attempt: task.attempt } : {}),
          ...(typeof task.attemptId === "string" ? { attemptId: task.attemptId } : {}),
          ...(typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}),
        })),
      activityAt: recordActivityAt(raw),
      raw,
    }
  } catch {
    return undefined
  }
}

/** The team ids that have a readable record in this workspace (sorted). */
export function listTeamIds(workspace: string, stateDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(join(workspace, stateDir))
  } catch {
    return []
  }
  const ids: string[] = []
  for (const entry of entries) {
    if (entry === "watchdog" || entry === "archive" || entry.startsWith(".")) continue
    const dir = join(workspace, stateDir, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      statSync(join(dir, "team.json"))
    } catch {
      continue
    }
    ids.push(entry)
  }
  return ids.sort()
}

/** Every readable team record in this workspace. */
export function readTeams(workspace: string, stateDir: string): TeamRecord[] {
  const teams: TeamRecord[] = []
  for (const id of listTeamIds(workspace, stateDir)) {
    const team = readTeam(workspace, stateDir, id)
    if (team !== undefined) teams.push(team)
  }
  return teams
}

/** Every non-terminal task of a team, in record order. */
export function liveTasks(team: TeamRecord): TeamTask[] {
  return team.tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status))
}

/**
 * The task one assignee currently owns, or undefined.
 *
 * Preference order: `in_progress`, then `claimed`, then `pending`. A member with
 * an explicitly assigned pooled task keeps it in every status the field
 * distinguishes, so the attempt the heartbeat is attributed to is the task the
 * member is actually expected to advance.
 */
export function currentTask(team: TeamRecord, assignee: string): TeamTask | undefined {
  const owned = liveTasks(team).filter((task) => task.assignee === assignee)
  if (owned.length === 0) return undefined
  for (const status of ["in_progress", "claimed", "pending"]) {
    const found = owned.filter((task) => task.status === status)
    if (found.length > 0) return found[found.length - 1]
  }
  return owned[owned.length - 1]
}

/** Who a live agent is, in the team's vocabulary. */
export interface Identity {
  /** The member name (or `captain`), or null when the agent is not in this team. */
  member: string | null
  isCaptain: boolean
  agentId: string
  sessionId: string
}

/**
 * Resolve a live agent against a team record.
 *
 * Members are matched by agent id (the durable record's `members[].id`); the
 * captain is matched by the team's `captainSessionId`. An agent that matches
 * neither belongs to no team of this workspace and is stamped under a
 * per-session key instead of being dropped (the stamp is still evidence that the
 * process is alive, and the file key keeps writers disjoint).
 */
export function resolveIdentity(team: TeamRecord | undefined, agent: unknown): Identity {
  const ids = agentIds(agent)
  if (team === undefined) return { member: null, isCaptain: false, ...ids }
  if (ids.sessionId !== "" && team.captainSessionId === ids.sessionId) {
    return { member: CAPTAIN_KEY, isCaptain: true, ...ids }
  }
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
    const identity = resolveIdentity(team, agent)
    if (identity.member !== null) return team
  }
  return undefined
}
