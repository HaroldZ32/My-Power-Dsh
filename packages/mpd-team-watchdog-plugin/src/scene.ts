// The scene snapshot: everything a human (or a restarting process) needs to
// understand WHY a team was flagged, written to disk atomically and read back by
// a fresh process (AC-5/AC-6).
//
// Field set is the frozen AC-5 list and nothing else (design §3.1):
//
//   { schemaVersion, at, reason, cause:{kind,ms},
//     team:{id,name,phase,halted,haltedAt,hold},
//     tasks:[{id,status,assignee,attempt,attemptId,lastSeen,streak}],
//     members:[{id,name,status,unread,currentTask,lastSeen}],
//     mailbox:{<reader>:watermark},
//     parkedAttempts:{<memberId>:<attemptId>},
//     incidents:[{id,kind,at,taskId,attemptId,scene}] }
//
// Two honest projections are documented in the package README:
//   * `members[].unread` mirrors the adopted unread predicate (`state.js:845-855`)
//     because no adapter seam exposes it; the mirror is one function with the
//     citation, and a drift in the adopted predicate would make this count stale,
//     never wrong in a load-bearing way.
//   * `parkedAttempts` is the DURABLE projection (assignee -> attemptId of every
//     non-terminal task), not the adopted scheduler's in-process `Map`, which no
//     adapter seam exposes. The design already calls it advisory (§3.2).
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { safeSegment, sceneDir, teamDir } from "./paths.js"
import { message, readHeartbeats, writeFileAtomic } from "./store.js"
import type { HeartbeatStamp } from "./store.js"
import { TERMINAL_STATUSES, type TeamRecord, type TeamTask } from "./team.js"
import type { HoldRecord, IncidentKind } from "./sidecars.js"

/** The mailbox delivery lease the adopted plugin uses (`state.js` MAILBOX_DELIVERY_LEASE_MS). */
export const MAILBOX_DELIVERY_LEASE_MS = 60_000

/** The scene's frozen schema version. */
export const SCENE_SCHEMA_VERSION = 1

/** The hold as it appears inside a scene (the durable sidecar's identity fields). */
export interface SceneHold {
  id: string
  since: number
  cause: string
  taskId: string | null
  attemptId: string | null
}

/** One task row of the scene. */
export interface SceneTask {
  id: string
  status: string
  assignee: string | null
  attempt: number | null
  attemptId: string | null
  lastSeen: number | null
  streak: number
}

/** One member row of the scene. */
export interface SceneMember {
  id: string
  name: string
  status: string | null
  unread: number | null
  currentTask: string | null
  lastSeen: number | null
}

/** One incident row carried inside a scene. */
export interface SceneIncident {
  id: string
  /**
   * The durable incident vocabulary (r6 widens it): a scene is written for a WARN or an
   * ESCALATE, and its incident list is the team's recent history — which now also carries the
   * WARN-class `never-started` and `tool-expired` records.
   */
  kind: IncidentKind
  at: number
  taskId: string | null
  attemptId: string | null
  scene: string | null
}

/** The complete scene document. */
export interface Scene {
  schemaVersion: number
  at: number
  reason: "warn" | "escalate"
  cause: { kind: "silence"; ms: number }
  team: {
    id: string
    name: string
    phase: string | null
    halted: boolean | null
    haltedAt: number | null
    hold: SceneHold | null
  }
  tasks: SceneTask[]
  members: SceneMember[]
  mailbox: Record<string, number>
  parkedAttempts: Record<string, string>
  incidents: SceneIncident[]
}

/** Everything `buildScene` needs; assembled by the tick, injectable in tests. */
export interface SceneInput {
  team: TeamRecord
  reason: "warn" | "escalate"
  at: number
  silenceMs: number
  hold: HoldRecord | null
  mailbox: Record<string, number>
  incidents: SceneIncident[]
  /** Streak counts by `taskId\0attemptId`. */
  streaks: Record<string, number>
  /** Heartbeat stamps per member key. */
  heartbeat: (memberKey: string) => readonly HeartbeatStamp[]
  /** Read-only unread count for one member key. */
  unread: (memberKey: string) => number | null
}

/** The heartbeats' newest stamp among the ones attributed to one task. */
function newestForTask(stamps: readonly HeartbeatStamp[], taskId: string, attemptId: string | null, teamId?: string): number | null {
  let newest: number | null = null
  for (const stamp of stamps) {
    if (stamp.taskId !== taskId) continue
    // TEAM SCOPE (r2): the file is shared by same-named members of different teams, so the
    // scene's per-task `lastSeen` must not report the other team's activity. A stamp with no
    // team cannot contradict and is kept.
    if (teamId !== undefined && stamp.teamId !== undefined && stamp.teamId !== null && stamp.teamId !== "" && stamp.teamId !== teamId) continue
    if (attemptId !== null && stamp.attemptId !== null && stamp.attemptId !== attemptId) continue
    if (newest === null || stamp.at >= newest) newest = stamp.at
  }
  return newest
}

/** The newest stamp of any kind for one member key. */
function newestOverall(stamps: readonly HeartbeatStamp[]): number | null {
  let newest: number | null = null
  for (const stamp of stamps) if (newest === null || stamp.at >= newest) newest = stamp.at
  return newest
}

