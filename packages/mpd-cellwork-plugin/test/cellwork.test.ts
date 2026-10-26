// Offline tests for the cellwork core (Wave 2, contract B1/B2/B3/B10).
//
// WHAT IS PROVEN HERE, and what deliberately is not. These arms exercise the plugin through the SAME
// adapter entry points the host uses — `apply(ctx, config)` with a fake ctx, the command definition the
// adapter received, the tool definitions it received, and the ONE guard predicate it installed — so the
// command surface, the guard decisions per mode, the state store's atomicity and corruption refusal and
// the start/status/stop lifecycle are proven without a harness. What is NOT proven here is that a real
// boot mounts the row: that is the mounted-boot gate's job, and this file never claims it.
//
// No arm touches the repository's own state: every workspace is a fresh temp directory and every
// assertion reads what the plugin wrote there.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply, inject } from "../src/index.ts"
import { CAPTAIN_TOOL_NAMES, CHECKPOINT_ALLOW_TOOLS, FILE_WORK_TOOLS, SUBCAPTAIN_FORBIDDEN_NAMES, SUBCAPTAIN_TOOL_NAMES, VERIFIER_DENY_TOOLS, cellworkGuardDecision, type CellworkSeat } from "../src/guard.ts"
import { CELLWORK_STATE_VERSION, cellDir, cellworkRoot, journalPath, listCellIds, newCellState, readActiveCell, readCell, statePath, writeCell } from "../src/state.ts"

/** One fake live agent: the id the harness fuses into a dispatch, and its session header. */
interface FakeAgent {
  /** The agent id, which the adapter's session-id readers fall back to. */
  id: string
  /** The session the workspace root is read from (`session.header.cwd`). */
  session: { id: string; header: { cwd: string } }
  /**
   * The agent's own turn seam.
   *
   * The adapter binds `invocation.submit` to `submitUserTurn(host.agent, message)`, which calls THIS
   * method, so a fake WITHOUT it is the honest "no live turn surface" composition.
   */
  followup?: (message: unknown) => void
}

/** One tool definition the fake registry captured, typed for the fields these arms read. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The model-facing description. */
  description?: string
  /** The JSON-schema parameter object. */
  parameters?: Record<string, unknown>
  /** The runner these arms call directly; the adapter wraps every definition asynchronously. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One command definition the fake registry captured. */
interface CapturedCommand {
  /** The registered name (no leading slash). */
  name: string
  /** The model-facing description. */
  description?: string
  /** The advertised input hint. */
  input?: { hint?: string }
  /** The handler the adapter wrapped; calling it exercises the full command seam. */
  handler: (invocation: unknown) => { kind: "error" | "success"; text: string }
}

/** What the fake harness hands back to an arm. */
interface Harness {
  /** The fake host context handed to `apply`. */
  ctx: Parameters<typeof apply>[0]
  /** The temp workspace every resolved root points at. */
  workspace: string
  /** The captain's own agent handle. */
  captain: FakeAgent
  /** Tool definitions the fake registry received, in registration order. */
  tools: CapturedTool[]
  /** Command definitions the fake registry received, in registration order. */
  commands: CapturedCommand[]
  /** The guard predicates the plugin installed. */
  guards: Array<(exec: { name?: string; agent?: unknown }) => string | undefined | void>
  /** The user-role messages the fake turn seam received. */
  submitted: Array<Record<string, any>>
  /** A live team record the `mpdTeams` service answers with, by id. */
  teams: Map<string, unknown>
}

/**
 * A minimal fake harness: tool registry, command registry, guard seam, one live agent, config and team
 * services, and a temp workspace.
 *
 * `DSH_WORKSPACE_ROOT` is pointed at the temp workspace so the row's OWN log sink lands there instead of
 * in the repository's `.mpd`: a dispatch-less `rowLog` falls through to that env value.
 *
 * @param options - `withGuard: false` omits the `tools.guard` seam (the degraded composition).
 * @returns the harness plus the two captured definition lists.
 */
