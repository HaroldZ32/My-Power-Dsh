// Wave-1 (t9, lane B1) self-fix tests — three boundaries of the adopted plugin:
//
//   D2  — a hold stops NEW DISPATCH only. The two TOOL-BOUNDARY hold guards that used to
//         refuse `claim_task` / `update_task` on a held team are DELETED from the adopted
//         `lib/tools.js`, and tools.js's copy of the `watchdog-hold-reader` region went with
//         them (dead code once its two call sites were gone). `lib/scheduler.js` KEEPS its
//         own copy of the same region id — that is the half that still holds (dispatch).
//   T-49 — `agent_teams_task_contract` is a MEMBER tool. The deny is computed in TWO places
//         (the `CAPTAIN_TOOL_NAMES` constant in tool-names.js, spread into the spawn
//         `toolFilter` in members.js; and the same filter recomputed in capabilities.js) and
//         both must stop denying it.
//   T-19 — `agent_teams_status` names ONE pause mechanism (`agent_teams_halt`); the team
//         watchdog's PRESERVING hold is reported as its INTERNAL implementation, read for
//         DISPLAY through the watchdog's own service (fail-open, gates nothing); it adds no
//         resume verb. REQUALIFIED by wave 2 (t21) from the wave-1 two-peer pin, which the
//         user's T-19 ruling abolished — the peer wording is now asserted ABSENT (drift guard).
//
// Falsifiability: the hold is injected through the REAL reader shape (`ctx.get('mpdWatchdog',
// false)` → `isHeld(teamId, workspace)`) so the same stub is a WORKING hold. The
// re-injection control lane below re-adds the deleted guard to a scratch copy of the module
// and asserts the very same call now FAILS — the success assertion cannot pass vacuously.
import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
import { registerAgentTeamsTools } from "../lib/tools.js"
// T-92 (t43): absence is asserted against the subject's COMMENT-STRIPPED text, so a comment may
// name an identifier without reddening the pin; presence pins keep the raw text.
import { codeOf } from "./lib-absence.ts"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { installTeamCapabilities } from "../lib/capabilities.js"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { spawnMember } from "../lib/members.js"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { CAPTAIN_TOOL_NAMES, MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from "../lib/tool-names.js"
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { MPD_DELTAS } from "../lib/mpd-deltas.js"

/** One live-agent double the registry and the captain argument are built from. */
interface AgentLike {
    /** The agent's session id, which the registry lookup matches on. */
    readonly id: string
    /** The agent's lifecycle status. */
    status: string
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
     * @returns the decoded tool result.
     */
    execute(args: Record<string, unknown>, exec: { readonly agent: unknown }): Promise<ToolResult>
    /** The tool's own renderer, which the status surface is read through. */
    readonly output: { render(args: Record<string, unknown>, value: unknown): readonly { readonly text: string }[] }
}

/** One decoded tool result, with the pause section the status-surface arms read. */
interface ToolResult {
    /** The task status a claim or update call reports. */
    readonly status: string
    /** The seat a claim landed on. */
    readonly assignee: string
    /** The attempt id the call reports, which a claim mints. */
    readonly attempt_id: string
    /** The id of the task a call touched. */
    readonly task_id: string
    /** Whether the team is halted, as the status payload reports. */
    halted: boolean
    /** The one pause mechanism the status payload names, with its implementation fields. */
    readonly pause: {
        /** The mechanism the surface names for the pause. */
        readonly mechanism: string
        /** Whether that mechanism is currently active. */
        readonly active: boolean
        /** Whether the team-level halt is set; false while the pause comes from the hold. */
        readonly halt: boolean
        /** The implementation behind the named mechanism. */
        readonly internal_implementation: {
            /** The hold mechanism's kind. */
            readonly kind: string
            /** The hold's id. */
            readonly hold_id: string
            /** The action that releases the hold. */
            readonly released_by: string
        }
    }
}

/** One hold read the watchdog double recorded, with the frame that took it. */
interface IsHeldCall {
    /** The team id the reader asked about. */
    readonly teamId: string
    /** The workspace the reader asked about. */
    readonly ws: string
    /** The stack frame that took the read, so a tool-boundary gate shows up as its own caller. */
    readonly frame: string
}

/** The watchdog double the context's `get` answers with. */
interface Watchdog {
    /**
     * Report the hold view for one team.
     *
     * @param teamId - the team id the caller asks about.
     * @param ws - the workspace the caller asks about.
     * @returns the hold view for the fixture team, undefined for any other.
     */
    isHeld(teamId: string, ws: string): unknown
}

/** The registration's three outputs. */
interface Registration {
    /** The definitions the registration double captured, keyed by tool name. */
    readonly tools: Map<string, ToolDefinition>
    /** The watchdog double the context answers with. */
    readonly watchdog: Watchdog
    /** Every hold read the watchdog double recorded. */
    readonly isHeldCalls: IsHeldCall[]
}

/** The fixture's roots, both seats and the record file. */
interface Fixture {
    /** The temporary workspace the fixture team lives in. */
    readonly workspace: string
    /** The resolved team-state root the tools are keyed by. */
    readonly stateRoot: string
    /** The captain double, who leads the fixture team. */
    readonly captain: AgentLike
    /** The member double, the seat every call runs as. */
    readonly member: AgentLike
    /** The `team.json` path the arms read back. */
    readonly teamFile: string
}

/** One registered mpd delta region as the derived registry reports it. */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** The region's id, which the absence pins name. */
    readonly id: string
}

