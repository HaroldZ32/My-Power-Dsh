// Seam 9 — the DecisionEvents seam: BUILT READY, NOT ACTIVATED (plan D9/W-1).
//
// `tui.dsh/v1alpha1#DecisionEvents` cannot be activated by a profile-installed
// plugin. The mediated surface (`ctx.tuiPluginHost.subscribeDecision`) requires a
// VERIFIED Component identity: admission is token-gated and unreachable
// (`src/dsh-adapter/plugin-host.ts` — the public `admit()` throws, `admitInternal`
// needs an unexported production token, `getHostAdmission*` has no production
// caller), so the identity assertion throws before any policy question.
//
// HONESTY (T10-F1, reviewer direction): registration is NEVER inferred from the
// disposer's type. The host answers a missing GRANT with a NO-OP disposer
// (`decision-guard.ts:280-286`, stated at :531-534), which is indistinguishable
// from a real registration by type — and calling that disposer as a probe is
// forbidden (a real release returns true and unregisters the handler). The one
// documented source of truth is the caller-safe grant facade
// (`ctx.tuiPluginHost.grants.allows(ctx, permission, scope)`), so this seam asks
// it and reports `confirmed` only when the grant is present AND the subscribe
// returned a disposer; `refused` when the subscribe threw or the grant is absent;
// `requested` (never claimed active) when the host exposes no grant facade.
//
// It NEVER calls `admit`/`admitInternal`, never uses the test-only admission
// token, and never fakes an identity.
import type { Disposer, PluginContextLike, SeamOutcome, TuiPluginHostLike } from "./types.js"
import type { Log } from "./log.js"
import { effectOn, onService } from "./host.js"

/**
 * The four intercept-class decision points and the permission each one requires
 * (host spec layer: `src/adapter/spec/protocol-constants.ts:99-104`).
 */
export const DECISION_EVENTS: readonly { event: string; permission: string }[] = [
  { event: "tui/input", permission: "session.input.intercept" },
  { event: "tui/rewind-prompt", permission: "session.rewind.intercept" },
  { event: "tui/session-switch", permission: "session.switch.intercept" },
  { event: "tui/compact", permission: "session.compact.intercept" },
]

/** Registration order used for the mediated subscription (`order` is required, control-free). */
export const DECISION_ORDER = "mpd-tui"

/** What one intercept point's mediated registration produced. */
export interface DecisionAttempt {
  /** The intercept point id, e.g. `tui/input`. */
  event: string
  /** The per-event verdict; `confirmed` needs both a grant and a disposer. */
  state: "confirmed" | "requested" | "refused"
  /** Why the verdict came out as it did; absent when the host gave no reason. */
  reason?: string
}

/** The seam handle: the aggregate outcome plus the per-event verdicts. */
export interface DecisionSeam {
  /** The aggregate result, as the boot diagnostic reports it. */
  outcome(): SeamOutcome
  /** The per-event verdicts, in registration order. */
  attempts(): readonly DecisionAttempt[]
}

/**
 * Attempt the mediated DecisionEvents registration.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @returns the seam handle; `attempts()` carries the per-event verdict.
 */
export function attemptDecisionEvents(ctx: PluginContextLike, log: Log): DecisionSeam {
  /** Per-event verdicts, filled as the loop walks the intercept points. */
  const attempts: DecisionAttempt[] = []
  /** The aggregate result, rewritten once every intercept point was attempted. */
  let outcome: SeamOutcome = { state: "absent", detail: "tuiPluginHost was not injected" }

  onService(ctx, "tuiPluginHost", (scoped, service) => {
    /** The probed service as the mediated host surface, before `subscribeDecision` is trusted. */
    const host = service as TuiPluginHostLike
    if (typeof host?.subscribeDecision !== "function") {
      outcome = { state: "refused", detail: "tuiPluginHost.subscribeDecision is missing" }
      return
    }
    /** Handles of the subscriptions that may be called confirmed; owned for cleanup. */
    const disposers: Disposer[] = []
    for (const { event, permission } of DECISION_EVENTS) {
      // The grant facade is the honest authorization state; undefined when the
      // host does not expose it (then nothing may be reported as confirmed).
      let granted: boolean | undefined
      /** The caller-safe grant facade, the only honest authorization source here. */
      const facade = host.grants
      if (facade !== undefined && typeof facade.allows === "function") {
        try {
          granted = facade.allows(scoped, permission, event) === true
        } catch {
          granted = undefined
        }
      }
      try {
        /** The host's handle; a no-op when the grant is missing, so it is never called as a probe. */
        const disposer = host.subscribeDecision(scoped, event, () => undefined, { scope: event, order: DECISION_ORDER })
        if (typeof disposer !== "function") {
          attempts.push({ event, state: "refused", reason: "subscribeDecision returned no disposer" })
          continue
        }
        if (granted === true) {
          // A grant plus a disposer is the only combination we may call confirmed.
          const release = disposer
          disposers.push(release)
          effectOn(scoped, () => release(), `mpd-tui decision ${event}`)
          attempts.push({ event, state: "confirmed", reason: `${permission} granted` })
        } else if (granted === false) {
          // Missing grant: the host had already returned a no-op disposer. The
          // disposer is NOT called as a probe; it is owned for cleanup only.
          const release = disposer
          effectOn(scoped, () => release(), `mpd-tui decision ${event} (refused)`)
          attempts.push({ event, state: "refused", reason: `no grant for ${permission}@${event}` })
        } else {
          /** This subscription's handle; owned for cleanup although its state is unknown. */
          const release = disposer
          effectOn(scoped, () => release(), `mpd-tui decision ${event} (unconfirmed)`)
          attempts.push({ event, state: "requested", reason: "grant state not queryable in this composition" })
        }
      } catch (error) {
        attempts.push({ event, state: "refused", reason: shortReason(error) })
      }
    }

    /** The intercept points that both a grant and a disposer backed. */
    const confirmed = attempts.filter((attempt) => attempt.state === "confirmed")
    /** The intercept points the host refused, with the reason it gave. */
    const refused = attempts.filter((attempt) => attempt.state === "refused")
    /** The refusal quoted in the aggregate detail; falls back to the first attempt. */
    const first = refused[0] ?? attempts[0]
    outcome =
      confirmed.length > 0
        ? { state: "confirmed", detail: `${confirmed.length}/${attempts.length} intercept point(s) registered` }
        : refused.length === attempts.length
          ? { state: "refused", detail: `${refused.length}/${attempts.length} refused — ${first?.reason ?? "unknown"}` }
          : { state: "requested", detail: `unconfirmed — ${first?.reason ?? "unknown"}` }

    if (confirmed.length > 0) {
      log.info(`decision-event seam ACTIVE for ${confirmed.length} intercept point(s); handlers express no opinion`)
    } else {
      // Logged ONCE for the whole seam, not once per event: a TUI boot must not
      // fill its log with the same expected refusal four times.
      log.warn(
        "decision-event seam is ready but NOT activated: tui.dsh/v1alpha1#DecisionEvents registration was refused " +
          `(first refusal: ${first?.reason ?? "unknown"}). No input/rewind/session-switch/compact interception is claimed.`,
      )
    }
  })

  return { outcome: () => outcome, attempts: () => attempts }
}

/** One short, sanitized reason string for the record (never a stack trace). */
function shortReason(error: unknown): string {
  /** The error's message, or its string form when it is not an Error. */
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/gu, " ").trim().slice(0, 160)
}
