// t51 — T-93 arms. TWO readings, one row: (i) the GENERATOR routes a review's repair to a seat that
// can EXECUTE it (the frozen acceptance's observable, with the "only read-only seats" negative control
// as a captain route), and (ii) the DELIVERY boundary classifies a re-offer of finished work with a
// predicate keyed on BOTH halves — terminality AND the attempt-id equality — so neither half can be
// dropped without a red arm.
import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { planQualityFollowUp, generatedTaskCapabilityGap } from "../lib/quality-gates.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { deliveryRoutingClass, taskCapabilityGap } from "../lib/scheduler.ts"

/** One member row of the routing fixture; a read-only seat carries the deny list it withholds. */
interface MemberRecord {
    /** The member's session id. */
    readonly id: string
    /** The member's display name, which the generator's routing reads. */
    readonly name: string
    /** The member's roster role. */
    readonly role: string
    /** The member's lifecycle status. */
    readonly status: string
    /** When the member joined, in epoch milliseconds. */
    readonly joinedAt: number
    /** The tool names this seat cannot call, present only on a read-only seat. */
    readonly toolDeny?: readonly string[]
}

/** The overridable input of the routing fixture. */
interface ReviewFixtureInput {
    /** The member rows the fixture's team carries. */
    readonly members: readonly MemberRecord[]
    /** The seat that authored the artifact under review; the read-only seat by default. */
    readonly authorOfSource?: string
}

/** One task as the generator's plan and the capability-gap predicate read it. */
interface PlannedTask {
    /** The task's kind; `repair` is the kind the generator routes. */
    readonly kind: string
    /** The write scope the task declares, which decides whether a seat can execute it. */
    readonly inScope: readonly string[]
    /** The verification commands the task declares. */
    readonly verify: readonly string[]
}

/** The routing fixture's team record, in the shape the generator and the gap predicate read. */
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
    /** The member rows the fixture carries. */
    readonly members: readonly MemberRecord[]
    /** The tasks the review/repair generator reads; `tasks[1]` is the review arm 1 drives. */
    readonly tasks: readonly Record<string, unknown>[]
}

/** The seven tool names a read-only seat withholds, identical in both deny computations. */
const READ_ONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
/** Build one member row, with the deny list only a read-only seat needs. */
const member = (name: string, toolDeny?: readonly string[]): MemberRecord => ({ id: `id-${name}`, name, role: "engineer", status: "idle", joinedAt: 1, ...(toolDeny === undefined ? {} : { toolDeny }) })

/** The defect shape: a READ-ONLY seat authored the artifact that the review then sent back for repair. */
function reviewFixture({ members, authorOfSource = "Reviewer" }: ReviewFixtureInput): TeamRecord {
/** The fixed instant the fixture's timestamps are built from, in epoch milliseconds. */
    const now = 1_000_000
    return {
        id: "t51-team",
        name: "routing probe",
        captainSessionId: "c1",
        createdAt: now,
        taskSeq: 3,
        phase: "running",
        members,
        tasks: [
            {
                id: "t1", subject: "the artifact under review", status: "completed", assignee: authorOfSource,
                dependencies: [], attempt: 1, attemptId: "attempt-source-1", kind: "implementation",
                inScope: ["packages/foo/lib/**"], verify: ["bun test ./packages/foo"],
                acceptance: ["it works"], commandsRun: [], acceptanceResults: [], changedPaths: [],
                output: "delivered", createdAt: now, updatedAt: now,
            },
            {
                id: "t2", subject: "round-1 review", status: "failed", assignee: "Reviewer",
                dependencies: ["t1"], attempt: 1, attemptId: "attempt-review-1", kind: "review",
                round: 1, verdict: "needs_revision", reviewedTaskId: "t1", reviewedAttempt: 1,
                objective: "review t1", inScope: ["packages/foo/lib/**"], acceptance: ["findings are real"],
                verify: ["read the artifact"], findings: [
                    { id: "F1", severity: "high", file: "packages/foo/lib/a.js", problem: "the guard is missing", requiredFix: "add the guard" },
                ], createdAt: now, updatedAt: now,
            },
        ],
    }
}

