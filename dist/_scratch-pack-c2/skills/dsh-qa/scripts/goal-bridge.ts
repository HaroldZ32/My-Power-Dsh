#!/usr/bin/env node
// Case goal-bridge (C8): the persisted GOAL as the bundle's basis of continuous execution.
//
// WHAT IT PROVES, and why each assertion is the one that carries the claim:
//   1. the `mpd-goal` row MOUNTS in a real isolated boot (the row's own log line, written by
//      `dsh.rowLog` at apply time — registration instrumentation, not a composed row list);
//   2. a REAL headless session calls `mpd_goal_anchor`, read from the HARNESS's session log
//      (`tool/call` + a non-error `tool/result`) — never from the model's prose, which cannot
//      distinguish "called it" from "said I called it";
//   3. the call SUCCEEDED end to end, which is the only thing that proves the adapter resolved the
//      goal trio in the CALLING AGENT's own scoped registry (a host-plane registry answers
//      "unknown tool" for a preset-plane row, and the refusal would still be a recorded call);
//   4. the durable anchor sidecar `<ws>/.mpd/goal/anchors.json` exists and names that goal — the
//      ownership record that keeps a later run from completing a goal it did not arm;
//   5. `mpd_goal_status` reports the same goal in the same session.
// Isolation is THREE things (AGENTS.md §7): DSH_HOME=<sandbox>, HOME=<sandbox>, and a sandboxed
// workspace carried as the spawn cwd, asserted host-side by `assertSessionsSandboxed`.
//
// Usage: node skills/dsh-qa/scripts/goal-bridge.ts [--self-test]
// Evidence: evidence/goal/goal-bridge/<ts>/{result.json,output.log}
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import { findToolCall, readSessionEvents, recordedToolNames } from "./lib/session-evidence.ts"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"

/** The repository root, derived from this script's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))

/** The isolated profile install's outcome. */
interface InstallStep {
  /** Whether the installer exited 0. */
  readonly ok: boolean
  /** The installer's exit status, or `null` when a signal killed it. */
  readonly exit: number | null
}

/** The installed row set, read from the home patch the installer wrote. */
interface RowsStep {
  /** Whether the `mpd-goal` row is present in the installed patch. */
  readonly ok: boolean
}

/** The mount instrumentation: the row's own apply-time log line. */
interface MountStep {
  /** Whether `<ws>/.mpd/logs/mpd-goal.log` carries the mounted line. */
  readonly ok: boolean
  /** The line, or null when the log does not exist. */
  readonly line: string | null
}

/** The live headless session's outcome. */
interface LiveStep {
  /** Whether the session exited 0. */
  readonly ok: boolean
  /** The session's exit status, or `null` when a signal killed it. */
  readonly exit: number | null
}

/** The harness-recorded evidence for the two goal tools. */
interface ToolStep {
  /** Whether `mpd_goal_anchor` has a recorded call AND a non-error result. */
  readonly ok: boolean
  /** Whether the tool was called at all, and a human-readable cause when it was not. */
  readonly anchor: { called: boolean; succeeded: boolean; reason: string }
  /** The same verdict for `mpd_goal_status`. */
  readonly status: { called: boolean; succeeded: boolean; reason: string }
  /** Whether the request header offered both tools to the model. */
  readonly offered: boolean
}

/** The durable anchor sidecar's outcome. */
interface AnchorStep {
  /** Whether the sidecar exists and names a goal id. */
  readonly ok: boolean
  /** The sidecar path inspected. */
  readonly file: string
  /** The goal id the sidecar recorded, or null. */
  readonly goalId: string | null
}

/** The three-isolation assertion. */
interface IsolationStep {
  /** Whether every session-store key belongs to the sandbox workspace. */
  readonly ok: boolean
  /** How many keys were inspected. */
  readonly keys: number
}

/** The graded steps of one run, in evidence order. */
type GoalSteps = {
  /** The isolated install. */
  installer: InstallStep
  /** The installed row set. */
  rows: RowsStep
  /** The apply-time mount line. */
  mount: MountStep
  /** The live session. */
  live: LiveStep
  /** The harness-recorded tool evidence. */
  tools: ToolStep
  /** The durable anchor sidecar. */
  anchors: AnchorStep
  /** The workspace-isolation assertion. */
  isolation: IsolationStep
}

/** The offline arm: the row is wired in both mount paths, and the seam's own suites pass. */
function selfTest(): void {
  console.log("[goal-bridge self-test] offline assertions")
  /** The bundle patch that must declare the row. */
  const bundle = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  /** The legacy installer source, which mirrors that row for the dev/QA install path. */
  const installer = readFileSync(join(repoRoot, "scripts", "install-profile.ts"), "utf8")
  if (!bundle.includes("id: mpd-goal")) { console.error("[goal-bridge self-test] FAIL: no mpd-goal row in cordis.patch.yml"); process.exit(1) }
  if (!installer.includes('id: "mpd-goal"')) { console.error("[goal-bridge self-test] FAIL: install-profile.ts does not mirror the mpd-goal row"); process.exit(1) }
  /** The package/label pairs whose unit suites gate this case. */
  const suites: ReadonlyArray<readonly [string, string]> = [
    ["packages/mpd-goal-plugin", "mpd-goal-plugin"],
    ["packages/mpd-dsh-adapter-plugin", "mpd-dsh-adapter-plugin (the goal seam)"],
  ]
  for (const [pkg, label] of suites) {
    /** The `bun test` run for this package. */
    const run = spawnSync("bun", ["test"], { cwd: join(repoRoot, pkg), encoding: "utf8", timeout: 300000 })
    if (run.status !== 0 || !/\d+ pass/.test(run.stdout + run.stderr)) { console.error("[goal-bridge self-test] FAIL: unit suite " + label); process.exit(1) }
  }
  console.log("[goal-bridge self-test] ok: row declared in both mount paths + both unit suites pass")
}

