// OFFLINE PROOF OF THE UNFENCE LEVER (contract B2, the VEdit deadlock of 2026-10-31 / 2026-11-02).
//
// A fenced member row keeps `handoffReady: true` — `memberAfterBarrier` sets it when the compaction
// barrier GIVES UP — so `cellwork_handoff` refuses the member with "STILL WAITING for the compaction
// barrier", while the only other clearer is another SUCCESSFUL barrier, which a fenced member cannot
// start. `cellwork_dispatch {reassign}` moves board rows and clears no fence, so six members stayed
// fenced in one cell's record with no verb able to reopen them.
//
// These arms pin the repair on the tool the captain already has: `cellwork_dispatch {unfence:[...]}`,
// the CELL row's own spelling of "fenced" (removed, never `false`), the TEAM row's half through the
// plane's declared `unfence` seam, and the two honest negatives — `not-fenced` and an unknown name.
//
// The harness is the SAME shared plane double `dispatch-reassign.test.ts` uses, extended to expose (or
// hide) the optional `unfence` seam, so the arms assert the plugin's own calls rather than a bespoke
// stub. Every workspace is a fresh temp dir; nothing reads this repository's state.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { journalPath, newCellState, readCell, statePath, writeCell, type CellMemberRecord, type CellState } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { createTeamActionsDouble, type DoubleMember, type DoubleTask, type DoubleTeamRecord, type TeamActionsDouble } from "./lib/team-actions-double.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261104T120000000Z"

/** The team id the cell record names (the shared plane double answers for it). */
const TEAM_ID = "team-unfence"

/** The captain's session id, which is what makes `cellwork_dispatch` captain-only for it. */
const CAPTAIN_SESSION = "session-captain"

/** A handoff document satisfying all seven required sections, so only the SEAT can refuse the verb. */
const HANDOFF_TEXT = ["## Task", "finish the widget", "## State", "half done", "## Decisions", "mirror the team row", "## Artifacts", "none yet", "## Verified facts", "the test pins it", "## Open questions", "none", "## Next step", "end the turn"].join("\n")

/** One fake live agent: its session id and the workspace header the readers resolve from. */
interface FakeAgent {
  /** The agent id (the session-id readers fall back to it). */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool definition (the fake registry hands the runner back here). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The description the model reads when it selects the tool. */
  description?: string
  /** The JSON-schema argument declaration. */
  parameters?: { properties?: Record<string, unknown> }
  /** The runner, called with the harness-validated arguments and the dispatch. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** Captured tool definitions by name. */
  tools: Map<string, CapturedTool>
  /** Every message the team executor delivered, in order. */
  sends: Array<{ handle: string; text: string }>
  /** The live team record the plane double mutates and `mpdTeams` answers. */
  record: DoubleTeamRecord
  /** The shared plane double, so an arm can read the seam calls the plugin made. */
  plane: TeamActionsDouble
}

/**
 * One member row as the CELL record stores it, already raised with a live handle.
 *
 * @param name - the member's board name.
 * @param overrides - the fields this arm changes (mode, fenced, …).
 * @returns the row.
 */
