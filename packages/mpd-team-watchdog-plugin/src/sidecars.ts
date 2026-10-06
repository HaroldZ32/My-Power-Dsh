// The durable sidecars: the preserving hold, the incident log and the per-reader
// read watermark.
//
// All three are this plugin's OWN files under `<stateDir>/watchdog/`, so no team
// state can be touched by a watchdog write (AC-6 side of the contract, design §4.1/§5.3).
// The team board itself is the harness's (the official service keeps it in the Lead
// Session log), and no adapter seam this plugin calls can write it at all.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { holdPath, incidentsPath, watermarkPath } from "./paths.js"
import { message, writeFileAtomic } from "./store.js"

/** The durable hold that marks a team as held by the watchdog. */
export interface HoldRecord {
  /** Stable hold id, unique for one team and cause. */
  id: string
  /** The OFFICIAL team id whose new dispatches this hold freezes. */
  teamId: string
  /** Epoch ms at which the hold was raised. */
  since: number
  /** Human-readable cause of the hold, as shown in the incident. */
  cause: string
  /** The held task, when the hold names one. */
  taskId: string | null
  /** That task's attempt id, when the hold names one. */
  attemptId: string | null
  /** The scene written for the escalation that produced this hold. */
  sceneAt: number
  /**
   * T-17 (§6): the bound after which this hold releases itself, with a durable
   * `hold-auto-released` incident. `0` = no TTL (an explicit "never expire"), in which case
   * only the ACTIVITY path can release it. A hold written before this field existed reads as
   * `0`, so an old hold is never released on a bound nobody ever recorded for it.
   */
  ttlMs: number
}

/** The durable incident vocabulary (ONE definition, shared with the scene's incident rows). */
export type IncidentKind = "warn" | "escalate" | "never-started" | "tool-expired" | "hold-auto-released"

/**
 * Why an incident was recorded; `ms` is the silence window, the in-flight age or 0.
 *
 * `silence` is the PRE-redesign spelling, kept so every historical record still parses.
 * New records name the predicate that produced them: `silence-channel` (the §1 four-state
 * fold concluded OUTSTANDING) or `silence-heartbeat` (§4's report-only degradation).
 */
export type IncidentCause = {
  kind: "silence" | "silence-channel" | "silence-heartbeat" | "never-started" | "tool-expired" | "hold-auto-released"
  ms: number
  tool?: string
  /**
   * T-17: WHICH auto-release path fired. `ttl` = the hold outlived its `ttlMs`; `activity` =
   * a heartbeat stamp for that team arrived after `hold.since`, i.e. a member demonstrably
   * worked and disproved the wedge the hold was raised for.
   */
  release?: "ttl" | "activity"
}

/**
 * One incident record: a WARN or an ESCALATE, durably logged.
 *
 * `never-started` (a claimed task whose owner never stamped) and `tool-expired` (r6: an
 * open tool call past `toolInFlightMaxMs`) are recorded on this SAME durable surface and
 * replayed by the same readers — they are WARN-class records by design, so every reader
 * that shows an incident shows them, and neither can ever produce a hold.
 */
