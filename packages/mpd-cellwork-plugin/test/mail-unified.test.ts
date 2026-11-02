// STRUCTURED CELL MAIL over the UNIFIED mailbox (contract §6 / AC-3).
//
// These arms prove the cell view the wave asked for: a cell seat asks a `question` with offered
// labels, the recipient answers by echoing a label VERBATIM (an unknown label is refused WITH the
// valid list), `broadcast:true` fans out one row per seat, the inbox renders both blocks explicitly,
// and ack-once still holds through the shared store. The legacy D6 ordering arms stay in
// `mail-order.test.ts`; this file covers the new envelope surface.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { cellMailPath, foldCellMail, readCellMail } from "../src/mail.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { newCellState, writeCell, type CellMemberRecord } from "../src/state.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261031T180000000Z"

/** The captain's session id, which is the Lead authority the wake path checks. */
const CAPTAIN_SESSION = "session-captain"

/** The planner's session id, seeded on the cell record so the seat resolves. */
const PLANNER_SESSION = "session-cell-planner"

/** The splitter's session id, the second member a broadcast reaches. */
const SPLITTER_SESSION = "session-cell-splitter"

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
  /** The captain's handle. */
  captain: FakeAgent
  /** The planner's handle. */
  planner: FakeAgent
  /** The splitter's handle. */
  splitter: FakeAgent
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
  return { name, role: name, sessionId, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T00:00:00.000Z" }
}

/**
 * Build the fake harness and install the protocol tools once.
 * @returns the harness.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-mail-unified-"))
  /** The cell record: a captain and two members with live handles. */
  const cell = {
    ...newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-10-31T18:00:00.000Z") }),
    phase: "executing" as const,
    teamId: "team-mail",
    members: { "cell-planner": memberRow("cell-planner", PLANNER_SESSION), "cell-splitter": memberRow("cell-splitter", SPLITTER_SESSION) },
  }
  writeCell(workspace, cell)
  /** Captured tool definitions. */
  const tools = new Map<string, ToolDef>()
  /** The harness under construction, so the fake executor can record into it. */
  const harness: Harness = {
    workspace,
    captain: { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } },
    planner: { id: PLANNER_SESSION, session: { id: PLANNER_SESSION, header: { cwd: workspace } } },
    splitter: { id: SPLITTER_SESSION, session: { id: SPLITTER_SESSION, header: { cwd: workspace } } },
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
async function runTool(harness: Harness, name: string, args: Record<string, unknown>, agent: FakeAgent): Promise<Record<string, unknown>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  /** The tool's answer, narrowed to a record. */
  const answer = await tool.execute(args, { name, agent })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
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

test("§6: a question round-trips through the unified mailbox and the answer echoes its label", async () => {
  /** The harness with the cell installed. */
  const harness = makeHarness()
  /** The captain's structured question. */
  const asked = await runTool(harness, "cellwork_send", {
    to: "cell-planner",
    subject: "Storage choice",
    body: "Which approach should the cell take?",
    kind: "question",
    options: [{ label: "A. Unify the stores" }, { label: "B. Keep both stores" }],
  }, harness.captain)
  expect(asked.ok).toBe(true)
  /** The question's message id, which is also its default correlation key. */
  const questionId = String(asked.id)
  // The planner's inbox renders the QUESTION block with both labels, no counting required.
  /** The planner's first inbox answer. */
  const inbox = await runTool(harness, "cellwork_inbox", {}, harness.planner)
  expect((inbox.messages as unknown[]).length).toBe(1)
  /** The row as the inbox returned it. */
  const questionRow = (inbox.messages as Array<Record<string, unknown>>)[0]
  expect(questionRow.kind).toBe("question")
  expect((questionRow.question as Record<string, unknown>).questionId).toBe(questionId)
  /** The inbox text the model actually receives. */
  const questionText = renderAnswer(harness, "cellwork_inbox", inbox)
  expect(questionText).toContain("QUESTION " + questionId)
  expect(questionText).toContain("  - A. Unify the stores")
  expect(questionText).toContain("  - B. Keep both stores")
  // The answer echoes one offered label VERBATIM and inherits the question's thread.
  /** The planner's answer to the captain. */
  const answered = await runTool(harness, "cellwork_send", {
    to: "captain",
    subject: "Storage choice: answered",
    body: "A. Unify the stores",
    kind: "answer",
    replyTo: questionId,
    selected: ["A. Unify the stores"],
  }, harness.planner)
  expect(answered.ok).toBe(true)
  // The captain's inbox shows the ANSWER block, then acknowledges it exactly once.
  /** The captain's inbox answer. */
  const captainInbox = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  expect((captainInbox.messages as unknown[]).length).toBe(1)
  /** The answer row as the captain read it. */
  const answerRow = (captainInbox.messages as Array<Record<string, unknown>>)[0]
  expect(answerRow.kind).toBe("answer")
  expect((answerRow.answer as Record<string, unknown>).answerTo).toBe(questionId)
  expect((answerRow.answer as Record<string, unknown>).selected).toEqual(["A. Unify the stores"])
  expect(answerRow.threadId).toBe(questionId)
  /** The inbox text the captain actually receives. */
  const answerText = renderAnswer(harness, "cellwork_inbox", captainInbox)
  expect(answerText).toContain("ANSWER to " + questionId)
  expect(answerText).toContain("selected: A. Unify the stores")
  /** The second read: the row moved to read through the shared store. */
  const again = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  expect((again.messages as unknown[]).length).toBe(0)
})

