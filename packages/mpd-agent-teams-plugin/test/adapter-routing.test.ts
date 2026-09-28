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
// The adopted agent-teams body is vendored JavaScript with no declaration file, so these exports are untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { Config, apply } from "../lib/index.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so this export is untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { createAgentTeamsCtx } from "../lib/mpd-adapter-ctx.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so this export is untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { installTeamCapabilities } from "../lib/capabilities.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so this export is untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { registerAgentTeamsCommand } from "../lib/command.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so these exports are untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { installInterjectionExpirySweep, installSessionTeamPolicy } from "../lib/session-start.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so these exports are untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { haltTeamWork, registerAgentTeamsTools } from "../lib/tools.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so this export is untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { captainSessionOf } from "../lib/events.js"
import {
    deliverToMember, interruptMember, resolveMemberLlmSelection, spawnMember, steerCaptainReport, validateMemberLlmSelections,
    // The adopted agent-teams body is vendored JavaScript with no declaration file, so these exports are untyped.
    // @ts-expect-error vendored JavaScript has no declaration file
} from "../lib/members.js"

/** The captain session id the fake agent handles are keyed by. */
const CAPTAIN_ID = "session-captain"
/** The adopted plugin's team-state directory, relative to the sandbox workspace. */
const STATE_DIR = ".mpd/team"

/** One adapter method call: the method name plus the arguments it was handed, kept verbatim. */
interface AdapterCall {
    /** The adapter method that was invoked. */
    readonly name: string
    /** The arguments of that call, compared by identity where the test needs it. */
    readonly args: unknown[]
}

/** A tool definition that reached the host-tool seam, narrowed to the member the test reads. */
interface RegisteredTool {
    /** The registered tool's name, asserted to carry the `agent_teams_` prefix. */
    readonly name: string
}

/** A prompt section that reached the section seam, narrowed to the member the test reads. */
interface PromptSection {
    /** The section's registered name, compared against the frozen section id. */
    readonly name: string
}

/** A command definition that reached the command seam, narrowed to what the test drives. */
interface RegisteredCommand {
    /** The command's name, which the test looks the registration up by. */
    readonly name: string
    /** The handler the test invokes directly, with a synthetic invocation payload. */
    readonly handler: (invocation: unknown) => unknown
}

/** The recorded view of the fake adapter: exactly the members the test bodies read. */
interface RecordingAdapter {
    /** Every adapter method call, in call order, with its arguments. */
    readonly calls: AdapterCall[]
    /** Tool definitions that reached the host-tool seam, in registration order. */
    readonly tools: RegisteredTool[]
    /** Prompt sections that reached the section seam, in registration order. */
    readonly sections: PromptSection[]
    /** Command definitions that reached the command seam, in registration order. */
    readonly commands: RegisteredCommand[]
    /** Event handlers keyed by event name, in registration order per event. */
    readonly handlers: Map<string, Array<(payload: unknown) => void>>
    /** The calls made on the subagent RUNTIME the adapter handed to the delivery ladder. */
    readonly runtimeCalls: unknown[][]
    /** Install the captain handle that `liveAgent` resolves for {@link CAPTAIN_ID}. */
    readonly setCaptain: (value: unknown) => void
    /** Install the live-agent list that `liveAgents` returns. */
    readonly setLiveAgents: (value: unknown[]) => void
    /** Install the provider object that `subagentProvider` returns. */
    readonly setProvider: (value: unknown) => void
    /** The steer seam, overwritten in one arm so the host rejection path becomes reachable. */
    steerAgentTurn: (agent: unknown, message: unknown) => unknown
}

/** A raw seam object whose every read is recorded and thrown; the shape names the reads the test makes. */
interface ThrowingSeam {
    /** Tool registration, which the negative-control arm reads directly off the raw ctx. */
    readonly register: (definition: unknown) => unknown
    /** Subagent interruption, the second seam the negative-control arm reads directly. */
    readonly interrupt: (id: string, authority: unknown) => unknown
}

