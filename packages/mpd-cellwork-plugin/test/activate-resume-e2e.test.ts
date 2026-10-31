// END-TO-END PROOF OF RESUMABLE ACTIVATION (contract C12, defect D1): one arm per STAGE — contract,
// member, task, verify loop, dispatch — each failing `cellwork_activate` at that stage, re-running the
// SAME tool call, and asserting CONVERGENCE: no duplicate member, task or verify loop, a final phase
// `executing` and `activatedRevision` set.
//
// The harness drives `apply(ctx, config)` exactly as the host does: the tool registry captures the
// definitions, `ctx.tools.execute` answers the team/verify tools in-process, and `subagents` raises team
// members and delivers dispatch messages. Every workspace is a fresh temp directory, so no arm can read
// or write this repository's own state.
//
// CONTRACT ITEMS THIS FILE PROVES: C12/D1 (the five resume arms), C1 (one member per distinct `member`,
// two members sharing one role), C2 (every loop carries the OWNER's session id as `writer_id` and the
// member name as `writer_reason`), C8 (one whole-state partial row, compact progress rows, a monotonic
// pass instant).
import { test, expect } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { PLANNER_RECON_LINES } from "../src/prompts.ts"
import { contractPath, journalPath, readActiveCell, statePath } from "../src/state.ts"

/** One fake live agent: the session id the dispatch carries and the workspace header it resolves from. */
interface FakeAgent {
  /** The agent id the workspace readers fall back to. */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
  /** The turn seam the `/cellwork` command's `invocation.submit` binds to. */
  followup?: (message: unknown) => void
}

/** One tool definition the fake registry captured. */
interface CapturedTool {
  /** The registered tool name. */
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

/** The failure injection ONE arm arms; every counter is 1-based and 0 disables that stage. */
interface Injection {
  /** Fail the Nth live `add_member` attempt (the member stage). */
  memberFailAt: number
  /** Fail the Nth live `create_task` attempt (the task stage). */
  taskFailAt: number
  /** Fail the Nth `mpd_verify_open` attempt (the verify-loop stage). */
  openFailAt: number
  /** Throw on the team-record read the DISPATCH stage performs, once. */
  dispatchReadThrows: boolean
}

/** One board row the double keeps, as much of it as the flow reads. */
interface BoardRow {
  /** The board id (`T1`, `P1`, …). */
  id: string
  /** The task subject, which plan approval resolves blockers by. */
  subject: string
  /** The declared owner name. */
  owner: string
  /** The declared kind. */
  kind: string
  /** The board status. */
  status: string
  /** The declared blockers, as ids. */
  blocked_by: string[]
}

/** The live team record the doubles keep. */
interface LiveTeam {
  /** The team id (always `team-1` here). */
  teamId: string
  /** The roster rows. */
  members: Array<{ id: string; name: string; role: string; executorRef: string; status: string }>
  /** The board rows. */
  tasks: BoardRow[]
}

/** The full fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's live handle. */
  captain: FakeAgent
  /** The captured tool definitions. */
  tools: CapturedTool[]
  /** The captured command definitions. */
  commands: CapturedCommand[]
  /** Every `tools.execute` call, in order, so the loop arguments can be asserted. */
  calls: Array<{ name: string; arguments: Record<string, any>; agent?: unknown }>
  /** Every message the team executor delivered. */
  sends: Array<{ handle: string; text: string }>
  /** The live team record the doubles mutate. */
  team: LiveTeam
  /** The counters this arm arms. */
  injection: Injection
  /** The plan slot staged by `cellwork_start`, when one exists. */
  plan: Record<string, any> | null
  /** How many `mpd_verify_open` attempts were made so far. */
  openAttempts: number
  /** How many live members were attempted so far. */
  memberAttempts: number
  /** How many live tasks were attempted so far. */
  taskAttempts: number
  /** The loop ids the verify double MINTED, so a failed attempt is not mistaken for an opened loop. */
  openedLoops: string[]
}

