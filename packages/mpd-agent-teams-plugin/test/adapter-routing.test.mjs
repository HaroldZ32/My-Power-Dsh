// AC3 (contract §7): the REAL apply path reaches every harness seam through the mounted adapter.
//
// The proof shape is deliberately adversarial: the recording adapter counts every seam call, and the
// raw ctx's seam objects are THROWING PROXIES — a single read of `ctx.tools`, `ctx.agents`,
// `ctx.subagents`, `ctx.commands`, `ctx.systemPrompt`, `ctx.llm` or `ctx.on` is both recorded and
// fatal, so "zero raw hits" is not a claim about wording but about control flow.
//
// The apply entry points of the contract's AC3 text are driven directly (apply() plus the five
// installers), and the seams an APPLY does not itself reach are driven through the REAL consumers
// that own them (`deliverToMember`, `interruptMember`, `spawnMember`, `haltTeamWork`,
// `validateMemberLlmSelections`, `resolveMemberLlmSelection`, the registered command handler) — the
// per-seam roll-up at the bottom of this file says which is which.
import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Config, apply } from "../lib/index.js"
import { createAgentTeamsCtx } from "../lib/mpd-adapter-ctx.js"
import { installTeamCapabilities } from "../lib/capabilities.js"
import { registerAgentTeamsCommand } from "../lib/command.js"
import { installInterjectionExpirySweep, installSessionTeamPolicy } from "../lib/session-start.js"
import { haltTeamWork, registerAgentTeamsTools } from "../lib/tools.js"
import { captainSessionOf } from "../lib/events.js"
import {
    deliverToMember, interruptMember, resolveMemberLlmSelection, spawnMember, steerCaptainReport, validateMemberLlmSelections,
} from "../lib/members.js"

const CAPTAIN_ID = "session-captain"
const STATE_DIR = ".mpd/team"

/** The twelve new seams plus the existing adapter surface the facade uses, all recorded. */
function recordingAdapter() {
    const calls = []
    const tools = []
    const sections = []
    const commands = []
    const handlers = new Map()
    const runtimeCalls = []
    const runtime = {
        prompt: async (request) => { runtimeCalls.push(["prompt", request]); return { messageId: "message-1" } },
        sendMessage: async () => { runtimeCalls.push(["sendMessage"]); return undefined },
        followup: async () => { runtimeCalls.push(["followup"]); return undefined },
        drainContinuableChildren: async (captain, ids) => { runtimeCalls.push(["drainContinuableChildren", ids]); return undefined },
    }
    let providers = ["spawn"]
    let provider
    let liveAgents = []
    const record = (name) => (...args) => { calls.push({ name, args }) }
    const adapter = {
        calls, tools, sections, commands, handlers, runtimeCalls, runtime,
        setProvider: (value) => { provider = value },
        setLiveAgents: (value) => { liveAgents = value },
        setProviders: (value) => { providers = value },
        registerHostTool: (definition) => { calls.push({ name: "registerHostTool", args: [definition] }); tools.push(definition); return () => undefined },
        liveAgent: (id) => { calls.push({ name: "liveAgent", args: [id] }); return id === CAPTAIN_ID ? captain : undefined },
        liveAgents: () => { calls.push({ name: "liveAgents", args: [] }); return liveAgents }, 
        subagentProvider: (name) => { calls.push({ name: "subagentProvider", args: [name] }); return provider },
        subagentProviders: () => { calls.push({ name: "subagentProviders", args: [] }); return providers },
        startContinuableAgent: (spec) => { calls.push({ name: "startContinuableAgent", args: [spec] }); return Promise.resolve({ childId: "adapter-child" }) },
        interruptAgent: (id, authority) => { calls.push({ name: "interruptAgent", args: [id, authority] }); return undefined },
        subagentRuntime: () => { calls.push({ name: "subagentRuntime", args: [] }); return runtime },
        llmListModels: (name) => { calls.push({ name: "llmListModels", args: [name] }); return Promise.resolve([{ id: "model-1" }]) },
        llmResolveCallConfig: (config, signal) => { calls.push({ name: "llmResolveCallConfig", args: [config, signal] }); return Promise.resolve({ provider: "p", model: "m", reasoningEffort: "high" }) },
        registerPromptSection: (section) => { calls.push({ name: "registerPromptSection", args: [section] }); sections.push(section); return () => undefined },
        registerCommand: (definition) => { calls.push({ name: "registerCommand", args: [definition] }); commands.push(definition); return () => undefined },
        onEvent: (event, handler) => {
            calls.push({ name: "onEvent", args: [event] })
            handlers.set(event, [...(handlers.get(event) ?? []), handler])
            return () => undefined
        },
        agentScope: (agent) => {
            calls.push({ name: "agentScope", args: [agent] })
            return {
                context: agent?.ctx,
                tools: { restrict: (filter) => { calls.push({ name: "scope.tools.restrict", args: [filter] }); return () => undefined } },
                on: (event) => { calls.push({ name: "scope.on", args: [event] }); return () => undefined },
                effect: (label) => { calls.push({ name: "scope.effect", args: [label] }); return () => undefined },
            }
        },
        startAgentTurn: (agent, message) => { calls.push({ name: "startAgentTurn", args: [agent, message] }); return undefined },
        steerAgentTurn: (agent, message) => { calls.push({ name: "steerAgentTurn", args: [agent, message] }); return undefined },
        injectAgentMessage: (agent, message) => { calls.push({ name: "injectAgentMessage", args: [agent, message] }); return undefined },
        cancelAgentTurn: (agent, cause, options) => { calls.push({ name: "cancelAgentTurn", args: [agent, cause, options] }); return undefined },
        record,
    }
    let captain
    return Object.assign(adapter, { setCaptain: (value) => { captain = value } })
}

