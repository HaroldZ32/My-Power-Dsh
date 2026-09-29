#!/usr/bin/env node
// Case explicit-team-trigger (R4): the EXPLICIT entry path must be stable.
//
// The deterministic trigger: an isolated home with NO credentials and NO settings ⇒ the
// model cannot call any tool (headless answers MISSING_CREDENTIAL), so "the model did not
// build the team" is guaranteed rather than occasional. The plugin must then have staged
// the team itself, in the same turn, with a visible notice.
//
// Cases: happy (/agent-teams-mpd <goal>), duplicate (a staged team already exists ⇒ ask,
// never a second team), unknown profile (explicit error), slashCommand:false (warning).
// Offline --self-test pins the resolver's shape without booting anything.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv } from "./lib/credentials.ts"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const NOTICE = "[AgentTeams] Explicit team activation"
const INQUIRY = "[AgentTeams] Explicit request — a team already exists"
const LOG = []
const fail = (m) => { console.error("[explicit-team-trigger] FAIL: " + m); process.exit(1) }

const stateOf = (ws) => join(ws, ".mpd", "team")
const teamsOf = (ws) => {
  const root = stateOf(ws)
  if (!existsSync(root)) return []
  return readdirSync(root).filter((n) => n !== "archive" && !n.startsWith(".") && existsSync(join(root, n, "team.json")))
}
const readTeam = (ws, id) => JSON.parse(readFileSync(join(stateOf(ws), id, "team.json"), "utf8"))
const logText = (home) => {
  const root = join(home, "sessions")
  if (!existsSync(root)) return ""
  let text = ""
  for (const key of readdirSync(root)) {
    const dir = join(root, key)
    for (const entry of readdirSync(dir)) {
      for (const name of readdirSync(join(dir, entry))) {
        if (!name.startsWith("session") || !name.includes(".jsonl")) continue
        const file = join(dir, entry, name)
        if (file.endsWith(".zstd")) {
          const dec = spawnSync("zstd", ["-d", file, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
          if (dec.status === 0) text += dec.stdout || ""
        }
        else { try { text += readFileSync(file, "utf8") } catch { /* ignore */ } }
      }
    }
  }
  return text
}

function install(sandbox) {
  const r = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, env: { ...process.env, DSH_HOME: sandbox } })
  LOG.push("install exit=" + r.status)
  if (r.status !== 0) fail("isolated installer failed")
}

/** Boot a session with NO credentials (the deterministic 'model cannot act' condition). */
function bootNoModel(sandbox, ws, prompt) {
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox  })
  const r = spawnSync("dsh", ["--profile", "mpd-headless", prompt], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: ws, env, stdio: ["ignore", "pipe", "pipe"] })
  LOG.push("$ dsh --profile mpd-headless " + JSON.stringify(prompt) + "\n[[exit=" + r.status + "]]\n" + ((r.stdout || "") + (r.stderr || "")).slice(0, 3000))
  return r
}

function selfTest() {
  const src = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "command.js"), "utf8")
  for (const needle of ["ensureExplicitTeam", "EXPLICIT_TEAM_NOTICE_MARKER", "EXPLICIT_TEAM_INQUIRY_MARKER", "explicitDisabled"]) {
    if (!src.includes(needle)) fail("command.js is missing " + needle)
  }
  if (!src.includes("resolveExplicitTeamText({ ...")) fail("explicit entry points are not bridged")
  const index = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "index.js"), "utf8")
  if (!index.includes("installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {}, explicitOpts)")) fail("gesture boundary is not wired with the explicit options")
  if (!index.includes("explicitDisabled: true")) fail("the slashCommand:false warning path is not wired")
  console.log("[explicit-team-trigger self-test] ok: resolver + both entry points + disabled-surface warning present")
}

