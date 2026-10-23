// THE PR #42 REVIEW REPAIRS — the five findings in this package, one describe per finding, each with
// its own NEGATIVE CONTROL. The review payload is DATA (`evidence/tui/dsh-tui-015/coderabbit/
// pr42-review-comments.json`); every arm below was written against the CODE, not against that text.
//
//   F-A (CWE-862) — `resolveForWrite` hands a roster MEMBER the live team, and both live append arms
//        (`add_member`, `create_task`) wrote it without checking Lead ownership: a member could raise a
//        WRITE-capable teammate or assign arbitrary `owner`/`write_scopes`.
//   F-B (CWE-863) — the C7-4 F5 lineage spellings let a member whose `parentSession` is the Lead inherit
//        the Lead spelling and take the Lead close override on ANOTHER member's row.
//   F-C — the `agent_teams_mail summary` team filter matched member ids/names that repeat across teams
//        (every team mints `M1`, `M2`…) so a stale row inflated `scope:"team"`.
//   F-D — `isLiveTeam` keyed archive evidence by Lead session + team NAME, so a discarded RETRY plan
//        could make a LIVE team terminal at the next dispatch/reap.
//   F-J (Minor) — the staged `create_task` arm dropped `kind`/`coverageOf`/`sourceTaskId`.
//
// EVERY ARM DRIVES THE REAL TOOL SURFACE (what `apply()` registers) or the REAL store functions, and
// reads the result back from DISK. The negative controls are as load-bearing as the fixes: the Lead's
// own append still lands, a forked captain still closes as lead, a genuinely reaped team is still
// reaped, a team-less caller still reads the whole fold, and a staged task without a kind still becomes
// `work`.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index.ts"
import { send as sendRawMail } from "../src/mailbox-store.ts"
import { readPlan } from "../src/plan-store.ts"
import { activeTeamId, readTeam, teamRecordPath, writeTeam, type TeamRecord } from "../src/team-store.ts"
import { isLiveTeam, readArchivedPlanIndex, reapReapedTeams } from "../src/team-lifecycle.ts"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The extra session-header fields an arm stamps, which is how each caller SHAPE is spelled. */
interface HeaderOpts {
  /** The session TITLE the harness gives the caller (the persona prompt prefix). */
  title?: string
  /** The parent session the harness recorded — present on a seeded fork and on a delegation child. */
  parentSession?: string
  /** `"subagent"` marks a recorded delegation child (what a spawned teammate carries). */
  origin?: string
  /** A recorded delegation depth of 1+ also marks a child. */
  delegationDepth?: number
}

/** The session id the plan is approved from, so every fixture knows who the Lead is. */
const LEAD = "lead-session-1"

/** The instant every clock-free store arm stamps, so its fixture is deterministic. */
const NOW = new Date("2026-10-15T12:00:00.000Z")

