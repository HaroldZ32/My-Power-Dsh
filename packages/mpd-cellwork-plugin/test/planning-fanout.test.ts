// PLANNING FAN-OUT (§5.1), its PROMPT text (§5.2) and the SEAT-WIDTH WARNING (§5.3).
//
// These arms drive `stagePlanningTeam` and `submitSplit` DIRECTLY — no plugin boot — because the subject is
// the SHAPE of the staged plan (who is raised, which task blocks which) and the warn-never-refuse predicate,
// both of which are pure functions of the cell, the knobs and the tool answers. The boot-level shape stays
// covered by `flow.test.ts`, which is asserted at `analysts=0` — the contract's documented two-seat
// baseline (§5.4.2) — while THIS file asserts the shipped default (§5.4.1).
import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CELLWORK_CONFIG, type CellworkConfig } from "../src/config"
import { journalPath, newCellState, type CellState } from "../src/state"
import type { TeamsServiceView } from "../src/caller"
import {
  analysisTaskSubject,
  analystMemberName,
  analystRole,
  analystPrompt,
  carriedAnalysisLanes,
  convergedAnalysisLanes,
  planningAnalystCount,
  plannerPrompt,
  splitterPrompt,
  stagePlanningTeam,
  REQUIREMENTS_TASK_SUBJECT,
  SPLIT_TASK_SUBJECT,
  type StageDeps,
} from "../src/staging"
import { seatWidthReadings, seatWidthWarnings, submitSplit, type SplitTaskInput } from "../src/split"
import type { WindowReading } from "../src/budget"

/** The roster labels the persona reader and the split validator answer for. */
const ROSTER: readonly string[] = ["Planner", "Lead", "Explorer", "Researcher", "Senior Engineer", "Reviewer", "Deep Worker"]

/** One captured in-process tool call. */
interface TeamCall {
  /** The tool name (`agent_teams_plan`, `agent_teams_task`). */
  name: string
  /** Its argument object. */
  args: Record<string, unknown>
}

/** One staged member row, as the plan slot carries it. */
interface StagedMember {
  /** The board name. */
  name: string
  /** The roster role the seat is routed by. */
  role: string
  /** The instantiation prompt text. */
  prompt: string
}

/** One staged task row, as the plan slot carries it. */
interface StagedTask {
  /** The task subject, which is also its blocker reference inside the plan. */
  subject: string
  /** The declared owner's board name. */
  owner: string
  /** The task kind. */
  kind: string
  /** The declared blockers, by subject. */
  blockedBy: string[]
}

/** The staging double: a plan slot that `approve` turns into an in-memory team record. */
interface StagingHarness {
  /** The temp workspace the staging writes under. */
  workspace: string
  /** The cell being staged. */
  cell: CellState
  /** Every tool call the staging made, in order. */
  calls: TeamCall[]
  /** The approved team record, or undefined before an approval. */
  record: () => Record<string, unknown> | undefined
  /** The dependencies `stagePlanningTeam` receives. */
  deps: StageDeps
  /** The members the plan slot staged, in call order (empty until `add_member` ran). */
  members: () => StagedMember[]
  /** The tasks the plan slot staged, in call order. */
  tasks: () => StagedTask[]
  /**
   * Remove one row from the PLAN SLOT as the plan service would report it.
   *
   * A slot that lost a staged row is the corrupt shape the stale guard exists for, and this is what lets an
   * arm carry one lane by its task subject only and the other by its member name only.
   *
   * @param kind - the row family.
   * @param key - the member name (`member`) or the task subject (`task`).
   */
  dropPlanRow: (kind: "member" | "task", key: string) => void
  /**
   * Make ONE queued `agent_teams_plan` call answer as an error.
   *
   * `subject` narrows the failure to one `create_task` row, which is how an arm reproduces a pass that died
   * AFTER the analysis lanes were staged but BEFORE the split row was.
   *
   * @param action - the plan action to break.
   * @param subject - the task subject to break, for a `create_task` failure.
   */
  failNext: (action: string, subject?: string) => void
}

/**
 * Build the staging double for one analyst count.
 *
 * @param analysts - the `cellwork.planning.analysts` value the deps carry.
 * @returns the harness whose `deps` drive the real `stagePlanningTeam`.
 */
