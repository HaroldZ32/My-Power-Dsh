// TASK B of the drive-surface wave: the two team ACTIONS, exec-free.
//
// WHAT THESE ARMS PROVE. `approveTeam` and `runDispatch` are the bodies that used to live inline in
// `agent_teams_plan {action:"approve"}` and `agent_teams_dispatch {action:"run"}`. The tool path is
// still covered by the rest of this package's suite (471 arms at the time of the move), so the subject
// HERE is the property that made the move possible at all: the SAME store writes happen through a
// caller value instead of a tool exec, and a caller with NO live agent refuses BEFORE writing anything.
//
// EVERY ARM READS THE STORE FILES, not just the reply: a reply can claim a team exists while the record
// on disk is empty, and the file shape is what the rest of the bundle actually reads.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { approveTeam, runDispatch, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { addMember, addTask, stagePlan, writePlan } from "../src/plan-store"
import { activeTeamId, readTeam, teamRecordPath, type TeamRecord, type TeamTaskRecord } from "../src/team-store"
import type { StagedPlan } from "../src/plan-store"
import type { DshTeamExecutor, DshTeamSpawnRequest } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The instant every store write in this file is stamped with. */
const NOW = new Date("2026-11-02T02:00:00.000Z")
/** The session every arm acts as. */
const LEAD = "lead-session-b"
/** The live agent a tool call would carry; its contents are opaque to the actions. */
const AGENT = { session: { id: LEAD, header: {} } }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** Everything one arm can observe about the seams the actions call. */
interface Observed {
  /** The sandbox workspace this fixture's stores write into. */
  workspace: string
  /** The member names the executor was asked to raise, in call order. */
  spawns: string[]
  /** One entry per delivered dispatch message: `<handle>:<content>`. */
  sent: string[]
  /** The plans the bundled approval effects were handed, in call order. */
  effects: StagedPlan[]
  /** The members whose dispatch window was opened, in call order. */
  windows: string[]
}

/** The fixture one arm drives. */
interface Fixture {
  /** What the seams observed. */
  observed: Observed
  /** The deps bundle the actions receive. */
  deps: TeamActionDeps
}

/**
 * The gates one arm uses to hold an action mid-flight.
 *
 * A CONCURRENT arm needs the first call SUSPENDED inside its own await, otherwise it would complete
 * before the second caller is fired and prove nothing about the in-flight slot.
 */
interface FixtureGates {
  /** Resolved when the executor's `spawn` may answer; absent means it answers at once. */
  spawnGate?: Promise<void>
  /** Resolved when the executor's `send` may answer; absent means it answers at once. */
  sendGate?: Promise<void>
}

/**
 * Build the deps bundle: a real store, a recording executor and NO cordis context.
 *
 * The store functions are the module-level ones the actions import directly, so the fixture only has
 * to fake the three seams that belong to the row: the executor, the approval effects and the settings
 * around them.
 * @param gates - the optional gates that hold a spawn or a send until the arm releases it.
 * @returns the deps and the observations they record.
 */
