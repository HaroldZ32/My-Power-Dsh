// t26 self-fix tests: recursive agent-teams tooling bugs.
// Covers the four fixed defect classes — premature review dispatch,
// cancelled-dependency deadlock, prompt reason delivery, false-reject loop —
// plus the prompt injections (reassignReason + captain guidance digest).
// Run: bun test packages/mpd-agent-teams-plugin/self-fix-tests
import { test, expect } from "bun:test"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { validateCreateTask, planQualityFollowUp, hasValidQualityTaskFields } from "../lib/quality-gates.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { unsatisfiedDependencies, resolveCancelledDependencyDeadlocks, dependencyStates } from "../lib/state.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { collectCompletedDependencyOutputs, formatDependencyOutputs, assignmentPrompt } from "../lib/scheduler.ts"

/** The overridable fields of one task fixture. */
interface TaskOverrides {
    /** Overrides the dependency ids. */
    readonly dependencies?: readonly string[]
    /** Overrides the delivered output text. */
    readonly output?: string
    /** Overrides the review round number. */
    readonly round?: number
    /** Overrides the review verdict. */
    readonly verdict?: string
    /** Overrides the task this one reviews. */
    readonly reviewedTaskId?: string
    /** Overrides the findings a review recorded. */
    readonly findings?: readonly unknown[]
}

/** One task of the quality-loop fixture, in the shape the create gate and the deadlock resolver read. */
interface LoopTask {
    /** The task's id. */
    readonly id: string
    /** The task's kind. */
    readonly kind: string
    /** The task's status; `cancelled` and `failed` are what the deadlock arms vary. */
    readonly status: string
    /** The task's subject text. */
    readonly subject: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed, in epoch milliseconds. */
    readonly updatedAt: number
    /** The task's delivered output, which the prompt's dependency section renders. */
    readonly output?: string
    /** The review's round number. */
    readonly round?: number
    /** The review's verdict. */
    readonly verdict?: string
    /** The task this one reviews. */
    readonly reviewedTaskId?: string
    /** The findings a review recorded. */
    readonly findings?: readonly unknown[]
}

/** One task the follow-up planner created, as the arms read it back. */
interface PlannedItem {
    /** The created task's id, absent when the plan names it by subject only. */
    readonly id?: string
    /** The created task's subject. */
    readonly subject: string
    /** The created task's kind, which decides whether it is a repair or a review. */
    readonly kind: string
    /** Ids the created task depends on, absent when the planner declares none. */
    readonly dependencies?: readonly string[]
    /** The review or source task this created task exists for. */
    readonly reasonTaskId?: string
}

/** One dependency output the collector assembled for the assignment prompt. */
interface DependencyInput {
    /** The contributing task's id. */
    readonly id: string
    /** The contributing task's subject. */
    readonly subject: string
    /** The contributing task's output text, absent for a task that delivered none. */
    readonly output?: string
}

/** Build one task fixture; only the fields an arm varies are overridden. */
function task(id: string, kind: string, status: string, extra: TaskOverrides = {}): LoopTask {
    return { id, kind, status, subject: id, dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1, ...extra }
}

test("Fix1: review auto-wires reviewedTaskId into dependencies (premature dispatch)", () => {
/** The team whose t10 has already completed. */
    const team = { phase: "running", halted: false, tasks: [task("t10", "implementation", "completed")] }
/** The create gate's verdict for a review of that completed source. */
    const gate = validateCreateTask(team, {
        kind: "review", subject: "Review t10", objective: "Review", acceptance: ["ok"], reviewedTaskId: "t10", dependencies: [],
    })
    expect(gate.ok).toBe(true)
    expect(gate.task.dependencies).toContain("t10")
    // a review of a pending source stays blocked until the source completes
    const team2 = { phase: "running", halted: false, tasks: [task("t9", "implementation", "pending")] }
/** The create gate's verdict for a review of a still-pending source. */
    const gate2 = validateCreateTask(team2, {
        kind: "review", subject: "Review t9", objective: "Review", acceptance: ["ok"], reviewedTaskId: "t9", dependencies: [],
    })
    expect(gate2.ok).toBe(true)
    expect(unsatisfiedDependencies(team2.tasks, gate2.task.dependencies)).toContain("t9")
    // explicit duplicate is deduped
    const gate3 = validateCreateTask(team, {
        kind: "review", subject: "Review t10", objective: "Review", acceptance: ["ok"], reviewedTaskId: "t10", dependencies: ["t10"],
    })
    expect(gate3.task.dependencies.filter((id: string) => id === "t10")).toHaveLength(1)
})

