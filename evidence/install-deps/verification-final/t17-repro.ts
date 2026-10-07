#!/usr/bin/env node
/*
 * t17 — FINAL independent verification on the frozen post-repair revision (Lead lane).
 *
 * Fresh harness for the new evidence root (`evidence/install-deps/verification-final/`). It does
 * NOT read the t5 arm records as proof: every claim below is re-measured here with real boots.
 *
 * Arms (all sandboxes live OUTSIDE the evidence tree, under T5_SANDBOX_ROOT):
 *   A0 real `dsh plugin --profile web add <repo>`   A1 bundle-only web
 *   A2 aggregate-first                              A3 mpd-first-aggregate-after
 *   A4 dsh-tui plane                                A5 package-absent (hermetic copy stage)
 *   P1 profile patch mounts it                      P2 $DSH_HOME patch mounts it
 *   P3 `--patch <file>` overlay mounts it           P4 `--patch=<file>` overlay mounts it
 *   C1 pre-repair control (patch-layer clause removed) -> must DIE with duplicate prefix route
 *   D1 decoy: comment-only mention -> must NOT suppress   D2 decoy: literal disabled:true row -> must NOT suppress
 *   D3 genuine foreign mount -> MUST suppress
 *
 * Composition (--dump-config, composition only) and load (a real boot + HTTP) are separate objects;
 * --dump-config is never cited as load evidence.
 *
 * Usage: T5_RUN_DIR=<verification-final> node t17-repro.mjs [--only id1,id2] [--list]
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
// evidence/install-deps/verification-final is THREE levels below the repo root — asserted (a wrong depth
// silently links the profile at <repo>/evidence; t5 pass 1 measured exactly that).
const REPO = resolve(HERE, "../../..")
if (!existsSync(join(REPO, "package.json")) || JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name !== "@mpd-dsh/mpd") {
  throw new Error("REPO does not resolve to the @mpd-dsh/mpd bundle root: " + REPO)
}
const RUN_DIR = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const ARMS_DIR = process.env.T5_ARMS_DIR ? resolve(process.env.T5_ARMS_DIR) : join(RUN_DIR, "arms")
const SANDBOX_DIR = process.env.T5_SANDBOX_ROOT ? resolve(process.env.T5_SANDBOX_ROOT) : "/tmp/t17-sandboxes"
const SUMMARY_FILE = process.env.T5_SUMMARY ? resolve(process.env.T5_SUMMARY) : join(RUN_DIR, "result.json")
const LOG_DIR = join(RUN_DIR, "logs")
const FIXTURE_DIR = join(RUN_DIR, "fixtures")

const REAL_DSH = join(homedir(), ".dsh")
const REAL_WEB_NM = join(REAL_DSH, "profiles", "web", "node_modules")
const REAL_TUI_NM = join(REAL_DSH, "profiles", "dsh-tui", "node_modules")
const BASE = "@deepseek-ai/dsh-base"
const WEBAPP = "@deepseek-ai/dsh-web-app"
const MPD = "@mpd-dsh/mpd"
const TUI = "@deepseek-harness-tui/dsh-tui"
const AGG = "@linxin666/dsh-web-all"
const SIDEBAR = "dsh-better-sidebar"
const ROUTE = "/sidebar/api"
const BOOT_WAIT_MS = Number(process.env.T5_BOOT_MS ?? 120_000)
const TUI_WAIT_MS = Number(process.env.T5_TUI_MS ?? 90_000)
const CONC = Number(process.env.T5_CONC ?? 4)
const FOREIGN_MOUNT = "t17-foreign-mount"
const DECOY_COMMENT = "t17-decoy-comment"
const DECOY_DISABLED = "t17-decoy-disabled"

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
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + "\n") }
const readText = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }

function hashPin(label) {
  const files = {}
  for (const rel of HASH_PATHS) {
    const abs = join(REPO, rel)
    files[rel] = existsSync(abs) ? { sha256: sha256(abs), bytes: statSync(abs).size } : { sha256: null, absent: true }
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

// ── composition parser ──────────────────────────────────────────────────────────────────────
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
    out.push({ id: id === null ? "(no id)" : unquote(id), disabledRaw: disabled === null ? null : disabled.slice(0, 40), enabled: disabled === null || unquote(disabled) === "false" })
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

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
function writeFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const layer = (name, patchLines) => {
    const dir = join(FIXTURE_DIR, name)
    mkdirSync(join(dir, "lib"), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name, version: "0.0.1-t17", private: true, type: "module", main: "lib/index.js",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }, null, 2) + "\n")
    writeFileSync(join(dir, "lib", "index.js"), "export {};\n")
    writeFileSync(join(dir, "cordis.patch.yml"), patchLines.join("\n") + "\n")
    return dir
  }
  layer(FOREIGN_MOUNT, [
    "# t17 falsification fixture: a FOREIGN layer that genuinely MOUNTS dsh-better-sidebar (enabled row),",
    "# appearing AFTER @mpd-dsh/mpd in dsh.profile.bundles. The guard MUST back off.",
    "- insert:",
    "    - id: t17-foreign-sidebar",
    "      name: 'dsh-better-sidebar'",
  ])
  layer(DECOY_COMMENT, [
    "# t17 falsification fixture: MOUNTS NOTHING. It only MENTIONS the package name",
    "# 'dsh-better-sidebar' inside this comment, the way a documentation block would; its single",
    "# row is a DISABLED timer so the fixture cannot perturb the boot. t14's repair must ignore it.",
    "- insert:",
    "    - id: t17-decoy-comment-row",
    "      name: '@deepseek-ai/cordis-plugin-timer'",
    "      disabled: true",
  ])
  layer(DECOY_DISABLED, [
    "# t17 falsification fixture: inserts a row NAMED dsh-better-sidebar that is LITERALLY",
    "# disabled: true — it mounts nothing. t14's repair must treat it as not-a-mount.",
    "- insert:",
    "    - id: t17-decoy-disabled-row",
    "      name: 'dsh-better-sidebar'",
    "      disabled: true",
  ])
  layer("t17-flow-style", [
    "# t17 adversarial fixture: a foreign layer that mounts the sidebar in FLOW-STYLE YAML (valid, and",
    "# the row-aware predicate is line/indent based) — if the predicate misses it, our row stays",
    "# ENABLED and the boot dies with duplicate prefix route.",
    "- insert:",
    "    - { id: t17-flow-row, name: 'dsh-better-sidebar' }",
  ])
  const overlay = (file, lines) => writeFileSync(join(FIXTURE_DIR, file), lines.join("\n") + "\n")
  const MOUNT_LINES = (id) => [
    "# t17 patch-layer fixture: a PATCH OVERLAY supplied on the command line (`--patch`), mounting",
    "# the sidebar host. The loader applies it after the profile layer; the guard must see it in argv.",
    "- insert:",
    "    - id: " + id,
    "      name: 'dsh-better-sidebar'",
  ]
  overlay("overlay-space.yml", MOUNT_LINES("t17-overlay-space-row"))
  overlay("overlay-equals.yml", MOUNT_LINES("t17-overlay-equals-row"))
}

const PROFILE_PATCH_MOUNT = ["# t17 patch-layer fixture: the PROFILE's own patch layer mounts the sidebar host.", "- insert:", "    - id: t17-profile-sidebar", "      name: 'dsh-better-sidebar'", ""].join("\n")
const DSH_HOME_PATCH_MOUNT = ["# t17 patch-layer fixture: the $DSH_HOME patch layer mounts the sidebar host.", "- insert:", "    - id: t17-dshhome-sidebar", "      name: 'dsh-better-sidebar'", ""].join("\n")
const T17_LAYER_CLAUSE_START = "for (const layer of layers) { const text = readText(layer); if (text !== null && foreignRowMountsSidebar(text)) { say('DISABLED', 'patch layer ' + layer + ' already mounts it'); return true } }"
const T17_LAYER_CLAUSE_END = T17_LAYER_CLAUSE_START

// ── sandbox ─────────────────────────────────────────────────────────────────────────────────
/** Hermetic copy of the shipped bundle; `stripLayerClause` reconstructs the pre-t11 control. */
function stageBundleCopy(root, { stripLayerClause, linkNodeModules = false }) {
  const staged = join(root, "stage", stripLayerClause ? "pre-repair" : "shipped-copy")
  mkdirSync(staged, { recursive: true })
  const skip = (src) => !src.includes("/node_modules") && !src.includes("/.git") && !src.includes("/evidence")
  for (const dir of ["packages", "presets", "skills", "extensions", "templates", "scripts"]) {
    if (existsSync(join(REPO, dir))) cpSync(join(REPO, dir), join(staged, dir), { recursive: true, filter: skip })
  }
  for (const entry of readdirSync(REPO)) {
    const abs = join(REPO, entry)
    if (statSync(abs).isFile()) cpSync(abs, join(staged, entry))
  }
  // C1 (the control) needs the DECLARED dependency to stay resolvable, or the guard disables on its
  // first predicate ("not resolvable") and the duplicate-mount boundary can never be reached.
  // A5 (package-absent) is the opposite case and must NOT get this link.
  if (linkNodeModules) symlinkSync(join(REPO, "node_modules"), join(staged, "node_modules"), "dir")
  const patchPath = join(staged, "packages/mpd-bundle/cordis.patch.yml")
  const sourceText = readFileSync(join(REPO, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  const detail = { staged, shippedPatchSha256: sha256(join(REPO, "packages/mpd-bundle/cordis.patch.yml")), stagedPatchSha256: sha256(patchPath), clauseRemoved: false, clausePresentInShipped: sourceText.includes(T17_LAYER_CLAUSE_START) }
  if (stripLayerClause) {
    if (!detail.clausePresentInShipped) throw new Error("patch-layer clause not found — refusing to fake a pre-repair copy")
    writeFileSync(patchPath, sourceText.split(T17_LAYER_CLAUSE_START).join(""))
    detail.stagedPatchSha256 = sha256(patchPath)
    detail.clauseRemoved = !readFileSync(patchPath, "utf8").includes(T17_LAYER_CLAUSE_START)
  }
  return detail
}

function buildSandbox({ tag, profileName = "w", bundles, links = [], bundleLink = REPO, realInstall = false, profilePatch = null, dshHomePatch = null }) {
  const root = join(SANDBOX_DIR, tag)
  rmSync(root, { recursive: true, force: true })
  const dshHome = join(root, "dsh")
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", profileName)
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-" + profileName, private: true,
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
  if (profilePatch !== null) writeFileSync(join(profile, "cordis.patch.yml"), profilePatch)
  if (dshHomePatch !== null) writeFileSync(join(dshHome, "cordis.patch.yml"), dshHomePatch)
  if (existsSync(join(REAL_DSH, "settings.yaml"))) cpSync(join(REAL_DSH, "settings.yaml"), join(dshHome, "settings.yaml"))
  if (existsSync(join(REAL_DSH, ".credentials.yaml"))) cpSync(join(REAL_DSH, ".credentials.yaml"), join(dshHome, ".credentials.yaml"))
  return { tag, root, dshHome, userHome, ws, profile, profileName, bundles, env: { ...process.env, DSH_HOME: dshHome, HOME: userHome } }
}

// ── probes ──────────────────────────────────────────────────────────────────────────────────
function compose(sb, extraArgs = []) {
  const args = [join(REPO, "scripts", "dump-config.mjs"), "--profile", sb.profileName, "--json", ...(extraArgs.length ? ["--", ...extraArgs] : [])]
  const run = spawnSync(process.execPath, args, { cwd: sb.ws, env: sb.env, encoding: "utf8", timeout: 240_000 })
  let envelope = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  const text = envelope?.stdout ?? ""
  return {
    claim: "COMPOSITION ONLY (scripts/dump-config.mjs; never executes plugin code, AGENTS.md §4). NEVER cited as load evidence.",
    command: "node scripts/dump-config.mjs --profile " + sb.profileName + " --json" + (extraArgs.length ? " " + extraArgs.join(" ") : ""),
    exitCode: envelope?.exitCode ?? run.status,
    envelopeParsed: envelope !== null,
    rows: sidebarRows(text),
    rowIds: sidebarRows(text).map((r) => r.id),
    stderrTail: (run.stderr ?? "").split("\n").filter(Boolean).slice(-4),
    composedText: text,
  }
}

async function bootWeb(sb, port, extraArgs = []) {
  const logPath = join(sb.root, "boot.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", sb.profileName, ...extraArgs, "--port", String(port), "--no-open"], { env: sb.env, cwd: sb.ws, stdio: ["ignore", fd, fd] })
  const base = "http://127.0.0.1:" + port
  const result = {
    claim: "REAL mounting boot + HTTP probes (no --dump-config in this claim)",
    bootCommand: "dsh --profile " + sb.profileName + (extraArgs.length ? " " + extraArgs.join(" ") : "") + " --port " + port + " --no-open",
    logPath, port, booted: false,
  }
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
      } catch { /* starting */ }
    }
    result.booted = token !== null && cookie !== ""
    if (!result.booted) { result.reason = "no token+cookie within " + BOOT_WAIT_MS + "ms"; return result }
    const html = await (await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(15_000) })).text()
    result.servedClientCarriesSidebar = html.includes(SIDEBAR + "/client.js")
    const route = await fetch(base + ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
    result.sidebarRoute = { status: route.status, body: (await route.text()).slice(0, 160) }
    result.sidebarRouteMounted = route.status !== 404
    return result
  } catch (error) { result.reason = "boot/probe threw: " + String(error?.message ?? error); return result }
  finally {
    const text = readText(logPath)
    result.signatures = signatures(text)
    result.guardLines = text.split("\n").filter((l) => l.includes("mount guard"))
    result.guard = guardLine(result.guardLines)
    result.duplicateRouteLines = text.split("\n").filter((l) => l.includes("duplicate prefix route")).slice(0, 4)
    result.logTail = text.split("\n").filter(Boolean).slice(-8)
    try { child.kill("SIGTERM") } catch { /* gone */ }
    await sleep(2000)
    try { child.kill("SIGKILL") } catch { /* gone */ }
  }
}

