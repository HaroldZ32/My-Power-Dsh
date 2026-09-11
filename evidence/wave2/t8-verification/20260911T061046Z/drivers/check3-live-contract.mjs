#!/usr/bin/env node
// t8 verification driver 3/4 — the captain-readable contract surface, driven LIVE.
//
// Registers the REAL adopted tool tree (`registerAgentTeamsTools`) and calls the REAL
// `agent_teams_task_contract` tool against a byte-identical COPY of the live team record
// (`.mpd/team/mpd-wave-2/team.json`), so the verification never mutates team state.
// It reports the view, the rendered model-facing block, and sha256 digests of the live
// file and the sandbox copy before/after the read.
//
// Usage: node check3-live-contract.mjs <live-team-json> <team-id> <task-id> <captain|member>
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "../../../../../packages/mpd-agent-teams-plugin/lib/tools.js"

const [liveTeamJson, teamId, taskId, callerKind = "captain"] = process.argv.slice(2)
if (!liveTeamJson || !teamId || !taskId) {
    console.error("usage: check3-live-contract.mjs <live-team-json> <team-id> <task-id> <captain|member>")
    process.exit(2)
}
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const liveBefore = sha(liveTeamJson)
const record = JSON.parse(readFileSync(liveTeamJson, "utf8"))

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t8-contract-"))
const stateDir = join(".mpd", "team")
const sandboxTeamDir = join(sandbox, stateDir, teamId)
mkdirSync(join(sandbox, stateDir), { recursive: true })
cpSync(join(liveTeamJson, ".."), sandboxTeamDir, { recursive: true })
const sandboxFile = join(sandboxTeamDir, "team.json")
const sandboxBefore = sha(sandboxFile)

const captainAgent = { id: record.captainSessionId, status: "idle", session: { header: { cwd: sandbox } } }
const memberRecord = (record.members ?? []).find((member) => member.status !== "removed") ?? { id: "session-probe-member" }
const memberAgent = { id: memberRecord.id, status: "idle", session: { header: { cwd: sandbox } } }
const caller = callerKind === "member" ? memberAgent : captainAgent

const tools = new Map()
const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition) } },
    agents: {
        get: (id) => (id === captainAgent.id ? captainAgent : id === memberAgent.id ? memberAgent : undefined),
        list: () => [captainAgent, memberAgent],
    },
    subagents: { prompt: async () => ({ messageId: "probe" }), followup: () => {}, sendMessage: () => {} },
    effect: () => {},
    on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    get: () => undefined,
}
registerAgentTeamsTools(ctx, { stateDir })

const out = {
    driver: "check3-live-contract",
    liveTeamJson,
    sandbox,
    caller: { kind: callerKind, id: caller.id },
    registeredToolCount: tools.size,
    registeredToolNames: [...tools.keys()].sort(),
    liveSha256Before: liveBefore,
    sandboxSha256Before: sandboxBefore,
}

const tool = tools.get("agent_teams_task_contract")
out.toolRegistered = tool !== undefined
if (tool === undefined) {
    console.log(JSON.stringify(out, null, 2))
    process.exit(1)
}
out.parameters = tool.parameters
out.hasRender = typeof tool.output?.render === "function"

try {
    const view = await tool.execute({ task_id: taskId }, { agent: caller })
    out.view = view
    out.rendered = tool.output.render({ task_id: taskId }, view)?.map((block) => block.text).join("\n") ?? null
}
catch (error) {
    out.readError = String(error?.message ?? error)
}
try {
    await tool.execute({ task_id: "t-does-not-exist" }, { agent: caller })
    out.unknownId = "UNEXPECTED-OK"
}
catch (error) {
    out.unknownId = String(error?.message ?? error)
}
try {
    await tool.execute({ task_id: "   " }, { agent: caller })
    out.blankId = "UNEXPECTED-OK"
}
catch (error) {
    out.blankId = String(error?.message ?? error)
}
try {
    const memberView = await tool.execute({ task_id: taskId }, { agent: memberAgent })
    out.memberRead = { ok: true, in_scope: memberView.in_scope, out_of_scope: memberView.out_of_scope, acceptance_len: (memberView.acceptance ?? []).length }
}
catch (error) {
    out.memberRead = { ok: false, error: String(error?.message ?? error) }
}

out.liveSha256After = sha(liveTeamJson)
out.sandboxSha256After = sha(sandboxFile)
out.liveUntouched = out.liveSha256After === out.liveSha256Before
out.sandboxUntouched = out.sandboxSha256After === out.sandboxSha256Before

// Field-by-field comparison against the durable record this read came from.
const declared = (record.tasks ?? []).find((item) => item.id === taskId)
out.declared = declared === undefined ? null : {
    subject: declared.subject,
    kind: declared.kind ?? "work",
    status: declared.status,
    assignee: declared.assignee ?? "",
    attempt: declared.attempt ?? 0,
    attemptId: declared.attemptId ?? "",
    dependencies: declared.dependencies ?? [],
    objective: declared.objective ?? "",
    inScope: declared.inScope ?? [],
    outOfScope: declared.outOfScope ?? [],
    acceptance: declared.acceptance ?? [],
    verify: declared.verify ?? [],
}
if (declared !== undefined && out.view !== undefined) {
    const view = out.view
    const pairs = [
        ["task_id", view.task_id, declared.id],
        ["subject", view.subject, declared.subject],
        ["kind", view.kind, declared.kind ?? "work"],
        ["status", view.status, declared.status],
        ["assignee", view.assignee, declared.assignee ?? ""],
        ["attempt", view.attempt, declared.attempt ?? 0],
        ["attempt_id", view.attempt_id, declared.attemptId ?? ""],
        ["dependencies", JSON.stringify(view.dependencies), JSON.stringify(declared.dependencies ?? [])],
        ["objective", view.objective, declared.objective ?? ""],
        ["in_scope", JSON.stringify(view.in_scope), JSON.stringify(declared.inScope ?? [])],
        ["out_of_scope", JSON.stringify(view.out_of_scope), JSON.stringify(declared.outOfScope ?? [])],
        ["acceptance", JSON.stringify(view.acceptance), JSON.stringify(declared.acceptance ?? [])],
        ["verify", JSON.stringify(view.verify), JSON.stringify(declared.verify ?? [])],
    ]
    out.fieldComparison = pairs.map(([field, reported, declaredValue]) => ({ field, match: reported === declaredValue, reported: String(reported).slice(0, 160), declared: String(declaredValue).slice(0, 160) }))
    out.allFieldsMatch = out.fieldComparison.every((row) => row.match)
}
rmSync(sandbox, { recursive: true, force: true })
console.log(JSON.stringify(out, null, 2))
