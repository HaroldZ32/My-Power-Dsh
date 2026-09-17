// t4: DEFECT 3 — a running task's contract must be READABLE.
//
// Wave-1 evidence: `agent_teams_edit_plan` is staged-only and its operation schema
// has no inScope field, and `agent_teams_update_task` is owner-only status/output,
// so nothing exposed a running task's contract; the captain could not see the
// contract it was being asked to satisfy. This test drives the REAL registered
// tool (`agent_teams_task_contract`) against a REAL team record on disk and proves
// the read path is live, exact and read-only.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")

/** One team record with a RUNNING implementation task and its declared contract. */
function teamRecord({ teamId, captainId, memberId }) {
    const now = Date.now()
    return {
        id: teamId,
        name: "contract readability probe",
        captainSessionId: captainId,
        createdAt: now,
        taskSeq: 4,
        phase: "running",
        members: [{ id: memberId, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t4",
                subject: "adopted tooling",
                status: "in_progress",
                assignee: "Senior Engineer",
                dependencies: ["t1"],
                attempt: 1,
                attemptId: "attempt-live-1",
                createdAt: now,
                updatedAt: now,
                kind: "implementation",
                round: 1,
                objective: "prove a running task's contract is readable",
                inScope: ["packages/foo/test/**"],
                outOfScope: ["packages/foo/lib"],
                acceptance: ["glob declarations are honoured"],
                verify: ["bun test packages/foo"],
                acceptanceResults: [],
                commandsRun: [],
                changedPaths: [],
            },
        ],
    }
}

/** Register the adopted tools against a stub ctx and return the registry. */
function registerTools(workspace, captain, member) {
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
        logger: { warn: () => {}, info: () => {}, error: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-contract-tool-"))
    const teamId = "probe-team"
    const captainId = "session-captain"
    const memberId = "session-member"
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    const record = teamRecord({ teamId, captainId, memberId })
    writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify(record, null, 2))
    const captain = { id: captainId, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: memberId, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, record, captain, member, teamFile: join(stateRoot, teamId, "team.json") }
}

test("DEFECT 3: a RUNNING task's contract is readable and matches what was declared", async () => {
    const { workspace, captain, member, teamFile, record } = fixture()
    try {
        const tools = registerTools(workspace, captain, member)
        const tool = tools.get("agent_teams_task_contract")
        expect(tool).toBeDefined()

        const before = readFileSync(teamFile, "utf8")
        const contract = await tool.execute({ task_id: "t4" }, { agent: captain })
        const after = readFileSync(teamFile, "utf8")

        // READ-ONLY: the durable record is byte-identical after the read
        expect(after).toBe(before)

        // EXACT: every declared field round-trips, including the running status
        const declared = record.tasks[0]
        expect(contract.task_id).toBe("t4")
        expect(contract.status).toBe("in_progress")
        expect(contract.assignee).toBe("Senior Engineer")
        expect(contract.attempt_id).toBe("attempt-live-1")
        expect(contract.dependencies).toEqual(declared.dependencies)
        expect(contract.in_scope).toEqual(declared.inScope)
        expect(contract.out_of_scope).toEqual(declared.outOfScope)
        expect(contract.acceptance).toEqual(declared.acceptance)
        expect(contract.verify).toEqual(declared.verify)
        expect(contract.objective).toBe(declared.objective)

        // RENDERED: the model-facing block carries the same contract spelling the
        // member receives in its assignment prompt.
        const rendered = tool.output.render({}, contract)[0].text
        expect(rendered).toContain("Task t4 [in_progress] implementation round 1 — adopted tooling")
        expect(rendered).toContain("In scope: packages/foo/test/**")
        expect(rendered).toContain("Out of scope: packages/foo/lib")
        expect(rendered).toContain("Acceptance: glob declarations are honoured")
        expect(rendered).toContain("Verify: bun test packages/foo")
        expect(rendered).toContain("Dependencies: t1")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("DEFECT 3: the full agent-teams tool surface registers, with the contract tool among it", async () => {
    const { workspace, captain, member } = fixture()
    try {
        const tools = registerTools(workspace, captain, member)
        // the whole server-side tree applied without throwing, and the read-only
        // contract surface joined the established set. t52 added the three interjection
        // lane tools (request / decide / clear) and t20 added the three ownership/wave
        // tools (path_owner / move_path / rollover), which is why the pinned count grew:
        // the list below is exhaustive on purpose, so a tool can never appear or vanish
        // silently.
        expect(tools.size).toBe(20)
        expect([...tools.keys()].sort()).toEqual([
            "agent_teams_add_member", "agent_teams_approve", "agent_teams_claim_task", "agent_teams_create",
            "agent_teams_create_task", "agent_teams_delete", "agent_teams_edit_plan", "agent_teams_interject_decide",
            "agent_teams_interject_request", "agent_teams_mailbox_clear", "agent_teams_move_path",
            "agent_teams_path_owner", "agent_teams_reassign_task",
            "agent_teams_remove_member", "agent_teams_resume", "agent_teams_rollover", "agent_teams_send_message",
            "agent_teams_status", "agent_teams_task_contract", "agent_teams_update_task",
        ])
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("DEFECT 3: the read-only surface is available to a member too and rejects unknown ids", async () => {
    const { workspace, captain, member, teamFile } = fixture()
    try {
        const tools = registerTools(workspace, captain, member)
        const tool = tools.get("agent_teams_task_contract")
        const before = readFileSync(teamFile, "utf8")
        const asMember = await tool.execute({ task_id: "t4" }, { agent: member })
        expect(asMember.task_id).toBe("t4")
        expect(asMember.in_scope).toEqual(["packages/foo/test/**"])
        // a member read leaves the durable record untouched too
        expect(readFileSync(teamFile, "utf8")).toBe(before)
        await expect(tool.execute({ task_id: "t99" }, { agent: captain })).rejects.toThrow(/does not exist/)
        await expect(tool.execute({ task_id: "  " }, { agent: captain })).rejects.toThrow(/required/)
        // the surface takes exactly one (read-only) parameter
        expect(tool.parameters.type).toBe("object")
        expect(tool.parameters.properties.task_id.type).toBe("string")
        expect(Object.keys(tool.parameters.properties)).toEqual(["task_id"])
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})
