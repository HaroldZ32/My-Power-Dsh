// T19 RE-REVIEW PROBES (T17 — workspace-wide reference resolution). The adversarial question: can a
// member of team X use the refusal/acceptance of an ANSWER that references team Y's question to learn
// team Y's offered LABELS (or a thread id / message existence) it cannot see? Black-box over sendMany;
// never edits the package.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readMailbox, readRecords, send, sendMany, type SendInput } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** A fresh workspace. */
function box(): string {
  return mkdtempSync(join(tmpdir(), "r2c-probe-"))
}

/** The frozen clock. */
const NOW = new Date("2026-10-31T10:00:00.000Z")

/** One minute later. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

/** Team X's send input: a member of team X addressing another member of team X. */
function xInput(over: Record<string, unknown> = {}): SendInput {
  return {
    fromId: "x-member-session",
    fromName: "X Member",
    fromMemberId: "M1",
    toId: "x-target-session",
    toName: "X Target",
    subject: "s",
    body: "b",
    memberIds: ["x-member-session", "x-target-session", "x-other-session"],
    leadIds: ["x-lead-session"],
    teamId: "team-x",
    ...over,
  }
}

/** Plant TEAM Y's question: the secret labels live here. */
function plantYQuestion(workspace: string): string {
  const sent = send(workspace, {
    fromId: "y-asker-session",
    fromName: "Y Asker",
    fromMemberId: "M1",
    toId: "y-recipient-session",
    toName: "Y Recipient",
    subject: "Y secret question",
    body: "Y secret?",
    memberIds: ["y-recipient-session"],
    teamId: "team-y",
    kind: "question",
    question: { questionId: "y-secret", question: "Y secret?", options: [{ label: "A. secret-one" }, { label: "B. secret-two" }] },
  }, NOW)
  return (sent as { ok: true; message: { id: string } }).message.id
}

// ── 1/3: a NON-RECIPIENT's answer referencing team Y's question, with a WRONG label ────────────────
{
  const ws = box()
  const yQuestion = plantYQuestion(ws)
  const refused = sendMany(ws, xInput({ kind: "answer", answer: { questionId: "y-secret", answerTo: yQuestion, selected: ["Z. made-up"] } }), [{ id: "x-target-session", name: "X Target" }], later(1))
  const failure = refused as { ok: false; reason?: string; detail?: string }
  show("1a cross-team answer, wrong label: reason and whether TEAM Y's labels are echoed", {
    ok: (refused as { ok: boolean }).ok,
    reason: failure.reason,
    detail: failure.detail,
    leaksLabelText: String(failure.detail ?? "").includes("A. secret-one") || String(failure.detail ?? "").includes("B. secret-two"),
    mentionsValidLabels: String(failure.detail ?? "").includes("valid labels"),
  })
  show("1b nothing was written", readRecords(ws).filter((record) => (record as { t?: string }).t === "send").length)
  rmSync(ws, { recursive: true, force: true })
}

// ── 1c/3: the same answer with a CORRECT label — is the AUTHORIZATION check reached at all? ────────
{
  const ws = box()
  const yQuestion = plantYQuestion(ws)
  const accepted = sendMany(ws, xInput({ kind: "answer", answer: { questionId: "y-secret", answerTo: yQuestion, selected: ["A. secret-one"] } }), [{ id: "x-target-session", name: "X Target" }], later(1))
  const rows = readMailbox(ws).messages
  show("1c cross-team answer with a VALID label (authorization reachable?)", {
    ok: (accepted as { ok: boolean }).ok,
    reason: (accepted as { reason?: string }).reason,
    writtenRows: rows.filter((message) => message.kind === "answer").map((message) => ({ toId: message.toId, teamId: message.teamId, answerTo: message.answer?.answerTo, threadId: message.threadId })),
  })
  rmSync(ws, { recursive: true, force: true })
}

// ── 2: a question the caller IS addressed in (same team) still echoes labels on a wrong echo ───────
{
  const ws = box()
  const asked = send(ws, xInput({ kind: "question", toId: "x-target-session", toName: "X Target", question: { questionId: "x-q", question: "X?", options: [{ label: "A. x-one" }, { label: "B. x-two" }] } }), NOW)
  const xQuestion = (asked as { ok: true; message: { id: string } }).message.id
  const refused = sendMany(ws, xInput({ kind: "answer", fromId: "x-target-session", fromName: "X Target", fromMemberId: "M2", answer: { questionId: "x-q", answerTo: xQuestion, selected: ["Z. nope"] } }), [{ id: "x-member-session", name: "X Member" }], later(1))
  const failure = refused as { ok: false; reason?: string; detail?: string }
  show("2 same-team, the ADDRESSEE echoes a wrong label (unchanged?)", { ok: (refused as { ok: boolean }).ok, reason: failure.reason, detail: failure.detail })
  rmSync(ws, { recursive: true, force: true })
}

// ── 2b: same team, a NON-recipient answers with a wrong label — does the echo reach them? ──────────
{
  const ws = box()
  const asked = send(ws, xInput({ kind: "question", toId: "x-target-session", toName: "X Target", question: { questionId: "x-q2", question: "X?", options: [{ label: "A. x-one" }, { label: "B. x-two" }] } }), NOW)
  const xQuestion = (asked as { ok: true; message: { id: string } }).message.id
  // x-other-session was NOT addressed; it answers back to x-member-session.
  const refused = sendMany(ws, xInput({ fromId: "x-other-session", fromName: "X Other", fromMemberId: "M3", toId: "x-member-session", toName: "X Member", answer: { questionId: "x-q2", answerTo: xQuestion, selected: ["Z. nope"] }, kind: "answer" }), [{ id: "x-member-session", name: "X Member" }], later(1))
  const failure = refused as { ok: false; reason?: string; detail?: string }
  show("2b same-team NON-recipient, wrong label: reason and echo", { ok: (refused as { ok: boolean }).ok, reason: failure.reason, detail: failure.detail, leaksLabelText: String(failure.detail ?? "").includes("A. x-one") })
  rmSync(ws, { recursive: true, force: true })
}

// ── 4: thread/message visibility across teams (a non-recipient's reply to a foreign message) ───────
{
  const ws = box()
  const yQuestion = plantYQuestion(ws)
  const replied = sendMany(ws, xInput({ subject: "reply to Y", replyTo: yQuestion }), [{ id: "x-target-session", name: "X Target" }], later(1))
  const row = readMailbox(ws).messages.find((message) => message.subject === "reply to Y")
  show("4a plain reply to a FOREIGN message (accepted? thread leaked?)", { ok: (replied as { ok: boolean }).ok, replyTo: row?.replyTo, threadId: row?.threadId, yQuestionId: yQuestion })
  const ghost = sendMany(ws, xInput({ subject: "reply to ghost", replyTo: "mail-19700101000000-999" }), [{ id: "x-target-session", name: "X Target" }], later(2))
  show("4b a FOREIGN/nonexistent id is an existence oracle", { ok: (ghost as { ok: boolean }).ok, reason: (ghost as { reason?: string }).reason, detail: (ghost as { detail?: string }).detail })
  rmSync(ws, { recursive: true, force: true })
}
