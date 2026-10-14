// protocol.ts — the stdio transport this server speaks: newline-delimited JSON-RPC 2.0.
//
// ONE line in, at most ONE line out, in REQUEST ORDER: the loop holds a single in-flight request, so
// a tool call that spawns `sg` cannot interleave its output with the next request's. A notification
// (a line with no `id`) produces no line at all. The child is tied to its parent: when stdin ends, or
// the parent process disappears, any in-flight engine run is aborted and the server settles instead
// of lingering as an orphan that still holds an `sg` child.
import { createInterface } from "node:readline"
import { handleAstGrepMcpRequest, type AstGrepMcpOptions, type JsonRpcResponse } from "./server.ts"

/** How often the parent process is re-checked, in milliseconds. */
const PARENT_POLL_MS = 2_000

/** One input line, parsed or not: a non-JSON line still owes the client a -32700 response. */
type ParsedLine =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string }

/**
 * Parse one input line.
 * @param line - the raw line, without its newline
 * @returns the parsed value, or the parse failure's message for the -32700 `data` field
 */
function parseLine(line: string): ParsedLine {
  try {
    return { ok: true, value: JSON.parse(line) as unknown }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Build the response for a line that is not parseable JSON at all.
 * @param data - the parser's own message, which the client sees beside the code
 * @returns the JSON-RPC error response
 */
function parseErrorResponse(data: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error", data } }
}

/**
 * Serve the MCP protocol on this process's stdio until stdin ends.
 *
 * Requests are handled one at a time, in arrival order. Every request gets its own abort controller,
 * so the parent watchdog and the end of stdin can cancel exactly the engine run that is in flight.
 * @param options - seams forwarded to the request handler (tests resolve the engine themselves)
 * @returns a promise that settles once stdin is exhausted and the queue has drained
 */
export async function runStdioServer(options: AstGrepMcpOptions = {}): Promise<void> {
  /** The pid this server was started by; a change means the parent is gone. */
  const parentPid = process.ppid
  /** The request currently being handled, so it can be aborted. */
  let active: AbortController | null = null
  /** Whether the input stream has ended. */
  let closed = false
  /** Whether a drain loop is already running; a second one must never race it. */
  let draining = false
  /** Requests read but not handled yet, in arrival order. */
  const queue: string[] = []
  /** Resolves when the queue has drained and no request is in flight, so the caller can settle. */
  let idle: (() => void) | null = null

  /**
   * Write one response line to stdout, tolerating a closed pipe.
   * @param response - the response to write
   */
  const write = (response: JsonRpcResponse): void => {
    try {
      process.stdout.write(`${JSON.stringify(response)}\n`)
    } catch {
      // A closed stdout means the client is gone; the stdin close below is what ends this server.
    }
  }

  /**
   * Handle every queued line, then settle the loop when input has ended.
   *
   * SINGLE FLIGHT: the caller may invoke this on every line event, but only ONE loop ever runs, so
   * responses leave in REQUEST ORDER and a tool call that spawns `sg` cannot interleave with the
   * next request's answer.
   * @returns a promise that resolves once the queue is empty
   */
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0) {
        /** The next raw line. */
        const line = queue.shift() as string
        /** The parsed request, or the reason it could not be parsed. */
        const parsed = parseLine(line)
        if (!parsed.ok) {
          write(parseErrorResponse(parsed.message))
          continue
        }
        /** The controller of this request, aborted by the watchdog or by the end of stdin. */
        const controller = new AbortController()
        active = controller
        try {
          /** The response to write, or undefined for a notification. */
          const response = await handleAstGrepMcpRequest(parsed.value, { ...options, signal: controller.signal })
          if (response !== undefined) write(response)
        } catch (error) {
          write({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
        } finally {
          if (active === controller) active = null
        }
      }
    } finally {
      draining = false
    }
    if (closed && idle !== null) {
      /** The settle callback, cleared before it runs so it fires once. */
      const settle = idle
      idle = null
      settle()
    }
  }

  /** The line reader over stdin; `crlfDelay: Infinity` treats CRLF as one line break. */
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
  reader.on("line", (line: string) => {
    if (line.length === 0) return
    queue.push(line)
    void drain()
  })
  reader.on("close", () => {
    closed = true
    active?.abort(new Error("stdin closed"))
    void drain()
  })

  /** Poll the parent: on POSIX a dead parent reparents this process, which is the signal to stop. */
  const watchdog = setInterval(() => {
    if (process.ppid === parentPid) return
    closed = true
    reader.close()
    active?.abort(new Error("parent process exited"))
    void drain()
  }, PARENT_POLL_MS)
  watchdog.unref()

  await new Promise<void>((resolve) => {
    if (closed && queue.length === 0 && active === null) {
      resolve()
      return
    }
    idle = resolve
  })
  clearInterval(watchdog)
  reader.close()
}
