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
  /** The output declaration, whose render is the text a model reads. */
  output?: { render?: (args: unknown, value: unknown) => unknown }
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
function makeHarness(cell: CellState, members: DoubleMember[], tasks: DoubleTask[], options: { unfenceSeam?: boolean; liveSessions?: readonly string[]; agentsRegistry?: boolean } = {}): Harness {
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
    // THE LIVENESS SEAM (R4.2/R4.4): an arm names the sessions the registry still holds. `undefined` here
    // models the older composition whose identity seam answers nothing — which is UNKNOWN, never "dead",
    // and is exactly the case a forced clear is allowed on.
    ...(options.liveSessions === undefined ? {} : { liveAgentExact: (id: string): Record<string, unknown> | undefined => options.liveSessions?.includes(id) === true ? { id } : undefined }),
    // THE PRESENCE PROBE: `false` models a composition with no agents registry at all.
    capabilities: (): Record<string, unknown> => ({ agents: options.agentsRegistry !== false }),
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

/**
 * The text a model reads for one answer, through the definition's own renderer.
 *
 * @param harness - the harness that captured the definition.
 * @param name - the tool name.
 * @param answer - the structured answer to render.
 * @returns the rendered text, blocks joined by newlines.
 */
function renderTool(harness: Harness, name: string, answer: unknown): string {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  /** The formatter the definition declares. */
  const render = tool?.output?.render
  if (render === undefined) throw new Error("no renderer on " + name)
  /** The formatter's answer. */
  const blocks = render({}, answer)
  return Array.isArray(blocks) ? blocks.map((block) => String((block as { text?: unknown }).text ?? "")).join("\n") : String(blocks)
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

test("B2/R4.4: a WAITING handoff is the barrier's window, so it answers `checkpoint-pending` — never `not-fenced`", async () => {
  // THE CELL ROW'S `handoffReady` IS THE BARRIER'S WINDOW ONE RECORD OVER (R4.4): a member that wrote its
  // handoff and still waits for the barrier is CLOSED to dispatch, so `not-fenced` was the second
  // contradictory answer this repair removes. The seat is barrier-owned and nothing is written.
  /** The cell whose member still waits for an ordinary barrier (no give-up marker). */
  const cell = cellWith({ Reviewer: memberRow("Reviewer", { handoffReady: true, handoffs: 1 }) })
  /** The harness with a healthy TEAM row. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Reviewer", status: "running", executorRef: "handle-Reviewer" }], [])
  /** The record as it stood before the call, byte for byte. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The captain's unfence of a member with nothing to clear. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Reviewer"] })
  expect(answer.ok).toBe(true)
  // HONEST, NOT A SILENT SUCCESS: the row says the barrier owns the window and that nothing was cleared.
  expect((answer.unfenced as Array<Record<string, unknown>>)[0]).toMatchObject({ member: "Reviewer", unfenced: false, reason: "checkpoint-pending" })
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


// ── R4.4: the bounded FORCED lever ────────────────────────────────────────

test("R4.4: a CELL-only checkpoint answers `checkpoint-pending`, never the false `not-fenced`", async () => {
  // THE SHAPE THE OLD PREDICATE MISSED: the CELL row is at `checkpoint` with `handoffReady:true` while the
  // TEAM row still reads `mode:"member"` (a plane write that has not landed yet). The old branch read the
  // TEAM row alone, fell through every case, and answered `not-fenced` for a seat the guard fences.
  /** The barrier-owned CELL row, with NO fence marker anywhere. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 1 }) })
  /** The harness whose TEAM row has not caught up with the checkpoint yet. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "member" }], [])
  /** The captain's UNFORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  /** The one outcome: the barrier owns the window, and nothing was written. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("checkpoint-pending")
  // NEITHER RECORD WAS WRITTEN AND THE SEAM WAS NOT CALLED: the barrier owns this state.
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("checkpoint")
  expect(harness.record.members[0].mode).toBe("member")
})

test("R4.4: a bare STRING never forces — an old window alone does not clear a barrier-owned seat", async () => {
  // The bound is only reachable through the object form. This seat is well past the pending bound, and the
  // bare string still answers `checkpoint-pending`: a caller cannot force by accident.
  /** The barrier-owned seat, its window opened long before the call. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 2, checkpointSince: "2026-11-04T10:00:00.000Z" }) })
  /** The TEAM row of the same window. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [])
  /** The captain's bare-string unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  expect(answer.ok).toBe(true)
  expect((answer.unfenced as Array<Record<string, unknown>>)[0].reason).toBe("checkpoint-pending")
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("checkpoint")
})

test("R4.4: `{member, force:true}` reopens a barrier-owned seat once the window is STALE", async () => {
  // THE DEAD SEAT R4.4 EXISTS FOR: no live session (the harness proves none), a window opened 20 minutes
  // ago, no recorded barrier failures. The written bound is the STALENESS one.
  /** The stuck seat: checkpointed 20 minutes before the call, with one handoff already written. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 2, checkpointSince: "2026-11-04T11:40:00.000Z" }) })
  /** The harness whose registry can prove nothing is live (an absent identity seam), with a plane seam. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: ["session-someone-else"] })
  /** The captain's FORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect(answer.ok).toBe(true)
  /** The one outcome: the CELL row was reopened, and the answer names the liveness and the bound. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.member).toBe("Senior Engineer")
  expect(outcome.unfenced).toBe(true)
  expect(outcome.forced).toBe(true)
  expect(outcome.alive).toBe(false)
  expect(outcome.sessionId).toBe("session-Senior Engineer")
  expect(outcome.bound).toBe("stale")
  expect(Number(outcome.pendingMs)).toBeGreaterThanOrEqual(900000)
  expect(outcome.plane).toBe("unfenced")
  // THE CELL WRITE: open for reassignment, both window keys removed, the counts KEPT.
  /** The raw persisted row. */
  const row = rawMembers(harness.workspace)["Senior Engineer"]
  expect(row.mode).toBe("member")
  expect(row.handoffReady).toBe(false)
  expect("fenced" in row).toBe(false)
  expect("fencedReason" in row).toBe(false)
  expect("checkpointSince" in row).toBe(false)
  expect("barrierFailures" in row).toBe(false)
  expect(row.handoffs).toBe(2)
  // THE PLANE HALF AND THE JOURNAL ROW ARE BOTH FACTS.
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "Senior Engineer" }])
  expect(harness.record.members[0].mode).toBe("member")
  /** The forced journal rows. */
  const forced = journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced-forced")
  expect(forced).toHaveLength(1)
  expect(forced[0].member).toBe("Senior Engineer")
  expect(forced[0].by).toBe("captain")
  expect(forced[0].reason).toBe("stale")
  expect(forced[0].plane).toBe("unfenced")
  expect(Number(forced[0].pendingMs)).toBeGreaterThanOrEqual(900000)
  expect(forced[0].barrierFailures).toBe(0)
  // THE RENDER SAYS WHAT THE SEAT IS NOW: reopened for reassignment, NOT for work — its context was
  // never compacted, so a message would resume a context the handoff document already describes.
  const text = renderTool(harness, "cellwork_dispatch", answer)
  expect(text).toContain("FORCED")
  expect(text).toContain("reopened for reassignment, not for work")
})

