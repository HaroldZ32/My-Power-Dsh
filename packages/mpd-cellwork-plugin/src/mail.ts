// CELLWORK MAIL — the cell's VIEW over the ONE workspace mailbox (contract §6; wave `mail-unify`).
//
// WHERE THE ROWS LIVE NOW. `cellwork_send` writes into `<ws>/.mpd/team/mailbox.jsonl` — the SAME
// durable stream the team plane uses — through the team store's `sendMany` (atomic fan-out: every rule
// runs before the first append). Every cellwork row is stamped with the cell's `teamId` (contract §6)
// and with an additive `cellId` the CELL VIEW scopes by; `fromCell` keeps a cross-cell sender, exactly
// as before. The team fold projects `cellId`/`fromCell`/`fromMemberId` onto the folded message, but the
// view still filters the RAW records first, so it stays correct if that projection changes.
//
// THE OLD LOG STAYS READABLE (contract §12). A cell's pre-unification `<cell>/mail.jsonl` is still read
// and merged into the view; an acknowledgement for one of its rows is appended back to THAT log, while a
// unified row is acknowledged through the store's ownership-checked `markRead`.
//
// DELIVERY IS BEST-EFFORT, DURABILITY IS NOT (D6). `sendMany` writes the row(s) first; a wake-up is
// then attempted per row and its outcome appended as a `wake` record AFTER the durable row. A row whose
// wake-up failed stays UNREAD and is surfaced on `cellwork_supervise` — mail is durable, wake is
// best-effort. `deliverCellMail` remains the ONE seam that expresses that order and is still exercised
// directly; the tool path hands it an already-durable append, because the store owns the write.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { acknowledge, appendRecord, fold as foldMailbox, mailboxPath, readMailbox, readRecords } from "../../mpd-team-core-plugin/src/mailbox-store"
import type { MailAck, MailMessage as TeamMailMessage, MailSendLine } from "../../mpd-team-core-plugin/src/mailbox-store"
import type { MailAnswer, MailKind, MailQuestion } from "../../mpd-mail-protocol/src/index"
import { cellDir } from "./state"
import { nameKey } from "./dispatch"

/** The mail log's file name inside one cell directory. */
export const CELL_MAIL_FILE = "mail.jsonl"

/** One `send` record as the CELL VIEW exposes it: the cell words plus the protocol envelope. */
export interface CellMailSend {
  /** Discriminator: this record opens a message. */
  t: "send"
  /** Message id, unique inside the workspace mailbox. */
  id: string
  /** The cell the row belongs to; the view scopes by this and the store never interprets it. */
  cellId: string
  /** The sender's cell seat name (`captain`, `cell-planner`, …). */
  from: string
  /** The sender's CELL id, on a cross-cell row. */
  fromCell?: string
  /** The recipient's cell seat name, as addressed. */
  to: string
  /** One-line subject. */
  subject: string
  /** The body as stored; bounded at the shared 4000-char write bound (W4-A6b). */
  body: string
  /** Whether the body was cut at the store's bound; the pre-cut text is NOT kept. */
  truncated?: boolean
  /** The body's length BEFORE the cut, recorded only when {@link truncated} is true. */
  originalLength?: number
  /** ISO instant the row was written. */
  at: string
  /**
   * Whether the row claims a wake-up happened when it was written.
   *
   * Always `false` on a row written by this build: the `wake` record that follows is what a fold
   * trusts. A legacy row may carry `true`, and folding keeps it when no wake record exists.
   */
  wakeSent: boolean
  /** A legacy wake-up refusal spelling, when the row predates the `wake` record. */
  wakeReason?: string
  /** Which protocol envelope this row carries; absent reads as `message` (legacy rows). */
  kind?: MailKind
  /** The message id this row replies to (I5/I7). */
  replyTo?: string
  /** The thread id, when the writer stated one; the fold resolves inheritance (I7). */
  threadId?: string
  /** Present exactly on a `question` row. */
  question?: MailQuestion
  /** Present exactly on an `answer` row. */
  answer?: MailAnswer
  /** The team this row was sent for, stamped by the store so the team plane can scope by identity. */
  teamId?: string
  /** The sender's session id, when known; recorded so the team plane owns the row correctly. */
  fromId?: string
  /** The recipient's session id, when known; the store's ownership check reads it. */
  toId?: string
  /** The sender's ROSTER/seat identity, when it has one (the ownership rules accept either spelling). */
  fromMemberId?: string
}

