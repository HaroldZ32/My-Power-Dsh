// THE ONE-SHOT ROLE SPAWN CARRIES AN EXPLICIT DEPTH CAP (contract C5, defect D15).
//
// WHY. `mpd_role_spawn` forwarded NO `maxDepth`, so the host applied its own depth default: a NESTED caller
// — the measured case is a depth-1 cell planner — had its consult refused with `SubagentDepthError`, even
// though that consult is a LEAF which spawns nothing. The cap is now the caller's own recorded delegation
// depth plus one, so the child sits exactly one level below its caller.
//
// BOTH HALVES ARE ASSERTED. The pure arm reads every header shape a caller can carry (top-level, seeded
// fork, nested, subagent-origin, unreadable). The WIRING arm drives the REGISTERED tool through the row's
// real `apply` and reads the spec the adapter handed the spawn seam, because a helper that is correct and
// never called would fix nothing at all.
import { expect, test } from "bun:test"

import { apply, spawnMaxDepthOf } from "../src/index.ts"

/** The one route the fake config service answers, so a spawn has a usable model route. */
const ROUTES: Readonly<Record<string, { provider: string; model: string }>> = {
  Architect: { provider: "company-api", model: "deepseek-flash" },
}

/**
 * The `mpdConfig`-shaped double the roster row reads its agent routes from.
 *
 * @returns a service answering one usable route for `Architect` and `unconfigured` for every other name.
 */
function configDouble(): { agentRouteResolutionOf: (member: string) => unknown } {
  return {
    agentRouteResolutionOf: (member: string): unknown => {
      /** The entry this table holds for that member name. */
      const route = ROUTES[member]
      if (route === undefined) {
        return { ok: false, reason: "unconfigured", agent: member, missing: ["agentRoutes." + member + ".provider", "agentRoutes." + member + ".model"] }
      }
      return { ok: true, agent: member, route }
    },
  }
}

/**
 * Mount the roster row once and record what its spawn seam received.
 *
 * @returns the registered tools and the spawn specs the fake `subagents.start` saw, in order.
 */
function mounted(): { tools: any[]; spawned: any[] } {
  /** Tool definitions the plugin registered, in registration order. */
  const tools: any[] = []
  /** Spawn specs the fake `subagents.start` received, one per spawn. */
  const spawned: any[] = []
  /** The service map `ctx.provide` filled; `mpdRoles` is the surface this mount serves. */
  const provided: any = {}
  /** The permissive cordis-shaped ctx `apply` sees, with a real `subagents` double behind it. */
  const ctx: any = {
    tools: {
      /** Record one tool definition; the plugin never reads a registration result. */
      register(d: unknown): void { tools.push(d) },
    },
    subagents: {
      /** The harness's own start seam; the adapter reaches it through `ctx.subagents`. */
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { summary: "done" }, stopReason: "complete" } }
      },
    },
    provide: (n: string, v: any) => { provided[n] = v },
    get: (n: string) => (n === "mpdConfig" ? configDouble() : undefined),
  }
  apply(ctx, {})
  return { tools, spawned }
}

/**
 * A caller handle carrying one session header, as a dispatch carries it.
 *
 * @param header - the calling session's header fields under test.
 * @returns the agent double the registered tool's `execute` receives.
 */
function caller(header: Record<string, unknown>): { agent: { id: string; session: { header: Record<string, unknown> } }; signal: AbortSignal } {
  return { agent: { id: "caller-session", session: { header } }, signal: new AbortController().signal }
}

/**
 * Spawn one role through the REGISTERED tool, from a caller with one header.
 *
 * @param header - the calling session's header fields under test.
 * @returns the spawn spec the adapter forwarded to the harness seam.
 */
async function spawnAt(header: Record<string, unknown>): Promise<any> {
  /** The registered tools and the spawn specs of this fresh mount. */
  const { tools, spawned } = mounted()
  /** The one-shot spawn tool this row registered. */
  const tool = tools.find((t) => t?.name === "mpd_role_spawn")
  expect(tool).toBeDefined()
  await tool.execute({ role: "Architect", task: "answer one question" }, caller(header))
  expect(spawned.length).toBe(1)
  return spawned[0]
}

