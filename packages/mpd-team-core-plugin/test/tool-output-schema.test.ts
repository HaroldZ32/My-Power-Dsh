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
  exec: { agent: { session: { id: string } } }
  /** Call one tool and assert that its value satisfies its own declared contract. */
  call: (name: string, args: unknown) => Promise<any>
}

/** Build the harness: the real plugin applied against a stub adapter and a stub executor. */
function fixture(): Fixture {
  /** The sandbox workspace, which is what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-output-"))
  /** The tools the plugin registered. */
  const tools = new Map<string, CapturedTool>()
  /** A disposer-returning no-op for every seam this file never exercises. */
  const noop = (): (() => void) => () => {}
  /** The stub executor: it raises members and admits messages, and nothing else. */
  const executor = {
    kind: "native" as const,
    reason: "stub",
    providers: () => ["mpd-roster"],
    spawn: async (_caller: unknown, request: { name: string }) => ({ handle: `child-${request.name}` }),
    send: async () => {},
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
      if (prop === "teamListMembers") return () => []
      if (prop === "teamListTasks") return () => []
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  /** The minimal cordis context `apply` needs. */
  const ctx = { get: (id: string) => (id === "mpdDsh" ? dsh : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: noop, inject: noop }
  apply(ctx as never)
  /** The payload a tool call carries; the workspace resolves from the agent's session header. */
  const exec = { agent: { session: { id: "sess-1", header: { cwd: workspace } } } }
  return {
    workspace,
    tools,
    exec,
    call: async (name: string, args: unknown) => {
      /** The tool being called. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      /** The tool body's value, which the two checks below judge. */
      const value = await tool.execute(args, exec)
      // EVERY call in this file is checked against the tool's OWN declaration, so a new branch that
      // returns a shape the schema does not allow fails here instead of in a live session.
      /** The lossless-first result, exactly as the harness reports it. */
      const lossless = losslessViolations(value)
      expect(lossless).toEqual([])
      /** The schema result, which the harness only reaches once the value is lossless. */
      const violations = schemaViolations(tool.output.schema, value)
      expect(violations).toEqual([])
      return value
    },
  }
}

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
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "T", description: "d", owner: "Reviewer" } })
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
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own it" } })
      await f.call("agent_teams_plan", { action: "edit", description: "restated" })
      await f.call("agent_teams_plan", { action: "approve", dry_run: true })
      await f.call("agent_teams_plan", { action: "approve" })
      await f.call("agent_teams_plan", { action: "status" })
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
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "review", description: "judge it", owner: "Reviewer" } })
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
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "first", description: "d", owner: "Reviewer" } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "second", description: "d", owner: "Reviewer" } })
      await f.call("agent_teams_plan", { action: "approve" })
      /** The board, whose FIRST task is left in progress by a dispatch pass below. */
      const record = readTeam(f.workspace, listTeams(f.workspace)[0].teamId)
      expect(record?.tasks.map((task) => task.owner)).toEqual(["Reviewer", "Reviewer"])
      // Now make the member genuinely busy (its first wave's task is in progress) and stage a THIRD
      // task with the same owner: a busy member is not a reason to drop the owner the caller stated.
      await f.call("agent_teams_plan", { action: "create", name: "wave-2", description: "next" })
      await f.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "third", description: "d", owner: "Reviewer" } })
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
      await f.call("agent_teams_plan", { action: "create_task", task: { subject: "unowned", description: "d" } })
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
      await f.call("agent_teams_plan", { action: "create_task", owner: "TuiAdapter Engineer", task: { subject: "W2-T1 Lane A", description: "the adapter" } })
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