/**
 * A raw ctx whose HARNESS SEAMS throw (and are recorded) on any touch, with the cordis-core members
 * the plugin legitimately owns (`logger`, `effect`, `get`, `inject`) working.
 */
function throwingRawCtx(adapter) {
    const rawHits = []
    const disposers = []
    const seamObject = (label) => new Proxy({}, {
        get(_target, prop) {
            rawHits.push(`${label}.${String(prop)}`)
            throw new Error(`the raw ctx seam "${label}.${String(prop)}" was touched while an adapter was mounted`)
        },
    })
    const ctx = {
        tools: seamObject("tools"),
        agents: seamObject("agents"),
        subagents: seamObject("subagents"),
        commands: seamObject("commands"),
        systemPrompt: seamObject("systemPrompt"),
        llm: seamObject("llm"),
        on: (...args) => { rawHits.push(`on(${String(args[0])})`); throw new Error("the raw ctx seam \"on\" was touched while an adapter was mounted") },
        logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: () => undefined },
        effect: (callback, label) => {
            const dispose = callback()
            if (typeof dispose === "function") disposers.push({ label, dispose })
            return () => dispose?.()
        },
        get: (name, strict) => (name === "mpdDsh" && strict === true ? adapter : undefined),
        inject: (_deps, callback) => { callback(ctx); return () => undefined },
    }
    return { ctx, rawHits, disposers }
}

/** A fake captain/member whose session cwd is the SANDBOX workspace (the plugin derives stateRoot from it). */
const workspaceAgent = (id, workspace, extra = {}) => fakeAgent(id, {
    session: { header: { cwd: workspace, seedLength: 0 }, ownEvents: () => [], append: () => undefined, requestHeader: () => ({ config: { provider: "p", model: "m" } }) },
    ...extra,
})
const fakeAgent = (id, extra = {}) => ({
    id,
    status: "idle",
    session: { header: { cwd: process.cwd(), seedLength: 0 }, ownEvents: () => [], append: () => undefined, requestHeader: () => ({ config: { provider: "p", model: "m" } }) },
    options: { provider: "p", model: "m" },
    followup: () => undefined,
    cancel: () => undefined,
    ctx: { scoped: true },
    ...extra,
})

