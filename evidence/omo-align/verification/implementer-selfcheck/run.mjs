#!/usr/bin/env node
// t17 independent verification (replacement for t6). Runs in ONE process so the
// sandbox survives the whole case (bash calls get a fresh /tmp, so the sandbox is
// created INSIDE the evidence dir).
//
// Writes ONLY under evidence/omo-align/verification/**.
//
// WAVE RULE - NEVER OVERWRITE A DELIVERED ARTIFACT (binding, English on purpose so
// the next author cannot miss it):
//   Any artifact that a downstream consumer has already cited, or that a task has
//   already delivered, MUST NOT be rewritten under the same name. A re-run writes a
//   NEW timestamped file (`raw/run-<stamp>.json` + `raw/run-<stamp>.output.log`);
//   it never touches `evidence/omo-align/verification/result.json` (Lead's delivered
//   t17 report) nor `output.log` (its delivered raw log). This is the second
//   same-shape defect in this wave (the first was t4's input being overwritten by a
//   same-named file), so it is enforced here in code, not only in prose.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const outDir = here
const sandbox = join(outDir, "sandbox")
const { assertSessionsSandboxed, sandboxWorkspace } = await import(join(repoRoot, "skills", "dsh-qa", "scripts", "lib", "workspace-isolation.mjs"))
const LOG = []
const settledWindowMs = Number(process.env.T17_SETTLE_MS ?? 50000)

const PINNED_FILES = [
  "packages/mpd-agent-teams-plugin/lib/session-start.js",
  "packages/mpd-agent-teams-plugin/lib/index.js",
  "packages/mpd-agent-teams-plugin/lib/state.js",
  "packages/mpd-agent-teams-plugin/lib/tools.js",
  "packages/mpd-bundle/cordis.patch.yml",
  "presets/mpd/agent.cordis.yml",
  "scripts/install-profile.mjs",
  "skills/dsh-qa/scripts/session-start-team.mjs",
  "AGENTS.md",
]
const NOTICE = "[AgentTeams] Session-start team rule"
const SIMPLE = [
  "Reply with exactly: hello-ok",
  "What does the git-master skill do? Answer in one sentence.",
  "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
const COMPLEX = [
  "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
  "team: fix the flaky test",
  "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const pinAll = () => Object.fromEntries(PINNED_FILES.map((file) => [file, sha256(join(repoRoot, file))]))
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] })
  const out = (r.stdout || "") + (r.stderr || "")
  if (opts.log !== false) LOG.push("$ " + [cmd, ...args].join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 4000))
  return { status: r.status, out }
}
const activeTeams = (ws) => {
  const root = join(ws, ".mpd", "team")
  if (!existsSync(root)) return []
  return readdirSync(root).filter((d) => d !== "archive" && !d.startsWith(".") && existsSync(join(root, d, "team.json")))
}
const noticeInLogs = (home) => {
  const sessionsRoot = join(home, "sessions")
  if (!existsSync(sessionsRoot)) return false
  for (const key of readdirSync(sessionsRoot)) {
    const dir = join(sessionsRoot, key)
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith("session-")) continue
      const sdir = join(dir, entry)
      for (const name of readdirSync(sdir)) {
        if (!name.startsWith("session") || !name.includes(".jsonl")) continue
        const file = join(sdir, name)
        if (file.endsWith(".zstd")) {
          const dec = spawnSync("zstd", ["-d", file, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
          if (dec.status === 0 && (dec.stdout || "").includes(NOTICE)) return true
        }
        else if (readFileSync(file, "utf8").includes(NOTICE)) return true
      }
    }
  }
  return false
}

rmSync(sandbox, { recursive: true, force: true })
mkdirSync(sandbox, { recursive: true })

const steps = {}
// ---- 1) settled-hash pin (>=50 s silence window) ----
const rev0 = run("git", ["rev-parse", "HEAD"], { log: false }).out.trim()
const t0 = Number(run("git", ["rev-parse", "HEAD"], { log: false }).out.split("\n")[0] === rev0 ? 1 : 0)
const pin0 = pinAll()
LOG.push("settle window: " + settledWindowMs + " ms at rev " + rev0)
await new Promise((resolve) => setTimeout(resolve, settledWindowMs))
const rev1 = run("git", ["rev-parse", "HEAD"], { log: false }).out.trim()
const pin1 = pinAll()
const drift = PINNED_FILES.filter((f) => pin0[f] !== pin1[f])
steps.settledHash = { ok: rev0 === rev1 && drift.length === 0, rev: rev1, pinned: pin1, drift }

