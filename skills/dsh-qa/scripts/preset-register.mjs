#!/usr/bin/env node
// Case preset-register: under an isolated DSH_HOME, boot the dev-flavored bundle
// patch and assert through the roles probe that (1) the mpd preset resolves
// unbroken FROM THE BUNDLE-SHAPED ROOT (no $DSH_HOME/.agent-presets copy exists)
// and (2) the mpdRoles roster answers with the full 11-role specialist roster.
// --self-test verifies the fixtures + the dev patch rewrite offline.
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const FIXTURE_PRESET = "mpd"
const FIXTURE_ROLES = "oracle,librarian,prometheus,hephaestus,sisyphus,sisyphus-junior,atlas,explore,metis,momus,multimodal-looker"
const PRESETS_DIR = join(repoRoot, "presets")
// The packed patch serves presets from <profile>/node_modules/@mpd-dsh/mpd/presets
// through a baseUrl expression; a checkout boot must point at the checkout copy.
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'

// Dev-flavor rewrite of the bundle patch: the committed patch uses the packed
// `@mpd-dsh/mpd/...` names (resolvable only in an installed profile); QA boots
// from the checkout, so every row is rewritten to a checkout-absolute path (the
// adopted agent-teams package is main code at packages/mpd-agent-teams-plugin,
// so the generic rewrite covers it too).
//
// Wave-3 fidelity fix: the rewrite must consume the WHOLE packed operand, not
// just the `@mpd-dsh/mpd/` tail. Leaving the `+ "/node_modules/"` half produced
// `<baseUrl>/node_modules/<abs-repo>/packages/...`, which exists nowhere; the
// boot only survived because this file ALSO pre-set the MPD_DSH_*_CLI env keys
// and pinned the deprecated `.bin/sg` wrapper plus MPD_CODEGRAPH_BIN — and a
// caller pin wins untouched in the B8 launcher, so those pins bypassed exactly
// the resolution chain a dev boot exists to exercise. Both halves are removed:
// the operand becomes the bare checkout path and no CLI/binary pin is pre-set.
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? baseUrl.replace(/^file:\\/\\//, "").replace(/\\/+$/, "") : "") + '
function devPatch() {
  const t = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  return t
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(PRESETS_DIR))
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

function selfTest() {
  const roles = FIXTURE_ROLES.split(",")
  if (roles.length !== 11 || !roles.every((s) => /^[a-z][a-z-]*$/.test(s))) { console.error("[preset-register self-test] FAIL: role fixture"); process.exit(1) }
  const preset = join(PRESETS_DIR, FIXTURE_PRESET)
  if (!existsSync(join(preset, "agent.cordis.yml")) || !existsSync(join(preset, "preset.yml"))) { console.error("[preset-register self-test] FAIL: mpd preset fixtures missing"); process.exit(1) }
  const probe = join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")
  if (!existsSync(probe)) { console.error("[preset-register self-test] FAIL: roles probe dist missing (bun build first)"); process.exit(1) }
  const data = readFileSync(join(repoRoot, "packages/mpd-roles-plugin/src/roles.data.ts"), "utf8")
  if (!data.includes('"id": "oracle"') || !data.includes('"id": "multimodal-looker"')) { console.error("[preset-register self-test] FAIL: roster data fixture"); process.exit(1) }
  // web-compat entry normalization: the bundle patch's web-compat self-row is
  // `name: '@mpd-dsh/mpd'` (the exact loader entry name client-modules scans);
  // the dev rewrite must map it to the checkout-absolute bundle-plugin main, and
  // must NOT leave a bare '@mpd-dsh/mpd' row name behind (that specifier is only
  // resolvable when the packed bundle is installed).
  const src = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  if (!src.includes("name: '@mpd-dsh/mpd'")) { console.error("[preset-register self-test] FAIL: bundle patch web-compat self-row missing bare '@mpd-dsh/mpd' entry"); process.exit(1) }
  if (!src.includes(PACKED_PRESETS_EXPR)) { console.error("[preset-register self-test] FAIL: bundle patch preset root expression missing"); process.exit(1) }
  const dev = devPatch()
  if (dev.includes("name: '@mpd-dsh/mpd'") || !dev.includes("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")) { console.error("[preset-register self-test] FAIL: devPatch web-compat entry rewrite (bare '@mpd-dsh/mpd' must become the bundle-plugin main)"); process.exit(1) }
  if (dev.includes(PACKED_PRESETS_EXPR) || !dev.includes(JSON.stringify(PRESETS_DIR))) { console.error("[preset-register self-test] FAIL: devPatch preset root rewrite (packed expression must become the checkout presets dir)"); process.exit(1) }
  // the rewritten root must be a bare checkout path, never spliced under /node_modules
  if (/\/node_modules\/[^"']*\/presets/.test(dev)) { console.error("[preset-register self-test] FAIL: devPatch spliced the checkout presets dir under /node_modules"); process.exit(1) }
  // devPatch must consume the packed `/node_modules/...` operand entirely: no
  // `<baseUrl>/node_modules/<abs-repo>` splice, no baseUrl concat left, and every
  // MCP row command must be the bare checkout-absolute launcher that a dev boot
  // resolves through the B8 chain (the old operand only "worked" via mcpEnv pins).
  if (dev.includes("typeof baseUrl") || dev.includes("/node_modules/@mpd-dsh/mpd/")) { console.error("[preset-register self-test] FAIL: devPatch left the packed /node_modules operand or a baseUrl concat"); process.exit(1) }
  for (const mcp of ["mpd-mcp-astgrep/launch.mjs", "mpd-mcp-gitbash/dist/cli.js", "mpd-mcp-lsp/dist/cli.js", "mpd-mcp-codegraph/launch.mjs"]) {
    const target = join(repoRoot, "packages", mcp)
    if (!existsSync(target)) { console.error("[preset-register self-test] FAIL: MCP launcher missing on disk: " + mcp); process.exit(1) }
    if (!dev.includes('"' + target + '"')) { console.error("[preset-register self-test] FAIL: devPatch MCP operand is not the checkout-absolute " + mcp); process.exit(1) }
  }
  console.log("[preset-register self-test] ok: preset + roster fixtures + web-compat/preset-root/MCP-operand normalization verified")
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
  if (existsSync(qaSettings)) cpSync(qaSettings, join(sandbox, "settings.yaml"))
  // NO preset copy: the bundle serves its own preset root (bundle-served model).
  // Runtime overlay generation: substitute repo paths (never commit checkout-absolute paths).
  const presetsOverlay = join(sandbox, "agent-presets-headless.yml")
  const probeOverlay = join(sandbox, "roles-probe.yml")
  writeFileSync(presetsOverlay, readFileSync(join(repoRoot, "tests/overlays/agent-presets-headless.yml"), "utf8").split("{{PRESETS}}").join(PRESETS_DIR))
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
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: userHome  })
  if (env.DSH_HOME !== sandbox || env.HOME !== userHome) { console.error("[preset-register] isolation assertion failed"); process.exit(1) }
  const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
  writeFileSync(bundlePatch, devPatch())
  const args = ["--profile", "headless",
    "--patch", bundlePatch,
    "--patch", presetsOverlay,
    "--patch", probeOverlay, "ok"]
  const run = runDsh(args, env, fd, sandboxWorkspace(sandbox))
  closeSync(fd)
  // Workspace isolation: the session workspace is the spawn cwd, so the boot must not
  // leave a session-store key for the real repo (DSH_HOME/HOME do not cover it).
  assertSessionsSandboxed(sandbox, sandbox, { label: "preset-register" })
  const out = readFileSync(logFile, "utf8")
  // Provability is the probe output (mount + roster + served path), not the CLI
  // exit code: the trailing headless prompt needs a model credential that may be
  // absent on the QA machine, so exit 1 with a PASSing probe is an environment artifact.
  const rosterLine = /ROSTER=([a-z,-]+)/.exec(out)?.[1] ?? ""
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(out) ?? []
  const homePresets = join(sandbox, ".agent-presets")
  const homeCopies = existsSync(homePresets) ? readdirSync(homePresets) : []
  const servedFromBundle = String(presetPath[1] ?? "").startsWith(PRESETS_DIR)
  const ok = /roles-probe\] PASS/.test(out) && /PRESET_MPD=ok/.test(out)
    && FIXTURE_ROLES.split(",").every((id) => rosterLine.split(",").includes(id))
    && servedFromBundle && homeCopies.length === 0
  const outDir = join(repoRoot, "evidence", "dsh-qa", "preset-register", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, exit: run?.status, dshHomeSandbox: true, bundleServedPreset: servedFromBundle, presetPath: presetPath[1] ?? null, trust: presetPath[2] ?? null, homePresetCopies: homeCopies, roster: FIXTURE_ROLES.split(",").length }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[preset-register] ok=" + ok + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[preset-register] PASS")
}

import { spawnSync } from "node:child_process"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
function runDsh(args, env, fd, cwd) {
  return spawnSync("dsh", args, { env, cwd, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd, fd] })
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
