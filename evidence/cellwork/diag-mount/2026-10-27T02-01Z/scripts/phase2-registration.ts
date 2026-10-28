// Phase 2 — the two REGISTRATION surfaces, on one real boot of the same isolated sandbox.
//
//   (a) the model-facing tool list: the harness's own `request/header` record, plus the loopback
//       model stub's wire view of `tools[]` — never `--dump-config`. The stub also issues ONE real
//       `cellwork_status` call, so the harness records a `tool/call` + `tool/result` for a cellwork
//       tool: registered is not the same as callable.
//   (b) the command palette: the empty-query item count, `/agent-teams` as the POSITIVE CONTROL,
//       `/cellwork` as the treatment.
//
// The ONLY extra environment is DEEPSEEK_BASE_URL pointing at the loopback stub + a dummy
// DEEPSEEK_API_KEY: the profile copy stays byte-identical, and no `--patch` overlay is used.
//
// Usage: bun .tmp-cellwork-reverify/phase2-registration.ts <sandboxRoot> <outDir>
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { recordedToolNames, readSessionEvents } from "../skills/dsh-qa/scripts/lib/session-evidence.ts"
import { crashSignatures, provisionTuiHome, runTuiSession, sleepMs } from "../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root: dshhome/ (DSH_HOME), home/ (HOME), ws/ (session workspace). */
const root: string = process.argv[2] ?? ""
/** Where every artifact of this run is written. */
const outDir: string = process.argv[3] ?? ""
if (root === "" || outDir === "") {
  console.error("usage: bun phase2-registration.ts <sandboxRoot> <outDir>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
/** Lines appended to the run log. */
const log: string[] = []
const say = (line: string): void => { log.push(line); console.log(line) }

/** The stub's trace file — one JSON line per request, written by the child as it answers. */
const traceFile = join(outDir, "stub-trace.jsonl")
/** Where the stub child writes its bound port. */
const portFile = join(outDir, "stub-port.txt")
const stubLog = join(outDir, "stub-server.log")
// A rerun starts from an empty trace, so the evidence never mixes two runs.
rmSync(traceFile, { force: true })
rmSync(portFile, { force: true })

/** Start the stub in its own process: the lane blocks its own event loop, so it cannot serve. */
const child = spawn("bun", [join(import.meta.dir, "stub-server.ts"), traceFile, portFile], { stdio: ["ignore", "pipe", "pipe"] })
/** Everything the stub child prints. */
let stubOutput = ""
child.stdout.on("data", (piece: Buffer) => { stubOutput += piece.toString() })
child.stderr.on("data", (piece: Buffer) => { stubOutput += piece.toString() })

/** The stub's bound port, or 0 after the wait budget. */
let port = 0
for (let tick = 0; tick < 100 && port === 0; tick += 1) {
  sleepMs(100)
  if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8").trim())
}
if (port === 0) {
  writeFileSync(stubLog, stubOutput)
  console.error("the stub never bound a port:\n" + stubOutput)
  child.kill("SIGKILL")
  process.exit(3)
}
say("stub child listening on 127.0.0.1:" + String(port) + " (pid " + String(child.pid) + ")")
say("the ONLY extra env: DEEPSEEK_BASE_URL=http://127.0.0.1:" + String(port) + " and a dummy DEEPSEEK_API_KEY")

provisionTuiHome(root)

say("== boot: palette (empty -> control -> treatment), then one stub-answered turn ==")
/** The tmux drive: three palette captures, then the turn that makes the harness record the tool list. */
const session = runTuiSession({
  lane: "cellwork-reverify-2",
  root,
  outDir,
  bootWaitMs: 150_000,
  extraEnv: { DEEPSEEK_BASE_URL: "http://127.0.0.1:" + String(port), DEEPSEEK_API_KEY: "sk-diagnostic-stub" },
  steps: [
    { name: "palette-open", keys: ["/"], waitMs: 3000 },
    { name: "control-agent-teams", keys: ["agent-teams"], waitMs: 4000 },
    { name: "clear-control", keys: ["BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace"], waitMs: 2000 },
    { name: "treatment-cellwork", keys: ["cellwork"], waitMs: 4000 },
    { name: "close-palette", keys: ["BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "Escape"], waitMs: 1500 },
    { name: "prompt", keys: ["ping"], waitMs: 1000 },
    { name: "turn", keys: ["Enter"], waitMs: 40_000 },
  ],
})
say("boot failures=" + JSON.stringify(session.failures))
say("crashSignatures=" + JSON.stringify(crashSignatures(session.log)))

// One more flush window for the child, then stop it and read its trace.
sleepMs(2000)
child.kill("SIGTERM")
sleepMs(500)
if (child.exitCode === null) child.kill("SIGKILL")
writeFileSync(stubLog, stubOutput)

/** Every request the stub answered, in arrival order. */
interface StubTraceEntry {
  /** 1-based arrival ordinal. */
  readonly request: number
  /** The request path the client used. */
  readonly path: string
  /** The tool names the request offered. */
  readonly offeredTools: string[]
  /** The tool results the conversation already carried. */
  readonly toolResults: string[]
  /** Why the stub answered the way it did. */
  readonly decision: string
}
const trace: StubTraceEntry[] = existsSync(traceFile)
  ? readFileSync(traceFile, "utf8").trim().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as StubTraceEntry)
  : []

say("== model-facing tool list: the stub's wire view ==")
say("stub requests=" + String(trace.length))
// The main conversation's request is the one that carries a tool list; the session-title request
// (the same provider route, a separate small call) offers none, so index 0 is not the subject.
const main = trace.find((entry) => entry.offeredTools.length > 0)
/** The tool names the main request offered, sorted. */
const offered = (main?.offeredTools ?? []).slice().sort()
for (const entry of trace) say("request " + String(entry.request) + " path=" + entry.path + " offered=" + String(entry.offeredTools.length) + " decision=" + entry.decision)
if (main !== undefined) {
  say("main request (request " + String(main.request) + ") offered " + String(offered.length) + " tools")
  say("main request cellwork_* (" + String(offered.filter((name) => name.startsWith("cellwork_")).length) + "): " + offered.filter((name) => name.startsWith("cellwork_")).join(", "))
  writeFileSync(join(outDir, "stub-offered-tools.txt"), offered.join("\n") + "\n")
} else {
  say("no request offered a tool list — the turn never reached the model")
}

/** The harness's own record of the same list (`request/header.data.header.tools[]`) + any tool call. */
say("== model-facing tool list: the harness's own request/header ==")
/** The recorded names, or a recorded reason when the store cannot be read. */
let names: string[] = []
let storeNote = ""
/** The harness's own tool/call + tool/result records, as text. */
const toolCalls: string[] = []
try {
  const store = readSessionEvents(join(root, "dshhome"), { workspace: join(root, "ws") })
  names = recordedToolNames(store.records)
  storeNote = "session store=" + String(store.file) + " frames=" + String(store.frames) + " records=" + String(store.records.length)
  say(storeNote)
  say("recordedToolNames " + String(names.length) + " tools; cellwork_* = " + JSON.stringify(names.filter((name) => name.startsWith("cellwork_")).sort()))
  writeFileSync(join(outDir, "recorded-tool-names.txt"), names.slice().sort().join("\n") + "\n")
  for (const record of store.records) {
    const type = (record as { type?: string }).type ?? ""
    if (type !== "tool/call" && type !== "tool/result") continue
    toolCalls.push(type + " " + JSON.stringify((record as { data?: unknown }).data).slice(0, 1500))
  }
  writeFileSync(join(outDir, "tool-call-records.txt"), toolCalls.join("\n") + "\n")
  say("tool/call + tool/result records (" + String(toolCalls.length) + "):")
  for (const line of toolCalls) say(line)
} catch (error) {
  storeNote = "session store unreadable: " + (error instanceof Error ? error.message : String(error))
  say(storeNote)
}

/** The palette lines the three captures carry: the header's item count and the matched row. */
say("== command palette ==")
const KEEP = ["命令", "匹配", "agent-teams", "cellwork", "Command", "No ", "没有", "❯"]
for (const step of ["palette-open", "control-agent-teams", "treatment-cellwork"]) {
  const pane = session.panes.find((entry) => entry.name === step)
  say("--- " + step + " ---")
  if (pane === undefined) { say("(no capture)"); continue }
  for (const line of pane.text.split("\n")) if (KEEP.some((needle) => line.includes(needle))) say(line.trimEnd())
}

/** The row's own mount line on THIS boot, copied into the registration evidence. */
const sink = join(root, "ws", ".mpd", "logs", "mpd-cellwork.log")
say("== row sink ==")
say("mpd-cellwork.log exists=" + String(existsSync(sink)))
if (existsSync(sink)) {
  copyFileSync(sink, join(outDir, "mpd-cellwork.log"))
  say(readFileSync(sink, "utf8").trimEnd())
}

writeFileSync(join(outDir, "phase2.log"), log.join("\n") + "\n")
writeFileSync(join(outDir, "phase2.result.json"), JSON.stringify({
  failures: session.failures,
  crashSignatures: crashSignatures(session.log),
  stubRequests: trace.length,
  offeredTools: offered,
  offeredCellwork: offered.filter((name) => name.startsWith("cellwork_")),
  recordedTools: names.slice().sort(),
  recordedCellwork: names.filter((name) => name.startsWith("cellwork_")).sort(),
  toolCallRecords: toolCalls,
  storeNote,
  cellworkLogSink: existsSync(sink),
  panes: session.panes.map((pane) => pane.file),
}, null, 2) + "\n")
