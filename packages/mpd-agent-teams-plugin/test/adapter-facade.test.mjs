// AC4 (contract §7): the facade's resolution, witness and fallback contract.
//
// Three properties are asserted here and nowhere else:
//   1. the frozen witness strings, emitted EXACTLY ONCE per mode per plugin instance;
//   2. the resolution ladder (T-50): a strict hit is cached and never re-probed, a miss is NEVER
//      cached and is re-probed on the next access, and a strict-only miss + non-strict hit is the
//      PENDING window (never reported as ABSENT);
//   3. the absent-adapter column executes TODAY'S exact expressions — same receiver, same value,
//      same throw — while the adapter column routes every seam through the recorded adapter calls.
import { expect, test } from "bun:test"
import { ADAPTER_WITNESS, agentScopeOf, createAgentTeamsCtx, liveAgentOf, subagentRuntimeOf } from "../lib/mpd-adapter-ctx.js"

// Transcribed from the contract §4 table (NOT imported from the module, or the assertion would be
// circular): a reworded witness line reddens here.
const MOUNTED = "[agent-teams] adapter: mpdDsh mounted — harness seams routed through mpd-dsh-adapter"
const PENDING = "[agent-teams] adapter: mpdDsh pending (provider not ACTIVE) — serving the raw cordis ctx for now and re-probing on every access"
const ABSENT = "[agent-teams] adapter: mpdDsh ABSENT — serving the raw cordis ctx (warn once); mpd-dsh-adapter must sit ABOVE the agent-teams row"

/** A ctx whose harness seams RECORD their receiver, so "today's exact expression" is checkable. */
function rawCtx({ probe } = {}) {
    const calls = { seams: [] }
    const seam = (label) => ({
        label,
        mark: (...args) => { calls.seams.push({ label, receiver: seamRef[label], args }); return `${label}:${args.length}` },
    })
    const seamRef = {}
    const make = (label, member) => {
        const target = {
            [member]: function (...args) { calls.seams.push({ label: `${label}.${member}`, receiver: this, args }); return `${label}:${args.length}` },
        }
        return target
    }
    const tools = make("tools", "register")
    const agents = { get: function (id) { calls.seams.push({ label: "agents.get", receiver: this, args: [id] }); return { id } }, list: function () { calls.seams.push({ label: "agents.list", receiver: this, args: [] }); return ["a"] } }
    const subagents = {
        getProvider: function (name) { calls.seams.push({ label: "subagents.getProvider", receiver: this, args: [name] }); return { name } },
        list: function () { calls.seams.push({ label: "subagents.list", receiver: this, args: [] }); return ["spawn"] },
        startContinuable: function (spec) { calls.seams.push({ label: "subagents.startContinuable", receiver: this, args: [spec] }); return Promise.resolve({ childId: "c" }) },
        interrupt: function (id, authority) { calls.seams.push({ label: "subagents.interrupt", receiver: this, args: [id, authority] }); return "interrupted" },
    }
    const commands = make("commands", "register")
    const systemPrompt = make("systemPrompt", "section")
    const llm = {
        listModels: function (provider) { calls.seams.push({ label: "llm.listModels", receiver: this, args: [provider] }); return Promise.resolve([{ id: "m" }]) },
        resolveCallConfig: function (config, signal) { calls.seams.push({ label: "llm.resolveCallConfig", receiver: this, args: [config, signal] }); return Promise.resolve({ provider: "p", model: "m" }) },
    }
    const effects = []
    const ctx = {
        tools, agents, subagents, commands, systemPrompt, llm,
        logger: { warn: () => undefined, info: () => undefined, debug: () => undefined },
        effect: function (callback, label) { effects.push({ callback, label }); return () => undefined },
        get: function (name, strict) { calls.probes = (calls.probes ?? 0) + 1; return probe === undefined ? undefined : probe(name, strict) },
        inject: function (_deps, callback) { callback(ctx); return () => undefined },
        on: function (event, handler) { calls.seams.push({ label: "ctx.on", receiver: this, args: [event] }); return () => undefined },
    }
    return { ctx, calls, effects, tools, agents, subagents, commands, systemPrompt, llm }
}

