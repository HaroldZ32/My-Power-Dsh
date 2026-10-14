#!/usr/bin/env node
// SIMULATION DEVICE (scratch, never shipped) — the "declared MCP dependency is not installed" state.
//
// WHY: the oneclick lane's QA cases boot a tree whose LSP MCP row cannot resolve its declared
// dependency `cclsp` (the container's /opt/mpd checkout is never `bun install`ed), so
// packages/mpd-mcp-lsp/src/launch.ts takes its `dependency === null` branch and calls
// `serveUnavailable(...)`: the row stays ALIVE and answers the MCP handshake with an EMPTY tool list.
// This stub reproduces exactly that observable state at the dependency's own name, so the two QA
// cases can be exercised locally in the oneclick condition without Docker.
//
// It is NOT a product artifact: it lives under the scratch root /.qa-oneclick (gitignored) and is
// replaced by the real dependency as soon as the fix under test stages one.
process.stdin.setEncoding("utf8")
let buffer = ""
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n")
for await (const chunk of process.stdin) {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() === "") continue
    let request
    try { request = JSON.parse(line) } catch { continue }
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lsp", version: "unavailable-simulation" } } })
    } else if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } })
    } else if (request.id !== undefined) {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "lsp is unavailable on this host (simulation)" } })
    }
  }
}
