// THE DISPATCH PRECONDITION: which tasks are observed at all.
//
// Reproduced from a real host start (2026-09-16): a plan the complexity gate had STAGED, whose
// 12 tasks each carried an assignee and NO attempt, made the watchdog write one `never-started`
// incident AND print one console line PER TASK on every process start — for a plan nobody had
// approved, so nothing had been dispatched and nothing SHOULD have been:
//
//   [mpd-team-watchdog] NEVER-STARTED mpd-default task=t1 member=Planner attempt=(none) …
//
// 0.1.7 REBASE — the SIGNAL changed, the RULE did not. The official board has NO assignee at
// create time: `team_task_create` produces an UNOWNED task and only `claim`/`reassign` sets
// `ownerName`. So "a plan nothing has been dispatched into" is literally a board of unowned tasks
// (they are not even candidates: an unowned task cannot be wedged), and "somebody was handed this"
// is an OWNED row — which is what the projection reports as `dispatched`. The retired record's
// `attemptId`-at-dispatch signal has no replacement and is not needed: ownership IS the dispatch
// record on the official plane.
//
// `never-started` (a CLAIMED task whose owner never stamped) must therefore still be spent only on
// an OWNED task, and a board of unowned tasks must stay completely silent.
import { describe, expect, test } from "bun:test"
import { WatchdogEngine, type TickResult } from "../src/engine"
import { candidateFor } from "../src/machine"
import { appendHeartbeat } from "../src/store"
import { readIncidents, type IncidentRecord } from "../src/sidecars"
import { pluginCtx, sandbox, testConfig, writeTeam, type TeamFixture } from "./support"

/** The 12 task ids of the staged plan that reproduced the flood. */
const STAGED_TASK_IDS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"]

/**
 * The plan's official shape: `claimed` names the tasks SOMEBODY HAS BEEN HANDED (an owned row),
 * `revisions` overrides a task's board revision (the generation token), and every other task is
 * an UNOWNED row exactly as `team_task_create` leaves it.
 *
 * @param claimed - the task ids that carry an owner (claim/reassign happened for them).
 * @param revisions - per-task board revision; default 1.
 */
function planFixture(claimed: string[], revisions: Record<string, number> = {}): TeamFixture {
  // The claimed ids, as a set the fixture spreads over the task rows.
  const owned = new Set(claimed)
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
      ...(owned.has(id) ? { assignee: "Planner", attempt: revisions[id] ?? 1 } : {}),
    })),
  }
}

/** Tick one record once and return what landed on disk and in the console. */
async function tick(
  box: ReturnType<typeof sandbox>,
  record: TeamFixture,
  now: number,
  stamps: Array<{ memberKey: string; taskId: string; attemptId: string | null; teamId: string | null; at: number }> = [],
): Promise<{ result: TickResult; incidents: IncidentRecord[]; lines: string[]; holds: string[] }> {
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
  // The plugin context stub, whose adapter the engine is driven with.
  const plugin = pluginCtx(box.workspace)
  // The engine under test, with the fast deterministic config.
  const engine = new WatchdogEngine(
    plugin.__stub.adapter,
    plugin,
    testConfig({ stateDir: box.stateDir, deadTeamGraceMs: 0 }),
  )
  // The tick's own result: decisions, scene paths and held team ids.
  const result = await engine.tickOnce(now)
  return {
    result,
    incidents: readIncidents(box.workspace, box.stateDir),
    lines: plugin.warnings.filter((line) => line.includes("NEVER-STARTED")),
    holds: plugin.__stub.toolExecutes,
  }
}