test("§6: an unknown label is refused WITH the valid label list, and single-select refuses label+custom", async () => {
  /** The harness with the cell installed. */
  const harness = makeHarness()
  /** The question whose labels the refusal must spell out. */
  const asked = await runTool(harness, "cellwork_send", {
    to: "cell-planner",
    subject: "Pick one",
    body: "Which?",
    kind: "question",
    options: [{ label: "A. Unify the stores" }, { label: "B. Keep both stores" }],
  }, harness.captain)
  /** The question's message id. */
  const questionId = String(asked.id)
  /** An answer that invented a label instead of echoing one. */
  const invented = await runTool(harness, "cellwork_send", {
    to: "captain",
    subject: "answer",
    body: "C. Neither",
    kind: "answer",
    replyTo: questionId,
    selected: ["C. Neither"],
  }, harness.planner)
  expect(invented.ok).toBe(false)
  expect(String(invented.error)).toContain("valid labels:")
  expect(String(invented.error)).toContain("A. Unify the stores")
  expect(String(invented.error)).toContain("B. Keep both stores")
  /** A single-select answer that tried to pair one label with free text. */
  const mixed = await runTool(harness, "cellwork_send", {
    to: "captain",
    subject: "answer",
    body: "A. Unify the stores (but partly)",
    kind: "answer",
    replyTo: questionId,
    selected: ["A. Unify the stores"],
    custom: "but only partly",
  }, harness.planner)
  expect(mixed.ok).toBe(false)
  expect(String(mixed.error)).toContain("must not combine")
  // Nothing was written for either refusal.
  /** The planner's inbox, which must still hold only the question. */
  const folded = foldCellMail(readCellMail(harness.workspace, CELL_ID))
  expect(folded.filter((message) => message.kind === "answer")).toEqual([])
})

test("§6: broadcast mints ONE ROW PER SEAT with the same questionId and thread", async () => {
  /** The harness with the cell installed. */
  const harness = makeHarness()
  /** The captain's broadcast question to both members. */
  const sent = await runTool(harness, "cellwork_send", {
    to: "*",
    broadcast: true,
    subject: "Broadcast",
    body: "Both of you answer.",
    kind: "question",
    options: [{ label: "A. Unify the stores" }, { label: "B. Keep both stores" }],
  }, harness.captain)
  expect(sent.ok).toBe(true)
  expect(sent.broadcast).toBe(true)
  expect((sent.ids as string[]).length).toBe(2)
  expect((sent.rows as unknown[]).length).toBe(2)
  // Two durable rows, one per member, sharing the envelope's questionId and thread (I6/I7).
  /** The cell view's folded rows after the fan-out. */
  const folded = foldCellMail(readCellMail(harness.workspace, CELL_ID))
  /** The question rows the fan-out minted. */
  const questions = folded.filter((message) => message.kind === "question")
  expect(questions.length).toBe(2)
  expect(questions.map((message) => message.to).sort()).toEqual(["cell-planner", "cell-splitter"])
  expect(new Set(questions.map((message) => message.question?.questionId)).size).toBe(1)
  expect(new Set(questions.map((message) => message.threadId)).size).toBe(1)
  // Each member's inbox holds its OWN row, and the captain's wake reached both handles.
  expect(((await runTool(harness, "cellwork_inbox", {}, harness.planner)).messages as unknown[]).length).toBe(1)
  expect(((await runTool(harness, "cellwork_inbox", {}, harness.splitter)).messages as unknown[]).length).toBe(1)
  expect(harness.sends.map((entry) => entry.handle).sort()).toEqual(["handle-cell-planner", "handle-cell-splitter"])
})

