// T18 — the three defects R4 (T9) found in the cellwork cell view, and the arms that redden on the old
// behaviour.
//
//   1. F1 (High) — a CROSS-CELL structured answer could not round-trip: the answered question was
//      resolved from the TARGET cell's view, but a cross-cell question is stamped with the RECIPIENT
//      cell's `cellId`, so the question lived in the OTHER cell's view and the refusal LIED ("an answer
//      must carry the question's non-empty questionId").
//   2. F2 (Medium) — a seat was addressed by its SESSION id at send time, so a reseeded seat could never
//      acknowledge its own earlier mail nor answer its own earlier question; the store refused silently
//      and the inbox re-delivered the row forever with `acknowledged: 0`.
//   3. N1 (Nit) — the same refusal was invisible: `acknowledgeCellMail` dropped the store's `refused`
//      list, and the tool answered `acknowledged: 0` with no reason.
//
// The first two arms NEED the store-side repair (T17: references resolve against the WHOLE workspace
// mailbox) as well as this lane's; they are written against the required behaviour, not the old one.
import { expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEFAULT_CELLWORK_CONFIG } from "../src/config"
import { cellMailboxPath } from "../src/mail"
import { installCellworkProtocol } from "../src/protocol"
import { newCellState, readCell, writeCell, type CellMemberRecord } from "../src/state"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The parent cell every cross-cell arm starts from. */
const PARENT_ID = "cell-parent-20261031"

/** The sub cell registered under the parent, where a cross-cell recipient lives. */
const SUB_ID = "cell-sub-20261031"

/** The parent cell's captain session. */
const PARENT_CAPTAIN = "session-parent-captain"

/** The sub cell's captain session. */
const SUB_CAPTAIN = "session-sub-captain"

/** The sub cell's planner session, the seat a reseed arm re-points. */
const PLANNER_SESSION = "session-sub-planner"

/** The session a reseed puts on the planner's seat, after the pre-reseed rows were written. */
const RESEEDED_PLANNER = "session-sub-planner-reseeded"

/** One fake live agent handle: the session id is what the caller resolver reads. */
interface FakeAgent {
  /** The agent id (readers fall back to it). */
  id: string
  /** The fused session, carrying the workspace root a caller resolves. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool definition, including the renderer this file drives directly. */
interface ToolDef {
  /** The registered name. */
  name: string
  /** The tool body. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  /** The tool's output block, which carries the text renderer. */
  output?: { render?: (args: unknown, value: unknown) => unknown }
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The parent cell's captain handle. */
  parentCaptain: FakeAgent
  /** The sub cell's captain handle. */
  subCaptain: FakeAgent
  /** The sub cell's planner handle (pre-reseed). */
  planner: FakeAgent
  /** Captured tool definitions by name. */
  tools: Map<string, ToolDef>
  /** Every wake-up the fake executor accepted. */
  sends: Array<{ handle: string; text: string }>
}

/**
 * One member row as the CELL record stores it.
 * @param name - the member's board name.
 * @param sessionId - the session the member answers as.
 * @returns the row, already raised with a live handle.
 */
function memberRow(name: string, sessionId: string): CellMemberRecord {
  return { name, role: name, sessionId, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T18:00:00.000Z" }
}

/**
 * Build the fake harness: a parent cell with a sub cell under it, both live, and the protocol installed.
 * @returns the harness.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-repairs-"))
  /** The parent cell record: a captain, no members, one sub cell. */
  const parent = {
    ...newCellState({ cellId: PARENT_ID, objective: "ship the widget", captainSessionId: PARENT_CAPTAIN, now: new Date("2026-10-31T18:00:00.000Z") }),
    phase: "executing" as const,
    teamId: "team-parent",
    subcellIds: [SUB_ID],
  }
  /** The sub cell record: its own captain and one member, nested under the parent. */
  const sub = {
    ...newCellState({ cellId: SUB_ID, objective: "split the widget", captainSessionId: SUB_CAPTAIN, now: new Date("2026-10-31T18:00:00.000Z"), parentCellId: PARENT_ID, depth: 1 }),
    phase: "executing" as const,
    teamId: "team-sub",
    members: { "cell-planner": memberRow("cell-planner", PLANNER_SESSION) },
  }
  writeCell(workspace, parent)
  writeCell(workspace, sub)
  /** Captured tool definitions. */
  const tools = new Map<string, ToolDef>()
  /** The harness under construction, so the fake executor can record into it. */
  const harness: Harness = {
    workspace,
    parentCaptain: { id: PARENT_CAPTAIN, session: { id: PARENT_CAPTAIN, header: { cwd: workspace } } },
    subCaptain: { id: SUB_CAPTAIN, session: { id: SUB_CAPTAIN, header: { cwd: workspace } } },
    planner: { id: PLANNER_SESSION, session: { id: PLANNER_SESSION, header: { cwd: workspace } } },
    tools,
    sends: [],
  }
  /** The fake adapter: the registry, the root and the executor. */
  const adapter = {
    registerTool: (definition: ToolDef): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({
      send: async (_captain: unknown, handle: string, text: string): Promise<void> => { harness.sends.push({ handle, text }) },
    }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (): undefined => undefined },
    config: DEFAULT_CELLWORK_CONFIG,
    warn: (): void => {},
  })
  return harness
}