/**
 * One `wake` record: what happened to the wake-up, appended AFTER the durable `send` row (D6).
 *
 * This is the byte-for-byte TWIN of team-core's `MailWakeLine` (contract §5): one `wake` vocabulary for
 * both planes, `{t:"wake", id, sent, reason?, at}`, with `reason` required whenever `sent` is false.
 *
 * A separate record on purpose — the log is append-only, so a row written before the attempt cannot
 * carry the attempt's outcome. A message with NO `wake` record is one whose wake-up was never attempted
 * (the process stopped between the two appends), which `wakeFailures` reports as undelivered.
 */
export interface CellMailWake {
  /** Discriminator: this record reports one wake-up attempt. */
  t: "wake"
  /** The message the attempt was for. */
  id: string
  /** Whether the transport accepted the wake-up. */
  sent: boolean
  /** Why it did not, when it did not. */
  reason?: string
  /** ISO instant of the attempt. */
  at: string
}

/** One `read` record: the recipient's acknowledgement. */
export interface CellMailRead {
  /** Discriminator: this record acknowledges a message. */
  t: "read"
  /** The message this acknowledgement belongs to. */
  id: string
  /** The name that acknowledged it. */
  by: string
  /** ISO instant of the acknowledgement. */
  at: string
}

/** One line of the cell mail log. */
export type CellMailRecord = CellMailSend | CellMailRead | CellMailWake

/** One folded message: the view's `send` plus its acknowledgement and wake state. */
export interface CellMailMessage extends CellMailSend {
  /** Whether the recipient acknowledged it. */
  read: boolean
  /** The name that acknowledged it, when the `read` record carried one. */
  readBy?: string
}

/** The outcome of one acknowledgement batch: rows moved through the store and rows moved via legacy append. */
export interface CellAckResult {
  /** The ids that moved from unread to read, in request order (store rows, then legacy rows). */
  moved: string[]
  /** The subset that a LEGACY `mail.jsonl` acknowledgement moved. */
  legacy: string[]
  /**
   * The rows the store REFUSED to acknowledge, each with the sentence that says who owns it (T9/N1).
   *
   * WHY IT IS CARRIED OUT (T9/N1): the store has always refused a foreign acknowledgement, but the cell
   * plane dropped that list, so a seat saw `acknowledged: 0` with the same rows back and no reason. The
   * refusal is the whole diagnosis — the row is addressed to a different identity — so it is returned
   * verbatim instead of being reduced to a count.
   */
  refused: Array<{ id: string; reason: string }>
}

/** The absolute path of one cell's LEGACY mail log (migration read; new rows go to the mailbox). */
export function cellMailPath(workspace: string, cellId: string): string {
  return join(cellDir(workspace, cellId), CELL_MAIL_FILE)
}

/** The workspace mailbox every plane now writes to. */
export function cellMailboxPath(workspace: string): string {
  return mailboxPath(workspace)
}

/**
 * Mint one message id: the instant plus a per-process counter, so two messages in one millisecond differ.
 * @param now - the instant to stamp.
 * @param sequence - the caller's per-process counter.
 * @returns the id.
 */
export function mailId(now: Date, sequence: number): string {
  return "cellmail-" + now.toISOString().replace(/[-:.TZ]/g, "") + "-" + String(sequence)
}

/**
 * The id the store's next `send` would mint — used ONLY to default a question's `questionId`.
 *
 * The team store owns message ids and mints them inside `sendMany`, so a caller that needs the id
 * BEFORE the write (a question's `questionId` defaults to the row's own id, contract §6) cannot ask it
 * for one. This mirrors the store's stem and sequence exactly; it is a pre-flight READ, never a write.
 * @param workspace - the workspace whose mailbox is being read.
 * @param now - the clock the store will mint with.
 * @returns the id the next appended send row will carry.
 */
export function nextCellMailId(workspace: string, now: Date): string {
  /** The store's id stem: the UTC instant to the second, punctuation stripped. */
  const stem = "mail-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-"
  /** Rows already in the mailbox; the store sequences from this count. */
  const count = readMailbox(workspace).messages.length
  return stem + String(count + 1).padStart(3, "0")
}

