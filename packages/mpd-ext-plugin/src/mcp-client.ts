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
//                  Evidence: evidence/extensions/mcp-bridge-framing/<timestamp>/{result.json,output.log,probe.mjs}
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
  const env: Record<string, string> = {}
  for (const key of INHERITED_ENV_VARS) {
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
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, "_")
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/** One stdio MCP server declaration, already validated and root-resolved. */
export interface McpStdioServerSpec {
  serverName: string
  command: string
  args: string[]
  env: Record<string, string>
  /** Absolute working directory (the extension root when the descriptor said "."). */
  cwd?: string
}

/** One advertised tool, in wire shape (schemas stay foreign until projected). */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

/** One call result, in wire shape. */
export interface McpCallResult {
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
  [key: string]: unknown
}

/** A server-initiated notification. */
export interface McpNotificationMessage {
  method: string
  params?: unknown
}

/** A malformed message or a violated protocol expectation. */
export class McpProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpProtocolError"
  }
}

export interface McpStdioClientOptions {
  /** Diagnostics sink; must never throw. */
  onNotification?: (message: McpNotificationMessage) => void
  /** Called once when the child exits (cleanly or not). */
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

/** Grace period for the child's last stderr chunk to arrive before exit is recorded. */
const EXIT_FLUSH_MS = 25

/** Await `work`, but never longer than `ms`; the loser's timer is always cleared. */
async function raceWithTimer(work: Promise<void>, ms: number): Promise<{ timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms)
  })
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
  readonly serverName: string
  private readonly spec: McpStdioServerSpec
  private readonly options: McpStdioClientOptions
  private child?: ChildProcess
  private buffer = ""
  private protocolErrors: string[] = []
  private stderrBuffer = ""
  private pending = new Map<number | string, PendingRequest>()
  private nextId = 1
  private exited = false
  private exitWaiter?: Promise<void>
  private resolveExit?: () => void

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
   */
  async start(timeoutMs: number): Promise<void> {
    if (this.child !== undefined) throw new Error(`mcp-client(${this.serverName}): already started`)
    const exitWaiter = Promise.withResolvers<void>()
    this.exitWaiter = exitWaiter.promise
    this.resolveExit = () => exitWaiter.resolve()
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

    const result = await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mpd-ext-plugin", version: "0.9.0" },
      },
      timeoutMs,
    )
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
    const tools: McpToolInfo[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    do {
      const result = await this.request("tools/list", cursor === undefined ? {} : { cursor }, timeoutMs)
      const page = (result as { tools?: unknown } | undefined)?.tools
      if (!Array.isArray(page)) {
        throw new McpProtocolError(`mcp-client(${this.serverName}): tools/list returned no tools array`)
      }
      for (const entry of page) {
        if (typeof entry !== "object" || entry === null) continue
        const tool = entry as Record<string, unknown>
        if (typeof tool.name !== "string" || tool.name.length === 0) continue
        tools.push({
          name: tool.name,
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
          ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
          ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
        })
      }
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
    const result = await this.request("tools/call", { name: rawName, arguments: args }, options.timeoutMs, options.signal)
    if (result === undefined || result === null) return {}
    if (typeof result !== "object") throw new McpProtocolError(`mcp-client(${this.serverName}): tools/call returned a non-object result`)
    return result as McpCallResult
  }

  /** Send a notification (no id, no reply expected). */
  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })
  }

  /** Reap the child: end stdin, SIGTERM, then SIGKILL after a grace period. */
  async close(graceMs = 2000): Promise<void> {
    const child = this.child
    if (child === undefined) return
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
    const first = await raceWithTimer(waiter, graceMs)
    if (first.timedOut && !this.exited) {
      try {
        child.kill("SIGKILL")
      } catch { /* already reaped */ }
      await raceWithTimer(waiter, 500)
    }
    this.exited = true
    this.child = undefined
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private markExited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return
    this.exited = true
    this.failAll(new Error(`mcp-client(${this.serverName}): the server process exited (code=${String(code)}, signal=${String(signal)})`))
    this.resolveExit?.()
    try {
      this.options.onExit?.({ code, signal })
    } catch { /* an observer must never break teardown */ }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private write(message: Record<string, unknown>): void {
    const stdin = this.child?.stdin
    if (stdin === undefined || stdin === null || stdin.destroyed) {
      throw new Error(`mcp-client(${this.serverName}): the server process is not writable`)
    }
    stdin.write(JSON.stringify(message) + "\n")
  }

  private request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    if (!this.alive) {
      return Promise.reject(new Error(`mcp-client(${this.serverName}): the server process is not running`))
    }
    const id = this.nextId++
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`mcp-client(${this.serverName}): ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
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
        const pending = this.pending.get(id)
        if (pending !== undefined) {
          this.pending.delete(id)
          clearTimeout(pending.timer)
        }
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Split the child's stdout into newline-delimited JSON-RPC messages. */
  private consume(chunk: string): void {
    this.buffer += chunk
    while (true) {
      const index = this.buffer.indexOf("\n")
      if (index === -1) break
      const line = this.buffer.slice(0, index).replace(/\r$/, "")
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim().length === 0) continue
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
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
    const record = message as Record<string, unknown>
    const id = record.id
    if (typeof id === "number" || typeof id === "string") {
      const pending = this.pending.get(id)
      if (pending === undefined) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (record.error !== undefined) {
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
