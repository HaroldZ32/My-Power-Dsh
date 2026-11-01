// R4 RE-REVIEW PROBES (T9 — cellwork cell view over the unified mailbox). Black-box: installs the REAL
// protocol tools against a fake adapter (the same shape the shipped suite uses) and drives them as
// seats, so every observation is a tool answer. Never edits the package.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { installCellworkProtocol } from "../../../../packages/mpd-cellwork-plugin/src/protocol.ts"
import { newCellState, writeCell } from "../../../../packages/mpd-cellwork-plugin/src/state.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../../../../packages/mpd-cellwork-plugin/src/config.ts"
import { appendRecord } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { cellMailPath, foldCellMail, readCellMail } from "../../../../packages/mpd-cellwork-plugin/src/mail.ts"
import { checkpointRefusal } from "../../../../packages/mpd-cellwork-plugin/src/guard.ts"
import { plannerPrompt } from "../../../../packages/mpd-cellwork-plugin/src/staging.ts"
import type { DshAdapter } from "../../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every probe uses. */
const CELL = "cell-r4"
/** The captain's session. */
const CAP = "cap-session"
/** The member's CURRENT session (what a reseed would have written onto the cell record). */
const CURRENT = "planner-session-new"
/** The member's PREVIOUS session (what rows sent before the reseed were addressed to). */
const STALE = "planner-session-old"
/** The second member's session. */
const SPLITTER = "splitter-session"
/** The cell's team stamp. */
const TEAM = "team-mail"

/** The tool map + fake executor a probe drives. */
interface Harness {
  workspace: string
  tools: Map<string, { execute: (args: Record<string, unknown>, exec: unknown) => unknown }>
  sends: Array<{ handle: string; text: string }>
}

/**
 * Build a harness whose cell record carries the member's session as `memberSession`.
 * @param memberSession - the session id the cell record says the planner answers as.
 * @returns the harness.
 */
