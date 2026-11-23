import { isRecord, pendingHumanInput, type DshAdapter, type DshLiveAgent, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ChangeFeed } from "./change-feed.ts"
import type { WakeCondition, WakeMatch, WakeScope } from "./captain-wake-store.ts"

/** A read of the committed predicate, before any delivery or waiting decision. */
export type WakeEvaluation = { readonly match?: WakeMatch; readonly reason?: string; readonly ended?: true }

/** A process-local wait returns to the original tool call exactly once. */
export interface CaptainEventWaitResult {
  /** The exact team on which this wait was started. */
  readonly teamId: string
  /** Why the original call is continuing, with no durable wake side effect. */
  readonly state: "matched" | "steered" | "cancelled" | "unsupported" | "ended" | "disposed" | "failed"
  /** The matched task statuses or mail ID, with no mail or task prose. */
  readonly match?: WakeMatch
  /** Failure or release detail for the caller when the state alone is insufficient. */
  readonly reason?: string
}

/** A selected condition and any immediately sufficient state seen during setup. */
export type PreparedWakeCondition = { readonly condition: WakeCondition; readonly immediate?: WakeMatch }

/** Sources of events and durable state for one call, owned by the Team row. */
interface CaptainEventWaitInput {
  /** Exact target and scope verified before this waiter was started. */
  readonly agent: DshLiveAgent
  /** Captured session and workspace identity for the Team subscription. */
  readonly scope: WakeScope
  /** Durable board ID reported back to this tool call. */
  readonly teamId: string
  /** Original host execution supplies the per-call cancellation and turn closure. */
  readonly exec: DshToolExec
  /** Plugin lifetime is independent of the host execution signal. */
  readonly dispose: AbortSignal
  /** Subscribe to committed Team and original-agent events. */
  readonly dsh: Pick<DshAdapter, "onEvent">
  /** Observe durable board and mailbox commits in the requested workspace. */
  readonly feed: Pick<ChangeFeed, "subscribe">
  /** Confirm the host still identifies this live agent as the original captain. */
  readonly isCurrent: () => boolean
  /** Re-read and parse only after arming the listeners. */
  readonly prepare: () => PreparedWakeCondition
  /** Reconcile the predicate against the latest authoritative Team or mailbox record. */
  readonly evaluate: (condition: WakeCondition) => WakeEvaluation
  /** Log bounded failures without sending another turn. */
  readonly warn: (message: string) => void
}

/** Park the existing tool call on board/mail and host events, with no timeout or polling loop. */
export function awaitCaptainEvent(input: CaptainEventWaitInput): Promise<CaptainEventWaitResult> {
  return new Promise((resolve, reject) => {
    /** Every subscription belongs to this one promise, never a resumed session. */
    const disposers: Array<() => void> = []
    /** The condition is initialized only after the events that can satisfy or stop it are armed. */
    let prepared: PreparedWakeCondition | undefined
    /** The first final condition or competing event wins. */
    let settled = false
    /** Remove hooks before exposing the result, including exceptional setup and cleanup. */
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      for (const off of disposers) {
        try { off() } catch (error) { input.warn(`captain event wait cleanup: ${error instanceof Error ? error.message : String(error)}`) }
      }
      settle()
    }
    /** Distinguish a matching result from overlapping human or lifecycle events. */
    const outcome = (state: CaptainEventWaitResult["state"], detail: Pick<CaptainEventWaitResult, "reason" | "match"> = {}): void => {
      finish(() => { resolve({ teamId: input.teamId, state, ...detail }) })
    }
    /** A cancelled tool leaves its inbox and durable wake registrations untouched. */
    const cancelled = (): void => { outcome("cancelled", { reason: "the original tool call was aborted" }) }
    /** A disposed row or scoped agent cannot continue the pending execution. */
    const disposed = (): void => { outcome("disposed", { reason: "the waiting captain or Team row was disposed" }) }
    /** Evaluate real committed state and the host's pending human input, never event text. */
    const check = (): void => {
      if (settled || prepared === undefined) return
      try {
        if (input.dispose.aborted) { disposed(); return }
        if (input.exec.signal?.aborted === true) { cancelled(); return }
        if (!input.isCurrent()) { disposed(); return }
        /** Older hosts without these inbox snapshots can read an already-complete condition only. */
        const human = pendingHumanInput(input.agent)
        if (human === "step" || human === "turn") {
          if (human === "turn" && typeof input.exec.concludeTurn === "function") {
            // Keep next-turn input queued in the host. Its own turn boundary admits it.
            try { input.exec.concludeTurn() } catch (error) { input.warn(`captain event wait could not conclude turn: ${error instanceof Error ? error.message : String(error)}`) }
          }
          outcome("steered", { reason: "human input is pending in the original captain inbox" })
          return
        }
        /** A close, tab recreation or a newer board commit may supersede setup's initial read. */
        const current = input.evaluate(prepared.condition)
        /** An admissible unread mail snapshot or newly matched task returns without a wake. */
        const match = prepared.immediate ?? current.match
        if (match !== undefined) outcome("matched", { match })
        else if (current.reason !== undefined) outcome(current.ended === true ? "ended" : "failed", { reason: current.reason })
      } catch (error) {
        outcome("failed", { reason: error instanceof Error ? error.message : String(error) })
      }
    }
    try {
      disposers.push(input.feed.subscribe(input.scope.workspace, check))
      /** A scoped inbox event is only a wake signal for the original Agent object. */
      const offInbox = input.dsh.onEvent?.("agent/inbox/inserted", (event) => {
        if (isRecord(event) && event.agent === input.agent) check()
      })
      if (typeof offInbox === "function") disposers.push(offInbox)
      /** The individual session may close while the Team row stays mounted. */
      const offAgent = input.dsh.onEvent?.("agent/disposed", (event) => {
        if (isRecord(event) && event.agent === input.agent) disposed()
      })
      if (typeof offAgent === "function") disposers.push(offAgent)
      /** Attach cancellation before the initial recheck. */
      const signal = input.exec.signal
      if (signal !== undefined) {
        signal.addEventListener("abort", cancelled, { once: true })
        disposers.push((): void => { signal.removeEventListener("abort", cancelled) })
      }
      input.dispose.addEventListener("abort", disposed, { once: true })
      disposers.push((): void => { input.dispose.removeEventListener("abort", disposed) })
      prepared = input.prepare()
      check()
      if (!settled && (signal === undefined || typeof offInbox !== "function" || typeof offAgent !== "function"
        || pendingHumanInput(input.agent) === undefined || input.agent.status !== "running")) {
        outcome("unsupported", { reason: "this host cannot safely keep the original running turn steerable and cancellable; use a durable arm after ending the turn" })
      }
    } catch (error) {
      finish(() => { reject(error) })
    }
  })
}
