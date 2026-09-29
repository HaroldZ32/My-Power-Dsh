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
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { ADAPTER_WITNESS, agentScopeOf, createAgentTeamsCtx, liveAgentOf, subagentRuntimeOf } from "../lib/mpd-adapter-ctx.ts"

// Transcribed from the contract §4 table (NOT imported from the module, or the assertion would be
// circular): a reworded witness line reddens here.
/** The MOUNTED witness line: a mounted `mpdDsh` service routes every seam through the adapter. */
const MOUNTED = "[agent-teams] adapter: mpdDsh mounted — harness seams routed through mpd-dsh-adapter"
/** The PENDING witness line: the service is registered but its fiber is not ACTIVE yet. */
const PENDING = "[agent-teams] adapter: mpdDsh pending (provider not ACTIVE) — serving the raw cordis ctx for now and re-probing on every access"
/** The ABSENT witness line: no adapter at all, so the raw cordis ctx is served. */
const ABSENT = "[agent-teams] adapter: mpdDsh ABSENT — serving the raw cordis ctx (warn once); mpd-dsh-adapter must sit ABOVE the agent-teams row"

/** One seam call the raw fixture recorded: its label, the `this` it ran on and its arguments. */
interface SeamCall {
    /** The `"<seam>.<member>"` label identifying which seam was touched. */
    readonly label: string
    /** The `this` the seam method ran on, asserted to be the seam object itself. */
    readonly receiver: unknown
    /** The arguments the seam method received, kept for arity assertions. */
    readonly args: unknown[]
}

/** The raw fixture's recording surface, including the probe counter the ladder arms read. */
interface RawCalls {
    /** Every seam call the fixture observed, in call order. */
    readonly seams: SeamCall[]
    /** How many times `ctx.get` was probed; only the ladder arms ever set it. */
    probes?: number
}

/** The raw ctx the fixture hands the facade: only `logger` and `on` are read back by the assertions. */
interface RawFixtureCtx {
    /** The logger the facade must forward BY IDENTITY, never wrap. */
    readonly logger: unknown
    /** The event seam, asserted to be present on the raw ctx even when no adapter is mounted. */
    readonly on: unknown
}

/** Everything one `rawCtx()` call builds, named so the tests can destructure it. */
interface RawFixture {
    /** The raw ctx handed to the facade (or to the vendored facade factory). */
    readonly ctx: RawFixtureCtx
    /** The seam-call recorder plus its probe counter. */
    readonly calls: RawCalls
    /** Lifetimes registered through the fake `effect`, never disposed by these tests. */
    readonly effects: unknown[]
    /** The tool seam built by `make`, keyed by member name and compared by identity. */
    readonly tools: Readonly<Record<string, (...args: unknown[]) => unknown>>
    /** The agent seam object. */
    readonly agents: unknown
    /** The subagent seam object, whose `runtime()` must answer the runtime itself. */
    readonly subagents: unknown
    /** The command seam object. */
    readonly commands: unknown
    /** The prompt-section seam object. */
    readonly systemPrompt: unknown
    /** The model-catalog seam object. */
    readonly llm: unknown
}

/** One adapter method call recorded by the fake adapter: its name and its arguments. */
interface AdapterCall {
    /** The adapter method that was invoked. */
    readonly name: string
    /** The arguments of the call, kept for the per-seam roll-up. */
    readonly args: unknown[]
}

