// THE PERMIT-BOUNDED WAIT (frozen contract `.mpd/plans/mail-unify.md` §7; AC-4 in §8).
//
// WHY A PERMIT EXISTS AT ALL. Every mail call in this bundle is NON-BLOCKING by default: a send records
// a row and returns, and a member reads its inbox on its own turn. A blocking wait is the one operation
// that can park a whole agent behind another agent's turn, so it is not a free capability — it is a
// TTL-bound grant from the caller's captain, written into the workspace and checked on EVERY wait. The
// default therefore stays non-blocking, and a caller that never holds a permit cannot stall anybody.
//
// THE RECORD is one JSON line in `<workspace>/.mpd/team/permits.jsonl` (contract §7):
//   {t:"permit", permitId, issuerId, issuerName, holderId, holderName, scope, ttlMs, expiresAt,
//    questionId?, at}
// `expiresAt` is an ISO instant like every other timestamp this plane writes, and `scope` says what may
// be waited on: "answer" waits for an answer CORRELATED to a question row, "message" waits for any reply
// to a row. The permit carries no team stamp on purpose — the frozen record shape has none — and the
// cross-team case is closed by the ISSUER check instead: the permit must have been issued by a session
// that is this team's captain, and a captain session does not repeat across teams the way member ids do.
//
// APPEND-ONLY AND TORN-LINE TOLERANT, exactly like the mailbox store this sits beside: one record per
// line, never rewritten, so a crash costs the last line and never the file; a malformed or foreign line
// is SKIPPED and REPORTED, never fatal. A duplicated permit id is tolerated with the FIRST write winning
// and a reported problem, the same declared rule the mailbox fold applies (contract §12 names the
// tolerance as the invariant both stores must keep).
//
// WHAT THIS MODULE DOES NOT DECIDE: WHO may issue a permit. Captaincy lives on the team record, so the
// tool boundary resolves it (`agent_teams_mail action:"permit"` is captain/lead-only) and this module
// receives an already-authorized issuer. Nor does it decide a caller's display name: it validates a
// permit against the identity the caller resolved.

import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { MailboxState, MailMessage } from "./mailbox-store"

/** The two things a permit may authorize waiting for: an answer to a question, or a reply to a row. */
export type PermitScope = "answer" | "message"

/** The scopes in declaration order, so a validator or a refusal never hard-codes the list twice. */
export const PERMIT_SCOPES: readonly PermitScope[] = ["answer", "message"]

/**
 * Whether a runtime value names one of the two wait scopes.
 * @param value - the value to test, typically a tool argument or a loose JSON field.
 * @returns true exactly for `answer` and `message`.
 */
export function isPermitScope(value: unknown): value is PermitScope {
  return value === "answer" || value === "message"
}

/** The TTL a permit is minted with when the issuer names none, in milliseconds. */
export const PERMIT_DEFAULT_TTL_MS = 60_000

/** The longest TTL a permit may carry, in milliseconds: a grant is a bounded exception, not a lease. */
export const PERMIT_MAX_TTL_MS = 600_000

/** The longest a single wait may block, in milliseconds — well inside the adapter's 120 s tool default. */
export const WAIT_MAX_TIMEOUT_MS = 60_000

/** The wait used when the caller names no `timeoutMs`, in milliseconds. */
export const WAIT_DEFAULT_TIMEOUT_MS = 15_000

/** How often a wait re-reads the mailbox while it is blocked, in milliseconds. */
export const WAIT_POLL_INTERVAL_MS = 50

/**
 * One permit line, exactly the shape contract §7 freezes.
 *
 * `ttlMs` is the GRANTED bound (the requested value clamped to {@link PERMIT_MAX_TTL_MS}) and
 * `expiresAt` is derived from it at issue time, so a reader never recomputes a permit's lifetime from
 * a clock other than the one that minted it.
 */
