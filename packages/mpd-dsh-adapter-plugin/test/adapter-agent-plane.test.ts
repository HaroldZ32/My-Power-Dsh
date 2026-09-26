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

type Call = { seam: string; receiver: unknown; args: unknown[] }

/** A recording double of an agent-scoped ctx and the host event bus. */
function agentPlaneHarness() {
  const calls: Call[] = []
  const record = (seam: string, receiver: unknown, ...args: unknown[]): void => { calls.push({ seam, receiver, args }) }

  const registered: Array<{ event: string; listener: (...args: unknown[]) => unknown }> = []
  const sectionDispose = () => { /* the registry's own disposer */ }
  const agentSystemPrompt = {
    marker: "agent-system-prompt",
    section(this: unknown, section: unknown) {
      record("agent.ctx.systemPrompt.section", this, section)
      return sectionDispose
    },
  }
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
  const agents = { list: () => [agent] }
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
    const full = agentPlaneHarness()
    const adapter = createDshAdapter(full.ctx)
    const section = { name: "mpd:roster", order: 605, text: "- Architect [read-only]" }
    const dispose = adapter.agentPromptSection(full.agent, section)

    expect(full.calls).toHaveLength(1)
    expect(full.calls[0].seam).toBe("agent.ctx.systemPrompt.section")
    expect(full.calls[0].receiver).toBe(full.agentSystemPrompt)
    expect(full.calls[0].args[0]).toBe(section)
    expect(dispose).toBe(full.sectionDispose)
  })

  test("a non-callable registry answer degrades to a no-op disposer", () => {
    const stub = agentPlaneHarness()
    const agent = { id: "a", ctx: { systemPrompt: { section: () => 42 } } }
    const dispose = createDshAdapter(stub.ctx).agentPromptSection(agent, { name: "x", order: 1, text: "t" })
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })

  test("THROWS an actionable error when the agent scope exposes no section seam", () => {
    const adapter = createDshAdapter(agentPlaneHarness().ctx)
    expect(() => adapter.agentPromptSection({ id: "bare" }, { name: "mpd:roster", order: 605, text: "t" }))
      .toThrow(/the agent's own scope exposes no systemPrompt\.section\(\) — cannot register prompt section "mpd:roster"/)
    expect(() => adapter.agentPromptSection({ id: "throwing", ctx: { get systemPrompt(): never { throw new Error("cannot get property without inject") } } } as never, { name: "s", order: 1, text: "t" }))
      .toThrow(/exposes no systemPrompt\.section\(\)/)
  })

  test("the capability flag is a LIVE probe of the agent scope", () => {
    expect(createDshAdapter(agentPlaneHarness().ctx).capabilities().agentPromptSection).toBe(true)
    const bare = { get: (name: string) => (name === "agents" ? { list: () => [{ id: "bare" }] } : undefined) }
    expect(createDshAdapter(bare).capabilities().agentPromptSection).toBe(false)
    expect(createDshAdapter({ get: () => undefined }).capabilities().agentPromptSection).toBe(false)
  })
})

describe("onAgentPreStep: the adapter owns next()", () => {
  test("registers on the agent/pre-step waterfall and returns the downstream decision VERBATIM", async () => {
    const full = agentPlaneHarness()
    const adapter = createDshAdapter(full.ctx)
    const seen: unknown[] = []
    const dispose = adapter.onAgentPreStep((payload, decision) => { seen.push([payload, decision]); return undefined })

    expect(full.registered).toHaveLength(1)
    expect(full.registered[0].event).toBe("agent/pre-step")
    const claimed = [{ id: "u1", role: "user" }]
    const payload = { agent: full.agent, messages: claimed, turn: 1, step: 1 }
    const downstream = { kind: "enter", messages: claimed }
    const result = await full.registered[0].listener(payload, async () => downstream)

    expect(result).toBe(downstream)
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toBe(payload)
    expect(seen[0][1]).toBe(downstream)
    expect(typeof dispose).toBe("function")
  })

  test("a listener's decision REPLACES the downstream one (that is how a notice is injected)", async () => {
    const full = agentPlaneHarness()
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep((_payload, decision) => ({
      ...decision,
      messages: [...(decision.messages ?? []), { id: "notice-1", role: "user" }],
    }))
    const claimed = [{ id: "u1", role: "user" }]
    const result: any = await full.registered[0].listener({ messages: claimed }, async () => ({ kind: "enter", messages: claimed }))
    expect(result.kind).toBe("enter")
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].id).toBe("notice-1")
  })

  test("a THROWING listener is contained: the downstream decision stands", async () => {
    const full = agentPlaneHarness()
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep(() => { throw new Error("broken gate") })
    const downstream = { kind: "enter", messages: [{ id: "u1" }] }
    expect(await full.registered[0].listener({ messages: downstream.messages }, async () => downstream)).toBe(downstream)
  })

  test("a listener that returns a rejected decision is forwarded (the gate may not veto)", async () => {
    const full = agentPlaneHarness()
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep((_payload, decision) => decision)
    const downstream = { kind: "reject" }
    expect(await full.registered[0].listener({}, async () => downstream)).toBe(downstream)
  })

  test("a missing `next` and a missing event bus both degrade instead of throwing", async () => {
    const full = agentPlaneHarness()
    const adapter = createDshAdapter(full.ctx)
    adapter.onAgentPreStep(() => undefined)
    const claimed = [{ id: "u1" }]
    expect(await full.registered[0].listener({ messages: claimed }, undefined)).toEqual({ kind: "enter", messages: claimed })

    const noBus = createDshAdapter({ get: () => undefined })
    expect(typeof noBus.onAgentPreStep(() => undefined)).toBe("function")
    expect(noBus.capabilities().agentPreStep).toBe(false)
    expect(createDshAdapter(full.ctx).capabilities().agentPreStep).toBe(true)
  })
})