function memberRow(name: string, overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return { name, role: name, sessionId: "session-" + name, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-11-04T00:00:00.000Z", ...overrides }
}

/**
 * One member row exactly as the compaction barrier leaves it when it GIVES UP: fenced, still
 * `handoffReady`, and counting the handoff it never got compacted.
 *
 * @param name - the member's board name.
 * @param overrides - the fields this arm changes.
 * @returns the row.
 */
function fencedRow(name: string, overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return memberRow(name, { mode: "checkpoint", handoffReady: true, handoffs: 2, fenced: true, fencedReason: "no-engine; the reseed failed", ...overrides })
}

/**
 * A cell record with the given members, complete enough for the tools these arms call.
 *
 * @param members - the member table, keyed by the name the captain addresses.
 * @returns the record.
 */
function cellWith(members: Record<string, CellMemberRecord>): CellState {
  /** The fresh record, with this arm's members and the team the double answers for. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-04T12:00:00.000Z") })
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
 * The RAW member rows on disk — before the normalizer, so `"fenced" in row` is the assertion the
 * contract's "never write `fenced: false`" needs (the reader drops a false key either way).
 *
 * @param workspace - the workspace root.
 * @returns the persisted member table.
 */
function rawMembers(workspace: string): Record<string, Record<string, unknown>> {
  /** The record as the file holds it. */
  const parsed = JSON.parse(readFileSync(statePath(workspace, CELL_ID), "utf8")) as { members?: Record<string, Record<string, unknown>> }
  return parsed.members ?? {}
}

/**
 * Build the fake harness and install the protocol tools once.
 *
 * @param cell - the cell record to persist.
 * @param members - the live team roster rows.
 * @param tasks - the live board rows.
 * @param options - `unfenceSeam: false` hides the plane's optional `unfence` half (an older team-core).
 * @returns the harness.
 */
function makeHarness(cell: CellState, members: DoubleMember[], tasks: DoubleTask[], options: { unfenceSeam?: boolean } = {}): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-unfence-"))
  writeCell(workspace, cell)
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The live team record the double mutates. */
  const record: DoubleTeamRecord = { teamId: TEAM_ID, members, tasks }
  /** The shared plane double, bound to the SAME record `mpdTeams` answers. */
  const plane = createTeamActionsDouble({ record: () => record, send: (handle: string, text: string): void => { harness.sends.push({ handle, text }) } })
  /** The harness under construction, so the delivery seam can push into it at call time. */
  const harness: Harness = { workspace, captain, tools: new Map<string, CapturedTool>(), sends: [], record, plane }
  /** The plane surface this composition exposes: the optional `unfence` half is what an arm varies. */
  const planeService = options.unfenceSeam === false ? { dispatch: plane.service.dispatch } : plane.service
  /** The fake adapter: the registry, the root, the meter, the executor and the event registrations. */
  const adapter = {
    registerTool: (definition: CapturedTool): (() => void) => { harness.tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({
      send: async (_captain: unknown, handle: string, text: string): Promise<void> => { harness.sends.push({ handle, text }) },
    }),
    executeTool: async (): Promise<Record<string, unknown>> => ({ ok: true, isError: false, value: {} }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: {
      get: (name: string): unknown => name === "mpdTeamActions"
        ? planeService
        : name === "mpdTeams" ? { get: (): unknown => record } : undefined,
    },
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
 * @param agent - the calling agent (the captain unless an arm says otherwise).
 * @returns the tool's structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown>, agent?: FakeAgent): Promise<Record<string, unknown>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  /** The tool's answer, narrowed to a record. */
  const answer = await tool.execute(args, { name, agent: agent ?? harness.captain })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
}

test("B2: unfence removes both fence keys, restores `mode: member` and `handoffReady: false`, and keeps `handoffs`", async () => {
  /** The cell whose only member the barrier fenced. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer") })
  // THE TEAM ROW IS THE PRODUCTION HALF (repair round 3): the barrier never calls the plane's `fence`
  // verb, so a real give-up leaves `mode:"checkpoint"` and NO `fenced` key here. The CELL marker is the
  // give-up fact, and this arm pins that the clear does not depend on a manufactured TEAM flag.
  /** The harness whose TEAM row is the checkpoint window the handoff left behind. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [])
  /** The captain's unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  // THE ANSWER: one row per name, the cell row's fact and the plane's half as SEPARATE facts.
  expect(answer.unfenced).toEqual([{ member: "Senior Engineer", unfenced: true, plane: "unfenced" }])
  // THE PLANE'S HALF: the declared seam was called with the captain's own session.
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "Senior Engineer" }])
  expect(harness.record.members[0].fenced).toBeUndefined()
  expect(harness.record.members[0].fencedReason).toBeUndefined()
  expect(harness.record.members[0].mode).toBe("member")
  // THE CELL ROW: both keys are GONE from the file (removed, never `fenced: false`), the mode is back,
  // the barrier's waiting flag is cleared, and the handoff count is untouched.
  /** The raw persisted row. */
  const row = rawMembers(harness.workspace)["Senior Engineer"]
  expect("fenced" in row).toBe(false)
  expect("fencedReason" in row).toBe(false)
  expect(row.mode).toBe("member")
  expect(row.handoffReady).toBe(false)
  expect(row.handoffs).toBe(2)
  // THE JOURNAL: the act is recorded, once, with the plane's half attached.
  /** The unfence journal rows. */
  const rows = journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced")
  expect(rows).toHaveLength(1)
  expect(rows[0].member).toBe("Senior Engineer")
  expect(rows[0].plane).toBe("unfenced")
})

test("round 3: the PRODUCTION give-up shape — CELL `fenced:true`, TEAM `checkpoint` with NO `fenced` — is fully recovered", async () => {
  // WHAT THE BARRIER REALLY WRITES: `memberAfterBarrier` fences the CELL row (mode `checkpoint`,
  // `handoffReady:true`, `fenced:true`) and `writeMemberHandoff` leaves the TEAM row at
  // `mode:"checkpoint"` and NOTHING else. Round 2 gated the clear on a TEAM `fenced` flag that no shipped
  // code writes, so THIS state answered `checkpoint-pending` and the deadlock survived. This arm is the
  // one that sees it: the CELL marker alone must authorize the repair.
  /** The cell row exactly as the give-up leaves it. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer", { sessionId: "session-senior", executorRef: "session-senior" }) })
  /** The TEAM half of the same give-up: a checkpoint window with NO explicit fence. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "session-senior", mode: "checkpoint" }], [])
  /** The fenced member's own handle. */
  const member: FakeAgent = { id: "session-senior", session: { id: "session-senior", header: { cwd: harness.workspace } } }
  // BEFORE: the deadlock this wave removes — the fence blocks the member's own handoff.
  /** The handoff attempt the fence blocks. */
  const blocked = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, member)
  expect(blocked.ok).toBe(false)
  expect(String(blocked.error)).toContain("STILL WAITING for the compaction barrier")
  // THE LEVER: the CELL row's marker is the give-up fact, whatever the TEAM row says.
  /** The captain's unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  expect(answer.unfenced).toEqual([{ member: "Senior Engineer", unfenced: true, plane: "unfenced" }])
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "Senior Engineer" }])
  // THE PLANE HALF REOPENS THE TEAM SEAT: the plane treats `mode:"checkpoint"` as closed, so the seam
  // must clear it too — a cleared CELL row alone would leave the member unmessageable.
  expect(harness.record.members[0].mode).toBe("member")
  expect(harness.record.members[0].fenced).toBeUndefined()
  // THE CELL ROW: both keys deleted, the mode restored, the barrier's waiting flag cleared, count kept.
  /** The raw persisted row. */
  const row = rawMembers(harness.workspace)["Senior Engineer"]
  expect("fenced" in row).toBe(false)
  expect("fencedReason" in row).toBe(false)
  expect(row.mode).toBe("member")
  expect(row.handoffReady).toBe(false)
  expect(row.handoffs).toBe(2)
  // THE MEMBER CAN HAND OFF AGAIN: the call the deadlock refused now records ordinal 3.
  /** The handoff attempt after the unfence. */
  const written = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, member)
  expect(written.ok).toBe(true)
  expect(written.ordinal).toBe(3)
  expect(String(written.path).endsWith("Senior Engineer-3.md")).toBe(true)
  // THE DISCLOSURE: the description a model selects the tool by names the CELL marker as the give-up fact.
  expect(String(harness.tools.get("cellwork_dispatch")?.description)).toContain("GIVE-UP FACT")
})

test("round 3: the production give-up clears the CELL row but never claims the TEAM seat was reopened without a seam", async () => {
  /** The cell row exactly as the give-up leaves it. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer") })
  /** The production TEAM row (checkpoint, no fence) against an older team-core with no `unfence` seam. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { unfenceSeam: false })
  /** The captain's unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  /** The one outcome: the CELL half landed, the plane half is honestly absent. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.member).toBe("Senior Engineer")
  expect(outcome.unfenced).toBe(true)
  expect(outcome.plane).toBe("absent")
  expect(String(outcome.planeReason)).toContain("no mpdTeamActions.unfence seam")
  expect(String(outcome.planeReason)).toContain("NOT reopened")
  // THE FACTS: the CELL row is repaired; the TEAM seat keeps the checkpoint the barrier owns.
  expect(rawMembers(harness.workspace)["Senior Engineer"].handoffReady).toBe(false)
  expect(harness.record.members[0].mode).toBe("checkpoint")
  expect(harness.record.members[0].fenced).toBeUndefined()
})

test("B2: a member that is not fenced answers `not-fenced` and the record is never rewritten", async () => {
  /** The cell whose member still waits for an ordinary barrier (no give-up marker). */
  const cell = cellWith({ Reviewer: memberRow("Reviewer", { handoffReady: true, handoffs: 1 }) })
  /** The harness with a healthy TEAM row. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Reviewer", status: "running", executorRef: "handle-Reviewer" }], [])
  /** The record as it stood before the call, byte for byte. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence of a member with nothing to clear. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Reviewer"] })
  expect(answer.ok).toBe(true)
  // HONEST, NOT A SILENT SUCCESS: the row says what happened and names the reason the contract fixes.
  expect(answer.unfenced).toEqual([{ member: "Reviewer", unfenced: false, reason: "not-fenced" }])
  // NOTHING WAS ASKED OF THE PLANE, and the cell record was not touched (its waiting handoff stays).
  expect(harness.plane.fences).toHaveLength(0)
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
  /** The persisted row, so the waiting flag is asserted where the next reader will see it. */
  const row = rawMembers(harness.workspace).Reviewer
  expect(row.handoffReady).toBe(true)
  expect(journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced")).toHaveLength(0)
})

test("B2: an unknown name is refused in the teaching style, naming the recorded members, and nothing changes", async () => {
  /** The cell whose recorded members the refusal must name. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer"), Reviewer: memberRow("Reviewer") })
  /** The harness. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true }], [])
  /** The record as it stood before the call. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence of a name no row holds. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Ghost"] })
  expect(answer.ok).toBe(false)
  /** The refusal sentence: the name, then the members a reader can pick from. */
  const error = String(answer.error)
  expect(error).toContain("\"Ghost\"")
  expect(error).toContain("(members: ")
  expect(error).toContain("Senior Engineer")
  expect(error).toContain("Reviewer")
  // NOTHING RAN: no fence cleared, no pass asked of the plane, no record written.
  expect(harness.plane.fences).toHaveLength(0)
  expect(harness.plane.dispatches).toHaveLength(0)
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
  expect(rawMembers(harness.workspace)["Senior Engineer"].fenced).toBe(true)
})

test("B2: the plane seam clears the TEAM row when present, and its ABSENCE is reported instead of pretended", async () => {
  // ARM 1 — the seam is present: the TEAM row's fence is gone.
  /** The cell whose member the barrier fenced. */
  const withSeam = cellWith({ "Senior Engineer": fencedRow("Senior Engineer") })
  /** The harness whose composition exposes `unfence`. */
  const cleared = makeHarness(withSeam, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true }], [], { unfenceSeam: true })
  /** The captain's unfence. */
  const first = await runTool(cleared, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(first.ok).toBe(true)
  expect((first.unfenced as Array<Record<string, unknown>>)[0].plane).toBe("unfenced")
  expect(cleared.record.members[0].fenced).toBeUndefined()
  // ARM 2 — the seam is ABSENT (an older team-core): the cell row is still repaired, and the answer says
  // what did NOT happen rather than reporting a success the TEAM row cannot back.
  /** A fresh cell, so the second arm starts from a fenced row. */
  const withoutSeam = cellWith({ "Senior Engineer": fencedRow("Senior Engineer") })
  /** The harness whose composition has `dispatch` but no `unfence`. */
  const absent = makeHarness(withoutSeam, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true }], [], { unfenceSeam: false })
  /** The captain's unfence against the older plane. */
  const second = await runTool(absent, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(second.ok).toBe(true)
  /** The absent-seam answer row. */
  const outcome = (second.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.member).toBe("Senior Engineer")
  expect(outcome.unfenced).toBe(true)
  expect(outcome.plane).toBe("absent")
  expect(String(outcome.planeReason)).toContain("no mpdTeamActions.unfence seam")
  // THE HONEST HALF: the cell row reopened, the TEAM row still carries the fence.
  expect(rawMembers(absent.workspace)["Senior Engineer"].handoffReady).toBe(false)
  expect(absent.record.members[0].fenced).toBe(true)
  expect(absent.record.members[0].mode).toBe("checkpoint")
})

test("B2: `unfence` and `reassign` travel in one call and both take effect", async () => {
  /** The cell whose fenced owner still holds the row, beside a healthy member. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer"), Reviewer: memberRow("Reviewer") })
  /** The harness whose board holds one pending row for the fenced owner. */
  const harness = makeHarness(cell, [
    { id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" },
    { id: "M2", name: "Reviewer", status: "running", executorRef: "handle-Reviewer" },
  ], [{ id: "T1", subject: "widget work", status: "pending", owner: "Senior Engineer", blockedBy: [] }])
  /** The one call that both repairs the seat and moves its row. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"], reassign: [{ task_id: "T1", owner: "Reviewer" }] })
  expect(answer.ok).toBe(true)
  // BOTH HALVES LANDED: the fence is clear and the row moved to the member that can work it.
  expect((answer.unfenced as Array<Record<string, unknown>>)[0]).toEqual({ member: "Senior Engineer", unfenced: true, plane: "unfenced" })
  /** The hand-over outcome the plane reported. */
  const handover = (answer.reassigned as Array<Record<string, unknown>>)[0]
  expect(handover.taskId).toBe("T1")
  expect(handover.owner).toBe("Reviewer")
  expect(handover.claimed).toBe(true)
  expect(handover.delivered).toBe(true)
  expect(harness.sends).toHaveLength(1)
  expect(harness.sends[0].handle).toBe("handle-Reviewer")
  expect(harness.sends[0].text).toContain("T1")
  // NEITHER INTERFERED: the cell row is reopened and the journal carries BOTH acts.
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("member")
  expect("fenced" in rawMembers(harness.workspace)["Senior Engineer"]).toBe(false)
  /** The journal's event names. */
  const events = journalRows(harness.workspace, CELL_ID).map((entry) => String(entry.event))
  expect(events).toContain("member-unfenced")
  expect(events).toContain("dispatch-reassign")
})

test("B2: the unfence clears the exact refusal the deadlock produced, and the member can hand off again", async () => {
  /** The cell whose member wrote a handoff the barrier then gave up on. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer", { sessionId: "session-senior", executorRef: "session-senior" }) })
  /** The harness whose TEAM row the plane's own handoff verb resolves by `executorRef`. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "session-senior", mode: "checkpoint", fenced: true }], [])
  /** The fenced member's own handle. */
  const member: FakeAgent = { id: "session-senior", session: { id: "session-senior", header: { cwd: harness.workspace } } }
  // BEFORE: the deadlock, named by the tool the member must call.
  /** The handoff attempt the fence blocks. */
  const blocked = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, member)
  expect(blocked.ok).toBe(false)
  expect(String(blocked.error)).toContain("STILL WAITING for the compaction barrier")
  // THE REPAIR: one captain call, no barrier required.
  /** The captain's unfence. */
  const unfenced = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(unfenced.ok).toBe(true)
  // AFTER: the SAME call that was refused now records the handoff (ordinal 3 = the two it already wrote
  // plus this one), which is what "the lever removes the deadlock" means for the member.
  /** The handoff attempt after the unfence. */
  const written = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, member)
  expect(written.ok).toBe(true)
  expect(written.ordinal).toBe(3)
  // The CELL's own document is ordinal 3 (the count it kept through the unfence), and the plane's
  // handoff seam was asked to close the seat — the two writes the verb documents.
  expect(String(written.path).endsWith("Senior Engineer-3.md")).toBe(true)
  expect(harness.plane.handoffs).toHaveLength(1)
  /** The cell row's mirror, written only after the plane accepted the record. */
  const row = rawMembers(harness.workspace)["Senior Engineer"]
  expect(row.handoffReady).toBe(true)
  expect(row.handoffs).toBe(3)
})

