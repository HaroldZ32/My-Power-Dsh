// T27 PROBES (T25/T26 — CodeRabbit CR3 + CR5, coupling freeze, docs). Black-box over the store and the
// permit rules with THE EXACT identity values the tool passes; never edits the package.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { acknowledge, readMailbox, resolveRecipients, send, sendMany, type SendInput } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { checkPermit, checkWaitTarget, issuePermit, readPermits, type WaitHolder } from "../../../../packages/mpd-team-core-plugin/src/mail-permit.ts"
import type { MailMessage } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** A fresh workspace. */
function box(): string {
  return mkdtempSync(join(tmpdir(), "t27-probe-"))
}

/** The frozen clock. */
const NOW = new Date("2026-11-01T00:00:00.000Z")

/** One minute later. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

/** One folded-looking row for the pure permit checks. */
function row(over: Partial<MailMessage>): MailMessage {
  return { id: "mail-row", kind: "question", fromId: "member-session", fromName: "Senior Engineer", toId: "captain-session", toName: "captain", subject: "s", body: "b", sentAt: "t", threadId: "mail-row", ...over } as MailMessage
}

/** The holder identity the tool builds for an ordinary member: roster id + session id. */
const holder: WaitHolder = { holderId: "M1", holderName: "Senior Engineer", sessionId: "member-session" }