test("AC3: apply() routes the whole composition root through the adapter and touches no raw seam", () => {
    const adapter = recordingAdapter()
    const { ctx, rawHits, disposers } = throwingRawCtx(adapter)
    const workspace = mkdtempSync(join(tmpdir(), "mpd-ac3-apply-"))
    try {
        const memberAgent = workspaceAgent("member-1", workspace)
        adapter.setCaptain(workspaceAgent(CAPTAIN_ID, workspace))
        adapter.setLiveAgents([memberAgent])
        apply(ctx, new Config({}))
        const names = adapter.tools.map((definition) => definition.name)
        expect(names).toHaveLength(21)
        for (const name of names) expect(name.startsWith("agent_teams_")).toBe(true)
        // The other apply-path entry points of the AC3 text.
        const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
        installTeamCapabilities(facade, {
            stateDir: STATE_DIR,
            isPendingMember: () => true,
            order: 117,
            captainPrompt: () => "captain protocol",
        })
        registerAgentTeamsCommand(facade, () => ({}), () => undefined)
        // The other two AC3 entry points: the sweep is installed by apply() itself; the policy is
        // exercised here with its gate ENABLED (the default row config leaves mode at 'off').
        const listenersBefore = adapter.calls.filter((entry) => entry.name === "onEvent").length
        installSessionTeamPolicy(facade, { sessionTeamPolicy: { mode: "auto", autoRoute: true, name: "MPD Default", approval: "required", presets: [] } })
        installInterjectionExpirySweep(facade, { stateDir: STATE_DIR })
        expect(adapter.calls.filter((entry) => entry.name === "onEvent").length).toBeGreaterThan(listenersBefore)

        const recorded = adapter.calls.map((call) => call.name)
        for (const name of ["registerHostTool", "registerPromptSection", "registerCommand", "liveAgents", "onEvent", "subagentRuntime"]) {
            expect(recorded, `the apply path never reached the adapter's ${name}`).toContain(name)
        }
        expect(recorded.filter((name) => name === "registerHostTool")).toHaveLength(21)
        // Registered once by apply() and once by the direct member-lane call below; both must name
        // the frozen section.
        expect(adapter.sections.map((section) => section.name)).toEqual(["agent-teams:usage", "agent-teams:usage"])
        // A member lane: the per-agent restriction and the lifetime effect are adapter-owned.
        expect(recorded).toContain("scope.tools.restrict")
        expect(recorded).toContain("scope.effect")
        // Firing the registered session-start listeners exercises the remaining apply-time work.
        for (const handler of adapter.handlers.get("agent/session-start") ?? []) handler({ agent: memberAgent })
        expect(recorded.filter((name) => name === "agentScope").length).toBeGreaterThan(0)
        expect(rawHits).toEqual([])
    }
    finally {
        for (const entry of disposers) entry.dispose()
        rmSync(workspace, { recursive: true, force: true })
    }
    expect(rawHits, `raw ctx seams touched: ${rawHits.join(", ")}`).toEqual([])
})

test("AC3: the turn seams route through the adapter on both registered paths", async () => {
    const adapter = recordingAdapter()
    const { ctx, rawHits } = throwingRawCtx(adapter)
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    registerAgentTeamsCommand(facade, () => ({}), () => undefined)
    const command = adapter.commands.find((definition) => definition.name === "agent-teams")
    expect(command).toBeDefined()
    const agent = fakeAgent(CAPTAIN_ID)
    await command.handler({ agent, rawInput: "goal" })
    const start = adapter.calls.filter((call) => call.name === "startAgentTurn")
    expect(start).toHaveLength(1)
    expect(start[0].args[0]).toBe(agent)
    expect(rawHits).toEqual([])
})

