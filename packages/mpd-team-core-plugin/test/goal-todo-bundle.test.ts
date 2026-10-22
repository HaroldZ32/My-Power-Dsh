// R4 of the team-gate wave (2026-10-22): ONE approval starts THREE mechanisms.
//
// The requirement (user clause 4) is that the team flow must also trigger the goal and todo
// mechanisms — BUNDLED, not kept separate. The subject here is therefore the APPROVE success path of
// `agent_teams_plan`: exactly ONE goal anchor (objective = the plan description, source `team`) and
// ONE whole-list `todo_write` seeded from the staged task subjects, and both only once the team
// record exists.
//
// EVERY ARM DRIVES THE REAL TOOL SURFACE `apply()` registers. The negative controls are as
// load-bearing as the positive ones: `create`/`create_task` and a `dry_run` approval must anchor and
// seed NOTHING, the gate's inert shell must fail before any effect, a composition with no `mpdGoal`
// service and no `todo_write` tool must still approve, a plan with no tasks must not clear a
// checklist it did not create, and a THROWING or error-answering effect must cost ONE log line —
// never the approval.
//
// REPAIR (T7 / F-CR5, 2026-10-22) adds the two remaining NON-FATAL branch arms: an anchor that
// ANSWERS `ok:false` (refusal logged, approval preserved) and a `hasTool` probe that THROWS (seed
// skipped silently). F-CR4 is pinned by the seed-signal assertion in the whole-list arm: a caller
// signal would REPLACE the adapter's timeout, so the seed must pass a bounded, composed one.
//
// REPAIR (T15 / CR round 2, 2026-10-22) closes the hole that assertion left: the harness used to pass
// `signal: undefined` on EVERY call, so an arm could only prove that SOME signal reached the write
// (the 10 s timeout), never that CALLER cancellation propagates. `call` now forwards a real turn
// signal, and the caller-cancellation arm aborts its controller and observes the forwarded signal
// abort too.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index.ts"
import { activeTeamId } from "../src/team-store.ts"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One `executeTool` call the approval made, kept so the arms assert the REQUEST, not a side effect. */
interface ToolCall {
  /** The tool the approval asked for. */
  name: string
  /** The arguments it passed. */
  arguments: Record<string, unknown>
  /** The agent the call was attributed to. */
  agent: unknown
  /** The cancellation the call ran under, recorded so the bounded seed (F-CR4) can be asserted. */
  signal?: AbortSignal
}

/** The session id every arm approves from, so the fixtures share one Lead. */
const LEAD = "lead-session-r4"

/** Every sandbox these arms created, removed in one pass after each test. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** What the stub composition offers, per arm. */
interface HarnessOptions {
  /** `ok` mounts a working `mpdGoal`; `absent` mounts no row; `throw` rejects; `refuse` answers ok:false. */
  goal?: "ok" | "absent" | "throw" | "refuse"
  /** Whether the adapter reports `todo_write` as registered in this agent's view. */
  todoTool?: boolean
  /** Whether the `hasTool` probe THROWS instead of answering (the degrade step, F-CR5). */
  hasToolThrows?: boolean
  /** Whether the `todo_write` call REJECTS instead of answering. */
  todoThrows?: boolean
  /** Whether the `todo_write` call answers a marked ERROR RESULT instead of succeeding. */
  todoErrors?: boolean
}

/** The harness one arm drives: the sandbox workspace, the registered tools and every observation. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /** Every `mpdGoal.anchor` call, in call order. */
  goalCalls: Array<{ objective: string; source: string }>
  /** Every `executeTool` call the approval made, in call order. */
  toolCalls: ToolCall[]
  /** Every line the row logged through the adapter. */
  logLines: string[]
  /**
   * Drive one registered tool by name as the Lead session.
   * @param name - the registered tool name.
   * @param args - the tool arguments.
   * @param sessionId - the calling session.
   * @param signal - the turn cancellation the harness reports, forwarded VERBATIM on the exec (a real
   *                 signal is what lets an arm prove CALLER cancellation reaches an effect).
   * @returns the tool's own result, or its thrown refusal.
   */
  call: (name: string, args: unknown, sessionId: string, signal?: AbortSignal) => Promise<unknown>
}

/**
 * Build the harness: the real plugin applied against a stub composition.
 *
 * The stub adapter answers ONLY the seams this row uses; `hasTool` and `executeTool` are the two the
 * bundling adds, and both are observable so an arm can assert what the approval asked for.
 * @param options - what this arm's composition provides and how its effects behave.
 * @returns the harness an arm drives.
 */
