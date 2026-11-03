// THE TEAM'S ONE TERMINAL VERB (N3, wave 0.17.2).
//
// WHY IT EXISTS. Before this verb no SUPPORTED call could end a live team: `agent_teams_plan
// {action:"delete"}` archives a STAGED plan, `halt` writes a workspace-wide hold (the README's own
// "A halt is not an ending"), the reap pass only touches records that are already non-live, and the
// store's `deleteTeam` has no caller — so the only close was a hand edit of `phase` + `endedAt`.
// These arms drive the REAL tool against the REAL store, because the contract is the record and the
// resolution afterwards, not the sentence: a live team ends, its record is stamped once, it stops
// resolving for every seat, a non-Lead is refused before any write, and a repeat is a reported no-op.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index"
import { activeTeamId, listTeams, readTeam, unbindActiveTeam, writeTeam, type TeamRecord } from "../src/team-store"
import { readTeamJournal } from "../src/team-journal"

/** One captured tool registration, with `execute` kept so an arm can drive the real body. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The tool's executor; the second argument is the call's exec payload. */
  execute: (args: unknown, exec: unknown) => Promise<Record<string, any>>
}

/** The harness one arm drives: a sandbox workspace, the real plugin and a stub executor. */
interface Harness {
  /** The sandbox workspace every store call is scoped to. */
  workspace: string
  /** The Lead session the ordinary calls run as. */
  leadSession: string
  /** The `mpdTeams` service the plugin published; a getter because `apply` runs after the literal. */
  service: MpdTeamsService | undefined
  /** Drive one registered tool as the Lead. */
  call: (name: string, args: unknown) => Promise<Record<string, any>>
  /**
   * Drive one registered tool AS another session, which is how the refusals and the identity shapes
   * are exercised; `header` supplies the harness facts (`parentSession`, `origin`, `delegationDepth`).
   */
  callAs: (name: string, args: unknown, sessionId: string, header?: Record<string, unknown>) => Promise<Record<string, any>>
}

/**
 * Build the harness: the real plugin applied against a stub executor.
 *
 * The executor only RAISES members (`spawn` → a deterministic handle) and swallows sends; nothing in
 * this file dispatches, so that is the whole seam an approval needs.
 * @returns the harness an arm drives.
 */
function harness(): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-end-"))
  /** The tools the plugin registered, by name. */
  const tools = new Map<string, Tool>()
  /** A disposer-returning no-op for every seam this file never exercises. */
  const noop = (): (() => void) => () => {}
  /** The stub executor: raise a member, accept a send, interrupt nothing. */
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
  /** The stub adapter: the plugin's own seams, over the stub executor. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: Tool) => { tools.set(definition.name, definition); return () => {} }
      if (prop === "registerCommand") return () => () => {}
      if (prop === "workspaceRoot") return () => workspace
      if (prop === "teamExecutor") return () => executor
      if (prop === "teamListMembers" || prop === "teamListTasks") return () => []
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  /** The service the plugin published, read through the harness getter below. */
  let service: MpdTeamsService | undefined
  /** The Lead session every ordinary call runs as. */
  const leadSession = "sess-lead"
  /** The minimal cordis context `apply` needs: the adapter, the role service and `provide`. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdRoles" ? { list: () => [] } : undefined),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: noop,
  }
  apply(ctx as never)
  /**
   * Call one tool AS one session.
   * @param name - the tool name.
   * @param args - its arguments.
   * @param sessionId - the session whose team and authority the call uses.
   * @param header - extra session-header facts (`parentSession`, `origin`, `delegationDepth`).
   * @returns the tool body's value.
   */
  const callAs = async (name: string, args: unknown, sessionId: string, header: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    /** The registered tool, or a thrown error naming what WAS registered. */
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
    /** The exec payload: the harness resolves workspace, session and lineage from these facts. */
    const exec = { agent: { session: { id: sessionId, header: { cwd: workspace, ...header } } }, signal: undefined }
    return await tool.execute(args, exec) as Record<string, any>
  }
  return {
    workspace,
    leadSession,
    call: (name, args) => callAs(name, args, leadSession),
    callAs,
    /** The published service; `apply` assigned it before this literal is read. */
    get service(): MpdTeamsService | undefined { return service },
  }
}

/**
 * Stage and approve a one-member, one-task wave AS one session.
 * @param h - the harness under test.
 * @param sessionId - the Lead session that stages and approves it.
 * @returns the team record the approval wrote.
 */
