// Offline tests for the cellwork FLOW (contract B4–B7): staging, requirements, the measured split,
// reconnaissance and activation.
//
// The harness is the SAME shape the host uses: `apply(ctx, config)` against a fake ctx whose `tools`
// registry captures the definitions, whose `tools.execute` answers the team/verify tools in-process, and
// whose `subagents` service raises both the one-shot consult and the durable team members. Nothing here
// touches the repository's own state: every workspace is a fresh temp directory, and every assertion reads
// what the plugin wrote there.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { journalPath, newCellState, readActiveCell, readCell, requirementsPath, writeCell, type CellState } from "../src/state.ts"
import { validateHandoffText } from "../src/handoff.ts"
import {
  applyCheckpoint,
  classifyCompactionError,
  classifyCompactionResult,
  compactionJournalEntry,
  compactionSignal,
  nextStepOf,
  planCheckpoint,
  promoteAfterHandoff,
} from "../src/protocol-core.ts"
import { foldCellMail, readCellMail } from "../src/mail.ts"
import type { DshContextPressure } from "../../mpd-dsh-adapter-plugin/src/index"
import { dispatchOwnerOnly, type DispatchRecordView } from "../src/dispatch.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"

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

/** The full fake harness one arm drives. */
interface Harness {
  /** The context handed to `apply`. */
  ctx: Parameters<typeof apply>[0]
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** Captured tool definitions. */
  tools: CapturedTool[]
  /** Captured command definitions. */
  commands: CapturedCommand[]
  /** The order of the side effects this suite asserts on (`verify-open`, `send`, `add-member`, …). */
  events: string[]
  /** Every `tools.execute` call, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown>; agent?: unknown }>
  /** Every message the native executor delivered. */
  sends: Array<{ handle: string; text: string }>
  /** Every one-shot spawn's spec (the recon consult). */
  spawns: Array<{ label: string; maxDepth: unknown; prompt: string }>
  /** The live team records, by id. */
  teamRecords: Map<string, Record<string, any>>
  /** A member's session id by board name. */
  handles: Map<string, string>
}

/** The roster the fake `mpdRoles` service serves, with distinguishable persona texts. */
const ROSTER = [
  { name: "Planner", persona: "PLANNER PERSONA TEXT" },
  { name: "Lead", persona: "LEAD PERSONA TEXT" },
  { name: "Senior Engineer", persona: "SENIOR ENGINEER PERSONA TEXT" },
  { name: "Reviewer", persona: "REVIEWER PERSONA TEXT" },
  { name: "Explorer", persona: "EXPLORER PERSONA TEXT" },
  { name: "Researcher", persona: "RESEARCHER PERSONA TEXT" },
]

/** The roles the fake route service has a usable `agentRoutes` entry for. */
const ROUTED = ["Planner", "Lead", "Senior Engineer", "Reviewer"]

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
 * @returns the harness with every captured definition.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-flow-"))
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
  /** One-shot spawns. */
  const spawns: Array<{ label: string; maxDepth: unknown; prompt: string }> = []
  /** Live team records. */
  const teamRecords = new Map<string, Record<string, any>>()
  /** Member handles by name. */
  const handles = new Map<string, string>()
  /** The staged plan, when one exists. */
  let plan: Record<string, any> | null = null
  /** The approved record, when one exists. */
  let record: Record<string, any> | null = null
  /** The next loop id. */
  let loopSeq = 0
  /** The captain's handle. */
  const captain: FakeAgent = { id: "session-captain", session: { id: "session-captain", header: { cwd: workspace } }, followup: (message: unknown): void => { events.push("submit") } }
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
/** The guard seam the adapter installs through (a no-op double: this file tests the flow, not the guard). */
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
  /** The two MPD services and the config service. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    commands: commandsService,
    agents: { list: (): FakeAgent[] => [captain] },
    mpdTeams: { get: (_workspace: string, teamId: string): unknown => teamRecords.get(teamId) },
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
/** The label the host would show, and the one the child-persona seam resolves. */
        const label = String(spec.label ?? "")
        if (label === "Explorer" || label === "Researcher") {
          spawns.push({ label, maxDepth: spec.request?.maxDepth, prompt: blockText(spec.request?.prompt) })
          return { result: Promise.resolve({ output: "FOUND: src/a.ts", stopReason: "end" }), dispose: async (): Promise<void> => {} }
        }
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
  return { ctx, workspace, captain, tools, commands, events, calls, sends, spawns, teamRecords, handles }
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
 * Create a cell through the command and start it.
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
/** The start's answer (staging included, per Amendment 3). */
  const started = await runTool(harness, "cellwork_start", {})
  if (started.ok !== true) throw new Error("cellwork_start refused: " + String(started.error))
  return active.cell.state.cellId
}

/** The planner agent of the harness's cell. */
function plannerAgent(harness: Harness): FakeAgent {
  return { id: "handle-cell-planner", session: { id: "handle-cell-planner", header: { cwd: harness.workspace } } }
}

/** The splitter agent of the harness's cell. */
function splitterAgent(harness: Harness): FakeAgent {
  return { id: "handle-cell-splitter", session: { id: "handle-cell-splitter", header: { cwd: harness.workspace } } }
}

/** One valid work+review pair owned by two different roles. */
function validTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store and its unit test.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review against the frozen contract.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
  ]
}

// ── B4: staging ─────────────────────────────────────────────────────────────

test("cellwork_start stages TWO members and TWO tasks, with personas, roles and a blocked split task", async () => {
  /** The harness. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  /** The record the approval built. */
  const record = harness.teamRecords.get("team-1")
  expect(record).toBeDefined()
  expect(record?.members.map((member: Record<string, any>) => member.name)).toEqual(["cell-planner", "cell-splitter"])
  expect(record?.members[0].role).toBe("Planner")
  expect(record?.members[1].role).toBe("Lead")
  expect(record?.tasks.length).toBe(2)
  expect(record?.tasks[1].blockedBy).toEqual(["Requirements interview and agreed requirements document"])
  // The persona TEXT travels in each member's PROMPT: the harness gives members no roster persona.
  const addMemberCalls = harness.calls.filter((call) => call.name === "agent_teams_plan" && call.arguments.action === "add_member")
  /** One add_member call's member record, read defensively. */
  const memberOf = (index: number): Record<string, unknown> => (addMemberCalls[index]?.arguments.member ?? {}) as Record<string, unknown>
  expect(String(memberOf(0).prompt)).toContain("PLANNER PERSONA TEXT")
  expect(String(memberOf(1).prompt)).toContain("LEAD PERSONA TEXT")
  expect(String(memberOf(1).prompt)).toContain("cellwork_split")
  // The cell record learned the team and both members' handles.
  const stored = readCell(harness.workspace, cellId)
  expect(stored.ok).toBe(true)
  if (stored.ok) {
    expect(stored.state.teamId).toBe("team-1")
    expect(stored.state.members["cell-planner"]?.executorRef).toBe("handle-cell-planner")
    expect(stored.state.members["cell-splitter"]?.executorRef).toBe("handle-cell-splitter")
  }
  // Idempotent: a second start does not stage a second team.
  const again = await runTool(harness, "cellwork_start", {})
  expect(again.ok).toBe(true)
  expect(again.alreadyStarted).toBe(true)
  expect(harness.teamRecords.size).toBe(1)
})

// ── B4: requirements ────────────────────────────────────────────────────────

test("requirements: incomplete refused, complete finalized, a changed finalize refused, update bumps and marks stale", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  await startCell(harness)
  // The captain is NOT the author.
  const byCaptain = await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, harness.captain)
  expect(byCaptain.ok).toBe(false)
  expect(String(byCaptain.error)).toContain("PLANNER-ONLY")
  // An incomplete document names every missing section.
  const incomplete = await runTool(harness, "cellwork_requirements", { action: "finalize", content: "## Goal\nShip it.\n" }, plannerAgent(harness))
  expect(incomplete.ok).toBe(false)
  expect((incomplete.missing as string[]).length).toBe(5)
  // A complete document finalizes and closes the requirements task.
  const finalized = await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  expect(finalized.ok).toBe(true)
  expect(finalized.revision).toBe(1)
  expect(finalized.closedTaskId).toBe("T1")
