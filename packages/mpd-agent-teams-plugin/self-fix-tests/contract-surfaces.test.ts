// Wave-1 (t14, lane B2) self-fix tests — three contract surfaces of the adopted plugin:
//
//   T-02 — an OWNED task's contract is REPAIRABLE: a captain amends a member-owned IN-FLIGHT
//          task without a takeover (the live attempt survives, and the revision is stamped so a
//          reviewer sees that the attempt was claimed under an older revision), and a member may
//          amend at CLAIM TIME without an attempt_id. Every other amend stays loud.
//   T-03 — `agent_teams_edit_plan.add_task` carries the FULL quality contract and runs the SAME
//          gate as create_task, so a staged-plan edit can no longer silently downgrade a quality
//          task to legacy `work`.
//   T-52 — a TERMINAL task's `output` can be repaired by an APPEND-only path; every other
//          terminal field stays immutable, and an append on a running task is refused.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** The overridable fields of the running-record fixture. */
interface RecordInput {
    /** The task's status, which decides whether an amend is a claim-time carve-out. */
    readonly status?: string
    /** The task's attempt id; undefined writes no attempt id field at all. */
    readonly attemptId?: string
    /** The stored deliverable; undefined writes no output field at all. */
    readonly output?: string
}

/** One live-agent double the tools registry answers with. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status. */
    readonly status: string
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** The decoded result of one tool call, whose fields each arm reads for its own tool. */
interface ToolResult {
    /** The id of the task the call touched. */
    readonly task_id: string
    /** The task's status as the call reports it. */
    readonly status: string
    /** The task's attempt number as the call reports it. */
    readonly attempt: number
    /** The contract revision the amend stamped. */
    readonly contract_version: number
    /** The revision the live attempt was claimed under. */
    readonly attempt_contract_version: number
    /** The appended channel's value on a running append. */
    readonly output: string
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
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<ToolResult>
    /** The tool's own renderer, which the contract view is read through. */
    readonly output: { render(args: Record<string, unknown>, value: unknown): readonly { readonly text: string }[] }
}

/** One task as the fixture writes it, with the contract fields an amend stamps. */
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
    /** The current attempt id, absent while the task is pending. */
    readonly attemptId?: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed, in epoch milliseconds. */
    readonly updatedAt: number
    /** The task's kind, which the staged edit must not downgrade. */
    readonly kind: string
    /** The task's objective text. */
    readonly objective?: string
    /** The write scope the task declares. */
    readonly inScope?: readonly string[]
    /** Patterns the task explicitly excludes. */
    readonly outOfScope?: readonly string[]
    /** The criteria the task must satisfy; the amend replaces them. */
    readonly acceptance: readonly string[]
    /** The commands the task must run. */
    readonly verify?: readonly string[]
    /** The stored deliverable, which the append channel extends. */
    readonly output?: string
    /** How many times the contract has been amended. */
    readonly contractVersion?: number
    /** The seat that last amended the contract. */
    readonly contractAmendedBy?: string
    /** When the contract was last amended, in epoch milliseconds. */
    readonly contractAmendedAt?: number
}

