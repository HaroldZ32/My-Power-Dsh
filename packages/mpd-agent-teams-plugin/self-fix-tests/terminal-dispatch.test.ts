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
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { installTeamScheduler } from "../lib/scheduler.js"

/** One live-agent double the registry and the captain argument are built from. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status. */
    status: string
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One member row as the fixture writes it to the team record. */
interface ProbeMember {
    /** The member's display name. */
    readonly name: string
    /** The member's session id. */
    readonly id: string
    /** The member's roster role. */
    readonly role: string
    /** When the member joined, in epoch milliseconds. */
    readonly joinedAt: number
    /** The member's status, which the compose parks as `working`. */
    status: string
}

/** One task as the fixture writes it to the team record. */
interface ProbeTask {
    /** The task's id. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The seat the task is assigned to. */
    readonly assignee: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** The task's status; not readonly because the race arm completes it in place. */
    status: string
    /** How many attempts the task has had. */
    readonly attempt: number
    /** The current attempt id, absent while the task is pending. */
    attemptId?: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed; the race arm stamps it. */
    updatedAt: number
    /** The verdict the member earned, written by the race arm. */
    verdict?: string
}

/** The team record as the fixture leaves it on disk and the arms read it back. */
interface TeamRecordSnapshot {
    /** The member rows the compose parks and the race arm inspects. */
    readonly members: readonly ProbeMember[]
    /** The task set; the elements stay mutable because the race arm completes one in place. */
    readonly tasks: ProbeTask[]
}

/** The overridable fields of one task fixture. */
interface TaskOverrides {
    /** Overrides how many attempts the task has had. */
    readonly attempt?: number
    /** Overrides the current attempt id. */
    readonly attemptId?: string
}

/** One delivered ticket as the runtime double records it at the delivery boundary. */
interface DeliveryRecord {
    /** The child session the ticket was delivered to. */
    readonly childId: string
    /** The task id the ticket names, or undefined when the ticket named none. */
    readonly taskId: string | undefined
    /** The on-disk status of the delivered task at the instant of the wake. */
    readonly statusAtDelivery: string
    /** The generation the ticket was composed for, or null when it names none. */
    readonly ticketAttemptId: string | null
    /** The generation the record owned at the instant of the wake. */
    readonly recordAttemptId: string | null
    /** Whether the ticket named a generation the record no longer owned. */
    readonly staleTicket: boolean
    /** The prompt text the ticket carried. */
    readonly text: string
}

/** The runtime double's options. */
interface RuntimeOptions {
    /** Interleaves a write at the delivery boundary itself. */
    readonly onDeliver?: (context: { readonly id: string | undefined; readonly dir: string }) => Promise<void> | void
}

/** One prompt request the subagent seam receives. */
interface PromptRequest {
    /** The prompt blocks, whose text carries the ticket's task and attempt ids. */
    readonly content: readonly { readonly text: string }[]
    /** The child session the prompt is addressed to. */
    readonly childSessionId: string
}

/** One registered mpd delta region as the derived registry reports it. */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** The region's id, which the registration arm matches on. */
    readonly id: string
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The captain's session id, which owns the fixture team. */
const CAPTAIN_ID = "session-captain-terminal"
/** The team id the fixture writes and the scheduler is keyed by. */
const TEAM_ID = "terminal-dispatch-probe"
/** The member seat the compose parks and the tickets are addressed to. */
const MEMBER_ID = "member-architect-terminal"

