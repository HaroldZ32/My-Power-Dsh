#!/usr/bin/env node
/*
 * t5 — INDEPENDENT verification harness for the install-dependency fix (Lead lane, attempt 1).
 *
 * This file is VERIFIER-OWNED: it re-runs the five compositions of the fix + adversarial
 * falsification arms from the SHIPPED working tree, in sandboxes this lane builds itself
 * (DSH_HOME + HOME + cwd all under <run>/sandboxes/<arm>). It never re-reads the author's logs
 * as proof and never cites --dump-config as load evidence: the composition claim and the load
 * claim are recorded as SEPARATE objects per arm (AGENTS.md §4/§7).
 *
 * Claims it tests, per arm:
 *   COMPOSITION  scripts/dump-config.mjs -> the sidebar row exists, how many, literally enabled?
 *                (composition-only; never a load proof)
 *   LOAD         a REAL boot (web: token-authorized HTTP; tui: a tmux dsh-tui boot) with probes:
 *                /sidebar/api answers (not 404) AND the served client table carries the sidebar
 *                module AND the boot log has no fatal apply/activation signature.
 *   GUARD        the guard's own log line `[mpd-better-sidebar] mount guard: ENABLED|DISABLED - …`
 *
 * Usage: node t5-repro.mjs [--only id1,id2] [--list]
 * Env:   T5_CONC, T5_BOOT_MS, T5_TUI_MS
 */
import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
// evidence/install-deps/verification/<ts> is FOUR levels below the repo root. A wrong depth here
// silently links the profile at <repo>/evidence (measured in pass 1: `dsh plugin add` recorded
// `"evidence": "link:…/evidence"` and the boot composed no bundle at all) — so it is asserted.
const REPO = resolve(HERE, "../../../..")
if (!existsSync(join(REPO, "package.json")) || JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name !== "@mpd-dsh/mpd") {
  throw new Error("REPO does not resolve to the @mpd-dsh/mpd bundle root: " + REPO)
}
const RUN_DIR = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const ARMS_DIR = join(RUN_DIR, "arms")
const SANDBOX_DIR = join(RUN_DIR, "sandboxes")
const FIXTURE_DIR = join(RUN_DIR, "fixtures")

const REAL_DSH = join(homedir(), ".dsh")
const REAL_WEB_NM = join(REAL_DSH, "profiles", "web", "node_modules")
const REAL_TUI_NM = join(REAL_DSH, "profiles", "dsh-tui", "node_modules")
const REAL_SETTINGS = join(REAL_DSH, "settings.yaml")
const REAL_CREDS = join(REAL_DSH, ".credentials.yaml")

const BASE = "@deepseek-ai/dsh-base"
const WEBAPP = "@deepseek-ai/dsh-web-app"
const MPD = "@mpd-dsh/mpd"
const TUI = "@deepseek-harness-tui/dsh-tui"
const AGG = "@linxin666/dsh-web-all"
const SIDEBAR = "dsh-better-sidebar"
const ROUTE = "/sidebar/api"
const BOOT_WAIT_MS = Number(process.env.T5_BOOT_MS ?? 90_000)
const TUI_WAIT_MS = Number(process.env.T5_TUI_MS ?? 80_000)
const CONC = Number(process.env.T5_CONC ?? 3)
const FORIEGN_MOUNT = "t5-foreign-mount"
const DECOY_COMMENT = "t5-decoy-comment"
const DECOY_DISABLED = "t5-decoy-disabled"

const HASH_PATHS = [
  "package.json",
  "bun.lock",
  "packages/mpd-bundle/cordis.patch.yml",
  "scripts/install-profile.mjs",
  "scripts/pack-mpd.mjs",
  "skills/dsh-qa/scripts/install-dependencies.mjs",
  "skills/dsh-qa/cases.json",
  "skills/dsh-qa/SKILL.md",
]

