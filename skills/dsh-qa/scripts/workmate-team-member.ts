#!/usr/bin/env node
// Case workmate-team-member: real end-to-end proof that a workmate instance acts as a
// TEAM member in dsh-agent-teams with its persona+memory injected via the patched
// memberPersona, and that the member self-reflects (mpd_workmate_reflect) after its task:
//   1) offline self-test: workmate dist, memberPersona injection patch, agent-teams tool
//      param names, preset guidance;
//   2) real headless boot (isolated DSH_HOME + SANDBOX HOME): init alice -> reflect a
//      distinctive memory (PINEAPPLE42) -> agent_teams_create (automatic) ->
//      add_member alice (deepseek-official/deepseek-v4-flash) -> create_task for alice
//      asking it to report the build token and to reflect -> status.
// Assert: the captain reads PINEAPPLE42 back (memory injection into the member persona),
// and alice's memory.md gains a second PINEAPPLE42 entry / uses>=2 (the member reflected).
// The real home is never touched (HOME=<sandbox>).
// Evidence -> evidence/plan-f/workmate-team-member/<ts>/. --self-test is offline.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import { readMpdPresetSource } from "./lib/preset-source.ts"

/** The `--json` dump capture parsed back: the wrapper prints the child's own stdout under `stdout`. */
interface DumpCapture {
  /** The child's stdout as the wrapper captured it, absent when the capture carried none. */
  readonly stdout?: string
}

/** The `meta.json` bookkeeping this case reads: the `uses` counter that `reflect` bumps. */
interface WorkmateMeta {
  /**
   * How many times the workmate has been used. The product always writes this counter, and init
   * starts it at 0, so the run's own comparison reads a number rather than a missing field.
   */
  readonly uses: number
}

/** One entry of the run's verdict ledger, so `allOk` can fold every step by its `ok`. */
interface StepVerdict {
  /** Whether this step held; every step this case records carries one. */
  readonly ok: boolean
  /** The step's own evidence fields, recorded verbatim in `result.json`. */
  readonly [field: string]: unknown
}

/** The optional knobs of the case's own `spawnSync` wrapper. */
interface RunSyncOptions {
  /** Per-child timeout in milliseconds, defaulted to the long live-model bound. */
  readonly timeout?: number
  /** The child's working directory, defaulted to the repository root. */
  readonly cwd?: string
}

/** What the case's `spawnSync` wrapper reports back to its caller. */
interface ChildRun {
  /** The child's exit status, or `null` when nothing ran (no `dsh` launcher resolved). */
  readonly status: number | null
  /** The child's stdout and stderr, concatenated for the marker assertions. */
  readonly out: string
}

/**
 * The wrapper's `--json` capture, parsed for its `stdout` field. `JSON.parse` answers an untyped
 * value, so the parsed capture is asserted to the single field this case reads; a capture that is
 * not JSON yields `null` rather than throwing. (The cast is unavoidable: no narrowing can relate
 * an arbitrary parsed value to the field the wrapper is documented to print.)
 */
const safeJson = (text: string): DumpCapture | null => { try { return JSON.parse(text) as DumpCapture } catch { return null } }
// .../skills/dsh-qa/scripts/workmate-team-member.ts -> the repository root.
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The live prompt: drives init -> reflect -> team creation -> add_member -> task -> status. */
const PROMPT: string = `Perform this exact sequence with the tools and report each result:
1) mpd_workmate_init {base:"hephaestus", name:"alice"}
2) mpd_workmate_reflect {name:"alice", task:"memorize build token", outcome:"alice remembers the build token is PINEAPPLE42"}
3) agent_teams_create {name:"wmverify", description:"verify a workmate-backed team member", approval:"automatic"}
4) agent_teams_add_member {name:"alice", provider:"deepseek-official", model:"deepseek-v4-flash"}
5) agent_teams_create_task {subject:"report build token", description:"Reply in one sentence: what does your independent workmate memory say about the build token? Then call mpd_workmate_reflect {name:alice, task:report build token, outcome:<your one-sentence reply>} before you finish.", assignee:"alice"}
6) Wait for the scheduler to run the task, then call agent_teams_status and read member alice's output.
End with the word DONE.`

