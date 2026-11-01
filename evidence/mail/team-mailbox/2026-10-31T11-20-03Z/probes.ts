// T22 RE-VERIFICATION PROBES (T21 — authorization before echo; no cross-team label/thread leak; the
// existence oracle). Black-box over sendMany; never edits the package.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readMailbox, send, sendMany, type SendInput } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** A fresh workspace. */
function box(): string {
  return mkdtempSync(join(tmpdir(), "r2d-probe-"))
}

/** The frozen clock. */
const NOW = new Date("2026-10-31T10:00:00.000Z")

/** One minute later. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

/** Team X's attacker input (targets a member of its own team; replies back to the asker). */
function xAttack(over: Record<string, unknown> = {}): SendInput {
  return {
    fromId: "M-x",
    fromName: "x",
    toId: "session-asker",
    toName: "asker",
    memberIds: ["M-x"],
    leadIds: ["session-asker"],
    teamId: "team-x",
    subject: "s",
    body: "b",
    ...over,
  }
}

/** Plant team Y's conversation: a ROOT, then a QUESTION threaded under it. */
function plantY(workspace: string): { rootId: string; questionId: string } {
  const y = (over: Record<string, unknown>): SendInput => ({ fromId: "session-asker", fromName: "asker", toId: "M-recipient", toName: "recipient", memberIds: ["M-recipient"], teamId: "team-y", subject: "s", body: "b", ...over })
  const root = send(workspace, y({ subject: "root" }), NOW)
  const rootId = (root as { ok: true; message: { id: string } }).message.id
  const question = send(workspace, y({ subject: "secret question", kind: "question", replyTo: rootId, question: { questionId: "Q-secret", question: "Which?", options: [{ label: "A. secret-one" }, { label: "B. secret-two" }] } }), NOW)
  return { rootId, questionId: (question as { ok: true; message: { id: string } }).message.id }
}

