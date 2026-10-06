// mpd-dsh-adapter unit tests: every wrapped harness seam is normalized and
// feature-detected, so a harness build that lacks a seam degrades with an
// actionable error instead of crashing the plugin tree.
import { describe, expect, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// The two vendored `_deps/**` JS modules ship NO type declarations, and that tree is outside this
// lane's write scope, so the imports are the one place a directive is the honest tool: the module
// resolves to `any`, and every shape this file relies on is declared at its own use site (the
// `Context` waterfall calls below and the message comparison against `userMessage`). A LOCAL
// `.d.ts` is impossible here (it would have to live in the vendored tree) and a `declare module`
// block would be an augmentation trick. `@ts-expect-error` (not `@ts-ignore`) so a future vendored
// type declaration turns this into a loud "unused directive" instead of a silent suppression.
/** The vendored cordis module, used as the REAL waterfall dispatcher in the last describe block. */
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { Context } from "../../mpd-agent-teams-plugin/_deps/cordis/lib/index.ts"

/**
 * The slice of the real vendored cordis context these arms drive.
 *
 * WHY AN ALIAS: `Context` is a real VALUE whose `on` / `waterfall` / `plugin` members are installed
 * by a Proxy handler (`ReflectService.handler` in the vendored module), so they are absent from the
 * class's own type even though every runtime instance carries them. Naming the driven slice keeps
 * each call site checked instead of widening the context to `any`.
 */
interface DrivenContext {
  /** Subscribe to one bus event; the handler is whatever shape the arm registers. */
  on(event: string, handler: unknown): unknown
  /** Run one waterfall step as the harness does; the resolved decision always carries its `kind`. */
  waterfall(...args: unknown[]): Promise<{ kind: string } & Record<string, unknown>>
  /** Create a plugin fiber from a row definition. */
  plugin(plugin: unknown, config?: unknown): unknown
}

/**
 * Create a real vendored cordis context, typed as the slice these arms drive.
 * @returns the real context; the alias above names the members its class type omits.
 */
const realContext = (): DrivenContext => new Context() as unknown as DrivenContext
/** The vendored host message constructor, compared field by field against this adapter's own. */
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { createUserMessage } from "../../mpd-agent-teams-plugin/_deps/dsh-llm/lib/index.ts"
import { apply, createDshAdapter, createLazyDshAdapter, decision, dshAdapterIdentity, ADAPTER_IDENTITY_FALLBACK, ADAPTER_IDENTITY_MOUNTED, ADAPTER_IDENTITY_PENDING, GOAL_TOOL_NAMES, SERVICE_NAME, textBlock, userMessage } from "../src/index"

/** A recording double of the FULL harness: eleven services (the goal domain included), the event bus and provide(). */
function fakeHarness(overrides: Record<string, unknown> = {}): {
  /** The ctx handed to the adapter: a service lookup, provide() and the event bus. */
  ctx: {
    get(serviceName: string): unknown
    on(event: string, listener: (...args: unknown[]) => unknown): () => void
    provide(serviceName: string, value: unknown): void
    [key: string]: unknown
  }
  /** Definitions the tools registry received, in the adapter's normalized shape. */
  registered: Array<{
    name: string
    description: string
    parameters: { type: string; properties: Record<string, Record<string, unknown>> }
    output: { schema: unknown; render: (args: unknown, value: unknown) => unknown }
    execute: (args?: unknown, exec?: unknown) => unknown
  }>
  /** Guards the tools registry received. */
  guards: Array<(exec: unknown) => string | undefined>
  /** Post-execute listeners the event bus received. */
  listeners: Array<(exec: unknown, result: unknown, next: () => Promise<unknown>) => Promise<{ kind: string; content?: unknown }>>
  /** Pre-execute listeners the event bus received. */
  preListeners: Array<(exec: unknown, next?: () => Promise<unknown>) => Promise<unknown>>
  /** Services `provide()` was called with, keyed by name. */
  provided: Record<string, unknown>
  /** Spawn calls, as `{mode, spec}` pairs. */
  started: Array<{ mode: string; spec: Record<string, unknown> }>
  /** Executions the tool runtime received; `agent` is present only when the caller sent one. */
  executed: Array<{ name: string; callId?: string; arguments?: unknown; agent?: { session: { header: { cwd: string } } } }>
  /** Command definitions the command registry received. */
  commandsRegistered: Array<{ name: string; description: string; input?: unknown; handler: (invocation?: { rawInput?: string }) => unknown }>
  /** The disposers that registry returned, in the same order. */
  commandDisposers: Array<() => void>
  /** Messages pushed through the sample agent's followup. */
  submitted: unknown[]
} {
  /** Definitions the tools registry received. */
  const registered: any[] = []
  /** Guards the tools registry received. */
  const guards: any[] = []
  /** Post-execute listeners the event bus received. */
  const listeners: any[] = []
  /** Pre-execute listeners the event bus received. */
  const preListeners: any[] = []
  /** Services `provide()` was called with, keyed by name. */
  const provided: Record<string, unknown> = {}
  /** Spawn calls, as `{mode, spec}` pairs. */
  const started: Array<{ mode: string; spec: any }> = []
  /** Executions the tool runtime received. */
  const executed: any[] = []
  /** Command definitions the command registry received. */
  const commandsRegistered: any[] = []
  /** The disposers that registry returned, in the same order. */
  const commandDisposers: Array<() => void> = []
  /** The recording tools service: registry, guard registry and an executing runtime. */
  const tools = {
    register: (definition: any) => { registered.push(definition); return () => { registered.pop() } },
    guard: (guard: any) => { guards.push(guard); return () => { guards.pop() } },
    get: (name: string) => (name === "mcp__wave_mcp__prepare_session" || GOAL_TOOL_NAMES.includes(name) ? { name } : undefined),
    execute: async (exec: any) => {
      executed.push(exec)
      if (exec.name === "boom") throw new Error("tool exploded")
      if (exec.name === "fails") return { isError: true, error: { message: "denied" } }
      return { value: { echo: exec.arguments } }
    },
  }
  /** The recording subagent service: spawn plus the provider and delivery seams. */
  const subagents = {
    start: async (mode: string, spec: any) => {
      started.push({ mode, spec })
      return { result: { output: "done", structured: { ok: true }, stopReason: "end_turn" } }
    },
    // ── additive (t2/AC1): the three provider/delivery seams the agent-teams surface
    // consumes. A "full harness" now includes them, so the shared fixture carries them;
    // every EXISTING assertion above and below is untouched (their BEHAVIOUR is covered
    // by test/adapter-agent-teams-surface.test.ts, which owns its own recording double).
    getProvider: (name: string) => ({ name }),
    list: () => ["spawn-in-process"],
    startContinuable: async (spec: any) => ({ spec }),
    interrupt: (targetSessionId: string, authority: any) => { void targetSessionId; void authority },
    // additive (0.1.7/adaptation D6): the provider REGISTRATION seam. A full harness
    // exposes it, so the shared fixture carries it too (behaviour is covered by
    // test/adapter-team-surface.test.ts and test/no-direct-team-access.test.ts).
    registerProvider: (provider: any) => { provided.subagentProvider = provider; return () => { delete provided.subagentProvider } },
  }
  // additive (0.1.7/adaptation D6): the OFFICIAL Agent Teams service
  // (`@deepseek-ai/dsh-experimental-agent-team`). A full harness mounts it, so
  // `capabilities()` reports every team flag true on this fixture; the frozen behaviour
  // of the adapter's team surface is owned by test/adapter-team-surface.test.ts.
  const agentTeams = {
    tryMembership: (agent: any) => ({ root: agent, id: "team-fixture", role: "lead", name: "lead" }),
    listMembers: (agent: any) => [{ id: "sample-agent", name: "lead", role: "lead", status: "running", diagnostics: [] }],
    listTasks: () => [],
    createTask: async (_caller: any, request: any) => ({ id: "task-1", revision: 1, subject: request?.subject ?? "", description: request?.description ?? "", status: "pending", blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] }),
    getTask: () => ({ id: "task-1", revision: 1, subject: "s", description: "d", status: "pending", blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] }),
    updateTask: async () => ({ id: "task-1", revision: 2, subject: "s", description: "d", status: "in_progress", blockedBy: [], writeScopes: [], ready: false, writeScopeWarnings: [] }),
    sendMessage: async () => ({ messageId: "message-1", status: "accepted" }),
    spawnTeammate: async (_caller: any, request: any) => ({ member: { id: "member-1", name: request?.name ?? "member", role: "teammate", status: "running", diagnostics: [] } }),
    interrupt: () => ({ previousStatus: "running" }),
    waitForChange: async () => ({ timedOut: false }),
  }
  /** The recording skills service: provider registration, catalogue and body load. */
  const skills = {
    registerProvider: (provider: any) => { provided.skills = provider; return () => { delete provided.skills } },
    list: async () => [{ name: "svn-master", source: "bundled" }],
    get: async (name: string) => ({ name, content: "body" }),
  }
  // The 0.1.7-rc.2 preset model: the deployment default lives on
  // `agent-preset-registry` and a preset is an `@deepseek-ai/dsh-agent-preset` ROW, so
  // `resolve(id)` answers `{id, broken?}` — there is no directory to report. The OPTIONAL
  // `path`/`trust` fields stay declared for a host build that still sends them, which the
  // second arm below covers.
  const agentPresets = { resolve: async (id: string) => ({ id }) }
  /** The host-plane compaction engine, a different object from the agent's own. */
  const compaction = { compactNow: async (agent: any) => ({ agent }) }
  // MEASURED host contract (dsh-commands/lib/index.ts `register()`): the registry
  // returns the exact effect disposer that unregisters the definition, which the
  // adapter must pass through verbatim.
  const commands = {
    register: (definition: any) => {
      commandsRegistered.push(definition)
      /** Remove this definition again, mirroring the registry's effect teardown. */
      const dispose = (): void => {
        /** Index of the definition to remove, or -1 when it is already gone. */
        const at = commandsRegistered.indexOf(definition)
        if (at >= 0) commandsRegistered.splice(at, 1)
      }
      commandDisposers.push(dispose)
      return dispose
    },
  }
  // The live model registry the llmCatalog seam projects. Host contract, measured in
  // dsh-llm/lib/types/index.d.ts: `listProviders(): LlmProviderInfo[]` (SYNC),
  // `listModels(provider): Promise<LlmModelInfo[]>`,
  // `resolveModelInfo(provider, model): Promise<LlmResolvedModelInfo>`.
  const llm = {
    listProviders: () => [{ id: "deepseek-official", name: "DeepSeek Official" }],
    listModels: async (providerId: string) => [{ provider: providerId, id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    resolveModelInfo: async (providerId: string, modelId: string) => ({
      provider: providerId,
      id: modelId,
      name: modelId,
      reasoning: { efforts: [{ id: "high", name: "High" }], defaultEffort: "high" },
    }),
    // additive (t2/AC1): the per-call config resolver the agent-teams route check uses.
    resolveCallConfig: async (config: any) => config,
  }
  // additive (t2/AC1): the system-prompt contribution seam (one callable `section`).
  const systemPrompt = { section: (_section: any) => () => { /* unregistered */ } }
  // The sample agent carries its OWN scoped ctx: on a real harness the agent-scoped compaction
  // service is a different object from the host-plane one, so capabilities() reports two seams.
  const submitted: any[] = []
  /** The one live Agent: its own scoped ctx, the turn verbs and the inbox. */
  const sampleAgent = {
    id: "sample-agent",
    // The scoped context now also carries the per-agent seam members the agentScope
    // probe promises (additive, t2/AC1); `get("compaction")` and every existing
    // assertion about this context are unchanged.
    ctx: {
      get: (serviceName: string) => (serviceName === "compaction" ? compaction : undefined),
      on: (_event: string, _handler: any) => () => {},
      effect: (_fn: any, _label?: string) => () => {},
      tools: { restrict: (_filter: any) => () => {} },
      // additive (0.1.7/adaptation D7): the AGENT-SCOPED prompt registry. The official
      // Agent Teams tool plugin registers its `team:policy` section through exactly this
      // member (`agent.ctx.systemPrompt.section`), so a full harness carries it and
      // `capabilities().agentPromptSection` reads true on this fixture.
      systemPrompt: { section: (_section: any) => () => { /* unregistered */ } },
    },
    // The host turn seam (dsh-agent-loop: `followup(input) => send(input, "next-turn", true)`).
    followup: (message: any) => { submitted.push(message) },
    // additive (t2/AC1): the cancellation seam (`cancel(cause, options?)`).
    cancel: (_cause: any, _options?: any) => {},
    // additive (captain ruling, extends §3): the nearest-step steer and the inbox inject
    // seams — a full harness exposes them too (behaviour covered by the surface test).
    steer: (_message: any) => {},
    inject: (_message: any) => {},
  }
  /** The live-session registry: one agent, reachable by list and by get. */
  const agents = { list: () => [sampleAgent], get: (id: string) => (id === sampleAgent.id ? sampleAgent : undefined) }
  // additive (goal plane): the host-plane goal domain. A full web/base harness mounts
  // `@deepseek-ai/dsh-goal`, so the fixture carries its `get`, and the three goal tools resolve in
  // the tool registry — which is what makes BOTH goal flags read true on a full harness. The
  // adapter's goal BEHAVIOUR is owned by test/adapter-goal-surface.test.ts.
  const goals = { get: () => undefined }
  /** The ctx handed to the adapter: a service lookup, provide() and the event bus. */
  const ctx = {
    get: (serviceName: string) => ({ tools, subagents, agentTeams, skills, agentPresets, agents, compaction, commands, llm, systemPrompt, goals } as Record<string, unknown>)[serviceName],
    on: (event: string, listener: any) => {
      if (event === "tools/post-execute") listeners.push(listener)
      if (event === "tools/pre-execute") preListeners.push(listener)
      return () => { listeners.splice(listeners.indexOf(listener), 1); preListeners.splice(preListeners.indexOf(listener), 1) }
    },
    provide: (serviceName: string, value: unknown) => { provided[serviceName] = value },
    ...overrides,
  }
  return { ctx, registered, guards, listeners, preListeners, provided, started, executed, commandsRegistered, commandDisposers, submitted }
}

describe("capabilities", () => {
  test("reports every seam of a full harness", () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    /** The capability flags of the full harness, every one of which must read true. */
    const caps = createDshAdapter(ctx).capabilities()
    expect(Object.values(caps).every((value) => value === true)).toBe(true)
  })

  test("reports absent seams without throwing", () => {
    /** An adapter over a harness with no service at all. */
    const adapter = createDshAdapter({ get: () => undefined })
    /** Its flags, which must read false without a throw. */
    const caps = adapter.capabilities()
    expect(caps.tools).toBe(false)
    expect(caps.subagentsSpawn).toBe(false)
    expect(caps.skillsProvider).toBe(false)
    expect(caps.agentPresets).toBe(false)
    expect(caps.llmCatalog).toBe(false)
  })
})

