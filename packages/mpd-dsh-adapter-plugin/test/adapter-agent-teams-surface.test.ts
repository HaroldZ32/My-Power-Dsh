// The agent-teams surface of mpd-dsh-adapter (contract §3, rows 1–12).
//
// Every assertion here is about the FROZEN contract the adopted agent-teams plugin
// depends on when it reaches the harness through this adapter:
//   * `registerHostTool` forwards VERBATIM (Object.is end to end, nothing rebuilt);
//   * the subagent/provider/llm/prompt-section seams are thin, receiver-bound forwarders
//     whose missing-seam degrade is the table's (THROW / undefined / []);
//   * `agentScope(agent).context` IS `agent.ctx` (identity, never a projection) and its
//     `on`/`effect`/`tools.restrict` forward to that same object;
//   * the turn engine THROWS (`startAgentTurn`/`cancelAgentTurn`) where `submitUserTurn`
//     swallows into a boolean — the D9 distinction the adopted call sites rely on.
//
// The double below records the RECEIVER of every call, so a lost `this` binding fails
// here instead of passing as an "it ran" test.
import { describe, expect, test } from "bun:test"

import { createDshAdapter, type DshCapabilities } from "../src/index"

/** The twelve frozen §3 methods and their declared parameter counts. */
const FROZEN_SURFACE: ReadonlyArray<readonly [string, number]> = [
  ["registerHostTool", 1],
  ["subagentRuntime", 0],
  ["subagentProvider", 1],
  ["subagentProviders", 0],
  ["startContinuableAgent", 1],
  ["interruptAgent", 2],
  ["llmListModels", 1],
  ["llmResolveCallConfig", 2],
  ["registerPromptSection", 1],
  ["agentScope", 1],
  ["startAgentTurn", 2],
  ["cancelAgentTurn", 3],
  ["steerAgentTurn", 2],
  ["injectAgentMessage", 2],
]

/** One capability flag per new seam (contract §3 table, column 4). */
const FROZEN_FLAGS = [
  "toolsRegisterHost",
  "subagentsProvider",
  "subagentsContinuable",
  "subagentsInterrupt",
  "llmListModels",
  "llmResolveCallConfig",
  "systemPromptSection",
  "agentScope",
  "agentTurnStart",
  "agentTurnCancel",
  "agentTurnSteer",
  "agentTurnInject",
] as const

/** One recorded call: the seam name, the receiver it was called on, and the forwarded arguments. */
type Call = { seam: string; receiver: unknown; args: unknown[] }

/**
 * A recording double for exactly the seams this surface touches. Each method records
 * `this` alongside its arguments and answers with a MARKER value, so a forwarder that
 * loses the receiver or rewrites an argument is caught by identity.
 */
