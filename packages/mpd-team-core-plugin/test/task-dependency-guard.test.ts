// THE DEPENDENCY GUARD — red first (`.mpd/plans/task-dependency-guard.md`, R1/R2/R3/R5).
//
// WHY THIS FILE EXISTS. Three measured defects (evidence/repro-missing-blocked-by/):
//   PROBE 1 — a task `T2` carrying `blockedBy: ["T1"]` was CLAIMED while `T1` was still `pending`, even
//             though `agent_teams_dispatch` refused the same pairing ("not ready (blocked by T1)"). The
//             dispatch path was gated and the claim path — the verb a captain actually uses — was not.
//   PROBE 2 — requirement / work / review tasks created with NO dependency declaration at all were all
//             independently ready and paired in ONE dispatch pass, and approval said nothing.
//
// Each arm below pins one clause of the frozen contract:
//   R1  create_task requires EXACTLY ONE dependency answer — `blocked_by: [...]` (array, may be empty)
//       or `independent: true` — refusing: neither, a non-empty list beside `independent: true`, a
//       non-array list, a self-reference, any cycle, and two aliases that disagree. All three aliases
//       (`task.blocked_by`, `task.blockedBy`, top-level `blocked_by`) keep working.
//   R2  approve refuses two tasks whose WRITE SCOPES overlap when NEITHER has a dependency path to the
//       other, naming the pair and the two remedies; dangling references stay a WARNING.
//   R14 the two under-tested R2 clauses: (a) a MULTI-HOP path (T3 ← T2 ← T1) orders T1 and T3 sharing
//       a scope; (b) the SEGMENT boundary in both directions — `packages/x` ≠ `packages/xy` and
//       `packages/x` ⊃ `packages/x/y`.
//   R3  claim refuses a task whose declared blockers are not satisfied, naming them, through the SAME
//       predicate dispatch uses (`blockingDependencies` / `readyTasks`).
//   R5  the guard refuses nothing else: a single-task plan, the 0-member/0-task shell (its exact
//       sentence) and the requirement/work/review triple all still behave as they did.
//   R11 approve re-validates the WHOLE plan graph, so `edit` (a bulk replace) cannot smuggle in a task
//       with NO dependency answer, a self-edge, or a cycle that approval would then accept.
//
// Every arm drives the REAL registered tools through `apply()`; the board is only ever read from disk.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { listContracts } from "../src/plan-store"
import { activeTeamId, listTeams, readTeam } from "../src/team-store"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness calls it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The session the plan is staged and approved from, so every fixture knows who the Lead is. */
const LEAD = "lead-session-1"

/** Every sandbox workspace these arms created, removed in one pass after each arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** The harness one arm drives: the sandbox and the registered tools. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /**
   * Drive one registered tool by name as a given session.
   * @param name - the registered tool name.
   * @param args - the tool arguments.
   * @param sessionId - the calling session, which is what ownership checks read.
   * @returns the tool's own result, or its thrown refusal.
   */
  call: (name: string, args: unknown, sessionId?: string) => Promise<unknown>
}

/**
 * Build the harness: the real plugin applied against a stub composition.
 * @returns the harness an arm drives.
 */
function harness(): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-dep-guard-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The stub backend: it raises any member and mints a handle derived from the member's name. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
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
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (): void => {},
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    call: async (name: string, args: unknown, sessionId: string = LEAD) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId } }, signal: undefined })
    },
  }
}

/**
 * The refusal a call produced, captured as an Error so an arm can quote its message.
 * @param work - the call that is expected to refuse.
 * @returns the thrown value, or undefined when the call succeeded.
 */
async function refusalOf(work: Promise<unknown>): Promise<Error | undefined> {
  return work.then(() => undefined, (error: unknown) => error as Error)
}

/**
 * Stage an empty plan in a fresh sandbox, which is the state every `create_task` arm starts from.
 * @param h - the harness to stage in.
 * @returns nothing; the plan is staged for the Lead session.
 */
async function stagePlan(h: Harness): Promise<void> {
  await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" })
}

/**
 * Stage then approve the plan, asserting the approval really happened.
 * @param h - the harness to approve in.
 * @returns the approved team's id.
 */
async function approveStaged(h: Harness): Promise<string> {
  await h.call("agent_teams_plan", { action: "approve" })
  /** The team the approval bound to the Lead session. */
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
  return teamId
}