export interface PermitRecord {
  /** The record discriminator: this log carries permits and nothing else, but a foreign line stays readable. */
  t: "permit"
  /** Unique within the log; the id a `wait` names and the only handle a permit has. */
  permitId: string
  /** The issuing captain's session id — the identity the issuer check compares against the team record. */
  issuerId: string
  /** The issuing captain's display name at issue time, echoed into refusals so they name a person. */
  issuerName: string
  /** The member this grant belongs to: the roster id at issue time (`M1`), never a session id. */
  holderId: string
  /** The member's display name at issue time; the tolerant fallback when a session id moved. */
  holderName: string
  /** What the holder may wait for; see {@link PermitScope}. */
  scope: PermitScope
  /** How long the grant lasts from `at`, in milliseconds, after clamping to the hard bound. */
  ttlMs: number
  /** ISO instant the grant lapses; `wait` refuses at or after it. */
  expiresAt: string
  /** The question this grant is narrowed to, when the captain scoped it; absent means any question. */
  questionId?: string
  /** ISO instant the permit was written. */
  at: string
}

/** The folded permit log: the valid permits in append order, plus every line the fold had to skip. */
export interface PermitFold {
  /** The valid permits, oldest first; a duplicated id keeps the FIRST record only. */
  permits: PermitRecord[]
  /** One sentence per tolerated anomaly — a foreign or malformed line, a duplicated id. */
  problems: string[]
}

/** The file one workspace's permits live in. */
export function permitsPath(workspace: string): string {
  return join(workspace, ".mpd", "team", "permits.jsonl")
}

/**
 * Every record in the permit log, oldest first. A missing file is an empty log.
 *
 * Torn-line tolerance is the SAME rule the mailbox store applies: a half-written LAST line is the only
 * expected corruption, so an unparsable line is skipped and the rest of the log is kept. It is
 * duplicated here rather than imported because the mailbox's reader returns ITS record union, and this
 * module must not depend on the mailbox to read its own file.
 * @param workspace - the workspace whose permit log this is.
 * @returns the parsed lines in file order; a malformed line is simply absent from the log it returns.
 */
export function readPermitRecords(workspace: string): unknown[] {
  /** The permit log for this workspace; a missing file reads as an empty log. */
  const path = permitsPath(workspace)
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

/**
 * Whether one parsed line carries the full permit shape.
 *
 * The check is deliberately complete rather than optimistic: a record missing `expiresAt` or carrying a
 * scope this module does not know could never be validated, so it is SKIPPED and reported by
 * {@link foldPermits} instead of being admitted as a half-valid grant.
 * @param value - one parsed log line, of unknown shape.
 * @returns true exactly when every required field is present and well-typed.
 */
function isPermitRecord(value: unknown): value is PermitRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  /** The line read as a loose record; every field is narrowed below before it is trusted. */
  const line = value as Record<string, unknown>
  if (line.t !== "permit") return false
  for (const field of ["permitId", "issuerId", "issuerName", "holderId", "holderName", "at"] as const) {
    if (typeof line[field] !== "string" || line[field].trim() === "") return false
  }
  if (!isPermitScope(line.scope)) return false
  if (typeof line.ttlMs !== "number" || !Number.isFinite(line.ttlMs) || line.ttlMs <= 0) return false
  if (typeof line.expiresAt !== "string" || !Number.isFinite(Date.parse(line.expiresAt))) return false
  return line.questionId === undefined || typeof line.questionId === "string"
}

/**
 * Fold the permit log into its current state.
 *
 * Pure: no I/O, no clock. The fold is total — a foreign line, a malformed permit and a duplicated id
 * are all tolerated and each is REPORTED, so a damaged log stays diagnosable instead of silently
 * smaller.
 * @param records - the parsed log lines, oldest first; a torn trailing line may be included.
 * @returns the valid permits in append order plus the problems the fold skipped.
 */