/** The live arm: one isolated install, one real headless session, and host-side evidence. */
async function runReal(): Promise<void> {
  /** The real home's credentials store, read only as the seeding source. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[goal-bridge] missing credentials at " + creds); process.exit(1) }
  /** The evidence directory timestamp, with `:` replaced so the name is portable. */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes into. */
  const outDir = join(repoRoot, "evidence", "goal", "goal-bridge", ts)
  mkdirSync(outDir, { recursive: true })
  /** The ephemeral DSH_HOME this whole case runs inside. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-goal-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // AGENTS.md §7: a live case must ALSO stage `settings.yaml` when present, or a gateway-configured
  // chain falls back to the base route and the boot dies with MISSING_CREDENTIAL.
  /** The real home's settings document, staged so gateway-configured routes survive isolation. */
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(sandbox, "settings.yaml"))
  /** The sandboxed session workspace the live boot runs in — the cwd every session key derives from. */
  const ws = sandboxWorkspace(sandbox, "ws")
  /** The child environment: the real one with DSH_HOME repointed, HOME pinned at the sandbox and the
   * workspace root named for every row, so an exec-less resolution cannot reach the real checkout. */
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox, DSH_WORKSPACE_ROOT: ws })
  /** The graded steps, filled in as each is measured. */
  const steps = {} as GoalSteps

  /** The isolated profile install (the dev/QA mount path). */
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  /** The installed home patch, read for the row-set assertion. */
  const patch = existsSync(join(sandbox, "cordis.patch.yml")) ? readFileSync(join(sandbox, "cordis.patch.yml"), "utf8") : ""
  steps.rows = { ok: patch.includes("mpd-goal") }

  /** The one-session task: anchor a goal, then read it back. Both are the model's own calls. */
  const task = [
    "Goal-bridge self-test for the mpd bundle:",
    "1) call mpd_goal_anchor with objective 'ship the goal bridge' and maxRounds 5;",
    "2) call mpd_goal_status;",
    "3) report the anchor outcome (ok/created) and the goal id, objective and phase from the status result."
  ].join(" ")
  /** The resolved dsh launcher invocation, or `null` when no launcher is on PATH. */
  const liveSpec = dshCommand(["--profile", "mpd-headless", task], env)
  /** The live session's result, or the synthetic no-launcher result that fails this step. */
  const live = liveSpec === null
    ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) }
    : spawnSync(liveSpec.command, liveSpec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  /** The session's combined output, filed as evidence (assertions never read it as proof). */
  const out = (live.stdout || "") + (live.stderr || "")
  steps.live = { ok: live.status === 0, exit: live.status }

  /** The row's own apply-time log line: registration instrumentation for the mount claim. */
  const logFile = join(ws, ".mpd", "logs", "mpd-goal.log")
  /** The mounted line, when the row logged one. */
  const logLine = existsSync(logFile) ? (readFileSync(logFile, "utf8").split("\n").find((line) => line.includes("mounted:")) ?? null) : null
  steps.mount = { ok: logLine !== null, line: logLine }

  /** The harness's own session store for the sandbox workspace. */
  const store = readSessionEvents(sandbox, { workspace: ws })
  /** The recorded evidence for the anchor call. */
  const anchor = findToolCall(store, "mpd_goal_anchor")
  /** The recorded evidence for the status call. */
  const status = findToolCall(store, "mpd_goal_status")
  /** The tool names the request headers offered, the ground truth for availability. */
  const offered = recordedToolNames(store)
  steps.tools = {
    ok: anchor.succeeded && status.succeeded && offered.includes("mpd_goal_anchor") && offered.includes("mpd_goal_status"),
    anchor: { called: anchor.called, succeeded: anchor.succeeded, reason: anchor.reason },
    status: { called: status.called, succeeded: status.succeeded, reason: status.reason },
    offered: offered.includes("mpd_goal_anchor") && offered.includes("mpd_goal_status"),
  }

  /** The durable anchor sidecar the row writes under the CALLING workspace. */
  const sidecar = join(ws, ".mpd", "goal", "anchors.json")
  /** The goal id the sidecar recorded, when it parsed. */
  let goalId: string | null = null
  if (existsSync(sidecar)) {
    try {
      /** The parsed sidecar, read defensively: it is hand-editable state. */
      const parsed = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, { goalId?: unknown }>
      /** The first recorded anchor's goal id. */
      const first = Object.values(parsed)[0]
      goalId = typeof first?.goalId === "string" ? first.goalId : null
    } catch { /* keep null: an unparsable sidecar is a failure below, not a crash here */ }
  }
  steps.anchors = { ok: goalId !== null, file: sidecar, goalId }

  // THREE-WAY ISOLATION: no session-store key may belong to the real checkout, the real home or
  // this process's cwd. Runs after the boot so it inspects what the boot actually wrote.
  try {
    /** The isolation verdict for the sandbox store. */
    const verdict = assertSessionsSandboxed(sandbox, sandbox, { label: "goal-bridge" })
    steps.isolation = { ok: verdict.ok, keys: verdict.checked }
  } catch (error) {
    steps.isolation = { ok: false, keys: -1 }
    console.error("[goal-bridge] isolation FAILED: " + String((error as Error)?.message ?? error))
  }

  /** Whether every graded step passed. */
  const allOk = Object.values(steps).every((step) => step.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, ws, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[goal-bridge] ok=" + allOk + " -> " + outDir)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify(value).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[goal-bridge] PASS")
}

/** The CLI arguments after the script path: `--self-test` selects the offline arm. */
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