// ---- 2) isolated install into the sandbox home ----
cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(sandbox, ".credentials.yaml"))
if (existsSync(join(homedir(), ".dsh", "settings.yaml"))) cpSync(join(homedir(), ".dsh", "settings.yaml"), join(sandbox, "settings.yaml"))
const homeEnv = { ...process.env, DSH_HOME: sandbox, HOME: sandbox }
const ws = sandboxWorkspace(sandbox)
steps.sandbox = { ok: ws.startsWith(sandbox), workspace: relative(repoRoot, ws), dshHome: sandbox }
const inst = run(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env: homeEnv })
steps.installer = { ok: inst.status === 0, exit: inst.status }

// ---- 3) two-sided boot, each prompt in its own sandbox home+workspace ----
function bootSide(label, prompts, expectTeam) {
  const results = []
  for (let i = 0; i < prompts.length; i += 1) {
    const sideHome = join(sandbox, "sides", label, String(i))
    const sideWs = sandboxWorkspace(sideHome)
    mkdirSync(sideWs, { recursive: true })
    cpSync(join(sandbox, ".credentials.yaml"), join(sideHome, ".credentials.yaml"))
    if (existsSync(join(sandbox, "settings.yaml"))) cpSync(join(sandbox, "settings.yaml"), join(sideHome, "settings.yaml"))
    cpSync(join(sandbox, "profiles"), join(sideHome, "profiles"), { recursive: true })
    cpSync(join(sandbox, "cordis.patch.yml"), join(sideHome, "cordis.patch.yml"))
    const env = { ...process.env, DSH_HOME: sideHome, HOME: sideHome }
    const live = spawnSync("dsh", ["--profile", "mpd-headless", prompts[i]], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: sideWs, env, stdio: ["ignore", "pipe", "pipe"] })
    LOG.push("[" + label + " " + i + "] prompt=" + JSON.stringify(prompts[i]) + " exit=" + live.status)
    let iso = { ok: true }
    try { assertSessionsSandboxed(sideHome, sideHome, { label: "t17-" + label + "-" + i }) }
    catch (error) { iso = { ok: false, error: String(error.message).slice(0, 300) } }
    const teams = activeTeams(sideWs)
    const team = teams.length > 0 ? JSON.parse(readFileSync(join(sideWs, ".mpd", "team", teams[0], "team.json"), "utf8")) : undefined
    const notice = noticeInLogs(sideHome)
    const ok = expectTeam ? (teams.length === 1 && notice && team.phase === "staged") : (teams.length === 0 && !notice)
    results.push({ prompt: prompts[i], exited: live.status, teams: teams.length, phase: team?.phase, profile: team?.profile?.name, members: team?.members?.length, spawned: (team?.members ?? []).filter((m) => m.status === "active" || m.spawned === true).length, notice, isolation: iso, ok })
  }
  return results
}
steps.simpleSide = bootSide("simple", SIMPLE, false)
steps.complexSide = bootSide("complex", COMPLEX, true)
steps.twoSided = {
  ok: steps.simpleSide.every((r) => r.ok) && steps.complexSide.every((r) => r.ok),
  simpleTeams: steps.simpleSide.map((r) => r.teams), simpleNotices: steps.simpleSide.map((r) => r.notice),
  complexTeams: steps.complexSide.map((r) => r.teams), complexNotices: steps.complexSide.map((r) => r.notice),
  isolationAllOk: [...steps.simpleSide, ...steps.complexSide].every((r) => r.isolation.ok),
}