function agentTeamsHarness(): {
  /** The ctx handed to the adapter: a service lookup over the five doubles. */
  ctx: { get(serviceName: string): unknown }
  /** Every call the double recorded, in order. */
  calls: Call[]
  /** The definitions the tools registry was handed. */
  registered: unknown[]
  /** The sections the system-prompt registry was handed. */
  sections: unknown[]
  /** The recording tools service. */
  tools: Record<string, unknown>
  /** The recording subagent service. */
  subagents: Record<string, unknown>
  /** The recording llm service. */
  llm: Record<string, unknown>
  /** The recording system-prompt service. */
  systemPrompt: Record<string, unknown>
  /** The live-session registry double, serving one agent with every turn verb. */
  agents: { list(): unknown[]; get(id: string): unknown }
  /** The live Agent whose scope and turn verbs the live-registry flags probe. */
  liveAgent: { id: string; ctx: unknown; followup: () => void; cancel: () => void; steer: () => void; inject: () => void }
  /** The registry disposer a host-tool registration must return. */
  toolDispose: () => void
  /** The registry disposer a prompt-section registration must return. */
  systemPromptDispose: () => void
} {
  /** Every call the double observed, in the order the adapter made them. */
  const calls: Call[] = []
  /** Push one call onto the log, keeping the receiver and the forwarded arguments. */
  const record = (seam: string, receiver: unknown, ...args: unknown[]): void => { calls.push({ seam, receiver, args }) }

  /** The registry's own disposer, returned so identity can be asserted. */
  const toolDispose = (): void => { /* the registry's own disposer */ }
  /** The definitions the tools registry was handed. */
  const registered: unknown[] = []
  /** The recording tools service: it witnesses what the adapter hands over, nothing more. */
  const tools = {
    marker: "tools-service",
    /** Record the definition and answer the registry's own disposer. */
    register(this: { marker: string }, definition: unknown): () => void {
      // The registry's own normalization is deliberately ABSENT here: this double
      // witnesses what the adapter hands over, not what a harness would do with it.
      registered.push(definition)
      return toolDispose
    },
  }

  /** The recording subagent service: catalogue, continuable start and interrupt. */
  const subagents = {
    marker: "subagents-service",
    /** Record the catalogue read and answer a marker object naming the receiver. */
    getProvider(this: { marker: string }, name: string): { provider: string; from: string } {
      record("subagents.getProvider", this, name)
      return { provider: name, from: this.marker }
    },
    /** Record the list read and answer names plus a non-string the adapter must drop. */
    list(this: { marker: string }): Array<string | number> {
      record("subagents.list", this)
      // A non-string entry proves the frozen `string[]` return filters instead of leaking.
      return ["spawn-in-process", "fork-in-process", 7]
    },
    /** Record the spec and answer a marker echoing it. */
    startContinuable(this: { marker: string }, spec: unknown): Promise<{ started: unknown; from: string }> {
      record("subagents.startContinuable", this, spec)
      return Promise.resolve({ started: spec, from: this.marker })
    },
    /** Record the interrupt with both arguments and answer nothing, as the host does. */
    interrupt(this: { marker: string }, targetSessionId: string, authority: unknown): void {
      record("subagents.interrupt", this, targetSessionId, authority)
      return undefined
    },
  }

  /** The recording llm service: the two reads the agent-teams bridge forwards. */
  const llm = {
    marker: "llm-service",
    /** Record the provider id and answer one model row. */
    listModels(this: { marker: string }, provider: string): Promise<Array<{ id: string; provider: string }>> {
      record("llm.listModels", this, provider)
      return Promise.resolve([{ id: "deepseek-v4-flash", provider }])
    },
    /** Record the config and signal, echoing both back inside the answer. */
    resolveCallConfig(this: { marker: string }, config: unknown, signal?: unknown): Promise<{ config: unknown; signal: unknown; from: string }> {
      record("llm.resolveCallConfig", this, config, signal)
      return Promise.resolve({ config, signal, from: this.marker })
    },
  }

  /** The registry's own disposer, returned so identity can be asserted. */
  const systemPromptDispose = (): void => { /* the registry's own disposer */ }
  /** The sections the system-prompt registry was handed. */
  const sections: unknown[] = []
  /** The recording system-prompt service. */
  const systemPrompt = {
    marker: "system-prompt-service",
    /** Record the section and answer the registry's own disposer. */
    section(this: { marker: string }, section: unknown): () => void {
      record("systemPrompt.section", this, section)
      sections.push(section)
      return systemPromptDispose
    },
  }

  // A live registry entry (the three agent-object flags are live probes): its own
  // scoped context carries every member agentScope promises, plus both turn methods.
  const liveAgent = {
    id: "captain",
    ctx: { marker: "agent-ctx", on: () => () => {}, effect: () => () => {}, tools: { restrict: () => () => {} } },
    followup: () => {},
    cancel: () => {},
    steer: () => {},
    inject: () => {},
  }
  /** The live-session registry double: one agent, reachable by list and by get. */
  const agents = { list: () => [liveAgent], get: (id: string) => (id === liveAgent.id ? liveAgent : undefined) }

  /** The ctx handed to the adapter: a service lookup over the five doubles. */
  const ctx = { get: (serviceName: string) => ({ tools, subagents, llm, systemPrompt, agents } as Record<string, unknown>)[serviceName] }
  return { ctx, calls, registered, sections, tools, subagents, llm, systemPrompt, agents, liveAgent, toolDispose, systemPromptDispose }
}

/**
 * One agent whose scoped context records every seam call with its receiver.
 */
function scopedAgent(): {
  /** The recording Agent: its own scoped ctx plus the four turn verbs. */
  agent: {
    id: string
    ctx: {
      marker: string
      on(this: { marker: string }, event: string, handler: unknown): unknown
      effect(this: { marker: string }, fn: unknown, label?: string): unknown
      tools: { marker: string; restrict(this: { marker: string }, filter: unknown): unknown }
    }
    followup(this: unknown, message: unknown): unknown
    cancel(this: unknown, cause: unknown, options?: unknown): unknown
    steer(this: unknown, message: unknown): unknown
    inject(this: unknown, message: unknown): unknown
  }
  /** The agent's own scoped context, whose identity the built scope must preserve. */
  context: {
    marker: string
    on(this: { marker: string }, event: string, handler: unknown): unknown
    effect(this: { marker: string }, fn: unknown, label?: string): unknown
    tools: unknown
  }
  /** The agent's own tools service, the receiver `restrict` is called on. */
  agentTools: { marker: string; restrict(this: { marker: string }, filter: unknown): unknown }
  /** Every scoped-seam call, recorded with its receiver. */
  hits: Call[]
  /** Every turn-verb call, recorded with its receiver. */
  turns: Call[]
  /** The fixed disposers the scope members must return. */
  disposers: { restrict: () => void; on: () => void; effect: () => void }
} {
  /** Every scoped-seam call, recorded with its receiver. */
  const hits: Call[] = []
  /** The fixed disposers the scope members must return. */
  const disposers = { restrict: () => {}, on: () => {}, effect: () => {} }
  /** The agent's own tools service, the receiver `restrict` is called on. */
  const agentTools = {
    marker: "agent-ctx.tools",
    /** Record the filter and answer the fixed restrict disposer. */
    restrict(this: { marker: string }, filter: unknown): () => void {
      hits.push({ seam: "tools.restrict", receiver: this, args: [filter] })
      return disposers.restrict
    },
  }
  /** The agent's own scoped context: the object whose identity the scope must preserve. */
  const context = {
    marker: "agent-ctx",
    /** Record the subscription and answer the fixed on disposer. */
    on(this: { marker: string }, event: string, handler: unknown): () => void {
      hits.push({ seam: "on", receiver: this, args: [event, handler] })
      return disposers.on
    },
    /** Record the effect with its optional label and answer the fixed effect disposer. */
    effect(this: { marker: string }, fn: unknown, label?: string): () => void {
      hits.push({ seam: "effect", receiver: this, args: [fn, label] })
      return disposers.effect
    },
    tools: agentTools,
  }
  /** Every turn-verb call, recorded with its receiver. */
  const turns: Call[] = []
  /** The recording Agent: its own scoped ctx plus the four turn verbs. */
  const agent = {
    id: "captain",
    ctx: context,
    /** Record the followup call and answer nothing, as the host does. */
    followup(this: unknown, message: unknown): void {
      turns.push({ seam: "followup", receiver: this, args: [message] })
      return undefined
    },
    /** Record the cancel with both arguments and answer nothing. */
    cancel(this: unknown, cause: unknown, options?: unknown): void {
      turns.push({ seam: "cancel", receiver: this, args: [cause, options] })
      return undefined
    },
    /** Record the steer message and answer nothing. */
    steer(this: unknown, message: unknown): void {
      turns.push({ seam: "steer", receiver: this, args: [message] })
      return undefined
    },
    /** Record the injected message and answer nothing. */
    inject(this: unknown, message: unknown): void {
      turns.push({ seam: "inject", receiver: this, args: [message] })
      return undefined
    },
  }
  return { agent, context, agentTools, hits, turns, disposers }
}