function makeHarness(options: { withGuard?: boolean } = {}): Harness {
  /** The temp workspace every root in this arm resolves to. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** Tool definitions the plugin registered. */
  const tools: CapturedTool[] = []
  /** Command definitions the plugin registered. */
  const commands: CapturedCommand[] = []
  /** Guard predicates the plugin installed through `tools.guard`. */
  const guards: Array<(exec: { name?: string; agent?: unknown }) => string | undefined | void> = []
  /** Messages the fake turn seam received. */
  const submitted: Array<Record<string, any>> = []
  /** Team records the `mpdTeams` service can answer with. */
  const teams = new Map<string, unknown>()
  /** The staged plan the fake `agent_teams_plan` double builds (Amendment 3 staging). */
  let stagedPlan: Record<string, any> | null = null
  /** The live team the fake approval mints. */
  let stagedTeam: Record<string, any> | null = null
  /** The captain's handle: id + session id + the workspace its header names + its turn seam. */
  const captain: FakeAgent = {
    id: "session-captain",
    session: { id: "session-captain", header: { cwd: workspace } },
    followup: (message: unknown): void => { submitted.push(message as Record<string, any>) },
  }
  /** The tool registry, modelled on the host's own: register, look up, execute, guard. */
  const toolsService: Record<string, unknown> = {
    /** Register one definition the plugin contributes. */
    register(definition: CapturedTool): void { tools.push(definition) },
    /** The registry's own view of one name, which is what `dsh.hasTool` probes. */
    get(name: string): unknown { return tools.find((tool) => tool.name === name) },
    /**
     * Execute one tool by name.
     *
     * `cellwork_start` stages the two-member planning team through `agent_teams_plan` (Amendment 3), so
     * this double answers that ONE flow with an in-memory plan and team; every other tool name is a
     * no-op result, which is what this file's arms expect.
     */
    async execute(input: { name?: string; arguments?: Record<string, any> }): Promise<unknown> {
      /** The tool name. */
      const toolName = String(input?.name ?? "")
      /** Its arguments. */
      const args = input?.arguments ?? {}
      if (toolName !== "agent_teams_plan") return { value: undefined }
      /** The requested plan action. */
      const action = String(args.action ?? "")
      if (action === "status") return { isError: false, value: { plan: stagedPlan, team: stagedTeam } }
      if (action === "create") {
        stagedPlan = { planId: "plan-1", name: args.name, description: args.description, members: [], tasks: [] }
        return { isError: false, value: { plan: stagedPlan } }
      }
      if (action === "add_member") {
        stagedPlan?.members.push(args.member)
        return { isError: false, value: { plan: stagedPlan } }
      }
      if (action === "create_task") {
        stagedPlan?.tasks.push(args.task)
        return { isError: false, value: { plan: stagedPlan } }
      }
      if (action === "approve") {
        /** The members the staged plan asked for, with the handles the approval mints. */
        const members = (stagedPlan?.members ?? []).map((member: Record<string, any>, index: number) => ({ id: "M" + String(index + 1), name: member.name, role: member.role, executorRef: "handle-" + String(member.name) }))
        stagedTeam = { teamId: "team-1", members, tasks: [] }
        return { isError: false, value: { plan: { ...stagedPlan, approvedAt: "now" }, team: stagedTeam, created: { members: members.map((member: Record<string, any>) => ({ name: member.name, id: member.executorRef })), tasks: [] } } }
      }
      return { value: undefined }
    },
  }
  if (options.withGuard !== false) {
    // The guard seam exists exactly when the tools service exposes `guard` — that is also how the
    // adapter's `capabilities().toolsGuard` probe decides whether a guard can be installed at all.
    toolsService.guard = (predicate: (exec: { name?: string; agent?: unknown }) => string | undefined): (() => void) => {
      guards.push(predicate)
      return () => {
        /** Where that predicate sits, -1 once it was already removed. */
        const at = guards.indexOf(predicate)
        if (at >= 0) guards.splice(at, 1)
      }
    }
  }
  /** The command registry, modelled on the host's own. */
  const commandsService = {
    /** Register one definition and answer its unregister function. */
    register(definition: CapturedCommand): () => void {
      commands.push(definition)
      return () => {
        /** Where that definition sits, -1 once it was already removed. */
        const at = commands.indexOf(definition)
        if (at >= 0) commands.splice(at, 1)
      }
    },
  }
  /** The services the adapter resolves by name; `mpdConfig` answers nothing by default. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    commands: commandsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdConfig: { get: (): unknown => undefined },
    mpdTeams: { get: (_workspace: string, teamId: string): unknown => teams.get(teamId) },
  }
  /** The fake host context, one member per seam the row reads. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: toolsService,
    // Run the cleanup callback immediately, as a real ctx.effect does at registration time.
    effect(fn: () => unknown): void { fn() },
    // Resolve one of the services above; an unknown name is an absent service, never a throw.
    get(service: string): unknown { return services[service] },
  }
  return { ctx, workspace, captain, tools, commands, guards, submitted, teams }
}

/**
 * Run the one command the harness captured.
 *
 * The ADAPTER owns `invocation.submit` (it binds the invoking agent's turn seam), so an arm exercises
 * the delivery half by choosing the AGENT: one with a `followup` seam accepts, one without it reports
 * the refusal the command must handle.
 *
 * @param harness - the fake harness.
 * @param rawInput - the text after the command name.
 * @param agent - the invoking agent handle; the captain by default.
 * @returns the handler's own answer.
 */
function runCommand(harness: Harness, rawInput: string, agent: unknown = harness.captain): { kind: "error" | "success"; text: string } {
  /** The one captured command. */
  const command = harness.commands[0]
  if (command === undefined) throw new Error("the test harness captured no command")
  return command.handler({ rawInput, agent })
}

/**
 * A session with no live turn seam — the composition in which a command must not leave a cell active.
 *
 * @param harness - the fake harness.
 * @returns the handle.
 */
function agentWithoutTurn(harness: Harness): FakeAgent {
  return { id: "session-headless", session: { id: "session-headless", header: { cwd: harness.workspace } } }
}

/**
 * Call one captured tool by name.
 *
 * @param harness - the fake harness.
 * @param name - the tool to call.
 * @param args - its arguments.
 * @param agent - the calling agent handle; the captain by default.
 * @returns the tool's structured result, read as a record.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}, agent: unknown = harness.captain): Promise<Record<string, any>> {
  /** The definition of the tool asked about. */
  const tool = harness.tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error("the test harness captured no tool named " + name)
  return await tool.execute(args, { name, agent }) as Record<string, any>
}

