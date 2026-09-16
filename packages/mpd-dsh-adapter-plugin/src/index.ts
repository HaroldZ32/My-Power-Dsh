// mpd-dsh-adapter: THE single place where this bundle touches DeepSeek Harness
// seams. Every mpd plugin calls through this adapter instead of the raw ctx
// services, so a harness release that renames or reshapes a seam is absorbed
// HERE — one file, one rebuild — instead of across every plugin.
//
// Wrapped seams (each feature-detected, never assumed):
//   tools.register / tools.guard / tools.get / tools.execute / tools/pre-execute / tools/post-execute
//   subagents.start (spawn)                       -> spawnAgent
//   skills.registerProvider / skills.list / skills.get
//   agentPresets.resolve
//   agents.list (session cwds)                    -> workspaceRoot / workspaceRootsAll
//
// Consumers use `createDshAdapter(ctx)` directly (works standalone, e.g. in
// unit tests) or `ctx.get("mpdDsh")` for the mounted instance provided by the
// `mpd-dsh-adapter` row. The adapter never mutates harness state on import and
// never throws at construction: a missing seam surfaces as an actionable error
// at call time, or as a `capabilities()` flag a caller can degrade on.
import { resolve } from "node:path"

export const name = "mpd-dsh-adapter"
// No hard service dependency: every seam is resolved lazily through ctx.get()
// so the row mounts in any composition order and in partial installs.
export const inject: string[] = []

/** Object-rooted JSON Schema used whenever a caller omits one. */
const OBJECT_SCHEMA: Record<string, unknown> = { type: "object", properties: {} }
const DEFAULT_TOOL_TIMEOUT_MS = 120_000

export type DshTextBlock = { type: "text"; text: string }

export interface DshToolExec {
  name?: string
  arguments?: Record<string, unknown>
  agent?: unknown
  signal?: AbortSignal
  [key: string]: unknown
}

export interface DshToolOutput {
  schema?: Record<string, unknown>
  render?: (args: unknown, value: unknown) => unknown
  presentationMeta?: unknown
}

export interface DshToolDef {
  name: string
  description: string
  parameters?: Record<string, unknown>
  output?: DshToolOutput
  timeoutMs?: number
  execute: (args: any, exec: any) => unknown
}

/** Waterfall decision handed to a post-execute listener (the downstream result). */
export interface DshPostDecision {
  kind: "accept" | "block"
  content?: unknown
  value?: unknown
  feedback?: unknown
  additionalContexts?: unknown[]
  [key: string]: unknown
}

/**
 * The `tools/pre-execute` decision the harness's own gate consumes.
 *
 * Measured in the installed harness (`dsh-tools/lib/index.js:3116`,
 * `types/index.d.ts:38`): the pre-execute waterfall resolves to this object and the
 * registry then reads `gate.kind` (`allow` dispatches, `ask` goes through approval,
 * `deny` is turned into an error result). A listener that returns without delegating
 * REPLACES it — the same veto shape `agent/pre-step` has.
 */
export interface DshPreDecision {
  kind: "allow" | "ask" | "deny"
  reason?: unknown
  [key: string]: unknown
}

export interface DshPostResult {
  content?: unknown
  isError?: boolean
  error?: { message?: string } | unknown
  value?: unknown
  [key: string]: unknown
}

export interface DshSpawnSpec {
  label: string
  prompt: string | DshTextBlock[]
  /** Flat route (preferred by this bundle) or the harness-shaped agentOptions. */
  provider?: string
  model?: string
  agentOptions?: { provider?: string; model?: string }
  persona?: string
  toolFilter?: unknown
  maxDepth?: number
  outputSchema?: Record<string, unknown>
  parent?: unknown
  signal?: AbortSignal
  /** Harness spawn mode; this bundle always uses the one-shot "spawn" mode. */
  mode?: string
}

export interface DshSpawnResult {
  output: string
  structured: any
  stopReason: string | null
}

export interface DshToolCallResult {
  ok: boolean
  isError: boolean
  value?: unknown
  error?: unknown
  raw?: unknown
}

export interface DshSkillSummary {
  name: string
  description?: string
  source?: string
  provider?: string
  resourceBase?: { kind: string; path?: string; url?: string; description?: string }
  [key: string]: unknown
}

export interface DshPresetInfo {
  id: string
  path?: string
  trust?: string
  broken?: string
}