/** The fake adapter the facade resolves: every seam it answers, plus the recorded call list. */
interface RecordingAdapter {
    /** Every adapter method call, in call order, with its arguments. */
    readonly calls: AdapterCall[]
    /** Tool definitions captured by the host-tool seam. */
    readonly tools: unknown[]
    /** Prompt sections captured by the section seam. */
    readonly sections: unknown[]
    /** Command definitions captured by the command seam. */
    readonly commands: unknown[]
    /** Event handlers captured by the event seam, keyed by event name. */
    readonly handlers: Map<string, unknown>
    /** Host-tool registration, OPTIONAL because one arm deletes it to emulate an older adapter. */
    registerHostTool?: (definition: unknown) => () => void
    /** Live-agent lookup by id. */
    liveAgent: (id: string) => unknown
    /** The live-agent list the facade projects. */
    liveAgents: () => unknown[]
    /** Subagent provider lookup by name. */
    subagentProvider: (name: string) => unknown
    /** The registered provider names. */
    subagentProviders: () => string[]
    /** The delivery runtime object handed to the ladder. */
    subagentRuntime: () => unknown
    /** Start a continuable child agent for a member. */
    startContinuableAgent: (spec: unknown) => Promise<unknown>
    /** Interrupt a live child by id. */
    interruptAgent: (id: string, authority: unknown) => unknown
    /** Model-catalog listing for one provider. */
    llmListModels: (provider: string) => Promise<unknown[]>
    /** Call-config resolution for one request. */
    llmResolveCallConfig: (config: unknown, signal: unknown) => Promise<unknown>
    /** The prompt-section seam the facade bridges; the answer is its deregistration hook. */
    registerPromptSection: (section: unknown) => () => void
    /** The slash-command seam the facade bridges; the answer is its deregistration hook. */
    registerCommand: (definition: unknown) => () => void
    /** The adapter event seam the facade bridges; the answer is its unsubscribe hook. */
    onEvent: (event: string, handler: unknown) => () => void
    /** Per-agent scope construction. */
    agentScope: (agent: { readonly ctx?: unknown } | undefined) => unknown
    /** Turn submission on an agent handle. */
    startAgentTurn: (agent: unknown, message: unknown) => unknown
    /** Turn cancellation, used by the halt path. */
    cancelAgentTurn: (agent: unknown, cause: unknown, options: unknown) => unknown
    /** Turn steering, used by the member-report path. */
    steerAgentTurn: (agent: unknown, message: unknown) => unknown
    /** Message injection into a running turn. */
    injectAgentMessage: (agent: unknown, message: unknown) => unknown
    /** Build a seam that appends one call record and answers `undefined`. */
    record: (name: string) => (...args: unknown[]) => void
    /** The capability probe, installed only by the F2 degrade arm. */
    capabilities?: () => unknown
}

/** The scoped ctx the facade's `inject` hands the callback: only the command seam is driven. */
interface ScopedCtx {
    /** Scoped command registration, the one member the test calls. */
    readonly commands: { readonly register: (definition: unknown) => unknown }
}

/** A ctx whose harness seams RECORD their receiver, so "today's exact expression" is checkable. */
function rawCtx({ probe }: { probe?: (name: string, strict: unknown) => unknown } = {}): RawFixture {
    /** The recorded seam calls, plus the probe counter `ctx.get` increments. */
    const calls: RawCalls = { seams: [] }
    /** A fixture seam helper carrying its own label; kept as a named arm for the receiver check. */
    const seam = (label: string): { readonly label: string; readonly mark: (...args: unknown[]) => string } => ({
        label,
        mark: (...args: unknown[]) => { calls.seams.push({ label, receiver: seamRef[label], args }); return `${label}:${args.length}` },
    })
    /** The labelled seam objects, so the `seam` helper can resolve a receiver by label. */
    const seamRef: Record<string, unknown> = {}
    /** Build a one-member seam object whose method records the RECEIVER it ran on. */
    const make = (label: string, member: string): Record<string, (...args: unknown[]) => string> => {
        /** The seam object, keyed by the member name so the spelling under test is preserved. */
        const target = {
            [member]: function (...args: unknown[]) { calls.seams.push({ label: `${label}.${member}`, receiver: this, args }); return `${label}:${args.length}` },
        }
        return target
    }
    /** The tool seam, whose `register` is called through the facade. */
    const tools = make("tools", "register")
    /** The agent seam, whose lookups record the agent seam object as their receiver. */
    const agents = { get: function (id: string) { calls.seams.push({ label: "agents.get", receiver: this, args: [id] }); return { id } }, list: function () { calls.seams.push({ label: "agents.list", receiver: this, args: [] }); return ["a"] } }
    /** The subagent seam: provider lookup, listing, continuable start and interrupt. */
    const subagents = {
        getProvider: function (name: string) { calls.seams.push({ label: "subagents.getProvider", receiver: this, args: [name] }); return { name } },
        list: function () { calls.seams.push({ label: "subagents.list", receiver: this, args: [] }); return ["spawn"] },
        startContinuable: function (spec: unknown) { calls.seams.push({ label: "subagents.startContinuable", receiver: this, args: [spec] }); return Promise.resolve({ childId: "c" }) },
        interrupt: function (id: string, authority: unknown) { calls.seams.push({ label: "subagents.interrupt", receiver: this, args: [id, authority] }); return "interrupted" },
    }
    /** The command seam, whose `register` is called through the facade. */
    const commands = make("commands", "register")
    /** The prompt-section seam, whose `section` is called through the facade. */
    const systemPrompt = make("systemPrompt", "section")
    /** The model seam: catalog listing and call-config resolution. */
    const llm = {
        listModels: function (provider: string) { calls.seams.push({ label: "llm.listModels", receiver: this, args: [provider] }); return Promise.resolve([{ id: "m" }]) },
        resolveCallConfig: function (config: unknown, signal: unknown) { calls.seams.push({ label: "llm.resolveCallConfig", receiver: this, args: [config, signal] }); return Promise.resolve({ provider: "p", model: "m" }) },
    }
    /** Lifetimes the fake `effect` collected, kept so the ctx shape matches the real one. */
    const effects: Array<{ callback: () => (() => void) | undefined; label: string }> = []
    /** The raw ctx itself: every seam object above plus the cordis-core members the facade forwards. */
    const ctx = {
        tools, agents, subagents, commands, systemPrompt, llm,
        logger: { warn: () => undefined, info: () => undefined, debug: () => undefined },
        effect: function (callback: () => (() => void) | undefined, label: string) { effects.push({ callback, label }); return () => undefined },
        get: function (name: string, strict: unknown) { calls.probes = (calls.probes ?? 0) + 1; return probe === undefined ? undefined : probe(name, strict) },
        inject: function (_deps: unknown, callback: (inner: unknown) => void) { callback(ctx); return () => undefined },
        on: function (event: string, handler: unknown) { calls.seams.push({ label: "ctx.on", receiver: this, args: [event] }); return () => undefined },
    }
    return { ctx, calls, effects, tools, agents, subagents, commands, systemPrompt, llm }
}

