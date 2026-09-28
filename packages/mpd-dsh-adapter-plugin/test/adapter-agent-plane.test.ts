// The AGENT-SCOPED half of the adapter surface: one agent's own system-prompt registry
// (`agentPromptSection`) and the `agent/pre-step` waterfall (`onAgentPreStep`).
//
// Both exist for the roster plane (mpd-roles-plugin, AGENTS.md §13/§1): the roster section
// must reach ONE mpd session's Lead and not every session this process serves, and the
// session-start gate must amend a step's decision. The double below records the RECEIVER of
// every call and the exact object forwarded, so a lost `this`, a rebuilt section or a lost
// downstream decision fails here instead of in a session.
import { describe, expect, test } from "bun:test"

import { createDshAdapter } from "../src/index"

/** One recorded call: the seam name, the receiver it was called on, and the forwarded arguments. */
type Call = { seam: string; receiver: unknown; args: unknown[] }

/** A recording double of an agent-scoped ctx and the host event bus. */
function agentPlaneHarness(): {
  /** The ctx handed to the adapter: the `agents` service plus the host event bus. */
  ctx: { get(serviceName: string): { list(): unknown[] } | undefined; on(event: string, listener: (...args: unknown[]) => unknown): () => void }
  /** Every call the double recorded, in order. */
  calls: Call[]
  /** Host-plane event listeners the double collected. */
  registered: Array<{ event: string; listener: (...args: unknown[]) => unknown }>
  /** The live Agent handle carrying the agent-scoped ctx. */
  agent: {
    id: string
    ctx: {
      marker: string
      systemPrompt: { marker: string; section(this: unknown, section: unknown): () => void }
      on: () => () => void
      effect: () => () => void
      tools: { restrict: () => () => void }
    }
  }
  /** The agent's own systemPrompt service, whose identity the test asserts on. */
  agentSystemPrompt: { marker: string; section(this: unknown, section: unknown): () => void }
  /** The registry disposer a section() call must return. */
  sectionDispose: () => void
} {
  /** Every call the double observed, in the order the adapter made them. */
  const calls: Call[] = []
  /** Push one call onto the log, keeping the receiver and the forwarded arguments. */
  const record = (seam: string, receiver: unknown, ...args: unknown[]): void => { calls.push({ seam, receiver, args }) }

  /** Host-plane event listeners the double collected, keyed by event name. */
  const registered: Array<{ event: string; listener: (...args: unknown[]) => unknown }> = []
  /** The registry's own disposer, returned so identity can be asserted. */
  const sectionDispose = (): void => { /* the registry's own disposer */ }
  /** The agent's OWN systemPrompt service: records `this` and the forwarded section. */
  const agentSystemPrompt = {
    marker: "agent-system-prompt",
    /** Record the call and hand back the registry's disposer. */
    section(this: unknown, section: unknown): () => void {
      record("agent.ctx.systemPrompt.section", this, section)
      return sectionDispose
    },
  }
  /** The live Agent handle the adapter must read its own scope from. */
  const agent = {
    id: "lead-1",
    ctx: {
      marker: "agent-ctx",
      systemPrompt: agentSystemPrompt,
      on: () => () => {},
      effect: () => () => {},
      tools: { restrict: () => () => {} },
    },
  }
  /** The live-session registry: exactly one agent. */
  const agents = { list: () => [agent] }
  /** The ctx the adapter is built over: the `agents` service plus the host event bus. */
  const ctx = {
    get: (serviceName: string) => (serviceName === "agents" ? agents : undefined),
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      registered.push({ event, listener })
      return () => { /* unregistered */ }
    },
  }
  return { ctx, calls, registered, agent, agentSystemPrompt, sectionDispose }
}