describe("agent-teams surface: the twelve frozen methods", () => {
  test("every method exists under its frozen name with its declared arity", () => {
    /** The adapter viewed as a plain record so its methods can be indexed by name. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx) as unknown as Record<string, unknown>
    for (const [method, arity] of FROZEN_SURFACE) {
      expect(typeof adapter[method]).toBe("function")
      expect((adapter[method] as (...args: unknown[]) => unknown).length).toBe(arity)
    }
  })

  test("every new capability flag exists, is truthful, and is false on an absent harness", () => {
    /** The capability flags viewed as a record, for the same reason. */
    const caps = createDshAdapter(agentTeamsHarness().ctx).capabilities() as unknown as Record<string, unknown>
    for (const flag of FROZEN_FLAGS) expect(caps[flag]).toBe(true)

    /** The flags of a harness with no service at all. */
    const absent = createDshAdapter({ get: () => undefined }).capabilities() as unknown as Record<string, unknown>
    for (const flag of FROZEN_FLAGS) expect(absent[flag]).toBe(false)
  })

  test("the provider flag needs BOTH catalogue halves, and each flag tracks its own seam", () => {
    /** A subagent service with the getProvider half but NOT the list half. */
    const onlyGetProvider = {
      get: (serviceName: string) => (serviceName === "subagents" ? { start: async () => ({}), getProvider: () => ({}) } : undefined),
    }
    expect(createDshAdapter(onlyGetProvider).capabilities().subagentsProvider).toBe(false)

    /** The full recording double. */
    const full = agentTeamsHarness()
    /** Its capability flags, asserted flag by flag. */
    const caps = createDshAdapter(full.ctx).capabilities()
    expect(caps.subagentsProvider).toBe(true)
    expect(caps.subagentsContinuable).toBe(true)
    expect(caps.subagentsInterrupt).toBe(true)
    expect(caps.toolsRegisterHost).toBe(true)
    expect(caps.llmListModels).toBe(true)
    expect(caps.llmResolveCallConfig).toBe(true)
    expect(caps.systemPromptSection).toBe(true)

    // llm alone (no subagents/systemPrompt): the llm flags are true, the others false.
    const llmOnly = createDshAdapter({ get: (serviceName: string) => (serviceName === "llm" ? full.llm : undefined) }).capabilities()
    expect(llmOnly.llmListModels).toBe(true)
    expect(llmOnly.llmResolveCallConfig).toBe(true)
    expect(llmOnly.subagentsProvider).toBe(false)
    expect(llmOnly.systemPromptSection).toBe(false)
  })

  test("the five agent-object flags are LIVE-REGISTRY probes, not constant surfaces", () => {
    for (const flag of ["agentTurnStart", "agentTurnCancel", "agentTurnSteer", "agentTurnInject", "agentScope"] as const) {
      expect(createDshAdapter({ get: () => undefined }).capabilities()[flag]).toBe(false)
      /** A ctx whose only live agent has no scoped context and no turn verbs. */
      const bare = { get: (serviceName: string) => (serviceName === "agents" ? { list: () => [{ id: "bare-agent" }] } : undefined) }
      expect(createDshAdapter(bare).capabilities()[flag]).toBe(false)
    }

    /** The recording Agent out of the scoped double. */
    const { agent } = scopedAgent()
    /** A ctx whose registry serves exactly that Agent. */
    const live = { get: (serviceName: string) => (serviceName === "agents" ? { list: () => [agent] } : undefined) }
    expect(createDshAdapter(live).capabilities().agentTurnStart).toBe(true)
    expect(createDshAdapter(live).capabilities().agentTurnCancel).toBe(true)
    expect(createDshAdapter(live).capabilities().agentTurnSteer).toBe(true)
    expect(createDshAdapter(live).capabilities().agentTurnInject).toBe(true)
    expect(createDshAdapter(live).capabilities().agentScope).toBe(true)
  })

  test("each agent-object flag tracks its OWN method, never a sibling", () => {
    /** Build a capabilities read over an agent exposing exactly the named member. */
    const withOnly = (member: string): DshCapabilities => {
      /** An Agent carrying only the one probed member. */
      const agent = { id: "captain", [member]: () => {} }
      /** A ctx whose registry serves that single Agent. */
      const ctx = { get: (serviceName: string) => (serviceName === "agents" ? { list: () => [agent] } : undefined) }
      return createDshAdapter(ctx).capabilities()
    }
    expect(withOnly("steer").agentTurnSteer).toBe(true)
    expect(withOnly("steer").agentTurnStart).toBe(false)
    expect(withOnly("steer").agentTurnInject).toBe(false)
    expect(withOnly("inject").agentTurnInject).toBe(true)
    expect(withOnly("inject").agentTurnStart).toBe(false)
  })
})