test("R4.4: the RETRY BUDGET is the other bound — a fresh window with a spent budget is reopened", async () => {
  // The failure counter and the clock are SEPARATE bounds: a seat the barrier failed on three times is
  // eligible even though its window was opened seconds ago.
  /** The stuck seat: three non-reopening barrier runs, a window opened one second ago. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 3, checkpointSince: new Date(Date.now() - 1000).toISOString(), barrierFailures: 3 }) })
  /** The harness with no provable liveness. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: [] })
  /** The captain's FORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  /** The one outcome: the retry budget authorised the clear. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(true)
  expect(outcome.bound).toBe("retry-budget")
  expect(harness.plane.fences).toHaveLength(1)
  /** The forced journal row quotes the budget it used. */
  const forced = journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced-forced")
  expect(forced[0].reason).toBe("retry-budget")
  expect(forced[0].barrierFailures).toBe(3)
})

test("R4.4 NEGATIVE: force on a LIVE seat writes NOTHING and refuses", async () => {
  // A live seat is not dead: the identity seam answers an agent, so the forced lever must refuse outright
  // — even though the window is stale and the budget is spent.
  /** The stuck-looking seat whose recorded session is still a live agent. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 3, checkpointSince: "2026-11-04T09:00:00.000Z", barrierFailures: 9 }) })
  /** The harness whose registry holds that exact session id. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: ["session-Senior Engineer"] })
  /** The captain's FORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect(answer.ok).toBe(true)
  /** The refusal, with the liveness fact the predicate used. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("live-session")
  expect(outcome.alive).toBe(true)
  expect(outcome.sessionId).toBe("session-Senior Engineer")
  // NOTHING WAS WRITTEN, NOWHERE.
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("checkpoint")
  expect(harness.record.members[0].mode).toBe("checkpoint")
  expect(journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced-forced")).toHaveLength(0)
})

test("R4.4 NEGATIVE: a FRESH window with ZERO failures writes NOTHING", async () => {
  // A bare force on a seat that just entered the window is not a licence: neither bound is reached.
  /** The seat that entered the window one second ago. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, checkpointSince: new Date(Date.now() - 1000).toISOString() }) })
  /** The harness with no provable liveness. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: [] })
  /** The captain's FORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  /** The refusal: no written bound was reached. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("force-not-eligible")
  expect(Number(outcome.pendingMs)).toBeLessThan(900000)
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("checkpoint")
})

test("R4.4 NEGATIVE: a MISSING timestamp is not a licence", async () => {
  // No `checkpointSince` and no `cell.checkpoints` entry for the session: nothing can be measured, so the
  // fail-closed predicate refuses instead of reading the absence as "infinitely old".
  /** The seat with no recorded window at all. */
  const cell = cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true }) })
  /** The harness with no provable liveness. */
  const harness = makeHarness(cell, [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: [] })
  /** The captain's FORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  /** The refusal names the missing fact. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("force-not-eligible")
  expect(outcome.pendingMs).toBeUndefined()
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("checkpoint")
})

// ── R5.2: the dead-reseed seat, ONE predicate, and the plain negatives ──────

/** One dead-reseed seat: the row a reseed leaves when the fresh child never came up. */
function deadReseedRow(overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return memberRow("Senior Engineer", { mode: "subcaptain", handoffReady: false, handoffs: 2, sessionId: "session-dead-child", checkpointSince: new Date(Date.now() - 60000).toISOString(), barrierFailures: 1, ...overrides })
}

