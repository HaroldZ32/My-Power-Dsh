// THE SEPARATION ITSELF is what this file pins: that approving a staged plan creates an mpd-owned
// TEAM RECORD with ids of our own, that the executor is told about the team rather than defining
// it, and that the record — not the official readout — is what the mpd service answers with.
//
// The distinction matters because it is invisible when both halves agree. Every arm below therefore
// makes the two halves DISAGREE (the executor reports handles the record must keep but never adopt,
// and the readout is deliberately left stale) so a regression to "read the official plane" reddens
// instead of passing quietly.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { listTeams, readTeam, taskDepths, teamRoot, updateTeamTask, writeTeam } from "../src/team-store"
import type { DispatchLedger } from "../src/dispatch"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One recorded call the plugin made to the executor, so an arm can assert on the PAYLOAD. */
interface ExecutorCall {
  /** The adapter method that was called. */
  method: string
  /** The arguments it was called with, minus the caller. */
  args: Record<string, unknown>
}

/** The harness one arm drives: the sandbox, the registered tools, the executor log and the service. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /** Every executor call, in order. */
  calls: ExecutorCall[]
  /** The `mpdTeams` service the plugin published, or undefined when it published none. */
  service: MpdTeamsService | undefined
  /** Every `(teamId, workspace)` the dispatch gate asked the watchdog about, in order (T1). */
  holdQueries: Array<{ teamId: string; workspace: string | undefined }>
  /** The tool exec payload a call carries (the workspace resolves from it). */
  exec: { agent: { session: { id: string } }; signal: undefined }
  /** Drive one registered tool by name. */
  call: (name: string, args: unknown) => Promise<unknown>
}

/** What the stub executor should answer, so an arm can make it fail on demand. */
interface StubOptions {
  /** The watchdog's verdict for any team id, when an arm needs a hold in force. */
  watchdogHolds?: boolean
  /** Whether the watchdog service answers a `held` that is not a boolean, i.e. an unreadable hold. */
  watchdogUnreadable?: boolean
  /** The member whose spawn throws, by name, when an arm needs a half-built team. */
  failMember?: string
  /**
   * Run a mutation on the REAL store WHILE a dispatch pass is awaiting its `send` — the only way to
   * reproduce a claim that lands mid-pass (T2). It receives the sandbox workspace.
   */
  duringSend?: (workspace: string) => void
}

/**
 * Build the harness: a real plugin applied against a stub executor.
 * @param options - how the stub executor should behave.
 * @returns the harness an arm drives.
 */