test("B2: refusal after an unfence still reports the act, and the tool DESCRIPTION declares the argument", async () => {
  /** The cell whose fenced owner this call repairs before the pass is refused. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer") })
  /** The harness whose plane will reject the MALFORMED `reassign` this call carries. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true }], [])
  /** One call carrying a well-formed unfence and an unreadable hand-over. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"], reassign: [{ task_id: "T1", owner: "" }] })
  // THE PASS IS REFUSED BY THE PLANE'S OWN SENTENCE …
  expect(answer.ok).toBe(false)
  expect(String(answer.error)).toContain("every `reassign` entry needs a non-empty `task_id` and `owner`")
  // … AND THE SIDE EFFECT IS NOT SILENT: the unfence row rides the failure envelope, and the file agrees.
  expect((answer.unfenced as Array<Record<string, unknown>>)[0]).toEqual({ member: "Senior Engineer", unfenced: true, plane: "unfenced" })
  expect("fenced" in rawMembers(harness.workspace)["Senior Engineer"]).toBe(false)
  expect(journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced")).toHaveLength(1)
  // THE DISCLOSURE the model selects the tool by: the argument is in the schema, and the description
  // names what it does (contract B2's tool-description requirement).
  /** The registered definition. */
  const tool = harness.tools.get("cellwork_dispatch")
  expect(tool?.parameters?.properties?.unfence).toBeDefined()
  expect(String(tool?.description)).toContain("`unfence` clears")
  expect(String(tool?.description)).toContain("not-fenced")
})

