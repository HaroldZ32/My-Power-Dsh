// The GOAL SEAM (D-goal): `goalState` reads the durable service, `goalControl` drives the harness
// TOOLS — never the mutating service methods — and both degrade instead of throwing.
//
// WHAT THIS FILE PINS, and why each arm exists:
//   * the ACTION→TOOL mapping and the EXACT argument names (`max_goal_rounds`, `goal_id`,
//     `revision`, `blocked_reason`): a rename there would make every call fail inside the harness;
//   * the REGISTRY ORDER: an agent-scoped registry answers first, because the goal trio is a
//     preset-plane row and the host-plane registry cannot see it;
//   * the POLICY contract: a refusal from the harness comes back as `ok:false` with its own text,
//     never as a throw and never as a fabricated success;
//   * the two EMPTY reads: `null` means "no goal", `undefined` means "cannot tell".
import { test, expect } from "bun:test"
import { GOAL_TOOL_NAMES, createDshAdapter } from "../src/index.ts"

/** One recorded tool call: the name and the arguments the seam sent. */
type Call = { name: string; arguments: Record<string, unknown>; agent?: unknown }

/** What one {@link toolOnlyHarness} double hands back to a test. */
interface ToolOnlyHarness {
  /** The adapter under test, bound to that ctx. */
  adapter: ReturnType<typeof createDshAdapter>
  /** Every call the seam made, in order. */
  calls: Call[]
}

/**
 * A harness double whose ONLY goal surface is the tool registry, plus the given answer table.
 *
 * @param answers - per-tool-name handlers; a handler that throws models a harness refusal.
 * @returns the adapter and the recorded calls.
 */
function toolOnlyHarness(answers: Record<string, (args: any) => any>): ToolOnlyHarness {
  /** Every call the seam made, in order. */
  const calls: Call[] = []
  /** The registry's `execute`, which records the call and applies the answer table. */
  const execute = async (input: any): Promise<unknown> => {
    calls.push({ name: input.name, arguments: input.arguments ?? {}, agent: input.agent })
    /** The handler for this tool name, or a miss. */
    const handler = answers[input.name]
    if (handler === undefined) return { isError: true, error: { message: 'unknown tool "' + input.name + '"' } }
    try {
      return { isError: false, value: handler(input.arguments ?? {}) }
    } catch (error: any) {
      return { isError: true, error: { message: String(error?.message ?? error) } }
    }
  }
  /** The host-plane tool registry: it can REGISTER and EXECUTE, and knows no goal tool by name. */
  const tools = {
    register: () => () => {},
    get: () => undefined,
    execute,
  }
  /** The ctx: the tool registry plus an optional goal service, added by the arms that need one. */
  const ctx = {
    get: (name: string) => (name === "tools" ? tools : undefined),
    on: () => () => {},
    provide: () => {},
  }
  return { adapter: createDshAdapter(ctx), calls }
}

/** A goal view shaped exactly like `ctx.goals.get(agent)` answers. */
function goalView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "goal-1",
    revision: 3,
    objective: "ship the wave",
    phase: "active",
    roundsStarted: 1,
    maxGoalRounds: 32,
    createdAt: 1,
    updatedAt: 2,
    activation: "armed",
    ...overrides,
  }
}

test("goalState reads the service, distinguishes null from unknown, and never throws", () => {
  /** An agent whose registry instance the service would authenticate. */
  const agent = { id: "agent-1" }
  /** A harness whose goal service answers a full view. */
  const withGoal = createDshAdapter({
    get: (name: string) => (name === "goals" ? { get: () => goalView() } : undefined),
    on: () => () => {},
    provide: () => {},
  })
  expect(withGoal.goalState(agent)).toEqual({
    id: "goal-1",
    revision: 3,
    objective: "ship the wave",
    phase: "active",
    roundsStarted: 1,
    maxGoalRounds: 32,
    activation: "armed",
  })
  // No current goal: `null` — the caller reads "there is none".
  const withoutGoal = createDshAdapter({
    get: (name: string) => (name === "goals" ? { get: () => undefined } : undefined),
    on: () => () => {},
    provide: () => {},
  })
  expect(withoutGoal.goalState(agent)).toBeNull()
  // A REFUSING service (the agent is not the live registry instance) is "cannot tell", not "none".
  const refusing = createDshAdapter({
    get: (name: string) => (name === "goals" ? { get: () => { throw new Error("not the live agent") } } : undefined),
    on: () => () => {},
    provide: () => {},
  })
  expect(refusing.goalState(agent)).toBeUndefined()
  // No service at all is also "cannot tell".
  expect(toolOnlyHarness({}).adapter.goalState(agent)).toBeUndefined()
})

