// Offline tests for `cellwork_dispatch {reassign}` (contract C6, defects D4/D5).
//
// A fenced owner's rows are not lost work: the captain hands each row to another member by CLAIMING it
// on the board first, journaling the hand-over, and only then delivering the normal dispatch message.
// The order is the whole point — a message for a row the member cannot see on the board is what D4
// measured, and the row must be claimed before anything is woken for it.
//
// The tool-level arm drives the registrations through the fake adapter the host shape provides, so the
// board call is asserted at the seam the plugin actually uses (`agent_teams_task {action:"claim"}`), and
// the journal is read DURING delivery to prove the row landed before the message.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyReassignments, reassignPairs, type DispatchRecordView, type ReassignPair } from "../src/dispatch.ts"
import { journalPath, newCellState, writeCell, type CellMemberRecord, type CellState } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261031T180000000Z"

/** The team id the cell record names (the fake team service answers for it). */
const TEAM_ID = "team-reassign"

/** The captain's session id. */
const CAPTAIN_SESSION = "session-captain"

/** One captured tool definition (the fake registry hands the runner back here). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with the harness-validated arguments and the dispatch. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One fake live agent. */
interface FakeAgent {
  /** The agent id (the session-id readers fall back to it). */
  id: string
  /** The session the workspace root would resolve from. */
  session: { id: string; header: { cwd: string } }
}

/** The fake board the tool-level arm reads and mutates, exactly as the team service would. */
interface FakeBoard {
  /** The board rows. */
  tasks: Array<Record<string, unknown>>
  /** The roster rows. */
  members: Array<Record<string, unknown>>
}

/** The fake harness the tool-level arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** Captured tool definitions by name. */
  tools: Map<string, CapturedTool>
  /** The live board the fake team service answers with. */
  board: FakeBoard
  /** Every in-process tool call the plugin made, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown> }>
  /** Every message the executor delivered, in order. */
  sends: Array<{ handle: string; text: string }>
  /** What the journal held at EACH delivery, so "claim, journal, then message" is observable. */
  atSend: Array<{ reassigned: number; text: string }>
}

/**
 * One member row as the CELL record stores it, already raised with a live handle.
 *
 * @param name - the member's board name.
 * @param overrides - the fields this arm changes (mode, fenced, …).
 * @returns the row.
 */