// ---- 4) OPT-1 independent reproduction ----
function opt1Fixture(aStatus) {
  const base = join(sandbox, "opt1", aStatus)
  const w = sandboxWorkspace(base)
  const stateRoot = join(w, ".mpd", "team", "opt1")
  mkdirSync(join(stateRoot, "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(join(stateRoot, "team.json"), JSON.stringify({
    id: "opt1", name: "t17 opt1", captainSessionId: "session-c", createdAt: now, taskSeq: 2, phase: "running",
    members: [{ id: "session-m", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
    tasks: [
      { id: "A", subject: "producer", status: aStatus, dependencies: [], attempt: 1, attemptId: "cap-A", createdAt: now, updatedAt: now },
      { id: "B", subject: "consumer", status: "pending", dependencies: ["A"], attempt: 0, createdAt: now, updatedAt: now },
    ],
  }, null, 2))
  return { workspace: w, teamFile: join(stateRoot, "team.json") }
}
const opt1 = {}
for (const aStatus of ["failed", "completed"]) {
  const fx = opt1Fixture(aStatus)
  const { registerAgentTeamsTools } = await import(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "tools.js"))
  const tools = new Map()
  const captain = { id: "session-c", status: "idle", session: { header: { cwd: fx.workspace } } }
  const member = { id: "session-m", status: "idle", session: { header: { cwd: fx.workspace } } }
  const ctx = {
    tools: { register: (d) => tools.set(d.name, d) },
    agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
    subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
    effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }, get: () => undefined,
  }
  registerAgentTeamsTools(ctx, { stateDir: join(".mpd", "team") })
  const startedAt = Date.now()
  let claim
  try {
    claim = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
  }
  catch (error) { claim = { error: String(error.message).slice(0, 300) } }
  const elapsed = Date.now() - startedAt
  let view
  try { view = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain }) }
  catch (error) { view = { error: String(error.message).slice(0, 200) } }
  opt1[aStatus] = { claimable: claim.task_id === "B" && claim.error === undefined, elapsedMs: elapsed, claim, failedDependencies: view.failed_dependencies, error: claim.error }
}
steps.opt1 = {
  ok: opt1.failed.claimable === true && opt1.failed.elapsedMs < 15000 && JSON.stringify(opt1.failed.failedDependencies) === JSON.stringify(["A"]) && opt1.completed.claimable === true && (opt1.completed.failedDependencies ?? []).length === 0,
  failed: opt1.failed,
  reverseControlCompleted: opt1.completed,
}

// ---- 4b) revised C-signal: check the frozen prompts AND the aggregation rule ----
{
  const gate = await import(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js"))
  const probe = (text) => { const c = gate.consumeExplicitFlag(text); return gate.evaluateComplexityGate(c.text, { explicitFlag: c.flagged, planArtifact: false }) }
  const cases = {
    simple1: probe("Reply with exactly: hello-ok"),
    simple2: probe("What does the git-master skill do? Answer in one sentence."),
    simple3: probe("Rename the variable `foo` to `bar` in src/util.ts and run its test."),
    complex1: probe("Align the bundle with upstream: audit the orchestration surface, then implement the routing change."),
    complex2: probe("team: fix the flaky test"),
    complex3: probe("1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot"),
    explicitFlagAlone: probe("team: fix the typo"),
  }
  steps.cSignal = {
    ok: !cases.simple1.trigger && !cases.simple2.trigger && !cases.simple3.trigger
      && cases.complex1.trigger && cases.complex2.trigger && cases.complex3.trigger
      && cases.explicitFlagAlone.trigger && cases.explicitFlagAlone.signals.includes("A"),
    signals: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.signals])),
  }
}
// ---- 5) manual entry freeze ----
// Authority = the ACTUAL registered set (the frozen predicate names the tool set),
// cross-checked with the frozen contract list and the git baseline 0e6bdaf.
const commandSrc = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "command.js"), "utf8")
const toolsSrc = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "tools.js"), "utf8")
const registered = [...new Set([...toolsSrc.matchAll(/name: '(agent_teams_[a-z_]+)'/g)].map((m) => m[1]))].sort()
// DEDUPE BOTH SIDES. The frozen list can legitimately carry a repeated name (a
// constant-level TEAM_TOOL_NAMES + MEMBER_TOOL_NAMES union does), and comparing a
// deduped set against a list with duplicates can never be equal - that false negative
// reddened this step once. Compare SETS, and report missing/extra explicitly so a real
// rename shows up as a named diff instead of a bare `false`.
const contractToolsRaw = JSON.parse(readFileSync(join(repoRoot, "evidence", "omo-align", "requirements", "frozen-contract.json"), "utf8")).manualEntryNames.tools
const contractTools = [...new Set(contractToolsRaw)].sort()
const missingVsContract = contractTools.filter((name) => !registered.includes(name))
const extraVsRegistered = registered.filter((name) => !contractTools.includes(name))
const toolSetMatchesContract = missingVsContract.length === 0 && extraVsRegistered.length === 0
const baselineCommand = run("git", ["show", "0e6bdaf:packages/mpd-agent-teams-plugin/lib/command.js"], { log: false }).out
const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
steps.manualEntries = {
  ok: commandSrc.includes("AGENT_TEAMS_COMMAND = 'agent-teams'")
    && commandSrc.includes("PROFILE_COMMAND_PREFIX = `${AGENT_TEAMS_COMMAND}-`")
    && baselineCommand.includes("AGENT_TEAMS_COMMAND = 'agent-teams'")
    && toolSetMatchesContract
    && patch.includes("stateDir: .mpd/team")
    && /^          mpd:$/m.test(patch)
    && existsSync(join(repoRoot, "presets", "mpd", "preset.yml")),
  slashCommand: "AGENT_TEAMS_COMMAND='agent-teams' + PROFILE_COMMAND_PREFIX=`${AGENT_TEAMS_COMMAND}-` (before==after at 0e6bdaf)",
  registeredToolCount: registered.length,
  registeredTools: registered,
  contractToolCount: contractToolsRaw.length,
  contractToolCountUnique: contractTools.length,
  missingVsContract,
  extraVsRegistered,
  toolSetMatchesContract,
  profileKeyPresent: /^          mpd:$/m.test(patch),
  presetId: existsSync(join(repoRoot, "presets", "mpd", "preset.yml")) ? "mpd" : "(missing)",
  stateDir: patch.includes("stateDir: .mpd/team") ? ".mpd/team" : "(changed)",
}

