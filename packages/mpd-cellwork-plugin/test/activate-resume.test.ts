// Offline tests for RESUMABLE activation (P1 contract §3.1 A1–A4): a failed activation records a
// partial in-flight state, and a retry of the SAME accepted revision resumes from it instead of
// wedging the cell on a duplicate member/task or a lost verify loop.
//
// The harness is the SAME fake context the host drives: `apply(ctx, config)` against a fake ctx whose
// tool registry captures the definitions, whose `tools.execute` answers the team/verify tools
// in-process, and whose `subagents` service raises team members. Every workspace is a fresh temp
// directory, and every assertion reads what the plugin actually wrote there.
import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { materializeSplit, type ActivateDeps } from "../src/activate.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { journalPath, readActiveCell, readCell, statePath } from "../src/state.ts"
import { readSplit } from "../src/split.ts"
import type { DispatchMemberView, DispatchRecordView } from "../src/dispatch.ts"

/** One fake live agent: the session id the dispatch carries and its workspace header. */
interface FakeAgent {
  /** The agent id (the session-id readers fall back to it). */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
  /** The turn seam the command's `invocation.submit` binds to. */
  followup?: (message: unknown) => void
}

/** One tool definition the fake registry captured. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The model-facing description, as registered. */
  description?: string
  /** The declared output contract, as registered (the F3 pin reads its schema). */
  output?: { schema?: { properties?: Record<string, Record<string, unknown>> } }
  /** The runner, called with `{ name, agent }` as its exec. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One command definition the fake registry captured. */
interface CapturedCommand {
  /** The registered name, without a slash. */
  name: string
  /** The handler the adapter wrapped. */
  handler: (invocation: unknown) => { kind: "error" | "success"; text: string }
}

/** The failure injection one arm arms, read by the fake team/verify doubles. */
interface Injection {
  /** Fail the Nth `mpd_verify_open` attempt (1-based); 0 disables. */
  openFailAt: number
  /** Fail the Nth LIVE `add_member` attempt (1-based); 0 disables. */
  memberFailAt: number
  /** Fail the Nth `create_task` attempt (1-based); 0 disables. */
  taskFailAt: number
  /** Throw on the team-record read the DISPATCH stage performs (after the loops, before any send). */
  dispatchReadThrows: boolean
}

/** The full fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** Captured tool definitions. */
  tools: CapturedTool[]
  /** Captured command definitions. */
  commands: CapturedCommand[]
  /** The order of the side effects this suite asserts on. */
  events: string[]
  /** Every `tools.execute` call, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown>; agent?: unknown }>
  /** Every message the native executor delivered. */
  sends: Array<{ handle: string; text: string }>
  /** The live team records, by id. */
  teamRecords: Map<string, Record<string, any>>
  /** Member handles by board name. */
  handles: Map<string, string>
  /** The live `add_member` names attempted, in order (staging excluded). */
  memberAttempts: string[]
  /** The `create_task` subjects attempted, in order. */
  taskAttempts: string[]
  /** The injection switches this arm arms. */
  injection: Injection
}

/** The roster the fake `mpdRoles` service serves, with distinguishable persona texts. */
const ROSTER = [
  { name: "Planner", persona: "PLANNER PERSONA TEXT" },
  { name: "Lead", persona: "LEAD PERSONA TEXT" },
  { name: "Senior Engineer", persona: "SENIOR ENGINEER PERSONA TEXT" },
  { name: "Reviewer", persona: "REVIEWER PERSONA TEXT" },
  { name: "Deep Worker", persona: "DEEP WORKER PERSONA TEXT" },
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

/** The text of one prompt block, whichever block shape the adapter forwarded. */
function blockText(blocks: unknown): string {
  if (Array.isArray(blocks)) return blocks.map((block) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? String((block as { text: unknown }).text) : "")).join("")
  return typeof blocks === "string" ? blocks : ""
}

