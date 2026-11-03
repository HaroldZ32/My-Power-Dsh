// THE DERIVED TEAM STAGE (contract §10 item A1).
//
// `teamStage` is a FIRST-MATCH table, and the ORDER is the contract: a board that cannot advance must
// classify as `person(blocked)` even when one of its rows is still marked in flight. `derivePhase` cannot
// say that — it answers `active` for any live team — which is exactly how a blocked team used to render as
// working. These arms pin the order, every reason, and the one surface defect the stage closes (a fenced
// seat rendered as idle).
import { describe, expect, test } from "bun:test"
import { stageLabel, teamStage } from "../src/stage.ts"
import { createTeam, idleMembers, type TeamMemberRecord, type TeamRecord, type TeamTaskRecord } from "../src/team-store.ts"

/** A workspace path no arm writes to: `createTeam` only mints an id and shapes a record here. */
const WORKSPACE = "/tmp/mpd-stage-arms"

/**
 * One task row with the fields the classifier reads.
 *
 * @param id - the task id (`T1`, `T2`, …).
 * @param over - the fields this arm varies.
 * @returns a task record.
 */
function taskOf(id: string, over: Partial<TeamTaskRecord> = {}): TeamTaskRecord {
  return {
    id, subject: "subject " + id, description: "description", kind: "work", status: "pending",
    blockedBy: [], writeScopes: [], createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z",
    revision: 1,
    ...over,
  }
}

/**
 * One member row with the fields the classifier reads.
 *
 * @param name - the member's display name.
 * @param over - the fields this arm varies.
 * @returns a member record.
 */
function memberOf(name: string, over: Partial<TeamMemberRecord> = {}): TeamMemberRecord {
  return { id: "M1", name, description: name, status: "running", spawnedAt: "2026-11-02T00:00:00.000Z", ...over }
}

/**
 * A live team record around one board and one roster.
 *
 * @param tasks - the board.
 * @param members - the roster.
 * @returns the record (approved, so `derivePhase` calls it live).
 */
function teamOf(tasks: TeamTaskRecord[], members: TeamMemberRecord[] = [memberOf("alice")]): TeamRecord {
  /** The freshly minted record, then the arm's own board and roster. */
  const record = createTeam(WORKSPACE, { name: "the wave", description: "the wave", leadSessionId: "sess-1" }, new Date("2026-11-02T00:00:00.000Z"))
  return { ...record, approvedAt: "2026-11-02T00:00:00.000Z", tasks, members }
}

describe("the first-match order", () => {
  test("a record that is BOTH blocked and working classifies as person:blocked", () => {
    // T1 is in flight (a member could still be working) and T2 cannot start: the board cannot advance.
    const record = teamOf([
      taskOf("T1", { status: "in_progress", owner: "alice" }),
      taskOf("T2", { status: "pending", blockedBy: ["T1"] }),
    ])
    // THE ORDER, which is the whole point: blocked OUTRANKS the in-flight row.
    expect(stageLabel(teamStage(record))).toBe("person:blocked")
    // A classifier that read "any task in flight" first would answer `working` — this is the assertion
    // that reddens when the table is reordered.
    expect(stageLabel(teamStage(record))).not.toBe("working")
    // And the phase alone cannot tell the two apart: that is why the stage exists.
    expect(record.tasks.some((task) => task.status === "in_progress")).toBe(true)
  })

  test("a failed task outranks a review, a blocker and the in-flight work", () => {
    // Three facts at once: a failure, a review that did not pass, and a blocked row.
    const record = teamOf([
      taskOf("T1", { status: "failed" }),
      taskOf("T2", { kind: "review", status: "completed", verdict: "fail" }),
      taskOf("T3", { status: "pending", blockedBy: ["T9"] }),
      taskOf("T4", { status: "in_progress", owner: "alice" }),
    ])
    expect(stageLabel(teamStage(record))).toBe("person:failed")
  })

  test("a review whose verdict is not pass classifies as person:review, and a passing one does not", () => {
    // A review that asked for changes: the captain decides, no member can.
    const asking = teamOf([taskOf("T1", { kind: "review", status: "completed", verdict: "changes" })])
    expect(stageLabel(teamStage(asking))).toBe("person:review")
    // A PASSING review is not a person stage: the board finished, so the delivery awaits acceptance.
    const passing = teamOf([taskOf("T1", { kind: "review", status: "completed", verdict: "pass" })])
    expect(stageLabel(teamStage(passing))).toBe("person:delivery")
  })

  test("a finished board is person:delivery, an in-flight one is working, and an ended record is ended", () => {
    // Everything terminal, nothing failed: the work is done and someone must accept it.
    expect(stageLabel(teamStage(teamOf([taskOf("T1", { status: "completed" })])))).toBe("person:delivery")
    // Work in flight with ready work behind it: `queued` says so.
    const working = teamOf([taskOf("T1", { status: "in_progress", owner: "alice" }), taskOf("T2")])
    expect(stageLabel(teamStage(working))).toBe("working:queued")
    // Work in flight with nothing behind it: plain `working`.
    expect(stageLabel(teamStage(teamOf([taskOf("T1", { status: "claimed", owner: "alice" })])))).toBe("working")
    // A record whose own phase is `ended` is never a delivery awaiting acceptance.
    const ended = { ...teamOf([taskOf("T1", { status: "completed" })]), endedAt: "2026-11-02T01:00:00.000Z" }
    expect(stageLabel(teamStage(ended))).toBe("ended")
    // Live, nothing in flight, nothing finished as a whole: idle.
    expect(stageLabel(teamStage(teamOf([taskOf("T1", { status: "cancelled" })].map((task) => ({ ...task, status: "in_progress" as const })))))).not.toBe("idle")
  })

  test("a seat that stopped and left a handoff is a person:answer", () => {
    // Nothing in flight, nothing finished: the seat's handoff is the only thing on the board a reader can
    // act on, and only a human can answer it.
    const record = teamOf([taskOf("T1", { status: "pending", owner: "alice" })], [
      memberOf("alice", { status: "inactive", handoff: { task: "T1", state: "waiting", writtenAt: "2026-11-02T00:00:00.000Z" } as never }),
    ])
    expect(stageLabel(teamStage(record))).toBe("person:answer")
  })

  test("the classifier is TOTAL: a partial record classifies instead of throwing", () => {
    // A migration or a fixture may hand a render path a record missing both collections.
    expect(() => teamStage({} as TeamRecord)).not.toThrow()
    expect(stageLabel(teamStage({} as TeamRecord))).toBe("idle")
  })
})

describe("the surface defect the stage closes", () => {
  test("a FENCED seat is not idle, and the payload renders it fenced", () => {
    /** A roster with one running and one fenced member, neither holding a task. */
    const record = teamOf([], [memberOf("alice"), memberOf("bob", { id: "M2", fenced: true, fencedReason: "compaction gave up" })])
    // The IDLE SET drives both dispatch and the web payload, so this one exclusion fixes both surfaces.
    expect(idleMembers(record).map((member) => member.name)).toEqual(["alice"])
    expect(idleMembers(record).some((member) => member.fenced === true)).toBe(false)
  })
})