test("Fix1: repair auto-wires sourceTaskId into dependencies (REQUALIFIED by T-81: terminal sources only)", () => {
    // T-81 (wave 2, lane A) requalified this pin: the auto-wire used to be UNCONDITIONAL, so the
    // same fixture with an OPEN source also acquired the edge and could never dispatch. The edge
    // stays exactly where its purpose holds — a source that has already finished.
    const team = { phase: "running", halted: false, tasks: [task("t10", "implementation", "completed")] }
/** The create gate's verdict for a repair of a completed source. */
    const gate = validateCreateTask(team, {
        kind: "repair", subject: "repair", objective: "Fix", acceptance: ["done"], inScope: ["x"], verify: ["true"],
        sourceTaskId: "t10", sourceFindingIds: ["F1"], dependencies: [],
    })
    expect(gate.ok).toBe(true)
    expect(gate.task.dependencies).toContain("t10")

    // An OPEN source keeps its PROVENANCE and loses the deadlock edge (see the T-81 arm below).
    for (const status of ["pending", "claimed", "in_progress"]) {
/** The single-task team for one OPEN source status. */
        const openTeam = { phase: "running", halted: false, tasks: [task("t10", "implementation", status)] }
/** The create gate's verdict for a repair of that OPEN source. */
        const openGate = validateCreateTask(openTeam, {
            kind: "repair", subject: "repair", objective: "Fix", acceptance: ["done"], inScope: ["x"], verify: ["true"],
            sourceTaskId: "t10", sourceFindingIds: ["F1"], dependencies: [],
        })
        expect(openGate.ok, `a repair on an OPEN (${status}) source was refused`).toBe(true)
        expect(openGate.task.sourceTaskId).toBe("t10")
        expect(openGate.task.dependencies).not.toContain("t10")
    }

    // ...while the failed/cancelled refusal (regression control) still fires THROUGH the edge.
    for (const status of ["failed", "cancelled"]) {
/** The single-task team for one terminal source status. */
        const deadTeam = { phase: "running", halted: false, tasks: [task("t10", "implementation", status)] }
/** The create gate's verdict, which must be a refusal naming the status. */
        const deadGate = validateCreateTask(deadTeam, {
            kind: "repair", subject: "repair", objective: "Fix", acceptance: ["done"], inScope: ["x"], verify: ["true"],
            sourceTaskId: "t10", sourceFindingIds: ["F1"], dependencies: [],
        })
        expect(deadGate.ok).toBe(false)
        expect(deadGate.error).toContain(`must not depend on ${status} task`)
    }
})

test("Fix2 + OPT-1: cancelled and FAILED deps are non-blocking; pending still blocks", () => {
    // OPT-1 (user decision 2026-09-13) superseded the old "failed still blocks"
    // rule: a failed dependency records the failure but no longer pins its
    // dependents. The failed id is surfaced through dependencyStates().failed.
    const tasks = [
        task("a", "work", "cancelled"),
        task("b", "work", "completed"),
        task("c", "work", "failed"),
        task("d", "work", "pending"),
    ]
    expect(unsatisfiedDependencies(tasks, ["a", "b"])).toEqual([])
    expect(unsatisfiedDependencies(tasks, ["c"])).toEqual([])
    expect(dependencyStates(tasks, ["c"])).toEqual({ blocking: [], failed: ["c"] })
    expect(unsatisfiedDependencies(tasks, ["d"])).toEqual(["d"])
    expect(unsatisfiedDependencies(tasks, ["a", "c"])).toEqual([])
    expect(dependencyStates(tasks, ["a", "c"])).toEqual({ blocking: [], failed: ["c"] })
    // a failed dep mixed with a pending one still blocks on the pending one only
    expect(unsatisfiedDependencies(tasks, ["c", "d"])).toEqual(["d"])
})

