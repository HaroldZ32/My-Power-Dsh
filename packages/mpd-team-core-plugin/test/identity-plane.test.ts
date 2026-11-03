// THE IDENTITY PLANE (T12 / review B3 A1): which session may act as a MEMBER, and which is a Lead fork.
//
// WHY THIS FILE EXISTS. The T8 repair narrowed the end verb for a member whose session id IS the
// record's `executorRef`. The reviewer then measured the ADJACENT shape: a RESUMED member (new session
// id, `executorRef` unchanged) whose header records the LEAD as `parentSession` with no `origin`/
// `delegationDepth` was read as a forked Lead — it could END the team (irreversible through this bundle)
// and, on the pre-existing write path, append to the live roster while `healLeadBinding` promoted it into
// `leadHistory`. The root cause was an id-only member guard plus a title fallback that compared the
// persona title against the stored WORKMATE SLUG.
//
// The contract these arms pin is `team-store.ts#memberIdentityOf`, the ONE narrowing both
// `index.ts#callerIdentity` and `team-actions.ts#leadAuthorityOf` now call:
//   own id → recorded ancestor → persona title over the seat's ROLE, then its STORED NAME.
// The longest title match wins (T16 N1: `Plan Reviewer` beats `Reviewer` for its own title), a genuine
// tie at the same specificity stays fail-closed, and the stored-name arm is the SEAT'S OWN stored name —
// the workmate slug for a W3-C-bound seat — not "never the slug" (T16 N2). A genuine fork remains a
// Lead fork.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index"
import { listTeams, memberIdentityOf, readTeam, type TeamMemberRecord, type TeamRecord } from "../src/team-store"

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
  /** The `mpdTeams` service the plugin published. */
  service: MpdTeamsService | undefined
  /** Drive one registered tool as the given session, with optional header facts. */
  callAs: (name: string, args: unknown, sessionId: string, header?: Record<string, unknown>) => Promise<Record<string, any>>
}

/** The persona title the harness stamps on a Senior Engineer seat's session. */
const PERSONA_TITLE = "You are the Senior Engineer, the roster's implementation specialist; ..."

/**
 * Build the harness: the real plugin applied against a stub executor.
 * @returns the harness an arm drives.
 */
function harness(): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-identity-"))
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
      // The meter seam answers the adapter's own empty reading, so `context` stays lossless JSON.
      if (prop === "contextPressure") return () => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" })
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  /** The service the plugin published, read through the harness field. */
  let service: MpdTeamsService | undefined
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdRoles" ? { list: () => [] } : undefined),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: noop,
  }
  apply(ctx as never)
  /**
   * Call one tool as one session.
   * @param name - the tool name.
   * @param args - its arguments.
   * @param sessionId - the calling session.
   * @param header - extra session-header facts (`parentSession`, `title`, `origin`, `delegationDepth`).
   * @returns the tool body's value.
   */
  const callAs = async (name: string, args: unknown, sessionId: string, header: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    /** The registered tool, or a thrown error naming what WAS registered. */
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
    /** The exec payload: session id plus the header facts the lineage/title readers consult. */
    const exec = { agent: { session: { id: sessionId, header: { cwd: workspace, ...header } } }, signal: undefined }
    return await tool.execute(args, exec) as Record<string, any>
  }
  return {
    workspace,
    leadSession: "sess-lead",
    callAs,
    /** The published service; `apply` assigned it before this literal is read. */
    get service(): MpdTeamsService | undefined { return service },
  }
}

/**
 * Stage and approve a wave with the given roster, as one Lead session.
 * @param h - the harness under test.
 * @param members - the roster rows to stage, in order.
 * @returns the team record the approval wrote.
 */