/**
 * Create one cell through the command, the only legal way, and return its id.
 *
 * @param harness - the fake harness.
 * @param objective - the objective text.
 * @returns the created cell id.
 */
function createCell(harness: Harness, objective: string = "ship the widget"): string {
  /** The command's answer. */
  const answer = runCommand(harness, objective)
  if (answer.kind !== "success") throw new Error("the command refused: " + answer.text)
  /** The workspace's active cell, which the command just created. */
  const active = readActiveCell(harness.workspace)
  if (!active.ok || active.cell === null) throw new Error("the command reported success but wrote no active cell")
  return active.cell.state.cellId
}

/**
 * A second agent handle whose session is neither the captain nor a member.
 *
 * @param harness - the fake harness.
 * @param id - the stranger's session id.
 * @returns the handle.
 */
function stranger(harness: Harness, id: string = "session-stranger"): FakeAgent {
  return { id, session: { id, header: { cwd: harness.workspace } } }
}

/**
 * The journal of one cell, one parsed entry per line.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell whose history is read.
 * @returns the entries, in append order.
 */
function journalEntries(workspace: string, cellId: string): Array<Record<string, unknown>> {
  /** The raw journal text. */
  const text = readFileSync(journalPath(workspace, cellId), "utf8")
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
}

// ── B1: the command surface ─────────────────────────────────────────────────

test("the plugin declares the tool and command seams and registers exactly one /cellwork command", () => {
  expect(inject).toContain("tools")
  expect(inject).toContain("commands")
  /** The harness the row is applied to. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  expect(harness.commands).toHaveLength(1)
  expect(harness.commands[0].name).toBe("cellwork")
  expect(typeof harness.commands[0].input?.hint).toBe("string")
  expect((harness.commands[0].input?.hint ?? "").length).toBeGreaterThan(0)
  expect((harness.commands[0].description ?? "").length).toBeGreaterThan(0)
})

test("an empty or whitespace /cellwork answers usage and writes NO cell state", () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  for (const rawInput of ["", "   ", "\t\n "]) {
    /** That invocation's answer. */
    const answer = runCommand(harness, rawInput)
    expect(answer.kind).toBe("error")
    expect(answer.text).toContain("/cellwork")
  }
  expect(harness.submitted).toHaveLength(0)
  // The row's own log sink may have written under `.mpd/logs`; the CELL root must not exist at all.
  expect(existsSync(cellworkRoot(harness.workspace))).toBe(false)
})

