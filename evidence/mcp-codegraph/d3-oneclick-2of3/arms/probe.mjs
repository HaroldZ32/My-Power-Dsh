// Minimal MCP stdio client for the D-3 reproduction: one initialize + one tools/list, then a verdict.
// Framing: the MCP stdio transport is newline-delimited JSON (no Content-Length headers).
import { spawn } from "node:child_process"

const launcher = process.argv[2]
const budgetMs = Number(process.argv[3] ?? 25000)
const child = spawn(process.execPath, [launcher], { stdio: ["pipe", "pipe", "pipe"], env: process.env })

let buffer = ""
let initOk = false
let finished = false
const labels = []

function finish(verdict, detail) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  try { child.kill("SIGKILL") } catch {}
  console.log(`VERDICT=${verdict}`)
  console.log(`TOOLS=${labels.length}`)
  console.log(`TOOL_NAMES=${labels.join(",")}`)
  if (detail) console.log(`DETAIL=${detail}`)
  process.exitCode = verdict === "ok" ? 0 : 1
  setTimeout(() => process.exit(process.exitCode ?? 1), 50)
}

const timer = setTimeout(() => finish("timeout", `no tools/list answer within ${budgetMs}ms; stdoutBytes=${buffer.length}`), budgetMs)

child.on("error", (e) => finish("spawn-error", e.message))
child.on("exit", (code, signal) => finish("child-exit", `code=${code} signal=${signal} stdoutBytes=${buffer.length} initOk=${initOk}`))
child.stderr.on("data", () => {})

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8")
  let index = buffer.indexOf("\n")
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line.length > 0) handle(line)
    index = buffer.indexOf("\n")
  }
})

function handle(line) {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.id === 1 && message.result) {
    initOk = true
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n")
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n")
    return
  }
  if (message.id === 2) {
    for (const tool of message.result?.tools ?? []) labels.push(String(tool.name))
    labels.sort()
    finish("ok", "")
  }
}

child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cg-repro", version: "0" } } }) + "\n")
