// The durable sidecars: the preserving hold, the incident log and the per-reader
// read watermark.
//
// All three live BESIDE `team.json` (never inside it), so the adopted `state.js`
// keeps sole ownership of the team record and a watchdog write can never change
// one byte of it (AC-6 side of the contract, design §4.1/§5.3).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { holdPath, incidentsPath, watermarkPath } from "./paths.js"
import { message, writeFileAtomic } from "./store.js"

/** The durable hold that marks a team as held by the watchdog. */
export interface HoldRecord {
  id: string
  teamId: string
  since: number
  cause: string
  taskId: string | null
  attemptId: string | null
  /** The scene written for the escalation that produced this hold. */
  sceneAt: number
}

/** The durable incident vocabulary (ONE definition, shared with the scene's incident rows). */
export type IncidentKind = "warn" | "escalate" | "never-started" | "tool-expired"

/** Why an incident was recorded; `ms` is the silence window, the in-flight age or 0. */
export type IncidentCause = { kind: "silence" | "never-started" | "tool-expired"; ms: number; tool?: string }

/**
 * One incident record: a WARN or an ESCALATE, durably logged.
 *
 * `never-started` (a claimed task whose owner never stamped) and `tool-expired` (r6: an
 * open tool call past `toolInFlightMaxMs`) are recorded on this SAME durable surface and
 * replayed by the same readers — they are WARN-class records by design, so every reader
 * that shows an incident shows them, and neither can ever produce a hold.
 */
export interface IncidentRecord {
  id: string
  teamId: string
  kind: IncidentKind
  at: number
  cause: IncidentCause
  taskId: string | null
  attemptId: string | null
  /** The immutable scene file path, when it was written. */
  scene: string | null
  /** Whether the hold was persisted (`not-applied` is the honest failure state). */
  hold: "applied" | "not-applied" | "not-requested"
  /** Readers that have acknowledged this incident. */
  acknowledgedBy: string[]
}

/** Read one team's hold sidecar; undefined when the team is not held. */
export function readHold(workspace: string, stateDir: string, teamId: string): HoldRecord | undefined {
  let text: string
  try {
    text = readFileSync(holdPath(workspace, stateDir, teamId), "utf8")
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text) as HoldRecord
    if (parsed === null || typeof parsed !== "object" || typeof parsed.id !== "string") return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Persist a hold atomically.
 *
 * Idempotent by `id`: writing the identical record changes no bytes. A failure is
 * returned, never thrown, so the caller can record `hold: 'not-applied'` instead
 * of announcing a pause that did not happen (design §7).
 */
export function writeHold(
  workspace: string,
  stateDir: string,
  hold: HoldRecord,
): { ok: boolean; changed: boolean; path: string; error?: string } {
  const path = holdPath(workspace, stateDir, hold.teamId)
  const written = writeFileAtomic(path, JSON.stringify(hold, null, 2) + "\n")
  if (written.error !== undefined) return { ok: false, changed: false, path, error: written.error }
  return { ok: true, changed: written.changed, path }
}

/** Clear one team's hold. A non-held team is a no-op, never an error (AC-8). */
export function clearHold(
  workspace: string,
  stateDir: string,
  teamId: string,
): { cleared: boolean; path: string } {
  const path = holdPath(workspace, stateDir, teamId)
  let cleared = false
  try {
    if (existsSync(path)) {
      rmSync(path)
      cleared = true
    }
  } catch {
    // best effort: an unremovable hold is reported by the caller's read-back
  }
  return { cleared, path }
}

/** Append one incident to the durable log; never throws. */
export function appendIncident(
  workspace: string,
  stateDir: string,
  incident: IncidentRecord,
): { ok: boolean; path: string; error?: string } {
  const path = incidentsPath(workspace, stateDir)
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(incident) + "\n", "utf8")
    return { ok: true, path }
  } catch (error) {
    return { ok: false, path, error: message(error) }
  }
}

/** Every incident record, in append order (malformed lines skipped). */
export function readIncidents(workspace: string, stateDir: string): IncidentRecord[] {
  let text: string
  try {
    text = readFileSync(incidentsPath(workspace, stateDir), "utf8")
  } catch {
    return []
  }
  const records: IncidentRecord[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line === "") continue
    try {
      const parsed = JSON.parse(line) as IncidentRecord
      if (parsed !== null && typeof parsed === "object" && typeof parsed.id === "string") records.push(parsed)
    } catch {
      // a torn line is skipped; the rest of the log stays readable
    }
  }
  return records
}

/** The per-reader read watermark map (`{<reader>: <lastAckedIncidentTs>}`). */
export function readWatermarks(workspace: string, stateDir: string): Record<string, number> {
  let text: string
  try {
    text = readFileSync(watermarkPath(workspace, stateDir), "utf8")
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (parsed === null || typeof parsed !== "object") return {}
    const out: Record<string, number> = {}
    for (const [reader, value] of Object.entries(parsed)) if (typeof value === "number") out[reader] = value
    return out
  } catch {
    return {}
  }
}

/**
 * Advance one reader's watermark.
 *
 * The watermark only ever moves FORWARD and only by an explicit acknowledgement
 * (design §5.3): without one, the replay is permanent re-display by design.
 */
export function ackIncidents(
  workspace: string,
  stateDir: string,
  reader: string,
  upTo: number,
): { ok: boolean; watermark: number; path: string; error?: string } {
  const current = readWatermarks(workspace, stateDir)
  const next = Math.max(current[reader] ?? 0, upTo)
  const path = watermarkPath(workspace, stateDir)
  const written = writeFileAtomic(path, JSON.stringify({ ...current, [reader]: next }, null, 2) + "\n")
  if (written.error !== undefined) return { ok: false, watermark: current[reader] ?? 0, path, error: written.error }
  return { ok: true, watermark: next, path }
}

/** Incidents a reader has NOT acknowledged yet (the unread replay). */
export function unacknowledged(
  workspace: string,
  stateDir: string,
  reader: string,
  teamId?: string,
): IncidentRecord[] {
  const watermark = readWatermarks(workspace, stateDir)[reader] ?? 0
  return readIncidents(workspace, stateDir).filter(
    (record) => record.at > watermark && (teamId === undefined || record.teamId === teamId),
  )
}
