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
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the panel-view
// predicates cannot be typed without re-authoring upstream; this import is expected to be untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { failedDependencyIds, taskVisualState } from "../lib/state.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the live tool
// registrations cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { registerAgentTeamsTools } from "../lib/tools.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the frozen tool
// name lists cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { CAPTAIN_TOOL_NAMES, MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from "../lib/tool-names.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the plugin
// config schema cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { Config } from "../lib/index.js"

/** This test file's own directory, used to resolve the repository root below. */
const here = dirname(fileURLToPath(import.meta.url))
/** The repository root, three levels up from `packages/<pkg>/test/`. */
const repoRoot = join(here, "..", "..", "..")
/** The state directory the plugin resolves under a session workspace. */
const STATE_DIR = join(".mpd", "team")
/** The session id the stub registry reports as the captain of the fixture team. */
const CAPTAIN_ID = "session-captain"
/** The session id the stub registry reports as the single member of the fixture team. */
const MEMBER_ID = "session-member"

/**
 * One producer/consumer task pair whose dependency edge is A -> B, with A's terminal status set by
 * the caller so the blocked / failed / completed cases all read the same fixture.
 * @param aStatus - the status of task A, the dependency B depends on.
 * @returns the two task records the panel and contract views are asked about.
 */
const teamTasks = (aStatus: string): Array<{ id: string; subject: string; status: string; dependencies: string[]; attempt: number; attemptId?: string; createdAt: number; updatedAt: number }> => [
    { id: "A", subject: "producer", status: aStatus, dependencies: [], attempt: 1, attemptId: "cap-A", createdAt: 1, updatedAt: 1 },
    { id: "B", subject: "consumer", status: "pending", dependencies: ["A"], attempt: 0, createdAt: 1, updatedAt: 1 },
]

test("F2: a dependent of a FAILED dependency is NOT rendered blocked in the panel view", () => {
    /** The producer/consumer pair whose producer has terminally failed. */
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
    /** A throwaway session workspace holding the record both views read. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-f2-parity-"))
    /** The one team's state root inside that workspace. */
    const stateRoot = join(workspace, STATE_DIR, "parity")
    try {
        mkdirSync(join(stateRoot, "inbox"), { recursive: true })
        /** The producer/consumer pair whose producer has terminally failed. */
        const tasks = teamTasks("failed")
        writeFileSync(join(stateRoot, "team.json"), JSON.stringify({
            id: "parity", name: "f2 parity", captainSessionId: CAPTAIN_ID, createdAt: 1, taskSeq: 2, phase: "running",
            members: [{ id: MEMBER_ID, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: 1 }],
            tasks,
        }, null, 2))
        // The panel view is built from the same tasks; the tool view from the record.
        /** B's visual state as the Web panel computes it. */
        const panelState = taskVisualState(tasks[1].status, tasks, tasks[1].dependencies)
        /** The failed dependencies the panel names for B. */
        const panelFailed = failedDependencyIds(tasks, tasks[1].dependencies)
        /** The tool definitions the stub context captures at registration time. */
        const tools = new Map()
        /** The live agent the registry reports for the captain session. */
        const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
        /** The live agent the registry reports for the member session. */
        const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
        /** The minimal plugin context the tool registrations need, with the registry seams stubbed. */
        const ctx: {
            tools: { register: (definition: { name: string }) => unknown }
            agents: { get: (id: string) => unknown; list: () => unknown[] }
            subagents: { prompt: () => Promise<{ messageId: string }>; followup: () => void; sendMessage: () => void }
            effect: () => void
            on: () => void
            logger: { warn: () => void; info: () => void; error: () => void; debug: () => void }
            get: () => undefined
        } = {
            tools: { register: (d) => tools.set(d.name, d) },
            agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
            effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }, get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        /** The contract view's answer for the dependent task B. */
        const contract = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        // PARITY: both views say "not blocked" and both name ["A"] as failed.
        expect(panelState).toBe("open")
        expect(panelFailed).toEqual(["A"])
        expect(contract.failed_dependencies).toEqual(panelFailed)
        // and the dependent really is claimable, so the views are not optimistic
        /** The claim result, which proves the dependent is genuinely dispatchable. */
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(claimed.task_id).toBe("B")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("F5: the schema default stateDir is the frozen .mpd/team", () => {
    /** The plugin config resolved with no row overrides. */
    const resolved = new Config({})
    expect(resolved.stateDir).toBe(".mpd/team")
    // an explicit row value still wins (the bundle pins the same value)
    expect(new Config({ stateDir: ".mpd/team" }).stateDir).toBe(".mpd/team")
})

test("F6: TEAM_TOOL_NAMES carries the frozen 14-name manual-entry set", () => {
    /** The frozen manual-entry tool names, read from the requirements record on disk. */
    const frozen: string[] = JSON.parse(readFileSync(join(repoRoot, "evidence", "omo-align", "requirements", "frozen-contract.json"), "utf8")).manualEntryNames.tools
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
