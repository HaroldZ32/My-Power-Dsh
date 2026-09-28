// t15 (OMO parity align): the four frozen mass-ulw semantics, each with a
// FALSIFIABLE assertion bound to the existing attempt_id plane.
//
// S1 node-level retry      -> a terminal failed task can be retried (reassign_task)
//                             without discarding already-completed tasks.
// S2 revision w/o re-run   -> amending a definition re-runs the amended task and its
//                             TRANSITIVE DEPENDENTS only; a completed node whose own
//                             definition and transitive inputs are unchanged KEEPS its
//                             cached result (upstream dag.definition.amended.
//                             invalidatedNodeIds).
// S3 resume across restart -> the scheduler's readiness predicate dispatches ONLY
//                             `pending` tasks, so a restarted process never re-runs a
//                             task that already reached a terminal state.
// S4 mid-run steering      -> a bounded notice reaches a RUNNING member without
//                             restarting its attempt (attempt/attemptId unchanged).
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the live tool
// registrations cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { registerAgentTeamsTools } from "../lib/tools.js"

/** The state directory the plugin resolves under a session workspace. */
const STATE_DIR = join(".mpd", "team")
/** This test file's own directory, kept for path resolution from the test tree. */
const here = dirname(fileURLToPath(import.meta.url))
/** The session id the stub registry reports as the captain of the fixture team. */
const CAPTAIN_ID = "session-captain"
/** The session id the stub registry reports as the single member of the fixture team. */
const MEMBER_ID = "session-member"

/**
 * One four-task team record: t1 -> t2 -> t3 plus the independent t4.
 * @param root0 - the record's team id and phase, `running` unless an arm says otherwise.
 * @returns the durable team record, every task completed with a cached output.
 */
function teamRecord({ teamId, phase = "running" }: { teamId: string; phase?: string }): {
    id: string
    name: string
    captainSessionId: string
    createdAt: number
    taskSeq: number
    phase: string
    members: Array<{ id: string; name: string; role: string; status: string; joinedAt: number }>
    tasks: Array<{ id: string; subject: string; status: string; dependencies: string[]; attempt: number; output?: string; attemptId?: string; assignee?: string; createdAt: number; updatedAt: number; [key: string]: unknown }>
} {
    /** The shared timestamp of every record the fixture plants. */
    const now = Date.now()
    return {
        id: teamId,
        name: "s1-s4 semantics probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 4,
        phase,
        members: [{ id: MEMBER_ID, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [
            { id: "t1", subject: "upstream research", status: "completed", dependencies: [], attempt: 1, output: "cached t1", createdAt: now, updatedAt: now },
            { id: "t2", subject: "implement gate", status: "completed", dependencies: ["t1"], attempt: 1, output: "cached t2", acceptance: ["a"], verify: ["v"], createdAt: now, updatedAt: now },
            { id: "t3", subject: "verify gate", status: "completed", dependencies: ["t2"], attempt: 1, output: "stale t3", createdAt: now, updatedAt: now },
            { id: "t4", subject: "independent ledger", status: "completed", dependencies: [], attempt: 1, output: "cached t4", createdAt: now, updatedAt: now },
        ],
    }
}

/**
 * A throwaway workspace holding the four-task record plus the two live agents.
 * @returns the workspace, the team id and record path, and the captain and member agents.
 */
function fixture(): {
    workspace: string
    teamId: string
    stateRoot: string
    teamFile: string
    captain: { id: string; status: string; session: { header: { cwd: string } } }
    member: { id: string; status: string; session: { header: { cwd: string } } }
} {
    /** The throwaway workspace the team record is written into. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-s1s4-"))
    /** The one team's directory name under the state root. */
    const teamId = "semantics-team"
    /** The team state root inside the workspace. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    /** The path of the team record every arm rewrites. */
    const teamFile = join(stateRoot, teamId, "team.json")
    writeFileSync(teamFile, JSON.stringify(teamRecord({ teamId }), null, 2))
    /** The live agent the registry reports for the captain session. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    /** The live agent the registry reports for the member session. */
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, stateRoot, teamFile, captain, member }
}

/**
 * Register the team tools on a stub context and hand back the registry they landed in.
 * @param captain - the live agent the registry reports for the captain session.
 * @param member - the live agent the registry reports for the member session.
 * @returns the registry, read back by tool name, each definition executing against the stubbed seams.
 */
function registerTools(
    captain: { id: string; status: string; session: { header: { cwd: string } } },
    member: { id: string; status: string; session: { header: { cwd: string } } },
): { get: (name: string) => { execute: (args: Record<string, unknown>, exec: { agent: unknown }) => Promise<Record<string, unknown>> } } {
    /** The tool definitions the plugin registers, keyed by tool name. */
    const tools = new Map()
    /** The stub plugin context the registrations need, with the registry seams stubbed. */
    const ctx: {
        tools: { register: (definition: { name: string }) => unknown }
        agents: { get: (id: string) => unknown; list: () => unknown[] }
        subagents: { prompt: () => Promise<{ messageId: string }>; followup: () => void; sendMessage: () => void }
        effect: () => void
        on: () => void
        logger: { warn: () => void; info: () => void; error: () => void; debug: () => void }
        get: () => undefined
    } = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined),
            list: () => [captain, member],
        },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => {},
        on: () => {},
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

