// The runtime stdio MCP bridge: the `mcp` contribution kind of the frozen
// extension-interface contract (plan §1.4 mcp).
//
// CONNECT-AT-APPLY, NOT LAZY. A lazy connect cannot register `mcp__…` tool names,
// because the raw names only exist after `tools/list`. The corrected design
// copies the harness's own posture (H/dsh-mcp-client/lib/index.js:762-789):
//   · declared servers connect IN PARALLEL, time-boxed by `connectTimeoutMs`;
//   · each server's first tool generation is published BEFORE activation
//     completes (this module's promise resolves only once every server settled);
//   · a startup failure is contained and non-fatal — the server is recorded
//     `unavailable`/`failed` with its stderr tail and every other extension and
//     server still activates;
//   · a later tool-list change is a two-phase fetch/swap with FULL rollback: the
//     new generation is built first, the old one is disposed only at swap time,
//     and a mid-list conflict disposes the partial generation so ZERO tools from
//     that server survive (a half-mounted server is a defect, not a degraded state).
//
// Every failure is recorded on the owning extension (`mpd_ext_show` reads the
// records live) and nothing here throws out of activation.
import type { DshAdapter, DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { resolve } from "node:path"
import {
  effectiveEnabled,
  type ExtensionConfig,
  type ExtensionEntry,
  type McpServerRecord,
  type NormalizedMcpItem,
} from "./registry"
import { MPD_EXT_CONTRACT } from "./sdk"
import { McpStdioClient, publicToolName, type McpToolInfo } from "./mcp-client"
import { objectRootedSchema, projectSchema, schemaViolations } from "./schema-sanitize"

/** The exact state vocabulary of `mpd_ext_show` (frozen contract §1.5 tool 2). */
export type McpServerState = "connecting" | "connected" | "unavailable" | "failed" | "disabled"

/** One server as the bridge sees it, for diagnostics and tests. */
export interface McpServerView {
  extension: string
  serverName: string
  state: McpServerState
  tools: string[]
  stderrTail?: string
  reason?: string
}

export interface McpBridgeOptions {
  dsh: DshAdapter
  /** The extensions the registry actually KEPT (a shadowed entry is never connected). */
  entries: ExtensionEntry[]
  /** Read lazily, per use (never an apply-time mpdConfig snapshot). */
  config: () => ExtensionConfig
  warn: (line: string) => void
}

export interface McpBridge {
  /** Every declared server with its exact live state. */
  view(): McpServerView[]
  /** Re-fetch one server's tool list and swap it in (two-phase, full rollback). */
  resync(serverName: string): Promise<void>
  /**
   * Connect the servers of an extension registered by a plugin row AFTER this
   * bridge activated (the code plane). Fire-and-forget by design: the caller's
   * `register()` is synchronous, and every failure is still recorded on the
   * extension rather than thrown.
   */
  adopt(entry: ExtensionEntry): Promise<void>
  /** Unregister every MCP tool and reap every child. */
  dispose(): Promise<void>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Raised when a generation was rolled back after a partial registration. */
class ToolGenerationConflict extends Error {
  constructor(text: string) {
    super(text)
    this.name = "ToolGenerationConflict"
  }
}

function pendingItem(index: number): string {
  return `contributes.mcp[${index}]`
}

/** Replace the build-time "not connected yet" placeholder with a live line. */
function setPending(entry: ExtensionEntry, index: number, reason: string | undefined): void {
  const item = pendingItem(index)
  entry.pending = entry.pending.filter((line) => line.item !== item)
  if (reason !== undefined) entry.pending.push({ item, reason })
}

function addError(entry: ExtensionEntry, item: string, reason: string): void {
  if (entry.errors.some((line) => line.item === item && line.reason === reason)) return
  entry.errors.push({ item, reason })
}

/**
 * Timeout resolution. The descriptor's declared value wins; the contract default
 * (i.e. "the author stated nothing") is replaced by the `extensions.mcp.*` layer,
 * which is the documented process-level knob (C5: readable per use, never a
 * session-scoped claim).
 */
function resolveTimeouts(item: NormalizedMcpItem, config: ExtensionConfig): { connect: number; call: number } {
  const connect =
    item.connectTimeoutMs === MPD_EXT_CONTRACT.defaultConnectTimeoutMs ? config.mcp.connectTimeoutMs : item.connectTimeoutMs
  const call =
    item.toolCallTimeoutMs === MPD_EXT_CONTRACT.defaultToolCallTimeoutMs ? config.mcp.toolCallTimeoutMs : item.toolCallTimeoutMs
  return { connect, call }
}

/** Text projection of an MCP tool result for the harness render path. */
function renderResult(value: unknown): string {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const content = Array.isArray(record.content) ? (record.content as unknown[]) : []
  const texts = content
    .filter((block): block is { type: string; text: string } =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
  if (texts.length > 0) return texts.join("\n")
  const structured = record.structuredContent
  if (structured !== undefined) return JSON.stringify(structured, null, 2)
  return content.length > 0 ? JSON.stringify(content) : "(no output)"
}

/** One declared server: its child, its live tool generation and its records. */
class ServerRuntime {
  readonly extension: string
  readonly serverName: string
  private readonly entry: ExtensionEntry
  private readonly index: number
  private readonly item: NormalizedMcpItem
  private readonly dsh: DshAdapter
  private readonly warn: (line: string) => void
  private readonly timeouts: { connect: number; call: number }
  /**
   * The child's working directory: the descriptor's `cwd` resolved against the
   * EXTENSION ROOT (never against the dsh process cwd). Asset references are
   * extension-root-relative by contract, so `command: "node", args:
   * ["server.mjs"], cwd: "."` finds the extension's own server.
   */
  private readonly cwd: string
  private client?: McpStdioClient
  /** publicName -> unregister disposer, for the CURRENT generation only. */
  private disposers = new Map<string, () => void>()
  private state: McpServerState = "connecting"
  private reason?: string
  private chain: Promise<void> = Promise.resolve()

  constructor(options: {
    entry: ExtensionEntry
    index: number
    item: NormalizedMcpItem
    dsh: DshAdapter
    config: ExtensionConfig
    warn: (line: string) => void
    disabled?: boolean
  }) {
    this.entry = options.entry
    this.extension = options.entry.id
    this.serverName = options.item.serverName
    this.index = options.index
    this.item = options.item
    this.dsh = options.dsh
    this.warn = options.warn
    this.timeouts = resolveTimeouts(options.item, options.config)
    this.cwd = options.entry.root === "" ? process.cwd() : resolve(options.entry.root, options.item.cwd === "" ? "." : options.item.cwd)
    if (options.disabled === true) this.state = "disabled"
    this.record()
  }

  view(): McpServerView {
    const tools = [...this.disposers.keys()]
    const stderrTail = this.client?.stderrTail()
    return {
      extension: this.extension,
      serverName: this.serverName,
      state: this.state,
      tools,
      ...(stderrTail !== undefined && stderrTail.length > 0 ? { stderrTail } : {}),
      ...(this.reason === undefined ? {} : { reason: this.reason }),
    }
  }

  /** Write the live record the tools read (`mpd_ext_show`). */
  private record(): void {
    const view = this.view()
    const record: McpServerRecord = {
      serverName: this.serverName,
      state: this.state,
      tools: view.tools,
      ...(view.stderrTail === undefined ? {} : { stderrTail: view.stderrTail }),
    }
    this.entry.mcp[this.index] = record
    const label = `server "${this.serverName}"`
    if (this.state === "connected") setPending(this.entry, this.index, undefined)
    else if (this.state === "connecting") {
      setPending(
        this.entry,
        this.index,
        `pending: ${label} is connecting (connectTimeoutMs=${this.timeouts.connect}, toolCallTimeoutMs=${this.timeouts.call})`,
      )
    } else if (this.state === "disabled") {
      setPending(this.entry, this.index, `disabled: extensions.mcp.enabled=false — ${label} is not connected`)
    } else {
      setPending(
        this.entry,
        this.index,
        `pending: ${label} is not connected (${this.state}) — connectTimeoutMs=${this.timeouts.connect}, toolCallTimeoutMs=${this.timeouts.call}`,
      )
    }
  }

  private fail(state: "unavailable" | "failed", error: unknown): void {
    this.state = state
    this.reason = message(error)
    const tail = this.client?.stderrTail() ?? ""
    addError(
      this.entry,
      pendingItem(this.index),
      `server "${this.serverName}" ${state}: ${this.reason}${tail.length > 0 ? `; child stderr tail: ${tail}` : ""}`,
    )
    this.warn(`extension "${this.extension}" mcp server "${this.serverName}" ${state}: ${this.reason}`)
    this.record()
  }

  /** Spawn + handshake + first tool generation, all inside `connectTimeoutMs`. */
  async activate(): Promise<void> {
    if (this.state === "disabled") return
    const client = new McpStdioClient(
      {
        serverName: this.serverName,
        command: this.item.command,
        args: [...this.item.args],
        env: { ...this.item.env },
        cwd: this.cwd,
      },
      {
        onNotification: (notification) => {
          // The ONE server-initiated notification v1 reacts to: the tool list
          // changed, so a re-sync is due (contained, single-flight).
          if (notification.method !== "notifications/tools/list_changed") return
          void this.resync()
        },
        onExit: (info) => {
          if (this.state !== "connected") return
          this.fail("failed", new Error(`the server process exited (code=${String(info.code)}, signal=${String(info.signal)})`))
        },
      },
    )
    this.client = client
    try {
      await client.start(this.timeouts.connect)
      await this.syncTools(this.timeouts.connect)
      this.state = "connected"
      this.reason = undefined
      this.record()
    } catch (error) {
      await client.close().catch(() => { /* containment: teardown must never throw out of activation */ })
      this.fail(error instanceof ToolGenerationConflict ? "failed" : "unavailable", error)
    }
  }

  /** Two-phase sync: build the whole next generation, then swap it in. */
  private async syncTools(timeoutMs: number): Promise<void> {
    const client = this.client
    if (client === undefined) throw new Error("the server is not started")
    const advertised = await client.listTools(timeoutMs)
    const next = new Map<string, DshToolDef>()
    const skipped: string[] = []
    const notes: string[] = []
    for (const tool of advertised) {
      const built = this.buildDefinition(client, tool, skipped, notes)
      if (built === undefined) continue
      if (next.has(built.name)) {
        throw new Error(`server "${this.serverName}" listed tool "${tool.name}" more than once — invalid tool list`)
      }
      // A foreign registration squats on this public name: skip THIS tool and
      // record it (`mpd_ext_show`), never throw (a throw would drop the tree).
      const ownedByThisGeneration = this.disposers.has(built.name)
      if (!ownedByThisGeneration && this.dsh.hasTool(built.name)) {
        skipped.push(`tool "${tool.name}" skipped: the public name "${built.name}" is already registered by another tool`)
        continue
      }
      next.set(built.name, built)
    }

    // ── swap ────────────────────────────────────────────────────────────────
    for (const dispose of this.disposers.values()) dispose()
    this.disposers = new Map()
    try {
      for (const [publicName, definition] of next) {
        this.disposers.set(publicName, this.dsh.registerTool(definition))
      }
    } catch (error) {
      // FULL rollback: zero tools from this server survive a mid-list conflict.
      for (const dispose of this.disposers.values()) dispose()
      this.disposers = new Map()
      throw new ToolGenerationConflict(
        `tool registration failed, no tools registered from "${this.serverName}": ${message(error)}`,
      )
    }
    for (const line of skipped) addError(this.entry, pendingItem(this.index), line)
    for (const line of notes) addError(this.entry, pendingItem(this.index), line)
    this.warn(
      `extension "${this.extension}" mcp server "${this.serverName}": ${this.disposers.size} tool(s) published`
        + (skipped.length > 0 ? `, ${skipped.length} skipped` : "")
        + (notes.length > 0 ? `, ${notes.length} downgraded` : ""),
    )
    this.record()
  }

  /** Build one harness tool definition, or record a per-tool skip. */
  private buildDefinition(client: McpStdioClient, tool: McpToolInfo, skipped: string[], notes: string[]): DshToolDef | undefined {
    const publicName = publicToolName(this.serverName, tool.name)

    // parameters — PROJECTED onto the subset (defense-in-depth: this harness
    // release never validates `parameters`, its own bridge passes `inputSchema`
    // straight through). An unprojectable schema skips that tool loudly; a
    // projectable one whose ROOT is not `object` is normalized onto an object root
    // (the tool-argument contract), recorded as a note.
    let parameters: Record<string, unknown> = {}
    if (tool.inputSchema !== undefined) {
      const projection = projectSchema(tool.inputSchema)
      if (projection.schema === undefined) {
        skipped.push(
          `tool "${tool.name}" skipped: its inputSchema cannot be projected onto the harness subset (${projection.violations.join("; ")})`,
        )
        return undefined
      }
      const rooted = objectRootedSchema(projection.schema)
      if (!rooted.ok) {
        skipped.push(`tool "${tool.name}" skipped: its inputSchema has no object root and cannot be normalized (${rooted.reason})`)
        return undefined
      }
      const rootedViolations = schemaViolations(rooted.schema)
      if (rootedViolations.length > 0) {
        skipped.push(
          `tool "${tool.name}" skipped: normalizing its inputSchema root produced a schema outside the harness subset (${rootedViolations.join("; ")})`,
        )
        return undefined
      }
      if (rooted.wrapped) {
        notes.push(
          `tool "${tool.name}": the server advertises a non-object inputSchema root ("${rooted.rootType}"); every harness tool call carries an ARGUMENTS OBJECT,`
            + ` so the payload is projected under the single property "value" — the server should declare an object root`,
        )
      }
      parameters = rooted.schema
    }

    // output.schema — KEEP-OR-DROP on the SCHEMA, never on the tool (this is the
    // harness's own posture: `supportedOutputSchema` drops a foreign schema to `{}`
    // and keeps the tool, H/dsh-mcp-client/lib/index.js:186-196,231-244). A schema
    // is never rewritten: a rewritten one would no longer describe what the server
    // returns, so the honest downgrade is "no structuredContent, loud note".
    let structuredSchema: Record<string, unknown> | undefined
    if (tool.outputSchema !== undefined) {
      const projection = projectSchema(tool.outputSchema)
      if (projection.schema === undefined) {
        notes.push(
          `tool "${tool.name}": its outputSchema is outside the harness subset (${projection.violations.join("; ")})`
            + ` — the tool is registered WITHOUT structuredContent (the schema is dropped, never rewritten)`,
        )
      } else if (projection.lossy) {
        notes.push(
          `tool "${tool.name}": its outputSchema would have to be rewritten for the harness subset (${projection.notes.join("; ")})`
            + ` — the tool is registered WITHOUT structuredContent (the schema is dropped, never rewritten)`,
        )
      } else {
        structuredSchema = projection.schema
      }
    }

    const outputSchema: Record<string, unknown> = {
      type: "object",
      properties: {
        content: { type: "array", items: {} },
        ...(structuredSchema === undefined ? {} : { structuredContent: structuredSchema }),
      },
      required: structuredSchema === undefined ? ["content"] : ["content", "structuredContent"],
      additionalProperties: false,
    }
    const violations = schemaViolations(outputSchema)
    if (violations.length > 0) {
      skipped.push(`tool "${tool.name}" skipped: the bridge's own output schema is invalid (${violations.join("; ")})`)
      return undefined
    }

    return {
      name: publicName,
      description:
        typeof tool.description === "string" && tool.description.length > 0
          ? tool.description
          : `MCP tool "${tool.name}" from server "${this.serverName}" (extension "${this.extension}")`,
      parameters,
      output: {
        schema: outputSchema,
        render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: renderResult(value) }],
      },
      timeoutMs: this.timeouts.call,
      execute: async (args: unknown, exec: unknown) => {
        const callArgs = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}
        return await this.call(client, tool.name, callArgs, (exec ?? {}) as DshToolExec, structuredSchema !== undefined)
      },
    }
  }

  /** One `tools/call`, mapped to the harness result shape. */
  private async call(
    client: McpStdioClient,
    rawName: string,
    args: Record<string, unknown>,
    exec: DshToolExec,
    hasStructured: boolean,
  ): Promise<{ content: unknown[]; structuredContent?: unknown }> {
    if (!client.alive) {
      throw new Error(`mcp server "${this.serverName}" is not running (state=${this.state}${this.reason === undefined ? "" : `: ${this.reason}`})`)
    }
    let result: Awaited<ReturnType<McpStdioClient["callTool"]>>
    try {
      result = await client.callTool(rawName, args, { timeoutMs: this.timeouts.call, signal: exec.signal })
    } catch (error) {
      if (!client.alive && this.state === "connected") this.fail("failed", error)
      throw error
    }
    if (result.isError === true) {
      throw new Error(renderResult({ content: result.content, structuredContent: result.structuredContent }))
    }
    const content = Array.isArray(result.content) ? (result.content as unknown[]) : undefined
    const blocks: unknown[] = content ?? [{ type: "text", text: renderResult(result) }]
    // `output.schema` is `additionalProperties: false`: a structuredContent key is
    // only ever returned when the tool itself declared a supported outputSchema.
    return {
      content: blocks,
      ...(hasStructured && result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    }
  }

  /** Refetch and swap, single-flight; a fetch failure keeps the live generation. */
  resync(): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.client === undefined || !this.client.alive) return
      try {
        await this.syncTools(this.timeouts.connect)
        this.state = "connected"
        this.reason = undefined
        this.record()
      } catch (error) {
        if (error instanceof ToolGenerationConflict) {
          // The swap already rolled the partial generation back: zero tools from
          // this server survive, and the state says the generation is broken
          // instead of pretending a half-mounted server is connected.
          this.fail("failed", error)
          return
        }
        // A FETCH-side failure never touched the live generation: its tools keep
        // working, so this is recorded without downgrading the state.
        addError(this.entry, pendingItem(this.index), `server "${this.serverName}" tool re-sync failed: ${message(error)}`)
        this.warn(`extension "${this.extension}" mcp server "${this.serverName}" tool re-sync failed: ${message(error)}`)
      }
    })
    return this.chain
  }

  /** Unregister this server's tools, then reap its child. */
  async dispose(): Promise<void> {
    for (const dispose of this.disposers.values()) dispose()
    this.disposers = new Map()
    this.record()
    const client = this.client
    this.client = undefined
    if (client !== undefined) await client.close().catch(() => { /* teardown is best-effort */ })
  }
}

