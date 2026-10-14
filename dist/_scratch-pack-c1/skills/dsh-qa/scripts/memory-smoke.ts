#!/usr/bin/env node
// Case memory-smoke (Plan C / C6): real headless run of the git-backed memory
// engine - mpd_memory_write -> commit -> mpd_memory_read -> reflection hint.
// Isolated DSH_HOME; evidence -> evidence/plan-c/c6-memory/<ts>/.
// --self-test is the offline self-test (unit suite + row assertions).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this script's own URL (four directories up). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The one headless task this case drives: write, read back and report the memory engine's state. */
const TASK = "Use mpd_memory_write to save one note titled 'qa-note' with content 'alpha beta gamma' and kind 'note'. Then use mpd_memory_read with query 'alpha' and report how many entries match. Then report mpd_memory_status."

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

/** The offline self-test: bundle row, built dist symbols and the package's own unit suite. */
function selfTest(): void {
  // The bundle patch, which must still carry the memory row.
  const bundle = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  if (!bundle.includes("mpd-memory")) { console.error("[memory-smoke self-test] FAIL: bundle row"); process.exit(1) }
  // The built plugin dist, whose bytes must carry every tool name and the vcs binary it shells out to.
  const dist = readFileSync(join(repoRoot, "packages", "mpd-memory-plugin", "dist", "index.js"), "utf8")
  for (const s of ["mpd_memory_write", "mpd_memory_read", "mpd_memory_reflect", "svnadmin"]) {
    if (!dist.includes(s)) { console.error("[memory-smoke self-test] FAIL: missing " + s); process.exit(1) }
  }
  // The package's unit suite, run in its own directory.
  const r = spawnSync("bun", ["test"], { cwd: join(repoRoot, "packages", "mpd-memory-plugin"), encoding: "utf8", timeout: 120000 })
  if (r.status !== 0) { console.error("[memory-smoke self-test] FAIL: unit suite"); process.exit(1) }
  console.log("[memory-smoke self-test] ok: bundle row + dist symbols + unit suite verified")
}

/** The live case: install the bundle into a sandbox home, run one headless session, then read the store back. */
async function runReal(): Promise<void> {
  // The real credential store the sandbox copy is seeded from.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[memory-smoke] missing credentials"); process.exit(1) }
  // The filesystem-safe UTC stamp that names this run's evidence directory.
  const ts = new Date().toISOString().replaceAll(":", "-")
  // The evidence directory this run records into.
  const outDir = join(repoRoot, "evidence", "plan-c", "c6-memory", ts)
  mkdirSync(outDir, { recursive: true })
  // The throwaway DSH_HOME the live boot is isolated in (never the real ~/.dsh).
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-c6-"))
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
  // The per-step outcomes recorded into the result document.
  const steps: SmokeSteps = {}
  // The installer run that stages the bundle rows into the sandbox profile.
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  // The resolved `dsh` launcher invocation, or `null` when no launcher is installed.
  const runSpec = dshCommand(["--profile", "mpd-headless", TASK], env)
  // The headless run: the launcher's own exit and output, or the synthetic MISSING_LAUNCHER result.
  const run = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  // The run's combined output, kept for the evidence log.
  const out = (run.stdout || "") + (run.stderr || "")
  steps.live = { ok: run.status === 0, exit: run.status }
  // The per-agent memory root the plugin writes under the session workspace.
  const memRoot = join(ws, ".mpd", "memory", "agents")
  // The store facts the memory step asserts: committed entries, a real git repo, a due reflection.
  let entries = 0, repoOk = false, dueSeen = false
  if (existsSync(memRoot)) {
    for (const agent of readdirSync(memRoot)) {
      // The agent's committed memory directory inside its own repo clone.
      const memDir = join(memRoot, agent, "repo", "memory")
      if (existsSync(memDir)) entries += readdirSync(memDir).filter((f) => f.endsWith(".md")).length
      repoOk = repoOk || existsSync(join(memRoot, agent, "repo", ".git"))
      if (existsSync(join(memRoot, agent, "runtime", "reflection.json"))) {
        try {
          // The reflection state document; the counter is read straight off it, exactly as the
          // untyped expression did (an absent counter compares false rather than throwing).
          const r = JSON.parse(readFileSync(join(memRoot, agent, "runtime", "reflection.json"), "utf8")) as { steps: number };
          dueSeen = dueSeen || r.steps >= 1
        } catch { }
      }
    }
  }
  steps.memory = { ok: entries >= 1 && repoOk && dueSeen, entries, repoOk, dueSeen }
  // Whether every step held, which is the case's whole verdict.
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[memory-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 220))
  if (!allOk) process.exit(1)
  console.log("[memory-smoke] PASS")
}

// The raw command-line arguments, in the order the caller passed them.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
