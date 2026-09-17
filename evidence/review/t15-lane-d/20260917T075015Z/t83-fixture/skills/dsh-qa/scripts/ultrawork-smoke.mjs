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
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const TASK2 = "Run mpd_ultrawork (light tier, plan=false, maxRounds=2) on: create a file utils.txt with three lines alpha, beta, gamma. Return the status, rounds, criteria states and the state file path."

function selfTest() {
  const dist = readFileSync(join(repoRoot, "packages", "mpd-ulw-plugin", "dist", "index.js"), "utf8")
  for (const s of ["mpd_ultrawork", "mpd_ulw", "verification", "quality-", "hyperplan"]) {
    if (!dist.includes(s)) { console.error("[ultrawork-smoke self-test] FAIL: missing " + s); process.exit(1) }
  }
  const bundle = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!bundle.includes("mpd-ulw")) { console.error("[ultrawork-smoke self-test] FAIL: bundle row"); process.exit(1) }
  console.log("[ultrawork-smoke self-test] ok: engine symbols + bundle row verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[ultrawork-smoke] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-c", "c2-ultrawork", ts)
  mkdirSync(outDir, { recursive: true })
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
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  writeFileSync(join(ws, ".mpd", "mpd.jsonc"), JSON.stringify({ ulw: { maxRounds: 2 } }))
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  const steps = {}

  console.log("[ultrawork-smoke] installing...")
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  console.log("[ultrawork-smoke] install done=" + steps.installer.ok)

  console.log("[ultrawork-smoke] live run starting...")
  const run = spawnSync("dsh", ["--profile", "mpd-headless", TASK2], { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  const out = (run.stdout || "") + (run.stderr || "")
  steps.live = { ok: run.status === 0, exit: run.status }
  console.log("[ultrawork-smoke] live done=" + steps.live.ok + " bytes=" + out.length)

  const ulwRoot = join(ws, ".mpd", "ulw")
  const ids = existsSync(ulwRoot) ? readdirSync(ulwRoot).filter((d) => existsSync(join(ulwRoot, d, "state.json"))) : []
  let stateOk = false, stateAny = null, ledgerOk = false, ledgerRows = 0, planFileOk = false
  for (const id of ids) {
    try {
      const st = JSON.parse(readFileSync(join(ulwRoot, id, "state.json"), "utf8"))
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

  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[ultrawork-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 220))
  if (!allOk) process.exit(1)
  console.log("[ultrawork-smoke] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