async function approvedWaveAs(h: Harness, sessionId: string): Promise<TeamRecord> {
  // The plan is staged through the same tools a captain uses, so the record under test is a REAL one.
  await h.callAs("agent_teams_plan", { action: "create", name: "wave-close", description: "close this wave" }, sessionId)
  await h.callAs("agent_teams_plan", { action: "add_member", member: { name: "Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" } }, sessionId)
  await h.callAs("agent_teams_plan", { action: "create_task", task: { subject: "work", description: "do it", blocked_by: [], owner: "Engineer" } }, sessionId)
  /** The approve reply, whose `team` is the record that approval built. */
  const reply = await h.callAs("agent_teams_plan", { action: "approve" }, sessionId)
  /** The record the approval minted. */
  const record = reply.team as TeamRecord
  expect(record).toBeDefined()
  expect(record.phase).toBe("active")
  return record
}

/**
 * Stage and approve a wave as the harness's own Lead session.
 * @param h - the harness under test.
 * @returns the team record the approval wrote.
 */
async function approvedWave(h: Harness): Promise<TeamRecord> {
  return approvedWaveAs(h, h.leadSession)
}

/**
 * Run one tool call that must refuse.
 * @param call - the call to drive.
 * @returns the refusal sentence; throws when the call succeeded.
 */
async function refusalOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a refusal, but the call succeeded")
}

