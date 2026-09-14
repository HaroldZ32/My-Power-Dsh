// mpd-dsh-adapter unit tests: every wrapped harness seam is normalized and
// feature-detected, so a harness build that lacks a seam degrades with an
// actionable error instead of crashing the plugin tree.
import { describe, expect, test } from "bun:test"

import { apply, createDshAdapter, decision, SERVICE_NAME, textBlock } from "../src/index"

function fakeHarness(overrides: Record<string, unknown> = {}) {
  const registered: any[] = []
  const guards: any[] = []
  const listeners: any[] = []
  const provided: Record<string, unknown> = {}
  const started: Array<{ mode: string; spec: any }> = []
  const executed: any[] = []
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
  }
  const skills = {
    registerProvider: (provider: any) => { provided.skills = provider; return () => { delete provided.skills } },
    list: async () => [{ name: "svn-master", source: "bundled" }],
    get: async (name: string) => ({ name, content: "body" }),
  }
  const agentPresets = { resolve: async (id: string) => ({ id, path: "/bundle/presets/" + id + "/agent.cordis.yml", trust: "system" }) }
  const compaction = { compactNow: async (agent: any) => ({ agent }) }
  // The sample agent carries its OWN scoped ctx: on a real harness the agent-scoped compaction
  // service is a different object from the host-plane one, so capabilities() reports two seams.
  const sampleAgent = { id: "sample-agent", ctx: { get: (serviceName: string) => (serviceName === "compaction" ? compaction : undefined) } }
  const agents = { list: () => [sampleAgent], get: (id: string) => (id === sampleAgent.id ? sampleAgent : undefined) }
  const ctx = {
    get: (serviceName: string) => ({ tools, subagents, skills, agentPresets, agents, compaction } as Record<string, unknown>)[serviceName],
    on: (event: string, listener: any) => { if (event === "tools/post-execute") listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1) } },
    provide: (serviceName: string, value: unknown) => { provided[serviceName] = value },
    ...overrides,
  }
  return { ctx, registered, guards, listeners, provided, started, executed }
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
    expect(await createDshAdapter(ctx).resolvePreset("mpd")).toEqual({
      id: "mpd",
      path: "/bundle/presets/mpd/agent.cordis.yml",
      trust: "system",
    })
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