/**
 * The lines appended to a log file since a byte offset was marked, oldest first.
 *
 * @param file the log file the sink wrote into.
 * @param offset the byte offset marked before the call under test.
 * @returns the appended text split into non-empty lines; `[]` when nothing was appended.
 */
function appendedAfter(file: string, offset: number): string[] {
  try {
    return readFileSync(file, "utf8").slice(offset).split("\n").filter((line) => line !== "")
  } catch {
    return []
  }
}

/**
 * Run `run` with the row-log root pinned to a fresh SANDBOX workspace, and collect what the adapter
 * appended to that row's log.
 *
 * R5 (lane F) moved the adapter's own diagnostics off `console.warn` and into
 * `<workspace>/.mpd/logs/<row>.log`, so the two arms below read the file a user would instead of a
 * console spy that can no longer see anything. `MPD_MCP_LOG_DIR` OUTRANKS `DSH_WORKSPACE_ROOT` in the
 * sink's documented root chain, so BOTH are pinned to the sandbox — an ambient value would otherwise
 * win — and both are put back before the arm returns. The repo's own `.mpd/logs` is never touched.
 *
 * @param row the row log's base name, i.e. `<row>.log`.
 * @param run the call under test.
 * @returns the call's own result, plus the lines appended to the row log while it ran.
 */
