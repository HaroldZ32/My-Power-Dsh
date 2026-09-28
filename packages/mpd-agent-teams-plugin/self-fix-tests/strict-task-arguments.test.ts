// T-61 (wave 2, lane A) — `agent_teams_update_task` SILENTLY IGNORED unknown argument names.
//
// MEASURED (wave 1, `t35`'s post-completion note, `evidence/wave1-integration/20260917T052400Z/
// POST-COMPLETION-append-channel-unreachable.md`): `agent_teams_update_task(..., output_append="…")`
// returned success — "the call reported APPLIED" — while the stored summary stayed byte-identical
// and NOTHING was appended. The ignored key was a REPAIR CHANNEL, so the failure mode was a false
// green on the one path meant to fix an unrecoverable record. The same class covers the snake_case
// twins of the structured payload (`acceptance_results` / `commands_run`).
//
// ROOT CAUSE (read from the adopted dependency, not guessed): `defineTool` compiles the flat
// parameter map with NO `additionalProperties:false`
// (`_deps/dsh-tools/lib/index.js`, `parameterSchemaSpecToJsonSchema`), so an unknown key passes
// validation and `execute` never reads it.
//
// THE FIX (`lib/tools.js`, symbols `assertKnownToolArguments` + `UPDATE_TASK_ARGUMENT_NAMES`,
// called as the FIRST statement of that tool's `execute`): an unknown key is REFUSED loudly,
// naming every offending key and the declared set, before the caller is resolved and before any
// lock or write.
//
// The arm carries its own falsification: the LAST case re-runs the same call against a scratch
// copy of `lib/` with the guard call removed and asserts the PRE-FIX behaviour (success + nothing
// stored) is reproduced there. A structural absence test cannot go red; this can.
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { UPDATE_TASK_ARGUMENT_NAMES, registerAgentTeamsTools } from "../lib/tools.js"

/** One live-agent double the tools registry answers with. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status; the member is parked as busy before registering. */
    status: string
    /** The session header carrying the workspace the state root resolves from. */
    readonly session: { readonly header: { readonly cwd: string } }
}

/** One tool definition as the registration double captures it. */
interface ToolDefinition {
    /** The tool's registered name, which is also the map key. */
    readonly name: string
    /** The compiled argument schema, whose keys the drift pin compares with the declared list. */
    readonly parameters: { readonly properties: Record<string, unknown> }
    /**
     * Run one call against the registry.
     *
     * @param args - the tool arguments the arm supplies.
     * @param exec - the execution context, carrying the seat the call runs as.
     * @returns the decoded tool result.
     */
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<ToolResult>
}

/** One tool result as this file's arms read it. */
interface ToolResult {
    /** The id of the task the call touched. */
    readonly task_id: string
    /** The stored output after the call. */
    readonly output: string
}

/** One task as the fixture writes it. */
interface ProbeTask {
    /** The task's id. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The task's status. */
    readonly status: string
    /** The seat the task is assigned to. */
    readonly assignee: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** How many attempts the task has had. */
    readonly attempt: number
    /** The current attempt id. */
    readonly attemptId?: string
    /** When the task was created, in epoch milliseconds. */
    readonly createdAt: number
    /** When the task last changed; a write path ticks it. */
    updatedAt: number
    /** The task's kind. */
    readonly kind: string
    /** The task's objective text. */
    readonly objective?: string
    /** The write scope the task declares. */
    readonly inScope?: readonly string[]
    /** The criteria the task must satisfy. */
    readonly acceptance?: readonly string[]
    /** The commands the task must run. */
    readonly verify?: readonly string[]
    /** The stored deliverable the append channel extends. */
    output?: string
    /** The paths the call declares as changed. */
    readonly changedPaths?: readonly string[]
    /** The acceptance results recorded so far, absent until one is written. */
    readonly acceptanceResults?: readonly unknown[]
}

/** One team record as the fixture writes it and the arms re-read it. */
interface ProbeRecord {
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
    readonly members: readonly unknown[]
    /** The task set under test. */
    readonly tasks: readonly ProbeTask[]
}

