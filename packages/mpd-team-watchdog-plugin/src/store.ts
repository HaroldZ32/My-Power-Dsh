// The heartbeat store: one append-only JSONL file per member (the captain
// included, under its own key), holding one stamp per model step, per completed
// tool call, and per turn boundary.
//
// Ownership rules this module implements:
//   * The file belongs to the WATCHDOG, not to `team.json`: the adopted
//     `state.js` keeps sole ownership of the team record, and a per-step stamp
//     cadence must never become a second writer on its byte surface.
//   * Every write is best-effort: an unwritable heartbeat location degrades to a
//     recorded failure (`{ok:false, error}`) and never throws into a harness
//     event listener (AC-15: the watchdog cannot wedge the host).
//   * Readers are pure and tolerate a truncated last line (a process killed
//     mid-append leaves one), so a fresh process can always read back what was
//     written before the kill.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { DEFAULT_KEEP_GENERATIONS, heartbeatDir, heartbeatPath } from "./paths.js"

/** The four heartbeat moments (design §1.2). */
export type HeartbeatKind = "step" | "tool" | "turn-start" | "turn-end"

/** One heartbeat stamp, one JSON object per line on disk. */
export interface HeartbeatStamp {
  kind: HeartbeatKind
  /** Epoch ms at which the stamp was taken. */
  at: number
  /** The member NAME (or `captain`), or null when the agent is not in a team. */
  member: string | null
  /** The heartbeat file key for `member` (sanitized, filesystem-safe). */
  memberKey: string
  /** The team this agent belongs to, when resolvable. */
  teamId: string | null
  /** The non-terminal task the member currently owns, when any. */
  taskId: string | null
  /** That task's attempt id, when any. */
  attemptId: string | null
  /** A per-turn id, so rotation can group stamps into generations. */
  turnId: string | null
  /** Tool name (tool stamps only). */
  tool?: string
  /** Harness call id (tool stamps only). */
  callId?: string
  /** Whether the tool call succeeded (tool stamps only). */
  ok?: boolean
  /** The workspace the stamp belongs to. */
  workspace: string
}

/** A write attempt's outcome; never a throw. */
export interface HeartbeatWriteResult {
  ok: boolean
  path: string
  error?: string
}

/**
 * Append one stamp to a member's heartbeat file.
 *
 * @param workspace - the workspace root resolved for this call.
 * @param stateDir - the team state directory (default `.mpd/team`).
 * @param memberKey - the member key (or `captain`).
 * @param stamp - the stamp to append.
 * @returns the outcome; `ok:false` carries the reason and never throws.
 */
export function appendHeartbeat(
  workspace: string,
  stateDir: string,
  memberKey: string,
  stamp: HeartbeatStamp,
): HeartbeatWriteResult {
  const path = heartbeatPath(workspace, stateDir, memberKey)
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(stamp) + "\n", "utf8")
    return { ok: true, path }
  } catch (error) {
    return { ok: false, path, error: message(error) }
  }
}

/**
 * Read one member's heartbeat stamps from disk.
 *
 * A malformed or truncated line is SKIPPED, never fatal: the last line of a file
 * a killed process was appending to is expected to be incomplete.
 *
 * @param workspace - the workspace root.
 * @param stateDir - the team state directory.
 * @param memberKey - the member key to read.
 * @returns the parsed stamps in file order (`[]` when the file is absent).
 */
export function readHeartbeats(workspace: string, stateDir: string, memberKey: string): HeartbeatStamp[] {
  const path = heartbeatPath(workspace, stateDir, memberKey)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  const stamps: HeartbeatStamp[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try {
      const parsed = JSON.parse(trimmed) as HeartbeatStamp
      if (parsed !== null && typeof parsed === "object" && typeof parsed.at === "number") stamps.push(parsed)
    } catch {
      // torn/truncated line — skip it, keep the rest
    }
  }
  return stamps
}

/** Every heartbeat file key present for a workspace (sorted, stable). */
export function listHeartbeatKeys(workspace: string, stateDir: string): string[] {
  const dir = heartbeatDir(workspace, stateDir)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.slice(0, -".jsonl".length))
    .sort()
}

/**
 * The newest stamp for ONE task+attempt, or undefined when the owner has never
 * stamped it (the `never-started` observation, design §0/GAP-1).
 */