export function foldPermits(records: readonly unknown[]): PermitFold {
  /** The valid permits, in the order the log records them. */
  const permits: PermitRecord[] = []
  /** One sentence per skipped line, so tolerance is never silence. */
  const problems: string[] = []
  /** The ids already admitted, so a duplicate is skipped rather than shadowing its predecessor. */
  const seen = new Set<string>()
  for (const raw of records) {
    if (!isPermitRecord(raw)) {
      problems.push("skipped a line that does not carry the permit shape (t:\"permit\" with every field)")
      continue
    }
    if (seen.has(raw.permitId)) {
      problems.push(`skipped a duplicate permit id "${raw.permitId}" (the FIRST write wins)`)
      continue
    }
    seen.add(raw.permitId)
    permits.push(raw)
  }
  return { permits, problems }
}

/** Read the current permit state for one workspace. */
export function readPermits(workspace: string): PermitFold {
  return foldPermits(readPermitRecords(workspace))
}

/** Append one permit. Creates the directory the first time. */
export function appendPermit(workspace: string, permit: PermitRecord): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  appendFileSync(permitsPath(workspace), JSON.stringify(permit) + "\n")
}

/**
 * The already-validated input {@link buildPermit} turns into a record.
 *
 * Separate from {@link IssuePermitInput} on purpose: this one receives a KNOWN scope and a known
 * positive TTL, so the builder has no refusal path and stays a pure function of its inputs.
 */
export interface BuildPermitInput {
  /** The issuing captain's session id. */
  issuerId: string
  /** The issuing captain's display name. */
  issuerName: string
  /** The member's roster id. */
  holderId: string
  /** The member's display name. */
  holderName: string
  /** The validated scope. */
  scope: PermitScope
  /** The requested TTL in milliseconds; clamped to {@link PERMIT_MAX_TTL_MS} by the builder. */
  ttlMs: number
  /** The question this grant is narrowed to, when the captain gave one; empty or absent means any. */
  questionId?: string
  /** The id to mint under, when a caller needs it deterministic; absent mints a fresh UUID-based id. */
  permitId?: string
}

/**
 * Build one permit record from validated inputs. Pure: the clock is injected, nothing is written.
 * @param input - the granted scope, TTL and identities.
 * @param now - the issue instant; `expiresAt` is derived from it and the clamped TTL.
 * @returns the record a caller appends through {@link appendPermit}.
 */
export function buildPermit(input: BuildPermitInput, now: Date): PermitRecord {
  /** The TTL actually granted: positive, floored, and never above the hard bound. */
  const ttlMs = Math.min(Math.max(Math.floor(input.ttlMs), 1), PERMIT_MAX_TTL_MS)
  /** The question narrowing, trimmed; an empty spelling means "no narrowing" rather than "question ''". */
  const questionId = input.questionId === undefined ? "" : input.questionId.trim()
  return {
    t: "permit",
    permitId: input.permitId === undefined || input.permitId.trim() === "" ? `permit-${randomUUID()}` : input.permitId.trim(),
    // Every identity is TRIMMED before it is stored: the record is what later checks compare against,
    // and a padded id would silently fail an equality the issuer believed it satisfied.
    issuerId: input.issuerId.trim(),
    issuerName: input.issuerName.trim(),
    holderId: input.holderId.trim(),
    holderName: input.holderName.trim(),
    scope: input.scope,
    ttlMs,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ...(questionId === "" ? {} : { questionId }),
    at: now.toISOString(),
  }
}

/** What one `permit` request carries: the identities, plus the caller's raw scope/TTL spelling. */
export interface IssuePermitInput {
  /** The issuing captain's session id, already authorized by the tool boundary. */
  issuerId: string
  /** The issuing captain's display name. */
  issuerName: string
  /** The holder's roster id, already resolved from the team roster. */
  holderId: string
  /** The holder's display name. */
  holderName: string
  /** The raw `scope` argument: absent defaults to `answer`; anything else must be a {@link PermitScope}. */
  scope?: unknown
  /** The raw `ttlMs` argument: absent defaults to {@link PERMIT_DEFAULT_TTL_MS}. */
  ttlMs?: unknown
  /** The raw `questionId` argument, narrowing the grant to one question. */
  questionId?: unknown
  /** The id to mint under, for a deterministic test; absent mints a fresh one. */
  permitId?: string
}