/** The raw cordis ctx the plugin is booted with: only the members the test bodies themselves read. */
interface RawCtx {
    /** Harness tool seam, replaced by a throwing proxy. */
    readonly tools: ThrowingSeam
    /** Harness subagent seam, replaced by a throwing proxy. */
    readonly subagents: ThrowingSeam
    /** The cordis event seam, replaced by a throwing function that records the event name. */
    readonly on: (...args: unknown[]) => never
}

/** The session view the plugin reads off an agent handle. */
interface AgentSession {
    /** Session header; its `cwd` is what the plugin's state-root resolution keys on. */
    readonly header: { readonly cwd: string; readonly seedLength: number }
    /** The agent's own event list, always empty in these fixtures. */
    readonly ownEvents: () => unknown[]
    /** Session append hook, kept inert. */
    readonly append: () => void
    /** The request header carrying the member's provider/model selection. */
    readonly requestHeader: () => unknown
}

/** A fake agent handle: the members the exercised plugin paths read. */
interface FakeAgent {
    /** The agent's identity, matched against the captain id. */
    readonly id: string
    /** Cordis status word; the plugin's liveness checks read it. */
    readonly status: string
    /** The session view the state root and the LLM resolution read. */
    readonly session: AgentSession
    /** The agent's default provider/model selection. */
    readonly options: { readonly provider: string; readonly model: string }
    /** The turn continuation hook, kept inert. */
    readonly followup: () => void
    /** The turn cancellation hook, kept inert. */
    readonly cancel: () => void
    /** The scoped cordis ctx handed to per-member setup (a throwing proxy in one arm). */
    readonly ctx: unknown
}

