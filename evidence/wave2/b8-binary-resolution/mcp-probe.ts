#!/usr/bin/env node
// Minimal MCP stdio client used by the B8 gate: spawn an MCP server (our launcher),
// do the initialize handshake, list tools, and call one tool. Newline-delimited
// JSON-RPC (the MCP stdio framing) — no host-side SDK path dependency.
//
// Usage: node mcp-probe.mjs <serverEntry> <toolName|--list|--list-json> [argsJson] [--cwd <dir>]
// Env is inherited; the caller scrubs/pins what it wants to test.
// Prints one JSON object on stdout: { ok, tools, result, error, stderr }
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(here, "..", "..", "..", "packages")

export function probe(entry, toolName, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let buf = ""
    let stderr = ""
    const out = { ok: false, tools: null, result: null, error: null, stderr: "" }
    const pending = new Map()
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n")
    const finish = (extra = {}) => {
      Object.assign(out, extra)
      out.stderr = stderr.slice(0, 4000)
      try { child.kill() } catch { /* ignore */ }
      resolve(out)
    }
    child.stderr.on("data", (d) => { stderr += d.toString() })
    child.stdout.on("data", (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        const waiter = pending.get(msg.id)
        if (waiter) { pending.delete(msg.id); waiter(msg) }
      }
    })
    child.on("error", (e) => finish({ error: "spawn: " + String(e) }))
    child.on("exit", (code) => {
      if (!out.done) finish({ error: `server exited early (code ${code})` })
    })
    const request = (id, method, params) => new Promise((res) => {
      pending.set(id, res)
      send({ jsonrpc: "2.0", id, method, params })
    })
    ;(async () => {
      try {
        const init = await request(1, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "b8-gate", version: "0.1.0" },
        })
        if (init?.error) return finish({ error: "initialize: " + JSON.stringify(init.error) })
        send({ jsonrpc: "2.0", method: "notifications/initialized" })
        const list = await request(2, "tools/list", {})
        const tools = (list?.result?.tools ?? []).map((t) => t.name)
        if (toolName === "--list" || toolName === "--list-json") return finish({ ok: true, tools })
        const call = await request(3, "tools/call", { name: toolName, arguments: args ?? {} })
        if (call?.error) return finish({ ok: false, tools, error: JSON.stringify(call.error) })
        const content = call?.result?.content ?? []
        const text = content.map((c) => (typeof c?.text === "string" ? c.text : JSON.stringify(c))).join("\n")
        out.done = true
        finish({ ok: !call?.result?.isError, tools, result: { isError: Boolean(call?.result?.isError), text: text.slice(0, 4000) } })
      } catch (e) {
        finish({ error: "probe: " + String(e) })
      }
    })()
    setTimeout(() => { if (!out.done) finish({ error: "timeout waiting for server" }) }, opts.timeoutMs ?? 60_000)
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2)
  let cwd
  const cwdIdx = argv.indexOf("--cwd")
  if (cwdIdx >= 0) {
    cwd = argv[cwdIdx + 1]
    argv.splice(cwdIdx, 2)
  }
  const [entry, toolName, argsJson] = argv
  const r = await probe(entry, toolName, argsJson ? JSON.parse(argsJson) : undefined, { cwd })
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok || (toolName === "--list" && r.tools) ? 0 : 1)
}
