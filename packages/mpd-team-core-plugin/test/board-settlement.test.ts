// THE BOARD-SETTLEMENT WAVE (R1-R3), driven through the REAL tools against a sandbox workspace.
//
// Three defects are pinned here, each at the LAYER where it was measured:
//   R1 — `.mpd/team/dispatch.json` was keyed by the bare task id, so TWO teams in one workspace that
//        both minted `T1` shadowed each other: the second team's pass answered "already dispatched to
//        <a member of the first team>" and never recorded its own pairing.
//   R2 — a member was written `running` at spawn and NOTHING wrote it back, so `derivePhase` stayed
//        `active`, the finished-team predicate the compaction pass derives never fired, and the TUI
//        drew a member working after its row was closed.
//   R3 — `release` was LEDGER-ONLY: the pairing vanished while the task stayed `in_progress`, and a
//        released task could never be dispatched again (`readyTasks` is pending-only).
//
// The fixture below is deliberately TOOL-FACING: teams are seeded through the store (a dispatch pass
// needs no approval), then driven through `agent_teams_dispatch` / `agent_teams_task` as the session
// an arm says it is. The ledger is read from the documented file so the assertions are about bytes on
// disk, not about a helper the fix could move.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { addTeamMember, addTeamTask, createTeam, derivePhase, readTeam, writeTeam, type TeamRecord } from "../src/team-store"
import { ledgerKey, type DispatchLedger } from "../src/dispatch"
import { projectMpdTeam, teamIsFinished, terminalTaskStatuses } from "../../mpd-team-compact-plugin/src/index"

/** The frozen clock every seeded instant is derived from, so assertions never race the wall clock. */
const NOW = new Date("2026-10-22T08:00:00.000Z")

/** One captured tool registration, with its executor kept so an arm can drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The harness one arm drives: a sandbox workspace, the tools, and a fake event bus. */
interface Fixture {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** Drive one registered tool AS one session. */
  call: (sessionId: string, name: string, args: unknown) => Promise<any>
  /** Fire one harness event exactly as the bus would, and return the handler's own answer. */
  emit: (event: string, payload: unknown) => unknown
  /** Re-read one team record from disk. */
  record: (teamId: string) => TeamRecord | undefined
}

/** The teams one arm seeded, removed with the sandbox. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** The dispatch ledger as this workspace has it on disk, at the documented path. */
function ledgerOnDisk(workspace: string): DispatchLedger {
  try {
    /** The parsed ledger, accepted only when it is a plain object — the rule `readLedger` applies. */
    const raw = JSON.parse(readFileSync(join(workspace, ".mpd", "team", "dispatch.json"), "utf8")) as DispatchLedger
    return raw !== null && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

/**
 * Build the harness: the plugin applied over a stub adapter that really registers tools and an event
 * seam, and an executor double whose `send` always succeeds (a delivery is not what these arms test).
 * @returns the fixture an arm drives.
 */
function fixture(): Fixture {
  /** The sandbox workspace, which is what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-board-settlement-"))
  sandboxes.push(workspace)
  /** The registered tools, by name. */
  const tools = new Map<string, Tool>()
  /** The event handlers the plugin subscribed, by event name, so an arm can fire one. */
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  /** The executor double: only `send` is reached by a dispatch pass (no approval happens here). */
  const executor = {
    kind: "native",
    reason: "test double",
    /** Accept the delivery; the pairing is recorded from the board's own claim, not from this value. */
    send: async (): Promise<string> => "msg-1",
  }
  /** The stub adapter: the seams this row uses, and nothing it does not. */
  const dsh = {
    registerTool: (definition: Tool) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: () => () => {},
    workspaceRoot: () => workspace,
    onEvent: (event: string, handler: (...args: unknown[]) => unknown) => {
      /** The handlers already subscribed to this event. */
      const existing = listeners.get(event) ?? []
      existing.push(handler)
      listeners.set(event, existing)
      return () => {}
    },
    teamExecutor: () => executor,
    teamListMembers: () => [],
    teamListTasks: () => [],
    capabilities: () => ({}),
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: () => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: () => {},
    inject: () => {},
  }
  apply(ctx as never)
  return {
    workspace,
    call: async (sessionId: string, name: string, args: unknown) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId } }, signal: undefined })
    },
    emit: (event: string, payload: unknown) => {
      /** The handlers subscribed to this event; the arm's answer is the FIRST one's return value. */
      const handlers = listeners.get(event) ?? []
      if (handlers.length === 0) throw new Error(`nothing subscribed to ${event}`)
      return handlers[0](payload)
    },
    record: (teamId: string) => readTeam(workspace, teamId),
  }
}