/** Every sandbox these arms created, removed in one pass after each test. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A fresh sandbox workspace, registered for cleanup. */
function sandbox(): string {
  /** The directory this call created. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-pr42-"))
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
 * THE OFFICIAL PLANE IS ABSENT ON PURPOSE — the measured condition of every finding here. The stub
 * backend raises any member except the ones `failFor` names, which is how the F-D arm stops an approval
 * PARTWAY (the state that leaves a live team with no approved archive), and the handle it mints per
 * member NAME is the `executorRef` the record keeps — that handle IS the member's own session id.
 * @param failFor - member names whose raise throws, so an approval stops partway.
 * @returns the harness an arm drives.
 */
function harness(failFor: readonly string[] = []): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = sandbox()
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The service the plugin published. */
  let service: MpdTeamsService | undefined
  /** The stub backend: it raises a member unless the arm asked for a partial approval. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    /**
     * Raise one member, or fail the raise the arm asked to fail.
     * @param _caller - the Lead agent, never inspected.
     * @param request - the raise request, read for the member's name.
     * @returns the handle the record keeps as `executorRef`.
     */
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => {
      /** The member being raised, which decides both the handle and the failure. */
      const name = String(request?.name ?? "")
      if (failFor.includes(name)) throw new Error(`the arm refuses to raise ${name}`)
      return { handle: "child-" + name.replace(/\s+/g, "-"), executor: "native" }
    },
    /** Deliver nothing; the mailbox arms only read the record. */
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
      /** The header, carrying exactly the session fields the arm asked for. */
      const header = {
        ...(opts?.title === undefined ? {} : { title: opts.title }),
        ...(opts?.parentSession === undefined ? {} : { parentSession: opts.parentSession }),
        ...(opts?.origin === undefined ? {} : { origin: opts.origin }),
        ...(opts?.delegationDepth === undefined ? {} : { delegationDepth: opts.delegationDepth }),
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
 * T1 is owned by "Senior Engineer" and T2 by "Reviewer" — both as NAMES, which is what the ownership
 * arms compare against.
 * @param h - the harness to approve in.
 * @returns the approved team's id.
 */
async function approveTeam(h: Harness): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the lane work", description: "own the record", owner: "Senior Engineer", blocked_by: [] } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the review", description: "judge it", owner: "Reviewer", blocked_by: [] } }, LEAD)
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

/** The record file's bytes, for the "the refusal did not mutate the record" arms. */
function recordBytes(workspace: string, teamId: string): string {
  return readFileSync(teamRecordPath(workspace, teamId), "utf8")
}

/** A minimal team record for the store-level lifecycle arms; every unread field keeps a fixed value. */
function record(over: Partial<TeamRecord> & { teamId: string }): TeamRecord {
  return {
    version: 1,
    name: "wave",
    description: "why",
    leadSessionId: "lead-1",
    phase: "active",
    createdAt: "2026-10-15T00:00:00.000Z",
    members: [],
    tasks: [],
    nextMemberNumber: 1,
    nextTaskNumber: 1,
    ...over,
  }
}

/**
 * Plant one archived plan under `.mpd/team/archive/<planId>/plan.json`.
 * @param workspace - the workspace whose archive receives it.
 * @param planId - the plan identity the directory and the file both carry.
 * @param approved - true to archive it WITH an `approvedAt`, false for the unapproved form.
 */
function plantArchivedPlan(workspace: string, planId: string, approved: boolean): void {
  mkdirSync(join(workspace, ".mpd", "team", "archive", planId), { recursive: true })
  writeFileSync(
    join(workspace, ".mpd", "team", "archive", planId, "plan.json"),
    JSON.stringify({ version: 1, planId, sessionId: "lead-1", name: "wave", ...(approved ? { approvedAt: "2026-10-15T00:00:00.000Z" } : {}) }),
  )
}

