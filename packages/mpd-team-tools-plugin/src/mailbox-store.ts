// The mpd-OWNED mailbox: a durable team inbox with a read state the harness cannot provide.
//
// WHY OURS, when the harness has an inbox. The official mailbox keeps `state.messages` and
// `state.delivered` and NOTHING ELSE — "read" is not observable anywhere in it (its public surface is
// createTask/getTask/interrupt/listMembers/listTasks/membership/sendMessage/spawnTeammate/updateTask/
// waitForChange). So the harness can say "queued" and "delivered", and never "read". A captain who
// needs to know whether a teammate actually SAW an instruction has to own that transition, which means
// owning the record.
//
// WHAT IS ABSORBED from the official implementation, deliberately, because each was earned there:
//   • a message is TARGETED at a live member, resolved by name, and a member cannot message itself;
//   • a member's UNDELIVERED backlog is BOUNDED, so a stalled member cannot silently accumulate work —
//     the official service refuses with `TEAM_MAILBOX_FULL` and so does this one;
//   • the queue keeps INSERTION ORDER, and unread counts are computed oldest-first.
//
// WHAT IS OURS: `sent → delivered → read`. `read` is an explicit acknowledgement by the recipient,
// recorded here and nowhere else. `delivered` says the transport accepted it; `read` says a human or
// an agent acted on it. Those are different facts and the captain needs both.
//
// STORAGE is an append-only JSONL log under `<workspace>/.mpd/team/mailbox.jsonl`: one record per line,
// never rewritten, so a crash mid-write costs the last line and never the file. Folding the log gives
// the current state, which makes every rule below a pure function of the records.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** One line of the log. `send` opens a message; `delivered` and `read` move it along. */
export type MailboxRecord =
  | { t: "send"; id: string; fromId: string; fromName: string; toId: string; toName: string; subject: string; body: string; at: string }
  | { t: "delivered"; id: string; at: string }
  | { t: "read"; id: string; at: string }

/** A message as the log knows it. */
export interface MailMessage {
  id: string
  fromId: string
  fromName: string
  toId: string
  toName: string
  subject: string
  body: string
  sentAt: string
  deliveredAt?: string
  readAt?: string
}

/** The folded state: messages in insertion order. */
export interface MailboxState {
  messages: MailMessage[]
}

/** The mailbox file for one workspace. */
export function mailboxPath(workspace: string): string {
  return join(workspace, ".mpd", "team", "mailbox.jsonl")
}

/** Fold the log into the current state. Unknown or malformed lines are SKIPPED, never fatal. */
export function fold(records: readonly unknown[]): MailboxState {
  const byId = new Map<string, MailMessage>()
  for (const raw of records) {
    const record = raw as Partial<MailboxRecord> | null
    if (record === null || typeof record !== "object") continue
    if (record.t === "send") {
      const send = record as Extract<MailboxRecord, { t: "send" }>
      if (typeof send.id !== "string" || send.id === "") continue
      byId.set(send.id, {
        id: send.id,
        fromId: String(send.fromId ?? ""),
        fromName: String(send.fromName ?? ""),
        toId: String(send.toId ?? ""),
        toName: String(send.toName ?? ""),
        subject: String(send.subject ?? ""),
        body: String(send.body ?? ""),
        sentAt: String(send.at ?? ""),
      })
      continue
    }
    if (record.t === "delivered" || record.t === "read") {
      const id = String((record as { id?: unknown }).id ?? "")
      const message = byId.get(id)
      if (message === undefined) continue
      const at = String((record as { at?: unknown }).at ?? "")
      if (record.t === "delivered") message.deliveredAt = at
      else message.readAt = at
    }
  }
  return { messages: [...byId.values()] }
}

/** Every record in the log, oldest first. A missing file is an empty log. */
export function readRecords(workspace: string): unknown[] {
  const path = mailboxPath(workspace)
  if (!existsSync(path)) return []
  let text = ""
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  const out: unknown[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // A half-written LAST line is the only expected corruption; skip it and keep the rest.
    }
  }
  return out
}

/** Read the current state. */
export function readMailbox(workspace: string): MailboxState {
  return fold(readRecords(workspace))
}

/** Append one record. Creates the directory. */
export function appendRecord(workspace: string, record: MailboxRecord): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  appendFileSync(mailboxPath(workspace), JSON.stringify(record) + "\n")
}

/** Messages addressed to one member, oldest first. */
export function inboxOf(state: MailboxState, memberId: string): MailMessage[] {
  return state.messages.filter((message) => message.toId === memberId)
}

/** Messages that member has NOT acknowledged, oldest first. */
export function unreadOf(state: MailboxState, memberId: string): MailMessage[] {
  return inboxOf(state, memberId).filter((message) => message.readAt === undefined)
}