function harness(options: StubOptions = {}): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-record-"))
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** Every call the harness double observed, in order. */
  const calls: ExecutorCall[] = []
  /** The service the plugin published. */
  let service: MpdTeamsService | undefined
  /** Every query the dispatch gate sent the watchdog, so the ARGUMENTS are pinned and not just the verdict. */
  const holdQueries: Array<{ teamId: string; workspace: string | undefined }> = []
  // THE NATIVE BACKEND (W2). The double sits at the HARNESS boundary — `ctx.subagents` — and the
  // REAL adapter is built over it, so these arms exercise the executor implementation rather than a
  // stub of it. `spawnTeammate` is deliberately ABSENT: an approval that still reached for the
  // official service would fail here instead of passing quietly.
  /** The `ctx.subagents` double: the three seams the native executor uses. */
  const subagents = {
    providers: () => ["spawn", "mpd-roster"],
    /** Record the raise and answer with a handle derived from the member name. */
    startContinuable(this: unknown, spec: any): Promise<unknown> {
      calls.push({ method: "startContinuable", args: spec })
      /** The member name the executor put on the label, which is how a failure is aimed. */
      const label = String(spec?.label ?? "")
      if (options.failMember !== undefined && label.startsWith(options.failMember)) {
        throw new Error("the executor refused " + options.failMember)
      }
      // The handle is derived from the member name so an arm can predict it, exactly as the
      // official double's ids used to be.
      return Promise.resolve({ childId: "child-" + label.split(" \u00b7 ")[0].replace(/\s+/g, "-"), messageId: "m1" })
    },
    /** Record the delivery and answer with an inbox id. */
    sendMessage(this: unknown, sender: unknown, targetId: unknown, content: unknown, opts: unknown): Promise<unknown> {
      calls.push({ method: "sendMessage", args: { sender, targetId, content, opts } })
      // The concurrent mutation lands HERE: the pass is suspended at this await, which is exactly
      // the window a member's own `agent_teams_task claim` writes into (T2).
      options.duringSend?.(workspace)
      return Promise.resolve("m2")
    },
    /** Record the interrupt. */
    interrupt(this: unknown, targetId: unknown, authority: unknown): void {
      calls.push({ method: "interrupt", args: { targetId, authority } })
    },
  }
  /** The stub watchdog service, when this arm staged one. */
  const watchdog = options.watchdogHolds === undefined && options.watchdogUnreadable !== true
    ? undefined
    : {
        // THE REAL CONTRACT (defect 3): `isHeld` answers a HoldView OBJECT, never a boolean — the
        // object is truthy even when `held` is false, which is exactly why a gate that read it for
        // truthiness refused every pass with a hold the watchdog's own store did not have. The
        // double models the object so the gate's own reading is what the arm tests.
        //
        // THE DOUBLE IS KEYED BY ID AND BY WORKSPACE (T1), exactly as the real store is: a hold
        // exists for the team the WORKSPACE's record carries, so the query is answered against
        // `listTeams(workspace)`. An id-space drift — the shipped defect, where the watchdog filed
        // the hold under the Lead Session id while the gate asked about `team-<stamp>` — therefore
        // answers `held: false` HERE and the "held" arm reddens, instead of an argument-blind stub
        // saying yes to whatever id it was handed.
        isHeld: (teamId: string, workspaceArg?: string) => {
          holdQueries.push({ teamId, workspace: workspaceArg })
          /** Whether a hold exists for THIS id in THIS workspace, as the real registry would answer. */
          const held = options.watchdogHolds === true && listTeams(workspaceArg ?? "").some((record) => record.teamId === teamId)
          return {
            held: options.watchdogUnreadable === true ? "yes" : held,
            holdId: held ? "hold-1" : null,
            at: held ? 1_790_953_153_225 : null,
            reason: held ? "silence" : null,
            taskId: null,
            attemptId: null,
            workspace,
            source: "file",
          }
        },
        holds: () => (options.watchdogHolds === true ? ["held"] : []),
      }
  /** The stub adapter: the plugin's own seams, plus the REAL executor over the harness double. */
  const dsh = {
    registerTool: (definition: Tool) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: () => () => {},
    workspaceRoot: () => workspace,
    text: (value: string) => value,
    // NO `agentTeams` is mounted anywhere in this harness: `ctx.get("agentTeams")` answers
    // undefined, so the executor's choice must land on the native default. An arm asserting the
    // old official behaviour would fail here rather than pass against a half-migrated path.
    teamExecutor: () => createDshAdapter({ get: (name: string) => (name === "subagents" ? subagents : undefined) } as never).teamExecutor(),
    teamListMembers: () => [],
    teamListTasks: () => [],
    capabilities: () => ({}),
  }
  /** The minimal cordis context `apply` needs; `provide` captures the service it publishes. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdWatchdog" ? watchdog : id === "subagents" ? subagents : undefined),
    on: () => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: () => {},
  }
  apply(ctx as never)
  /** The exec payload every tool call carries; the session id is what binds the record. */
  const exec = { agent: { session: { id: "sess-1" } }, signal: undefined }
  return {
    workspace, tools, calls, exec, holdQueries,
    /** The `mpdTeams` service the plugin published; read through a getter because `apply` runs after this literal is built. */
    get service(): MpdTeamsService | undefined { return service },
    call: async (name: string, args: unknown) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, exec)
    },
  }
}

