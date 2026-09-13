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
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const here = dirname(fileURLToPath(import.meta.url))
const CAPTAIN_ID = "session-captain"
const MEMBER_ID = "session-member"

function teamRecord({ teamId, phase = "running" }) {
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

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-s1s4-"))
    const teamId = "semantics-team"
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    const teamFile = join(stateRoot, teamId, "team.json")
    writeFileSync(teamFile, JSON.stringify(teamRecord({ teamId }), null, 2))
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, stateRoot, teamFile, captain, member }
}

function registerTools(captain, member) {
    const tools = new Map()
    const ctx = {
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

const readTasks = (teamFile) => JSON.parse(readFileSync(teamFile, "utf8")).tasks
const byId = (tasks, id) => tasks.find((task) => task.id === id)

test("S2: amending a definition re-runs the amended task and its TRANSITIVE DEPENDENTS only", async () => {
    const { workspace, teamFile, captain, member } = fixture()
    try {
        // Pin a KNOWN pre-amendment capability on every node, so "the cache was dropped"
        // is a relative fact and a scheduler re-dispatch cannot mask it.
        const seeded = readTasks(teamFile)
        for (const task of seeded) {
            task.attemptId = `cap-${task.id}-1`
            task.acceptanceResults = [{ criterion: "cached", status: "passed" }]
        }
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks: seeded }, null, 2))
        const tool = registerTools(captain, member).get("agent_teams_update_task")
        await tool.execute({ task_id: "t2", status: "completed", amend: { subject: "implement gate (revised)" } }, { agent: captain })
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
    const { workspace, teamFile, captain, member } = fixture()
    try {
        const before = readFileSync(teamFile, "utf8")
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
    const { isTaskReady } = await import("../lib/scheduler.js")
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
    const withFailedDep = [{ id: "A", status: "failed", dependencies: [] }, { id: "B", status: "pending", dependencies: ["A"] }]
    expect(withFailedDep.filter((task) => isTaskReady(withFailedDep, task)).map((task) => task.id)).toEqual(["B"])
})

test("S4: a bounded notice reaches a RUNNING member without restarting its attempt", async () => {
    const { workspace, teamFile, stateRoot, teamId, captain, member } = fixture()
    try {
        const tasksBefore = readTasks(teamFile)
        const running = byId(tasksBefore, "t3")
        running.status = "in_progress"
        running.assignee = "Senior Engineer"
        running.attemptId = "attempt-live-s4"
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks: tasksBefore }, null, 2))
        const tools = registerTools(captain, member)
        const sent = await tools.get("agent_teams_send_message").execute({ to: "Senior Engineer", content: "STAY IN SCOPE: only evidence/omo-align/verification/** for this attempt." }, { agent: captain })
        expect(sent.delivered).toBeDefined()
        const after = byId(readTasks(teamFile), "t3")
        // steering must NOT restart the attempt
        expect(after.attempt).toBe(1)
        expect(after.attemptId).toBe("attempt-live-s4")
        expect(after.status).toBe("in_progress")
        // and the bounded notice must actually be in the member's durable inbox
        const inbox = readFileSync(join(stateRoot, teamId, "inbox", "senior-engineer.jsonl"), "utf8")
        expect(inbox).toContain("STAY IN SCOPE")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("S1: a terminal failed task is retryable and completed siblings keep their results", async () => {
    const { workspace, teamFile, captain, member } = fixture()
    try {
        const tasks = readTasks(teamFile)
        byId(tasks, "t4").status = "failed"
        byId(tasks, "t4").output = "boom"
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks }, null, 2))
        const tools = registerTools(captain, member)
        const retried = await tools.get("agent_teams_reassign_task").execute({ task_id: "t4", assignee: "Senior Engineer", reason: "retry the failed node" }, { agent: captain })
        expect(retried.task_id).toBe("t4")
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