/** The outcome of one issue: the appended record, or the sentence that says why nothing was written. */
export type IssuePermitResult = { ok: true; permit: PermitRecord } | { ok: false; detail: string }

/**
 * Validate, mint and append ONE permit.
 *
 * Validation happens BEFORE the first byte is written, so a refused issue leaves the log untouched:
 * both identities must be non-empty (an unattributable grant can never be checked), the scope must be
 * one of the two known ones, and the TTL must be a positive finite number of milliseconds.
 * @param workspace - the workspace whose permit log this is.
 * @param input - the request as the tool boundary received it.
 * @param now - the issue instant, injected so the rules are testable.
 * @returns the appended permit, or the refusal sentence.
 */
export function issuePermit(workspace: string, input: IssuePermitInput, now: Date): IssuePermitResult {
  if (input.issuerId.trim() === "" || input.holderId.trim() === "") {
    return { ok: false, detail: "a permit needs a non-empty issuer and holder — an unattributable grant can never be validated" }
  }
  /** The validated scope: absent means `answer`, the narrower grant, so the default never widens. */
  const scope = input.scope === undefined ? "answer" : input.scope
  if (!isPermitScope(scope)) {
    return { ok: false, detail: `scope must be one of ${PERMIT_SCOPES.map((entry) => `"${entry}"`).join(" or ")} — got ${JSON.stringify(input.scope ?? null)}` }
  }
  /** The requested TTL as a number; a string spelling is accepted because tool arguments arrive as text. */
  const requestedTtl = input.ttlMs === undefined ? PERMIT_DEFAULT_TTL_MS : Number(input.ttlMs)
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
    return { ok: false, detail: `ttlMs must be a positive number of milliseconds (bound ${PERMIT_MAX_TTL_MS}) — got ${JSON.stringify(input.ttlMs ?? null)}` }
  }
  /** The narrowing question id, trimmed; an empty spelling is "no narrowing", never an empty id. */
  const questionId = input.questionId === undefined ? "" : String(input.questionId).trim()
  /** The record this issue mints, under the requested id or a fresh one. */
  const permit = buildPermit({
    issuerId: input.issuerId,
    issuerName: input.issuerName,
    holderId: input.holderId,
    holderName: input.holderName,
    scope,
    ttlMs: requestedTtl,
    ...(questionId === "" ? {} : { questionId }),
    ...(input.permitId === undefined ? {} : { permitId: input.permitId }),
  }, now)
  appendPermit(workspace, permit)
  return { ok: true, permit }
}

/** Why a wait was refused: one token per rule, so a caller can act on the reason instead of prose. */
export type PermitRefusal = "unknown" | "invalid" | "expired" | "foreign-holder" | "foreign-issuer" | "foreign-target" | "wrong-question" | "not-a-question"

/**
 * The identity a permit HOLDER is matched by — the same two spellings the permit and the ack use.
 *
 * ONE shape for the permit check and the target check, so "who is this caller" cannot be answered two
 * different ways inside one wait (CodeRabbit CR5).
 */
export interface WaitHolder {
  /** The caller's roster id when the team names it, else its session id (the D16c two-spelling rule). */
  holderId: string
  /** The caller's display name, the tolerant fallback when its session id was re-minted. */
  holderName: string
  /** The caller's own session id, accepted beside the roster id because a member is addressed both ways. */
  sessionId?: string
}

