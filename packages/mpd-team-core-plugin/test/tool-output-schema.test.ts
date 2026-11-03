// THE TOOL OUTPUT CONTRACT, checked the way the HARNESS checks it.
//
// WHY IT EXISTS (measured 2026-10-02 on a live session, defects 1, 4 and 5):
//   * `agent_teams_plan action:"status"` answered `"value.plan" must be an object; "value.hold" must
//     be an object` — the status branch returns `null` for a session with no plan and no hold, while
//     the declared schema said `object`;
//   * the same call WITH a team record answered `value is not lossless JSON` — `summariseTeam`'s
//     `depths` is a `Map`, and the harness snapshots a tool body's value with its lossless-JSON rule
//     BEFORE it validates the declared schema;
//   * `create_task` calls that carried `owner` (and one that carried `blocked_by`) BESIDE `task`
//     created board tasks with no owner and no blockers, because only the nested spelling was read.
//
// So this file does BOTH halves for EVERY action: it re-validates the returned value against the
// tool's OWN declared schema, using a local mirror of the harness's two rules (`snapshotToolValue`
// / `isJsonValue` in `@deepseek-ai/dsh-util-values`, and `validateJsonSchemaValue` in
// `@deepseek-ai/dsh-tools`, both read at 0.2.0-rc.2 — the version the live session ran), and it
// asserts the data the branch was supposed to carry really reached the staged plan and the board.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { listTeams, readTeam } from "../src/team-store"

/** One value JSON can carry without loss. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Every path at which a value is NOT lossless JSON, in walk order — the harness's own rule set. */
function losslessViolations(value: unknown, path: string = "value", seen: ReadonlySet<object> = new Set<object>()): string[] {
  if (value === null) return []
  switch (typeof value) {
    case "boolean":
    case "string":
      return []
    case "number":
      if (!Number.isFinite(value)) return [`${path}: non-finite number`]
      return Object.is(value, -0) ? [`${path}: negative zero`] : []
    case "object":
      break
    default:
      return [`${path}: ${typeof value} has no JSON spelling`]
  }
  // A non-null object: an ARRAY is checked first, because its own prototype (`Array.prototype`) is
  // the intrinsic array prototype the harness accepts — only a subclass or a forged one is refused.
  const node = value as object
  if (seen.has(node)) return [`${path}: cycle`]
  /** The ancestor set for this node's children, so a cycle is reported instead of recursing. */
  const next = new Set(seen)
  next.add(node)
  if (Array.isArray(node)) {
    /** Violations for the array shell itself: only the indices and `length` may be own keys. */
    const shell: string[] = []
    if (Reflect.ownKeys(node).length !== node.length + 1) shell.push(`${path}: own key beyond the indices`)
    for (let index = 0; index < node.length; index += 1) shell.push(...losslessViolations(node[index], `${path}[${index}]`, next))
    return shell
  }
  /** The object's own prototype, which a JSON write would not carry. */
  const prototype = Object.getPrototypeOf(node)
  if (prototype !== null && prototype !== Object.prototype) return [`${path}: foreign prototype`]
  /** Own keys; a symbol key or a non-enumerable own key is exactly what a JSON write discards. */
  const keys = Reflect.ownKeys(node)
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(node, key))) {
    return [`${path}: symbol or non-enumerable own key`]
  }
  /** Violations for every own string key. */
  const out: string[] = []
  for (const key of keys) out.push(...losslessViolations((node as Record<string, unknown>)[key as string], `${path}.${String(key)}`, next))
  return out
}

/** The schemas the harness's enforced subset accepts, as the tool declarations spell them. */
type Schema = { type?: string; oneOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; enum?: unknown[]; const?: unknown }

/**
 * Validate one value against a declared schema, mirroring the harness's subset walk.
 * @param schema - the declared schema node.
 * @param value - the candidate value.
 * @param path - the diagnostic path of this node.
 * @returns every violation; empty means the harness would accept the value.
 */
function schemaViolations(schema: Schema, value: unknown, path: string = "value"): string[] {
  if (Array.isArray(schema.oneOf)) {
    // EXACT-one: a value matching two branches is a schema author error the harness reports, not a pass.
    /** How many branches accept this value. */
    let matches = 0
    for (const branch of schema.oneOf) if (schemaViolations(branch, value, path).length === 0) matches += 1
    if (matches === 1) return []
    return [`"${path}" matched ${matches} of ${schema.oneOf.length} oneOf branches (exactly one must match)`]
  }
  if (schema.type === undefined) return losslessViolations(value, path)
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`"${path}" must be an object`]
      /** The present declared children plus the tail check. */
      const out: string[] = []
      /** The declared property schemas, keyed as the schema spells them. */
      const properties = schema.properties ?? {}
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) out.push(`missing required property "${path}.${key}"`)
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key)) continue
        out.push(...schemaViolations(child, (value as Record<string, unknown>)[key], `${path}.${key}`))
      }
      if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) out.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
      return out
    }
    case "array": {
      if (!Array.isArray(value)) return [`"${path}" must be an array`]
      if (schema.items === undefined) return []
      /** Violations for every entry. */
      const out: string[] = []
      for (const [index, entry] of value.entries()) out.push(...schemaViolations(schema.items, entry, `${path}[${index}]`))
      return out
    }
    case "string":
      return typeof value === "string" ? [] : [`"${path}" must be a string`]
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? [] : [`"${path}" must be a number`]
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? [] : [`"${path}" must be an integer`]
    case "boolean":
      return typeof value === "boolean" ? [] : [`"${path}" must be a boolean`]
    case "null":
      return value === null ? [] : [`"${path}" must be null`]
    default:
      return [`"${path}": unsupported schema type "${schema.type}"`]
  }
}