test("a non-empty /cellwork writes the cell record and submits exactly ONE directive", () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** The command's answer. */
  const answer = runCommand(harness, "  ship the widget  ")
  expect(answer.kind).toBe("success")
  /** The record the command wrote. */
  const active = readActiveCell(harness.workspace)
  expect(active.ok).toBe(true)
  if (!active.ok || active.cell === null) throw new Error("expected an active cell")
  expect(active.cell.state.phase).toBe("requirements")
  expect(active.cell.state.objective).toBe("ship the widget")
  expect(active.cell.state.captainSessionId).toBe("session-captain")
  expect(active.cell.state.version).toBe(CELLWORK_STATE_VERSION)
  expect(active.cell.state.cellId.startsWith("cell-")).toBe(true)
  expect(existsSync(statePath(harness.workspace, active.cell.state.cellId))).toBe(true)
  expect(journalEntries(harness.workspace, active.cell.state.cellId)).toHaveLength(1)
  // EXACTLY ONE directive, produced by this plugin, carrying the cell id.
  expect(harness.submitted).toHaveLength(1)
  expect(harness.submitted[0].role).toBe("user")
  expect(harness.submitted[0].source?.kind).toBe("mpd-cellwork")
  expect(JSON.stringify(harness.submitted[0].content)).toContain(active.cell.state.cellId)
})

test("a second /cellwork while one cell is active REFUSES and names the active cell", () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** The first cell's id. */
  const cellId = createCell(harness)
  /** The second invocation's answer. */
  const second = runCommand(harness, "another objective")
  expect(second.kind).toBe("error")
  expect(second.text).toContain(cellId)
  expect(listCellIds(harness.workspace)).toHaveLength(1)
  expect(harness.submitted).toHaveLength(1)
})

test("/cellwork with no live turn surface archives the cell it just wrote instead of fencing a captain", () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** The refusing invocation's answer. */
  const answer = runCommand(harness, "ship the widget", agentWithoutTurn(harness))
  expect(answer.kind).toBe("error")
  // The record exists (nothing is deleted) but the mode is NOT active.
  expect(listCellIds(harness.workspace)).toHaveLength(1)
  /** The archived record. */
  const archived = readCell(harness.workspace, listCellIds(harness.workspace)[0])
  expect(archived.ok).toBe(true)
  if (!archived.ok) throw new Error("expected a record")
  expect(archived.state.phase).toBe("stopped")
  expect(archived.state.archived).toBe(true)
  expect(archived.state.stopReason).toBe("no-live-turn-surface")
  /** The workspace scan after the archive. */
  const active = readActiveCell(harness.workspace)
  expect(active.ok && active.cell === null).toBe(true)
})

// ── B2: the dispatch-only captain guard ─────────────────────────────────────