/** What {@link seedTeam} needs: one approved team with running members and pending tasks. */
interface SeedInput {
  /** The id to mint, so an arm can address the record directly. */
  teamId: string
  /** The Lead session; `createTeam` binds the team to it. */
  leadSessionId: string
  /** The member display names, each spawned and running with a predictable executor handle. */
  members: readonly string[]
  /** The tasks to put on the board; `owner` is the plan-time owner, never a claim. */
  tasks: ReadonlyArray<{ subject: string; owner?: string; blockedBy?: string[] }>
}

/**
 * Seed ONE approved team: running members carrying `child-<slug>` handles, and pending tasks.
 * @param workspace - the sandbox the record is written into.
 * @param input - the team to build.
 * @returns the record as written.
 */
function seedTeam(workspace: string, input: SeedInput): TeamRecord {
  /** The freshly minted record, which `createTeam` already bound to its Lead. */
  let record = createTeam(workspace, { teamId: input.teamId, name: input.teamId, description: "seeded", leadSessionId: input.leadSessionId }, NOW)
  for (const name of input.members) record = addTeamMember(record, { name, description: "seeded member" }, NOW)
  for (const task of input.tasks) {
    record = addTeamTask(record, {
      subject: task.subject,
      description: "seeded task",
      ...(task.owner === undefined ? {} : { owner: task.owner }),
      ...(task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy }),
    }, NOW)
  }
  /** The record as an approval leaves it: every member spawned and running, the phase active. */
  const approved: TeamRecord = {
    ...record,
    approvedAt: NOW.toISOString(),
    phase: "active",
    members: record.members.map((member) => ({ ...member, status: "running" as const, executorRef: "child-" + member.name.replace(/\s+/g, "-") })),
  }
  writeTeam(workspace, approved)
  return approved
}

/**
 * The task statuses the compaction pass reads as terminal, as that module publishes them.
 * @returns the terminal task status list.
 */
function terminal(): readonly string[] {
  return terminalTaskStatuses()
}

