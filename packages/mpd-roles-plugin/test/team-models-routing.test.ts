// THE SAVED `teamModels` ROUTE REACHES THE ONE-SHOT ROSTER PATHS — the defect this file pins.
//
// WHY THIS FILE EXISTS. The four `teamModels` slot knobs are written by BOTH settings front doors (the
// TUI `/settings` section and `/mpd-model`, and the Web card) into the `mpd-config` row config, and
// `packages/mpd-config-plugin` serves them resolved. Before this wave the ONLY reader was
// `mpd-roster-provider-plugin` (an official `spawn_teammate`), so the one-shot paths kept the STATIC
// `roles.data.ts` chains while `mpd_role_spawn`'s own description promised "THIS path applies the
// role's teamModels slot route" and `roster-section.ts` stated the slots "apply to the one-shot
// `mpd_role_spawn` only". MEASURED on a real machine (2026-10-12): both live profiles carried a saved
// slot route (`company-api` / `deepseek-flash`) and every one-shot spawn still ran on the static
// `deepseek-official` provider — which has no key there, so the spawn died with `MISSING_CREDENTIAL`
// and the save looked inert on web, desktop and TUI alike. That is the reported defect.
//
// WHAT IS ASSERTED, and why each arm can fail. The route must reach the roster SURFACE (the read every
// consumer shares: `mpd_roles_list`, `mpd_role_spawn`, the workmate library's base instance and
// `mpd_modelchain_resolve`, which prefers `spec.chain`), and it must reach the SPAWN's own options
// including the effort keyword the slot declares. The NEGATIVE CONTROL is the other half: a
// composition that mounts no `mpdConfig` service must keep the static chain byte-for-byte, so a fix
// that hard-coded a route would redden here.
//
// THE MODEL-CAPABILITY ADAPTATION is the third thing asserted here: the effort keyword is passed
// through the adapter's `withSupportedEffort`, so a model the live catalog lists with NO reasoning
// efforts at all loses the keyword (the call would otherwise fail) while a model that declares the
// effort keeps it. Both arms drive the REAL `spawnAgent`, with only `llmCatalog` replaced.
import { expect, test } from "bun:test"
import { apply } from "../src/index"
import { ROLES } from "../src/roles.data"
import { teamModelRouteOfMember, teamModelSlotOfMember } from "../../mpd-config-plugin/src/index"
import { createDshAdapter, type DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"

/** The route the fake config service answers, and the two members it is declared for. */
const SLOT_ROUTE = { provider: "company-api", model: "deepseek-flash", reasoningEffort: "max" }

/** The members the fake slot routes; every other member is deliberately left unrouted. */
const ROUTED_MEMBERS: readonly string[] = ["Architect", "Deep Worker"]

/**
 * Mount the roster row once, with an optional `mpdConfig`-shaped service behind `ctx.get`.
 * @param routeOf - what the fake config service answers for a member; omitted mounts NO service.
 * @param catalog - the model catalog the adapter answers; omitted mounts NO `mpdDsh`, so the row's own
 *   fallback adapter finds no `llm` seam and every effort passes through untouched.
 * @returns the provided services, the registered tools and the spawn options the fake saw.
 */
function mounted(routeOf?: (member: string) => unknown, catalog?: DshLlmCatalog): { provided: any; tools: any[]; spawned: any[] } {
  /** Tool definitions the plugin registered, in registration order. */
  const tools: any[] = []
  /** Subagent specs the fake `subagents.start` received, one per spawn. */
  const spawned: any[] = []
  /** The service map `ctx.provide` filled; `mpdRoles` is the surface under test. */
  const provided: any = {}
  /** The `mpdConfig`-shaped service this arm answers, or undefined when it mounts none. */
  const configService = routeOf === undefined ? undefined : { teamModelRouteOf: routeOf }
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
    get: (n: string) => (n === "mpdConfig" ? configService : undefined),
  }
  if (catalog !== undefined) {
    // THE MOUNTED ADAPTER, with ONLY its catalog read replaced: its REAL `spawnAgent` still forwards to
    // this ctx's `subagents` double, so the adaptation arms below measure the shipped spawn path.
    /** The shipped adapter for this ctx, whose catalog read answers `catalog`. */
    const adapter = { ...createDshAdapter(ctx), llmCatalog: async () => catalog }
    ctx.get = (n: string) => (n === "mpdDsh" ? adapter : n === "mpdConfig" ? configService : undefined)
  }
  apply(ctx, {})
  return { provided, tools, spawned }
}

/** One roster role's FIRST chain entry, as the shared surface reports it. */
function primaryOf(provided: any, name: string): { provider: string; model: string } {
  return provided.mpdRoles.get(name).chain[0]
}

test("the slot membership is the ONE declaration the settings front doors already share", () => {
  expect(teamModelSlotOfMember("Architect")).toBe("slot1")
  expect(teamModelSlotOfMember("architect")).toBe("slot1")
  expect(teamModelSlotOfMember("Deep Worker")).toBe("slot3")
  // Separator-insensitive, like every other roster address: "Plan Reviewer" is slot2.
  expect(teamModelSlotOfMember("plan-reviewer")).toBe("slot2")
  expect(teamModelSlotOfMember("Vision Analyst")).toBe("slot4")
  expect(teamModelSlotOfMember("not-a-roster-member")).toBeUndefined()
})