function memberRow(name: string, overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return { name, role: name, sessionId: "session-" + name, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T00:00:00.000Z", ...overrides }
}

/**
 * A board with one pending, unblocked row per owner, and a healthy roster row for each.
 *
 * @param owners - the owner names, one row each.
 * @returns the team-record slice the pass reads.
 */
function board(...owners: string[]): DispatchRecordView {
  return {
    teamId: TEAM_ID,
    members: owners.map((name) => ({ name, status: "running", executorRef: "handle-" + name })),
    tasks: owners.map((name, index) => ({ id: "T" + String(index + 1), subject: name + " work", status: "pending", owner: name, blockedBy: [] })),
  }
}

/**
 * A cell record with the given members, complete enough for the tools these arms call.
 *
 * @param members - the member table.
 * @returns the record.
 */
function cellWith(members: Record<string, CellMemberRecord>): CellState {
  /** The fresh record, with this arm's members and the team the fake service answers for. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-10-31T18:00:00.000Z") })
  return { ...base, phase: "executing", teamId: TEAM_ID, members }
}

/**
 * Every journal row of one cell, in append order.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell.
 * @returns the parsed rows; an unreadable journal answers an empty list.
 */
function journalRows(workspace: string, cellId: string): Array<Record<string, unknown>> {
  /** The raw journal text. */
  let text = ""
  try {
    text = readFileSync(journalPath(workspace, cellId), "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * Build the fake harness and install the protocol tools once.
 *
 * @param cell - the cell record to persist.
 * @param rows - the initial board rows.
 * @returns the harness.
 */
function makeHarness(cell: CellState, rows: FakeBoard): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-reassign-"))
  writeCell(workspace, cell)
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The harness under construction, so the fake seams can read and mutate it at call time. */
  const harness: Harness = { workspace, captain, tools: new Map<string, CapturedTool>(), board: rows, calls: [], sends: [], atSend: [] }
  /** The fake adapter: the registry, the root, the meter, the executor and the in-process tool runner. */
  const adapter = {
    registerTool: (definition: CapturedTool): (() => void) => { harness.tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({
      send: async (_captain: unknown, handle: string, text: string): Promise<void> => {
        harness.atSend.push({ reassigned: journalRows(workspace, CELL_ID).filter((row) => row.event === "task-reassigned").length, text })
        harness.sends.push({ handle, text })
      },
    }),
    /**
     * Answer one in-process tool call, applying a CLAIM to the fake board the way team-core does.
     *
     * @param input - the tool name and its arguments.
     * @returns the harness-shaped result.
     */
    executeTool: async (input: { name: string; arguments?: unknown }): Promise<Record<string, unknown>> => {
      /** The call's arguments, read defensively. */
      const args = typeof input.arguments === "object" && input.arguments !== null ? input.arguments as Record<string, unknown> : {}
      harness.calls.push({ name: input.name, arguments: args })
      if (input.name === "agent_teams_task" && args.action === "claim") {
        /** The row the claim names. */
        const row = harness.board.tasks.find((task) => String(task.id) === String(args.task_id))
        if (row === undefined) return { ok: false, isError: true, error: "no task \"" + String(args.task_id) + "\" in team " + TEAM_ID }
        row.status = "in_progress"
        row.owner = String(args.claimant ?? "")
        return { ok: true, isError: false, value: { task: row } }
      }
      return { ok: true, isError: false, value: {} }
    },
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (name: string): unknown => name === "mpdTeams" ? { get: (): unknown => ({ teamId: TEAM_ID, members: harness.board.members, tasks: harness.board.tasks }) } : undefined },
    config: DEFAULT_CELLWORK_CONFIG,
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
 * @returns the tool's structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  /** The tool's answer, narrowed to a record. */
  const answer = await tool.execute(args, { name, agent: harness.captain })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
}

// ── reading the argument ──────────────────────────────────────────────────

test("C6: reassignPairs reads the pairs, trims them, and reports what it cannot use", () => {
  expect(reassignPairs(undefined)).toEqual({ pairs: [], invalid: [] })
  expect(reassignPairs([{ task_id: " T1 ", owner: " Reviewer " }]).pairs).toEqual([{ taskId: "T1", owner: "Reviewer" }])
  /** The refusals of a list with three bad entries and one duplicate. */
  const parsed = reassignPairs([{ task_id: "", owner: "Reviewer" }, { task_id: "T2" }, "nope", { task_id: "T3", owner: "Reviewer" }, { task_id: "T3", owner: "Lead" }])
  expect(parsed.pairs).toEqual([{ taskId: "T3", owner: "Reviewer" }])
  expect(parsed.invalid.length).toBe(4)
  expect(String(parsed.invalid[3])).toContain("named twice")
  expect(reassignPairs("T1").invalid[0]).toContain("must be an array")
})

// ── the order the pre-pass must keep ──────────────────────────────────────

test("C6: applyReassignments claims on the board, journals `task-reassigned`, THEN delivers", async () => {
  /** The workspace the journal is read from. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-reassign-unit-"))
  /** The claims the board seam was asked for, in order. */
  const claims: Array<{ taskId: string; owner: string }> = []
  /** The messages delivered, with the journal state at each one. */
  const deliveries: Array<{ handle: string; content: string; reassignedRows: number }> = []
  /** The pairs this arm applies. */
  const pairs: ReassignPair[] = [{ taskId: "T1", owner: "Reviewer" }]
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace,
    cell: cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }), Reviewer: memberRow("Reviewer") }),
    record: board("Senior Engineer", "Reviewer"),
    pairs,
    claim: async (taskId: string, owner: string): Promise<{ ok: boolean }> => { claims.push({ taskId, owner }); return { ok: true } },
    send: async (handle: string, content: string): Promise<void> => {
      deliveries.push({ handle, content, reassignedRows: journalRows(workspace, CELL_ID).filter((row) => row.event === "task-reassigned").length })
    },
    now: new Date("2026-10-31T18:00:00.000Z"),
    handleFor: (name: string): string => "handle-" + name,
  })
  expect(claims).toEqual([{ taskId: "T1", owner: "Reviewer" }])
  expect(deliveries.length).toBe(1)
  // THE JOURNAL IS ALREADY WRITTEN when the message goes out — the hand-over survives a crash of either.
  expect(deliveries[0].reassignedRows).toBe(1)
  expect(deliveries[0].handle).toBe("handle-Reviewer")
  // The message is the NORMAL dispatch message: it names the board row the member must work and claim.
  expect(deliveries[0].content).toContain("T1")
  expect(deliveries[0].content).toContain("CLAIM IT FIRST")
  expect(outcomes).toEqual([{ taskId: "T1", owner: "Reviewer", claimed: true, delivered: true }])
  /** The journal row the hand-over wrote. */
  const row = journalRows(workspace, CELL_ID).find((entry) => entry.event === "task-reassigned")
  expect(row?.taskId).toBe("T1")
  expect(row?.from).toBe("Senior Engineer")
  expect(row?.to).toBe("Reviewer")
})