/** A recording fake adapter: the twelve new seams plus the existing surface the facade uses. */
function recordingAdapter(): RecordingAdapter {
    /** Every adapter method call, in order. */
    const calls: AdapterCall[] = []
    /** Tool definitions captured by the host-tool seam. */
    const tools: unknown[] = []
    /** Prompt sections captured by the section seam. */
    const sections: unknown[] = []
    /** Command definitions captured by the command seam. */
    const commands: unknown[] = []
    /** Event handlers captured by the event seam, keyed by event name. */
    const handlers = new Map<string, unknown>()
    /** Build a seam that appends one call record and answers `undefined`. */
    const record = (name: string): ((...args: unknown[]) => undefined) => (...args: unknown[]) => { calls.push({ name, args }); return undefined }
    return {
        calls, tools, sections, commands, handlers,
        registerHostTool: (definition: unknown) => { calls.push({ name: "registerHostTool", args: [definition] }); tools.push(definition); return () => undefined },
        liveAgent: (id: string) => { calls.push({ name: "liveAgent", args: [id] }); return { id, via: "adapter" } },
        liveAgents: () => { calls.push({ name: "liveAgents", args: [] }); return [{ id: "a", via: "adapter" }] },
        subagentProvider: (name: string) => { calls.push({ name: "subagentProvider", args: [name] }); return { name, via: "adapter" } },
        subagentProviders: () => { calls.push({ name: "subagentProviders", args: [] }); return ["spawn"] },
        subagentRuntime: () => { calls.push({ name: "subagentRuntime", args: [] }); return { prompt: () => undefined, sendMessage: () => undefined } },
        startContinuableAgent: (spec: unknown) => { calls.push({ name: "startContinuableAgent", args: [spec] }); return Promise.resolve({ childId: "adapter-child" }) },
        interruptAgent: (id: string, authority: unknown) => { calls.push({ name: "interruptAgent", args: [id, authority] }); return undefined },
        llmListModels: (provider: string) => { calls.push({ name: "llmListModels", args: [provider] }); return Promise.resolve([{ id: "model-1" }]) },
        llmResolveCallConfig: (config: unknown, signal: unknown) => { calls.push({ name: "llmResolveCallConfig", args: [config, signal] }); return Promise.resolve({ provider: "p", model: "m", reasoningEffort: "high" }) },
        registerPromptSection: (section: unknown) => { calls.push({ name: "registerPromptSection", args: [section] }); sections.push(section); return () => undefined },
        registerCommand: (definition: unknown) => { calls.push({ name: "registerCommand", args: [definition] }); commands.push(definition); return () => undefined },
        onEvent: (event: string, handler: unknown) => { calls.push({ name: "onEvent", args: [event] }); handlers.set(event, handler); return () => undefined },
        agentScope: (agent: { readonly ctx?: unknown } | undefined) => { calls.push({ name: "agentScope", args: [agent] }); return { context: agent?.ctx, tools: { restrict: (filter: unknown) => { calls.push({ name: "scope.tools.restrict", args: [filter] }); return () => undefined } }, on: (event: string, handler: unknown) => { calls.push({ name: "scope.on", args: [event] }); return () => undefined }, effect: (fn: unknown, label: string) => { calls.push({ name: "scope.effect", args: [label] }); return () => undefined } } },
        startAgentTurn: (agent: unknown, message: unknown) => { calls.push({ name: "startAgentTurn", args: [agent, message] }); return undefined },
        cancelAgentTurn: (agent: unknown, cause: unknown, options: unknown) => { calls.push({ name: "cancelAgentTurn", args: [agent, cause, options] }); return undefined },
        steerAgentTurn: (agent: unknown, message: unknown) => { calls.push({ name: "steerAgentTurn", args: [agent, message] }); return undefined },
        injectAgentMessage: (agent: unknown, message: unknown) => { calls.push({ name: "injectAgentMessage", args: [agent, message] }); return undefined },
        record,
    }
}

