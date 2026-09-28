#!/usr/bin/env node

// The reference extension's stdio MCP server.
//
// It is deliberately dependency-free and small: it is the executable half of the
// proof that a data-plane extension can publish MCP tools without a profile patch
// row, and it doubles as a copy-paste starting point for a real server.
//
// Wire framing (measured, see packages/mpd-ext-plugin/src/mcp-client.ts):
// newline-delimited JSON-RPC 2.0 on stdin/stdout — one message per line, `\n`
// terminated. stdout carries protocol data ONLY; every diagnostic goes to stderr.
//
// Handshake: `initialize` (echo the requested protocolVersion) ->
// `notifications/initialized` (no reply) -> `tools/list` -> `tools/call`.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The extension root this server file lives in, derived from its own module URL. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The extension manifest this server reports on, resolved beside this file. */
const MANIFEST = join(HERE, "mpd-ext.json")

/** One MCP tool descriptor, in the shape `tools/list` must return it. */
interface ToolDescriptor {
  /** The tool name clients call (`describe_extension`). */
  name: string
  /** The short human title clients may display. */
  title: string
  /** The description clients show for the tool. */
  description: string
  /** The JSON Schema of the tool's arguments (object-rooted, no extra properties). */
  inputSchema: {
    /** Always `object`: MCP requires an object-rooted schema. */
    type: string
    /** The declared properties (empty — this tool takes no arguments). */
    properties: Record<string, unknown>
    /** Whether undeclared properties are rejected. */
    additionalProperties: boolean
  }
}

/** What `describe_extension` reports: the extension's identity, root, enabled flag and kinds. */
interface ManifestSummary {
  /** The extension id from its manifest (`unknown` when the manifest declares none). */
  id: string
  /** The extension root directory — the directory this server file lives in. */
  root: string
  /** Whether the manifest declares the extension as enabled. */
  enabled: boolean
  /** The contribution kinds that carry at least one entry. */
  kinds: string[]
}

/** One incoming JSON-RPC message, narrowed to the members this server dispatches on. */
interface JsonRpcMessage {
  /** The request id, echoed back on every reply; absent (or non-numeric) for notifications. */
  id?: unknown
  /** The method name (`initialize`, `ping`, `tools/list`, `tools/call`, ...). */
  method?: unknown
  /** The call parameters: `protocolVersion` for initialize, `name` for `tools/call`. */
  params?: { name?: unknown; protocolVersion?: unknown }
}

/**
 * View an unknown JSON value as a string-keyed bag, so a parsed manifest can be walked safely.
 *
 * @param value - A value produced by `JSON.parse`.
 * @returns The value viewed as a bag, or `undefined` when it is not an object.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the manifest is parsed JSON, so nothing about its shape is static.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/** The single tool this server publishes: report what the hosting extension declares. */
const TOOLS: readonly ToolDescriptor[] = [
  {
    name: "describe_extension",
    title: "Describe this extension",
    description:
      "Report the id, root and contributed kinds of the extension that hosts this server, read live from its mpd-ext.json manifest.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
]

/** Read this extension's own manifest and summarize it; throws when it is unreadable or `null`. */
function readManifest(): ManifestSummary {
  // The parsed manifest, kept `unknown` until the fields below are read.
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST, "utf8"))
  // The manifest viewed as a bag; `undefined` for a primitive (including JSON `null`).
  const manifest = asRecord(parsed)
  // A JSON `null` manifest is a hard read failure — the original `parsed.contributes` threw on it.
  if (manifest === undefined && parsed === null) throw new TypeError("mpd-ext.json parsed to null")
  // The manifest fields; a non-object manifest (string, number, boolean) simply carries none.
  const fields: Record<string, unknown> = manifest ?? {}
  // The `contributes` block, or an empty bag when the manifest declares none.
  const contributes = asRecord(fields.contributes) ?? {}
  return {
    id: String(fields.id ?? "unknown"),
    root: HERE,
    enabled: fields.enabled === true,
    kinds: ["skills", "flows", "mcp", "roles"].filter((kind) => Array.isArray(contributes[kind]) && contributes[kind].length > 0),
  }
}

/** Wrap a text payload in the MCP tool-result envelope every `tools/call` reply must use. */
function content(text: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: "text", text }] }
}

/**
 * Dispatch one decoded JSON-RPC message. Unknown methods with an id answer `-32601`; notifications
 * (no id) are dropped silently, because JSON-RPC forbids replying to them.
 *
 * @param message - The decoded wire message.
 */
function handle(message: JsonRpcMessage): void {
  // The method being dispatched; a message without one can only be answered as "method not found".
  const method = message.method
  if (method === "initialize") {
    // The protocol version to echo: the client's own when it asked for one, else the MCP default.
    const requested = message.params && typeof message.params.protocolVersion === "string" ? message.params.protocolVersion : "2024-11-05"
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: requested,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mpd-ext-example", version: "0.9.0" },
    } })
    return
  }
  if (method === "notifications/initialized") return
  if (method === "ping") { send({ jsonrpc: "2.0", id: message.id, result: {} }); return }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } })
    return
  }
  if (method === "tools/call") {
    // The requested tool name; anything but `describe_extension` is answered as a text result.
    const name = message.params?.name
    if (name !== "describe_extension") {
      send({ jsonrpc: "2.0", id: message.id, result: content(`unknown tool "${String(name)}"; this server serves: ${TOOLS.map((tool) => tool.name).join(", ")}`) })
      return
    }
    try {
      send({ jsonrpc: "2.0", id: message.id, result: content(JSON.stringify(readManifest(), null, 2)) })
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `cannot read the manifest: ${String(error)}` }], isError: true } })
    }
    return
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${String(method)}` } })
  }
}

/** Write one framed JSON-RPC message to stdout (the protocol stream, never a diagnostic). */
function send(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + "\n")
}

/** The decoded-line accumulator: stdin arrives in chunks, lines are split out below. */
let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  buffer += chunk
  // Index of the next newline in the accumulator; recomputed after every consumed line.
  let index: number
  while ((index = buffer.indexOf("\n")) !== -1) {
    // The next complete line, without its terminator (a trailing CR is tolerated for Windows clients).
    const line = buffer.slice(0, index).replace(/\r$/, "")
    buffer = buffer.slice(index + 1)
    if (line.trim() === "") continue
    // The decoded message for this line, filled by the parse below.
    let message: JsonRpcMessage
    try {
      // JSON.parse has no static result type, so the wire payload is asserted to the dispatch
      // surface; every field of that surface is read defensively by `handle` above.
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      process.stderr.write("[mpd-ext-example] ignoring a non-JSON line on stdin\n")
      continue
    }
    try {
      handle(message)
    } catch (error) {
      process.stderr.write(`[mpd-ext-example] ${String(error)}\n`)
    }
  }
})

process.on("SIGTERM", () => process.exit(0))
process.on("SIGINT", () => process.exit(0))