/**
 * Run one captured tool as one agent.
 * @param harness - the harness that captured it.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the agent handle the caller resolves from.
 * @returns the tool's structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown>, agent: FakeAgent): Promise<Record<string, any>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  /** The tool's answer, narrowed to a record. */
  const answer = await tool.execute(args, { name, agent })
  return typeof answer === "object" && answer !== null ? answer as Record<string, any> : {}
}

/**
 * Render one tool answer through the tool's own renderer.
 * @param harness - the harness that captured it.
 * @param name - the tool name.
 * @param value - the structured answer.
 * @returns the rendered text.
 */
function renderAnswer(harness: Harness, name: string, value: unknown): string {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  /** The registered renderer, which lives on the output block. */
  const render = tool?.output?.render
  if (render === undefined) return ""
  /** The renderer's blocks, read structurally. */
  const blocks = render(undefined, value)
  /** The text blocks joined. */
  return Array.isArray(blocks) ? blocks.map((block: unknown) => String((block as { text?: unknown }).text ?? "")).join("\n") : String(blocks)
}

test("F1: a cross-cell question is ANSWERED from the other cell in BOTH directions, without an explicit questionId", async () => {
  /** The harness with the two-nested-cell tree installed. */
  const h = makeHarness()
  // DOWN: the parent captain asks the sub cell's captain. The row is stamped with the RECIPIENT's cell,
  // so it lives in the sub cell's view — the very fact that made the old answer path miss it.
  /** The parent's question to the sub captain. */
  const down = await runTool(h, "cellwork_send", {
    to: SUB_ID + "/captain",
    subject: "storage",
    body: "which approach?",
    kind: "question",
    options: [{ label: "A. unify" }, { label: "B. keep both" }],
  }, h.parentCaptain)
  expect(down.ok).toBe(true)
  // The sub captain reads it, which acknowledges it through the stable seat key.
  /** The sub captain's first inbox. */
  const subInbox = await runTool(h, "cellwork_inbox", {}, h.subCaptain)
  expect((subInbox.messages as unknown[]).length).toBe(1)
  expect(subInbox.messages[0].question.options.map((option: { label: string }) => option.label)).toEqual(["A. unify", "B. keep both"])
  // THE ANSWER OMITS `questionId` ON PURPOSE: the correlation key must resolve across the workspace
  // mailbox, because the question is not in the target cell's view.
  /** The sub captain's answer back to the parent. */
  const answeredDown = await runTool(h, "cellwork_send", {
    to: PARENT_ID + "/captain",
    subject: "A. unify",
    body: "A. unify",
    kind: "answer",
    replyTo: String(down.id),
    selected: ["A. unify"],
  }, h.subCaptain)
  expect(answeredDown.ok).toBe(true)
  /** The parent captain's inbox, which must hold the answer and nothing else. */
  const parentInbox = await runTool(h, "cellwork_inbox", {}, h.parentCaptain)
  expect((parentInbox.messages as unknown[]).length).toBe(1)
  expect(parentInbox.messages[0].answer.selected).toEqual(["A. unify"])
  // UP: the reverse direction, so neither side depends on being the parent.
  /** The sub captain's question to the parent captain. */
  const up = await runTool(h, "cellwork_send", {
    to: PARENT_ID + "/captain",
    subject: "budget",
    body: "how much?",
    kind: "question",
    options: [{ label: "A. more" }, { label: "B. less" }],
  }, h.subCaptain)
  expect(up.ok).toBe(true)
  /** The parent captain's answer back to the sub. */
  const answeredUp = await runTool(h, "cellwork_send", {
    to: SUB_ID + "/captain",
    subject: "B. less",
    body: "B. less",
    kind: "answer",
    replyTo: String(up.id),
    selected: ["B. less"],
  }, h.parentCaptain)
  expect(answeredUp.ok).toBe(true)
  // The sub captain's SECOND inbox holds only the answer: the first question was acknowledged once, so
  // the stable-key ack and the cross-cell answer are proven together.
  /** The sub captain's second inbox. */
  const subInboxAgain = await runTool(h, "cellwork_inbox", {}, h.subCaptain)
  expect((subInboxAgain.messages as unknown[]).length).toBe(1)
  expect(subInboxAgain.messages[0].answer.selected).toEqual(["B. less"])
})

