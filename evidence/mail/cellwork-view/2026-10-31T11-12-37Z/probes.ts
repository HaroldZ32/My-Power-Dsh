// T20 RE-REVIEW PROBES (T18 — cellwork: cross-cell answer visibility, stable seat keys, ack reasons).
// Tool-level, over the REAL registered cellwork tools on fake adapters. Black-box; no package edits.

import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { installCellworkProtocol } from "../../../../packages/mpd-cellwork-plugin/src/protocol.ts"
import { newCellState, writeCell } from "../../../../packages/mpd-cellwork-plugin/src/state.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../../../../packages/mpd-cellwork-plugin/src/config.ts"
import { cellMailboxPath } from "../../../../packages/mpd-cellwork-plugin/src/mail.ts"
import { checkpointRefusal } from "../../../../packages/mpd-cellwork-plugin/src/guard.ts"
import type { DshAdapter } from "../../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

/** The single cell's id. */
const CELL = "cell-r4"
/** The parent/sub cell ids. */
const PARENT = "cell-parent"
const SUB = "cell-sub"
/** Session ids. */
const CAP = "cap-session"
const CURRENT = "planner-session-new"
const STALE = "planner-session-old"
const SPLITTER = "splitter-session"

/** A captured tool map + fake executor. */
interface Harness {
  workspace: string
  tools: Map<string, { execute: (args: Record<string, unknown>, exec: unknown) => unknown }>
  sends: Array<{ handle: string; text: string }>
}

/** Install the tools over one workspace. */
function harness(cells: Array<Record<string, unknown>>): Harness {
  const workspace = mkdtempSync(join(tmpdir(), "r4b-probe-"))
  for (const cell of cells) writeCell(workspace, cell as never)
  const tools = new Map<string, { execute: (args: Record<string, unknown>, exec: unknown) => unknown }>()
  const h: Harness = { workspace, tools, sends: [] }
  const adapter = {
    registerTool: (definition: { name: string; execute: (args: Record<string, unknown>, exec: unknown) => unknown }): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({ send: async (_c: unknown, handle: string, text: string): Promise<void> => { h.sends.push({ handle, text }) } }),
  }
  installCellworkProtocol({ dsh: adapter as unknown as DshAdapter, ctx: { get: (): undefined => undefined }, config: DEFAULT_CELLWORK_CONFIG, warn: (): void => {} })
  return h
}

/** One member row. */
function member(name: string, sessionId: string): Record<string, unknown> {
  return { name, role: name, sessionId, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T18:00:00.000Z" }
}

/** One executing cell record. */
function cell(cellId: string, captainSessionId: string, teamId: string, members: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...newCellState({ cellId, objective: "o", captainSessionId, now: new Date("2026-10-31T18:00:00.000Z") }), phase: "executing", teamId, members, ...extra }
}

/** The stable seat key T18 uses (mirrors protocol.ts's seatKey). */
function seat(cellId: string, name: string): string {
  return "seat:" + cellId + "/" + name.toLowerCase()
}

