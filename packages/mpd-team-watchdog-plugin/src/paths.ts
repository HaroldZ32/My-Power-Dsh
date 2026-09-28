// Path resolution for the team watchdog's OWN state.
//
// Every path is derived PER CALL from a workspace root the caller resolved
// through the adapter (`dsh.workspaceRoot(exec)` or a session payload) — never
// from a module-level constant and never from `process.cwd()` directly, because
// one host serves many sessions with different workspaces (AGENTS.md §6 State).
//
// Layout, entirely this plugin's own (`<workspace>/<stateDir>` is shared with the team plane by
// convention only — no harness team file lives under it any more, because the official Agent Teams
// service keeps team state in the Lead Session log and the watchdog reads it through the adapter):
//
//   <workspace>/<stateDir>/watchdog/heartbeat/<key>.jsonl
//   <workspace>/<stateDir>/watchdog/scene/<teamId>/<iso>.json + latest.json
//   <workspace>/<stateDir>/watchdog/hold/<teamId>.json
//   <workspace>/<stateDir>/watchdog/incidents.jsonl
//   <workspace>/<stateDir>/watchdog/read-watermark.json
import { createHash } from "node:crypto"
import { join } from "node:path"

/** The default state directory. The harness keeps no team file under it (see the layout above). */
export const DEFAULT_STATE_DIR = join(".mpd", "team")
/** This plugin's own namespace inside the state root. */
export const WATCHDOG_DIR = "watchdog"
/** Heartbeat generations kept per member file (older generations are dropped). */
export const DEFAULT_KEEP_GENERATIONS = 3

/**
 * Fold a free-form id into ONE safe path segment.
 *
 * Mirrors the retired plugin's `sanitizeKey` policy (Unicode letters and digits survive,
 * everything else folds to `-`) so a member name keeps meaning in the file name,
 * and a value with no letter/digit at all still gets a stable, unique segment
 * via a digest instead of a shared constant.
 *
 * @param value - any user- or host-supplied id.
 * @returns a non-empty single path segment.
 */
export function safeSegment(value: unknown): string {
  // The raw id as text; a null or undefined id folds to an empty string so the segment stays stable.
  const text = String(value ?? "")
  // The id NFC-normalised, trimmed and lower-cased, with every run of non-alphanumerics folded to one dash.
  const cleaned = text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  if (cleaned === "") return "k-" + digest(text)
  // The cleaned id as code points, so the 48-character cap counts characters rather than UTF-16 units.
  const points = [...cleaned]
  if (points.length > 48) return points.slice(0, 48).join("") + "-" + digest(text)
  return cleaned
}

/** First 8 hex characters of the SHA-256 of the raw text: keeps a fully collapsed id unique and stable. */
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8)
}

/** The state root (`<workspace>/<stateDir>`); only this plugin's own files live under it. */
export function stateRoot(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(workspace, stateDir)
}

/** The watchdog namespace root, `<workspace>/<stateDir>/watchdog`. */
export function watchdogRoot(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(stateRoot(workspace, stateDir), WATCHDOG_DIR)
}

/** The directory holding every member's heartbeat file, `<stateDir>/watchdog/heartbeat`. */
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

/** The directory holding one durable host-side hold per team, `<stateDir>/watchdog/hold`. */
export function holdDir(workspace: string, stateDir: string = DEFAULT_STATE_DIR): string {
  return join(watchdogRoot(workspace, stateDir), "hold")
}

/** One team's durable hold sidecar (the watchdog's own file, keyed by the official team id). */
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
