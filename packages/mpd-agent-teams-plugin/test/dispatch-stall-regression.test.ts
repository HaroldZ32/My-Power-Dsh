// t13 regression: the post-approval dispatch stall (MEASURED live, 2026-09-14,
// team "mpd-default").
//
// The trace (evidence/agent-teams/dispatch-stall/20260914T164302Z/trace-sessions.log):
//   approvedAt                    2026-09-14T16:36:46.809Z
//   every member's turn/start     16:36:46.236 … 16:36:46.802  ← the spawn/welcome turn
//   first task delivery           16:37:46.092                ← 59.3 s later, on the idle edge
//   captain's manual reassign     16:38:18.750                ← which INTERRUPTED the auto-delivered attempt
//
// So at the instant `approveStagedTeam` calls `scheduler.kickTeam`, every freshly
// spawned member is `running` its spawn turn, and the upstream dispatch chain
// returned at the `isMemberAvailable` guard — silently, with no retry and no log.
// Delivery here is a QUEUED next turn (`delivery: 'queue'`), so a member that is
// merely running its own turn CAN accept it; only a member that already owns an
// open attempt is genuinely unavailable (re-delivery would rotate its capability).
//
// Every case below is RED on the pre-fix file and GREEN after the fix.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { installTeamScheduler } from "../lib/scheduler.ts"

/** The state directory the plugin resolves under a session workspace. */
const STATE_DIR = join(".mpd", "team")
/** The session id of the captain that approves the staged team. */
const CAPTAIN_ID = "session-captain-stall"
/** The team id the stall was measured on. */
const TEAM_ID = "mpd-default"
/** The member whose spawn turn is still running at the approval instant. */
const MEMBER_ID = "member-architect-stall"

/**
 * A throwaway workspace the scheduler writes its team record into.
 * @returns the workspace directory and a cleanup callback for it.
 */