function makeStagingHarness(analysts: number): StagingHarness {
  /** The temp workspace staging writes its cell directory under. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-fanout-"))
  /** The one instant every row is stamped with. */
  const now = new Date("2026-11-11T00:00:00.000Z")
  /** The cell being staged. */
  const cell = newCellState({ cellId: "cell-20261111T000000000Z", objective: "ship the widget", captainSessionId: "session-captain", now })
  /** Every captured call. */
  const calls: TeamCall[] = []
  /** The plan slot, once created. */
  let plan: Record<string, unknown> | undefined
  /** The approved team record, once approved. */
  let record: Record<string, unknown> | undefined
  /** The next board id number. */
  let boardId = 0
  /** The ONE queued failure, or undefined when this pass must succeed. */
  let failure: { action: string; subject?: string } | undefined
  /** The plan's member rows. */
  const planMembers: StagedMember[] = []
  /** The plan's task rows. */
  const planTasks: StagedTask[] = []

  /**
   * Answer one `agent_teams_plan` call.
   * @param args - the call's arguments.
   * @returns the tool-shaped answer.
   */
  const answerPlan = (args: Record<string, unknown>): { ok: boolean; isError: boolean; value?: unknown; error?: string } => {
    /** The action being driven. */
    const action = String(args.action ?? "")
    // THE QUEUED FAILURE: one matching call answers as an error, which is how an arm dies at an exact
    // point in the staging order (after the lanes, before the split row; or at the approval).
    /** The task one `create_task` names, which a queued subject failure is matched against. */
    const taskArg = typeof args.task === "object" && args.task !== null ? args.task as Record<string, unknown> : undefined
    if (failure !== undefined && failure.action === action && (failure.subject === undefined || String(taskArg?.subject ?? "") === failure.subject)) {
      failure = undefined
      return { ok: false, isError: true, error: "the injected " + action + " failure" }
    }
    if (action === "status") return { ok: true, isError: false, value: { plan, team: record } }
    if (action === "create") {
      plan = { planId: "plan-1", name: args.name, description: args.description, members: [], tasks: [] }
      return { ok: true, isError: false, value: { plan } }
    }
    if (action === "add_member") {
      /** The member the caller asked for. */
      const member = args.member as Record<string, unknown>
      /** The staged row, kept beside the plan object so a test can read it without casts. */
      const staged: StagedMember = { name: String(member.name), role: String(member.role), prompt: String(member.prompt) }
      // APPRAISED SLOT vs LIVE TEAM: a staged member row is appended to the plan; once the plan is approved
      // the recovery path raises a missing seat on the EXISTING team, which is the append arm the double
      // must mirror (it is what gives that seat its executor handle).
      if (plan === undefined || plan.approvedAt === undefined) {
        planMembers.push(staged)
        plan = { ...(plan ?? {}), members: [...planMembers] }
        return { ok: true, isError: false, value: { plan } }
      }
      /** The live team record, which this append mutates. */
      const team = record as { members: Array<Record<string, unknown>> } | undefined
      if (team === undefined) throw new Error("no plan and no team")
      /** The roster row the live append mints. */
      const added = { id: "M" + String(team.members.length + 1), name: staged.name, role: staged.role, status: "running", executorRef: "handle-" + staged.name }
      team.members.push(added)
      return { ok: true, isError: false, value: { team: record, member: added, spawned: added.executorRef } }
    }
    if (action === "create_task") {
      /** The task the caller asked for. */
      const task = args.task as Record<string, unknown>
      /** The staged row. */
      const staged: StagedTask = {
        subject: String(task.subject),
        owner: String(task.owner),
        kind: String(task.kind ?? "work"),
        blockedBy: Array.isArray(task.blocked_by) ? task.blocked_by.map((entry) => String(entry)) : [],
      }
      // THE SAME TWO ARMS AS `add_member`: a staged row lands on the PLAN, a live row on the approved team.
      if (plan === undefined || plan.approvedAt === undefined) {
        planTasks.push(staged)
        plan = { ...(plan ?? {}), tasks: [...planTasks] }
        return { ok: true, isError: false, value: { plan } }
      }
      /** The live team record, which this append mutates. */
      const team = record as { tasks: Array<Record<string, unknown>> } | undefined
      if (team === undefined) throw new Error("no plan and no team")
      boardId += 1
      /** The board row the live append mints. */
      const row = { id: "T" + String(boardId), subject: staged.subject, description: String(task.description ?? ""), kind: staged.kind, status: "pending", owner: staged.owner, blockedBy: staged.blockedBy, writeScopes: [] }
      team.tasks.push(row)
      return { ok: true, isError: false, value: { team: record, task: row } }
    }
    if (action === "approve") {
      /** The board rows the approval mints, in plan order. */
      const boardTasks = planTasks.map((task) => {
        boardId += 1
        return { id: "T" + String(boardId), subject: task.subject, owner: task.owner, status: "pending", kind: task.kind, blockedBy: task.blockedBy, writeScopes: [] }
      })
      /** The member rows the approval raises. */
      const boardMembers = planMembers.map((member, index) => ({ id: "M" + String(index + 1), name: member.name, role: member.role, status: "running", executorRef: "handle-" + member.name }))
      record = { teamId: "team-1", members: boardMembers, tasks: boardTasks }
      plan = { ...(plan ?? {}), approvedAt: now.toISOString() }
      return {
        ok: true,
        isError: false,
        value: {
          team: record,
          created: {
            members: boardMembers.map((member) => ({ name: member.name, id: member.executorRef })),
            tasks: boardTasks.map((task) => ({ subject: task.subject, id: task.id })),
          },
        },
      }
    }
    throw new Error("unexpected plan action " + action)
  }

  /** The team-plane double `resolveSplitTicket` reads after the approval. */
  const teams: TeamsServiceView = { get: (_workspace: string, _teamId: string): unknown => record }

  /** The dependencies `stagePlanningTeam` receives. */
  const deps: StageDeps = {
    dsh: {
      executeTool: async (input: { name: string; arguments?: unknown }): Promise<{ ok: boolean; isError: boolean; value?: unknown; error?: string }> => {
        /** The arguments, read as a record because every caller here passes an object. */
        const args = typeof input.arguments === "object" && input.arguments !== null ? input.arguments as Record<string, unknown> : {}
        calls.push({ name: input.name, args })
        if (input.name === "agent_teams_plan") return answerPlan(args)
        // The split-ticket owner repair is the only other call staging makes; the double's record always
        // carries the splitter as owner, so a claim is never needed — answering ok keeps the arm honest if
        // that ever changes.
        return { ok: true, isError: false, value: {} }
      },
      workspaceRoot: (): string => workspace,
    },
    workspace,
    cell,
    captainAgent: { id: "session-captain" },
    personaFor: (label: string): string | null => (ROSTER.includes(label) ? label.toUpperCase() + " PERSONA TEXT" : null),
    teams: (): TeamsServiceView => teams,
    config: { ...DEFAULT_CELLWORK_CONFIG, planningAnalysts: analysts } as CellworkConfig,
    now,
  }

  return {
    workspace,
    cell,
    calls,
    record: (): Record<string, unknown> | undefined => record,
    deps,
    members: (): StagedMember[] => planMembers,
    tasks: (): StagedTask[] => planTasks,
    dropPlanRow: (kind: "member" | "task", key: string): void => {
      if (kind === "member") {
        /** The index of the member row to remove. */
        const index = planMembers.findIndex((member) => member.name === key)
        if (index >= 0) planMembers.splice(index, 1)
        plan = { ...(plan ?? {}), members: [...planMembers] }
        return
      }
      /** The index of the task row to remove. */
      const index = planTasks.findIndex((task) => task.subject === key)
      if (index >= 0) planTasks.splice(index, 1)
      plan = { ...(plan ?? {}), tasks: [...planTasks] }
    },
    failNext: (action: string, subject?: string): void => { failure = { action, ...(subject === undefined ? {} : { subject }) } },
  }
}

