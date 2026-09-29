#!/usr/bin/env node
// t9 (Reviewer) OWN B8 gate — written for this verification task.
//
// Honest B8 verdict route (captain's correction): do NOT source it from a
// devPatch() boot with the CLI pins unset (that rewrites the MCP row args into
// <baseUrl>/node_modules/<abs-repo-path>, a QA-harness defect). Instead drive the
// SHIPPED launchers as real MCP stdio servers with every pin scrubbed, from a cwd
// OUTSIDE the bundle, in both install layouts, plus the resolver-ordering proof
// and the negative controls.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawn, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const FIXTURE = join(repoRoot, "tests", "mcp-fixtures", "sample.c")
const SCRUB = ["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_DSH_ASTGREP_CLI", "MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_CLI"]

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 800) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}

// Minimal MCP stdio client: newline-delimited JSON-RPC.
function mcp(script, { cwd, env, calls = [], timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    let out = "", err = "", settled = false
    const finish = (result) => { if (settled) return; settled = true; try { child.kill("SIGKILL") } catch {} resolve(result) }
    const timer = setTimeout(() => finish({ timeout: true, stdout: out, stderr: err, responses: [] }), timeoutMs)
    const pending = new Map()
    const write = (obj) => child.stdin.write(JSON.stringify(obj) + "\n")
    const onLine = (line) => {
      let msg
      try { msg = JSON.parse(line) } catch { return }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    }
    let buf = ""
    child.stdout.on("data", (d) => {
      out += d
      buf += d
      let i
      while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l) }
    })
    child.stderr.on("data", (d) => { err += d })
    child.on("error", (e) => { err += String(e) })
    child.on("exit", () => { /* responses already delivered */ })

    const request = (id, method, params) => new Promise((res) => { pending.set(id, res); write({ jsonrpc: "2.0", id, method, params }) })

    ;(async () => {
      try {
        const init = await request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t9-reviewer", version: "1.0" } })
        write({ jsonrpc: "2.0", method: "notifications/initialized" })
        const tools = await request(2, "tools/list", {})
        const results = []
        let id = 10
        for (const c of calls) {
          const r = await request(id++, "tools/call", { name: c.name, arguments: c.args })
          results.push(r)
        }
        clearTimeout(timer)
        finish({ init, tools: (tools?.result?.tools ?? []).map((t) => t.name), results, stdout: out, stderr: err })
      } catch (e) {
        clearTimeout(timer)
        finish({ error: String(e), stdout: out, stderr: err, results: [] })
      }
    })()
  })
}