/** Every sandbox one arm created, removed even when the arm fails. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe("agent_teams_control {action:\"end\"}", () => {
  test("a Lead ends a live team, and the record carries the terminal stamp", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // The record starts with no terminal fact at all, which is what makes the arm about the END.
    expect(readTeam(h.workspace, team.teamId)?.endedAt).toBeUndefined()
    /** The close, targeting the team by its explicit id. */
    const reply = await h.call("agent_teams_control", { action: "end", team_id: team.teamId, reason: "the wave landed" })
    expect(reply.teamId).toBe(team.teamId)
    expect(reply.changed).toBe(true)
    expect(reply.reason).toBe("the wave landed")
    expect(Number.isNaN(Date.parse(String(reply.endedAt)))).toBe(false)
    /** The record as it now stands on disk. */
    const ended = readTeam(h.workspace, team.teamId)
    expect(ended?.phase).toBe("ended")
    expect(ended?.endedAt).toBe(reply.endedAt)
    expect(ended?.archivedReason).toBe("the wave landed")
  })

  test("after the end the team resolves for nobody, and the stale index binding cannot win", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The member handle the record kept, which is the member session's own id. */
    const memberHandle = String(team.members[0]?.executorRef ?? "")
    expect(memberHandle).not.toBe("")
    // Before the end the Lead really does resolve the team, so the "after" assertions are not vacuous.
    expect(h.service).toBeDefined()
    expect(h.service?.active(h.workspace, h.leadSession)?.teamId).toBe(team.teamId)
    await h.call("agent_teams_control", { action: "end" })
    // BOTH SEATS: the Lead and the member each fall through to no team — the ended record is filtered
    // by the lifecycle's liveness rule, not merely hidden from one render.
    expect(h.service?.active(h.workspace, h.leadSession)).toBeUndefined()
    expect(h.service?.active(h.workspace, memberHandle)).toBeUndefined()
    // THE BINDING IS STILL ON DISK, which is the point: `end` stamps the RECORD, and resolution is what
    // refuses a terminal team. The arm therefore proves the filter, not a hand-cleared index.
    expect(activeTeamId(h.workspace, h.leadSession)).toBe(team.teamId)
    /** The Lead's status answer, which must show no team at all. */
    const status = await h.call("agent_teams_plan", { action: "status" })
    expect(status.team).toBeNull()
  })

  test("a member and a stranger are refused, and a refusal writes nothing", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The member session's own id, recorded as the member's executor handle. */
    const memberHandle = String(team.members[0]?.executorRef ?? "")
    /** The member's refusal. */
    let memberRefusal: Error | undefined
    try {
      await h.callAs("agent_teams_control", { action: "end" }, memberHandle)
    } catch (error) {
      memberRefusal = error as Error
    }
    expect(memberRefusal?.message).toContain("only the Lead")
    expect(memberRefusal?.message).toContain("is a member, not the Lead")
    /** The stranger's refusal, which names the missing roster fact instead. */
    let strangerRefusal: Error | undefined
    try {
      await h.callAs("agent_teams_control", { action: "end", team_id: team.teamId }, "sess-stranger")
    } catch (error) {
      strangerRefusal = error as Error
    }
    expect(strangerRefusal?.message).toContain("only the Lead")
    expect(strangerRefusal?.message).toContain("not on the team's roster")
    // NEITHER REFUSAL TOUCHED THE RECORD: `endedAt` is absent and the team is still live.
    expect(readTeam(h.workspace, team.teamId)?.endedAt).toBeUndefined()
    expect(h.service?.active(h.workspace, h.leadSession)?.teamId).toBe(team.teamId)
  })

  test("end is a reported no-op on a repeat, and it never restamps the audit trail", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    await h.call("agent_teams_control", { action: "end", reason: "the wave landed" })
    /** A sentinel instant planted on the record, so a restamp by the repeat would be visible. */
    const sentinel = "2020-01-01T00:00:00.000Z"
    /** The stored record with the sentinel in place of the real ending instant. */
    const planted = readTeam(h.workspace, team.teamId) as TeamRecord
    writeTeam(h.workspace, { ...planted, endedAt: sentinel })
    /** The repeat, with a different reason that must NOT replace the stored one. */
    const repeat = await h.call("agent_teams_control", { action: "end", team_id: team.teamId, reason: "a retry with a new story" })
    expect(repeat.changed).toBe(false)
    expect(repeat.endedAt).toBe(sentinel)
    expect(repeat.reason).toBe("the wave landed")
    /** The record after the repeat, which keeps every value the first ending wrote. */
    const after = readTeam(h.workspace, team.teamId)
    expect(after?.endedAt).toBe(sentinel)
    expect(after?.archivedReason).toBe("the wave landed")
    expect(after?.phase).toBe("ended")
  })

  test("an end with no reason stores the default sentence", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The close, with no reason at all. */
    const reply = await h.call("agent_teams_control", { action: "end" })
    expect(reply.changed).toBe(true)
    expect(reply.reason).toBe("ended by the team Lead")
    expect(readTeam(h.workspace, team.teamId)?.archivedReason).toBe("ended by the team Lead")
  })

  test("a declared id that names no team is refused", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await approvedWave(h)
    /** The refusal, captured because a tool refusal is a thrown sentence. */
    let refusal: Error | undefined
    try {
      await h.call("agent_teams_control", { action: "end", team_id: "team-does-not-exist" })
    } catch (error) {
      refusal = error as Error
    }
    expect(refusal?.message).toContain("no team record is named")
  })

  test("B1 (F-B/CWE-863): a roster member that records the Lead as parentSession is refused all the same", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The member session's own id, recorded as the member's executor handle. */
    const memberHandle = String(team.members[0]?.executorRef ?? "")
    // THE BYPASS SHAPE: a member session whose header carries the Lead as `parentSession` but NO
    // `origin`/`delegationDepth` — exactly the shape `where()` cannot classify as a delegation child.
    /** The refusal for that shape. */
    const parentOnly = await refusalOf(() => h.callAs("agent_teams_control", { action: "end" }, memberHandle, { parentSession: h.leadSession }))
    expect(parentOnly).toContain("only the Lead")
    expect(parentOnly).toContain("is a member, not the Lead")
    // THE TWO SHAPES `where()` already identified as delegated children stay refused (controls).
    /** The refusal when the harness stamped `origin: "subagent"`. */
    const subagentOrigin = await refusalOf(() => h.callAs("agent_teams_control", { action: "end" }, memberHandle, { parentSession: h.leadSession, origin: "subagent" }))
    expect(subagentOrigin).toContain("is a member, not the Lead")
    /** The refusal when the harness stamped a delegation depth. */
    const delegationDepth = await refusalOf(() => h.callAs("agent_teams_control", { action: "end" }, memberHandle, { parentSession: h.leadSession, delegationDepth: 1 }))
    expect(delegationDepth).toContain("is a member, not the Lead")
    // NO REFUSAL TOUCHED THE RECORD: it is still live and still resolves for its Lead.
    expect(readTeam(h.workspace, team.teamId)?.endedAt).toBeUndefined()
    expect(h.service?.active(h.workspace, h.leadSession)?.teamId).toBe(team.teamId)
  })

  test("B1 control: a forked/resumed Lead that names NO member row keeps its recorded lineage", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // A FORK is not on the roster: its id is new, and the Lead's own session is its recorded parent.
    /** The fork's close, which must succeed through the C7-4 lineage. */
    const reply = await h.callAs("agent_teams_control", { action: "end", reason: "fork closed the wave" }, "sess-lead-fork", { parentSession: h.leadSession })
    expect(reply.changed).toBe(true)
    expect(reply.teamId).toBe(team.teamId)
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("ended")
  })

  test("M1: a default-target repeat reports the first ending instead of refusing", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The first, default-target ending. */
    const first = await h.call("agent_teams_control", { action: "end", reason: "the wave landed" })
    expect(first.changed).toBe(true)
    // THE REPEAT NAMES NO TEAM: live resolution finds none (the record is terminal), so the bound index
    // entry is what lets the verb report the no-op instead of "no team record in this workspace".
    /** The repeat of the very same call. */
    const repeat = await h.call("agent_teams_control", { action: "end" })
    expect(repeat.changed).toBe(false)
    expect(repeat.teamId).toBe(team.teamId)
    expect(repeat.endedAt).toBe(first.endedAt)
    expect(repeat.reason).toBe("the wave landed")
  })

  test("N1: the ending appends ONE team-journal row, and the record stays as history", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    expect(readTeamJournal(h.workspace).filter((row) => row.teamId === team.teamId)).toEqual([])
    await h.call("agent_teams_control", { action: "end", reason: "the wave landed" })
    /** The journal rows this team has after the ending. */
    const rows = readTeamJournal(h.workspace).filter((row) => row.teamId === team.teamId)
    expect(rows.length).toBe(1)
    expect(rows[0]?.event).toBe("team-ended")
    expect(rows[0]?.reason).toBe("the wave landed")
    // The idempotent repeat must NOT append a second row: history says the team ended once.
    await h.call("agent_teams_control", { action: "end" })
    expect(readTeamJournal(h.workspace).filter((row) => row.teamId === team.teamId).length).toBe(1)
    // THE RECORD IS HISTORY, NOT GONE: the ended team is still listed for every reader that wants it.
    expect(listTeams(h.workspace).some((record) => record.teamId === team.teamId && record.phase === "ended")).toBe(true)
  })

  test("N2: a workspace halt SURVIVES the end, and resume is the only verb that lifts it", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // A HALT IS WORKSPACE-WIDE, not team-scoped. Ending ONE team must not lift a pause that also
    // protects every other team of the same workspace, so the hold is left in place by design.
    await h.call("agent_teams_control", { action: "halt", reason: "pause the workspace" })
    await h.call("agent_teams_control", { action: "end", reason: "close one team" })
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("ended")
    /** The status answer after the end, whose `hold` must still be the workspace pause. */
    const held = await h.call("agent_teams_plan", { action: "status" })
    expect(held.hold?.reason).toBe("pause the workspace")
    /** The explicit resume, which is the ONLY supported way to lift the workspace pause. */
    const resumed = await h.call("agent_teams_control", { action: "resume" })
    expect(resumed.resumed).toBe(true)
    /** The status answer after the resume, with no hold left. */
    const cleared = await h.call("agent_teams_plan", { action: "status" })
    expect(cleared.hold).toBeNull()
  })

  test("N3: a declared id authorizes by RECORD, not by the index binding", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // THE BINDING IS REMOVED FIRST: a repair target must not depend on `teams.json` still naming it.
    expect(unbindActiveTeam(h.workspace, h.leadSession)).toBe(true)
    /** The unbound Lead's declared-id close. */
    const reply = await h.call("agent_teams_control", { action: "end", team_id: team.teamId, reason: "unbound repair" })
    expect(reply.changed).toBe(true)
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("ended")
  })

  test("N3 negative control: the Lead of ANOTHER team cannot end this one by declaring its id", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The first team, led by the harness's Lead session. */
    const first = await approvedWave(h)
    /** The second team, led by a DIFFERENT session in the same workspace. */
    const second = await approvedWaveAs(h, "sess-lead-2")
    // A declared id is NOT an authority: the second Lead names the first team and is refused.
    /** The second Lead's refusal on the first team. */
    const refused = await refusalOf(() => h.callAs("agent_teams_control", { action: "end", team_id: first.teamId }, "sess-lead-2"))
    expect(refused).toContain("only the Lead")
    expect(refused).toContain("not on the team's roster")
    // BOTH RECORDS UNCHANGED: the refused target is still live, and the caller's own team is untouched.
    expect(readTeam(h.workspace, first.teamId)?.endedAt).toBeUndefined()
    expect(readTeam(h.workspace, second.teamId)?.endedAt).toBeUndefined()
    // And the second Lead CAN end its OWN team, so the refusal above was about authority, not a broken verb.
    /** The second Lead's own close. */
    const own = await h.callAs("agent_teams_control", { action: "end", reason: "second wave landed" }, "sess-lead-2")
    expect(own.changed).toBe(true)
    expect(own.teamId).toBe(second.teamId)
  })
})