// ── §5.4.1: the fan-out shape ───────────────────────────────────────────────

test("analysts=3 stages FIVE seats and FIVE tasks, alternating roles, with the split blocked by every lane", async () => {
  /** The staging double, at the contract's own example count. */
  const harness = makeStagingHarness(3)
  /** The staging outcome. */
  const staged = await stagePlanningTeam(harness.deps)
  expect(staged.ok).toBe(true)
  expect(staged.teamId).toBe("team-1")
  // ONE approve for the whole planning team, and no second team.
  expect(harness.calls.filter((call) => call.name === "agent_teams_plan" && call.args.action === "approve")).toHaveLength(1)
  expect(harness.calls.filter((call) => call.name === "agent_teams_plan" && call.args.action === "create")).toHaveLength(1)
  // THE SEATS, in board order: the two permanent identities first (guard/recon/flow key on their names),
  // then one analysis lane per analyst, alternating the two read-only roster roles.
  expect(harness.members().map((member) => member.name)).toEqual(["cell-planner", "cell-splitter", "cell-analyst-1", "cell-analyst-2", "cell-analyst-3"])
  expect(harness.members().map((member) => member.role)).toEqual(["Planner", "Lead", "Explorer", "Researcher", "Explorer"])
  // THE TASKS: the requirements root, one ROOT per analysis lane (read-only work writes nothing, so it
  // declares no write scope), and the split blocked by the requirements task AND every lane.
  expect(harness.tasks().map((task) => [task.subject, task.owner, task.kind])).toEqual([
    [REQUIREMENTS_TASK_SUBJECT, "cell-planner", "requirement"],
    ["analysis-1", "cell-analyst-1", "work"],
    ["analysis-2", "cell-analyst-2", "work"],
    ["analysis-3", "cell-analyst-3", "work"],
    [SPLIT_TASK_SUBJECT, "cell-splitter", "work"],
  ])
  expect(harness.tasks()[0]?.blockedBy).toEqual([])
  expect(harness.tasks()[1]?.blockedBy).toEqual([])
  expect(harness.tasks()[4]?.blockedBy).toEqual([REQUIREMENTS_TASK_SUBJECT, "analysis-1", "analysis-2", "analysis-3"])
  // THE CELL RECORD's rows: all five seats, each with the persona text in its prompt (a team member gets
  // no roster persona from the harness, so the prompt IS the discipline).
  expect(Object.keys(staged.members ?? {})).toEqual(["cell-planner", "cell-splitter", "cell-analyst-1", "cell-analyst-2", "cell-analyst-3"])
  expect(staged.members?.["cell-analyst-2"]?.role).toBe("Researcher")
  expect(staged.members?.["cell-analyst-3"]?.executorRef).toBe("handle-cell-analyst-3")
  expect(harness.members()[2]?.prompt).toContain("EXPLORER PERSONA TEXT")
  expect(harness.members()[3]?.prompt).toContain("RESEARCHER PERSONA TEXT")
  // The split ticket is resolved and recorded from the board read.
  expect(staged.tasks?.splitId).toBe("T5")
})

