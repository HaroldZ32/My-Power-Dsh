// FULL-FLOW PROOF OF THE TWO CODE-REVIEW REPAIRS ON THIS LANE (repair wave for PR #84).
//
// R-C1 (CR #3, flow.ts): a requirements `update` used to pick the CLOSED recorded split ticket over a LIVE
// replacement row, and never wrote the replacement's id back — so every bump appended ANOTHER splitter row
// that nothing can cancel. The arms below run two consecutive updates and count the board rows.
//
// R-C2 (CR #6, staging.ts): `resolveSplitTicket` reported the ticket id TOGETHER WITH the repair error and
// the staging branch DROPPED the id, so a legitimately-refused claim (the split row is still blocked by the
// requirements row right after approval) left `splitTaskId` empty and killed the id-first lookup C11 exists
// for. The arm below refuses the claim and then checks the id survived — in the record, in the journal, and
// in the next id-first lookup.
//
// The harness drives `apply(ctx, config)` exactly as the host does; the team plane is an in-process double
// whose plan approval posts the two planning rows the live one posts.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { journalPath, readActiveCell, statePath } from "../src/state.ts"

/** One fake live agent: the session id and the workspace header the readers resolve from. */
interface FakeAgent {
  /** The agent id. */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
  /** The turn seam the `/cellwork` command's `invocation.submit` binds to. */
  followup?: (message: unknown) => void
}

/** One tool definition the fake registry captured. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with `{ name, agent }` as its exec. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One command definition the fake registry captured. */
interface CapturedCommand {
  /** The registered command name, without a slash. */
  name: string
  /** The handler the adapter wrapped. */
  handler: (invocation: unknown) => { kind: "error" | "success"; text: string }
}

/** One board row the double keeps. */
interface BoardRow {
  /** The board id. */
  id: string
  /** The task subject. */
  subject: string
  /** The declared owner name (the defect leaves this empty). */
  owner: string
  /** The declared kind. */
  kind: string
  /** The board status. */
  status: string
  /** The declared blockers. */
  blocked_by: string[]
}

/** The DEFECT the board double reproduces. */
interface Defect {
  /** Post the split ticket with NO owner, as the plan-approval defect did (D2). */
  ownerlessSplit: boolean
  /** Refuse every claim, as a row blocked by its requirements task is refused. */
  refuseClaim: boolean
}

/** The full fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** The captured tool definitions. */
  tools: CapturedTool[]
  /** The captured command definitions. */
  commands: CapturedCommand[]
  /** The live team record the doubles mutate. */
  team: { teamId: string; members: Array<{ id: string; name: string; role: string; executorRef: string; status: string }>; tasks: BoardRow[] }
  /** The plan slot staged by `cellwork_start`, when one exists. */
  plan: Record<string, any> | null
  /** How many live tasks the double minted. */
  taskSeq: number
  /** The defects this arm reproduces. */
  defect: Defect
}

/** One complete requirements document, all six sections filled. */
const COMPLETE_REQUIREMENTS = [
  "# Requirements",
  "## Goal",
  "Ship a widget.",
  "## Non-goals",
  "No mobile app.",
  "## Users / consumers",
  "The CLI user.",
  "## Constraints",
  "No new dependencies.",
  "## Acceptance criteria",
  "The widget renders and its test passes.",
  "## Open questions",
  "None.",
].join("\n")

/**
 * The requirements document of a later revision: same sections, different scope bytes.
 *
 * @param marker - the sentence that makes this revision's bytes unique.
 * @returns the document text.
 */
function requirementsAt(marker: string): string {
  return COMPLETE_REQUIREMENTS.replace("No mobile app.", "No mobile app. " + marker)
}

/**
 * Answer one team tool call against the doubles.
 *
 * @param harness - the harness being driven.
 * @param name - the tool name.
 * @param args - its arguments.
 * @returns the harness-shaped raw result.
 */
