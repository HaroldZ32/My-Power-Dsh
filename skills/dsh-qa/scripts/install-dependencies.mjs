#!/usr/bin/env node
// Case install-dependencies: the permanent, falsifiable proof of the user clause
//   "installing the bundle must install every plugin it depends on — the sidebar must display".
//
// The defect this case pins: `dsh plugin --profile <p> add @mpd-dsh/mpd` left the profile
// without `dsh-better-sidebar`, the host plugin the bundle's shipped web GUI registers its
// two pages into (packages/mpd-bundle-plugin/src/web-client.js reaches `betterSidebar` with a
// runtime `ctx.inject`, so a missing host is SILENT: no page, no error). The fix declares the
// dependency in the bundle manifest (the harness then materializes it into
// `<profile>/node_modules` — measured: a symlink through `<profile>/.dsh-module-fallback`) and
// mounts it with ONE guarded loader row (`mpd-better-sidebar`, packages/mpd-bundle/cordis.patch.yml)
// whose guard is ORDER-INDEPENDENT (it reads declarations, not just the entry list).
//
// FIVE COMPOSITIONS, aggregate-free FIRST (that is the user's own composition):
//   1. bundle-only            -> exactly ONE enabled sidebar row, ACTIVE, its /sidebar/api route
//                                answering, its client bundle composed into the served client table
//   2. aggregate-first        -> the live aggregate @linxin666/dsh-web-all (UNGUARDED row
//                                web-ui-better-sidebar) mounts it FIRST: still exactly one mount
//   3. mpd-first-aggregate-after -> the ordering a forward-blind entry-list guard cannot see:
//                                still exactly one mount and a healthy boot
//   4. dsh-tui plane          -> the row is absent/disabled and the real TUI boot carries no
//                                `did not activate` / `pending (waiting for service` /
//                                `failed to apply loader entry`
//   5. package-absent         -> the declared dependency is NOT resolvable (staged bundle copy
//                                without node_modules): the boot still SUCCEEDS, degraded to no
//                                sidebar — a missing optional capability never takes a boot down
//
// CLAIM DISCIPLINE (AGENTS.md §4): the COMPOSITION claim is read from
// `scripts/dump-config.mjs` (rows composed, no plugin code executed) and the LOAD claim from a
// REAL mounting boot in an isolated sandbox; the two are asserted separately in result.json and
// never conflated. `--dump-config` is never cited as load evidence.
//
// WHY THE SANDBOX PROFILE IS BUILT BY HAND (measured, this environment):
// `dsh plugin add` runs pnpm, whose store index lives outside the workspace and whose registry
// requests time out here (ERR_SQLITE_ERROR / 70 s retries), so the case writes the profile
// itself — `profiles/<p>/package.json` with a `{"@mpd-dsh/mpd": "link:<repo>"}` dependency and
// `dsh.profile.bundles`, the standard `pnpm-workspace.yaml`, and the
// `node_modules/@mpd-dsh/mpd -> <repo>` symlink a checkout install IS. The recipe and its
// measurement are recorded in evidence/install-deps/red-baseline/20260920T030832Z/result.json;
// the repo's own cases (preset-conformance.mjs, lib/settings-bridge-lane.mjs) build theirs the
// same way. The harness's own module fallback then materializes the DECLARED dependency — that
// step is the install being tested, not a shortcut.
//
// PREREQ: absent-dsh-binary dsh --version npm i -g @deepseek-ai/dsh
// PREREQ: absent-fixture node_modules/dsh-better-sidebar/package.json bun install
//
// Evidence -> evidence/install-deps/qa-case/<timestamp>/{result.json,output.log,+ per-arm dumps/logs}.
// Isolation: every sandbox is a mktemp root with DSH_HOME + HOME + workspace cwd inside it, the
// real ~/.dsh / ~/.dsh-home is never read or written, and `assertSessionsSandboxed` proves no
// session-store key carries this checkout (AGENTS.md §7).
// --self-test is fully offline: no boot, no network, no dsh spawn.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed } from "./lib/workspace-isolation.mjs"
import { seedSandboxCredentials } from "./lib/credentials.mjs"
import { emitMarker, runTuiSession } from "./lib/tui-lane.mjs"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(dirname(HERE)))
const SLUG = "install-dependencies"
const LOG = []
const say = (line) => { LOG.push(line); console.log("[" + SLUG + "] " + line) }