test("the pure reading: the caller's recorded depth plus one, for every header shape", () => {
  // A top-level session (`delegationDepth: 0`) and one the harness never recorded a depth for both forward
  // 1 — today's behaviour, now stated explicitly instead of left to a host default.
  expect(spawnMaxDepthOf({ session: { header: { agentPreset: "mpd", delegationDepth: 0 } } })).toBe(1)
  expect(spawnMaxDepthOf({ session: { header: { agentPreset: "mpd" } } })).toBe(1)
  // A SEEDED FORK (`parentSession` + `isSeeded`, depth 0) is still the workspace's top-level session (§5, T-92).
  expect(spawnMaxDepthOf({ session: { header: { parentSession: "p", isSeeded: true, delegationDepth: 0 } } })).toBe(1)
  // A NESTED caller: the measured depth-1 planner case, deeper nesting, and a string spelling of the depth.
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: 1 } } })).toBe(2)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: 3 } } })).toBe(4)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: "2" } } })).toBe(3)
  // A session the harness recorded as an `origin: "subagent"` CHILD but with no depth still gets a child's
  // cap: `sessionRank` classifies it as a child, so answering 0 here would hand it the top-level cap.
  expect(spawnMaxDepthOf({ session: { header: { origin: "subagent" } } })).toBe(2)
  // An absent handle, an absent header and a depth that is not a positive number are not depths.
  expect(spawnMaxDepthOf(undefined)).toBe(1)
  expect(spawnMaxDepthOf({})).toBe(1)
  expect(spawnMaxDepthOf({ session: {} })).toBe(1)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: -2 } } })).toBe(1)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: "not-a-depth" } } })).toBe(1)
})

test("THE WIRING: the registered mpd_role_spawn forwards `maxDepth` = caller depth + 1", async () => {
  // The measured D15 case: a depth-1 cell planner's consult is a LEAF at depth 2, so the host's nesting
  // default can no longer refuse it.
  expect((await spawnAt({ agentPreset: "mpd", delegationDepth: 1 })).maxDepth).toBe(2)
  // Deeper nesting scales WITH the caller instead of pinning one constant.
  expect((await spawnAt({ delegationDepth: 2 })).maxDepth).toBe(3)
  /** The spec one TOP-LEVEL caller produced. */
  const topLevel = await spawnAt({ agentPreset: "mpd", delegationDepth: 0 })
  // Today's behaviour, now explicit: the field is PRESENT and it is 1, not absent.
  expect(topLevel.maxDepth).toBe(1)
  expect(Object.hasOwn(topLevel, "maxDepth")).toBe(true)
})

/**
 * Concatenate the TEXT BLOCKS a spawn prompt is built from.
 *
 * The seam carries the harness's own block list (`[{type:"text", text}]`), not a plain string, so a caller
 * that spelled `String(spec.prompt)` would assert against `"[object Object]"`.
 *
 * @param blocks - the spec's `prompt` field, as the adapter handed it over.
 * @returns the concatenated text, or `""` for a shape this reader does not recognise.
 */
function blocksText(blocks: unknown): string {
  if (Array.isArray(blocks)) {
    return blocks.map((block) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? String((block as { text: unknown }).text) : "")).join("")
  }
  return typeof blocks === "string" ? blocks : ""
}

test("CONTROL: the forwarded cap disturbs neither the route nor the prompt the spawn already carried", async () => {
  /** The spec one nested caller produced. */
  const spec = await spawnAt({ delegationDepth: 1 })
  // The agent's own route still travels as the harness `agentOptions`, and the task still reaches the prompt.
  expect(spec.agentOptions?.provider).toBe("company-api")
  expect(spec.agentOptions?.model).toBe("deepseek-flash")
  expect(blocksText(spec.prompt)).toContain("answer one question")
  // The label still names the roster role, which is what the child-persona seam resolves on.
  expect(spec.label).toBe("Architect")
})
