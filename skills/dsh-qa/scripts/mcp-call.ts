#!/usr/bin/env node
// Case mcp-call: run real dsh headless under an isolated DSH_HOME, verifying the MCP mount and call path.
// Assertion 1: the model sees the mcp__ast_grep__ and mcp__lsp__ tools; assertion 2: a real ast_grep search call returns the server's classified response.
// --self-test is the offline self-test.
//
// DEFECT (fixed 2026-09-14, same class as codegraph-smoke): both assertions used to
// read the model's FINAL ANSWER — a prose list of tool names, and prose that merely
// had to contain "ast-grep|ast_grep|match" while NOT containing BINARY_NOT_FOUND. A
// model that never made a call, or that narrated a tool it never reached, could pass;
// a model that made a perfect call but summarised it differently could fail. The
// evidence now comes from the harness's own session log (lib/session-evidence.ts):
//   * enum arm  -> `request/header.data.header.tools[]` — the tool list the harness
//                  actually showed the model;
//   * call arm  -> a recorded `tool/call` to mcp__ast_grep__search plus a non-error
//                  `tool/result` carrying the fixture's matched source line.
// The prose checks remain in result.json as informational fields only.
import { spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { readSessionEvents, findToolCall, recordedToolNames, type SessionStore, type ToolCallEvidence } from "./lib/session-evidence.ts"
import { credentialEnv, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"
import { declaredOptionalVersion, copyMatchesDeclaration, installedPackageVersion, stageDeclaredMcpDependency, type DependencyStage } from "./lib/mcp-dependency.ts"

/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The enum arm's prompt: ask for the visible tool names, forbidding any call. */
const ENUM_JOB = "Do only one thing: list all available tool names in your current session that start with the mcp__ prefix (one per line). Do not call any tools."
/** The call arm's prompt: call the ast-grep search on the fixture and report the result verbatim. */
const CALL_JOB = "The current directory has tests/mcp-fixtures/sample.c. Call the tool mcp__ast_grep__search to scan that file for the pattern return 0 (pass parameters per the tool schema), then report the tool's returned content verbatim. Do not use the bash tool."
/** The two tool names the enum arm must find in the harness-recorded tool list (its self-test fixture). */
const FIXTURE_LIST = "- mcp__ast_grep__search\n- mcp__lsp__get_diagnostics"
/** The MCP tool the call arm must find a recorded call for. */
const AST_TOOL = "mcp__ast_grep__search"
/** The LSP MCP row's declared dependency: `packages/mpd-mcp-lsp/src/launch.ts` resolves this name, and
 *  the row exposes ZERO tools without it, so the enum arm's `mcp__lsp__*` half rests on it. */
const LSP_DEPENDENCY = "cclsp"
/** The source line the fixture carries and the recorded tool result must therefore contain. */
const FIXTURE_LINE = "return 0"
/**
 * The staged pack install's wall-clock budget, in ms.
 *
 * MEASURED 2026-10-15 on this box: the NON-LINKED closure install (the `--install-links` install below,
 * which makes npm materialize the pack's own `@ast-grep/cli` + `cclsp` trees instead of symlinking the
 * pack) took 1037 s — the previous 600000 ms refused it purely on THROUGHPUT, so the real lane was red
 * here while it passed on a faster registry link, with nothing declaring that difference. 1800000 ms is
 * ~1.74x the measurement. BOUND: this is a ceiling for a cold cache over a slow registry link, never a
 * correctness claim — an install that genuinely hangs still fails, and a machine that needs longer still
 * reddens rather than passing.
 */
const INSTALL_TIMEOUT_MS = 1800000

/** The call-arm evidence before a successful read: no call id or recorded call list is known yet,
 *  which is why this is narrower than `ToolCallEvidence` rather than the same type. */
interface ToolEvidencePlaceholder {
  /** False: no recorded `tool/call` is known. */
  called: boolean
  /** False: no non-error `tool/result` is known. */
  succeeded: boolean
  /** Why the pairing is unknown (a read failure, or the initial placeholder text). */
  reason: string
  /** The joined result text; `""` before a successful read. */
  resultText: string
}

/** The headless boot's outcome: a real child result, or the launcher-missing shape that reports `DSH_MISSING` on stderr. */
interface LiveOutcome {
  /** The boot's exit status; `null` when no launcher resolved or the child was signalled. */
  status: number | null
  /** Captured stdout; empty on the launcher-missing arm. */
  stdout: string
  /** Captured stderr; carries `DSH_MISSING` when no launcher resolved on this host. */
  stderr: string
  /** The spawn error, present only on the launcher-missing arm (kept for the recorded evidence shape). */
  error?: Error
}

/** One arm's harness-side evidence: the store it was read from, the recorded names and the paired call. */
interface ArmEvidence {
  /** The session store both reads below were served from. */
  readonly store: SessionStore
  /** Every tool name the harness recorded for the arm, in record order. */
  readonly names: string[]
  /** The paired call for the requested tool, or `null` when the arm requested no tool name. */
  readonly call: ToolCallEvidence | null
}

/** What one headless arm produced, kept so the evidence pass can re-read its own sandbox. */
interface ArmRun {
  /** The arm's captured `run.log` text; the informational prose checks read it. */
  readonly out: string
  /** The arm's exit status; `null` when no launcher resolved or the child was signalled. */
  readonly exit: number | null
  /** The arm's ephemeral `DSH_HOME`, still on disk when the evidence pass reads its session store. */
  readonly sandbox: string
  /** The sandbox workspace the arm booted in; session evidence is keyed by it. */
  readonly ws: string
  /** Where the arm's staged pack copy got the LSP row's declared dependency from. */
  readonly lspStage: DependencyStage
}

/** The offline arm: proves the fixture list, the composed server name and the fixture's content line. */
function selfTest(): void {
  /** Whether the fixture list names the ast-grep search tool the call arm asserts. */
  const hasAst = FIXTURE_LIST.includes("mcp__ast_grep__search")
  /** Whether the fixture list names the LSP diagnostics tool the enum arm asserts (cclsp's own name). */
  const hasLsp = FIXTURE_LIST.includes("mcp__lsp__get_diagnostics")
  if (!hasAst || !hasLsp) { console.error("[mcp-call self-test] FAIL"); process.exit(1) }
  // The asserted tool name must be COMPOSED by the profile this case boots (bundle
  // patch rows declare serverName astgrep -> mcp__ast_grep__…), otherwise the case
  // asserts a tool that can never be recorded.
  /** The bundle patch whose `mcp-astgrep` row must declare the server name the tool name derives from. */
  const patch = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  /** That row's own chunk of the patch, split on the `- id: ` separators. */
  const row = patch.split(/\n\s*- id: /).find((chunk) => chunk.startsWith("mcp-astgrep"))
  if (row === undefined || !row.includes("serverName: ast_grep")) { console.error("[mcp-call self-test] FAIL: the mcp-astgrep row does not declare serverName: ast_grep"); process.exit(1) }
  // The LSP half of the same guard (de-omo wave B2): the row's serverName composes every mcp__lsp__*
  // name the enum arm looks for, so a rename there (or a launcher that has grown a subcommand the row
  // still passes) would silently make this case unfalsifiable.
  /** The `mcp-lsp` row's own chunk of the patch. */
  const lspRow = patch.split(/\n\s*- id: /).find((chunk) => chunk.startsWith("mcp-lsp"))
  if (lspRow === undefined || !lspRow.includes("serverName: lsp")) { console.error("[mcp-call self-test] FAIL: the mcp-lsp row does not declare serverName: lsp"); process.exit(1) }
  if (AST_TOOL !== "mcp__ast_grep__search") { console.error("[mcp-call self-test] FAIL: the asserted tool name does not match the composed server name"); process.exit(1) }
  // The fixture content the call arm asserts on must exist, or the assertion is vacuous.
  /** The ast-grep fixture copied into the sandbox workspace; the result must quote its line. */
  const fixture = readFileSync(join(repoRoot, "tests", "mcp-fixtures", "sample.c"), "utf8")
  if (!fixture.includes(FIXTURE_LINE)) { console.error("[mcp-call self-test] FAIL: the fixture no longer contains " + JSON.stringify(FIXTURE_LINE)); process.exit(1) }
  // The enum arm's `mcp__lsp__*` half needs the LSP row's DECLARED dependency, and the pack's own
  // manifest does not carry it: the published root manifest is the only declaration. Asserted here so a
  // manifest edit that drops it reddens this OFFLINE arm instead of turning the live enum arm red (or,
  // worse, silently unfalsifiable) inside a lane.
  /** The version the published manifest declares for the LSP row's dependency. */
  const declaredLsp = declaredOptionalVersion(repoRoot, LSP_DEPENDENCY)
  if (declaredLsp === null) { console.error("[mcp-call self-test] FAIL: package.json does not declare optionalDependencies." + LSP_DEPENDENCY + ", which the enum arm's mcp__lsp__* assertion rests on"); process.exit(1) }
  // The live arm must really stage that declaration into the tree it boots: this source check is the
  // rot guard for the staging call, the same shape readonly-deny's self-test uses for its own rows.
  /** This case's own source, read so a deleted staging call cannot leave the assertion unsupported. */
  const ownSource = readFileSync(fileURLToPath(import.meta.url), "utf8")
  if (!ownSource.includes("stageDeclaredMcpDependency({ repoRoot, targetTree: staged, name: LSP_DEPENDENCY")) {
    console.error("[mcp-call self-test] FAIL: the live arm no longer stages the declared LSP dependency into the sandbox pack copy it boots")
    process.exit(1)
  }
  // The pack install must stay NON-LINKED (a `file:` install without `--install-links` symlinks the pack
  // and never installs its OWN declared dependencies, so `@ast-grep/cli` stays unmaterialized and the
  // launcher falls back to the checkout's `node_modules` — the self-manufactured pass this arm forbids),
  // must keep npm from AUTO-INSTALLING the pack's peer closure (`--legacy-peer-deps`: that closure is a
  // SECOND copy of the harness core, measured 2026-10-15 to be boot-FATAL — see the flag comment), and
  // must stay cache-first (`--prefer-offline`). EVERY needle below is ASSEMBLED from two pieces: a single
  // literal also appears in this guard's own text, and a rot guard that matches itself can never redden
  // (measured 2026-10-15 — the earlier spelling of this guard had exactly that defect and passed on a
  // mutant that dropped the flags).
  /** The measured install argv the live arm must keep, as one string. */
  const measuredInstallArgv = '["install", "--prefix", profileDir, "--install-links", "--legacy-peer-deps"' + ', "--prefer-offline"'
  if (!ownSource.includes(measuredInstallArgv)) {
    console.error("[mcp-call self-test] FAIL: the live arm's pack install no longer passes the measured flag set (--install-links --legacy-peer-deps --prefer-offline), so it is no longer the install the lane measured: non-linked, with the pack's PEERS left to the host instead of auto-installed into the profile, and cache-first")
    process.exit(1)
  }
  // The staged install's THROUGHPUT budget must not silently revert to the value the measurement
  // falsified (the real lane was RED here purely on throughput: 1037 s measured against the old
  // 600000 ms). The source check keeps the constant WIRED into the install; the value check keeps it
  // above the measurement. Offline rot guard for the disposition, not for npm.
  if (!ownSource.includes("timeout: INSTALL_TIMEOUT_MS")) {
    console.error("[mcp-call self-test] FAIL: the staged install no longer passes INSTALL_TIMEOUT_MS, so the measured install budget is unenforced (" + INSTALL_TIMEOUT_MS + " ms)")
    process.exit(1)
  }
  if (INSTALL_TIMEOUT_MS < 1037000) {
    console.error("[mcp-call self-test] FAIL: INSTALL_TIMEOUT_MS (" + INSTALL_TIMEOUT_MS + " ms) is below the 1037 s the non-linked install MEASURED on this box — the real lane would be red purely on throughput")
    process.exit(1)
  }
  // The two arms must SHARE one npm cache: each arm used to pass `--cache <its own sandbox>/.npm-cache`,
  // so BOTH paid a cold closure install (measured 2026-10-15: 2647 s of wall clock for the pair). The
  // per-arm path is asserted GONE and the shared runner asserted PRESENT, because a revert of either
  // half silently restores the doubled cost the measurement removed.
  /** The per-arm cache call this guard forbids. */
  const perArmCacheCall = '"--cache", join(' + 'sandbox'
  if (ownSource.includes(perArmCacheCall)) {
    console.error("[mcp-call self-test] FAIL: a per-arm npm cache is back in the live arm, so each arm pays its own COLD closure install again")
    process.exit(1)
  }
  /** The shared-cache argument the live install must still receive. */
  const sharedCacheArg = '"--cache", ' + 'npmCache'
  /** The runner both arms must still go through, and the function that owns the shared cache. */
  const sharedCacheCall = "= runArmsWithShared" + "Cache()"
  if (!ownSource.includes(sharedCacheArg) || !ownSource.includes(sharedCacheCall) || !ownSource.includes("function runArmsWithShared" + "Cache(")) {
    console.error("[mcp-call self-test] FAIL: the live arm no longer runs both arms against ONE shared npm cache (runArmsWithSharedCache / --cache npmCache)")
    process.exit(1)
  }
  // The staging tier's VERSION gate (finding: the tier accepted an already-installed dependency without
  // checking its version). Offline, on a synthetic tree: the reader must answer a version and `null` for
  // every unusable manifest, and the gate must accept a MATCHING copy while refusing a STALE one — the
  // two directions the old existence-only check could not tell apart.
  /** A scratch tree for the version-gate arm; removed at the end of this block. */
  const versionScratch = mkdtempSync(join(tmpdir(), "mcp-call-version-"))
  try {
    /** The manifest path of a copy at the declared version. */
    const matching = join(versionScratch, "node_modules", LSP_DEPENDENCY, "package.json")
    mkdirSync(dirname(matching), { recursive: true })
    writeFileSync(matching, JSON.stringify({ name: LSP_DEPENDENCY, version: declaredLsp }))
    /** The manifest path of a copy at ANOTHER version. */
    const stale = join(versionScratch, "stale", "node_modules", LSP_DEPENDENCY, "package.json")
    mkdirSync(dirname(stale), { recursive: true })
    writeFileSync(stale, JSON.stringify({ name: LSP_DEPENDENCY, version: "0.0.0-not-" + declaredLsp }))
    if (installedPackageVersion(join(versionScratch, "absent", "package.json")) !== null) { console.error("[mcp-call self-test] FAIL: a missing manifest must read as no version"); process.exit(1) }
    if (installedPackageVersion(matching) !== declaredLsp) { console.error("[mcp-call self-test] FAIL: the installed-version reader must return the recorded version"); process.exit(1) }
    if (!copyMatchesDeclaration(matching, declaredLsp)) { console.error("[mcp-call self-test] FAIL: a copy at the declared version must be accepted"); process.exit(1) }
    if (copyMatchesDeclaration(stale, declaredLsp)) { console.error("[mcp-call self-test] FAIL: a STALE copy must NOT satisfy the declared version"); process.exit(1) }
  } finally {
    rmSync(versionScratch, { recursive: true, force: true })
  }
  console.log("[mcp-call self-test] ok: tool-name detection + composed ast_grep server name + fixture content + the declared LSP dependency (" + declaredLsp + ") verified on fixtures")
}

/** Read the harness-recorded tool list / tool call of one arm (never the model's prose). */
function sessionEvidence(sandbox: string, ws: string, toolName: string | null): ArmEvidence {
  /** The session store selected for that arm's sandbox workspace. */
  const store = readSessionEvents(sandbox, { workspace: ws })
  /** Every tool name the harness recorded for the arm. */
  const names = recordedToolNames(store.records)
  /** The paired call for the requested tool, or `null` when the arm requested none. */
  const call = toolName === null ? null : findToolCall(store.records, toolName)
  return { store, names, call }
}

/**
 * Run one headless arm in its own sandbox and return what the evidence pass needs from it.
 * @param job The prompt the arm submits (the enum job or the call job).
 * @param timeoutMs The budget for the arm's own headless boot.
 * @param npmCache The npm cache DIRECTORY both arms share — owned by the caller, never created here,
 *   so the second arm travels on what the first one filled instead of paying a cold closure.
 * @returns The arm's captured output, exit status, its still-live sandbox, its sandbox workspace and
 *   where its staged copy got the LSP row's declared dependency from.
 */
function realRun(job: string, timeoutMs: number, npmCache: string): ArmRun {
  /** The real home's credential file, copied ONCE into the sandbox and never read again. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[mcp-call] missing credentials"); process.exit(1) }
  /** The fresh temporary sandbox that serves as BOTH `DSH_HOME` and `HOME` for the arm. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // Live-LLM cases must ALSO copy settings.yaml when present (AGENTS.md §7): homes whose
  // keys come from gateway providers (llm-pi-ai — opencode-go/scnet) configure the chain
  // there, and without it headless falls back to the base `deepseek-official` route and
  // dies with MISSING_CREDENTIAL — which masks the real result of the call this case
  // exists to make. (Copied, never moved; the sandbox is ephemeral either way.)
  /** The real home's model-chain settings; staged at both lookup shapes below when present. */
  const settings = join(homedir(), ".dsh", "settings.yaml")
  /** Whether the host has a settings.yaml to stage, so both copies below stay conditional. */
  const hasSettings = existsSync(settings)
  if (hasSettings) cpSync(settings, join(sandbox, "settings.yaml"))
  // HOME is sandboxed too (wave-3, F-ENV-1): the MCP chain this case asserts is
  // resolved bundle-relatively by the B8 launcher (require chain -> <bundle>/
  // .toolchain) and the credentials come from DSH_HOME, so nothing under test
  // lives in the real HOME — but plugin state does (`~/.mpd`: codegraph's lock,
  // LSP daemon). With the real HOME the case could read/write real state (and on
  // a read-only `$HOME/.mpd` the codegraph child died before the assertion, see
  // F-B8-1); with it sandboxed the case is hermetic. Mirror credentials/settings
  // at the HOME-shaped location too (codegraph-smoke pattern) so either lookup
  // path finds them.
  mkdirSync(join(sandbox, ".dsh"), { recursive: true })
  cpSync(creds, join(sandbox, ".dsh", ".credentials.yaml"))
  if (hasSettings) cpSync(settings, join(sandbox, ".dsh", "settings.yaml"))
  // Write stdio to a file instead of a pipe: the dsh-mcp-client MCP subprocess inherits the fd and outlives dsh,
  // and a pipe would make spawnSync hang at EOF; writing to a file means the child only holds the log fd.
  /** The arm's run log path; read back after the child exits. */
  const logFile = join(sandbox, "run.log")
  /** The log's file descriptor, handed to the child as stdout and stderr. */
  const fd = openSync(logFile, "w")
  try {
    /** The sandboxed environment every child of this arm inherits (sandbox credentials only). */
    const env: Env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox  })
    if (env.DSH_HOME !== sandbox) { console.error("[mcp-call] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
    // NO MPD_AST_GREP_SG_PATH / MPD_CODEGRAPH_BIN pre-setting here (B8): this case
    // used to pin both to the checkout toolchain, which is exactly why it stayed
    // green while the deployed MCP tools were dead — the case manufactured its own
    // pass. It must exercise the real resolution chain instead.
    // Workspace isolation: the session workspace is the spawn cwd, so boot inside a
    // sandbox workspace (DSH_HOME alone does not isolate workspace-scoped state).
    /** The sandbox workspace the arm boots in; workspace-scoped state resolves from it. */
    const ws = sandboxWorkspace(sandbox)
    cpSync(join(repoRoot, "tests", "mcp-fixtures"), join(ws, "tests", "mcp-fixtures"), { recursive: true })
    // The bundle patch references rows as @mpd-dsh/mpd/... (Plan D staged layout):
    // stage the package into the sandbox profile with npm (relocate-smoke pattern;
    // `dsh plugin add` uses pnpm whose store is not writable in this sandbox).
    /** The release pack the profile installs by `file:`; the patch's row paths resolve inside it. */
    const packSource = join(repoRoot, "dist", "mpd-package")
    if (!existsSync(packSource)) { console.error("[mcp-call] missing staged bundle; run node scripts/pack-mpd.ts first"); process.exit(1) }
    // THE TREE UNDER TEST IS A SANDBOX COPY OF THE PACK, not the repository's artifact in place. npm's
    // default for a directory `file:` dependency is a SYMLINK (measured: a two-package scratch install
    // left `node_modules/fake-pkg -> ../../fake-pkg`), and node resolves a main module's REALPATH, so a
    // pack symlinked from the repository makes every launcher inside it resolve its dependencies from
    // the CHECKOUT's own `node_modules`. The case then passes on the developer host's `bun install`
    // rather than on the tree it staged — the same self-manufactured pass this file's header records for
    // the ast-grep binary, which is why the copy exists instead of a comment. THE INSTALL IS NON-LINKED
    // for the second half of that defect: the link is not merely a resolution path, a linked pack never
    // gets its OWN dependencies installed, so `@ast-grep/cli` (declared by the PACK's manifest, absent
    // from the root manifest) would stay unmaterialized and the launcher would fail BINARY_NOT_FOUND.
    // `--install-links` below installs the copy as a regular package and materializes that closure.
    //
    // `--legacy-peer-deps` IS THE BOOT FIX, not a convenience (MEASURED 2026-10-15 on this box). With
    // npm's DEFAULT peer auto-install the closure grew to 249 top-level packages / 1.1 GB and carried a
    // SECOND copy of the harness core into `<profile>/node_modules/@deepseek-ai/*` (peers of the PACK's
    // own `dsh-better-sidebar` dependency: dsh-agent, dsh-scope, dsh-tools, …). The boot then died
    // before any model turn with `dsh: tool "send_message" is already registered (for a per-agent
    // variant, register through that agent's `agent.ctx` instead)`. MECHANISM, captured from the
    // harness's own stack (evidence …/skills3/collision/): `@deepseek-ai/dsh-scope` keys the calling
    // context's scope by a MODULE-LOCAL symbol (`const kScope = Symbol("dsh.scope")`; `scopeOf(ctx) =
    // ctx[kScope]`), so a scope marker written by one loaded copy is INVISIBLE to another copy. The
    // `mpd-tool-agent-team` row (`@deepseek-ai/dsh-experimental-tool-agent-team`, whose `install()`
    // registers `send_message` through `agent.ctx`) therefore fell through to the GLOBAL tool layer,
    // where the base row `tool-subagent-control` had already registered a global `send_message`
    // (`@deepseek-ai/dsh-tool-subagent-control`): duplicate insertion, fatal boot. Falsified along the
    // way: the leading hypothesis that the profile's own `dsh.bundle.patch` and this case's `--patch`
    // are two paths the loader fails to dedupe — the composition carries each mpd row EXACTLY ONCE and
    // a real-copy install boots fine with that same `--patch`. `--legacy-peer-deps` restores the peer
    // semantics a real dsh profile has (`dsh plugin add` forwards to pnpm, which does NOT auto-install
    // peers; the installation provides them), keeps `dsh-better-sidebar` and `@ast-grep/cli` + `cclsp`
    // installed — the pack's OWN closure, which is what this arm measures — and removes the duplicate
    // harness copy. It is NOT a product verdict: the harness's module-local scope symbol stays a
    // reported finding for the host owner, with this repro.
    //
    // `--prefer-offline` + `npmCache` are the THROUGHPUT fix: the caller hands BOTH arms ONE cache, so
    // only the first pays the cold closure and the second reuses it instead of re-resolving the same
    // tree over a link that can be ~200x slower than a mirror (MEASURED 2026-10-15 on this box: the same
    // packument answered in 18.8 s from registry.npmjs.org and 0.095 s from the mirror; a cold per-arm
    // cache cost 1037 s per arm).
    /** The sandbox-local pack copy the profile installs; its launchers resolve from inside it. */
    const staged = join(sandbox, "staged-pack")
    cpSync(packSource, staged, { recursive: true })
    // The LSP row's DECLARED dependency, staged into that copy. `packages/mpd-mcp-lsp/dist/launch.js`
    // resolves `cclsp` from the `node_modules` chain above its own file; without it the row takes
    // `serveUnavailable` and exposes ZERO tools, so the enum arm's `mcp__lsp__*` half could not hold
    // and the pack's own manifest does not carry the entry (only the PUBLISHED root manifest declares
    // it — the version read below IS that declaration).
    /** The version the published manifest declares, which is what a user's install materializes. */
    const lspVersion = declaredOptionalVersion(repoRoot, LSP_DEPENDENCY)
    if (lspVersion === null) { console.error("[mcp-call] FAIL: package.json does not declare optionalDependencies." + LSP_DEPENDENCY + " — the enum arm's mcp__lsp__* assertion has no dependency to measure"); process.exit(1) }
    /** Where the staged copy got the dependency from, recorded in this arm's evidence. */
    const lspStage = stageDeclaredMcpDependency({ repoRoot, targetTree: staged, name: LSP_DEPENDENCY, version: lspVersion, env })
    if (!lspStage.ok) { console.error("[mcp-call] FAIL: the LSP row's declared dependency " + LSP_DEPENDENCY + "@" + lspVersion + " could not be staged into the sandbox pack copy: " + lspStage.detail); process.exit(1) }
    /** The sandbox profile (`headless`) that holds the `file:` dependency on the staged pack. */
    const profileDir = join(sandbox, "profiles", "headless")
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-headless", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
    /** The `npm install` of the staged pack into the sandbox profile; `--install-links` materializes the pack's own declared dependencies, `--legacy-peer-deps` keeps npm from auto-installing a second harness copy (the boot fix — see the flag comment above), `--prefer-offline` lets the second arm travel on `npmCache`, and `INSTALL_TIMEOUT_MS` is the measured-justified throughput budget (see its declaration). */
    const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--install-links", "--legacy-peer-deps", "--prefer-offline", "--no-audit", "--no-fund", "--cache", npmCache], { env, encoding: "utf8", timeout: INSTALL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
    if (inst.status !== 0) { console.error("[mcp-call] FAIL: staged install\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
    /** The resolved `dsh` launcher invocation for the arm's prompt, or `null` when none is on PATH. */
    const runSpec = dshCommand(["--profile", "headless", "--patch", join(repoRoot, "cordis.patch.yml"), job], env)
    /** The arm's headless boot result; a missing launcher is reported instead of thrown. */
    const run: LiveOutcome = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, {
      env, cwd: ws, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", fd, fd]
    })
    assertSessionsSandboxed(sandbox, sandbox, { label: "mcp-call" })
    return { out: readFileSync(logFile, "utf8"), exit: run.status, sandbox, ws, lspStage }
  } finally {
    closeSync(fd)
  }
}

/**
 * Run both live arms against ONE npm cache, created here and released before the evidence pass reads
 * either arm's sandbox.
 *
 * WHY SHARED: the two arms install the SAME pack and the SAME declared closure, so a per-arm cache made
 * the lane pay two COLD closure installs (measured 2026-10-15 on this box: 2647 s for the pair, one cold
 * install per arm; a single cold closure measured 1037 s). The cache lives here — outside both arm
 * sandboxes, which is the only place both arms can reach — and is removed in `finally` so a lane leaves
 * no multi-hundred-MB residue behind; the arms' own sandboxes stay alive, because the evidence pass
 * re-reads their session stores.
 * @returns The two arms in order: the enum arm, then the call arm.
 */
function runArmsWithSharedCache(): readonly [ArmRun, ArmRun] {
  /** The ONE npm cache both arms share; deleted once both arms have finished. */
  const npmCache = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-npmcache-"))
  try {
    return [realRun(ENUM_JOB, 600000, npmCache), realRun(CALL_JOB, 600000, npmCache)]
  } finally {
    rmSync(npmCache, { recursive: true, force: true })
  }
}

/** The live arm: run both prompts headless and decide on the harness-recorded evidence they left. */
function runReal(): void {
  /** Start of the run, so `result.json` carries its wall-clock duration. */
  const t0 = Date.now()
  /** Both arms, run against one shared npm cache; destructured so the evidence pass reads each by name. */
  const [enumRun, callRun] = runArmsWithSharedCache()
  /** The evidence directory this run writes both arms' logs and session artifacts into. */
  const outDir = join(repoRoot, "evidence", "dsh-qa", "mcp-call", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  // Harness-side evidence decides both arms (see the header note).
  /** The enum arm's recorded names, or the read error when its store could not be read. */
  let enumEv: { names: string[]; error: string } = { names: [], error: "" }
  /** The call arm's paired call, or the placeholder/read error when its store could not be read. */
  let callEv: { call: ToolCallEvidence | ToolEvidencePlaceholder | null; error: string } = { call: { called: false, succeeded: false, resultText: "", reason: "not read" }, error: "" }
  try { enumEv = { names: sessionEvidence(enumRun.sandbox, enumRun.ws, null).names, error: "" } } catch (error) { enumEv.error = String(error) }
  try { callEv = { call: sessionEvidence(callRun.sandbox, callRun.ws, AST_TOOL).call, error: "" } } catch (error) { callEv.error = String(error) }
  /** Whether the harness-recorded tool list carried both MCP servers' tools. */
  const enumOk = enumEv.names.some((n) => n.startsWith("mcp__ast_grep__")) && enumEv.names.some((n) => n.startsWith("mcp__lsp__"))
  /** The recorded result text of the ast-grep call; `""` when no call was paired. */
  const callResult: string = callEv.call?.resultText ?? ""
  /** Whether the ast-grep call succeeded and returned the fixture's line without a binary miss. */
  const callOk = Boolean(callEv.call?.succeeded) && callResult.includes(FIXTURE_LINE) && !callResult.includes("BINARY_NOT_FOUND")
  /** The case verdict: both arms exited cleanly and both harness-side assertions held. */
  const ok = enumRun.exit === 0 && enumOk && callRun.exit === 0 && callOk
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok, durationMs: Date.now() - t0,
    assertion: "harness-recorded tool list (request/header.header.tools) + harness-recorded tool/call with a non-error result carrying the fixture line",
    // WHERE THE ENUM ARM'S LSP HALF CAME FROM: the sandbox pack copy the arm booted, and the tier that
    // staged the row's declared dependency into it. Recorded on the ENUM arm, whose assertion rests on it.
    lspDependency: { name: LSP_DEPENDENCY, tree: "sandbox pack copy", ...enumRun.lspStage },
    enum: {
      exit: enumRun.exit,
      recordedToolCount: enumEv.names.length,
      recordedMcpTools: enumEv.names.filter((n) => n.startsWith("mcp__")),
      hasAstGrep: enumEv.names.some((n) => n.startsWith("mcp__ast_grep__")),
      hasLsp: enumEv.names.some((n) => n.startsWith("mcp__lsp__")),
      sessionError: enumEv.error || null,
      // Informational ONLY: the prose list the model produced (the OLD assertion).
      proseListedBoth: /mcp__ast_grep__/.test(enumRun.out) && /mcp__lsp__/.test(enumRun.out),
    },
    call: {
      exit: callRun.exit,
      tool: AST_TOOL,
      called: Boolean(callEv.call?.called),
      succeeded: Boolean(callEv.call?.succeeded),
      resultChars: callResult.length,
      resultHasFixtureLine: callResult.includes(FIXTURE_LINE),
      resultHasBinaryNotFound: callResult.includes("BINARY_NOT_FOUND"),
      reason: callEv.call?.reason || null,
      sessionError: callEv.error || null,
      // Informational ONLY: the OLD prose assertions.
      proseHasAstGrepWord: /ast-grep|ast_grep|match/.test(callRun.out),
      proseHasBinaryNotFound: /BINARY_NOT_FOUND/.test(callRun.out),
    },
  }, null, 2))
  writeFileSync(join(outDir, "enum.log"), enumRun.out)
  writeFileSync(join(outDir, "call.log"), callRun.out)
  writeFileSync(join(outDir, "call.tool-result.txt"), callResult + "\n")
  /** The arms to file evidence for, each paired with the name its artifacts are written under. */
  const arms: ReadonlyArray<readonly [string, ArmRun]> = [["enum", enumRun], ["call", callRun]]
  for (const [name, run] of arms) {
    try {
      /** The arm's session store, re-read so the raw log travels with the verdict. */
      const store = readSessionEvents(run.sandbox, { workspace: run.ws })
      if (store.file !== null) cpSync(store.file, join(outDir, name + ".session.jsonl.zstd"))
      if (store.records.length > 0) writeFileSync(join(outDir, name + ".session.decoded.jsonl"), store.records.map((r) => JSON.stringify(r)).join("\n") + "\n")
    } catch { /* the arms already recorded the read error in result.json */ }
  }
  // The printed line NAMES the failing clause: the oneclick lane's red (enum tools=95, call recorded)
  // was diagnosable only because the container kept the case's own log, and an `ok=false` whose reason
  // is not on this line costs a reader a second run.
  console.log("[mcp-call] ok=" + ok + " (enum recorded tools=" + enumEv.names.length
    + ", mcp__ast_grep__=" + enumEv.names.some((n) => n.startsWith("mcp__ast_grep__"))
    + ", mcp__lsp__=" + enumEv.names.some((n) => n.startsWith("mcp__lsp__"))
    + ", ast_grep call " + (callEv.call?.succeeded ? "recorded" : "MISSING: " + callEv.call?.reason)
    + ", call result has the fixture line=" + callResult.includes(FIXTURE_LINE)
    + ", lsp dependency staged from " + enumRun.lspStage.source + ") -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[mcp-call] PASS")
}

/** The command line after the interpreter and script path: `--self-test` selects the offline arm. */
const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
