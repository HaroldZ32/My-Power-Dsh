// The runtime stdio MCP bridge: the `mcp` contribution kind of the frozen
// extension-interface contract (plan §1.4 mcp).
//
// CONNECT-AT-APPLY, NOT LAZY. A lazy connect cannot register `mcp__…` tool names,
// because the raw names only exist after `tools/list`. The corrected design
// copies the harness's own posture (H/dsh-mcp-client/lib/index.ts:762-789):
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
import { errorMessage as message } from "../../mpd-dsh-adapter-plugin/src/index"
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
  /** Id of the extension that declared it and owns its `pending`/`errors` records. */
  extension: string
  /** Declared wire name; the namespace part of every public tool name of this server. */
  serverName: string
  /** Live state; `disabled` is decided at connect time and never changes afterwards. */
  state: McpServerState
  /** Public names of the CURRENT tool generation, in registration order. */
  tools: string[]
  /** Bounded tail of the child's stderr; present only while it is non-empty. */
  stderrTail?: string
  /** One-line failure reason; set for `unavailable`/`failed`, absent otherwise. */
  reason?: string
}

/** Everything the bridge needs to connect the servers of the entries it was handed. */
export interface McpBridgeOptions {
  /** Adapter every registration goes through (AGENTS.md §6: the one contact surface with the harness). */
  dsh: DshAdapter
  /** The extensions the registry actually KEPT (a shadowed entry is never connected). */
  entries: ExtensionEntry[]
  /** Read lazily, per use (never an apply-time mpdConfig snapshot). */
  config: () => ExtensionConfig
  /** Diagnostics sink; a throw here would escape activation, so it is required never to throw. */
  warn: (line: string) => void
}

/** The live bridge the plugin holds: read state, re-sync one server, adopt a later row, dispose all. */
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


/** Raised when a generation was rolled back after a partial registration. */
class ToolGenerationConflict extends Error {
  /** @param text - Diagnosis naming the server whose new tool generation was rolled back. */
  constructor(text: string) {
    super(text)
    this.name = "ToolGenerationConflict"
  }
}

/**
 * The item label every extension record uses for the index-th declared MCP server.
 * @param index - Position inside `contributes.mcp`, 0-based.
 * @returns `contributes.mcp[<index>]` — the exact string the tools print and group by.
 */
function pendingItem(index: number): string {
  return `contributes.mcp[${index}]`
}

/** Replace the build-time "not connected yet" placeholder with a live line. */
function setPending(entry: ExtensionEntry, index: number, reason: string | undefined): void {
  // The single item label this server's pending line is keyed on.
  const item = pendingItem(index)
  entry.pending = entry.pending.filter((line) => line.item !== item)
  if (reason !== undefined) entry.pending.push({ item, reason })
}

/**
 * Record one item-scoped error, deduplicated: an identical item+reason pair is never stored twice.
 * @param entry - The extension whose `errors` list receives the line.
 * @param item - Item label, the key every surface groups the report by.
 * @param reason - One-line reason, reported to the model verbatim.
 */
function addError(entry: ExtensionEntry, item: string, reason: string): void {
  if (entry.errors.some((line) => line.item === item && line.reason === reason)) return
  entry.errors.push({ item, reason })
}

/**
 * Timeout resolution. The descriptor's declared value wins; the contract default
 * (i.e. "the author stated nothing") is replaced by the `extensions.mcp.*` layer,
 * which is the documented process-level knob (C5: readable per use, never a
 * session-scoped claim).
 * @param item - One validated `mcp` item, already carrying the contract defaults.
 * @param config - Process-level `extensions.mcp` layer read for this connect.
 * @returns Both budgets in MILLISECONDS: `connect` for spawn+handshake+`tools/list`,
 *          `call` for one `tools/call`.
 */
function resolveTimeouts(item: NormalizedMcpItem, config: ExtensionConfig): { connect: number; call: number } {
  // Handshake and tool-list budget, in MILLISECONDS; the config layer wins ONLY when the author
  // left the contract default, so an explicitly declared 10000 is indistinguishable from silence.
  const connect =
    item.connectTimeoutMs === MPD_EXT_CONTRACT.defaultConnectTimeoutMs ? config.mcp.connectTimeoutMs : item.connectTimeoutMs
  // One `tools/call` budget, in MILLISECONDS, resolved by the same sentinel rule.
  const call =
    item.toolCallTimeoutMs === MPD_EXT_CONTRACT.defaultToolCallTimeoutMs ? config.mcp.toolCallTimeoutMs : item.toolCallTimeoutMs
  return { connect, call }
}

