// OFFLINE PROOF OF RUNTIME SEAT GROWTH (§4.1), the seat projection (§4.2), the O(1) journal append
// (§4.3) and the §7.1 board resolution — over the REAL cell state file and the shared team-plane double.
//
// The harness installs the WHOLE row through `apply`, so every arm drives the actual tool registrations
// (`cellwork_dispatch`, `cellwork_status`, `cellwork_supervise`, `cellwork_stop`, `cellwork_context`) and
// the real on-disk record under a temp workspace. The team plane is the repository's shared double
// (`test/lib/team-actions-double.ts`), and `agent_teams_plan add_member` is answered by a fake registry
// that appends to the SAME board object the double mutates — one board, exactly as production has.
import { test, expect } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { appendJournal, cellDir, journalPath, newCellState, readCell, statePath, writeCell, type CellMemberRecord, type CellState } from "../src/state.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { materializeSplit, type ActivateDeps, type ActivateResult } from "../src/activate.ts"
import { submitSplit, type SplitVerdict } from "../src/split.ts"
import { createTeamActionsDouble, type DoubleMember, type DoubleTask, type DoubleTeamRecord, type TeamActionsDouble } from "./lib/team-actions-double.ts"

/** The cell id every arm works in (it must start with `cell-` for the active-cell scan). */
const CELL_ID = "cell-elastic-seats"
/** The captain's session id. */
const CAPTAIN_SESSION = "session-captain"
/** The execution board's team id. */
const EXEC_TEAM = "team-exec"
/** The staging/planning team id a legacy record still names. */
const PLAN_TEAM = "team-planning"
/** The roster the fake `mpdRoles` service answers (the base specialists). */
const ROLES: readonly string[] = ["Architect", "Researcher", "Planner", "Deep Worker", "Senior Engineer", "Lead", "Explorer", "Reviewer", "Plan Reviewer", "Vision Analyst", "Junior Engineer"]

/** One captured tool definition (the fake registry hands the runner back here). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The normalized runner the adapter registered. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One fake live agent. */
interface FakeAgent {
  /** The agent id. */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
}

/** The team-service fake over the SAME records the plane double mutates. */
interface FakeTeams {
  /** One record by id. */
  get: (workspace: string, teamId: string) => DoubleTeamRecord | undefined
  /** The plane's binding for a session. */
  active: (workspace: string, sessionId?: string) => DoubleTeamRecord | undefined
  /** Every record, newest first. */
  list: (workspace: string) => DoubleTeamRecord[]
  /** The optional meter read; absent by default so the adapter fallback is observable. */
  memberContext?: (workspace: string, teamId: string, memberName: string) => unknown
}

/** What one harness arm supplies. */
interface HarnessOptions {
  /** The execution board (mutated by the double and by the fake `add_member`). */
  board?: DoubleTeamRecord
  /** The planning/staging record, when the arm needs one. */
  planning?: DoubleTeamRecord
  /** The record `mpdTeams.active` answers; defaults to the execution board. */
  active?: (board: DoubleTeamRecord, planning: DoubleTeamRecord | undefined) => DoubleTeamRecord | undefined
  /** Drop the `role` field on the mid-run append, reproducing §7.1b. */
  dropRole?: boolean
  /** The row config the plugin mounts with (the nested `seats.*` spellings). */
  rowConfig?: Record<string, unknown>
  /** The cell record to seed; defaults to an activated executing cell. */
  cell?: (workspace: string) => CellState
  /** The meter read the fake `mpdTeams` exposes. */
  memberContext?: FakeTeams["memberContext"]
}

/** The harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** The execution board (live, mutated). */
  board: DoubleTeamRecord
  /** The planning record, when the arm seeded one. */
  planning: DoubleTeamRecord | undefined
  /** Every captured tool, by name. */
  tools: Map<string, CapturedTool>
  /** Every in-process tool call the plugin made, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown> }>
  /** Every message the plane delivered, in order. */
  sends: Array<{ handle: string; text: string }>
  /** Every `agent_teams_plan add_member` payload, in order. */
  added: Array<Record<string, unknown>>
  /** Every `plane.dispatch` input the double answered, in order. */
  dispatches: Array<Record<string, unknown>>
}

/**
 * One member row, already raised with a live handle.
 *
 * @param id - the row id.
 * @param name - the board name.
 * @param overrides - fields this arm changes.
 * @returns the row.
 */
function member(id: string, name: string, overrides: Partial<DoubleMember> = {}): DoubleMember {
  return { id, name, status: "inactive", role: name, executorRef: "handle-" + name, ...overrides }
}

/**
 * A pending, unblocked task row.
 *
 * @param id - the board id.
 * @param owner - the declared owner name.
 * @param overrides - fields this arm changes.
 * @returns the row.
 */
function task(id: string, owner: string, overrides: Partial<DoubleTask> = {}): DoubleTask {
  return { id, subject: id + " work", status: "pending", owner, blockedBy: [], ...overrides }
}

/**
 * The default execution board: one BUSY `Deep Worker` and four ready rows on it.
 *
 * @returns the record.
 */
function busyBoard(): DoubleTeamRecord {
  return {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" }), member("M2", "Reviewer", { status: "inactive" })],
    tasks: [
      task("T1", "Deep Worker", { status: "in_progress" }),
      task("T2", "Deep Worker"),
      task("T3", "Deep Worker"),
      task("T4", "Deep Worker"),
      task("T5", "Deep Worker"),
    ],
  }
}

/**
 * The staging record: two planning seats and two closed planning rows — it holds NONE of the cell's
 * executed board ids, which is exactly the legacy shape §7.1 must never present.
 *
 * @returns the record.
 */
function planningBoard(): DoubleTeamRecord {
  return {
    teamId: PLAN_TEAM,
    members: [member("P1", "cell-planner", { role: "Planner" }), member("P2", "cell-splitter", { role: "Lead" })],
    tasks: [
      { id: "P1", subject: "requirements", status: "completed", owner: "cell-planner", blockedBy: [] },
      { id: "P2", subject: "split", status: "completed", owner: "cell-splitter", blockedBy: [] },
    ],
  }
}

/**
 * A member row for the CELL record.
 *
 * @param name - the board name.
 * @param overrides - fields this arm changes.
 * @returns the row.
 */