/**
 * Read one field as text without throwing on a loose value.
 * @param value - the field read off a JSON row.
 * @returns the string itself; `""` for `undefined`/`null`; `String(value)` otherwise.
 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value
  return value === undefined || value === null ? "" : String(value)
}

/**
 * Whether a value is a non-null, non-array object.
 * @param value - the value to classify.
 * @returns true for a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Append one record to one cell's LEGACY log (migration acks only; new mail goes to the mailbox).
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose legacy log is appended.
 * @param record - the record to append.
 * @returns true when the line reached the file.
 */
function appendLegacyCellMail(workspace: string, cellId: string, record: CellMailRecord): boolean {
  try {
    mkdirSync(cellDir(workspace, cellId), { recursive: true })
    appendFileSync(cellMailPath(workspace, cellId), JSON.stringify(record) + "\n", "utf8")
    return true
  } catch {
    return false
  }
}

/**
 * Append one record to the WORKSPACE mailbox, stamped with this cell's `cellId`.
 *
 * The stamp is the view's scope and is inert to the team plane; `teamId` (when the caller carries one)
 * is the contract §6 identity the team plane scopes by. The store exposes no `wake` variant, so the
 * cast is required: a `wake` row is a cellwork-only line the protocol fold tolerates as a foreign kind.
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell the row belongs to.
 * @param record - the record to append.
 * @returns true when the line reached the file.
 */
export function appendCellMail(workspace: string, cellId: string, record: CellMailRecord): boolean {
  try {
    appendRecord(workspace, { ...record, cellId } as unknown as Parameters<typeof appendRecord>[1])
    return true
  } catch {
    return false
  }
}

/**
 * Normalize one raw line (legacy or unified) into a `CellMailRecord`.
 *
 * Unified rows carry the team words (`fromName`/`toName`/`sentAt`) while legacy rows carry the cell
 * words (`from`/`to`/`at`); both are mapped onto the cell words so ONE fold reads either. The protocol
 * envelope fields are carried through verbatim; their validation is the store's job at send time, not
 * this read path's.
 * @param value - the parsed JSON line.
 * @param cellId - the cell the line was read for (used when the line carries none).
 * @returns the normalized record, or undefined for an unknown/malformed line.
 */
function normalizeRawRecord(value: unknown, cellId: string): CellMailRecord | undefined {
  if (!isObject(value)) return undefined
  /** The message id; without one no record can be joined to a message. */
  const id = textOf(value.id)
  if (id === "") return undefined
  if (value.t === "read") {
    return { t: "read", id, by: textOf(value.by), at: textOf(value.at) }
  }
  if (value.t === "wake") {
    return {
      t: "wake",
      id,
      sent: value.sent === true,
      ...(typeof value.reason === "string" && value.reason !== "" ? { reason: value.reason } : {}),
      at: textOf(value.at),
    }
  }
  if (value.t !== "send") return undefined
  /** The question payload, only when the row carries an object there. */
  const question = isObject(value.question) ? value.question as unknown as MailQuestion : undefined
  /** The answer payload, only when the row carries an object there. */
  const answer = isObject(value.answer) ? value.answer as unknown as MailAnswer : undefined
  /** The protocol kind, when the row carries a known one. */
  const kind: MailKind | undefined = value.kind === "message" || value.kind === "question" || value.kind === "answer" ? value.kind : undefined
  /** The cell word for the sender, falling back to the unified spelling on a unified row. */
  const from = textOf(value.from) === "" ? textOf(value.fromName) : textOf(value.from)
  /** The cell word for the recipient, on the same fallback. */
  const to = textOf(value.to) === "" ? textOf(value.toName) : textOf(value.to)
  return {
    t: "send",
    id,
    cellId: textOf(value.cellId) === "" ? cellId : textOf(value.cellId),
    from,
    to,
    subject: textOf(value.subject),
    body: textOf(value.body),
    at: textOf(value.at) === "" ? textOf(value.sentAt) : textOf(value.at),
    wakeSent: value.wakeSent === true,
    ...(typeof value.wakeReason === "string" && value.wakeReason !== "" ? { wakeReason: value.wakeReason } : {}),
    ...(kind === undefined ? {} : { kind }),
    ...(typeof value.replyTo === "string" && value.replyTo !== "" ? { replyTo: value.replyTo } : {}),
    ...(typeof value.threadId === "string" && value.threadId !== "" ? { threadId: value.threadId } : {}),
    ...(question === undefined ? {} : { question }),
    ...(answer === undefined ? {} : { answer }),
    ...(typeof value.teamId === "string" && value.teamId !== "" ? { teamId: value.teamId } : {}),
    ...(typeof value.fromId === "string" && value.fromId !== "" ? { fromId: value.fromId } : {}),
    ...(typeof value.toId === "string" && value.toId !== "" ? { toId: value.toId } : {}),
    ...(typeof value.fromCell === "string" && value.fromCell !== "" ? { fromCell: value.fromCell } : {}),
    ...(typeof value.fromMemberId === "string" && value.fromMemberId !== "" ? { fromMemberId: value.fromMemberId } : {}),
  }
}

