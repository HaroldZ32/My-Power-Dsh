// Boulder core: the primitives every ledger mutation shares — session-id form, instants, and the
// fold between a work entry and the top-level mirror.

import type { BoulderState, BoulderWorkState, BoulderWorkStatus } from "../types"

/** Task keys refused as timer-map keys: assigning one would rewrite an object prototype instead of storing a timer. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"])

/**
 * Hosts whose session-id prefix this ledger understands. `dsh` is the one this bundle WRITES; the
 * other three are DATA-COMPATIBILITY values kept so records written before the retarget still
 * resume — they are identifiers of past host integrations, not branding, so leave them spelled as-is.
 */
type SessionPlatform = "codex" | "opencode" | "senpi" | "dsh"

/** A session id that already carries one of the understood prefixes, and therefore needs no rewrite. */
const SESSION_ID_PREFIX_PATTERN = /^(codex|opencode|senpi|dsh):/

/**
 * Put a session id into its stored `platform:`-prefixed form.
 *
 * @param sessionId - the id as a caller passed it, prefixed or bare.
 * @param platform - prefix applied to a bare id; defaults to this bundle's own host id.
 * @returns the id unchanged when it already carries an understood prefix, else the prefixed form.
 */
export function normalizeSessionId(sessionId: string, platform: SessionPlatform = "dsh"): string {
  if (SESSION_ID_PREFIX_PATTERN.test(sessionId)) {
    return sessionId
  }

  return `${platform}:${sessionId}`
}

/**
 * Current instant as an ISO-8601 string, the timestamp form every persisted record uses.
 *
 * @returns the current UTC instant, e.g. `2026-01-02T03:04:05.678Z`.
 */
export function nowIsoString(): string {
  return new Date().toISOString()
}

/**
 * Epoch milliseconds of an ISO-8601 timestamp.
 *
 * @param value - the timestamp, or undefined when the record never carried one.
 * @returns its epoch milliseconds, or null when it is absent or does not parse.
 */
export function parseIsoToMs(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  /** Epoch milliseconds, or NaN for unparseable text; `Date.parse` reports failure this way rather than throwing. */
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Wall-clock duration between two instants.
 *
 * @param startedAt - ISO-8601 start instant, absent while nothing was started.
 * @param endedAt - ISO-8601 end instant, absent while the work or timer is still running.
 * @returns the difference in milliseconds, or undefined when either end is missing or unparseable.
 */
export function getElapsedMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  /** Start instant in epoch milliseconds; null when the record never carried one. */
  const startedMs = parseIsoToMs(startedAt)
  /** End instant in epoch milliseconds; null while the work or timer is still open. */
  const endedMs = parseIsoToMs(endedAt)
  if (startedMs === null || endedMs === null) {
    return undefined
  }

  return endedMs - startedMs
}

/**
 * Narrow a value read back from disk to the four legal lifecycles.
 *
 * @param status - the stored value, of unknown type because it came from parsed JSON.
 * @returns true when it is one of the four lifecycles, narrowing the value for the caller.
 */
export function isValidWorkStatus(status: unknown): status is BoulderWorkStatus {
  return status === "active" || status === "completed" || status === "paused" || status === "abandoned"
}

/**
 * Synthesize the single work a pre-`works` ledger describes, so such a record still resumes.
 *
 * @param state - the ledger whose top-level mirror is the only work it has.
 * @returns one work entry keyed `<slug>-legacy`, so its key can never collide with a generated `<slug>-<hex>` one.
 */
export function buildWorkFromMirror(state: BoulderState): BoulderWorkState {
  /** Display name of the synthesized work; a record without a slug falls back to its plan path. */
  const planName = state.plan_name ?? state.active_plan
  /** Key of the synthesized work, marked `-legacy` so it stays distinguishable from a generated id. */
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

/**
 * Copy one work's fields onto the ledger's top-level mirror after a mutation; the `works` map is left untouched.
 *
 * @param state - the ledger mutated in place.
 * @param work - the work the mirror must now reflect.
 * @returns nothing; `state` is mutated.
 */
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

/**
 * Choose the work a ledger's top-level mirror should reflect.
 *
 * @param state - the ledger to read; a pre-`works` record has no map and yields null here.
 * @returns the work named by `active_work_id` while that id still resolves, else the most recently updated one, else null.
 */
export function selectMirrorWork(state: BoulderState): BoulderWorkState | null {
  /** Works recorded in the multi-work shape; empty for a legacy record, which `buildWorkFromMirror` handles instead. */
  const works = state.works ? Object.values(state.works) : []
  if (works.length === 0) {
    return null
  }

  if (state.active_work_id) {
    /** The work the mirror already points at, when that id still exists in `works`. */
    const matched = works.find((work) => work.work_id === state.active_work_id)
    if (matched) {
      return matched
    }
  }

  /** Works newest-first by last mutation, falling back to the start instant; a work with neither sorts last. */
  const sorted = [...works].sort((left, right) => {
    /** Left work's sort instant in epoch milliseconds; 0 pushes an undated work to the end. */
    const leftMs = parseIsoToMs(left.updated_at ?? left.started_at) ?? 0
    /** Right work's sort instant in epoch milliseconds, with the same fallback as the left side. */
    const rightMs = parseIsoToMs(right.updated_at ?? right.started_at) ?? 0
    return rightMs - leftMs
  })
  return sorted[0] ?? null
}