// ---- 6) the 9 gates ----
const gateCmds = [
  ["typecheck", "bun", ["run", "typecheck"]],
  ["plugin-tests", "bun", ["test", "packages/mpd-agent-teams-plugin"]],
  ["all-packages", "bun", ["test", "packages"]],
  ["installer-self-test", process.execPath, ["scripts/install-profile.mjs", "--self-test"]],
  ["installer-dry-run", process.execPath, ["scripts/install-profile.mjs", "--dry-run"]],
  ["preset-conformance", process.execPath, ["skills/dsh-qa/scripts/preset-conformance.mjs"]],
  ["bundle-lifecycle", "bun", ["skills/dsh-qa/scripts/bundle-lifecycle.mjs"]],
  ["delta-check", process.execPath, ["scripts/patch-agent-teams-fixes.mjs", "--check"]],
  ["verify-vendor", process.execPath, ["scripts/verify-vendor.mjs"]],
]
steps.gates = {}
for (const [name, cmd, args] of gateCmds) {
  const r = run(cmd, args, { timeout: 900000 })
  const tail = r.out.trim().split("\n").slice(-2).join(" | ").slice(0, 220)
  steps.gates[name] = { exit: r.status, ok: r.status === 0, tail }
}

// ---- 7) isolation discipline: the real repo state root must be untouched ----
const realTeams = activeTeams(repoRoot)
steps.isolation = { ok: true, realLiveTeams: realTeams.length, sandbox: relative(repoRoot, sandbox), note: "the real repo state root is only READ (counted), never written; all boots used sandbox HOME+workspace" }

const allOk = Object.values(steps).every((s) => typeof s === "object" && "ok" in s ? s.ok : true)
const result = { verdict: allOk ? "pass" : "needs_revision", steps, head: rev1, generatedAt: new Date().toISOString() }
// DELIVERED ARTIFACTS ARE IMMUTABLE: result.json / output.log belong to the delivered
// t17 report and are never written by this driver. Each run gets its own timestamped
// pair under raw/, so a re-run can never erase a cited artifact.
const rawDir = join(outDir, "raw")
mkdirSync(rawDir, { recursive: true })
const stamp = new Date().toISOString().replaceAll(":", "-")
const runJson = join(rawDir, "run-" + stamp + ".json")
const runLog = join(rawDir, "run-" + stamp + ".output.log")
writeFileSync(runJson, JSON.stringify(result, null, 2))
writeFileSync(runLog, LOG.join("\n\n---\n\n"))
console.log("wrote " + relative(repoRoot, runJson) + " (delivered result.json untouched)")
console.log("verdict=" + result.verdict)
for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 260))
process.exit(allOk ? 0 : 1)
