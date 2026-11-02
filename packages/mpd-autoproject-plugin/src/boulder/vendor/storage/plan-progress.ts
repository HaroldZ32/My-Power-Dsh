// Boulder core: locate plan files and read their checklist progress.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { PROMETHEUS_PLANS_DIR } from "../constants"
import { parsePlanChecklist } from "../plan-checklist"
import type { PlanProgress } from "../types"

/** Pre-`.mpd` plan directory still scanned at read time, so a plan tree from an older layout keeps listing. */
const LEGACY_PROMETHEUS_PLANS_DIR = ".sisyphus/plans"

/** Plan directories concatenated before the combined list is re-sorted: the current one first, then the legacy one. */
const PROMETHEUS_PLAN_DIRS = [PROMETHEUS_PLANS_DIR, LEGACY_PROMETHEUS_PLANS_DIR] as const

/**
 * Plan files found under a state root, newest modification first.
 *
 * @param directory - the state root to scan.
 * @returns absolute paths of the `*.md` files under both plan directories; a missing or unreadable directory contributes nothing.
 */
export function findPrometheusPlans(directory: string): string[] {
  try {
    return PROMETHEUS_PLAN_DIRS.flatMap((planDir) => {
      /** Absolute path of this candidate plan directory, probed before it is read. */
      const plansDir = join(directory, planDir)
      if (!existsSync(plansDir)) {
        return []
      }

      return readdirSync(plansDir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => join(plansDir, file))
    })
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  } catch {
    return []
  }
}

/**
 * Display name of a plan file.
 *
 * @param planPath - path of the plan file.
 * @returns its basename with the `.md` extension removed.
 */
export function getPlanName(planPath: string): string {
  return basename(planPath, ".md")
}

/**
 * Checklist progress of the plan file at `planPath`.
 *
 * @param planPath - path of the plan file to read.
 * @returns the counts; a missing or unreadable file reports zero total, which keeps `isComplete` false.
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: false }
  }

  try {
    /** Raw plan markdown; the parser is pure, so the file is read once per call. */
    const content = readFileSync(planPath, "utf-8")
    /** Parsed checkbox counts, projected onto the persisted `PlanProgress` fields. */
    const checklist = parsePlanChecklist(content)
    return {
      total: checklist.total,
      completed: checklist.completed,
      isComplete: checklist.total > 0 && checklist.remaining === 0,
    }
  } catch {
    return { total: 0, completed: 0, isComplete: false }
  }
}