/** Create a fresh workspace with a cleanup hook the arms call in `finally`. */
function workspace(): { dir: string; cleanup: () => void } {
/** The temporary workspace the fixture team lives in. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-terminal-dispatch-"))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** The `team.json` path inside one workspace, spelled once for every arm. */
function teamFile(dir: string): string {
    return join(dir, STATE_DIR, TEAM_ID, "team.json")
}

/** Write a team record with the given tasks and member status, so the compose has work. */
function writeTeamRecord(dir: string, tasks: readonly ProbeTask[], memberStatus: string = "idle"): void {
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
/** The instant every timestamp in the fixture record is stamped with. */
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

/** The team record as it stands on disk, re-read at each delivery boundary. */
const readTeamRecord = (dir: string): TeamRecordSnapshot => JSON.parse(readFileSync(teamFile(dir), "utf8"))

/** Build one task fixture; only the fields an arm varies are overridden. */
const task = (id: string, status: string, overrides: TaskOverrides = {}): ProbeTask => ({
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
function makeRuntime(dir: string, { onDeliver }: RuntimeOptions = {}): { ctx: Record<string, unknown>; captain: AgentLike; deliveries: DeliveryRecord[]; warnings: string[]; handlers: Map<string, (...args: unknown[]) => unknown> } {
/** Every ticket the subagent seam actually delivered, in delivery order. */
    const deliveries: DeliveryRecord[] = []
/** Every warning line the context double collected, which the no-wake branch asserts on. */
    const warnings: string[] = []
/** The context's event handlers, keyed by event name. */
    const handlers = new Map()
/** The captain double the kick runs as. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
/** The live agents the registry answers with, keyed by session id. */
    const live = new Map([
        [CAPTAIN_ID, captain],
        [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }],
    ])
/** The context double the REAL scheduler is installed over. */
    const ctx = {
        agents: { get: (id: string) => live.get(id) },
        logger: {
            warn: (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) },
            info: () => {},
            error: () => {},
            debug: () => {},
        },
        on: (name: string, cb: (...args: unknown[]) => unknown) => { handlers.set(name, cb); return () => handlers.delete(name) },
        subagents: {
            prompt: async (request: PromptRequest) => {
/** The ticket's prompt text, joined across its blocks. */
                const text = request.content.map((block) => block.text).join("")
/** The task id the ticket names, read out of that text. */
                const id = /Task: (\S+)/u.exec(text)?.[1]
/** The record as it stands at the instant the prompt is built. */
                const record = readTeamRecord(dir)
/** The delivered task's row, or undefined when the record no longer carries it. */
                const delivered = record.tasks.find((item) => item.id === id)
                // The ticket names the generation it was composed for (`Attempt id: <uuid>`), and the
                // record names the one it owns now. The two readings answer DIFFERENT questions: a
                // delivery that still names the record's own generation is a wake the boundary allowed
                // (whatever the record says by the time the prompt is built), while a delivery naming a
                // generation the record no longer owns is the T-07 breach - a stale ticket carried.
                const ticketAttemptId = /Attempt id: (\S+)/u.exec(text)?.[1] ?? null
                deliveries.push({
                    childId: request.childSessionId,
                    taskId: id,
                    statusAtDelivery: delivered?.status ?? "(gone)",
                    ticketAttemptId,
                    recordAttemptId: delivered?.attemptId ?? null,
                    staleTicket: delivered === undefined || delivered.attemptId !== ticketAttemptId,
                    text,
                })
                if (onDeliver !== undefined) await onDeliver({ id, dir })
                return { messageId: `message-${deliveries.length}` }
            },
        },
    }
    return { ctx, captain, deliveries, warnings, handlers }
}

/** Wait until `predicate` holds, so an async kick chain can settle. */
async function settle(predicate: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 2))
    if (!predicate()) throw new Error(`timed out waiting for ${label}`)
}