/** The roster the fake `mpdRoles` service serves, with distinguishable persona texts. */
const ROSTER = [
  { name: "Planner", persona: "PLANNER PERSONA" },
  { name: "Lead", persona: "LEAD PERSONA" },
  { name: "Senior Engineer", persona: "SENIOR ENGINEER PERSONA" },
  { name: "Reviewer", persona: "REVIEWER PERSONA" },
  { name: "Deep Worker", persona: "DEEP WORKER PERSONA" },
]

/** The roles the fake route service has a usable `agentRoutes` entry for. */
const ROUTED = ["Planner", "Lead", "Senior Engineer", "Reviewer", "Deep Worker"]

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

/** The five stages C12 names, in pass order. */
const STAGES = ["contract", "member", "task", "loop", "dispatch"] as const

/** One stage name of a resume arm. */
type Stage = typeof STAGES[number]

/**
 * The text of one prompt block, whichever block shape the adapter forwarded.
 *
 * @param blocks - the content blocks or a plain string.
 * @returns the concatenated text.
 */
function blockText(blocks: unknown): string {
  if (Array.isArray(blocks)) return blocks.map((block) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? String((block as { text: unknown }).text) : "")).join("")
  return typeof blocks === "string" ? blocks : ""
}

/**
 * Answer one team/verify tool call against the doubles.
 *
 * @param harness - the harness being driven.
 * @param name - the tool name.
 * @param args - its arguments.
 * @returns the harness-shaped raw result (`isError` for a refusal, `value` for success).
 */
function answerTool(harness: Harness, name: string, args: Record<string, any>): { isError?: boolean; error?: unknown; value?: unknown } {
  /** The plan slot, read through the harness so the double stays stateless. */
  const plan = harness.plan
  if (name === "agent_teams_plan") {
    /** The plan action asked for. */
    const action = String(args.action ?? "")
    if (action === "status") return { value: { plan, team: harness.team.tasks.length === 0 && harness.team.members.length === 0 ? null : harness.team } }
    if (action === "create") {
      harness.plan = { planId: "plan-1", name: String(args.name), description: String(args.description), approval: "required", members: [], tasks: [] }
      return { value: { plan: harness.plan } }
    }
    if (plan === null) return { isError: true, error: "no staged plan" }
    /** Whether the plan is still only staged, so rows append to the PLAN rather than the live team. */
    const staged = plan.approvedAt === undefined
    if (action === "add_member") {
      /** The member row the caller asked for. */
      const member = args.member as Record<string, any>
      if (staged) { plan.members.push(member); return { value: { plan } } }
      harness.memberAttempts += 1
      if (harness.injection.memberFailAt === harness.memberAttempts) return { isError: true, error: "the injected raise failure for " + String(member.name) }
      if (harness.team.members.some((row) => row.name === member.name)) return { isError: true, error: "teammate " + JSON.stringify(String(member.name)) + " is already on the roster" }
      /** The roster row the live append minted; its handle IS the member's session identity here. */
      const added = { id: "M" + String(harness.team.members.length + 1), name: String(member.name), role: String(member.role ?? ""), executorRef: "session-" + String(member.name), status: "running" }
      harness.team.members.push(added)
      return { value: { team: harness.team, member: added, spawned: added.executorRef } }
    }
    if (action === "create_task") {
      /** The task row the caller asked for. */
      const task = args.task as Record<string, any>
      if (staged) {
        plan.tasks.push(task)
        return { value: { plan } }
      }
      harness.taskAttempts += 1
      if (harness.injection.taskFailAt === harness.taskAttempts) return { isError: true, error: "the injected task append failure" }
      /** The board id the append mints. */
      const id = "T" + String(harness.taskAttempts)
      harness.team.tasks.push({ id, subject: String(task.subject ?? ""), owner: String(task.owner ?? ""), kind: String(task.kind ?? "work"), status: "pending", blocked_by: Array.isArray(task.blocked_by) ? task.blocked_by.map(String) : [] })
      return { value: { task: { id }, team: harness.team } }
    }
    if (action === "approve") {
      // The approval posts the two PLANNING tasks (`P1`, `P2`) with their declared owners and raises the
      // two planning members, so staging's split-ticket lookup reads a board exactly like the live one.
      plan.approvedAt = "now"
      for (const [index, row] of (Array.isArray(plan.members) ? plan.members : []).entries()) {
        harness.team.members.push({ id: "M" + String(index + 1), name: String(row.name), role: String(row.role ?? ""), executorRef: "session-" + String(row.name), status: "running" })
      }
      for (const [index, row] of (Array.isArray(plan.tasks) ? plan.tasks : []).entries()) {
        harness.team.tasks.push({ id: "P" + String(index + 1), subject: String(row.subject ?? ""), owner: String(row.owner ?? ""), kind: String(row.kind ?? "work"), status: "pending", blocked_by: [] })
      }
      return { value: { plan, team: harness.team, created: { members: plan.members.map((member: Record<string, any>) => ({ name: member.name, id: "session-" + String(member.name) })), tasks: harness.team.tasks.filter((row) => row.id.startsWith("P")).map((row) => ({ subject: row.subject, id: row.id })) } } }
    }
    return { value: {} }
  }
  if (name === "agent_teams_task") {
    /** The board row the call names. */
    const row = harness.team.tasks.find((task) => task.id === String(args.task_id ?? ""))
    if (row === undefined) return { isError: true, error: "no task " + String(args.task_id ?? "") }
    if (String(args.action) === "claim") row.owner = String(args.claimant ?? row.owner)
    if (String(args.action) === "complete") row.status = "completed"
    return { value: { task: row } }
  }
  if (name === "mpd_verify_open") {
    harness.openAttempts += 1
    if (harness.injection.openFailAt === harness.openAttempts) return { isError: true, error: "the injected loop-open failure" }
    /** The loop the verify plane mints for this SUCCESSFUL attempt. */
    const loopId = "loop-" + String(harness.openAttempts)
    harness.openedLoops.push(loopId)
    return { value: { loopId, writer: { id: String(args.writer_id ?? "delegate:pending"), reason: String(args.writer_reason ?? "") } } }
  }
  return { value: {} }
}

