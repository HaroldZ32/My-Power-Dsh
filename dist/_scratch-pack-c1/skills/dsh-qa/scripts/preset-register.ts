#!/usr/bin/env node
// Case preset-register: under an isolated DSH_HOME, boot the dev-flavored bundle
// patches and assert through the roles probe that (1) the `mpd` preset ROW
// registers unbroken from the bundle's own declaration and (2) the mpdRoles
// roster answers with the full 11-role specialist roster.
// --self-test verifies the fixtures + the dev patch rewrite offline.
//
// 0.1.7-rc.2 MODEL CHANGE: `@deepseek-ai/dsh-agent-presets` (the preset-ROOT
// service this case used to assert against) no longer exists. There is no preset
// directory and no `$DSH_HOME/.agent-presets` copy to prove the absence of: the
// preset is a ROW declared by the bundle's SECOND patch file, and the root
// manifest's `dsh.bundle.patch` is an ARRAY. So this case boots EVERY declared
// patch in dev flavor, in the order the manifest lists them, and the "no home
// copy" assertion moves from "presets served by reference" to the stronger
// "neither skills NOR .agent-presets exist under DSH_HOME".
import { existsSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { credentialEnv, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The preset id a dev boot must register from the bundle's own declaration. */
const FIXTURE_PRESET = "mpd"
/** The 11 roster ids the probe must report, comma-joined (the case's own fixture, not a tool output). */
const FIXTURE_ROLES = "oracle,librarian,prometheus,hephaestus,sisyphus,sisyphus-junior,atlas,explore,metis,momus,multimodal-looker"

// Dev-flavor rewrite of every bundle patch: the committed patches use the packed
// `@mpd-dsh/mpd/...` names (resolvable only in an installed profile); QA boots
// from the checkout, so every row is rewritten to a checkout-absolute path.
//
// Wave-3 fidelity fix: the rewrite must consume the WHOLE packed operand, not
// just the `@mpd-dsh/mpd/` tail. Leaving the `+ "/node_modules/"` half produced
// `<baseUrl>/node_modules/<abs-repo>/packages/...`, which exists nowhere; the
// boot only survived because this file ALSO pre-set the MPD_DSH_*_CLI env keys
// and pinned the deprecated `.bin/sg` wrapper plus MPD_CODEGRAPH_BIN — and a
// caller pin wins untouched in the B8 launcher, so those pins bypassed exactly
// the resolution chain a dev boot exists to exercise. Both halves are removed:
// the operand becomes the bare checkout path and no CLI/binary pin is pre-set.
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? decodeURIComponent(baseUrl.replace(/^file:\\/\\/\\/(?=[A-Za-z]:)/, "").replace(/^file:\\/\\//, "")).replace(/\\/+$/, "") : "") + '

/**
 * The four MCP launchers a dev-flavored main patch must point at, checkout-absolute,
 * as `<repoRoot>/packages/<entry>`.
 *
 * Each entry mirrors the operand the SHIPPED `cordis.patch.yml` row carries — the
 * fixture is a hand-written expectation, never parsed out of the patch, so it can
 * still catch a rewrite that stopped consuming the packed operand.
 */
const MCP_LAUNCHERS = [
  "mpd-mcp-astgrep/dist/launch.js",
  "mpd-mcp-gitbash/dist/launch.js",
  "mpd-mcp-lsp/dist/launch.js",
  "mpd-mcp-codegraph/dist/launch.js",
]

/**
 * Which of {@link MCP_LAUNCHERS} a patch text does NOT carry as a quoted
 * checkout-absolute operand. Pure, so the self-test can drive it with the
 * un-rewritten patch as a negative control.
 * @param text The patch text to inspect, in any path spelling.
 * @returns The launcher entries whose operand is missing; empty means every one is present.
 */
function missingMcpOperands(text: string): string[] {
  /** The text in the forward-slash quoting the patch uses on every platform. */
  const normalized = text.split(sep).join("/")
  return MCP_LAUNCHERS.filter((mcp) => !normalized.includes('"' + join(repoRoot, "packages", mcp).split(sep).join("/") + '"'))
}

/** One declared bundle patch, paired with its dev-flavored text. */
interface DevPatch {
  /** Absolute path of the declared patch file this text came from. */
  readonly source: string
  /** The patch text with every packed operand rewritten to a checkout-absolute path. */
  readonly text: string
}

/** One written dev-flavored patch file and the declared source it was rewritten from. */
interface DevFile {
  /** Absolute path of the sandbox file the dev patch was written to. */
  readonly file: string
  /** Absolute path of the declared patch it was rewritten from; filed as evidence. */
  readonly source: string
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

/** The bundle patch files, from the ONE declaration the loader itself reads (string OR array). */
function declaredBundlePatches(): string[] {
  /** The manifest's `dsh.bundle.patch` value, still untrusted and normalised on the next line. */
  const raw: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))?.dsh?.bundle?.patch
  /** Both declaration shapes the manifest schema allows: one string, or an array of paths. */
  const list: readonly unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => resolve(repoRoot, value))
}

/** One patch file's text, rewritten for a checkout boot. */
function devFlavor(text: string): string {
  return text
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

/** Every declared patch, dev-flavored, in manifest order (the order the loader applies them in). */
function devPatches(): DevPatch[] {
  return declaredBundlePatches().map((source) => ({ source, text: devFlavor(readFileSync(source, "utf8")) }))
}

/** The offline arm: verifies the roster/probe fixtures and the dev patch rewrite. */
function selfTest(): void {
  /** The roster fixture split into the ids the probe must report. */
  const roles = FIXTURE_ROLES.split(",")
  if (roles.length !== 11 || !roles.every((s) => /^[a-z][a-z-]*$/.test(s))) { console.error("[preset-register self-test] FAIL: role fixture"); process.exit(1) }
  /** The built roles probe the boot mounts; a missing dist means the build step never ran. */
  const probe = join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")
  if (!existsSync(probe)) { console.error("[preset-register self-test] FAIL: roles probe dist missing (bun build first)"); process.exit(1) }
  /** The roster data module, read to prove the fixture ids really exist in the shipped roster. */
  const data = readFileSync(join(repoRoot, "packages/mpd-roles-plugin/src/roles.data.ts"), "utf8")
  if (!data.includes('"id": "oracle"') || !data.includes('"id": "multimodal-looker"')) { console.error("[preset-register self-test] FAIL: roster data fixture"); process.exit(1) }
  // The manifest's ARRAY declaration is the single source of truth for what a
  // dev boot must apply: the main patch AND the preset patch, in that order.
  /** The declared patch files in manifest order, before any rewrite. */
  const sources = declaredBundlePatches()
  if (sources.length < 2) { console.error("[preset-register self-test] FAIL: package.json dsh.bundle.patch declares " + sources.length + " file(s); the 0.1.7 model declares the main patch AND the preset patch as an array"); process.exit(1) }
  for (const source of sources) if (!existsSync(source)) { console.error("[preset-register self-test] FAIL: declared bundle patch missing on disk: " + source); process.exit(1) }
  /** Those same patches with the dev-flavor rewrite applied. */
  const rewrites = devPatches()
  if (rewrites.length !== sources.length) { console.error("[preset-register self-test] FAIL: devPatches() returned " + rewrites.length + " of " + sources.length + " declared patches"); process.exit(1) }
  /** The first declared patch, which must be the main bundle patch. */
  const main = rewrites[0]
  // The PRESET patch is the declared patch that really DECLARES the row — matched
  // on a row line, never by file name and never by a mention in a comment (the
  // main patch's own header comments name the same specifier, which made a
  // `text.includes(...)` test select the wrong file).
  /** The declared patch that really declares the preset ROW, matched on a row line rather than a mention. */
  const preset = rewrites.find((entry) => /^\s*name: '@deepseek-ai\/dsh-agent-preset'\s*$/m.test(entry.text))
  // The MAIN patch is the repository-root `cordis.patch.yml`. The old `source.includes("mpd-bundle")`
  // heuristic went obsolete when that file moved out of `packages/mpd-bundle/` — and a substring
  // test on a path is not a proof anyway — so the first declared patch is pinned by PATH EQUALITY
  // against the root the manifest's own declaration resolves to.
  if (resolve(main.source) !== resolve(repoRoot, "cordis.patch.yml")) { console.error("[preset-register self-test] FAIL: the first declared patch is not the repository-root cordis.patch.yml (" + main.source + ")"); process.exit(1) }
  if (main.text.includes("name: '@mpd-dsh/mpd'") || !main.text.includes("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")) { console.error("[preset-register self-test] FAIL: devFlavor web-compat entry rewrite (bare '@mpd-dsh/mpd' must become the bundle-plugin main)"); process.exit(1) }
  // devFlavor must consume the packed `/node_modules/...` operand entirely: no
  // `<baseUrl>/node_modules/<abs-repo>` splice, no baseUrl concat left, and every
  // MCP row command must be the bare checkout-absolute launcher that a dev boot
  // resolves through the B8 chain (the old operand only "worked" via mcpEnv pins).
  for (const entry of rewrites) {
    if (entry.text.includes("typeof baseUrl") || entry.text.includes("@mpd-dsh/mpd/")) { console.error("[preset-register self-test] FAIL: devFlavor left the packed @mpd-dsh/mpd operand or a baseUrl concat in " + entry.source); process.exit(1) }
  }
  for (const mcp of MCP_LAUNCHERS) {
    /** The checkout-relative launcher the rewritten main patch must point at. */
    const target = join(repoRoot, "packages", mcp)
    if (!existsSync(target)) { console.error("[preset-register self-test] FAIL: MCP launcher missing on disk: " + mcp); process.exit(1) }
  }
  // The dev rewrite splices `repoRoot + "/"` onto the packed operand's tail, so on Windows the
  // emitted operand is MIXED (`C:\\repo/packages/...`) while `join` answers a fully native path:
  // the two spell the SAME checkout-absolute launcher. Normalizing both sides to "/" compares the
  // path itself instead of enumerating spellings by hand — and it keeps `packages/` in the
  // comparison, which a hand-built `repoRoot + "/" + mcp` silently dropped.
  /** The launchers the rewritten main patch does NOT carry as a checkout-absolute operand; empty on a healthy tree. */
  const missingOperands = missingMcpOperands(main.text)
  if (missingOperands.length > 0) {
    // WHICH CLI ENTRY each fixture names is the SHIPPED patch's own operand, and it moved once
    // already: `7c1076f3` ("ship the MCP launchers as built artifacts") switched the git-bash row
    // from `mpd-mcp-gitbash/launch.ts` to `mpd-mcp-gitbash/dist/launch.js`, and this fixture kept
    // naming the LEGACY `mpd-mcp-gitbash/dist/cli.js` that still sits in the package (which is why
    // the stale name still passed the existsSync leg above and only failed the operand match).
    // The fixture follows the SHIPPED operand; it is never derived from the patch, because a
    // derived expectation would re-state the rewrite instead of checking it.
    console.error("[preset-register self-test] FAIL: devFlavor MCP operand is not the checkout-absolute " + missingOperands.join(", "))
    process.exit(1)
  }
  // NEGATIVE CONTROL: the same predicate driven with the patch as DECLARED (before the rewrite)
  // must report all four launchers — the packed operand carries the `@mpd-dsh/mpd/...` spelling and
  // none of the checkout-absolute ones. If the rewrite ever stopped consuming that operand, the
  // rewritten text would look like this control and the case above would redden.
  /** The main patch BEFORE `devFlavor`, the falsifier's input. */
  const rawMain = readFileSync(main.source, "utf8")
  /** The launchers missing from the UN-rewritten patch, which must be all four for the control to hold. */
  const controlMissing = missingMcpOperands(rawMain)
  if (controlMissing.length !== MCP_LAUNCHERS.length) {
    console.error("[preset-register self-test] FAIL: negative control — the un-rewritten patch must carry NONE of the checkout-absolute operands, but " + (MCP_LAUNCHERS.length - controlMissing.length) + " already matched")
    process.exit(1)
  }
  // The PRESET patch must survive the rewrite as a real preset declaration: the
  // mpd composition is a row now, so this is what a dev boot must apply.
  if (preset === undefined) {
    console.error("[preset-register self-test] FAIL: no declared bundle patch declares a '@deepseek-ai/dsh-agent-preset' row")
    process.exit(1)
  }
  if (!/^\s+id: mpd\s*$/m.test(preset.text) || !/^\s+plugins:\s*$/m.test(preset.text)) {
    console.error("[preset-register self-test] FAIL: the dev-flavored preset patch no longer declares a '@deepseek-ai/dsh-agent-preset' row with config.id: mpd + plugins list (" + preset.source + ")")
    process.exit(1)
  }
  // The retired preset-ROOT service must not come back as a ROW through this
  // case. Matched on a row line, not on a mention: the main patch's header
  // legitimately NAMES the removed package while explaining the migration.
  for (const entry of rewrites) {
    if (/^\s*name: '@deepseek-ai\/dsh-agent-presets'\s*$/m.test(entry.text)) { console.error("[preset-register self-test] FAIL: " + entry.source + " still declares a row on the retired @deepseek-ai/dsh-agent-presets package"); process.exit(1) }
  }
  console.log("[preset-register self-test] ok: roster fixtures + " + sources.length + " declared bundle patches rewritten to checkout-absolute operands + preset row intact + retired preset-root service absent")
}

/** Run one headless `dsh` invocation with stdio sent to the caller's log file descriptor. */
function runDsh(args: string[], env: Env, fd: number, cwd: string): LiveOutcome {
  /** The resolved `dsh` launcher invocation, or `null` when none is on PATH. */
  const spec = dshCommand(args, env)
  if (spec === null) return { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) }
  return spawnSync(spec.command, spec.args, { env, cwd, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd, fd] })
}

/** The live arm: boot every dev-flavored patch and decide on the roles probe's own output. */
function runReal(): void {
  /** The real home's credential file, copied ONCE into the sandbox and never read again. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[preset-register] missing credentials"); process.exit(1) }
  /** The fresh temporary sandbox that serves as `DSH_HOME` for the whole run. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  /** The real home's model-chain settings, staged byte-for-byte only when the host has one. */
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) writeFileSync(join(sandbox, "settings.yaml"), readFileSync(qaSettings))
  // NO preset copy and NO preset-root overlay: the bundle's own patch array
  // declares the `preset-mpd` row and the registry default.
  /** The one-row boot overlay that mounts the QA roles probe at the sandbox's absolute path. */
  const probeOverlay = join(sandbox, "roles-probe.yml")
  writeFileSync(probeOverlay, readFileSync(join(repoRoot, "tests/overlays/roles-probe.yml"), "utf8").split("{{PROBE}}").join(join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")))
  /** The run log path; read back after the child exits. */
  const logFile = join(sandbox, "run.log")
  /** The log's file descriptor, handed to the child as stdout and stderr. */
  const fd = openSync(logFile, "w")
  // NO MPD_DSH_*_CLI / MPD_*_BIN pins: the dev patch points each MCP row at the
  // checkout launcher, so the boot exercises the real B8 resolution chain (a pin
  // would short-circuit `process.env.X || <launcher>` and hide a broken operand).
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  /** The sandbox `HOME`, which keeps the workmate library and user skill roots out of the real home. */
  const userHome = join(sandbox, "userhome")
  mkdirSync(userHome, { recursive: true })
  /** The sandboxed environment every child of this case inherits (sandbox credentials only). */
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: userHome })
  if (env.DSH_HOME !== sandbox || env.HOME !== userHome) { console.error("[preset-register] isolation assertion failed"); process.exit(1) }
  /** The dev-flavored patch files written into the sandbox, in manifest order. */
  const devFiles: DevFile[] = []
  devPatches().forEach((entry, index) => {
    /** The sandbox file this dev-flavored patch is written to (indexed, so the order is visible). */
    const file = join(sandbox, "bundle.dev." + index + ".patch.yml")
    writeFileSync(file, entry.text)
    devFiles.push({ file, source: entry.source })
  })
  /** The headless boot arguments: every dev patch in order, then the QA probe overlay and the prompt. */
  const args = ["--profile", "headless"]
  for (const entry of devFiles) args.push("--patch", entry.file)
  args.push("--patch", probeOverlay, "ok")
  /** The headless boot result; a missing launcher is reported instead of thrown. */
  const run = runDsh(args, env, fd, sandboxWorkspace(sandbox))
  closeSync(fd)
  // Workspace isolation: the session workspace is the spawn cwd, so the boot must not
  // leave a session-store key for the real repo (DSH_HOME/HOME do not cover it).
  assertSessionsSandboxed(sandbox, sandbox, { label: "preset-register" })
  /** The boot log, read back from the fd's file after the child closed it. */
  const out = readFileSync(logFile, "utf8")
  // Provability is the probe output (preset row registered + roster + served corpus),
  // not the CLI exit code: the trailing headless prompt needs a model credential that
  // may be absent on the QA machine, so exit 1 with a PASSing probe is an environment
  // artifact.
  /** The probe's comma-joined roster ids, `""` when the probe never reported them. */
  const rosterLine: string = /ROSTER=([a-z,-]+)/.exec(out)?.[1] ?? ""
  /** The probe's `PRESET_MPD=` verdict, `""` when the probe never reported it. */
  const presetLine: string = /PRESET_MPD=([^\s]+)/.exec(out)?.[1] ?? ""
  /** The `PRESET_PATH=<path> trust=<value>` probe line, or an empty list when it never appeared. */
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(out) ?? []
  /** The harness home's preset root, which the bundle-served model must leave absent or empty. */
  const homePresets = join(sandbox, ".agent-presets")
  /** The entries of that preset root: a non-empty list is a home copy and fails the verdict. */
  const homeCopies: string[] = existsSync(homePresets) ? readdirSync(homePresets) : []
  /** The harness home's skill root, which must stay empty under the bundle-served model. */
  const homeSkills = join(sandbox, "skills")
  /** The entries of that skill root: a non-empty list is a home copy and fails the verdict. */
  const skillCopies: string[] = existsSync(homeSkills) ? readdirSync(homeSkills) : []
  // The retired preset-ROOT package must not appear as a FAILING loader entry.
  // Matched as a failure LINE, not as a bare mention: a boot log legitimately
  // names the removed package while reporting the patch it came from.
  /** Boot-log lines that report the retired preset-root package as a resolution/apply failure. */
  const retiredFailure: string[] = out.split(/\r?\n/).filter((line) => line.includes("@deepseek-ai/dsh-agent-presets") && /resolv|cannot find|failed to apply|ERR_MODULE/i.test(line))
  /** Whether the retired preset-root package left no failing loader entry behind. */
  const retiredRowAbsent = retiredFailure.length === 0
  /** The case verdict: the probe passed, the roster is complete, no home copy and no retired row. */
  const ok = /roles-probe\] PASS/.test(out) && presetLine === "ok"
    && FIXTURE_ROLES.split(",").every((id) => rosterLine.split(",").includes(id))
    && homeCopies.length === 0 && skillCopies.length === 0 && retiredRowAbsent
  /** The evidence directory this run writes `result.json` and `output.log` into. */
  const outDir = join(repoRoot, "evidence", "dsh-qa", "preset-register", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok, exit: run?.status, dshHomeSandbox: true,
    bundlePatches: devFiles.map((entry) => entry.source),
    presetLine, presetPath: presetPath[1] ?? null, trust: presetPath[2] ?? null,
    homePresetCopies: homeCopies, homeSkillCopies: skillCopies, retiredPresetRootAbsent: retiredRowAbsent,
    roster: FIXTURE_ROLES.split(",").length,
  }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[preset-register] ok=" + ok + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[preset-register] PASS")
}

/** The command line after the interpreter and script path: `--self-test` selects the offline arm. */
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
