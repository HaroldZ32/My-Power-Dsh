// T-81 (wave 2, lane A) — `kind=repair` + `sourceTaskId` created an IMPLICIT dependency that could
// DEADLOCK.
//
// MEASURED (wave 1, `t21`): a repair created on a task whose own `verify` was blocked by the very
// defect the repair existed to fix acquired the implicit edge `repair -> source`, so the repair
// waited for a source that could only complete AFTER the repair — the captain had to take the task
// over to break the cycle (`.mpd/team/archive/friction-p1-wave/team.json`, task `t21`).
//
// THE FIX (`lib/quality-gates.js`, `validateCreateTask`, the repair auto-wire): the edge is wired
// only for a NON-open source. `completed` keeps the protection the edge was written for;
// `failed`/`cancelled` keep the edge so the existing refusal still fires; an OPEN source
// (`pending`/`claimed`/`in_progress`) keeps `sourceTaskId` as PROVENANCE and acquires no edge.
//
// The arm's own falsification: the second case runs the same fixture against a scratch copy of
// `lib/` with the condition neutralised (the pre-fix unconditional wire) and asserts the pair
// PARKS — a structural absence test cannot go red, this can.
import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { validateCreateTask } from "../lib/quality-gates.js"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { unsatisfiedDependencies } from "../lib/state.js"

/** The overridable fields of one task fixture. */
interface TaskOverrides {
    /** The verification commands the task declares; the deadlock arm names the guard here. */
    readonly verify?: readonly string[]
    /** The task this one reviews, for the regression-control arm. */
    readonly reviewedTaskId?: string
}

/** One task of the fixture, in the shape the create gate and the readiness rule read. */
interface TaskRecord {
    /** The task's id. */
    readonly id: string
    /** The task's kind. */
    readonly kind: string
    /** The task's status; an OPEN status is what the deadlock arm needs. */
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
    /** The verification commands the task declares. */
    readonly verify?: readonly string[]
}

/** The team fixture the create gate reads. */
interface TeamLike {
    /** The team's lifecycle phase. */
    readonly phase: string
    /** Whether the team is halted. */
    readonly halted: boolean
    /** The task set. */
    readonly tasks: readonly TaskRecord[]
}

/** The vendored plugin's `lib/` directory, which the negative control copies. */
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
/** The vendored `_deps/` closure the scratch copy symlinks, so the copied lib resolves. */
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")

/** Build one task over the fixture's defaults; only the fields an arm varies are overridden. */
const task = (id: string, kind: string, status: string, extra: TaskOverrides = {}): TaskRecord => ({ id, kind, status, subject: id, dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1, ...extra })

/**
 * The wave-1 shape, as a two-task fixture: source A is `in_progress` and its own `verify` names the
 * guard the repair R exists to land, so A cannot complete before R does.
 */
/** The wave-1 shape as a two-task fixture: an OPEN source whose own verify needs the repair. */
function deadlockFixture(): { team: TeamLike; repairInput: Record<string, unknown> } {
/** The open source task whose verify names the guard the repair exists to land. */
    const source = task("A", "implementation", "in_progress", {
        verify: ["bun test packages/dsh-qa (the guard R lands)"],
    })
    return {
        team: { phase: "running", halted: false, tasks: [source] },
        repairInput: {
            kind: "repair",
            subject: "R — land the guard A's verify needs",
            objective: "Close the guard that blocks A",
            acceptance: ["the guard refuses"],
            inScope: ["packages/beta/**"],
            verify: ["bun test packages/beta"],
            sourceTaskId: "A",
            sourceFindingIds: ["F1"],
            dependencies: [],
        },
    }
}

test("T-81: a repair on an OPEN source does NOT acquire the deadlock edge, and is claimable at once", () => {
/** The deadlock fixture and the repair input the create gate judges. */
    const { team, repairInput } = deadlockFixture()
/** The create gate's verdict for a repair on an OPEN source. */
    const gate = validateCreateTask(team, repairInput)
    expect(gate.ok).toBe(true)
    // Provenance survives; the dependency does not.
    expect(gate.task.sourceTaskId).toBe("A")
    expect(gate.task.dependencies).toEqual([])
    // The fixture is DISPATCHABLE in-process: nothing unsatisfied stands between R and a claim.
    expect(unsatisfiedDependencies(team.tasks, gate.task.dependencies)).toEqual([])
    // ...and the reading above is not vacuous: had the edge been wired, A would block R.
    expect(unsatisfiedDependencies(team.tasks, ["A"])).toEqual(["A"])
})

test("T-81 regression control: a review of an OPEN source still wires the edge", () => {
/** The single-task fixture the review arm judges. */
    const team = { phase: "running", halted: false, tasks: [task("A", "implementation", "in_progress")] }
/** The create gate's verdict for a review of that open source. */
    const gate = validateCreateTask(team, {
        kind: "review", subject: "review A", objective: "Review the open source", acceptance: ["ok"],
        reviewedTaskId: "A", dependencies: [],
    })
    expect(gate.ok).toBe(true)
    expect(gate.task.dependencies).toContain("A")
    expect(unsatisfiedDependencies(team.tasks, gate.task.dependencies)).toEqual(["A"])
})

test("T-81 negative control: with the pre-fix unconditional edge, the SAME fixture PARKS", async () => {
/** The scratch root the pre-fix copy is materialized under. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t81-prefix-"))
    try {
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")
/** The scratch copy of the gate module the condition is stripped from. */
        const copyPath = join(scratch, "lib", "quality-gates.js")
/** The copy's bytes before the condition is neutralised. */
        const original = readFileSync(copyPath, "utf8")
/** The exact pre-fix condition text, which must occur exactly once. */
        const condition = "\n        && (repairSource === undefined || !OPEN_STATUSES.includes(repairSource.status))"
/** How many times the condition occurs in the copy. */
        const occurrences = original.split(condition).length - 1
        expect(occurrences, "the condition was not found in the scratch copy — the control would test the FIXED code").toBe(1)
        writeFileSync(copyPath, original.replace(condition, ""))

/** The neutralised copy, imported so the SAME fixture runs against pre-fix code. */
        const preFix = await import(pathToFileURL(copyPath).href)
/** The same fixture, judged by the neutralised copy. */
        const { team, repairInput } = deadlockFixture()
/** The pre-fix verdict, which must wire the edge the fixed code drops. */
        const gate = preFix.validateCreateTask(team, repairInput)
        expect(gate.ok).toBe(true)
        // PRE-FIX BEHAVIOUR, reproduced: R carries A as a dependency...
        expect(gate.task.dependencies).toContain("A")
        // ...so R can never dispatch while A — whose verify needs R — is incomplete: the deadlock.
        expect(unsatisfiedDependencies(team.tasks, gate.task.dependencies)).toEqual(["A"])
    }
    finally {
        rmSync(scratch, { recursive: true, force: true })
    }
})
