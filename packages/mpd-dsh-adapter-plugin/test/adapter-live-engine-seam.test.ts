// ADAPTER — `compactionEngineForLiveAgent`, the seam that serves the LIVE handle (C1, D1).
//
// WHY THIS SEAM EXISTS (VEdit P0): the cellwork barrier used to resolve a member's engine by SESSION ID
// through the live-agent registry. By the time the barrier ran, the member's Agent was already detached
// from `ctx.agents` (`no-engine`), even though the handle the `agent/turn-stopping` event carried still
// served its own realm through `agent.ctx.get("compaction")`. This seam reads THAT handle directly, so
// the engine is reachable while the member is still live — before any registry lookup.
//
// The memo keeps the S2 property intact: it is keyed by the LIVE AGENT OBJECT, so a recycled id can never
// inherit a previous incarnation's engine.
import { test, expect } from "bun:test"
import { createDshAdapter } from "../src/index.ts"

/**
 * A fake live Agent carrying its own scoped engine, as the host object does.
 *
 * @param id - the shared session/agent id.
 * @param engine - the engine the Agent's own scope serves.
 * @returns the handle.
 */
function liveAgent(id: string, engine: unknown): { id: string; ctx: { get: (name: string) => unknown } } {
  return { id, ctx: { get: (name: string): unknown => (name === "compaction" ? engine : undefined) } }
}

/**
 * An adapter over a registry that knows NONE of the agents (the measured D1 condition).
 *
 * @returns the adapter.
 */
function adapterWithoutRegistryEntries(): ReturnType<typeof createDshAdapter> {
  /** The ctx: an empty live-session registry and nothing else. */
  const ctx = { get: (name: string): unknown => (name === "agents" ? { get: (): undefined => undefined, list: (): unknown[] => [] } : undefined) }
  return createDshAdapter(ctx as never)
}

test("C1: compactionEngineForLiveAgent reads the handle's OWN ctx, with no registry entry required", () => {
  /** The member-scoped engine, told apart by identity. */
  const engine = { realm: "member" }
  /** The stopping member's handle: reachable here, absent from the registry. */
  const agent = liveAgent("agent-detached", engine)
  /** The adapter under test. */
  const dsh = adapterWithoutRegistryEntries()
  // The registry-by-id seam answers nothing (that is the `no-engine` fence), the live handle answers.
  expect(dsh.compactionEngineForAgent("agent-detached")).toBeUndefined()
  expect(dsh.compactionEngineForLiveAgent(agent)).toBe(engine)
})

test("C1: the live-handle seam is memoized per Agent object, and a different incarnation gets its own engine", () => {
  /** The first incarnation's engine. */
  const first = { realm: "incarnation-1" }
  /** The second incarnation's engine. */
  const second = { realm: "incarnation-2" }
  /** The adapter under test. */
  const dsh = adapterWithoutRegistryEntries()
  /** The first handle. */
  const agentOne = liveAgent("agent-1", first)
  expect(dsh.compactionEngineForLiveAgent(agentOne)).toBe(first)
  // The SAME handle answers the memoized object.
  expect(dsh.compactionEngineForLiveAgent(agentOne)).toBe(first)
  // A RECYCLED id reaching a NEW handle is a different realm, never the previous one.
  expect(dsh.compactionEngineForLiveAgent(liveAgent("agent-1", second))).toBe(second)
})

test("C1: a handle with no usable scope answers undefined and never throws", () => {
  /** The adapter under test. */
  const dsh = adapterWithoutRegistryEntries()
  expect(dsh.compactionEngineForLiveAgent(undefined)).toBeUndefined()
  expect(dsh.compactionEngineForLiveAgent(null)).toBeUndefined()
  expect(dsh.compactionEngineForLiveAgent({ id: "agent-bare" })).toBeUndefined()
  // A scope whose `get` throws is the same answer: absent, not a crashed barrier.
  const throwing = { id: "agent-throwing", ctx: { get: (): never => { throw new Error("the realm is gone") } } }
  expect(dsh.compactionEngineForLiveAgent(throwing)).toBeUndefined()
  // A scope that serves no engine at all is absent too.
  expect(dsh.compactionEngineForLiveAgent({ id: "agent-empty", ctx: { get: (): undefined => undefined } })).toBeUndefined()
})
