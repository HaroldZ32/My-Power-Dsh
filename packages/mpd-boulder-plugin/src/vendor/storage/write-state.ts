import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { BoulderState, BoulderWorkState } from "../types"
import { getBoulderFilePath } from "./path"
import { getPlanName } from "./plan-progress"
import { getBoulderWorks, readBoulderState } from "./read-state"
import { getElapsedMs, normalizeSessionId, nowIsoString, projectWorkToMirror } from "./shared"

/** Writes the ledger to `<directory>/.mpd/boulder.json`, first refreshing the active work's entry from the top-level mirror; returns false instead of throwing when the write cannot complete. */
export function writeBoulderState(directory: string, state: BoulderState): boolean {
  // Absolute ledger path the state directory is derived from, so an explicit `directory` root stays honoured.
  const filePath = getBoulderFilePath(directory)
  try {
    // Directory that must exist before the ledger file can be created.
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      // Self-ignoring .gitignore - excludes rules/ which is tracked in git
      writeFileSync(join(dir, ".gitignore"), ["*", "!/rules/", "!/rules/**", ""].join("\n"), "utf-8")
    }

    // Shallow copy, so the caller's object is never mutated while the mirror is folded back into `works`.
    const stateToWrite: BoulderState = { ...state }
    if (stateToWrite.works && stateToWrite.active_work_id) {
      // Work the top-level mirror currently reflects, present only while the ledger carries both halves.
      const activeWork = stateToWrite.works[stateToWrite.active_work_id]
      if (activeWork) {
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

/** Deletes the ledger file, leaving the state directory in place; a missing file still counts as success and no error escapes. */
export function clearBoulderState(directory: string): boolean {
  // Absolute path of the ledger file to remove.
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

/** Builds a work id from the plan's slug plus a random suffix, so two runs of the same plan stay distinguishable keys in `works`. */
export function generateWorkId(planName: string): string {
  // Plan name lowercased, with every run of non-alphanumerics collapsed to one dash and edge dashes trimmed.
  const slug = planName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  // Random 32-bit draw as 8 hex digits; zero-padded so the id's length never varies.
  const randomHex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")
  return `${slug.length > 0 ? slug : "work"}-${randomHex}`
}

/** Builds a fresh `schema_version: 2` ledger for `planPath`: one work entry plus the same work mirrored at the top level, with the session id normalized to its `platform:`-prefixed form. */
export function createBoulderState(planPath: string, sessionId: string, agent?: string, worktreePath?: string): BoulderState {
  // One instant reused by the work and the mirror, so a fresh ledger never shows a clock skew between them.
  const startedAt = nowIsoString()
  // Session id with the platform prefix applied, shared by the work entry and the mirror.
  const normalizedSessionId = normalizeSessionId(sessionId)
  // Key the new work is filed under, derived from the plan file's slug.
  const workId = generateWorkId(getPlanName(planPath))
  // Work entry; the optional agent/worktree fields are spread in only when supplied, so an omitted one stays absent.
  const work: BoulderWorkState = {
    work_id: workId,
    active_plan: planPath,
    plan_name: getPlanName(planPath),
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
    plan_name: getPlanName(planPath),
    task_sessions: {},
    ...(agent !== undefined ? { agent } : {}),
    ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
  }
}

/** Makes `workId` the mirrored work and persists the ledger; returns the written state, or null when the ledger, the work or the write is missing. */
export function selectActiveWork(directory: string, workId: string): BoulderState | null {
  // Ledger read from disk once; null means there is nothing to select into.
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  // Work list derived from the ledger — the `works` values, or one work synthesized from the mirror — and the source that materializes `works` when that field is absent.
  const works = getBoulderWorks(state)
  // Target work matched by id; an unknown or stale id is a no-op rather than an error.
  const nextWork = works.find((work) => work.work_id === workId)
  if (!nextWork) {
    return null
  }

  // Ledger to persist: the mirror is projected from nextWork first, and this object is returned only once the write succeeded.
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    active_work_id: workId,
    works: state.works ?? Object.fromEntries(works.map((work) => [work.work_id, work])),
  }
  projectWorkToMirror(nextState, nextWork)
  return writeBoulderState(directory, nextState) ? nextState : null
}

/** Appends a work for `input.planPath` to an existing ledger and makes it the mirror; returns null when there is no ledger to extend or the write fails. */
export function addBoulderWork(
  directory: string,
  input: { planPath: string; sessionId: string; agent?: string; worktreePath?: string; startedAt?: string },
): BoulderState | null {
  // Existing ledger the new work is added to; nothing to extend means null.
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  // Fresh id, so re-adding the same plan never collides with an already recorded work.
  const workId = generateWorkId(getPlanName(input.planPath))
  // Caller-supplied start instant wins over now, so a replayed record keeps its original timing.
  const startedAt = input.startedAt ?? nowIsoString()
  // Session id of the new work, prefix-normalized so the ledger mixes no bare ids.
  const normalizedSessionId = normalizeSessionId(input.sessionId)
  // Work entry for this run; the optional agent/worktree fields are omitted rather than written as undefined.
  const nextWork: BoulderWorkState = {
    work_id: workId,
    active_plan: input.planPath,
    plan_name: getPlanName(input.planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.worktreePath !== undefined ? { worktree_path: input.worktreePath } : {}),
    task_sessions: {},
  }

  // Ledger carrying every prior work by id plus this one, with the mirror projected from nextWork before persisting.
  const nextState: BoulderState = {
    ...state,
    schema_version: 2,
    works: { ...Object.fromEntries(getBoulderWorks(state).map((work) => [work.work_id, work])), [workId]: nextWork },
    active_work_id: workId,
  }
  projectWorkToMirror(nextState, nextWork)
  return writeBoulderState(directory, nextState) ? nextState : null
}

/** Marks a work completed by writing `status`, `ended_at` and `elapsed_ms`, then persists the ledger; a work that already has all three is returned unpersisted. */
export function completeBoulder(directory: string, workId?: string, endedAt?: string): BoulderState | null {
  // Ledger read once and mutated in place; null when there is nothing to complete.
  const state = readBoulderState(directory)
  if (!state) {
    return null
  }

  // Work to complete: the caller's id, else whatever the top-level mirror currently points at.
  const targetWorkId = workId ?? state.active_work_id
  if (!targetWorkId) {
    return null
  }

  // Target entry from the `works` map, falling back to the normalized list for a pre-`works` ledger.
  const work = state.works?.[targetWorkId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === targetWorkId)
  if (!work) {
    return null
  }

  if (work.status === "completed" && work.ended_at !== undefined && work.elapsed_ms !== undefined) {
    return state
  }

  // Completion instant; a caller-supplied value wins so a replayed completion keeps the original duration.
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
