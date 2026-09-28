// mpd-roster-provider-plugin: per-member model routing for OFFICIAL Agent Teams teammates.
//
// THE GAP THIS CLOSES. A teammate created by the official `spawn_teammate` inherits the LEAD's
// model route: `TeamService.spawnTeammate` forwards only `{ prompt, parent }` to
// `ctx.subagents.startContinuable`, so the mpd `teamModels` slots — which DO route the one-shot
// consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`) — had no effect on a teammate. §8 of
// docs/plan-0.1.7-adaptation.md recorded that as a bound, and it was right about the team service
// and wrong about the harness.
//
// THE SEAM, MEASURED ON THE INSTALLED 0.1.7-rc.2 PACKAGES:
//
//   • `SubagentContinuationManager.startContinuable` resolves
//     `request.agentOptions` into provider/model/reasoningEffort and passes them to
//     `activations.materialize({ …, agentOptions, composition: { persona, toolFilter } })`;
//   • the PROVIDER is what constructs the run (`const run = await provider.start(resolved)`), and a
//     provider is a small class a plugin registers itself (`ctx.subagents.registerProvider`);
//   • the provider NAME is row CONFIG, not a tool argument: the official `spawn_teammate` tool
//     always sends `provider: context === "fork" ? config.forkProvider : config.freshProvider`.
//
// So this package registers a provider (`mpd-roster`) that DELEGATES to the composition's own
// provider and applies the member's slot route on the way through — and the bundle points its
// `mpd-tool-agent-team` row's `freshProvider` at it. No fork of the official plugin, no change to
// its contract, and the teammate stays a real, continuable, official teammate.
//
// IDENTITY is the one thing the team service does not forward: `request` is `{ prompt, parent }` and
// the member's name survives only as the descriptor LABEL (the teammate's `description`). See
// `route.ts` for the matching rule and its conservatism.
import { type DshAdapter, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
// THE single declaration of which member a slot routes. Imported rather than restated: the slots'
// membership is a contract shared with both settings front doors, and a second copy here is exactly
// how a routing table drifts from the one the user edits.
import { TEAM_MODEL_SLOT_GROUPS } from "../../mpd-config-plugin/src/settings-schema"
import { applyRoute, labelOf, memberFromLabel, routeForMember, type RoutableRequest, type SlotRoute } from "./route"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-roster-provider"
/**
 * The ONE seam this row needs, DECLARED.
 *
 * MEASURED (real boot, 2026-09-27): with an empty inject list the row APPLIED and then took its
 * degrade path — `the provider could not be registered — … harness service "subagents" is
 * unavailable` — because cordis answers `undefined` for a service the caller never injected, so the
 * adapter's lazy probe cannot see it either. Unlike the settings section, this row has NO other job:
 * without a subagent plane there is no provider to register, so being parked by its own dependency is
 * the honest outcome rather than a silent no-op.
 */
export const inject = ["subagents"]

/** The provider name the bundle points `freshProvider` at. */
export const PROVIDER_NAME = "mpd-roster"

/** member (lower-cased) → slot id, derived ONCE from the slots' own membership declaration. */
const SLOT_OF_MEMBER: ReadonlyMap<string, string> = new Map(
  Object.entries(TEAM_MODEL_SLOT_GROUPS).flatMap(([slot, group]) =>
    group.members.map((member) => [member.toLowerCase(), slot] as const),
  ),
)

/** What this module needs from the config service. */
interface ConfigLike {
  /** Dotted-key read; optional, because a mounted service without it is treated as "no config". */
  get?: (key?: string) => unknown
}

/** The provider contract, as the harness calls it. */
interface ProviderLike {
  /** The name the harness addresses this provider by. */
  name: string
  /** Which optional provider capabilities this implementation advertises. */
  capabilities: Record<string, boolean>
  /** Whether a run keeps the Lead's context instead of the options handed to it. */
  inheritsParentContext: boolean
  /** Optional pre-start hook, called when the harness prepares a continuable child. */
  prepareContinuable?: (request: unknown) => unknown
  /** Start one child run; the composition's own provider is what actually runs it. */
  start: (request: unknown) => unknown
}

/** The row config. Cordis hands it to `apply` as the SECOND argument — reading `ctx.config` throws
 * `cannot get property "config" without inject` (measured on a real boot: the row then fails with
 * "1 entry did not activate"). */
export interface RosterProviderConfig {
  /** The composition's own provider a delegation delegates TO. */
  baseProvider?: string
  /** `false` leaves the provider unregistered, so every teammate inherits the Lead's route. */
  enabled?: boolean
}

/**
 * Register the `mpd-roster` provider, which delegates to the composition's own provider and applies
 * the named member's slot route on the way through.
 *
 * @param ctx - the row context; the subagent plane is reached through the adapter, never directly.
 * @param config - row overrides for the provider delegated to and the on/off switch.
 */
export function apply(ctx: any, config: RosterProviderConfig = {}): void {
  /** The adapter, which owns every harness seam this row touches. */
  const dsh: DshAdapter = resolveDshAdapter(ctx)
  /** The row's registrations, released together when the row is disposed. */
  const disposers: Array<() => void> = []

  /** The slot that routes a member, from the shared membership declaration (never a second copy). */
  const slotOf = (member: string): string | undefined => SLOT_OF_MEMBER.get(member.toLowerCase())

  /** The configured slots, read PER CALL: the config layer can change under a running session. */
  const slotsNow = (): Record<string, unknown> | undefined => {
    try {
      /** The runtime config service, when the composition mounts one. */
      const config = (typeof ctx?.get === "function" ? ctx.get("mpdConfig") : undefined) as ConfigLike | undefined
      /** The `teamModels` subtree, accepted only when it really is an object. */
      const value = config?.get?.("teamModels")
      return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }

  /** The names a label may match: the union of the slots' member lists. */
  const knownNames = (): string[] => Object.values(TEAM_MODEL_SLOT_GROUPS).flatMap((group) => [...group.members])

  /** The provider to delegate to, defaulting to the harness's own `spawn` provider. */
  const configBaseName = typeof config.baseProvider === "string" && config.baseProvider !== "" ? config.baseProvider : "spawn"

  /**
   * The composition's own provider: what a delegation actually delegates TO.
   *
   * Through the ADAPTER (`subagentProvider`), never `ctx.get("subagents")`: the provider registry is
   * a harness seam, and this plugin would otherwise be a second place that has to change when the
   * harness reshapes it.
   */
  const baseProvider = (): ProviderLike | undefined => {
    try {
      /** The configured provider name, re-read per call so a dismissal cannot leave the default behind. */
      const configured = typeof configBaseName === "string" && configBaseName !== "" ? configBaseName : "spawn"
      /** What the catalogue answered for that name; a half-present catalogue answers nothing. */
      const found = dsh.subagentProvider(configured)
      return found === undefined || found === null ? undefined : (found as ProviderLike)
    } catch {
      return undefined
    }
  }

  /**
   * The route one teammate takes, resolved from the descriptor label.
   *
   * A member the label does not name — or one the roster does not slot-route — inherits the Lead's
   * route, which is the behaviour every teammate had before this row existed.
   */
  const routeFor = (request: RoutableRequest): SlotRoute | undefined => {
    /** The roster member the label names, or undefined when it names none. */
    const member = memberFromLabel(labelOf(request), knownNames())
    if (member === undefined) return undefined
    return routeForMember(member, slotOf(member), slotsNow())
  }

  /** The provider this bundle registers. */
  const provider: ProviderLike = {
    name: PROVIDER_NAME,
    // `agentOptions` is the capability that MATTERS here: it tells the harness this provider may be
    // handed resolved child options and is responsible for the run they describe.
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    /** Delegate the preparation to the composition's provider, so the harness sees one normal child. */
    prepareContinuable(request: unknown): unknown {
      /** The composition's own provider, resolved fresh so a late registration is still seen. */
      const base = baseProvider()
      if (base === undefined || typeof base.prepareContinuable !== "function") {
        throw new Error(`mpd-roster: the "${configBaseName}" provider is not registered in this composition, so no teammate can be prepared through ${PROVIDER_NAME}`)
      }
      return base.prepareContinuable(request)
    },
    /** Apply the member's route to the request, then start the run on the composition's provider. */
    start(request: unknown): unknown {
      /** The composition's own provider, resolved fresh so a late registration is still seen. */
      const base = baseProvider()
      if (base === undefined || typeof base.start !== "function") {
        throw new Error(`mpd-roster: the "${configBaseName}" provider is not registered in this composition, so no teammate can be started through ${PROVIDER_NAME}`)
      }
      /** This request read through the routing contract; every other field is forwarded untouched. */
      const routable = request as RoutableRequest
      // A route resolution that THROWS (an incomplete slot) must reach the captain unchanged: the
      // spawn fails loudly, naming the member and the slot, and nothing is silently substituted.
      const routed = applyRoute(routable, routeFor(routable))
      if (routed !== routable) {
        /** The options the harness will actually run on, logged so a wrong label is visible at spawn time. */
        const options = routed.agentOptions ?? {}
        console.log(`[mpd-roster] routed teammate "${String(labelOf(routable) ?? "")}" -> ${String(options.provider)}/${String(options.model)}${options.reasoningEffort === undefined ? "" : " @ " + String(options.reasoningEffort)}`)
      }
      return base.start(routed)
    },
  }

  if (config.enabled === false) return
  try {
    disposers.push(dsh.registerSubagentProvider(provider))
    console.log(`[mpd-roster] provider "${PROVIDER_NAME}" registered (delegating to "${configBaseName}"; point the team tool row's freshProvider at it)`)
  } catch (error) {
    // A composition without a subagent plane must not lose its boot: say so once and stay inert.
    console.warn(`[mpd-roster] the provider could not be registered — teammates keep the Lead's route: ${String((error as Error)?.message ?? error)}`)
  }

  if (typeof ctx?.on === "function") ctx.on("dispose", () => { for (const dispose of disposers) { try { dispose() } catch { /* already gone */ } } })
}

export { applyRoute, labelOf, memberFromLabel, routeForMember }
export type { SlotRoute }
