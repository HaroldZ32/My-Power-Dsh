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
import { validateCreateTask } from "../lib/quality-gates.js"
import { unsatisfiedDependencies } from "../lib/state.js"

const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")

const task = (id, kind, status, extra = {}) => ({ id, kind, status, subject: id, dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1, ...extra })

/**
 * The wave-1 shape, as a two-task fixture: source A is `in_progress` and its own `verify` names the
 * guard the repair R exists to land, so A cannot complete before R does.
 */
function deadlockFixture() {
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
    const { team, repairInput } = deadlockFixture()
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
    const team = { phase: "running", halted: false, tasks: [task("A", "implementation", "in_progress")] }
    const gate = validateCreateTask(team, {
        kind: "review", subject: "review A", objective: "Review the open source", acceptance: ["ok"],
        reviewedTaskId: "A", dependencies: [],
    })
    expect(gate.ok).toBe(true)
    expect(gate.task.dependencies).toContain("A")
    expect(unsatisfiedDependencies(team.tasks, gate.task.dependencies)).toEqual(["A"])
})

test("T-81 negative control: with the pre-fix unconditional edge, the SAME fixture PARKS", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t81-prefix-"))
    try {
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")
        const copyPath = join(scratch, "lib", "quality-gates.js")
        const original = readFileSync(copyPath, "utf8")
        const condition = "\n        && (repairSource === undefined || !OPEN_STATUSES.includes(repairSource.status))"
        const occurrences = original.split(condition).length - 1
        expect(occurrences, "the condition was not found in the scratch copy — the control would test the FIXED code").toBe(1)
        writeFileSync(copyPath, original.replace(condition, ""))

        const preFix = await import(pathToFileURL(copyPath).href)
        const { team, repairInput } = deadlockFixture()
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
