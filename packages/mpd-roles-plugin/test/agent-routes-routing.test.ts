// THE SAVED PER-AGENT ROUTE REACHES THE ONE-SHOT ROSTER PATHS — the contract this file pins.
//
// WHY THIS FILE EXISTS. Each of the eleven roster agents has its OWN persisted `agentRoutes` entry,
// written by BOTH settings front doors (the TUI `/mpd-model` menu and `/settings` section, and the Web
// card) into the `mpd-config` row config, and served resolved by `packages/mpd-config-plugin`. Before
// this wave the route came from a shared `teamModels` slot and the ONLY reader was
// `mpd-roster-provider-plugin`, so every single-call spawn kept the STATIC `roles.data.ts` chain and
// ignored the user's save (MEASURED 2026-10-12: a saved route existed and every one-shot spawn still
// ran on `deepseek-official`, which had no key there, so the spawn died with `MISSING_CREDENTIAL`).
//
// WHAT IS ASSERTED, and why each arm can fail. Two agents configured DIFFERENTLY must resolve and
// spawn independently (no cross-talk), the route must reach the roster SURFACE (the read every
// consumer shares: `mpd_roles_list`, `mpd_role_spawn`, the workmate library's base instance and
// `mpd_modelchain_resolve`, which prefers `spec.chain`) and the spawn's own options including the
// effort keyword. The NEGATIVE CONTROLS are the other half: an agent with NO entry must be REFUSED
// with `AGENT_UNCONFIGURED` BEFORE `spawnAgent` is called, a malformed leaf must be refused as
// `invalid` naming the offending path, and a composition that mounts no `mpdConfig` service must
// refuse too — never fall back to the shipped chain.
//
// THE MODEL-CAPABILITY ADAPTATION is asserted as before: the effort keyword passes through the
// adapter's `withSupportedEffort`, so a model the live catalog lists with NO reasoning efforts loses
// the keyword (the call would otherwise fail) while a model that declares the effort keeps it.
import { expect, test } from "bun:test"
import { apply } from "../src/index"
import { ROLES } from "../src/roles.data"
import { agentRouteOfMember, resolveAgentRoute } from "../../mpd-config-plugin/src/index"
import { createDshAdapter, type DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"

/** One route as an `agentRoutes` entry may declare it. */
type Entry = { provider: string; model: string; reasoningEffort?: string }

/** The route Architect is configured with in the arms below. */
const ARCHITECT_ROUTE: Entry = { provider: "company-api", model: "deepseek-flash", reasoningEffort: "max" }

/** The route Deep Worker is configured with: a DIFFERENT provider and model, and no effort. */
const WORKER_ROUTE: Entry = { provider: "local-gateway", model: "deepseek-pro" }

/** The agent entries every arm mounts, unless it deliberately omits one. */
const ROUTES: Readonly<Record<string, Entry>> = { Architect: ARCHITECT_ROUTE, "Deep Worker": WORKER_ROUTE }

/** The caller context every `execute` call passes; no real harness sits behind the fake. */
const EXEC = (): { agent: { id: string }; signal: AbortSignal } => ({ agent: { id: "agent-1" }, signal: new AbortController().signal })

/**
 * A `mpdConfig`-shaped double answering the contract's TOTAL union for the entries of one arm.
 * @param routes - the agent table this arm mounts; an absent agent answers typed `unconfigured`.
 * @param malformed - optional agent answered as `invalid` on its `.model` leaf.
 * @returns the service double the roster row reads per call.
 */
function configDouble(routes: Readonly<Record<string, Entry>> = ROUTES, malformed?: string): { agentRouteResolutionOf: (member: string) => unknown } {
  return {
    agentRouteResolutionOf: (member: string): unknown => {
      if (malformed !== undefined && member === malformed) {
        return { ok: false, reason: "invalid", agent: member, problem: "agentRoutes." + member + ".model" }
      }
      /** The entry this name has in THIS arm's table. */
      const route = routes[member]
      if (route === undefined) {
        return { ok: false, reason: "unconfigured", agent: member, missing: ["agentRoutes." + member + ".provider", "agentRoutes." + member + ".model"] }
      }
      return { ok: true, agent: member, route }
    },
  }
}

/**
 * Mount the roster row once, with an optional `mpdConfig`-shaped service behind `ctx.get`.
 * @param service - the fake config service; omitted mounts NO service (the negative control).
 * @param catalog - the model catalog the adapter answers; omitted mounts NO `mpdDsh`, so the row's
 *   own fallback adapter finds no `llm` seam and every effort passes through untouched.
 * @returns the provided services, the registered tools and the spawn options the fake saw.
 */
function mounted(service?: { agentRouteResolutionOf: (member: string) => unknown }, catalog?: DshLlmCatalog): { provided: any; tools: any[]; spawned: any[] } {
  /** Tool definitions the plugin registered, in registration order. */
  const tools: any[] = []
  /** Subagent specs the fake `subagents.start` received, one per spawn. */
  const spawned: any[] = []
  /** The service map `ctx.provide` filled; `mpdRoles` is the surface under test. */
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
    get: (n: string) => (n === "mpdConfig" ? service : undefined),
  }
  if (catalog !== undefined) {
    // THE MOUNTED ADAPTER, with ONLY its catalog read replaced: its REAL `spawnAgent` still forwards to
    // this ctx's `subagents` double, so the adaptation arms below measure the shipped spawn path.
    /** The shipped adapter for this ctx, whose catalog read answers `catalog`. */
    const adapter = { ...createDshAdapter(ctx), llmCatalog: async () => catalog }
    ctx.get = (n: string) => (n === "mpdDsh" ? adapter : n === "mpdConfig" ? service : undefined)
  }
  apply(ctx, {})
  return { provided, tools, spawned }
}