test("T-07 positive control: a READY task still reaches its assignee (no blanket refusal)", async () => {
/** The workspace this arm drives. */
    const box = workspace()
    try {
        writeTeamRecord(box.dir, [task("t1", "pending")])
/** The runtime double and the captain the kick runs as. */
        const { ctx, captain, deliveries } = makeRuntime(box.dir)
/** The REAL scheduler, installed over the double. */
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
/** The workspace this iteration drives. */
        const box = workspace()
        try {
            writeTeamRecord(box.dir, [task("t1", terminal)])
/** The record's bytes before the kick, which must survive unchanged. */
            const before = readFileSync(teamFile(box.dir), "utf8")
/** The runtime double and the captain the kick runs as. */
            const { ctx, captain, deliveries } = makeRuntime(box.dir)
/** The REAL scheduler, installed over the double. */
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
        // Wave 2 (lane A / t8): `warnings` was MISSING from this destructuring while the
        // no-wake branch below asserts on it, so that branch raised `ReferenceError: warnings is
        // not defined` instead of asserting — a latent, timing-dependent failure at HEAD (the
        // branch is only reached when the delivery re-check catches the completed task). The
        // collector already existed; this one binding is what makes the assertion run.
        const { ctx, captain, deliveries, warnings } = makeRuntime(box.dir)
/** The REAL scheduler, installed over the double. */
        const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
/** The kick left pending, so the arm can interleave a write before awaiting it. */
        const pending = scheduler.kickMember(box.dir, TEAM_ID, "Architect", captain)
        await settle(() => readTeamRecord(box.dir).members[0].status === "working", "the compose to park the member as working")
        // The member finishes its work inside the window (this is what the live instance did).
        const record = readTeamRecord(box.dir)
/** The task row the member completes inside the compose-to-deliver window. */
        const t1 = record.tasks.find((item: ProbeTask) => item.id === "t1")!
        // The COMPOSE already minted this attempt (that is `beginTaskAttempt` at ticket-compose
        // time — the measured TOCTOU half); the completion below lands on THAT generation, which
        // is what makes the refusal's "never touch the task" rule observable.
        const composedAttemptId = t1.attemptId
        t1.status = "completed"
        t1.verdict = "pass"
        t1.updatedAt = Date.now()
        writeFileSync(teamFile(box.dir), `${JSON.stringify(record, null, 2)}\n`)
        await pending

        // INVARIANT (the one the product can hold, and the one this arm exists to pin): no wake ever
        // carried a ticket for a generation the record had ALREADY stopped owning.
        //
        // The narrower reading - "the on-disk status was terminal at the instant of the wake" - is not
        // a property the boundary can deliver: the re-check is the last thing before the wake, and a
        // completion can always land in the gap between that decision and the prompt being built.
        // Measured 2026-09-22: with the prompt-time reading alone this arm failed 4 of 6 runs, because
        // the test's OWN write (which bypasses the team lock, unlike a real member's update) lands
        // after the decision and then shows up as `statusAtDelivery: completed` on the ONE delivery
        // whose `ticketAttemptId` is still the record's own - i.e. nothing stale was carried.
        expect(deliveries.filter((delivery) => delivery.staleTicket)).toEqual([])
        expect(deliveries.filter((delivery) => ["completed", "failed", "cancelled"].includes(delivery.statusAtDelivery) && delivery.staleTicket)).toEqual([])

        // INVARIANT (also both ways): a refused OR delivered dispatch never rewrites the finished
        // work — the task stays `completed` with the verdict the member earned, on the attempt the
        // compose minted. (A rollback that "restored" `pending`/a previous generation over it is
        // the failure mode this pins; `state.js`'s re-dispatch clear is the other half, t36's L44a.)
        const after = readTeamRecord(box.dir).tasks.find((item: ProbeTask) => item.id === "t1")!
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
/** The single ticket this run delivered. */
            const delivery = deliveries[0]
            // A wake the boundary allowed either reads as still-open (the common case) or reads as
            // terminal because the completion landed after the decision - and in that second case the
            // ticket MUST still name the record's own generation, so the member's refusal is the
            // member-side guard and never a lost/stale ticket.
            expect(delivery.staleTicket).toBe(false)
            if (["completed", "failed", "cancelled"].includes(delivery.statusAtDelivery)) {
                expect(delivery.ticketAttemptId).toBe(delivery.recordAttemptId)
            } else {
                expect(["claimed", "in_progress"]).toContain(delivery.statusAtDelivery)
            }
        }
    }
    finally {
        box.cleanup()
    }
})

test("T-07: the delivery-boundary re-check is REGISTERED (a re-materialize cannot silently drop it)", async () => {
    /** The derived delta registry, imported dynamically so the file still links without it. */
    // A dynamic import cannot be covered by a directive above the statement, so the reason sits here:
    // @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note at the top).
    const { MPD_DELTAS } = await import("../lib/mpd-deltas.js")
/** The registered region ids this arm pins. */
    const ids = MPD_DELTAS.map((delta: DeltaEntry) => delta.id)
    expect(ids).toContain("mpd-delta terminal-dispatch-recheck")
    expect(ids).toContain("mpd-delta terminal-dispatch-import")
    // Both regions live in scheduler.js (the file whose delivery boundary they harden).
    for (const id of ["mpd-delta terminal-dispatch-recheck", "mpd-delta terminal-dispatch-import"]) {
        expect(MPD_DELTAS.filter((delta: DeltaEntry) => delta.id === id).every((delta: DeltaEntry) => delta.file.endsWith("lib/scheduler.js"))).toBe(true)
    }
})