async function inRowLog<T>(row: string, run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  /** The sandbox workspace this arm's row log is written under; removed before the arm returns. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-adapter-rowlog-"))
  /** The two env keys the sink's root chain reads, saved for the restore below. */
  const saved = { logDir: process.env.MPD_MCP_LOG_DIR, workspace: process.env.DSH_WORKSPACE_ROOT }
  process.env.MPD_MCP_LOG_DIR = sandbox
  process.env.DSH_WORKSPACE_ROOT = sandbox
  /** This row's log file under the sandbox. */
  const file = join(sandbox, ".mpd", "logs", `${row}.log`)
  /** The log's byte size BEFORE the call, so only the appended bytes are read back. */
  let offset = 0
  try { offset = statSync(file).size } catch { offset = 0 }
  try {
    return { result: await run(), lines: appendedAfter(file, offset) }
  } finally {
    if (saved.logDir === undefined) delete process.env.MPD_MCP_LOG_DIR; else process.env.MPD_MCP_LOG_DIR = saved.logDir
    if (saved.workspace === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = saved.workspace
    rmSync(sandbox, { recursive: true, force: true })
  }
}

describe("llm catalog plane", () => {
  // A ctx whose ONLY service is the model registry (the seam reads nothing else).
  const llmOnlyCtx = (llm: unknown): { get: (name: string) => unknown } => ({ get: (name: string) => (name === "llm" ? llm : undefined) })

  test("projects providers, models and reasoning from the live registry", async () => {
    /** A registry whose second provider has no models and whose first has two. */
    const llm = {
      listProviders: () => [
        { id: "deepseek-official", name: "DeepSeek Official" },
        { id: "pi-ai", name: "pi-ai" },
      ],
      listModels: async (providerId: string) => (providerId === "deepseek-official"
        ? [
            { provider: providerId, id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "fast" },
            { provider: providerId, id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
          ]
        : []),
      resolveModelInfo: async (providerId: string, modelId: string) => (modelId === "deepseek-v4-flash"
        ? {
            provider: providerId,
            id: modelId,
            name: modelId,
            reasoning: { efforts: [{ id: "high", name: "High" }, { id: "max", name: "Max", description: "deepest" }], defaultEffort: "high" },
          }
        : { provider: providerId, id: modelId, name: modelId }),
    }
    /** The projected catalog, asserted whole. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    expect(catalog).toEqual({
      providers: [
        {
          id: "deepseek-official",
          name: "DeepSeek Official",
          models: [
            {
              id: "deepseek-v4-flash",
              name: "DeepSeek V4 Flash",
              description: "fast",
              efforts: [{ id: "high", name: "High" }, { id: "max", name: "Max", description: "deepest" }],
              defaultEffort: "high",
            },
            // No reasoning block: the model still appears, with an EMPTY efforts array
            // and no defaultEffort key at all.
            { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", efforts: [] },
          ],
        },
        { id: "pi-ai", name: "pi-ai", models: [] },
      ],
      degraded: false,
    })
    expect(Object.hasOwn(catalog.providers[0].models[1], "defaultEffort")).toBe(false)
  })

  test("the fake full harness satisfies the seam", async () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    expect(adapter.capabilities().llmCatalog).toBe(true)
    /** The catalog the fixture's registry must satisfy. */
    const catalog = await adapter.llmCatalog()
    expect(catalog.degraded).toBe(false)
    expect(catalog.providers[0].models[0].defaultEffort).toBe("high")
  })

  test("a missing llm service degrades and warns exactly once", async () => {
    /** The console.warn spy: R5 says the line must NOT reach the terminal, so it is asserted empty. */
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      /** The two catalog reads this arm makes, plus the row-log lines they appended. */
      const { result, lines } = await inRowLog("mpd-dsh-adapter", async () => {
        /** An adapter over a harness with no llm service. */
        const adapter = createDshAdapter({ get: () => undefined })
        /** The first degraded read. */
        const first = await adapter.llmCatalog()
        // Second read: same degrade, but the warn-once line is NOT repeated.
        /** The second degraded read. */
        const second = await adapter.llmCatalog()
        return { first, second }
      })
      expect(result.first).toEqual({ providers: [], degraded: true })
      expect(result.second).toEqual({ providers: [], degraded: true })
      // The warn-once guard is read off the file: exactly ONE line for two reads, naming the seam.
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/llmCatalog degraded/)
      expect(lines[0]).toMatch(/llm service is unavailable/)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  test("a partial seam degrades, names the missing method, and reports capabilities false", async () => {
    /** The console.warn spy: R5 says the line must NOT reach the terminal, so it is asserted empty. */
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      /** A registry missing resolveModelInfo. */
      const partial = { listProviders: () => [], listModels: async () => [] }
      /** The seam's capability reading plus the catalog read, and the lines that read appended. */
      const { result, lines } = await inRowLog("mpd-dsh-adapter", async () => {
        /** The adapter over that partial seam. */
        const adapter = createDshAdapter(llmOnlyCtx(partial))
        /** Whether the seam reports itself usable. */
        const usable = adapter.capabilities().llmCatalog
        /** The degraded catalog the read returns. */
        const catalog = await adapter.llmCatalog()
        return { usable, catalog }
      })
      expect(result.usable).toBe(false)
      expect(result.catalog).toEqual({ providers: [], degraded: true })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("resolveModelInfo")
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  test("a rejecting provider is skipped and the rest of the catalog survives", async () => {
    /** A registry whose first provider rejects and whose second answers. */
    const llm = {
      listProviders: () => [{ id: "broken", name: "Broken" }, { id: "ok", name: "OK" }],
      listModels: async (providerId: string) => {
        if (providerId === "broken") throw new Error("provider exploded")
        return [{ provider: providerId, id: "m1", name: "M1" }]
      },
      resolveModelInfo: async (providerId: string, modelId: string) => ({ provider: providerId, id: modelId, name: modelId }),
    }
    /** The surviving catalog, degraded but not empty. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    expect(catalog.degraded).toBe(true)
    expect(catalog.providers).toEqual([{ id: "ok", name: "OK", models: [{ id: "m1", name: "M1", efforts: [] }] }])
  })

  test("a model whose resolveModelInfo rejects is skipped, not fatal", async () => {
    /** A registry whose listModels includes one unresolvable model. */
    const llm = {
      listProviders: () => [{ id: "p", name: "P" }],
      listModels: async () => [{ id: "bad", name: "Bad" }, { id: "good", name: "Good" }],
      resolveModelInfo: async (_providerId: string, modelId: string) => {
        if (modelId === "bad") throw new Error("nope")
        return { id: modelId, name: modelId }
      },
    }
    /** The catalog with the bad model skipped. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    expect(catalog.degraded).toBe(true)
    expect(catalog.providers).toEqual([{ id: "p", name: "P", models: [{ id: "good", name: "Good", efforts: [] }] }])
  })

  test("a throwing listProviders degrades instead of rejecting", async () => {
    /** A registry whose listProviders throws. */
    const llm = {
      listProviders: () => { throw new Error("registry down") },
      listModels: async () => [],
      resolveModelInfo: async () => ({}),
    }
    await expect(createDshAdapter(llmOnlyCtx(llm)).llmCatalog()).resolves.toEqual({ providers: [], degraded: true })
  })

  test("a non-array listProviders answer degrades instead of throwing", async () => {
    /** A registry whose listProviders answers a non-array. */
    const llm = { listProviders: () => undefined, listModels: async () => [], resolveModelInfo: async () => ({}) }
    await expect(createDshAdapter(llmOnlyCtx(llm)).llmCatalog()).resolves.toEqual({ providers: [], degraded: true })
  })

  test("the lazy facade proxies the seam to the mounted adapter", async () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    /** The lazy facade over the full fixture. */
    const lazy = createLazyDshAdapter(ctx, { label: "mpd-test", warn: () => {} })
    /** The catalog read through the facade. */
    const catalog = await lazy.llmCatalog()
    expect(catalog.degraded).toBe(false)
    expect(catalog.providers).toHaveLength(1)
  })
})

describe("tool plane", () => {
  test("registerTool normalizes schema, render and the (args, exec) call shape", async () => {
    /** The fixture's ctx and the definitions its registry collected. */
    const { ctx, registered } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The registration's disposer, which must remove the definition again. */
    const dispose = adapter.registerTool({
      name: "mpd_demo",
      description: "demo",
      execute: async (args: any, exec: any) => ({ args, hasExec: exec !== undefined }),
    })
    expect(registered).toHaveLength(1)
    /** The definition the registry received, in the adapter's normalized shape. */
    const definition = registered[0]
    expect(definition.parameters).toEqual({ type: "object", properties: {} })
    expect(definition.output.schema).toEqual({ type: "object", properties: {} })
    expect(typeof definition.output.render).toBe("function")
    expect(definition.output.render({}, "hello")).toEqual([{ type: "text", text: "hello" }])
    // execute is always called with an object exec, even if the harness omits it
    expect(await definition.execute(undefined, undefined)).toEqual({ args: {}, hasExec: true })
    dispose()
    expect(registered).toHaveLength(0)
  })

  test("registerTool keeps a caller-supplied schema and render", () => {
    /** The fixture's ctx and the definitions its registry collected. */
    const { ctx, registered } = fakeHarness()
    /** The caller's renderer, which must survive by identity. */
    const render = (): Array<{ type: string; text: string }> => [{ type: "text", text: "custom" }]
    createDshAdapter(ctx).registerTool({ name: "mpd_demo", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } }, output: { schema: { type: "object" }, render }, execute: () => ({}) })
    expect(registered[0].parameters.properties.a).toEqual({ type: "string" })
    expect(registered[0].output.render).toBe(render)
  })

  test("services resolve through ctx.get OR a plain ctx property", () => {
    // Cordis exposes both; unit test doubles often provide only one.
    const tools = { register: () => () => {}, guard: () => () => {}, get: () => undefined, execute: async () => ({ value: 1 }) }
    /** An adapter resolving tools from the ctx PROPERTY form. */
    const viaProperty = createDshAdapter({ tools })
    expect(viaProperty.capabilities().toolsRegister).toBe(true)
    /** An adapter resolving tools from the ctx.get form. */
    const viaGet = createDshAdapter({ get: (name: string) => (name === "tools" ? tools : undefined) })
    expect(viaGet.capabilities().toolsRegister).toBe(true)
  })

  test("registerTools registers every definition and disposes them together", () => {
    /** The fixture's ctx and the definitions its registry collected. */
    const { ctx, registered } = fakeHarness()
    /** The combined disposer for both definitions. */
    const dispose = createDshAdapter(ctx).registerTools([
      { name: "mpd_a", description: "a", execute: () => ({}) },
      { name: "mpd_b", description: "b", execute: () => ({}) },
    ])
    expect(registered.map((definition) => definition.name)).toEqual(["mpd_a", "mpd_b"])
    dispose()
    expect(registered).toHaveLength(0)
  })

  test("registerTool without a tools service fails with an actionable error", () => {
    /** An adapter over a harness with no tools service. */
    const adapter = createDshAdapter({ get: () => undefined })
    expect(() => adapter.registerTool({ name: "mpd_demo", description: "d", execute: () => ({}) })).toThrow(/harness service "tools" is unavailable/)
  })

  test("guardTool passes the exec through and installs on the tools service", () => {
    /** The fixture's ctx and the guards its registry collected. */
    const { ctx, guards } = fakeHarness()
    createDshAdapter(ctx).guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
    expect(guards).toHaveLength(1)
    expect(guards[0]({ name: "write" })).toBe("denied")
    expect(guards[0]({ name: "read" })).toBeUndefined()
    expect(guards[0](undefined)).toBeUndefined()
  })

  test("onPostToolExecute owns next() and passes the downstream decision through", async () => {
    /** The fixture's ctx and the post-execute listeners it collected. */
    const { ctx, listeners } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** One line per post-execute observation, asserted in order. */
    const seen: string[] = []
    adapter.onPostToolExecute((exec, result, downstream) => {
      seen.push(String(exec.name) + ":" + String(result.isError) + ":" + downstream.kind)
      return undefined
    })
    /** How many times the wrapper delegated to next(). */
    let nextCalls = 0
    /** The decision the wrapper returned to the harness. */
    const passed = await listeners[0]({ name: "bash" }, { isError: false }, async () => { nextCalls += 1; return { kind: "accept", content: "original" } })
    expect(nextCalls).toBe(1)
    expect(passed).toEqual({ kind: "accept", content: "original" })
    expect(seen).toEqual(["bash:false:accept"])
  })

  test("onPostToolExecute lets a listener replace the decision", async () => {
    /** The fixture's ctx and the post-execute listeners it collected. */
    const { ctx, listeners } = fakeHarness()
    createDshAdapter(ctx).onPostToolExecute((_exec, _result, downstream) => ({ ...downstream, content: [{ type: "text", text: "trimmed" }] }))
    /** The replaced decision the wrapper returned. */
    const decided = await listeners[0]({ name: "bash" }, {}, async () => ({ kind: "accept", content: "long" }))
    expect(decided.content).toEqual([{ type: "text", text: "trimmed" }])
  })

  test("onPostToolExecute is a no-op when the harness has no event bus", () => {
    /** The no-op disposer of a harness without an event bus. */
    const dispose = createDshAdapter({ get: () => undefined }).onPostToolExecute(() => undefined)
    expect(typeof dispose).toBe("function")
    expect(dispose()).toBeUndefined()
  })

  test("onPreToolExecute OWNS next(): the observer sees the gate and the gate is passed through", async () => {
    /** The fixture's ctx and the pre-execute listeners it collected. */
    const { ctx, preListeners } = fakeHarness()
    /** One line per pre-execute observation, asserted in order. */
    const seen: string[] = []
    createDshAdapter(ctx).onPreToolExecute((exec, decision) => {
      seen.push(String(exec.name) + ":" + String(decision?.kind))
    })
    /** How many times the wrapper delegated to next(). */
    let nextCalls = 0
    /** The gate decision the harness's own chain produced. */
    const gate = { kind: "allow" as const }
    /** What the wrapper returned for that gate. */
    const passed = await preListeners[0]({ name: "bash", callId: "call-1" }, async () => { nextCalls += 1; return gate })
    expect(nextCalls).toBe(1)
    // BY REFERENCE: the observer cannot build a different decision, because it never
    // produces one — the adapter returns what `next()` resolved.
    expect(passed).toBe(gate)
    expect(seen).toEqual(["bash:allow"])
  })

  test("onPreToolExecute cannot alter or veto a call: deny survives, a returned decision is ignored, a throw is contained", async () => {
    // (1) A DENY from a downstream listener must stay a DENY.
    const denyBox = fakeHarness()
    createDshAdapter(denyBox.ctx).onPreToolExecute(() => { throw new Error("observer exploded") })
    /** A downstream DENY that must survive the observer. */
    const deny = { kind: "deny" as const, reason: "read-only member" }
    expect(await denyBox.preListeners[0]({ name: "write" }, async () => deny)).toBe(deny)
    // (2) A listener that RETURNS a decision cannot install it: the wrapper discards it.
    const returnBox = fakeHarness()
    createDshAdapter(returnBox.ctx).onPreToolExecute((() => ({ kind: "deny", reason: "observer opinion" })) as any)
    /** A downstream ALLOW that must survive an observer's own opinion. */
    const allow = { kind: "allow" as const }
    expect(await returnBox.preListeners[0]({ name: "read" }, async () => allow)).toBe(allow)
    // (3) `next` absent (a harness that dispatches the event without a chain): still no throw,
    // no invented decision — the observer runs and nothing is fabricated for the caller.
    const noNext = fakeHarness()
    /** Every decision the observer was handed. */
    const observed: unknown[] = []
    createDshAdapter(noNext.ctx).onPreToolExecute((_exec, decision) => { observed.push(decision) })
    expect(await noNext.preListeners[0]({ name: "read" }, undefined)).toBeUndefined()
    expect(observed).toEqual([undefined])
  })

  test("onPreToolExecute hands the observer a FROZEN COPY: the live execution cannot be changed", async () => {
    /** The fixture's ctx and the pre-execute listeners it collected. */
    const { ctx, preListeners } = fakeHarness()
    /** The live execution object the harness would dispatch. */
    const live: any = { name: "bash", callId: "call-live-1", arguments: { command: "rm -rf /" } }
    /** The frozen copy the observer received. */
    let received: any = null
    /** Whether the observer's write attempt threw, as a frozen copy makes it. */
    let mutationThrew = false
    createDshAdapter(ctx).onPreToolExecute((exec) => {
      received = exec
      try {
        exec.name = "hijacked"
        exec.signal = undefined
      } catch {
        mutationThrew = true
      }
    })
    /** The gate decision the harness's own chain produced. */
    const gate = { kind: "allow" as const }
    expect(await preListeners[0](live, async () => gate)).toBe(gate)
    // The observer saw a copy that is not the harness's object, and its writes could not land.
    expect(received).not.toBe(live)
    expect(Object.isFrozen(received)).toBe(true)
    expect(mutationThrew).toBe(true)
    expect(live.name).toBe("bash")
    expect(live.signal).toBeUndefined()
    // The nested values the observer may READ are still the live ones (a shallow copy).
    expect(received.arguments).toBe(live.arguments)
  })

  test("onPreToolExecute is a no-op when the harness has no event bus, and capabilities() reports the seam", () => {
    /** An adapter over a harness with no event bus. */
    const absent = createDshAdapter({ get: () => undefined })
    /** The no-op disposer that seam must return. */
    const dispose = absent.onPreToolExecute(() => {})
    expect(typeof dispose).toBe("function")
    expect(dispose()).toBeUndefined()
    expect(absent.capabilities().toolsPreExecute).toBe(false)
    expect(createDshAdapter(fakeHarness().ctx).capabilities().toolsPreExecute).toBe(true)
  })

  test("hasTool + toolRuntime expose internal tool calls without raw ctx access", async () => {
    /** The fixture's ctx and the executions its runtime recorded. */
    const { ctx, executed } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    expect(adapter.hasTool("mcp__wave_mcp__prepare_session")).toBe(true)
    expect(adapter.hasTool("nope")).toBe(false)
    /** The structural view of the tool runtime. */
    const runtime = adapter.toolRuntime()
    expect(runtime.get("mcp__wave_mcp__prepare_session")).toBeDefined()
    await runtime.execute({ name: "mcp__wave_mcp__prepare_session", arguments: { out_dir: "/x" } })
    expect(executed).toHaveLength(1)
    expect(executed[0].callId).toMatch(/^mpd-/)
  })

  test("hasTool/toolRuntime().get resolve a PRESET-plane tool through the agent's OWN view, and keep the plane rule otherwise", () => {
    /** The preset-plane definition the live agent's scope answers; identity is asserted below. */
    const planDefinition = { name: "agent_teams_plan", description: "staged plan tool" }
    /** The name the HOST plane carries — a repository row, for the no-regression direction. */
    const HOST_NAME = "mcp__wave_mcp__prepare_session"
    /** The preset-plane name the host plane cannot see. */
    const PRESET_NAME = planDefinition.name
    /** Every viewing scope the agent-scoped registry was asked with, in call order. */
    const scopes: unknown[] = []
    /** The live Agent: its own view carries the preset row, and it RESTRICTED the host row away. */
    const agent = {
      id: "lead-1",
      ctx: {
        on: () => () => {},
        effect: () => () => {},
        tools: {
          restrict: () => () => {},
          execute: async () => ({}),
          /**
           * The installed registry's rule, modelled: a name resolves along the VIEWING SCOPE's
           * chain and nowhere else, and a global this scope restricted away reads as ABSENT.
           * @param name - the tool name asked for.
           * @param scope - the viewing scope, absent for the global view.
           * @returns the definition, or undefined for any other view.
           */
          get: (name: string, scope?: unknown) => {
            scopes.push(scope)
            if (scope !== agent) return undefined
            return name === PRESET_NAME ? planDefinition : undefined
          },
        },
      },
    }
    /** The ctx: a host-plane registry carrying ONLY the host row, plus the live-agent registry. */
    const ctx = {
      get: (serviceName: string) => (serviceName === "agents"
        ? { list: () => [agent] }
        : serviceName === "tools" ? { get: (name: string) => (name === HOST_NAME ? { name } : undefined) } : undefined),
      on: () => () => {},
      provide: () => {},
    }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)

    // WITH the agent: the preset-plane row resolves — the arm that goes red if the argument is dropped.
    expect(adapter.hasTool(PRESET_NAME, agent)).toBe(true)
    // The definition comes from the SAME view the probe answered from, by identity.
    expect(adapter.toolRuntime().get(PRESET_NAME, agent)).toBe(planDefinition)
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes.every((scope) => scope === agent)).toBe(true)
    // WITHOUT the agent the read is the host-plane GLOBAL view, where the preset row does not exist.
    expect(adapter.hasTool(PRESET_NAME)).toBe(false)
    expect(adapter.toolRuntime().get(PRESET_NAME)).toBeUndefined()
    // A HOST-plane row is visible to that agent too (its view contains the globals): no regression.
    expect(adapter.hasTool(HOST_NAME)).toBe(true)
    // ... unless that scope RESTRICTED it away. The agent view is AUTHORITATIVE: a restricted global
    // reads as absent rather than being resurrected by a host-plane fallback.
    expect(adapter.hasTool(HOST_NAME, agent)).toBe(false)
    // NEGATIVE CONTROL: a name that agent's own view misses stays false in both directions.
    expect(adapter.hasTool("nope", agent)).toBe(false)
    expect(adapter.toolRuntime().get("nope", agent)).toBeUndefined()
    // An object carrying NO scope at all is "no agent view available": the global read is the one
    // left to ask, so the host row still answers and the preset row still does not.
    expect(adapter.hasTool(HOST_NAME, { id: "bare-agent" })).toBe(true)
    expect(adapter.hasTool(PRESET_NAME, { id: "bare-agent" })).toBe(false)
    // A scope whose read THROWS is that answer — never a silent host-plane retry.
    /** An agent whose own view cannot answer at all. */
    const brokenAgent = {
      id: "broken-agent",
      ctx: { on: () => () => {}, effect: () => () => {}, tools: { restrict: () => () => {}, execute: async () => ({}), get: () => { throw new Error("scope exploded") } } },
    }
    expect(adapter.hasTool(HOST_NAME, brokenAgent)).toBe(false)
    expect(adapter.toolRuntime().get(HOST_NAME, brokenAgent)).toBeUndefined()
  })

  test("executeTool normalizes success, tool error, thrown error and a missing runtime", async () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    expect(await adapter.executeTool({ name: "ok", arguments: { a: 1 } })).toMatchObject({ ok: true, isError: false, value: { echo: { a: 1 } } })
    expect(await adapter.executeTool({ name: "fails" })).toMatchObject({ ok: false, isError: true, error: "denied" })
    expect(await adapter.executeTool({ name: "boom" })).toMatchObject({ ok: false, isError: true, error: "tool exploded" })
    /** An adapter over a harness with no tool runtime. */
    const bare = createDshAdapter({ get: () => undefined })
    expect(await bare.executeTool({ name: "x" })).toMatchObject({ ok: false, isError: true })
  })

  test("executeTool forwards the optional calling agent VERBATIM as exec.agent, and stays absent when not given", async () => {
    /** The fixture's ctx and the executions its runtime recorded. */
    const { ctx, executed } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The calling Agent that must arrive as exec.agent. */
    const liveAgent = { id: "captain-session", session: { header: { cwd: "/ws" } } }
    await adapter.executeTool({ name: "agent_teams_approve", arguments: { confirmation: "approve t" }, agent: liveAgent })
    await adapter.executeTool({ name: "agent_teams_approve", arguments: { confirmation: "approve t" } })
    await adapter.toolRuntime().execute({ name: "agent_teams_approve", arguments: {}, agent: liveAgent })
    expect(executed).toHaveLength(3)
    // Identity, not a copy: the adopted write tools read exec.agent.session.header.cwd.
    expect(executed[0].agent).toBe(liveAgent)
    // `agent` is declared optional (a call may omit it), and the line above pins that THIS one carried it.
    expect(executed[0].agent!.session.header.cwd).toBe("/ws")
    // Absent stays absent: every pre-existing caller keeps its exact meaning.
    expect("agent" in executed[1]).toBe(false)
    expect(executed[2].agent).toBe(liveAgent)
  })
})

