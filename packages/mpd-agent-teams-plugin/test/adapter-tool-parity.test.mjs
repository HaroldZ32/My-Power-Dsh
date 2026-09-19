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
import { createAgentTeamsCtx } from "../lib/mpd-adapter-ctx.js"
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = ".mpd/team"

/** Canonical serialization: sorted key sets, function SOURCE text, JSON values verbatim. */
function canonical(value) {
    if (typeof value === "function") return { "[fn]": String(value) }
    if (Array.isArray(value)) return value.map(canonical)
    if (value !== null && typeof value === "object") {
        const out = {}
        for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
        return out
    }
    return value === undefined ? "[undefined]" : value
}

/** The raw ctx shape `registerAgentTeamsTools` needs; its `tools.register` records definitions. */
function rawLane() {
    const registered = []
    const ctx = {
        tools: { register: (definition) => { registered.push(definition); return () => undefined } },
        agents: { get: () => undefined, list: () => [] },
        subagents: { prompt: async () => ({ messageId: "m" }), followup: async () => undefined, sendMessage: async () => undefined },
        llm: { listModels: async () => [], resolveCallConfig: async (config) => config },
        systemPrompt: { section: () => () => undefined },
        commands: { register: () => () => undefined },
        on: () => () => undefined,
        effect: () => () => undefined,
        get: () => undefined,
        inject: (_deps, callback) => { callback(ctx); return () => undefined },
        logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: () => undefined },
    }
    return { ctx, registered }
}

/** The adapter lane: the SAME registration call, but `ctx` is the facade over a mounted adapter. */
function adapterLane() {
    const registered = []
    const adapter = {
        registerHostTool: (definition) => { registered.push(definition); return () => undefined },
        onEvent: () => () => undefined,
        liveAgents: () => [],
        liveAgent: () => undefined,
        subagentRuntime: () => ({ prompt: async () => ({ messageId: "m" }), followup: async () => undefined, sendMessage: async () => undefined }),
        registerPromptSection: () => () => undefined,
        registerCommand: () => () => undefined,
    }
    const raw = rawLane()
    const ctx = createAgentTeamsCtx(raw.ctx, {
        witness: () => undefined,
        // A mounted adapter: the strict probe always hits.
        resolveCtx: { get: (_name, strict) => (strict === true ? adapter : adapter) },
    })
    return { ctx, registered }
}

test("AC6: the 21 agent_teams_* definitions are byte-identical with and without the adapter", () => {
    const config = { stateDir: STATE_DIR }
    const raw = rawLane()
    registerAgentTeamsTools(raw.ctx, config)
    const adapter = adapterLane()
    registerAgentTeamsTools(adapter.ctx, config)

    const rawNames = raw.registered.map((definition) => definition.name)
    const adapterNames = adapter.registered.map((definition) => definition.name)
    expect(raw.registered).toHaveLength(21)
    expect(adapter.registered).toHaveLength(21)
    expect(adapterNames).toEqual(rawNames)
    for (const name of rawNames) expect(name.startsWith("agent_teams_")).toBe(true)
    // The teeth: key sets, non-function JSON values and every function's SOURCE text.
    expect(canonical(adapter.registered)).toEqual(canonical(raw.registered))
})

test("AC6: the definition object reaches the seam by REFERENCE in both lanes (no rebuild)", () => {
    const definition = {
        name: "agent_teams_probe",
        description: "probe",
        parameters: { type: "object", properties: {} },
        output: { schema: { type: "object" }, render: (value) => [{ type: "text", text: String(value) }] },
        isConcurrencySafe: () => true,
        presentCall: () => undefined,
        presentResult: () => undefined,
        finalizeContent: () => undefined,
        execute: async () => ({}),
    }
    // Adapter lane: the bridge must NOT rebuild the definition (that is `registerTool`'s job, and
    // rebuilding is exactly what would drop the four fields above).
    const adapter = adapterLane()
    adapter.ctx.tools.register(definition)
    expect(adapter.registered).toHaveLength(1)
    expect(Object.is(adapter.registered[0], definition)).toBe(true)
    expect(Object.keys(adapter.registered[0]).sort()).toEqual(Object.keys(definition).sort())
    // Fallback lane: today's expression, same reference.
    const raw = rawLane()
    raw.ctx.tools.register(definition)
    expect(Object.is(raw.registered[0], definition)).toBe(true)
})
