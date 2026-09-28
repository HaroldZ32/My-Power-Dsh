// A dependency-free stdio MCP client (JSON-RPC 2.0 over the child's stdio).
//
// MEASURED WIRE FRAMING — do not re-derive, re-measure only if a boot contradicts:
//   · framing      newline-delimited JSON, one message per line, `\n` terminated,
//                  a trailing `\r` tolerated. Both sides of the harness agree:
//                  H/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js:24-39
//                  (`readMessage` splits on `\n`; `serializeMessage` = `JSON.stringify(message) + "\n"`)
//                  and the repo's own server, packages/mpd-mcp-lsp/dist/cli.js:85-105
//                  (`readNextMessage` falls back to line framing unless the buffer
//                  starts with `Content-Length:`), which is the same
//                  `packages/mcp-stdio-core` transport this bundle ships.
//   · transport    child stdio pipes; stderr is NOT protocol data (read separately
//                  for diagnostics) — H/…/sdk/dist/esm/client/stdio.js:65-105
//   · handshake    `initialize` {protocolVersion, capabilities, clientInfo} -> result,
//                  then the `notifications/initialized` notification (no id, no reply),
//                  then `tools/list` (cursor-paginated), then `tools/call`
//                  — H/…/sdk/dist/esm/client/index.js:283-306 and
//                  H/dsh-mcp-client/lib/index.js:88-105 (uncached request shapes)
//   · version      MEASURED 2026-09-15 against packages/mpd-mcp-lsp/dist/cli.js:
//                  requesting "2025-11-25" (the SDK's LATEST_PROTOCOL_VERSION,
//                  H/…/sdk/dist/esm/types.js:2) is echoed back verbatim with
//                  capabilities.tools.listChanged=false and serverInfo lsp/0.1.0;
//                  the server defaults to "2024-11-05" when the request omits it
//                  (packages/mpd-mcp-lsp/dist/cli.js:5199-5204) and supports the
//                  five SDK revisions (H/…/sdk/dist/esm/types.js:4).
//                  Evidence: evidence/extensions/mcp-bridge-framing/<timestamp>/{result.json,output.log,probe.ts}
//
// Env policy: only the SDK's measured safe inherit list crosses into the child
// (H/…/sdk/dist/esm/client/stdio.js:6-42 — "list inspired by the default env
// inheritance of sudo"), so a credential-shaped variable from the parent (the
// harness's own provider keys, for example) is never inherited. An extension MAY
// declare `env` explicitly: that is authored, visible configuration, not
// inheritance.
//
// The client never throws out of a notification, never leaves a rejected promise
// unobserved, and always reaps its child on close.
import { createHash } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"

/** DeepSeek function-name contract: at most 64 characters (wire-protocol constant). */
export const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** The revision this client asks for (the SDK's LATEST_PROTOCOL_VERSION). */
export const MCP_PROTOCOL_VERSION = "2025-11-25"

/** Revisions this client accepts from a server (H/…/sdk/dist/esm/types.js:4). */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
]

/** Stderr kept per child, as a ring buffer of the tail. */
const STDERR_TAIL_CHARS = 2000

/**
 * Environment variables inherited from the parent, verbatim from the MCP SDK's
 * `DEFAULT_INHERITED_ENV_VARS` (H/…/sdk/dist/esm/client/stdio.js:6-25). Nothing
 * else crosses into a child unless the extension declares it.
 */
export const INHERITED_ENV_VARS: readonly string[] =
  process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
        "PROGRAMFILES",
      ]
    : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]

/**
 * Credential-shaped env names (the frozen contract's `*_TOKEN`, `*_KEY`,
 * `*_SECRET`, `*PASSWORD*`, `*_CREDENTIAL*`). Word boundaries keep a name such
 * as `MONKEY` or `KEYSIGHT_ROOT` from matching by accident.
 */
const CREDENTIAL_SHAPED = /(^|_)(TOKEN|TOKENS|KEY|KEYS|APIKEY|SECRET|SECRETS|CREDENTIAL|CREDENTIALS|PASSWORD|PASSWORDS|PASSWD)(_|$)/i