describe("R1 — one ledger, two teams, no shadowing", () => {
  test("both teams dispatch their OWN T1, and a release frees only the releasing team's row", async () => {
    /** The harness under test. */
    const f = fixture()
    // TWO TEAMS in ONE workspace, both minting T1 and both naming a member "Engineer" — the exact
    // collision the bare-key ledger could not tell apart.
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "alpha work", owner: "Engineer" }] })
    seedTeam(f.workspace, { teamId: "team-beta", leadSessionId: "sess-beta", members: ["Engineer"], tasks: [{ subject: "beta work", owner: "Engineer" }] })
    /** Team alpha's pass: it must pair its own T1. */
    const alpha = await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(alpha.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T1"])
    /** Team beta's pass: its T1 is a DIFFERENT task and must be paired, never reported as claimed. */
    const beta = await f.call("sess-beta", "agent_teams_dispatch", { action: "run" })
    expect(beta.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T1"])
    expect(beta.skipped.map((row: { reason: string }) => row.reason).join(" ")).not.toContain("already dispatched")
    // BOTH rows are on disk, each under its own composite key and naming its own team's member.
    /** The ledger as the two passes left it. */
    const ledger = ledgerOnDisk(f.workspace)
    expect(Object.keys(ledger).sort()).toEqual([ledgerKey("team-alpha", "T1"), ledgerKey("team-beta", "T1")].sort())
    expect(ledger[ledgerKey("team-beta", "T1")]?.teamId).toBe("team-beta")
    // RELEASE IS TEAM-SCOPED: freeing beta's pairing leaves alpha's row byte-identical.
    /** Beta's release, which must free exactly one row. */
    const freed = await f.call("sess-beta", "agent_teams_task", { action: "release", task_id: "T1" })
    expect(freed.released).toBe(true)
    expect(freed.status).toBe("pending")
    expect(Object.keys(ledgerOnDisk(f.workspace))).toEqual([ledgerKey("team-alpha", "T1")])
    // ...and alpha's board is untouched: its T1 is still in flight, owned by its own member.
    expect(f.record("team-alpha")?.tasks[0].status).toBe("in_progress")
    expect(f.record("team-beta")?.tasks[0].status).toBe("pending")
  })

  test("a LEGACY bare-key row is dropped on the first pass and reported — and cannot claim the new team's T1", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "alpha work", owner: "Engineer" }] })
    // A PRE-R1 ledger: keyed by the bare task id and carrying no `teamId`. This is the row a previous
    // team's pass left behind, and the defect was that the new team inherited it.
    /** The legacy ledger file, written directly because no tool can mint a team-less row. */
    const legacy = { T1: { taskId: "T1", memberId: "child-old-engineer", memberName: "Old Engineer", assignedAt: NOW.toISOString() } }
    mkdirSync(join(f.workspace, ".mpd", "team"), { recursive: true })
    writeFileSync(join(f.workspace, ".mpd", "team", "dispatch.json"), JSON.stringify(legacy))
    /** The first pass: the legacy row must not stop the new team from pairing its own T1. */
    const pass = await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(pass.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T1"])
    // The drop is REPORTED, and the file now holds only the new team's composite row.
    expect(pass.forgotten).toContain("T1")
    expect(Object.keys(ledgerOnDisk(f.workspace))).toEqual([ledgerKey("team-alpha", "T1")])
    // No migration script: a second pass reports nothing and still sees the pairing.
    /** The second pass over the cleaned ledger. */
    const again = await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(again.forgotten).toEqual([])
    expect(again.pairs).toEqual([])
  })

  test("a team that reaches the TERMINAL phase has its ledger rows pruned by the reap path", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "alpha work", owner: "Engineer" }] })
    // A GHOST teammate record: a hand-patched, non-live phase with a ledger row of its own. It cannot be
    // dispatched through a tool (it is not live), so the fixture writes its row directly — which is
    // exactly the stale row the terminal prune exists to remove.
    /** The ghost record, written straight to the teams directory. */
    const ghost = createTeam(f.workspace, { teamId: "team-ghost", name: "ghost", description: "terminal", leadSessionId: "sess-ghost" }, NOW)
    writeTeam(f.workspace, { ...ghost, phase: "archived" as TeamRecord["phase"] })
    /** A pre-existing ledger holding the ghost's row beside the live team's workspace file. */
    const seeded = { [ledgerKey("team-ghost", "T1")]: { teamId: "team-ghost", taskId: "T1", memberId: "m-old", memberName: "Old", assignedAt: NOW.toISOString() } }
    writeFileSync(join(f.workspace, ".mpd", "team", "dispatch.json"), JSON.stringify(seeded))
    /** A pass by the live team: the reap repairs the ghost and prunes its row. */
    const pass = await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(pass.reaped).toEqual(["team-ghost"])
    expect(pass.forgotten).toContain("T1")
    // The ghost's row is GONE and the live team's OWN T1 row survives the same pass.
    expect(Object.keys(ledgerOnDisk(f.workspace))).toEqual([ledgerKey("team-alpha", "T1")])
    expect(f.record("team-ghost")?.endedAt).toBeDefined()
  })
})

