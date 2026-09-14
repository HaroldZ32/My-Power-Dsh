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
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const ATTEMPT_ID = "attempt-live-1"

/** One team record with a running member-owned task carrying a live attempt id. */
function teamRecord({ teamId, captainId, memberId }) {
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
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-update-task-"))
    const teamId = "probe-team"
    const captainId = "session-captain"
    const memberId = "session-member"
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify(teamRecord({ teamId, captainId, memberId }), null, 2))
    const captain = { id: captainId, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: memberId, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamId, captain, member, teamFile: join(stateRoot, teamId, "team.json") }
}

const readTask = (teamFile) => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]

test("DEFECT 5: an OMITTED attempt_id is reported as required, never as stale ownership", async () => {
    const { workspace, captain, member, teamFile } = fixture()
    try {
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")
        const before = readFileSync(teamFile, "utf8")
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
    const { workspace, captain, member } = fixture()
    try {
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")
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
    const { workspace, captain, member, teamFile } = fixture()
    try {
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")
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
    const { workspace, captain, member, teamFile } = fixture()
    try {
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")
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
    const { workspace, captain, member } = fixture()
    try {
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")
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
    const { workspace, captain, member, teamFile } = fixture()
    try {
        const tool = registerTools(workspace, captain, member).get("agent_teams_update_task")
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
