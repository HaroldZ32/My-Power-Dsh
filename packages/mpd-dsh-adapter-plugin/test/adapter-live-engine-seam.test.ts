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

// ── ROOT CAUSE 1: the engine lives in the preset's ISOLATE realm ───────────
//
// dsh-tui 0.18.0 disables the host's root `compaction-basic` row, and this bundle's `mpd` preset mounts
// compaction inside `isolate: { compaction: true, … }`. A realm-isolated service is NOT visible to
// `agent.ctx.get("compaction")`; the host's door is `agentPresets.serviceFor(agent, "compaction")` — the
// same order the installed TUI adapter uses (`agentPresets.serviceFor(agent, key) ?? ctx.get(key)`).
// The arms above all answer on `agent.ctx`, which is exactly why this suite was green while every real
// checkpoint answered `no-engine`. The arms below mount the preset door instead.

/** One recorded `agentPresets.serviceFor` call: the handle it was asked for and the key it was asked for. */
interface PresetDoorCall {
  /** The Agent handle the adapter forwarded. */
  agent: unknown
  /** The service key the adapter asked the roster for. */
  key: string
}

/**
 * The REAL composition dsh-tui 0.18.0 mounts: `agentPresets` answers (or, for the no-engine arm,
 * deliberately does not), and the live registry holds the member.
 *
 * @param agent - the member's handle; its own scope is whatever the caller put there.
 * @param engine - the realm engine the preset door serves, or undefined when no roster is mounted.
 * @param calls - the recorded `serviceFor` calls, so an arm can prove which door ran.
 * @returns the adapter over that composition.
 */
function adapterWithPresetDoor(agent: { id: string }, engine: unknown, calls: PresetDoorCall[]): ReturnType<typeof createDshAdapter> {
  /** The ctx: the preset roster's realm door and the live registry, nothing else. */
  const ctx = {
    get: (name: string): unknown => {
      if (name === "agentPresets") {
        return {
          serviceFor: (target: unknown, key: string): unknown => {
            calls.push({ agent: target, key })
            return key === "compaction" ? engine : undefined
          },
        }
      }
      if (name === "agents") return { get: (id: string): unknown => (id === agent.id ? agent : undefined), list: (): unknown[] => [agent] }
      return undefined
    },
  }
  return createDshAdapter(ctx as never)
}

test("R1: the PRESET-REALM door answers while the agent scope has no engine — the arm the fences needed", () => {
  /** The realm engine, told apart by identity. */
  const engine = { realm: "preset-isolate" }
  /** The member's handle: its own scope serves NO compaction service in this composition. */
  const agent = { id: "agent-realm", ctx: { get: (_name: string): undefined => undefined } }
  /** Every `serviceFor` call the adapter made. */
  const calls: PresetDoorCall[] = []
  /** The adapter over the REAL composition. */
  const dsh = adapterWithPresetDoor(agent, engine, calls)
  // THE HANDLE DOOR (what the barrier uses) and the ID-KEYED door both reach the realm.
  expect(dsh.compactionEngineForLiveAgent(agent)).toBe(engine)
  expect(dsh.compactionEngineForAgent("agent-realm")).toBe(engine)
  // …and the realm was reached through the host's door, asked for THIS agent and the compaction key.
  expect(calls.length).toBeGreaterThan(0)
  expect(calls[0].agent).toBe(agent)
  expect(calls[0].key).toBe("compaction")
})

test("R1: with BOTH doors answering, the PRESET REALM's engine wins — the order, not just the fallback", () => {
  /** The realm engine the preset door serves: the only correct one for an isolated composition. */
  const realmEngine = { realm: "preset-isolate" }
  /** The engine the agent's own scope would serve: a DIFFERENT object, so the order is observable. */
  const scopeEngine = { realm: "agent-scope" }
  /** The member's handle, whose scope also carries an engine. */
  const agent = { id: "agent-both", ctx: { get: (name: string): unknown => (name === "compaction" ? scopeEngine : undefined) } }
  /** The adapter over a composition whose preset roster answers. */
  const dsh = adapterWithPresetDoor(agent, realmEngine, [])
  // A scope-first resolver would answer `scopeEngine` here; the host's own order answers the realm's.
  expect(dsh.compactionEngineForLiveAgent(agent)).toBe(realmEngine)
  expect(dsh.compactionEngineForAgent("agent-both")).toBe(realmEngine)
})

test("R1: with NO preset roster and no agent-scope engine both seams answer undefined — never a fabricated engine", () => {
  /** The member's handle: no engine in its own scope. */
  const agent = { id: "agent-none", ctx: { get: (_name: string): undefined => undefined } }
  /** The adapter over a composition whose ctx mounts neither a roster nor a scope engine. */
  const dsh = adapterWithoutRegistryEntries()
  expect(dsh.compactionEngineForLiveAgent(agent)).toBeUndefined()
  expect(dsh.compactionEngineForAgent("agent-none")).toBeUndefined()
  // A roster that THROWS is still "no engine": the agent-scope door is tried and it answers nothing.
  /** The adapter over a roster whose `serviceFor` refuses the handle by throwing. */
  const throwing = createDshAdapter({
    get: (name: string): unknown => (name === "agentPresets"
      ? { serviceFor: (): never => { throw new Error("the realm is gone") } }
      : undefined),
  } as never)
  expect(throwing.compactionEngineForLiveAgent(agent)).toBeUndefined()
})
