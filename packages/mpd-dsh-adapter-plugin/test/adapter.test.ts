// mpd-dsh-adapter unit tests: every wrapped harness seam is normalized and
// feature-detected, so a harness build that lacks a seam degrades with an
// actionable error instead of crashing the plugin tree.
import { describe, expect, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { Context } from "../../mpd-agent-teams-plugin/_deps/cordis/lib/index.js"
import { createUserMessage } from "../../mpd-agent-teams-plugin/_deps/dsh-llm/lib/index.js"
import { apply, createDshAdapter, createLazyDshAdapter, decision, dshAdapterIdentity, ADAPTER_IDENTITY_FALLBACK, ADAPTER_IDENTITY_MOUNTED, ADAPTER_IDENTITY_PENDING, SERVICE_NAME, textBlock, userMessage } from "../src/index"

function fakeHarness(overrides: Record<string, unknown> = {}) {
  const registered: any[] = []
  const guards: any[] = []
  const listeners: any[] = []
  const preListeners: any[] = []
  const provided: Record<string, unknown> = {}
  const started: Array<{ mode: string; spec: any }> = []
  const executed: any[] = []
  const commandsRegistered: any[] = []
  const commandDisposers: Array<() => void> = []
  const tools = {
    register: (definition: any) => { registered.push(definition); return () => { registered.pop() } },
    guard: (guard: any) => { guards.push(guard); return () => { guards.pop() } },
    get: (name: string) => (name === "mcp__wave_mcp__prepare_session" ? { name } : undefined),
    execute: async (exec: any) => {
      executed.push(exec)
      if (exec.name === "boom") throw new Error("tool exploded")
      if (exec.name === "fails") return { isError: true, error: { message: "denied" } }
      return { value: { echo: exec.arguments } }
    },
  }
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
    // test/adapter-team-surface.test.ts and test/no-direct-team-access.test.mjs).
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
  const compaction = { compactNow: async (agent: any) => ({ agent }) }
  // MEASURED host contract (dsh-commands/lib/index.js `register()`): the registry
  // returns the exact effect disposer that unregisters the definition, which the
  // adapter must pass through verbatim.
  const commands = {
    register: (definition: any) => {
      commandsRegistered.push(definition)
      const dispose = () => {
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
  const agents = { list: () => [sampleAgent], get: (id: string) => (id === sampleAgent.id ? sampleAgent : undefined) }
  const ctx = {
    get: (serviceName: string) => ({ tools, subagents, agentTeams, skills, agentPresets, agents, compaction, commands, llm, systemPrompt } as Record<string, unknown>)[serviceName],
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
    const { ctx } = fakeHarness()
    const caps = createDshAdapter(ctx).capabilities()
    expect(Object.values(caps).every((value) => value === true)).toBe(true)
  })

  test("reports absent seams without throwing", () => {
    const adapter = createDshAdapter({ get: () => undefined })
    const caps = adapter.capabilities()
    expect(caps.tools).toBe(false)
    expect(caps.subagentsSpawn).toBe(false)
    expect(caps.skillsProvider).toBe(false)
    expect(caps.agentPresets).toBe(false)
    expect(caps.llmCatalog).toBe(false)
  })
})

describe("llm catalog plane", () => {
  // A ctx whose ONLY service is the model registry (the seam reads nothing else).
  const llmOnlyCtx = (llm: unknown) => ({ get: (name: string) => (name === "llm" ? llm : undefined) })

  test("projects providers, models and reasoning from the live registry", async () => {
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
    const { ctx } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    expect(adapter.capabilities().llmCatalog).toBe(true)
    const catalog = await adapter.llmCatalog()
    expect(catalog.degraded).toBe(false)
    expect(catalog.providers[0].models[0].defaultEffort).toBe("high")
  })

  test("a missing llm service degrades and warns exactly once", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const adapter = createDshAdapter({ get: () => undefined })
      expect(await adapter.llmCatalog()).toEqual({ providers: [], degraded: true })
      // Second read: same degrade, but the warn-once line is NOT repeated.
      expect(await adapter.llmCatalog()).toEqual({ providers: [], degraded: true })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/llmCatalog degraded/)
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/llm service is unavailable/)
    } finally {
      warn.mockRestore()
    }
  })

  test("a partial seam degrades, names the missing method, and reports capabilities false", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const partial = { listProviders: () => [], listModels: async () => [] }
      const adapter = createDshAdapter(llmOnlyCtx(partial))
      expect(adapter.capabilities().llmCatalog).toBe(false)
      expect(await adapter.llmCatalog()).toEqual({ providers: [], degraded: true })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain("resolveModelInfo")
    } finally {
      warn.mockRestore()
    }
  })

  test("a rejecting provider is skipped and the rest of the catalog survives", async () => {
    const llm = {
      listProviders: () => [{ id: "broken", name: "Broken" }, { id: "ok", name: "OK" }],
      listModels: async (providerId: string) => {
        if (providerId === "broken") throw new Error("provider exploded")
        return [{ provider: providerId, id: "m1", name: "M1" }]
      },
      resolveModelInfo: async (providerId: string, modelId: string) => ({ provider: providerId, id: modelId, name: modelId }),
    }
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    expect(catalog.degraded).toBe(true)
    expect(catalog.providers).toEqual([{ id: "ok", name: "OK", models: [{ id: "m1", name: "M1", efforts: [] }] }])
  })

  test("a model whose resolveModelInfo rejects is skipped, not fatal", async () => {
    const llm = {
      listProviders: () => [{ id: "p", name: "P" }],
      listModels: async () => [{ id: "bad", name: "Bad" }, { id: "good", name: "Good" }],
      resolveModelInfo: async (_providerId: string, modelId: string) => {
        if (modelId === "bad") throw new Error("nope")
        return { id: modelId, name: modelId }
      },
    }
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    expect(catalog.degraded).toBe(true)
    expect(catalog.providers).toEqual([{ id: "p", name: "P", models: [{ id: "good", name: "Good", efforts: [] }] }])
  })

  test("a throwing listProviders degrades instead of rejecting", async () => {
    const llm = {
      listProviders: () => { throw new Error("registry down") },
      listModels: async () => [],
      resolveModelInfo: async () => ({}),
    }
    await expect(createDshAdapter(llmOnlyCtx(llm)).llmCatalog()).resolves.toEqual({ providers: [], degraded: true })
  })

  test("a non-array listProviders answer degrades instead of throwing", async () => {
    const llm = { listProviders: () => undefined, listModels: async () => [], resolveModelInfo: async () => ({}) }
    await expect(createDshAdapter(llmOnlyCtx(llm)).llmCatalog()).resolves.toEqual({ providers: [], degraded: true })
  })

  test("the lazy facade proxies the seam to the mounted adapter", async () => {
    const { ctx } = fakeHarness()
    const lazy = createLazyDshAdapter(ctx, { label: "mpd-test", warn: () => {} })
    const catalog = await lazy.llmCatalog()
    expect(catalog.degraded).toBe(false)
    expect(catalog.providers).toHaveLength(1)
  })
})