test("AC4: the witness strings are the frozen contract §4 literals", () => {
    expect(ADAPTER_WITNESS.mounted).toBe(MOUNTED)
    expect(ADAPTER_WITNESS.pending).toBe(PENDING)
    expect(ADAPTER_WITNESS.absent).toBe(ABSENT)
})

test("AC4: the facade exposes EXACTLY the frozen property set", () => {
    /** The raw fixture whose ctx the facade is built over. */
    const { ctx } = rawCtx()
    expect(Object.keys(createAgentTeamsCtx(ctx)).sort()).toEqual([
        "agentScope", "agents", "cancelAgentTurn", "commands", "effect", "get", "inject",
        "injectAgentMessage", "llm", "logger", "on", "startAgentTurn", "steerAgentTurn", "subagents",
        "systemPrompt", "tools",
    ])
})

test("AC4: with NO mpdDsh every seam runs today's raw expression and the ABSENT witness fires once", () => {
    /** The raw fixture: its ctx, its seam recorder and every seam object by identity. */
    const { ctx, calls, tools, agents, subagents, commands, systemPrompt, llm } = rawCtx()
    /** The witness lines the facade emitted, in order. */
    const lines: string[] = []
    /** The facade over a ctx with NO adapter, which must fall back to the raw expressions. */
    const facade = createAgentTeamsCtx(ctx, { witness: (line: string) => lines.push(line) })
    /** A stub agent whose turn hooks are read back by the assertion. */
    const agent = { id: "agent-1", followup: (message: unknown) => ({ delivered: message }), cancel: (cause: unknown, options: unknown) => ({ cancelled: [cause, options] }) }

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
    /** The recorded receiver of one labelled seam call, or undefined when it never ran. */
    const receiverOf = (label: string): unknown => calls.seams.find((entry) => entry.label === label)?.receiver
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
    /** The raw fixture whose ctx the facade is built over. */
    const { ctx } = rawCtx()
    /** The facade over a ctx with NO adapter. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    // An agent without `followup`/`cancel`: the facade must not swallow the throw (contract D9).
    expect(() => facade.startAgentTurn({ id: "no-methods" }, { m: 1 })).toThrow(/followup is not a function/)
    expect(() => facade.cancelAgentTurn({ id: "no-methods" }, { kind: "user" }, {})).toThrow(/cancel is not a function/)
    // An unavailable seam object: the TypeError is the runtime's own, byte-for-byte.
    // The fixture deliberately has NO `tools` member at runtime — the raw fallback's TypeError IS the
    // assertion — so the cast states the shape the raw expression ASSUMES, not the shape the value has.
    /** A ctx carrying only a logger, so every other seam is `undefined` at runtime. */
    const bare = { logger: {} } as { logger: unknown; tools: { register: (definition: unknown) => unknown } }
    /** Run one call and capture the throw as text, answering undefined when it did not throw. */
    const attempt = (call: () => unknown): string | undefined => { try { call(); return undefined } catch (error) { return String(error) } }
    // The engine quotes the FAILING SOURCE EXPRESSION, which necessarily differs (the fallback is a
    // different expression than the caller's), so that one token is normalized away; everything else
    // — error type, failing operation, the `undefined` receiver — must match exactly.
    /** Normalize the quoted source expression away, keeping error type and operation comparable. */
    const normalize = (text: string | undefined): string | undefined => text?.replace(/evaluating '[^']*'/, "evaluating '<expr>'")
    /** The raw expression's throw text, the reference side of the comparison. */
    const rawThrow = attempt(() => bare.tools.register({ name: "t" }))
    /** The facade's throw text for the same call. */
    const facadeThrow = attempt(() => createAgentTeamsCtx(bare, { witness: () => undefined }).tools.register({ name: "t" }))
    expect(normalize(facadeThrow)).toBe(normalize(rawThrow))
    expect(facadeThrow).toContain("undefined")
})

