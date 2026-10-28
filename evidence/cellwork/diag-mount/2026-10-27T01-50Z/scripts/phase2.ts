// Phase 2: same isolated sandbox + the SAME copied profile, but with ONE fixture added to the
// PROFILE's own user layer (`<profile>/cordis.patch.yml`): an id-targeted `llm-deepseek` row that
// points the model route at a loopback stub. Nothing is added to the composition as a plugin ROW; the
// `mpd-cellwork` row's presence is unchanged (asserted again in this run).
//
// Purpose: produce the REGISTRATION SURFACE — the model-facing tool list (`request/header.tools[]`,
// plus the stub's own `offeredTools`) — and the `/cellwork` command-palette probe.
//
// Usage: bun .tmp-mount-check/phase2.ts <sandboxRoot> <outDir>
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { makeStubModel } from "../skills/dsh-qa/scripts/extension-isolation.ts"
import { recordedToolNames, readSessionEvents } from "../skills/dsh-qa/scripts/lib/session-evidence.ts"
import { crashSignatures, provisionTuiHome, runTuiSession } from "../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root: dshhome/ (DSH_HOME), home/ (HOME), ws/ (session workspace). */
const root: string = process.argv[2] ?? ""
/** Where every artifact of this run is written. */
const outDir: string = process.argv[3] ?? ""
if (root === "" || outDir === "") {
  console.error("usage: bun phase2.ts <sandboxRoot> <outDir>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
/** Lines appended to the run log. */
const log: string[] = []
const say = (line: string): void => { log.push(line); console.log(line) }

/** The stub: one plain-text answer, so the turn ends after the first request. */
const stub = makeStubModel({ script: [{ text: "QA-STUB-PONG" }], label: "cellwork-diag" })
const port = await stub.listen()
say("stub listening on 127.0.0.1:" + String(port))

/** The sandbox profile's own user patch layer. */
const patchFile = join(root, "dshhome", "profiles", "dsh-tui", "cordis.patch.yml")
if (process.argv.includes("--append-route")) {
  /** The ONE fixture: an id-targeted override of the host's deepseek row's endpoint. */
  const fixture = ["", "# QA fixture (this run only): point the deepseek route at the loopback stub.", "- id: llm-deepseek", "  config:", "    baseURL: http://127.0.0.1:" + String(port) + "/v1", "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n")
  appendFileSync(patchFile, fixture)
  say("appended route fixture to " + patchFile)
}
say("profile patch mentions mpd-cellwork: " + String(readFileSync(patchFile, "utf8").includes("mpd-cellwork")))

provisionTuiHome(root)

/** The tmux drive: palette probe, then one real turn answered by the stub. */
const session = runTuiSession({
  lane: "cellwork-diag2",
  root,
  outDir,
  bootWaitMs: 120_000,
  extraEnv: { DEEPSEEK_API_KEY: "sk-diagnostic-stub" },
  steps: [
    { name: "palette-open", keys: ["/"], waitMs: 2500 },
    { name: "palette-cellwork", keys: ["cellwork"], waitMs: 2500 },
    { name: "palette-close", keys: ["Escape"], waitMs: 1500 },
    { name: "prompt", keys: ["ping"], waitMs: 1000 },
    { name: "turn", keys: ["Enter"], waitMs: 25_000 },
  ],
})
say("boot failures=" + JSON.stringify(session.failures))
say("crashSignatures=" + JSON.stringify(crashSignatures(session.log)))

/** The stub's wire view: the tool names the harness OFFERED to the model on request 1. */
const first = stub.trace[0]
say("stub requests=" + String(stub.requests()))
if (first !== undefined) {
  say("stub request 1 offered " + String(first.offeredTools.length) + " tools; cellwork_* = " + JSON.stringify(first.offeredTools.filter((name) => name.startsWith("cellwork_"))))
} else {
  say("stub received NO request — the turn never reached the model")
}
await stub.close()

/** The harness's own record of the same list. */
const store = readSessionEvents(join(root, "dshhome"), { workspace: join(root, "ws") })
const names = recordedToolNames(store.records)
say("session store=" + String(store.file) + " frames=" + String(store.frames) + " records=" + String(store.records.length))
say("recordedToolNames " + String(names.length) + " tools; cellwork_* = " + JSON.stringify(names.filter((name) => name.startsWith("cellwork_"))))

/** The pane lines the command-palette probe produced. */
const palette = session.panes.find((pane) => pane.name === "palette-cellwork")
if (palette !== undefined) {
  for (const line of palette.text.split("\n")) {
    if (line.includes("命令") || line.includes("匹配") || line.includes("cellwork") || line.includes("Command")) say("palette: " + line.trim())
  }
}

/** The cellwork sink must be absent on this boot too. */
const sink = join(root, "ws", ".mpd", "logs", "mpd-cellwork.log")
say("cellwork log sink exists=" + String(existsSync(sink)))

log.push("", "== stub trace ==", JSON.stringify(stub.trace.map((entry) => ({ request: entry.request, offered: entry.offeredTools.length, decision: entry.decision })), null, 1))
log.push("", "== full tool list ==", names.slice().sort().join("\n"))
log.push("", "== stub offered tool list ==", (first?.offeredTools ?? []).slice().sort().join("\n"))

import { writeFileSync } from "node:fs"
writeFileSync(join(outDir, "phase2.log"), log.join("\n") + "\n")
writeFileSync(join(outDir, "boot2-ansi.log"), session.log)
writeFileSync(join(outDir, "phase2.result.json"), JSON.stringify({
  failures: session.failures,
  crashSignatures: crashSignatures(session.log),
  stubRequests: stub.requests(),
  offeredTools: first?.offeredTools ?? [],
  recordedTools: names,
  cellworkLogSink: existsSync(sink),
}, null, 2) + "\n")
