// THE DISPATCH PRECONDITION: which tasks are observed at all.
//
// Reproduced from a real host start (2026-09-16): a plan the complexity gate had STAGED
// (`phase: "staged"`, `planReviewState: "awaiting_review"`), whose 12 tasks each carried an
// assignee and NO attempt, made the watchdog write one `never-started` incident AND print
// one console line PER TASK on every process start — for a plan nobody had approved, so
// nothing had been dispatched and nothing SHOULD have been:
//
//   [mpd-team-watchdog] NEVER-STARTED mpd-default task=t1 member=Planner attempt=(none) …
//
// The adopted scheduler writes the attempt id AT DISPATCH (`beginTaskAttempt(task, member)`
// in lib/scheduler.js, before the ticket is delivered), so a non-empty `attemptId` IS the
// record that a member was handed the task. A task with neither an attempt nor a stamp was
// never given to anybody — a staged plan awaiting review, a task correctly blocked on
// unfinished dependencies, or one the scheduler has not reached yet. None of those is a
// dispatch problem, and `never-started` (a CLAIMED task whose owner never stamped) must not
// be spent on them.
import { describe, expect, test } from "bun:test"
import { WatchdogEngine } from "../src/engine"
import { candidateFor } from "../src/machine"
import { appendHeartbeat } from "../src/store"
import { readIncidents } from "../src/sidecars"
import { pluginCtx, sandbox, testConfig, writeTeam, type TeamFixture } from "./support"

/** The 12 task ids of the staged plan that reproduced the flood. */
const STAGED_TASK_IDS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"]

/**
 * The staged plan's record shape, taken from the real `team.json`.
 *
 * @param dispatched - whether the scheduler has handed each task to its member (the
 *   `attemptId` it writes at dispatch), which is the only difference between the staged
 *   plan and a running one.
 */
function planFixture(dispatched: boolean): TeamFixture {
  return {
    id: "mpd-default",
    name: "MPD Default",
    phase: "staged",
    captainSessionId: "53a7f957-captain-session",
    members: [
      { id: "", name: "Planner", status: "idle" },
      { id: "", name: "Explorer", status: "idle" },
      { id: "", name: "Senior Engineer", status: "idle" },
    ],
    tasks: STAGED_TASK_IDS.map((id) => ({
      id,
      status: "pending",
      assignee: "Planner",
      ...(dispatched ? { attempt: 1, attemptId: "att-" + id } : {}),
    })),
  }
}

/** Tick one record once and return what landed on disk and in the console. */
async function tick(
  box: ReturnType<typeof sandbox>,
  record: TeamFixture,
  now: number,
  stamps: Array<{ memberKey: string; taskId: string; attemptId: string | null; teamId: string | null; at: number }> = [],
) {
  writeTeam(box, record)
  for (const stamp of stamps) {
    appendHeartbeat(box.workspace, box.stateDir, stamp.memberKey, {
      kind: "turn-start",
      at: stamp.at,
      member: stamp.memberKey,
      memberKey: stamp.memberKey,
      teamId: stamp.teamId,
      taskId: stamp.taskId,
      attemptId: stamp.attemptId,
      turnId: stamp.memberKey + "#1",
      workspace: box.workspace,
    })
  }
  const plugin = pluginCtx(box.workspace)
  const engine = new WatchdogEngine(
    plugin.__stub.adapter,
    plugin,
    testConfig({ stateDir: box.stateDir, deadTeamGraceMs: 0 }),
  )
  const result = await engine.tickOnce(now)
  return {
    result,
    incidents: readIncidents(box.workspace, box.stateDir),
    lines: plugin.warnings.filter((line) => line.includes("NEVER-STARTED")),
    holds: plugin.__stub.toolExecutes,
  }
}