/** The fixture's roots, both seats and the record file. */
interface Fixture {
    /** The temporary workspace the fixture team lives in. */
    readonly workspace: string
    /** The resolved team-state root the tools are keyed by. */
    readonly stateRoot: string
    /** The captain double. */
    readonly captain: AgentLike
    /** The member double, parked busy so the post-lock kick declines. */
    readonly member: AgentLike
    /** The `team.json` path the byte-identity arms compare. */
    readonly teamFile: string
}

/** The context double and the registry one registration call produces. */
interface Registration {
    /** The definitions the registration double captured, keyed by tool name. */
    readonly tools: Map<string, ToolDefinition>
    /** The context double the vendored registration path drives. */
    readonly ctx: Record<string, unknown>
}

/** The probe tool the stale-schema control builds, with its schema-driven execute seam. */
interface ProbeTool {
    /**
     * Run one probe call.
     *
     * @param args - the arguments the caller supplies.
     * @param exec - the execution context, unused by the probe.
     * @returns the probe's decoded result.
     */
    execute(args: Record<string, unknown>, exec: Record<string, unknown>): Promise<{ readonly task_id: string; readonly output: string }>
}

/** The in-memory store a probe models a process's loaded module revision with. */
interface StoredOutput {
    /** The stored output the probe's handler extends when its schema declares the key. */
    output: string
}

/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The team id the fixture writes and the tools are keyed by. */
const TEAM_ID = "strict-args-probe"
/** The captain's session id, which owns the fixture team. */
const CAPTAIN_ID = "session-captain-strict"
/** The member's session id, the seat whose calls are driven. */
const MEMBER_ID = "session-member-strict"
/** The vendored plugin's `lib/` directory, which the negative control copies. */
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
/** The vendored `_deps/` closure the scratch copy symlinks, so the copied lib resolves. */
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")

/** One team record with a single task holding a stored deliverable. */
function record(status: string = "in_progress"): ProbeRecord {
/** The instant every timestamp in the fixture record is stamped with. */
    const now = Date.now()
    return {
        id: TEAM_ID,
        name: "strict argument probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        taskSeq: 1,
        phase: "running",
        members: [{ id: MEMBER_ID, name: "Architect", role: "worker", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t1",
                subject: "hold the deliverable",
                status,
                assignee: "Architect",
                dependencies: [],
                attempt: 1,
                attemptId: "att-1",
                createdAt: now,
                updatedAt: now,
                kind: "implementation",
                objective: "carry the payload",
                inScope: ["evidence/**"],
                acceptance: ["nothing is dropped"],
                verify: ["bun test"],
                output: "PART 1/2",
            },
        ],
    }
}