async function bootTui(sb) {
  const session = ("t17-" + sb.tag).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 30)
  const rawLog = join(sb.root, "tui-raw.log")
  const paneFile = join(sb.root, "tui-pane.txt")
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })
  const inner = "env DSH_HOME=" + JSON.stringify(sb.dshHome) + " HOME=" + JSON.stringify(sb.userHome) + " dsh-tui"
  const created = spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "220", "-y", "50", "-c", sb.ws, inner], { encoding: "utf8" })
  const result = { claim: "REAL dsh-tui mounting boot in tmux", bootCommand: "tmux new-session … dsh-tui", paneFile, rawLogFile: rawLog, booted: false }
  if (created.status !== 0) { result.reason = "tmux could not create the session"; return result }
  spawnSync("tmux", ["pipe-pane", "-t", session, "-o", "cat >> " + JSON.stringify(rawLog)], { encoding: "utf8" })
  await sleep(TUI_WAIT_MS)
  const pane = spawnSync("tmux", ["capture-pane", "-p", "-J", "-S", "-4000", "-t", session], { encoding: "utf8" }).stdout ?? ""
  writeFileSync(paneFile, pane)
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })
  const combined = (pane + "\n" + readText(rawLog)).replaceAll("\r", "")
  result.booted = pane.trim().length > 0
  result.signatures = signatures(combined)
  const lines = combined.split("\n")
  result.guard = guardLine(lines)
  result.guardLines = lines.filter((l) => l.includes("mount guard"))
  result.logTail = pane.split("\n").filter(Boolean).slice(-8)
  return result
}

