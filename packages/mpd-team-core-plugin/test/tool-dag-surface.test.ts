// THE DAG ON THE TOOL SURFACE — contract `.mpd/plans/team-tool-dag-surface.md`.
//
// THE THREE MEASURED DEFECTS this file pins:
//   1. `agent_teams_plan {action:"status"}` returned every task record but PRINTED one summary line, so a
//      flat board and a well-wired one looked identical to the operator staging the wave. `edit`'s read
//      form printed only counts. Every arm below therefore reads the tool's OWN renderer, which is the
//      text a caller actually sees.
//   2. No tool could add an edge to an EXISTING row: `create_task` mints a new row and approval writes
//      `blockedBy` once, so a lane added mid-run could not enter the DAG at all. `depend` is the
//      append-only verb, and its arms read the result back from DISK — the echo alone is not evidence.
//   3. A reference naming no task persisted verbatim with no report. It is still KEPT (the text is the
//      only record of what the caller meant), but the row now carries `unresolvedBlockers` and the
//      `depend` answer names it.
//
// And CONTRACT AMENDMENT 2: the LIVE `create_task` arm dropped a `kind` sent beside `task` (the spelling
// the `owner`/`blocked_by` aliases invite) and stored `work`, so review rows were indistinguishable from
// production rows. One arm creates a row per kind through BOTH spellings and reads the stored values.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { activeTeamId, readTeam, readyTasks, TASK_KINDS, teamRecordPath, type TeamTaskRecord } from "../src/team-store"

/** The sandbox workspaces this file created, removed after each arm so a red run leaves nothing. */
const sandboxes: string[] = []

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The session id the plan is staged and approved from — the captain in every arm. */
const LEAD = "lead-session"

/** One captured tool registration, with both halves an arm drives: the executor and the renderer. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  /** The tool's own renderer, which produces the text a caller reads. */
  output?: { render?: (args: unknown, value: unknown) => Array<{ text?: string }> }
}

/** The harness one arm drives: the sandbox, the registered tools and the stub executor. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /**
   * Drive one registered tool by name.
   * @param name - the registered tool name.
   * @param args - the tool arguments.
   * @param sessionId - the calling session; the Lead unless an arm wants a member's view.
   * @returns the tool's own result, or its thrown refusal.
   */
  call: (name: string, args: unknown, sessionId?: string) => Promise<unknown>
  /**
   * Paint one tool's value through its OWN declared renderer.
   * @param name - the registered tool name.
   * @param value - the value the tool returned.
   * @returns the text parts joined, which is what a caller reads.
   */
  render: (name: string, value: unknown) => string
}

/**
 * Build the harness: the real plugin applied against a stub composition.
 *
 * The executor is a stub that mints one predictable handle per member NAME, which the record keeps as
 * that member's `executorRef` — and that handle IS the member session's own id in these arms.
 * @returns the harness an arm drives.
 */
function harness(): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-tool-dag-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The stub backend: it raises any member and mints a handle derived from the member's name. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    /** The backends this stub claims to provide. */
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
    /** Deliver nothing; these arms never dispatch. */
    send: async (): Promise<void> => {},
    /** Interrupt nobody. */
    interrupt: async (): Promise<void> => {},
    /** The backend tracks no live identity — the same blindness as a dsh-tui boot. */
    membership: (): undefined => undefined,
    /** The backend tracks no members; the record is the roster. */
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
    provide: (id: string, value: unknown): void => { void id; void value },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    /**
     * Drive one registered tool by name as a given session.
     * @param name - the registered tool name.
     * @param args - the tool arguments.
     * @param sessionId - the calling session; the Lead unless an arm wants a member's view.
     * @returns the tool's own result, or its thrown refusal.
     */
    call: async (name: string, args: unknown, sessionId: string = LEAD): Promise<unknown> => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId, header: {} } }, signal: undefined })
    },
    /**
     * Paint one tool's value through its OWN declared renderer.
     * @param name - the registered tool name.
     * @param value - the value the tool returned.
     * @returns the text parts joined, which is what a caller reads.
     */
    render: (name: string, value: unknown): string => {
      /** The registered tool whose renderer is being driven. */
      const tool = tools.get(name)
      return (tool?.output?.render?.({}, value) ?? []).map((part) => part.text ?? "").join("")
    },
  }
}

