// THE TEAM-PLANE SPLIT, on the TUI side: the surfaces must read the mpd-OWNED record first and fall
// back to the official readout only when this workspace holds none.
//
// The distinction is invisible when both sources agree, so every arm here makes them DISAGREE: the
// official views are empty (which is exactly what a `dsh-tui` composition produces, because the
// official service cannot mount there at all) while the record is full. A regression to "read the
// official plane" therefore renders "(none in this workspace)" and reddens.
import { describe, expect, test } from "bun:test"
import { readBoardState } from "../src/state.js"
import { modelRanks, modelRows, mpdTeamRecords, principalRecord, readRecordWorkflow, readScopedWorkflow } from "../src/team-state.js"
import type { MpdTeamsLike } from "../src/team-state.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"
import type { GraphModel, GraphNode } from "../../mpd-graph-core/src/types.ts"

/** The frozen instant every record in this file is stamped with. */
const NOW = "2026-09-30T09:15:00.000Z"

/** A team record with one requirement, one blocked review, one running work task and one failure. */
function record(extra: Partial<TeamRecord> = {}): TeamRecord {
  return {
    version: 1,
    teamId: "team-20260930091500",
    name: "wave-3",
    description: "split the team plane",
    leadSessionId: "sess-1",
    phase: "active",
    createdAt: NOW,
    approvedAt: NOW,
    members: [
      { id: "M1", name: "Senior Engineer", description: "implements", role: "Senior Engineer", route: "deepseek-official/deepseek-v4-flash", status: "running", spawnedAt: NOW, executorRef: "sess-a" },
      { id: "M2", name: "Reviewer", description: "judges", role: "Reviewer", status: "inactive", spawnedAt: NOW },
    ],
    tasks: [
      { id: "T1", subject: "core", description: "own the record", kind: "requirement", status: "completed", blockedBy: [], writeScopes: [], owner: "Senior Engineer", attempt: 2, createdAt: NOW, updatedAt: NOW, revision: 3 },
      { id: "T2", subject: "review the core", description: "judge it", kind: "review", status: "pending", blockedBy: ["T4"], writeScopes: [], owner: "Reviewer", round: 1, verdict: "pass", createdAt: NOW, updatedAt: NOW, revision: 1 },
      { id: "T3", subject: "sidebar", description: "adapt", kind: "work", status: "in_progress", blockedBy: [], writeScopes: [], owner: "Senior Engineer", createdAt: NOW, updatedAt: NOW, revision: 2 },
      { id: "T4", subject: "repair the mailbox", description: "fix", kind: "repair", status: "failed", blockedBy: ["T1"], writeScopes: [], createdAt: NOW, updatedAt: NOW, revision: 1 },
    ],
    nextMemberNumber: 3,
    nextTaskNumber: 5,
    ...extra,
  }
}