test("F1: an absent question and a non-question target are refused with the REAL reason, never the missing-key wording", async () => {
  /** The harness with the two-nested-cell tree installed. */
  const h = makeHarness()
  /** The answer to a message id the mailbox does not hold at all. */
  const absent = await runTool(h, "cellwork_send", {
    to: "cell-planner",
    subject: "answer",
    body: "A. one",
    kind: "answer",
    replyTo: "mail-does-not-exist",
    selected: ["A. one"],
  }, h.subCaptain)
  expect(absent.ok).toBe(false)
  expect(String(absent.error)).toContain("names no message in this workspace's mailbox")
  expect(String(absent.error)).not.toContain("must carry")
  // A plain message exists but is NOT a question: a different defect, named as such.
  /** The plain message that must not be answerable. */
  const plain = await runTool(h, "cellwork_send", { to: "cell-planner", subject: "plain", body: "not a question" }, h.subCaptain)
  expect(plain.ok).toBe(true)
  /** The answer aimed at the plain row. */
  const notQuestion = await runTool(h, "cellwork_send", {
    to: "cell-planner",
    subject: "answer",
    body: "A. one",
    kind: "answer",
    replyTo: String(plain.id),
    selected: ["A. one"],
  }, h.subCaptain)
  expect(notQuestion.ok).toBe(false)
  expect(String(notQuestion.error)).toContain("no question payload")
  expect(String(notQuestion.error)).not.toContain("must carry")
})