/**
 * Read one cell's LEGACY log, normalized to the view's record shape.
 *
 * A torn last line is dropped rather than trusted (the log is history, the cell record is truth). An
 * older row with no `cellId` is stamped with this cell's id, because the file itself is the scope.
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose legacy log is read.
 * @returns every parseable record, in append order.
 */
function readLegacyCellMail(workspace: string, cellId: string): CellMailRecord[] {
  /** The raw log text. */
  let text: string
  try {
    text = readFileSync(cellMailPath(workspace, cellId), "utf8")
  } catch {
    return []
  }
  /** The normalized records. */
  const out: CellMailRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      /** The record, when this line is one of the three the view knows. */
      const normalized = normalizeRawRecord(JSON.parse(line), cellId)
      if (normalized !== undefined) out.push(normalized)
    } catch {
      // A torn line costs one history row, never the log.
    }
  }
  return out
}

/**
 * Read the WORKSPACE mailbox's rows belonging to one cell.
 *
 * The filter is on the RAW record's `cellId` (contract §6 / the Lead's scoping rule), never on a folded
 * field, so the view cannot start showing another cell's mail if the store's projection changes.
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose rows are read.
 * @returns the normalized records in log order.
 */
export function readUnifiedCellMail(workspace: string, cellId: string): CellMailRecord[] {
  /** The normalized records belonging to this cell, in mailbox order. */
  const out: CellMailRecord[] = []
  for (const raw of readRecords(workspace)) {
    if (!isObject(raw)) continue
    // ONLY a message row is scoped by `cellId`: it names whose mail this is. A `read`/`wake` state row
    // carries no cell stamp (the store writes it), so it is matched by the message ID it names — a
    // state row can only apply to a send this cell already folded, because mailbox ids are unique
    // workspace-wide. Filtering state rows out would leave every acknowledgement unread.
    if (raw.t === "send" && raw.cellId !== cellId) continue
    /** The record, when this row is one the cell view knows. */
    const normalized = normalizeRawRecord(raw, cellId)
    if (normalized !== undefined) out.push(normalized)
  }
  return out
}

/**
 * Resolve one message by id across the WORKSPACE mailbox, whichever cell stamped it.
 *
 * WHY IT EXISTS (T9/F1 layer 1). A cross-cell row is stamped with the RECIPIENT cell's `cellId`, so a
 * cross-cell question lives in the recipient's view while the answer is composed from a DIFFERENT cell.
 * Resolving the answered question from the target cell's view alone therefore missed it and the caller
 * was refused with a misleading "must carry the question's non-empty questionId". This reads the one
 * durable mailbox by row id, across every cell stamp, and the FIRST matching send wins — the same
 * declared first-write rule the fold applies.
 *
 * It is a READ only: whether the row is answerable, and every reference/ownership rule, stays with the
 * store at send time. A pre-unification row that lives only in a cell's legacy `mail.jsonl` is NOT
 * visible here (the mailbox does not hold it); the caller keeps the target cell's view as a fallback.
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param id - the message id being resolved (an answer's `replyTo`).
 * @returns the normalized send row, or undefined when the mailbox holds no row with that id.
 */
