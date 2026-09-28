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
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the plugin
// config schema cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { Config } from "../lib/index.js"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the staleness
// helpers cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { DEFAULT_RECLAIM_STALE_AFTER_MS, findStaleStagedTeams, reclaimStaleStagedTeams } from "../lib/state.js"

/** The state directory the plugin resolves under a session workspace. */
const STATE_DIR = join(".mpd", "team")
/** One hour in milliseconds: the default staleness threshold the contract pins. */
const HOUR = 3600000

/** Write one team record under a fresh state root. */
function writeTeam(stateRoot: string, id: string, record: Record<string, unknown>): void {
    mkdirSync(join(stateRoot, id, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, id, "team.json"), JSON.stringify({
        id, name: id, captainSessionId: "session-other", createdAt: Date.now(), taskSeq: 0,
        phase: "staged", members: [{ id: "session-m", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: 1 }],
        tasks: [], ...record,
    }, null, 2))
}
/**
 * A throwaway directory plus the team state root inside it.
 * @returns the state root, the temporary directory, and a cleanup callback for it.
 */
const roots = (): { stateRoot: string; dir: string; cleanup: () => void } => {
    /** The temporary directory holding this arm's team records. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-r3-reclaim-"))
    return { stateRoot: join(dir, STATE_DIR), dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
/**
 * The team ids still live under one state root, excluding the archive and dotted entries.
 * @param stateRoot - the team state root to list.
 * @returns the live team directory names, or an empty list when the root is absent.
 */
const liveIds = (stateRoot: string): string[] => existsSync(stateRoot)
    ? require("node:fs").readdirSync(stateRoot).filter((n: string) => n !== "archive" && !n.startsWith(".") && existsSync(join(stateRoot, n, "team.json")))
    : []

test("R3 assertion 1: three stale empty staged teams are ARCHIVED, not deleted", async () => {
    /** The state root holding this arm's stale records, plus its cleanup callback. */
    const { stateRoot, cleanup } = roots()
    try {
        /** The creation instant shared by the three records, two hours in the past. */
        const old = Date.now() - 2 * HOUR
        for (const id of ["stale-a", "stale-b", "stale-c"]) writeTeam(stateRoot, id, { createdAt: old })
        /** The live team ids before reclamation, all three present. */
        const before = liveIds(stateRoot).sort()
        expect(before).toEqual(["stale-a", "stale-b", "stale-c"])
        /** The reclamation result, which must name every stale team it archived. */
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(result.archived.map((entry: { teamId: string }) => entry.teamId).sort()).toEqual(["stale-a", "stale-b", "stale-c"])
        // gone from the live root, present under archive/ with its record intact
        expect(liveIds(stateRoot)).toEqual([])
        for (const id of ["stale-a", "stale-b", "stale-c"]) {
            expect(existsSync(join(stateRoot, "archive", id, "team.json"))).toBe(true)
        }
    }
    finally { cleanup() }
})

test("R3 assertion 2: staged-with-tasks, approved, and running teams are byte-identical", async () => {
    /** The state root holding this arm's records, plus its cleanup callback. */
    const { stateRoot, cleanup } = roots()
    try {
        /** The creation instant shared by the planted records, five hours in the past. */
        const old = Date.now() - 5 * HOUR
        writeTeam(stateRoot, "staged-with-tasks", { createdAt: old, tasks: [{ id: "t1", subject: "planned", status: "pending", dependencies: [], createdAt: old, updatedAt: old }] })
        writeTeam(stateRoot, "approved-old", { createdAt: old, approvedAt: old + 1000 })
        writeTeam(stateRoot, "running-old", { createdAt: old, phase: "running", approvedAt: old + 1000 })
        writeTeam(stateRoot, "stale-empty", { createdAt: old })
        /** The pre-reclamation bytes of every record that must survive untouched. */
        const snapshot: Record<string, string> = {}
        for (const id of ["staged-with-tasks", "approved-old", "running-old"]) {
            snapshot[id] = readFileSync(join(stateRoot, id, "team.json"), "utf8")
        }
        /** The reclamation result, which may only have archived the stale empty team. */
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(result.archived.map((entry: { teamId: string }) => entry.teamId)).toEqual(["stale-empty"])
        for (const id of ["staged-with-tasks", "approved-old", "running-old"]) {
            expect(readFileSync(join(stateRoot, id, "team.json"), "utf8")).toBe(snapshot[id])
        }
        expect(liveIds(stateRoot).sort()).toEqual(["approved-old", "running-old", "staged-with-tasks"])
    }
    finally { cleanup() }
})

test("R3 assertion 3: the calling session's OWN stale staged team is never archived", async () => {
    /** The state root holding this arm's records, plus its cleanup callback. */
    const { stateRoot, cleanup } = roots()
    try {
        /** The creation instant shared by both records, three hours in the past. */
        const old = Date.now() - 3 * HOUR
        writeTeam(stateRoot, "own-team", { createdAt: old, captainSessionId: "session-self" })
        writeTeam(stateRoot, "other-team", { createdAt: old, captainSessionId: "session-other" })
        /** The reclamation result for a call made by the owning session itself. */
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR, ownTeamId: "own-team" })
        expect(result.archived.map((entry: { teamId: string }) => entry.teamId)).toEqual(["other-team"])
        expect(result.skipped.map((entry: { teamId: string }) => entry.teamId)).toEqual(["own-team"])
        expect(result.skipped[0].reason).toBe("own-session")
        // the session's own team is still live afterwards
        expect(liveIds(stateRoot)).toEqual(["own-team"])
        expect(existsSync(join(stateRoot, "archive", "own-team"))).toBe(false)
    }
    finally { cleanup() }
})

