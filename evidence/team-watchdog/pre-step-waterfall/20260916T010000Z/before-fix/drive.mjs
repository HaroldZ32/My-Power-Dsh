// Evidence driver for the pre-step waterfall defect (fixed 2026-09-16).
//
// WHAT IT MEASURES: a REAL dev-web boot of this checkout (bundles base + web-app +
// @mpd-dsh/mpd), a real `session/create` on agentPreset `mpd`, and a real
// `session/prompt`. Before the fix the FIRST turn of EVERY session died ~120 ms in,
// before any model call, with `Cannot read properties of undefined (reading 'map')`
// (or `findLastIndex` / `length` depending on the workspace state) — because the
// watchdog's `agent/pre-step` listener returned a HeartbeatStamp into a cordis
// waterfall and thereby REPLACED the step decision. After the fix the turn reaches
// the model and the harness records a normal turn/end.
//
// Run: node evidence/team-watchdog/pre-step-waterfall/<ts>/drive.mjs
// Writes result.json + output.log beside itself. Never touches the real ~/.dsh
// (DSH_HOME and HOME are sandboxed; the workspace is a fresh temp dir).
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { decodeSessionLog } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/session-evidence.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = "/root/dshProj/my-power-dsh"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const LOG = []

function makeSandbox(tag, copyState) {
  const sandbox = mkdtempSync(join(tmpdir(), "mxw-" + tag + "-"))
  const home = join(sandbox, "home")
  const profile = join(home, "profiles", "w")
  const userHome = join(sandbox, "userhome")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  for (const name of [".credentials.yaml", ".anonymous-user-id", "settings.yaml"]) {
    const src = join(homedir(), ".dsh", name)
    if (existsSync(src)) cpSync(src, join(home, name))
  }
  symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, null, 2))
  const ws = join(sandbox, "ws"); mkdirSync(ws, { recursive: true })
  if (copyState) {
    mkdirSync(join(ws, ".mpd"), { recursive: true })
    for (const entry of readdirSync(join(ROOT, ".mpd"))) {
      if (entry === "recon" || entry === "tmp-investigate") continue
      cpSync(join(ROOT, ".mpd", entry), join(ws, ".mpd", entry), { recursive: true })
    }
  }
  return { sandbox, home, ws, env: { ...process.env, DSH_HOME: home, HOME: userHome } }
}

/** Every turn/end + assistant text of the newest session log under one sandbox home. */
function readTurns(home) {
  const events = []
  const root = join(home, "sessions")
  if (!existsSync(root)) return events
  for (const key of readdirSync(root)) {
    const dir = join(root, key)
    for (const id of readdirSync(dir)) {
      const sd = join(dir, id)
      let names = []
      try { names = readdirSync(sd) } catch { continue }
      for (const name of names) {
        if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
        try {
          const decoded = decodeSessionLog(join(sd, name))
          for (const line of decoded.text.split("\n")) {
            if (line.includes('"turn/end"') || line.includes('"assistant/message"')) events.push(line)
          }
        } catch (error) { events.push("decode-failed: " + String(error)) }
      }
    }
  }
  return events
}

async function run(tag, port, copyState) {
  const s = makeSandbox(tag, copyState)
  const logPath = join(s.sandbox, "boot.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env: s.env, cwd: s.ws, stdio: ["ignore", fd, fd] })
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  let token = "", cookie = ""
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    await sleep(1200)
    const m = /token=([A-Za-z0-9_-]+)/.exec(readLog()); if (m) token = m[1]
    if (token === "") continue
    try {
      const auth = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(6000) })
      cookie = (auth.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ") || cookie
      break
    } catch { /* retry */ }
  }
  const rpc = async (method, payload, timeout = 60000) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(timeout) })
    return { status: res.status, body: await res.text() }
  }
  const created = await rpc("session/create", { args: { request: { cwd: s.ws, agentPreset: "mpd" } } })
  const sessionId = JSON.parse(created.body)?.result?.value?.sessionId ?? ""
  const prompt = sessionId === "" ? null : await rpc("session/prompt", { args: { request: { requestId: randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text: "Reply with exactly: watchdog-pre-step-ok" }] } } })
  // Wait for the turn to settle (a live model call needs a few seconds).
  let turns = []
  const settle = Date.now() + 120000
  while (Date.now() < settle) {
    await sleep(3000)
    turns = readTurns(s.home)
    if (turns.some((line) => line.includes('"turn/end"'))) break
  }
  child.kill("SIGKILL")
  await sleep(400)
  const entry = {
    tag,
    copyState,
    workspace: s.ws,
    bootLine: /dsh web: http[^\s]*/.exec(readLog())?.[0]?.replace(/token=.*/, "token=<redacted>") ?? null,
    create: { status: created.status, ok: created.body.includes('"ok":true'), agentPreset: /"agentPreset":"([^"]+)"/.exec(created.body)?.[1] ?? null },
    prompt: prompt === null ? null : { status: prompt.status, accepted: prompt.body.includes('"accepted":true') },
    turnEnd: turns.filter((l) => l.includes('"turn/end"')).slice(-2),
    assistantText: turns.filter((l) => l.includes('"assistant/message"')).slice(-1).map((l) => l.slice(0, 600)),
    crashSignatures: turns.filter((l) => l.includes("reading 'map'") || l.includes("reading 'findLastIndex'") || l.includes("reading 'length'")).slice(-2),
    watchdogBootLine: (/\[mpd-team-watchdog\] applied:[^\n]*/.exec(readLog()) ?? [null])[0],
  }
  LOG.push("### " + tag + "\n" + JSON.stringify(entry, null, 2))
  return entry
}

const entries = []
entries.push(await run("empty", 3251, false))
entries.push(await run("copied", 3252, true))
const ok = entries.every((entry) => entry.create.ok && entry.prompt?.accepted === true && entry.crashSignatures.length === 0)
writeFileSync(join(HERE, "result.json"), JSON.stringify({ ok, defect: "cannot-read-map-at-pre-step", rule: "a cordis waterfall listener that returns without calling next() REPLACES the step decision", entries }, null, 2))
writeFileSync(join(HERE, "output.log"), LOG.join("\n\n"))
console.log("[pre-step-waterfall] ok=" + ok)
for (const entry of entries) console.log("  " + entry.tag + ": turnEnd=" + String(entry.turnEnd.at(-1)).slice(0, 200) + " crashes=" + entry.crashSignatures.length)