export interface DshCapabilities {
  tools: boolean
  toolsRegister: boolean
  toolsGuard: boolean
  toolsGet: boolean
  toolsExecute: boolean
  toolsPreExecute: boolean
  toolsPostExecute: boolean
  subagents: boolean
  subagentsSpawn: boolean
  skills: boolean
  skillsProvider: boolean
  agentPresets: boolean
  /** The live-session registry (`agents.list`) — the only way to reach a member's Agent. */
  agents: boolean
  /** `ctx.get("compaction")`: the HOST-plane engine. Never used to drive a member. */
  compaction: boolean
  /** A memoized per-agent engine lookup through the agent's OWN scoped context. */
  compactionForAgent: boolean
  /** The harness event seam (`ctx.on`) — used to observe status edges. */
  events: boolean
}

/**
 * A live session's Agent, as much of it as this bundle depends on.
 *
 * Measured by the compact-hinge experiment (t45, evidence/omo-align/compact-hinge):
 * `ctx.agents.list()` returns live Agents, `id` is the shared session/agent id, and a
 * member's own compaction engine is reachable ONLY as `agent.ctx.get("compaction")` —
 * the host-plane instance is a DIFFERENT object serving a different realm.
 */
export interface DshLiveAgent {
  id: string
  status?: string
  session?: unknown
  ctx?: unknown
  runMaintenance?: unknown
}

/**
 * The harness settings-service subset the mpd settings bridge needs (t34 design
 * §5 invariant 2: no mpd plugin may touch a harness service directly).
 *
 * The NAMESPACE IS REGISTERED BY `mpd-tui-plugin` (captain ruling, 2026-09-15);
 * this seam therefore only READS and SUBSCRIBES — it never registers, so a second
 * registration (which the provider rejects loudly) is impossible by construction.
 */
/** The outcome of {@link DshAdapter.settingsMutate}: never a throw, always a result. */
export type DshSettingsMutateResult = { ok: true } | { ok: false; error: string; conflict?: boolean }

export interface DshSettingsReader {
  /** Resolved value of the namespace (`undefined` while it is not served). */
  get(): unknown
  /** The namespace descriptor when available: value/revision/user/base/applies. */
  describe(): { value?: unknown; revision?: number; user?: unknown; base?: unknown; applies?: string } | undefined
}

