// Wave-1 (t19, lane B3) self-fix tests — deliverables stop vanishing, and a read-only seat gets
// a sanctioned channel:
//
//   T-46 — `output` is no longer silently last-write-wins: `output_append` extends the stored
//          summary on ANY status, and a REPLACEMENT that would discard a stored summary is loud.
//   T-09 — a first-class artifact channel: `artifact:{path,text}` writes the full text into the
//          workspace, records path+bytes on the task, and the call result carries the path.
//   T-10 — a seat whose own `toolDeny` names write/edit/bash may write ONLY under `evidence/**`,
//          append-or-create (the channel can never destroy a byte).
//   T-05 — the spawn welcome turn states what is CLAIMABLE, not what is merely assigned.
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { registerAgentTeamsTools } from "../lib/tools.js"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { memberWelcome } from "../lib/members.js"

/** The overridable fields of the fixture team record. */
interface RecordInput {
    /** The task's status. */
    readonly status?: string
    /** The member's deny list, absent for a writer seat. */
    readonly toolDeny?: readonly string[]
    /** The stored deliverable, absent to write no output field at all. */
    readonly output?: string
    /** The task's dependency ids. */
    readonly dependencies?: readonly string[]
}

/** One live-agent double the tools registry answers with. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status; the fixture flips the member to busy before registering. */
    status: string
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One artifact the task records for an attached document. */
interface ArtifactRecord {
    /** Workspace-relative path the full text was written to. */
    readonly path: string
    /** How many bytes were written. */
    readonly bytes: number
    /** True when the attaching seat was read-only; absent for a writer seat. */
    readonly readOnlySeat?: boolean
}

/** One task as the fixture leaves it on disk, with the fields the arms read back. */
interface TaskSnapshot {
    /** The current attempt id, which every call must match after a possible rotation. */
    readonly attemptId: string
    /** The stored deliverable, extended by the append channel and replaced only explicitly. */
    readonly output?: string
    /** The artifacts the task records, one entry per attach. */
    readonly artifacts: readonly ArtifactRecord[]
}

/** The decoded result of one tool call: the fields are tool-specific, so each arm reads its own. */
interface ToolCallResult {
    /** Workspace-relative path the artifact text was written to. */
    readonly artifact_path?: string
    /** How many bytes that call appended. */
    readonly artifact_bytes?: number
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
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<ToolCallResult>
}

