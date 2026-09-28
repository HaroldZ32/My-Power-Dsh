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
  /** Message id, unique within the mailbox; the later `delivered`/`read` records point at it. */
  id: string
  /** Sender's session id; a member may not address itself, so this differs from the recipient. */
  fromId: string
  /** Sender's display name, kept so a folded message reads without a roster lookup. */
  fromName: string
  /** Recipient's session id — the member this message is TARGETED at. */
  toId: string
  /** Recipient's display name at send time; a later rename never rewrites history. */
  toName: string
  /** The one-line subject; the oldest unread subject is what a status view surfaces. */
  subject: string
  /** The full instruction text, stored and delivered verbatim. */
  body: string
  /** ISO instant the `send` record was written. */
  sentAt: string
  /** ISO instant the transport accepted it; absent means it is still queued. */
  deliveredAt?: string
  /** ISO instant the RECIPIENT acknowledged it — the transition only this mailbox records. */
  readAt?: string
}

/** The folded state: messages in insertion order. */
export interface MailboxState {
  /** The folded messages in insertion order, each carrying its own delivery and read state. */
  messages: MailMessage[]
}

/** The mailbox file for one workspace. */
export function mailboxPath(workspace: string): string {
  return join(workspace, ".mpd", "team", "mailbox.jsonl")
}

/** Fold the log into the current state. Unknown or malformed lines are SKIPPED, never fatal. */
export function fold(records: readonly unknown[]): MailboxState {
  /** The fold's working state: one message per `send` record, keyed by id. */
  const byId = new Map<string, MailMessage>()
  for (const raw of records) {
    /** The current log line, read as a partial record because a malformed one must be skipped. */
    const record = raw as Partial<MailboxRecord> | null
    if (record === null || typeof record !== "object") continue
    if (record.t === "send") {
      /** The line narrowed to the `send` variant, the only one that creates a message. */
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
      /** The message id this state record points at; an empty one can never match. */
      const id = String((record as { id?: unknown }).id ?? "")
      /** The message being advanced, or undefined when the log references an unknown id. */
      const message = byId.get(id)
      if (message === undefined) continue
      /** The instant carried by this state record. */
      const at = String((record as { at?: unknown }).at ?? "")
      if (record.t === "delivered") message.deliveredAt = at
      else message.readAt = at
    }
  }
  return { messages: [...byId.values()] }
}

/** Every record in the log, oldest first. A missing file is an empty log. */
export function readRecords(workspace: string): unknown[] {
  /** The mailbox log for this workspace; a missing file reads as an empty log. */
  const path = mailboxPath(workspace)
  if (!existsSync(path)) return []
  /** The log's raw text, or the empty string when the file cannot be read. */
  let text = ""
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  /** Parsed records in file order; only the last line may be a partial write. */
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
  /** The member's session id, which is what an inbox filters on. */
  memberId: string
  /** The member's display name as of first appearance in the log. */
  memberName: string
  /** Messages ever sent to this member and still present in the log. */
  total: number
  /** Messages this member has not acknowledged. */
  unread: number
  /** Messages the transport has not accepted yet. */
  undelivered: number
  /** The oldest unread subject, so a reader sees WHAT is waiting without listing everything. */
  oldestUnread?: string
}

/** Summarise every member that has mail, in the order they first appear. */
export function summarise(state: MailboxState): MailSummary[] {
  /** Member ids in first-appearance order, so the summary is stable across folds. */
  const order: string[] = []
  /** The accumulating per-member summaries, keyed by recipient id. */
  const seen = new Map<string, MailSummary>()
  for (const message of state.messages) {
    /** The recipient's summary, created on first sight of that member. */
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
  /** Sender's session id; equal to `toId` is refused as a self-send. */
  fromId: string
  /** Sender's display name, recorded onto the message. */
  fromName: string
  /** Recipient session id; it must appear in `memberIds` or the send is refused. */
  toId: string
  /** Recipient's display name, echoed into refusals so they name a person, not an id. */
  toName: string
  /** One-line subject, stored exactly as given. */
  subject: string
  /** The instruction text, stored as given and delivered verbatim. */
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
  /** The mailbox as it stands, which is what the backlog bound is measured against. */
  const state = readMailbox(workspace)
  /** How many messages to this member the transport has not accepted yet. */
  const backlog = undeliveredOf(state, input.toId).length
  /** Effective backlog bound; zero or less disables the bound entirely. */
  const cap = input.maxUndelivered ?? 8
  if (cap > 0 && backlog >= cap) {
    return { ok: false, reason: "backlog-full", detail: `"${input.toName || input.toId}" already has ${backlog} undelivered message(s) (bound ${cap}) — it is not keeping up` }
  }
  /** The send instant, shared by the message record and the log line. */
  const at = now.toISOString()
  /** The message as it will be folded back out of the log. */
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
  /** The mailbox as it stands, so a repeat delivery is a no-op rather than a second record. */
  const state = readMailbox(workspace)
  /** Messages indexed by id, to resolve each requested id in one lookup. */
  const byId = new Map(state.messages.map((message) => [message.id, message]))
  /** Ids that actually changed state; a repeat is neither an error nor a change. */
  const moved: string[] = []
  for (const id of ids) {
    /** The message this id resolves to, or undefined when the mailbox does not know it. */
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
  /** The mailbox as it stands, so a repeat acknowledgement is a no-op. */
  const state = readMailbox(workspace)
  /** Messages indexed by id, to resolve each requested id in one lookup. */
  const byId = new Map(state.messages.map((message) => [message.id, message]))
  /** Ids that actually moved from unread to read. */
  const moved: string[] = []
  for (const id of ids) {
    /** The message this id resolves to, or undefined when the mailbox does not know it. */
    const message = byId.get(id)
    if (message === undefined || message.readAt !== undefined) continue
    appendRecord(workspace, { t: "read", id, at: now.toISOString() })
    moved.push(id)
  }
  return moved
}
