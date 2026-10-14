// Boulder core: create, mutate and persist the ledger.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { BoulderState, BoulderWorkState } from "../types"
import { getBoulderFilePath } from "./path"
import { getPlanName } from "./plan-progress"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { getElapsedMs, normalizeSessionId, nowIsoString, projectWorkToMirror } from "./shared"

/** Content written beside a fresh ledger: ignore everything except a `rules/` tree, which stays tracked. */
const STATE_DIR_GITIGNORE = ["*", "!/rules/", "!/rules/**", ""].join("\n")

/**
 * Write the ledger to `<directory>/.mpd/boulder.json`, refreshing the active work's entry from the
 * top-level mirror first.
 *
 * @param directory - the state root; its `.mpd` directory is created when missing.
 * @param state - the ledger to persist.
 * @returns true on success, false instead of throwing when the write cannot complete.
 */
export function writeBoulderState(directory: string, state: BoulderState): boolean {
  /** Ledger path derived from the state root, so an explicit `directory` root stays honoured. */
  const filePath = getBoulderFilePath(directory)
  try {
    /** Directory that must exist before the ledger file can be created. */
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, ".gitignore"), STATE_DIR_GITIGNORE, "utf-8")
    }

    // SHALLOW copy, so the caller's object is never mutated while the mirror is folded back into `works`.
    /** The ledger as it will be serialized. */
    const stateToWrite: BoulderState = { ...state }
    if (stateToWrite.works && stateToWrite.active_work_id) {
      /** Work the top-level mirror reflects, present only while the ledger carries both halves. */
      const activeWork = stateToWrite.works[stateToWrite.active_work_id]
      if (activeWork) {
        // The mirror is the authority for these fields: a caller that edited them and then wrote must
        // not be silently overwritten by the stale copy inside `works`.
        stateToWrite.works = {
          ...stateToWrite.works,
          [stateToWrite.active_work_id]: {
            ...activeWork,
            active_plan: stateToWrite.active_plan,
            plan_name: stateToWrite.plan_name,
            status: stateToWrite.status,
            started_at: stateToWrite.started_at,
            ended_at: stateToWrite.ended_at,
            elapsed_ms: stateToWrite.elapsed_ms,
            updated_at: stateToWrite.updated_at,
            session_ids: [...stateToWrite.session_ids],
            session_origins: stateToWrite.session_origins ? { ...stateToWrite.session_origins } : {},
            agent: stateToWrite.agent,
            worktree_path: stateToWrite.worktree_path,
            task_sessions: stateToWrite.task_sessions ? { ...stateToWrite.task_sessions } : {},
          },
        }
      }
    }

    writeFileSync(filePath, JSON.stringify(stateToWrite, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Delete the ledger file, leaving the state directory in place.
 *
 * @param directory - the state root holding the ledger.
 * @returns true when the file is gone; a missing file also counts as success and no error escapes.
 */
export function clearBoulderState(directory: string): boolean {
  /** Path of the ledger file to remove. */
  const filePath = getBoulderFilePath(directory)
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Build a work id from a plan's slug plus a random suffix, so two runs of one plan stay distinguishable keys.
 *
 * @param planName - the plan file's slug.
 * @returns `<slug>-<8 hex digits>`; an all-punctuation slug falls back to the literal `work`.
 */
export function generateWorkId(planName: string): string {
  /** Slug form: lowercased, every run of non-alphanumerics collapsed to one dash, edge dashes trimmed. */
  const slug = planName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  /** Random 32-bit draw as 8 hex digits, zero-padded so the id's length never varies. */
  const randomHex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")
  return `${slug.length > 0 ? slug : "work"}-${randomHex}`
}

/**
 * Build a fresh `schema_version: 2` ledger for `planPath`: one work entry plus the same work mirrored at the top level.
 *
 * @param planPath - plan file the new work is bound to.
 * @param sessionId - starting session, stored in prefixed form.
 * @param agent - agent that started the work, when the caller names one.
 * @param worktreePath - git worktree the plan resolves against, when it was started in one.
 * @returns the in-memory ledger; nothing is persisted until `writeBoulderState` runs.
 */
export function createBoulderState(planPath: string, sessionId: string, agent?: string, worktreePath?: string): BoulderState {
  /** One instant reused by the work and the mirror, so a fresh ledger never shows a clock skew between them. */
  const startedAt = nowIsoString()
  /** Session id with its platform prefix applied, shared by the work entry and the mirror. */
  const normalizedSessionId = normalizeSessionId(sessionId)
  /** Slug of the plan file, used both as the work's display name and as its id prefix. */
  const planName = getPlanName(planPath)
  /** Key the new work is filed under. */
  const workId = generateWorkId(planName)
  // The optional agent/worktree fields are SPREAD IN only when supplied, so an omitted one stays
  // absent rather than being persisted as an explicit null.
  /** Work entry for this run. */
  const work: BoulderWorkState = {
    work_id: workId,
    active_plan: planPath,
    plan_name: planName,
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
    task_sessions: {},
  }

  return {
    schema_version: 2,
    active_work_id: workId,
    works: { [workId]: work },
    active_plan: planPath,
    started_at: startedAt,
    status: "active",
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    plan_name: planName,
    task_sessions: {},
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
  }
}

/**
 * Make one work the mirrored one and persist the ledger.
 *
 * @param directory - the state root holding the ledger.
 * @param workId - the work to select.
 * @returns the written ledger, or null when the ledger, the work or the write is missing.
 */
export function selectActiveWork(directory: string, workId: string): BoulderState | null {
  /** Ledger read from disk once; null means there is nothing to select into. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  /** Work list derived from the ledger, and the source that materializes `works` when that field is absent. */
  const works = getBoulderWorks(state)
  /** Target work matched by id; an unknown or stale id is a no-op rather than an error. */
  const nextWork = works.find((work) => work.work_id === workId)
  if (!nextWork) {
    return null
  }

  /** Ledger to persist; it is returned only once the write succeeded. */
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    active_work_id: workId,
    works: state.works ?? Object.fromEntries(works.map((work) => [work.work_id, work])),
  }
  projectWorkToMirror(nextState, nextWork)
  return writeBoulderState(directory, nextState) ? nextState : null
}

/**
 * Append a work for `input.planPath` to an existing ledger and make it the mirror.
 *
 * @param directory - the state root holding the ledger.
 * @param input - the new work's plan path and session, plus its optional agent and worktree.
 * @returns the written ledger, or null when there is no ledger to extend or the write fails.
 */
export function addBoulderWork(
  directory: string,
  input: { planPath: string; sessionId: string; agent?: string; worktreePath?: string; startedAt?: string },
): BoulderState | null {
  /** Existing ledger the new work is added to; nothing to extend means null. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  /** Slug of the new work's plan file. */
  const planName = getPlanName(input.planPath)
  /** Fresh id, so re-adding the same plan never collides with an already recorded work. */
  const workId = generateWorkId(planName)
  /** Caller-supplied start instant wins over now, so a replayed record keeps its original timing. */
  const startedAt = input.startedAt ?? nowIsoString()
  /** Session id of the new work, prefix-normalized so the ledger mixes no bare ids. */
  const normalizedSessionId = normalizeSessionId(input.sessionId)
  /** Work entry for this run; the optional fields are omitted rather than written as undefined. */
  const nextWork: BoulderWorkState = {
    work_id: workId,
    active_plan: input.planPath,
    plan_name: planName,
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.worktreePath !== undefined ? { worktree_path: input.worktreePath } : {}),
    task_sessions: {},
  }

  /** Ledger carrying every prior work by id plus this one. */
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: { ...Object.fromEntries(getBoulderWorks(state).map((work) => [work.work_id, work])), [workId]: nextWork },
    active_work_id: workId,
  }
  projectWorkToMirror(nextState, nextWork)
  return writeBoulderState(directory, nextState) ? nextState : null
}

