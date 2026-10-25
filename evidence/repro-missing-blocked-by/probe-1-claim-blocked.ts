// PROBE 1 — the reported hole, sharpened: does `agent_teams_task {action:"claim"}` respect a blocker
// that is still PENDING?
//
// Shape under test: a plan with T1 (work) and T2 (review) where T2 declares `blocked_by: ["T1"]`.
// After approval T1 is ready and T2 is not. The CLAIM action is then invoked on T2 while T1 is still
// `pending`. The DISPATCH action is invoked first, as the contrast path, because `planDispatch` gates
// on `task.ready !== true` while the claim branch contains no readiness read at all.
//
// The script reads the board back from DISK after every mutation: the tool's echo is not the record.
// Run from the repository root:
//   bun evidence/repro-missing-blocked-by/probe-1-claim-blocked.ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../packages/mpd-team-core-plugin/src/index.ts"
import { activeTeamId, readTeam, readyTasks, type TeamRecord, type TeamTaskRecord } from "../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The session that stages, approves and drives the tools; it is the team's lead. */
const LEAD = "lead-session"

/** One captured tool registration: the executor this probe drives, plus the tool's own renderer. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  /** The tool's own renderer, which produces the text a caller reads. */
  output?: { render?: (args: unknown, value: unknown) => Array<{ text?: string }> }
}

/** The probe's harness: the sandbox workspace, the registered tools and a stub executor. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /**
   * Drive one registered tool by name.
   * @param name - the registered tool name.
   * @param args - the tool arguments.
   * @param sessionId - the calling session; the Lead.
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

/** Print one labelled JSON block, so a reader can quote it verbatim from the log. */
function block(label: string, value: unknown): void {
  console.log(label + ": " + JSON.stringify(value))
}

/** The board fields this probe reports; `startedAt` is the field a claim must stamp. */
interface TaskView {
  /** The board id, minted at approval. */
  id: string
  /** The task's stored status. */
  status: string
  /** The stored owner, when one was declared or stamped. */
  owner?: string
  /** The stored blocker edges. */
  blockedBy: readonly string[]
  /** The stored unresolved references, when any survived approval. */
  unresolvedBlockers?: readonly string[]
  /** The claim's timestamp, when the row has ever been in flight. */
  startedAt?: string
}

/** Project the stored rows this probe reports, leaving every other field out of the log. */
function view(tasks: readonly TeamTaskRecord[]): TaskView[] {
  return tasks.map((task) => ({
    id: task.id,
    status: task.status,
    ...(task.owner === undefined ? {} : { owner: task.owner }),
    blockedBy: task.blockedBy ?? [],
    ...(task.unresolvedBlockers === undefined ? {} : { unresolvedBlockers: task.unresolvedBlockers }),
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
  }))
}

/**
 * Build the harness: the real plugin applied against a stub composition, as the package's own tests do.
 * @returns the harness this probe drives.
 */
function harness(): Harness {
  // The sandbox workspace, which is also what `workspaceRoot` answers.
  const workspace = mkdtempSync(join(tmpdir(), "mpd-repro-claim-"))
  // The tools the plugin registered.
  const tools = new Map<string, Tool>()
  // The stub backend: it raises any member and mints a handle derived from the member's name.
  const executor = {
    kind: "native",
    reason: "the probe's own executor",
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
    /** Deliver nothing; this probe never sends a message. */
    send: async (): Promise<void> => {},
    /** Interrupt nobody. */
    interrupt: async (): Promise<void> => {},
    /** The backend tracks no live identity — the same blindness as a dsh-tui boot. */
    membership: (): undefined => undefined,
    /** The backend tracks no members; the record is the roster. */
    members: (): [] => [],
  }
  // The stub adapter: the seams this row uses, and nothing else.
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
  // The minimal cordis context `apply` needs.
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
    /**
     * Drive one registered tool by name.
     * @param name - the registered tool name.
     * @param args - the tool arguments.
     * @param sessionId - the calling session; the Lead unless an arm says otherwise.
     * @returns the tool's own result, or its thrown refusal.
     */
    call: async (name: string, args: unknown, sessionId: string = LEAD): Promise<unknown> => {
      // The registered tool, or a thrown error naming what WAS registered.
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
      // The registered tool whose renderer is being driven.
      const tool = tools.get(name)
      return (tool?.output?.render?.({}, value) ?? []).map((part) => part.text ?? "").join("")
    },
  }
}

/** The approval answer, read for the fields this probe reports and nothing else. */
interface ApprovalAnswer {
  /** The staged plan, carrying what approval created. */
  plan?: { planId?: string; created?: { tasks?: Array<{ id: string; subject: string }>; unresolved?: unknown } }
  /** What approval actually minted. */
  created?: { members?: Array<{ name: string; id: string }>; tasks?: Array<{ id: string; subject: string }>; unresolved?: unknown }
  /** The persisted record. */
  team?: TeamRecord
}

/** The dispatch answer, read for the pairs and the per-task skip reasons. */
interface DispatchAnswer {
  /** The accepted pairings. */
  pairs?: Array<{ taskId: string; subject: string; memberName: string; note?: string }>
  /** Every considered task that was not paired, with the reason. */
  skipped?: Array<{ taskId: string; subject: string; reason: string }>
}

/** The claim answer, read for the contract attempt and the task's post-claim row. */
interface ClaimAnswer {
  /** The frozen contract for this attempt. */
  contract?: { taskId: string; claimedBy: string; attempt: number }
  /** The claimed row as the tool echoes it. */
  task?: TaskView
}

