// T-07 (wave 1, t36) — A TERMINAL TASK IS NEVER OFFERED TO A SEAT.
//
// MEASURED INSTANCE (2026-09-17, live): the scheduler woke Architect for task `t1` AFTER the
// member had already completed it (verdict=pass), and the member's claim was refused with
// `task status cannot move from "completed" to "claimed"`.
//
// THE ROUTE, named from the code (not guessed): every SELECTION predicate already excludes
// terminal work — `isTaskReady` requires `pending` (`lib/scheduler.js`, `mpd-delta
// ready-task-predicate`), `ownedOpenTask` requires `claimed`/`in_progress`, and
// `nextCapableTask` filters through `isTaskReady`. That is exactly why the existing pin
// (`test/s1-s4-semantics.test.mjs:144-150`) is green: it tests the PREDICATE. The measured
// instance came from `kickMember`'s SHAPE: the ticket is composed inside `withTeamLock(...)`
// and delivered by `deliverToMember(...)` AFTER that lock is released, so a member that
// finished the task in that window was still woken for it. `mpd-delta
// terminal-dispatch-recheck` is the freshness re-check immediately before the wake.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installTeamScheduler } from "../lib/scheduler.js"

const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain-terminal"
const TEAM_ID = "terminal-dispatch-probe"
const MEMBER_ID = "member-architect-terminal"

function workspace() {
    const dir = mkdtempSync(join(tmpdir(), "mpd-terminal-dispatch-"))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function teamFile(dir) {
    return join(dir, STATE_DIR, TEAM_ID, "team.json")
}

function writeTeamRecord(dir, tasks, memberStatus = "idle") {
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
    const now = Date.now()
    writeFileSync(teamFile(dir), `${JSON.stringify({
        id: TEAM_ID,
        name: "terminal dispatch probe",
        description: "T-07 regression fixture",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        approvedAt: now,
        phase: "running",
        taskSeq: tasks.length,
        members: [{ name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: memberStatus }],
        tasks,
    }, null, 2)}\n`)
}

const readTeamRecord = (dir) => JSON.parse(readFileSync(teamFile(dir), "utf8"))

const task = (id, status, overrides = {}) => ({
    id,
    subject: `work ${id}`,
    assignee: "Architect",
    dependencies: [],
    status,
    attempt: status === "pending" ? 0 : 1,
    attemptId: status === "pending" ? undefined : `attempt-${id}-1`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
})

/**
 * One runtime whose delivery seam records WHAT the on-disk status of the delivered task was at
 * the instant of the wake — the reading this whole file exists to pin. `onDeliver` lets a case
 * interleave a write (the member finishing its work) at the delivery boundary itself.
 */
function makeRuntime(dir, { onDeliver } = {}) {
    const deliveries = []
    const warnings = []
    const handlers = new Map()
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
    const live = new Map([
        [CAPTAIN_ID, captain],
        [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }],
    ])
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
                const text = request.content.map((block) => block.text).join("")
                const id = /Task: (\S+)/u.exec(text)?.[1]
                const record = readTeamRecord(dir)
                const delivered = record.tasks.find((item) => item.id === id)
                deliveries.push({ childId: request.childSessionId, taskId: id, statusAtDelivery: delivered?.status ?? "(gone)", text })
                if (onDeliver !== undefined) await onDeliver({ id, dir })
                return { messageId: `message-${deliveries.length}` }
            },
        },
    }
    return { ctx, captain, deliveries, warnings, handlers }
}

/** Wait until `predicate` holds, so an async kick chain can settle. */
async function settle(predicate, label) {
    for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2))
    if (!predicate()) throw new Error(`timed out waiting for ${label}`)
}

test("T-07 positive control: a READY task still reaches its assignee (no blanket refusal)", async () => {
    const box = workspace()
    try {
        writeTeamRecord(box.dir, [task("t1", "pending")])
        const { ctx, captain, deliveries } = makeRuntime(box.dir)
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
        await scheduler.kickMember(box.dir, TEAM_ID, "Architect", captain)
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0].taskId).toBe("t1")
        expect(deliveries[0].statusAtDelivery).toBe("claimed")
        expect(deliveries[0].text).toContain("Task: t1")
    }
    finally {
        box.cleanup()
    }
})