function makeWorkspace(): { dir: string; cleanup: () => void } {
    /** The temporary directory standing in for the session workspace. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-dispatch-stall-"))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * One team member as the durable record stores it.
 * @param name - the member's display name, which is also its assignment key.
 * @param id - the member's session id.
 * @param status - the member's status; `idle` unless the arm needs a live turn.
 * @returns the member record.
 */
function member(name: string, id: string, status: string = "idle"): { name: string; id: string; role: string; provider: string; model: string; joinedAt: number; status: string } {
    /** The join instant, shared by every record this helper builds. */
    const now = Date.now()
    return { name, id, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: now, status }
}

/**
 * One task as the durable record stores it.
 * @param id - the task id.
 * @param subject - the task subject.
 * @param assignee - the member name the task is addressed to.
 * @param dependencies - the task ids that must settle before this one dispatches.
 * @param overrides - fields this arm replaces, such as a claimed status.
 * @returns the task record.
 */
function task(id: string, subject: string, assignee: string, dependencies: string[] = [], overrides: Record<string, unknown> = {}): { id: string; subject: string; assignee: string; dependencies: string[]; status: string; attempt: number; createdAt: number; updatedAt: number; [key: string]: unknown } {
    /** The creation instant, shared by every record this helper builds. */
    const now = Date.now()
    return { id, subject, assignee, dependencies, status: "pending", attempt: 0, createdAt: now, updatedAt: now, ...overrides }
}

/**
 * Write one team record under the workspace's team state root.
 * @param workspace - the session workspace holding the state root.
 * @param team - the record to persist, whose `id` names its directory.
 * @returns nothing; the record is written to disk.
 */
function writeTeamRecord(workspace: string, team: { id: string; [key: string]: unknown }): void {
    mkdirSync(join(workspace, STATE_DIR, team.id, "inbox"), { recursive: true })
    writeFileSync(join(workspace, STATE_DIR, team.id, "team.json"), `${JSON.stringify(team, null, 2)}\n`)
}

/**
 * Read one team record back from disk.
 * @param workspace - the session workspace holding the state root.
 * @param teamId - the team directory name to read.
 * @returns the parsed record, whose tasks carry the claimed / attempt fields the arms assert on.
 */
function readTeamRecord(workspace: string, teamId: string): { tasks: Array<{ id: string; status: string; attempt: number; attemptId?: string; [key: string]: unknown }>; [key: string]: unknown } {
    return JSON.parse(readFileSync(join(workspace, STATE_DIR, teamId, "team.json"), "utf8"))
}

/**
 * The one-team record every arm writes before it kicks the scheduler.
 * @param tasks - the task records the team starts with; their count becomes the task sequence.
 * @returns the durable team record.
 */
function teamRecord(tasks: Array<{ id: string; subject: string; assignee: string; dependencies: string[]; status: string; attempt: number; createdAt: number; updatedAt: number; [key: string]: unknown }>): { id: string; name: string; description: string; captainSessionId: string; createdAt: number; approvedAt: number; phase: string; taskSeq: number; members: Array<{ name: string; id: string; role: string; provider: string; model: string; joinedAt: number; status: string }>; tasks: Array<{ id: string; subject: string; assignee: string; dependencies: string[]; status: string; attempt: number; createdAt: number; updatedAt: number; [key: string]: unknown }> } {
    return {
        id: TEAM_ID,
        name: "Stall probe",
        description: "post-approval dispatch regression fixture",
        captainSessionId: CAPTAIN_ID,
        createdAt: Date.now(),
        approvedAt: Date.now(),
        phase: "running",
        taskSeq: tasks.length,
        members: [member("Architect", MEMBER_ID)],
        tasks,
    }
}

/**
 * One runtime whose live Agent registry mirrors the harness at the approval
 * instant: the member Agent exists and is MID-TURN (`running`), exactly as a
 * continuable child is while its spawn prompt executes (`dsh-agent-loop`
 * `get status()` is `running` for every non-idle phase).
 *
 * @param workspace - the session workspace every stubbed agent reports as its cwd.
 * @param memberStatus - the member's live status at the kick instant, `running` by default.
 * @returns the stub context, the two live agents, and the recorded deliveries, warnings and handlers.
 */
function makeRuntime(workspace: string, { memberStatus = "running" }: { memberStatus?: string } = {}): {
    ctx: {
        agents: { get: (id: string) => unknown }
        logger: { warn: (...args: unknown[]) => void; info: () => void; error: () => void; debug: () => void }
        on: (name: string, callback: (payload: unknown) => void) => () => boolean
        subagents: { prompt: (request: { childSessionId: string; content: Array<{ text: string }> }) => Promise<{ messageId: string }> }
    }
    captain: { id: string; status: string; session: { header: { cwd: string } } }
    deliveries: Array<{ childId: string; text: string }>
    warnings: string[]
    /** The scheduler's subscribed event handlers, read back by event name and fired by the arms. */
    handlers: { get: (name: string) => (payload: { agent: unknown; status: string }) => void }
    live: Map<unknown, unknown>
    liveMember: { id: string; status: string; session: { header: { cwd: string } } }
} {
    /** Every task delivery the scheduler made, in order, with the text it queued. */
    const deliveries: Array<{ childId: string; text: string }> = []
    /** Every warning the scheduler logged, so a silent miss is visible as an empty list. */
    const warnings: string[] = []
    /** The event handlers the scheduler subscribed, keyed by event name. */
    const handlers = new Map()
    /** The live Agent registry the context answers from, keyed by session id. */
    const live = new Map()
    /** The captain Agent, idle throughout, so only the member's status is in question. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    /** The member Agent, whose live status is the variable the stall turns on. */
    const liveMember = { id: MEMBER_ID, status: memberStatus, session: { header: { cwd: workspace } } }
    live.set(CAPTAIN_ID, captain)
    live.set(MEMBER_ID, liveMember)
    /** The stub plugin context: the registry, logger, event and subagent seams the scheduler uses. */
    const ctx: {
        agents: { get: (id: string) => unknown }
        logger: { warn: (...args: unknown[]) => void; info: () => void; error: () => void; debug: () => void }
        on: (name: string, callback: (payload: unknown) => void) => () => boolean
        subagents: { prompt: (request: { childSessionId: string; content: Array<{ text: string }> }) => Promise<{ messageId: string }> }
    } = {
        agents: { get: (id) => live.get(id) },
        logger: {
            warn: (...args) => { warnings.push(args.map(String).join(" ")) },
            info: () => {},
            error: () => {},
            debug: () => {},
        },
        on: (name, cb) => { handlers.set(name, cb); return () => handlers.delete(name) },
        subagents: {
            prompt: async (request) => {
                deliveries.push({ childId: request.childSessionId, text: request.content.map((block) => block.text).join("") })
                return { messageId: `message-${deliveries.length}` }
            },
        },
    }
    return { ctx, captain, deliveries, warnings, handlers, live, liveMember }
}

/**
 * Wait until `predicate` holds, so an async kick chain can settle.
 * @param predicate - the condition to poll.
 * @param label - what is being waited for, named in the timeout error.
 * @returns a promise that settles once the predicate holds, or rejects after 500 ms.
 */
async function settle(predicate: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
    if (!predicate()) throw new Error(`timed out waiting for ${label}`)
}

test("the approval-time kick delivers a ready root task to a member whose spawn turn is still running", async () => {
    /** The throwaway workspace the team record is written into. */
    const ws = makeWorkspace()
    try {
        writeTeamRecord(ws.dir, teamRecord([task("t1", "freeze the contract", "Architect")]))
        /** The runtime stub, whose member is still running its spawn turn. */
        const { ctx, captain, deliveries } = makeRuntime(ws.dir)
        /** The scheduler installed over that stub, which the approval path kicks. */
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

        await scheduler.kickTeam(ws.dir, TEAM_ID, captain)

        expect(deliveries).toHaveLength(1)
        expect(deliveries[0].childId).toBe(MEMBER_ID)
        expect(deliveries[0].text).toContain("AgentTeams automatic task assignment")
        expect(deliveries[0].text).toContain("Task: t1")
        // The task the kick just claimed; asserted present because the dispatch above queued it.
        /** Task t1 as it stands on disk after the kick. */
        const t1 = readTeamRecord(ws.dir, TEAM_ID).tasks.find((item) => item.id === "t1")!
        expect(t1.status).toBe("claimed")
        expect(typeof t1.attemptId).toBe("string")
    }
    finally {
        ws.cleanup()
    }
})

test("a second kick while the member is mid-turn does not duplicate the queued assignment, and says why", async () => {
    /** The throwaway workspace the team record is written into. */
    const ws = makeWorkspace()
    try {
        writeTeamRecord(ws.dir, teamRecord([task("t1", "freeze the contract", "Architect")]))
        /** The runtime stub, whose member is still running its spawn turn. */
        const { ctx, captain, deliveries, warnings } = makeRuntime(ws.dir)
        /** The scheduler installed over that stub, kicked twice in a row. */
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

        await scheduler.kickTeam(ws.dir, TEAM_ID, captain)
        await scheduler.kickTeam(ws.dir, TEAM_ID, captain)

        expect(deliveries).toHaveLength(1)
        expect(warnings.join("\n")).toContain("dispatch declined")
        expect(warnings.join("\n")).toContain("Architect")
        expect(warnings.join("\n")).toMatch(/already owns/)
    }
    finally {
        ws.cleanup()
    }
})

test("the member's own idle edge after the queued assignment does not deliver it twice", async () => {
    /** The throwaway workspace the team record is written into. */
    const ws = makeWorkspace()
    try {
        writeTeamRecord(ws.dir, teamRecord([task("t1", "freeze the contract", "Architect")]))
        /** The runtime stub, whose member is still running its spawn turn. */
        const { ctx, captain, deliveries, handlers, liveMember } = makeRuntime(ws.dir)
        /** The scheduler installed over that stub, whose retry trigger the idle edge fires. */
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

        await scheduler.kickTeam(ws.dir, TEAM_ID, captain)
        expect(deliveries).toHaveLength(1)

        // The spawn turn ends: the member's status transitions to idle and the
        // scheduler's own retry trigger fires. The assignment is already queued,
        // so this edge must NOT spend a second attempt on the same task.
        liveMember.status = "idle"
        /** The scheduler's own status listener, which must treat the edge as already queued. */
        const idle = handlers.get("agent/status")
        expect(idle).toBeDefined()
        idle({ agent: liveMember, status: "idle" })
        await new Promise((resolve) => setTimeout(resolve, 120))

        expect(deliveries).toHaveLength(1)
        expect(readTeamRecord(ws.dir, TEAM_ID).tasks[0].attempt).toBe(1)
    }
    finally {
        ws.cleanup()
    }
})

test("an idle edge that resolves no team logs the miss instead of returning silently", async () => {
    /** The throwaway workspace, deliberately left without any team record. */
    const ws = makeWorkspace()
    try {
        /** The runtime stub, whose idle edge has no team to resolve. */
        const { ctx, warnings, handlers, liveMember } = makeRuntime(ws.dir)
        installTeamScheduler(ctx, { stateDir: STATE_DIR })

        /** The scheduler's own status listener, which must log the miss it cannot resolve. */
        const idle = handlers.get("agent/status")
        expect(idle).toBeDefined()
        idle({ agent: liveMember, status: "idle" })

        await settle(() => warnings.some((line) => line.includes("dispatch declined")), "the idle-edge miss to be logged")
        expect(warnings.join("\n")).toContain(MEMBER_ID)
    }
    finally {
        ws.cleanup()
    }
})