/**
 * Build the runtimes of one kept extension. A project-plane extension may not
 * contribute `mcp` at all (those items were rejected per item by the validator),
 * so only an entry whose CONTRIBUTION count covers the declared items connects.
 */
function runtimesForEntry(entry: ExtensionEntry, options: McpBridgeOptions, config: ExtensionConfig): ServerRuntime[] {
  const runtimes: ServerRuntime[] = []
  const items = entry.descriptor.contributes.mcp
  if (items.length === 0 || items.length !== entry.contributions.mcp) return runtimes
  for (const [index, item] of items.entries()) {
    if (entry.root === "") {
      entry.mcp[index] = { serverName: item.serverName, state: "unavailable", tools: [] }
      setPending(entry, index, `pending: an extension root is required to start server "${item.serverName}" (pass { root } to register())`)
      addError(entry, pendingItem(index), `server "${item.serverName}" was not started: the extension has no root`)
      continue
    }
    if (!effectiveEnabled(entry, config) || !config.mcp.enabled) {
      // A disabled server is still REPORTED (state `disabled`), it is simply
      // never spawned — mpd_ext_show says exactly which of the two reasons.
      runtimes.push(new ServerRuntime({ entry, index, item, dsh: options.dsh, config, warn: options.warn, disabled: true }))
      continue
    }
    runtimes.push(new ServerRuntime({ entry, index, item, dsh: options.dsh, config, warn: options.warn }))
  }
  return runtimes
}

/**
 * Connect every declared stdio server of every kept extension.
 *
 * Resolves — never rejects — only after every server settled, so the first tool
 * generation of each reachable server exists before the plugin finishes
 * activating. A `disabled` extension or `extensions.mcp.enabled=false` connects
 * nothing and says so.
 */
export async function connectExtensionMcpServers(options: McpBridgeOptions): Promise<McpBridge> {
  const config = options.config()
  const runtimes: ServerRuntime[] = options.entries.flatMap((entry) => runtimesForEntry(entry, options, config))

  await Promise.all(runtimes.map((runtime) => runtime.activate()))

  let disposed = false
  return {
    view: () => runtimes.map((runtime) => runtime.view()),
    resync: async (serverName: string) => {
      const runtime = runtimes.find((candidate) => candidate.serverName === serverName)
      if (runtime === undefined) throw new Error(`unknown mcp server "${serverName}"`)
      await runtime.resync()
    },
    adopt: async (entry: ExtensionEntry) => {
      if (disposed) return
      const adopted = runtimesForEntry(entry, options, options.config())
      runtimes.push(...adopted)
      await Promise.all(adopted.map((runtime) => runtime.activate()))
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      await Promise.all(runtimes.map((runtime) => runtime.dispose()))
    },
  }
}