/** The cell record after finalize. */
  const afterFinalize = readActiveCell(harness.workspace)
  expect(afterFinalize.ok).toBe(true)
  if (afterFinalize.ok && afterFinalize.cell !== null) {
    expect(afterFinalize.cell.state.phase).toBe("split")
    expect(afterFinalize.cell.state.requirementsRevision).toBe(1)
    expect(existsSync(requirementsPath(harness.workspace, afterFinalize.cell.state.cellId))).toBe(true)
  }
  // A CHANGED document may not be finalized in place.
  const changed = await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  expect(changed.ok).toBe(false)
  expect(String(changed.error)).toContain("update")
  // `update` bumps the revision.
  const updated = await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  expect(updated.ok).toBe(true)
  expect(updated.revision).toBe(2)
})

// ── B6: split validation ────────────────────────────────────────────────────

test("split: graph refusals name the rule (cycle, self-review, overlap, unknown role, no answer) and the revision mismatch", async () => {
  /** The harness with a finalized cell. */
  const harness = makeHarness()
  await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  // The captain may not submit a split (clause 1).
  const byCaptain = await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, harness.captain)
  expect(byCaptain.ok).toBe(false)
  // A revision that does not match the accepted document is refused before measuring.
  const wrongRevision = await runTool(harness, "cellwork_split", { action: "submit", revision: 7, tasks: validTasks() }, splitterAgent(harness))
  expect(wrongRevision.ok).toBe(false)
  expect(String(wrongRevision.error)).toContain("revision")
  /** Submit and return the finding codes. */
  const codes = async (tasks: Array<Record<string, unknown>>): Promise<string[]> => {
/** The refusal verdict for this graph. */
    const result = await runTool(harness, "cellwork_split", { action: "submit", tasks }, splitterAgent(harness))
    expect(result.ok).toBe(true)
    expect(result.accepted).toBe(false)
    return (result.findings as Array<Record<string, unknown>>).map((finding) => String(finding.code))
  }
  // Self-review: the review is owned by the writer's role.
  expect(await codes([
    { key: "a", subject: "A", description: "D", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/a.ts"], blockedBy: [], verify: true },
    { key: "b", subject: "B", description: "D", kind: "review", ownerRole: "Senior Engineer", blockedBy: ["a"], verify: false },
  ])).toContain("self-review")
  // Write-scope overlap with no dependency path.
  expect(await codes([
    { key: "a", subject: "A", description: "D", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [] },
    { key: "b", subject: "B", description: "D", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/token.ts"], blockedBy: [] },
  ])).toContain("write-scope-overlap")
  // Unknown owner role.
  expect(await codes([{ key: "a", subject: "A", description: "D", kind: "work", ownerRole: "Nobody", blockedBy: [] }])).toContain("unknown-owner-role")
  // No dependency answer.
  expect(await codes([{ key: "a", subject: "A", description: "D", kind: "work", ownerRole: "Senior Engineer" }])).toContain("no-dependency-answer")
  // A cycle.
  expect(await codes([
    { key: "a", subject: "A", description: "D", kind: "work", ownerRole: "Senior Engineer", blockedBy: ["b"] },
    { key: "b", subject: "B", description: "D", kind: "work", ownerRole: "Senior Engineer", blockedBy: ["a"] },
  ])).toContain("cycle")
})

test("split: an accepted graph is measured against the INJECTED window, and a 2 MiB input is refused with its bytes", async () => {
  /** The harness with a finalized cell. */
  const harness = makeHarness()
  await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  /** The accepted submission. */
  const accepted = await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  expect(accepted.ok).toBe(true)
  expect(accepted.accepted).toBe(true)
  expect(accepted.revision).toBe(1)
  /** The role reading comes from the catalog (provenance recorded). */
  const roles = accepted.roles as Array<Record<string, unknown>>
  expect(roles[0].window).toBe(1000000)
  expect(roles[0].provenance).toBe("catalog")
  // The verdict file is on disk and the cell recorded the accepted revision.
  const active = readActiveCell(harness.workspace)
  expect(active.ok).toBe(true)
  if (active.ok && active.cell !== null) {
    expect(active.cell.state.splitRevision).toBe(1)
    expect(existsSync(join(active.cell.dir, "split", "1.json"))).toBe(true)
  }
  // A declared 2 MiB input is refused with the measured bytes in the breakdown.
  writeFileSync(join(harness.workspace, "huge.bin"), "x".repeat(2 * 1024 * 1024))
/** The measured verdict for the huge-input graph. */
  const refused = await runTool(harness, "cellwork_split", {
    action: "submit",
    tasks: [{ key: "big", subject: "Read huge", description: "D", kind: "work", ownerRole: "Senior Engineer", writeScopes: [], blockedBy: [], inputs: ["huge.bin"] }],
  }, splitterAgent(harness))
  expect(refused.ok).toBe(true)
  expect(refused.accepted).toBe(false)
  /** The refused task's measured inputs. */
  const task = (refused.tasks as Array<Record<string, any>>)[0]
  expect(task.inputs[0].bytes).toBe(2097152)
  expect(task.budget.accepted).toBe(false)
  expect(task.budget.excess).toBeGreaterThan(0)
})

// ── B5: reconnaissance ─────────────────────────────────────────────────────

test("recon: planner only, label exactly Explorer, explicit absolute maxDepth, persona in the prompt", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  await startCell(harness)
/** The captain's attempt, refused because the tool is planner-only. */
  const byCaptain = await runTool(harness, "cellwork_recon", { role: "Explorer", task: "where is auth?" }, harness.captain)
  expect(byCaptain.ok).toBe(false)
/** The planner's consult. */
  const byPlanner = await runTool(harness, "cellwork_recon", { role: "Explorer", task: "where is auth?" }, plannerAgent(harness))
  expect(byPlanner.ok).toBe(true)
  expect(byPlanner.report).toContain("FOUND")
  expect(byPlanner.personaInjected).toBe(true)
  // The spawn spec: EXACT label, ABSOLUTE depth cap, persona text in the prompt.
  expect(harness.spawns.length).toBe(1)
  expect(harness.spawns[0].label).toBe("Explorer")
  expect(harness.spawns[0].maxDepth).toBe(DEFAULT_CELLWORK_CONFIG.depthMax)
  expect(harness.spawns[0].prompt).toContain("EXPLORER PERSONA TEXT")
  // A non-read-only role is refused.
  const badRole = await runTool(harness, "cellwork_recon", { role: "Senior Engineer", task: "x" }, plannerAgent(harness))
  expect(badRole.ok).toBe(false)
})

// ── B7: activation ─────────────────────────────────────────────────────────

test("activate: contracts → members → tasks → verify loop BEFORE dispatch, owner-only, never a second activation", async () => {
  /** The harness with a finalized, accepted cell. */
  const harness = makeHarness()
/** The started cell. */
  const cellId = await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
/** The accepted split. */
  const split = await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  expect(split.accepted).toBe(true)
  // Only the captain activates.
  const byPlanner = await runTool(harness, "cellwork_activate", {}, plannerAgent(harness))
  expect(byPlanner.ok).toBe(false)
/** The activation outcome. */
  const activated = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(activated.ok).toBe(true)
  expect(activated.revision).toBe(1)
  // One frozen contract per CODE task, carrying its loop id.
  const contract = join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "auth-core.md")
  expect(existsSync(contract)).toBe(true)
  expect(readFileSync(contract, "utf8")).toContain("# Acceptance contract — auth-core")
  expect(readFileSync(contract, "utf8")).toContain("loop-1")
  // The members were raised: the reviewer is a VERIFIER (its only task is a review).
  const stored = readCell(harness.workspace, cellId)
  expect(stored.ok).toBe(true)
  if (stored.ok) {
    expect(stored.state.phase).toBe("executing")
    expect(stored.state.activatedRevision).toBe(1)
    expect(stored.state.members["Senior Engineer"]?.mode).toBe("member")
    expect(stored.state.members["Reviewer"]?.mode).toBe("verifier")
  }
  // The board carries the work task and its review, blocked by it.
  const record = harness.teamRecords.get("team-1")
/** The work task the activation minted. */
  const work = record?.tasks.find((task: Record<string, any>) => task.subject === "Implement the auth core")
/** Its review task. */
  const review = record?.tasks.find((task: Record<string, any>) => task.subject === "Review the auth core")
  expect(work).toBeDefined()
  expect(review?.blockedBy).toEqual([work?.id])
  // The verify loop was opened BEFORE the dispatch message went out.
  expect(harness.events.indexOf("verify-open")).toBeGreaterThanOrEqual(0)
  expect(harness.events.indexOf("verify-open")).toBeLessThan(harness.events.indexOf("send"))
  // Owner-only: exactly one message, to the declared owner of the READY task (the review is blocked).
  expect(harness.sends.length).toBe(1)
  expect(harness.sends[0].handle).toBe("handle-Senior Engineer")
  expect(harness.sends[0].text).toContain(String(work?.id))
  // A second activation is refused: the team is never re-created.
  const again = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(again.ok).toBe(false)
  expect(String(again.error)).toContain("already materialised")
})

