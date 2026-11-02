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
//     the official service refuses with `TEAM_MAILBOX_FULL` and so does this one — the bound is
//     PER TEAM, because member ids (`M1`, `M2`, …) repeat across waves and a finished team's queue must
//     never refuse a new team's work — and an ACK RELEASES A SLOT, because the one release valve an
//     operator has cannot depend on a delivery a stalled member will never trigger;
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
import { fanOutTargets, foldMail, inheritedThreadId, validateEnvelope, validateReferences } from "../../mpd-mail-protocol/src/index"
import type { MailAddress, MailAnswer, MailEnvelope, MailKind, MailMessage as ProtocolMailMessage, MailProblem, MailQuestion, MailSendRecord } from "../../mpd-mail-protocol/src/index"

/**
 * A `send` line as a WRITER hands it over.
 *
 * `kind` is OPTIONAL here on purpose: a row written before the mail protocol existed has none, and the
 * fold reads it as `message` (contract §5). The two `cell*` keys are PASS-THROUGH stamps the cellwork
 * view scopes its rows by (contract §6); this store never filters or counts by them.
 */
export type MailSendLine = Omit<MailSendRecord, "kind"> & { kind?: MailKind; cellId?: string; fromCell?: string; fromMemberId?: string }

/**
 * One `wake` record: what happened to the BEST-EFFORT wake-up, appended AFTER the durable `send` row.
 *
 * THE CANONICAL DECLARATION of this shape, and the byte-for-byte twin of `mpd-cellwork-plugin`'s
 * `CellMailWake` (contract §5): one log, one spelling, so a reader never has to know which plane wrote
 * a line. `reason` is REQUIRED whenever `sent` is false — {@link recordWake} enforces that in the type.
 *
 * A message with NO `wake` record is one whose attempt was never made (the process stopped between the
 * two appends), which a reader must treat as "not woken", never as success.
 */
export interface MailWakeLine {
  /** Discriminator: this record reports one wake-up attempt. */
  t: "wake"
  /** The message the attempt was for. */
  id: string
  /** Whether the transport accepted the wake-up. */
  sent: boolean
  /** Why it did not, when it did not; REQUIRED whenever `sent` is false. */
  reason?: string
  /** ISO instant of the attempt. */
  at: string
}

/** One line of the log. `send` opens a message; `delivered`/`read` move it along; `wake` reports a wake-up. */
export type MailboxRecord =
  | MailSendLine
  | MailWakeLine
  | { t: "delivered"; id: string; at: string }
  | { t: "read"; id: string; at: string; by?: string }

/**
 * A message as the log knows it: the PROTOCOL's envelope plus this mailbox's own state.
 *
 * The envelope (`kind`, `replyTo`, `threadId`, `question`, `answer`) is `mpd-mail-protocol`'s type —
 * ONE vocabulary for the team plane and the cell view — and the folded state below is what only this
 * mailbox records (`deliveredAt`/`readAt`/`readBy`). The two `cell*` keys are the pass-through stamps
 * described on {@link MailSendLine}.
 */
export interface MailMessage extends ProtocolMailMessage {
  /** The cell that wrote this row, when its writer stamped one; never used by a team rule. */
  cellId?: string
  /** The cell a wake or broadcast came from, when its writer stamped one; likewise inert here. */
  fromCell?: string
  /**
   * Whether THIS row's body was cut at {@link MAIL_BODY_MAX} when it was stored.
   *
   * A cut is never silent: the flag rides the stored row, the original length is recorded beside it,
   * and the READ rendering says so. The pre-truncation text is NOT kept anywhere — the bound exists to
   * stop one message from flooding a model's context, so keeping the whole body on disk would defeat it.
   */
  truncated?: boolean
  /** The body's length BEFORE the cut, recorded only when {@link truncated} is true. */
  originalLength?: number
  /**
   * The sender's ROSTER id, when it has one (`M1`), recorded beside its session id.
   *
   * WHY BOTH: a row is ADDRESSED to a roster id, while a session answers as its own session id — two
   * different strings (the D16c defect). The answer/ack ownership rules must accept either spelling of
   * the same member, so the roster id is recorded at send time instead of being guessed later.
   */
  fromMemberId?: string
}

/**
 * One page of rows plus the receipt a caller needs to fetch the rest (W4-A6b).
 *
 * WHY IT LIVES IN THE STORE: both mail readers — `agent_teams_mail`'s unread answer and cellwork's
 * inbox — must page IDENTICALLY, and cellwork already imports this module, so one implementation keeps
 * them from drifting. The rows themselves are never removed: paging is a READ view over the full set.
 *
 * @param rows - the full row set, in display order.
 * @param limit - rows per page; clamped to 1..100, defaulting to 20 for a non-numeric value.
 * @param offset - the first row of the page; clamped to a non-negative integer.
 * @returns the page, the rows behind it, the next page's offset (null at the end) and the bounds used.
 */
