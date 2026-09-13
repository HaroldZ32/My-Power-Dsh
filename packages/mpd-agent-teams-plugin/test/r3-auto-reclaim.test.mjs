// t22 (R3) — automatic reclamation of STALE EMPTY STAGED teams.
//
// Contract: at a session's first pre-step, a team is archived iff
//   phase === 'staged' AND never approved AND tasks.length === 0
//   AND age > reclaimStaleAfterMs (default 1 h, config-driven)
//   AND it is not the calling session's own team.
// Archival reuses `archiveTeamDir` (never a raw delete), so the record stays
// reviewable under <stateRoot>/archive/<id>/.
//
// The three falsifiable assertions the captain asked for are the three tests below.
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Config } from "../lib/index.js"
import { DEFAULT_RECLAIM_STALE_AFTER_MS, findStaleStagedTeams, reclaimStaleStagedTeams } from "../lib/state.js"

const STATE_DIR = join(".mpd", "team")
const HOUR = 3600000

/** Write one team record under a fresh state root. */
function writeTeam(stateRoot, id, record) {
    mkdirSync(join(stateRoot, id, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, id, "team.json"), JSON.stringify({
        id, name: id, captainSessionId: "session-other", createdAt: Date.now(), taskSeq: 0,
        phase: "staged", members: [{ id: "session-m", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: 1 }],
        tasks: [], ...record,
    }, null, 2))
}
const roots = () => {
    const dir = mkdtempSync(join(tmpdir(), "mpd-r3-reclaim-"))
    return { stateRoot: join(dir, STATE_DIR), dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
const liveIds = (stateRoot) => existsSync(stateRoot)
    ? require("node:fs").readdirSync(stateRoot).filter((n) => n !== "archive" && !n.startsWith(".") && existsSync(join(stateRoot, n, "team.json")))
    : []

test("R3 assertion 1: three stale empty staged teams are ARCHIVED, not deleted", async () => {
    const { stateRoot, cleanup } = roots()
    try {
        const old = Date.now() - 2 * HOUR
        for (const id of ["stale-a", "stale-b", "stale-c"]) writeTeam(stateRoot, id, { createdAt: old })
        const before = liveIds(stateRoot).sort()
        expect(before).toEqual(["stale-a", "stale-b", "stale-c"])
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(result.archived.map((entry) => entry.teamId).sort()).toEqual(["stale-a", "stale-b", "stale-c"])
        // gone from the live root, present under archive/ with its record intact
        expect(liveIds(stateRoot)).toEqual([])
        for (const id of ["stale-a", "stale-b", "stale-c"]) {
            expect(existsSync(join(stateRoot, "archive", id, "team.json"))).toBe(true)
        }
    }
    finally { cleanup() }
})

test("R3 assertion 2: staged-with-tasks, approved, and running teams are byte-identical", async () => {
    const { stateRoot, cleanup } = roots()
    try {
        const old = Date.now() - 5 * HOUR
        writeTeam(stateRoot, "staged-with-tasks", { createdAt: old, tasks: [{ id: "t1", subject: "planned", status: "pending", dependencies: [], createdAt: old, updatedAt: old }] })
        writeTeam(stateRoot, "approved-old", { createdAt: old, approvedAt: old + 1000 })
        writeTeam(stateRoot, "running-old", { createdAt: old, phase: "running", approvedAt: old + 1000 })
        writeTeam(stateRoot, "stale-empty", { createdAt: old })
        const snapshot = {}
        for (const id of ["staged-with-tasks", "approved-old", "running-old"]) {
            snapshot[id] = readFileSync(join(stateRoot, id, "team.json"), "utf8")
        }
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(result.archived.map((entry) => entry.teamId)).toEqual(["stale-empty"])
        for (const id of ["staged-with-tasks", "approved-old", "running-old"]) {
            expect(readFileSync(join(stateRoot, id, "team.json"), "utf8")).toBe(snapshot[id])
        }
        expect(liveIds(stateRoot).sort()).toEqual(["approved-old", "running-old", "staged-with-tasks"])
    }
    finally { cleanup() }
})

test("R3 assertion 3: the calling session's OWN stale staged team is never archived", async () => {
    const { stateRoot, cleanup } = roots()
    try {
        const old = Date.now() - 3 * HOUR
        writeTeam(stateRoot, "own-team", { createdAt: old, captainSessionId: "session-self" })
        writeTeam(stateRoot, "other-team", { createdAt: old, captainSessionId: "session-other" })
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR, ownTeamId: "own-team" })
        expect(result.archived.map((entry) => entry.teamId)).toEqual(["other-team"])
        expect(result.skipped.map((entry) => entry.teamId)).toEqual(["own-team"])
        expect(result.skipped[0].reason).toBe("own-session")
        // the session's own team is still live afterwards
        expect(liveIds(stateRoot)).toEqual(["own-team"])
        expect(existsSync(join(stateRoot, "archive", "own-team"))).toBe(false)
    }
    finally { cleanup() }
})

