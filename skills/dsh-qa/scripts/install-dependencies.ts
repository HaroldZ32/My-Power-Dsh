#!/usr/bin/env node
// Case install-dependencies: the permanent, falsifiable proof of the user clause
//   "installing the bundle must install every plugin it depends on — the sidebar must display".
//
// The defect this case pins: `dsh plugin --profile <p> add @mpd-dsh/mpd` left the profile
// without `dsh-better-sidebar`, the host plugin the bundle's shipped web GUI registers its
// two pages into (packages/mpd-bundle-plugin/src/web-client.ts reaches `betterSidebar` with a
// runtime `ctx.inject`, so a missing host is SILENT: no page, no error). The fix declares the
// dependency in the bundle manifest (the harness then materializes it into
// `<profile>/node_modules` — measured: a symlink through `<profile>/.dsh-module-fallback`) and
// mounts it with ONE guarded loader row (`mpd-better-sidebar`, cordis.patch.yml)
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
// `scripts/dump-config.ts` (rows composed, no plugin code executed) and the LOAD claim from a
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
// the repo's own cases (preset-conformance.ts, lib/settings-bridge-lane.ts) build theirs the
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
import { assertSessionsSandboxed } from "./lib/workspace-isolation.ts"
import type { SessionSandboxVerdict } from "./lib/workspace-isolation.ts"
import { seedSandboxCredentials } from "./lib/credentials.ts"
import { emitMarker, runTuiSession } from "./lib/tui-lane.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"

/** The directory holding this script, from which the repository root is derived. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** The repository root: this script lives at `<root>/skills/dsh-qa/scripts/`, three levels down. */
const REPO: string = dirname(dirname(dirname(HERE)))
/** The case slug, used in every marker line, log prefix and evidence path. */
const SLUG: string = "install-dependencies"
/** The run's accumulated log lines, written verbatim to `output.log` at the end of a real run. */
const LOG: string[] = []
/** Echo one line to stdout AND keep it for `output.log`, prefixed with the case slug. */
const say = (line: string): void => { LOG.push(line); console.log("[" + SLUG + "] " + line) }

/** The harness base bundle every arm mounts first. */
const BASE_BUNDLE: string = "@deepseek-ai/dsh-base"
/** The harness web-app bundle, the only row set that provides `webServer`/`webRuntime`. */
const WEB_APP_BUNDLE: string = "@deepseek-ai/dsh-web-app"
/** This repository's own bundle — the install under test. */
const MPD_BUNDLE: string = "@mpd-dsh/mpd"
/** The third-party TUI bundle whose plane deliberately lacks the web services. */
const TUI_BUNDLE: string = "@deepseek-harness-tui/dsh-tui"
/** The host plugin the bundle must depend on and mount: the GUI's two pages need it at runtime. */
const SIDEBAR: string = "dsh-better-sidebar"
/** A real aggregate bundle whose own sidebar row is UNGUARDED — the ordering near-miss. */
const AGGREGATE: string = "@linxin666/dsh-web-all"
/** The sidebar host's server-side prefix route: 404 proves the entry never mounted. */
const SIDEBAR_ROUTE: string = "/sidebar/api"
/** Where the REAL web profile installs packages — probed for the fixture, never written. */
const REAL_WEB_NODE_MODULES: string = join(homedir(), ".dsh", "profiles", "web", "node_modules")
/** Where the REAL dsh-tui profile installs packages — probed for the fixture, never written. */
const REAL_TUI_NODE_MODULES: string = join(homedir(), ".dsh", "profiles", "dsh-tui", "node_modules")
/** The pre-fix RED anchor: the result record the wave captured before the guard row existed. */
const RED_BASELINE: string = "evidence/install-deps/red-baseline/20260920T030832Z/result.json"
/** The pre-fix composition dump the RED predicate is re-run against on every offline run. */
const RED_BASELINE_COMPOSED: string = "evidence/install-deps/red-baseline/20260920T030832Z/composed-config.txt"
/** How long one web arm may take to print its token and set a cookie, in milliseconds. */
const BOOT_WAIT_MS: number = Number(process.env.MPD_QA_INSTALL_DEPS_BOOT_MS ?? 75_000)
/** The first HTTP port an arm may bind; each later arm takes the next port in the matrix. */
const BASE_PORT: number = Number(process.env.MPD_QA_INSTALL_DEPS_PORT ?? 3371)
/** `--no-skip` / `--require-pack`: an absent prerequisite FAILS the lane instead of skipping it. */
const STRICT: boolean = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

// F1..F4 of evidence/install-deps/requirements/requirements-and-inventory.md §4, plus the
// loader's own entry-apply failure: the harness symbols that must stay ABSENT on a healthy boot.
/** One fatal loader symbol a healthy boot must never print. */
interface ApplySignature {
  /** The short key recorded in the scan result, e.g. `entriesNotLoaded (F1, assertEntriesLoaded)`. */
  readonly key: string
  /** The log substring whose presence means that symbol fired. */
  readonly marker: string
}
/** The fatal boot signatures, in F-number order; an EMPTY hit list is the health assertion. */
const APPLY_SIGNATURES: readonly ApplySignature[] = [
  { key: "entriesNotLoaded (F1, assertEntriesLoaded)", marker: "plugin(s) failed to load" },
  { key: "entryNotActivated (F2, assertEntriesActivated)", marker: "did not activate" },
  { key: "entryPending (F2)", marker: "pending (waiting for service" },
  { key: "entryApplyFailed (F3 host)", marker: "failed to apply loader entry" },
  { key: "duplicatePrefixRoute (F3)", marker: "duplicate prefix route" },
]
/** The three fatal markers scanned in a TUI pane capture, which has no per-row keys. */
const TUI_SIGNATURES: readonly string[] = ["did not activate", "pending (waiting for service", "failed to apply loader entry"]

/** The only delay primitive of the arm loop: resolve after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** The lowercase hex SHA-256 of one file's bytes, used to anchor a run to a revision. */
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

// ── pure predicates (shared by the real arms and the offline self-test) ───────────────────────

/** The shallowest match of one key inside a composed row chunk: its indentation and raw value. */
interface KeyMatch {
  /** How many spaces the key matched at; the row's OWN keys win at the smallest value. */
  readonly indent: number
  /** The trimmed raw value text, still quoted when the dump quoted it. */
  readonly raw: string
}