/**
 * The board row as the record ON DISK holds it — the only reading an arm may call the board.
 * @param workspace - the workspace holding the record.
 * @param teamId - the team to read.
 * @param taskId - the task to find.
 * @returns the stored row, or undefined when it is not there.
 */
function taskOnDisk(workspace: string, teamId: string, taskId: string): { status?: string; blockedBy?: string[] } | undefined {
  return readTeam(workspace, teamId)?.tasks.find((candidate) => candidate.id === taskId)
}

describe("R1 — create_task requires exactly one dependency answer", () => {
  test("(a) NEITHER spelling is refused, and the sentence names both spellings and the fix", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "solo", description: "one task" } }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    // BOTH spellings are named, so a caller never has to guess what the answer looks like.
    expect(message).toContain("blocked_by")
    expect(message).toContain("independent: true")
    // R4: the task id it WOULD be minted as, and a concrete fix.
    expect(message).toContain("T1")
    expect(message).toContain("solo")
    // NOTHING was staged: a refusal that still created the row would be worse than none.
    /** The plan as the tool reports it. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: unknown[] } }
    expect(plan.plan?.tasks).toEqual([])
  })

  test("(b) a NON-EMPTY blocked_by with independent:true is contradictory; blocked_by:[] alone is valid", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    /** The contradictory declaration. */
    const contradiction = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "both", description: "d", blocked_by: ["T1"], independent: true } }))
    expect(contradiction).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(contradiction?.message)
    expect(message).toContain("blocked_by")
    expect(message).toContain("independent")
    expect(message).toContain("T1")
    expect(message).toContain("both")
    // A refusal names a fix: drop `independent`, or send the empty list for a genuine root.
    expect(message.toLowerCase()).toContain("fix")
    // `blocked_by: []` IS an explicit declaration of independence, not a missing answer.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "root", description: "d", blocked_by: [] } })
    // …and `independent: true` alone is the other accepted spelling.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "root two", description: "d", independent: true } })
    /** The staged plan, whose two tasks both carry an empty edge set. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: Array<{ subject: string; blockedBy?: string[] }> } }
    expect(plan.plan?.tasks.map((task) => task.subject)).toEqual(["root", "root two"])
    expect(plan.plan?.tasks.map((task) => task.blockedBy ?? [])).toEqual([[], []])
  })

  test("(c) a NON-ARRAY blocked_by is refused at every alias, never silently dropped", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    /** Every non-array spelling the wire can carry, one per plan. */
    const spellings: Array<Record<string, unknown>> = [
      { task: { subject: "stringly", description: "d", blocked_by: "T1" } },
      { task: { subject: "numeric", description: "d", blockedBy: 7 } },
      { task: { subject: "object", description: "d" }, blocked_by: { first: "T1" } },
    ]
    for (const args of spellings) {
      /** The refusal for this spelling. */
      const refusal = await refusalOf(h.call("agent_teams_plan", { action: "create_task", ...args }))
      expect(refusal).toBeDefined()
      /** The sentence the caller reads. */
      const message = String(refusal?.message)
      expect(message).toContain("blocked_by")
      // The fix is an array, spelled out — an empty one for a root.
      expect(message).toContain("[]")
      // R4: the task being refused is named by the id it would get.
      expect(message).toContain("T1")
    }
    /** The plan as the tool reports it: NOTHING was appended by any of the three. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: unknown[] } }
    expect(plan.plan?.tasks).toEqual([])
  })

  test("(d) a SELF-reference is refused at create time, naming the task", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    /** A task whose blocker names its own subject. */
    const bySubject = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: ["core"] } }))
    expect(bySubject).toBeDefined()
    expect(String(bySubject?.message)).toContain("core")
    expect(String(bySubject?.message)).toContain("T1")
    // The same rule through the two ID spellings: the plan's own position and the id it will mint.
    /** The refusal for `blocked_by: ["1"]`. */
    const byPosition = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: ["1"] } }))
    expect(byPosition).toBeDefined()
    /** The refusal for `blocked_by: ["T1"]`. */
    const byId = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: ["T1"] } }))
    expect(byId).toBeDefined()
    /** The plan as the tool reports it: no row was ever appended. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: unknown[] } }
    expect(plan.plan?.tasks).toEqual([])
  })

  test("(e) a CYCLE is refused at create time, naming both tasks, and the plan is left fixable", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // A forward reference is legitimate on its own: T1 may depend on the task staged second.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "first", description: "d", blocked_by: ["2"] } })
    /** The second task closing the loop back onto the first. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "second", description: "d", blocked_by: ["1"] } }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    expect(message).toContain("T1")
    expect(message).toContain("T2")
    expect(message.toLowerCase()).toContain("cycle")
    // THE REFUSAL LEAVES A FIXABLE PLAN: only the first task is staged, so the captain can re-send the
    // second one with the edge the other way round.
    /** The still-staged plan. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: Array<{ subject: string; blockedBy?: string[] }> } }
    expect(plan.plan?.tasks.map((task) => task.subject)).toEqual(["first"])
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "second", description: "d", blocked_by: [] } })
    /** The approved team, whose first task still points at the second. */
    const teamId = await approveStaged(h)
    expect(taskOnDisk(h.workspace, teamId, "T1")?.blockedBy).toEqual(["T2"])
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual([])
  })

  test("(f) two aliases that DISAGREE are refused, and agreeing aliases are one answer", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    /** The nested and the top-level spelling naming different blockers. */
    const refusal = await refusalOf(h.call("agent_teams_plan", {
      action: "create_task",
      task: { subject: "split", description: "d", blocked_by: ["T1"] },
      blocked_by: ["T2"],
    }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    // BOTH spellings are named, so the caller knows which two keys disagreed.
    expect(message).toContain("task.blocked_by")
    expect(message).toContain("blocked_by")
    expect(message).toContain("T1")
    expect(message).toContain("T2")
    // AGREEMENT IS NOT A CONFLICT: the same list in two aliases is one answer.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "first", description: "d", blocked_by: [] }, blocked_by: [] })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "second", description: "d", blocked_by: ["first"], blockedBy: ["first"] } })
    /** The staged plan, whose second task carries the one edge both spellings agreed on. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: Array<{ blockedBy?: string[] }> } }
    expect(plan.plan?.tasks[1].blockedBy).toEqual(["first"])
  })

  test("all THREE aliases keep working: task.blocked_by, task.blockedBy and top-level blocked_by", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // Three tasks, one per accepted spelling, each a genuine root — the declaration, not the edge.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "snake", description: "d", blocked_by: [] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "camel", description: "d", blockedBy: [] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "top", description: "d" }, blocked_by: [] })
    /** The approved team. */
    const teamId = await approveStaged(h)
    /** The board rows, read from disk: every task exists and none is blocked. */
    const board = readTeam(h.workspace, teamId)?.tasks ?? []
    expect(board.map((task) => task.subject)).toEqual(["snake", "camel", "top"])
    expect(board.map((task) => task.blockedBy)).toEqual([[], [], []])
  })

  test("the MID-RUN LIVE arm obeys R1 too: the answer is required there as well", async () => {
    // `create_task` after approval appends to the LIVE record — the arm 9 of 10 real calls use (the
    // measured spelling of the 2026-10-02 defect). It must not be the road around the new rule.
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "root", description: "d", blocked_by: [] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    /** A live append that states no answer. */
    const missing = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "repair", description: "d" } }))
    expect(missing).toBeDefined()
    expect(String(missing?.message)).toContain("independent: true")
    // A live append that names ITSELF by its own subject is refused as a self-reference.
    /** The live self-reference. */
    const self = await refusalOf(h.call("agent_teams_plan", { action: "create_task", task: { subject: "repair", description: "d", blocked_by: ["repair"] } }))
    expect(self).toBeDefined()
    expect(String(self?.message)).toContain("SELF-REFERENCE")
    // …and the declared spelling lands, exactly as on the staged arm.
    /** The live append that states its answer. */
    const appended = (await h.call("agent_teams_plan", { action: "create_task", task: { subject: "repair", description: "d", blocked_by: [] } })) as { task?: { id?: string; blockedBy?: string[] } }
    expect(appended.task?.id).toBe("T2")
    expect(appended.task?.blockedBy).toEqual([])
    expect(readTeam(h.workspace, teamId)?.tasks.map((task) => task.subject)).toEqual(["root", "repair"])
  })
})

