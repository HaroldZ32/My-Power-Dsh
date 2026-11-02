// THE TEAM TOOLCHAIN COMPLETION (contract `.mpd/plans/autoproject-refactor.md` §4.4, wave W1-A).
//
// WHAT THIS FILE PROVES, arm by arm, because each one is a capability the NEXT wave deletes from
// `packages/mpd-cellwork-plugin` and calls HERE instead:
//   1. a version-1 staged plan is READ (lifted to version 2), never discarded — the R1 blocker;
//   2. owner-only pairing is the DEFAULT: a busy / fenced / ownerless row is REPORTED and left pending,
//      and `mode:"roster"` is the only way back to the positional rule;
//   3. `reassign` claims a row for a new member on the BOARD, journals `task-reassigned`, then delivers;
//   4. `fence`/`unfence` round-trip through the record and the journal, and a fenced seat is never
//      messaged; a member's `handoff` writes its document and moves the seat into the checkpoint window;
//   5. `memberContext` / `depthBudget` / `archivedPlans` answer on an EMPTY workspace without throwing,
//      and never guess a window the meter did not report.
//
// EVERY ARM READS THE STORE FILES (or the journal), not only the reply: a reply can claim a hand-over
// while the record on disk still names the old owner.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply, type MpdTeamsService } from "../src/index"
import { fenceMember, runDispatch, unfenceMember, writeMemberHandoff, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { addMember, addTask, archivePlan, listArchivedPlans, readPlan, stagePlan, writePlan } from "../src/plan-store"
import { activeTeamId, addTeamMember, addTeamTask, createTeam, listTeams, memberIsCheckpoint, memberNamedBy, readTeam, updateTeamMember, updateTeamTask, writeTeam, type TeamRecord } from "../src/team-store"
import { readTeamJournal } from "../src/team-journal"
import { planDispatch, type DispatchMember, type DispatchTask } from "../src/dispatch"
import type { DshTeamExecutor, DshTeamSpawnRequest } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The instant every store write in this file is stamped with. */
const NOW = new Date("2026-11-02T03:00:00.000Z")
/** The session that leads every seeded team. */
const LEAD = "lead-toolchain"
/** The live agent a dispatch pass needs (a pass with no agent refuses before writing). */
const AGENT = { session: { id: LEAD, header: {} } }
/** The workspace team id every seeded team uses unless an arm says otherwise. */
const TEAM_ID = "team-toolchain"

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * One sandbox workspace, registered for cleanup.
 * @returns the absolute workspace path.
 */
function sandbox(): string {
  /** The fresh temporary directory this arm owns. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-toolchain-"))
  sandboxes.push(workspace)
  return workspace
}

/** Everything one fixture observed through the seams the actions call. */
interface Observed {
  /** The sandbox workspace the stores write into. */
  workspace: string
  /** One entry per delivered dispatch message: `<handle>:<content>`. */
  sent: string[]
}

/**
 * Build the deps bundle the team actions receive: real stores, a recording executor, no cordis context.
 * @returns the observations and the deps bundle.
 */
function fixture(): { observed: Observed; deps: TeamActionDeps } {
  /** The sandbox this arm's stores write into. */
  const workspace = sandbox()
  /** What the seams observed. */
  const observed: Observed = { workspace, sent: [] }
  /** The executor double: it raises members under a predictable handle and records every delivery. */
  const executor: DshTeamExecutor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: DshTeamSpawnRequest): Promise<{ handle: string; executor: "native" }> => ({ handle: "child-" + request.name.replace(/\s+/g, "-"), executor: "native" }),
    send: async (_caller: unknown, handle: string, content: string): Promise<void> => { observed.sent.push(`${handle}:${content}`) },
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  return {
    observed,
    deps: {
      now: () => NOW,
      executor: () => executor,
      bundleApprovalEffects: async (): Promise<void> => {},
      deriveParentTeam: (): undefined => undefined,
      // THE ROW'S OWN RESOLUTION, reduced to what these arms read: the Lead's bound team, or a team
      // whose roster names the caller's session (a member resolving its own team, as it does live).
      resolveTeam: (space: string, sessionId: string) => {
        /** The team bound to this session as its Lead, when the index has one. */
        const bound = activeTeamId(space, sessionId)
        /** The bound record, re-read from disk. */
        const boundRecord = bound === undefined ? undefined : readTeam(space, bound)
        if (boundRecord !== undefined) return { record: boundRecord }
        /** The team whose DURABLE roster names this session (the member-resolution arm). */
        const memberOf = listTeams(space).find((record) => memberNamedBy(record, [sessionId]) !== undefined)
        return memberOf === undefined
          ? { refusal: "no team record in this workspace — approve a plan first" }
          : { record: memberOf }
      },
      readWatchdogHold: () => ({ state: "free" }),
      // THE CONFIG SEAM IS ABSENT ON PURPOSE in the depth arm, so the read proves the documented default.
      service: (): undefined => undefined,
      log: (): void => {},
      beginDispatch: () => (): void => {},
      assertPlanGraph: (): void => {},
      assertScopesOrdered: (): void => {},
    },
  }
}

/**
 * Seed one approved team: every member idle under its own executor handle, every task pending.
 *
 * The members are written `inactive` because that is the state an approved plan settles into, and the
 * one the dispatch pass reads as free.
 * @param workspace - the sandbox the record is written into.
 * @param input - the member names and the task rows (subject + optional owner).
 * @returns the record as written.
 */
function seedTeam(
  workspace: string,
  input: { members: string[]; tasks: Array<{ subject: string; owner?: string; blockedBy?: string[] }> },
): TeamRecord {
  /** The record as it grows through the store. */
  let record = createTeam(workspace, { teamId: TEAM_ID, name: "the wave", description: "toolchain arms", leadSessionId: LEAD }, NOW)
  for (const name of input.members) record = addTeamMember(record, { name, description: "a seat" }, NOW)
  for (const task of input.tasks) {
    record = addTeamTask(record, { subject: task.subject, description: "the acceptance text", blockedBy: [...(task.blockedBy ?? [])], ...(task.owner === undefined ? {} : { owner: task.owner }) }, NOW)
  }
  /** The record as an approval leaves it: members settled and spawned under predictable handles. */
  const approved: TeamRecord = {
    ...record,
    approvedAt: NOW.toISOString(),
    phase: "active",
    members: record.members.map((member) => ({ ...member, status: "inactive" as const, executorRef: "sess-" + member.name })),
  }
  writeTeam(workspace, approved)
  return approved
}

/**
 * The caller a tool call for one session would build.
 * @param workspace - the workspace the action acts in.
 * @param sessionId - the acting session.
 * @param live - whether it carries a live agent (a dispatch pass refuses without one).
 * @returns the caller value.
 */
function callerOf(workspace: string, sessionId: string, live: boolean): TeamActionCaller {
  return { workspace, sessionId, lineage: [], ...(live ? { agent: AGENT } : {}) }
}

/** One ready board row, in the dispatch engine's shape. */
const readyTask = (id: string, owner?: string): DispatchTask => ({ id, subject: "task " + id, status: "pending", ready: true, ...(owner === undefined ? {} : { ownerName: owner }) })

/** One idle roster member, in the dispatch engine's shape. */
const idleMember = (name: string): DispatchMember => ({ id: "sess-" + name, name, status: "inactive" })

describe("the staged plan's version", () => {
  test("a version-1 staged plan is READ and lifted, never discarded", () => {
    /** The sandbox whose staging slot is planted. */
    const workspace = sandbox()
    // PLANTED AS BYTES, exactly as a plan staged by the previous release sits on disk today.
    mkdirSync(join(workspace, ".mpd", "team", "staging"), { recursive: true })
    writeFileSync(join(workspace, ".mpd", "team", "staging", "sess-old.json"), JSON.stringify({
      version: 1, planId: "plan-old", sessionId: "sess-old", name: "old wave", description: "staged before v2",
      approval: "required", members: [], tasks: [], stagedAt: NOW.toISOString(),
    }))
    /** The plan the compatibility arm reads back. */
    const old = readPlan(workspace, "sess-old")
    // THE R1 BLOCKER: this used to answer `undefined`, so an in-flight plan became invisible to status
    // and to approval until a human deleted the file.
    expect(old?.planId).toBe("plan-old")
    expect(old?.name).toBe("old wave")
    expect(old?.version).toBe(2)
    // A NEW plan is written at the current version and round-trips.
    /** The freshly staged plan. */
    const fresh = stagePlan(workspace, "sess-new", { name: "new wave", description: "staged now", approval: "required" }, NOW)
    expect(fresh.version).toBe(2)
    expect(readPlan(workspace, "sess-new")?.planId).toBe(fresh.planId)
    // THE ARM IS NOT "ACCEPT EVERYTHING": an unknown format version is still refused.
    writeFileSync(join(workspace, ".mpd", "team", "staging", "sess-future.json"), JSON.stringify({ version: 9, planId: "plan-future", sessionId: "sess-future", name: "x", description: "", approval: "required", members: [], tasks: [], stagedAt: NOW.toISOString() }))
    expect(readPlan(workspace, "sess-future")).toBeUndefined()
  })
})

describe("owner-only dispatch is the DEFAULT", () => {
  test("a BUSY owner is reported and the row left pending; mode:\"roster\" restores the substitution", () => {
    /** A ledger row that already books the task's declared owner. */
    const ledger = { "team-toolchain::T0": { teamId: TEAM_ID, taskId: "T0", memberId: "sess-worker", memberName: "worker", assignedAt: NOW.toISOString() } }
    /** The default pass: the owner is busy, so nobody may take the row. */
    const ownerOnly = planDispatch({ tasks: [readyTask("T1", "worker")], members: [idleMember("worker"), idleMember("other")], ledger })
    expect(ownerOnly.pairs).toEqual([])
    expect(ownerOnly.skipped[0]?.reason).toContain("is BUSY on another task")
    // THE EXPLICIT FALLBACK is the only way to the old behaviour, and it still REPORTS the substitution.
    /** The same pass under the explicit roster rule. */
    const roster = planDispatch({ tasks: [readyTask("T1", "worker")], members: [idleMember("worker"), idleMember("other")], ledger, mode: "roster" })
    expect(roster.pairs.map((pair) => pair.memberName)).toEqual(["other"])
    expect(roster.pairs[0]?.note).toContain("already working another task")
  })

  test("a FENCED owner is never messaged, and the skip names the reassign repair", () => {
    /** The fenced seat the row declares as its owner. */
    const fenced: DispatchMember = { id: "sess-worker", name: "worker", status: "inactive", fenced: true, fencedReason: "the compaction barrier gave up" }
    /** The default pass over a row owned by that seat. */
    const plan = planDispatch({ tasks: [readyTask("T1", "worker")], members: [fenced, idleMember("other")], ledger: {} })
    expect(plan.pairs).toEqual([])
    expect(plan.skipped[0]?.reason).toContain("FENCED")
    expect(plan.skipped[0]?.reason).toContain("reassign")
    // THE ROSTER RULE MAY NOT MESSAGE IT EITHER: a fenced seat is not a candidate in any mode.
    /** The same pass under the explicit roster rule. */
    const roster = planDispatch({ tasks: [readyTask("T1", "worker")], members: [fenced, idleMember("other")], ledger: {}, mode: "roster" })
    expect(roster.pairs.map((pair) => pair.memberName)).toEqual(["other"])
  })

  test("a CHECKPOINT seat is treated as fenced, and an OWNERLESS row is reported instead of substituted", () => {
    /** A seat inside its handoff window. */
    const checkpoint: DispatchMember = { id: "sess-worker", name: "worker", status: "inactive", mode: "checkpoint" }
    /** The default pass over the checkpoint seat's row. */
    const fencing = planDispatch({ tasks: [readyTask("T1", "worker")], members: [checkpoint], ledger: {} })
    expect(fencing.pairs).toEqual([])
    expect(fencing.skipped[0]?.reason).toContain("checkpoint")
    /** The default pass over a row that declares no owner at all. */
    const ownerless = planDispatch({ tasks: [readyTask("T2")], members: [idleMember("worker")], ledger: {} })
    expect(ownerless.pairs).toEqual([])
    expect(ownerless.skipped[0]?.reason).toContain("declares no owner")
  })

  test("a live pass reports a fenced owner on the board's own record, and writes nothing", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker", "other"], tasks: [{ subject: "work", owner: "worker" }] })
    // Fence the declared owner through the service body, so the record — not the test — carries the state.
    /** The fence's outcome. */
    const fenced = await fenceMember(f.deps, callerOf(f.observed.workspace, LEAD, false), { member: "worker", reason: "barrier gave up" })
    expect(fenced.ok).toBe(true)
    /** The dispatch pass over the board. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), {})
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.pairs).toEqual([])
    expect(pass.skipped[0]?.reason).toContain("FENCED")
    // NOTHING WAS SENT, and the row is still pending: a report is not a dispatch.
    expect(f.observed.sent).toEqual([])
    expect(readTeam(f.observed.workspace, TEAM_ID)?.tasks[0]?.status).toBe("pending")
  })
})

describe("reassign — the repair the owner-only rule needs", () => {
  test("it claims the row for the target, journals task-reassigned, delivers, and books the ledger", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker", "rescue"], tasks: [{ subject: "work", owner: "worker" }] })
    /** The pass that hands the row over before its own pairing decision. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { reassign: [{ taskId: "T1", owner: "rescue" }] })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.reassigned).toEqual([{ taskId: "T1", owner: "rescue", claimed: true, delivered: true }])
    // THE BOARD MOVED: the record names the new owner and the row is in flight.
    /** The record as the hand-over left it. */
    const record = readTeam(f.observed.workspace, TEAM_ID)
    expect(record?.tasks[0]?.owner).toBe("rescue")
    expect(record?.tasks[0]?.status).toBe("in_progress")
    // THE JOURNAL ROW survives the record's own rewrite: it is the only durable history of the hand-over.
    /** The journal rows written by the arm. */
    const journal = readTeamJournal(f.observed.workspace)
    expect(journal.filter((row) => row.event === "task-reassigned")).toEqual([
      { event: "task-reassigned", teamId: TEAM_ID, at: NOW.toISOString(), taskId: "T1", member: "rescue", from: "worker" },
    ])
    // DELIVERED THROUGH THE EXECUTOR, and the ledger records the pairing so a later pass cannot repeat it.
    expect(f.observed.sent).toHaveLength(1)
    expect(f.observed.sent[0]).toContain("shared task T1: work")
    /** The next pass, which must report the row as already dispatched. */
    const again = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), {})
    if (!again.ok) throw new Error(again.error)
    expect(again.pairs).toEqual([])
    expect(again.skipped.map((row) => row.reason).join(" ")).toContain("already dispatched to rescue")
  })

  test("a DEAD or STILL-RAISING target is refused by name, and the row stays where it was", async () => {
    // THE REVIEWER'S probe-dead-target, as an arm: a seat whose raise FAILED can still carry an
    // `executorRef`, and delivering a row to it leaves the row `in_progress` with nobody working it.
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker", "dead"], tasks: [{ subject: "work", owner: "worker" }] })
    // The seat as a FAILED raise leaves it: the handle is still recorded, the status is not live.
    /** The record with the target's raise failed. */
    const failed = updateTeamMember(readTeam(f.observed.workspace, TEAM_ID) as TeamRecord, "dead", { status: "failed" })
    writeTeam(f.observed.workspace, failed)
    /** The hand-over to the dead seat. */
    // A DRY RUN: the refusal under test happens BEFORE the delivery gate, and a real pass would pair the
    // row with its declared owner afterwards — which is a different subject.
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { dryRun: true, reassign: [{ taskId: "T1", owner: "dead" }] })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.reassigned?.[0]).toMatchObject({ taskId: "T1", owner: "dead", claimed: false, delivered: false })
    // The refusal NAMES the seat and the repair, and nothing was delivered.
    expect(pass.reassigned?.[0]?.reason).toContain("FAILED to start")
    expect(f.observed.sent).toEqual([])
    // THE SAME REFUSAL for a seat still being raised.
    writeTeam(f.observed.workspace, updateTeamMember(readTeam(f.observed.workspace, TEAM_ID) as TeamRecord, "dead", { status: "provisioning" }))
    /** The hand-over to the still-raising seat. */
    const raising = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { dryRun: true, reassign: [{ taskId: "T1", owner: "dead" }] })
    if (!raising.ok) throw new Error(raising.error)
    expect(raising.reassigned?.[0]?.reason).toContain("still being raised")
    // THE ROW NEVER MOVED: still pending, still owned by the member the board declared.
    expect(readTeam(f.observed.workspace, TEAM_ID)?.tasks[0]).toMatchObject({ status: "pending", owner: "worker" })
  })

  test("a HALT refuses the hand-over too — a repair may not slip a delivery past the hold", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker", "rescue"], tasks: [{ subject: "work", owner: "worker" }] })
    // The workspace hold is the bundle's own pause record; the pass reads it before anything else.
    writeFileSync(join(f.observed.workspace, ".mpd", "team", "hold.json"), JSON.stringify({ version: 1, reason: "waiting for the user", heldAt: NOW.toISOString(), heldBy: LEAD }))
    /** The hand-over attempted under the hold. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { reassign: [{ taskId: "T1", owner: "rescue" }] })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.halted).toBe("waiting for the user")
    expect(pass.reassigned).toBeUndefined()
    expect(f.observed.sent).toEqual([])
    expect(readTeam(f.observed.workspace, TEAM_ID)?.tasks[0]?.owner).toBe("worker")
  })

  test("it refuses an in-progress row, an unknown row and a fenced target — reporting each, never throwing", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker", "rescue"], tasks: [{ subject: "work", owner: "worker" }, { subject: "later", owner: "worker" }] })
    // A DRY RUN decides nothing: the pending row is reported as unclaimed, and nothing is written.
    /** The preview pass. */
    const preview = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { dryRun: true, reassign: [{ taskId: "T2", owner: "rescue" }] })
    if (!preview.ok) throw new Error(preview.error)
    expect(preview.reassigned?.[0]).toMatchObject({ taskId: "T2", claimed: false, delivered: false })
    expect(preview.reassigned?.[0]?.reason).toContain("dry run")
    expect(readTeamJournal(f.observed.workspace)).toEqual([])
    // Put T1 in flight, then fence the rescue seat, so the hand-over meets both refusals.
    await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), {})
    await fenceMember(f.deps, callerOf(f.observed.workspace, LEAD, false), { member: "rescue", reason: "barrier gave up" })
    /** The hand-overs the board cannot honour. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), {
      reassign: [
        { taskId: "T1", owner: "rescue" },
        { taskId: "T9", owner: "rescue" },
        { taskId: "T2", owner: "rescue" },
      ],
    })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.reassigned?.map((row) => row.claimed)).toEqual([false, false, false])
    expect(pass.reassigned?.[0]?.reason).toContain("release it first")
    expect(pass.reassigned?.[1]?.reason).toContain("no board row is named")
    // THE TARGET IS CHECKED BEFORE THE CLAIM: a fenced seat is refused, never messaged.
    expect(pass.reassigned?.[2]?.reason).toContain("FENCED")
    // THE ONLY DELIVERY IS THE EARLIER PAIRING PASS: a refused hand-over sends nothing.
    expect(f.observed.sent).toHaveLength(1)
  })
})

describe("the seat verbs", () => {
  test("fence and unfence round-trip through the record and the journal", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker"], tasks: [{ subject: "work", owner: "worker" }] })
    /** The Lead's caller. */
    const lead = callerOf(f.observed.workspace, LEAD, false)
    /** The fence. */
    const fenced = await fenceMember(f.deps, lead, { member: "worker", reason: "the barrier gave up" })
    expect(fenced).toEqual({ ok: true, teamId: TEAM_ID, member: "worker", fenced: true, reason: "the barrier gave up" })
    expect(readTeam(f.observed.workspace, TEAM_ID)?.members[0]).toMatchObject({ fenced: true, fencedReason: "the barrier gave up" })
    // THE REASON IS REQUIRED TO BE MEANINGFUL, never a stale sentence: unfence DELETES both keys.
    /** The unfence. */
    const cleared = await unfenceMember(f.deps, lead, { member: "worker" })
    expect(cleared.ok).toBe(true)
    /** The seat after the fence was lifted. */
    const seat = readTeam(f.observed.workspace, TEAM_ID)?.members[0]
    expect(seat?.fenced).toBeUndefined()
    expect(seat?.fencedReason).toBeUndefined()
    expect(readTeamJournal(f.observed.workspace).map((row) => row.event)).toEqual(["member-fenced", "member-unfenced"])
  })

  test("only the Lead may fence, and an unknown seat is refused with its name", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker"], tasks: [] })
    /** A member's caller, which must not be able to park a teammate. */
    const member = await fenceMember(f.deps, callerOf(f.observed.workspace, "sess-worker", false), { member: "worker" })
    expect(member).toEqual({ ok: false, error: `only the Lead of team ${TEAM_ID} may fence a seat` })
    /** The Lead naming a seat that is not on the roster. */
    const unknown = await fenceMember(f.deps, callerOf(f.observed.workspace, LEAD, false), { member: "ghost" })
    expect(unknown.ok).toBe(false)
    expect(unknown.ok ? "" : unknown.error).toContain("no member")
  })

  test("a member's handoff writes the document, records it and fences the seat into the checkpoint window", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, { members: ["worker"], tasks: [{ subject: "work", owner: "worker" }] })
    /** The member's own caller: its session id IS the roster row's executor handle. */
    const member = callerOf(f.observed.workspace, "sess-worker", false)
    // AN INCOMPLETE DOCUMENT IS REFUSED, naming what is missing: that is the whole point of a handoff.
    /** The refusal the section contract answers with. */
    const partial = await writeMemberHandoff(f.deps, member, { content: "# Task\nship it" })
    expect(partial.ok).toBe(false)
    expect(partial.ok ? "" : partial.error).toContain("missing these sections")
    /** A complete handoff: every section the contract requires. */
    const document = [
      "# Task", "ship the row", "", "# State", "half done", "", "# Decisions", "kept it minimal", "",
      "# Artifacts", "packages/mpd-team-core-plugin/src/team-actions.ts", "", "# Verified facts", "the suite is green", "",
      "# Open questions", "none", "", "# Next step", "close the row",
    ].join("\n")
    /** The written handoff. */
    const written = await writeMemberHandoff(f.deps, member, { content: document })
    if (!written.ok) throw new Error(written.error)
    expect(written.ordinal).toBe(1)
    expect(existsSync(written.path)).toBe(true)
    expect(written.directive).toContain("END YOUR TURN NOW")
    expect(readTeam(f.observed.workspace, TEAM_ID)?.members[0]).toMatchObject({ mode: "checkpoint", handoff: { path: written.path, ordinal: 1 } })
    expect(readTeamJournal(f.observed.workspace).map((row) => row.event)).toEqual(["handoff-written"])
    // THE CHECKPOINT WINDOW IS A FENCE FOR DISPATCH: the pass reports the seat instead of waking it.
    /** The pass over the board after the handoff. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), {})
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.pairs).toEqual([])
    expect(pass.skipped[0]?.reason).toContain("checkpoint")
    // UNFENCE REOPENS IT: without this the seat that wrote a handoff could never be woken again.
    /** The Lead reopening the seat. */
    const reopened = await unfenceMember(f.deps, callerOf(f.observed.workspace, LEAD, false), { member: "worker" })
    expect(reopened.ok).toBe(true)
    expect(readTeam(f.observed.workspace, TEAM_ID)?.members[0]?.mode).toBe("member")
    /** The pass after the seat was reopened. */
    const after = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), {})
    if (!after.ok) throw new Error(after.error)
    expect(after.pairs.map((pair) => pair.taskId)).toEqual(["T1"])
  })
})

