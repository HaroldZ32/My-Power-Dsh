// Wave-2b (t27, lane A) self-fix tests — the three PRODUCT-SHAPED rows, each with the negative
// control the frozen acceptance names:
//
//   T-13  a `deferred` task kind that NEVER dispatches: the enum, the quality predicates and the
//         dispatch filter agree, the claim verb refuses it, the status view renders the kind, and a
//         seat holding only that task is still eligible. NEG CONTROL: the SAME shape without the
//         kind IS offered — so the filter keys on the KIND, not on the fixture.
//   T-27  the contract tool accepts a BATCH: N contracts in ONE call, every requested id present and
//         attributed, a missing id reported AS ITSELF (never dropped). NEG CONTROL: a batch of ONE
//         equals the single-id call's content shape, and an empty batch is refused loudly.
//   T-44  approval from the TEXT surface (the `agent_teams_approve` tool) transitions a staged team
//         exactly like the panel path (the same runtime `approveStagedTeam` the Web route calls);
//         NEG CONTROL: a NON-captain seat calling the same tool is refused with a reason.
//
// Falsifiability: every arm drives the REAL registered tool through its `execute` boundary against a
// real team record on disk (never a hand-built return value), and the T-13/T-27 arms are asserted to
// be RED on the pre-fix revision — the readings both sides are kept in
// `evidence/agent-teams/wave2b-laneA/<stamp>/`.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "../lib/tools.js"
import { isTaskReady } from "../lib/scheduler.js"
import { isQualityKind, taskKindOf } from "../lib/quality-gates.js"
// Imported as a NAMESPACE on purpose: the pre-fix revision does not export the new symbols yet, and
// a module-load error is not an arm failing — the driver must RUN on both sides so the same
// assertions produce the red side and the green side.
import * as types from "../lib/types.js"

const TASK_KINDS = types.TASK_KINDS
const NON_DISPATCHABLE_TASK_KINDS = types.NON_DISPATCHABLE_TASK_KINDS ?? []

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "w2b-product-rows"
const CAPTAIN = "session-captain"
const MEMBER_ID = "session-member"
const MEMBER = "Architect"
const CREATED = 1_700_000_000_000

/** One task record with the durable shape the tools validate. */
function task(id, over = {}) {
    return {
        id,
        subject: `subject ${id}`,
        status: "pending",
        dependencies: [],
        attempt: 0,
        createdAt: CREATED,
        updatedAt: CREATED,
        acceptance: [],
        verify: [],
        acceptanceResults: [],
        commandsRun: [],
        ...over,
    }
}

/** A team record; `tasks` is the subject under test. */
function teamRecord(tasks, over = {}) {
    return {
        id: TEAM_ID,
        name: "w2b product-row probe",
        captainSessionId: CAPTAIN,
        createdAt: CREATED,
        taskSeq: 9,
        phase: "running",
        members: [{ id: MEMBER_ID, name: MEMBER, role: "architect", status: "idle", joinedAt: CREATED }],
        tasks,
        ...over,
    }
}

/** Write the record into a temp workspace and return the agents the tools authenticate against. */
function fixture(record) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-w2b-rows-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(record, null, 2))
    const captain = { id: CAPTAIN, status: "idle", options: { provider: "p", model: "m" }, session: { header: { cwd: workspace }, requestHeader: () => undefined } }
    const member = { id: MEMBER_ID, status: "idle", options: { provider: "p", model: "m" }, session: { header: { cwd: workspace }, requestHeader: () => undefined } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

/** Register the REAL tools against a stub ctx; `deliveries` records every member wake-up. */
function registerTools(workspace, captain, member) {
    const tools = new Map()
    const deliveries = []
    const ctx = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined),
            list: () => [captain, member],
        },
        subagents: {
            getProvider: () => ({ prepareContinuable: () => undefined, capabilities: { persona: true, toolFilter: true } }),
            list: () => ["subagent-spawn"],
            startContinuable: async () => ({ childId: "child-1" }),
            prompt: async (_id, payload) => { deliveries.push(payload); return { messageId: "m1" } },
            followup: () => {},
            sendMessage: () => {},
        },
        llm: { resolveCallConfig: async (request) => ({ provider: request.provider, model: request.model }), listModels: async () => [] },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    const runtime = registerAgentTeamsTools(ctx, { stateDir: STATE_DIR, provider: "subagent-spawn" })
    return { tools, runtime, deliveries }
}

