// T-79 STATE HALF (wave 2, lane A) — a TERMINAL task must not be re-armed, and a stale capability
// on terminal work must not be answered with success.
//
// MEASURED (wave 1: `t25`, `t43`, `t49`×2, `t34`, `t31`; again in wave 2: `t1`) — every affected seat
// was re-sent work it had already COMPLETED, carrying the task's STORED (old) attempt id, and every
// seat refused at `claim_task` with `task status cannot move from "completed" to "claimed"`.
// `.mpd/plans/friction-p2-wave-captain-log.md` A-1 records the wave-2 instance as this lane's
// accepted fixture seed (`t1`, attempt `35503430-5a3b-4306-b6f2-d38d416cb438`).
//
// WHY THE STATE HALF IS A PRIMITIVE AND NOT THE DELIVERY PATH: the ticket is composed under the team
// lock and delivered after it, and the DELIVERY-boundary re-check lives in `lib/scheduler.js`
// (`mpd-delta terminal-dispatch-recheck`) — lane C's file (decision D-1 of
// `.mpd/plans/friction-p2-wave.md`: "`lib/scheduler.js` stays lane C's … the scheduler.js DELIVERY
// half is t10's"). What this lane owns is the ROTATION PRIMITIVE the compose calls
// (`scheduler.js`: `const attemptId = beginTaskAttempt(task, currentMember.name)`) plus the tool
// path that answered a stale capability with the stored record.
//
// Nothing here rests on the live session: every reading is taken IN-PROCESS (one `bun test` run, no
// dsh restart), and the restart leg is a CHILD PROCESS that imports the current tree. The wave-2 live
// replays are ATTRIBUTED to a host process that predates the fix (T-21's no-hot-reload class) — an
// inference, NOT a measurement: the named probe is `node scripts/mpd-bg.mjs reload-check <module-path>`,
// and its own semantics are the bound (it compares a module mtime against the NEWEST SESSION's
// directory mtime, so FRESH never means "the running host loaded this revision"). The state is
// therefore UNRESOLVED, with a NAMED PROBE whose verdict does not support the stale-host reading —
// never "inert in-process", and never "consistent with a stale host". What this file DOES measure: the
// guard's effect in a fresh process, and the pre-fix behaviour on a scratch copy.
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { registerAgentTeamsTools } from "../lib/tools.js"
import { beginTaskAttempt } from "../lib/state.js"
import { installTeamScheduler } from "../lib/scheduler.js"

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "terminal-rearm-probe"
const CAPTAIN_ID = "session-captain-rearm"
const MEMBER_ID = "member-architect-rearm"
const STORED_ATTEMPT = "35503430-5a3b-4306-b6f2-d38d416cb438"
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")

const task = (id, status, overrides = {}) => ({
    id,
    subject: `work ${id}`,
    assignee: "Architect",
    dependencies: [],
    status,
    attempt: status === "pending" ? 0 : 1,
    attemptId: status === "pending" ? undefined : `attempt-${id}-1`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
})

function writeTeamRecord(dir, tasks, memberStatus = "idle") {
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
    const now = Date.now()
    writeFileSync(join(dir, STATE_DIR, TEAM_ID, "team.json"), `${JSON.stringify({
        id: TEAM_ID,
        name: "terminal re-arm probe",
        description: "T-79 state half fixture",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        approvedAt: now,
        phase: "running",
        taskSeq: tasks.length,
        members: [{ name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: memberStatus }],
        tasks,
    }, null, 2)}\n`)
}

const teamFile = (dir) => join(dir, STATE_DIR, TEAM_ID, "team.json")
const readTeamRecord = (dir) => JSON.parse(readFileSync(teamFile(dir), "utf8"))
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

function runtime(dir) {
    const deliveries = []
    const warnings = []
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
    const live = new Map([
        [CAPTAIN_ID, captain],
        [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }],
    ])
    const ctx = {
        agents: { get: (id) => live.get(id) },
        logger: { warn: (...args) => { warnings.push(args.map(String).join(" ")) }, info: () => {}, error: () => {}, debug: () => {} },
        on: () => () => undefined,
        subagents: {
            prompt: async (request) => {
                const text = request.content.map((block) => block.text).join("")
                const id = /Task: (\S+)/u.exec(text)?.[1]
                const record = readTeamRecord(dir)
                deliveries.push({ taskId: id, statusAtDelivery: record.tasks.find((item) => item.id === id)?.status ?? "(gone)", text })
                return { messageId: `message-${deliveries.length}` }
            },
        },
    }
    return { ctx, captain, deliveries, warnings }
}

test("T-79(a): the compose's ROTATION PRIMITIVE refuses terminal work, naming the status", () => {
    const terminal = task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })
    const snapshot = JSON.stringify(terminal)
    expect(() => beginTaskAttempt(terminal, "Architect")).toThrow(/task t1 is completed/)
    expect(() => beginTaskAttempt(terminal, "Architect")).toThrow(/REFUSED for terminal work/)
    // The refusal fires BEFORE the first mutation: no rotation, no cleared output, no new id.
    expect(JSON.stringify(terminal)).toBe(snapshot)
    expect(terminal.attemptId).toBe(STORED_ATTEMPT)
    expect(terminal.output).toBe("earned summary")
    expect(terminal.attempt).toBe(1)
})