test("finding 2: a fence recorded ONLY on the TEAM record is cleared through the seam, and the CELL row is untouched", async () => {
  /** The cell whose row carries NO fence marker — the plane's fence was never mirrored into it. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer") })
  /** The harness whose TEAM row is the only place the fence exists. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true, fencedReason: "no-engine" }], [])
  /** The record as it stood before the call, so a rewritten row shows up byte for byte. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence of a seat the CELL row never marked. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  // HONEST: the cell row was NOT rewritten, and the answer says so while reporting the plane's half.
  expect(answer.unfenced).toEqual([{ member: "Senior Engineer", unfenced: true, cellRow: "untouched", plane: "unfenced" }])
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "Senior Engineer" }])
  expect(harness.record.members[0].fenced).toBeUndefined()
  expect(harness.record.members[0].mode).toBe("member")
  // THE CELL ROW: untouched — no marker existed to remove, and none was invented.
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
})

test("finding 2: a team-only fence with NO seam is reported as still fenced, and the CELL row stays untouched", async () => {
  /** The cell whose row carries no fence marker. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer") })
  /** The harness whose older team-core exposes `dispatch` but not `unfence`. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true }], [], { unfenceSeam: false })
  /** The record as it stood before the call. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence against the older plane. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  /** The outcome: nothing was cleared, and the answer names the half that could not be. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.member).toBe("Senior Engineer")
  expect(outcome.unfenced).toBe(false)
  expect(outcome.cellRow).toBe("untouched")
  expect(outcome.plane).toBe("absent")
  expect(String(outcome.planeReason)).toContain("no mpdTeamActions.unfence seam")
  // THE FACTS: the plane seam is absent, the TEAM row is still fenced, the CELL row was never rewritten.
  expect(harness.record.members[0].fenced).toBe(true)
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
})

test("finding 3: a row written while the plane call is awaited survives the unfence write", async () => {
  /** The cell whose fenced row is cleared by this call. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer") })
  /** The harness whose plane seam will write a concurrent row WHILE the verb is suspended. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint", fenced: true }], [])
  /** The seam the plugin will call, wrapped so another writer lands during the await. */
  const seam = harness.plane.service.unfence
  harness.plane.service.unfence = async (input: Record<string, unknown>): Promise<Record<string, any>> => {
    /** The record as the OTHER writer sees it mid-await. */
    const live = readCell(harness.workspace, CELL_ID)
    if (live.ok) writeCell(harness.workspace, { ...live.state, members: { ...live.state.members, Reviewer: memberRow("Reviewer", { handoffs: 4 }) } })
    return await seam(input)
  }
  /** The captain's unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  // THE MERGE STARTED FROM A FRESH READ: the row written during the await is still there, with its data.
  /** The persisted members after the call. */
  const persisted = rawMembers(harness.workspace)
  expect(persisted.Reviewer).toBeDefined()
  expect(persisted.Reviewer.handoffs).toBe(4)
  // … and the fence the call was asked to clear is gone from the same record.
  expect("fenced" in persisted["Senior Engineer"]).toBe(false)
  expect(persisted["Senior Engineer"].handoffReady).toBe(false)
})

