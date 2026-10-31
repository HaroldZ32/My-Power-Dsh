// OFFLINE PROOF OF THE ROSTER RECONCILIATION `cellwork_status` REPORTS (contract C11, defect D11): the
// cell record's member table and the live team roster can diverge — the VEdit cell knew 7 members while
// the live team carried 13 — and the status read must NAME the divergence in both directions without
// mutating either side.
//
// The harness is deliberately minimal: it applies the plugin to a fake ctx, writes ONE cell record by
// hand and answers the team service from an in-memory map, so the arm proves the READ rather than the
// staging flow that produced the record.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { newCellState, statePath, writeCell } from "../src/state.ts"

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
  teams: Map<string, Record<string, any>>
}

/**
 * Build the minimal harness and apply the plugin once.
 *
 * @returns the harness.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-status-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** Captured tool definitions. */
  const tools: CapturedTool[] = []
  /** Live team records, by id. */
  const teams = new Map<string, Record<string, any>>()
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } } }
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
  }
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
      get: (_workspace: string, teamId: string): Record<string, any> | undefined => teams.get(teamId),
    },
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
  return { workspace, captain, tools, teams }
}

/**
 * Run one captured tool as the captain.
 *
 * @param harness - the harness.
 * @param name - the tool name.
 * @param args - its arguments.
 * @returns the structured result.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  /** The captured definition. */
  const tool = harness.tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  return await tool.execute(args, { name, agent: harness.captain }) as Record<string, any>
}

/**
 * Write one cell record whose member table carries the given names.
 *
 * @param harness - the harness.
 * @param names - the member names the CELL record knows.
 * @returns the cell id.
 */
function seedCell(harness: Harness, names: readonly string[]): string {
  /** The cell id; it must start with `cell-` so the active-cell reader finds it. */
  const cellId = "cell-status-reconcile"
  /** A fresh record for the cell. */
  const state = newCellState({ cellId, objective: "reconcile the roster", captainSessionId: harness.captain.id, now: new Date() })
  /** The record with the member table and a team id attached. */
  const seeded = { ...state, teamId: "team-1", phase: "executing" as const, members: Object.fromEntries(names.map((name) => [name, { name, role: name === "se-alpha" || name === "se-beta" ? "Senior Engineer" : "Reviewer", sessionId: "session-" + name, executorRef: "session-" + name, mode: "member" as const, handoffReady: false, handoffs: 0, joinedAt: new Date().toISOString() }])) }
  writeCell(harness.workspace, seeded)
  return cellId
}

test("C11/D11: the status read NAMES members missing on each side and never mutates either", async () => {
  /** The harness. */
  const harness = makeHarness()
  // The CELL record knows two members; the LIVE roster carries a third and has lost one of the two.
  /** The cell id. */
  const cellId = seedCell(harness, ["se-alpha", "se-beta"])
  harness.teams.set("team-1", { teamId: "team-1", members: [{ name: "se-alpha" }, { name: "rev-alpha" }, { name: "rev-beta" }], tasks: [] })
  /** The state file BEFORE the read, so a mutation would show up byte for byte. */
  const before = readFileSync(statePath(harness.workspace, cellId), "utf8")
  /** The status read. */
  const status = await runTool(harness, "cellwork_status", {})
  expect(status.ok).toBe(true)
  // The live roster carries two members the cell never learned, and the cell carries one the roster lost.
  expect(status.memberDivergence.missingFromCell.sort()).toEqual(["rev-alpha", "rev-beta"])
  expect(status.memberDivergence.missingFromTeam).toEqual(["se-beta"])
  expect(status.memberDivergence.inSync).toBe(false)
  // REPORT-ONLY: neither the record nor the roster moved.
  expect(readFileSync(statePath(harness.workspace, cellId), "utf8")).toBe(before)
  expect(harness.teams.get("team-1")?.members.map((row: Record<string, any>) => row.name)).toEqual(["se-alpha", "rev-alpha", "rev-beta"])
})

test("C11/D11: an in-sync roster reports inSync with two empty lists", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = seedCell(harness, ["se-alpha", "rev-beta"])
  harness.teams.set("team-1", { teamId: "team-1", members: [{ name: "se-alpha" }, { name: "rev-beta" }], tasks: [] })
  /** The status read. */
  const status = await runTool(harness, "cellwork_status", {})
  expect(status.ok).toBe(true)
  expect(status.memberDivergence).toEqual({ missingFromCell: [], missingFromTeam: [], inSync: true })
  expect(status.cellId).toBe(cellId)
})

test("C11/D11: with no readable team the read reports nothing to compare instead of failing", async () => {
  /** The harness. */
  const harness = makeHarness()
  seedCell(harness, ["se-alpha"])
  // No team record is registered, so the live side is UNKNOWN — not empty.
  /** The status read. */
  const status = await runTool(harness, "cellwork_status", {})
  expect(status.ok).toBe(true)
  expect(status.memberDivergence).toEqual({ missingFromCell: [], missingFromTeam: [], inSync: true })
})

test("C11: the status read exposes the recorded split ticket id, so a lost owner cannot hide it", async () => {
  /** The harness. */
  const harness = makeHarness()
  // The CELL record knows the split ticket's board id even though the live row lost its owner.
  /** The cell id. */
  const cellId = "cell-status-split-ticket"
  /** A fresh record carrying the recorded board id. */
  const state = newCellState({ cellId, objective: "keep the ticket findable", captainSessionId: harness.captain.id, now: new Date() })
  writeCell(harness.workspace, { ...state, teamId: "team-1", splitTaskId: "T2", phase: "split" as const })
  harness.teams.set("team-1", { teamId: "team-1", members: [], tasks: [{ id: "T2", subject: "split", owner: "", status: "pending" }] })
  /** The status read. */
  const status = await runTool(harness, "cellwork_status", {})
  expect(status.ok).toBe(true)
  expect(status.splitTaskId).toBe("T2")
})