const textOf = (r) => (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n")

const sandbox = mkdtempSync(join(tmpdir(), "t9-b8-"))
const cwdOutside = join(sandbox, "cwd-outside-bundle")
mkdirSync(cwdOutside, { recursive: true })
const cleanEnv = { ...process.env, HOME: join(sandbox, "home") }
mkdirSync(cleanEnv.HOME, { recursive: true })
for (const k of SCRUB) delete cleanEnv[k]

// ---------------------------------------------------------------- checkout ---
const astLaunch = join(repoRoot, "packages", "mpd-mcp-astgrep", "launch.mjs")
const cgLaunch = join(repoRoot, "packages", "mpd-mcp-codegraph", "launch.mjs")

const ok = await mcp(astLaunch, {
  cwd: cwdOutside, env: cleanEnv,
  calls: [{ name: "search", args: { pattern: "return 0", language: "c", paths: [FIXTURE] } }],
})
check("checkout: ast-grep launcher starts as a real MCP server from a cwd outside the bundle (no env pins)",
  !ok.timeout && (ok.tools ?? []).includes("search"), `tools=${JSON.stringify(ok.tools)} timeout=${ok.timeout} stderr=${String(ok.stderr).slice(0, 200)}`)
check("checkout: real ast-grep MCP search returns a real match (not BINARY_NOT_FOUND)",
  /"totalMatches":1/.test(textOf(ok.results?.[0])) && !/BINARY_NOT_FOUND/.test(textOf(ok.results?.[0])),
  String(textOf(ok.results?.[0])).slice(0, 260))
writeFileSync(join(here, "b8-checkout-astgrep.log"), JSON.stringify(ok, null, 2))

const negPin = await mcp(astLaunch, {
  cwd: cwdOutside, env: { ...cleanEnv, MPD_AST_GREP_SG_PATH: "/nonexistent/sg" },
  calls: [{ name: "search", args: { pattern: "return 0", language: "c", paths: [FIXTURE] } }],
})
const negText = textOf(negPin.results?.[0])
check("checkout negative control: MPD_AST_GREP_SG_PATH=/nonexistent/sg -> BINARY_NOT_FOUND",
  /BINARY_NOT_FOUND/.test(negText) && negPin.results?.[0]?.result?.isError === true, negText.slice(0, 260))
writeFileSync(join(here, "b8-checkout-astgrep-negative.log"), JSON.stringify(negPin, null, 2))

const cg = await mcp(cgLaunch, { cwd: cwdOutside, env: cleanEnv, calls: [{ name: "codegraph_explore", args: { query: "norm" } }] })
check("checkout: codegraph launcher serves the real tool surface (no 'skipped' stub)",
  (cg.tools ?? []).includes("codegraph_explore") && !/skipped/.test(String(cg.stderr)),
  `tools=${JSON.stringify(cg.tools)} stderr=${String(cg.stderr).slice(0, 220)}`)
check("checkout: real codegraph_explore call answers with content",
  /symbol|Exploration|found/i.test(textOf(cg.results?.[0])), String(textOf(cg.results?.[0])).slice(0, 220))
writeFileSync(join(here, "b8-checkout-codegraph.log"), JSON.stringify(cg, null, 2))

const cgNeg = await mcp(cgLaunch, { cwd: cwdOutside, env: { ...cleanEnv, MPD_CODEGRAPH_BIN: "/nonexistent/codegraph" }, calls: [] })
check("checkout negative control: MPD_CODEGRAPH_BIN=/nonexistent/codegraph -> unavailable, never a live tool surface",
  (cgNeg.tools ?? []).length === 0 && /skipped|unavailable|not found/i.test(String(cgNeg.stderr)),
  `tools=${JSON.stringify(cgNeg.tools)} stderr=${String(cgNeg.stderr).slice(0, 220)}`)
writeFileSync(join(here, "b8-checkout-codegraph-negative.log"), JSON.stringify(cgNeg, null, 2))

// -------------------------------------------------------------- resolution ---
const sgProbe = spawnSync(join(repoRoot, ".toolchain", "node_modules", ".bin", "sg"), ["--version"], { encoding: "utf8" })
const astProbe = spawnSync(join(repoRoot, ".toolchain", "node_modules", ".bin", "ast-grep"), ["--version"], { encoding: "utf8" })
check("resolver: the .toolchain `sg` wrapper is REJECTED by --version (deprecated, exit != 0)",
  sgProbe.status !== 0, `exit=${sgProbe.status} stdout=${JSON.stringify((sgProbe.stdout ?? "").slice(0, 120))} stderr=${JSON.stringify((sgProbe.stderr ?? "").slice(0, 160))}`)
check("resolver: the .toolchain `ast-grep` passes --version",
  astProbe.status === 0 && /ast-grep/.test(astProbe.stdout ?? ""), `exit=${astProbe.status} stdout=${JSON.stringify((astProbe.stdout ?? "").trim().slice(0, 120))}`)

const resolveDump = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { resolveAstGrepBinary, resolveCodegraphBinary } from ${JSON.stringify("file://" + join(repoRoot, "packages", "mpd-mcp-shared", "bin-resolve.mjs"))}
const a = resolveAstGrepBinary(${JSON.stringify("file://" + astLaunch)})
const c = resolveCodegraphBinary(${JSON.stringify("file://" + cgLaunch)})
console.log(JSON.stringify({ astGrep: a, codegraph: c }))
`], { encoding: "utf8", cwd: cwdOutside, env: cleanEnv })
const resolved = JSON.parse((resolveDump.stdout ?? "{}").trim() || "{}")
check("resolver: checkout layout picks the .toolchain `ast-grep` binary (never the sg wrapper)",
  resolved.astGrep?.source === "toolchain" && /[\\/]ast-grep$/.test(resolved.astGrep?.binary ?? ""), JSON.stringify(resolved.astGrep))
check("resolver: checkout layout picks the .toolchain codegraph binary",
  resolved.codegraph?.source === "toolchain" && /[\\/]codegraph$/.test(resolved.codegraph?.binary ?? ""), JSON.stringify(resolved.codegraph))

// synthetic ordering proof: a bin-dir holding BOTH a valid ast-grep and the
// invalid sg wrapper must yield ast-grep; a bin-dir holding ONLY the invalid sg
// wrapper must NOT be accepted (probe rejects it) -> falls through to toolchain.
const synth = join(sandbox, "bin-dir")
mkdirSync(synth, { recursive: true })
writeFileSync(join(synth, "ast-grep"), "#!/bin/sh\necho 'ast-grep 9.9.9 (t9 stub)'\n", { mode: 0o755 })
writeFileSync(join(synth, "sg"), "#!/bin/sh\necho 'WARNING: sg is deprecated. Use ast-grep instead.'\nexit 1\n", { mode: 0o755 })
const onlySg = join(sandbox, "bin-dir-only-sg")
mkdirSync(onlySg, { recursive: true })
writeFileSync(join(onlySg, "sg"), "#!/bin/sh\necho 'WARNING: sg is deprecated. Use ast-grep instead.'\nexit 1\n", { mode: 0o755 })
const ordering = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { resolveAstGrepBinary } from ${JSON.stringify("file://" + join(repoRoot, "packages", "mpd-mcp-shared", "bin-resolve.mjs"))}
const launcher = ${JSON.stringify("file://" + astLaunch)}
const both = resolveAstGrepBinary(launcher, { env: { MPD_AST_GREP_BIN_DIR: ${JSON.stringify(synth)} } })
const only = resolveAstGrepBinary(launcher, { env: { MPD_AST_GREP_BIN_DIR: ${JSON.stringify(onlySg)} } })
console.log(JSON.stringify({ both, only }))
`], { encoding: "utf8", cwd: cwdOutside, env: cleanEnv })
const ord = JSON.parse((ordering.stdout ?? "{}").trim() || "{}")
check("ordering: with both candidates present the resolver picks ast-grep over sg",
  /ast-grep$/.test(ord.both?.binary ?? "") && ord.both?.source === "bin-dir", JSON.stringify(ord.both))
