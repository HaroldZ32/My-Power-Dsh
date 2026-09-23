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
import { UPDATE_TASK_ARGUMENT_NAMES, registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "strict-args-probe"
const CAPTAIN_ID = "session-captain-strict"
const MEMBER_ID = "session-member-strict"
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib")
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "_deps")

function record(status = "in_progress") {
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

function fixture(status = "in_progress") {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t61-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(record(status), null, 2))
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

function ctxFor(captain, member) {
    const tools = new Map()
    return {
        tools,
        ctx: {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        },
    }
}

/** Register the REAL tools; the member is BUSY so the post-lock kick declines. */
function registerTools(captain, member) {
    member.status = "busy"
    const { ctx, tools } = ctxFor(captain, member)
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const taskOf = (teamFile) => JSON.parse(readFileSync(teamFile, "utf8")).tasks[0]

test("T-61: an unknown snake_case argument name is REFUSED, named, and stores NOTHING", async () => {
    const box = fixture()
    try {
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")
        const before = sha256(box.teamFile)
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
    const box = fixture()
    try {
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")
        const result = await update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: "att-1", output_append: " + PART 2/2", changedPaths: ["evidence/probe.md"] },
            { agent: box.member },
        )
        expect(result.task_id).toBe("t1")
        const task = taskOf(box.teamFile)
        expect(task.output.startsWith("PART 1/2")).toBe(true)
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
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")
        const schemaKeys = Object.keys(update.parameters.properties ?? {}).sort()
        expect(schemaKeys).toEqual([...UPDATE_TASK_ARGUMENT_NAMES].sort())
    }
    finally {
        rmSync(box.workspace, { recursive: true, force: true })
    }
})

test("T-61 negative control: with the guard call removed, the SAME payload succeeds and stores nothing", async () => {
    const box = fixture()
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t61-prefix-"))
    try {
        // A scratch copy of the module tree with the guard call stripped — the pre-fix call path.
        cpSync(LIB_DIR, join(scratch, "lib"), { recursive: true })
        symlinkSync(DEPS_DIR, join(scratch, "_deps"), "junction")
        const copyPath = join(scratch, "lib", "tools.js")
        const original = readFileSync(copyPath, "utf8")
        const guardCall = "            assertKnownToolArguments('agent_teams_update_task', UPDATE_TASK_ARGUMENT_NAMES, args);\n"
        const occurrences = original.split(guardCall).length - 1
        expect(occurrences, "the guard call was not found in the scratch copy — the control would test the FIXED code").toBe(1)
        const mutated = original.replace(guardCall, "")
        expect(mutated).not.toBe(original)
        writeFileSync(copyPath, mutated)

        const preFix = await import(pathToFileURL(copyPath).href)
        const { ctx, tools } = ctxFor(box.captain, box.member)
        box.member.status = "busy"
        preFix.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const update = tools.get("agent_teams_update_task")
        const before = sha256(box.teamFile)
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
        const strip = (task) => ({ ...task, updatedAt: 0 })
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
    const box = fixture("completed")
    try {
        const update = registerTools(box.captain, box.member).get("agent_teams_update_task")
        // The correction's criterion (1): the key IS declared by the tool this test registers.
        expect(Object.keys(update.parameters.properties ?? {})).toContain("output_append")
        const before = taskOf(box.teamFile).output
        const result = await update.execute(
            { task_id: "t1", status: "completed", attempt_id: "att-1", output_append: "CORRECTION 20260917T054822Z" },
            { agent: box.member },
        )
        const after = taskOf(box.teamFile).output
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
    const { defineTool } = await import("../_deps/dsh-tools/lib/index.js")
    // `declaresAppend` models the MODULE REVISION the process had loaded: T-52's channel exists in
    // the tree today (and is independently reviewed), so what wave 1 met is the process-side half —
    // a registered schema that does not declare the key, whose handler therefore never consults it.
    const probe = (declaresAppend) => {
        const stored = { output: "PART 1/2" }
        const tool = defineTool({
            name: "probe_update_task_prechannel",
            description: "probe: the schema a process registered BEFORE the append channel existed",
            parameters: declaresAppend
                ? { task_id: { type: "string", required: true }, output_append: { type: "string" } }
                : { task_id: { type: "string", required: true } },
            output: {
                schema: { type: "object", additionalProperties: false, properties: { task_id: { type: "string", required: true }, output: { type: "string" } } },
                render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
            },
            // The adopted handler reads ONLY what its schema declares; an undeclared key is never
            // consulted (which is why tolerating it is a silent drop rather than an error).
            execute: async (args) => {
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
    const staleReturned = await stale.tool.execute({ task_id: "t1", output_append: "CORRECTION" }, {})
    expect(staleReturned.task_id).toBe("t1")
    expect(staleReturned.output).toBe("PART 1/2")
    expect(stale.stored.output).toBe("PART 1/2")

    // (b) THE SAME CALLER, THE SAME CALL, the schema that DOES declare the key: the append LANDS.
    // This is the two-sided control: the mechanism is the REGISTERED SCHEMA, not the caller and not
    // a missing feature — so reading (i) must never be reported as "the channel was absent".
    const current = probe(true)
    const currentReturned = await current.tool.execute({ task_id: "t1", output_append: "CORRECTION" }, {})
    expect(currentReturned.output).toBe("PART 1/2\n\nCORRECTION")
    expect(current.stored.output.startsWith("PART 1/2")).toBe(true)

    // (c) And the very premise of reading (i) is now LOUD instead of silent: an undeclared key on
    // the REAL tool is refused by name (the case at the top of this file), so a future process that
    // registered a pre-channel schema cannot answer APPLIED for a payload it will not store.
})