function fixture(gates: FixtureGates = {}): Fixture {
  /** The sandbox workspace this arm's stores write into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-actions-"))
  sandboxes.push(workspace)
  /** What the seams observed. */
  const observed: Observed = { workspace, spawns: [], sent: [], effects: [], windows: [] }
  /** The executor double: it raises any member under a predictable handle and records the delivery. */
  const executor: DshTeamExecutor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: DshTeamSpawnRequest): Promise<{ handle: string; executor: "native" }> => {
      observed.spawns.push(request.name)
      if (gates.spawnGate !== undefined) await gates.spawnGate
      return { handle: "child-" + request.name.replace(/\s+/g, "-"), executor: "native" }
    },
    send: async (_caller: unknown, handle: string, content: string): Promise<void> => {
      observed.sent.push(`${handle}:${content}`)
      if (gates.sendGate !== undefined) await gates.sendGate
    },
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  return {
    observed,
    deps: {
      now: () => NOW,
      executor: () => executor,
      bundleApprovalEffects: async (plan: StagedPlan): Promise<void> => { observed.effects.push(plan) },
      deriveParentTeam: (): undefined => undefined,
      // The SAME resolution the row's `resolveTeam` performs, reduced to the one arm these actions
      // read: the session's bound record, in this workspace.
      resolveTeam: (space: string, sessionId: string) => {
        /** The team this session is bound to, when the index has one. */
        const teamId = activeTeamId(space, sessionId)
        if (teamId === undefined) return { refusal: "no team record in this workspace — approve a plan first" }
        /** The record itself, re-read from disk. */
        const record = readTeam(space, teamId)
        return record === undefined ? { refusal: "no team record in this workspace — approve a plan first" } : { record }
      },
      readWatchdogHold: () => ({ state: "free" }),
      service: (): undefined => undefined,
      log: (): void => {},
      beginDispatch: (memberId: string) => {
        observed.windows.push(memberId)
        return (): void => {}
      },
      assertPlanGraph: (): void => {},
      assertScopesOrdered: (): void => {},
    },
  }
}

/**
 * Stage a two-task wave: one member, a root task and a review that waits for it.
 * @param workspace - the sandbox the plan is staged in.
 * @returns the staged plan, so an arm can quote its `planId`.
 */
function stageWave(workspace: string): StagedPlan {
  /** The plan as it grows; each helper returns a new value. */
  let plan = stagePlan(workspace, LEAD, { name: "the wave", description: "ship the drive surface", approval: "required" }, NOW)
  plan = addMember(plan, { name: "Senior Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" })
  plan = addTask(plan, { subject: "core", description: "own the record", blockedBy: [] })
  plan = addTask(plan, { subject: "review the core", description: "judge it", kind: "review", blockedBy: ["core"], owner: "Senior Engineer" })
  writePlan(workspace, plan)
  return plan
}

/** The caller a tool call would build, with the live agent the fixture's arms act as. */
const LIVE: TeamActionCaller = { workspace: "", sessionId: LEAD, lineage: [], agent: AGENT }

/** The caller a ROUTE with no live session would build: no agent at all. */
const AGENTLESS: TeamActionCaller = { workspace: "", sessionId: LEAD, lineage: [] }

/** One stored task, narrowed to the fields every arm asserts. */
function taskShape(task: TeamTaskRecord): { id: string; subject: string; kind: string; status: string; blockedBy: string[]; owner?: string } {
  return { id: task.id, subject: task.subject, kind: task.kind, status: task.status, blockedBy: [...task.blockedBy], ...(task.owner === undefined ? {} : { owner: task.owner }) }
}

/** One stored record, read from its own file so an arm asserts BYTES, not the reply. */
function stored(workspace: string, record: TeamRecord): TeamRecord {
  return JSON.parse(readFileSync(teamRecordPath(workspace, record.teamId), "utf8")) as TeamRecord
}

