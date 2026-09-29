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
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** The three ids one fixture record is built from. */
interface TeamIds {
    /** The team id the record and its state directory are keyed by. */
    readonly teamId: string
    /** The captain's session id, which owns the record. */
    readonly captainId: string
    /** The member's session id, the seat the read-only preflight arm calls as. */
    readonly memberId: string
}

/** One live-agent double the tools registry answers with. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status. */
    readonly status: string
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One tool definition as the registration double captures it. */
interface ToolDefinition {
    /** The tool's registered name, which is also the map key. */
    readonly name: string
    /**
     * Run one call against the registry.
     *
     * @param args - the tool arguments the arm supplies.
     * @param exec - the execution context, carrying the seat the call runs as.
     * @returns the decoded tool result, whose fields are tool-specific.
     */
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<ToolResult>
    /** The tool's own renderers, which the status and owner surfaces are read through. */
    readonly output: { render(args: Record<string, unknown>, value: unknown): readonly { readonly text: string }[] }
}

/** The wave half of a status snapshot, which the rollover arm reads back. */
interface StatusWave {
    /** The current wave's label. */
    readonly label: string
    /** The wave's 1-based index. */
    readonly index: number
    /** The archived waves the status surface reports. */
    readonly archived: readonly unknown[]
}

/**
 * One tool result as THIS file's arms read it.
 *
 * Each `agent_teams_*` tool returns its own JSON payload, and an arm reads only the fields its own
 * tool produces; the file drives five different tools through one `execute` signature, so the fields
 * they collectively read are declared together here rather than cast at every call site.
 */
interface ToolResult {
    /** The owner rows the path-owner answer reports. */
    readonly owners: readonly OwnerRow[]
    /** The repair call the path-owner answer suggests, or null when no task owns the path. */
    readonly repair: unknown
    /** The id of the task a create or a move produced. */
    readonly task_id: string
    /** Whether a move actually moved a pattern. */
    readonly moved: boolean
    /** The task a move took the pattern from. */
    readonly from_task: string
    /** The ids, statuses and attempts a move preserved. */
    readonly preserved: unknown
    /** Whether a rollover closed the wave. */
    readonly rolled_over: boolean
    /** The wave label the rollover closed. */
    readonly closed_wave: string
    /** The wave label the rollover opened. */
    readonly next_wave: string
    /** How many tasks the rollover archived. */
    readonly archived_tasks: number
    /** The per-status counts the rollover reports. */
    readonly counts: unknown
    /** The wave half of a status snapshot. */
    readonly wave: StatusWave
}

/** One owner row the path-owner answer reports. */
interface OwnerRow {
    /** The owning task's id. */
    readonly task_id: string
}

/** One member row as the fixture writes it. */
interface ProbeMember {
    /** The member's session id. */
    readonly id: string
    /** The member's display name, which the ownership answer names. */
    readonly name: string
    /** The member's roster role. */
    readonly role: string
    /** The member's lifecycle status. */
    readonly status: string
    /** When the member joined, in epoch milliseconds. */
    readonly joinedAt: number
}

/** One task as the fixture writes it; two fields are mutated by the refusal arms. */
interface ProbeTask {
    /** The task's id. */
    readonly id: string
    /** The task's subject text, which the ownership answer names. */
    readonly subject: string
    /** The task's status; not readonly because two arms move a row to a terminal status. */
    status: string
    /** The seat the task is assigned to, absent on a pooled task. */
    readonly assignee?: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
    /** The current attempt id, absent while the task is pending. */
    attemptId?: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed, in epoch milliseconds. */
    readonly updatedAt: number
    /** The task's kind. */
    readonly kind: string
    /** The task's review round. */
    readonly round?: number
    /** The task's objective text. */
    readonly objective?: string
    /** The write scope the task declares; not readonly because the ambiguity arm widens it. */
    inScope: string[]
    /** Patterns the task explicitly excludes. */
    readonly outOfScope?: readonly string[]
    /** The criteria the task must satisfy. */
    readonly acceptance?: readonly string[]
    /** The commands the task must run. */
    readonly verify?: readonly string[]
}