/**
 * Build the fake harness and apply the plugin once.
 *
 * @returns the harness with every captured definition and its injection switches.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-resume-"))
  process.env.DSH_WORKSPACE_ROOT = workspace
  /** Captured tool definitions. */
  const tools: CapturedTool[] = []
  /** Captured command definitions. */
  const commands: CapturedCommand[] = []
  /** Ordered side effects. */
  const events: string[] = []
  /** Every in-process tool execution. */
  const calls: Array<{ name: string; arguments: Record<string, unknown>; agent?: unknown }> = []
  /** Delivered messages. */
  const sends: Array<{ handle: string; text: string }> = []
  /** Live team records. */
  const teamRecords = new Map<string, Record<string, any>>()
  /** Member handles by name. */
  const handles = new Map<string, string>()
  /** The live `add_member` names attempted. */
  const memberAttempts: string[] = []
  /** The `create_task` subjects attempted. */
  const taskAttempts: string[] = []
  /** The staged plan, when one exists. */
  let plan: Record<string, any> | null = null
  /** The approved record, when one exists. */
  let record: Record<string, any> | null = null
  /** The next loop id. */
  let loopSeq = 0
  /** How many `mpd_verify_open` attempts were made. */
  let openAttempts = 0
  /** Whether the dispatch-stage read has already been made to throw. */
  let dispatchReadThrown = false
  /** The injection switches, read by the doubles below. */
  const injection: Injection = { openFailAt: 0, memberFailAt: 0, taskFailAt: 0, dispatchReadThrows: false }
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } }, followup: (): void => { events.push("submit") } }
  /**
   * Answer one in-process tool call.
   * @param name - the tool name.
   * @param args - its arguments.
   * @returns the harness-shaped raw result.
   */
  const answerTool = (name: string, args: Record<string, any>): { isError: boolean; value: unknown } => {
    if (name === "agent_teams_plan") {
      /** The plan action the fake answers. */
      const action = String(args.action ?? "")
      if (action === "status") return { isError: false, value: { plan, team: record, members: record?.members ?? [], tasks: record?.tasks ?? [] } }
      if (action === "create") {
        plan = { planId: "plan-1", name: args.name, description: args.description, approval: "required", members: [], tasks: [] }
        return { isError: false, value: { plan } }
      }
      if (action === "add_member") {
        events.push("add-member")
        /** The member row the caller asked for. */
        const member = args.member as Record<string, any>
        if (plan !== null && plan.approvedAt === undefined) {
          plan.members.push(member)
          return { isError: false, value: { plan } }
        }
        if (record === null) throw new Error("no plan and no team")
        memberAttempts.push(String(member.name))
        if (injection.memberFailAt === memberAttempts.length) return { isError: true, value: { error: "the injected raise failure for " + String(member.name) } }
        if (record.members.some((row: Record<string, any>) => row.name === member.name)) return { isError: true, value: { error: "teammate " + JSON.stringify(String(member.name)) + " is already on the roster" } }
        /** The roster row the live append minted. */
        const added = { id: "M" + String(record.members.length + 1), name: member.name, role: member.role, status: "running", executorRef: "handle-" + String(member.name) }
        record.members.push(added)
        handles.set(String(member.name), String(added.executorRef))
        return { isError: false, value: { team: record, member: added, spawned: added.executorRef } }
      }
      if (action === "create_task") {
        /** The task row the caller asked for. */
        const task = args.task as Record<string, any>
        /** Its declared blockers. */
        const blocked = Array.isArray(task.blocked_by) ? task.blocked_by : []
        if (plan !== null && plan.approvedAt === undefined) {
          plan.tasks.push({ subject: task.subject, description: task.description, kind: task.kind, owner: task.owner, blockedBy: blocked, writeScopes: task.write_scopes ?? [] })
          return { isError: false, value: { plan } }
        }
        if (record === null) throw new Error("no plan and no team")
        taskAttempts.push(String(task.subject))
        if (injection.taskFailAt === taskAttempts.length) return { isError: true, value: { error: "the injected append failure for " + String(task.subject) } }
        /** The board id the append mints. */
        const id = "T" + String(record.tasks.length + 1)
        /** The board row the append stores. */
        const row = { id, subject: task.subject, description: task.description, kind: task.kind ?? "work", status: "pending", blockedBy: blocked, owner: task.owner, writeScopes: task.write_scopes ?? [] }
        record.tasks.push(row)
        return { isError: false, value: { team: record, task: row } }
      }
      if (action === "approve") {
        if (plan === null) throw new Error("no plan")
        record = {
          teamId: "team-1",
          members: plan.members.map((member: Record<string, any>, index: number) => {
            /** The executor handle the approval mints for this member. */
            const executorRef = "handle-" + String(member.name)
            handles.set(String(member.name), executorRef)
            return { id: "M" + String(index + 1), name: member.name, role: member.role, status: "running", executorRef }
          }),
          tasks: plan.tasks.map((task: Record<string, any>, index: number) => ({ ...task, id: "T" + String(index + 1), status: "pending" })),
        }
        teamRecords.set("team-1", record)
        /** The created rows the approval answer reports. */
        const created = { members: record.members.map((member: Record<string, any>) => ({ name: member.name, id: member.executorRef })), tasks: record.tasks.map((task: Record<string, any>) => ({ subject: task.subject, id: task.id })) }
        plan = { ...plan, approvedAt: "now" }
        return { isError: false, value: { plan, team: record, created } }
      }
    }
    if (name === "agent_teams_task" && String(args.action ?? "") === "complete") {
      /** The task being closed, when the board holds it. */
      const task = record?.tasks.find((candidate: Record<string, any>) => candidate.id === args.task_id)
      if (task !== undefined) task.status = "completed"
      return { isError: false, value: { taskId: args.task_id, status: "completed" } }
    }
    if (name === "mpd_verify_open") {
      events.push("verify-open")
      openAttempts += 1
      if (injection.openFailAt === openAttempts) return { isError: true, value: { error: "the injected verify-open failure" } }
      loopSeq += 1
      return { isError: false, value: { loopId: "loop-" + String(loopSeq), writer: { kind: "delegate" }, verifier: { id: "unbound" }, scope: args.scope, expiresAt: "later" } }
    }
    return { isError: false, value: {} }
  }
  /** The tool registry the adapter binds to. */
  const toolsService = {
    /** Register one tool definition the plugin contributes. */
    register(definition: CapturedTool): void { tools.push(definition) },
    /** Look one name up, which is what the adapter's hasTool probes. */
    get(name: string): unknown { return tools.find((tool) => tool.name === name) },
    /** The guard seam the adapter installs through (a no-op double: these arms test the flow). */
    guard(predicate: unknown): () => void { return (): void => { void predicate } },
    /** Execute one tool in-process and answer in the harness's raw result shape. */
    async execute(input: { name: string; arguments?: Record<string, unknown>; agent?: unknown }): Promise<unknown> {
      calls.push({ name: input.name, arguments: input.arguments ?? {}, ...(input.agent === undefined ? {} : { agent: input.agent }) })
      return answerTool(input.name, input.arguments ?? {})
    },
  }
  /** The command registry double. */
  const commandsService = {
    /** Register one command definition the plugin contributes. */
    register(definition: CapturedCommand): () => void { commands.push(definition); return (): void => {} },
  }
  /** The services the fake context answers. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    commands: commandsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdTeams: {
      /**
       * Answer one team read; the dispatch-stage injection throws here.
       * @param _workspace - the workspace the caller passed (unused by the double).
       * @param teamId - the team asked for.
       * @returns the record, or undefined.
       */
      get: (_workspace: string, teamId: string): unknown => {
        if (injection.dispatchReadThrows && !dispatchReadThrown && loopSeq >= 2 && sends.length === 0) {
          dispatchReadThrown = true
          throw new Error("the injected dispatch-stage team read failed")
        }
        return teamRecords.get(teamId)
      },
    },
    mpdRoles: {
      list: (): Array<{ name: string; persona: string }> => ROSTER.map((entry) => ({ ...entry })),
      get: (key: string): { name: string; persona: string } | null => ROSTER.find((entry) => entry.name.toLowerCase() === key.toLowerCase()) ?? null,
    },
    mpdConfig: {
      get: (): unknown => undefined,
      agentRouteResolutionOf: (role: string): unknown => ROUTED.includes(role) ? { ok: true, route: { provider: "deepseek-official", model: "deepseek-flash" } } : { ok: false, reason: "unconfigured", missing: ["agentRoutes." + role + ".provider"] },
    },
    llm: {
      listProviders: (): Array<{ id: string; name: string }> => [{ id: "deepseek-official", name: "DeepSeek" }],
      listModels: (): Array<{ id: string; name: string }> => [{ id: "deepseek-flash", name: "Flash" }],
      resolveModelInfo: (): unknown => ({ context: { contextWindow: 1000000 }, defaultMaxTokens: 8192 }),
    },
    subagents: {
      providers: (): string[] => ["spawn"],
      /** Raise either the one-shot consult or a durable team member. */
      async startActivation(spec: Record<string, any>): Promise<unknown> {
        /** The label the host would show. */
        const label = String(spec.label ?? "")
        /** The member name the team spawn's label encodes (`<name> · <teamId>`). */
        const name = label.split(" · ")[0]
        handles.set(name, "handle-" + name)
        return { childId: "handle-" + name, result: Promise.resolve({}), dispose: async (): Promise<void> => {} }
      },
      /** Deliver one message to a member handle. */
      async sendMessage(_caller: unknown, handle: string, blocks: unknown): Promise<void> {
        events.push("send")
        sends.push({ handle, text: blockText(blocks) })
      },
    },
  }
  /** The fake context. */
  const ctx = {
    tools: toolsService,
    /** Run the cleanup callback at registration time, as a real ctx.effect does. */
    effect(fn: () => unknown): void { fn() },
    /** Resolve one of the fake services; an unknown name is an absent service. */
    get(service: string): unknown { return services[service] },
  } as Parameters<typeof apply>[0]
  apply(ctx, {})
  return { workspace, captain, tools, commands, events, calls, sends, teamRecords, handles, memberAttempts, taskAttempts, injection }
}