test("activate: a STALE split is refused unless its revision is passed explicitly", async () => {
  /** The harness with an accepted split. */
  const harness = makeHarness()
  await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  // A requirements update marks the accepted split STALE.
  await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
/** The refusal when the split is stale. */
  const refused = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toContain("STALE")
/** The explicit-revision activation. */
  const explicit = await runTool(harness, "cellwork_activate", { revision: 1 }, harness.captain)
  expect(explicit.ok).toBe(true)
})

// ── B7: the owner-only dispatch decision ───────────────────────────────────

test("owner-only dispatch reports a busy or absent owner and never substitutes another member", async () => {
  /** A board with one ready task per owner situation, and one member already busy. */
  const record: DispatchRecordView = {
    teamId: "team-x",
    members: [
      { name: "Senior Engineer", status: "running", executorRef: "handle-se" },
      { name: "Reviewer", status: "running", executorRef: "handle-rv" },
    ],
    tasks: [
      { id: "T1", subject: "busy owner", status: "pending", owner: "Senior Engineer", blockedBy: [] },
      { id: "T2", subject: "free owner", status: "pending", owner: "Reviewer", blockedBy: [] },
      { id: "T3", subject: "no owner", status: "pending", blockedBy: [] },
      { id: "T4", subject: "blocked", status: "pending", owner: "Senior Engineer", blockedBy: ["T1"] },
      { id: "T5", subject: "already busy", status: "in_progress", owner: "Senior Engineer" },
    ],
  }
  /** The messages delivered. */
  const sent: Array<{ handle: string; content: string }> = []
  /** The report. */
  const report = await dispatchOwnerOnly({
    workspace: mkdtempSync(join(tmpdir(), "mpd-cellwork-dispatch-")),
    cell: { cellId: "cell-x" } as never,
    record,
    send: async (handle, content): Promise<void> => { sent.push({ handle, content }) },
    now: new Date(),
  })
  expect(report.pairs.length).toBe(1)
  expect(report.pairs[0].memberName).toBe("Reviewer")
  expect(sent[0].handle).toBe("handle-rv")
  /** The skip reasons, by task id. */
  const reasons = new Map(report.skipped.map((skip) => [skip.taskId, skip.reason]))
  expect(String(reasons.get("T1"))).toContain("BUSY")
  expect(String(reasons.get("T3"))).toContain("no declared owner")
  expect(String(reasons.get("T4"))).toContain("not ready")
})

// ── Amendment 5, arm (a): an update re-dispatches the SAME split task ───────

test("Amendment 5a: a requirements update re-dispatches the SAME split task with the new revision", async () => {
  /** The harness with a finalized, accepted cell. */
  const harness = makeHarness()
  await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  /** The accepted split. */
  const split = await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  expect(split.accepted).toBe(true)
  /** The splitter's row as the board holds it AFTER acceptance. */
  const board = harness.teamRecords.get("team-1")
  /** That row: it must still be open, or nothing could be re-dispatched on it. */
  const splitRow = board?.tasks.find((task: Record<string, any>) => task.owner === "cell-splitter")
  expect(splitRow?.status).toBe("pending")
  /** The requirements update. */
  const updated = await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  expect(updated.ok).toBe(true)
  expect(updated.revision).toBe(2)
  expect(updated.splitStale).toBe(true)
  // THE SAME row is the vehicle: same id, still dispatchable, still owned by the splitter.
  expect(updated.splitTaskId).toBe(splitRow?.id)
  expect(updated.redispatchable).toBe(true)
  expect(harness.teamRecords.get("team-1")?.tasks.find((task: Record<string, any>) => task.id === splitRow?.id)?.status).toBe("pending")
  // The acceptance still stands for revision 1; the splitter must resubmit against revision 2.
  /** A submission against the OLD revision. */
  const staleSubmit = await runTool(harness, "cellwork_split", { action: "submit", revision: 1, tasks: validTasks() }, splitterAgent(harness))
  expect(staleSubmit.ok).toBe(false)
  expect(String(staleSubmit.error)).toContain("revision")
})

// ── Amendment 5, arm (b): recon refuses a stopped cell and journals the report ─

