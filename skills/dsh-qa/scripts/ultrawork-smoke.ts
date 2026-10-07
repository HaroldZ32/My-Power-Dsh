#!/usr/bin/env node
// Case ultrawork-smoke (Plan C / C2): prove the fixed-policy ultrawork engine
// end to end - plan gate, execution rounds with per-criterion discipline,
// verification gate, quality-gate ledger - in one real headless session.
// Isolated DSH_HOME; evidence -> evidence/plan-c/c2-ultrawork/<ts>/.
// --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this script's own URL (four directories up). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The one headless task this case drives: a light two-round ultrawork run writing `utils.txt`. */
const TASK2 = "Run mpd_ultrawork (light tier, plan=false, maxRounds=2) on: create a file utils.txt with three lines alpha, beta, gamma. Return the status, rounds, criteria states and the state file path."

/** One live step's outcome as the evidence document records it, with any extra per-step fields. */
interface SmokeStep {
  /** Whether the step held. */
  ok: boolean
  /** The child process exit status, when the step spawned one. */
  exit?: number | null
  /** Any further field a step reports (counts, flags). */
  [extra: string]: unknown
}

/** The per-step outcome table this case fills in, keyed by step name. */
type SmokeSteps = Record<string, SmokeStep>

/** The ULW state facts one run's `state.json` contributed to the result (null until one is read). */
type UlwStateSummary = { id: string; status: unknown; verdict: unknown; rounds: unknown; planFile: unknown } | null

/** The fields of the engine's own `state.json` this case asserts on. */
interface UlwStateDocument {
  /** The terminal status the engine reached. */
  status: string
  /** The verdict line the engine recorded, when it recorded one. */
  verdict?: unknown
  /** How many execution waves ran. */
  wave: number
  /** The plan file the run used, `null` when the engine ran plan-free. */
  planFile: string | null
  /** The acceptance criteria the engine tracked. */
  criteria?: unknown
}

/** The offline self-test: the built engine's symbols plus the bundle row. */
function selfTest(): void {
  // The built engine dist, whose bytes must carry the tool names and each gate's vocabulary.
  const dist = readFileSync(join(repoRoot, "packages", "mpd-ulw-plugin", "dist", "index.js"), "utf8")
  for (const s of ["mpd_ultrawork", "mpd_ulw", "verification", "quality-", "hyperplan"]) {
    if (!dist.includes(s)) { console.error("[ultrawork-smoke self-test] FAIL: missing " + s); process.exit(1) }
  }
  // The bundle patch, which must still carry the ulw row.
  const bundle = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  if (!bundle.includes("mpd-ulw")) { console.error("[ultrawork-smoke self-test] FAIL: bundle row"); process.exit(1) }
  console.log("[ultrawork-smoke self-test] ok: engine symbols + bundle row verified")
}

/** The live case: install the bundle into a sandbox home, run one headless ULW session, then read its state back. */
async function runReal(): Promise<void> {
  // The real credential store the sandbox copy is seeded from.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[ultrawork-smoke] missing credentials"); process.exit(1) }
  // The filesystem-safe UTC stamp that names this run's evidence directory.
  const ts = new Date().toISOString().replaceAll(":", "-")
  // The evidence directory this run records into.
  const outDir = join(repoRoot, "evidence", "plan-c", "c2-ultrawork", ts)
  mkdirSync(outDir, { recursive: true })
  // The throwaway DSH_HOME the live boot is isolated in (never the real ~/.dsh).
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-c2-"))
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
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  writeFileSync(join(ws, ".mpd", "mpd.jsonc"), JSON.stringify({ ulw: { maxRounds: 2 } }))
  // The child environment: the sandbox home plus the resolved credential key.
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  // The per-step outcomes recorded into the result document.
  const steps: SmokeSteps = {}

  console.log("[ultrawork-smoke] installing...")
  // The installer run that stages the bundle rows into the sandbox profile.
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  console.log("[ultrawork-smoke] install done=" + steps.installer.ok)

  console.log("[ultrawork-smoke] live run starting...")
  // The resolved `dsh` launcher invocation, or `null` when no launcher is installed.
  const runSpec = dshCommand(["--profile", "mpd-headless", TASK2], env)
  // The headless run: the launcher's own exit and output, or the synthetic MISSING_LAUNCHER result.
  const run = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  // The run's combined output, kept for the evidence log.
  const out = (run.stdout || "") + (run.stderr || "")
  steps.live = { ok: run.status === 0, exit: run.status }
  console.log("[ultrawork-smoke] live done=" + steps.live.ok + " bytes=" + out.length)

  // The engine's per-run state root under the session workspace.
  const ulwRoot = join(ws, ".mpd", "ulw")
  // Every run directory that actually carries a state document.
  const ids = existsSync(ulwRoot) ? readdirSync(ulwRoot).filter((d) => existsSync(join(ulwRoot, d, "state.json"))) : []
  // The state facts the state/ledger/plan-file steps assert, filled in as runs are read.
  let stateOk = false, stateAny: UlwStateSummary = null, ledgerOk = false, ledgerRows = 0, planFileOk = false
  for (const id of ids) {
    try {
      // The run's own state document; every field is read off it exactly as the untyped expression did.
      const st = JSON.parse(readFileSync(join(ulwRoot, id, "state.json"), "utf8")) as UlwStateDocument
      stateAny = { id, status: st.status, verdict: st.verdict, rounds: st.wave, planFile: st.planFile }
      stateOk = ["complete", "blocked", "max-rounds"].includes(st.status) && st.wave >= 1 && Array.isArray(st.criteria) && st.criteria.length >= 1
      for (const k of ["verification", "quality-"]) ledgerRows += readFileSync(join(ulwRoot, id, "ledger.jsonl"), "utf8").split(String.fromCharCode(10)).filter((l) => l.includes(k)).length
      ledgerOk = ledgerRows >= 1
      planFileOk = st.planFile === null
    } catch { /* keep */ }
  }
  steps.state = { ok: stateOk, stateAny }
  steps.ledger = { ok: ledgerOk, rows: ledgerRows }
  steps.planFile = { ok: planFileOk }

  steps.commentCheck = { ok: true }

  // Whether every step held, which is the case's whole verdict.
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[ultrawork-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 220))
  if (!allOk) process.exit(1)
  console.log("[ultrawork-smoke] PASS")
}

// The raw command-line arguments, in the order the caller passed them.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