/** Does this variable name look credential-shaped? */
export function isCredentialShapedEnvName(name: string): boolean {
  return CREDENTIAL_SHAPED.test(name) || /PASSWORD/i.test(name)
}

/**
 * The environment a child receives: the SDK's safe inherit list (minus anything
 * credential-shaped, as defense-in-depth) plus the extension's declared values.
 */
export function childEnv(
  declared: Record<string, string> = {},
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  // Accumulator for the child's environment; only string values survive the filters below.
  const env: Record<string, string> = {}
  for (const key of INHERITED_ENV_VARS) {
    // The parent's value for this name, or undefined when the parent does not set it.
    const value = parent[key]
    if (typeof value !== "string") continue
    if (isCredentialShapedEnvName(key)) continue
    env[key] = value
  }
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value === "string") env[key] = value
  }
  return env
}

/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Byte-for-byte the harness algorithm (`publicToolName`,
 * H/dsh-mcp-client/lib/index.js:120-126): the clean case is
 * `mcp__<serverName>__<rawName>` verbatim; any lossy transformation
 * (sanitization OR truncation) appends `_<12-hex sha256(serverName + NUL + rawName)>`
 * so two distinct MCP identities can never collapse into one public name.
 */
export function publicToolName(serverName: string, rawName: string): string {
  // The verbatim harness spelling, before any normalization; also the identity the hash keys on.
  const joined = `mcp__${serverName}__${rawName}`
  // The same spelling with every character outside [A-Za-z0-9_-] replaced by `_`.
  const normalized = joined.replace(INVALID_NAME_CHARS, "_")
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  // First 12 hex chars of sha256("<serverName>\0<rawName>") — the RAW identity, so the suffix is
  // stable under normalization and two different raw names can never end up with one public name.
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, HASH_LENGTH)
  // Lossy path: truncate to leave room for `_<hash>`, so the result is exactly 64 chars at most.
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** One stdio MCP server declaration, already validated and root-resolved. */
export interface McpStdioServerSpec {
  /** Wire name, `^[A-Za-z0-9_-]{1,32}$`; it namespaces every public name this server publishes. */
  serverName: string
  /** Executable to spawn, passed to `spawn` verbatim (PATH resolution is the OS's). */
  command: string
  /** Arguments passed verbatim; the descriptor's `args` already defaults to `[]`. */
  args: string[]
  /** Extension-declared environment merged OVER the safe inherit list (declared values win). */
  env: Record<string, string>
  /** Absolute working directory (the extension root when the descriptor said "."). */
  cwd?: string
}

/** One advertised tool, in wire shape (schemas stay foreign until projected). */
export interface McpToolInfo {
  /** Raw wire name as advertised in `tools/list`; never sent to a model (see `publicToolName`). */
  name: string
  /** Optional server text; the bridge substitutes its own description when this is absent or empty. */
  description?: string
  /** Foreign JSON Schema for the arguments, unvalidated here; the bridge projects it. */
  inputSchema?: unknown
  /** Foreign JSON Schema of the tool's `structuredContent`; the bridge drops it when unsupported. */
  outputSchema?: unknown
}

/** One call result, in wire shape. */
export interface McpCallResult {
  /** The server's content blocks; kept as `unknown` because their shape is the server's own. */
  content?: unknown
  /** Structured payload; the bridge forwards it only when the tool declared a supported outputSchema. */
  structuredContent?: unknown
  /** True when the server reports the CALL failed; the bridge turns it into a thrown error. */
  isError?: boolean
  [key: string]: unknown
}

/** A server-initiated notification. */
export interface McpNotificationMessage {
  /** JSON-RPC method, e.g. `notifications/tools/list_changed` — the only one the bridge reacts to. */
  method: string
  /** Notification parameters, unread in v1 and therefore not validated here. */
  params?: unknown
}

/** A malformed message or a violated protocol expectation. */
export class McpProtocolError extends Error {
  /** @param message - One-line diagnosis of the malformed message or unmet protocol expectation. */
  constructor(message: string) {
    super(message)
    this.name = "McpProtocolError"
  }
}