test("Amendment 5b: cellwork_recon refuses a stopped cell, and the returned report is JOURNALED", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  /** The planner's consult. */
  const consult = await runTool(harness, "cellwork_recon", { role: "Researcher", task: "which module owns the budget?" }, plannerAgent(harness))
  expect(consult.ok).toBe(true)
  /** The cell journal, one parsed entry per line. */
  const journal = readFileSync(journalPath(harness.workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
  /** The recon line the plugin wrote. */
  const reconLine = journal.find((entry) => entry.event === "recon")
  expect(reconLine).toBeDefined()
  expect(reconLine?.role).toBe("Researcher")
  expect(Number(reconLine?.reportChars)).toBeGreaterThan(0)
  expect(String(reconLine?.excerpt)).toContain("FOUND")
  // Once the cell is stopped, reconnaissance is refused BY NAME.
  const stopped = await runTool(harness, "cellwork_stop", { reason: "test" }, harness.captain)
  expect(stopped.ok).toBe(true)
  /** The post-stop consult. */
  const afterStop = await runTool(harness, "cellwork_recon", { role: "Explorer", task: "x" }, plannerAgent(harness))
  expect(afterStop.ok).toBe(false)
  expect(String(afterStop.error)).toContain("stopped and archived")
})

// ── Amendment 5, arm (c): the planner prompt carries the relay protocol ─────

test("Amendment 5c: the planner directive carries the relay protocol, and the captain authors nothing", async () => {
  /** The harness. */
  const harness = makeHarness()
  await startCell(harness)
  /** The planner's staged prompt. */
  const addMemberCalls = harness.calls.filter((call) => call.name === "agent_teams_plan" && call.arguments.action === "add_member")
  /** The planner member's prompt text. */
  const plannerPromptText = String((addMemberCalls[0]?.arguments.member as Record<string, unknown> | undefined)?.prompt ?? "")
  expect(plannerPromptText).toContain("THE RELAY")
  expect(plannerPromptText).toContain("cellwork_send")
  expect(plannerPromptText).toContain("ask_user_question")
  expect(plannerPromptText).toContain("never answer a question that belongs to the user")
  // The captain's activation directive repeats the same rule from its side.
  /** The directive the command submitted. */
  const submitted = harness.events.filter((event) => event === "submit")
  expect(submitted.length).toBeGreaterThan(0)
})

// ── B8: the checkpoint decision, the handoff and the compaction barrier ─────

/** One context-pressure reading for the pure arms. */
function pressureAt(ratio: number | null, windowTokens: number | null, provenance: "observed" | "no-window" | "unavailable"): DshContextPressure {
  return { usedTokens: ratio === null || windowTokens === null ? null : Math.round(ratio * windowTokens), windowTokens, ratio, provenance }
}

/** A cell holding one ordinary worker member. */
function cellWithWorker(): CellState {
  /** The fresh record. */
  const cell = newCellState({ cellId: "cell-x", objective: "o", captainSessionId: "session-captain", now: new Date() })
  return { ...cell, teamId: "team-1", members: { worker: { name: "worker", role: "Senior Engineer", sessionId: "session-worker", executorRef: "session-worker", mode: "member" as const, handoffReady: false, handoffs: 0, joinedAt: "" } } }
}

test("B8: planCheckpoint never guesses, fires once at the ratio, and suppresses reinjection", () => {
  /** The cell under test. */
  const cell = cellWithWorker()
  /** The shipped knobs: checkpoint at half the observed window. */
  const config = DEFAULT_CELLWORK_CONFIG
  // Before the first observed window nothing fires.
  expect(planCheckpoint(cell, "worker", pressureAt(0.9, null, "no-window"), config, 1).inject).toBe(false)
  // Below the threshold nothing fires.
  expect(planCheckpoint(cell, "worker", pressureAt(0.2, 100000, "observed"), config, 1).inject).toBe(false)
  // At the threshold it fires, with the observed numbers carried.
  /** The firing plan. */
  const firing = planCheckpoint(cell, "worker", pressureAt(0.5, 100000, "observed"), config, 3)
  expect(firing.inject).toBe(true)
  expect(firing.usedTokens).toBe(50000)
  expect(firing.windowTokens).toBe(100000)
  // The flip records the checkpoint and puts the seat in checkpoint mode; a second decision is suppressed.
  /** The record after the injection. */
  const after = applyCheckpoint(cell, firing, "session-worker", new Date())
  expect(after.members.worker.mode).toBe("checkpoint")
  expect(after.checkpoints.length).toBe(1)
  expect(planCheckpoint(after, "worker", pressureAt(0.7, 100000, "observed"), config, 4).inject).toBe(false)
  // A subcaptain and a handoff-ready member are never checkpointed.
  /** The cell with the worker promoted. */
  const promoted = { ...cell, members: { worker: { ...cell.members.worker, mode: "subcaptain" as const, handoffReady: false } } }
  expect(planCheckpoint(promoted, "worker", pressureAt(0.9, 100000, "observed"), config, 5).inject).toBe(false)
})

test("B8: handoff validation accepts both grammars and names every missing section", () => {
  /** A heading-grammar document. */
  const headed = ["## Task", "ship it", "## State", "half done", "## Decisions", "chose A", "## Artifacts", "src/a.ts", "## Verified facts", "tests pass", "## Open questions", "none", "## Next step", "finish B"].join("\n")
  expect(validateHandoffText(headed).ok).toBe(true)
  // The key-line grammar is the second accepted shape.
  /** A key-line document. */
  const keyed = ["- Task: ship it", "- State: half done", "- Decisions: chose A", "- Artifacts: src/a.ts", "- Verified facts: tests pass", "- Open questions: none", "- Next step: finish B"].join("\n")
  expect(validateHandoffText(keyed).ok).toBe(true)
  // An incomplete document names what is missing instead of accepting it.
  /** The incomplete validation. */
  const incomplete = validateHandoffText("## Task\nonly this\n")
  expect(incomplete.ok).toBe(false)
  expect(incomplete.missing).toContain("Next step")
  expect(nextStepOf(keyed)).toBe("finish B")
})

test("B8: the barrier compacts with a REAL signal, promotes on success, and reseeds from the handoff on null", async () => {
  /** The cell under test. */
  const cell = cellWithWorker()
  /** The knobs under test: two bounded attempts with no real wait. */
  const config = { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 2, idleBarrierDelayMs: 0 }
  /** The signal the engine actually received. */
  let engineSignal: unknown
  /** The directives injected into the member. */
  const directives: string[] = []
  /** A successful engine. */
  const engine = { compactNow: async (_agent: unknown, signal: AbortSignal): Promise<unknown> => { engineSignal = signal; return { shadowedTokenCount: 10 } } }
  /** The promoted outcome. */
  const promoted = await promoteAfterHandoff({
    dsh: { compactionEngineForAgent: () => engine, startContinuableAgent: async () => ({ childId: "handle-fresh" }), interruptAgent: () => {} },
    agent: {}, memberName: "worker", sessionId: "session-worker", cell, config,
    handoffText: "## Next step\nfinish B", nextStep: "finish B",
    injectDirective: (text) => { directives.push(text) }, sleep: async () => {},
  })
  expect(promoted.outcome).toBe("promoted")
  expect(engineSignal).toBeInstanceOf(AbortSignal)
  expect(directives[0]).toContain("PROMOTED")
  expect(classifyCompactionResult(null)).toBe("no-safe-range")
  // A null answer after the retries reseeds a FRESH child from the handoff.
  /** Whether the old child was interrupted. */
  let interrupted = false
  /** The reseed outcome. */
  const reseeded = await promoteAfterHandoff({
    dsh: { compactionEngineForAgent: () => ({ compactNow: async () => null }), startContinuableAgent: async () => ({ childId: "handle-fresh" }), interruptAgent: () => { interrupted = true } },
    agent: {}, memberName: "worker", sessionId: "session-worker", cell, config,
    handoffText: "## Next step\nfinish B", nextStep: "finish B",
    injectDirective: () => {}, sleep: async () => {},
  })
  expect(reseeded.outcome).toBe("reseeded")
  expect(reseeded.newHandle).toBe("handle-fresh")
  expect(interrupted).toBe(true)
  // A real abort signal is produced even when no parent exists, and a parent abort propagates.
  /** The child signal. */
  const child = compactionSignal()
  expect(child.signal).toBeInstanceOf(AbortSignal)
  /** A parent controller. */
  const parent = new AbortController()
  /** A combined signal. */
  const combined = compactionSignal(parent.signal)
  parent.abort()
  expect(combined.signal.aborted).toBe(true)
  expect(classifyCompactionError(new Error("boom"), child.signal)).toBe("failed")
})

test("B8: cellwork_handoff writes the document, marks the member ready and journals it", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  /** A valid handoff document. */
  const content = ["## Task", "interviews", "## State", "half", "## Decisions", "one question at a time", "## Artifacts", "requirements.md", "## Verified facts", "sections present", "## Open questions", "none", "## Next step", "finalize the document"].join("\n")
  // The captain is never checkpointed, so it may not hand off.
  const byCaptain = await runTool(harness, "cellwork_handoff", { content }, harness.captain)
  expect(byCaptain.ok).toBe(false)
  /** The planner's handoff. */
  const byPlanner = await runTool(harness, "cellwork_handoff", { content }, plannerAgent(harness))
  expect(byPlanner.ok).toBe(true)
  expect(existsSync(String(byPlanner.path))).toBe(true)
  expect(String(byPlanner.directive)).toContain("END YOUR TURN")
  /** The record after the handoff. */
  const stored = readCell(harness.workspace, cellId)
  expect(stored.ok).toBe(true)
  if (stored.ok) {
    expect(stored.state.members["cell-planner"]?.handoffReady).toBe(true)
    expect(stored.state.members["cell-planner"]?.handoffs).toBe(1)
  }
})

// ── B9: durable cell mail ───────────────────────────────────────────────────

test("B9: cellwork_send writes a durable row and cellwork_inbox acknowledges it exactly once", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  await startCell(harness)
  // A member cannot address a stranger.
  const unknown = await runTool(harness, "cellwork_send", { to: "nobody", subject: "s", body: "b" }, plannerAgent(harness))
  expect(unknown.ok).toBe(false)
  /** The planner's question to the captain. */
  const sent = await runTool(harness, "cellwork_send", { to: "captain", subject: "Which scope?", body: "Option A or B?" }, plannerAgent(harness))
  expect(sent.ok).toBe(true)
  expect(sent.wakeSent).toBe(false)
  expect(String(sent.wakeReason)).toContain("captain")
  /** The captain's inbox. */
  const inbox = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  expect(inbox.ok).toBe(true)
  expect((inbox.messages as unknown[]).length).toBe(1)
  expect(String((inbox.messages as Array<Record<string, unknown>>)[0].body)).toContain("Option A or B?")
  // Reading ACKNOWLEDGES: a second call returns nothing.
  /** The second read. */
  const again = await runTool(harness, "cellwork_inbox", {}, harness.captain)
  expect((again.messages as unknown[]).length).toBe(0)
})