check("ordering: a bin-dir holding ONLY the deprecated sg wrapper is rejected by the probe (no sg is ever returned)",
  ord.only?.binary !== undefined ? !/[\\/]sg$/.test(ord.only.binary) : true, JSON.stringify(ord.only))

const unit = spawnSync("bun", ["test", join(repoRoot, "packages", "mpd-mcp-shared", "bin-resolve.test.mjs")], { encoding: "utf8", cwd: repoRoot, timeout: 300_000 })
const unitOut = (unit.stdout ?? "") + (unit.stderr ?? "")
check("resolver unit suite passes",
  unit.status === 0 && /\b0 fail\b/.test(unitOut), (unitOut.trim().split("\n").slice(-4).join(" | ")).slice(0, 240))
writeFileSync(join(here, "b8-resolver-ordering.log"), JSON.stringify({ unitOut: unitOut.trim().split("\n").slice(-4), sgProbe: { status: sgProbe.status, stdout: sgProbe.stdout, stderr: sgProbe.stderr }, astProbe: { status: astProbe.status, stdout: astProbe.stdout }, resolved, ord, unitTail: (unit.stdout ?? "").trim().split("\n").slice(-5) }, null, 2))

// ----------------------------------------------------------------- packed ---
// Real packed layout: npm pack the staged bundle and install the TARBALL (a
// file:<dir> dependency is symlinked and installs no optionalDependencies).
let packed = { skipped: true }
try {
  const staged = join(repoRoot, "dist", "mpd-package")
  const profileDir = join(sandbox, "packed-profile")
  const packDir = join(sandbox, "pack")
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(packDir, { recursive: true })
  const npmEnv = { ...process.env, npm_config_cache: join(sandbox, "npm-cache"), npm_config_logs_dir: join(sandbox, "npm-logs") }
  const p = spawnSync("npm", ["pack", "--pack-destination", packDir], { cwd: staged, env: npmEnv, encoding: "utf8", timeout: 600_000 })
  const tgz = p.status === 0 ? (readdirSync(packDir).find((f) => f.endsWith(".tgz")) ?? null) : null
  check("packed: npm pack of the staged bundle succeeds", Boolean(tgz), `exit=${p.status} tgz=${tgz} ${(p.stderr ?? "").slice(0, 200)}`)
  if (tgz) {
    writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "t9-b8-packed", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + join(packDir, tgz) } }, null, 2) + "\n")
    const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund"], { env: npmEnv, encoding: "utf8", timeout: 900_000, maxBuffer: 32 * 1024 * 1024 })
    check("packed: tarball install succeeds", inst.status === 0, `exit=${inst.status} ${((inst.stderr ?? "") + (inst.stdout ?? "")).slice(0, 300)}`)
    const installed = join(profileDir, "node_modules", "@mpd-dsh", "mpd")
    const pAst = join(installed, "packages", "mpd-mcp-astgrep", "launch.mjs")
    const pCg = join(installed, "packages", "mpd-mcp-codegraph", "launch.mjs")
    check("packed: installed tree ships both launchers", existsSync(pAst) && existsSync(pCg), `${pAst}=${existsSync(pAst)} ${pCg}=${existsSync(pCg)}`)
    if (existsSync(pAst)) {
      const pk = await mcp(pAst, { cwd: cwdOutside, env: cleanEnv, calls: [{ name: "search", args: { pattern: "return 0", language: "c", paths: [FIXTURE] } }] })
      check("packed: real ast-grep MCP search through the INSTALLED launcher returns a real match",
        /"totalMatches":1/.test(textOf(pk.results?.[0])), String(textOf(pk.results?.[0])).slice(0, 240))
      const pkNeg = await mcp(pAst, { cwd: cwdOutside, env: { ...cleanEnv, MPD_AST_GREP_SG_PATH: "/nonexistent/sg" }, calls: [{ name: "search", args: { pattern: "return 0", language: "c", paths: [FIXTURE] } }] })
      check("packed negative control: wrong caller pin -> BINARY_NOT_FOUND",
        /BINARY_NOT_FOUND/.test(textOf(pkNeg.results?.[0])), String(textOf(pkNeg.results?.[0])).slice(0, 200))
      const pcg = await mcp(pCg, { cwd: cwdOutside, env: cleanEnv, calls: [{ name: "codegraph_explore", args: { query: "norm" } }] })
      check("packed: real codegraph call through the INSTALLED launcher answers",
        (pcg.tools ?? []).includes("codegraph_explore"), `tools=${JSON.stringify(pcg.tools)} stderr=${String(pcg.stderr).slice(0, 160)}`)
      const tier = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { resolveAstGrepBinary, resolveCodegraphBinary } from ${JSON.stringify("file://" + join(installed, "packages", "mpd-mcp-shared", "bin-resolve.mjs"))}
console.log(JSON.stringify({ a: resolveAstGrepBinary(${JSON.stringify("file://" + pAst)}), c: resolveCodegraphBinary(${JSON.stringify("file://" + pCg)}) }))
`], { encoding: "utf8", cwd: cwdOutside, env: cleanEnv })
      const tr = JSON.parse((tier.stdout ?? "{}").trim() || "{}")
      check("packed: resolution arrives via createRequire (packed optionalDependency), not the checkout toolchain",
        tr.a?.source === "require" && /@ast-grep[\\/]cli/.test(tr.a?.binary ?? "") && tr.c?.source === "require",
        JSON.stringify(tr))
      packed = { skipped: false, tgz, tier: tr }
    }
  }
} catch (e) {
  check("packed gate crashed", false, String(e))
  packed = { skipped: false, error: String(e) }
}

const result = {
  task: "t9 own B8 gate (checkout + resolver ordering + packed)",
  stamp: new Date().toISOString(),
  scrubbedEnvKeys: SCRUB,
  cwdOutsideBundle: cwdOutside,
  fixture: FIXTURE,
  layout: { checkout: astLaunch, packedTgz: packed.tgz ?? null },
  packed,
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "b8-own-gate.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — b8-own-gate.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
rmSync(sandbox, { recursive: true, force: true })
process.exit(result.allPass ? 0 : 1)