/** The twelve new seams plus the existing adapter surface the facade uses, all recorded. */
function recordingAdapter(): RecordingAdapter {
    /** Every call the recording seams saw, in order. */
    const calls: AdapterCall[] = []
    /** Tool definitions captured by the host-tool seam. */
    const tools: RegisteredTool[] = []
    /** Prompt sections captured by the section seam. */
    const sections: PromptSection[] = []
    /** Command definitions captured by the command seam. */
    const commands: RegisteredCommand[] = []
    /** Event handlers captured by the event seam, keyed by event name. */
    const handlers = new Map<string, Array<(payload: unknown) => void>>()
    /** Calls made through the RUNTIME object the adapter hands to the delivery ladder. */
    const runtimeCalls: unknown[][] = []
    /** The subagent runtime the adapter hands out; every call on it is recorded. */
    const runtime = {
        prompt: async (request: unknown) => { runtimeCalls.push(["prompt", request]); return { messageId: "message-1" } },
        sendMessage: async () => { runtimeCalls.push(["sendMessage"]); return undefined },
        followup: async () => { runtimeCalls.push(["followup"]); return undefined },
        drainContinuableChildren: async (captain: unknown, ids: unknown) => { runtimeCalls.push(["drainContinuableChildren", ids]); return undefined },
    }
    /** The provider-name list `subagentProviders` answers with, replaced per arm. */
    let providers = ["spawn"]
    /** The provider object `subagentProvider` answers with, installed per arm. */
    let provider: unknown
    /** The live-agent list `liveAgents` answers with, installed per arm. */
    let liveAgents: unknown[] = []
    /** Build a seam whose every call is recorded; the returned function discards its arguments. */
    const record = (name: string): ((...args: unknown[]) => void) => (...args: unknown[]) => { calls.push({ name, args }) }
    /** The recording adapter: one method per seam the facade may resolve. */
    const adapter = {
        calls, tools, sections, commands, handlers, runtimeCalls, runtime,
        setProvider: (value: unknown) => { provider = value },
        setLiveAgents: (value: unknown[]) => { liveAgents = value },
        setProviders: (value: string[]) => { providers = value },
        registerHostTool: (definition: RegisteredTool) => { calls.push({ name: "registerHostTool", args: [definition] }); tools.push(definition); return () => undefined },
        liveAgent: (id: string) => { calls.push({ name: "liveAgent", args: [id] }); return id === CAPTAIN_ID ? captain : undefined },
        liveAgents: () => { calls.push({ name: "liveAgents", args: [] }); return liveAgents },
        subagentProvider: (name: string) => { calls.push({ name: "subagentProvider", args: [name] }); return provider },
        subagentProviders: () => { calls.push({ name: "subagentProviders", args: [] }); return providers },
        startContinuableAgent: (spec: unknown) => { calls.push({ name: "startContinuableAgent", args: [spec] }); return Promise.resolve({ childId: "adapter-child" }) },
        interruptAgent: (id: string, authority: unknown) => { calls.push({ name: "interruptAgent", args: [id, authority] }); return undefined },
        subagentRuntime: () => { calls.push({ name: "subagentRuntime", args: [] }); return runtime },
        llmListModels: (name: string) => { calls.push({ name: "llmListModels", args: [name] }); return Promise.resolve([{ id: "model-1" }]) },
        llmResolveCallConfig: (config: unknown, signal: unknown) => { calls.push({ name: "llmResolveCallConfig", args: [config, signal] }); return Promise.resolve({ provider: "p", model: "m", reasoningEffort: "high" }) },
        registerPromptSection: (section: PromptSection) => { calls.push({ name: "registerPromptSection", args: [section] }); sections.push(section); return () => undefined },
        registerCommand: (definition: RegisteredCommand) => { calls.push({ name: "registerCommand", args: [definition] }); commands.push(definition); return () => undefined },
        onEvent: (event: string, handler: (payload: unknown) => void) => {
            calls.push({ name: "onEvent", args: [event] })
            handlers.set(event, [...(handlers.get(event) ?? []), handler])
            return () => undefined
        },
        agentScope: (agent: { readonly ctx?: unknown } | undefined) => {
            calls.push({ name: "agentScope", args: [agent] })
            return {
                context: agent?.ctx,
                tools: { restrict: (filter: unknown) => { calls.push({ name: "scope.tools.restrict", args: [filter] }); return () => undefined } },
                on: (event: string) => { calls.push({ name: "scope.on", args: [event] }); return () => undefined },
                effect: (label: string) => { calls.push({ name: "scope.effect", args: [label] }); return () => undefined },
            }
        },
        startAgentTurn: (agent: unknown, message: unknown) => { calls.push({ name: "startAgentTurn", args: [agent, message] }); return undefined },
        steerAgentTurn: (agent: unknown, message: unknown) => { calls.push({ name: "steerAgentTurn", args: [agent, message] }); return undefined },
        injectAgentMessage: (agent: unknown, message: unknown) => { calls.push({ name: "injectAgentMessage", args: [agent, message] }); return undefined },
        cancelAgentTurn: (agent: unknown, cause: unknown, options: unknown) => { calls.push({ name: "cancelAgentTurn", args: [agent, cause, options] }); return undefined },
        record,
    }
    /** The captain handle `liveAgent` resolves for {@link CAPTAIN_ID}, installed by the tests. */
    let captain: unknown
    return Object.assign(adapter, { setCaptain: (value: unknown) => { captain = value } })
}

/**
 * A raw ctx whose HARNESS SEAMS throw (and are recorded) on any touch, with the cordis-core members
 * the plugin legitimately owns (`logger`, `effect`, `get`, `inject`) working.
 */