/** One task row the member welcome reads. */
interface WelcomeTask {
    /** The task's id. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The task's status, which decides whether it is claimable. */
    readonly status: string
    /** The seat the task is assigned to. */
    readonly assignee?: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The team id the fixture writes and the state root is keyed by. */
const TEAM_ID = "probe-team"
/** The captain's session id, which owns the fixture team. */
const CAPTAIN_ID = "session-captain"
/** The member seat every tool call in this file runs as. */
const MEMBER_ID = "session-member"
/** The roster's read-only deny list, which makes a seat read-only for the artifact channel. */
const READONLY_DENY = ["write", "edit", "bash", "mpd_hashline_edit", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]

/** Build one fixture team record with a single task, overridable field by field. */
function record({ status = "in_progress", toolDeny, output, dependencies }: RecordInput = {}): Record<string, unknown> {
/** The instant every timestamp in the fixture record is stamped with. */
    const now = Date.now()
    return {
        id: TEAM_ID,
        name: "deliverable probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 1,
        phase: "running",
        members: [{ id: MEMBER_ID, name: "Architect", role: "architect", status: "idle", joinedAt: now, ...toolDeny === undefined ? {} : { toolDeny } }],
        tasks: [
            {
                id: "t1",
                subject: "carry the deliverable",
                status,
                assignee: "Architect",
                dependencies: dependencies ?? [],
                attempt: 1,
                attemptId: "att-1",
                createdAt: now,
                updatedAt: now,
                kind: "implementation",
                objective: "deliver without losing bytes",
                inScope: ["evidence/**"],
                acceptance: ["nothing is dropped"],
                verify: ["bun test"],
                ...output === undefined ? {} : { output },
            },
        ],
    }
}

/** Write a fixture record into a fresh workspace and return the roots plus both seats. */
function fixture(rex: Record<string, unknown>): { workspace: string; stateRoot: string; captain: AgentLike; member: AgentLike; teamFile: string } {
/** The temporary workspace the fixture team lives in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t19-"))
/** The resolved team-state root the tools are keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(rex, null, 2))
/** The captain double the registry answers with. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
/** The member double, flipped to busy below so the post-lock kick declines. */
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

/** Register the REAL tools over a context double and return the captured definitions. */
function registerTools(workspace: string, captain: AgentLike, member: AgentLike): Map<string, ToolDefinition> {
    // The member is BUSY: the tool's post-lock team kick then declines ("the member is running
    // the turn of an attempt it already owns") instead of re-dispatching, which keeps each
    // assertion about THIS tool's effect. That re-dispatch is a separate, measured route
    // (t36): `activateTaskAttempt` clears `task.output`, so a re-dispatched attempt WIPES a
    // stored deliverable — the second loss vector this lane reports.
    member.status = "busy"
/** The definitions the registration double captured, keyed by tool name. */
    const tools = new Map()
/** The context double the vendored registration path drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
        agents: { get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

/** The first task as it stands on disk, re-read after every call. */
const taskOf = (teamFile: string): TaskSnapshot => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]
// The tool's own post-lock team kick may rotate the attempt (the recoverOwned route measured as
// t36), so every call reads the CURRENT capability instead of a fixture literal.
/** The task's CURRENT attempt id, since a post-lock kick may rotate it. */
const attemptNow = (teamFile: string): string => taskOf(teamFile).attemptId

test("T-46: a long deliverable is EXTENDED by output_append, and a byte-dropping replacement is loud", async () => {
/** The fixture roots, both seats and the record file this arm drives. */
    const { workspace, captain, member, teamFile } = fixture(record({ status: "in_progress", output: "PART 1/4 " + "x".repeat(300) }))
    try {
/** The registered update tool; the fixture above registered it, so the lookup cannot miss. */
        const update = registerTools(workspace, captain, member).get("agent_teams_update_task")!
        // the append channel extends the stored part on a RUNNING task
        await update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), output_append: "PART 2/4 " + "y".repeat(300) }, { agent: member })
/** The stored deliverable after the append, which must still start with part 1. */
        const extended = taskOf(teamFile).output!
        expect(extended.startsWith("PART 1/4 ")).toBe(true)
        expect(extended.includes("PART 2/4 ")).toBe(true)

        // a REPLACEMENT that would discard the stored text is refused LOUDLY (the measured failure)
        await expect(update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), output: "PART 4/4 only" }, { agent: member }))
            .rejects.toThrow(/REPLACES it \(last-write-wins\) and would DISCARD/)
        expect(taskOf(teamFile).output).toBe(extended)
        // ...and an explicit confirmation still allows a real replacement
        await update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), output: "PART 4/4 only", replace_output: true }, { agent: member })
        expect(taskOf(teamFile).output).toBe("PART 4/4 only")
        // supplying BOTH channels is refused
        await expect(update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), output: "a", output_append: "b" }, { agent: member }))
            .rejects.toThrow(/not both/)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-09: the artifact channel carries the full text, records it on the task, and guards the path", async () => {
/** The fixture roots, both seats and the record file this arm drives. */
    const { workspace, captain, member, teamFile } = fixture(record({ toolDeny: READONLY_DENY }))
    try {
/** The registered update tool; the fixture above registered it, so the lookup cannot miss. */
        const update = registerTools(workspace, captain, member).get("agent_teams_update_task")!
/** The full document text, far longer than any summary limit. */
        const text = "FULL DOCUMENT " + "z".repeat(9000)
/** The call's result, which must name the written path and its byte count. */
        const result = await update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), artifact: { path: "evidence/probe/doc.md", text } }, { agent: member })
        expect(result.artifact_path).toBe("evidence/probe/doc.md")
        expect(result.artifact_bytes).toBe(text.length)
/** The bytes as they actually landed on disk. */
        const onDisk = readFileSync(join(workspace, "evidence/probe/doc.md"), "utf8")
        expect(onDisk).toBe(text)
        // the task RECORDS where the full text went
        const artifacts = taskOf(teamFile).artifacts
        expect(artifacts).toHaveLength(1)
        expect(artifacts[0].path).toBe("evidence/probe/doc.md")
        expect(artifacts[0].bytes).toBe(text.length)
        expect(artifacts[0].readOnlySeat === undefined || artifacts[0].readOnlySeat === true).toBe(true)

        // guards, one refusal each
