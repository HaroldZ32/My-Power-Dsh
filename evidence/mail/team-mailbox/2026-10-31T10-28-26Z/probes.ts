// R2 RE-REVIEW PROBES (T7 — team mailbox). Black-box exercises of contract §5 / AC-2 / AC-8 that the
// shipped arms do NOT pin, plus an independent measurement of the tool-surface budget. Never edits the
// package; imports its source and drives it against temp workspaces.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  acknowledge,
  fold,
  mailboxPath,
  markRead,
  readMailbox,
  resolveRecipients,
  scopeToTeam,
  send,
  sendMany,
  unreadOf,
  type SendInput,
} from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { buildTeamMail } from "../../../../packages/mpd-team-core-plugin/src/team-web.ts"
import { apply } from "../../../../packages/mpd-team-core-plugin/src/index.ts"

/** A fresh workspace holding one mailbox log. */
function box(): string {
  return mkdtempSync(join(tmpdir(), "r2-probe-"))
}

/** The frozen clock every probe uses. */
const NOW = new Date("2026-10-31T10:00:00.000Z")

/** One minute after NOW. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** A well-formed send input. */
const msg = (over: Record<string, unknown> = {}): SendInput => ({
  fromId: "lead",
  fromName: "lead",
  toId: "senior",
  toName: "senior",
  subject: "s",
  body: "b",
  memberIds: ["lead", "senior", "researcher"],
  ...over,
})

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

// ── FOCUS 1: the tool-surface budget, measured with the SHIPPED cost function ──────────────────────
/** What one registration costs the context, copied from test/tool-surface.test.ts's `costOf`. */
const costOf = (tool: { name: string; description: string; parameters: unknown }): number => JSON.stringify({ n: tool.name, d: tool.description, p: tool.parameters }).length
/** Apply the plugin to a stub adapter and return the registrations. */
function captureSurface(): { tools: Array<{ name: string; description: string; parameters: unknown }>; commands: Array<{ name: string }> } {
  const out = { tools: [] as Array<{ name: string; description: string; parameters: unknown }>, commands: [] as Array<{ name: string }> }
  const noop = (): (() => void) => () => {}
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, prop) => {
      if (prop === "registerTool") return (d: { name: string; description: string; parameters: unknown }) => { out.tools.push(d); return () => {} }
      if (prop === "registerCommand") return (d: { name: string }) => { out.commands.push(d); return () => {} }
      if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "r2-surface-"))
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  const ctx = {
    get: (name: string) => (name === "mpdDsh" ? dsh : undefined),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: noop,
    inject: noop,
  }
  apply(ctx as never)
  return out
}
const surface = captureSurface()
const total = surface.tools.reduce((sum, tool) => sum + costOf(tool), 0) + surface.commands.length * 96
show("S1 surface total chars", total)
show("S2 tools + commands", { tools: surface.tools.length, commands: surface.commands.length, sum: surface.tools.length + surface.commands.length })
show("S3 per-tool chars", surface.tools.map((tool) => ({ name: tool.name, chars: costOf(tool) })))
show("S4 mail tool chars", surface.tools.filter((tool) => tool.name === "agent_teams_mail").map((tool) => costOf(tool)))

// ── FOCUS 4: captain addressing + fan-out ────────────────────────────────────────────────────────────
const directory = {
  members: [{ id: "M1", name: "Senior Engineer" }, { id: "M2", name: "Reviewer" }],
  lead: { id: "lead-session", name: "captain" },
  selfId: "lead-session",
}
show("S5 to:'captain' as lead", resolveRecipients(directory, "captain"))
show("S6 to:'*' as lead (sender excluded)", resolveRecipients(directory, "*"))
show("S7 to:'captain' with no lead recorded", resolveRecipients({ members: directory.members, selfId: "M1" }, "captain"))

// ── FOCUS 3: the stamp pass-through (cellId/fromCell must not be team semantics) ───────────────────
const stampBox = box()
send(stampBox, msg({ cellId: "cell-1", fromCell: "cell-0", teamId: "team-a" }), NOW)
const stamped = readMailbox(stampBox)
show("S8 stamps survive", { cellId: stamped.messages[0]?.cellId, fromCell: stamped.messages[0]?.fromCell, teamId: stamped.messages[0]?.teamId })
show("S9 scope by team / by cell id", { teamRows: scopeToTeam(stamped, "team-a").messages.length, cellRows: scopeToTeam(stamped, "cell-1").messages.length })
rmSync(stampBox, { recursive: true, force: true })

