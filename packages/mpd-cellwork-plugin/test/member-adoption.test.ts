// OFFLINE PROOF OF MEMBER ADOPTION (contract B1, the VEdit failure of 2026-11-02): a member added
// mid-run with `agent_teams_plan {action:"add_member"}` is known to the LIVE TEAM record — its
// `executorRef` is the child session — but the cell record never learned a row for it, so
// `cellwork_handoff` refused with `"<name>" is not a recorded cell member` and the member had no
// checkpoint channel at all.
//
// The harness is the SAME one `status-reconcile.test.ts` uses (one hand-written cell record plus the
// in-memory `mpdTeams` double), extended with the shared `mpdTeamActions` double so the handoff's
// plane write is the real contract rather than a stub: the arm proves the SEAT-RESOLUTION path, not the
// staging flow that normally writes a row.
import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { cellDir, CELL_SPLIT_DIR, journalPath, newCellState, readCell, statePath, type CellMemberRecord, writeCell } from "../src/state.ts"
import { createTeamActionsDouble, type DoubleMember, type DoubleTeamRecord, type TeamActionsDouble } from "./lib/team-actions-double.ts"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** One fake live agent: its session id and the workspace header the readers resolve from. */
interface FakeAgent {
  /** The agent id. */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
}

/** One tool definition the fake registry captured. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The minimal harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** The captured tool definitions. */
  tools: CapturedTool[]
  /** The live team records the `mpdTeams` double answers with, by id. */
  teams: Map<string, DoubleTeamRecord>
  /** The shared `mpdTeamActions` double, so an arm can see the plane calls a verb delegated. */
  plane: TeamActionsDouble
  /** The hook that runs at the TEAM-record read, which is where an arm can break the cell row deterministically. */
  teamReadHook: { run?: () => void }
  /** The tool-guard predicate the row really installed, so an arm can drive a dispatch through it. */
  guard: ((exec: DshToolExec) => string | undefined) | undefined
}

/** A handoff document satisfying all seven required sections, so only the SEAT can refuse the verb. */
const HANDOFF_TEXT = ["## Task", "adopt the seat", "## State", "half done", "## Decisions", "mirror the team row", "## Artifacts", "none yet", "## Verified facts", "the test pins it", "## Open questions", "none", "## Next step", "end the turn"].join("\n")

/**
 * Build the minimal harness and apply the plugin once.
 *
 * @returns the harness.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-adoption-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** Captured tool definitions. */
  const tools: CapturedTool[] = []
  /** Live team records, by id. */
  const teams = new Map<string, DoubleTeamRecord>()
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } } }
  /** The shared team-plane double, bound to the SAME record map the `mpdTeams` double answers. */
  const plane = createTeamActionsDouble({ record: () => teams.get("team-1") })
  /** The guard predicate the row installs, captured so an arm can dispatch through the REAL predicate. */
  const guardSeat: { predicate: ((exec: DshToolExec) => string | undefined) | undefined } = { predicate: undefined }
  /** The tool registry double. */
  const toolsService = {
    /**
     * Capture one definition.
     * @param definition - the definition.
     * @returns the disposer.
     */
    register(definition: CapturedTool): () => void { tools.push(definition); return (): void => {} },
    /**
     * Resolve one captured definition.
     * @param name - the tool name.
     * @returns the definition, or undefined.
     */
    get(name: string): CapturedTool | undefined { return tools.find((tool) => tool.name === name) },
    /**
     * Capture the row's tool guard (the `tools.guard` seam `installCellworkGuard` requires).
     * @param predicate - the guard the row registers.
     * @returns the disposer.
     */
    guard(predicate: (exec: DshToolExec) => string | undefined): () => void { guardSeat.predicate = predicate; return (): void => {} },
  }
  /** The hook an arm installs to run at the TEAM-record read (the moment between the cell scan and adoption). */
  const teamReadHook: { run?: () => void } = {}
  /** The services the fake context answers. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdTeams: {
      /**
       * Read one live team record.
       * @param _workspace - the caller's workspace (unused by the double).
       * @param teamId - the team asked for.
       * @returns the record, or undefined.
       */
      get: (_workspace: string, teamId: string): DoubleTeamRecord | undefined => { teamReadHook.run?.(); return teams.get(teamId) },
    },
    mpdTeamActions: plane.service,
    mpdRoles: { list: (): Array<{ name: string }> => [], get: (): null => null },
  }
  /** The fake context. */
  const ctx = {
    tools: toolsService,
    /**
     * Run the cleanup callback at registration time.
     * @param fn - the callback.
     */
    effect(fn: () => unknown): void { fn() },
    /**
     * Resolve one fake service.
     * @param service - the service name.
     * @returns the service, or undefined.
     */
    get(service: string): unknown { return services[service] },
  } as Parameters<typeof apply>[0]
  apply(ctx, {})
  return { workspace, captain, tools, teams, plane, teamReadHook, guard: guardSeat.predicate }
}