function cellMember(name: string, overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return { name, role: name, sessionId: "handle-" + name, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-11-11T00:00:00.000Z", ...overrides }
}

/**
 * Seed the executing cell every growth arm starts from.
 *
 * @param board - the execution board whose ids the cell records as activated.
 * @param teamId - the id the CELL RECORD names (the legacy arm points it at the planning team).
 * @returns the fresh record.
 */
function executingCell(board: DoubleTeamRecord, teamId: string = EXEC_TEAM): CellState {
  /** The fresh record. */
  const base = newCellState({ cellId: CELL_ID, objective: "grow the seats", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-11T00:00:00.000Z") })
  /** The activated-task map: every board id this cell minted. */
  const activatedTasks: Record<string, string> = {}
  for (const row of board.tasks) activatedTasks["k-" + String(row.id)] = String(row.id)
  return {
    ...base,
    phase: "executing",
    teamId,
    // A record written before §7.1 carries no staging id; the arm pins the legacy shape.
    planningTeamId: "",
    activatedTasks,
    members: { "Deep Worker": cellMember("Deep Worker"), Reviewer: cellMember("Reviewer") },
  } as CellState
}

/**
 * Build one harness, apply the row and seed the cell record.
 *
 * @param options - the arm's records, config and meter.
 * @returns the harness.
 */
function makeHarness(options: HarnessOptions = {}): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-elastic-"))
  /** The live execution board. */
  const board: DoubleTeamRecord = options.board ?? busyBoard()
  /** The optional staging record. */
  const planning = options.planning
  /** The team records by id. */
  const teams = new Map<string, DoubleTeamRecord>([[board.teamId, board]])
  if (planning !== undefined) teams.set(planning.teamId, planning)
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** Every captured tool. */
  const tools = new Map<string, CapturedTool>()
  /** Every in-process tool call. */
  const calls: Harness["calls"] = []
  /** Every delivery. */
  const sends: Harness["sends"] = []
  /** Every append payload. */
  const added: Harness["added"] = []
  /** The shared plane double, kept so an arm can read the exact dispatch INPUT (`reassign`). */
  const double: TeamActionsDouble = createTeamActionsDouble({ record: () => board, send: (handle: string, text: string): void => { sends.push({ handle, text }) } })
  /** The roster row id counter for the fake append arm. */
  let nextId = 100
  /** The board-task number the fake `create_task` mints next, starting past every seeded row. */
  let nextTaskId = board.tasks.length
  /** The fake `mpdTeams` service. */
  const teamsService: FakeTeams = {
    get: (_workspace: string, teamId: string): DoubleTeamRecord | undefined => teams.get(teamId),
    active: (_workspace: string, _sessionId?: string): DoubleTeamRecord | undefined => options.active === undefined ? board : options.active(board, planning),
    list: (): DoubleTeamRecord[] => [...teams.values()].reverse(),
    ...(options.memberContext === undefined ? {} : { memberContext: options.memberContext }),
  }
  /** The fake tool registry: registration capture plus the ONE write growth uses. */
  const toolsService = {
    /**
     * Capture one definition.
     * @param definition - the adapter's normalized definition.
     * @returns the disposer.
     */
    register(definition: CapturedTool): () => void { tools.set(definition.name, definition); return (): void => {} },
    /**
     * Resolve one captured definition.
     * @param name - the tool name.
     * @returns the definition, or undefined.
     */
    get(name: string): CapturedTool | undefined { return tools.get(name) },
    /**
     * Answer one in-process tool call; `add_member` mutates the SAME board the plane double reads.
     * @param payload - the registry call.
     * @returns the harness-shaped result.
     */
    execute: async (payload: unknown): Promise<Record<string, unknown>> => {
      /** The call as a record. */
      const call = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {}
      /** The call's name. */
      const name = typeof call.name === "string" ? call.name : ""
      /** The call's arguments. */
      const args = typeof call.arguments === "object" && call.arguments !== null ? call.arguments as Record<string, unknown> : {}
      calls.push({ name, arguments: args })
      if (name === "agent_teams_plan" && args.action === "add_member" && typeof args.member === "object" && args.member !== null) {
        /** The member payload. */
        const payloadRow = args.member as Record<string, unknown>
        /** Its name. */
        const memberName = String(payloadRow.name ?? "")
        added.push(payloadRow)
        if (memberName === "") return { value: { spawned: "" } }
        // THE MID-RUN APPEND ARM, reproduced faithfully: unless the arm drops it (§7.1b), the row carries
        // the requested `role`; the handle is what the reassign path needs.
        /** The appended row. */
        const row: DoubleMember = {
          id: "M" + String(nextId++),
          name: memberName,
          status: "running",
          executorRef: "handle-" + memberName,
          description: String(payloadRow.description ?? ""),
          ...(options.dropRole === true || typeof payloadRow.role !== "string" ? {} : { role: payloadRow.role }),
        }
        board.members.push(row)
        return { value: { spawned: row.executorRef, member: row, team: board, appended: "member appended" } }
      }
      // THE TASK APPEND: a live `create_task` lands on the SAME board the members do, which is how the
      // §7.5.1 arms model a plane that writes the execution team while the record still names staging.
      if (name === "agent_teams_plan" && args.action === "create_task" && typeof args.task === "object" && args.task !== null) {
        /** The task payload. */
        const payloadTask = args.task as Record<string, unknown>
        nextTaskId += 1
        /** The board id this append mints. */
        const row: DoubleTask = {
          id: "T" + String(nextTaskId),
          subject: String(payloadTask.subject ?? ""),
          status: "pending",
          owner: String(payloadTask.owner ?? ""),
          ...(Array.isArray(payloadTask.blocked_by) ? { blockedBy: payloadTask.blocked_by.map((entry) => String(entry)) } : {}),
        }
        board.tasks.push(row)
        return { value: { task: row, team: board } }
      }
      return { value: {} }
    },
  }
  /** The services the fake context answers. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdTeams: teamsService,
    mpdTeamActions: double.service,
    mpdRoles: {
      list: (): Array<{ name: string; persona: string }> => ROLES.map((role) => ({ name: role, persona: role + " persona" })),
      get: (key: string): { persona: string } | null => ROLES.includes(key) ? { persona: key + " persona" } : null,
    },
  }
  /** The fake context. */
  const ctx = {
    tools: toolsService,
    /**
     * Run the cleanup callback at registration time (the test never tears the row down).
     * @param fn - the callback.
     */
    effect(fn: () => unknown): void { fn() },
    /**
     * Resolve one fake service.
     * @param service - the service name.
     * @returns the service, or undefined.
     */
    get(service: string): unknown { return services[service] },
  } as unknown as Parameters<typeof apply>[0]
  apply(ctx, (options.rowConfig ?? {}) as Parameters<typeof apply>[1])
  writeCell(workspace, (options.cell ?? ((): CellState => executingCell(board)))(workspace))
  return { workspace, captain, board, planning, tools, calls, sends, added, dispatches: double.dispatches }
}

/**
 * Run one captured tool as one agent.
 *
 * @param harness - the harness that captured it.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the caller; the captain by default.
 * @returns the structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}, agent: FakeAgent = harness.captain): Promise<Record<string, any>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  return await tool.execute(args, { name, agent }) as Record<string, any>
}

/**
 * Every journal row of the harness's cell, in append order.
 *
 * @param harness - the harness.
 * @returns the parsed rows; an unreadable journal answers an empty list.
 */
function journalRows(harness: Harness): Array<Record<string, any>> {
  try {
    return readFileSync(journalPath(harness.workspace, CELL_ID), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, any>)
  } catch {
    return []
  }
}

/**
 * The cell record as it stands on disk.
 *
 * @param harness - the harness.
 * @returns the parsed record.
 */
function recordOnDisk(harness: Harness): Record<string, any> {
  return JSON.parse(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")) as Record<string, any>
}

/**
 * The board's rows for one owner name.
 *
 * @param board - the execution board.
 * @param owner - the owner name.
 * @returns the owned task rows.
 */
function tasksOfOwner(board: DoubleTeamRecord, owner: string): DoubleTask[] {
  return board.tasks.filter((row) => row.owner === owner && row.status === "in_progress")
}

// ── §4.1 arm 1: the BUSY ceiling is removed and the pass dispatches MORE THAN ONE row ─────────────

test("W1 §4.1: four ready rows on one BUSY seat grow seats and the same pass hands four rows over", async () => {
  /** The harness whose board has one BUSY Deep Worker and four ready rows. */
  const harness = makeHarness()
  /** The dispatch pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect(answer.ok).toBe(true)
  /** The seats the pass raised. */
  const grown = answer.grownSeats as Array<Record<string, unknown>>
  expect(grown.map((row) => row.name)).toEqual(["Deep Worker-2", "Deep Worker-3", "Deep Worker-4", "Deep Worker-5"])
  expect(grown.every((row) => row.role === "Deep Worker" && row.reason === "owner-busy")).toBe(true)
  // FOUR ROWS WENT OUT, not one: the reassign hand-over is the dispatch, and the double records it.
  /** The hand-over outcomes. */
  const reassigned = answer.reassigned as Array<Record<string, unknown>>
  expect(reassigned.map((row) => row.taskId)).toEqual(["T2", "T3", "T4", "T5"])
  expect(reassigned.every((row) => row.claimed === true && row.delivered === true)).toBe(true)
  expect(tasksOfOwner(harness.board, "Deep Worker-2").map((row) => row.id)).toEqual(["T2"])
  expect(tasksOfOwner(harness.board, "Deep Worker-3").map((row) => row.id)).toEqual(["T3"])
  // ONE seat-raised row per growth, and the seat projection counts them.
  /** The growth journal rows. */
  const grownRows = journalRows(harness).filter((row) => row.event === "seat-grown")
  expect(grownRows.length).toBe(4)
  expect(grownRows[0]).toMatchObject({ task: "T2", name: "Deep Worker-2", role: "Deep Worker", reason: "owner-busy" })
  // THE REAL CELL STATE FILE learned every seat, marked as grown.
  /** The member table on disk. */
  const onDisk = recordOnDisk(harness).members as Record<string, Record<string, unknown>>
  for (const name of ["Deep Worker-2", "Deep Worker-3", "Deep Worker-4", "Deep Worker-5"]) expect(onDisk[name]?.grown).toBe(true)
  expect(answer.seats).toEqual({ execution: 6, planning: 0, cap: 32, capPerRole: 8, grown: 4, reused: 0 })
})

// ── §4.1 arm 2: the caps are named, and a second pass creates nothing ─────────────────────────────

test("W1 §4.1: maxPerRole=2 creates exactly one extra seat, names the cap, and a second pass creates nothing", async () => {
  /** The capped harness. */
  const harness = makeHarness({ rowConfig: { seats: { maxPerRole: 2, max: 32 } } })
  /** The first pass. */
  const first = await runTool(harness, "cellwork_dispatch")
  expect(first.ok).toBe(true)
  expect((first.grownSeats as unknown[]).map((row: any) => row.name)).toEqual(["Deep Worker-2"])
  /** The skips the cap rewrote. */
  const capped = (first.skipped as Array<Record<string, unknown>>).filter((row) => String(row.reason).includes("cellwork.seats.maxPerRole=2"))
  expect(capped.map((row) => row.taskId).sort()).toEqual(["T3", "T4", "T5"])
  expect(String((capped[0] ?? {}).reason)).toContain("declared owner \"Deep Worker\" is BUSY and the seat cap (cellwork.seats.maxPerRole=2) is reached")
  // The cap sentence is on the journal too, which is what the sweep repeats.
  expect(journalRows(harness).filter((row) => row.event === "seat-growth-refused").length).toBe(3)
  /** The member count after the first pass. */
  const memberCount = harness.board.members.length
  /** The second pass over the same board. */
  const second = await runTool(harness, "cellwork_dispatch")
  expect(second.ok).toBe(true)
  expect(second.grownSeats).toBeUndefined()
  expect(harness.board.members.length).toBe(memberCount)
  expect((second.skipped as Array<Record<string, unknown>>).some((row) => String(row.reason).includes("cellwork.seats.maxPerRole=2"))).toBe(true)
  // EVERY pass journals the refusal it reports, so the second pass adds its own three rows.
  expect(journalRows(harness).filter((row) => row.event === "seat-growth-refused").length).toBe(6)
})

// ── §4.1 arm 3: an idle `<role>-2` is REUSED, never a third seat ─────────────────────────────────

test("W1 §4.1: a pass that finds `Deep Worker-2` idle hands the row to it instead of growing `-3`", async () => {
  /** The board with one BUSY base seat and one IDLE derived seat. */
  const board: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" }), member("M2", "Deep Worker-2", { status: "inactive" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker")],
  }
  /** The harness. */
  const harness = makeHarness({ board })
  /** The pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect(answer.ok).toBe(true)
  expect(answer.grownSeats).toBeUndefined()
  expect(answer.seats.reused).toBe(1)
  expect(harness.board.members.length).toBe(2)
  expect(tasksOfOwner(harness.board, "Deep Worker-2").map((row) => row.id)).toEqual(["T2"])
  expect(journalRows(harness).filter((row) => row.event === "seat-grown").length).toBe(0)
})

// ── §4.1 arm 5: the leave-it-alone arms ──────────────────────────────────────────────────────────

test("W1 §4.1: a NON-ROSTER base never grows and the skip names the base", async () => {
  /** The board whose busy owner's base is not a roster role. */
  const board: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Mystery Worker", { status: "running" })],
    tasks: [task("T1", "Mystery Worker", { status: "in_progress" }), task("T2", "Mystery Worker")],
  }
  /** The harness. */
  const harness = makeHarness({ board })
  /** The pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect(answer.grownSeats).toBeUndefined()
  expect(harness.board.members.length).toBe(1)
  expect((answer.skipped as Array<Record<string, unknown>>).some((row) => row.reason === "owner base \"Mystery Worker\" is not a roster role")).toBe(true)
  expect(journalRows(harness).some((row) => row.event === "seat-growth-refused" && String(row.reason).includes("Mystery Worker"))).toBe(true)
})

test("W1 §4.1: a PLANNING seat, a FENCED seat, a CHECKPOINT seat and a CLAIMED row never grow", async () => {
  // (a) A planning seat holding a claim: growth skips it before any role resolution.
  /** The board whose busy owner is a planning seat. */
  const planningHeld: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "cell-planner", { role: "Planner", status: "running" })],
    tasks: [task("T1", "cell-planner", { status: "in_progress" }), task("T2", "cell-planner")],
  }
  /** The planning-seat harness. */
  const planningHarness = makeHarness({ board: planningHeld })
  expect((await runTool(planningHarness, "cellwork_dispatch")).grownSeats).toBeUndefined()
  expect(planningHarness.board.members.length).toBe(1)
  expect(journalRows(planningHarness).some((row) => row.event === "seat-growth-refused")).toBe(false)
  // (b) A FENCED seat holding a claim.
  /** The board whose busy owner is fenced by the compaction barrier. */
  const fenced: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running", fenced: true, fencedReason: "barrier gave up" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker")],
  }
  /** The fenced harness. */
  const fencedHarness = makeHarness({ board: fenced })
  expect((await runTool(fencedHarness, "cellwork_dispatch")).grownSeats).toBeUndefined()
  expect(fencedHarness.board.members.length).toBe(1)
  // (c) A CHECKPOINT seat holding a claim.
  /** The board whose busy owner is in the checkpoint window. */
  const checkpointed: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running", mode: "checkpoint" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker")],
  }
  /** The checkpoint harness. */
  const checkpointHarness = makeHarness({ board: checkpointed })
  expect((await runTool(checkpointHarness, "cellwork_dispatch")).grownSeats).toBeUndefined()
  expect(checkpointHarness.board.members.length).toBe(1)
  // (d) A row ALREADY CLAIMED is not part of the ready frontier.
  /** The board whose only busy row is in progress and whose second row is also claimed. */
  const claimed: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker", { status: "claimed" })],
  }
  /** The claimed harness. */
  const claimedHarness = makeHarness({ board: claimed })
  expect((await runTool(claimedHarness, "cellwork_dispatch")).grownSeats).toBeUndefined()
  expect(claimedHarness.board.members.length).toBe(1)
  expect(journalRows(claimedHarness).some((row) => row.event === "seat-grown")).toBe(false)
})