describe("F-A (CWE-862) — the live append arms require the LEAD", () => {
  test("a spawned MEMBER's live create_task is REFUSED with the reason, and the record is untouched", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Senior Engineer's own session, as the backend raised it (id IS the recorded handle). */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    /** The record's bytes BEFORE the refused call. */
    const before = recordBytes(h.workspace, teamId)
    /** The thrown refusal, captured so the arm can quote the sentence. */
    const failure = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "sneak", description: "d", owner: "Reviewer", writeScopes: ["packages/**"], blocked_by: [] } }, member, { origin: "subagent", delegationDepth: 1 }).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe(`only the Lead of team ${teamId} may append to its live roster or board`)
    // NOTHING WAS WRITTEN: not one byte of the record moved, and no task was minted.
    expect(recordBytes(h.workspace, teamId)).toBe(before)
    expect(readTeam(h.workspace, teamId)?.tasks.length).toBe(2)
  })

  test("a member that also records the LEAD as parentSession is refused all the same", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Reviewer's own session, spelled the F-B way: a member whose parent is the Lead. */
    const member = handleOf(h.workspace, teamId, "Reviewer")
    /** The record's bytes BEFORE the refused call. */
    const before = recordBytes(h.workspace, teamId)
    /** The thrown refusal for the roster append. */
    const failure = await h.call("agent_teams_plan", { action: "add_member", member: { name: "Guard", description: "writes", prompt: "You write." } }, member, { parentSession: LEAD }).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toBe(`only the Lead of team ${teamId} may append to its live roster or board`)
    expect(recordBytes(h.workspace, teamId)).toBe(before)
    /** The roster as the record still holds it: exactly the two approved members. */
    const names = (readTeam(h.workspace, teamId)?.members ?? []).map((row) => row.name)
    expect(names).toEqual(["Senior Engineer", "Reviewer"])
  })

  test("NEGATIVE CONTROL: the LEAD's own live appends still land on the record", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Lead's roster append. */
    const member = await h.call("agent_teams_plan", { action: "add_member", member: { name: "Guard", description: "writes", prompt: "You write." } }, LEAD) as { appended?: string }
    expect(member.appended).toContain("live team " + teamId)
    /** The Lead's board append. */
    const task = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the repair", description: "fix it", owner: "Guard", writeScopes: ["packages/mpd-team-core-plugin/src"], blocked_by: [] } }, LEAD) as { appended?: string }
    expect(task.appended).toContain("live team " + teamId)
    // READ BACK FROM DISK: both appends are on the live record, not in a staging file.
    expect(readTeam(h.workspace, teamId)?.members.map((row) => row.name)).toEqual(["Senior Engineer", "Reviewer", "Guard"])
    /** The row the Lead's append minted. */
    const minted = readTeam(h.workspace, teamId)?.tasks.at(-1)
    expect(minted?.subject).toBe("the repair")
    expect(minted?.owner).toBe("Guard")
    expect(minted?.writeScopes).toEqual(["packages/mpd-team-core-plugin/src"])
  })
})

describe("F-B (CWE-863) — lineage is not a member's identity", () => {
  test("a member whose parentSession IS the Lead cannot close ANOTHER member's row as the Lead", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Reviewer's own session, with the Lead recorded as its parent — the F-B shape. */
    const reviewer = handleOf(h.workspace, teamId, "Reviewer")
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, reviewer, { parentSession: LEAD }) as { refused?: string; closedBy?: string }
    expect(answer.refused).toBe('task T1 is owned by "Senior Engineer" and this caller is neither that owner nor this team\'s lead')
    expect(answer.closedBy).toBeUndefined()
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("pending")
  })

  test("the same member still closes its OWN row", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Senior Engineer's own session, same shape: the Lead recorded as its parent. */
    const member = handleOf(h.workspace, teamId, "Senior Engineer")
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_task", { action: "complete", task_id: "T1", note: "mine" }, member, { parentSession: LEAD, title: "You are the Senior Engineer, the roster's implementation specialist; ..." }) as { refused?: string; closedBy?: string; status?: string }
    expect(answer.refused).toBeUndefined()
    expect(answer.status).toBe("completed")
    // OWNER, not the lead override: the member earned it through its own recorded identity.
    expect(answer.closedBy).toBe("owner")
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("completed")
  })

  test("NEGATIVE CONTROL: a forked captain that is NOT on the roster still closes as the lead, and the heal sticks", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The fork: a new session id whose recorded parent is the approving session, no roster row at all. */
    const answer = await h.call("agent_teams_task", { action: "complete", task_id: "T2", note: "captain" }, "lead-fork-2", { parentSession: LEAD }) as { refused?: string; closedBy?: string }
    expect(answer.refused).toBeUndefined()
    expect(answer.closedBy).toBe("lead")
    expect(statusOnDisk(h.workspace, teamId, "T2")).toBe("completed")
    expect(readTeam(h.workspace, teamId)?.leadHistory).toContain("lead-fork-2")
    expect(activeTeamId(h.workspace, "lead-fork-2")).toBe(teamId)
  })

  test("NEGATIVE CONTROL: a member of ANOTHER name borrowing a stranger's lineage is still refused", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The Reviewer's session, whose recorded parent is NOT the Lead. */
    const reviewer = handleOf(h.workspace, teamId, "Reviewer")
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_task", { action: "complete", task_id: "T1" }, reviewer, { parentSession: "some-other-session" }) as { refused?: string; closedBy?: string }
    expect(answer.refused).toBe('task T1 is owned by "Senior Engineer" and this caller is neither that owner nor this team\'s lead')
    expect(statusOnDisk(h.workspace, teamId, "T1")).toBe("pending")
  })
})