export function pageOf<T>(rows: readonly T[], limit?: number, offset?: number): { page: T[]; more: number; nextOffset: number | null; limit: number; offset: number } {
  /** The clamped page size this call uses. */
  const size = Number.isFinite(Number(limit)) ? Math.min(Math.max(Math.trunc(Number(limit)), 1), 100) : 20
  /** The clamped start of the page. */
  const start = Number.isFinite(Number(offset)) ? Math.max(Math.trunc(Number(offset)), 0) : 0
  /** The rows this page renders. */
  const page = rows.slice(start, start + size)
  /** Rows behind this page, which stay unread until a later call fetches them. */
  const more = Math.max(rows.length - (start + page.length), 0)
  return { page, more, nextOffset: more === 0 ? null : start + page.length, limit: size, offset: start }
}

/**
 * The hard bound on ONE message body, in characters, applied when the row is STORED (W4-A6b).
 *
 * WHY A STORE-TIME BOUND: a mailbox read is fed back into a model's context, so one 200 KB body costs a
 * whole context window for one row. The cap is applied at the WRITE so every reader — `unread`, the
 * cellwork inbox, a future GUI — inherits it, and the stored row carries `truncated` + `originalLength`
 * so the cut is visible rather than invisible.
 */
export const MAIL_BODY_MAX = 4000

/**
 * Bound one body at {@link MAIL_BODY_MAX}.
 *
 * The original text is deliberately NOT preserved: the bound protects the reader's context, and a side
 * copy on disk would be read back by the same reader. A cut body therefore reports its original LENGTH
 * (so a caller knows what was lost) and never the lost text.
 *
 * @param text - the body exactly as the sender passed it.
 * @returns the body to store, whether it was cut, and the pre-cut length.
 */
export function truncateMailBody(text: string): { body: string; truncated: boolean; originalLength: number } {
  if (text.length <= MAIL_BODY_MAX) return { body: text, truncated: false, originalLength: text.length }
  return { body: text.slice(0, MAIL_BODY_MAX), truncated: true, originalLength: text.length }
}

/** The folded state: messages in insertion order, plus what the fold had to report. */
export interface MailboxState {
  /** The folded messages in insertion order, each carrying its own delivery and read state. */
  messages: MailMessage[]
  /**
   * One line per anomaly the PROTOCOL fold saw — a duplicated id (the first write wins), a reference to
   * a send line that never arrived, a dropped payload (I8).
   *
   * WHY IT MUST SURFACE HERE (R2's N2): this store is the ONE log a second writer (the cellwork view)
   * now appends to, so a duplicate id is exactly the anomaly an operator needs to see. Keeping the
   * first write is the documented content policy; HIDING that it happened is not. The mail tool and the
   * web projection both read through this state, so this list is the only place the anomaly can appear
   * on this plane — an empty list is the honest "nothing was skipped".
   *
   * OPTIONAL ON PURPOSE, and never absent from a FOLD: {@link fold} and {@link readMailbox} always
   * populate it, while a caller-built VIEW over a message list (the permit/wait path hands
   * `{ messages }` straight to a reader) is not a fold result and must not be forced to invent a
   * problem list. A consumer that wants them reads `state.problems ?? []`; {@link scopeToTeam} carries
   * the list through so narrowing a fold never drops the diagnostics.
   */
  problems?: string[]
}

/** The mailbox file for one workspace. */
export function mailboxPath(workspace: string): string {
  return join(workspace, ".mpd", "team", "mailbox.jsonl")
}

/**
 * Fold the log into the current state. Unknown or malformed lines are SKIPPED, never fatal.
 *
 * The protocol's own fold does the work (`mpd-mail-protocol`): it tolerates a torn last line, a legacy
 * row with no `kind` (read as `message`), a state row whose `send` line was lost, and a foreign record
 * kind (a cellwork `wake`), and it RESOLVES every thread (I7). That is the ONE definition of what a
 * mail row means, so the team plane and the cellwork view cannot drift apart. This function adds the
 * pass-through fields the protocol fold does not project: it reads them off each raw `send` line and
 * attaches them to the folded message, so `cellId` still scopes a cell view and the body bound
 * (`truncated`/`originalLength`) survives the fold.
 *
 * @param records - the parsed log lines, oldest first; a torn trailing line may be included.
 * @returns the folded messages in log order, each carrying its envelope and its state.
 */