const BASE_BUNDLE = "@deepseek-ai/dsh-base"
const WEB_APP_BUNDLE = "@deepseek-ai/dsh-web-app"
const MPD_BUNDLE = "@mpd-dsh/mpd"
const TUI_BUNDLE = "@deepseek-harness-tui/dsh-tui"
const SIDEBAR = "dsh-better-sidebar"
const AGGREGATE = "@linxin666/dsh-web-all"
const SIDEBAR_ROUTE = "/sidebar/api"
const REAL_WEB_NODE_MODULES = join(homedir(), ".dsh", "profiles", "web", "node_modules")
const REAL_TUI_NODE_MODULES = join(homedir(), ".dsh", "profiles", "dsh-tui", "node_modules")
const RED_BASELINE = "evidence/install-deps/red-baseline/20260920T030832Z/result.json"
const RED_BASELINE_COMPOSED = "evidence/install-deps/red-baseline/20260920T030832Z/composed-config.txt"
const BOOT_WAIT_MS = Number(process.env.MPD_QA_INSTALL_DEPS_BOOT_MS ?? 75_000)
const BASE_PORT = Number(process.env.MPD_QA_INSTALL_DEPS_PORT ?? 3371)
const STRICT = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

// F1..F4 of evidence/install-deps/requirements/requirements-and-inventory.md §4, plus the
// loader's own entry-apply failure: the harness symbols that must stay ABSENT on a healthy boot.
const APPLY_SIGNATURES = [
  { key: "entriesNotLoaded (F1, assertEntriesLoaded)", marker: "plugin(s) failed to load" },
  { key: "entryNotActivated (F2, assertEntriesActivated)", marker: "did not activate" },
  { key: "entryPending (F2)", marker: "pending (waiting for service" },
  { key: "entryApplyFailed (F3 host)", marker: "failed to apply loader entry" },
  { key: "duplicatePrefixRoute (F3)", marker: "duplicate prefix route" },
]
const TUI_SIGNATURES = ["did not activate", "pending (waiting for service", "failed to apply loader entry"]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

// ── pure predicates (shared by the real arms and the offline self-test) ───────────────────────

/** The shallower key value inside one composed row chunk; the row's OWN keys are the shallowest. */
function rowKey(chunk, key) {
  let best = null
  for (const line of chunk.split("\n")) {
    const match = new RegExp("^(?:- )?(\\s*)" + key + ":\\s*(.+)$").exec(line)
    if (match === null) continue
    if (best === null || match[1].length < best.indent) best = { indent: match[1].length, raw: match[2].trim() }
  }
  return best === null ? null : best.raw
}

const unquote = (raw) => {
  const match = /^"([^"]*)"$|^'([^']*)'$/.exec(raw)
  return match === null ? raw : (match[1] ?? match[2])
}

/**
 * Every row in a composed tree whose `name` is exactly dsh-better-sidebar, with its id and its
 * `disabled` key VERBATIM (the guard row composes as the raw `!!js` expression, the aggregate row
 * as no key at all). A row counts as ENABLED only when the key is absent or exactly `false`:
 * anything else — `true` or an unevaluated expression — is not an enabled mount.
 */
function parseSidebarRows(composedText) {
  const rows = []
  for (const chunk of composedText.split(/^(?=- )/m)) {
    const name = rowKey(chunk, "name")
    if (name === null || unquote(name) !== SIDEBAR) continue
    const id = rowKey(chunk, "id")
    const disabled = rowKey(chunk, "disabled")
    rows.push({
      id: id === null ? "(no id)" : unquote(id),
      disabledRaw: disabled,
      enabled: disabled === null || disabled === "false",
    })
  }
  return rows
}

/** Which fatal boot signatures the log carries (an empty hit list IS the health assertion). */
function scanSignatures(text, signatures = APPLY_SIGNATURES) {
  const hits = signatures.filter((entry) => text.includes(entry.marker))
  return { hits: hits.map((entry) => entry.key), markers: hits.map((entry) => entry.marker), healthy: hits.length === 0 }
}

/**
 * The sidebar's server half registers the prefix route /sidebar/api through
 * `ctx.webServer.register`; when the entry is NOT mounted the harness answers 404, when it IS
 * mounted the route exists and answers its own envelope (measured GET -> 405 method-error).
 */
const sidebarRouteMounted = (status) => status !== 404

/** The browser half is discovered from the loader entry: its client module lands in the served table. */
const servedClientCarriesSidebar = (html) => html.includes(SIDEBAR + "/client.js")

// ── sandbox machinery ────────────────────────────────────────────────────────────────────────

/**
 * The hand-built profile: `profiles/<name>/package.json` (link dependency + dsh.profile.bundles),
 * the standard pnpm-workspace.yaml, and the checkout-install symlink. `homeName` is `dsh` except
 * on the TUI arm, whose tmux lane expects `<root>/dshhome` (lib/tui-lane.mjs `sandboxEnv`).
 */
