// AC-D5 — a MEMBER session resolves ITS OWN team and may close a task IT OWNS.
//
// THE TWO MEASURED DEFECTS THIS FILE PINS (both on a real session of the tui-dag-highlight wave):
//   D5a — a member session could not close its own board row: `agent_teams_task {action:"complete"}`
//         answered `no team record in this workspace — approve a plan first`. `recordFor` resolved a
//         team only through the ACTIVE-INDEX arm or the `leadSessionId` arm, and a teammate is neither
//         the index's key nor any record's lead — so a member resolved NOTHING.
//   D5b — the captain's own close was refused: `task T1 is owned by "Plan Reviewer" and this caller is
//         neither that owner nor this team's lead`, while `leadSessionId` on that very record named the
//         calling session. The closure gate read only the OFFICIAL membership flag, and in a dsh-tui
//         boot that service cannot mount at all, so the flag was always false.
//
// THE CAPTAIN'S RULING, which is what the arms below measure: a member resolves its own team and may
// close a task it OWNS; a member is STILL refused a task it does not own; the team's LEAD may close any
// task. Nothing wider — a member can never close a stranger's row, and a session that belongs to no
// team keeps exactly the refusal it got before.
//
// BOTH ENTRY POINTS ARE THE REAL ONES: the tool arms drive `apply()`'s own registered tools through
// their `execute` (the `agent_teams_plan` / `agent_teams_task` surface a captain and a member actually
// call), and the two store arms call `casCloseTask` straight, which is the pure decision the tool
// delegates to. No arm restates the resolution rule — each one reads the board back from disk.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index.ts"
import { activeTeamId, addTeamMember, addTeamTask, casCloseTask, createTeam, readTeam, updateTeamMember, writeTeam } from "../src/team-store.ts"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The session id the plan is approved from, so every fixture knows who the Lead is. */
const LEAD = "lead-session-1"

/** The instant the store arms stamp, so their fixtures are deterministic. */
const NOW = new Date("2026-10-07T12:00:00.000Z")

/** Every sandbox workspace these arms created, removed in one pass at the end of the module. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** The harness one arm drives: the sandbox, the registered tools and the published service. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /** The `mpdTeams` service the plugin published; read through a getter because `apply` runs later. */
  readonly service: MpdTeamsService | undefined
  /** Every answer the stub's membership read gave, so an arm can prove the official plane was BLIND. */
  membershipAnswers: Array<{ role?: string; name?: string } | undefined>
  /**
   * Drive one registered tool by name as a given session.
   * @param name - the registered tool name.
   * @param args - the tool arguments.
   * @param sessionId - the calling session, which is what the resolution arms vary.
   * @param title - the session header title, the second identity spelling the close path sends.
   * @returns the tool's own result, or its thrown refusal.
   */
  call: (name: string, args: unknown, sessionId: string, title?: string) => Promise<unknown>
}

/**
 * Build the harness: the real plugin applied against a stub composition.
 *
 * THE OFFICIAL PLANE IS ABSENT ON PURPOSE, which is the measured condition of both defects: the team
 * service cannot mount in a dsh-tui boot, so `teamMembership` answers `undefined` on every call (the
 * `membershipAnswers` log is what lets an arm prove the lead identity came from the RECORD and not from
 * that flag). The executor is a stub that mints one predictable handle per member NAME, which the
 * record then keeps as that member's `executorRef` — the very spelling the member's own session id is.
 * @returns the harness an arm drives.
 */
function harness(): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-member-close-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The service the plugin published. */
  let service: MpdTeamsService | undefined
  /** Every membership answer the stub gave: all `undefined`, by the harness contract above. */
  const membershipAnswers: Array<{ role?: string; name?: string } | undefined> = []
  /** The stub backend: it raises any member and mints a handle derived from the member's name. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    /**
     * Record nothing and answer a predictable handle.
     * @param _caller - the Lead agent, which this stub never inspects.
     * @param request - the raise request, read for the member's name.
     * @returns the handle the record will keep as the member's `executorRef`.
     */
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    /** Deliver nothing; no arm dispatches. */
    send: async (): Promise<void> => {},
    /** Interrupt nobody; no arm interrupts. */
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
    teamMembership: (): undefined => { membershipAnswers.push(undefined); return undefined },
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
  }
  /** The minimal cordis context `apply` needs; `provide` captures the service it publishes. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    membershipAnswers,
    /** The service the plugin published; a getter because `apply` runs after this literal is built. */
    get service(): MpdTeamsService | undefined { return service },
    call: async (name: string, args: unknown, sessionId: string, title?: string) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      /** The calling agent in the shape `sessionIdOf` reads, with the title only when given. */
      const agent = { session: { id: sessionId, ...(title === undefined ? {} : { header: { title } }) } }
      return tool.execute(args, { agent, signal: undefined })
    },
  }
}