describe("R2 — approve refuses overlapping write scopes with no dependency path", () => {
  test("the pair is REFUSED, naming both tasks, both scopes and the two remedies", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // `packages/x/**` normalises to `packages/x`, so the two scopes are equal — the classic collision.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: [], write_scopes: ["packages/x/**"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "other", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "approve" }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    // The PAIR, by id and by subject.
    expect(message).toContain("T1")
    expect(message).toContain("T2")
    expect(message).toContain("core")
    expect(message).toContain("other")
    // …the two scopes that collide…
    expect(message).toContain("packages/x")
    // …and BOTH remedies: a `blocked_by` edge, or disjoint scopes.
    expect(message).toContain("blocked_by")
    expect(message.toLowerCase()).toContain("disjoint")
    // A refused approval mints NO team.
    expect(listTeams(h.workspace)).toEqual([])
  })

  test("remedy 1 — the same overlap APPROVES once one task depends on the other", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: [], write_scopes: ["packages/x/**"] } })
    // The edge is the ordered answer: T2 runs after T1, so the shared path is written in sequence.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "other", description: "d", blocked_by: ["core"], write_scopes: ["packages/x"] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual(["T1"])
  })

  test("remedy 2 — the same two tasks APPROVE when their scopes are made disjoint", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: [], write_scopes: ["packages/x/**"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "other", description: "d", blocked_by: [], write_scopes: ["packages/y"] } })
    /** The approved team, with both rows on the board and no edge between them. */
    const teamId = await approveStaged(h)
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual([])
  })

  test("R14(a) a MULTI-HOP path satisfies R2: T1 and T3 share a scope and APPROVE through T2", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // T1 is the root and owns `packages/x`; T2 sits between them on an unrelated scope; T3 owns the
    // SAME scope as T1 but reaches it only TRANSITIVELY (T3 ← T2 ← T1). A direct-edge-only check would
    // see no edge between T1 and T3 and refuse a plan the contract calls ordered.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "root", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "middle", description: "d", blocked_by: ["T1"], write_scopes: ["packages/other"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "tail", description: "d", blocked_by: ["T2"], write_scopes: ["packages/x"] } })
    /** The approved team: reachability, not a direct edge, is what orders T1 and T3. */
    const teamId = await approveStaged(h)
    /** The board, read from disk: the two-hop chain survived approval unchanged. */
    const board = readTeam(h.workspace, teamId)?.tasks ?? []
    expect(board.map((task) => task.blockedBy)).toEqual([[], ["T1"], ["T2"]])
  })

  test("R14(b)(i) `packages/x` and `packages/xy` do NOT overlap, so the plan APPROVES", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // A bare `startsWith` would read `packages/xy` as living under `packages/x`; the definition says
    // a prefix only counts at a SEGMENT boundary, so these two are disjoint.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "x", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "xy", description: "d", blocked_by: [], write_scopes: ["packages/xy"] } })
    /** The approved team, with both unordered rows on the board. */
    const teamId = await approveStaged(h)
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual([])
    expect(listTeams(h.workspace).length).toBe(1)
  })

  test("R14(b)(ii) `packages/x` and `packages/x/y` DO overlap, so the plan is REFUSED", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // The other direction of the same boundary: `packages/x/y` is a strict subtree of `packages/x`,
    // so an unordered pair writing both could edit one file concurrently.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "x", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "x/y", description: "d", blocked_by: [], write_scopes: ["packages/x/y"] } })
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "approve" }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads, naming both scopes as JSON so the prefix cannot mask one. */
    const message = String(refusal?.message)
    expect(message).toContain(`"packages/x"`)
    expect(message).toContain(`"packages/x/y"`)
    // The pair is named too, which is what makes the refusal actionable (R4).
    expect(message).toContain("T1")
    expect(message).toContain("T2")
    expect(listTeams(h.workspace)).toEqual([])
  })

  test("`**` and `.` cover every path, and an EMPTY scope list never overlaps", async () => {
    /** The harness whose plan pairs `**` with a concrete path. */
    const broad = harness()
    await stagePlan(broad)
    await broad.call("agent_teams_plan", { action: "create_task", task: { subject: "everything", description: "d", blocked_by: [], write_scopes: ["**"] } })
    await broad.call("agent_teams_plan", { action: "create_task", task: { subject: "one path", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    /** The refusal the covering scope produces. */
    const covering = await refusalOf(broad.call("agent_teams_plan", { action: "approve" }))
    expect(covering).toBeDefined()
    expect(String(covering?.message)).toContain("T1")
    expect(String(covering?.message)).toContain("T2")

    /** The harness whose plan pairs `.` with a concrete path. */
    const root = harness()
    await stagePlan(root)
    await root.call("agent_teams_plan", { action: "create_task", task: { subject: "root", description: "d", blocked_by: [], write_scopes: ["."] } })
    await root.call("agent_teams_plan", { action: "create_task", task: { subject: "one path", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    /** The refusal the root scope produces. */
    const rooted = await refusalOf(root.call("agent_teams_plan", { action: "approve" }))
    expect(rooted).toBeDefined()

    /** The harness whose second task declares NO scope at all. */
    const silent = harness()
    await stagePlan(silent)
    await silent.call("agent_teams_plan", { action: "create_task", task: { subject: "everything", description: "d", blocked_by: [], write_scopes: ["**"] } })
    // An empty list is not "everything": it names no path, so it can never collide.
    await silent.call("agent_teams_plan", { action: "create_task", task: { subject: "reader", description: "d", blocked_by: [], write_scopes: [] } })
    /** The approved team. */
    const teamId = await approveStaged(silent)
    expect(taskOnDisk(silent.workspace, teamId, "T2")?.blockedBy).toEqual([])
  })

  test("a DANGLING reference stays a WARNING at approval, never a refusal", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "only", description: "d", blocked_by: ["nowhere"] } })
    // The approval SUCCEEDS: a dangling reference is reported, not refused (the contract's explicit bound).
    /** The approval answer, whose `created.unresolved` names the dangling text. */
    const approved = (await h.call("agent_teams_plan", { action: "approve" })) as { created?: { unresolved?: Array<{ taskId: string; references: string[] }> } }
    expect(approved.created?.unresolved).toEqual([{ taskId: "T1", references: ["nowhere"] }])
  })
})