test("R3: a FRESH staged team is not residue (age threshold is real)", async () => {
    const { stateRoot, cleanup } = roots()
    try {
        writeTeam(stateRoot, "fresh", { createdAt: Date.now() })
        const found = await findStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(found).toEqual([])
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(result.archived).toEqual([])
        expect(liveIds(stateRoot)).toEqual(["fresh"])
    }
    finally { cleanup() }
})

test("R3: the threshold comes from config with a 1 h default", () => {
    expect(new Config({}).reclaimStaleAfterMs).toBe(HOUR)
    expect(DEFAULT_RECLAIM_STALE_AFTER_MS).toBe(HOUR)
    expect(new Config({ reclaimStaleAfterMs: 60000 }).reclaimStaleAfterMs).toBe(60000)
})

test("F2 (t22 finalisation): panel view and contract view agree, and a claimable dependent is not blocked", async () => {
    const { registerAgentTeamsTools } = await import("../lib/tools.js")
    const { failedDependencyIds, taskVisualState } = await import("../lib/state.js")
    const { mkdtempSync: mk } = await import("node:fs")
    const workspace = mk(join(tmpdir(), "mpd-t22-f2-"))
    const stateRoot = join(workspace, STATE_DIR, "f2")
    try {
        mkdirSync(join(stateRoot, "inbox"), { recursive: true })
        const now = Date.now()
        const tasks = [
            { id: "A", subject: "producer", status: "failed", dependencies: [], attempt: 1, attemptId: "cap-A", createdAt: now, updatedAt: now },
            { id: "B", subject: "consumer", status: "pending", dependencies: ["A"], attempt: 0, createdAt: now, updatedAt: now },
        ]
        writeFileSync(join(stateRoot, "team.json"), JSON.stringify({
            id: "f2", name: "f2", captainSessionId: "session-c", createdAt: now, taskSeq: 2, phase: "running",
            members: [{ id: "session-m", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }], tasks,
        }, null, 2))
        const panelState = taskVisualState(tasks[1].status, tasks, tasks[1].dependencies)
        const panelFailed = failedDependencyIds(tasks, tasks[1].dependencies)
        const tools = new Map()
        const captain = { id: "session-c", status: "idle", session: { header: { cwd: workspace } } }
        const member = { id: "session-m", status: "idle", session: { header: { cwd: workspace } } }
        registerAgentTeamsTools({
            tools: { register: (d) => tools.set(d.name, d) },
            agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
            effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }, get: () => undefined,
        }, { stateDir: STATE_DIR })
        const contract = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        // BIDIRECTIONAL: not blocked in the panel, failed dependency named in BOTH views
        expect(panelState).toBe("open")
        expect(panelFailed).toEqual(contract.failed_dependencies)
        expect(contract.failed_dependencies).toEqual(["A"])
        // and "claimable" is true, so the views are not merely optimistic
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(claimed.task_id).toBe("B")
    }
    finally { rmSync(workspace, { recursive: true, force: true }) }
})
