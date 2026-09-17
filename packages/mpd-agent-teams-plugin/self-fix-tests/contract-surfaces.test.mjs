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
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "probe-team"
const CAPTAIN_ID = "session-captain"
const MEMBER_ID = "session-member"

function runningRecord({ status = "claimed", attemptId = "att-1", output } = {}) {
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

function stagedRecord() {
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

function fixture(record) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t14-contract-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(record, null, 2))
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

function registerTools(workspace, captain, member) {
    const tools = new Map()
    const ctx = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined),
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

const taskOf = (teamFile, id = "t1") => JSON.parse(readFileSync(teamFile, "utf8")).tasks.find((task) => task.id === id)

test("T-02: a captain amends a member-owned IN-FLIGHT contract without a takeover — the attempt survives", async () => {
    const { workspace, captain, member, teamFile } = fixture(runningRecord())
    try {
        const tools = registerTools(workspace, captain, member)
        const update = tools.get("agent_teams_update_task")
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
        const contract = tools.get("agent_teams_task_contract")
        const view = await contract.execute({ task_id: "t1" }, { agent: member })
        expect(view.contract_version).toBe(2)
        expect(view.attempt_contract_version).toBe(1)
        const rendered = contract.output.render({}, view)[0].text
        expect(rendered).toContain("Contract revision: 2")
        expect(rendered).toContain("AMENDED since this attempt was claimed")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-02: a member amends its OWN contract at claim time WITHOUT an attempt_id; elsewhere it stays refused", async () => {
    const claimed = fixture(runningRecord())
    const inProgress = fixture(runningRecord({ status: "in_progress" }))
    try {
        const updateClaimed = registerTools(claimed.workspace, claimed.captain, claimed.member).get("agent_teams_update_task")
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
        const task = taskOf(claimed.teamFile)
        expect(task.acceptance).toEqual(["owner-corrected"])
        expect(task.inScope).toEqual(["src/allowed/**"])
        expect(task.contractVersion).toBe(2)
        expect(task.contractAmendedBy).toBe("Architect")

        // once the task is IN PROGRESS the member's amend is refused LOUDLY (captain action)
        const updateRunning = registerTools(inProgress.workspace, inProgress.captain, inProgress.member).get("agent_teams_update_task")
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
    const { workspace, captain, member, teamFile } = fixture(stagedRecord())
    try {
        const tools = registerTools(workspace, captain, member)
        const editPlan = tools.get("agent_teams_edit_plan")
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
    const terminal = fixture(runningRecord({ status: "completed", attemptId: "att-9", output: "ORIGINAL SUMMARY" }))
    const running = fixture(runningRecord({ status: "in_progress", attemptId: "att-1" }))
    try {
        const updateTerminal = registerTools(terminal.workspace, terminal.captain, terminal.member).get("agent_teams_update_task")
        const appended = await updateTerminal.execute(
            { task_id: "t1", status: "completed", attempt_id: "att-9", output_append: "RECOVERED PARAGRAPH" },
            { agent: terminal.member },
        )
        expect(appended.status).toBe("completed")
        const repaired = taskOf(terminal.teamFile)
        // APPEND-ONLY: the stored bytes were extended, never rewritten
        expect(repaired.output).toBe("ORIGINAL SUMMARY\n\nRECOVERED PARAGRAPH")
        expect(repaired.output.startsWith("ORIGINAL SUMMARY")).toBe(true)
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
        const updateRunning = registerTools(running.workspace, running.captain, running.member).get("agent_teams_update_task")
        const runningAppend = await updateRunning.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", output_append: "PART 2/4" },
            { agent: running.member },
        )
        // asserted on the CALL's return: the tool's own post-lock kick may re-dispatch this team
        // (t36's recoverOwned route) and `activateTaskAttempt` clears a stored output, so the
        // disk value is not a stable witness of THIS call's effect.
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
