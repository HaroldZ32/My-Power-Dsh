// Wave-3 (t2): the two `agent_teams_update_task` diagnostics measured on real
// members during wave 2, driven through the REAL registered tool against a REAL
// team record on disk.
//
// DEFECT 5: the stale check is
//   `task.attemptId !== undefined && args.attempt_id !== task.attemptId`
// so an OMITTED attempt_id compares unequal and surfaces as
// `stale attempt for task <id>: expected the current attempt_id; stop work and
// request fresh assignment` — on t6 that made the member STOP and ask for a
// re-dispatch while its attempt was actually current, costing a captain reassign.
// An omission must be reported as a REQUIRED parameter instead.
//
// DEFECT 6: an oversized arguments payload was persisted with every field EXCEPT
// the trailing one (t6 lost `status`, so the task silently stayed in
// `in_progress`; t10 lost `attempt_id`, which then produced the misleading stale
// message above). The raw provider fragment stream is byte-identical to the
// assembled arguments and the harness parse is key-lossless, so no layer inside
// the plugin can size-check the loss; the tool now REQUIRES `status`, which is the
// only honest guard available here.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The adopted tool surface is vendored JavaScript with no declaration file, so `registerAgentTeamsTools`
// arrives untyped instead of re-authoring upstream to type it.
// @ts-expect-error vendored JavaScript has no declaration file
import { registerAgentTeamsTools } from "../lib/tools.js"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")
/** The live attempt generation the fixture task carries, echoed back by the valid calls. */
const ATTEMPT_ID = "attempt-live-1"

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
    /** Model-facing description, asserted for the required-argument wording. */
    readonly description: string
    /** Object-rooted JSON Schema for the arguments, inspected for the required set. */
    readonly parameters: {
        /** One schema per named argument. */
        readonly properties: Record<string, {
            /** Declared JSON type of the argument. */
            readonly type?: string
            /** Closed value set for `status`, asserted to list every accepted value. */
            readonly enum?: readonly string[]
        }>
        /** Arguments the validator refuses to default. */
        readonly required?: readonly string[]
    }
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
    /** Team phase; the diagnostics run against a `running` team. */
    phase: string
    /** Member rows, with the single seeded engineer. */
    members: Array<Record<string, unknown>>
    /** Task rows; the first one carries the live attempt under test. */
    tasks: Array<Record<string, unknown>>
}