// ── §7.1b: the mid-run append's role is READ BACK, never assumed ─────────────────────────────────

test("W1 §7.1b: a grown seat whose member row lost `role` is reported, and the requested role stays on the cell row", async () => {
  /** The harness whose append arm drops `role`. */
  const harness = makeHarness({ dropRole: true })
  /** The pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect(answer.ok).toBe(true)
  /** The seat the pass grew. */
  const grown = (answer.grownSeats as Array<Record<string, any>>)[0]
  expect(grown?.name).toBe("Deep Worker-2")
  expect(grown?.rosterRole).toBe("")
  expect((answer.seatWarnings as string[]).some((line) => line.includes("§7.1b"))).toBe(true)
  expect((recordOnDisk(harness).members as Record<string, Record<string, unknown>>)["Deep Worker-2"]?.role).toBe("Deep Worker")
  // The journal row records what landed beside what was asked for.
  expect(journalRows(harness).find((row) => row.event === "seat-grown")).toMatchObject({ role: "Deep Worker", rosterRole: "" })
})

test("W1 §7.1b: when the append persists `role`, the seat reports it and no warning is raised", async () => {
  /** The harness whose append arm persists `role`. */
  const harness = makeHarness()
  /** The pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect((answer.grownSeats as Array<Record<string, any>>)[0]?.rosterRole).toBe("Deep Worker")
  expect(answer.seatWarnings).toBeUndefined()
})

// ── §4.2: status and supervise carry the caps and the grown count ────────────────────────────────

test("W1 §4.2: cellwork_status and cellwork_supervise carry the seat projection and the cap refusal", async () => {
  /** The capped harness, so the sweep has a refusal to repeat. */
  const harness = makeHarness({ rowConfig: { seats: { maxPerRole: 2, max: 32 } } })
  await runTool(harness, "cellwork_dispatch")
  /** The status read. */
  const status = await runTool(harness, "cellwork_status")
  expect(status.ok).toBe(true)
  expect(status.seats).toMatchObject({ execution: 3, planning: 0, cap: 32, capPerRole: 2, grown: 1 })
  /** The sweep. */
  const supervise = await runTool(harness, "cellwork_supervise")
  expect(supervise.ok).toBe(true)
  expect(supervise.seats).toMatchObject({ execution: 3, planning: 0, cap: 32, capPerRole: 2, grown: 1 })
  expect(String(supervise.seats.refusal)).toContain("cellwork.seats.maxPerRole=2")
})