describe("the record is the primary team source", () => {
  test("the workflow carries the review fields the official board has no column for", () => {
    /** The projection under test. */
    const workflow = readRecordWorkflow("/ws", [], record())
    expect(workflow.team?.phase).toBe("active")
    expect(workflow.team?.id).toBe("team-20260930091500")
    // THE POINT OF THE RECORD: these four are real data here and were permanently blank before.
    /** The tasks by id, which is how the arms below read them. */
    const byId = new Map(workflow.tasks.map((task) => [task.id, task]))
    expect(byId.get("T1")?.kind).toBe("requirement")
    expect(byId.get("T1")?.attempt).toBe(2)
    expect(byId.get("T2")?.round).toBe(1)
    expect(byId.get("T2")?.verdict).toBe("pass")
    // The route comes from the record's own field, which the roster resolved.
    expect(workflow.members[0].route).toBe("deepseek-official/deepseek-v4-flash")
  })

  test("the derived states agree: a blocked review, a running task, a failed repair", () => {
    /** The projection under test. */
    const workflow = readRecordWorkflow("/ws", [], record())
    /** The visual state per task id. */
    const visual = new Map(workflow.tasks.map((task) => [task.id, task.visual]))
    /** The projected row per task id, so an arm can read any field. */
    const byId = new Map(workflow.tasks.map((task) => [task.id, task]))
    expect(visual.get("T1")).toBe("completed")
    // T2 is blocked by T4, which FAILED. OPT-1 (user decision 2026-09-13) releases it: it stays
    // `open` and dispatchable, and the failure is named in `failedDependencies` so the renderer can
    // print `failed-dep=T4`. The two facts travel together — that is the whole design.
    expect(visual.get("T2")).toBe("open")
    expect(byId.get("T2")?.failedDependencies).toEqual(["T4"])
    expect(visual.get("T3")).toBe("running")
    expect(visual.get("T4")).toBe("failed")
    expect(workflow.counts).toEqual({ total: 4, completed: 1, inProgress: 1, pending: 1, claimed: 0, failed: 1, cancelled: 0, other: 0 })
    // Rank ordering puts the roots first, which is the order a graph draws in.
    expect(workflow.tasks.map((task) => task.depth)).toEqual([0, 0, 1, 2])
    expect(workflow.team?.links).toBe(2)
  })

  test("a task claimed under the member's EXECUTOR HANDLE is credited to that member", () => {
    // The same two-spelling defect the web panel had: a declared owner carries the member's NAME,
    // while a claim stamps the claimer's handle (the session id). The member cards credit by name, so
    // a handle-owned task used to render `0/0` beside a completed board (measured 2026-10-19).
    /** The record with T3 claimed under the Senior Engineer's handle. */
    const claimed = record()
    claimed.tasks = claimed.tasks.map((task) => task.id === "T3" ? { ...task, owner: "sess-a" } : task)
    /** The projection under test. */
    const workflow = readRecordWorkflow("/ws", [], claimed)
    expect(workflow.tasks.find((task) => task.id === "T3")?.assignee).toBe("Senior Engineer")
    /** The Senior Engineer's card, which must count BOTH of that member's tasks. */
    const member = workflow.members.find((row) => row.name === "Senior Engineer")
    expect(member?.done).toBe(1)
    expect(member?.total).toBe(2)
    // A handle belonging to no roster row stays as written rather than becoming somebody's work.
    /** The record with an unknown handle on T3. */
    const unknown = record()
    unknown.tasks = unknown.tasks.map((task) => task.id === "T3" ? { ...task, owner: "sess-unknown" } : task)
    expect(readRecordWorkflow("/ws", [], unknown).tasks.find((task) => task.id === "T3")?.assignee).toBe("sess-unknown")
  })

  test("phase is the STORED lifecycle, not a guess from the roster", () => {
    expect(readRecordWorkflow("/ws", [], record({ approvedAt: undefined, phase: "staged" })).team?.phase).toBe("staged")
    expect(readRecordWorkflow("/ws", [], record({ phase: "idle", members: [], tasks: [] })).team?.phase).toBe("idle")
    // An explicit end outranks everything, whatever the roster still says.
    expect(readRecordWorkflow("/ws", [], record({ endedAt: NOW, phase: "ended" })).team?.phase).toBe("ended")
    // A never-approved record is `staged` even when its members are already marked running.
    expect(readRecordWorkflow("/ws", [], record({ approvedAt: undefined, phase: "active" })).team?.phase).toBe("staged")
  })

  test("a cycle is REPORTED as a note rather than drawn as if the board were sound", () => {
    /** The record with its two roots blocking each other. */
    const cyclic = record()
    cyclic.tasks[0].blockedBy = ["T3"]
    cyclic.tasks[2].blockedBy = ["T1"]
    /** The projection under test. */
    const workflow = readRecordWorkflow("/ws", [], cyclic)
    expect(workflow.problems.some((note) => note.startsWith("cycle "))).toBe(true)
  })
})