test("the pure guard decision: no seat allows, and each mode refuses exactly its own surface", () => {
  // No cell → nothing is refused, whatever the tool.
  expect(cellworkGuardDecision(undefined, "write")).toBeUndefined()
  expect(cellworkGuardDecision(undefined, "bash")).toBeUndefined()
  /** The captain's seat. */
  const captain: CellworkSeat = { cellId: "cell-x", name: "captain", mode: "captain" }
  for (const allowed of ["cellwork_status", "cellwork_start", "cellwork_stop", "agent_teams_plan", "agent_teams_task", "ask_user_question", "todo_write", "mpd_memory_write", ...CAPTAIN_TOOL_NAMES]) {
    expect(cellworkGuardDecision(captain, allowed)).toBeUndefined()
  }
  for (const refused of ["write", "edit", "bash", "read", "grep", "mcp__ast_grep__scan", "cellwork_handoff", "mpd_verify_record"]) {
    /** The refusal paragraph. */
    const decision = cellworkGuardDecision(captain, refused)
    expect(typeof decision).toBe("string")
    expect(decision ?? "").toContain(refused)
    expect(decision ?? "").toContain("cellwork_stop")
  }
  /** The verifier's seat. */
  const verifier: CellworkSeat = { cellId: "cell-x", name: "reviewer", mode: "verifier" }
  for (const refused of VERIFIER_DENY_TOOLS) expect(cellworkGuardDecision(verifier, refused)).toContain(refused)
  for (const allowed of ["read", "grep", "glob", "bash", "mpd_verify_record", "mpd_verify_evidence"]) expect(cellworkGuardDecision(verifier, allowed)).toBeUndefined()
  /** The checkpointed member's seat. */
  const checkpoint: CellworkSeat = { cellId: "cell-x", name: "worker", mode: "checkpoint" }
  for (const allowed of CHECKPOINT_ALLOW_TOOLS) expect(cellworkGuardDecision(checkpoint, allowed)).toBeUndefined()
  for (const refused of ["read", "write", "bash", "cellwork_start", "agent_teams_task"]) {
    /** The checkpoint refusal. */
    const decision = cellworkGuardDecision(checkpoint, refused)
    expect(decision ?? "").toContain(refused)
    expect(decision ?? "").toContain("cellwork_handoff")
  }
  // A SUBCAPTAIN is a MINI-CAPTAIN (Amendment 4, contract B2): it dispatches the next level down and
  // gets NO file-work tool. Every write-capable name is refused...
  /** The subcaptain's seat. */
  const subcaptain: CellworkSeat = { cellId: "cell-x", name: "sub", mode: "subcaptain" }
  for (const refused of [...FILE_WORK_TOOLS, ...SUBCAPTAIN_FORBIDDEN_NAMES]) {
    /** The refusal paragraph. */
    const decision = cellworkGuardDecision(subcaptain, refused)
    expect(typeof decision).toBe("string")
    expect(decision ?? "").toContain(refused)
    expect(decision ?? "").toContain("SUBCAPTAIN")
    // It must not teach a call the seat cannot make: the paragraph names only the captain as the owner
    // of the two lifecycle verbs.
    expect(decision ?? "").toContain("Only the CAPTAIN opens or closes a cell")
  }
  // ...and the dispatch surface — including the four sub-cell verbs — stays open.
  for (const allowed of [...SUBCAPTAIN_TOOL_NAMES, "agent_teams_plan", "agent_teams_dispatch", "ask_user_question", "todo_write", "mpd_memory_write", "cellwork_status", "cellwork_send"]) {
    expect(cellworkGuardDecision(subcaptain, allowed)).toBeUndefined()
  }
  // A plain member is an ordinary worker.
  expect(cellworkGuardDecision({ cellId: "cell-x", name: "worker", mode: "member" }, "write")).toBeUndefined()
})

test("the installed guard fences the captain of the ACTIVE cell and leaves every other session alone", () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  expect(harness.guards).toHaveLength(1)
  /** The one predicate the plugin installed. */
  const guard = harness.guards[0]
  // Before any cell exists, even the captain's own session is untouched.
  expect(guard({ name: "write", agent: harness.captain })).toBeUndefined()
  /** The active cell's id. */
  const cellId = createCell(harness)
  /** The captain's refused write. */
  const refused = guard({ name: "write", agent: harness.captain })
  expect(typeof refused).toBe("string")
  expect(String(refused)).toContain("write")
  expect(String(refused)).toContain("cellwork_stop")
  // Allowed for the captain, and untouched for a session in no cell.
  expect(guard({ name: "agent_teams_plan", agent: harness.captain })).toBeUndefined()
  expect(guard({ name: "write", agent: stranger(harness) })).toBeUndefined()
  expect(guard({ name: "", agent: harness.captain })).toBeUndefined()
  expect(cellId.length).toBeGreaterThan(0)
})

test("a composition without the tools.guard seam installs nothing and says so", () => {
  /** The harness, with the guard seam omitted. */
  const harness = makeHarness({ withGuard: false })
  expect(() => apply(harness.ctx, {})).not.toThrow()
  expect(harness.guards).toHaveLength(0)
  // The tools and the command are still registered: the mode still records and still refuses on its
  // own tools; only the dispatch fence is absent.
  expect(harness.commands).toHaveLength(1)
  expect(harness.tools.map((tool) => tool.name).sort()).toEqual([
    "cellwork_activate", "cellwork_context", "cellwork_dispatch", "cellwork_handoff", "cellwork_inbox",
    "cellwork_recon", "cellwork_requirements", "cellwork_send", "cellwork_split", "cellwork_start",
    "cellwork_status", "cellwork_stop", "cellwork_subteam", "cellwork_supervise",
  ])
})

