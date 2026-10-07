#!/usr/bin/env node
// Reproducible probe: does the ast_grep MCP answer a tool call on THIS host?
//
// Why it exists: the resolver (`packages/mpd-mcp-shared/bin-resolve.mjs`) hands the binary to the
// adopted server through `MPD_AST_GREP_SG_PATH`, and the adopted server only reports
// `BINARY_NOT_FOUND` when a tool is CALLED - `tools/list` answers fine either way. So a tools/list
// probe cannot witness the defect; this one calls `search`.
//
// Measured before the win32 fix (2026-09-22): ok=false, error.code=BINARY_NOT_FOUND.
// Measured after: ok=true with matches.
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")
const launcher = resolve(repo, "packages", "mpd-mcp-astgrep", "launch.mjs")
const child = spawn(process.execPath, [launcher], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] })
let stdout = ""
let stderr = ""
child.stdout.on("data", (chunk) => { stdout += chunk })
child.stderr.on("data", (chunk) => { stderr += chunk })
const send = (message) => child.stdin.write(JSON.stringify(message) + "\n")
const answer = (id) => {
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const record = JSON.parse(line)
      if (record.id === id) return record
    } catch { /* a partial line is simply not the answer */ }
  }
  return null
}
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mpd-windows-probe", version: "0" } } })
setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }), 700)
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { pattern: "join($A, $B)", language: "javascript", paths: ["packages/mpd-mcp-shared"] } } }), 1400)
setTimeout(() => {
  const record = answer(2)
  child.kill()
  if (record === null) {
    console.log(JSON.stringify({ ok: false, reason: "no tools/call answer within the probe budget", stderr }, null, 2))
    process.exit(1)
  }
  const payload = JSON.parse(record.result.content[0].text)
  const summary = { platform: process.platform, isError: record.result.isError === true, ok: payload.ok, errorCode: payload.error?.code ?? null, returnedMatches: payload.counts?.returnedMatches ?? 0 }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(payload.ok === true ? 0 : 1)
}, 11_000)