// F1..F4 of the requirements doc + the loader's own entry failures: a boot log carrying one of
// these did NOT mount the tree. Superset of the author's scanner on purpose.
const FATAL = [
  { key: "entriesNotLoaded", marker: "plugin(s) failed to load" },
  { key: "entryNotActivated", marker: "did not activate" },
  { key: "entryPending", marker: "pending (waiting for service" },
  { key: "entryApplyFailed", marker: "failed to apply loader entry" },
  { key: "duplicatePrefixRoute", marker: "duplicate prefix route" },
  { key: "duplicateEntryId", marker: "duplicate loader entry id" },
  { key: "pluginTreeFailed", marker: "plugin tree failed to load" },
  { key: "unsupportedSchema", marker: "unsupported JSON schema" },
]

const utc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + "\n") }
const readText = (path) => { try { return readFileSync(path, "utf8") } catch { return "" } }

function hashPin(label) {
  const files = {}
  for (const rel of HASH_PATHS) {
    const abs = join(REPO, rel)
    files[rel] = existsSync(abs) ? { sha256: sha256(abs), bytes: statSync(abs).size } : { sha256: null, bytes: null, absent: true }
  }
  return { label, atUtc: utc(), files }
}

async function settledPin(settleMs = 50_000) {
  const start = hashPin("start")
  await sleep(settleMs)
  const end = hashPin("end")
  const moved = HASH_PATHS.filter((rel) => start.files[rel].sha256 !== end.files[rel].sha256)
  return { settleMs, start, end, startEqualsEnd: moved.length === 0, moved }
}

// ── composition parser (verifier-owned) ─────────────────────────────────────────────────────
/** Minimal-indent value of a key inside one composed row chunk. */
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
const unquote = (raw) => {
  const m = /^"([^"]*)"$|^'([^']*)'$/.exec(raw)
  return m === null ? raw : (m[1] ?? m[2])
}
function sidebarRows(text) {
  const out = []
  for (const chunk of text.split(/\n(?=- )/)) {
    const name = rowKey(chunk, "name")
    if (name === null || unquote(name) !== SIDEBAR) continue
    const id = rowKey(chunk, "id")
    const disabled = rowKey(chunk, "disabled")
    out.push({
      id: id === null ? "(no id)" : unquote(id),
      disabledRaw: disabled === null ? null : disabled.slice(0, 60),
      enabled: disabled === null || unquote(disabled) === "false",
    })
  }
  return out
}
function signatures(text, list = FATAL) {
  const hits = list.filter((s) => text.includes(s.marker))
  return { hits: hits.map((s) => s.key), markers: hits.map((s) => s.marker), healthy: hits.length === 0 }
}
function guardLine(lines) {
  for (const line of lines ?? []) {
    const m = /mount guard:\s*(ENABLED|DISABLED)\s*-\s*(.*)$/.exec(line)
    if (m !== null) return { decision: m[1], reason: m[2].trim() }
  }
  return null
}

// ── sandbox machinery (verifier-owned) ──────────────────────────────────────────────────────
/**
 * The shape a checkout install IS: profiles/<p>/package.json declares the bundle as a link
 * dependency + the bundle stack; node_modules/@mpd-dsh/mpd -> the checkout. `stage` replaces the
 * link with a copy-shaped directory that has NO node_modules on its closure chain (ARM 5).
 */
function buildSandbox({ tag, profileName = "w", bundles, links = [], stage = false, realInstall = false }) {
  const root = join(SANDBOX_DIR, tag)
  rmSync(root, { recursive: true, force: true })
  const dshHome = join(root, "dsh")
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", profileName)
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })

  let bundleLink = REPO
  if (stage) {
    const staged = join(root, "stage", "mpd")
    mkdirSync(staged, { recursive: true })
    for (const entry of readdirSync(REPO)) {
      if (entry === "node_modules" || entry === ".git" || entry === "package.json") continue
      symlinkSync(join(REPO, entry), join(staged, entry), "dir")
    }
    cpSync(join(REPO, "package.json"), join(staged, "package.json"))
    bundleLink = staged
  }

  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-" + profileName,
    private: true,
    dependencies: realInstall ? {} : { [MPD]: "link:" + bundleLink },
    dsh: { profile: { bundles } },
  }, null, 2) + "\n")
  writeFileSync(join(profile, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n")
  if (!realInstall) symlinkSync(bundleLink, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  for (const link of links) {
    const target = join(profile, "node_modules", link.to)
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target)) symlinkSync(link.from, target, "dir")
  }
  if (existsSync(REAL_SETTINGS)) cpSync(REAL_SETTINGS, join(dshHome, "settings.yaml"))
  if (existsSync(REAL_CREDS)) cpSync(REAL_CREDS, join(dshHome, ".credentials.yaml"))
  return {
    tag, root, dshHome, userHome, ws, profile, profileName, bundles, stage,
    env: { ...process.env, DSH_HOME: dshHome, HOME: userHome },
  }
}

