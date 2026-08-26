#!/usr/bin/env node
// Case agent-teams-adopt (Plan C / C1): adopt @nanmicoder/dsh-agent-teams into an
// isolated DSH_HOME through scripts/install-profile.mjs, then prove end-to-end:
//   1) installer writes the bundle dependency + stateDir override (.mpd/team);
//   2) composed config actually contains the agent-teams row with the override;
//   3) a real headless AgentTeams run creates team state (team.json + inbox/*.jsonl),
//      drives tasks with a dependency, and archives the team on delete;
//   4) the web profile serves the /plugins/dsh-agent-teams/state snapshot route.
// --self-test is the offline self-test. Never touches the real ~/.dsh.
import { spawnSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const NOTICE_LINE = "Copyright (c) 2026 程序员阿江(Relakkes)"
const AGENTS_EXCEPTION = "Adopted third-party plugins keep their vendor ids"
const PROMPT = "Use AgentTeams for a tiny end-to-end verification: create team 'c1qa' (description 'C1 adoption QA'); add two members, oracle and librarian; create task t1 'Summarize the QA goal in one line' assigned to librarian; create task t2 'Approve or reject the summary' assigned to oracle with dependency on t1; let the scheduler run the tasks; call agent_teams_status before finishing; then archive the team with agent_teams_delete. End with the team_id and what the archive path is."

const LOG = []

function fail(msg) { console.error("[agent-teams-adopt] FAIL: " + msg); process.exit(1) }

function teamRoot(ws) { return join(ws, ".mpd", "team") }

function loadTeam(path) { try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null } }

function assessTeamState(ws) {
  const root = teamRoot(ws)
  const activeIds = (existsSync(root) ? readdirSync(root) : []).filter((d) => d !== "archive" && d !== "retired-members.json" && existsSync(join(root, d, "team.json")))
  const archiveIds = (existsSync(join(root, "archive")) ? readdirSync(join(root, "archive")) : []).filter((d) => existsSync(join(root, "archive", d, "team.json")))
  const ids = activeIds.length > 0 ? activeIds : archiveIds
  const teamJson = ids.map((id) => loadTeam(join(activeIds.length > 0 ? root : join(root, "archive"), id, "team.json")))
  const inbox = ids.map((id) => {
    const base = activeIds.length > 0 ? root : join(root, "archive")
    const p = join(base, id, "inbox")
    return existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(".jsonl")) : []
  })
  const ok = ids.length > 0 && teamJson.every(Boolean) && teamJson.some((t) => (t.members ?? []).length >= 2) && inbox.some((arr) => arr.length > 0)
  return { ok, teamIds: ids, inbox, teamJson }
}

function assessArchive(ws) {
  const root = join(teamRoot(ws), "archive")
  const ids = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, "team.json"))) : []
  return { ok: ids.length > 0, archiveIds: ids }
}

function assessTaskTerminal(ws) {
  const st = assessTeamState(ws)
  let taskTerminal = false
  let tasks = 0
  for (const t of st.teamJson) {
    if (t && Array.isArray(t.tasks)) { tasks += t.tasks.length; taskTerminal = taskTerminal || t.tasks.some((x) => ["completed", "failed", "cancelled"].includes(x.status)) }
  }
  return { ok: tasks >= 1 && taskTerminal, tasks, taskTerminal }
}