/** Write the record into a fresh workspace and return the roots plus both seats. */
function fixture(status: string = "in_progress"): Fixture {
/** The temporary workspace the fixture team lives in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t61-"))
/** The resolved team-state root the tools are keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(record(status), null, 2))
/** The captain double. */
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
/** The member double, whose calls the arms drive. */
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

/** Build the context double and the registry one registration call fills. */
function ctxFor(captain: AgentLike, member: AgentLike): Registration {
/** The definitions the registration double captures, keyed by tool name. */
    const tools = new Map()
    return {
        tools,
        ctx: {
            tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        },
    }
}

/** Register the REAL tools; the member is BUSY so the post-lock kick declines. */
function registerTools(captain: AgentLike, member: AgentLike): Map<string, ToolDefinition> {
    member.status = "busy"
/** The context double and the registry this registration filled. */
    const { ctx, tools } = ctxFor(captain, member)
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

/** The sha256 of a file's bytes, as the byte-identity arms compare it. */
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")
/** The first task of a fixture record as it stands on disk. */
const taskOf = (teamFile: string): ProbeTask => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]

test("T-61: an unknown snake_case argument name is REFUSED, named, and stores NOTHING", async () => {
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registered update tool; the registry above captured it, so the lookup cannot miss. */
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")!
/** The record's digest before the refused calls. */
        const before = sha256(box.teamFile)
/** The task as it stands before the refused calls. */
        const beforeTask = taskOf(box.teamFile)

        // The exact wave-1 shape: a repair payload whose structured keys are snake_case.
        await expect(update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", acceptance_results: [{ criterion: "x", status: "passed" }] },
            { agent: box.member },
        )).rejects.toThrow(/"acceptance_results"/)
        await expect(update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", commands_run: [{ command: "bun test", status: "passed" }] },
            { agent: box.member },
        )).rejects.toThrow(/"commands_run"/)

        // The message must teach the fix: the declared set is in it, camelCase included.
        await expect(update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", acceptance_results: [] },
            { agent: box.member },
        )).rejects.toThrow(/acceptanceResults/)
        // ...and say out loud that nothing was stored.
        await expect(update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", acceptance_results: [] },
            { agent: box.member },
        )).rejects.toThrow(/REFUSED and NOTHING was stored/)

        // Severity that matters: the refusal fires BEFORE any write.
        expect(sha256(box.teamFile), "the fixture record changed on a refused call").toBe(before)
        expect(taskOf(box.teamFile)).toEqual(beforeTask)
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-61 control: every DECLARED argument name still works (a guard that refuses everything is red)", async () => {
/** The workspace this arm drives. */
    const box = fixture()
    try {
/** The registered update tool; the registry above captured it, so the lookup cannot miss. */
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")!
/** The call's result for a payload using only DECLARED names. */
        const result = await update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", output_append: " + PART 2/2", changedPaths: ["evidence/probe.md"] },
            { agent: box.member },
        )
        expect(result.task_id).toBe("t1")
/** The task as it stands after the accepted call. */
        const task = taskOf(box.teamFile)
        // The `!` is the fixture's own guarantee: the record above was written with a stored output.
        expect(task.output!.startsWith("PART 1/2")).toBe(true)
        expect(task.output).toContain("PART 2/2")
        expect(task.changedPaths).toEqual(["evidence/probe.md"])
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-61 drift pin: the declared-name list EQUALS the registered tool's compiled schema keys", () => {
    // The guard compares against a literal list; this pin is what keeps the literal honest: a
    // parameter added to the tool without extending UPDATE_TASK_ARGUMENT_NAMES reddens HERE
    // instead of silently disabling the check for that key.
    const box = fixture()
    try {
/** The registered update tool, whose compiled schema is the drift subject. */
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")!
/** The tool's compiled schema keys, which the declared list must equal. */
        const schemaKeys = Object.keys(update.parameters.properties ?? {}).sort()
        expect(schemaKeys).toEqual([...UPDATE_TASK_ARGUMENT_NAMES].sort())
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-61 negative control: with the guard call removed, the SAME payload succeeds and stores nothing", async () => {
/** The workspace this arm drives. */
    const box = fixture()
/** The scratch root the pre-fix copy is materialized under. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t61-prefix-"))
    try {
        // A scratch copy of the module tree with the guard call stripped — the pre-fix call path.
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")
/** The scratch copy of the tool module the guard call is stripped from. */
        const copyPath = join(scratch, "lib", "tools.js")
/** The copy's bytes before the guard call is removed. */
        const original = readFileSync(copyPath, "utf8")
/** The exact guard-call text, which must occur exactly once. */
        const guardCall = "            assertKnownToolArguments('agent_teams_update_task', UPDATE_TASK_ARGUMENT_NAMES, args);\n"
/** How many times the guard call occurs in the copy. */
        const occurrences = original.split(guardCall).length - 1
        expect(occurrences, "the guard call was not found in the scratch copy — the control would test the FIXED code").toBe(1)
/** The copy with the guard call removed, which must differ from the original. */
        const mutated = original.replace(guardCall, "")
        expect(mutated).not.toBe(original)
        writeFileSync(copyPath, mutated)

/** The neutralised copy, imported so the SAME payload runs against pre-fix code. */
        const preFix = await import(pathToFileURL(copyPath).href)
/** The context double and the registry the neutralised registration fills. */
        const { ctx, tools } = ctxFor(box.captain, box.member)
        box.member.status = "busy"
        preFix.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
/** The update tool as the PRE-FIX module registered it. */
        const update = tools.get("agent_teams_update_task")!
/** The record's digest before the pre-fix call. */
        const before = sha256(box.teamFile)
/** The task as it stands before the pre-fix call. */
        const beforeTask = taskOf(box.teamFile)

        // PRE-FIX BEHAVIOUR, reproduced: the call SUCCEEDS and stores nothing.
        const result = await update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", acceptance_results: [{ criterion: "x", status: "passed" }] },
            { agent: box.member },
        )
        expect(result.task_id, "the pre-fix path did not even succeed — the control is not reproducing the defect").toBe("t1")
        // PRE-FIX BEHAVIOUR, exactly: the call returns success, the STORED CONTENT is untouched
        // (no acceptanceResults, same output, same status) — only the write path's own
        // `updatedAt` tick moves, which is precisely what made the false green look like a real
        // update. Byte-identity is the reward of the FIXED path (asserted in the first case).