/** Build the AC-5 scene document from the current observations. */
export function buildScene(input: SceneInput): Scene {
  const { team } = input
  const tasks: SceneTask[] = team.tasks.map((task: TeamTask) => ({
    id: task.id,
    status: task.status,
    assignee: task.assignee ?? null,
    attempt: task.attempt ?? null,
    attemptId: task.attemptId ?? null,
    lastSeen: newestForTask(input.heartbeat(safeSegment(task.assignee ?? "")), task.id, task.attemptId ?? null, team.id),
    // The streak map is keyed by `streakKey(teamId, taskId, attemptId)`; the team id is part of
    // the key because task ids are per-team (w11/W11-1).
    streak: input.streaks[team.id + "\u0000" + task.id + "\u0000" + (task.attemptId ?? "")] ?? 0,
  }))
  const members: SceneMember[] = team.members.map((member) => {
    const key = safeSegment(member.name)
    const stamps = input.heartbeat(key)
    const owned = team.tasks.filter((task) => task.assignee === member.name && !TERMINAL_STATUSES.includes(task.status))
    return {
      id: member.id,
      name: member.name,
      status: member.status ?? null,
      unread: input.unread(key),
      currentTask: owned.length === 0 ? null : owned[owned.length - 1].id,
      lastSeen: newestOverall(stamps),
    }
  })
  const parkedAttempts: Record<string, string> = {}
  for (const task of team.tasks) {
    if (TERMINAL_STATUSES.includes(task.status)) continue
    if (task.assignee === undefined || task.attemptId === undefined) continue
    const member = team.members.find((entry) => entry.name === task.assignee)
    parkedAttempts[member?.id ?? task.assignee] = task.attemptId
  }
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    at: input.at,
    reason: input.reason,
    cause: { kind: "silence", ms: input.silenceMs },
    team: {
      id: team.id,
      name: team.name,
      phase: team.phase ?? null,
      halted: team.halted ?? null,
      haltedAt: team.haltedAt ?? null,
      hold:
        input.hold === null
          ? null
          : {
              id: input.hold.id,
              since: input.hold.since,
              cause: input.hold.cause,
              taskId: input.hold.taskId,
              attemptId: input.hold.attemptId,
            },
    },
    tasks,
    members,
    mailbox: input.mailbox,
    parkedAttempts,
    incidents: input.incidents,
  }
}

/** An ISO-8601 basic timestamp (`20260915T154132Z`) usable as a file name. */
export function isoBasic(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

/** The outcome of writing a scene; `ok:false` is loud and never fatal. */
export interface SceneWriteResult {
  ok: boolean
  /** The immutable per-incident scene file (absent when the write failed). */
  path: string | null
  /** The `latest.json` pointer (absent when the write failed). */
  latestPath: string | null
  bytes: number
  error?: string
}

/**
 * Write one immutable scene file plus the `latest.json` pointer.
 *
 * Both writes are temp+rename, so a torn read is impossible; `latest.json` skips
 * the write when the bytes are identical (AC-6 idempotence). A failure is
 * returned, never thrown: an unwritable scene location must degrade loudly
 * WITHOUT killing the host (AC-15).
 */
export function writeScene(
  workspace: string,
  stateDir: string,
  teamId: string,
  scene: Scene,
  at: number,
): SceneWriteResult {
  const dir = sceneDir(workspace, stateDir, teamId)
  const base = isoBasic(at) + "-" + scene.reason
  let path = join(dir, base + ".json")
  let suffix = 1
  try {
    while (existsSync(path)) {
      suffix += 1
      path = join(dir, base + "-" + suffix + ".json")
      if (suffix > 1000) break
    }
  } catch {
    // an unreadable directory surfaces on the write below
  }
  const text = JSON.stringify(scene, null, 2) + "\n"
  const written = writeFileAtomic(path, text)
  if (written.error !== undefined) {
    return { ok: false, path: null, latestPath: null, bytes: 0, error: written.error }
  }
  const latest = writeFileAtomic(join(dir, "latest.json"), text)
  if (latest.error !== undefined) {
    // The immutable file landed; only the pointer failed. Still loud.
    return { ok: false, path, latestPath: null, bytes: Buffer.byteLength(text), error: latest.error }
  }
  return { ok: true, path, latestPath: latest.path, bytes: Buffer.byteLength(text) }
}

/**
 * Read a scene back from disk (the fresh-process read path of AC-5).
 *
 * @param path - the scene file, or a team's scene directory (then `latest.json`).
 * @returns the parsed scene, or undefined when it is absent/unreadable.
 */
export function readScene(path: string): Scene | undefined {
  const file = path.endsWith(".json") ? path : join(path, "latest.json")
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Scene
    if (parsed === null || typeof parsed !== "object") return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Count a member's UNREAD mail, mirroring the adopted predicate
 * (`packages/mpd-agent-teams-plugin/lib/state.js:845-855`): a record is unread
 * when it is not a tombstone, has no `readAt`, and either has no
 * `deliveryClaimedAt` or its claim lease has expired.
 *
 * @returns the count, or null when the mailbox cannot be read.
 */
export function mailboxUnread(
  workspace: string,
  stateDir: string,
  teamId: string,
  agentKey: string,
  now: number,
  leaseMs: number = MAILBOX_DELIVERY_LEASE_MS,
): number | null {
  const file = join(teamDir(workspace, stateDir, teamId), "inbox", safeSegment(agentKey) + ".jsonl")
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return 0
  }
  let count = 0
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\uFEFF/, "").trim()
    if (line === "") continue
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      if (value === null || typeof value !== "object") continue
      if (value.tombstone === true) continue
      if (value.readAt !== undefined) continue
      const claimed = value.deliveryClaimedAt
      if (typeof claimed === "number" && now - claimed < leaseMs) continue
      count += 1
    } catch {
      // malformed line: the adopted reader skips it too
    }
  }
  return count
}

/** Re-export so callers can report a scene write failure consistently. */
export { message as sceneErrorMessage }

/** Convenience: the heartbeat reader a scene needs, bound to one workspace. */
export function heartbeatReader(
  workspace: string,
  stateDir: string,
): (memberKey: string) => readonly HeartbeatStamp[] {
  return (memberKey: string) => readHeartbeats(workspace, stateDir, memberKey)
}
