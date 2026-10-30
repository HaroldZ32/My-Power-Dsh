// Offline tests for the LOSSLESS result contract (P1 contract §3.2 B1/B2): every cellwork tool result
// must survive the harness's lossless-JSON walk — no `undefined` own key, no non-finite number, no
// negative zero, no cycle. The harness is the same fake context the host drives, and every result is
// walked as the harness would walk it before the model could ever read it.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { readActiveCell, readCell, writeCell } from "../src/state.ts"

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
}

/** The roster the fake `mpdRoles` service serves, with distinguishable persona texts. */
const ROSTER = [
  { name: "Planner", persona: "PLANNER PERSONA TEXT" },
  { name: "Lead", persona: "LEAD PERSONA TEXT" },
  { name: "Senior Engineer", persona: "SENIOR ENGINEER PERSONA TEXT" },
  { name: "Reviewer", persona: "REVIEWER PERSONA TEXT" },
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

/** One valid handoff document carrying all seven required sections. */
const HANDOFF_TEXT = [
  "## Task",
  "Implement the auth core.",
  "## State",
  "The token store exists; its test is pending.",
  "## Decisions",
  "Store opaque tokens only.",
  "## Artifacts",
  "src/auth/store.ts",
  "## Verified facts",
  "The unit test reddens when the store is absent.",
  "## Open questions",
  "None.",
  "## Next step",
  "Write the store's unit test.",
].join("\n")

/** The text of one prompt block, whichever block shape the adapter forwarded. */
function blockText(blocks: unknown): string {
  if (Array.isArray(blocks)) return blocks.map((block) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? String((block as { text: unknown }).text) : "")).join("")
  return typeof blocks === "string" ? blocks : ""
}

/**
 * Walk one value the way the harness walks a tool result before it reaches a model.
 *
 * An own key whose value is `undefined`, a non-finite number, negative zero, a hole, a non-JSON leaf or
 * a cycle is fatal: `JSON.stringify` silently drops or rewrites each of them, which is exactly why the
 * defect this arm guards was invisible to every log.
 *
 * @param value - the candidate value.
 * @param path - the diagnostic path, built as the walk descends.
 * @param seen - the ancestors on the current path, so a cycle is reported rather than hung on.
 * @returns the first violation, or `undefined` when the value is lossless JSON.
 */
function losslessViolation(value: unknown, path: string = "$", seen: Set<unknown> = new Set<unknown>()): string | undefined {
  if (value === null) return undefined
  if (typeof value === "boolean" || typeof value === "string") return undefined
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return path + " is not a finite JSON number"
    return Object.is(value, -0) ? path + " is negative zero, which JSON cannot represent" : undefined
  }
  if (typeof value !== "object") return path + " is " + typeof value + ", which JSON cannot represent losslessly"
  if (seen.has(value)) return path + " is part of a cycle"
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) return path + "[" + index + "] is a hole"
      /** The violation inside this element, when there is one. */
      const bad = losslessViolation(value[index], path + "[" + index + "]", seen)
      if (bad !== undefined) return bad
    }
    return undefined
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    /** The violation inside this property, when there is one. */
    const bad = losslessViolation((value as Record<string, unknown>)[key], path + "." + key, seen)
    if (bad !== undefined) return bad
  }
  return undefined
}

/**
 * Build the fake harness and apply the plugin once.
 *
 * @returns the harness with every captured definition.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-lossless-"))
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
  /** The staged plan, when one exists. */
  let plan: Record<string, any> | null = null
  /** The approved record, when one exists. */
  let record: Record<string, any> | null = null
  /** The next loop id. */
  let loopSeq = 0
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
    /** The guard seam the adapter installs through (a no-op double: these arms test the result shape). */
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
       * Answer one team read.
       * @param _workspace - the workspace the caller passed (unused by the double).
       * @param teamId - the team asked for.
       * @returns the record, or undefined.
       */
      get: (_workspace: string, teamId: string): unknown => teamRecords.get(teamId),
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
        /** The member name the team spawn's label encodes (`<name> · <teamId>`). */
        const name = String(spec.label ?? "").split(" · ")[0]
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
  return { workspace, captain, tools, commands, events, calls, sends, teamRecords, handles }
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

/** The planner agent of the harness's cell. */
function plannerAgent(harness: Harness): FakeAgent {
  return { id: "handle-cell-planner", session: { id: "handle-cell-planner", header: { cwd: harness.workspace } } }
}

/** The splitter agent of the harness's cell. */
function splitterAgent(harness: Harness): FakeAgent {
  return { id: "handle-cell-splitter", session: { id: "handle-cell-splitter", header: { cwd: harness.workspace } } }
}

/** The senior engineer agent of the harness's cell (the work task's owner). */
function seniorAgent(harness: Harness): FakeAgent {
  return { id: "handle-Senior Engineer", session: { id: "handle-Senior Engineer", header: { cwd: harness.workspace } } }
}