/**
 * Run one captured tool.
 * @param harness - the harness.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the calling agent (the captain by default).
 * @returns the structured result.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown> = {}, agent: unknown = harness.captain): Promise<Record<string, any>> {
  /** The definition of the tool asked for. */
  const tool = harness.tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  return await tool.execute(args, { name, agent }) as Record<string, any>
}

/**
 * Create a cell through the command and start it (staging the planning team).
 * @param harness - the harness.
 * @returns the cell id.
 */
async function startCell(harness: Harness): Promise<string> {
  /** The one captured command. */
  const command = harness.commands.find((candidate) => candidate.name === "cellwork")
  if (command === undefined) throw new Error("no cellwork command captured")
  /** The command's own answer. */
  const answer = command.handler({ rawInput: "ship the widget", agent: harness.captain })
  if (answer.kind !== "success") throw new Error("the command refused: " + answer.text)
  /** The workspace's active cell, which the command just wrote. */
  const active = readActiveCell(harness.workspace)
  if (!active.ok || active.cell === null) throw new Error("no active cell after the command")
  /** The start's answer (staging included). */
  const started = await runTool(harness, "cellwork_start", {})
  if (started.ok !== true) throw new Error("cellwork_start refused: " + String(started.error))
  return active.cell.state.cellId
}

/**
 * Put one frozen contract back in its PRE-ARM form: the placeholder `withLoopId` replaces.
 *
 * Used to simulate the crash window in which the contract was written but no loop was opened, and the
 * pre-upgrade cell whose older contract carries no loop id at all.
 *
 * @param text - the contract's current markdown.
 * @returns the document carrying the placeholder sentence again.
 */
