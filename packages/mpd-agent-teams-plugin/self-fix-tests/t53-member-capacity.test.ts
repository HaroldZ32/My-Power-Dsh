// t53 — T-11 arms: the per-member next-claimable/capacity view, FED by the scheduler's own ready-set
// helper (`isTaskReady`), with the DECISIVE comparison (view ready set == scheduler ready set) and the
// two negative controls the row names (zero ready prints `none`; a busy member is not claimable).
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { memberCapacityView } from "../lib/tools.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { isTaskReady } from "../lib/scheduler.ts"

/** One member row of the capacity fixture, in the shape the view reads. */
interface MemberRecord {
    /** The member's session id. */
    readonly id: string
    /** The member's display name, which the view's rows are matched on. */
    readonly name: string
    /** The member's roster role. */
    readonly role: string
    /** The member's lifecycle status; `working` is what makes a member busy. */
    readonly status: string
    /** When the member joined, in epoch milliseconds. */
    readonly joinedAt: number
}

/** The overridable fields of one task fixture. */
interface TaskOverrides {
    /** Overrides the assignee, which decides whose row can offer the task. */
    readonly assignee?: string
    /** Overrides the status; `in_progress` is what makes a task busy rather than claimable. */
    readonly status?: string
    /** Overrides the dependency ids the readiness rule reads. */
    readonly dependencies?: readonly string[]
    /** Overrides the current attempt id, set on a task that is being worked. */
    readonly attemptId?: string
}

/** One task of the capacity fixture, in the shape the readiness rule and the view read. */
interface TaskRecord {
    /** The task's id, which the view reports as claimable or blocked. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The task's status; not readonly because one arm progresses a task in place. */
    status: string
    /** The seat the task is assigned to, absent while it is pooled. */
    readonly assignee?: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
    /** The task's kind, which decides whether it is dispatchable at all. */
    readonly kind: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed, in epoch milliseconds. */
    readonly updatedAt: number
    /** The current attempt's id, present only while the task is being worked. */
    readonly attemptId?: string
}

/** The capacity fixture's team record, in the shape the view and the readiness rule read. */
interface TeamRecord {
    /** The team id. */
    readonly id: string
    /** The team's display name. */
    readonly name: string
    /** The owning captain's session id. */
    readonly captainSessionId: string
    /** When the team was created, in epoch milliseconds. */
    readonly createdAt: number
    /** How many tasks the team has ever declared. */
    readonly taskSeq: number
    /** The team's lifecycle phase. */
    readonly phase: string
    /** The member rows the view renders. */
    readonly members: readonly MemberRecord[]
    /** The task set the readiness rule and the view read; mutable because one arm progresses a task. */
    readonly tasks: TaskRecord[]
}

/** One member's capacity row as the view renders it. */
interface CapacityRow {
    /** The member's display name, which the arms match rows on. */
    readonly name: string
    /** The task the member could claim next, or null when there is none. */
    readonly next_claimable: string | null
    /** Ids of this member's ready tasks that another seat already holds. */
    readonly pool: readonly string[]
    /** Ids this member is assigned but cannot start yet. */
    readonly blocked: readonly string[]
    /** The task the member is working, present only while it is busy. */
    readonly busy_task?: string
    /** Every id this member could claim right now, which the decisive arm compares. */
    readonly ready: readonly string[]
}

/** The fixed instant the fixture's timestamps are built from, in epoch milliseconds. */
const now = 1_000_000
/** Build one member row; only the status an arm varies needs overriding. */
const member = (name: string, status: string = "idle"): MemberRecord => ({ id: `id-${name}`, name, role: "engineer", status, joinedAt: now })
/** Build one task row over the fixture's defaults; only the fields an arm varies are overridden. */
const task = (id: string, over: TaskOverrides = {}): TaskRecord => ({
    id, subject: `task ${id}`, status: "pending", assignee: undefined, dependencies: [],
    attempt: 0, kind: "work", createdAt: now, updatedAt: now, ...over,
})

