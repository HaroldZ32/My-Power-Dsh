import type { BoulderState, BoulderWorkState, BoulderWorkStatus } from "../types"

/** Task keys refused as timer map keys: storing one would rewrite an object prototype instead of a timer. */
export const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

// mpd adaptation: default platform is "dsh" (DeepSeek Harness); the legacy
// host-id prefixes below are still accepted for cross-platform reads.
// Note: those literals are data-compatibility values for pre-existing boulder
// records, not branding — keep them as-is.
type SessionPlatform = "codex" | "opencode" | "senpi" | "dsh"

/** Prefix that already qualifies a session id: this bundle's `dsh` plus the legacy hosts whose records stay readable. */
const SESSION_ID_PREFIX_PATTERN = /^(codex|opencode|senpi|dsh):/

/** Qualify an unqualified session id with its platform; an id carrying one of the known prefixes is returned unchanged. */
export function normalizeSessionId(sessionId: string, platform: SessionPlatform = "dsh"): string {
  if (SESSION_ID_PREFIX_PATTERN.test(sessionId)) {
    return sessionId
  }

  return `${platform}:${sessionId}`
}

/** Current instant as an ISO-8601 string, the timestamp form every persisted boulder record uses. */
export function nowIsoString(): string {
  return new Date().toISOString()
}

/** Epoch milliseconds of an ISO-8601 timestamp, or null when it is missing or unparseable. */
export function parseIsoToMs(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  // Epoch ms, or NaN when the text does not parse (Date.parse never throws).
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** Wall-clock milliseconds between two ISO-8601 instants, or undefined when either end is missing or unparseable. */
export function getElapsedMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  // Start instant in epoch ms; null when it was never recorded.
  const startedMs = parseIsoToMs(startedAt)
  // End instant in epoch ms; null while the work or timer is still running.
  const endedMs = parseIsoToMs(endedAt)
  if (startedMs === null || endedMs === null) {
    return undefined
  }

  return endedMs - startedMs
}

/** Narrow a stored value to the four legal work lifecycles; undefined and any unknown string are not statuses. */
export function isValidWorkStatus(status: unknown): status is BoulderWorkStatus {
  return status === "active" || status === "completed" || status === "paused" || status === "abandoned"
}

/** Synthesize the single work a pre-`works` ledger describes, keyed `<slug>-legacy`, so an old record still resumes. */
export function buildWorkFromMirror(state: BoulderState): BoulderWorkState {
  // Older ledgers carry only the plan path; the slug field is the fallback display name.
  const planName = state.plan_name ?? state.active_plan
  // `-legacy` keeps a synthesized key from colliding with a generated `<slug>-<hex>` one.
  const workId = `${planName}-legacy`
  return {
    work_id: workId,
    active_plan: state.active_plan,
    plan_name: planName,
    status: state.status,
    started_at: state.started_at,
    ended_at: state.ended_at,
    elapsed_ms: state.elapsed_ms,
    updated_at: state.updated_at,
    session_ids: Array.isArray(state.session_ids) ? [...state.session_ids] : [],
    session_origins: state.session_origins,
    agent: state.agent,
    worktree_path: state.worktree_path,
    task_sessions: state.task_sessions,
  }
}

/** Copy one work back into the ledger's top-level mirror after a mutation; the `works` map is left alone. */
export function projectWorkToMirror(state: BoulderState, work: BoulderWorkState): void {
  state.active_plan = work.active_plan
  state.plan_name = work.plan_name
  state.status = work.status
  state.started_at = work.started_at
  state.ended_at = work.ended_at
  state.elapsed_ms = work.elapsed_ms
  state.updated_at = work.updated_at
  state.session_ids = [...work.session_ids]
  state.session_origins = work.session_origins ? { ...work.session_origins } : {}
  state.agent = work.agent
  state.worktree_path = work.worktree_path
  state.task_sessions = work.task_sessions ? { ...work.task_sessions } : {}
}

/** The work the top-level mirror should reflect: `active_work_id` when it still resolves, else the most recently updated one. */
export function selectMirrorWork(state: BoulderState): BoulderWorkState | null {
  // Works recorded in the multi-work shape; a pre-`works` ledger exposes none and is handled by buildWorkFromMirror.
  const works = state.works ? Object.values(state.works) : []
  if (works.length === 0) {
    return null
  }

  if (state.active_work_id) {
    // The work the mirror points at, when that id still exists in `works`.
    const matched = works.find((work) => work.work_id === state.active_work_id)
    if (matched) {
      return matched
    }
  }

  // Newest first by `updated_at`, falling back to `started_at`; a work with neither sorts last.
  const sorted = [...works].sort((left, right) => {
    // Left work's sort instant in epoch ms; 0 makes an undated work the oldest.
    const leftMs = parseIsoToMs(left.updated_at ?? left.started_at) ?? 0
    // Right work's sort instant in epoch ms, same fallback as the left side.
    const rightMs = parseIsoToMs(right.updated_at ?? right.started_at) ?? 0
    return rightMs - leftMs
  })
  return sorted[0] ?? null
}