describe("agentPromptSection: ONE agent's own prompt registry", () => {
  test("forwards the section VERBATIM, receiver-bound, and passes the disposer back", () => {
    /** The full double: agent scope plus host event bus. */
    const full = agentPlaneHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)
    /** The roster section forwarded verbatim. */
    const section = { name: "mpd:roster", order: 605, text: "- Architect [read-only]" }
    /** The disposer the registry returned, which must come back by identity. */
    const dispose = adapter.agentPromptSection(full.agent, section)

    expect(full.calls).toHaveLength(1)
    expect(full.calls[0].seam).toBe("agent.ctx.systemPrompt.section")
    expect(full.calls[0].receiver).toBe(full.agentSystemPrompt)
    expect(full.calls[0].args[0]).toBe(section)
    expect(dispose).toBe(full.sectionDispose)
  })

  test("a non-callable registry answer degrades to a no-op disposer", () => {
    /** A double whose agent-scoped registry answers a non-callable. */
    const stub = agentPlaneHarness()
    /** An agent whose own scope carries a section() returning a number. */
    const agent = { id: "a", ctx: { systemPrompt: { section: () => 42 } } }
    /** The degraded disposer, which must be callable and harmless. */
    const dispose = createDshAdapter(stub.ctx).agentPromptSection(agent, { name: "x", order: 1, text: "t" })
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })

  test("THROWS an actionable error when the agent scope exposes no section seam", () => {
    /** The adapter under test, over a ctx with a real agent scope. */
    const adapter = createDshAdapter(agentPlaneHarness().ctx)
    expect(() => adapter.agentPromptSection({ id: "bare" }, { name: "mpd:roster", order: 605, text: "t" }))
      .toThrow(/the agent's own scope exposes no systemPrompt\.section\(\) — cannot register prompt section "mpd:roster"/)
    expect(() => adapter.agentPromptSection(
      {
        id: "throwing",
        ctx: {
          /** A scope whose systemPrompt getter THROWS, as an uninjected cordis ctx does. */
          get systemPrompt(): never { throw new Error("cannot get property without inject") },
        },
      } as never,
      { name: "s", order: 1, text: "t" },
    )).toThrow(/exposes no systemPrompt\.section\(\)/)
  })

  test("the capability flag is a LIVE probe of the agent scope", () => {
    expect(createDshAdapter(agentPlaneHarness().ctx).capabilities().agentPromptSection).toBe(true)
    /** A ctx whose only live agent has no scoped context at all. */
    const bare = { get: (name: string) => (name === "agents" ? { list: () => [{ id: "bare" }] } : undefined) }
    expect(createDshAdapter(bare).capabilities().agentPromptSection).toBe(false)
    expect(createDshAdapter({ get: () => undefined }).capabilities().agentPromptSection).toBe(false)
  })
})

describe("onAgentPreStep: the adapter owns next()", () => {
  test("registers on the agent/pre-step waterfall and returns the downstream decision VERBATIM", async () => {
    /** The full double, whose host bus records the pre-step listener. */
    const full = agentPlaneHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)
    /** Every `(payload, decision)` pair the listener observed. */
    const seen: Array<[unknown, unknown]> = []
    /** The registration's disposer. */
    const dispose = adapter.onAgentPreStep((payload, decision) => { seen.push([payload, decision]); return undefined })

    expect(full.registered).toHaveLength(1)
    expect(full.registered[0].event).toBe("agent/pre-step")
    /** The step's claimed inbox messages. */
    const claimed = [{ id: "u1", role: "user" }]
    /** The pre-step payload the loop dispatches. */
    const payload = { agent: full.agent, messages: claimed, turn: 1, step: 1 }
    /** The harness's own decision, which the waterfall must return. */
    const downstream = { kind: "enter", messages: claimed }
    /** The decision the adapter returned, which must be that same object. */
    const result = await full.registered[0].listener(payload, async () => downstream)

    expect(result).toBe(downstream)
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toBe(payload)
    expect(seen[0][1]).toBe(downstream)
    expect(typeof dispose).toBe("function")
  })

  test("a listener's decision REPLACES the downstream one (that is how a notice is injected)", async () => {
    /** The full double. */
    const full = agentPlaneHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep((_payload, decision) => ({
      ...decision,
      messages: [...(decision.messages ?? []), { id: "notice-1", role: "user" }],
    }))
    /** The step's claimed inbox messages. */
    const claimed = [{ id: "u1", role: "user" }]
    /** The amended decision the adapter returned. */
    const result: any = await full.registered[0].listener({ messages: claimed }, async () => ({ kind: "enter", messages: claimed }))
    expect(result.kind).toBe("enter")
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].id).toBe("notice-1")
  })

  test("a THROWING listener is contained: the downstream decision stands", async () => {
    /** The full double. */
    const full = agentPlaneHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep(() => { throw new Error("broken gate") })
    /** The decision the harness produced, which must survive the throw. */
    const downstream = { kind: "enter", messages: [{ id: "u1" }] }
    expect(await full.registered[0].listener({ messages: downstream.messages }, async () => downstream)).toBe(downstream)
  })

  test("a listener that returns a rejected decision is forwarded (the gate may not veto)", async () => {
    /** The full double. */
    const full = agentPlaneHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep((_payload, decision) => decision)
    /** The reject decision the listener passes back. */
    const downstream = { kind: "reject" }
    expect(await full.registered[0].listener({}, async () => downstream)).toBe(downstream)
  })

  test("a missing `next` and a missing event bus both degrade instead of throwing", async () => {
    /** The full double. */
    const full = agentPlaneHarness()
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep(() => undefined)
    /** The step's claimed inbox messages. */
    const claimed = [{ id: "u1" }]
    expect(await full.registered[0].listener({ messages: claimed }, undefined)).toEqual({ kind: "enter", messages: claimed })

    /** An adapter over a ctx with no event bus at all. */
    const noBus = createDshAdapter({ get: () => undefined })
    expect(typeof noBus.onAgentPreStep(() => undefined)).toBe("function")
    expect(noBus.capabilities().agentPreStep).toBe(false)
    expect(createDshAdapter(full.ctx).capabilities().agentPreStep).toBe(true)
  })
})