/** One spawn request the subagent double captured, with the tool filter the routing reads. */
interface CapturedSpawn {
    /** The request payload the vendored spawn path passed. */
    readonly request: { readonly toolFilter: { readonly deny?: readonly string[] } }
}

/** The vendored plugin's root directory, derived from this file's own URL. */
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
/** The vendored plugin's `lib/` directory, which the source pins read. */
const libDir = join(pluginRoot, "lib")
/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** The team id the fixture writes and the hold view is keyed by. */
const TEAM_ID = "probe-team"
/** The member seat's display name. */
const MEMBER_NAME = "Architect"
/** The member's session id, the seat every call runs as. */
const MEMBER_ID = "session-member"

/** The one hold view the stub service answers with (the shape the deleted guard consumed). */
const HOLD_VIEW = { held: true, holdId: "hold-probe-1", at: 1_700_000_000_000, reason: "silence probe", source: "service" }

/** A team record with one PENDING task assigned to a read-only member. */
/** One team record with a single claimable task the hold gates. */
function teamRecord(): Record<string, unknown> {
/** The instant every timestamp in the fixture record is stamped with. */
    const now = Date.now()
    return {
        id: TEAM_ID,
        name: "tool-boundary probe",
        captainSessionId: "session-captain",
        createdAt: now,
        taskSeq: 2,
        phase: "running",
        members: [{ id: MEMBER_ID, name: MEMBER_NAME, role: "architect", status: "idle", joinedAt: now }],
        tasks: [
            {
                id: "t1",
                subject: "the guarded task",
                status: "pending",
                assignee: MEMBER_NAME,
                dependencies: [],
                attempt: 0,
                createdAt: now,
                updatedAt: now,
                kind: "verification",
                acceptance: ["probe this"],
                verify: ["bun test"],
                acceptanceResults: [],
                commandsRun: [],
            },
        ],
    }
}

/**
 * Register the adopted tools against a stub ctx whose watchdog service reports a LIVE hold.
 * `isHeldCalls` counts how often the tool boundary consulted it (the deleted guards did; the
 * surviving scheduler does, and is driven separately by the watchdog package's own fixture).
 */