/** A recording fake adapter: the twelve new seams plus the existing surface the facade uses. */
function recordingAdapter() {
    const calls = []
    const tools = []
    const sections = []
    const commands = []
    const handlers = new Map()
    const record = (name) => (...args) => { calls.push({ name, args }); return undefined }
    return {
        calls, tools, sections, commands, handlers,
        registerHostTool: (definition) => { calls.push({ name: "registerHostTool", args: [definition] }); tools.push(definition); return () => undefined },
        liveAgent: (id) => { calls.push({ name: "liveAgent", args: [id] }); return { id, via: "adapter" } },
        liveAgents: () => { calls.push({ name: "liveAgents", args: [] }); return [{ id: "a", via: "adapter" }] },
        subagentProvider: (name) => { calls.push({ name: "subagentProvider", args: [name] }); return { name, via: "adapter" } },
        subagentProviders: () => { calls.push({ name: "subagentProviders", args: [] }); return ["spawn"] },
        subagentRuntime: () => { calls.push({ name: "subagentRuntime", args: [] }); return { prompt: () => undefined, sendMessage: () => undefined } },
        startContinuableAgent: (spec) => { calls.push({ name: "startContinuableAgent", args: [spec] }); return Promise.resolve({ childId: "adapter-child" }) },
        interruptAgent: (id, authority) => { calls.push({ name: "interruptAgent", args: [id, authority] }); return undefined },
        llmListModels: (provider) => { calls.push({ name: "llmListModels", args: [provider] }); return Promise.resolve([{ id: "model-1" }]) },
        llmResolveCallConfig: (config, signal) => { calls.push({ name: "llmResolveCallConfig", args: [config, signal] }); return Promise.resolve({ provider: "p", model: "m", reasoningEffort: "high" }) },
        registerPromptSection: (section) => { calls.push({ name: "registerPromptSection", args: [section] }); sections.push(section); return () => undefined },
        registerCommand: (definition) => { calls.push({ name: "registerCommand", args: [definition] }); commands.push(definition); return () => undefined },
        onEvent: (event, handler) => { calls.push({ name: "onEvent", args: [event] }); handlers.set(event, handler); return () => undefined },
        agentScope: (agent) => { calls.push({ name: "agentScope", args: [agent] }); return { context: agent?.ctx, tools: { restrict: (filter) => { calls.push({ name: "scope.tools.restrict", args: [filter] }); return () => undefined } }, on: (event, handler) => { calls.push({ name: "scope.on", args: [event] }); return () => undefined }, effect: (fn, label) => { calls.push({ name: "scope.effect", args: [label] }); return () => undefined } } },
        startAgentTurn: (agent, message) => { calls.push({ name: "startAgentTurn", args: [agent, message] }); return undefined },
        cancelAgentTurn: (agent, cause, options) => { calls.push({ name: "cancelAgentTurn", args: [agent, cause, options] }); return undefined },
        steerAgentTurn: (agent, message) => { calls.push({ name: "steerAgentTurn", args: [agent, message] }); return undefined },
        injectAgentMessage: (agent, message) => { calls.push({ name: "injectAgentMessage", args: [agent, message] }); return undefined },
        record,
    }
}

test("AC4: the witness strings are the frozen contract §4 literals", () => {
    expect(ADAPTER_WITNESS.mounted).toBe(MOUNTED)
    expect(ADAPTER_WITNESS.pending).toBe(PENDING)
    expect(ADAPTER_WITNESS.absent).toBe(ABSENT)
})

test("AC4: the facade exposes EXACTLY the frozen property set", () => {
    const { ctx } = rawCtx()
    expect(Object.keys(createAgentTeamsCtx(ctx)).sort()).toEqual([
        "agentScope", "agents", "cancelAgentTurn", "commands", "effect", "get", "inject",
        "injectAgentMessage", "llm", "logger", "on", "startAgentTurn", "steerAgentTurn", "subagents",
        "systemPrompt", "tools",
    ])
})