/**
 * Text projection of an MCP tool result for the harness render path.
 * @param value - The tool's return value in wire shape (never assumed to be an object).
 * @returns Joined text blocks when the server sent any, else the structured payload, else JSON of
 *          the content, else the literal `(no output)`.
 */
function renderResult(value: unknown): string {
  // The value as a record, or an empty one when the server returned a scalar or nothing.
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  // The content blocks, when the server sent an array; a non-array is treated as "no content".
  const content = Array.isArray(record.content) ? (record.content as unknown[]) : []
  // The text of every `{type:"text"}` block, in order; other block kinds are ignored here.
  const texts = content
    .filter((block): block is { type: string; text: string } =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
  if (texts.length > 0) return texts.join("\n")
  // The structured payload, preferred over raw JSON content when no text block was sent.
  const structured = record.structuredContent
  if (structured !== undefined) return JSON.stringify(structured, null, 2)
  return content.length > 0 ? JSON.stringify(content) : "(no output)"
}

/** One declared server: its child, its live tool generation and its records. */
class ServerRuntime {
  /** Id of the owning extension; every diagnostic this runtime emits names it. */
  readonly extension: string
  /** Declared wire name, mirrored from the item (also the public-name namespace). */
  readonly serverName: string
  /** The extension record this runtime writes `mcp[index]`, `pending` and `errors` into. */
  private readonly entry: ExtensionEntry
  /** Position inside `contributes.mcp`, i.e. the index of this runtime's record. */
  private readonly index: number
  /** The validated declaration: command, args, env and the declared timeout values. */
  private readonly item: NormalizedMcpItem
  /** Adapter for tool registration and `hasTool` probing (never the raw harness seam). */
  private readonly dsh: DshAdapter
  /** Diagnostics sink; must never throw. */
  private readonly warn: (line: string) => void
  /** Resolved budgets in MILLISECONDS: `connect` for handshake/list, `call` for one tool call. */
  private readonly timeouts: { connect: number; call: number }
  /**
   * The child's working directory: the descriptor's `cwd` resolved against the
   * EXTENSION ROOT (never against the dsh process cwd). Asset references are
   * extension-root-relative by contract, so `command: "node", args:
   * ["server.ts"], cwd: "."` finds the extension's own server.
   */
  private readonly cwd: string
  /** The child's client, from `activate` until `dispose`; `undefined` before and after. */
  private client?: McpStdioClient
  /** publicName -> unregister disposer, for the CURRENT generation only. */
  private disposers = new Map<string, () => void>()
  /** Live state; set to `disabled` by the constructor, `connecting` otherwise. */
  private state: McpServerState = "connecting"
  /** One-line reason for a non-connected state, cleared when the server connects. */
  private reason?: string
  /** Serializes re-syncs: every `resync()` appends its work to this chain. */
  private chain: Promise<void> = Promise.resolve()

  /**
   * Build one server runtime and write its FIRST record (state `connecting`, or `disabled` when the
   * caller already decided not to spawn it). Nothing is spawned here.
   * @param options - The entry, the item index, the item itself, the adapter, the resolved config,
   *                  the warning sink, and `disabled` when neither the extension nor the config
   *                  allows a connection.
   */
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

  /** Project this runtime's live state for `mpd_ext_show`, without mutating anything. */
  view(): McpServerView {
    // Public names of the current generation; the map's keys preserve the registration order.
    const tools = [...this.disposers.keys()]
    // The child's stderr tail, or undefined while no client has been built yet.
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
    // Built once so the record and the pending line below describe the same instant.
    const view = this.view()
    // The registry-shaped record; optional fields are omitted rather than set to undefined.
    const record: McpServerRecord = {
      serverName: this.serverName,
      state: this.state,
      tools: view.tools,
      ...(view.stderrTail === undefined ? {} : { stderrTail: view.stderrTail }),
    }
    this.entry.mcp[this.index] = record
    // Human label shared by the pending/disabled lines below.
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

  /**
   * Record a not-connected state: state + reason, one item-scoped error, one warning, live record.
   * @param state - `unavailable` when the server could not be reached or answered out of contract;
   *                `failed` when a new tool generation was rolled back.
   * @param error - The cause; only its message is recorded, never a stack.
   */
  private fail(state: "unavailable" | "failed", error: unknown): void {
    this.state = state
    this.reason = message(error)
    // The child's stderr tail, appended to the recorded reason so a crash cause is not lost.
    const tail = this.client?.stderrTail() ?? ""
    addError(
      this.entry,
      pendingItem(this.index),
      `server "${this.serverName}" ${state}: ${this.reason}${tail.length > 0 ? `; child stderr tail: ${tail}` : ""}`,
    )
    this.warn(`extension "${this.extension}" mcp server "${this.serverName}" ${state}: ${this.reason}`)
    this.record()
  }

  /**
   * State transition `connecting` → `connected`: spawn, handshake, then the first tool generation.
   * A `disabled` runtime returns without spawning and stays `disabled`. On failure the child is
   * closed and the runtime becomes `failed` (a rolled-back tool generation) or `unavailable` (spawn
   * error, early exit, protocol error, timeout); the reason is recorded either way. This method
   * never throws: every failure is contained on the owning extension. The connect budget is per
   * request, not for the whole call — the handshake and each `tools/list` page get their own.
   */
  async activate(): Promise<void> {
    if (this.state === "disabled") return
    // The child's client; built here, started and disposed by this runtime.
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
    // The client to list from; absent means the caller never started this runtime.
    const client = this.client
    if (client === undefined) throw new Error("the server is not started")
    // Everything advertised right now — the NEW generation, not yet live.
    const advertised = await client.listTools(timeoutMs)
    // Candidate definitions by public name; the whole generation is built before anything is swapped.
    const next = new Map<string, DshToolDef>()
    // Per-tool skip reasons, recorded on the extension once the swap has succeeded.
    const skipped: string[] = []
    // Per-tool downgrade notes (schema dropped, non-object root wrapped), recorded likewise.
    const notes: string[] = []
    for (const tool of advertised) {
      // This tool's definition, or undefined when the tool was skipped for its own reason.
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

  /**
   * Build one harness tool definition, or record a per-tool skip.
   * @param client - The child the definition's `execute` will call back into.
   * @param tool - One advertised tool, in wire shape.
   * @param skipped - Per-tool skip reasons, appended to (never read) by this helper.
   * @param notes - Per-tool downgrade notes, appended to (never read) by this helper.
   * @returns The definition to register, or undefined when this tool must be skipped (the reason
   *          has then been pushed onto `skipped`).
   */
  private buildDefinition(client: McpStdioClient, tool: McpToolInfo, skipped: string[], notes: string[]): DshToolDef | undefined {
    // The public name derived from the RAW name; what the model sees and what may be squatted on.
    const publicName = publicToolName(this.serverName, tool.name)

    // parameters — PROJECTED onto the subset (defense-in-depth: this harness
    // release never validates `parameters`, its own bridge passes `inputSchema`
    // straight through). An unprojectable schema skips that tool loudly; a
    // projectable one whose ROOT is not `object` is normalized onto an object root
    // (the tool-argument contract), recorded as a note.
    let parameters: Record<string, unknown> = {}
    if (tool.inputSchema !== undefined) {
      // The projection verdict: a schema, the violations that blocked it, and the applied rewrites.
      const projection = projectSchema(tool.inputSchema)
      if (projection.schema === undefined) {
        skipped.push(
          `tool "${tool.name}" skipped: its inputSchema cannot be projected onto the harness subset (${projection.violations.join("; ")})`,
        )
        return undefined
      }
      // The object-root verdict: `ok`, the normalized schema, and the root type it was wrapped from.
      const rooted = objectRootedSchema(projection.schema)
      if (!rooted.ok) {
        skipped.push(`tool "${tool.name}" skipped: its inputSchema has no object root and cannot be normalized (${rooted.reason})`)
        return undefined
      }
      // Violations INTRODUCED by normalizing the root, checked before the tool is accepted.
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
    // and keeps the tool, H/dsh-mcp-client/lib/index.ts:186-196,231-244). A schema
    // is never rewritten: a rewritten one would no longer describe what the server
    // returns, so the honest downgrade is "no structuredContent, loud note".
    let structuredSchema: Record<string, unknown> | undefined
    if (tool.outputSchema !== undefined) {
      // The output-schema projection: kept only when it needs neither a drop nor a rewrite.
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

    // The value contract the model is shown: `content` always, `structuredContent` only when a
    // supported outputSchema survived, which is why `required` is composed the same way.
    const outputSchema: Record<string, unknown> = {
      type: "object",
      properties: {
        content: { type: "array", items: {} },
        ...(structuredSchema === undefined ? {} : { structuredContent: structuredSchema }),
      },
      required: structuredSchema === undefined ? ["content"] : ["content", "structuredContent"],
      additionalProperties: false,
    }
    // The bridge's OWN schema is validated too: an invalid one skips the tool instead of
    // registering a definition the harness would reject.
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
        // Harness tool calls always carry an arguments object; anything else degrades to `{}`.
        const callArgs = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}
        return await this.call(client, tool.name, callArgs, (exec ?? {}) as DshToolExec, structuredSchema !== undefined)
      },
    }
  }

  /**
   * One `tools/call`, mapped to the harness result shape.
   * @param client - The child to call; must still be alive (a dead child is a loud error).
   * @param rawName - The server's own tool name (never the derived public name).
   * @param args - Arguments object exactly as the model supplied them.
   * @param exec - Harness execution context; only `signal` is used, to abort the call.
   * @param hasStructured - Whether this tool declared a supported outputSchema, i.e. whether a
   *                        `structuredContent` key may be returned at all.
   * @returns The harness value contract: `content` blocks, plus `structuredContent` when allowed.
   *          A tool-level `isError` is thrown instead, so the harness renders a failed call.
   */
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
    // The raw reply from `tools/call`, awaited through the client's own request timeout.
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
    // The server's own content array, or undefined when it sent none (empty arrays are kept).
    const content = Array.isArray(result.content) ? (result.content as unknown[]) : undefined
    // The blocks the harness renders: the server's, or one text block projected from the result.
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

  /**
   * Unregister this server's tools, then reap its child.
   *
   * No state transition happens here: `state` keeps its last value, so a server disposed while
   * connected still reports `connected` (with zero tools) until the child's exit arrives and the
   * `onExit` hook records `failed`.
   */
  async dispose(): Promise<void> {
    for (const dispose of this.disposers.values()) dispose()
    this.disposers = new Map()
    this.record()
    // Detach the client before reaping it, so a late callback cannot resurrect it here.
    const client = this.client
    this.client = undefined
    if (client !== undefined) await client.close().catch(() => { /* teardown is best-effort */ })
  }
}

/**
 * Build the runtimes of one kept extension. A project-plane extension may not
 * contribute `mcp` at all (those items were rejected per item by the validator),
 * so only an entry whose CONTRIBUTION count covers the declared items connects.
 * @param entry - One KEPT extension (a shadowed duplicate never reaches here).
 * @param options - Bridge options; the adapter and the warning sink are forwarded to each runtime.
 * @param config - The `extensions.*` layer read for this connect, which decides `disabled`.
 * @returns One runtime per declared item; an item that cannot be started is recorded on the entry
 *          instead (no root), and a count mismatch yields an EMPTY list — nothing is connected.
 */
function runtimesForEntry(entry: ExtensionEntry, options: McpBridgeOptions, config: ExtensionConfig): ServerRuntime[] {
  // Runtimes this call decided to spawn (disabled ones included — they are reported, not hidden).
  const runtimes: ServerRuntime[] = []
  // The declared items, in manifest order; the index in this array is the record index.
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
 * @param options - The adapter, the KEPT entries, the config reader and the warning sink.
 * @returns The live bridge: `view` reads every server's state, `resync` refreshes one by declared
 *          name, `adopt` connects a code-plane extension registered after this call, and `dispose`
 *          unregisters every bridge tool and reaps every child (idempotent).
 */
export async function connectExtensionMcpServers(options: McpBridgeOptions): Promise<McpBridge> {
  // The `extensions.*` layer, read ONCE for the initial connect (adopt re-reads it per call).
  const config = options.config()
  // One runtime per declared server across all kept entries, in entry-then-item order.
  const runtimes: ServerRuntime[] = options.entries.flatMap((entry) => runtimesForEntry(entry, options, config))

  await Promise.all(runtimes.map((runtime) => runtime.activate()))

  // Set by the first `dispose`, so a later `adopt` cannot resurrect a torn-down bridge.
  let disposed = false
  return {
    view: () => runtimes.map((runtime) => runtime.view()),
    resync: async (serverName: string) => {
      // The runtime whose DECLARED name matches; unknown names are a loud error, not a no-op.
      const runtime = runtimes.find((candidate) => candidate.serverName === serverName)
      if (runtime === undefined) throw new Error(`unknown mcp server "${serverName}"`)
      await runtime.resync()
    },
    adopt: async (entry: ExtensionEntry) => {
      if (disposed) return
      // Runtimes for the late entry, built with a FRESH config read (never the connect snapshot).
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