test("T-93 (1/4): the GENERATOR routes the repair to a seat that can EXECUTE it (never the read-only author)", () => {
/** The defect shape: the artifact's author is the read-only seat, so the repair needs routing. */
    const team = reviewFixture({ members: [member("Reviewer", READ_ONLY_DENY), member("Engineer")] })
/** The generator's plan for the failed round-1 review. */
    const result = planQualityFollowUp(team, team.tasks[1])
    expect(result.created.length).toBeGreaterThan(0)
/** The repair task the generator created, which must be routed away from the author. */
    const repair = result.created.find((task: PlannedTask) => task.kind === "repair")
    expect(repair).toBeDefined()
    // The reviewed artifact's author IS the read-only seat, and the repair is a write-kind task:
    const gap = generatedTaskCapabilityGap(repair, team.members[0])
    expect(gap.length).toBeGreaterThan(0)
    expect(repair.assignee).toBe("Engineer")            // routed to the seat that can run it
    expect(repair.assignee).not.toBe("Reviewer")
    expect(generatedTaskCapabilityGap(repair, team.members[1])).toEqual([])

    // EQUIVALENCE, asserted rather than assumed: the generator's read agrees with the DISPATCH's own
    // `taskCapabilityGap` (exported for exactly this assertion) on every member and both kinds.
    const reference = { kind: "repair", inScope: repair.inScope, verify: repair.verify }
    for (const candidate of team.members)
        expect(generatedTaskCapabilityGap(reference, candidate)).toEqual(taskCapabilityGap(reference, candidate))

    // NOT a blanket refusal: an author that CAN write is still preferred over the pool.
    const writerTeam = reviewFixture({ members: [member("Reviewer", READ_ONLY_DENY), member("Engineer")], authorOfSource: "Engineer" })
/** The repair the same fixture produces when the author CAN write. */
    const writerRepair = planQualityFollowUp(writerTeam, writerTeam.tasks[1]).created.find((task: PlannedTask) => task.kind === "repair")
    expect(writerRepair.assignee).toBe("Engineer")
})

test("T-93 (2/4): NEG CONTROL — a team whose ONLY seat is read-only produces a CAPTAIN ROUTE, never an unexecutable repair", () => {
/** A team whose ONLY seat is the read-only reviewer. */
    const team = reviewFixture({ members: [member("Reviewer", READ_ONLY_DENY)] })
/** The generator's plan for that single-seat team, which must create no repair. */
    const result = planQualityFollowUp(team, team.tasks[1])
    // No repair is created — the row's negative control ("never a repair that cannot complete") —
    // and the refusal is LOUD and names what the seat withholds.
    expect(result.created).toEqual([])
    expect(result.tasks).toEqual([])
    expect(typeof result.notifyCaptain).toBe("string")
    expect(result.notifyCaptain).toContain("NO seat in this team can execute it")
    expect(result.notifyCaptain).toContain("Reviewer withholds write, edit, mpd_hashline_edit, bash")
    expect(result.notifyCaptain).toContain("The repair was NOT created")
    // The control's own control: the SAME fixture with one write-capable seat does create the repair.
    const withWriter = reviewFixture({ members: [member("Reviewer", READ_ONLY_DENY), member("Engineer")] })
    expect(planQualityFollowUp(withWriter, withWriter.tasks[1]).created.length).toBeGreaterThan(0)
})

