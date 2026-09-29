// THE TEAM-PLANE SPLIT, on the TUI side: the surfaces must read the mpd-OWNED record first and fall
// back to the official readout only when this workspace holds none.
//
// The distinction is invisible when both sources agree, so every arm here makes them DISAGREE: the
// official views are empty (which is exactly what a `dsh-tui` composition produces, because the
// official service cannot mount there at all) while the record is full. A regression to "read the
// official plane" therefore renders "(none in this workspace)" and reddens.
import { describe, expect, test } from "bun:test"
import { readBoardState } from "../src/state.js"
import { mpdTeamRecords, principalRecord, readRecordWorkflow } from "../src/team-state.js"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"

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
