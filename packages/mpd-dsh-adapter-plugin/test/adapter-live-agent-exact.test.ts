// ADAPTER — `liveAgentExact`, the IDENTITY seam a forwarded parent must come from (root cause 2).
//
// THE HOST'S PRECONDITION: `@deepseek-ai/dsh-subagent` refuses a spawn unless
// `this.ctx.get("agents")?.get(spec.request.parent.id) === spec.request.parent` — strict identity against
// ITS OWN registry. `liveAgent` falls back to a LIST SCAN, so it can answer a handle the host's own `get`
// never returns; the spawn then throws `UNAUTHORIZED: subagent creation requires the exact live parent
// agent`, which is the sentence every fenced VEdit checkpoint carries. The exact seam answers the
// registry's OWN instance or `undefined` — it never scans and never rebuilds.
import { test, expect } from "bun:test"
import { createDshAdapter } from "../src/index.ts"

/** One fake live Agent: only the id this seam keys on. */
interface FakeAgent {
  /** The shared session/agent id. */
  id: string
}

/**
 * An adapter over one registry double.
 *
 * @param agents - the `agents` service double, or undefined for a composition without one.
 * @returns the adapter.
 */
function adapterOver(agents: unknown): ReturnType<typeof createDshAdapter> {
  /** The ctx: this registry and nothing else. */
  const ctx = { get: (name: string): unknown => (name === "agents" ? agents : undefined) }
  return createDshAdapter(ctx as never)
}

test("R2: liveAgentExact answers the registry's OWN instance", () => {
  /** The live Agent the registry holds. */
  const agent: FakeAgent = { id: "agent-live" }
  /** The adapter under test. */
  const dsh = adapterOver({ get: (id: string): FakeAgent | undefined => (id === agent.id ? agent : undefined), list: (): FakeAgent[] => [agent] })
  // IDENTITY is the whole contract: the host compares `===`, so a copy would be a defect.
  expect(dsh.liveAgentExact("agent-live")).toBe(agent)
})

test("R2: liveAgentExact does NOT scan the list — a handle only the list carries answers undefined", () => {
  /** The handle a list scan would find. */
  const listed: FakeAgent = { id: "agent-listed" }
  /** A registry whose identity lookup does not know the id while its list still carries it. */
  const dsh = adapterOver({ get: (_id: string): undefined => undefined, list: (): FakeAgent[] => [listed] })
  // `liveAgent` WOULD answer the scanned handle — which is exactly the object the host refuses…
  expect(dsh.liveAgent("agent-listed")).toBe(listed)
  // …and the exact seam refuses to forward it: `undefined` is the caller's cue to refuse with its reason.
  expect(dsh.liveAgentExact("agent-listed")).toBeUndefined()
})

test("R2: liveAgentExact answers undefined for an unknown id, an empty id, a missing registry and a throwing lookup", () => {
  /** The adapter over a registry that knows nothing. */
  const dsh = adapterOver({ get: (_id: string): undefined => undefined })
  expect(dsh.liveAgentExact("agent-missing")).toBeUndefined()
  expect(dsh.liveAgentExact("")).toBeUndefined()
  // A composition with no `agents` service cannot prove identity at all.
  expect(adapterOver(undefined).liveAgentExact("agent-any")).toBeUndefined()
  // A registry that throws is a miss, never a crashed barrier.
  expect(adapterOver({ get: (_id: string): never => { throw new Error("the registry is gone") } }).liveAgentExact("agent-any")).toBeUndefined()
})