/** Stage a two-member, two-task plan through the real tools, ready for an approval arm. */
async function staged(h: Harness): Promise<void> {
  await h.call("agent_teams_plan", { action: "create", name: "wave-3", description: "split the plane" })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" } })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review.", role: "Reviewer" } })
  // The second task is blocked by the first task's SUBJECT, which is how a captain writes it.
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own the record", write_scopes: ["packages/**"], owner: "Senior Engineer" } })
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "judge it", blocked_by: ["core"], owner: "Reviewer" } })
}

/**
 * The dispatch ledger as this workspace has it ON DISK.
 *
 * Read straight from the documented sidecar path (`<workspace>/.mpd/team/dispatch.json`, named in the
 * src header) instead of through a helper the fix could move, so the arm asserts the exact file two
 * writers — a concurrent release and the pass's final write — actually agreed on.
 * @param workspace - the sandbox workspace whose ledger is read.
 * @returns the parsed ledger, or an empty one when the file is absent or unreadable.
 */
function ledgerOnDisk(workspace: string): DispatchLedger {
  try {
    /** The parsed ledger, accepted only when it is a plain object — the rule `readLedger` applies. */
    const raw = JSON.parse(readFileSync(join(workspace, ".mpd", "team", "dispatch.json"), "utf8")) as DispatchLedger
    return raw !== null && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

/** Every sandbox one arm created, removed even when the arm fails. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe("approval builds an mpd-owned team record", () => {
  test("the record carries OUR ids, the review fields, and the resolved dependency edges", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    expect(listTeams(h.workspace)).toEqual([])
    await h.call("agent_teams_plan", { action: "approve" })
    /** The team the workspace now holds. */
    const teams = listTeams(h.workspace)
    expect(teams.length).toBe(1)
    /** The record itself. */
    const record = teams[0]
    // Ids are OURS and short, because the graph draws them and a tool takes them.
    expect(record.members.map((member) => member.id)).toEqual(["M1", "M2"])
    expect(record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
    // The blocker was written as the SUBJECT "core" and resolves to our own T1.
    expect(record.tasks[1].blockedBy).toEqual(["T1"])
    // The plan's `write_scopes` survived into the record, where the graph and the gate read it.
    expect(record.tasks[0].writeScopes).toEqual(["packages/**"])
    expect(record.tasks[0].owner).toBe("Senior Engineer")
    expect(record.approvedAt).toBeDefined()
    expect(record.phase).toBe("active")
  })

  test("the executor's handles are KEPT BESIDE our ids, never adopted as them", async () => {
    /** The harness under test, whose double mints handles that look nothing like ours. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The approved record. */
    const record = listTeams(h.workspace)[0]
    // Our ids are unchanged by whatever the backend answered...
    expect(record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
    expect(record.members.map((member) => member.id)).toEqual(["M1", "M2"])
    // ...while the backend's handle is recorded for the calls that must name it.
    expect(record.members.map((member) => member.executorRef)).toEqual(["child-Senior-Engineer", "child-Reviewer"])
    expect(record.members.every((member) => member.status === "running")).toBe(true)
  })

  test("NO BOARD IS MIRRORED: the mpd record IS the board, so a task keeps our id and only our id", async () => {
    // THE SEPARATION, ASSERTED NEGATIVELY. W1 still posted every task to the official board and
    // recorded the board's id beside ours, which left TWO sources of truth for one team and made
    // the official plugin a hard dependency of `approve`. The record now carries the dependency
    // edges, the review fields and the ownership itself, so nothing is posted anywhere.
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The approved record. */
    const record = listTeams(h.workspace)[0]
    // The tasks carry NO backend handle, because no backend was asked to mint one.
    expect(record.tasks.every((task) => task.executorRef === undefined)).toBe(true)
    // The dependency edge, the ownership and the scopes are all mpd's own, and they are what a
    // dispatch pass reads — `readyTasks` and `idleMembers` resolve them against this board.
    expect(record.tasks[1].blockedBy).toEqual(["T1"])
    expect(record.tasks[0].owner).toBe("Senior Engineer")
    expect(record.tasks[0].writeScopes).toEqual(["packages/**"])
    // Not one call reached the official service: `spawnTeammate` is not even on the double, so a
    // regression to the old path would throw here rather than pass.
    expect(h.calls.map((call) => call.method)).toEqual(["startContinuable", "startContinuable"])
  })

  test("the member's ROUTE reaches the executor as an ordinary argument", async () => {
    // This is the whole reason the native default exists: the official tool row forwards only
    // `{ prompt, parent }`, so a per-member model route had to arrive through ROW CONFIG
    // (`freshProvider`) and a member's identity had to be encoded in its DESCRIPTION. Here the
    // route is a spawn argument, which is what lets a roster slot, a persona and the read-only
    // deny list apply to a teammate directly.
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The two spawn specs the double recorded, in order. */
    const specs = h.calls.filter((call) => call.method === "startContinuable").map((call) => call.args as any)
    expect(specs.length).toBe(2)
    // The provider and the label are the executor's own; the parent is the calling Lead.
    expect(specs[0].provider).toBe("spawn")
    expect(specs[0].label).toBe("Senior Engineer · " + listTeams(h.workspace)[0].teamId)
    expect(specs[0].request.parent).toEqual({ session: { id: "sess-1" } })
    // The prompt travels as content blocks, which is what the continuation manager takes.
    expect(specs[0].request.prompt[0].text).toBe("You implement.")
  })

  test("a spawn that fails STOPS the approval but still leaves the team on record", async () => {
    /** The harness whose second member cannot be spawned. */
    const h = harness({ failMember: "Reviewer" })
    sandboxes.push(h.workspace)
    await staged(h)
    /** The approval result, which must report where it stopped. */
    const result = (await h.call("agent_teams_plan", { action: "approve" })) as { stoppedAt?: string }
    expect(result.stoppedAt).toContain("Reviewer")
    /** The record written despite the failure. */
    const record = listTeams(h.workspace)[0]
    // The member that failed says so; the one that spawned keeps its handle.
    expect(record.members.map((member) => member.status)).toEqual(["running", "failed"])
    // No board task was created, because a half-built roster must not be handed work.
    expect(h.calls.some((call) => call.method === "createTask")).toBe(false)
    expect(record.tasks.every((task) => task.executorRef === undefined)).toBe(true)
  })

  test("an approval with a dry run records NOTHING", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve", dry_run: true })
    expect(listTeams(h.workspace)).toEqual([])
    expect(h.calls.length).toBe(0)
  })

  test("a plan written in its own POSITIONS resolves to real board ids — the measured one-column defect", async () => {
    // THE DEFECT (R21, 2026-10-06): a captain wrote `blocked_by: ["2"]`, `["2","3"]`, … meaning the
    // plan's own task positions. Every reference was accepted, none resolved, and the whole DAG
    // flattened to one rank with no edge and no warning anywhere. The approval now resolves the plan's
    // own namespace: a bare number is the 1-BASED position of a staged task, and both directions work
    // (position 2 blocks 3; a forward reference from 2 to 3 is allowed because the whole plan is on the
    // board before any reference is resolved).
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await h.call("agent_teams_plan", { action: "create", name: "positions", description: "d" })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "first", description: "d" } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "second", description: "d", blocked_by: ["1"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "third", description: "d", blocked_by: ["2"] } })
    await h.call("agent_teams_plan", { action: "approve" })
    /** The approved record's board. */
    const board = listTeams(h.workspace)[0].tasks
    expect(board.map((task) => task.id)).toEqual(["T1", "T2", "T3"])
    expect(board[1].blockedBy).toEqual(["T1"])
    expect(board[2].blockedBy).toEqual(["T2"])
    // EVERY reference resolved, so nothing is reported: the picture is a real chain, not a flat board.
    expect(board.every((task) => task.unresolvedBlockers === undefined)).toBe(true)
    // …and the ranks the graph draws follow the edges, which is the whole point: 0, 1, 2.
    expect(board.map((task) => taskDepths(board).get(task.id))).toEqual([0, 1, 2])
  })

  test("create_task ANSWERS with what its references will resolve to, at the moment they are written", async () => {
    // WHERE THE CAPTAIN MEETS IT FIRST (R21). The defect was accepted in silence at write time and only
    // showed up three layers downstream as a flat graph; the branch now answers with one `{reference,
    // form}` entry per reference, and the rendered line says out loud which of them names nothing.
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await h.call("agent_teams_plan", { action: "create", name: "reading", description: "d" })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d" } })
    /** What the second task's call answered. */
    const answer = (await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review", description: "d", blocked_by: ["core", "1", "T2", "the review task"] } })) as { blockers?: Array<{ reference: string; form: string }> }
    expect(answer.blockers).toEqual([
      { reference: "core", form: "subject" },
      { reference: "1", form: "position" },
      { reference: "T2", form: "board-id" },
      { reference: "the review task", form: "unknown" },
    ])
    /** The tool's own renderer (declared under `output`), which is the text a captain actually reads. */
    const render = (h.tools.get("agent_teams_plan") as unknown as { output?: { render?: (args: unknown, value: unknown) => Array<{ text?: string }> } }).output?.render
    /** The sentence it paints for this answer. */
    const painted = (render?.({}, answer) ?? []).map((part) => part.text ?? "").join("")
    expect(painted).toContain("the review task")
    expect(painted).toContain("no task this plan can resolve")
    // A task with NO blockers keeps the answer quiet: the reading is a report, not a banner.
    /** What a blocker-free task answers. */
    const plain = (await h.call("agent_teams_plan", { action: "create_task", task: { subject: "plain", description: "d" } })) as { blockers?: unknown }
    expect(plain.blockers).toBeUndefined()
  })

  test("a reference that names NOTHING is reported at approval, on the task AND in the plan", async () => {
    // The other half: some references CANNOT be resolved (free text that matches no subject, or a
    // number past the plan's own length). Those must not vanish — the board task keeps the text beside
    // the report, the approval ANSWER carries it (so the captain sees it in the same turn), and the
    // archived plan keeps it for whoever reads the plan afterwards.
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The staged plan's id, which names its archive directory. */
    const staged = (await h.call("agent_teams_plan", { action: "create", name: "dangling", description: "d" })) as { plan: { planId: string } }
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "only", description: "d", blocked_by: ["the review task"] } })
    /** What the approval answered. */
    const approved = (await h.call("agent_teams_plan", { action: "approve" })) as { created?: { unresolved?: Array<{ taskId: string; references: string[] }> } }
    /** The board the approval built. */
    const board = listTeams(h.workspace)[0].tasks
    expect(board[0].blockedBy).toEqual(["the review task"])
    expect(board[0].unresolvedBlockers).toEqual(["the review task"])
    // The answer names the task and the exact text, so a captain cannot miss it…
    expect(approved.created?.unresolved).toEqual([{ taskId: "T1", references: ["the review task"] }])
    // …and the ARCHIVED plan carries the same reading, for whoever reads it afterwards.
    /** The archived copy of the approved plan. */
    const archived = JSON.parse(readFileSync(join(h.workspace, ".mpd", "team", "archive", staged.plan.planId, "plan.json"), "utf8")) as { created?: { unresolved?: unknown } }
    expect(archived.created?.unresolved).toEqual([{ taskId: "T1", references: ["the review task"] }])
  })
})