/** Verifier-authored bundle layer fixtures (hermetic; no network, no real fixtures). */
function writeLayerFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const layer = (name, patchLines) => {
    const dir = join(FIXTURE_DIR, name)
    mkdirSync(join(dir, "lib"), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name, version: "0.0.1-t5", private: true, type: "module", main: "lib/index.js",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }, null, 2) + "\n")
    writeFileSync(join(dir, "lib", "index.js"), "export {};\n")
    writeFileSync(join(dir, "cordis.patch.yml"), patchLines.join("\n") + "\n")
    return dir
  }
  const mount = layer(FORIEGN_MOUNT, [
    "# t5 falsification fixture: a FOREIGN layer that mounts dsh-better-sidebar, appearing AFTER",
    "# @mpd-dsh/mpd in dsh.profile.bundles.",
    "- insert:",
    "    - id: t5-foreign-sidebar",
    "      name: 'dsh-better-sidebar'",
  ])
  const comment = layer(DECOY_COMMENT, [
    "# t5 falsification fixture: this layer MOUNTS NOTHING. It merely mentions the package name",
    "# 'dsh-better-sidebar' in a comment, the way a documentation block would.",
    "- insert:",
    "    - id: t5-decoy-comment-row",
    "      name: '@deepseek-ai/cordis-plugin-timer'",
  ])
  const disabled = layer(DECOY_DISABLED, [
    "# t5 falsification fixture: this layer inserts a row named dsh-better-sidebar that is",
    "# EXPLICITLY DISABLED, i.e. it mounts NOTHING.",
    "- insert:",
    "    - id: t5-decoy-disabled-row",
    "      name: 'dsh-better-sidebar'",
    "      disabled: true",
  ])
  return { mount, comment, disabled }
}

// ── probes ──────────────────────────────────────────────────────────────────────────────────
function compose(sb) {
  const args = [join(REPO, "scripts", "dump-config.mjs"), "--profile", sb.profileName, "--json"]
  const run = spawnSync(process.execPath, args, { cwd: sb.ws, env: sb.env, encoding: "utf8", timeout: 180_000 })
  let envelope = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  const text = envelope?.stdout ?? ""
  return {
    claim: "COMPOSITION ONLY (scripts/dump-config.mjs; composes rows, never executes plugin code — AGENTS.md §4). NEVER cited as load evidence.",
    command: "node scripts/dump-config.mjs --profile " + sb.profileName + " --json",
    exitCode: envelope?.exitCode ?? run.status,
    envelopeParsed: envelope !== null,
    rows: sidebarRows(text),
    stderrTail: (run.stderr ?? "").split("\n").filter(Boolean).slice(-4),
    composedTextFile: null,
    composedText: text,
  }
}

