#!/usr/bin/env node
// Wave-3 t4 evidence: F-B8-1 degradation, driven end-to-end through the REAL
// MCP stdio child.
//
// Arms:
//  1. serve-layer repro : the adopted `runCodegraphServe()` called with the real
//     provisioning path and an unwritable $HOME -> the throw is reproduced
//     (this is the t1 "throw at acquireLock" root cause, no launcher involved).
//  2. launcher RED      : the PRE-FIX launcher as an MCP child with no
//     resolvable binary and $HOME/.mpd read-only -> uncaught error, no MCP
//     response.
//  3. launcher GREEN    : the POST-FIX launcher under the identical condition ->
//     exit 0, initialize/tools/list answered, 0 tools, skip hint on stderr.
//  4. launcher control  : a resolvable env pin in a writable HOME -> the real
//     child is reached and the degrade path is NOT taken.
//  5. serve-layer control: writable HOME + an injected provisioner -> resolution
//     ends "provisioned" and the process runs; no degrade.
//
// Run from the repo root: node <this file>
import { spawn } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
if (!existsSync(join(repo, "package.json"))) throw new Error(`repo root not found from ${here}`)

const sandbox = join(here, "mcp-run")
rmSync(sandbox, { recursive: true, force: true })
const projectDir = join(sandbox, "project")
const writableHome = join(sandbox, "home")
mkdirSync(projectDir, { recursive: true })
mkdirSync(join(writableHome, ".mpd"), { recursive: true })

const fakeBundle = join(sandbox, "fakebundle")
mkdirSync(join(fakeBundle, "packages/mpd-mcp-codegraph/dist"), { recursive: true })
mkdirSync(join(fakeBundle, "packages/mpd-mcp-shared"), { recursive: true })
cpSync(join(repo, "packages/mpd-mcp-shared/bin-resolve.mjs"), join(fakeBundle, "packages/mpd-mcp-shared/bin-resolve.mjs"))
cpSync(join(repo, "packages/mpd-mcp-codegraph/dist/serve.js"), join(fakeBundle, "packages/mpd-mcp-codegraph/dist/serve.js"))
const fixedLauncherSrc = join(repo, "packages/mpd-mcp-codegraph/launch.mjs")
const prefixLauncherSrc = join(here, "pre-fix-launch.mjs")
const redLauncher = join(fakeBundle, "packages/mpd-mcp-codegraph/launch.red.mjs")
const greenLauncher = join(fakeBundle, "packages/mpd-mcp-codegraph/launch.green.mjs")
cpSync(prefixLauncherSrc, redLauncher)
cpSync(fixedLauncherSrc, greenLauncher)

// A minimal but *well-behaved* codegraph stand-in: it answers line-delimited
// JSON-RPC like the real serve bridge expects and exits on stdin EOF, so the
// "resolvable pin" control completes cleanly instead of hitting a bridge teardown.
const stub = join(sandbox, "codegraph-stub")
writeFileSync(stub, `#!${process.execPath}
process.stderr.write("STUB_CODEGRAPH_LAUNCHED " + process.argv.slice(2).join(" ") + "\\n")
let buf = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  let index
  while ((index = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, index)
    buf = buf.slice(index + 1)
    try {
      const message = JSON.parse(line)
      if (message.id === undefined) continue
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codegraph-stub", version: "0" } } }) + "\\n")
    } catch { /* ignore */ }
  }
})
process.stdin.on("end", () => process.exit(0))
`)
chmodSync(stub, 0o755)

const READ_ONLY_HOME = "/root" // measured read-only: `touch /root/.mpd/x` -> EROFS

function childEnv(extra) {
  const env = { ...process.env }
  delete env.MPD_CODEGRAPH_BIN
  delete env.MPD_DSH_CODEGRAPH_BIN
  delete env.MPD_DSH_CODEGRAPH_CLI
  return Object.assign(env, { PATH: "/usr/bin:/bin", MPD_CODEGRAPH_PROJECT_CWD: projectDir }, extra)
}

const MCP_REQUESTS = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wave3-t4", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]

/** Spawn one launcher as a real MCP stdio child and collect both streams. */
function drive(launcher, extraEnv, timeoutMs = 30_000) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [launcher], { cwd: projectDir, env: childEnv(extraEnv), stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let finished = false
    let killed = false
    const finish = (code, signal) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      done({ code, signal, killed, stdout, stderr })
    }
    const timer = setTimeout(() => { killed = true; try { child.kill("SIGKILL") } catch { /* ignore */ } }, timeoutMs)
    child.stdout.on("data", (d) => { stdout += d })
    child.stderr.on("data", (d) => { stderr += d })
    child.stdin.on("error", () => { /* the child may die before we finish writing */ })
    child.on("error", (error) => { stderr += String(error); finish(null, null) })
    child.on("exit", (code, signal) => finish(code, signal))
    for (const request of MCP_REQUESTS) child.stdin.write(JSON.stringify(request) + "\n")
    setTimeout(() => { try { child.stdin.end() } catch { /* ignore */ } }, 1200)
  })
}