test("AC3: the runtime-only seams route through the consumers that own them", async () => {
    const adapter = recordingAdapter()
    const { ctx, rawHits } = throwingRawCtx(adapter)
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    const captain = fakeAgent(CAPTAIN_ID)
    adapter.setCaptain(captain)

    // 1. subagents.runtime -> the delivery ladder hands the RUNTIME to `prompt`.
    expect(await deliverToMember(facade, captain, "member-1", "hello", undefined)).toBe(true)
    expect(adapter.runtimeCalls.map(([name]) => name)).toContain("prompt")
    // 2. subagents.interrupt
    interruptMember(facade, captain, "member-1")
    expect(adapter.calls.some((call) => call.name === "interruptAgent")).toBe(true)
    // 3. subagents.getProvider + subagents.list (the loud capability failure names the catalog).
    await expect(spawnMember(facade, { provider: "spawn" }, {}, {}, captain, { id: "t", name: "team", tasks: [], members: [] }, { name: "Member" }, STATE_DIR, undefined))
        .rejects.toThrow(/no subagent provider "spawn" is registered/)
    // 4. subagents.startContinuable
    adapter.setProvider({ prepareContinuable: () => undefined, capabilities: { persona: true, toolFilter: true } })
    const member = { name: "Member" }
    await spawnMember(facade, { provider: "spawn" }, { withPending: (_id, _label, _selection, start) => start() }, { provider: "p", model: "m" }, captain, { id: "t", name: "team", tasks: [], members: [] }, member, STATE_DIR, undefined)
    expect(member.id).toBe("adapter-child")
    // 5. llm.listModels (a bad model id is caught by the catalog the adapter served)
    await expect(validateMemberLlmSelections(facade, [{ provider: "p", model: "ghost" }], undefined)).rejects.toThrow(/unknown member model "ghost"/)
    await validateMemberLlmSelections(facade, [{ provider: "p", model: "model-1" }], undefined)
    // 6. llm.resolveCallConfig
    const selection = await resolveMemberLlmSelection(facade, captain, {}, undefined)
    expect(selection).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
    // 7. agents.get on a path that is not the command handler
    expect(captainSessionOf(facade, CAPTAIN_ID, undefined)).toBe(captain.session)

    const recorded = adapter.calls.map((call) => call.name)
    for (const name of ["subagentRuntime", "interruptAgent", "subagentProvider", "subagentProviders", "startContinuableAgent", "llmListModels", "llmResolveCallConfig", "liveAgent"]) {
        expect(recorded, `the consumer path never reached the adapter's ${name}`).toContain(name)
    }
    expect(rawHits).toEqual([])
})