function buildSandbox({ tag, profileName = "w", homeName = "dsh", bundles, bundleLink = REPO, mirrorLinks = [] }) {
  const root = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-" + tag + "-"))
  const dshHome = join(root, homeName)
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", profileName)
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-" + profileName,
    private: true,
    dependencies: { [MPD_BUNDLE]: "link:" + bundleLink },
    dsh: { profile: { bundles } },
  }, null, 2) + "\n")
  writeFileSync(join(profile, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n")
  symlinkSync(bundleLink, join(profile, "node_modules", "@mpd-dsh", "mpd"), "junction")
  // Mirror-symlinked fixtures (the aggregate's scope, the TUI host): read-only links to packages
  // the REAL profiles already installed, never copies and never a substitute for the dependency
  // under test (which comes in through the bundle's own declaration + the harness fallback).
  for (const link of mirrorLinks) {
    const target = join(profile, "node_modules", link.to)
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target)) symlinkSync(link.from, target, "junction")
  }
  seedSandboxCredentials(dshHome)
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  return { tag, root, dshHome, userHome, ws, profile, profileName, bundles, env: { ...process.env, DSH_HOME: dshHome, HOME: userHome } }
}

/**
 * ARM 5's hermetic bundle: a stage directory whose `package.json` is a REAL file and whose other
 * top-level entries are symlinks into this checkout — but whose resolution chain has NO
 * node_modules, so the declared dependency cannot be materialized from anywhere. Without this the
 * checkout's own node_modules would satisfy the package through the bundle link and the
 * "not resolvable" composition could not be built.
 */
function stageBundleWithoutNodeModules(sandboxRoot) {
  const stage = join(sandboxRoot, "stage", "mpd")
  mkdirSync(stage, { recursive: true })
  for (const entry of readdirSync(REPO)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".qa-install-deps" || entry === "package.json") continue
    symlinkSync(join(REPO, entry), join(stage, entry), "junction")
  }
  cpSync(join(REPO, "package.json"), join(stage, "package.json"))
  return stage
}

/** The COMPOSITION claim: compose through the repo wrapper (T-69), read the envelope's stdout field. */
function composeViaWrapper(sandbox) {
  const args = [join(REPO, "scripts", "dump-config.mjs"), "--profile", sandbox.profileName, "--json"]
  const run = spawnSync(process.execPath, args, { cwd: sandbox.ws, env: sandbox.env, encoding: "utf8", timeout: 180_000 })
  let envelope = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  const text = envelope?.stdout ?? ""
  const rows = envelope === null ? [] : parseSidebarRows(text)
  return {
    claim: "COMPOSITION ONLY (scripts/dump-config.mjs -> the harness --dump-config composes rows and never executes plugin code, AGENTS.md §4)",
    command: "node scripts/dump-config.mjs --profile " + sandbox.profileName + " --json",
    exitCode: envelope?.exitCode ?? run.status,
    envelopeParsed: envelope !== null,
    composedText: text,
    sidebarRows: rows,
    stderrTail: (run.stderr ?? "").split("\n").filter(Boolean).slice(-3),
  }
}

/** The LOAD claim for the web plane: a REAL mounting boot, token-authorized, then two positives. */
async function bootWeb(sandbox, port) {
  const logPath = join(sandbox.root, "web-" + sandbox.tag + ".log")
  const fd = openSync(logPath, "w")
  const childSpec = dshCommand(["--profile", sandbox.profileName, "--port", String(port), "--no-open"], sandbox.env)
  if (childSpec === null) throw new Error(DSH_MISSING)
  const child = spawn(childSpec.command, childSpec.args, {
    env: sandbox.env, cwd: sandbox.ws, stdio: ["ignore", fd, fd],
  })
  const base = "http://127.0.0.1:" + port
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  const result = {
    claim: "REAL mounting boot (an isolated profile really boots and serves; never --dump-config)",
    bootCommand: "dsh --profile " + sandbox.profileName + " --port " + port + " --no-open",
    logPath, port, booted: false,
  }
  try {
    let token = null
    let cookie = ""
    const deadline = Date.now() + BOOT_WAIT_MS
    while (Date.now() < deadline) {
      await sleep(1200)
      const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
      if (match) token = match[1]
      if (token === null) continue
      try {
        const authorize = await fetch(base + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
        cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ")
        if (cookie !== "") break
      } catch { /* still starting */ }
    }
    result.booted = token !== null && cookie !== ""
    if (!result.booted) {
      result.reason = "the web boot never printed a token + set a session cookie within " + BOOT_WAIT_MS + "ms"
      return result
    }
    const index = await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
    const html = await index.text()
    result.indexStatus = index.status
    result.servedClientCarriesSidebar = servedClientCarriesSidebar(html)
    const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((match) => match[0]))]
    result.servedClientUrlCount = urls.length
    result.servedClientSample = (urls.find((url) => url.includes(SIDEBAR + "/client.js")) ?? urls[0] ?? "").slice(0, 200)
    const route = await fetch(base + SIDEBAR_ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
    result.sidebarRoute = { path: SIDEBAR_ROUTE, status: route.status, body: (await route.text()).slice(0, 120) }
    result.sidebarRouteMounted = sidebarRouteMounted(result.sidebarRoute.status)
    return result
  } catch (error) {
    result.reason = "boot/probe threw: " + String(error?.message ?? error)
    return result
  } finally {
    const text = readLog()
    result.signatures = scanSignatures(text)
    result.guardLines = text.split("\n").filter((line) => line.includes("mount guard") || line.includes("better-sidebar"))
    result.logTail = text.split("\n").filter(Boolean).slice(-6)
    child.kill("SIGTERM")
    await sleep(1500)
  }
}

