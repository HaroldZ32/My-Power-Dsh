#!/usr/bin/env node
/*
 * t5 follow-up (captain steering, 2026-09-20) — the R1 class: a sidebar row in the PROFILE's own
 * `<profileDir>/cordis.patch.yml`.
 *
 *   R1 (review round 1, HIGH): the guard's duplicate-mount clause read only `dsh.profile.bundles`
 *   layers, so a sidebar row supplied by the profile patch left our guard at ENABLED and the boot
 *   died with `duplicate prefix route "/sidebar/api"`.
 *
 * This lane re-tests it INDEPENDENTLY as a CONTROLLED PAIR:
 *   P1  the live revision, profile patch mounting the sidebar  -> expect our row to back off
 *       ("patch layer … already mounts it"), exactly ONE mount, route answers, no duplicate route.
 *   P2  a STAGED COPY of the shipped tree with the patch-layer clause textually removed (the
 *       pre-repair guard), same composition -> expect the duplicate-mount death, i.e. the boundary
 *       is red-able and P1's green is not vacuous.
 *
 * Every arm records the patch sha256 BEFORE and AFTER its boot, with UTC instants, so a verdict can
 * never be attributed to a revision the tree had already left.
 *
 * Usage: T5_RUN_DIR=<t5 run dir> node t5-r1-f3.mjs
 */
import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "../../../..")
if (!existsSync(join(REPO, "package.json")) || JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name !== "@mpd-dsh/mpd") {
  throw new Error("REPO does not resolve to the @mpd-dsh/mpd bundle root: " + REPO)
}
const RUN_DIR = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const OUT = join(RUN_DIR, "r1-f3-recheck")
const SB_ROOT = join(OUT, "sandboxes")
const PATCH_REL = "packages/mpd-bundle/cordis.patch.yml"
const SIDEBAR = "dsh-better-sidebar"
const ROUTE = "/sidebar/api"
const BASE = "@deepseek-ai/dsh-base"
const WEBAPP = "@deepseek-ai/dsh-web-app"
const MPD = "@mpd-dsh/mpd"
const BOOT_WAIT_MS = Number(process.env.T5_BOOT_MS ?? 120_000)
const FATAL = ["plugin(s) failed to load", "did not activate", "pending (waiting for service", "failed to apply loader entry", "duplicate prefix route", "duplicate loader entry id", "plugin tree failed to load", "unsupported JSON schema"]

const utc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const readText = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + "\n") }

/** The clause review round 1 found missing; removing it reconstructs the pre-repair guard. */
const CLAUSE_START = "const argv = Array.isArray(process.argv) ? process.argv : [];"
const CLAUSE_END = "if (text && text.indexOf('dsh-better-sidebar') >= 0) { say('DISABLED', 'patch layer ' + layer + ' already mounts it'); return true } } "
function stripPatchLayerClause(text) {
  const i = text.indexOf(CLAUSE_START)
  const j = text.indexOf(CLAUSE_END, i)
  if (i < 0 || j < 0) throw new Error("the patch-layer clause was not found — refusing to fake a pre-repair patch")
  const stripped = text.slice(0, i) + text.slice(j + CLAUSE_END.length)
  if (stripped.includes("already mounts it')\u007d \u007d")) throw new Error("clause removal left a fragment behind")
  return stripped
}

/** A REAL COPY of the shipped bundle (no symlinks: a symlinked tree resolves back into the checkout). */
function stageBundleCopy(root, { stripClause }) {
  const staged = join(root, "stage", stripClause ? "pre-repair" : "shipped-copy")
  mkdirSync(staged, { recursive: true })
  const skip = (src) => !src.includes("/node_modules") && !src.includes("/.git") && !src.includes("/evidence")
  for (const dir of ["packages", "presets", "skills", "extensions", "templates", "scripts"]) {
    if (existsSync(join(REPO, dir))) cpSync(join(REPO, dir), join(staged, dir), { recursive: true, filter: skip })
  }
  for (const entry of readdirSync(REPO)) {
    const abs = join(REPO, entry)
    if (statSync(abs).isFile()) cpSync(abs, join(staged, entry))
  }
  const patchPath = join(staged, PATCH_REL)
  const sourceText = readFileSync(join(REPO, PATCH_REL), "utf8")
  const detail = {
    staged, shippedPatchSha256: sha256(join(REPO, PATCH_REL)), stagedPatchSha256: sha256(patchPath), clauseRemoved: false,
    clausePresentInShipped: sourceText.includes(CLAUSE_START) && sourceText.includes(CLAUSE_END),
  }
  if (stripClause) {
    writeFileSync(patchPath, stripPatchLayerClause(sourceText))
    detail.stagedPatchSha256 = sha256(patchPath)
    detail.clauseRemoved = !readFileSync(patchPath, "utf8").includes(CLAUSE_START)
  }
  return detail
}

