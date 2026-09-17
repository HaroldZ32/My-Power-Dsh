// T-01 + T-12 (wave 1, t20): path ownership becomes QUERYABLE and REPAIRABLE, and a team
// carries an EXPLICIT WAVE BOUNDARY.
//
// Every test drives the REAL registered tools against a REAL team record on disk — no mocked
// gate — because the defects this closes were all measured at the tool boundary:
//   * `inScope overlaps <id>; serialize these tasks or split the paths` named no owner context
//     and offered no repair, so the only escape was delete + re-create (which renumbers the task
//     and downgrades it). Measured: this wave hit that refusal three times building its own plan.
//   * one team reached 86 tasks across four waves and every status render carried all of them:
//     the wave boundary existed only as captain discipline.
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")

/** One team record: t1 OWNS a broad glob and is in flight; t2 is a free pending slot. */
function teamRecord({ teamId, captainId, memberId }) {
    const now = Date.now()
    return {
        id: teamId,
        name: "ownership probe",
        captainSessionId: captainId,
        createdAt: now,
        taskSeq: 2,
        phase: "running",
        wave: { label: "w1", index: 1, openedAt: now },
        waveHistory: [],
        members: [{ id: memberId, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t1",
                subject: "the owning lane",
                status: "in_progress",
                assignee: "Senior Engineer",
                dependencies: [],
                attempt: 2,
                attemptId: "attempt-live-1",
                createdAt: now,
                updatedAt: now,
                kind: "implementation",
                round: 1,
                objective: "hold the glob",
                inScope: ["packages/foo/**"],
                outOfScope: [],
                acceptance: ["it is owned"],
                verify: ["bun test packages/foo"],
            },
            {
                id: "t2",
                subject: "the free slot",
                status: "pending",
                dependencies: [],
                attempt: 0,
                createdAt: now,
                updatedAt: now,
                kind: "implementation",
                round: 1,
                objective: "receive a moved pattern",
                inScope: ["packages/bar/**"],
                acceptance: ["it can receive a path"],
                verify: ["bun test packages/bar"],
            },
        ],
    }
}

/** Register the adopted tools against a stub ctx and return the registry. */
function registerTools(workspace, captain, member) {
    const tools = new Map()
    const ctx = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined),
            list: () => [captain, member],
        },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => {},
        on: () => {},
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-ownership-"))
    const teamId = "probe-team"
    const captainId = "session-captain"
    const memberId = "session-member"
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
    const record = teamRecord({ teamId, captainId, memberId })
    writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify(record, null, 2))
    const captain = { id: captainId, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: memberId, status: "idle", session: { header: { cwd: workspace } } }
    return {
        workspace,
        teamId,
        record,
        captain,
        member,
        stateRoot,
        teamFile: join(stateRoot, teamId, "team.json"),
        read: () => JSON.parse(readFileSync(join(stateRoot, teamId, "team.json"), "utf8")),
    }
}

const createArgs = (subject, inScope, extra = {}) => ({
    subject,
    kind: "implementation",
    objective: `prove ${subject}`,
    inScope,
    acceptance: ["the create gate is exercised"],
    verify: ["bun test packages/foo"],
    ...extra,
})

