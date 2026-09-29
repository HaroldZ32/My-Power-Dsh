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
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")

/** One stub session the registry answers with, rooted at the fixture workspace. */
type StubAgent = {
    /** Session id the registry matches the caller against. */
    readonly id: string
    /** Liveness status the tools read for their ownership checks. */
    readonly status: string
    /** The session header carrying the workspace cwd, which roots every state read. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One tool the vendored surface registered, naming only the members these arms use. */
type RegisteredTool = {
    /** Tool name, the key the model calls it by. */
    readonly name: string
    /** Object-rooted JSON Schema for the arguments, pinned by the last arm. */
    readonly parameters: {
        /** Always `object` for a tool argument schema. */
        readonly type: string
        /** One schema per named argument; the contract tool takes exactly one. */
        readonly properties: Record<string, { readonly type?: string }>
    }
    /** Rendering seam: the model-facing text block for a returned value. */
    readonly output: { readonly render: (args: Record<string, unknown>, value: unknown) => Array<{ readonly text: string }> }
    /** The tool body; `exec.agent` is the calling session. */
    readonly execute: (args: Record<string, unknown>, exec: { agent: unknown }) => Promise<Record<string, unknown>>
}

/** One persisted team record, naming only the fields this fixture writes. */
type TeamRecord = {
    /** Team id the tools resolve under the state root. */
    id: string
    /** Human-facing team name. */
    name: string
    /** Session id the captain-only gates match. */
    captainSessionId: string
    /** Epoch ms the record was created. */
    createdAt: number
    /** Next task sequence number. */
    taskSeq: number
    /** Team phase; the read arm runs against a `running` team. */
    phase: string
    /** Member rows, with the single seeded engineer. */
    members: Array<Record<string, unknown>>
    /** Task rows; the first one carries the contract under test. */
    tasks: Array<Record<string, unknown>>
}

/** One team record with a RUNNING implementation task and its declared contract. */
function teamRecord({ teamId, captainId, memberId }: { teamId: string; captainId: string; memberId: string }): TeamRecord {
    /** The fixture clock shared by the record and its task. */
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
function registerTools(workspace: string, captain: StubAgent, member: StubAgent): Map<string, RegisteredTool> {
    /** Tools the vendored surface registered, keyed by the name the model calls. */
    const tools = new Map<string, RegisteredTool>()
    /** The stub composition root the shipped surface is installed on. */
    const ctx = {
        tools: { register: (definition: RegisteredTool) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined),
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

/** One fixture: a real team record on disk plus the two sessions the registry answers with. */
function fixture(): {
    /** Absolute workspace every stub session reports as its cwd. */
    workspace: string
    /** Team id the tools resolve under the state root. */
    teamId: string
    /** The record as written to disk, kept so the arms can compare field by field. */
    record: TeamRecord
    /** The captain session, whose id the record names. */
    captain: StubAgent
    /** The engineer session the task is assigned to. */
    member: StubAgent
    /** The `<workspace>/.mpd/team/<teamId>/team.json` path the arms read back. */
    teamFile: string
} {
    /** Temporary workspace every stub session reports as its cwd. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-contract-tool-"))
    /** Team id the fixture writes its single team record under. */
    const teamId = "probe-team"
    /** Session id the record names as the captain. */
    const captainId = "session-captain"
    /** Session id the record names as the task's assignee. */
    const memberId = "session-member"
    /** The state root under that workspace, where the record lives. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    /** The record as written to disk; the read arm compares the tool's answer against it. */
    const record = teamRecord({ teamId, captainId, memberId })
    writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify(record, null, 2))
    /** The captain session, whose id the record names. */
    const captain = { id: captainId, status: "idle", session: { header: { cwd: workspace } } }
    /** The engineer session the task is assigned to. */
    const member = { id: memberId, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, record, captain, member, teamFile: join(stateRoot, teamId, "team.json") }
}

test("DEFECT 3: a RUNNING task's contract is readable and matches what was declared", async () => {
    // The fixture's workspace, both sessions, the record file and the record written to it.
    const { workspace, captain, member, teamFile, record } = fixture()
    try {
        /** Tools the shipped surface registered for this fixture. */
        const tools = registerTools(workspace, captain, member)
        /** The read-only contract tool, which must be on the registered surface. */
        const tool = tools.get("agent_teams_task_contract")!
        expect(tool).toBeDefined()

        /** The record file's bytes before the read, compared against the bytes after. */
        const before = readFileSync(teamFile, "utf8")
        /** The tool's answer: the running task's contract, read through the shipped path. */
        const contract = await tool.execute({ task_id: "t4" }, { agent: captain })
        /** The record file's bytes after the read; a read-only path must not change them. */
        const after = readFileSync(teamFile, "utf8")

        // READ-ONLY: the durable record is byte-identical after the read
        expect(after).toBe(before)

        // EXACT: every declared field round-trips, including the running status
        /** The task row exactly as declared on disk, the answer's comparison baseline. */
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
        /** The rendered text block, which must spell the same contract the member gets. */
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
    // The fixture's workspace and both sessions; the record file itself is not read here.
    const { workspace, captain, member } = fixture()
    try {
        /** Tools the shipped surface registered for this fixture. */
        const tools = registerTools(workspace, captain, member)
        // the whole server-side tree applied without throwing, and the read-only
        // contract surface joined the established set. t52 added the three interjection
        // lane tools (request / decide / clear) and t20 added the three ownership/wave
        // tools (path_owner / move_path / rollover), which is why the pinned count grew:
        // the list below is exhaustive on purpose, so a tool can never appear or vanish
        // silently.
        // t48 (P1d): the READ-ONLY pre-send check is the 21st tool — the pin moves WITH the tool.
        expect(tools.size).toBe(21)
        expect([...tools.keys()].sort()).toEqual([
            "agent_teams_add_member", "agent_teams_approve", "agent_teams_claim_task", "agent_teams_create",
            "agent_teams_create_task", "agent_teams_delete", "agent_teams_edit_plan", "agent_teams_interject_decide",
            "agent_teams_interject_request", "agent_teams_mailbox_check", "agent_teams_mailbox_clear",
            "agent_teams_move_path",
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
    // The fixture's workspace, both sessions and the record file the reads must leave alone.
    const { workspace, captain, member, teamFile } = fixture()
    try {
        /** Tools the shipped surface registered for this fixture. */
        const tools = registerTools(workspace, captain, member)
        /** The read-only contract tool, which a member must be able to call too. */
        const tool = tools.get("agent_teams_task_contract")!
        /** The record file's bytes before the member's read. */
        const before = readFileSync(teamFile, "utf8")
        /** The member's answer, which must carry the same contract as the captain's. */
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