/** One team record as the fixtures write it and `taskOf` reads it back. */
interface ProbeRecord {
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
    /** The team's lifecycle phase; `staged` is what the edit-plan arm needs. */
    readonly phase: string
    /** The plan-review state a staged team carries. */
    readonly planReviewState?: string
    /** The member rows. */
    readonly members: readonly unknown[]
    /** The task set. */
    readonly tasks: readonly ProbeTask[]
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The team id the fixture writes and the state root is keyed by. */
const TEAM_ID = "probe-team"
/** The captain's session id, which owns the fixture team. */
const CAPTAIN_ID = "session-captain"
/** The member seat that owns the in-flight task. */
const MEMBER_ID = "session-member"

/** The overridable running-record fixture: one owned, in-flight task. */
function runningRecord({ status = "claimed", attemptId = "att-1", output }: RecordInput = {}): ProbeRecord {
/** The instant every timestamp in the fixture record is stamped with. */
    const now = Date.now()
    return {
        id: TEAM_ID,
        name: "contract surfaces probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 1,
        phase: "running",
        members: [{ id: MEMBER_ID, name: "Architect", role: "architect", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t1",
                subject: "the contract",
                status,
                assignee: "Architect",
                dependencies: [],
                attempt: 1,
                ...attemptId === undefined ? {} : { attemptId },
                createdAt: now,
                updatedAt: now,
                kind: "implementation",
                objective: "prove repair",
                inScope: ["src/**"],
                acceptance: ["original acceptance"],
                verify: ["bun test"],
                ...output === undefined ? {} : { output },
            },
        ],
    }
}

/** A STAGED team awaiting plan review, with one planned requirement task. */
function stagedRecord(): ProbeRecord {
/** The instant every timestamp in the staged record is stamped with. */
    const now = Date.now()
    return {
        id: TEAM_ID,
        name: "staged probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 1,
        phase: "staged",
        planReviewState: "awaiting_review",
        members: [{ id: "", name: "Architect", role: "architect", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t1",
                subject: "planned requirement",
                status: "pending",
                assignee: "Architect",
                dependencies: [],
                attempt: 0,
                kind: "requirements",
                objective: "freeze acceptance",
                acceptance: ["declared"],
                createdAt: now,
                updatedAt: now,
            },
        ],
    }
}

/** Write a record into a fresh workspace and return the roots plus both seats. */
function fixture(record: ProbeRecord): { workspace: string; stateRoot: string; captain: AgentLike; member: AgentLike; teamFile: string } {
/** The temporary workspace the fixture team lives in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t14-contract-"))
/** The resolved team-state root the tools are keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(record, null, 2))
/** The captain double every captain-side call runs as. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
/** The member double the member-side call runs as. */
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

/** Register the REAL tools over a context double and return the captured definitions. */
function registerTools(workspace: string, captain: AgentLike, member: AgentLike): Map<string, ToolDefinition> {
/** The definitions the registration double captured, keyed by tool name. */
    const tools = new Map()
/** The context double the vendored registration path drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined),
            list: () => [captain, member],
        },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

/** The task with the given id as it stands on disk; the fixture wrote it, so it is there. */
const taskOf = (teamFile: string, id: string = "t1"): ProbeTask => JSON.parse(readFileSync(teamFile, "utf8")).tasks.find((task: ProbeTask) => task.id === id)

test("T-02: a captain amends a member-owned IN-FLIGHT contract without a takeover — the attempt survives", async () => {
/** The fixture roots, both seats and the record file this arm drives. */
    const { workspace, captain, member, teamFile } = fixture(runningRecord())
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(workspace, captain, member)
/** The registered update tool; the registry above captured it, so the lookup cannot miss. */
        const update = tools.get("agent_teams_update_task")!
/** The captain's amend answer. */
        const result = await update.execute(
            { task_id: "t1", status: "in_progress", amend: { acceptance: ["corrected acceptance"] } },
            { agent: captain },
        )
        expect(result.task_id).toBe("t1")
        // NOTE on the status argument: the amend branch returns BEFORE any status write, so this
        // value never lands — the gate for a claim-time amend is the TASK's own status ("claimed",
        // asserted on disk below). The parameter stays REQUIRED (wave-2 DEFECT 6) and its enum is
        // pinned by test/update-task-diagnostics.test.mjs, so this lane does not widen it.
        // THE AMEND'S OWN EFFECT (from its return value, which no later dispatch can change):
        // the task stays where it was — no status reset, no attempt rotation, no revocation.
        // (`reassign_task` — the takeover T-02 removes — would have moved it to the captain.)
        expect(result.status).toBe("claimed")
        expect(result.attempt).toBe(1)
/** The task as it stands on disk after the amend. */
        const task = taskOf(teamFile)
        // the definition moved...
        expect(task.acceptance).toEqual(["corrected acceptance"])
        expect(task.status).toBe("claimed")
        // NOTE: the disk `attemptId` may be rotated AFTER the lock by the tool's own team kick —
        // that is the separate recoverOwned re-dispatch route measured as t36, not this amend.
        expect(task.contractVersion).toBe(2)
        expect(task.contractAmendedBy).toBe("captain")
        expect(typeof task.contractAmendedAt).toBe("number")

        // a reviewer SEES the revision pair through the read-only contract surface
        const contract = tools.get("agent_teams_task_contract")!
/** The read-only contract view the member reads. */
        const view = await contract.execute({ task_id: "t1" }, { agent: member })
        expect(view.contract_version).toBe(2)
        expect(view.attempt_contract_version).toBe(1)
/** The contract surface as the model would read it. */
        const rendered = contract.output.render({}, view)[0].text
        expect(rendered).toContain("Contract revision: 2")
        expect(rendered).toContain("AMENDED since this attempt was claimed")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-02: a member amends its OWN contract at claim time WITHOUT an attempt_id; elsewhere it stays refused", async () => {
/** A fixture whose task is still CLAIMED. */
    const claimed = fixture(runningRecord())
/** A fixture whose task is already IN PROGRESS. */
    const inProgress = fixture(runningRecord({ status: "in_progress" }))
    try {
/** The registered update tool over the claimed fixture. */
        const updateClaimed = registerTools(claimed.workspace, claimed.captain, claimed.member).get("agent_teams_update_task")!
        // no attempt_id on purpose: an amend-only call is definition work and returns before any write
        const result = await updateClaimed.execute(
            { task_id: "t1", status: "in_progress", amend: { acceptance: ["owner-corrected"], inScope: ["src/allowed/**"] } },
            { agent: claimed.member },
        )
        expect(result.task_id).toBe("t1")
        // an amend-only call with NO attempt_id is accepted at claim time (the carve-out), and it
        // still reports the task unchanged: no status move, no attempt rotation of its own.
        expect(result.status).toBe("claimed")
        expect(result.attempt).toBe(1)
/** The claimed fixture's task as it stands after the owner's amend. */
        const task = taskOf(claimed.teamFile)
        expect(task.acceptance).toEqual(["owner-corrected"])
        expect(task.inScope).toEqual(["src/allowed/**"])
        expect(task.contractVersion).toBe(2)
        expect(task.contractAmendedBy).toBe("Architect")

        // once the task is IN PROGRESS the member's amend is refused LOUDLY (captain action)
        const updateRunning = registerTools(inProgress.workspace, inProgress.captain, inProgress.member).get("agent_teams_update_task")!
        await expect(updateRunning.execute(
            { task_id: "t1", status: "in_progress", amend: { acceptance: ["too late"] } },
            { agent: inProgress.member },
        )).rejects.toThrow(/ONLY at claim time/)
        // and the refusal persisted NOTHING
        expect(taskOf(inProgress.teamFile).acceptance).toEqual(["original acceptance"])
    }
    finally {
        rmSync(claimed.workspace, { recursive: true, force: true })
        rmSync(inProgress.workspace, { recursive: true, force: true })
    }
})

test("T-03: edit_plan.add_task carries the full quality contract through the same gate as create_task", async () => {
/** The fixture roots, both seats and the record file this arm drives. */
    const { workspace, captain, member, teamFile } = fixture(stagedRecord())
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(workspace, captain, member)
/** The registered edit-plan tool. */
        const editPlan = tools.get("agent_teams_edit_plan")!
/** The edit plan's answer for one staged add_task operation. */
        const result = await editPlan.execute({
            operations: [{
                action: "add_task",
                subject: "staged implementation",
                assignee: "Architect",
                dependencies: ["t1"],
                kind: "implementation",
                objective: "keep the contract on a staged edit",
                acceptance: ["the contract survives the edit"],
                inScope: ["packages/foo/**"],
                outOfScope: ["packages/foo/vendor/**"],
                verify: ["bun test packages/foo"],
            }],
        }, { agent: captain })
        expect(result.status).toBe("staged")
/** The task the staged edit added, read back from disk. */
        const added = taskOf(teamFile, "t2")
        expect(added).toBeDefined()
        // the WHOLE contract arrived: no silent downgrade to legacy `work`
        expect(added.kind).toBe("implementation")
        expect(added.objective).toBe("keep the contract on a staged edit")
        expect(added.acceptance).toEqual(["the contract survives the edit"])
        expect(added.inScope).toEqual(["packages/foo/**"])
        expect(added.outOfScope).toEqual(["packages/foo/vendor/**"])
        expect(added.verify).toEqual(["bun test packages/foo"])

        // CONTROL: the SAME gate create_task runs refuses an incomplete quality contract, loudly,
        // and the staged batch is atomic (nothing is written)
        const before = readFileSync(teamFile, "utf8")
        await expect(editPlan.execute({
            operations: [{
                action: "add_task",
                subject: "downgraded implementation",
                assignee: "Architect",
                dependencies: ["t1"],
                kind: "implementation",
                objective: "no scope declared",
                acceptance: ["x"],
            }],
        }, { agent: captain })).rejects.toThrow(/inScope|scope/i)
        expect(readFileSync(teamFile, "utf8")).toBe(before)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-52: a terminal output is repaired APPEND-ONLY; every other terminal write and a running append stay refused", async () => {
/** A fixture whose task is COMPLETED and carries a summary. */
    const terminal = fixture(runningRecord({ status: "completed", attemptId: "att-9", output: "ORIGINAL SUMMARY" }))
/** A fixture whose task is still running. */
    const running = fixture(runningRecord({ status: "in_progress", attemptId: "att-1" }))
    try {
/** The registered update tool over the terminal fixture. */
        const updateTerminal = registerTools(terminal.workspace, terminal.captain, terminal.member).get("agent_teams_update_task")!
/** The append-only repair's answer. */
        const appended = await updateTerminal.execute(
            { task_id: "t1", status: "completed", attempt_id: "att-9", output_append: "RECOVERED PARAGRAPH" },
            { agent: terminal.member },
        )
        expect(appended.status).toBe("completed")
/** The terminal task as it stands on disk after the append. */
        const repaired = taskOf(terminal.teamFile)
        // APPEND-ONLY: the stored bytes were extended, never rewritten
        expect(repaired.output).toBe("ORIGINAL SUMMARY\n\nRECOVERED PARAGRAPH")
        // The `!` is the arm's own reading: the append above just proved the summary is stored.
        expect(repaired.output!.startsWith("ORIGINAL SUMMARY")).toBe(true)
        expect(repaired.status).toBe("completed")

        // CONTROL 1: replacing the terminal summary is still refused (immutability preserved)
        await expect(updateTerminal.execute(
            { task_id: "t1", status: "completed", attempt_id: "att-9", output: "replacement" },
            { agent: terminal.member },
        )).rejects.toThrow(/immutable/)
        expect(taskOf(terminal.teamFile).output).toBe("ORIGINAL SUMMARY\n\nRECOVERED PARAGRAPH")

        // CONTROL 2: SUPERSEDED by wave-1 t19 (T-46) — an append while the task is RUNNING is now
        // the deliverable channel itself (it EXTENDS the stored summary; it is no longer refused
        // as a terminal-only repair). The append-only semantics are unchanged and pinned in
        // self-fix-tests/deliverable-channel.test.mjs.
        const updateRunning = registerTools(running.workspace, running.captain, running.member).get("agent_teams_update_task")!
/** The running append's answer, which isolates this call's effect from a later re-dispatch. */
        const runningAppend = await updateRunning.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", output_append: "PART 2/4" },
            { agent: running.member },
        )
        // asserted on the CALL's return: the tool's own post-lock kick may still re-dispatch this
        // team (t36's recoverOwned route). Wave 2 (t24 / T-73) stopped `activateTaskAttempt` from
        // clearing a SAME-generation re-dispatch's output, so the disk value would now normally
        // agree — but the return value is what isolates THIS call's effect from any later
        // re-dispatch, which is why the assertion stays where it is.
        expect(runningAppend.output).toBe("PART 2/4")

        // CONTROL 3: a blank append is refused (no silent no-op)
        await expect(updateTerminal.execute(
            { task_id: "t1", status: "completed", attempt_id: "att-9", output_append: "   " },
            { agent: terminal.member },
        )).rejects.toThrow(/must not be blank/)
    }
    finally {
        rmSync(terminal.workspace, { recursive: true, force: true })
        rmSync(running.workspace, { recursive: true, force: true })
    }
})
