// THE CR-REPAIR ARMS AFTER THE MIGRATION (wave T45).
//
// WHAT THIS FILE USED TO TEST: five `applyReassignments` arms (R-A2's blank-cell-handle fallback plus R-A1's
// target-status refusals) and one `dispatchOwnerOnly` arm for the same repair in the dispatch pass. The TEAM
// PLANE now owns the roster and the delivery: it resolves a member's handle from its OWN record
// (`executorRef`), checks that member's own status before claiming, and never consults a cell row. The
// fallback is therefore SUBSUMED, not lost — R-A2's defect (a blank cell row starving a live member of its
// delivery) cannot recur, because the cell row takes no part in the decision.
//
// DISPOSITION (ruling of 2026-11-02, "delete arms whose SUBJECT is gone"):
//  • DELETED with pointer — "blank cell handle falls through in the REASSIGN path", "blank on BOTH sides",
//    "FAILED member refused", "still being RAISED refused", "SETTLED is a legal target": all five assert
//    `applyReassignments`'s own decisions. Those decisions are the PLANE's now and are asserted by
//    `packages/mpd-team-core-plugin/test/team-toolchain.test.ts` ("it refuses an in-progress row, an unknown
//    row and a fenced target" for the refusals, "it claims the row for the target, journals task-reassigned,
//    delivers, and books the ledger" for the success path).
//  • DELETED with pointer — `handleOrNull`'s own arm: the helper is engine-internal (it trimmed a CELL-row
//    handle), and the plane's roster owns handles now, so nothing in `src/` resolves one.
//  • KEPT AND RE-PINNED — "the plane delivers to the RECORD's handle in the DISPATCH pass": the live
//    behaviour, asserted through the REAL `cellwork_dispatch` with the cell row's handle deliberately blank.
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { callerContext } from "../src/caller.ts"
import { cellworkGuardDecision } from "../src/guard.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { writeCell } from "../src/state.ts"
import type { CellMemberRecord, CellState } from "../src/state.ts"
import { createTeamActionsDouble } from "./lib/team-actions-double.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261031T150000000Z"

/** The team id the record names. */
const TEAM_ID = "team-cr-repairs"

/** The captain's session, which is the only caller `cellwork_dispatch` accepts. */
const CAPTAIN = "session-captain"

/** One fake agent, which the adapter only needs for its session id and cwd. */
interface FakeAgent {
  /** The agent id (its session id). */
  id: string
  /** The session header the workspace resolves from. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool definition, narrowed to what these arms call. */
interface CapturedTool {
  /** The tool name. */
  name: string
  /** Its handler. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/**
 * One member row as the CELL record stores it, defaulted to a healthy, raised seat.
 *
 * @param name - the member's board name.
 * @param overrides - the fields this arm changes (`executorRef`, mode, …).
 * @returns the row.
 */
function memberRow(name: string, overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return { name, role: name, sessionId: "session-" + name, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T15:00:00.000Z", ...overrides }
}

/**
 * A cell record carrying the given member rows, in the executing phase the dispatch tool requires.
 *
 * @param members - the member table.
 * @returns the record.
 */
function cellWith(members: Record<string, CellMemberRecord>): CellState {
  return { cellId: CELL_ID, phase: "executing", teamId: TEAM_ID, captainSessionId: CAPTAIN, members } as unknown as CellState
}

/** One roster row, with the handle the PLANE resolves a delivery from. */
interface RosterRow {
  /** The display name. */
  name: string
  /** The roster state. */
  status: string
  /** The executor handle. */
  executorRef: string
}

/**
 * A board whose one ready row is owned by the FIRST roster row.
 *
 * @param rows - the roster rows, in the order the arm wants them.
 * @returns the team-record slice the double answers with.
 */
function board(rows: readonly RosterRow[]): Record<string, unknown> {
  return { teamId: TEAM_ID, members: rows.map((row) => ({ ...row })), tasks: [{ id: "T1", subject: "work", status: "pending", owner: rows[0]?.name ?? "", blockedBy: [] }] }
}

/**
 * Run ONE real `cellwork_dispatch` over a cell and a board.
 *
 * @param cell - the cell record to persist and work in.
 * @param record - the live team record the double and the `mpdTeams` double answer with.
 * @param args - the tool arguments (a plain pass when omitted).
 * @returns the tool's answer and the deliveries the double made.
 */
async function dispatchOver(cell: CellState, record: Record<string, unknown>, args: Record<string, unknown> = {}): Promise<{ answer: Record<string, any>; sent: Array<{ handle: string; text: string }> }> {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-"))
  writeCell(workspace, cell)
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN, session: { id: CAPTAIN, header: { cwd: workspace } } }
  /** Delivered messages. */
  const sent: Array<{ handle: string; text: string }> = []
  /** Captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** The fake adapter: the seams these tools touch and nothing else. */
  const adapter = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): undefined => undefined,
    onAgentPreStep: (): (() => void) => (): void => {},
    onEvent: (): (() => void) => (): void => {},
    executeTool: async (): Promise<Record<string, unknown>> => ({ ok: true, isError: false, value: {} }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: {
      get: (name: string): unknown => name === "mpdTeamActions"
        ? createTeamActionsDouble({
          record: () => record as unknown as Parameters<typeof createTeamActionsDouble>[0]["record"] extends () => infer R ? R : never,
          send: (handle: string, text: string): void => { sent.push({ handle, text }) },
        }).service
        : name === "mpdTeams" ? { get: (): unknown => record } : undefined,
    },
    config: { ...DEFAULT_CELLWORK_CONFIG },
    warn: (): void => {},
  })
  /** The captured tool. */
  const tool = tools.get("cellwork_dispatch")
  if (tool === undefined) throw new Error("cellwork_dispatch was not registered")
  /** Its answer. */
  const answer = await tool.execute(args, { name: "cellwork_dispatch", agent: captain })
  return { answer: typeof answer === "object" && answer !== null ? answer as Record<string, any> : {}, sent }
}

