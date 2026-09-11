#!/usr/bin/env node
// t6 (Reviewer) OWN B8 gate — independent of the wave-2 evidence copy.
// Drives the SHIPPED launchers as real MCP stdio servers, pin-scrubbed, from a
// cwd OUTSIDE the bundle, and records raw stdout/stderr/exit.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { spawn, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const FIXTURE = join(repoRoot, "tests", "mcp-fixtures", "sample.c")
const SCRUB = ["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_DSH_ASTGREP_CLI", "MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_CLI", "MPD_CODEGRAPH_PROJECT_CWD", "MPD_DSH_CODEGRAPH_PROJECT_CWD"]

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 900) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 200)}`)
}

function mcp(script, { cwd, env, calls = [], timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    let out = "", err = "", settled = false, stdoutBytes = 0
    const finish = (r) => { if (settled) return; settled = true; try { child.kill("SIGKILL") } catch {} resolve({ stdoutBytes, ...r }) }
    const timer = setTimeout(() => finish({ timeout: true, stdout: out, stderr: err, responses: [] }), timeoutMs)
    const pending = new Map()
    let buf = ""
    const onLine = (line) => {
      let msg
      try { msg = JSON.parse(line) } catch { return }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    child.stdout.on("data", (d) => { stdoutBytes += d.length; out += d; buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l) } })
    child.stderr.on("data", (d) => { err += d })
    child.on("error", (e) => { err += String(e) })
    const request = (id, method, params) => new Promise((res) => { pending.set(id, res); try { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n") } catch (e) { res({ error: String(e) }) } })
    ;(async () => {
      try {
        const init = await request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t6-reviewer", version: "1.0" } })
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
        const tools = await request(2, "tools/list", {})
        const results = []
        let id = 10
        for (const c of calls) results.push(await request(id++, "tools/call", { name: c.name, arguments: c.args }))
        clearTimeout(timer)
        finish({ init, tools: (tools?.result?.tools ?? []).map((t) => t.name), results, stdout: out, stderr: err, exit: child.exitCode })
      } catch (e) {
        clearTimeout(timer)
        finish({ error: String(e), stdout: out, stderr: err, results: [], tools: [] })
      }
    })()
  })
}
const textOf = (r) => (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n")

const sandbox = mkdtempSync(join(tmpdir(), "t6-b8-"))
const cwdOutside = join(sandbox, "cwd-outside-bundle")
mkdirSync(cwdOutside, { recursive: true })
const cleanEnv = { ...process.env, HOME: join(sandbox, "home") }
mkdirSync(cleanEnv.HOME, { recursive: true })
for (const k of SCRUB) delete cleanEnv[k]

const astLaunch = join(repoRoot, "packages", "mpd-mcp-astgrep", "launch.mjs")
const cgLaunch = join(repoRoot, "packages", "mpd-mcp-codegraph", "launch.mjs")

// 1. ast-grep launcher, pins scrubbed, cwd outside the bundle.
const ok = await mcp(astLaunch, { cwd: cwdOutside, env: cleanEnv, calls: [{ name: "search", args: { pattern: "return 0", language: "c", paths: [FIXTURE] } }] })
check("ast-grep launcher answers as a real MCP stdio server (no pins, cwd outside the bundle)",
  !ok.timeout && (ok.tools ?? []).includes("search"), `tools=${JSON.stringify(ok.tools)} timeout=${ok.timeout} stderr=${String(ok.stderr).slice(0, 200)}`)
check("ast-grep real search returns a real match (not BINARY_NOT_FOUND)",
  /"totalMatches":1/.test(textOf(ok.results?.[0])) && !/BINARY_NOT_FOUND/.test(textOf(ok.results?.[0])),
  String(textOf(ok.results?.[0])).slice(0, 300))
writeFileSync(join(here, "b8-astgrep.checkout.log"), JSON.stringify(ok, null, 2))

// 2. negative control: a caller pin wins untouched and must fail loudly.
const neg = await mcp(astLaunch, { cwd: cwdOutside, env: { ...cleanEnv, MPD_AST_GREP_SG_PATH: "/nonexistent/sg" }, calls: [{ name: "search", args: { pattern: "return 0", language: "c", paths: [FIXTURE] } }] })
check("negative control: wrong caller pin -> BINARY_NOT_FOUND (the launcher did not override it)",
  /BINARY_NOT_FOUND/.test(textOf(neg.results?.[0])), String(textOf(neg.results?.[0])).slice(0, 200))
writeFileSync(join(here, "b8-astgrep.necontrol.log"), JSON.stringify(neg, null, 2))

// 3. resolution tier + the deprecated wrapper rejection, from the real resolver.
const tier = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { resolveAstGrepBinary, probeAstGrep } from ${JSON.stringify("file://" + join(repoRoot, "packages", "mpd-mcp-shared", "bin-resolve.mjs"))}
const r = resolveAstGrepBinary(${JSON.stringify("file://" + astLaunch)})
console.log(JSON.stringify({ resolved: r, sgWrapperProbe: probeAstGrep(${JSON.stringify(join(repoRoot, ".toolchain", "node_modules", ".bin", "sg"))}) }))
`], { cwd: cwdOutside, env: cleanEnv, encoding: "utf8" })
const tierObj = JSON.parse(String(tier.stdout ?? "{}").trim() || "{}")
check("checkout resolution arrives via the toolchain tier (not a pinned env key)",
  tierObj?.resolved?.source === "toolchain" && /ast-grep$/.test(tierObj?.resolved?.binary ?? ""), JSON.stringify(tierObj))
check("the deprecated `.bin/sg` wrapper is rejected by the resolver's own probe",
  tierObj?.sgWrapperProbe === false, JSON.stringify(tierObj))
writeFileSync(join(here, "b8-resolver-ordering.log"), JSON.stringify(tierObj, null, 2))

// 4. codegraph launcher with a resolvable binary answers the MCP handshake.
const cg = await mcp(cgLaunch, { cwd: cwdOutside, env: { ...cleanEnv, HOME: join(sandbox, "home") }, calls: [] , timeoutMs: 90_000 })
check("codegraph launcher answers the MCP handshake with a resolvable binary",
  !cg.timeout && (cg.tools ?? []).length >= 1, `tools=${JSON.stringify(cg.tools)} timeout=${cg.timeout} stderr=${String(cg.stderr).slice(0, 200)}`)
writeFileSync(join(here, "b8-codegraph.checkout.log"), JSON.stringify(cg, null, 2))

const result = {
  task: "t6 own B8 gate (checkout, pins scrubbed, cwd outside the bundle)",
  stamp: new Date().toISOString(),
  scrubbedEnvKeys: SCRUB,
  cwdOutsideBundle: cwdOutside,
  fixture: FIXTURE,
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "b8-own-gate.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — b8-own-gate.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
rmSync(sandbox, { recursive: true, force: true })
process.exit(result.allPass ? 0 : 1)