/**
 * One task as the record ON DISK holds it — the only reading an arm may call the board.
 * @param workspace - the workspace holding the record.
 * @param teamId - the team to read.
 * @param taskId - the task to find.
 * @returns the stored row, or undefined when it is not there.
 */
function taskOnDisk(workspace: string, teamId: string, taskId: string): TeamTaskRecord | undefined {
  return readTeam(workspace, teamId)?.tasks.find((candidate) => candidate.id === taskId)
}

/**
 * Approve a three-task, two-member team through the REAL plan tool.
 *
 * The board is FLAT unless `chain` asks otherwise: three rows and no edges is exactly the shape the
 * defect left behind, so every `depend` arm starts from the state it must change.
 * @param h - the harness to approve in.
 * @param chain - true to wire T2 behind T1 at staging time, which the visible-DAG arm needs.
 * @returns the approved team's id.
 */
async function approveBoard(h: Harness, chain: boolean = false): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own the record", owner: "Senior Engineer" } })
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "judge it", owner: "Reviewer", kind: "review", ...(chain ? { blocked_by: ["core"] } : {}) } })
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "integration", description: "land it", owner: "Senior Engineer" } })
  await h.call("agent_teams_plan", { action: "approve" })
  /** The team the approval bound to the Lead session. */
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
  return teamId
}

describe("the plan surface RENDERS the DAG", () => {
  test("status prints one line per task (id/owner/status/kind/blockedBy/subject) and one per member", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team, wired as a chain so two rows differ in their edges. */
    const teamId = await approveBoard(h, true)
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual(["T1"])
    /** The text the tool paints for a status call. */
    const painted = h.render("agent_teams_plan", await h.call("agent_teams_plan", { action: "status" }))
    /** The painted lines, so the surviving summary is checked as a line of its own. */
    const lines = painted.split("\n")
    expect(lines[0]).toContain("plan ")
    expect(lines[0]).toContain("members 2")
    expect(lines[0]).toContain("tasks 3")
    expect(lines[0]).toContain("hold none")
    // ONE LINE PER MEMBER, carrying id, name and status.
    expect(painted).toContain("member id=M1 name=Senior Engineer status=running")
    expect(painted).toContain("member id=M2 name=Reviewer status=running")
    // TWO ROWS WITH DIFFERENT EDGES: T1 carries none, T2 depends on T1 — flat and wired now differ.
    expect(painted).toContain('task id=T1 owner=Senior Engineer status=pending kind=work blockedBy=- subject="core"')
    expect(painted).toContain('task id=T2 owner=Reviewer status=pending kind=review blockedBy=T1 subject="review the core"')
  })

  test("plan edit's READ form prints staged tasks with subject/owner/blockedBy and `-` for the id", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "staged", description: "d" })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d" } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "d", blocked_by: ["core"], owner: "Reviewer" } })
    /** The text the tool paints for the read form. */
    const painted = h.render("agent_teams_plan", await h.call("agent_teams_plan", { action: "edit" }))
    // NO ID IS INVENTED: staged rows get theirs at approval, so the column is `-` twice.
    expect(painted.match(/id=-/g)?.length).toBe(2)
    expect(painted).not.toMatch(/id=T\d/)
    expect(painted).toContain("1 member(s), 2 task(s)")
    expect(painted).toContain('subject="core"')
    expect(painted).toContain('subject="review the core"')
    expect(painted).toContain("owner=Reviewer")
    expect(painted).toContain("owner=-")
    expect(painted).toContain("blockedBy=core")
    expect(painted).toContain("blockedBy=-")
  })
})

