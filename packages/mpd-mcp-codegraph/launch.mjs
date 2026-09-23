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
import { resolveCodegraphBinary } from "../mpd-mcp-shared/bin-resolve.mjs"
import { applyDaemonPolicy } from "./daemon-policy.mjs"

if ((process.env.MPD_CODEGRAPH_BIN ?? "").trim().length === 0) {
  try {
    const resolved = resolveCodegraphBinary(import.meta.url)
    if (resolved) process.env.MPD_CODEGRAPH_BIN = resolved.binary
  } catch {
    // never throw: the adopted chain below owns the actionable error
  }
}

/** Path-looking sentinel: never a real binary, so the adopted resolver reports
 *  `exists: false` with `source: "env"` and the provisioning path is skipped. */
const UNAVAILABLE_SENTINEL = "/nonexistent/mpd-codegraph-unavailable"

// Shared-daemon policy (see daemon-policy.mjs for the measured defect this closes).
// It must run BEFORE `dist/serve.js` is imported: the bridge freezes the child env
// from this process's env at import/start time.
const daemon = applyDaemonPolicy(process.env, { log: (line) => process.stderr.write(line + "\n") })

function stderrText(error) {
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
 * @param {string} reason - the load failure, already rendered
 */
async function serveUnavailable(reason) {
  process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback: ${reason}\n`)
  process.stderr.write("[mpd-mcp-codegraph] codegraph is unavailable on this host: dist/serve.js failed to load (the reason is above). This row exposes no tools; fix the cause and restart the session.\n")
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
function stdoutIsUntouched() {
  return (process.stdout.bytesWritten ?? 0) === 0
}

let serve = null
try {
  serve = await import("./dist/serve.js")
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
    try {
      process.exitCode = await serve.runCodegraphServe()
    } catch (retryError) {
      process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback failed: ${stderrText(retryError)}\n`)
      process.exitCode = 1
    }
  }
}