/**
 * Build one member handle for a session id.
 *
 * @param harness - the harness.
 * @param sessionId - the executor handle the live team row carries.
 * @returns the agent handle a tool call is dispatched with.
 */
function teammate(harness: Harness, sessionId: string): FakeAgent {
  return { id: sessionId, session: { id: sessionId, header: { cwd: harness.workspace } } }
}

/**
 * Run one captured tool as one agent.
 *
 * @param harness - the harness.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the caller; defaults to the captain.
 * @returns the structured result.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}, agent: FakeAgent = harness.captain): Promise<Record<string, any>> {
  /** The captured definition. */
  const tool = harness.tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  return await tool.execute(args, { name, agent }) as Record<string, any>
}

/**
 * Write one executing cell record with the given member table and a team id.
 *
 * @param harness - the harness.
 * @param members - the rows the CELL record knows.
 * @returns the cell id.
 */
function seedCell(harness: Harness, members: Record<string, CellMemberRecord>): string {
  /** The cell id; it must start with `cell-` so the active-cell reader finds it. */
  const cellId = "cell-member-adoption"
  /** A fresh record for the cell. */
  const state = newCellState({ cellId, objective: "adopt a live team seat", captainSessionId: harness.captain.id, now: new Date() })
  writeCell(harness.workspace, { ...state, teamId: "team-1", phase: "executing" as const, members })
  return cellId
}

/**
 * Publish one live team record under the id the cell points at.
 *
 * @param harness - the harness.
 * @param members - the live roster.
 */
function seedTeam(harness: Harness, members: DoubleMember[]): void {
  harness.teams.set("team-1", { teamId: "team-1", members, tasks: [] })
}

/**
 * The live row of a member added after activation — an executor handle and nothing else the cell knows.
 *
 * A FACTORY, not a constant: the shared `mpdTeamActions` double MUTATES the row it is given (a handoff
 * writes `mode: "checkpoint"`), so two arms sharing one object would leak the first arm's seat into the
 * second.
 *
 * @returns a fresh roster row.
 */
function lateMember(): DoubleMember {
  return { id: "M9", name: "rev-late", role: "Reviewer", status: "running", executorRef: "session-rev-late" }
}

test("B1: a member known ONLY to the team record is adopted and can hand off", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, {})
  seedTeam(harness, [lateMember()])
  /** The mid-run member's handle; the cell record has no row naming it. */
  const late = teammate(harness, "session-rev-late")
  /** The handoff. */
  const result = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, late)
  // The verb proceeded: the seat was adopted BEFORE the lookup, so the row it read is the mirrored one.
  expect(result.ok).toBe(true)
  expect(result.member).toBe("rev-late")
  expect(result.ordinal).toBe(1)
  // The plane recorded the handoff through the shared double, so the seat write is the real contract.
  expect(harness.plane.handoffs).toHaveLength(1)
  expect(harness.plane.handoffs[0]?.sessionId).toBe("session-rev-late")
  /** The record as persisted. */
  const read = readCell(harness.workspace, cellId)
  expect(read.ok).toBe(true)
  /** The adopted row. */
  const row = read.ok ? read.state.members["rev-late"] : undefined
  expect(row).toBeDefined()
  expect(row?.name).toBe("rev-late")
  expect(row?.role).toBe("Reviewer")
  expect(row?.sessionId).toBe("session-rev-late")
  expect(row?.executorRef).toBe("session-rev-late")
  expect(row?.adopted).toBe(true)
  expect(row?.mode).toBe("member")
  // The handoff's own mirror write followed the plane, exactly as for a staged member.
  expect(row?.handoffReady).toBe(true)
  expect(row?.handoffs).toBe(1)
})

test("B1: a session that resolves to NO seat of this cell's team is still refused, and nothing is adopted", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, {})
  seedTeam(harness, [lateMember()])
  /** A session that is on no cell row and on no team row. */
  const stranger = teammate(harness, "session-stranger")
  /** The record BEFORE the call, so an adoption would show up byte for byte. */
  const before = readFileSync(statePath(harness.workspace, cellId), "utf8")
  /** The handoff attempt. */
  const result = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, stranger)
  // EXACTLY the refusal this build already gives: an empty resolution never adopts.
  expect(result.ok).toBe(false)
  expect(result.error).toBe("cellwork_handoff: this session belongs to no active cell")
  expect(readFileSync(statePath(harness.workspace, cellId), "utf8")).toBe(before)
  expect(harness.plane.handoffs).toHaveLength(0)
})