async function bootWeb(sb, port) {
  const logPath = join(sb.root, "boot.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", sb.profileName, "--port", String(port), "--no-open"], {
    env: sb.env, cwd: sb.ws, stdio: ["ignore", fd, fd],
  })
  const base = "http://127.0.0.1:" + port
  const result = {
    claim: "REAL mounting boot + HTTP probes (no --dump-config anywhere in this claim)",
    bootCommand: "dsh --profile " + sb.profileName + " --port " + port + " --no-open",
    logPath, port, booted: false,
  }
  try {
    let token = null
    let cookie = ""
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
    if (!result.booted) { result.reason = "no token + session cookie within " + BOOT_WAIT_MS + "ms"; return result }
    const index = await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    const html = await index.text()
    result.index = { status: index.status, bytes: Buffer.byteLength(html) }
    result.servedClientCarriesSidebar = html.includes(SIDEBAR + "/client.js")
    const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((m) => m[0]))]
    result.servedClientUrlCount = urls.length
    const sidebarUrl = urls.find((u) => u.includes(SIDEBAR + "/client.js")) ?? null
    result.sidebarClientUrl = sidebarUrl
    if (sidebarUrl !== null) {
      const mod = await fetch(base + sidebarUrl, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
      const body = await mod.text()
      result.sidebarClientModule = { status: mod.status, bytes: Buffer.byteLength(body), prefix: body.slice(0, 60) }
    }
    const route = await fetch(base + ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    const routeBody = await route.text()
    result.sidebarRoute = { path: ROUTE, status: route.status, body: routeBody.slice(0, 160) }
    result.sidebarRouteMounted = route.status !== 404
    return result
  } catch (error) {
    result.reason = "boot/probe threw: " + String(error?.message ?? error)
    return result
  } finally {
    const text = readText(logPath)
    result.signatures = signatures(text)
    const lines = text.split("\n")
    result.guard = guardLine(lines)
    result.guardLines = lines.filter((l) => l.includes("mount guard"))
    result.sidebarMentions = lines.filter((l) => l.includes(SIDEBAR)).slice(0, 12)
    result.logTail = lines.filter(Boolean).slice(-8)
    result.logBytes = Buffer.byteLength(text)
    try { child.kill("SIGTERM") } catch { /* gone */ }
    await sleep(2000)
    try { child.kill("SIGKILL") } catch { /* gone */ }
  }
}

async function bootTui(sb) {
  const session = ("t5-" + sb.tag).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 30)
  const rawLog = join(sb.root, "tui-raw.log")
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })
  const inner = "env DSH_HOME=" + JSON.stringify(sb.dshHome) + " HOME=" + JSON.stringify(sb.userHome) + " dsh-tui"
  const created = spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "220", "-y", "50", "-c", sb.ws, inner], { encoding: "utf8" })
  const result = {
    claim: "REAL dsh-tui mounting boot in tmux (verifier-owned driver), pane capture + raw pipe log",
    bootCommand: "tmux new-session -d -s " + session + " 'env DSH_HOME=… HOME=… dsh-tui'",
    tmuxCreate: { status: created.status, stderr: (created.stderr ?? "").slice(0, 300) }, session,
    paneFile: join(sb.root, "tui-pane.txt"), rawLogFile: rawLog, booted: false,
  }
  if (created.status !== 0) { result.reason = "tmux could not create the session"; return result }
  spawnSync("tmux", ["pipe-pane", "-t", session, "-o", "cat >> " + JSON.stringify(rawLog)], { encoding: "utf8" })
  await sleep(TUI_WAIT_MS)
  const capture = spawnSync("tmux", ["capture-pane", "-p", "-J", "-S", "-4000", "-t", session], { encoding: "utf8" })
  const pane = capture.stdout ?? ""
  writeFileSync(result.paneFile, pane)
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })
  const combined = pane + "\n" + readText(rawLog)
  result.booted = pane.trim().length > 0
  result.signatures = signatures(combined)
  const lines = combined.split("\n")
  result.guard = guardLine(lines)
  result.guardLines = lines.filter((l) => l.includes("mount guard"))
  result.sidebarMentions = lines.filter((l) => l.includes(SIDEBAR)).slice(0, 12)
  result.paneTail = pane.split("\n").filter(Boolean).slice(-10)
  return result
}

// ── arms ────────────────────────────────────────────────────────────────────────────────────
const AGG_LINK = { from: join(REAL_WEB_NM, "@linxin666"), to: "@linxin666" }
const SIDEBAR_LINK = { from: join(REAL_WEB_NM, SIDEBAR), to: SIDEBAR }
const TUI_LINK = { from: join(REAL_TUI_NM, "@deepseek-harness-tui"), to: "@deepseek-harness-tui" }

