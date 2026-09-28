// t26 (R4) — explicit-entry hardening, unit level.
//
// The explicit path (`/agent-teams`, `/agent-teams-<profile>`, plain-text gesture)
// must NEVER end with "the user asked for a team and nothing happened":
//   * no team yet            -> the PLUGIN stages one (approval=required, 0 members)
//   * a team already exists  -> ASK FIRST (never auto-reuse, never a second team)
//   * no profile roster      -> a visible WARNING, never silence
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the explicit
// entry helpers cannot be typed without re-authoring upstream; this import stays untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { EXPLICIT_TEAM_INQUIRY_MARKER, EXPLICIT_TEAM_NOTICE_MARKER, ensureExplicitTeam } from "../lib/command.js"

/** The state directory the plugin resolves under a session workspace. */
const STATE_DIR = join(".mpd", "team")
/**
 * One single-member profile roster, as the plugin config carries it.
 * @param name - the profile name the roster is keyed by.
 * @returns a roster map holding that one profile.
 */
const profileRoster = (name: string = "mpd"): Record<string, unknown> => ({
    [name]: {
        description: "test roster",
        taskPlanning: "captain",
        members: [{ name: "Architect", provider: "deepseek-official", model: "deepseek-v4-flash", fallback: { provider: "deepseek-official", model: "deepseek-v4-flash" } }],
    },
})

/**
 * A stub plugin ctx: tool/llm seams the profile init touches, plus a recording logger.
 * @returns the stub context, whose `warnings` array collects every logged warning.
 */
function makeCtx(): {
    tools: { register: () => void }
    agents: { get: () => undefined; list: () => unknown[] }
    subagents: { prompt: () => Promise<{ messageId: string }>; followup: () => void; sendMessage: () => void }
    effect: () => void
    on: () => void
    logger: { warn: (message: unknown) => number; info: () => void; error: () => void; debug: () => void }
    get: () => undefined
    llm: {
        resolveCallConfig: (request: { provider: string; model: string; reasoningEffort?: unknown }) => Promise<{ provider: string; model: string; reasoningEffort?: unknown }>
        listModels: () => Promise<unknown[]>
    }
    warnings: string[]
} {
    /** Every warning the profile init logs, captured in order. */
    const warnings: string[] = []
    /** The stub context itself, typed by this factory so the seams and their callers cannot drift. */
    const ctx: ReturnType<typeof makeCtx> = {
        tools: { register: () => {} },
        agents: { get: () => undefined, list: () => [] },
        subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
        effect: () => {},
        on: () => {},
        logger: { warn: (m) => warnings.push(String(m)), info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
        // The profile init resolves each roster member's route through the LLM seam.
        llm: {
            resolveCallConfig: async (request) => ({ provider: request.provider, model: request.model, ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }) }),
            // an empty catalog means "cannot enumerate" and is accepted as valid
            listModels: async () => [],
        },
        warnings,
    }
    return ctx
}

/**
 * A throwaway workspace plus the captain agent the explicit path is called with.
 * @returns the workspace, its team state root, a captain agent and the cleanup callback.
 */
