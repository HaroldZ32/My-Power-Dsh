// T-73 (wave 2, t24) — a COMPOSED TICKET must not silently DELETE a task's stored `output`.
//
// MEASURED (wave 1, `t36`'s author — `evidence/agent-teams/terminal-dispatch/20260917T023700Z/raw/
// output-wipe-probe.mjs`; re-measured by this lane at HEAD `c826f16`): ONE `kickMember` over an
// `in_progress` task holding a stored deliverable left the record at `output: null`, `attempt: 2`,
// `status: claimed` — DETERMINISTIC, because the compose (`lib/scheduler.js` `kickMember`) rotates the
// attempt through `beginTaskAttempt` → `lib/state.js` `activateTaskAttempt` on EVERY dispatched ticket.
// The dispatch-boundary re-check (`mpd-delta terminal-dispatch-recheck`) runs AFTER that, so it can
// prevent the WAKE and never the WIPE: the phantom-claim family's mechanical cause is a silent DELETE.
//
// THE FIX (shape (i) of the two the wave-1 record names): `output` SURVIVES a rotation inside the SAME
// generation — the task is still OPEN and the incoming assignee IS its current owner (the `recoverOwned`
// re-dispatch). A first dispatch of a `pending` task, an amend-invalidated generation, and a handover
// (whose reassign path clears EXPLICITLY through `invalidateTaskAttempt`) behave exactly as before.
//
// Shape (ii) (snapshot before the compose + restore in the refusal path) is NOT shipped: the wave-1
// record judges it in-process-untestable, and this file does not assert a repair it cannot exercise.
//
// This arm carries the negative control in-file: the pre-fix tree is reproduced by neutralising the new
// condition in a scratch copy of `lib/`, and the wipe must reappear THERE while the fixed tree keeps the
// deliverable. It also shows T-79's state half (terminal immutability) in the same run, because both
// fixes live in the same function.
import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { installTeamScheduler } from "../lib/scheduler.js"

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "t73-output-probe"
const CAPTAIN_ID = "session-captain-t73"
const MEMBER_ID = "member-architect-t73"
const REVIEWER_ID = "member-reviewer-t73"
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")
const STORED = "THE STORED DELIVERABLE — findings the member already recorded on this task"

function fixture({ status = "in_progress", owner = "Architect", withReviewer = false, output = STORED } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t73-"))
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
    const now = Date.now()
    const teamFile = join(dir, STATE_DIR, TEAM_ID, "team.json")
    writeFileSync(teamFile, `${JSON.stringify({
        id: TEAM_ID,
        name: "T-73 output probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        approvedAt: now,
        phase: "running",
        taskSeq: 1,
        members: [
            { name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: "idle" },
            ...withReviewer ? [{ name: "Reviewer", id: REVIEWER_ID, role: "reviewer", joinedAt: now, status: "idle" }] : [],
        ],
        tasks: [{
            id: "t1",
            subject: "carry the deliverable",
            assignee: owner,
            dependencies: [],
            status,
            attempt: 1,
            attemptId: "attempt-t1-1",
            ...output === undefined ? {} : { output },
            createdAt: now,
            updatedAt: now,
        }],
    }, null, 2)}\n`)
    return { dir, teamFile }
}

const taskOf = (teamFile) => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]

function runtime(dir) {
    const deliveries = []
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
    const live = new Map([
        [CAPTAIN_ID, captain],
        [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }],
        [REVIEWER_ID, { id: REVIEWER_ID, status: "idle", session: { header: { cwd: dir } } }],
    ])
    const ctx = {
        agents: { get: (id) => live.get(id), list: () => [captain] },
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        on: () => () => undefined,
        subagents: { prompt: async () => { deliveries.push(1); return { messageId: "m" } }, followup: () => {}, sendMessage: () => {} },
        get: () => undefined,
    }
    return { ctx, captain, deliveries }
}

/** One composed ticket: the REAL scheduler's kick, exactly the route the wave-1 probe measured. */
async function kick(dir) {
    const { ctx, captain, deliveries } = runtime(dir)
    const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
    await scheduler.kickMember(dir, TEAM_ID, "Architect", captain)
    return deliveries.length
}