test("F2: a reseeded seat acknowledges the row sent to its pre-reseed seat exactly once, and answers it", async () => {
  /** The harness with the two-nested-cell tree installed. */
  const h = makeHarness()
  /** The sub captain's question to the planner, written under the PRE-reseed session. */
  const asked = await runTool(h, "cellwork_send", {
    to: "cell-planner",
    subject: "which?",
    body: "which?",
    kind: "question",
    options: [{ label: "A. one" }, { label: "B. two" }],
  }, h.subCaptain)
  expect(asked.ok).toBe(true)
  // THE RESEED: the same SEAT learns a new session id (a bounded compaction reseed). The row on disk was
  // addressed to the seat, not to the old session — the whole point of the stable key.
  /** The sub cell's record before the reseed. */
  const before = readCell(h.workspace, SUB_ID)
  if (!before.ok) throw new Error("the sub cell record is unreadable: " + before.reason)
  /** The pre-reseed planner row, which the reseed re-points. */
  const plannerRow = before.state.members["cell-planner"]
  if (plannerRow === undefined) throw new Error("the sub cell has no planner row to reseed")
  writeCell(h.workspace, { ...before.state, members: { ...before.state.members, "cell-planner": { ...plannerRow, sessionId: RESEEDED_PLANNER } } })
  /** The post-reseed planner handle. */
  const postReseed: FakeAgent = { id: RESEEDED_PLANNER, session: { id: RESEEDED_PLANNER, header: { cwd: h.workspace } } }
  // The post-reseed seat ACKNOWLEDGES the row sent to the pre-reseed seat: once, not silently refused.
  /** The post-reseed inbox. */
  const inbox = await runTool(h, "cellwork_inbox", {}, postReseed)
  expect((inbox.messages as unknown[]).length).toBe(1)
  expect(inbox.acknowledged).toBe(1)
  expect(inbox.refused).toEqual([])
  /** The SAME inbox read again, which must be empty because the ack landed once. */
  const again = await runTool(h, "cellwork_inbox", {}, postReseed)
  expect((again.messages as unknown[]).length).toBe(0)
  // …and the post-reseed seat can ANSWER the question addressed to its seat before the reseed.
  /** The post-reseed planner's answer to the pre-reseed question. */
  const answer = await runTool(h, "cellwork_send", {
    to: "captain",
    subject: "A. one",
    body: "A. one",
    kind: "answer",
    replyTo: String(asked.id),
    selected: ["A. one"],
  }, postReseed)
  expect(answer.ok).toBe(true)
  /** The sub captain's inbox, which must hold the assembled answer. */
  const captainInbox = await runTool(h, "cellwork_inbox", {}, h.subCaptain)
  expect((captainInbox.messages as unknown[]).length).toBe(1)
  expect(captainInbox.messages[0].answer.selected).toEqual(["A. one"])
})

test("N1: a REFUSED acknowledgement reports the store's reason instead of a silent acknowledged: 0", async () => {
  /** The harness with the two-nested-cell tree installed. */
  const h = makeHarness()
  // A PRE-FIX row: the cell plane used to address a seat by its session id, so this row names the
  // planner's OLD session while its `toName` still says which seat it was meant for. The inbox lists it;
  // the ownership rule refuses it — and that refusal is the diagnosis the old code threw away.
  mkdirSync(join(h.workspace, ".mpd", "team"), { recursive: true })
  appendFileSync(cellMailboxPath(h.workspace), JSON.stringify({
    t: "send",
    id: "mail-prefix-row",
    fromId: "session-someone",
    fromName: "captain",
    toId: "session-planner-before-the-fix",
    toName: "cell-planner",
    subject: "old row",
    body: "old row",
    at: "2026-10-31T18:00:01.000Z",
    sentAt: "2026-10-31T18:00:01.000Z",
    cellId: SUB_ID,
    teamId: "team-sub",
  }) + "\n")
  /** The planner's inbox over the pre-fix row. */
  const inbox = await runTool(h, "cellwork_inbox", {}, h.planner)
  expect((inbox.messages as unknown[]).length).toBe(1)
  expect(inbox.acknowledged).toBe(0)
  /** The refusals the tool now carries, each naming the row and the store's sentence. */
  const refused = inbox.refused as Array<{ id: string; reason: string }>
  expect(refused.length).toBe(1)
  expect(refused[0].id).toBe("mail-prefix-row")
  expect(refused[0].reason).toContain("only its recipient may acknowledge it")
  // The render is what the model reads, so the refusal must be visible THERE too.
  /** The rendered inbox text. */
  const rendered = renderAnswer(h, "cellwork_inbox", inbox)
  expect(rendered).toContain("acknowledgement refused")
  expect(rendered).toContain("mail-prefix-row")
})
