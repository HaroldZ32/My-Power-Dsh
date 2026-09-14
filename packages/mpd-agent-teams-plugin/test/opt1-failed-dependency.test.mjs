// OPT-1 (user decision 2026-09-13, binding): a FAILED dependency must not pin its
// dependents forever. The dependency predicate becomes three-state —
// satisfied / failed-dependency / unsatisfied — where a failed dependency records
// the failure but leaves the dependent `pending` and DISPATCHABLE.
//
// Falsifiable assertions (all measured here):
//  1. A→B, A terminates failed => B is still claimable (NOT permanently blocked),
//     and B's contract view names its failed dependency.
//  2. A is retried and succeeds => B proceeds on the dependency result as usual.
//  3. REVERSE CONTROL: when A is still running, B is exactly as ready as before
//     (the three-state change did not open the normal blocking path).
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dependencyStates, unsatisfiedDependencies } from "../lib/state.js"
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain"
const MEMBER_ID = "session-member"

function teamRecord({ teamId, aStatus }) {
    const now = Date.now()
    return {
        id: teamId,
        name: "opt-1 failed dependency probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 2,
        phase: "running",
        members: [{ id: MEMBER_ID, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [
            { id: "A", subject: "upstream producer", status: aStatus, dependencies: [], attempt: 1, attemptId: "cap-A", createdAt: now, updatedAt: now },
            { id: "B", subject: "downstream consumer", status: "pending", dependencies: ["A"], attempt: 0, createdAt: now, updatedAt: now },
        ],
    }
}

function fixture(aStatus) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-opt1-"))
    const teamId = "opt1-team"
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    const teamFile = join(stateRoot, teamId, "team.json")
    writeFileSync(teamFile, JSON.stringify(teamRecord({ teamId, aStatus }), null, 2))
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, teamFile, captain, member }
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

test("OPT-1: a FAILED dependency no longer blocks its dependent (three-state)", () => {
    const tasks = [
        { id: "A", status: "failed", dependencies: [] },
        { id: "B", status: "pending", dependencies: ["A"] },
    ]
    const states = dependencyStates(tasks, ["A"])
    expect(states.blocking).toEqual([])
    expect(states.failed).toEqual(["A"])
    // the shared predicate the scheduler/claim paths read must agree
    expect(unsatisfiedDependencies(tasks, ["A"])).toEqual([])
})

test("OPT-1 reverse control: a RUNNING dependency still blocks exactly as before", () => {
    for (const status of ["pending", "claimed", "in_progress"]) {
        const tasks = [
            { id: "A", status, dependencies: [] },
            { id: "B", status: "pending", dependencies: ["A"] },
        ]
        expect(unsatisfiedDependencies(tasks, ["A"])).toEqual(["A"])
        expect(dependencyStates(tasks, ["A"])).toEqual({ blocking: ["A"], failed: [] })
    }
    // completed + cancelled stay non-blocking (cancelled was already the deadlock rule)
    expect(unsatisfiedDependencies([{ id: "A", status: "completed" }], ["A"])).toEqual([])
    expect(unsatisfiedDependencies([{ id: "A", status: "cancelled" }], ["A"])).toEqual([])
    // an unknown dependency id is still a blocker (never silently dispatchable)
    expect(unsatisfiedDependencies([], ["ghost"])).toEqual(["ghost"])
})

test("OPT-1: B stays CLAIMABLE after A fails, and its view names the failed dependency", async () => {
    const { workspace, teamFile, captain, member } = fixture("failed")
    try {
        const tools = registerTools(captain, member)
        // 1) B is claimable for a member — not permanently blocked — and inside the
        //    15 s bound the revision asks for (no waiting on a dependency deadline).
        const startedAt = Date.now()
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(Date.now() - startedAt).toBeLessThan(15000)
        expect(claimed.task_id).toBe("B")
        expect(claimed.attempt_id).toBeDefined()
        const afterClaim = readTasks(teamFile).find((task) => task.id === "B")
        expect(["claimed", "in_progress"]).toContain(afterClaim.status)
        // 2) the contract view carries the failure explicitly (no silent loss).
        const view = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        expect(view.failed_dependencies).toEqual(["A"])
        expect(view.dependencies).toEqual(["A"])
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("OPT-1: the captain-takeover path (reassign_task) also stops blocking on a failed dep", async () => {
    const { workspace, teamFile, captain, member } = fixture("failed")
    try {
        const tools = registerTools(captain, member)
        const taken = await tools.get("agent_teams_reassign_task").execute({ task_id: "B", assignee: "captain", reason: "drive the dependent downstream of the failure" }, { agent: captain })
        expect(taken.task_id).toBe("B")
        // the OTHER escape hatch (retry the producer) is untouched and still works too
        const retried = await tools.get("agent_teams_reassign_task").execute({ task_id: "A", assignee: "Senior Engineer", reason: "retry the failed producer" }, { agent: captain })
        expect(retried.task_id).toBe("A")
        expect(readTasks(teamFile).find((task) => task.id === "A").status).not.toBe("failed")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("OPT-1: B dispatches within the scheduler readiness path after A fails", () => {
    // Mirror lib/scheduler.js nextReadyTask: pending + no blocking + not reassigning.
    const team = teamRecord({ teamId: "t", aStatus: "failed" })
    const ready = team.tasks.filter((task) => task.status === "pending"
        && task.reassigning !== true
        && unsatisfiedDependencies([...team.tasks], task.dependencies).length === 0)
    expect(ready.map((task) => task.id)).toEqual(["B"])
})

test("OPT-1: after A is retried to completed, B proceeds on the dependency result", async () => {
    const { workspace, teamFile, captain, member } = fixture("failed")
    try {
        const tools = registerTools(captain, member)
        // retry the failed producer (the pre-existing escape hatch stays the 2nd path)
        await tools.get("agent_teams_reassign_task").execute({ task_id: "A", assignee: "Senior Engineer", reason: "retry the failed producer" }, { agent: captain })
        const retried = readTasks(teamFile).find((task) => task.id === "A")
        expect(retried.status).not.toBe("failed")
        // finish A successfully, then B is ready on the normal dependency result
        const tasks = readTasks(teamFile)
        const a = tasks.find((task) => task.id === "A")
        a.status = "completed"
        a.output = "producer result v2"
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks }, null, 2))
        const states = dependencyStates(readTasks(teamFile), ["A"])
        expect(states).toEqual({ blocking: [], failed: [] })
        const view = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        expect(view.failed_dependencies).toEqual([])
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(claimed.task_id).toBe("B")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})