describe("tool plane", () => {
  test("registerTool normalizes schema, render and the (args, exec) call shape", async () => {
    const { ctx, registered } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    const dispose = adapter.registerTool({
      name: "mpd_demo",
      description: "demo",
      execute: async (args: any, exec: any) => ({ args, hasExec: exec !== undefined }),
    })
    expect(registered).toHaveLength(1)
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
    const { ctx, registered } = fakeHarness()
    const render = () => [{ type: "text", text: "custom" }]
    createDshAdapter(ctx).registerTool({ name: "mpd_demo", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } }, output: { schema: { type: "object" }, render }, execute: () => ({}) })
    expect(registered[0].parameters.properties.a).toEqual({ type: "string" })
    expect(registered[0].output.render).toBe(render)
  })

  test("services resolve through ctx.get OR a plain ctx property", () => {
    // Cordis exposes both; unit test doubles often provide only one.
    const tools = { register: () => () => {}, guard: () => () => {}, get: () => undefined, execute: async () => ({ value: 1 }) }
    const viaProperty = createDshAdapter({ tools })
    expect(viaProperty.capabilities().toolsRegister).toBe(true)
    const viaGet = createDshAdapter({ get: (name: string) => (name === "tools" ? tools : undefined) })
    expect(viaGet.capabilities().toolsRegister).toBe(true)
  })

  test("registerTools registers every definition and disposes them together", () => {
    const { ctx, registered } = fakeHarness()
    const dispose = createDshAdapter(ctx).registerTools([
      { name: "mpd_a", description: "a", execute: () => ({}) },
      { name: "mpd_b", description: "b", execute: () => ({}) },
    ])
    expect(registered.map((definition) => definition.name)).toEqual(["mpd_a", "mpd_b"])
    dispose()
    expect(registered).toHaveLength(0)
  })

  test("registerTool without a tools service fails with an actionable error", () => {
    const adapter = createDshAdapter({ get: () => undefined })
    expect(() => adapter.registerTool({ name: "mpd_demo", description: "d", execute: () => ({}) })).toThrow(/harness service "tools" is unavailable/)
  })

  test("guardTool passes the exec through and installs on the tools service", () => {
    const { ctx, guards } = fakeHarness()
    createDshAdapter(ctx).guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
    expect(guards).toHaveLength(1)
    expect(guards[0]({ name: "write" })).toBe("denied")
    expect(guards[0]({ name: "read" })).toBeUndefined()
    expect(guards[0](undefined)).toBeUndefined()
  })

  test("onPostToolExecute owns next() and passes the downstream decision through", async () => {
    const { ctx, listeners } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    const seen: string[] = []
    adapter.onPostToolExecute((exec, result, downstream) => {
      seen.push(String(exec.name) + ":" + String(result.isError) + ":" + downstream.kind)
      return undefined
    })
    let nextCalls = 0
    const passed = await listeners[0]({ name: "bash" }, { isError: false }, async () => { nextCalls += 1; return { kind: "accept", content: "original" } })
    expect(nextCalls).toBe(1)
    expect(passed).toEqual({ kind: "accept", content: "original" })
    expect(seen).toEqual(["bash:false:accept"])
  })

  test("onPostToolExecute lets a listener replace the decision", async () => {
    const { ctx, listeners } = fakeHarness()
    createDshAdapter(ctx).onPostToolExecute((_exec, _result, downstream) => ({ ...downstream, content: [{ type: "text", text: "trimmed" }] }))
    const decided = await listeners[0]({ name: "bash" }, {}, async () => ({ kind: "accept", content: "long" }))
    expect(decided.content).toEqual([{ type: "text", text: "trimmed" }])
  })

  test("onPostToolExecute is a no-op when the harness has no event bus", () => {
    const dispose = createDshAdapter({ get: () => undefined }).onPostToolExecute(() => undefined)
    expect(typeof dispose).toBe("function")
    expect(dispose()).toBeUndefined()
  })

  test("onPreToolExecute OWNS next(): the observer sees the gate and the gate is passed through", async () => {
    const { ctx, preListeners } = fakeHarness()
    const seen: string[] = []
    createDshAdapter(ctx).onPreToolExecute((exec, decision) => {
      seen.push(String(exec.name) + ":" + String(decision?.kind))
    })
    let nextCalls = 0
    const gate = { kind: "allow" as const }
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
    const deny = { kind: "deny" as const, reason: "read-only member" }
    expect(await denyBox.preListeners[0]({ name: "write" }, async () => deny)).toBe(deny)
    // (2) A listener that RETURNS a decision cannot install it: the wrapper discards it.
    const returnBox = fakeHarness()
    createDshAdapter(returnBox.ctx).onPreToolExecute((() => ({ kind: "deny", reason: "observer opinion" })) as any)
    const allow = { kind: "allow" as const }
    expect(await returnBox.preListeners[0]({ name: "read" }, async () => allow)).toBe(allow)
    // (3) `next` absent (a harness that dispatches the event without a chain): still no throw,
    // no invented decision — the observer runs and nothing is fabricated for the caller.
    const noNext = fakeHarness()
    const observed: unknown[] = []
    createDshAdapter(noNext.ctx).onPreToolExecute((_exec, decision) => { observed.push(decision) })
    expect(await noNext.preListeners[0]({ name: "read" }, undefined)).toBeUndefined()
    expect(observed).toEqual([undefined])
  })

  test("onPreToolExecute hands the observer a FROZEN COPY: the live execution cannot be changed", async () => {
    const { ctx, preListeners } = fakeHarness()
    const live: any = { name: "bash", callId: "call-live-1", arguments: { command: "rm -rf /" } }
    let received: any = null
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
    const absent = createDshAdapter({ get: () => undefined })
    const dispose = absent.onPreToolExecute(() => {})
    expect(typeof dispose).toBe("function")
    expect(dispose()).toBeUndefined()
    expect(absent.capabilities().toolsPreExecute).toBe(false)
    expect(createDshAdapter(fakeHarness().ctx).capabilities().toolsPreExecute).toBe(true)
  })

  test("hasTool + toolRuntime expose internal tool calls without raw ctx access", async () => {
    const { ctx, executed } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    expect(adapter.hasTool("mcp__wave_mcp__prepare_session")).toBe(true)
    expect(adapter.hasTool("nope")).toBe(false)
    const runtime = adapter.toolRuntime()
    expect(runtime.get("mcp__wave_mcp__prepare_session")).toBeDefined()
    await runtime.execute({ name: "mcp__wave_mcp__prepare_session", arguments: { out_dir: "/x" } })
    expect(executed).toHaveLength(1)
    expect(executed[0].callId).toMatch(/^mpd-/)
  })

  test("executeTool normalizes success, tool error, thrown error and a missing runtime", async () => {
    const { ctx } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    expect(await adapter.executeTool({ name: "ok", arguments: { a: 1 } })).toMatchObject({ ok: true, isError: false, value: { echo: { a: 1 } } })
    expect(await adapter.executeTool({ name: "fails" })).toMatchObject({ ok: false, isError: true, error: "denied" })
    expect(await adapter.executeTool({ name: "boom" })).toMatchObject({ ok: false, isError: true, error: "tool exploded" })
    const bare = createDshAdapter({ get: () => undefined })
    expect(await bare.executeTool({ name: "x" })).toMatchObject({ ok: false, isError: true })
  })

  test("executeTool forwards the optional calling agent VERBATIM as exec.agent, and stays absent when not given", async () => {
    const { ctx, executed } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    const liveAgent = { id: "captain-session", session: { header: { cwd: "/ws" } } }
    await adapter.executeTool({ name: "agent_teams_approve", arguments: { confirmation: "approve t" }, agent: liveAgent })
    await adapter.executeTool({ name: "agent_teams_approve", arguments: { confirmation: "approve t" } })
    await adapter.toolRuntime().execute({ name: "agent_teams_approve", arguments: {}, agent: liveAgent })
    expect(executed).toHaveLength(3)
    // Identity, not a copy: the adopted write tools read exec.agent.session.header.cwd.
    expect(executed[0].agent).toBe(liveAgent)
    expect(executed[0].agent.session.header.cwd).toBe("/ws")
    // Absent stays absent: every pre-existing caller keeps its exact meaning.
    expect("agent" in executed[1]).toBe(false)
    expect(executed[2].agent).toBe(liveAgent)
  })
})

