#!/usr/bin/env node
// B1 (t7) MOUNT proof + before/after reproductions for authoritative session-workspace resolution.
//
// What it does, in one real boot that MOUNTS the rows (never a composition dump):
//   1) sandbox DSH_HOME + sandbox HOME + a symlinked checkout profile ("w"), offline;
//   2) TWO controlled workspaces beside the repo: W_BLOCKED (carries a non-archived
//      .mpd/team/<id>/team.json listing workmate keys) and W_CLEAN (no team state);
//   3) boot `dsh --profile w --patch <probe row>` with the LAUNCH cwd set to /root/dshProj —
//      deliberately NOT the session workspace, which is the measured defect (process.cwd() was
//      /root/dshProj while the session workspace is the repo);
//   4) create three REAL sessions over the gateway API with cwd = repo / W_BLOCKED / W_CLEAN;
//   5) the probe row calls the mpd tools through the harness runtime carrying each session's LIVE
//      agent, prints `[ws-probe] CHECK <id>=PASS|FAIL` markers, and run-proof.mjs asserts them;
//   6) apply-crash signatures must be 0. --dump-config is never used as load evidence.
//
// Usage: node evidence/session-workspace-root/b1-resolution/run-proof.mjs
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")            // repo root = the authoritative session workspace
const LAUNCH_CWD = dirname(ROOT)                     // /root/dshProj — the measured wrong root
const PROBE = join(HERE, "mount-probe.mjs")
const PORT = Number(process.env.MPD_QA_PORT ?? 3199)
const APPLY_CRASH = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => { console.error("[b1-proof] FAIL: " + message); process.exit(1) }

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-b1-proof-"))
  const home = join(sandbox, "home")
  const userHome = join(sandbox, "userhome")
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(home, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
  symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {},
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  if (join(home).startsWith(join(homedir(), ".dsh"))) fail("isolation assertion: DSH_HOME points at the real home")

  // Controlled team state: the ONLY difference between W_BLOCKED and W_CLEAN.
  const wBlocked = join(sandbox, "ws-blocked")
  const wClean = join(sandbox, "ws-clean")
  for (const [dir, members] of [[wBlocked, ["oracle-1", "oracle-2", "oracle-3"]], [wClean, null]]) {
    mkdirSync(dir, { recursive: true })
    if (members === null) continue
    const teamDir = join(dir, ".mpd", "team", "blocking-team")
    mkdirSync(teamDir, { recursive: true })
    writeFileSync(join(teamDir, "team.json"), JSON.stringify({ id: "blocking-team", archived: false, members: members.map((name) => ({ name })) }, null, 2))
  }

  // The probe row is COPIED out of the repo: the web profile's client-modules registry refuses a
  // row whose file also resolves the @mpd-dsh/mpd package from the checkout ("multiple active
  // Loader sources"). The evidence copy stays the source of truth; the boot loads this copy.
  const probeCopy = join(sandbox, "mount-probe.mjs")
  cpSync(PROBE, probeCopy)
  const patch = join(sandbox, "probe.yml")
  writeFileSync(patch, "- insert:\n    - id: mpd-qa-workspace-probe\n      name: " + JSON.stringify(probeCopy) + "\n")
  return { sandbox, home, userHome, patch, wBlocked, wClean, env: { ...process.env, DSH_HOME: home, HOME: userHome } }
}

async function boot(sandbox, logPath) {
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--patch", sandbox.patch, "--port", String(PORT), "--no-open"], {
    env: {
      ...sandbox.env,
      MPD_QA_REPO: ROOT,
      MPD_QA_W_BLOCKED: sandbox.wBlocked,
      MPD_QA_W_CLEAN: sandbox.wClean,
    },
    cwd: LAUNCH_CWD,
    stdio: ["ignore", fd, fd],
  })
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  let token = ""
  let cookie = ""
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
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
  return { child, readLog, token, cookie }
}

async function createSession(cookie, cwd, tag) {
  const rpcId = "b1-proof-" + tag + "-" + String(Date.now())
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId, method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, envelope }
}

const sandbox = makeSandbox()
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z")
const outDir = process.env.MPD_QA_OUT ?? join(HERE, stamp + "-proof")
mkdirSync(outDir, { recursive: true })
const logPath = join(outDir, "boot.log")
console.log("[b1-proof] launch cwd   = " + LAUNCH_CWD)
console.log("[b1-proof] session wses = " + ROOT + " | " + sandbox.wBlocked + " | " + sandbox.wClean)
console.log("[b1-proof] sandbox      = " + sandbox.sandbox)

const booted = await boot(sandbox, logPath)
if (booted.token === "") { console.error(booted.readLog().slice(-3000)); rmSync(sandbox.sandbox, { recursive: true, force: true }); fail("the sandbox web profile never started serving") }

const sessions = {}
for (const [tag, cwd] of [["repo", ROOT], ["blocked", sandbox.wBlocked], ["clean", sandbox.wClean]]) {
  sessions[tag] = await createSession(booted.cookie, cwd, tag)
  console.log("[b1-proof] session/" + tag + " status=" + sessions[tag].status + " ok=" + JSON.stringify(sessions[tag].envelope?.result?.ok ?? sessions[tag].envelope?.error ?? null))
}

const deadline = Date.now() + 180000
while (Date.now() < deadline && !/\[ws-probe\] DONE/.test(booted.readLog())) await sleep(2000)
const log = booted.readLog()
try { booted.child.kill("SIGTERM") } catch { /* already gone */ }
await sleep(500)
try { booted.child.kill("SIGKILL") } catch { /* already gone */ }

const checks = [...log.matchAll(/\[ws-probe\] CHECK (\S+)=(PASS|FAIL)\s*(.*)/g)].map((m) => ({ id: m[1], status: m[2], detail: m[3].trim() }))
const info = Object.fromEntries([...log.matchAll(/\[ws-probe\] (HOST_CWD|SESSION_CWDS|ROOTS_ALL|AGENTS_FOUND|REPO)=(.*)/g)].map((m) => [m[1], m[2].trim()]))
const applyCrashSignatures = (log.match(APPLY_CRASH) ?? []).length
const done = /\[ws-probe\] DONE/.test(log)
const failed = checks.filter((c) => c.status !== "PASS")
const passed = done && applyCrashSignatures === 0 && checks.length >= 15 && failed.length === 0

const result = {
  proof: "real boot that MOUNTS the rows (registration instrumentation via a --patch probe row) with the launch cwd deliberately different from the session workspace",
  isolation: { HOME: "temp sandbox", DSH_HOME: "temp sandbox" },
  launchCwd: LAUNCH_CWD,
  sessionWorkspaces: { repo: ROOT, blocked: sandbox.wBlocked, clean: sandbox.wClean },
  probeInfo: info,
  applyCrashSignatures,
  probeReachedFinalMarker: done,
  checks,
  checksFailed: failed.map((c) => c.id),
  sessionsCreated: Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, { status: v.status, ok: v.envelope?.result?.ok ?? null }])),
  passed,
  note: "no --dump-config result is cited as load evidence; every assertion is a real tool call made through the harness runtime with the live agent of a session created over the gateway API",
}
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
rmSync(sandbox.sandbox, { recursive: true, force: true })

console.log(JSON.stringify(result, null, 2))
console.log("[b1-proof] evidence -> " + outDir)
process.exit(passed ? 0 : 1)