export function fold(records: readonly unknown[]): MailboxState {
  /** The protocol fold's WHOLE answer — the messages it proved and the anomalies it reported (I8). */
  const folded = foldMail(records)
  /** The messages the protocol fold proved, in log order. */
  const messages: readonly MailMessage[] = folded.messages
  /** The stamps by message id, read from the raw `send` lines the protocol does not project. */
  const stamps = new Map<string, { cellId?: string; fromCell?: string; fromMemberId?: string; truncated?: boolean; originalLength?: number }>()
  for (const raw of records) {
    if (raw === null || typeof raw !== "object") continue
    /** One raw line, read loosely: only the stamps this projection adds are taken from it. */
    const line = raw as { t?: unknown; id?: unknown; cellId?: unknown; fromCell?: unknown; fromMemberId?: unknown; truncated?: unknown; originalLength?: unknown }
    if (line.t !== "send" || typeof line.id !== "string" || line.id === "") continue
    // FIRST-WINS, the SAME content policy the protocol fold applies to the content itself: the message
    // kept for an id is the FIRST `send` row (a later duplicate is reported, not merged), so a later
    // duplicate's stamps must not decorate it — that would be a second, quieter merge the fold refused.
    if (stamps.has(line.id)) continue
    /** The cell stamp, when the line carries one; absent stays absent rather than `""`. */
    const cellId = typeof line.cellId === "string" && line.cellId !== "" ? line.cellId : undefined
    /** The originating-cell stamp, on the same rule. */
    const fromCell = typeof line.fromCell === "string" && line.fromCell !== "" ? line.fromCell : undefined
    /** The sender's roster id, on the same rule; it is the identity the ownership rules compare. */
    const fromMemberId = typeof line.fromMemberId === "string" && line.fromMemberId !== "" ? line.fromMemberId : undefined
    /** Whether the stored body was cut at the write bound (W4-A6b); only a literal `true` counts. */
    const truncated = line.truncated === true ? true : undefined
    /** The pre-cut body length, carried only on a cut row. */
    const originalLength = typeof line.originalLength === "number" ? line.originalLength : undefined
    if (cellId === undefined && fromCell === undefined && fromMemberId === undefined && truncated === undefined && originalLength === undefined) continue
    stamps.set(line.id, {
      ...(cellId === undefined ? {} : { cellId }),
      ...(fromCell === undefined ? {} : { fromCell }),
      ...(fromMemberId === undefined ? {} : { fromMemberId }),
      ...(truncated === undefined ? {} : { truncated }),
      ...(originalLength === undefined ? {} : { originalLength }),
    })
  }
  return {
    messages: messages.map((message) => ({ ...message, ...(stamps.get(message.id) ?? {}) })),
    problems: [...folded.problems],
  }
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

/**
 * The outcome of one wake-up attempt, shaped so the compiler refuses a silent failure.
 *
 * `sent: false` REQUIRES a reason (contract §5: the failure is "recorded with a reason"), and `sent:
 * true` may carry one as context. A caller therefore cannot write an unexplained failure, which is the
 * whole difference between this record and the process log line it replaces.
 */
export type WakeOutcome = { sent: true; reason?: string } | { sent: false; reason: string }

/**
 * Record what happened to one best-effort wake-up, as its OWN durable line.
 *
 * WHY A SEPARATE RECORD, and why here: the log is append-only, so the `send` row written before the
 * attempt cannot carry the attempt's outcome (the cellwork plane's D6 rule, now shared). Writing it in
 * the SAME log is what lets an operator diagnose "the lead never woke" from the mailbox alone, instead
 * of from a process log that is gone by the next boot.
 *
 * @param workspace - the workspace whose mailbox this is.
 * @param id - the message the attempt was for.
 * @param outcome - whether the transport accepted it, with a reason when it did not.
 * @param now - the clock, injected so the rules are testable.
 * @returns the record that was written, so a caller can assert on it without re-reading the log.
 */
export function recordWake(workspace: string, id: string, outcome: WakeOutcome, now: Date): MailWakeLine {
  /** The line, with `reason` present only when the caller supplied one. */
  const record: MailWakeLine = {
    t: "wake",
    id,
    sent: outcome.sent,
    ...(outcome.reason === undefined || outcome.reason === "" ? {} : { reason: outcome.reason }),
    at: now.toISOString(),
  }
  appendRecord(workspace, record)
  return record
}

/** Messages addressed to one member, oldest first. */
export function inboxOf(state: MailboxState, memberId: string): MailMessage[] {
  return state.messages.filter((message) => message.toId === memberId)
}

/** Messages that member has NOT acknowledged, oldest first. */
export function unreadOf(state: MailboxState, memberId: string): MailMessage[] {
  return inboxOf(state, memberId).filter((message) => message.readAt === undefined)
}

/**
 * Whether one message still counts against a member's backlog: NEITHER accepted by the transport NOR
 * acknowledged by the recipient.
 *
 * WHY THE ACK COUNTS, when `delivered` is the transport's own fact: the bound exists to say a member is
 * not keeping up, and a recipient that has ACKNOWLEDGED a row IS keeping up with it — even when the
 * transport never stamped a delivery. Counting only `deliveredAt` left the operator with no release
 * valve: a full backlog could be cleared ONLY by a delivery the stalled member was never going to make
 * (measured: 8 rows, one acknowledged, the ninth send still refused). The three consumers of this rule
 * — the send bound through {@link undeliveredOf}, the `undelivered` column {@link summarise} renders,
 * and the mail tool's `unread` answer — share it, so they can never disagree about WHICH rows are
 * outstanding.
 *
 * @param message - one folded message.
 * @returns true while the message is still outstanding.
 */
export function isOutstanding(message: MailMessage): boolean {
  return message.deliveredAt === undefined && message.readAt === undefined
}

/** Messages this member was never handed AND never acknowledged, oldest first — the backlog a bound measures. */
export function undeliveredOf(state: MailboxState, memberId: string): MailMessage[] {
  return inboxOf(state, memberId).filter(isOutstanding)
}

/**
 * The slice of the mailbox ONE TEAM can claim: the rows stamped with its identity.
 *
 * WHY, when a recipient id looks like enough to filter on: every team mints its members from `M1`
 * upward, so `toId`/`toName` repeat across teams and a workspace-wide fold shows a NEW team's `M1` the
 * mail of a wave that ended days earlier. A row stamped for another team is not this team's, and an
 * UNSTAMPED row predates the field, so no team can prove it owns it either. This is the rule `summary`
 * applies, spelled ONCE here: the send bound, `summary` and the mail tool's `unread` branch all narrow
 * through this function, so they cannot drift apart about which rows a team owns.
 *
 * @param state - the folded mailbox to narrow.
 * @param teamId - the claiming team; `undefined` or empty means no team was resolved, so the whole fold
 *   comes back — there is no identity to scope by.
 * @returns the state narrowed to the rows this team can claim.
 */
export function scopeToTeam(state: MailboxState, teamId: string | undefined): MailboxState {
  if (teamId === undefined || teamId === "") return state
  // THE PROBLEM LIST SURVIVES SCOPING: the anomalies are properties of the LOG, not of a team's slice,
  // so a team-scoped read must still be able to report that the log had a duplicate id (R2's N2).
  return {
    messages: state.messages.filter((message) => message.teamId === teamId),
    ...(state.problems === undefined ? {} : { problems: state.problems }),
  }
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
  /** Messages still OUTSTANDING — neither accepted by the transport nor acknowledged ({@link isOutstanding}). */
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
    // The SAME predicate the send bound measures, so this column and the bound can never disagree.
    if (isOutstanding(message)) entry.undelivered += 1
  }
  return order.map((id) => seen.get(id) as MailSummary)
}