function answerTool(harness: Harness, name: string, args: Record<string, any>): { isError?: boolean; error?: unknown; value?: unknown } {
  if (name === "agent_teams_plan") {
    /** The plan action asked for. */
    const action = String(args.action ?? "")
    if (action === "status") return { value: { plan: harness.plan, team: harness.team.members.length === 0 ? null : harness.team } }
    if (action === "create") {
      harness.plan = { planId: "plan-1", name: String(args.name), description: String(args.description), approval: "required", members: [], tasks: [] }
      return { value: { plan: harness.plan } }
    }
    /** The staged plan, when the slot holds one. */
    const plan = harness.plan
    if (plan === null) return { isError: true, error: "no staged plan" }
    /** Whether the plan is still only staged, so rows append to the PLAN rather than the live team. */
    const staged = plan.approvedAt === undefined
    if (action === "add_member") {
      /** The member row the caller asked for. */
      const member = args.member as Record<string, any>
      if (staged) { plan.members.push(member); return { value: { plan } } }
      /** The roster row the live append mints. */
      const added = { id: "M" + String(harness.team.members.length + 1), name: String(member.name), role: String(member.role ?? ""), executorRef: "session-" + String(member.name), status: "running" }
      harness.team.members.push(added)
      return { value: { team: harness.team, member: added, spawned: added.executorRef } }
    }
    if (action === "create_task") {
      /** The task row the caller asked for. */
      const task = args.task as Record<string, any>
      if (staged) { plan.tasks.push(task); return { value: { plan } } }
      harness.taskSeq += 1
      /** The board id the append mints. */
      const id = "R" + String(harness.taskSeq)
      harness.team.tasks.push({ id, subject: String(task.subject ?? ""), owner: String(task.owner ?? ""), kind: String(task.kind ?? "work"), status: "pending", blocked_by: Array.isArray(task.blocked_by) ? task.blocked_by.map(String) : [] })
      return { value: { task: { id }, team: harness.team } }
    }
    if (action === "approve") {
      plan.approvedAt = "now"
      for (const [index, row] of (Array.isArray(plan.members) ? plan.members : []).entries()) {
        harness.team.members.push({ id: "M" + String(index + 1), name: String(row.name), role: String(row.role ?? ""), executorRef: "session-" + String(row.name), status: "running" })
      }
      for (const [index, row] of (Array.isArray(plan.tasks) ? plan.tasks : []).entries()) {
        /** The owner the board stores: the DEFECT posts the split ticket with none. */
        const owner = harness.defect.ownerlessSplit && String(row.subject ?? "").includes("split") ? "" : String(row.owner ?? "")
        harness.team.tasks.push({ id: "P" + String(index + 1), subject: String(row.subject ?? ""), owner, kind: String(row.kind ?? "work"), status: "pending", blocked_by: [] })
      }
      return { value: { plan, team: harness.team, created: { members: plan.members.map((member: Record<string, any>) => ({ name: member.name, id: "session-" + String(member.name) })), tasks: harness.team.tasks.filter((row) => row.id.startsWith("P")).map((row) => ({ subject: row.subject, id: row.id })) } } }
    }
    return { value: {} }
  }
  if (name === "agent_teams_task") {
    /** The board row the call names. */
    const row = harness.team.tasks.find((task) => task.id === String(args.task_id ?? ""))
    if (row === undefined) return { isError: true, error: "no task " + String(args.task_id ?? "") }
    if (String(args.action) === "claim") {
      if (harness.defect.refuseClaim) return { isError: true, error: "the row is blocked by its requirements task" }
      row.owner = String(args.claimant ?? row.owner)
    }
    if (String(args.action) === "complete") row.status = "completed"
    return { value: { task: row } }
  }
  return { value: {} }
}

/**
 * Build the fake harness and apply the plugin once.
 *
 * @returns the harness.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-rowreuse-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** Captured tool definitions. */
  const tools: CapturedTool[] = []
  /** Captured command definitions. */
  const commands: CapturedCommand[] = []
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } }, followup: (): void => {} }
  /** The harness being assembled (the doubles close over it). */
  const harness: Harness = { workspace, captain, tools, commands, team: { teamId: "team-1", members: [], tasks: [] }, plan: null, taskSeq: 0, defect: { ownerlessSplit: false, refuseClaim: false } }
  /** The tool registry double. */
  const toolsService = {
    /**
     * Capture one tool definition.
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
     * Answer one in-process execution.
     * @param input - the call the adapter forwards.
     * @returns the raw result the adapter projects.
     */
    async execute(input: { name: string; arguments?: Record<string, unknown>; agent?: unknown }): Promise<unknown> {
      return answerTool(harness, input.name, input.arguments ?? {})
    },
  }
  /** The command registry double. */
  const commandsService = {
    /**
     * Capture one command definition.
     * @param definition - the definition.
     * @returns the disposer.
     */
    register(definition: CapturedCommand): () => void { commands.push(definition); return (): void => {} },
  }
  /** The services the fake context answers. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    commands: commandsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdTeams: {
      /**
       * Read one live team record.
       * @param _workspace - the caller's workspace (unused by the double).
       * @param teamId - the team asked for.
       * @returns the record, or undefined.
       */
      get: (_workspace: string, teamId: string): unknown => teamId === harness.team.teamId ? harness.team : undefined,
    },
  }
  /** The fake context the plugin is applied to. */
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
  return harness
}