// ── B8: the depth fence ─────────────────────────────────────────────────────

test("B8: cellwork_subteam enforces depthMax and registers the sub-cell when it fits", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  // The planner is not a subcaptain until a handoff promotes it.
  const notYet = await runTool(harness, "cellwork_subteam", { objective: "child" }, plannerAgent(harness))
  expect(notYet.ok).toBe(false)
  /** The record with the planner promoted. */
  const record = readCell(harness.workspace, cellId)
  if (!record.ok) throw new Error("expected a record")
  writeCell(harness.workspace, { ...record.state, members: { ...record.state.members, "cell-planner": { ...record.state.members["cell-planner"], mode: "subcaptain" } } })
  /** The registered sub-cell. */
  const registered = await runTool(harness, "cellwork_subteam", { objective: "child objective" }, plannerAgent(harness))
  expect(registered.ok).toBe(true)
  expect(registered.depth).toBe(1)
  expect(readCell(harness.workspace, String(registered.cellId)).ok).toBe(true)
  // A cell already at the cap refuses the next level with the exact bound.
  /** The record at the depth cap. */
  const deep = readCell(harness.workspace, cellId)
  if (!deep.ok) throw new Error("expected a record")
  writeCell(harness.workspace, { ...deep.state, depth: DEFAULT_CELLWORK_CONFIG.depthMax })
  /** The refused registration. */
  const refused = await runTool(harness, "cellwork_subteam", { objective: "too deep" }, plannerAgent(harness))
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toContain("depth.max = " + String(DEFAULT_CELLWORK_CONFIG.depthMax))
})

// ── D5: the sub-cell records the box it will nest inside ────────────────────
//
// WHAT THIS ARM PROVES, and what it deliberately leaves to the team plane. Cellwork's half of nested
// DAG groups (contract D5, seam (b) — implicit derivation) is that a registered sub-cell knows the
// PARENT CELL'S TEAM id: that team is the box the sub-team will be drawn inside, and the promoted
// subcaptain is a MEMBER of it, which is exactly what makes the team plane derive the link at approval
// with no argument passed. What this file cannot prove is the sub-TEAM record's own `parentTeamId`: that
// record is minted by `mpd-team-core-plugin` and the proof lives in its `nested-teams.test.ts` arms
// ("a MEMBER's approval nests its team under the team whose roster records it"). Neither package may
// import the other — the cross-package coupling inventory is frozen — so the chain is proven in two
// halves and stated as such rather than simulated here.

test("D5: a registered sub-cell records the parent cell's TEAM id, and the parent cell keeps only its own", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell, whose planning team this harness approves as `team-1`. */
  const cellId = await startCell(harness)
  /** The parent cell's record before the registration. */
  const before = readCell(harness.workspace, cellId)
  if (!before.ok) throw new Error("expected a record")
  // THE PARENT CELL DRIVES ONE TEAM, and it is the box the sub-team will nest inside.
  expect(before.state.teamId).toBe("team-1")
  // A TOP cell has no parent team of its own — the field is empty, not a broken record.
  expect(before.state.parentTeamId).toBe("")
  // Promote the planner, the way a handoff does, so it may register a sub-cell.
  writeCell(harness.workspace, { ...before.state, members: { ...before.state.members, "cell-planner": { ...before.state.members["cell-planner"], mode: "subcaptain" } } })
  /** The registered sub-cell. */
  const registered = await runTool(harness, "cellwork_subteam", { objective: "child objective" }, plannerAgent(harness))
  expect(registered.ok).toBe(true)
  expect(registered.parentTeamId).toBe("team-1")
  /** The sub-cell's own record on disk. */
  const subcell = readCell(harness.workspace, String(registered.cellId))
  if (!subcell.ok) throw new Error("expected a sub-cell record")
  // THE SUB-CELL NEVER REUSES AN EXISTING CELL ID. Measured while proving D5: `cellIdAt` is
  // millisecond-precision, and a sub-cell registered inside the parent's own minting millisecond
  // OVERWROTE the parent's record (this arm read the parent back and saw no team). The id is minted
  // through `freeCellId`, so the assertion below is the regression guard for that class.
  expect(registered.cellId).not.toBe(cellId)
  expect(subcell.state.parentTeamId).toBe("team-1")
  expect(subcell.state.parentCellId).toBe(cellId)
  // THE PARENT CELL NAMES ONLY ITS OWN TEAM: nesting adds no child team to it, so the parent record is
  // byte-for-byte the shape it had (plus the sub-cell ID it always recorded).
  /** The parent cell's record after the registration. */
  const after = readCell(harness.workspace, cellId)
  if (!after.ok) throw new Error("expected a record")
  expect(after.state.teamId).toBe("team-1")
  expect(after.state.parentTeamId).toBe("")
  expect(after.state.subcellIds).toEqual([String(registered.cellId)])
  // THE JOURNAL CARRIES THE LINK, so a later reader of the cell log can see which team the box landed in.
  /** The sub-cell's journal entries. */
  const entries = readFileSync(journalPath(harness.workspace, String(registered.cellId)), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  expect(entries.find((entry) => entry.event === "subcell-created")?.parentTeamId).toBe("team-1")
  // AND THE DIRECTIVE STATES WHERE THE BOX LANDS — the subcaptain is told the nesting is derived, not
  // asked for: no argument exists for it.
  expect(String(registered.directive)).toContain("NESTS AS A BOX inside team team-1")
})

test("D5: a parent cell with NO team yet yields a ROOT sub-team, and the directive says so", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  /** The parent cell's record, with its team link cleared — a cell that never approved one. */
  const record = readCell(harness.workspace, cellId)
  if (!record.ok) throw new Error("expected a record")
  writeCell(harness.workspace, { ...record.state, teamId: "", members: { ...record.state.members, "cell-planner": { ...record.state.members["cell-planner"], mode: "subcaptain" } } })
  /** The registered sub-cell. */
  const registered = await runTool(harness, "cellwork_subteam", { objective: "orphan child" }, plannerAgent(harness))
  expect(registered.ok).toBe(true)
  // NO PARENT TEAM TO NAME: the sub-team is a root team in the DAG, and nothing is invented.
  expect(registered.parentTeamId).toBe("")
  expect(String(registered.directive)).toContain("ROOT team in the DAG")
})

// ── B8/B9: the captain-only protocol tools ─────────────────────────────────

test("cellwork_dispatch and cellwork_supervise are captain-only; supervise reports the pending board", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  await startCell(harness)
  // A planner cannot dispatch or supervise.
  expect((await runTool(harness, "cellwork_dispatch", {}, plannerAgent(harness))).ok).toBe(false)
  expect((await runTool(harness, "cellwork_supervise", {}, plannerAgent(harness))).ok).toBe(false)
  // The captain's first pass pairs the READY requirements task with its declared owner, and reports the
  // split task as blocked instead of inventing a pairing for it.
  const dispatch = await runTool(harness, "cellwork_dispatch", {}, harness.captain)
  expect(dispatch.ok).toBe(true)
  expect((dispatch.pairs as Array<Record<string, unknown>>).map((pair) => pair.memberName)).toEqual(["cell-planner"])
  expect((dispatch.skipped as Array<Record<string, unknown>>).some((row) => String(row.reason).includes("not ready"))).toBe(true)
  /** The captain's sweep. */
  const sweep = await runTool(harness, "cellwork_supervise", {}, harness.captain)
  expect(sweep.ok).toBe(true)
  expect(Array.isArray(sweep.members)).toBe(true)
  expect(String(sweep.phase)).toBe("requirements")
})

// ── Wave 3 (C1): the re-split path on the LIVE team record ──────────────────