function unarmContract(text: string): string {
  return text.replace(/The verification loop is opened at activation; `[^`]+`.*/, "The verification loop is opened at activation; its id is appended below before dispatch.")
}

/** The planner agent of the harness's cell. */
function plannerAgent(harness: Harness): FakeAgent {
  return { id: "handle-cell-planner", session: { id: "handle-cell-planner", header: { cwd: harness.workspace } } }
}

/** The splitter agent of the harness's cell. */
function splitterAgent(harness: Harness): FakeAgent {
  return { id: "handle-cell-splitter", session: { id: "handle-cell-splitter", header: { cwd: harness.workspace } } }
}

/** Two code tasks, each with a review owned by a DIFFERENT role (the split's own rule). */
function twoCodeTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
    { key: "cli-core", subject: "Implement the CLI", description: "Add the command.", kind: "work", ownerRole: "Deep Worker", writeScopes: ["src/cli/"], blockedBy: [], inputs: [], verify: true },
    { key: "cli-review", subject: "Review the CLI", description: "Blind review.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["cli-core"], inputs: [], verify: false },
  ]
}

/**
 * Revision two's tasks: the auth pair is KEPT, the CLI pair is DROPPED, and a new spec pair is added.
 * @returns the split's tasks.
 */
function revisionTwoTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
    { key: "spec-core", subject: "Implement the spec store", description: "Add the spec loader.", kind: "work", ownerRole: "Deep Worker", writeScopes: ["src/spec/"], blockedBy: [], inputs: [], verify: true },
    { key: "spec-review", subject: "Review the spec store", description: "Blind review.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["spec-core"], inputs: [], verify: false },
  ]
}

/**
 * Finalize the requirements document as the planner.
 * @param harness - the harness.
 */
async function finalizeRequirements(harness: Harness): Promise<void> {
  /** The planner's answer. */
  const finalized = await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  expect(finalized.ok).toBe(true)
}

/**
 * Submit the two-code-task split as the splitter.
 * @param harness - the harness.
 * @returns the split tool's result.
 */
async function submitSplit(harness: Harness): Promise<Record<string, any>> {
  /** The splitter's answer. */
  const submitted = await runTool(harness, "cellwork_split", { action: "submit", tasks: twoCodeTasks() }, splitterAgent(harness))
  expect(submitted.ok).toBe(true)
  expect(submitted.accepted).toBe(true)
  return submitted
}

/**
 * The cell record exactly as the state FILE carries it, so the assertions cover the on-disk shape.
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed record.
 */
function readStateJson(workspace: string, cellId: string): Record<string, any> {
  return JSON.parse(readFileSync(statePath(workspace, cellId), "utf8")) as Record<string, any>
}

/**
 * The journal lines written so far.
 * @param workspace - the workspace root.
 * @param cellId - the cell id.
 * @returns the parsed entries, in order.
 */
function journalEntries(workspace: string, cellId: string): Array<Record<string, any>> {
  return readFileSync(journalPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, any>)
}

/**
 * The board names on the live team roster, in order.
 * @param harness - the harness.
 * @returns the names.
 */
function rosterNames(harness: Harness): string[] {
  return (harness.teamRecords.get("team-1")?.members ?? []).map((member: Record<string, any>) => String(member.name))
}

/**
 * Every `mpd_verify_open` call made, in order.
 * @param harness - the harness.
 * @returns the calls.
 */
function openCalls(harness: Harness): Array<{ name: string; arguments: Record<string, unknown>; agent?: unknown }> {
  return harness.calls.filter((call) => call.name === "mpd_verify_open")
}

/**
 * The session id an agent handle carries, read the way the plugin reads it.
 * @param agent - the opaque agent handle.
 * @returns the session id, or `""`.
 */
function sessionIdOf(agent: unknown): string {
  /** The handle, read as a record immediately. */
  const handle = typeof agent === "object" && agent !== null ? agent as Record<string, unknown> : undefined
  if (handle === undefined) return ""
  /** The nested session member, when the handle carries one. */
  const session = typeof handle.session === "object" && handle.session !== null ? handle.session as Record<string, unknown> : undefined
  for (const candidate of [session?.id, handle.sessionId, handle.id]) if (typeof candidate === "string" && candidate !== "") return candidate
  return ""
}

// ── A1–A3: loop-open failure, then resume ───────────────────────────────────

test("A1–A3: a verify-loop failure records the partial in-flight state, and the retry resumes it", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  // THE INJECTED WEDGE: the SECOND code task's loop cannot be opened.
  harness.injection.openFailAt = 2
  /** The failed first pass. */
  const first = await runTool(harness, "cellwork_activate", {})
  expect(first.ok).toBe(false)
  expect(String(first.error)).toContain("could not open the verify loop")
  // THE PARTIAL RECORD: phase stays split, the revision is IN FLIGHT, and every artifact so far is on it.
  /** The record as written by the failing pass. */
  const partial = readStateJson(harness.workspace, cellId)
  expect(partial.phase).toBe("split")
  expect(partial.activationInFlight).toBe(1)
  expect(partial.activatedRevision).toBe(null)
  expect(Object.keys(partial.members)).toEqual(expect.arrayContaining(["Deep Worker", "Reviewer", "Senior Engineer"]))
  expect(Object.keys(partial.activatedTasks).length).toBe(4)
  expect(Object.keys(partial.activatedLoops)).toEqual(["auth-core"])
  /** The partial journal events the contract names. */
  const partialRows = journalEntries(harness.workspace, cellId).filter((row) => row.event === "cell-activation-partial")
  /** The COMPACT per-artifact progress rows the pass journaled (contract C8). */
  const progressRows = journalEntries(harness.workspace, cellId).filter((row) => row.event === "cell-activation-progress")
  // ONE WHOLE-STATE SNAPSHOT, ON FAILURE ONLY (contract C8/D7): 2 contracts + 3 members + 4 tasks + 1 loop
  // are journaled as compact progress deltas (`cell-activation-progress`), and the accumulated state is
  // written exactly once, carrying the failure sentence — never once per artifact (the defect wrote 119).
  expect(partialRows.length).toBe(1)
  expect(progressRows.length).toBeGreaterThanOrEqual(10)
  expect(progressRows.at(-1)?.ordinal).toBeGreaterThanOrEqual(10)
  expect(partialRows.at(-1)?.revision).toBe(1)
  expect(String(partialRows.at(-1)?.error)).toContain("could not open the verify loop")
  // THE RETRY: the same accepted revision resumes; only the MISSING loop is opened.
  harness.injection.openFailAt = 0
  /** The loop opens the first pass made. */
  const opensBefore = openCalls(harness).length
  /** The resumed activation. */
  const resumed = await runTool(harness, "cellwork_activate", {})
  expect(resumed.ok).toBe(true)
  expect(resumed.revision).toBe(1)
  /** The finished record. */
  const finished = readStateJson(harness.workspace, cellId)
  expect(finished.phase).toBe("executing")
  expect(finished.activationInFlight).toBe(null)
  expect(finished.activatedRevision).toBe(1)
  expect(finished.activatedTasks).toEqual(partial.activatedTasks)
  expect(Object.keys(finished.activatedLoops).sort()).toEqual(["auth-core", "cli-core"])
  // Exactly ONE extra open: the missing loop, never the one already armed.
  expect(openCalls(harness).length).toBe(opensBefore + 1)
  // No duplicate member and no duplicate board row.
  expect(rosterNames(harness)).toEqual(expect.arrayContaining(["Deep Worker", "Reviewer", "Senior Engineer"]))
  expect(new Set(rosterNames(harness)).size).toBe(rosterNames(harness).length)
  expect(harness.teamRecords.get("team-1")?.tasks.length).toBe(6)
  // The contracts carry their loop ids (both were rewritten with the loop the pass opened).
  /** The code task's contract. */
  const contract1 = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "auth-core.md"), "utf8")
  /** The second code task's contract. */
  const contract2 = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "cli-core.md"), "utf8")
  expect(contract1).toContain(String(finished.activatedLoops["auth-core"]))
  expect(contract2).toContain(String(finished.activatedLoops["cli-core"]))
  // The dispatch ran once, after the loops existed.
  expect(harness.sends.length).toBe(2)
})

// ── A2/A3: member-raise failure, then resume ────────────────────────────────

test("A2/A3: a member-raise failure records the member, and the retry reuses it instead of re-raising", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  // THE INJECTED WEDGE: the SECOND member cannot be raised.
  harness.injection.memberFailAt = 2
  /** The failed first pass. */
  const first = await runTool(harness, "cellwork_activate", {})
  expect(first.ok).toBe(false)
  expect(String(first.error)).toContain("could not raise")
  /** The record as written by the failing pass. */
  const partial = readStateJson(harness.workspace, cellId)
  expect(partial.phase).toBe("split")
  expect(partial.activationInFlight).toBe(1)
  expect(partial.activatedRevision).toBe(null)
  expect(Object.keys(partial.members)).toEqual(expect.arrayContaining(["Senior Engineer"]))
  expect(Object.keys(partial.activatedTasks).length).toBe(0)
  /** The first member's recorded row. */
  const firstMember = partial.members["Senior Engineer"]
  expect(firstMember.executorRef).toBe("handle-Senior Engineer")
  // THE RETRY: the recorded member is reused (no second add_member for it).
  harness.injection.memberFailAt = 0
  /** The resumed activation. */
  const resumed = await runTool(harness, "cellwork_activate", {})
  expect(resumed.ok).toBe(true)
  /** The finished record. */
  const finished = readStateJson(harness.workspace, cellId)
  expect(finished.phase).toBe("executing")
  expect(finished.activationInFlight).toBe(null)
  expect(finished.activatedRevision).toBe(1)
  expect(Object.keys(finished.members)).toEqual(expect.arrayContaining(["Deep Worker", "Reviewer", "Senior Engineer"]))
  // The first member was attempted ONCE: the first pass raised it, the retry reused the record.
  expect(harness.memberAttempts.filter((name) => name === "Senior Engineer").length).toBe(1)
  expect(rosterNames(harness)).toEqual(expect.arrayContaining(["Deep Worker", "Reviewer", "Senior Engineer"]))
  expect(new Set(rosterNames(harness)).size).toBe(rosterNames(harness).length)
})

// ── A2/A3: task-creation failure, then resume ───────────────────────────────

test("A2/A3: a task-creation failure records the minted id, and the retry reuses it", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  // THE INJECTED WEDGE: the SECOND board row cannot be appended.
  harness.injection.taskFailAt = 2
  /** The failed first pass. */
  const first = await runTool(harness, "cellwork_activate", {})
  expect(first.ok).toBe(false)
  expect(String(first.error)).toContain("could not append task")
  /** The record as written by the failing pass. */
  const partial = readStateJson(harness.workspace, cellId)
  expect(partial.phase).toBe("split")
  expect(partial.activationInFlight).toBe(1)
  expect(partial.activatedRevision).toBe(null)
  expect(Object.keys(partial.activatedTasks)).toEqual(["auth-core"])
  /** The board id the partial pass minted. */
  const mintedId = partial.activatedTasks["auth-core"]
  expect(typeof mintedId).toBe("string")
  // The board already held the two STAGING rows before activation minted its first task.
  expect(harness.teamRecords.get("team-1")?.tasks.length).toBe(3)
  // THE RETRY: the minted id is reused and the remaining rows are appended.
  harness.injection.taskFailAt = 0
  /** The resumed activation. */
  const resumed = await runTool(harness, "cellwork_activate", {})
  expect(resumed.ok).toBe(true)
  /** The finished record. */
  const finished = readStateJson(harness.workspace, cellId)
  expect(finished.phase).toBe("executing")
  expect(finished.activatedRevision).toBe(1)
  expect(finished.activatedTasks["auth-core"]).toBe(mintedId)
  expect(Object.keys(finished.activatedTasks).length).toBe(4)
  // No duplicate row: the two staging rows plus the four split rows, all with distinct subjects.
  expect(harness.teamRecords.get("team-1")?.tasks.length).toBe(6)
  expect(new Set(harness.teamRecords.get("team-1")?.tasks.map((task: Record<string, any>) => task.subject)).size).toBe(6)
})

// ── A2/A3: dispatch-stage failure, then resume ──────────────────────────────

test("A2/A3: a dispatch-stage failure records every artifact, and the retry dispatches once", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  // THE INJECTED WEDGE: the live-record read the dispatch stage depends on throws.
  harness.injection.dispatchReadThrows = true
  /** The failed first pass. */
  const first = await runTool(harness, "cellwork_activate", {})
  expect(first.ok).toBe(false)
  expect(String(first.error)).toContain("could not dispatch")
  /** The record as written by the failing pass. */
  const partial = readStateJson(harness.workspace, cellId)
  expect(partial.phase).toBe("split")
  expect(partial.activationInFlight).toBe(1)
  expect(partial.activatedRevision).toBe(null)
  expect(Object.keys(partial.members)).toEqual(expect.arrayContaining(["Deep Worker", "Reviewer", "Senior Engineer"]))
  expect(Object.keys(partial.activatedTasks).length).toBe(4)
  expect(Object.keys(partial.activatedLoops).sort()).toEqual(["auth-core", "cli-core"])
  expect(harness.sends.length).toBe(0)
  // THE RETRY: nothing is re-raised or re-minted; the dispatch runs once.
  harness.injection.dispatchReadThrows = false
  /** The member attempts before the retry. */
  const attemptsBefore = harness.memberAttempts.length
  /** The loop opens before the retry. */
  const opensBefore = openCalls(harness).length
  /** The resumed activation. */
  const resumed = await runTool(harness, "cellwork_activate", {})
  expect(resumed.ok).toBe(true)
  expect(harness.memberAttempts.length).toBe(attemptsBefore)
  expect(openCalls(harness).length).toBe(opensBefore)
  expect(harness.teamRecords.get("team-1")?.tasks.length).toBe(6)
  expect(harness.sends.length).toBe(2)
  /** The finished record. */
  const finished = readStateJson(harness.workspace, cellId)
  expect(finished.phase).toBe("executing")
  expect(finished.activationInFlight).toBe(null)
  expect(finished.activatedRevision).toBe(1)
})

// ── A4: the producer is the captain's LIVE session ──────────────────────────

test("A4: the verify-loop opener is the captain's live agent, and the producer survives only as data", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  /** The successful activation. */
  const activated = await runTool(harness, "cellwork_activate", {})
  expect(activated.ok).toBe(true)
  // EVERY opener call ran under the captain's OWN session, never a fabricated `cellwork:` one.
  /** The opener calls. */
  const opens = openCalls(harness)
  expect(opens.length).toBe(2)
  for (const call of opens) expect(sessionIdOf(call.agent)).toBe("session-captain")
  expect(JSON.stringify(opens.map((call) => call.agent))).not.toContain("cellwork:")
  // The producer identity survives as DATA on the frozen contract, and in the journal.
  /** The work task's frozen contract. */
  const contract = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "auth-core.md"), "utf8")
  expect(contract).toContain("producer: cellwork:" + cellId)
  /** The activation journal row. */
  const activationRow = journalEntries(harness.workspace, cellId).find((row) => row.event === "activate")
  expect(activationRow?.producer).toBe("cellwork:" + cellId)
})

// ── A3: a duplicate-roster error is resolved from the live roster ───────────

test("A3: a duplicate-roster answer is resolved from the live roster, never fatal", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  /** The active cell's record (the flow wrote it). */
  const active = readActiveCell(harness.workspace)
  if (!active.ok || active.cell === null) throw new Error("no active cell")
  /** The accepted split verdict. */
  const stored = readSplit(harness.workspace, cellId, 1)
  if (!stored.ok) throw new Error("no stored split: " + stored.detail)
  /** How many live-roster reads the fake answered. */
  let reads = 0
  /** The team calls the fake answered, in order. */
  const executed: Array<{ name: string; arguments: Record<string, unknown> }> = []
  /** The live roster row that only the SECOND read carries (a stale first read). */
  const liveMember: DispatchMemberView = { name: "Senior Engineer", role: "Senior Engineer", status: "running", executorRef: "handle-live-senior" }
  /** The fake adapter: the team plane answers, the verify plane answers, nothing throws. */
  const fakeDsh = {
    /** Answer one in-process tool call. */
    async executeTool(input: { name: string; arguments?: Record<string, unknown>; agent?: unknown }): Promise<{ ok: boolean; value?: unknown; error?: string }> {
      executed.push({ name: input.name, arguments: input.arguments ?? {} })
      /** The action for a team call. */
      const action = String(input.arguments?.action ?? "")
      if (input.name === "agent_teams_plan" && action === "add_member") {
        /** The member being raised. */
        const name = String((input.arguments?.member as Record<string, unknown> | undefined)?.name ?? "")
        if (name === liveMember.name) return { ok: false, error: "teammate " + JSON.stringify(name) + " is already on the roster" }
        return { ok: true, value: { team: { teamId: "team-1" }, member: { name }, spawned: "handle-" + name } }
      }
      if (input.name === "agent_teams_plan" && action === "create_task") {
        /** The board row the append mints. */
        const task = { id: "T" + String(executed.filter((call) => call.name === "agent_teams_plan" && String(call.arguments.action ?? "") === "create_task").length), status: "pending" }
        return { ok: true, value: { task } }
      }
      if (input.name === "mpd_verify_open") return { ok: true, value: { loopId: "loop-" + String(executed.filter((call) => call.name === "mpd_verify_open").length) } }
      return { ok: true, value: {} }
    },
    /** The team executor seam: absent, so the dispatch reports rather than delivering. */
    teamExecutor: (): undefined => undefined,
  }
  /** The deps the materialisation reads. */
  const deps: ActivateDeps = {
    dsh: fakeDsh as unknown as ActivateDeps["dsh"],
    workspace: harness.workspace,
    cell: active.cell.state,
    config: DEFAULT_CELLWORK_CONFIG,
    captainAgent: harness.captain,
    split: stored.verdict,
    personaFor: (): null => null,
    recordFor: (): DispatchRecordView => {
      reads += 1
      // THE STALE FIRST READ: the activation's seed misses the row, `add_member` then answers
      // "already on the roster", and the RE-READ below is what resolves it.
      return reads === 1 ? { teamId: "team-1", members: [], tasks: [] } : { teamId: "team-1", members: [liveMember], tasks: [] }
    },
    // R6: the dep was renamed when activation moved from a per-artifact checkpoint to a compact
    // progress row (contract C8); the no-op keeps this arm's subject — the live-roster reconciliation.
    progress: (): void => {},
    now: new Date(),
  }
  /** The materialisation. */
  const result = await materializeSplit(deps)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  // The member was resolved from the LIVE roster, with its live handle, and the reuse is recorded.
  expect(result.outcome.members["Senior Engineer"]?.executorRef).toBe("handle-live-senior")
  expect(result.outcome.reused).toContain("Senior Engineer")
  // The duplicate was attempted exactly once, and the other two members were raised normally.
  expect(executed.filter((call) => call.name === "agent_teams_plan" && String(call.arguments.action ?? "") === "add_member").length).toBe(3)
  expect(Object.keys(result.outcome.members).sort()).toEqual(["Deep Worker", "Reviewer", "Senior Engineer"])
})

// ── A4: no live caller agent refuses before any write ───────────────────────

test("A4: activation without a live caller agent refuses before any write", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  /** The record before the refused call. */
  const before = readStateJson(harness.workspace, cellId)
  /** The activation attempted with a handle that carries NO session id. */
  const refused = await runTool(harness, "cellwork_activate", {}, {})
  expect(refused.ok).toBe(false)
  expect(String(refused.error).toLowerCase()).toContain("live caller agent")
  // NOTHING WAS MATERIALISED: no note, no member, no task, no loop, no record write.
  expect(openCalls(harness).length).toBe(0)
  expect(harness.memberAttempts.length).toBe(0)
  expect(harness.taskAttempts.length).toBe(0)
  /** The record after the refused call. */
  const after = readStateJson(harness.workspace, cellId)
  expect(after).toEqual(before)
  expect(after.activationInFlight ?? null).toBe(null)
  expect(after.activatedRevision).toBe(null)
})

// ── A1: an OLD record (no in-flight fields) still reads ─────────────────────

test("A1: a record written before the in-flight fields existed still reads", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  /** The record as written by this build. */
  const raw = readStateJson(harness.workspace, cellId)
  // Simulate a record minted by the PREVIOUS build: the two new fields are absent.
  delete raw.activatedLoops
  delete raw.activationInFlight
  writeFileSync(statePath(harness.workspace, cellId), JSON.stringify(raw, null, 2) + "\n")
  /** The tolerated read. */
  const read = readCell(harness.workspace, cellId)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  expect(read.state.activatedLoops).toEqual({})
  expect(read.state.activationInFlight).toBe(null)
  // The version is NOT bumped: old cells stay readable by this build and vice versa.
  expect(read.state.version).toBe(1)
})

// ── F1: a pre-upgrade kept task whose contract already names a loop is not re-armed ──

test("F1: a pre-upgrade kept code task with an armed contract is skipped and its contract is never rewritten", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  /** The first, successful activation. */
  const first = await runTool(harness, "cellwork_activate", {})
  expect(first.ok).toBe(true)
  /** The armed contract of the first code task. */
  const armedAuth = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "auth-core.md"), "utf8")
  /** The armed contract of the second code task, which is put back in its pre-arm form. */
  const armedCli = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "cli-core.md"), "utf8")
  // THE PRE-UPGRADE RECORD: the loop map does not exist (an older build wrote this cell), while
  // `activatedRevision` still says the split was materialised.
  /** The record as the first activation left it. */
  const legacy = readStateJson(harness.workspace, cellId)
  expect(legacy.activatedRevision).toBe(1)
  delete legacy.activatedLoops
  writeFileSync(statePath(harness.workspace, cellId), JSON.stringify(legacy, null, 2) + "\n")
  // cli-core's contract simulates the crash window: written, placeholder still there, no loop opened.
  writeFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "cli-core.md"), unarmContract(armedCli))
  // A NEW accepted revision over the SAME two code tasks (every key is kept).
  await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  /** The accepted revision two. */
  const rev2 = await runTool(harness, "cellwork_split", { action: "submit", tasks: twoCodeTasks() }, splitterAgent(harness))
  expect(rev2.accepted).toBe(true)
  expect(rev2.revision).toBe(2)
  /** The loop opens made before the re-split. */
  const opensBefore = openCalls(harness).length
  /** The re-split activation. */
  const resplit = await runTool(harness, "cellwork_activate", {})
  expect(resplit.ok).toBe(true)
  expect(resplit.revision).toBe(2)
  // ONLY the task whose contract still carried the placeholder is armed; the armed kept task is skipped.
  /** The loop opens this re-split made. */
  const opensAfter = openCalls(harness).slice(opensBefore)
  expect(opensAfter.length).toBe(1)
  expect(String(opensAfter[0].arguments.contract)).toContain("cli-core.md")
  // THE FROZEN CONTRACT IS BYTE-IDENTICAL: a verifier may already be reading it.
  expect(readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "auth-core.md")).equals(Buffer.from(armedAuth))).toBe(true)
  // The placeholder task's contract now names its NEW loop, and the record only gains that entry.
  /** The record after the re-split. */
  const after = readStateJson(harness.workspace, cellId)
  /** The loop id the re-split armed for the placeholder task. */
  const cliLoop = String(after.activatedLoops?.cli ?? after.activatedLoops?.["cli-core"] ?? "")
  expect(cliLoop).not.toBe("")
  expect(readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "cli-core.md"), "utf8")).toContain(cliLoop)
  expect(after.activatedLoops?.["auth-core"]).toBeUndefined()
  // Kept rows are reused, never duplicated: two staging rows, the four split rows and the replacement
  // splitter row the requirements update re-dispatched (the completed split task is re-opened, not reused).
  expect(harness.teamRecords.get("team-1")?.tasks.length).toBe(7)
})

// ── F2: a newer accepted revision supersedes an older in-flight partial ─────

test("F2: a newer accepted revision supersedes an older in-flight partial and journals it", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  // A FAILED REVISION ONE: members and board rows exist, the SECOND loop cannot be opened.
  harness.injection.openFailAt = 2
  /** The failed first pass. */
  const failed = await runTool(harness, "cellwork_activate", {})
  expect(failed.ok).toBe(false)
  /** The partial record revision one left. */
  const partial = readStateJson(harness.workspace, cellId)
  expect(partial.activationInFlight).toBe(1)
  expect(partial.activatedRevision).toBe(null)
  expect(Object.keys(partial.activatedTasks).length).toBe(4)
  expect(Object.keys(partial.activatedLoops)).toEqual(["auth-core"])
  /** The auth-core board id the partial pass minted (it must survive as the kept row). */
  const authBoardId = String(partial.activatedTasks["auth-core"])
  // THE REQUIREMENTS MOVE ON, and revision two's split is accepted (the CLI pair dropped, a spec pair added).
  await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  /** The accepted revision two. */
  const rev2 = await runTool(harness, "cellwork_split", { action: "submit", tasks: revisionTwoTasks() }, splitterAgent(harness))
  expect(rev2.accepted).toBe(true)
  expect(rev2.revision).toBe(2)
  // SUPERSESSION, NOT A REFUSAL: the newer revision materialises over the recorded partial.
  harness.injection.openFailAt = 0
  /** The superseding activation. */
  const superseded = await runTool(harness, "cellwork_activate", {})
  expect(superseded.ok).toBe(true)
  expect(superseded.revision).toBe(2)
  // The journal names both revisions, and says the older partial was abandoned.
  /** The supersession rows. */
  const supersedeRows = journalEntries(harness.workspace, cellId).filter((row) => row.event === "activation-in-flight-superseded")
  expect(supersedeRows.length).toBe(1)
  expect(supersedeRows[0].previous).toBe(1)
  expect(supersedeRows[0].by).toBe(2)
  // THE OLD PARTIAL IS NOT DUPLICATED: the kept auth row keeps its id, and no row is minted twice.
  /** The live board after the superseding pass. */
  const tasks = harness.teamRecords.get("team-1")?.tasks ?? []
  expect(tasks.length).toBe(8)
  expect(new Set(tasks.map((task: Record<string, any>) => task.subject)).size).toBe(8)
  /** The finished record. */
  const state = readStateJson(harness.workspace, cellId)
  expect(state.phase).toBe("executing")
  expect(state.activatedRevision).toBe(2)
  expect(state.activationInFlight).toBe(null)
  expect(state.activatedTasks["auth-core"]).toBe(authBoardId)
  expect(Object.keys(state.activatedLoops).sort()).toEqual(["auth-core", "spec-core"])
  // The DROPPED work is cancelled on the cell record while its live rows are kept.
  expect(Object.keys(state.cancelledTasks).sort()).toEqual(["cli-core", "cli-review"])
  expect(tasks.some((task: Record<string, any>) => task.subject === "Implement the CLI")).toBe(true)
})

test("F2: a LOWER accepted revision still cannot supersede an in-flight one", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  await finalizeRequirements(harness)
  await submitSplit(harness)
  // A FAILED REVISION ONE, then a synthetic in-flight revision AHEAD of the accepted one: the predicate
  // must refuse rather than materialise a lower revision over newer work.
  harness.injection.openFailAt = 1
  /** The failed first pass. */
  await runTool(harness, "cellwork_activate", {})
  /** The partial record. */
  const partial = readStateJson(harness.workspace, cellId)
  expect(partial.activationInFlight).toBe(1)
  writeFileSync(statePath(harness.workspace, cellId), JSON.stringify({ ...partial, activationInFlight: 2 }, null, 2) + "\n")
  /** The refused activation of the lower accepted revision. */
  const refused = await runTool(harness, "cellwork_activate", {})
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toContain("OLDER than the in-flight revision")
})

// ── F3: the tool schema and description teach the repaired behaviour ────────

test("F3: the cellwork_activate schema DECLARES `reused` and the description names the new behaviours", () => {
  /** The harness (only the registration is read; no cell is needed). */
  const harness = makeHarness()
  /** The captured activation tool definition. */
  const definition = harness.tools.find((tool) => tool.name === "cellwork_activate")
  if (definition === undefined) throw new Error("cellwork_activate is not registered")
  /** The schema properties the result declares. */
  const properties = definition.output?.schema?.properties ?? {}
  /** The `reused` declaration. */
  const reused = properties.reused
  expect(reused).toBeDefined()
  expect(reused?.type).toBe("array")
  expect((reused?.items as Record<string, unknown> | undefined)?.type).toBe("string")
  expect(typeof reused?.description).toBe("string")
  expect(String(reused?.description).length).toBeGreaterThan(0)
  /** The model-facing description. */
  const description = String(definition.description ?? "")
  // The behaviours are ASSEMBLED here so the arm pins the words the contract requires, not one pasted
  // sentence that a reword could silently keep green.
  expect(description).toContain(["opens a verify loop for EVERY code task", "that has none yet", "BEFORE dispatch"].join(" "))
  expect(description).toContain(["A failed pass is checkpointed", "and the SAME accepted revision resumes it"].join(" "))
  expect(description).toContain(["a newer accepted revision", "supersedes an older in-flight one"].join(" "))
})
