#!/usr/bin/env node
/** t8 diagnostic: print the RAW gateway envelopes for session/create and session/prompt. */
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")
const LAUNCH_CWD = "/root/dshProj"
const PORT = 3194
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t8-diag-"))
const home = join(sandbox, "dsh-home")
const userhome = join(sandbox, "user-home")
const profile = join(home, "profiles", "w")
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(userhome, { recursive: true })
mkdirSync(home, { recursive: true })
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "p", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, null, 2))
for (const name of [".credentials.yaml", "settings.yaml"]) { const source = join(homedir(), ".dsh", name); if (existsSync(source)) cpSync(source, join(home, name)) }

const bootLog = join(sandbox, "boot.log")
const fd = openSync(bootLog, "w")
const child = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], { cwd: LAUNCH_CWD, env: { ...process.env, DSH_HOME: home, HOME: userhome }, stdio: ["ignore", fd, fd] })
const readLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
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
    const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie }, signal: AbortSignal.timeout(8000) })
    if (root.status === 200) break
  } catch { /* not up */ }
}
const raw = async (method, request) => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ type: "client-request", rpcId: "diag-" + Date.now(), method, payload: { args: { request } } }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  return { status: response.status, body: text.slice(0, 1200) }
}
const created = await raw("session/create", { cwd: ROOT, agentPreset: "mpd" })
console.log("[diag] create:", JSON.stringify(created))
let sessionId = null
try { sessionId = JSON.parse(created.body)?.result?.value?.sessionId ?? JSON.parse(created.body)?.result?.sessionId ?? null } catch { /* ignore */ }
console.log("[diag] sessionId:", sessionId)
if (sessionId !== null) {
  console.log("[diag] method=session/prompt request={sessionId, requestId, content}")
  console.log("[diag] prompt:", JSON.stringify(await raw("session/prompt", { sessionId, requestId: "diag-1", content: [{ type: "text", text: "Reply with the single word: pong" }] })))
  console.log("[diag] method=session/prompt + clientTimeZone")
  console.log("[diag] prompt2:", JSON.stringify(await raw("session/prompt", { sessionId, requestId: "diag-2", content: [{ type: "text", text: "Reply with the single word: pong2" }], clientTimeZone: "UTC" })))
  await sleep(8000)
  const logs = []
  const walk = (dir) => { for (const e of existsSync(dir) ? require("node:fs").readdirSync(dir, { withFileTypes: true }) : []) { const p = join(dir, e.name); if (e.isDirectory()) { if (existsSync(join(p, "session.v3.jsonl.zstd"))) logs.push(join(p, "session.v3.jsonl.zstd")); walk(p) } } }
  walk(join(home, "sessions"))
  console.log("[diag] session logs:", JSON.stringify(logs.map((l) => l.replace(home, "$DSH_HOME"))))
  for (const l of logs) {
    const text = (await import("node:child_process")).execFileSync("zstd", ["-d", "-c", l], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    console.log("[diag] log", l.includes(sessionId) ? "<main>" : "<other>", "lines=", text.split("\n").filter(Boolean).length)
    console.log(text.split("\n").filter(Boolean).slice(-6).join("\n").slice(0, 1500))
  }
}
try { child.kill("SIGTERM") } catch { /* gone */ }
await sleep(1500)
try { child.kill("SIGKILL") } catch { /* gone */ }
rmSync(sandbox, { recursive: true, force: true })
