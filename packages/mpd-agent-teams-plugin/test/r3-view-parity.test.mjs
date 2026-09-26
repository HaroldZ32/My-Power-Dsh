// t24 repair r2 — F2 (OPT-1 view parity), F5 (stateDir default), F6 (frozen tool set).
//
// F2: the Web/panel view and the task-contract view must agree about a dependent
// whose dependency FAILED — it is claimable (OPT-1), so the panel must not render it
// `blocked`, and both views must name the failed dependency.
// F5: the schema default for stateDir is the frozen `.mpd/team`, not upstream's.
// F6: TEAM_TOOL_NAMES must carry the full frozen 14-name manual-entry set.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { failedDependencyIds, taskVisualState } from "../lib/state.js"
import { registerAgentTeamsTools } from "../lib/tools.js"
import { CAPTAIN_TOOL_NAMES, MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from "../lib/tool-names.js"
import { Config } from "../lib/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain"
const MEMBER_ID = "session-member"

const teamTasks = (aStatus) => [
    { id: "A", subject: "producer", status: aStatus, dependencies: [], attempt: 1, attemptId: "cap-A", createdAt: 1, updatedAt: 1 },
    { id: "B", subject: "consumer", status: "pending", dependencies: ["A"], attempt: 0, createdAt: 1, updatedAt: 1 },
]

test("F2: a dependent of a FAILED dependency is NOT rendered blocked in the panel view", () => {
    const tasks = teamTasks("failed")
    // The panel's visual state must agree with the claimable reality.
    // OPT-1, correct slots: a terminal-failed dependency leaves the dependent open.
    expect(taskVisualState("pending", tasks, ["A"])).toBe("open")
    expect(failedDependencyIds(tasks, ["A"])).toEqual(["A"])
    // A genuinely unfinished dependency still blocks (reverse control).
    expect(taskVisualState("pending", teamTasks("in_progress"), ["A"])).toBe("blocked")
    expect(taskVisualState("pending", teamTasks("claimed"), ["A"])).toBe("blocked")
    // completed / cancelled stay non-blocking (cancelled is the pre-existing deadlock rule)
    expect(taskVisualState("pending", teamTasks("completed"), ["A"])).toBe("open")
    expect(taskVisualState("pending", teamTasks("cancelled"), ["A"])).toBe("open")
    // an unknown dependency id still blocks
    expect(taskVisualState("pending", tasks, ["ghost"])).toBe("blocked")
})

test("F2: panel view and task-contract view agree on the same team record", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-f2-parity-"))
    const stateRoot = join(workspace, STATE_DIR, "parity")
    try {
        mkdirSync(join(stateRoot, "inbox"), { recursive: true })
        const tasks = teamTasks("failed")
        writeFileSync(join(stateRoot, "team.json"), JSON.stringify({
            id: "parity", name: "f2 parity", captainSessionId: CAPTAIN_ID, createdAt: 1, taskSeq: 2, phase: "running",
            members: [{ id: MEMBER_ID, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: 1 }],
            tasks,
        }, null, 2))
        // The panel view is built from the same tasks; the tool view from the record.
        const panelState = taskVisualState(tasks[1].status, tasks, tasks[1].dependencies)
        const panelFailed = failedDependencyIds(tasks, tasks[1].dependencies)
        const tools = new Map()
        const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
        const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
        const ctx = {
            tools: { register: (d) => tools.set(d.name, d) },
            agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
            effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }, get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const contract = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        // PARITY: both views say "not blocked" and both name ["A"] as failed.
        expect(panelState).toBe("open")
        expect(panelFailed).toEqual(["A"])
        expect(contract.failed_dependencies).toEqual(panelFailed)
        // and the dependent really is claimable, so the views are not optimistic
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(claimed.task_id).toBe("B")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("F5: the schema default stateDir is the frozen .mpd/team", () => {
    const resolved = new Config({})
    expect(resolved.stateDir).toBe(".mpd/team")
    // an explicit row value still wins (the bundle pins the same value)
    expect(new Config({ stateDir: ".mpd/team" }).stateDir).toBe(".mpd/team")
})

test("F6: TEAM_TOOL_NAMES carries the frozen 14-name manual-entry set", () => {
    const frozen = JSON.parse(readFileSync(join(repoRoot, "evidence", "omo-align", "requirements", "frozen-contract.json"), "utf8")).manualEntryNames.tools
    // The frozen policy is precise: `manualEntryNames.policy` reads "frozen — renaming any of
    // these is forbidden; ADDING NEW NAMES IS ALLOWED". The assertion is therefore containment,
    // not equality: every frozen name must still be present (no rename, no removal), while the
    // surface may legitimately grow past the frozen 14 — wave 1 grew it with t20's three
    // ownership/wave tools.
    for (const name of frozen) expect(TEAM_TOOL_NAMES).toContain(name)
    expect(TEAM_TOOL_NAMES.length).toBeGreaterThanOrEqual(frozen.length)
    expect(TEAM_TOOL_NAMES).toContain("agent_teams_task_contract")
    // the derived captain/member views stay consistent with the frozen set
    for (const name of MEMBER_TOOL_NAMES) expect(TEAM_TOOL_NAMES).toContain(name)
    for (const name of CAPTAIN_TOOL_NAMES) expect(TEAM_TOOL_NAMES).toContain(name)
    expect(MEMBER_TOOL_NAMES).toContain("agent_teams_task_contract")
})
