import { existsSync, readFileSync } from "node:fs"

import type { BoulderState, BoulderWorkResumeOption, BoulderWorkState, TaskSessionState } from "../types"
import { getBoulderFilePath, resolveBoulderPlanPathForWork } from "./path"
import { getPlanProgress } from "./plan-progress"
import { buildWorkFromMirror, isValidWorkStatus, normalizeSessionId, parseIsoToMs, projectWorkToMirror, selectMirrorWork } from "./shared"

/**
 * Read the ledger at `<directory>/.mpd/boulder.json` and repair the shapes a stored record may lack.
 * Returns null for an absent, unparsable or empty file; when the record carries a `works` map, the
 * work the mirror should reflect is projected onto the top-level fields before returning.
 */
export function readBoulderState(directory: string): BoulderState | null {
  // Ledger location derived from the state root; existence is probed before any read is attempted.
  const filePath = getBoulderFilePath(directory)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    // Raw file text; a JSON parse failure is caught below and reported as "no ledger".
    const content = readFileSync(filePath, "utf-8")
    // Untrusted JSON: the shape checks below all run before this value is treated as a ledger.
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      return null
    }

    normalizeState(parsed)
    // The parsed object read as a ledger: the checks above prove only that it is a non-empty object,
    // so this cast is the single boundary where a persisted record enters the typed API.
    const state = parsed as BoulderState
    // Work the top-level mirror should reflect: the recorded active one, else the most recent.
    const mirrorWork = selectMirrorWork(state)
    if (mirrorWork) {
      state.active_work_id = mirrorWork.work_id
      projectWorkToMirror(state, mirrorWork)
    }

    return state
  } catch {
    return null
  }
}

/** Repair one ledger object in place: the session fields at its root and inside every work, plus the root `task_sessions` map. */
function normalizeState(state: Record<string, unknown>): void {
  normalizeSessionFields(state)

  // Normalized root session list, which normalizeSessionFields has just guaranteed to be an array.
  const sessionIds = Array.isArray(state.session_ids) ? state.session_ids : []

  // Root origin map, replaced by a plain object when the stored value is missing, null or an array.
  const sessionOrigins = state.session_origins && typeof state.session_origins === "object" && !Array.isArray(state.session_origins)
    ? (state.session_origins as Record<string, unknown>)
    : {}
  state.session_origins = sessionOrigins

  if (sessionIds.length === 1) {
    // The ledger's only root session, tagged "direct" below when its origin is absent or unrecognized.
    const soleSessionId = sessionIds[0]
    if (
      typeof soleSessionId === "string"
      && sessionOrigins[soleSessionId] !== "appended"
      && sessionOrigins[soleSessionId] !== "direct"
    ) {
      sessionOrigins[soleSessionId] = "direct"
    }
  }

  if (!state.task_sessions || typeof state.task_sessions !== "object" || Array.isArray(state.task_sessions)) {
    state.task_sessions = {}
  }

  normalizeWorkSessionFields(state.works)
}

/** Rewrite a record's `session_ids` to the prefixed storage form and re-key its `session_origins` through the same normalization. */
function normalizeSessionFields(target: Record<string, unknown>): void {
  // String-typed ids only, each normalized to its `platform:`-prefixed storage form.
  const sessionIds = Array.isArray(target.session_ids)
    ? target.session_ids.filter((sessionId): sessionId is string => typeof sessionId === "string").map((sessionId) => normalizeSessionId(sessionId))
    : []
  target.session_ids = sessionIds

  // Origin map re-keyed through that same normalization; anything but an object collapses to empty.
  const sessionOrigins = target.session_origins && typeof target.session_origins === "object" && !Array.isArray(target.session_origins)
    ? normalizeSessionOrigins(target.session_origins as Record<string, unknown>)
    : {}
  target.session_origins = sessionOrigins
}

/** Re-key an origin map through the same id normalization, so a lookup by normalized id finds its entry; the values are carried over untouched. */
function normalizeSessionOrigins(sessionOrigins: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sessionOrigins).map(([sessionId, origin]) => [normalizeSessionId(sessionId), origin]),
  )
}

/** Apply the session-field normalization to every work of a `works` map; anything that is not a plain object map is left as it stands. */
function normalizeWorkSessionFields(works: unknown): void {
  if (!works || typeof works !== "object" || Array.isArray(works)) {
    return
  }

  for (const work of Object.values(works)) {
    if (work && typeof work === "object" && !Array.isArray(work)) {
      normalizeSessionFields(work as Record<string, unknown>)
    }
  }
}

/**
 * Every work of a ledger in `works` map order, keeping each entry with a non-null value. A record
 * written before `works` existed has no map, so its top-level mirror is synthesized into exactly one
 * work when the plan name, plan and start instant are all present, and reported as an empty list
 * otherwise.
 */