test("AC4: with NO mpdDsh every seam runs today's raw expression and the ABSENT witness fires once", () => {
    const { ctx, calls, tools, agents, subagents, commands, systemPrompt, llm } = rawCtx()
    const lines = []
    const facade = createAgentTeamsCtx(ctx, { witness: (line) => lines.push(line) })
    const agent = { id: "agent-1", followup: (message) => ({ delivered: message }), cancel: (cause, options) => ({ cancelled: [cause, options] }) }

    expect(facade.tools.register({ name: "t" })).toBe("tools:1")
    expect(facade.agents.get("x")).toEqual({ id: "x" })
    expect(facade.agents.list()).toEqual(["a"])
    expect(facade.subagents.getProvider("spawn")).toEqual({ name: "spawn" })
    expect(facade.subagents.list()).toEqual(["spawn"])
    facade.subagents.startContinuable({ provider: "spawn" })
    expect(facade.subagents.interrupt("s", { kind: "ancestor" })).toBe("interrupted")
    expect(facade.subagents.runtime()).toBe(subagents)
    expect(facade.commands.register({ name: "c" })).toBe("commands:1")
    expect(facade.systemPrompt.section({ name: "s" })).toBe("systemPrompt:1")
    facade.llm.listModels("p")
    facade.llm.resolveCallConfig({ provider: "p" })
    expect(facade.on("agent/pre-step", () => undefined)()).toBeUndefined()
    // The turn seams forward EXACTLY today's expression: same receiver, same return value.
    expect(facade.startAgentTurn(agent, { m: 1 })).toEqual({ delivered: { m: 1 } })
    expect(facade.cancelAgentTurn(agent, { kind: "user" }, { keepInbox: true })).toEqual({ cancelled: [{ kind: "user" }, { keepInbox: true }] })
    expect(facade.effect(() => undefined, "label")).toBeFunction()
    expect(facade.get("mpdConfig")).toBeUndefined()
    expect(facade.logger).toBe(ctx.logger)

    // SAME RECEIVER, not merely "the same call": each recorded call saw the seam object as `this`.
    const receiverOf = (label) => calls.seams.find((entry) => entry.label === label)?.receiver
    expect(receiverOf("tools.register")).toBe(tools)
    expect(receiverOf("agents.get")).toBe(agents)
    expect(receiverOf("agents.list")).toBe(agents)
    expect(receiverOf("subagents.getProvider")).toBe(subagents)
    expect(receiverOf("subagents.startContinuable")).toBe(subagents)
    expect(receiverOf("commands.register")).toBe(commands)
    expect(receiverOf("systemPrompt.section")).toBe(systemPrompt)
    expect(receiverOf("llm.resolveCallConfig")).toBe(llm)
    // ONE absent witness for the whole instance, however many accesses ran.
    expect(lines).toEqual([ABSENT])
    expect(ctx.on).toBeDefined()
})

test("AC4: the raw fallback throws EXACTLY where today's expression throws", () => {
    const { ctx } = rawCtx()
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    // An agent without `followup`/`cancel`: the facade must not swallow the throw (contract D9).
    expect(() => facade.startAgentTurn({ id: "no-methods" }, { m: 1 })).toThrow(/followup is not a function/)
    expect(() => facade.cancelAgentTurn({ id: "no-methods" }, { kind: "user" }, {})).toThrow(/cancel is not a function/)
    // An unavailable seam object: the TypeError is the runtime's own, byte-for-byte.
    const bare = { logger: {} }
    const attempt = (call) => { try { call(); return undefined } catch (error) { return String(error) } }
    // The engine quotes the FAILING SOURCE EXPRESSION, which necessarily differs (the fallback is a
    // different expression than the caller's), so that one token is normalized away; everything else
    // — error type, failing operation, the `undefined` receiver — must match exactly.
    const normalize = (text) => text?.replace(/evaluating '[^']*'/, "evaluating '<expr>'")
    const rawThrow = attempt(() => bare.tools.register({ name: "t" }))
    const facadeThrow = attempt(() => createAgentTeamsCtx(bare, { witness: () => undefined }).tools.register({ name: "t" }))
    expect(normalize(facadeThrow)).toBe(normalize(rawThrow))
    expect(facadeThrow).toContain("undefined")
})

