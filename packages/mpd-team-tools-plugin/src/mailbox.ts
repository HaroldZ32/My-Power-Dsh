// The mailbox arithmetic, kept pure so the count is unit-testable.
//
// "Unread" here is the HARNESS's own notion, not an estimate: the agent inbox emits
// `agent/inbox/inserted` when a message ENTERS, `agent/inbox/claimed` when the loop takes it, and
// `agent/inbox/discarded` when it is dropped — all three dispatched through the AGENT's scope
// carrier (their `dsh-scope` subject resolver is `args[0]["agent"]`). So
// `inserted − claimed − discarded` is "waiting, not yet taken".

/** The three counters one agent's inbox is folded into. */
export interface InboxCounts {
  inserted: number
  claimed: number
  discarded: number
}

/** A fresh counter. */
export function emptyCounts(): InboxCounts {
  return { inserted: 0, claimed: 0, discarded: 0 }
}

/** The three event names this module understands, in the order it documents them. */
export const INBOX_EVENTS = ["agent/inbox/inserted", "agent/inbox/claimed", "agent/inbox/discarded"] as const

/**
 * Fold one observed event into the counters.
 *
 * @param counts - the current counters.
 * @param event - the event name; anything else is ignored, so a caller may subscribe broadly.
 * @returns NEW counters (the input is never mutated).
 */
export function applyInboxEvent(counts: InboxCounts, event: string): InboxCounts {
  if (event === "agent/inbox/inserted") return { ...counts, inserted: counts.inserted + 1 }
  if (event === "agent/inbox/claimed") return { ...counts, claimed: counts.claimed + 1 }
  if (event === "agent/inbox/discarded") return { ...counts, discarded: counts.discarded + 1 }
  return counts
}

/**
 * The number of messages waiting.
 *
 * Clamped at zero: a mailbox can be observed starting mid-life (a session that was already running
 * when this row attached), and a NEGATIVE count would be a worse lie than a low one.
 */
export function unreadOf(counts: InboxCounts): number {
  return Math.max(0, counts.inserted - counts.claimed - counts.discarded)
}