// ── 1: cross-team WRONG label (the T19 High) — must be an AUTHORIZATION refusal, no labels/thread ───
{
  const ws = box()
  const { rootId, questionId } = plantY(ws)
  const refused = sendMany(ws, xAttack({ kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["Z. made-up"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const failure = refused as { ok: false; reason?: string; detail?: string }
  const detail = String(failure.detail ?? "")
  const answerRows = readMailbox(ws).messages.filter((message) => message.kind === "answer")
  show("1 cross-team wrong label", {
    ok: (refused as { ok: boolean }).ok,
    reason: failure.reason,
    detail,
    hasLabels: detail.includes("valid labels") || detail.includes("A. secret-one") || detail.includes("B. secret-two"),
    hasThreadRoot: detail.includes(rootId),
    answerRowsWritten: answerRows.length,
  })
  rmSync(ws, { recursive: true, force: true })
}

// ── 2: cross-team CORRECT label — the old F2 bypass must be closed ─────────────────────────────────
{
  const ws = box()
  const { questionId } = plantY(ws)
  const refused = sendMany(ws, xAttack({ kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  show("2 cross-team correct label", { ok: (refused as { ok: boolean }).ok, reason: (refused as { reason?: string }).reason, answerRowsWritten: readMailbox(ws).messages.filter((message) => message.kind === "answer").length })
  rmSync(ws, { recursive: true, force: true })
}

// ── 3/4: same-team non-recipient vs addressee (the echo only for the addressee) ───────────────────
{
  const ws = box()
  const x = (over: Record<string, unknown>): SendInput => ({ fromId: "session-asker", fromName: "asker", toId: "M-recipient", toName: "recipient", memberIds: ["M-recipient", "M-bystander"], teamId: "team-x", subject: "s", body: "b", ...over })
  const asked = send(ws, x({ kind: "question", question: { questionId: "Q-x", question: "Which?", options: [{ label: "A. x-one" }] } }), NOW)
  const qid = (asked as { ok: true; message: { id: string } }).message.id
  const bystander = sendMany(ws, x({ fromId: "M-bystander", fromName: "bystander", kind: "answer", replyTo: qid, answer: { questionId: "Q-x", answerTo: qid, selected: ["Z. nope"] } }), [{ id: "M-recipient", name: "recipient" }], later(1))
  const addressee = sendMany(ws, x({ fromId: "M-recipient", fromName: "recipient", toId: "session-asker", toName: "asker", memberIds: ["M-recipient", "M-bystander", "session-asker"], kind: "answer", replyTo: qid, answer: { questionId: "Q-x", answerTo: qid, selected: ["Z. nope"] } }), [{ id: "session-asker", name: "asker" }], later(2))
  const bd = (bystander as { detail?: string }).detail ?? ""
  const ad = (addressee as { detail?: string }).detail ?? ""
  show("3 same-team non-recipient", { ok: (bystander as { ok: boolean }).ok, reason: (bystander as { reason?: string }).reason, hasLabels: bd.includes("A. x-one") })
  show("4 same-team ADDRESSEE (control: echo unchanged)", { ok: (addressee as { ok: boolean }).ok, reason: (addressee as { reason?: string }).reason, detail: ad })
  rmSync(ws, { recursive: true, force: true })
}

// ── 5: a PROVEN cross-team addressee still passes and inherits the question's thread ──────────────
{
  const ws = box()
  const { rootId, questionId } = plantY(ws)
  const answered = sendMany(ws, xAttack({ fromId: "M-recipient", fromName: "recipient", toId: "session-asker", toName: "asker", kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const row = readMailbox(ws).messages.find((message) => message.kind === "answer")
  show("5 proven cross-team addressee", { ok: (answered as { ok: boolean }).ok, reason: (answered as { reason?: string }).reason, threadId: row?.threadId, rootId, inherited: row?.threadId === rootId })
  rmSync(ws, { recursive: true, force: true })
}

// ── 6: a plain reply to a foreign message cannot inherit the foreign thread ───────────────────────
{
  const ws = box()
  const { rootId, questionId } = plantY(ws)
  const replied = sendMany(ws, xAttack({ subject: "cross reply", replyTo: questionId }), [{ id: "session-asker", name: "asker" }], later(1))
  const row = readMailbox(ws).messages.find((message) => message.subject === "cross reply")
  show("6 plain reply to a foreign row", { ok: (replied as { ok: boolean }).ok, replyTo: row?.replyTo, threadId: row?.threadId, leakedForeignThread: row?.threadId === rootId })
  rmSync(ws, { recursive: true, force: true })
}

// ── 7: THE EXISTENCE ORACLE — does a bogus id and a FOREIGN id get distinguishable answers? ────────
{
  const ws = box()
  const { questionId } = plantY(ws)
  const bogusAnswer = sendMany(ws, xAttack({ kind: "answer", replyTo: "mail-19700101000000-999", answer: { questionId: "Q", answerTo: "mail-19700101000000-999", selected: ["A. one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const foreignAnswer = sendMany(ws, xAttack({ kind: "answer", replyTo: questionId, answer: { questionId: "Q-secret", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  const bogusReply = sendMany(ws, xAttack({ subject: "bogus reply", replyTo: "mail-19700101000000-999" }), [{ id: "session-asker", name: "asker" }], later(1))
  const foreignReply = sendMany(ws, xAttack({ subject: "foreign reply", replyTo: questionId }), [{ id: "session-asker", name: "asker" }], later(1))
  const brief = (result: unknown): { ok: boolean; reason?: string; detail?: string } => result as { ok: boolean; reason?: string; detail?: string }
  show("7 existence oracle", {
    answerBogus: { ok: brief(bogusAnswer).ok, reason: brief(bogusAnswer).reason, detail: brief(bogusAnswer).detail },
    answerForeign: { ok: brief(foreignAnswer).ok, reason: brief(foreignAnswer).reason, detail: brief(foreignAnswer).detail },
    replyBogus: { ok: brief(bogusReply).ok, reason: brief(bogusReply).reason },
    replyForeign: { ok: brief(foreignReply).ok },
    distinguishable: brief(bogusAnswer).reason !== brief(foreignAnswer).reason || brief(bogusReply).ok !== brief(foreignReply).ok,
  })
  rmSync(ws, { recursive: true, force: true })
}

// ── 8: an answer's replyTo must be its answerTo (no foreign thread vector) ─────────────────────────
{
  const ws = box()
  const { questionId } = plantY(ws)
  const refused = sendMany(ws, xAttack({ fromId: "M-recipient", fromName: "recipient", toId: "session-asker", toName: "asker", kind: "answer", replyTo: "some-other-id", answer: { questionId: "Q-secret", answerTo: questionId, selected: ["A. secret-one"] } }), [{ id: "session-asker", name: "asker" }], later(1))
  show("8 answer replyTo != answerTo", { ok: (refused as { ok: boolean }).ok, reason: (refused as { reason?: string }).reason, detail: (refused as { detail?: string }).detail })
  rmSync(ws, { recursive: true, force: true })
}

// ── 9: T18's stable seat keys still pass the repaired ownership (cross-component compatibility) ───
{
  const ws = box()
  const seat = (cell: string, name: string): string => "seat:" + cell + "/" + name
  const asked = send(ws, { fromId: seat("cell-y", "asker"), fromName: "asker", fromMemberId: "asker", toId: seat("cell-y", "recipient"), toName: "recipient", memberIds: [seat("cell-y", "recipient")], teamId: "team-y", subject: "q", body: "q", kind: "question", question: { questionId: "Q-seat", question: "Which?", options: [{ label: "A. one" }] } }, NOW)
  const qid = (asked as { ok: true; message: { id: string } }).message.id
  const answered = sendMany(ws, { fromId: seat("cell-y", "recipient"), fromName: "recipient", fromMemberId: "recipient", toId: seat("cell-y", "asker"), toName: "asker", memberIds: [seat("cell-y", "asker")], leadIds: [seat("cell-y", "asker")], teamId: "team-y", subject: "a", body: "a", kind: "answer", replyTo: qid, answer: { questionId: "Q-seat", answerTo: qid, selected: ["A. one"] } }, [{ id: seat("cell-y", "asker"), name: "asker" }], later(1))
  show("9 seat-key cross-cell answer still passes", { ok: (answered as { ok: boolean }).ok, reason: (answered as { reason?: string }).reason, detail: (answered as { detail?: string }).detail })
  rmSync(ws, { recursive: true, force: true })
}