function harness(options: HarnessOptions = {}): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-goal-todo-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** Every goal anchor call, observed instead of persisted. */
  const goalCalls: Harness["goalCalls"] = []
  /** Every internal tool call, observed instead of executed. */
  const toolCalls: ToolCall[] = []
  /** Every diagnostic line the row wrote. */
  const logLines: string[] = []
  /** The stub backend: it raises any member and mints a handle derived from the member's name. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    /**
     * Record nothing and answer a predictable handle.
     * @param _caller - the Lead agent, never inspected.
     * @param request - the raise request, read for the member's name.
     * @returns the handle the record keeps as `executorRef`.
     */
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    /** Deliver nothing; this file never exercises the mailbox. */
    send: async (): Promise<void> => {},
    /** Interrupt nobody. */
    interrupt: async (): Promise<void> => {},
    /** The backend tracks no live identity — the same blindness as a dsh-tui boot. */
    membership: (): undefined => undefined,
    /** The backend tracks no members; the record is the roster. */
    members: (): [] => [],
  }
  /** The goal row's service, shaped exactly like the `mpdGoal` slice this row consumes. */
  const goalService = {
    /**
     * Record the anchor request and answer per this arm's configuration.
     * @param _exec - the tool exec the approval forwarded, never inspected.
     * @param input - the objective and source the anchor was asked for.
     * @returns the anchor outcome; `throw` arms reject, `refuse` arms answer `ok:false`.
     */
    anchor: async (_exec: unknown, input: { objective: string; source: string }): Promise<{ ok: boolean; created: boolean; error?: string }> => {
      goalCalls.push({ ...input })
      if (options.goal === "throw") throw new Error("goal seam unavailable")
      if (options.goal === "refuse") return { ok: false, created: false, error: "the harness refused the anchor" }
      return { ok: true, created: true }
    },
  }
  /** The stub adapter: the seams this row uses, and nothing else. */
  const dsh = {
    registerTool: (definition: Tool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
    hasTool: (name: string): boolean => {
      // F-CR5: a THROWING probe is the DEGRADE step — the row must skip the seed, not log or fail.
      if (options.hasToolThrows === true) throw new Error("the tool registry is unavailable")
      return name === "todo_write" && (options.todoTool ?? true)
    },
    /**
     * Record the request and answer per this arm's configuration.
     * @param input - the tool call the approval made, including its cancellation.
     * @returns a successful result, a marked error result, or (in a `throw` arm) nothing.
     */
    executeTool: async (input: { name: string; arguments?: unknown; agent?: unknown; signal?: AbortSignal }): Promise<{ ok: boolean; isError: boolean; value?: unknown; error?: string }> => {
      toolCalls.push({ name: input.name, arguments: (input.arguments ?? {}) as Record<string, unknown>, agent: input.agent, ...(input.signal === undefined ? {} : { signal: input.signal }) })
      if (options.todoThrows === true) throw new Error("todo_write exploded")
      if (options.todoErrors === true) return { ok: false, isError: true, error: "the tool refused the write" }
      return { ok: true, isError: false, value: {} }
    },
    rowLog: (_name: string, line: string): void => { logLines.push(line) },
  }
  /** The minimal cordis context `apply` needs; `mpdGoal` is served only when this arm asked for it. */
  const ctx = {
    get: (id: string): unknown => {
      if (id === "mpdDsh") return dsh
      if (id === "mpdGoal") return options.goal === "absent" ? undefined : goalService
      return undefined
    },
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (): void => {},
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    goalCalls,
    toolCalls,
    logLines,
    call: async (name: string, args: unknown, sessionId: string, signal?: AbortSignal) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      /** The calling agent in the shape the tool surface reads. */
      const agent = { session: { id: sessionId, header: {} } }
      // The turn's cancellation rides the exec VERBATIM, exactly as the harness passes it: `undefined`
      // means "no cancellation was reported", a real signal means the turn can be cancelled mid-call.
      return tool.execute(args, { agent, signal })
    },
  }
}

/**
 * Stage the standard wave: one member and two tasks, WITHOUT approving it.
 * @param h - the harness to drive.
 * @param description - the plan description the goal objective is expected to carry.
 * @returns nothing; the plan is left staged for the arm to approve (or not).
 */
