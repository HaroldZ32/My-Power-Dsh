// PROBE 2 — the "forgot blocked_by" shape: with THREE tasks and NO edges declared, does anything
// notice that the requirement/work/review chain is flat?
//
// Shape under test: a plan with a requirement task, a work task and a review task, none of which
// carries `blocked_by`. After approval, `agent_teams_dispatch {action:"run"}` is invoked twice and
// both answers are recorded. The approval answer and its rendered text are inspected for ANY
// dependency signal (`unresolved`, a warning, a blocker mention).
//
// The script reads the board back from DISK after approval: the tool's echo is not the record.
// Run from the repository root:
//   bun evidence/repro-missing-blocked-by/probe-2-no-edges.ts
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

/** The board fields this probe reports. */
interface TaskView {
  /** The board id, minted at approval. */
  id: string
  /** The task's stored kind. */
  kind: string
  /** The task's stored status. */
  status: string
  /** The stored owner, when one was declared or stamped. */
  owner?: string
  /** The stored blocker edges. */
  blockedBy: readonly string[]
  /** The stored unresolved references, when any survived approval. */
  unresolvedBlockers?: readonly string[]
  /** The claim's timestamp, when a dispatch pass put the row in flight. */
  startedAt?: string
}

/** Project the stored rows this probe reports, leaving every other field out of the log. */
function view(tasks: readonly TeamTaskRecord[]): TaskView[] {
  return tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
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
  const workspace = mkdtempSync(join(tmpdir(), "mpd-repro-no-edges-"))
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
    /** Deliver nothing; this probe records the pairing, not the message. */
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
  /** The accepted pairings, in board order. */
  pairs?: Array<{ taskId: string; subject: string; memberName: string; note?: string }>
  /** Every considered task that was not paired, with the reason. */
  skipped?: Array<{ taskId: string; subject: string; reason: string }>
}

/** The probe body; a throw here is a BROKEN SETUP, not a defect verdict. */
async function main(): Promise<void> {
  console.log("=== PROBE 2: three tasks, NO blocked_by, then dispatch twice ===")
  console.log("runner: bun " + String((process.versions as Record<string, string | undefined>).bun ?? "?") + " / node " + process.version)
  console.log("plugin under test: packages/mpd-team-core-plugin/src/index.ts (source, not dist)")

  // The harness and its sandbox.
  const h = harness()
  try {
    // ── setup: requirement / work / review, and NOT ONE EDGE ────────────────
    await h.call("agent_teams_plan", { action: "create", name: "probe-2", description: "three tasks with no edges" })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Lead", description: "coordinates", prompt: "You lead." } })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } })
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } })
    // Every create_task call deliberately omits blocked_by.
    const created = [
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: "requirement: the dependency guard", description: "freeze the acceptance contract", owner: "Lead", kind: "requirement" } }),
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: "work: implement the dependency guard", description: "write the guard", owner: "Senior Engineer", kind: "work" } }),
      await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review: verify the dependency guard", description: "judge the guard", owner: "Reviewer", kind: "review" } }),
    ]
    for (const [index, answer] of created.entries()) block(`create_task #${index + 1} answer`, answer)

    // ── approve ─────────────────────────────────────────────────────────────
    const approval = (await h.call("agent_teams_plan", { action: "approve" })) as ApprovalAnswer
    block("approval.answer.created", approval.created)
    // The three signals the report asks about: does approval warn, list `unresolved`, or stay silent?
    // The check is on the ANSWER'S OWN fields, never on a substring of the record: the team record
    // carries a `blockedBy` FIELD on every task, and that field NAME is not a warning.
    const answer = JSON.stringify(approval)
    console.log("approval answer mentions `unresolved`: " + String(answer.includes("unresolved")))
    console.log("approval answer.created carries `unresolved`: " + String(approval.created !== undefined && "unresolved" in approval.created))
    console.log("approval answer records any non-empty blockedBy edge: " + String((approval.team?.tasks ?? []).some((task) => (task.blockedBy ?? []).length > 0)))
    console.log("approval.render: " + h.render("agent_teams_plan", approval))
    const rendered = h.render("agent_teams_plan", approval)
    console.log("approval.render mentions a dependency signal: " + String(/blocked|blocker|depend|unresolved/i.test(rendered)))
    // The team the approval bound to the Lead session.
    const teamId = activeTeamId(h.workspace, LEAD)
    if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
    // The board as approved, read from disk.
    const approved = readTeam(h.workspace, teamId)
    if (approved === undefined) throw new Error("the approved record is not on disk")
    block("board after approval (disk)", view(approved.tasks))
    block("readyTasks after approval (disk)", readyTasks(approved).map((task) => task.id))
    // The shape under test must really be flat, or the probe measures nothing.
    if (approved.tasks.length !== 3 || approved.tasks.some((task) => (task.blockedBy ?? []).length > 0)) throw new Error("SETUP BROKEN: the approved board is not three tasks with no edges")

    // ── dispatch pass 1 ─────────────────────────────────────────────────────
    console.log("\n--- agent_teams_dispatch {action:\"run\"} (pass 1) ---")
    const first = (await h.call("agent_teams_dispatch", { action: "run" })) as DispatchAnswer
    block("pass1.pairs", first.pairs ?? [])
    block("pass1.skipped", first.skipped ?? [])
    block("board after pass 1 (disk)", view(readTeam(h.workspace, teamId)?.tasks ?? []))

    // ── dispatch pass 2 ─────────────────────────────────────────────────────
    console.log("\n--- agent_teams_dispatch {action:\"run\"} (pass 2) ---")
    const second = (await h.call("agent_teams_dispatch", { action: "run" })) as DispatchAnswer
    block("pass2.pairs", second.pairs ?? [])
    block("pass2.skipped", second.skipped ?? [])

    // ── verdict ─────────────────────────────────────────────────────────────
    // The defect is: all three flat tasks are independently ready and paired in ONE pass, while the
    // approval answer says nothing about the missing edges.
    const paired = (first.pairs ?? []).map((pair) => pair.taskId)
    const silentApproval = !answer.includes("unresolved") && !/blocked|blocker|depend|unresolved/i.test(rendered)
    const defect = paired.length === 3 && silentApproval
    console.log("\npaired in pass 1 (board order): " + JSON.stringify(paired))
    console.log("approval silent about dependencies: " + String(silentApproval))
    console.log("CONCLUSION: " + (defect ? "DEFECT REPRODUCED" : "NOT REPRODUCED")
      + " — " + String(paired.length) + " of 3 flat tasks were paired in one pass in order " + JSON.stringify(paired)
      + ", and the approval answer " + (silentApproval ? "named no dependency at all" : "did flag a dependency signal"))
  } finally {
    // The sandbox holds runtime state only; the log above is the evidence.
    rmSync(h.workspace, { recursive: true, force: true })
  }
}

await main()
