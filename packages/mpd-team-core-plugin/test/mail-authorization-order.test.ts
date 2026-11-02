// T21 — AUTHORIZATION BEFORE THE ECHO; NO CROSS-TEAM LABEL OR THREAD LEAK (R2's F1 + F2).
//
// I4's label list is a correction aid for the question's ADDRESSEE. When the echo ran before the
// ownership check, any team could name a foreign question id and read that conversation's offered
// labels out of the refusal — and a foreign answer carrying a CORRECT label was even accepted because
// the ownership lookup only searched the caller's team slice. These arms pin the repaired order:
// authorization first on the WORKSPACE row, the echo only for a proven addressee, and the thread only
// inherited on an authorized path.
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readMailbox, send, sendMany, type MailMessage, type SendInput, type SendManyResult, type SendResult } from "../src/mailbox-store"

/** The frozen instant every arm stamps rows with. */
const NOW = new Date("2026-10-31T19:20:00.000Z")

/** A fresh workspace whose mailbox starts empty. */
function workspace(): string {
  return mkdtempSync(join(tmpdir(), "mpd-mail-auth-"))
}

/** A well-formed send input, overridable per arm. */
function input(over: Partial<SendInput>): SendInput {
  return { fromId: "session-asker", fromName: "asker", toId: "M-recipient", toName: "recipient", subject: "s", body: "b", memberIds: ["M-recipient"], leadIds: [], ...over }
}

/** The single recorded message of a successful single send. */
function messageOf(result: SendResult): MailMessage {
  if (!result.ok) throw new Error("expected the send to be recorded: " + result.detail)
  return result.message
}

/** The recorded messages of a successful fan-out. */
function messagesOf(result: SendManyResult): MailMessage[] {
  if (!result.ok) throw new Error("expected the fan-out to be recorded: " + result.detail)
  return result.messages
}

/** The refusal sentence and reason of a failed send. */
function refusalOf(result: SendResult | SendManyResult): { reason: string; detail: string } {
  if (result.ok) throw new Error("expected the send to be refused")
  return { reason: result.reason, detail: result.detail }
}