test("T-01: `who owns <path>` names the owner and is READ-ONLY", async () => {
    const box = fixture()
    try {
        const tools = registerTools(box.workspace, box.captain, box.member)
        const tool = tools.get("agent_teams_path_owner")
        expect(tool).toBeDefined()
        const before = readFileSync(box.teamFile, "utf8")

        const answer = await tool.execute({ path: "packages/foo/src/a.ts" }, { agent: box.captain })
        expect(answer.owners.map((owner) => owner.task_id)).toEqual(["t1"])
        expect(answer.owners[0]).toMatchObject({ subject: "the owning lane", assignee: "Senior Engineer", status: "in_progress", matched: ["packages/foo/**"], open: true })
        expect(answer.repair).toMatchObject({ tool: "agent_teams_move_path", from_task: "t1" })

        // A non-overlapping path answers "free", and the read changed no byte of the record.
        const free = await tool.execute({ path: "packages/other/x.ts" }, { agent: box.captain })
        expect(free.owners).toEqual([])
        expect(free.repair).toBeNull()
        expect(readFileSync(box.teamFile, "utf8")).toBe(before)

        // A MEMBER can run the preflight too (it is the seat that declares inScope).
        const asMember = await tool.execute({ path: "packages/foo/src/a.ts" }, { agent: box.member })
        expect(asMember.owners.map((owner) => owner.task_id)).toEqual(["t1"])

        // Rendered for the model, with the repair call spelled out.
        const rendered = tool.output.render({}, answer)[0].text
        expect(rendered).toContain("Owners of \"packages/foo/src/a.ts\"")
        expect(rendered).toContain("t1 [implementation/in_progress] Senior Engineer — the owning lane via packages/foo/**")
        expect(rendered).toContain("agent_teams_move_path")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-01: an overlapping create is refused NAMING the owner, and after the move the same create can be declared", async () => {
    const box = fixture()
    try {
        const tools = registerTools(box.workspace, box.captain, box.member)
        const create = tools.get("agent_teams_create_task")
        const move = tools.get("agent_teams_move_path")

        // (1) NEGATIVE CONTROL: the create fails, naming the owning task and the repair.
        let refusal = undefined
        try {
            await create.execute(createArgs("lane b", ["packages/foo/src/a.ts"]), { agent: box.captain })
        }
        catch (error) {
            refusal = String(error.message)
        }
        expect(refusal).toBeDefined()
        expect(refusal).toContain("inScope overlaps")
        expect(refusal).toContain("t1")
        expect(refusal).toContain("the owning lane")
        expect(refusal).toContain("assigned to Senior Engineer")
        expect(refusal).toContain("agent_teams_move_path")
        expect(refusal).toContain("from_task: \"t1\"")
        // The refusal changed nothing on disk.
        expect(box.read().tasks.length).toBe(2)

        // (2) A non-overlapping create is unaffected by any of this.
        const free = await create.execute(createArgs("lane free", ["packages/other/**"]), { agent: box.captain })
        expect(free.task_id).toBe("t3")

        // (3) THE REPAIR: move the glob off t1 onto the free slot, without remove+re-add.
        //     The comparison is taken against the state IMMEDIATELY BEFORE the move: the create
        //     path legitimately claims ready tasks (measured here: t1 moved in_progress -> claimed
        //     and took a fresh attemptId when t3 was created), so an assertion against the
        //     fixture's first values would measure create_task, not the move.
        const preMove = box.read()
        const preservedBefore = {
            ids: ["t1", "t2"],
            statuses: ["t1", "t2"].map((id) => preMove.tasks.find((task) => task.id === id).status),
            attempts: ["t1", "t2"].map((id) => preMove.tasks.find((task) => task.id === id).attemptId ?? ""),
        }
        const moved = await move.execute({ path: "packages/foo/**", to_task: "t2" }, { agent: box.captain })
        expect(moved.moved).toBe(true)
        expect(moved.from_task).toBe("t1")
        expect(moved.preserved).toEqual(preservedBefore)
        const after = box.read()
        const t1 = after.tasks.find((task) => task.id === "t1")
        const t2 = after.tasks.find((task) => task.id === "t2")
        // NO remove+re-add: the ids, statuses and attempts are untouched.
        expect(t1.id).toBe("t1")
        expect(t1.status).toBe(preservedBefore.statuses[0])
        expect(t1.attemptId).toBe(preservedBefore.attempts[0])
        expect(t1.inScope).toEqual([])
        expect(t2.inScope).toEqual(["packages/bar/**", "packages/foo/**"])

        // (4) The SAME create is now declinable: with the new owner as its dependency the gate
        //     treats the two as SERIALIZED (its own rule), and with no open owner left there is
        //     no collision at all once t2's own lane is the dependency.
        const repaired = await create.execute(createArgs("lane b again", ["packages/foo/src/a.ts"], { dependencies: ["t2"] }), { agent: box.captain })
        expect(repaired.task_id).toBe("t4")
        expect(box.read().tasks.find((task) => task.id === "t4").inScope).toEqual(["packages/foo/src/a.ts"])
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-01: the move refuses a path the donor does not own, an unknown target, a terminal target and an ambiguous donor", async () => {
    const box = fixture()
    try {
        const tools = registerTools(box.workspace, box.captain, box.member)
        const move = tools.get("agent_teams_move_path")
        const attempt = async (args) => {
            try {
                await move.execute(args, { agent: box.captain })
                return null
            }
            catch (error) {
                return String(error.message)
            }
        }
        expect(await attempt({ path: "packages/nobody/**", to_task: "t2" })).toContain("nothing to move")
        expect(await attempt({ path: "packages/foo/**", to_task: "t99" })).toContain("does not exist")
        expect(await attempt({ path: "packages/foo/**", from_task: "t2", to_task: "t1" })).toContain("does not declare")
        expect(await attempt({ path: "packages/foo/**", from_task: "t1", to_task: "t1" })).toContain("already owned")
        // A terminal target cannot receive a path (the move is a repair for work that can run).
        const record = box.read()
        record.tasks.find((task) => task.id === "t2").status = "completed"
        writeFileSync(box.teamFile, JSON.stringify(record, null, 2))
        expect(await attempt({ path: "packages/foo/**", to_task: "t2" })).toContain("completed")
        // Two owners without from_task is ambiguous, and the message lists them.
        const two = box.read()
        two.tasks.find((task) => task.id === "t2").status = "pending"
        two.tasks.find((task) => task.id === "t2").inScope = ["packages/foo/**"]
        writeFileSync(box.teamFile, JSON.stringify(two, null, 2))
        const ambiguous = await attempt({ path: "packages/foo/**", to_task: "t1" })
        expect(ambiguous).toContain("declared by 2 tasks")
        expect(ambiguous).toContain("pass from_task explicitly")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-12: rollover REFUSES while a task is non-terminal, naming the open ids", async () => {
    const box = fixture()
    try {
        const tools = registerTools(box.workspace, box.captain, box.member)
        const rollover = tools.get("agent_teams_rollover")
        expect(rollover).toBeDefined()
        let refusal = undefined
        try {
            await rollover.execute({}, { agent: box.captain })
        }
        catch (error) {
            refusal = String(error.message)
        }
        expect(refusal).toContain("cannot roll over")
        expect(refusal).toContain("t1:in_progress")
        expect(refusal).toContain("t2:pending")
        expect(refusal).toContain("never cancels work")
        // Nothing archived, nothing cleared.
        expect(existsSync(join(box.stateRoot, box.teamId, "waves"))).toBe(false)
        expect(box.read().tasks.length).toBe(2)
        expect(box.read().wave.label).toBe("w1")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-12: rollover archives the closed wave WITH its tasks, advances the label, and status shows both", async () => {
    const box = fixture()
    try {
        const tools = registerTools(box.workspace, box.captain, box.member)
        const rollover = tools.get("agent_teams_rollover")
        const status = tools.get("agent_teams_status")

        // Close the wave: every task terminal.
        const record = box.read()
        record.tasks.find((task) => task.id === "t1").status = "completed"
        record.tasks.find((task) => task.id === "t2").status = "cancelled"
        writeFileSync(box.teamFile, JSON.stringify(record, null, 2))

        const result = await rollover.execute({ reason: "wave 1 landed" }, { agent: box.captain })
        expect(result.rolled_over).toBe(true)
        expect(result.closed_wave).toBe("w1")
        expect(result.next_wave).toBe("w2")
        expect(result.archived_tasks).toBe(2)
        expect(result.counts).toEqual({ total: 2, completed: 1, failed: 0, cancelled: 1 })

        // The ARCHIVE RECORD carries the label, the tasks themselves and the reason.
        const archivePath = join(box.stateRoot, box.teamId, "waves", "w1.json")
        expect(existsSync(archivePath)).toBe(true)
        const archive = JSON.parse(readFileSync(archivePath, "utf8"))
        expect(archive.label).toBe("w1")
        expect(archive.team_id).toBe(box.teamId)
        expect(archive.reason).toBe("wave 1 landed")
        expect(archive.tasks.map((task) => task.id)).toEqual(["t1", "t2"])
        expect(archive.closedAt).toBeGreaterThan(0)

        // The LIVE record moved on: empty task list, next label, history kept.
        const after = box.read()
        expect(after.tasks).toEqual([])
        expect(after.wave.label).toBe("w2")
        expect(after.wave.index).toBe(2)
        expect(after.waveHistory).toHaveLength(1)
        expect(after.waveHistory[0]).toMatchObject({ label: "w1", archivedTasks: 2 })

        // STATUS renders the wave AND the archived waves — the boundary is visible state.
        const snapshot = await status.execute({}, { agent: box.captain })
        expect(snapshot.wave.label).toBe("w2")
        expect(snapshot.wave.archived).toHaveLength(1)
        expect(snapshot.wave.archived[0]).toMatchObject({ label: "w1", archived_tasks: 2 })
        const rendered = status.output.render({}, snapshot)[0].text
        expect(rendered).toContain("Wave: w2")
        expect(rendered).toContain("archived: w1→2 task(s)")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})