describe("registerHostTool: VERBATIM registration (AC2)", () => {
  test("the SAME object reference reaches tools.register — no rebuild, no spread, no wrapper", () => {
    /** The double's ctx and the definitions its registry collected. */
    const { ctx, registered } = agentTeamsHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The tool body, whose identity must survive the verbatim registration. */
    const execute = async (args: unknown): Promise<{ args: unknown }> => ({ args })
    /** The harness-shaped definition, including the four fields registerTool would drop. */
    const definition = {
      name: "agent_teams_demo",
      description: "demo",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      output: { schema: { type: "object" }, render: () => [{ type: "text", text: "x" }] },
      timeoutMs: 5_000,
      finalizeContent: (content: unknown) => content,
      presentCall: (args: unknown) => ({ args }),
      presentResult: (value: unknown) => ({ value }),
      isConcurrencySafe: () => true,
      execute,
    }

    /** The registration's disposer, which must be callable. */
    const dispose = adapter.registerHostTool(definition)

    expect(registered).toHaveLength(1)
    // Object.is end to end: not a clone, not a rebuilt literal.
    expect(registered[0]).toBe(definition)
    expect(Object.is(registered[0], definition)).toBe(true)
    // The four fields registerTool would DROP, by identity.
    const recorded = registered[0] as Record<string, unknown>
    expect(recorded.finalizeContent).toBe(definition.finalizeContent)
    expect(recorded.presentCall).toBe(definition.presentCall)
    expect(recorded.presentResult).toBe(definition.presentResult)
    expect(recorded.isConcurrencySafe).toBe(definition.isConcurrencySafe)
    // The exact execute function, NOT registerTool's `(args ?? {}, exec ?? {})` wrapper.
    expect(recorded.execute).toBe(execute)
    // No injected defaults, and the caller's schema/render/timeout survive untouched.
    expect(recorded.output).toBe(definition.output)
    expect(recorded.timeoutMs).toBe(5_000)
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(definition).sort())
    // The registry's disposer is passed through verbatim.
    expect(typeof dispose).toBe("function")
    dispose()
  })

  test("a non-callable registry answer degrades to a no-op disposer, never a leak", () => {
    /** A ctx whose tools registry answers a non-callable. */
    const ctx = { get: (serviceName: string) => (serviceName === "tools" ? { register: () => 42 } : undefined) }
    /** The degraded disposer, which must be callable and harmless. */
    const dispose = createDshAdapter(ctx).registerHostTool({ name: "agent_teams_demo" })
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })

  test("a missing tools service THROWS with the frozen message (parity with the injected ctx.tools)", () => {
    /** An adapter over a harness with no tools service. */
    const adapter = createDshAdapter({ get: () => undefined })
    expect(() => adapter.registerHostTool({ name: "agent_teams_demo" })).toThrow(/harness service "tools" is unavailable/)
    expect(() => adapter.registerHostTool({ name: "agent_teams_demo" })).toThrow(/agent_teams_demo/)
  })

  test("registerTool keeps its OWN normalizing contract for its existing consumers", () => {
    /** The double's ctx and the definitions its registry collected. */
    const { ctx, registered } = agentTeamsHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The tool body the normalizing path is expected to replace. */
    const execute = async (): Promise<{ ok: boolean }> => ({ ok: true })
    /** A definition with no schema or renderer, so the defaults must appear. */
    const definition = { name: "mpd_demo", description: "demo", execute }

    adapter.registerTool(definition)

    /** The REBUILT definition the registry received, contrasted with the original. */
    const recorded = registered[0] as Record<string, unknown>
    // The contrast that justifies registerHostTool's existence: registerTool rebuilds.
    expect(recorded).not.toBe(definition)
    expect(recorded.execute).not.toBe(execute)
    expect(recorded.parameters).toEqual({ type: "object", properties: {} })
    expect(recorded.output).not.toBe(definition && (definition as { output?: unknown }).output)
    expect((recorded.output as { schema?: unknown }).schema).toEqual({ type: "object", properties: {} })
    expect(typeof (recorded.output as { render?: unknown }).render).toBe("function")
  })
})