test("AC4: with mpdDsh mounted the facade routes every seam and prints the MOUNTED witness once", () => {
    const adapter = recordingAdapter()
    const { ctx } = rawCtx({ probe: (_name, strict) => (strict === true ? adapter : adapter) })
    const lines = []
    const facade = createAgentTeamsCtx(ctx, { witness: (line) => lines.push(line) })
    const agent = { id: "agent-1", ctx: { scoped: true }, followup: () => undefined, cancel: () => undefined }

    facade.tools.register({ name: "t" })
    facade.agents.get("x")
    facade.agents.list()
    facade.subagents.getProvider("spawn")
    facade.subagents.list()
    facade.subagents.startContinuable({ provider: "spawn" })
    facade.subagents.interrupt("s", { kind: "ancestor" })
    facade.subagents.runtime()
    facade.commands.register({ name: "c" })
    facade.systemPrompt.section({ name: "s" })
    facade.llm.listModels("p")
    facade.llm.resolveCallConfig({ provider: "p" })
    facade.on("agent/pre-step", () => undefined)
    facade.startAgentTurn(agent, { m: 1 })
    facade.cancelAgentTurn(agent, { kind: "user" }, { keepInbox: true })
    facade.agentScope(agent)

    const recorded = adapter.calls.map((call) => call.name)
    for (const name of ["registerHostTool", "liveAgent", "liveAgents", "subagentProvider", "subagentProviders",
        "startContinuableAgent", "interruptAgent", "subagentRuntime", "registerCommand", "registerPromptSection",
        "llmListModels", "llmResolveCallConfig", "onEvent", "startAgentTurn", "cancelAgentTurn", "agentScope"]) {
        expect(recorded, `adapter method ${name} was never reached`).toContain(name)
    }
    // The adapter's OWN throw/return value is what the caller sees (no wrapping, no swallowing).
    expect(recorded.filter((name) => name === "registerHostTool")).toHaveLength(1)
    expect(lines).toEqual([MOUNTED])
})

test("AC4: the adapter wins even where the raw seam object is present, so no fallback line is printed", () => {
    const adapter = recordingAdapter()
    const { ctx, calls } = rawCtx({ probe: (_name, strict) => (strict === true ? adapter : adapter) })
    const lines = []
    const facade = createAgentTeamsCtx(ctx, { witness: (line) => lines.push(line) })
    expect(facade.agents.get("x")).toEqual({ id: "x", via: "adapter" })
    expect(calls.seams).toEqual([])
    expect(lines).toEqual([MOUNTED])
})

test("AC4: a PENDING probe is not ABSENT, and the next access re-probes (T-50)", () => {
    const adapter = recordingAdapter()
    let strictReads = 0
    const { ctx } = rawCtx({
        probe: (_name, strict) => {
            // Non-strict HIT (the service is registered) + strict MISS (its fiber is not ACTIVE):
            // that is the PENDING window, never the absent case.
            if (strict !== true) return adapter
            strictReads += 1
            return strictReads >= 2 ? adapter : undefined
        },
    })
    const lines = []
    const facade = createAgentTeamsCtx(ctx, { witness: (line) => lines.push(line) })

    expect(facade.agents.get("first")).toEqual({ id: "first" }) // raw lane: the adapter is not usable yet
    expect(lines).toEqual([PENDING])
    const before = strictReads
    facade.agents.get("second")
    expect(strictReads, "a miss must be re-probed on EVERY access").toBeGreaterThan(before)
    expect(lines).toEqual([PENDING, MOUNTED])
    // The successful read is cached: no further probe, no further line.
    const settled = strictReads
    facade.agents.get("third")
    facade.agents.get("fourth")
    expect(strictReads).toBe(settled)
    expect(lines).toEqual([PENDING, MOUNTED])
})

test("AC4: the absent witness reaches the console by default (greppable in a boot log)", () => {
    const { ctx } = rawCtx()
    const warnings = []
    const logs = []
    const warn = console.warn
    const log = console.log
    console.warn = (line) => warnings.push(line)
    console.log = (line) => logs.push(line)
    try {
        createAgentTeamsCtx(ctx).agents.list()
        createAgentTeamsCtx(ctx).agents.list() // same resolveCtx: still ONE line per plugin instance
    }
    finally {
        console.warn = warn
        console.log = log
    }
    expect(warnings).toEqual([ABSENT])
    expect(logs).toEqual([])
})