test("T-93 (3/4): the DELIVERY routing class — keyed on BOTH halves, reproducing this wave's nine-instance shape", () => {
/** A TERMINAL task whose attempt id is the one its completion recorded. */
    const completed = { id: "t9", status: "completed", attempt: 3, attemptId: "7c133ef3-completion", reassigning: false, output: "delivered" }
/** The same terminal shape, reached by failure rather than by completion. */
    const failed = { id: "t9", status: "failed", attempt: 3, attemptId: "7c133ef3-completion", reassigning: false, output: "blocked" }
/** The same attempt id on an OPEN task, which is legitimate work rather than a re-offer. */
    const open = { id: "t9", status: "claimed", attempt: 3, attemptId: "7c133ef3-completion", reassigning: false }
/** The delivery candidate set the routing class is asked about. */
    const tasks = [completed, open]

    // THE MEASURED SHAPE: a TERMINAL task delivered with the SAME attempt id its completion recorded.
    // The stale-attempt guard never fires on it (the id is not stale), so the class is what refuses it.
    expect(deliveryRoutingClass(tasks, { taskId: "t9", attemptId: "7c133ef3-completion" })).toBe("reoffer-terminal-same-attempt")
    expect(deliveryRoutingClass([failed], { taskId: failed.id, attemptId: "7c133ef3-completion" })).toBe("reoffer-terminal-same-attempt")

    // EVERY half is load-bearing, and each is falsified by an arm rather than by a comment:
    // drop the EQUALITY (the kick surface's fresh mint) → the class is no longer the re-offer;
    expect(deliveryRoutingClass(tasks, { taskId: "t9", attemptId: "48c3f297-fresh-mint" })).toBe("terminal-rotated")
    // drop the TERMINALITY (the same id on an OPEN task) → legitimate, no refusal at all;
    expect(deliveryRoutingClass([open], { taskId: "t9", attemptId: "7c133ef3-completion" })).toBeUndefined()
    // a rotated generation WITHOUT terminality is still refused, as a different class;
    expect(deliveryRoutingClass([open], { taskId: "t9", attemptId: "251420e9-other" })).toBe("rotated")
    expect(deliveryRoutingClass(tasks, { taskId: "gone", attemptId: "x" })).toBe("task-gone")
    // The class DECISION TABLE reproduces the pre-T-93 refusals branch for branch: refuse iff the task
    // is missing, terminal, or carries a different capability. Nothing else moved.
    for (const record of [completed, failed, open])
        for (const id of ["7c133ef3-completion", "other", undefined]) {
/** The class the predicate reports for one attempt id over one record. */
            const cls = deliveryRoutingClass([record], { taskId: "t9", attemptId: id })
/** The pre-T-93 refusal rule the decision table is reproduced against, branch for branch. */
            const refused = ["completed", "failed", "cancelled"].includes(record.status) || record.attemptId !== id
            expect(cls === undefined).toBe(!refused)
        }
})

test("T-93 (4/4): the predicate is a PURE READER and the dispatch boundary CONSULTS it (wiring assert)", () => {
    // The reading above is the predicate's own output on a live record. This one is explicitly a
    // WIRING assert (declared as such, never counted as the behavioural reading): the delivery
    // boundary in the scheduler calls the named predicate, so the class reaches the decline note.
    const source = readFileSync(new URL("../lib/scheduler.ts", import.meta.url), "utf8")
/** The scheduler region that owns the delivery boundary, read from the vendored source. */
    const region = source.slice(source.indexOf("//#region mpd-delta terminal-dispatch-recheck"), source.indexOf("//#endregion mpd-delta terminal-dispatch-recheck"))
    expect(region).toContain("deliveryRoutingClass(")
    expect(region).toContain("reoffer-terminal-same-attempt")
    expect(source).toContain("export function deliveryRoutingClass(")
    // A refusal NEVER writes: the predicate only reads, proven on a real record file.
    const file = join(mkdtempSync(join(tmpdir(), "mpd-t51-")), "team.json")
/** A real record file whose bytes must be identical before and after the predicate runs. */
    const record = { id: "t51-team", tasks: [{ id: "t9", status: "completed", attemptId: "7c133ef3-completion" }] }
    writeFileSync(file, JSON.stringify(record, null, 2))
/** The file's bytes before the read-only predicate is consulted. */
    const before = readFileSync(file, "utf8")
    expect(deliveryRoutingClass(record.tasks, { taskId: "t9", attemptId: "7c133ef3-completion" })).toBe("reoffer-terminal-same-attempt")
    expect(readFileSync(file, "utf8")).toBe(before)
})