export function findWorkspaceMailById(workspace: string, id: string): CellMailSend | undefined {
  if (id === "") return undefined
  for (const raw of readRecords(workspace)) {
    // Only a `send` row names a message; state rows carry the same id without the envelope.
    if (!isObject(raw) || raw.t !== "send" || raw.id !== id) continue
    /** The normalized view of that row, so the caller reads the same words a view row would. */
    const normalized = normalizeRawRecord(raw, "")
    if (normalized !== undefined && normalized.t === "send") return normalized
  }
  return undefined
}

/**
 * Read one cell's mail view: its LEGACY log plus its rows in the workspace mailbox.
 *
 * Both sources are normalized to the same record shape and merged in `at` order, so an inbox's "oldest
 * first" stays true across the migration boundary. A duplicate id is left to the fold's declared
 * FIRST-wins policy.
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose mail is read.
 * @returns every record, oldest first.
 */
export function readCellMail(workspace: string, cellId: string): CellMailRecord[] {
  /** The legacy rows first, then the unified rows; the sort below orders them together. */
  const merged = [...readLegacyCellMail(workspace, cellId), ...readUnifiedCellMail(workspace, cellId)]
  /** The merged rows with their arrival index, so equal instants keep a stable order. */
  const indexed = merged.map((record: CellMailRecord, index: number) => ({ record, index }))
  indexed.sort((left, right) => left.record.at.localeCompare(right.record.at) || left.index - right.index)
  return indexed.map((entry) => entry.record)
}

/**
 * Convert one cell-shaped send into the store's `MailSendLine`.
 *
 * The team words are derived from the cell words when the row is legacy, and `fromMemberId` defaults to
 * the sender's SEAT name so the store's ownership rules can match a legacy question row addressed to a
 * name (the D16c dual-spelling rule).
 * @param record - the cell-shaped send row.
 * @returns the line the team store's fold reads.
 */
function toSendLine(record: CellMailSend): MailSendLine {
  return {
    t: "send",
    id: record.id,
    fromId: record.fromId ?? record.from,
    fromName: record.from,
    toId: record.toId ?? record.to,
    toName: record.to,
    subject: record.subject,
    body: record.body,
    at: record.at,
    cellId: record.cellId,
    fromMemberId: record.fromMemberId ?? record.from,
    ...(record.fromCell === undefined ? {} : { fromCell: record.fromCell }),
    ...(record.teamId === undefined ? {} : { teamId: record.teamId }),
    ...(record.kind === undefined ? {} : { kind: record.kind }),
    ...(record.replyTo === undefined ? {} : { replyTo: record.replyTo }),
    ...(record.threadId === undefined ? {} : { threadId: record.threadId }),
    ...(record.question === undefined ? {} : { question: record.question }),
    ...(record.answer === undefined ? {} : { answer: record.answer }),
  }
}

/**
 * Fold the cell view's records into its messages.
 *
 * The store's OWN fold does the work (`fold`), so the team plane and the cell view share one definition
 * of the envelope, the thread resolution (I7), the read state and the first-wins duplicate policy. This
 * function adds only what the cell view owns: the cell words (`from`/`to`/`at`), the wake outcome from
 * the `wake` records, and the legacy row's own wake claim when no `wake` record was ever appended.
 * @param records - the merged view records, in log order.
 * @returns one message per `send`, in log order, with its read and wake state.
 */