describe("agent_teams_task depend — append-only edges", () => {
  test("appends an edge to a live row, persists it, and echoes the updated row", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    /** The tool's answer to the append. */
    const answer = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T1"] })) as { task?: TeamTaskRecord; added?: string[]; idempotent?: boolean; unresolved?: string[] }
    expect(answer.added).toEqual(["T1"])
    expect(answer.idempotent).toBe(false)
    expect(answer.unresolved).toEqual([])
    // THE ECHO CARRIES THE ROW, including both halves the contract names.
    expect(answer.task?.blockedBy).toEqual(["T1"])
    expect(answer.task?.unresolvedBlockers).toBeUndefined()
    // READ BACK FROM DISK: the echo is not the evidence, the record is.
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual(["T1"])
    // …and the painted answer names the edge set the row now holds.
    /** The painted success answer. */
    const painted = h.render("agent_teams_task", answer)
    expect(painted).toContain("T2 blockedBy=[T1]")
    expect(painted).toContain("appended 1 edge(s)")
  })

  test("a reference written as a SUBJECT resolves to that task's id", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    /** The tool's answer to a subject-form append. */
    const answer = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["core"] })) as { task?: TeamTaskRecord; added?: string[] }
    // THE STORE'S OWN RULE: an id, a subject or nothing — the same resolution `create_task` uses.
    expect(answer.added).toEqual(["T1"])
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual(["T1"])
  })

  test("a later append KEEPS the first edge, and a repeat is a REPORTED no-op", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T1"] })
    /** The second append: a NEW edge beside the existing one. */
    const second = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T3"] })) as { task?: TeamTaskRecord; added?: string[] }
    expect(second.added).toEqual(["T3"])
    // APPEND-ONLY: the first edge is still there.
    expect(second.task?.blockedBy).toEqual(["T1", "T3"])
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual(["T1", "T3"])
    /** The row's revision before the repeat, read from disk. */
    const before = taskOnDisk(h.workspace, teamId, "T2")?.revision
    /** The idempotent repeat. */
    const repeat = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T1"] })) as { task?: TeamTaskRecord; added?: string[]; idempotent?: boolean }
    expect(repeat.idempotent).toBe(true)
    expect(repeat.added).toEqual([])
    expect(repeat.task?.blockedBy).toEqual(["T1", "T3"])
    // A NO-OP IS A NO-OP: the repeat must not rewrite the record or bump its revision.
    expect(taskOnDisk(h.workspace, teamId, "T2")?.revision).toBe(before)
  })

  test("an UNRESOLVABLE reference is kept verbatim, PERSISTED, and named in the answer", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    /** The tool's answer to a reference that names nothing. */
    const answer = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["no such task"] })) as { task?: TeamTaskRecord; added?: string[]; unresolved?: string[] }
    expect(answer.added).toEqual(["no such task"])
    expect(answer.unresolved).toEqual(["no such task"])
    // PERSISTED, not merely echoed: the next reader sees the text AND the report beside it.
    /** The row as the record on disk holds it. */
    const row = taskOnDisk(h.workspace, teamId, "T2")
    expect(row?.blockedBy).toEqual(["no such task"])
    expect(row?.unresolvedBlockers).toEqual(["no such task"])
    // …and the painted answer says it out loud instead of reading like a real edge.
    /** The painted answer. */
    const painted = h.render("agent_teams_task", answer)
    expect(painted).toContain("no task on this board")
    expect(painted).toContain("no such task")
  })

  test("a TERMINAL row refuses new edges, and nothing is written", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    await h.call("agent_teams_task", { action: "complete", task_id: "T1" })
    /** The refusal a closed row answers with. */
    const answer = (await h.call("agent_teams_task", { action: "depend", task_id: "T1", blocked_by: ["T2"] })) as { refused?: string }
    expect(answer.refused).toContain("completed")
    expect(answer.refused).toContain("frozen")
    expect(taskOnDisk(h.workspace, teamId, "T1")?.blockedBy).toEqual([])
  })

  test("an UNKNOWN task id is refused by name", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await approveBoard(h)
    /** The refusal an id that is not on the board answers with. */
    const answer = (await h.call("agent_teams_task", { action: "depend", task_id: "T99", blocked_by: ["T1"] })) as { refused?: string }
    expect(answer.refused).toContain("T99")
  })

  test("the OWNER wires its own row; a member that owns neither it nor the lead is refused", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team; T2 is owned by the Reviewer. */
    const teamId = await approveBoard(h)
    // THE OWNER MAY WIRE ITS OWN ROW: the Reviewer resolves by its recorded handle.
    /** The owner's own append. */
    const owned = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T1"] }, "child-Reviewer")) as { task?: TeamTaskRecord }
    expect(owned.task?.blockedBy).toEqual(["T1"])
    // …AND A NON-OWNER MAY NOT: T2 is owned by the Reviewer, and the Senior Engineer does not lead.
    /** The refusal a different member gets. */
    const refused = (await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T3"] }, "child-Senior-Engineer")) as { refused?: string }
    expect(refused.refused).toContain('owned by "Reviewer"')
    expect(taskOnDisk(h.workspace, teamId, "T2")?.blockedBy).toEqual(["T1"])
  })

  test("readiness follows the new edge: the row becomes ready only when its blocker settles", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    await h.call("agent_teams_task", { action: "depend", task_id: "T2", blocked_by: ["T1"] })
    /** The record as it stands while T1 is still pending. */
    const blockedRecord = readTeam(h.workspace, teamId)
    if (blockedRecord === undefined) throw new Error("the team record vanished")
    // T2 has a PENDING blocker, so it is not ready; T1 and the untouched T3 are.
    expect(readyTasks(blockedRecord).map((task) => task.id)).toEqual(["T1", "T3"])
    await h.call("agent_teams_task", { action: "complete", task_id: "T1" })
    /** The record as it stands after the blocker settled. */
    const settledRecord = readTeam(h.workspace, teamId)
    if (settledRecord === undefined) throw new Error("the team record vanished")
    expect(readyTasks(settledRecord).map((task) => task.id)).toEqual(["T2", "T3"])
  })
})