// ── arms ────────────────────────────────────────────────────────────────────────────────────
const AGG_LINK = { from: join(REAL_WEB_NM, "@linxin666"), to: "@linxin666" }
const TUI_LINK = { from: join(REAL_TUI_NM, "@deepseek-harness-tui"), to: "@deepseek-harness-tui" }
const webArm = (id, o) => ({ id, plane: "web", profileName: "w", ...o })
const E = (o) => ({ rowsMin: 1, rowsMax: 2, literalEnabledMax: 0, guard: "ENABLED", served: true, routeMounted: true, ...o })
const MOUNTED_BY_OTHER = { guard: "DISABLED", served: true, routeMounted: true }

const ARMS = [
  webArm("A0-real-plugin-add", {
    purpose: "the REAL shipped command: `dsh plugin --profile web add <repo>` reconciles a profile that starts with [base, web-app] and no bundle, then the profile boots.",
    profileName: "web", realInstall: true, bundles: [BASE, WEBAPP],
    expect: E(),
  }),
  webArm("A1-bundle-only", { purpose: "the reported user composition: the bundle alone on the web plane.", bundles: [BASE, WEBAPP, MPD], expect: E() }),
  webArm("A2-aggregate-first", { purpose: "an aggregate that mounts the sidebar is installed FIRST.", bundles: [BASE, WEBAPP, AGG, MPD], links: [AGG_LINK], expect: E({ literalEnabledMax: 1, ...MOUNTED_BY_OTHER }) }),
  webArm("A3-mpd-first-aggregate-after", { purpose: "the SAME aggregate installed AFTER the bundle (the forward-blind order).", bundles: [BASE, WEBAPP, MPD, AGG], links: [AGG_LINK], expect: E({ literalEnabledMax: 1, ...MOUNTED_BY_OTHER }) }),
  { id: "A4-tui-plane", plane: "tui", profileName: "dsh-tui", purpose: "the dsh-tui plane provides no webServer: row disables, TUI boot stays green.", bundles: [BASE, TUI, MPD], links: [TUI_LINK], expect: { rowsMin: 1, rowsMax: 1, literalEnabledMax: 0, guard: "DISABLED", served: false } },
  webArm("A5-package-absent", { purpose: "the declared dependency is NOT resolvable (hermetic copy, sandbox off the checkout): boot succeeds, degraded.", bundles: [BASE, WEBAPP, MPD], stage: true, expect: E({ guard: "DISABLED", served: false, routeMounted: false }) }),
  webArm("P1-profile-patch-mounts", { purpose: "the PROFILE's own cordis.patch.yml mounts the sidebar (the R1 class).", bundles: [BASE, WEBAPP, MPD], profilePatch: PROFILE_PATCH_MOUNT, expect: E({ rowsMin: 2, rowsMax: 2, literalEnabledMax: 1, ...MOUNTED_BY_OTHER }) }),
  webArm("P2-dshhome-patch-mounts", { purpose: "the $DSH_HOME cordis.patch.yml mounts the sidebar.", bundles: [BASE, WEBAPP, MPD], dshHomePatch: DSH_HOME_PATCH_MOUNT, expect: E({ rowsMin: 2, rowsMax: 2, literalEnabledMax: 1, ...MOUNTED_BY_OTHER }) }),
  webArm("P3-patch-overlay-space-mounts", { purpose: "a `--patch <file>` overlay mounts the sidebar; the guard must see it in argv.", bundles: [BASE, WEBAPP, MPD], overlay: "overlay-space.yml", overlayForm: "space", expect: E({ rowsMin: 2, rowsMax: 2, literalEnabledMax: 1, ...MOUNTED_BY_OTHER }) }),
  webArm("P4-patch-overlay-equals-mounts", { purpose: "the `--patch=<file>` spelling must be recognised too.", bundles: [BASE, WEBAPP, MPD], overlay: "overlay-equals.yml", overlayForm: "equals", expect: E({ rowsMin: 2, rowsMax: 2, literalEnabledMax: 1, ...MOUNTED_BY_OTHER }) }),
  webArm("C1-pre-repair-patch-layer-control", {
    purpose: "CONTROL: the same profile-patch composition against a frozen copy of the shipped tree with the patch-layer clause removed — the boundary must be red-able (duplicate prefix route, dead boot).",
    bundles: [BASE, WEBAPP, MPD], profilePatch: PROFILE_PATCH_MOUNT, stripLayerClause: true, linkNodeModules: true,
    expect: { rowsMin: 2, rowsMax: 2, literalEnabledMax: 1, guard: "ENABLED", served: false, routeMounted: false, expectDead: true }, findingArm: true,
  }),
  webArm("D1-decoy-comment-only", {
    purpose: "t14's REASON TO EXIST: a foreign layer that only MENTIONS the package in a COMMENT must no longer suppress our mount.",
    bundles: [BASE, WEBAPP, MPD, DECOY_COMMENT], fixtureLinks: [DECOY_COMMENT],
    expect: E({ rowsMin: 1, rowsMax: 1 }), findingArm: false,
  }),
  webArm("D2-decoy-disabled-row", {
    purpose: "a foreign layer that inserts a LITERALLY disabled: true sidebar row mounts nothing and must not suppress our mount either.",
    bundles: [BASE, WEBAPP, MPD, DECOY_DISABLED], fixtureLinks: [DECOY_DISABLED],
    expect: E({ rowsMin: 2, rowsMax: 2 }), findingArm: false,
  }),
  webArm("E1-foreign-flow-style-mount", {
    purpose: "adversarial probe of the repaired row-aware predicate: a foreign layer mounts the sidebar with a FLOW-STYLE row (valid YAML, not an indented block). Correct behaviour = DISABLED + served.",
    bundles: [BASE, WEBAPP, MPD, "t17-flow-style"], fixtureLinks: ["t17-flow-style"],
    expect: E({ rowsMin: 1, rowsMax: 2, literalEnabledMax: 1, ...MOUNTED_BY_OTHER }), findingArm: true,
    findingIf: "guard ENABLED although the foreign flow-style row mounts it -> duplicate prefix route / dead boot",
  }),
  webArm("D3-foreign-genuine-mount", {
    purpose: "control in the other direction: a foreign layer that GENUINELY mounts it must still make our row back off.",
    bundles: [BASE, WEBAPP, MPD, FOREIGN_MOUNT], fixtureLinks: [FOREIGN_MOUNT],
    expect: E({ rowsMin: 2, rowsMax: 2, literalEnabledMax: 1, ...MOUNTED_BY_OTHER }),
  }),
]