test("the shipped DEFAULT is two analysis lanes (analysts=2 stages four seats)", async () => {
  /** The default knobs, read through the same predicate staging uses. */
  expect(planningAnalystCount(DEFAULT_CELLWORK_CONFIG)).toBe(2)
  /** The staging double at the shipped default. */
  const harness = makeStagingHarness(DEFAULT_CELLWORK_CONFIG.planningAnalysts)
  /** The staging outcome. */
  const staged = await stagePlanningTeam(harness.deps)
  expect(staged.ok).toBe(true)
  expect(harness.members().map((member) => member.name)).toEqual(["cell-planner", "cell-splitter", "cell-analyst-1", "cell-analyst-2"])
  expect(harness.tasks()).toHaveLength(4)
})

// ── §5.4.2: analysts=0 is the two-seat baseline ─────────────────────────────

test("analysts=0 stages exactly the two seats and the two tasks this module shipped before", async () => {
  /** The staging double with the fan-out switched off. */
  const harness = makeStagingHarness(0)
  /** The staging outcome. */
  const staged = await stagePlanningTeam(harness.deps)
  expect(staged.ok).toBe(true)
  expect(harness.members().map((member) => member.name)).toEqual(["cell-planner", "cell-splitter"])
  expect(harness.members().map((member) => member.role)).toEqual(["Planner", "Lead"])
  expect(harness.tasks().map((task) => task.subject)).toEqual([REQUIREMENTS_TASK_SUBJECT, SPLIT_TASK_SUBJECT])
  expect(harness.tasks()[1]?.blockedBy).toEqual([REQUIREMENTS_TASK_SUBJECT])
  expect(staged.tasks?.splitId).toBe("T2")
})

test("a value the plan cannot express falls back to the shipped default, never to zero", () => {
  // The config resolver already refuses these; the guard exists because the count decides the TEAM SHAPE,
  // and a fractional or out-of-range value would stage a seat that cannot exist.
  expect(planningAnalystCount({ planningAnalysts: 2.5 })).toBe(DEFAULT_CELLWORK_CONFIG.planningAnalysts)
  expect(planningAnalystCount({ planningAnalysts: 9 })).toBe(DEFAULT_CELLWORK_CONFIG.planningAnalysts)
  expect(planningAnalystCount({ planningAnalysts: -1 })).toBe(DEFAULT_CELLWORK_CONFIG.planningAnalysts)
  expect(planningAnalystCount({ planningAnalysts: 0 })).toBe(0)
  expect(planningAnalystCount({ planningAnalysts: 8 })).toBe(8)
})

test("the seat names and roles are derived, and lane 1 is always Explorer", () => {
  expect(analystMemberName(1)).toBe("cell-analyst-1")
  expect(analystRole(1)).toBe("Explorer")
  expect(analystRole(2)).toBe("Researcher")
  expect(analystRole(3)).toBe("Explorer")
  expect(analysisTaskSubject(4)).toBe("analysis-4")
})

// ── §5.4.5: an abandoned analysis lane does not wedge the start ─────────────

