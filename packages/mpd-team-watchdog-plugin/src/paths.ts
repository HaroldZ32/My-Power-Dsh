// Path resolution for the team watchdog's OWN state.
//
// Every path is derived PER CALL from a workspace root the caller resolved
// through the adapter (`dsh.workspaceRoot(exec)` or a session payload) — never
// from a module-level constant and never from `process.cwd()` directly, because
// one host serves many sessions with different workspaces (AGENTS.md §6 State).
//
// Layout, all under the ADOPTED plugin's team state root so both owners stay
// side by side without ever sharing a file:
//
//   <workspace>/<stateDir>/<teamId>/team.json          adopted, READ-ONLY here
//   <workspace>/<stateDir>/watchdog/heartbeat/<key>.jsonl
//   <workspace>/<stateDir>/watchdog/scene/<teamId>/<iso>.json + latest.json
//   <workspace>/<stateDir>/watchdog/hold/<teamId>.json
//   <workspace>/<stateDir>/watchdog/incidents.jsonl
//   <workspace>/<stateDir>/watchdog/read-watermark.json
import { createHash } from "node:crypto"
import { join } from "node:path"

/** The adopted agent-teams plugin's default team state directory. */
export const DEFAULT_STATE_DIR = join(".mpd", "team")
/** This plugin's own namespace inside the team state root. Never `team.json`. */
export const WATCHDOG_DIR = "watchdog"
/** Heartbeat generations kept per member file (older generations are dropped). */
export const DEFAULT_KEEP_GENERATIONS = 3

/**
 * Fold a free-form id into ONE safe path segment.
 *
 * Mirrors the adopted `sanitizeKey` policy (Unicode letters and digits survive,
 * everything else folds to `-`) so a member name keeps meaning in the file name,
 * and a value with no letter/digit at all still gets a stable, unique segment
 * via a digest instead of a shared constant.
 *
 * @param value - any user- or host-supplied id.
 * @returns a non-empty single path segment.
 */
export function safeSegment(value: unknown): string {
  const text = String(value ?? "")
  const cleaned = text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  if (cleaned === "") return "k-" + digest(text)
  const points = [...cleaned]
  if (points.length > 48) return points.slice(0, 48).join("") + "-" + digest(text)
  return cleaned
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8)
}

/** The team state root (`<workspace>/<stateDir>`) shared with the adopted plugin. */
export function stateRoot(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(workspace, stateDir)
}

/** `<workspace>/<stateDir>/watchdog`. */
export function watchdogRoot(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(stateRoot(workspace, stateDir), WATCHDOG_DIR)
}

/** The adopted team record path — READ-ONLY for this plugin. */
export function teamPath(workspace: string, stateDir: string, teamId: string): string {
  return join(stateRoot(workspace, stateDir), String(teamId), "team.json")
}

/** The directory holding one team's adopted record and its mailbox. */
export function teamDir(workspace: string, stateDir: string, teamId: string): string {
  return join(stateRoot(workspace, stateDir), String(teamId))
}

/** `<stateDir>/watchdog/heartbeat`. */
export function heartbeatDir(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(watchdogRoot(workspace, stateDir), "heartbeat")
}

/** One member's append-only heartbeat file. */
export function heartbeatPath(workspace: string, stateDir: string, memberKey: string): string {
  return join(heartbeatDir(workspace, stateDir), safeSegment(memberKey) + ".jsonl")
}

/** One team's scene directory. */
export function sceneDir(workspace: string, stateDir: string, teamId: string): string {
  return join(watchdogRoot(workspace, stateDir), "scene", safeSegment(teamId))
}

/** `<stateDir>/watchdog/hold`. */
export function holdDir(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(watchdogRoot(workspace, stateDir), "hold")
}

/** One team's durable hold sidecar (beside `team.json`, never inside it). */
export function holdPath(workspace: string, stateDir: string, teamId: string): string {
  return join(holdDir(workspace, stateDir), safeSegment(teamId) + ".json")
}

/** The append-only incident log (one record per WARN/ESCALATE). */
export function incidentsPath(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(watchdogRoot(workspace, stateDir), "incidents.jsonl")
}

/** The per-reader read watermark over the incident log. */
export function watermarkPath(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(watchdogRoot(workspace, stateDir), "read-watermark.json")
}