/** Blank the write path's own clock tick, so only the stored CONTENT is compared. */
        const strip = (task: ProbeTask): ProbeTask => ({ ...task, updatedAt: 0 })
        expect(strip(taskOf(box.teamFile)), "the pre-fix call must store nothing").toEqual(strip(beforeTask))
        expect(taskOf(box.teamFile).acceptanceResults ?? []).toEqual([])
        expect(taskOf(box.teamFile).output).toBe("PART 1/2")
        expect(taskOf(box.teamFile).status).toBe("in_progress")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
        rmSync(scratch, { recursive: true, force: true })
    }
})

// ---------- the APPEND CHANNEL: both readings, because the wave measured both ----------
//
// The captain's instruction on this arm (t8 contract revision 4) is explicit: the arm must carry BOTH
// readings and must NOT claim the channel was ever absent.
//
//   (i) WAVE 1'S FALSE GREEN — `evidence/wave1-integration/20260917T052400Z/
//       POST-COMPLETION-append-channel-unreachable.md` (t35): `output_append` returned success and
//       stored NOTHING. Diagnosed by the captain in the nested correction
//       `correction-20260917T054822Z-append-channel-restart-blocked.md` as **T-21, NOT a missing
//       feature**: the module declaring the key was written 05:42:47Z while the process serving that
//       session started 04:06:39Z, so the live process had registered the PRE-CHANNEL schema, and an
//       unknown argument was tolerated and dropped. The correction's own falsification criterion:
//       (1) after a restart the schema carries the key, (2) an append on a TERMINAL task GROWS the
//       stored bytes with the old value a byte-prefix.
//   (ii) TODAY'S VERIFIED APPEND — the requirements seat's `output_append` on the terminal `t4`
//       returned success AND the text is in the stored output (read-back confirmed;
//       `.mpd/plans/friction-p2-wave-captain-log.md`, the paragraph following A-4).
//
// Both criteria are measured IN-PROCESS below: (ii) against the real registered tool, (i) as the
// SCHEMA mechanism it actually was — a definition whose parameter map lacks the key — with the
// two-sided control proving the mechanism is the schema, not the caller.

