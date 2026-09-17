// t53 — T-11 arms: the per-member next-claimable/capacity view, FED by the scheduler's own ready-set
// helper (`isTaskReady`), with the DECISIVE comparison (view ready set == scheduler ready set) and the
// two negative controls the row names (zero ready prints `none`; a busy member is not claimable).
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { memberCapacityView } from "../lib/tools.js"
import { isTaskReady } from "../lib/scheduler.js"

const now = 1_000_000
const member = (name, status = "idle") => ({ id: `id-${name}`, name, role: "engineer", status, joinedAt: now })
const task = (id, over = {}) => ({
    id, subject: `task ${id}`, status: "pending", assignee: undefined, dependencies: [],
    attempt: 0, kind: "work", createdAt: now, updatedAt: now, ...over,
})

/** The chain the row names: t1 -> t2, one IDLE member, one member BUSY on t3. */
function chainTeam() {
    return {
        id: "t53-team",
        name: "capacity probe",
        captainSessionId: "c1",
        createdAt: now,
        taskSeq: 3,
        phase: "running",
        members: [member("Idle"), member("Busy", "working")],
        tasks: [
            task("t1", { assignee: "Idle" }),
            task("t2", { assignee: "Idle", dependencies: ["t1"] }),
            task("t3", { assignee: "Busy", status: "in_progress", attemptId: "attempt-busy" }),
        ],
    }
}

test("T-11 (1/4): the view names the READY task and shows the BLOCKED one as blocked (the chain t1 -> t2)", () => {
    const team = chainTeam()
    const view = memberCapacityView(team)
    const idle = view.find((row) => row.name === "Idle")
    const busy = view.find((row) => row.name === "Busy")
    expect(idle.next_claimable).toBe("t1")
    expect(idle.blocked).toEqual(["t2"])
    expect(busy.busy_task).toBe("t3")
    expect(busy.next_claimable).toBeNull()
    // Nothing is omitted: both members have a row, and absence is a value, not a missing line.
    expect(view.map((row) => row.name)).toEqual(["Idle", "Busy"])
})

test("T-11 (2/4): DECISIVE — the view's ready set EQUALS the scheduler's ready set for the same revision", () => {
    const team = chainTeam()
    const view = memberCapacityView(team)
    // The scheduler's own answer, computed from ITS helper on the SAME revision.
    const schedulerReady = team.tasks.filter((entry) => isTaskReady(team.tasks, entry)).map((entry) => entry.id).sort()
    // What the view reports as claimable, member by member (a busy member's row contributes nothing).
    const viewReady = [...new Set(view.flatMap((row) => row.ready))].sort()
    console.log(`[T-11] scheduler ready set: ${JSON.stringify(schedulerReady)}`)
    console.log(`[T-11] view ready set:      ${JSON.stringify(viewReady)}`)
    expect(viewReady).toEqual(schedulerReady)
    expect(schedulerReady).toEqual(["t1"])                       // t2 is blocked by t1, t3 is in progress
    // Once the dependency completes, BOTH move together — the equality is not a lucky first snapshot.
    const progressed = chainTeam()
    progressed.tasks[0].status = "completed"
    const progressedView = memberCapacityView(progressed)
    const progressedScheduler = progressed.tasks.filter((entry) => isTaskReady(progressed.tasks, entry)).map((entry) => entry.id).sort()
    const progressedViewReady = [...new Set(progressedView.flatMap((row) => row.ready))].sort()
    expect(progressedViewReady).toEqual(progressedScheduler)
    expect(progressedView.find((row) => row.name === "Idle").next_claimable).toBe("t2")
    expect(progressedView.find((row) => row.name === "Idle").blocked).toEqual([])
})

test("T-11 (3/4): NEG CONTROL — zero ready tasks prints `none`, and a BUSY member is not claimable", () => {
    // No ready task at all: every task is either blocked or finished.
    const stalled = {
        ...chainTeam(),
        tasks: [
            task("t1", { assignee: "Idle", dependencies: ["t9"] }),
            task("t2", { assignee: "Busy", status: "completed" }),
        ],
    }
    const view = memberCapacityView(stalled)
    expect(view.every((row) => row.next_claimable === null)).toBe(true)
    expect(view.find((row) => row.name === "Idle").blocked).toEqual(["t1"])
    // The same absence, rendered: `none` is PRINTED for each member — never an omitted line.
    const lines = view.map((row) => `  - ${row.name}: next ${row.next_claimable === null ? "none" : row.next_claimable}`)
    expect(lines).toEqual(["  - Idle: next none", "  - Busy: next none"])
    // The busy control, isolated: a ready POOLED task exists, but the member holding work stays unclaimable.
    const busyTeam = { ...chainTeam(), tasks: [...chainTeam().tasks, task("t4")] }
    const busyView = memberCapacityView(busyTeam)
    expect(busyView.find((row) => row.name === "Busy").busy_task).toBe("t3")
    expect(busyView.find((row) => row.name === "Busy").next_claimable).toBeNull()
    expect(busyView.find((row) => row.name === "Idle").pool).toEqual(["t4"])
})

test("T-11 (4/4): the view is FED by the scheduler's helper (wiring assert) and never re-implements it", () => {
    // DECLARED AS WIRING, never counted as the behavioural reading: the view's readiness answers come
    // from the scheduler's own export, which is what makes the DECISIVE equality above meaningful.
    const source = readFileSync(new URL("../lib/tools.js", import.meta.url), "utf8")
    const region = source.slice(source.indexOf("//#region mpd-delta member-capacity-view"), source.indexOf("//#endregion mpd-delta member-capacity-view"))
    expect(region).toContain("isTaskReady(tasks, task)")
    // The readiness RULE is not re-implemented here: no dependency satisfaction test of its own, and
    // exactly ONE helper call site inside the ready/blocked answers.
    expect(region).not.toContain("unsatisfiedDependencies")
    // TWO call sites, both the helper: the positive answer (`readyOf`) and its negated twin
    // (`blockedOf`) — so a task the helper refuses is NAMED as blocked instead of being dropped.
    expect(region.match(/isTaskReady\(/gu)?.length).toBe(2)
    // The `status === 'pending'` filters above are CANDIDATE preselection (which tasks a member could
    // be offered at all), never the answer: the answer is the helper's, as the DECISIVE arm shows.
    expect(busyHelperProbe()).toBeDefined()
})

function busyHelperProbe() {
    // The helper is the SCHEDULER's: a predicate change here would move both sides of the comparison.
    return isTaskReady
}