describe("the published service is the read surface", () => {
  test("mpdTeams answers from the record, and reads nothing from the official plane", async () => {
    /** The harness under test, whose official readout is deliberately EMPTY. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The published service; a missing one is the failure this arm exists to catch. */
    const service = h.service
    expect(service).toBeDefined()
    if (service === undefined) return
    /** The team the service binds to this session. */
    const active = service.active(h.workspace, "sess-1")
    expect(active?.name).toBe("wave-3")
    // The roster comes from the RECORD: `teamListMembers` answers [] above, so a service that read
    // the official plane would report no members at all.
    expect(active?.members.map((member) => member.name)).toEqual(["Senior Engineer", "Reviewer"])
    expect(service.memberNames(h.workspace)).toEqual(["Senior Engineer", "Reviewer"])
    expect(service.teamIds(h.workspace)).toEqual([active?.teamId ?? ""])
    // The derived reads agree with the store's own maths.
    expect(service.visual(active as never, "T2")).toBe("blocked")
    expect(service.summary(active as never).links).toBe(1)
    expect(service.progress(active as never, "Senior Engineer")).toEqual({ done: 0, total: 1, current: "T1" })
    // A workspace with no team answers empty rather than throwing.
    expect(service.list("/nonexistent-workspace")).toEqual([])
    expect(service.active("/nonexistent-workspace", "sess-1")).toBeUndefined()
  })

  test("status reports the RECORD as the team, with the official readout beside it", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The status payload. */
    const status = (await h.call("agent_teams_plan", { action: "status" })) as { team: { tasks: unknown[] } | null; members: unknown[]; summary: { total: number } | null }
    expect(status.team).not.toBeNull()
    expect(status.summary?.total).toBe(2)
    // Members and tasks are the RECORD's rows, not the executor's empty readout.
    expect(status.members.length).toBe(2)
  })

  test("the record survives a lost index: the Lead session still finds its team", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The record before the index is destroyed. */
    const before = listTeams(h.workspace)[0]
    // Delete the index the way a copied workspace would lose it, and re-read through the SERVICE.
    rmSync(join(teamRoot(h.workspace), "teams.json"), { force: true })
    expect(readTeam(h.workspace, before.teamId)).toBeDefined()
    expect(h.service?.active(h.workspace, "sess-1")?.teamId).toBe(before.teamId)
    // A DIFFERENT session in the same workspace is not given someone else's team.
    expect(h.service?.active(h.workspace, "sess-other")).toBeUndefined()
  })
})

