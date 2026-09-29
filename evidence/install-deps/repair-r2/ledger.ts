#!/usr/bin/env node
// t11 boot ledger: nine REAL compositions, each booted in an isolated sandbox
// (DSH_HOME + HOME + workspace cwd all inside a mktemp root), recording the guard's
// decision line and the fatal-signature count for every one of them.
//
// The point of the ledger is the R1 class: a sidebar row living in a patch layer the
// loader composes BEYOND the declared bundles — <profileDir>/cordis.patch.yml,
// $DSH_HOME/cordis.patch.yml and the --patch overlays (both spellings). With the
// pre-repair guard those compositions died with
//   webserver: duplicate prefix route "/sidebar/api"
// (captain's repro: evidence/install-deps/captain-cross-check/20260920T034916Z-f3-repro/).
// With the repaired guard this bundle's row DISABLES and exactly one mount remains.
//
// Composition claim (scripts/dump-config.mjs: rows composed, no plugin code executed) and
// load claim (a real mounting boot + HTTP) are recorded separately, per composition.
//
// Usage: node evidence/install-deps/repair-r2/ledger.mjs [--only=<name,name>]
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed } from "../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { seedSandboxCredentials } from "../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { runTuiSession } from "../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const OUT = join(HERE, "runs", new Date().toISOString().replaceAll(":", "-"))
const BASE_BUNDLE = "@deepseek-ai/dsh-base"
const WEB_APP_BUNDLE = "@deepseek-ai/dsh-web-app"
const MPD_BUNDLE = "@mpd-dsh/mpd"
const TUI_BUNDLE = "@deepseek-harness-tui/dsh-tui"
const SIDEBAR = "dsh-better-sidebar"
const AGGREGATE = "@linxin666/dsh-web-all"
const REAL_WEB_NODE_MODULES = join(homedir(), ".dsh", "profiles", "web", "node_modules")
const REAL_TUI_NODE_MODULES = join(homedir(), ".dsh", "profiles", "dsh-tui", "node_modules")
const FATAL = ["duplicate prefix route", "plugin(s) failed to load", "did not activate", "pending (waiting for service", "failed to apply loader entry"]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const PATCH_FILE = join(REPO, "packages", "mpd-bundle", "cordis.patch.yml")

/** A probe overlay/layer: an UNGUARDED sidebar row under a foreign id (never our id). */
const probeLayer = (id) => ["- insert:", "    - id: " + id, "      name: '" + SIDEBAR + "'", ""].join("\n")

function buildSandbox({ tag, profileName = "w", homeName = "dsh", bundles, mirrorAgg = false, mirrorTui = false }) {
  const root = mkdtempSync(join(tmpdir(), "mpd-r2-" + tag + "-"))
  const dshHome = join(root, homeName)
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", profileName)
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-" + profileName, private: true,
    dependencies: { [MPD_BUNDLE]: "link:" + REPO },
    dsh: { profile: { bundles } },
  }, null, 2) + "\n")
  writeFileSync(join(profile, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n")
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  if (mirrorAgg && existsSync(join(REAL_WEB_NODE_MODULES, "@linxin666"))) symlinkSync(join(REAL_WEB_NODE_MODULES, "@linxin666"), join(profile, "node_modules", "@linxin666"), "dir")
  if (mirrorTui && existsSync(join(REAL_TUI_NODE_MODULES, "@deepseek-harness-tui"))) symlinkSync(join(REAL_TUI_NODE_MODULES, "@deepseek-harness-tui"), join(profile, "node_modules", "@deepseek-harness-tui"), "dir")
  seedSandboxCredentials(dshHome)
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  return { tag, root, dshHome, userHome, ws, profile, profileName, bundles, env: { ...process.env, DSH_HOME: dshHome, HOME: userHome } }
}

function parseSidebarRows(composedText) {
  const rows = []
  for (const chunk of composedText.split(/^(?=- )/m)) {
    let bestName = null
    let bestId = null
    let bestDisabled = null
    for (const line of chunk.split("\n")) {
      const name = /^(?:- )?(\s*)name:\s*(.+)$/.exec(line)
      if (name !== null && (bestName === null || name[1].length < bestName.indent)) bestName = { indent: name[1].length, raw: name[2].trim() }
      const id = /^(?:- )?(\s*)id:\s*(.+)$/.exec(line)
      if (id !== null && (bestId === null || id[1].length < bestId.indent)) bestId = { indent: id[1].length, raw: id[2].trim() }
      const disabled = /^(?:- )?(\s*)disabled:\s*(.+)$/.exec(line)
      if (disabled !== null && (bestDisabled === null || disabled[1].length < bestDisabled.indent)) bestDisabled = { indent: disabled[1].length, raw: disabled[2].trim() }
    }
    const unquote = (raw) => { const m = /^"([^"]*)"$|^'([^']*)'$/.exec(raw); return m === null ? raw : (m[1] ?? m[2]) }
    if (bestName === null || unquote(bestName.raw) !== SIDEBAR) continue
    rows.push({ id: bestId === null ? "(no id)" : unquote(bestId.raw), disabledRaw: bestDisabled === null ? null : bestDisabled.raw, enabled: bestDisabled === null || bestDisabled.raw === "false" })
  }
  return rows
}

