#!/usr/bin/env node
// Case plan-c-smoke (Plan C Wave A live proof): one real headless session
// exercising the C3/C5/C7 surfaces together —
//   mpd_config_get (mpd.jsonc layer), mpd_boulder_start/task_timer/complete
//   (boulder ledger), mpd_hashline_read/edit (anchored edit discipline).
// Isolated DSH_HOME; evidence -> evidence/plan-c/plan-c-smoke/<ts>/.
// --self-test is the offline self-test (rows + unit suites).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this script's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The live prompt placeholder, kept as the original empty join (never sent as the task text). */
const PROMPT = [""].join("")

/** The isolated installer's outcome. */
interface InstallerStep {
  /** Whether the profile install exited 0. */
  readonly ok: boolean
  /** The installer's exit status, or `null` when it was killed by a signal. */
  readonly exit: number | null
}

/** The row-set assertion over the installed home patch. */
interface RowsStep {
  /** Whether every Plan C row id is present in the installed patch. */
  readonly ok: boolean
  /** Whether the patch carries the `mpd-config` row specifically. */
  readonly patch: boolean
}

/** The live headless session's outcome. */
interface LiveStep {
  /** Whether the session exited 0. */
  readonly ok: boolean
  /** The session's exit status, or `null` when it was killed by a signal. */
  readonly exit: number | null
}

/** One entry of the ledger's `works` map, as far as this case reads it. */
type LedgerWork = {
  /** Stable key of this work inside `works`; the ledger always writes it. */
  readonly work_id: string
  /** Lifecycle of this work; absent on a ledger that never recorded one. */
  readonly status?: string
  /** Per-task timers, keyed by the plan's top-level task key. */
  readonly task_sessions?: Record<string, unknown> | null
}

/** The persisted boulder ledger `.mpd/boulder.json`, as far as this case reads it. */
type BoulderLedger = {
  /** Work whose fields the top-level mirror reflects; absent on a pre-`works` ledger. */
  readonly active_work_id?: string
  /** Every recorded work, keyed by work id. */
  readonly works?: Record<string, LedgerWork> | null
}

/** One boulder work, projected from the ledger's own fields. */
interface BoulderWork {
  /** The ledger's work id. */
  readonly work_id: string
  /** The work's status at read time, absent when the ledger never wrote one. */
  readonly status?: string
  /** How many task sessions the work recorded. */
  readonly tasks: number
}

/** The boulder ledger assertion over `.mpd/boulder.json`. */
interface BoulderStep {
  /** Whether a COMPLETED work was found. */
  readonly ok: boolean
  /** The projected work, or `null` when the ledger held none. */
  readonly boulderWork: BoulderWork | null
}

/** The hashline anchored-edit assertion over `note.txt`. */
interface HashlineStep {
  /** Whether `note.txt` exists and carries the edited line. */
  readonly ok: boolean
  /** The file's full content, or `null` when it does not exist. */
  readonly note: string | null
}

/** The mpd.jsonc config-layer assertion over the session output. */
interface ConfigStep {
  /** Whether the output reported the configured `memory.vcs` value. */
  readonly ok: boolean
  /** Whether the output mentions `vcs` at all. */
  readonly sawConfig: boolean
}

/**
 * The graded steps of one live run, in the order the evidence document lists them.
 * A type alias (not an interface) so `Object.values`/`Object.entries` infer their element type.
 */
type PlanCSteps = {
  /** The isolated profile install. */
  installer: InstallerStep
  /** The installed row set. */
  rows: RowsStep
  /** The live headless session. */
  live: LiveStep
  /** The boulder ledger round-trip. */
  boulder: BoulderStep
  /** The hashline anchored edit. */
  hashline: HashlineStep
  /** The mpd.jsonc config layer. */
  config: ConfigStep
}

/** The offline arm: assert the Plan C rows are wired and the three unit suites pass. */
function selfTest(): void {
  /** The bundle patch whose rows this case mounts. */
  const bundle = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  /** The installer source this case spawns, read here only for the row-set assertion. */
  const installer = readFileSync(join(repoRoot, "scripts", "install-profile.ts"), "utf8")
  for (const id of ["mpd-hashline", "mpd-boulder", "mpd-config"]) {
    if (!bundle.includes("id: " + id) || !installer.includes(id)) { console.error("[plan-c-smoke self-test] FAIL: missing row " + id); process.exit(1) }
  }
  /** The package/label pairs whose unit suites gate this case. */
  const suites: ReadonlyArray<readonly [string, string]> = [
    ["packages/mpd-hashline-plugin", "hashline"],
    ["packages/mpd-boulder-plugin", "boulder"],
    ["packages/mpd-config-plugin", "config"]
  ]
  for (const [pkg, label] of suites) {
    /** The `bun test` run for this package. */
    const r = spawnSync("bun", ["test"], { cwd: join(repoRoot, pkg), encoding: "utf8", timeout: 120000 })
    if (r.status !== 0 || !/\d+ pass/.test(r.stdout + r.stderr)) { console.error("[plan-c-smoke self-test] FAIL: unit suite " + label); process.exit(1) }
  }
  console.log("[plan-c-smoke self-test] ok: rows + unit suites verified")
}

