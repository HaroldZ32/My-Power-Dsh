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
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { dependencyStates, unsatisfiedDependencies } from "../lib/state.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** The state directory the plugin resolves under a session workspace. */
const STATE_DIR = join(".mpd", "team")
/** The session id the stub registry reports as the captain of the fixture team. */
const CAPTAIN_ID = "session-captain"
/** The session id the stub registry reports as the single member of the fixture team. */
const MEMBER_ID = "session-member"

/**
 * One A -> B team record whose producer status the caller chooses.
 * @param root0 - the record's team id and the status of task A, the dependency B depends on.
 * @returns the durable team record.
 */
function teamRecord({ teamId, aStatus }: { teamId: string; aStatus: string }): {
    id: string
    name: string
    captainSessionId: string
    createdAt: number
    taskSeq: number
    phase: string
    members: Array<{ id: string; name: string; role: string; status: string; joinedAt: number }>
    tasks: Array<{ id: string; subject: string; status: string; dependencies: string[]; attempt: number; attemptId?: string; reassigning?: boolean; createdAt: number; updatedAt: number }>
} {
    /** The shared timestamp of every record the fixture plants. */
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

/**
 * A throwaway workspace holding the A -> B record plus the two live agents.
 * @param aStatus - the status written for task A.
 * @returns the workspace, the team id and record path, and the captain and member agents.
 */
function fixture(aStatus: string): {
    workspace: string
    teamId: string
    teamFile: string
    captain: { id: string; status: string; session: { header: { cwd: string } } }
    member: { id: string; status: string; session: { header: { cwd: string } } }
} {
    /** The throwaway workspace the team record is written into. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-opt1-"))
    /** The one team's directory name under the state root. */
    const teamId = "opt1-team"
    /** The team state root inside the workspace. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    /** The path of the team record both views read back. */
    const teamFile = join(stateRoot, teamId, "team.json")
    writeFileSync(teamFile, JSON.stringify(teamRecord({ teamId, aStatus }), null, 2))
    /** The live agent the registry reports for the captain session. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    /** The live agent the registry reports for the member session. */
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, teamFile, captain, member }
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
 * @returns the parsed tasks, whose id and status the arms assert on one at a time.
 */
const readTasks = (teamFile: string): Array<{ id: string; status: string; output?: string; [key: string]: unknown }> => JSON.parse(readFileSync(teamFile, "utf8")).tasks

test("OPT-1: a FAILED dependency no longer blocks its dependent (three-state)", () => {
    /** The A -> B pair whose producer A has terminally failed. */
    const tasks = [
        { id: "A", status: "failed", dependencies: [] },
        { id: "B", status: "pending", dependencies: ["A"] },
    ]
    /** The three-state verdict for B's dependency on the failed A. */
    const states = dependencyStates(tasks, ["A"])
    expect(states.blocking).toEqual([])
    expect(states.failed).toEqual(["A"])
    // the shared predicate the scheduler/claim paths read must agree
    expect(unsatisfiedDependencies(tasks, ["A"])).toEqual([])
})

test("OPT-1 reverse control: a RUNNING dependency still blocks exactly as before", () => {
    for (const status of ["pending", "claimed", "in_progress"]) {
        /** The A -> B pair whose producer A is still in flight. */
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
    /** The workspace holding the A -> B record, plus the two live agents. */
    const { workspace, teamFile, captain, member } = fixture("failed")
    try {
        /** The registry the plugin's team tools were registered into. */
        const tools = registerTools(captain, member)
        // 1) B is claimable for a member — not permanently blocked — and inside the
        //    15 s bound the revision asks for (no waiting on a dependency deadline).
        /** The instant the claim call starts, so the 15 s bound is measurable. */
        const startedAt = Date.now()
        /** The claim result for the dependent task B. */
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(Date.now() - startedAt).toBeLessThan(15000)
        expect(claimed.task_id).toBe("B")
        expect(claimed.attempt_id).toBeDefined()
        // Task B on disk after the claim; asserted present because the claim above succeeded.
        /** Task B as persisted after the successful claim. */
        const afterClaim = readTasks(teamFile).find((task) => task.id === "B")!
        expect(["claimed", "in_progress"]).toContain(afterClaim.status)
        // 2) the contract view carries the failure explicitly (no silent loss).
        /** The contract view's answer for B, which must name the failed dependency. */
        const view = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        expect(view.failed_dependencies).toEqual(["A"])
        expect(view.dependencies).toEqual(["A"])
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("OPT-1: the captain-takeover path (reassign_task) also stops blocking on a failed dep", async () => {
    /** The workspace holding the A -> B record, plus the two live agents. */
    const { workspace, teamFile, captain, member } = fixture("failed")
    try {
        /** The registry the plugin's team tools were registered into. */
        const tools = registerTools(captain, member)
        /** The captain-takeover result for the dependent task B. */
        const taken = await tools.get("agent_teams_reassign_task").execute({ task_id: "B", assignee: "captain", reason: "drive the dependent downstream of the failure" }, { agent: captain })
        expect(taken.task_id).toBe("B")
        // the OTHER escape hatch (retry the producer) is untouched and still works too
        /** The retry result for the failed producer A. */
        const retried = await tools.get("agent_teams_reassign_task").execute({ task_id: "A", assignee: "Senior Engineer", reason: "retry the failed producer" }, { agent: captain })
        expect(retried.task_id).toBe("A")
        // Task A on disk after the retry; asserted present because that reassign succeeded.
        expect(readTasks(teamFile).find((task) => task.id === "A")!.status).not.toBe("failed")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("OPT-1: B dispatches within the scheduler readiness path after A fails", () => {
    // Mirror lib/scheduler.ts nextReadyTask: pending + no blocking + not reassigning.
    /** The one-team record whose producer A has terminally failed. */
    const team = teamRecord({ teamId: "t", aStatus: "failed" })
    /** The tasks the readiness predicate would dispatch: pending, unblocked, not reassigning. */
    const ready = team.tasks.filter((task) => task.status === "pending"
        && task.reassigning !== true
        && unsatisfiedDependencies([...team.tasks], task.dependencies).length === 0)
    expect(ready.map((task) => task.id)).toEqual(["B"])
})

test("OPT-1: after A is retried to completed, B proceeds on the dependency result", async () => {
    /** The workspace holding the A -> B record, plus the two live agents. */
    const { workspace, teamFile, captain, member } = fixture("failed")
    try {
        /** The registry the plugin's team tools were registered into. */
        const tools = registerTools(captain, member)
        // retry the failed producer (the pre-existing escape hatch stays the 2nd path)
        await tools.get("agent_teams_reassign_task").execute({ task_id: "A", assignee: "Senior Engineer", reason: "retry the failed producer" }, { agent: captain })
        // Task A on disk after the retry; asserted present because that reassign succeeded.
        /** Task A as persisted after the retry. */
        const retried = readTasks(teamFile).find((task) => task.id === "A")!
        expect(retried.status).not.toBe("failed")
        // finish A successfully, then B is ready on the normal dependency result
        /** Every task of the record, rewritten below with A completed. */
        const tasks = readTasks(teamFile)
        // Task A of the read-back list; asserted present because the record always holds it.
        /** The producer task A, completed in place before the record is rewritten. */
        const a = tasks.find((task) => task.id === "A")!
        a.status = "completed"
        a.output = "producer result v2"
        writeFileSync(teamFile, JSON.stringify({ ...JSON.parse(readFileSync(teamFile, "utf8")), tasks }, null, 2))
        /** The dependency verdict for B once A has completed. */
        const states = dependencyStates(readTasks(teamFile), ["A"])
        expect(states).toEqual({ blocking: [], failed: [] })
        /** The contract view's answer for B, which must name no failed dependency. */
        const view = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        expect(view.failed_dependencies).toEqual([])
        /** The claim result proving B still dispatches on the completed dependency. */
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(claimed.task_id).toBe("B")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})