function compose(sandbox, extraArgs = []) {
  const argv = [join(REPO, "scripts", "dump-config.mjs"), "--profile", sandbox.profileName, "--json"]
  if (extraArgs.length > 0) argv.push("--", ...extraArgs)
  const run = spawnSync(process.execPath, argv, { cwd: sandbox.ws, env: sandbox.env, encoding: "utf8", timeout: 180_000 })
  let envelope = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  const text = envelope?.stdout ?? ""
  const rows = envelope === null ? [] : parseSidebarRows(text)
  return {
    claim: "COMPOSITION ONLY (scripts/dump-config.mjs; never load evidence)",
    command: argv.slice(1).join(" "),
    exitCode: envelope?.exitCode ?? run.status,
    envelopeParsed: envelope !== null,
    sidebarRows: rows,
    literalEnabled: rows.filter((row) => row.enabled).map((row) => row.id),
  }
}

async function bootWeb(sandbox, port, extraArgs = []) {
  const logPath = join(sandbox.root, "web.log")
  const fd = openSync(logPath, "w")
  const args = ["--profile", sandbox.profileName, ...extraArgs, "--port", String(port), "--no-open"]
  const child = spawn("dsh", args, { env: sandbox.env, cwd: sandbox.ws, stdio: ["ignore", fd, fd] })
  const read = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  const base = "http://127.0.0.1:" + port
  const result = { claim: "REAL mounting boot + HTTP", bootCommand: "dsh " + args.join(" "), logPath, port }
  try {
    let token = null
    let cookie = ""
    const deadline = Date.now() + 75_000
    while (Date.now() < deadline) {
      await sleep(1200)
      const match = /token=([A-Za-z0-9_-]+)/.exec(read())
      if (match) token = match[1]
      if (token === null) continue
      try {
        const authorize = await fetch(base + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
        cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ")
        if (cookie !== "") break
      } catch { /* still starting */ }
    }
    result.booted = token !== null && cookie !== ""
    if (!result.booted) { result.reason = "no token + cookie within 75s"; return result }
    const html = await (await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(10_000) })).text()
    result.servedSidebarClient = html.includes(SIDEBAR + "/client.js")
    const route = await fetch(base + "/sidebar/api", { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
    result.sidebarRoute = { status: route.status, body: (await route.text()).slice(0, 80) }
    return result
  } catch (error) {
    result.reason = "boot/probe threw: " + String(error?.message ?? error)
    return result
  } finally {
    const text = read()
    result.guardLines = text.split("\n").filter((line) => line.includes("mount guard"))
    result.guardDecision = (/mount guard:\s*(ENABLED|DISABLED)/.exec(result.guardLines.join("\n") ?? "") ?? [])[1] ?? null
    result.fatalSignatures = FATAL.filter((marker) => text.includes(marker))
    result.logTail = text.split("\n").filter(Boolean).slice(-4)
    child.kill("SIGTERM")
    await sleep(1500)
  }
}

function bootTui(sandbox) {
  const outDir = join(sandbox.root, "tui-out")
  mkdirSync(outDir, { recursive: true })
  const session = runTuiSession({ lane: "r2-tui", root: sandbox.root, outDir, steps: [], bootWaitMs: 90_000 })
  const pane = (session.panes[0]?.text ?? "") + "\n" + (session.log ?? "")
  return {
    claim: "REAL dsh-tui mounting boot in tmux",
    booted: session.failures.length === 0,
    failures: session.failures,
    guardLines: pane.split("\n").filter((line) => line.includes("mount guard")),
    guardDecision: (/mount guard:\s*(ENABLED|DISABLED)/.exec(pane) ?? [])[1] ?? null,
    fatalSignatures: ["did not activate", "pending (waiting for service", "failed to apply loader entry"].filter((marker) => pane.includes(marker)),
  }
}

function stageBundle(root) {
  const stage = join(root, "stage", "mpd")
  mkdirSync(stage, { recursive: true })
  for (const entry of readdirSync(REPO)) {
    if (["node_modules", ".git", ".qa-install-deps", "package.json"].includes(entry)) continue
    symlinkSync(join(REPO, entry), join(stage, entry))
  }
  cpSync(join(REPO, "package.json"), join(stage, "package.json"))
  return stage
}

const COMPOSITIONS = [
  { name: "bundle-only-web", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], expectDecision: "ENABLED", expectServed: true },
  { name: "aggregate-first", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, AGGREGATE, MPD_BUNDLE], mirrorAgg: true, expectDecision: "DISABLED", expectServed: true },
  { name: "aggregate-after", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE, AGGREGATE], mirrorAgg: true, expectDecision: "DISABLED", expectServed: true },
  { name: "profile-layer-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], profilePatch: probeLayer("user-sidebar-probe"), expectDecision: "DISABLED", expectServed: true, fatalMode: "F3 (profile patch layer)" },
  { name: "home-layer-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], homePatch: probeLayer("home-sidebar-probe"), expectDecision: "DISABLED", expectServed: true, fatalMode: "F3 (home patch layer)" },
  { name: "overlay-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], overlay: probeLayer("overlay-sidebar-probe"), overlaySpelling: "--patch", expectDecision: "DISABLED", expectServed: true, fatalMode: "F3 (--patch overlay)" },
  { name: "overlay-equals-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], overlay: probeLayer("overlay-eq-sidebar-probe"), overlaySpelling: "--patch=", expectDecision: "DISABLED", expectServed: true, fatalMode: "F3 (--patch= overlay)" },
  { name: "dsh-tui", bundles: [BASE_BUNDLE, TUI_BUNDLE, MPD_BUNDLE], profileName: "dsh-tui", homeName: "dshhome", mirrorTui: true, tui: true, expectDecision: "DISABLED", fatalMode: "F2 (non-web plane)" },
  { name: "package-absent", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], stage: true, expectDecision: "DISABLED", expectServed: false, fatalMode: "F1 (unresolvable)" },
]

async function main() {
  const only = (process.argv.find((arg) => arg.startsWith("--only=")) ?? "").slice("--only=".length)
  const selected = only === "" ? COMPOSITIONS : COMPOSITIONS.filter((item) => only.split(",").includes(item.name))
  mkdirSync(OUT, { recursive: true })
  const results = []
  let port = 3411
  for (const spec of selected) {
    const sandbox = buildSandbox({ tag: spec.name, profileName: spec.profileName ?? "w", homeName: spec.homeName ?? "dsh", bundles: spec.bundles, mirrorAgg: spec.mirrorAgg === true, mirrorTui: spec.mirrorTui === true })
    let extraArgs = []
    try {
      if (spec.profilePatch !== undefined) writeFileSync(join(sandbox.profile, "cordis.patch.yml"), spec.profilePatch)
      if (spec.homePatch !== undefined) writeFileSync(join(sandbox.dshHome, "cordis.patch.yml"), spec.homePatch)
      if (spec.overlay !== undefined) {
        const overlayPath = join(sandbox.root, "overlay.yml")
        writeFileSync(overlayPath, spec.overlay)
        extraArgs = spec.overlaySpelling === "--patch=" ? ["--patch=" + overlayPath] : ["--patch", overlayPath]
      }
      if (spec.stage === true) {
        const stage = stageBundle(sandbox.root)
        const link = join(sandbox.profile, "node_modules", "@mpd-dsh", "mpd")
        rmSync(link, { recursive: true, force: true })
        symlinkSync(stage, link, "dir")
        const manifest = JSON.parse(readFileSync(join(sandbox.profile, "package.json"), "utf8"))
        manifest.dependencies[MPD_BUNDLE] = "link:" + stage
        writeFileSync(join(sandbox.profile, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
      }
      const composition = compose(sandbox, extraArgs)
      const load = spec.tui === true ? bootTui(sandbox) : await bootWeb(sandbox, port++, extraArgs)
      const served = load.servedSidebarClient === true
      const ok = composition.exitCode === 0 && composition.envelopeParsed
        && load.booted === true && load.fatalSignatures.length === 0 && load.guardDecision === spec.expectDecision
        && (spec.tui === true || served === spec.expectServed)
      results.push({ ...spec, composition, load, served, isolation: assertSessionsSandboxed(sandbox.dshHome, sandbox.root, { label: spec.name }), ok })
      console.log("[" + spec.name + "] decision=" + load.guardDecision + " fatal=" + JSON.stringify(load.fatalSignatures) + " served=" + served + " ok=" + ok)
    } catch (error) {
      results.push({ ...spec, ok: false, error: String(error?.stack ?? error) })
      console.log("[" + spec.name + "] THREW " + String(error?.message ?? error))
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true })
    }
  }
  const ok = results.length > 0 && results.every((item) => item.ok === true)
  writeFileSync(join(OUT, "result.json"), JSON.stringify({
    case: "install-deps/repair-r2/ledger",
    ok,
    guardBodySha256: sha256(join(HERE, "guard.source.txt")),
    patchSha256AtMeasurement: sha256(PATCH_FILE),
    measuredAtUtc: new Date().toISOString(),
    compositions: results,
  }, null, 2) + "\n")
  console.log("[ledger] ok=" + ok + " compositions=" + results.length + " -> " + OUT)
  if (!ok) process.exit(1)
}

await main()