/**
 * Build the fake harness and apply the plugin once.
 *
 * @returns the harness with every captured definition and its injection switches.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-e2e-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** The live team record. */
  const team: LiveTeam = { teamId: "team-1", members: [], tasks: [] }
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } }, followup: (): void => {} }
  /** The harness being assembled (the doubles close over it). */
  const harness: Harness = { workspace, captain, tools: [], commands: [], calls: [], sends: [], team, injection: { memberFailAt: 0, taskFailAt: 0, openFailAt: 0, dispatchReadThrows: false }, plan: null, openAttempts: 0, memberAttempts: 0, taskAttempts: 0, openedLoops: [] }
  /** The tool registry double. */
  const toolsService = {
    /**
     * Capture one tool definition the plugin registers.
     * @param definition - the definition.
     * @returns the disposer.
     */
    register(definition: CapturedTool): () => void { harness.tools.push(definition); return (): void => {} },
    /**
     * Resolve one captured definition by name.
     * @param name - the tool name.
     * @returns the definition, or undefined.
     */
    get(name: string): CapturedTool | undefined { return harness.tools.find((tool) => tool.name === name) },
    /**
     * Answer one in-process execution.
     * @param input - the call the adapter forwards.
     * @returns the raw result the adapter projects.
     */
    async execute(input: { name: string; arguments?: Record<string, unknown>; agent?: unknown }): Promise<unknown> {
      harness.calls.push({ name: input.name, arguments: input.arguments ?? {}, ...(input.agent === undefined ? {} : { agent: input.agent }) })
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
    register(definition: CapturedCommand): () => void { harness.commands.push(definition); return (): void => {} },
  }
  /** The services the fake context answers. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    commands: commandsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdTeams: {
      /**
       * Read one live team record; the dispatch-stage injection throws here.
       * @param _workspace - the caller's workspace (unused by the double).
       * @param teamId - the team asked for.
       * @returns the record, or undefined.
       */
      get: (_workspace: string, teamId: string): LiveTeam | undefined => {
        if (teamId !== team.teamId) return undefined
        if (harness.injection.dispatchReadThrows && harness.openAttempts >= 2 && harness.sends.length === 0) {
          harness.injection.dispatchReadThrows = false
          throw new Error("the injected dispatch-stage team read failed")
        }
        return team
      },
    },
    mpdRoles: {
      /** @returns the roster rows the persona reader asks for. */
      list: (): Array<{ name: string; persona: string }> => ROSTER.map((entry) => ({ ...entry })),
      /**
       * Resolve one role row.
       * @param key - the role label.
       * @returns the row, or null.
       */
      get: (key: string): { name: string; persona: string } | null => ROSTER.find((entry) => entry.name.toLowerCase() === key.toLowerCase()) ?? null,
    },
    mpdConfig: {
      /** @returns no config override, so the shipped knobs apply. */
      get: (): unknown => undefined,
      /**
       * Resolve one role's route, which the budget measurement reads.
       * @param role - the role label.
       * @returns a usable route for a routed role, a refusal otherwise.
       */
      agentRouteResolutionOf: (role: string): unknown => ROUTED.includes(role) ? { ok: true, route: { provider: "deepseek-official", model: "deepseek-flash" } } : { ok: false, reason: "unconfigured", missing: ["agentRoutes." + role + ".provider"] },
    },
    llm: {
      /** @returns the provider catalog. */
      listProviders: (): Array<{ id: string; name: string }> => [{ id: "deepseek-official", name: "DeepSeek" }],
      /** @returns the model catalog. */
      listModels: (): Array<{ id: string; name: string }> => [{ id: "deepseek-flash", name: "Flash" }],
      /** @returns the context window the budget reads. */
      resolveModelInfo: (): unknown => ({ context: { contextWindow: 1000000 }, defaultMaxTokens: 8192 }),
    },
    subagents: {
      /** @returns the spawn provider the executor binds. */
      providers: (): string[] => ["spawn"],
      /**
       * Raise one member (the dispatch pass raises nobody, but the seam must exist).
       * @param spec - the activation spec.
       * @returns a finished activation handle.
       */
      async startActivation(spec: Record<string, any>): Promise<unknown> {
        /** The member name the team spawn's label encodes. */
        const label = String(spec.label ?? "")
        return { childId: "session-" + label.split(" · ")[0], result: Promise.resolve({}), dispose: async (): Promise<void> => {} }
      },
      /**
       * Deliver one message to a member handle.
       * @param _caller - the captain (unused by the double).
       * @param handle - the member handle.
       * @param blocks - the message content.
       */
      async sendMessage(_caller: unknown, handle: string, blocks: unknown): Promise<void> {
        harness.sends.push({ handle, text: blockText(blocks) })
      },
    },
  }
  /** The fake context the plugin is applied to. */
  const ctx = {
    tools: toolsService,
    /**
     * Run the cleanup callback at registration time, as a real `ctx.effect` does.
     * @param fn - the callback.
     */
    effect(fn: () => unknown): void { fn() },
    /**
     * Resolve one fake service; an unknown name is an absent service.
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

/**
 * Create the active cell through `/cellwork` and start it (which stages the planning team).
 *
 * @param harness - the harness.
 * @returns the cell id.
 */
async function startCell(harness: Harness): Promise<string> {
  /** The captured `/cellwork` command. */
  const command = harness.commands.find((candidate) => candidate.name === "cellwork")
  if (command === undefined) throw new Error("no cellwork command captured")
  /** The command's own answer. */
  const answer = command.handler({ rawInput: "ship the widget", agent: harness.captain })
  if (answer.kind !== "success") throw new Error("the command refused: " + answer.text)
  /** The workspace's active cell, written by the command. */
  const active = readActiveCell(harness.workspace)
  if (!active.ok || active.cell === null) throw new Error("no active cell after the command")
  /** The start's answer, staging included. */
  const started = await runTool(harness, "cellwork_start", {})
  if (started.ok !== true) throw new Error("cellwork_start refused: " + String(started.error))
  return active.cell.state.cellId
}

/** The planner's agent handle for the staged cell. */
function plannerAgent(harness: Harness): FakeAgent {
  return { id: "session-cell-planner", session: { id: "session-cell-planner", header: { cwd: harness.workspace } } }
}

/** The splitter's agent handle for the staged cell. */
function splitterAgent(harness: Harness): FakeAgent {
  return { id: "session-cell-splitter", session: { id: "session-cell-splitter", header: { cwd: harness.workspace } } }
}

/**
 * The task graph every arm submits: TWO code tasks that share ONE role but name DIFFERENT members, each
 * with its own review (contract C1: several members per role is the point), so a role-keyed member pass
 * would raise two members instead of the four the graph declares.
 *
 * @returns the split's task items.
 */
function multiMemberTasks(): Array<Record<string, unknown>> {
  return [
    { key: "alpha-core", subject: "Implement alpha", description: "Add the alpha store.", kind: "work", ownerRole: "Senior Engineer", member: "se-alpha", writeScopes: ["src/alpha/"], blockedBy: [], inputs: [], verify: true },
    { key: "alpha-review", subject: "Review alpha", description: "Blind review.", kind: "review", ownerRole: "Reviewer", member: "rev-alpha", writeScopes: [], blockedBy: ["alpha-core"], inputs: [], verify: false },
    { key: "beta-core", subject: "Implement beta", description: "Add the beta store.", kind: "work", ownerRole: "Senior Engineer", member: "se-beta", writeScopes: ["src/beta/"], blockedBy: [], inputs: [], verify: true },
    { key: "beta-review", subject: "Review beta", description: "Blind review.", kind: "review", ownerRole: "Reviewer", member: "rev-beta", writeScopes: [], blockedBy: ["beta-core"], inputs: [], verify: false },
  ]
}

/**
 * Finalize the requirements document as the planner.
 *
 * @param harness - the harness.
 */
async function finalizeRequirements(harness: Harness): Promise<void> {
  /** The planner's answer. */
  const finalized = await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  expect(finalized.ok).toBe(true)
}

/**
 * Submit the multi-member graph as the splitter.
 *
 * @param harness - the harness.
 * @returns the split tool's result.
 */
async function submitSplit(harness: Harness): Promise<Record<string, any>> {
  /** The splitter's answer. */
  const submitted = await runTool(harness, "cellwork_split", { action: "submit", tasks: multiMemberTasks() }, splitterAgent(harness))
  expect(submitted.ok).toBe(true)
  expect(submitted.accepted).toBe(true)
  return submitted
}

/**
 * The cell record exactly as the state FILE carries it.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed record.
 */
function stateJson(workspace: string, cellId: string): Record<string, any> {
  return JSON.parse(readFileSync(statePath(workspace, cellId), "utf8")) as Record<string, any>
}

/**
 * The journal lines written so far.
 *
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed entries, in order.
 */
function journalEntries(workspace: string, cellId: string): Array<Record<string, any>> {
  return readFileSync(journalPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, any>)
}

/**
 * The live board subjects, which is how a duplicate task shows up.
 *
 * @param harness - the harness.
 * @returns the subjects, in board order.
 */
function boardSubjects(harness: Harness): string[] {
  return harness.team.tasks.map((row) => row.subject)
}

/**
 * The live roster names, which is how a duplicate member shows up.
 *
 * @param harness - the harness.
 * @returns the names, in roster order.
 */
function rosterNames(harness: Harness): string[] {
  return harness.team.members.map((row) => row.name)
}

/**
 * Every `mpd_verify_open` call made, in order.
 *
 * @param harness - the harness.
 * @returns the calls.
 */
function openCalls(harness: Harness): Array<{ name: string; arguments: Record<string, any>; agent?: unknown }> {
  return harness.calls.filter((call) => call.name === "mpd_verify_open")
}

/**
 * Arm the injection that makes activation fail at one stage.
 *
 * @param harness - the harness.
 * @param stage - the stage to fail.
 * @param cellId - the cell the arm runs in (needed for the contract-stage injection).
 */
function armFailure(harness: Harness, stage: Stage, cellId: string): void {
  if (stage === "contract") {
    // A DIRECTORY at the contract path makes the atomic rename fail, which is exactly what a real
    // unwritable workspace does — the first artifact of the pass, before any team write.
    mkdirSync(contractPath(harness.workspace, cellId, "alpha-core"), { recursive: true })
    mkdirSync(contractPath(harness.workspace, cellId, "beta-core"), { recursive: true })
  }
  if (stage === "member") harness.injection.memberFailAt = 2
  if (stage === "task") harness.injection.taskFailAt = 2
  if (stage === "loop") harness.injection.openFailAt = 2
  if (stage === "dispatch") harness.injection.dispatchReadThrows = true
}

/**
 * Disarm every injection, so the retry is a clean pass.
 *
 * @param harness - the harness.
 */
function clearInjection(harness: Harness): void {
  harness.injection.memberFailAt = 0
  harness.injection.taskFailAt = 0
  harness.injection.openFailAt = 0
  harness.injection.dispatchReadThrows = false
}

/**
 * Assert that a finished activation CONVERGED: the four declared members, four board rows and two loops,
 * with no duplicate of any kind and the record in its executing phase.
 *
 * @param harness - the harness.
 * @param cellId - the cell id.
 */
function expectConverged(harness: Harness, cellId: string): void {
  /** The record the success transition wrote. */
  const record = stateJson(harness.workspace, cellId)
  expect(record.phase).toBe("executing")
  expect(record.activatedRevision).toBe(1)
  expect(record.activationInFlight).toBe(null)
  // ONE member per declared `member` (contract C1), no duplicates, and each carries its ROLE for routing.
  expect(new Set(rosterNames(harness)).size).toBe(rosterNames(harness).length)
  expect(rosterNames(harness)).toEqual(expect.arrayContaining(["se-alpha", "se-beta", "rev-alpha", "rev-beta"]))
  expect(harness.team.members.filter((row) => row.name === "se-alpha")[0]?.role).toBe("Senior Engineer")
  // FOUR board rows from the split plus the two planning rows, and no duplicate subject.
  expect(boardSubjects(harness).filter((subject) => subject === "Implement alpha").length).toBe(1)
  expect(boardSubjects(harness).filter((subject) => subject === "Implement beta").length).toBe(1)
  expect(new Set(boardSubjects(harness)).size).toBe(boardSubjects(harness).length)
  // TWO loops, one per code task, never re-opened by the retry: a FAILED attempt is not an opened loop.
  expect(harness.openedLoops.length).toBe(2)
  expect(new Set(harness.openedLoops).size).toBe(2)
  expect(Object.keys(record.activatedLoops).sort()).toEqual(["alpha-core", "beta-core"])
  expect(record.activatedTasks["alpha-core"]).toBeDefined()
  expect(record.activatedTasks["beta-core"]).toBeDefined()
}

/**
 * Assert the contract document of one code task names BOTH the owner role and the board member (C1).
 *
 * @param harness - the harness.
 * @param cellId - the cell id.
 * @param key - the split key.
 * @param role - the declared owner role.
 * @param member - the declared board member.
 */
function expectContractNames(harness: Harness, cellId: string, key: string, role: string, member: string): void {
  /** The frozen contract. */
  const doc = readFileSync(contractPath(harness.workspace, cellId, key), "utf8")
  expect(doc).toContain("Owner: **" + role + "**")
  expect(doc).toContain("(member `" + member + "`)")
}

/** One prepared cell: a harness with a staged planning team, finalized requirements and an accepted split. */
interface Prepared {
  /** The harness. */
  harness: Harness
  /** The cell id. */
  cellId: string
}

/**
 * Prepare one cell up to an ACCEPTED split, which is what every resume arm starts from.
 *
 * @returns the harness and its cell id.
 */
async function prepareAcceptedSplit(): Promise<Prepared> {
  /** The harness. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  return { harness, cellId }
}

for (const stage of STAGES) {
  test("C12/D1: failing at the " + stage + " stage resumes to convergence with no duplicate artifact", async () => {
    /** The prepared cell. */
    const { harness, cellId } = await prepareAcceptedSplit()
    // FAIL AT THE STAGE.
    armFailure(harness, stage, cellId)
    /** The failed first pass. */
    const first = await runTool(harness, "cellwork_activate", {})
    expect(first.ok).toBe(false)
    // A FAILED PASS IS RECORDED, NOT WEDGED: the revision is in flight while the activation is incomplete.
    /** The record as the failing pass left it. */
    const during = stateJson(harness.workspace, cellId)
    expect(during.phase).toBe("split")
    expect(during.activatedRevision).toBe(null)
    if (stage !== "contract") expect(during.activationInFlight).toBe(1)
    // THE RETRY IS THE SAME TOOL CALL: the same accepted revision resumes.
    clearInjection(harness)
    if (stage === "contract") {
      // The contract stage writes before any team call, so the injected directory is removed here — a
      // real unwritable workspace would be repaired by the operator instead.
      rmSync(contractPath(harness.workspace, cellId, "alpha-core"), { recursive: true, force: true })
      rmSync(contractPath(harness.workspace, cellId, "beta-core"), { recursive: true, force: true })
    }
    /** The resumed pass. */
    const resumed = await runTool(harness, "cellwork_activate", {})
    expect(resumed.ok).toBe(true)
    expect(resumed.revision).toBe(1)
    // CONVERGENCE: no duplicate member, board row or verify loop, and the executing phase reached.
    expectConverged(harness, cellId)
    // C1: the frozen contracts name the role AND the member.
    expectContractNames(harness, cellId, "alpha-core", "Senior Engineer", "se-alpha")
    expectContractNames(harness, cellId, "beta-core", "Senior Engineer", "se-beta")
    // C2: every loop named its WRITER by the member's session id, with the human label on the reason.
    for (const call of openCalls(harness)) {
      /** The board id the loop covers. */
      const taskId = String(call.arguments.task_id ?? "")
      /** The member that owns that board row. */
      const owner = harness.team.tasks.find((row) => row.id === taskId)?.owner ?? ""
      expect(String(call.arguments.writer)).toBe("delegate")
      expect(String(call.arguments.writer_id)).toBe("session-" + owner)
      expect(String(call.arguments.writer_reason)).toBe("member: " + owner)
    }
    // C8: ONE whole-state partial row per FAILED pass, every artifact's progress row compact, and the
    // pass's rows never move backwards in time.
    /** The journal of this cell. */
    const rows = journalEntries(harness.workspace, cellId)
    /** The whole-state partial rows. */
    const partialRows = rows.filter((row) => row.event === "cell-activation-partial")
    if (stage === "contract") expect(partialRows.length).toBe(0)
    else expect(partialRows.length).toBe(1)
    /** The compact progress rows. */
    const progressRows = rows.filter((row) => row.event === "cell-activation-progress")
    expect(progressRows.length).toBeGreaterThanOrEqual(8)
    for (const row of progressRows) {
      expect(typeof row.stage).toBe("string")
      expect(typeof row.key).toBe("string")
      expect(typeof row.ordinal).toBe("number")
      expect(typeof row.total).toBe("number")
      expect(row.ordinal).toBeLessThanOrEqual(row.total)
    }
    /** The final activation row. */
    const activateRow = rows.filter((row) => row.event === "activate").at(-1)
    expect(typeof activateRow?.progress).toBe("number")
    /** Where this pass's own rows start in the journal, so only THEY are checked for monotonicity. */
    const passStart = rows.findIndex((row) => row.event === "cell-activation-progress")
    if (passStart >= 0) {
      /** The instants of every row this pass wrote, oldest first. */
      const instants = rows.slice(passStart).map((row) => String(row.at)).filter((at) => at !== "")
      for (let index = 1; index < instants.length; index++) expect(instants[index] >= instants[index - 1]).toBe(true)
    }
    // The dispatch delivered to the owners, once.
    expect(harness.sends.length).toBeGreaterThan(0)
  })
}

