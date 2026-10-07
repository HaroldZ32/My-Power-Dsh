#!/usr/bin/env node
/**
 * t8 (Lead) — INDEPENDENT tool-call proof for defect B1 (session workspace root resolution).
 *
 * Separate from live-session-proof.mjs because the sandbox has NO LLM credential (measured: the
 * launching environment carries no DEEPSEEK_API_KEY and $DSH_HOME/.credentials.yaml holds only the
 * browser-session secret), so a model turn inside the sandbox cannot run. This driver instead boots
 * the REAL plugin tree in the ORIGINAL deployment shape (process cwd /root/dshProj != session
 * workspace /root/dshProj/my-power-dsh), creates three REAL sessions over the gateway API with
 * explicit cwds, and lets an independently written probe row (t8-ws-probe.mjs) call the mpd tools
 * through the harness tool runtime carrying each session's LIVE agent — the same runtime entry a
 * model-initiated tool call uses. The raw tool results are printed with `[t8-probe] CHECK` markers.
 *
 * Usage: node evidence/session-workspace-root/t8-verify/run-toolcall-proof.mjs
 */
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync, readdirSync, readlinkSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")
const LAUNCH_CWD = process.env.T8_LAUNCH_CWD ?? "/root/dshProj"
const PORT = Number(process.env.T8_TOOLCALL_PORT ?? 3193)
const APPLY_CRASH = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const say = (...parts) => console.log("[t8-driver]", ...parts)
const fail = (message) => { console.error("[t8-driver] FAIL: " + message); process.exit(1) }

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t8-toolcall-"))
const home = join(sandbox, "dsh-home")
const userhome = join(sandbox, "user-home")
const profile = join(home, "profiles", "w")
const wBlocked = join(sandbox, "ws-blocked")
const wClean = join(sandbox, "ws-clean")
const outDir = join(HERE, process.env.T8_OUT ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z") + "-toolcall")
mkdirSync(outDir, { recursive: true })

function hashTree(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  walk(root)
  files.sort()
  const per = {}
  const hash = createHash("sha256")
  for (const file of files) {
    const rel = relative(root, file)
    per[rel] = createHash("sha256").update(readFileSync(file)).digest("hex")
    hash.update(rel + "\0").update(per[rel]).update("\0")
  }
  return { sha256: hash.digest("hex"), per }
}
const treeDelta = (before, after) => ({
  changed: Object.keys(before.per).filter((rel) => after.per[rel] !== undefined && after.per[rel] !== before.per[rel]),
  removed: Object.keys(before.per).filter((rel) => after.per[rel] === undefined),
  added: Object.keys(after.per).filter((rel) => before.per[rel] === undefined),
})

/* ── sandbox ─────────────────────────────────────────────────────────────────────────────── */
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(userhome, { recursive: true })
mkdirSync(home, { recursive: true })
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-t8tc", private: true, dependencies: {},
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
}, null, 2))
for (const name of [".credentials.yaml", "settings.yaml"]) {
  const source = join(homedir(), ".dsh", name)
  if (existsSync(source)) cpSync(source, join(home, name))
}
if (home.startsWith(join(homedir(), ".dsh"))) fail("isolation assertion: DSH_HOME points at the real home")

mkdirSync(wClean, { recursive: true })
mkdirSync(join(wBlocked, ".mpd", "team", "blocking-team"), { recursive: true })
writeFileSync(join(wBlocked, ".mpd", "team", "blocking-team", "team.json"), JSON.stringify({
  id: "blocking-team", name: "t8 controlled blocked workspace", archived: false,
  members: [{ name: "t8wm1" }, { name: "t8wm2" }],
}, null, 2))

const teamTrees = { repo: join(ROOT, ".mpd", "team"), blocked: join(wBlocked, ".mpd", "team"), clean: join(wClean, ".mpd", "team") }
const teamBefore = Object.fromEntries(Object.entries(teamTrees).map(([key, value]) => [key, hashTree(value)]))

// The probe row is COPIED out of the checkout: the web profile's client-modules registry refuses a
// row whose file also resolves the @mpd-dsh/mpd package from the checkout.
const probeCopy = join(sandbox, "t8-ws-probe.mjs")
cpSync(join(HERE, "t8-ws-probe.mjs"), probeCopy)
const patch = join(sandbox, "probe.yml")
writeFileSync(patch, "- insert:\n    - id: mpd-t8-workspace-probe\n      name: " + JSON.stringify(probeCopy) + "\n")

/* ── boot ────────────────────────────────────────────────────────────────────────────────── */
const bootLog = join(outDir, "boot.log")
const fd = openSync(bootLog, "w")
const child = spawn("dsh", ["--profile", "w", "--patch", patch, "--port", String(PORT), "--no-open"], {
  cwd: LAUNCH_CWD,
  env: { ...process.env, DSH_HOME: home, HOME: userhome, MPD_T8_REPO: ROOT, MPD_T8_W_BLOCKED: wBlocked, MPD_T8_W_CLEAN: wClean },
  stdio: ["ignore", fd, fd],
})
let childCwd = ""
try { childCwd = readlinkSync(`/proc/${child.pid}/cwd`) } catch (error) { childCwd = "<unreadable " + String(error?.code) + ">" }
say("boot child pid =", child.pid, "| child /proc cwd =", childCwd, "| session workspace =", ROOT)

const readLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
let token = ""
let cookie = ""
const bootDeadline = Date.now() + 150000
while (Date.now() < bootDeadline) {
  await sleep(1500)
  const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
  if (match !== null) token = match[1]
  if (token === "") continue
  try {
    const authorize = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
    cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
    const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
    if (cookie !== "" && root.status === 200) break
  } catch { /* not serving yet */ }
}
if (token === "") { try { child.kill("SIGKILL") } catch { /* gone */ } fail("the sandbox web profile never started serving") }

const createSession = async (cwd, tag) => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ type: "client-request", rpcId: `t8-${tag}-${Date.now()}`, method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  const value = envelope?.result?.value ?? envelope?.result ?? {}
  say(`session/${tag} cwd=${cwd} status=${response.status} sessionId=${value?.sessionId ?? null}`)
  return { tag, cwd, sessionId: value?.sessionId ?? null, status: response.status }
}

const sessions = {}
for (const [tag, cwd] of [["repo", ROOT], ["blocked", wBlocked], ["clean", wClean]]) sessions[tag] = await createSession(cwd, tag)

const waitDeadline = Date.now() + 240000
while (Date.now() < waitDeadline && !/\[t8-probe\] DONE/.test(readLog())) await sleep(2000)
const log = readLog()
try { child.kill("SIGTERM") } catch { /* gone */ }
for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await sleep(500)
try { child.kill("SIGKILL") } catch { /* gone */ }
await sleep(500)

const checks = [...log.matchAll(/\[t8-probe\] CHECK (\S+)=(PASS|FAIL)\s*(.*)/g)].map((match) => ({ id: match[1], status: match[2], detail: match[3].trim() }))
const info = Object.fromEntries([...log.matchAll(/\[t8-probe\] (HOST_CWD|SESSION_CWDS|ROOTS_ALL|AGENTS_FOUND|REPO|REPO_AGENT_HEADER_CWD|ADAPTER_SEAMS)=(.*)/g)].map((match) => [match[1], match[2].trim()]))
const crashHits = [...log.matchAll(new RegExp(APPLY_CRASH.source, "g"))].map((match) => match[0])
const done = /\[t8-probe\] DONE/.test(log)

const teamAfter = Object.fromEntries(Object.entries(teamTrees).map(([key, value]) => [key, hashTree(value)]))
const LIVE_TEAM_DIR = "mpd-default-7332aba4/"
const repoDelta = treeDelta(teamBefore.repo, teamAfter.repo)
const repoDeltaOutsideLiveTeam = {
  changed: repoDelta.changed.filter((rel) => !rel.startsWith(LIVE_TEAM_DIR)),
  removed: repoDelta.removed,
  added: repoDelta.added.filter((rel) => !rel.startsWith(LIVE_TEAM_DIR)),
}
const blockedDelta = treeDelta(teamBefore.blocked, teamAfter.blocked)
const cleanDelta = treeDelta(teamBefore.clean, teamAfter.clean)
const workmateLibrary = existsSync(join(userhome, ".mpd", "workmate")) ? readdirSync(join(userhome, ".mpd", "workmate")).sort() : []

const failedChecks = checks.filter((check) => check.status !== "PASS")
const readOnlyOk = blockedDelta.changed.length === 0 && blockedDelta.removed.length === 0 && blockedDelta.added.length === 0 &&
  cleanDelta.changed.length === 0 && cleanDelta.removed.length === 0 && cleanDelta.added.length === 0 &&
  repoDeltaOutsideLiveTeam.changed.length === 0 && repoDeltaOutsideLiveTeam.removed.length === 0 && repoDeltaOutsideLiveTeam.added.length === 0

const result = {
  task: "t8 (Lead) — independent verification of B1: session workspace root resolution",
  task_kind: "verification",
  method: "real boot that MOUNTS the plugin tree (--patch probe row, registration instrumentation) with the launch cwd deliberately different from the session workspace; three REAL gateway sessions; every assertion is a tool call through the harness runtime carrying that session's LIVE agent",
  isolation: { HOME: "<sandbox>", DSH_HOME: "<sandbox>" },
  launchCwd: LAUNCH_CWD,
  bootChildCwd: childCwd,
  sessionWorkspaces: { repo: ROOT, blocked: wBlocked, clean: wClean },
  note: "no --dump-config result is cited as load evidence; the mounting boot log (boot.log) plus the real tool results are the load evidence",
  probeInfo: info,
  applyCrashSignatures: crashHits,
  probeReachedFinalMarker: done,
  sessions: Object.fromEntries(Object.entries(sessions).map(([tag, session]) => [tag, { sessionId: session.sessionId, status: session.status, cwd: session.cwd }])),
  checks: [...checks, { id: "X1_TEAM_STATE_READ_ONLY", status: readOnlyOk ? "PASS" : "FAIL", detail: JSON.stringify({ repoDelta, repoDeltaOutsideLiveTeam, blockedDelta, cleanDelta, attribution: "changes inside " + LIVE_TEAM_DIR + " belong to the LIVE agent-teams plugin of the running team, not to the workmate gate" }) }],
  workmateLibrary,
  failedChecks: [...failedChecks.map((check) => check.id), ...(readOnlyOk ? [] : ["X1_TEAM_STATE_READ_ONLY"])],
  passed: done && crashHits.length === 0 && checks.length >= 16 && failedChecks.length === 0 && readOnlyOk,
}
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
rmSync(sandbox, { recursive: true, force: true })
say(`evidence -> ${outDir}`)
say(`passed=${result.passed} checks=${checks.length} failed=${JSON.stringify(result.failedChecks)}`)
process.exit(result.passed ? 0 : 1)
