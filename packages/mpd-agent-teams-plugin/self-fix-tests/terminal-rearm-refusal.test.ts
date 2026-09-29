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
// lock and delivered after it, and the DELIVERY-boundary re-check lives in `lib/scheduler.ts`
// (`mpd-delta terminal-dispatch-recheck`) — lane C's file (decision D-1 of
// `.mpd/plans/friction-p2-wave.md`: "`lib/scheduler.ts` stays lane C's … the scheduler.js DELIVERY
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
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { beginTaskAttempt } from "../lib/state.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { installTeamScheduler } from "../lib/scheduler.ts"

/** One live-agent double the registry and the captain argument are built from. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status. */
    status: string
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One task as the fixture writes it. */
interface ProbeTask {
    /** The task's id. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The task's status. */
    readonly status: string
    /** The seat the task is assigned to. */
    readonly assignee: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
    /** The attempt id the record stores, which a re-armed ticket would carry unchanged. */
    readonly attemptId?: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed, in epoch milliseconds. */
    readonly updatedAt: number
    /** The task's kind. */
    readonly kind?: string
    /** The deliverable the seat earned, which a re-arm would wipe. */
    readonly output?: string
    /** The verdict the seat recorded. */
    readonly verdict?: string
}

/** The overridable fields of one task fixture. */
interface TaskOverrides {
    /** Overrides the stored attempt id. */
    readonly attemptId?: string
    /** Overrides the stored deliverable. */
    readonly output?: string
    /** Overrides the recorded verdict. */
    readonly verdict?: string
    /** Overrides the dependency ids. */
    readonly dependencies?: readonly string[]
    /** Overrides the seat the task is assigned to. */
    readonly assignee?: string
}

/** One team record as the fixture writes it and the arms re-read it. */
interface TeamRecordSnapshot {
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
    /** The member rows the compose parks as working. */
    readonly members: readonly { readonly status: string }[]
    /** The task set under test. */
    readonly tasks: readonly ProbeTask[]
}

/** One tool definition as the registration double captures it. */
interface ToolDefinition {
    /** The tool's registered name, which is also the map key. */
    readonly name: string
    /**
     * Run one call against the registry.
     *
     * @param args - the tool arguments the arm supplies.
     * @param exec - the execution context, carrying the seat the call runs as.
     * @returns the decoded tool result.
     */
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<Record<string, unknown>>
}

/** One member wake-up the runtime double recorded. */
interface DeliveryRecord {
    /** The task id the delivered ticket named. */
    readonly taskId?: string
    /** The on-disk status of the delivered task at the instant of the wake. */
    readonly statusAtDelivery?: string
    /** The prompt text the ticket carried. */
    readonly text?: string
}

/** The runtime double's four outputs. */
interface Runtime {
    /** The context double the REAL scheduler is installed over. */
    readonly ctx: Record<string, unknown>
    /** The captain double the kicks run as. */
    readonly captain: AgentLike
    /** Every member wake-up the subagent seam recorded. */
    readonly deliveries: DeliveryRecord[]
    /** Every warning line the context double collected. */
    readonly warnings: string[]
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The team id the fixture writes and the tools are keyed by. */
const TEAM_ID = "terminal-rearm-probe"
/** The captain's session id, which owns the fixture team. */
const CAPTAIN_ID = "session-captain-rearm"
/** The member seat every wake is addressed to. */
const MEMBER_ID = "member-architect-rearm"
/** The attempt id the record stores, which a re-armed ticket would carry unchanged. */
const STORED_ATTEMPT = "35503430-5a3b-4306-b6f2-d38d416cb438"
/** The vendored plugin's `lib/` directory, which the negative control copies. */
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
/** The vendored `_deps/` closure the scratch copy symlinks, so the copied lib resolves. */
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")

/** Build one task fixture; only the fields an arm varies are overridden. */
const task = (id: string, status: string, overrides: TaskOverrides = {}): ProbeTask => ({
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

/** Write a team record with the given tasks and member status, so the compose has work. */
function writeTeamRecord(dir: string, tasks: readonly ProbeTask[], memberStatus: string = "idle"): void {
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
/** The instant every timestamp in the fixture record is stamped with. */
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

/** The `team.json` path inside one workspace, spelled once for every arm. */
const teamFile = (dir: string): string => join(dir, STATE_DIR, TEAM_ID, "team.json")
/** The team record as it stands on disk. */
const readTeamRecord = (dir: string): TeamRecordSnapshot => JSON.parse(readFileSync(teamFile(dir), "utf8"))
/** The sha256 of a file's bytes, as the byte-identity arms compare it. */
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

/** The minimal runtime double the REAL scheduler is installed over. */
function runtime(dir: string): Runtime {
/** Every member wake-up the subagent seam recorded. */
    const deliveries: DeliveryRecord[] = []
/** Every warning line the context double collected. */
    const warnings: string[] = []
/** The captain double the kicks run as. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
/** The live agents the registry answers with, keyed by session id. */
    const live = new Map([
        [CAPTAIN_ID, captain],
        [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }],
    ])
/** The context double the vendored registration path drives. */
    const ctx = {
        agents: { get: (id: string) => live.get(id) },
        logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) }, info: () => {}, error: () => {}, debug: () => {} },
        on: () => () => undefined,
        subagents: {
            prompt: async (request: { readonly content: readonly { readonly text: string }[] }) => {
/** The ticket's prompt text, joined across its blocks. */
                const text = request.content.map((block) => block.text).join("")
/** The task id the ticket names, read out of that text. */
                const id = /Task: (\S+)/u.exec(text)?.[1]
/** The record as it stands at the instant the prompt is built. */
                const record = readTeamRecord(dir)
                deliveries.push({ taskId: id, statusAtDelivery: record.tasks.find((item: ProbeTask) => item.id === id)?.status ?? "(gone)", text })
                return { messageId: `message-${deliveries.length}` }
            },
        },
    }
    return { ctx, captain, deliveries, warnings }
}