async function stageWave(h: Harness, description: string = "ship the wave"): Promise<void> {
  await h.call("agent_teams_plan", { action: "create", name: "the wave", description }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the lane work", description: "own the record", owner: "Senior Engineer" } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the review", description: "judge it" } }, LEAD)
}

/**
 * Stage the standard wave and approve it through the REAL plan tool, as {@link LEAD}.
 * @param h - the harness to drive.
 * @param description - the plan description the goal objective is expected to carry.
 * @param signal - the approving turn's cancellation, when the arm must prove CALLER propagation.
 * @returns the approval answer, which still carries the plan and the team.
 */
async function approveWave(h: Harness, description: string = "ship the wave", signal?: AbortSignal): Promise<unknown> {
  await stageWave(h, description)
  return h.call("agent_teams_plan", { action: "approve" }, LEAD, signal)
}

describe("R4 — approval bundles the durable goal and the todo checklist", () => {
  test("ONE anchor, with the plan description and source `team`, and the approval answer unchanged", async () => {
    /** This arm's composition: a working goal service and a registered todo tool. */
    const h = harness()
    /** The approval answer the effects must not alter. */
    const answer = await approveWave(h, "ship the wave")
    expect(h.goalCalls).toEqual([{ objective: "ship the wave", source: "team" }])
    expect(h.logLines).toEqual([])
    /** The approval answer, narrowed to the fields this arm asserts. */
    const approved = answer as { team?: { approvedAt?: string }; created?: { tasks?: unknown[] } }
    expect(approved.team?.approvedAt).toBeDefined()
    expect(approved.created?.tasks).toHaveLength(2)
    // The team really exists on disk: the effects ran on a SUCCESSFUL approval, not instead of one.
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })

  test("ONE whole-list todo_write, seeded pending from the task subjects and scoped to the live agent", async () => {
    /** This arm's composition: both effects available and healthy. */
    const h = harness()
    await approveWave(h)
    expect(h.toolCalls).toHaveLength(1)
    expect(h.toolCalls[0]?.name).toBe("todo_write")
    expect(h.toolCalls[0]?.arguments).toEqual({
      todos: [
        { content: "the lane work", status: "pending" },
        { content: "the review", status: "pending" },
      ],
    })
    // The call is scoped to the LIVE agent, which is what the `hasTool` probe promised to execute.
    expect((h.toolCalls[0]?.agent as { session?: { id?: string } }).session?.id).toBe(LEAD)
    // F-CR4: the write is BOUNDED and CANCELLABLE. A caller signal would make the adapter SKIP its
    // own timeout, so the row passes a composed one instead — present here, and not yet aborted.
    expect(h.toolCalls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(h.toolCalls[0]?.signal?.aborted).toBe(false)
  })

  test("CALLER cancellation reaches the seed: the write's signal follows the approving turn (F-CR4)", async () => {
    /** This arm's composition: a healthy couple, so the only new input is the CALLER's signal. */
    const h = harness()
    /** The approving turn's own cancellation — the thing that must reach the write. */
    const turn = new AbortController()
    await approveWave(h, "ship the wave", turn.signal)
    // LIVE, not pre-aborted: the composed signal follows the caller for as long as the turn lives.
    expect(h.toolCalls[0]?.signal?.aborted).toBe(false)
    // Aborting the CALLER aborts the very signal the row handed to `todo_write`; had the row passed
    // only its own timeout (the pre-T7 shape), this assertion is what would stay false.
    turn.abort()
    expect(h.toolCalls[0]?.signal?.aborted).toBe(true)
    // The approval itself already stood; the abort changed only when the write would have ended.
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })

  test("an empty plan description falls back to the plan NAME as the objective", async () => {
    /** This arm's composition: the goal service alone is what the assertion needs. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "named wave", description: "" }, LEAD)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the review", description: "judge it" } }, LEAD)
    await h.call("agent_teams_plan", { action: "approve" }, LEAD)
    expect(h.goalCalls).toEqual([{ objective: "named wave", source: "team" }])
  })

  test("NEGATIVE CONTROL: `create`/`create_task` and a `dry_run` approval anchor and seed NOTHING", async () => {
    /** This arm's composition: both effects available, so a missing call is a real absence. */
    const h = harness()
    await stageWave(h)
    expect(h.goalCalls).toHaveLength(0)
    expect(h.toolCalls).toHaveLength(0)
    await h.call("agent_teams_plan", { action: "approve", dry_run: true }, LEAD)
    expect(h.goalCalls).toHaveLength(0)
    expect(h.toolCalls).toHaveLength(0)
    // Only the REAL approval starts the mechanisms — and it starts each exactly once.
    await h.call("agent_teams_plan", { action: "approve" }, LEAD)
    expect(h.goalCalls).toHaveLength(1)
    expect(h.toolCalls).toHaveLength(1)
  })

  test("NEGATIVE CONTROL: the gate's inert shell cannot approve, so it anchors nothing", async () => {
    /** This arm's composition: the effects are available; the APPROVAL is what must refuse. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "shell", description: "staged by the gate" }, LEAD)
    /** The refusal the empty-shell approval is expected to raise. */
    let failure: unknown
    try { await h.call("agent_teams_plan", { action: "approve" }, LEAD) } catch (error) { failure = error }
    expect(String((failure as Error).message)).toContain("is EMPTY")
    expect(h.goalCalls).toHaveLength(0)
    expect(h.toolCalls).toHaveLength(0)
  })

  test("a composition without `mpdGoal` or `todo_write` still approves, and logs nothing", async () => {
    /** This arm's composition: neither optional surface is mounted. */
    const h = harness({ goal: "absent", todoTool: false })
    /** The approval answer, which must be a normal one. */
    const answer = await approveWave(h)
    expect(answer).toBeDefined()
    expect(h.goalCalls).toHaveLength(0)
    expect(h.toolCalls).toHaveLength(0)
    expect(h.logLines).toEqual([])
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })

  test("a plan with NO tasks seeds no todo list (a whole-list write would clear the captain's)", async () => {
    /** This arm's composition: both effects available, so the SKIP is what this arm proves. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "one member", description: "solo" }, LEAD)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
    await h.call("agent_teams_plan", { action: "approve" }, LEAD)
    // The goal still starts — the wave exists — but the checklist is NOT rewritten with an empty list.
    expect(h.goalCalls).toHaveLength(1)
    expect(h.toolCalls).toHaveLength(0)
  })

  test("a THROWING effect costs ONE log line each and never the approval", async () => {
    /** This arm's composition: the anchor rejects and the tool call explodes. */
    const h = harness({ goal: "throw", todoThrows: true })
    /** The approval answer, which must still be a normal one. */
    const answer = await approveWave(h)
    expect(answer).toBeDefined()
    expect(h.goalCalls).toHaveLength(1)
    expect(h.toolCalls).toHaveLength(1)
    expect(h.logLines).toHaveLength(2)
    expect(h.logLines[0]).toContain("goal anchor failed after approval: goal seam unavailable")
    expect(h.logLines[1]).toContain("todo seed failed after approval: todo_write exploded")
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })

  test("an ERROR-RESULT todo_write also costs one log line and never the approval", async () => {
    /** This arm's composition: the tool answers a marked error result instead of throwing. */
    const h = harness({ todoErrors: true })
    /** The approval answer, which must still be a normal one. */
    const answer = await approveWave(h)
    expect(answer).toBeDefined()
    expect(h.toolCalls).toHaveLength(1)
    expect(h.logLines).toHaveLength(1)
    expect(h.logLines[0]).toContain("todo seed failed after approval: the tool refused the write")
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })

  test("a REFUSED anchor logs one line and leaves the approval intact (F-CR5)", async () => {
    /** This arm's composition: the goal row ANSWERS `ok:false` instead of anchoring. */
    const h = harness({ goal: "refuse" })
    /** The approval answer, which the refusal must not change. */
    const answer = await approveWave(h)
    expect(answer).toBeDefined()
    expect(h.goalCalls).toHaveLength(1)
    // Exactly ONE line, naming the harness's own reason; the seed still runs (independent effects).
    expect(h.logLines).toEqual(["goal anchor refused after approval: the harness refused the anchor"])
    expect(h.toolCalls).toHaveLength(1)
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })

  test("a THROWING hasTool probe skips the seed silently and leaves the approval intact (F-CR5)", async () => {
    /** This arm's composition: the probe itself throws, the path a partial adapter would take. */
    const h = harness({ hasToolThrows: true })
    /** The approval answer, which a probe failure must not change. */
    const answer = await approveWave(h)
    expect(answer).toBeDefined()
    expect(h.goalCalls).toHaveLength(1) // the anchor does not depend on the tool probe
    expect(h.toolCalls).toHaveLength(0) // the seed was never attempted
    expect(h.logLines).toEqual([]) // a probe miss is the DEGRADE step, not a failure
    expect(activeTeamId(h.workspace, LEAD)).toBeDefined()
  })
})