test("finding 4: an exact name wins over the normalized key — two non-ASCII names never collide", async () => {
  /** The cell whose two names both normalize to the EMPTY key (`nameKey` is ASCII-only). */
  const cell = cellWith({ "工程师甲": fencedRow("工程师甲"), "工程师乙": fencedRow("工程师乙") })
  /** The harness whose TEAM rows carry the same two fences. */
  const harness = makeHarness(cell, [
    { id: "M1", name: "工程师甲", status: "running", executorRef: "handle-工程师甲", mode: "checkpoint", fenced: true },
    { id: "M2", name: "工程师乙", status: "running", executorRef: "handle-工程师乙", mode: "checkpoint", fenced: true },
  ], [])
  /** The captain's unfence of the SECOND name. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["工程师乙"] })
  expect(answer.ok).toBe(true)
  // THE EXACT ROW WAS CLEARED — not the first member whose key also normalizes to "".
  expect(answer.unfenced).toEqual([{ member: "工程师乙", unfenced: true, plane: "unfenced" }])
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "工程师乙" }])
  /** The persisted members after the call. */
  const persisted = rawMembers(harness.workspace)
  expect("fenced" in persisted["工程师乙"]).toBe(false)
  expect(persisted["工程师甲"].fenced).toBe(true)
  expect(harness.record.members[0].fenced).toBe(true)
  expect(harness.record.members[1].fenced).toBeUndefined()
})