// ── FOCUS 2: ack ownership — the primitive behind the H1 arm ───────────────────────────────────────
const ackBox = box()
send(ackBox, msg(), NOW)
const ackId = readMailbox(ackBox).messages[0].id
const stranger = acknowledge(ackBox, [ackId], { byId: "researcher", byName: "researcher" }, later(1))
show("S10 stranger ack", { moved: stranger.moved, refused: stranger.refused })
show("S11 stranger ack leaves unread", unreadOf(readMailbox(ackBox), "senior").length)
const owner = acknowledge(ackBox, [ackId], { byId: "senior", byName: "senior" }, later(2))
show("S12 addressee ack", { moved: owner.moved, readBy: readMailbox(ackBox).messages[0].readBy })
rmSync(ackBox, { recursive: true, force: true })

// ── AC-2: question/answer round-trip, per-recipient ack, bound per row ─────────────────────────────
const qaBox = box()
const question = { questionId: "q1", question: "which store?", options: [{ label: "A. one" }, { label: "B. two" }] }
const asked = send(qaBox, msg({ kind: "question", question }), NOW)
const questionRow = (asked as { ok: true; message: { id: string; threadId: string } }).message
const answered = send(qaBox, msg({ kind: "answer", fromId: "senior", fromName: "senior", fromMemberId: "M2", toId: "lead", toName: "lead", answer: { questionId: "q1", answerTo: questionRow.id, selected: ["B. two"] } }), later(1))
const qa = readMailbox(qaBox)
show("S13 question/answer round-trip", {
  questionKind: qa.messages[0].kind,
  answerOk: (answered as { ok: boolean }).ok,
  answerSelected: qa.messages[1]?.answer?.selected,
  sameThread: qa.messages[1]?.threadId === qa.messages[0]?.threadId,
})
rmSync(qaBox, { recursive: true, force: true })

const fanBox = box()
const fanTargets = [{ id: "senior", name: "senior" }, { id: "researcher", name: "researcher" }]
const fan = sendMany(fanBox, msg({ subject: "fan", fromId: "lead", fromName: "lead" }), fanTargets, NOW)
const fanIds = (fan as { ok: true; messages: Array<{ id: string; toId: string }> }).messages
show("S14 fan-out rows", { ok: (fan as { ok: boolean }).ok, rows: fanIds.map((m) => m.toId) })
const ackOne = acknowledge(fanBox, [fanIds[1].id], { byId: fanIds[1].toId, byName: fanIds[1].toId }, later(1))
show("S15 per-recipient ack", { moved: ackOne.moved, otherStillUnread: unreadOf(readMailbox(fanBox), fanIds[0].toId).length })
rmSync(fanBox, { recursive: true, force: true })

const boundBox = box()
for (let i = 0; i < 8; i += 1) send(boundBox, msg({ subject: "q" + i, toId: "researcher", toName: "researcher" }), later(i))
const broadcast = sendMany(boundBox, msg({ subject: "fan", fromId: "lead", fromName: "lead" }), [{ id: "senior", name: "senior" }, { id: "researcher", name: "researcher" }], later(9))
show("S16 bound per fan-out row", { ok: (broadcast as { ok: boolean }).ok, reason: (broadcast as { reason?: string }).reason, detail: (broadcast as { detail?: string }).detail })
show("S17 atomic refusal (rows written)", readMailbox(boundBox).messages.filter((m) => m.subject === "fan").length)
rmSync(boundBox, { recursive: true, force: true })

// ── AC-2: non-recipient answer + non-addressee ack ─────────────────────────────────────────────────
const ownBox = box()
const ownAsked = send(ownBox, msg({ kind: "question", question }), NOW)
const ownRow = (ownAsked as { ok: true; message: { id: string } }).message
const bystander = send(ownBox, msg({ kind: "answer", fromId: "researcher", fromName: "researcher", answer: { questionId: "q1", answerTo: ownRow.id, selected: ["A. one"] } }), later(1))
show("S18 non-recipient answer", { ok: (bystander as { ok: boolean }).ok, reason: (bystander as { reason?: string }).reason, detail: (bystander as { detail?: string }).detail })
rmSync(ownBox, { recursive: true, force: true })