test("C1: two members share one role and each is raised separately, with one prompt per member", async () => {
  /** The prepared cell. */
  const { harness, cellId } = await prepareAcceptedSplit()
  /** The clean activation. */
  const activated = await runTool(harness, "cellwork_activate", {})
  expect(activated.ok).toBe(true)
  // Four members for two roles: the role-keyed pass would have raised TWO, and that is defect D10.
  expect(rosterNames(harness).sort()).toEqual(["cell-planner", "cell-splitter", "rev-alpha", "rev-beta", "se-alpha", "se-beta"])
  // Each member's prompt names ITSELF and carries its ROLE persona, so the roster routing still applies.
  /** The four member names the submitted graph declares. */
  const declared = ["se-alpha", "se-beta", "rev-alpha", "rev-beta"]
  /** The member raises THIS activation made (staging's own two raises are excluded). */
  const raises = harness.calls.filter((call) => call.name === "agent_teams_plan" && String(call.arguments.action ?? "") === "add_member" && declared.includes(String((call.arguments.member as Record<string, any> | undefined)?.name ?? "")))
  expect(raises.length).toBe(4)
  for (const raise of raises) {
    /** The member row the call carried. */
    const member = raise.arguments.member as Record<string, any>
    expect(String(member.prompt)).toContain("You are " + String(member.name) + " (" + String(member.role) + ")")
    expect(ROSTER.some((entry) => entry.name === String(member.role))).toBe(true)
  }
  /** The record's member table, keyed by board name: the two planning members plus the four raised here. */
  const members = stateJson(harness.workspace, cellId).members as Record<string, any>
  expect(Object.keys(members).sort()).toEqual(["cell-planner", "cell-splitter", "rev-alpha", "rev-beta", "se-alpha", "se-beta"])
  expect(members["se-alpha"]?.role).toBe("Senior Engineer")
  expect(members["rev-beta"]?.role).toBe("Reviewer")
})