test("the config read resolves a configured slot over its schema defaults", () => {
  /** The route the config read answers for a slot the caller configured explicitly. */
  const route = teamModelRouteOfMember("Architect", { teamModels: { slot1: SLOT_ROUTE } })
  expect(route).toEqual(SLOT_ROUTE)
  // A workspace that declares NO `teamModels` block still answers the slot's own default, which is the
  // documented pre-slot behaviour — so an unconfigured workspace is never in a "no route" state.
  const fallback = teamModelRouteOfMember("Architect", {})
  expect(fallback?.provider).toBe("deepseek-official")
  expect(fallback?.model).toBe("deepseek-v4-flash")
  expect(fallback?.reasoningEffort).toBe("max")
  // A member the roster does not slot-route stays unrouted: `undefined`, never a substituted default.
  expect(teamModelRouteOfMember("not-a-roster-member", {})).toBeUndefined()
})

test("a saved slot route BECOMES the roster's route for the member it drives", () => {
  /** The roster service, mounted behind a config service that routes two members. */
  const { provided } = mounted((member) => (ROUTED_MEMBERS.includes(member) ? SLOT_ROUTE : undefined))
  expect(primaryOf(provided, "Architect")).toEqual({ provider: "company-api", model: "deepseek-flash" })
  expect(primaryOf(provided, "Deep Worker")).toEqual({ provider: "company-api", model: "deepseek-flash" })
})

test("mpd_role_spawn runs the member on the configured provider, model AND effort", async () => {
  /** The registered tools and the spawn options, behind a config service that DOES route members. */
  const { tools, spawned } = mounted((member) => (ROUTED_MEMBERS.includes(member) ? SLOT_ROUTE : undefined))
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  expect(spawnTool).toBeDefined()
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, { agent: { id: "agent-1" }, signal: new AbortController().signal })
  expect(spawned.length).toBe(1)
  // The route travels as harness `agentOptions`, which is what the provider actually resolves.
  expect(spawned[0].agentOptions?.provider).toBe("company-api")
  expect(spawned[0].agentOptions?.model).toBe("deepseek-flash")
  expect(spawned[0].agentOptions?.reasoningEffort).toBe("max")
})

test("THE ADAPTATION: a slot on a model that declares NO efforts drops the keyword instead of failing", async () => {
  /** A catalog listing the configured model with an EMPTY effort array — the reported failure shape. */
  const catalog: DshLlmCatalog = {
    providers: [{ id: "company-api", name: "Company API", models: [{ id: "deepseek-flash", name: "Flash", efforts: [] }] }],
    degraded: false,
  }
  /** The registered tools and the spawn options, behind the mounted adapter's own catalog read. */
  const { tools, spawned } = mounted((member) => (ROUTED_MEMBERS.includes(member) ? SLOT_ROUTE : undefined), catalog)
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, { agent: { id: "agent-1" }, signal: new AbortController().signal })
  expect(spawned.length).toBe(1)
  // The route still lands; only the keyword the model cannot take is gone.
  expect(spawned[0].agentOptions?.provider).toBe("company-api")
  expect(spawned[0].agentOptions?.model).toBe("deepseek-flash")
  expect("reasoningEffort" in (spawned[0].agentOptions ?? {})).toBe(false)
})

test("CONTROL: the same slot on a model that DECLARES that effort keeps it", async () => {
  /** A catalog listing the configured model WITH the effort the slot states. */
  const catalog: DshLlmCatalog = {
    providers: [{ id: "company-api", name: "Company API", models: [{ id: "deepseek-flash", name: "Flash", efforts: [{ id: "max", name: "Max" }] }] }],
    degraded: false,
  }
  /** The registered tools and the spawn options, behind the mounted adapter's own catalog read. */
  const { tools, spawned } = mounted((member) => (ROUTED_MEMBERS.includes(member) ? SLOT_ROUTE : undefined), catalog)
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, { agent: { id: "agent-1" }, signal: new AbortController().signal })
  expect(spawned[0].agentOptions?.reasoningEffort).toBe("max")
})

test("NEGATIVE CONTROL: with NO config service mounted the static roster chain stands", async () => {
  /** The same row mounted with NO config service at all: the control half of this file. */
  const { provided, tools, spawned } = mounted()
  /** The shipped chain for the first roster role, read straight off the declared table. */
  const staticChain = ROLES.find((r) => r.name === "Architect")!.chain[0]
  expect(primaryOf(provided, "Architect")).toEqual({ provider: staticChain.provider, model: staticChain.model })
  /** The one-shot spawn tool this row registered. */
  const spawnTool = tools.find((t) => t?.name === "mpd_role_spawn")
  await spawnTool.execute({ role: "Architect", task: "do the thing" }, { agent: { id: "agent-1" }, signal: new AbortController().signal })
  // The spawn carries the STATIC pair and no effort at all: the slots are not configured here, so no
  // route and no effort keyword may be invented — which is what makes the arm above falsifiable.
  expect(spawned[0].agentOptions).toEqual({ provider: staticChain.provider, model: staticChain.model })
})