function throwingRawCtx(adapter: unknown): { ctx: RawCtx; rawHits: string[]; disposers: Array<{ label: string; dispose: () => void }> } {
    /** Every read of a raw harness seam, as `label.member` (or `on(event)`). */
    const rawHits: string[] = []
    /** Lifetimes registered through the fake `effect`, disposed by the tests. */
    const disposers: Array<{ label: string; dispose: () => void }> = []
    /** A seam object that records and throws on ANY read, which is what makes the detector falsifiable. */
    const seamObject = (label: string): ThrowingSeam => new Proxy({}, {
        /** Every read is recorded and thrown, so a seam can never be served by accident. */
        get(_target: object, prop: string | symbol): never {
            rawHits.push(`${label}.${String(prop)}`)
            throw new Error(`the raw ctx seam "${label}.${String(prop)}" was touched while an adapter was mounted`)
        },
    }) as ThrowingSeam
    /** The raw ctx the plugin is applied to: harness seams hostile, cordis-core members benign. */
    const ctx = {
        tools: seamObject("tools"),
        agents: seamObject("agents"),
        subagents: seamObject("subagents"),
        commands: seamObject("commands"),
        systemPrompt: seamObject("systemPrompt"),
        llm: seamObject("llm"),
        on: (...args: unknown[]) => { rawHits.push(`on(${String(args[0])})`); throw new Error("the raw ctx seam \"on\" was touched while an adapter was mounted") },
        logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: () => undefined },
        effect: (callback: () => (() => void) | undefined, label: string) => {
            /** The disposer the callback returned, registered below only when it is a function. */
            const dispose = callback()
            if (typeof dispose === "function") disposers.push({ label, dispose })
            return () => dispose?.()
        },
        get: (name: string, strict: unknown) => (name === "mpdDsh" && strict === true ? adapter : undefined),
        inject: (_deps: unknown, callback: (inner: unknown) => void) => { callback(ctx); return () => undefined },
    }
    return { ctx, rawHits, disposers }
}

/** A fake captain/member whose session cwd is the SANDBOX workspace (the plugin derives stateRoot from it). */
const workspaceAgent = (id: string, workspace: string, extra: Record<string, unknown> = {}): FakeAgent => fakeAgent(id, {
    session: { header: { cwd: workspace, seedLength: 0 }, ownEvents: () => [], append: () => undefined, requestHeader: () => ({ config: { provider: "p", model: "m" } }) },
    ...extra,
})
/** A fake agent handle with a session, a selection and inert turn hooks, overridden by `extra`. */
const fakeAgent = (id: string, extra: Record<string, unknown> = {}): FakeAgent => ({
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
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its two instruments. */
    const { ctx, rawHits, disposers } = throwingRawCtx(adapter)
    /** The sandbox workspace the state root resolves inside. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-ac3-apply-"))
    try {
        /** The live member the apply path must see. */
        const memberAgent = workspaceAgent("member-1", workspace)
        adapter.setCaptain(workspaceAgent(CAPTAIN_ID, workspace))
        adapter.setLiveAgents([memberAgent])
        apply(ctx, new Config({}))
        /** The tool names that reached the adapter, in registration order. */
        const names = adapter.tools.map((definition) => definition.name)
        expect(names).toHaveLength(21)
        for (const name of names) expect(name.startsWith("agent_teams_")).toBe(true)
        // The other apply-path entry points of the AC3 text.
        /** The facade over the adapter, on the same raw ctx. */
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
        /** The listener count before the two direct installers run, so growth is measured. */
        const listenersBefore = adapter.calls.filter((entry) => entry.name === "onEvent").length
        installSessionTeamPolicy(facade, { sessionTeamPolicy: { mode: "auto", autoRoute: true, name: "MPD Default", approval: "required", presets: [] } })
        installInterjectionExpirySweep(facade, { stateDir: STATE_DIR })
        expect(adapter.calls.filter((entry) => entry.name === "onEvent").length).toBeGreaterThan(listenersBefore)

        /** Every seam name the adapter was reached through, in call order. */
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
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its raw-hit instrument. */
    const { ctx, rawHits } = throwingRawCtx(adapter)
    /** The facade over the adapter, on the same raw ctx. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    registerAgentTeamsCommand(facade, () => ({}), () => undefined)
    // `expect(...).toBeDefined()` is invisible to the type checker, so the defined-ness the assertion
    // proves is restored by a cast rather than by changing the lookup expression itself.
    /** The registered `agent-teams` command definition. */
    const command = adapter.commands.find((definition) => definition.name === "agent-teams") as RegisteredCommand
    expect(command).toBeDefined()
    /** The captain handle the command handler is invoked with. */
    const agent = fakeAgent(CAPTAIN_ID)
    await command.handler({ agent, rawInput: "goal" })
    /** The turn-start calls the command path made. */
    const start = adapter.calls.filter((call) => call.name === "startAgentTurn")
    expect(start).toHaveLength(1)
    expect(start[0].args[0]).toBe(agent)
    expect(rawHits).toEqual([])
})