function buildSandbox({ tag, bundleLink, profilePatch }) {
  const root = join(SB_ROOT, tag)
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
  writeFileSync(join(profile, "cordis.patch.yml"), profilePatch)
  if (existsSync(join(homedir(), ".dsh", "settings.yaml"))) cpSync(join(homedir(), ".dsh", "settings.yaml"), join(dshHome, "settings.yaml"))
  if (existsSync(join(homedir(), ".dsh", ".credentials.yaml"))) cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(dshHome, ".credentials.yaml"))
  return { tag, root, dshHome, userHome, ws, profile, env: { ...process.env, DSH_HOME: dshHome, HOME: userHome } }
}

function sidebarRows(text) {
  const rowKey = (chunk, key) => {
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

function compose(sb) {
  const run = spawnSync(process.execPath, [join(REPO, "scripts", "dump-config.mjs"), "--profile", "w", "--json"], { cwd: sb.ws, env: sb.env, encoding: "utf8", timeout: 240_000 })
  let envelope = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  const text = envelope?.stdout ?? ""
  return { command: "node scripts/dump-config.mjs --profile w --json", exitCode: envelope?.exitCode ?? run.status, rows: sidebarRows(text), rowIds: sidebarRows(text).map((r) => r.id), composedText: text }
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
      } catch { /* starting */ }
    }
    result.booted = token !== null && cookie !== ""
    if (!result.booted) result.reason = "no token+cookie within " + BOOT_WAIT_MS + "ms"
    else {
      const html = await (await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(15_000) })).text()
      result.servedClientCarriesSidebar = html.includes(SIDEBAR + "/client.js")
      const route = await fetch(base + ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
      result.sidebarRoute = { status: route.status, body: (await route.text()).slice(0, 160) }
      result.sidebarRouteMounted = route.status !== 404
    }
  } catch (error) { result.reason = "probe threw: " + String(error?.message ?? error) }
  finally {
    const lines = readText(logPath).split("\n")
    result.signatures = { hits: FATAL.filter((m) => lines.join("\n").includes(m)), healthy: FATAL.every((m) => !lines.join("\n").includes(m)) }
    for (const line of lines) { const m = /mount guard:\s*(ENABLED|DISABLED)\s*-\s*(.*)$/.exec(line); if (m) { result.guard = result.guard ?? { decision: m[1], reason: m[2].trim() } } }
    result.guardLines = lines.filter((l) => l.includes("mount guard"))
    result.duplicateRouteLines = lines.filter((l) => l.includes("duplicate prefix route"))
    result.logTail = lines.filter(Boolean).slice(-6)
    try { child.kill("SIGTERM") } catch { /* gone */ }
    await sleep(2000)
    try { child.kill("SIGKILL") } catch { /* gone */ }
  }
  return result
}

const PROFILE_PATCH = [
  "# t5 R1-class fixture: the PROFILE's own patch layer mounts the sidebar host, exactly the shape",
  "# review round 1 named (the loader applies this AFTER every bundle layer).",
  "- insert:",
  "    - id: p1-profile-sidebar",
  "      name: 'dsh-better-sidebar'",
  "",
].join("\n")

async function runArm({ id, stripClause, port }) {
  const root = join(SB_ROOT, id)
  const sb = buildSandbox({ tag: id, bundleLink: join(root, "stage", stripClause ? "pre-repair" : "shipped-copy"), profilePatch: PROFILE_PATCH })
  const stage = stageBundleCopy(root, { stripClause })
  const patchAtStart = { sha256: sha256(join(REPO, PATCH_REL)), atUtc: utc(), of: stripClause ? stage.stagedPatchSha256 + " (staged " + (stripClause ? "pre-repair" : "copy") + ")" : "live file" }
  const composition = compose(sb)
  const load = await bootWeb(sb, port)
  const patchAtEnd = { sha256: sha256(join(REPO, PATCH_REL)), atUtc: utc() }
  const logDir = join(OUT, "logs")
  mkdirSync(logDir, { recursive: true })
  if (existsSync(load.logPath)) cpSync(load.logPath, join(logDir, id + ".boot.log"))
  if (composition.composedText) writeFileSync(join(logDir, id + ".composed.txt"), composition.composedText)
  const out = {
    id, kind: stripClause ? "PRE-REPAIR staged copy (patch-layer clause removed)" : "LIVE revision (repair present)",
    stage, profilePatch: PROFILE_PATCH, patchAtStart, patchAtEnd,
    livePatchMovedDuringArm: patchAtStart.sha256 !== patchAtEnd.sha256,
    composition: { ...composition, composedText: undefined }, load,
    evidence: { bootLog: join(logDir, id + ".boot.log"), composed: join(logDir, id + ".composed.txt") },
  }
  writeJson(join(OUT, "arms", id + ".json"), out)
  return out
}