/** The shallower key value inside one composed row chunk; the row's OWN keys are the shallowest. */
function rowKey(chunk: string, key: string): string | null {
  // The shallowest match seen so far for this key, or null while no key line has matched.
  let best: KeyMatch | null = null
  for (const line of chunk.split("\n")) {
    // The `key: value` line matched at this indentation, or null on a line that is not that key.
    const match = new RegExp("^(?:- )?(\\s*)" + key + ":\\s*(.+)$").exec(line)
    if (match === null) continue
    if (best === null || match[1].length < best.indent) best = { indent: match[1].length, raw: match[2].trim() }
  }
  return best === null ? null : best.raw
}

/** Strip ONE pair of matching surrounding quotes from a composed scalar; unquoted text is returned as is. */
const unquote = (raw: string): string => {
  // The quoted-capture match, or null when the value is not surrounded by quotes at all.
  const match = /^"([^"]*)"$|^'([^']*)'$/.exec(raw)
  return match === null ? raw : (match[1] ?? match[2])
}

/** One `name: dsh-better-sidebar` row found in a composed tree, with its keys VERBATIM. */
interface SidebarRow {
  /** The row's `id` key, or the literal `(no id)` when the row declares none. */
  readonly id: string
  /** The raw `disabled` value as composed (`!!js >-` for our guard row), null when the key is absent. */
  readonly disabledRaw: string | null
  /** True only when `disabled` is absent or exactly the text `false`: anything else is not a mount. */
  readonly enabled: boolean
}

/**
 * Every row in a composed tree whose `name` is exactly dsh-better-sidebar, with its id and its
 * `disabled` key VERBATIM (the guard row composes as the raw `!!js` expression, the aggregate row
 * as no key at all). A row counts as ENABLED only when the key is absent or exactly `false`:
 * anything else — `true` or an unevaluated expression — is not an enabled mount.
 */
function parseSidebarRows(composedText: string): SidebarRow[] {
  // Every matching row, in the order the composed tree lists them.
  const rows: SidebarRow[] = []
  for (const chunk of composedText.split(/^(?=- )/m)) {
    // The chunk's own (shallowest) `name` value, or null when the chunk declares no name.
    const name = rowKey(chunk, "name")
    if (name === null || unquote(name) !== SIDEBAR) continue
    // The chunk's own `id` value, null when it declares none (reported as `(no id)`).
    const id = rowKey(chunk, "id")
    // The chunk's own `disabled` value exactly as composed, null when the key is absent.
    const disabled = rowKey(chunk, "disabled")
    rows.push({
      id: id === null ? "(no id)" : unquote(id),
      disabledRaw: disabled,
      enabled: disabled === null || disabled === "false",
    })
  }
  return rows
}

/** The fatal-signature scan of one boot log or TUI pane capture. */
interface SignatureScan {
  /** The `key` of every signature the text carries, in registry order; empty IS the health assertion. */
  readonly hits: readonly string[]
  /** The matched marker strings, aligned index-for-index with `hits`. */
  readonly markers: readonly string[]
  /** True when no signature matched at all. */
  readonly healthy: boolean
}

/** Which fatal boot signatures the log carries (an empty hit list IS the health assertion). */
function scanSignatures(text: string, signatures: readonly ApplySignature[] = APPLY_SIGNATURES): SignatureScan {
  // Every registry entry whose marker occurs in the scanned text, in registry order.
  const hits = signatures.filter((entry) => text.includes(entry.marker))
  return { hits: hits.map((entry) => entry.key), markers: hits.map((entry) => entry.marker), healthy: hits.length === 0 }
}

/**
 * The sidebar's server half registers the prefix route /sidebar/api through
 * `ctx.webServer.register`; when the entry is NOT mounted the harness answers 404, when it IS
 * mounted the route exists and answers its own envelope (measured GET -> 405 method-error).
 */
const sidebarRouteMounted = (status: number): boolean => status !== 404

/** The browser half is discovered from the loader entry: its client module lands in the served table. */
const servedClientCarriesSidebar = (html: string): boolean => html.includes(SIDEBAR + "/client.js")

// ── sandbox machinery ────────────────────────────────────────────────────────────────────────

/** One mirror-symlinked fixture: a read-only link to a package a REAL profile already installed. */
interface MirrorLink {
  /** Absolute path of the already-installed package (linked, never copied into the sandbox). */
  readonly from: string
  /** Path relative to `<profile>/node_modules` at which the link is created. */
  readonly to: string
}

/** The options `buildSandbox` accepts; the profile and home names default to the web plane's. */
interface SandboxOptions {
  /** Sandbox tag — the arm name, or `selftest` — also part of the mkdtemp prefix. */
  readonly tag: string
  /** Profile directory name under `<DSH_HOME>/profiles` (default `w`). */
  readonly profileName?: string
  /** DSH_HOME directory name inside the sandbox root (default `dsh`; the TUI lane needs `dshhome`). */
  readonly homeName?: string
  /** The `dsh.profile.bundles` stack this sandbox's profile declares. */
  readonly bundles: readonly string[]
  /** What `node_modules/@mpd-dsh/mpd` links to: this checkout, or ARM 5's hermetic stage. */
  readonly bundleLink?: string
  /** Extra read-only links materialized before the boot (the aggregate scope, the TUI host). */
  readonly mirrorLinks?: readonly MirrorLink[]
}

/** A built sandbox: every directory it owns, the profile it wrote, and the env its children inherit. */
interface Sandbox {
  /** The tag the caller passed: the arm name, or `selftest`. */
  readonly tag: string
  /** The mktemp root that owns every other path listed here. */
  readonly root: string
  /** The isolated DSH_HOME (never the real `~/.dsh`). */
  readonly dshHome: string
  /** The isolated HOME, because skill roots leak through HOME (AGENTS.md §7). */
  readonly userHome: string
  /** The sandboxed workspace every dsh child uses as its cwd (AGENTS.md §7). */
  readonly ws: string
  /** Absolute path of the hand-built profile directory. */
  readonly profile: string
  /** The profile directory name, also the `--profile` argument of every boot. */
  readonly profileName: string
  /** The bundle stack the profile manifest declares, in loader order. */
  readonly bundles: readonly string[]
  /** The full environment handed to every child process of the arm. */
  readonly env: NodeJS.ProcessEnv
}

