// Boulder core: the per-task timers a plan run records inside a work.

import type { BoulderState, BoulderWorkState, TaskSessionState } from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { getElapsedMs, normalizeSessionId, nowIsoString, projectWorkToMirror, RESERVED_KEYS } from "./shared"
import { writeBoulderState } from "./write-state"

/** Caller-supplied fields of one timer upsert, shared by the root and per-work entry points. */
type TaskTimerInput = {
  /** Plan task key, e.g. `1` or `F1`; a reserved key is refused. */
  taskKey: string
  /** Task label as the plan writes it. */
  taskLabel: string
  /** Task title with its id prefix stripped. */
  taskTitle: string
  /** Session holding the timer, bare or already prefixed. */
  sessionId: string
  /** Agent holding the timer, when the caller names one. */
  agent?: string
  /** Free-form grouping, when the caller supplies one. */
  category?: string
}

/**
 * Record one per-task timer inside the work the mirror currently reflects, else on the top-level map.
 *
 * @param directory - the state root holding the ledger.
 * @param input - the timer's task identity, session and optional agent/category.
 * @returns the written ledger, or null when the ledger is missing, the key is reserved or the write fails.
 */
export function upsertTaskSessionState(directory: string, input: TaskTimerInput): BoulderState | null {
  /** Ledger read to decide the branch; an active work takes the whole upsert and outranks the legacy map. */
  const stateForWork = readBoulderState(directory)
  if (stateForWork?.active_work_id) {
    return upsertTaskSessionStateForWork(directory, stateForWork.active_work_id, input)
  }

  /** Ledger for the legacy top-level map, reached only when no work is active. */
  const state = readBoulderState(directory)
  if (!state || RESERVED_KEYS.has(input.taskKey)) {
    return null
  }

  /** Session id in the ledger's `platform:`-prefixed form. */
  const normalizedSessionId = normalizeSessionId(input.sessionId)
  /** Top-level timer map, defaulted to an empty object for a ledger that never recorded one. */
  const taskSessions = state.task_sessions ?? {}
  taskSessions[input.taskKey] = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: normalizedSessionId,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    updated_at: nowIsoString(),
  }

  state.task_sessions = taskSessions
  return writeBoulderState(directory, state) ? state : null
}

/**
 * Record one per-task timer inside a NAMED work, re-applying the previous timer's start, end,
 * duration and status over the caller's fields so a re-upsert never loses recorded timing.
 *
 * @param directory - the state root holding the ledger.
 * @param workId - the work whose timer map receives the entry.
 * @param input - the timer's task identity, session and optional agent/category.
 * @returns the written ledger, or null for a reserved key, a missing ledger, an unknown work id or a failed write.
 */
export function upsertTaskSessionStateForWork(
  directory: string,
  workId: string,
  input: TaskTimerInput,
): BoulderState | null {
  if (RESERVED_KEYS.has(input.taskKey)) {
    return null
  }

  /** Ledger to mutate; null means there is no work registry to update. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  /** Work list derived from the ledger, which is what keeps a pre-`works` record reachable by id. */
  const works = getBoulderWorks(state)
  /** Work whose timer map receives the entry; an unknown id is reported as null rather than silently creating a work. */
  const targetWork = works.find((work) => work.work_id === workId)
  if (!targetWork) {
    return null
  }

  /** Session id in the ledger's `platform:`-prefixed form. */
  const normalizedSessionId = normalizeSessionId(input.sessionId)
  /** Timer already stored under this key, if any; its timing and status are what a re-upsert must not lose. */
  const previousTaskSession = targetWork.task_sessions?.[input.taskKey]
  /** Merged entry: the caller's fields first, then the previous timer's timing and status copied back over them. */
  const nextTaskSession: TaskSessionState = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: normalizedSessionId,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(previousTaskSession?.started_at !== undefined ? { started_at: previousTaskSession.started_at } : {}),
    ...(previousTaskSession?.ended_at !== undefined ? { ended_at: previousTaskSession.ended_at } : {}),
    ...(previousTaskSession?.elapsed_ms !== undefined ? { elapsed_ms: previousTaskSession.elapsed_ms } : {}),
    ...(previousTaskSession?.status !== undefined ? { status: previousTaskSession.status } : {}),
    updated_at: nowIsoString(),
  }

  /** Copy of the target work with the timer replaced; `updated_at` advances so resume ordering sees this mutation. */
  const nextWork: BoulderWorkState = {
    ...targetWork,
    task_sessions: { ...(targetWork.task_sessions ?? {}), [input.taskKey]: nextTaskSession },
    updated_at: nowIsoString(),
  }

  /** Whole ledger with every work preserved by id and only the target replaced, so no parallel work is dropped. */
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: {
      ...Object.fromEntries(works.map((work) => [work.work_id, work])),
      [workId]: nextWork,
    },
  }

  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, nextWork)
  }

  return writeBoulderState(directory, nextState) ? nextState : null
}

