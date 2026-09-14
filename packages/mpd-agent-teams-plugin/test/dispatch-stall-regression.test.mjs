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
import { installTeamScheduler } from "../lib/scheduler.js"

const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain-stall"
const TEAM_ID = "mpd-default"
const MEMBER_ID = "member-architect-stall"

function makeWorkspace() {
    const dir = mkdtempSync(join(tmpdir(), "mpd-dispatch-stall-"))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function member(name, id, status = "idle") {
    const now = Date.now()
    return { name, id, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: now, status }
}

function task(id, subject, assignee, dependencies = [], overrides = {}) {
    const now = Date.now()
    return { id, subject, assignee, dependencies, status: "pending", attempt: 0, createdAt: now, updatedAt: now, ...overrides }
}

function writeTeamRecord(workspace, team) {
    mkdirSync(join(workspace, STATE_DIR, team.id, "inbox"), { recursive: true })
    writeFileSync(join(workspace, STATE_DIR, team.id, "team.json"), `${JSON.stringify(team, null, 2)}\n`)
}

function readTeamRecord(workspace, teamId) {
    return JSON.parse(readFileSync(join(workspace, STATE_DIR, teamId, "team.json"), "utf8"))
}

function teamRecord(tasks) {
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
 */
function makeRuntime(workspace, { memberStatus = "running" } = {}) {
    const deliveries = []
    const warnings = []
    const handlers = new Map()
    const live = new Map()
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const liveMember = { id: MEMBER_ID, status: memberStatus, session: { header: { cwd: workspace } } }
    live.set(CAPTAIN_ID, captain)
    live.set(MEMBER_ID, liveMember)
    const ctx = {
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

/** Wait until `predicate` holds, so an async kick chain can settle. */
async function settle(predicate, label) {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
    if (!predicate()) throw new Error(`timed out waiting for ${label}`)
}

test("the approval-time kick delivers a ready root task to a member whose spawn turn is still running", async () => {
    const ws = makeWorkspace()
    try {
        writeTeamRecord(ws.dir, teamRecord([task("t1", "freeze the contract", "Architect")]))
        const { ctx, captain, deliveries } = makeRuntime(ws.dir)
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

        await scheduler.kickTeam(ws.dir, TEAM_ID, captain)

        expect(deliveries).toHaveLength(1)
        expect(deliveries[0].childId).toBe(MEMBER_ID)
        expect(deliveries[0].text).toContain("AgentTeams automatic task assignment")
        expect(deliveries[0].text).toContain("Task: t1")
        const t1 = readTeamRecord(ws.dir, TEAM_ID).tasks.find((item) => item.id === "t1")
        expect(t1.status).toBe("claimed")
        expect(typeof t1.attemptId).toBe("string")
    }
    finally {
        ws.cleanup()
    }
})

test("a second kick while the member is mid-turn does not duplicate the queued assignment, and says why", async () => {
    const ws = makeWorkspace()
    try {
        writeTeamRecord(ws.dir, teamRecord([task("t1", "freeze the contract", "Architect")]))
        const { ctx, captain, deliveries, warnings } = makeRuntime(ws.dir)
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
    const ws = makeWorkspace()
    try {
        writeTeamRecord(ws.dir, teamRecord([task("t1", "freeze the contract", "Architect")]))
        const { ctx, captain, deliveries, handlers, liveMember } = makeRuntime(ws.dir)
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

        await scheduler.kickTeam(ws.dir, TEAM_ID, captain)
        expect(deliveries).toHaveLength(1)

        // The spawn turn ends: the member's status transitions to idle and the
        // scheduler's own retry trigger fires. The assignment is already queued,
        // so this edge must NOT spend a second attempt on the same task.
        liveMember.status = "idle"
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
    const ws = makeWorkspace()
    try {
        const { ctx, warnings, handlers, liveMember } = makeRuntime(ws.dir)
        installTeamScheduler(ctx, { stateDir: STATE_DIR })

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