describe("agent plane", () => {
  test("spawnAgent normalizes prompt, flat route and the result shape", async () => {
    /** The fixture's ctx and the spawn calls it recorded. */
    const { ctx, started } = fakeHarness()
    /** The normalized spawn answer. */
    const result = await createDshAdapter(ctx).spawnAgent({
      label: "role-oracle-1",
      prompt: "do the thing",
      provider: "deepseek-official",
      model: "deepseek-v4-pro",
      persona: "persona text",
      toolFilter: { deny: ["write"] },
      maxDepth: 1,
      outputSchema: { type: "object" },
      parent: { id: "p" },
    })
    expect(started).toHaveLength(1)
    expect(started[0].mode).toBe("spawn")
    expect(started[0].spec.prompt).toEqual([{ type: "text", text: "do the thing" }])
    expect(started[0].spec.agentOptions).toEqual({ provider: "deepseek-official", model: "deepseek-v4-pro" })
    expect(started[0].spec.toolFilter).toEqual({ deny: ["write"] })
    expect(started[0].spec.maxDepth).toBe(1)
    expect(result).toEqual({ output: "done", structured: { ok: true }, stopReason: "end_turn" })
  })

  test("spawnAgent accepts pre-built prompt blocks and agentOptions", async () => {
    /** The fixture's ctx and the spawn calls it recorded. */
    const { ctx, started } = fakeHarness()
    /** Pre-built prompt blocks, which must reach the spawn by identity. */
    const blocks = textBlock("block prompt")
    await createDshAdapter(ctx).spawnAgent({ label: "l", prompt: blocks, agentOptions: { provider: "p", model: "m" } })
    expect(started[0].spec.prompt).toBe(blocks)
    expect(started[0].spec.agentOptions).toEqual({ provider: "p", model: "m" })
  })

  test("spawnAgent tolerates a harness that returns no result", async () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    ctx.get = ((serviceName: string) => (serviceName === "subagents" ? { start: async () => ({}) } : undefined)) as any
    expect(await createDshAdapter(ctx).spawnAgent({ label: "l", prompt: "p" })).toEqual({ output: "", structured: undefined, stopReason: null })
  })

  test("spawnAgent without a subagent service fails with an actionable error", async () => {
    await expect(createDshAdapter({ get: () => undefined }).spawnAgent({ label: "l", prompt: "p" })).rejects.toThrow(/harness service "subagents" is unavailable/)
  })
})

