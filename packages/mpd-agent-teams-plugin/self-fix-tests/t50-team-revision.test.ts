// t50 — T-06 arms: the MONOTONE revision token. The token is bumped in the ONE `writeTeam` funnel
// (never at the 30 call sites), validated in the SAME shape chain as `taskSeq`, read back from the
// record, and printed beside the task states it belongs to. Each arm carries its own negative control:
// an unmoved fixture must REDDEN the assertion the decisive reading uses, so no constant can satisfy it.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { readTeamSync, teamRevisionOf, bumpTeamRevision, createTeamDir, writeTeam } from "../lib/state.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** One tool definition as the registration double captures it, keyed by its own name. */
interface ToolDefinition {
    /** The tool's registered name, which is also the map key. */
    readonly name: string
}
/** The overridable fields of a legacy team record; the token arms vary these. */
interface LegacyOverrides {
    /** A token to write by hand, so the shape chain can be armed with an invalid or preset value. */
    readonly revision?: number | string | null
    /** Overrides how many tasks the record declares, for the opening-write arm. */
    readonly taskSeq?: number
    /** Overrides the task set, empty for the opening-write arm. */
    readonly tasks?: readonly LegacyTask[]
}

/** One task of a legacy record; the write-loop and transition arms mutate two of its fields. */
interface LegacyTask {
    /** The task's id. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The task's status; not readonly because the transition arm moves it in place. */
    status: string
    /** The seat the task is assigned to. */
    readonly assignee: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
    /** The task's kind. */
    readonly kind: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed; not readonly because the write loop stamps it each round. */
    updatedAt: number
}

/** One member as a legacy record carries it. */
interface LegacyMember {
    /** The member's session id. */
    readonly id: string
    /** The member's display name. */
    readonly name: string
    /** The member's roster role. */
    readonly role: string
    /** The member's lifecycle status. */
    readonly status: string
    /** When the member joined, in epoch milliseconds. */
    readonly joinedAt: number
}

/** A team record in the shape the token arms read and mutate. */
interface LegacyRecord {
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
    /** The member rows. */
    readonly members: readonly LegacyMember[]
    /** The task set; the elements stay mutable because two arms change a field in place. */
    readonly tasks: readonly LegacyTask[]
    /** The monotone write token; absent until the funnel stamps it, and written by hand in one arm. */
    revision?: number | string | null
}

/** One task row as the status payload renders it, at the revision the payload was stamped with. */
interface StatusTask {
    /** The task's id, which the arms match on. */
    readonly id: string
    /** The task's status at that revision. */
    readonly status: string
    /** The seat the task is assigned to at that revision. */
    readonly assignee: string
}

/** The team id the record and its state directory are keyed by. */
const TEAM = "t50-revision"
/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The vendored plugin's `lib/` directory, which the census arms read. */
const LIB = join(dirname(import.meta.dir), "lib")

/** A valid legacy record: no `revision` field at all (the pre-T-06 on-disk shape). */
/** A valid legacy record: no token at all (the pre-T-06 on-disk shape). */
function legacyRecord(over: LegacyOverrides = {}): LegacyRecord {
/** The creation instant shared by every timestamp in the record. */
    const now = Date.now()
    return {
        id: TEAM,
        name: "revision probe",
        captainSessionId: "c1",
        createdAt: now,
        taskSeq: 1,
        phase: "running",
        members: [{ id: "m1", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t1",
                subject: "legacy work",
                status: "pending",
                assignee: "Senior Engineer",
                dependencies: [],
                attempt: 0,
                kind: "work",
                createdAt: now,
                updatedAt: now,
            },
        ],
        ...over,
    }
}

