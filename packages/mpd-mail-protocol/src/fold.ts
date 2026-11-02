// THE TOLERANT FOLD (contract §4/§5): turn an append-only mailbox log into the messages it proves.
//
// Tolerance is the invariant, not a nicety. A mailbox is one line per record, written by whichever
// plane got there first, so the fold meets: legacy rows with no `kind`, state rows for a message whose
// send line was torn, unknown record kinds (a cellwork `wake` row shares the unified file) and plainly
// malformed lines. NONE of them is fatal — a bad line costs that line, never the mailbox — and the fold
// reports what it skipped instead of swallowing it silently (I8, amended after review R1).
//
// THE TWO DECLARED POLICIES (I8, amended after R1's N1/N2): a duplicated send id keeps the FIRST
// write and reports the duplicate, because an append-only log must not rewrite a message an
// acknowledgement may already point at; and a `replyTo` naming no folded message is kept tolerant
// (the reply re-roots on its own id) but is REPORTED, never silently turned into a second thread.
//
// I7 lives here for the same reason: a reply without `threadId` inherits its `replyTo`'s thread, so the
// fold resolves every thread in ONE pass over the log, and no consumer has to walk a chain of rows.
// An explicit `threadId` naming no folded message is kept as declared and REPORTED (R1's F2).

import type { MailAnswer, MailKind, MailMessage, MailboxFold, MailQuestion } from "./types.ts"
import { isMailKind } from "./types.ts"
import { inheritedThreadId } from "./validate.ts"

/** The fold's working state: the messages opened so far, and the rows it had to skip. */
interface FoldState {
  /** Folded messages by id; a `Map` keeps the log's insertion order for the final array. */
  byId: Map<string, MailMessage>
  /** One line per anomaly the fold TOLERATED: a skipped row, an unresolved reference, a duplicate id. */
  problems: string[]
}

/**
 * Whether a runtime value is a non-null, non-array object.
 * @param value - the value to classify.
 * @returns true for a plain object, whose keys can be read with `Object.entries`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Read a row's field as text without throwing on a loose value.
 * @param value - the field read off a JSON row.
 * @returns the string itself; `""` for `undefined`/`null`; `String(value)` otherwise.
 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value
  return value === undefined || value === null ? "" : String(value)
}

/**
 * Read an optional payload only when the row carries an object there.
 * @param value - the field read off a JSON row.
 * @returns the object, or `undefined` for anything that is not a plain object.
 */