export function foldCellMail(records: readonly CellMailRecord[]): CellMailMessage[] {
  /** The protocol-shaped send lines the store's fold reads. */
  const sends: MailSendLine[] = []
  /** The state rows the store's fold applies by id. */
  const reads: Array<{ t: "read"; id: string; at: string; by?: string }> = []
  /** The latest wake outcome per message id, in record order. */
  const wakes = new Map<string, { sent: boolean; reason?: string }>()
  /** The legacy sends' own wake claims, used only where no `wake` record exists. */
  const claims = new Map<string, { wakeSent: boolean; wakeReason?: string }>()
  for (const record of records) {
    if (record.t === "send") {
      sends.push(toSendLine(record))
      if (record.wakeSent || record.wakeReason !== undefined) {
        claims.set(record.id, { wakeSent: record.wakeSent, ...(record.wakeReason === undefined ? {} : { wakeReason: record.wakeReason }) })
      }
      continue
    }
    if (record.t === "read") {
      reads.push({ t: "read", id: record.id, at: record.at, ...(record.by === "" ? {} : { by: record.by }) })
      continue
    }
    wakes.set(record.id, { sent: record.sent, ...(record.reason === undefined ? {} : { reason: record.reason }) })
  }
  /** The store's folded messages, with the `cellId`/`fromCell`/`fromMemberId` stamps projected back on. */
  const folded: readonly TeamMailMessage[] = foldMailbox([...sends, ...reads]).messages
  return folded.map((message: TeamMailMessage) => {
    /** The wake outcome recorded for this message, when one was attempted. */
    const wake = wakes.get(message.id)
    /** The legacy row's own claim, for a message whose wake record was never written. */
    const claim = claims.get(message.id)
    /** Whether this message's wake-up is DELIVERED as far as the log can prove. */
    const wakeSent = wake === undefined ? claim?.wakeSent === true : wake.sent === true
    /** Why it did not go out, when it did not. */
    const wakeReason = wake === undefined ? claim?.wakeReason : wake.sent ? undefined : wake.reason
    return {
      t: "send",
      id: message.id,
      cellId: message.cellId ?? "",
      from: message.fromName,
      to: message.toName,
      subject: message.subject,
      body: message.body,
      at: message.sentAt,
      kind: message.kind,
      threadId: message.threadId,
      read: message.readAt !== undefined,
      wakeSent,
      ...(message.fromCell === undefined ? {} : { fromCell: message.fromCell }),
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      ...(message.question === undefined ? {} : { question: message.question }),
      ...(message.answer === undefined ? {} : { answer: message.answer }),
      ...(message.readBy === undefined ? {} : { readBy: message.readBy }),
      ...(wakeReason === undefined ? {} : { wakeReason }),
      ...(message.teamId === undefined ? {} : { teamId: message.teamId }),
      ...(message.fromId === undefined ? {} : { fromId: message.fromId }),
      ...(message.toId === undefined ? {} : { toId: message.toId }),
      ...(message.fromMemberId === undefined ? {} : { fromMemberId: message.fromMemberId }),
    }
  })
}

/**
 * Acknowledge the messages one seat read.
 *
 * A row that lives in the WORKSPACE mailbox moves through the store's ownership-checked `markRead`
 * (the ack's `byId` must be the row's `toId`). A LEGACY row lives only in the old cell log, so its
 * `read` record is appended back to that log — the same ack-once fact, recorded where the message is.
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose inbox was read.
 * @param ids - the unread message ids the seat is acknowledging.
 * @param ack - who is acknowledging: the store compares `byId`, the log records `byName`.
 * @param now - the clock, injected so the ack instant is testable.
 * @returns the ids that moved, and which of them were legacy.
 */
export function acknowledgeCellMail(workspace: string, cellId: string, ids: readonly string[], ack: MailAck, now: Date): CellAckResult {
  /** The ids that belong to the workspace mailbox (the store owns their ownership check). */
  const unifiedIds = new Set(
    readUnifiedCellMail(workspace, cellId)
      .filter((record) => record.t === "send")
      .map((record) => record.id),
  )
  /** The ids the store must move. */
  const viaStore = ids.filter((id) => unifiedIds.has(id))
  /**
   * The store's ownership-checked outcome: the ids that moved AND the ids it refused, with the reason.
   *
   * `acknowledge` rather than `markRead` on purpose (T9/N1): the narrow shape dropped the refusal list,
   * and a refused acknowledgement is exactly the fact a stalled seat needs to see.
   */
  const outcome = acknowledge(workspace, viaStore, ack, now)
  /** The store's refusals, carried out of the store instead of the `acknowledged: 0` silence. */
  const refused: Array<{ id: string; reason: string }> = outcome.refused.map((entry) => ({ id: entry.id, reason: entry.reason }))
  /** The ids that exist only in the legacy log. */
  const viaLegacy = ids.filter((id) => !unifiedIds.has(id))
  /** The ids the legacy append moved. */
  const movedLegacy: string[] = []
  for (const id of viaLegacy) {
    if (appendLegacyCellMail(workspace, cellId, { t: "read", id, by: ack.byName, at: now.toISOString() })) {
      movedLegacy.push(id)
    } else {
      // A legacy acknowledgement that could not be WRITTEN is the same class of silence: the row stays
      // unread, so it is reported rather than skipped.
      refused.push({ id, reason: "the legacy `mail.jsonl` read record could not be written — the row stays unread" })
    }
  }
  return { moved: [...outcome.moved, ...movedLegacy], legacy: movedLegacy, refused }
}

