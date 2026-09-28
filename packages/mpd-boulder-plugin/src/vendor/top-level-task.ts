import { existsSync, readFileSync } from "node:fs"

import { parseCurrentTopLevelTask } from "./plan-checklist"
import type { TopLevelTaskRef } from "./types"

/** Next actionable top-level task of a plan file; null when the file is absent/unreadable, has no structured TODO / Final-Verification section, or has no unticked item left. */
export function readCurrentTopLevelTask(planPath: string): TopLevelTaskRef | null {
  if (!existsSync(planPath)) {
    return null
  }

  try {
    // Raw markdown of the plan, decoded as UTF-8; the parser tolerates either line ending.
    const content = readFileSync(planPath, "utf-8")
    return parseCurrentTopLevelTask(content)
  } catch {
    return null
  }
}