test("AC4: with mpdDsh mounted the facade routes every seam and prints the MOUNTED witness once", () => {
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The raw fixture whose ctx is probed, always answering the adapter. */
    const { ctx } = rawCtx({ probe: (_name: string, strict: unknown) => (strict === true ? adapter : adapter) })
    /** The witness lines the facade emitted, in order. */
    const lines: string[] = []
    /** The facade over the mounted adapter. */
    const facade = createAgentTeamsCtx(ctx, { witness: (line: string) => lines.push(line) })
    /** The agent whose turn seams are driven below. */
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

    /** Every adapter seam name that was reached, in call order. */
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
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The raw fixture whose ctx is probed, always answering the adapter. */
    const { ctx, calls } = rawCtx({ probe: (_name: string, strict: unknown) => (strict === true ? adapter : adapter) })
    /** The witness lines the facade emitted, in order. */
    const lines: string[] = []
    /** The facade over the mounted adapter. */
    const facade = createAgentTeamsCtx(ctx, { witness: (line: string) => lines.push(line) })
    expect(facade.agents.get("x")).toEqual({ id: "x", via: "adapter" })
    expect(calls.seams).toEqual([])
    expect(lines).toEqual([MOUNTED])
})

test("AC4: a PENDING probe is not ABSENT, and the next access re-probes (T-50)", () => {
    /** The recording adapter the probe answers with. */
    const adapter = recordingAdapter()
    /** How many times the STRICT probe ran; the ladder's caching contract is read from it. */
    let strictReads = 0
    /** The raw fixture whose probe reports PENDING until the second strict read. */
    const { ctx } = rawCtx({
        probe: (_name: string, strict: unknown) => {
            // Non-strict HIT (the service is registered) + strict MISS (its fiber is not ACTIVE):
            // that is the PENDING window, never the absent case.
            if (strict !== true) return adapter
            strictReads += 1
            return strictReads >= 2 ? adapter : undefined
        },
    })
    /** The witness lines the facade emitted, in order. */
    const lines: string[] = []
    /** The facade over the pending-then-mounted adapter. */
    const facade = createAgentTeamsCtx(ctx, { witness: (line: string) => lines.push(line) })

    expect(facade.agents.get("first")).toEqual({ id: "first" }) // raw lane: the adapter is not usable yet
    expect(lines).toEqual([PENDING])
    /** The strict-read count before the second access, so growth is measured. */
    const before = strictReads
    facade.agents.get("second")
    expect(strictReads, "a miss must be re-probed on EVERY access").toBeGreaterThan(before)
    expect(lines).toEqual([PENDING, MOUNTED])
    // The successful read is cached: no further probe, no further line.
    /** The strict-read count once the hit is cached, which later accesses must not move. */
    const settled = strictReads
    facade.agents.get("third")
    facade.agents.get("fourth")
    expect(strictReads).toBe(settled)
    expect(lines).toEqual([PENDING, MOUNTED])
})

test("AC4: the absent witness reaches the console by default (greppable in a boot log)", () => {
    /** The raw fixture whose ctx the facade is built over. */
    const { ctx } = rawCtx()
    /** The lines `console.warn` received while the facade was built. */
    const warnings: string[] = []
    /** The lines `console.log` received, asserted to stay empty. */
    const logs: string[] = []
    /** The original `console.warn`, restored by the `finally` below. */
    const warn = console.warn
    /** The original `console.log`, restored by the `finally` below. */
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
    /** The `[event, options]` pairs the raw ctx's `on` received, in call order. */
    const seen: Array<[unknown, unknown]> = []
    /** A minimal raw ctx whose `on` records the listener options it was handed. */
    const ctx = {
        logger: {},
        get: () => undefined,
        on: (event: string, handler: unknown, options: unknown) => { seen.push([event, options]); return undefined },
    }
    /** The facade over that minimal ctx. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    /** The disposer the facade answered, asserted to be a function. */
    const dispose = facade.on("agent/pre-step", () => undefined, { global: true, prepend: true })
    // Dropping the third argument would silently change which events this plugin hears.
    expect(seen).toEqual([["agent/pre-step", { global: true, prepend: true }]])
    expect(typeof dispose).toBe("function")
})