test("T-79(a): the compose's ROTATION PRIMITIVE refuses terminal work, naming the status", () => {
/** The already-terminal task the primitive is asked to rotate. */
    const terminal = task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })
/** The terminal task's bytes, which no refused rotation may change. */
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
/** The workspace this arm drives. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    try {
        // The three-task fixture the row asks for: a COMPLETED task holding the stored (old)
        // attempt id, a PENDING task, and a task blocked by a pending dependency.
        writeTeamRecord(dir, [
            task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" }),
            task("t2", "pending"),
            task("t3", "pending", { dependencies: ["t2"] }),
        ])
/** The task as it stands before the kick; the fixture wrote t1, so the lookup cannot miss. */
        const before = readTeamRecord(dir).tasks.find((item: ProbeTask) => item.id === "t1")!
/** The runtime double and the captain the kick runs as. */
        const { ctx, captain, deliveries } = runtime(dir)
/** The REAL scheduler, installed over the double. */
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
        await scheduler.kickMember(dir, TEAM_ID, "Architect", captain)

        // No wake carried the terminal task — the READY task t2 (and only it) is dispatched, which
        // is why the file legitimately changes: this fixture is a dispatch fixture, not a
        // no-op fixture.
        expect(deliveries.map((delivery) => delivery.taskId)).not.toContain("t1")
        expect(deliveries.map((delivery) => delivery.taskId)).toContain("t2")
/** The task as it stands after the kick, which must be untouched; the fixture wrote t1. */
        const after = readTeamRecord(dir).tasks.find((item: ProbeTask) => item.id === "t1")!
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
/** The workspace this arm drives. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    try {
        writeTeamRecord(dir, [task("t1", "failed", { attemptId: STORED_ATTEMPT, output: "attempt failed" })])
/** The whole record as it stands before the refused revive. */
        const recordBefore = readTeamRecord(dir)
        // The tool path is what the acceptance names (clause c): drive the REAL tool in-process.
        const tools = new Map()
/** The captain double the reassign call runs as. */
        const liveCaptain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } }, }
