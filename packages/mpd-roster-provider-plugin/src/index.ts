// mpd-roster-provider-plugin: per-member model routing for OFFICIAL Agent Teams teammates.
//
// THE GAP THIS CLOSES. Before this row, a teammate created by the official `spawn_teammate` kept
// the route of the session that staged it (the LEAD's in a team-lead spawn):
// `TeamService.spawnTeammate` forwards only `{ prompt, parent }` to the harness
// subagent seam (the durable-child start, named `startActivation` since 0.2.1-rc.2), so the mpd
// `teamModels` slots — which DO route the one-shot consult paths (`mpd_role_spawn`,
// `mpd_workmate_spawn`) — had no effect on a teammate. §8 of
// docs/plan-0.1.7-adaptation.md recorded that as a bound, and it was right about the team service
// and wrong about the harness.
//
// THE SEAM, MEASURED ON THE INSTALLED 0.1.7-rc.2 PACKAGES (the member names below are that
// generation's; 0.2.1-rc.2 renamed the start to `startActivation(spec)` and dropped the
// `composition` box, but the CONTRACT this package relies on is unchanged — the request carries
// `agentOptions`, and the PROVIDER is what constructs the run):
//
//   • `SubagentContinuationManager.startContinuable` resolves
//     `request.agentOptions` into provider/model/reasoningEffort and hands them to the provider;
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
import { rowLogLine, DSH_SEAM_SUBAGENTS, dshSeamInject, resolveRunRoute, type DshAdapter, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
// THE single declaration of which member a slot routes. Imported rather than restated: the slots'
// membership is a contract shared with both settings front doors, and a second copy here is exactly
// how a routing table drifts from the one the user edits.
import { TEAM_MODEL_SLOT_GROUPS } from "../../mpd-config-plugin/src/settings-schema"
import { applyRoute, labelOf, memberFromLabel, type RoutableRequest, type SlotRoute } from "./route"

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
export const inject = dshSeamInject(DSH_SEAM_SUBAGENTS)

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

/**
 * The start-time capabilities a subagent provider advertises — the harness's own
 * `SubagentCapabilities`, re-declared here because that package is not resolvable by bare
 * specifier from this repository (AGENTS.md §6).
 *
 * EXACTLY these four exist in harness 0.2.1-rc.2. The retired `persona` and `toolFilter` are
 * not capabilities any more, and advertising them told the harness this provider supported
 * something no release checks. Naming the shape turns the next such removal into a compile
 * error here instead of a silent lie at boot.
 */
interface ProviderCapabilities {
  /** The provider accepts resolved child `agentOptions` and runs what they describe. */
  agentOptions: boolean
  /** The provider can select a preset independently of the parent's composition. */
  agentPreset: boolean
  /** The provider can satisfy a caller-supplied output schema. */
  outputSchema: boolean
  /** The provider enforces an absolute delegation-depth cap. */
  depthLimit: boolean
}

/** The provider contract, as the harness calls it. */
interface ProviderLike {
  /** The name the harness addresses this provider by. */
  name: string
  /** Which optional provider capabilities this implementation advertises. */
  capabilities: ProviderCapabilities
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
  /** `false` leaves the provider unregistered, so no slot is applied and every teammate keeps the
   * harness-resolved route of the session that staged it. */
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

  /** The config service surface this row reads; BOTH reads are total (contract amendment 1). */
  interface ConfigServiceLike {
    /** The typed total resolution the slot-single-source wave exposes. */
    slotResolutionOf?: (member: string) => unknown
    /** The older total route read, kept for a composition running a stale config-row dist. */
    teamModelRouteOf?: (member: string) => unknown
  }

  /** The live config service, or undefined when the composition mounts none (or refuses the lookup). */
  const configService = (): ConfigServiceLike | undefined => {
    try {
      return (typeof ctx?.get === "function" ? ctx.get("mpdConfig") : undefined) as ConfigServiceLike | undefined
    } catch {
      // A config service that refuses the lookup reads as ABSENT, never as a boot failure.
      return undefined
    }
  }

  /**
   * Build the canonical `SLOT_UNCONFIGURED` refusal for a slot-routed member no service can route.
   *
   * Only the DEGRADED composition reaches this (no `mpdConfig` at all, or a pre-wave service that
   * answers nothing): the shipped bundle always mounts the config row, and its own resolver builds the
   * sentence every other applier throws. This local sentence states the same facts — the member, the
   * slot, both recovery paths, and that nothing was written and no child was started.
   * @param member - the roster member the label named.
   * @returns the refusal error, carrying the branchable code.
   */
  const slotUnconfigured = (member: string): Error => {
    /** The slot id that routes the member, when the shared declaration knows it. */
    const slot = slotOf(member) ?? "teamModels"
    /** The error, with the code every applier attaches. */
    const error = new Error("SLOT_UNCONFIGURED: " + member + " is routed by " + slot + ", but the mpdConfig service answered no slot (is the mpd-config row mounted?); nothing was written and no child was started. Configure it with /mpd-model, or set teamModels." + slot + " in .mpd/mpd.jsonc.")
    ;(error as Error & { code?: string }).code = "SLOT_UNCONFIGURED"
    return error
  }

  /**
   * The route one teammate takes, resolved from the descriptor label — the SLOT is the only source
   * (contract §6).
   *
   * A label that names NO member is NOT routed here: this returns `undefined`, `applyRoute` returns the
   * request by identity, and the harness-resolved route of the session that staged the teammate stands
   * (the captain's in a top-level spawn, the Lead's in a team-lead spawn) — §6's "identity, unchanged".
   * A label that DOES name a member reads the config service's TOTAL resolution per call, so a saved
   * slot reaches the NEXT teammate; an unusable slot THROWS the canonical refusal, so `base.start` is
   * never reached and no child is started (the DoD arm).
   *
   * @param request - the provider's start request, whose label carries the identity.
   * @returns the primary route plus the slot's own fallback chain, or undefined to inherit.
   * @throws the structured `SLOT_UNCONFIGURED` failure for a slot-routed member with an unusable slot.
   */
  const routeFor = (request: RoutableRequest): { route: SlotRoute; fallbacks: readonly unknown[] } | undefined => {
    /** The roster member the label names, or undefined when it names none. */
    const member = memberFromLabel(labelOf(request), knownNames())
    if (member === undefined) return undefined
    /** The live config service, absent under a degraded composition. */
    const live = configService()
    if (typeof live?.slotResolutionOf === "function") {
      /** The service's TOTAL resolution; a malformed answer is treated as "no service". */
      const resolution = live.slotResolutionOf(member) as
        | { ok: true; route: SlotRoute; fallbacks?: readonly unknown[] }
        | { ok: false; status: "unconfigured" | "invalid"; code: string; message: string }
        | { ok: false; status: "unrouted" }
        | undefined
      if (resolution !== undefined && resolution !== null && typeof resolution === "object") {
        if (resolution.ok) return { route: resolution.route, fallbacks: resolution.fallbacks ?? [] }
        // Not slot-routed (a name no group carries): this row does not decide its route.
        if (resolution.status === "unrouted") return undefined
        /** The refusal the service built, with its branchable code attached. */
        const error = new Error(resolution.message)
        ;(error as Error & { code?: string }).code = resolution.code
        throw error
      }
    }
    // VERSION SKEW: the older total read still answers for the members it routes.
    if (typeof live?.teamModelRouteOf === "function") {
      /** The older read's route, or undefined when it has none to report. */
      const route = live.teamModelRouteOf(member) as SlotRoute | undefined | null
      if (route !== undefined && route !== null && typeof route === "object") return { route, fallbacks: [] }
    }
    // No readable slot: a member the roster slot-routes cannot run on an invented route.
    throw slotUnconfigured(member)
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

  /** The provider this bundle registers. */
  const provider: ProviderLike = {
    name: PROVIDER_NAME,
    // `agentOptions` is the capability that MATTERS here: it tells the harness this provider may be
    // handed resolved child options and is responsible for the run they describe. `agentPreset` is
    // advertised because this provider forwards the WHOLE request to the composition's own provider
    // in both `prepareContinuable` and `start`, so preset selection passes through untouched.
    capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
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
    async start(request: unknown): Promise<unknown> {
      /** The composition's own provider, resolved fresh so a late registration is still seen. */
      const base = baseProvider()
      if (base === undefined || typeof base.start !== "function") {
        throw new Error(`mpd-roster: the "${configBaseName}" provider is not registered in this composition, so no teammate can be started through ${PROVIDER_NAME}`)
      }
      /** This request read through the routing contract; every other field is forwarded untouched. */
      const routable = request as RoutableRequest
      // A route resolution that THROWS (an unusable slot) must reach the captain unchanged: the spawn
      // fails loudly, naming the member and the slot, and `base.start` below is never reached.
      const resolved = routeFor(routable)
      /** The request with a route applied, or the request itself for an inheriting teammate. */
      const routed = resolved === undefined
        ? routable
        : applyRoute(routable, (await resolveRunRoute(dsh, resolved.route, resolved.fallbacks)).route)
      if (routed !== routable) {
        /** The options the harness will actually run on, logged so a wrong label is visible at spawn time. */
        const options = routed.agentOptions ?? {}
        rowLogLine("mpd-roster", `[mpd-roster] routed teammate "${String(labelOf(routable) ?? "")}" -> ${String(options.provider)}/${String(options.model)}${options.reasoningEffort === undefined ? "" : " @ " + String(options.reasoningEffort)}`)
      }
      return base.start(routed)
    },
  }

  if (config.enabled === false) return
  try {
    disposers.push(dsh.registerSubagentProvider(provider))
    rowLogLine("mpd-roster", `[mpd-roster] provider "${PROVIDER_NAME}" registered (delegating to "${configBaseName}"; point the team tool row's freshProvider at it)`)
  } catch (error) {
    // A composition without a subagent plane must not lose its boot: say so once and stay inert.
    rowLogLine("mpd-roster", `[mpd-roster] the provider could not be registered — teammates run on the route of the session that stages them (the captain's in a top-level spawn): ${String((error as Error)?.message ?? error)}`)
  }

  if (typeof ctx?.on === "function") ctx.on("dispose", () => { for (const dispose of disposers) { try { dispose() } catch { /* already gone */ } } })
}

export { applyRoute, labelOf, memberFromLabel }
export type { SlotRoute }