/** Report one failed case assertion and end the run with exit 1; never returns. */
function fail(msg: string): never { console.error("[workmate-team-member] FAIL: " + msg); process.exit(1) }

/** The offline arm: static pins of the dist, the persona patch, the tool params and the preset. */
function selfTest(): void {
  // Every assertion label paired with its verdict, so one run reports each break by name.
  const checks: Array<[string, boolean]> = []
  checks.push(["workmate dist built", existsSync(join(repoRoot, "packages", "mpd-workmate-plugin", "dist", "index.js"))])
  // The adopted plugin's member-persona source, which is what injects the workmate's memory.
  const members = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "members.ts"), "utf8")
  checks.push(["memberPersona workmate injection", members.includes("function workmateBacking") && members.includes("mpd_workmate_reflect") && members.includes("11. " + "Durable workmate backing".slice(0, 4)) || members.includes("Durable workmate backing")])
  // The retired adopted plugin's tool table, whose parameter names the live prompt relies on.
  const tools = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "tools.ts"), "utf8")
  checks.push(["agent_teams_create param name", tools.includes("agent_teams_create") && tools.includes("name: { type: 'string', required: true, description: 'Name for the new team")])
  checks.push(["agent_teams_add_member param name", tools.includes("agent_teams_add_member") && tools.includes("Unique member name inside the team")])
  checks.push(["agent_teams_create_task subject", tools.includes("agent_teams_create_task") && tools.includes("Required non-empty title for this task")])
  // 0.1.7-rc.2 ROW MODEL: the mpd composition is an inline `config.plugins` list in
  // the `preset-mpd` row of the manifest's second bundle patch — there is no
  // `presets/mpd/` directory any more. Read the DECLARED source, never a path.
  const preset = readMpdPresetSource(repoRoot)
  // RETIREMENT (2026-09-27): team work runs on the OFFICIAL Agent Teams plugin now
  // (`spawn_teammate` / `team_task_create` / `list_agents`), not the retired
  // vendored `agent_teams_*` surface — so the preset must name the ADOPTED
  // vocabulary, and the workmate guidance must still be there.
  checks.push(["mpd preset TEAM WORK (official tools) + WORKMATE guidance", preset.includes("spawn_teammate") && preset.includes("team_task_create") && preset.includes("WORKMATE LIBRARY")])
  // The labels that failed, printed together so one run reports every break.
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) fail("self-test: " + bad.join(" | "))
  console.log("[workmate-team-member self-test] ok: " + checks.length + " checks")
}

