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
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.mjs"

const safeJson = (text) => { try { return JSON.parse(text) } catch { return null } }
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PROMPT = `Perform this exact sequence with the tools and report each result:
1) mpd_workmate_init {base:"hephaestus", name:"alice"}
2) mpd_workmate_reflect {name:"alice", task:"memorize build token", outcome:"alice remembers the build token is PINEAPPLE42"}
3) agent_teams_create {name:"wmverify", description:"verify a workmate-backed team member", approval:"automatic"}
4) agent_teams_add_member {name:"alice", provider:"deepseek-official", model:"deepseek-v4-flash"}
5) agent_teams_create_task {subject:"report build token", description:"Reply in one sentence: what does your independent workmate memory say about the build token? Then call mpd_workmate_reflect {name:alice, task:report build token, outcome:<your one-sentence reply>} before you finish.", assignee:"alice"}
6) Wait for the scheduler to run the task, then call agent_teams_status and read member alice's output.
End with the word DONE.`

function fail(msg) { console.error("[workmate-team-member] FAIL: " + msg); process.exit(1) }

function selfTest() {
  const checks = []
  checks.push(["workmate dist built", existsSync(join(repoRoot, "packages", "mpd-workmate-plugin", "dist", "index.js"))])
  const members = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "members.js"), "utf8")
  checks.push(["memberPersona workmate injection", members.includes("function workmateBacking") && members.includes("mpd_workmate_reflect") && members.includes("11. " + "Durable workmate backing".slice(0, 4)) || members.includes("Durable workmate backing")])
  const tools = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "tools.js"), "utf8")
  checks.push(["agent_teams_create param name", tools.includes("agent_teams_create") && tools.includes("name: { type: 'string', required: true, description: 'Name for the new team")])
  checks.push(["agent_teams_add_member param name", tools.includes("agent_teams_add_member") && tools.includes("Unique member name inside the team")])
  checks.push(["agent_teams_create_task subject", tools.includes("agent_teams_create_task") && tools.includes("Required non-empty title for this task")])
  const preset = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
  checks.push(["mpd preset TEAM WORK + WORKMATE guidance", preset.includes("agent_teams_create") && preset.includes("WORKMATE LIBRARY")])
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) fail("self-test: " + bad.join(" | "))
  console.log("[workmate-team-member self-test] ok: " + checks.length + " checks")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const realWm = join(homedir(), ".mpd", "workmate")
  // DEFECT (measured 2026-09-14): this case asserted the REAL workmate library must
  // NOT exist. That is false on any machine that ever used one — this repo's own home
  // already has ~/.mpd/workmate/index.json — so the case failed for the environment,
  // not for the change. The invariant that matters is that the case does not TOUCH it:
  // snapshot the listing now and require it unchanged at the end.
  const realWmBefore = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-f", "workmate-team-member", ts)
  mkdirSync(outDir, { recursive: true })
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-wtm-dsh-"))
  const wmHome = mkdtempSync(join(tmpdir(), "mpd-wtm-home-"))
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
  const env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: wmHome  })
  const steps = {}
  function runSync(cmd, args, opts = {}) {
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.install = { ok: inst.status === 0, exit: inst.status }

  // T-69: compose through the wrapper (the banner lands on STDERR under `--json`, so the child's
  // own output stays parseable and the "composition only" claim travels with the reading).
  const dump = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.mjs"), "--profile", "mpd-headless", "--json"], { timeout: 120000 })
  const dumpText = safeJson(dump.out)?.stdout ?? dump.out
  steps.dump = { ok: dump.status === 0 && dumpText.includes("id: mpd-workmate") && dumpText.includes("id: mpd-roles") && dumpText.includes("id: agent-teams"), exit: dump.status }

  const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 900000, cwd: ws })
  const out = live.out
  const wmRoot = join(wmHome, ".mpd", "workmate")
  const alice = join(wmRoot, "alice")
  const memory = existsSync(join(alice, "memory.md")) ? readFileSync(join(alice, "memory.md"), "utf8") : ""
  const meta = existsSync(join(alice, "meta.json")) ? JSON.parse(readFileSync(join(alice, "meta.json"), "utf8")) : { uses: 0 }
  const tokenCount = (memory.match(/PINEAPPLE42/g) || []).length
  steps.live = { ok: live.status === 0 && !out.includes("ERR_MODULE_NOT_FOUND"), exit: live.status }
  steps.injection = { ok: out.includes("PINEAPPLE42") && out.includes("DONE"), sample: out.slice(-1600).replace(/\n/g, " | ").slice(0, 700) }
  // The member must have self-reflected: memory gained a second token entry (step 2 +
  // the member's mpd_workmate_reflect) and/or uses >= 2.
  steps.reflect = { ok: tokenCount >= 2 || meta.uses >= 2, tokenCount, uses: meta.uses }
  steps.files = { ok: existsSync(join(alice, "meta.json")) && existsSync(join(alice, "persona.md")) && existsSync(join(alice, "memory.md")), memory: memory.slice(0, 200) }
  const realWmAfter = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  steps.isolation = { ok: realWmAfter === realWmBefore, realWm, before: realWmBefore, after: realWmAfter }

  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, dshHome, wmHome, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump ---\n" + dump.out.slice(0, 20000))
  console.log("[workmate-team-member] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[workmate-team-member] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
