// Wave-4 DEFECTS (measured live, 2026-09-14) — the amend path of
// `agent_teams_update_task` had one DEADLOCK and two SILENT NO-OPS:
//
//   1. DEADLOCK (froze the tool call): the `mpd-delta update-task-amend-running`
//      region called `scheduler.kickTeam(...)` INSIDE `withTeamLock(teamLockKey)`.
//      `kickTeam` -> `kickMember` -> `withTeamLock(teamLockKey)` re-acquires the
//      SAME non-reentrant key, so the inner acquisition waits for the outer one
//      that is awaiting it. Measured in production: the tool call never returned
//      ("interrupted after it was recorded, but no result durably recorded").
//   2. SILENT NO-OP: a MEMBER's `amend` was accepted (success response) and
//      persisted NOTHING — the amend branches are gated on captain identity and the
//      member branch never reads the argument. Measured 4x by a member.
//   3. SILENT NO-OP: on a TERMINAL task only `status`/`output` were compared, so a
//      changed `findings`/`acceptanceResults`/`commandsRun`/`changedPaths`/`verdict`
//      returned success while the record was unchanged (measured: `resolved=false`).
//
// Plus two contract-repair gaps that forced failed tasks and retry cycles:
//   4. a captain could not amend a `pending` task (the status enum had no `pending`),
//   5. `inScope`/`outOfScope` were not amendable by ANYONE, so a defective scope was
//      unfixable outside a fail-and-re-run cycle.
//
// This suite drives the REAL registered tool against a REAL team record on disk.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "../lib/tools.js"
import { teamLockQueueKeys } from "../lib/state.js"

const STATE_DIR = join(".mpd", "team")
/** A deadlocked amend must fail FAST; the scheduler walk is otherwise ~instant. */
const AMEND_TIMEOUT_MS = 1500

function taskRecord(overrides = {}) {
    const now = Date.now()
    return {
        id: "t1",
        subject: "implement the thing",
        status: "in_progress",
        assignee: "Senior Engineer",
        dependencies: [],
        attempt: 1,
        attemptId: "attempt-live-1",
        createdAt: now,
        updatedAt: now,
        kind: "implementation",
        round: 1,
        objective: "prove the amend path is safe",
        inScope: ["packages/foo/src/**"],
        outOfScope: ["packages/foo/dist"],
        acceptance: ["the thing works"],
        verify: ["bun test packages/foo"],
        ...overrides,
    }
}

function teamRecord({ teamId, captainId, memberId, tasks }) {
    const now = Date.now()
    return {
        id: teamId,
        name: "amend lock probe",
        captainSessionId: captainId,
        createdAt: now,
        taskSeq: tasks.length + 1,
        phase: "running",
        members: [{ id: memberId, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks,
    }
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
        effect: () => {},
        on: () => {},
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return { tools, captain, member }
}

function fixture(tasks) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-amend-guards-"))
    const teamId = "amend-probe"
    const captain = { id: "session-captain", kind: "captain", status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: "session-member", name: "Senior Engineer", status: "idle", session: { header: { cwd: workspace } } }
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    writeFileSync(
        join(stateRoot, teamId, "team.json"),
        `${JSON.stringify(teamRecord({ teamId, captainId: captain.id, memberId: member.id, tasks }), null, 2)}\n`,
    )
    const { tools } = registerTools(workspace, captain, member)
    const read = () => JSON.parse(readFileSync(join(stateRoot, teamId, "team.json"), "utf8"))
    const cleanup = () => rmSync(workspace, { recursive: true, force: true })
    const exec = (agent) => ({ agent, session: agent.session, signal: new AbortController().signal })
    return { tools, workspace, teamId, captain, member, read, cleanup, exec }
}

/** Run a promise with a hard deadline so a DEADLOCK surfaces as a failure, not a hang. */
async function withDeadline(promise, ms, label) {
    let timer
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`DEADLOCK: ${label} did not settle within ${ms} ms`)), ms)
    })
    try {
        return await Promise.race([promise, deadline])
    }
    finally {
        clearTimeout(timer)
    }
}