/**
 * Why a send was refused. Each maps to one sentence a captain can act on.
 *
 * `invalid-envelope` is the whole protocol check (I1–I5, `mpd-mail-protocol`): the detail carries every
 * problem the validators found. `not-recipient` is the two ownership rules of contract §5 — only a
 * question's recipient may answer it, and an answer goes back to the asker.
 */
export type SendRefusal = "self" | "unknown-recipient" | "backlog-full" | "invalid-envelope" | "not-recipient"

/** The outcome of a send attempt. */
export type SendResult = { ok: true; message: MailMessage } | { ok: false; reason: SendRefusal; detail: string }

/** The outcome of a multi-recipient send: one row per recipient, or a refusal that wrote NOTHING. */
export type SendManyResult = { ok: true; messages: MailMessage[] } | { ok: false; reason: SendRefusal; detail: string }

/** What one send needs. */
export interface SendInput {
  /** Sender's session id; equal to `toId` is refused as a self-send. */
  fromId: string
  /** Sender's display name, recorded onto the message. */
  fromName: string
  /** Recipient session id; it must appear in `memberIds` (or `leadIds`) or the send is refused. */
  toId: string
  /** Recipient's display name, echoed into refusals so they name a person, not an id. */
  toName: string
  /** One-line subject, stored exactly as given. */
  subject: string
  /** The instruction text, stored as given and delivered verbatim. */
  body: string
  /** The live roster: a message goes to a MEMBER, never to an id nobody serves. */
  memberIds: readonly string[]
  /**
   * The team this send belongs to, stamped onto the message so a later summary can scope by IDENTITY
   * rather than by the per-team member ids (`M1`, `M2`, …) that every team reuses (PR #42 review F-C).
   * Absent only for a caller that resolved no team at all.
   */
  teamId?: string
  /** The bound on a member's undelivered backlog, absorbed from the official `TEAM_MAILBOX_FULL`. */
  maxUndelivered?: number
  /** Which envelope the row carries; absent means a plain `message`, the legacy default (contract §5). */
  kind?: MailKind
  /** The message id this row replies to; a reply without a thread inherits this one's thread (I5/I7). */
  replyTo?: string
  /** The thread the sender claims explicitly; every fan-out row of one send shares it (I6/I7). */
  threadId?: string
  /** Present exactly on a `question` row: the options a recipient answers by LABEL (I1–I4). */
  question?: MailQuestion
  /** Present exactly on an `answer` row: the labels echoed verbatim (I3/I4). */
  answer?: MailAnswer
  /**
   * Ids addressable BESIDE the member roster — the team lead, addressed as `captain` (contract §5).
   *
   * WHY SEPARATE FROM `memberIds`: a lead is not a board member, so the roster alone would refuse mail
   * to it while a broadcast must still reach it.
   */
  leadIds?: readonly string[]
  /** The cell that wrote this row, when the cellwork view stamps one (pass-through, no team rule). */
  cellId?: string
  /** The cell this row came from, on the same pass-through rule. */
  fromCell?: string
  /** The sender's roster id (`M1`), when it has one — the identity the ownership rules compare. */
  fromMemberId?: string
}