// ── §4.3: the journal cursor is O(1) to produce and still equals the row count ──────────────────

test("W1 §4.3: appendJournal answers a monotonic cursor equal to the row count, fresh and legacy", () => {
  /** A fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-journal-"))
  /** A fresh cell id; the journal needs no state record. */
  const cellId = "cell-journal-cursor"
  mkdirSync(cellDir(workspace, cellId), { recursive: true })
  /** The first three appends of a FRESH cell. */
  const first = appendJournal(workspace, cellId, { event: "one" }, new Date("2026-11-11T00:00:00.000Z"))
  /** The second append's cursor: the cached count advances by one, no file read. */
  const second = appendJournal(workspace, cellId, { event: "two" }, new Date("2026-11-11T00:00:01.000Z"))
  /** The third append's cursor: still monotonic and still the row count. */
  const third = appendJournal(workspace, cellId, { event: "three" }, new Date("2026-11-11T00:00:02.000Z"))
  expect([first, second, third]).toEqual([1, 2, 3])
  expect(readFileSync(journalPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").length).toBe(3)
  // A LEGACY journal written by an older build (two rows, no cache in this process): the first append
  // derives the count ONCE and every later append stays O(1).
  /** The second cell whose journal predates this process. */
  const legacy = "cell-journal-legacy"
  mkdirSync(cellDir(workspace, legacy), { recursive: true })
  writeFileSync(journalPath(workspace, legacy), JSON.stringify({ event: "old-one" }) + "\n" + JSON.stringify({ event: "old-two" }) + "\n", "utf8")
  expect(appendJournal(workspace, legacy, { event: "new" }, new Date())).toBe(3)
  // A FOREIGN writer between two appends moves the size, so the next append re-derives instead of guessing.
  appendFileSync(journalPath(workspace, legacy), JSON.stringify({ event: "foreign" }) + "\n", "utf8")
  expect(appendJournal(workspace, legacy, { event: "after-foreign" }, new Date())).toBe(5)
  expect(readFileSync(journalPath(workspace, legacy), "utf8").split("\n").filter((line) => line.trim() !== "").length).toBe(5)
})

// ── §7.1 / §7.1a: the legacy record's board is RESOLVED, never presented as the planning team ───

test("W1 §7.1: a legacy cell whose teamId names the planning team reports the REAL board and both ids", async () => {
  /** The execution board the cell actually worked on. */
  const board = busyBoard()
  /** The harness whose record still names the dead planning team. */
  const harness = makeHarness({ board, planning: planningBoard(), cell: (): CellState => executingCell(board, PLAN_TEAM) })
  /** The state file BEFORE the read, to prove no migration rewrote it. */
  const before = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  /** The status read. */
  const status = await runTool(harness, "cellwork_status")
  expect(status.ok).toBe(true)
  expect(status.teamId).toBe(EXEC_TEAM)
  expect(status.recordedTeamId).toBe(PLAN_TEAM)
  expect(status.boardResolution).toBe("plane")
  expect(status.teamMembers).toBe(2)
  expect(status.teamTasks).toBe(5)
  expect(String(status.boardResolutionNote)).toContain(EXEC_TEAM)
  expect(String(status.boardResolutionNote)).toContain(PLAN_TEAM)
  /** The state file AFTER the status read: the read resolved the board without rewriting the record. */
  const afterStatus = readFileSync(statePath(harness.workspace, CELL_ID), "utf8")
  expect(afterStatus).toBe(before)
  /** The sweep, which must resolve the same way and see the execution seats. */
  const supervise = await runTool(harness, "cellwork_supervise")
  expect(supervise.ok).toBe(true)
  expect(supervise.teamId).toBe(EXEC_TEAM)
  expect(supervise.recordedTeamId).toBe(PLAN_TEAM)
  expect(supervise.boardResolution).toBe("plane")
  expect(Array.isArray(supervise.members)).toBe(true)
  expect((supervise.members as Array<Record<string, unknown>>).length).toBe(2)
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(before)
})

test("W1 §7.1a site 4: a non-forced stop is refused on the RESOLVED board and names the team it leaves", async () => {
  /** The execution board with one live row. */
  const board = busyBoard()
  /** The legacy harness. */
  const harness = makeHarness({ board, planning: planningBoard(), cell: (): CellState => executingCell(board, PLAN_TEAM) })
  /** The refused stop: the planning team holds no live row, the execution board does. */
  const refused = await runTool(harness, "cellwork_stop")
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toContain("still being worked")
  expect(String(refused.error)).toContain("T1")
  /** The forced stop, which must print the execution team and the exact end verb. */
  const forced = await runTool(harness, "cellwork_stop", { force: true, reason: "wave test" })
  expect(forced.ok).toBe(true)
  expect(forced.teamId).toBe(EXEC_TEAM)
  expect(forced.endTeamCommand).toBe("agent_teams_control {action:\"end\", team_id:\"team-exec\"}")
})

test("W1 §7.1a site 5: cellwork_context reads the plane meter on the RESOLVED board", async () => {
  /** The execution board. */
  const board = busyBoard()
  /** The harness: the meter answers ONLY for the execution team, so a stale read is observable. */
  const harness = makeHarness({
    board,
    planning: planningBoard(),
    cell: (): CellState => executingCell(board, PLAN_TEAM),
    memberContext: (_workspace: string, teamId: string): unknown => teamId === EXEC_TEAM
      ? { member: "Deep Worker", usedTokens: 1000, windowTokens: 10000, ratio: 0.1, provenance: "observed" }
      : { member: "Deep Worker", usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable", reason: "unknown team" },
  })
  /** The member's handle: the cell record already knows this session. */
  const worker: FakeAgent = { id: "handle-Deep Worker", session: { id: "handle-Deep Worker", header: { cwd: harness.workspace } } }
  /** The context read. */
  const context = await runTool(harness, "cellwork_context", {}, worker)
  expect(context.ok).toBe(true)
  expect(context.teamId).toBe(EXEC_TEAM)
  expect(context.planeRead).toBe("read")
  expect(context.provenance).toBe("observed")
})

// ── §7.1a site 6: the seat resolution reads the plane roster of the RESOLVED board ─────────────

test("W1 §7.1a site 6: a seat that only the execution board's roster names resolves while teamId is stale", async () => {
  /** The execution board, whose second seat the cell record never learned. */
  const board: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" }), member("M2", "Deep Worker-2", { status: "running", mode: "checkpoint" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" })],
  }
  /** The legacy harness. */
  const harness = makeHarness({ board, planning: planningBoard(), cell: (): CellState => executingCell(board, PLAN_TEAM) })
  /** The adopted seat resolution, read through the same module the guard uses. */
  const { callerContext } = await import("../src/caller.ts")
  /** A handle standing in for the derived seat's own session. */
  const seatAgent: FakeAgent = { id: "handle-Deep Worker-2", session: { id: "handle-Deep Worker-2", header: { cwd: harness.workspace } } }
  /** The resolved context (READ-ONLY: no adoption write in this arm). */
  const resolved = callerContext({ workspaceRoot: (): string => harness.workspace } as never, { agent: seatAgent } as never, {
    teams: () => ({ get: (_workspace: string, teamId: string) => harness.board.teamId === teamId ? harness.board : undefined, active: () => harness.board }) as never,
    adopt: false,
  })
  expect(resolved.member).toBe("Deep Worker-2")
  expect(resolved.seat).toMatchObject({ name: "Deep Worker-2", mode: "checkpoint" })
})


