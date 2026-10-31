// THE LEAF BOUNDARY (CR repair E): a consult is a leaf, and a read-only child can never delegate.
//
// WHAT THIS LOCKS. The pinned host treats `maxDepth` as an absolute cap for the child being started and does
// NOT carry it into the child as a descendant restriction, so before this repair a child could call a spawn
// tool again, raise its own cap, and nest past the consultation boundary — and a READ-ONLY child could pick a
// write-capable role and have that child do the writing. Three controls now close it:
//   * every child this row raises gets BOTH bundle spawn tools DENIED in its own tool scope (so a consult is
//     a leaf whatever depth arithmetic the host applies, and a read-only child loses delegation entirely);
//   * the read-only applier carries those names in the SAME restriction call, so no child is restricted twice;
//   * `mpd_role_spawn` itself refuses a caller at delegation depth 2 or deeper — the hard floor under the
//     scope control, for a child whose scope restriction never landed.
//
// THE INTENDED NESTED CONSULTATION SURVIVES: a depth-0 captain raises a consult (0 → 1), and the cell PLANNER
// — a team member at depth 1, NOT a child of these tools — keeps `mpd_role_spawn`. Both are asserted below.
import { expect, test } from "bun:test"

import { READONLY_DENY, LEAF_SPAWN_DENY, apply, consultDepthRefusal } from "../src/index.ts"
import { LEAF_SPAWN_DENY as WORKMATE_LEAF_SPAWN_DENY } from "../../mpd-workmate-plugin/src/index.ts"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The route the fake config service answers, so the spawn arm has a usable model route. */
const ROUTE = { provider: "company-api", model: "deepseek-flash" }

/** One tool restriction this mount asked the adapter to apply, in call order. */
interface Restriction {
  /** The child whose own scope was restricted. */
  agent: unknown
  /** The deny names, in the order the row asked for them. */
  names: string[]
}

/** What one mounted row exposes to the arms below. */
interface Mounted {
  /** The tool definitions the row registered. */
  tools: any[]
  /** The live `agent/created` listeners, in registration order. */
  listeners: Array<(payload: unknown) => unknown>
  /** Every restriction the row asked the adapter for. */
  restrictions: Restriction[]
  /** Every spawn spec the adapter forwarded. */
  spawned: any[]
}

/**
 * Mount the roster row once, with the child-seam seams under this file's control.
 *
 * `createDshAdapter` is the REAL adapter with only three members replaced: the event bus (so the arms drive
 * `agent/created` themselves), the label read (so a child is the object the arm emitted) and the retained
 * deny applier (so the arms assert WHAT the row asks to deny; whether the host accepts that list is the
 * adapter's own contract, covered by its own tests).
 *
 * @returns the tools, listeners, restrictions and spawn specs of this mount.
 */
function mounted(): Mounted {
  /** Tool definitions the row registered, in registration order. */
  const tools: any[] = []
  /** The `agent/created` listeners, in registration order (the child-persona seam's, then the leaf one). */
  const listeners: Array<(payload: unknown) => unknown> = []
  /** Every restriction the row asked for, in call order. */
  const restrictions: Restriction[] = []
  /** Every spawn spec the adapter forwarded to the subagent seam. */
  const spawned: any[] = []
  /** The permissive cordis-shaped ctx the row's `apply` sees; its `mpdDsh` reader is wired below. */
  const ctx: any = {
    tools: {
      /** Record one tool definition; the row never reads a registration result. */
      register(d: unknown): void { tools.push(d) },
    },
    subagents: {
      /** The harness's own start seam; the real adapter reaches it through `ctx.subagents`. */
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { summary: "done" }, stopReason: "complete" } }
      },
    },
    provide: (): void => { /* the service nothing here asserts */ },
    get: (key: string) => (key === "mpdConfig" ? configDouble() : undefined),
  }
  /** The `mpdDsh` double the row resolves instead of building its own adapter. */
  const dsh: any = {
    ...createDshAdapter(ctx),
    onEvent: (event: string, handler: (...args: unknown[]) => unknown): (() => void) => {
      if (event === "agent/created") listeners.push(handler)
      return () => { /* this file drives the listeners directly */ }
    },
    subagentLabelOf: (agent: unknown): string | undefined => (agent as { label?: string } | undefined)?.label,
    restrictAgentToolsRetained: (agent: unknown, names: readonly string[]): { applied: string[]; pruned: string[] } => {
      restrictions.push({ agent, names: [...names] })
      return { applied: [...names], pruned: [] }
    },
  }
  ctx.get = (key: string) => (key === "mpdDsh" ? dsh : key === "mpdConfig" ? configDouble() : undefined)
  apply(ctx, {})
  return { tools, listeners, restrictions, spawned }
}

/**
 * The `mpdConfig`-shaped double the spawn arm reads its agent route from.
 *
 * @returns a service answering one usable route for every agent name.
 */
function configDouble(): { agentRouteResolutionOf: (member: string) => unknown } {
  return { agentRouteResolutionOf: (member: string): unknown => ({ ok: true, agent: member, route: ROUTE }) }
}

/**
 * One calling agent handle carrying a session header, as a dispatch carries it.
 *
 * @param header - the calling session's header fields under test.
 * @returns the exec double the registered tool receives.
 */