test("captain amend on a RUNNING task settles instead of self-deadlocking the team lock", async () => {
    const f = fixture([taskRecord({ assignee: "captain" })])
    try {
        const result = await withDeadline(
            f.tools.get("agent_teams_update_task").execute(
                {
                    task_id: "t1",
                    status: "in_progress",
                    attempt_id: "attempt-live-1",
                    amend: { verify: ["bun test packages/foo", "bun run typecheck"] },
                },
                f.exec(f.captain),
            ),
            AMEND_TIMEOUT_MS,
            "captain amend on a running task",
        )
        expect(result.task_id).toBe("t1")
        expect(f.read().tasks[0].verify).toEqual(["bun test packages/foo", "bun run typecheck"])
        // The lock queue must be EMPTY: a deadlocked acquisition leaves its key chained forever.
        expect(teamLockQueueKeys()).toEqual([])
    }
    finally {
        f.cleanup()
    }
})

test("a MEMBER's amend is refused loudly instead of silently persisting nothing", async () => {
    const f = fixture([taskRecord()])
    try {
        const before = f.read().tasks[0].verify
        let error
        try {
            await f.tools.get("agent_teams_update_task").execute(
                { task_id: "t1", status: "in_progress", attempt_id: "attempt-live-1", amend: { verify: ["bun test something-else"] } },
                f.exec(f.member),
            )
        }
        catch (caught) {
            error = caught
        }
        expect(error).toBeDefined()
        expect(String(error.message)).toMatch(/captain/i)
        expect(f.read().tasks[0].verify).toEqual(before)
    }
    finally {
        f.cleanup()
    }
})

test("a terminal task refuses EVERY field change loudly, not just status/output", async () => {
    const f = fixture([taskRecord({ status: "completed", verdict: "pass", findings: [{ id: "F1", severity: "low", problem: "p", requiredFix: "r", resolved: false }] })])
    try {
        let error
        try {
            await f.tools.get("agent_teams_update_task").execute(
                {
                    task_id: "t1",
                    status: "completed",
                    attempt_id: "attempt-live-1",
                    findings: [{ id: "F1", severity: "low", problem: "p", requiredFix: "r", resolved: true }],
                },
                f.exec(f.member),
            )
        }
        catch (caught) {
            error = caught
        }
        expect(error).toBeDefined()
        expect(String(error.message)).toMatch(/immutable/i)
        expect(f.read().tasks[0].findings[0].resolved).toBe(false)
    }
    finally {
        f.cleanup()
    }
})

test("a PENDING task is amendable (status enum accepts pending) and the amendment persists", async () => {
    const f = fixture([taskRecord({ status: "pending", attempt: 0, attemptId: undefined, assignee: "captain" })])
    try {
        const parameters = f.tools.get("agent_teams_update_task").parameters
        expect(parameters.properties.status.enum).toContain("pending")
        const result = await withDeadline(
            f.tools.get("agent_teams_update_task").execute(
                { task_id: "t1", status: "pending", amend: { verify: ["bun test packages/foo"] } },
                f.exec(f.captain),
            ),
            AMEND_TIMEOUT_MS,
            "captain amend on a pending task",
        )
        expect(result.task_id).toBe("t1")
        expect(f.read().tasks[0].verify).toEqual(["bun test packages/foo"])
    }
    finally {
        f.cleanup()
    }
})

test("inScope/outOfScope are amendable by the captain (contract repair without a fail-and-re-run)", async () => {
    const f = fixture([taskRecord({ status: "pending", attempt: 0, attemptId: undefined, assignee: "captain" })])
    try {
        const amendSchema = f.tools.get("agent_teams_update_task").parameters.properties.amend.properties
        expect(Object.keys(amendSchema)).toContain("inScope")
        expect(Object.keys(amendSchema)).toContain("outOfScope")
        const result = await withDeadline(
            f.tools.get("agent_teams_update_task").execute(
                { task_id: "t1", status: "pending", amend: { inScope: ["skills/foo/**"], outOfScope: [] } },
                f.exec(f.captain),
            ),
            AMEND_TIMEOUT_MS,
            "captain scope amendment",
        )
        expect(result.task_id).toBe("t1")
        expect(f.read().tasks[0].inScope).toEqual(["skills/foo/**"])
    }
    finally {
        f.cleanup()
    }
})