function jsonLines(text) {
  const out = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith("{")) continue
    try { out.push(JSON.parse(trimmed)) } catch { /* stream noise */ }
  }
  return out
}

const results = {}

// ── 1. serve-layer repro: the real provisioning path on an unwritable HOME ────
{
  const serve = await import(join(fakeBundle, "packages/mpd-mcp-codegraph/dist/serve.js"))
  let error = null
  try {
    await serve.runCodegraphServe({
      env: childEnv({ HOME: READ_ONLY_HOME }),
      homeDir: READ_ONLY_HOME,
      cwd: projectDir,
      stdin: { [Symbol.asyncIterator]: async function* () { /* no input */ } },
      stdout: { write() { return true } },
      stderr: { write() { return true } },
    })
  } catch (thrown) {
    error = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
  }
  results.serveLayerRepro = { threw: error !== null, error }
}

// ── 2/3. launcher RED vs GREEN under the identical failing condition ──────────
{
  const red = await drive(redLauncher, { HOME: READ_ONLY_HOME })
  const green = await drive(greenLauncher, { HOME: READ_ONLY_HOME })
  const greenReplies = jsonLines(green.stdout)
  const byId = (id) => greenReplies.find((r) => r.id === id)
  results.launcherRed = {
    exitCode: red.code,
    stdoutBytes: red.stdout.length,
    uncaughtSignature: /EROFS|EACCES|ENOENT|Uncaught|uncaughtException/.test(red.stderr),
    uncaughtLine: (red.stderr.split("\n").find((l) => /EROFS|EACCES|ENOENT/.test(l)) ?? "").trim(),
    stderrHead: red.stderr.split("\n").slice(0, 4).join("\n"),
  }
  results.launcherGreen = {
    exitCode: green.code,
    hasMcpInitialize: byId(1)?.result?.serverInfo?.name === "codegraph",
    hasToolsList: Array.isArray(byId(2)?.result?.tools) && byId(2).result.tools.length === 0,
    carriesOriginalError: green.stderr.includes("[mpd-mcp-codegraph] unavailable fallback:"),
    carriesSkipHint: green.stderr.includes("CodeGraph MCP skipped"),
    stdoutBytes: green.stdout.length,
  }
  writeFileSync(join(here, "red-launcher.stderr.txt"), red.stderr)
  writeFileSync(join(here, "green-launcher.stderr.txt"), green.stderr)
  writeFileSync(join(here, "green-launcher.stdout.jsonl"), green.stdout)
}

// ── 4. launcher control: a resolvable pin reaches the real child ──────────────
{
  const control = await drive(greenLauncher, { HOME: writableHome, MPD_CODEGRAPH_BIN: stub }, 15_000)
  results.launcherControl = {
    reachedChild: control.stderr.includes("STUB_CODEGRAPH_LAUNCHED"),
    tookDegradePath: control.stderr.includes("unavailable fallback"),
    exitCode: control.code,
    killedAfterTimeout: control.killed,
  }
}

// ── 5. serve-layer control: writable HOME, injected provisioner ───────────────
{
  const serve = await import(join(fakeBundle, "packages/mpd-mcp-codegraph/dist/serve.js"))
  let captured = null
  const code = await serve.runCodegraphServe({
    env: childEnv({ HOME: writableHome }),
    homeDir: writableHome,
    cwd: projectDir,
    ensureProvisioned: async () => ({ provisioned: true, binPath: stub }),
    runProcess: async (command, args, options) => { captured = { command, args, cwd: options.cwd }; return 0 },
    stdin: { [Symbol.asyncIterator]: async function* () { /* no input */ } },
    stdout: { write() { return true } },
    stderr: { write() { return true } },
  })
  results.serveLayerControl = { exitCode: code, ranProcess: captured !== null, command: captured?.command, args: captured?.args }
}

const checks = {
  "serve-layer repro throws the filesystem error": results.serveLayerRepro.threw && /EROFS|EACCES|ENOENT/.test(results.serveLayerRepro.error ?? ""),
  "pre-fix launcher dies uncaught with no MCP response": results.launcherRed.exitCode !== 0 && results.launcherRed.stdoutBytes === 0 && results.launcherRed.uncaughtSignature,
  "post-fix launcher exits 0 and answers MCP": results.launcherGreen.exitCode === 0 && results.launcherGreen.hasMcpInitialize && results.launcherGreen.hasToolsList,
  "post-fix launcher reports the original error + skip hint": results.launcherGreen.carriesOriginalError && results.launcherGreen.carriesSkipHint,
  "a resolvable pin still reaches the real child (no degrade)": results.launcherControl.reachedChild && !results.launcherControl.tookDegradePath,
  "writable HOME resolves/provisions normally": results.serveLayerControl.exitCode === 0 && results.serveLayerControl.ranProcess && results.serveLayerControl.command === stub,
}

const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
const report = { stamp: new Date().toISOString(), checks, failures, results }
writeFileSync(join(here, "degrade-launcher.result.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ checks, failures }, null, 2))
process.exitCode = failures.length === 0 ? 0 : 1