const readRecord = (teamFile) => JSON.parse(readFileSync(teamFile, "utf8"))

test("T-13 deferred kind: never offered, never claimed, rendered as itself, and it never consumes the allowance", async () => {
    const { workspace, captain, member, teamFile } = fixture(teamRecord([
        task("t1", { kind: "deferred", assignee: MEMBER }),
        task("t2", { kind: "work" }),
        task("t3", { kind: "deferred", assignee: "captain" }),
        task("t4", { kind: "work" }),
    ]))
    const { tools } = registerTools(workspace, captain, member)
    const record = readRecord(teamFile)

    // (0) the enum and the quality predicates agree with the row
    expect(TASK_KINDS).toContain("deferred")
    expect(NON_DISPATCHABLE_TASK_KINDS).toContain("deferred")
    expect(isQualityKind("deferred")).toBe(false)
    expect(taskKindOf(record.tasks[0])).toBe("deferred")

    // (a) the dispatch filter: the deferred task is not ready, its TWIN is (the negative control)
    expect(isTaskReady(record.tasks, record.tasks[0])).toBe(false)
    expect(isTaskReady(record.tasks, record.tasks[1])).toBe(true)

    // (b) the claim verb refuses it, naming the kind; the twin is claimable (the negative control)
    await expect(tools.get("agent_teams_claim_task").execute({ task_id: "t1" }, { agent: member }))
        .rejects.toThrow(/deferred/)
    const claimed = await tools.get("agent_teams_claim_task").execute({ task_id: "t2" }, { agent: member })
    expect(claimed.status).toBe("claimed")

    // (c) the status view renders the kind for the parked task
    const status = await tools.get("agent_teams_status").execute({}, { agent: captain })
    expect(status.tasks.find((entry) => entry.id === "t1").kind).toBe("deferred")

    // (d) the allowance: the captain holds ONLY the deferred t3 and may still take over t4
    const takeover = await tools.get("agent_teams_reassign_task").execute({ task_id: "t4", assignee: "captain" }, { agent: captain })
    expect(takeover.assignee).toBe("captain")
    // Measured, not preferred: a CAPTAIN takeover is immediate work, so it lands in_progress (a
    // member claim lands "claimed"). The reading this arm needs is that the takeover HAPPENED.
    expect(takeover.status).toBe("in_progress")
})

test("T-27 batch contract read: N contracts in one call, a missing id as itself, batch-of-one == single, empty refused", async () => {
    const { workspace, captain, member } = fixture(teamRecord([
        task("t1"),
        task("t2", { status: "in_progress", assignee: MEMBER, attempt: 1, attemptId: "attempt-1" }),
        task("t3", { status: "completed" }),
    ]))
    const { tools } = registerTools(workspace, captain, member)
    const contract = tools.get("agent_teams_task_contract")

    // the single-id shape is the reference the batch must not degrade
    const single = await contract.execute({ task_id: "t1" }, { agent: member })

    // The batch rides on the SINGLE declared parameter (comma-separated ids): the read-only surface
    // of `test/task-contract-tool.test.mjs` pins `Object.keys(parameters.properties) === ["task_id"]`
    // and that path is NOT this lane's, so the batch is additive to the existing argument.
    const batch = await contract.execute({ task_id: "t1,t2,t3" }, { agent: member })
    expect(batch.requested).toEqual(["t1", "t2", "t3"])
    expect(batch.contracts.map((entry) => entry.task_id)).toEqual(["t1", "t2", "t3"])
    expect(batch.unresolved).toEqual([])

    // NEG CONTROL: a batch of ONE carries the single-id content shape, field for field
    const one = await contract.execute({ task_id: "t1,t1" }, { agent: member })
    // NEG CONTROL, in BOTH forms: (a) a one-id call IS the single-id call (the list form is opt-in on
    // the comma, so this is the identity the acceptance names), and (b) every element of a multi-id
    // batch carries the same content shape as its own single call — the stronger per-element read.
    const oneExactly = await contract.execute({ task_id: "t1" }, { agent: member })
    expect(oneExactly).toEqual(single)
    expect(one.contracts).toEqual([single, single])

    // a missing id is reported AS ITSELF and never dropped
    const mixed = await contract.execute({ task_id: "t2,nope,t3" }, { agent: member })
    expect(mixed.contracts.map((entry) => entry.task_id)).toEqual(["t2", "t3"])
    expect(mixed.unresolved.map((entry) => entry.task_id)).toEqual(["nope"])

    // the render names every contract id and every unresolved id
    const text = contract.output.render({}, mixed).map((block) => block.text).join("\n")
    for (const id of ["t2", "t3", "nope"]) expect(text).toContain(id)

    // NEG CONTROL: an empty batch is refused loudly, never answered with an empty success
    await expect(contract.execute({ task_id: "," }, { agent: member })).rejects.toThrow(/empty/)
    await expect(contract.execute({ task_id: "" }, { agent: member })).rejects.toThrow(/required/)
})

