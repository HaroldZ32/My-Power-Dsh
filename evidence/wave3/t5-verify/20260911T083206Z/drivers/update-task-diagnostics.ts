#!/usr/bin/env node
// t5 INDEPENDENT verification driver 4/5 — the two `agent_teams_update_task` diagnostics,
// driven through the REAL registered tool (registerAgentTeamsTools from the adopted lib)
// against a REAL team record in a throw-away workspace. The permanent suite is re-run
// separately; this driver re-derives the behaviour itself.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..", "..")
const EVIDENCE = resolve(HERE, "..")
const { registerAgentTeamsTools } = await import(pathToFileURL(join(REPO, "packages", "mpd-agent-teams-plugin", "lib", "tools.js")).href)

const ATTEMPT_ID = "attempt-live-1"
const STATE_DIR = join(".mpd", "team")

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t5-update-"))
    const teamId = "probe-team"
    const now = Date.now()
    const record = {
        id: teamId,
        name: "t5 update_task diagnostics probe",
        captainSessionId: "session-captain",
        createdAt: now,
        taskSeq: 2,
        phase: "running",
        members: [{ id: "session-member", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [{
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
        }],
    }
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    const teamFile = join(stateRoot, teamId, "team.json")
    writeFileSync(teamFile, JSON.stringify(record, null, 2))
    const tools = new Map()
    const ctx = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: { get: (id) => (id === "session-captain" || id === "session-member" ? { id, status: "idle", session: { header: { cwd: workspace } } } : undefined), list: () => [] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    const member = { id: "session-member", status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, teamFile, tool: tools.get("agent_teams_update_task"), member, toolCount: tools.size }
}

const results = []
const record = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); return entry }
const run = (tool, args, member) => tool.execute(args, { agent: member }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: String(error.message) }))

// ---------- omitted attempt_id ----------
{
    const { workspace, teamFile, tool, member } = fixture()
    try {
        const before = readFileSync(teamFile, "utf8")
        const outcome = await run(tool, { task_id: "t2", status: "completed", output: "done" }, member)
        const message = outcome.ok ? "" : outcome.message
        record({
            scenario: "omitted-attempt_id",
            outcome: outcome.ok ? { ok: true, value: outcome.value } : { ok: false, message },
            recordUnchanged: readFileSync(teamFile, "utf8") === before,
            saysRequired: /attempt_id is required/.test(message),
            namesClaimTool: /agent_teams_claim_task/.test(message),
            saysStale: /stale attempt/.test(message),
            saysStopWork: /stop work/.test(message),
            passed: !outcome.ok && /attempt_id is required/.test(message) && /agent_teams_claim_task/.test(message)
                && !/stale attempt/.test(message) && !/stop work/.test(message) && readFileSync(teamFile, "utf8") === before,
        })
    }
    finally { rmSync(workspace, { recursive: true, force: true }) }
}

// ---------- present-but-wrong attempt_id keeps the stale wording ----------
{
    const { workspace, teamFile, tool, member } = fixture()
    try {
        const before = readFileSync(teamFile, "utf8")
        const outcome = await run(tool, { task_id: "t2", status: "completed", attempt_id: "attempt-not-current" }, member)
        const message = outcome.ok ? "" : outcome.message
        record({
            scenario: "wrong-attempt_id",
            message,
            recordUnchanged: readFileSync(teamFile, "utf8") === before,
            saysStale: /stale attempt/.test(message),
            saysRequired: /attempt_id is required/.test(message),
            passed: !outcome.ok && /stale attempt/.test(message) && !/attempt_id is required/.test(message)
                && readFileSync(teamFile, "utf8") === before,
        })
    }
    finally { rmSync(workspace, { recursive: true, force: true }) }
}

// ---------- omitted status (DEFECT 6: the oversized payload lost the trailing key) ----------
{
    const { workspace, teamFile, tool, member } = fixture()
    try {
        const before = readFileSync(teamFile, "utf8")
        const outcome = await run(tool, { task_id: "t2", attempt_id: ATTEMPT_ID, output: "payload only, status missing" }, member)
        const message = outcome.ok ? JSON.stringify(outcome.value) : outcome.message
        record({
            scenario: "omitted-status",
            message,
            recordUnchanged: readFileSync(teamFile, "utf8") === before,
            complainsAboutStatus: /status/.test(message),
            passed: !outcome.ok && /status/.test(message) && readFileSync(teamFile, "utf8") === before,
        })
    }
    finally { rmSync(workspace, { recursive: true, force: true }) }
}

// ---------- the contract marks status required, and the happy path still works ----------
{
    const { workspace, teamFile, tool, member, toolCount } = fixture()
    try {
        const schema = tool.parameters
        const outcome = await run(tool, { task_id: "t2", status: "completed", attempt_id: ATTEMPT_ID, output: "done" }, member)
        const task = JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]
        record({
            scenario: "contract-and-happy-path",
            registeredTools: toolCount,
            requiredList: schema.required,
            statusProperty: schema.properties?.status,
            statusRequiredInSchema: (schema.required ?? []).includes("status"),
            descriptionMentionsRequired: /status` is REQUIRED/.test(tool.description),
            commandShapedHint: /\{task_id, status, attempt_id\[, verdict\]\}/.test(tool.description),
            happyPath: outcome.ok ? { status: outcome.value.status, persisted: { status: task.status, output: task.output, attemptId: task.attemptId } } : { failed: outcome.message },
            passed: (schema.required ?? []).includes("status")
                && (schema.properties?.status?.enum ?? []).length === 4
                && /status` is REQUIRED/.test(tool.description)
                && /\{task_id, status, attempt_id\[, verdict\]\}/.test(tool.description)
                && outcome.ok && task.status === "completed" && task.output === "done" && task.attemptId === ATTEMPT_ID,
        })
    }
    finally { rmSync(workspace, { recursive: true, force: true }) }
}

const summary = {
    driver: "update-task-diagnostics",
    repo: REPO,
    measuredAt: new Date().toISOString(),
    results,
    passed: results.every((entry) => entry.passed),
}
writeFileSync(join(EVIDENCE, "drivers", "update-task-diagnostics.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(`[update-task-diagnostics] ${summary.passed ? "PASS" : "FAIL"} (${results.filter((entry) => entry.passed).length}/${results.length} scenarios)`)
process.exit(summary.passed ? 0 : 1)