test("T-07 regression: a TERMINAL task is never delivered, and a refused dispatch never writes a status onto it", async () => {
    for (const terminal of ["completed", "failed", "cancelled"]) {
        const box = workspace()
        try {
            writeTeamRecord(box.dir, [task("t1", terminal)])
            const before = readFileSync(teamFile(box.dir), "utf8")
            const { ctx, captain, deliveries } = makeRuntime(box.dir)
            const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
            await scheduler.kickMember(box.dir, TEAM_ID, "Architect", captain)
            expect(deliveries).toHaveLength(0)
            // The record is BYTE-identical: nothing reset the terminal status to pending.
            expect(readFileSync(teamFile(box.dir), "utf8")).toBe(before)
        }
        finally {
            box.cleanup()
        }
    }
})

test("T-07 THE RACE: a task that becomes terminal before the wake is never carried by a wake", async () => {
    // The measured shape: compose under the lock (task still in_progress) → the member finishes
    // it → the delivery must not happen. The barrier is the compose's OWN durable output: the
    // member is written `working` inside the locked callback, so polling for that on disk puts
    // this write inside the compose→deliver window deterministically; the assertion below holds
    // for EITHER interleaving, so it cannot pass by luck.
    const box = workspace()
    try {
        writeTeamRecord(box.dir, [task("t1", "in_progress", { attempt: 1, attemptId: "attempt-t1-1" })])
        const { ctx, captain, deliveries } = makeRuntime(box.dir)
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
        const pending = scheduler.kickMember(box.dir, TEAM_ID, "Architect", captain)
        await settle(() => readTeamRecord(box.dir).members[0].status === "working", "the compose to park the member as working")
        // The member finishes its work inside the window (this is what the live instance did).
        const record = readTeamRecord(box.dir)
        const t1 = record.tasks.find((item) => item.id === "t1")
        // The COMPOSE already minted this attempt (that is `beginTaskAttempt` at ticket-compose
        // time — the measured TOCTOU half); the completion below lands on THAT generation, which
        // is what makes the refusal's "never touch the task" rule observable.
        const composedAttemptId = t1.attemptId
        t1.status = "completed"
        t1.verdict = "pass"
        t1.updatedAt = Date.now()
        writeFileSync(teamFile(box.dir), `${JSON.stringify(record, null, 2)}\n`)
        await pending

        // INVARIANT (holds in EITHER interleaving): no wake ever carried a task whose on-disk
        // status was terminal at the instant of the wake.
        expect(deliveries.filter((delivery) => ["completed", "failed", "cancelled"].includes(delivery.statusAtDelivery))).toEqual([])

        // INVARIANT (also both ways): a refused OR delivered dispatch never rewrites the finished
        // work — the task stays `completed` with the verdict the member earned, on the attempt the
        // compose minted. (A rollback that "restored" `pending`/a previous generation over it is
        // the failure mode this pins; `state.js`'s re-dispatch clear is the other half, t36's L44a.)
        const after = readTeamRecord(box.dir).tasks.find((item) => item.id === "t1")
        expect(after.status).toBe("completed")
        expect(after.verdict).toBe("pass")
        expect(after.attemptId).toBe(composedAttemptId)

        // Which interleaving this run produced is DATA, not an assumption: the re-check either
        // caught the completed task (no wake) or the member's completion landed after the wake.
        if (deliveries.length === 0) {
            expect(warnings.some((line) => line.includes("became completed before its assignment"))).toBe(true)
            expect(readTeamRecord(box.dir).members[0].status).toBe("idle")
        }
        else {
            expect(deliveries).toHaveLength(1)
            expect(["claimed", "in_progress"]).toContain(deliveries[0].statusAtDelivery)
        }
    }
    finally {
        box.cleanup()
    }
})

test("T-07: the delivery-boundary re-check is REGISTERED (a re-materialize cannot silently drop it)", async () => {
    const { MPD_DELTAS } = await import("../lib/mpd-deltas.js")
    const ids = MPD_DELTAS.map((delta) => delta.id)
    expect(ids).toContain("mpd-delta terminal-dispatch-recheck")
    expect(ids).toContain("mpd-delta terminal-dispatch-import")
    // Both regions live in scheduler.js (the file whose delivery boundary they harden).
    for (const id of ["mpd-delta terminal-dispatch-recheck", "mpd-delta terminal-dispatch-import"]) {
        expect(MPD_DELTAS.filter((delta) => delta.id === id).every((delta) => delta.file.endsWith("lib/scheduler.js"))).toBe(true)
    }
})