/**
 * The hand-built profile: `profiles/<name>/package.json` (link dependency + dsh.profile.bundles),
 * the standard pnpm-workspace.yaml, and the checkout-install symlink. `homeName` is `dsh` except
 * on the TUI arm, whose tmux lane expects `<root>/dshhome` (lib/tui-lane.ts `sandboxEnv`).
 */
function buildSandbox({ tag, profileName = "w", homeName = "dsh", bundles, bundleLink = REPO, mirrorLinks = [] }: SandboxOptions): Sandbox {
  // The mktemp root every other sandbox path is built inside and the run removes afterwards.
  const root = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-" + tag + "-"))
  // The isolated DSH_HOME, named `<homeName>` because the TUI lane expects `<root>/dshhome`.
  const dshHome = join(root, homeName)
  // The isolated HOME, so no skill root of the real user can leak into the boot.
  const userHome = join(root, "home")
  // The sandboxed workspace used as the child's cwd, which is what isolates workspace state.
  const ws = join(root, "ws")
  // The profile directory the hand-written manifest and the bundle symlink live in.
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
    // The absolute path inside `<profile>/node_modules` this fixture link is created at.
    const target = join(profile, "node_modules", link.to)
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target)) symlinkSync(link.from, target, "junction")
  }
  seedSandboxCredentials(dshHome)
  // The REAL settings.yaml, copied only when it exists: a boot without it dies MISSING_CREDENTIAL.
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
function stageBundleWithoutNodeModules(sandboxRoot: string): string {
  // The staged bundle directory: real manifest, symlinked payload, deliberately no node_modules.
  const stage = join(sandboxRoot, "stage", "mpd")
  mkdirSync(stage, { recursive: true })
  for (const entry of readdirSync(REPO)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".qa-install-deps" || entry === "package.json") continue
    symlinkSync(join(REPO, entry), join(stage, entry), "junction")
  }
  cpSync(join(REPO, "package.json"), join(stage, "package.json"))
  return stage
}

/** The repo wrapper's JSON envelope printed on stdout by `node scripts/dump-config.ts --json`. */
interface DumpConfigEnvelope {
  /** The wrapped harness command's exit code, absent when the child never reported one. */
  readonly exitCode?: number
  /** The wrapped `--dump-config` stdout (the composed tree), absent on a wrapper failure. */
  readonly stdout?: string
}

/** The COMPOSITION claim of one arm: what `--dump-config` composed, NEVER what the loader mounted. */
interface CompositionClaim {
  /** The claim-discipline sentence stored in result.json. */
  readonly claim: string
  /** The wrapper command this claim was read from, quoted in the record. */
  readonly command: string
  /** The wrapper's exit code (null when the child never reported one). */
  readonly exitCode: number | null
  /** True when the wrapper's stdout parsed as the `{exitCode, stdout, stderr}` envelope. */
  readonly envelopeParsed: boolean
  /** The composed tree text — DELETED once written to the arm's evidence artifact. */
  composedText: string
  /** Every sidebar row the composed tree carries, in tree order. */
  readonly sidebarRows: readonly SidebarRow[]
  /** The last non-empty stderr lines, kept for the failure narrative. */
  readonly stderrTail: readonly string[]
  /** The name of the dump artifact this claim was written to (set by the run). */
  evidenceArtifact?: string
  /** The byte length of the composed text, recorded before the text itself is dropped. */
  composedBytes?: number
  /** How many sidebar rows the composition listed. */
  rowCount?: number
  /** The ids of those rows, in tree order. */
  rowIds?: readonly string[]
  /** How many of them are LITERALLY enabled (our guard row never is). */
  literalEnabledCount?: number
  /** The ids of the literally enabled rows. */
  literalEnabledIds?: readonly string[]
  /** The arm's own expectation, echoed into the record. */
  expectRowCountMin?: number
  /** The arm's own upper bound, echoed into the record. */
  expectRowCountMax?: number
  /** The arm's own literal-enabled ceiling, echoed into the record. */
  expectLiteralEnabledMax?: number
  /** The COMPOSITION half of the arm verdict. */
  ok?: boolean
}

/** The COMPOSITION claim: compose through the repo wrapper (T-69), read the envelope's stdout field. */
function composeViaWrapper(sandbox: Sandbox): CompositionClaim {
  // The wrapper invocation: the repo's own `scripts/dump-config.ts`, never the raw harness flag.
  const args = [join(REPO, "scripts", "dump-config.ts"), "--profile", sandbox.profileName, "--json"]
  // The finished wrapper child: its stdout is the envelope, its stderr the composition-only banner.
  const run = spawnSync(process.execPath, args, { cwd: sandbox.ws, env: sandbox.env, encoding: "utf8", timeout: 180_000 })
  // The parsed envelope, or null when stdout was not JSON at all.
  let envelope: DumpConfigEnvelope | null = null
  try { envelope = JSON.parse(run.stdout) } catch { envelope = null }
  // The composed tree text itself: `""` when the wrapper failed before printing an envelope.
  const text = envelope?.stdout ?? ""
  // The sidebar rows inside that tree, none when the wrapper printed no envelope.
  const rows = envelope === null ? [] : parseSidebarRows(text)
  return {
    claim: "COMPOSITION ONLY (scripts/dump-config.ts -> the harness --dump-config composes rows and never executes plugin code, AGENTS.md §4)",
    command: "node scripts/dump-config.ts --profile " + sandbox.profileName + " --json",
    exitCode: envelope?.exitCode ?? run.status,
    envelopeParsed: envelope !== null,
    composedText: text,
    sidebarRows: rows,
    stderrTail: (run.stderr ?? "").split("\n").filter(Boolean).slice(-3),
  }
}