test("AC3: the runtime-only seams route through the consumers that own them", async () => {
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its raw-hit instrument. */
    const { ctx, rawHits } = throwingRawCtx(adapter)
    /** The facade over the adapter, on the same raw ctx. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    /** The captain handle the consumers resolve their agent scope from. */
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
    /** The member fixture `spawnMember` fills the started child id into. */
    const member: { name: string; id?: string } = { name: "Member" }
    await spawnMember(facade, { provider: "spawn" }, { withPending: (_id: unknown, _label: unknown, _selection: unknown, start: () => unknown) => start() }, { provider: "p", model: "m" }, captain, { id: "t", name: "team", tasks: [], members: [] }, member, STATE_DIR, undefined)
    expect(member.id).toBe("adapter-child")
    // 5. llm.listModels (a bad model id is caught by the catalog the adapter served)
    await expect(validateMemberLlmSelections(facade, [{ provider: "p", model: "ghost" }], undefined)).rejects.toThrow(/unknown member model "ghost"/)
    await validateMemberLlmSelections(facade, [{ provider: "p", model: "model-1" }], undefined)
    // 6. llm.resolveCallConfig
    /** The resolved captain selection, which must come from the adapter's resolve seam. */
    const selection = await resolveMemberLlmSelection(facade, captain, {}, undefined)
    expect(selection).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
    // 7. agents.get on a path that is not the command handler
    expect(captainSessionOf(facade, CAPTAIN_ID, undefined)).toBe(captain.session)

    /** Every seam name the adapter was reached through on these consumer paths. */
    const recorded = adapter.calls.map((call) => call.name)
    for (const name of ["subagentRuntime", "interruptAgent", "subagentProvider", "subagentProviders", "startContinuableAgent", "llmListModels", "llmResolveCallConfig", "liveAgent"]) {
        expect(recorded, `the consumer path never reached the adapter's ${name}`).toContain(name)
    }
    expect(rawHits).toEqual([])
})