test("goalControl maps each action onto the harness tools with their exact argument names", async () => {
  /** The harness double and the calls it records. */
  const { adapter, calls } = toolOnlyHarness({
    get_goal: () => ({ goal: goalView(), activation: "armed" }),
    create_goal: (args: any) => ({ goal: goalView({ objective: args.objective, maxGoalRounds: args.max_goal_rounds }), activation: "armed" }),
    update_goal: (args: any) => ({ goal: goalView({ phase: args.action === "complete" ? "complete" : "active" }), activation: "disarmed" }),
  })
  /** The agent the calls run for; forwarded verbatim so the harness can authenticate it. */
  const agent = { id: "agent-1" }

  /** The read action's outcome and the call it produced. */
  const read = await adapter.goalControl({ agent, action: "read" })
  expect(read.ok).toBe(true)
  expect(calls[0]).toEqual({ name: "get_goal", arguments: {}, agent })

  /** The create action's outcome and the call it produced. */
  const created = await adapter.goalControl({ agent, action: "create", objective: "ship the wave", maxGoalRounds: 12 })
  expect(created.ok).toBe(true)
  expect(created.goal?.objective).toBe("ship the wave")
  expect(created.goal?.maxGoalRounds).toBe(12)
  expect(calls[1]).toEqual({ name: "create_goal", arguments: { objective: "ship the wave", max_goal_rounds: 12 }, agent })

  /** The complete action, which must carry the exact CAS ref. */
  const completed = await adapter.goalControl({ agent, action: "complete", goalId: "goal-1", revision: 3 })
  expect(completed.ok).toBe(true)
  expect(calls[2]).toEqual({ name: "update_goal", arguments: { goal_id: "goal-1", revision: 3, action: "complete" }, agent })

  /** The blocked action, whose reason must ride under the harness's own key. */
  const blocked = await adapter.goalControl({ agent, action: "blocked", goalId: "goal-1", revision: 4, blockedReason: "two fruitless waves" })
  expect(blocked.ok).toBe(true)
  expect(calls[3]).toEqual({ name: "update_goal", arguments: { goal_id: "goal-1", revision: 4, action: "blocked", blocked_reason: "two fruitless waves" }, agent })
})

test("goalControl resolves a missing ref by reading the goal first, and refuses without one", async () => {
  /** The harness double and the calls it records. */
  const { adapter, calls } = toolOnlyHarness({
    get_goal: () => ({ goal: goalView({ revision: 9 }), activation: "armed" }),
    update_goal: (args: any) => ({ goal: goalView({ revision: args.revision + 1, phase: "complete" }), activation: "disarmed" }),
  })
  /** The ref-less complete, which must read the goal first. */
  const done = await adapter.goalControl({ action: "complete", agent: { id: "agent-1" } })
  expect(done.ok).toBe(true)
  // The read came first, and the mutation used ITS numbers — the CAS fence the harness requires.
  expect(calls.map((call) => call.name)).toEqual(["get_goal", "update_goal"])
  expect(calls[1].arguments).toEqual({ goal_id: "goal-1", revision: 9, action: "complete" })

  // No goal to read: the caller gets a refusal naming the reason, and NO update is attempted.
  /** An adapter whose session has no goal at all. */
  const empty = toolOnlyHarness({ get_goal: () => ({ goal: null }) }).adapter
  /** The refusal that empty read produces. */
  const refused = await empty.goalControl({ action: "complete", agent: { id: "agent-1" } })
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toBe("no current goal")
})

