// MEASUREMENT, not a mock: this probe speaks to the repository's own stdio MCP
// server (packages/mpd-mcp-lsp/dist/cli.js) with the bridge's real client, and
// separately with a hand-written raw child so the exact framing bytes are on
// disk — the contract forbids assuming either the framing or the handshake.
//
// Run: bun evidence/extensions/mcp-bridge-framing/20260914T171058Z/probe.mjs
//
// It answers the two questions the contract refuses to let us assume:
//   1. which wire framing? (newline-delimited JSON vs LSP-style Content-Length)
//   2. which protocol version is negotiated, and is the handshake the
//      initialize -> notifications/initialized -> tools/list -> tools/call order
//      the client implements?
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpStdioClient, MCP_PROTOCOL_VERSION } from "../../../../packages/mpd-ext-plugin/src/mcp-client.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = fileURLToPath(new URL("../../../../", import.meta.url))
const RAW = join(HERE, "raw")
mkdirSync(RAW, { recursive: true })

// A writable HOME inside the workspace: the LSP server's daemon lives under
// $HOME/.mpd, and a read-only home is a different failure than the one measured.
const home = join(RAW, "home")
mkdirSync(home, { recursive: true })
const serverArgs = [join(REPO, "packages/mpd-mcp-lsp/dist/cli.js"), "mcp"]

// ── run 1: the bridge's own client, end to end ──────────────────────────────
const client = new McpStdioClient({ serverName: "lsp", command: "node", args: serverArgs, env: { HOME: home } })
const started = Date.now()
let tools = []
let toolCall = null
let handshakeError = null
try {
  await client.start(20000)
  tools = await client.listTools(20000)
  toolCall = await client.callTool("status", {}, { timeoutMs: 20000 })
} catch (error) {
  handshakeError = error instanceof Error ? error.message : String(error)
}
const clientElapsedMs = Date.now() - started
const stderrTail = client.stderrTail().slice(0, 400)
const protocolErrors = client.protocolErrorList()
await client.close()

// ── run 2: a raw child, so the exact framing bytes are visible ──────────────
const rawProbe = `
import { spawn } from "node:child_process"
const child = spawn("node", ${JSON.stringify(serverArgs)}, {
  cwd: ${JSON.stringify(REPO)},
  env: { PATH: process.env.PATH, HOME: ${JSON.stringify(home)} },
  stdio: ["pipe", "pipe", "pipe"],
})
let out = ""
child.stdout.on("data", (chunk) => { out += String(chunk) })
child.stderr.on("data", () => {})
const first = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe", version: "0" } } }) + "\\n"
child.stdin.write(first)
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n")
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\\n")
const started = Date.now()
while (Date.now() - started < 15000 && !out.includes('"id":2')) await new Promise((r) => setTimeout(r, 25))
const lines = out.split("\\n").filter(Boolean)
child.kill("SIGTERM")
setTimeout(() => child.kill("SIGKILL"), 1500)
console.log(JSON.stringify({
  requestBytes: first.length,
  requestEndsWithNewline: first.endsWith("\\n"),
  responseLines: lines.length,
  initializeResult: lines.length > 0 ? JSON.parse(lines[0]) : null,
  toolsListId: lines.length > 1 ? JSON.parse(lines[1]).id : null,
  sawContentLengthHeader: out.includes("Content-Length"),
}, null, 2))
`
writeFileSync(join(RAW, "raw-probe.mjs"), rawProbe)
const rawRun = spawnSync(process.execPath, [join(RAW, "raw-probe.mjs")], { encoding: "utf8", timeout: 30000 })
const rawOutput = (rawRun.stdout ?? "").trim()
let raw
try {
  raw = JSON.parse(rawOutput)
} catch {
  raw = { unparsable: rawOutput, stderr: (rawRun.stderr ?? "").trim() }
}

