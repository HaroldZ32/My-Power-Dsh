// C7-4 — the SESSION-SURFACE fixes, one arm per fix and a NEGATIVE CONTROL beside each.
//
// THE FIVE MEASURED DEFECTS (plan .mpd/plans/tui-015-adaptation.md, "Plan amendment 2 (2026-10-14,
// user-reported): C7-4"):
//   F1 — `agent_teams_plan {action:"create_task"}` was NEVER a mid-run verb: approval ARCHIVES the staging
//        file, so after approval the same session could only get "no team is staged in this session".
//   F2 — a member's own `agent_teams_task {action:"complete"}` was accepted only when the row's owner
//        happened to BE the member's session id; a row owned by the member's NAME refused, because the
//        caller's other spelling is the session TITLE (the persona prompt prefix), not a name.
//   F3 — `agent_teams_mail {action:"summary"}` folded a WORKSPACE-GLOBAL ledger, so a new team read a
//        stale roster from a wave that ended days earlier.
//   F4 — `newTeamId`/`newPlanId` were second-precision, so two sessions minted ONE id (two session ids →
//        one teamId in `teams.json`; one archive directory for two plans).
//   F5 — a forked/resumed captain session got a NEW id while `teams.json` and the record kept the old
//        one, so both resolution arms broke until a hand rebind rewrote the file.
//
// EVERY ARM DRIVES THE REAL TOOL SURFACE (the tools `apply()` registers) or the REAL store functions, and
// reads the result back from DISK — never from the returned payload alone. The negative controls are as
// load-bearing as the fixes: a staged-but-approved plan still refuses, a stranger still cannot close a
// row, an unbound session with no history is still refused, a delegation child is not healed into the
// lead history, and a colliding id REDDENS.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index.ts"
import { send as sendRawMail } from "../src/mailbox-store.ts"
import { archivePathFor, archivePlan, newPlanId, stagePlan, writePlan, type StagedPlan } from "../src/plan-store.ts"
import { activeTeamId, createTeam, newTeamId, readTeam } from "../src/team-store.ts"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The extra session-header fields an arm stamps, which is how the churn and child arms are spelled. */
interface HeaderOpts {
  /** The session TITLE the harness gives the caller (the persona prompt prefix). */
  title?: string
  /** The parent session the harness recorded — present on a seeded fork and on a delegation child. */
  parentSession?: string
  /** `"subagent"` marks a recorded delegation child. */
  origin?: string
  /** A recorded delegation depth of 1+ also marks a child. */
  delegationDepth?: number
}

/** The session id the plan is approved from, so every fixture knows who the Lead is. */
const LEAD = "lead-session-1"

/** The instant the store arms stamp, so their fixtures are deterministic. */
const NOW = new Date("2026-10-14T12:00:00.000Z")

/** Every sandbox these arms created, removed in one pass after each test. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A fresh sandbox workspace, registered for cleanup. */
function sandbox(): string {
  /** The directory this call created. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-c74-"))
  sandboxes.push(dir)
  return dir
}

/** The harness one arm drives: the sandbox and the registered tools. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /** The `mpdTeams` service the plugin published; read through a getter because `apply` runs later. */
  readonly service: MpdTeamsService | undefined
  /**
   * Drive one registered tool by name as a given session.
   * @param name - the registered tool name.
   * @param args - the tool arguments.
   * @param sessionId - the calling session.
   * @param opts - the extra session-header fields the arm needs.
   * @returns the tool's own result, or its thrown refusal.
   */
  call: (name: string, args: unknown, sessionId: string, opts?: HeaderOpts) => Promise<unknown>
}

/**
 * Build the harness: the real plugin applied against a stub composition.
 *
 * THE OFFICIAL PLANE IS ABSENT ON PURPOSE — the measured condition of every defect here. The executor is a
 * stub that mints one predictable handle per member NAME, which the record keeps as that member's
 * `executorRef`: that handle IS the member session's own id in these arms.
 * @returns the harness an arm drives.
 */