describe("R3 — release resets the task row, not just the ledger", () => {
  test("a released row reopens for a later dispatch — status, owner and start clock all reset", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "alpha work", owner: "Engineer" }] })
    // A real pass puts T1 in flight and records the pairing.
    await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(f.record("team-alpha")?.tasks[0].status).toBe("in_progress")
    expect(f.record("team-alpha")?.tasks[0].startedAt).toBeDefined()
    // RELEASE through the dispatch surface: BOTH halves are freed.
    /** The release result. */
    const released = await f.call("sess-alpha", "agent_teams_dispatch", { action: "release", task_id: "T1" })
    expect(released.released).toBe(true)
    expect(released.status).toBe("pending")
    /** The reopened row, as the record now holds it. */
    const row = f.record("team-alpha")?.tasks[0]
    expect(row?.status).toBe("pending")
    expect(row?.owner).toBeUndefined()
    expect(row?.startedAt).toBeUndefined()
    expect(Object.keys(ledgerOnDisk(f.workspace))).toEqual([])
    // RE-DISPATCHABLE: the very next pass pairs the same task again — the r3 acceptance in one line.
    /** The pass after the release. */
    const again = await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(again.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T1"])
    expect(f.record("team-alpha")?.tasks[0].status).toBe("in_progress")
  })

  test("a TERMINAL row is refused, and a DOUBLE release is a no-op with the right refusal", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "alpha work", owner: "Engineer" }] })
    // The Lead closes the row, so it is terminal before any release is considered.
    await f.call("sess-alpha", "agent_teams_task", { action: "complete", task_id: "T1" })
    /** The terminal release: the task half must refuse while reporting the ledger half honestly. */
    const terminalRelease = await f.call("sess-alpha", "agent_teams_dispatch", { action: "release", task_id: "T1" })
    expect(terminalRelease.released).toBe(false)
    expect(terminalRelease.refused).toContain("already terminal")
    expect(f.record("team-alpha")?.tasks[0].status).toBe("completed")
    // A row that holds no dispatch is the double-release case, and it says exactly that.
    seedTeam(f.workspace, { teamId: "team-second", leadSessionId: "sess-second", members: ["Engineer"], tasks: [{ subject: "second work" }] })
    /** The first release of an undispatched row is a no-op with a sentence, never a silent success. */
    const first = await f.call("sess-second", "agent_teams_dispatch", { action: "release", task_id: "T1" })
    expect(first.released).toBe(false)
    expect(first.refused).toBe('task T1 is "pending" and holds no dispatch to release')
  })
})