test("AC3: haltTeamWork drains through the RUNTIME the adapter resolves (the measured gap)", async () => {
    const adapter = recordingAdapter()
    const { ctx, rawHits } = throwingRawCtx(adapter)
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    const workspace = mkdtempSync(join(tmpdir(), "mpd-ac3-halt-"))
    const stateRoot = join(workspace, STATE_DIR)
    try {
        const captain = fakeAgent(CAPTAIN_ID)
        adapter.setCaptain(captain)
        const teamRoot = join(stateRoot, "halted-team")
        mkdirSync(join(teamRoot, "inbox"), { recursive: true })
        writeFileSync(join(teamRoot, "team.json"), JSON.stringify({
            id: "halted-team", name: "halted team", captainSessionId: CAPTAIN_ID, createdAt: 1, taskSeq: 0,
            phase: "running", members: [{ id: "member-1", name: "Member", role: "engineer", status: "idle", joinedAt: 1 }], tasks: [],
        }, null, 2))
        const result = await haltTeamWork({ ctx: facade, stateRoot, teamId: "halted-team", captain, signal: undefined })
        expect(result.teamName).toBe("halted team")
        const recorded = adapter.calls.map((call) => call.name)
        // The two stop-boundary cancellations, the child interrupt and the captain lookup.
        expect(recorded.filter((name) => name === "cancelAgentTurn")).toHaveLength(2)
        expect(recorded).toContain("interruptAgent")
        expect(recorded).toContain("liveAgent")
        // The drain runs on the RUNTIME: reading the facade's `subagents` projection instead would
        // have silently downgraded this stop path to the quiescence fallback (tools.js:311).
        expect(adapter.runtimeCalls.some(([name]) => name === "drainContinuableChildren")).toBe(true)
        expect(rawHits).toEqual([])
        const halted = JSON.parse(readFileSync(join(teamRoot, "team.json"), "utf8"))
        expect(halted.halted).toBe(true)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("F2: the steer/inject seams route through the adapter, and the caller's throw contract survives", async () => {
    const adapter = recordingAdapter()
    const { ctx, rawHits } = throwingRawCtx(adapter)
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    const workspace = mkdtempSync(join(tmpdir(), "mpd-f2-steer-"))
    const stateRoot = join(workspace, STATE_DIR)
    try {
        const captain = workspaceAgent(CAPTAIN_ID, workspace)
        adapter.setCaptain(captain)
        // 1. steer: the member-report path (members.js steerCaptainReport).
        expect(steerCaptainReport(facade, captain, "Member", "a report")).toBe(true)
        expect(adapter.calls.some((call) => call.name === "steerAgentTurn")).toBe(true)
        // 2. the same path with a REJECTING adapter seam: the throw must reach the caller's catch.
        const rejecting = recordingAdapter()
        rejecting.steerAgentTurn = () => { throw new Error("steer rejected by the host") }
        const rejectingFacade = createAgentTeamsCtx(throwingRawCtx(rejecting).ctx, { witness: () => undefined })
        expect(steerCaptainReport(rejectingFacade, captain, "Member", "a report")).toBe(false)
        // 3. inject: the REAL discard path (tools.js discardStagedTeam) on real staged state.
        const runtime = registerAgentTeamsTools(facade, { stateDir: STATE_DIR })
        const stagedRoot = join(stateRoot, "staged-team")
        mkdirSync(join(stagedRoot, "inbox"), { recursive: true })
        writeFileSync(join(stagedRoot, "team.json"), JSON.stringify({
            id: "staged-team", name: "staged team", captainSessionId: CAPTAIN_ID, createdAt: 1, taskSeq: 0,
            phase: "staged", members: [], tasks: [],
        }, null, 2))
        const discarded = await runtime.discardStagedTeam(captain, "staged-team")
        expect(discarded.teamId).toBe("staged-team")
        expect(adapter.calls.some((call) => call.name === "injectAgentMessage")).toBe(true)
        expect(rawHits).toEqual([])
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("F7: the raw-hit instrument covers ONLY the plugin ctx — the host per-agent ctx is exempt", () => {
    const adapter = recordingAdapter()
    const { ctx, rawHits } = throwingRawCtx(adapter)
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    // A host-provided per-agent ctx that THROWS on every read: with the adapter mounted, the
    // adapter's scope is the path taken, so the member setup must never read this ctx at all — and a
    // read of it never counts toward the plugin-ctx instrument (F7's scope rule).
    const hostAgentCtx = new Proxy({}, {
        get(_target, prop) { throw new Error(`host per-agent ctx read: ${String(prop)}`) },
    })
    installTeamCapabilities(facade, {
        stateDir: STATE_DIR,
        isPendingMember: () => true,
        order: 117,
        captainPrompt: () => "captain protocol",
    })
    for (const handler of adapter.handlers.get("agent/session-start") ?? []) handler({ agent: fakeAgent("member-1", { ctx: hostAgentCtx }) })
    expect(adapter.calls.some((call) => call.name === "agentScope")).toBe(true)
    expect(adapter.calls.some((call) => call.name === "scope.tools.restrict")).toBe(true)
    expect(rawHits).toEqual([])
})

test("AC3: every raw seam would have been visible — the throwing proxy is a real detector", () => {
    // Negative control: the same raw ctx, read directly, records and throws. Without this arm a
    // "zero raw hits" assertion could pass because the detector was never armed.
    const adapter = recordingAdapter()
    const { ctx, rawHits } = throwingRawCtx(adapter)
    expect(() => ctx.tools.register({ name: "t" })).toThrow(/was touched while an adapter was mounted/)
    expect(() => ctx.subagents.interrupt("s", {})).toThrow()
    expect(() => ctx.on("agent/pre-step", () => undefined)).toThrow()
    expect(rawHits).toEqual(["tools.register", "subagents.interrupt", "on(agent/pre-step)"])
})