test("AC4: inject hands the callback an already-wrapped scoped ctx (no call-site edit)", () => {
    /** The recording adapter the probe answers with. */
    const adapter = recordingAdapter()
    /** The raw fixture whose ctx is probed, always answering the adapter. */
    const root = rawCtx({ probe: (_name: string, strict: unknown) => (strict === true ? adapter : adapter) })
    // The inject callback runs synchronously, which the checker cannot see from the call site, so the
    // definite-assignment assertion states what the call order guarantees.
    /** The scoped ctx the callback received, which the assertions below drive. */
    let seen!: ScopedCtx
    /** The facade over the mounted adapter. */
    const facade = createAgentTeamsCtx(root.ctx, { witness: () => undefined })
    facade.inject(["commands"], (scoped: ScopedCtx) => { seen = scoped })
    expect(typeof seen.commands.register).toBe("function")
    seen.commands.register({ name: "scoped" })
    expect(adapter.calls.some((call) => call.name === "registerCommand")).toBe(true)
    // The scoped ctx never touches its own seams either.
    expect(root.calls.seams).toEqual([])
})

test("AC4: an adapter that cannot serve one seam degrades to the raw expression for that seam only", () => {
    /** The recording adapter whose tool plane is deleted below. */
    const adapter = recordingAdapter()
    delete adapter.registerHostTool // an older adapter: the tool plane was never added
    /** The raw fixture whose ctx still carries a working tool seam. */
    const { ctx, tools } = rawCtx({ probe: (_name: string, strict: unknown) => (strict === true ? adapter : adapter) })
    /** The facade over the crippled adapter. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    expect(facade.tools.register({ name: "t" })).toBe("tools:1")
    expect(tools.register).toBeDefined()
    expect(facade.agents.get("x")).toEqual({ id: "x", via: "adapter" })
})

test("F2: steerAgentTurn / injectAgentMessage route to the adapter and keep today's throw", () => {
    /** The recording adapter the probe answers with. */
    const adapter = recordingAdapter()
    /** The facade over the mounted adapter. */
    const facade = createAgentTeamsCtx(rawCtx({ probe: () => adapter }).ctx, { witness: () => undefined })
    /** A stub agent carrying the `steer`/`inject` hooks the fallback path calls. */
    const agent = { id: "captain", steer: (message: unknown) => ({ steered: message }), inject: (message: unknown) => ({ injected: message }) }
    expect(facade.steerAgentTurn(agent, { m: 1 })).toBeUndefined()
    expect(facade.injectAgentMessage(agent, { m: 2 })).toBeUndefined()
    /** Every adapter seam name that was reached, in call order. */
    const recorded = adapter.calls.map((call) => call.name)
    expect(recorded).toContain("steerAgentTurn")
    expect(recorded).toContain("injectAgentMessage")
    // No adapter: today's EXACT expressions, including the throw.
    /** The facade over a ctx with NO adapter, which must run the raw expressions. */
    const absent = createAgentTeamsCtx(rawCtx().ctx, { witness: () => undefined })
    expect(absent.steerAgentTurn(agent, { m: 1 })).toEqual({ steered: { m: 1 } })
    expect(absent.injectAgentMessage(agent, { m: 2 })).toEqual({ injected: { m: 2 } })
    expect(() => absent.steerAgentTurn({ id: "no-methods" }, { m: 1 })).toThrow(/steer is not a function/)
    expect(() => absent.injectAgentMessage({ id: "no-methods" }, { m: 1 })).toThrow(/inject is not a function/)
    // A capability flag the adapter reports as FALSE is a real degrade, not a silent no-op.
    /** An adapter reporting both turn seams as unavailable. */
    const disabled = recordingAdapter()
    disabled.capabilities = () => ({ agentTurnSteer: false, agentTurnInject: false })
    /** The facade over the capability-gated adapter. */
    const gated = createAgentTeamsCtx(rawCtx({ probe: () => disabled }).ctx, { witness: () => undefined })
    expect(gated.steerAgentTurn(agent, { m: 1 })).toEqual({ steered: { m: 1 } })
    expect(disabled.calls.some((call) => call.name === "steerAgentTurn")).toBe(false)
})

