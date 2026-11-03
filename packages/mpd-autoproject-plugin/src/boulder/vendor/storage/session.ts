// Boulder core: attach a session id to the ledger, at its root or inside one named work.

import type { BoulderSessionOrigin, BoulderState, BoulderWorkState } from "../types"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { normalizeSessionId, nowIsoString, projectWorkToMirror } from "./shared"
import { writeBoulderState } from "./write-state"

/**
 * Attach a session id to the ledger: to the work the mirror points at when there is one, otherwise
 * to the top-level session list.
 *
 * An id already listed keeps its recorded origin and costs no write. A failed write is ROLLED BACK
 * before returning, so a caller never sees a half-recorded session.
 *
 * @param directory - the state root holding the ledger.
 * @param sessionId - the session to attach, bare or already prefixed.
 * @param origin - how the session joined; defaults to `direct`.
 * @returns the persisted ledger, or null when there is no ledger or the write failed.
 */
export function appendSessionId(
  directory: string,
  sessionId: string,
  origin: "direct" | "appended" = "direct",
): BoulderState | null {
  /** Storage form of the id, so a caller may pass it bare or already platform-prefixed. */
  const normalizedSessionId = normalizeSessionId(sessionId)
  // Probed BEFORE the mutating read below, because the decision is which list grows: with an active
  // work the session belongs to that work and must not also appear at the root.
  /** Id of the work the mirror points at, when the ledger has one. */
  const activeWorkId = readBoulderState(directory)?.active_work_id
  if (activeWorkId) {
    return appendSessionIdForWork(directory, activeWorkId, normalizedSessionId, origin)
  }

  /** Second read, taken after the mirror check: this is the copy that gets mutated and written back. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  if (!state.session_origins || typeof state.session_origins !== "object" || Array.isArray(state.session_origins)) {
    state.session_origins = {}
  }

  if (!state.session_ids?.includes(normalizedSessionId)) {
    if (!Array.isArray(state.session_ids)) {
      state.session_ids = []
    }

    /** Pre-write copy of the id list, used to roll the append back when the write fails. */
    const originalSessionIds = [...state.session_ids]
    /** Pre-write copy of the origin map, so a failed write leaves no half-recorded session behind. */
    const originalSessionOrigins = { ...state.session_origins }
    state.session_ids.push(normalizedSessionId)
    state.session_origins[normalizedSessionId] = origin
    if (writeBoulderState(directory, state)) {
      return state
    }

    state.session_ids = originalSessionIds
    state.session_origins = originalSessionOrigins
    return null
  }

  // Already listed, but possibly without an origin: filling that in is still a mutation worth persisting.
  if (!state.session_origins[normalizedSessionId]) {
    state.session_origins[normalizedSessionId] = origin
    if (!writeBoulderState(directory, state)) {
      return null
    }
  }

  return state
}

/**
 * Attach a session id to ONE named work, leaving every other work untouched, and refresh that work's
 * `updated_at`.
 *
 * @param directory - the state root holding the ledger.
 * @param workId - the work the session joins; an unknown id is a no-op rather than a new work.
 * @param sessionId - the session to attach, bare or already prefixed.
 * @param origin - how the session joined; defaults to `direct`.
 * @returns the persisted ledger, or null when the ledger or the work is missing, or the write failed.
 */
export function appendSessionIdForWork(
  directory: string,
  workId: string,
  sessionId: string,
  origin: BoulderSessionOrigin = "direct",
): BoulderState | null {
  /** Storage form of the id, so one session cannot land twice under two spellings. */
  const normalizedSessionId = normalizeSessionId(sessionId)
  /** Ledger snapshot every field of the next state is derived from. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  /** Existing works in read order, re-keyed below so the target can be replaced in place. */
  const works = getBoulderWorks(state)
  /** Work the session joins; an unknown id makes this a no-op rather than creating a work. */
  const targetWork = works.find((work) => work.work_id === workId)
  if (!targetWork) {
    return null
  }

  /** New copy of the target: the id list gains the session at most once, the origin is overwritten. */
  const updatedWork: BoulderWorkState = {
    ...targetWork,
    session_ids: targetWork.session_ids.includes(normalizedSessionId)
      ? [...targetWork.session_ids]
      : [...targetWork.session_ids, normalizedSessionId],
    session_origins: { ...(targetWork.session_origins ?? {}), [normalizedSessionId]: origin },
    updated_at: nowIsoString(),
  }

  /** Whole ledger rewritten around the updated work, stamped as the multi-work schema version. */
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: {
      ...Object.fromEntries(works.map((work) => [work.work_id, work])),
      [workId]: updatedWork,
    },
  }

  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, updatedWork)
  }

  return writeBoulderState(directory, nextState) ? nextState : null
}