/** The TEAM row of the same dead-reseed seat: R4.1 reopened it to `member`, so no checkpoint spelling is left. */
const DEAD_RESEED_ROSTER: DoubleMember[] = [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "member" }]

test("R5.2 INCIDENT: a reseeded seat whose child is DEAD is force-clearable — `bound:dead-session`", async () => {
  // THE INCIDENT'S EXACT SHAPE: `mode:"subcaptain"`, `handoffReady:false`, the TEAM row reopened to
  // `member` — so `barrierOwned` is FALSE — and a recorded session the registry PROVES dead. The window is
  // FRESH (one minute) and the failure count is 1 of 3, so NEITHER written clock bound is reachable: no
  // live agent is left to drive the turn a barrier would fire on, and the seat could never reopen. The
  // forced lever answered `not-fenced` for this seat; the proven-dead session is now its licence.
  // THE ANCHOR IS WHAT MAKES `dead` PROVABLE (R7.3): the registry resolves the CAPTAIN's own session, so
  // its silence about the recorded child is a fact about that child.
  /** The harness whose registry is PRESENT, resolves the captain, and holds nothing under the recorded id. */
  const harness = makeHarness(cellWith({ "Senior Engineer": deadReseedRow() }), DEAD_RESEED_ROSTER, [], { liveSessions: [CAPTAIN_SESSION] })
  /** The captain's FORCED unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect(answer.ok).toBe(true)
  /** The one outcome. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(true)
  expect(outcome.forced).toBe(true)
  expect(outcome.bound).toBe("dead-session")
  expect(outcome.liveness).toBe("dead")
  // THE CELL WRITE: open for reassignment, the window keys gone, the counts kept.
  /** The raw persisted row. */
  const row = rawMembers(harness.workspace)["Senior Engineer"]
  expect(row.mode).toBe("member")
  expect(row.handoffReady).toBe(false)
  expect("checkpointSince" in row).toBe(false)
  expect("barrierFailures" in row).toBe(false)
  expect(row.handoffs).toBe(2)
  // BOTH HALVES AND THE JOURNAL ROW ARE FACTS.
  expect(harness.plane.fences).toEqual([{ sessionId: CAPTAIN_SESSION, member: "Senior Engineer" }])
  expect(harness.record.members[0].mode).toBe("member")
  /** The forced journal rows. */
  const forced = journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced-forced")
  expect(forced).toHaveLength(1)
  expect(forced[0].reason).toBe("dead-session")
  expect(forced[0].liveness).toBe("dead")
})