/** The COMPOSITION claim could never see an `!!js` guard's verdict: the loader decides at load time. */
function guardDecision(lines) {
  for (const line of lines ?? []) {
    const match = /mount guard:\s*(ENABLED|DISABLED)/.exec(line)
    if (match !== null) return match[1]
  }
  return null
}

/** The LOAD claim for the dsh-tui plane: tmux lane boot (lib/tui-lane.mjs), pane + raw log scanned. */
function bootTui(sandbox, outDir) {
  const tuiOut = join(outDir, "tui-" + sandbox.tag)
  mkdirSync(tuiOut, { recursive: true })
  const session = runTuiSession({ lane: SLUG + "-" + sandbox.tag, root: sandbox.root, outDir: tuiOut, steps: [], bootWaitMs: 90_000 })
  const paneText = (session.panes[0]?.text ?? "") + "\n" + (session.log ?? "")
  const hits = TUI_SIGNATURES.filter((marker) => paneText.includes(marker))
  return {
    claim: "REAL dsh-tui mounting boot in tmux (lib/tui-lane.mjs), pane capture + raw terminal log",
    bootCommand: "dsh-tui (default profile, in tmux)",
    booted: session.failures.length === 0,
    failures: session.failures,
    signatures: { hits, markers: hits, healthy: hits.length === 0 },
    guardLines: paneText.split("\n").filter((line) => line.includes("mount guard") || line.includes("better-sidebar")),
    paneFile: session.panes[0]?.file ?? null,
    logFile: session.logFile,
  }
}

/** Both claims of one arm, kept as separate objects (never conflated), plus the arm verdict. */
function evaluateArm({ spec, composition, load, sandbox }) {
  const rows = composition.sidebarRows
  const literalEnabled = rows.filter((row) => row.enabled)
  composition.rowCount = rows.length
  composition.rowIds = rows.map((row) => row.id)
  composition.literalEnabledCount = literalEnabled.length
  composition.literalEnabledIds = literalEnabled.map((row) => row.id)
  composition.expectRowCountMin = spec.expectRowCountMin
  composition.expectRowCountMax = spec.expectRowCountMax
  composition.expectLiteralEnabledMax = spec.expectLiteralEnabledMax
  // The composition can only see a guarded row's raw `!!js` expression; whether it MOUNTS is the
  // LOAD claim's question. What composition must show: the row exists (at least once, no more than
  // the layers that declare it) and at most the layers OTHER than ours are literally enabled.
  composition.ok = composition.envelopeParsed && composition.exitCode === 0
    && rows.length >= spec.expectRowCountMin && rows.length <= spec.expectRowCountMax
    && literalEnabled.length <= spec.expectLiteralEnabledMax

  load.guardDecision = load.guardDecision ?? guardDecision(load.guardLines)
  if (spec.load === "tui") {
    load.expectSidebarServed = false
    load.ok = load.booted === true && load.signatures.healthy === true
  } else {
    load.expectSidebarServed = spec.expectSidebarServed
    const served = load.servedClientCarriesSidebar === true
    const mounted = load.sidebarRouteMounted === true
    load.servedClaim = {
      servedClientCarriesSidebar: served,
      sidebarRouteMounted: mounted,
      expectSidebarServed: spec.expectSidebarServed,
      activeEntryEvidence: served && mounted
        ? "the entry ACTIVATED: its route answers (" + SIDEBAR_ROUTE + " -> " + load.sidebarRoute.status + ") AND its browser bundle is composed into the served client table"
        : "no positive activation evidence",
    }
    load.ok = load.booted === true && load.signatures.healthy === true && served === spec.expectSidebarServed && mounted === spec.expectSidebarServed
  }
  const isolation = (() => {
    try { return { ok: true, ...assertSessionsSandboxed(sandbox.dshHome, sandbox.root, { label: SLUG + "/" + spec.name }) } }
    catch (error) { return { ok: false, error: String(error?.message ?? error) } }
  })()
  const realHomeUntouched = !sandbox.dshHome.startsWith(join(homedir(), ".dsh")) && !sandbox.userHome.startsWith(homedir())
  return { name: spec.name, order: spec.order, purpose: spec.purpose, ok: composition.ok && load.ok && isolation.ok && realHomeUntouched, composition, load, isolation, realHomeUntouched }
}

// ── the five-composition matrix (aggregate-free FIRST) ───────────────────────────────────────