/** Register the REAL tools over a context double and return the captured seam. */
function registerTools(workspace: string, captain: AgentLike, member: AgentLike): Registration {
/** The definitions the registration double captured, keyed by tool name. */
    const tools = new Map()
/** Every hold read the watchdog double recorded, with the frame that took it. */
    const isHeldCalls: IsHeldCall[] = []
/** The watchdog double the context's `get` answers with. */
    const watchdog = {
        isHeld: (teamId: string, ws: string): unknown => {
            // WHO read the hold: the surviving dispatch half lives in scheduler.js. A tool
            // boundary that gated would appear here too — and the assertion below forbids it.
            const frame = (new Error("hold-read").stack ?? "").split("\n")[2] ?? ""
            isHeldCalls.push({ teamId, ws, frame: frame.trim() })
            return teamId === TEAM_ID ? { ...HOLD_VIEW } : undefined
        },
    }
/** The context double the vendored registration path drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined),
            list: () => [captain, member],
        },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: (name: string, _strict: unknown) => (name === "mpdWatchdog" ? watchdog : undefined),
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return { tools, watchdog, isHeldCalls }
}

/** Write the fixture record and return its roots, both seats and the record file. */
function fixture(): Fixture {
/** The temporary workspace the fixture team lives in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t9-hold-"))
/** The resolved team-state root the tools are keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
    writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(teamRecord(), null, 2))
/** The captain double, who leads the fixture team. */
    const captain = { id: "session-captain", status: "idle", session: { header: { cwd: workspace } } }
/** The member double, the seat every call runs as. */
    const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
    return { workspace, stateRoot, captain, member, teamFile: join(stateRoot, TEAM_ID, "team.json") }
}

test("D2: the two tool-boundary guards and tools.js's reader copy are gone; scheduler keeps its own", () => {
/** The vendored tool module's raw bytes. */
    const tools = readFileSync(join(libDir, "tools.js"), "utf8")
/** Its absence-pin view, so a comment naming an identifier cannot redden the pin. */
    const toolsCode = codeOf(tools)
/** The vendored scheduler module's raw bytes. */
    const scheduler = readFileSync(join(libDir, "scheduler.js"), "utf8")
    for (const id of ["mpd-delta claim-task-hold-guard", "mpd-delta update-task-hold-guard"]) {
        expect(toolsCode, `${id} must be DELETED from tools.js`).not.toContain(id)
        expect(MPD_DELTAS.filter((delta: DeltaEntry) => delta.id === id), `${id} must leave the registry`).toHaveLength(0)
    }
    expect(toolsCode).not.toContain("watchdogHoldOf")
    expect(toolsCode).not.toContain("mpd-delta watchdog-hold-reader")
    // the surviving half: the scheduler's own copy of the same id, plus its call sites
    expect(scheduler).toContain("mpd-delta watchdog-hold-reader")
    expect(scheduler).toContain("function watchdogHoldOf(ctx, teamId, workspace)")
/** The registry entries that own the hold-reader region. */
    const readerEntries = MPD_DELTAS.filter((delta: DeltaEntry) => delta.id === "mpd-delta watchdog-hold-reader")
    expect(readerEntries).toHaveLength(1)
    expect(readerEntries[0].file.endsWith("scheduler.js")).toBe(true)
    // and the T-19 render change is a registered region, not an unmarked edit
    expect(MPD_DELTAS.some((delta: DeltaEntry) => delta.id === "mpd-delta status-pause-mechanisms" && delta.file.endsWith("tools.js"))).toBe(true)
    expect(toolsCode).not.toContain("watchdog-hold-reader")
})

test("D2: with a LIVE hold present, claim_task and update_task SUCCEED (the hold no longer blocks a write)", async () => {
/** The fixture roots, both seats and the record file this arm drives. */
    const { workspace, captain, member, teamFile } = fixture()
    try {
/** The registry, the watchdog double and the hold reads it recorded. */
        const { tools, watchdog, isHeldCalls } = registerTools(workspace, captain, member)
        // the stub really is a working hold — this is the view the deleted guard consumed
        expect(watchdog.isHeld(TEAM_ID, workspace)).toEqual(HOLD_VIEW)
        isHeldCalls.length = 0 // count only the reads the tool calls themselves perform

/** The registered claim tool; the registry above captured it, so the lookup cannot miss. */
        const claim = tools.get("agent_teams_claim_task")!
/** The registered update tool. */
        const update = tools.get("agent_teams_update_task")!
        expect(isHeldCalls, "the tool boundary must not read the hold before any write").toHaveLength(0)
/** The member's claim, which the hold must NOT block. */
        const claimed = await claim.execute({ task_id: "t1" }, { agent: member })
        expect(claimed.status).toBe("claimed")
        expect(claimed.assignee).toBe(MEMBER_NAME)
        expect(typeof claimed.attempt_id).toBe("string")

/** The member's update, which the hold must NOT block either. */
        const updated = await update.execute(
            { task_id: "t1", status: "in_progress", attempt_id: claimed.attempt_id, output: "recorded while held" },
            { agent: member },
        )
        expect(updated.status).toBe("in_progress")

        // the durable record really moved: the member could record what it finished
        const onDisk = JSON.parse(readFileSync(teamFile, "utf8"))
        expect(onDisk.tasks[0].status).toBe("in_progress")
        expect(onDisk.tasks[0].output).toBe("recorded while held")
        expect(onDisk.tasks[0].attemptId).toBe(claimed.attempt_id)
        // The live hold WAS read — but only by the surviving dispatch half: every read comes
        // from scheduler.js, i.e. the team was held and dispatched nothing, while the member's
        // own write still landed. A re-added tool-boundary guard would add a tools.js frame
        // here (and throw before this line).
        expect(isHeldCalls.length).toBeGreaterThan(0)
        for (const read of isHeldCalls)
            expect(read.frame, `hold read from an unexpected frame: ${read.frame}`).toContain("scheduler.js")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("D2 NEGATIVE CONTROL: the deleted guard re-injected into a scratch copy makes the same call FAIL", async () => {
/** The fixture roots and both seats this arm drives. */
    const { workspace, captain, member } = fixture()
/** The scratch root the guard is re-injected into. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t9-reinject-"))
    try {
        mkdirSync(join(scratch, "lib"), { recursive: true })
        for (const entry of readdirSync(libDir, { withFileTypes: true }))
            if (entry.isFile())
                cpSync(join(libDir, entry.name), join(scratch, "lib", entry.name))
        // the adopted modules import the vendored closure through `../_deps/...`
        symlinkSync(join(pluginRoot, "_deps"), join(scratch, "_deps"), "junction")
/** The scratch copy of the tool module the guard is injected into. */
        const scratchTools = join(scratch, "lib", "tools.js")
/** The copy's bytes before the injection. */
        const source = readFileSync(scratchTools, "utf8")
/** Offset of the claim tool's registration, which the guard is injected after. */
        const registration = source.indexOf("name: 'agent_teams_claim_task'")
/** Offset just past that tool's `execute` opening, where the guard lands. */
        const execute = source.indexOf("async execute(args, exec) {", registration)
        expect(registration).toBeGreaterThan(-1)
        expect(execute).toBeGreaterThan(-1)
        // the exact guard shape wave-1 deleted: consult the watchdog, refuse loudly, write nothing
        const guard = "\n            { const __held = watchdogHoldOf(ctx, freshTeamProbeId, workspaceOf(exec.agent)); if (__held !== undefined) throw new Error(`team ${freshTeamProbeId} is held by the team watchdog (hold ${__held.holdId}); the team must be released with the watchdog's own session-watchdog-resume action before any further work`); }"
/** The copy with the old boundary guard re-injected. */
        const injected = source.slice(0, execute + "async execute(args, exec) {".length) + guard + source.slice(execute + "async execute(args, exec) {".length)
        // `watchdogHoldOf` + a team id must exist for the injected shape to be faithful
        const reader = "const WATCHDOG_HOLD_SERVICE = 'mpdWatchdog';\nfunction watchdogHoldOf(ctx, teamId, workspace) {\n    try {\n        const watchdog = typeof ctx?.get === 'function' ? ctx.get(WATCHDOG_HOLD_SERVICE, false) : undefined;\n        const view = typeof watchdog?.isHeld === 'function' ? watchdog.isHeld(teamId, workspace) : undefined;\n        if (view === undefined || view === null || view.held !== true)\n            return undefined;\n        return { holdId: String(view.holdId ?? ''), at: 0, reason: String(view.reason ?? ''), source: null };\n    }\n    catch {\n        return undefined;\n    }\n}\nconst freshTeamProbeId = 'probe-team';\n"
        writeFileSync(scratchTools, reader + injected)

/** The scratch module's registration entry, imported with a cache-busting query. */
        const { registerAgentTeamsTools: registerScratch } = await import(pathToFileURL(scratchTools).href + "?reinject=1")
/** The definitions the scratch registration captured. */
        const scratchToolsMap = new Map()
/** The context double the scratch registration drives. */
        const ctx = {
            tools: { register: (definition: ToolDefinition) => { scratchToolsMap.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: (name: string, _strict: unknown) => (name === "mpdWatchdog" ? { isHeld: () => ({ ...HOLD_VIEW }) } : undefined),
        }
        registerScratch(ctx, { stateDir: STATE_DIR })
        await expect(scratchToolsMap.get("agent_teams_claim_task")!!.execute({ task_id: "t1" }, { agent: member }))
            .rejects.toThrow(/held by the team watchdog/)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
        rmSync(scratch, { recursive: true, force: true })
    }
})

test("T-49: the contract tool is a MEMBER tool in BOTH deny computations", async () => {
    // (1) the constant pair the spawn payload and the runtime restriction derive from
    expect(TEAM_TOOL_NAMES).toContain("agent_teams_task_contract")
    expect(MEMBER_TOOL_NAMES).toContain("agent_teams_task_contract")
    expect(CAPTAIN_TOOL_NAMES).not.toContain("agent_teams_task_contract")

    // (2) the SPAWN payload: the real spawnMember spreads CAPTAIN_TOOL_NAMES into toolFilter.deny
    const captured: CapturedSpawn[] = []
/** The captain double the spawn path runs as. */
    const captain = { id: "session-captain", status: "idle", session: { header: { cwd: tmpdir() } } }
/** The context double the vendored spawn path drives. */
    const spawnCtx = {
        subagents: {
            getProvider: (name: string) => ({ prepareContinuable: () => undefined, capabilities: { persona: true, toolFilter: true } }),
            list: () => ["subagent-spawn"],
            startContinuable: async (request: CapturedSpawn) => { captured.push(request); return { childId: "child-1" } },
        },
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
/** The selection seam the spawn path resolves its member route through. */
    const selections = { withPending: async (_id: string, _label: string, _selection: unknown, build: () => unknown) => build() }
/** The real HOME, restored in `finally` so the sandbox never leaks into another file. */
    const oldHome = process.env.HOME
    process.env.HOME = mkdtempSync(join(tmpdir(), "mpd-t9-home-"))
    try {
/** The read-only member the spawn payload is asserted against. */
        const member = { id: "", name: MEMBER_NAME, role: "architect", toolDeny: ["write", "edit", "bash"] }
        await spawnMember(spawnCtx, { provider: "subagent-spawn" }, selections, { provider: "p", model: "m" }, captain, teamRecord(), member, STATE_DIR, undefined)
        expect(captured).toHaveLength(1)
/** The deny list the vendored spawn path actually sent. */
        const deny = captured[0].request.toolFilter.deny
        expect(deny).not.toContain("agent_teams_task_contract")
        expect(deny).toContain("agent_teams_approve")
        expect(deny).toContain("agent_teams_edit_plan")
        // the member's OWN read-only restriction is still merged on top
        expect(deny).toContain("write")
        expect(deny).toContain("bash")
    }
    finally {
        process.env.HOME = oldHome
    }

    // (3) the RUNTIME restriction: the real capability layer, recomputing the same filter
    const restrictions: { deny?: readonly string[] }[] = []
/** The member agent double the capability layer restricts. */
    const memberAgent: { id: string; status: string; session: { readonly header: { readonly cwd: string } }; ctx?: Record<string, unknown> } = {
        id: MEMBER_ID,
        status: "idle",
        session: { header: { cwd: tmpdir() } },
    }
    memberAgent.ctx = {
        agent: memberAgent,
        tools: { restrict: (filter: { deny?: readonly string[] }) => { restrictions.push(filter); return () => undefined } },
        effect: (cb: () => unknown) => { cb(); return undefined },
    }
/** The context double the capability layer is installed over. */
    const capCtx = {
        systemPrompt: { section: () => undefined },
        on: () => () => undefined,
        effect: (cb: () => unknown) => { cb(); return undefined },
        agents: { list: () => [memberAgent] },
        logger: { warn: () => {} },
    }
    installTeamCapabilities(capCtx, { stateDir: STATE_DIR, isPendingMember: () => true, order: 117, captainPrompt: () => "captain" })
    expect(restrictions).toHaveLength(1)
    expect(restrictions[0].deny).not.toContain("agent_teams_task_contract")
    expect(restrictions[0].deny).toContain("agent_teams_approve")
})

test("T-19: the status surface names ONE pause mechanism and reports the hold as its INTERNAL implementation", async () => {
/** The fixture roots and both seats this arm drives. */
    const { workspace, captain, member } = fixture()
    try {
/** The registry the REAL tools registered into. */
        const { tools } = registerTools(workspace, captain, member)
/** The registered status tool; the registry above captured it, so the lookup cannot miss. */
        const status = tools.get("agent_teams_status")!
        // The stub's hold is LIVE (HOLD_VIEW), so this render is the state the OLD surface got
        // wrong: it printed `agent-teams halt not active` while the team was held.
        const held = await status.execute({}, { agent: member })
/** The status surface as the model reads it while the team is held. */
        const heldText = status.output.render({}, held)[0].text
        expect(heldText, "one mechanism, named once").toContain("Pause: agent-teams halt ACTIVE (one mechanism: agent_teams_halt")
        expect(heldText, "the hold is the mechanism's internal implementation, not a peer").toContain("PRESERVING hold is its INTERNAL implementation")
        // Diagnostics survive the collapse: the operator still gets WHICH hold and WHY.
        expect(heldText).toContain("hold-probe-1")
        expect(heldText).toContain("silence probe")
        expect(heldText).toContain("released only by its own session-watchdog-resume")
        // DRIFT GUARDS: the wave-1 peer wording and its deferral stay ABSENT.
        expect(heldText).not.toContain("\u00b7 team watchdog hold:")
        expect(heldText).not.toContain("run session-watchdog-status")
        // no NEW resume verb on this surface (the unchanged wave-1 guarantee)
        expect(heldText).not.toContain("agent_teams_resume")
        expect(heldText).not.toContain("session-watchdog-resume`-like")

        // The structured payload carries the same single-mechanism view.
        expect(held.pause.mechanism).toBe("agent_teams_halt")
        expect(held.pause.active).toBe(true)
        expect(held.pause.halt).toBe(false)
        expect(held.pause.internal_implementation.kind).toBe("team-watchdog-preserving-hold")
        expect(held.pause.internal_implementation.hold_id).toBe("hold-probe-1")
        expect(held.pause.internal_implementation.released_by).toBe("session-watchdog-resume")

        // A HALTED record (no hold) reads ACTIVE with the same framing — the pre-existing
        // assertion shape is kept, so this half stays guarded too.
        const halted = await status.execute({}, { agent: captain })
        halted.halted = true
/** The status surface as the model reads it while the team is merely halted. */
        const haltOnlyText = status.output.render({}, halted)[0].text
        expect(haltOnlyText).toContain("Pause: agent-teams halt ACTIVE (one mechanism: agent_teams_halt")
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})

test("T-19: with NO watchdog service the status says the hold is NOT READABLE — never a guessed hold", async () => {
/** The fixture roots and both seats this arm drives. */
    const { workspace, captain, member } = fixture()
    try {
        // A registration whose service store answers nothing: the read must FAIL OPEN and must not
        // invent `no hold is set` (a false negative an operator would trust).
        const tools = new Map()
/** The context double the scratch registration drives. */
        const ctx = {
            tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
/** The registered status tool from the seeded wave-1 copy. */
        const status = tools.get("agent_teams_status")!
/** The seeded copy's status payload. */
        const value = await status.execute({}, { agent: member })
/** The seeded copy's rendered status line, which the matchers are run against. */
        const rendered = status.output.render({}, value)[0].text
        expect(rendered).toContain("hold state not readable on this host")
        expect(rendered).not.toContain("no hold is set")
        expect(value.pause.internal_implementation.state).toBe("not-readable")
        expect(value.pause.active).toBe(false)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
    }
})


// ---------------------------------------------------------------------------------------------
// t41 (wave 1): the two REFUSAL PATHS of the now member-visible contract tool, PINNED here
// because the t9 record is terminal. Both were measured green post-fix by the lane owner; this
// test adds (a) the non-participant refusal and (b) the unknown-id refusal that NAMES the known
// ids, plus an in-test FALSIFICATION lane: the same two matchers are run against a scratch module
// copy whose refusal TEXTS are neutralised, and BOTH must go red there — a pin that cannot fail
// is worse than no pin.
// ---------------------------------------------------------------------------------------------

/** A registry whose agent lookup also knows an OUTSIDER (neither captain nor member of the team). */
/** Register the tools with an OUTSIDER seat the agent registry answers for. */
function registryWithOutsider(workspace: string, captain: AgentLike, member: AgentLike, outsider: AgentLike): Map<string, ToolDefinition> {
/** The definitions this registration captured. */
    const tools = new Map()
/** The context double the vendored registration drives. */
    const ctx = {
        tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
        agents: {
            get: (id: string) => (id === captain.id ? captain : id === member.id ? member : id === outsider.id ? outsider : undefined),
            list: () => [captain, member, outsider],
        },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    return tools
}

/** The message a rejected call threw, or "" when it resolved. */
/** The message a rejected call threw, or the empty string when it resolved. */
async function refusalOf(promise: Promise<ToolResult>): Promise<string> {
    try {
        await promise
        return ""
    }
    catch (error) {
        // The thrown value is unknowable from a JS throw site, so the message is read through Error.
        return String((error as Error | undefined)?.message ?? error)
    }
}

test("t41: the contract tool refuses a NON-PARTICIPANT and an UNKNOWN id NAMING the known ids — both FALSIFIABLE", async () => {
/** The fixture roots and both seats this arm drives. */
    const { workspace, captain, member } = fixture()
/** A live agent that is NOT a member of the fixture team. */
    const outsider = { id: "session-outsider", status: "idle", session: { header: { cwd: workspace } } }
/** The scratch root the falsification copy is materialized under. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t41-falsify-"))
    try {
/** The registered contract tool; the registry above captured it, so the lookup cannot miss. */
        const contract = registryWithOutsider(workspace, captain, member, outsider).get("agent_teams_task_contract")!

        // (a) NON-PARTICIPANT: the existing refusal text, verbatim
        const outsiderRefusal = await refusalOf(contract.execute({ task_id: "t1" }, { agent: outsider }))
        expect(outsiderRefusal).toContain("you do not lead or belong to any active team yet")

        // (b) UNKNOWN task id: refused AND naming the known ids
        const unknownRefusal = await refusalOf(contract.execute({ task_id: "t99" }, { agent: member }))
        expect(unknownRefusal).toContain('task "t99" does not exist in team')
        expect(unknownRefusal).toMatch(/\(known tasks: t1\)/)

        // the participant read itself still works (the two refusals did not eat the happy path)
        const read = await contract.execute({ task_id: "t1" }, { agent: member })
        expect(read.task_id).toBe("t1")

        // FALSIFICATION: a scratch copy of the module with the two refusal TEXTS neutralised. The
        // calls still refuse there (so the difference is the text, not a missing refusal), and the
        // very matchers asserted above must FAIL — which is what makes them pins and not decoration.
        mkdirSync(join(scratch, "lib"), { recursive: true })
        for (const entry of readdirSync(libDir, { withFileTypes: true }))
            if (entry.isFile())
                cpSync(join(libDir, entry.name), join(scratch, "lib", entry.name))
        symlinkSync(join(pluginRoot, "_deps"), join(scratch, "_deps"), "junction")
/** The scratch copy of the tool module the refusal is neutralised in. */
        const scratchTools = join(scratch, "lib", "tools.js")
/** The copy's bytes before the neutralisation. */
        const source = readFileSync(scratchTools, "utf8")
/** The copy with the participant refusal removed. */
        const neutralised = source
            .replace("you do not lead or belong to any active team yet", "SCRATCH-NEUTRAL-PARTICIPANT-REFUSAL")
            .replace("(known tasks: ${known || 'none'})", "(SCRATCH-NEUTRAL-KNOWN-IDS)")
        expect(neutralised).not.toBe(source)
        writeFileSync(scratchTools, neutralised)
/** The neutralised module's registration entry, imported with a cache-busting query. */
        const { registerAgentTeamsTools: registerScratch } = await import(pathToFileURL(scratchTools).href + "?t41=1")
/** The definitions the neutralised registration captured. */
        const scratchRegistry = new Map()
        registerScratch({
            tools: { register: (definition: ToolDefinition) => { scratchRegistry.set(definition.name, definition) } },
            agents: {
                get: (id: string) => (id === captain.id ? captain : id === member.id ? member : id === outsider.id ? outsider : undefined),
                list: () => [captain, member, outsider],
            },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: () => undefined,
        }, { stateDir: STATE_DIR })
/** The contract tool as the NEUTRALISED module registered it. */
        const scratchContract = scratchRegistry.get("agent_teams_task_contract")!
/** The outsider's refusal under the neutralised copy, which must reproduce the defect. */
        const scratchOutsider = await refusalOf(scratchContract.execute({ task_id: "t1" }, { agent: outsider }))
/** The unknown-id refusal under the neutralised copy. */
        const scratchUnknown = await refusalOf(scratchContract.execute({ task_id: "t99" }, { agent: member }))
        // the scratch copy STILL refuses (both non-empty) — only its wording moved...
        expect(scratchOutsider).toContain("SCRATCH-NEUTRAL-PARTICIPANT-REFUSAL")
        expect(scratchUnknown).toContain("SCRATCH-NEUTRAL-KNOWN-IDS")
        // ...so the pinned matchers go RED on it. THIS is the falsifiability proof.
        expect(scratchOutsider).not.toContain("you do not lead or belong to any active team yet")
        expect(scratchUnknown).not.toMatch(/\(known tasks: t1\)/)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
        rmSync(scratch, { recursive: true, force: true })
    }
})

// ---------------------------------------------------------------------------------------------
// t37 (wave 2, lane A) — THE SEEDED NEGATIVE CONTROL for the T-19 pin above.
//
// WHY IT EXISTS: the reddening proof for that pin was measured once and lived only in a MESSAGE —
// and this wave established that a reading whose only home is a message is rotted-in-waiting, and
// that every claim should ship an instrument with a NEGATIVE CONTROL that reddens on revert. This
// lane is that instrument: it SEEDS the wave-1 two-peer wording into a scratch copy of the module
// and asserts that the pin's own matchers go RED there.
//
// THE SEED IS THE TRUE WAVE-1 LINE (not a hybrid): its condition is `team.halted` — NOT the new
// `team.pause.active` — which is exactly why the old surface printed `agent-teams halt not active`
// while a PRESERVING hold was set. The scratch copy lives OUTSIDE the workspace (T-89: a copy under
// the repo is discoverable by a substring-filtered `bun test`) and is deleted in `finally`.
//
// THE PREFIX LEG, restated correctly: both wordings SHARE the `Pause: agent-teams halt ` prefix,
// which is why the pin needs more than a prefix assertion. The prefix therefore stays true on the
// seeded copy; the single-mechanism framing and BOTH drift guards go false.
// ---------------------------------------------------------------------------------------------

/** The shipped pause line, matched without line numbers or a remembered offset (T-55). */
const SHIPPED_PAUSE_LINE = /`Pause: agent-teams halt \$\{[^`]*?`,\n/u
/** The wave-1 two-peer line, restored verbatim from the registry's own history of the region. */
const WAVE_ONE_PAUSE_LINE = "`Pause: agent-teams halt ${team.halted ? 'ACTIVE' : 'not active'} · team watchdog hold: not read on this surface — run session-watchdog-status (released only by its own session-watchdog-resume)`,\n"

test("T-19 SEEDED NEGATIVE CONTROL: the pin's matchers go RED on the restored wave-1 wording", async () => {
/** The fixture roots and both seats this arm drives. */
    const { workspace, captain, member } = fixture()
/** The scratch root the wave-1 wording is seeded into. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-t19-seed-"))
    try {
        // 1. the scratch copy: the adopted module OUTSIDE the workspace, with its runtime closure
        cpSync(libDir, join(scratch, "lib"), { recursive: true })
        symlinkSync(join(pluginRoot, "_deps"), join(scratch, "_deps"), "junction")
/** The scratch copy of the tool module the wave-1 line is seeded into. */
        const copyTools = join(scratch, "lib", "tools.js")
/** The copy's bytes before the seeding. */
        const source = readFileSync(copyTools, "utf8")
        expect((source.match(SHIPPED_PAUSE_LINE) ?? []).length, "the shipped pause line must occur exactly once in the copy").toBe(1)
        writeFileSync(copyTools, source.replace(SHIPPED_PAUSE_LINE, WAVE_ONE_PAUSE_LINE))
        expect(readFileSync(copyTools, "utf8"), "the seed must actually be in the copy").toContain("team watchdog hold: not read on this surface")

        // 2. drive the SEEDED copy through the same registration shape the pins use, with a LIVE hold
        const seeded = await import(pathToFileURL(copyTools).href)
/** The definitions the seeded copy's registration captured. */
        const tools = new Map()
/** The context double the seeded registration drives. */
        const ctx = {
            tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition) } },
            agents: { get: (id: string) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
            subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: (name: string) => (name === "mpdWatchdog" ? { isHeld: () => ({ ...HOLD_VIEW }) } : undefined),
        }
        seeded.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
/** The registered status tool from the seeded copy. */
        const status = tools.get("agent_teams_status")!
/** The seeded copy's status payload. */
        const value = await status.execute({}, { agent: member })
/** The seeded copy's rendered status line. */
        const seededText = status.output.render({}, value)[0].text

        // 3. the diagnostic falsehood the collapse fixed: the OLD line says "not active" while held
        expect(seededText, "the seeded line is the wave-1 one").toContain("· team watchdog hold: not read on this surface")
        expect(seededText, "wave-1 wording printed 'not active' while the team was HELD").toContain("Pause: agent-teams halt not active")

        // 4. THE MATCHERS — the same strings the shipped pin asserts, run against the seeded text.
        const prefixPresent = seededText.includes("Pause: agent-teams halt ")
/** Whether the seeded line names ONE pause mechanism. */
        const singleMechanismFraming = seededText.includes("(one mechanism: agent_teams_halt")
/** Whether the seeded line still carries the wave-1 peer wording. */
        const peerWordingAbsent = !seededText.includes("· team watchdog hold:")
/** Whether the seeded line still defers the hold to another surface. */
        const deferralAbsent = !seededText.includes("run session-watchdog-status")
        expect(prefixPresent, "the shared prefix must stay TRUE — which is why the pin needs the extra matchers").toBe(true)
        expect(singleMechanismFraming, "the single-mechanism framing matcher must go FALSE on the seeded wording").toBe(false)
        expect(peerWordingAbsent, "the peer-wording drift guard must go FALSE on the seeded wording").toBe(false)
        expect(deferralAbsent, "the deferral drift guard must go FALSE on the seeded wording").toBe(false)

        // 5. and the SHIPPED module still satisfies all four (so this lane cannot pass by the pin
        // having drifted away from the strings asserted here).
        const { tools: liveTools } = registerTools(workspace, captain, member)
/** The live status payload, read from the shipped tree. */
        const liveStatus = liveTools.get("agent_teams_status")!
/** The live status line the shipped matchers are run against. */
        const liveText = liveStatus.output.render({}, await liveStatus.execute({}, { agent: member }))[0].text
        expect(liveText.includes("Pause: agent-teams halt ")).toBe(true)
        expect(liveText.includes("(one mechanism: agent_teams_halt")).toBe(true)
        expect(!liveText.includes("· team watchdog hold:")).toBe(true)
        expect(!liveText.includes("run session-watchdog-status")).toBe(true)
    }
    finally {
        rmSync(workspace, { recursive: true, force: true })
        rmSync(scratch, { recursive: true, force: true })
    }
})