/** The identity a permit is validated against — resolved by the tool boundary from the team record. */
export interface PermitCaller extends WaitHolder {
  /** Every session id that may issue for this team (its Lead, plus the recorded Lead history). */
  leadIds?: readonly string[]
  /** The raw `timeoutMs` the wait asked for; absent uses {@link WAIT_DEFAULT_TIMEOUT_MS}. */
  requestedTimeoutMs?: number
}

/** A permit that passed every check, plus the timeout the wait may really use. */
export type PermitCheck =
  | { ok: true; permit: PermitRecord; timeoutMs: number }
  | { ok: false; reason: PermitRefusal; detail: string }

/**
 * Validate one permit for one caller at one instant.
 *
 * The order is deliberate: an UNKNOWN permit, then EXPIRY, then ownership, then the issuer's authority.
 * Expiry before ownership keeps an expired grant from being reported as a foreign one; the issuer check
 * last is what closes the cross-team hole described in the file header, because a member id (`M1`) is
 * reused by every team while a captain session is not.
 *
 * The returned timeout is BOUNDED THREE WAYS — the caller's request, {@link WAIT_MAX_TIMEOUT_MS}, and
 * what is left of the permit — so a valid wait can never outlive its grant.
 * @param permit - the folded permit the caller named, or undefined when the log holds no such id.
 * @param caller - who is waiting and which sessions may have issued for its team.
 * @param now - the instant the wait starts.
 * @returns the permit and its effective timeout, or the refusal token and its sentence.
 */
export function checkPermit(permit: PermitRecord | undefined, caller: PermitCaller, now: Date): PermitCheck {
  if (permit === undefined) return { ok: false, reason: "unknown", detail: "no such permit is recorded" }
  /** The permit's lapse instant; a record the fold admitted always parses, the check is defensive. */
  const expiresAt = Date.parse(permit.expiresAt)
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "invalid", detail: `permit ${permit.permitId} carries no parsable expiresAt ("${permit.expiresAt}")` }
  /** The instant the wait starts, read once so every comparison below sees the same clock. */
  const at = now.getTime()
  if (at >= expiresAt) {
    return { ok: false, reason: "expired", detail: `permit ${permit.permitId} expired at ${permit.expiresAt} (it is now ${now.toISOString()}) — ask its issuer for a fresh one` }
  }
  /** Every spelling of the caller's identity: the roster id first, the session id beside it. */
  const spellings = new Set<string>([caller.holderId, ...(caller.sessionId === undefined ? [] : [caller.sessionId])].filter((value) => value !== ""))
  if (!spellings.has(permit.holderId) && (caller.holderName === "" || caller.holderName !== permit.holderName)) {
    return { ok: false, reason: "foreign-holder", detail: `permit ${permit.permitId} was issued to "${permit.holderName}" ("${permit.holderId}"), not to this caller` }
  }
  /** The captain sessions this team accepts an issue from; empty means the team records no captain. */
  const leadIds = (caller.leadIds ?? []).filter((id) => id !== "")
  if (leadIds.length === 0) return { ok: false, reason: "foreign-issuer", detail: `permit ${permit.permitId} cannot be validated: this caller's team records no captain` }
  if (!leadIds.includes(permit.issuerId)) {
    return { ok: false, reason: "foreign-issuer", detail: `permit ${permit.permitId} was issued by "${permit.issuerName}" ("${permit.issuerId}"), who is not this caller's captain` }
  }
  /** What is left of the grant, in milliseconds; the wait may never exceed it. */
  const remaining = expiresAt - at
  /** The requested timeout, floored and never negative; a non-finite spelling falls back to the default. */
  const requested = caller.requestedTimeoutMs === undefined || !Number.isFinite(caller.requestedTimeoutMs) ? WAIT_DEFAULT_TIMEOUT_MS : Math.max(0, Math.floor(caller.requestedTimeoutMs))
  /** The effective timeout: the request, the hard bound and the permit's remainder, whichever is smallest. */
  const timeoutMs = Math.max(0, Math.min(requested, WAIT_MAX_TIMEOUT_MS, remaining))
  return { ok: true, permit, timeoutMs }
}