describe("approveTeam — the `approve` body, exec-free", () => {
  test("NO live agent refuses with one sentence, and NOTHING is written", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    stageWave(observed.workspace)
    /** The refusal the action answers. */
    const result = await approveTeam(deps, { ...AGENTLESS, workspace: observed.workspace })
    expect(result).toEqual({ ok: false, error: "approve needs a live agent" })
    // No record, no spawn, no effect, no dispatch window: the refusal is BEFORE the first write.
    expect(existsSync(join(observed.workspace, ".mpd", "team", "teams"))).toBe(false)
    expect(observed.spawns).toEqual([])
    expect(observed.effects).toEqual([])
    expect(observed.windows).toEqual([])
  })

  test("WITH an agent the store files carry the team, its tasks and the archived plan", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    /** The staged plan, quoted for the ids the record must echo. */
    const plan = stageWave(observed.workspace)
    /** The approval's answer. */
    const result = await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.approvedAt).toBe(NOW.toISOString())
    expect(result.team?.name).toBe("the wave")
    // The executor was asked for the member once, under a handle the record keeps.
    expect(observed.spawns).toEqual(["Senior Engineer"])
    expect(result.created.members).toEqual([{ name: "Senior Engineer", id: "child-Senior-Engineer" }])
    expect(result.created.tasks).toEqual([{ subject: "core", id: "T1" }, { subject: "review the core", id: "T2" }])
    // ── THE RECORD ON DISK, which is what every surface reads ────────────────
    /** The record as it was persisted. */
    const record = stored(observed.workspace, result.team as TeamRecord)
    expect(record.name).toBe("the wave")
    expect(record.description).toBe("ship the drive surface")
    expect(record.leadSessionId).toBe(LEAD)
    expect(record.planId).toBe(plan.planId)
    expect(record.approvedAt).toBe(NOW.toISOString())
    expect(record.phase).toBe("active")
    expect(record.members.map((member) => ({ id: member.id, name: member.name, role: member.role, status: member.status, executorRef: member.executorRef })))
      .toEqual([{ id: "M1", name: "Senior Engineer", role: "Senior Engineer", status: "running", executorRef: "child-Senior-Engineer" }])
    // THE SECOND PASS RESOLVED THE SUBJECT REFERENCE to the board id the first pass minted.
    expect(record.tasks.map(taskShape)).toEqual([
      { id: "T1", subject: "core", kind: "work", status: "pending", blockedBy: [] },
      { id: "T2", subject: "review the core", kind: "review", status: "pending", blockedBy: ["T1"], owner: "Senior Engineer" },
    ])
    // THE PLAN IS ARCHIVED, so the staging slot is free and the approved plan stays readable.
    expect(existsSync(join(observed.workspace, ".mpd", "team", "staging", `${LEAD}.json`))).toBe(false)
    /** The archived plan, read from the archive directory the action returned. */
    const archived = JSON.parse(readFileSync(join(observed.workspace, ".mpd", "team", "archive", plan.planId, "plan.json"), "utf8")) as StagedPlan
    expect(archived.approvedAt).toBe(NOW.toISOString())
    expect(archived.created?.tasks?.map((task) => task.id)).toEqual(["T1", "T2"])
    // The bundled effects ran LAST, with the plan the approval built.
    expect(observed.effects.map((entry) => entry.planId)).toEqual([plan.planId])
  })

  test("dryRun reports what WOULD be created and writes nothing", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    stageWave(observed.workspace)
    /** The preview. */
    const result = await approveTeam(deps, { ...LIVE, workspace: observed.workspace }, { dryRun: true })
    if (!result.ok) throw new Error(result.error)
    expect(result.team).toBeUndefined()
    expect(result.created).toEqual({ members: [{ name: "Senior Engineer", id: "" }], tasks: [{ subject: "core", id: "" }, { subject: "review the core", id: "" }] })
    expect(existsSync(join(observed.workspace, ".mpd", "team", "teams"))).toBe(false)
    expect(observed.spawns).toEqual([])
  })
})

