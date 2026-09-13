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
import { EXPLICIT_TEAM_INQUIRY_MARKER, EXPLICIT_TEAM_NOTICE_MARKER, ensureExplicitTeam } from "../lib/command.js"

const STATE_DIR = join(".mpd", "team")
const profileRoster = (name = "mpd") => ({
    [name]: {
        description: "test roster",
        taskPlanning: "captain",
        members: [{ name: "Architect", provider: "deepseek-official", model: "deepseek-v4-flash", fallback: { provider: "deepseek-official", model: "deepseek-v4-flash" } }],
    },
})

/** A stub plugin ctx: tool/llm seams the profile init touches, plus a recording logger. */
function makeCtx() {
    const warnings = []
    const ctx = {
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

function fixture() {
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

function config(extra = {}) {
    return { stateDir: STATE_DIR, maxMembers: 16, profiles: profileRoster(), sessionTeamPolicy: { name: "MPD Default", approval: "required" }, ...extra }
}

const teamFiles = (stateRoot) => {
    try {
        return require("node:fs").readdirSync(stateRoot).filter((n) => n !== "archive" && !n.startsWith(".") && require("node:fs").existsSync(join(stateRoot, n, "team.json")))
    }
    catch { return [] }
}

test("R4: with no team yet the PLUGIN stages one (approval=required, zero members spawned)", async () => {
    const { workspace, stateRoot, agent, cleanup } = fixture()
    try {
        const result = await ensureExplicitTeam({ ctx: makeCtx(), config: config(), agent, profileName: "mpd" })
        expect(result.kind).toBe("staged")
        expect(result.text).toContain(EXPLICIT_TEAM_NOTICE_MARKER)
        const ids = teamFiles(stateRoot)
        expect(ids.length).toBe(1)
        const team = JSON.parse(readFileSync(join(stateRoot, ids[0], "team.json"), "utf8"))
        expect(team.phase).toBe("staged")
        expect(team.profile.name).toBe("mpd")
        expect(team.approvedAt).toBeUndefined()
        // ZERO members spawned: the roster is a plan, not running agents
        expect((team.members ?? []).every((member) => member.status !== "active")).toBe(true)
    }
    finally { cleanup() }
})

test("R4 ask-first: an existing STAGED team yields an inquiry, never a second team", async () => {
    const { stateRoot, agent, cleanup } = fixture()
    try {
        const ctx = makeCtx()
        const first = await ensureExplicitTeam({ ctx, config: config(), agent, profileName: "mpd" })
        expect(first.kind).toBe("staged")
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
    const { stateRoot, agent, cleanup } = fixture()
    try {
        // findTeamByParticipant refuses to guess when the session shows up in two
        // teams; the explicit path must surface that as a WARNING, never as silence
        // and never by quietly picking one.
        const { initializeProfileTeam } = await import("../lib/tools.js")
        const ctxOk = makeCtx()
        const first = await ensureExplicitTeam({ ctx: ctxOk, config: config(), agent, profileName: "mpd" })
        expect(first.kind).toBe("staged")
        // plant a second record that ALSO names this session as its captain
        const secondId = "mpd-default-second"
        mkdirSync(join(stateRoot, secondId, "inbox"), { recursive: true })
        writeFileSync(join(stateRoot, secondId, "team.json"), JSON.stringify({
            id: secondId, name: "second", captainSessionId: agent.id, createdAt: Date.now(), updatedAt: Date.now(),
            taskSeq: 0, phase: "staged", members: [], tasks: [],
        }, null, 2))
        const result = await ensureExplicitTeam({ ctx: makeCtx(), config: config(), agent, profileName: "mpd" })
        expect(result.kind).toBe("unavailable")
        expect(result.text).toContain("WARNING")
    }
    finally { cleanup() }
})

test("R4 silent-failure: a missing profile roster warns instead of staying quiet", async () => {
    const { stateRoot, agent, cleanup } = fixture()
    try {
        const ctx = makeCtx()
        const result = await ensureExplicitTeam({ ctx, config: config({ profiles: {} }), agent, profileName: "mpd" })
        expect(result.kind).toBe("unavailable")
        expect(result.text).toContain("WARNING")
        expect(result.text).toContain(EXPLICIT_TEAM_NOTICE_MARKER)
        expect(teamFiles(stateRoot).length).toBe(0)
    }
    finally { cleanup() }
})
