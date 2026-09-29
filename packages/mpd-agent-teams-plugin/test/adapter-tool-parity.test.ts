// AC6 (contract §7): the 21 `agent_teams_*` definitions are byte-identical in both lanes.
//
// WHY THIS IS THE SHARPEST PARITY TEST IN THE WAVE: the adapter's `registerTool` REBUILDS a
// definition (`{name, description, parameters, output:{...output, schema, render}, timeoutMs,
// execute: wrapper}`), which would drop `finalizeContent`/`presentCall`/`presentResult`/
// `isConcurrencySafe` and replace `execute`. The bridge therefore calls `registerHostTool`, whose
// contract is a VERBATIM hand-over. This file proves the consequence: the serialized definitions —
// key sets, every non-function JSON value, `String(fn)` for every function — are identical with and
// without the adapter, in the SAME registration order, and the SAME object reference reaches the
// seam in both lanes.
import { expect, test } from "bun:test"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { createAgentTeamsCtx } from "../lib/mpd-adapter-ctx.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** One captured tool definition, narrowed to the member the cross-lane comparison reads. */
interface RecordedDefinition {
    /** The registered tool's name, compared across lanes to prove the registration order. */
    readonly name: string
}

/** The ctx surface both lanes are driven through: tool registration is the seam under test. */
interface RegistrationCtx {
    /** Tool registration, which must receive the definition object BY REFERENCE. */
    readonly tools: { readonly register: (definition: RecordedDefinition) => () => void }
}

/** A lane under test: the ctx handed to the real registration call plus the definitions it caught. */
interface Lane {
    /** The ctx the adopted registration path is driven with. */
    readonly ctx: RegistrationCtx
    /** Definitions the lane's registration seam captured, in registration order. */
    readonly registered: RecordedDefinition[]
}

/** The adopted plugin's team-state directory, relative to the sandbox workspace. */
const STATE_DIR = ".mpd/team"

/** Canonical serialization: sorted key sets, function SOURCE text, JSON values verbatim. */
function canonical(value: unknown): unknown {
    if (typeof value === "function") return { "[fn]": String(value) }
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === "object") {
        /** The canonical rebuild of the object, with its keys inserted in sorted order. */
        const out: Record<string, unknown> = {}
        // The narrowed `object` type carries no index signature, so the keyed read needs a record
        // view; the guard directly above has already proved the value is a non-null object.
        for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key])
        return out
    }
    return value === undefined ? "[undefined]" : value
}

/** The raw ctx shape `registerAgentTeamsTools` needs; its `tools.register` records definitions. */
function rawLane(): Lane {
    /** Definitions the fake `tools.register` captured, in the order they were registered. */
    const registered: RecordedDefinition[] = []
    /** The plain-object ctx: exactly the members the adopted registration path reads. */
    const ctx = {
        tools: { register: (definition: RecordedDefinition) => { registered.push(definition); return () => undefined } },
        agents: { get: () => undefined, list: () => [] },
        subagents: { prompt: async () => ({ messageId: "m" }), followup: async () => undefined, sendMessage: async () => undefined },
        llm: { listModels: async () => [], resolveCallConfig: async (config: unknown) => config },
        systemPrompt: { section: () => () => undefined },
        commands: { register: () => () => undefined },
        on: () => () => undefined,
        effect: () => () => undefined,
        get: () => undefined,
        inject: (_deps: unknown, callback: (inner: unknown) => void) => { callback(ctx); return () => undefined },
        logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: () => undefined },
    }
    return { ctx, registered }
}

/** The adapter lane: the SAME registration call, but `ctx` is the facade over a mounted adapter. */
function adapterLane(): Lane {
    /** Definitions the facade's host-tool registration captured, in registration order. */
    const registered: RecordedDefinition[] = []
    /** The recording adapter: only the members the facade resolves on this path. */
    const adapter = {
        registerHostTool: (definition: RecordedDefinition) => { registered.push(definition); return () => undefined },
        onEvent: () => () => undefined,
        liveAgents: () => [],
        liveAgent: () => undefined,
        subagentRuntime: () => ({ prompt: async () => ({ messageId: "m" }), followup: async () => undefined, sendMessage: async () => undefined }),
        registerPromptSection: () => () => undefined,
        registerCommand: () => () => undefined,
    }
    /** The raw lane's ctx, reused so the facade still has a fallback receiver to resolve against. */
    const raw = rawLane()
    /** The facade over the mounted adapter: what the adopted registration path treats as `ctx`. */
    const ctx: RegistrationCtx = createAgentTeamsCtx(raw.ctx, {
        witness: () => undefined,
        // A mounted adapter: the strict probe always hits.
        resolveCtx: { get: (_name: unknown, strict: unknown) => (strict === true ? adapter : adapter) },
    })
    return { ctx, registered }
}

test("AC6: the 21 agent_teams_* definitions are byte-identical with and without the adapter", () => {
    /** The row config both lanes are registered with. */
    const config = { stateDir: STATE_DIR }
    /** The raw lane under test. */
    const raw = rawLane()
    registerAgentTeamsTools(raw.ctx, config)
    /** The adapter lane under test. */
    const adapter = adapterLane()
    registerAgentTeamsTools(adapter.ctx, config)

    /** Tool names in raw registration order; the adapter lane must repeat this exact sequence. */
    const rawNames = raw.registered.map((definition) => definition.name)
    /** Tool names in adapter registration order. */
    const adapterNames = adapter.registered.map((definition) => definition.name)
    expect(raw.registered).toHaveLength(21)
    expect(adapter.registered).toHaveLength(21)
    expect(adapterNames).toEqual(rawNames)
    for (const name of rawNames) expect(name.startsWith("agent_teams_")).toBe(true)
    // The teeth: key sets, non-function JSON values and every function's SOURCE text.
    expect(canonical(adapter.registered)).toEqual(canonical(raw.registered))
})

test("AC6: the definition object reaches the seam by REFERENCE in both lanes (no rebuild)", () => {
    /** A definition carrying every field a rebuild would drop. */
    const definition = {
        name: "agent_teams_probe",
        description: "probe",
        parameters: { type: "object", properties: {} },
        output: { schema: { type: "object" }, render: (value: unknown) => [{ type: "text", text: String(value) }] },
        isConcurrencySafe: () => true,
        presentCall: () => undefined,
        presentResult: () => undefined,
        finalizeContent: () => undefined,
        execute: async () => ({}),
    }
    // Adapter lane: the bridge must NOT rebuild the definition (that is `registerTool`'s job, and
    // rebuilding is exactly what would drop the four fields above).
    /** The adapter lane whose facade receives the definition. */
    const adapter = adapterLane()
    adapter.ctx.tools.register(definition)
    expect(adapter.registered).toHaveLength(1)
    expect(Object.is(adapter.registered[0], definition)).toBe(true)
    expect(Object.keys(adapter.registered[0]).sort()).toEqual(Object.keys(definition).sort())
    // Fallback lane: today's expression, same reference.
    /** The raw lane whose own registration seam receives the same definition. */
    const raw = rawLane()
    raw.ctx.tools.register(definition)
    expect(Object.is(raw.registered[0], definition)).toBe(true)
})
