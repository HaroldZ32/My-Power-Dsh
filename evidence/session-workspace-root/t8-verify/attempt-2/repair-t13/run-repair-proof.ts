#!/usr/bin/env node
// t13 (repair round 2) — live proof for the two repaired defects, in ONE real boot that MOUNTS the
// rows with the launch cwd deliberately different from the session workspaces:
//
//   A1  the cocotb IRON GATE (venv.ts requireCocotbVenv -> venvStatus) must probe
//       <SESSION>/.venv-rtl. The sandbox carries a FAKE cocotb venv in W_CLEAN only; the backend
//       env overrides point at nonexistent paths, so a call that passes the gate must stop at the
//       BACKEND probe (VERIF_E_NO_BACKEND) — a venv refusal (VERIF_E_NO_VENV) means the gate
//       resolved the wrong root.
//   A5  the workmate in-use gate must refuse through the SERVICE path (no explicit roots ⇒ the
//       agentless union of live session roots) when a team record in ANY live session workspace
//       names the key, and must allow a key no live workspace references.
//
// Usage: node evidence/session-workspace-root/t8-verify/attempt-2/repair-t13/run-repair-proof.mjs
import { cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, chmodSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..", "..")      // repo root = a session workspace
const LAUNCH_CWD = dirname(ROOT)                            // /root/dshProj — deliberately NOT a session ws
const PROBE = join(HERE, "mount-probe.mjs")
const PORT = Number(process.env.MPD_QA_PORT ?? 3201)
const APPLY_CRASH = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => { console.error("[repair-t13] FAIL: " + message); process.exit(1) }

/** A fake cocotb venv: `--version` and the cocotb import probe both answer, nothing else runs. */
function writeFakeVenv(ws) {
  const bin = join(ws, ".venv-rtl", "bin")
  mkdirSync(bin, { recursive: true })
  const py = join(bin, "python")
  writeFileSync(py, [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then echo "Python 3.11.9"; exit 0; fi',
    'if [ "$1" = "-c" ]; then echo \'{"v": "2.0.0-fake", "ok": true}\'; exit 0; fi',
    "exit 0",
    "",
  ].join("\n"))
  chmodSync(py, 0o755)
}

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-repair-t13-"))
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

  const wBlocked = join(sandbox, "ws-blocked")
  const wClean = join(sandbox, "ws-clean")
  mkdirSync(wBlocked, { recursive: true })
  mkdirSync(wClean, { recursive: true })
  // The ONLY team record: it names the workmate keys the service path must refuse.
  const teamDir = join(wBlocked, ".mpd", "team", "blocking-team")
  mkdirSync(teamDir, { recursive: true })
  writeFileSync(join(teamDir, "team.json"), JSON.stringify({
    id: "blocking-team", archived: false,
    members: [{ name: "gui-mate-1" }, { name: "gui-mate-2" }],
  }, null, 2))
  // The fake cocotb venv exists ONLY in W_CLEAN; the repo keeps its own real one untouched.
  writeFakeVenv(wClean)

  const probeCopy = join(sandbox, "repair-probe.mjs")
  cpSync(PROBE, probeCopy)
  const patch = join(sandbox, "probe.yml")
  writeFileSync(patch, "- insert:\n    - id: mpd-qa-repair-probe\n      name: " + JSON.stringify(probeCopy) + "\n")
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
      // Force the backend probe to answer "absent" so a gate-passing call stops THERE, not at the venv.
      MPD_DSH_VERIF_IVERILOG: "/nonexistent/iverilog-fake",
      MPD_DSH_VERIF_VERILATOR: "/nonexistent/verilator-fake",
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
  const rpcId = "repair-t13-" + tag + "-" + String(Date.now())
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId, method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, ok: envelope?.result?.ok ?? null }
}

const sandbox = makeSandbox()
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z")
const outDir = process.env.MPD_QA_OUT ?? join(HERE, stamp + "-proof")
mkdirSync(outDir, { recursive: true })
const logPath = join(outDir, "boot.log")
console.log("[repair-t13] repo (session ws) = " + ROOT)
console.log("[repair-t13] launch cwd        = " + LAUNCH_CWD)
console.log("[repair-t13] W_BLOCKED         = " + sandbox.wBlocked + " (fake cocotb venv: no)")
console.log("[repair-t13] W_CLEAN           = " + sandbox.wClean + " (fake cocotb venv: yes)")

const booted = await boot(sandbox, logPath)
if (booted.token === "") { console.error(booted.readLog().slice(-3000)); rmSync(sandbox.sandbox, { recursive: true, force: true }); fail("the sandbox web profile never started serving") }

const sessions = {}
for (const [tag, cwd] of [["repo", ROOT], ["blocked", sandbox.wBlocked], ["clean", sandbox.wClean]]) {
  sessions[tag] = await createSession(booted.cookie, cwd, tag)
  console.log("[repair-t13] session/" + tag + " status=" + sessions[tag].status + " ok=" + sessions[tag].ok)
}

const deadline = Date.now() + 180000
while (Date.now() < deadline && !/\[repair-probe\] DONE/.test(booted.readLog())) await sleep(2000)
const log = booted.readLog()
try { booted.child.kill("SIGTERM") } catch { /* already gone */ }
await sleep(500)
try { booted.child.kill("SIGKILL") } catch { /* already gone */ }

const checks = [...log.matchAll(/\[repair-probe\] CHECK (\S+)=(PASS|FAIL)\s*(.*)/g)].map((m) => ({ id: m[1], status: m[2], detail: m[3].trim() }))
const info = Object.fromEntries([...log.matchAll(/\[repair-probe\] (HOST_CWD|ROOTS_ALL|AGENTS_FOUND)=(.*)/g)].map((m) => [m[1], m[2].trim()]))
const applyCrashSignatures = (log.match(APPLY_CRASH) ?? []).length
const done = /\[repair-probe\] DONE/.test(log)
const failed = checks.filter((c) => c.status !== "PASS")
const passed = done && applyCrashSignatures === 0 && checks.length >= 11 && failed.length === 0

const result = {
  task: "t13 (repair round 2) — cocotb IRON gate follows the session + workmate service-path gate",
  proof: "real boot that MOUNTS the rows (registration instrumentation via a --patch probe row) with the launch cwd deliberately different from every session workspace",
  isolation: { HOME: "temp sandbox", DSH_HOME: "temp sandbox" },
  launchCwd: LAUNCH_CWD,
  sessionWorkspaces: { repo: ROOT, blocked: sandbox.wBlocked, clean: sandbox.wClean },
  forcedBackendEnv: { MPD_DSH_VERIF_IVERILOG: "/nonexistent/iverilog-fake", MPD_DSH_VERIF_VERILATOR: "/nonexistent/verilator-fake" },
  probeInfo: info,
  applyCrashSignatures,
  probeReachedFinalMarker: done,
  checks,
  checksFailed: failed.map((c) => c.id),
  sessionsCreated: sessions,
  passed,
  note: "no --dump-config result is cited as load evidence; every assertion is a real tool call or a direct call into the SHIPPED dist made through the harness in a session-scoped context",
}
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
rmSync(sandbox.sandbox, { recursive: true, force: true })

console.log(JSON.stringify(result, null, 2))
console.log("[repair-t13] evidence -> " + outDir)
process.exit(passed ? 0 : 1)