/** One valid graph for the SECOND revision: two keys kept, one work+review pair added. */
function resplitTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store and its unit test.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review against the frozen contract.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
    { key: "spec-digest", subject: "Digest the spec", description: "Write the digest the release note needs.", kind: "work", ownerRole: "Lead", writeScopes: ["docs/spec/"], blockedBy: [], inputs: [], verify: true },
    { key: "spec-review", subject: "Review the spec digest", description: "Blind review of the digest against its contract.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["spec-digest"], inputs: [], verify: false },
  ]
}

/** The graph the THIRD revision submits: the added pair is dropped again. */
function droppedTasks(): Array<Record<string, unknown>> {
  return validTasks()
}

/**
 * Drive a cell to its first activation: command, start, finalize, accepted split, activation.
 *
 * @param harness - the harness to drive.
 * @returns the cell id and the activation answer.
 */
async function activatedCell(harness: Harness): Promise<{ cellId: string; activated: Record<string, any> }> {
  /** The started cell. */
  const cellId = await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  /** The first activation. */
  const activated = await runTool(harness, "cellwork_activate", {}, harness.captain)
  if (activated.ok !== true) throw new Error("the first activation refused: " + String(activated.error))
  return { cellId, activated }
}

test("C1: a second activation ADDS tasks and members on the SAME team and reuses every kept row", async () => {
  /** The harness at its first activation. */
  const harness = makeHarness()
  /** The cell and its first activation. */
  const { cellId, activated } = await activatedCell(harness)
  /** The board after the first activation. */
  const board = harness.teamRecords.get("team-1")
  expect(activated.mode).toBe("initial")
  /** The kept work row's id, minted by the first activation. */
  const keptRowId = board?.tasks.find((task: Record<string, any>) => task.subject === "Implement the auth core")?.id
  expect(typeof keptRowId).toBe("string")
  /** The messages delivered before the re-split. */
  const sendsBefore = harness.sends.length
  // The requirements document moves on: revision 2, the accepted split is STALE.
  const updated = await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  expect(updated.revision).toBe(2)
  expect(updated.splitStale).toBe(true)
  // A split submitted against the OLD revision is refused with the teaching sentence.
  /** The mismatched submission. */
  const mismatch = await runTool(harness, "cellwork_split", { action: "submit", revision: 1, tasks: resplitTasks() }, splitterAgent(harness))
  expect(mismatch.ok).toBe(false)
  expect(String(mismatch.error)).toContain("does not match the accepted requirements revision 2")
  // The activation of the STALE split is refused until the splitter resubmits.
  /** The stale activation refusal. */
  const staleRefusal = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(staleRefusal.ok).toBe(false)
  expect(String(staleRefusal.error)).toContain("STALE")
  // THE SPLIT TASK: the first activation closed the original row, so the update APPENDED exactly one
  // replacement (same owner, the new revision in its subject) — a terminal row cannot be reopened, and
  // the splitter needs one open row to claim.
  expect(String(updated.replacementSplitTaskId)).not.toBe("")
  /** The splitter rows that are still open after the update. */
  const openSplitterRows = (board?.tasks ?? []).filter((task: Record<string, any>) => String(task.owner ?? "") === "cell-splitter" && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled")
  expect(openSplitterRows.length).toBe(1)
  expect(openSplitterRows[0].id).toBe(updated.replacementSplitTaskId)
  /** The board size just before the re-split activation (the replacement row is already on it). */
  const sizeBeforeResplit = board?.tasks.length ?? 0
  // Revision 2 is submitted and ACCEPTED, superseding revision 1.
  /** The accepted second revision. */
  const accepted = await runTool(harness, "cellwork_split", { action: "submit", tasks: resplitTasks() }, splitterAgent(harness))
  expect(accepted.accepted).toBe(true)
  expect(accepted.supersededRevision).toBe(1)
  // THE RE-SPLIT: a second activation appends to the SAME team.
  /** The re-split activation. */
  const resplit = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(resplit.ok).toBe(true)
  expect(resplit.mode).toBe("resplit")
  expect(resplit.revision).toBe(2)
  expect(resplit.kept).toEqual(["auth-core", "auth-review"])
  expect(resplit.cancelled).toEqual([])
  // The team is the SAME record, and only the NEW rows were appended.
  expect(harness.teamRecords.size).toBe(1)
  expect((resplit.tasks as Array<Record<string, unknown>>).map((row) => row.key).sort()).toEqual(["spec-digest", "spec-review"])
  expect(board?.tasks.length).toBe(sizeBeforeResplit + 2)
  // The kept work row is REUSED, never duplicated: one row carries that subject, with its original id.
  /** Every board row carrying the kept subject. */
  const keptRows = board?.tasks.filter((task: Record<string, any>) => task.subject === "Implement the auth core") ?? []
  expect(keptRows.length).toBe(1)
  expect(keptRows[0].id).toBe(keptRowId)
  // The new review row is blocked by the NEW work row's board id.
  /** The new work row. */
  const digestRow = board?.tasks.find((task: Record<string, any>) => task.subject === "Digest the spec")
  /** The new review row. */
  const digestReview = board?.tasks.find((task: Record<string, any>) => task.subject === "Review the spec digest")
  expect(digestReview?.blockedBy).toEqual([digestRow?.id])
  // The new ROLE was raised as a member on the same team; the existing ones were not raised twice.
  expect((resplit.membersRaised as string[]).sort()).toEqual(["Lead"])
  expect((board?.members ?? []).filter((member: Record<string, any>) => member.name === "Senior Engineer").length).toBe(1)
  // ONE verify loop for the ONE new code task — the kept task's loop stays the one already armed.
  expect((resplit.loops as Array<Record<string, unknown>>).map((row) => row.taskKey)).toEqual(["spec-digest"])
  /** The kept task's frozen contract, as the first activation wrote it. */
  const keptContract = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "auth-core.md"), "utf8")
  expect(keptContract).toContain("loop-1")
  expect(keptContract).not.toContain("loop-2")
  // The new code task got a contract naming ITS loop, and its owner was woken.
  /** The new contract. */
  const digestContract = readFileSync(join(harness.workspace, ".mpd", "cellwork", cellId, "contracts", "spec-digest.md"), "utf8")
  expect(digestContract).toContain("loop-2")
  expect(harness.sends.slice(sendsBefore).some((send) => send.handle === "handle-Lead")).toBe(true)
  // The cell record carries the full mapping of the LIVE revision and nothing cancelled.
  /** The record after the re-split. */
  const stored = readCell(harness.workspace, cellId)
  if (!stored.ok) throw new Error("expected a record")
  expect(stored.state.activatedRevision).toBe(2)
  expect(stored.state.splitStale).toBe(false)
  expect(stored.state.activatedTasks["auth-core"]).toBe(keptRowId)
  expect(Object.keys(stored.state.activatedTasks).sort()).toEqual(["auth-core", "auth-review", "spec-digest", "spec-review"])
  expect(stored.state.cancelledTasks).toEqual({})
  // The SAME revision can never be activated twice.
  /** The duplicate activation. */
  const again = await runTool(harness, "cellwork_activate", { revision: 2 }, harness.captain)
  expect(again.ok).toBe(false)
  expect(String(again.error)).toContain("already materialised")
})