test("AC4: the fallback lane forwards listener options and always returns a disposer", () => {
    const seen = []
    const ctx = {
        logger: {},
        get: () => undefined,
        on: (event, handler, options) => { seen.push([event, options]); return undefined },
    }
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    const dispose = facade.on("agent/pre-step", () => undefined, { global: true, prepend: true })
    // Dropping the third argument would silently change which events this plugin hears.
    expect(seen).toEqual([["agent/pre-step", { global: true, prepend: true }]])
    expect(typeof dispose).toBe("function")
})

test("AC4: inject hands the callback an already-wrapped scoped ctx (no call-site edit)", () => {
    const adapter = recordingAdapter()
    const root = rawCtx({ probe: (_name, strict) => (strict === true ? adapter : adapter) })
    let seen
    const facade = createAgentTeamsCtx(root.ctx, { witness: () => undefined })
    facade.inject(["commands"], (scoped) => { seen = scoped })
    expect(typeof seen.commands.register).toBe("function")
    seen.commands.register({ name: "scoped" })
    expect(adapter.calls.some((call) => call.name === "registerCommand")).toBe(true)
    // The scoped ctx never touches its own seams either.
    expect(root.calls.seams).toEqual([])
})

test("AC4: an adapter that cannot serve one seam degrades to the raw expression for that seam only", () => {
    const adapter = recordingAdapter()
    delete adapter.registerHostTool // an older adapter: the tool plane was never added
    const { ctx, tools } = rawCtx({ probe: (_name, strict) => (strict === true ? adapter : adapter) })
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    expect(facade.tools.register({ name: "t" })).toBe("tools:1")
    expect(tools.register).toBeDefined()
    expect(facade.agents.get("x")).toEqual({ id: "x", via: "adapter" })
})

test("F2: steerAgentTurn / injectAgentMessage route to the adapter and keep today's throw", () => {
    const adapter = recordingAdapter()
    const facade = createAgentTeamsCtx(rawCtx({ probe: () => adapter }).ctx, { witness: () => undefined })
    const agent = { id: "captain", steer: (message) => ({ steered: message }), inject: (message) => ({ injected: message }) }
    expect(facade.steerAgentTurn(agent, { m: 1 })).toBeUndefined()
    expect(facade.injectAgentMessage(agent, { m: 2 })).toBeUndefined()
    const recorded = adapter.calls.map((call) => call.name)
    expect(recorded).toContain("steerAgentTurn")
    expect(recorded).toContain("injectAgentMessage")
    // No adapter: today's EXACT expressions, including the throw.
    const absent = createAgentTeamsCtx(rawCtx().ctx, { witness: () => undefined })
    expect(absent.steerAgentTurn(agent, { m: 1 })).toEqual({ steered: { m: 1 } })
    expect(absent.injectAgentMessage(agent, { m: 2 })).toEqual({ injected: { m: 2 } })
    expect(() => absent.steerAgentTurn({ id: "no-methods" }, { m: 1 })).toThrow(/steer is not a function/)
    expect(() => absent.injectAgentMessage({ id: "no-methods" }, { m: 1 })).toThrow(/inject is not a function/)
    // A capability flag the adapter reports as FALSE is a real degrade, not a silent no-op.
    const disabled = recordingAdapter()
    disabled.capabilities = () => ({ agentTurnSteer: false, agentTurnInject: false })
    const gated = createAgentTeamsCtx(rawCtx({ probe: () => disabled }).ctx, { witness: () => undefined })
    expect(gated.steerAgentTurn(agent, { m: 1 })).toEqual({ steered: { m: 1 } })
    expect(disabled.calls.some((call) => call.name === "steerAgentTurn")).toBe(false)
})

