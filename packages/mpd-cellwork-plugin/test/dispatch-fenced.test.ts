// Offline tests for the FENCED-OWNER rule (contract C7, defects D4/D5).
//
// A member at its context checkpoint, or with a handoff already waiting for the compaction barrier, or
// fenced by a barrier that gave up, cannot claim work: its own guard refuses the very verb the dispatch
// message asks for. The pass used to message it anyway — four deliveries of one ticket (journal 202/206/
// 209/212) — and the member answered with three handoffs in seven minutes while ten tickets stayed owned
// by nobody who could claim them. These arms pin the rule and the surfaces it must reach: the unit
// decision, the dispatch skip, `cellwork_supervise`'s fenced list, the second-handoff refusal and the
// barrier's own give-up path.
//
// The fake adapter is the seam shape the host exposes, narrowed to what these tools touch: a registry,
// the workspace root, the context meter, the team executor, the two event registrations and the
// compaction seams. Nothing here reads the repository's own state: every workspace is a fresh temp dir.
import { test, expect } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { cellMemberOf, dispatchOwnerOnly, fenceReasonOf, type DispatchRecordView } from "../src/dispatch.ts"
import { handoffPath, journalPath, newCellState, statePath, writeCell, type CellMemberRecord, type CellState } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { checkpointUnrecoverableEntry, memberAfterBarrier } from "../src/protocol-core.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261031T000000000Z"

/** The team id the cell record names (the fake team service answers for it). */
const TEAM_ID = "team-fenced"

/** The captain's session id, which is what makes `cellwork_supervise` captain-only for it. */
const CAPTAIN_SESSION = "session-captain"

/** One fake live agent: the session id the cell record knows it by and its workspace header. */
interface FakeAgent {
  /** The agent id, which the session-id readers fall back to. */
  id: string
  /** The session the workspace root would resolve from. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool definition (the fake registry hands the runner back here). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with the harness-validated arguments and the dispatch. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** The planner member's handle. */
  planner: FakeAgent
  /** Captured tool definitions by name. */
  tools: Map<string, CapturedTool>
  /** Every message the team executor delivered. */
  sends: Array<{ handle: string; text: string }>
  /** The event handlers the plugin registered, by event name. */
  events: Map<string, (payload: unknown) => void>
  /** Every in-process tool call the plugin made (`agent_teams_task`, …). */
  calls: Array<{ name: string; arguments: Record<string, unknown> }>
  /** The live team record the fake team service answers with. */
  record: Record<string, unknown>
}

/**
 * One member row as the CELL record stores it, defaulted to a healthy working seat.
 *
 * @param name - the member's board name.
 * @param overrides - the fields this arm changes (mode, handoffReady, fenced, …).
 * @returns the row.
 */
function memberRow(name: string, overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return { name, role: name, sessionId: "session-" + name, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T00:00:00.000Z", ...overrides }
}

/**
 * A cell record carrying the given member rows, complete enough for every tool these arms call.
 *
 * @param members - the member table.
 * @returns the record.
 */
function cellWith(members: Record<string, CellMemberRecord>): CellState {
  /** The fresh record, with this arm's members and the team the fake service answers for. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-10-31T00:00:00.000Z") })
  return { ...base, phase: "executing", teamId: TEAM_ID, members }
}

/**
 * A board whose ready rows are owned by the given members, every roster row healthy.
 *
 * @param owners - the member names, one pending row each.
 * @returns the team-record slice the dispatch pass reads.
 */
function board(...owners: string[]): DispatchRecordView {
  return {
    teamId: TEAM_ID,
    members: owners.map((name) => ({ name, status: "running", executorRef: "handle-" + name })),
    tasks: owners.map((name, index) => ({ id: "T" + String(index + 1), subject: name + " work", status: "pending", owner: name, blockedBy: [] })),
  }
}

/**
 * Run one dispatch pass over a fixed board, recording every delivery.
 *
 * @param cell - the cell record the pass reads its fence state from.
 * @param record - the live board.
 * @returns the report and the messages the executor was handed.
 */
async function pass(cell: CellState, record: DispatchRecordView): Promise<{ report: Awaited<ReturnType<typeof dispatchOwnerOnly>>; sent: Array<{ handle: string; content: string }> }> {
  /** The messages delivered, if any. */
  const sent: Array<{ handle: string; content: string }> = []
  /** The report the pass produced. */
  const report = await dispatchOwnerOnly({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-fence-")),
    cell,
    record,
    send: async (handle: string, content: string): Promise<void> => { sent.push({ handle, content }) },
    now: new Date("2026-10-31T00:00:00.000Z"),
  })
  return { report, sent }
}

/**
 * Build the fake harness and install the protocol tools once.
 *
 * @param members - the cell's member table.
 * @returns the harness with every captured registration.
 */
function makeHarness(members: Record<string, CellMemberRecord>): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-frozen-"))
  /** The cell record this arm works in, persisted so the tools read it back like a real cell. */
  const cell = cellWith(members)
  writeCell(workspace, cell)
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The planner's handle, whose session id the cell record knows. */
  const planner: FakeAgent = { id: "session-cell-planner", session: { id: "session-cell-planner", header: { cwd: workspace } } }
  /** Captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** Delivered messages. */
  const sends: Array<{ handle: string; text: string }> = []
  /** Registered event handlers. */
  const events = new Map<string, (payload: unknown) => void>()
  /** In-process tool calls. */
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  /** The live team record, mutated by this harness's own arms. */
  const harness: Harness = { workspace, captain, planner, tools, sends, events, calls, record: { teamId: TEAM_ID, members: [], tasks: [] } }
  /** The fake adapter: every seam these tools touch, and nothing else. */
  const adapter = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (name: string, handler: (payload: unknown) => void): (() => void) => { events.set(name, handler); return (): void => {} },
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({
      send: async (_captain: unknown, handle: string, text: string): Promise<void> => { sends.push({ handle, text }) },
    }),
    executeTool: async (input: { name: string; arguments?: unknown }): Promise<Record<string, unknown>> => {
      calls.push({ name: input.name, arguments: typeof input.arguments === "object" && input.arguments !== null ? input.arguments as Record<string, unknown> : {} })
      return { ok: true, isError: false, value: {} }
    },
    compactionEngineForAgent: (): undefined => undefined,
    interruptAgent: (): void => {},
    startContinuableAgent: async (): Promise<never> => { throw new Error("the harness refuses every reseed") },
    userMessage: (value: unknown): unknown => value,
    injectAgentMessage: (): void => {},
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (name: string): unknown => name === "mpdTeams" ? { get: (): unknown => harness.record } : undefined },
    config: { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 1, idleBarrierDelayMs: 0 },
    warn: (): void => {},
  })
  return harness
}