/** One registered tool as this file drives it. */
interface CapturedTool {
  /** The tool name. */
  name: string
  /** The declared output contract, schema included. */
  output: { schema: Schema }
  /** The tool body. */
  execute: (args: unknown, exec: unknown) => unknown
}

/** The harness one arm drives. */
interface Fixture {
  /** The sandbox workspace. */
  workspace: string
  /** The registered tools, by name. */
  tools: Map<string, CapturedTool>
  /** The exec payload every call carries. */
  exec: { agent: { session: { id: string; header: { cwd: string } } } }
  /** The services the plugin PUBLISHED, by service id (the `mpdTeamActions` plane lives here). */
  provided: Map<string, unknown>
  /** One entry per delivered dispatch message: `<handle>:<content>`. */
  sent: string[]
  /** Call one tool and assert that its value satisfies its own declared contract. */
  call: (name: string, args: unknown) => Promise<any>
  /**
   * Call one tool AS A GIVEN AGENT, with the same two conformance checks.
   *
   * Needed because the new verbs are SEAT-SCOPED: `handoff` is a member's duty and the Lead gate refuses
   * a member's `reassign`/`mode:"roster"`, so an arm that could only ever be the Lead would prove neither.
   */
  callAs: (name: string, args: unknown, agent: unknown) => Promise<Record<string, any>>
}

/**
 * Build the harness: the real plugin applied against a stub adapter and a stub executor.
 * @param roles - the roster rows the `mpdRoles` service publishes (the C7-2 source); empty by default.
 * @returns the fixture.
 */