describe("F-C — the mailbox summary scopes by team IDENTITY", () => {
  test("a stale row addressed to ANOTHER team's M1 is excluded; this team's own rows are kept", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    // One real message to THIS team, sent through the tool: it carries the team stamp.
    await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "hi", body: "work" }, LEAD)
    /** The per-team member id every team reuses, which is what the stale row impersonates. */
    const m1 = "M1"
    // A row stamped with ANOTHER team, addressed to the same `M1` — the F-C impostor.
    sendRawMail(h.workspace, { fromId: "x", fromName: "old wave", toId: m1, toName: "Senior Engineer", subject: "stale", body: "b", memberIds: [m1], teamId: "team-old-wave" }, NOW)
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { scope?: string; summary?: Array<{ memberId?: string; total?: number; unread?: number }>; legacyUnstamped?: number }
    expect(answer.scope).toBe("team")
    /** The scoped rows, indexed by member id. */
    const rows = new Map((answer.summary ?? []).map((row) => [String(row.memberId), row]))
    // ONLY the tool's own send counts: the other team's row to the same M1 is gone.
    expect(rows.get(m1)?.total).toBe(1)
    expect(rows.get(m1)?.unread).toBe(1)
    // Nothing was left out for lack of a stamp: the impostor carried one, it was simply not ours.
    expect(answer.legacyUnstamped).toBeUndefined()
  })

  test("NEGATIVE CONTROL: a row stamped with THIS team's id is included, even without the tool's send", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    /** The per-team member id both rows below address. */
    const m1 = "M1"
    // One row stamped with THIS team, planted directly so the arm isolates the filter from `send`.
    sendRawMail(h.workspace, { fromId: "x", fromName: "the lead", toId: m1, toName: "Senior Engineer", subject: "planted", body: "b", memberIds: [m1], teamId }, NOW)
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { scope?: string; summary?: Array<{ memberId?: string; total?: number }> }
    expect(answer.scope).toBe("team")
    expect(answer.summary?.find((row) => row.memberId === m1)?.total).toBe(1)
  })

  test("a LEGACY unstamped row follows the stated rule: excluded from the team scope and COUNTED", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The approved team. */
    const teamId = await approveTeam(h)
    await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "hi", body: "work" }, LEAD)
    /** The per-team member id the legacy row impersonates. */
    const m1 = "M1"
    // A row written BEFORE the stamp existed: no team can prove it owns it.
    sendRawMail(h.workspace, { fromId: "x", fromName: "old wave", toId: m1, toName: "Senior Engineer", subject: "legacy", body: "b", memberIds: [m1] }, NOW)
    /** The tool's own answer. */
    const answer = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { scope?: string; summary?: Array<{ memberId?: string; total?: number }>; legacyUnstamped?: number }
    expect(answer.scope).toBe("team")
    expect(answer.summary?.find((row) => row.memberId === m1)?.total).toBe(1)
    expect(answer.legacyUnstamped).toBe(1)
  })

  test("NEGATIVE CONTROL: with no team resolved the WHOLE fold is returned, legacy row included", async () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The per-team member id the legacy row carries. */
    const m1 = "M1"
    sendRawMail(h.workspace, { fromId: "x", fromName: "old wave", toId: m1, toName: "Senior Engineer", subject: "legacy", body: "b", memberIds: [m1] }, NOW)
    /** The tool's own answer for a session that belongs to no team. */
    const answer = await h.call("agent_teams_mail", { action: "summary" }, "sess-nobody") as { scope?: string; summary?: Array<{ memberId?: string; total?: number }>; legacyUnstamped?: number }
    expect(answer.scope).toBe("workspace")
    expect(answer.summary?.find((row) => row.memberId === m1)?.total).toBe(1)
    expect(answer.legacyUnstamped).toBeUndefined()
  })
})