async function runReal() {
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "dsh-qa", "explicit-team-trigger", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-r4-"))
  // deliberately NO credentials / settings copy: the model must be unable to act
  install(sandbox)
  const steps = {}
  const sideHome = (name) => {
    const home = join(sandbox, name)
    const ws = join(home, "ws")
    mkdirSync(ws, { recursive: true })
    cpSync(join(sandbox, "profiles"), join(home, "profiles"), { recursive: true })
    cpSync(join(sandbox, "cordis.patch.yml"), join(home, "cordis.patch.yml"))
    return { home, ws }
  }

  // 1) HAPPY: explicit profile command, model cannot run -> the plugin must stage it
  const happy = sideHome("happy")
  bootNoModel(happy.home, happy.ws, "/agent-teams-mpd fix the flaky test")
  const teams = teamsOf(happy.ws)
  const team = teams.length === 1 ? readTeam(happy.ws, teams[0]) : undefined
  const logs = logText(happy.home)
  steps.happy = {
    ok: teams.length === 1 && team.phase === "staged" && team.profile?.name === "mpd"
      && (team.members ?? []).every((m) => m.status !== "active") && team.approvedAt === undefined
      && logs.includes(NOTICE),
    teams: teams.length, profile: team?.profile?.name, phase: team?.phase,
    spawned: (team?.members ?? []).filter((m) => m.status === "active").length,
    approved: team?.approvedAt !== undefined, noticeSeen: logs.includes(NOTICE),
  }

  // 2) DUPLICATE: same workspace again -> an inquiry, never a second team
  const before = teamsOf(happy.ws).length
  bootNoModel(happy.home, happy.ws, "/agent-teams-mpd fix the flaky test")
  const after = teamsOf(happy.ws)
  const logs2 = logText(happy.home)
  steps.duplicate = { ok: before === 1 && after.length === 1 && logs2.includes(INQUIRY), teamsBefore: before, teamsAfter: after.length, inquirySeen: logs2.includes(INQUIRY) }

  // 3) UNKNOWN PROFILE: an explicit error, never silence
  const unknown = sideHome("unknown")
  bootNoModel(unknown.home, unknown.ws, "/agent-teams --profile does-not-exist do something")
  const logs3 = logText(unknown.home)
  steps.unknownProfile = { ok: teamsOf(unknown.ws).length === 0 && /does-not-exist/.test(logs3), teams: teamsOf(unknown.ws).length, sawError: /does-not-exist/.test(logs3) }

  // 4) slashCommand:false -> the gesture must WARN that the command surface is disabled
  const disabled = sideHome("disabled")
  const patch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  // The installer renders the row it knows about; `slashCommand` is not one of its
  // keys, so the disabled case is produced by injecting the key into the agent-teams
  // row itself (id-targeted, inside that row's config block).
  if (!patch.includes("sessionTeamPolicy")) fail("installed row patch has no agent-teams sessionTeamPolicy block to inject into")
  // inject as a SIBLING of the other row keys (never under sessionTeamPolicy): the row
  // schema is flat, and a wrongly nested key would be silently kept but never read.
  const injected = patch.replace(/(\n([ \t]*)enforcement:\s*\S+)/, "$1\n$2slashCommand: false")
  if (injected === patch) fail("could not inject slashCommand:false into the agent-teams row")
  writeFileSync(join(disabled.home, "cordis.patch.yml"), injected)
  writeFileSync(join(outDir, "disabled-patch.head.txt"), injected.slice(0, 4000))
  bootNoModel(disabled.home, disabled.ws, "/agent-teams-mpd fix the flaky test")
  const logs4 = logText(disabled.home)
  steps.disabled = { ok: logs4.includes("slash-command surface is disabled"), warningSeen: logs4.includes("slash-command surface is disabled") }

  const allOk = Object.values(steps).every((s) => s.ok === true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps, totalSteps: Object.keys(steps).length }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  console.log("[explicit-team-trigger] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[explicit-team-trigger] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else await runReal()