describe("the read surface on an absent team", () => {
  /**
   * Apply the plugin with a stub adapter and capture the services it publishes.
   * @returns the published read service and a sandbox workspace.
   */
  function services(): { teams: MpdTeamsService; workspace: string } {
    /** The services this apply published, by their service id. */
    const provided = new Map<string, unknown>()
    /** The sandbox workspace the stub adapter answers for. */
    const workspace = sandbox()
    /** A disposer-returning no-op, standing in for every seam these arms never exercise. */
    const noop = (): (() => void) => () => {}
    /** A proxy adapter: any unhandled property answers `noop`, so a new seam cannot crash the arm. */
    const dsh = new Proxy({} as Record<string | symbol, unknown>, {
      get: (_target, prop) => {
        if (prop === "workspaceRoot") return () => workspace
        if (prop === "capabilities") return () => ({})
        // THE METER SEAM answers the ADAPTER'S OWN empty reading (the documented shape for a session it
        // cannot resolve), so the arms below prove the surface passes `unavailable` through instead of
        // substituting a number of its own.
        if (prop === "contextPressure") return () => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" })
        return noop
      },
    })
    /** The minimal cordis context `apply` needs. */
    const ctx = { get: (name: string) => (name === "mpdDsh" ? dsh : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: (id: string, value: unknown) => { provided.set(id, value) }, inject: noop }
    apply(ctx as never)
    return { teams: provided.get("mpdTeams") as MpdTeamsService, workspace }
  }

  test("memberContext answers unavailable with a reason instead of throwing or inventing a window", () => {
    /** A composition with no team record at all. */
    const h = services()
    /** The reading for an unknown team. */
    const missingTeam = h.teams.memberContext(h.workspace, "team-missing", "Nobody")
    expect(missingTeam.provenance).toBe("unavailable")
    expect(missingTeam.usedTokens).toBeNull()
    expect(missingTeam.windowTokens).toBeNull()
    expect(missingTeam.ratio).toBeNull()
    expect(missingTeam.reason).toContain("no team record")
    // A REAL seat with no meter behind it: the member is named, and the numbers stay NULL.
    seedTeam(h.workspace, { members: ["worker"], tasks: [] })
    /** The reading for a seat that exists but was never measured. */
    const missingMeter = h.teams.memberContext(h.workspace, TEAM_ID, "worker")
    expect(missingMeter.member).toBe("worker")
    expect(missingMeter.provenance).toBe("unavailable")
    expect(missingMeter.windowTokens).toBeNull()
  })

  test("depthBudget reads the parent chain and the documented default bound", () => {
    /** A composition with a two-level chain. */
    const h = services()
    /** The root team. */
    const root = seedTeam(h.workspace, { members: [], tasks: [] })
    // A CHILD record: the store's own mutation is used, so the chain is the one a real nest would carry.
    writeTeam(h.workspace, { ...root, teamId: "team-child", parentTeamId: root.teamId })
    /** The child's budget. */
    const child = h.teams.depthBudget(h.workspace, "team-child")
    expect(child).toEqual({ teamId: "team-child", depth: 1, depthMax: 3, remaining: 2 })
    // AN ABSENT TEAM still answers, with the reason and the default bound.
    /** The reading for a team that is not on disk. */
    const absent = h.teams.depthBudget(h.workspace, "team-missing")
    expect(absent.depth).toBe(0)
    expect(absent.depthMax).toBe(3)
    expect(absent.reason).toContain("no team record")
  })

  test("archivedPlans lists the archive with the team each plan became", () => {
    /** A composition with one archived plan. */
    const h = services()
    // An archived, approved plan, written through the store so the layout is the store's own.
    /** The plan staged and archived by the fixture. */
    let plan = stagePlan(h.workspace, LEAD, { name: "the wave", description: "archived", approval: "required" }, NOW)
    plan = addMember(plan, { name: "worker", description: "a seat", prompt: "You work." })
    plan = addTask(plan, { subject: "work", description: "the acceptance text", blockedBy: [] })
    /** The approved plan, as an archive leaves it. */
    const approved = { ...plan, approvedAt: NOW.toISOString() }
    archivePlan(h.workspace, approved)
    // The team record that names the plan, which is how the listing resolves `teamId`.
    writeTeam(h.workspace, { ...seedTeam(h.workspace, { members: ["worker"], tasks: [] }), planId: plan.planId })
    /** The listing. */
    const archived = h.teams.archivedPlans(h.workspace)
    expect(archived).toHaveLength(1)
    expect(archived[0]?.planId).toBe(plan.planId)
    expect(archived[0]?.approved).toBe(true)
    expect(archived[0]?.teamId).toBe(TEAM_ID)
    expect(existsSync(String(archived[0]?.path))).toBe(true)
    // AN EMPTY WORKSPACE answers an empty list, never a throw.
    /** A composition with no archive. */
    const empty = services()
    expect(empty.teams.archivedPlans(empty.workspace)).toEqual([])
  })

  test("listArchivedPlans skips an unreadable archive entry instead of failing the listing", () => {
    /** A sandbox whose archive holds one broken entry and one good one. */
    const workspace = sandbox()
    mkdirSync(join(workspace, ".mpd", "team", "archive", "broken"), { recursive: true })
    writeFileSync(join(workspace, ".mpd", "team", "archive", "broken", "plan.json"), "{not json")
    /** The plan archived beside it. */
    const plan = stagePlan(workspace, "sess-a", { name: "x", description: "y", approval: "required" }, NOW)
    writePlan(workspace, plan)
    archivePlan(workspace, plan)
    expect(listArchivedPlans(workspace).map((row) => row.planId)).toEqual([plan.planId])
  })
})

describe("the record fields the wave adds", () => {
  test("updateTeamMember CLEARS a fence by deleting both keys, and keeps absence as the one spelling", () => {
    /** A record with one member. */
    let record = createTeam(sandbox(), { teamId: "team-fields", name: "fields", description: "record arms", leadSessionId: LEAD }, NOW)
    record = addTeamMember(record, { name: "worker", description: "a seat" }, NOW)
    record = updateTeamMember(record, "worker", { fenced: true, fencedReason: "why" })
    expect(record.members[0]?.fenced).toBe(true)
    // CLEARING deletes, so no reader has to treat `false` and absence as the same state.
    record = updateTeamMember(record, "worker", { fenced: false })
    expect(Object.hasOwn(record.members[0] ?? {}, "fenced")).toBe(false)
    expect(Object.hasOwn(record.members[0] ?? {}, "fencedReason")).toBe(false)
    // A patch the wave reserves for W3-C round-trips like any other.
    record = updateTeamMember(record, "worker", { workmate: "core-dev" })
    expect(record.members[0]?.workmate).toBe("core-dev")
  })
})

describe("the plane owns the reassign readiness check (W2-C)", () => {
  test("a BLOCKED row is REFUSED, named by its blocking ids, and left untouched", async () => {
    // THE GAP W2-B FOUND: the plane only required `status === "pending"`, so a hand-over could wake a
    // member for work it cannot start. The claim path already refused this; the repair must too.
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, {
      members: ["worker", "rescue"],
      tasks: [{ subject: "blocker" }, { subject: "blocked work", owner: "worker", blockedBy: ["T1"] }],
    })
    /** The hand-over of the blocked row. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { dryRun: true, reassign: [{ taskId: "T2", owner: "rescue" }] })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.reassigned?.[0]).toMatchObject({ taskId: "T2", owner: "rescue", claimed: false, delivered: false })
    // THE SENTENCE NAMES THE BLOCKING ID (and its subject), so the repair is actionable.
    expect(String(pass.reassigned?.[0]?.reason)).toContain("BLOCKED by")
    expect(String(pass.reassigned?.[0]?.reason)).toContain("T1")
    expect(String(pass.reassigned?.[0]?.reason)).toContain("close T1 first")
    // THE ROW IS EXACTLY AS IT WAS: still pending, still owned by the member the board declared.
    expect(readTeam(f.observed.workspace, TEAM_ID)?.tasks[1]).toMatchObject({ status: "pending", owner: "worker" })
  })

  test("the SAME row reassigns once its blocker completes — one rule, not two", async () => {
    /** This arm's seams. */
    const f = fixture()
    seedTeam(f.observed.workspace, {
      members: ["worker", "rescue"],
      tasks: [{ subject: "blocker" }, { subject: "blocked work", owner: "worker", blockedBy: ["T1"] }],
    })
    // The blocker CLOSES through the store (the same terminal write the board's own verb performs).
    writeTeam(f.observed.workspace, updateTeamTask(readTeam(f.observed.workspace, TEAM_ID) as TeamRecord, "T1", { status: "completed" }, NOW))
    /** The hand-over that is now legal. */
    const pass = await runDispatch(f.deps, callerOf(f.observed.workspace, LEAD, true), { reassign: [{ taskId: "T2", owner: "rescue" }] })
    if (!pass.ok) throw new Error(pass.error)
    expect(pass.reassigned?.[0]).toMatchObject({ taskId: "T2", owner: "rescue", claimed: true, delivered: true })
    expect(readTeam(f.observed.workspace, TEAM_ID)?.tasks[1]).toMatchObject({ status: "in_progress", owner: "rescue" })
  })

  test("the checkpoint predicate answers from `mode` alone, and its contract names the cellwork mapping", () => {
    /** A record with one closed seat and one live seat. */
    let record = createTeam(sandbox(), { teamId: "team-ck", name: "ck", description: "checkpoint arms", leadSessionId: LEAD }, NOW)
    record = addTeamMember(record, { name: "closed", description: "a seat" }, NOW)
    record = addTeamMember(record, { name: "live", description: "a seat" }, NOW)
    record = updateTeamMember(record, "closed", { mode: "checkpoint", handoff: { path: ".mpd/team/handoff/x/closed-1.md", ordinal: 1 } })
    expect(memberIsCheckpoint(record, "closed")).toBe(true)
    expect(memberIsCheckpoint(record, "M1")).toBe(true)
    expect(memberIsCheckpoint(record, "live")).toBe(false)
    // AN UNKNOWN SEAT is closed by nothing, and a hand-off DOCUMENT alone does not close a seat: only the
    // mode does (the document survives a reopen, deliberately).
    expect(memberIsCheckpoint(record, "nobody")).toBe(false)
    record = updateTeamMember(record, "closed", { mode: "member" })
    expect(memberIsCheckpoint(record, "closed")).toBe(false)
    // THE MAPPING IS DOCUMENTED IN THE PREDICATE ITSELF, so no caller invents a second spelling.
    /** The store's source, read as the pin. */
    const source = readFileSync(join(import.meta.dir, "../src/team-store.ts"), "utf8")
    expect(source).toContain("handoffReady")
    expect(source).toContain("memberIsCheckpoint")
  })
})
