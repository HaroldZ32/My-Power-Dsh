// THE TEAM PLANE IS THE AUTHORITY for the two facts cellwork used to derive itself (contract 4.4/D4,
// wave W2): a seat's CONTEXT OCCUPANCY (`mpdTeams.memberContext`) and a cell's NESTING DEPTH
// (`mpdTeams.depthBudget`).
//
// These arms exist because the fallback is invisible when only the fallback is wired: each one gives the
// team plane a reading that DISAGREES with what cellwork could compute alone, so an answer that matches
// the plane proves the plane was really read. The composition degradation (a plane without those
// members) keeps the previous behaviour and is covered by the rest of the suite, which runs without them.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { readActiveCell, readCell, writeCell } from "../src/state"

/** One captured tool registration, as the fake registry records it. */
interface CapturedTool {
  /** The tool's registered name. */
  name: string
  /** Its execute handler, called the way the harness calls it. */
  execute: (args: unknown, exec: unknown) => Promise<Record<string, any>>
}

/** One fake agent handle: the session the adapter reads its id from. */
interface FakeAgent {
  /** The agent's own id. */
  id: string
  /** The fused session, whose id and header the row reads. */
  session: { id: string; header: Record<string, unknown> }
  /** The turn seam `dsh.injectAgentMessage` / a command's submit writes to. */
  followup: (message: unknown) => void
}

/** What one arm's harness hands back. */
interface Harness {
  /** The fake host context handed to `apply`. */
  ctx: Parameters<typeof apply>[0]
  /** The temp workspace every resolved root points at. */
  workspace: string
  /** The captain's own agent handle. */
  captain: FakeAgent
  /** The tool definitions the fake registry received. */
  tools: CapturedTool[]
  /** The service members this harness's `mpdTeams` publishes, by name. */
  teams: Record<string, unknown>
}

/**
 * Build a minimal harness whose `mpdTeams` service carries the members an arm wants to prove.
 * @param teams - the service members to publish beside the plain `get`.
 * @param extra - further services the same context answers (the adapter's own seams, for instance).
 * @returns the harness.
 */
function makeHarness(teams: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Harness {
  /** The temp workspace every root resolves to. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-plane-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** Tool definitions the plugin registered. */
  const tools: CapturedTool[] = []
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } }, followup: () => {} }
  /** The tool registry the adapter expects. */
  const toolsService = {
    /** Register one definition the plugin contributes. */
    register(definition: CapturedTool): void { tools.push(definition) },
    /** The registry's own view of one name, which is what `dsh.hasTool` probes. */
    get(name: string): unknown { return tools.find((tool) => tool.name === name) },
    // No `guard` member: these arms exercise tools only, and the degraded composition is documented.
    async execute(): Promise<unknown> { return { value: undefined } },
  }
  /** The command registry the adapter expects. */
  const commandsService = { register: (): (() => void) => () => {} }
  /** The services the adapter resolves by name. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    commands: commandsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdConfig: { get: (): unknown => undefined },
    mpdTeams: { get: (): unknown => undefined, ...teams },
    // Anything an arm needs beside the two plane services (the adapter's own meter, for instance).
    ...extra,
  }
  /** The fake host context. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: toolsService,
    /** Run the cleanup callback immediately, as a real `ctx.effect` does at registration time. */
    effect(fn: () => unknown): void { fn() },
    /** Resolve one of the services above; an unknown name is an absent service, never a throw. */
    get(service: string): unknown { return services[service] },
  }
  return { ctx, workspace, captain, tools, teams: services.mpdTeams as Record<string, unknown> }
}

/**
 * Run one registered tool as one agent.
 * @param harness - the harness whose registry holds it.
 * @param name - the tool name.
 * @param args - the arguments.
 * @param agent - the calling agent (defaults to the captain).
 * @returns the tool's structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}, agent: unknown = harness.captain): Promise<Record<string, any>> {
  /** The registration this call needs. */
  const tool = harness.tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error("the harness captured no tool named " + name)
  return await tool.execute(args, { name, agent })
}

/**
 * Open one cell through the programmatic entry and return its id.
 * @param harness - the harness to drive.
 * @returns the created cell id.
 */
async function openCellIn(harness: Harness): Promise<string> {
  /** The opening call's answer. */
  const opened = await runTool(harness, "cellwork_open", { objective: "prove the plane is read" })
  expect(opened.ok).toBe(true)
  return String(opened.cellId)
}

