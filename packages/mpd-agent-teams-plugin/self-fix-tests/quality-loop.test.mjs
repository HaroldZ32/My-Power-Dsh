// t26 self-fix tests: recursive agent-teams tooling bugs.
// Covers the four fixed defect classes — premature review dispatch,
// cancelled-dependency deadlock, prompt reason delivery, false-reject loop —
// plus the prompt injections (reassignReason + captain guidance digest).
// Run: bun test packages/mpd-agent-teams-plugin/self-fix-tests
import { test, expect } from "bun:test"
import { validateCreateTask, planQualityFollowUp, hasValidQualityTaskFields } from "../lib/quality-gates.js"
import { unsatisfiedDependencies, resolveCancelledDependencyDeadlocks, dependencyStates } from "../lib/state.js"
import { collectCompletedDependencyOutputs, formatDependencyOutputs, assignmentPrompt } from "../lib/scheduler.js"

function task(id, kind, status, extra = {}) {
    return { id, kind, status, subject: id, dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1, ...extra }
}

test("Fix1: review auto-wires reviewedTaskId into dependencies (premature dispatch)", () => {
    const team = { phase: "running", halted: false, tasks: [task("t10", "implementation", "completed")] }
    const gate = validateCreateTask(team, {
        kind: "review", subject: "Review t10", objective: "Review", acceptance: ["ok"], reviewedTaskId: "t10", dependencies: [],
    })
    expect(gate.ok).toBe(true)
    expect(gate.task.dependencies).toContain("t10")
    // a review of a pending source stays blocked until the source completes
    const team2 = { phase: "running", halted: false, tasks: [task("t9", "implementation", "pending")] }
    const gate2 = validateCreateTask(team2, {
        kind: "review", subject: "Review t9", objective: "Review", acceptance: ["ok"], reviewedTaskId: "t9", dependencies: [],
    })
    expect(gate2.ok).toBe(true)
    expect(unsatisfiedDependencies(team2.tasks, gate2.task.dependencies)).toContain("t9")
    // explicit duplicate is deduped
    const gate3 = validateCreateTask(team, {
        kind: "review", subject: "Review t10", objective: "Review", acceptance: ["ok"], reviewedTaskId: "t10", dependencies: ["t10"],
    })
    expect(gate3.task.dependencies.filter((id) => id === "t10")).toHaveLength(1)
})

test("Fix1: repair auto-wires sourceTaskId into dependencies", () => {
    const team = { phase: "running", halted: false, tasks: [task("t10", "implementation", "completed")] }
    const gate = validateCreateTask(team, {
        kind: "repair", subject: "repair", objective: "Fix", acceptance: ["done"], inScope: ["x"], verify: ["true"],
        sourceTaskId: "t10", sourceFindingIds: ["F1"], dependencies: [],
    })
    expect(gate.ok).toBe(true)
    expect(gate.task.dependencies).toContain("t10")
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
    const tasks = [
        task("t14", "review", "cancelled"),
        task("t15", "review", "cancelled"),
        task("t19", "integration", "pending", { dependencies: ["t14", "t15"] }),
        task("t25", "integration", "pending", { dependencies: ["t20", "t21"] }),
        task("t20", "review", "in_progress"),
        task("t21", "review", "pending"),
    ]
    const victims = resolveCancelledDependencyDeadlocks(tasks, "dependency was cancelled")
    expect(victims).toContain("t19")
    expect(tasks.find((t) => t.id === "t19").status).toBe("cancelled")
    // t25 still has a live outstanding dep -> untouched
    expect(tasks.find((t) => t.id === "t25").status).toBe("pending")
    // idempotent
    expect(resolveCancelledDependencyDeadlocks(tasks, "again")).toEqual([])
})

