// One boot, BOTH probes: the implementer's probe9 (verbatim, only its output path
// rewritten into my evidence dir) AND my own canary — so the comparison of which
// types render is made inside a single process/composition.
import { copyFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runTuiSession } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"

const root = process.argv[2]
const outDir = process.argv[3]
const canaryModule = process.argv[4]
const probeModule = process.argv[5]

const patchPath = join(root, "dshhome", "profiles", "dsh-tui", "cordis.patch.yml")
copyFileSync(patchPath, join(outDir, "cross-profile-cordis.patch.yml.before"))
writeFileSync(patchPath, [
  "# t8/t12 cross canary (Reviewer): two rows, my sandbox only.",
  "- insert:",
  "    - id: t8-canary-renderers",
  "      name: '" + canaryModule + "'",
  "    - id: t4probe9-copy",
  "      name: '" + probeModule + "'",
  "",
].join("\n"))

const session = runTuiSession({
  lane: "t8-cross",
  root,
  outDir,
  bootWaitMs: 120_000,
  steps: [
    { name: "cross-probe9", keys: ["/t4probe9", "Enter"], waitMs: 9000 },
    { name: "cross-canary", keys: ["/t8probe", "Enter"], waitMs: 9000 },
    { name: "cross-settled", keys: [], waitMs: 4000 },
  ],
})
const strip = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
const panes = session.panes.map((p) => ({ name: p.name, text: strip(p.text), chars: p.text.length }))
const logText = strip(session.log)
writeFileSync(join(outDir, "cross.panes.json"), JSON.stringify({ panes, failures: session.failures }, null, 2) + "\n")
writeFileSync(join(outDir, "cross.log"), logText)
const hits = (needle) => ({
  pane: panes.some((p) => p.text.includes(needle)),
  log: logText.includes(needle),
})
const report = {
  arm: "one boot, both probes: the implementer's probe9 vs my canary",
  tmuxFailures: session.failures,
  probe9_seen_boardOpened: hits("ROW mpd-tui/board-opened"),
  probe9_fresh_neverUsedBefore9: hits("ROW mpd-tui/never-used-before-9"),
  probe9_fresh_plain9: hits("ROW t4probe/plain9"),
  mine_known_0710: hits("T8-KNOWN-ROW-0710"),
  mine_plain_0710: hits("T8-PLAIN-ROW-0710"),
  commandTextSeen: hits("t8probe known="),
}
writeFileSync(join(outDir, "cross.result.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