function fixture(roles: Array<{ name: string; readonly?: boolean }> = []): Fixture {
  /** The sandbox workspace, which is what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-output-"))
  /** The tools the plugin registered. */
  const tools = new Map<string, CapturedTool>()
  /** A disposer-returning no-op for every seam this file never exercises. */
  const noop = (): (() => void) => () => {}
  /** One entry per delivered message: `<handle>:<content>`. */
  const sent: string[] = []
  /** The stub executor: it raises members and admits messages, and nothing else. */
  const executor = {
    kind: "native" as const,
    reason: "stub",
    providers: () => ["mpd-roster"],
    spawn: async (_caller: unknown, request: { name: string }) => ({ handle: `child-${request.name}` }),
    send: async (_caller: unknown, handle: string, content: string) => { sent.push(`${handle}:${content}`) },
    interrupt: async () => {},
    membership: () => undefined,
    members: () => [],
  }
  /** The stub adapter over the executor. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: CapturedTool) => { tools.set(definition.name, definition); return () => {} }
      if (prop === "registerCommand") return () => () => {}
      if (prop === "workspaceRoot") return () => workspace
      if (prop === "teamExecutor") return () => executor
      // THE METER SEAM answers the adapter's OWN empty reading, which is what it returns for a session it
      // cannot resolve: a null window keeps the context verb's reply lossless JSON (no `undefined`).
      if (prop === "contextPressure") return () => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" })
      if (prop === "teamListMembers") return () => []
      if (prop === "teamListTasks") return () => []
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  /** The minimal cordis context `apply` needs. */
  /** The services the plugin PUBLISHED, by id — the service plane is one of this file's subjects. */
  const provided = new Map<string, unknown>()
  /** The exec payload every call carries; also the live agent the service plane resolves by session id. */
  const exec = { agent: { session: { id: "sess-1", header: { cwd: workspace } } } }
  /** The agent registry, which is what `mpdTeamActions` needs to resolve a SESSION into a caller. */
  const agents = { get: (id: string): unknown => (id === "sess-1" ? exec.agent : undefined), list: (): unknown[] => [exec.agent] }
  /** The minimal cordis context `apply` needs: the adapter lookup, the two service seams, and `provide`. */
  const ctx = { get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdRoles" ? { list: () => roles } : id === "agents" ? agents : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: (id: string, value: unknown) => { provided.set(id, value) }, inject: noop }
  apply(ctx as never)
  /**
   * Call one tool AS one agent, with the same two conformance checks `call` applies.
   * @param name - the tool name.
   * @param args - its arguments.
   * @param agent - the agent handle the call carries.
   * @returns the tool body's value.
   */
  const callAs = async (name: string, args: unknown, agent: unknown): Promise<Record<string, any>> => {
      /** The tool being called. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      /** The tool body's value, which the two checks below judge. */
      const value = await tool.execute(args, agent) as Record<string, any>
      // EVERY call in this file is checked against the tool's OWN declaration, so a new branch that
      // returns a shape the schema does not allow fails here instead of in a live session.
      /** The lossless-first result, exactly as the harness reports it. */
      const lossless = losslessViolations(value)
      expect(lossless).toEqual([])
      /** The schema result, which the harness only reaches once the value is lossless. */
      const violations = schemaViolations(tool.output.schema, value)
      expect(violations).toEqual([])
      return value
  }
  return {
    workspace,
    tools,
    exec,
    provided,
    sent,
    call: (name: string, args: unknown) => callAs(name, args, exec),
    callAs,
  }
}

describe("an EMPTY plan cannot be approved (D4a)", () => {
  test("approve REFUSES a plan with 0 members and 0 tasks, and mints NO team record", async () => {
    // THE MECHANICALLY-STAGED SHELL (D5): a session gate can stage `approval:"required"` with nothing
    // in it, and approving one used to mint a team record with an empty roster and an empty board — a
    // name in `.mpd/team/teams/`, a row in every panel, and no work behind it. The refusal must also
    // leave the WORKSPACE untouched: a refusal that still wrote half a record would be worse than none.
    /** The harness under test. */
    const f = fixture()
    try {
      await f.call("agent_teams_plan", { action: "create", name: "shell", description: "a mechanically staged plan", approval: "required" })
      expect(listTeams(f.workspace)).toEqual([])
      /** The refusal, captured by value so the arm can read its message. */
      let refusal: Error | undefined
      try {
        await f.call("agent_teams_plan", { action: "approve" })
      } catch (error) {
        refusal = error as Error
      }
      expect(refusal).toBeDefined()
      // The message must tell the caller WHAT to do, not merely that it may not: naming the two calls
      // that fill the plan is what makes the shell actionable in the panel AND in a session.
      expect(refusal?.message).toContain("EMPTY")
      expect(refusal?.message).toContain("add_member")
      expect(refusal?.message).toContain("create_task")
      // …AND the trailing clause (R13, Amendment 2) names the dependency answer the very next
      // `create_task` demands, so obeying this sentence stages a working call instead of a second refusal.
      expect(refusal?.message).toContain("blocked_by: [...]")
      expect(refusal?.message).toContain("possibly []")
      expect(refusal?.message).toContain("independent: true")
      // NOTHING was created, and the plan is still staged: the captain can fill it and approve again.
      expect(listTeams(f.workspace)).toEqual([])
      /** The still-staged plan, read back through the tool. */
      const status = await f.call("agent_teams_plan", { action: "status" })
      expect((status.plan as { approvedAt?: string } | null)?.approvedAt).toBeUndefined()
      // FILLING IT MAKES THE SAME PLAN APPROVABLE — the guard is a gate, not a dead end.
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
      /** The approved plan, whose value the `f.call` checks validate against the declaration. */
      const approved = await f.call("agent_teams_plan", { action: "approve" })
      expect((approved.created as { members: unknown[] }).members.length).toBe(1)
      expect(listTeams(f.workspace).length).toBe(1)
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("a plan with EITHER a member or a task still approves — the guard refuses nothing else", async () => {
    // THE OTHER DIRECTION, so the new refusal cannot over-reach: a task-only plan (a captain posting
    // the board first) is a legitimate plan, and so is a member-only one.
    // THE CONTROL'S INTENT IS UNCHANGED (R5/R8, `.mpd/plans/task-dependency-guard.md`): one task with
    // no members must still approve. The ONLY adaptation is the dependency answer the new contract
    // requires — `blocked_by: []` declares the task a genuine root, so the plan is still a single,
    // unordered, scope-free task and nothing about the "refuses nothing else" claim is weakened.
    /** The harness under test, for the task-only plan. */
    const taskOnly = fixture()
    try {
      await taskOnly.call("agent_teams_plan", { action: "create", name: "tasks only", description: "board first" })
      await taskOnly.call("agent_teams_plan", { action: "create_task", task: { subject: "solo", description: "one task", blocked_by: [] } })
      /** The approved plan. */
      const approved = await taskOnly.call("agent_teams_plan", { action: "approve" })
      expect((approved.created as { tasks: unknown[] }).tasks.length).toBe(1)
      expect(listTeams(taskOnly.workspace).length).toBe(1)
    } finally {
      rmSync(taskOnly.workspace, { recursive: true, force: true })
    }
    /** The harness under test, for the member-only plan. */
    const memberOnly = fixture()
    try {
      await memberOnly.call("agent_teams_plan", { action: "create", name: "members only", description: "roster first" })
      await memberOnly.call("agent_teams_plan", { action: "add_member", member: { name: "Explorer", description: "finds", prompt: "You find things." } })
      /** The approved plan. */
      const approved = await memberOnly.call("agent_teams_plan", { action: "approve" })
      expect((approved.created as { members: unknown[] }).members.length).toBe(1)
      expect(listTeams(memberOnly.workspace).length).toBe(1)
    } finally {
      rmSync(memberOnly.workspace, { recursive: true, force: true })
    }
  })
})

describe("every action's value satisfies its declared output contract", () => {
  test("status answers null plan/hold, the record and a LOSSLESS summary — and the harness accepts it", async () => {
    /** The harness under test. */
    const f = fixture()
    try {
      // The measured failing case 1 (seq 154): nothing staged, nothing held, no team.
      /** The empty status payload. */
      const empty = await f.call("agent_teams_plan", { action: "status" })
      expect(empty.plan).toBeNull()
      expect(empty.hold).toBeNull()
      expect(empty.team).toBeNull()
      expect(empty.summary).toBeNull()
      // Stage, approve and re-read: the measured failing case 2 (seq 213) — the summary's `depths`.
      await f.call("agent_teams_plan", { action: "create", name: "wave", description: "why" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "T", description: "d", owner: "Reviewer", blocked_by: [] } })
      await f.call("agent_teams_plan", { action: "approve" })
      /** The status payload with a real team record behind it. */
      const full = await f.call("agent_teams_plan", { action: "status" })
      expect(full.summary).not.toBeNull()
      expect(full.summary.total).toBe(1)
      // THE FIX ITSELF: `depths` is a plain record, not the store's Map.
      expect(full.summary.depths).toEqual({ T1: 0 })
      expect(full.summary.depths instanceof Map).toBe(false)
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("EVERY plan action answers a value its own schema accepts", async () => {
    /** The harness under test. */
    const f = fixture()
    try {
      // One arm per action; `call` itself asserts the declared contract on every return value.
      await f.call("agent_teams_plan", { action: "status" })
      await f.call("agent_teams_plan", { action: "create", name: "wave", description: "why" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own it", blocked_by: [] } })
      await f.call("agent_teams_plan", { action: "edit", description: "restated" })
      await f.call("agent_teams_plan", { action: "approve", dry_run: true })
      await f.call("agent_teams_plan", { action: "approve" })
      await f.call("agent_teams_plan", { action: "status" })
      // THE PERMIT/WAIT BRANCHES (T3, contract §7), driven while the team is still LIVE: a grant answers
      // the granted record, and a wait whose target is not on the board refuses with a sentence — both
      // values are checked against this tool's own declaration by `call` above.
      /** The lead's grant to the plan's member, read for the id the wait names. */
      const granted = await f.call("agent_teams_mail", { action: "permit", holder: "Senior Engineer", scope: "answer", ttlMs: 1_000 })
      await f.call("agent_teams_mail", { action: "wait", permitId: granted.permit.permitId, messageId: "mail-does-not-exist", timeoutMs: 0 })
      await f.call("agent_teams_plan", { action: "delete" })
      await f.call("agent_teams_plan", { action: "delete" })
      // The other four tools answer the same discipline.
      await f.call("agent_teams_task", { action: "contract" })
      await f.call("agent_teams_task", { action: "release", task_id: "T1" })
      await f.call("agent_teams_dispatch", { action: "release", task_id: "T1" })
      await f.call("agent_teams_dispatch", { action: "run", dry_run: true })
      await f.call("agent_teams_mail", { action: "summary" })
      await f.call("agent_teams_control", { action: "resume" })
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })
})

describe("create_task carries owner and blocked_by from BOTH spellings", () => {
  test("owner nested under `task` and the member IDLE: the owner reaches the plan AND the board", async () => {
    /** The harness under test. */
    const f = fixture()
    try {
      await f.call("agent_teams_plan", { action: "create", name: "wave", description: "why" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "review", description: "judge it", owner: "Reviewer", blocked_by: [] } })
      /** The staged plan, which must carry the owner at once. */
      const stagedPlan = await f.call("agent_teams_plan", { action: "edit" })
      expect(stagedPlan.plan.tasks[0].owner).toBe("Reviewer")
      await f.call("agent_teams_plan", { action: "approve" })
      /** The board, read from the record the approval wrote. */
      const record = readTeam(f.workspace, listTeams(f.workspace)[0].teamId)
      expect(record?.tasks[0].owner).toBe("Reviewer")
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("owner given while the member is already BUSY: the owner still lands, and is not reassigned", async () => {
    // "Busy" is the dispatch engine's own notion: the member already holds an in-progress task. A
    // create_task for the same member must still record the owner the caller asked for — a planner
    // that queues a member's NEXT task is the normal case, not a refusal.
    /** The harness under test. */
    const f = fixture()
    try {
      await f.call("agent_teams_plan", { action: "create", name: "wave", description: "why" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "first", description: "d", owner: "Reviewer", blocked_by: [] } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "second", description: "d", owner: "Reviewer", blocked_by: [] } })
      await f.call("agent_teams_plan", { action: "approve" })
      /** The board, whose FIRST task is left in progress by a dispatch pass below. */
      const record = readTeam(f.workspace, listTeams(f.workspace)[0].teamId)
      expect(record?.tasks.map((task) => task.owner)).toEqual(["Reviewer", "Reviewer"])
      // Now make the member genuinely busy (its first wave's task is in progress) and stage a THIRD
      // task with the same owner: a busy member is not a reason to drop the owner the caller stated.
      await f.call("agent_teams_plan", { action: "create", name: "wave-2", description: "next" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "third", description: "d", owner: "Reviewer", blocked_by: [] } })
      await f.call("agent_teams_plan", { action: "approve" })
      /** The SECOND board, which must carry the owner too. */
      const second = readTeam(f.workspace, listTeams(f.workspace)[0].teamId)
      expect(second?.tasks.map((task) => task.owner)).toEqual(["Reviewer"])
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("no owner given: the task is created WITHOUT an owner key (never a null owner)", async () => {
    /** The harness under test. */
    const f = fixture()
    try {
      await f.call("agent_teams_plan", { action: "create", name: "wave", description: "why" })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "unowned", description: "d", blocked_by: [] } })
      /** The staged plan's own task row. */
      const stagedPlan = await f.call("agent_teams_plan", { action: "edit" })
      expect(Object.hasOwn(stagedPlan.plan.tasks[0], "owner")).toBe(false)
      await f.call("agent_teams_plan", { action: "approve" })
      /** The board row, which must not invent an owner either. */
      const record = readTeam(f.workspace, listTeams(f.workspace)[0].teamId)
      expect(Object.hasOwn(record?.tasks[0] ?? {}, "owner")).toBe(false)
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("the MEASURED spelling — owner and blocked_by BESIDE `task` — reaches the plan and the board", async () => {
    // This is the defect exactly as it was measured: 9 of 10 live create_task calls put `owner` (and
    // one put `blocked_by`) beside `task`, and the board came back `owner: null, blockedBy: []`.
    /** The harness under test. */
    const f = fixture()
    try {
      await f.call("agent_teams_plan", { action: "create", name: "wave", description: "why" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "TuiAdapter Engineer", description: "Lane A", prompt: "You build." } })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "PanelScene Worker", description: "Lane C", prompt: "You merge." } })
      await f.call("agent_teams_plan", { action: "create_task", owner: "TuiAdapter Engineer", task: { subject: "W2-T1 Lane A", description: "the adapter", blocked_by: [] } })
      await f.call("agent_teams_plan", { action: "create_task", owner: "PanelScene Worker", blocked_by: ["W2-T1 Lane A"], task: { subject: "W2-T3 Lane C", description: "the scene" } })
      /** The staged plan, whose second task must name the first as its blocker. */
      const stagedPlan = await f.call("agent_teams_plan", { action: "edit" })
      expect(stagedPlan.plan.tasks.map((task: { owner?: string }) => task.owner)).toEqual(["TuiAdapter Engineer", "PanelScene Worker"])
      expect(stagedPlan.plan.tasks[1].blockedBy).toEqual(["W2-T1 Lane A"])
      await f.call("agent_teams_plan", { action: "approve" })
      /** The board, where the blocker must be RESOLVED to the first task's own id. */
      const record = readTeam(f.workspace, listTeams(f.workspace)[0].teamId)
      expect(record?.tasks.map((task) => task.owner)).toEqual(["TuiAdapter Engineer", "PanelScene Worker"])
      expect(record?.tasks[1].blockedBy).toEqual(["T1"])
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })
})

// ── R-W1A coverage: the FOUR new verbs and the two boundary refusals, THROUGH THE TOOLS ──
//
// WHY HERE. The toolchain arms call the action bodies directly, so they prove the engine and never the
// BOUNDARY: the declared parameters, the schema each reply must satisfy, and the refusals that happen
// before anything is written. This file's own claim is that every tool answers a value its own schema
// accepts, and until now none of `context` / `handoff` / `fence` / `unfence` was driven at all.
describe("the new boundary verbs (R-W1A)", () => {
  /**
   * Stage and approve a one-member board, and answer the two handles the arms act as.
   * @param f - the fixture to drive.
   * @param member - the teammate name to stage (its session id is `child-<name>`).
   * @param writeScopes - the task's write scopes (empty for a non-code task).
   * @returns the Lead handle, the member handle and the team record.
   */
  async function approvedWave(f: Fixture, member: string, writeScopes: string[] = []): Promise<{ lead: unknown; seat: unknown; teamId: string }> {
    await f.call("agent_teams_plan", { action: "create", name: "the wave", description: "repair coverage" })
    await f.call("agent_teams_plan", { action: "add_member", member: { name: member, description: "a seat", prompt: "You work." } })
    await f.call("agent_teams_plan", { action: "create_task", task: { subject: "the task", description: "acceptance", blocked_by: [], owner: member, ...(writeScopes.length === 0 ? {} : { write_scopes: writeScopes }) } })
    await f.call("agent_teams_plan", { action: "approve" })
    /** The one team this wave minted. */
    const teamId = listTeams(f.workspace)[0].teamId
    return {
      lead: f.exec.agent,
      // AN EXEC, not a bare agent: a tool handler's second argument is the dispatch payload, whose
      // `agent` member is the live handle — passing the handle alone makes `where(exec)` resolve no
      // session, which is the difference between "this member's team" and "no team at all".
      seat: { agent: { session: { id: "child-" + member, header: { cwd: f.workspace } } } },
      teamId,
    }
  }

  test("`context` answers the caller's own occupancy in its declared shape", async () => {
    /** A one-member wave. */
    const f = fixture()
    try {
      await approvedWave(f, "Explorer")
      // THE LEAD IS NOT ON THE ROSTER, so this is the seat-less branch: the numbers stay null and no
      // member identity is claimed — a shape the schema must accept all the same.
      /** The Lead's own reading. */
      const lead = await f.call("agent_teams_task", { action: "context" })
      expect(lead.usedTokens).toBeNull()
      expect(lead.windowTokens).toBeNull()
      expect(lead.ratio).toBeNull()
      expect(typeof lead.provenance).toBe("string")
      expect(lead.member).toBeUndefined()
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("`handoff` answers the document's path and ordinal, and puts the seat in the checkpoint window", async () => {
    /** A one-member wave. */
    const f = fixture()
    try {
      /** The wave's two handles. */
      const wave = await approvedWave(f, "Explorer")
      /** A complete seven-section document. */
      const document = ["## Task", "the task", "## State", "half", "## Decisions", "one call", "## Artifacts", "packages/x", "## Verified facts", "suite green", "## Open questions", "none", "## Next step", "close it"].join("\n")
      // THE MEMBER'S OWN CALL: the roster matches by `executorRef`, which the approval reported.
      /** The handoff's answer. */
      const handoff = await f.callAs("agent_teams_task", { action: "handoff", content: document }, wave.seat)
      expect(handoff.ordinal).toBe(1)
      expect(typeof handoff.path).toBe("string")
      expect(String(handoff.directive)).toContain("END YOUR TURN")
      // THE RECORD carries the seat state, so a later pass refuses to message it.
      expect(readTeam(f.workspace, wave.teamId)?.members[0]).toMatchObject({ mode: "checkpoint", handoff: { ordinal: 1 } })
      // A SECOND handoff advances the ordinal; it never overwrites the first document.
      /** The second handoff. */
      const again = await f.callAs("agent_teams_task", { action: "handoff", content: document }, wave.seat)
      expect(again.ordinal).toBe(2)
      expect(again.path).not.toBe(handoff.path)
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("`fence` and `unfence` answer the seat's state, and the record keeps ONE spelling of not-fenced", async () => {
    /** A one-member wave. */
    const f = fixture()
    try {
      /** The wave's team. */
      const wave = await approvedWave(f, "Explorer")
      /** The fence. */
      const fenced = await f.call("agent_teams_control", { action: "fence", member: "Explorer", reason: "barrier gave up" })
      expect(fenced).toMatchObject({ teamId: wave.teamId, member: "Explorer", fenced: true, reason: "barrier gave up" })
      expect(readTeam(f.workspace, wave.teamId)?.members[0]?.fenced).toBe(true)
      /** The unfence, which deletes both keys. */
      const cleared = await f.call("agent_teams_control", { action: "unfence", member: "Explorer" })
      expect(cleared.fenced).toBe(false)
      /** The seat after the fence was lifted. */
      const seat = readTeam(f.workspace, wave.teamId)?.members[0]
      expect(seat?.fenced).toBeUndefined()
      expect(seat?.fencedReason).toBeUndefined()
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("a malformed `reassign` entry and an unknown `mode` are REFUSED before anything is written", async () => {
    /** A one-member wave. */
    const f = fixture()
    try {
      /** The wave's team. */
      const wave = await approvedWave(f, "Explorer")
      /** The malformed entry's refusal. */
      let malformed: Error | undefined
      try {
        await f.call("agent_teams_dispatch", { action: "run", reassign: [{ task_id: "T1" }] })
      } catch (error) {
        malformed = error as Error
      }
      expect(malformed?.message).toContain("every `reassign` entry needs a non-empty `task_id` and `owner`")
      /** The unknown mode's refusal. */
      let unknownMode: Error | undefined
      try {
        await f.call("agent_teams_dispatch", { action: "run", mode: "solo" })
      } catch (error) {
        unknownMode = error as Error
      }
      expect(unknownMode?.message).toContain('unknown mode "solo"')
      // BOTH refusals are BEFORE any store write: the row is untouched and still pending.
      expect(readTeam(f.workspace, wave.teamId)?.tasks[0]?.status).toBe("pending")
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("`reassign` and `mode:\"roster\"` are LEAD-ONLY, while a plain pass stays open to a member", async () => {
    /** A one-member wave. */
    const f = fixture()
    try {
      /** The wave's two handles. */
      const wave = await approvedWave(f, "Explorer")
      // THE MEMBER may not re-own a row, nor force the substitution rule.
      /** The member's reassign attempt. */
      let reassignRefusal: Error | undefined
      try {
        await f.callAs("agent_teams_dispatch", { action: "run", reassign: [{ task_id: "T1", owner: "Explorer" }] }, wave.seat)
      } catch (error) {
        reassignRefusal = error as Error
      }
      expect(reassignRefusal?.message).toContain("only the Lead")
      /** The member's roster-mode attempt. */
      let rosterRefusal: Error | undefined
      try {
        await f.callAs("agent_teams_dispatch", { action: "run", mode: "roster" }, wave.seat)
      } catch (error) {
        rosterRefusal = error as Error
      }
      expect(rosterRefusal?.message).toContain("only the Lead")
      // A PLAIN PASS is NOT gated: the member may ask the engine for one, and the engine's own rules decide.
      /** The member's plain pass. */
      const plain = await f.callAs("agent_teams_dispatch", { action: "run", dry_run: true }, wave.seat)
      expect(plain.halted).toBeUndefined()
      // AND IT REALLY RAN: the member's pass decided the pairing (T1's declared owner is idle), which is the
      // behaviour the gate must NOT take away from a plain run.
      expect(plain.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T1"])
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("a WRITE task reassigned to a READ-ONLY seat is refused by the C7-2 guard, and the board does not move", async () => {
    // THE REVIEWER'S PROBE, now through the tool: the pairing pass refuses this pair, so the repair must too.
    /** A wave whose roster marks Explorer read-only and whose task carries write scopes. */
    const f = fixture([{ name: "Explorer", readonly: true }])
    try {
      /** The wave's team. */
      const wave = await approvedWave(f, "Explorer", ["packages/x"])
      /** The hand-over the guard refuses. */
      const pass = await f.call("agent_teams_dispatch", { action: "run", reassign: [{ task_id: "T1", owner: "Explorer" }] })
      expect(pass.reassigned).toHaveLength(1)
      expect(pass.reassigned[0]).toMatchObject({ taskId: "T1", owner: "Explorer", claimed: false, delivered: false })
      // THE SAME SENTENCE the pairing path answers with, verbatim.
      expect(String(pass.reassigned[0].reason)).toContain("refused a WRITE-TASK-ON-READ-ONLY pairing")
      expect(String(pass.reassigned[0].reason)).toContain("read-only specialist")
      // NOTHING MOVED: the row is still pending and still owned by the member the plan declared.
      expect(readTeam(f.workspace, wave.teamId)?.tasks[0]?.status).toBe("pending")
      expect(readTeam(f.workspace, wave.teamId)?.tasks[0]?.owner).toBe("Explorer")
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })
})

// ── W2 gaps: the SERVICE validator, the cancelled row, and the description in the message ──
//
// WHY THESE ARMS LIVE HERE. Each subject is a BOUNDARY fact: what a service caller is refused, what the
// dispatcher does with a row the caller abandoned, and what the member actually receives. The tool arms
// above prove the TOOL path; these drive the published `mpdTeamActions` service, which is the surface a
// row (cellwork next) calls.
describe("the dispatch seam (W2)", () => {
  /**
   * The `mpdTeamActions` service this fixture published.
   * @param f - the fixture.
   * @returns the service, narrowed to the three members these arms use.
   */
  function actions(f: Fixture): {
    dispatch: (input: Record<string, unknown>) => Promise<Record<string, any>>
    cancelTasks: (input: Record<string, unknown>) => Promise<Record<string, any>>
  } {
    return f.provided.get("mpdTeamActions") as {
      dispatch: (input: Record<string, unknown>) => Promise<Record<string, any>>
      cancelTasks: (input: Record<string, unknown>) => Promise<Record<string, any>>
    }
  }

  /**
   * Stage and approve a TWO-task wave: a root task and one blocked by it, both owned by the same member.
   * @param f - the fixture to drive.
   * @param description - the ROOT task's description, which the delivery arm reads back.
   * @returns the team id.
   */
  async function blockedWave(f: Fixture, description: string): Promise<string> {
    await f.call("agent_teams_plan", { action: "create", name: "the wave", description: "W2 gaps" })
    await f.call("agent_teams_plan", { action: "add_member", member: { name: "Explorer", description: "a seat", prompt: "You work." } })
    await f.call("agent_teams_plan", { action: "create_task", task: { subject: "root", description, blocked_by: [], owner: "Explorer" } })
    await f.call("agent_teams_plan", { action: "create_task", task: { subject: "follow-up", description: "runs after the root", blocked_by: ["root"], owner: "Explorer" } })
    await f.call("agent_teams_plan", { action: "approve" })
    return listTeams(f.workspace)[0].teamId
  }

  test("GAP 1: the SERVICE refuses a malformed `reassign` with the SAME sentence the TOOL throws", async () => {
    /** A composition with a live session and a team. */
    const f = fixture()
    try {
      await blockedWave(f, "the root work")
      // THE SERVICE PATH, which used to accept anything: the validation now runs in the shared action.
      /** The service's refusal for a pair with no owner. */
      const viaService = await actions(f).dispatch({ sessionId: "sess-1", reassign: [{ task_id: "T1" }] })
      expect(viaService.ok).toBe(false)
      expect(String(viaService.error)).toContain("every `reassign` entry needs a non-empty `task_id` and `owner`")
      // AN UNKNOWN MODE is refused by the same one validator.
      /** The service's refusal for an unknown pairing rule. */
      const badMode = await actions(f).dispatch({ sessionId: "sess-1", mode: "solo" })
      expect(badMode.ok).toBe(false)
      expect(String(badMode.error)).toContain('unknown mode "solo"')
      // THE TOOL ANSWERS THE SAME STRING — that equality is the whole point of the move.
      /** The tool's thrown refusal for the same malformed pair. */
      let viaTool: Error | undefined
      try {
        await f.call("agent_teams_dispatch", { action: "run", reassign: [{ task_id: "T1" }] })
      } catch (error) {
        viaTool = error as Error
      }
      expect(viaTool?.message).toBe(String(viaService.error))
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("GAP 2: a cancelled row leaves the ready set, is REPORTED as `cancelled`, and releases its dependent", async () => {
    /** A composition with a blocked pair. */
    const f = fixture()
    try {
      /** The wave's team id. */
      const teamId = await blockedWave(f, "the root work")
      // THE TRANSITION a caller uses to abandon work (cellwork's activation is the first caller).
      /** The cancellation of the root row. */
      const cancelled = await actions(f).cancelTasks({ workspace: f.workspace, teamId, taskIds: ["T1"], note: "the accepted split no longer carries it" })
      expect(cancelled).toEqual({ ok: true, teamId, cancelled: ["T1"], skipped: [] })
      // THE ROW STAYS ON THE BOARD, terminal, with the note a reader needs.
      /** The board after the cancellation. */
      const board = readTeam(f.workspace, teamId)?.tasks ?? []
      expect(board[0]).toMatchObject({ status: "cancelled", note: "the accepted split no longer carries it" })
      // THE PASS SKIPS IT WITH THE CONTRACT'S ONE WORD, and the dependent it blocked is now READY.
      /** The dispatch pass after the cancellation. */
      const pass = await f.call("agent_teams_dispatch", { action: "run", dry_run: true })
      expect(pass.skipped).toEqual([{ taskId: "T1", subject: "root", reason: "cancelled" }])
      expect(pass.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T2"])
      // A SECOND cancellation reports BOTH an already-terminal row and an unknown id, cancelling neither.
      /** The refused second pass. */
      const again = await actions(f).cancelTasks({ workspace: f.workspace, teamId, taskIds: ["T1", "T9"] })
      expect(again.cancelled).toEqual([])
      expect(again.skipped.map((row: { taskId: string }) => row.taskId)).toEqual(["T1", "T9"])
      expect(String(again.skipped[0].reason)).toContain("already cancelled")
      expect(String(again.skipped[1].reason)).toContain("no board row is named")
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })

  test("GAP 3: the dispatched message carries the task's DESCRIPTION verbatim", async () => {
    // A CALLER PUTS A POINTER THERE (cellwork's frozen-contract path is the first), so the description must
    // reach the member byte for byte — not as a truncated subject line.
    /** The pointer the delivery must carry. */
    const pointer = "FROZEN CONTRACT: .mpd/cellwork/cell-w2/contracts/core.md"
    /** A composition with one owned, ready row. */
    const f = fixture()
    try {
      await blockedWave(f, pointer)
      // A REAL pass (not a preview): only delivery can prove what the member received.
      await f.call("agent_teams_dispatch", { action: "run", limit: 1 })
      expect(f.sent).toHaveLength(1)
      expect(f.sent[0]).toContain(pointer)
      // …and the subject is still there, so the message still identifies the row it is about.
      expect(f.sent[0]).toContain("shared task T1: root")
    } finally {
      rmSync(f.workspace, { recursive: true, force: true })
    }
  })
})