describe("subagent plane forwarders", () => {
  test("subagentRuntime returns the service ITSELF (identity), undefined when absent", () => {
    /** The double's ctx and its subagent service. */
    const { ctx, subagents } = agentTeamsHarness()
    expect(createDshAdapter(ctx).subagentRuntime()).toBe(subagents)
    expect(createDshAdapter({ get: () => undefined }).subagentRuntime()).toBeUndefined()
  })

  test("subagentProvider is receiver-bound and returns the provider untouched", () => {
    /** The double's ctx, subagent service and call log. */
    const { ctx, subagents, calls } = agentTeamsHarness()
    /** The provider the service answered. */
    const provider = createDshAdapter(ctx).subagentProvider("in-process")
    expect(provider).toEqual({ provider: "in-process", from: "subagents-service" })
    expect(calls).toEqual([{ seam: "subagents.getProvider", receiver: subagents, args: ["in-process"] }])
  })

  test("subagentProvider degrades to undefined for a missing service or a half-present one", () => {
    expect(createDshAdapter({ get: () => undefined }).subagentProvider("in-process")).toBeUndefined()
    /** A subagent service without getProvider. */
    const withoutGetProvider = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(createDshAdapter(withoutGetProvider).subagentProvider("in-process")).toBeUndefined()
  })

  test("subagentProviders returns the names in order, drops non-strings, degrades to []", () => {
    /** The double's ctx, subagent service and call log. */
    const { ctx, subagents, calls } = agentTeamsHarness()
    expect(createDshAdapter(ctx).subagentProviders()).toEqual(["spawn-in-process", "fork-in-process"])
    expect(calls).toEqual([{ seam: "subagents.list", receiver: subagents, args: [] }])
    expect(createDshAdapter({ get: () => undefined }).subagentProviders()).toEqual([])
    /** A subagent service without list(). */
    const withoutList = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(createDshAdapter(withoutList).subagentProviders()).toEqual([])
    /** A subagent service whose list() answers undefined. */
    const nonArray = { get: (name: string) => (name === "subagents" ? { list: () => undefined } : undefined) }
    expect(createDshAdapter(nonArray).subagentProviders()).toEqual([])
  })

  test("startContinuableAgent forwards the spec VERBATIM and hands back the service's own promise", async () => {
    /** The double's ctx, subagent service and call log. */
    const { ctx, subagents, calls } = agentTeamsHarness()
    /** The spawn spec that must reach the service by identity. */
    const spec = { provider: "spawn-in-process", label: "senior", prompt: "do the thing" }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctx)
    /** The service's own promise, awaited without a wrapper. */
    const pending = adapter.startContinuableAgent(spec)
    expect(calls).toEqual([{ seam: "subagents.startContinuable", receiver: subagents, args: [spec] }])
    expect(calls[0].args[0]).toBe(spec)
    await expect(pending).resolves.toEqual({ started: spec, from: "subagents-service" })
  })

  test("startContinuableAgent THROWS synchronously when the service or the method is absent", () => {
    expect(() => createDshAdapter({ get: () => undefined }).startContinuableAgent({ label: "x" })).toThrow(/harness service "subagents" is unavailable/)
    /** A subagent service without startContinuable(). */
    const withoutMethod = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(() => createDshAdapter(withoutMethod).startContinuableAgent({ label: "x" })).toThrow(/exposes no startContinuable\(\)/)
  })

  test("interruptAgent forwards both arguments verbatim, receiver-bound, and THROWS when absent", () => {
    /** The double's ctx, subagent service and call log. */
    const { ctx, subagents, calls } = agentTeamsHarness()
    /** The authority object that must reach the service by identity. */
    const authority = { kind: "captain", member: "senior" }
    createDshAdapter(ctx).interruptAgent("session-1", authority)
    expect(calls).toEqual([{ seam: "subagents.interrupt", receiver: subagents, args: ["session-1", authority] }])
    expect(calls[0].args[1]).toBe(authority)

    expect(() => createDshAdapter({ get: () => undefined }).interruptAgent("session-1", authority)).toThrow(/harness service "subagents" is unavailable/)
    /** A subagent service without interrupt(). */
    const withoutMethod = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(() => createDshAdapter(withoutMethod).interruptAgent("session-1", authority)).toThrow(/exposes no interrupt\(\)/)
  })
})