/** Who a mailbox call may address: the live roster, the team lead, and the sender itself. */
export interface MailDirectory {
  /** The live roster, by id and display name; a member is addressable either way. */
  members: readonly MailAddress[]
  /** The team lead, when this team records one; `captain` and `lead` both resolve to it. */
  lead?: MailAddress
  /** The sending session, excluded from a broadcast (I6: the sender is never a recipient). */
  selfId: string
}

/** The addresses one `to` argument resolves to, or the refusal that spells the roster out. */
export type MailTargets = { ok: true; targets: MailAddress[]; broadcast: boolean } | { ok: false; reason: "unknown-recipient"; detail: string }

/**
 * Resolve a `to` argument into the addresses a send mints one row each for.
 *
 * The accepted spellings are contract §5's: a member id, a member NAME, `captain`/`lead` (the team
 * lead, recorded with the display name `captain` whatever alias was used) and `"*"` (every member plus
 * the lead, the sender excluded). Anything else is refused WITH the roster, because a typo must never
 * read as "no such person" on a row already addressed to somebody else.
 *
 * @param directory - the roster, the lead and the sender this call is resolved against.
 * @param to - the caller's address argument, taken verbatim.
 * @returns the recipients to mint one row each for, and whether this call is a broadcast.
 */
export function resolveRecipients(directory: MailDirectory, to: string): MailTargets {
  /** The argument without surrounding space; the tool passes user text through unchanged. */
  const spelling = to.trim()
  /** The lower-cased spelling, used only for the two reserved aliases. */
  const alias = spelling.toLowerCase()
  /** Every address this directory offers, in the order a refusal lists them. */
  const all: MailAddress[] = directory.lead === undefined ? [...directory.members] : [...directory.members, directory.lead]
  /** The names a refusal spells, so a typo is correctable without a second call. */
  const names = all.map((address) => (address.name === "" ? address.id : address.name)).join(", ")
  if (spelling === "*") {
    // I6: a broadcast is a FAN-OUT of single-recipient rows with the sender excluded — never one row
    // with several recipients, which would make per-recipient ack and the backlog bound meaningless.
    return { ok: true, targets: fanOutTargets(directory.selfId, all), broadcast: true }
  }
  if (alias === "captain" || alias === "lead") {
    if (directory.lead === undefined) {
      return { ok: false, reason: "unknown-recipient", detail: `this team records no lead, so "${spelling}" is not addressable (members: ${names || "none"})` }
    }
    // The recorded NAME is `captain` whatever alias resolved it, so a later reader sees the role.
    return { ok: true, targets: [{ id: directory.lead.id, name: "captain" }], broadcast: false }
  }
  /** The member this spelling names, by id first and then by display name (the tool's old rule). */
  const member = directory.members.find((address) => address.id === spelling) ?? directory.members.find((address) => address.name === spelling)
  if (member === undefined) {
    return { ok: false, reason: "unknown-recipient", detail: `"${spelling}" is not a member of this team (members: ${names || "none"})` }
  }
  return { ok: true, targets: [{ id: member.id, name: member.name }], broadcast: false }
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
  /** The batch of exactly one target — a single send is the fan-out of one. */
  const result = sendMany(workspace, input, [{ id: input.toId, name: input.toName }], now)
  if (!result.ok) return result
  /** The row this single send wrote; a one-target batch always yields exactly one. */
  const message = result.messages[0]
  return { ok: true, message }
}

/**
 * Render the protocol's problems as ONE sentence a caller can act on.
 *
 * I4's refusal carries the full valid label list in `problem.labels` rather than in its prose, so the
 * list is inlined here: a sender that echoed the wrong label can correct it from the refusal alone,
 * without folding the mailbox itself.
 *
 * @param check - the failed validator result, with at least one problem.
 * @returns the problems joined, each valid-label list inlined beside its message.
 */
function problemsSentence(check: { ok: false; problems: readonly MailProblem[] }): string {
  return check.problems
    .map((problem) => (problem.labels === undefined ? problem.message : `${problem.message} (valid labels: ${problem.labels.join(", ")})`))
    .join("; ")
}

/**
 * The ONE refusal an unauthorized answer gets (T23): an absent id, a row that is not a question and a
 * FOREIGN question are INDISTINGUISHABLE — same `not-recipient` reason, same sentence, and only the id
 * the caller already supplied echoed back. Naming whether a workspace message exists would be an
 * existence oracle (`mail-<instant>-<seq>` ids are guessable), so every authorization refusal shares
 * this sentence and never names the addressee.
 * @param messageId - the `answerTo` id the caller supplied.
 * @returns the uniform refusal sentence.
 */