describe("F-D — archive evidence is keyed by the record's OWN plan", () => {
  test("the repro: partial approve -> retry create+replace -> delete the retry -> dispatch leaves the team LIVE", async () => {
    /** The harness, with the Reviewer's raise failing so the approval STOPS PARTWAY. */
    const h = harness(["Reviewer"])
    await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" }, LEAD)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the lane work", description: "d", owner: "Senior Engineer", blocked_by: [] } }, LEAD)
    /** The approval's own answer: it stopped, so `archivePlan` never ran for this plan. */
    const approval = await h.call("agent_teams_plan", { action: "approve" }, LEAD) as { stoppedAt?: string; team?: TeamRecord }
    expect(approval.stoppedAt).toContain("Reviewer")
    /** The plan the approval came from, still in the staging slot because it was never archived. */
    const planA = readPlan(h.workspace, LEAD)?.planId
    expect(planA).toBeTruthy()
    // THE FIX ITSELF: the record carries the plan it was approved from.
    expect(approval.team?.planId).toBe(planA)
    /** The live team the partial approval created. */
    const teamId = activeTeamId(h.workspace, LEAD)
    expect(teamId).toBeTruthy()
    expect(readArchivedPlanIndex(h.workspace).approved.size).toBe(0)
    // The retry the user discards: a DIFFERENT plan for the same Lead and the same team name.
    await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave", replace: true }, LEAD)
    /** The retry's own plan id, which must not be evidence about the live team. */
    const planB = readPlan(h.workspace, LEAD)?.planId
    expect(planB).not.toBe(planA)
    await h.call("agent_teams_plan", { action: "delete" }, LEAD)
    /** The archive as it now stands: the retry, unapproved, and nothing for plan A. */
    const index = readArchivedPlanIndex(h.workspace)
    expect(index.unapproved.has(String(planB))).toBe(true)
    expect(index.approved.size).toBe(0)
    // The live team is STILL live, and its bytes are what the reap pass must leave alone.
    expect(isLiveTeam(readTeam(h.workspace, String(teamId))!, index)).toBe(true)
    /** The record's bytes BEFORE the dispatch pass, for the byte-compare below. */
    const before = recordBytes(h.workspace, String(teamId))
    // Step 4: the DISPATCH pass, which runs the C7-3 reap before it pairs anything.
    const pass = await h.call("agent_teams_dispatch", { action: "run", dry_run: true }, LEAD) as { reaped?: string[] }
    expect(pass.reaped ?? []).not.toContain(teamId)
    expect(recordBytes(h.workspace, String(teamId))).toBe(before)
    expect(activeTeamId(h.workspace, LEAD)).toBe(teamId)
    expect(readTeam(h.workspace, String(teamId))?.phase).toBe("active")
  })

  test("NEGATIVE CONTROL: a genuinely discarded plan is still reaped, with its plan id in the reason", async () => {
    /** The temp workspace this store arm drives. */
    const ws = sandbox()
    writeTeam(ws, record({ teamId: "team-ghost", name: "wave-x", leadSessionId: "lead-x", planId: "plan-ghost" }))
    plantArchivedPlan(ws, "plan-ghost", false)
    /** The archive index the rules read. */
    const index = readArchivedPlanIndex(ws)
    expect(isLiveTeam(readTeam(ws, "team-ghost")!, index)).toBe(false)
    expect(reapReapedTeams(ws, NOW)).toEqual(["team-ghost"])
    /** The repaired record: terminal, stamped, and told exactly which plan was discarded. */
    const ghost = readTeam(ws, "team-ghost")!
    expect(ghost.phase).toBe("ended")
    expect(ghost.endedAt).toBe(NOW.toISOString())
    expect(ghost.archivedReason).toContain("archived without approval")
    expect(ghost.archivedReason).toContain("plan-ghost")
  })

  test("an old record WITHOUT the field follows the migration rule: never archive-reaped, still phase-reaped", async () => {
    /** The temp workspace this store arm drives. */
    const ws = sandbox()
    // A record that predates `planId`, sharing a Lead and a name with an unapproved archive — the exact
    // shape that used to make a live team terminal.
    writeTeam(ws, record({ teamId: "team-legacy", name: "wave-x", leadSessionId: "lead-x" }))
    plantArchivedPlan(ws, "plan-somebody-else", false)
    /** The archive index the rules read. */
    const index = readArchivedPlanIndex(ws)
    // THE STATED RULE: the archive cannot IDENTIFY a legacy record's plan, so it never terminates it.
    expect(isLiveTeam(readTeam(ws, "team-legacy")!, index)).toBe(true)
    expect(reapReapedTeams(ws, NOW)).toEqual([])
    expect(readTeam(ws, "team-legacy")).toEqual(record({ teamId: "team-legacy", name: "wave-x", leadSessionId: "lead-x" }))
    // The phase rule needs no plan identity, so a legacy PHASE ghost is still reaped.
    writeTeam(ws, record({ teamId: "team-legacy-phase", name: "wave-z", leadSessionId: "lead-z", phase: "archived" as TeamRecord["phase"] }))
    expect(reapReapedTeams(ws, NOW)).toEqual(["team-legacy-phase"])
    expect(readTeam(ws, "team-legacy-phase")?.archivedReason).toContain("not a live team phase")
  })
})