test("finding A: a PENDING checkpoint is not a give-up — `checkpoint-pending`, and neither record is written", async () => {
  // THE STATE EVERY HANDOFF LEAVES: the real plane sets `mode:"checkpoint"` on each handoff while the
  // compaction barrier still owes the reopen, and that row carries NO `fenced` key.
  /** The cell row a handoff leaves behind: waiting for its barrier, no give-up marker. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 1 }) })
  /** The harness whose TEAM row is exactly that pending checkpoint. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [])
  /** The record as it stood before the call, so any write shows up byte for byte. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence of a seat whose barrier has not given up. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  /** The one outcome, read as a record so each fact is asserted separately. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.member).toBe("Senior Engineer")
  // HONEST AND DISTINCT: this is not `not-fenced` (a fence DOES exist) and not a success.
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("checkpoint-pending")
  expect(String(outcome.detail)).toContain("compaction barrier")
  // NOTHING WAS ASKED OF THE PLANE, and NEITHER record was written.
  expect(harness.plane.fences).toHaveLength(0)
  expect(harness.record.members[0].mode).toBe("checkpoint")
  expect(harness.record.members[0].fenced).toBeUndefined()
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
  expect(journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced")).toHaveLength(0)
})

test("finding B: 后端1 and 前端1 both normalize to `1`, and the exact name clears only its own seat", async () => {
  /** The cell whose two CJK+digit names share one normalized key. */
  const cell = cellWith({ "后端1": fencedRow("后端1"), "前端1": fencedRow("前端1") })
  /** The harness whose TEAM rows carry the same two give-up fences. */
  const harness = makeHarness(cell, [
    { id: "M1", name: "后端1", status: "running", executorRef: "handle-后端1", mode: "checkpoint", fenced: true },
    { id: "M2", name: "前端1", status: "running", executorRef: "handle-前端1", mode: "checkpoint", fenced: true },
  ], [])
  /** The captain's unfence of the SECOND name. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["前端1"] })
  expect(answer.ok).toBe(true)
  // THE EXACT ROW WAS CLEARED, and the plane was asked about that same seat only.
  expect(answer.unfenced).toEqual([{ member: "前端1", unfenced: true, plane: "unfenced" }])
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "前端1" }])
  /** The persisted members after the call. */
  const persisted = rawMembers(harness.workspace)
  expect("fenced" in persisted["前端1"]).toBe(false)
  expect(persisted["后端1"].fenced).toBe(true)
  expect(harness.record.members[0].fenced).toBe(true)
  expect(harness.record.members[1].fenced).toBeUndefined()
})

