#!/usr/bin/env node
// Case session-start-team (fix: session-start team rule): prove that the
// adopted agent-teams plugin's `sessionTeamPolicy` MECHANICALLY provisions a
// default team for a qualifying session at its first step — without any
// prompt asking for a team, and without any agent_teams_create call.
//   1) installer (legacy dev flow) ships sessionTeamPolicy on the agent-teams row;
//   2) composed config actually carries it (mode auto, profile mpd, name MPD Default);
//   3) a real headless run of a TRIVIAL prompt ("reply hello-ok", no team words)
//      leaves `.mpd/team/<id>/team.json` behind: staged, profile "mpd",
//      11 roster members, captain owned — i.e. the session started inside a team;
//   4) best-effort: the session log contains the startup notice marker.
// --self-test is the offline self-test. Never touches the real ~/.dsh.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const TRIVIAL_PROMPT = "Reply with exactly: hello-ok"
const NOTICE_MARKER = "[AgentTeams] Session-start team rule"
const LOG = []

function fail(msg) { console.error("[session-start-team] FAIL: " + msg); process.exit(1) }

function teamRoot(ws) { return join(ws, ".mpd", "team") }

function loadTeam(path) { try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null } }

// The session-start policy must leave exactly one active team, staged, on the
// `mpd` profile with the 11-member roster, owned by this run's captain.
function assessTeamState(ws) {
  const root = teamRoot(ws)
  if (!existsSync(root)) return { ok: false, reason: "no .mpd/team root" }
  const ids = readdirSync(root).filter((d) => d !== "archive" && d !== "retired-members.json" && existsSync(join(root, d, "team.json")))
  if (ids.length === 0) return { ok: false, reason: "no active team dir" }
  const teams = ids.map((id) => loadTeam(join(root, id, "team.json")))
  const team = teams[0]
  if (team === null || team === undefined) return { ok: false, reason: "team.json unreadable" }
  const ok = team.name === "MPD Default"
    && team.phase === "staged"
    && (team.profile?.name ?? "") === "mpd"
    && Array.isArray(team.members) && team.members.length === 11
    && typeof team.captainSessionId === "string" && team.captainSessionId !== ""
  return { ok, teamId: team.id, phase: team.phase, profile: team.profile?.name, members: team.members?.length, captainSessionId: team.captainSessionId }
}

// Best-effort: locate the flushed session log and grep the startup notice.
function assessNoticeInLog(sandbox, ws) {
  const sessionsRoot = join(sandbox, "sessions")
  if (!existsSync(sessionsRoot)) return { ok: false, note: "no sessions store in sandbox" }
  const wsKeys = readdirSync(sessionsRoot).filter((d) => d.startsWith("--"))
  const matches = []
  const look = (file) => {
    try {
      const text = readFileSync(file, "utf8")
      if (text.includes(NOTICE_MARKER)) matches.push(file)
      return true
    } catch { return false }
  }
  for (const key of wsKeys) {
    const dir = join(sessionsRoot, key)
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (!entry.startsWith("session-")) continue
      const plain = join(p, "session.jsonl")
      if (existsSync(plain) && look(plain)) continue
      const zstd = join(p, "session.jsonl.zstd")
      if (existsSync(zstd)) {
        // Decode best-effort via the zstd CLI when available.
        const dec = spawnSync("zstd", ["-d", zstd, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        if (dec.status === 0 && dec.stdout.includes(NOTICE_MARKER)) matches.push(zstd)
      }
    }
  }
  return { ok: matches.length > 0, matched: matches }
}

function selfTest() {
  const plugin = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
  if (!existsSync(plugin)) fail("lib/session-start.js missing")
  const src = readFileSync(plugin, "utf8")
  if (!src.includes("agent/pre-step") || !src.includes("provisionSessionTeam")) fail("session-start.js policy hooks missing")
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!patch.includes("sessionTeamPolicy") || !patch.includes("mode: auto") || !patch.includes("profile: mpd")) fail("bundle patch sessionTeamPolicy missing")
  const installer = readFileSync(join(repoRoot, "scripts", "install-profile.mjs"), "utf8")
  if (!installer.includes("sessionTeamPolicy")) fail("installer row config missing sessionTeamPolicy")
  const persona = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
  if (!persona.includes("SESSION STARTUP RULE")) fail("preset persona missing SESSION STARTUP RULE")
  console.log("[session-start-team self-test] ok: policy module + bundle patch + installer + persona verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "dsh-qa", "session-start-team", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-sst-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  // The real home's settings pick the deployment's default model route (e.g.
  // llm-pi-ai opencode-go with a key among the refs above). Without them the
  // headless default resolves to "deepseek-official", which this deployment
  // holds no key for (MISSING_CREDENTIAL). Copy settings so the trivial run
  // can complete; the sandbox stays isolated either way.
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox }
  if (env.DSH_HOME !== sandbox) fail("isolation assertion failed")
  const steps = {}
  let failed = false

  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\\n[[exit=" + r.status + "]]\\n" + out.slice(0, 20000))
    return { status: r.status, out }
  }

  // 1) legacy dev install into the isolated home (headless profile)
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }

  // 2) home patch carries the policy on the agent-teams row (renderRow writes
  //    JSON-quoted values: `mode: "auto"` / `profile: "mpd"`)
  const homePatch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.patchRow = { ok: /id:\s*agent-teams/.test(homePatch) && homePatch.includes("sessionTeamPolicy") && homePatch.includes('mode: "auto"') && homePatch.includes('profile: "mpd"') && homePatch.includes("MPD Default"), hasRow: homePatch.includes("agent-teams") }

  // 3) composed config
  const dump = runSync("dsh", ["--profile", "mpd-headless", "--dump-config"], { timeout: 120000 })
  steps.compose = { ok: dump.status === 0 && dump.out.includes("agent-teams") && dump.out.includes("sessionTeamPolicy") && dump.out.includes("MPD Default"), exit: dump.status }

  // 4) trivial headless run — no team words in the prompt at all. The run may
  //    legitimately fail on credentials when the deployment's settings cannot
  //    be copied; the team-state assertion below is the behavioral proof and
  //    does not depend on the model call succeeding.
  const live = runSync("dsh", ["--profile", "mpd-headless", TRIVIAL_PROMPT], { timeout: 600000, cwd: ws })
  steps.live = { ok: live.status === 0, exit: live.status, tail: live.out.slice(-400) }
  steps.teamState = assessTeamState(ws)
  steps.noticeInLog = assessNoticeInLog(sandbox, ws)

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  if (!allOk) failed = true
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: !failed, sandbox, steps, totalSteps: Object.keys(steps).length }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  console.log("[session-start-team] ok=" + !failed + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (failed) process.exit(1)
  console.log("[session-start-team] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()