describe("the watchdog hold stops a dispatch pass", () => {
  test("a team the watchdog holds is NOT dispatched, and the refusal names the team", async () => {
    // THE DEFECT THIS PINS: the watchdog's hold was carried by a service NO shipped gate consulted,
    // while `agent_teams_dispatch` read only its own workspace-wide `hold.json`. A parked team
    // therefore stayed dispatchable. With the record naming the team, the hold can be asked about.
    /** The harness whose watchdog holds every team. */
    const h = harness({ watchdogHolds: true })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result, which must refuse the whole pass. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string; pairs?: unknown[] }
    expect(result.halted).toContain("watchdog")
    expect(result.pairs).toHaveLength(0)
    // Nothing was paired, so nothing was sent to a member.
    expect(h.calls.some((call) => call.method === "sendMessage")).toBe(false)
  })

  test("with the watchdog's hold LIFTED the same pass dispatches", async () => {
    // The falsifier: without it, the arm above would pass even if dispatch were broken outright.
    /** The harness whose watchdog holds nothing. */
    const h = harness({ watchdogHolds: false })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result, which must pair the one ready task. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string }
    expect(result.halted).toBeUndefined()
    expect(h.calls.filter((call) => call.method === "sendMessage").length).toBe(1)
  })

  test("with NO watchdog service at all the pass dispatches — the read fails OPEN", async () => {
    /** The harness whose composition has no watchdog row. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result under an absent service. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string }
    expect(result.halted).toBeUndefined()
  })

  test("a hold that CANNOT be read is REPORTED as not-readable, never as a hold", async () => {
    // THE SECOND HALF OF DEFECT 3. The gate may not branch on the HoldView's truthiness (the arm
    // above pins that), but it may not treat every unreadable answer as a hold either: a service that
    // answers a `held` which is not a boolean is UNREADABLE, and the pass must say so — `not-readable`
    // — instead of parking the team with a hold nobody can clear.
    /** The harness whose watchdog answers an unreadable `held`. */
    const h = harness({ watchdogUnreadable: true })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result, which must dispatch AND carry the honest note. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string; holdRead?: string; pairs?: unknown[] }
    expect(result.halted).toBeUndefined()
    expect(result.holdRead).toContain("not-readable")
    // The pass really ran: the one ready task reached its member.
    expect(h.calls.filter((call) => call.method === "sendMessage").length).toBe(1)
  })

  test("the gate asks about the RECORD's team id in THIS workspace — the ARGUMENTS are pinned", async () => {
    // WHY THIS ARM EXISTS (T1). The shipped defect was invisible to this suite because the stub was
    // `isHeld: () => ({…})`: it answered yes to whatever id it was handed, so a gate that asked
    // about the WRONG id passed. The double above is now keyed by id and workspace, and this arm
    // states the contract in the open: the id asked about is the mpd record's own `team-<stamp>`,
    // and the workspace is the calling session's.
    /** The harness whose watchdog holds the record's own team id. */
    const h = harness({ watchdogHolds: true })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The record the pass must dispatch. */
    const record = listTeams(h.workspace)[0]
    // The id is OURS (`team-<stamp>`), never a session id — that is the whole point of the split.
    expect(record.teamId).toMatch(/^team-\d{14}$/)
    await h.call("agent_teams_dispatch", { action: "run" })
    expect(h.holdQueries).toEqual([{ teamId: record.teamId, workspace: h.workspace }])
  })
})