test("an analysis lane that never settles does not wedge the idempotent path, and a failed lane row is tolerated", async () => {
  /** The staging double at the shipped default. */
  const harness = makeStagingHarness(2)
  /** The first staging, which approves the team without waiting for any lane. */
  const first = await stagePlanningTeam(harness.deps)
  expect(first.ok).toBe(true)
  // THE BOARD SHAPE after the approval: both analysis rows are still PENDING and nothing in staging waits
  // for them — the cell is startable while the lanes work, which is the "not wedged" half of §5.4.
  /** The approved record. */
  const record = harness.record() as { tasks: Array<Record<string, unknown>> }
  expect(record.tasks.filter((task) => task.status === "pending").map((task) => task.subject)).toContain("analysis-1")
  // A lane that DIED: one analysis row is now `failed` on the board. The captain's retry (the idempotent
  // path) reads only the split ticket, so a failed analysis lane neither blocks it nor refuses it — the
  // captain closes the lane, the start still completes.
  /** That record, with one lane failed. */
  const failedLane = { ...record, tasks: record.tasks.map((task) => (task.subject === "analysis-1" ? { ...task, status: "failed" } : task)) }
  /** The same deps, reading the mutated record through the team service. */
  const retried = { ...harness.deps, cell: { ...harness.cell, teamId: "team-1" }, teams: (): TeamsServiceView => ({ get: (): unknown => failedLane }) }
  /** The retry's outcome. */
  const second = await stagePlanningTeam(retried)
  expect(second.ok).toBe(true)
  expect(second.alreadyStaged).toBe(true)
  expect(second.tasks?.splitId).toBe("T4")
})

// ── §5.2: the binding prompt text ───────────────────────────────────────────

test("the planner prompt carries the MAXIMUM-PARALLELISM section and keeps the ONE-question rule for the USER only", () => {
  /** The planner prompt under test. */
  const prompt = plannerPrompt({ cell: makeStagingHarness(2).cell, personaFor: (): string | null => null })
  expect(prompt).toContain("MAXIMUM PARALLELISM")
  expect(prompt).toContain("MORE AGENTS IS THE DEFAULT")
  expect(prompt).toContain("Run INDEPENDENT investigations")
  expect(prompt).toContain("`cellwork_delegate` starts a BATCH of background consults in ONE call")
  expect(prompt).toContain("cell-analyst-1 … cell-analyst-K")
  // The interview rule STAYS, and it is scoped to the USER.
  expect(prompt).toContain("Ask the USER ONE question at a time")
  expect(prompt).not.toContain("1. Ask ONE question at a time.")
})

test("the splitter prompt lists `member` with its one-seat/multi-seat explanation, the caps and the no-token-saving rule", () => {
  /** The splitter prompt under test. */
  const prompt = splitterPrompt({ cell: makeStagingHarness(2).cell, personaFor: (): string | null => null, config: { ...DEFAULT_CELLWORK_CONFIG } })
  // `member` is IN the literal field list, and its own bullet says what omitting/naming it does.
  expect(prompt).toContain("{key, subject, description, kind, ownerRole, member, writeScopes, blockedBy, inputs, verify}")
  expect(prompt).toContain("member: the BOARD MEMBER the task is raised for")
  expect(prompt).toContain("THE PARALLELISM SWITCH")
  expect(prompt).toContain("MUST")
  expect(prompt).toContain("declare DIFFERENT member names")
  // The caps, with their configured values.
  expect(prompt).toContain("`cellwork.seats.maxPerRole` (" + String(DEFAULT_CELLWORK_CONFIG.seatsMaxPerRole) + ")")
  expect(prompt).toContain("`cellwork.seats.max` (" + String(DEFAULT_CELLWORK_CONFIG.seatsMax) + ")")
  // The no-token-saving rule, and the budget's scope.
  expect(prompt).toContain("NEVER reduce the number of agents or lanes to save tokens")
  expect(prompt).toContain("a larger, more parallel graph is the GOAL")
  expect(prompt).toContain("IT BOUNDS ONE TASK'S SIZE — never the task COUNT")
})

test("an analysis lane's prompt charges it to reconnoitre and to MAIL both planning seats", () => {
  /** The lane prompt under test. */
  const prompt = analystPrompt({ cell: makeStagingHarness(2).cell, personaFor: (): string | null => null }, 2)
  expect(prompt).toContain("cell-analyst-2")
  expect(prompt).toContain("READ-ONLY lane")
  expect(prompt).toContain("cellwork_send {to:\"cell-planner\"")
  expect(prompt).toContain("cellwork_send {to:\"cell-splitter\"")
  expect(prompt).toContain("MAIL THE FINDINGS")
  expect(prompt).toContain("agent_teams_task {action:\"complete\"")
})

// ── §5.3 + §5.4.4: the seat-width warning ───────────────────────────────────

/**
 * Build one split task with the given key/role/member/blockers.
 *
 * @param key - the task key.
 * @param ownerRole - its owner role.
 * @param member - its declared board member, when it declares one.
 * @param blockedBy - its declared blockers.
 * @returns the task row the validator and the width computation read.
 */
function task(key: string, ownerRole: string, member: string | undefined, blockedBy: string[]): SplitTaskInput {
  return {
    key,
    subject: "Task " + key,
    description: "Do the thing for " + key + ".",
    kind: "work",
    ownerRole,
    ...(member === undefined ? {} : { member }),
    writeScopes: ["src/" + key + ".ts"],
    blockedBy,
    independent: blockedBy.length === 0,
    inputs: [],
    verify: false,
  }
}