describe("a staged plan is never a dispatch problem", () => {
  test("12 pending assigned tasks, no attempt and no stamp: NO record, NO console line, NO hold", async () => {
    const box = sandbox()
    try {
      const observed = await tick(box, planFixture(false), 1_789_530_153_225)
      expect(observed.incidents).toEqual([])
      expect(observed.lines).toEqual([])
      expect(observed.result.decisions).toEqual([])
      expect(observed.result.holds).toEqual([])
      expect(observed.holds).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("CONTROL: the same record WITH dispatch attempts still reports every never-started task", async () => {
    const box = sandbox()
    try {
      const observed = await tick(box, planFixture(true), 1_789_530_153_225)
      // The rule stays falsifiable: a member that was HANDED a task and never stamped is
      // still reported, once per task, with no hold and no escalation.
      expect(observed.incidents.length).toBe(STAGED_TASK_IDS.length)
      expect(observed.incidents.every((record) => record.kind === "never-started")).toBe(true)
      expect(observed.incidents.map((record) => record.taskId)).toEqual(STAGED_TASK_IDS)
      expect(observed.incidents.every((record) => record.attemptId !== "")).toBe(true)
      expect(observed.incidents.every((record) => record.hold === "not-requested")).toBe(true)
      expect(observed.lines.length).toBe(STAGED_TASK_IDS.length)
      expect(observed.holds).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("a REVOKED generation (attempt cleared, one old stamp) stays observable — and only that task does", async () => {
    const box = sandbox()
    try {
      // The adopted scheduler clears the attempt id when a first delivery fails
      // (lib/scheduler.js:669-687), and an amend can hand a task back to the pool. The task was
      // worked on, so it must not fall into the staged bucket: the stamp names an EARLIER attempt,
      // which the W11-2 filter (correctly) refuses to count as this generation's silence.
      const observed = await tick(box, planFixture(false), 1_789_530_153_225, [
        { memberKey: "Planner", taskId: "t1", attemptId: "att-t1-1", teamId: "mpd-default", at: 1_789_530_000_000 },
      ])
      expect(observed.incidents.map((record) => record.taskId)).toEqual(["t1"])
      expect(observed.incidents[0].kind).toBe("never-started")
      expect(observed.incidents[0].attemptId).toBe("")
      expect(observed.lines.length).toBe(1)
      expect(observed.holds).toEqual([])
    } finally {
      box.cleanup()
    }
  })
})

describe("candidateFor applies the precondition", () => {
  const tasks = [
    { id: "t1", status: "pending", assignee: "Planner" },
    { id: "t2", status: "pending", assignee: "Planner", attemptId: "att-t2" },
  ]

  test("an un-dispatched task is not a candidate; a dispatched one is", () => {
    const candidates = candidateFor({ id: "mpd-default", tasks }, () => [], (assignee) => assignee)
    expect(candidates.map((candidate) => candidate.taskId)).toEqual(["t2"])
    expect(candidates[0].attemptId).toBe("att-t2")
  })

  test("a stamp for the task keeps it observable even without a live attempt", () => {
    const candidates = candidateFor({ id: "mpd-default", tasks }, (key) =>
      key === "Planner" ? [{ kind: "turn-start", at: 5, member: "Planner", memberKey: "Planner", teamId: "mpd-default", taskId: "t1", attemptId: null, turnId: "Planner#1", workspace: "/w" }] : [],
    (assignee) => assignee)
    expect(candidates.map((candidate) => candidate.taskId)).toEqual(["t1", "t2"])
    expect(candidates[0].everStampedForTask).toBe(true)
  })

  test("an EARLIER generation's stamp still proves the task was worked on; another TEAM's does not", () => {
    const ownGeneration = candidateFor({ id: "mpd-default", tasks }, (key) =>
      key === "Planner" ? [{ kind: "turn-start", at: 5, member: "Planner", memberKey: "Planner", teamId: "mpd-default", taskId: "t1", attemptId: "att-t1-1", turnId: "Planner#1", workspace: "/w" }] : [],
    (assignee) => assignee)
    // Observable — and the W11-2 filter keeps it OUT of this generation's silence, so it is a
    // `never-started` observation, exactly as before the gate existed.
    expect(ownGeneration.map((candidate) => candidate.taskId)).toEqual(["t1", "t2"])
    expect(ownGeneration[0].everStampedForTask).toBe(false)

    const foreignTeam = candidateFor({ id: "mpd-default", tasks }, (key) =>
      key === "Planner" ? [{ kind: "turn-start", at: 5, member: "Planner", memberKey: "Planner", teamId: "other-team", taskId: "t1", attemptId: null, turnId: "Planner#1", workspace: "/w" }] : [],
    (assignee) => assignee)
    // A stamp from another team says nothing about THIS task: it cannot make an un-dispatched
    // task observable (that would re-open the flood through a same-named member of another team).
    expect(foreignTeam.map((candidate) => candidate.taskId)).toEqual(["t2"])
  })
})