/** The context double the vendored registration path drives. */
        const ctx = {
            tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === CAPTAIN_ID ? liveCaptain : id === MEMBER_ID ? { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } } : undefined), list: () => [liveCaptain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        expect(recordBefore.tasks[0].status).toBe("failed")
/** The reassign tool's answer for a fresh id. */
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
/** The workspace this arm drives. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
    try {
        // UNASSIGNED on purpose: the captain owns no member's task without a takeover, and the
        // point of this case is the terminal branch, not the ownership guard.
        writeTeamRecord(dir, [task("t1", "completed", { assignee: undefined, attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })])
/** The definitions the registration double captured. */
        const tools = new Map()
/** The captain double the update call runs as. */
        const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
/** The context double the vendored registration path drives. */
        const ctx = {
            tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === CAPTAIN_ID ? captain : undefined), list: () => [captain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
/** The registered update tool, whose stale-capability refusal this arm pins. */
        const update = tools.get("agent_teams_update_task")
/** The record's digest before the refused call. */
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
/** The workspace this arm drives. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
/** The scratch root the pre-fix copy is materialized under. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t79-prefix-"))
    try {
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")

        // (1) the rotation primitive: strip the guard calls from the copied state.js
        const stateCopy = join(scratch, "lib", "state.ts")
/** The neutralised state module's bytes, with the re-arm guard stripped. */
        const stateSource = readFileSync(stateCopy, "utf8")
/** The exact re-arm guard call, which must occur exactly once. */
        const rearmGuard = "    assertTaskRearmable(task);\n"
        expect(stateSource.split(rearmGuard).length - 1, "assertTaskRearmable guard calls not found in the copy").toBe(2)
        writeFileSync(stateCopy, stateSource.replaceAll(rearmGuard, ""))

        // (2) the stale-capability refusal: neutralise the condition in the copied tools.js
        const toolsCopy = join(scratch, "lib", "tools.ts")
/** The neutralised tool module's bytes, with the stale-attempt branch stripped. */
        const toolsSource = readFileSync(toolsCopy, "utf8")
/** The exact stale-attempt condition, which must occur exactly once. */
        const staleCondition = "if (args.attempt_id !== undefined && args.attempt_id !== '' && args.attempt_id !== task.attemptId) {"
        expect(toolsSource.split(staleCondition).length - 1, "the stale-capability check not found in the copy").toBe(1)
        writeFileSync(toolsCopy, toolsSource.replace(staleCondition, "if (false) {"))

/** The neutralised tool module, imported so the SAME call runs against pre-fix code. */
        const preFix = await import(`${"file://"}${toolsCopy}`)
/** The neutralised state module, whose rotation primitive mints the pre-fix attempt. */
        const preFixState = await import(`${"file://"}${join(scratch, "lib", "state.ts")}`)

        // PRE-FIX (1): the rotation LANDS — status claimed, attempt+1, output WIPED.
        const victim = task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })
/** The attempt id the PRE-FIX primitive minted over terminal work. */
        const minted = preFixState.beginTaskAttempt(victim, "Architect")
        expect(victim.status).toBe("claimed")
        expect(victim.attempt).toBe(2)
        expect(victim.attemptId).toBe(minted)
        expect(victim.attemptId).not.toBe(STORED_ATTEMPT)
        expect(victim.output, "the pre-fix rotation WIPES the earned summary").toBeUndefined()

        // PRE-FIX (2): the stale capability is answered with SUCCESS and stores nothing new.
        writeTeamRecord(dir, [task("t1", "completed", { assignee: undefined, attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })])
/** The record's digest before the pre-fix call. */
        const before = sha256(teamFile(dir))
/** The definitions the PRE-FIX registration captured. */
        const tools = new Map()
/** The captain double the pre-fix call runs as. */
        const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
/** The context double the pre-fix registration path drives. */
        const ctx = {
            tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === CAPTAIN_ID ? captain : undefined), list: () => [captain] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        preFix.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
/** The PRE-FIX answer, which must be the false success the defect produced. */
        const answer = await tools.get("agent_teams_update_task").execute(
            { task_id: "t1", status: "completed", attempt_id: "attempt-from-the-replayed-ticket", output: "earned summary" },
            { agent: captain },
        )
        expect(answer.status, "the pre-fix path answers SUCCESS for an ended attempt").toBe("completed")
/** The task as it stands after the PRE-FIX call, whose bytes it rewrote. */
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
/** The workspace this restart leg drives. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-t79-"))
/** The scratch directory the child process's driver module is written into. */
    const driver = mkdtempSync(join(tmpdir(), "mpd-t79-restart-"))
    try {
        writeTeamRecord(dir, [task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" })])
/** The record's digest before the child process runs. */
        const before = sha256(teamFile(dir))
/** The driver module's path, which the child process is spawned with. */
        const driverPath = join(driver, "restart-driver.mjs")
        writeFileSync(driverPath, `
import { beginTaskAttempt } from ${JSON.stringify(join(LIB_DIR, "state.ts"))}
const task = ${JSON.stringify(task("t1", "completed", { attemptId: STORED_ATTEMPT, output: "earned summary", verdict: "pass" }))}
let refused = false
let message = ""
try { beginTaskAttempt(task, "Architect") } catch (error) { refused = true; message = String(error.message) }
process.stdout.write(JSON.stringify({ refused, message, statusAfter: task.status, attemptIdAfter: task.attemptId, outputAfter: task.output, attemptAfter: task.attempt }))
`)
/** The child-process spawner, imported dynamically so the file still links without it. */
        const { spawnSync } = await import("node:child_process")
/** The child process's run, whose stdout carries the reading. */
        const run = spawnSync("bun", [driverPath], { encoding: "utf8", timeout: 60_000 })
        expect(run.status, `the fresh-process driver failed: ${run.stderr}`).toBe(0)
/** The reading the child process took in a FRESH process. */
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