test("R3: a FRESH staged team is not residue (age threshold is real)", async () => {
    /** The state root holding this arm's fresh record, plus its cleanup callback. */
    const { stateRoot, cleanup } = roots()
    try {
        writeTeam(stateRoot, "fresh", { createdAt: Date.now() })
        /** The staleness search result, which must be empty for a fresh team. */
        const found = await findStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(found).toEqual([])
        /** The reclamation result, which must archive nothing at all. */
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: HOUR })
        expect(result.archived).toEqual([])
        expect(liveIds(stateRoot)).toEqual(["fresh"])
    }
    finally { cleanup() }
})

test("R3 assertion (contract): threshold 0 DISABLES the age gate but still protects live work", async () => {
    /** The state root holding this arm's four fresh records, plus its cleanup callback. */
    const { stateRoot, cleanup } = roots()
    try {
        // everything here is FRESH (age 0) so only the degraded criterion can act
        writeTeam(stateRoot, "fresh-empty", {})
        writeTeam(stateRoot, "with-tasks", { tasks: [{ id: "t1", subject: "planned", status: "pending", dependencies: [], createdAt: Date.now(), updatedAt: Date.now() }] })
        writeTeam(stateRoot, "approved", { approvedAt: Date.now() })
        writeTeam(stateRoot, "running", { phase: "running" })
        /** The pre-reclamation bytes of the record the criterion must leave byte-identical. */
        const snapshot = readFileSync(join(stateRoot, "with-tasks", "team.json"), "utf8")
        /** The reclamation result with the age gate disabled by a zero threshold. */
        const result = await reclaimStaleStagedTeams(stateRoot, { staleAfterMs: 0 })
        // the age gate is gone: the fresh EMPTY staged team is reclaimed
        expect(result.archived.map((entry: { teamId: string }) => entry.teamId)).toEqual(["fresh-empty"])
        // ...while the criterion still never touches work that has tasks / is approved / is running
        expect(liveIds(stateRoot).sort()).toEqual(["approved", "running", "with-tasks"])
        expect(readFileSync(join(stateRoot, "with-tasks", "team.json"), "utf8")).toBe(snapshot)
    }
    finally { cleanup() }
})

test("R3: the threshold comes from config with a 1 h default", () => {
    expect(new Config({}).reclaimStaleAfterMs).toBe(HOUR)
    expect(DEFAULT_RECLAIM_STALE_AFTER_MS).toBe(HOUR)
    expect(new Config({ reclaimStaleAfterMs: 60000 }).reclaimStaleAfterMs).toBe(60000)
})

test("F2 (t22 finalisation): panel view and contract view agree, and a claimable dependent is not blocked", async () => {
    // The adopted agent-teams body is vendored JavaScript with no declaration file, so these lazy
    // imports stay untyped; each directive below is expected for its own import.
    // @ts-expect-error vendored JavaScript has no declaration file
    const { registerAgentTeamsTools } = await import("../lib/tools.js")
    // @ts-expect-error vendored JavaScript has no declaration file
    const { failedDependencyIds, taskVisualState } = await import("../lib/state.js")
    /** The filesystem seam this arm re-imports lazily, aliased to `mk` for the fixture call. */
    const { mkdtempSync: mk } = await import("node:fs")
    /** The throwaway workspace holding the record both views read. */
    const workspace = mk(join(tmpdir(), "mpd-t22-f2-"))
    /** The one team's state root inside that workspace. */
    const stateRoot = join(workspace, STATE_DIR, "f2")
    try {
        mkdirSync(join(stateRoot, "inbox"), { recursive: true })
        /** The shared timestamp of the two task records planted below. */
        const now = Date.now()
        /** The producer/consumer pair whose producer has failed, written for both views. */
        const tasks = [
            { id: "A", subject: "producer", status: "failed", dependencies: [], attempt: 1, attemptId: "cap-A", createdAt: now, updatedAt: now },
            { id: "B", subject: "consumer", status: "pending", dependencies: ["A"], attempt: 0, createdAt: now, updatedAt: now },
        ]
        writeFileSync(join(stateRoot, "team.json"), JSON.stringify({
            id: "f2", name: "f2", captainSessionId: "session-c", createdAt: now, taskSeq: 2, phase: "running",
            members: [{ id: "session-m", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }], tasks,
        }, null, 2))
        /** B's visual state as the Web panel computes it. */
        const panelState = taskVisualState(tasks[1].status, tasks, tasks[1].dependencies)
        /** The failed dependencies the panel names for B. */
        const panelFailed = failedDependencyIds(tasks, tasks[1].dependencies)
        /** The tool definitions the stub context captures at registration time. */
        const tools = new Map()
        /** The live agent the registry reports for the captain session. */
        const captain = { id: "session-c", status: "idle", session: { header: { cwd: workspace } } }
        /** The live agent the registry reports for the member session. */
        const member = { id: "session-m", status: "idle", session: { header: { cwd: workspace } } }
        registerAgentTeamsTools({
            tools: { register: (d: { name: string }) => tools.set(d.name, d) },
            agents: { get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
            effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }, get: () => undefined,
        }, { stateDir: STATE_DIR })
        /** The contract view's answer for the dependent task B. */
        const contract = await tools.get("agent_teams_task_contract").execute({ task_id: "B" }, { agent: captain })
        // BIDIRECTIONAL: not blocked in the panel, failed dependency named in BOTH views
        expect(panelState).toBe("open")
        expect(panelFailed).toEqual(contract.failed_dependencies)
        expect(contract.failed_dependencies).toEqual(["A"])
        // and "claimable" is true, so the views are not merely optimistic
        /** The claim result, which proves the dependent is genuinely dispatchable. */
        const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "B" }, { agent: member })
        expect(claimed.task_id).toBe("B")
    }
    finally { rmSync(workspace, { recursive: true, force: true }) }
})