/**
 * Run one captured tool as one agent.
 *
 * @param harness - the harness.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the calling agent (the captain by default).
 * @returns the structured result.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}, agent: unknown = harness.captain): Promise<Record<string, any>> {
  /** The captured definition. */
  const tool = harness.tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  return await tool.execute(args, { name, agent }) as Record<string, any>
}

/** The planner's agent handle for the staged cell. */
function plannerAgent(harness: Harness): FakeAgent {
  return { id: "session-cell-planner", session: { id: "session-cell-planner", header: { cwd: harness.workspace } } }
}

/**
 * Create the active cell through `/cellwork` (without starting it).
 *
 * @param harness - the harness.
 * @returns the cell id.
 */
function createCell(harness: Harness): string {
  /** The captured `/cellwork` command. */
  const command = harness.commands.find((candidate) => candidate.name === "cellwork")
  if (command === undefined) throw new Error("no cellwork command captured")
  /** The command's own answer. */
  const answer = command.handler({ rawInput: "ship the widget", agent: harness.captain })
  if (answer.kind !== "success") throw new Error("the command refused: " + answer.text)
  /** The workspace's active cell, written by the command. */
  const active = readActiveCell(harness.workspace)
  if (!active.ok || active.cell === null) throw new Error("no active cell after the command")
  return active.cell.state.cellId
}

/**
 * Create the cell and start it (which stages the planning team and records the split ticket's id).
 *
 * @param harness - the harness.
 * @returns the cell id.
 */
async function startCell(harness: Harness): Promise<string> {
  /** The cell id. */
  const cellId = createCell(harness)
  /** The start's answer. */
  const started = await runTool(harness, "cellwork_start", {})
  if (started.ok !== true) throw new Error("cellwork_start refused: " + String(started.error))
  return cellId
}

/**
 * Finalize the requirements document as the planner.
 *
 * @param harness - the harness.
 * @param text - the document.
 */
async function finalizeRequirements(harness: Harness, text: string): Promise<void> {
  /** The planner's answer. */
  const finalized = await runTool(harness, "cellwork_requirements", { action: "finalize", content: text }, plannerAgent(harness))
  expect(finalized.ok).toBe(true)
}

/**
 * Move the requirements document to a new revision as the planner.
 *
 * @param harness - the harness.
 * @param marker - the sentence that makes this revision's bytes unique.
 * @returns the update's structured answer.
 */
async function updateRequirements(harness: Harness, marker: string): Promise<Record<string, any>> {
  return await runTool(harness, "cellwork_requirements", { action: "update", content: requirementsAt(marker) }, plannerAgent(harness))
}

/**
 * Mark the split ticket closed, exactly as a successful activation does.
 *
 * @param harness - the harness.
 * @param id - the board id of the split ticket.
 */
function closeSplitTicket(harness: Harness, id: string): void {
  /** The row being closed. */
  const row = harness.team.tasks.find((task) => task.id === id)
  if (row === undefined) throw new Error("no board row " + id)
  row.status = "completed"
}

/**
 * The cell record as the state file carries it.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed record.
 */
function stateJson(workspace: string, cellId: string): Record<string, any> {
  return JSON.parse(readFileSync(statePath(workspace, cellId), "utf8")) as Record<string, any>
}

/**
 * The journal entries written so far.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed rows, in order.
 */
function journalEntries(workspace: string, cellId: string): Array<Record<string, any>> {
  return readFileSync(journalPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, any>)
}