describe("R3 — claim obeys the readiness predicate dispatch already uses", () => {
  test("claiming a task whose blocker is still pending is REFUSED, naming the blocker and the fix", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "write the core", description: "d", blocked_by: [] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "d", blocked_by: ["1"] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_task", { action: "claim", task_id: "T2", claimant: "Reviewer" }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    // The BLOCKER ids are named, which is what makes the refusal actionable…
    expect(message).toContain("T1")
    expect(message).toContain("T2")
    // …plus a concrete fix on the blocker itself.
    expect(message).toContain("complete")
    // NOTHING moved: the row is still pending, unowned, and no contract was frozen — the refusal runs
    // BEFORE `claimContract`, so a refused claim leaves no attempt behind for a later reader to trust.
    expect(taskOnDisk(h.workspace, teamId, "T2")?.status).toBe("pending")
    expect(readTeam(h.workspace, teamId)?.tasks.find((task) => task.id === "T2")?.owner).toBeUndefined()
    expect(listContracts(h.workspace)).toEqual([])
  })

  test("the SAME pairing dispatch refuses — once the blocker completes, the claim is admitted", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "write the core", description: "d", blocked_by: [] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "d", blocked_by: ["1"] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    // Dispatch's own dry run refuses the pairing before the blocker closes…
    /** The dispatch preview. */
    const preview = (await h.call("agent_teams_dispatch", { action: "run", dry_run: true })) as { skipped?: Array<{ taskId: string; reason: string }> }
    expect(preview.skipped?.find((row) => row.taskId === "T2")?.reason).toContain("blocked by T1")
    // …the blocker closes…
    await h.call("agent_teams_task", { action: "complete", task_id: "T1" })
    // …and the SAME claim now succeeds, with its own frozen contract.
    /** The claim answer. */
    const claimed = (await h.call("agent_teams_task", { action: "claim", task_id: "T2", claimant: "Reviewer" })) as { contract?: { taskId?: string; attempt?: number } }
    expect(claimed.contract?.taskId).toBe("T2")
    expect(claimed.contract?.attempt).toBe(1)
    expect(taskOnDisk(h.workspace, teamId, "T2")?.status).toBe("in_progress")
  })

  test("OPT-1 is UNCHANGED: a FAILED blocker releases its dependent, so the claim is admitted", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "write the core", description: "d", blocked_by: [] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "d", blocked_by: ["1"] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    await h.call("agent_teams_task", { action: "fail", task_id: "T1", note: "will not be done" })
    /** The claim, which a failed blocker must NOT refuse. */
    const claimed = (await h.call("agent_teams_task", { action: "claim", task_id: "T2", claimant: "Reviewer" })) as { contract?: { taskId?: string } }
    expect(claimed.contract?.taskId).toBe("T2")
    expect(taskOnDisk(h.workspace, teamId, "T2")?.status).toBe("in_progress")
  })

  test("CONTROL — a genuinely ready task still claims exactly as before", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "alone", description: "d", blocked_by: [] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    /** The claim answer. */
    const claimed = (await h.call("agent_teams_task", { action: "claim", task_id: "T1", claimant: "Reviewer" })) as { contract?: { taskId?: string; claimedBy?: string } }
    expect(claimed.contract?.taskId).toBe("T1")
    expect(claimed.contract?.claimedBy).toBe("Reviewer")
    expect(taskOnDisk(h.workspace, teamId, "T1")?.status).toBe("in_progress")
  })
})