test("finding B: an ambiguous normalized lookup refuses the WHOLE call instead of guessing", async () => {
  /** The cell whose two names both normalize to `1`; `1` names neither exactly. */
  const cell = cellWith({ "后端1": fencedRow("后端1"), "前端1": fencedRow("前端1") })
  /** The harness whose TEAM rows carry both fences. */
  const harness = makeHarness(cell, [
    { id: "M1", name: "后端1", status: "running", executorRef: "handle-后端1", mode: "checkpoint", fenced: true },
    { id: "M2", name: "前端1", status: "running", executorRef: "handle-前端1", mode: "checkpoint", fenced: true },
  ], [])
  /** The record as it stood before the call. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's ambiguous unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["1"] })
  expect(answer.ok).toBe(false)
  /** The refusal sentence, which must teach both candidate names. */
  const error = String(answer.error)
  expect(error).toContain("\"1\"")
  expect(error).toContain("后端1")
  expect(error).toContain("前端1")
  // NOTHING RAN: no fence cleared, no pass asked of the plane, no record written.
  expect(harness.plane.fences).toHaveLength(0)
  expect(harness.plane.dispatches).toHaveLength(0)
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
  expect(rawMembers(harness.workspace)["后端1"].fenced).toBe(true)
  expect(rawMembers(harness.workspace)["前端1"].fenced).toBe(true)
})

