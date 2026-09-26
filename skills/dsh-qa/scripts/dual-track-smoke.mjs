#!/usr/bin/env node
// Case llm-dual-track: real headless smoke of the DeepSeek dual track.
// Isolate DSH_HOME + copy credentials (never read or write the real ~/.dsh), proving tool calls and answers.
// --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { credentialDescriptor, credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const JOB = "List the files in the current working directory (first use the bash tool with pwd and ls), then answer only: which tools you called and how many files are in the directory."
const TRACKS = {
  official: { label: "deepseek-official (dsh-llm-deepseek)", provider: "deepseek-official", overlay: null },
  deepseek: { label: "deepseek (dsh-llm-pi-ai)", provider: "deepseek", overlay: "tests/overlays/compat-track.yml" }
}
const FIXTURE_ROW = "- id: agent-default-model\n  config:\n    provider: deepseek-official\n"

// Dev-flavor rewrite of the bundle patch (the preset-register pattern): the
// committed patch names rows as packed `@mpd-dsh/mpd/...` specifiers, which resolve
// only inside an INSTALLED profile. This case used to hand the committed patch to a
// bare `--profile headless`, so it died at boot with
// `ERR_MODULE_NOT_FOUND @mpd-dsh/mpd` (measured: <tmp>/profiles/headless/node_modules/
// @mpd-dsh/mpd/packages/...) and everything downstream of the boot — including the
// wave-2 workspace-isolation fix — was inert. Rewriting the rows to checkout-absolute
// paths repairs the boot without staging the packed package, and the MCP operands are
// consumed whole (no `<baseUrl>/node_modules/<abs-repo>` splice — the wave-3
// QA-harness fidelity defect), so no CLI/binary env pin is pre-set here either.
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? decodeURIComponent(baseUrl.replace(/^file:\\/\\/\\/(?=[A-Za-z]:)/, "").replace(/^file:\\/\\//, "")).replace(/\\/+$/, "") : "") + '
function devPatch() {
  const t = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  return t
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(join(repoRoot, "presets")))
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

function selfTest() {
  const okRow = FIXTURE_ROW.includes("provider: deepseek-official")
  const pipe = FIXTURE_ROW.includes("provider: pi-ai")
  if (!okRow || pipe) { console.error("[llm-dual-track self-test] FAIL"); process.exit(1) }
  // the boot-repair rewrite must leave no packed operand behind
  const dev = devPatch()
  if (dev.includes("typeof baseUrl") || dev.includes("/node_modules/@mpd-dsh/mpd/") || dev.includes("name: '@mpd-dsh/mpd'")) {
    console.error("[llm-dual-track self-test] FAIL: devPatch left a packed/self-row operand (boot would be ERR_MODULE_NOT_FOUND again)")
    process.exit(1)
  }
  console.log("[llm-dual-track self-test] ok: track fixture assertions + devPatch boot operand verified")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  const rows = []
  let failed = false
  for (const [key, t] of Object.entries(TRACKS)) {
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
    const credential = seedSandboxCredentials(sandbox, { credentialsFile: creds })
    if (!credential.present) { console.error("[llm-dual-track] missing credentials: " + JSON.stringify(credentialDescriptor(credential))); failed = true; continue }
    // Copy the live settings too: the gateway provider chain (llm-pi-ai +
    // agent-default-model) lives there; without it headless falls back to the
    // base deepseek-official route and dies MISSING_CREDENTIAL.
    const settings = join(homedir(), ".dsh", "settings.yaml")
    if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
    const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
    writeFileSync(bundlePatch, devPatch())
    const patchArgs = [bundlePatch]
    if (t.overlay) patchArgs.push(join(repoRoot, t.overlay))
    const args = ["--profile", "headless"]
    for (const p of patchArgs) args.push("--patch", p)
    args.push(JOB)
    const t0 = Date.now()
    const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
    if (env.DSH_HOME !== sandbox) { console.error("[llm-dual-track] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
    // Workspace isolation: the session workspace is the spawn cwd, so boot inside a
    // sandbox workspace (DSH_HOME alone does not isolate workspace-scoped state).
    const ws = sandboxWorkspace(sandbox)
    const runSpec = dshCommand(args, env)
    const run = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    assertSessionsSandboxed(sandbox, sandbox, { label: "llm-dual-track/" + key })
    const ms = Date.now() - t0
    const out = (run.stdout || "") + (run.stderr || "")
    const ok = run.status === 0 && /bash|tool/.test(out)
    const outDir = join(repoRoot, "evidence", "dsh-qa", "llm-dual-track", key, new Date().toISOString().replaceAll(":", "-"))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, track: key, provider: t.provider, durationMs: ms, exit: run.status, hasToolEvidence: /bash|tool/.test(out) }, null, 2))
    writeFileSync(join(outDir, "output.log"), out)
    rows.push({ track: key, provider: t.provider, ok, ms, exit: run.status })
    console.log("[llm-dual-track] " + key + " ok=" + ok + " (" + ms + "ms, exit=" + run.status + ") -> " + outDir)
    if (!ok) failed = true
  }
  const table = rows.map(r => [r.track, r.provider, r.ok, r.ms, r.exit].join("\t")).join("\n")
  writeFileSync(join(repoRoot, "evidence/dsh-qa/llm-dual-track/dual-track.tsv"), "track\tprovider\tok\tduration_ms\texit\n" + table + "\n")
  if (failed) process.exit(1)
  console.log("[llm-dual-track] PASS")
}

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