test("C8: a successful pass writes NO whole-state partial row and one progress row per artifact", async () => {
  /** The prepared cell. */
  const { harness, cellId } = await prepareAcceptedSplit()
  /** The clean activation. */
  const activated = await runTool(harness, "cellwork_activate", {})
  expect(activated.ok).toBe(true)
  /** The journal after the pass. */
  const rows = journalEntries(harness.workspace, cellId)
  // 2 contracts + 4 members + 4 tasks + 2 loops = 12 artifacts, each journaled as ONE compact row.
  expect(rows.filter((row) => row.event === "cell-activation-partial").length).toBe(0)
  /** The compact progress rows. */
  const progressRows = rows.filter((row) => row.event === "cell-activation-progress")
  expect(progressRows.length).toBe(12)
  expect(progressRows.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  expect(progressRows.every((row) => row.total === 12)).toBe(true)
  // DEFECT D7's bound: no progress row re-serialises the accumulated state.
  expect(progressRows.every((row) => !("members" in row) && !("tasks" in row) && !("loops" in row))).toBe(true)
})

test("C5/R2: the PLANNER prompt carries the delegation block and the SPLITTER prompt does not", async () => {
  /** The harness, staged up to the planning team (which is where both prompts are written). */
  const harness = makeHarness()
  await startCell(harness)
  /** The member raises staging performed. */
  const raises = harness.calls.filter((call) => call.name === "agent_teams_plan" && String(call.arguments.action ?? "") === "add_member")
  /** The planner's raise. */
  const planner = raises.find((call) => String((call.arguments.member as Record<string, any> | undefined)?.name ?? "") === "cell-planner")
  /** The splitter's raise. */
  const splitter = raises.find((call) => String((call.arguments.member as Record<string, any> | undefined)?.name ?? "") === "cell-splitter")
  expect(planner).toBeDefined()
  expect(splitter).toBeDefined()
  /** The planner prompt text. */
  const plannerPrompt = String((planner?.arguments.member as Record<string, any>).prompt)
  /** The splitter prompt text. */
  const splitterPrompt = String((splitter?.arguments.member as Record<string, any>).prompt)
  // R2: EVERY non-empty line of the delegation block is in the planner prompt, and NONE is in the
  // splitter's (the block pads itself with empty lines, which every string trivially contains).
  /** The block's content lines. */
  const blockLines = PLANNER_RECON_LINES.filter((line) => line.trim() !== "")
  expect(blockLines.length).toBeGreaterThan(0)
  for (const line of blockLines) expect(plannerPrompt).toContain(line)
  for (const line of blockLines) expect(splitterPrompt).not.toContain(line)
  // The splitter prompt still carries its own graph instructions, so the absence above is not an empty prompt.
  expect(splitterPrompt).toContain("THE GRAPH")
})