test("the plane delivers to the RECORD's handle when the cell row's handle is blank", async () => {
  // THE LIVE BEHAVIOUR R-A2 CARED ABOUT, asserted where it now lives: the CELL row keeps a blank handle
  // (the exact shape that used to starve a delivery) and the PLANE still reaches the member, because it
  // resolves the handle from its own roster row. R-A2's repair is subsumed by that ownership.
  /** The cell whose member row never learned a handle. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { executorRef: "" }) })
  /** The board whose roster row DOES carry the live handle. */
  const record = board([{ name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer" }])
  /** The pass through the real tool. */
  const { answer, sent } = await dispatchOver(cell, record)
  expect(answer.ok).toBe(true)
  expect((answer.pairs as Array<Record<string, unknown>>).length).toBe(1)
  // ONE delivery, to the RECORD's handle — the blank cell row changed nothing.
  expect(sent.map((message) => message.handle)).toEqual(["handle-Senior Engineer"])
})

test("a BLOCKED row is refused at the CELLWORK boundary, with the plane's sentence", async () => {
  // THE TOOL BOUNDARY PROVES WHAT THE PLANE DECIDES (T37's arm proves it on the plane): a hand-over of a
  // row whose declared blocker is unsatisfied is refused, the row is not claimed, and the sentence a captain
  // reads names the blocking ids.
  /** The cell whose Reviewer can work. */
  const cell = cellWith({ Reviewer: memberRow("Reviewer") })
  /** The board: a blocker and the blocked row the pass is asked to hand over. */
  const record = {
    teamId: TEAM_ID,
    members: [{ name: "Reviewer", status: "running", executorRef: "handle-Reviewer" }],
    tasks: [
      { id: "T1", subject: "blocker", status: "pending", blockedBy: [] },
      { id: "T2", subject: "blocked work", status: "pending", owner: "Reviewer", blockedBy: ["T1"] },
    ],
  }
  /** The refused hand-over, through the real tool. */
  const { answer } = await dispatchOver(cell, record, { reassign: [{ task_id: "T2", owner: "Reviewer" }] })
  expect(answer.ok).toBe(true)
  /** The hand-over outcome as the tool reported it. */
  const outcome = (answer.reassigned as Array<Record<string, unknown>>)[0]
  expect(outcome?.claimed).toBe(false)
  expect(outcome?.delivered).toBe(false)
  expect(String(outcome?.reason)).toContain("BLOCKED by T1")
  // THE ROW IS UNTOUCHED: still pending, still the declared owner's.
  expect((record.tasks as Array<Record<string, unknown>>)[1]).toMatchObject({ status: "pending", owner: "Reviewer" })
})

test("the GUARD reads the seat's fence from the RECORD while the cell row disagrees", () => {
  // THE READ-THROUGH (wave W2-E, asserted here as T45's acceptance arm): the CELL row says the member is a
  // live `member`, the TEAM RECORD says `mode:"checkpoint"`. The guard must decide on the RECORD, because a
  // closed seat is the plane's fact and the cell row is its mirror.
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-guard-"))
  /** The cell row that DISAGREES with the plane. */
  writeCell(workspace, cellWith({ Reviewer: memberRow("Reviewer", { sessionId: "session-Reviewer" }) }))
  /** The plane's record, which closes the seat. */
  const record = { teamId: TEAM_ID, members: [{ name: "Reviewer", status: "running", executorRef: "handle-Reviewer", mode: "checkpoint" }], tasks: [] }
  /** The adapter the caller context reads its workspace from. */
  const dsh = { workspaceRoot: (): string => workspace } as unknown as DshAdapter
  /** The seat the GUARD would see for this session. */
  const seat = callerContext(
    dsh,
    { agent: { session: { id: "session-Reviewer", header: { cwd: workspace } } } } as never,
    { teams: (): { get: (workspace: string, teamId: string) => unknown } => ({ get: (): unknown => record }) },
  ).seat
  expect(seat?.mode).toBe("checkpoint")
  // AND THE GUARD REFUSES A WORK TOOL in that seat — the same decision every dispatched call goes through.
  expect(String(cellworkGuardDecision(seat, "write"))).toContain("checkpoint")
})