describe("a staged plan is never a dispatch problem", () => {
  test("12 UNOWNED pending tasks (a plan nothing was dispatched into): NO record, NO console line, NO hold", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // What the tick left on disk and in the console.
      const observed = await tick(box, planFixture([]), 1_789_530_153_225)
      expect(observed.incidents).toEqual([])
      expect(observed.lines).toEqual([])
      expect(observed.result.decisions).toEqual([])
      expect(observed.result.holds).toEqual([])
      expect(observed.holds).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("CONTROL: the same 12 tasks once CLAIMED still report every never-started task", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // What the control tick left on disk and in the console.
      const observed = await tick(box, planFixture(STAGED_TASK_IDS), 1_789_530_153_225)
      // The rule stays falsifiable: a member that was HANDED a task and never stamped is
      // still reported, once per task, with no hold and no escalation.
      expect(observed.incidents.length).toBe(STAGED_TASK_IDS.length)
      expect(observed.incidents.every((record) => record.kind === "never-started")).toBe(true)
      expect(observed.incidents.map((record) => record.taskId)).toEqual(STAGED_TASK_IDS)
      // The generation token is the projected official board revision, never empty.
      expect(observed.incidents.every((record) => record.attemptId === "1")).toBe(true)
      expect(observed.incidents.every((record) => record.hold === "not-requested")).toBe(true)
      expect(observed.lines.length).toBe(STAGED_TASK_IDS.length)
      expect(observed.holds).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("a task whose work came from an EARLIER revision stays observable — and only that task does", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // t1 is CLAIMED at board revision 2, i.e. its generation token is "2"; the hand-written
      // stamp names revision 1, an earlier generation. The stamp proves the task WAS worked on
      // (so it is not a never-dispatched row), and the W11-2 filter refuses to count it as THIS
      // generation's silence — so it is reported `never-started`, not warned about.
      const observed = await tick(box, planFixture(["t1"], { t1: 2 }), 1_789_530_153_225, [
        { memberKey: "Planner", taskId: "t1", attemptId: "1", teamId: "mpd-default", at: 1_789_530_000_000 },
      ])
      expect(observed.incidents.map((record) => record.taskId)).toEqual(["t1"])
      expect(observed.incidents[0].kind).toBe("never-started")
      expect(observed.incidents[0].attemptId).toBe("2")
      expect(observed.lines.length).toBe(1)
      expect(observed.holds).toEqual([])
    } finally {
      box.cleanup()
    }
  })
})

describe("candidateFor applies the precondition", () => {
  // Three board rows: un-dispatched, attempt-tokened, and ownership-dispatched.
  const tasks = [
    { id: "t1", status: "pending", assignee: "Planner" },
    { id: "t2", status: "pending", assignee: "Planner", attemptId: "att-t2" },
    { id: "t3", status: "pending", assignee: "Planner", dispatched: true },
  ]

  test("an un-dispatched task is not a candidate; a dispatched one is", () => {
    // The candidates the dispatch precondition admits from those rows.
    const candidates = candidateFor({ id: "mpd-default", tasks }, () => [], (assignee) => assignee)
    expect(candidates.map((candidate) => candidate.taskId)).toEqual(["t2", "t3"])
    expect(candidates[0].attemptId).toBe("att-t2")
    // The projection's own dispatch flag (ownership on the official board) is a sufficient signal
    // on its own, with no attempt information at all.
    expect(candidates[1].attemptId).toBe("")
  })

  test("a stamp for the task keeps it observable even without a live attempt", () => {
    // The candidates when a stamp, and not ownership, marks the first task as worked.
    const candidates = candidateFor({ id: "mpd-default", tasks }, (key) =>
      key === "Planner" ? [{ kind: "turn-start", at: 5, member: "Planner", memberKey: "Planner", teamId: "mpd-default", taskId: "t1", attemptId: null, turnId: "Planner#1", workspace: "/w" }] : [],
    (assignee) => assignee)
    expect(candidates.map((candidate) => candidate.taskId)).toEqual(["t1", "t2", "t3"])
    expect(candidates[0].everStampedForTask).toBe(true)
  })

  test("an EARLIER generation's stamp still proves the task was worked on; another TEAM's does not", () => {
    // Candidates when the only stamp names an earlier attempt of this same team.
    const ownGeneration = candidateFor({ id: "mpd-default", tasks }, (key) =>
      key === "Planner" ? [{ kind: "turn-start", at: 5, member: "Planner", memberKey: "Planner", teamId: "mpd-default", taskId: "t1", attemptId: "att-t1-1", turnId: "Planner#1", workspace: "/w" }] : [],
    (assignee) => assignee)
    // Observable — and the W11-2 filter keeps it OUT of this generation's silence, so it is a
    // `never-started` observation, exactly as before the gate existed.
    expect(ownGeneration.map((candidate) => candidate.taskId)).toEqual(["t1", "t2", "t3"])
    expect(ownGeneration[0].everStampedForTask).toBe(false)

    // Candidates when that stamp belongs to another team instead.
    const foreignTeam = candidateFor({ id: "mpd-default", tasks }, (key) =>
      key === "Planner" ? [{ kind: "turn-start", at: 5, member: "Planner", memberKey: "Planner", teamId: "other-team", taskId: "t1", attemptId: null, turnId: "Planner#1", workspace: "/w" }] : [],
    (assignee) => assignee)
    // A stamp from another team says nothing about THIS task: it cannot make an un-dispatched
    // task observable (that would re-open the flood through a same-named member of another team).
    expect(foreignTeam.map((candidate) => candidate.taskId)).toEqual(["t2", "t3"])
  })
})