/** The live arm: one isolated headless session exercising the C3/C5/C7 surfaces. */
async function runReal(): Promise<void> {
  /** The real home's credentials store, read only as the seeding source. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[plan-c-smoke] missing credentials"); process.exit(1) }
  /** The evidence directory timestamp, with `:` replaced so the name is portable. */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes `result.json` and `output.log` into. */
  const outDir = join(repoRoot, "evidence", "plan-c", "plan-c-smoke", ts)
  mkdirSync(outDir, { recursive: true })
  /** The ephemeral DSH_HOME this whole case runs inside. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-wa-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  /** The real home's settings document, staged so gateway-configured routes survive isolation. */
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(sandbox, "settings.yaml"))
  /** The sandboxed session workspace the live boot runs in. */
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  /** The child environment: the real one with DSH_HOME repointed at the sandbox. */
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  /** The graded steps of this run, filled in as each one is measured. */
  const steps = {} as PlanCSteps

  /** The isolated profile install. */
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  /** The installed home patch, read for the row-set assertion. */
  const patch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.rows = { ok: ["mpd-hashline", "mpd-boulder", "mpd-config"].every((id) => patch.includes(id)), patch: patch.includes("mpd-config") }

  /** The one-session task that exercises all three surfaces. */
  const task = [
    "Plan C Wave A self-test:",
    "1) write .mpd/mpd.jsonc with { ulw: { maxRounds: 4 }, memory: { vcs: 'git' } } then call mpd_config_get with key 'memory.vcs' and report the value;",
    "2) create .mpd/plans/qa.md containing '# QA' and '## TODOs' with '- [ ] 1. First' and '- [x] 2. Second', call mpd_boulder_start on it, mpd_boulder_task_timer start/end for task '1', then mpd_boulder_complete;",
    "3) create note.txt with three lines 'first' 'second' 'third', call mpd_hashline_read, then mpd_hashline_edit to replace line 2 with 'second2', then read note.txt",
    "Report: the config value, the workId and status, and the final note.txt content."
  ].join(" ")

  /** The resolved dsh launcher invocation, or `null` when no launcher is on PATH. */
  const liveSpec = dshCommand(["--profile", "mpd-headless", task], env)
  /** The live session's result, or the synthetic no-launcher result that fails this step. */
  const live = liveSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(liveSpec.command, liveSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  /** The session's combined output, asserted by the config step. */
  const out = (live.stdout || "") + (live.stderr || "")
  steps.live = { ok: live.status === 0, exit: live.status }

  /** The boulder ledger path inside the sandboxed workspace. */
  const boulderFile = join(ws, ".mpd", "boulder.json")
  /** Whether a COMPLETED boulder work was found. */
  let boulderOk = false, boulderWork: BoulderWork | null = null
  if (existsSync(boulderFile)) {
    try {
      /** The parsed boulder ledger document, viewed as the fields this case reads. */
      const b: BoulderLedger = JSON.parse(readFileSync(boulderFile, "utf8"))
      // The active id is absent on a pre-`works` ledger, where the lookup falls back to the newest
      // work; the assertion only satisfies the index type and is erased at runtime.
      /** The active work, falling back to the first recorded work. */
      const work = b.works?.[b.active_work_id!] ?? Object.values(b.works ?? {})[0]
      boulderOk = !!work && work.status === "completed"
      boulderWork = work ? { work_id: work.work_id, status: work.status, tasks: Object.keys(work.task_sessions ?? {}).length } : null
    } catch { /* keep false */ }
  }
  steps.boulder = { ok: boulderOk, boulderWork }

  /** The note file the hashline edit rewrites. */
  const note = join(ws, "note.txt")
  /** Whether `note.txt` carries the edited line. */
  const noteOk = existsSync(note) && readFileSync(note, "utf8").includes("second2")
  steps.hashline = { ok: noteOk, note: existsSync(note) ? readFileSync(note, "utf8") : null }

  /** Whether the session output reported the configured vcs value. */
  const configOk = /(git|both|svn)/.test(out) && out.includes("memory.vcs")
  steps.config = { ok: configOk, sawConfig: /vcs/.test(out) }

  /** Whether every graded step passed. */
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[plan-c-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 250))
  if (!allOk) process.exit(1)
  console.log("[plan-c-smoke] PASS")
}

/** The CLI arguments after the script path: `--self-test` selects the offline arm. */
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