test("the installed guard fences a SUBCAPTAIN seat as a mini-captain, while the captain keeps start/stop", () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** The active cell's id. */
  const cellId = createCell(harness)
  /** The record, so a subcaptain member can be placed on it. */
  const record = readCell(harness.workspace, cellId)
  if (!record.ok) throw new Error("expected a record")
  writeCell(harness.workspace, {
    ...record.state,
    members: { sub: { name: "sub", role: "Deep Worker", sessionId: "session-sub", executorRef: "exec-sub", mode: "subcaptain", handoffReady: false, handoffs: 0, joinedAt: "" } },
  })
  /** The one predicate the plugin installed. */
  const guard = harness.guards[0]
  /** The promoted member's own handle. */
  const sub = stranger(harness, "session-sub")
  // The sub-cell verbs and the team plane are open; the work surface and the lifecycle verbs are not.
  expect(guard({ name: "cellwork_subteam", agent: sub })).toBeUndefined()
  expect(guard({ name: "cellwork_dispatch", agent: sub })).toBeUndefined()
  expect(guard({ name: "agent_teams_task", agent: sub })).toBeUndefined()
  for (const refused of ["write", "edit", "bash", "cellwork_start", "cellwork_stop"]) {
    /** That call's refusal. */
    const decision = guard({ name: refused, agent: sub })
    expect(typeof decision).toBe("string")
    expect(String(decision)).toContain(refused)
  }
  // The CAPTAIN keeps both lifecycle verbs.
  expect(guard({ name: "cellwork_start", agent: harness.captain })).toBeUndefined()
  expect(guard({ name: "cellwork_stop", agent: harness.captain })).toBeUndefined()
  // And a session in no cell is still untouched.
  expect(guard({ name: "write", agent: stranger(harness) })).toBeUndefined()
})

// ── B3: the state store ─────────────────────────────────────────────────────

test("a record round-trips through an atomic write and leaves no temporary file behind", () => {
  /** A temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-state-"))
  /** A fresh record for a fixed instant. */
  const state = newCellState({ cellId: "cell-20260101T000000000Z", objective: "o", captainSessionId: "s", now: new Date("2026-01-01T00:00:00.000Z") })
  /** The record as written. */
  const written = writeCell(workspace, state)
  expect(written.updatedAt.length).toBeGreaterThan(0)
  /** The read-back record. */
  const read = readCell(workspace, state.cellId)
  expect(read.ok).toBe(true)
  if (!read.ok) throw new Error("expected a read")
  expect(read.state.cellId).toBe(state.cellId)
  expect(read.state.objective).toBe("o")
  expect(read.state.captainSessionId).toBe("s")
  expect(read.state.stopReason).toBe("")
  // Atomicity's visible half: the directory holds the record and no `.tmp-` sibling.
  expect(readdirSync(cellDir(workspace, state.cellId)).filter((name) => name.includes(".tmp-"))).toHaveLength(0)
})

test("a corrupt state is REFUSED with its path, never reset, and the command refuses on it", async () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** A cell directory whose record is not JSON. */
  const cellId = "cell-20260101T000000000Z"
  mkdirSync(cellDir(harness.workspace, cellId), { recursive: true })
  writeFileSync(statePath(harness.workspace, cellId), "{ this is not json", "utf8")
  /** The scan's answer. */
  const scan = readActiveCell(harness.workspace)
  expect(scan.ok).toBe(false)
  if (scan.ok) throw new Error("a corrupt record must not scan as absent")
  expect(scan.reason).toBe("corrupt")
  expect(scan.detail.length).toBeGreaterThan(0)
  expect(scan.path).toBe(statePath(harness.workspace, cellId))
  // The COMMAND refuses and names the path; it writes nothing (the broken bytes are untouched).
  /** The refusing invocation's answer. */
  const answer = runCommand(harness, "start something")
  expect(answer.kind).toBe("error")
  expect(answer.text).toContain(statePath(harness.workspace, cellId))
  expect(readFileSync(statePath(harness.workspace, cellId), "utf8")).toBe("{ this is not json")
  expect(listCellIds(harness.workspace)).toHaveLength(1)
  expect(harness.submitted).toHaveLength(0)
  // The status tool refuses the same way, with the path.
  /** The status refusal. */
  const status = await runTool(harness, "cellwork_status")
  expect(status.ok).toBe(false)
  expect(String(status.path)).toBe(statePath(harness.workspace, cellId))
})

