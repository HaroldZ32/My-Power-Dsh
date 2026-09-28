#!/usr/bin/env node
// Case tool-output-validation (C5/C7 defects): prove mpd_config_get and
// mpd_boulder_status return HOST-VALIDATED tool results in a real headless run.
// Defect 1: mpd_config_get(key) returned `value: undefined`, which the host
// rejected with "value is not lossless JSON".
// Defect 2: mpd_boulder_status returned `planProgress: null` against schema
// `type: object`, which the host rejected with '"value.planProgress" must be an object'.
// This case asserts neither error string appears and the tool's render text does.
// Isolated DSH_HOME; evidence -> evidence/fix/<slug>/<ts>/.
// --self-test is offline (bundle rows + dist symbols + unit suites).
// --tool config|boulder selects one probe (default: both, sequentially).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, type Env } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this script's own URL (four directories up). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))

/** One defect probe: its evidence slug, its headless task, and the strings that must appear or must not. */
interface Probe {
  /** The evidence slug the probe records under `evidence/fix/`. */
  readonly slug: string
  /** The task text handed to the headless session. */
  readonly task: string
  /** Substrings the run output must contain (the tool's own render text). */
  readonly expect: readonly string[]
  /** Substrings the run output must NOT contain (the host's validation errors). */
  readonly forbid: readonly string[]
}

/** The probe table, keyed by the `--tool` selector the caller passes. */
const PROBES: Record<string, Probe> = {
  config: {
    slug: "config-get-lossless",
    task: "Call mpd_config_get with key 'memory.vcs' and paste the exact tool result lines. Then call mpd_config_get with no arguments and paste the exact tool result lines.",
    expect: ["memory.vcs"],
    forbid: ["not lossless JSON", "invalid output"],
  },
  boulder: {
    slug: "boulder-status-planprogress",
    task: "Call mpd_boulder_status with no arguments and paste the exact tool result lines.",
    expect: [".mpd/boulder.json"],
    forbid: ["must be an object", "invalid output"],
  },
}

/** The three assertions one probe reports: the run itself, the expected hits and the forbidden hits. */
interface ProbeSteps {
  /** Whether the headless run exited 0, plus that exit status. */
  live: { ok: boolean; exit: number | null }
  /** Whether every expected substring was present, plus the ones that were. */
  expect: { ok: boolean; hits: string[] }
  /** Whether no forbidden substring was present, plus the ones that were. */
  forbid: { ok: boolean; hits: string[] }
}

/** The offline self-test: bundle rows, both built dist symbol sets and both unit suites. */
function selfTest(): void {
  // The bundle patch, which must still carry the config and boulder rows.
  const bundle = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  for (const id of ["mpd-config", "mpd-boulder"]) {
    if (!bundle.includes(id)) { console.error("[tool-output-validation self-test] FAIL: bundle row " + id); process.exit(1) }
  }
  // The built config plugin dist, whose bytes must carry the get/reload tool names.
  const cfgDist = readFileSync(join(repoRoot, "packages", "mpd-config-plugin", "dist", "index.js"), "utf8")
  // The built boulder plugin dist, whose bytes must carry the status/start tool names.
  const blDist = readFileSync(join(repoRoot, "packages", "mpd-boulder-plugin", "dist", "index.js"), "utf8")
  for (const s of ["mpd_config_get", "mpd_config_reload"]) {
    if (!cfgDist.includes(s)) { console.error("[tool-output-validation self-test] FAIL: dist symbol " + s); process.exit(1) }
  }
  for (const s of ["mpd_boulder_status", "mpd_boulder_start"]) {
    if (!blDist.includes(s)) { console.error("[tool-output-validation self-test] FAIL: dist symbol " + s); process.exit(1) }
  }
  for (const pkg of ["mpd-config-plugin", "mpd-boulder-plugin"]) {
    // The package's unit suite, run in its own directory.
    const r = spawnSync("bun", ["test"], { cwd: join(repoRoot, "packages", pkg), encoding: "utf8", timeout: 120000 })
    if (r.status !== 0) { console.error("[tool-output-validation self-test] FAIL: unit suite " + pkg + "\n" + r.stdout + r.stderr); process.exit(1) }
  }
  console.log("[tool-output-validation self-test] ok: bundle rows + dist symbols + unit suites verified")
}

/**
 * Drive one probe in the already-installed sandbox and record its evidence.
 * @param probe The probe to run.
 * @param sandbox Absolute path of the isolated DSH_HOME the run boots in.
 * @param ws Absolute path of the sandbox workspace the session runs in.
 * @param env The child environment (sandbox home plus the resolved credential key).
 * @returns Whether all three assertions of the probe held.
 */
function runProbe(probe: Probe, sandbox: string, ws: string, env: Env): boolean {
  // The probe's timestamped evidence directory, named by its defect slug.
  const outDir = join(repoRoot, "evidence", "fix", probe.slug, new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  // The resolved `dsh` launcher invocation, or `null` when no launcher is installed.
  const runSpec = dshCommand(["--profile", "mpd-headless", probe.task], env)
  // The headless run: the launcher's own exit and output, or the synthetic MISSING_LAUNCHER result.
  const run = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  // The run's combined output, which every assertion below matches against.
  const out = (run.stdout || "") + (run.stderr || "")
  // The three assertions: the run, the expected hits and the forbidden hits.
  const steps: ProbeSteps = {
    live: { ok: run.status === 0, exit: run.status },
    expect: { ok: probe.expect.every((s) => out.includes(s)), hits: probe.expect.filter((s) => out.includes(s)) },
    forbid: { ok: !probe.forbid.some((s) => out.includes(s)), hits: probe.forbid.filter((s) => out.includes(s)) },
  }
  // Whether every assertion of this probe held.
  const ok = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000))
  console.log("[tool-output-validation] " + probe.slug + ": ok=" + ok + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 200))
  return ok
}

/** The live case: install the bundle into a sandbox home, then run the selected probe(s) sequentially. */
async function runReal(): Promise<void> {
  // The real credential store the sandbox copy is seeded from.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[tool-output-validation] missing credentials"); process.exit(1) }
  // The throwaway DSH_HOME the live boot is isolated in (never the real ~/.dsh).
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-tov-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(sandbox, "settings.yaml"))
  // The sandbox workspace the headless session runs in: DSH_HOME alone does not isolate workspace state.
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  // The child environment: the sandbox home plus the resolved credential key.
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  // The installer run that stages the bundle rows into the sandbox profile.
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  if (inst.status !== 0) { console.error("[tool-output-validation] FAIL: install-profile\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
  // The raw command-line arguments, in the order the caller passed them.
  const argv = process.argv.slice(2)
  // The index of the `--tool` selector, or -1 when the caller named none.
  const idx = argv.indexOf("--tool")
  // The selected probe name, defaulting to both probes.
  const tool = idx >= 0 ? argv[idx + 1] : "all"
  // The probes to drive, in table order for `all`, or the single named probe.
  const probes = tool === "all" ? Object.values(PROBES) : [PROBES[tool]]
  // Whether every probe held, accumulated across the sequential runs.
  let allOk = true
  for (const p of probes) allOk = runProbe(p, sandbox, ws, env) && allOk
  if (!allOk) process.exit(1)
  console.log("[tool-output-validation] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