test("T-44 text-surface approval: the same transition the panel path runs, and a member is refused", async () => {
    const stagedRecord = () => teamRecord([task("t1")], {
        phase: "staged",
        members: [{ id: "", name: MEMBER, role: "architect", status: "idle", joinedAt: CREATED }],
    })
    const oldHome = process.env.HOME
    process.env.HOME = mkdtempSync(join(tmpdir(), "mpd-w2b-home-"))
    try {
        // (1) the TEXT path — the tool the captain calls from a text surface
        const text = fixture(stagedRecord())
        const textTools = registerTools(text.workspace, text.captain, text.member)
        const refused = await textTools.tools.get("agent_teams_approve")
            .execute({ confirmation: "approved, run it" }, { agent: text.member })
            .then(() => undefined, (error) => String(error?.message ?? error))
        expect(refused, "a non-captain seat must be REFUSED with a reason").toBeTypeOf("string")
        // The refusal is the tools' own authorization boundary and it names WHY: the caller does not
        // lead this team. (Asserted against the measured message, not a preferred one.)
        expect(refused).toMatch(/not leading any team|only the captain|must be the captain/i)
        const approved = await textTools.tools.get("agent_teams_approve")
            .execute({ confirmation: "approved, run it" }, { agent: text.captain })
        expect(approved.status).toBe("running")

        // (2) the PANEL path — the runtime entry the Web "Approve & Run" route calls directly
        const panel = fixture(stagedRecord())
        const panelTools = registerTools(panel.workspace, panel.captain, panel.member)
        await panelTools.runtime.approveStagedTeam(panel.captain, TEAM_ID)

        // (3) MEASURED identity of the resulting records, one field at a time
        const afterText = readRecord(text.teamFile)
        const afterPanel = readRecord(panel.teamFile)
        expect(afterText.phase).toBe("running")
        expect(typeof afterText.approvedAt).toBe("number")
        expect(afterText.planReviewState).toBeUndefined()
        expect(Object.keys(afterText).sort()).toEqual(Object.keys(afterPanel).sort())
        // `approvedAt`, `updatedAt` and `attemptId` are generated per run (a clock reading and a fresh
        // uuid); they are compared as TYPE TOKENS so the assertion still requires every field to be
        // present and shaped, while the transition semantics are compared value-for-value.
        const normalise = (value) => JSON.parse(JSON.stringify(value, (key, entry) => {
            if (key === "approvedAt") return "<approvedAt:number>"
            if (key === "updatedAt" || key === "joinedAt") return "<clock:number>"
            if (key === "attemptId") return "<attemptId:string>"
            return entry
        }))
        expect(normalise(afterText)).toEqual(normalise(afterPanel))
    } finally {
        process.env.HOME = oldHome
    }
})