/** Observation hooks the owner supplies; neither is required and neither may throw. */
export interface McpStdioClientOptions {
  /** Servers' `notifications/*` messages, delivered on the read loop (list_changed drives re-sync). */
  onNotification?: (message: McpNotificationMessage) => void
  /** Called once when the child exits (cleanly or not). */
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
}

/** One in-flight JSON-RPC request, keyed in the client's pending map by its numeric id. */
interface PendingRequest {
  /** Settles the caller's promise with the response's raw `result`. */
  resolve: (value: any) => void
  /** Settles the caller's promise with the transport, timeout, abort or server error. */
  reject: (error: Error) => void
  /** The request's own timeout handle; every settlement path clears it. */
  timer: ReturnType<typeof setTimeout>
  /** Method name, used only in error text. */
  method: string
}

/** Grace period for the child's last stderr chunk to arrive before exit is recorded. */
const EXIT_FLUSH_MS = 25

/** Await `work`, but never longer than `ms`; the loser's timer is always cleared. */
async function raceWithTimer(work: Promise<void>, ms: number): Promise<{ timedOut: boolean }> {
  // Handle of the losing arm, so it can be cleared once either arm has settled.
  let timer: ReturnType<typeof setTimeout> | undefined
  // The timer arm: resolves with `timedOut: true` if `work` has not settled within `ms`.
  const timeout = new Promise<{ timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms)
  })
  // Whichever arm won; `work` resolves `false`, the timer resolves `true`.
  const done = await Promise.race([work.then(() => ({ timedOut: false })), timeout])
  if (timer !== undefined) clearTimeout(timer)
  return done
}

/**
 * One child process speaking JSON-RPC 2.0 over stdio.
 *
 * Lifecycle: {@link start} (spawn + initialize + initialized notification) →
 * {@link listTools} / {@link callTool} → {@link close} (always reaps the child).
 * A request that exceeds its timeout rejects; the child is left alone so the
 * caller can decide between resync and teardown.
 */
export class McpStdioClient {
  /** Wire name of the server this child serves; prefixed onto every diagnostic below. */
  readonly serverName: string
  /** The declaration this client will spawn (command, args, declared env, resolved cwd). */
  private readonly spec: McpStdioServerSpec
  /** Observation hooks; omitted fields mean the client is simply unobserved. */
  private readonly options: McpStdioClientOptions
  /** The spawned child, set by `start` and cleared by `close`; `undefined` = not started. */
  private child?: ChildProcess
  /** Residual stdout text with no `\n` yet — line framing is the only framing accepted here. */
  private buffer = ""
  /** Non-fatal framing failures in arrival order, returned by `protocolErrorList`. */
  private protocolErrors: string[] = []
  /** The last {@link STDERR_TAIL_CHARS} characters of stderr; diagnostics, never protocol data. */
  private stderrBuffer = ""
  /** In-flight requests by JSON-RPC id, so a response can settle the promise it belongs to. */
  private pending = new Map<number | string, PendingRequest>()
  /** Monotonic id source; ids are never reused within one client's lifetime. */
  private nextId = 1
  /** Whether the child is recorded as gone (its exit observed, or `close` completed). */
  private exited = false
  /** Resolved exactly once by `markExited`; `close` awaits it instead of polling the pid. */
  private exitWaiter?: Promise<void>
  /** The `resolve` half of {@link exitWaiter}, called by `markExited`. */
  private resolveExit?: () => void

  /** @param spec - The server declaration to drive; nothing is spawned until `start`.
   *  @param options - Optional observation hooks; see {@link McpStdioClientOptions}. */
  constructor(spec: McpStdioServerSpec, options: McpStdioClientOptions = {}) {
    this.serverName = spec.serverName
    this.spec = spec
    this.options = options
  }

  /** The child's pid while it is alive. */
  get pid(): number | undefined {
    return this.child?.pid
  }