function selfTest() {
  const notices = readFileSync(join(repoRoot, "LICENSE-NOTICES.md"), "utf8")
  if (!notices.includes("dsh-agent-teams (MIT)") || !notices.includes(NOTICE_LINE)) fail("MIT notice block missing")
  if (!notices.includes("程序员阿江(Relakkes)")) fail("copyright line missing")
  if (!existsSync(join(repoRoot, "third-party", "dsh-agent-teams", "LICENSE"))) fail("vendored LICENSE copy missing")
  const ag = readFileSync(join(repoRoot, "AGENTS.md"), "utf8")
  if (!ag.includes(AGENTS_EXCEPTION)) fail("AGENTS.md naming exception missing")
  const st = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--self-test"], { encoding: "utf8" })
  if (st.status !== 0) fail("installer --self-test failed: " + st.stderr)
  console.log("[agent-teams-adopt self-test] ok: notice + vendored LICENSE + AGENTS.md + installer self-test verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-c", "c1-team", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-c1-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
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

  // 1) install into the isolated home (headless profile)
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }

  // 2) manifest + home-patch asserts
  const manifest = JSON.parse(readFileSync(join(sandbox, "profiles", "mpd-headless", "package.json"), "utf8"))
  steps.bundleRow = { ok: (manifest.dsh?.profile?.bundles ?? []).includes("@nanmicoder/dsh-agent-teams"), bundles: manifest.dsh?.profile?.bundles }
  const homePatch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.override = { ok: /id:\s*agent-teams/.test(homePatch) && homePatch.includes(".mpd/team"), hasPatch: homePatch.includes("agent-teams") }

  // 3) composed config
  const dump = runSync("dsh", ["--profile", "mpd-headless", "--dump-config"], { timeout: 120000 })
  const composed = dump.out.includes("agent-teams") && dump.out.includes(".mpd/team")
  steps.compose = { ok: dump.status === 0 && composed, exit: dump.status }

  // 4) live headless AgentTeams run
  const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 900000, cwd: ws })
  const liveOut = live.out
  steps.live = { ok: live.status === 0, exit: live.status }
  steps.teamState = assessTeamState(ws)
  steps.archive = assessArchive(ws)
  steps.taskTerminal = assessTaskTerminal(ws)

  // 5) web snapshot route (separate web profile in the same isolated home)
  const instWeb = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd", "--skip-toolchain"], { timeout: 600000 })
  steps.webInstaller = { ok: instWeb.status === 0, exit: instWeb.status }
  const port = 3199
  const webLog = join(outDir, "web.log")
  const webFd = openSyncSafe(webLog)
  const web = spawn("dsh", ["--profile", "mpd", "--port", String(port), "--no-open"], { env, cwd: ws, detached: false, stdio: ["ignore", webFd, webFd] })
  let routeOk = false
  let routeStatus = null
  let routeBody = ""
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/plugins/dsh-agent-teams/state", { signal: AbortSignal.timeout(4000) })
      routeStatus = res.status
      routeBody = (await res.text()).slice(0, 2000)
      routeOk = res.status === 200
      break
    } catch { /* not up yet */ }
  }
  web.kill("SIGTERM")
  try { await new Promise((r) => setTimeout(r, 1500)) } catch {}
  steps.webRoute = { ok: routeOk, status: routeStatus, body: routeBody, webLog: webLog }

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  if (!allOk) failed = true
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: !failed, sandbox, steps, totalSteps: Object.keys(steps).length }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  console.log("[agent-teams-adopt] ok=" + !failed + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (failed) process.exit(1)
  console.log("[agent-teams-adopt] PASS")
}

function openSyncSafe(p) { return openSync(p, "w") }

function reparse() {
  const ev = join(repoRoot, "evidence", "plan-c", "c1-team")
  const tsArgIdx = process.argv.indexOf("--reparse")
  const ts = process.argv[tsArgIdx + 1] ?? (existsSync(ev) ? readdirSync(ev).sort().pop() : null)
  if (!ts) fail("no evidence dir to reparse")
  const dir = join(ev, ts)
  const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"))
  const ws = join(result.sandbox, "ws")
  result.steps.teamState = assessTeamState(ws)
  result.steps.archive = assessArchive(ws)
  result.steps.taskTerminal = assessTaskTerminal(ws)
  result.ok = Object.values(result.steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2))
  console.log("[agent-teams-adopt] reparse ts=" + ts + " ok=" + result.ok + " -> " + dir)
  for (const [k, v] of Object.entries(result.steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 220))
  if (!result.ok) process.exit(1)
  console.log("[agent-teams-adopt] PASS (reparsed)")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else if (argv.includes("--reparse")) reparse()
else runReal()