describe("registerAgentPreStep: the registration site that DELIVERY reaches", () => {
  test("registers on the AGENT scope, never on the row's event bus", async () => {
    const full = agentPlaneHarness()
    const scoped: Array<{ event: string; listener: (...args: unknown[]) => unknown }> = []
    const agent = { id: "lead-1", ctx: { on: (event: string, listener: (...args: unknown[]) => unknown) => { scoped.push({ event, listener }); return () => { /* unregistered */ } } } }
    const adapter = createDshAdapter(full.ctx)

    const dispose = adapter.registerAgentPreStep(agent, (_payload, decision) => decision)

    expect(scoped.map((entry) => entry.event)).toEqual(["agent/pre-step"])
    expect(full.registered.map((entry) => entry.event)).not.toContain("agent/pre-step")
    expect(typeof dispose).toBe("function")

    const downstream = { kind: "enter", messages: [{ id: "u1" }] }
    expect(await scoped[0].listener({ messages: downstream.messages }, async () => downstream)).toBe(downstream)
  })

  test("owns next() exactly like the host-plane sibling: amend, pass through, contain a throw", async () => {
    const full = agentPlaneHarness()
    const scoped: Array<(...args: unknown[]) => unknown> = []
    const agent = { id: "lead-1", ctx: { on: (_event: string, listener: (...args: unknown[]) => unknown) => { scoped.push(listener); return () => { /* unregistered */ } } } }
    const adapter = createDshAdapter(full.ctx)

    adapter.registerAgentPreStep(agent, (_payload, decision) => ({ ...decision, messages: [...(decision.messages ?? []), { id: "notice" }] }))
    const claimed = [{ id: "u1" }]
    const amended: any = await scoped[0]({ messages: claimed }, async () => ({ kind: "enter", messages: claimed }))
    expect(amended.messages).toHaveLength(2)

    // A listener that throws leaves the harness's own decision standing.
    const other: Array<(...args: unknown[]) => unknown> = []
    const agent2 = { id: "lead-2", ctx: { on: (_event: string, listener: (...args: unknown[]) => unknown) => { other.push(listener); return () => { /* unregistered */ } } } }
    adapter.registerAgentPreStep(agent2, () => { throw new Error("broken gate") })
    const downstream = { kind: "enter", messages: claimed }
    expect(await other[0]({ messages: claimed }, async () => downstream)).toBe(downstream)
  })

  test("THROWS when the agent scope exposes no on(), and the capability flag is a live probe", () => {
    const adapter = createDshAdapter(agentPlaneHarness().ctx)
    expect(() => adapter.registerAgentPreStep({ id: "bare" }, (_p, d) => d))
      .toThrow(/the agent's own scope exposes no on\(\) — cannot register its agent\/pre-step listener/)
    expect(createDshAdapter(agentPlaneHarness().ctx).capabilities().agentPreStepScope).toBe(true)
    const bareAgent = { get: (name: string) => (name === "agents" ? { list: () => [{ id: "bare" }] } : undefined) }
    expect(createDshAdapter(bareAgent).capabilities().agentPreStepScope).toBe(false)
    expect(createDshAdapter({ get: () => undefined }).capabilities().agentPreStepScope).toBe(false)
  })
})