/** One roster role's FIRST chain entry, as the shared surface reports it. */
function primaryOf(provided: any, name: string): { provider: string; model: string } {
  return provided.mpdRoles.get(name).chain[0]
}

test("THE ONE RESOLVER keeps two agent entries independent — no cross-talk (contract §2/§9)", () => {
  /** The config every consumer reads, with two DIFFERENT entries. */
  const config = { agentRoutes: { Architect: ARCHITECT_ROUTE, "Deep Worker": WORKER_ROUTE } }
  expect(agentRouteOfMember("Architect", config)).toEqual(ARCHITECT_ROUTE)
  expect(agentRouteOfMember("Deep Worker", config)).toEqual(WORKER_ROUTE)
  // Separator- and case-insensitive, like every other roster address.
  expect(agentRouteOfMember("architect", config)).toEqual(ARCHITECT_ROUTE)
  // An absent entry is typed `unconfigured` with BOTH missing leaf paths; an unknown name is `unrouted`.
  expect(resolveAgentRoute("Reviewer", config)).toMatchObject({ ok: false, reason: "unconfigured", agent: "Reviewer", missing: ["agentRoutes.Reviewer.provider", "agentRoutes.Reviewer.model"] })
  expect(resolveAgentRoute("not-a-roster-member", config)).toEqual({ ok: false, reason: "unrouted" })
})

test("TWO configured agents BECOME the roster's route independently (no cross-talk)", () => {
  /** The roster service, mounted behind a config service that routes two agents differently. */
  const { provided } = mounted(configDouble())
  expect(primaryOf(provided, "Architect")).toEqual({ provider: "company-api", model: "deepseek-flash" })
  expect(primaryOf(provided, "Deep Worker")).toEqual({ provider: "local-gateway", model: "deepseek-pro" })
  // A configured agent's chain is EXACTLY its own route: the shipped static chain is never appended.
  expect(provided.mpdRoles.get("Architect").chain.length).toBe(1)
})

test("mpd_role_spawn runs EACH agent on its OWN provider, model AND effort", async () => {
  /** The registered tools and the spawn options, behind a config service that routes two agents. */
  const { tools, spawned } = mounted(configDouble())
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  expect(spawnTool).toBeDefined()
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, EXEC())
  await spawnTool.execute({ role: "Deep Worker", task: "do the other thing" }, EXEC())
  expect(spawned.length).toBe(2)
  // The route travels as harness `agentOptions`, which is what the provider actually resolves.
  expect(spawned[0].agentOptions?.provider).toBe("company-api")
  expect(spawned[0].agentOptions?.model).toBe("deepseek-flash")
  expect(spawned[0].agentOptions?.reasoningEffort).toBe("max")
  expect(spawned[1].agentOptions?.provider).toBe("local-gateway")
  expect(spawned[1].agentOptions?.model).toBe("deepseek-pro")
  // The second entry declares NO effort, so none may be invented for it.
  expect("reasoningEffort" in (spawned[1].agentOptions ?? {})).toBe(false)
})

test("THE ADAPTATION: a route on a model that declares NO efforts drops the keyword instead of failing", async () => {
  /** A catalog listing the configured model with an EMPTY effort array — the reported failure shape. */
  const catalog: DshLlmCatalog = {
    providers: [{ id: "company-api", name: "Company API", models: [{ id: "deepseek-flash", name: "Flash", efforts: [] }] }],
    degraded: false,
  }
  /** The registered tools and the spawn options, behind the mounted adapter's own catalog read. */
  const { tools, spawned } = mounted(configDouble(), catalog)
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, EXEC())
  expect(spawned.length).toBe(1)
  // The route still lands; only the keyword the model cannot take is gone.
  expect(spawned[0].agentOptions?.provider).toBe("company-api")
  expect(spawned[0].agentOptions?.model).toBe("deepseek-flash")
  expect("reasoningEffort" in (spawned[0].agentOptions ?? {})).toBe(false)
})

test("CONTROL: the same route on a model that DECLARES that effort keeps it", async () => {
  /** A catalog listing the configured model WITH the effort the route states. */
  const catalog: DshLlmCatalog = {
    providers: [{ id: "company-api", name: "Company API", models: [{ id: "deepseek-flash", name: "Flash", efforts: [{ id: "max", name: "Max" }] }] }],
    degraded: false,
  }
  /** The registered tools and the spawn options, behind the mounted adapter's own catalog read. */
  const { tools, spawned } = mounted(configDouble(), catalog)
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, EXEC())
  expect(spawned[0].agentOptions?.reasoningEffort).toBe("max")
})