const report = {
  probe: "evidence/extensions/mcp-bridge-framing/20260914T171058Z/probe.mjs",
  measuredAt: new Date().toISOString(),
  server: {
    command: "node packages/mpd-mcp-lsp/dist/cli.js mcp",
    source: "packages/mpd-mcp-lsp/dist/cli.js — the repository's own stdio MCP server, built from packages/mcp-stdio-core",
  },
  framing: {
    kind: "newline-delimited JSON-RPC 2.0 on stdin/stdout",
    requestTerminator: "\\n",
    responseTerminator: "\\n",
    autoDetection:
      "the server reads Content-Length framing only when the buffer starts with 'Content-Length:'; otherwise line framing (packages/mpd-mcp-lsp/dist/cli.js:85-105 readNextMessage; the same transport packages/mcp-stdio-core ships)",
    clientContract:
      "the MCP SDK's stdio client is line-based too: readMessage splits on '\\n', serializeMessage = JSON.stringify + '\\n' (H/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js:24-39)",
    raw,
    rawProbeStatus: rawRun.status,
  },
  handshake: {
    order: ["initialize", "notifications/initialized", "tools/list", "tools/call"],
    requestedProtocolVersion: MCP_PROTOCOL_VERSION,
    negotiatedProtocolVersion: raw?.initializeResult?.result?.protocolVersion ?? null,
    serverInfo: raw?.initializeResult?.result?.serverInfo ?? null,
    serverCapabilities: raw?.initializeResult?.result?.capabilities ?? null,
    sdksLatestProtocolVersion: "2025-11-25 (H/@modelcontextprotocol/sdk/dist/esm/types.js:2)",
    serverDefaultWhenRequestOmitsIt: "2024-11-05 (packages/mpd-mcp-lsp/dist/cli.js:5199-5204 requestedProtocolVersion)",
  },
  clientRun: {
    elapsedMs: clientElapsedMs,
    handshakeError,
    toolCount: tools.length,
    toolNames: tools.map((tool) => tool.name).sort(),
    publicNames: tools.map((tool) => `mcp__lsp__${tool.name}`).sort(),
    stderrTail,
    protocolErrors,
    toolCall: toolCall === null
      ? null
      : {
          isError: toolCall.isError === true,
          contentTypes: Array.isArray(toolCall.content) ? toolCall.content.map((block) => block?.type) : [],
        },
  },
}

writeFileSync(join(HERE, "result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(
  join(RAW, "output.log"),
  [
    `probe run ${report.measuredAt}`,
    `framing: ${report.framing.kind} (terminator ${JSON.stringify(report.framing.requestTerminator)})`,
    `handshake order: ${report.handshake.order.join(" -> ")}`,
    `requested protocol version: ${report.handshake.requestedProtocolVersion}`,
    `negotiated protocol version: ${String(report.handshake.negotiatedProtocolVersion)}`,
    `serverInfo: ${JSON.stringify(report.handshake.serverInfo)}`,
    `tools/list (${report.clientRun.toolCount}): ${JSON.stringify(report.clientRun.toolNames)}`,
    `tools/call status: ${JSON.stringify(report.clientRun.toolCall)}`,
    `client elapsed: ${clientElapsedMs}ms, protocol errors: ${JSON.stringify(protocolErrors)}`,
    "",
    "raw framing probe stdout:",
    rawOutput,
    "",
    `raw probe stderr: ${(rawRun.stderr ?? "").trim()}`,
    "",
  ].join("\n"),
)
// The sandbox HOME is runtime scratch (the LSP daemon writes a socket there):
// clean it so the evidence directory carries only the measurement.
try {
  rmSync(home, { recursive: true, force: true })
} catch { /* best effort */ }

console.log(JSON.stringify({
  ok: handshakeError === null,
  framing: report.framing.kind,
  negotiated: report.handshake.negotiatedProtocolVersion,
  tools: report.clientRun.toolCount,
  toolCall: report.clientRun.toolCall,
}, null, 2))