/**
 * Mark a work completed by writing its status, end instant and duration, then persist the ledger.
 *
 * @param directory - the state root holding the ledger.
 * @param workId - work to complete; defaults to whatever the mirror points at.
 * @param endedAt - completion instant; defaults to now, and a supplied value keeps a replayed duration.
 * @returns the ledger; the in-memory state unchanged when the work already carries all three completion
 *   fields, and null when the ledger, the target id or the work is missing.
 */
export function completeBoulder(directory: string, workId?: string, endedAt?: string): BoulderState | null {
  /** Ledger read once and mutated in place; null when there is nothing to complete. */
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  /** Work to complete: the caller's id, else whatever the top-level mirror currently points at. */
  const targetWorkId = workId ?? state.active_work_id
  if (!targetWorkId) {
    return null
  }

  /** Target entry from the `works` map, falling back to the normalized list for a pre-`works` ledger. */
  const work = state.works?.[targetWorkId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === targetWorkId)
  if (!work) {
    return null
  }

  if (work.status === "completed" && work.ended_at !== undefined && work.elapsed_ms !== undefined) {
    return state
  }

  /** Completion instant; a caller-supplied value wins so a replayed completion keeps the original duration. */
  const endAt = endedAt ?? nowIsoString()
  work.ended_at = endAt
  work.elapsed_ms = getElapsedMs(work.started_at, endAt)
  work.status = "completed"
  work.updated_at = nowIsoString()

  if (state.active_work_id === targetWorkId) {
    projectWorkToMirror(state, work)
  }

  return writeBoulderState(directory, state) ? state : null
}