describe("the team plane owns the context reading", () => {
  test("cellwork_context FALLS BACK to the adapter when the plane cannot answer for this seat", async () => {
    // THE CAPTAIN IS NEVER A TEAM MEMBER, so a REAL plane answers `unavailable` (with null numbers) for it —
    // `mpdTeams.memberContext` is total. Accepting that as a reading is the measured regression: after
    // activation the captain read null tokens and `willCheckpoint:false` while the adapter held the meter.
    // This arm FAILS if an `unavailable` (or `no-window`) plane reading is ever taken as an answer again.
    /** The harness whose plane knows no captain and whose adapter observes one window. */
    const harness = makeHarness(
      { memberContext: (): unknown => ({ member: "captain", usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" }) },
      // The ADAPTER's meter: the harness's own projection registry, which is where the host keeps the
      // token meter. Its numbers are deliberately distinct from the plane's (which are absent).
      { sessionProjections: { stateOf: (): unknown => ({ contextWindow: 10000, pressureTokens: 4242 }) } },
    )
    apply(harness.ctx, {})
    /** The active cell. */
    const cellId = await openCellIn(harness)
    /** The record with a team id, so the plane CAN be addressed — it answers, unhelpfully. */
    const read = readCell(harness.workspace, cellId)
    if (!read.ok) throw new Error("expected a cell record")
    writeCell(harness.workspace, { ...read.state, teamId: "team-plane" })
    /** The context call. */
    const context = await runTool(harness, "cellwork_context")
    expect(context.ok).toBe(true)
    // THE ADAPTER'S READING, not the plane's empty one.
    expect(context.provenance).toBe("observed")
    expect(context.usedTokens).toBe(4242)
    expect(context.windowTokens).toBe(10000)
    expect(context.ratio).toBeCloseTo(0.4242, 4)
  })

  test("the PLANE's observed numbers are forwarded when it really knows the seat", async () => {
    // THE OTHER HALF of the same rule: a plane reading WITH an observed window IS the answer. Asserted on a
    // MEMBER row (a name the roster can hold) through the read-only sweep, which reports the same provenance
    // the seat's own row would report.
    /** The harness whose plane observes one member's window. */
    const harness = makeHarness({
      memberContext: (_workspace: string, _teamId: string, member: string): unknown => member === "Reviewer"
        ? { member: "Reviewer", usedTokens: 123, windowTokens: 1000, ratio: 0.123, provenance: "observed" }
        : { member, usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" },
    })
    apply(harness.ctx, {})
    /** The active cell. */
    const cellId = await openCellIn(harness)
    /** The record carrying one member row and the live team id. */
    const read = readCell(harness.workspace, cellId)
    if (!read.ok) throw new Error("expected a cell record")
    writeCell(harness.workspace, {
      ...read.state,
      teamId: "team-plane",
      members: { Reviewer: { name: "Reviewer", role: "Reviewer", sessionId: "session-reviewer", executorRef: "exec-reviewer", mode: "member", handoffReady: false, handoffs: 0, joinedAt: "" } },
    })
    /** The sweep. */
    const sweep = await runTool(harness, "cellwork_supervise")
    expect(sweep.ok).toBe(true)
    /** The member row the sweep reported. */
    const row = (sweep.members as Array<Record<string, unknown>>).find((member) => member.name === "Reviewer")
    // THE PLANE'S NUMBERS AND PROVENANCE, verbatim.
    expect(row?.provenance).toBe("observed")
    expect(row?.usedTokens).toBe(123)
    expect(row?.windowTokens).toBe(1000)
    expect(row?.ratio).toBe(0.123)
  })
})

describe("the team plane owns the depth decision", () => {
  test("cellwork_subteam bounds the child by mpdTeams.depthBudget, not by the cell record", async () => {
    // THE PLANE REPORTS A DEEPER CELL than the record does (the record is a root cell, depth 0), so a
    // refusal that names depth 6 and bound 3 can only come from the plane's own reading.
    /** The harness whose plane answers a depth-5 team at bound 3. */
    const harness = makeHarness({
      depthBudget: (): unknown => ({ teamId: "team-plane", depth: 5, depthMax: 3, remaining: 0 }),
    })
    apply(harness.ctx, {})
    /** The active cell. */
    const cellId = await openCellIn(harness)
    // A PROMOTED SUBCAPTAIN SEAT: the tool admits a promoted member (or the captain of a sub-cell), and
    // the seat is what the caller resolution reads.
    /** The record carrying the promoting seat and the live team id. */
    const read = readCell(harness.workspace, cellId)
    if (!read.ok) throw new Error("expected a cell record")
    writeCell(harness.workspace, {
      ...read.state,
      teamId: "team-plane",
      members: { sub: { name: "sub", role: "Deep Worker", sessionId: "session-sub", executorRef: "exec-sub", mode: "subcaptain", handoffReady: false, handoffs: 0, joinedAt: "" } },
    })
    /** The subcaptain's own handle. */
    const sub = { id: "session-sub", session: { id: "session-sub", header: { cwd: harness.workspace } } }
    /** The refusal the depth bound answers. */
    const refused = await runTool(harness, "cellwork_subteam", { objective: "nest deeper" }, sub)
    expect(refused.ok).toBe(false)
    expect(String(refused.error)).toContain("depth 6")
    expect(String(refused.error)).toContain("cellwork.depth.max = 3")
    // NOTHING WAS REGISTERED: the refusal happens before the sub-cell is minted.
    /** The workspace's active cells after the refusal. */
    const active = readActiveCell(harness.workspace)
    expect(active.ok ? active.cell?.state.subcellIds ?? [] : []).toEqual([])
  })
})