const FIXTURES = {
  aggregate: {
    reason: "absent-harness-closure",
    probe: "<real web profile>/node_modules/@linxin666/dsh-web-all/package.json",
    remedy: "dsh plugin --profile web add @linxin666/dsh-web-all@0.3.20",
    present: () => existsSync(join(REAL_WEB_NODE_MODULES, "@linxin666", "dsh-web-all", "package.json")),
  },
  tui: {
    reason: "absent-harness-closure",
    probe: "<real dsh-tui profile>/node_modules/@deepseek-harness-tui/dsh-tui/package.json + tmux + dsh-tui",
    remedy: "dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@0.11.1",
    present: () => existsSync(join(REAL_TUI_NODE_MODULES, TUI_BUNDLE, "package.json"))
      && spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0
      && spawnSync("dsh-tui", ["--version"], { encoding: "utf8" }).status === 0,
  },
}

const ARMS = [
  {
    name: "bundle-only", order: 1, load: "web", fixture: null,
    purpose: "the user's own composition: the bundle alone on the web plane mounts exactly ONE sidebar host and really serves it (the reported symptom).",
    profileName: "w", homeName: "dsh",
    bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE],
    expectRowCountMin: 1, expectRowCountMax: 1, expectLiteralEnabledMax: 0, expectSidebarServed: true,
  },
  {
    name: "aggregate-first", order: 2, load: "web", fixture: "aggregate",
    purpose: "another bundle already mounts the sidebar and is installed FIRST (@linxin666/dsh-web-all, whose row web-ui-better-sidebar is UNGUARDED): still exactly one mount, healthy boot.",
    profileName: "w", homeName: "dsh",
    bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, AGGREGATE, MPD_BUNDLE],
    mirrorLinks: [{ from: join(REAL_WEB_NODE_MODULES, "@linxin666"), to: "@linxin666" }],
    expectRowCountMin: 1, expectRowCountMax: 2, expectLiteralEnabledMax: 1, expectSidebarServed: true,
  },
  {
    name: "mpd-first-aggregate-after", order: 3, load: "web", fixture: "aggregate",
    purpose: "the SAME aggregate installed AFTER this bundle — the ordering a forward-blind entry-list guard cannot see: still exactly one mount, healthy boot.",
    profileName: "w", homeName: "dsh",
    bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE, AGGREGATE],
    mirrorLinks: [{ from: join(REAL_WEB_NODE_MODULES, "@linxin666"), to: "@linxin666" }],
    expectRowCountMin: 1, expectRowCountMax: 2, expectLiteralEnabledMax: 1, expectSidebarServed: true,
  },
  {
    name: "tui-plane", order: 4, load: "tui", fixture: "tui",
    purpose: "the dsh-tui plane never provides webServer/webRuntime: the sidebar row must be absent/disabled and the real TUI boot must stay green.",
    profileName: "dsh-tui", homeName: "dshhome",
    bundles: [BASE_BUNDLE, TUI_BUNDLE, MPD_BUNDLE],
    mirrorLinks: [{ from: join(REAL_TUI_NODE_MODULES, "@deepseek-harness-tui"), to: "@deepseek-harness-tui" }],
    expectRowCountMin: 1, expectRowCountMax: 1, expectLiteralEnabledMax: 0, expectSidebarServed: false,
  },
  {
    name: "package-absent", order: 5, load: "web", fixture: null,
    purpose: "the declared dependency is NOT resolvable from the profile (staged bundle copy without node_modules): the boot still SUCCEEDS, degraded to no sidebar.",
    profileName: "w", homeName: "dsh",
    bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE],
    stage: true,
    expectRowCountMin: 1, expectRowCountMax: 1, expectLiteralEnabledMax: 0, expectSidebarServed: false,
  },
]

// ── offline self-test ────────────────────────────────────────────────────────────────────────