test("C6: a REFUSED claim is reported, nothing is delivered, and no journal row is written", async () => {
  /** The workspace the journal is read from. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-reassign-refused-"))
  /** The messages delivered (must stay empty). */
  const sent: string[] = []
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace,
    cell: cellWith({ Reviewer: memberRow("Reviewer") }),
    record: board("Reviewer"),
    pairs: [{ taskId: "T1", owner: "Reviewer" }],
    claim: async (): Promise<{ ok: boolean; error: string }> => ({ ok: false, error: "task T1 is BLOCKED by T0" }),
    send: async (content: string): Promise<void> => { sent.push(content) },
    now: new Date("2026-10-31T18:00:00.000Z"),
  })
  expect(sent).toEqual([])
  expect(outcomes.length).toBe(1)
  expect(outcomes[0].claimed).toBe(false)
  expect(outcomes[0].delivered).toBe(false)
  expect(String(outcomes[0].reason)).toContain("BLOCKED by T0")
  expect(journalRows(workspace, CELL_ID).filter((row) => row.event === "task-reassigned").length).toBe(0)
})

test("C6: a row that cannot be handed over is REPORTED — never thrown, never claimed", async () => {
  /** The workspace the outcomes are built in. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-reassign-guards-"))
  /** Every claim the seam was asked for (must stay empty). */
  const claims: string[] = []
  /** The board: T1 is terminal, T2 is owned by a fenced member, T3 is fine, T4's owner is unknown. */
  const record: DispatchRecordView = {
    teamId: TEAM_ID,
    members: [{ name: "Senior Engineer", status: "running", executorRef: "handle-se" }, { name: "Reviewer", status: "running", executorRef: "handle-rv" }],
    tasks: [
      { id: "T1", subject: "done", status: "completed", owner: "Senior Engineer" },
      { id: "T2", subject: "fenced target", status: "pending", owner: "Senior Engineer", blockedBy: [] },
      { id: "T3", subject: "handled", status: "pending", owner: "Senior Engineer", blockedBy: [] },
    ],
  }
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace,
    cell: cellWith({ "Senior Engineer": memberRow("Senior Engineer", { fenced: true, fencedReason: "no-engine" }), Reviewer: memberRow("Reviewer") }),
    record,
    pairs: [
      { taskId: "T1", owner: "Reviewer" },
      { taskId: "T9", owner: "Reviewer" },
      { taskId: "T2", owner: "Senior Engineer" },
      { taskId: "T3", owner: "Nobody" },
      { taskId: "T3", owner: "Reviewer" },
    ],
    claim: async (taskId: string): Promise<{ ok: boolean }> => { claims.push(taskId); return { ok: true } },
    send: async (): Promise<void> => {},
    now: new Date("2026-10-31T18:00:00.000Z"),
  })
  expect(outcomes.length).toBe(5)
  expect(String(outcomes[0].reason)).toContain("already completed")
  expect(String(outcomes[1].reason)).toContain("no board row")
  expect(String(outcomes[2].reason)).toContain("FENCED")
  expect(String(outcomes[3].reason)).toContain("does not name")
  expect(outcomes[4].claimed).toBe(true)
  // Only the last pair reached the board: a refusal never claims, and a claim always follows a check.
  expect(claims).toEqual(["T3"])
})

test("C6: a target with no executor handle is reported BEFORE the claim (a claim would hide the row)", async () => {
  /** The workspace the outcome is built in. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-reassign-handle-"))
  /** Every claim the seam was asked for (must stay empty). */
  const claims: string[] = []
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace,
    cell: cellWith({ Reviewer: memberRow("Reviewer") }),
    // The roster row names the member but carries no handle, and the cell record has none either.
    record: { teamId: TEAM_ID, members: [{ name: "Reviewer", status: "inactive" }], tasks: [{ id: "T1", subject: "work", status: "pending", owner: "Senior Engineer", blockedBy: [] }] },
    pairs: [{ taskId: "T1", owner: "Reviewer" }],
    claim: async (taskId: string): Promise<{ ok: boolean }> => { claims.push(taskId); return { ok: true } },
    send: async (): Promise<void> => {},
    now: new Date("2026-10-31T18:00:00.000Z"),
  })
  expect(claims).toEqual([])
  expect(outcomes[0].claimed).toBe(false)
  expect(String(outcomes[0].reason)).toContain("no executor handle")
})

// ── the tool that exposes it ──────────────────────────────────────────────