test("F1: agentScopeOf returns ONE shape in ALL THREE arms (mounted / pending / absent-with-a-throwing-proxy)", () => {
    // Receiver discipline (the captain's ruling): `restrict` must run on the CAPTURED ctx.tools
    // object and `on`/`effect` must run BOUND to the raw agent ctx — recorded as `this` here.
    /** The `[label, receiver]` pairs the scope members ran on, in call order. */
    const receivers: Array<[string, unknown]> = []
    /** The captured `ctx.tools` stand-in, whose `restrict` must run on itself. */
    const toolsProxy = {
        restrict: function (filter: unknown) { receivers.push(["tools.restrict", this]); return () => undefined },
    }
    /** The raw agent ctx stand-in, whose `on`/`effect` must run on itself. */
    const scoped = {
        tools: toolsProxy,
        on: function (event: string) { receivers.push(["on", this]); return () => undefined },
        effect: function (label: string) { receivers.push(["effect", this]); return () => undefined },
    }
    /** The agent whose `ctx` is the stand-in above. */
    const agent = { id: "agent-1", ctx: scoped }
    /** The sorted key list of a scope object, which every arm must answer identically. */
    const shapeKeys = (scope: object): string[] => Object.keys(scope).sort()
    // ARM 1 — MOUNTED: the adapter's own scope, used as returned when usable.
    /** The recording adapter whose scope the mounted arm must use. */
    const adapter = recordingAdapter()
    /** The scope the MOUNTED arm returned. */
    const mounted = agentScopeOf(createAgentTeamsCtx(rawCtx({ probe: () => adapter }).ctx, { witness: () => undefined }), agent)
    expect(shapeKeys(mounted)).toEqual(["context", "effect", "on", "tools"])
    expect(mounted.context).toBe(scoped)
    // ARM 2 — PENDING (registered, provider not ACTIVE): the shape is BUILT from the raw ctx.
    /** The facade whose strict probe misses while its non-strict probe hits. */
    const pendingFacade = createAgentTeamsCtx(rawCtx({ probe: (_n: string, strict: unknown) => (strict === true ? undefined : adapter) }).ctx, { witness: () => undefined })
    /** The scope the PENDING arm returned. */
    const pending = agentScopeOf(pendingFacade, agent)
    expect(shapeKeys(pending)).toEqual(shapeKeys(mounted))
    expect(pending.context).toBe(scoped)
    // ARM 3 — ABSENT-with-a-throwing-proxy: the raw ctx throws on any undeclared read (the harness's
    // own shape: `childCtx.agent` -> "cannot get property \"agent\" without inject"), so a plain
    // `ctx.agentScope(agent) ?? agent?.ctx` fallback could not even be READ. Still: one shape, identity
    // `context`, and NO property read throws.
    /** A raw ctx that throws on every read except `tools`, the harness's own shape. */
    const hostile = new Proxy({}, {
        /** Any read but `tools` throws, so an undeclared member can never be served. */
        get(_target: object, prop: string | symbol): unknown {
            if (prop === "tools")
                return { restrict: () => () => undefined }
            throw new Error(`hostile ctx member read: ${String(prop)}`)
        },
    })
    /** The scope the ABSENT arm returned over the hostile ctx. */
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
    /** The scope the absent arm returned over a plain-object ctx. */
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
    /** The adapter whose `agentScope` answers only `context`, so its scope is unusable. */
    const partial = { ...adapter, agentScope: () => ({ context: scoped }) }
    /** The scope the partial-adapter arm returned. */
    const partialScope = agentScopeOf(createAgentTeamsCtx(rawCtx({ probe: () => partial }).ctx, { witness: () => undefined }), agent)
    expect(shapeKeys(partialScope)).toEqual(shapeKeys(mounted))
    expect(partialScope.context).toBe(scoped)
    // A plain-object ctx (every pre-existing unit test) gets the built shape from the SAME members.
    expect(shapeKeys(agentScopeOf({}, agent))).toEqual(shapeKeys(mounted))
    expect(agentScopeOf({}, agent).context).toBe(scoped)
    expect(agentScopeOf(undefined, undefined).context).toBeUndefined()
})

test("AC4: subagentRuntimeOf resolves the runtime, never the facade's projection", () => {
    /** The runtime object the seam must resolve to, by identity. */
    const runtime = { prompt: () => undefined, sendMessage: () => undefined }
    /** A raw ctx whose `subagents` member IS the runtime object. */
    const raw = { subagents: runtime }
    expect(subagentRuntimeOf(raw)).toBe(runtime)
    /** The facade over that raw ctx. */
    const facade = createAgentTeamsCtx({ subagents: runtime, logger: {} }, { witness: () => undefined })
    expect(subagentRuntimeOf(facade)).toBe(runtime)
    expect(facade.subagents.runtime()).toBe(runtime)
})