const webArm = (id, o) => ({ id, plane: "web", profileName: "w", ...o })
const ARMS = [
  webArm("A0-real-plugin-add", {
    purpose: "the ACTUAL install path (never re-run by the QA case): the profile starts with [base, web-app] and NO bundle; `dsh plugin --profile w add <repo>` reconciles it, then the profile boots for real.",
    realInstall: true, bundles: [BASE, WEBAPP],
    expect: { rowsMin: 1, rowsMax: 1, literalEnabledMax: 0, guard: "ENABLED", served: true, routeMounted: true },
  }),
  webArm("A1-bundle-only", {
    purpose: "the reported user composition: the bundle alone on the web plane mounts ONE ACTIVE sidebar and really serves it.",
    bundles: [BASE, WEBAPP, MPD],
    expect: { rowsMin: 1, rowsMax: 1, literalEnabledMax: 0, guard: "ENABLED", served: true, routeMounted: true },
  }),
  webArm("A2-aggregate-first", {
    purpose: "an aggregate that also mounts the sidebar is installed FIRST: still exactly one mount, healthy boot.",
    bundles: [BASE, WEBAPP, AGG, MPD], links: [AGG_LINK],
    expect: { rowsMin: 1, rowsMax: 2, literalEnabledMax: 1, guard: "DISABLED", served: true, routeMounted: true },
  }),
  webArm("A3-mpd-first-aggregate-after", {
    purpose: "the SAME aggregate installed AFTER the bundle — the order a forward-blind guard cannot see.",
    bundles: [BASE, WEBAPP, MPD, AGG], links: [AGG_LINK],
    expect: { rowsMin: 1, rowsMax: 2, literalEnabledMax: 1, guard: "DISABLED", served: true, routeMounted: true },
  }),
  { id: "A4-tui-plane", plane: "tui", profileName: "dsh-tui", purpose: "the dsh-tui plane provides no webServer/webRuntime: the row disables and the real TUI boot stays green.", bundles: [BASE, TUI, MPD], links: [TUI_LINK], expect: { guard: "DISABLED", served: false } },
  webArm("A5-package-absent", {
    purpose: "the declared dependency is NOT resolvable (staged bundle copy with no node_modules on its chain): boot SUCCEEDS, degraded to no sidebar.",
    bundles: [BASE, WEBAPP, MPD], stage: true,
    expect: { rowsMin: 1, rowsMax: 1, literalEnabledMax: 0, guard: "DISABLED", served: false, routeMounted: false },
  }),
  // ── falsification arms (task t5 §5) ───────────────────────────────────────────────────────
  webArm("F1-sidebar-as-bundle-layer", {
    purpose: "falsify (b): dsh-better-sidebar is ITSELF a declared bundle layer -> its own patch mounts it; ours must back off, the boot must stay green, the sidebar must still be served EXACTLY once.",
    bundles: [BASE, WEBAPP, SIDEBAR, MPD], links: [SIDEBAR_LINK],
    expect: { rowsMin: 1, rowsMax: 3, literalEnabledMax: 2, guard: "DISABLED", served: true, routeMounted: true }, findingArm: false,
  }),
  webArm("F2-foreign-layer-mounts-after", {
    purpose: "falsify (a) with a VERIFIER-AUTHORED foreign layer (not the real aggregate) that mounts the sidebar and appears AFTER ours.",
    bundles: [BASE, WEBAPP, MPD, FORIEGN_MOUNT], fixtureLinks: [FORIEGN_MOUNT],
    expect: { rowsMin: 1, rowsMax: 2, literalEnabledMax: 1, guard: "DISABLED", served: true, routeMounted: true },
  }),
  webArm("F3-decoy-comment-layer", {
    purpose: "adversarial over-approximation probe: a foreign layer that only MENTIONS 'dsh-better-sidebar' in a comment (mounts nothing). Guard predicate 3 is a substring test over the whole patch text.",
    bundles: [BASE, WEBAPP, MPD, DECOY_COMMENT], fixtureLinks: [DECOY_COMMENT],
    expect: { rowsMin: 1, rowsMax: 1, literalEnabledMax: 0, guard: "DISABLED", served: false, routeMounted: false }, findingArm: true,
    findingIf: "guard DISABLED by a comment-only mention while no layer mounts the sidebar (sidebar lost)",
  }),
  webArm("F4-decoy-disabled-row", {
    purpose: "adversarial over-approximation probe: a foreign layer that inserts a DISABLED sidebar row (mounts nothing).",
    bundles: [BASE, WEBAPP, MPD, DECOY_DISABLED], fixtureLinks: [DECOY_DISABLED],
    expect: { rowsMin: 1, rowsMax: 2, literalEnabledMax: 0, guard: "DISABLED", served: false, routeMounted: false }, findingArm: true,
    findingIf: "guard DISABLED although the only other mention mounts nothing (sidebar lost)",
  }),
]