function makeHarness(memberSession: string): Harness {
  const workspace = mkdtempSync(join(tmpdir(), "r4-probe-"))
  const cell = {
    ...newCellState({ cellId: CELL, objective: "ship", captainSessionId: CAP, now: new Date("2026-10-31T10:00:00.000Z") }),
    phase: "executing" as const,
    teamId: TEAM,
    members: {
      "cell-planner": { name: "cell-planner", role: "Planner", sessionId: memberSession, executorRef: "handle-planner", mode: "member" as const, handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T10:00:00.000Z" },
      "cell-splitter": { name: "cell-splitter", role: "Splitter", sessionId: SPLITTER, executorRef: "handle-splitter", mode: "member" as const, handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T10:00:00.000Z" },
    },
  }
  writeCell(workspace, cell)
  const tools = new Map<string, { execute: (args: Record<string, unknown>, exec: unknown) => unknown }>()
  const harness: Harness = { workspace, tools, sends: [] }
  const adapter = {
    registerTool: (definition: { name: string; execute: (args: Record<string, unknown>, exec: unknown) => unknown }): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({ send: async (_c: unknown, handle: string, text: string): Promise<void> => { harness.sends.push({ handle, text }) } }),
  }
  installCellworkProtocol({ dsh: adapter as unknown as DshAdapter, ctx: { get: (): undefined => undefined }, config: DEFAULT_CELLWORK_CONFIG, warn: (): void => {} })
  return harness
}

/** One fake agent handle for a session id. */
function agentFor(sessionId: string, workspace: string): { id: string; session: { id: string; header: { cwd: string } } } {
  return { id: sessionId, session: { id: sessionId, header: { cwd: workspace } } }
}

/** Run one captured tool as one agent. */
async function runTool(harness: Harness, name: string, args: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>> {
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  const answer = await tool.execute(args, { name, agent: agentFor(sessionId, harness.workspace) })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
}

/** Append one unified mailbox row. */
function appendMail(workspace: string, row: Record<string, unknown>): void {
  appendRecord(workspace, { t: "send", cellId: CELL, teamId: TEAM, at: "2026-10-31T10:00:00.000Z", threadId: String(row.id), ...row } as never)
}

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

// ── P1 the reseed ack: a row addressed to the member's PREVIOUS session ─────────────────────────────
{
  const h = makeHarness(CURRENT) // the member was reseeded: the record now says CURRENT
  appendMail(h.workspace, { id: "mail-old-1", kind: "message", fromId: CAP, fromName: "captain", toId: STALE, toName: "cell-planner", subject: "before the reseed", body: "b" })
  const first = await runTool(h, "cellwork_inbox", {}, CURRENT)
  const second = await runTool(h, "cellwork_inbox", {}, CURRENT)
  show("P1 reseeded member reads stale-addressed mail", {
    firstReturned: (first.messages as unknown[] | undefined)?.length ?? -1,
    firstAcknowledged: first.acknowledged,
    secondReturned: (second.messages as unknown[] | undefined)?.length ?? -1,
    secondAcknowledged: second.acknowledged,
    storeReadRows: readCellMail(h.workspace, CELL).filter((record) => record.t === "read").length,
  })
}

// ── P1b CONTROL: the same row addressed to the member's CURRENT session ─────────────────────────────
{
  const h = makeHarness(CURRENT)
  appendMail(h.workspace, { id: "mail-new-1", kind: "message", fromId: CAP, fromName: "captain", toId: CURRENT, toName: "cell-planner", subject: "after the reseed", body: "b" })
  const first = await runTool(h, "cellwork_inbox", {}, CURRENT)
  const second = await runTool(h, "cellwork_inbox", {}, CURRENT)
  show("P1b CONTROL current-session mail", { firstReturned: (first.messages as unknown[] | undefined)?.length ?? -1, firstAcknowledged: first.acknowledged, secondReturned: (second.messages as unknown[] | undefined)?.length ?? -1 })
}

// ── P2 an answer to a question addressed to a seat id the sender no longer holds ────────────────────
{
  const h = makeHarness(CURRENT)
  // A question sent when the seat had no live handle: toId is the synthetic seat key.
  appendMail(h.workspace, {
    id: "mail-q1", kind: "question", fromId: CAP, fromName: "captain", fromMemberId: "captain",
    toId: "seat:" + CELL + "/cell-planner", toName: "cell-planner", subject: "which?", body: "which?",
    question: { questionId: "q1", question: "which?", options: [{ label: "A. one" }] },
  })
  const answered = await runTool(h, "cellwork_send", { to: "captain", subject: "a", body: "A. one", kind: "answer", replyTo: "mail-q1", selected: ["A. one"] }, CURRENT)
  show("P2 answer to a synthetic (never-raised) seat id", { ok: answered.ok, error: answered.error })
}

// ── P2b CONTROL: the same question addressed to the member's CURRENT session ────────────────────────
{
  const h = makeHarness(CURRENT)
  appendMail(h.workspace, {
    id: "mail-q2", kind: "question", fromId: CAP, fromName: "captain", fromMemberId: "captain",
    toId: CURRENT, toName: "cell-planner", subject: "which?", body: "which?",
    question: { questionId: "q2", question: "which?", options: [{ label: "B. two" }] },
  })
  const answered = await runTool(h, "cellwork_send", { to: "captain", subject: "a", body: "B. two", kind: "answer", replyTo: "mail-q2", selected: ["B. two"] }, CURRENT)
  show("P2b CONTROL answer to the current-session row", { ok: answered.ok, error: answered.error })
}

// ── P2c the realistic rot: a question addressed to the seat's PREVIOUS session, answered after reseed ─
{
  const h = makeHarness(CURRENT)
  appendMail(h.workspace, {
    id: "mail-q3", kind: "question", fromId: CAP, fromName: "captain", fromMemberId: "captain",
    toId: STALE, toName: "cell-planner", subject: "which?", body: "which?",
    question: { questionId: "q3", question: "which?", options: [{ label: "C. three" }] },
  })
  const answered = await runTool(h, "cellwork_send", { to: "captain", subject: "a", body: "C. three", kind: "answer", replyTo: "mail-q3", selected: ["C. three"] }, CURRENT)
  show("P2c answer to a question sent BEFORE the reseed", { ok: answered.ok, error: answered.error })
}

// ── P8 CROSS-CELL: a question from the parent must be answerable by the sub-cell ───────────────────
{
  const workspace = mkdtempSync(join(tmpdir(), "r4-tree-"))
  const parent = {
    ...newCellState({ cellId: "cell-parent", objective: "parent", captainSessionId: "pcap", now: new Date("2026-10-31T10:00:00.000Z") }),
    phase: "executing" as const,
    teamId: "team-parent",
    subcellIds: ["cell-sub"],
  }
  const sub = {
    ...newCellState({ cellId: "cell-sub", objective: "sub", captainSessionId: "scap", now: new Date("2026-10-31T10:00:00.000Z"), depth: 1, parentCellId: "cell-parent" }),
    phase: "executing" as const,
    teamId: "team-sub",
  }
  writeCell(workspace, parent)
  writeCell(workspace, sub)
  const tools = new Map<string, { execute: (args: Record<string, unknown>, exec: unknown) => unknown }>()
  const adapter = {
    registerTool: (definition: { name: string; execute: (args: Record<string, unknown>, exec: unknown) => unknown }): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): undefined => undefined,
  }
  installCellworkProtocol({ dsh: adapter as unknown as DshAdapter, ctx: { get: (): undefined => undefined }, config: DEFAULT_CELLWORK_CONFIG, warn: (): void => {} })
  const call = async (name: string, args: Record<string, unknown>, session: string): Promise<Record<string, unknown>> => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error("no tool " + name)
    const answer = await tool.execute(args, { name, agent: agentFor(session, workspace) })
    return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
  }
  // CONTROL 1: a plain message crosses both ways.
  const plainDown = await call("cellwork_send", { to: "cell-sub/captain", subject: "hello", body: "down" }, "pcap")
  const plainUp = await call("cellwork_send", { to: "cell-parent/captain", subject: "hello", body: "up" }, "scap")
  // THE PAIR: the parent asks the sub captain, the sub captain answers.
  const asked = await call("cellwork_send", { to: "cell-sub/captain", subject: "which scope?", body: "which?", kind: "question", options: [{ label: "A. narrow" }, { label: "B. wide" }] }, "pcap")
  const answered = await call("cellwork_send", { to: "cell-parent/captain", subject: "answer", body: "A. narrow", kind: "answer", replyTo: String(asked.id ?? ""), selected: ["A. narrow"] }, "scap")
  show("P8 cross-cell plain messages", { down: plainDown.ok, up: plainUp.ok })
  show("P8 cross-cell question", { askedOk: asked.ok, askedError: asked.error, questionCell: asked.id === undefined ? undefined : String(asked.id) })
  show("P8 cross-cell ANSWER (the round-trip)", { ok: answered.ok, error: answered.error })
  // P8b — pass the correlation key EXPLICITLY, isolating the second layer: the reference scope.
  const answeredExplicit = await call("cellwork_send", { to: "cell-parent/captain", subject: "answer", body: "A. narrow", kind: "answer", replyTo: String(asked.id ?? ""), questionId: "q-cross", selected: ["A. narrow"] }, "scap")
  show("P8b cross-cell answer with an explicit questionId", { ok: answeredExplicit.ok, error: answeredExplicit.error })
}

// ── P3 cross-cell scoping: a row belongs to ONE cell's view ────────────────────────────────────────
{
  const h = makeHarness(CURRENT)
  appendMail(h.workspace, { id: "mail-a", kind: "message", fromId: CAP, fromName: "captain", toId: CURRENT, toName: "cell-planner", subject: "A", body: "a" })
  appendRecord(h.workspace, { t: "send", id: "mail-b", cellId: "other-cell", teamId: "team-other", fromId: "x", fromName: "x", toId: "y", toName: "y", subject: "B", body: "b", at: "2026-10-31T10:00:01.000Z" } as never)
  show("P3 cross-cell scoping", {
    cellRows: readCellMail(h.workspace, CELL).filter((record) => record.t === "send").map((record) => record.id),
    otherRows: readCellMail(h.workspace, "other-cell").filter((record) => record.t === "send").map((record) => record.id),
  })
}

// ── P4 legacy log: readable and ack-once ───────────────────────────────────────────────────────────
{
  const h = makeHarness(CURRENT)
  const path = cellMailPath(h.workspace, CELL)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify({ t: "send", id: "cellmail-legacy-1", cellId: CELL, from: "captain", to: "cell-planner", subject: "old", body: "legacy", at: "2026-09-30T10:00:00.000Z", wakeSent: false }) + "\n")
  const first = await runTool(h, "cellwork_inbox", {}, CURRENT)
  const second = await runTool(h, "cellwork_inbox", {}, CURRENT)
  show("P4 legacy ack-once", { firstReturned: (first.messages as unknown[] | undefined)?.length ?? -1, firstAcknowledged: first.acknowledged, secondReturned: (second.messages as unknown[] | undefined)?.length ?? -1 })
}

