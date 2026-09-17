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
import { registerAgentTeamsTools } from "../lib/tools.js"
import { memberWelcome } from "../lib/members.js"

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "probe-team"
const CAPTAIN_ID = "session-captain"
const MEMBER_ID = "session-member"
const READONLY_DENY = ["write", "edit", "bash", "mpd_hashline_edit", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]

function record({ status = "in_progress", toolDeny, output, dependencies } = {}) {
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

function fixture(rex) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t19-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(rex, null, 2))
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

function registerTools(workspace, captain, member) {
    // The member is BUSY: the tool's post-lock team kick then declines ("the member is running
    // the turn of an attempt it already owns") instead of re-dispatching, which keeps each
    // assertion about THIS tool's effect. That re-dispatch is a separate, measured route
    // (t36): `activateTaskAttempt` clears `task.output`, so a re-dispatched attempt WIPES a
    // stored deliverable — the second loss vector this lane reports.
    member.status = "busy"
    const tools = new Map()
    const ctx = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

const taskOf = (teamFile) => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]
// The tool's own post-lock team kick may rotate the attempt (the recoverOwned route measured as
// t36), so every call reads the CURRENT capability instead of a fixture literal.
const attemptNow = (teamFile) => taskOf(teamFile).attemptId

test("T-46: a long deliverable is EXTENDED by output_append, and a byte-dropping replacement is loud", async () => {
    const { workspace, captain, member, teamFile } = fixture(record({ status: "in_progress", output: "PART 1/4 " + "x".repeat(300) }))
    try {
        const update = registerTools(workspace, captain, member).get("agent_teams_update_task")
        // the append channel extends the stored part on a RUNNING task
        await update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), output_append: "PART 2/4 " + "y".repeat(300) }, { agent: member })
        const extended = taskOf(teamFile).output
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
    const { workspace, captain, member, teamFile } = fixture(record({ toolDeny: READONLY_DENY }))
    try {
        const update = registerTools(workspace, captain, member).get("agent_teams_update_task")
        const text = "FULL DOCUMENT " + "z".repeat(9000)
        const result = await update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), artifact: { path: "evidence/probe/doc.md", text } }, { agent: member })
        expect(result.artifact_path).toBe("evidence/probe/doc.md")
        expect(result.artifact_bytes).toBe(text.length)
        const onDisk = readFileSync(join(workspace, "evidence/probe/doc.md"), "utf8")
        expect(onDisk).toBe(text)
        // the task RECORDS where the full text went
        const artifacts = taskOf(teamFile).artifacts
        expect(artifacts).toHaveLength(1)
        expect(artifacts[0].path).toBe("evidence/probe/doc.md")
        expect(artifacts[0].bytes).toBe(text.length)
        expect(artifacts[0].readOnlySeat === undefined || artifacts[0].readOnlySeat === true).toBe(true)

        // guards, one refusal each
        const attach = (path, body = "x") => update.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(teamFile), artifact: { path, text: body } }, { agent: member })
        await expect(attach("/tmp/absolute.md")).rejects.toThrow(/workspace-relative/)
        await expect(attach("evidence/../escape.md")).rejects.toThrow(/traverse upward/)
        await expect(attach(`../outside-${Date.now()}.md`)).rejects.toThrow(/traverse upward/)
        // a SYMLINKED directory inside the workspace must not become a write-through escape
        const outside = mkdtempSync(join(tmpdir(), "mpd-t19-outside-"))
        mkdirSync(join(workspace, "evidence"), { recursive: true })
        symlinkSync(outside, join(workspace, "evidence/link"), "dir")
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
    const ro = fixture(record({ toolDeny: READONLY_DENY }))
    const writer = fixture(record())
    try {
        const memberUpdate = registerTools(ro.workspace, ro.captain, ro.member).get("agent_teams_update_task")
        const first = await memberUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(ro.teamFile), artifact: { path: "evidence/seat/report.md", text: "FIRST" } }, { agent: ro.member })
        expect(first.artifact_bytes).toBe(5)
        // a second attach APPENDS: the original bytes survive (the channel never truncates)
        const second = await memberUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(ro.teamFile), artifact: { path: "evidence/seat/report.md", text: "SECOND" } }, { agent: ro.member })
        expect(second.artifact_bytes).toBe(6)
        const body = readFileSync(join(ro.workspace, "evidence/seat/report.md"), "utf8")
        expect(body.startsWith("FIRST")).toBe(true)
        expect(body.includes("SECOND")).toBe(true)
        expect(taskOf(ro.teamFile).artifacts).toHaveLength(2)

        // outside evidence/** the read-only seat is refused
        await expect(memberUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(ro.teamFile), artifact: { path: "notes/out.md", text: "x" } }, { agent: ro.member }))
            .rejects.toThrow(/READ-ONLY seat .*evidence\/\*\*/)
        expect(existsSync(join(ro.workspace, "notes/out.md"))).toBe(false)

        // a WRITER seat (no write/edit/bash in toolDeny) may write outside evidence/**
        const writerUpdate = registerTools(writer.workspace, writer.captain, writer.member).get("agent_teams_update_task")
        await writerUpdate.execute({ task_id: "t1", status: "in_progress", attempt_id: attemptNow(writer.teamFile), artifact: { path: "notes/out.md", text: "writer" } }, { agent: writer.member })
        expect(readFileSync(join(writer.workspace, "notes/out.md"), "utf8")).toBe("writer")
    }
    finally {
        rmSync(ro.workspace, { recursive: true, force: true })
        rmSync(writer.workspace, { recursive: true, force: true })
    }
})

test("T-05: the spawn welcome states what is CLAIMABLE, never a blocked task as pending work", () => {
    const base = (taskStatus, dependencies, blockerStatus) => ({
        name: "probe",
        tasks: [
            { id: "t1", subject: "assigned", status: taskStatus, assignee: "Architect", dependencies, attempt: 0 },
            ...blockerStatus === undefined ? [] : [{ id: "t0", subject: "blocker", status: blockerStatus, dependencies: [], attempt: 1 }],
        ],
    })
    const blocked = memberWelcome(base("pending", ["t0"], "pending"), "Architect")
    expect(blocked).toContain("0 claimable now")
    expect(blocked).toContain("BLOCKED by an unfinished dependency")
    expect(blocked).not.toContain("claimable NOW")

    const claimable = memberWelcome(base("pending", [], undefined), "Architect")
    expect(claimable).toContain("1 task(s) assigned to you is claimable NOW")

    const failedBlocker = memberWelcome(base("pending", ["t0"], "failed"), "Architect")
    expect(failedBlocker).toContain("claimable NOW")

    const none = memberWelcome(base("pending", [], undefined).tasks === undefined ? { name: "p", tasks: [] } : { name: "p", tasks: [] }, "Architect")
    expect(none).toContain("0 task(s) assigned to you yet")
})
