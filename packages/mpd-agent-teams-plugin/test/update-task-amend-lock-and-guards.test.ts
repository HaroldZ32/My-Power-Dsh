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
// The adopted tool surface is vendored JavaScript with no declaration file, so `registerAgentTeamsTools`
// arrives untyped instead of re-authoring upstream to type it.
// @ts-expect-error vendored JavaScript has no declaration file
import { registerAgentTeamsTools } from "../lib/tools.js"
// The adopted state module is vendored JavaScript with no declaration file, for the same reason.
// @ts-expect-error vendored JavaScript has no declaration file
import { teamLockQueueKeys } from "../lib/state.js"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")
/** A deadlocked amend must fail FAST; the scheduler walk is otherwise ~instant. */
const AMEND_TIMEOUT_MS = 1500

/** One stub session the registry answers with, rooted at the fixture workspace. */
type StubAgent = {
    /** Session id the registry matches the caller against. */
    readonly id: string
    /** Liveness status the tools read for their ownership checks. */
    readonly status: string
    /** The session header carrying the workspace cwd, which roots every state read. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One task row the fixture writes; the named fields are the ones the amend arms read. */
type TaskRecord = {
    /** Stable task id the tool call addresses. */
    id: string
    /** Lifecycle status the amend gate inspects. */
    status: string
    /** Display name of the owning member, or `captain` for a captain-owned task. */
    assignee: string
    /** The live attempt generation the caller must echo back, when one exists. */
    attemptId?: string
    /** Contract fields the amend path may rewrite. */
    verify: readonly string[]
    /** Declared work scope, which the captain's amend may replace. */
    inScope: readonly string[]
    /** Rows excluded from the declared scope, which the captain's amend may replace. */
    outOfScope: readonly string[]
    /** Any further row field a test overrides (verdict, findings, attempt, ...). */
    [key: string]: unknown
}

/** The persisted team record as parsed JSON, narrowed to the fields the amend arms assert on. */
type PersistedTeam = {
    /** Task rows, in write order; every arm asserts on the first one. */
    tasks: Array<{
        /** Contract fields the amend path may rewrite. */
        verify: readonly string[]
        /** Declared work scope, which the captain's amend may replace. */
        inScope: readonly string[]
        /** Findings rows, which a terminal task must refuse to change. */
        findings: ReadonlyArray<{ readonly resolved: boolean }>
    }>
}

/** One tool the vendored surface registered, naming only the members these arms use. */
type RegisteredTool = {
    /** Tool name, the key the model calls it by. */
    readonly name: string
    /** Object-rooted JSON Schema for the arguments, inspected for the pending amend. */
    readonly parameters: {
        /** One schema per named argument. */
        readonly properties: Record<string, {
            /** Declared JSON type of the argument. */
            readonly type?: string
            /** Closed value set; `pending` must be one of the accepted statuses. */
            readonly enum?: readonly string[]
            /** Nested schema, when the argument is itself an object. */
            readonly properties?: Record<string, unknown>
        }>
    }
    /** The tool body; `exec.agent` is the calling session. */
    readonly execute: (args: Record<string, unknown>, exec: { agent: unknown }) => Promise<Record<string, unknown>>
}

/** One task row with the fixture defaults, overridable per arm. */
function taskRecord(overrides: Record<string, unknown> = {}): TaskRecord {
    /** The fixture clock shared by the row's timestamps. */
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

/** One persisted team record around the seeded task rows. */
function teamRecord({ teamId, captainId, memberId, tasks }: { teamId: string; captainId: string; memberId: string; tasks: TaskRecord[] }): {
    /** Team id the tools resolve under the state root. */
    id: string
    /** Human-facing team name. */
    name: string
    /** Session id the captain-only amend gate matches. */
    captainSessionId: string
    /** Epoch ms the record was created. */
    createdAt: number
    /** Next task sequence number, one past the seeded rows. */
    taskSeq: number
    /** Team phase; the amend path requires a running team. */
    phase: string
    /** Member rows, with the single seeded engineer. */
    members: Array<Record<string, unknown>>
    /** The seeded task rows. */
    tasks: TaskRecord[]
} {
    /** The fixture clock shared by the record and its member row. */
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

/** Register the adopted tools against a stub ctx and return the registry. */
function registerTools(workspace: string, captain: StubAgent, member: StubAgent): { tools: Map<string, RegisteredTool>; captain: StubAgent; member: StubAgent } {
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
    return { tools, captain, member }
}

/** One fixture: a real team record on disk, the shipped tools and the two sessions. */
function fixture(tasks: TaskRecord[]): {
    /** Tools the shipped surface registered for this fixture. */
    tools: Map<string, RegisteredTool>
    /** Absolute workspace every stub session reports as its cwd. */
    workspace: string
    /** Team id the tools resolve under the state root. */
    teamId: string
    /** The captain session, whose id the record names. */
    captain: StubAgent
    /** The engineer session the seeded task is assigned to. */
    member: StubAgent
    /** The persisted team record, re-read after every amend. */
    read: () => PersistedTeam
    /** Removes the temporary workspace tree. */
    cleanup: () => void
    /** The tool-call context for one session, as the harness hands it to `execute`. */
    exec: (agent: StubAgent) => { agent: StubAgent; session: StubAgent["session"]; signal: AbortSignal }
} {
    /** Temporary workspace every stub session reports as its cwd. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-amend-guards-"))
    /** Team id the fixture writes its single team record under. */
    const teamId = "amend-probe"
    /** The captain session, whose id the record names. */
    const captain = { id: "session-captain", kind: "captain", status: "idle", session: { header: { cwd: workspace } } }
    /** The engineer session the seeded task may be assigned to. */
    const member = { id: "session-member", name: "Senior Engineer", status: "idle", session: { header: { cwd: workspace } } }
    /** The state root under that workspace, where the record lives. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    writeFileSync(
        join(stateRoot, teamId, "team.json"),
        `${JSON.stringify(teamRecord({ teamId, captainId: captain.id, memberId: member.id, tasks }), null, 2)}\n`,
    )
    /** Tools the shipped surface registered, plus the two sessions it answers with. */
    const { tools } = registerTools(workspace, captain, member)
    /** The persisted record as parsed JSON, re-read after every amend. */
    const read = (): PersistedTeam => JSON.parse(readFileSync(join(stateRoot, teamId, "team.json"), "utf8"))
    /** Removes the temporary workspace tree. */
    const cleanup = (): void => rmSync(workspace, { recursive: true, force: true })
    /** The tool-call context for one session, as the harness hands it to `execute`. */
    const exec = (agent: StubAgent): { agent: StubAgent; session: StubAgent["session"]; signal: AbortSignal } => ({ agent, session: agent.session, signal: new AbortController().signal })
    return { tools, workspace, teamId, captain, member, read, cleanup, exec }
}

/** Run a promise with a hard deadline so a DEADLOCK surfaces as a failure, not a hang. */
async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    /** The timeout handle, cleared as soon as the race settles. */
    let timer: ReturnType<typeof setTimeout> | undefined
    /** The rejection that turns a hang into a labelled failure. */
    const deadline = new Promise<never>((_, reject) => {
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
    // The fixture with one captain-owned running task.
    const f = fixture([taskRecord({ assignee: "captain" })])
    try {
        /** The amend's answer, which only a settled (non-deadlocked) call can produce. */
        const result = await withDeadline(
            f.tools.get("agent_teams_update_task")!.execute(
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
    // The fixture with one running engineer-owned task.
    const f = fixture([taskRecord()])
    try {
        /** The contract as declared before the refused amend, which must stay unchanged. */
        const before = f.read().tasks[0].verify
        /** The thrown refusal, assigned from the catch below and asserted to be an Error. */
        let error!: { message: string }
        try {
            await f.tools.get("agent_teams_update_task")!.execute(
                { task_id: "t1", status: "in_progress", attempt_id: "attempt-live-1", amend: { verify: ["bun test something-else"] } },
                f.exec(f.member),
            )
        }
        catch (caught) {
            // A caught value is `unknown` under strict mode, and only its `message` is read; the
            // tools refuse by throwing an Error, which is exactly the text asserted below.
            error = caught as { message: string }
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
    // The fixture with one completed task carrying a single unresolved finding.
    const f = fixture([taskRecord({ status: "completed", verdict: "pass", findings: [{ id: "F1", severity: "low", problem: "p", requiredFix: "r", resolved: false }] })])
    try {
        /** The thrown refusal, assigned from the catch below and asserted to be an Error. */
        let error!: { message: string }
        try {
            await f.tools.get("agent_teams_update_task")!.execute(
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
            // A caught value is `unknown` under strict mode, and only its `message` is read; the
            // terminal-task guard refuses by throwing an Error, which the pattern below asserts.
            error = caught as { message: string }
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
    // The fixture with one unstarted captain-owned task.
    const f = fixture([taskRecord({ status: "pending", attempt: 0, attemptId: undefined, assignee: "captain" })])
    try {
        /** The update tool's argument schema, whose status enum must accept `pending`. */
        const parameters = f.tools.get("agent_teams_update_task")!.parameters
        expect(parameters.properties.status.enum).toContain("pending")
        /** The amend's answer, which must carry the amended task id. */
        const result = await withDeadline(
            f.tools.get("agent_teams_update_task")!.execute(
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
    // The fixture with one unstarted captain-owned task.
    const f = fixture([taskRecord({ status: "pending", attempt: 0, attemptId: undefined, assignee: "captain" })])
    try {
        /** The amend argument's own schema, whose keys must include the two scope fields. */
        const amendSchema = f.tools.get("agent_teams_update_task")!.parameters.properties.amend.properties
        expect(Object.keys(amendSchema!)).toContain("inScope")
        expect(Object.keys(amendSchema!)).toContain("outOfScope")
        /** The amend's answer, which must carry the amended task id. */
        const result = await withDeadline(
            f.tools.get("agent_teams_update_task")!.execute(
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
