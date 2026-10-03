#!/usr/bin/env node
// mpd codegraph MCP launcher (wave-2 B8; degradation added by wave-3 F-B8-1).
//
// The bundle patch no longer names a binary path: this launcher resolves the
// binary bundle-relatively (shared resolver, t1 §3.2 precedence) and hands it to
// the adopted server through the env key it already reads (MPD_CODEGRAPH_BIN),
// then starts the server.
//
// - a pin already present in process.env wins untouched;
// - resolution failure is NOT fatal: with the env untouched the adopted resolver
//   runs its own bundled -> provisioned -> PATH -> download chain;
// - `runCodegraphServe()` MUST be called here: serve.js self-starts only when it
//   is argv[1] (isDirectInvocation), which the launcher is, not serve.js;
// - never throw, and never write to stdout (it carries the MCP protocol).
//
// F-B8-1 (wave 3): with the binary unresolvable AND the state directory
// unwritable, the adopted chain throws an uncaught filesystem error instead of
// degrading: `ensureCodegraphProvisioned` calls `acquireLock(...)` BEFORE its
// own try/catch, and acquireLock starts with `mkdir(<home>/.mpd/codegraph/.locks)`
// -- on a read-only `$HOME/.mpd` that ENOENT/EACCES/EROFS escapes all the way out
// of `runCodegraphServe()`. The degradation therefore lives HERE, in our own
// launcher, and not as a delta inside `dist/serve.js`: serve.js is a sha-pinned
// prebuilt behind the blocking vendor gate (scripts/verify-vendor.mjs), so a
// marked delta there would either fail that gate or turn it into a
// self-attestation (decision record evidence/wave3/registry-redesign/t1-decision-record.txt §A4).
//
// The recovery is exact and cheap: re-run with MPD_CODEGRAPH_BIN pinned to a
// path-looking sentinel that does not exist. The adopted resolver then takes
// `source: "env"` (an env pin always wins) and `provisionMissingCodegraph`
// returns null at its FIRST guard (`source === "env"`), so the child stays alive
// as the unavailable MCP server (zero tools, the skip hint on stderr, exit 0)
// instead of dying. The retry runs only while NOTHING has been written to
// stdout: if the first attempt already emitted MCP bytes, a second attempt would
// corrupt the stream, so that case is reported and exits 1.
import { installTerminalSilence } from "../mpd-mcp-shared/log-sink.ts"
import { resolveCodegraphBinary } from "../mpd-mcp-shared/bin-resolve.ts"
import { applyDaemonPolicy } from "./daemon-policy.ts"

// R5 (lane F): the terminal writers are taken away BEFORE anything below can use them, and before the
// adopted server's dynamic import further down. Measured reason: the harness builds this row as
// `new StdioClientTransport({ command, args, env, cwd })` with NO `stderr` option, and the MCP SDK
// spawns the child with `stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"]` — so this
// process's fd 2 IS the dsh process's fd 2 (the TUI's alternate screen). Every `process.stderr.write`
// below, the adopted server's own `console.*`, and its module-init warnings now land in
// `<root>/.mpd/logs/mpd-mcp-codegraph.log`.
//
// DECLARED BOUND, measured on this host 2026-10-02: the adopted `dist/serve.js` bridge spawns the real
// codegraph CLI with a HARDCODED `stdio: ["pipe", "pipe", "inherit"]`, so THAT grandchild's stderr goes
// to the inherited fd 2 and bypasses this replacement. It is inside a sha-pinned prebuilt behind the
// blocking vendor gate, so the delta is deliberately not taken here; the two open remedies are named in
// `packages/mpd-mcp-codegraph/README.md` (harness-side `stderr: "pipe"` on the row, or an fd-level
// wrapper).
installTerminalSilence("mpd-mcp-codegraph")

/** The narrow surface this launcher uses from the adopted server module. */
interface ServeModule {
  /** Run the stdio MCP server for this process; resolves with the exit code to set. */
  runCodegraphServe: () => Promise<number>
}

/** One inbound JSON-RPC frame, read only as far as the unavailable-server fallback needs. */
interface JsonRpcRequest {
  /** The request id to echo back; absent on a notification, which gets no reply. */
  id?: unknown
  /** The method name; anything but `initialize`/`tools/list` is answered with -32601. */
  method?: string
  /** The initialize parameters, whose `protocolVersion` is echoed back when the client sent one. */
  params?: { protocolVersion?: unknown }
}

/** One outbound JSON-RPC frame. */
interface JsonRpcReply {
  /** Always the literal protocol version marker. */
  jsonrpc: "2.0"
  /** The id of the request being answered. */
  id: unknown
  /** The success payload, present when the request was understood. */
  result?: unknown
  /** The error payload, present instead of `result` for an unsupported method. */
  error?: { code: number; message: string }
}

if ((process.env.MPD_CODEGRAPH_BIN ?? "").trim().length === 0) {
  try {
    /** The bundle-relative binary, or null when no candidate passed the resolver's tiers. */
    const resolved = resolveCodegraphBinary(import.meta.url)
    if (resolved) process.env.MPD_CODEGRAPH_BIN = resolved.binary
  } catch {
    // never throw: the adopted chain below owns the actionable error
  }
}