async function approvedWave(h: Harness, members: Array<{ name: string; role?: string }> = [{ name: "Engineer", role: "Senior Engineer" }]): Promise<TeamRecord> {
  await h.callAs("agent_teams_plan", { action: "create", name: "identity-wave", description: "probe" }, h.leadSession)
  for (const member of members) {
    await h.callAs("agent_teams_plan", { action: "add_member", member: { name: member.name, description: "implements", prompt: "You implement.", ...(member.role === undefined ? {} : { role: member.role }) } }, h.leadSession)
  }
  await h.callAs("agent_teams_plan", { action: "create_task", task: { subject: "work", description: "do it", blocked_by: [], owner: members[0]?.name } }, h.leadSession)
  /** The approve reply, whose `team` is the record it built. */
  const reply = await h.callAs("agent_teams_plan", { action: "approve" }, h.leadSession)
  return reply.team as TeamRecord
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

/** A handoff document that satisfies the seven-section contract. */
const HANDOFF = ["## Task", "x", "## State", "x", "## Decisions", "x", "## Artifacts", "x", "## Verified facts", "x", "## Open questions", "x", "## Next step", "x"].join("\n")

/** Every sandbox one arm created, removed even when the arm fails. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe("memberIdentityOf — the ONE narrowing", () => {
  /** A crafted record whose seat name is the W3-C workmate slug, exactly what defeats a title compare. */
  const member: TeamMemberRecord = { id: "M1", name: "senior-engineer-1", description: "implements", role: "Senior Engineer", status: "running", spawnedAt: "2026-11-03T00:00:00.000Z", executorRef: "child-senior-engineer-1" }
  /** A one-seat record built around that row. */
  const record = {
    version: 1 as const, teamId: "team-x", name: "w", description: "d", leadSessionId: "sess-lead",
    phase: "active" as const, createdAt: "2026-11-03T00:00:00.000Z", members: [member], tasks: [], nextMemberNumber: 2, nextTaskNumber: 1,
  }

  test("the own id and the recorded executorRef name the member", () => {
    expect(memberIdentityOf(record, "senior-engineer-1").member?.id).toBe("M1")
    expect(memberIdentityOf(record, "child-senior-engineer-1").member?.id).toBe("M1")
  })

  test("a recorded ANCESTOR that is the member's handle names it (a resumed member's own header)", () => {
    /** The resumed session's own id, which appears nowhere on the record. */
    const identity = memberIdentityOf(record, "member-resumed-77", "", ["child-senior-engineer-1"])
    expect(identity.member?.id).toBe("M1")
    expect(identity.named).toBe(true)
  })

  test("a persona title names the seat by its ROLE first, then by the seat's OWN stored name", () => {
    // ROLE first: the persona title the harness stamps carries the roster role.
    expect(memberIdentityOf(record, "member-resumed-77", PERSONA_TITLE).member?.id).toBe("M1")
    // THE STORED-NAME ARM, ASSERTED BOTH WAYS (T16 N2): the seat's ACTUAL stored name — the W3-C workmate
    // slug — DOES name it when a title contains it (the rule is "the seat's stored name", not "never the
    // slug"); a DIFFERENT seat's slug names nothing.
    expect(memberIdentityOf(record, "member-resumed-77", "You are senior-engineer-1, ...").member?.id).toBe("M1")
    expect(memberIdentityOf(record, "member-resumed-77", "You are senior-engineer-9, ...").named).toBe(false)
  })

  test("LONGEST match wins when one role is a strict substring of another (T16 N1)", () => {
    /** A Reviewer seat and a Plan Reviewer seat — the overlapping-role roster the reviewer measured. */
    const reviewer: TeamMemberRecord = { ...member, id: "M1", name: "reviewer-1", role: "Reviewer", executorRef: "child-reviewer-1" }
    /** The longer, more specific seat. */
    const planReviewer: TeamMemberRecord = { ...member, id: "M2", name: "plan-reviewer-1", role: "Plan Reviewer", executorRef: "child-plan-reviewer-1" }
    /** The two-seat record. */
    const overlap = { ...record, members: [reviewer, planReviewer], nextMemberNumber: 3 }
    // The Plan Reviewer's title contains BOTH texts; the 13-character role is more specific than the
    // 8-character one, so the seat is NAMED instead of being locked out as ambiguous.
    expect(memberIdentityOf(overlap, "member-resumed-77", "You are the Plan Reviewer, ...").member?.id).toBe("M2")
    // The Reviewer's own title contains only the shorter role, so it is unambiguous as before.
    expect(memberIdentityOf(overlap, "member-resumed-77", "You are the Reviewer, ...").member?.id).toBe("M1")
  })

  test("CR1: a RECORDED Lead's title never hands it a member row", () => {
    // The captain's persona text is not ours to constrain; a roster role/seat name in it must never
    // replace the captain identity (the mailbox would otherwise address the Lead by a MEMBER id).
    /** The lead session named by the record's own `leadSessionId`. */
    const current = memberIdentityOf(record, "sess-lead", PERSONA_TITLE)
    expect(current.named).toBe(false)
    expect(current.member).toBeUndefined()
    /** A churned Lead recorded in `leadHistory` gets the same exclusion. */
    const churned = memberIdentityOf({ ...record, leadHistory: ["lead-fork-2"] }, "lead-fork-2", PERSONA_TITLE)
    expect(churned.named).toBe(false)
    expect(churned.member).toBeUndefined()
    // CONTROL: the same title on a non-Lead session still names the seat.
    expect(memberIdentityOf(record, "member-resumed-77", PERSONA_TITLE).member?.id).toBe("M1")
  })

  test("an AMBIGUOUS title names a member but picks no row, and a foreign title names none", () => {
    /** A second seat sharing the same role, so the title matches two rows. */
    const twin: TeamMemberRecord = { ...member, id: "M2", name: "senior-engineer-2", executorRef: "child-senior-engineer-2" }
    /** The two-seat record. */
    const pair = { ...record, members: [member, twin], nextMemberNumber: 3 }
    /** The ambiguous reading. */
    const ambiguous = memberIdentityOf(pair, "member-resumed-77", PERSONA_TITLE)
    expect(ambiguous.named).toBe(true)
    expect(ambiguous.member).toBeUndefined()
    expect(memberIdentityOf(record, "sess-x", "You are the captain's fork.").named).toBe(false)
  })
})