describe("R11 — approve re-validates the WHOLE plan graph", () => {
  test("(a) a plan BULK-EDITED to a task with NO dependency answer is REFUSED at approve", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // `edit` REPLACES the task list, and before R11 it accepted a task carrying no `blockedBy` at all —
    // the one staging verb that could smuggle an unanswered row past `create_task`'s write-time rule.
    // Approval is where every path meets, so it re-checks the WHOLE plan.
    await h.call("agent_teams_plan", { action: "edit", tasks: [{ subject: "unanswered", description: "d" }] })
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "approve" }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    // The task is named by the id approval would mint and by its subject.
    expect(message).toContain("T1")
    expect(message).toContain("unanswered")
    // BOTH accepted spellings are named, so the fix is never a guess.
    expect(message).toContain("blocked_by")
    expect(message).toContain("independent: true")
    // R4: a concrete fix.
    expect(message.toLowerCase()).toContain("fix")
    // A refused approval mints NO team…
    expect(listTeams(h.workspace)).toEqual([])
    // …and leaves the plan staged, so the captain can answer and approve.
    /** The still-staged plan, whose task still carries no answer field. */
    const plan = (await h.call("agent_teams_plan", { action: "edit" })) as { plan?: { tasks: Array<{ blockedBy?: string[] }> } }
    expect(plan.plan?.tasks[0].blockedBy).toBeUndefined()
  })

  test("(b) a SELF-EDGE staged by `edit` is REFUSED at approve, naming the path", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // The plan's own 1-based POSITION naming itself: `edit` accepts the text, and no graph reader ran
    // on the edited plan before R11 — the task would reach the board blocked by itself.
    await h.call("agent_teams_plan", { action: "edit", tasks: [{ subject: "loop", description: "d", blockedBy: ["1"] }] })
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "approve" }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    expect(message.toLowerCase()).toContain("self-edge")
    // THE PATH is named: the task, its subject, and the edge back onto itself.
    expect(message).toContain('T1 ("loop") -> T1')
    expect(listTeams(h.workspace)).toEqual([])
  })

  test("(c) a CYCLE staged by `edit` is REFUSED at approve, naming the path", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // Two tasks closing a loop through the plan's own positions: `edit` accepted the text, and approval
    // used to mint a board on which NEITHER task could ever become ready.
    await h.call("agent_teams_plan", {
      action: "edit",
      tasks: [
        { subject: "first", description: "d", blockedBy: ["2"] },
        { subject: "second", description: "d", blockedBy: ["1"] },
      ],
    })
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "approve" }))
    expect(refusal).toBeDefined()
    /** The sentence the caller reads. */
    const message = String(refusal?.message)
    expect(message.toLowerCase()).toContain("cycle")
    // THE PATH is named end to end: both tasks and both hops.
    expect(message).toContain('T1 ("first") -> T2 ("second") -> T1')
    expect(listTeams(h.workspace)).toEqual([])
  })

  test("(d) CONTROL — a bulk edit that ANSWERS for every task, on an acyclic graph, still approves", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    // The SAME verb that staged (a)–(c), now carrying the answers: a root and a task that waits for it.
    await h.call("agent_teams_plan", {
      action: "edit",
      tasks: [
        { subject: "root", description: "d", blockedBy: [] },
        { subject: "child", description: "d", blockedBy: ["root"] },
      ],
    })
    /** The approved team. */
    const teamId = await approveStaged(h)
    /** The board, read from disk: the edge survived the bulk replace. */
    const board = readTeam(h.workspace, teamId)?.tasks ?? []
    expect(board.map((task) => task.subject)).toEqual(["root", "child"])
    expect(board.map((task) => task.blockedBy)).toEqual([[], ["T1"]])
    // `independent: true` is NORMALISED before approval ever reads it: `create_task` stores
    // `blockedBy: []`, which is a complete answer — so approval demands no `independent` persistence.
    /** A second harness whose root task was staged with the boolean spelling. */
    const boolean = harness()
    await stagePlan(boolean)
    await boolean.call("agent_teams_plan", { action: "create_task", task: { subject: "boolean root", description: "d", independent: true } })
    /** The approved team, whose task carries the normalised empty list. */
    const booleanTeam = await approveStaged(boolean)
    expect(taskOnDisk(boolean.workspace, booleanTeam, "T1")?.blockedBy).toEqual([])
  })
})

