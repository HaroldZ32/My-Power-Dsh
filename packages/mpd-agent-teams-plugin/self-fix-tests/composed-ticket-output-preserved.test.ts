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
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { installTeamScheduler } from "../lib/scheduler.js"

/** The overridable inputs of one fixture team; only the fields an arm varies are passed. */
interface FixtureInput {
    /** The task's status as it is written to disk. */
    readonly status?: string
    /** The seat the task is assigned to, or undefined to leave it pooled. */
    readonly owner?: string
    /** Whether the team also carries a reviewer seat. */
    readonly withReviewer?: boolean
    /** The stored deliverable, or undefined to write no output field at all. */
    readonly output?: string
}

/** One task as the compose leaves it on disk, with the three fields the arms read. */
interface TaskRecord {
    /** The stored deliverable, absent once the compose has wiped it. */
    readonly output?: string
    /** The task's status after the compose. */
    readonly status: string
    /** The task's attempt number after the compose. */
    readonly attempt: number
}

/** One registered mpd delta region as the derived registry reports it. */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** The region's id, which the registration arm matches on. */
    readonly id: string
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The team id the fixture writes and the scheduler is keyed by. */
const TEAM_ID = "t73-output-probe"
/** The captain's session id, which owns the fixture team. */
const CAPTAIN_ID = "session-captain-t73"
/** The member seat the task is assigned to. */
const MEMBER_ID = "member-architect-t73"
/** The reviewer seat the with-reviewer arm adds. */
const REVIEWER_ID = "member-reviewer-t73"
/** The vendored plugin's `lib/` directory, which the negative control copies. */
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
/** The vendored `_deps/` closure the scratch copy symlinks, so the copied lib resolves. */
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")
/** The deliverable the arms prove is carried through — or wiped, on the pre-fix tree. */
const STORED = "THE STORED DELIVERABLE — findings the member already recorded on this task"

/** Write a one-task team record and return the roots the compose runs against. */
function fixture({ status = "in_progress", owner = "Architect", withReviewer = false, output = STORED }: FixtureInput = {}): { dir: string; teamFile: string } {
/** The temporary workspace the fixture team lives in. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-t73-"))
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
/** The instant every timestamp in the fixture record is stamped with. */
    const now = Date.now()
/** The `team.json` path the compose writes back to. */
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

/** The first task as it stands on disk, re-read after each compose. */
const taskOf = (teamFile: string): TaskRecord => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]

/** The minimal context double the REAL scheduler is installed over. */
function runtime(dir: string): { ctx: Record<string, unknown>; captain: Record<string, unknown>; deliveries: number[] } {
/** Every prompt the scheduler delivered, so a wake is countable. */
    const deliveries: number[] = []
/** The captain double the kick runs as. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
/** The live agents the context's registry answers with, keyed by session id. */
    const live = new Map([
        [CAPTAIN_ID, captain],
        [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }],
        [REVIEWER_ID, { id: REVIEWER_ID, status: "idle", session: { header: { cwd: dir } } }],
    ])
/** The context double the vendored scheduler is installed over. */
    const ctx = {
        agents: { get: (id: string) => live.get(id), list: () => [captain] },
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        on: () => () => undefined,
        subagents: { prompt: async () => { deliveries.push(1); return { messageId: "m" } }, followup: () => {}, sendMessage: () => {} },
        get: () => undefined,
    }
    return { ctx, captain, deliveries }
}

/** One composed ticket: the REAL scheduler's kick, exactly the route the wave-1 probe measured. */
async function kick(dir: string): Promise<number> {
/** The runtime double and the captain the kick runs as. */
    const { ctx, captain, deliveries } = runtime(dir)
/** The REAL scheduler, installed over the double. */
    const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
    await scheduler.kickMember(dir, TEAM_ID, "Architect", captain)
    return deliveries.length
}

test("T-73: the deterministic probe — a composed ticket no longer WIPES the stored deliverable", async () => {
/** The fixture roots this arm composes over. */
    const { dir, teamFile } = fixture({ status: "in_progress", owner: "Architect" })
    try {
/** The task as stored before the compose. */
        const before = taskOf(teamFile)
/** How many tickets the compose delivered. */
        const deliveries = await kick(dir)
/** The task as stored after the compose. */
        const after = taskOf(teamFile)
/** The before/after reading, attached to every assertion so a failure shows both states. */
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
/** The fixture the pre-fix compose is driven over. */
    const box = fixture({ status: "in_progress", owner: "Architect" })
/** The scratch root the pre-fix copy is materialized under. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t73-prefix-"))
    try {
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        // "junction", never "dir": a Windows directory SYMLINK needs SeCreateSymbolicLinkPrivilege
        // (admin or Developer Mode) and fails with EPERM, while a junction needs no privilege.
        // The type is ignored on POSIX, so this spelling is portable.
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")
/** The scratch copy of the state module the condition is neutralised in. */
        const copyPath = join(scratch, "lib", "state.js")
/** The copy's bytes before the condition is neutralised. */
        const original = readFileSync(copyPath, "utf8")
/** The exact new condition text, which must occur exactly once. */
        const condition = "const sameGenerationRedispatch = (task.status === 'claimed' || task.status === 'in_progress')"
        expect(original.split(condition).length - 1, "the new condition was not found in the scratch copy — the control would test the FIXED code").toBe(1)
        writeFileSync(copyPath, original.replace(condition, "const sameGenerationRedispatch = false && (task.status === 'claimed' || task.status === 'in_progress')"))

        expect(taskOf(box.teamFile).output).toBe(STORED)
/** The neutralised copy, imported so the SAME fixture runs against pre-fix code. */
        const preFix = await import(pathToFileURL(join(scratch, "lib", "scheduler.js")).href)
/** The runtime double and the captain the pre-fix kick runs as. */
        const { ctx, captain, deliveries } = runtime(box.dir)
/** The PRE-FIX scheduler, installed over the double. */
        const scheduler = preFix.installTeamScheduler(ctx, { stateDir: STATE_DIR })
        await scheduler.kickMember(box.dir, TEAM_ID, "Architect", captain)
/** The task as stored after the PRE-FIX compose, which must be wiped. */
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
/** The two state seams the handover path itself calls. */
    // A dynamic import cannot be covered by a directive above the statement, so the reason sits here:
    // @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note at the top).
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
/** How many tickets the first dispatch of a pending task delivered. */
        const deliveries = await kick(dir)
/** The task as stored after that first dispatch. */
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
/** The fixture carrying an already-terminal task with its earned summary. */
    const { dir, teamFile } = fixture({ status: "completed", owner: "Architect", output: "THE EARNED TERMINAL SUMMARY" })
    try {
/** The whole record as stored before the compose. */
        const before = JSON.stringify(taskOf(teamFile))
/** How many tickets were delivered for terminal work, which must be none. */
        const deliveries = await kick(dir)
/** The whole record as stored after the compose, which must be unchanged. */
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
/** The derived delta registry, imported dynamically so the file still links without it. */
    // A dynamic import cannot be covered by a directive above the statement, so the reason sits here:
    // @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note at the top).
    const { MPD_DELTAS } = await import("../lib/mpd-deltas.js")
/** The region whose registration this arm pins. */
    const delta = MPD_DELTAS.find((item: DeltaEntry) => item.id === "mpd-delta composed-ticket-output-preserved")
    expect(delta, "the region must be registered or a re-materialize would drop it silently").toBeDefined()
    expect(delta.file.endsWith("lib/state.js")).toBe(true)
})
