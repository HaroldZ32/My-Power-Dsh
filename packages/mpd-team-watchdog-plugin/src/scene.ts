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
// Three honest projections are documented in the package README:
//   * `team.*` is the PROJECTED official readout (`src/team.ts`): `attemptId` is the official
//     board revision and `halted`/`activityAt` have no official source, which is why the engine
//     passes `null` for them.
//   * `members[].unread` is always `null`: the official peer mailbox is durable in the LEAD
//     SESSION LOG (`team/message/queued` / `team/message/delivered`) and NO adapter seam exposes
//     a per-member unread count. The retired record's `<teamDir>/inbox/*.jsonl` mirror is gone
//     with the plugin that wrote it, and `null` ("not observable") is the honest answer — a
//     fabricated 0 would claim the mailbox was read.
//   * `parkedAttempts` is the DURABLE projection (assignee -> generation token of every
//     non-terminal task), not an in-process scheduler map, which no adapter seam exposes. The
//     design already calls it advisory (§3.2).
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { safeSegment, sceneDir } from "./paths.js"
import { message, readHeartbeats, writeFileAtomic } from "./store.js"
import type { HeartbeatStamp } from "./store.js"
import { TERMINAL_STATUSES, type TeamRecord, type TeamTask } from "./team.js"
import type { HoldRecord, IncidentKind } from "./sidecars.js"

/** The scene's frozen schema version. */
export const SCENE_SCHEMA_VERSION = 1

/** The hold as it appears inside a scene (the durable sidecar's identity fields). */
export interface SceneHold {
  /** The durable hold's id. */
  id: string
  /** Epoch ms at which the hold was raised. */
  since: number
  /** The recorded reason for the hold. */
  cause: string
  /** The task whose silence raised the hold, when known. */
  taskId: string | null
  /** That task's attempt id at escalation time, when known. */
  attemptId: string | null
}

/** One task row of the scene. */
export interface SceneTask {
  /** The OFFICIAL task id. */
  id: string
  /** The board status verbatim at snapshot time. */
  status: string
  /** The owning member's name, or null when the task is unowned. */
  assignee: string | null
  /** The official board revision (the generation counter), or null. */
  attempt: number | null
  /** That revision rendered as the generation token, or null. */
  attemptId: string | null
  /** Newest heartbeat stamp for this task+attempt, or null when never stamped. */
  lastSeen: number | null
  /** Consecutive WARN observations recorded for this task+attempt. */
  streak: number
}

/** One member row of the scene. */
export interface SceneMember {
  /** The member's Session id, i.e. the identity the roster carries. */
  id: string
  /** The member's display name. */
  name: string
  /** The live status verbatim, or null when the readout states none. */
  status: string | null
  /** Always null: no adapter seam exposes a per-member unread count. */
  unread: number | null
  /** The member's newest non-terminal task id, or null when it owns none. */
  currentTask: string | null
  /** Newest heartbeat stamp of any kind for this member, or null. */
  lastSeen: number | null
}

/** One incident row carried inside a scene. */
export interface SceneIncident {
  /** The durable incident's id. */
  id: string
  /**
   * The durable incident vocabulary (r6 widens it): a scene is written for a WARN or an
   * ESCALATE, and its incident list is the team's recent history — which now also carries the
   * WARN-class `never-started` and `tool-expired` records.
   */
  kind: IncidentKind
  /** Epoch ms at which the incident was recorded. */
  at: number
  /** The task the incident is about, when it names one. */
  taskId: string | null
  /** That task's attempt id, when the incident names one. */
  attemptId: string | null
  /** The immutable scene path of the incident, when one was written. */
  scene: string | null
}

/** The complete scene document. */
export interface Scene {
  /** The frozen AC-5 schema version this document was written with. */
  schemaVersion: number
  /** Epoch ms at which the scene was taken. */
  at: number
  /** Which ladder rung produced this scene. */
  reason: "warn" | "escalate"
  /** The frozen cause object: the predicate kind and the silence window in ms. */
  cause: { kind: "silence"; ms: number }
  /** The team's identity and pause state at snapshot time. */
  team: {
    id: string
    name: string
    phase: string | null
    halted: boolean | null
    haltedAt: number | null
    hold: SceneHold | null
  }
  /** Every board task, one row per task. */
  tasks: SceneTask[]
  /** Every roster member, one row per non-Lead member. */
  members: SceneMember[]
  /** The watchdog's own read watermark per reader, never the team mailbox. */
  mailbox: Record<string, number>
  /** Durable assignee-to-generation-token map of every non-terminal task. */
  parkedAttempts: Record<string, string>
  /** The team's recent incident history, oldest first. */
  incidents: SceneIncident[]
}