test("a policy refusal from the harness is reported verbatim, never thrown", async () => {
  /** The harness double whose create is refused for want of a human turn. */
  const { adapter } = toolOnlyHarness({
    create_goal: () => { throw new Error("this goal operation requires a direct human turn on a top-level agent") },
  })
  /** The refusal the harness returned. */
  const refused = await adapter.goalControl({ action: "create", objective: "invent one", agent: { id: "agent-1" } })
  expect(refused.ok).toBe(false)
  expect(refused.isError).toBe(true)
  expect(String(refused.error)).toBe("this goal operation requires a direct human turn on a top-level agent")
  // A missing objective and a missing agent are refused BEFORE any call reaches the harness.
  /** The refusal an empty objective produces. */
  const noObjective = await adapter.goalControl({ action: "create", agent: { id: "agent-1" } })
  expect(String(noObjective.error)).toContain("non-empty objective")
  /** The refusal an agent-less call produces. */
  const noAgent = await adapter.goalControl({ action: "read" })
  expect(String(noAgent.error)).toContain("calling agent")
})

test("the agent's OWN scoped registry answers first — that is where the goal trio lives", async () => {
  /** The scoped registry's calls, distinct from the host plane's. */
  const scopedCalls: Call[] = []
  /** The agent scope: enough members for the adapter's all-or-nothing probe, and an execute. */
  const agent = {
    id: "agent-1",
    ctx: {
      on: () => () => {},
      effect: () => () => {},
      tools: {
        restrict: () => () => {},
        execute: async (input: any) => {
          scopedCalls.push({ name: input.name, arguments: input.arguments ?? {} })
          return { isError: false, value: { goal: goalView(), activation: "armed" } }
        },
      },
    },
  }
  /** A harness whose HOST-plane registry would refuse every goal call. */
  const { adapter, calls } = toolOnlyHarness({})
  /** The read, which must have been served by the agent's own scope. */
  const read = await adapter.goalControl({ agent, action: "read" })
  expect(read.ok).toBe(true)
  expect(read.via).toBe("agent-scope")
  expect(scopedCalls.map((call) => call.name)).toEqual(["get_goal"])
  expect(calls).toHaveLength(0)

  // A scope WITHOUT a goal answer is not retried at the host plane: a throw is that call's outcome,
  // because a silent second attempt could run the same mutation twice.
  /** An agent whose scoped registry throws instead of answering. */
  const failing = {
    id: "agent-2",
    ctx: { on: () => () => {}, effect: () => () => {}, tools: { restrict: () => () => {}, execute: async () => { throw new Error("scope exploded") } } },
  }
  /** The failure that scope produced, which must NOT fall back to a host-plane retry. */
  const failed = await adapter.goalControl({ agent: failing, action: "read" })
  expect(failed.ok).toBe(false)
  expect(String(failed.error)).toContain("scope exploded")
  expect(calls).toHaveLength(0)
})

/** One live-Agent double as the scoped half of {@link scopedGoalHarness}. */
interface ScopedGoalAgent {
  /** The registry id the live-session service answers. */
  id: string
  /** The agent's OWN scope: the all-or-nothing members the adapter probes for, plus the registry. */
  ctx: {
    on: () => () => void
    effect: () => () => void
    tools: {
      restrict: () => () => void
      execute: () => Promise<unknown>
      get: (name: string, scope?: unknown) => unknown
    }
  }
}

/** What {@link scopedGoalHarness} hands back to a test. */
interface ScopedGoalHarness {
  /** The adapter under test, over a host plane that knows NO goal tool. */
  adapter: ReturnType<typeof createDshAdapter>
  /** Every viewing scope the agent-scoped registry was read with, in call order. */
  scopes: unknown[]
  /** The one live Agent handle. */
  agent: ScopedGoalAgent
}