describe("R5 — the guard refuses nothing else", () => {
  test("a SINGLE-task plan that declares its answer still approves", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "solo", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    /** The approval answer. */
    const approved = (await h.call("agent_teams_plan", { action: "approve" })) as { created?: { tasks: unknown[] } }
    expect(approved.created?.tasks.length).toBe(1)
    expect(listTeams(h.workspace).length).toBe(1)
  })

  test("the 0-member / 0-task shell keeps its EXACT empty-plan sentence", async () => {
    /** The harness this arm drives. */
    const h = harness()
    // The mechanically staged shell: `approval:"required"` with nothing in it.
    await h.call("agent_teams_plan", { action: "create", name: "shell", description: "a mechanically staged plan", approval: "required" })
    /** The refusal. */
    const refusal = await refusalOf(h.call("agent_teams_plan", { action: "approve" }))
    expect(refusal).toBeDefined()
    /** The still-staged plan, read through the tool, so the sentence is compared against the REAL id. */
    const planView = (await h.call("agent_teams_plan", { action: "status" })) as { plan?: { planId?: string } }
    /** The id the frozen sentence must name. */
    const planId = String(planView.plan?.planId)
    expect(planId).toMatch(/^plan-/u)
    // BYTE-IDENTICAL to the sentence the contract freezes (R13, Amendment 2): R10's freeze plus ONE
    // trailing clause naming the dependency answer, because obeying the sentence's advice would
    // otherwise produce a second refusal. The pinned substrings, opening words and precedence stay.
    expect(String(refusal?.message)).toBe(`plan ${planId} is EMPTY — it has 0 members and 0 tasks, and approving it would create a team with nothing in it; add a member with agent_teams_plan {action:"add_member", member:{name, prompt}} and/or a task with {action:"create_task", task:{subject, description}} first — a task added there must also declare its dependency answer with blocked_by: [...] (possibly []) or independent: true`)
    expect(listTeams(h.workspace)).toEqual([])
  })

  test("the requirement / work / review TRIPLE approves when it declares its edges and orders its scopes", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await stagePlan(h)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Lead", description: "coordinates", prompt: "You lead." } })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
    // THE SHAPE A CAPTAIN ACTUALLY STAGES: requirement → work → review, each declaring its answer.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "requirement: the guard", description: "freeze it", kind: "requirement", owner: "Lead", blocked_by: [], write_scopes: ["docs/"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "work: implement it", description: "write it", kind: "work", owner: "Senior Engineer", blocked_by: ["requirement: the guard"], write_scopes: ["packages/mpd-team-core-plugin/src/**"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review: verify it", description: "judge it", kind: "review", owner: "Reviewer", blocked_by: ["work: implement it"] } })
    /** The approved team. */
    const teamId = await approveStaged(h)
    /** The board, read from disk. */
    const board = readTeam(h.workspace, teamId)?.tasks ?? []
    expect(board.map((task) => task.kind)).toEqual(["requirement", "work", "review"])
    expect(board.map((task) => task.blockedBy)).toEqual([[], ["T1"], ["T2"]])
    // The middle task is the only ready row, which is the whole point of declaring the chain.
    expect(board[0].status).toBe("pending")
  })
})