describe("a claim that lands while a dispatch pass is in flight is never reverted", () => {
  // THE DEFECT THIS PINS (T2): the pass read the record ONCE, then rewrote the WHOLE FILE after
  // each `await executor().send(...)` — so a `agent_teams_task {action:"claim"}` that landed during
  // the await was erased by the next blind write. The board then showed an in-flight task as
  // pending and its attempt counter regressed, so a later claim reused the same attempt number.
  test("a concurrent claim on another task SURVIVES the pass's own write", async () => {
    /** The harness whose `send` performs member B's claim on the real store, mid-await. */
    const h = harness({
      duringSend: (workspace) => {
        /** The record as it stands on disk at that instant. */
        const current = listTeams(workspace)[0]
        // Member B claims T2 through the SAME store functions `agent_teams_task claim` uses.
        writeTeam(workspace, updateTeamTask(current, "T2", { owner: "Reviewer", status: "in_progress", attempt: 1 }, new Date()))
      },
    })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The record's id, needed to read the board back. */
    const teamId = listTeams(h.workspace)[0].teamId
    /** The dispatch result, which must pair the one READY task and keep the concurrent claim. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { pairs?: Array<{ taskId: string }> }
    expect(result.pairs?.map((pair) => pair.taskId)).toEqual(["T1"])
    /** The board as it stands AFTER the pass. */
    const after = readTeam(h.workspace, teamId)
    /** The task the pass dispatched itself. */
    const dispatched = after?.tasks.find((task) => task.id === "T1")
    expect(dispatched?.owner).toBe("Senior Engineer")
    expect(dispatched?.status).toBe("in_progress")
    /** The task member B claimed while the pass was awaiting its send. */
    const claimed = after?.tasks.find((task) => task.id === "T2")
    // The claim was NOT reverted. The discriminating half is status/attempt/revision: the plan had
    // already left T2 owned by Reviewer, while ONLY the concurrent claim moved it to in_progress,
    // set attempt 1 and bumped its revision to 2 — the three fields a stale snapshot restores.
    expect(claimed?.owner).toBe("Reviewer")
    expect(claimed?.status).toBe("in_progress")
    expect(claimed?.attempt).toBe(1)
    expect(claimed?.revision).toBe(2)
  })

  test("the falsifier: with NO concurrent claim the pass still records its own pairing", async () => {
    /** The harness whose send mutates nothing. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The record's id. */
    const teamId = listTeams(h.workspace)[0].teamId
    await h.call("agent_teams_dispatch", { action: "run" })
    /** The board after the pass. */
    const after = readTeam(h.workspace, teamId)
    // The pass's OWN write landed: the dispatched task is owned and in flight.
    expect(after?.tasks.find((task) => task.id === "T1")?.owner).toBe("Senior Engineer")
    expect(after?.tasks.find((task) => task.id === "T1")?.status).toBe("in_progress")
    // And the task it did NOT dispatch is untouched.
    expect(after?.tasks.find((task) => task.id === "T2")?.status).toBe("pending")
  })
})

