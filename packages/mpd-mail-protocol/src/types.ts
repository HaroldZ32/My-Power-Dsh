// THE MAIL PROTOCOL'S SHARED VOCABULARY (frozen contract `.mpd/plans/mail-unify.md`, §4).
//
// ONE durable stream carries every agent-to-agent message, and `kind` says whether a row is a plain
// message, a question, or the answer to one. THERE IS NO INDEX FIELD ANYWHERE: an answer repeats the
// offered label STRINGS verbatim, so nothing downstream has to count options. That is the mechanical
// fix for the relay defect measured on 2026-10-31, where a model-composed "option number" drifted
// between the asker, the panel and the answer.
//
// The package is PURE: types, validators, a label-echo check and a tolerant fold. No I/O, no cordis
// row, no runtime dependency. Both the team mailbox and the cellwork view import these rules, so the
// two planes cannot disagree about what a valid question or answer is.

/** The three kinds a durable mail row can carry; `message` is the legacy default. */
export type MailKind = "message" | "question" | "answer"

/** The protocol's kinds in display order, so a validator or a renderer never hard-codes a list. */
export const MAIL_KINDS: readonly MailKind[] = ["message", "question", "answer"]

/**
 * Whether a runtime value names one of the three protocol kinds.
 * @param value - the value to test, typically a field read off a loose JSON row.
 * @returns true exactly for `message`, `question` and `answer`.
 */
export function isMailKind(value: unknown): value is MailKind {
  return value === "message" || value === "question" || value === "answer"
}

/**
 * Every index-shaped field name the protocol REFUSES (I1), the ENUMERATED denylist.
 *
 * The names are listed rather than pattern-matched on purpose: `selected` and `options` are the only
 * carriers of a choice, and a field whose name implies a position is exactly the relay defect the
 * protocol exists to kill. {@link findIndexFields} scans a payload for these names at any depth.
 *
 * THE BOUND (amended contract §4 I1 after review R1's N6): this is an ENUMERATED denylist plus the
 * compile-time constant below, not a proof over every possible spelling. A positional field under
 * another name (`position`, `choice`, `idx`) is not detected, and the compile-time proof sees only
 * fields a payload SHAPE declares. Containment comes from the two writers: the mailbox fold's field
 * whitelist drops unknown keys before a reader sees them, and the mail tool schemas declare
 * `additionalProperties: false`, so an unknown key cannot be authored through a tool. The package
 * README states the same boundary; it is a DECLARED residual, never an implied absolute.
 */
export const INDEX_FIELD_NAMES: readonly string[] = [
  "index",
  "indexes",
  "indices",
  "optionIndex",
  "optionIndices",
  "selectedIndex",
  "selectedIndices",
  "optionNumber",
  "optionNumbers",
]

/** The literal union of {@link INDEX_FIELD_NAMES}, so the compile-time proof can test each payload. */
export type IndexFieldName =
  | "index"
  | "indexes"
  | "indices"
  | "optionIndex"
  | "optionIndices"
  | "selectedIndex"
  | "selectedIndices"
  | "optionNumber"
  | "optionNumbers"

/**
 * The compile-time half of I1: `true` when a payload shape declares no index-shaped field.
 *
 * A payload that grows `index` (or any sibling in {@link IndexFieldName}) evaluates to `false`, so the
 * assertion below stops type-checking. The rule is therefore enforced by the compiler as well as by
 * the runtime scan, and a future edit cannot quietly reintroduce the field.
 */
export type HasNoIndexField<T> = Extract<keyof T, IndexFieldName> extends never ? true : false

/**
 * The compile-time assertion that NO protocol payload carries an index field.
 *
 * The runtime value is `true`; the point is its TYPE. If {@link MailEnvelope}, {@link MailOption},
 * {@link MailQuestion}, {@link MailAnswer}, {@link MailSendRecord} or {@link MailMessage} gains an
 * index-shaped key — INCLUDING a key the record types add beside the envelope, which R1's N6 called
 * out — this declaration no longer type-checks. The compiler reddens instead of a comment claiming
 * I1 still holds.
 */