test("a FOREIGN non-recipient gets not-recipient, with no label text and no foreign thread root", () => {
  /** The workspace holding team Y's conversation. */
  const box = workspace()
  /** Team Y's thread root, so the question's thread id differs from the question's OWN id. */
  const root = messageOf(send(box, input({ teamId: "team-y", subject: "root", toId: "M-recipient", toName: "recipient" }), NOW))
  /** Team Y's question, threaded under the root and addressed to `M-recipient`. */
  const question = messageOf(send(box, input({
    teamId: "team-y",
    subject: "secret question",
    kind: "question",
    replyTo: root.id,
    question: { questionId: "Q-secret", question: "Which?", options: [{ label: "A. secret-one" }, { label: "B. secret-two" }] },
  }), NOW))
  // The question's thread is the ROOT's id, which the attacker never named.
  expect(question.threadId).toBe(root.id)
  /** Team X's attacker, inventing a label for a question it does not own. */
  const attacked = sendMany(box, input({
    fromId: "M-x",
    fromName: "x",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-x"],
    leadIds: ["session-asker"],
    teamId: "team-x",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-secret", answerTo: question.id, selected: ["Z. made-up"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The refusal, which must be ownership — not the echo. */
  const refusal = refusalOf(attacked)
  expect(refusal.reason).toBe("not-recipient")
  expect(refusal.detail).toContain(question.id)
  expect(refusal.detail).not.toContain("valid labels")
  expect(refusal.detail).not.toContain("A. secret-one")
  expect(refusal.detail).not.toContain("B. secret-two")
  // The foreign conversation's thread root is not disclosed either.
  expect(refusal.detail).not.toContain(root.id)
  // And nothing was written: no row claims to answer the foreign question.
  expect(readMailbox(box).messages.filter((message) => message.kind === "answer")).toEqual([])
})

test("a SAME-TEAM non-recipient is refused by ownership before the echo too", () => {
  /** The workspace with one team's question. */
  const box = workspace()
  /** The question, addressed to `M-recipient`. */
  const question = messageOf(send(box, input({
    kind: "question",
    question: { questionId: "Q-team", question: "Which?", options: [{ label: "A. x-one" }, { label: "B. x-two" }] },
  }), NOW))
  /** A roster member that was never addressed by the question, with an invented label. */
  const refused = send(box, input({
    fromId: "M-bystander",
    fromName: "bystander",
    memberIds: ["M-recipient", "M-bystander"],
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-team", answerTo: question.id, selected: ["Z. nope"] },
  }), NOW)
  /** The refusal, which must be ownership — not the label correction. */
  const refusal = refusalOf(refused)
  expect(refusal.reason).toBe("not-recipient")
  expect(refusal.detail).not.toContain("valid labels")
  expect(refusal.detail).not.toContain("A. x-one")
})

test("a PROVEN cross-team addressee still passes ownership and inherits the question's thread", () => {
  /** The workspace holding the foreign question. */
  const box = workspace()
  /** Team Y's question, addressed to `M-answerer`. */
  const question = messageOf(send(box, input({
    teamId: "team-y",
    toId: "M-answerer",
    toName: "answerer",
    memberIds: ["M-answerer"],
    kind: "question",
    question: { questionId: "Q-cross", question: "Which?", options: [{ label: "A. One" }, { label: "B. Two" }] },
  }), NOW))
  /** The addressee answers from its own team's send; the authorization must still pass. */
  const answered = sendMany(box, input({
    fromId: "M-answerer",
    fromName: "answerer",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-answerer"],
    leadIds: ["session-asker"],
    teamId: "team-x",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-cross", answerTo: question.id, selected: ["B. Two"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The recorded answer row. */
  const answer = messagesOf(answered)[0]
  expect(answer.answer?.selected).toEqual(["B. Two"])
  expect(answer.threadId).toBe(question.threadId)
})

test("a FOREIGN non-recipient with a CORRECT label is refused and writes nothing (F2)", () => {
  /** The workspace holding team Y's question. */
  const box = workspace()
  /** Team Y's question, addressed to `M-recipient`. */
  const question = messageOf(send(box, input({
    teamId: "team-y",
    kind: "question",
    question: { questionId: "Q-secret", question: "Which?", options: [{ label: "A. secret-one" }] },
  }), NOW))
  /** Team X's impostor echoes the RIGHT label, which used to pass because ownership was skipped. */
  const attacked = sendMany(box, input({
    fromId: "M-x",
    fromName: "x",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-x"],
    leadIds: ["session-asker"],
    teamId: "team-x",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-secret", answerTo: question.id, selected: ["A. secret-one"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The refusal, which must be ownership, not an acceptance. */
  const refusal = refusalOf(attacked)
  expect(refusal.reason).toBe("not-recipient")
  expect(readMailbox(box).messages.filter((message) => message.kind === "answer")).toEqual([])
})

test("T18's stable SEAT KEYS: the legitimate cross-cell answerer passes, an impostor seat is refused", () => {
  /** The workspace holding the parent/sub cell exchange. */
  const box = workspace()
  /** The parent captain's question, addressed to the sub-cell captain's SEAT KEY. */
  const question = messageOf(send(box, input({
    teamId: "team-sub",
    fromId: "seat:cell-parent/captain",
    fromName: "captain",
    toId: "seat:cell-sub/sub-captain",
    toName: "sub-captain",
    memberIds: ["seat:cell-sub/sub-captain"],
    kind: "question",
    question: { questionId: "Q-seat", question: "Decision?", options: [{ label: "A. Go" }, { label: "B. Hold" }] },
  }), NOW))
  /** The legitimate answerer: its OWN seat key equals the question's addressed seat key. */
  const answered = sendMany(box, input({
    fromId: "seat:cell-sub/sub-captain",
    fromName: "sub-captain",
    toId: "seat:cell-parent/captain",
    toName: "captain",
    memberIds: ["seat:cell-sub/sub-captain"],
    leadIds: ["seat:cell-parent/captain"],
    teamId: "team-parent",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-seat", answerTo: question.id, selected: ["A. Go"] },
  }), [{ id: "seat:cell-parent/captain", name: "captain" }], NOW)
  /** The recorded legitimate answer. */
  const answer = messagesOf(answered)[0]
  expect(answer.answer?.selected).toEqual(["A. Go"])
  expect(answer.threadId).toBe(question.threadId)
  // A DIFFERENT seat key on the same team must never stand in for the addressed one.
  /** Another seat of the sub-cell, claiming to answer a question addressed to the captain. */
  const impostor = sendMany(box, input({
    fromId: "seat:cell-sub/intruder",
    fromName: "intruder",
    toId: "seat:cell-parent/captain",
    toName: "captain",
    memberIds: ["seat:cell-sub/intruder"],
    leadIds: ["seat:cell-parent/captain"],
    teamId: "team-parent",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-seat", answerTo: question.id, selected: ["A. Go"] },
  }), [{ id: "seat:cell-parent/captain", name: "captain" }], NOW)
  /** The impostor's refusal. */
  const refusal = refusalOf(impostor)
  expect(refusal.reason).toBe("not-recipient")
  expect(refusal.detail).toContain(question.id)
  expect(readMailbox(box).messages.filter((message) => message.kind === "answer")).toHaveLength(1)
})

test("an answer's replyTo may only name the question it answers (no foreign thread vector)", () => {
  /** The workspace holding team Y's thread and a question. */
  const box = workspace()
  /** Team Y's thread root, so a foreign thread id is distinguishable from the question's. */
  const root = messageOf(send(box, input({ teamId: "team-y", subject: "root" }), NOW))
  /** Team Y's reply inside that thread. */
  const foreignReply = messageOf(send(box, input({ teamId: "team-y", subject: "reply", replyTo: root.id }), NOW))
  expect(foreignReply.threadId).toBe(root.id)
  /** Team Y's question, addressed to the attacker seat so ownership WOULD pass. */
  const question = messageOf(send(box, input({
    teamId: "team-y",
    toId: "M-recipient",
    toName: "recipient",
    memberIds: ["M-recipient"],
    kind: "question",
    question: { questionId: "Q-own", question: "Which?", options: [{ label: "A. One" }] },
  }), NOW))
  /** The addressee answers the question but points `replyTo` at a DIFFERENT (foreign) thread. */
  const refused = sendMany(box, input({
    fromId: "M-recipient",
    fromName: "recipient",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-recipient"],
    leadIds: ["session-asker"],
    teamId: "team-y",
    kind: "answer",
    replyTo: foreignReply.id,
    answer: { questionId: "Q-own", answerTo: question.id, selected: ["A. One"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The refusal, which names neither thread id. */
  const refusal = refusalOf(refused)
  expect(refusal.reason).toBe("invalid-envelope")
  expect(refusal.detail).not.toContain(root.id)
  expect(refusal.detail).not.toContain(foreignReply.id)
  expect(readMailbox(box).messages.filter((message) => message.kind === "answer")).toEqual([])
})

test("T23: ABSENT, non-question and FOREIGN answerTo ids get the SAME refusal sentence", () => {
  /** The workspace holding team Y's question and plain message. */
  const box = workspace()
  /** Team Y's question, addressed to `M-recipient`, with a label the attacker must not see. */
  const question = messageOf(send(box, input({
    teamId: "team-y",
    kind: "question",
    question: { questionId: "Q-secret", question: "Which?", options: [{ label: "A. secret-one" }] },
  }), NOW))
  /** Team Y's plain message, which is not a question row at all. */
  const plain = messageOf(send(box, input({ teamId: "team-y", subject: "plain", body: "not a question" }), NOW))
  /** The attacker's answer attempt against one supplied id. */
  const attack = (answerTo: string): SendManyResult => sendMany(box, input({
    fromId: "M-x",
    fromName: "x",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-x"],
    leadIds: ["session-asker"],
    teamId: "team-x",
    kind: "answer",
    replyTo: answerTo,
    answer: { questionId: "Q-secret", answerTo, selected: ["A. secret-one"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The refusal for an id no row carries. */
  const absent = refusalOf(attack("mail-19700101000000-999"))
  /** The refusal for a row that exists but is not a question. */
  const nonQuestion = refusalOf(attack(plain.id))
  /** The refusal for a real question owned by another team. */
  const foreign = refusalOf(attack(question.id))
  for (const refusal of [absent, nonQuestion, foreign]) expect(refusal.reason).toBe("not-recipient")
  // ONE sentence template: only the caller-supplied id differs across the three cases.
  expect(nonQuestion.detail).toBe(absent.detail.replace("mail-19700101000000-999", plain.id))
  expect(foreign.detail).toBe(absent.detail.replace("mail-19700101000000-999", question.id))
  // The refusal never says whether the id exists and never names the addressee.
  expect(absent.detail).not.toContain("names no message")
  expect(absent.detail).not.toContain("must name a `question`")
  expect(foreign.detail).not.toContain("M-recipient")
  expect(foreign.detail).not.toContain("A. secret-one")
  // A mismatched `replyTo` is a STRUCTURAL refusal checked before the lookup, so it is identical for an
  // absent and an existing answerTo — the oracle cannot move to that branch either.
  /** The attacker's answer with a `replyTo` that differs from the supplied answerTo. */
  const mismatched = (answerTo: string): SendManyResult => sendMany(box, input({
    fromId: "M-x",
    fromName: "x",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-x"],
    leadIds: ["session-asker"],
    teamId: "team-x",
    kind: "answer",
    replyTo: "mail-19700101000000-888",
    answer: { questionId: "Q-secret", answerTo, selected: ["A. secret-one"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The structural refusal for the absent id. */
  const mismatchAbsent = refusalOf(mismatched("mail-19700101000000-999"))
  /** The structural refusal for the existing foreign question. */
  const mismatchForeign = refusalOf(mismatched(question.id))
  expect(mismatchAbsent.reason).toBe("invalid-envelope")
  expect(mismatchForeign).toEqual(mismatchAbsent)
  // Nothing was written for any of the three probes.
  expect(readMailbox(box).messages.filter((message) => message.kind === "answer")).toEqual([])
})

test("a PLAIN reply to a foreign message cannot inherit that conversation's thread", () => {
  /** The workspace holding team Y's threaded reply. */
  const box = workspace()
  /** Team Y's thread root. */
  const root = messageOf(send(box, input({ teamId: "team-y", subject: "root" }), NOW))
  /** Team Y's reply, which belongs to the root's thread. */
  const reply = messageOf(send(box, input({ teamId: "team-y", subject: "reply", replyTo: root.id }), NOW))
  expect(reply.threadId).toBe(root.id)
  /** Team X's plain reply to the foreign reply id — the reference is visible, the thread is not. */
  const crossReply = messageOf(send(box, input({
    teamId: "team-x",
    fromId: "M-x",
    fromName: "x",
    toId: "M-x-target",
    toName: "x-target",
    memberIds: ["M-x-target"],
    subject: "cross reply",
    replyTo: reply.id,
  }), NOW))
  // The reference the sender itself named is echoed; the foreign conversation's thread root is not.
  expect(crossReply.replyTo).toBe(reply.id)
  expect(crossReply.threadId).toBe(crossReply.id)
  expect(crossReply.threadId).not.toBe(root.id)
  expect(crossReply.threadId).not.toBe(reply.threadId)
})