/**
 * Approve a two-member, two-task team through the REAL plan tool, as {@link LEAD}.
 *
 * T1 is owned by "Senior Engineer" and T2 by "Reviewer", so an arm can always ask a member to close a
 * row it owns and a row it does not.
 * @param h - the harness to approve in.
 * @returns the approved team's id.
 */
async function approveTeam(h: Harness): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the lane work", description: "own the record", owner: "Senior Engineer" } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the review", description: "judge it", owner: "Reviewer" } }, LEAD)
  await h.call("agent_teams_plan", { action: "approve" }, LEAD)
  /** The team the approval bound to the Lead session. */
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
  return teamId
}

/**
 * The executor handle the record kept for one member — which is that member's OWN session id.
 * @param workspace - the workspace holding the record.
 * @param teamId - the team to read.
 * @param memberName - the member to look up.
 * @returns the recorded handle.
 */
function handleOf(workspace: string, teamId: string, memberName: string): string {
  /** The member as the durable record names it. */
  const member = readTeam(workspace, teamId)?.members.find((candidate) => candidate.name === memberName)
  if (member?.executorRef === undefined) throw new Error(`the record kept no handle for "${memberName}"`)
  return member.executorRef
}

/** One task's status as the record on DISK holds it — the only reading an arm may call the board. */
function statusOnDisk(workspace: string, teamId: string, taskId: string): string | undefined {
  return readTeam(workspace, teamId)?.tasks.find((candidate) => candidate.id === taskId)?.status
}

describe("AC-D5a — a member session resolves its own team", () => {
  test("a teammate is on the ROSTER, not in the index, and the tool path resolves it", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The session id of the "Senior Engineer" member, as the backend minted it. */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    // THE ARM IS THE ROSTER ARM and nothing else: the member is NOT the index's key for this team.
    expect(activeTeamId(h.workspace, member)).toBeUndefined()
    // The published service — the seam every other mpd surface reads — answers the same team.
    expect(h.service?.active(h.workspace, member)?.teamId).toBe(teamId)
    // AND THE TOOL PATH REALLY RESOLVES IT: `claim` needs a record, and before the fix this exact call
    // threw `no team record in this workspace — approve a plan first`.
    /** The claim's own answer. */
    const claimed = await h.call("agent_teams_task", { action: "claim", task_id: "T1" }, member) as { contract?: { taskId?: string; claimedBy?: string }; task?: { owner?: string } }
    expect(claimed.contract?.taskId).toBe("T1")
    expect(claimed.contract?.claimedBy).toBe(member)
    expect(claimed.task?.owner).toBe(member)
    // The claim landed on the member's OWN team and nowhere else.
    expect(readTeam(h.workspace, teamId)?.tasks.find((task) => task.id === "T1")?.owner).toBe(member)
  })

  test("a member completeS a task it OWNS and the board row goes terminal", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The session id of the "Senior Engineer" member. */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    await h.call("agent_teams_task", { action: "claim", task_id: "T1" }, member)
    /** The closure's own answer, which names the rule that allowed it. */
    const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T1", note: "the lane landed" }, member) as { status?: string; closedBy?: string; note?: string; refused?: string }
    expect(closed.refused).toBeUndefined()
    expect(closed.status).toBe("completed")
    // OWNER, not the lead override: the member earned this closure itself.
    expect(closed.closedBy).toBe("owner")
    expect(closed.note).toBe("the lane landed")
    // THE BOARD ROW ITSELF, read back from disk: the closure is durable, not just a result payload.
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("completed")
  })

  test("a member is STILL refused a task it does not own — and the refusal is quoted", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The session id of the "Senior Engineer" member, which owns T1 and NOT T2. */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    /** The refusal, in the shape the tool returns it. */
    const answer = await h.call("agent_teams_task", { action: "complete", task_id: "T2" }, member) as { refused?: string; taskId?: string }
    // THE EXACT SENTENCE, unchanged by this fix: a member may close only what it owns.
    expect(answer.refused).toBe('task T2 is owned by "Reviewer" and this caller is neither that owner nor this team\'s lead')
    expect(answer.taskId).toBe("T2")
    // AND NOTHING WAS WRITTEN: the stranger's row is exactly as it was.
    expect(statusOnDisk(h.workspace, teamId, "T2")).toBe("pending")
  })
})