// ── SHARED DIRECT-ACTIVATION FIXTURE (C3 / C4) ──────────────────────────────────────────────────

/** One in-process tool call a direct activation fixture answered. */
interface DirectCall {
  /** The tool name. */
  name: string
  /** Its arguments. */
  arguments: Record<string, unknown>
}

/** A direct activation fixture: the deps the pass reads plus the observers the arms assert on. */
interface DirectActivation {
  /** The dependency object `materializeSplit` is called with. */
  deps: ActivateDeps
  /** Every in-process tool call, in order. */
  calls: DirectCall[]
  /** Every team id `recordFor` was asked for, in order. */
  reads: string[]
}

/**
 * Build the smallest deps object that can materialise one accepted split.
 *
 * @param input - the workspace, the cell, the split and the optional service/record seams.
 * @returns the deps plus the two observers an arm reads.
 */
function directActivation(input: {
  workspace: string
  cell: CellState
  split: SplitVerdict
  teams?: { get?: (workspace: string, teamId: string) => unknown; active?: (workspace: string, sessionId?: string) => unknown }
  recordFor?: (teamId: string) => Record<string, unknown> | undefined
  teamActions?: ActivateDeps["teamActions"]
}): DirectActivation {
  /** Every in-process call. */
  const calls: DirectCall[] = []
  /** Every record read. */
  const reads: string[] = []
  /** The board-id mint counter. */
  let minted = 0
  /** The deps the pass reads. */
  const deps: ActivateDeps = {
    dsh: {
      /**
       * Answer the three team tools the activation pass uses.
       * @param call - the tool name and its arguments.
       * @returns the harness-shaped result with the minted handle/id.
       */
      async executeTool(call: { name: string; arguments?: unknown; agent?: unknown }): Promise<{ ok: boolean; value?: unknown; error?: string }> {
        /** The call's arguments. */
        const args = typeof call.arguments === "object" && call.arguments !== null ? call.arguments as Record<string, unknown> : {}
        calls.push({ name: call.name, arguments: args })
        if (call.name === "agent_teams_plan" && args.action === "add_member") {
          /** The member payload. */
          const member = typeof args.member === "object" && args.member !== null ? args.member as Record<string, unknown> : {}
          return { ok: true, value: { spawned: "handle-" + String(member.name ?? "") } }
        }
        if (call.name === "agent_teams_plan" && args.action === "create_task") {
          minted += 1
          return { ok: true, value: { task: { id: "T" + String(minted) } } }
        }
        return { ok: true, value: {} }
      },
    } as unknown as ActivateDeps["dsh"],
    workspace: input.workspace,
    cell: input.cell,
    config: DEFAULT_CELLWORK_CONFIG,
    captainAgent: { id: CAPTAIN_SESSION },
    split: input.split,
    personaFor: (): null => null,
    recordFor: (teamId: string): Record<string, unknown> | undefined => {
      reads.push(teamId)
      return input.recordFor === undefined ? { teamId, members: [], tasks: [] } : input.recordFor(teamId)
    },
    ...(input.teams === undefined ? {} : { teams: () => input.teams }),
    teamActions: input.teamActions ?? ((): undefined => undefined),
    progress: (): void => {},
    now: new Date("2026-11-11T00:30:00.000Z"),
  }
  return { deps, calls, reads }
}

/**
 * One ACCEPTED split verdict written to a temp workspace.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell the split belongs to.
 * @param revision - the requirements revision it targets.
 * @param keys - the task keys in submission order.
 * @returns the verdict (asserted accepted by each caller).
 */
async function splitFixture(workspace: string, cellId: string, revision: number, keys: readonly string[]): Promise<SplitVerdict> {
  return await submitSplit({
    workspace,
    cellId,
    config: DEFAULT_CELLWORK_CONFIG,
    roster: ROLES,
    window: async (): Promise<{ provider: string; model: string; window: number; provenance: "catalog"; maxOutputTokens: number }> => ({ provider: "deepseek-official", model: "deepseek-flash", window: 1000000, provenance: "catalog", maxOutputTokens: 8192 }),
    now: new Date("2026-11-11T00:00:00.000Z"),
  }, {
    revision,
    tasks: keys.map((key) => ({ key, subject: key + " task", description: "do " + key, ownerRole: "Deep Worker", writeScopes: [], blockedBy: [], independent: true, inputs: [], verify: false })),
  })
}

// ── C1: §4.4.4 as its OWN named claim ───────────────────────────────────────────────────────────

