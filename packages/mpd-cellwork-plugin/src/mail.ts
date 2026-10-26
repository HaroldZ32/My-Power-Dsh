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
  /** The recipient's cell name, as addressed. */
  to: string
  /** One-line subject. */
  subject: string
  /** The full body, stored and delivered verbatim. */
  body: string
  /** ISO instant the row was written. */
  at: string
  /** Whether the wake-up was handed to the transport; a durable row is delivered either way. */
  wakeSent: boolean
  /** Why the wake-up was not sent, when it was not. */
  wakeReason?: string
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
export type CellMailRecord = CellMailSend | CellMailRead

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
      if (parsed !== null && typeof parsed === "object" && (parsed.t === "send" || parsed.t === "read")) records.push(parsed)
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
 * @returns one message per `send`, with its read state.
 */
export function foldCellMail(records: readonly CellMailRecord[]): CellMailMessage[] {
  /** The messages by id, in send order. */
  const byId = new Map<string, CellMailMessage>()
  for (const record of records) {
    if (record.t === "send") {
      byId.set(record.id, { ...record, read: false })
    } else {
      /** The message this acknowledgement names. */
      const message = byId.get(record.id)
      if (message !== undefined) message.read = true
    }
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