describe("the source selection", () => {
  test("readBoardState shows the RECORD even when the official readout is empty", () => {
    // An empty `views` array is what a dsh-tui composition produces: the official service cannot
    // mount there, so a reader that consulted only the readout would render "(none)".
    /** The board projection under test. */
    const state = readBoardState("/ws", "/home", [], [record()])
    expect(state.team?.name).toBe("wave-3")
    expect(state.team?.description).toBe("split the team plane")
    expect(state.team?.members).toBe(2)
    expect(state.team?.tasks.total).toBe(4)
    expect(state.team?.tasks.completed).toBe(1)
    // With NO record the readout answers, and with neither the row is simply absent.
    expect(readBoardState("/ws", "/home", [], []).team).toBeUndefined()
  })

  test("an ENDED team does not hide the running one behind it", () => {
    /** The newest record, which has ended. */
    const ended = record({ teamId: "team-newer", endedAt: NOW, phase: "ended" })
    /** The older record, which is still live. */
    const live = record({ teamId: "team-older" })
    expect(principalRecord([ended, live])?.teamId).toBe("team-older")
    // A workspace whose every team has ended still answers with the newest, because a reader asking
    // "what happened" must get the last answer rather than a blank.
    expect(principalRecord([ended])?.teamId).toBe("team-newer")
    expect(principalRecord([])).toBeUndefined()
  })

  test("the record read degrades to [] with no service, and never throws", () => {
    expect(mpdTeamRecords(undefined, "/ws")).toEqual([])
    expect(mpdTeamRecords({}, "/ws")).toEqual([])
    // A service that throws is a service that answers nothing, not a crashed render.
    expect(mpdTeamRecords({ list: () => { throw new Error("boom") } }, "/ws")).toEqual([])
    // A workspace-less call answers nothing rather than scanning the process cwd.
    expect(mpdTeamRecords({ list: () => [record()] }, "")).toEqual([])
    expect(mpdTeamRecords({ list: () => [record()] }, "/ws").length).toBe(1)
  })
})

// ── living-graph · THE SERVED MODEL ATTACHMENT AND ITS GUARD ─────────────────────────────────────
//
// WHAT THIS ADDS. The `mpdTeams` service publishes the host's merged model (`graph(workspace, teamId?)`).
// `readScopedWorkflow` attaches it to the projection ONLY when it provably describes the SAME board:
// at least one non-ghost node's id must already be on this projection's board. The guard is the reason
// a workspace-scoped model can never inject another team's ghosts into a session-scoped DAG, so it is
// asserted HERE, with a fake service, rather than waiting for the host row to land.

/**
 * A served model over the ids a caller names, plus one plan-only ghost.
 * @param ids - the board ids the model's non-ghost nodes carry.
 * @param ranks - the served rank per board id.
 * @returns the model a host would publish.
 */
function servedModel(ids: readonly string[], ranks: Readonly<Record<string, number>>): GraphModel {
  /** One node per board id, each carrying the host's rank. */
  const nodes: GraphNode[] = ids.map((id) => ({ id, subject: `task ${id}`, visual: "open", dependencies: [], depth: ranks[id] ?? 0, planned: false }))
  // THE GHOST: declared by the plan, absent from the board, and never dropped.
  nodes.push({ id: "T9", subject: "plan-only task", visual: "planned", dependencies: [], depth: 5, planned: true })
  return {
    nodes,
    edges: [],
    ranks: [],
    cycles: [],
    report: { boardOnly: [], planOnly: ["T9"], edgePlanOnly: [], edgeBoardOnly: [], planProblems: [], unresolved: [], ranksDerived: true },
  }
}

/**
 * One official-plane view for a session; empty, because the attachment arms only need its identity.
 * @param sessionId - the Lead session the view belongs to.
 * @returns the view the official readout would carry.
 */
function teamView(sessionId: string): DshTeamView {
  return { teamId: sessionId, leadName: "Lead", leadSessionId: sessionId, members: [], tasks: [] }
}