test("R-C1: two consecutive updates append exactly ONE replacement row and the second reuses it", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness, COMPLETE_REQUIREMENTS)
  // The activation closed the recorded split ticket, which is the state every post-activation bump starts
  // from: the recorded id now names a TERMINAL row.
  closeSplitTicket(harness, "P2")
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("P2")
  /** The FIRST bump, with no splitter work in between. */
  const first = await updateRequirements(harness, "Tighten the CLI scope.")
  expect(first.ok).toBe(true)
  // The closed original is not dispatchable, so ONE replacement row is appended and its id is written back.
  expect(first.splitTaskId).toBe("P2")
  expect(first.redispatchable).toBe(false)
  expect(first.replacementSplitTaskId).toBe("R1")
  expect(first.recordedSplitTaskId).toBe("R1")
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("R1")
  /** The SECOND bump, still with no splitter work. */
  const second = await updateRequirements(harness, "Tighten the CLI scope again.")
  expect(second.ok).toBe(true)
  // The LIVE replacement is preferred over the recorded original, and NOTHING new is appended.
  expect(second.splitTaskId).toBe("R1")
  expect(second.redispatchable).toBe(true)
  expect(second.replacementSplitTaskId).toBe("")
  expect(second.recordedSplitTaskId).toBe("R1")
  /** The board as it stands: two planning rows plus exactly ONE replacement. */
  expect(harness.team.tasks.map((row) => row.id)).toEqual(["P1", "P2", "R1"])
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("R1")
})

test("R-C1: a LIVE splitter row is preferred over the recorded CLOSED one", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness, COMPLETE_REQUIREMENTS)
  closeSplitTicket(harness, "P2")
  // A replacement row from an EARLIER bump exists and is still live, while the record still names P2.
  harness.team.tasks.push({ id: "R9", subject: "Re-split for requirements revision 2", owner: "cell-splitter", kind: "work", status: "pending", blocked_by: [] })
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("P2")
  /** The bump. */
  const updated = await updateRequirements(harness, "Narrow the platform.")
  expect(updated.ok).toBe(true)
  expect(updated.splitTaskId).toBe("R9")
  expect(updated.redispatchable).toBe(true)
  expect(updated.replacementSplitTaskId).toBe("")
  // The live row was reused; no third splitter row appeared.
  expect(harness.team.tasks.filter((row) => row.owner === "cell-splitter").map((row) => row.id)).toEqual(["P2", "R9"])
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("R9")
})

test("R-C2: a REFUSED owner repair still records the ticket id, journals both facts, and the retry finds it by id", async () => {
  /** The harness reproducing the defect state: an ownerless split ticket whose claim is refused. */
  const harness = makeHarness()
  harness.defect.ownerlessSplit = true
  harness.defect.refuseClaim = true
  /** The cell id. */
  const cellId = createCell(harness)
  /** The first start: staging succeeds but the owner repair is legitimately refused. */
  const first = await runTool(harness, "cellwork_start", {})
  expect(first.ok).toBe(false)
  expect(String(first.error)).toContain("could not be claimed")
  expect(String(first.error)).toContain("agent_teams_task {action:\"claim\", claimant:\"cell-splitter\"}")
  // THE ID SURVIVES (CR #6): the record names the ticket even though its owner is still missing...
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("P2")
  /** The partial journal row. */
  const partialRow = journalEntries(harness.workspace, cellId).filter((row) => row.event === "planning-team-partial").at(-1)
  // ...and BOTH facts are on the row: the id recorded, the repair error.
  expect(partialRow?.splitTaskId).toBe("P2")
  expect(String(partialRow?.ownerRepairError)).toContain("could not be claimed")
  // A RETRY OF `cellwork_start` IS IDEMPOTENT ONCE THE TEAM IS RECORDED — it does not re-run staging — so
  // the id-first lookup is exercised where it matters: the NEXT requirements update must FIND the ownerless
  // row by the recorded id instead of reporting "no split task".
  const retry = await runTool(harness, "cellwork_start", {})
  expect(retry.ok).toBe(true)
  expect(stateJson(harness.workspace, cellId).splitTaskId).toBe("P2")
  await finalizeRequirements(harness, COMPLETE_REQUIREMENTS)
  /** The bump that must find the ownerless row by id. */
  const updated = await updateRequirements(harness, "Tighten the CLI scope.")
  expect(updated.ok).toBe(true)
  expect(updated.splitTaskId).toBe("P2")
  expect(updated.redispatchable).toBe(true)
  expect(updated.replacementSplitTaskId).toBe("")
  // Nothing was appended: the same row is re-dispatched, which is the whole point of keeping the id.
  expect(harness.team.tasks.map((row) => row.id)).toEqual(["P1", "P2"])
  /** The update's journal row, which names the row it re-dispatched. */
  const updateRow = journalEntries(harness.workspace, cellId).filter((row) => row.event === "requirements-update").at(-1)
  expect(updateRow?.splitTaskId).toBe("P2")
  // The status read reports the id, which is the surface every later ID-first lookup starts from.
  const status = await runTool(harness, "cellwork_status", {})
  expect(status.ok).toBe(true)
  expect(status.splitTaskId).toBe("P2")
})