function evaluate(arm, composition, load, sb) {
  const rows = composition.rows
  const enabled = rows.filter((r) => r.enabled)
  composition.rowCount = rows.length
  composition.literalEnabledCount = enabled.length
  composition.literalEnabledIds = enabled.map((r) => r.id)
  composition.ok = composition.envelopeParsed === true && composition.exitCode === 0
    && rows.length >= arm.expect.rowsMin && rows.length <= arm.expect.rowsMax
    && enabled.length <= arm.expect.literalEnabledMax

  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok: ok === true, detail })
  add("composition.exit0", composition.exitCode === 0, "exit=" + composition.exitCode + " stderr=" + JSON.stringify(composition.stderrTail))
  add("composition.rowCount", rows.length >= arm.expect.rowsMin && rows.length <= arm.expect.rowsMax, "rows=" + rows.length + " ids=" + JSON.stringify(composition.rowIds))
  add("composition.literalEnabled", enabled.length <= arm.expect.literalEnabledMax, "literalEnabled=" + enabled.length + " " + JSON.stringify(composition.literalEnabledIds))
  if (arm.expect.expectDead) {
    // A NEGATIVE CONTROL inverts the health expectations: booted=false and the duplicate-route
    // signature ARE the expected outcome, so the generic health checks are not applied here.
    add("control.deadBoot", load.booted === false && load.signatures.hits.includes("duplicatePrefixRoute"), "booted=" + load.booted + " hits=" + JSON.stringify(load.signatures.hits))
    add("control.duplicateRouteLine", (load.duplicateRouteLines ?? []).length > 0, JSON.stringify((load.duplicateRouteLines ?? [])[0] ?? null))
  } else {
    add("load.booted", load.booted === true, load.booted ? "booted" : "reason=" + (load.reason ?? "unknown"))
    add("load.noFatalSignature", load.signatures.healthy === true, JSON.stringify(load.signatures.hits))
    add("load.guardDecision", load.guard?.decision === arm.expect.guard, "guard=" + JSON.stringify(load.guard) + " expected=" + arm.expect.guard)
    if (arm.plane === "web") {
      add("load.routeMounted", load.sidebarRouteMounted === arm.expect.routeMounted, "GET " + ROUTE + " -> " + (load.sidebarRoute?.status ?? "n/a") + " body=" + JSON.stringify(load.sidebarRoute?.body ?? ""))
      add("load.clientServed", load.servedClientCarriesSidebar === arm.expect.served, "servedClientCarriesSidebar=" + load.servedClientCarriesSidebar)
    }
  }
  const ok = checks.every((c) => c.ok === true)
  return {
    id: arm.id, plane: arm.plane, purpose: arm.purpose, profileName: sb.profileName, bundles: sb.bundles,
    expect: arm.expect, ok, checks, failedChecks: checks.filter((c) => !c.ok).map((c) => c.name),
    findingArm: arm.findingArm === true,
  }
}