describe("a RESUMED member is a member on every Lead-gated path", () => {
  test("T1: it cannot end the team (the reviewer's shape)", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // The reviewer's measured shape: a NEW id, the LEAD as the recorded parent, and the persona title.
    /** The refusal for the resumed member's end. */
    const refusal = await refusalOf(() => h.callAs("agent_teams_control", { action: "end" }, "member-resumed-77", { parentSession: h.leadSession, title: PERSONA_TITLE }))
    expect(refusal).toContain("only the Lead")
    expect(refusal).toContain("is a member, not the Lead")
    // THE RECORD IS UNTOUCHED, and no heal ran on this path.
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("active")
    expect(readTeam(h.workspace, team.teamId)?.endedAt).toBeUndefined()
    expect(readTeam(h.workspace, team.teamId)?.leadHistory ?? []).toEqual([])
  })

  test("T1 (ambiguous): the title names a member, so it still cannot end the team", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** Two seats with the SAME role, so the persona title cannot pick one. */
    const team = await approvedWave(h, [{ name: "Engineer", role: "Senior Engineer" }, { name: "Engineer Two", role: "Senior Engineer" }])
    /** The refusal for the ambiguous resumed session. */
    const refusal = await refusalOf(() => h.callAs("agent_teams_control", { action: "end" }, "member-resumed-77", { parentSession: h.leadSession, title: PERSONA_TITLE }))
    expect(refusal).toContain("on the team's roster, not its Lead")
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("active")
  })

  test("T16 edge: the Plan Reviewer's own title names its seat (longest match), and it is still a member", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** Two seats whose roles overlap as substrings. */
    const team = await approvedWave(h, [{ name: "Rev", role: "Reviewer" }, { name: "PlanRev", role: "Plan Reviewer" }])
    /** The Plan Reviewer seat's stored name. */
    const planSeat = String(team.members[1]?.name ?? "")
    expect(planSeat).not.toBe("")
    // BEFORE T16 this title matched BOTH roles, so the resumed Plan Reviewer was seat-less (named, no row).
    /** The resumed Plan Reviewer's seat reading. */
    const context = await h.callAs("agent_teams_task", { action: "context" }, "member-resumed-plan", { parentSession: h.leadSession, title: "You are the Plan Reviewer, the roster's ..." })
    expect(context.member).toBe(planSeat)
    // And it is still a MEMBER: naming its seat never grants captaincy on the irreversible verb.
    /** The resumed Plan Reviewer's attempted end. */
    const refusal = await refusalOf(() => h.callAs("agent_teams_control", { action: "end" }, "member-resumed-plan", { parentSession: h.leadSession, title: "You are the Plan Reviewer, the roster's ..." }))
    expect(refusal).toContain("only the Lead")
    expect(refusal).toContain("is a member, not the Lead")
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("active")
  })

  test("CR1: the Lead's mailbox address stays the captain's when its title names a seat", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // The Lead's persona title contains the roster role; before the CR1 guard `memberIdentityOf` handed
    // it the member row, so `callerAddress` (and therefore the mailbox `memberName`) became the MEMBER's.
    /** The Lead's own inbox reading, whose `memberName` is the durable address the tool acted under. */
    const inbox = await h.callAs("agent_teams_mail", { action: "unread" }, h.leadSession, { title: PERSONA_TITLE })
    expect(inbox.memberName).toBe(team.leadSessionId)
    expect(inbox.memberName).not.toBe(String(team.members[0]?.name ?? ""))
  })

  test("T5: it cannot append to the live roster, and the churn heal does not promote it", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The roster as the approval left it — the comparison is "unchanged", not a hard-coded name. */
    const before = (readTeam(h.workspace, team.teamId)?.members ?? []).map((row) => row.name)
    /** The resumed member's roster append, which must refuse. */
    const refusal = await refusalOf(() => h.callAs("agent_teams_plan", { action: "add_member", member: { name: "Sneak", description: "x", prompt: "y" } }, "member-resumed-77", { parentSession: h.leadSession, title: PERSONA_TITLE }))
    expect(refusal).toContain("only the Lead")
    expect(refusal).toContain("may append")
    /** The record after the refusal: no new seat, and no Lead promotion. */
    const after = readTeam(h.workspace, team.teamId)
    expect(after?.members.map((row) => row.name)).toEqual(before)
    expect(after?.leadHistory ?? []).toEqual([])
  })

  test("the resumed session still resolves to its MEMBER ROW (context, title arm)", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built (the W3-C binding may have renamed the seat, so read the record). */
    const team = await approvedWave(h)
    /** The seat's stored name, which the seat reading must return. */
    const seatName = String(team.members[0]?.name ?? "")
    expect(seatName).not.toBe("")
    // `context` answers the caller's own seat from the SHARED narrowing, so the resumed member sees its row.
    /** The resumed member's seat reading. */
    const context = await h.callAs("agent_teams_task", { action: "context" }, "member-resumed-77", { parentSession: h.leadSession, title: PERSONA_TITLE })
    expect(context.member).toBe(seatName)
  })

  test("the resumed session can write its OWN handoff (ancestor arm)", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    /** The member's recorded executor handle, which a resumed session's header may name as its parent. */
    const handle = String(team.members[0]?.executorRef ?? "")
    expect(handle).not.toBe("")
    /** The seat's stored name, which the handoff reply must return. */
    const seatName = String(team.members[0]?.name ?? "")
    // The resume shape the harness records itself: the member's old session is the recorded parent.
    /** The resumed member's own handoff. */
    const reply = await h.callAs("agent_teams_task", { action: "handoff", content: HANDOFF }, "member-resumed-77", { parentSession: handle })
    expect(reply.member).toBe(seatName)
    expect(reply.mode).toBe("checkpoint")
    expect(readTeam(h.workspace, team.teamId)?.members[0]?.mode).toBe("checkpoint")
  })

  test("a GENUINE fork (no roster text) still ends the team", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    /** The live team the approval built. */
    const team = await approvedWave(h)
    // The fork is not on the roster and its title names no seat; it keeps the C7-4 Lead lineage.
    /** The fork's close. */
    const reply = await h.callAs("agent_teams_control", { action: "end", reason: "fork closed it" }, "sess-lead-fork", { parentSession: h.leadSession, title: "You are the captain's fork." })
    expect(reply.changed).toBe(true)
    expect(readTeam(h.workspace, team.teamId)?.phase).toBe("ended")
    // And the ended team is gone from live resolution for everyone.
    expect(h.service?.active(h.workspace, h.leadSession)).toBeUndefined()
    expect(listTeams(h.workspace).find((row) => row.teamId === team.teamId)?.phase).toBe("ended")
  })
})