/** The verdict on a wait TARGET: the message the caller says it is waiting on. */
export type WaitTargetCheck = { ok: true } | { ok: false; reason: PermitRefusal; detail: string }

/**
 * Check that a wait target is what the permit's scope covers.
 *
 * A scope-`answer` permit waits on a `question` row. A scope-`message` permit waits on any row, since
 * any row can be replied to. When the captain NARROWED the grant with a `questionId`, the target must
 * carry that question id in BOTH scopes — otherwise a narrowed grant would be inert on a `message`
 * permit, and a wait it was never meant to cover would be admitted.
 *
 * OWNERSHIP (CodeRabbit CR5): the target must be a row the permit's holder SENT. A wait is an ASKER
 * waiting for the reply to its OWN question — the row it names is addressed to whoever must answer — so
 * the identity that has to match is `fromId`, not `toId`. Without the rule a grant scoped only to "a
 * question" let its holder wait on ANOTHER member's question and read that member's `selected` labels
 * out of the answers the wait assembles, which is exactly the cross-member leak the ownership rules
 * exist to prevent. Answering a question addressed to the holder is a SEND, never a wait, so no
 * legitimate wait is lost by requiring `fromId`.
 * @param permit - the validated permit.
 * @param target - the folded message the wait names.
 * @param holder - the waiting caller's identity, matched by the SAME spellings {@link checkPermit} uses.
 * @returns ok, or the refusal token and the sentence naming the mismatch.
 */
export function checkWaitTarget(permit: PermitRecord, target: MailMessage, holder: WaitHolder): WaitTargetCheck {
  /** Every id spelling of the holder: its roster id, and its session id when the tool resolved one. */
  const spellings = new Set<string>([holder.holderId, ...(holder.sessionId === undefined ? [] : [holder.sessionId])].filter((id) => id !== ""))
  if (!spellings.has(target.fromId)) {
    return { ok: false, reason: "foreign-target", detail: `permit ${permit.permitId} was issued to "${permit.holderName}", so it waits only on rows it SENT — "${target.id}" was sent by "${target.fromName}"` }
  }
  if (permit.scope === "answer" && target.kind !== "question") {
    return { ok: false, reason: "not-a-question", detail: `permit ${permit.permitId} has scope "answer", so it waits on a question; "${target.id}" is a ${target.kind} row` }
  }
  /** The question this grant was narrowed to, when the captain named one. */
  const questionId = permit.questionId
  if (questionId !== undefined && questionId !== "" && target.question?.questionId !== questionId) {
    return { ok: false, reason: "wrong-question", detail: `permit ${permit.permitId} is scoped to question "${questionId}", but "${target.id}" carries "${target.question?.questionId ?? ""}"` }
  }
  return { ok: true }
}

/**
 * The rows that answer a wait, in mailbox order.
 *
 * `answer` scope correlates on the answer's OWN keys — `answer.answerTo` and, when the question carries
 * one, `answer.questionId` — never on the answering member's identity, because an answer is ownership-
 * checked at SEND time (contract §5) and a second identity check here could only drop a valid answer.
 * `message` scope takes any row that replies to the target (`replyTo`, or an answer's `answerTo`).
 * @param state - the mailbox folded for the caller's team.
 * @param permit - the validated permit.
 * @param target - the folded row being waited on.
 * @returns every matching row in mailbox order; empty means "nothing yet".
 */
export function repliesTo(state: MailboxState, permit: PermitRecord, target: MailMessage): MailMessage[] {
  /** The question's own correlation key, when the target is a question that carries one. */
  const questionId = target.question?.questionId
  return state.messages.filter((message) => {
    if (message.id === target.id) return false
    if (message.answer !== undefined && message.answer.answerTo === target.id) {
      if (permit.scope === "message") return true
      return message.kind === "answer" && (questionId === undefined || message.answer.questionId === questionId)
    }
    return permit.scope === "message" && message.replyTo === target.id
  })
}

