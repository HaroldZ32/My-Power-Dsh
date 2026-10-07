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
import type { PluginContextLike, SeamOutcome, TuiAdapter, TuiDecisionSubscription } from "./types.js"
import type { Log } from "./log.js"

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
 *
 * EVERY verdict is derived from the adapter's measured facts (`granted()`, `disposerReturned()`,
 * `error()`, `supported()`) rather than from a disposer's TYPE, which is the whole point of this
 * seam: the host answers a refusal with a no-op disposer, so a returned function is not proof.
 * The attempts are recomputed on read, so the seam reports the truth whether the host bound before
 * or after this row applied.
 * @param ctx - the plugin context; the host records it as each subscription's identity.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @returns the seam handle; `attempts()` carries the per-event verdict.
 */
export function attemptDecisionEvents(ctx: PluginContextLike, tui: TuiAdapter, log: Log): DecisionSeam {
  /** One subscription attempt per intercept point, in declaration order. */
  const subs: { event: string; permission: string; sub: TuiDecisionSubscription }[] = DECISION_EVENTS.map(({ event, permission }) => ({
    event,
    permission,
    sub: tui.requestDecisionEvent(event, () => undefined, { scope: event, order: DECISION_ORDER, identity: ctx }),
  }))

  /** The intercept point whose mediated member the host does not carry, when there is one. */
  const unsupported = (): { event: string; permission: string; sub: TuiDecisionSubscription } | undefined =>
    subs.find(({ sub }) => sub.outcome().state !== "absent" && !sub.supported())

  /** Whether the seam never bound at all (no host composition, nothing claimed). */
  const unbound = (): boolean => subs.every(({ sub }) => sub.outcome().state === "absent")

  /** The per-event verdicts, derived from the adapter's measured facts. */
  const attempts = (): readonly DecisionAttempt[] => {
    if (unsupported() !== undefined || unbound()) return []
    return subs.map(({ event, permission, sub }): DecisionAttempt => {
      /** The adapter's measured facts for this one subscription. */
      const thrown = sub.error()
      if (thrown !== undefined) return { event, state: "refused", reason: thrown }
      if (!sub.disposerReturned()) return { event, state: "refused", reason: "subscribeDecision returned no disposer" }
      /** The grant facade's answer; undefined when the host cannot be asked. */
      const granted = sub.granted()
      if (granted === true) return { event, state: "confirmed", reason: `${permission} granted` }
      if (granted === false) return { event, state: "refused", reason: `no grant for ${permission}@${event}` }
      return { event, state: "requested", reason: "grant state not queryable in this composition" }
    })
  }

  /** The aggregate result, as the boot diagnostic reports it. */
  const outcome = (): SeamOutcome => {
    /** The intercept point whose mediated member is missing, if any. */
    const missing = unsupported()
    if (missing !== undefined) return { id: missing.sub.outcome().id, state: "refused", detail: `${missing.sub.outcome().detail ?? "subscribeDecision is missing"}` }
    if (unbound()) return { id: subs[0]?.sub.outcome().id ?? "", state: "absent", detail: "the mediated plugin host was not injected" }
    /** The verdicts of this read. */
    const measured = attempts()
    /** The intercept points that both a grant and a disposer backed. */
    const confirmed = measured.filter((attempt) => attempt.state === "confirmed")
    /** The intercept points the host refused, with the reason it gave. */
    const refused = measured.filter((attempt) => attempt.state === "refused")
    /** The refusal quoted in the aggregate detail; falls back to the first attempt. */
    const first = refused[0] ?? measured[0]
    /** The service id the outcome reports on, taken from the adapter's own handle. */
    const id = subs[0]?.sub.outcome().id ?? ""
    if (confirmed.length > 0) return { id, state: "confirmed", detail: `${confirmed.length}/${measured.length} intercept point(s) registered` }
    if (refused.length === measured.length) return { id, state: "refused", detail: `${refused.length}/${measured.length} refused — ${first?.reason ?? "unknown"}` }
    return { id, state: "requested", detail: `unconfirmed — ${first?.reason ?? "unknown"}` }
  }

  /** The disclosure the seam owes a user: stated ONCE per boot, never once per event. */
  const disclose = (): string | undefined => {
    /** The verdicts of this read. */
    const measured = attempts()
    if (measured.length === 0) return undefined
    /** The intercept points that both a grant and a disposer backed. */
    const confirmed = measured.filter((attempt) => attempt.state === "confirmed")
    if (confirmed.length > 0) {
      log.info(`decision-event seam ACTIVE for ${confirmed.length} intercept point(s); handlers express no opinion`)
      return undefined
    }
    // Logged ONCE for the whole seam, not once per event: a TUI boot must not fill its log with
    // the same expected refusal four times.
    /** The refusal quoted in the disclosure. */
    const first = measured.find((attempt) => attempt.state === "refused") ?? measured[0]
    log.warn(
      "decision-event seam is ready but NOT activated: tui.dsh/v1alpha1#DecisionEvents registration was refused " +
        `(first refusal: ${first?.reason ?? "unknown"}). No input/rewind/session-switch/compact interception is claimed.`,
    )
    return first?.reason
  }
  // The disclosure is emitted when the seam BINDS (immediately, when the host was already
  // composed), which is exactly when the original activation ran it. A seam that never binds
  // discloses nothing, because nothing was attempted.
  tui.whenBound("pluginHost", () => {
    disclose()
  })

  return { outcome, attempts }
}