describe("agent plane", () => {
  test("spawnAgent normalizes prompt, flat route and the result shape", async () => {
    const { ctx, started } = fakeHarness()
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
    const { ctx, started } = fakeHarness()
    const blocks = textBlock("block prompt")
    await createDshAdapter(ctx).spawnAgent({ label: "l", prompt: blocks, agentOptions: { provider: "p", model: "m" } })
    expect(started[0].spec.prompt).toBe(blocks)
    expect(started[0].spec.agentOptions).toEqual({ provider: "p", model: "m" })
  })

  test("spawnAgent tolerates a harness that returns no result", async () => {
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
    const { ctx, provided } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    const provider = { name: "mpd-bundle", list: async () => [], get: async () => undefined }
    adapter.registerSkillProvider(provider)
    expect(provided.skills).toBe(provider)
    expect(await adapter.listSkills()).toEqual([{ name: "svn-master", source: "bundled" }])
    expect(await adapter.loadSkill("svn-master")).toEqual({ name: "svn-master", content: "body" })
  })

  test("skill calls without a skills service fail with actionable errors", async () => {
    const adapter = createDshAdapter({ get: () => undefined })
    expect(() => adapter.registerSkillProvider({})).toThrow(/harness service "skills" is unavailable/)
    await expect(adapter.listSkills()).rejects.toThrow(/harness service "skills" is unavailable/)
  })

  test("resolvePreset returns a normalized preset record", async () => {
    const { ctx } = fakeHarness()
    // The row model: the definition is keyed by `config.id` and there is no path.
    expect(await createDshAdapter(ctx).resolvePreset("mpd")).toEqual({ id: "mpd" })
    expect(await createDshAdapter(ctx).resolvePreset("mpd")).toEqual(await createDshAdapter(ctx).resolvePreset("mpd"))
  })

  test("resolvePreset still normalizes the OPTIONAL path/trust a host build may send", async () => {
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
    const { ctx, commandsRegistered, commandDisposers } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    const handler = async (invocation: { rawInput?: string }) => ({ kind: "success", text: "ran " + String(invocation.rawInput ?? "") })
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
    let dispose: (() => void) | undefined
    expect(() => { dispose = adapter.registerCommand({ name: "ulw", description: "d", handler: () => ({ kind: "success" }) }) }).not.toThrow()
    expect(typeof dispose).toBe("function")
    expect(() => dispose?.()).not.toThrow()
  })

  test("an absent seam is a no-op disposer plus two false capability flags, never a throw", () => {
    const adapter = createDshAdapter({ get: () => undefined })
    const caps = adapter.capabilities()
    expect(caps.commands).toBe(false)
    expect(caps.commandsRegister).toBe(false)
    let dispose: (() => void) | undefined
    expect(() => { dispose = adapter.registerCommand({ name: "ulw", description: "d", handler: () => ({ kind: "success" }) }) }).not.toThrow()
    expect(typeof dispose).toBe("function")
    expect(() => dispose?.()).not.toThrow()
  })

  test("apply() never throws when the composition has no command registry", () => {
    const provided: Record<string, unknown> = {}
    const ctx = { get: () => undefined, provide: (serviceName: string, value: unknown) => { provided[serviceName] = value } }
    expect(() => apply(ctx)).not.toThrow()
    // The row still provides its adapter, and that adapter's command seam is a no-op
    // in this composition rather than a failure.
    const mounted = provided[SERVICE_NAME] as ReturnType<typeof createDshAdapter>
    expect(mounted).toBeDefined()
    const dispose = mounted.registerCommand({ name: "ulw", description: "d", handler: () => ({ kind: "success" }) })
    expect(() => dispose()).not.toThrow()
  })

  test("capabilities() reports a present registry, and distinguishes one without register()", () => {
    const { ctx } = fakeHarness()
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
    const injected = userMessage({ text: "directive", source: { kind: "plugin", plugin: "mpd-ulw" } })
    expect(injected.source).toEqual({ kind: "plugin", plugin: "mpd-ulw" })
    expect(userMessage({ text: "a" }).id).not.toBe(userMessage({ text: "a" }).id)
  })

  test("the field set matches the vendored host constructor, and only the identity differs", () => {
    const input = { text: "same text", source: { kind: "plugin", plugin: "mpd-ulw" } }
    const mine = userMessage(input)
    const reference = createUserMessage({ content: [{ type: "text", text: input.text }], source: input.source })
    expect(Object.keys(mine).sort()).toEqual(Object.keys(reference).sort())
    const { id: _mine, ...mineRest } = mine
    const { id: _reference, ...referenceRest } = reference
    expect(mineRest).toEqual(referenceRest)
    expect(typeof mine.id).toBe("string")
  })

  test("the adapter surface exposes it, and the source imports no host package by bare specifier", () => {
    const { ctx } = fakeHarness()
    expect(createDshAdapter(ctx).userMessage({ text: "x" }).role).toBe("user")
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/(?:from|import)\s*\(?\s*["']@deepseek-ai\//u)
  })
})

describe("turn plane (the submission surface a command handler needs)", () => {
  test("a registered command handler submits through its invocation, and the host's invocation is not mutated", async () => {
    const { ctx, commandsRegistered, submitted } = fakeHarness()
    const adapter = createDshAdapter(ctx)
    const agent = { id: "invoking-agent", followup: (message: unknown) => { submitted.push(message) } }
    const directive = userMessage({ text: "run the ULW loop", source: { kind: "plugin", plugin: "mpd-ulw" } })
    adapter.registerCommand({
      name: "ulw",
      description: "start one ULW run",
      handler: (invocation) => {
        const reached = invocation.submit?.(directive) ?? false
        return { kind: reached ? "success" : "error", text: reached ? "started" : "no turn seam" }
      },
    })
    const hostInvocation = { rawInput: " ship it", agent }
    expect(await commandsRegistered[0].handler(hostInvocation)).toEqual({ kind: "success", text: "started" })
    expect(submitted).toEqual([directive])
    // The plugin got a COPY: the object the host handed over still carries no `submit`.
    expect("submit" in hostInvocation).toBe(false)
    expect(Object.keys(hostInvocation).sort()).toEqual(["agent", "rawInput"])
  })

  test("submitUserTurn reaches the agent's followup, and every absent or broken surface is a safe no-op", () => {
    const { ctx, submitted } = fakeHarness()
    const adapter = createDshAdapter(ctx)
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
  // — @deepseek-ai/dsh-settings/lib/index.js:466-467 and :497-498.
  function settingsHarness(settings: any) {
    const handlers = new Map<string, Set<(...args: any[]) => unknown>>()
    const ctx = {
      get: (serviceName: string) => (serviceName === "settings" ? settings : undefined),
      on: (event: string, listener: (...args: any[]) => unknown) => {
        const set = handlers.get(event) ?? new Set()
        set.add(listener)
        handlers.set(event, set)
        return () => { set.delete(listener) }
      },
    }
    const emit = (event: string, ...args: any[]) => { for (const listener of [...(handlers.get(event) ?? [])]) listener(...args) }
    const write = (ns: string, revision: number, source: string | undefined, next: unknown = {}, prev: unknown = {}) => {
      emit("settings/document-updated", ns, revision)
      emit("settings/updated", ns, next, prev, source)
    }
    return { ctx, emit, write }
  }

  test("the source of the SAME change is delivered, not the previous one's", async () => {
    const { ctx, write } = settingsHarness({})
    const seen: Array<[number | undefined, string | undefined]> = []
    createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", (revision, source) => { seen.push([revision, source]) })
    write("mpd", 1, "provider")
    await new Promise((resolve) => setTimeout(resolve, 0))
    write("mpd", 2, "update")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([[1, "provider"], [2, "update"]])
  })

  test("a raw-section change whose RESOLVED value did not change reports source undefined", async () => {
    const { ctx, emit } = settingsHarness({})
    const seen: Array<[number | undefined, string | undefined]> = []
    createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", (revision, source) => { seen.push([revision, source]) })
    emit("settings/document-updated", "mpd", 7)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([[7, undefined]])
  })

  test("another namespace is ignored, and the disposer stops delivery", async () => {
    const { ctx, write } = settingsHarness({})
    const seen: unknown[] = []
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
    const { ctx, write } = settingsHarness({})
    createDshAdapter(ctx).onSettingsDocumentUpdated("mpd", () => { throw new Error("bridge exploded") })
    expect(() => write("mpd", 1, "update")).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test("settingsReader describes the namespace and degrades when it is absent", () => {
    const described = { ns: "mpd", value: { ulw: { maxRounds: 6 } }, revision: 4, user: { ulw: { maxRounds: 6 } }, base: {}, applies: "restart" }
    const full = settingsHarness({ get: (ns: string) => (ns === "mpd" ? { ulw: { maxRounds: 6 } } : undefined), describe: () => [described] })
    const reader = createDshAdapter(full.ctx).settingsReader("mpd")
    expect(reader?.get()).toEqual({ ulw: { maxRounds: 6 } })
    expect(reader?.describe()).toEqual({ value: described.value, revision: 4, user: described.user, base: {}, applies: "restart" })
    const absent = createDshAdapter(settingsHarness({}).ctx).settingsReader("mpd")
    expect(absent?.get()).toBeUndefined()
    expect(absent?.describe()).toBeUndefined()
    expect(createDshAdapter({ get: () => undefined }).settingsReader("mpd")).toBeUndefined()
  })

  test("settingsMutate writes through the service with the revision fence", async () => {
    const calls: any[] = []
    const settings = {
      mutate: async (ns: string, ops: any, revision?: number) => { calls.push({ ns, ops, revision }); if (ops[0].path[0] === "boom") { const conflict = new Error("settings conflict for \"mpd\""); conflict.name = "SettingsConflictError"; throw conflict } },
    }
    const adapter = createDshAdapter(settingsHarness(settings).ctx)
    expect(await adapter.settingsMutate("mpd", [{ op: "unset", path: ["ulw", "maxRounds"] }], 4)).toEqual({ ok: true })
    expect(calls[0]).toEqual({ ns: "mpd", ops: [{ op: "unset", path: ["ulw", "maxRounds"] }], revision: 4 })
    expect(await adapter.settingsMutate("mpd", [{ op: "set", path: ["boom"], value: 1 }], 5)).toEqual({ ok: false, error: 'settings conflict for "mpd"', conflict: true })
    expect(await createDshAdapter({ get: () => undefined }).settingsMutate("mpd", [])).toEqual({ ok: false, error: "settings service is unavailable" })
  })
})

describe("workspaceRootsAll(): the design's stated-unverified facts (§A.1, measured here)", () => {
  const agent = (cwd: string | undefined) => ({ id: "a-" + String(Math.random()), ctx: {}, session: { header: cwd === undefined ? {} : { cwd } } })

  test("duplicates collapse, relative cwds resolve, a cwd-less agent is skipped, no registry is []", () => {
    const agents = {
      list: () => [
        agent("/ws/one"),
        agent("/ws/one"),          // duplicate: ONE candidate, never two
        agent("/ws/one/../one"),   // same directory through a different spelling
        agent("/ws/two"),
        agent(undefined),          // a session with no cwd cannot be a candidate
      ],
    }
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
  async function dispatch(install: (adapter: ReturnType<typeof createDshAdapter>) => void, ms: number) {
    const ctx = new Context()
    const adapter = createDshAdapter(ctx as any)
    install(adapter)
    const exec = { name: "bash", callId: "call-real-1", arguments: { command: "sleep " + ms + "ms" } }
    const gate = await ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" as const }))
    if (gate.kind !== "allow") return { gate, result: null }
    // The tool body: a GENUINE child process that really takes `ms` wall-clock milliseconds.
    const started = Date.now()
    const child = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, " + ms + ")"], { encoding: "utf8" })
    const elapsed = Date.now() - started
    const result = { status: child.status, stdout: child.stdout, stderr: child.stderr, pid: child.pid !== undefined }
    // The harness's post-execute waterfall, driven the same way.
    const decision = await ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" as const }))
    return { gate, result, elapsed, started, accepted: decision.kind, value: (decision as any).value ?? result }
  }

  test("a REAL tool call returns the same result with and without the hook, and the gate is unchanged", async () => {
    const without = await dispatch(() => {}, 250)
    let observed: { kind: string | undefined; execName: string | undefined } | null = null
    let stampedAt = 0
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
    expect(stampedAt).toBeLessThanOrEqual(with1.started)
    expect(observed).not.toBeNull()
    expect((observed as any).kind).toBe("allow")
    expect((observed as any).execName).toBe("bash")
  })

  test("a downstream DENY still denies: the observer cannot upgrade a blocked call", async () => {
    const ctx = new Context()
    const seen: string[] = []
    createDshAdapter(ctx as any).onPreToolExecute((_exec, decision) => { seen.push(String(decision?.kind)) })
    const gate = await ctx.waterfall(ctx, "tools/pre-execute", { name: "write" }, () => Promise.resolve({ kind: "deny" as const, reason: "scope" }))
    expect(gate).toEqual({ kind: "deny", reason: "scope" })
    expect(seen).toEqual(["deny"])
  })

  test("NEGATIVE CONTROL: a listener that returns without delegating DOES veto the gate", async () => {
    // The retired `agent/pre-step` shape, re-enacted on `tools/pre-execute`: this is what the
    // adapter's wrapper exists to prevent, and it proves the cordis semantics above are real.
    const ctx = new Context()
    ctx.on("tools/pre-execute", (() => ({ kind: "allow", hijacked: true })) as any)
    const gate = await ctx.waterfall(ctx, "tools/pre-execute", { name: "bash" }, () => Promise.resolve({ kind: "allow" as const }))
    expect(gate).toEqual({ kind: "allow", hijacked: true })
    // …while the ADAPTER's own hook, registered on the same event, passes the harness's
    // decision through untouched.
    const clean = new Context()
    createDshAdapter(clean as any).onPreToolExecute(() => {})
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
  function pendingCtx() {
    const mounted = { marker: "mounted", capabilities: () => ({ probe: "mounted" }) } as any
    const state = { active: false, provided: true, strictReads: 0 }
    const ctx = {
      get(name: string, strict = true) {
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
    const { ctx, state } = pendingCtx()
    const lines: string[] = []
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
    const { ctx, state } = pendingCtx()
    const dsh = createLazyDshAdapter(ctx, { label: "mpd-test", warn: () => {} })
    dsh.capabilities()
    const afterFirstMiss = state.strictReads
    dsh.capabilities()
    // A miss must NOT pin the fallback: the next use probes again (this is the whole fix).
    expect(state.strictReads).toBeGreaterThan(afterFirstMiss)
    state.active = true
    dsh.capabilities()
    const afterResolve = state.strictReads
    dsh.capabilities()
    dsh.capabilities()
    // Once a strict read SUCCEEDS the result is stable: no further probes.
    expect(state.strictReads).toBe(afterResolve)
  })

  test("a clean boot never warns and reports the mounted identity", () => {
    const { ctx, state } = pendingCtx()
    state.active = true
    const lines: string[] = []
    const dsh = createLazyDshAdapter(ctx, { label: "mpd-test", warn: (line) => lines.push(line) })
    expect(dsh.capabilities()).toEqual({ probe: "mounted" })
    expect(lines).toEqual([])
    expect(dshAdapterIdentity(ctx)).toBe(ADAPTER_IDENTITY_MOUNTED)
  })

  test("a provably absent provider keeps the row-order hint — and only that case does", () => {
    const { ctx, state } = pendingCtx()
    state.provided = false
    const lines: string[] = []
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
    const root = new Context()
    const lines: string[] = []
    const provider = root.plugin({
      name: "t50-provider",
      apply(inner: any) {
        inner.provide(SERVICE_NAME, { marker: "mounted" })
      },
    } as any)
    let facade: ReturnType<typeof createLazyDshAdapter> | undefined
    let markerDuringApply: unknown
    const consumer = root.plugin({
      name: "t50-consumer",
      apply(inner: any) {
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
