#!/usr/bin/env node
// Case session-start-team (the session-start TEAM GATE): prove BOTH directions of
// the frozen complexity gate on the SAME settled revision — a simple prompt must
// leave NO team and NO notice, a complex prompt must leave EXACTLY ONE staged team
// and ONE notice. A gate that cannot fail one side is not accepted.
//
// 1) offline --self-test: the gate predicate is evaluated against the 3+3 verbatim
//    frozen prompts (both directions), the installer row carries the new defaults,
//    and the bundle patch carries mode off + autoRoute true.
// 2) real run: isolated DSH_HOME + sandbox workspace; per prompt, an isolated
//    headless boot; asserts .mpd/team/**/team.json existence/absence and the
//    STARTUP_NOTICE_MARKER in the session log.
//
// Never touches the real ~/.dsh (credentials/settings are COPIED into a sandbox).
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const NOTICE_MARKER = "[AgentTeams] Session-start team rule"
const SETTLE_MS = 50000
const LOG = []

// The frozen prompt sets (evidence/omo-align/requirements/frozen-contract.json).
const SIMPLE_PROMPTS = [
  "Reply with exactly: hello-ok",
  "What does the git-master skill do? Answer in one sentence.",
  "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
const COMPLEX_PROMPTS = [
  "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
  "team: fix the flaky test",
  "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]

function fail(msg) { console.error("[session-start-team] FAIL: " + msg); process.exit(1) }

function teamRoot(ws) { return join(ws, ".mpd", "team") }

function loadTeam(path) { try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null } }

/** Active team records for one workspace (the .mpd/team state root only). */
function activeTeams(ws) {
  const root = teamRoot(ws)
  if (!existsSync(root)) return []
  const ids = readdirSync(root).filter((d) => d !== "archive" && d !== "retired-members.json" && existsSync(join(root, d, "team.json")))
  return ids.map((id) => loadTeam(join(root, id, "team.json"))).filter(Boolean)
}

/** The notice marker present in any flushed session log inside the sandbox. */
function noticeInLog(sandbox) {
  const sessionsRoot = join(sandbox, "sessions")
  if (!existsSync(sessionsRoot)) return false
  for (const key of readdirSync(sessionsRoot).filter((d) => d.startsWith("--"))) {
    const dir = join(sessionsRoot, key)
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith("session-")) continue
      const sessionDir = join(dir, entry)
      // The current harness writes `session.v3.jsonl.zstd`; the legacy plain and
      // pre-v3 names are kept as fallbacks (readiness of a name is never the gate).
      for (const name of readdirSync(sessionDir)) {
        if (!name.startsWith("session") || !name.includes(".jsonl")) continue
        const file = join(sessionDir, name)
        if (file.endsWith(".zstd")) {
          const dec = spawnSync("zstd", ["-d", file, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
          if (dec.status === 0 && (dec.stdout || "").includes(NOTICE_MARKER)) return true
          continue
        }
        try { if (readFileSync(file, "utf8").includes(NOTICE_MARKER)) return true } catch { /* keep looking */ }
      }
    }
  }
  return false
}

/** sha256 of a file via coreutils (keeps the settle-window assertion dependency-free). */
function sha256(path) {
  const r = spawnSync("sha256sum", [path], { encoding: "utf8" })
  return (r.stdout || "").trim().split(/\s+/)[0]
}

function selfTest() {
  const plugin = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
  if (!existsSync(plugin)) fail("lib/session-start.js missing")
  const src = readFileSync(plugin, "utf8")
  if (!src.includes("agent/pre-step") || !src.includes("provisionSessionTeam")) fail("session-start.js policy hooks missing")
  if (!src.includes("evaluateComplexityGate") || !src.includes("consumeExplicitFlag")) fail("session-start.js complexity gate missing")
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!patch.includes("sessionTeamPolicy") || !patch.includes("mode: off") || !patch.includes("autoRoute: true")) fail("bundle patch sessionTeamPolicy must carry mode: off + autoRoute: true")
  const installer = readFileSync(join(repoRoot, "scripts", "install-profile.mjs"), "utf8")
  if (!installer.includes("sessionTeamPolicy") || !installer.includes('mode: "off"') || !installer.includes("autoRoute: true")) fail("installer row config must carry mode off + autoRoute true")
  const persona = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
  if (!persona.includes("SESSION STARTUP RULE")) fail("preset persona missing SESSION STARTUP RULE")
  if (/MUST start inside a team|MUST begin inside a team/.test(persona)) fail("preset persona still carries the mandatory-team invariant")
  const probe = spawnSync(process.execPath, [join(repoRoot, "skills", "dsh-qa", "scripts", "lib", "gate-probe.mjs")], { encoding: "utf8", cwd: repoRoot })
  if (probe.status !== 0) {
    console.error(probe.stdout || "")
    console.error(probe.stderr || "")
    fail("gate probe failed (both directions must hold on the frozen prompt sets)")
  }
  console.log("[session-start-team self-test] ok: gate module + bundle patch + installer + persona + BOTH prompt directions verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "dsh-qa", "session-start-team", ts)
  mkdirSync(outDir, { recursive: true })

  const rev0 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const gatePath = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
  const gate0 = sha256(gatePath)
  LOG.push("settleWait: " + SETTLE_MS + " ms (revision " + rev0 + ", session-start.js " + gate0.slice(0, 16) + ")")
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const rev1 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const gate1 = sha256(gatePath)
  const settled = rev0 === rev1 && gate0 === gate1
  const steps = { settled: { ok: settled, rev: rev1, gateHash: gate1 } }
  if (!settled) fail("revision did not settle (HEAD or gate file changed during the window)")

  const sandbox = mkdtempSync(join(tmpdir(), "mpd-sst-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  if (env.DSH_HOME !== sandbox) fail("isolation assertion failed")

  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }

  const homePatch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.patchRow = { ok: /id:\s*agent-teams/.test(homePatch) && homePatch.includes("sessionTeamPolicy") && homePatch.includes('"off"') && homePatch.includes("autoRoute") && homePatch.includes("MPD Default"), hasRow: homePatch.includes("agent-teams") }

  const dump = runSync("dsh", ["--profile", "mpd-headless", "--dump-config"], { timeout: 120000 })
  steps.compose = { ok: dump.status === 0 && dump.out.includes("agent-teams") && dump.out.includes("sessionTeamPolicy") && dump.out.includes("MPD Default"), exit: dump.status }

  async function runSide(label, prompts, expectTeam) {
    const results = []
    for (let i = 0; i < prompts.length; i += 1) {
      const sideHome = join(sandbox, "side", label, String(i))
      const sideWs = join(sideHome, "ws")
      mkdirSync(sideWs, { recursive: true })
      cpSync(join(sandbox, ".credentials.yaml"), join(sideHome, ".credentials.yaml"))
      if (existsSync(join(sandbox, "settings.yaml"))) cpSync(join(sandbox, "settings.yaml"), join(sideHome, "settings.yaml"))
      cpSync(join(sandbox, "profiles"), join(sideHome, "profiles"), { recursive: true })
      cpSync(join(sandbox, "cordis.patch.yml"), join(sideHome, "cordis.patch.yml"))
      const sideEnv = { ...process.env, DSH_HOME: sideHome }
      const live = spawnSync("dsh", ["--profile", "mpd-headless", prompts[i]], { env: sideEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: sideWs, stdio: ["ignore", "pipe", "pipe"] })
      LOG.push("[" + label + " " + i + "] $ dsh --profile mpd-headless " + JSON.stringify(prompts[i]) + "\n[[exit=" + live.status + "]]\n" + ((live.stdout || "") + (live.stderr || "")).slice(0, 20000))
      const teams = activeTeams(sideWs)
      // Preserve the side's state before the per-side home is understood only via the
      // sandbox tmpdir: copy the workspace team records and the session logs into the
      // evidence dir so the notice assertion stays auditable after the run.
      try {
        const keep = join(outDir, "sides", label, String(i))
        mkdirSync(keep, { recursive: true })
        if (existsSync(teamRoot(sideWs))) cpSync(teamRoot(sideWs), join(keep, "team"), { recursive: true })
        if (existsSync(join(sideHome, "sessions"))) cpSync(join(sideHome, "sessions"), join(keep, "sessions"), { recursive: true })
        writeFileSync(join(keep, "prompt.txt"), prompts[i])
      } catch { /* evidence copy is best-effort; the assertions below are the gate */ }
      const notice = noticeInLog(sideHome)
      const spawned = teams.length > 0 ? (teams[0].members || []).filter((m) => m.status === "active" || m.spawned === true).length : 0
      const ok = expectTeam ? (teams.length === 1 && notice) : (teams.length === 0 && !notice)
      results.push({ prompt: prompts[i], exited: live.status, teams: teams.length, staged: teams[0] ? teams[0].phase : undefined, profile: teams[0] && teams[0].profile ? teams[0].profile.name : undefined, members: teams[0] ? (teams[0].members || []).length : 0, spawnedMembers: spawned, notice, ok })
      rmSync(teamRoot(sideWs), { recursive: true, force: true })
    }
    return results
  }

  // NEGATIVE CONTROL (t24 item 4): with the gate explicitly DISABLED the same complex
  // prompt must produce NO team and NO notice. Without this, a gate that is
  // accidentally always-true could still "pass" the complex side.
  function runNegativeControl() {
    const controlHome = join(sandbox, "negative-control")
    const controlWs = join(controlHome, "ws")
    mkdirSync(controlWs, { recursive: true })
    cpSync(join(sandbox, ".credentials.yaml"), join(controlHome, ".credentials.yaml"))
    if (existsSync(join(sandbox, "settings.yaml"))) cpSync(join(sandbox, "settings.yaml"), join(controlHome, "settings.yaml"))
    cpSync(join(sandbox, "profiles"), join(controlHome, "profiles"), { recursive: true })
    const patchText = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
    // the installed row renders autoRoute as JSON-ish YAML; flipping it to false must
    // disarm the gate. If the pattern is absent the control FAILS loudly instead of
    // passing vacuously.
    if (!patchText.includes("autoRoute")) return { ok: false, reason: "autoRoute not found in the installed row patch" }
    const disarmed = patchText.replace(/autoRoute:\s*true/g, "autoRoute: false")
    writeFileSync(join(controlHome, "cordis.patch.yml"), disarmed)
    const env = credentialEnv({ ...process.env, DSH_HOME: controlHome, HOME: controlHome  })
    const live = spawnSync("dsh", ["--profile", "mpd-headless", COMPLEX_PROMPTS[0]], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: controlWs, stdio: ["ignore", "pipe", "pipe"] })
    LOG.push("[negative-control] autoRoute=false + complex prompt\n[[exit=" + live.status + "]]\n" + ((live.stdout || "") + (live.stderr || "")).slice(0, 4000))
    const teams = activeTeams(controlWs)
    const notice = noticeInLog(controlHome)
    return { ok: teams.length === 0 && !notice, teams: teams.length, notice, disarmed: disarmed !== patchText }
  }

  steps.simpleSide = await runSide("simple", SIMPLE_PROMPTS, false)
  steps.complexSide = await runSide("complex", COMPLEX_PROMPTS, true)
  steps.negativeControl = runNegativeControl()
  steps.twoSided = {
    ok: steps.simpleSide.every((r) => r.ok) && steps.complexSide.every((r) => r.ok) && steps.negativeControl.ok,
    simpleTeams: steps.simpleSide.map((r) => r.teams),
    simpleNotices: steps.simpleSide.map((r) => r.notice),
    complexTeams: steps.complexSide.map((r) => r.teams),
    complexNotices: steps.complexSide.map((r) => r.notice),
  }

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps, totalSteps: Object.keys(steps).length }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  console.log("[session-start-team] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 400))
  if (!allOk) process.exit(1)
  console.log("[session-start-team] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