// ── CANDIDATE FINDING: a MEMBER's broadcast/self-send uses session ids where the roster uses M-ids ─
const memberDirectory = {
  members: [{ id: "M1", name: "Senior Engineer" }, { id: "M2", name: "Reviewer" }],
  lead: { id: "lead-session", name: "captain" },
  selfId: "session-M1",
}
show("S19 member to:'*' (sender = M1's session)", resolveRecipients(memberDirectory, "*"))
const memberBox = box()
const memberFan = resolveRecipients(memberDirectory, "*")
const memberFanResult = sendMany(memberBox, msg({ fromId: "session-M1", fromName: "M1", fromMemberId: "M1", memberIds: ["M1", "M2"], leadIds: ["lead-session"] }), (memberFan as { ok: true; targets: Array<{ id: string; name: string }> }).targets, NOW)
show("S20 member broadcast rows", { ok: (memberFanResult as { ok: boolean }).ok, rows: ((memberFanResult as { ok: true; messages: Array<{ toId: string }> }).messages ?? []).map((m) => m.toId) })
const selfSend = send(memberBox, msg({ fromId: "session-M1", fromName: "M1", fromMemberId: "M1", toId: "M1", toName: "M1", memberIds: ["M1", "M2"] }), later(1))
show("S21 member sends to its OWN roster id", { ok: (selfSend as { ok: boolean }).ok, reason: (selfSend as { reason?: string }).reason })
rmSync(memberBox, { recursive: true, force: true })

// ── CANDIDATE NIT: the protocol fold's problems are dropped by the team mailbox wrapper ─────────────
const dupBox = box()
mkdirSync(join(dupBox, ".mpd", "team"), { recursive: true })
writeFileSync(mailboxPath(dupBox), [
  JSON.stringify({ t: "send", id: "d1", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "first", body: "first", at: "t1" }),
  JSON.stringify({ t: "send", id: "d1", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "second", body: "second", at: "t2" }),
].join("\n") + "\n")
show("S22 duplicate id through the team wrapper", { messages: readMailbox(dupBox).messages.map((m) => ({ id: m.id, body: m.body })), wrapperKeys: Object.keys(readMailbox(dupBox)) })
rmSync(dupBox, { recursive: true, force: true })

// ── AC-8: the web projection carries replyTo/answer (the shipped test asserts only some fields) ────
const webBox = box()
mkdirSync(join(webBox, ".mpd", "team"), { recursive: true })
writeFileSync(mailboxPath(webBox), [
  JSON.stringify({ t: "send", id: "m1", kind: "question", fromId: "lead", fromName: "captain", toId: "s-arch", toName: "Architect", subject: "which", body: "which?", at: "t1", threadId: "m1", question: { questionId: "q1", question: "which?", options: [{ label: "A. one" }] } }),
  JSON.stringify({ t: "send", id: "m2", kind: "answer", fromId: "s-arch", fromName: "Architect", toId: "lead", toName: "captain", subject: "a", body: "A. one", at: "t2", replyTo: "m1", threadId: "m1", answer: { questionId: "q1", answerTo: "m1", selected: ["A. one"] } }),
].join("\n") + "\n")
const mail = buildTeamMail(webBox)
show("S23 web projection envelope", mail.messages.map((m) => ({ kind: m.kind, threadId: m.threadId, replyTo: m.replyTo, question: m.question?.questionId, answer: m.answer?.selected })))
rmSync(webBox, { recursive: true, force: true })

// ── Sanity: fold is the protocol fold (legacy row defaults + thread mint) ─────────────────────────
const legacy = fold([{ t: "send", id: "l1", fromId: "a", fromName: "a", toId: "b", toName: "b", subject: "s", body: "b", at: "t" }])
show("S24 legacy row default", { kind: legacy.messages[0]?.kind, threadId: legacy.messages[0]?.threadId })
