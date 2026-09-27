// The ROUTING rules of the mpd roster provider, kept pure so the whole decision is unit-testable
// without a harness, a ctx or a model.
//
// WHY THIS EXISTS. Harness 0.1.7-rc.2's official TeamService starts every teammate with the route
// the LEAD has, because it forwards only `{ prompt, parent }`. The harness itself is not the
// limitation — `SubagentContinuationManager.startContinuable` resolves `request.agentOptions` into
// provider/model/reasoningEffort and hands them to the PROVIDER, which is what constructs the run.
// So a bundle-owned provider can supply the route the team service never sends, and that is what
// this package registers (`mpd-roster`).

/** One member's resolved route, as the mpd `teamModels` slots declare it. */
export interface SlotRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The shape this module needs from a request; the rest is forwarded untouched. */
export interface RoutableRequest {
  agentOptions?: Record<string, unknown>
  descriptor?: { label?: unknown }
  label?: unknown
  [key: string]: unknown
}

/**
 * The roster member a teammate is, read from the descriptor LABEL.
 *
 * The label is the teammate's `description`, which is the only identity channel the team service
 * forwards: it passes `label: description` into `startContinuable` and nothing else carries the
 * name (`request` is `{ prompt, parent }`, and `persona` is not forwarded either).
 *
 * The contract is therefore: **a description that names a roster member routes that member; one
 * that does not inherits the Lead's route.** The name is the text before the first separator
 * (`—`, `-`, `:`, `|`) and is matched case-insensitively, so
 * `"Senior Engineer — implements the parser"` routes Senior Engineer while
 * `"check the vendored corpus"` routes nothing. Matching is deliberately conservative: a wrong
 * guess would silently move a teammate onto a model nobody chose.
 *
 * @param label - the descriptor label (or the request's own `label`).
 * @param knownNames - the roster's functional names.
 * @returns the matching roster name, or `undefined` when the label names none.
 */
export function memberFromLabel(label: unknown, knownNames: readonly string[]): string | undefined {
  if (typeof label !== "string") return undefined
  const head = label.split(/[—–:|]|\s-\s/)[0]?.trim() ?? ""
  if (head === "") return undefined
  const needle = head.toLowerCase()
  // Longest name first: "Plan Reviewer" must win over a hypothetical "Reviewer" prefix match.
  const ordered = [...knownNames].sort((left, right) => right.length - left.length)
  for (const name of ordered) {
    if (needle === name.toLowerCase()) return name
  }
  return undefined
}

/**
 * The route a member takes, from the slot mapping and the configured slots.
 *
 * @param member - the roster member's functional name.
 * @param slotOf - the member's slot id (`slot1`…`slot4`), or `undefined` when it has none.
 * @param slots - the configured `teamModels` subtree.
 * @returns the route, or `undefined` when this member is not routed by slots at all.
 * @throws when the member HAS a slot but that slot is not fully configured — the rule the one-shot
 *   paths already follow: fail LOUDLY naming the member and the slot, never substitute and never
 *   clamp an effort.
 */
export function routeForMember(
  member: string,
  slotOf: string | undefined,
  slots: Record<string, unknown> | undefined,
): SlotRoute | undefined {
  if (slotOf === undefined) return undefined
  const slot = slots?.[slotOf] as Record<string, unknown> | undefined
  if (slot === undefined || slot === null || typeof slot !== "object") {
    throw new Error(`mpd-roster: ${member} is routed by ${slotOf}, but no ${slotOf} is configured for this workspace`)
  }
  const provider = typeof slot.provider === "string" ? slot.provider.trim() : ""
  const model = typeof slot.model === "string" ? slot.model.trim() : ""
  const effort = typeof slot.reasoningEffort === "string" ? slot.reasoningEffort.trim() : ""
  if (provider === "" || model === "") {
    throw new Error(
      `mpd-roster: ${member} is routed by ${slotOf}, but that slot is incomplete (provider=${provider === "" ? "unset" : provider}, model=${model === "" ? "unset" : model})`,
    )
  }
  return { provider, model, ...(effort === "" ? {} : { reasoningEffort: effort }) }
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
export function applyRoute<T extends RoutableRequest>(request: T, route: SlotRoute | undefined): T {
  if (route === undefined) return request
  const agentOptions: Record<string, unknown> = { ...(request.agentOptions ?? {}), provider: route.provider, model: route.model }
  if (route.reasoningEffort !== undefined) agentOptions.reasoningEffort = route.reasoningEffort
  else delete agentOptions.reasoningEffort
  return { ...request, agentOptions }
}

/** The label a request carries, from the descriptor first and the request's own field second. */
export function labelOf(request: RoutableRequest): unknown {
  const fromDescriptor = request.descriptor?.label
  return fromDescriptor === undefined ? request.label : fromDescriptor
}