describe("skill + preset plane", () => {
  test("skill provider registration, catalog read and body load", async () => {
    /** The fixture's ctx and the services provide() received. */
    const { ctx, provided } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The provider object that must reach the registry verbatim. */
    const provider = { name: "mpd-bundle", list: async () => [], get: async () => undefined }
    adapter.registerSkillProvider(provider)
    expect(provided.skills).toBe(provider)
    expect(await adapter.listSkills()).toEqual([{ name: "svn-master", source: "bundled" }])
    expect(await adapter.loadSkill("svn-master")).toEqual({ name: "svn-master", content: "body" })
  })

  test("skill calls without a skills service fail with actionable errors", async () => {
    /** An adapter over a harness with no skills service. */
    const adapter = createDshAdapter({ get: () => undefined })
    expect(() => adapter.registerSkillProvider({})).toThrow(/harness service "skills" is unavailable/)
    await expect(adapter.listSkills()).rejects.toThrow(/harness service "skills" is unavailable/)
  })

  test("resolvePreset returns a normalized preset record", async () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    // The row model: the definition is keyed by `config.id` and there is no path.
    expect(await createDshAdapter(ctx).resolvePreset("mpd")).toEqual({ id: "mpd" })
    expect(await createDshAdapter(ctx).resolvePreset("mpd")).toEqual(await createDshAdapter(ctx).resolvePreset("mpd"))
  })

  test("resolvePreset still normalizes the OPTIONAL path/trust a host build may send", async () => {
    /** A host build that still sends path/trust with the preset row. */
    const legacy = {
      get: (serviceName: string) => (serviceName === "agentPresets"
        ? { resolve: async (id: string) => ({ id, path: "/bundle/presets/" + id, trust: "system" }) }
        : undefined),
    }
    expect(await createDshAdapter(legacy).resolvePreset("mpd")).toEqual({ id: "mpd", path: "/bundle/presets/mpd", trust: "system" })
    // A broken row is reported, never thrown away.
    const broken = { get: (serviceName: string) => (serviceName === "agentPresets" ? { resolve: async (id: string) => ({ id, broken: "row(s) did not activate" }) } : undefined) }
    expect(await createDshAdapter(broken).resolvePreset("mpd")).toEqual({ id: "mpd", broken: "row(s) did not activate" })
  })
})

describe("command plane (AGENTS.md §6: the ONE sanctioned registration path)", () => {
  test("registerCommand passes the definition through and hands back the host's own disposer", async () => {
    /** The fixture's ctx plus its command registry and the disposers it returned. */
    const { ctx, commandsRegistered, commandDisposers } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The command handler, which must receive a stable invocation shape. */
    const handler = async (invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> => ({ kind: "success", text: "ran " + String(invocation.rawInput ?? "") })
    /** The registration's disposer, asserted by identity below. */
    const dispose = adapter.registerCommand({
      name: "ulw",
      description: "run one ULW loop on an objective",
      input: { hint: "<objective>" },
      handler,
    })
    expect(commandsRegistered).toHaveLength(1)
    expect(commandsRegistered[0].name).toBe("ulw")
    expect(commandsRegistered[0].description).toBe("run one ULW loop on an objective")
    expect(commandsRegistered[0].input).toEqual({ hint: "<objective>" })
    // The handler is wrapped for a stable call shape, so the seam still answers when a
    // harness build passes no invocation at all.
    expect(await commandsRegistered[0].handler({ rawInput: " ship it" })).toEqual({ kind: "success", text: "ran  ship it" })
    expect(await commandsRegistered[0].handler()).toEqual({ kind: "success", text: "ran " })
    // Identity, not just callability: the registry's disposer is the one returned.
    expect(dispose).toBe(commandDisposers[0])
    dispose()
    expect(commandsRegistered).toHaveLength(0)
  })

  test("a stub register returning a NON-function still yields a safe no-op disposer", () => {
    // A test double (and any registry that forgets to return its effect disposer) can
    // answer with anything — e.g. the codegraph stub returns Array.push()'s number.
    const adapter = createDshAdapter({ get: (serviceName: string) => (serviceName === "commands" ? { register: () => 42 } : undefined) })
    /** The disposer, assigned inside the assertion callback below. */
    let dispose: (() => void) | undefined
    expect(() => { dispose = adapter.registerCommand({ name: "ulw", description: "d", handler: () => ({ kind: "success" }) }) }).not.toThrow()
    expect(typeof dispose).toBe("function")
    expect(() => dispose?.()).not.toThrow()
  })

  test("an absent seam is a no-op disposer plus two false capability flags, never a throw", () => {
    /** An adapter over a harness with no command registry. */
    const adapter = createDshAdapter({ get: () => undefined })
    /** Its flags, which must both read false. */
    const caps = adapter.capabilities()
    expect(caps.commands).toBe(false)
    expect(caps.commandsRegister).toBe(false)
    /** The no-op disposer, assigned inside the assertion callback below. */
    let dispose: (() => void) | undefined
    expect(() => { dispose = adapter.registerCommand({ name: "ulw", description: "d", handler: () => ({ kind: "success" }) }) }).not.toThrow()
    expect(typeof dispose).toBe("function")
    expect(() => dispose?.()).not.toThrow()
  })

  test("apply() never throws when the composition has no command registry", () => {
    /** The services provide() received, asserted after apply(). */
    const provided: Record<string, unknown> = {}
    /** A minimal ctx: no services, but a provide() the row writes through. */
    const ctx = { get: () => undefined, provide: (serviceName: string, value: unknown) => { provided[serviceName] = value } }
    expect(() => apply(ctx)).not.toThrow()
    // The row still provides its adapter, and that adapter's command seam is a no-op
    // in this composition rather than a failure.
    const mounted = provided[SERVICE_NAME] as ReturnType<typeof createDshAdapter>
    expect(mounted).toBeDefined()
    /** The mounted adapter's command seam, a no-op in this composition. */
    const dispose = mounted.registerCommand({ name: "ulw", description: "d", handler: () => ({ kind: "success" }) })
    expect(() => dispose()).not.toThrow()
  })

  test("capabilities() reports a present registry, and distinguishes one without register()", () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    /** The flags of a harness whose command registry is usable. */
    const present = createDshAdapter(ctx).capabilities()
    expect(present.commands).toBe(true)
    expect(present.commandsRegister).toBe(true)
    // Present but unusable: the service exists, the registration seam does not.
    const partial = createDshAdapter({ get: (serviceName: string) => (serviceName === "commands" ? { list: () => [] } : undefined) }).capabilities()
    expect(partial.commands).toBe(true)
    expect(partial.commandsRegister).toBe(false)
  })
})