// ── CR5: the wait target must be a row the HOLDER SENT (fromId), never merely one addressed to it ──
{
  const ws = box()
  const issued = issuePermit(ws, { issuerId: "lead-session", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, NOW)
  const permit = (issued as { ok: true; permit: Parameters<typeof checkWaitTarget>[0] }).permit
  const ownBySession = checkWaitTarget(permit, row({ id: "own-session", fromId: "member-session" }), holder)
  const ownByRoster = checkWaitTarget(permit, row({ id: "own-roster", fromId: "M1" }), holder)
  const foreign = checkWaitTarget(permit, row({ id: "foreign", fromId: "child-Reviewer", fromName: "Reviewer" }), holder)
  // The case CodeRabbit described: a question ADDRESSED to the holder, but SENT by someone else.
  const addressedToHolder = checkWaitTarget(permit, row({ id: "addressed-to-holder", fromId: "child-Reviewer", fromName: "Reviewer", toId: "M1", toName: "Senior Engineer" }), holder)
  // Why `toId` would be wrong: the legitimate question's toId is the ANSWERER, never the holder.
  const legitimate = row({ id: "own-session", fromId: "member-session" })
  show("CR5 wait-target ownership", {
    ownBySession: ownBySession,
    ownByRoster: ownByRoster,
    foreign,
    addressedToHolder,
    legitimateRowToId: legitimate.toId,
    toIdRuleWouldRefuseLegitimate: legitimate.toId !== holder.holderId,
  })
  // The reseed edge: the row was sent under the OLD session; the holder now has a NEW one.
  const reseeded: WaitHolder = { holderId: "M1", holderName: "Senior Engineer", sessionId: "member-session-reseeded" }
  const ownQuestionAfterReseed = checkWaitTarget(permit, row({ id: "own-old-session", fromId: "member-session", fromMemberId: "M1" }), reseeded)
  show("CR5 reseed edge (row sent before the reseed, holder on a new session)", { ownQuestionAfterReseed, rowFromMemberId: "M1" })
  // Message-scope grants use the same ownership rule.
  const msgPermit = (issuePermit(ws, { issuerId: "lead-session", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "message", ttlMs: 60_000 }, NOW) as { ok: true; permit: Parameters<typeof checkWaitTarget>[0] }).permit
  show("CR5 message scope", {
    ownSent: checkWaitTarget(msgPermit, row({ id: "m-own", kind: "message", fromId: "member-session" }), holder),
    foreignSent: checkWaitTarget(msgPermit, row({ id: "m-foreign", kind: "message", fromId: "child-Reviewer", fromName: "Reviewer" }), holder),
  })
  rmSync(ws, { recursive: true, force: true })
}

// ── CR3: a lineage-only captain acts under the DURABLE lead id — the four consequences ─────────────
{
  const ws = box()
  const LEAD = "lead-session" // the record's leadSessionId
  const RESUMED = "lead-session-resumed" // the forked/resumed session's own id
  const memberIds = ["M1", "M2"]

  // (a) ACK of a lead-addressed row: the tool now passes byId = callerAddress = LEAD.
  const askedToLead = send(ws, { fromId: "M1", fromName: "Senior Engineer", toId: LEAD, toName: "captain", memberIds, leadIds: [LEAD], teamId: "team-x", subject: "may I?", body: "b" }, NOW)
  const leadRow = readMailbox(ws).messages[0]
  const leadAck = acknowledge(ws, [leadRow.id], { byId: LEAD, byName: "captain" }, later(1))
  // (b) BROADCAST excludes the captain's own durable address.
  const broadcast = resolveRecipients({ members: [{ id: "M1", name: "Senior Engineer" }, { id: "M2", name: "Reviewer" }], lead: { id: LEAD, name: "captain" }, selfId: LEAD }, "*")
  // (c) ANSWERING the captain's own question: the question was sent with fromId = RESUMED and
  // fromMemberId = LEAD; the member answers to the durable address LEAD, which must be the asker.
  const question = send(ws, { fromId: RESUMED, fromName: "captain", fromMemberId: LEAD, toId: "M1", toName: "Senior Engineer", memberIds, leadIds: [LEAD], teamId: "team-x", subject: "which?", body: "which?", kind: "question", question: { questionId: "q1", question: "which?", options: [{ label: "A. one" }] } }, later(2))
  const qid = (question as { ok: true; message: { id: string } }).message.id
  const answered = sendMany(ws, { fromId: "M1", fromName: "Senior Engineer", fromMemberId: "M1", toId: LEAD, toName: "captain", memberIds, leadIds: [LEAD], teamId: "team-x", subject: "a", body: "A. one", kind: "answer", replyTo: qid, answer: { questionId: "q1", answerTo: qid, selected: ["A. one"] } }, [{ id: LEAD, name: "captain" }], later(3))
  // (d) PERMIT + WAIT: the permit's issuer is the durable lead id, so the holder's check must not say foreign.
  const permit = issuePermit(ws, { issuerId: LEAD, issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, later(4))
  const holderCheck = checkPermit((permit as { ok: true; permit: Parameters<typeof checkPermit>[0] }).permit, { holderId: "M1", holderName: "Senior Engineer", sessionId: "member-session", leadIds: [LEAD], requestedTimeoutMs: 10 }, later(4))
  show("CR3 lineage-only captain: four consequences", {
    ackMoved: leadAck.moved,
    broadcastTargets: (broadcast as { ok: true; targets: Array<{ id: string }> }).targets.map((target) => target.id),
    broadcastExcludesLead: !((broadcast as { ok: true; targets: Array<{ id: string }> }).targets ?? []).some((target) => target.id === LEAD),
    answeredOwnQuestion: { ok: (answered as { ok: boolean }).ok, detail: (answered as { detail?: string }).detail },
    permitIssues: (permit as { ok: boolean }).ok,
    waitHolderCheck: holderCheck,
  })
  // The reverse: an ORDINARY member's ack of another's row is still refused, and its answer to a
  // question it was not addressed in is still refused (non-captain cannot borrow the captain's powers).
  const otherRow = send(ws, { fromId: LEAD, fromName: "captain", toId: "M1", toName: "Senior Engineer", memberIds, leadIds: [LEAD], teamId: "team-x", subject: "for M1", body: "b" }, later(5))
  const strangerAck = acknowledge(ws, [(otherRow as { ok: true; message: { id: string } }).message.id], { byId: "M2", byName: "Reviewer" }, later(6))
  const foreignAnswer = sendMany(ws, { fromId: "M2", fromName: "Reviewer", fromMemberId: "M2", toId: LEAD, toName: "captain", memberIds, leadIds: [LEAD], teamId: "team-x", subject: "a", body: "A. one", kind: "answer", replyTo: qid, answer: { questionId: "q1", answerTo: qid, selected: ["A. one"] } }, [{ id: LEAD, name: "captain" }], later(7))
  const freshPermit = issuePermit(ws, { issuerId: LEAD, issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, later(7))
  const badIssuer = checkPermit((freshPermit as { ok: true; permit: Parameters<typeof checkPermit>[0] }).permit, { holderId: "M1", holderName: "Senior Engineer", sessionId: "member-session", leadIds: ["lead-other"] }, later(7))
  show("CR3 non-captain is still refused", { strangerAck: { moved: strangerAck.moved, refused: strangerAck.refused.length }, foreignAnswer: { ok: (foreignAnswer as { ok: boolean }).ok, reason: (foreignAnswer as { reason?: string }).reason }, foreignIssuer: badIssuer })
  // The reverse: an ORDINARY member's own ack and answer are unchanged.
  const memberOwn = send(ws, { fromId: LEAD, fromName: "captain", toId: "M2", toName: "Reviewer", memberIds, leadIds: [LEAD], teamId: "team-x", subject: "for M2", body: "b" }, later(9))
  const memberAck = acknowledge(ws, [(memberOwn as { ok: true; message: { id: string } }).message.id], { byId: "M2", byName: "Reviewer" }, later(10))
  show("CR3 ordinary member unchanged", { memberAckMoved: memberAck.moved })
  rmSync(ws, { recursive: true, force: true })
}