/** Run one tool as one agent. */
async function run(h: Harness, name: string, args: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>> {
  const tool = h.tools.get(name)
  if (tool === undefined) throw new Error("no tool " + name)
  const answer = await tool.execute(args, { name, agent: { id: sessionId, session: { id: sessionId, header: { cwd: h.workspace } } } })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
}

/** The rendered text of one tool answer. */
function rendered(h: Harness, name: string, value: unknown): string {
  const render = h.tools.get(name)?.constructor === undefined ? undefined : (h.tools.get(name) as { output?: { render?: (a: unknown, v: unknown) => unknown } } | undefined)?.output?.render
  const blocks = render?.(undefined, value)
  return Array.isArray(blocks) ? blocks.map((block: unknown) => String((block as { text?: unknown }).text ?? "")).join("\n") : ""
}

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

// ── F2: a reseeded seat acks/answers the rows addressed to its STABLE seat key ─────────────────────
{
  const h = harness([cell(CELL, CAP, "team-mail", { "cell-planner": member("cell-planner", CURRENT), "cell-splitter": member("cell-splitter", SPLITTER) })])
  // A row addressed to the seat key, sent BEFORE the reseed (the old session is irrelevant now).
  mkdirSync(join(h.workspace, ".mpd", "team"), { recursive: true })
  appendFileSync(cellMailboxPath(h.workspace), JSON.stringify({ t: "send", id: "mail-seat-1", fromId: seat(CELL, "captain"), fromName: "captain", toId: seat(CELL, "cell-planner"), toName: "cell-planner", subject: "before reseed", body: "b", at: "2026-10-31T18:00:01.000Z", cellId: CELL, teamId: "team-mail", kind: "question", threadId: "mail-seat-1", question: { questionId: "q-seat", question: "which?", options: [{ label: "A. one" }] } }) + "\n")
  const first = await run(h, "cellwork_inbox", {}, CURRENT)
  const second = await run(h, "cellwork_inbox", {}, CURRENT)
  show("F2 reseeded seat acks seat-key mail exactly once", { firstReturned: (first.messages as unknown[] | undefined)?.length, firstAcked: first.acknowledged, refused: first.refused, secondReturned: (second.messages as unknown[] | undefined)?.length })
  const answered = await run(h, "cellwork_send", { to: "captain", subject: "a", body: "A. one", kind: "answer", replyTo: "mail-seat-1", selected: ["A. one"] }, CURRENT)
  show("F2b reseeded seat ANSWERS the seat-key question", { ok: answered.ok, error: answered.error })
}

// ── N1: a PRE-FIX (session-addressed) row is listed but the refusal is REPORTED with its reason ────
{
  const h = harness([cell(CELL, CAP, "team-mail", { "cell-planner": member("cell-planner", CURRENT), "cell-splitter": member("cell-splitter", SPLITTER) })])
  mkdirSync(join(h.workspace, ".mpd", "team"), { recursive: true })
  appendFileSync(cellMailboxPath(h.workspace), JSON.stringify({ t: "send", id: "mail-prefix-row", fromId: "session-someone", fromName: "captain", toId: STALE, toName: "cell-planner", subject: "old row", body: "old", at: "2026-10-31T18:00:01.000Z", cellId: CELL, teamId: "team-mail" }) + "\n")
  const inbox = await run(h, "cellwork_inbox", {}, CURRENT)
  show("N1 pre-fix row: acknowledged 0 but the reason is carried", { returned: (inbox.messages as unknown[] | undefined)?.length, acknowledged: inbox.acknowledged, refused: inbox.refused, rendered: rendered(h, "cellwork_inbox", inbox).slice(0, 220) })
}

// ── F1: a cross-cell question is answered in BOTH directions without an explicit questionId ───────
{
  const h = harness([
    cell(PARENT, "pcap", "team-parent", {}, { subcellIds: [SUB] }),
    cell(SUB, "scap", "team-sub", { "cell-planner": member("cell-planner", CURRENT) }, { parentCellId: PARENT, depth: 1 }),
  ])
  const down = await run(h, "cellwork_send", { to: SUB + "/captain", subject: "which", body: "which?", kind: "question", options: [{ label: "A. unify" }] }, "pcap")
  const subInbox = await run(h, "cellwork_inbox", {}, "scap")
  const answeredDown = await run(h, "cellwork_send", { to: PARENT + "/captain", subject: "a", body: "A. unify", kind: "answer", replyTo: String(down.id), selected: ["A. unify"] }, "scap")
  const parentInbox = await run(h, "cellwork_inbox", {}, "pcap")
  const up = await run(h, "cellwork_send", { to: PARENT + "/captain", subject: "budget", body: "how much?", kind: "question", options: [{ label: "B. less" }] }, "scap")
  const answeredUp = await run(h, "cellwork_send", { to: SUB + "/captain", subject: "a", body: "B. less", kind: "answer", replyTo: String(up.id), selected: ["B. less"] }, "pcap")
  const subInbox2 = await run(h, "cellwork_inbox", {}, "scap")
  show("F1 cross-cell round-trip both directions (no explicit questionId)", {
    downOk: down.ok,
    subSawQuestion: (subInbox.messages as unknown[] | undefined)?.length,
    answeredDown: answeredDown.ok,
    parentSawAnswer: ((parentInbox.messages as Array<Record<string, unknown>> | undefined)?.[0]?.answer as Record<string, unknown> | undefined)?.selected,
    upOk: up.ok,
    answeredUp: answeredUp.ok,
    subSawAnswer2: (subInbox2.messages as unknown[] | undefined)?.length,
  })
  // F1b — the still-open T17 authorization gap: a NON-recipient seat of the sub cell answers the
  // parent's question to the sub captain. The store's ownership lookup is team-scoped (T19 F2), so the
  // foreign question is skipped. Recorded as a BOUND here, NOT charged to T18.
  const bypass = await run(h, "cellwork_send", { to: PARENT + "/captain", subject: "x", body: "A. unify", kind: "answer", replyTo: String(down.id), selected: ["A. unify"] }, CURRENT)
  show("F1b (T17 bound) a non-recipient seat can still answer the cross-cell question", { ok: bypass.ok, error: bypass.error })
}

// ── F1c: the REAL reason for an absent / non-question target ───────────────────────────────────────
{
  const h = harness([cell(CELL, CAP, "team-mail", { "cell-planner": member("cell-planner", CURRENT), "cell-splitter": member("cell-splitter", SPLITTER) })])
  const absent = await run(h, "cellwork_send", { to: "captain", subject: "a", body: "x", kind: "answer", replyTo: "mail-nope", selected: ["A. one"] }, CURRENT)
  const plain = await run(h, "cellwork_send", { to: "cell-planner", subject: "plain", body: "p" }, CAP)
  const nonQuestion = plain.id === undefined ? "" : String(plain.id)
  const wrongTarget = await run(h, "cellwork_send", { to: "captain", subject: "a", body: "x", kind: "answer", replyTo: nonQuestion, selected: ["A. one"] }, CURRENT)
  show("F1c absent / non-question refusals name the real defect", { absent: absent.error, wrongTarget: wrongTarget.error })
}

// ── AC-5 text + legacy ack-once + member-to-member (regression) ────────────────────────────────────
{
  const h = harness([cell(CELL, CAP, "team-mail", { "cell-planner": member("cell-planner", CURRENT), "cell-splitter": member("cell-splitter", SPLITTER) })])
  const legacy = await run(h, "cellwork_send", { to: "cell-splitter", subject: "note", body: "b" }, CURRENT)
  show("R1 member-to-member + wake reason", { ok: legacy.ok, wakeSent: legacy.wakeSent, wakeReason: legacy.wakeReason })
  const refusal = checkpointRefusal("cellwork_send")
  show("R2 AC-5 text", { checkpointQuestion: refusal.includes("cannot be asked or answered at a checkpoint"), bothTools: refusal.includes("cellwork_send") && refusal.includes("cellwork_inbox") })
}