describe("message plane (user-role session injection)", () => {
  test("userMessage builds the host's message contract, frozen at every level", () => {
    /** The message built by this adapter's own constructor. */
    const message = userMessage({ text: "run /ulw ship the wave" })
    expect(message.role).toBe("user")
    expect(message.content).toEqual([{ type: "text", text: "run /ulw ship the wave" }])
    expect(message.source).toEqual({ kind: "user" })
    expect(message.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(true)
    expect(() => { (message as { role?: string }).role = "system" }).toThrow()
  })

  test("a producer tag wins over the default kind, and every call mints a fresh id", () => {
    /** A message whose producer tag must win over the default kind. */
    const injected = userMessage({ text: "directive", source: { kind: "mpd-ulw", reason: "activation-directive" } })
    expect(injected.source).toEqual({ kind: "mpd-ulw", reason: "activation-directive" })
    expect(userMessage({ text: "a" }).id).not.toBe(userMessage({ text: "a" }).id)
  })

  test("the field set matches the vendored host constructor, and only the identity differs", () => {
    /** The text and producer tag shared by both constructors. */
    const input = { text: "same text", source: { kind: "plugin", plugin: "mpd-ulw" } }
    /** This adapter's message. */
    const mine = userMessage(input)
    /** The vendored host constructor's message, compared field by field. */
    const reference = createUserMessage({ content: [{ type: "text", text: input.text }], source: input.source })
    expect(Object.keys(mine).sort()).toEqual(Object.keys(reference).sort())
    /** This adapter's id, excluded from the field comparison. */
    const { id: _mine, ...mineRest } = mine
    /** The host's id, excluded from the field comparison. */
    const { id: _reference, ...referenceRest } = reference
    expect(mineRest).toEqual(referenceRest)
    expect(typeof mine.id).toBe("string")
  })

  test("the adapter surface exposes it, and the source imports no host package by bare specifier", () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    expect(createDshAdapter(ctx).userMessage({ text: "x" }).role).toBe("user")
    /** The adapter source, grepped for a bare host-package import. */
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/(?:from|import)\s*\(?\s*["']@deepseek-ai\//u)
  })
})

describe("turn plane (the submission surface a command handler needs)", () => {
  test("a registered command handler submits through its invocation, and the host's invocation is not mutated", async () => {
    /** The fixture's ctx, its command registry and the submitted messages. */
    const { ctx, commandsRegistered, submitted } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The invoking Agent whose followup receives the submission. */
    const agent = { id: "invoking-agent", followup: (message: unknown) => { submitted.push(message) } }
    /** The user-role directive the handler submits. */
    const directive = userMessage({ text: "run the ULW loop", source: { kind: "plugin", plugin: "mpd-ulw" } })
    adapter.registerCommand({
      name: "ulw",
      description: "start one ULW run",
      handler: (invocation) => {
        /** Whether the submission reached the agent's turn seam. */
        const reached = invocation.submit?.(directive) ?? false
        return { kind: reached ? "success" : "error", text: reached ? "started" : "no turn seam" }
      },
    })
    /** The host's own invocation object, which must not be mutated. */
    const hostInvocation = { rawInput: " ship it", agent }
    expect(await commandsRegistered[0].handler(hostInvocation)).toEqual({ kind: "success", text: "started" })
    expect(submitted).toEqual([directive])
    // The plugin got a COPY: the object the host handed over still carries no `submit`.
    expect("submit" in hostInvocation).toBe(false)
    expect(Object.keys(hostInvocation).sort()).toEqual(["agent", "rawInput"])
  })

  test("submitUserTurn reaches the agent's followup, and every absent or broken surface is a safe no-op", () => {
    /** The fixture's ctx and the messages its sample agent received. */
    const { ctx, submitted } = fakeHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The directive submitted through every path below. */
    const message = userMessage({ text: "directive" })
    expect(adapter.submitUserTurn({ id: "live", followup: (input: unknown) => { submitted.push(input) } }, message)).toBe(true)
    expect(submitted).toEqual([message])
    expect(adapter.submitUserTurn({ id: "no-followup" }, message)).toBe(false)
    expect(adapter.submitUserTurn(undefined, message)).toBe(false)
    expect(adapter.submitUserTurn(null, message)).toBe(false)
    expect(adapter.submitUserTurn("not-an-agent", message)).toBe(false)
    // A rejecting driver is reported, never thrown into the caller.
    expect(adapter.submitUserTurn({ followup: () => { throw new Error("driver refused") } }, message)).toBe(false)
  })

  test("capabilities().turnSubmit is truthful for a present and an absent agent surface", () => {
    /** The full fixture's ctx. */
    const { ctx } = fakeHarness()
    expect(createDshAdapter(ctx).capabilities().turnSubmit).toBe(true)
    // A live agent whose surface has no followup, and no registry at all.
    const withoutFollowup = { get: (serviceName: string) => (serviceName === "agents" ? { list: () => [{ id: "bare-agent" }] } : undefined) }
    expect(createDshAdapter(withoutFollowup).capabilities().turnSubmit).toBe(false)
    expect(createDshAdapter({ get: () => undefined }).capabilities().turnSubmit).toBe(false)
    // The absent-surface path a caller degrades on: a boolean, not a throw.
    expect(createDshAdapter(withoutFollowup).submitUserTurn({ id: "bare-agent" }, userMessage({ text: "x" }))).toBe(false)
  })
})

describe("row entry", () => {
  test("apply provides the mpdDsh service", () => {
    /** The fixture's ctx and the services provide() received. */
    const { ctx, provided } = fakeHarness()
    apply(ctx)
    expect(provided[SERVICE_NAME]).toBeDefined()
    expect(typeof (provided[SERVICE_NAME] as any).registerTool).toBe("function")
  })

  test("decision helpers use the harness feedback key", () => {
    expect(decision.accept("x")).toEqual({ kind: "accept", content: "x" })
    expect(decision.accept()).toEqual({ kind: "accept" })
    expect(decision.block("nope")).toEqual({ kind: "block", feedback: "nope" })
  })
})

describe("settings plane (t34 §2.1 / §1.2, captain ruling 1)", () => {
  // MEASURED host order inside one synchronous write(): bumpRevision
  // (settings/document-updated) THEN commit (settings/updated(ns,next,prev,source))
  // — @deepseek-ai/dsh-settings/lib/index.ts:466-467 and :497-498.
  function settingsHarness(settings: Record<string, unknown>): {
    /** The ctx handed to the adapter: a settings service plus the host event bus. */
    ctx: { get(serviceName: string): unknown; on(event: string, listener: (...args: unknown[]) => unknown): () => void }
    /** Fire one event at every listener registered for it, over a snapshot. */
    emit(event: string, ...args: unknown[]): void
    /** Replay the host's own write order: document-updated first, then updated. */
    write(ns: string, revision: number, source: string | undefined, next?: unknown, prev?: unknown): void
  } {
    /** Listeners per event name, as a set so a duplicate registration collapses. */
    const handlers = new Map<string, Set<(...args: any[]) => unknown>>()
    /** The ctx handed to the adapter: a settings service plus the event bus. */
    const ctx = {
      get: (serviceName: string) => (serviceName === "settings" ? settings : undefined),
      on: (event: string, listener: (...args: any[]) => unknown) => {
        /** The listener set for this event, created on first use. */
        const set = handlers.get(event) ?? new Set()
        set.add(listener)
        handlers.set(event, set)
        return () => { set.delete(listener) }
      },
    }
    /** Fire one event at every listener registered for it, over a snapshot. */
    const emit = (event: string, ...args: any[]): void => { for (const listener of [...(handlers.get(event) ?? [])]) listener(...args) }
    /** Replay the host's own write order: document-updated first, then updated. */
    const write = (ns: string, revision: number, source: string | undefined, next: unknown = {}, prev: unknown = {}): void => {
      emit("settings/document-updated", ns, revision)
      emit("settings/updated", ns, next, prev, source)
    }
    return { ctx, emit, write }
  }

  test("the source of the SAME change is delivered, not the previous one's", async () => {
    /** The settings fixture's ctx and its write driver. */
    const { ctx, write } = settingsHarness({})
    /** Every `(revision, source)` pair the listener received. */
    const seen: Array<[number | undefined, string | undefined]> = []
    createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", (revision, source) => { seen.push([revision, source]) })
    write("mpd", 1, "provider")
    await new Promise((resolve) => setTimeout(resolve, 0))
    write("mpd", 2, "update")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([[1, "provider"], [2, "update"]])
  })

  test("a raw-section change whose RESOLVED value did not change reports source undefined", async () => {
    /** The settings fixture's ctx and its emit driver. */
    const { ctx, emit } = settingsHarness({})
    /** Every `(revision, source)` pair the listener received. */
    const seen: Array<[number | undefined, string | undefined]> = []
    createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", (revision, source) => { seen.push([revision, source]) })
    emit("settings/document-updated", "mpd", 7)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([[7, undefined]])
  })

  test("another namespace is ignored, and the disposer stops delivery", async () => {
    /** The settings fixture's ctx and its write driver. */
    const { ctx, write } = settingsHarness({})
    /** Every pair the listener received, which must stay empty here. */
    const seen: unknown[] = []
    /** The subscription's disposer, exercised below. */
    const off = createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", (revision, source) => { seen.push([revision, source]) })
    write("other", 1, "update")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([])
    off()
    write("mpd", 2, "update")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([])
  })

  test("a throwing listener never escapes into the host's emit", async () => {
    /** The settings fixture's ctx and its write driver. */
    const { ctx, write } = settingsHarness({})
    createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", () => { throw new Error("bridge exploded") })
    expect(() => write("mpd", 1, "update")).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test("settingsReader describes the namespace and degrades when it is absent", () => {
    /** The descriptor row the service reports for the namespace. */
    const described = { ns: "mpd", value: { ulw: { maxRounds: 6 } }, revision: 4, user: { ulw: { maxRounds: 6 } }, base: {}, applies: "restart" }
    /** A harness whose settings service serves AND describes the namespace. */
    const full = settingsHarness({ get: (ns: string) => (ns === "mpd" ? { ulw: { maxRounds: 6 } } : undefined), describe: () => [described] })
    /** The reader over that namespace. */
    const reader = createDshAdapter(full.ctx).settingsReader("mpd")
    expect(reader?.get()).toEqual({ ulw: { maxRounds: 6 } })
    expect(reader?.describe()).toEqual({ value: described.value, revision: 4, user: described.user, base: {}, applies: "restart" })
    /** A reader over a harness that knows nothing about the namespace. */
    const absent = createDshAdapter(settingsHarness({}).ctx).settingsReader("mpd")
    expect(absent?.get()).toBeUndefined()
    expect(absent?.describe()).toBeUndefined()
    expect(createDshAdapter({ get: () => undefined }).settingsReader("mpd")).toBeUndefined()
  })

  test("settingsMutate writes through the service with the revision fence", async () => {
    /** Every mutate call, as `{ns, ops, revision}`. */
    const calls: any[] = []
    /** A settings service that records writes and rejects the `boom` op. */
    const settings = {
      /** Record the write, and reject the `boom` op the way the host rejects a stale revision. */
      mutate: async (ns: string, ops: any, revision?: number): Promise<void> => {
        calls.push({ ns, ops, revision })
        if (ops[0].path[0] === "boom") {
          /** The revision-conflict error the host raises on a stale revision. */
          const conflict = new Error("settings conflict for \"mpd\"")
          conflict.name = "SettingsConflictError"
          throw conflict
        }
      },
    }
    /** The adapter under test. */
    const adapter = createDshAdapter(settingsHarness(settings).ctx)
    expect(await adapter.settingsMutate("mpd", [{ op: "unset", path: ["ulw", "maxRounds"] }], 4)).toEqual({ ok: true })
    expect(calls[0]).toEqual({ ns: "mpd", ops: [{ op: "unset", path: ["ulw", "maxRounds"] }], revision: 4 })
    expect(await adapter.settingsMutate("mpd", [{ op: "set", path: ["boom"], value: 1 }], 5)).toEqual({ ok: false, error: 'settings conflict for "mpd"', conflict: true })
    expect(await createDshAdapter({ get: () => undefined }).settingsMutate("mpd", [])).toEqual({ ok: false, error: "settings service is unavailable" })
  })
})

describe("workspaceRootsAll(): the design's stated-unverified facts (§A.1, measured here)", () => {
  /** Build one live-agent row whose session carries the given cwd. */
  const agent = (cwd: string | undefined): { id: string; ctx: Record<string, unknown>; session: { header: { cwd?: string } } } => ({ id: "a-" + String(Math.random()), ctx: {}, session: { header: cwd === undefined ? {} : { cwd } } })

  test("duplicates collapse, relative cwds resolve, a cwd-less agent is skipped, no registry is []", () => {
    /** The registry the adapter folds: duplicates, a relative path and a bare row. */
    const agents = {
      list: () => [
        agent("/ws/one"),
        agent("/ws/one"),          // duplicate: ONE candidate, never two
        agent("/ws/one/../one"),   // same directory through a different spelling
        agent("/ws/two"),
        agent(undefined),          // a session with no cwd cannot be a candidate
      ],
    }
    /** The deduplicated, resolved roots, in registration order. */
    const roots = createDshAdapter({ get: (n: string) => (n === "agents" ? agents : undefined) }).workspaceRootsAll()
    // The adapter RESOLVES each cwd, so the expectation is the resolver's own answer on this
    // platform (win32 turns "/ws/one" into "C:\ws\one"); a POSIX literal would pin the separator.
    expect(roots).toEqual([resolve("/ws/one"), resolve("/ws/two")])
    // the adapter does NOT touch the filesystem: a deleted cwd still yields its path, which the
    // writer then reports per root (E11) — it is never silently dropped or guessed around
    const deleted = createDshAdapter({ get: (n: string) => (n === "agents" ? { list: () => [agent("/ws/gone")] } : undefined) }).workspaceRootsAll()
    expect(deleted).toEqual([resolve("/ws/gone")])
    expect(createDshAdapter({ get: () => undefined }).workspaceRootsAll()).toEqual([])
    expect(createDshAdapter({ get: () => ({ list: () => "not-an-array" }) }).workspaceRootsAll()).toEqual([])
    expect(createDshAdapter({ get: () => ({ list: () => { throw new Error("registry exploded") } }) }).workspaceRootsAll()).toEqual([])
  })
})

// ── the PRE hook against the REAL cordis waterfall, and a REAL tool call ──────
//
// The fake harness above proves the wrapper's SHAPE. These tests prove its CONTRACT on the
// implementation that actually dispatches it: the vendored `@deepseek-ai/cordis` EventsService
// (`waterfall` = `(cbs.shift() ?? inner)(...args)` with `next` appended), which is what makes a
// non-delegating listener able to VETO the chain — the exact failure mode this hook must not
// have. A NEGATIVE CONTROL re-enacts the veto shape, so the assertion is falsifiable.
describe("onPreToolExecute on the real cordis waterfall (observe-only, proven by a real call)", () => {
  /** Run one dispatch through the real waterfall and a REAL child process tool body. */
  async function dispatch(install: (adapter: ReturnType<typeof createDshAdapter>) => void, ms: number): Promise<{
    /** The gate the real waterfall resolved for this dispatch. */
    gate: { kind: string }
    /** The child process outcome, or null when the gate did not allow the call. */
    result: { status: number | null; stdout: string; stderr: string; pid: boolean } | null
    /** Wall-clock milliseconds the child really took (absent on the non-allowed path). */
    elapsed?: number
    /** Epoch milliseconds at which the tool body started (absent on the non-allowed path). */
    started?: number
    /** The post-execute decision's kind (absent on the non-allowed path). */
    accepted?: string
    /** The post-execute value, defaulting to the child result. */
    value?: unknown
  }> {
    /** A real vendored cordis Context: the dispatcher under test. */
    const ctx = realContext()
    /** The adapter over that real context. */
    const adapter = createDshAdapter(ctx as any)
    install(adapter)
    /** The execution the waterfall dispatches. */
    const exec = { name: "bash", callId: "call-real-1", arguments: { command: "sleep " + ms + "ms" } }
    /** The gate the real waterfall resolved. */
    const gate = await ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" as const }))
    if (gate.kind !== "allow") return { gate, result: null }
    // The tool body: a GENUINE child process that really takes `ms` wall-clock milliseconds.
    const started = Date.now()
    /** The genuine child process that burns the wall clock. */
    const child = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, " + ms + ")"], { encoding: "utf8" })
    /** Wall-clock milliseconds the child really took. */
    const elapsed = Date.now() - started
    /** The child's outcome, in the shape the post-execute step receives. */
    const result = { status: child.status, stdout: child.stdout, stderr: child.stderr, pid: child.pid !== undefined }
    // The harness's post-execute waterfall, driven the same way.
    const decision = await ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" as const }))
    return { gate, result, elapsed, started, accepted: decision.kind, value: (decision as any).value ?? result }
  }

  test("a REAL tool call returns the same result with and without the hook, and the gate is unchanged", async () => {
    /** The same call with no observer installed. */
    const without = await dispatch(() => {}, 250)
    /** What the observer saw, or null when it never ran. */
    let observed: { kind: string | undefined; execName: string | undefined } | null = null
    /** Epoch milliseconds at which the observer ran. */
    let stampedAt = 0
    /** The same call with the observe-only hook installed. */
    const with1 = await dispatch((adapter) => {
      adapter.onPreToolExecute((exec, decision) => {
        stampedAt = Date.now()
        observed = { kind: decision?.kind, execName: exec.name }
      })
    }, 250)
    // Same gate, same real command outcome, same accepted decision.
    expect(without.gate).toEqual({ kind: "allow" })
    expect(with1.gate).toEqual({ kind: "allow" })
    expect(with1.result).toEqual(without.result)
    expect(with1.result?.status).toBe(0)
    expect(with1.accepted).toBe("accept")
    // The command is REAL (it really burned the wall clock it was told to), and the observer
    // ran BEFORE it: that is the whole point of a pre-dispatch stamp.
    expect(with1.elapsed).toBeGreaterThanOrEqual(200)
    // Only the gate-allowing branch reaches here, so the timestamp IS present; the compiler cannot
    // see that through expect(), and the assertion above pins the call's real wall-clock cost.
    expect(stampedAt).toBeLessThanOrEqual(with1.started!)
    expect(observed).not.toBeNull()
    expect((observed as any).kind).toBe("allow")
    expect((observed as any).execName).toBe("bash")
  })

  test("a downstream DENY still denies: the observer cannot upgrade a blocked call", async () => {
    /** A real cordis Context for the deny path. */
    const ctx = realContext()
    /** Every gate kind the observer saw. */
    const seen: string[] = []
    createDshAdapter(ctx as any).onPreToolExecute((_exec, decision) => { seen.push(String(decision?.kind)) })
    /** The DENY the real waterfall must return unchanged. */
    const gate = await ctx.waterfall(ctx, "tools/pre-execute", { name: "write" }, () => Promise.resolve({ kind: "deny" as const, reason: "scope" }))
    expect(gate).toEqual({ kind: "deny", reason: "scope" })
    expect(seen).toEqual(["deny"])
  })

  test("NEGATIVE CONTROL: a listener that returns without delegating DOES veto the gate", async () => {
    // The retired `agent/pre-step` shape, re-enacted on `tools/pre-execute`: this is what the
    // adapter's wrapper exists to prevent, and it proves the cordis semantics above are real.
    const ctx = realContext()
    ctx.on("tools/pre-execute", (() => ({ kind: "allow", hijacked: true })) as any)
    /** The gate the vetoing listener installed. */
    const gate = await ctx.waterfall(ctx, "tools/pre-execute", { name: "bash" }, () => Promise.resolve({ kind: "allow" as const }))
    expect(gate).toEqual({ kind: "allow", hijacked: true })
    // …while the ADAPTER's own hook, registered on the same event, passes the harness's
    // decision through untouched.
    const clean = realContext()
    createDshAdapter(clean as any).onPreToolExecute(() => {})
    /** The gate the ADAPTER's hook passes through untouched. */
    const passed = await clean.waterfall(clean, "tools/pre-execute", { name: "bash" }, () => Promise.resolve({ kind: "allow" as const }))
    expect(passed).toEqual({ kind: "allow" })
  })
})

describe("lazy mpdDsh resolution (T-50)", () => {
  /**
   * A ctx whose provider activation the test controls, mirroring the vendored cordis semantics:
   * `get(name, true)` answers only for an ACTIVE provider, `get(name, false)` sees the
   * registration regardless of fiber state (measured in the real-cordis test below).
   */
  function pendingCtx(): {
    /** A ctx whose `get` mirrors the vendored cordis strict/non-strict semantics. */
    ctx: { get(name: string, strict?: boolean): unknown }
    /** The service the provider will register when it activates. */
    mounted: unknown
    /** The provider's activation state and the strict-read counter. */
    state: { active: boolean; provided: boolean; strictReads: number }
  } {
    /** The service the provider will register. */
    const mounted = { marker: "mounted", capabilities: () => ({ probe: "mounted" }) } as any
    /** The provider's activation state and the strict-read counter. */
    const state = { active: false, provided: true, strictReads: 0 }
    /** A ctx whose `get` mirrors the vendored cordis strict/non-strict semantics. */
    const ctx = {
      /** Answer the registered service, but only to a STRICT read once it is ACTIVE. */
      get(name: string, strict: boolean = true): unknown {
        if (name !== SERVICE_NAME) return undefined
        if (!state.provided) return undefined
        if (strict) {
          state.strictReads += 1
          return state.active ? mounted : undefined
        }
        return mounted
      },
    }
    return { ctx, mounted, state }
  }

  test("a transient miss is served temporarily, warned honestly, and is NOT cached for the session", () => {
    /** The pending fixture's ctx and its mutable activation state. */
    const { ctx, state } = pendingCtx()
    /** The warning lines the facade emitted. */
    const lines: string[] = []
    /** The lazy facade under test. */
    const dsh = createLazyDshAdapter(ctx, { label: "mpd-test", warn: (line) => lines.push(line) })
    // First use lands inside the window: the temporary adapter answers, so the mounted marker is absent.
    expect((dsh as any).marker).toBeUndefined()
    expect(lines.filter((line) => line.includes("NOT YET ACTIVE")).length).toBe(1)
    // The old diagnosis ("row missing / fix the ROW ORDER") is GONE for this case — it is the wrong fix.
    expect(lines.some((line) => line.includes("ROW ORDER"))).toBe(false)
    expect(dshAdapterIdentity(ctx)).toBe(ADAPTER_IDENTITY_PENDING)
    // The provider activates: the SAME facade (no re-creation, no re-apply) now reaches the mounted adapter.
    state.active = true
    expect((dsh as any).marker).toBe("mounted")
    expect(dshAdapterIdentity(ctx)).toBe(ADAPTER_IDENTITY_MOUNTED)
    // …and the warning stayed exactly one line per row.
    expect(lines.filter((line) => line.includes("NOT YET ACTIVE")).length).toBe(1)
  })

  test("a strict success is cached; a miss is retried on every use", () => {
    /** The pending fixture's ctx and its mutable activation state. */
    const { ctx, state } = pendingCtx()
    /** The lazy facade under test. */
    const dsh = createLazyDshAdapter(ctx, { label: "mpd-test", warn: () => {} })
    dsh.capabilities()
    /** Strict reads after the first miss, compared below. */
    const afterFirstMiss = state.strictReads
    dsh.capabilities()
    // A miss must NOT pin the fallback: the next use probes again (this is the whole fix).
    expect(state.strictReads).toBeGreaterThan(afterFirstMiss)
    state.active = true
    dsh.capabilities()
    /** Strict reads after the resolution succeeded. */
    const afterResolve = state.strictReads
    dsh.capabilities()
    dsh.capabilities()
    // Once a strict read SUCCEEDS the result is stable: no further probes.
    expect(state.strictReads).toBe(afterResolve)
  })

  test("a clean boot never warns and reports the mounted identity", () => {
    /** The pending fixture's ctx and its mutable activation state. */
    const { ctx, state } = pendingCtx()
    state.active = true
    /** The warning lines the facade emitted. */
    const lines: string[] = []
    /** The lazy facade under test. */
    const dsh = createLazyDshAdapter(ctx, { label: "mpd-test", warn: (line) => lines.push(line) })
    // The proxied fixture answers a MARKER object, not a real capability set; `as unknown` states
    // that deliberately instead of pretending the marker is a DshCapabilities value.
    expect(dsh.capabilities() as unknown).toEqual({ probe: "mounted" })
    expect(lines).toEqual([])
    expect(dshAdapterIdentity(ctx)).toBe(ADAPTER_IDENTITY_MOUNTED)
  })

  test("a provably absent provider keeps the row-order hint — and only that case does", () => {
    /** The pending fixture's ctx and its mutable activation state. */
    const { ctx, state } = pendingCtx()
    state.provided = false
    /** The warning lines the facade emitted. */
    const lines: string[] = []
    /** The lazy facade under test. */
    const dsh = createLazyDshAdapter(ctx, { label: "mpd-test", warn: (line) => lines.push(line) })
    dsh.capabilities()
    expect(dshAdapterIdentity(ctx)).toBe(ADAPTER_IDENTITY_FALLBACK)
    expect(lines.filter((line) => line.includes("ROW ORDER")).length).toBe(1)
    expect(lines.some((line) => line.includes("NOT YET ACTIVE"))).toBe(false)
  })

  test("REAL vendored cordis: the sibling-apply window exists and the SAME facade crosses it", async () => {
    // The code-path justification for T-50, measured on the vendored cordis itself: a provider that
    // has already called provide() is NOT ACTIVE while a SIBLING row's apply runs (the loader applies
    // siblings concurrently). In that window a strict read answers `undefined` while a non-strict read
    // already sees the value — the old eager resolution cached that transient `undefined` as a private
    // adapter for the whole session and blamed the ROW ORDER.
    const root = realContext()
    /** The warning lines the facade emitted. */
    const lines: string[] = []
    /** The provider row that will provide the shared service. */
    const provider = root.plugin({
      name: "t50-provider",
      /** Provide the shared service from inside this row's own apply. */
      apply(inner: any): void {
        inner.provide(SERVICE_NAME, { marker: "mounted" })
      },
    } as any)
    /** The facade built inside the sibling-apply window. */
    let facade: ReturnType<typeof createLazyDshAdapter> | undefined
    /** What the facade answered while the provider was not ACTIVE. */
    let markerDuringApply: unknown
    /** The sibling row that builds the facade during its own apply. */
    const consumer = root.plugin({
      name: "t50-consumer",
      /** Build the facade from the sibling's ctx, inside the concurrent-apply window. */
      apply(inner: any): void {
        expect((provider as any).state).not.toBe(2)
        facade = createLazyDshAdapter(inner, { label: "mpd-cordis-test", warn: (line) => lines.push(line) })
        markerDuringApply = (facade as any).marker
      },
    } as any)
    await (consumer as any)
    expect((provider as any).state).toBe(2)
    // Served by the temporary adapter inside the window, diagnosed as a not-yet-active provider…
    expect(markerDuringApply).toBeUndefined()
    expect(lines.some((line) => line.includes("NOT YET ACTIVE"))).toBe(true)
    expect(lines.some((line) => line.includes("ROW ORDER"))).toBe(false)
    // …and the SAME facade reaches the mounted adapter once the provider is ACTIVE.
    expect((facade as any).marker).toBe("mounted")
  })
})