test("Fix3: planQualityFollowUp links reasonTaskId and reason reaches the repair prompt", () => {
    const source = task("t10", "implementation", "completed", { output: "implemented everything" })
    const failedReview = task("t15", "review", "failed", {
        round: 1, verdict: "needs_revision", reviewedTaskId: "t10", output: "review found issues",
        findings: [
            { id: "F1", severity: "high", problem: "switch link dangles", requiredFix: "ship README.zh-CN.md", file: "scripts/pack-mpd.mjs", line: 59, resolved: false },
            { id: "F2", severity: "medium", problem: "deadlock", requiredFix: "cascade cancel", resolved: false },
        ],
    })
    const team = {
        phase: "running", halted: false, reviewPolicy: undefined, escalated: false,
        members: [
            { name: "Deep Worker", id: "m1", status: "idle", role: "implementation" },
            { name: "Plan Reviewer", id: "m2", status: "idle", role: "review" },
        ],
        tasks: [source, failedReview],
    }
    const planned = planQualityFollowUp(team, failedReview)
    const repair = planned.created.find((item) => item.kind === "repair")
    const review = planned.created.find((item) => item.kind === "review")
    expect(repair.reasonTaskId).toBe("t15")
    expect(repair.dependencies).toContain("t10")
    expect(review.reasonTaskId).toBe("t15")
    const allTasks = [...team.tasks, ...planned.created.map((draft) => ({ id: draft.id ?? draft.subject, ...draft, status: "pending", attempt: 0, dependencies: draft.dependencies ?? [] }))]
    const repairId = repair.id ?? repair.subject
    const inputs = collectCompletedDependencyOutputs(allTasks, repairId, () => {})
    const reasonItem = inputs.find((item) => item.id === "t15")
    expect(reasonItem).toBeDefined()
    expect(reasonItem.subject).toContain("reason, verdict=needs_revision")
    expect(reasonItem.output).toContain("switch link dangles")
    expect(reasonItem.output).toContain("Fix: ship README.zh-CN.md")
    const prompt = formatDependencyOutputs(inputs)
    expect(prompt).toContain("implemented everything")
    expect(prompt).toContain("reason, verdict=needs_revision")
})

test("Fix4: reject without a completed source notifies the captain only (no repair, no escalation)", () => {
    const source = task("t10", "implementation", "failed")
    const rejected = task("t15", "review", "failed", { round: 1, verdict: "reject", reviewedTaskId: "t10", findings: [{ id: "F1", severity: "high", problem: "no implementation", requiredFix: "rebuild", resolved: false }] })
    const team = { phase: "running", halted: false, reviewPolicy: undefined, escalated: false, members: [], tasks: [source, rejected] }
    const planned = planQualityFollowUp(team, rejected)
    expect(planned.created).toEqual([])
    expect(planned.escalated).not.toBe(true)
    expect(planned.notifyCaptain).toContain("no automatic repair was created")
})

test("Fix4: genuine reject of a completed source still escalates", () => {
    const source = task("t10", "implementation", "completed")
    const rejected = task("t15", "review", "failed", { round: 1, verdict: "reject", reviewedTaskId: "t10", findings: [{ id: "F1", severity: "high", problem: "fundamental", requiredFix: "rethink", resolved: false }] })
    const team = { phase: "running", halted: false, reviewPolicy: undefined, escalated: false, members: [], tasks: [source, rejected] }
    const planned = planQualityFollowUp(team, rejected)
    expect(planned.escalated).toBe(true)
})

test("Fix3b: reasonTaskId / reassignReason survive task validation", () => {
    const base = { id: "x", kind: "repair", status: "pending", subject: "s", dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1 }
    expect(hasValidQualityTaskFields({ ...base, reasonTaskId: "t15", reassignReason: "retry after feedback" })).toBe(true)
    expect(hasValidQualityTaskFields({ ...base, reasonTaskId: "" })).toBe(false)
    expect(hasValidQualityTaskFields({ ...base, reassignReason: "" })).toBe(false)
})

test("Fix3c: assignmentPrompt renders reassignReason and captain guidance digest", () => {
    const base = {
        taskId: "t9", memberName: "m", memberId: "mid", attempt: 1, attemptId: "a1",
        subject: "Fix", kind: "implementation", dependencyOutputs: [],
        teamDescription: "goal", protocol: undefined,
    }
    const withReason = assignmentPrompt({ ...base, reassignReason: "retry after review feedback" }, ".mpd/team", "t")
    expect(withReason).toContain("Reassignment reason: retry after review feedback")
    const withGuidance = assignmentPrompt({ ...base, captainMessages: [{ id: "m1", content: "please fix the README pair" }] }, ".mpd/team", "t")
    expect(withGuidance).toContain("Captain guidance (unread, delivered with this assignment):")
    expect(withGuidance).toContain("please fix the README pair")
    const plain = assignmentPrompt(base, ".mpd/team", "t")
    expect(plain).not.toContain("Captain guidance (unread")
    expect(plain).not.toContain("Reassignment reason:")
})
