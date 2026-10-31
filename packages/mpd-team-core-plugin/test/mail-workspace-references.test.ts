// T17 — REFERENCES RESOLVE AGAINST THE WORKSPACE MAILBOX (T9's F1, layer 2).
//
// A cross-cell conversation's two rows live under two different team stamps: the question keeps the
// ASKER cell's team, the answer is sent for the ANSWERER cell's team. `sendMany` used to validate I5
// against one team's slice, so every cross-cell structured answer was refused as an unknown reference.
// These arms pin the fix — references and thread inheritance see the whole workspace — while the
// ownership rules, the backlog bound and the stamps stay team-scoped exactly as before.
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { send, sendMany, type MailMessage, type SendInput, type SendManyResult, type SendResult } from "../src/mailbox-store"

/** The frozen instant every arm stamps rows with. */
const NOW = new Date("2026-10-31T19:05:00.000Z")

/** A fresh workspace whose mailbox starts empty. */
function workspace(): string {
  return mkdtempSync(join(tmpdir(), "mpd-mail-refs-"))
}

/** A well-formed send input over one roster, overridable per arm. */
function input(over: Partial<SendInput>): SendInput {
  return { fromId: "session-asker", fromName: "asker", toId: "M-answerer", toName: "answerer", subject: "s", body: "b", memberIds: ["M-answerer"], leadIds: [], ...over }
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

/** The refusal sentence of a failed send. */
function refusalOf(result: SendResult | SendManyResult): string {
  if (result.ok) throw new Error("expected the send to be refused")
  return result.detail
}

test("a cross-team ANSWER finds its question and validates the echoed labels against the workspace", () => {
  /** The workspace holding both teams' rows. */
  const box = workspace()
  /** The asker cell's question, stamped with the ASKER's team. */
  const asked = send(box, input({
    teamId: "team-asker",
    kind: "question",
    question: { questionId: "Q-cross", question: "Which?", options: [{ label: "A. One" }, { label: "B. Two" }] },
  }), NOW)
  /** The question row, whose id and thread the answer must reference. */
  const question = messageOf(asked)
  /** The answer cell's answer, sent FOR the answerer's team — a different stamp than the question's. */
  const answered = sendMany(box, input({
    fromId: "M-answerer",
    fromName: "answerer",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-answerer"],
    leadIds: ["session-asker"],
    teamId: "team-answerer",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-cross", answerTo: question.id, selected: ["A. One"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The recorded answer row. */
  const answer = messagesOf(answered)[0]
  expect(answer.answer?.selected).toEqual(["A. One"])
  expect(answer.replyTo).toBe(question.id)
  // I7's inheritance resolves through the same workspace fold: the answer joins the question's thread.
  expect(answer.threadId).toBe(question.threadId)
})

test("for the PROVEN ADDRESSEE, a cross-team answer is still refused WITH the valid label list", () => {
  /** The workspace holding the question. */
  const box = workspace()
  /** The asker cell's question. */
  const question = messageOf(send(box, input({
    teamId: "team-asker",
    kind: "question",
    question: { questionId: "Q-cross", question: "Which?", options: [{ label: "A. One" }, { label: "B. Two" }] },
  }), NOW))
  /** An answer that invented a label instead of echoing one. */
  const refused = sendMany(box, input({
    fromId: "M-answerer",
    fromName: "answerer",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-answerer"],
    leadIds: ["session-asker"],
    teamId: "team-answerer",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-cross", answerTo: question.id, selected: ["C. Three"] },
  }), [{ id: "session-asker", name: "asker" }], NOW)
  /** The refusal sentence, which must name the valid labels. */
  const detail = refusalOf(refused)
  expect(detail).toContain("valid labels:")
  expect(detail).toContain("A. One")
  expect(detail).toContain("B. Two")
})

test("a replyTo the WORKSPACE does not hold is still refused with the same sentence", () => {
  /** The empty workspace. */
  const box = workspace()
  /** A message replying to an id no row carries. */
  const refused = send(box, input({ teamId: "team-asker", replyTo: "mail-absent-999" }), NOW)
  expect(refusalOf(refused)).toContain("`replyTo` names no message in this mailbox")
})

test("same-team ownership STAYS team-scoped: a non-recipient cannot answer the question", () => {
  /** The workspace holding one team's conversation. */
  const box = workspace()
  /** The question addressed to `M-answerer`. */
  const question = messageOf(send(box, input({
    teamId: "team-a",
    kind: "question",
    question: { questionId: "Q-same", question: "Which?", options: [{ label: "A. One" }] },
  }), NOW))
  /** An answer from a row that was never a recipient of the question. */
  const foreign = send(box, input({
    fromId: "M-other",
    fromName: "other",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-answerer", "M-other"],
    leadIds: ["session-asker"],
    teamId: "team-a",
    kind: "answer",
    replyTo: question.id,
    answer: { questionId: "Q-same", answerTo: question.id, selected: ["A. One"] },
  }), NOW)
  expect(refusalOf(foreign)).toContain("only a recipient of the question may answer it")
})

test("the backlog bound STAYS per-team even though references are workspace-wide", () => {
  /** The workspace the bound is measured in. */
  const box = workspace()
  // Eight outstanding rows for team-a: the bound must now refuse team-a's ninth row.
  for (let index = 0; index < 8; index += 1) {
    /** One of team-a's outstanding rows. */
    const row = send(box, input({ teamId: "team-a", subject: "outstanding " + String(index) }), NOW)
    expect(row.ok).toBe(true)
  }
  /** team-a's ninth row, which the bound refuses. */
  const full = send(box, input({ teamId: "team-a", subject: "ninth" }), NOW)
  expect(refusalOf(full)).toContain("already has 8 undelivered message(s)")
  // Another team's row to the same recipient is NOT counted, so its bound is still empty.
  /** team-b's first row to the same member. */
  const other = send(box, input({ teamId: "team-b", subject: "other team" }), NOW)
  expect(other.ok).toBe(true)
})