function harness(): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = sandbox()
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The service the plugin published. */
  let service: MpdTeamsService | undefined
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
    /** Deliver nothing; the mailbox arm only needs the record. */
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
    /** The service the plugin published; a getter because `apply` runs after this literal is built. */
    get service(): MpdTeamsService | undefined { return service },
    call: async (name: string, args: unknown, sessionId: string, opts?: HeaderOpts) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      /** The session title, stamped only when the arm set one. */
      const title = opts?.title
      /** The parent session, stamped only when the arm recorded one. */
      const parentSession = opts?.parentSession
      /** The subagent origin, stamped only when the arm recorded one. */
      const origin = opts?.origin
      /** The delegation depth, stamped only when the arm recorded one. */
      const delegationDepth = opts?.delegationDepth
      /** The header, carrying exactly the fields the arm asked for. */
      const header = {
        ...(title === undefined ? {} : { title }),
        ...(parentSession === undefined ? {} : { parentSession }),
        ...(origin === undefined ? {} : { origin }),
        ...(delegationDepth === undefined ? {} : { delegationDepth }),
      }
      /** The calling agent in the shape `sessionIdOf` reads. */
      const agent = { session: { id: sessionId, header } }
      return tool.execute(args, { agent, signal: undefined })
    },
  }
}

/**
 * Approve a two-member, two-task team through the REAL plan tool, as {@link LEAD}.
 *
 * T1 is owned by "Senior Engineer" and T2 by "Reviewer" — both as NAMES, which is what the F2 arm needs.
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

describe("C7-4 F1 — a mid-run append lands on the APPROVED record", () => {
  test("after approval, create_task appends to the live team, carrying kind/coverageOf/sourceTaskId", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** How many tasks the board held BEFORE the append. */
    const before = readTeam(h.workspace, teamId)?.tasks.length ?? 0
    /** The tool's own answer, which says where the row landed. */
    const answer = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the repair", description: "fix it", kind: "repair", coverageOf: "C7-4 F1", sourceTaskId: "T1" } }, LEAD) as { appended?: string; task?: { id?: string; subject?: string } }
    // THE DEFECT: before the fix this exact call threw "no team is staged in this session".
    expect(answer.appended).toContain("live team " + teamId)
    // READ BACK FROM DISK: the row is on the APPROVED record, not in a staging file.
    /** The record as it now stands on disk. */
    const after = readTeam(h.workspace, teamId)
    expect(after?.tasks.length).toBe(before + 1)
    /** The row this append minted. */
    const minted = after?.tasks[after.tasks.length - 1]
    expect(minted?.subject).toBe("the repair")
    expect(minted?.kind).toBe("repair")
    expect(minted?.coverageOf).toBe("C7-4 F1")
    expect(minted?.sourceTaskId).toBe("T1")
  })

  test("after approval, add_member appends to the live roster AND raises the member", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The tool's own answer, which names the handle the backend minted. */
    const answer = await h.call("agent_teams_plan", { action: "add_member", member: { name: "Explorer", description: "finds", prompt: "You find things." } }, LEAD) as { spawned?: string; appended?: string }
    expect(answer.appended).toContain("live team " + teamId)
    expect(answer.spawned).toBe("child-Explorer")
    // READ BACK FROM DISK: the member is on the record with the handle the raise reported.
    /** The appended member as the record holds it. */
    const added = readTeam(h.workspace, teamId)?.members.find((member) => member.name === "Explorer")
    expect(added?.status).toBe("running")
    expect(added?.executorRef).toBe("child-Explorer")
  })

  test("NEGATIVE CONTROL: a plan that IS staged and already approved still refuses", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await approveTeam(h)
    // The partial-approval state the refusal exists for: approval wrote the record but STOPPED before
    // archiving, so the staging slot still holds a plan carrying `approvedAt`.
    /** The staged-but-approved plan planted in this session's staging slot. */
    const stranded: StagedPlan = { version: 1, planId: "plan-stranded-1", sessionId: LEAD, name: "x", description: "", approval: "required", members: [], tasks: [], stagedAt: NOW.toISOString(), approvedAt: NOW.toISOString() }
    writePlan(h.workspace, stranded)
    /** The thrown refusal, captured so the arm can quote the sentence. */
    const failure = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "x", description: "d" } }, LEAD).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe("plan plan-stranded-1 is already approved; stage a new one to change the team")
  })

  test("NEGATIVE CONTROL: no staged plan and no live team keeps the standing sentence", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The thrown refusal for a session that belongs to nothing. */
    const failure = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "x", description: "d" } }, "sess-nobody").then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe("no team is staged in this session — call agent_teams_create first")
  })
})

