// Drive the REAL launcher (packages/mpd-mcp-codegraph/launch.mjs) over stdio with
// MCP JSON-RPC and assert it answers initialize + tools/list. Degraded mode (no
// binary) is acceptable and must be stated: the surface must stay ALIVE.
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"

const repoRoot = "/root/dshProj/my-power-dsh"
const launcher = repoRoot + "/packages/mpd-mcp-codegraph/launch.mjs"
const sandbox = process.argv[2]
const outJson = process.argv[3]

const child = spawn(process.execPath, [launcher], {
  cwd: sandbox + "/project",
  env: {
    PATH: process.env.PATH,
    HOME: sandbox + "/home",
    PWD: sandbox + "/project",
    MPD_CODEGRAPH_BIN: "/nonexistent/mpd-codegraph-probe-unavailable"
  },
  stdio: ["pipe", "pipe", "pipe"]
})
let stdout = ""
let stderr = ""
child.stdout.on("data", (d) => { stdout += String(d) })
child.stderr.on("data", (d) => { stderr += String(d) })

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n")
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } } })
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 300)
setTimeout(() => child.stdin.end(), 600)

const result = await new Promise((resolvePromise) => {
  child.on("exit", (code) => resolvePromise({ code }))
  setTimeout(() => { child.kill("SIGKILL"); resolvePromise({ code: "timeout-killed" }) }, 15000)
})

const lines = stdout.split("\n").filter((l) => l.trim().length > 0)
const parsed = []
for (const line of lines) { try { parsed.push(JSON.parse(line)) } catch { parsed.push({ unparsed: line }) } }
const byId = (id) => parsed.find((m) => m.id === id)
writeFileSync(outJson, JSON.stringify({
  launcher,
  exit_code: result.code,
  initialized: byId(1) !== undefined,
  initialize_result: byId(1) ?? null,
  tools_listed: byId(2) !== undefined,
  tools_list_result: byId(2) ?? null,
  degraded_stderr: stderr.split("\n").filter((l) => l.trim().length > 0),
  stdout_line_count: lines.length
}, null, 2) + "\n")
console.log(JSON.stringify({ exit: result.code, initialized: byId(1) !== undefined, tools_listed: byId(2) !== undefined }, null, 0))
console.log(stderr.split("\n").filter((l) => l.trim().length > 0).join(" | "))