test("F1: agentScopeOf returns ONE shape in ALL THREE arms (mounted / pending / absent-with-a-throwing-proxy)", () => {
    // Receiver discipline (the captain's ruling): `restrict` must run on the CAPTURED ctx.tools
    // object and `on`/`effect` must run BOUND to the raw agent ctx — recorded as `this` here.
    const receivers = []
    const toolsProxy = {
        restrict: function (filter) { receivers.push(["tools.restrict", this]); return () => undefined },
    }
    const scoped = {
        tools: toolsProxy,
        on: function (event) { receivers.push(["on", this]); return () => undefined },
        effect: function (label) { receivers.push(["effect", this]); return () => undefined },
    }
    const agent = { id: "agent-1", ctx: scoped }
    const shapeKeys = (scope) => Object.keys(scope).sort()
    // ARM 1 — MOUNTED: the adapter's own scope, used as returned when usable.
    const adapter = recordingAdapter()
    const mounted = agentScopeOf(createAgentTeamsCtx(rawCtx({ probe: () => adapter }).ctx, { witness: () => undefined }), agent)
    expect(shapeKeys(mounted)).toEqual(["context", "effect", "on", "tools"])
    expect(mounted.context).toBe(scoped)
    // ARM 2 — PENDING (registered, provider not ACTIVE): the shape is BUILT from the raw ctx.
    const pendingFacade = createAgentTeamsCtx(rawCtx({ probe: (_n, strict) => (strict === true ? undefined : adapter) }).ctx, { witness: () => undefined })
    const pending = agentScopeOf(pendingFacade, agent)
    expect(shapeKeys(pending)).toEqual(shapeKeys(mounted))
    expect(pending.context).toBe(scoped)
    // ARM 3 — ABSENT-with-a-throwing-proxy: the raw ctx throws on any undeclared read (the harness's
    // own shape: `childCtx.agent` -> "cannot get property \"agent\" without inject"), so a plain
    // `ctx.agentScope(agent) ?? agent?.ctx` fallback could not even be READ. Still: one shape, identity
    // `context`, and NO property read throws.
    const hostile = new Proxy({}, {
        get(_target, prop) {
            if (prop === "tools")
                return { restrict: () => () => undefined }
            throw new Error(`hostile ctx member read: ${String(prop)}`)
        },
    })
    const hostileScope = agentScopeOf({}, { id: "agent-2", ctx: hostile })
    expect(shapeKeys(hostileScope)).toEqual(shapeKeys(mounted))
    expect(hostileScope.context).toBe(hostile)
    expect(() => hostileScope.context).not.toThrow()
    expect(typeof hostileScope.tools.restrict).toBe("function")
    expect(typeof hostileScope.on).toBe("function")
    expect(typeof hostileScope.effect).toBe("function")
    // EVERY arm keeps the per-member semantics the call sites rely on — INCLUDING the receiver:
    // `restrict` runs on the captured `ctx.tools` object, `on`/`effect` on the agent ctx itself.
    expect(pending.tools.restrict({ deny: ["x"] })).toBeFunction()
    expect(pending.on("agent/request", () => undefined)).toBeFunction()
    expect(pending.effect(() => undefined, "label")).toBeFunction()
    expect(receivers).toEqual([
        ["tools.restrict", toolsProxy],
        ["on", scoped],
        ["effect", scoped],
    ])
    // The same discipline in the absent arm (a plain-object ctx: every pre-existing unit test).
    receivers.length = 0
    const plain = agentScopeOf({}, agent)
    plain.tools.restrict({ allow: ["read"] })
    plain.on("agent/request", () => undefined)
    plain.effect(() => undefined, "lifetime")
    expect(receivers).toEqual([
        ["tools.restrict", toolsProxy],
        ["on", scoped],
        ["effect", scoped],
    ])
    // An adapter that answers an UNUSABLE scope falls through to the built shape, never to a raw ctx.
    const partial = { ...adapter, agentScope: () => ({ context: scoped }) }
    const partialScope = agentScopeOf(createAgentTeamsCtx(rawCtx({ probe: () => partial }).ctx, { witness: () => undefined }), agent)
    expect(shapeKeys(partialScope)).toEqual(shapeKeys(mounted))
    expect(partialScope.context).toBe(scoped)
    // A plain-object ctx (every pre-existing unit test) gets the built shape from the SAME members.
    expect(shapeKeys(agentScopeOf({}, agent))).toEqual(shapeKeys(mounted))
    expect(agentScopeOf({}, agent).context).toBe(scoped)
    expect(agentScopeOf(undefined, undefined).context).toBeUndefined()
})

