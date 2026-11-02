// REVIEWER'S PROBE: two explicit `pairs` naming the SAME source. The plan is computed before anything
// moves, so the second row is still "mergeable" at plan time; at apply time its source is already
// archived. Does the call report that pair as skipped, or throw after a partial apply?
// Run: bun evidence/autoproject-refactor/w3c/probe-duplicate-pairs.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { optimizeWorkmates } from "../../../packages/mpd-workmate-plugin/src/index.ts"

/** The sandbox HOME the library lives under. */
const home = mkdtempSync(join(tmpdir(), "mpd-w3c-probe-home-"))
/** The sandbox cwd the in-use gate scans. */
const cwd = mkdtempSync(join(tmpdir(), "mpd-w3c-probe-cwd-"))
process.env.HOME = home
process.chdir(cwd)
delete process.env.DSH_HOME

/** The library root. */
const root = join(home, ".mpd", "workmate")

/**
 * Seed one instance the way `mpd_workmate_init` would.
 * @param name - the instance key.
 * @param uses - its use count (the survivor tiebreak).
 */
function seed(name: string, uses: number): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    name, baseId: "hephaestus", baseName: "Reviewer", description: "judges",
    provider: "deepseek-official", model: "deepseek-v4-flash", readonly: false,
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z",
    uses, lastTask: "ship", renamedFrom: [],
  }, null, 2) + "\n")
  writeFileSync(join(dir, "persona.md"), "You review.\n")
  writeFileSync(join(dir, "memory.md"), "")
  writeFileSync(join(dir, "note.md"), "reviews diffs for correctness and regression risk\n")
}

seed("oracle-1", 3)
seed("oracle-2", 1)
seed("oracle-3", 2)

console.log("library before:", readdirSync(root).sort().join(","))
try {
  const result = optimizeWorkmates({ confirm: true, pairs: [{ from: "oracle-2", into: "oracle-1" }, { from: "oracle-2", into: "oracle-3" }] })
  console.log("RESULT:", JSON.stringify({ applied: result.applied.map((row) => `${row.from}->${row.into}`), skipped: result.skipped }))
} catch (error) {
  console.log("THREW:", String((error as Error)?.message ?? error))
}
console.log("library after :", readdirSync(root).filter((name) => name !== ".archive").sort().join(","))
console.log("archive after :", existsSync(join(root, ".archive")) ? readdirSync(join(root, ".archive")).sort().join(",") : "(none)")
rmSync(home, { recursive: true, force: true })
rmSync(cwd, { recursive: true, force: true })
