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
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const FIXTURE_PRESET = "mpd"
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

/** The bundle patch files, from the ONE declaration the loader itself reads (string OR array). */
function declaredBundlePatches() {
  const raw = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))?.dsh?.bundle?.patch
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => resolve(repoRoot, value))
}

/** One patch file's text, rewritten for a checkout boot. */
function devFlavor(text) {
  return text
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

/** Every declared patch, dev-flavored, in manifest order (the order the loader applies them in). */
function devPatches() {
  return declaredBundlePatches().map((source) => ({ source, text: devFlavor(readFileSync(source, "utf8")) }))
}

function selfTest() {
  const roles = FIXTURE_ROLES.split(",")
  if (roles.length !== 11 || !roles.every((s) => /^[a-z][a-z-]*$/.test(s))) { console.error("[preset-register self-test] FAIL: role fixture"); process.exit(1) }
  const probe = join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")
  if (!existsSync(probe)) { console.error("[preset-register self-test] FAIL: roles probe dist missing (bun build first)"); process.exit(1) }
  const data = readFileSync(join(repoRoot, "packages/mpd-roles-plugin/src/roles.data.ts"), "utf8")
  if (!data.includes('"id": "oracle"') || !data.includes('"id": "multimodal-looker"')) { console.error("[preset-register self-test] FAIL: roster data fixture"); process.exit(1) }
  // The manifest's ARRAY declaration is the single source of truth for what a
  // dev boot must apply: the main patch AND the preset patch, in that order.
  const sources = declaredBundlePatches()
  if (sources.length < 2) { console.error("[preset-register self-test] FAIL: package.json dsh.bundle.patch declares " + sources.length + " file(s); the 0.1.7 model declares the main patch AND the preset patch as an array"); process.exit(1) }
  for (const source of sources) if (!existsSync(source)) { console.error("[preset-register self-test] FAIL: declared bundle patch missing on disk: " + source); process.exit(1) }
  const rewrites = devPatches()
  if (rewrites.length !== sources.length) { console.error("[preset-register self-test] FAIL: devPatches() returned " + rewrites.length + " of " + sources.length + " declared patches"); process.exit(1) }
  const main = rewrites[0]
  // The PRESET patch is the declared patch that really DECLARES the row — matched
  // on a row line, never by file name and never by a mention in a comment (the
  // main patch's own header comments name the same specifier, which made a
  // `text.includes(...)` test select the wrong file).
  const preset = rewrites.find((entry) => /^\s*name: '@deepseek-ai\/dsh-agent-preset'\s*$/m.test(entry.text))
  // The MAIN patch keeps its packed-name rewrite contract.
  if (!main.source.includes("mpd-bundle")) { console.error("[preset-register self-test] FAIL: the first declared patch is not the bundle patch (" + main.source + ")"); process.exit(1) }
  if (main.text.includes("name: '@mpd-dsh/mpd'") || !main.text.includes("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")) { console.error("[preset-register self-test] FAIL: devFlavor web-compat entry rewrite (bare '@mpd-dsh/mpd' must become the bundle-plugin main)"); process.exit(1) }
  // devFlavor must consume the packed `/node_modules/...` operand entirely: no
  // `<baseUrl>/node_modules/<abs-repo>` splice, no baseUrl concat left, and every
  // MCP row command must be the bare checkout-absolute launcher that a dev boot
  // resolves through the B8 chain (the old operand only "worked" via mcpEnv pins).
  for (const entry of rewrites) {
    if (entry.text.includes("typeof baseUrl") || entry.text.includes("@mpd-dsh/mpd/")) { console.error("[preset-register self-test] FAIL: devFlavor left the packed @mpd-dsh/mpd operand or a baseUrl concat in " + entry.source); process.exit(1) }
  }
  for (const mcp of ["mpd-mcp-astgrep/launch.mjs", "mpd-mcp-gitbash/dist/cli.js", "mpd-mcp-lsp/dist/cli.js", "mpd-mcp-codegraph/launch.mjs"]) {
    const target = join(repoRoot, "packages", mcp)
    if (!existsSync(target)) { console.error("[preset-register self-test] FAIL: MCP launcher missing on disk: " + mcp); process.exit(1) }
    // The dev rewrite splices `repoRoot + "/"` onto the packed operand's tail, so on Windows the
    // emitted operand is MIXED (`C:\\repo/packages/...`) while `join` answers a fully native path:
    // the two spell the SAME checkout-absolute launcher. Normalizing both sides to "/" compares the
    // path itself instead of enumerating spellings by hand — and it keeps `packages/` in the
    // comparison, which a hand-built `repoRoot + "/" + mcp` silently dropped.
    const emitted = '"' + target.split(sep).join("/") + '"'
    if (!main.text.split(sep).join("/").includes(emitted)) {
      console.error("[preset-register self-test] FAIL: devFlavor MCP operand is not the checkout-absolute " + mcp)
      process.exit(1)
    }
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

function runDsh(args, env, fd, cwd) {
  const spec = dshCommand(args, env)
  if (spec === null) return { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) }
  return spawnSync(spec.command, spec.args, { env, cwd, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd, fd] })
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[preset-register] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) writeFileSync(join(sandbox, "settings.yaml"), readFileSync(qaSettings))
  // NO preset copy and NO preset-root overlay: the bundle's own patch array
  // declares the `preset-mpd` row and the registry default.
  const probeOverlay = join(sandbox, "roles-probe.yml")
  writeFileSync(probeOverlay, readFileSync(join(repoRoot, "tests/overlays/roles-probe.yml"), "utf8").split("{{PROBE}}").join(join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")))
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  // NO MPD_DSH_*_CLI / MPD_*_BIN pins: the dev patch points each MCP row at the
  // checkout launcher, so the boot exercises the real B8 resolution chain (a pin
  // would short-circuit `process.env.X || <launcher>` and hide a broken operand).
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  const userHome = join(sandbox, "userhome")
  mkdirSync(userHome, { recursive: true })
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: userHome })
  if (env.DSH_HOME !== sandbox || env.HOME !== userHome) { console.error("[preset-register] isolation assertion failed"); process.exit(1) }
  const devFiles = []
  devPatches().forEach((entry, index) => {
    const file = join(sandbox, "bundle.dev." + index + ".patch.yml")
    writeFileSync(file, entry.text)
    devFiles.push({ file, source: entry.source })
  })
  const args = ["--profile", "headless"]
  for (const entry of devFiles) args.push("--patch", entry.file)
  args.push("--patch", probeOverlay, "ok")
  const run = runDsh(args, env, fd, sandboxWorkspace(sandbox))
  closeSync(fd)
  // Workspace isolation: the session workspace is the spawn cwd, so the boot must not
  // leave a session-store key for the real repo (DSH_HOME/HOME do not cover it).
  assertSessionsSandboxed(sandbox, sandbox, { label: "preset-register" })
  const out = readFileSync(logFile, "utf8")
  // Provability is the probe output (preset row registered + roster + served corpus),
  // not the CLI exit code: the trailing headless prompt needs a model credential that
  // may be absent on the QA machine, so exit 1 with a PASSing probe is an environment
  // artifact.
  const rosterLine = /ROSTER=([a-z,-]+)/.exec(out)?.[1] ?? ""
  const presetLine = /PRESET_MPD=([^\s]+)/.exec(out)?.[1] ?? ""
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(out) ?? []
  const homePresets = join(sandbox, ".agent-presets")
  const homeCopies = existsSync(homePresets) ? readdirSync(homePresets) : []
  const homeSkills = join(sandbox, "skills")
  const skillCopies = existsSync(homeSkills) ? readdirSync(homeSkills) : []
  // The retired preset-ROOT package must not appear as a FAILING loader entry.
  // Matched as a failure LINE, not as a bare mention: a boot log legitimately
  // names the removed package while reporting the patch it came from.
  const retiredFailure = out.split(/\r?\n/).filter((line) => line.includes("@deepseek-ai/dsh-agent-presets") && /resolv|cannot find|failed to apply|ERR_MODULE/i.test(line))
  const retiredRowAbsent = retiredFailure.length === 0
  const ok = /roles-probe\] PASS/.test(out) && presetLine === "ok"
    && FIXTURE_ROLES.split(",").every((id) => rosterLine.split(",").includes(id))
    && homeCopies.length === 0 && skillCopies.length === 0 && retiredRowAbsent
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

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