test("B1: an existing fenced row is NOT adopted over — it stays fenced and the verb refuses as today", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** A row the barrier already fenced; its handle is stale, which is why only the team row resolves. */
  const fenced: CellMemberRecord = { name: "rev-late", role: "Reviewer", sessionId: "", executorRef: "", mode: "checkpoint", handoffReady: true, handoffs: 1, fenced: true, fencedReason: "no-engine", joinedAt: "2026-10-31T00:00:00.000Z" }
  /** The cell id. */
  const cellId = seedCell(harness, { "rev-late": fenced })
  seedTeam(harness, [lateMember()])
  /** The record BEFORE the call. */
  const before = readFileSync(statePath(harness.workspace, cellId), "utf8")
  /** The handoff attempt. */
  const result = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, teammate(harness, "session-rev-late"))
  // The seat resolves through the TEAM row, but the cell row is the record's truth: still waiting.
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("STILL WAITING for the compaction barrier")
  expect(readFileSync(statePath(harness.workspace, cellId), "utf8")).toBe(before)
  expect(harness.plane.handoffs).toHaveLength(0)
})

test("B1: adoption itself leaves handoffReady false (and context/status see the member)", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, {})
  seedTeam(harness, [lateMember()])
  /** The mid-run member's handle. */
  const late = teammate(harness, "session-rev-late")
  /** The context read: the first verb this member calls, so it is the call that adopts. */
  const context = await runTool(harness, "cellwork_context", {}, late)
  expect(context.ok).toBe(true)
  expect(context.member).toBe("rev-late")
  expect(context.mode).toBe("member")
  // Adoption is a MIRROR, not a checkpoint: the row is born open.
  /** The record as persisted. */
  const read = readCell(harness.workspace, cellId)
  expect(read.ok).toBe(true)
  /** The adopted row. */
  const row = read.ok ? read.state.members["rev-late"] : undefined
  expect(row?.adopted).toBe(true)
  expect(row?.handoffReady).toBe(false)
  expect(row?.handoffs).toBe(0)
  expect(row?.mode).toBe("member")
  expect(row?.fenced).toBeUndefined()
  expect(row?.sessionId).toBe("session-rev-late")
  // IDEMPOTENT: a second call resolves through the CELL row it just adopted, so nothing is rewritten.
  /** The record after the adopting call. */
  const adopted = readFileSync(statePath(harness.workspace, cellId), "utf8")
  /** A second verb call from the same member. */
  const again = await runTool(harness, "cellwork_context", {}, late)
  expect(again.ok).toBe(true)
  expect(readFileSync(statePath(harness.workspace, cellId), "utf8")).toBe(adopted)
  // The status read reports the adopted member, and the roster is now in sync in both directions.
  /** The status read, as the SAME member. */
  const status = await runTool(harness, "cellwork_status", {}, late)
  expect(status.ok).toBe(true)
  // SHAPE MOVE (W1 §4.2): the status member projection now carries `adopted:true` for a seat adopted from
  // the live roster — the marker the operator surface uses to tell the two histories apart. Pinned here.
  // R3: the projection now carries the seat's LIVENESS and its closure reading. This harness exposes no
  // agents registry, so the honest answer is `unknown` — reported, never suppressed.
  expect(status.members).toEqual([{ name: "rev-late", role: "Reviewer", mode: "member", sessionId: "session-rev-late", liveness: "unknown", closed: false, forceEligible: false, adopted: true }])
  expect(status.memberDivergence).toEqual({ missingFromCell: [], missingFromTeam: [], inSync: true })
  expect(status.seat).toEqual({ name: "rev-late", mode: "member" })
})

