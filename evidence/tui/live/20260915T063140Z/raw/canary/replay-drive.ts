// t8 replay arm (Reviewer) — the captain's suggested next step: exercise the
// RESUME/REPLAY projection on a session that ALREADY carries the event, instead of
// appending it during a live boot.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runTuiSession } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"

const root = process.argv[2]
const outDir = process.argv[3]
const shimDir = process.argv[4]
process.env.PATH = shimDir + ":" + process.env.PATH

const session = runTuiSession({
  lane: "t8-replay",
  root,
  outDir,
  bootWaitMs: 120_000,
  steps: [{ name: "replay-settled", keys: [], waitMs: 8000 }],
})
const strip = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
const panes = session.panes.map((p) => ({ name: p.name, text: strip(p.text), chars: p.text.length }))
const joined = panes.map((p) => p.text).join("\n")
const report = {
  arm: "resume/replay on a session that already carries mpd-tui/board-opened",
  resumedSession: "b003aeb8-495c-4ca0-9917-474626b9eef6",
  tmuxFailures: session.failures,
  bootPaneChars: panes.map((p) => p.chars),
  ourRowRendered: /board opened via/.test(joined),
  canaryRowRendered: /T8-CANARY renderer row/.test(joined),
  anyTranscriptRowOfOurs: /mpd board|board opened/.test(joined),
  chatScreenReached: /❯|按 Esc|esc to interrupt/.test(joined),
  statusLineRendered: /mpd:\s+team /.test(joined),
}
writeFileSync(join(outDir, "replay.panes.json"), JSON.stringify({ panes, failures: session.failures }, null, 2) + "\n")
writeFileSync(join(outDir, "replay.result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(outDir, "replay.log"), strip(session.log))
console.log(JSON.stringify(report, null, 2))