/**
 * Run one captured tool.
 *
 * @param harness - the harness that captured it.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the calling agent.
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
 * Every journal row of the harness's cell, in append order.
 *
 * @param harness - the harness whose cell is read.
 * @returns the parsed rows.
 */
function journalRows(harness: Harness): Array<Record<string, unknown>> {
  /** The raw journal text, or "" when nothing was journaled yet. */
  let text = ""
  try {
    text = readFileSync(journalPath(harness.workspace, CELL_ID), "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * The member row as PERSISTED on disk, read raw so an additive key is observable.
 *
 * `readCell` normalises the record it returns; the raw file is where a written field must be provable.
 *
 * @param harness - the harness whose cell is read.
 * @param name - the member's name.
 * @returns the stored row.
 */
function rawMember(harness: Harness, name: string): Record<string, unknown> {
  /** The parsed record file. */
  const parsed = JSON.parse(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")) as { members?: Record<string, Record<string, unknown>> }
  return parsed.members?.[name] ?? {}
}

// ── the fence predicate ────────────────────────────────────────────────────

test("C7: fenceReasonOf names each of the three signals and clears a working seat", () => {
  expect(fenceReasonOf(undefined)).toBeUndefined()
  expect(fenceReasonOf({ mode: "member", handoffReady: false })).toBeUndefined()
  expect(fenceReasonOf({ mode: "subcaptain", handoffReady: false })).toBeUndefined()
  expect(String(fenceReasonOf({ mode: "checkpoint" }))).toContain("checkpoint")
  expect(String(fenceReasonOf({ handoffReady: true }))).toContain("handoff is already written")
  expect(String(fenceReasonOf({ fenced: true, fencedReason: "no-engine" }))).toContain("barrier gave up")
  expect(String(fenceReasonOf({ fenced: true, fencedReason: "no-engine" }))).toContain("no-engine")
})

test("C7: cellMemberOf matches the cell row by name and by the dispatch name key", () => {
  /** A cell whose member row is stored under the normalised key spelling. */
  const cell = { members: { "senior-engineer": memberRow("Senior Engineer") } } as unknown as CellState
  expect(String(cellMemberOf(cell, "Senior Engineer")?.name)).toBe("Senior Engineer")
  expect(String(cellMemberOf(cell, "senior engineer")?.name)).toBe("Senior Engineer")
  expect(cellMemberOf(cell, "Reviewer")).toBeUndefined()
})

// ── the dispatch skip ─────────────────────────────────────────────────────

test("C7: a member at its CONTEXT CHECKPOINT is FENCED, reported with the repair, and never messaged", async () => {
  /** The cell whose only owner sits at its checkpoint. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }) })
  /** The pass over a board holding one ready row for that owner. */
  const { report, sent } = await pass(cell, board("Senior Engineer"))
  expect(sent.length).toBe(0)
  expect(report.pairs.length).toBe(0)
  /** The skip this board produces. */
  const skip = report.skipped.find((row) => row.taskId === "T1")
  expect(String(skip?.reason)).toContain("FENCED")
  expect(String(skip?.reason)).toContain('"Senior Engineer"')
  expect(String(skip?.reason)).toContain("reassign")
})

test("C7: a written handoff waiting for the barrier FENCES the member (the D4 re-delivery defect)", async () => {
  /** The cell whose owner already handed off. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { handoffReady: true }) })
  /** The pass. */
  const { report, sent } = await pass(cell, board("Senior Engineer"))
  expect(sent.length).toBe(0)
  expect(String(report.skipped.find((row) => row.taskId === "T1")?.reason)).toContain("handoff is already written")
})

test("C7: the barrier's explicit `fenced` marker fences a member whose mode still looks ordinary", async () => {
  /** The cell whose owner the barrier gave up on. */
  const cell = cellWith({ "Deep Worker": memberRow("Deep Worker", { fenced: true, fencedReason: "no-engine" }) })
  /** The pass. */
  const { report, sent } = await pass(cell, board("Deep Worker"))
  expect(sent.length).toBe(0)
  /** The skip reason, which must quote the barrier's own classification. */
  const reason = String(report.skipped.find((row) => row.taskId === "T1")?.reason)
  expect(reason).toContain("FENCED")
  expect(reason).toContain("no-engine")
})

test("C7: the fence comes from the CELL record even when the roster row looks healthy", async () => {
  /** The cell whose member row sits at its checkpoint. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }) })
  /** A board whose roster row is `running` with a live handle — the exact shape D4 messaged. */
  const record: DispatchRecordView = { teamId: TEAM_ID, members: [{ name: "Senior Engineer", status: "running", executorRef: "handle-se" }], tasks: [{ id: "T1", subject: "work", status: "pending", owner: "Senior Engineer", blockedBy: [] }] }
  /** The pass. */
  const { report, sent } = await pass(cell, record)
  expect(sent.length).toBe(0)
  expect(report.pairs.length).toBe(0)
  expect(String(report.skipped[0]?.reason)).toContain("FENCED")
})

test("C7 control: a promoted subcaptain and a healthy member are both paired", async () => {
  /** The cell with one promoted member and one ordinary member. */
  const cell = cellWith({
    "Deep Worker": memberRow("Deep Worker", { mode: "subcaptain" }),
    Reviewer: memberRow("Reviewer"),
  })
  /** The pass over one ready row per member. */
  const { report, sent } = await pass(cell, board("Deep Worker", "Reviewer"))
  expect(sent.length).toBe(2)
  expect(report.pairs.map((pair) => pair.memberName).sort()).toEqual(["Deep Worker", "Reviewer"])
})

test("C7: fencing one owner does not stop another owner's ready row", async () => {
  /** The cell with one fenced and one healthy owner. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }), Reviewer: memberRow("Reviewer") })
  /** The pass. */
  const { report, sent } = await pass(cell, board("Senior Engineer", "Reviewer"))
  expect(sent.length).toBe(1)
  expect(report.pairs.map((pair) => pair.memberName)).toEqual(["Reviewer"])
  expect(String(report.skipped.find((row) => row.taskId === "T1")?.reason)).toContain("FENCED")
})

// ── what a given-up barrier leaves behind ─────────────────────────────────

test("C7: a given-up barrier fences the member row it persists, and a later success clears the marker", () => {
  /** The member row before the barrier. */
  const previous = memberRow("Deep Worker", { handoffs: 2 })
  /** The row a refused barrier leaves. */
  const refused = memberAfterBarrier(previous, { outcome: "refused", attempts: 3, reason: "no-engine; the reseed failed: boom" })
  expect(refused.mode).toBe("checkpoint")
  expect(refused.handoffReady).toBe(true)
  expect(refused.fenced).toBe(true)
  expect(String(refused.fencedReason)).toContain("no-engine")
  expect(refused.name).toBe("Deep Worker")
  expect(refused.handoffs).toBe(2)
  expect(refused.joinedAt).toBe(previous.joinedAt)
  // A fence recorded earlier must NOT survive a later successful outcome, or a healthy member stays out.
  /** The row a reseed leaves, from a row that WAS fenced. */
  const reseeded = memberAfterBarrier({ ...refused }, { outcome: "reseeded", attempts: 3, reason: "busy", newHandle: "handle-fresh" })
  expect(reseeded.mode).toBe("subcaptain")
  expect(reseeded.handoffReady).toBe(false)
  expect("fenced" in reseeded).toBe(false)
  expect("fencedReason" in reseeded).toBe(false)
  expect(reseeded.sessionId).toBe("handle-fresh")
  expect(reseeded.executorRef).toBe("handle-fresh")
})

test("C7: the given-up journal row names the member, the attempts and the repair verb", () => {
  /** The row a refused barrier writes. */
  const entry = checkpointUnrecoverableEntry("Deep Worker", { outcome: "refused", attempts: 3, reason: "no-engine" })
  expect(entry.event).toBe("checkpoint-unrecoverable")
  expect(entry.member).toBe("Deep Worker")
  expect(entry.attempts).toBe(3)
  expect(entry.reason).toBe("no-engine")
  expect(String(entry.repair)).toContain("cellwork_dispatch")
})

test("C7: a refused barrier PERSISTS the fence and journals `checkpoint-unrecoverable`", async () => {
  /** The harness whose planner already wrote its handoff. */
  const harness = makeHarness({ "cell-planner": memberRow("cell-planner", { handoffReady: true, handoffs: 1, sessionId: "session-cell-planner" }) })
  /** The handoff document the barrier will read back. */
  mkdirSync(join(harness.workspace, ".mpd", "cellwork", CELL_ID), { recursive: true })
  /** The turn-stopping listener the plugin registered. */
  const stop = harness.events.get("agent/turn-stopping")
  expect(typeof stop).toBe("function")
  stop?.({ agent: harness.planner })
  // The listener is fire-and-forget; poll the journal for the row the barrier must write.
  /** The unrecoverable row, once the barrier wrote it. */
  let unrecoverable: Record<string, unknown> | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    unrecoverable = journalRows(harness).find((row) => row.event === "checkpoint-unrecoverable")
    if (unrecoverable !== undefined) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(unrecoverable?.member).toBe("cell-planner")
  expect(String(unrecoverable?.reason)).toContain("no-engine")
  // THE PERSISTED FORM: both additive keys are on disk, read raw because `readCell` normalises.
  /** The member row exactly as the record file holds it. */
  const stored = rawMember(harness, "cell-planner")
  expect(stored.fenced).toBe(true)
  expect(String(stored.fencedReason)).toContain("no-engine")
  expect(stored.mode).toBe("checkpoint")
  expect(stored.handoffReady).toBe(true)
  // The handoff document the barrier tried to read back never existed, and that is not a failure.
  expect(handoffPath(harness.workspace, CELL_ID, "cell-planner", 1)).toContain("cell-planner-1.md")
})

test("C7: cellwork_supervise lists every fenced member with the open rows it owns", async () => {
  /** The harness with one fenced member owning two rows (one open, one done) and one healthy member. */
  const harness = makeHarness({
    "Senior Engineer": memberRow("Senior Engineer", { fenced: true, fencedReason: "the compaction barrier gave up" }),
    Reviewer: memberRow("Reviewer"),
  })
  harness.record = {
    teamId: TEAM_ID,
    members: [{ name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer" }, { name: "Reviewer", status: "running", executorRef: "handle-Reviewer" }],
    tasks: [
      { id: "T7", subject: "open work", status: "pending", owner: "Senior Engineer", blockedBy: [] },
      { id: "T8", subject: "done work", status: "completed", owner: "Senior Engineer" },
      { id: "T9", subject: "healthy work", status: "in_progress", owner: "Reviewer" },
    ],
  }
  /** The captain's read-only sweep. */
  const sweep = await runTool(harness, "cellwork_supervise", {}, harness.captain)
  expect(sweep.ok).toBe(true)
  /** The fenced rows the sweep reports. */
  const fenced = sweep.fenced as Array<Record<string, unknown>>
  expect(fenced.length).toBe(1)
  expect(fenced[0].name).toBe("Senior Engineer")
  expect(String(fenced[0].reason)).toContain("barrier gave up")
  expect(fenced[0].tasks).toEqual(["T7"])
})

// ── the livelock's other half: a SECOND handoff ───────────────────────────

test("C7: a SECOND cellwork_handoff is refused while the first waits for the barrier", async () => {
  /** The harness whose member already wrote handoff 2 that the barrier has not consumed. */
  const harness = makeHarness({ "cell-planner": memberRow("cell-planner", { handoffReady: true, handoffs: 2, sessionId: "session-cell-planner" }) })
  /** The second document. */
  const second = await runTool(harness, "cellwork_handoff", { content: "## Task\nagain\n## Next step\nnothing" }, harness.planner)
  expect(second.ok).toBe(false)
  expect(String(second.error)).toContain("STILL WAITING")
  expect(String(second.error)).toContain("END YOUR TURN")
  // Nothing was written: no third document exists for the barrier to mis-read as the latest.
  /** The journal rows of the cell, which must hold no `handoff` event. */
  const rows = journalRows(harness)
  expect(rows.filter((row) => row.event === "handoff").length).toBe(0)
})
