#!/usr/bin/env node
// t2 five-composition boot harness (author-run, ADVISORY — the QA lane re-measures).
//
// Builds isolated sandboxes (DSH_HOME + HOME + workspace cwd + profile, all inside
// this directory tree) and boots the REAL dsh against the repo bundle for each of
// the five compositions the t2 contract names:
//   1. web + bundle only            -> our row ENABLED, exactly one mount
//   2. web + aggregate (mpd LAST)   -> ours DISABLED, aggregate owns the sidebar
//   3. web + aggregate (mpd FIRST)  -> ours DISABLED, aggregate owns the sidebar
//   4. dsh-tui                      -> ours DISABLED (no web plane), boot green
//   5. web, package not resolvable  -> ours DISABLED, boot green (degraded)
//
// Every run writes boot.log + result.json; the boot log is the only load proof
// (`--dump-config` composes rows and never executes plugin code, AGENTS.md §4).
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const SANDBOX_ROOT = join(HERE, "..", "sandbox")
const OUT_ROOT = process.env.OUT_ROOT ?? join(HERE, "..", "w1-five-compositions", new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"))
const AGGREGATE = "/root/.dsh/profiles/web/node_modules/@linxin666/dsh-web-all"
const TUI_PKG = "/root/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui"
const REAL_HOME = "/root/.dsh"

const PROBE_EXPR = "(() => { const E = [...ctx.loader.entries()]; const rows = E.filter((e) => e.options.name === 'dsh-better-sidebar').map((e) => String(e.options.id) + '|' + (e.options.disabled === true ? 'literal-disabled' : (typeof e.options.disabled === 'object' ? 'js-guarded' : 'raw-enabled')) + '|fiber=' + Boolean(e.fiber)); console.warn('SIDEBAR-PROBE ' + JSON.stringify({ total: E.length, rows: rows, web_entry: E.some((e) => e.options.name === '@deepseek-ai/dsh-host-webserver' && e.options.disabled !== true) })); return true })()"

const FATAL = ["duplicate prefix route", "plugin(s) failed to load", "did not activate", "pending (waiting for service", "failed to apply loader entry"]

function sha256(path) {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex") } catch { return null }
}
function sha256FileOrNull(p) { return existsSync(p) ? sha256(p) : null }
function nowUtc() { return new Date().toISOString() }

function writeProbePatch(sb) {
  const p = join(sb, "probe.yml")
  writeFileSync(p, [
    "- insert:",
    "    - id: mpd-composition-probe",
    "      name: '" + join(REPO, "packages/mpd-config-plugin/dist/index.js") + "'",
    '      disabled: !!js "' + PROBE_EXPR + '"',
    "",
  ].join("\n"))
  return p
}

/**
 * Build one isolated sandbox. `bundleDir` defaults to the repo; composition 5
 * passes a shadow directory whose manifest carries NO runtime dependency, which is
 * exactly the "declared row, package never materialized" state the guard must
 * survive.
 */
function buildSandbox(name, { profile, bundles, bundleDir = REPO, extraPackages = [] }) {
  const sb = join(SANDBOX_ROOT, name)
  rmSync(sb, { recursive: true, force: true })
  const pdir = join(sb, "dsh", "profiles", profile)
  mkdirSync(join(pdir, "node_modules"), { recursive: true })
  mkdirSync(join(sb, "home", ".dsh"), { recursive: true })
  mkdirSync(join(sb, "ws"), { recursive: true })
  for (const f of ["settings.yaml", ".credentials.yaml"]) {
    const src = join(REAL_HOME, f)
    if (existsSync(src)) { copyFileSync(src, join(sb, "home", ".dsh", f)); copyFileSync(src, join(sb, "dsh", f)) }
  }
  if (existsSync(join(REAL_HOME, "llm-deepseek"))) spawnSync("cp", ["-a", join(REAL_HOME, "llm-deepseek"), join(sb, "home", ".dsh", "llm-deepseek")])
  const manifest = {
    name: "dsh-profile-" + profile,
    private: true,
    dependencies: { "@mpd-dsh/mpd": "link:" + bundleDir },
    dsh: { profile: { bundles, patchReload: "live" } },
  }
  writeFileSync(join(pdir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  mkdirSync(join(pdir, "node_modules", "@mpd-dsh"), { recursive: true })
  symlinkSync(bundleDir, join(pdir, "node_modules", "@mpd-dsh", "mpd"), "dir")
  for (const pkg of extraPackages) {
    const target = join(pdir, "node_modules", pkg.name)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(pkg.dir, target, "dir")
    manifest.dependencies[pkg.name] = pkg.version
  }
  writeFileSync(join(pdir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  return { sb, pdir, profile }
}

function scanLog(text) {
  const guard = [...text.matchAll(/\[mpd-better-sidebar\] mount guard: (ENABLED|DISABLED) - ([^\n]*)/g)].map((m) => ({ decision: m[1], reason: m[2].trim() }))
  const probes = [...text.matchAll(/SIDEBAR-PROBE (\{.*?\})\n/g)].map((m) => { try { return JSON.parse(m[1]) } catch { return { parseError: m[1] } } })
  const fatal = FATAL.filter((s) => text.includes(s))
  return { guard, probes, fatal, ready: /dsh web: http:\/\/127\.0\.0\.1:\d+\//.test(text) }
}

async function bootWeb({ sb, profile, port }) {
  const logPath = join(sb, "boot.log")
  const fd = openSync(logPath, "w")
  const probePatch = writeProbePatch(sb)
  const args = ["--profile", profile]
  if (probePatch !== undefined) args.push("--patch", probePatch)
  args.push("--port", String(port), "--no-open")
  const child = spawn("dsh", args, {
    cwd: join(sb, "ws"),
    env: { ...process.env, DSH_HOME: join(sb, "dsh"), HOME: join(sb, "home") },
    stdio: ["ignore", fd, fd],
    detached: true,
  })
  let exited = null
  child.on("exit", (code, signal) => { exited = { code, signal } })
  const deadline = Date.now() + 150_000
  let text = ""
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    text = readFileSync(logPath, "utf8")
    if (exited !== null) break
    if (/dsh web: http:\/\/127\.0\.0\.1:\d+\//.test(text)) break
  }
  const http = { attempted: false, probes: [] }
  const tokenMatch = text.match(/dsh web: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/)
  if (tokenMatch) {
    http.attempted = true
    const [, portStr, token] = tokenMatch
    const origin = "http://127.0.0.1:" + portStr
    try {
      // The token URL answers 303 and plants the session cookie; the index then
      // needs that cookie. Both hops are recorded, never assumed.
      const tokenRes = await fetch(origin + "/?token=" + token, { redirect: "manual" })
      const setCookie = tokenRes.headers.get("set-cookie") ?? ""
      http.token = { status: tokenRes.status, location: tokenRes.headers.get("location"), setCookieBytes: setCookie.length }
      const cookie = setCookie.split(";")[0]
      const indexRes = await fetch(origin + "/", { headers: { cookie } })
      const html = await indexRes.text()
      http.index = { status: indexRes.status, bytes: html.length, cookie }
      const sidebarRefs = [...new Set([...html.matchAll(/[^\s"'\\]*better-sidebar\/client\.js[^\s"'\\]*/g)].map((m) => m[0]))]
      http.clientCompositeHasSidebar = sidebarRefs.some((r) => r.includes("??") && r.includes(","))
      http.clientStandalone = sidebarRefs.filter((r) => r.includes("??") && !r.includes(","))
      for (const ref of http.clientStandalone) {
        const url = ref.startsWith("http") ? ref : origin + "/" + ref.replace(/^\/+/, "").replace(/&amp;/g, "&")
        const res = await fetch(url, { headers: { cookie } })
        const body = await res.text()
        http.probes.push({ url, status: res.status, bytes: body.length, looksLikeModule: /export|function|=>/.test(body) })
      }
      // Positive mount signal: the plugin's own /sidebar/api route answers with its
      // JSON method-error (405) — a route that does not exist answers 404.
      const apiRes = await fetch(origin + "/sidebar/api", { headers: { cookie } })
      const apiBody = await apiRes.text()
      http.sidebarApi = { status: apiRes.status, body: apiBody.slice(0, 120) }
    } catch (error) {
      http.error = String(error && error.message ? error.message : error)
    }
  } else {
    http.error = "no ready line (boot exited: " + JSON.stringify(exited) + ")"
  }
  try { process.kill(-child.pid, "SIGTERM") } catch { try { child.kill("SIGTERM") } catch {} }
  await new Promise((r) => setTimeout(r, 3000))
  try { process.kill(-child.pid, "SIGKILL") } catch {}
  await new Promise((r) => setTimeout(r, 500))
  const finalText = readFileSync(logPath, "utf8")
  return { logPath, exit: exited, http, scan: scanLog(finalText) }
}

function bootTui({ sb, profile }) {
  const socket = join(sb, "tmux.sock")
  const logPath = join(sb, "boot.log")
  const tmux = (args) => spawnSync("tmux", ["-S", socket, ...args], { encoding: "utf8", timeout: 30_000 })
  tmux(["kill-server"])
  const created = tmux(["-f", "/dev/null", "new-session", "-d", "-s", "tui", "-x", "220", "-y", "50", "-c", join(sb, "ws")])
  if (created.status !== 0) return { logPath, tmuxError: created.stderr }
  tmux(["pipe-pane", "-t", "tui", "-o", "cat > '" + logPath + "'"])
  const cmd = "cd " + join(sb, "ws") + " && DSH_HOME=" + join(sb, "dsh") + " HOME=" + join(sb, "home") + " dsh --profile " + profile
  tmux(["send-keys", "-t", "tui", cmd, "Enter"])
  spawnSync("sleep", ["70"])
  const pane = tmux(["capture-pane", "-p", "-J", "-t", "tui"])
  tmux(["kill-server"])
  const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
  return { logPath, pane: pane.stdout ?? "", scan: scanLog(text), paneChars: (pane.stdout ?? "").trim().length }
}

function shadowBundleWithoutDependency(sb) {
  const shadow = join(sb, "shadow-mpd")
  mkdirSync(shadow, { recursive: true })
  const root = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"))
  root.dependencies = {}
  writeFileSync(join(shadow, "package.json"), JSON.stringify(root, null, 2) + "\n")
  for (const sub of ["packages", "presets", "skills", "extensions", "templates", "docs", "agent-references", "scripts"]) {
    if (existsSync(join(REPO, sub))) symlinkSync(join(REPO, sub), join(shadow, sub), "dir")
  }
  return shadow
}

const COMPOSITIONS = {
  comp1_web_bundle_only: () => ({
    run: async () => {
      const s = buildSandbox("comp1", { profile: "web", bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] })
      const out = await bootWeb({ ...s, port: 3401 })
      return { expectation: "guard ENABLED; exactly one sidebar mount (ours); client half served", ...out }
    },
  }),
  comp2_web_aggregate_after: () => ({
    run: async () => {
      const s = buildSandbox("comp2", {
        profile: "web",
        bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd", "@linxin666/dsh-web-all"],
        extraPackages: [{ name: "@linxin666/dsh-web-all", dir: AGGREGATE, version: "0.3.20" }],
      })
      const out = await bootWeb({ ...s, port: 3402 })
      return { expectation: "guard DISABLED (another layer's patch mounts it); aggregate owns the single mount", ...out }
    },
  }),
  comp3_web_aggregate_before: () => ({
    run: async () => {
      const s = buildSandbox("comp3", {
        profile: "web",
        bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@linxin666/dsh-web-all", "@mpd-dsh/mpd"],
        extraPackages: [{ name: "@linxin666/dsh-web-all", dir: AGGREGATE, version: "0.3.20" }],
      })
      const out = await bootWeb({ ...s, port: 3403 })
      return { expectation: "guard DISABLED even though the aggregate layer precedes ours; single mount", ...out }
    },
  }),
  comp4_tui: () => ({
    run: async () => {
      const s = buildSandbox("comp4", {
        profile: "dsh-tui",
        bundles: ["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"],
        extraPackages: [{ name: "@deepseek-harness-tui/dsh-tui", dir: TUI_PKG, version: "0.10.1" }],
      })
      const out = bootTui({ ...s, profile: "dsh-tui" })
      return { expectation: "guard DISABLED (no web plane); zero pending/failed entries", ...out }
    },
  }),
  comp6_packed_artifact: () => ({
    run: async () => {
      const packed = join(REPO, "dist", "mpd-package")
      const s = buildSandbox("comp6", { profile: "web", bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], bundleDir: packed })
      const out = await bootWeb({ ...s, port: 3406 })
      return { expectation: "the PACKED artifact ships the same guarded row + the runtime dependencies arm", packedManifest: join(packed, "package.json"), ...out }
    },
  }),
  comp5_web_package_absent: () => ({
    run: async () => {
      const sbName = "comp5"
      const s = buildSandbox(sbName, { profile: "web", bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], bundleDir: join(SANDBOX_ROOT, sbName, "shadow-mpd") })
      // build the shadow AFTER the sandbox dir exists (it lives inside it)
      const shadow = shadowBundleWithoutDependency(s.sb)
      rmSync(join(s.sb, "dsh", "profiles", "web", "node_modules", "@mpd-dsh", "mpd"), { force: true })
      symlinkSync(shadow, join(s.sb, "dsh", "profiles", "web", "node_modules", "@mpd-dsh", "mpd"), "dir")
      const out = await bootWeb({ ...s, port: 3405 })
      return { expectation: "guard DISABLED (package not resolvable); boot green, degraded", shadowManifest: join(shadow, "package.json"), ...out }
    },
  }),
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  mkdirSync(OUT_ROOT, { recursive: true })
  let prior = {}
  const ledgerPath = join(OUT_ROOT, "ledger.json")
  if (existsSync(ledgerPath)) { try { prior = JSON.parse(readFileSync(ledgerPath, "utf8")).compositions ?? {} } catch { prior = {} } }
  const ledger = { at_utc: nowUtc(), repo: REPO, kind: "author-run boots (ADVISORY; the QA lane re-measures)", source_hashes: {}, compositions: {} }
  for (const rel of ["package.json", "packages/mpd-bundle/cordis.patch.yml", "scripts/pack-mpd.mjs", "scripts/install-profile.mjs", "bun.lock"]) {
    ledger.source_hashes[rel] = { sha256: sha256FileOrNull(join(REPO, rel)), read_at_utc: nowUtc() }
  }
  for (const [name, factory] of Object.entries(COMPOSITIONS)) {
    if (only.length && !only.includes(name)) continue
    console.log("=== " + name + " ===")
    const outDir = join(OUT_ROOT, name)
    mkdirSync(outDir, { recursive: true })
    let payload
    try {
      const { run } = factory()
      payload = await run()
    } catch (error) {
      payload = { error: String(error && error.stack ? error.stack : error) }
    }
    const result = { case: "install-deps/implementation/" + name, measured_at_utc: nowUtc(), author_run_advisory: true, ...payload }
    if (result.logPath) {
      const logText = readFileSync(result.logPath, "utf8")
      writeFileSync(join(outDir, "boot.log"), logText)
      writeFileSync(join(outDir, "boot.log.sha256"), sha256(result.logPath) + "  boot.log\n")
      result.log_sha256 = sha256(result.logPath)
      result.log_read_at_utc = nowUtc()
      if (result.pane) writeFileSync(join(outDir, "boot.pane.txt"), result.pane)
      delete result.logPath
    }
    if (result.scan) {
      result.verdict = {
        fatal_signatures: result.scan.fatal,
        guard_decisions: [...new Set(result.scan.guard.map((g) => g.decision + " - " + g.reason))],
        sidebar_rows_in_entry_list: result.scan.probes.at(-1)?.rows ?? [],
      }
    }
    writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
    console.log(JSON.stringify({ name, guard: result.scan?.guard, fatal: result.scan?.fatal, probes: result.scan?.probes, http: result.http, exit: result.exit, paneChars: result.paneChars }))
    ledger.compositions[name] = { result: join(outDir, "result.json"), expectation: result.expectation, log_sha256: result.log_sha256 }
  }
  ledger.compositions = { ...prior, ...ledger.compositions }
  writeFileSync(join(OUT_ROOT, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n")
  console.log("evidence -> " + OUT_ROOT)
}

await main()