test("finding B: `unfence:[\"运维1\"]` (absent) is refused and nothing is cleared", async () => {
  /** The cell whose two names make the absent spelling normalize onto their shared key. */
  const cell = cellWith({ "后端1": fencedRow("后端1"), "前端1": fencedRow("前端1") })
  /** The harness whose TEAM rows carry both fences. */
  const harness = makeHarness(cell, [
    { id: "M1", name: "后端1", status: "running", executorRef: "handle-后端1", mode: "checkpoint", fenced: true },
    { id: "M2", name: "前端1", status: "running", executorRef: "handle-前端1", mode: "checkpoint", fenced: true },
  ], [])
  /** The record as it stood before the call. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence of a name NO member carries. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["运维1"] })
  expect(answer.ok).toBe(false)
  expect(String(answer.error)).toContain("\"运维1\"")
  // A MISSING NAME IS NOT A REASON TO GUESS: neither collision is cleared and nothing is written.
  expect(harness.plane.fences).toHaveLength(0)
  expect(harness.plane.dispatches).toHaveLength(0)
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
  expect(rawMembers(harness.workspace)["后端1"].fenced).toBe(true)
  expect(rawMembers(harness.workspace)["前端1"].fenced).toBe(true)
})

test("round 4: a member named twice is unfenced ONCE — one outcome, one seam call, one journal row", async () => {
  // THE PRODUCTION GIVE-UP SHAPE, named twice in one call: the resolution loop used to push a target per
  // SPELLING, so the same recorded key produced two outcomes, two plane seam calls and two
  // `member-unfenced` journal rows while the record write stayed deduped by `clearedRows` — a report that
  // claimed to have cleared the same fence twice and a plane asked to reopen an already-open seat.
  /** The cell whose only member the barrier fenced. */
  const cell = cellWith({ "Senior Engineer": fencedRow("Senior Engineer", { sessionId: "session-senior", executorRef: "session-senior" }) })
  /** The harness whose TEAM row is the checkpoint half of the same give-up. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "session-senior", mode: "checkpoint" }], [])
  /** The captain's duplicated unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer", "Senior Engineer"] })
  expect(answer.ok).toBe(true)
  expect(answer.unfenced).toEqual([{ member: "Senior Engineer", unfenced: true, plane: "unfenced" }])
  // ONE SEAM CALL, ONE JOURNAL ROW: the duplicate spelling is resolved away BEFORE anything is processed.
  expect(harness.plane.fences).toHaveLength(1)
  expect(journalRows(harness.workspace, CELL_ID).filter((row) => row.event === "member-unfenced")).toHaveLength(1)
})