function selfTest() {
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message); return condition }

  // (1) the sidebar-row parser: 0 / 1 enabled / 1 disabled-expression / 2 rows / decoys.
  const noRows = "# == @deepseek-ai/dsh-base\n- id: timer\n  name: '@deepseek-ai/cordis-plugin-timer'\n"
  check(parseSidebarRows(noRows).length === 0, "a tree without the sidebar must parse to 0 rows")
  const aggregateRow = "- id: web-ui-better-sidebar\n  name: 'dsh-better-sidebar'\n  config:\n    name: dsh-better-sidebar\n"
  const onlyAggregate = parseSidebarRows(aggregateRow)
  check(onlyAggregate.length === 1 && onlyAggregate[0].enabled === true && onlyAggregate[0].id === "web-ui-better-sidebar",
    "the aggregate's unguarded row must parse to exactly one ENABLED row: " + JSON.stringify(onlyAggregate))
  const guardRow = "- id: mpd-better-sidebar\n  name: dsh-better-sidebar\n  disabled: !!js >-\n    (() => { return true })()\n"
  const guarded = parseSidebarRows(guardRow)
  check(guarded.length === 1 && guarded[0].enabled === false && guarded[0].disabledRaw === "!!js >-",
    "the guard row's raw !!js disabled expression must parse as NOT enabled: " + JSON.stringify(guarded))
  const both = parseSidebarRows(guardRow + aggregateRow)
  check(both.length === 2 && both.filter((row) => row.enabled).length === 1,
    "one guarded + one aggregate row must yield enabledCount 1: " + JSON.stringify(both))
  const decoy = "- id: other\n  name: 'dsh-better-sidebar-extra'\n"
  check(parseSidebarRows(decoy).length === 0, "a name that merely CONTAINS the package name must not match")
  const disabledFalse = "- id: x\n  name: 'dsh-better-sidebar'\n  disabled: false\n"
  check(parseSidebarRows(disabledFalse)[0].enabled === true, "disabled: false is an enabled row")

  // (2) the fatal-signature scanner: a healthy log is clean, each F1..F3 marker is detected.
  const healthyLog = "[mpd] loaded\ndsh web: http://127.0.0.1:1/?token=x\n"
  check(scanSignatures(healthyLog).healthy === true, "a healthy boot log must carry no signature")
  for (const entry of APPLY_SIGNATURES) {
    const hit = scanSignatures("prefix\n" + entry.marker + " suffix\n")
    check(hit.hits.length === 1 && hit.hits[0] === entry.key, "signature not detected: " + entry.marker)
  }
  check(scanSignatures("plugin(s) failed to load: dsh-better-sidebar").hits.length === 1, "F1 detection failed")

  // (3) the route verdict and the served-client predicate are both two-sided.
  check(sidebarRouteMounted(404) === false && sidebarRouteMounted(405) === true && sidebarRouteMounted(200) === true,
    "the route verdict must be false only on 404")
  check(servedClientCarriesSidebar("<script src=\"/plugins/??@mpd-dsh/mpd/client.js,dsh-better-sidebar/client.js&amp;rev=1\"></script>") === true,
    "the served client table must be detected in the index HTML")
  check(servedClientCarriesSidebar("<script src=\"/plugins/??@mpd-dsh/mpd/client.js\"></script>") === false,
    "an index without the sidebar client must NOT count as served")

  // (4) the sandbox recipe, offline: link dependency, bundle stack, sandboxed DSH_HOME/HOME/ws.
  const sandbox = buildSandbox({ tag: "selftest", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE] })
  try {
    const manifest = JSON.parse(readFileSync(join(sandbox.profile, "package.json"), "utf8"))
    check(manifest.dependencies?.[MPD_BUNDLE] === "link:" + REPO, "the profile must declare the bundle as a link dependency")
    check(JSON.stringify(manifest.dsh?.profile?.bundles) === JSON.stringify([BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE]),
      "the profile must carry the requested dsh.profile.bundles stack")
    check(existsSync(join(sandbox.profile, "node_modules", "@mpd-dsh", "mpd", "package.json")),
      "the checkout-install symlink node_modules/@mpd-dsh/mpd -> the repo must resolve")
    check(!sandbox.dshHome.startsWith(join(homedir(), ".dsh")) && !sandbox.userHome.startsWith(homedir()),
      "DSH_HOME/HOME must never point into the real home")
    check(sandbox.ws.startsWith(sandbox.root), "the boot workspace must live inside the sandbox")
    check(existsSync(join(sandbox.dshHome, ".credentials.yaml")), "the sandbox DSH_HOME must carry a credential store")
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }

  // (5) the ARM-5 stage is hermetic: a real package.json but no node_modules anywhere above it.
  const stageRoot = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-stage-selftest-"))
  try {
    const stage = stageBundleWithoutNodeModules(stageRoot)
    check(!existsSync(join(stage, "node_modules")), "the staged bundle must not carry node_modules")
    check(lstatSync(join(stage, "package.json")).isFile() && lstatSync(join(stage, "package.json")).isSymbolicLink() === false,
      "the staged package.json must be a REAL file (a symlink would resolve back into the checkout)")
    check(lstatSync(join(stage, "packages")).isSymbolicLink(), "the staged payload must stay symlinked to the checkout")
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
  }

  // (6) the RED anchor: the SAME composition predicate, run on the REAL pre-fix composition the
  // wave captured before the fix landed, must see ZERO sidebar rows — i.e. arm `bundle-only`
  // (`rows >= 1`) really could fail, and the case is not a predicate that can only answer one way.
  const redComposed = join(REPO, RED_BASELINE_COMPOSED)
  check(existsSync(redComposed), "the pre-fix composition artifact must ship with the wave: " + RED_BASELINE_COMPOSED)
  if (existsSync(redComposed)) {
    const redRows = parseSidebarRows(readFileSync(redComposed, "utf8"))
    check(redRows.length === 0, "the pre-fix composition must parse to ZERO sidebar rows (the RED anchor), got " + redRows.length)
    check(parseSidebarRows(readFileSync(redComposed, "utf8")).filter((row) => row.enabled).length < 1,
      "the pre-fix tree must not carry a literally enabled sidebar row")
  }

  // (7) the wiring this case depends on is asserted, not assumed: cases.json + SKILL.md.
  const casesPath = join(REPO, "skills", "dsh-qa", "cases.json")
  const registry = JSON.parse(readFileSync(casesPath, "utf8"))
  const entry = (registry.lanes ?? []).find((lane) => lane.case === SLUG)
  check(entry !== undefined, "cases.json must enumerate the " + SLUG + " lane")
  if (entry !== undefined) {
    check(entry.script === "skills/dsh-qa/scripts/" + SLUG + ".mjs", "cases.json must point at this script")
    check(typeof entry.immutabilityGuard === "string" && entry.immutabilityGuard.length > 0, "cases.json must declare an immutabilityGuard")
    check(Array.isArray(entry.suites) && entry.suites.includes("all"), "the lane must be part of the `all` suite")
  }
  const skill = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(new RegExp("^\\|\\s*" + SLUG + "\\s*\\|", "m").test(skill), "SKILL.md must carry the " + SLUG + " case row")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL:")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: sidebar-row parsing (0/1/2 rows, raw !!js guard, decoys), F1-F3 signature scanning, two-sided route + served-client verdicts, the hand-built profile recipe, the hermetic ARM-5 stage, the pre-fix RED anchor and the cases.json/SKILL.md wiring are verified offline")
}