test("B1 repair: the GUARD resolves the seat READ-ONLY — a permission check never adopts", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, {})
  // The team-only seat carries the PLANNER name on purpose: the planner rule is what makes the guard's
  // answer prove it RESOLVED this seat, instead of passing every call because it found nothing.
  seedTeam(harness, [{ id: "M9", name: "cell-planner", role: "Planner", status: "running", executorRef: "session-planner-late" }])
  /** The mid-run member's handle; the cell record has no row naming it. */
  const late = teammate(harness, "session-planner-late")
  /** The record BEFORE the guard runs, so ANY write shows up byte for byte. */
  const before = readFileSync(statePath(harness.workspace, cellId), "utf8")
  // TWO dispatches through the predicate the row really installed: one it REFUSES (a source read) and one
  // it ALLOWS (the documentation band). Neither may write — including the refused one.
  expect(String(harness.guard?.({ name: "read", arguments: { file_path: "packages/x/src/y.ts" }, agent: late } as unknown as DshToolExec) ?? "")).toContain("CELL PLANNER")
  expect(harness.guard?.({ name: "read", arguments: { file_path: "docs/a.md" }, agent: late } as unknown as DshToolExec)).toBeUndefined()
  expect(readFileSync(statePath(harness.workspace, cellId), "utf8")).toBe(before)
  /** The record after both dispatches. */
  const afterGuard = readCell(harness.workspace, cellId)
  expect(afterGuard.ok).toBe(true)
  expect(afterGuard.ok ? afterGuard.state.members["cell-planner"] : undefined).toBeUndefined()
  // AND ADOPTION STAYS ON THE VERB PATH: the same member's next cellwork call mirrors the row in.
  /** The member's own context read. */
  const context = await runTool(harness, "cellwork_context", {}, late)
  expect(context.ok).toBe(true)
  expect(context.member).toBe("cell-planner")
  /** The record after the verb. */
  const afterVerb = readCell(harness.workspace, cellId)
  expect(afterVerb.ok ? afterVerb.state.members["cell-planner"]?.adopted : undefined).toBe(true)
})

test("B1 repair: an adoption the record cannot persist refuses BEFORE the team plane is touched", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, {})
  seedTeam(harness, [lateMember()])
  /** The mid-run member's handle; the cell record has no row naming it. */
  const late = teammate(harness, "session-rev-late")
  // THE RECORD BECOMES UNWRITABLE FOR EVERY PROCESS: `writeCell` prepares the cell's subdirectories, and a
  // regular FILE where the split directory belongs makes that preparation throw. A chmod-based arm would
  // be bypassed by a root process, so the trap is a file, not a permission bit — the adopted row then
  // exists only in the caller's in-memory mirror, exactly the state finding 1 describes.
  /** The cell directory this arm breaks. */
  const dir = cellDir(harness.workspace, cellId)
  rmSync(join(dir, CELL_SPLIT_DIR), { recursive: true, force: true })
  writeFileSync(join(dir, CELL_SPLIT_DIR), "occupied")
  /** The handoff attempt. */
  const result = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, late)
  // THE REFUSAL IS TEACHING, and it names the record that could not be written.
  expect(result.ok).toBe(false)
  expect(String(result.error)).toContain("the cell record could not be written")
  expect(String(result.error)).toContain("NOT adopted")
  // THE PLANE WAS NEVER TOUCHED: no team checkpoint without an adopted cell row.
  expect(harness.plane.handoffs).toHaveLength(0)
  /** The record as it persisted: the failed adoption left no row behind. */
  const read = readCell(harness.workspace, cellId)
  expect(read.ok).toBe(true)
  expect(read.ok ? read.state.members["rev-late"] : undefined).toBeUndefined()
  // AND NO HISTORY FOR A ROW THAT NEVER LANDED (repair round 2, finding C-i): the journal line follows
  // the write, so a refused write leaves no `member-adopted` row claiming one.
  /** The journal text, or "" when no journal exists yet. */
  const journal = existsSync(journalPath(harness.workspace, cellId)) ? readFileSync(journalPath(harness.workspace, cellId), "utf8") : ""
  expect(journal).not.toContain("member-adopted")
})

test("B1 repair: an adoption whose fresh READ fails refuses with the READ cause, not a write that never happened", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, {})
  seedTeam(harness, [lateMember()])
  /** The mid-run member's handle; the cell record has no row naming it. */
  const late = teammate(harness, "session-rev-late")
  // THE RECORD BECOMES UNREADABLE BETWEEN THE SCAN AND THE ADOPTION: the TEAM read is the one awaited
  // step between them, so an arm that breaks the file there fails the adoption's FRESH read — the read
  // branch the refusal must name honestly (repair round 2, finding C-ii).
  harness.teamReadHook.run = (): void => { writeFileSync(statePath(harness.workspace, cellId), "{ not a cell record") }
  /** The handoff attempt. */
  const result = await runTool(harness, "cellwork_handoff", { content: HANDOFF_TEXT }, late)
  expect(result.ok).toBe(false)
  /** The refusal sentence, whose headline must name the READ that failed. */
  const error = String(result.error)
  expect(error).toContain("could not be read")
  expect(error).not.toContain("could not be written")
  expect(error).toContain("NOT adopted")
  // THE PLANE WAS NEVER TOUCHED, and no adoption history exists for a row that was never recorded.
  expect(harness.plane.handoffs).toHaveLength(0)
  /** The journal text, or "" when no journal exists yet. */
  const journal = existsSync(journalPath(harness.workspace, cellId)) ? readFileSync(journalPath(harness.workspace, cellId), "utf8") : ""
  expect(journal).not.toContain("member-adopted")
})