/** One team record with a running member-owned task carrying a live attempt id. */
function teamRecord({ teamId, captainId, memberId }: { teamId: string; captainId: string; memberId: string }): TeamRecord {
    /** The fixture clock shared by the record and its task. */
    const now = Date.now()
    return {
        id: teamId,
        name: "update_task diagnostics probe",
        captainSessionId: captainId,
        createdAt: now,
        taskSeq: 2,
        phase: "running",
        members: [{ id: memberId, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t2",
                subject: "adopted tooling",
                status: "in_progress",
                assignee: "Senior Engineer",
                dependencies: [],
                attempt: 1,
                attemptId: ATTEMPT_ID,
                createdAt: now,
                updatedAt: now,
                acceptance: ["done"],
                verify: ["true"],
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
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
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
    /** The captain session, whose id the record names. */
    captain: StubAgent
    /** The engineer session the task is assigned to. */
    member: StubAgent
    /** The `<workspace>/.mpd/team/<teamId>/team.json` path the arms read back. */
    teamFile: string
} {
    /** Temporary workspace every stub session reports as its cwd. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-update-task-"))
    /** Team id the fixture writes its single team record under. */
    const teamId = "probe-team"
    /** Session id the record names as the captain. */
    const captainId = "session-captain"
    /** Session id the record names as the task's assignee. */
    const memberId = "session-member"
    /** The state root under that workspace, where the record lives. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify(teamRecord({ teamId, captainId, memberId }), null, 2))
    /** The captain session, whose id the record names. */
    const captain = { id: captainId, status: "idle", session: { header: { cwd: workspace } } }
    /** The engineer session the task is assigned to. */
    const member = { id: memberId, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, captain, member, teamFile: join(stateRoot, teamId, "team.json") }
}

/** The first task row of the persisted record, parsed fresh from disk. */
const readTask = (teamFile: string): { status?: string; output?: string; attemptId?: string } => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]

test("DEFECT 5: an OMITTED attempt_id is reported as required, never as stale ownership", async () => {
    // The fixture's workspace, both sessions and the record file the refusal must not touch.
    const { workspace, captain, member, teamFile } = fixture()
    try {
        /** The update tool, whose refusal must name the missing argument. */
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        /** The record file's bytes before the refused call. */
        const before = readFileSync(teamFile, "utf8")
        /** The refusal message, or undefined when the call was wrongly accepted. */
        const failure = await tool.execute({ task_id: "t2", status: "completed", output: "done" }, { agent: member })
            .then(() => undefined, (error) => String(error.message))
        expect(failure, "an omitted attempt_id must be rejected").toBeDefined()
        expect(failure).toMatch(/attempt_id is required/)
        expect(failure).toMatch(/agent_teams_claim_task/)
        // the recovery must be actionable, not just a diagnosis (repair-round-2 ruling)
        expect(failure).toMatch(/then repeat this update with attempt_id="<value>"/)
        // the wave-2 misdiagnosis that stopped the member must be gone
        expect(failure).not.toMatch(/stale attempt/)
        expect(failure).not.toMatch(/stop work/)
        // and the rejected call must not have touched the record
        expect(readFileSync(teamFile, "utf8")).toBe(before)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("DEFECT 5: a PRESENT but mismatched attempt_id still reports stale ownership", async () => {
    // The fixture's workspace and both sessions; the record file is only read back.
    const { workspace, captain, member } = fixture()
    try {
        /** The update tool, whose refusal must name the stale ownership. */
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        /** The refusal message for an attempt id from a previous generation. */
        const failure = await tool.execute({ task_id: "t2", status: "completed", attempt_id: "attempt-from-an-old-generation" }, { agent: member })
            .then(() => undefined, (error) => String(error.message))
        expect(failure).toMatch(/stale attempt/)
        expect(failure).toMatch(/stop work and request fresh assignment/)
        expect(failure).not.toMatch(/attempt_id is required/)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("DEFECT 6: an omitted status is rejected instead of silently persisting the rest", async () => {
    // The fixture's workspace, both sessions and the record file the refusal must leave alone.
    const { workspace, captain, member, teamFile } = fixture()
    try {
        /** The update tool, whose validator must refuse a payload without `status`. */
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        /** The validator's refusal message for the status-less payload. */
        const failure = await tool.execute({ task_id: "t2", output: "the trailing status was dropped", attempt_id: ATTEMPT_ID }, { agent: member })
            .then(() => undefined, (error) => String(error.message))
        expect(failure, "an omitted status must be rejected").toBeDefined()
        // `status` is a REQUIRED tool parameter, asserted by the argument validator
        // before the handler runs: `invalid arguments: missing required property "status"`.
        expect(failure).toMatch(/status/)
        expect(failure).toMatch(/required/i)
        // the exact t6 shape: the payload persisted while the task stayed where it was
        expect(readTask(teamFile).status).toBe("in_progress")
        expect(readTask(teamFile).output).toBeUndefined()
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("DEFECT 6: a blank or out-of-enum status is refused loudly, never persisted", async () => {
    // The fixture's workspace, both sessions and the record file the refusal must leave alone.
    const { workspace, captain, member, teamFile } = fixture()
    try {
        /** The update tool, whose validator must refuse a blank status. */
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        /** The validator's refusal message for the blank status. */
        const failure = await tool.execute({ task_id: "t2", status: "", output: "blank status", attempt_id: ATTEMPT_ID }, { agent: member })
            .then(() => undefined, (error) => String(error.message))
        expect(failure).toMatch(/status/)
        expect(readTask(teamFile).output).toBeUndefined()
        expect(readTask(teamFile).status).toBe("in_progress")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("DEFECT 6: the tool contract marks status required and documents the minimal terminal call", async () => {
    // The fixture's workspace and both sessions; only the schema is inspected here.
    const { workspace, captain, member } = fixture()
    try {
        /** The update tool, whose contract this arm pins in full. */
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        expect(tool.parameters.required).toContain("task_id")
        expect(tool.parameters.required).toContain("status")
        // Wave-4 GAP 4: `pending` joined the enum so a CAPTAIN can amend a task that has not
        // started yet. Before it, a defective contract on a pending task was unfixable by any
        // surface (amend refused the omitted status, and "pending" was not an accepted value),
        // which forced a fail-and-retry cycle twice in one wave.
        expect(tool.parameters.properties.status.enum).toEqual(["pending", "in_progress", "completed", "failed", "cancelled"])
        expect(tool.description).toMatch(/status` is REQUIRED/)
        expect(tool.description).toMatch(/\{task_id, status, attempt_id\[, verdict\]\}/)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("the happy path still works: status + current attempt_id completes the task", async () => {
    // The fixture's workspace, both sessions and the record file the completed call writes.
    const { workspace, captain, member, teamFile } = fixture()
    try {
        /** The update tool, driven on its documented happy path. */
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        /** The accepted update's answer, which must report the completed status. */
        const result = await tool.execute({ task_id: "t2", status: "completed", attempt_id: ATTEMPT_ID, output: "done" }, { agent: member })
        expect(result.task_id).toBe("t2")
        expect(result.status).toBe("completed")
        expect(readTask(teamFile).status).toBe("completed")
        expect(readTask(teamFile).output).toBe("done")
        expect(readTask(teamFile).attemptId).toBe(ATTEMPT_ID)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})
