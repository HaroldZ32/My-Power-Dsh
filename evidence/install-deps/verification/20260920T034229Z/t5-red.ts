#!/usr/bin/env node
/*
 * t5 — RED/GREEN boundary, measured by the verifier's OWN probes on a CONTROLLED PAIR.
 *
 * The two arms differ by exactly ONE thing: the presence of the `mpd-better-sidebar` insert row in
 * a STAGED COPY of the bundle's cordis.patch.yml. No source file is touched (the stage is built
 * from symlinks + two byte-copies), and the GREEN arm's patch is byte-identical to the shipped one
 * (asserted), so "the staging made it green" is falsified by construction.
 *
 *   RED   = the pre-fix patch (guard row stripped)   -> expect 0 sidebar rows, boot green, no sidebar
 *   GREEN = the shipped patch (byte-identical copy)  -> expect 1 row, guard ENABLED, sidebar served
 *
 * Both arms are staged identically (a `node_modules` symlink into the checkout keeps the declared
 * dependency resolvable for the harness fallback), so resolvability is not a confounder.
 *
 * Usage: node t5-red.mjs   (env T5_RUN_DIR = this directory, T5_BOOT_MS)
 */
import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
// FOUR levels below the repo root — asserted, because a wrong depth links the profile at
// <repo>/evidence and every arm silently measures a composition with no bundle in it.
const REPO = resolve(HERE, "../../../..")
if (!existsSync(join(REPO, "package.json")) || JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name !== "@mpd-dsh/mpd") {
  throw new Error("REPO does not resolve to the @mpd-dsh/mpd bundle root: " + REPO)
}
const RUN_DIR = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const ARMS_DIR = join(RUN_DIR, "arms")
const SB_DIR = join(RUN_DIR, "sandboxes")
const REAL_DSH = join(homedir(), ".dsh")
const BASE = "@deepseek-ai/dsh-base"
const WEBAPP = "@deepseek-ai/dsh-web-app"
const MPD = "@mpd-dsh/mpd"
const SIDEBAR = "dsh-better-sidebar"
const ROUTE = "/sidebar/api"
const BOOT_WAIT_MS = Number(process.env.T5_BOOT_MS ?? 90_000)
const FATAL = ["plugin(s) failed to load", "did not activate", "pending (waiting for service", "failed to apply loader entry", "duplicate prefix route", "duplicate loader entry id", "plugin tree failed to load", "unsupported JSON schema"]

const utc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const readText = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + "\n") }