async function runArm(arm, index) {
  const root = join(SANDBOX_DIR, arm.id)
  // ORDER: buildSandbox() rm -rf's <root>, so it runs FIRST (it only creates a symlink to the future
  // stage path) and the copy is materialized afterwards — the reverse order silently deleted the
  // stage in an earlier lane and measured a dangling link.
  const stagedName = arm.stripLayerClause === true ? "pre-repair" : (arm.stage === true ? "shipped-copy" : null)
  const sb = buildSandbox({
    tag: arm.id, profileName: arm.profileName, bundles: arm.bundles,
    bundleLink: stagedName === null ? REPO : join(root, "stage", stagedName),
    realInstall: arm.realInstall === true,
    profilePatch: arm.profilePatch ?? null, dshHomePatch: arm.dshHomePatch ?? null,
    links: [...(arm.links ?? []), ...((arm.fixtureLinks ?? []).map((name) => ({ from: join(FIXTURE_DIR, name), to: name })))],
  })
  let install = null
  let stage = null
  if (stagedName !== null) stage = stageBundleCopy(root, { stripLayerClause: arm.stripLayerClause === true, linkNodeModules: arm.linkNodeModules === true })
  const extraArgs = arm.overlay === undefined ? [] : (arm.overlayForm === "equals" ? ["--patch=" + join(FIXTURE_DIR, arm.overlay)] : ["--patch", join(FIXTURE_DIR, arm.overlay)])
  if (arm.realInstall === true) {
    const before = JSON.parse(readText(join(sb.profile, "package.json")))
    const cache = join(sb.root, "cache")
    for (const d of ["data", "cache", "state", "pnpm-store", "pnpm-home", "tmp"]) mkdirSync(join(cache, d), { recursive: true })
    const run = spawnSync("dsh", ["plugin", "--profile", sb.profileName, "add", REPO], {
      cwd: sb.ws, encoding: "utf8", timeout: 300_000,
      env: { ...sb.env, XDG_DATA_HOME: join(cache, "data"), XDG_CACHE_HOME: join(cache, "cache"), XDG_STATE_HOME: join(cache, "state"), npm_config_store_dir: join(cache, "pnpm-store"), PNPM_HOME: join(cache, "pnpm-home"), TMPDIR: join(cache, "tmp") },
    })
    install = {
      command: "dsh plugin --profile " + sb.profileName + " add " + REPO, exitCode: run.status,
      stdoutTail: (run.stdout ?? "").split("\n").filter(Boolean).slice(-4),
      manifestBefore: before, manifestAfter: JSON.parse(readText(join(sb.profile, "package.json"))),
    }
    if (run.status !== 0) {
      const verdict = { id: arm.id, ok: false, install, checks: [{ name: "install.exit0", ok: false, detail: "exit=" + run.status }], failedChecks: ["install.exit0"] }
      writeJson(join(ARMS_DIR, arm.id + ".json"), verdict)
      return verdict
    }
  }
  const composition = compose(sb, extraArgs)
  const load = arm.plane === "tui" ? await bootTui(sb) : await bootWeb(sb, 3610 + index * 3, extraArgs)
  const verdict = evaluate(arm, composition, load, sb)
  // durable copies BEFORE the sandbox root dies (it may live in a private /tmp)
  mkdirSync(LOG_DIR, { recursive: true })
  for (const [name, path] of [["boot.log", load.logPath], ["tui-pane.txt", load.paneFile], ["tui-raw.log", load.rawLogFile]]) {
    if (typeof path === "string" && existsSync(path)) cpSync(path, join(LOG_DIR, arm.id + "." + name))
  }
  if (composition.composedText) writeFileSync(join(LOG_DIR, arm.id + ".composed.txt"), composition.composedText)
  const out = {
    ...verdict, install, stage,
    overlayArgs: extraArgs,
    profilePatch: arm.profilePatch ?? null,
    nodeModulesAfterBoot: (() => { try { return readdirSync(join(sb.profile, "node_modules")).sort().slice(0, 8) } catch { return null } })(),
    evidence: { bootLog: join(LOG_DIR, arm.id + ".boot.log"), composed: join(LOG_DIR, arm.id + ".composed.txt") },
    composition: { ...composition, composedText: undefined }, load,
  }
  writeJson(join(ARMS_DIR, arm.id + ".json"), out)
  return out
}

