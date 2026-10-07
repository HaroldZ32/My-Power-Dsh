// T-81 — the AS-COMMITTED (pre-fix) reading of the repair auto-wire, plus the fixed reading, on one
// fixture: source `A` is `in_progress` and its own `verify` names the guard the repair `R` exists to
// land, so A cannot complete before R does.
//
// Ruling 3 (`.mpd/plans/friction-p2-wave-captain-log.md`, A-1): the "today it lands" reading must be
// reproduced on the settled revision. `lib/quality-gates.js` was clean at HEAD (`c826f16`) when this
// lane started; the scratch copy replaces exactly the three files this lane edits, so the HEAD leg
// is the as-committed call path.
//
// Usage: bun evidence/agent-teams/repair-source-deadlock/<stamp>/driver.mjs
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../")
const HEAD_FILES = ["tools.js", "state.js", "quality-gates.js"]

const task = (id, kind, status, extra = {}) => ({ id, kind, status, subject: id, dependencies: [], attempt: 0, createdAt: 1, updatedAt: 1, ...extra })

// The wave-1 instance: the repair exists BECAUSE A's verify is blocked by the very guard it lands.
const fixture = () => ({
    team: { phase: "running", halted: false, tasks: [task("A", "implementation", "in_progress", { verify: ["bun test packages/dsh-qa (the guard R lands)"] })] },
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
})

const scratch = mkdtempSync(join(tmpdir(), "mpd-t81-head-lib-"))
const result = { driver: "repair-source-deadlock/pre-fix (HEAD lib)", headCommit: "", variants: [] }
try {
    result.headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
    cpSync(join(REPO, "packages/mpd-agent-teams-plugin/lib"), join(scratch, "lib"), { recursive: true })
    symlinkSync(join(REPO, "packages/mpd-agent-teams-plugin/_deps"), join(scratch, "_deps"), "dir")
    for (const name of HEAD_FILES) {
        writeFileSync(join(scratch, "lib", name), execFileSync("git", ["show", `HEAD:packages/mpd-agent-teams-plugin/lib/${name}`], { cwd: REPO, encoding: "utf8" }))
    }

    for (const variant of [
        { label: "HEAD (pre-fix)", libDir: join(scratch, "lib") },
        { label: "fixed tree", libDir: join(REPO, "packages/mpd-agent-teams-plugin/lib") },
    ]) {
        const gates = await import(pathToFileURL(join(variant.libDir, "quality-gates.js")).href)
        const state = await import(pathToFileURL(join(variant.libDir, "state.js")).href)
        const { team, repairInput } = fixture()
        const gate = gates.validateCreateTask(team, repairInput)
        result.variants.push({
            label: variant.label,
            ok: gate.ok,
            error: gate.error ?? null,
            repairDependencies: gate.ok ? gate.task.dependencies : null,
            sourceTaskIdKept: gate.ok ? gate.task.sourceTaskId : null,
            unsatisfiedForRepair: gate.ok ? state.unsatisfiedDependencies(team.tasks, gate.task.dependencies) : null,
            dispatchableNow: gate.ok ? state.unsatisfiedDependencies(team.tasks, gate.task.dependencies).length === 0 : null,
        })
    }
}
finally {
    rmSync(scratch, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