test("T-61 append channel (ii): the registered schema carries the key and a TERMINAL append GROWS the bytes", async () => {
/** The workspace this arm drives, whose task is already terminal. */
    const box = fixture("completed")
    try {
/** The registered update tool; the registry above captured it, so the lookup cannot miss. */
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")!
        // The correction's criterion (1): the key IS declared by the tool this test registers.
        expect(Object.keys(update.parameters.properties ?? {})).toContain("output_append")
/** The stored output before the terminal append, which the fixture wrote. */
        const before = taskOf(box.teamFile).output!
/** The append's result on a terminal task. */
        const result = await update.execute(
            { task_id: "t1", status: "completed", attempt_id: "att-1", output_append: "CORRECTION 20260917T054822Z" },
            { agent: box.member },
        )
/** The stored output after the append, which must have GROWN; the fixture wrote one. */
        const after = taskOf(box.teamFile).output!
        // The correction's criterion (2): the stored bytes GROW and the old value stays a PREFIX.
        expect(after.length).toBeGreaterThan(before.length)
        expect(after.startsWith(before)).toBe(true)
        expect(after).toContain("CORRECTION 20260917T054822Z")
        expect(result.output).toBe(after)
        expect(taskOf(box.teamFile).status).toBe("completed")
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-61 append channel (i): the wave-1 shape is a STALE-SCHEMA drop — success returned, nothing stored", async () => {
/** The adopted tool factory, imported dynamically so the file still links without it. */
    // A dynamic import cannot be covered by a directive above the statement, so the reason sits here:
    // @ts-expect-error TS7016: the vendored _deps JS module has no declaration file.
    const { defineTool } = await import("../_deps/dsh-tools/lib/index.js")
    // `declaresAppend` models the MODULE REVISION the process had loaded: T-52's channel exists in
    // the tree today (and is independently reviewed), so what wave 1 met is the process-side half —
    // a registered schema that does not declare the key, whose handler therefore never consults it.
/** Build a probe tool whose schema either declares the append key or does not. */
    const probe = (declaresAppend: boolean): { tool: ProbeTool; stored: StoredOutput } => {
/** The in-memory store the probe's handler writes to. */
        const stored = { output: "PART 1/2" }
/** The probe tool, registered with the schema variant this arm asks for. */
        const tool = defineTool({
            name: "probe_update_task_prechannel",
            description: "probe: the schema a process registered BEFORE the append channel existed",
            parameters: declaresAppend
                ? { task_id: { type: "string", required: true }, output_append: { type: "string" } }
                : { task_id: { type: "string", required: true } },
            output: {
                schema: { type: "object", additionalProperties: false, properties: { task_id: { type: "string", required: true }, output: { type: "string" } } },
                render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) }],
            },
            // The adopted handler reads ONLY what its schema declares; an undeclared key is never
            // consulted (which is why tolerating it is a silent drop rather than an error).
            execute: async (args: Record<string, unknown>) => {
                if (declaresAppend && typeof args.output_append === "string")
                    stored.output = `${stored.output}\n\n${args.output_append}`
                return { task_id: args.task_id, output: stored.output }
            },
        })
        return { tool, stored }
    }

    // (a) THE PRE-CHANNEL SCHEMA (what the wave-1 process had registered): the call SUCCEEDS — the
    // adopted validator tolerates an undeclared key — and stores NOTHING. Reproduced here WITHOUT
    // claiming the channel was absent: the code declares it (the case above registers the real tool
    // and reads the key out of its compiled schema), and the wave-1 verdict is T-21.
    const stale = probe(false)
/** The pre-channel schema's answer: success, with nothing appended. */
    const staleReturned = await stale.tool.execute({ task_id: "t1", output_append: "CORRECTION" }, {})
    expect(staleReturned.task_id).toBe("t1")
    expect(staleReturned.output).toBe("PART 1/2")
    expect(stale.stored.output).toBe("PART 1/2")

    // (b) THE SAME CALLER, THE SAME CALL, the schema that DOES declare the key: the append LANDS.
    // This is the two-sided control: the mechanism is the REGISTERED SCHEMA, not the caller and not
    // a missing feature — so reading (i) must never be reported as "the channel was absent".
    const current = probe(true)
/** The declaring schema's answer: the same call, with the append landed. */
    const currentReturned = await current.tool.execute({ task_id: "t1", output_append: "CORRECTION" }, {})
    expect(currentReturned.output).toBe("PART 1/2\n\nCORRECTION")
    expect(current.stored.output.startsWith("PART 1/2")).toBe(true)

    // (c) And the very premise of reading (i) is now LOUD instead of silent: an undeclared key on
    // the REAL tool is refused by name (the case at the top of this file), so a future process that
    // registered a pre-channel schema cannot answer APPLIED for a payload it will not store.
})
