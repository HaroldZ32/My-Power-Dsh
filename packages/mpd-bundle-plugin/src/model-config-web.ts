// The effective model-config route (R3, wave fix/model-config-live-refresh, lane L4; re-aimed by
// the agent-routes contract `.mpd/plans/agent-routes-per-agent.md` §7): one READ-ONLY exact-path
// route the Web settings card fetches so its see-before-you-edit block can show the CURRENT EFFECTIVE
// model config — ONE typed route resolution PER AGENT (the eleven roster members' own
// `agentRoutes.<Agent>` entries, resolved by the config service's TOTAL read) and the configured
// `modelchain.<key>` chains. The legacy `teamModels` block is NEVER read here: it is tolerated for
// boot, migrated once by the config row, then ignored (contract §1).
//
// WHY A ROUTE AT ALL: those values live in the `mpdConfig` service (node side), and the modelchain
// half exists in NO settings document — the `mpd-modelchain` row declares no volatile Config, so
// `configForms` cannot serve it. A browser client cannot reach a cordis service directly, so the
// bundle's server half (this package, `src/index.ts`) reads the service and answers JSON. The card
// degrades to a notice when this route is absent (a webless profile) — never to a re-parse of
// mpd.jsonc, which R3 forbids.
//
// The route follows `watchdog-web.ts`'s measured pattern: an exact-path registration on the host's
// web server, effect-owned by the caller, tolerating a server that cannot register.
/** The exact-path route this module owns (the path the settings card fetches). */
export const MODEL_CONFIG_PATH = "/plugins/mpd/model-config"

/**
 * The eleven roster display names, in the four groups' declared order — a MIRROR of
 * `TEAM_MODEL_SLOT_GROUPS`'s member lists in `mpd-config-plugin/src/settings-schema.ts`.
 *
 * The route does not import that declaration (this package's server half stays dependency-free: the
 * bundled `dist/index.js` would inline the whole config schema for eleven strings), so the list is
 * mirrored here and a test pins it against the shared declaration. The four groups are DISPLAY-only
 * (contract §7): the route neither knows nor serves any persisted slot.
 */
export const ROSTER_MEMBERS: readonly string[] = [
  "Architect",
  "Planner",
  "Reviewer",
  "Lead",
  "Senior Engineer",
  "Researcher",
  "Explorer",
  "Plan Reviewer",
  "Deep Worker",
  "Junior Engineer",
  "Vision Analyst",
]

/** The `mpdConfig` service surface this route reads (the mounted service, or a test double). */
export interface ConfigServiceLike {
  /** Read one resolved config key, or the whole raw config when no key is given. */
  get?: (key?: string) => unknown
  /**
   * The TOTAL per-agent route resolution (contract §2): a typed union that never throws, so an
   * unconfigured agent is a VALUE the card renders, not an error that empties the block.
   */
  agentRouteResolutionOf?: (member: string) => unknown
}

/** The route body when the read succeeded. */
interface ModelConfigOk {
  /** The success marker the card's projection keys on. */
  ok: true
  /** One typed route resolution per roster member, keyed by display name — never an empty table. */
  agents: Record<string, unknown>
  /** The configured `modelchain` chains ({} when none are). */
  modelchain: unknown
}

/** The route body when the service could not answer. */
interface ModelConfigUnavailable {
  /** The failure marker the card's projection keys on. */
  ok: false
  /** Why the read is unavailable — the sentence the card renders as its notice. */
  reason: string
}

/**
 * Build the route body from the live config service, read PER REQUEST so the answer always
 * reflects the service's CURRENT state (L1's watcher and entry-config subscription refresh it —
 * a save made seconds ago is what this route serves next).
 * @param config - the `mpdConfig` service, or undefined when the row is not composed.
 * @returns the JSON body: one typed resolution per roster agent plus the chains, or the refusal reason.
 */
export function buildModelConfigBody(config: ConfigServiceLike | undefined): ModelConfigOk | ModelConfigUnavailable {
  if (config === undefined || config === null) {
    return { ok: false, reason: "the mpdConfig service is not composed in this profile" }
  }
  if (typeof config.agentRouteResolutionOf !== "function") {
    return { ok: false, reason: "the mpdConfig service exposes no per-agent route resolver (agentRouteResolutionOf)" }
  }
  try {
    /** One typed resolution per roster member, in the declared roster order. */
    const agents: Record<string, unknown> = {}
    for (const member of ROSTER_MEMBERS) agents[member] = config.agentRouteResolutionOf(member)
    return {
      ok: true,
      agents,
      // The chains ride only the service read: NO settings document holds them.
      modelchain: typeof config.get === "function" ? config.get("modelchain") ?? {} : {},
    }
  } catch (error) {
    return { ok: false, reason: `the config read threw (${String((error as { message?: unknown })?.message ?? error)})` }
  }
}

/**
 * Register the route on the host's web server. The caller owns the server probe and the lifetime
 * (`ctx.effect`); this function only tolerates a server that cannot register.
 * @param webServer - the host's web server, narrowed to the register surface this module uses.
 * @param deps - the per-request config resolver and the effect seam the registration is owned by.
 * @returns whether the route was registered.
 */
export function registerModelConfigRoute(
  webServer: { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => unknown },
  deps: { config: () => ConfigServiceLike | undefined; effect: (fn: () => unknown, label: string) => unknown },
): boolean {
  /** Whether the route was registered. */
  let registered = false
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: MODEL_CONFIG_PATH,
      handler: (_req: unknown, res: unknown): void => {
        /** The response, narrowed to the write surface this module uses. */
        const out = res as { writeHead: (status: number, headers: Record<string, string>) => void; end: (text: string) => void }
        /** The body this request answers with, built from the service read right now. */
        const body = buildModelConfigBody(deps.config())
        out.writeHead(body.ok ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        out.end(JSON.stringify(body))
      },
    }), "mpd-bundle: model-config web route")
    registered = true
  } catch {
    // A server that cannot register is not fatal: the card then degrades to its notice.
  }
  return registered
}