/** The LOAD claim of one arm: what a REAL mounting boot did, on either plane of the matrix. */
interface LoadClaim {
  /** The claim-discipline sentence stored in result.json. */
  readonly claim: string
  /** The exact boot command (web: `dsh --profile … --port …`; tui: the tmux lane). */
  readonly bootCommand: string
  /** True when the boot reached its readiness point. */
  booted: boolean
  /** Why the boot never reached readiness (web plane). */
  reason?: string
  /** The full child log path, copied into the evidence dir when it exists. */
  logPath?: string
  /** The HTTP port the web arm bound. */
  port?: number
  /** The served index's HTTP status. */
  indexStatus?: number
  /** Whether the served index's client table carries the sidebar host's browser bundle. */
  servedClientCarriesSidebar?: boolean
  /** How many distinct plugin client URLs the index referenced. */
  servedClientUrlCount?: number
  /** A truncated sample of one served client URL. */
  servedClientSample?: string
  /** The probed sidebar route: its path, HTTP status and a truncated body. */
  sidebarRoute?: {
    /** The probed path. */
    readonly path: string
    /** The HTTP status the route answered (404 = not mounted). */
    readonly status: number
    /** The first 120 characters of the response body. */
    readonly body: string
  }
  /** True when the sidebar route answered anything but 404. */
  sidebarRouteMounted?: boolean
  /** The fatal-signature scan of the log or pane text. */
  signatures?: SignatureScan
  /** The loader's own `mount guard:` lines (web) or pane lines naming the row (tui). */
  guardLines?: readonly string[]
  /** The last non-empty log lines kept for the failure narrative. */
  logTail?: readonly string[]
  /** The TUI lane's per-step failures; empty is the health assertion. */
  failures?: readonly string[]
  /** The TUI pane file the boot capture landed in. */
  paneFile?: string | null
  /** The TUI raw terminal log file. */
  logFile?: string
  /** The loader's own guard verdict, when the boot printed one. */
  guardDecision?: string | null
  /** Whether this arm's plane is expected to serve the sidebar. */
  expectSidebarServed?: boolean
  /** The positive-activation evidence pair, with the sentence a reader needs to judge it. */
  servedClaim?: {
    /** Whether the browser half's bundle is in the served client table. */
    readonly servedClientCarriesSidebar: boolean
    /** Whether the server half's route answered. */
    readonly sidebarRouteMounted: boolean
    /** What the arm expected of both. */
    readonly expectSidebarServed: boolean
    /** The one-sentence reading of those three booleans. */
    readonly activeEntryEvidence: string
  }
  /** The LOAD half of the arm verdict. */
  ok?: boolean
  /** The evidence artifact this claim's log was copied to. */
  evidenceLog?: string
}

