
import { spawn } from "node:child_process"
const child = spawn("node", ["/root/dshProj/my-power-dsh/packages/mpd-mcp-lsp/dist/cli.js","mcp"], {
  cwd: "/root/dshProj/my-power-dsh/",
  env: { PATH: process.env.PATH, HOME: "/root/dshProj/my-power-dsh/evidence/extensions/mcp-bridge-framing/20260914T171058Z/raw/home" },
  stdio: ["pipe", "pipe", "pipe"],
})
let out = ""
child.stdout.on("data", (chunk) => { out += String(chunk) })
child.stderr.on("data", () => {})
const first = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe", version: "0" } } }) + "\n"
child.stdin.write(first)
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n")
const started = Date.now()
while (Date.now() - started < 15000 && !out.includes('"id":2')) await new Promise((r) => setTimeout(r, 25))
const lines = out.split("\n").filter(Boolean)
child.kill("SIGTERM")
setTimeout(() => child.kill("SIGKILL"), 1500)
console.log(JSON.stringify({
  requestBytes: first.length,
  requestEndsWithNewline: first.endsWith("\n"),
  responseLines: lines.length,
  initializeResult: lines.length > 0 ? JSON.parse(lines[0]) : null,
  toolsListId: lines.length > 1 ? JSON.parse(lines[1]).id : null,
  sawContentLengthHeader: out.includes("Content-Length"),
}, null, 2))