/** Strip exactly the `- insert:` block carrying `id: mpd-better-sidebar`, nothing else. */
function stripGuardRow(text) {
  const lines = text.split("\n")
  const start = lines.findIndex((line, i) => line === "- insert:" && (lines[i + 1] ?? "").includes("id: mpd-better-sidebar"))
  if (start < 0) throw new Error("guard insert block not found — refusing to fake a pre-fix stage")
  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("      disabled: !!js")) { end = i; break }
    if (lines[i] === "- insert:") break
  }
  if (end < 0) throw new Error("guard `disabled` line not found — refusing to fake a pre-fix stage")
  return { stripped: [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n"), removed: end - start + 1, startLine: start + 1, endLine: end + 1 }
}

function stageBundle(root, { stripGuard }) {
  const staged = join(root, "stage", stripGuard ? "prefix-bundle" : "shipped-bundle")
  mkdirSync(staged, { recursive: true })
  for (const entry of readdirSync(REPO)) {
    if (entry === "node_modules" || entry === ".git" || entry === "package.json" || entry === "packages") continue
    symlinkSync(join(REPO, entry), join(staged, entry), "dir")
  }
  symlinkSync(join(REPO, "node_modules"), join(staged, "node_modules"), "dir")
  mkdirSync(join(staged, "packages"))
  for (const entry of readdirSync(join(REPO, "packages"))) {
    if (entry === "mpd-bundle") continue
    symlinkSync(join(REPO, "packages", entry), join(staged, "packages", entry), "dir")
  }
  const srcBundle = join(REPO, "packages", "mpd-bundle")
  const dstBundle = join(staged, "packages", "mpd-bundle")
  mkdirSync(dstBundle, { recursive: true })
  for (const entry of readdirSync(srcBundle)) {
    if (entry === "cordis.patch.yml") continue
    symlinkSync(join(srcBundle, entry), join(dstBundle, entry), "dir")
  }
  const sourceText = readFileSync(join(srcBundle, "cordis.patch.yml"), "utf8")
  const detail = { staged, sourceSha256: sha256(join(srcBundle, "cordis.patch.yml")), stagedSha256: null }
  if (stripGuard) {
    const cut = stripGuardRow(sourceText)
    writeFileSync(join(dstBundle, "cordis.patch.yml"), cut.stripped)
    detail.removedLines = cut.removed
    detail.removedRange = cut.startLine + "-" + cut.endLine
    detail.strippedContainsGuardId = cut.stripped.includes("mpd-better-sidebar")
    detail.strippedContainsSidebarName = cut.stripped.includes("dsh-better-sidebar")
  } else {
    cpSync(join(srcBundle, "cordis.patch.yml"), join(dstBundle, "cordis.patch.yml"))
  }
  detail.stagedSha256 = sha256(join(dstBundle, "cordis.patch.yml"))
  detail.byteIdenticalToShipped = detail.stagedSha256 === detail.sourceSha256
  cpSync(join(REPO, "package.json"), join(staged, "package.json"))
  detail.stagedPackageJsonSha256 = sha256(join(staged, "package.json"))
  detail.shippedPackageJsonSha256 = sha256(join(REPO, "package.json"))
  return detail
}

function buildSandbox({ tag, bundleLink }) {
  const root = join(SB_DIR, tag)
  rmSync(root, { recursive: true, force: true })
  const dshHome = join(root, "dsh")
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true,
    dependencies: { [MPD]: "link:" + bundleLink },
    dsh: { profile: { bundles: [BASE, WEBAPP, MPD] } },
  }, null, 2) + "\n")
  writeFileSync(join(profile, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n")
  symlinkSync(bundleLink, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  if (existsSync(join(REAL_DSH, "settings.yaml"))) cpSync(join(REAL_DSH, "settings.yaml"), join(dshHome, "settings.yaml"))
  if (existsSync(join(REAL_DSH, ".credentials.yaml"))) cpSync(join(REAL_DSH, ".credentials.yaml"), join(dshHome, ".credentials.yaml"))
  return { tag, root, dshHome, userHome, ws, profile, env: { ...process.env, DSH_HOME: dshHome, HOME: userHome } }
}

function rowKey(chunk, key) {
  let best = null
  for (const line of chunk.split("\n")) {
    const m = new RegExp("^(?:\\s*-\\s+|\\s*)(" + key + "):\\s*(.+?)\\s*$").exec(line)
    if (m === null) continue
    const indent = m[0].length - m[0].replace(/^\s*/, "").length
    if (best === null || indent < best.indent) best = { indent, raw: m[2] }
  }
  return best === null ? null : best.raw
}
const unquote = (raw) => { const m = /^"([^"]*)"$|^'([^']*)'$/.exec(raw); return m === null ? raw : (m[1] ?? m[2]) }
function sidebarRows(text) {
  const out = []
  for (const chunk of text.split(/\n(?=- )/)) {
    const name = rowKey(chunk, "name")
    if (name === null || unquote(name) !== SIDEBAR) continue
    const id = rowKey(chunk, "id")
    const disabled = rowKey(chunk, "disabled")
    out.push({ id: id === null ? "(no id)" : unquote(id), enabled: disabled === null || unquote(disabled) === "false" })
  }
  return out
}
const signatures = (text) => { const hits = FATAL.filter((m) => text.includes(m)); return { hits, healthy: hits.length === 0 } }
const guardOf = (lines) => {
  for (const line of lines) { const m = /mount guard:\s*(ENABLED|DISABLED)\s*-\s*(.*)$/.exec(line); if (m) return { decision: m[1], reason: m[2].trim() } }
  return null
}

function compose(sb) {
  const run = spawnSync(process.execPath, [join(REPO, "scripts", "dump-config.mjs"), "--profile", "w", "--json"], { cwd: sb.ws, env: sb.env, encoding: "utf8", timeout: 180_000 })
  let envelope = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  const text = envelope?.stdout ?? ""
  const rows = sidebarRows(text)
  return { command: "node scripts/dump-config.mjs --profile w --json", exitCode: envelope?.exitCode ?? run.status, rows, rowIds: rows.map((r) => r.id), enabledRows: rows.filter((r) => r.enabled).length }
}

async function bootWeb(sb, port) {
  const logPath = join(sb.root, "boot.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env: sb.env, cwd: sb.ws, stdio: ["ignore", fd, fd] })
  const base = "http://127.0.0.1:" + port
  const result = { claim: "REAL mounting boot + HTTP probes", bootCommand: "dsh --profile w --port " + port + " --no-open", logPath, port, booted: false }
  try {
    let token = null, cookie = ""
    const deadline = Date.now() + BOOT_WAIT_MS
    while (Date.now() < deadline) {
      await sleep(1500)
      const m = /token=([^\s&"'<>]+)/.exec(readText(logPath))
      if (m !== null) token = m[1]
      if (token === null) continue
      try {
        const auth = await fetch(base + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
        cookie = (auth.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ")
        if (cookie !== "") break
      } catch { /* still starting */ }
    }
    result.booted = token !== null && cookie !== ""
    if (!result.booted) { result.reason = "no token+cookie within " + BOOT_WAIT_MS + "ms"; return result }
    const html = await (await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(15_000) })).text()
    result.servedClientCarriesSidebar = html.includes(SIDEBAR + "/client.js")
    const route = await fetch(base + ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    result.sidebarRoute = { status: route.status, body: (await route.text()).slice(0, 120) }
    result.sidebarRouteMounted = route.status !== 404
    const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((m) => m[0]))]
    const sidebarUrl = urls.find((u) => u.includes(SIDEBAR + "/client.js"))
    if (sidebarUrl) {
      const mod = await fetch(base + sidebarUrl, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
      result.sidebarClientModule = { status: mod.status, bytes: (await mod.text()).length }
    }
    return result
  } catch (error) {
    result.reason = "probe threw: " + String(error?.message ?? error)
    return result
  } finally {
    const lines = readText(logPath).split("\n")
    result.signatures = signatures(lines.join("\n"))
    result.guard = guardOf(lines)
    result.guardLines = lines.filter((l) => l.includes("mount guard"))
    result.logTail = lines.filter(Boolean).slice(-6)
    try { child.kill("SIGTERM") } catch { /* gone */ }
    await sleep(2000)
    try { child.kill("SIGKILL") } catch { /* gone */ }
  }
}

async function runArm({ id, stripGuard, port }) {
  const root = join(SB_DIR, id)
  const detail = stageBundle(root, { stripGuard })
  const sb = buildSandbox({ tag: id, bundleLink: detail.staged })
  const composition = compose(sb)
  const load = await bootWeb(sb, port)
  const checks = [
    { name: "stage.patchBytes", ok: stripGuard ? (detail.byteIdenticalToShipped === false && detail.strippedContainsSidebarName === false) : detail.byteIdenticalToShipped === true, detail: JSON.stringify(detail) },
    { name: "load.booted", ok: load.booted === true, detail: load.booted ? "booted" : String(load.reason) },
    { name: "load.noFatalSignature", ok: load.signatures.healthy === true, detail: JSON.stringify(load.signatures.hits) },
  ]
  const out = { id, kind: stripGuard ? "RED (pre-fix patch copy)" : "GREEN control (shipped patch bytes)", stage: detail, composition, load, checks, ok: checks.every((c) => c.ok) }
  writeJson(join(ARMS_DIR, id + ".json"), out)
  return out
}

async function main() {
  mkdirSync(ARMS_DIR, { recursive: true })
  mkdirSync(SB_DIR, { recursive: true })
  const startedAt = utc()
  const red = await runArm({ id: "R1-prefix-controlled-red", stripGuard: true, port: 3560 })
  const green = await runArm({ id: "R2-shipped-controlled-green", stripGuard: false, port: 3563 })
  const summary = {
    task: "t5 RED/GREEN boundary (controlled pair)", runDir: RUN_DIR, startedAt, endedAt: utc(),
    red: { id: red.id, rows: red.composition.rows.length, route: red.load.sidebarRoute?.status ?? null, served: red.load.servedClientCarriesSidebar ?? null, bootHealthy: red.load.signatures?.healthy ?? null, guard: red.load.guard },
    green: { id: green.id, rows: green.composition.rows.length, route: green.load.sidebarRoute?.status ?? null, served: green.load.servedClientCarriesSidebar ?? null, bootHealthy: green.load.signatures?.healthy ?? null, guard: green.load.guard },
    boundaryProven: red.composition.rows.length === 0 && red.load.servedClientCarriesSidebar === false && red.load.sidebarRouteMounted === false
      && green.composition.rows.length >= 1 && green.load.servedClientCarriesSidebar === true && green.load.sidebarRouteMounted === true
      && red.load.booted === true && green.load.booted === true,
    allChecksOk: red.ok && green.ok,
  }
  writeJson(join(RUN_DIR, "red-green.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => { console.error("t5-red failed: " + String(error?.stack ?? error)); process.exit(1) })
