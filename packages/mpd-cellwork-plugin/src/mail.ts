// CELLWORK MAIL — the cell's durable, addressed message log (contract B9).
//
// WHY A CELL-OWNED LOG when the team already has `agent_teams_mail`. That mailbox is the TEAM's: it
// addresses live members of one team, and it has no concept of the CAPTAIN as a recipient (the Lead is not
// on the roster) or of a sub-cell. The cell therefore owns a small append-only log INSIDE the cell
// directory, addressed by NAME (`captain`, `cell-planner`, …), which is what makes the planner's question
// relay possible and what the captain reads on its next `cellwork_inbox` call.
//
// DELIVERY IS BEST-EFFORT, DURABILITY IS NOT. A row is written first; a wake-up is then attempted through
// the transport when the sender is the captain and the recipient is a live member. A row whose wake-up
// failed stays UNREAD and is surfaced on `cellwork_supervise` — mail is durable, wake-up is best-effort
// (the frozen contract's own words).
//
// THE ORDER IS THEREFORE PART OF THE FORMAT (D6). The `send` row and the wake-up attempt are TWO appends:
// the row lands first with no wake claim on it, and the attempt's outcome is appended afterwards as a
// `wake` record. `deliverCellMail` is the one place that order is expressed, so no caller can invert it
// again — the defect was a tool that woke the member before the row it described existed.
//
// The log is `mail.jsonl` inside the cell directory: append-only, one record per line, so a crash costs the
// last line and never the file. `send` opens a message; `read` is the recipient's acknowledgement.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { cellDir } from "./state"
import { nameKey } from "./dispatch"

/** The mail log's file name inside one cell directory. */
export const CELL_MAIL_FILE = "mail.jsonl"

/** One `send` record: a message opened by a sender. */
export interface CellMailSend {
  /** Discriminator: this record opens a message. */
  t: "send"
  /** Message id, unique inside the cell. */
  id: string
  /** The cell the message belongs to (stamped so a copied log is traceable). */
  cellId: string
  /** The sender's cell name (`captain`, `cell-planner`, …). */
  from: string
  /** The sender's CELL id, when the row was written into another cell's log (a cross-cell message). */
  fromCell?: string
  /** The recipient's cell name, as addressed. */
  to: string
  /** One-line subject. */
  subject: string
  /** The full body, stored and delivered verbatim. */
  body: string
  /** ISO instant the row was written. */
  at: string
  /**
   * Whether a wake-up had been handed to the transport when THIS row landed.
   *
   * Always `false` on a row written by {@link deliverCellMail}: the row must exist before anything is
   * woken, so the attempt's outcome is appended later as a {@link CellMailWake} record. A row from an
   * older build may carry `true`, and folding keeps it.
   */
  wakeSent: boolean
  /** Why the wake-up was not sent, when it was not (a pre-`wake`-record spelling). */
  wakeReason?: string
}

/**
 * One `wake` record: what happened to the wake-up, appended AFTER the durable `send` row (D6).
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

/** One folded message: the `send` plus whether it was read. */
export interface CellMailMessage extends CellMailSend {
  /** Whether the recipient acknowledged it. */
  read: boolean
}

/** The absolute mail log path of one cell. */
export function cellMailPath(workspace: string, cellId: string): string {
  return join(cellDir(workspace, cellId), CELL_MAIL_FILE)
}

/**
 * Mint one message id: the instant plus a per-process counter, so two messages in one millisecond differ.
 *
 * @param now - the instant to stamp.
 * @param sequence - the caller's per-process counter.
 * @returns the id.
 */
export function mailId(now: Date, sequence: number): string {
  return "cellmail-" + now.toISOString().replace(/[-:.TZ]/g, "") + "-" + String(sequence)
}

/**
 * Append one record to a cell's mail log.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose log is appended.
 * @param record - the record to append.
 * @returns true when the line reached the file.
 */
export function appendCellMail(workspace: string, cellId: string, record: CellMailRecord): boolean {
  try {
    /** The log path whose directory the cell record write normally created already. */
    const path = cellMailPath(workspace, cellId)
    mkdirSync(cellDir(workspace, cellId), { recursive: true })
    appendFileSync(path, JSON.stringify(record) + "\n", "utf8")
    return true
  } catch {
    return false
  }
}

/**
 * Read one cell's mail log.
 *
 * A torn last line is dropped rather than trusted (the log is history, the cell record is truth).
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose log is read.
 * @returns every parseable record, in append order.
 */
export function readCellMail(workspace: string, cellId: string): CellMailRecord[] {
  /** The raw log text. */
  let text: string
  try {
    text = readFileSync(cellMailPath(workspace, cellId), "utf8")
  } catch {
    return []
  }
  /** The parseable records. */
  const records: CellMailRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      /** The parsed line. */
      const parsed = JSON.parse(line) as CellMailRecord
      if (parsed !== null && typeof parsed === "object" && (parsed.t === "send" || parsed.t === "read" || parsed.t === "wake")) records.push(parsed)
    } catch {
      // A torn line costs one history row, never the log.
    }
  }
  return records
}

/**
 * Fold one mail log into the current state of its messages.
 *
 * @param records - the log, in append order.
 * @returns one message per `send`, with its read state and its latest wake-up outcome.
 */
export function foldCellMail(records: readonly CellMailRecord[]): CellMailMessage[] {
  /** The messages by id, in send order. */
  const byId = new Map<string, CellMailMessage>()
  for (const record of records) {
    if (record.t === "send") {
      byId.set(record.id, { ...record, read: false })
      continue
    }
    /** The message this record names; a record for a `send` the log lost is dropped. */
    const message = byId.get(record.id)
    if (message === undefined) continue
    if (record.t === "read") {
      message.read = true
      continue
    }
    /** Whether the transport accepted the wake-up, which REPLACES the row's own (always false) claim. */
    message.wakeSent = record.sent === true
    if (record.reason === undefined || record.reason === "") delete message.wakeReason
    else message.wakeReason = record.reason
  }
  return [...byId.values()]
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