/** The LOAD claim for the web plane: a REAL mounting boot, token-authorized, then two positives. */
async function bootWeb(sandbox: Sandbox, port: number): Promise<LoadClaim> {
  // The child's own log file, which is also the only place the boot's token is printed.
  const logPath = join(sandbox.root, "web-" + sandbox.tag + ".log")
  // The open fd handed to the child as stdout AND stderr: a pipe would be held by its MCP children.
  const fd = openSync(logPath, "w")
  // The resolved launcher argv, or null when no dsh binary is on PATH (the lane then dies loudly).
  const childSpec = dshCommand(["--profile", sandbox.profileName, "--port", String(port), "--no-open"], sandbox.env)
  if (childSpec === null) throw new Error(DSH_MISSING)
  // The real mounting boot under test: an isolated profile, serving on `port`, cwd inside the sandbox.
  const child = spawn(childSpec.command, childSpec.args, {
    env: sandbox.env, cwd: sandbox.ws, stdio: ["ignore", fd, fd],
  })
  // The loopback base URL every probe below is issued against.
  const base = "http://127.0.0.1:" + port
  // Re-read the child's log, answering `""` while the file cannot be read yet.
  const readLog = (): string => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  // The LOAD claim being assembled; the probe fields and the scans are filled in below.
  const result: LoadClaim = {
    claim: "REAL mounting boot (an isolated profile really boots and serves; never --dump-config)",
    bootCommand: "dsh --profile " + sandbox.profileName + " --port " + port + " --no-open",
    logPath, port, booted: false,
  }
  try {
    // The token the boot printed, or null while it has not printed one yet.
    let token: string | null = null
    // The session cookie the token-authorized request set, empty until it does.
    let cookie = ""
    // The wall-clock instant after which the readiness loop gives up.
    const deadline = Date.now() + BOOT_WAIT_MS
    while (Date.now() < deadline) {
      await sleep(1200)
      // The `token=…` capture from the log, null while the boot has not printed its URL line.
      const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
      if (match) token = match[1]
      if (token === null) continue
      try {
        // The token-authorized index request, which is what sets the session cookie.
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
    // The cookie-authorized index response: its body carries the served client table.
    const index = await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
    // The served index HTML itself, scanned for the sidebar's client bundle.
    const html = await index.text()
    result.indexStatus = index.status
    result.servedClientCarriesSidebar = servedClientCarriesSidebar(html)
    // Every distinct plugin client URL the index referenced, in first-seen order.
    const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((match) => match[0]))]
    result.servedClientUrlCount = urls.length
    result.servedClientSample = (urls.find((url) => url.includes(SIDEBAR + "/client.js")) ?? urls[0] ?? "").slice(0, 200)
    // The sidebar-host route probe: 404 means the entry never mounted.
    const route = await fetch(base + SIDEBAR_ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
    result.sidebarRoute = { path: SIDEBAR_ROUTE, status: route.status, body: (await route.text()).slice(0, 120) }
    // The route object was assigned on the line above; the optional field cannot say so.
    result.sidebarRouteMounted = sidebarRouteMounted(result.sidebarRoute!.status)
    return result
  } catch (error) {
    // The caught value is `unknown`: its `message` is read through the shape cast below, because an
    // `instanceof Error` branch would answer differently for a non-Error throw.
    result.reason = "boot/probe threw: " + String((error as ThrownShape)?.message ?? error)
    return result
  } finally {
    // The child's whole log, scanned for the fatal signatures before the process is killed.
    const text = readLog()
    result.signatures = scanSignatures(text)
    result.guardLines = text.split("\n").filter((line) => line.includes("mount guard") || line.includes("better-sidebar"))
    result.logTail = text.split("\n").filter(Boolean).slice(-6)
    child.kill("SIGTERM")
    await sleep(1500)
  }
}

/** The COMPOSITION claim could never see an `!!js` guard's verdict: the loader decides at load time. */
function guardDecision(lines: readonly string[] | undefined): string | null {
  for (const line of lines ?? []) {
    // The `mount guard: ENABLED|DISABLED` capture on this line, null when the line carries none.
    const match = /mount guard:\s*(ENABLED|DISABLED)/.exec(line)
    if (match !== null) return match[1]
  }
  return null
}

/** The LOAD claim for the dsh-tui plane: tmux lane boot (lib/tui-lane.ts), pane + raw log scanned. */
function bootTui(sandbox: Sandbox, outDir: string): LoadClaim {
  // This arm's evidence sub-directory, which owns the pane captures and the raw terminal log.
  const tuiOut = join(outDir, "tui-" + sandbox.tag)
  mkdirSync(tuiOut, { recursive: true })
  // The finished tmux lifecycle: panes, raw log, and one failure sentence per broken step.
  const session = runTuiSession({ lane: SLUG + "-" + sandbox.tag, root: sandbox.root, outDir: tuiOut, steps: [], bootWaitMs: 90_000 })
  // The boot pane plus the raw terminal log: the two texts the TUI signatures are scanned in.
  const paneText = (session.panes[0]?.text ?? "") + "\n" + (session.log ?? "")
  // The TUI-plane fatal markers present in that text; empty is the health assertion.
  const hits = TUI_SIGNATURES.filter((marker) => paneText.includes(marker))
  return {
    claim: "REAL dsh-tui mounting boot in tmux (lib/tui-lane.ts), pane capture + raw terminal log",
    bootCommand: "dsh-tui (default profile, in tmux)",
    booted: session.failures.length === 0,
    failures: session.failures,
    signatures: { hits, markers: hits, healthy: hits.length === 0 },
    guardLines: paneText.split("\n").filter((line) => line.includes("mount guard") || line.includes("better-sidebar")),
    paneFile: session.panes[0]?.file ?? null,
    logFile: session.logFile,
  }
}

// ── the five-composition matrix (aggregate-free FIRST) ───────────────────────────────────────

/** One frozen arm of the five-composition matrix. */
interface ArmSpec {
  /** The arm name: also its `--only` selector, its sandbox tag and its evidence-file stem. */
  readonly name: string
  /** The arm's position in the matrix; the aggregate-free composition comes first. */
  readonly order: number
  /** Which plane proves the LOAD claim: a real web boot, or the tmux dsh-tui boot. */
  readonly load: "web" | "tui"
  /** The fixture gate this arm needs, or null when it needs none. */
  readonly fixture: "aggregate" | "tui" | null
  /** Why the arm exists, stored verbatim in result.json. */
  readonly purpose: string
  /** The hand-built sandbox's profile directory name. */
  readonly profileName: string
  /** The DSH_HOME directory name (the TUI arm's tmux lane needs `dshhome`). */
  readonly homeName: string
  /** The `dsh.profile.bundles` stack this arm mounts, in loader order. */
  readonly bundles: readonly string[]
  /** Read-only links to packages the REAL profiles already installed. */
  readonly mirrorLinks?: readonly MirrorLink[]
  /** When true the bundle link points at a hermetic staged copy with no node_modules. */
  readonly stage?: boolean
  /** Minimum number of sidebar rows the composition must show. */
  readonly expectRowCountMin: number
  /** Maximum number of sidebar rows the composition may show. */
  readonly expectRowCountMax: number
  /** Ceiling on LITERALLY enabled sidebar rows (our guard row is never one). */
  readonly expectLiteralEnabledMax: number
  /** Whether this arm's plane must really serve the sidebar. */
  readonly expectSidebarServed: boolean
}

/** A fixture gate: an environment prerequisite one arm cannot build for itself. */
interface Fixture {
  /** The skip-reason code emitted when the fixture is absent. */
  readonly reason: string
  /** The path/command probed to decide presence, quoted in the skip record. */
  readonly probe: string
  /** The command that would materialize the fixture. */
  readonly remedy: string
  /** Whether the fixture is present in THIS environment. */
  readonly present: () => boolean
}

/** The fixture gates by name; both probe a REAL profile, which this case never writes. */
const FIXTURES: Record<"aggregate" | "tui", Fixture> = {
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

/** The five compositions, in the order the user asked for: aggregate-free first. */
const ARMS: readonly ArmSpec[] = [
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

/** What a caught `unknown` can be READ as here: `message`/`stack` when it carries them, else anything. */
type ThrownShape = { readonly message?: unknown; readonly stack?: unknown } | null

/** One arm's isolation verdict: the session-store assertion's report, or the throw it raised. */
interface IsolationVerdict {
  /** True only when `assertSessionsSandboxed` found no session-store key carrying this checkout. */
  readonly ok: boolean
  /** How many session-store keys were inspected (present only on the passing branch). */
  readonly checked?: number
  /** The inspected keys (present only on the passing branch). */
  readonly keys?: readonly string[]
  /** The assertion's thrown message (present only on the failing branch). */
  readonly error?: string
}

/** The verdict of one arm: its own identity plus both claims and the isolation assertion. */
interface ArmResult {
  /** The arm name from the frozen spec. */
  readonly name: string
  /** The arm's matrix position. */
  readonly order: number
  /** Why the arm exists, carried verbatim into the record. */
  readonly purpose: string
  /** The arm's overall verdict (absent when the arm threw before producing one). */
  ok?: boolean
  /** The arm's COMPOSITION claim object. */
  readonly composition?: CompositionClaim
  /** The arm's LOAD claim object. */
  readonly load?: LoadClaim
  /** The session-store isolation verdict. */
  readonly isolation?: IsolationVerdict
  /** True when neither DSH_HOME nor HOME points into the real home. */
  readonly realHomeUntouched?: boolean
  /** The thrown failure, when the arm never produced its two claims. */
  readonly error?: string
}

/** One arm's inputs: the frozen spec plus the two claims it just produced in its sandbox. */
interface ArmEvaluationInput {
  /** The frozen arm spec, whose expectations the verdict reads. */
  readonly spec: ArmSpec
  /** The COMPOSITION claim, extended here with its verdict fields. */
  readonly composition: CompositionClaim
  /** The LOAD claim, extended here with its verdict fields. */
  readonly load: LoadClaim
  /** The sandbox the arm ran in, kept for the isolation assertion. */
  readonly sandbox: Sandbox
}

/** Both claims of one arm, kept as separate objects (never conflated), plus the arm verdict. */
function evaluateArm({ spec, composition, load, sandbox }: ArmEvaluationInput): ArmResult {
  // The sidebar rows the composition listed, the subject of every count below.
  const rows = composition.sidebarRows
  // Only the rows the composition shows as literally enabled; our guard row is never one.
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
    // Both boot functions fill `signatures` before returning (bootWeb in its `finally` block), so
    // the optional field is provably present here; the interface cannot express that.
    load.ok = load.booted === true && load.signatures!.healthy === true
  } else {
    load.expectSidebarServed = spec.expectSidebarServed
    // The browser half's own positive: its bundle is composed into the served client table.
    const served = load.servedClientCarriesSidebar === true
    // The server half's own positive: its prefix route answers rather than 404.
    const mounted = load.sidebarRouteMounted === true
    load.servedClaim = {
      servedClientCarriesSidebar: served,
      sidebarRouteMounted: mounted,
      expectSidebarServed: spec.expectSidebarServed,
      activeEntryEvidence: served && mounted
        ? "the entry ACTIVATED: its route answers (" + SIDEBAR_ROUTE + " -> " + load.sidebarRoute!.status + ") AND its browser bundle is composed into the served client table"
        : "no positive activation evidence",
    }
    // As in the tui branch: `signatures` is filled before the claim is handed back.
    load.ok = load.booted === true && load.signatures!.healthy === true && served === spec.expectSidebarServed && mounted === spec.expectSidebarServed
  }
  // The session-store assertion, converted into a verdict instead of a throw.
  const isolation = ((): IsolationVerdict => {
    // WHY THE SPREAD IS TYPED `Omit<…, "ok">`: the assertion's own verdict always carries `ok: true`
    // (it throws instead of failing), so the spread would OVERWRITE the explicit `ok: true` with the
    // identical value — the cast states that identity so the compiler keeps the literal's key order.
    try { return { ok: true, ...(assertSessionsSandboxed(sandbox.dshHome, sandbox.root, { label: SLUG + "/" + spec.name }) as Omit<SessionSandboxVerdict, "ok">) } }
    // The caught value is `unknown`: its `message` is read through the shape cast below, because a
    // narrowing branch (`instanceof Error`) would answer differently for a non-Error throw.
    catch (error) { return { ok: false, error: String((error as ThrownShape)?.message ?? error) } }
  })()
  // The real-home guard: neither sandbox root may sit under the user's real DSH_HOME or HOME.
  const realHomeUntouched = !sandbox.dshHome.startsWith(join(homedir(), ".dsh")) && !sandbox.userHome.startsWith(homedir())
  return { name: spec.name, order: spec.order, purpose: spec.purpose, ok: composition.ok && load.ok && isolation.ok && realHomeUntouched, composition, load, isolation, realHomeUntouched }
}

// ── offline self-test ────────────────────────────────────────────────────────────────────────

/** The offline arm: every pure predicate plus the sandbox recipe, with no boot and no network. */
function selfTest(): void {
  // Every failed assertion's message, printed together before the process exits non-zero.
  const problems: string[] = []
  /** Record one failed assertion by message, and answer the condition so a caller can chain it. */
  const check = (condition: boolean, message: string): boolean => { if (!condition) problems.push(message); return condition }

  // (1) the sidebar-row parser: 0 / 1 enabled / 1 disabled-expression / 2 rows / decoys.
  // A composed tree with no sidebar row at all: the parser must answer zero.
  const noRows = "# == @deepseek-ai/dsh-base\n- id: timer\n  name: '@deepseek-ai/cordis-plugin-timer'\n"
  check(parseSidebarRows(noRows).length === 0, "a tree without the sidebar must parse to 0 rows")
  // The aggregate's own row: unguarded, so it composes as an ENABLED row with no `disabled` key.
  const aggregateRow = "- id: web-ui-better-sidebar\n  name: 'dsh-better-sidebar'\n  config:\n    name: dsh-better-sidebar\n"
  // That row as parsed: exactly one entry, enabled, carrying the aggregate's own id.
  const onlyAggregate = parseSidebarRows(aggregateRow)
  check(onlyAggregate.length === 1 && onlyAggregate[0].enabled === true && onlyAggregate[0].id === "web-ui-better-sidebar",
    "the aggregate's unguarded row must parse to exactly one ENABLED row: " + JSON.stringify(onlyAggregate))
  // Our guard row: its `disabled` is an unevaluated `!!js` expression, which is NOT enabled.
  const guardRow = "- id: mpd-better-sidebar\n  name: dsh-better-sidebar\n  disabled: !!js >-\n    (() => { return true })()\n"
  // That guard row as parsed: not enabled, with the raw expression preserved verbatim.
  const guarded = parseSidebarRows(guardRow)
  check(guarded.length === 1 && guarded[0].enabled === false && guarded[0].disabledRaw === "!!js >-",
    "the guard row's raw !!js disabled expression must parse as NOT enabled: " + JSON.stringify(guarded))
  // One guarded plus one aggregate row: two rows seen, exactly one of them enabled.
  const both = parseSidebarRows(guardRow + aggregateRow)
  check(both.length === 2 && both.filter((row) => row.enabled).length === 1,
    "one guarded + one aggregate row must yield enabledCount 1: " + JSON.stringify(both))
  // A decoy whose name merely CONTAINS the package name: it must not be counted as a row.
  const decoy = "- id: other\n  name: 'dsh-better-sidebar-extra'\n"
  check(parseSidebarRows(decoy).length === 0, "a name that merely CONTAINS the package name must not match")
  // `disabled: false` is a real mount, unlike the unevaluated expression of the guard row.
  const disabledFalse = "- id: x\n  name: 'dsh-better-sidebar'\n  disabled: false\n"
  check(parseSidebarRows(disabledFalse)[0].enabled === true, "disabled: false is an enabled row")

  // (2) the fatal-signature scanner: a healthy log is clean, each F1..F3 marker is detected.
  // A boot log with neither crash nor pending markers: the scan must report healthy.
  const healthyLog = "[mpd] loaded\ndsh web: http://127.0.0.1:1/?token=x\n"
  check(scanSignatures(healthyLog).healthy === true, "a healthy boot log must carry no signature")
  for (const entry of APPLY_SIGNATURES) {
    // One registry marker embedded in surrounding noise: exactly that key must be reported.
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
  // One real sandbox, built by the same recipe the arms use, removed in the `finally` below.
  const sandbox = buildSandbox({ tag: "selftest", bundles: [BASE_BUNDLE, WEB_APP_BUNDLE, MPD_BUNDLE] })
  try {
    // The profile manifest this recipe just wrote, re-read to assert what it really produced.
    const manifest: ProfileManifest = JSON.parse(readFileSync(join(sandbox.profile, "package.json"), "utf8"))
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
  // The mktemp root the ARM-5 stage is built inside, removed in the `finally` below.
  const stageRoot = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-stage-selftest-"))
  try {
    // The staged bundle: a real manifest, symlinked payload, deliberately no node_modules.
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
  // The frozen pre-fix composition dump, in the checkout this run was started from.
  const redComposed = join(REPO, RED_BASELINE_COMPOSED)
  check(existsSync(redComposed), "the pre-fix composition artifact must ship with the wave: " + RED_BASELINE_COMPOSED)
  if (existsSync(redComposed)) {
    // The sidebar rows the pre-fix tree parses to — the RED predicate must find none.
    const redRows = parseSidebarRows(readFileSync(redComposed, "utf8"))
    check(redRows.length === 0, "the pre-fix composition must parse to ZERO sidebar rows (the RED anchor), got " + redRows.length)
    check(parseSidebarRows(readFileSync(redComposed, "utf8")).filter((row) => row.enabled).length < 1,
      "the pre-fix tree must not carry a literally enabled sidebar row")
  }

  // (7) the wiring this case depends on is asserted, not assumed: cases.json + SKILL.md.
  // The case registry this script must be enumerated in.
  const casesPath = join(REPO, "skills", "dsh-qa", "cases.json")
  // The registry document, narrowed to the lane table asserted just below.
  const registry: CasesRegistry = JSON.parse(readFileSync(casesPath, "utf8"))
  // This case's own lane row, undefined when the registry does not enumerate the slug.
  const entry: CasesLane | undefined = (registry.lanes ?? []).find((lane) => lane.case === SLUG)
  check(entry !== undefined, "cases.json must enumerate the " + SLUG + " lane")
  if (entry !== undefined) {
    check(entry.script === "skills/dsh-qa/scripts/" + SLUG + ".ts", "cases.json must point at this script")
    check(typeof entry.immutabilityGuard === "string" && entry.immutabilityGuard.length > 0, "cases.json must declare an immutabilityGuard")
    check(Array.isArray(entry.suites) && entry.suites.includes("all"), "the lane must be part of the `all` suite")
  }
  // The skill document, whose case table must carry this case's row.
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

/** A lane prerequisite: absent means SKIP, or FAIL under `--no-skip` / `--require-pack`. */
interface LanePrereq {
  /** The marker code emitted (e.g. `absent-dsh-binary`). */
  readonly code: string
  /** What was probed, printed in the marker. */
  readonly probe: string
  /** How to satisfy it, printed in the marker. */
  readonly remedy: string
  /** Whether the prerequisite is satisfied in this environment. */
  readonly present: () => boolean
}

/** The run's prerequisites — also its two `PREREQ:` header lines, made executable. */
const LANE_PREREQS: readonly LanePrereq[] = [
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

/** Emit the FIRST absent prerequisite's marker and exit: SKIP (0) by default, FAIL (1) under STRICT. */
function gateLanePrereqs(): void {
  for (const prereq of LANE_PREREQS) {
    if (prereq.present()) continue
    emitMarker(STRICT ? "FAIL" : "SKIP", SLUG, prereq.code, prereq.probe, prereq.remedy)
    process.exit(STRICT ? 1 : 0)
  }
}

/** One arm skipped because its fixture is absent, kept in the record together with its remedy. */
interface SkippedArm {
  /** The arm name. */
  readonly name: string
  /** The arm's matrix position. */
  readonly order: number
  /** The skip-reason code. */
  readonly reason: string
  /** What was probed. */
  readonly probe: string
  /** How to materialize the fixture. */
  readonly remedy: string
}

/** The profile manifest this case writes: the bundle link dependency plus the `dsh` bundle stack. */
interface ProfileManifest {
  /** The profile's dependency map; the bundle under test is a `link:` entry. */
  dependencies: Record<string, string>
  /** The `dsh` block the loader reads; absent in a hand-written manifest that declares none. */
  dsh?: {
    /** The profile-scoped block. */
    profile?: {
      /** The bundle stack the profile mounts, in loader order. */
      bundles?: readonly string[]
    }
  }
}

/** One lane row of `skills/dsh-qa/cases.json`, narrowed to the fields this self-test asserts. */
interface CasesLane {
  /** The case slug this row registers. */
  readonly case?: string
  /** The script that implements the case — must be THIS file after the conversion. */
  readonly script?: string
  /** The immutability guard the runner enforces around the case. */
  readonly immutabilityGuard?: string
  /** The suites this lane belongs to; `all` is the standing one. */
  readonly suites?: readonly string[]
}

/** The `skills/dsh-qa/cases.json` registry, narrowed to the lane table this case checks. */
interface CasesRegistry {
  /** Every registered QA lane row. */
  readonly lanes?: readonly CasesLane[]
}

/** Run every selected arm, write the evidence dir, and exit non-zero when any arm failed. */
async function runReal(): Promise<void> {
  gateLanePrereqs()
  // The `--only=` selector, `""` when the run was not narrowed to named arms.
  const only = (process.argv.find((arg) => arg.startsWith("--only=")) ?? "").slice("--only=".length)
  // The arms this run executes: the whole matrix, or only the selected subset.
  const selected = only === "" ? ARMS : ARMS.filter((spec) => only.split(",").includes(spec.name))
  if (selected.length === 0) { console.error("[" + SLUG + "] --only matched no arm: " + only); process.exit(1) }
  // The evidence directory's timestamp, with `:` replaced so it is a portable path segment.
  const stamp = new Date().toISOString().replaceAll(":", "-")
  // This run's evidence directory: the dumps, boot logs, result.json and output.log land here.
  const outDir = join(REPO, "evidence", "install-deps", "qa-case", stamp)
  mkdirSync(outDir, { recursive: true })
  // Every executed arm's verdict, in execution order.
  const arms: ArmResult[] = []
  // Every arm skipped because its fixture is absent, with the remedy a reader needs.
  const skippedArms: SkippedArm[] = []
  // The next HTTP port to hand to a web arm; each arm gets its own so a dead one cannot collide.
  let port: number = BASE_PORT

  for (const spec of selected) {
    // The fixture gate this arm needs, or null when the arm builds everything itself.
    const fixture = spec.fixture === null ? null : FIXTURES[spec.fixture]
    if (fixture !== null && !fixture.present()) {
      skippedArms.push({ name: spec.name, order: spec.order, reason: fixture.reason, probe: fixture.probe, remedy: fixture.remedy })
      say("SKIP arm " + spec.name + " (" + fixture.reason + "): " + fixture.probe)
      continue
    }
    say("arm " + spec.name + " (composition " + spec.order + ") bundles=" + JSON.stringify(spec.bundles))
    // This arm's isolated sandbox: ARM 5 points the bundle link at a hermetic stage instead.
    const sandbox = buildSandbox({ tag: spec.name, profileName: spec.profileName, homeName: spec.homeName, bundles: spec.bundles, bundleLink: spec.stage === true ? undefined : REPO, mirrorLinks: spec.mirrorLinks ?? [] })
    if (spec.stage === true) {
      // The hermetic stage this arm links instead of the checkout.
      const stage = stageBundleWithoutNodeModules(sandbox.root)
      // The profile's bundle symlink, replaced so it points at that stage.
      const manifestPath = join(sandbox.profile, "node_modules", "@mpd-dsh", "mpd")
      rmSync(manifestPath, { recursive: true, force: true })
      symlinkSync(stage, manifestPath, "junction")
      // The profile manifest, re-read so ONLY the bundle link is repointed at the stage.
      const profileManifest: ProfileManifest = JSON.parse(readFileSync(join(sandbox.profile, "package.json"), "utf8"))
      profileManifest.dependencies[MPD_BUNDLE] = "link:" + stage
      writeFileSync(join(sandbox.profile, "package.json"), JSON.stringify(profileManifest, null, 2) + "\n")
    }
    // The arm's verdict, filled from the try branch or replaced by the thrown failure below.
    let arm: ArmResult
    try {
      // The COMPOSITION claim: what the wrapper composed, never what the loader mounted.
      const composition = composeViaWrapper(sandbox)
      writeFileSync(join(outDir, "dump-" + spec.name + ".txt"), composition.composedText)
      composition.evidenceArtifact = "dump-" + spec.name + ".txt"
      composition.composedBytes = composition.composedText.length
      // The ONE unavoidable cast of the run: `delete` needs a statically OPTIONAL property while the
      // `composedText.length` read on the line above needs it REQUIRED — no narrowing states both.
      delete (composition as { composedText?: string }).composedText
      say("  composition: exit=" + composition.exitCode + " sidebarRows=" + JSON.stringify(composition.sidebarRows))
      // The LOAD claim from this arm's own plane: the tmux dsh-tui boot, or a real web boot.
      const load = spec.load === "tui" ? bootTui(sandbox, outDir) : await bootWeb(sandbox, port++)
      if (spec.load === "tui") load.evidenceLog = "tui-" + spec.name + "/tui-pane.log"
      if (load.logPath !== undefined && existsSync(load.logPath)) {
        cpSync(load.logPath, join(outDir, "boot-" + spec.name + ".log"))
        load.evidenceLog = "boot-" + spec.name + ".log"
      }
      say("  load: " + (spec.load === "tui"
        // bootTui fills `signatures` in the object literal it returns, so the field is present here.
        ? "booted=" + load.booted + " signatures=" + JSON.stringify(load.signatures!.hits) + " failures=" + JSON.stringify(load.failures)
        : "booted=" + load.booted + " signatures=" + JSON.stringify(load.signatures?.hits ?? null)
          + " route=" + (load.sidebarRoute?.status ?? "-") + " servedSidebarClient=" + load.servedClientCarriesSidebar))
      // The `?? 0` keeps the original optional chain's reading (an absent array is "no guards").
      if ((load.guardLines?.length ?? 0) > 0) say("  guard: " + JSON.stringify(load.guardLines![0]))
      arm = evaluateArm({ spec, composition, load, sandbox })
    } catch (error) {
      // The caught value is `unknown`: `stack` and `message` are read through the same shape cast.
      arm = { name: spec.name, order: spec.order, purpose: spec.purpose, ok: false, error: String((error as ThrownShape)?.stack ?? error) }
      say("  arm THREW: " + String((error as ThrownShape)?.message ?? error))
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true })
    }
    arms.push(arm)
    say("arm " + spec.name + " -> " + (arm.ok ? "PASS" : "FAIL"))
  }

  // How many arms actually executed (skipped arms are not counted as evidence).
  const ran = arms.length
  // The run verdict: at least one arm ran AND every executed arm passed.
  const ok = ran > 0 && arms.every((arm) => arm.ok === true)
  // The revision anchors: the two composition inputs and this script's own bytes, with the moment.
  const sourceHashes: Record<string, string> = {
    measuredAtUtc: new Date().toISOString(),
    "cordis.patch.yml": sha256(join(REPO, "cordis.patch.yml")),
    "package.json": sha256(join(REPO, "package.json")),
    ["skills/dsh-qa/scripts/" + SLUG + ".ts"]: sha256(fileURLToPath(import.meta.url)),
  }
  // The record written to `result.json`: claims kept apart, plus the RED demonstration.
  const result = {
    case: SLUG,
    ok,
    checkedAt: stamp,
    repoRoot: REPO,
    claims: {
      composition: "--dump-config via scripts/dump-config.ts: rows composed, no plugin code executed (AGENTS.md §4). NEVER cited as load evidence.",
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