function evaluate(arm, composition, load, sb) {
  const rows = composition.rows
  const literalEnabled = rows.filter((r) => r.enabled)
  composition.rowCount = rows.length
  composition.rowIds = rows.map((r) => r.id)
  composition.literalEnabledCount = literalEnabled.length
  composition.literalEnabledIds = literalEnabled.map((r) => r.id)
  composition.ok = composition.envelopeParsed === true && composition.exitCode === 0
    && rows.length >= arm.expect.rowsMin && rows.length <= arm.expect.rowsMax
    && literalEnabled.length <= arm.expect.literalEnabledMax

  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok: ok === true, detail })
  add("composition.exit0", composition.exitCode === 0, "exit=" + composition.exitCode)
  add("composition.rowCount", rows.length >= arm.expect.rowsMin && rows.length <= arm.expect.rowsMax,
    "rows=" + rows.length + " in [" + arm.expect.rowsMin + "," + arm.expect.rowsMax + "] ids=" + JSON.stringify(composition.rowIds))
  add("composition.literalEnabled", literalEnabled.length <= arm.expect.literalEnabledMax,
    "literalEnabled=" + literalEnabled.length + " <= " + arm.expect.literalEnabledMax + " " + JSON.stringify(composition.literalEnabledIds))
  add("load.booted", load.booted === true, load.booted ? "booted" : ("reason=" + (load.reason ?? "unknown")))
  add("load.noFatalSignature", load.signatures?.healthy === true, JSON.stringify(load.signatures?.hits ?? []))
  add("load.guardDecision", load.guard?.decision === arm.expect.guard,
    "guard=" + JSON.stringify(load.guard) + " expected=" + arm.expect.guard)
  if (arm.plane === "web") {
    add("load.routeMounted", load.sidebarRouteMounted === arm.expect.routeMounted,
      "GET " + ROUTE + " -> " + (load.sidebarRoute?.status ?? "n/a") + " body=" + JSON.stringify(load.sidebarRoute?.body ?? ""))
    add("load.clientServed", load.servedClientCarriesSidebar === arm.expect.served,
      "servedClientCarriesSidebar=" + load.servedClientCarriesSidebar + " module=" + JSON.stringify(load.sidebarClientModule ?? null))
    add("load.oneSidebarMount", arm.expect.served
      ? (load.sidebarRouteMounted === true && load.servedClientCarriesSidebar === true && (load.signatures?.hits ?? []).length === 0)
      : (load.sidebarRouteMounted === false && load.booted === true),
      "exactly-once / expected-absent verdict")
  }
  const ok = checks.every((c) => c.ok === true)
  return {
    id: arm.id, plane: arm.plane, purpose: arm.purpose,
    bundles: sb.bundles, profileName: sb.profileName, stage: sb.stage === true,
    expect: arm.expect, ok, checks,
    failedChecks: checks.filter((c) => !c.ok).map((c) => c.name),
    findingArm: arm.findingArm === true, findingIf: arm.findingIf ?? null,
    sandbox: { root: sb.root, dshHome: sb.dshHome, userHome: sb.userHome, ws: sb.ws, profile: sb.profile },
  }
}