test("four independent Reviewer tasks with ONE member name earn exactly one warning naming role, width and the name", () => {
  /** The submitted graph: four tasks that can all be ready at once, all on one seat. */
  const tasks = [task("a", "Reviewer", "Reviewer", []), task("b", "Reviewer", "Reviewer", []), task("c", "Reviewer", "Reviewer", []), task("d", "Reviewer", "Reviewer", [])]
  /** The widths the computation reports. */
  const readings = seatWidthReadings(tasks)
  expect(readings).toHaveLength(1)
  expect(readings[0]?.role).toBe("Reviewer")
  expect(readings[0]?.width).toBe(4)
  expect(readings[0]?.members).toEqual(["Reviewer"])
  /** The advisories. */
  const warnings = seatWidthWarnings(tasks)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]?.code).toBe("seat-width-short")
  expect(warnings[0]?.taskKey).toBe("Reviewer")
  expect(warnings[0]?.detail).toContain("Reviewer")
  expect(warnings[0]?.detail).toContain("4 task(s) ready")
  expect(warnings[0]?.detail).toContain("1 board member name(s) (Reviewer)")
  expect(warnings[0]?.detail).toContain("\"Reviewer-2\"")
})

test("four distinct member names on one role earn NO warning", () => {
  /** The submitted graph: the same width, one seat per task. */
  const tasks = [task("a", "Reviewer", "Reviewer", []), task("b", "Reviewer", "Reviewer-2", []), task("c", "Reviewer", "Reviewer-3", []), task("d", "Reviewer", "Reviewer-4", [])]
  expect(seatWidthReadings(tasks)[0]?.width).toBe(4)
  expect(seatWidthReadings(tasks)[0]?.members).toEqual(["Reviewer", "Reviewer-2", "Reviewer-3", "Reviewer-4"])
  expect(seatWidthWarnings(tasks)).toHaveLength(0)
})

test("four tasks CHAINED in a line earn NO warning: their width is one", () => {
  /** The submitted graph: a strict dependency line, so only one task of the role is ever ready. */
  const tasks = [task("a", "Reviewer", "Reviewer", []), task("b", "Reviewer", "Reviewer", ["a"]), task("c", "Reviewer", "Reviewer", ["b"]), task("d", "Reviewer", "Reviewer", ["c"])]
  expect(seatWidthReadings(tasks)[0]?.width).toBe(1)
  expect(seatWidthWarnings(tasks)).toHaveLength(0)
})

test("the width crosses roles through another role's tasks, and ordered pairs never widen it", () => {
  // Two Reviewer tasks that depend on DIFFERENT work tasks: neither waits for the other, so both can be
  // ready at once even though they share a member — the width must see through the other role's rows.
  const tasks = [
    task("w1", "Senior Engineer", undefined, []),
    task("w2", "Senior Engineer", undefined, []),
    task("r1", "Reviewer", "Reviewer", ["w1"]),
    task("r2", "Reviewer", "Reviewer", ["w2"]),
    // A third Reviewer task that waits for r1 AND r2: it can never be ready with either of them.
    task("r3", "Reviewer", "Reviewer", ["r1", "r2"]),
  ]
  /** The Reviewer reading. */
  const reviewer = seatWidthReadings(tasks).find((reading) => reading.role === "Reviewer")
  expect(reviewer?.width).toBe(2)
  // BOTH roles are under-declared here: the two Senior Engineer tasks are independent and name no seat, so
  // each role earns its own advisory, in first-declaration order.
  expect(seatWidthWarnings(tasks).map((warning) => warning.taskKey)).toEqual(["Senior Engineer", "Reviewer"])
})

test("the width warning NEVER refuses the graph: it rides on an ACCEPTED verdict and is journaled with the split", async () => {
  /** The temp workspace the split measures under. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-width-"))
  /** The cell the split belongs to. */
  const cellId = "cell-20261111T000000000Z"
  /** A certified window, so the budget accepts every task. */
  const reading: WindowReading = { provider: "deepseek-official", model: "deepseek-flash", window: 1000000, provenance: "catalog", maxOutputTokens: 8192 }
  /** The submitted graph: four independent work tasks on ONE declared seat. */
  const tasks = [task("a", "Reviewer", "Reviewer", []), task("b", "Reviewer", "Reviewer", []), task("c", "Reviewer", "Reviewer", []), task("d", "Reviewer", "Reviewer", [])]
  /** The persisted verdict. */
  const verdict = await submitSplit({
    workspace,
    cellId,
    config: { ...DEFAULT_CELLWORK_CONFIG },
    roster: [...ROSTER, "cell-planner", "cell-splitter"],
    window: async (): Promise<WindowReading> => reading,
    now: new Date("2026-11-11T00:00:00.000Z"),
  }, { revision: 1, tasks })
  // ACCEPTED, with the advisory beside it — the warn-never-refuse rule.
  expect(verdict.accepted).toBe(true)
  expect(verdict.warnings.filter((warning) => warning.code === "seat-width-short")).toHaveLength(1)
  // JOURNALED WITH THE SPLIT: the row is on disk beside the verdict file.
  expect(readFileSync(journalPath(workspace, cellId), "utf8")).toContain("split-seat-width-warning")
})