/**
 * The unread messages addressed to one cell seat.
 *
 * Matching is by NAME with the dispatch name rule, so `cell-planner` and `Cell Planner` address one
 * recipient; the captain's name is literally `captain`.
 *
 * @param messages - the folded messages.
 * @param names - the caller's acceptable names (its member name, or `captain`).
 * @returns the unread messages, oldest first.
 */
export function unreadFor(messages: readonly CellMailMessage[], names: readonly string[]): CellMailMessage[] {
  /** The comparison keys the caller answers to. */
  const keys = new Set(names.filter((name) => name !== "").map(nameKey))
  return messages.filter((message) => !message.read && keys.has(nameKey(message.to)))
}

/**
 * The messages a wake-up was NOT sent for, oldest first — what `cellwork_supervise` surfaces.
 *
 * @param messages - the folded messages.
 * @returns the undelivered-by-wakeup messages still unread.
 */
export function wakeFailures(messages: readonly CellMailMessage[]): CellMailMessage[] {
  return messages.filter((message) => !message.read && !message.wakeSent)
}

/**
 * How one mail delivery ended (D6): the durable row first, the wake-up attempt second.
 */
export interface MailDelivery {
  /** Whether the durable row reached the log; when false NO wake-up was attempted. */
  landed: boolean
  /**
   * Whether the wake-up is DELIVERED as far as the cell can tell: the transport accepted it AND its
   * `wake` record reached the log. A wake whose record was lost folds as undelivered, so answering
   * "sent" would contradict the record a later reader trusts (repair N1).
   */
  wakeSent: boolean
  /** Why the wake-up did not go out, or why the record of it could not be written. */
  wakeReason?: string
}

/**
 * What {@link deliverCellMail} needs: two appends and the attempt they bracket.
 */
export interface MailDeliveryDeps {
  /** Append the durable `send` row; false means the row never landed. */
  appendSend: () => boolean
  /** Attempt the wake-up; resolves the outcome (a throw is classified as a failed wake-up). */
  attemptWake: () => Promise<{ sent: boolean; reason?: string }>
  /**
   * Append the `wake` record for that outcome.
   *
   * False means the record never landed, so the log reports the row as undelivered and the answer must
   * not claim a sent wake (repair N1).
   */
  appendWake: (outcome: { sent: boolean; reason?: string }) => boolean
}

/**
 * Deliver one cell message DURABLE FIRST: the row lands, then the recipient may be woken.
 *
 * The one place the order is expressed, so it cannot drift back into a tool body (D6 measured the
 * reverse: a wake delivered for a row whose append then failed, which no reader could ever find). A
 * refused `send` append ends the attempt — nothing is woken for a message that does not exist.
 *
 * THE ANSWER AGREES WITH THE LOG (repair N1): a wake is reported sent only when the transport accepted
 * it AND its `wake` record was appended, because a fold of the log is what every later reader sees. The
 * two failures stay DISTINGUISHABLE in the reason: "the transport refused it" versus "the record of it
 * could not be written".
 *
 * @param deps - the durable append, the wake-up attempt and the outcome append.
 * @returns whether the row landed and what the wake-up did, as far as the log can prove it.
 */
export async function deliverCellMail(deps: MailDeliveryDeps): Promise<MailDelivery> {
  if (!deps.appendSend()) {
    return { landed: false, wakeSent: false, wakeReason: "the durable row could not be written, so no wake-up was attempted (mail is durable first)" }
  }
  /** The attempt's outcome; a seam that throws is a FAILED wake-up, never a lost row. */
  let outcome: { sent: boolean; reason?: string }
  try {
    outcome = await deps.attemptWake()
  } catch (error) {
    outcome = { sent: false, reason: "the wake-up failed: " + (error instanceof Error ? error.message : String(error)) }
  }
  /** Whether the attempt's outcome reached the log, which is what a later fold trusts. */
  const recorded = deps.appendWake(outcome)
  if (!recorded) {
    return {
      landed: true,
      wakeSent: false,
      wakeReason: outcome.sent === true
        ? "the wake-up was attempted and the transport accepted it, but its `wake` record could not be written — the durable log reports this row as undelivered"
        : "the wake-up did not go out (" + (outcome.reason ?? "no reason given") + ") and its `wake` record could not be written either — the durable log reports this row as undelivered",
    }
  }
  return { landed: true, wakeSent: outcome.sent === true, ...(outcome.reason === undefined ? {} : { wakeReason: outcome.reason }) }
}