test("C6: cellwork_dispatch claims through the board, journals, delivers, and never re-delivers the row", async () => {
  /** The cell whose `Senior Engineer` is fenced and whose `Reviewer` can work. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }), Reviewer: memberRow("Reviewer") })
  /** The harness whose fake executor records the journal state at every delivery. */
  const harness = makeHarness(cell, {
    members: [{ name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer" }, { name: "Reviewer", status: "running", executorRef: "handle-Reviewer" }],
    tasks: [
      { id: "T1", subject: "fenced work", status: "pending", owner: "Senior Engineer", blockedBy: [] },
      { id: "T2", subject: "healthy work", status: "pending", owner: "Reviewer", blockedBy: [] },
    ],
  })
  /** The captain's repair pass. */
  const answer = await runTool(harness, "cellwork_dispatch", { reassign: [{ task_id: "T1", owner: "Reviewer" }] })
  expect(answer.ok).toBe(true)
  // THE BOARD WRITE IS THE TOOL THE ROBOT ALREADY USES, with the row and the claimant named.
  expect(harness.calls.length).toBe(1)
  expect(harness.calls[0].name).toBe("agent_teams_task")
  expect(harness.calls[0].arguments.action).toBe("claim")
  expect(harness.calls[0].arguments.task_id).toBe("T1")
  expect(harness.calls[0].arguments.claimant).toBe("Reviewer")
  // The hand-over is reported as the SEPARATE facts it is.
  /** The reassignment outcome the tool reported. */
  const reassigned = answer.reassigned as Array<Record<string, unknown>>
  expect(reassigned).toEqual([{ taskId: "T1", owner: "Reviewer", claimed: true, delivered: true }])
  // ONE delivery: the hand-over of T1. The pass then refuses T2 because Reviewer now OWNS an in-flight
  // row — the board claim is what makes the member busy, and it is also what stops a second delivery.
  expect(harness.sends.length).toBe(1)
  expect(harness.sends[0].text).toContain("T1")
  expect(harness.sends.filter((send) => send.text.includes("your task T1")).length).toBe(1)
  /** The rows the pass left alone, with why. */
  const skipped = answer.skipped as Array<Record<string, unknown>>
  expect(skipped.map((row) => row.taskId).sort()).toEqual(["T1", "T2"])
  /** The skip reason keyed by row, so each rule is asserted on the row it belongs to. */
  const reasons = new Map(skipped.map((row) => [String(row.taskId), String(row.reason)]))
  // T1 is no longer pending: the CLAIM the hand-over wrote is what the pass reads back, so the row is
  // never delivered twice. T2 waits because Reviewer now owns an in-flight row.
  expect(String(reasons.get("T1"))).toContain("not pending")
  expect(String(reasons.get("T2"))).toContain("BUSY")
  // The journal row existed when the FIRST message went out (claim → journal → deliver).
  expect(harness.atSend[0].reassigned).toBe(1)
  /** The journal rows the tool wrote. */
  const rows = journalRows(harness.workspace, CELL_ID)
  expect(rows.filter((row) => row.event === "task-reassigned").length).toBe(1)
  expect(rows.filter((row) => row.event === "dispatch-reassign").length).toBe(1)
})

test("C6: a reassignment the board refuses is reported in the result, and the pass still runs", async () => {
  /** The cell whose owner is fenced and whose Reviewer can work. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }), Reviewer: memberRow("Reviewer") })
  /** The harness whose board holds a row that does not exist for the claim. */
  const harness = makeHarness(cell, {
    members: [{ name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer" }, { name: "Reviewer", status: "running", executorRef: "handle-Reviewer" }],
    tasks: [{ id: "T2", subject: "healthy work", status: "pending", owner: "Reviewer", blockedBy: [] }],
  })
  /** The captain's pass, naming a row the board does not hold. */
  const answer = await runTool(harness, "cellwork_dispatch", { reassign: [{ task_id: "T404", owner: "Reviewer" }, { task_id: "T2", owner: "" }] })
  expect(answer.ok).toBe(true)
  /** The reassignment outcome. */
  const reassigned = answer.reassigned as Array<Record<string, unknown>>
  expect(reassigned.length).toBe(1)
  expect(reassigned[0].claimed).toBe(false)
  expect(String(reassigned[0].reason)).toContain("no board row")
  // An entry with no owner is reported as unreadable, and the readable pairs still ran.
  expect((answer.reassignInvalid as unknown[]).length).toBe(1)
  expect(harness.sends.length).toBe(1)
  expect(harness.sends[0].text).toContain("T2")
})

test("C6: the pass skips a fenced owner's row with the repair named, and delivers nothing to it", async () => {
  /** The cell whose only owner is fenced. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint" }) })
  /** The harness with one ready row for that owner. */
  const harness = makeHarness(cell, {
    members: [{ name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer" }],
    tasks: [{ id: "T1", subject: "fenced work", status: "pending", owner: "Senior Engineer", blockedBy: [] }],
  })
  /** The captain's pass with nothing to reassign. */
  const answer = await runTool(harness, "cellwork_dispatch", {})
  expect(answer.ok).toBe(true)
  expect(answer.pairs).toEqual([])
  expect(harness.sends.length).toBe(0)
  /** The skip the pass reported. */
  const skipped = answer.skipped as Array<Record<string, unknown>>
  expect(String(skipped[0].reason)).toContain("FENCED")
  expect(String(skipped[0].reason)).toContain("reassign")
})