test("AC4: liveAgentOf routes the sender lookup and keeps the plain-ctx lookup expression working", () => {
    /** The recording adapter the probe answers with. */
    const adapter = recordingAdapter()
    /** The facade over the mounted adapter. */
    const facade = createAgentTeamsCtx(rawCtx({ probe: () => adapter }).ctx, { witness: () => undefined })
    expect(liveAgentOf(facade, "captain")).toEqual({ id: "captain", via: "adapter" })
    // Today's expression, for the plain-object ctx every pre-existing unit test hands the guard.
    /** The agent handle the plain-ctx lookup must resolve to, by identity. */
    const owner = { id: "captain" }
    expect(liveAgentOf({ get: (name: string) => (name === "agents" ? { get: (id: string) => owner } : undefined) }, "captain")).toBe(owner)
    expect(liveAgentOf({ get: () => undefined }, "captain")).toBeUndefined()
    expect(liveAgentOf({}, "captain")).toBeUndefined()
})

test("BR-1: a substituted NO-OP member is reported ONCE per plugin instance, NAMED, and never throws", () => {
    // (b) HAPPY PATH: a ctx providing every member substitutes nothing and stays silent.
    /** The witness lines the happy-path facade emitted. */
    const happyLines: string[] = []
    /** A scoped ctx whose every member the facade needs is present. */
    const full = {
        tools: { restrict: function (filter: unknown) { return () => undefined } },
        on: function (event: string) { return () => undefined },
        effect: function (label: string) { return () => undefined },
    }
    /** The facade whose scoped ctx is fully served. */
    const happyFacade = createAgentTeamsCtx(rawCtx().ctx, { witness: (line: string) => happyLines.push(line) })
    /** The scope built from the fully served ctx. */
    const happyScope = happyFacade.agentScope({ id: "agent-happy", ctx: full })
    expect(Object.keys(happyScope).sort()).toEqual(["context", "effect", "on", "tools"])
    expect(happyScope.context).toBe(full)
    expect(happyLines.filter((line) => line.includes("MEMBER PRIVILEGE LOSS"))).toEqual([])

    // (a) DEGRADE: `tools.restrict` cannot be provided → the ONE warning NAMES it, and the uniform
    // shape is still returned with `context` identity preserved (the tolerance is not narrowed to a
    // throw: a missing seam degrades with a warning instead of taking the tree down).
    /** The witness lines the degraded facade emitted. */
    const lines: string[] = []
    /** A scoped ctx whose `tools` object has no `restrict` member. */
    const degraded = { tools: {}, on: () => () => undefined, effect: () => () => undefined }
    /** The facade over the degraded scoped ctx. */
    const facade = createAgentTeamsCtx(rawCtx().ctx, { witness: (line: string) => lines.push(line) })
    /** The scope returned for the first degraded member. */
    const first = facade.agentScope({ id: "agent-1", ctx: degraded })
    facade.agentScope({ id: "agent-2", ctx: degraded }) // same plugin instance: still ONE line
    /** The privilege-loss witness lines, which must be exactly one. */
    const loss = lines.filter((line) => line.includes("MEMBER PRIVILEGE LOSS"))
    expect(loss).toHaveLength(1)
    expect(loss[0]).toContain("[substituted: tools.restrict]")
    expect(Object.keys(first).sort()).toEqual(["context", "effect", "on", "tools"])
    expect(first.context).toBe(degraded)
    expect(typeof first.tools.restrict).toBe("function")
    expect(() => first.tools.restrict({ deny: ["x"] })).not.toThrow()

    // A THROWING member degrades per member (never a throw) and reports through the SAME sink.
    /** A scoped ctx that throws on every read except `tools`. */
    const hostile = new Proxy({}, {
        /** Any read but `tools` throws, so the per-member degrade arms are reached. */
        get(_target: object, prop: string | symbol): unknown {
            if (prop === "tools")
                return { restrict: () => () => undefined }
            throw new Error(`hostile ctx member read: ${String(prop)}`)
        },
    })
    /** The witness lines the hostile-ctx facade emitted. */
    const hostileLines: string[] = []
    /** The facade whose scoped ctx throws on most reads. */
    const hostileFacade = createAgentTeamsCtx(rawCtx().ctx, { witness: (line: string) => hostileLines.push(line) })
    /** The scope built from the hostile ctx, which must not throw. */
    const hostileScope = hostileFacade.agentScope({ id: "agent-3", ctx: hostile })
    /** The privilege-loss witness lines for the hostile ctx. */
    const hostileLoss = hostileLines.filter((line) => line.includes("MEMBER PRIVILEGE LOSS"))
    expect(hostileLoss).toHaveLength(1)
    expect(hostileLoss[0]).toContain("on")
    expect(hostileLoss[0]).toContain("effect")
    expect(hostileScope.context).toBe(hostile)
    expect(typeof hostileScope.on).toBe("function")
    expect(typeof hostileScope.effect).toBe("function")
})
