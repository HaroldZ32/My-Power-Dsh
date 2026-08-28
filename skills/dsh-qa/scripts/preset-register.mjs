#!/usr/bin/env node
// Case preset-register: under an isolated DSH_HOME, copy the mpd main preset into the
// sandbox user root .agent-presets, then after a real boot assert via the roles probe
// that (1) the mpd preset resolves unmounted-broken and (2) the mpdRoles roster answers
// with the full 11-role OMO roster. --self-test verifies the fixtures offline.
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const FIXTURE_PRESET = "mpd"
const FIXTURE_ROLES = "oracle,librarian,prometheus,hephaestus,sisyphus,sisyphus-junior,atlas,explore,metis,momus,multimodal-looker"

// Dev-flavor rewrite of the bundle patch: the committed patch uses the packed
// `@mpd-dsh/mpd/...` names (resolvable only in an installed profile); QA boots
// from the checkout, so rows are rewritten to checkout-absolute paths and the
// MCP command/env expressions are satisfied via MPD_DSH_* / MPD_*_BIN env pins.
function devPatch() {
  const t = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  return t
    .split("'@mpd-dsh/mpd/third-party/dsh-agent-teams'").join("'" + join(repoRoot, "third-party/dsh-agent-teams/lib/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

function mcpEnv() {
  return {
    MPD_DSH_ASTGREP_CLI: join(repoRoot, "packages/mpd-mcp-astgrep/dist/cli.js"),
    MPD_DSH_GITBASH_CLI: join(repoRoot, "packages/mpd-mcp-gitbash/dist/cli.js"),
    MPD_DSH_LSP_CLI: join(repoRoot, "packages/mpd-mcp-lsp/dist/cli.js"),
    MPD_DSH_CODEGRAPH_CLI: join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js"),
    MPD_AST_GREP_SG_PATH: join(repoRoot, ".toolchain/node_modules/.bin/sg"),
    MPD_CODEGRAPH_BIN: join(repoRoot, ".toolchain/node_modules/.bin/codegraph")
  }
}

function selfTest() {
  const roles = FIXTURE_ROLES.split(",")
  if (roles.length !== 11 || !roles.every((s) => /^[a-z][a-z-]*$/.test(s))) { console.error("[preset-register self-test] FAIL: role fixture"); process.exit(1) }
  const preset = join(repoRoot, "packages/mpd-bootstrap-plugin/presets", FIXTURE_PRESET)
  if (!existsSync(join(preset, "agent.cordis.yml")) || !existsSync(join(preset, "preset.yml"))) { console.error("[preset-register self-test] FAIL: mpd preset fixtures missing"); process.exit(1) }
  const probe = join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")
  if (!existsSync(probe)) { console.error("[preset-register self-test] FAIL: roles probe dist missing (bun build first)"); process.exit(1) }
  const data = readFileSync(join(repoRoot, "packages/mpd-roles-plugin/src/roles.data.ts"), "utf8")
  if (!data.includes('"id": "oracle"') || !data.includes('"id": "multimodal-looker"')) { console.error("[preset-register self-test] FAIL: roster data fixture"); process.exit(1) }
  console.log("[preset-register self-test] ok: preset + roster fixtures verified")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[preset-register] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const userPresets = join(sandbox, ".agent-presets")
  mkdirSync(userPresets, { recursive: true })
  cpSync(join(repoRoot, "packages/mpd-bootstrap-plugin/presets", FIXTURE_PRESET), join(userPresets, FIXTURE_PRESET), { recursive: true })
  // Runtime overlay generation: substitute repo paths (never commit checkout-absolute paths).
  const presetsOverlay = join(sandbox, "agent-presets-headless.yml")
  const probeOverlay = join(sandbox, "roles-probe.yml")
  writeFileSync(presetsOverlay, readFileSync(join(repoRoot, "tests/overlays/agent-presets-headless.yml"), "utf8").split("{{PRESETS}}").join(join(repoRoot, "packages/mpd-bootstrap-plugin/presets")))
  writeFileSync(probeOverlay, readFileSync(join(repoRoot, "tests/overlays/roles-probe.yml"), "utf8").split("{{PROBE}}").join(join(repoRoot, "packages/mpd-qa-roles-probe/dist/index.js")))
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  const env = { ...process.env, DSH_HOME: sandbox, ...mcpEnv() }
  if (env.DSH_HOME !== sandbox) { console.error("[preset-register] isolation assertion failed"); process.exit(1) }
  const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
  writeFileSync(bundlePatch, devPatch())
  const args = ["--profile", "headless",
    "--patch", bundlePatch,
    "--patch", presetsOverlay,
    "--patch", probeOverlay, "ok"]
  const run = runDsh(args, env, fd)
  closeSync(fd)
  const out = readFileSync(logFile, "utf8")
  // Provability is the probe output (mount + roster), not the CLI exit code: the
  // trailing headless prompt needs a model credential that may be absent on the
  // QA machine, so exit 1 with a PASSing probe is an environment artifact.
  const rosterLine = /ROSTER=([a-z,-]+)/.exec(out)?.[1] ?? ""
  const ok = /roles-probe\] PASS/.test(out) && /PRESET_MPD=ok/.test(out) && FIXTURE_ROLES.split(",").every((id) => rosterLine.split(",").includes(id))
  const outDir = join(repoRoot, "evidence", "dsh-qa", "preset-register", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, exit: run?.status, dshHomeSandbox: true, userRootPresets: true, roster: FIXTURE_ROLES.split(",").length }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[preset-register] ok=" + ok + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[preset-register] PASS")
}

import { spawnSync } from "node:child_process"
function runDsh(args, env, fd) {
  return spawnSync("dsh", args, { env, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd, fd] })
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()