/** Everything `buildScene` needs; assembled by the tick, injectable in tests. */
export interface SceneInput {
  /** The projected team record the scene describes. */
  team: TeamRecord
  /** Which ladder rung produced this scene. */
  reason: "warn" | "escalate"
  /** Epoch ms at which the scene is taken; also the file-name clock. */
  at: number
  /** The silence window that triggered the rung, in ms. */
  silenceMs: number
  /** The durable hold in force at snapshot time, or null when none. */
  hold: HoldRecord | null
  /** Survivor: the watchdog's OWN read watermark per reader (never the team mailbox). */
  mailbox: Record<string, number>
  /** The team's recent incidents to embed in the scene. */
  incidents: SceneIncident[]
  /** Streak counts by `taskId\0attemptId`. */
  streaks: Record<string, number>
  /** Heartbeat stamps per member key. */
  heartbeat: (memberKey: string) => readonly HeartbeatStamp[]
  /**
   * Read-only unread count for one member key. The engine supplies
   * {@link mailboxUnreadObservable} (`null`) because the official mailbox is unobservable; the
   * seam stays injectable so the scene schema keeps one shape.
   */
  unread: (memberKey: string) => number | null
}

/** The heartbeats' newest stamp among the ones attributed to one task. */
function newestForTask(stamps: readonly HeartbeatStamp[], taskId: string, attemptId: string | null, teamId?: string): number | null {
  // Newest matching stamp time, in ms epoch.
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
  // Newest stamp time seen, in ms epoch.
  let newest: number | null = null
  for (const stamp of stamps) if (newest === null || stamp.at >= newest) newest = stamp.at
  return newest
}

/** Build the AC-5 scene document from the current observations. */
export function buildScene(input: SceneInput): Scene {
  // The projected record every row below is derived from.
  const { team } = input
  // The task rows, each carrying its own newest stamp and recorded streak.
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
  // The member rows, each with its stamps and its newest non-terminal task.
  const members: SceneMember[] = team.members.map((member) => {
    // The member's heartbeat file key, i.e. the sanitized member name.
    const key = safeSegment(member.name)
    // This member's stamps, from the injected reader.
    const stamps = input.heartbeat(key)
    // The member's non-terminal tasks, whose newest id becomes `currentTask`.
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
  // The durable assignee-to-generation map the scheduler treats as advisory.
  const parkedAttempts: Record<string, string> = {}
  for (const task of team.tasks) {
    if (TERMINAL_STATUSES.includes(task.status)) continue
    if (task.assignee === undefined || task.attemptId === undefined) continue
    // The roster row for that assignee, so the map keys on the member id when known.
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
  /** Whether the immutable scene file and its pointer both landed. */
  ok: boolean
  /** The immutable per-incident scene file (absent when the write failed). */
  path: string | null
  /** The `latest.json` pointer (absent when the write failed). */
  latestPath: string | null
  /** Size of the written scene document in bytes. */
  bytes: number
  /** `Error#message` of the first failed write; absent on success. */
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
  // The team's scene directory, which holds every immutable scene.
  const dir = sceneDir(workspace, stateDir, teamId)
  // File-name stem: the ISO basic timestamp plus the rung that produced the scene.
  const base = isoBasic(at) + "-" + scene.reason
  // The immutable scene path, bumped below when a same-second file already exists.
  let path = join(dir, base + ".json")
  // Collision counter for two scenes written inside the same second.
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
  // The serialized document, written byte-identically to both destinations.
  const text = JSON.stringify(scene, null, 2) + "\n"
  // The immutable file's write outcome; a failure is reported, never thrown.
  const written = writeFileAtomic(path, text)
  if (written.error !== undefined) {
    return { ok: false, path: null, latestPath: null, bytes: 0, error: written.error }
  }
  // The `latest.json` pointer write; only this failing still leaves the scene valid.
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
  // The file to read: the given `.json` path, or the directory's `latest.json`.
  const file = path.endsWith(".json") ? path : join(path, "latest.json")
  try {
    // The parsed document, cast because a scene file on disk is untrusted input.
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Scene
    if (parsed === null || typeof parsed !== "object") return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * The member-unread count the OFFICIAL team plane can expose: none.
 *
 * The durable peer mailbox lives in the Lead Session log (`team/message/queued` /
 * `team/message/delivered`) and no adapter seam reports a per-member unread count, so a scene
 * written against the official plugin answers `null` — "not observable" — for every member. The
 * reader mirror that used to live here read the RETIRED plugin's
 * `<teamDir>/inbox/<member>.jsonl`, a file nothing writes any more, where a missing file read as
 * `0` (a fabricated "everything is read"); `null` is the honest replacement.
 *
 * @returns always `null`: the count is not observable through the adapter.
 */
export function mailboxUnreadObservable(): null {
  return null
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