test("R5.2: the SAME dead-reseed seat answers `checkpoint-pending` UNFORCED and writes nothing", async () => {
  // THE FROZEN INVARIANT: an unforced clear never touches a held seat — the dead-reseed shape included.
  // Only the explicit `force` lever clears it.
  /** The incident's seat, unforced; the registry resolves the captain so the dead child is provable. */
  const harness = makeHarness(cellWith({ "Senior Engineer": deadReseedRow() }), DEAD_RESEED_ROSTER, [], { liveSessions: [CAPTAIN_SESSION] })
  /** The captain's bare-string unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  /** The one outcome. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("checkpoint-pending")
  expect(outcome.barrierOwned).toBe(false)
  expect(outcome.suspect).toBe(true)
  // NOTHING WAS WRITTEN, NOWHERE — and the seam was never called.
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("subcaptain")
  expect(harness.record.members[0].mode).toBe("member")
  // THE RENDER NAMES THE SHAPE, not a barrier that cannot come: the dead-reseed seat is told apart from
  // the pending window, and the lever that does work is named.
  /** The text a model reads for the same answer. */
  const text = renderTool(harness, "cellwork_dispatch", answer)
  expect(text).toContain("DEAD-RESEED")
  expect(text).toContain("force:true")
})

test("R9.1: an EMPTY recorded session answers `unknown`, never a proven-dead child", async () => {
  // THE ANCHOR RESOLVES HERE, so before R9.1 the registry's silence about the EMPTY id read as a DEAD
  // child: the sweep flagged `suspect`, the unforced verb answered `checkpoint-pending`, and the forced
  // lever cleared the seat under `bound:"dead-session"`. An empty id names no session at all, so nothing
  // about it can be proven: `unknown` is answered BEFORE the anchor check, licensing nothing.
  /** The dead-reseed shape with its recorded session id EMPTY while the anchor resolves. */
  const cell = cellWith({ "Senior Engineer": deadReseedRow({ sessionId: "" }) })
  /** The harness whose registry resolves the captain and holds nothing under the empty id. */
  const harness = makeHarness(cell, DEAD_RESEED_ROSTER, [], { liveSessions: [CAPTAIN_SESSION] })
  /** The read-only sweep the captain consults first. */
  const sweep = await runTool(harness, "cellwork_supervise", {})
  /** The sweep's measurement of the seat. */
  const measured = (sweep.members as Array<Record<string, unknown>>).find((entry) => entry.name === "Senior Engineer")
  expect(measured?.liveness).toBe("unknown")
  expect(measured !== undefined && "suspect" in measured).toBe(false)
  // THE UNFORCED VERB: not held, so no `checkpoint-pending` and no `suspect` either.
  /** The captain's bare-string unfence. */
  const plain = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  /** The plain outcome. */
  const plainOutcome = (plain.unfenced as Array<Record<string, unknown>>)[0]
  expect(plainOutcome.unfenced).toBe(false)
  expect(plainOutcome.reason).toBe("not-fenced")
  expect("suspect" in plainOutcome).toBe(false)
  // THE FORCED LEVER: `unknown` supplies no `dead-session` licence, so nothing is written anywhere.
  /** The captain's FORCED unfence. */
  const forced = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  /** The forced outcome. */
  const forcedOutcome = (forced.unfenced as Array<Record<string, unknown>>)[0]
  expect(forcedOutcome.unfenced).toBe(false)
  expect(forcedOutcome.reason).toBe("not-fenced")
  expect("bound" in forcedOutcome).toBe(false)
  expect(harness.plane.fences).toHaveLength(0)
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("subcaptain")
  expect(journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced-forced")).toHaveLength(0)
})

test("R5.2 NEGATIVE: the dead-reseed shape still refuses a LIVE seat, a stamp-less row and an unproven registry", async () => {
  // 1. A LIVE seat vetoes the clear: the barrier-owned row whose recorded session is still an agent.
  /** The stalled-looking window whose session the registry still holds. */
  const live = makeHarness(cellWith({ "Senior Engineer": memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, checkpointSince: "2026-11-04T09:00:00.000Z", barrierFailures: 9 }) }), [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: ["session-Senior Engineer"] })
  /** The forced request. */
  const liveAnswer = await runTool(live, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect((liveAnswer.unfenced as Array<Record<string, unknown>>)[0].reason).toBe("live-session")
  expect(live.plane.fences).toHaveLength(0)
  // 1b. A HEALTHY `subcaptain` (its child IS live) is not a held seat at all: `not-fenced`, not a clear.
  /** The same post-reseed row with a live child. */
  const healthy = makeHarness(cellWith({ "Senior Engineer": deadReseedRow() }), DEAD_RESEED_ROSTER, [], { liveSessions: ["session-dead-child"] })
  /** The forced request. */
  const healthyAnswer = await runTool(healthy, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect((healthyAnswer.unfenced as Array<Record<string, unknown>>)[0].reason).toBe("not-fenced")
  expect(healthy.plane.fences).toHaveLength(0)
  // 2. A missing timestamp is never a licence, even for a proven-dead session.
  /** The same row with no window stamp at all. */
  const unstamped = makeHarness(cellWith({ "Senior Engineer": deadReseedRow({ checkpointSince: undefined, barrierFailures: 0 }) }), DEAD_RESEED_ROSTER, [], { liveSessions: [CAPTAIN_SESSION] })
  /** The forced request. */
  const unstampedAnswer = await runTool(unstamped, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect((unstampedAnswer.unfenced as Array<Record<string, unknown>>)[0].reason).toBe("force-not-eligible")
  expect(unstamped.plane.fences).toHaveLength(0)
  // 3. An ABSENT registry proves nothing: `unknown` is never read as dead, so the seat is not HELD at all
  // and the plain negative is the honest answer — nothing is written either way.
  /** The same row in a composition whose agents registry is absent. */
  const unknown = makeHarness(cellWith({ "Senior Engineer": deadReseedRow() }), DEAD_RESEED_ROSTER, [], { liveSessions: [], agentsRegistry: false })
  /** The forced request. */
  const unknownAnswer = await runTool(unknown, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
  expect((unknownAnswer.unfenced as Array<Record<string, unknown>>)[0].reason).toBe("not-fenced")
  expect(unknown.plane.fences).toHaveLength(0)
})

test("R5.2 ONE PREDICATE: `supervise.forceEligible` is TRUE for exactly the seats the verb accepts", async () => {
  // THE DEFECT THIS ENDS: the sweep computed `forceEligible` from a SECOND predicate that never asked
  // whether the seat was closed, so it advertised a lever the verb refused (`not-fenced`). Both surfaces
  // now read one implementation, and this arm walks every shape across BOTH of them.
  /** One seat shape, with the record and the roster it needs. */
  const shapes: Array<{ label: string; row: CellMemberRecord; roster: DoubleMember[]; liveSessions: readonly string[]; agentsRegistry?: boolean }> = [
    { label: "dead reseed", row: deadReseedRow(), roster: DEAD_RESEED_ROSTER, liveSessions: [CAPTAIN_SESSION] },
    { label: "dead reseed, no registry", row: deadReseedRow(), roster: DEAD_RESEED_ROSTER, liveSessions: [CAPTAIN_SESSION], agentsRegistry: false },
    { label: "dead reseed, live child", row: deadReseedRow(), roster: DEAD_RESEED_ROSTER, liveSessions: [CAPTAIN_SESSION, "session-dead-child"] },
    { label: "stale barrier window", row: memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, handoffs: 2, checkpointSince: "2026-11-04T11:40:00.000Z" }), roster: [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], liveSessions: [] },
    { label: "fresh barrier window", row: memberRow("Senior Engineer", { mode: "checkpoint", handoffReady: true, checkpointSince: new Date(Date.now() - 1000).toISOString() }), roster: [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], liveSessions: [] },
    { label: "healthy member", row: memberRow("Senior Engineer"), roster: [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "member" }], liveSessions: [] },
  ]
  for (const shape of shapes) {
    /** The harness for this shape. */
    const harness = makeHarness(cellWith({ "Senior Engineer": shape.row }), shape.roster, [], { liveSessions: shape.liveSessions, ...(shape.agentsRegistry === undefined ? {} : { agentsRegistry: shape.agentsRegistry }) })
    /** What the read-only sweep advertises for the seat. */
    const sweep = await runTool(harness, "cellwork_supervise", {})
    /** The closed-seat row, when the sweep reports one. */
    const closed = (sweep.fenced as Array<Record<string, unknown>>).find((entry) => entry.name === "Senior Engineer")
    /** What the verb does with the SAME forced request. */
    const answer = await runTool(harness, "cellwork_dispatch", { unfence: [{ member: "Senior Engineer", force: true }] })
    /** The verb's one outcome. */
    const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
    // THE ONE PREDICATE, asserted per shape: the advertised lever is the accepted lever.
    expect(closed?.forceEligible === true).toBe(outcome.unfenced === true)
    // AND AN ACCEPTED CLEAR IS NEVER A SILENT `not-fenced`: it names the bound it used.
    if (outcome.unfenced === true) expect(typeof outcome.bound).toBe("string")
  }
})