test("C1 §4.4.4: one growth writes exactly ONE seat-grown row and ONE member row; a capped growth writes NEITHER", async () => {
  /** The smallest growing board: one BUSY seat and ONE ready row. */
  const one: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker")],
  }
  /** The growing harness. */
  const growing = makeHarness({ board: one, cell: (): CellState => executingCell(one) })
  /** The recorded member count BEFORE the pass. */
  const before = Object.keys(recordOnDisk(growing).members).length
  /** The pass. */
  const answer = await runTool(growing, "cellwork_dispatch")
  expect((answer.grownSeats as unknown[]).length).toBe(1)
  expect(journalRows(growing).filter((row) => row.event === "seat-grown").length).toBe(1)
  expect(growing.board.members.length).toBe(2)
  expect(Object.keys(recordOnDisk(growing).members).length).toBe(before + 1)
  // THE CAPPED TWIN: the same fixture with per-role growth disabled writes NEITHER kind of row.
  /** The capped board (a fresh copy, so the first pass's mutation cannot leak in). */
  const cappedOne: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker")],
  }
  /** The capped harness. */
  const capped = makeHarness({ board: cappedOne, cell: (): CellState => executingCell(cappedOne), rowConfig: { seats: { maxPerRole: 1, max: 32 } } })
  /** The capped member count BEFORE the pass. */
  const cappedBefore = Object.keys(recordOnDisk(capped).members).length
  /** The capped pass. */
  const cappedAnswer = await runTool(capped, "cellwork_dispatch")
  expect(cappedAnswer.grownSeats).toBeUndefined()
  expect(journalRows(capped).filter((row) => row.event === "seat-grown").length).toBe(0)
  expect(capped.board.members.length).toBe(1)
  expect(Object.keys(recordOnDisk(capped).members).length).toBe(cappedBefore)
  // The refusal itself IS reported and journaled — that is the sentence the sweep repeats.
  expect(journalRows(capped).filter((row) => row.event === "seat-growth-refused").length).toBe(1)
})

// ── C2: the two missing never-grow arms ─────────────────────────────────────────────────────────

test("C2a §4.1: maxPerRole=1 disables growth entirely — no seat, no member, the cap named", async () => {
  /** The busy board. */
  const board = busyBoard()
  /** The growth-disabled harness. */
  const harness = makeHarness({ board, cell: (): CellState => executingCell(board), rowConfig: { seats: { maxPerRole: 1, max: 32 } } })
  /** The pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect(answer.grownSeats).toBeUndefined()
  expect(harness.board.members.length).toBe(2)
  expect(journalRows(harness).filter((row) => row.event === "seat-grown").length).toBe(0)
  expect(String((answer.skipped as Array<Record<string, unknown>>).find((row) => row.taskId === "T2")?.reason)).toContain("cellwork.seats.maxPerRole=1")
})

test("C2b §4.1: a BLOCKED row never grows a seat even when its owner is BUSY", async () => {
  /** The board whose only other row is blocked by an unsatisfied blocker. */
  const board: DoubleTeamRecord = {
    teamId: EXEC_TEAM,
    members: [member("M1", "Deep Worker", { status: "running" })],
    tasks: [task("T1", "Deep Worker", { status: "in_progress" }), task("T2", "Deep Worker", { blockedBy: ["T0"] })],
  }
  /** The harness. */
  const harness = makeHarness({ board, cell: (): CellState => executingCell(board) })
  /** The pass. */
  const answer = await runTool(harness, "cellwork_dispatch")
  expect(answer.grownSeats).toBeUndefined()
  expect(harness.board.members.length).toBe(1)
  expect(journalRows(harness).filter((row) => row.event === "seat-grown").length).toBe(0)
  // The plane's own skip still names the blocker, so the row's fate is visible.
  expect(String((answer.skipped as Array<Record<string, unknown>>).find((row) => row.taskId === "T2")?.reason)).toContain("T0")
})

// ── C3: the evidence-gated START resolution on an EMPTY activatedTasks re-split ─────────────────