function caller(header: Record<string, unknown>): { agent: { id: string; session: { header: Record<string, unknown> } }; signal: AbortSignal } {
  return { agent: { id: "caller-session", session: { header } }, signal: new AbortController().signal }
}

/**
 * Broadcast one `agent/created` payload to every listener, the way the host does.
 *
 * @param listeners - the listeners this mount registered.
 * @param agent - the child agent the payload carries.
 */
function emitCreated(listeners: Array<(payload: unknown) => unknown>, agent: Record<string, unknown>): void {
  for (const listener of listeners) listener({ agent })
}

test("the leaf list is exactly the two bundle spawn tools, and the workmate row's copy is identical", () => {
  expect([...LEAF_SPAWN_DENY]).toEqual(["mpd_role_spawn", "mpd_workmate_spawn"])
  // PARITY, pinned from source (test-only import): the two rows ship their own copies on purpose.
  expect([...WORKMATE_LEAF_SPAWN_DENY]).toEqual([...LEAF_SPAWN_DENY])
  // THE SEPARATION IS INTENTIONAL: the read-only guarantee is untouched at exactly eight names.
  expect(READONLY_DENY).toHaveLength(8)
  expect(READONLY_DENY).not.toContain("mpd_role_spawn")
})

test("the depth floor: a consult may be raised from depth 0 or 1, and never from depth 2 or deeper", () => {
  // ALLOWED: the top-level captain (depth 0) and a depth-1 caller — the cell PLANNER is one, and its
  // `mpd_role_spawn` route must keep working.
  expect(consultDepthRefusal(undefined)).toBeUndefined()
  expect(consultDepthRefusal({ session: { header: { delegationDepth: 0 } } })).toBeUndefined()
  expect(consultDepthRefusal({ session: { header: { delegationDepth: 1 } } })).toBeUndefined()
  // A subagent-origin session with no recorded depth is a CHILD (depth 1) — still allowed.
  expect(consultDepthRefusal({ session: { header: { origin: "subagent" } } })).toBeUndefined()
  // REFUSED: a session at depth 2 or deeper, whatever recorded the depth.
  for (const header of [{ delegationDepth: 2 }, { delegationDepth: 3 }, { delegationDepth: "2" }]) {
    /** The refusal that header produces. */
    const denial = consultDepthRefusal({ session: { header } })
    expect(String(denial)).toContain("mpd spawn rule")
    expect(String(denial)).toContain("may not raise another consult")
    // It names BOTH bundle tools and the reason, so the model can act on it.
    expect(String(denial)).toContain("mpd_role_spawn")
    expect(String(denial)).toContain("mpd_workmate_spawn")
    expect(String(denial)).toContain("LEAF")
  }
})

test("THE WIRING: mpd_role_spawn refuses a depth-2 caller and starts NO child, while depth 1 still spawns", async () => {
  /** The mount the arms below drive. */
  const harness = mounted()
  /** The one-shot spawn tool this row registered. */
  const tool = harness.tools.find((t) => t?.name === "mpd_role_spawn")
  expect(tool).toBeDefined()
  // THE FLOOR: a depth-2 caller is refused BEFORE anything is resolved, so no child is started.
  await expect(tool.execute({ role: "Explorer", task: "look something up" }, caller({ delegationDepth: 2 }))).rejects.toThrow(/delegation depth 2/)
  expect(harness.spawned.length).toBe(0)
  // THE INTENDED NESTED CONSULTATION SURVIVES: the depth-1 cell planner raises its consult, and the cap makes
  // that consult a leaf.
  await tool.execute({ role: "Explorer", task: "look something up" }, caller({ delegationDepth: 1 }))
  expect(harness.spawned.length).toBe(1)
  expect(harness.spawned[0].maxDepth).toBe(2)
})

test("a READ-ONLY child gets the write deny AND the leaf deny in ONE restriction call", () => {
  /** A fresh mount, so the restriction list belongs to this arm alone. */
  const harness = mounted()
  // "Explorer" is a read-only roster role: the child-persona seam resolves it and applies the write deny.
  emitCreated(harness.listeners, { label: "Explorer" })
  expect(harness.restrictions.length).toBe(1)
  expect(harness.restrictions[0].names).toEqual([...READONLY_DENY, ...LEAF_SPAWN_DENY])
})

test("a WRITE-CAPABLE child gets the leaf deny alone, in ONE restriction call", () => {
  /** A fresh mount, so the restriction list belongs to this arm alone. */
  const harness = mounted()
  // "Deep Worker" is write-capable: the seam's read-only applier must NOT fire, and the leaf listener must.
  emitCreated(harness.listeners, { label: "Deep Worker" })
  expect(harness.restrictions.length).toBe(1)
  expect(harness.restrictions[0].names).toEqual([...LEAF_SPAWN_DENY])
})

test("a child this row did not raise is left alone", () => {
  /** A fresh mount, so the restriction list belongs to this arm alone. */
  const harness = mounted()
  // A cell member is the CELLWORK row's child: no roster member answers its label, so nothing is restricted.
  emitCreated(harness.listeners, { label: "cell-planner" })
  // An unlabelled one-shot child cannot be attributed either.
  emitCreated(harness.listeners, {})
  expect(harness.restrictions.length).toBe(0)
})