/** Messages the transport has not accepted yet, oldest first. */
export function undeliveredOf(state: MailboxState, memberId: string): MailMessage[] {
  return inboxOf(state, memberId).filter((message) => message.deliveredAt === undefined)
}

/** A per-member mail summary, for a status view. */
export interface MailSummary {
  memberId: string
  memberName: string
  total: number
  unread: number
  undelivered: number
  /** The oldest unread subject, so a reader sees WHAT is waiting without listing everything. */
  oldestUnread?: string
}

/** Summarise every member that has mail, in the order they first appear. */
export function summarise(state: MailboxState): MailSummary[] {
  const order: string[] = []
  const seen = new Map<string, MailSummary>()
  for (const message of state.messages) {
    let entry = seen.get(message.toId)
    if (entry === undefined) {
      entry = { memberId: message.toId, memberName: message.toName, total: 0, unread: 0, undelivered: 0 }
      seen.set(message.toId, entry)
      order.push(message.toId)
    }
    entry.total += 1
    if (message.readAt === undefined) {
      entry.unread += 1
      if (entry.oldestUnread === undefined) entry.oldestUnread = message.subject
    }
    if (message.deliveredAt === undefined) entry.undelivered += 1
  }
  return order.map((id) => seen.get(id) as MailSummary)
}

/** Why a send was refused. Each maps to one sentence a captain can act on. */
export type SendRefusal = "self" | "unknown-recipient" | "backlog-full"

/** The outcome of a send attempt. */
export type SendResult = { ok: true; message: MailMessage } | { ok: false; reason: SendRefusal; detail: string }

/** What one send needs. */
export interface SendInput {
  fromId: string
  fromName: string
  toId: string
  toName: string
  subject: string
  body: string
  /** The live roster: a message goes to a MEMBER, never to an id nobody serves. */
  memberIds: readonly string[]
  /** The bound on a member's undelivered backlog, absorbed from the official `TEAM_MAILBOX_FULL`. */
  maxUndelivered?: number
}

/**
 * Validate and append one message.
 *
 * @param workspace - the workspace whose mailbox this is.
 * @param input - the message and the roster it is validated against.
 * @param now - the clock, injected so the rules are testable.
 * @returns the recorded message, or the refusal and what it means.
 */
export function send(workspace: string, input: SendInput, now: Date): SendResult {
  if (input.toId === input.fromId) {
    return { ok: false, reason: "self", detail: "a team member cannot message itself" }
  }
  if (!input.memberIds.includes(input.toId)) {
    return { ok: false, reason: "unknown-recipient", detail: `"${input.toName || input.toId}" is not a member of this team` }
  }
  const state = readMailbox(workspace)
  const backlog = undeliveredOf(state, input.toId).length
  const cap = input.maxUndelivered ?? 8
  if (cap > 0 && backlog >= cap) {
    return { ok: false, reason: "backlog-full", detail: `"${input.toName || input.toId}" already has ${backlog} undelivered message(s) (bound ${cap}) — it is not keeping up` }
  }
  const at = now.toISOString()
  const message: MailMessage = {
    id: `mail-${at.replace(/[-:.TZ]/g, "").slice(0, 14)}-${(state.messages.length + 1).toString().padStart(3, "0")}`,
    fromId: input.fromId,
    fromName: input.fromName,
    toId: input.toId,
    toName: input.toName,
    subject: input.subject,
    body: input.body,
    sentAt: at,
  }
  appendRecord(workspace, { t: "send", ...message, at })
  return { ok: true, message }
}

/**
 * Mark messages as accepted by the transport.
 *
 * @returns the ids that actually moved (a repeat is not an error, and not a change either).
 */
export function markDelivered(workspace: string, ids: readonly string[], now: Date): string[] {
  const state = readMailbox(workspace)
  const byId = new Map(state.messages.map((message) => [message.id, message]))
  const moved: string[] = []
  for (const id of ids) {
    const message = byId.get(id)
    if (message === undefined || message.deliveredAt !== undefined) continue
    appendRecord(workspace, { t: "delivered", id, at: now.toISOString() })
    moved.push(id)
  }
  return moved
}

/**
 * Acknowledge messages: the recipient SAYS it has read them, which is the transition the harness
 * cannot observe and the reason this mailbox exists.
 *
 * @returns the ids that actually moved from unread to read.
 */
export function markRead(workspace: string, ids: readonly string[], now: Date): string[] {
  const state = readMailbox(workspace)
  const byId = new Map(state.messages.map((message) => [message.id, message]))
  const moved: string[] = []
  for (const id of ids) {
    const message = byId.get(id)
    if (message === undefined || message.readAt !== undefined) continue
    appendRecord(workspace, { t: "read", id, at: now.toISOString() })
    moved.push(id)
  }
  return moved
}
