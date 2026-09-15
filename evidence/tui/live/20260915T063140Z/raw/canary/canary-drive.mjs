#!/usr/bin/env bun
// t8 canary driver (Reviewer) — boot the REAL dsh-TUI from MY sandbox root with
// the canary plugin composed through the sandbox profile's own patch layer, open
// the board (which appends the log-only `mpd-tui/board-opened` event live), then
// capture the pane and ask whether ANY renderer row appeared.
//
// The tmux lifecycle is owned by this single process (CAPTAIN-RECON §2: a tmux
// server does not survive a process boundary), and the lane's own helper is used
// so the capture discipline is identical to the lanes under test.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runTuiSession } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"

const root = process.argv[2]
const outDir = process.argv[3]
const canaryModule = process.argv[4]

// Compose the canary through the SANDBOX profile's own patch layer (never the repo):
// the profile patch is `[]` after a clean `dsh plugin add`, so an insert list is
// the host's documented way to add a row.
const patchPath = join(root, "dshhome", "profiles", "dsh-tui", "cordis.patch.yml")
copyFileSync(patchPath, join(outDir, "profile-cordis.patch.yml.before"))
const patch = [
  "# t8 canary layer (Reviewer, read-only host): one insert row, my sandbox only.",
  "- insert:",
  "    - id: t8-canary-renderers",
  "      name: '" + canaryModule + "'",
  "",
].join("\n")
writeFileSync(patchPath, patch)

const session = runTuiSession({
  lane: "t8-canary",
  root,
  outDir,
  bootWaitMs: 90_000,
  steps: [
    { name: "canary-board-open", keys: ["/mpd board", "Enter"], waitMs: 9000 },
    { name: "canary-after-escape", keys: ["Escape"], waitMs: 7000 },
  ],
})

const strip = (text) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
const panes = session.panes.map((pane) => ({ name: pane.name, text: strip(pane.text), chars: pane.text.length }))
writeFileSync(join(outDir, "canary.panes.json"), JSON.stringify({ panes, failures: session.failures }, null, 2) + "\n")
writeFileSync(join(outDir, "canary.log"), strip(session.log))

const joined = panes.map((pane) => pane.text).join("\n")
const report = {
  sandboxRoot: root,
  canaryModule,
  tmuxFailures: session.failures,
  canaryRowRendered: /T8-CANARY renderer row/.test(joined),
  ourRowRendered: /board opened via/.test(joined),
  boardTitleRendered: /MPD board/.test(joined),
  statusLineRendered: /mpd:\s+team /.test(joined),
  paneChars: panes.map((pane) => pane.chars),
}
writeFileSync(join(outDir, "canary.result.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