test("NIT 9: a member with NEITHER fence NOR window answers `not-fenced` and writes nothing", async () => {
  // THE PLAIN NEGATIVE keeps its own direct arm: the waiting-handoff arm became `checkpoint-pending`, and
  // with it the only place the plain answer was asserted. Nothing is held here — no marker, no window, no
  // stamp, no reseed — so the verb must say so and leave both records alone.
  /** The healthy seat and its healthy roster row. */
  const harness = makeHarness(cellWith({ "Senior Engineer": memberRow("Senior Engineer") }), [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "member" }], [])
  /** The captain's unfence, unforced and forced. */
  const plain = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  /** The one outcome. */
  const outcome = (plain.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.member).toBe("Senior Engineer")
  expect(outcome.unfenced).toBe(false)
  expect(outcome.reason).toBe("not-fenced")
  // NOTHING WAS WRITTEN, NOWHERE: no CELL row, no plane call, no journal row.
  expect(rawMembers(harness.workspace)["Senior Engineer"].mode).toBe("member")
  expect(harness.plane.fences).toHaveLength(0)
  expect(journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced" || entry.event === "member-unfenced-forced")).toHaveLength(0)
})

test("R5.4: a REFUSED plane half names the exact retry verb in the answer, the journal and the render", async () => {
  // THE DEAD END THIS CLOSES: the plane's `unfence` is Lead-only, so it CAN refuse. The CELL row was
  // repaired and the TEAM row stayed closed, with nothing naming how to retry.
  /** The give-up fence whose TEAM roster does NOT name the seat, so the plane seam refuses. */
  const harness = makeHarness(cellWith({ "Senior Engineer": fencedRow("Senior Engineer") }), [], [])
  /** The captain's unfence. */
  const answer = await runTool(harness, "cellwork_dispatch", { unfence: ["Senior Engineer"] })
  /** The one outcome: the CELL half landed, the plane half refused, and the retry is named. */
  const outcome = (answer.unfenced as Array<Record<string, unknown>>)[0]
  expect(outcome.unfenced).toBe(true)
  expect(outcome.plane).toBe("refused")
  expect(String(outcome.planeReason)).toContain("is on the roster")
  expect(outcome.retry).toBe('agent_teams_control {action:"unfence", member:"Senior Engineer"}')
  // THE JOURNAL ROW CARRIES IT TOO, so the refusal is actionable after the answer is gone.
  /** The reopen row. */
  const rows = journalRows(harness.workspace, CELL_ID).filter((entry) => entry.event === "member-unfenced")
  expect(rows).toHaveLength(1)
  expect(rows[0].plane).toBe("refused")
  expect(rows[0].retry).toBe('agent_teams_control {action:"unfence", member:"Senior Engineer"}')
  // AND THE RENDER THE MODEL READS NAMES IT, on the same line as the refusal.
  /** The text a model reads for the same answer. */
  const text = renderTool(harness, "cellwork_dispatch", answer)
  expect(text).toContain('agent_teams_control {action:"unfence", member:"Senior Engineer"}')
})

