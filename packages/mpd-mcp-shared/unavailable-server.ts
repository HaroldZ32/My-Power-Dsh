// The UNAVAILABLE MCP SERVER: the shape a row keeps when its third-party server cannot be loaded.
//
// WHY THIS EXISTS: a declared dependency can legitimately be absent at runtime — an install that
// skipped optional dependencies, a pruned `node_modules`, a partially materialized profile. A launcher
// that throws there does not merely lose its capability: the MCP client row's child dies, and a dead
// child takes the whole boot down with it (measured on the codegraph row: the web app never served).
// The degrade shape is therefore "alive, answers the handshake, lists NO tools, exit 0", and the
// reason is written to the launcher's log sink where a session can read it.
//
// This is the SHARED form of the fallback `packages/mpd-mcp-codegraph/src/launch.ts` carries inline;
// the two are deliberately not merged, because that launcher's copy is proven in place and rewriting
// it would change a shipped artifact for no capability.
//
// The protocol loop is the narrowest one that survives a real client: `initialize` is answered with
// the client's own protocol version, `tools/list` with an empty list, any other request with -32601,
// and notifications are never answered. Nothing here writes to a terminal: diagnostics go through the
// caller's log sink and fd 1 carries the MCP protocol the row spawned this process with.
import type { LogSink } from "./log-sink.ts"

/** What the unavailable server reports: who it is, why it is unavailable, and how to fix it. */
export interface UnavailableServerOptions {
  /** The server name reported in `serverInfo` and used as the log prefix. */
  readonly name: string
  /** The load failure, already rendered to text by the caller. */
  readonly reason: string
  /** The actionable fix, one line; omitted when the caller has nothing better to say than `reason`. */
  readonly hint?: string
}

/** One inbound JSON-RPC frame, read only as far as this fallback needs. */
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

/** The protocol version answered when the client did not name one (the MCP client always does). */
const FALLBACK_PROTOCOL_VERSION: string = "2024-11-05"

/**
 * Stay alive as an MCP server with no tools, recording why, until the client closes stdin.
 *
 * The returned promise resolves when stdin ends — that is the row shutting down, not a failure — so a
 * caller sets exit code 0 after awaiting it.
 *
 * @param sink the launcher's terminal-silence sink, which is where the reason is recorded.
 * @param options the server identity and the failure being reported.
 * @returns a promise that resolves when the client closes the connection.
 */
export async function serveUnavailable(sink: LogSink, options: UnavailableServerOptions): Promise<void> {
  /** The log prefix every record of this fallback carries. */
  const prefix = "[" + options.name + "] unavailable fallback: "
  sink.write(prefix + options.reason)
  sink.write(
    prefix + "this row exposes NO tools until the dependency loads; fix the cause and restart the session" +
      (options.hint === undefined ? "" : " — " + options.hint)
  )
  process.stdin.setEncoding("utf8")
  /** Bytes read from stdin that do not yet contain a complete line. */
  let buffer = ""
  /** Write one frame to stdout, the only channel the MCP protocol owns. */
  const send = (message: JsonRpcReply): void => {
    process.stdout.write(JSON.stringify(message) + "\n")
  }
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
      try {
        request = JSON.parse(line) as JsonRpcRequest
      } catch {
        continue
      }
      if (request.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : FALLBACK_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: options.name, version: "unavailable" }
          }
        })
      } else if (request.method === "tools/list") {
        send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } })
      } else if (request.id !== undefined) {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: options.name + " is unavailable on this host" } })
      }
    }
  }
}

/**
 * Render a caught value as one log line, without ever throwing on a hostile value.
 *
 * @param error the caught value; usually an `Error`, but a rejection can carry anything.
 * @returns the message and stack when there is one, the stringified value otherwise.
 */
export function failureText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}
