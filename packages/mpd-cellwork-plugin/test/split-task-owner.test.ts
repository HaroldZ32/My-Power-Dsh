// OFFLINE PROOF OF THE SPLIT-TICKET LOOKUP AND ITS OWNER REPAIR (contract C11, defects D2 and D3).
//
// The VEdit evidence: a staged split ticket reached the board with NO owner, an owner-only lookup then
// found nothing, a requirements bump neither marked the split stale nor re-dispatched the row, and the
// ticket could never be completed (owner-only verb). The fix is two-sided — the BOARD ID is recorded on
// the cell and looked up FIRST, and a lost owner is repaired by claiming the row for `cell-splitter`.
//
// These arms are unit-level by design: they drive the two exported seams (`findSplitTicket`,
// `resolveSplitTicket`) with an in-memory board, so the defect's own state is reproduced directly.
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { findSplitTicket, resolveSplitTicket, SPLIT_TICKET_REPAIR, SPLITTER_MEMBER, type SplitTicketRow } from "../src/staging.ts"
import { newCellState } from "../src/state.ts"
import type { StageDeps } from "../src/staging.ts"

/** One board row the fake board keeps, mutated in place by a claim. */
interface FakeRow {
  /** The board id. */
  id: string
  /** The declared owner, which the defect left empty. */
  owner: string
  /** The board status. */
  status: string
}

/** One captured `agent_teams_task` call. */
interface CapturedTaskCall {
  /** The action the call asked for. */
  action: string
  /** The board row it named. */
  taskId: string
  /** The claimant, when it was a claim. */
  claimant: string
}

/** The fake board plus the calls it recorded. */
interface FakeBoard {
  /** The rows, mutated in place. */
  rows: FakeRow[]
  /** The task calls, in order. */
  calls: CapturedTaskCall[]
  /** When true, a claim is refused (the row may be blocked by its requirements row). */
  refuseClaim: boolean
}

/**
 * A board with a fixed set of rows and a claim double.
 *
 * @param rows - the initial rows.
 * @returns the fake board.
 */
function makeBoard(rows: FakeRow[]): FakeBoard {
  return { rows, calls: [], refuseClaim: false }
}

/**
 * Build the deps `resolveSplitTicket` reads, over one fake board.
 *
 * @param board - the fake board.
 * @param recordedId - the board id the cell already recorded, or "".
 * @param boardReadable - false to make the team service answer nothing.
 * @returns the deps slice.
 */
function depsFor(board: FakeBoard, recordedId: string, boardReadable: boolean = true): Pick<StageDeps, "dsh" | "workspace" | "cell" | "captainAgent" | "teams"> {
  /** The workspace root (no file is written by these seams). */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-ticket-"))
  /** The cell record carrying the recorded board id. */
  const cell = { ...newCellState({ cellId: "cell-ticket", objective: "resolve the ticket", captainSessionId: "session-captain", now: new Date() }), splitTaskId: recordedId }
  return {
    workspace,
    cell,
    captainAgent: { id: "session-captain" },
    // The adapter slice: only `executeTool` is reached by these arms.
    dsh: {
      /**
       * Answer one team call against the fake board.
       * @param input - the tool call.
       * @returns the normalized result the seam reads.
       */
      async executeTool(input: { name: string; arguments?: Record<string, unknown> }): Promise<{ ok: boolean; value?: unknown; error?: unknown }> {
        /** The arguments as a loose record. */
        const args = input.arguments ?? {}
        /** The row the call names. */
        const row = board.rows.find((candidate) => candidate.id === String(args.task_id ?? ""))
        board.calls.push({ action: String(args.action ?? ""), taskId: String(args.task_id ?? ""), claimant: String(args.claimant ?? "") })
        if (String(args.action ?? "") === "claim" && board.refuseClaim) return { ok: false, error: "the row is blocked by its requirements task" }
        if (String(args.action ?? "") === "claim" && row !== undefined) row.owner = String(args.claimant ?? "")
        return { ok: true, value: { task: row } }
      },
    } as unknown as StageDeps["dsh"],
    // The team reader: `undefined` models a composition that cannot answer.
    teams: () => boardReadable ? { get: (): Record<string, unknown> => ({ teamId: "team-1", members: [], tasks: board.rows }) } : undefined,
  }
}

