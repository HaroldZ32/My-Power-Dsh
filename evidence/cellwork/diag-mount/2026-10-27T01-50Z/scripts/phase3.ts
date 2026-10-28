// Phase 3: the COMMAND registration surface, with a positive control.
//   arm P  — type `/agent-teams` (a command `mpd-team-core` logged as registered) -> the palette must
//            stay open and show the match;
//   arm N  — type `/cellwork` -> the palette must not offer it.
// Both arms run on the SAME boot, so the only difference is the query.
//
// Usage: bun .tmp-mount-check/phase3.ts <sandboxRoot> <outDir>
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { provisionTuiHome, runTuiSession, sleepMs } from "../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root: dshhome/ (DSH_HOME), home/ (HOME), ws/ (session workspace). */
const root: string = process.argv[2] ?? ""
/** Where every artifact of this run is written. */
const outDir: string = process.argv[3] ?? ""
if (root === "" || outDir === "") {
  console.error("usage: bun phase3.ts <sandboxRoot> <outDir>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
provisionTuiHome(root)

/** The tmux drive: control query first, treatment second, each with its own capture. */
const session = runTuiSession({
  lane: "cellwork-diag3",
  root,
  outDir,
  bootWaitMs: 120_000,
  steps: [
    { name: "palette", keys: ["/"], waitMs: 3000 },
    { name: "control-agent-teams", keys: ["agent-teams"], waitMs: 4000 },
    { name: "clear-control", keys: ["BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace"], waitMs: 2000 },
    { name: "treatment-cellwork", keys: ["cellwork"], waitMs: 4000 },
    { name: "close", keys: ["Escape"], waitMs: 1500 },
  ],
})
sleepMs(0)

/** The lines that carry the palette header, its items, or the no-match notice. */
const KEEP = ["命令", "匹配", "agent-teams", "cellwork", "Command", "No ", "没有"]
/** Lines appended to the run log. */
const log: string[] = []
log.push("boot failures=" + JSON.stringify(session.failures))
for (const pane of session.panes) {
  log.push("", "=== " + pane.name + " ===")
  for (const line of pane.text.split("\n")) {
    if (KEEP.some((needle) => line.includes(needle))) log.push(line.trimEnd())
  }
}
writeFileSync(join(outDir, "phase3.log"), log.join("\n") + "\n")
writeFileSync(join(outDir, "boot3-ansi.log"), session.log)
console.log(log.join("\n"))