function unauthorizedAnswer(messageId: string): string {
  return "only a recipient of the question may answer it: " + messageId
}

/**
 * Validate and append ONE ROW PER RECIPIENT — the fan-out a broadcast is built from (I6).
 *
 * Every rule runs BEFORE the first line is written, so a refused fan-out leaves the log untouched:
 * the address rules, the envelope's protocol check (I1–I4), its references (I5), the two ownership
 * rules below, and — PER RECIPIENT, not per broadcast — the undelivered bound.
 *
 * The fan-out rows share the send instant, the envelope (`kind`/`question`/`answer`) and ONE thread
 * (I6/I7): an explicit or inherited thread wins, and otherwise the batch's FIRST message id names it.
 *
 * @param workspace - the workspace whose mailbox this is.
 * @param input - the message, the roster and the envelope every row carries.
 * @param targets - the recipients, already resolved by {@link resolveRecipients}; one row each.
 * @param now - the clock, injected so the rules are testable.
 * @returns the recorded messages in target order, or the refusal and what it means.
 */
export function sendMany(workspace: string, input: SendInput, targets: readonly MailAddress[], now: Date): SendManyResult {
  /**
   * The row this one replies to: an explicit `replyTo`, else the QUESTION an answer cites (I7).
   *
   * WHY THE ANSWER CASE IS DERIVED: an answer IS a reply to the question it answers, so without this
   * the answer would open a thread of its own and the exchange would read as two unrelated rows. The
   * derived value is still a normal `replyTo`, checked by {@link validateReferences} like any other.
   */
  const replyTo = input.replyTo !== undefined && input.replyTo !== ""
    ? input.replyTo
    : input.kind === "answer" && input.answer !== undefined && input.answer.answerTo !== ""
      ? input.answer.answerTo
      : undefined
  /** The envelope every row of this send carries; `kind` absent means the legacy `message`. */
  const envelope: MailEnvelope = {
    kind: input.kind ?? "message",
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(input.threadId === undefined || input.threadId === "" ? {} : { threadId: input.threadId }),
    ...(input.question === undefined ? {} : { question: input.question }),
    ...(input.answer === undefined ? {} : { answer: input.answer }),
  }
  /** Ids this team accepts mail for: its board members plus the lead it addresses as `captain`. */
  const addressable = new Set<string>([...input.memberIds, ...(input.leadIds ?? [])])
  /** Every spelling of the sender's identity: its session id and, when it has one, its roster id. */
  const senderIds = new Set<string>([input.fromId, ...(input.fromMemberId === undefined || input.fromMemberId === "" ? [] : [input.fromMemberId])])
  for (const target of targets) {
    // SELF IS BOTH SPELLINGS (R2's F1, the D16c class): a row is ADDRESSED to a roster id (`M1`) while
    // the sender names itself by session id, so comparing `fromId` alone let a member message its own
    // roster row — and let its own `*` broadcast include itself. ONE rule, either spelling.
    if (senderIds.has(target.id)) return { ok: false, reason: "self", detail: "a team member cannot message itself" }
    if (!addressable.has(target.id)) return { ok: false, reason: "unknown-recipient", detail: `"${target.name || target.id}" is not a member of this team` }
  }
  /** The envelope's own rules: no index field (I1), the option and selection shapes (I2/I3). */
  const envelopeCheck = validateEnvelope(envelope)
  if (!envelopeCheck.ok) {
    return { ok: false, reason: "invalid-envelope", detail: problemsSentence(envelopeCheck) }
  }
  /** The mailbox as it stands: the authorization, the reference check, the backlog bound and the ids read it. */
  const state = readMailbox(workspace)
  /**
   * THIS TEAM's rows — the SAME {@link scopeToTeam} narrowing the backlog bound and `summary` read, so a
   * count can never be measured against a finished wave's same-named member.
   */
  const scoped = scopeToTeam(state, input.teamId)
  /** The WHOLE workspace's folded rows by id: I5 references and the answer authorization resolve here. */
  const workspaceById = new Map(state.messages.map((message) => [message.id, message]))
  // AUTHORIZATION BEFORE THE ECHO (T21 / R2's F1+F2). An answer's ownership is decided from the
  // WORKSPACE row, BEFORE `validateReferences` can return the question's label list: that validator is
  // the I4 correction aid, and handing it to anybody who can name a question id turns a refusal into a
  // cross-team disclosure channel.
  //
  // NO EXISTENCE ORACLE (T23 / T22's F1): an ABSENT id, a row that is not a question and a FOREIGN
  // question all fail with the SAME `not-recipient` sentence, which echoes only the id the caller
  // supplied. The refusal therefore never says whether that id exists, and never names the addressee.
  if (envelope.kind === "answer" && envelope.answer !== undefined) {
    // An answer's ONLY thread source is the question it answers (contract §5): a different `replyTo`
    // would let the sender name an arbitrary message and inherit THAT conversation's thread id. This is
    // checked BEFORE the workspace lookup, so a mismatched `replyTo` answers identically for an absent
    // and an existing `answerTo` — it must not become a second existence probe (T23).
    if (envelope.replyTo !== undefined && envelope.replyTo !== envelope.answer.answerTo) {
      return { ok: false, reason: "invalid-envelope", detail: "an answer's `replyTo` must be the question message it answers (`answerTo`)" }
    }
    /** The workspace row the answer claims to answer, when the workspace holds one. */
    const asked = workspaceById.get(envelope.answer.answerTo)
    if (asked === undefined || asked.kind !== "question") {
      return { ok: false, reason: "not-recipient", detail: unauthorizedAnswer(envelope.answer.answerTo) }
    }
    // THE SAME MEMBER, TWO SPELLINGS: a row is addressed to the ROSTER id (`M1`) while a session answers
    // as its own session id, so both spellings of the sender count as "the recipient".
    /** Every id that identifies the sender on this row. */
    const senderIds = new Set<string>([input.fromId, ...(input.fromMemberId === undefined || input.fromMemberId === "" ? [] : [input.fromMemberId])])
    /** Every id that identifies the ASKER, read off the question row it recorded at send time. */
    const askerIds = new Set<string>([asked.fromId, ...(asked.fromMemberId === undefined ? [] : [asked.fromMemberId])].filter((id) => id !== ""))
    // OWNERSHIP (contract §5) on the WORKSPACE row: a legitimate cross-cell answer (its sender IS the
    // addressee) still passes; a stranger gets the SAME sentence as an absent id, so the answer path
    // cannot even confirm that the question exists.
    if (!senderIds.has(asked.toId)) {
      return { ok: false, reason: "not-recipient", detail: unauthorizedAnswer(envelope.answer.answerTo) }
    }
    for (const target of targets) {
      // …and the answer goes BACK to the asker, which is what makes "only the asker may ack an answer"
      // (the acknowledgement rule) mechanically true rather than a convention.
      if (!askerIds.has(target.id)) {
        return { ok: false, reason: "not-recipient", detail: `an answer goes back to the asker ("${asked.fromName}"), not to "${target.name || target.id}"` }
      }
    }
  }
  // ONLY a proven addressee (or a non-answer row) reaches the reference/echo pass: for a non-answer it
  // checks `replyTo` existence; for an answer it now also validates the echoed labels.
  /** I5: a reply or an answer must reference a message THIS workspace mailbox holds; I4's echo for answers. */
  const referenceCheck = validateReferences(envelope, state.messages)
  if (!referenceCheck.ok) {
    return { ok: false, reason: "invalid-envelope", detail: problemsSentence(referenceCheck) }
  }
  /** Effective backlog bound; zero or less disables the bound entirely. */
  const cap = input.maxUndelivered ?? 8
  for (const target of targets) {
    /** How many rows THIS TEAM sent this recipient and nobody has accepted nor acknowledged. */
    const backlog = undeliveredOf(scoped, target.id).length
    if (cap > 0 && backlog >= cap) {
      return { ok: false, reason: "backlog-full", detail: `"${target.name || target.id}" already has ${backlog} undelivered message(s) (bound ${cap}) — it is not keeping up` }
    }
  }
  /** The send instant, shared by every row and by the id sequence. */
  const at = now.toISOString()
  /** The clock-derived id stem; the row sequence below makes each id unique within the mailbox. */
  const stem = `mail-${at.replace(/[-:.TZ]/g, "").slice(0, 14)}-`
  /** The ids this send mints, in target order; the FIRST one names the thread when none was given. */
  const ids = targets.map((_target: MailAddress, index: number) => stem + (state.messages.length + 1 + index).toString().padStart(3, "0"))
  // NO CROSS-TEAM THREAD LEAK (T21): an ANSWER has just been authorized, so it may inherit its thread
  // from the workspace row it answers (the cross-cell round-trip needs that). A PLAIN reply resolves its
  // thread only within its own team, so replying to a foreign message id cannot disclose that
  // conversation's thread root; the reference itself is still checked workspace-wide above.
  /** The map the reply's thread resolves through, chosen by whether the row was authorized. */
  const threadById = envelope.kind === "answer" ? workspaceById : new Map(scoped.messages.map((message) => [message.id, message]))
  /** The ONE thread every row of this send shares: explicit, else inherited, else this send's first id (I6/I7). */
  const threadId = inheritedThreadId(envelope, threadById) ?? ids[0]
  /** The body as STORED: bounded at {@link MAIL_BODY_MAX}, with its pre-cut length when it was cut. */
  const storedBody = truncateMailBody(input.body)
  /** The rows, one per recipient, each carrying the same envelope and the same thread. */
  const messages: MailMessage[] = targets.map((target: MailAddress, index: number) => ({
    id: ids[index],
    kind: envelope.kind,
    ...(envelope.replyTo === undefined ? {} : { replyTo: envelope.replyTo }),
    threadId,
    ...(envelope.question === undefined ? {} : { question: envelope.question }),
    ...(envelope.answer === undefined ? {} : { answer: envelope.answer }),
    fromId: input.fromId,
    fromName: input.fromName,
    toId: target.id,
    toName: target.name,
    subject: input.subject,
    body: storedBody.body,
    ...(storedBody.truncated ? { truncated: true, originalLength: storedBody.originalLength } : {}),
    sentAt: at,
    ...(input.teamId === undefined || input.teamId === "" ? {} : { teamId: input.teamId }),
    ...(input.cellId === undefined || input.cellId === "" ? {} : { cellId: input.cellId }),
    ...(input.fromCell === undefined || input.fromCell === "" ? {} : { fromCell: input.fromCell }),
    ...(input.fromMemberId === undefined || input.fromMemberId === "" ? {} : { fromMemberId: input.fromMemberId }),
  }))
  for (const message of messages) appendRecord(workspace, { t: "send", ...message, at })
  return { ok: true, messages }
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
 * Who is acknowledging, and the name recorded on the `read` row.
 *
 * The ID is the roster member id the row was addressed to (`M1`) or, for a lead that has no board row,
 * its session id. The NAME is what the log keeps, so a human reads an acknowledgement without a roster
 * lookup. Both are needed: the id is the ownership check, the name is the record.
 */
export interface MailAck {
  /** The acknowledging member's id — the one value the ownership rule compares. */
  byId: string
  /** The acknowledging member's display name, recorded on the `read` line. */
  byName: string
}

/** One id that was not acknowledged, and the sentence saying why. */
export interface AckRefusal {
  /** The message id the caller asked to acknowledge. */
  id: string
  /** Why it was refused: it is not addressed to this member (contract §5). */
  reason: string
}

/** The outcome of an acknowledgement: the ids that moved, and the ids that were refused. */
export interface AckResult {
  /** The ids that actually moved from unread to read. */
  moved: string[]
  /** The ids refused because they are not addressed to this member. */
  refused: AckRefusal[]
}

/**
 * Acknowledge messages: the recipient SAYS it has read them, which is the transition the harness
 * cannot observe and the reason this mailbox exists.
 *
 * OWNERSHIP IS THE CALLER'S OWN ADDRESSED ROWS (contract §5). There is no administrative escape: a
 * member acknowledges what was addressed to IT, and an id addressed to somebody else is refused here
 * rather than silently marked read on that member's behalf. "Only the asker may ack an answer" follows
 * from the same rule, because an answer row is addressed to the asker and only that address can ack it.
 *
 * @param workspace - the workspace whose mailbox this is.
 * @param ids - the messages the caller wants to acknowledge.
 * @param ack - who is acknowledging; its id is the ownership check, its name goes on the record.
 * @param now - the clock, injected so the rules are testable.
 * @returns the ids that moved, plus every id refused and the reason.
 */
export function acknowledge(workspace: string, ids: readonly string[], ack: MailAck, now: Date): AckResult {
  /** The mailbox as it stands, so a repeat acknowledgement is a no-op. */
  const state = readMailbox(workspace)
  /** Messages indexed by id, to resolve each requested id in one lookup. */
  const byId = new Map(state.messages.map((message) => [message.id, message]))
  /** Ids that actually moved from unread to read. */
  const moved: string[] = []
  /** Ids this member may not acknowledge, each with the sentence that says so. */
  const refused: AckRefusal[] = []
  for (const id of ids) {
    /** The message this id resolves to, or undefined when the mailbox does not know it. */
    const message = byId.get(id)
    if (message === undefined || message.readAt !== undefined) continue
    // THE OWNERSHIP RULE: a row is acknowledged by the member it was ADDRESSED to, never by anybody else.
    if (message.toId !== ack.byId) {
      refused.push({ id, reason: `${id} was addressed to "${message.toName}", not to "${ack.byName}" — only its recipient may acknowledge it` })
      continue
    }
    appendRecord(workspace, { t: "read", id, at: now.toISOString(), by: ack.byName })
    moved.push(id)
  }
  return { moved, refused }
}

/**
 * Acknowledge messages and answer only the ids that moved.
 *
 * The SAME ownership rule as {@link acknowledge} — this shape exists for a caller that needs the ids
 * alone, so the two entry points can never disagree about who may acknowledge what.
 *
 * @param workspace - the workspace whose mailbox this is.
 * @param ids - the messages the caller wants to acknowledge.
 * @param ack - who is acknowledging; its id is the ownership check, its name goes on the record.
 * @param now - the clock, injected so the rules are testable.
 * @returns the ids that actually moved from unread to read.
 */
export function markRead(workspace: string, ids: readonly string[], ack: MailAck, now: Date): string[] {
  return acknowledge(workspace, ids, ack, now).moved
}