test("Fix2: pending dependents blocked only by cancelled deps are cascaded (no deadlock)", () => {
/** The mixed task set the deadlock resolver walks. */
    const tasks = [
        task("t14", "review", "cancelled"),
        task("t15", "review", "cancelled"),
        task("t19", "integration", "pending", { dependencies: ["t14", "t15"] }),
        task("t25", "integration", "pending", { dependencies: ["t20", "t21"] }),
        task("t20", "review", "in_progress"),
        task("t21", "review", "pending"),
    ]
/** The ids the resolver cascaded to `cancelled`. */
    const victims = resolveCancelledDependencyDeadlocks(tasks, "dependency was cancelled")
    expect(victims).toContain("t19")
    // The `!` is the fixture's own guarantee: t19 is in the array above, so the lookup cannot miss.
    expect(tasks.find((t: LoopTask) => t.id === "t19")!.status).toBe("cancelled")
    // t25 still has a live outstanding dep -> untouched
    // The `!` is the fixture's own guarantee: t25 is in the array above, so the lookup cannot miss.
    expect(tasks.find((t: LoopTask) => t.id === "t25")!.status).toBe("pending")
    // idempotent
    expect(resolveCancelledDependencyDeadlocks(tasks, "again")).toEqual([])
})

test("Fix3: planQualityFollowUp links reasonTaskId and reason reaches the repair prompt", () => {
/** The completed source the repair is generated for. */
    const source = task("t10", "implementation", "completed", { output: "implemented everything" })
/** The failed review whose findings drive the follow-up plan. */
    const failedReview = task("t15", "review", "failed", {
        round: 1, verdict: "needs_revision", reviewedTaskId: "t10", output: "review found issues",
        findings: [
            { id: "F1", severity: "high", problem: "switch link dangles", requiredFix: "ship README.zh-CN.md", file: "scripts/pack-mpd.mjs", line: 59, resolved: false },
            { id: "F2", severity: "medium", problem: "deadlock", requiredFix: "cascade cancel", resolved: false },
        ],
    })
/** The team the follow-up planner reads. */
    const team = {
        phase: "running", halted: false, reviewPolicy: undefined, escalated: false,
        members: [
            { name: "Deep Worker", id: "m1", status: "idle", role: "implementation" },
            { name: "Plan Reviewer", id: "m2", status: "idle", role: "review" },
        ],
        tasks: [source, failedReview],
    }
/** The planner's plan for that failed review. */
    const planned = planQualityFollowUp(team, failedReview)
/** The repair the plan created. */
    const repair = planned.created.find((item: PlannedItem) => item.kind === "repair")
/** The re-review the plan created. */
    const review = planned.created.find((item: PlannedItem) => item.kind === "review")
    expect(repair.reasonTaskId).toBe("t15")
    expect(repair.dependencies).toContain("t10")
    expect(review.reasonTaskId).toBe("t15")
/** The live task set plus the plan's drafts, in the shape the output collector reads. */
    const allTasks = [...team.tasks, ...planned.created.map((draft: PlannedItem) => ({ id: draft.id ?? draft.subject, ...draft, status: "pending", attempt: 0, dependencies: draft.dependencies ?? [] }))]
/** The repair's id, falling back to its subject when the planner assigned none. */
    const repairId = repair.id ?? repair.subject
/** The dependency outputs collected for the repair's assignment prompt. */
    const inputs = collectCompletedDependencyOutputs(allTasks, repairId, () => {})
/** The contributor carrying the review's reason and verdict. */
    const reasonItem = inputs.find((item: DependencyInput) => item.id === "t15")
    expect(reasonItem).toBeDefined()
    expect(reasonItem.subject).toContain("reason, verdict=needs_revision")
    expect(reasonItem.output).toContain("switch link dangles")
    expect(reasonItem.output).toContain("Fix: ship README.zh-CN.md")
/** The rendered dependency section of the prompt. */
    const prompt = formatDependencyOutputs(inputs)
    expect(prompt).toContain("implemented everything")
    expect(prompt).toContain("reason, verdict=needs_revision")
})

