// T24 FINAL PROBES (T23 — the answer-path existence oracle must be closed; no regression; wave ready).
// Black-box over sendMany; never edits the package.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readMailbox, send, sendMany, type SendInput } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** A fresh workspace. */
function box(): string {
  return mkdtempSync(join(tmpdir(), "r2e-probe-"))
}

/** The frozen clock. */
const NOW = new Date("2026-10-31T10:00:00.000Z")

/** One minute later. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

/** Team X's attacker input. */
function xAttack(over: Record<string, unknown> = {}): SendInput {
  return { fromId: "M-x", fromName: "x", toId: "session-asker", toName: "asker", memberIds: ["M-x"], leadIds: ["session-asker"], teamId: "team-x", subject: "s", body: "b", ...over }
}

/** Plant team Y's conversation: root → question (thread under the root) → a plain reply row. */
function plantY(workspace: string): { rootId: string; questionId: string; plainId: string } {
  const y = (over: Record<string, unknown>): SendInput => ({ fromId: "session-asker", fromName: "asker", toId: "M-recipient", toName: "recipient", memberIds: ["M-recipient"], teamId: "team-y", subject: "s", body: "b", ...over })
  const root = send(workspace, y({ subject: "root" }), NOW)
  const rootId = (root as { ok: true; message: { id: string } }).message.id
  const question = send(workspace, y({ subject: "secret question", kind: "question", replyTo: rootId, question: { questionId: "Q-secret", question: "Which?", options: [{ label: "A. secret-one" }, { label: "B. secret-two" }] } }), NOW)
  const questionId = (question as { ok: true; message: { id: string } }).message.id
  const plain = send(workspace, y({ subject: "plain row" }), NOW)
  return { rootId, questionId, plainId: (plain as { ok: true; message: { id: string } }).message.id }
}

/** The observable of one refusal. */
function observable(result: unknown): { ok: boolean; reason?: string; detail?: string } {
  return result as { ok: boolean; reason?: string; detail?: string }
}

