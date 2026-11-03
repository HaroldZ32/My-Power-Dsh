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
import { findToolCall, readSessionEvents, type SessionStore } from "./lib/session-evidence.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this script's own URL (four directories below it). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The one headless task both tracks run: list the working directory through the bash tool, then answer. */
const JOB = "List the files in the current working directory (first use the bash tool with pwd and ls), then answer only: which tools you called and how many files are in the directory."
/**
 * The `llm-pi-ai` route the deepseek track stages into its sandbox's OWN `settings.yaml`.
 *
 * WHY IT IS NEEDED (F5, `evidence/dsh-qa/dual-track-deepseek/2026-10-29T01-30-11Z/diagnosis.md`): the
 * `@deepseek-ai/dsh-base` patch mounts the `llm-pi-ai` row with NO config, so it composes dormant, never
 * calls `registerAdapter`, and provider `deepseek` is absent from the LLM runtime — the track's overlay
 * route then dies `NO_ADAPTER` before any credential is consulted. The block below gives the row that
 * route. The `models` entry is REQUIRED, not decoration: the installed pi-ai catalog has no
 * `deepseek-v4-flash` id, and the overlay names exactly that model.
 */
const DEEPSEEK_ROUTE_SETTINGS = [
  "llm-pi-ai:",
  "  providers:",
  "    deepseek:",
  "      apiKeyEnv: DEEPSEEK_API_KEY",
  "      models:",
  "        - id: deepseek-v4-flash",
  "",
].join("\n")
/** One provider track: its label, the provider id it routes through and the overlay it needs (if any). */
interface Track {
  /** The human label the evidence row prints. */
  readonly label: string
  /** The provider id the track's model route resolves to. */
  readonly provider: string
  /** A repo-relative overlay patch, or `null` when the track needs none. */
  readonly overlay: string | null
  /**
   * The YAML block this track appends to its sandbox `settings.yaml`, or `null` when the machine's own
   * settings are enough.
   *
   * The deepseek track declares its provider route here; the official track needs nothing, and an EMPTY
   * value keeps it byte-identical to what it booted before this fix.
   */
  readonly settings: string | null
}
/** The tracks, keyed by the evidence-directory name each one records under. */
const TRACKS: Record<string, Track> = {
  official: { label: "deepseek-official (dsh-llm-deepseek)", provider: "deepseek-official", overlay: null, settings: null },
  deepseek: { label: "deepseek (dsh-llm-pi-ai)", provider: "deepseek", overlay: "tests/overlays/compat-track.yml", settings: DEEPSEEK_ROUTE_SETTINGS }
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
  const t = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
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
  // THE ROUTE STAGE (F5): the deepseek track must declare the llm-pi-ai route AND the model id the
  // installed catalog lacks, or the boot returns to NO_ADAPTER; the official track must stay UN-staged so
  // its boot is exactly what it was.
  if (!DEEPSEEK_ROUTE_SETTINGS.includes("llm-pi-ai:") || !DEEPSEEK_ROUTE_SETTINGS.includes("    deepseek:")
    || !DEEPSEEK_ROUTE_SETTINGS.includes("- id: deepseek-v4-flash") || !DEEPSEEK_ROUTE_SETTINGS.includes("apiKeyEnv: DEEPSEEK_API_KEY")) {
    console.error("[llm-dual-track self-test] FAIL: the deepseek route block lost its provider or its models entry (NO_ADAPTER would return)")
    process.exit(1)
  }
  if (TRACKS.deepseek.settings !== DEEPSEEK_ROUTE_SETTINGS || TRACKS.official.settings !== null) {
    console.error("[llm-dual-track self-test] FAIL: only the deepseek track may stage settings; the official boot must stay unchanged")
    process.exit(1)
  }
  console.log("[llm-dual-track self-test] ok: track fixture assertions + devPatch boot operand + the staged deepseek route verified")
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

/**
 * The harness's OWN tool evidence for one track's boot.
 *
 * WHY THIS REPLACES THE STDOUT REGEX (F5 nit): `/bash|tool/` matches the ANSWER the model wrote, which
 * AGENTS.md §7 says is wrong in BOTH directions — a model can describe a call it never made, and a real
 * call can go unmentioned — so the regex could pass a boot that used no tool at all. The harness session
 * log is the ground truth: a `tool/call` for `bash` paired with a non-error `tool/result`.
 *
 * @param sandbox - the track's throwaway DSH_HOME, which holds the session store.
 * @param ws - the sandbox workspace the boot ran in (the store is project-keyed by it).
 * @returns the recorded verdict (with a bounded slice of the tool result) and the reader's reason when nothing was paired.
 */
function toolEvidenceOf(sandbox: string, ws: string): { succeeded: boolean; called: string[]; reason: string; resultText: string } {
  /** The decoded session store for this sandbox workspace. */
  let store: SessionStore
  try {
    store = readSessionEvents(sandbox, { workspace: ws })
  } catch (error) {
    // A named workspace whose store is ABSENT is a boot/isolation failure, reported as "no evidence".
    return { succeeded: false, called: [], reason: "no session store for the sandbox workspace (" + (error instanceof Error ? error.message : String(error)) + ")", resultText: "" }
  }
  // The task's own shell call, paired with its result.
  const bash = findToolCall(store.records, "bash")
  // A BOUNDED slice of the tool result, so the artifact shows what the shell actually printed instead of
  // asking a reader to trust the model's narration about it.
  return { succeeded: bash.succeeded, called: bash.called ? ["bash"] : [], reason: bash.reason, resultText: bash.resultText.slice(0, 4000) }
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
    // THE TRACK'S OWN ROUTE (F5), staged AFTER that copy so a machine with settings keeps every other
    // provider it declares: appended, never substituted. A pre-existing top-level `llm-pi-ai:` key would
    // be a duplicate key, so the block goes LAST and the track's route is the one a last-wins reader
    // takes; the sandbox's settings file is disposable either way.
    if (t.settings !== null) {
      // The sandbox settings path this track stages into.
      const stagedSettings = join(sandbox, "settings.yaml")
      // What the copy above already put there, or "" when this machine has no settings file.
      const prior = existsSync(stagedSettings) ? readFileSync(stagedSettings, "utf8") : ""
      writeFileSync(stagedSettings, prior + (prior === "" || prior.endsWith("\n") ? "" : "\n") + t.settings)
    }
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
    // HOME is sandboxed too (AGENTS.md §7 isolation arm b, the sibling `mcp-call.ts` pattern): skill roots
    // and the workmate library resolve through HOME, so the child must not see the real one. The launcher
    // resolution above is PATH-based, so it is unaffected.
    const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox })
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
    // The run's combined output, kept as the run artifact a reader greps.
    const out = (run.stdout || "") + (run.stderr || "")
    // The HARNESS's own tool evidence for this boot: the `bash` call the task asks for, paired with a
    // non-error result in the session log. NOT the answer text — `/bash|tool/` matches the model's own
    // narration, which AGENTS.md §7 calls wrong in BOTH directions (a model can claim a call it never
    // made, and a real call can go unmentioned).
    const toolEvidence = toolEvidenceOf(sandbox, ws)
    // Whether the boot passed AND the harness recorded a real tool call for it.
    const ok = run.status === 0 && toolEvidence.succeeded
    // The timestamped evidence directory for this track.
    const outDir = join(repoRoot, "evidence", "dsh-qa", "llm-dual-track", key, new Date().toISOString().replaceAll(":", "-"))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, track: key, provider: t.provider, durationMs: ms, exit: run.status, hasToolEvidence: toolEvidence.succeeded, toolEvidence }, null, 2))
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