async function runArm(arm, index) {
  const sb = buildSandbox({
    tag: arm.id,
    profileName: arm.profileName,
    bundles: arm.bundles,
    stage: arm.stage === true,
    realInstall: arm.realInstall === true,
    links: [
      ...(arm.links ?? []),
      ...((arm.fixtureLinks ?? []).map((name) => ({ from: join(FIXTURE_DIR, name), to: name }))),
    ],
  })
  let install = null
  if (arm.realInstall === true) {
    const before = JSON.parse(readText(join(sb.profile, "package.json")))
    const cache = join(sb.root, "cache")
    for (const dir of ["data", "cache", "state", "pnpm-store", "pnpm-home", "tmp"]) mkdirSync(join(cache, dir), { recursive: true })
    const run = spawnSync("dsh", ["plugin", "--profile", sb.profileName, "add", REPO], {
      cwd: sb.ws, encoding: "utf8", timeout: 300_000,
      env: {
        ...sb.env,
        XDG_DATA_HOME: join(cache, "data"), XDG_CACHE_HOME: join(cache, "cache"), XDG_STATE_HOME: join(cache, "state"),
        npm_config_store_dir: join(cache, "pnpm-store"), PNPM_HOME: join(cache, "pnpm-home"), TMPDIR: join(cache, "tmp"),
      },
    })
    const after = JSON.parse(readText(join(sb.profile, "package.json")))
    install = {
      command: "dsh plugin --profile " + sb.profileName + " add " + REPO,
      exitCode: run.status,
      stdout: (run.stdout ?? "").slice(-3000),
      stderrTail: (run.stderr ?? "").split("\n").filter(Boolean).slice(-6),
      manifestBefore: before, manifestAfter: after,
    }
    if (run.status !== 0) {
      const verdict = { id: arm.id, plane: arm.plane, purpose: arm.purpose, ok: false, install, failedChecks: ["install.exit0"], checks: [{ name: "install.exit0", ok: false, detail: "exit=" + run.status }] }
      writeJson(join(ARMS_DIR, arm.id + ".json"), verdict)
      return verdict
    }
  }
  const composition = compose(sb)
  const load = arm.plane === "tui" ? await bootTui(sb) : await bootWeb(sb, 3510 + index * 3)
  const verdict = evaluate(arm, composition, load, sb)
  const nodeModules = (() => { try { return readdirSync(join(sb.profile, "node_modules")).sort() } catch { return null } })()
  const fallback = (() => { try { return readdirSync(join(sb.profile, ".dsh-module-fallback")).sort().slice(0, 20) } catch { return null } })()
  const out = {
    ...verdict, install, nodeModulesAfterBoot: nodeModules, moduleFallbackAfterBoot: fallback,
    composition: { ...composition, composedText: undefined }, load,
  }
  writeJson(join(ARMS_DIR, arm.id + ".json"), out)
  if (composition.composedText) writeFileSync(join(sb.root, "composed.txt"), composition.composedText)
  return out
}

async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }))
  return results
}

async function main() {
  if (process.argv.includes("--list")) { console.log(ARMS.map((a) => a.id).join("\n")); return }
  const only = process.argv.includes("--only") ? (process.argv[process.argv.indexOf("--only") + 1] ?? "").split(",") : null
  const arms = only === null ? ARMS : ARMS.filter((a) => only.includes(a.id))
  mkdirSync(ARMS_DIR, { recursive: true })
  mkdirSync(SANDBOX_DIR, { recursive: true })
  writeLayerFixtures()
  const startedAt = utc()
  const settled = await settledPin()
  const results = await pool(arms, CONC, runArm)
  const end = hashPin("post-run")
  const movedDuringRun = HASH_PATHS.filter((rel) => settled.end.files[rel].sha256 !== end.files[rel].sha256)
  const summary = {
    task: "t5 independent verification", lane: "Lead", runDir: RUN_DIR,
    startedAt, endedAt: utc(),
    hashDiscipline: { ...settled, postRun: end, movedDuringRun, startEqualsEndAfterRun: movedDuringRun.length === 0 },
    arms: results.map((r) => ({
      id: r.id, plane: r.plane, ok: r.ok, failedChecks: r.failedChecks, expect: r.expect,
      guard: r.load.guard ?? null, route: r.load.sidebarRoute?.status ?? null,
      served: r.load.servedClientCarriesSidebar ?? null, signatureHits: r.load.signatures?.hits ?? [],
      rowIds: r.composition.rowIds, findingArm: r.findingArm, findingIf: r.findingIf,
    })),
    allArmsOk: results.every((r) => r.ok),
  }
  writeJson(join(RUN_DIR, "result.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => { console.error("t5-repro harness failed: " + String(error?.stack ?? error)); process.exit(1) })