describe("runDispatch — the `run` body, exec-free", () => {
  test("NO live agent refuses with one sentence, and no ledger row is written", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    stageWave(observed.workspace)
    await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    // The approval itself must not have dispatched anything.
    expect(observed.sent).toEqual([])
    /** The dispatch refusal. */
    const result = await runDispatch(deps, { ...AGENTLESS, workspace: observed.workspace }, {})
    expect(result).toEqual({ ok: false, error: "dispatch needs a live agent" })
    expect(existsSync(join(observed.workspace, ".mpd", "team", "dispatch.json"))).toBe(false)
    expect(observed.windows).toEqual([])
  })

  test("WITH an agent a ready task pairs, and BOTH the ledger and the board move", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    /** The staged wave whose approval builds the board this pass reads. */
    stageWave(observed.workspace)
    /** The approved record whose board this pass reads. */
    const approved = await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    if (!approved.ok || approved.team === undefined) throw new Error("the approval did not produce a team")
    /** The pass's answer. */
    const result = await runDispatch(deps, { ...LIVE, workspace: observed.workspace }, {})
    if (!result.ok) throw new Error(result.error)
    // T1 is the only READY task (T2 waits for it), and the member is idle, so one pair is decided.
    expect(result.pairs.map((pair) => ({ taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName })))
      .toEqual([{ taskId: "T1", memberId: "child-Senior-Engineer", memberName: "Senior Engineer" }])
    // The blocked task is REPORTED, never silently dropped.
    expect(result.skipped).toEqual([{ taskId: "T2", subject: "review the core", reason: "not ready (blocked by T1)" }])
    // The delivery went through the executor, once, carrying the task's subject.
    expect(observed.sent).toHaveLength(1)
    expect(observed.sent[0]).toContain("T1")
    expect(observed.sent[0]).toContain("core")
    // The dispatch window opened around the pairing and closed again.
    expect(observed.windows).toEqual(["child-Senior-Engineer"])
    // ── THE LEDGER ON DISK: team-scoped, so a new team reusing T1 cannot inherit it ──
    /** The ledger as persisted. */
    const ledger = JSON.parse(readFileSync(join(observed.workspace, ".mpd", "team", "dispatch.json"), "utf8")) as Record<string, { teamId: string; taskId: string; memberName: string }>
    expect(ledger[`${approved.team.teamId}::T1`]).toMatchObject({ teamId: approved.team.teamId, taskId: "T1", memberName: "Senior Engineer" })
    // ── THE BOARD MOVED WITH IT: the task is claimed and the member is running ──
    /** The record after the pass. */
    const record = stored(observed.workspace, approved.team)
    expect(taskShape(record.tasks[0] as TeamTaskRecord)).toMatchObject({ id: "T1", status: "in_progress", blockedBy: [] })
    expect(record.members[0]?.status).toBe("running")
  })

  test("dryRun decides the pairing and sends nothing", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    stageWave(observed.workspace)
    await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    /** The preview pass. */
    const result = await runDispatch(deps, { ...LIVE, workspace: observed.workspace }, { dryRun: true })
    if (!result.ok) throw new Error(result.error)
    expect(result.pairs.map((pair) => pair.taskId)).toEqual(["T1"])
    expect(observed.sent).toEqual([])
    expect(existsSync(join(observed.workspace, ".mpd", "team", "dispatch.json"))).toBe(false)
  })
})

// ── R1a: the in-flight slot — ONE action per workspace+session at a time ─────
//
// WHY THIS EXISTS. Approval used to be reachable only from a model turn, so two callers could not
// overlap. It is now reachable from a tool, the `mpdTeamActions` service, two POST routes and a panel
// tap, and the window between "the plan looks staged" and "the plan is archived" is wide enough for a
// second call to see the SAME unapproved plan and mint a SECOND team with a second member set. The
// slot is REFUSED, never queued: a queue would hide the duplicate from the operator.