// ── THE INBOX PROJECTION'S OWN TWO HELPERS (wave T43) ────────────────────────────────────────────
//
// WHY THEY LIVE HERE AND NOT IN THE TEAM STORE: `mpd-dsh-adapter-plugin`'s cross-package coupling
// inventory is SHRINK-ONLY, and cellwork's one frozen import from the team plane is `sendMany`. Capping
// what a SURFACE renders (and how a stored body is bounded before this row writes it) is the surface's own
// projection concern, so the two behaviours are spelled here rather than widening that import.
//
// THE RULE IS SHARED EVEN THOUGH THE CODE IS NOT: the team mailbox bounds a body at the same 4000
// characters and pages with the same default 20 (`.mpd-team-core-plugin/src/mailbox-store.ts`,
// `MAIL_BODY_MAX` / `pageOf`). A change to either number is a CONTRACT change that must land in both
// rows in the same wave — the comment is the pointer, and `mail-cap` arms on both planes pin the values.

/** The default number of inbox rows one render shows, matching the team mailbox's page size. */
export const CELL_MAIL_PAGE = 20

/** The hard bound on ONE cell message body, in characters, applied before this row is stored. */
export const CELL_MAIL_BODY_MAX = 4000

/** One rendered page of inbox rows, with the pointer the caller walks to see the rest. */
export interface CellMailPage<T> {
  /** The rows this render shows (and acknowledges). */
  page: T[]
  /** How many rows sit behind this page and stay unread until a later call. */
  more: number
  /** The offset to pass next time, or `null` when this page is the last one. */
  nextOffset: number | null
  /** The clamped page size this call used. */
  limit: number
  /** The clamped start of this page. */
  offset: number
}

/**
 * Draw one page of inbox rows, clamping both bounds.
 *
 * @param rows - every unread row, in insertion order.
 * @param limit - the requested page size; defaults to {@link CELL_MAIL_PAGE}, clamped to 1..100.
 * @param offset - the requested start; defaults to 0.
 * @returns the page, the count behind it and the next offset (`null` on the last page).
 */
export function pageCellMail<T>(rows: readonly T[], limit?: number, offset?: number): CellMailPage<T> {
  /** The clamped page size this call uses. */
  const size = Number.isFinite(Number(limit)) ? Math.min(Math.max(Math.trunc(Number(limit)), 1), 100) : CELL_MAIL_PAGE
  /** The clamped start of the page. */
  const start = Number.isFinite(Number(offset)) ? Math.max(Math.trunc(Number(offset)), 0) : 0
  /** The rows this page renders. */
  const page = rows.slice(start, start + size)
  /** Rows behind this page, which stay unread until a later call fetches them. */
  const more = Math.max(rows.length - (start + page.length), 0)
  return { page, more, nextOffset: more === 0 ? null : start + page.length, limit: size, offset: start }
}

/**
 * Bound one body at {@link CELL_MAIL_BODY_MAX}.
 *
 * The pre-cut text is deliberately NOT kept: the bound protects the reader's context, and a side copy on
 * disk would be read back by the same reader. A cut body reports its ORIGINAL length (so the cut is
 * visible) and never the lost text.
 * @param text - the body exactly as the sender passed it.
 * @returns the body to store, whether it was cut, and the pre-cut length.
 */
export function truncateCellMailBody(text: string): { body: string; truncated: boolean; originalLength: number } {
  if (text.length <= CELL_MAIL_BODY_MAX) return { body: text, truncated: false, originalLength: text.length }
  return { body: text.slice(0, CELL_MAIL_BODY_MAX), truncated: true, originalLength: text.length }
}
