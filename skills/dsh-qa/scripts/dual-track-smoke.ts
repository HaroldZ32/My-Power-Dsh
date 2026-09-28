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
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { credentialDescriptor, credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this script's own URL (four directories below it). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The one headless task both tracks run: list the working directory through the bash tool, then answer. */
const JOB = "List the files in the current working directory (first use the bash tool with pwd and ls), then answer only: which tools you called and how many files are in the directory."
/** One provider track: its label, the provider id it routes through and the overlay it needs (if any). */
interface Track {
  /** The human label the evidence row prints. */
  readonly label: string
  /** The provider id the track's model route resolves to. */
  readonly provider: string
  /** A repo-relative overlay patch, or `null` when the track needs none. */
  readonly overlay: string | null
}
/** The tracks, keyed by the evidence-directory name each one records under. */
const TRACKS: Record<string, Track> = {
  official: { label: "deepseek-official (dsh-llm-deepseek)", provider: "deepseek-official", overlay: null },
  deepseek: { label: "deepseek (dsh-llm-pi-ai)", provider: "deepseek", overlay: "tests/overlays/compat-track.yml" }
}
/** The model-route row the offline self-test asserts on (official route, never the gateway one). */
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
/** The packed preset-root operand the rewrite replaces with the checkout's own `presets/`. */
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'
/** The packed baseUrl expression the rewrite strips out of every row operand. */
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? decodeURIComponent(baseUrl.replace(/^file:\\/\\/\\/(?=[A-Za-z]:)/, "").replace(/^file:\\/\\//, "")).replace(/\\/+$/, "") : "") + '
/** Rewrite the committed bundle patch into a checkout-resolvable one, as the QA dev flavor does. */
function devPatch(): string {
  // The committed bundle patch, whose packed row operands are rewritten below.
  const t = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  return t
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(join(repoRoot, "presets")))
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

/** The offline self-test: the track fixture plus the boot-repair rewrite's own operands. */
function selfTest(): void {
  // Whether the fixture names the official route, which is the healthy signal.
  const okRow = FIXTURE_ROW.includes("provider: deepseek-official")
  // Whether the fixture wrongly names the gateway route instead.
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

/** One summary-table row, one per provider track. */
interface TrackRow {
  /** The evidence-directory key, which is also the track's own name. */
  readonly track: string
  /** The provider id the track routed through. */
  readonly provider: string
  /** Whether the boot exited 0 with tool evidence in its output. */
  readonly ok: boolean
  /** How long the boot took, in milliseconds. */
  readonly ms: number
  /** The child's exit status, `null` when no launcher resolved. */
  readonly exit: number | null
}

/** The live case: boot both tracks in their own sandbox, record each one's evidence and print the table. */
function runReal(): void {
  // The real credential store each sandbox is seeded from.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  // One row per track, printed as the run's summary table.
  const rows: TrackRow[] = []
  // Whether any track failed, which is the case's overall verdict.
  let failed = false
  for (const [key, t] of Object.entries(TRACKS)) {
    // The throwaway DSH_HOME this track is isolated in.
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
    // The credential seeding outcome, whose `present` flag gates the track.
    const credential = seedSandboxCredentials(sandbox, { credentialsFile: creds })
    if (!credential.present) { console.error("[llm-dual-track] missing credentials: " + JSON.stringify(credentialDescriptor(credential))); failed = true; continue }
    // Copy the live settings too: the gateway provider chain (llm-pi-ai +
    // agent-default-model) lives there; without it headless falls back to the
    // base deepseek-official route and dies MISSING_CREDENTIAL.
    const settings = join(homedir(), ".dsh", "settings.yaml")
    if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
    // The boot-repaired bundle patch staged inside the sandbox.
    const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
    writeFileSync(bundlePatch, devPatch())
    // The patch operands the boot is given, in order: the repaired bundle, then the track overlay.
    const patchArgs = [bundlePatch]
    if (t.overlay) patchArgs.push(join(repoRoot, t.overlay))
    // The dsh argument vector: the profile, then one --patch per operand, then the task.
    const args = ["--profile", "headless"]
    for (const p of patchArgs) args.push("--patch", p)
    args.push(JOB)
    // The wall-clock start of this track's boot, for the duration column.
    const t0 = Date.now()
    // The child environment: the sandbox home plus the resolved credential key.
    const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
    if (env.DSH_HOME !== sandbox) { console.error("[llm-dual-track] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
    // Workspace isolation: the session workspace is the spawn cwd, so boot inside a
    // sandbox workspace (DSH_HOME alone does not isolate workspace-scoped state).
    const ws = sandboxWorkspace(sandbox)
    // The resolved `dsh` launcher invocation, or `null` when no launcher is installed.
    const runSpec = dshCommand(args, env)
    // The headless run: the launcher's own exit and output, or the synthetic MISSING_LAUNCHER result.
    const run = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    assertSessionsSandboxed(sandbox, sandbox, { label: "llm-dual-track/" + key })
    // How long this track's boot took, in milliseconds.
    const ms = Date.now() - t0
    // The run's combined output, which the tool-evidence regex matches against.
    const out = (run.stdout || "") + (run.stderr || "")
    // Whether the boot passed AND its output carries tool evidence.
    const ok = run.status === 0 && /bash|tool/.test(out)
    // The timestamped evidence directory for this track.
    const outDir = join(repoRoot, "evidence", "dsh-qa", "llm-dual-track", key, new Date().toISOString().replaceAll(":", "-"))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, track: key, provider: t.provider, durationMs: ms, exit: run.status, hasToolEvidence: /bash|tool/.test(out) }, null, 2))
    writeFileSync(join(outDir, "output.log"), out)
    rows.push({ track: key, provider: t.provider, ok, ms, exit: run.status })
    console.log("[llm-dual-track] " + key + " ok=" + ok + " (" + ms + "ms, exit=" + run.status + ") -> " + outDir)
    if (!ok) failed = true
  }
  // The summary table, one tab-separated row per track in run order.
  const table = rows.map(r => [r.track, r.provider, r.ok, r.ms, r.exit].join("\t")).join("\n")
  writeFileSync(join(repoRoot, "evidence/dsh-qa/llm-dual-track/dual-track.tsv"), "track\tprovider\tok\tduration_ms\texit\n" + table + "\n")
  if (failed) process.exit(1)
  console.log("[llm-dual-track] PASS")
}

// The raw command-line arguments, in the order the caller passed them.
const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