test("AC4: subagentRuntimeOf resolves the runtime, never the facade's projection", () => {
    const runtime = { prompt: () => undefined, sendMessage: () => undefined }
    const raw = { subagents: runtime }
    expect(subagentRuntimeOf(raw)).toBe(runtime)
    const facade = createAgentTeamsCtx({ subagents: runtime, logger: {} }, { witness: () => undefined })
    expect(subagentRuntimeOf(facade)).toBe(runtime)
    expect(facade.subagents.runtime()).toBe(runtime)
})

test("AC4: liveAgentOf routes the sender lookup and keeps the plain-ctx lookup expression working", () => {
    const adapter = recordingAdapter()
    const facade = createAgentTeamsCtx(rawCtx({ probe: () => adapter }).ctx, { witness: () => undefined })
    expect(liveAgentOf(facade, "captain")).toEqual({ id: "captain", via: "adapter" })
    // Today's expression, for the plain-object ctx every pre-existing unit test hands the guard.
    const owner = { id: "captain" }
    expect(liveAgentOf({ get: (name) => (name === "agents" ? { get: (id) => owner } : undefined) }, "captain")).toBe(owner)
    expect(liveAgentOf({ get: () => undefined }, "captain")).toBeUndefined()
    expect(liveAgentOf({}, "captain")).toBeUndefined()
})

test("BR-1: a substituted NO-OP member is reported ONCE per plugin instance, NAMED, and never throws", () => {
    // (b) HAPPY PATH: a ctx providing every member substitutes nothing and stays silent.
    const happyLines = []
    const full = {
        tools: { restrict: function (filter) { return () => undefined } },
        on: function (event) { return () => undefined },
        effect: function (label) { return () => undefined },
    }
    const happyFacade = createAgentTeamsCtx(rawCtx().ctx, { witness: (line) => happyLines.push(line) })
    const happyScope = happyFacade.agentScope({ id: "agent-happy", ctx: full })
    expect(Object.keys(happyScope).sort()).toEqual(["context", "effect", "on", "tools"])
    expect(happyScope.context).toBe(full)
    expect(happyLines.filter((line) => line.includes("MEMBER PRIVILEGE LOSS"))).toEqual([])

    // (a) DEGRADE: `tools.restrict` cannot be provided → the ONE warning NAMES it, and the uniform
    // shape is still returned with `context` identity preserved (the tolerance is not narrowed to a
    // throw: a missing seam degrades with a warning instead of taking the tree down).
    const lines = []
    const degraded = { tools: {}, on: () => () => undefined, effect: () => () => undefined }
    const facade = createAgentTeamsCtx(rawCtx().ctx, { witness: (line) => lines.push(line) })
    const first = facade.agentScope({ id: "agent-1", ctx: degraded })
    facade.agentScope({ id: "agent-2", ctx: degraded }) // same plugin instance: still ONE line
    const loss = lines.filter((line) => line.includes("MEMBER PRIVILEGE LOSS"))
    expect(loss).toHaveLength(1)
    expect(loss[0]).toContain("[substituted: tools.restrict]")
    expect(Object.keys(first).sort()).toEqual(["context", "effect", "on", "tools"])
    expect(first.context).toBe(degraded)
    expect(typeof first.tools.restrict).toBe("function")
    expect(() => first.tools.restrict({ deny: ["x"] })).not.toThrow()

    // A THROWING member degrades per member (never a throw) and reports through the SAME sink.
    const hostile = new Proxy({}, {
        get(_target, prop) {
            if (prop === "tools")
                return { restrict: () => () => undefined }
            throw new Error(`hostile ctx member read: ${String(prop)}`)
        },
    })
    const hostileLines = []
    const hostileFacade = createAgentTeamsCtx(rawCtx().ctx, { witness: (line) => hostileLines.push(line) })
    const hostileScope = hostileFacade.agentScope({ id: "agent-3", ctx: hostile })
    const hostileLoss = hostileLines.filter((line) => line.includes("MEMBER PRIVILEGE LOSS"))
    expect(hostileLoss).toHaveLength(1)
    expect(hostileLoss[0]).toContain("on")
    expect(hostileLoss[0]).toContain("effect")
    expect(hostileScope.context).toBe(hostile)
    expect(typeof hostileScope.on).toBe("function")
    expect(typeof hostileScope.effect).toBe("function")
})