function fixture(): {
    workspace: string
    stateRoot: string
    agent: {
        id: string
        status: string
        options: { provider: string; model: string }
        session: { header: { cwd: string }; requestHeader: () => { config: { provider: string; model: string } } }
    }
    cleanup: () => void
} {
    /** The throwaway workspace the explicit team is staged in. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-r4-"))
    return {
        workspace,
        stateRoot: join(workspace, STATE_DIR),
        agent: {
            id: "session-r4", status: "idle",
            options: { provider: "deepseek-official", model: "deepseek-v4-flash" },
            session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) },
        },
        cleanup: () => rmSync(workspace, { recursive: true, force: true }),
    }
}

/**
 * The plugin config the explicit path reads, with one override per arm.
 * @param extra - the fields this arm replaces, such as an empty roster.
 * @returns the resolved-looking config object.
 */
function config(extra: Record<string, unknown> = {}): {
    stateDir: string
    maxMembers: number
    profiles: Record<string, unknown>
    sessionTeamPolicy: { name: string; approval: string }
} {
    return { stateDir: STATE_DIR, maxMembers: 16, profiles: profileRoster(), sessionTeamPolicy: { name: "MPD Default", approval: "required" }, ...extra }
}

/**
 * The team ids that still have a live record under one state root.
 * @param stateRoot - the team state root to list.
 * @returns the live team directory names, or an empty list when the root does not exist yet.
 */
const teamFiles = (stateRoot: string): string[] => {
    try {
        return require("node:fs").readdirSync(stateRoot).filter((n: string) => n !== "archive" && !n.startsWith(".") && require("node:fs").existsSync(join(stateRoot, n, "team.json")))
    }
    catch { return [] }
}

test("R4: with no team yet the PLUGIN stages one (approval=required, zero members spawned)", async () => {
    /** The throwaway workspace and the captain agent the explicit path is called with. */
    const { workspace, stateRoot, agent, cleanup } = fixture()
    try {
        /** The staged-team result the explicit path returns. */
        const result = await ensureExplicitTeam({ ctx: makeCtx(), config: config(), agent, profileName: "mpd" })
        expect(result.kind).toBe("staged")
        expect(result.text).toContain(EXPLICIT_TEAM_NOTICE_MARKER)
        /** The live team ids on disk, which must be exactly one. */
        const ids = teamFiles(stateRoot)
        expect(ids.length).toBe(1)
        /** The record written for that single staged team. */
        const team: { phase: string; profile: { name: string }; approvedAt?: number; members?: Array<{ status: string }> } = JSON.parse(readFileSync(join(stateRoot, ids[0], "team.json"), "utf8"))
        expect(team.phase).toBe("staged")
        expect(team.profile.name).toBe("mpd")
        expect(team.approvedAt).toBeUndefined()
        // ZERO members spawned: the roster is a plan, not running agents
        expect((team.members ?? []).every((member) => member.status !== "active")).toBe(true)
    }
    finally { cleanup() }
})

test("R4 ask-first: an existing STAGED team yields an inquiry, never a second team", async () => {
    /** The throwaway workspace and the captain agent the explicit path is called with. */
    const { stateRoot, agent, cleanup } = fixture()
    try {
        /** The stub context both calls share, so the record is looked up the same way twice. */
        const ctx = makeCtx()
        /** The first call's result, which stages the team. */
        const first = await ensureExplicitTeam({ ctx, config: config(), agent, profileName: "mpd" })
        expect(first.kind).toBe("staged")
        /** The second call's result, which must ask before reusing the staged team. */
        const second = await ensureExplicitTeam({ ctx, config: config(), agent, profileName: "mpd" })
        expect(second.kind).toBe("exists")
        expect(second.text).toContain(EXPLICIT_TEAM_INQUIRY_MARKER)
        expect(second.teamId).toBe(first.teamId)
        expect(second.text).toContain("reuse")
        // exactly one team on disk — nothing was duplicated
        expect(teamFiles(stateRoot).length).toBe(1)
    }
    finally { cleanup() }
})

test("R4 silent-failure: an AMBIGUOUS session (two teams) warns instead of guessing", async () => {
    /** The throwaway workspace and the captain agent the explicit path is called with. */
    const { stateRoot, agent, cleanup } = fixture()
    try {
        // findTeamByParticipant refuses to guess when the session shows up in two
        // teams; the explicit path must surface that as a WARNING, never as silence
        // and never by quietly picking one.
        // The adopted agent-teams body is vendored JavaScript with no declaration file, so this lazy
        // import of the profile-init helper stays untyped; the directive below is expected here.
        // @ts-expect-error vendored JavaScript has no declaration file
        const { initializeProfileTeam } = await import("../lib/tools.js")
        /** The stub context the first, successful call uses. */
        const ctxOk = makeCtx()
        /** The first call's result, which stages one team for this session. */
        const first = await ensureExplicitTeam({ ctx: ctxOk, config: config(), agent, profileName: "mpd" })
        expect(first.kind).toBe("staged")
        // plant a second record that ALSO names this session as its captain
        /** The id of the planted second team, which makes the session ambiguous. */
        const secondId = "mpd-default-second"
        mkdirSync(join(stateRoot, secondId, "inbox"), { recursive: true })
        writeFileSync(join(stateRoot, secondId, "team.json"), JSON.stringify({
            id: secondId, name: "second", captainSessionId: agent.id, createdAt: Date.now(), updatedAt: Date.now(),
            taskSeq: 0, phase: "staged", members: [], tasks: [],
        }, null, 2))
        /** The ambiguous call's result, which must warn instead of picking a team. */
        const result = await ensureExplicitTeam({ ctx: makeCtx(), config: config(), agent, profileName: "mpd" })
        expect(result.kind).toBe("unavailable")
        expect(result.text).toContain("WARNING")
    }
    finally { cleanup() }
})

test("R4 silent-failure: a missing profile roster warns instead of staying quiet", async () => {
    /** The throwaway workspace and the captain agent the explicit path is called with. */
    const { stateRoot, agent, cleanup } = fixture()
    try {
        /** The stub context, whose empty roster is the condition under test. */
        const ctx = makeCtx()
        /** The result for a config that carries no roster entry for the profile. */
        const result = await ensureExplicitTeam({ ctx, config: config({ profiles: {} }), agent, profileName: "mpd" })
        expect(result.kind).toBe("unavailable")
        expect(result.text).toContain("WARNING")
        expect(result.text).toContain(EXPLICIT_TEAM_NOTICE_MARKER)
        expect(teamFiles(stateRoot).length).toBe(0)
    }
    finally { cleanup() }
})