/** The wave boundary a record carries. */
interface TeamWave {
    /** The wave's label, which the rollover advances. */
    readonly label: string
    /** The wave's 1-based index. */
    readonly index: number
    /** When the wave opened, in epoch milliseconds. */
    readonly openedAt: number
}

/** One team record as the fixture writes it and the arms re-read it. */
interface TeamRecordSnapshot {
    /** The team id. */
    readonly id: string
    /** The team's display name. */
    readonly name: string
    /** The owning captain's session id. */
    readonly captainSessionId: string
    /** When the team was created, in epoch milliseconds. */
    readonly createdAt: number
    /** How many tasks the team has ever declared. */
    readonly taskSeq: number
    /** The team's lifecycle phase. */
    readonly phase: string
    /** The current wave boundary. */
    readonly wave: TeamWave
    /** The waves already archived. */
    readonly waveHistory: readonly unknown[]
    /** The member rows. */
    readonly members: readonly ProbeMember[]
    /** The task set; the elements stay mutable because the refusal arms move a row. */
    readonly tasks: ProbeTask[]
}

/** The fixture's roots, the record it wrote, both seats, and a reader for the record on disk. */
interface Fixture {
    /** The temporary workspace the fixture team lives in. */
    readonly workspace: string
    /** The team id the record and the state root are keyed by. */
    readonly teamId: string
    /** The record as it was first written. */
    readonly record: TeamRecordSnapshot
    /** The captain double every mutating call runs as. */
    readonly captain: AgentLike
    /** The member double the read-only preflight arm calls as. */
    readonly member: AgentLike
    /** The resolved team-state root. */
    readonly stateRoot: string
    /** The `team.json` path the arms compare byte for byte. */
    readonly teamFile: string
    /** Re-read the record from disk. */
    read: () => TeamRecordSnapshot
}