/** The probe body; a throw here is a BROKEN SETUP, not a defect verdict. */
async function main(): Promise<void> {
  console.log("=== PROBE 1: claim a task whose blocker is still pending ===")
  console.log("runner: bun " + String((process.versions as Record<string, string | undefined>).bun ?? "?") + " / node " + process.version)
  console.log("plugin under test: packages/mpd-team-core-plugin/src/index.ts (source, not dist)")

  // The harness and its sandbox.
  const h = harness()
  try {
    // ── setup: a two-task plan with ONE edge ────────────────────────────────
    await h.call("agent_teams_plan", { action: "create", name: "probe-1", description: "claim a blocked task" })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "write the core", description: "own the implementation", owner: "Senior Engineer", kind: "work" } })
    // The code path under test is the create_task alias the defect report names.
    const created2 = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "judge the implementation", owner: "Reviewer", kind: "review", blocked_by: ["T1"] } })
    block("create_task T2 answer (blockers reading)", created2)

    // ── approve ─────────────────────────────────────────────────────────────
    const approval = (await h.call("agent_teams_plan", { action: "approve" })) as ApprovalAnswer
    block("approval.answer.created", approval.created)
    block("approval.answer.plan.created.unresolved present", approval.plan?.created !== undefined && "unresolved" in approval.plan.created)
    console.log("approval.render: " + h.render("agent_teams_plan", approval))
    // The team the approval bound to the Lead session.
    const teamId = activeTeamId(h.workspace, LEAD)
    if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
    // The board as approved, read from disk.
    const approved = readTeam(h.workspace, teamId)
    if (approved === undefined) throw new Error("the approved record is not on disk")
    block("board after approval (disk)", view(approved.tasks))
    block("readyTasks after approval (disk)", readyTasks(approved).map((task) => task.id))
    // T1 must still be pending for the claim below to be the reported hole.
    const t1Before = approved.tasks.find((task) => task.id === "T1")
    const t2Before = approved.tasks.find((task) => task.id === "T2")
    if (t1Before?.status !== "pending" || t2Before?.blockedBy?.[0] !== "T1") throw new Error("SETUP BROKEN: T1 is not pending or T2 does not name T1 as its blocker")

    // ── contrast: the DISPATCH path, decided but not executed ───────────────
    console.log("\n--- contrast: agent_teams_dispatch {action:\"run\", dry_run:true} ---")
    const dispatch = (await h.call("agent_teams_dispatch", { action: "run", dry_run: true })) as DispatchAnswer
    block("dispatch.pairs", dispatch.pairs ?? [])
    block("dispatch.skipped", dispatch.skipped ?? [])
    // Whether the dispatch engine refused to pair T2 while T1 was pending.
    const dispatchRefusedT2 = (dispatch.skipped ?? []).some((row) => row.taskId === "T2" && row.reason.startsWith("not ready"))
    console.log("dispatch refused to pair T2 while T1 is pending: " + String(dispatchRefusedT2))

    // ── the claim path, invoked while T1 is still pending ───────────────────
    console.log("\n--- code path: agent_teams_task {action:\"claim\", task_id:\"T2\", claimant:\"Reviewer\"} ---")
    console.log("T1 status at the instant of the claim: " + String(t1Before.status))
    let claim: ClaimAnswer | undefined
    let claimError: string | undefined
    try {
      claim = (await h.call("agent_teams_task", { action: "claim", task_id: "T2", claimant: "Reviewer" })) as ClaimAnswer
    } catch (error) {
      claimError = String((error as Error)?.message ?? error)
    }
    block("claim.success", claimError === undefined)
    if (claimError !== undefined) block("claim.error", claimError)
    if (claim !== undefined) {
      block("claim.contract", claim.contract)
      block("claim.task (echo)", claim.task)
    }

    // ── the board afterwards, read from disk ────────────────────────────────
    const after = readTeam(h.workspace, teamId)
    if (after === undefined) throw new Error("the record disappeared after the claim")
    block("board after claim (disk)", view(after.tasks))
    // T2's stored row and T1's stored row, the two facts the verdict rests on.
    const t2After = after.tasks.find((task) => task.id === "T2")
    const t1After = after.tasks.find((task) => task.id === "T1")
    block("T2 status/startedAt after claim", { status: t2After?.status, startedAt: t2After?.startedAt ?? null })
    block("T1 status after claim", { status: t1After?.status })

    // ── verdict ─────────────────────────────────────────────────────────────
    // The defect is a SUCCESSFUL claim on a row the board still reads as blocked.
    const claimSucceeded = claimError === undefined && t2After?.status === "in_progress"
    const defect = claimSucceeded && t1After?.status === "pending"
    console.log("\nT2 startedAt stamped: " + String(t2After?.startedAt !== undefined))
    console.log("CONCLUSION: " + (defect ? "DEFECT REPRODUCED" : "NOT REPRODUCED")
      + " — claim on T2 (blocked by pending T1) " + (claimSucceeded ? "SUCCEEDED and T2 is in_progress" : "was refused")
      + (claimSucceeded ? "; T2.startedAt=" + String(t2After?.startedAt) : "")
      + "; T1=" + String(t1After?.status)
      + "; dispatch " + (dispatchRefusedT2 ? "REFUSED to pair T2" : "DID NOT refuse T2"))
  } finally {
    // The sandbox holds runtime state only; the log above is the evidence.
    rmSync(h.workspace, { recursive: true, force: true })
  }
}

await main()