test("Fix4: reject without a completed source notifies the captain only (no repair, no escalation)", () => {
/** The source task, which FAILED rather than completed. */
    const source = task("t10", "implementation", "failed")
/** The rejecting review whose rejection must not spawn a repair. */
    const rejected = task("t15", "review", "failed", { round: 1, verdict: "reject", reviewedTaskId: "t10", findings: [{ id: "F1", severity: "high", problem: "no implementation", requiredFix: "rebuild", resolved: false }] })
/** The team those two tasks form. */
    const team = { phase: "running", halted: false, reviewPolicy: undefined, escalated: false, members: [], tasks: [source, rejected] }
/** The planner's plan, which must notify the captain and create nothing. */
    const planned = planQualityFollowUp(team, rejected)
    expect(planned.created).toEqual([])
    expect(planned.escalated).not.toBe(true)
    expect(planned.notifyCaptain).toContain("no automatic repair was created")
})

test("Fix4: genuine reject of a completed source still escalates", () => {
/** The source task, here COMPLETED. */
    const source = task("t10", "implementation", "completed")
/** The rejecting review of that completed source. */
    const rejected = task("t15", "review", "failed", { round: 1, verdict: "reject", reviewedTaskId: "t10", findings: [{ id: "F1", severity: "high", problem: "fundamental", requiredFix: "rethink", resolved: false }] })
/** The team those two tasks form. */
    const team = { phase: "running", halted: false, reviewPolicy: undefined, escalated: false, members: [], tasks: [source, rejected] }
/** The planner's plan, which must escalate on a genuine reject. */
    const planned = planQualityFollowUp(team, rejected)
    expect(planned.escalated).toBe(true)
})

test("Fix3b: reasonTaskId / reassignReason survive task validation", () => {
/** The minimal valid task record the two field pins are spread over. */
    const base = { id: "x", kind: "repair", status: "pending", subject: "s", dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1 }
    expect(hasValidQualityTaskFields({ ...base, reasonTaskId: "t15", reassignReason: "retry after feedback" })).toBe(true)
    expect(hasValidQualityTaskFields({ ...base, reasonTaskId: "" })).toBe(false)
    expect(hasValidQualityTaskFields({ ...base, reassignReason: "" })).toBe(false)
})

test("Fix3c: assignmentPrompt renders reassignReason and captain guidance digest", () => {
/** The assignment the prompt is rendered for. */
    const base = {
        taskId: "t9", memberName: "m", memberId: "mid", attempt: 1, attemptId: "a1",
        subject: "Fix", kind: "implementation", dependencyOutputs: [],
        teamDescription: "goal", protocol: undefined,
    }
/** The rendered prompt for an assignment carrying a reassignment reason. */
    const withReason = assignmentPrompt({ ...base, reassignReason: "retry after review feedback" }, ".mpd/team", "t")
    expect(withReason).toContain("Reassignment reason: retry after review feedback")
/** The rendered prompt for an assignment carrying unread captain guidance. */
    const withGuidance = assignmentPrompt({ ...base, captainMessages: [{ id: "m1", content: "please fix the README pair" }] }, ".mpd/team", "t")
    expect(withGuidance).toContain("Captain guidance (unread, delivered with this assignment):")
    expect(withGuidance).toContain("please fix the README pair")
/** The rendered prompt for an assignment carrying neither. */
    const plain = assignmentPrompt(base, ".mpd/team", "t")
    expect(plain).not.toContain("Captain guidance (unread")
    expect(plain).not.toContain("Reassignment reason:")
})
