// t38: does the WEB plane resolve the mpd preset BY DEFAULT (no agentPreset in the request)?
import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { readSessionHeaders } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"
const S = process.argv[2], OUT = process.argv[3], PORT = Number(process.argv[4] ?? 43127)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const read = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const env = { ...process.env, DSH_HOME: join(S, "dshhome"), HOME: join(S, "home"), npm_config_cache: join(S, "npm-cache"), PNPM_HOME: join(S, "pnpm-home"), XDG_CONFIG_HOME: join(S, "config"), XDG_DATA_HOME: join(S, "data") }
const before = new Set(readSessionHeaders(S, 40).map((e) => e.sessionId))
const logPath = join(OUT, "boot-web-default.log"); rmSync(logPath, { force: true })
const fd = openSync(logPath, "w")
const child = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], { env, cwd: join(S, "ws"), stdio: ["ignore", fd, fd] })
let cookie = "", token = ""
const deadline = Date.now() + 120_000
while (Date.now() < deadline) {
  await sleep(1500)
  const m = /token=([A-Za-z0-9_-]+)/.exec(read(logPath)); if (m) token = m[1]
  if (token) { try { const a = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) }); cookie = (a.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ") || cookie; const r = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8000) }); if (cookie && r.status === 200) break } catch {} }
}
// NO agentPreset in the request — the plane's own default must resolve
const res = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ type: "client-request", rpcId: "t38-default-" + Date.now(), method: "session/create", payload: { args: { request: { cwd: join(S, "ws") } } } }), signal: AbortSignal.timeout(90000) }).catch((e) => ({ status: 0, json: async () => ({ transport: String(e?.message ?? e) }) }))
const env2 = await res.json().catch(() => ({}))
await sleep(2500)
try { child.kill("SIGTERM") } catch {} await sleep(2000); try { child.kill("SIGKILL") } catch {}
const after = readSessionHeaders(S, 40)
const created = after.filter((e) => !before.has(e.sessionId))
const out = { status: res.status, envelopeKeys: Object.keys(env2 ?? {}), resultKeys: Object.keys(env2?.result ?? {}), createdSessions: created.map((e) => ({ sessionId: e.sessionId.slice(0, 8), agentPreset: e.agentPreset, cwd: e.cwd })), note: "created WITHOUT agentPreset in the request — agentPreset here is what the web plane resolved by itself" }
writeFileSync(join(OUT, "web-default-preset.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify(out, null, 1))
