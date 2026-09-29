// t8/t12 causal canary driver — ONE boot, one command, both types compared.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { runTuiSession } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"

const root = process.argv[2]
const outDir = process.argv[3]
const session = runTuiSession({
  lane: "t8-causal",
  root,
  outDir,
  bootWaitMs: 120_000,
  steps: [
    { name: "causal-probe", keys: ["/t8probe", "Enter"], waitMs: 9000 },
    { name: "causal-settled", keys: [], waitMs: 5000 },
  ],
})
const strip = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
const panes = session.panes.map((p) => ({ name: p.name, text: strip(p.text), chars: p.text.length }))
const logText = strip(session.log)
const joined = panes.map((p) => p.text).join("\n") + "\n=====PIPE-PANE-LOG=====\n" + logText
const report = {
  instrument: "BOTH the visible panes AND the full ANSI-stripped pipe-pane log (the implementer used the log)",
  arm: "causal canary: fresh type vs already-seen type in ONE boot",
  knownType: "t8probe/known-0710", plainType: "t8probe/plain-0710",
  
  tmuxFailures: session.failures,
  knownRowRendered: /T8-KNOWN-ROW-0710/.test(joined),
  plainRowRendered: /T8-PLAIN-ROW-0710/.test(joined),
  commandTextSeen: /t8probe known=/.test(joined),
  
  statusLineRendered: /mpd:\s+team /.test(joined),
  paneChars: panes.map((p) => p.chars),
}
writeFileSync(join(outDir, "causal.panes.json"), JSON.stringify({ panes, failures: session.failures }, null, 2) + "\n")
writeFileSync(join(outDir, "causal.result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(outDir, "causal.log"), strip(session.log))
console.log(JSON.stringify(report, null, 2))