describe("F-J — the staged arm carries kind/coverageOf/sourceTaskId", () => {
  test("a staged repair row reaches the STAGED plan and the BOARD with all three fields", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" }, LEAD)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the repair", description: "fix it", kind: "repair", coverageOf: "C7-4 F1", sourceTaskId: "T1", owner: "Reviewer", blocked_by: [] } }, LEAD)
    /** The staged plan read back through the tool, before any approval. */
    const staged = await h.call("agent_teams_plan", { action: "edit" }, LEAD) as { plan?: { tasks?: Array<{ kind?: string; coverageOf?: string; sourceTaskId?: string }> } }
    expect(staged.plan?.tasks?.[0]?.kind).toBe("repair")
    expect(staged.plan?.tasks?.[0]?.coverageOf).toBe("C7-4 F1")
    expect(staged.plan?.tasks?.[0]?.sourceTaskId).toBe("T1")
    await h.call("agent_teams_plan", { action: "approve" }, LEAD)
    /** The team the approval bound. */
    const teamId = activeTeamId(h.workspace, LEAD)
    /** The board row the staged task became. */
    const minted = readTeam(h.workspace, String(teamId))?.tasks[0]
    expect(minted?.kind).toBe("repair")
    expect(minted?.coverageOf).toBe("C7-4 F1")
    expect(minted?.sourceTaskId).toBe("T1")
  })

  test("NEGATIVE CONTROL: a staged task that names NO kind still becomes `work`", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" }, LEAD)
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "plain work", description: "do it", blocked_by: [] } }, LEAD)
    await h.call("agent_teams_plan", { action: "approve" }, LEAD)
    /** The team the approval bound. */
    const teamId = activeTeamId(h.workspace, LEAD)
    /** The board row the unnamed staged task became. */
    const minted = readTeam(h.workspace, String(teamId))?.tasks[0]
    expect(minted?.kind).toBe("work")
    expect(minted?.coverageOf).toBeUndefined()
    expect(minted?.sourceTaskId).toBeUndefined()
  })
})