export interface DshAdapter {
  capabilities(): DshCapabilities
  /**
   * Authoritative workspace root for one call. Precedence, highest first:
   *   1. the CALLING SESSION's workspace  (exec.agent.session.header.cwd)
   *   2. `DSH_WORKSPACE_ROOT`             (process override: operator/QA only)
   *   3. `process.cwd()`                  (last resort: boot, unit tests)
   * The session fact outranks the process-wide env because one host serves
   * many sessions with different workspaces.
   */
  workspaceRoot(exec?: DshToolExec): string
  /**
   * Workspace roots of every LIVE session, deduplicated, in registration order.
   * `[]` when the harness exposes no agent registry — callers then fall back to
   * the exec-less `workspaceRoot()`. For agentless surfaces (web routes) only.
   */
  workspaceRootsAll(): string[]
  /** Every live Agent in this process (`[]` when the registry is absent). */
  liveAgents(): DshLiveAgent[]
  /** One live Agent by id, or undefined. */
  liveAgent(agentId: string): DshLiveAgent | undefined
  /**
   * The compaction engine THAT SERVES ONE AGENT, resolved through the agent's own
   * scoped context. This is the ONLY correct engine to drive a member session: the
   * host-plane `ctx.get("compaction")` is a different instance covering a different
   * realm (measured `sameObject: false`), so using it would compact the wrong thing.
   * Memoized per agent id, and dropped when the agent is gone so a recycled id cannot
   * inherit a stale engine.
   */
  compactionEngineForAgent(agentId: string): unknown
  /** Subscribe to a harness event; returns a disposer, or undefined when unavailable. */
  onEvent(event: string, handler: (...args: unknown[]) => unknown): (() => void) | undefined
  /** Reader for one settings namespace, or undefined when the service is absent. */
  settingsReader(namespace: string): DshSettingsReader | undefined
  /**
   * Subscribe to `settings/document-updated(ns, revision)` — the RAW-section change
   * event (fires even when the resolved value did not change), which is the
   * write-back trigger.
   *
   * `revision` and `source` describe the SAME change. The host emits
   * `bumpRevision` (=> `settings/document-updated`) BEFORE `commit`
   * (=> `settings/updated(ns,next,prev,source)`) inside one synchronous
   * `write()`/`publish()` call — MEASURED in
   * `@deepseek-ai/dsh-settings/lib/index.js:466-467` and `:497-498` — so the
   * source cannot be read at document-updated time. This seam therefore
   * COALESCES the two events per tick and calls the listener on the next
   * microtask, after both have fired, with the source of the same change.
   *
   * `source === undefined` means the raw section changed while the resolved value
   * did not (`commit` returns early), so no `settings/updated` fired; callers must
   * gate such a change on their own value diff rather than treating it as a
   * front-door edit.
   */
  onSettingsDocumentUpdated(
    namespace: string,
    listener: (revision: number | undefined, source: string | undefined) => void,
  ): () => void
  /**
   * REGISTER a settings namespace and receive its owner scope (design §10.1 places this call in
   * `mpd-config-plugin`, because only it can supply the file-derived `base`). Duplicate
   * registration fails loud on this host (`dsh-settings` `register()` line 283), which is why the
   * TUI package's fallback must probe first.
   *
   * NOTE, MEASURED: the host exposes NO disposal handle for a live registration — `register()`
   * returns only `{get, watch, update, replace}` and removes the namespace from an internal
   * `ctx.effect`. The design's §1.3 fallback therefore governs: the base is fixed for the process
   * lifetime and the resolved value is the authority (the host's own `installSection` does the
   * same, `dsh-settings/lib/index.js:327-350`).
   */
  settingsRegister(
    namespace: string,
    schema: unknown,
    options?: { base?: unknown; applies?: string },
  ): { ok: true } | { ok: false; error: string }
  /**
   * Run `callback` once the settings provider is MOUNTED. MEASURED: a loader applies rows
   * concurrently, so `service("settings")` can be undefined while a row that mounts before the
   * provider is applying — `mpd-config`'s registration attempt then fails with "settings service is
   * unavailable" and the TUI fallback ends up owning the namespace without a file-derived base.
   * The callback parks on `ctx.inject(["settings"], …)` inside the adapter (invariant 2: the
   * adapter is the only place allowed to reach the harness directly).
   */
  whenSettingsAvailable(callback: () => void): void
  /**
   * Write ops into a namespace this plugin does NOT register
   * (`settings.mutate(ns, ops, expectedRevision)`; the revision fence raises the
   * host's `SettingsConflictError` on a concurrent change). Used by the bridge's
   * §1.2 clearing rule: a fresh FILE edit unsets the overlapping settings override.
   * Returns the mode name on success, or `{ error }` — never throws into an event
   * listener.
   */
  settingsMutate(
    namespace: string,
    ops: readonly { op: "set" | "unset"; path: readonly string[]; value?: unknown }[],
    expectedRevision?: number,
  ): Promise<DshSettingsMutateResult>
  registerTool(definition: DshToolDef): () => void
  registerTools(definitions: DshToolDef[]): () => void
  guardTool(guard: (exec: DshToolExec) => string | undefined): () => void
  /**
   * Observe a tool call BEFORE dispatch — the `tools/pre-execute` waterfall.
   *
   * **OBSERVE-ONLY, by construction.** The adapter owns `next()` exactly like
   * {@link DshAdapter.onPostToolExecute} does: it awaits the downstream decision, hands it
   * to the listener (whose return value is IGNORED) and returns the downstream
   * decision object itself, so this hook can neither alter nor veto a call. The listener
   * observes a **frozen shallow copy** of the execution — it cannot mutate what will be
   * dispatched — and a listener that throws is contained. A harness build with no event bus
   * makes this a no-op (`() => {}`), never a boot failure; `capabilities().toolsPreExecute`
   * reports it.
   *
   * The listener runs AFTER `next()` resolves but still BEFORE the tool body dispatches
   * (the harness awaits the whole waterfall before it executes, `dsh-tools/lib/index.js:3116`),
   * so it sees the decision that will actually be used.
   *
   * @param listener - `(exec, decision)`; the decision is the harness's own
   *   `{kind:'allow'|'ask'|'deny'}` gate value (see {@link DshPreDecision}).
   * @returns a disposer (a no-op when the seam does not exist).
   */
  onPreToolExecute(listener: (exec: DshToolExec, decision: DshPreDecision | undefined) => void): () => void
  onPostToolExecute(
    listener: (exec: DshToolExec, result: DshPostResult, downstream: DshPostDecision) => DshPostDecision | undefined | Promise<DshPostDecision | undefined>,
  ): () => void
  hasTool(name: string): boolean
  /**
   * Structural view of the tool runtime for internal tool calls.
   *
   * `execute`'s optional `agent` is forwarded verbatim as the harness execution's
   * `exec.agent` (measured contract: `dsh-tools/lib/index.js:3025-3045` reads
   * `exec.agent` and `:3190-3192` resolves the tool against it). It stays OPTIONAL
   * so every existing caller keeps its exact meaning: absent = no agent (the
   * pre-existing behaviour).
   */
  toolRuntime(): { get(name: string): unknown; execute(input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; agent?: unknown }): Promise<unknown> }
  /**
   * Call one registered tool in-process and normalize the result.
   *
   * The optional `agent` is the ONE way an agentless surface (a TUI scene, a web
   * route) can drive an agent-scoped tool: the adopted agent-teams write tools
   * begin with `requireCaptain(exec)` and throw without it. Pass the object the
   * live registry returned (`liveAgent(id)` / `liveAgents()[0]`) — never a
   * hand-built Agent-like object.
   */
  executeTool(input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; timeoutMs?: number; agent?: unknown }): Promise<DshToolCallResult>
  spawnAgent(spec: DshSpawnSpec): Promise<DshSpawnResult>
  registerSkillProvider(provider: unknown): () => void
  listSkills(options?: { cwd?: string }): Promise<DshSkillSummary[]>
  loadSkill(skillName: string, options?: { cwd?: string }): Promise<unknown>
  resolvePreset(presetId: string): Promise<DshPresetInfo>
  text(content: unknown): DshTextBlock[]
}