/** One valid work+review pair owned by two different roles. */
function validTasks(): Array<Record<string, unknown>> {
  return [
    { key: "auth-core", subject: "Implement the auth core", description: "Add the token store and its unit test.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/auth/"], blockedBy: [], inputs: [], verify: true },
    { key: "auth-review", subject: "Review the auth core", description: "Blind review against the frozen contract.", kind: "review", ownerRole: "Reviewer", writeScopes: [], blockedBy: ["auth-core"], inputs: [], verify: false },
  ]
}

// ── B1: the supervise projection keeps a task without an owner lossless ─────

test("B1: cellwork_supervise walks losslessly with a task row that has no owner", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  await startCell(harness)
  /** The live record, whose board is replaced with one owned and one OWNERLESS task. */
  const record = harness.teamRecords.get("team-1")
  if (record === undefined) throw new Error("no live team record")
  record.tasks = [
    { id: "T1", subject: "a task with no owner", status: "pending" },
    { id: "T2", subject: "a task with an owner", status: "pending", owner: "Senior Engineer" },
  ]
  /** The captain's sweep. */
  const swept = await runTool(harness, "cellwork_supervise", {})
  expect(swept.ok).toBe(true)
  // THE WHOLE RESULT SURVIVES THE WALK: no `undefined` own key anywhere.
  expect(losslessViolation(swept)).toBeUndefined()
  /** The projected rows. */
  const tasks = swept.tasks as Array<Record<string, unknown>>
  expect(tasks.length).toBe(2)
  // The ownerless row either OMITS the key or carries a string — never an own key holding `undefined`.
  expect(tasks[0].owner ?? "").toBe("")
  expect(losslessViolation(tasks[0])).toBeUndefined()
  expect(tasks[1].owner).toBe("Senior Engineer")
})

// ── B2: every cellwork tool result survives the same walk ───────────────────

test("B2: the walk holds over every cellwork tool result the harness can invoke", async () => {
  /** The harness with a started cell. */
  const harness = makeHarness()
  /** The cell id. */
  const cellId = await startCell(harness)
  /** Every result collected for the walk, with the tool that produced it. */
  const results: Array<{ label: string; value: unknown }> = []
  /**
   * Invoke one tool and record its result.
   * @param label - the tool name, for the failure message.
   * @param args - its arguments.
   * @param agent - the calling agent.
   * @returns the tool's result.
   */
  const invoke = async (label: string, args: Record<string, unknown> = {}, agent: unknown = harness.captain): Promise<Record<string, any>> => {
    /** The result the tool returned. */
    const value = await runTool(harness, label, args, agent)
    results.push({ label, value })
    return value
  }
  await invoke("cellwork_status")
  await invoke("cellwork_context")
  await invoke("cellwork_inbox")
  await invoke("cellwork_send", { to: "cell-planner", subject: "hello", body: "one line" })
  await invoke("cellwork_requirements", { action: "finalize", content: COMPLETE_REQUIREMENTS }, plannerAgent(harness))
  await invoke("cellwork_split", { action: "submit", tasks: validTasks() }, splitterAgent(harness))
  await invoke("cellwork_split", { action: "show" })
  await invoke("cellwork_activate")
  await invoke("cellwork_dispatch")
  await invoke("cellwork_supervise")
  await invoke("cellwork_handoff", { content: HANDOFF_TEXT }, seniorAgent(harness))
  // A SUBCAPTAIN SEAT is the only seat that may register a sub-cell; the promotion is what the plugin
  // itself does after a handoff+compaction, so the arm seeds the seat the promotion would produce.
  /** The active cell's record after the handoff. */
  const active = readActiveCell(harness.workspace)
  if (!active.ok || active.cell === null) throw new Error("no active cell")
  /** The member row as it stands. */
  const member = active.cell.state.members["Senior Engineer"]
  if (member === undefined) throw new Error("the work task's owner is not a recorded member")
  writeCell(harness.workspace, { ...active.cell.state, members: { ...active.cell.state.members, "Senior Engineer": { ...member, mode: "subcaptain" } } })
  await invoke("cellwork_subteam", { objective: "nest one level" }, seniorAgent(harness))
  await invoke("cellwork_stop", { force: true, reason: "the walk is complete" })
  // THE ASSERTION: each result is lossless JSON; the label names the first offender.
  expect(results.map((entry) => entry.label).length).toBe(13)
  for (const entry of results) expect(entry.label + ": " + String(losslessViolation(entry.value))).toBe(entry.label + ": undefined")
  // The projection is also the truth the caller reads: the owner is spelled, not dropped, on an owned row.
  /** The board rows the cell actually holds after activation. */
  const record = harness.teamRecords.get("team-1")
  expect(record?.tasks.some((task: Record<string, any>) => task.owner === "Senior Engineer")).toBe(true)
  // The cell reached `stopped` through the forced stop, and its record still exists.
  /** The cell's own record after the stop. */
  const stopped = readCell(harness.workspace, cellId)
  expect(stopped.ok).toBe(true)
  if (stopped.ok) expect(stopped.state.phase).toBe("stopped")
})
