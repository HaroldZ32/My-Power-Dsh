#!/usr/bin/env node
// t14 ledger: proves the ROW-AWARE refinement of the other-layer scan (verification finding F1).
//
// Eleven REAL compositions, each an isolated sandbox (DSH_HOME + HOME + workspace cwd inside a
// mktemp root) with a real mounting boot:
//   * the two DECOYS the verification lane measured (evidence/install-deps/verification/20260920T034521Z):
//       decoy-comment-layer  — a foreign bundle layer whose patch only MENTIONS the package in a
//                              COMMENT and mounts nothing;
//       decoy-disabled-row   — a foreign bundle layer that INSERTS a row named dsh-better-sidebar
//                              with a LITERAL `disabled: true` (mounts nothing).
//     BEFORE the refinement our guard DISABLED itself on both (substring over raw text) and the
//     sidebar was silently never served. AFTER it must be ENABLED with the sidebar served once.
//   * every arm where a foreign ENABLED row really mounts the package (aggregate-first,
//     aggregate-after, profile-layer, home-layer, `--patch X`, `--patch=X`) must STILL be DISABLED
//     with the sidebar served exactly once and 0 fatal signatures.
//   * bundle-only (ENABLED + served), dsh-tui (DISABLED, no pending/failed), package-absent
//     (DISABLED, healthy boot, route 404).
//
// Usage: node evidence/install-deps/repair-f1/ledger.mjs [--only=<name,name>] [--label=<before|after>]
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed } from "../../../skills/dsh-qa/scripts/lib/workspace-isolation.mjs"
import { seedSandboxCredentials } from "../../../skills/dsh-qa/scripts/lib/credentials.mjs"
import { runTuiSession } from "../../../skills/dsh-qa/scripts/lib/tui-lane.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const label = (process.argv.find((arg) => arg.startsWith("--label=")) ?? "--label=unlabeled").slice(8)
const OUT = join(HERE, "runs", new Date().toISOString().replaceAll(":", "-") + "-" + label)
const BASE_BUNDLE = "@deepseek-ai/dsh-base"
const WEB_APP_BUNDLE = "@deepseek-ai/dsh-web-app"
const MPD_BUNDLE = "@mpd-dsh/mpd"
const TUI_BUNDLE = "@deepseek-harness-tui/dsh-tui"
const SIDEBAR = "dsh-better-sidebar"
const AGGREGATE = "@linxin666/dsh-web-all"
const REAL_WEB_NODE_MODULES = join(homedir(), ".dsh", "profiles", "web", "node_modules")
const REAL_TUI_NODE_MODULES = join(homedir(), ".dsh", "profiles", "dsh-tui", "node_modules")
const VERIFICATION_FIXTURES = join(REPO, "evidence", "install-deps", "verification", "20260920T034521Z", "fixtures")
const FATAL = ["duplicate prefix route", "plugin(s) failed to load", "did not activate", "pending (waiting for service", "failed to apply loader entry"]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const DECOY_FALLBACK = {
  "t5-decoy-comment": {
    "package.json": JSON.stringify({ name: "t5-decoy-comment", version: "0.0.1-t5", private: true, type: "module", main: "lib/index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 2) + "\n",
    "lib/index.js": "export {};\n",
    "cordis.patch.yml": "# t5 falsification fixture: this layer MOUNTS NOTHING. It merely mentions the package name\n# 'dsh-better-sidebar' in a comment, the way a documentation block would.\n- insert:\n    - id: t5-decoy-comment-row\n      name: '@deepseek-ai/cordis-plugin-timer'\n      disabled: true\n",
  },
  "t5-decoy-disabled": {
    "package.json": JSON.stringify({ name: "t5-decoy-disabled", version: "0.0.1-t5", private: true, type: "module", main: "lib/index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 2) + "\n",
    "lib/index.js": "export {};\n",
    "cordis.patch.yml": "# t5 falsification fixture: this layer inserts a row named dsh-better-sidebar that is\n# EXPLICITLY DISABLED, i.e. it mounts NOTHING.\n- insert:\n    - id: t5-decoy-disabled-row\n      name: 'dsh-better-sidebar'\n      disabled: true\n",
  },
}

/** Materialize the verifier's decoy fixture (copied when the artifact is present, else the same bytes). */
function ensureDecoyFixture(root, name) {
  const target = join(root, "fixtures", name)
  const source = join(VERIFICATION_FIXTURES, name)
  mkdirSync(target, { recursive: true })
  if (existsSync(source)) { cpSync(source, target, { recursive: true }); return { path: target, provenance: "copied from " + source.replace(REPO + "/", "") } }
  for (const [file, text] of Object.entries(DECOY_FALLBACK[name])) {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    writeFileSync(join(target, file), text)
  }
  return { path: target, provenance: "inline fallback (verification fixture not present)" }
}

function buildSandbox({ tag, profileName = "w", homeName = "dsh", bundles, mirrorAgg = false, mirrorTui = false, decoy = null }) {
  const root = mkdtempSync(join(tmpdir(), "mpd-f1-" + tag + "-"))
  const dshHome = join(root, homeName)
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", profileName)
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  const links = []
  if (decoy !== null) {
    const fixture = ensureDecoyFixture(root, decoy)
    const link = join(profile, "node_modules", decoy)
    symlinkSync(fixture.path, link, "dir")
    links.push({ name: decoy, path: link, provenance: fixture.provenance })
  }
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
  return { tag, root, dshHome, userHome, ws, profile, profileName, bundles, links, env: { ...process.env, DSH_HOME: dshHome, HOME: userHome } }
}

const unquote = (raw) => { const m = /^"([^"]*)"$|^'([^']*)'$/.exec(raw); return m === null ? raw : (m[1] ?? m[2]) }

function parseSidebarRows(composedText) {
  const rows = []
  for (const chunk of composedText.split(/^(?=- )/m)) {
    let bestName = null; let bestId = null; let bestDisabled = null
    for (const line of chunk.split("\n")) {
      const name = /^(?:- )?(\s*)name:\s*(.+)$/.exec(line)
      if (name !== null && (bestName === null || name[1].length < bestName.indent)) bestName = { indent: name[1].length, raw: name[2].trim() }
      const id = /^(?:- )?(\s*)id:\s*(.+)$/.exec(line)
      if (id !== null && (bestId === null || id[1].length < bestId.indent)) bestId = { indent: id[1].length, raw: id[2].trim() }
      const disabled = /^(?:- )?(\s*)disabled:\s*(.+)$/.exec(line)
      if (disabled !== null && (bestDisabled === null || disabled[1].length < bestDisabled.indent)) bestDisabled = { indent: disabled[1].length, raw: disabled[2].trim() }
    }
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
  return { claim: "COMPOSITION ONLY (scripts/dump-config.mjs)", exitCode: envelope?.exitCode ?? run.status, envelopeParsed: envelope !== null, sidebarRows: rows, literalEnabled: rows.filter((row) => row.enabled).map((row) => row.id) }
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
    child.kill("SIGTERM")
    await sleep(1500)
  }
}

function bootTui(sandbox) {
  const outDir = join(sandbox.root, "tui-out")
  mkdirSync(outDir, { recursive: true })
  const session = runTuiSession({ lane: "f1-tui", root: sandbox.root, outDir, steps: [], bootWaitMs: 90_000 })
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

const probeLayer = (id) => ["- insert:", "    - id: " + id, "      name: '" + SIDEBAR + "'", ""].join("\n")

const COMPOSITIONS = [
  { name: "bundle-only-web", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], expectDecision: "ENABLED", expectServed: true },
  { name: "aggregate-first", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, AGGREGATE, MPD_BUNDLE], mirrorAgg: true, expectDecision: "DISABLED", expectServed: true },
  { name: "aggregate-after", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE, AGGREGATE], mirrorAgg: true, expectDecision: "DISABLED", expectServed: true },
  { name: "profile-layer-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], profilePatch: probeLayer("user-sidebar-probe"), expectDecision: "DISABLED", expectServed: true },
  { name: "home-layer-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], homePatch: probeLayer("home-sidebar-probe"), expectDecision: "DISABLED", expectServed: true },
  { name: "overlay-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], overlay: probeLayer("overlay-sidebar-probe"), overlaySpelling: "--patch", expectDecision: "DISABLED", expectServed: true },
  { name: "overlay-equals-mount", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], overlay: probeLayer("overlay-eq-sidebar-probe"), overlaySpelling: "--patch=", expectDecision: "DISABLED", expectServed: true },
  { name: "decoy-comment-layer", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE, "t5-decoy-comment"], decoy: "t5-decoy-comment", expectDecision: "ENABLED", expectServed: true, isDecoy: true },
  { name: "decoy-disabled-row", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE, "t5-decoy-disabled"], decoy: "t5-decoy-disabled", expectDecision: "ENABLED", expectServed: true, isDecoy: true },
  { name: "dsh-tui", bundles: [BASE_BUNDLE, TUI_BUNDLE, MPD_BUNDLE], profileName: "dsh-tui", homeName: "dshhome", mirrorTui: true, tui: true, expectDecision: "DISABLED" },
  { name: "package-absent", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE], stage: true, expectDecision: "DISABLED", expectServed: false },
]

