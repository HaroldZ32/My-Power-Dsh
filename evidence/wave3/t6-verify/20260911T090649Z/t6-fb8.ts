#!/usr/bin/env node
// t6 (Reviewer) OWN F-B8-1 harness — independent reconstruction.
// Pre-fix bytes come from the STALE STAGED PACKAGE
// (dist/mpd-package/packages/mpd-mcp-codegraph/launch.mjs, built 2026-09-11 07:27Z,
// before the wave-3 fix), NOT from the implementer's saved copy. Both variants run
// as real MCP stdio children from a cwd outside the bundle, with the binary
// unresolvable (fake bundle under /tmp, no .toolchain, no node_modules) and
// HOME=/root whose ~/.mpd is a genuinely read-only filesystem.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const PRE_FIX_LAUNCHER = join(repoRoot, "dist", "mpd-package", "packages", "mpd-mcp-codegraph", "launch.mjs")
const FIXED_LAUNCHER = join(repoRoot, "packages", "mpd-mcp-codegraph", "launch.mjs")
const SCRUB = ["MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_CLI", "MPD_CODEGRAPH_PROJECT_CWD", "MPD_DSH_CODEGRAPH_PROJECT_CWD", "DSH_WORKSPACE_ROOT"]

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 900) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 220)}`)
}

function mcpChild(script, { cwd, env, timeoutMs = 90_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    let out = "", err = "", exited = null
    let stdoutBytes = 0
    const pending = new Map()
    let buf = ""
    const onLine = (line) => {
      let msg
      try { msg = JSON.parse(line) } catch { return }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    child.stdout.on("data", (d) => { stdoutBytes += d.length; out += d; buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l) } })
    child.stderr.on("data", (d) => { err += d })
    child.on("exit", (code, signal) => { exited = { code, signal } })
    const request = (id, method, params, ms = 25_000) => new Promise((res) => {
      const t = setTimeout(() => { pending.delete(id); res(null) }, ms)
      pending.set(id, (m) => { clearTimeout(t); res(m) })
      try { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n") } catch (e) { clearTimeout(t); res({ error: String(e) }) }
    })
    const waitExit = (ms) => new Promise((res) => {
      if (exited) return res(exited)
      const t = setTimeout(() => res(null), ms)
      child.once("exit", (code, signal) => { clearTimeout(t); res({ code, signal }) })
    })
    ;(async () => {
      const init = await request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t6-fb8", version: "1.0" } })
      let tools = null
      if (init) {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
        const tl = await request(2, "tools/list", {})
        tools = (tl?.result?.tools ?? []).map((t) => t.name)
      }
      const exit = exited ?? (await (async () => {
        // A live MCP server stays up waiting on stdin: close it so the process
        // can reach its natural exit code (0 = degraded-and-alive, 1 = died).
        try { child.stdin.end() } catch {}
        return await waitExit(20_000)
      })())
      try { child.kill("SIGKILL") } catch {}
      resolve({ init, tools, exit, stdout: out, stderr: err, stdoutBytes })
    })()
  })
}

const sandbox = mkdtempSync(join(tmpdir(), "t6-fb8-"))
const cwdOutside = join(sandbox, "cwd-outside-bundle")
mkdirSync(cwdOutside, { recursive: true })
const env = { ...process.env, HOME: "/root" }
for (const k of SCRUB) delete env[k]

function stageVariant(name, launcherSrc) {
  const fb = join(sandbox, name, "fakebundle")
  cpSync(join(repoRoot, "packages", "mpd-mcp-codegraph", "dist"), join(fb, "packages", "mpd-mcp-codegraph", "dist"), { recursive: true })
  cpSync(join(repoRoot, "packages", "mpd-mcp-shared"), join(fb, "packages", "mpd-mcp-shared"), { recursive: true })
  cpSync(launcherSrc, join(fb, "packages", "mpd-mcp-codegraph", "launch.mjs"))
  return join(fb, "packages", "mpd-mcp-codegraph", "launch.mjs")
}

// precondition: the two launcher revisions really differ (the staged one is pre-fix)
const preFixedSrc = readFileSync(PRE_FIX_LAUNCHER, "utf8")
const fixedSrc = readFileSync(FIXED_LAUNCHER, "utf8")
check("pre-fix bytes are the stale staged package copy and carry NO degradation branch",
  !preFixedSrc.includes("unavailable fallback") && fixedSrc.includes("unavailable fallback") && preFixedSrc !== fixedSrc,
  `preFixBytes=${preFixedSrc.length} fixedBytes=${fixedSrc.length} preFixHasFallback=${preFixedSrc.includes("unavailable fallback")}`)

// HOME precondition: /root/.mpd must be genuinely unwritable (read-only fs).
const probeWrite = spawn("node", ["-e", `require("fs").mkdirSync("/root/.mpd/t6-fb8-probe",{recursive:true})`], { encoding: "utf8" })
const writeResult = await new Promise((res) => probeWrite.on("exit", (code) => res(code)))
check("HOME precondition: /root/.mpd is genuinely unwritable in this sandbox",
  writeResult !== 0, `mkdir attempt exit=${writeResult}`)

const preLauncher = stageVariant("pre-fix", PRE_FIX_LAUNCHER)
const pre = await mcpChild(preLauncher, { cwd: cwdOutside, env })
writeFileSync(join(here, "fb8-pre-fix.stdout.txt"), pre.stdout)
writeFileSync(join(here, "fb8-pre-fix.stderr.txt"), pre.stderr)
check("F-B8-1 RED: pre-fix launcher dies uncaught on an unresolvable binary + read-only $HOME/.mpd",
  pre.exit?.code !== 0 && /ENOENT/.test(pre.stderr) && /\.mpd[/\\]codegraph/.test(pre.stderr) && pre.stdoutBytes === 0,
  `exit=${JSON.stringify(pre.exit)} stdoutBytes=${pre.stdoutBytes} stderr=${pre.stderr.slice(0, 300)}`)
check("F-B8-1 RED: the crash is uncaught (stack escapes runCodegraphServe), no MCP answer",
  pre.init === null && /at /.test(pre.stderr), `init=${pre.init === null ? "null" : "answered"}`)

const fixedLauncher = stageVariant("fixed", FIXED_LAUNCHER)
const fixed = await mcpChild(fixedLauncher, { cwd: cwdOutside, env })
writeFileSync(join(here, "fb8-fixed.stdout.txt"), fixed.stdout)
writeFileSync(join(here, "fb8-fixed.stderr.txt"), fixed.stderr)
check("F-B8-1 GREEN: fixed launcher degrades — answers the MCP handshake with 0 tools, exit 0",
  fixed.exit?.code === 0 && fixed.init !== null && Array.isArray(fixed.tools) && fixed.tools.length === 0,
  `exit=${JSON.stringify(fixed.exit)} init=${fixed.init === null ? "null" : "answered"} tools=${JSON.stringify(fixed.tools)} stderr=${fixed.stderr.slice(0, 220)}`)
check("F-B8-1 GREEN: the degradation names the original error and the skip reason on stderr",
  /\[mpd-mcp-codegraph\] unavailable fallback:/.test(fixed.stderr) && /CodeGraph MCP skipped/.test(fixed.stderr),
  fixed.stderr.slice(0, 400))

const result = {
  task: "t6 own F-B8-1 harness",
  stamp: new Date().toISOString(),
  preFixLauncherSource: PRE_FIX_LAUNCHER,
  fixedLauncherSource: FIXED_LAUNCHER,
  homeUsed: "/root (read-only /root/.mpd)",
  scrubbedEnvKeys: SCRUB,
  preFix: { exit: pre.exit, stdoutBytes: pre.stdoutBytes, initAnswered: pre.init !== null, stderrHead: pre.stderr.slice(0, 500) },
  fixed: { exit: fixed.exit, stdoutBytes: fixed.stdoutBytes, initAnswered: fixed.init !== null, tools: fixed.tools, stderrHead: fixed.stderr.slice(0, 500) },
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "fb8-own.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — fb8-own.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
if (!existsSync(join(here, "fb8-own.result.json"))) rmSync(sandbox, { recursive: true, force: true })
process.exit(result.allPass ? 0 : 1)
