import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { PROMETHEUS_PLANS_DIR } from "../constants"
import { parsePlanChecklist } from "../plan-checklist"
import type { PlanProgress } from "../types"

/** Upstream-state plan directory still read at resume time, so a plan tree from before the `.mpd` retarget keeps listing. */
const LEGACY_PROMETHEUS_PLANS_DIR = ".sisyphus/plans"
/** Plan directories concatenated before the combined list is re-sorted: the current `.mpd/plans` first, then the legacy upstream directory. */
const PROMETHEUS_PLAN_DIRS = [PROMETHEUS_PLANS_DIR, LEGACY_PROMETHEUS_PLANS_DIR] as const

/** Absolute paths of the `.md` plan files found under `directory`, newest `mtime` first; a missing or unreadable directory yields an empty list. */
export function findPrometheusPlans(directory: string): string[] {
  try {
    return PROMETHEUS_PLAN_DIRS.flatMap((planDir) => {
      // Absolute path of this candidate plan directory, checked before it is read.
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

/** Display name of a plan file: its basename with the `.md` extension removed. */
export function getPlanName(planPath: string): string {
  return basename(planPath, ".md")
}

/** Checklist progress of the plan file at `planPath`; a missing or unreadable file reports zero total, so `isComplete` stays false. */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: false }
  }

  try {
    // Raw plan markdown; the parser is pure, so the file is read once per call.
    const content = readFileSync(planPath, "utf-8")
    // Counts of the parsed checkboxes, projected onto the persisted `PlanProgress` fields.
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