/** The overridable fields of one create-task call. */
interface CreateExtra {
    /** Extra dependency ids for the create call. */
    readonly dependencies?: readonly string[]
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")

/** One team record: t1 OWNS a broad glob and is in flight; t2 is a free pending slot. */
/** One team record: t1 OWNS a broad glob and is in flight; t2 is a free pending slot. */
function teamRecord({ teamId, captainId, memberId }: TeamIds): TeamRecordSnapshot {
/** The instant every timestamp in the fixture record is stamped with. */
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
/** Register the adopted tools against a stub ctx and return the registry. */
function registerTools(workspace: string, captain: AgentLike, member: AgentLike): Map<string, ToolDefinition> {
/** The definitions the registration double captured, keyed by tool name. */
    const tools = new Map()
/** The context double the vendored registration path drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined),
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

/** Write the fixture record and return its roots, both seats and a reader for it. */
function fixture(): Fixture {
/** The temporary workspace the fixture team lives in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-ownership-"))
/** The team id the record and the state root are keyed by. */
    const teamId = "probe-team"
/** The captain's session id, which owns the record. */
    const captainId = "session-captain"
/** The member's session id, the seat the preflight arm calls as. */
    const memberId = "session-member"
/** The resolved team-state root. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
/** The record as it is first written to disk. */
    const record = teamRecord({ teamId, captainId, memberId })
    writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify(record, null, 2))
/** The captain double every mutating call runs as. */
    const captain = { id: captainId, status: "idle", session: { header: { cwd: workspace } } }
/** The member double the read-only preflight arm calls as. */
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

/** Build one create-task argument object; only the fields an arm varies are overridden. */
const createArgs = (subject: string, inScope: readonly string[], extra: CreateExtra = {}): Record<string, unknown> => ({
    subject,
    kind: "implementation",
    objective: `prove ${subject}`,
    inScope,
    acceptance: ["the create gate is exercised"],
    verify: ["bun test packages/foo"],
    ...extra,
})

test("T-01: `who owns <path>` names the owner and is READ-ONLY", async () => {
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(box.workspace, box.captain, box.member)
/** The registered who-owns tool; the registry above captured it, so the lookup cannot miss. */
        const tool = tools.get("agent_teams_path_owner")!
        expect(tool).toBeDefined()
/** The record's bytes before the read-only answer. */
        const before = readFileSync(box.teamFile, "utf8")

/** The owner answer for a path t1 holds. */
        const answer = await tool.execute({ path: "packages/foo/src/a.ts" }, { agent: box.captain })
        expect(answer.owners.map((owner: OwnerRow) => owner.task_id)).toEqual(["t1"])
        expect(answer.owners[0]).toMatchObject({ subject: "the owning lane", assignee: "Senior Engineer", status: "in_progress", matched: ["packages/foo/**"], open: true })
        expect(answer.repair).toMatchObject({ tool: "agent_teams_move_path", from_task: "t1" })

        // A non-overlapping path answers "free", and the read changed no byte of the record.
        const free = await tool.execute({ path: "packages/other/x.ts" }, { agent: box.captain })
        expect(free.owners).toEqual([])
        expect(free.repair).toBeNull()
        expect(readFileSync(box.teamFile, "utf8")).toBe(before)

        // A MEMBER can run the preflight too (it is the seat that declares inScope).
        const asMember = await tool.execute({ path: "packages/foo/src/a.ts" }, { agent: box.member })
        expect(asMember.owners.map((owner: OwnerRow) => owner.task_id)).toEqual(["t1"])

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
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(box.workspace, box.captain, box.member)
/** The registered create tool. */
        const create = tools.get("agent_teams_create_task")!
/** The registered move tool, which is the repair half. */
        const move = tools.get("agent_teams_move_path")!

        // (1) NEGATIVE CONTROL: the create fails, naming the owning task and the repair.
        let refusal = undefined
        try {
            await create.execute(createArgs("lane b", ["packages/foo/src/a.ts"]), { agent: box.captain })
        }
        catch (error) {
            // The thrown value is unknowable from a JS throw site, so the message is read through Error.
            refusal = String((error as Error).message)
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
/** The ids, statuses and attempts read immediately before the move, as the comparison baseline. */
        const preservedBefore = {
            ids: ["t1", "t2"],
            statuses: ["t1", "t2"].map((id: string) => preMove.tasks.find((task: ProbeTask) => task.id === id)!.status),
            attempts: ["t1", "t2"].map((id: string) => preMove.tasks.find((task: ProbeTask) => task.id === id)!.attemptId ?? ""),
        }
/** The move's answer for the glob handed to the free slot. */
        const moved = await move.execute({ path: "packages/foo/**", to_task: "t2" }, { agent: box.captain })
        expect(moved.moved).toBe(true)
        expect(moved.from_task).toBe("t1")
        expect(moved.preserved).toEqual(preservedBefore)
/** The record as it stands after the move. */
        const after = box.read()
/** The donor row after the move; the fixture wrote t1, so the lookup cannot miss. */
        const t1 = after.tasks.find((task: ProbeTask) => task.id === "t1")!
/** The receiving row after the move; the fixture wrote t2, so the lookup cannot miss. */
        const t2 = after.tasks.find((task: ProbeTask) => task.id === "t2")!
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
        expect(box.read().tasks.find((task: ProbeTask) => task.id === "t4")!.inScope).toEqual(["packages/foo/src/a.ts"])
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-01: the move refuses a path the donor does not own, an unknown target, a terminal target and an ambiguous donor", async () => {
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(box.workspace, box.captain, box.member)
/** The registered move tool, whose refusals this arm enumerates. */
        const move = tools.get("agent_teams_move_path")!
/** Call the move and return its refusal message, or null when it did not refuse. */
        const attempt = async (args: Record<string, unknown>): Promise<string | null> => {
            try {
                await move.execute(args, { agent: box.captain })
                return null
            }
            catch (error) {
                // The thrown value is unknowable from a JS throw site, so the message is read through Error.
            return String((error as Error).message)
            }
        }
        expect(await attempt({ path: "packages/nobody/**", to_task: "t2" })).toContain("nothing to move")
        expect(await attempt({ path: "packages/foo/**", to_task: "t99" })).toContain("does not exist")
        expect(await attempt({ path: "packages/foo/**", from_task: "t2", to_task: "t1" })).toContain("does not declare")
        expect(await attempt({ path: "packages/foo/**", from_task: "t1", to_task: "t1" })).toContain("already owned")
        // A terminal target cannot receive a path (the move is a repair for work that can run).
        const record = box.read()
        record.tasks.find((task: ProbeTask) => task.id === "t2")!.status = "completed"
        writeFileSync(box.teamFile, JSON.stringify(record, null, 2))
        expect(await attempt({ path: "packages/foo/**", to_task: "t2" })).toContain("completed")
        // Two owners without from_task is ambiguous, and the message lists them.
        const two = box.read()
        two.tasks.find((task: ProbeTask) => task.id === "t2")!.status = "pending"
        two.tasks.find((task: ProbeTask) => task.id === "t2")!.inScope = ["packages/foo/**"]
        writeFileSync(box.teamFile, JSON.stringify(two, null, 2))
/** The refusal for a path two tasks both declare. */
        const ambiguous = await attempt({ path: "packages/foo/**", to_task: "t1" })
        expect(ambiguous).toContain("declared by 2 tasks")
        expect(ambiguous).toContain("pass from_task explicitly")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-12: rollover REFUSES while a task is non-terminal, naming the open ids", async () => {
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(box.workspace, box.captain, box.member)
/** The registered rollover tool. */
        const rollover = tools.get("agent_teams_rollover")!
        expect(rollover).toBeDefined()
/** The refusal the rollover earns while work is open. */
        let refusal = undefined
        try {
            await rollover.execute({}, { agent: box.captain })
        }
        catch (error) {
            // The thrown value is unknowable from a JS throw site, so the message is read through Error.
            refusal = String((error as Error).message)
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
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registry the real tools registered into. */
        const tools = registerTools(box.workspace, box.captain, box.member)
/** The registered rollover tool. */
        const rollover = tools.get("agent_teams_rollover")!
/** The registered status tool, which renders both wave halves. */
        const status = tools.get("agent_teams_status")!

        // Close the wave: every task terminal.
        const record = box.read()
        record.tasks.find((task: ProbeTask) => task.id === "t1")!.status = "completed"
        record.tasks.find((task: ProbeTask) => task.id === "t2")!.status = "cancelled"
        writeFileSync(box.teamFile, JSON.stringify(record, null, 2))

/** The rollover's answer for a closed wave. */
        const result = await rollover.execute({ reason: "wave 1 landed" }, { agent: box.captain })
        expect(result.rolled_over).toBe(true)
        expect(result.closed_wave).toBe("w1")
        expect(result.next_wave).toBe("w2")
        expect(result.archived_tasks).toBe(2)
        expect(result.counts).toEqual({ total: 2, completed: 1, failed: 0, cancelled: 1 })

        // The ARCHIVE RECORD carries the label, the tasks themselves and the reason.
        const archivePath = join(box.stateRoot, box.teamId, "waves", "w1.json")
        expect(existsSync(archivePath)).toBe(true)
/** The archive record the rollover wrote. */
        const archive = JSON.parse(readFileSync(archivePath, "utf8"))
        expect(archive.label).toBe("w1")
        expect(archive.team_id).toBe(box.teamId)
        expect(archive.reason).toBe("wave 1 landed")
        expect(archive.tasks.map((task: ProbeTask) => task.id)).toEqual(["t1", "t2"])
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
/** The status surface as the model would read it. */
        const rendered = status.output.render({}, snapshot)[0].text
        expect(rendered).toContain("Wave: w2")
        expect(rendered).toContain("archived: w1→2 task(s)")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})