test("AC3: haltTeamWork drains through the RUNTIME the adapter resolves (the measured gap)", async () => {
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its raw-hit instrument. */
    const { ctx, rawHits } = throwingRawCtx(adapter)
    /** The facade over the adapter, on the same raw ctx. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    /** The sandbox workspace the halted team's state is written under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-ac3-halt-"))
    /** The state root the halted team record is read from. */
    const stateRoot = join(workspace, STATE_DIR)
    try {
        /** The captain handle the halt path resolves live children from. */
        const captain = fakeAgent(CAPTAIN_ID)
        adapter.setCaptain(captain)
        /** The halted team's own directory. */
        const teamRoot = join(stateRoot, "halted-team")
        mkdirSync(join(teamRoot, "inbox"), { recursive: true })
        writeFileSync(join(teamRoot, "team.json"), JSON.stringify({
            id: "halted-team", name: "halted team", captainSessionId: CAPTAIN_ID, createdAt: 1, taskSeq: 0,
            phase: "running", members: [{ id: "member-1", name: "Member", role: "engineer", status: "idle", joinedAt: 1 }], tasks: [],
        }, null, 2))
        /** The halt result the tool returned. */
        const result = await haltTeamWork({ ctx: facade, stateRoot, teamId: "halted-team", captain, signal: undefined })
        expect(result.teamName).toBe("halted team")
        /** Every seam name the halt path was reached through. */
        const recorded = adapter.calls.map((call) => call.name)
        // The two stop-boundary cancellations, the child interrupt and the captain lookup.
        expect(recorded.filter((name) => name === "cancelAgentTurn")).toHaveLength(2)
        expect(recorded).toContain("interruptAgent")
        expect(recorded).toContain("liveAgent")
        // The drain runs on the RUNTIME: reading the facade's `subagents` projection instead would
        // have silently downgraded this stop path to the quiescence fallback (tools.js:311).
        expect(adapter.runtimeCalls.some(([name]) => name === "drainContinuableChildren")).toBe(true)
        expect(rawHits).toEqual([])
        /** The on-disk team record, which must carry the halt stamp. */
        const halted = JSON.parse(readFileSync(join(teamRoot, "team.json"), "utf8"))
        expect(halted.halted).toBe(true)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("F2: the steer/inject seams route through the adapter, and the caller's throw contract survives", async () => {
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its raw-hit instrument. */
    const { ctx, rawHits } = throwingRawCtx(adapter)
    /** The facade over the adapter, on the same raw ctx. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    /** The sandbox workspace the staged team's state is written under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-f2-steer-"))
    /** The state root the staged team record is read from. */
    const stateRoot = join(workspace, STATE_DIR)
    try {
        /** The captain whose report is steered back to it. */
        const captain = workspaceAgent(CAPTAIN_ID, workspace)
        adapter.setCaptain(captain)
        // 1. steer: the member-report path (members.js steerCaptainReport).
        expect(steerCaptainReport(facade, captain, "Member", "a report")).toBe(true)
        expect(adapter.calls.some((call) => call.name === "steerAgentTurn")).toBe(true)
        // 2. the same path with a REJECTING adapter seam: the throw must reach the caller's catch.
        /** A second adapter whose steer seam throws, to exercise the caller's catch. */
        const rejecting = recordingAdapter()
        rejecting.steerAgentTurn = () => { throw new Error("steer rejected by the host") }
        /** The facade over the rejecting adapter, on its own hostile raw ctx. */
        const rejectingFacade = createAgentTeamsCtx(throwingRawCtx(rejecting).ctx, { witness: () => undefined })
        expect(steerCaptainReport(rejectingFacade, captain, "Member", "a report")).toBe(false)
        // 3. inject: the REAL discard path (tools.js discardStagedTeam) on real staged state.
        /** The registered tool runtime whose discard path is driven below. */
        const runtime = registerAgentTeamsTools(facade, { stateDir: STATE_DIR })
        /** The staged team's own directory. */
        const stagedRoot = join(stateRoot, "staged-team")
        mkdirSync(join(stagedRoot, "inbox"), { recursive: true })
        writeFileSync(join(stagedRoot, "team.json"), JSON.stringify({
            id: "staged-team", name: "staged team", captainSessionId: CAPTAIN_ID, createdAt: 1, taskSeq: 0,
            phase: "staged", members: [], tasks: [],
        }, null, 2))
        /** The discard result the staged-team path returned. */
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
    /** The recording adapter every seam must be reached through. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its raw-hit instrument. */
    const { ctx, rawHits } = throwingRawCtx(adapter)
    /** The facade over the adapter, on the same raw ctx. */
    const facade = createAgentTeamsCtx(ctx, { witness: () => undefined })
    // A host-provided per-agent ctx that THROWS on every read: with the adapter mounted, the
    // adapter's scope is the path taken, so the member setup must never read this ctx at all — and a
    // read of it never counts toward the plugin-ctx instrument (F7's scope rule).
    /** The host per-agent ctx: every read throws, so any touch is loud. */
    const hostAgentCtx = new Proxy({}, {
        /** Any read of the host ctx throws, which is exactly what this arm asserts. */
        get(_target: object, prop: string | symbol): never { throw new Error(`host per-agent ctx read: ${String(prop)}`) },
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
    /** A recording adapter, only needed so the raw ctx has a service to resolve. */
    const adapter = recordingAdapter()
    /** The hostile raw ctx plus its raw-hit instrument. */
    const { ctx, rawHits } = throwingRawCtx(adapter)
    expect(() => ctx.tools.register({ name: "t" })).toThrow(/was touched while an adapter was mounted/)
    expect(() => ctx.subagents.interrupt("s", {})).toThrow()
    expect(() => ctx.on("agent/pre-step", () => undefined)).toThrow()
    expect(rawHits).toEqual(["tools.register", "subagents.interrupt", "on(agent/pre-step)"])
})