// ── P5 member-to-member durable mail keeps its wake sentence ───────────────────────────────────────
{
  const h = makeHarness(CURRENT)
  const sent = await runTool(h, "cellwork_send", { to: "cell-splitter", subject: "handoff note", body: "one line" }, CURRENT)
  show("P5 member-to-member durable mail", { ok: sent.ok, wakeSent: sent.wakeSent, wakeReason: sent.wakeReason, to: sent.to })
}

// ── P6 AC-5 text: the checkpoint refusal and the planner relay ─────────────────────────────────────
{
  const refusal = checkpointRefusal("cellwork_send")
  const prose = plannerPrompt({ cell: newCellState({ cellId: "cell-r4", objective: "o", captainSessionId: CAP, now: new Date() }), personaFor: (): string => "" })
  show("P6 AC-5 text", {
    checkpointNamesQuestion: refusal.includes("question") && refusal.includes("cannot be asked or answered at a checkpoint"),
    checkpointNamesBothTools: refusal.includes("cellwork_send") && refusal.includes("cellwork_inbox"),
    relayHasQuestionKind: prose.includes('kind:"question"'),
    relayHasReadAnswer: prose.includes("cellwork_inbox") && prose.includes("answer"),
  })
}

// ── P7 the fold still renders a question's labels from the unified row ─────────────────────────────
{
  const h = makeHarness(CURRENT)
  appendMail(h.workspace, { id: "mail-q3", kind: "question", fromId: CAP, fromName: "captain", toId: CURRENT, toName: "cell-planner", subject: "which", body: "which?", question: { questionId: "q3", question: "which?", options: [{ label: "A. one" }, { label: "B. two" }] } })
  const inbox = await runTool(h, "cellwork_inbox", {}, CURRENT)
  const rendered = h.tools.get("cellwork_inbox")?.constructor === undefined ? "" : ""
  const messages = (inbox.messages as Array<Record<string, unknown>> | undefined) ?? []
  show("P7 unified question reaches the inbox object", { returned: messages.length, kind: messages[0]?.kind, labels: ((messages[0]?.question as Record<string, unknown> | undefined)?.options as Array<Record<string, unknown>> | undefined)?.map((option) => option.label), renderHelperUnused: rendered })
}