test("R5.4: a TEAM `checkpoint` no barrier is pending for is REPORTED with its retry verb", async () => {
  // THE SHAPE THE BARRIER LEAVES WHEN ITS PLANE HALF WAS REFUSED: the CELL row already left the window
  // (`subcaptain`, not handoff-ready) while the TEAM row is still `checkpoint` — so no barrier will ever
  // fire for it. The sweep now names the seat AND the Lead-only verb that reopens it.
  /** The seat a refused plane reopen left behind. */
  const harness = makeHarness(cellWith({ "Senior Engineer": deadReseedRow({ sessionId: "session-live-child" }) }), [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", mode: "checkpoint" }], [], { liveSessions: ["session-live-child"] })
  /** The captain's read-only sweep. */
  const sweep = await runTool(harness, "cellwork_supervise", {})
  expect(sweep.ok).toBe(true)
  /** The closed row. */
  const closed = (sweep.fenced as Array<Record<string, unknown>>).find((entry) => entry.name === "Senior Engineer")
  if (closed === undefined) throw new Error("the plane-only checkpoint must be reported")
  expect(closed.giveUp).toBe(false)
  expect(closed.barrierOwned).toBe(true)
  expect(closed.forceEligible).toBe(false)
  expect(closed.retry).toBe('agent_teams_control {action:"unfence", member:"Senior Engineer"}')
  /** The text a model reads for the same sweep. */
  const text = renderTool(harness, "cellwork_supervise", sweep)
  expect(text).toContain('agent_teams_control {action:"unfence", member:"Senior Engineer"}')
  // THE RENDER DOES NOT PROMISE A BARRIER THAT CANNOT COME: the seat is named as held by the plane.
  expect(text).toContain("BARRIER-OWNED")
  // AN EXPLICIT TEAM FENCE IS NOT THIS SHAPE: `cellwork_dispatch {unfence}` clears it itself (the team-only
  // case), so the sweep does not send the captain past the nearer lever with a plane retry.
  /** The harness whose TEAM row carries an explicit fence while the CELL row stays healthy. */
  const explicit = makeHarness(cellWith({ "Senior Engineer": memberRow("Senior Engineer") }), [{ id: "M1", name: "Senior Engineer", status: "running", executorRef: "handle-Senior Engineer", fenced: true, fencedReason: "the plane lost the seat's engine" }], [])
  /** The captain's sweep over that record. */
  const explicitSweep = await runTool(explicit, "cellwork_supervise", {})
  /** The closed row. */
  const explicitRow = (explicitSweep.fenced as Array<Record<string, unknown>>).find((entry) => entry.name === "Senior Engineer")
  expect(explicitRow?.giveUp).toBe(true)
  expect("retry" in (explicitRow ?? {})).toBe(false)
})