test("an ABSENT entry REFUSES with AGENT_UNCONFIGURED and spawnAgent is NEVER called (contract §3/§9)", async () => {
  /** The row mounted behind a service that has NO entry for Reviewer. */
  const { tools, spawned } = mounted(configDouble())
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  /** The refusal the spawn must raise, carrying the branchable code. */
  let refusal: any
  try {
    await spawnTool.execute({ role: "Reviewer", task: "do the thing" }, EXEC())
  } catch (error) {
    refusal = error
  }
  expect(refusal).toBeDefined()
  expect(refusal.code).toBe("AGENT_UNCONFIGURED")
  /** The canonical sentence, which must name the agent, BOTH missing leaves and both recovery paths. */
  const message = String(refusal.message)
  expect(message).toContain("AGENT_UNCONFIGURED")
  expect(message).toContain("Reviewer")
  expect(message).toContain("agentRoutes.Reviewer.provider")
  expect(message).toContain("agentRoutes.Reviewer.model")
  expect(message).toContain("/mpd-model")
  expect(message).toContain("nothing was written and no child was started")
  // NOTHING was started: the refusal precedes the spawn call.
  expect(spawned).toEqual([])
})

test("a MALFORMED leaf REFUSES with AGENT_UNCONFIGURED naming the offending path (contract §2/§9)", async () => {
  /** The row mounted behind a service that reports Reviewer's `.model` leaf as malformed. */
  const { tools, spawned } = mounted(configDouble(ROUTES, "Reviewer"))
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  /** The refusal the spawn must raise. */
  let refusal: any
  try {
    await spawnTool.execute({ role: "Reviewer", task: "do the thing" }, EXEC())
  } catch (error) {
    refusal = error
  }
  expect(refusal).toBeDefined()
  expect(refusal.code).toBe("AGENT_UNCONFIGURED")
  expect(String(refusal.message)).toContain("agentRoutes.Reviewer.model")
  expect(spawned).toEqual([])
})

test("NEGATIVE CONTROL: with NO config service a base agent REFUSES — no static-chain fallback, no child", async () => {
  /** The same row mounted with NO config service at all: the control half of this file. */
  const { provided, tools, spawned } = mounted()
  /** The shipped chain for the first roster role, read straight off the declared table. */
  const staticChain = ROLES.find((r) => r.name === "Architect")!.chain[0]
  // The DISPLAY half: a base agent's chain is BLANK, because the shipped route is not a route any
  // spawn may run on (contract §4).
  expect(provided.mpdRoles.get("Architect").chain).toEqual([])
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  /** The refusal the spawn must raise, carrying the branchable code. */
  let refusal: any
  try {
    await spawnTool.execute({ role: "Architect", task: "do the thing" }, EXEC())
  } catch (error) {
    refusal = error
  }
  expect(refusal).toBeDefined()
  expect(String(refusal.message)).toContain("AGENT_UNCONFIGURED")
  expect(refusal.code).toBe("AGENT_UNCONFIGURED")
  // NOTHING was started: the refusal precedes the spawn call, so the shipped chain never runs.
  expect(spawned).toEqual([])
  expect(staticChain.provider).toBe("deepseek-official")
})

test("mpd_roles_list reports provider/model from agentRoutes, NULL when unconfigured (contract §4)", async () => {
  /** The list behind a service configured for two agents. */
  const configured = await mounted(configDouble()).tools.find((t) => t?.name === "mpd_roles_list").execute({}, {})
  expect(configured.roles.find((r: any) => r.name === "Architect").provider).toBe("company-api")
  expect(configured.roles.find((r: any) => r.name === "Deep Worker").model).toBe("deepseek-pro")
  /** The list behind a service with NO entries at all. */
  const empty = await mounted(configDouble({})).tools.find((t) => t?.name === "mpd_roles_list").execute({}, {})
  /** The Architect row, which this arm's service reports as unconfigured. */
  const architect = empty.roles.find((r: any) => r.name === "Architect")
  // A display NEVER throws and NEVER reports a route the spawn would refuse: the typed state wins.
  expect(architect).toBeDefined()
  expect(architect.provider).toBeNull()
  expect(architect.model).toBeNull()
})

test("mpd_role_spawn declares NO model parameter — the agent's own entry is the only route (§4)", () => {
  /** The tools this arm's mount registered. */
  const { tools } = mounted(configDouble())
  /** The one-shot spawn tool whose schema is the subject. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  // The deleted caller override: a `model` property would be a SECOND route source.
  expect(spawnTool.parameters.properties).not.toHaveProperty("model")
  expect(spawnTool.parameters.required).toEqual(["role", "task"])
  // The other two properties survive, so the absence above is not a vacuous empty object.
  expect(Object.keys(spawnTool.parameters.properties).sort()).toEqual(["context", "role", "task"])
})
