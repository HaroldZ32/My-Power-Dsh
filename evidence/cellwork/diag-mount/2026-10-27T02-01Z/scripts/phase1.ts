// Phase 1 — the DECISIVE boot: the user's real path, nothing else.
//
//   global `dsh-tui` launcher  ->  `dsh --profile dsh-tui`  ->  the profile copy under the sandbox
//   DSH_HOME, with NO `--patch` overlay and NO absolute module path anywhere.
//
// It proves the `mpd-cellwork` row is IN the booted tree by the row's own post-apply mount line in its
// log sink (R5: a row never prints), and records the rail's other boot facts verbatim.
//
// Usage: bun .tmp-cellwork-reverify/phase1.ts <sandboxRoot> <outDir>
import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join } from "node:path"
import {
  crashSignatures, provisionTuiHome, readSessionHeaders, runTuiSession, sandboxEnv,
} from "../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root: dshhome/ (DSH_HOME), home/ (HOME), ws/ (session workspace). */
const root: string = process.argv[2] ?? ""
/** Where every artifact of this run is written. */
const outDir: string = process.argv[3] ?? ""
if (root === "" || outDir === "") {
  console.error("usage: bun phase1.ts <sandboxRoot> <outDir>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
/** Lines appended to the run log. */
const log: string[] = []
const say = (line: string): void => { log.push(line); console.log(line) }
const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex")

/** The sandbox profile the launcher will boot. */
const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
const bundleDir = join(profileDir, "node_modules", "@mpd-dsh", "mpd")
const patchFile = join(bundleDir, "cordis.patch.yml")
const cellworkModule = join(bundleDir, "packages", "mpd-cellwork-plugin", "dist", "index.js")

say("== environment ==")
say("sandbox root=" + root)
say("DSH_HOME=" + join(root, "dshhome"))
say("HOME=" + join(root, "home"))
say("session workspace=" + join(root, "ws"))
say("launcher on PATH: " + String(execSync("which dsh-tui", { encoding: "utf8" }).trim()))
say("launcher version: " + String(execSync("dsh-tui --version", { encoding: "utf8" }).trim()))
say("dsh on PATH: " + String(execSync("which dsh", { encoding: "utf8" }).trim()) + " (version " + String(execSync("dsh --version", { encoding: "utf8" }).trim()) + ")")
say("global @mpd-dsh/mpd present: " + String(existsSync(execSync("npm root -g", { encoding: "utf8" }).trim() + "/@mpd-dsh/mpd/package.json")))
say("profile cordis.patch.yml sha256=" + sha256(patchFile))
say("profile package.json sha256=" + sha256(join(profileDir, "package.json")))
say("cellwork module exists=" + String(existsSync(cellworkModule)) + " bytes=" + String(existsSync(cellworkModule) ? statSync(cellworkModule).size : -1))
say("cellwork row at cordis.patch.yml:" + String(readFileSync(patchFile, "utf8").split("\n").findIndex((line) => line.includes("- id: mpd-cellwork")) + 1))

say("== HOME fixture ==")
const fixture = provisionTuiHome(root)
for (const file of fixture.evidence) say("wrote " + file + " preset=" + fixture.preset)

say("== boot (no --patch, no absolute row path) ==")
const env = sandboxEnv(root)
say("the child env carries: DSH_HOME=" + String(env.DSH_HOME) + " HOME=" + String(env.HOME))
say("the boot command is the launcher alone: env -i <sandbox vars> dsh-tui   (no --patch, no module path)")

/** Extra files this run keeps beside the lane's own outputs. */
const processEvidence = join(outDir, "process-tree.txt")

/** One tmux drive: wait for the chat screen, then freeze the live process tree and the screen. */
const session = runTuiSession({
  lane: "cellwork-reverify-1",
  root,
  outDir,
  bootWaitMs: 150_000,
  steps: [{
    name: "live",
    keys: [],
    waitMs: 1000,
    before: () => {
      writeFileSync(processEvidence, execSync("ps -eo pid,ppid,etime,args --sort=pid", { encoding: "utf8" }))
    },
  }],
})
say("boot failures=" + JSON.stringify(session.failures))
say("crashSignatures=" + JSON.stringify(crashSignatures(session.log)))
for (const pane of session.panes) say("pane " + pane.name + " -> " + pane.file)

/** The launcher's own child process: the line that proves which command the TUI spawns. */
say("== live processes carrying dsh ==")
const tree = readFileSync(processEvidence, "utf8").split("\n").filter((line) => line.includes("dsh") && !line.includes("ps -eo"))
for (const line of tree) say(line)

/** The boot face: the rail's context line is the tool-count reading. */
const bootPane = readFileSync(join(outDir, "boot.pane.txt"), "utf8")
say("== boot face (context line) ==")
for (const line of bootPane.split("\n")) if (line.includes("已加载上下文") || line.includes("工具")) say(line.trim())

/** The rail's log sinks: a row that applied writes here, a row that never applied cannot. */
const sinkDir = join(root, "ws", ".mpd", "logs")
say("== log sinks: " + sinkDir + " ==")
const sinks: string[] = existsSync(sinkDir) ? readdirSync(sinkDir).sort() : []
say("sinks present (" + String(sinks.length) + "): " + sinks.join(", "))
const cellworkSink = join(sinkDir, "mpd-cellwork.log")
say("mpd-cellwork.log exists=" + String(existsSync(cellworkSink)))
if (existsSync(cellworkSink)) say("--- mpd-cellwork.log ---\n" + readFileSync(cellworkSink, "utf8").trimEnd())
for (const name of sinks) {
  const file = join(sinkDir, name)
  writeFileSync(join(outDir, "sink-" + name), readFileSync(file))
}

/** The decoded session headers (sandbox project keys only). */
say("== session headers ==")
for (const header of readSessionHeaders(root)) {
  say(header.projectKey + "/" + header.sessionId + " agentPreset=" + JSON.stringify(header.agentPreset) + " cwd=" + JSON.stringify(header.cwd) + " " + header.file)
}

/** The full raw terminal log, kept byte-for-byte (gzip) plus its digest. */
const rawLog = session.log
const gz = gzipSync(Buffer.from(rawLog, "utf8"), { level: 9 })
writeFileSync(join(outDir, "tui-pane.log.gz"), gz)
writeFileSync(join(outDir, "tui-pane.log.sha256"), createHash("sha256").update(rawLog).digest("hex") + "  tui-pane.log (uncompressed)\n" + createHash("sha256").update(gz).digest("hex") + "  tui-pane.log.gz\n")
say("raw terminal log bytes=" + String(Buffer.byteLength(rawLog, "utf8")) + " gzip=" + String(gz.length) + " (full log kept as tui-pane.log.gz)")

writeFileSync(join(outDir, "phase1.log"), log.join("\n") + "\n")
writeFileSync(join(outDir, "phase1.result.json"), JSON.stringify({
  root,
  outDir,
  launcher: String(execSync("which dsh-tui", { encoding: "utf8" }).trim()),
  dsh: String(execSync("which dsh", { encoding: "utf8" }).trim()),
  profileDir,
  patchSha256: sha256(patchFile),
  cellworkModuleBytes: statSync(cellworkModule).size,
  failures: session.failures,
  crashSignatures: crashSignatures(session.log),
  sinks,
  cellworkSink: existsSync(cellworkSink),
  panes: session.panes.map((pane) => pane.file),
  rawLogBytes: Buffer.byteLength(rawLog, "utf8"),
}, null, 2) + "\n")