test("T-73: the deterministic probe — a composed ticket no longer WIPES the stored deliverable", async () => {
    const { dir, teamFile } = fixture({ status: "in_progress", owner: "Architect" })
    try {
        const before = taskOf(teamFile)
        const deliveries = await kick(dir)
        const after = taskOf(teamFile)
        const note = `before=${JSON.stringify({ output: before.output, status: before.status, attempt: before.attempt })} after=${JSON.stringify({ output: after.output, status: after.status, attempt: after.attempt })}`
        // The rotation STILL happens (the fix prevents the wipe, not the ticket)…
        expect(after.status, note).toBe("claimed")
        expect(after.attempt, note).toBe(2)
        expect(deliveries, note).toBe(1)
        // …and the deliverable is intact, byte for byte.
        expect(after.output, note).toBe(STORED)
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("T-73 negative control: with the new condition neutralised, the SAME fixture is WIPED", async () => {
    const box = fixture({ status: "in_progress", owner: "Architect" })
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t73-prefix-"))
    try {
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "dir")
        const copyPath = join(scratch, "lib", "state.js")
        const original = readFileSync(copyPath, "utf8")
        const condition = "const sameGenerationRedispatch = (task.status === 'claimed' || task.status === 'in_progress')"
        expect(original.split(condition).length - 1, "the new condition was not found in the scratch copy — the control would test the FIXED code").toBe(1)
        writeFileSync(copyPath, original.replace(condition, "const sameGenerationRedispatch = false && (task.status === 'claimed' || task.status === 'in_progress')"))

        expect(taskOf(box.teamFile).output).toBe(STORED)
        const preFix = await import(pathToFileURL(join(scratch, "lib", "scheduler.js")).href)
        const { ctx, captain, deliveries } = runtime(box.dir)
        const scheduler = preFix.installTeamScheduler(ctx, { stateDir: STATE_DIR })
        await scheduler.kickMember(box.dir, TEAM_ID, "Architect", captain)
        const after = taskOf(box.teamFile)
        // THE PRE-FIX BEHAVIOUR, reproduced exactly as wave 1 measured it.
        expect(deliveries.length).toBe(1)
        expect(after.status).toBe("claimed")
        expect(after.attempt).toBe(2)
        expect(after.output, "the pre-fix compose must WIPE the stored deliverable").toBeUndefined()
    }
    finally {
        rmSync(box.dir, { recursive: true, force: true })
        rmSync(scratch, { recursive: true, force: true })
    }
})

test("T-73 control: a HANDOVER still clears (the fix is not 'never clear')", async () => {
    // Driven at the state seam the reassign path itself uses. The TOOL-level variant
    // (`agent_teams_reassign_task` to another member) additionally interrupts the previous owner and
    // waits for its live agent to quiesce — harness runtime this arm does not own, and the stub needed
    // for it makes bun panic (measured: 1.05 GB RSS, segfault) instead of failing an assertion. The
    // semantics under test are the two calls below, which IS the handover path: `reassign_task` calls
    // `invalidateTaskAttempt(task, target, true)` and the compose then arms the NEW owner's attempt.
    const task = {
        id: "t1",
        subject: "carry the deliverable",
        status: "in_progress",
        assignee: "Architect",
        attempt: 1,
        attemptId: "attempt-t1-1",
        output: STORED,
    }
    const { invalidateTaskAttempt, beginTaskAttempt } = await import("../lib/state.js")
    invalidateTaskAttempt(task, "Reviewer", true)
    expect(task.status, "the handover returns the task to the pool").toBe("pending")
    expect(task.assignee).toBe("Reviewer")
    expect(task.output, "the explicit invalidate clears the previous owner's deliverable").toBeUndefined()
    beginTaskAttempt(task, "Reviewer")
    expect(task.status).toBe("claimed")
    expect(task.output, "and the new owner's first attempt starts clean").toBeUndefined()
})

test("T-73 control: a PENDING task's first dispatch still clears (a NEW generation)", async () => {
    // A pending task that still carries an OLD generation's output (e.g. invalidated by an amend):
    // the new generation starts clean, exactly as before this change.
    const { dir, teamFile } = fixture({ status: "pending", owner: undefined, output: "OUTPUT OF THE INVALIDATED GENERATION" })
    try {
        const deliveries = await kick(dir)
        const after = taskOf(teamFile)
        expect(deliveries).toBe(1)
        expect(after.status).toBe("claimed")
        expect(after.output).toBeUndefined()
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("T-73 ∩ T-79: the SAME function still refuses terminal work, and the terminal deliverable is untouched", async () => {
    const { dir, teamFile } = fixture({ status: "completed", owner: "Architect", output: "THE EARNED TERMINAL SUMMARY" })
    try {
        const before = JSON.stringify(taskOf(teamFile))
        const deliveries = await kick(dir)
        const after = taskOf(teamFile)
        // T-79's state half (which lives in the same function, above the T-73 condition): a terminal task
        // is never re-armed — so the wipe cannot even be reached, and the record keeps every byte.
        expect(deliveries, "no ticket may be delivered for terminal work").toBe(0)
        expect(JSON.stringify(after)).toBe(before)
        expect(after.output).toBe("THE EARNED TERMINAL SUMMARY")
        expect(after.status).toBe("completed")
        expect(after.attempt).toBe(1)
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("T-73: the region is REGISTERED in the delta registry and lives in state.js", async () => {
    const { MPD_DELTAS } = await import("../lib/mpd-deltas.js")
    const delta = MPD_DELTAS.find((item) => item.id === "mpd-delta composed-ticket-output-preserved")
    expect(delta, "the region must be registered or a re-materialize would drop it silently").toBeDefined()
    expect(delta.file.endsWith("lib/state.js")).toBe(true)
})