describe("living-graph · the served model reaches the projection only when it is the same board", () => {
  test("a model for THIS team is attached, receives the team id, and joins ghost + ranks", () => {
    /** The model for the fixture record's own board, with ranks that contradict the chain. */
    const model = servedModel(["T1", "T2", "T3", "T4"], { T1: 5, T2: 5, T3: 2, T4: 0 })
    /** The (workspace, teamId) pairs the service was asked for, so the reader's scoping is observable. */
    const asked: Array<{ workspace: string; teamId: string | undefined }> = []
    /** The fake `mpdTeams` face: a graph member for the fixture record's team and nothing else. */
    const teams: MpdTeamsLike = {
      graph: (workspace, teamId) => {
        asked.push({ workspace, teamId })
        return model
      },
    }
    /** The projection this session's read produces. */
    const workflow = readScopedWorkflow({ workspace: "/ws", sessionId: "sess-1", holds: [], teams, records: [record()], views: [] })
    // THE TEAM ID IS PASSED: a session-scoped read names the record it is drawing, so the host cannot
    // answer with the workspace principal's model by accident.
    expect(asked).toEqual([{ workspace: "/ws", teamId: "team-20260930091500" }])
    expect(workflow.model).toBe(model)
    /** The joined rows, ghosts included. */
    const rows = modelRows(workflow)
    expect(rows.map((row) => row.id)).toContain("T9")
    expect(rows.find((row) => row.id === "T9")?.planned).toBe(true)
    // THE RANK IS THE MODEL'S, not the board's: T4 is a served root and T1 sits at rank 5.
    expect(modelRanks(workflow)?.get("T4")).toBe(0)
    expect(modelRanks(workflow)?.get("T1")).toBe(5)
  })

  test("a model for a DIFFERENT team is ignored — the board draws alone", () => {
    /** A model whose non-ghost ids exist on no board of the fixture record. */
    const foreign = servedModel(["X1", "X2"], { X1: 1, X2: 0 })
    /** The fake service always answering the FOREIGN model, whatever it is asked for. */
    const teams: MpdTeamsLike = { graph: () => foreign }
    /** The projection under test. */
    const workflow = readScopedWorkflow({ workspace: "/ws", sessionId: "sess-1", holds: [], teams, records: [record()], views: [] })
    // The guard refuses the mismatch: no model, no foreign ghost, no served ranks.
    expect(workflow.model).toBeUndefined()
    expect(modelRows(workflow).some((row) => row.planned === true)).toBe(false)
    expect(modelRanks(workflow)).toBeUndefined()
  })

  test("a throwing service costs the model, never the board", () => {
    /** A service whose graph read throws. */
    const teams: MpdTeamsLike = { graph: () => { throw new Error("boom") } }
    /** The projection under test. */
    const workflow = readScopedWorkflow({ workspace: "/ws", sessionId: "sess-1", holds: [], teams, records: [record()], views: [] })
    expect(workflow.model).toBeUndefined()
    expect(workflow.tasks.length).toBe(4)
  })

  test("a service with no graph member is simply a composition without a model", () => {
    /** The projection under test: the service exists but predates the model member. */
    const workflow = readScopedWorkflow({ workspace: "/ws", sessionId: "sess-1", holds: [], teams: {}, records: [record()], views: [] })
    expect(workflow.model).toBeUndefined()
    expect(workflow.tasks.length).toBe(4)
  })

  test("a FOREIGN model with the SAME T1.. numbering plus one task is REJECTED", () => {
    // THE REALISTIC COLLISION (CodeRabbit): another team also numbers from `T1`, so an intersection
    // is satisfied by `T1` alone. This model shares T1..T4 with our board and adds its own T5 — the
    // ordinary shape of a different team's board — so only a BIJECTION can refuse it.
    /** Another team's model: T1..T4 collide by numbering, and T5 proves the boards differ. */
    const foreign = servedModel(["T1", "T2", "T3", "T4", "T5"], { T1: 0 })
    /** The fake service that always answers the foreign model. */
    const teams: MpdTeamsLike = { graph: () => foreign }
    /** The projection under test: the session's own record, wrongly answered with another model. */
    const workflow = readScopedWorkflow({ workspace: "/ws", sessionId: "sess-1", holds: [], teams, records: [record()], views: [] })
    expect(workflow.model).toBeUndefined()
    expect(modelRows(workflow).some((row) => row.planned === true)).toBe(false)
  })

  test("the OFFICIAL-VIEW arms never ask for a model by workspace alone", () => {
    /** The (workspace, teamId) pairs a service was asked for; it must stay empty. */
    const asked: Array<{ workspace: string; teamId: string | undefined }> = []
    /** A service that WOULD answer a model, so the absence of a call is what the arm measures. */
    const teams: MpdTeamsLike = {
      graph: (workspace, teamId) => {
        asked.push({ workspace, teamId })
        return servedModel(["T1", "T2", "T3", "T4"], {})
      },
    }
    /** The session-scoped read: no mpd record, one official view owned by this session. */
    const session = readScopedWorkflow({ workspace: "/ws", sessionId: "sess-1", holds: [], teams, records: [], views: [teamView("sess-1")] })
    /** The workspace-scoped read: no session id, no record, one official view. */
    const workspace = readScopedWorkflow({ workspace: "/ws", holds: [], teams, records: [], views: [teamView("sess-9")] })
    // THE FIX: an official view carries the HOST's team identity, not the mpd record's, so no mpd
    // teamId can be named — and `graph(workspace)` would answer for the principal, which may be
    // another session's team. The projection therefore asks NOTHING and draws the board alone.
    expect(asked).toEqual([])
    expect(session.model).toBeUndefined()
    expect(workspace.model).toBeUndefined()
  })
})