async function main() {
  const only = (process.argv.find((arg) => arg.startsWith("--only=")) ?? "").slice("--only=".length)
  const selected = only === "" ? COMPOSITIONS : COMPOSITIONS.filter((item) => only.split(",").includes(item.name))
  mkdirSync(OUT, { recursive: true })
  const results = []
  let port = 3441
  for (const spec of selected) {
    const sandbox = buildSandbox({ tag: spec.name, profileName: spec.profileName ?? "w", homeName: spec.homeName ?? "dsh", bundles: spec.bundles, mirrorAgg: spec.mirrorAgg === true, mirrorTui: spec.mirrorTui === true, decoy: spec.decoy ?? null })
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
      if (load.logPath !== undefined && existsSync(load.logPath)) {
        cpSync(load.logPath, join(OUT, spec.name + ".boot.log"))
        load.evidenceLog = spec.name + ".boot.log"
      }
      if (load.logFile !== undefined && existsSync(load.logFile)) {
        cpSync(load.logFile, join(OUT, spec.name + ".pane.log"))
        load.evidenceLog = spec.name + ".pane.log"
      }
      const served = load.servedSidebarClient === true
      const ok = composition.exitCode === 0 && composition.envelopeParsed
        && load.booted === true && load.fatalSignatures.length === 0 && load.guardDecision === spec.expectDecision
        && (spec.tui === true || served === spec.expectServed)
      results.push({ ...spec, composition, load, served, links: sandbox.links, isolation: assertSessionsSandboxed(sandbox.dshHome, sandbox.root, { label: spec.name }), ok })
      console.log("[" + spec.name + "] decision=" + load.guardDecision + " served=" + served + " fatal=" + JSON.stringify(load.fatalSignatures) + " ok=" + ok)
    } catch (error) {
      results.push({ ...spec, ok: false, error: String(error?.stack ?? error) })
      console.log("[" + spec.name + "] THREW " + String(error?.message ?? error))
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true })
    }
  }
  const ok = results.length > 0 && results.every((item) => item.ok === true)
  writeFileSync(join(OUT, "result.json"), JSON.stringify({
    case: "install-deps/repair-f1/ledger",
    label,
    ok,
    measuredAtUtc: new Date().toISOString(),
    guardTextSha256: (() => {
      // The guard body under test: the `!!js` scalar of the shipped row (read at run time, so the
      // BEFORE and AFTER runs are distinguishable by hash).
      try {
        const line = readFileSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8").split("\n").find((entry) => entry.includes("disabled: !!js "))
        return createHash("sha256").update(line.slice(line.indexOf("!!js ") + 5).trim()).digest("hex")
      } catch { return null }
    })(),
    compositions: results,
  }, null, 2) + "\n")
  console.log("[ledger] label=" + label + " ok=" + ok + " compositions=" + results.length + " -> " + OUT)
  if (!ok) process.exit(1)
}

await main()