// ── R2 repair: a resume converges on the lanes the PLAN carries ─────────────

test("R2 repair: the lane set converges on the carried carriers, and the configured count only seeds an empty slot", () => {
  // The rule under test: the configured count is a FRESH slot's intent; once lanes are carried (by a task
  // SUBJECT or a member NAME), those are the fact the split row can still be blocked by.
  expect(convergedAnalysisLanes(3, [])).toEqual([1, 2, 3])
  expect(convergedAnalysisLanes(3, [1, 2])).toEqual([1, 2])
  expect(convergedAnalysisLanes(0, [2, 1])).toEqual([1, 2])
  expect(carriedAnalysisLanes(["analysis-1", "Implementation", "analysis-2"], ["cell-planner", "cell-analyst-3"])).toEqual([1, 2, 3])
  expect(carriedAnalysisLanes(["analysis-1"], ["Reviewer"])).toEqual([1])
})

test("R2 repair arm 1: a resume with a LARGER configured count leaves the split blocked by every analysis task the plan carries", async () => {
  /** The staging double at the count the first pass uses. */
  const harness = makeStagingHarness(2)
  // THE FIRST PASS DIES AT THE SPLIT ROW: both lanes are staged, the split task never is.
  harness.failNext("create_task", SPLIT_TASK_SUBJECT)
  /** The failed pass. */
  const failed = await stagePlanningTeam(harness.deps)
  expect(failed.ok).toBe(false)
  expect(harness.tasks().map((task) => task.subject)).toEqual([REQUIREMENTS_TASK_SUBJECT, "analysis-1", "analysis-2"])
  // THE RESUME MEETS A LARGER KNOB (2 → 3). It must converge on the plan's lanes: a third lane staged now
  // would be an analysis row the slot's split row can never name as a blocker.
  /** The resumed pass, configured for one lane more than the plan carries. */
  const resumed = await stagePlanningTeam({ ...harness.deps, config: { ...harness.deps.config, planningAnalysts: 3 } })
  expect(resumed.ok).toBe(true)
  expect(resumed.teamId).toBe("team-1")
  // The plan carries exactly the lanes it started with, now with the split row…
  expect(harness.tasks().map((task) => task.subject)).toEqual([REQUIREMENTS_TASK_SUBJECT, "analysis-1", "analysis-2", SPLIT_TASK_SUBJECT])
  // …and the split is blocked by EVERY analysis task the plan carries, plus the interview.
  expect(harness.tasks()[3]?.blockedBy).toEqual([REQUIREMENTS_TASK_SUBJECT, "analysis-1", "analysis-2"])
  // No seat was invented for the lane the plan never had.
  expect(harness.members().map((member) => member.name)).toEqual(["cell-planner", "cell-splitter", "cell-analyst-1", "cell-analyst-2"])
})

test("R2 repair: a carried split row whose declared blockers omit a lane is REFUSED, never trusted", async () => {
  /** The staging double whose first pass dies at the APPROVAL, so the plan keeps its split row. */
  const harness = makeStagingHarness(2)
  harness.failNext("approve")
  expect((await stagePlanningTeam(harness.deps)).ok).toBe(false)
  // THE CORRUPT SLOT a pre-fix build could leave behind: the split row names only the interview.
  /** That row. */
  const splitRow = harness.tasks().find((task) => task.subject === SPLIT_TASK_SUBJECT)
  if (splitRow === undefined) throw new Error("expected a staged split row")
  splitRow.blockedBy = [REQUIREMENTS_TASK_SUBJECT]
  /** The resume's refusal. */
  const resumed = await stagePlanningTeam(harness.deps)
  expect(resumed.ok).toBe(false)
  expect(String(resumed.error)).toContain("not blocked by analysis-1, analysis-2")
  expect(String(resumed.error)).toContain("delete")
  expect(resumed.partial).toBe(true)
})