test("T-79(b): the real scheduler, in-process, never re-arms or delivers a TERMINAL task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    try {
        // The three-task fixture the row asks for: a COMPLETED task holding the stored (old)
        // attempt id, a PENDING task, and a task blocked by a pending dependency.
        writeTeamRecord(dir, [
            task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" }),
            task("t2", "pending"),
            task("t3", "pending", { dependencies: ["t2"] }),
        ])
        const before = readTeamRecord(dir).tasks.find((item) => item.id === "t1")
        const { ctx, captain, deliveries } = runtime(dir)
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
        await scheduler.kickMember(dir, TEAM_ID, "Architect", captain)

        // No wake carried the terminal task — the READY task t2 (and only it) is dispatched, which
        // is why the file legitimately changes: this fixture is a dispatch fixture, not a
        // no-op fixture.
        expect(deliveries.map((delivery) => delivery.taskId)).not.toContain("t1")
        expect(deliveries.map((delivery) => delivery.taskId)).toContain("t2")
        const after = readTeamRecord(dir).tasks.find((item) => item.id === "t1")
        expect(after.status).toBe("completed")
        expect(after.attemptId).toBe(STORED_ATTEMPT)
        expect(after.output).toBe("earned summary")
        expect(after.attempt).toBe(1)
        // The terminal RECORD is byte-identical: no rotation, no wipe, not even a timestamp tick.
        expect(JSON.stringify(after)).toBe(JSON.stringify(before))
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("T-79(c): the sanctioned revive path survives — reassign_task re-opens with a FRESH id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    try {
        writeTeamRecord(dir, [task("t1", "failed", { attemptId: STORED_ATTEMPT, output: "attempt failed" })])
        const recordBefore = readTeamRecord(dir)
        // The tool path is what the acceptance names (clause c): drive the REAL tool in-process.
        const tools = new Map()
        const liveCaptain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } }, }
        const ctx = {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: (id) => (id === CAPTAIN_ID ? liveCaptain : id === MEMBER_ID ? { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } } : undefined), list: () => [liveCaptain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        expect(recordBefore.tasks[0].status).toBe("failed")
        const result = await tools.get("agent_teams_reassign_task").execute(
            { task_id: "t1", assignee: "captain", reason: "retry after the failed attempt" },
            { agent: liveCaptain },
        )
        expect(result.status).toBe("in_progress")
        expect(typeof result.attempt_id).toBe("string")
        expect(result.attempt_id).not.toBe(STORED_ATTEMPT)
        expect(result.attempt).toBe(2)
        // A guard that refused EVERY attempt mint (including the sanctioned revive) reddens here.
        const after = readTeamRecord(dir).tasks[0]
        expect(after.status).toBe("in_progress")
        expect(after.attemptId).toBe(result.attempt_id)
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("T-79(d): a STALE capability on terminal work is REFUSED (captain's idempotent path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    try {
        // UNASSIGNED on purpose: the captain owns no member's task without a takeover, and the
        // point of this case is the terminal branch, not the ownership guard.
        writeTeamRecord(dir, [task("t1", "completed", { assignee: undefined, attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })])
        const tools = new Map()
        const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
        const ctx = {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: (id) => (id === CAPTAIN_ID ? captain : undefined), list: () => [captain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const update = tools.get("agent_teams_update_task")
        const before = sha256(teamFile(dir))

        // The wave-2 shape: an update on terminal work presenting an attempt id that is not the
        // stored capability. Before this fix the terminal branch answered SUCCESS with the stored
        // record (a green answer for an ended attempt).
        await expect(update.execute(
            { task_id: "t1", status: "completed", attempt_id: "attempt-from-the-replayed-ticket", output: "earned summary" },
            { agent: captain },
        )).rejects.toThrow(/task t1 is completed/)
        await expect(update.execute(
            { task_id: "t1", status: "completed", attempt_id: "attempt-from-the-replayed-ticket", output: "earned summary" },
            { agent: captain },
        )).rejects.toThrow(/stale capability cannot update it/)
        expect(sha256(teamFile(dir)), "a refused terminal update must not write").toBe(before)

        // Control: the IDEMPOTENT path with the stored capability still answers with the record —
        // a guard that refused every terminal read-back would be red here.
        const idempotent = await update.execute(
            { task_id: "t1", status: "completed", attempt_id: STORED_ATTEMPT, output: "earned summary" },
            { agent: captain },
        )
        expect(idempotent.task_id).toBe("t1")
        expect(idempotent.status).toBe("completed")
        expect(readTeamRecord(dir).tasks[0].output).toBe("earned summary")
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

test("T-79 negative control: with both guards removed, the SAME calls rotate and answer success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t79-prefix-"))
    try {
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")

        // (1) the rotation primitive: strip the guard calls from the copied state.js
        const stateCopy = join(scratch, "lib", "state.js")
        const stateSource = readFileSync(stateCopy, "utf8")
        const rearmGuard = "    assertTaskRearmable(task);\n"
        expect(stateSource.split(rearmGuard).length - 1, "assertTaskRearmable guard calls not found in the copy").toBe(2)
        writeFileSync(stateCopy, stateSource.replaceAll(rearmGuard, ""))

        // (2) the stale-capability refusal: neutralise the condition in the copied tools.js
        const toolsCopy = join(scratch, "lib", "tools.js")
        const toolsSource = readFileSync(toolsCopy, "utf8")
        const staleCondition = "if (args.attempt_id !== undefined && args.attempt_id !== '' && args.attempt_id !== task.attemptId) {"
        expect(toolsSource.split(staleCondition).length - 1, "the stale-capability check not found in the copy").toBe(1)
        writeFileSync(toolsCopy, toolsSource.replace(staleCondition, "if (false) {"))

        const preFix = await import(`${"file://"}${toolsCopy}`)
        const preFixState = await import(`${"file://"}${join(scratch, "lib", "state.js")}`)

        // PRE-FIX (1): the rotation LANDS — status claimed, attempt+1, output WIPED.
        const victim = task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })
        const minted = preFixState.beginTaskAttempt(victim, "Architect")
        expect(victim.status).toBe("claimed")
        expect(victim.attempt).toBe(2)
        expect(victim.attemptId).toBe(minted)
        expect(victim.attemptId).not.toBe(STORED_ATTEMPT)
        expect(victim.output, "the pre-fix rotation WIPES the earned summary").toBeUndefined()

        // PRE-FIX (2): the stale capability is answered with SUCCESS and stores nothing new.
        writeTeamRecord(dir, [task("t1", "completed", { assignee: undefined, attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })])
        const before = sha256(teamFile(dir))
        const tools = new Map()
        const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
        const ctx = {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: (id) => (id === CAPTAIN_ID ? captain : undefined), list: () => [captain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        preFix.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const answer = await tools.get("agent_teams_update_task").execute(
            { task_id: "t1", status: "completed", attempt_id: "attempt-from-the-replayed-ticket", output: "earned summary" },
            { agent: captain },
        )
        expect(answer.status, "the pre-fix path answers SUCCESS for an ended attempt").toBe("completed")
        const afterTask = readTeamRecord(dir).tasks[0]
        expect(afterTask.attemptId).toBe(STORED_ATTEMPT)
        expect(afterTask.output).toBe("earned summary")
        void before
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(scratch, { recursive: true, force: true })
    }
})

test("T-79 restart leg: a FRESH PROCESS sees the same refusal (the restart-based re-observation)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    const driver = mkdtempSync(join(tmpdir(), "mpd-t79-restart-"))
    try {
        writeTeamRecord(dir, [task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })])
        const before = sha256(teamFile(dir))
        const driverPath = join(driver, "restart-driver.mjs")
        writeFileSync(driverPath, `
import { beginTaskAttempt } from ${JSON.stringify(join(LIB_DIR, "state.js"))}
const task = ${JSON.stringify(task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" }))}
let refused = false
let message = ""
try { beginTaskAttempt(task, "Architect") } catch (error) { refused = true; message = String(error.message) }
process.stdout.write(JSON.stringify({ refused, message, statusAfter: task.status, attemptIdAfter: task.attemptId, outputAfter: task.output, attemptAfter: task.attempt }))
`)
        const { spawnSync } = await import("node:child_process")
        const run = spawnSync("bun", [driverPath], { encoding: "utf8", timeout: 60_000 })
        expect(run.status, `the fresh-process driver failed: ${run.stderr}`).toBe(0)
        const reading = JSON.parse(run.stdout)
        // The fresh process (a restart of the module graph) is where the guard MUST be effective, and
        // this reading is what proves it IN-PROCESS. Why the wave-2 live replays happened stays
        // UNRESOLVED, with a NAMED PROBE whose verdict does not support the stale-host reading — the
        // host start time is not readable from a pid-namespaced sandbox, so it is bounded here rather
        // than claimed. (The measured half: in a fresh process the delivery re-check refuses
        // DETERMINISTICALLY — green on the real tree, exactly ONE terminal delivery on a
        // region-stripped copy; the refuted framing is not repeated above.)
        expect(reading.refused).toBe(true)
        expect(reading.message).toContain("task t1 is completed")
        expect(reading.statusAfter).toBe("completed")
        expect(reading.attemptIdAfter).toBe(STORED_ATTEMPT)
        expect(reading.outputAfter).toBe("earned summary")
        expect(reading.attemptAfter).toBe(1)
        expect(sha256(teamFile(dir))).toBe(before)
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(driver, { recursive: true, force: true })
    }
})
