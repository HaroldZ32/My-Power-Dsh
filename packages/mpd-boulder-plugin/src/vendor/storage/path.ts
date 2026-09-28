import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import { BOULDER_DIR, BOULDER_FILE } from "../constants"
import type { BoulderState, BoulderWorkState } from "../types"

/** Ledger location under a state root: `<directory>/.mpd/boulder.json`, joined rather than resolved so a relative root stays relative. */
export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

/** A recorded path as an absolute, normalized path: an absolute value is normalized on its own, a relative one is resolved against the state root. */
function resolveTrackedPath(baseDirectory: string, trackedPath: string): string {
  return isAbsolute(trackedPath) ? resolve(trackedPath) : resolve(baseDirectory, trackedPath)
}

/**
 * Absolute plan path of a ledger record, preferring the worktree copy when the record names one.
 * A plan that is not contained in `directory` — outside it, or the directory itself — has no
 * worktree counterpart and resolves to its own path.
 */
export function resolveBoulderPlanPath(
  directory: string,
  state: Pick<BoulderState, "active_plan" | "worktree_path">,
): string {
  // Plan path resolved against the state root; every branch below falls back to this value.
  const absolutePlanPath = resolveTrackedPath(directory, state.active_plan)
  // Recorded worktree, trimmed, so an all-whitespace value counts as "no worktree".
  const worktreePath = state.worktree_path?.trim()
  if (!worktreePath) {
    return absolutePlanPath
  }

  // Base directory in absolute form, so the containment test below compares like with like.
  const absoluteDirectory = resolve(directory)
  // Plan path relative to that base; empty, ".."-escaping or absolute means it is not contained.
  const relativePlanPath = relative(absoluteDirectory, absolutePlanPath)
  if (relativePlanPath.length === 0 || relativePlanPath.startsWith("..") || isAbsolute(relativePlanPath)) {
    return absolutePlanPath
  }

  // Worktree root, resolved from the state root exactly like a recorded plan path.
  const absoluteWorktreePath = resolveTrackedPath(directory, worktreePath)
  // Same relative plan path under the worktree; preferred only while that file really exists.
  const worktreePlanPath = resolve(absoluteWorktreePath, relativePlanPath)
  return existsSync(worktreePlanPath) ? worktreePlanPath : absolutePlanPath
}

/** The same resolution narrowed to one work record, which carries the two fields the ledger mirror also carries. */
export function resolveBoulderPlanPathForWork(
  directory: string,
  work: Pick<BoulderWorkState, "active_plan" | "worktree_path">,
): string {
  return resolveBoulderPlanPath(directory, work)
}