function objectOf(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

/**
 * Fold one `send` row into the growing state.
 *
 * The row's own id becomes its thread when no explicit or inherited thread exists (I7), an unknown
 * `kind` falls back to `message` with a problem recorded, and a payload that does not match the kind is
 * DROPPED rather than carried: a folded message must satisfy the envelope contract its kind implies,
 * or a reader would see a `message` row with a question payload and no rule saying what that means.
 *
 * The three DECLARED policies (I8, amended after R1): a duplicate id keeps the FIRST write and reports
 * the duplicate; an unresolvable `replyTo` re-roots the reply on its own id and reports it; an explicit
 * `threadId` naming no folded message (and not this row's own id) is kept and reported.
 * @param state - the fold's working state.
 * @param record - the `send` row, read as a loose object.
 * @param line - the row's 1-based position, for a problem a reader can find.
 */
function foldSend(state: FoldState, record: Record<string, unknown>, line: number): void {
  /** The message id: the one field a send row cannot do without, because state rows point at it. */
  const id = record.id
  if (typeof id !== "string" || id === "") {
    state.problems.push("line " + String(line) + ": a `send` row has no id, skipped")
    return
  }
  // R1's N2: first write wins. Rewriting an earlier message after a recipient acknowledged it would
  // silently change what the acknowledgement refers to, so the duplicate is ignored and REPORTED.
  if (state.byId.has(id)) {
    state.problems.push("line " + String(line) + ": duplicate `send` id " + JSON.stringify(id) + "; the FIRST write wins and this row is ignored")
    return
  }
  /** The raw kind field, kept so "absent" and "invalid" stay distinguishable in the report. */
  const kindValue: unknown = record.kind
  /** The resolved kind: a legacy row without `kind` folds as `message` (contract §5). */
  const kind: MailKind = isMailKind(kindValue) ? kindValue : "message"
  if (kindValue !== undefined && !isMailKind(kindValue)) {
    state.problems.push("line " + String(line) + ": unknown kind " + JSON.stringify(kindValue) + ", folded as `message`")
  }
  /** The message this row replies to, when the row names one. */
  const replyTo = typeof record.replyTo === "string" && record.replyTo !== "" ? record.replyTo : undefined
  /** The thread the sender claimed explicitly, when it is a usable id. */
  const statedThread = typeof record.threadId === "string" && record.threadId !== "" ? record.threadId : undefined
  /** The question payload, when the row carries an object there. */
  let question = objectOf(record.question) as MailQuestion | undefined
  /** The answer payload, when the row carries an object there. */
  let answer = objectOf(record.answer) as MailAnswer | undefined
  if (kind === "question" && question === undefined) {
    state.problems.push("line " + String(line) + ": a `question` row has no question payload")
  }
  if (kind === "answer" && answer === undefined) {
    state.problems.push("line " + String(line) + ": an `answer` row has no answer payload")
  }
  // A payload that does not belong to this kind is not carried: the folded row stays consistent with
  // the envelope contract its `kind` names, and the drop is REPORTED rather than silent.
  if (kind !== "question" && question !== undefined) {
    state.problems.push("line " + String(line) + ": a `" + kind + "` row carries a question payload, dropped")
    question = undefined
  }
  if (kind !== "answer" && answer !== undefined) {
    state.problems.push("line " + String(line) + ": a `" + kind + "` row carries an answer payload, dropped")
    answer = undefined
  }
  // R1's N1: the tolerant fallback stays (the reply re-roots on its own id), but the unresolved
  // reference is REPORTED — a silently re-rooted reply turns one thread into two with no trace.
  if (replyTo !== undefined && !state.byId.has(replyTo)) {
    state.problems.push("line " + String(line) + ": `replyTo` " + JSON.stringify(replyTo) + " names no folded message; the reply re-roots on its own id")
  }
  // R1's F2 / amended I7: an explicit thread id must name an already-folded message or this row's own
  // id. Tolerance is kept — the declared id is what the message carries — but a thread with no root is
  // reported instead of being minted silently.
  if (statedThread !== undefined && statedThread !== id && !state.byId.has(statedThread)) {
    state.problems.push("line " + String(line) + ": explicit `threadId` " + JSON.stringify(statedThread) + " names no folded message; kept as declared")
  }
  /** The thread id, resolved by I7; `undefined` means this message starts the thread. */
  const inherited = inheritedThreadId(
    {
      kind,
      ...(replyTo === undefined ? {} : { replyTo }),
      ...(statedThread === undefined ? {} : { threadId: statedThread }),
    },
    state.byId,
  )
  /** The folded message, with absent optionals left as absent keys so JSON round-trips unchanged. */
  const message: MailMessage = {
    id,
    kind,
    fromId: textOf(record.fromId),
    fromName: textOf(record.fromName),
    toId: textOf(record.toId),
    toName: textOf(record.toName),
    subject: textOf(record.subject),
    body: textOf(record.body),
    sentAt: textOf(record.at),
    threadId: inherited ?? id,
    ...(typeof record.teamId === "string" && record.teamId !== ""
      ? { teamId: record.teamId }
      : {}),
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(question === undefined ? {} : { question }),
    ...(answer === undefined ? {} : { answer }),
  }
  state.byId.set(id, message)
}

/**
 * Fold one `delivered` or `read` state row into the message it advances.
 *
 * A state row for an unknown message is SKIPPED with a problem: the log is append-only, so the only
 * legitimate reasons are a torn send line or a record from a different mailbox, and neither may cost
 * the rest of the fold. A `read` row's `by` is kept as `readBy`, the acking member contract §5 records.
 * @param state - the fold's working state.
 * @param record - the `delivered`/`read` row, read as a loose object.
 * @param line - the row's 1-based position, for a problem a reader can find.
 */
function foldStateRecord(state: FoldState, record: Record<string, unknown>, line: number): void {
  /** The message id this state row points at. */
  const id = record.id
  if (typeof id !== "string" || id === "") {
    state.problems.push("line " + String(line) + ": a `" + String(record.t) + "` row has no id, skipped")
    return
  }
  /** The folded message being advanced, when the log has already opened it. */
  const message = state.byId.get(id)
  if (message === undefined) {
    state.problems.push("line " + String(line) + ": a `" + String(record.t) + "` row references unfolded message " + JSON.stringify(id))
    return
  }
  if (record.t === "delivered") {
    message.deliveredAt = textOf(record.at)
    return
  }
  message.readAt = textOf(record.at)
  /** The name that acknowledged the row, when the record names one. */
  const by = record.by
  if (typeof by === "string" && by !== "") message.readBy = by
}

/**
 * Fold a mailbox log into its current messages.
 *
 * Rows are processed in file order — an append-only log is the one place a reply is guaranteed to
 * follow the message it references, which is what lets I7 resolve in one pass. Unknown record kinds and
 * malformed lines are tolerated exactly as described in this file's header, and every anomaly the fold
 * can SEE is reported (I8, amended after R1): skipped rows, unresolved `replyTo`/`threadId` references,
 * the first-wins duplicate policy and each dropped payload.
 * @param records - the parsed log rows, oldest first; a caller's torn trailing line may be included.
 * @returns the folded messages in insertion order, plus one problem line per tolerated anomaly.
 */
export function foldMail(records: readonly unknown[]): MailboxFold {
  /** The fold's working state. */
  const state: FoldState = { byId: new Map(), problems: [] }
  records.forEach((raw: unknown, index: number) => {
    if (!isPlainObject(raw)) {
      state.problems.push("line " + String(index + 1) + ": not a JSON object, skipped")
      return
    }
    if (raw.t === "send") {
      foldSend(state, raw, index + 1)
      return
    }
    if (raw.t === "delivered" || raw.t === "read") {
      foldStateRecord(state, raw, index + 1)
      return
    }
    // Any other record kind is a tolerated NON-message line: the unified log may also carry a cellwork
    // `wake` row, and ignoring it keeps the team view from reading an attempt as a message.
  })
  return { messages: [...state.byId.values()], problems: state.problems }
}