test("C1: work a later revision drops is marked cancelled, never deleted, and never dispatched", async () => {
  /** The harness at its first activation. */
  const harness = makeHarness()
  /** The cell and its first activation. */
  const { cellId } = await activatedCell(harness)
  // Revision 2 adds the pair, so revision 3 has something to drop.
  await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  await runTool(harness, "cellwork_split", { action: "submit", tasks: resplitTasks() }, splitterAgent(harness))
  /** The second activation, which adds the pair. */
  const second = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(second.ok).toBe(true)
  /** The board before the third revision. */
  const board = harness.teamRecords.get("team-1")
  /** Every board id present before the drop: not one of them may disappear. */
  const idsBefore = (board?.tasks ?? []).map((task: Record<string, any>) => String(task.id)).sort()
  /** The added work row's id. */
  const digestRowId = board?.tasks.find((task: Record<string, any>) => task.subject === "Digest the spec")?.id
  expect(typeof digestRowId).toBe("string")
  // Revision 3 drops the added pair again.
  await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore again\n" }, plannerAgent(harness))
  /** The accepted third revision. */
  const third = await runTool(harness, "cellwork_split", { action: "submit", tasks: droppedTasks() }, splitterAgent(harness))
  expect(third.accepted).toBe(true)
  /** The third activation, which drops the pair. */
  const resplit = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(resplit.ok).toBe(true)
  expect(resplit.mode).toBe("resplit")
  expect((resplit.cancelled as Array<Record<string, unknown>>).map((row) => row.key).sort()).toEqual(["spec-digest", "spec-review"])
  // NOTHING WAS DELETED: every row the board carried before the drop is still there (the update did
  // append one replacement split row of its own, which is growth, not a deletion).
  /** The board ids after the drop. */
  const idsAfter = (board?.tasks ?? []).map((task: Record<string, any>) => String(task.id))
  /** The ids that would be missing, which must be none. */
  const missingIds = idsBefore.filter((id: string) => !idsAfter.includes(id))
  expect(missingIds).toEqual([])
  // The cell record marks the dropped keys cancelled against the ids their rows still carry.
  /** The record after the drop. */
  const stored = readCell(harness.workspace, cellId)
  if (!stored.ok) throw new Error("expected a record")
  expect(stored.state.cancelledTasks["spec-digest"]).toBe(digestRowId)
  expect(typeof stored.state.cancelledTasks["spec-review"]).toBe("string")
  expect(Object.keys(stored.state.activatedTasks).sort()).toEqual(["auth-core", "auth-review"])
  // The journal names each cancellation, and the accepted revision superseded the previous one.
  /** The journal lines. */
  const journal = readFileSync(journalPath(harness.workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
  expect(journal.filter((row) => row.event === "task-cancelled").length).toBe(2)
  expect(journal.filter((row) => row.event === "split-superseded").length).toBeGreaterThanOrEqual(1)
  // A dispatch pass NEVER wakes a cancelled row, and says so.
  /** The dispatch pass after the drop. */
  const dispatch = await runTool(harness, "cellwork_dispatch", {}, harness.captain)
  expect(dispatch.ok).toBe(true)
  /** The cancelled rows as the pass reported them. */
  const cancelledSkips = (dispatch.skipped as Array<Record<string, unknown>>).filter((row) => String(row.reason).includes("CANCELLED"))
  expect(cancelledSkips.map((row) => row.taskId).sort()).toEqual([String(digestRowId), String(stored.state.cancelledTasks["spec-review"])].sort())
})

// ── Wave 3 (C2): the three T6-low arms ─────────────────────────────────────

test("C2.1: the compaction barrier classifies busy, error and no-engine after the retry budget", async () => {
  /** The cell whose member is handoff-ready. */
  const cell = cellWithWorker()
  /** Two bounded attempts with no real wait. */
  const config = { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 2, idleBarrierDelayMs: 0 }
  /** The reseed and interrupt seams, shared by every arm below. */
  const seams = { startContinuableAgent: async (): Promise<unknown> => ({ childId: "handle-fresh" }), interruptAgent: (): void => {} }
  /** How many drives the BUSY engine was handed. */
  let busyAttempts = 0
  // A BUSY engine spends the whole retry budget and is classified as busy, not as an unexplained failure.
  /** The barrier's answer for a busy engine. */
  const busy = await promoteAfterHandoff({
    dsh: { ...seams, compactionEngineForAgent: () => ({ compactNow: async (): Promise<unknown> => { busyAttempts += 1; throw Object.assign(new Error("another compaction is already running"), { code: "busy" }) } }) },
    agent: {}, memberName: "worker", sessionId: "session-worker", cell, config,
    handoffText: "## Next step\nfinish B", nextStep: "finish B",
    injectDirective: () => {}, sleep: async () => {},
  })
  expect(busyAttempts).toBe(2)
  expect(busy.outcome).toBe("reseeded")
  expect(busy.reason).toBe("busy")
  /** The journal row that outcome writes. */
  const busyRow = compactionJournalEntry("worker", busy)
  expect(busyRow.event).toBe("compaction")
  expect(busyRow.reason).toBe("busy")
  expect(busyRow.attempts).toBe(2)
  // A THROWN ERROR is its own classification, and the reseed still happens.
  /** The barrier's answer for a failing engine. */
  const failed = await promoteAfterHandoff({
    dsh: { ...seams, compactionEngineForAgent: () => ({ compactNow: async (): Promise<unknown> => { throw new Error("the summarizer exploded") } }) },
    agent: {}, memberName: "worker", sessionId: "session-worker", cell, config,
    handoffText: "## Next step\nfinish B", nextStep: "finish B",
    injectDirective: () => {}, sleep: async () => {},
  })
  expect(failed.outcome).toBe("reseeded")
  expect(failed.reason).toBe("failed")
  expect(compactionJournalEntry("worker", failed).reason).toBe("failed")
  // An ABORT is a cancellation, never a failure; and the classifier reads a busy word too.
  expect(classifyCompactionError(new Error("boom"), compactionSignal().signal)).toBe("failed")
  expect(classifyCompactionError(Object.assign(new Error("x"), { name: "AbortError" }), compactionSignal().signal)).toBe("aborted")
  expect(classifyCompactionError(new Error("compactNow: busy"), compactionSignal().signal)).toBe("busy")
  // An ABSENT engine is its own token, so "no engine" is never reported as a failure either.
  /** The barrier's answer when the composition exposes no engine. */
  const noEngine = await promoteAfterHandoff({
    dsh: { ...seams, compactionEngineForAgent: () => undefined },
    agent: {}, memberName: "worker", sessionId: "session-worker", cell, config,
    handoffText: "## Next step\nfinish B", nextStep: "finish B",
    injectDirective: () => {}, sleep: async () => {},
  })
  expect(noEngine.reason).toBe("no-engine")
  expect(noEngine.attempts).toBe(2)
})

test("C2.2: mail addresses a member, `captain` and a cross-subcell recipient, and the journal carries the cell stamp", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  // 1. A MEMBER by name: durable, and no wake-up because only the captain holds Lead authority.
  /** The member-to-member message. */
  const toMember = await runTool(harness, "cellwork_send", { to: "cell-splitter", subject: "peer check", body: "is the graph ready?" }, plannerAgent(harness))
  expect(toMember.ok).toBe(true)
  expect(toMember.to).toBe("cell-splitter")
  expect(toMember.wakeSent).toBe(false)
  expect(String(toMember.wakeReason)).toContain("member-to-member")
  // 2. `captain` by name.
  /** The message to the captain. */
  const toCaptain = await runTool(harness, "cellwork_send", { to: "captain", subject: "which scope?", body: "A or B?" }, plannerAgent(harness))
  expect(toCaptain.ok).toBe(true)
  expect(toCaptain.to).toBe("captain")
  expect(String(toCaptain.wakeReason)).toContain("Lead has no executor handle")
  // 3. A CROSS-SUBCELL recipient: `<cellId>/<member>` in this cell's tree.
  /** The parent record, so the planner can be promoted to subcaptain. */
  const parent = readCell(harness.workspace, cellId)
  if (!parent.ok) throw new Error("expected a record")
  writeCell(harness.workspace, { ...parent.state, members: { ...parent.state.members, "cell-planner": { ...parent.state.members["cell-planner"], mode: "subcaptain" } } })
  /** The registered sub-cell. */
  const subcell = await runTool(harness, "cellwork_subteam", { objective: "child objective" }, plannerAgent(harness))
  expect(subcell.ok).toBe(true)
  /** The sub-cell id. */
  const subcellId = String(subcell.cellId)
  // A cell OUTSIDE the tree is refused, so the tree membership is what authorises the send.
  /** The refused out-of-tree recipient. */
  const outside = await runTool(harness, "cellwork_send", { to: "cell-not-in-tree/captain", subject: "s", body: "b" }, harness.captain)
  expect(outside.ok).toBe(false)
  expect(String(outside.error)).toContain("not in this cell's tree")
  /** The cross-cell message into the sub-cell's captain. */
  const cross = await runTool(harness, "cellwork_send", { to: subcellId + "/captain", subject: "child status", body: "report the child's first gate" }, harness.captain)
  expect(cross.ok).toBe(true)
  expect(cross.crossCell).toBe(subcellId)
  expect(cross.fromCell).toBe(cellId)
  expect(cross.to).toBe("captain")
  expect(cross.wakeSent).toBe(false)
  expect(String(cross.wakeReason)).toContain("cross-cell")
  // THE ROW LANDED WHERE THE RECIPIENT READS IT: the SUB-CELL's log, stamped with the sender's cell.
  /** The sub-cell's folded mail. */
  const subcellMail = foldCellMail(readCellMail(harness.workspace, subcellId))
  expect(subcellMail.length).toBe(1)
  expect(subcellMail[0].cellId).toBe(subcellId)
  expect(subcellMail[0].fromCell).toBe(cellId)
  expect(subcellMail[0].to).toBe("captain")
  expect(subcellMail[0].read).toBe(false)
  // The sender's own log never gained that row; its JOURNAL did, under the `cell:<cellId>` stamp.
  /** The sender cell's folded mail. */
  const senderMail = foldCellMail(readCellMail(harness.workspace, cellId))
  expect(senderMail.some((message) => message.subject === "child status")).toBe(false)
  /** The journal lines. */
  const journal = readFileSync(journalPath(harness.workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
  /** The three sends as the journal recorded them. */
  const sends = journal.filter((row) => row.event === "mail")
  expect(sends.length).toBe(3)
  expect(sends.every((row) => row.cell === "cell:" + cellId)).toBe(true)
  expect(sends.filter((row) => row.toCell === subcellId).length).toBe(1)
})

test("C2.3: an UNDELIVERED mail row is surfaced by cellwork_supervise, not only by the pending board", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  await startCell(harness)
  // A row whose wake-up could never be sent: the planner mails the captain, who holds no executor handle.
  const sent = await runTool(harness, "cellwork_send", { to: "captain", subject: "Need a decision", body: "ship or hold?" }, plannerAgent(harness))
  expect(sent.ok).toBe(true)
  expect(sent.wakeSent).toBe(false)
  // The captain's sweep surfaces it BY NAME, with the reason no wake-up went out.
  /** The captain's sweep. */
  const sweep = await runTool(harness, "cellwork_supervise", {}, harness.captain)
  expect(sweep.ok).toBe(true)
  expect(Number(sweep.unreadMail)).toBe(1)
  /** The undelivered rows as the sweep reports them. */
  const undelivered = sweep.wakeFailures as Array<Record<string, unknown>>
  expect(undelivered.length).toBe(1)
  expect(undelivered[0].id).toBe(sent.id)
  expect(undelivered[0].to).toBe("captain")
  expect(undelivered[0].subject).toBe("Need a decision")
  expect(String(undelivered[0].reason)).toContain("Lead has no executor handle")
  // Acknowledging it through the inbox clears it from the sweep: the surface reports LIVE undelivered mail.
  await runTool(harness, "cellwork_inbox", {}, harness.captain)
  /** The sweep after the acknowledgement. */
  const after = await runTool(harness, "cellwork_supervise", {}, harness.captain)
  expect(Number(after.unreadMail)).toBe(0)
  expect((after.wakeFailures as unknown[]).length).toBe(0)
})

// ── Wave 3 (Amendment 6 / T5): the two repair items ────────────────────────

/** The graph whose review is owned by the WORK's own role, which the graph rules refuse (self-review). */
function selfReviewTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store and its unit test.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review against the frozen contract.", kind: "review", ownerRole: "Senior Engineer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
  ]
}