export interface IncidentRecord {
  /** Stable record id, unique within the incident log. */
  id: string
  /** The team the incident was observed on. */
  teamId: string
  /** Which incident class this record is: WARN-class or ESCALATE. */
  kind: IncidentKind
  /** Epoch ms at which the incident was recorded (the watermark's unit). */
  at: number
  /** The predicate and window that produced this incident. */
  cause: IncidentCause
  /** The task the incident is about, when it names one. */
  taskId: string | null
  /** That task's attempt id, when the incident names one. */
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
  // Raw sidecar text; an absent or unreadable file leaves through the catch below.
  let text: string
  try {
    text = readFileSync(holdPath(workspace, stateDir, teamId), "utf8")
  } catch {
    return undefined
  }
  try {
    // The file's JSON, cast because an on-disk sidecar is untrusted; `id` is checked next.
    const parsed = JSON.parse(text) as HoldRecord
    if (parsed === null || typeof parsed !== "object" || typeof parsed.id !== "string") return undefined
    // T-17 back-compat: a hold persisted before `ttlMs` existed reads as 0 (no TTL) rather than
    // as `undefined`, so the auto-release arithmetic never invents a bound.
    return { ...parsed, ttlMs: typeof parsed.ttlMs === "number" && Number.isFinite(parsed.ttlMs) ? parsed.ttlMs : 0 }
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
  // Absolute path of the hold sidecar for this team.
  const path = holdPath(workspace, stateDir, hold.teamId)
  // The atomic-write outcome, forwarded as the hold's own ok/changed pair.
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
  // Absolute path of the sidecar to remove; an absent file is a successful no-op.
  const path = holdPath(workspace, stateDir, teamId)
  // Whether an existing hold file was actually removed.
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
  // Absolute path of the append-only incident log.
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
  // Raw log text; an absent log reads as "no incidents" below.
  let text: string
  try {
    text = readFileSync(incidentsPath(workspace, stateDir), "utf8")
  } catch {
    return []
  }
  // Accepted records in append order; malformed lines are skipped.
  const records: IncidentRecord[] = []
  for (const raw of text.split("\n")) {
    // The raw line without surrounding whitespace.
    const line = raw.trim()
    if (line === "") continue
    try {
      // The line's JSON, cast because the on-disk log is untrusted; `id` is checked next.
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
  // Raw watermark text; an absent file leaves every reader at 0 below.
  let text: string
  try {
    text = readFileSync(watermarkPath(workspace, stateDir), "utf8")
  } catch {
    return {}
  }
  try {
    // The watermark document, cast to an open record because any JSON value may sit here.
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (parsed === null || typeof parsed !== "object") return {}
    // The accepted reader-to-timestamp map; non-numeric entries are dropped.
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
 *
 * A NON-FINITE `upTo` is REFUSED before anything is written. `Math.max(current[reader] ?? 0, NaN)`
 * is `NaN` and `JSON.stringify` renders that as `null`, which the next read coalesces back to 0 —
 * so a NaN acknowledgement used to look like a success while silently rewinding the reader to the
 * whole incident log. An `Infinity` is refused for the same reason: no incident can carry it.
 *
 * @param workspace - the workspace whose watermark document is written.
 * @param stateDir - the state directory, relative to the workspace.
 * @param reader - the reader key whose watermark advances.
 * @param upTo - the incident timestamp to acknowledge; must be finite.
 * @returns the outcome, the resulting watermark and the path; `ok: false` with `error` when refused.
 */
export function ackIncidents(
  workspace: string,
  stateDir: string,
  reader: string,
  upTo: number,
): { ok: boolean; watermark: number; path: string; error?: string } {
  // The whole watermark map as it stands before this acknowledgement.
  const current = readWatermarks(workspace, stateDir)
  // Absolute path of the watermark document shared by all readers.
  const path = watermarkPath(workspace, stateDir)
  // THE REFUSAL COMES FIRST: a non-finite bound would serialize to `null` and be read back as 0.
  if (typeof upTo !== "number" || !Number.isFinite(upTo)) {
    return { ok: false, watermark: current[reader] ?? 0, path, error: `the watermark to acknowledge must be a finite number, got ${String(upTo)}` }
  }
  // The new watermark: monotonic, so an ack can only move a reader forward.
  const next = Math.max(current[reader] ?? 0, upTo)
  // The atomic-write outcome for the merged watermark document.
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
  // The reader's last acknowledged incident time, 0 when it never acknowledged one.
  const watermark = readWatermarks(workspace, stateDir)[reader] ?? 0
  return readIncidents(workspace, stateDir).filter(
    (record) => record.at > watermark && (teamId === undefined || record.teamId === teamId),
  )
}