// ── A: THE ANSWER-PATH ORACLE — absent / non-question / foreign must be INDISTINGUISHABLE ───────────
{
  const ws = box()
  const { questionId, plainId } = plantY(ws)
  const bogusId = "mail-19700101000000-999"
  const absent = sendMany(ws, xAttack({ kind: "answer", replyTo: bogusId, answer: { questionId: "Q", answerTo: bogusId, selected: ["A. one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const nonQuestion = sendMany(ws, xAttack({ kind: "answer", replyTo: plainId, answer: { questionId: "Q", answerTo: plainId, selected: ["A. one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const foreign = sendMany(ws, xAttack({ kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const a = observable(absent)
  const n = observable(nonQuestion)
  const f = observable(foreign)
  show("A absent / non-question / foreign answer refusals", {
    absent: a,
    nonQuestion: n,
    foreign: f,
    sameReason: a.reason === n.reason && a.reason === f.reason,
    sameDetailShape: a.detail === "only a recipient of the question may answer it: " + bogusId
      && n.detail === "only a recipient of the question may answer it: " + plainId
      && f.detail === "only a recipient of the question may answer it: " + questionId,
    namesTheAddressee: [a, n, f].some((entry) => String(entry.detail ?? "").includes("recipient\"")),
    answerRows: readMailbox(ws).messages.filter((message) => message.kind === "answer").length,
  })
  // A mismatched replyTo must answer the same for an absent and an existing answerTo (no second probe).
  const mismatchAbsent = sendMany(ws, xAttack({ kind: "answer", replyTo: "other", answer: { questionId: "Q", answerTo: bogusId, selected: ["A. one"] } }), [{ id: "session-asker", name: "asker" }], later(2))
  const mismatchForeign = sendMany(ws, xAttack({ kind: "answer", replyTo: "other", answer: { questionId: "Q", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(2))
  show("A2 replyTo!=answerTo is existence-blind", { absent: observable(mismatchAbsent), foreign: observable(mismatchForeign), identical: JSON.stringify(observable(mismatchAbsent)) === JSON.stringify(observable(mismatchForeign)) })
  rmSync(ws, { recursive: true, force: true })
}

// ── B: the DECLARED plain-reply bound — a foreign id is accepted, no thread root leaked; bogus is refused ─
{
  const ws = box()
  const { rootId, questionId } = plantY(ws)
  const foreignReply = sendMany(ws, xAttack({ subject: "cross reply", replyTo: questionId }), [{ id: "session-asker", name: "asker" }], later(1))
  const row = readMailbox(ws).messages.find((message) => message.subject === "cross reply")
  const bogusReply = sendMany(ws, xAttack({ subject: "bogus reply", replyTo: "mail-19700101000000-999" }), [{ id: "session-asker", name: "asker" }], later(1))
  show("B declared plain-reply bound", {
    foreignAccepted: observable(foreignReply).ok,
    foreignThreadLeaked: row?.threadId === rootId,
    rowThreadIsItsOwn: row?.threadId === row?.id,
    bogusRefused: observable(bogusReply).ok === false,
  })
  rmSync(ws, { recursive: true, force: true })
}

// ── C: NO REGRESSION — the T22 properties, re-checked ───────────────────────────────────────────────
{
  // C1: cross-team wrong label → authorization refusal, no labels, no thread, nothing written.
  const ws = box()
  const { rootId, questionId } = plantY(ws)
  const refused = sendMany(ws, xAttack({ kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["Z. made-up"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const o = observable(refused)
  show("C1 cross-team wrong label (leak closed)", { reason: o.reason, detail: o.detail, hasLabels: String(o.detail ?? "").includes("valid labels") || String(o.detail ?? "").includes("secret-one"), hasThreadRoot: String(o.detail ?? "").includes(rootId), answerRows: readMailbox(ws).messages.filter((message) => message.kind === "answer").length })
  rmSync(ws, { recursive: true, force: true })
}
{
  // C2: proven cross-team addressee still answers and inherits the question's thread.
  const ws = box()
  const { rootId, questionId } = plantY(ws)
  const answered = sendMany(ws, xAttack({ fromId: "M-recipient", fromName: "recipient", kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const row = readMailbox(ws).messages.find((message) => message.kind === "answer")
  show("C2 proven cross-team addressee", { ok: observable(answered).ok, inheritedThread: row?.threadId === rootId })
  rmSync(ws, { recursive: true, force: true })
}
{
  // C3: same-team — the addressee's correction aid intact; a non-recipient gets no labels.
  const ws = box()
  const x = (over: Record<string, unknown>): SendInput => ({ fromId: "session-asker", fromName: "asker", toId: "M-recipient", toName: "recipient", memberIds: ["M-recipient", "M-bystander", "session-asker"], teamId: "team-x", subject: "s", body: "b", ...over })
  const asked = send(ws, x({ kind: "question", question: { questionId: "Q-x", question: "Which?", options: [{ label: "A. x-one" }] } }), NOW)
  const qid = (asked as { ok: true; message: { id: string } }).message.id
  const bystander = sendMany(ws, x({ fromId: "M-bystander", fromName: "bystander", kind: "answer", replyTo: qid, answer: { questionId: "Q-x", answerTo: qid, selected: ["Z. nope"] } }), [{ id: "M-recipient", name: "recipient" }], later(1))
  const addressee = sendMany(ws, x({ fromId: "M-recipient", fromName: "recipient", kind: "answer", replyTo: qid, answer: { questionId: "Q-x", answerTo: qid, selected: ["Z. nope"] } }), [{ id: "session-asker", name: "asker" }], later(2))
  show("C3 same-team", { bystander: observable(bystander), bystanderHasLabels: String(observable(bystander).detail ?? "").includes("x-one"), addresseeEcho: observable(addressee).detail })
  rmSync(ws, { recursive: true, force: true })
}
{
  // C4: T18's stable seat keys still pass the repaired ownership.
  const ws = box()
  const seat = (cell: string, name: string): string => "seat:" + cell + "/" + name
  const asked = send(ws, { fromId: seat("cell-y", "asker"), fromName: "asker", fromMemberId: "asker", toId: seat("cell-y", "recipient"), toName: "recipient", memberIds: [seat("cell-y", "recipient")], teamId: "team-y", subject: "q", body: "q", kind: "question", question: { questionId: "Q-seat", question: "Which?", options: [{ label: "A. one" }] } }, NOW)
  const qid = (asked as { ok: true; message: { id: string } }).message.id
  const answered = sendMany(ws, { fromId: seat("cell-y", "recipient"), fromName: "recipient", fromMemberId: "recipient", toId: seat("cell-y", "asker"), toName: "asker", memberIds: [seat("cell-y", "asker")], leadIds: [seat("cell-y", "asker")], teamId: "team-y", subject: "a", body: "a", kind: "answer", replyTo: qid, answer: { questionId: "Q-seat", answerTo: qid, selected: ["A. one"] } }, [{ id: seat("cell-y", "asker"), name: "asker" }], later(1))
  show("C4 seat-key answer", { ok: observable(answered).ok, detail: observable(answered).detail })
  rmSync(ws, { recursive: true, force: true })
}