/** A row with the splitter as its owner, used as the fallback candidate. */
function ownedRow(id: string, status: string = "pending"): FakeRow {
  return { id, owner: SPLITTER_MEMBER, status }
}

test("C11/D2: the RECORDED board id wins over the owner spelling, so a renamed owner cannot hide the row", () => {
  /** The board: the recorded row's owner is NOT the splitter spelling any more. */
  const board = makeBoard([{ id: "T2", owner: "", status: "pending" }, ownedRow("T9")])
  /** The lookup the requirements update performs. */
  const found = findSplitTicket(board.rows as SplitTicketRow[], "T2", false)
  expect(found?.id).toBe("T2")
})

test("C11/D3: without a recorded id the owner spelling still finds the ticket (the pre-C11 fallback)", () => {
  /** The board. */
  const board = makeBoard([{ id: "T1", owner: "cell-planner", status: "completed" }, ownedRow("T2")])
  /** The owner fallback. */
  expect(findSplitTicket(board.rows as SplitTicketRow[], "", false)?.id).toBe("T2")
  // liveOnly=true skips a terminal owner row and finds the live one; with none, the answer is undefined.
  expect(findSplitTicket(board.rows as SplitTicketRow[], "", true)?.id).toBe("T2")
  expect(findSplitTicket([{ id: "T3", owner: SPLITTER_MEMBER, status: "completed" }] as SplitTicketRow[], "", true)).toBeUndefined()
  expect(findSplitTicket([{ id: "T3", owner: SPLITTER_MEMBER, status: "completed" }] as SplitTicketRow[], "", false)?.id).toBe("T3")
})

test("C11/D2: an OWNERLESS split ticket is claimed for cell-splitter and reported as repaired", async () => {
  /** The board carrying exactly the defect's row. */
  const board = makeBoard([{ id: "T2", owner: "", status: "pending" }])
  /** The resolution. */
  const resolved = await resolveSplitTicket(depsFor(board, "T2"), "team-1", "", true)
  expect(resolved).toEqual({ splitTaskId: "T2", ownerRepaired: true, repairError: "", boardReadable: true })
  // The repair is a real board claim for the fixed cell role, and the row's owner moved.
  expect(board.calls).toEqual([{ action: "claim", taskId: "T2", claimant: SPLITTER_MEMBER }])
  expect(board.rows[0]?.owner).toBe(SPLITTER_MEMBER)
})

test("C11/D2: a REFUSED claim still records the id and names the repair verb", async () => {
  /** The board whose claim is refused (the requirements row still blocks it). */
  const board = makeBoard([{ id: "T2", owner: "", status: "pending" }])
  board.refuseClaim = true
  /** The resolution. */
  const resolved = await resolveSplitTicket(depsFor(board, ""), "team-1", "T2", true)
  expect(resolved.splitTaskId).toBe("T2")
  expect(resolved.ownerRepaired).toBe(false)
  expect(resolved.repairError).toContain(SPLIT_TICKET_REPAIR)
  expect(resolved.repairError).toContain("could not be claimed")
})

test("C11: a readable board with NO split ticket is a hard error naming the repair verb", async () => {
  /** The board with unrelated rows only. */
  const board = makeBoard([{ id: "T1", owner: "cell-planner", status: "pending" }])
  /** The resolution. */
  const resolved = await resolveSplitTicket(depsFor(board, ""), "team-1", "", true)
  expect(resolved.splitTaskId).toBe("")
  expect(resolved.boardReadable).toBe(true)
  expect(resolved.repairError).toContain("no split ticket")
  expect(resolved.repairError).toContain(SPLIT_TICKET_REPAIR)
})

test("C11: an UNREADABLE team record proves nothing, so no missing-ticket error is invented", async () => {
  /** The board (never read). */
  const board = makeBoard([{ id: "T2", owner: "", status: "pending" }])
  /** The resolution over an absent team service. */
  const resolved = await resolveSplitTicket(depsFor(board, "T2", false), "team-1", "T2", true)
  expect(resolved).toEqual({ splitTaskId: "", ownerRepaired: false, repairError: "", boardReadable: false })
  expect(board.calls).toEqual([])
})