/** The live arm: an isolated boot that drives a workmate-backed team member end to end. */
function runReal(): void {
  // The declared credential store, copied ONCE into the sandbox (never read from the real home).
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  // The real workmate library, which must be byte-identical before and after the run.
  const realWm = join(homedir(), ".mpd", "workmate")
  // DEFECT (measured 2026-09-14): this case asserted the REAL workmate library must
  // NOT exist. That is false on any machine that ever used one — this repo's own home
  // already has ~/.mpd/workmate/index.json — so the case failed for the environment,
  // not for the change. The invariant that matters is that the case does not TOUCH it:
  // snapshot the listing now and require it unchanged at the end.
  const realWmBefore = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  // The run's timestamp, which names the evidence directory and holds no path separator.
  const ts = new Date().toISOString().replaceAll(":", "-")
  // The evidence directory this run writes its verdict and log into.
  const outDir = join(repoRoot, "evidence", "plan-f", "workmate-team-member", ts)
  mkdirSync(outDir, { recursive: true })
  // The sandbox `DSH_HOME` the boot reads; the real harness home is never touched.
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-wtm-dsh-"))
  // The sandbox `HOME`, which is what puts `~/.mpd/workmate` inside the sandbox.
  const wmHome = mkdtempSync(join(tmpdir(), "mpd-wtm-home-"))
  // The sandbox workspace, passed explicitly as every spawn's cwd.
  const ws = join(wmHome, "ws")
  mkdirSync(ws, { recursive: true })
  seedSandboxCredentials(dshHome, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
  // model chain is configured through gateway providers (llm-pi-ai), so without it the
  // sandbox falls back to the base `deepseek-official` route and the boot dies with
  // MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
  // `--self-test` stayed green because it never boots). Same idiom as the cases that
  // already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(dshHome, "settings.yaml"))
  writeFileSync(join(ws, "README.md"), "# my-power-dsh\nworkmate team-member e2e workspace\n")
  // The child environment: the sandbox home pair plus the resolved provider credential.
  const env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: wmHome  })
  // The run's verdict ledger, one entry per step this case asserts.
  const steps: Record<string, StepVerdict> = {}
  /**
   * Run one child with the sandbox environment.
   * @param cmd The command name, or `dsh` to go through the PATH-resolved launcher.
   * @param args The argument vector.
   * @param opts Optional timeout and working directory.
   * @returns The child's status and its joined output.
   */
  function runSync(cmd: string, args: string[], opts: RunSyncOptions = {}): ChildRun {
    // The launcher spec: `dsh` is PATH-resolved (win32 needs its shim), any other name is verbatim.
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    // The child's result, or a synthetic miss when no `dsh` launcher resolves at all.
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }

  // The isolated install, which is what materializes the profile the boot reads.
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.install = { ok: inst.status === 0, exit: inst.status }

  // T-69: compose through the wrapper (the banner lands on STDERR under `--json`, so the child's
  // own output stays parseable and the "composition only" claim travels with the reading).
  const dump = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "mpd-headless", "--json"], { timeout: 120000 })
  // The composed tree, banner-free — the part the assertions read.
  const dumpText = safeJson(dump.out)?.stdout ?? dump.out
  steps.dump = { ok: dump.status === 0 && dumpText.includes("id: mpd-workmate") && dumpText.includes("id: mpd-roles") && dumpText.includes("id: agent-teams"), exit: dump.status }

  // The live boot that drives the whole workmate-backed team flow.
  const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 900000, cwd: ws })
  // The boot's whole output, which the marker assertions read.
  const out = live.out
  // The sandbox workmate library root, which the product resolves from the sandbox HOME.
  const wmRoot = join(wmHome, ".mpd", "workmate")
  // The instance under test, named by the prompt's `name:"alice"`.
  const alice = join(wmRoot, "alice")
  // The durable memory the member's own reflect must have appended to.
  const memory = existsSync(join(alice, "memory.md")) ? readFileSync(join(alice, "memory.md"), "utf8") : ""
  // The instance's bookkeeping; 0 uses when init never wrote a meta.json.
  const meta: WorkmateMeta = existsSync(join(alice, "meta.json")) ? JSON.parse(readFileSync(join(alice, "meta.json"), "utf8")) : { uses: 0 }
  // How many times the distinctive token appears, which is the reflection's own evidence.
  const tokenCount = (memory.match(/PINEAPPLE42/g) || []).length
  steps.live = { ok: live.status === 0 && !out.includes("ERR_MODULE_NOT_FOUND"), exit: live.status }
  steps.injection = { ok: out.includes("PINEAPPLE42") && out.includes("DONE"), sample: out.slice(-1600).replace(/\n/g, " | ").slice(0, 700) }
  // The member must have self-reflected: memory gained a second token entry (step 2 +
  // the member's mpd_workmate_reflect) and/or uses >= 2.
  steps.reflect = { ok: tokenCount >= 2 || meta.uses >= 2, tokenCount, uses: meta.uses }
  steps.files = { ok: existsSync(join(alice, "meta.json")) && existsSync(join(alice, "persona.md")) && existsSync(join(alice, "memory.md")), memory: memory.slice(0, 200) }
  // The real library's listing AFTER the run, which must equal the before-snapshot.
  const realWmAfter = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  steps.isolation = { ok: realWmAfter === realWmBefore, realWm, before: realWmBefore, after: realWmAfter }

  // The run's single verdict: every recorded step must have held.
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, dshHome, wmHome, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump ---\n" + dump.out.slice(0, 20000))
  console.log("[workmate-team-member] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[workmate-team-member] PASS")
}

// The argv the case dispatches on: `--self-test` runs the offline arm, anything else the live one.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