// ── the real five-composition run ────────────────────────────────────────────────────────────

const LANE_PREREQS = [
  {
    code: "absent-dsh-binary", probe: "dsh --version", remedy: "npm i -g @deepseek-ai/dsh",
    present: () => resolveDshLauncher() !== "",
  },
  {
    code: "absent-fixture", probe: "node_modules/" + SIDEBAR + "/package.json",
    remedy: "bun install (the sandbox recipe needs the declared dependency materialized in the checkout)",
    present: () => existsSync(join(REPO, "node_modules", SIDEBAR, "package.json")),
  },
]

function gateLanePrereqs() {
  for (const prereq of LANE_PREREQS) {
    if (prereq.present()) continue
    emitMarker(STRICT ? "FAIL" : "SKIP", SLUG, prereq.code, prereq.probe, prereq.remedy)
    process.exit(STRICT ? 1 : 0)
  }
}

async function runReal() {
  gateLanePrereqs()
  const only = (process.argv.find((arg) => arg.startsWith("--only=")) ?? "").slice("--only=".length)
  const selected = only === "" ? ARMS : ARMS.filter((spec) => only.split(",").includes(spec.name))
  if (selected.length === 0) { console.error("[" + SLUG + "] --only matched no arm: " + only); process.exit(1) }
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(REPO, "evidence", "install-deps", "qa-case", stamp)
  mkdirSync(outDir, { recursive: true })
  const arms = []
  const skippedArms = []
  let port = BASE_PORT

  for (const spec of selected) {
    const fixture = spec.fixture === null ? null : FIXTURES[spec.fixture]
    if (fixture !== null && !fixture.present()) {
      skippedArms.push({ name: spec.name, order: spec.order, reason: fixture.reason, probe: fixture.probe, remedy: fixture.remedy })
      say("SKIP arm " + spec.name + " (" + fixture.reason + "): " + fixture.probe)
      continue
    }
    say("arm " + spec.name + " (composition " + spec.order + ") bundles=" + JSON.stringify(spec.bundles))
    const sandbox = buildSandbox({ tag: spec.name, profileName: spec.profileName, homeName: spec.homeName, bundles: spec.bundles, bundleLink: spec.stage === true ? undefined : REPO, mirrorLinks: spec.mirrorLinks ?? [] })
    if (spec.stage === true) {
      const stage = stageBundleWithoutNodeModules(sandbox.root)
      const manifestPath = join(sandbox.profile, "node_modules", "@mpd-dsh", "mpd")
      rmSync(manifestPath, { recursive: true, force: true })
      symlinkSync(stage, manifestPath, "junction")
      const profileManifest = JSON.parse(readFileSync(join(sandbox.profile, "package.json"), "utf8"))
      profileManifest.dependencies[MPD_BUNDLE] = "link:" + stage
      writeFileSync(join(sandbox.profile, "package.json"), JSON.stringify(profileManifest, null, 2) + "\n")
    }
    let arm
    try {
      const composition = composeViaWrapper(sandbox)
      writeFileSync(join(outDir, "dump-" + spec.name + ".txt"), composition.composedText)
      composition.evidenceArtifact = "dump-" + spec.name + ".txt"
      composition.composedBytes = composition.composedText.length
      delete composition.composedText
      say("  composition: exit=" + composition.exitCode + " sidebarRows=" + JSON.stringify(composition.sidebarRows))
      const load = spec.load === "tui" ? bootTui(sandbox, outDir) : await bootWeb(sandbox, port++)
      if (spec.load === "tui") load.evidenceLog = "tui-" + spec.name + "/tui-pane.log"
      if (load.logPath !== undefined && existsSync(load.logPath)) {
        cpSync(load.logPath, join(outDir, "boot-" + spec.name + ".log"))
        load.evidenceLog = "boot-" + spec.name + ".log"
      }
      say("  load: " + (spec.load === "tui"
        ? "booted=" + load.booted + " signatures=" + JSON.stringify(load.signatures.hits) + " failures=" + JSON.stringify(load.failures)
        : "booted=" + load.booted + " signatures=" + JSON.stringify(load.signatures?.hits ?? null)
          + " route=" + (load.sidebarRoute?.status ?? "-") + " servedSidebarClient=" + load.servedClientCarriesSidebar))
      if (load.guardLines?.length > 0) say("  guard: " + JSON.stringify(load.guardLines[0]))
      arm = evaluateArm({ spec, composition, load, sandbox })
    } catch (error) {
      arm = { name: spec.name, order: spec.order, purpose: spec.purpose, ok: false, error: String(error?.stack ?? error) }
      say("  arm THREW: " + String(error?.message ?? error))
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true })
    }
    arms.push(arm)
    say("arm " + spec.name + " -> " + (arm.ok ? "PASS" : "FAIL"))
  }

  const ran = arms.length
  const ok = ran > 0 && arms.every((arm) => arm.ok === true)
  const sourceHashes = {
    measuredAtUtc: new Date().toISOString(),
    "packages/mpd-bundle/cordis.patch.yml": sha256(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml")),
    "package.json": sha256(join(REPO, "package.json")),
    ["skills/dsh-qa/scripts/" + SLUG + ".mjs"]: sha256(fileURLToPath(import.meta.url)),
  }
  const result = {
    case: SLUG,
    ok,
    checkedAt: stamp,
    repoRoot: REPO,
    claims: {
      composition: "--dump-config via scripts/dump-config.mjs: rows composed, no plugin code executed (AGENTS.md §4). NEVER cited as load evidence.",
      load: "a REAL mounting boot in a hand-built isolated profile (web: HTTP token + served index + the sidebar route; tui: a tmux dsh-tui boot) for every arm.",
    },
    installRecipe: {
      why: "the sandbox cannot run `dsh plugin add`: pnpm's store index lives outside the workspace (ERR_SQLITE_ERROR) and its registry requests time out here. The case writes profiles/<p>/package.json (link dependency + dsh.profile.bundles), pnpm-workspace.yaml and the node_modules/@mpd-dsh/mpd symlink instead — the shape a checkout install IS; the harness's own module fallback then materializes the DECLARED dependency, which is the install step under test.",
      redBaseline: RED_BASELINE,
      steps: [
        "mkdir -p <root>/dsh/profiles/<p>/node_modules/@mpd-dsh <root>/home <root>/ws",
        "package.json: dependencies {'@mpd-dsh/mpd': 'link:<repo>'} + dsh.profile.bundles = the arm's stack",
        "pnpm-workspace.yaml: packages ['.'] / nodeLinker: hoisted / autoInstallPeers: false",
        "ln -s <repo> <root>/dsh/profiles/<p>/node_modules/@mpd-dsh/mpd",
        "seed <root>/dsh/.credentials.yaml + settings.yaml (a boot without them dies MISSING_CREDENTIAL)",
        "DSH_HOME=<root>/dsh HOME=<root>/home dsh --profile <p> ... with cwd <root>/ws",
      ],
    },
    arms,
    skippedArms,
    ranArms: ran,
    redDemonstration: {
      artifact: RED_BASELINE_COMPOSED,
      result: RED_BASELINE,
      claim: "the SAME composition predicate run on the REAL pre-fix composition captured before the fix landed parses ZERO sidebar rows, so arm `bundle-only` (rows >= 1, then a mounted + served host) was RED before the row existed; the self-test re-asserts that parse on every offline run.",
      sidebarRowsAtRedBaseline: existsSync(join(REPO, RED_BASELINE_COMPOSED)) ? parseSidebarRows(readFileSync(join(REPO, RED_BASELINE_COMPOSED), "utf8")).length : null,
    },
    sourceHashes,
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), LOG.join("\n") + "\n")
  console.log("[" + SLUG + "] ok=" + ok + " arms=" + arms.length + " skipped=" + skippedArms.length + " -> " + outDir)
  if (skippedArms.length > 0) console.log("[" + SLUG + "] skipped arms: " + skippedArms.map((arm) => arm.name + " (" + arm.reason + ")").join(", "))
  if (!ok) process.exit(1)
  console.log("[" + SLUG + "] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else await runReal()