describe("AC-D5b — the team's LEAD closes any task of its own team", () => {
  test("the recorded lead closes a task it does not own with NO official membership at all", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    // THE MEASURED CONDITION: the official identity read is unavailable in this composition, which is
    // exactly why the closure gate has to read the RECORD's own `leadSessionId`.
    /** The closure's own answer. */
    const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T2", note: "captain closed it" }, LEAD) as { status?: string; closedBy?: string; refused?: string }
    expect(closed.refused).toBeUndefined()
    expect(closed.status).toBe("completed")
    // SAID, not blurred: the outcome names the rule that allowed a stranger to close the row.
    expect(closed.closedBy).toBe("lead")
    expect(statusOnDisk(h.workspace, teamId, "T2")).toBe("completed")
    // The proof that the lead identity came from the RECORD: every membership read answered undefined.
    expect(h.membershipAnswers.length).toBeGreaterThan(0)
    expect(h.membershipAnswers.every((answer) => answer === undefined)).toBe(true)
  })

  test("casCloseTask: the record's leadSessionId is the authority, even with lead:false", () => {
    /** The sandbox this store arm works in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-member-close-store-"))
    sandboxes.push(workspace)
    /** A record whose owner is a NAME and whose lead is a session id — the captain's own shape. */
    let record = createTeam(workspace, { name: "the wave", description: "one wave", leadSessionId: "sess-lead" }, NOW)
    record = addTeamMember(record, { name: "Plan Reviewer", description: "judges" }, NOW)
    record = addTeamTask(record, { subject: "the review", description: "judge it", kind: "review", owner: "Plan Reviewer" }, NOW)
    /** The decision: the lead session, with the official flag FALSE. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["sess-lead"], lead: false, now: NOW })
    expect(outcome.applied).toBe(true)
    if (outcome.applied) expect(outcome.closedBy).toBe("lead")
  })

  test("casCloseTask: the lead comparison is nameMatches, so a spelling difference still resolves", () => {
    /** The sandbox this store arm works in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-member-close-store-"))
    sandboxes.push(workspace)
    /** A record whose lead session is spelled in the record's own casing. */
    let record = createTeam(workspace, { name: "the wave", description: "one wave", leadSessionId: "SESS-Lead" }, NOW)
    record = addTeamMember(record, { name: "Plan Reviewer", description: "judges" }, NOW)
    record = addTeamTask(record, { subject: "the review", description: "judge it", kind: "review", owner: "Plan Reviewer" }, NOW)
    /** The decision: the SAME session, spelled as the caller's own identity resolver reports it. */
    const outcome = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["sess-lead"], lead: false, now: NOW })
    expect(outcome.applied).toBe(true)
    if (outcome.applied) expect(outcome.closedBy).toBe("lead")
  })

  test("casCloseTask: a member that owns and leads neither is refused with the SAME sentence", () => {
    /** The sandbox this store arm works in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-member-close-store-"))
    sandboxes.push(workspace)
    /** A record whose lead is somebody else entirely. */
    let record = createTeam(workspace, { name: "the wave", description: "one wave", leadSessionId: "sess-lead" }, NOW)
    record = addTeamMember(record, { name: "Plan Reviewer", description: "judges" }, NOW)
    record = addTeamTask(record, { subject: "the review", description: "judge it", kind: "review", owner: "Plan Reviewer" }, NOW)
    /** The decision: a member session that owns nothing here. */
    const refused = casCloseTask(record, { taskId: "T1", status: "completed", caller: ["child-Senior-Engineer"], lead: false, now: NOW })
    expect(refused.applied).toBe(false)
    if (!refused.applied) expect(refused.reason).toBe('task T1 is owned by "Plan Reviewer" and this caller is neither that owner nor this team\'s lead')
  })
})

describe("AC-D5 — the bounds this fix must NOT widen", () => {
  test("a session on NO roster keeps the honest refusal it got before", async () => {
    /** The harness this arm drives. */
    const h = harness()
    // A team EXISTS in this workspace, so the refusal is about the CALLER and not about an empty one.
    await approveTeam(h)
    /** The thrown refusal, captured so the arm can quote the sentence. */
    const failure = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, "sess-that-joined-no-team").then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe("no team record in this workspace — approve a plan first")
  })

  test("a session on the roster of TWO teams resolves NEITHER, and the refusal names them", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The member session whose handle this arm duplicates onto a second team. */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    // A SECOND team in the SAME workspace naming the SAME handle. The instant differs by a minute
    // because a team id is derived from the creation instant (`team-` + YYYYMMDDHHMMSS).
    let second = createTeam(h.workspace, { name: "another wave", description: "a second board", leadSessionId: "sess-other-lead" }, new Date(NOW.getTime() + 60_000))
    second = addTeamMember(second, { name: "Senior Engineer", description: "implements" }, NOW)
    second = updateTeamMember(second, "M1", { executorRef: member })
    writeTeam(h.workspace, second)
    /** The thrown refusal, captured so the arm can quote the sentence. */
    const failure = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, member).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    /** The sentence itself. */
    const sentence = String((failure as Error).message)
    expect(sentence).toContain("on the roster of 2 teams")
    expect(sentence).toContain(teamId)
    expect(sentence).toContain(second.teamId)
    // NEVER A GUESS: nothing was written, so the row is still open on the FIRST team's board.
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("pending")
  })
})