/** Attach one document at a path, with a one-byte body unless an arm supplies more. */
        const attach = (path: string, body: string = "x"): Promise<ToolCallResult> => update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), artifact: { path, text: body } }, { agent: member })
        await expect(attach("/tmp/absolute.md")).rejects.toThrow(/workspace-relative/)
        await expect(attach("evidence/../escape.md")).rejects.toThrow(/traverse upward/)
        await expect(attach(`../outside-${Date.now()}.md`)).rejects.toThrow(/traverse upward/)
        // a SYMLINKED directory inside the workspace must not become a write-through escape
        const outside = mkdtempSync(join(tmpdir(), "mpd-t19-outside-"))
        mkdirSync(join(workspace, "evidence"), { recursive: true })
        symlinkSync(outside, join(workspace, "evidence/link"), "junction")
        await expect(attach("evidence/link/leak.md")).rejects.toThrow(/symlinked directory|outside the workspace/)
        expect(existsSync(join(outside, "leak.md"))).toBe(false)
        await expect(attach(join(STATE_DIR, TEAM_ID, "leak.md"))).rejects.toThrow(/team state dir/)
        mkdirSync(join(workspace, "evidence/dir.md"), { recursive: true })
        await expect(attach("evidence/dir.md")).rejects.toThrow(/not a regular file/)
        await expect(attach("evidence/probe/empty.md", "")).rejects.toThrow(/artifact.text is required/)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-10: a read-only seat writes ONLY under evidence/**, append-or-create; a writer seat is not restricted there", async () => {
/** A fixture whose only seat is read-only. */
    const ro = fixture(record({ toolDeny: READONLY_DENY }))
/** The same fixture with a writer seat, for the control half. */
    const writer = fixture(record())
    try {
/** The registered update tool for the READ-ONLY fixture. */
        const memberUpdate = registerTools(ro.workspace, ro.captain, ro.member).get("agent_teams_update_task")!
/** The first attach, which creates the document. */
        const first = await memberUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(ro.teamFile), artifact: { path: "evidence/seat/report.md", text: "FIRST" } }, { agent: ro.member })
        expect(first.artifact_bytes).toBe(5)
        // a second attach APPENDS: the original bytes survive (the channel never truncates)
        const second = await memberUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(ro.teamFile), artifact: { path: "evidence/seat/report.md", text: "SECOND" } }, { agent: ro.member })
        expect(second.artifact_bytes).toBe(6)
/** The document's bytes after the second attach, which must contain BOTH parts. */
        const body = readFileSync(join(ro.workspace, "evidence/seat/report.md"), "utf8")
        expect(body.startsWith("FIRST")).toBe(true)
        expect(body.includes("SECOND")).toBe(true)
        expect(taskOf(ro.teamFile).artifacts).toHaveLength(2)

        // outside evidence/** the read-only seat is refused
        await expect(memberUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(ro.teamFile), artifact: { path: "notes/out.md", text: "x" } }, { agent: ro.member }))
            .rejects.toThrow(/READ-ONLY seat .*evidence\/\*\*/)
        expect(existsSync(join(ro.workspace, "notes/out.md"))).toBe(false)

        // a WRITER seat (no write/edit/bash in toolDeny) may write outside evidence/**
        const writerUpdate = registerTools(writer.workspace, writer.captain, writer.member).get("agent_teams_update_task")!
        await writerUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(writer.teamFile), artifact: { path: "notes/out.md", text: "writer" } }, { agent: writer.member })
        expect(readFileSync(join(writer.workspace, "notes/out.md"), "utf8")).toBe("writer")
    }
    finally {
        rmSync(ro.workspace, { recursive: true, force: true })
        rmSync(writer.workspace, { recursive: true, force: true })
    }
})

test("T-05: the spawn welcome states what is CLAIMABLE, never a blocked task as pending work", () => {
/** Build a welcome fixture with one assigned task and an optional blocker task. */
    const base = (taskStatus: string, dependencies: readonly string[], blockerStatus: string | undefined): { name: string; tasks?: readonly WelcomeTask[] } => ({
        name: "probe",
        tasks: [
            { id: "t1", subject: "assigned", status: taskStatus, assignee: "Architect", dependencies, attempt: 0 },
            ...blockerStatus === undefined ? [] : [{ id: "t0", subject: "blocker", status: blockerStatus, dependencies: [], attempt: 1 }],
        ],
    })
/** The welcome text when the assigned task is blocked by a pending dependency. */
    const blocked = memberWelcome(base("pending", ["t0"], "pending"), "Architect")
    expect(blocked).toContain("0 claimable now")
    expect(blocked).toContain("BLOCKED by an unfinished dependency")
    expect(blocked).not.toContain("claimable NOW")

/** The welcome text when nothing blocks the assigned task. */
    const claimable = memberWelcome(base("pending", [], undefined), "Architect")
    expect(claimable).toContain("1 task(s) assigned to you is claimable NOW")

/** The welcome text when the blocker itself FAILED, which no longer blocks. */
    const failedBlocker = memberWelcome(base("pending", ["t0"], "failed"), "Architect")
    expect(failedBlocker).toContain("claimable NOW")

/** The welcome text for a team carrying no tasks at all. */
    const none = memberWelcome(base("pending", [], undefined).tasks === undefined ? { name: "p", tasks: [] } : { name: "p", tasks: [] }, "Architect")
    expect(none).toContain("0 task(s) assigned to you yet")
})