describe("llm plane forwarders", () => {
  test("llmListModels forwards the provider id and returns the service's promise", async () => {
    /** The double's ctx, llm service and call log. */
    const { ctx, llm, calls } = agentTeamsHarness()
    await expect(createDshAdapter(ctx).llmListModels("deepseek-official")).resolves.toEqual([{ id: "deepseek-v4-flash", provider: "deepseek-official" }])
    expect(calls).toEqual([{ seam: "llm.listModels", receiver: llm, args: ["deepseek-official"] }])
  })

  test("llmResolveCallConfig forwards config AND signal by identity", async () => {
    /** The double's ctx, llm service and call log. */
    const { ctx, llm, calls } = agentTeamsHarness()
    /** The route config that must reach the service by identity. */
    const config = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }
    /** The cancellation signal that must reach the service by identity. */
    const signal = new AbortController().signal
    await expect(createDshAdapter(ctx).llmResolveCallConfig(config, signal)).resolves.toEqual({ config, signal, from: "llm-service" })
    expect(calls).toEqual([{ seam: "llm.resolveCallConfig", receiver: llm, args: [config, signal] }])
    expect(calls[0].args[0]).toBe(config)
    expect(calls[0].args[1]).toBe(signal)
  })

  test("both llm seams THROW synchronously on a missing service or method", () => {
    /** An adapter over a harness with no llm service. */
    const bare = createDshAdapter({ get: () => undefined })
    expect(() => bare.llmListModels("deepseek-official")).toThrow(/harness service "llm" is unavailable/)
    expect(() => bare.llmResolveCallConfig({})).toThrow(/harness service "llm" is unavailable/)
    /** An llm service exposing only listProviders. */
    const withoutMethods = { get: (name: string) => (name === "llm" ? { listProviders: () => [] } : undefined) }
    expect(() => createDshAdapter(withoutMethods).llmListModels("deepseek-official")).toThrow(/exposes no listModels\(\)/)
    expect(() => createDshAdapter(withoutMethods).llmResolveCallConfig({})).toThrow(/exposes no resolveCallConfig\(\)/)
  })
})

describe("registerPromptSection", () => {
  test("forwards the section VERBATIM and passes the registry's disposer through", () => {
    /** The double's ctx, its section sinks and its two disposers. */
    const { ctx, sections, systemPrompt, systemPromptDispose, calls } = agentTeamsHarness()
    /** The usage section that must reach the registry verbatim. */
    const section = { name: "agent-teams-usage", order: 40, text: "usage", complete: true }
    /** The disposer the registry returned, asserted by identity. */
    const dispose = createDshAdapter(ctx).registerPromptSection(section)
    expect(calls).toEqual([{ seam: "systemPrompt.section", receiver: systemPrompt, args: [section] }])
    expect(calls[0].args[0]).toBe(section)
    expect(sections).toEqual([section])
    expect(dispose).toBe(systemPromptDispose)
  })

  test("THROWS at the call when the seam is missing (a mandatory usage section)", () => {
    expect(() => createDshAdapter({ get: () => undefined }).registerPromptSection({ name: "usage", order: 1, text: "x" })).toThrow(/harness service "systemPrompt" is unavailable/)
    /** A systemPrompt service exposing no section(). */
    const withoutSection = { get: (name: string) => (name === "systemPrompt" ? {} : undefined) }
    expect(() => createDshAdapter(withoutSection).registerPromptSection({ name: "usage", order: 1, text: "x" })).toThrow(/exposes no section\(\)/)
  })

  test("a non-callable registry answer degrades to a no-op disposer", () => {
    /** A ctx whose systemPrompt answers a non-callable. */
    const ctx = { get: (name: string) => (name === "systemPrompt" ? { section: () => undefined } : undefined) }
    /** The degraded disposer, which must be callable and harmless. */
    const dispose = createDshAdapter(ctx).registerPromptSection({ name: "usage", order: 1, text: "x" })
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })
})

describe("agentScope: identity-preserving per-agent scope", () => {
  test("context IS agent.ctx and every member forwards to that same object", () => {
    /** The full double, for its host ctx. */
    const { ctx } = agentTeamsHarness()
    /** The recording Agent, its scope objects, its call logs and its disposers. */
    const { agent, context, agentTools, hits, disposers } = scopedAgent()
    /** The built scope, which must be defined for this Agent. */
    const scope = createDshAdapter(ctx).agentScope(agent)

    expect(scope).toBeDefined()
    expect(scope!.context).toBe(context)
    expect(Object.is(scope!.context, agent.ctx)).toBe(true)
    expect(scope!.context).toBe(agent.ctx)

    // Building the scope performs NO call: it is inert until used.
    expect(hits).toEqual([])

    /** The deny filter forwarded to the agent's own tools service. */
    const filter = { deny: ["write", "bash"] as const }
    expect(scope!.tools.restrict(filter)).toBe(disposers.restrict)
    /** A handler whose identity must survive the forwarding. */
    const handler = (): string => "handled"
    expect(scope!.on("agent/request", handler)).toBe(disposers.on)
    /** An effect body whose identity must survive the forwarding. */
    const fn = (): string => "effect"
    expect(scope!.effect(fn, "member-lifetime")).toBe(disposers.effect)

    expect(hits).toEqual([
      { seam: "tools.restrict", receiver: agentTools, args: [filter] },
      { seam: "on", receiver: context, args: ["agent/request", handler] },
      { seam: "effect", receiver: context, args: [fn, "member-lifetime"] },
    ])
  })

  test("a partial context degrades to undefined instead of a scope that throws later", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(adapter.agentScope(undefined)).toBeUndefined()
    expect(adapter.agentScope(null)).toBeUndefined()
    expect(adapter.agentScope({ id: "no-ctx" })).toBeUndefined()
    expect(adapter.agentScope({ id: "empty-ctx", ctx: {} })).toBeUndefined()
    expect(adapter.agentScope({ id: "no-tools", ctx: { on: () => () => {}, effect: () => () => {} } })).toBeUndefined()
    expect(adapter.agentScope({ id: "no-effect", ctx: { on: () => () => {}, tools: { restrict: () => () => {} } } })).toBeUndefined()
    expect(adapter.agentScope({ id: "no-on", ctx: { effect: () => () => {}, tools: { restrict: () => () => {} } } })).toBeUndefined()
    expect(adapter.agentScope({ id: "not-an-object-ctx", ctx: "ctx" })).toBeUndefined()
  })

  test("a throwing context getter is a miss, never a crash", () => {
    /** The host ctx the adapter is built over. */
    const ctx = agentTeamsHarness().ctx
    /** An Agent whose scoped-context getter throws, as a cordis proxy does. */
    const exploding = {
      id: "exploding",
      /** The throwing getter itself: reading `ctx` must be treated as a miss, never a crash. */
      get ctx(): unknown { throw new Error("ctx getter exploded") },
    }
    expect(createDshAdapter(ctx).agentScope(exploding)).toBeUndefined()
  })
})