test("§6: kind is inferred from the payload, and a message stays a message", async () => {
  /** The harness with the cell installed. */
  const harness = makeHarness()
  // No `kind`, but options are present: this is a question.
  /** The inferred question. */
  const inferredQuestion = await runTool(harness, "cellwork_send", {
    to: "captain",
    subject: "inferred question",
    body: "Which?",
    options: [{ label: "A. One" }],
  }, harness.planner)
  expect(inferredQuestion.ok).toBe(true)
  // No kind and no structured payload: a plain message, which carries no envelope.
  /** The plain message. */
  const plain = await runTool(harness, "cellwork_send", { to: "captain", subject: "hello", body: "one line" }, harness.planner)
  expect(plain.ok).toBe(true)
  /** The captain's inbox rows. */
  const inbox = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  /** The rows as the inbox returned them. */
  const rows = inbox.messages as Array<Record<string, unknown>>
  expect(rows.map((row) => row.kind).sort()).toEqual(["message", "question"])
  expect(rows.find((row) => row.kind === "question")?.question).toBeDefined()
  expect(rows.find((row) => row.kind === "message")?.question).toBeUndefined()
})

test("§12: a legacy cell log stays readable and its row acknowledges exactly once", async () => {
  /** The harness with the cell installed. */
  const harness = makeHarness()
  /** The pre-unification log path, written by hand in the old shape. */
  const legacyPath = cellMailPath(harness.workspace, CELL_ID)
  mkdirSync(dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, JSON.stringify({
    t: "send",
    id: "legacy-1",
    cellId: CELL_ID,
    from: "cell-planner",
    to: "captain",
    subject: "before the unification",
    body: "old body",
    at: "2026-10-31T17:00:00.000Z",
    wakeSent: false,
  }) + "\n", "utf8")
  /** The captain's first read, which must see the legacy row. */
  const first = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  expect((first.messages as unknown[]).length).toBe(1)
  // The acknowledgement is appended to the LEGACY log (the store does not own that row), and the next
  // read no longer returns it.
  /** The captain's second read. */
  const again = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  expect((again.messages as unknown[]).length).toBe(0)
})

test("§6: a question to the captain opens the thread an answer inherits", async () => {
  /** The harness with the cell installed. */
  const harness = makeHarness()
  /** The planner's question to the captain, with an explicit key. */
  const asked = await runTool(harness, "cellwork_send", {
    to: "captain",
    subject: "Keyed question",
    body: "Which?",
    kind: "question",
    questionId: "Q-explicit",
    options: [{ label: "A. One" }, { label: "B. Two" }],
  }, harness.planner)
  expect(asked.ok).toBe(true)
  // The captain answers without a questionId: it is defaulted from the referenced question's payload.
  /** The captain's answer. */
  const answered = await runTool(harness, "cellwork_send", {
    to: "cell-planner",
    subject: "Keyed answer",
    body: "A. One",
    kind: "answer",
    replyTo: String(asked.id),
    selected: ["A. One"],
  }, harness.captain)
  expect(answered.ok).toBe(true)
  /** The planner's view of the answer. */
  const folded = foldCellMail(readCellMail(harness.workspace, CELL_ID))
  /** The answer row. */
  const answer = folded.find((message) => message.kind === "answer")
  expect(answer?.answer?.questionId).toBe("Q-explicit")
  expect(answer?.answer?.answerTo).toBe(String(asked.id))
  expect(answer?.threadId).toBe(String(asked.id))
})