/**
 * The task records a team file currently holds.
 * @param teamFile - the team record path to read.
 * @returns the parsed tasks, whose fields the arms assert on one at a time.
 */
const readTasks = (teamFile: string): Array<Record<string, unknown>> => JSON.parse(readFileSync(teamFile, "utf8")).tasks
/**
 * One task of a parsed task list, by id.
 * @param tasks - the parsed task list to search.
 * @param id - the task id to find; the fixture guarantees it exists.
 * @returns the task record with that id.
 */
const byId = (tasks: ReadonlyArray<Record<string, unknown>>, id: string): Record<string, unknown> => tasks.find((task) => task.id === id)!

test("S2: amending a definition re-runs the amended task and its TRANSITIVE DEPENDENTS only", async () => {
    /** The workspace holding the four-task record, plus the two live agents. */
    const { workspace, teamFile, captain, member } = fixture()
    try {
        // Pin a KNOWN pre-amendment capability on every node, so "the cache was dropped"
        // is a relative fact and a scheduler re-dispatch cannot mask it.
        /** Every task of the record, each given a known pre-amendment capability below. */
        const seeded = readTasks(teamFile)
        for (const task of seeded) {
            task.attemptId = `cap-${task.id}-1`
            task.acceptanceResults = [{ criterion: "cached", status: "passed" }]
        }
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks: seeded }, null, 2))
        /** The amendment tool, taken from the registry the stub context filled. */
        const tool = registerTools(captain, member).get("agent_teams_update_task")
        await tool.execute({ task_id: "t2", status: "completed", amend: { subject: "implement gate (revised)" } }, { agent: captain })
        /** Every task of the record after the amendment. */
        const tasks = readTasks(teamFile)
        // the amended task was re-run: definition changed, old capability revoked
        expect(byId(tasks, "t2").subject).toBe("implement gate (revised)")
        expect(byId(tasks, "t2").attemptId).not.toBe("cap-t2-1")
        expect(byId(tasks, "t2").attempt).toBeGreaterThanOrEqual(2)
        expect(byId(tasks, "t2").acceptanceResults).toBeUndefined()
        // its TRANSITIVE DEPENDENT was re-run too, because its input changed
        expect(byId(tasks, "t3").attemptId).not.toBe("cap-t3-1")
        expect(byId(tasks, "t3").attempt).toBeGreaterThanOrEqual(2)
        // upstream of the amendment keeps its cached capability
        expect(byId(tasks, "t1").attemptId).toBe("cap-t1-1")
        expect(byId(tasks, "t1").status).toBe("completed")
        expect(byId(tasks, "t1").output).toBe("cached t1")
        // an unrelated completed node keeps its cached capability too
        expect(byId(tasks, "t4").attemptId).toBe("cap-t4-1")
        expect(byId(tasks, "t4").acceptanceResults).toEqual([{ criterion: "cached", status: "passed" }])
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("S2 falsifiability: a NO-OP amendment does not re-run anything", async () => {
    /** The workspace holding the four-task record, plus the two live agents. */
    const { workspace, teamFile, captain, member } = fixture()
    try {
        /** The record's bytes before the no-op amendment, which must survive it. */
        const before = readFileSync(teamFile, "utf8")
        /** The amendment tool, taken from the registry the stub context filled. */
        const tool = registerTools(captain, member).get("agent_teams_update_task")
        await tool.execute({ task_id: "t2", status: "completed", amend: { subject: "implement gate" } }, { agent: captain })
        expect(readFileSync(teamFile, "utf8")).toBe(before)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("S3: the scheduler's REAL readiness predicate never re-dispatches terminal work", async () => {
    // Contract: a process restart must resume from persisted state, not re-run finished
    // tasks. That guarantee IS the scheduler's readiness predicate, so the test drives
    // the exported predicate itself instead of re-implementing its filter inline.
    // The adopted agent-teams body is vendored JavaScript with no declaration file, so this lazy
    // import of the readiness predicate stays untyped; the directive below is expected here.
    // @ts-expect-error vendored JavaScript has no declaration file
    const { isTaskReady } = await import("../lib/scheduler.js")
    /** One task per status and dependency shape the readiness predicate must classify. */
    const tasks = [
        { id: "done", status: "completed", dependencies: [] },
        { id: "failed-one", status: "failed", dependencies: [] },
        { id: "cancelled-one", status: "cancelled", dependencies: [] },
        { id: "running", status: "in_progress", dependencies: [] },
        { id: "claimed-one", status: "claimed", dependencies: [] },
        { id: "waiting", status: "pending", dependencies: ["done"] },
        { id: "ready", status: "pending", dependencies: [] },
        { id: "blocked", status: "pending", dependencies: ["running"] },
        { id: "reassigning", status: "pending", dependencies: [], reassigning: true },
    ]
    /** The ids the readiness predicate would dispatch from that list. */
    const ready = tasks.filter((task) => isTaskReady(tasks, task)).map((task) => task.id)
    // never a terminal task: that is the resume guarantee
    for (const terminal of ["done", "failed-one", "cancelled-one"]) expect(ready).not.toContain(terminal)
    // in-flight work is not re-dispatched either
    expect(ready).not.toContain("running")
    expect(ready).not.toContain("claimed-one")
    // a task mid-reassignment is held back
    expect(ready).not.toContain("reassigning")
    // pending with an unfinished dependency is held back; a completed one is not
    expect(ready).not.toContain("blocked")
    expect(ready).toContain("waiting")
    expect(ready).toContain("ready")
    // OPT-1 interaction: a FAILED dependency does not block, so its dependent is ready
    /** The A -> B pair whose producer has failed, the OPT-1 readiness case. */
    const withFailedDep = [{ id: "A", status: "failed", dependencies: [] }, { id: "B", status: "pending", dependencies: ["A"] }]
    expect(withFailedDep.filter((task) => isTaskReady(withFailedDep, task)).map((task) => task.id)).toEqual(["B"])
})

test("S4: a bounded notice reaches a RUNNING member without restarting its attempt", async () => {
    /** The workspace holding the four-task record, plus the two live agents. */
    const { workspace, teamFile, stateRoot, teamId, captain, member } = fixture()
    try {
        /** Every task of the record before task t3 is put mid-flight. */
        const tasksBefore = readTasks(teamFile)
        /** Task t3, moved to a running attempt with a live capability below. */
        const running = byId(tasksBefore, "t3")
        running.status = "in_progress"
        running.assignee = "Senior Engineer"
        running.attemptId = "attempt-live-s4"
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks: tasksBefore }, null, 2))
        /** The registry the plugin's team tools were registered into. */
        const tools = registerTools(captain, member)
        /** The steering result for the running member. */
        const sent = await tools.get("agent_teams_send_message").execute({ to: "Senior Engineer", content: "STAY IN SCOPE: only evidence/omo-align/verification/** for this attempt." }, { agent: captain })
        expect(sent.delivered).toBeDefined()
        /** Task t3 as persisted after the steering notice. */
        const after = byId(readTasks(teamFile), "t3")
        // steering must NOT restart the attempt
        expect(after.attempt).toBe(1)
        expect(after.attemptId).toBe("attempt-live-s4")
        expect(after.status).toBe("in_progress")
        // and the bounded notice must actually be in the member's durable inbox
        /** The member's durable inbox file, which must carry the bounded notice. */
        const inbox = readFileSync(join(stateRoot, teamId, "inbox", "senior-engineer.jsonl"), "utf8")
        expect(inbox).toContain("STAY IN SCOPE")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("S1: a terminal failed task is retryable and completed siblings keep their results", async () => {
    /** The workspace holding the four-task record, plus the two live agents. */
    const { workspace, teamFile, captain, member } = fixture()
    try {
        /** Every task of the record, with the independent node t4 failed below. */
        const tasks = readTasks(teamFile)
        byId(tasks, "t4").status = "failed"
        byId(tasks, "t4").output = "boom"
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks }, null, 2))
        /** The registry the plugin's team tools were registered into. */
        const tools = registerTools(captain, member)
        /** The retry result for the terminally failed node t4. */
        const retried = await tools.get("agent_teams_reassign_task").execute({ task_id: "t4", assignee: "Senior Engineer", reason: "retry the failed node" }, { agent: captain })
        expect(retried.task_id).toBe("t4")
        /** Every task of the record after the retry. */
        const after = readTasks(teamFile)
        expect(byId(after, "t4").status).not.toBe("failed")
        expect(byId(after, "t4").attempt).toBe(2)
        // completed work elsewhere is untouched
        expect(byId(after, "t1").status).toBe("completed")
        expect(byId(after, "t1").output).toBe("cached t1")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})