describe("contract amendment 2 — the LIVE create_task carries `kind`", () => {
  test("the STAGED arm stores every allowed kind, so the live arm has a parity reference", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "kinds", description: "d" })
    for (const kind of TASK_KINDS) await h.call("agent_teams_plan", { action: "create_task", task: { subject: `staged ${kind}`, description: "d", kind } })
    await h.call("agent_teams_plan", { action: "approve" })
    /** The team the approval bound to the Lead session. */
    const teamId = activeTeamId(h.workspace, LEAD)
    if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
    // THE STAGED ARM IS THE REFERENCE the live arm must match, one row per accepted kind.
    /** The stored kinds, in board order. */
    const stored = (readTeam(h.workspace, teamId)?.tasks ?? []).map((task) => task.kind)
    expect(stored).toEqual([...TASK_KINDS])
  })

  test("every allowed kind survives the LIVE append, nested and beside `task`", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    for (const kind of TASK_KINDS) {
      // The documented spelling: inside `task`.
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: `nested ${kind}`, description: "d", kind } })
      // The spelling a live call used: beside `task`, where the `owner`/`blocked_by` aliases live.
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: `alias ${kind}`, description: "d" }, kind })
    }
    /** The stored kinds of the appended rows, in board order — read from DISK. */
    const stored = (readTeam(h.workspace, teamId)?.tasks ?? []).slice(3).map((task) => task.kind)
    expect(stored).toEqual(TASK_KINDS.flatMap((kind) => [kind, kind]))
  })

  test("an UNKNOWN kind is refused loudly on the LIVE arm, never coerced to `work`", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveBoard(h)
    /** How many rows the board held before the refused calls. */
    const before = readTeam(h.workspace, teamId)?.tasks.length
    /** The record's bytes BEFORE the refused calls — a refusal must leave them untouched. */
    const bytesBefore = readFileSync(teamRecordPath(h.workspace, teamId), "utf8")
    /** The failure a nested unknown kind raises. */
    const nested = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "bad", description: "d", kind: "nonsense" } }).then(() => undefined, (error: unknown) => error as Error)
    expect(nested?.message).toContain("unknown task kind")
    /** The failure a top-level unknown kind raises. */
    const alias = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "bad", description: "d" }, kind: "nonsense" }).then(() => undefined, (error: unknown) => error as Error)
    expect(alias?.message).toContain("unknown task kind")
    // NOTHING LANDED: a refusal is not a coerced row, and the record is byte-unchanged.
    expect(readTeam(h.workspace, teamId)?.tasks.length).toBe(before)
    expect(readFileSync(teamRecordPath(h.workspace, teamId), "utf8")).toBe(bytesBefore)
    // NOTHING LANDED: a refusal is not a coerced row.
    expect(readTeam(h.workspace, teamId)?.tasks.length).toBe(before)
  })
})