/** What one wait needs: the validated grant, the target, the clocks, and how it reads the mailbox. */
export interface WaitContext {
  /** The validated permit; its scope decides what counts as an answer. */
  permit: PermitRecord
  /** The folded row the caller waits on. */
  target: MailMessage
  /** The effective timeout from {@link checkPermit}, already bounded by the permit's remainder. */
  timeoutMs: number
  /** Reads the mailbox as the caller's TEAM can claim it; called once per poll. */
  read: () => MailboxState
  /** The wall clock, injected so a test can advance time without sleeping. */
  now: () => Date
  /** Waits one interval; injected so a test can drive the loop deterministically. */
  sleep: (ms: number) => Promise<void>
  /** The poll interval; absent uses {@link WAIT_POLL_INTERVAL_MS}. */
  intervalMs?: number
  /** The call's abort signal, honoured between polls so a cancelled call stops waiting. */
  signal?: AbortSignal
}

/** The outcome of one bounded wait: the assembled rows, or the reason nothing arrived in time. */
export type WaitOutcome =
  | { ok: true; messages: MailMessage[]; polls: number; waitedMs: number }
  | { ok: false; reason: "timeout" | "aborted"; polls: number; waitedMs: number }

/**
 * Poll the mailbox until something answers, the deadline passes, or the call is aborted.
 *
 * THE LOOP IS BOUNDED TWICE, and both bounds are mechanical rather than hopeful: a wall-clock deadline
 * derived from `timeoutMs`, AND a poll ceiling `ceil(timeoutMs / interval) + 1`. The poll ceiling is
 * what makes "no unbounded busy loop" true even for an injected clock that never advances — the loop
 * cannot outlive its own arithmetic. `timeoutMs: 0` therefore means exactly ONE read and a timeout.
 * @param context - the grant, the target, the clocks and the mailbox reader.
 * @returns the matching rows, or `{ok:false, reason:"timeout"|"aborted"}` with the poll count.
 */
export async function waitForReply(context: WaitContext): Promise<WaitOutcome> {
  /** The poll interval, floored to at least one millisecond so a zero interval cannot spin; a
   * non-finite spelling falls back to the documented interval rather than poisoning the arithmetic. */
  const intervalMs = Number.isFinite(context.intervalMs) ? Math.max(1, Math.floor(context.intervalMs ?? WAIT_POLL_INTERVAL_MS)) : WAIT_POLL_INTERVAL_MS
  /** The requested wait, floored and never negative; a non-finite spelling becomes ZERO, because the
   * conservative bound is one read and a timeout, never an endless loop on `NaN` arithmetic. */
  const timeoutMs = Number.isFinite(context.timeoutMs) ? Math.max(0, Math.floor(context.timeoutMs)) : 0
  /** The instant the wait started, so `waitedMs` reports the real elapsed time. */
  const startedAt = context.now().getTime()
  /** The wall-clock deadline: after this instant the wait reports a timeout. */
  const deadline = startedAt + timeoutMs
  /** The hard poll ceiling; the loop can never exceed it, whatever the injected clock does. */
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1)
  /** How many mailbox reads this wait performed — reported so a caller can see it really polled. */
  let polls = 0
  for (;;) {
    polls += 1
    /** The rows that answer the wait as the mailbox stands right now. */
    const found = repliesTo(context.read(), context.permit, context.target)
    if (found.length > 0) return { ok: true, messages: found, polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) }
    if (context.signal?.aborted === true) return { ok: false, reason: "aborted", polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) }
    if (polls >= maxPolls) return { ok: false, reason: "timeout", polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) }
    /** What is left before the deadline, in milliseconds. */
    const remaining = deadline - context.now().getTime()
    if (remaining <= 0) return { ok: false, reason: "timeout", polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) }
    await context.sleep(Math.min(intervalMs, remaining))
  }
}