/**
 * Start a per-task timer by upserting it and then stamping its start instant and status.
 *
 * @param directory - the state root holding the ledger.
 * @param workId - the work the timer belongs to.
 * @param input - the timer's task identity, session, optional agent/category and an optional start instant.
 * @returns the re-persisted ledger, or null when the upsert or the follow-up lookup fails.
 */
export function startTaskTimer(
  directory: string,
  workId: string,
  input: TaskTimerInput & { startedAt?: string },
): BoulderState | null {
  /** Result of the upsert, which already carries the merged timer entry; null means no work matched. */
  const nextState = upsertTaskSessionStateForWork(directory, workId, {
    ...input,
    sessionId: normalizeSessionId(input.sessionId),
  })
  if (!nextState) {
    return null
  }

  /** Work the timer landed in, re-read from the upserted ledger so the stamp goes to the persisted shape. */
  const work = nextState.works?.[workId]
  /** Timer entry to start; absent alongside the work means the upsert produced an unusable ledger. */
  const taskSession = work?.task_sessions?.[input.taskKey]
  if (!work || !taskSession) {
    return null
  }

  // An ALREADY recorded start wins over both the caller's value and now, so restarting a timer never
  // rewrites the original instant and therefore never inflates the measured duration.
  /** Start instant stamped onto the timer. */
  const startedAt = taskSession.started_at ?? input.startedAt ?? nowIsoString()
  taskSession.started_at = startedAt
  taskSession.status = "running"
  taskSession.updated_at = nowIsoString()
  work.updated_at = nowIsoString()
  return writeBoulderState(directory, nextState) ? nextState : null
}

/**
 * End a per-task timer by writing its end instant, duration and completed status.
 *
 * @param directory - the state root holding the ledger.
 * @param workId - the work the timer belongs to.
 * @param taskKey - the plan task key of the timer.
 * @param endedAt - end instant; defaults to now, and a supplied value keeps a replayed duration.
 * @returns the written ledger, or null when the ledger, the work, the timer or the write is missing.
 */
export function endTaskTimer(
  directory: string,
  workId: string,
  taskKey: string,
  endedAt?: string,
): BoulderState | null {
  /** Ledger read once; the timer is mutated in place and written back only on success. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  /** Target work from the `works` map, falling back to the normalized list for a pre-`works` ledger. */
  const work = state.works?.[workId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === workId)
  if (!work?.task_sessions?.[taskKey]) {
    return null
  }

  /** Timer entry to close, matched by the plan's task key (`1`, `F1`, …). */
  const taskSession = work.task_sessions[taskKey]
  /** End instant; a caller-supplied value wins so a replayed end keeps the original duration. */
  const endAt = endedAt ?? nowIsoString()
  taskSession.ended_at = endAt
  taskSession.elapsed_ms = getElapsedMs(taskSession.started_at, endAt)
  taskSession.status = "completed"
  taskSession.updated_at = nowIsoString()
  work.updated_at = nowIsoString()

  if (state.active_work_id === workId) {
    projectWorkToMirror(state, work)
  }

  return writeBoulderState(directory, state) ? state : null
}
