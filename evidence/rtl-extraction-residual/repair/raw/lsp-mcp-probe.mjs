#!/usr/bin/env node
// Behaviour probe for the regenerated LSP MCP server (t8 / R1.1).
// Spawns `<cli> mcp`, performs the MCP initialize + tools/list handshake over stdio,
// prints the tool count and the tool names, and exits non-zero if the server does not answer.
// Usage: node lsp-mcp-probe.mjs <path-to-cli.js>
import { spawn } from "node:child_process"

const cli = process.argv[2]
if (!cli) { console.error("usage: node lsp-mcp-probe.mjs <cli.js>"); process.exit(2) }

const child = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "pipe"] })
let buf = ""
const responses = new Map()
const deadline = setTimeout(() => { console.error("[probe] TIMEOUT"); child.kill("SIGKILL"); process.exit(1) }, 30000)

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8")
  let at
  while ((at = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, at).trim(); buf = buf.slice(at + 1)
    if (line === "") continue
    try { const msg = JSON.parse(line); if (msg.id !== undefined) responses.set(msg.id, msg) } catch { /* non-JSON banner line */ }
  }
})

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n")

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mpd-t8-probe", version: "1.0.0" } } })

const waitFor = async (id, ms = 25000) => {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (responses.has(id)) return responses.get(id)
    await new Promise((r) => setTimeout(r, 100))
  }
  return undefined
}

const init = await waitFor(1)
if (!init) { console.error("[probe] FAIL: no initialize response"); child.kill("SIGKILL"); process.exit(1) }
send({ jsonrpc: "2.0", method: "notifications/initialized" })
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
const list = await waitFor(2)
if (!list) { console.error("[probe] FAIL: no tools/list response"); child.kill("SIGKILL"); process.exit(1) }
let status = null
if ((list.result?.tools ?? []).some((t) => t.name === "status")) {
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: {} } })
  const st = await waitFor(3, 15000)
  status = st?.result?.content?.[0]?.text ?? st?.result ?? null
}
clearTimeout(deadline)
child.kill("SIGKILL")
if (!list) { console.error("[probe] FAIL: no tools/list response"); process.exit(1) }
const tools = (list.result?.tools ?? []).map((t) => t.name).sort()
console.log(JSON.stringify({
  cli,
  serverInfo: init.result?.serverInfo ?? null,
  toolsCount: tools.length,
  tools,
  status,
}, null, 2))
process.exit(0)
