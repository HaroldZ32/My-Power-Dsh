#!/usr/bin/env node
/**
 * t8 (Lead) — B1 follow-up: does the fix also cover a CHILD (subagent / team-member-shaped) session?
 *
 * Why: in the live GUI process the mpd tools still resolve /root/dshProj for THIS member session.
 * Two readings are possible — (a) the running process simply has the pre-fix dists loaded, or
 * (b) `exec.agent.session.header.cwd` is absent for child sessions so the fix falls back to
 * process.cwd(). This probe separates them inside a fresh boot of the FIXED code:
 * a real session (cwd = repo) is asked to spawn a one-shot roster subagent whose only job is to call
 * `mpd_verif_venv {action:info}` and echo the raw output. A child session that resolves the repo
 * proves the fix covers child sessions and reading (a) holds.
 *
 * Usage: node evidence/session-workspace-root/t8-verify/subagent-context-proof.mjs
 */
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync, readdirSync, readlinkSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")
const LAUNCH_CWD = process.env.T8_LAUNCH_CWD ?? "/root/dshProj"
const PORT = Number(process.env.T8_SUBAGENT_PORT ?? 3195)
const APPLY_CRASH = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const say = (...parts) => console.log("[t8-sub]", ...parts)

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t8-sub-"))
const home = join(sandbox, "dsh-home")
const userhome = join(sandbox, "user-home")
const profile = join(home, "profiles", "w")
const outDir = join(HERE, process.env.T8_SUB_OUT ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z") + "-subagent")
mkdirSync(outDir, { recursive: true })
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(userhome, { recursive: true })
mkdirSync(home, { recursive: true })
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-t8sub", private: true, dependencies: {},
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
}, null, 2))
for (const name of [".credentials.yaml", "settings.yaml"]) {
  const source = join(homedir(), ".dsh", name)
  if (existsSync(source)) cpSync(source, join(home, name))
}
if (home.startsWith(join(homedir(), ".dsh"))) throw new Error("isolation assertion: DSH_HOME points at the real home")

const bootLog = join(outDir, "boot.log")
const fd = openSync(bootLog, "w")
const child = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], {
  cwd: LAUNCH_CWD, env: { ...process.env, DSH_HOME: home, HOME: userhome }, stdio: ["ignore", fd, fd],
})
const childCwd = (() => { try { return readlinkSync(`/proc/${child.pid}/cwd`) } catch (error) { return "<unreadable " + String(error?.code) + ">" } })()
say("boot child pid =", child.pid, "child /proc cwd =", childCwd, "session workspace =", ROOT)

const readLogTail = (bytes = 400000) => { try { return readFileSync(bootLog, "utf8").slice(-bytes) } catch { return "" } }
const shell = (command, args) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const eventsOf = (file) => {
  const out = []
  for (const line of shell("zstd", ["-d", "-c", file]).split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try { out.push(JSON.parse(trimmed)) } catch { /* partial */ }
  }
  return out
}

let token = ""
let cookie = ""
const bootDeadline = Date.now() + 150000
while (Date.now() < bootDeadline) {
  await sleep(1500)
  const match = /token=([A-Za-z0-9_-]+)/.exec(readLogTail())
  if (match !== null) token = match[1]
  if (token === "") continue
  try {
    const authorize = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
    cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
    const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
    if (cookie !== "" && root.status === 200) break
  } catch { /* not serving yet */ }
}
if (token === "") { try { child.kill("SIGKILL") } catch { /* gone */ } throw new Error("boot failed") }

const post = async (method, request) => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ type: "client-request", rpcId: `t8sub-${Date.now()}`, method, payload: { args: { request } } }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, value: envelope?.result?.value ?? envelope?.result ?? {}, error: envelope?.error ?? null }
}

const created = await post("session/create", { cwd: ROOT, agentPreset: "mpd" })
const sessionId = created.value?.sessionId ?? null
say("session create:", created.status, "sessionId=", sessionId)
if (sessionId === null) { writeFileSync(join(outDir, "result.json"), JSON.stringify({ passed: false, created }, null, 2)); try { child.kill("SIGKILL") } catch { /* gone */ } process.exit(1) }

const prompt = [
  "Call the tool mpd_role_spawn exactly once with these arguments:",
  '{"role": "oracle", "task": "Call the tool mpd_verif_venv with arguments {\\"action\\": \\"info\\"} exactly once, then reply with its raw output text and nothing else."}',
  "Then reply with the raw output text that mpd_role_spawn returned, verbatim.",
].join("\n")
const sent = await post("session/prompt", { sessionId, requestId: "t8sub-turn1", mode: "queue", content: [{ type: "text", text: prompt }] })
say("prompt:", sent.status, JSON.stringify(sent.value?.accepted ?? sent.error ?? null))