describe("C7-4 F2 — a member closes its own row by its recorded name", () => {
  test("a member session whose id IS the executorRef closes a row owned by its NAME", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The member's own session id, as the backend minted it and the record kept it. */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    // T1's owner was written at PLAN time as the NAME "Senior Engineer" and is NEVER claimed here — the
    // measured shape that used to refuse. The title is the persona prefix, not a name.
    /** The closure's own answer. */
    const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T1", note: "mine" }, member, { title: "You are the Senior Engineer, the roster's implementation specialist; ..." }) as { refused?: string; closedBy?: string; status?: string }
    expect(closed.refused).toBeUndefined()
    expect(closed.status).toBe("completed")
    // OWNER, not the lead override: the member earned the closure through its own recorded identity.
    expect(closed.closedBy).toBe("owner")
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("completed")
  })

  test("NEGATIVE CONTROL: a roster member still cannot close a row it does not own", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Reviewer's own session, which owns T2 and NOT T1. */
    const reviewer = handleOf(h.workspace, teamId, "Reviewer")
    /** The refusal, in the shape the tool returns it. */
    const answer = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, reviewer, { title: "You are the Reviewer." }) as { refused?: string }
    expect(answer.refused).toBe('task T1 is owned by "Senior Engineer" and this caller is neither that owner nor this team\'s lead')
    // NOTHING WAS WRITTEN.
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("pending")
  })
})

describe("C7-4 F3 — the mailbox summary is scoped", () => {
  test("a resolved team's summary is FILTERED to its members and labelled team", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    // One real message to THIS team, sent through the tool (which records the member's own id).
    await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "hi", body: "work" }, LEAD)
    // And one stale row from a wave that ended days ago — the workspace-global fold the defect read.
    sendRawMail(h.workspace, { fromId: "x", fromName: "old-wave", toId: "foreign-sess", toName: "old-wave", subject: "stale", body: "b", memberIds: ["foreign-sess"] }, NOW)
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { scope?: string; summary?: Array<{ memberId?: string }> }
    expect(answer.scope).toBe("team")
    /** The member ids the scoped summary carries. */
    const ids = (answer.summary ?? []).map((row) => row.memberId)
    expect(ids).toContain("M1")
    expect(ids).not.toContain("foreign-sess")
  })

  test("NEGATIVE CONTROL: no resolved team answers scope:workspace and the WHOLE fold", async () => {
    /** The harness this arm drives. */
    const h = harness()
    sendRawMail(h.workspace, { fromId: "x", fromName: "old-wave", toId: "foreign-sess", toName: "old-wave", subject: "stale", body: "b", memberIds: ["foreign-sess"] }, NOW)
    /** The tool's own answer for a session that belongs to no team. */
    const answer = await h.call("agent_teams_mail", { action: "summary" }, "sess-nobody") as { scope?: string; summary?: Array<{ memberId?: string }> }
    expect(answer.scope).toBe("workspace")
    expect((answer.summary ?? []).map((row) => row.memberId)).toContain("foreign-sess")
  })
})