describe("turn engine: THROWING forwarders (D9)", () => {
  test("startAgentTurn calls agent.followup with the agent as receiver and the message by identity", () => {
    /** The recording Agent and its turn-call log. */
    const { agent, turns } = scopedAgent()
    /** The user message that must reach followup by identity. */
    const message = { id: "m1", role: "user", content: [{ type: "text", text: "go" }], source: { kind: "user" } }
    createDshAdapter(agentTeamsHarness().ctx).startAgentTurn(agent, message)
    expect(turns).toEqual([{ seam: "followup", receiver: agent, args: [message] }])
    expect(turns[0].args[0]).toBe(message)
  })

  test("startAgentTurn preserves the agent's OWN throw — it does NOT route through submitUserTurn", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    /** An Agent whose followup throws the host's own error. */
    const refusing = { id: "refusing", followup: () => { throw new Error("driver refused") } }
    /** The user message handed to both turn seams. */
    const message = { id: "m1", role: "user" as const, content: [], source: { kind: "user" } }

    expect(() => adapter.startAgentTurn(refusing, message)).toThrow("driver refused")
    // The swallowing boolean seam keeps its own contract for ITS consumers.
    expect(adapter.submitUserTurn(refusing, message)).toBe(false)
  })

  test("startAgentTurn THROWS when the agent exposes no followup", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.startAgentTurn({ id: "bare" }, {})).toThrow(/exposes no followup\(\)/)
    expect(() => adapter.startAgentTurn(undefined, {})).toThrow(/exposes no followup\(\)/)
  })

  test("cancelAgentTurn forwards cause AND options verbatim, receiver-bound", () => {
    /** The recording Agent and its turn-call log. */
    const { agent, turns } = scopedAgent()
    /** The cancel options that must reach the agent by identity. */
    const options = { keepInbox: true }
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    adapter.cancelAgentTurn(agent, "user", options)
    adapter.cancelAgentTurn(agent, "halt")
    expect(turns).toEqual([
      { seam: "cancel", receiver: agent, args: ["user", options] },
      { seam: "cancel", receiver: agent, args: ["halt", undefined] },
    ])
    expect(turns[0].args[1]).toBe(options)
  })

  test("cancelAgentTurn preserves the agent's own error and THROWS when cancel is absent", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.cancelAgentTurn({ id: "refusing", cancel: () => { throw new Error("cannot cancel") } }, "user")).toThrow("cannot cancel")
    expect(() => adapter.cancelAgentTurn({ id: "bare" }, "user")).toThrow(/exposes no cancel\(\)/)
    expect(() => adapter.cancelAgentTurn(undefined, "user")).toThrow(/exposes no cancel\(\)/)
  })

  test("steerAgentTurn forwards the message to agent.steer by identity, receiver-bound", () => {
    /** The recording Agent and its turn-call log. */
    const { agent, turns } = scopedAgent()
    /** The user message that must reach steer by identity. */
    const message = { id: "m2", role: "user", content: [{ type: "text", text: "steer this" }], source: { kind: "plugin" } }
    createDshAdapter(agentTeamsHarness().ctx).steerAgentTurn(agent, message)
    expect(turns).toEqual([{ seam: "steer", receiver: agent, args: [message] }])
    expect(turns[0].args[0]).toBe(message)
    // ONE argument: the agent's own send-target/wakeup flags are never invented here.
    expect(turns[0].args).toHaveLength(1)
  })

  test("steerAgentTurn preserves the agent's own throw and THROWS when steer is absent", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.steerAgentTurn({ id: "refusing", steer: () => { throw new Error("cannot steer") } }, {})).toThrow("cannot steer")
    expect(() => adapter.steerAgentTurn({ id: "bare" }, {})).toThrow(/exposes no steer\(\)/)
    expect(() => adapter.steerAgentTurn(undefined, {})).toThrow(/exposes no steer\(\)/)
    // Distinct seams: a steer-only agent satisfies neither of the other turn verbs.
    const steerOnly = { id: "steer-only", steer: () => {} }
    expect(() => adapter.startAgentTurn(steerOnly, {})).toThrow(/exposes no followup\(\)/)
    expect(() => adapter.injectAgentMessage(steerOnly, {})).toThrow(/exposes no inject\(\)/)
  })

  test("injectAgentMessage forwards the message to agent.inject by identity, receiver-bound", () => {
    /** The recording Agent and its turn-call log. */
    const { agent, turns } = scopedAgent()
    /** The user message that must reach the inbox by identity. */
    const message = { id: "m3", role: "user", content: [{ type: "text", text: "queued" }], source: { kind: "user" } }
    createDshAdapter(agentTeamsHarness().ctx).injectAgentMessage(agent, message)
    expect(turns).toEqual([{ seam: "inject", receiver: agent, args: [message] }])
    expect(turns[0].args[0]).toBe(message)
    expect(turns[0].args).toHaveLength(1)
  })

  test("injectAgentMessage preserves the agent's own throw and THROWS when inject is absent", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.injectAgentMessage({ id: "refusing", inject: () => { throw new Error("inbox closed") } }, {})).toThrow("inbox closed")
    expect(() => adapter.injectAgentMessage({ id: "bare" }, {})).toThrow(/exposes no inject\(\)/)
    expect(() => adapter.injectAgentMessage(undefined, {})).toThrow(/exposes no inject\(\)/)
  })

  test("injectAgentMessage passes exactly ONE argument — and the adapter itself exposes no cordis ctx.inject", () => {
    /** The adapter under test. */
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    /** Every argument list the recording injector received. */
    const calls: unknown[][] = []
    /** An object whose `inject` records the argument list it was handed. */
    const recordingInjector = { inject: (...args: unknown[]) => { calls.push(args); return undefined } }
    adapter.injectAgentMessage(recordingInjector, { id: "m4" })
    // One argument only: the agent's inject(message) contract, never a (deps, callback) pair.
    // Callers pass an Agent; the adapter forwards to whatever object it is handed.
    expect(calls).toEqual([[{ id: "m4" }]])
    // The cordis dependency-injection seam lives on the FACADE, not on this adapter surface.
    expect(typeof (adapter as unknown as { inject?: unknown }).inject).toBe("undefined")
  })
})

