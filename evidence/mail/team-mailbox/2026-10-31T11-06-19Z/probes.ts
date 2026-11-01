// T16 RE-REVIEW PROBES (R2 — re-review of T15). Focus: can the optional `problems` field HIDE an
// anomaly, does the durable wake line survive, are both spellings of self refused, and does the AC-8
// projection carry all five envelope fields. Black-box; never edits the package.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  mailboxPath,
  readMailbox,
  readRecords,
  recordWake,
  resolveRecipients,
  scopeToTeam,
  send,
  sendMany,
  type SendInput,
} from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { buildTeamMail } from "../../../../packages/mpd-team-core-plugin/src/team-web.ts"

/** A fresh workspace. */
function box(): string {
  return mkdtempSync(join(tmpdir(), "r2b-probe-"))
}

/** The frozen clock. */
const NOW = new Date("2026-10-31T10:00:00.000Z")

/** One minute after NOW. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** A minimal send input. */
const msg = (over: Record<string, unknown> = {}): SendInput => ({
  fromId: "lead-session",
  fromName: "lead",
  toId: "senior",
  toName: "senior",
  subject: "s",
  body: "b",
  memberIds: ["senior", "researcher"],
  ...over,
})

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

/** Append one raw log line. */
function raw(workspace: string, line: Record<string, unknown>): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  appendFileSync(mailboxPath(workspace), JSON.stringify(line) + "\n")
}

// ── N2: the optional problems field must NEVER hide an anomaly ─────────────────────────────────────
{
  const ws = box()
  const clean = readMailbox(ws)
  show("N2a clean log: present and empty", { present: "problems" in clean, problems: clean.problems, messages: clean.messages.length })
  rmSync(ws, { recursive: true, force: true })
}
{
  const ws = box()
  raw(ws, { t: "send", id: "d1", cellId: "cell-FIRST", teamId: "team-a", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "FIRST", body: "b", at: "t1" })
  raw(ws, { t: "send", id: "d1", cellId: "cell-SECOND", teamId: "team-a", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "SECOND", body: "b", at: "t2" })
  const state = readMailbox(ws)
  show("N2b duplicate id is surfaced, first write and its stamps win", {
    messages: state.messages.map((message) => ({ id: message.id, subject: message.subject, cellId: message.cellId })),
    problems: state.problems,
    scopedProblems: scopeToTeam(state, "team-a").problems,
  })
  // The web projection must surface the same anomaly, not a clean-looking panel.
  show("N2c web projection carries the problem list", { problems: buildTeamMail(ws).problems })
  rmSync(ws, { recursive: true, force: true })
}
{
  const ws = box()
  raw(ws, { t: "send", id: "m1", teamId: "team-a", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "s", body: "b", at: "t1", replyTo: "ghost", threadId: "T-ghost" })
  const state = readMailbox(ws)
  show("N2d unresolved replyTo + rootless threadId are surfaced through the wrapper", { problems: state.problems, messages: state.messages.map((message) => ({ id: message.id, threadId: message.threadId })) })
  rmSync(ws, { recursive: true, force: true })
}

// ── N1: the wake outcome is a DURABLE line with its reason; the mailbox fold ignores it ───────────
{
  const ws = box()
  const sent = send(ws, msg(), NOW)
  const id = (sent as { ok: true; message: { id: string } }).message.id
  const line = recordWake(ws, id, { sent: false, reason: "the Lead has no executor handle" }, later(1))
  const records = readRecords(ws)
  const state = readMailbox(ws)
  show("N1 durable wake line", { line, lastRecord: records[records.length - 1], messageCount: state.messages.length, problems: state.problems })
  show("N1 success wake carries no reason", recordWake(ws, id, { sent: true }, later(2)))
  rmSync(ws, { recursive: true, force: true })
}

// ── F1: self in BOTH spellings, and the resolver the tool now feeds ───────────────────────────────
{
  const ws = box()
  const memberIds = ["M1", "M2"]
  const selfByRoster = send(ws, msg({ memberIds, fromId: "session-M1", fromName: "M1", fromMemberId: "M1", toId: "M1", toName: "M1" }), NOW)
  const selfBySession = send(ws, msg({ memberIds, fromId: "session-M1", fromName: "M1", toId: "session-M1", toName: "M1" }), NOW)
  show("F1a store refuses BOTH spellings", { byRoster: selfByRoster, bySession: { ok: (selfBySession as { ok: boolean }).ok, reason: (selfBySession as { reason?: string }).reason } })
  // The tool now feeds the resolver the caller's ROSTER id; show the fix's effect against the OLD shape.
  const directory = { members: [{ id: "M1", name: "Senior Engineer" }, { id: "M2", name: "Reviewer" }], lead: { id: "lead-session", name: "captain" } }
  show("F1b resolver: selfId = ROSTER id (the T15 fix)", resolveRecipients({ ...directory, selfId: "M1" }, "*"))
  show("F1c resolver: selfId = SESSION id (the old shape)", resolveRecipients({ ...directory, selfId: "session-M1" }, "*"))
  const fan = resolveRecipients({ ...directory, selfId: "M1" }, "*")
  const fanRows = sendMany(ws, msg({ memberIds, leadIds: ["lead-session"], fromId: "session-M1", fromName: "M1", fromMemberId: "M1", subject: "all hands", toId: "M2", toName: "Reviewer" }), (fan as { ok: true; targets: Array<{ id: string; name: string }> }).targets, later(1))
  show("F1d a member's fan-out rows (no self row)", { ok: (fanRows as { ok: boolean }).ok, rows: ((fanRows as { ok: true; messages: Array<{ toId: string }> }).messages ?? []).map((message) => message.toId) })
  rmSync(ws, { recursive: true, force: true })
}

// ── N3 / AC-8: the projection carries all five envelope fields + readBy + problems ───────────────
{
  const ws = box()
  raw(ws, { t: "send", id: "m1", kind: "question", teamId: "team-a", fromId: "s-lead", fromName: "captain", toId: "s-arch", toName: "Architect", subject: "which", body: "which?", at: "t1", threadId: "m1", question: { questionId: "q1", question: "which?", options: [{ label: "A. one" }] } })
  raw(ws, { t: "send", id: "m2", kind: "answer", replyTo: "m1", teamId: "team-a", fromId: "s-arch", fromName: "Architect", toId: "s-lead", toName: "captain", subject: "a", body: "A. one", at: "t2", threadId: "m1", answer: { questionId: "q1", answerTo: "m1", selected: ["A. one"] } })
  raw(ws, { t: "read", id: "m2", at: "t3", by: "captain" })
  const mail = buildTeamMail(ws)
  show("AC-8 projection", {
    problems: mail.problems,
    rows: mail.messages.map((message) => ({ kind: message.kind, threadId: message.threadId, replyTo: message.replyTo, question: message.question?.questionId, answer: message.answer?.selected, readBy: message.readBy })),
  })
  rmSync(ws, { recursive: true, force: true })
}