async function main() {
  mkdirSync(join(OUT, "arms"), { recursive: true })
  if (process.argv.includes("--resummarize")) {
    // Re-derive the summary from the PERSISTED arms only — no reboot, so the frozen staged copy and
    // the measured live hash keep their meaning even after the tree moves.
    const p1 = JSON.parse(readFileSync(join(OUT, "arms", "P1-live-profile-patch-mounts-sidebar.json"), "utf8"))
    const p2 = JSON.parse(readFileSync(join(OUT, "arms", "P2-pre-repair-staged-copy.json"), "utf8"))
    const summary = JSON.parse(readFileSync(join(OUT, "summary.json"), "utf8"))
    summary.flagCorrection = {
      atUtc: utc(),
      reason: "the first summary compared signatures.hits (MARKER strings) against a key name; re-derived from the persisted arms without rebooting",
    }
    summary.P1 = { id: p1.id, kind: p1.kind, measuredPatchSha256: p1.patchAtStart.sha256, measuredFromUtc: p1.patchAtStart.atUtc, measuredToUtc: p1.patchAtEnd.atUtc, compositionRows: p1.composition.rowIds, guard: p1.load.guard, route: p1.load.sidebarRoute?.status ?? null, served: p1.load.servedClientCarriesSidebar ?? null, booted: p1.load.booted, fatalSignatureHits: p1.load.signatures.hits, duplicateRouteLines: p1.load.duplicateRouteLines }
    summary.P2 = { id: p2.id, kind: p2.kind, stagedPatchSha256: p2.stage.stagedPatchSha256, clauseRemoved: p2.stage.clauseRemoved, compositionRows: p2.composition.rowIds, guard: p2.load.guard, route: p2.load.sidebarRoute?.status ?? null, served: p2.load.servedClientCarriesSidebar ?? null, booted: p2.load.booted, fatalSignatureHits: p2.load.signatures.hits, duplicateRouteLines: p2.load.duplicateRouteLines }
    summary.boundaryProven = summary.P1.guard?.decision === "DISABLED" && summary.P1.fatalSignatureHits.length === 0 && summary.P1.booted === true
      && summary.P2.fatalSignatureHits.includes("duplicate prefix route") === true && summary.P2.booted === false
    writeJson(join(OUT, "summary.json"), summary)
    console.log(JSON.stringify({ resummarized: true, boundaryProven: summary.boundaryProven, P1: summary.P1, P2: summary.P2 }, null, 2))
    return
  }
  const started = utc()
  const p1 = await runArm({ id: "P1-live-profile-patch-mounts-sidebar", stripClause: false, port: 3600 })
  const p2 = await runArm({ id: "P2-pre-repair-staged-copy", stripClause: true, port: 3603 })
  const summary = {
    task: "t5 follow-up — R1 class (profile-level cordis.patch.yml supplies a sidebar row), controlled pair",
    startedAt: started, endedAt: utc(),
    livePatch: { sha256: sha256(join(REPO, PATCH_REL)), atUtc: utc() },
    P1: { id: p1.id, kind: p1.kind, compositionRows: p1.composition.rowIds, guard: p1.load.guard, route: p1.load.sidebarRoute?.status ?? null, served: p1.load.servedClientCarriesSidebar ?? null, booted: p1.load.booted, fatalSignatureHits: p1.load.signatures.hits, duplicateRouteLines: p1.load.duplicateRouteLines },
    P2: { id: p2.id, kind: p2.kind, stagedPatchSha256: p2.stage.stagedPatchSha256, clauseRemoved: p2.stage.clauseRemoved, compositionRows: p2.composition.rowIds, guard: p2.load.guard, route: p2.load.sidebarRoute?.status ?? null, served: p2.load.servedClientCarriesSidebar ?? null, booted: p2.load.booted, fatalSignatureHits: p2.load.signatures.hits, duplicateRouteLines: p2.load.duplicateRouteLines },
    livePatchMovedDuringArms: p1.livePatchMovedDuringArm || p2.livePatchMovedDuringArm,
    // NOTE: `signatures.hits` carries MARKER strings, not keys — the first version of this flag
    // compared against a key ("duplicatePrefixRoute") and therefore reported false although both
    // measured facts held. Corrected here and re-derived with `--resummarize` from the persisted
    // arm JSONs (no reboot): see flagCorrection in the summary.
    boundaryProven: p1.load.guard?.decision === "DISABLED" && p1.load.signatures.hits.length === 0 && p1.load.booted === true
      && p2.load.signatures.hits.includes("duplicate prefix route") === true && p2.load.booted === false,
  }
  writeJson(join(OUT, "summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => { console.error("t5-r1-f3 failed: " + String(error?.stack ?? error)); process.exit(1) })