describe("R2 — members settle, and the derived phase reaches idle", () => {
  test("completing a task settles its OWNER deterministically; closing the board makes the team idle", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, {
      teamId: "team-alpha",
      leadSessionId: "sess-alpha",
      members: ["Engineer A", "Engineer B"],
      tasks: [{ subject: "first", owner: "Engineer A" }, { subject: "second", owner: "Engineer B" }],
    })
    // Both rows go in flight in one pass, one per member.
    await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(f.record("team-alpha")?.members.map((member) => member.status)).toEqual(["running", "running"])
    // MEMBER A closes its own row: the closure settles A, and B stays running because ITS row is open.
    await f.call("child-Engineer-A", "agent_teams_task", { action: "complete", task_id: "T1" })
    expect(f.record("team-alpha")?.members.map((member) => member.status)).toEqual(["inactive", "running"])
    // The Lead closes B's row: B settles too, and the derived phase reaches idle.
    await f.call("sess-alpha", "agent_teams_task", { action: "complete", task_id: "T2" })
    /** The record after both closures. */
    const settled = f.record("team-alpha")!
    expect(settled.members.map((member) => member.status)).toEqual(["inactive", "inactive"])
    expect(derivePhase(settled)).toBe("idle")
    // The STORED phase agrees (the write re-derives it), which is what the TUI and the web panel read.
    expect(settled.phase).toBe("idle")
    // THE CONSEQUENCE THE DEFECT BLOCKED: the compaction pass now reads a FINISHED team.
    /** The record projected through the compaction module's own face. */
    const projected = projectMpdTeam(settled)!
    expect(teamIsFinished(projected, terminal())).toBe(true)
  })

  test("a member that still OWNS an open task is NOT settled by its OWN turn boundary", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "first", owner: "Engineer" }, { subject: "second", owner: "Engineer" }] })
    // Two tasks in flight on ONE member: a second task claimed under its handle (the two-spelling rule).
    /** The record with both rows open on the same member. */
    const twoOpen: TeamRecord = {
      ...f.record("team-alpha")!,
      tasks: f.record("team-alpha")!.tasks.map((task) => ({ ...task, status: "in_progress" as const, owner: "Engineer" })),
    }
    writeTeam(f.workspace, twoOpen)
    // Closing ONE row settles nothing: the member still owns the other.
    await f.call("sess-alpha", "agent_teams_task", { action: "complete", task_id: "T1" })
    expect(f.record("team-alpha")?.members[0].status).toBe("running")
    // Closing the second row is what frees it.
    await f.call("sess-alpha", "agent_teams_task", { action: "complete", task_id: "T2" })
    expect(f.record("team-alpha")?.members[0].status).toBe("inactive")
  })

  test("the turn-stopping EVENT settles the member, returns nothing (serial safety), and honours open work", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "first", owner: "Engineer" }] })
    // CLOSE the row OUT OF BAND (the Lead's repair path): the member is left `running` with nothing to
    // do, which is the state only the turn boundary can observe.
    /** The board with its only task completed, the member still running. */
    writeTeam(f.workspace, { ...f.record("team-alpha")!, tasks: [{ ...f.record("team-alpha")!.tasks[0], status: "completed" }] })
    expect(f.record("team-alpha")?.members[0].status).toBe("running")
    /** The handler's own answer: a `serial` dispatch listener must return nothing. */
    const answer = f.emit("agent/turn-stopping", { agent: { session: { id: "child-Engineer", header: { cwd: f.workspace } } } })
    expect(answer).toBeUndefined()
    // The detached block lands the settlement (it has no await, so it completes with the emit).
    await new Promise((resolve) => setTimeout(resolve, 0))
    /** The record after the turn boundary. */
    const settled = f.record("team-alpha")!
    expect(settled.members[0].status).toBe("inactive")
    expect(settled.phase).toBe("idle")
    expect(teamIsFinished(projectMpdTeam(settled)!, terminal())).toBe(true)
  })

  test("a SETTLED member is dispatchable again, and the claim flips it back to `running`", async () => {
    // Settling a member must not empty the dispatch pool (the plan's own warning): `inactive` is FREE,
    // and a pass that pairs a settled member writes `running` back onto its row.
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "first", owner: "Engineer" }] })
    // Close the only task: the member settles, and the team derives idle.
    await f.call("sess-alpha", "agent_teams_task", { action: "complete", task_id: "T1" })
    expect(f.record("team-alpha")?.members[0].status).toBe("inactive")
    expect(f.record("team-alpha")?.phase).toBe("idle")
    // A NEW task arrives after the settlement (the wave's next instruction, appended to the board).
    /** The record with one more pending task. */
    const reopened = addTeamTask(f.record("team-alpha")!, { subject: "second", description: "added after idle", owner: "Engineer" }, NOW)
    writeTeam(f.workspace, reopened)
    // The pass must see the settled member as an IDLE candidate, pair it, and flip it back to running.
    /** The pass after the settlement. */
    const pass = await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    expect(pass.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T2"])
    /** The record after the pairing. */
    const after = f.record("team-alpha")!
    expect(after.members[0].status).toBe("running")
    expect(after.tasks.find((task) => task.id === "T2")?.status).toBe("in_progress")
    expect(after.phase).toBe("active")
  })

  test("the EVENT is INERT for an unknown session and for a member that still owns open work", async () => {
    /** The harness under test. */
    const f = fixture()
    seedTeam(f.workspace, { teamId: "team-alpha", leadSessionId: "sess-alpha", members: ["Engineer"], tasks: [{ subject: "first", owner: "Engineer" }] })
    // The row is OPEN, so an event naming its own session must not settle it.
    await f.call("sess-alpha", "agent_teams_dispatch", { action: "run" })
    f.emit("agent/turn-stopping", { agent: { session: { id: "child-Engineer", header: { cwd: f.workspace } } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.record("team-alpha")?.members[0].status).toBe("running")
    // A session no team names, and an empty payload, are both no-ops (no throw, no write).
    f.emit("agent/turn-stopping", { agent: { session: { id: "child-nobody", header: { cwd: f.workspace } } } })
    f.emit("agent/turn-stopping", {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.record("team-alpha")?.members[0].status).toBe("running")
  })
})