export function getBoulderWorks(state: BoulderState): BoulderWorkState[] {
  if (state.works && typeof state.works === "object") {
    return Object.values(state.works).filter((work): work is BoulderWorkState => work != null)
  }

  if (!state.active_plan || !state.plan_name || !state.started_at) {
    return []
  }

  return [buildWorkFromMirror(state)]
}

/** Works that may still be resumed — `completed` and `abandoned` are filtered out — or an empty list when the ledger is absent or unreadable. */
export function getActiveWorks(directory: string): BoulderWorkState[] {
  // Ledger snapshot; without one there is nothing to filter.
  const state = readBoulderState(directory)
  if (!state) {
    return []
  }

  return getBoulderWorks(state).filter((work) => work.status !== "completed" && work.status !== "abandoned")
}

/** The work carrying this `work_id`, or null when the ledger is absent or holds no such work. */
export function getWorkById(directory: string, workId: string): BoulderWorkState | null {
  // Ledger snapshot; without one no id can match.
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  return getBoulderWorks(state).find((work) => work.work_id === workId) ?? null
}

/** The first work bound to this plan name, optionally narrowed to one worktree path; null when no work matches or the ledger is absent. */
export function getWorkByPlanName(
  directory: string,
  planName: string,
  options?: { worktreePath?: string },
): BoulderWorkState | null {
  // Ledger snapshot; without one no plan name can match.
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  // Optional narrowing: without it any work of that plan name qualifies, whichever worktree it ran in.
  const worktreePath = options?.worktreePath
  return getBoulderWorks(state).find((work) => {
    if (work.plan_name !== planName) {
      return false
    }

    return worktreePath ? work.worktree_path === worktreePath : true
  }) ?? null
}

/**
 * The work a session belongs to, the newest last mutation winning (falling back from `updated_at` to
 * `started_at`). A session listed only in the top-level mirror resolves to the work synthesized from
 * that mirror, one listed nowhere resolves to null, and an absent ledger resolves to null as well.
 */
export function getWorkForSession(directory: string, sessionId: string): BoulderWorkState | null {
  // Ledger snapshot; without one the session cannot be resolved.
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  // Lookup key in storage form, so a caller may pass the id bare or already prefixed.
  const normalizedSessionId = normalizeSessionId(sessionId)
  // Winning candidate so far; null until the first work containing the session is seen.
  let newestWork: BoulderWorkState | null = null
  // Timestamp of that candidate in milliseconds; the first work seen wins a tie.
  let newestWorkMs = 0

  for (const work of getBoulderWorks(state)) {
    if (!work.session_ids.includes(normalizedSessionId)) {
      continue
    }

    // Last mutation of this work, falling back to its start instant and then to 0 when neither parses.
    const workMs = parseIsoToMs(work.updated_at ?? work.started_at) ?? 0
    if (!newestWork || workMs > newestWorkMs) {
      newestWork = work
      newestWorkMs = workMs
    }
  }

  if (newestWork) {
    return newestWork
  }

  return state.session_ids.includes(normalizedSessionId) ? buildWorkFromMirror(state) : null
}

/**
 * Resumable works as status options, each carrying the checklist progress of its plan read at this
 * moment and a flag saying whether the top-level mirror reflects it. Terminal works are omitted; an
 * absent or unreadable ledger yields an empty list.
 */
export function getWorkResumeOptions(directory: string): BoulderWorkResumeOption[] {
  // Ledger snapshot; without one there are no works to offer for resume.
  const state = readBoulderState(directory)
  if (!state) {
    return []
  }

  return getBoulderWorks(state)
    .filter((work) => work.status !== "completed" && work.status !== "abandoned")
    .map((work) => {
      // Checklist counts of this work's plan file, read now; a deleted or checkbox-less plan reads as zero.
      const progress = getPlanProgress(resolveBoulderPlanPathForWork(directory, work))
      return {
        work_id: work.work_id,
        plan_name: work.plan_name,
        active_plan: work.active_plan,
        worktree_path: work.worktree_path,
        status: work.status && isValidWorkStatus(work.status) ? work.status : "active",
        started_at: work.started_at,
        updated_at: work.updated_at ?? work.started_at,
        ended_at: work.ended_at,
        elapsed_ms: work.elapsed_ms,
        session_count: work.session_ids.length,
        progress,
        is_current_mirror: state.active_work_id === work.work_id,
      }
    })
}

/**
 * The timer record of one plan task key: the mirrored work's own record wins, the root map is the
 * fallback, and null means neither holds that key or the ledger is absent.
 */
export function getTaskSessionState(directory: string, taskKey: string): TaskSessionState | null {
  // Ledger snapshot both lookups below read from.
  const state = readBoulderState(directory)
  if (state?.active_work_id) {
    // Work the mirror points at, whose own timers are consulted before the root map.
    const work = state.works?.[state.active_work_id]
    // Its record for this key, when the work has one.
    const taskSession = work?.task_sessions?.[taskKey]
    if (taskSession) {
      return taskSession
    }
  }

  if (!state?.task_sessions) {
    return null
  }

  return state.task_sessions[taskKey] ?? null
}
