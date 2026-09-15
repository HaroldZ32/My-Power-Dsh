// Seam activation + honest outcome reporting — the two host idioms every seam uses.
//
// T4-INERT-1 (measured, `evidence/tui/plugin/20260915T054343Z/mount-instrumentation`):
// in this harness a plugin context only reaches a service it has INJECTED. An
// inject-free row gets `undefined` from `ctx.get(id, false)` for `commands`,
// `settings` and every `tui*` service, so a probe-then-register plugin registers
// NOTHING in a real boot. The host's documented optional-seam idiom is the
// DEFERRED form:
//
//   ctx.inject(['tuiScenes'], (scoped) => { … scoped.tuiScenes.register(…) … })
//
// Measured in the same harness: the callbacks fire synchronously during apply
// when the service is already mounted, and the scoped context exposes its service
// both as a property and through `scoped.get(id, false)`. The BLOCKING
// `export const inject = [...]` form is deliberately NOT used: it leaves the
// optional `tui*` services absent and can leave a row pending forever.
//
// HONEST OUTCOMES: several host registries answer a refusal with a NO-OP
// disposer (`renderers.ts`, `shortcuts.ts`) or `() => false` (decision guard), so
// a returned disposer is NOT proof of registration. Every seam therefore reports
// a `SeamOutcome`: `confirmed` only when a host READ-BACK says so
// (`tuiShortcuts.list()`), `requested` when the host offers none, `available` for
// a request-based seam, `refused` when the call threw or the read-back is empty,
// and `absent` while the service was never injected. Nothing is ever reported as
// registered on the strength of a disposer's type.
import type { Disposer, PluginContextLike, SeamOutcome } from "./types.js"

/**
 * Read one service from an INJECTED scope.
 *
 * Inside the `ctx.inject` callback the service is reachable both as a property
 * and through the soft probe; both forms are guarded because a foreign context
 * can throw on either.
 * @param scoped - the injected scope.
 * @param id - the service id.
 * @returns the service, or undefined when it is not readable.
 */
export function readableService<T>(scoped: PluginContextLike, id: string): T | undefined {
  if (scoped === undefined || scoped === null) return undefined
  if (typeof scoped.get === "function") {
    try {
      const found = scoped.get(id, false)
      if (found !== undefined && found !== null) return found as T
    } catch {
      // fall through to the property form
    }
  }
  try {
    const property = (scoped as Record<string, unknown>)[id]
    if (property !== undefined && property !== null) return property as T
  } catch {
    // not readable in this context
  }
  return undefined
}

/**
 * Read one optional service OUTSIDE a seam (used for `mpdDsh`).
 *
 * This does NOT work for a service the row has not injected: the whole point of
 * {@link onService} is that the inject declaration is what makes a service
 * reachable (T4-INERT-1).
 */
export function serviceOf<T>(ctx: PluginContextLike, id: string): T | undefined {
  if (ctx === undefined || ctx === null || typeof ctx.get !== "function") return undefined
  try {
    const found = ctx.get(id, false)
    return found === undefined || found === null ? undefined : (found as T)
  } catch {
    return undefined
  }
}

/**
 * Activate one optional seam through cordis's deferred inject form.
 *
 * The callback runs exactly when the service is composed, and a service that
 * never appears simply never runs it — no pending row, no crash. Every failure
 * inside the callback is contained so a broken seam cannot break `apply` or the
 * other seams.
 * @param ctx - the plugin context.
 * @param id - the service id to inject.
 * @param setup - registration work, receiving the injected scope and the service.
 * @param onActivated - called after `apply` returned, when the activation was late.
 */
export function onService(
  ctx: PluginContextLike,
  id: string,
  setup: (scoped: PluginContextLike, service: unknown) => void,
  onActivated?: () => void,
): void {
  if (ctx === undefined || ctx === null || typeof ctx.inject !== "function") return
  try {
    ctx.inject([id], (scoped: PluginContextLike) => {
      const service = readableService(scoped, id)
      if (service === undefined) return
      try {
        setup(scoped, service)
        onActivated?.()
      } catch {
        // A seam that throws must never break the boot or the sibling seams.
      }
    })
  } catch {
    // An unusable inject seam leaves this role absent, which is reported.
  }
}

/**
 * Own a cleanup on the INJECTED scope's fiber.
 *
 * The host's registration services return a disposer scoped to the CALLER (a
 * service method cannot see the caller's fiber), so the seam hands it back to
 * `scoped.effect`; disposing that scope (plugin unload, hot reload) then runs it.
 */
export function effectOn(scoped: PluginContextLike, cleanup: Disposer, label: string): void {
  try {
    if (typeof scoped.effect === "function") scoped.effect(() => cleanup, label)
  } catch {
    // A disposed scope cannot own new effects; nothing durable was registered.
  }
}

/** The `state` line one seam contributes to the aggregate diagnostic. */
export function describeOutcome(id: string, outcome: SeamOutcome): string {
  return outcome.detail === undefined ? `${id}(${outcome.state})` : `${id}(${outcome.state}: ${outcome.detail})`
}