export function newestForTask(
  stamps: readonly HeartbeatStamp[],
  taskId: string | null,
  attemptId: string | null,
): HeartbeatStamp | undefined {
  if (taskId === null) return undefined
  let newest: HeartbeatStamp | undefined
  for (const stamp of stamps) {
    if (stamp.taskId !== taskId) continue
    if (attemptId !== null && stamp.attemptId !== null && stamp.attemptId !== attemptId) continue
    if (newest === undefined || stamp.at >= newest.at) newest = stamp
  }
  return newest
}

/** The newest stamp of ANY kind, or undefined for a member with no heartbeat. */
export function newestOverall(stamps: readonly HeartbeatStamp[]): HeartbeatStamp | undefined {
  let newest: HeartbeatStamp | undefined
  for (const stamp of stamps) {
    if (newest === undefined || stamp.at >= newest.at) newest = stamp
  }
  return newest
}

/**
 * Drop the generations older than `keep`, keeping the file bounded.
 *
 * A generation starts at a `turn-start` stamp and runs to the line before the
 * next one, so the last `keep` generations are exactly the live tail. A file with
 * fewer generations than `keep`, or with no `turn-start` at all, is left alone:
 * there is nothing safe to drop.
 *
 * @returns the before/after line counts and whether the file changed.
 */
export function rotateHeartbeats(
  workspace: string,
  stateDir: string,
  memberKey: string,
  keep: number = DEFAULT_KEEP_GENERATIONS,
): { rotated: boolean; before: number; after: number; path: string } {
  const path = heartbeatPath(workspace, stateDir, memberKey)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return { rotated: false, before: 0, after: 0, path }
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  // PER-TEAM rotation (r2). The file is keyed by MEMBER NAME per workspace, so same-named members
  // of DIFFERENT teams share it. A global "keep the last N generations" rule then lets one team's
  // turnover EVICT the other team's evidence: measured, team-beta's only stamp disappeared after
  // team-alpha turned over four times, which turns that team's `silence` into `never-started` — a
  // missed wedge. Grouping by the stamp's own `teamId` keeps the bound per owner instead, and a
  // stamp with no team forms its own group (it cannot be attributed).
  const teamOfLine = (line: string): string => {
    try {
      const parsed = JSON.parse(line) as HeartbeatStamp
      const team = parsed?.teamId
      return team === undefined || team === null || team === "" ? "\u0000no-team" : String(team)
    } catch {
      return "\u0000unparseable"
    }
  }
  const groups = new Map<string, number[]>()
  for (let index = 0; index < lines.length; index += 1) {
    const key = teamOfLine(lines[index])
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [index])
    else bucket.push(index)
  }
  const dropped = new Set<number>()
  for (const indices of groups.values()) {
    const starts: number[] = []
    for (const index of indices) {
      try {
        const parsed = JSON.parse(lines[index]) as HeartbeatStamp
        if (parsed?.kind === "turn-start") starts.push(index)
      } catch {
        // an unparseable line cannot be a generation boundary
      }
    }
    if (starts.length <= keep) continue
    const cut = starts[starts.length - keep]
    for (const index of indices) if (index < cut) dropped.add(index)
  }
  if (dropped.size === 0) return { rotated: false, before: lines.length, after: lines.length, path }
  const kept = lines.filter((_line, index) => !dropped.has(index))
  try {
    writeFileSync(path, kept.join("\n") + "\n", "utf8")
    return { rotated: true, before: lines.length, after: kept.length, path }
  } catch {
    return { rotated: false, before: lines.length, after: lines.length, path }
  }
}

/**
 * Atomically replace a text file, skipping the write when the bytes are
 * identical (the idempotence half of AC-6: a second write of identical state
 * changes no bytes and does not bump the mtime).
 */
export function writeFileAtomic(path: string, text: string): { changed: boolean; path: string; error?: string } {
  try {
    if (existsSync(path)) {
      let current: string | undefined
      try {
        current = readFileSync(path, "utf8")
      } catch {
        current = undefined
      }
      if (current === text) return { changed: false, path }
    }
    mkdirSync(dirname(path), { recursive: true })
    const temp = join(dirname(path), "." + basename(path) + ".tmp-" + process.pid)
    writeFileSync(temp, text, "utf8")
    renameSync(temp, path)
    return { changed: true, path }
  } catch (error) {
    return { changed: false, path, error: message(error) }
  }
}

/** `Error#message` for anything thrown. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