test("Amendment 6 R1: the dispatched message names the contract file the verify loop froze, and that file EXISTS", async () => {
  /** The harness at its first activation. */
  const harness = makeHarness()
  /** The cell and its first activation. */
  const { cellId } = await activatedCell(harness)
  // The activation delivered exactly ONE message: the READY code task, to its declared owner.
  expect(harness.sends.length).toBe(1)
  /** The dispatched text. */
  const text = harness.sends[0].text
  /** The contract path the message names, scraped from its FROZEN CONTRACT line. */
  const match = /FROZEN CONTRACT[^\n]*?: (\S+\.md)/.exec(text)
  expect(match).not.toBeNull()
  /** The path the member is told to read. */
  const named = String(match?.[1] ?? "")
  // It is the SPLIT KEY's file, never the board id's (the defect this repair closes named contracts/T3.md).
  expect(named).toBe(".mpd/cellwork/" + cellId + "/contracts/auth-core.md")
  /** The board id the same task was minted as. */
  const boardId = String(harness.teamRecords.get("team-1")?.tasks.find((task: Record<string, any>) => task.subject === "Implement the auth core")?.id ?? "")
  expect(boardId).not.toBe("")
  expect(named).not.toContain(boardId + ".md")
  // THE FILE EXISTS: a dispatch cannot point a member at a document nobody wrote.
  expect(existsSync(join(harness.workspace, named))).toBe(true)
  // ... and it is the SAME path the verify loop froze for that task's verifier.
  /** The verify-loop call the activation made. */
  const opened = harness.calls.find((call) => call.name === "mpd_verify_open")
  expect(opened).toBeDefined()
  expect(String(opened?.arguments.contract)).toBe(named)
})

test("Amendment 6 R2: an accepted verdict is SUPERSEDED by a newer revision and SURVIVES a refused resubmission", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The started cell. */
  const cellId = await startCell(harness)
  await runTool(harness, "cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  /** The accepted first revision. */
  const first = await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  expect(first.accepted).toBe(true)
  expect(first.splitPath).toBe(".mpd/cellwork/" + cellId + "/split/1.json")
  /** The canonical verdict file. */
  const canonical = join(harness.workspace, ".mpd", "cellwork", cellId, "split", "1.json")
  /** Its BYTES before the refused resubmission, kept for byte identity. */
  const bytesBefore = readFileSync(canonical)
  // A REFUSED resubmission at the SAME revision (the review is owned by the work's own role).
  /** The refused verdict. */
  const refused = await runTool(harness, "cellwork_split", { action: "submit", tasks: selfReviewTasks() }, splitterAgent(harness))
  expect(refused.accepted).toBe(false)
  // The refusal landed BESIDE the accepted file, not on top of it.
  expect(String(refused.splitPath)).toBe(".mpd/cellwork/" + cellId + "/split/1.refused.json")
  expect(existsSync(join(harness.workspace, String(refused.splitPath)))).toBe(true)
  // BYTE IDENTITY: the accepted document is untouched by the refusal.
  expect(readFileSync(canonical).equals(bytesBefore)).toBe(true)
  // The accepted verdict is still what `show` answers, at the canonical path ...
  /** The stored verdict as the tool still reports it. */
  const shown = await runTool(harness, "cellwork_split", { action: "show" }, harness.captain)
  expect(shown.accepted).toBe(true)
  expect(shown.splitPath).toBe(".mpd/cellwork/" + cellId + "/split/1.json")
  // ... and it is still ACTIVATABLE, which is the durability that matters.
  /** The activation of the accepted revision. */
  const activated = await runTool(harness, "cellwork_activate", {}, harness.captain)
  expect(activated.ok).toBe(true)
  // A newer accepted revision SUPERSEDES the first one, which the journal records by name.
  await runTool(harness, "cellwork_requirements", { action: "update", content: COMPLETE_REQUIREMENTS + "\n## Extra\nmore\n" }, plannerAgent(harness))
  /** The accepted second revision. */
  const second = await runTool(harness, "cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  expect(second.accepted).toBe(true)
  expect(second.supersededRevision).toBe(1)
  /** The journal lines. */
  const journal = readFileSync(journalPath(harness.workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
  /** The supersede rows. */
  const superseded = journal.filter((row) => row.event === "split-superseded")
  expect(superseded.length).toBe(1)
  expect(superseded[0].revision).toBe(1)
  expect(superseded[0].by).toBe(2)
})
