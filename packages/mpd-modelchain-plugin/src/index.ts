// B4 mpd-modelchain-plugin: upstream fallback-chain resolution (DeepSeek-first) + workspace memory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-modelchain"
/** The tool registry the three `mpd_*` tools are registered into, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the row context this plugin reads: the tool registry plus the two lazily-read services. */
type Ctx = { tools: any; get?: (k: string) => any; [k: string]: any }
/** The row's config keys: a memory-file override and a whole replacement chain table. */
type Config = { memoryFile?: string; chains?: Record<string, Array<{ provider: string; model: string }>> }

/** The shipped fallback chains, keyed by kebab-case role name; entry 0 is the preferred route. */
export const DEFAULT_CHAINS: Record<string, Array<{ provider: string; model: string }>> = {
  sisyphus: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  "sisyphus-junior": [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  oracle: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  atlas: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  prometheus: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  librarian: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  explore: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  metis: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  momus: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-pro" }
  ],
  "multimodal-looker": [
    { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  hephaestus: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ]
}

// Legacy camelCase config keys accepted for backward compatibility (full migration to kebab-case keys).
const LEGACY_CHAIN_KEYS: Record<string, string> = {
  "sisyphus-junior": "sisyphusJunior",
  "multimodal-looker": "multimodalLooker",
}

/** Normalize a role key to the kebab-case chain key (accepts legacy camelCase input). */
function toKebabKey(role: string): string {
  return String(role ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
}

/**
 * Collapse a role key to its NAME spelling: case-, space-, hyphen- and underscore-insensitive.
 *
 * The same collapse the roster tools apply, restated here rather than imported because a
 * cross-package import would be a NEW entry in the frozen coupling inventory
 * (`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`, which may
 * only shrink) — so the roster reaches this row as a SERVICE, never as source.
 *
 * @param role - the role key as the caller spelled it.
 * @returns its letters and digits only, lowercased; an empty string for a blank key.
 */
function roleNameKey(role: string): string {
  return String(role ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * Resolve one role to its route: the first entry of the role's own chain, or of the shipped default
 * chain, or of `sisyphus` when the role is unknown or its chain is empty.
 *
 * @param role - the role key as the caller spelled it; camelCase is normalized to kebab-case.
 * @param chains - the chain table to resolve against, normally the row's merged table.
 * @returns the resolved route plus the whole chain it came from, for a caller that wants the fallbacks.
 */
export function resolveRole(role: string, chains: Record<string, Array<{ provider: string; model: string }>>): { provider: string; model: string; chain: Array<{ provider: string; model: string }> } {
  /** The normalized kebab-case chain key this role is looked up under. */
  const key = toKebabKey(role)
  /** The role's chain: the caller's table first, then the shipped table, then the generic default. */
  let chain = chains[key] ?? DEFAULT_CHAINS[key] ?? DEFAULT_CHAINS.sisyphus
  if (!Array.isArray(chain) || chain.length === 0) chain = DEFAULT_CHAINS.sisyphus
  /** The preferred route, i.e. the chain's first entry. */
  const primary = chain[0]
  return { provider: primary.provider, model: primary.model, chain }
}

/** The memory file's absolute path: the configured override resolved against `cwd`, else `<cwd>/.mpd/memory.json`. */
function memoryPath(cwd: string, config: Config): string {
  return config.memoryFile ? resolve(cwd, config.memoryFile) : join(cwd, ".mpd", "memory.json")
}

/** Read the memory file as a flat key/value map; a missing or unparseable file reads as empty (never throws). */
function loadMemory(p: string): Record<string, string> {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return {} }
}

/**
 * The runtime `mpdConfig` service, read PER CALL and never cached at apply.
 *
 * WHY per call (R1, wave fix/model-config-live-refresh): the OLD code read the service once in
 * `apply()` and froze the overlay it found into a closure — two defects in one. A sibling row that
 * applies AFTER this one (rows apply concurrently) was invisible forever, and a config the user
 * saved LATER in the same process never reached a resolution. Reading per call fixes both; a
 * missing service (the standalone case) reads as undefined, never a boot failure.
 *
 * @param ctx - the row context, whose `get` may throw on an uninjected service (agent-scoped ctx).
 * @returns the service double, or undefined when it is absent or refuses the lookup.
 */
function configServiceOf(ctx: Ctx): { get?: (k?: string) => any } | undefined {
  try {
    return ctx.get?.("mpdConfig") as { get?: (k?: string) => any } | undefined
  } catch {
    // An agent-scoped cordis ctx is a proxy that THROWS on any key missing from `inject`.
    return undefined
  }
}

/**
 * The chain-shape guard both live reads share: an overlay entry counts only when it is a non-empty
 * array of `{provider, model}` string pairs — anything else is not a chain and is ignored, exactly
 * as the frozen-closure code judged it.
 *
 * @param value - the raw `modelchain.<key>` value.
 * @returns whether the value is a usable chain table entry.
 */
function isChainArray(value: unknown): value is Array<{ provider: string; model: string }> {
  return Array.isArray(value) && value.length > 0 && value.every((c: any) => c && typeof c.provider === "string" && typeof c.model === "string")
}

/**
 * The LIVE config overlay ONLY — the `modelchain.<key>` chains the user actually configured, keyed
 * by the shipped chain keys (a legacy camelCase spelling answers under its kebab-case key).
 *
 * Kept APART from the merged table ({@link chainsNow}) because the resolver's precedence needs to
 * know WHICH roles the live config explicitly routes: an overlay chain outranks even the roster's
 * own static chain, while the row's `chains` table only fills in beneath it.
 *
 * @param ctx - the row context, for the per-call `mpdConfig` service lookup.
 * @returns the overlay map; empty when no service is mounted or nothing usable is configured.
 */
export function overlayNow(ctx: Ctx): Record<string, Array<{ provider: string; model: string }>> {
  /** The live config service, absent until the `mpd-config` row has applied. */
  const mpdConfig = configServiceOf(ctx)
  if (typeof mpdConfig?.get !== "function") return {}
  /** Only the roles the config actually overrides, kept apart so the shipped table survives for the rest. */
  const overlay: Record<string, Array<{ provider: string; model: string }>> = {}
  for (const key of Object.keys(DEFAULT_CHAINS)) {
    /** The legacy camelCase spelling of this role, if it ever had one. */
    const legacy = LEGACY_CHAIN_KEYS[key]
    /** The configured chain under either spelling; anything else is not a chain and is ignored. */
    const v = mpdConfig.get("modelchain." + key) ?? (legacy ? mpdConfig.get("modelchain." + legacy) : undefined)
    if (isChainArray(v)) overlay[key] = v
  }
  return overlay
}

/**
 * The chain table ONE call resolves against: the live `mpdConfig` overlay over the row's own
 * `chains` table, over the shipped `DEFAULT_CHAINS` (L2's fallback chain, resolved per call — the
 * frozen closure is gone).
 *
 * @param ctx - the row context, for the per-call `mpdConfig` service lookup.
 * @param config - the row config, whose `chains` key is the whole-table replacement it always was.
 * @returns the merged table for this call.
 */
export function chainsNow(ctx: Ctx, config: Config): Record<string, Array<{ provider: string; model: string }>> {
  return { ...(config?.chains ?? DEFAULT_CHAINS), ...overlayNow(ctx) }
}

/**
 * The TOTAL agent-route resolution of one roster agent, when the config row exposes it (contract
 * `.mpd/plans/agent-routes-per-agent.md` §2 + §4).
 *
 * A DISPLAY NEVER THROWS: the service's method is total by contract, and a service that REFUSES the
 * lookup (an agent-scoped ctx without the inject) reads as "no answer" — never as a failure of this
 * tool. The union is mirrored structurally because a cross-package import would be a new entry in the
 * frozen coupling inventory.
 * @param ctx - the row context, for the per-call service lookup.
 * @param member - the roster agent's functional name.
 * @returns the typed resolution, or undefined when no service answers.
 */
function agentRouteResolutionIn(ctx: Ctx, member: string): unknown {
  try {
    /** The runtime config service, when the composition mounts one. */
    const service = ctx.get?.("mpdConfig") as { agentRouteResolutionOf?: (m: string) => unknown } | undefined
    if (typeof service?.agentRouteResolutionOf !== "function") return undefined
    return service.agentRouteResolutionOf(member)
  } catch {
    // A service that refuses the lookup answers NOTHING; it never fails this tool.
    return undefined
  }
}

/**
 * Register the route resolver and the two memory tools, with the role chains resolved PER CALL
 * from the live config (never a closure frozen at apply).
 *
 * @param ctx - the row context; the roster and config services are read lazily, never declared as deps.
 * @param config - row overrides for the memory file and the chain table.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)

  dsh.registerTool({
    name: "mpd_modelchain_resolve",
    description: "Resolve the DeepSeek provider/model route for a roster role, addressed by its name (Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer) — the same names team mode uses. A roster agent resolves from its OWN `agentRoutes` entry (the ONE configured route, plus that entry's own fallback chain) and reports `<unconfigured>` honestly when the route is not configured; an extension role keeps its own declared chain.",
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list)" } }, required: ["role"] },
    output: {
      schema: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, chain: { type: "array", items: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: [] } }, status: { type: "string" }, missing: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["provider", "model"] },
      render: (_args: any, value: any) => [{ type: "text", text: value.status === "unconfigured"
        ? "role=" + _args?.role + " -> <unconfigured> (missing " + (Array.isArray(value.missing) ? value.missing.join(", ") : "agentRoutes") + "; " + String(value.reason ?? "") + ")"
        : "role=" + _args?.role + " -> " + value.provider + "/" + value.model + " (chain " + value.chain.length + " entries)" + (value.status === undefined ? "" : " — " + value.status) }]
    },
    execute: async (args: any) => {
      /** The role as the caller spelled it. There is NO default: an unnamed role is refused
       *  rather than silently answered with another role's route (the defect this replaces). */
      const role = String(args?.role ?? "").trim()
      // Source of truth: the mpd-roles roster chains (DEFAULT_CHAINS kept as fallback). The roster
      // is read per call — a sibling-provided service is only reliably visible after all rows apply.
      const rolesService = ctx.get?.("mpdRoles") as { get?: (k: string) => any; list?: () => any[] } | undefined
      /** Every name the mounted roster answers to: the ONLY vocabulary this tool accepts, and the
       *  only thing a refusal names — built from the roster, never from the rejected argument. */
      const names = (rolesService?.list?.() ?? []).map((r: any) => String(r?.name ?? "")).filter((n: string) => n !== "")
      /** The role the roster resolves for this key. The service resolves the INTERNAL id and the
       *  legacy aliases too, so the key is accepted only when it spells the resolved role's NAME. */
      const spec = rolesService?.get?.(role)
      if (spec === undefined || spec === null || roleNameKey(role) !== roleNameKey(String(spec.name ?? ""))) {
        throw new Error("mpd_modelchain_resolve: unknown role — use a roster NAME from mpd_roles_list" + (names.length > 0 ? " (" + names.join(", ") + ")" : " (the mpdRoles roster service answered no names — is the mpd-roles row mounted?)"))
      }
      // L2 (R1/AC2): the chain table is resolved PER CALL — `overlayNow` reads the live `mpdConfig`
      // on every execute, so a `modelchain.<key>` change made in-process changes the NEXT call.
      // THE AGENT'S OWN ROUTE IS THE FIRST AND ONLY ROUTE SOURCE for a BASE roster agent (contract
      // §2/§4): the config service's TOTAL resolution is read per call, so a saved route is what the
      // NEXT resolve answers. An unusable route is reported as the typed state — a display must never
      // throw and must never fall back to a shipped chain, which is not a route any spawn may run on.
      // ONLY a role an EXTENSION contributed falls through below (overlay → its declared chain → the
      // merged table), because no `agentRoutes` entry decides an extension role at all.
      /** The typed agent-route resolution, or undefined when no service answers. */
      const agentRoute = agentRouteResolutionIn(ctx, String(spec.name)) as
        | { ok: true; agent?: unknown; route?: { provider?: unknown; model?: unknown; fallbacks?: readonly unknown[] } }
        | { ok: false; reason?: unknown; agent?: unknown; missing?: readonly unknown[]; problem?: unknown }
        | undefined
      /**
       * The honest `unconfigured` answer a display renders: empty provider/model and chain, the dotted
       * leaves the entry still needs, and the recovery sentence — NEVER a shipped static route.
       */
      const unconfiguredAnswer = (agent: string, missing: readonly unknown[], reason: string): { provider: string; model: string; chain: Array<{ provider: string; model: string }>; status: string; missing: string[]; reason: string } => ({
        provider: "",
        model: "",
        chain: [],
        status: "unconfigured",
        missing: missing.map(String),
        reason,
      })
      if (agentRoute !== undefined && agentRoute !== null && typeof agentRoute === "object" && typeof agentRoute.ok === "boolean") {
        if (agentRoute.ok) {
          /** The agent's own route, read through the same tolerant field handling as every other consumer. */
          const provider = String(agentRoute.route?.provider ?? "")
          /** The agent's model id. */
          const model = String(agentRoute.route?.model ?? "")
          // The chain is the agent's own: its primary, then its declared fallbacks (in order).
          const fallbacks = Array.isArray(agentRoute.route?.fallbacks) ? agentRoute.route.fallbacks : []
          return {
            provider,
            model,
            chain: [{ provider, model }, ...fallbacks.filter((hop): hop is { provider: string; model: string } => isChainArray([hop]))],
            status: "configured",
          }
        }
        if (agentRoute.reason !== "unrouted") {
          /** The agent the state belongs to, for the recovery sentence. */
          const agent = String(agentRoute.agent ?? spec.name)
          return unconfiguredAnswer(
            agent,
            agentRoute.missing ?? [],
            agentRoute.reason === "invalid"
              ? String(agentRoute.problem ?? "agentRoutes." + agent) + " must be a string — configure it with /mpd-model"
              : "agentRoutes." + agent + " is not configured — configure it with /mpd-model",
          )
        }
      }
      // A BASE roster agent whose route is UNRESOLVABLE — no `mpdConfig` service at all, or a service
      // that answers nothing — has NO route source left: the shipped `roles.data.ts` chain and the
      // shipped `DEFAULT_CHAINS` table are not a default layer (contract §1/§4). It answers the SAME
      // typed state the spawn appliers refuse on and `mpd_roles_list` renders as null, so the two
      // surfaces cannot disagree about whether the agent has a route. ONLY a role an EXTENSION
      // contributed may fall through to the overlay/declared-chain block below.
      /** True when this role was CONTRIBUTED BY AN EXTENSION — the one class that may fall through. */
      const extensionRole = typeof spec.extension === "string" && spec.extension !== ""
      if (!extensionRole) {
        /** The agent name the recovery sentence names. */
        const agent = String(spec.name)
        return unconfiguredAnswer(
          agent,
          ["agentRoutes." + agent + ".provider", "agentRoutes." + agent + ".model"],
          "agentRoutes." + agent + " is not readable — no usable mpdConfig answer; configure it with /mpd-model",
        )
      }
      /** The configured chain for THIS role's id, when the live config routes one (extension roles). */
      const configured = overlayNow(ctx)[String(spec.id)]
      if (isChainArray(configured)) {
        return { provider: configured[0].provider, model: configured[0].model, chain: configured.map((c) => ({ ...c })) }
      }
      if (Array.isArray(spec.chain) && spec.chain.length > 0) {
        return { provider: spec.chain[0].provider, model: spec.chain[0].model, chain: spec.chain.map((c: any) => ({ ...c })) }
      }
      // This role carries no chain of its own: fall back to the shipped/configured table, keyed by
      // the INTERNAL id (`resolveRole`'s keys and the `modelchain.<id>` config keys are ids).
      return resolveRole(String(spec.id), chainsNow(ctx, config))
    }
  })

  dsh.registerTool({
    name: "mpd_memory_save",
    description: "Persist a key/value note in the workspace-scoped memory (.mpd/memory.json).",
    parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, key: { type: "string" } }, required: ["ok", "key"] }, render: (_a: unknown, v: any) => [{ type: "text", text: "saved " + v.key }] },
    execute: async (args: any, exec: any) => {
      // Root resolved PER CALL: the calling session's workspace (never the dsh process cwd).
      const p = memoryPath(dsh.workspaceRoot(exec), config)
      if (!existsSync(p)) mkdirSync(join(p, ".."), { recursive: true })
      /** The memory map read back from disk, so a save merges instead of replacing the file. */
      const mem = loadMemory(p)
      mem[String(args.key)] = String(args.value)
      writeFileSync(p, JSON.stringify(mem, null, 2))
      return { ok: true, key: String(args.key) }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_recall",
    description: "Recall a key from the workspace-scoped memory.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    output: { schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, found: { type: "boolean" } }, required: ["key", "found"] }, render: (_a: unknown, v: any) => [{ type: "text", text: v.found ? v.key + " = " + v.value : "not found: " + v.key }] },
    execute: async (args: any, exec: any) => {
      /** The memory map of the calling session's workspace, read fresh on every recall. */
      const mem = loadMemory(memoryPath(dsh.workspaceRoot(exec), config))
      /** The requested key, stringified so a non-string argument cannot miss the map. */
      const k = String(args.key)
      return { key: k, value: mem[k] ?? "", found: Object.prototype.hasOwnProperty.call(mem, k) }
    }
  })
}
