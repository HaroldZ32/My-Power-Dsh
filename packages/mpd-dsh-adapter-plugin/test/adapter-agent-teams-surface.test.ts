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

import { createDshAdapter } from "../src/index"

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

type Call = { seam: string; receiver: unknown; args: unknown[] }

/**
 * A recording double for exactly the seams this surface touches. Each method records
 * `this` alongside its arguments and answers with a MARKER value, so a forwarder that
 * loses the receiver or rewrites an argument is caught by identity.
 */
function agentTeamsHarness() {
  const calls: Call[] = []
  const record = (seam: string, receiver: unknown, ...args: unknown[]): void => { calls.push({ seam, receiver, args }) }

  const toolDispose = () => { /* the registry's own disposer */ }
  const registered: unknown[] = []
  const tools = {
    marker: "tools-service",
    register(this: { marker: string }, definition: unknown) {
      // The registry's own normalization is deliberately ABSENT here: this double
      // witnesses what the adapter hands over, not what a harness would do with it.
      registered.push(definition)
      return toolDispose
    },
  }

  const subagents = {
    marker: "subagents-service",
    getProvider(this: { marker: string }, name: string) {
      record("subagents.getProvider", this, name)
      return { provider: name, from: this.marker }
    },
    list(this: { marker: string }) {
      record("subagents.list", this)
      // A non-string entry proves the frozen `string[]` return filters instead of leaking.
      return ["spawn-in-process", "fork-in-process", 7]
    },
    startContinuable(this: { marker: string }, spec: unknown) {
      record("subagents.startContinuable", this, spec)
      return Promise.resolve({ started: spec, from: this.marker })
    },
    interrupt(this: { marker: string }, targetSessionId: string, authority: unknown) {
      record("subagents.interrupt", this, targetSessionId, authority)
      return undefined
    },
  }

  const llm = {
    marker: "llm-service",
    listModels(this: { marker: string }, provider: string) {
      record("llm.listModels", this, provider)
      return Promise.resolve([{ id: "deepseek-v4-flash", provider }])
    },
    resolveCallConfig(this: { marker: string }, config: unknown, signal?: unknown) {
      record("llm.resolveCallConfig", this, config, signal)
      return Promise.resolve({ config, signal, from: this.marker })
    },
  }

  const systemPromptDispose = () => { /* the registry's own disposer */ }
  const sections: unknown[] = []
  const systemPrompt = {
    marker: "system-prompt-service",
    section(this: { marker: string }, section: unknown) {
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
  const agents = { list: () => [liveAgent], get: (id: string) => (id === liveAgent.id ? liveAgent : undefined) }

  const ctx = { get: (serviceName: string) => ({ tools, subagents, llm, systemPrompt, agents } as Record<string, unknown>)[serviceName] }
  return { ctx, calls, registered, sections, tools, subagents, llm, systemPrompt, agents, liveAgent, toolDispose, systemPromptDispose }
}

/**
 * One agent whose scoped context records every seam call with its receiver.
 */
function scopedAgent() {
  const hits: Call[] = []
  const disposers = { restrict: () => {}, on: () => {}, effect: () => {} }
  const agentTools = {
    marker: "agent-ctx.tools",
    restrict(this: { marker: string }, filter: unknown) {
      hits.push({ seam: "tools.restrict", receiver: this, args: [filter] })
      return disposers.restrict
    },
  }
  const context = {
    marker: "agent-ctx",
    on(this: { marker: string }, event: string, handler: unknown) {
      hits.push({ seam: "on", receiver: this, args: [event, handler] })
      return disposers.on
    },
    effect(this: { marker: string }, fn: unknown, label?: string) {
      hits.push({ seam: "effect", receiver: this, args: [fn, label] })
      return disposers.effect
    },
    tools: agentTools,
  }
  const turns: Call[] = []
  const agent = {
    id: "captain",
    ctx: context,
    followup(this: unknown, message: unknown) {
      turns.push({ seam: "followup", receiver: this, args: [message] })
      return undefined
    },
    cancel(this: unknown, cause: unknown, options?: unknown) {
      turns.push({ seam: "cancel", receiver: this, args: [cause, options] })
      return undefined
    },
    steer(this: unknown, message: unknown) {
      turns.push({ seam: "steer", receiver: this, args: [message] })
      return undefined
    },
    inject(this: unknown, message: unknown) {
      turns.push({ seam: "inject", receiver: this, args: [message] })
      return undefined
    },
  }
  return { agent, context, agentTools, hits, turns, disposers }
}

describe("agent-teams surface: the twelve frozen methods", () => {
  test("every method exists under its frozen name with its declared arity", () => {
    const adapter = createDshAdapter(agentTeamsHarness().ctx) as unknown as Record<string, unknown>
    for (const [method, arity] of FROZEN_SURFACE) {
      expect(typeof adapter[method]).toBe("function")
      expect((adapter[method] as (...args: unknown[]) => unknown).length).toBe(arity)
    }
  })

  test("every new capability flag exists, is truthful, and is false on an absent harness", () => {
    const caps = createDshAdapter(agentTeamsHarness().ctx).capabilities() as unknown as Record<string, unknown>
    for (const flag of FROZEN_FLAGS) expect(caps[flag]).toBe(true)

    const absent = createDshAdapter({ get: () => undefined }).capabilities() as unknown as Record<string, unknown>
    for (const flag of FROZEN_FLAGS) expect(absent[flag]).toBe(false)
  })

  test("the provider flag needs BOTH catalogue halves, and each flag tracks its own seam", () => {
    const onlyGetProvider = {
      get: (serviceName: string) => (serviceName === "subagents" ? { start: async () => ({}), getProvider: () => ({}) } : undefined),
    }
    expect(createDshAdapter(onlyGetProvider).capabilities().subagentsProvider).toBe(false)

    const full = agentTeamsHarness()
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
      const bare = { get: (serviceName: string) => (serviceName === "agents" ? { list: () => [{ id: "bare-agent" }] } : undefined) }
      expect(createDshAdapter(bare).capabilities()[flag]).toBe(false)
    }

    const { agent } = scopedAgent()
    const live = { get: (serviceName: string) => (serviceName === "agents" ? { list: () => [agent] } : undefined) }
    expect(createDshAdapter(live).capabilities().agentTurnStart).toBe(true)
    expect(createDshAdapter(live).capabilities().agentTurnCancel).toBe(true)
    expect(createDshAdapter(live).capabilities().agentTurnSteer).toBe(true)
    expect(createDshAdapter(live).capabilities().agentTurnInject).toBe(true)
    expect(createDshAdapter(live).capabilities().agentScope).toBe(true)
  })

  test("each agent-object flag tracks its OWN method, never a sibling", () => {
    const withOnly = (member: string) => {
      const agent = { id: "captain", [member]: () => {} }
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
    const { ctx, registered } = agentTeamsHarness()
    const adapter = createDshAdapter(ctx)
    const execute = async (args: unknown) => ({ args })
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
    const ctx = { get: (serviceName: string) => (serviceName === "tools" ? { register: () => 42 } : undefined) }
    const dispose = createDshAdapter(ctx).registerHostTool({ name: "agent_teams_demo" })
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })

  test("a missing tools service THROWS with the frozen message (parity with the injected ctx.tools)", () => {
    const adapter = createDshAdapter({ get: () => undefined })
    expect(() => adapter.registerHostTool({ name: "agent_teams_demo" })).toThrow(/harness service "tools" is unavailable/)
    expect(() => adapter.registerHostTool({ name: "agent_teams_demo" })).toThrow(/agent_teams_demo/)
  })

  test("registerTool keeps its OWN normalizing contract for its existing consumers", () => {
    const { ctx, registered } = agentTeamsHarness()
    const adapter = createDshAdapter(ctx)
    const execute = async () => ({ ok: true })
    const definition = { name: "mpd_demo", description: "demo", execute }

    adapter.registerTool(definition)

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
    const { ctx, subagents } = agentTeamsHarness()
    expect(createDshAdapter(ctx).subagentRuntime()).toBe(subagents)
    expect(createDshAdapter({ get: () => undefined }).subagentRuntime()).toBeUndefined()
  })

  test("subagentProvider is receiver-bound and returns the provider untouched", () => {
    const { ctx, subagents, calls } = agentTeamsHarness()
    const provider = createDshAdapter(ctx).subagentProvider("in-process")
    expect(provider).toEqual({ provider: "in-process", from: "subagents-service" })
    expect(calls).toEqual([{ seam: "subagents.getProvider", receiver: subagents, args: ["in-process"] }])
  })

  test("subagentProvider degrades to undefined for a missing service or a half-present one", () => {
    expect(createDshAdapter({ get: () => undefined }).subagentProvider("in-process")).toBeUndefined()
    const withoutGetProvider = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(createDshAdapter(withoutGetProvider).subagentProvider("in-process")).toBeUndefined()
  })

  test("subagentProviders returns the names in order, drops non-strings, degrades to []", () => {
    const { ctx, subagents, calls } = agentTeamsHarness()
    expect(createDshAdapter(ctx).subagentProviders()).toEqual(["spawn-in-process", "fork-in-process"])
    expect(calls).toEqual([{ seam: "subagents.list", receiver: subagents, args: [] }])
    expect(createDshAdapter({ get: () => undefined }).subagentProviders()).toEqual([])
    const withoutList = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(createDshAdapter(withoutList).subagentProviders()).toEqual([])
    const nonArray = { get: (name: string) => (name === "subagents" ? { list: () => undefined } : undefined) }
    expect(createDshAdapter(nonArray).subagentProviders()).toEqual([])
  })

  test("startContinuableAgent forwards the spec VERBATIM and hands back the service's own promise", async () => {
    const { ctx, subagents, calls } = agentTeamsHarness()
    const spec = { provider: "spawn-in-process", label: "senior", prompt: "do the thing" }
    const adapter = createDshAdapter(ctx)
    const pending = adapter.startContinuableAgent(spec)
    expect(calls).toEqual([{ seam: "subagents.startContinuable", receiver: subagents, args: [spec] }])
    expect(calls[0].args[0]).toBe(spec)
    await expect(pending).resolves.toEqual({ started: spec, from: "subagents-service" })
  })

  test("startContinuableAgent THROWS synchronously when the service or the method is absent", () => {
    expect(() => createDshAdapter({ get: () => undefined }).startContinuableAgent({ label: "x" })).toThrow(/harness service "subagents" is unavailable/)
    const withoutMethod = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(() => createDshAdapter(withoutMethod).startContinuableAgent({ label: "x" })).toThrow(/exposes no startContinuable\(\)/)
  })

  test("interruptAgent forwards both arguments verbatim, receiver-bound, and THROWS when absent", () => {
    const { ctx, subagents, calls } = agentTeamsHarness()
    const authority = { kind: "captain", member: "senior" }
    createDshAdapter(ctx).interruptAgent("session-1", authority)
    expect(calls).toEqual([{ seam: "subagents.interrupt", receiver: subagents, args: ["session-1", authority] }])
    expect(calls[0].args[1]).toBe(authority)

    expect(() => createDshAdapter({ get: () => undefined }).interruptAgent("session-1", authority)).toThrow(/harness service "subagents" is unavailable/)
    const withoutMethod = { get: (name: string) => (name === "subagents" ? { start: async () => ({}) } : undefined) }
    expect(() => createDshAdapter(withoutMethod).interruptAgent("session-1", authority)).toThrow(/exposes no interrupt\(\)/)
  })
})

describe("llm plane forwarders", () => {
  test("llmListModels forwards the provider id and returns the service's promise", async () => {
    const { ctx, llm, calls } = agentTeamsHarness()
    await expect(createDshAdapter(ctx).llmListModels("deepseek-official")).resolves.toEqual([{ id: "deepseek-v4-flash", provider: "deepseek-official" }])
    expect(calls).toEqual([{ seam: "llm.listModels", receiver: llm, args: ["deepseek-official"] }])
  })

  test("llmResolveCallConfig forwards config AND signal by identity", async () => {
    const { ctx, llm, calls } = agentTeamsHarness()
    const config = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }
    const signal = new AbortController().signal
    await expect(createDshAdapter(ctx).llmResolveCallConfig(config, signal)).resolves.toEqual({ config, signal, from: "llm-service" })
    expect(calls).toEqual([{ seam: "llm.resolveCallConfig", receiver: llm, args: [config, signal] }])
    expect(calls[0].args[0]).toBe(config)
    expect(calls[0].args[1]).toBe(signal)
  })

  test("both llm seams THROW synchronously on a missing service or method", () => {
    const bare = createDshAdapter({ get: () => undefined })
    expect(() => bare.llmListModels("deepseek-official")).toThrow(/harness service "llm" is unavailable/)
    expect(() => bare.llmResolveCallConfig({})).toThrow(/harness service "llm" is unavailable/)
    const withoutMethods = { get: (name: string) => (name === "llm" ? { listProviders: () => [] } : undefined) }
    expect(() => createDshAdapter(withoutMethods).llmListModels("deepseek-official")).toThrow(/exposes no listModels\(\)/)
    expect(() => createDshAdapter(withoutMethods).llmResolveCallConfig({})).toThrow(/exposes no resolveCallConfig\(\)/)
  })
})

describe("registerPromptSection", () => {
  test("forwards the section VERBATIM and passes the registry's disposer through", () => {
    const { ctx, sections, systemPrompt, systemPromptDispose, calls } = agentTeamsHarness()
    const section = { name: "agent-teams-usage", order: 40, text: "usage", complete: true }
    const dispose = createDshAdapter(ctx).registerPromptSection(section)
    expect(calls).toEqual([{ seam: "systemPrompt.section", receiver: systemPrompt, args: [section] }])
    expect(calls[0].args[0]).toBe(section)
    expect(sections).toEqual([section])
    expect(dispose).toBe(systemPromptDispose)
  })

  test("THROWS at the call when the seam is missing (a mandatory usage section)", () => {
    expect(() => createDshAdapter({ get: () => undefined }).registerPromptSection({ name: "usage", order: 1, text: "x" })).toThrow(/harness service "systemPrompt" is unavailable/)
    const withoutSection = { get: (name: string) => (name === "systemPrompt" ? {} : undefined) }
    expect(() => createDshAdapter(withoutSection).registerPromptSection({ name: "usage", order: 1, text: "x" })).toThrow(/exposes no section\(\)/)
  })

  test("a non-callable registry answer degrades to a no-op disposer", () => {
    const ctx = { get: (name: string) => (name === "systemPrompt" ? { section: () => undefined } : undefined) }
    const dispose = createDshAdapter(ctx).registerPromptSection({ name: "usage", order: 1, text: "x" })
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })
})

describe("agentScope: identity-preserving per-agent scope", () => {
  test("context IS agent.ctx and every member forwards to that same object", () => {
    const { ctx } = agentTeamsHarness()
    const { agent, context, agentTools, hits, disposers } = scopedAgent()
    const scope = createDshAdapter(ctx).agentScope(agent)

    expect(scope).toBeDefined()
    expect(scope!.context).toBe(context)
    expect(Object.is(scope!.context, agent.ctx)).toBe(true)
    expect(scope!.context).toBe(agent.ctx)

    // Building the scope performs NO call: it is inert until used.
    expect(hits).toEqual([])

    const filter = { deny: ["write", "bash"] as const }
    expect(scope!.tools.restrict(filter)).toBe(disposers.restrict)
    const handler = () => "handled"
    expect(scope!.on("agent/request", handler)).toBe(disposers.on)
    const fn = () => "effect"
    expect(scope!.effect(fn, "member-lifetime")).toBe(disposers.effect)

    expect(hits).toEqual([
      { seam: "tools.restrict", receiver: agentTools, args: [filter] },
      { seam: "on", receiver: context, args: ["agent/request", handler] },
      { seam: "effect", receiver: context, args: [fn, "member-lifetime"] },
    ])
  })

  test("a partial context degrades to undefined instead of a scope that throws later", () => {
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
    const ctx = agentTeamsHarness().ctx
    const exploding = { id: "exploding", get ctx(): unknown { throw new Error("ctx getter exploded") } }
    expect(createDshAdapter(ctx).agentScope(exploding)).toBeUndefined()
  })
})

describe("turn engine: THROWING forwarders (D9)", () => {
  test("startAgentTurn calls agent.followup with the agent as receiver and the message by identity", () => {
    const { agent, turns } = scopedAgent()
    const message = { id: "m1", role: "user", content: [{ type: "text", text: "go" }], source: { kind: "user" } }
    createDshAdapter(agentTeamsHarness().ctx).startAgentTurn(agent, message)
    expect(turns).toEqual([{ seam: "followup", receiver: agent, args: [message] }])
    expect(turns[0].args[0]).toBe(message)
  })

  test("startAgentTurn preserves the agent's OWN throw — it does NOT route through submitUserTurn", () => {
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    const refusing = { id: "refusing", followup: () => { throw new Error("driver refused") } }
    const message = { id: "m1", role: "user", content: [], source: { kind: "user" } }

    expect(() => adapter.startAgentTurn(refusing, message)).toThrow("driver refused")
    // The swallowing boolean seam keeps its own contract for ITS consumers.
    expect(adapter.submitUserTurn(refusing, message)).toBe(false)
  })

  test("startAgentTurn THROWS when the agent exposes no followup", () => {
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.startAgentTurn({ id: "bare" }, {})).toThrow(/exposes no followup\(\)/)
    expect(() => adapter.startAgentTurn(undefined, {})).toThrow(/exposes no followup\(\)/)
  })

  test("cancelAgentTurn forwards cause AND options verbatim, receiver-bound", () => {
    const { agent, turns } = scopedAgent()
    const options = { keepInbox: true }
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
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.cancelAgentTurn({ id: "refusing", cancel: () => { throw new Error("cannot cancel") } }, "user")).toThrow("cannot cancel")
    expect(() => adapter.cancelAgentTurn({ id: "bare" }, "user")).toThrow(/exposes no cancel\(\)/)
    expect(() => adapter.cancelAgentTurn(undefined, "user")).toThrow(/exposes no cancel\(\)/)
  })

  test("steerAgentTurn forwards the message to agent.steer by identity, receiver-bound", () => {
    const { agent, turns } = scopedAgent()
    const message = { id: "m2", role: "user", content: [{ type: "text", text: "steer this" }], source: { kind: "plugin" } }
    createDshAdapter(agentTeamsHarness().ctx).steerAgentTurn(agent, message)
    expect(turns).toEqual([{ seam: "steer", receiver: agent, args: [message] }])
    expect(turns[0].args[0]).toBe(message)
    // ONE argument: the agent's own send-target/wakeup flags are never invented here.
    expect(turns[0].args).toHaveLength(1)
  })

  test("steerAgentTurn preserves the agent's own throw and THROWS when steer is absent", () => {
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
    const { agent, turns } = scopedAgent()
    const message = { id: "m3", role: "user", content: [{ type: "text", text: "queued" }], source: { kind: "user" } }
    createDshAdapter(agentTeamsHarness().ctx).injectAgentMessage(agent, message)
    expect(turns).toEqual([{ seam: "inject", receiver: agent, args: [message] }])
    expect(turns[0].args[0]).toBe(message)
    expect(turns[0].args).toHaveLength(1)
  })

  test("injectAgentMessage preserves the agent's own throw and THROWS when inject is absent", () => {
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    expect(() => adapter.injectAgentMessage({ id: "refusing", inject: () => { throw new Error("inbox closed") } }, {})).toThrow("inbox closed")
    expect(() => adapter.injectAgentMessage({ id: "bare" }, {})).toThrow(/exposes no inject\(\)/)
    expect(() => adapter.injectAgentMessage(undefined, {})).toThrow(/exposes no inject\(\)/)
  })

  test("injectAgentMessage passes exactly ONE argument — and the adapter itself exposes no cordis ctx.inject", () => {
    const adapter = createDshAdapter(agentTeamsHarness().ctx)
    const calls: unknown[][] = []
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
    const compositions: unknown[] = [
      { get: () => undefined },
      {},
      { get: () => { throw new Error("scoped ctx refuses the probe") } },
    ]
    for (const ctx of compositions) {
      const adapter = createDshAdapter(ctx as never)
      // Constructing and probing must be safe: only a CALL may throw, never the row's apply.
      expect(() => adapter.capabilities()).not.toThrow()
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