test("an unreadable schema VERSION is refused and named, not migrated or reset", () => {
  /** A temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-version-"))
  /** A cell directory carrying a record from a future schema. */
  const cellId = "cell-20260101T000000000Z"
  mkdirSync(cellDir(workspace, cellId), { recursive: true })
  writeFileSync(statePath(workspace, cellId), JSON.stringify({ version: CELLWORK_STATE_VERSION + 1, cellId, phase: "requirements", captainSessionId: "s" }), "utf8")
  /** The read's answer. */
  const read = readCell(workspace, cellId)
  expect(read.ok).toBe(false)
  if (read.ok) throw new Error("a future version must be refused")
  expect(read.reason).toBe("version")
  expect(read.detail).toContain(String(CELLWORK_STATE_VERSION + 1))
  expect(read.path).toBe(statePath(workspace, cellId))
})

// ── the three tools ────────────────────────────────────────────────────────

test("cellwork_status reports the cell, the live team's counts and the caller's own seat", async () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  // No cell yet: a refusal that names the entry point.
  /** The refusal before any cell exists. */
  const before = await runTool(harness, "cellwork_status")
  expect(before.ok).toBe(false)
  expect(String(before.error)).toContain("/cellwork")
  /** The active cell's id. */
  const cellId = createCell(harness)
  /** The status result. */
  const status = await runTool(harness, "cellwork_status")
  expect(status.ok).toBe(true)
  expect(status.cellId).toBe(cellId)
  expect(status.phase).toBe("requirements")
  expect(status.objective).toBe("ship the widget")
  expect(status.captainSessionId).toBe("session-captain")
  expect(status.members).toEqual([])
  expect(status.checkpoints).toBe(0)
  expect(status.teamId).toBe("")
  expect(status.seat).toEqual({ name: "captain", mode: "captain" })
  expect(String(status.statePath)).toBe(statePath(harness.workspace, cellId))
  // A member session reports no seat of its own, and the read still answers.
  /** The stranger's status read. */
  const strangerStatus = await runTool(harness, "cellwork_status", {}, stranger(harness))
  expect(strangerStatus.ok).toBe(true)
  expect(strangerStatus.seat).toBeNull()
})

test("cellwork_start is captain-only, idempotent, and NEVER creates a cell", async () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  // No cell: the tool refuses and points at the command instead of creating one.
  /** The refusal before any cell exists. */
  const before = await runTool(harness, "cellwork_start")
  expect(before.ok).toBe(false)
  expect(String(before.error)).toContain("/cellwork")
  expect(listCellIds(harness.workspace)).toHaveLength(0)
  /** The active cell's id. */
  const cellId = createCell(harness)
  // A stranger session can never start the cell.
  /** The non-captain's refusal. */
  const foreign = await runTool(harness, "cellwork_start", {}, stranger(harness))
  expect(foreign.ok).toBe(false)
  expect(String(foreign.error)).toContain("CAPTAIN-ONLY")
  /** The captain's first start. */
  const first = await runTool(harness, "cellwork_start")
  expect(first.ok).toBe(true)
  expect(first.cellId).toBe(cellId)
  expect(first.alreadyStarted).toBe(false)
  expect(String(first.startedAt).length).toBeGreaterThan(0)
  expect(first.staged).toBe(true)
  expect(first.teamId).toBe("team-1")
  /** The captain's second start. */
  const second = await runTool(harness, "cellwork_start")
  expect(second.ok).toBe(true)
  expect(second.alreadyStarted).toBe(true)
  expect(second.startedAt).toBe(first.startedAt)
  expect(second.staged).toBe(true)
  // Three journal lines: the creation, ONE start, and the planning-team staging (the idempotent call
  // appends nothing).
  expect(journalEntries(harness.workspace, cellId)).toHaveLength(3)
  expect(listCellIds(harness.workspace)).toHaveLength(1)
})

