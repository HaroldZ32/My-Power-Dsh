#!/usr/bin/env node

// The template extension's stdio MCP server.
//
// Dependency-free on purpose: node stdlib only, no package.json, no install step.
// It is the executable half of the proof that a data-plane extension can publish
// MCP tools without a profile patch row, and it doubles as a copy-paste starting
// point for a real server.
//
// Wire framing: newline-delimited JSON-RPC 2.0 on stdin/stdout — one message per
// line, `\n` terminated. stdout carries protocol data ONLY; every diagnostic goes
// to stderr.
//
// Handshake: `initialize` (echo the requested protocolVersion) ->
// `notifications/initialized` (no reply) -> `tools/list` -> `tools/call`.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(HERE, "mpd-ext.json")
const KINDS = ["skills", "flows", "mcp", "roles"]

const TOOLS = [
  {
    name: "describe_extension",
    description:
      "Report the id, root and contributed kinds of the extension that hosts this server, read live from its mpd-ext.json manifest.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
]

function readManifest() {
  const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"))
  const contributes = parsed.contributes ?? {}
  return {
    id: String(parsed.id ?? "unknown"),
    root: HERE,
    enabled: parsed.enabled === true,
    kinds: KINDS.filter((kind) => Array.isArray(contributes[kind]) && contributes[kind].length > 0),
  }
}

function content(text) {
  return { content: [{ type: "text", text }] }
}

/** Diagnostics carry the extension's own id, so a copied tree logs its own name. */
function label() {
  try {
    return `[${readManifest().id}]`
  } catch {
    return "[mpd-ext]"
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n")
}

function handle(message) {
  const method = message.method
  if (method === "initialize") {
    const requested =
      message.params && typeof message.params.protocolVersion === "string" ? message.params.protocolVersion : "2024-11-05"
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: readManifest().id, version: "0.1.0" },
      },
    })
    return
  }
  if (method === "notifications/initialized") return
  if (method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} })
    return
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } })
    return
  }
  if (method === "tools/call") {
    const name = message.params?.name
    if (name !== "describe_extension") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: content(`unknown tool "${String(name)}"; this server serves: ${TOOLS.map((tool) => tool.name).join(", ")}`),
      })
      return
    }
    try {
      send({ jsonrpc: "2.0", id: message.id, result: content(JSON.stringify(readManifest(), null, 2)) })
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: `cannot read the manifest: ${String(error)}` }], isError: true },
      })
    }
    return
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${String(method)}` } })
  }
}

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\n")) !== -1) {
    const text = buffer.slice(0, index).replace(/\r$/, "")
    buffer = buffer.slice(index + 1)
    if (text.trim() === "") continue
    let message
    try {
      message = JSON.parse(text)
    } catch {
      process.stderr.write(`${label()} ignoring a non-JSON line on stdin\n`)
      continue
    }
    try {
      handle(message)
    } catch (error) {
      process.stderr.write(`${label()} ${String(error)}\n`)
    }
  }
})

process.on("SIGTERM", () => process.exit(0))
process.on("SIGINT", () => process.exit(0))