describe("registerAgentPreStep: the registration site that DELIVERY reaches", () => {
  test("registers on the AGENT scope, never on the row's event bus", async () => {
    /** The full double, used only for its host ctx. */
    const full = agentPlaneHarness()
    /** Listeners registered on the AGENT's own scope, never on the row's bus. */
    const scoped: Array<{ event: string; listener: (...args: unknown[]) => unknown }> = []
    /** An agent whose own scope records its pre-step registrations. */
    const agent = { id: "lead-1", ctx: { on: (event: string, listener: (...args: unknown[]) => unknown) => { scoped.push({ event, listener }); return () => { /* unregistered */ } } } }
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)

    /** The registration's disposer. */
    const dispose = adapter.registerAgentPreStep(agent, (_payload, decision) => decision)

    expect(scoped.map((entry) => entry.event)).toEqual(["agent/pre-step"])
    expect(full.registered.map((entry) => entry.event)).not.toContain("agent/pre-step")
    expect(typeof dispose).toBe("function")

    /** The harness's own decision, which the scoped listener must return. */
    const downstream = { kind: "enter", messages: [{ id: "u1" }] }
    expect(await scoped[0].listener({ messages: downstream.messages }, async () => downstream)).toBe(downstream)
  })

  test("owns next() exactly like the host-plane sibling: amend, pass through, contain a throw", async () => {
    /** The full double, used only for its host ctx. */
    const full = agentPlaneHarness()
    /** Listeners registered on the first agent's own scope. */
    const scoped: Array<(...args: unknown[]) => unknown> = []
    /** An agent whose own scope records its pre-step registrations. */
    const agent = { id: "lead-1", ctx: { on: (_event: string, listener: (...args: unknown[]) => unknown) => { scoped.push(listener); return () => { /* unregistered */ } } } }
    /** The adapter under test. */
    const adapter = createDshAdapter(full.ctx)

    adapter.registerAgentPreStep(agent, (_payload, decision) => ({ ...decision, messages: [...(decision.messages ?? []), { id: "notice" }] }))
    /** The step's claimed inbox messages. */
    const claimed = [{ id: "u1" }]
    /** The decision the scoped listener produced. */
    const amended: any = await scoped[0]({ messages: claimed }, async () => ({ kind: "enter", messages: claimed }))
    expect(amended.messages).toHaveLength(2)

    // A listener that throws leaves the harness's own decision standing.
    const other: Array<(...args: unknown[]) => unknown> = []
    /** A second agent whose scope carries a listener that throws. */
    const agent2 = { id: "lead-2", ctx: { on: (_event: string, listener: (...args: unknown[]) => unknown) => { other.push(listener); return () => { /* unregistered */ } } } }
    adapter.registerAgentPreStep(agent2, () => { throw new Error("broken gate") })
    /** The decision the harness produced, which must survive the throw. */
    const downstream = { kind: "enter", messages: claimed }
    expect(await other[0]({ messages: claimed }, async () => downstream)).toBe(downstream)
  })

  test("THROWS when the agent scope exposes no on(), and the capability flag is a live probe", () => {
    /** The adapter under test, over a ctx with a real agent scope. */
    const adapter = createDshAdapter(agentPlaneHarness().ctx)
    expect(() => adapter.registerAgentPreStep({ id: "bare" }, (_p, d) => d))
      .toThrow(/the agent's own scope exposes no on\(\) — cannot register its agent\/pre-step listener/)
    expect(createDshAdapter(agentPlaneHarness().ctx).capabilities().agentPreStepScope).toBe(true)
    /** A ctx whose only live agent has no scoped context at all. */
    const bareAgent = { get: (name: string) => (name === "agents" ? { list: () => [{ id: "bare" }] } : undefined) }
    expect(createDshAdapter(bareAgent).capabilities().agentPreStepScope).toBe(false)
    expect(createDshAdapter({ get: () => undefined }).capabilities().agentPreStepScope).toBe(false)
  })
})