test("C3 §7.1a: a re-split with EMPTY activatedTasks still resolves the recorded board at start", async () => {
  /** The temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-c3-"))
  /** The cell id. */
  const cellId = "cell-c3-empty-ids"
  /** The accepted re-split: revision 2 carries ONE new task. */
  const split = await splitFixture(workspace, cellId, 2, ["alpha"])
  expect(split.accepted).toBe(true)
  /** The executing cell a LEGACY record leaves behind: activatedRevision 1, but no minted-id map. */
  const base = newCellState({ cellId, objective: "re-split an older cell", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-11T00:00:00.000Z") })
  /** The record this arm materialises against: executing, revision 1, and NO minted-id map. */
  const cell: CellState = { ...base, phase: "executing", teamId: EXEC_TEAM, splitRevision: 1, activatedRevision: 1, activatedTasks: {} }
  writeCell(workspace, cell)
  /** The fixture: only the recorded team answers, and every read is observed. */
  const fixture = directActivation({ workspace, cell, split })
  /** The materialisation. */
  const result: ActivateResult = await materializeSplit(fixture.deps)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  // THE GATE'S FALLBACK IS THE RESOLUTION: with no minted ids to verify, the recorded team IS the board,
  // the seed reads it and the re-split materialises — no extra resolver read, no other team guessed.
  expect(result.outcome.mode).toBe("resplit")
  expect(fixture.reads).toContain(EXEC_TEAM)
  expect(fixture.reads).not.toContain(PLAN_TEAM)
  expect(Object.keys(result.outcome.members)).toEqual(["Deep Worker"])
  expect(fixture.calls.some((call) => call.name === "agent_teams_plan" && call.arguments.action === "add_member")).toBe(true)
})

// ── C4: §7.1a SITE 3 — the activation cancel path, on the RESOLVED team ────────────────────────

/** The planning record a legacy cell's `teamId` still names. */
function planningRecord(): DoubleTeamRecord {
  return { teamId: PLAN_TEAM, members: [], tasks: [{ id: "P1", subject: "requirements", status: "completed", blockedBy: [] }, { id: "P2", subject: "split", status: "completed", blockedBy: [] }] }
}

/** The execution record that actually holds the dropped row. */
function executionRecord(): DoubleTeamRecord {
  return { teamId: EXEC_TEAM, members: [], tasks: [{ id: "T7", subject: "dropped work", status: "pending", blockedBy: [] }] }
}

/**
 * Build the smallest fixture that reaches the activation CANCEL path: a legacy record whose `teamId`
 * names the planning team, a minted board id the new revision drops, and a plane that reports the
 * cancellation however the arm wants.
 *
 * @param workspace - the workspace root.
 * @param cancel - the `cancelTasks` answer the plane double returns.
 * @param observed - receives the cancel call's team id and task ids.
 * @returns the fixture plus the legacy cell and split.
 */
async function cancelFixture(workspace: string, cancel: (input: Record<string, unknown>) => Record<string, unknown>, observed: { teamId?: string; taskIds?: string[] }): Promise<{ fixture: DirectActivation; cell: CellState; split: SplitVerdict }> {
  /** The cell id. */
  const cellId = "cell-c4-cancel"
  /** The accepted re-split: revision 2 keeps ONE new key and drops the old one. */
  const split = await splitFixture(workspace, cellId, 2, ["keep"])
  /** The legacy executing cell: the old key is mapped, the staging team is still recorded. */
  const base = newCellState({ cellId, objective: "re-split a legacy cell", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-11T00:00:00.000Z") })
  /** The legacy record: the OLD key is mapped while `teamId` still names the staging team. */
  const cell: CellState = { ...base, phase: "executing", teamId: PLAN_TEAM, splitRevision: 1, activatedRevision: 1, activatedTasks: { dropped: "T7" } }
  writeCell(workspace, cell)
  /** The planning record the fast path must reject, and the execution record the plane must find. */
  const planning = planningRecord()
  /** The execution record that really holds the dropped row, which the resolver must find. */
  const execution = executionRecord()
  /** The fixture: the resolver sees the plane binding and every state read. */
  const fixture = directActivation({
    workspace,
    cell,
    split,
    teams: {
      get: (_workspace: string, teamId: string): unknown => teamId === PLAN_TEAM ? planning : teamId === EXEC_TEAM ? execution : undefined,
      active: (): unknown => execution,
    },
    recordFor: (teamId: string): Record<string, unknown> | undefined => teamId === PLAN_TEAM ? planning : teamId === EXEC_TEAM ? execution : undefined,
    teamActions: () => ({
      cancelTasks: async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
        observed.teamId = String(input.teamId ?? "")
        observed.taskIds = Array.isArray(input.taskIds) ? input.taskIds.map(String) : []
        return cancel(input)
      },
    }),
  })
  return { fixture, cell, split }
}

test("C4 §7.1a site 3: a cancel that comes back `skipped` with `ok:true` now FAILS activation", async () => {
  /** The temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-c4-"))
  /** What the cancel call targeted. */
  const observed: { teamId?: string; taskIds?: string[] } = {}
  /** The fixture whose plane reports the row as skipped while answering ok. */
  const { fixture } = await cancelFixture(workspace, (): Record<string, unknown> => ({ ok: true, cancelled: [], skipped: [{ taskId: "T7", reason: "no board row is named \"T7\"" }] }), observed)
  /** The materialisation: the VEdit silent no-op must now be a FAILURE. */
  const result = await materializeSplit(fixture.deps)
  expect(result.ok).toBe(false)
  if (result.ok) return
  // THE FAILURE NAMES THE ROW, THE PLANE'S REASON AND THE RESUME PATH — never a success claim.
  expect(result.error).toContain("could not close")
  expect(result.error).toContain("T7")
  expect(result.error).toContain("no board row is named")
  expect(result.error).toContain("resumed")
  // AND IT TARGETED THE RESOLVED EXECUTION TEAM, not the dead planning team the record names.
  expect(observed.teamId).toBe(EXEC_TEAM)
  expect(observed.taskIds).toEqual(["T7"])
})

test("C4 §7.1a site 3: the resolved team is the cancel target, and a real cancellation proceeds", async () => {
  /** The temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-c4-ok-"))
  /** What the cancel call targeted. */
  const observed: { teamId?: string; taskIds?: string[] } = {}
  /** The fixture whose plane really cancels the row. */
  const { fixture } = await cancelFixture(workspace, (): Record<string, unknown> => ({ ok: true, cancelled: ["T7"], skipped: [] }), observed)
  /** The materialisation. */
  const result = await materializeSplit(fixture.deps)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(observed.teamId).toBe(EXEC_TEAM)
  expect(observed.taskIds).toEqual(["T7"])
  expect(result.outcome.cancelled).toEqual([{ key: "dropped", boardId: "T7" }])
})

// ── N1: the cap sentence names BOTH the key and the value ──────────────────────────────────────

test("N1 §4.1: the cap sentences name BOTH the cap key and its value", async () => {
  /** The per-role-capped harness. */
  const perRole = makeHarness({ rowConfig: { seats: { maxPerRole: 1, max: 32 } } })
  /** Its pass. */
  const perRoleAnswer = await runTool(perRole, "cellwork_dispatch")
  /** The sentence the per-role cap produced. */
  const perRoleReason = String((perRoleAnswer.skipped as Array<Record<string, unknown>>).find((row) => row.taskId === "T2")?.reason)
  expect(perRoleReason).toContain("cellwork.seats.maxPerRole")
  expect(perRoleReason).toContain("=1)")
  // THE TOTAL CAP has its OWN key and its own value; the two sentences must not be interchangeable.
  /** The total-capped harness (two execution seats already exist, so max=2 is reached at once). */
  const total = makeHarness({ rowConfig: { seats: { maxPerRole: 8, max: 2 } } })
  /** Its pass. */
  const totalAnswer = await runTool(total, "cellwork_dispatch")
  /** The sentence the total cap produced. */
  const totalReason = String((totalAnswer.skipped as Array<Record<string, unknown>>).find((row) => row.taskId === "T2")?.reason)
  expect(totalReason).toContain("cellwork.seats.max")
  expect(totalReason).toContain("=2)")
  expect(totalReason).not.toContain("maxPerRole")
})

// ── N2: growth's reassign pairs merged with the caller's never double-claim a row ──────────────

test("N2 §4.1: growth's reassign pairs merge with the caller's and never double-claim a row", async () => {
  /** The busy board with four ready rows. */
  const board = busyBoard()
  /** The harness. */
  const harness = makeHarness({ board, cell: (): CellState => executingCell(board) })
  /** The pass, with the captain handing T2 to the idle Reviewer itself. */
  const answer = await runTool(harness, "cellwork_dispatch", { reassign: [{ task_id: "T2", owner: "Reviewer" }] })
  expect(answer.ok).toBe(true)
  // THE PLANE SAW EACH ROW ONCE: the caller's pair first, growth's pairs for the rows it did not name.
  /** The dispatch input the plane answered. */
  const dispatched = harness.dispatches[0] ?? {}
  /** The merged reassign pairs. */
  const pairs = Array.isArray(dispatched.reassign) ? dispatched.reassign as Array<Record<string, unknown>> : []
  expect(pairs.filter((pair) => pair.task_id === "T2").length).toBe(1)
  expect(pairs.find((pair) => pair.task_id === "T2")?.owner).toBe("Reviewer")
  expect(new Set(pairs.map((pair) => String(pair.task_id))).size).toBe(pairs.length)
  // THE BOARD AGREES: T2 belongs to Reviewer, and growth only took the rows the caller left alone.
  expect(harness.board.tasks.find((row) => row.id === "T2")).toMatchObject({ status: "in_progress", owner: "Reviewer" })
  expect((answer.grownSeats as Array<Record<string, unknown>>).map((row) => row.taskId)).toEqual(["T3", "T4", "T5"])
  expect((answer.reassigned as Array<Record<string, unknown>>).filter((row) => row.taskId === "T2").length).toBe(1)
  expect((answer.reassigned as Array<Record<string, unknown>>).every((row) => row.claimed === true)).toBe(true)
})

// ── N3: embedded newline + foreign append keep the cursor equal to the line count ──────────────

test("N3 §4.3: a field with an embedded NEWLINE and a foreign append both keep cursor == line count", () => {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-journal-n3-"))
  /** The cell id. */
  const cellId = "cell-journal-n3"
  mkdirSync(cellDir(workspace, cellId), { recursive: true })
  /** The non-empty physical line count of the journal. */
  const lines = (): number => readFileSync(journalPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").length
  // A NEWLINE INSIDE A FIELD is JSON-escaped, so one append stays ONE physical row and the cursor is exact.
  expect(appendJournal(workspace, cellId, { event: "note", text: "line one\nline two" }, new Date())).toBe(1)
  expect(lines()).toBe(1)
  expect(appendJournal(workspace, cellId, { event: "second" }, new Date())).toBe(2)
  expect(lines()).toBe(2)
  // A FOREIGN writer between two of ours: the size token moves, the next append re-derives and matches.
  appendFileSync(journalPath(workspace, cellId), JSON.stringify({ event: "foreign" }) + "\n", "utf8")
  expect(appendJournal(workspace, cellId, { event: "after-foreign" }, new Date())).toBe(4)
  expect(lines()).toBe(4)
})

// ── N4: the resolver's source AND the disagreement line on the legacy fixture ──────────────────

test("N4 §7.1: the legacy fixture asserts the resolution SOURCE and the disagreement line explicitly", async () => {
  /** The execution board the cell actually worked on. */
  const board = busyBoard()
  /** The legacy harness whose record names the dead planning team. */
  const harness = makeHarness({ board, planning: planningBoard(), cell: (): CellState => executingCell(board, PLAN_TEAM) })
  /** The status read. */
  const status = await runTool(harness, "cellwork_status")
  expect(status.boardResolution).toBe("plane")
  expect(status.disagreement).toBe(true)
  expect(status.boardResolutionNote).toMatch(/^the cell record names team "team-planning" while the plane resolution names "team-exec"/)
  expect(String(status.boardResolutionNote)).toContain("the plane board is reported")
  /** The sweep, which must carry the same source and the same line. */
  const supervise = await runTool(harness, "cellwork_supervise")
  expect(supervise.boardResolution).toBe("plane")
  expect(supervise.disagreement).toBe(true)
  expect(supervise.boardResolutionNote).toBe(status.boardResolutionNote)
  // THE CONTROL: a healthy record resolves from its OWN id and reports NO disagreement.
  /** The healthy harness (record ids agree). */
  const healthy = makeHarness()
  /** Its status read. */
  const healthyStatus = await runTool(healthy, "cellwork_status")
  expect(healthyStatus.boardResolution).toBe("state.teamId")
  expect(healthyStatus.disagreement).toBe(false)
  expect(healthyStatus.boardResolutionNote).toBeUndefined()
})

// ── W4 §7.5.1: the NEW-CELL write side — activation PERSISTS the execution team ────────────────

/**
 * Seed a NEW cell on the exact §7.1 shape: it knows only the STAGING team it was started on, and the
 * accepted split has never been materialised, so activation is what first learns the execution board.
 *
 * The execution board starts EMPTY and the plane's own binding answers it: the live appends mint their
 * rows there, which is the divergence the record has to learn (the field report: `teamId` named the
 * ended planning team `-008` while the real board was `-00a`).
 *
 * @param legacyShape - write the record WITHOUT the `planningTeamId` key, as a pre-§7.1 cell carries it.
 * @returns the harness and the accepted split.
 */
async function newCellFixture(legacyShape: boolean): Promise<{ harness: Harness; split: SplitVerdict }> {
  /** The live execution board: empty until this activation materialises the split on it. */
  const board: DoubleTeamRecord = { teamId: EXEC_TEAM, members: [], tasks: [] }
  /** The harness: the staging record answers by id, the execution board is the plane's binding. */
  const harness = makeHarness({ board, planning: planningBoard() })
  /** The accepted split revision 1, on disk and not yet materialised. */
  const split = await splitFixture(harness.workspace, CELL_ID, 1, ["alpha"])
  /** The record a cell carries after `cellwork_start` and one ACCEPTED split. */
  const cell: CellState = {
    ...newCellState({ cellId: CELL_ID, objective: "activate a fresh split", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-11T01:00:00.000Z") }),
    phase: "split",
    teamId: PLAN_TEAM,
    planningTeamId: "",
    requirementsRevision: 1,
    splitRevision: 1,
    members: { "cell-planner": cellMember("cell-planner", { role: "Planner" }), "cell-splitter": cellMember("cell-splitter", { role: "Lead" }) },
  }
  if (legacyShape) {
    /** The pre-§7.1 record: the new key does not exist at all. */
    const legacy = { ...cell } as Record<string, unknown>
    delete legacy.planningTeamId
    writeFileSync(statePath(harness.workspace, CELL_ID), JSON.stringify(legacy, null, 2) + "\n")
  } else {
    writeCell(harness.workspace, cell)
  }
  return { harness, split }
}

test("W4 §7.5.1: a NEW-cell activation persists the execution team as `teamId` and the staging team as `planningTeamId`", async () => {
  /** The staged cell plus its accepted split. */
  const { harness, split } = await newCellFixture(false)
  expect(split.accepted).toBe(true)
  // THE SEED NAMES ONLY THE STAGING TEAM: only the persistence path can teach the disk EXEC.
  expect(recordOnDisk(harness).teamId).toBe(PLAN_TEAM)
  expect(recordOnDisk(harness).planningTeamId).toBe("")
  /** The real activation, through the mounted tool (flow.ts owns the write). */
  const activated = await runTool(harness, "cellwork_activate")
  expect(activated.ok).toBe(true)
  // THE SUBJECT IS THE FILE: not the tool answer and not an in-memory record.
  const persisted = recordOnDisk(harness)
  expect(persisted.teamId).toBe(EXEC_TEAM)
  expect(persisted.planningTeamId).toBe(PLAN_TEAM)
  expect(persisted.phase).toBe("executing")
  // AND THE ASSERTION NAMES A REAL BOARD: every task this pass minted sits on the team the record now names.
  const minted = (activated.tasks as Array<Record<string, unknown>>).map((row) => String(row.boardId))
  expect(minted.length).toBe(1)
  expect(harness.board.teamId).toBe(EXEC_TEAM)
  expect(harness.board.tasks.map((row) => row.id)).toEqual(expect.arrayContaining(minted))
  // The shared reader accepts the repaired record; a broken shape would refuse here instead.
  const reread = readCell(harness.workspace, CELL_ID)
  expect(reread.ok).toBe(true)
  if (!reread.ok) return
  expect(reread.state.teamId).toBe(EXEC_TEAM)
  expect(reread.state.planningTeamId).toBe(PLAN_TEAM)
})

test("W4 §7.5.1 legacy: a record with NO `planningTeamId` and `teamId` on the staging shell activates, reads back and is repaired", async () => {
  /** The staged cell written in the pre-§7.1 shape. */
  const { harness } = await newCellFixture(true)
  // THE TOLERANT READ IS ASSERTED FIRST: the old shape is readable and answers "" for the new field.
  const before = readCell(harness.workspace, CELL_ID)
  expect(before.ok).toBe(true)
  if (!before.ok) return
  expect(before.state.teamId).toBe(PLAN_TEAM)
  expect(before.state.planningTeamId).toBe("")
  /** The real activation on the legacy record. */
  const activated = await runTool(harness, "cellwork_activate")
  expect(activated.ok).toBe(true)
  // AFTER: the same file parses, the reader still accepts it, and the rewrite carries both ids.
  const persisted = recordOnDisk(harness)
  expect(persisted.teamId).toBe(EXEC_TEAM)
  expect(persisted.planningTeamId).toBe(PLAN_TEAM)
  /** The same record read back through the shared reader after the rewrite. */
  const after = readCell(harness.workspace, CELL_ID)
  expect(after.ok).toBe(true)
  if (!after.ok) return
  expect(after.state.teamId).toBe(EXEC_TEAM)
  expect(after.state.planningTeamId).toBe(PLAN_TEAM)
})