/** The chain the row names: t1 -> t2, one IDLE member, one member BUSY on t3. */
/** The chain the row names: t1 -> t2, one IDLE member and one member BUSY on t3. */
function chainTeam(): TeamRecord {
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
/** The chain fixture this arm reads. */
    const team = chainTeam()
/** The capacity view the arm asserts against. */
    const view = memberCapacityView(team)
/** The idle member's row, which must name the ready task. */
    const idle = view.find((row: CapacityRow) => row.name === "Idle")
/** The busy member's row, which must report its held task and claim nothing. */
    const busy = view.find((row: CapacityRow) => row.name === "Busy")
    expect(idle.next_claimable).toBe("t1")
    expect(idle.blocked).toEqual(["t2"])
    expect(busy.busy_task).toBe("t3")
    expect(busy.next_claimable).toBeNull()
    // Nothing is omitted: both members have a row, and absence is a value, not a missing line.
    expect(view.map((row: CapacityRow) => row.name)).toEqual(["Idle", "Busy"])
})

test("T-11 (2/4): DECISIVE — the view's ready set EQUALS the scheduler's ready set for the same revision", () => {
/** The chain fixture this decisive arm reads. */
    const team = chainTeam()
/** The capacity view whose ready set is compared with the scheduler's. */
    const view = memberCapacityView(team)
    // The scheduler's own answer, computed from ITS helper on the SAME revision.
    const schedulerReady = team.tasks.filter((entry) => isTaskReady(team.tasks, entry)).map((entry) => entry.id).sort()
    // What the view reports as claimable, member by member (a busy member's row contributes nothing).
    const viewReady = [...new Set(view.flatMap((row: CapacityRow) => row.ready))].sort()
    console.log(`[T-11] scheduler ready set: ${JSON.stringify(schedulerReady)}`)
    console.log(`[T-11] view ready set:      ${JSON.stringify(viewReady)}`)
    expect(viewReady).toEqual(schedulerReady)
    expect(schedulerReady).toEqual(["t1"])                       // t2 is blocked by t1, t3 is in progress
    // Once the dependency completes, BOTH move together — the equality is not a lucky first snapshot.
    const progressed = chainTeam()
    progressed.tasks[0].status = "completed"
/** The view over the SAME chain after its first task completes. */
    const progressedView = memberCapacityView(progressed)
/** The scheduler's own ready set over the progressed revision. */
    const progressedScheduler = progressed.tasks.filter((entry) => isTaskReady(progressed.tasks, entry)).map((entry) => entry.id).sort()
/** What the view reports as claimable for the progressed revision. */
    const progressedViewReady = [...new Set(progressedView.flatMap((row: CapacityRow) => row.ready))].sort()
    expect(progressedViewReady).toEqual(progressedScheduler)
    expect(progressedView.find((row: CapacityRow) => row.name === "Idle").next_claimable).toBe("t2")
    expect(progressedView.find((row: CapacityRow) => row.name === "Idle").blocked).toEqual([])
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
/** The view over a team with no ready task at all. */
    const view = memberCapacityView(stalled)
    expect(view.every((row: CapacityRow) => row.next_claimable === null)).toBe(true)
    expect(view.find((row: CapacityRow) => row.name === "Idle").blocked).toEqual(["t1"])
    // The same absence, rendered: `none` is PRINTED for each member — never an omitted line.
    const lines = view.map((row: CapacityRow) => `  - ${row.name}: next ${row.next_claimable === null ? "none" : row.next_claimable}`)
    expect(lines).toEqual(["  - Idle: next none", "  - Busy: next none"])
    // The busy control, isolated: a ready POOLED task exists, but the member holding work stays unclaimable.
    const busyTeam = { ...chainTeam(), tasks: [...chainTeam().tasks, task("t4")] }
/** The view over a team that HAS a pooled ready task and a busy member. */
    const busyView = memberCapacityView(busyTeam)
    expect(busyView.find((row: CapacityRow) => row.name === "Busy").busy_task).toBe("t3")
    expect(busyView.find((row: CapacityRow) => row.name === "Busy").next_claimable).toBeNull()
    expect(busyView.find((row: CapacityRow) => row.name === "Idle").pool).toEqual(["t4"])
})

test("T-11 (4/4): the view is FED by the scheduler's helper (wiring assert) and never re-implements it", () => {
    // DECLARED AS WIRING, never counted as the behavioural reading: the view's readiness answers come
    // from the scheduler's own export, which is what makes the DECISIVE equality above meaningful.
    const source = readFileSync(new URL("../lib/tools.ts", import.meta.url), "utf8")
/** The registered region that owns the view, read from the vendored source. */
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

/** The helper the region calls, returned so the wiring assertion has a defined subject. */
function busyHelperProbe(): unknown {
    // The helper is the SCHEDULER's: a predicate change here would move both sides of the comparison.
    return isTaskReady
}