describe("a release that lands while a dispatch pass is in flight is never reverted", () => {
  // THE DEFECT THIS PINS (T7). Same mechanism as T2, a different file: `agent_teams_dispatch
  // {action:"run"}` read the dispatch LEDGER once BEFORE its pair loop, accumulated its own
  // assignments in memory across each `await executor().send(...)`, and then wrote the WHOLE map back
  // — so a `release` that landed on another task during that await (the ledger's other writer,
  // `agent_teams_task {action:"release"}`, calls read-then-write on the same file) was silently
  // erased: the member stayed recorded as busy and the freed task could never be dispatched again.
  test("a concurrent release on ANOTHER task SURVIVES the pass's own final write", async () => {
    /** Whether the send hook should land the concurrent release; false while the seeding pass runs. */
    let releaseMidPass = false
    /** The ledger's task ids as read INSIDE the await, right after the release wrote them. */
    let ledgerAtSend: string[] | undefined
    /** Drives `agent_teams_task release` from inside the executor's send hook; bound once the harness exists. */
    let releaseTask: (() => void) | undefined
    /** The harness under test. */
    const h = harness({
      duringSend: (workspace) => {
        if (!releaseMidPass) return
        // THE REAL WRITER, at the real moment: `agent_teams_task {action:"release"}` reads the ledger
        // and writes it back with that one entry removed. Its release branch contains no `await`, so
        // the whole read-modify-write completes synchronously here, while the pass is genuinely
        // suspended inside its own `await executor().send(...)` — nothing is hand-rolled at the file.
        releaseTask?.()
        ledgerAtSend = Object.keys(ledgerOnDisk(workspace)).sort()
      },
    })
    releaseTask = () => { void h.call("agent_teams_task", { action: "release", task_id: "T1" }) }
    sandboxes.push(h.workspace)
    await staged(h)
    // A THIRD task, UNBLOCKED, so a later pass still has something to pair once T1 is claimed.
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "second opinion", description: "an unblocked second task", owner: "Reviewer" } })
    await h.call("agent_teams_plan", { action: "approve" })
    // PASS 1 seeds the ledger through the tool itself: `limit: 1` pairs ONLY the first ready task, so
    // T1 is legitimately recorded as dispatched while T3 stays ready for the pass under test. No
    // fixture file is written by this arm — the ledger's only writers are the plugin's own tools.
    /** The seeding pass's result, which must record T1 and nothing else. */
    const seeded = (await h.call("agent_teams_dispatch", { action: "run", limit: 1 })) as { pairs?: Array<{ taskId: string }> }
    expect(seeded.pairs?.map((pair) => pair.taskId)).toEqual(["T1"])
    expect(Object.keys(ledgerOnDisk(h.workspace)).sort()).toEqual(["T1"])
    releaseMidPass = true
    /** The pass under test: it pairs T3 while the concurrent release frees T1. */
    const dispatched = (await h.call("agent_teams_dispatch", { action: "run" })) as { pairs?: Array<{ taskId: string }> }
    expect(dispatched.pairs?.map((pair) => pair.taskId)).toEqual(["T3"])
    // The interleaving really happened INSIDE the await: the ledger the hook read there no longer
    // carried T1. Without this the arm could pass by never racing at all.
    expect(ledgerAtSend).toEqual([])
    /** The ledger as the pass left it on disk. */
    const ledger = ledgerOnDisk(h.workspace)
    // THE ASSERTION THIS ARM EXISTS FOR. Pre-fix this is ["T1","T3"]: the pass's stale pre-await
    // snapshot restored the very entry the release had removed a moment earlier.
    expect(Object.keys(ledger).sort()).toEqual(["T3"])
    // And the pass's OWN just-sent pairing is still recorded — the fix MERGES the fresh ledger with
    // this pass's accepted operations instead of discarding either half.
    expect(ledger.T3?.memberName).toBe("Reviewer")
    expect(ledger.T1).toBeUndefined()
  })
})