test("R2 carry: a carried split row exposing NEITHER blocker spelling is UNPROVEN — no refusal, and the plan stays usable", async () => {
  // THE ACKNOWLEDGED BYPASS, pinned so it cannot silently become a refusal (or a silent pass with different
  // semantics). A host on a THIRD spelling exposes no blocker list, so the stale guard must NOT wedge a plan
  // it cannot judge: the trade is unproven beats wedged.
  /** The staging double whose first pass dies at the APPROVAL, so the plan keeps its split row. */
  const harness = makeStagingHarness(2)
  harness.failNext("approve")
  expect((await stagePlanningTeam(harness.deps)).ok).toBe(false)
  // THE UNPROVEN ROW: the split row carries NEITHER `blockedBy` nor `blocked_by` — a dialect this build does
  // not recognize, so the guard has no list to judge.
  /** That row. */
  const splitRow = harness.tasks().find((task) => task.subject === SPLIT_TASK_SUBJECT)
  if (splitRow === undefined) throw new Error("expected a staged split row")
  delete (splitRow as { blockedBy?: string[] }).blockedBy
  expect(Object.prototype.hasOwnProperty.call(splitRow, "blockedBy")).toBe(false)
  // And the slot lost one row of each half: lane 1 survives only as a TASK SUBJECT, lane 2 only as a MEMBER
  // NAME — so the resume also proves the lanes still converge from whichever half carries them.
  harness.dropPlanRow("task", "analysis-2")
  harness.dropPlanRow("member", "cell-analyst-1")
  // THE RESUME: no refusal, no wedge, and the carried split row is neither duplicated nor rewritten.
  /** The resumed pass. */
  const resumed = await stagePlanningTeam(harness.deps)
  expect(resumed.ok).toBe(true)
  expect(resumed.error).toBeUndefined()
  expect(resumed.partial).toBeUndefined()
  expect(typeof resumed.tasks?.splitId === "string" && (resumed.tasks?.splitId ?? "") !== "").toBe(true)
  expect(harness.tasks().filter((task) => task.subject === SPLIT_TASK_SUBJECT)).toHaveLength(1)
  // The lanes were converged from BOTH halves: lane 1 from its subject, lane 2 from its member name.
  expect(harness.tasks().filter((task) => task.subject.startsWith("analysis-")).map((task) => task.subject).sort()).toEqual(["analysis-1", "analysis-2"])
  // (The re-appended seat lands last, so the SET is what matters here, not the row order.)
  expect(harness.members().map((member) => member.name).sort()).toEqual(["cell-analyst-1", "cell-analyst-2", "cell-planner", "cell-splitter"])
  // The unproven row is left exactly as the slot carried it: the guard skipped it instead of inventing a list.
  expect(Object.prototype.hasOwnProperty.call(harness.tasks().find((task) => task.subject === SPLIT_TASK_SUBJECT) ?? {}, "blockedBy")).toBe(false)
})

test("R2 repair arm 2: the recovery path appends a missing seat WITH its board task, so the two sets agree", async () => {
  /** The staging double at the shipped default. */
  const harness = makeStagingHarness(2)
  expect((await stagePlanningTeam(harness.deps)).ok).toBe(true)
  /** The approved record, as the team service answers it (the double's documented in-memory row shape). */
  const record = harness.record() as { members: Array<Record<string, unknown>>; tasks: Array<Record<string, unknown>> } | undefined
  if (record === undefined) throw new Error("expected an approved record")
  // THE BROKEN SHAPE THE FINDING NAMES: one lane's board ROW never reached the team, and another lane's
  // SEAT never got raised.
  record.tasks = record.tasks.filter((task) => String(task.subject) !== "analysis-2")
  record.members = record.members.filter((member) => String(member.name) !== "cell-analyst-1")
  // THE RECOVERY: the cell claims no team, so the approved-but-unrecorded path runs.
  /** The recovered pass. */
  const recovered = await stagePlanningTeam({ ...harness.deps, cell: { ...harness.cell, teamId: "" } })
  expect(recovered.ok).toBe(true)
  expect(recovered.alreadyStaged).toBe(true)
  expect(Object.keys(recovered.members ?? {}).sort()).toEqual(["cell-analyst-1", "cell-analyst-2", "cell-planner", "cell-splitter"])
  // EVERY SEAT OWNS ITS ROW, AND EVERY ROW ITS SEAT — the agreement the finding asks for.
  /** The lane seats the live roster carries. */
  const laneSeats = record.members.map((member) => String(member.name)).filter((name) => name.startsWith("cell-analyst-"))
  /** The lane rows the live board carries. */
  const laneRows = record.tasks.filter((task) => String(task.subject).startsWith("analysis-")).map((task) => ({ subject: String(task.subject), owner: String(task.owner) }))
  expect(laneSeats.sort()).toEqual(["cell-analyst-1", "cell-analyst-2"])
  expect(laneRows).toEqual([{ subject: "analysis-1", owner: "cell-analyst-1" }, { subject: "analysis-2", owner: "cell-analyst-2" }])
  expect(laneRows.map((row) => row.owner).sort()).toEqual(laneSeats)
})