export const MAIL_PAYLOADS_CARRY_NO_INDEX: HasNoIndexField<MailEnvelope> &
  HasNoIndexField<MailOption> &
  HasNoIndexField<MailQuestion> &
  HasNoIndexField<MailAnswer> &
  HasNoIndexField<MailSendRecord> &
  HasNoIndexField<MailMessage> = true

/**
 * One selectable option of a question.
 *
 * The documented label convention is an ordinal PREFIX the option carries itself: `"A. Unify the
 * stores"`, `"B. Keep both stores"` or `"1) Unify the stores"`. The ordinal is presentation, not
 * state: nothing parses it back, and an answer echoes the whole label string. {@link ordinalPrefix}
 * produces the canonical spelling for a zero-based index.
 */
export interface MailOption {
  /** The option's text: non-empty, unique within its question, and echoed VERBATIM by an answer. */
  label: string
  /** An optional one-line consequence, shown beside the label and never part of the echo. */
  description?: string
}

/**
 * A question payload: the options offered and whether more than one may be selected.
 *
 * `questionId` is stable for the question's whole life, including its fan-out: every recipient of a
 * broadcast carries the SAME `questionId`, so an answer names the question without naming a row.
 */
export interface MailQuestion {
  /**
   * Stable identity of the question across the fan-out and the answer that references it.
   *
   * REQUIRED and non-empty (I2/I5, amended after R1's F1): it is the correlation key every answer
   * copies, so an empty key would make every answer unattributable.
   */
  questionId: string
  /** An optional short heading, for a renderer that prints one line above the question text. */
  header?: string
  /** The question text itself; non-empty, and the same text on every fan-out row. */
  question: string
  /** At least one option; every label is non-empty and unique within this question (I2). */
  options: MailOption[]
  /** `true` when several labels may be selected; absent or `false` means exactly one (I3). */
  multiSelect?: boolean
}

/**
 * An answer payload: label STRINGS selected verbatim from the question, plus optional free text.
 *
 * There is deliberately no index field: `selected` holds the offered labels themselves (I1/I4), so a
 * mismatch is a string mismatch the validator can name, never a position that drifted.
 */
export interface MailAnswer {
  /**
   * The answered question's stable id, copied from its `question` payload.
   *
   * REQUIRED, non-empty, and — whenever the referenced question is resolvable — EQUAL to that
   * question's `questionId` (I5, amended after R1's F1). A wrong key would pass every other rule and
   * silently void the answer, so the copy is enforced rather than documented.
   */
  questionId: string
  /** The message id of the `question` row this answers; it must reference a question (I5). */
  answerTo: string
  /** The offered labels selected, echoed EXACTLY; an unknown label is refused with the valid list. */
  selected: string[]
  /**
   * Free-form text for a case no offered option covers.
   *
   * On a single-select answer it is allowed ALONE, replacing the one label; label PLUS custom is
   * refused (I3, amended after R1's N5). On a multi-select it may accompany at least one label.
   */
  custom?: string
}

/**
 * The envelope fields every durable row carries, whatever its kind.
 *
 * A legacy row written before this protocol existed has no `kind`; the fold reads it as `"message"`.
 */
export interface MailEnvelope {
  /** Which payload shape this row carries; a `message` row carries neither question nor answer. */
  kind: MailKind
  /** The message id this row replies to, when it replies to one (I5/I7). */
  replyTo?: string
  /** The thread id — its first message id; a reply without one inherits `replyTo`'s thread (I7). */
  threadId?: string
  /** Present exactly on a `question` row. */
  question?: MailQuestion
  /** Present exactly on an `answer` row. */
  answer?: MailAnswer
}

/**
 * The stable code of one validation failure.
 *
 * Codes exist so a caller can branch on a rule without matching prose: `index-field` is I1,
 * `question-empty`/`question-id`/`option-label` are I2, `answer-selection` is I3,
 * `answer-unknown-label` is I4, `reference-unknown`/`reference-not-question`/
 * `question-payload-missing` and `answer-question-id` (the required, non-empty, EQUAL correlation
 * key) are I5, and
 * `kind-payload`/`envelope` are structural.
 */
export type MailProblemCode =
  | "envelope"
  | "index-field"
  | "kind-payload"
  | "question-empty"
  | "question-id"
  | "option-label"
  | "answer-selection"
  | "answer-unknown-label"
  | "answer-question-id"
  | "reference-unknown"
  | "reference-not-question"
  | "question-payload-missing"