/** Path-looking sentinel: never a real binary, so the adopted resolver reports
 *  `exists: false` with `source: "env"` and the provisioning path is skipped. */
const UNAVAILABLE_SENTINEL = "/nonexistent/mpd-codegraph-unavailable"

// Shared-daemon policy (see daemon-policy.ts for the measured defect this closes).
// It must run BEFORE `dist/serve.js` is imported: the bridge freezes the child env
// from this process's env at import/start time.
/** The applied policy, kept for its printed notice and for evidence of what was decided. */
const daemon = applyDaemonPolicy(process.env, { log: (line) => process.stderr.write(line + "\n") })

/** Render a caught value as the single-line diagnostic this launcher prints. */
function stderrText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

/**
 * The UNAVAILABLE MCP SERVER, for the case where `dist/serve.js` cannot even be LOADED.
 *
 * A delta inside `dist/serve.js` is forbidden (that file is a sha-pinned prebuilt behind the
 * blocking vendor gate - see packages/mpd-mcp-codegraph/README.md), so a host-shaped load failure
 * is handled HERE, in our own launcher. Measured 2026-09-22: the artifact evaluates
 * `var ACCOUNT_HOME_DIR = userInfo().homedir` at MODULE LOAD, and on a host where libuv's
 * `uv_os_get_passwd` fails that throws `SystemError: ... ENOMEM` - the child died before answering
 * a single frame and took the whole bundle's boot down with it (the web app never served).
 *
 * The row has ONE documented degrade shape (README: "zero tools, the skip hint on stderr, exit 0")
 * and a row that dies is not it: this keeps the process ALIVE as an MCP server that answers the
 * handshake and lists no tools, so the session boots and the reason is readable on stderr.
 * @param reason - the load failure, already rendered
 */
async function serveUnavailable(reason: string): Promise<void> {
  process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback: ${reason}\n`)
  process.stderr.write("[mpd-mcp-codegraph] codegraph is unavailable on this host: dist/serve.js failed to load (the reason is above). This row exposes no tools; fix the cause and restart the session.\n")
  process.stdin.setEncoding("utf8")
  /** Bytes read from stdin that do not yet contain a complete line. */
  let buffer = ""
  /** Write one frame to stdout (the only channel the MCP protocol owns); returns whether it flushed. */
  const send = (message: JsonRpcReply): boolean => process.stdout.write(JSON.stringify(message) + "\n")
  // `setEncoding("utf8")` above is what makes the chunks strings; the cast is type-level only.
  for await (const chunk of process.stdin as AsyncIterable<string>) {
    buffer += chunk
    /** The next newline in the buffer, or -1 while the current frame is still incomplete. */
    let index: number
    while ((index = buffer.indexOf("\n")) !== -1) {
      /** One complete line: a JSON-RPC frame, or a blank keep-alive line. */
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line.trim() === "") continue
      /** The parsed frame; an unparsable line is skipped, never answered. */
      let request: JsonRpcRequest
      try { request = JSON.parse(line) as JsonRpcRequest } catch { continue }
      if (request.method === "initialize") {
        send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codegraph", version: "unavailable" } } })
      } else if (request.method === "tools/list") {
        send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } })
      } else if (request.id !== undefined) {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "codegraph is unavailable on this host" } })
      }
    }
  }
}

/** The MCP protocol owns stdout: a retry is safe only while it is still empty. */
function stdoutIsUntouched(): boolean {
  return (process.stdout.bytesWritten ?? 0) === 0
}

/** The loaded server module, or null when the import itself failed (the fallback above ran). */
let serve: ServeModule | null = null
try {
  // `dist/serve.js` is a sha-pinned prebuilt with no declaration file, so a literal specifier
  // makes TypeScript resolve it and fail with TS7016; widening the specifier to `string` keeps
  // the runtime specifier untouched and leaves the module's shape to the cast below.
  serve = (await import("./dist/serve.js" as string)) as ServeModule
} catch (error) {
  // The documented degrade (zero tools, alive, exit 0): see serveUnavailable above.
  await serveUnavailable(stderrText(error))
  process.exitCode = 0
}

try {
  if (serve !== null) process.exitCode = await serve.runCodegraphServe()
} catch (error) {
  process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback: ${stderrText(error)}\n`)
  if (!stdoutIsUntouched()) {
    process.stderr.write("[mpd-mcp-codegraph] the MCP stream was already open; not retrying\n")
    process.exitCode = 1
  } else {
    process.env.MPD_CODEGRAPH_BIN = UNAVAILABLE_SENTINEL
    // `serve` cannot be null here: a null module skips the body of the `try` above, so the call
    // that failed — and therefore this handler — was made by a module that did load.
    try {
      process.exitCode = await serve!.runCodegraphServe()
    } catch (retryError) {
      process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback failed: ${stderrText(retryError)}\n`)
      process.exitCode = 1
    }
  }
}
