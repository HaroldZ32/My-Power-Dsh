// Boulder core: where a ledger lives and which copy of a plan file it points at.

import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import { BOULDER_DIR, BOULDER_FILE } from "../constants"
import type { BoulderState, BoulderWorkState } from "../types"

/**
 * Ledger location under a state root.
 *
 * @param directory - the state root, absolute or relative.
 * @returns `<directory>/.mpd/boulder.json`, JOINED rather than resolved so an explicit relative root stays relative.
 */
export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

/**
 * One recorded path as an absolute, normalized path.
 *
 * @param baseDirectory - state root a relative value resolves against.
 * @param trackedPath - the recorded value, absolute or relative.
 * @returns the absolute form: an absolute input is normalized on its own, a relative one against `baseDirectory`.
 */
function resolveTrackedPath(baseDirectory: string, trackedPath: string): string {
  return isAbsolute(trackedPath) ? resolve(trackedPath) : resolve(baseDirectory, trackedPath)
}

/**
 * Absolute plan path of a ledger record, preferring the worktree copy whenever the record names one.
 *
 * A plan that is not CONTAINED in `directory` — outside it, or the directory itself — has no
 * worktree counterpart and resolves to its own path, so a plan shared across worktrees is never
 * silently redirected.
 *
 * @param directory - the state root the record's relative paths resolve against.
 * @param state - the record's plan path plus its optional worktree, the mirror's or a work's.
 * @returns the worktree copy when it exists, else the plan path resolved under the state root.
 */
export function resolveBoulderPlanPath(
  directory: string,
  state: Pick<BoulderState, "active_plan" | "worktree_path">,
): string {
  /** Plan path resolved under the state root; every branch below can fall back to it. */
  const absolutePlanPath = resolveTrackedPath(directory, state.active_plan)
  /** Recorded worktree, trimmed, so an all-whitespace value counts as "no worktree". */
  const worktreePath = state.worktree_path?.trim()
  if (!worktreePath) {
    return absolutePlanPath
  }

  /** State root in absolute form, so the containment test below compares like with like. */
  const absoluteDirectory = resolve(directory)
  /** Plan path relative to that root; empty, `..`-escaping or absolute all mean "not contained". */
  const relativePlanPath = relative(absoluteDirectory, absolutePlanPath)
  if (relativePlanPath.length === 0 || relativePlanPath.startsWith("..") || isAbsolute(relativePlanPath)) {
    return absolutePlanPath
  }

  /** Worktree root, resolved from the state root exactly like a recorded plan path. */
  const absoluteWorktreePath = resolveTrackedPath(directory, worktreePath)
  /** The same relative plan path under the worktree, preferred only while that file really exists. */
  const worktreePlanPath = resolve(absoluteWorktreePath, relativePlanPath)
  return existsSync(worktreePlanPath) ? worktreePlanPath : absolutePlanPath
}

/**
 * The same resolution narrowed to one work record, which carries both fields the mirror also carries.
 *
 * @param directory - the state root the record's relative paths resolve against.
 * @param work - the work whose plan path is wanted.
 * @returns the worktree copy when it exists, else the plan path resolved under the state root.
 */
export function resolveBoulderPlanPathForWork(
  directory: string,
  work: Pick<BoulderWorkState, "active_plan" | "worktree_path">,
): string {
  return resolveBoulderPlanPath(directory, work)
}