/** One refused rule: a stable code, the human-readable reason, and the valid labels when I4 names them. */
export interface MailProblem {
  /** The rule that failed, so a caller never parses the message text. */
  code: MailProblemCode
  /** One sentence naming what was wrong, in the terms the sender used. */
  message: string
  /** The full valid label list, carried by I4's mismatch so the sender can correct without guessing. */
  labels?: string[]
}

/** The discriminated result of every validator: no problems, or the complete list of them. */
export type MailCheck = { ok: true } | { ok: false; problems: MailProblem[] }

/** One resolvable recipient of a fan-out: the identity a row is addressed to, plus its display name. */
export interface MailAddress {
  /** The recipient's stable id; a broadcast never mints two rows for one id. */
  id: string
  /** The recipient's display name at send time, kept on the row so a reader needs no roster lookup. */
  name: string
}

/**
 * One `send` line of the mailbox log, as the protocol shapes it.
 *
 * I6 is structural: there is NO multi-recipient row. A broadcast is a FAN-OUT of these rows, one per
 * recipient with the same `questionId` and `threadId`, so per-recipient ack and the undelivered bound
 * stay meaningful. {@link fanOutTargets} plans the recipients; the caller mints one row each.
 */
export interface MailSendRecord extends MailEnvelope {
  /** Discriminator: this log line opens a message (the fold's only row-creating record). */
  t: "send"
  /** Message id, unique within the mailbox; delivered/read rows point at it. */
  id: string
  /** Sender's session id, so the row reads without trusting a display name. */
  fromId: string
  /** Sender's display name at send time. */
  fromName: string
  /** Recipient's session id. */
  toId: string
  /** Recipient's display name at send time; a later rename never rewrites history. */
  toName: string
  /** One-line subject, carried verbatim. */
  subject: string
  /** The full body, carried verbatim. */
  body: string
  /** ISO instant the row was written. */
  at: string
  /** The team or cell stamp that scopes the row, when the writer records one. */
  teamId?: string
}

/**
 * One folded message: the send row's addressing, its envelope and the state the log proves.
 *
 * `threadId` is always present here (the fold resolves I7), so a renderer or a view never re-derives
 * it. Optional keys are ABSENT when the log never carried them, never present as `undefined`, so a
 * `JSON.stringify` round-trip of a folded message is stable.
 */
export interface MailMessage extends MailEnvelope {
  /** Message id, unique within the mailbox. */
  id: string
  /** Sender's session id. */
  fromId: string
  /** Sender's display name at send time. */
  fromName: string
  /** Recipient's session id. */
  toId: string
  /** Recipient's display name at send time. */
  toName: string
  /** One-line subject. */
  subject: string
  /** The full body, verbatim. */
  body: string
  /** ISO instant the `send` row was written. */
  sentAt: string
  /** The team or cell stamp carried by the send row, when it had one. */
  teamId?: string
  /**
   * The thread id, RESOLVED by the fold: explicit, inherited through `replyTo`, or the message's own id.
   *
   * An explicit value that names NO already-folded message (and is not this row's own id) is KEPT as
   * declared — tolerance is never a throw — and the fold reports it in {@link MailboxFold.problems}
   * (I7, amended after R1's F2), so a thread without a root is diagnosable rather than silent.
   */
  threadId: string
  /** ISO instant the transport accepted the row; absent means it is still queued. */
  deliveredAt?: string
  /** ISO instant the row was acknowledged; absent means it is unread. */
  readAt?: string
  /** The name that acknowledged the row, when its `read` record carried one (contract §5). */
  readBy?: string
}

/** The folded state of a mailbox log: its messages in insertion order, plus the anomalies it reports. */
export interface MailboxFold {
  /** Folded messages in log order, each carrying its own resolution and acknowledgement state. */
  messages: MailMessage[]
  /**
   * One line per anomaly the fold TOLERATED (I8, amended after R1's N1/N2): a malformed row, a
   * `replyTo` naming no folded message, an explicit `threadId` with no root, a duplicate send id
   * (FIRST write wins, declared) and every payload dropped because its kind does not carry it.
   * Never fatal, so a torn log still folds; never silent, so a torn log stays diagnosable.
   */
  problems: string[]
}