/** Canonical model-facing text block (the one shape every harness build accepts). */
export function textBlock(content: unknown): DshTextBlock[] {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }]
}

/** Post-execute decision helpers (the harness uses `feedback`, older notes `reason`). */
export const decision = {
  accept: (content?: unknown): DshPostDecision => (content === undefined ? { kind: "accept" } : { kind: "accept", content }),
  block: (feedback: unknown): DshPostDecision => ({ kind: "block", feedback }),
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── workspace root: the ONE resolution every mpd plugin (and only it) uses ────
// The harness never defines DSH_WORKSPACE_ROOT; a session's header cwd is the
// authoritative workspace (dsh-tool-bash resolves its workdir the same way:
// explicit workdir -> session header.cwd -> executor default). Precedence,
// highest first: session -> DSH_WORKSPACE_ROOT (operator/QA override) ->
// process.cwd() (boot, unit tests). Never cached: one host serves many sessions
// with different workspaces.
/** One agent's session workspace, or undefined when absent/not a usable string. */
function sessionCwdOf(agent: any): string | undefined {
  try {
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
  } catch {
    return undefined
  }
}

/** The authoritative workspace root for a call (see precedence above). */
export function workspaceRootOf(exec?: DshToolExec): string {
  const session = sessionCwdOf(exec?.agent)
  if (session !== undefined) return resolve(session)
  const override = process.env.DSH_WORKSPACE_ROOT
  if (typeof override === "string" && override.length > 0) return resolve(override)
  return process.cwd()
}

/**
 * Workspace roots of every live session, deduplicated, registration order.
 * `[]` when the agent registry is absent — the caller then falls back to the
 * exec-less {@link workspaceRootOf}.
 */
export function workspaceRootsOf(agents: any): string[] {
  if (agents === undefined || agents === null || typeof agents.list !== "function") return []
  try {
    const list = agents.list()
    if (!Array.isArray(list)) return []
    const roots = new Set<string>()
    for (const agent of list) {
      const cwd = sessionCwdOf(agent)
      if (cwd !== undefined) roots.add(resolve(cwd))
    }
    return [...roots]
  } catch {
    return []
  }
}

function noop(): void { /* seam absent: nothing was registered */ }

export function createDshAdapter(ctx: any, config: { defaultTimeoutMs?: number } = {}): DshAdapter {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  // Cordis exposes a service through ctx.get(name) and as a ctx property; unit
  // test doubles often provide only one of the two, so try both. Reading an
  // uninjected service as a property THROWS in Cordis ("cannot get property
  // without inject"), which is why this row stays inject-free and every probe
  // is contained here.
  const service = (serviceName: string): any => {
    if (typeof ctx?.get === "function") {
      try {
        const viaGet = ctx.get(serviceName)
        if (viaGet !== undefined && viaGet !== null) return viaGet
      } catch { /* fall through to the property form */ }
    }
    try { return ctx?.[serviceName] } catch { return undefined }
  }

  function requireService(serviceName: string, needed: string): any {
    const found = service(serviceName)
    if (found === undefined || found === null) {
      throw new Error(`mpd-dsh-adapter: harness service "${serviceName}" is unavailable — ${needed}`)
    }
    return found
  }

  // The workspace plane forwards to the ONE module-level resolution below; the
  // instance form exists so plugins with a ctx still go through the adapter surface.
  const workspaceRoot = (exec?: DshToolExec): string => workspaceRootOf(exec)
  const workspaceRootsAll = (): string[] => workspaceRootsOf(service("agents"))

  // ── live-session plane ────────────────────────────────────────────────────
  // `agents.list()` is the ONLY handle on a member's Agent: the durable team record
  // carries member NAMES and session IDs, not Agents, and a continuable member's Agent
  // lives in this process only while its session does.
  function liveAgents(): DshLiveAgent[] {
    const agents = service("agents")
    if (agents === undefined || typeof agents.list !== "function") return []
    try {
      const list = agents.list()
      return Array.isArray(list) ? list.filter((entry: any) => entry !== undefined && entry !== null) : []
    } catch { return [] }
  }

  function liveAgent(agentId: string): DshLiveAgent | undefined {
    const id = String(agentId ?? "")
    if (id === "") return undefined
    const agents = service("agents")
    if (agents !== undefined && typeof agents.get === "function") {
      try {
        const found = agents.get(id)
        if (found !== undefined && found !== null) return found as DshLiveAgent
      } catch { /* fall through to the list scan */ }
    }
    // A registry without get() (or one that does not know the id) still answers from
    // the live list, which is what the hinge experiment measured.
    return liveAgents().find((candidate) => candidate.id === id)
  }

  /**
   * Per-agent compaction engines, memoized by agent id.
   *
   * The engine MUST come from `agent.ctx.get("compaction")`. The compact-hinge
   * experiment measured the host-plane `ctx.get("compaction")` and the member-scoped
   * lookup returning objects that are NOT the same (`sameObject: false`) while both
   * report `name: "compaction"` — each realm has its own BasicCompactionEngine, so
   * driving a member with the host instance would compact a different realm's history.
   * Dispatching through this one memoized helper makes that mistake impossible to make
   * per-call-site.
   *
   * The cache is keyed by agent id AND dropped when the agent leaves the live registry,
   * so a recycled id can never inherit a previous incarnation's engine.
   */
  const engineCache = new Map<string, unknown>()
  function compactionEngineForAgent(agentId: string): unknown {
    const id = String(agentId ?? "")
    if (id === "") return undefined
    const cached = engineCache.get(id)
    if (cached !== undefined) return cached
    const agent = liveAgent(id)
    const scoped = agent?.ctx
    if (scoped === undefined || scoped === null) return undefined
    let engine: unknown
    try {
      engine = typeof (scoped as any).get === "function" ? (scoped as any).get("compaction") : undefined
    } catch {
      return undefined
    }
    if (engine === undefined || engine === null) return undefined
    engineCache.set(id, engine)
    return engine
  }

  function onEvent(event: string, handler: (...args: unknown[]) => unknown): (() => void) | undefined {
    if (typeof ctx?.on !== "function") return undefined
    try {
      const disposer = ctx.on(event, handler)
      return typeof disposer === "function" ? disposer : () => { /* event bus owns teardown */ }
    } catch {
      return undefined
    }
  }

  function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
    try {
      if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout === "function") return (AbortSignal as any).timeout(timeoutMs)
    } catch { /* fall through to no signal */ }
    return undefined
  }

  const adapter: DshAdapter = {
    capabilities(): DshCapabilities {
      const tools = service("tools")
      const subagents = service("subagents")
      const skills = service("skills")
      const presets = service("agentPresets")
      const agents = service("agents")
      const compaction = service("compaction")
      const sample = liveAgents()[0]
      const sampleScoped = sample?.ctx
      let scopedCompaction = false
      try {
        scopedCompaction = sampleScoped !== undefined && typeof (sampleScoped as any).get === "function"
          && (sampleScoped as any).get("compaction") !== undefined
      } catch { scopedCompaction = false }
      return {
        tools: tools !== undefined,
        toolsRegister: typeof tools?.register === "function",
        toolsGuard: typeof tools?.guard === "function",
        toolsGet: typeof tools?.get === "function",
        toolsExecute: typeof tools?.execute === "function",
        toolsPreExecute: typeof ctx?.on === "function",
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function",
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function",
      }
    },

    // ── workspace plane ─────────────────────────────────────────────────────
    workspaceRoot,
    workspaceRootsAll,

    // ── live-session plane ──────────────────────────────────────────────────
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,

    // ── tool plane ──────────────────────────────────────────────────────────
    registerTool(definition: DshToolDef): () => void {
      const tools = requireService("tools", "cannot register tool \"" + String(definition?.name) + "\"")
      if (typeof tools.register !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()")
      const output = definition.output ?? {}
      const render = typeof output.render === "function" ? output.render : (_args: unknown, value: unknown) => textBlock(value)
      const schema = output.schema ?? OBJECT_SCHEMA
      return tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? OBJECT_SCHEMA,
        output: { ...output, schema, render },
        ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
        // Normalized call shape: a harness build that hands execute() no exec
        // object still gives every mpd tool a stable (args, exec) contract.
        execute: async (args: unknown, exec: unknown) => definition.execute(args ?? {}, exec ?? {}),
      })
    },

    registerTools(definitions: DshToolDef[]): () => void {
      const disposers = definitions.map((definition) => adapter.registerTool(definition))
      return () => { for (const dispose of disposers) dispose() }
    },

    guardTool(guard: (exec: DshToolExec) => string | undefined): () => void {
      const tools = requireService("tools", "cannot install a tool guard")
      if (typeof tools.guard !== "function") throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()")
      return tools.guard((exec: DshToolExec) => guard(exec ?? {}))
    },

    onPreToolExecute(
      listener: (exec: DshToolExec, decision: DshPreDecision | undefined) => void,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      // `tools/pre-execute` is a WATERFALL with the same veto shape as `agent/pre-step`:
      // cordis runs the listeners outermost-first with `next` appended, so a listener
      // that returns without delegating REPLACES the gate decision. This wrapper owns
      // `next()` and RETURNS THE DOWNSTREAM OBJECT VERBATIM, so the listener's own
      // return value is discarded by construction and the gate is bit-identical to a
      // composition without this hook. A listener that throws changes nothing either.
      return ctx.on("tools/pre-execute", async (exec: DshToolExec, next: () => Promise<DshPreDecision>) => {
        const downstream = typeof next === "function" ? await next() : undefined
        try {
          // The listener observes a FROZEN SHALLOW COPY, never the live execution object: it
          // cannot mutate what the harness will dispatch (`dsh-tools` re-fuses `exec.signal`
          // around this waterfall, so freezing the original would break the harness itself),
          // and an attempted write throws inside the listener — which is contained below.
          listener(Object.freeze({ ...(exec ?? {}) }), downstream)
        } catch {
          // observe-only: a broken observer must never affect the call it observes
        }
        return downstream
      })
    },

    onPostToolExecute(
      listener: (exec: DshToolExec, result: DshPostResult, downstream: DshPostDecision) => DshPostDecision | undefined | Promise<DshPostDecision | undefined>,
    ): () => void {
      if (typeof ctx?.on !== "function") return noop
      return ctx.on("tools/post-execute", async (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => {
        // The harness waterfall requires the listener to run `next()`; this
        // adapter owns that call so a listener only decides what to change.
        const downstream: DshPostDecision = typeof next === "function" ? (await next()) ?? { kind: "accept" } : { kind: "accept" }
        const decided = await listener(exec ?? {}, result ?? {}, downstream)
        return decided ?? downstream
      })
    },

    hasTool(toolName: string): boolean {
      const tools = service("tools")
      if (typeof tools?.get !== "function") return false
      try { return tools.get(toolName) !== undefined } catch { return false }
    },

    /** Structural view of the tool runtime for internal tool calls. */
    toolRuntime() {
      const tools = service("tools")
      return {
        get: (toolName: string) => (typeof tools?.get === "function" ? tools.get(toolName) : undefined),
        execute: (input: { name: string; arguments?: unknown; callId?: string; signal?: AbortSignal; agent?: unknown }) =>
          adapter.executeTool({ ...input, timeoutMs: defaultTimeoutMs }).then((result) => result.raw),
      }
    },

    async executeTool(input): Promise<DshToolCallResult> {
      const tools = service("tools")
      if (tools === undefined || typeof tools.execute !== "function") {
        return { ok: false, isError: true, error: "the harness tool runtime has no execute()" }
      }
      const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10)
      const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs)
      try {
        const raw = await tools.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...(signal === undefined ? {} : { signal }),
          // The calling agent rides the execution only when the caller supplied one:
          // absent stays absent, so no existing call site changes meaning.
          ...(input.agent === undefined ? {} : { agent: input.agent }),
        })
        const isError = (raw as DshPostResult | undefined)?.isError === true
        if (isError) {
          const error = (raw as DshPostResult)?.error
          return { ok: false, isError: true, error: (error as { message?: string })?.message ?? error ?? "tool error", raw }
        }
        return { ok: true, isError: false, value: (raw as DshPostResult)?.value, raw }
      } catch (error) {
        return { ok: false, isError: true, error: message(error) }
      }
    },

    // ── agent plane ─────────────────────────────────────────────────────────
    async spawnAgent(spec: DshSpawnSpec): Promise<DshSpawnResult> {
      const subagents = requireService("subagents", "cannot spawn subagent \"" + String(spec?.label) + "\"")
      if (typeof subagents.start !== "function") throw new Error("mpd-dsh-adapter: the harness subagent service exposes no start()")
      const route = {
        ...(spec.provider === undefined ? {} : { provider: spec.provider }),
        ...(spec.model === undefined ? {} : { model: spec.model }),
        ...(spec.agentOptions ?? {}),
      }
      const run = await subagents.start(spec.mode ?? "spawn", {
        label: spec.label,
        prompt: typeof spec.prompt === "string" ? textBlock(spec.prompt) : spec.prompt,
        ...(spec.parent === undefined ? {} : { parent: spec.parent }),
        ...(spec.signal === undefined ? {} : { signal: spec.signal }),
        ...(Object.keys(route).length === 0 ? {} : { agentOptions: route }),
        ...(spec.persona === undefined ? {} : { persona: spec.persona }),
        ...(spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema }),
        ...(spec.toolFilter === undefined ? {} : { toolFilter: spec.toolFilter }),
        ...(spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }),
      })
      // `run.result` is a promise in some harness builds and a plain object in
      // others; awaiting both keeps the normalized shape stable.
      const result = (await (run?.result ?? {})) as { output?: unknown; structured?: unknown; stopReason?: unknown }
      return {
        output: typeof result.output === "string" ? result.output : "",
        structured: result.structured,
        stopReason: (result.stopReason as string | null | undefined) ?? null,
      }
    },

    // ── skill plane ─────────────────────────────────────────────────────────
    registerSkillProvider(provider: unknown): () => void {
      const skills = requireService("skills", "cannot register a skill provider")
      if (typeof skills.registerProvider !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no registerProvider()")
      return skills.registerProvider(provider)
    },

    async listSkills(options: { cwd?: string } = {}): Promise<DshSkillSummary[]> {
      const skills = requireService("skills", "cannot list skills")
      if (typeof skills.list !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no list()")
      return (await skills.list(options)) ?? []
    },

    async loadSkill(skillName: string, options: { cwd?: string } = {}): Promise<unknown> {
      const skills = requireService("skills", "cannot load skill \"" + skillName + "\"")
      if (typeof skills.get !== "function") throw new Error("mpd-dsh-adapter: the harness skills service exposes no get()")
      return skills.get(skillName, options)
    },

    // ── preset plane ────────────────────────────────────────────────────────
    async resolvePreset(presetId: string): Promise<DshPresetInfo> {
      const presets = requireService("agentPresets", "cannot resolve preset \"" + presetId + "\"")
      if (typeof presets.resolve !== "function") throw new Error("mpd-dsh-adapter: the harness agent-presets service exposes no resolve()")
      const preset = await presets.resolve(presetId)
      return {
        id: String(preset?.id ?? presetId),
        ...(preset?.path === undefined ? {} : { path: String(preset.path) }),
        ...(preset?.trust === undefined ? {} : { trust: String(preset.trust) }),
        ...(preset?.broken === undefined ? {} : { broken: String(preset.broken) }),
      }
    },

    // ── settings plane (t34 §5 invariant 2: the ONE harness contact surface) ──
    settingsReader(namespace: string): DshSettingsReader | undefined {
      const settings = service("settings")
      if (settings === undefined || settings === null) return undefined
      return {
        get(): unknown {
          try {
            return typeof settings.get === "function" ? settings.get(namespace) : undefined
          } catch {
            return undefined
          }
        },
        describe() {
          try {
            if (typeof settings.describe !== "function") return undefined
            const list = settings.describe() as Array<Record<string, unknown>>
            if (!Array.isArray(list)) return undefined
            const found = list.find((entry) => entry?.ns === namespace)
            if (found === undefined) return undefined
            return {
              value: found.value,
              revision: typeof found.revision === "number" ? found.revision : undefined,
              user: found.user,
              base: found.base,
              applies: typeof found.applies === "string" ? found.applies : undefined,
            }
          } catch {
            return undefined
          }
        },
      }
    },

    onSettingsDocumentUpdated(
      namespace: string,
      listener: (revision: number | undefined, source: string | undefined) => void,
    ): () => void {
      // Both events fire synchronously inside ONE host write, document-updated FIRST,
      // so the change's source is only known after the tick: coalesce, then defer.
      let pendingRevision: number | undefined
      let pendingSource: string | undefined
      let hasPending = false
      let scheduled = false
      const flush = (): void => {
        scheduled = false
        if (!hasPending) return
        const revision = pendingRevision
        const source = pendingSource
        pendingRevision = undefined
        pendingSource = undefined
        hasPending = false
        try {
          listener(revision, source)
        } catch {
          // A bridge failure must never break the settings commit that emitted it.
        }
      }
      const offUpdated = adapter.onEvent("settings/updated", (ns: unknown, _next: unknown, _prev: unknown, from: unknown) => {
        if (String(ns) !== namespace) return undefined
        pendingSource = from === undefined ? undefined : String(from)
        return undefined
      })
      const offDocument = adapter.onEvent("settings/document-updated", (ns: unknown, revision: unknown) => {
        if (String(ns) !== namespace) return undefined
        pendingRevision = typeof revision === "number" ? revision : undefined
        hasPending = true
        if (!scheduled) {
          scheduled = true
          // Promise.resolve().then() = a microtask: it runs after the host's
          // synchronous write()/publish() returned, i.e. after settings/updated.
          void Promise.resolve().then(flush)
        }
        return undefined
      })
      return () => {
        try {
          offUpdated?.()
        } catch {
          // best effort
        }
        try {
          offDocument?.()
        } catch {
          // best effort
        }
      }
    },

    whenSettingsAvailable(callback: () => void): void {
      if (typeof ctx?.inject !== "function") {
        // No deferred-inject seam: try once immediately rather than never.
        try {
          callback()
        } catch {
          /* the caller reports its own failure */
        }
        return
      }
      try {
        ctx.inject(["settings"], () => {
          try {
            callback()
          } catch {
            /* the caller reports its own failure */
          }
        })
      } catch {
        /* an unusable inject seam leaves the caller's own degradation path */
      }
    },

    settingsRegister(
      namespace: string,
      schema: unknown,
      options?: { base?: unknown; applies?: string },
    ): { ok: true } | { ok: false; error: string } {
      const settings = service("settings")
      if (settings === undefined || settings === null || typeof settings.register !== "function") {
        return { ok: false, error: "settings service is unavailable" }
      }
      try {
        settings.register(namespace, schema, { ...(options?.base === undefined ? {} : { base: options.base }), ...(options?.applies === undefined ? {} : { applies: options.applies }) })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String((error as Error)?.message ?? error) }
      }
    },

    async settingsMutate(
      namespace: string,
      ops: readonly { op: "set" | "unset"; path: readonly string[]; value?: unknown }[],
      expectedRevision?: number,
    ): Promise<DshSettingsMutateResult> {
      const settings = service("settings")
      if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
        return { ok: false, error: "settings service is unavailable" }
      }
      try {
        await settings.mutate(namespace, ops.map((op) => (op.op === "unset" ? { op: "unset", path: [...op.path] } : { op: "set", path: [...op.path], value: op.value })), expectedRevision)
        return { ok: true }
      } catch (error) {
        const name = String((error as { name?: unknown })?.name ?? "")
        const conflict = name === "SettingsConflictError" || /conflict/i.test(String((error as Error)?.message ?? ""))
        return { ok: false, error: String((error as Error)?.message ?? error), ...(conflict ? { conflict: true } : {}) }
      }
    },

    text: textBlock,
  }

  return adapter
}

/** Service name other rows resolve with `ctx.get("mpdDsh")`. */
export const SERVICE_NAME = "mpdDsh"

export function apply(ctx: any, config: { defaultTimeoutMs?: number; quiet?: boolean } = {}): void {
  const adapter = createDshAdapter(ctx, { ...(config.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }) })
  ctx.provide(SERVICE_NAME, adapter)
  // The loader applies sibling rows concurrently, so a capability snapshot taken
  // here would under-report. The row logs a stable line and callers read
  // capabilities() at use time (the QA probe prints them from a real boot).
  if (config.quiet !== true) {
    console.log("[mpd-dsh-adapter] " + SERVICE_NAME + " provided (harness seams resolved lazily, inject-free)")
  }
}
