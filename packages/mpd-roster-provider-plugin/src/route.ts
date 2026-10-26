// The ROUTING rules of the mpd roster provider, kept pure so the whole decision is unit-testable
// without a harness, a ctx or a model.
//
// WHY THIS EXISTS. Harness 0.1.7-rc.2's official TeamService starts every teammate with the route
// of the session that staged it (the LEAD's, in the team flow this row serves), because it forwards
// only `{ prompt, parent }`. The harness itself is not the
// limitation — that generation's `SubagentContinuationManager.startContinuable` (renamed
// `startActivation(spec)` in 0.2.1-rc.2, with the same contract for this module) resolves
// `request.agentOptions` into provider/model/reasoningEffort and hands them to the PROVIDER, which
// is what constructs the run. So a bundle-owned provider can supply the route the team service
// never sends, and that is what this package registers (`mpd-roster`).

// THE LABEL SPLIT IS NOT RESTATED HERE. `rosterNameHead` in the shared adapter is the ONE
// implementation (the native team executor reads the same rule), so the official path and the
// native path cannot disagree about what "the head of a description" means.
import { rosterNameHead } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** One agent's resolved route, as its own `agentRoutes` entry declares it. */
export interface AgentRoute {
  /** Provider id the agent's teammate must run on (`deepseek-official`, `gateway`, …). */
  provider: string
  /** Model id that provider must run for this agent. */
  model: string
  /** Optional effort keyword; absent means the route states none and the harness keeps its own resolution. */
  reasoningEffort?: string
}

/** The shape this module needs from a request; the rest is forwarded untouched. */
export interface RoutableRequest {
  /** The resolved child options the harness hands the provider; the three route fields live here. */
  agentOptions?: Record<string, unknown>
  /** The teammate descriptor, whose `label` is the one identity channel the team service forwards. */
  descriptor?: { label?: unknown }
  /** Fallback identity on the request itself, read only when the descriptor carries no label. */
  label?: unknown
  [key: string]: unknown
}

/**
 * The roster member a teammate is, read from the descriptor LABEL.
 *
 * The label is the teammate's `description`, which is the only identity channel the team service
 * forwards: it passes `label: description` into the durable-child start and nothing else carries the
 * name (`request` is `{ prompt, parent }`, and no persona field is forwarded either — 0.2.1-rc.2
 * removed `persona` from that request outright).
 *
 * The contract is therefore: **a description that names a roster member routes that member; one
 * that does not is NOT routed here — `routeFor` returns `undefined`, `applyRoute` returns the request
 * by identity, and the harness-resolved route of the session that staged it stands.** The name is
 * the head {@link rosterNameHead} extracts (the text before `—`, `–`, `:`, `|` or ` - `; `·` is NOT
 * a separator) and is matched case-insensitively, so `"Senior Engineer — implements the parser"`
 * routes Senior Engineer while `"check the vendored corpus"` routes nothing. Matching is
 * deliberately conservative: a wrong guess would silently move a teammate onto a model nobody chose.
 *
 * @param label - the descriptor label (or the request's own `label`).
 * @param knownNames - the roster's functional names.
 * @returns the matching roster name, or `undefined` when the label names none.
 */
export function memberFromLabel(label: unknown, knownNames: readonly string[]): string | undefined {
  /** The text before the first separator, trimmed; a member name must be the WHOLE head to match. */
  const head = rosterNameHead(label)
  if (head === "") return undefined
  /** The head lower-cased once, since the comparison below is case-insensitive. */
  const needle = head.toLowerCase()
  // Longest name first: "Plan Reviewer" must win over a hypothetical "Reviewer" prefix match.
  const ordered = [...knownNames].sort((left, right) => right.length - left.length)
  for (const name of ordered) {
    if (needle === name.toLowerCase()) return name
  }
  return undefined
}

/**
 * One request with the member's route applied to its `agentOptions`.
 *
 * The merge is deliberately narrow: it REPLACES provider/model/reasoningEffort and touches nothing
 * else, so a teammate keeps whatever the harness resolved for depth, persona, tool filter and
 * descriptor. A request with no route (the member is not slot-routed, or the label named nobody) is
 * returned UNCHANGED — by identity, so a caller can tell the two cases apart.
 *
 * @param request - the provider's start request.
 * @param route - the route to apply, or `undefined` to inherit.
 * @returns the request to dispatch.
 */
export function applyRoute<T extends RoutableRequest>(request: T, route: AgentRoute | undefined): T {
  if (route === undefined) return request
  /** The merged child options: the request's own, with the three route fields replaced. */
  const agentOptions: Record<string, unknown> = { ...(request.agentOptions ?? {}), provider: route.provider, model: route.model }
  if (route.reasoningEffort !== undefined) agentOptions.reasoningEffort = route.reasoningEffort
  else delete agentOptions.reasoningEffort
  return { ...request, agentOptions }
}

/** The label a request carries, from the descriptor first and the request's own field second. */
export function labelOf(request: RoutableRequest): unknown {
  /** The descriptor's label when it has one; the request's own `label` is only the fallback. */
  const fromDescriptor = request.descriptor?.label
  return fromDescriptor === undefined ? request.label : fromDescriptor
}