/** Create a fresh state root and name the record file the token arms read back. */
function fixture(): { workspace: string; stateRoot: string; teamFile: string } {
/** The temporary workspace this fixture's state root lives under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t50-"))
/** The resolved team-state root every write is keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return { workspace, stateRoot, teamFile: join(stateRoot, TEAM, "team.json") }
}

/** The token as it was actually persisted, read from disk rather than from memory. */
const diskToken = (teamFile: string): unknown => JSON.parse(readFileSync(teamFile, "utf8")).revision

/** THE assertion the decisive reading uses — hoisted so the negative control can redden IT, not a copy. */
/** THE assertion the decisive reading uses, so the negative control can redden IT rather than a copy. */
function assertMoved(previous: unknown, next: unknown): unknown {
    // The two casts are the comparison TS cannot narrow through `Number.isSafeInteger`, which is not a
    // type guard: `&&` short-circuits, so they are evaluated only once both operands ARE numbers.
    if (!(Number.isSafeInteger(previous) && Number.isSafeInteger(next) && (next as number) > (previous as number))) {
        throw new Error(`revision did not move forward: ${previous} -> ${next}`)
    }
    return next
}

test("T-06 (1/6): the FUNNEL bumps on every write and the token round-trips a record", async () => {
/** The fixture's state root and record file. */
    const { stateRoot, teamFile } = fixture()
/** The legacy record this arm round-trips through the funnel. */
    const record = legacyRecord()
    writeFileSync(teamFile, JSON.stringify(record, null, 2))

    // A legacy record carries NO token (the old on-disk shape stays readable) and reads as 0.
    expect(record.revision).toBeUndefined()
    expect(teamRevisionOf(readTeamSync(stateRoot, TEAM))).toBe(0)

    // Every write goes through `writeTeam`; each one moves the token by exactly one.
    await writeTeam(stateRoot, record)
    expect(record.revision).toBe(1)
    expect(diskToken(teamFile)).toBe(1)
/** The token as read from disk after each of the eleven writes. */
    const tokens = [diskToken(teamFile)]
    for (let i = 0; i < 10; i += 1) {
        record.tasks[0].updatedAt = Date.now()
        await writeTeam(stateRoot, record)
        tokens.push(diskToken(teamFile))
    }
    expect(tokens).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    // A COUNTER, not a clock: 10 writes inside the same millisecond still differ.
    expect(new Set(tokens).size).toBe(tokens.length)

    // READ BACK from the record itself, not from the in-memory object.
    const persisted = readTeamSync(stateRoot, TEAM)
    expect(persisted.revision).toBe(11)
    expect(teamRevisionOf(persisted)).toBe(11)

    // MONOTONE across a write that carries a real state change: the transition is visible on the
    // record AND on the token that stamps it.
    const before = readTeamSync(stateRoot, TEAM).revision
    record.tasks[0].status = "claimed"
    await writeTeam(stateRoot, record)
/** The record as persisted after one real task transition. */
    const after = readTeamSync(stateRoot, TEAM)
    assertMoved(before, after.revision)
    expect(after.tasks[0].status).toBe("claimed")
    expect(after.revision).toBe(before + 1)

    // `bumpTeamRevision` is the single bump site and RETURNS the new value.
    expect(bumpTeamRevision(readTeamSync(stateRoot, TEAM))).toBe(after.revision + 1)
})

test("T-06 (2/6): NEGATIVE CONTROL — an unmoved fixture reddens the very assertion used above", async () => {
/** The fixture's state root and record file. */
    const { stateRoot, teamFile } = fixture()
    // The token moves on a funnel write...
    const record = legacyRecord()
    writeFileSync(teamFile, JSON.stringify(record, null, 2))
    await writeTeam(stateRoot, record)
/** The token after the first funnel write. */
    const firstMove = diskToken(teamFile)
    await writeTeam(stateRoot, record)
/** The token after the second funnel write, which must be strictly greater. */
    const moved = diskToken(teamFile)
    expect(() => assertMoved(firstMove, moved)).not.toThrow()

    // ...and an UN-BUMPED fixture — a write that does NOT go through the funnel — must REDDEN it.
    // This is the falsifiability of the decisive reading: it cannot be satisfied by any constant.
    const direct = legacyRecord({ revision: 7 })
    writeFileSync(teamFile, JSON.stringify(direct, null, 2))
/** The hand-written token that no funnel write has moved. */
    const unmoved = diskToken(teamFile)
    expect(unmoved).toBe(7)
    expect(() => assertMoved(7, unmoved)).toThrow(/did not move forward: 7 -> 7/)
    // A REGRESSION reddens too, and only a strictly greater value passes.
    expect(() => assertMoved(7, 6)).toThrow(/did not move forward/)
    expect(() => assertMoved(7, 7.5)).toThrow(/did not move forward/)
    expect(() => assertMoved(7, "8")).toThrow(/did not move forward/)
    expect(() => assertMoved(7, 8)).not.toThrow()

    // The funnel RESUMES from whatever the record carries, so a hand-written token is never reset to 1.
    const resumed = readTeamSync(stateRoot, TEAM)
    await writeTeam(stateRoot, resumed)
    expect(diskToken(teamFile)).toBe(8)
})

test("T-06 (3/6): the CENSUS — two writers and ONE funnel, so every write path is covered", () => {
/** Every `team.json` write site the census finds, by file and line. */
    const writers = []
/** How many `writeTeam(` call sites each vendored file carries. */
    const callSites = new Map()
    for (const file of readdirSync(LIB).filter((name) => name.endsWith(".ts")).sort()) {
        // `mpd-deltas.js` is the DERIVED registry: it embeds region bodies as strings, so it mirrors
        // the writers below without being one. Every OTHER match is a real write site.
        if (file === "mpd-deltas.ts") continue
/** One vendored `lib/` file's source, scanned for write sites. */
        const text = readFileSync(join(LIB, file), "utf8")
        for (const line of text.split("\n")) {
            if (line.includes("atomicWriteText(") && line.includes("team.json") && !line.trimStart().startsWith("//")) {
                writers.push(`${file}: ${line.trim()}`)
            }
        }
/** The funnel call sites found in this file, as raw matches. */
        const calls = text.match(/(?<!function )\bwriteTeam\(/gu) ?? []
        if (calls.length > 0) callSites.set(file, calls.length)
    }
    // MEASURED by t50: exactly TWO `team.json` write sites exist in the whole tree, both in
    // `lib/state.ts` — `createTeamDir` OPENS a record (all three call sites create a fresh team) and
    // `writeTeam` is the FUNNEL for every subsequent write. A THIRD writer would be a token bypass and
    // reddens here; a hand-rolled write in `members.js`/`scheduler.js`/`tools.js` cannot pass.
    expect(writers).toHaveLength(2)
    expect(writers.every((line) => line.startsWith("state.ts"))).toBe(true)
    expect(writers.filter((line) => line.includes("stateRoot")).length).toBeGreaterThanOrEqual(1)
    // MANY call sites: this is WHY the bump cannot live at the call sites — a token bumped at N sites
    // leaves the rest silently stale. Census MEASURED at t50 (call sites, not definition lines):
    // members 3 / scheduler 6 / tools 20 = 29, plus the ONE funnel definition in state.js. The
    // inherited "state.js 1" was the DEFINITION, corrected here by measurement.
    const total = [...callSites.values()].reduce((sum, count) => sum + count, 0)
    expect(total).toBeGreaterThanOrEqual(20)
    expect([...callSites.keys()].every((file) => ["members.ts", "scheduler.ts", "tools.ts", "state.ts"].includes(file))).toBe(true)
    console.log(`[T-06] writeTeam call sites: ${[...callSites.entries()].map(([f, n]) => `${f} ${n}`).join(" / ")} = ${total} → ${writers.length} writers (1 funnel + 1 opener), both in state.js`)
})

test("T-06 (4/6): STATUS — two reads straddling ONE task transition carry different tokens, each state stamped by its own", async () => {
/** The fixture's workspace, state root and record file. */
    const { workspace, stateRoot, teamFile } = fixture()
    writeFileSync(teamFile, JSON.stringify(legacyRecord(), null, 2))
/** The captain double the status and reassign calls run as. */
    const captain = { id: "c1", status: "idle", whenIdle: async () => {}, session: { header: { cwd: workspace } } }
/** The member double the agent registry answers with. */
    const member = { id: "m1", status: "idle", whenIdle: async () => {}, session: { header: { cwd: workspace } } }
/** The definitions the registration double captured, keyed by tool name. */
    const tools = new Map()
/** The context double the vendored registration path drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
        agents: { get: (id: string) => (id === "c1" ? captain : id === "m1" ? member : undefined), list: () => [captain, member] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => {}, on: () => {},
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
/** The registered status tool, whose payload carries the token. */
    const status = tools.get("agent_teams_status")
/** The registered reassign tool, which drives a real task transition. */
    const reassign = tools.get("agent_teams_reassign_task")

/** The status payload read before the transition. */
    const first = await status.execute({}, { agent: captain })
/** The first payload's row for t1, stamped by the token the read saw. */
    const firstState = first.tasks.find((task: StatusTask) => task.id === "t1")
    // The payload's token IS the record's token at read time (the scheduler kick inside the status
    // call writes through the funnel FIRST, so the read that follows is stamped by the write it saw),
    // and every state printed with it matches the RECORD at that token.
    const firstRecord = readTeamSync(stateRoot, TEAM)
    expect(first.revision).toBe(diskToken(teamFile))
    expect(first.revision).toBe(firstRecord.revision)
    expect(Number.isSafeInteger(first.revision)).toBe(true)
    expect(firstState.status).toBe(firstRecord.tasks[0].status)
    expect(firstState.assignee).toBe(firstRecord.tasks[0].assignee)

    // ONE real task transition, driven through the tool the captain uses.
    const exec = { agent: captain, signal: new AbortController().signal }
    await reassign.execute({ task_id: "t1", assignee: "captain", reason: "t50 transition probe" }, exec)

/** The status payload read after the transition. */
    const second = await status.execute({}, { agent: captain })
/** The second payload's row for t1, which must differ from the first. */
    const secondState = second.tasks.find((task: StatusTask) => task.id === "t1")
/** The record as persisted after the transition. */
    const secondRecord = readTeamSync(stateRoot, TEAM)
    // STRICTLY greater, and the record agrees with the number the payload printed.
    assertMoved(first.revision, second.revision)
    expect(second.revision).toBe(diskToken(teamFile))
    expect(second.revision).toBe(secondRecord.revision)
    expect(secondState.status).toBe(secondRecord.tasks[0].status)
    expect(secondState.assignee).toBe(secondRecord.tasks[0].assignee)
    // The state printed with the FIRST token is not the state printed with the second: the transition
    // is observable, so "claimed" can never be read as if it belonged to the later revision.
    expect(firstState.assignee).not.toBe(secondState.assignee)
    expect(secondRecord.tasks[0].assignee).toBe(secondState.assignee)
    // Rendered next to the states it stamps, so a stale read is visible instead of assumed.
    const rendered = status.output.render({}, second)[0].text
    expect(rendered).toContain(`Revision: ${second.revision} (monotone; every team write moves it)`)
    expect(rendered.indexOf(`Revision: ${second.revision}`)).toBeLessThan(rendered.indexOf("Tasks ("))
})

test("T-06 (5/6): the OPENING write stamps the first token, so a fresh team is never token-less", async () => {
/** The fixture's state root and record file for the opening-write arm. */
    const { stateRoot, teamFile } = fixture()
/** A first record with no tasks, which the opener must still stamp with a token. */
    const draft = legacyRecord({ taskSeq: 0, tasks: [] })
    // The OTHER `team.json` writer: it opens a record, so there is no prior counter to preserve.
    await createTeamDir(stateRoot, draft)
    expect(diskToken(teamFile)).toBe(1)
    expect(readTeamSync(stateRoot, TEAM).revision).toBe(1)
    // Every write after the opening one is the funnel's, continuing from the token that opened it.
    await writeTeam(stateRoot, readTeamSync(stateRoot, TEAM))
    expect(diskToken(teamFile)).toBe(2)
    assertMoved(1, diskToken(teamFile))
})

test("T-06 (6/6): the SHAPE CHAIN — the token is validated like `taskSeq`, and a legacy record stays readable", () => {
/** The fixture's state root and record file for the shape chain. */
    const { stateRoot, teamFile } = fixture()
    // Legacy: no token at all → accepted, reads as 0.
    writeFileSync(teamFile, JSON.stringify(legacyRecord(), null, 2))
    expect(teamRevisionOf(readTeamSync(stateRoot, TEAM))).toBe(0)
    for (const bad of [-1, 1.5, "3", null, Number.MAX_SAFE_INTEGER + 2]) {
        writeFileSync(teamFile, JSON.stringify(legacyRecord({ revision: bad }), null, 2))
        expect(() => readTeamSync(stateRoot, TEAM)).toThrow(/invalid AgentTeams state/)
    }
    // 0 and a large-but-safe integer are both legal.
    for (const good of [0, 1, 9007199254740991]) {
        writeFileSync(teamFile, JSON.stringify(legacyRecord({ revision: good }), null, 2))
        expect(readTeamSync(stateRoot, TEAM).revision).toBe(good)
    }
})
