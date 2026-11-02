// REVIEWER'S PROBE: the merge's in-use gate is given ONE root by the tool/command path — the CALLING
// workspace — while the library is HOME-wide and the contract says "neither busy in ANY live team".
// Run: bun evidence/autoproject-refactor/w3c/probe-busy-scope.ts
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { optimizeWorkmates, planWorkmateMerges } from "../../../packages/mpd-workmate-plugin/src/index.ts"

/** The sandbox HOME. */
const home = mkdtempSync(join(tmpdir(), "mpd-w3c-busy-home-"))
/** Workspace A: the project whose LIVE team uses the workmate. */
const wsA = mkdtempSync(join(tmpdir(), "mpd-w3c-busy-a-"))
/** Workspace B: where the user runs /workmate-optimize. */
const wsB = mkdtempSync(join(tmpdir(), "mpd-w3c-busy-b-"))
process.env.HOME = home
process.chdir(wsB)
delete process.env.DSH_HOME

/** The library root. */
const liveRoot = join(home, ".mpd", "workmate")

/**
 * Seed one instance.
 * @param name - the instance key.
 * @param uses - the use count.
 */
function seed(name: string, uses: number): void {
  const dir = join(liveRoot, name)
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

/** A LIVE mpd-owned team record in workspace A, whose running member IS `oracle-1`. */
const teamDir = join(wsA, ".mpd", "team", "teams")
mkdirSync(teamDir, { recursive: true })
writeFileSync(join(teamDir, "team-a.json"), JSON.stringify({
  version: 1,
  teamId: "team-a",
  name: "workspace A's live wave",
  leadSessionId: "sess-a",
  phase: "active",
  createdAt: "2026-11-02T00:00:00.000Z",
  members: [{ id: "M1", name: "oracle-1", description: "oracle-1", status: "running", executorRef: "sess-a1" }],
  tasks: [],
}, null, 2))

console.log("workspace A's live team uses: oracle-1")
console.log("plan with the TOOL's roots [B]      :", JSON.stringify(planWorkmateMerges({ teamRoots: [wsB] })))
console.log("plan with the UNION roots [B, A]    :", JSON.stringify(planWorkmateMerges({ teamRoots: [wsB, wsA] })))
const applied = optimizeWorkmates({ confirm: true, teamRoots: [wsB] })
console.log("APPLY from B (single root)          :", JSON.stringify({ applied: applied.applied.map((row) => row.from + "->" + row.into), skipped: applied.skipped }))
console.log("library after                        :", readdirSync(liveRoot).filter((entry) => entry !== ".archive" && entry !== "index.json").sort().join(","))
console.log("archive after                        :", readdirSync(join(liveRoot, ".archive")).sort().join(","))
rmSync(home, { recursive: true, force: true })
rmSync(wsA, { recursive: true, force: true })
rmSync(wsB, { recursive: true, force: true })
