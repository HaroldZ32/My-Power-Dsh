// Offline tests for the two CodeRabbit findings on the lane-A dispatch path (repair wave T18).
//
// R-A1 (CR #2): `applyReassignments` checked the fence and the handle but never the TARGET MEMBER'S
// STATUS. A `failed` member keeps a recorded `executorRef`, so a reassignment could claim a row FOR it —
// the message dies, and the row sits `in_progress` where no later pass picks it up. The rule the dispatch
// pass already applies to an owner is now applied here too, BEFORE the claim.
//
// R-A2 (CR #4): a cell record writes `executorRef: ""` for a handle it never learned, and `??` does not
// fall through on an empty string — so the blank CELL value shadowed the live ROSTER handle and both the
// pass and the reassign path reported the member as "never raised". Both call sites now use
// `handleOrNull`, which treats empty and whitespace-only as absent.
//
// Both subjects are pure decisions over the record, so these arms need no adapter: they drive
// `dispatchOwnerOnly` / `applyReassignments` directly and assert on the reported outcomes, the claimed
// seam, and the delivered messages.
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyReassignments, dispatchOwnerOnly, handleOrNull, type DispatchRecordView } from "../src/dispatch.ts"
import type { CellMemberRecord, CellState } from "../src/state.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261031T150000000Z"

/** The team id the record names. */
const TEAM_ID = "team-cr-repairs"

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
 * A cell record carrying the given member rows, complete enough for the two decisions.
 *
 * @param members - the member table.
 * @returns the record.
 */
function cellWith(members: Record<string, CellMemberRecord>): CellState {
  return { cellId: CELL_ID, members } as unknown as CellState
}

/**
 * A board whose ready rows are owned by the given members.
 *
 * @param owners - the member names, one pending unblocked row each.
 * @param statuses - the roster status of each owner, in the same order (default `running`).
 * @returns the team-record slice.
 */
function board(owners: readonly string[], statuses: readonly string[] = []): DispatchRecordView {
  return {
    teamId: TEAM_ID,
    members: owners.map((name, index) => ({ name, status: statuses[index] ?? "running", executorRef: "handle-" + name })),
    tasks: owners.map((name, index) => ({ id: "T" + String(index + 1), subject: name + " work", status: "pending", owner: name, blockedBy: [] })),
  }
}

// ── R-A2: the blank-handle helper ─────────────────────────────────────────

test("R-A2: handleOrNull treats absent, empty and whitespace-only as NO handle, and trims the rest", () => {
  expect(handleOrNull(undefined)).toBeNull()
  expect(handleOrNull(null)).toBeNull()
  expect(handleOrNull("")).toBeNull()
  expect(handleOrNull("   ")).toBeNull()
  expect(handleOrNull(42)).toBeNull()
  expect(handleOrNull(" handle-live ")).toBe("handle-live")
})

test("R-A2: a BLANK cell handle falls through to the live roster handle in the DISPATCH pass", async () => {
  /** The cell whose member row never learned a handle. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { executorRef: "" }) })
  /** The messages delivered. */
  const sent: Array<{ handle: string; content: string }> = []
  /** The pass over a board whose roster row DOES carry the live handle. */
  const report = await dispatchOwnerOnly({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-dispatch-")),
    cell,
    record: board(["Senior Engineer"]),
    send: async (handle: string, content: string): Promise<void> => { sent.push({ handle, content }) },
    now: new Date("2026-10-31T15:00:00.000Z"),
    // The same binding the tool uses: the CELL row's value, blank here.
    handleFor: (name: string): string | undefined => cell.members[name]?.executorRef,
  })
  expect(report.pairs.length).toBe(1)
  expect(report.pairs[0].handle).toBe("handle-Senior Engineer")
  expect(sent.map((message) => message.handle)).toEqual(["handle-Senior Engineer"])
})

test("R-A2: a BLANK cell handle falls through to the live roster handle in the REASSIGN path", async () => {
  /** The cell whose member row never learned a handle. */
  const cell = cellWith({ Reviewer: memberRow("Reviewer", { executorRef: "" }) })
  /** The claims the board seam was asked for. */
  const claims: Array<{ taskId: string; owner: string }> = []
  /** The handles the messages went to. */
  const sent: string[] = []
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-reassign-")),
    cell,
    record: board(["Senior Engineer", "Reviewer"]),
    pairs: [{ taskId: "T1", owner: "Reviewer" }],
    claim: async (taskId: string, owner: string): Promise<{ ok: boolean }> => { claims.push({ taskId, owner }); return { ok: true } },
    send: async (handle: string): Promise<void> => { sent.push(handle) },
    now: new Date("2026-10-31T15:00:00.000Z"),
    handleFor: (name: string): string | undefined => cell.members[name]?.executorRef,
  })
  expect(claims).toEqual([{ taskId: "T1", owner: "Reviewer" }])
  expect(sent).toEqual(["handle-Reviewer"])
  expect(outcomes).toEqual([{ taskId: "T1", owner: "Reviewer", claimed: true, delivered: true }])
})