async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }))
  return results
}

async function main() {
  if (process.argv.includes("--list")) { console.log(ARMS.map((a) => a.id).join("\n")); return }
  if (process.argv.includes("--resummarize")) {
    // Re-derive the summary from the PERSISTED arms (no reboot): the control-arm encoding was fixed
    // after the matrix ran, so C1's stored ok/checks are recomputed under the corrected rule.
    const files = readdirSync(ARMS_DIR).filter((f) => f.endsWith(".json"))
    const rows = files.map((f) => JSON.parse(readFileSync(join(ARMS_DIR, f), "utf8")))
    const healthNames = new Set(["load.booted", "load.noFatalSignature"])
    const arms = rows.map((r) => {
      const expectDead = r.expect?.expectDead === true
      const relevant = (r.checks ?? []).filter((c) => !(expectDead && healthNames.has(c.name)))
      const ok = relevant.length > 0 && relevant.every((c) => c.ok === true)
      return { id: r.id, ok, failedChecks: relevant.filter((c) => !c.ok).map((c) => c.name), guard: r.load?.guard ?? null, route: r.load?.sidebarRoute?.status ?? null, served: r.load?.servedClientCarriesSidebar ?? null, signatureHits: r.load?.signatures?.hits ?? [], rowIds: r.composition?.rowIds ?? [], backend: r.install?.exitCode ?? null }
    })
    const summary = JSON.parse(readFileSync(SUMMARY_FILE, "utf8"))
    summary.reencodedAtUtc = utc()
    summary.encodingNote = "control arms (expectDead) are exempt from the generic booted/no-fatal-signature checks; their expectations are control.deadBoot + control.duplicateRouteLine"
    summary.arms = arms.sort((a, b) => a.id.localeCompare(b.id))
    summary.allArmsOk = arms.every((a) => a.ok)
    writeJson(SUMMARY_FILE, summary)
    console.log(JSON.stringify({ resummarized: true, allArmsOk: summary.allArmsOk, failing: arms.filter((a) => !a.ok).map((a) => a.id) }, null, 2))
    return
  }
  const only = process.argv.includes("--only") ? (process.argv[process.argv.indexOf("--only") + 1] ?? "").split(",") : null
  const arms = only === null ? ARMS : ARMS.filter((a) => only.includes(a.id))
  mkdirSync(ARMS_DIR, { recursive: true })
  mkdirSync(SANDBOX_DIR, { recursive: true })
  writeFixtures()
  const startedAt = utc()
  const settled = await settledPin(Number(process.env.T5_SETTLE_MS ?? 50_000))
  const results = await pool(arms, CONC, runArm)
  const end = hashPin("post-run")
  const moved = HASH_PATHS.filter((rel) => settled.end.files[rel].sha256 !== end.files[rel].sha256)
  const summary = {
    task: "t17 final independent verification on the frozen post-repair revision", lane: "Lead", runDir: RUN_DIR,
    sandboxRoot: SANDBOX_DIR, startedAt, endedAt: utc(),
    hashDiscipline: { ...settled, postRun: end, movedDuringRun: moved, unchangedThroughRun: moved.length === 0 },
    arms: results.map((r) => ({
      id: r.id, ok: r.ok, failedChecks: r.failedChecks ?? [], guard: r.load?.guard ?? null,
      route: r.load?.sidebarRoute?.status ?? null, served: r.load?.servedClientCarriesSidebar ?? null,
      signatureHits: r.load?.signatures?.hits ?? [], rowIds: r.composition?.rowIds ?? [], backend: r.install?.exitCode ?? null,
    })),
    allArmsOk: results.every((r) => r.ok),
  }
  writeJson(SUMMARY_FILE, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => { console.error("t17-repro failed: " + String(error?.stack ?? error)); process.exit(1) })