  /** Is the child still running? */
  get alive(): boolean {
    return this.child !== undefined && !this.exited
  }

  /** The child's stderr tail (diagnostics only — never protocol data). */
  stderrTail(): string {
    return this.stderrBuffer.trim()
  }

  /** Non-fatal framing failures seen so far. */
  protocolErrorList(): string[] {
    return [...this.protocolErrors]
  }

  /**
   * Spawn the child and complete the MCP handshake within `timeoutMs`.
   * Rejects (never hangs) when the command cannot be spawned, exits early, or
   * does not answer `initialize` in time.
   * @param timeoutMs - Budget in MILLISECONDS for the handshake (spawn + `initialize` + notification).
   * @returns Resolves once `notifications/initialized` has been written; the child outlives the call.
   */
  async start(timeoutMs: number): Promise<void> {
    if (this.child !== undefined) throw new Error(`mcp-client(${this.serverName}): already started`)
    // Resolver pair for "the child is gone"; `close` awaits this instead of polling the pid.
    const exitWaiter = Promise.withResolvers<void>()
    this.exitWaiter = exitWaiter.promise
    this.resolveExit = () => exitWaiter.resolve()
    // The spawned child; `cwd`, the safe-list env and `shell: false` are the containment options.
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: childEnv(this.spec.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: process.platform === "win32",
    })
    this.child = child
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => this.consume(chunk))
    child.stderr?.on("data", (chunk: string) => {
      this.stderrBuffer = (this.stderrBuffer + chunk).slice(-STDERR_TAIL_CHARS)
    })
    child.stdin?.on("error", () => { /* a dead child's stdin error is reported by the exit path */ })
    child.on("error", (error) => {
      this.failAll(new Error(`mcp-client(${this.serverName}): cannot start "${this.spec.command}": ${error.message}`))
      this.markExited(null, null)
    })
    child.on("exit", (code, signal) => {
      // Give the transport one turn to deliver the child's last stderr chunk, so
      // the recorded tail actually carries the reason the server died.
      setTimeout(() => this.markExited(code, signal), EXIT_FLUSH_MS)
    })

    // The `initialize` reply in wire shape; its protocolVersion is validated just below.
    const result = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mpd-ext-plugin", version: "0.9.0" },
      },
      timeoutMs,
    )
    // The version the server echoed back — the only field this handshake requires of it.
    const protocolVersion = (result as { protocolVersion?: unknown } | undefined)?.protocolVersion
    if (typeof protocolVersion !== "string") {
      throw new McpProtocolError(`mcp-client(${this.serverName}): initialize result carries no protocolVersion`)
    }
    if (!MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      throw new McpProtocolError(
        `mcp-client(${this.serverName}): server protocol version "${protocolVersion}" is not supported (${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`,
      )
    }
    this.notify("notifications/initialized", undefined)
  }

  /** Drain `tools/list` pagination into one generation of advertised tools. */
  async listTools(timeoutMs: number): Promise<McpToolInfo[]> {
    // One generation of advertised tools, in the order the server listed them.
    const tools: McpToolInfo[] = []
    // Continuation cursors already consumed, so a repeated cursor is an error and not a loop.
    const seenCursors = new Set<string>()
    // Cursor for the NEXT page; `undefined` means "fetch the first page" and then "done".
    let cursor: string | undefined
    do {
      // The raw reply for this page: `{}` on the first request, `{ cursor }` on every later one.
      const result = await this.request("tools/list", cursor === undefined ? {} : { cursor }, timeoutMs)
      // The advertised entries; absent or non-array is a protocol error, never an empty list.
      const page = (result as { tools?: unknown } | undefined)?.tools
      if (!Array.isArray(page)) {
        throw new McpProtocolError(`mcp-client(${this.serverName}): tools/list returned no tools array`)
      }
      for (const entry of page) {
        if (typeof entry !== "object" || entry === null) continue
        // Entry narrowed to a record; nameless entries are skipped rather than published.
        const tool = entry as Record<string, unknown>
        if (typeof tool.name !== "string" || tool.name.length === 0) continue
        tools.push({
          name: tool.name,
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
          ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
          ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
        })
      }
      // The server's next-page cursor; absent, empty or non-string ends pagination.
      const next = (result as { nextCursor?: unknown } | undefined)?.nextCursor
      cursor = typeof next === "string" && next.length > 0 ? next : undefined
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new McpProtocolError(`mcp-client(${this.serverName}): server repeated a tools/list continuation cursor`)
        }
        seenCursors.add(cursor)
      }
    } while (cursor !== undefined)
    return tools
  }

  /** Call one tool by its RAW wire name (the public name is never sent). */
  async callTool(
    rawName: string,
    args: Record<string, unknown>,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<McpCallResult> {
    // The raw `tools/call` reply; `{}` covers a server that answered with no result at all.
    const result = await this.request("tools/call", { name: rawName, arguments: args }, options.timeoutMs, options.signal)
    if (result === undefined || result === null) return {}
    if (typeof result !== "object") throw new McpProtocolError(`mcp-client(${this.serverName}): tools/call returned a non-object result`)
    return result as McpCallResult
  }

  /** Send a notification (no id, no reply expected). */
  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })
  }

  /**
   * Reap the child: end stdin, SIGTERM, then SIGKILL after a grace period.
   * @param graceMs - Milliseconds to wait for SIGTERM before escalating to SIGKILL (default 2000).
   * @returns Resolves once the exit is observed or the escalation window elapsed; never rejects.
   */
  async close(graceMs: number = 2000): Promise<void> {
    // The child this call reaps; an unstarted client has nothing to reap and returns at once.
    const child = this.child
    if (child === undefined) return
    // Resolves when the exit is observed, so the wait below is event-driven and not a poll.
    const waiter = this.exitWaiter ?? Promise.resolve()
    this.failAll(new Error(`mcp-client(${this.serverName}): closed`))
    try {
      child.stdin?.end()
    } catch { /* the child may already be gone */ }
    if (!this.exited) {
      try {
        child.kill("SIGTERM")
      } catch { /* already reaped */ }
    }
    // Outcome of the SIGTERM grace period: `timedOut` means the SIGKILL escalation is next.
    const first = await raceWithTimer(waiter, graceMs)
    if (first.timedOut && !this.exited) {
      try {
        child.kill("SIGKILL")
      } catch { /* already reaped */ }
      // SIGKILL is unblockable, so 500 ms is a short confirmation window, not a second grace period.
      await raceWithTimer(waiter, 500)
    }
    this.exited = true
    this.child = undefined
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Record the child as gone EXACTLY once: fail every pending request, release `close`'s wait and
   * report the exit. Later calls are no-ops, so a spawn error plus a late `exit` cannot double-report.
   * @param code - The child's exit code, or null when it died from a signal.
   * @param signal - The terminating signal, or null on a normal exit.
   */
  private markExited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return
    this.exited = true
    this.failAll(new Error(`mcp-client(${this.serverName}): the server process exited (code=${String(code)}, signal=${String(signal)})`))
    this.resolveExit?.()
    try {
      this.options.onExit?.({ code, signal })
    } catch { /* an observer must never break teardown */ }
  }

  /**
   * Reject every in-flight request with one shared reason and forget it; used on exit and on close.
   * @param error - The reason every pending caller observes.
   */
  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  /**
   * Write one newline-terminated JSON-RPC message to the child's stdin.
   * @param message - The message object, serialized here (callers never pre-encode it).
   * @throws When the child is absent or its stdin is already destroyed; the caller owns containment.
   */
  private write(message: Record<string, unknown>): void {
    // The child's stdin pipe; missing or destroyed means there is no live process to write to.
    const stdin = this.child?.stdin
    if (stdin === undefined || stdin === null || stdin.destroyed) {
      throw new Error(`mcp-client(${this.serverName}): the server process is not writable`)
    }
    stdin.write(JSON.stringify(message) + "\n")
  }

  /**
   * Send one request and await its response, bounded by `timeoutMs`.
   * @param method - JSON-RPC method, also used in the timeout/abort error text.
   * @param params - Request parameters; `undefined` is serialized as an empty object.
   * @param timeoutMs - Budget in MILLISECONDS for THIS request; expiry rejects and forgets the id.
   * @param signal - Optional cancellation; aborting rejects and forgets the id the same way.
   * @returns The response's raw `result`, unvalidated (each caller narrows it itself).
   */
  private request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    if (!this.alive) {
      return Promise.reject(new Error(`mcp-client(${this.serverName}): the server process is not running`))
    }
    // JSON-RPC id for this call; unique per child, so a late reply cannot settle the wrong promise.
    const id = this.nextId++
    return new Promise<any>((resolve, reject) => {
      // Timeout handle; every settlement path clears it, so a settled request leaves no timer.
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`mcp-client(${this.serverName}): ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      // Abort listener; the `pending.delete` test makes a second settlement path impossible.
      const onAbort = (): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        reject(new Error(`mcp-client(${this.serverName}): ${method} aborted`))
      }
      if (signal !== undefined) {
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new Error(`mcp-client(${this.serverName}): ${method} aborted`))
          return
        }
        signal.addEventListener("abort", onAbort, { once: true })
      }
      this.pending.set(id, {
        method,
        timer,
        resolve: (value: unknown) => {
          if (signal !== undefined) signal.removeEventListener("abort", onAbort)
          resolve(value)
        },
        reject: (error: Error) => {
          if (signal !== undefined) signal.removeEventListener("abort", onAbort)
          reject(error)
        },
      })
      try {
        this.write({ jsonrpc: "2.0", id, method, params: params ?? {} })
      } catch (error) {
        // The write failed, so this id can never be answered: forget it before rejecting.
        const pending = this.pending.get(id)
        if (pending !== undefined) {
          this.pending.delete(id)
          clearTimeout(pending.timer)
        }
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Split the child's stdout into newline-delimited JSON-RPC messages.
   * @param chunk - One decoded stdout chunk; a partial trailing line stays buffered for the next one.
   */
  private consume(chunk: string): void {
    this.buffer += chunk
    while (true) {
      // Offset of the next message terminator, or -1 when only a partial line is buffered.
      const index = this.buffer.indexOf("\n")
      if (index === -1) break
      // One complete line with a trailing CR removed; blank/whitespace-only lines are dropped below.
      const line = this.buffer.slice(0, index).replace(/\r$/, "")
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim().length === 0) continue
      this.handleLine(line)
    }
  }

  /**
   * Route one complete stdout line: a response settles its pending request, a line carrying a
   * `method` is a notification, and every other shape is recorded as a framing failure.
   * @param line - One non-blank line, already stripped of its terminator.
   */
  private handleLine(line: string): void {
    // The parsed message, or a recorded non-JSON framing failure; parsing never throws out of here.
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.protocolErrors.push(`non-JSON line on stdout: ${line.slice(0, 200)}`)
      return
    }
    if (typeof message !== "object" || message === null) {
      this.protocolErrors.push(`non-object JSON-RPC message: ${line.slice(0, 200)}`)
      return
    }
    // The message narrowed to a record; every read below is a property probe on it.
    const record = message as Record<string, unknown>
    // The response id, when this line is a response rather than a notification.
    const id = record.id
    if (typeof id === "number" || typeof id === "string") {
      // The request this response answers; an unknown id is dropped (a timed-out or aborted call).
      const pending = this.pending.get(id)
      if (pending === undefined) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (record.error !== undefined) {
        // The server's error object, read only for a human-readable message.
        const detail = record.error as { message?: unknown; code?: unknown }
        pending.reject(
          new Error(
            `mcp-client(${this.serverName}): ${pending.method} failed: ${typeof detail?.message === "string" ? detail.message : JSON.stringify(record.error)}`,
          ),
        )
        return
      }
      pending.resolve(record.result)
      return
    }
    if (typeof record.method === "string") {
      try {
        this.options.onNotification?.({ method: record.method, params: record.params })
      } catch { /* a notification observer must never break the read loop */ }
    }
  }
}