const findLogs = () => {
  const found = []
  const walk = (dir) => {
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const candidate = join(path, "session.v3.jsonl.zstd")
        if (existsSync(candidate)) found.push(candidate)
        walk(path)
      }
    }
  }
  walk(join(home, "sessions"))
  return found
}

let sessionLog = null
const waitDeadline = Date.now() + 300000
while (Date.now() < waitDeadline) {
  for (const file of findLogs()) {
    if (!file.includes(sessionId)) continue
    sessionLog = file
    if (eventsOf(file).some((event) => event.type === "turn/end")) { Date.now(); }
  }
  if (sessionLog !== null && eventsOf(sessionLog).some((event) => event.type === "turn/end")) break
  await sleep(3000)
}
try { child.kill("SIGTERM") } catch { /* gone */ }
for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await sleep(500)
try { child.kill("SIGKILL") } catch { /* gone */ }
await sleep(1000)

/* extraction: every session's header cwd + the mpd_role_spawn result text */
const sessions = []
for (const file of findLogs()) {
  const list = eventsOf(file)
  const header = list.find((event) => event.type === "session")?.data?.session ?? list.find((event) => event.type === "session")?.data ?? null
  const spawnResult = list.filter((event) => event.type === "tool/result").map((event) => JSON.stringify(event?.data?.message?.content ?? [])).find((text) => text.includes("mpd_role_spawn") || text.includes("role_spawn") || text.includes("verif env"))
  const calls = list.filter((event) => event.type === "tool/call").map((event) => event.data.name)
  sessions.push({ file: file.replace(home, "$DSH_HOME"), cwd: header?.header?.cwd ?? header?.cwd ?? null, calls, turns: list.filter((e) => e.type === "turn/end").length, spawnResult: (spawnResult ?? "").slice(0, 4000) })
}
const mainLog = sessionLog === null ? null : eventsOf(sessionLog)
const spawnToolResult = (mainLog ?? []).filter((event) => event.type === "tool/result")
  .map((event) => ({ callId: event?.data?.message?.content?.[0]?.toolCallId, text: (event?.data?.message?.content?.[0]?.content ?? []).map((part) => part?.text ?? "").join("\n") }))
  .find((entry) => /verif env|workspace \//.test(entry.text)) ?? null
const dump = sessionLog === null ? null : join(outDir, "main-session.jsonl")
if (sessionLog !== null) writeFileSync(dump, shell("zstd", ["-d", "-c", sessionLog]))

const bootText = readLogTail(4_000_000)
const crashHits = [...bootText.matchAll(new RegExp(APPLY_CRASH.source, "g"))].map((match) => match[0])
const childSession = sessions.find((session) => session.file.includes(sessionId) === false)
const checks = []
const check = (id, pass, detail) => { checks.push({ id, status: pass ? "PASS" : "FAIL", detail: String(detail).slice(0, 1200) }); say(`CHECK ${id}=${pass ? "PASS" : "FAIL"} ${String(detail).slice(0, 400)}`) }
check("P1_CHILD_CWD_NOT_SESSION_WORKSPACE", childCwd === LAUNCH_CWD && LAUNCH_CWD !== ROOT, `child /proc cwd=${childCwd}`)
check("P2_APPLY_CRASH_SIGNATURES_ZERO", crashHits.length === 0, `hits=${JSON.stringify(crashHits)}`)
check("S1_CHILD_SESSION_RESOLVES_REPO", spawnToolResult !== null && spawnToolResult.text.includes(`workspace ${ROOT}`), `spawnResult=${spawnToolResult?.text?.slice(0, 600) ?? "<none>"}`)
check("S2_CHILD_SESSION_HEADER_CWD_IS_REPO", childSession === undefined ? false : childSession.cwd === ROOT, `childSession=${JSON.stringify(childSession ? { file: childSession.file, cwd: childSession.cwd, calls: childSession.calls } : null)}`)

const failed = checks.filter((entry) => entry.status !== "PASS")
const result = {
  task: "t8 follow-up — B1 on a CHILD (subagent / team-member-shaped) session",
  method: "fresh boot of the FIXED code with process cwd /root/dshProj; a real repo session spawns a one-shot roster subagent that calls mpd_verif_venv {action:info}",
  launchCwd: LAUNCH_CWD, bootChildCwd: childCwd, sessionWorkspace: ROOT,
  note: "no --dump-config result is cited as load evidence",
  applyCrashSignatures: crashHits,
  sessions,
  spawnToolResult: spawnToolResult?.text?.slice(0, 2000) ?? null,
  checks, failedChecks: failed.map((entry) => entry.id), passed: failed.length === 0,
}
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
rmSync(sandbox, { recursive: true, force: true })
say(`evidence -> ${outDir}`)
say(`passed=${result.passed} failed=${JSON.stringify(result.failedChecks)}`)
process.exit(result.passed ? 0 : 1)