describe("C7-4 F4 — ids never collide, and a collision is REFUSED", () => {
  test("two mints in the SAME millisecond differ, for teams AND plans, and keep the stamp sortable", () => {
    /** The first team id at the frozen instant. */
    const teamA = newTeamId(NOW)
    /** The second team id at the SAME instant. */
    const teamB = newTeamId(NOW)
    expect(teamA).not.toBe(teamB)
    expect(teamA).toMatch(/^team-\d{17}-[a-z0-9]+-[a-z0-9]+$/)
    /** The first plan id at the frozen instant. */
    const planA = newPlanId(NOW)
    /** The second plan id at the SAME instant. */
    const planB = newPlanId(NOW)
    expect(planA).not.toBe(planB)
  })

  test("two plans staged at the SAME instant archive into TWO directories", () => {
    /** The sandbox this store arm works in. */
    const ws = sandbox()
    /** The first plan staged in the session. */
    const first = stagePlan(ws, "s1", { name: "one", description: "", approval: "required" }, NOW)
    /** The second plan, staged at the SAME instant — with second precision it reused `first.planId`. */
    const second = stagePlan(ws, "s1", { name: "two", description: "", approval: "required" }, NOW)
    expect(second.planId).not.toBe(first.planId)
    // The first was archived by the second stage; BOTH archive slots hold their own plan.
    expect(existsSync(join(archivePathFor(ws, first.planId), "plan.json"))).toBe(true)
  })

  test("NEGATIVE CONTROL: a colliding TEAM id reddens — createTeam refuses an existing id", () => {
    /** The sandbox this store arm works in. */
    const ws = sandbox()
    createTeam(ws, { name: "first", description: "", leadSessionId: "s1", teamId: "team-fixed-1" }, NOW)
    expect(() => createTeam(ws, { name: "second", description: "", leadSessionId: "s2", teamId: "team-fixed-1" }, NOW)).toThrow(/already exists in this workspace/)
  })

  test("NEGATIVE CONTROL: a colliding PLAN id reddens — archivePlan refuses an existing archive", () => {
    /** The sandbox this store arm works in. */
    const ws = sandbox()
    /** The plan about to be archived twice. */
    const plan = stagePlan(ws, "s1", { name: "one", description: "", approval: "required" }, NOW)
    archivePlan(ws, plan)
    expect(() => archivePlan(ws, plan)).toThrow(/already archived in this workspace/)
  })
})

describe("C7-4 F5 — a forked/resumed captain keeps its captaincy", () => {
  test("a NEW lead session whose header records the old one resolves and closes as lead, and the heal sticks", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    // The fork: a new session id whose recorded parent is the approving session — the harness shape of a
    // seeded fork (parentSession + depth 0 + NO subagent origin).
    /** The closure's own answer. */
    const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T2", note: "captain" }, "lead-fork-2", { parentSession: LEAD }) as { refused?: string; closedBy?: string }
    expect(closed.refused).toBeUndefined()
    expect(closed.closedBy).toBe("lead")
    expect(statusOnDisk(h.workspace, teamId, "T2")).toBe("completed")
    // THE HEAL PERSISTED BOTH HALVES of what the hand rebind used to rewrite.
    expect(readTeam(h.workspace, teamId)?.leadHistory).toContain("lead-fork-2")
    expect(activeTeamId(h.workspace, "lead-fork-2")).toBe(teamId)
  })

  test("the healed binding holds on the NEXT call, which carries NO lineage at all", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    await h.call("agent_teams_task", { action: "complete", task_id: "T2" }, "lead-fork-2", { parentSession: LEAD })
    // The second call is an ordinary resumed session: no parent recorded. The registry binding and the
    // record's lead history are what answer now.
    /** The second closure's own answer. */
    const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, "lead-fork-2") as { refused?: string; closedBy?: string }
    expect(closed.refused).toBeUndefined()
    expect(closed.closedBy).toBe("lead")
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("completed")
  })

  test("NEGATIVE CONTROL: an unbound session with no history is still refused", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The thrown refusal for a session the record never named. */
    const failure = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, "lead-stranger").then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe("no team record in this workspace — approve a plan first")
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("pending")
  })

  test("NEGATIVE CONTROL: a delegation CHILD of the lead is NOT healed into the lead history", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    // A recorded subagent child of the captain carries the captain as `parentSession` TOO — so if lineage
    // alone granted captaincy, every child would become a lead. It must resolve NOTHING.
    /** The thrown refusal for a recorded child. */
    const failure = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, "child-of-lead", { parentSession: LEAD, origin: "subagent", delegationDepth: 1 }).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe("no team record in this workspace — approve a plan first")
    // AND NOTHING WAS HEALED: the child is not in the lead history, and the row is untouched.
    expect(readTeam(h.workspace, teamId)?.leadHistory ?? []).not.toContain("child-of-lead")
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("pending")
  })
})