test("R-A2 control: a blank handle on BOTH sides is still reported, never delivered", async () => {
  /** The cell whose member row never learned a handle. */
  const cell = cellWith({ Reviewer: memberRow("Reviewer", { executorRef: "  " }) })
  /** Every claim the seam was asked for (must stay empty). */
  const claims: string[] = []
  /** A board whose roster row also carries no handle. */
  const record: DispatchRecordView = { teamId: TEAM_ID, members: [{ name: "Reviewer", status: "running", executorRef: "" }], tasks: [{ id: "T1", subject: "work", status: "pending", owner: "Reviewer", blockedBy: [] }] }
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-blank-")),
    cell,
    record,
    pairs: [{ taskId: "T1", owner: "Reviewer" }],
    claim: async (taskId: string): Promise<{ ok: boolean }> => { claims.push(taskId); return { ok: true } },
    send: async (): Promise<void> => {},
    now: new Date("2026-10-31T15:00:00.000Z"),
    handleFor: (name: string): string | undefined => cell.members[name]?.executorRef,
  })
  expect(claims).toEqual([])
  expect(outcomes[0].claimed).toBe(false)
  expect(String(outcomes[0].reason)).toContain("no executor handle")
})

// ── R-A1: the target's own status, checked before the claim ───────────────

test("R-A1: a reassignment to a FAILED member is refused before the claim, and the row stays pending", async () => {
  /** The board: a healthy owner and a FAILED one that still carries a recorded handle. */
  const record = board(["Senior Engineer", "Deep Worker"], ["running", "failed"])
  /** The board row being handed over. */
  const row = record.tasks?.[0]
  /** Every claim the seam was asked for (must stay empty — a claim would strand the row). */
  const claims: string[] = []
  /** Every message delivered (must stay empty). */
  const sent: string[] = []
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-failed-")),
    cell: cellWith({ "Senior Engineer": memberRow("Senior Engineer"), "Deep Worker": memberRow("Deep Worker") }),
    record,
    pairs: [{ taskId: "T1", owner: "Deep Worker" }],
    claim: async (taskId: string): Promise<{ ok: boolean }> => { claims.push(taskId); return { ok: true } },
    send: async (handle: string): Promise<void> => { sent.push(handle) },
    now: new Date("2026-10-31T15:00:00.000Z"),
  })
  expect(claims).toEqual([])
  expect(sent).toEqual([])
  expect(outcomes.length).toBe(1)
  expect(outcomes[0].claimed).toBe(false)
  expect(outcomes[0].delivered).toBe(false)
  expect(String(outcomes[0].reason)).toContain("FAILED to start")
  // THE ROW IS STILL PENDING: nothing claimed it for a member that cannot answer.
  expect(row?.status).toBe("pending")
  expect(row?.owner).toBe("Senior Engineer")
})

test("R-A1: a reassignment to a member still being RAISED is refused the same way", async () => {
  /** The board whose second owner is still provisioning. */
  const record = board(["Senior Engineer", "Reviewer"], ["running", "provisioning"])
  /** Every claim the seam was asked for (must stay empty). */
  const claims: string[] = []
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-raised-")),
    cell: cellWith({ "Senior Engineer": memberRow("Senior Engineer"), Reviewer: memberRow("Reviewer") }),
    record,
    pairs: [{ taskId: "T1", owner: "Reviewer" }],
    claim: async (taskId: string): Promise<{ ok: boolean }> => { claims.push(taskId); return { ok: true } },
    send: async (): Promise<void> => {},
    now: new Date("2026-10-31T15:00:00.000Z"),
  })
  expect(claims).toEqual([])
  expect(String(outcomes[0].reason)).toContain("still being raised")
  expect(record.tasks?.[0]?.status).toBe("pending")
})

test("R-A1 control: a SETTLED (`inactive`) member is still a legal reassignment target", async () => {
  // The native executor cold-resumes a settled member, so `inactive` is not a refusal — only `failed`
  // and `provisioning` are, exactly as the dispatch pass has always decided.
  /** The board whose second owner is settled. */
  const record = board(["Senior Engineer", "Reviewer"], ["running", "inactive"])
  /** The handles the messages went to. */
  const sent: string[] = []
  /** What the pre-pass did. */
  const outcomes = await applyReassignments({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-cr-inactive-")),
    cell: cellWith({ "Senior Engineer": memberRow("Senior Engineer"), Reviewer: memberRow("Reviewer") }),
    record,
    pairs: [{ taskId: "T1", owner: "Reviewer" }],
    claim: async (): Promise<{ ok: boolean }> => ({ ok: true }),
    send: async (handle: string): Promise<void> => { sent.push(handle) },
    now: new Date("2026-10-31T15:00:00.000Z"),
  })
  expect(sent).toEqual(["handle-Reviewer"])
  expect(outcomes).toEqual([{ taskId: "T1", owner: "Reviewer", claimed: true, delivered: true }])
})