/**
 * A harness double in which the goal trio is reachable ONLY through a live agent's scope.
 *
 * This models the INSTALLED registry contract the probe depends on and nothing more:
 * `get(name, scope)` resolves a tool along that scope's chain, so an OMITTED scope reads the
 * GLOBAL layer alone. The goal trio is a PRESET row in an mpd session, so it is registered in a
 * scope that is the agent's ANCESTOR — an unscoped read answers `undefined` for all three even
 * though the model can call them. The double therefore answers a goal tool only when the caller
 * named the agent that owns it, and records every viewing scope so an arm can assert the argument
 * was passed at all (the regression this pair exists for).
 *
 * @param carrier - whether the live agent's scope actually carries the goal trio.
 * @returns the adapter over that harness, the recorded viewing scopes, and the live agent.
 */
function scopedGoalHarness(carrier: boolean): ScopedGoalHarness {
  /** Every viewing scope the scoped registry was asked with, in call order. */
  const scopes: unknown[] = []
  /** The live Agent: its own ctx carries the preset-plane registry shape the adapter probes for. */
  const agent: ScopedGoalAgent = {
    id: "agent-1",
    ctx: {
      on: () => () => {},
      effect: () => () => {},
      tools: {
        restrict: () => () => {},
        execute: async () => ({ isError: false, value: { goal: goalView() } }),
        /** The registry's real resolution rule: a name resolves only for the scope that owns it. */
        get: (name: string, scope?: unknown) => {
          scopes.push(scope)
          return carrier && scope === agent && GOAL_TOOL_NAMES.includes(name) ? { name } : undefined
        },
      },
    },
  }
  /** The ctx: a host-plane registry that knows no goal tool, plus the live-agent registry. */
  const ctx = {
    get: (serviceName: string) => (serviceName === "tools"
      ? { register: () => () => {}, get: () => undefined, execute: async () => ({ isError: true, error: { message: "unknown tool" } }) }
      : serviceName === "agents" ? { list: () => [agent] } : undefined),
    on: () => () => {},
    provide: () => {},
  }
  return { adapter: createDshAdapter(ctx), scopes, agent }
}

test("capabilities().goalTools is TRUE through a live agent's scope and FALSE without the row", () => {
  // POSITIVE: the host plane cannot see the trio; the live agent's scope can, and the probe must
  // read it there. Naming the agent as the VIEWING SCOPE is what makes a preset row visible.
  /** A harness whose goal trio is mounted on the agent plane, as the `mpd` preset mounts it. */
  const mounted = scopedGoalHarness(true)
  expect(mounted.adapter.capabilities().goalTools).toBe(true)
  // One read per goal tool name, and EVERY one carried the live agent as its viewing scope: with the
  // argument dropped the registry answers the global layer, so this fails before the flag does.
  expect(mounted.scopes).toHaveLength(GOAL_TOOL_NAMES.length)
  expect(mounted.scopes.every((scope) => scope === mounted.agent)).toBe(true)

  // NEGATIVE CONTROL: the SAME composition with no goal row mounted stays false. The probe asks a
  // question about reachability; it is never a constant.
  /** The same live agent, whose scope carries no goal tool. */
  const bare = scopedGoalHarness(false)
  expect(bare.adapter.capabilities().goalTools).toBe(false)
  expect(bare.scopes.every((scope) => scope === bare.agent)).toBe(true)

  // The other two directions a false must still cover: a host-plane registry that carries every
  // goal name keeps the flag true with no live agent at all (the disjunction is an OR), while a
  // composition with neither plane reports false.
  /** A host-plane-only composition: the trio resolves globally, no session is live. */
  const hostOnly = createDshAdapter({
    get: (name: string) => (name === "tools"
      ? { get: (toolName: string) => (GOAL_TOOL_NAMES.includes(toolName) ? { name: toolName } : undefined) }
      : undefined),
    on: () => () => {},
    provide: () => {},
  })
  expect(hostOnly.capabilities().goalTools).toBe(true)
  expect(createDshAdapter({ get: () => undefined }).capabilities().goalTools).toBe(false)
})