test("cellwork_stop archives the cell, refuses live work unless forced, and gives the captain its tools back", async () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** The active cell's id. */
  const cellId = createCell(harness)
  // A stranger may not stop the cell.
  /** The non-captain's refusal. */
  const foreign = await runTool(harness, "cellwork_stop", {}, stranger(harness))
  expect(foreign.ok).toBe(false)
  expect(String(foreign.error)).toContain("CAPTAIN-ONLY")
  // Give the cell a live team with one task being worked, so the non-forced stop must refuse.
  /** The record with a team id attached. */
  const withTeam = readCell(harness.workspace, cellId)
  if (!withTeam.ok) throw new Error("expected a record")
  writeCell(harness.workspace, { ...withTeam.state, teamId: "team-1" })
  harness.teams.set("team-1", { teamId: "team-1", members: [{ name: "cell-planner" }], tasks: [{ id: "T1", subject: "requirements", status: "in_progress" }] })
  /** The refusal a non-forced stop answers with. */
  const refused = await runTool(harness, "cellwork_stop")
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toContain("T1")
  // The guard still fences the captain: nothing was archived.
  expect(String(harness.guards[0]({ name: "write", agent: harness.captain }))).toContain("cellwork_stop")
  /** The forced stop. */
  const forced = await runTool(harness, "cellwork_stop", { force: true, reason: "wave closed" })
  expect(forced.ok).toBe(true)
  expect(forced.archived).toBe(true)
  expect(forced.forced).toBe(true)
  expect(forced.reason).toBe("wave closed")
  // The record is stopped and archived, the directory is still on disk, and the guard releases.
  /** The archived record. */
  const archived = readCell(harness.workspace, cellId)
  if (!archived.ok) throw new Error("expected a record")
  expect(archived.state.phase).toBe("stopped")
  expect(archived.state.archived).toBe(true)
  expect(existsSync(statePath(harness.workspace, cellId))).toBe(true)
  expect(harness.guards[0]({ name: "write", agent: harness.captain })).toBeUndefined()
  // A bare second stop finds no ACTIVE cell and says so; naming the archived cell is idempotent.
  /** The bare second stop. */
  const again = await runTool(harness, "cellwork_stop")
  expect(again.ok).toBe(false)
  expect(String(again.error)).toContain("no cell is active")
  /** The stop that names the already-archived cell. */
  const byId = await runTool(harness, "cellwork_stop", { cellId })
  expect(byId.ok).toBe(true)
  expect(byId.archived).toBe(true)
  expect(byId.reason).toBe("wave closed")
})

test("after a stop a NEW cell can be started, which is what 'archived, not deleted' is for", async () => {
  /** The harness. */
  const harness = makeHarness()
  apply(harness.ctx, {})
  /** The first cell's id. */
  const first = createCell(harness, "first")
  expect((await runTool(harness, "cellwork_stop")).ok).toBe(true)
  // A stopped cell no longer blocks the workspace: the next /cellwork mints a different cell.
  /** The second cell's id. */
  const second = createCell(harness, "second")
  expect(second).not.toBe(first)
  expect(listCellIds(harness.workspace)).toHaveLength(2)
  /** The record the scan now returns as active. */
  const active = readActiveCell(harness.workspace)
  expect(active.ok).toBe(true)
  if (!active.ok || active.cell === null) throw new Error("expected an active cell")
  expect(active.cell.state.cellId).toBe(second)
  expect(active.cell.state.objective).toBe("second")
})

// ── the source-level invariants the contract names ──────────────────────────

test("no context-window literal is baked into the package, and the row names no harness seam itself", () => {
  /** The package source files, read as text for the seam assertions. */
  const sources = ["index.ts", "state.ts", "guard.ts", "caller.ts", "config.ts", "prompts.ts"].map((file) => readFileSync(new URL("../src/" + file, import.meta.url), "utf8"))
  /** The concatenation every textual assertion below runs against. */
  const all = sources.join("\n")
  // The window is READ, never a literal (plan §2 clause 7): neither spelling of a plausible guess.
  // The needles are ASSEMBLED so this very assertion cannot satisfy the package's own forbidden-literal
  // scan — a test that hard-codes the string it forbids is indistinguishable from the defect.
  expect(all.includes("1_" + "000_000")).toBe(false)
  expect(all.includes("262" + "144")).toBe(false)
  // The row touches the harness only through the adapter (AGENTS.md §6).
  expect(all).not.toMatch(/ctx\.tools/)
  expect(all).not.toMatch(/ctx\.commands/)
  expect(all).not.toMatch(/from\s+["']@deepseek-ai\//)
  expect(all).toContain("resolveDshAdapter(")
  expect(all).toContain("dsh.registerCommand(")
  expect(all).toContain("dsh.registerTool(")
  expect(all).toContain("dsh.guardTool(")
})