describe("apply-time safety: nothing on this surface throws at construct or probe time", () => {
  test("an empty, a property-less and a throwing ctx all build an adapter whose new flags read false", () => {
    /** The three ctx shapes an apply-time probe must survive. */
    const compositions: unknown[] = [
      { get: () => undefined },
      {},
      { get: () => { throw new Error("scoped ctx refuses the probe") } },
    ]
    for (const ctx of compositions) {
      /** The adapter built over that ctx, which must not throw at construction. */
      const adapter = createDshAdapter(ctx as never)
      // Constructing and probing must be safe: only a CALL may throw, never the row's apply.
      expect(() => adapter.capabilities()).not.toThrow()
      /** The flags viewed as a record, so every one can be asserted false. */
      const caps = adapter.capabilities() as unknown as Record<string, unknown>
      for (const flag of FROZEN_FLAGS) expect(caps[flag]).toBe(false)
      // The value-shaped degrades are callable without a throw on the very same composition.
      expect(adapter.subagentRuntime()).toBeUndefined()
      expect(adapter.subagentProvider("spawn-in-process")).toBeUndefined()
      expect(adapter.subagentProviders()).toEqual([])
      expect(adapter.agentScope({ id: "no-ctx" })).toBeUndefined()
    }
  })
})

describe("the frozen degrade table on an absent harness", () => {
  test("each method degrades exactly as §3 declares (THROW / undefined / [])", () => {
    /** The adapter over a harness with no service at all. */
    const adapter = createDshAdapter({ get: () => undefined })

    // THROW — parity with the raw expression the caller would otherwise run.
    expect(() => adapter.registerHostTool({ name: "agent_teams_demo" })).toThrow(/harness service "tools" is unavailable/)
    expect(() => adapter.startContinuableAgent({ label: "member" })).toThrow(/harness service "subagents" is unavailable/)
    expect(() => adapter.interruptAgent("session-1", { kind: "captain" })).toThrow(/harness service "subagents" is unavailable/)
    expect(() => adapter.llmListModels("deepseek-official")).toThrow(/harness service "llm" is unavailable/)
    expect(() => adapter.llmResolveCallConfig({ provider: "p" })).toThrow(/harness service "llm" is unavailable/)
    expect(() => adapter.registerPromptSection({ name: "usage", order: 1, text: "x" })).toThrow(/harness service "systemPrompt" is unavailable/)
    expect(() => adapter.startAgentTurn({ id: "bare" }, {})).toThrow(/exposes no followup\(\)/)
    expect(() => adapter.cancelAgentTurn({ id: "bare" }, "user")).toThrow(/exposes no cancel\(\)/)
    expect(() => adapter.steerAgentTurn({ id: "bare" }, {})).toThrow(/exposes no steer\(\)/)
    expect(() => adapter.injectAgentMessage({ id: "bare" }, {})).toThrow(/exposes no inject\(\)/)

    // undefined / []
    expect(adapter.subagentRuntime()).toBeUndefined()
    expect(adapter.subagentProvider("spawn-in-process")).toBeUndefined()
    expect(adapter.subagentProviders()).toEqual([])
    expect(adapter.agentScope({ id: "bare" })).toBeUndefined()
  })
})