/**
 * Bound one promise so a NON-refusal fails the arm instead of hanging on the spawn/send gate.
 *
 * A refused second caller answers immediately; a second caller that wrongly proceeds suspends on the
 * SAME gate as the first, and awaiting it would only time the whole test out with no sentence to read.
 * @param promise - the call under test.
 * @param ms - how long a genuine answer may take.
 * @param what - the failure sentence to reject with when the bound expires.
 * @returns the promise's value, or a rejection naming what never answered.
 */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  /** The timer that rejects the bound. */
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(what)), ms) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe("in-flight exclusion — a second concurrent caller is refused", () => {
  test("two concurrent approvals: the second is REFUSED, ONE team is written and ONE member set spawned", async () => {
    /** The gate the first approval suspends inside its one spawn. */
    let release = (): void => {}
    /** Released by the arm once the second call has been answered. */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** The seams, with the spawn held open. */
    const { deps, observed } = fixture({ spawnGate: gate })
    stageWave(observed.workspace)
    /** The first approval; it is suspended inside `spawn` from the moment it is called. */
    const first = approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    // THE PRECONDITION: the first call really is in flight, past the plan read and inside its spawn.
    expect(observed.spawns).toEqual(["Senior Engineer"])
    /** The second caller's answer, bounded so a NON-refusal fails fast rather than hanging. */
    let second: Awaited<ReturnType<typeof approveTeam>>
    try {
      second = await within(approveTeam(deps, { ...LIVE, workspace: observed.workspace }), 250, "the second approval was not refused — it waited on the same spawn")
    } finally {
      release()
    }
    expect(second).toEqual({ ok: false, error: "an approval for this session is already running" })
    /** The first approval's answer. */
    const outcome = await first
    if (!outcome.ok) throw new Error(outcome.error)
    // EXACTLY ONE OF EACH: one spawn, one record on disk.
    expect(observed.spawns).toHaveLength(1)
    expect(readdirSync(join(observed.workspace, ".mpd", "team", "teams")).filter((name) => name.endsWith(".json"))).toHaveLength(1)
    // AND THE SLOT IS FREE AGAIN after the refusal AND the completed pass: a fresh wave approves.
    stageWave(observed.workspace)
    /** The next wave's approval, which a leaked slot would refuse. */
    const next = await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    expect(next.ok).toBe(true)
  })

  test("two concurrent dispatch passes: the second is REFUSED and the message is sent ONCE", async () => {
    /** The gate the first pass suspends inside its one send. */
    let release = (): void => {}
    /** Released by the arm once the second call has been answered. */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** The seams, with the send held open. */
    const { deps, observed } = fixture({ sendGate: gate })
    stageWave(observed.workspace)
    await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    /** The first pass; it is suspended inside `send` from the moment it is called. */
    const first = runDispatch(deps, { ...LIVE, workspace: observed.workspace }, {})
    // THE PRECONDITION: the first pass has already delivered its one pairing.
    expect(observed.sent).toHaveLength(1)
    /** The second pass's answer, bounded so a NON-refusal fails fast rather than hanging. */
    let second: Awaited<ReturnType<typeof runDispatch>>
    try {
      second = await within(runDispatch(deps, { ...LIVE, workspace: observed.workspace }, {}), 250, "the second dispatch pass was not refused — it waited on the same send")
    } finally {
      release()
    }
    expect(second).toEqual({ ok: false, error: "a dispatch pass for this session is already running" })
    /** The first pass's answer. */
    const outcome = await first
    if (!outcome.ok) throw new Error(outcome.error)
    expect(observed.sent).toHaveLength(1)
    // THE SLOT IS FREE AGAIN: a follow-up pass is accepted (and finds nothing left to pair).
    const next = await runDispatch(deps, { ...LIVE, workspace: observed.workspace }, {})
    expect(next.ok).toBe(true)
  })

  test("a slot is released after a THROW: the failure is MARKED and the next call still runs", async () => {
    /** This arm's seams. */
    const { deps, observed } = fixture()
    stageWave(observed.workspace)
    /** The failure a store write can throw: its message really does embed a filesystem path. */
    const refusal = `EACCES: permission denied, open '${join(observed.workspace, ".mpd", "team", "teams", "x.json")}'`
    /** The clock, so the throwing seam can be put back for the retry. */
    const clock = deps.now
    deps.now = (): Date => { throw new Error(refusal) }
    /** The unexpected failure, returned rather than rejected. */
    const failed = await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error("unreachable: the clock threw")
    // THE MARK THE ROUTE READS, and the message the TOOL still rethrows.
    expect(failed.unexpected).toBe(true)
    expect(failed.error).toBe(refusal)
    // THE SLOT SURVIVED THE THROW: nothing was spawned and a retry still runs.
    expect(observed.spawns).toEqual([])
    deps.now = clock
    /** The retry. */
    const retried = await approveTeam(deps, { ...LIVE, workspace: observed.workspace })
    expect(retried.ok).toBe(true)
    expect(observed.spawns).toEqual(["Senior Engineer"])
  })
})
