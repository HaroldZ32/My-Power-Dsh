// DEFECT (measured 2026-09-14): the TEAM-member path restricted only the captain-only
// tool names, so a roster member the profile calls READ-ONLY still had `write`, `edit`
// and `bash` — a member's own session probe ran `pwd` for real and returned a path.
// The one-shot roster path (`mpd_role_spawn` / `mpd_workmate_spawn`) already denies the
// seven write-capable names via the exported `READONLY_DENY`; the team path had no
// equivalent because the adopted plugin cannot import across packages, so the list is
// carried as PROFILE DATA (`toolDeny`) and threaded into the harness `toolFilter`.
//
// These tests pin all three halves of that guarantee:
//   1. the profile parser accepts and normalizes `toolDeny` (and rejects junk),
//   2. the member spawn REALLY passes it to the harness, merged with the captain-only
//      denial,
//   3. the SHIPPED `mpd` profile marks exactly the six read-only members — with the
//      same seven names the roster's `READONLY_DENY` exports.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveTeamProfile } from "../lib/profiles.js"
import { spawnMember } from "../lib/members.js"
import { registerAgentTeamsTools } from "../lib/tools.js"
import { CAPTAIN_TOOL_NAMES } from "../lib/tool-names.js"
import { readFileSync as readText } from "node:fs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
/** The seven write-capable names the one-shot roster path denies. */
const READONLY_DENY = [
    "write",
    "edit",
    "mpd_hashline_edit",
    "bash",
    "mcp__ast_grep__rewrite",
    "mcp__ast_grep__scan",
    "mcp__lsp__rename",
]

/** A profile wrapper around one member, so the parser's profile/member paths run. */
const profileWith = (member) => ({
    description: "d",
    protocol: "p",
    executionPrompt: "e",
    members: [member],
})

test("the profile parser normalizes `toolDeny` and rejects non-lists or empty entries", () => {
    const ok = resolveTeamProfile({ probe: profileWith({ name: "Explorer", toolDeny: ["write", " bash "] }) }, "probe", 16)
    expect(ok.members[0].toolDeny).toEqual(["write", "bash"])
    expect(() => resolveTeamProfile({ probe: profileWith({ name: "Explorer", toolDeny: "write" }) }, "probe", 16)).toThrow(/toolDeny/)
    expect(() => resolveTeamProfile({ probe: profileWith({ name: "Explorer", toolDeny: [""] }) }, "probe", 16)).toThrow(/toolDeny/)
    expect(resolveTeamProfile({ probe: profileWith({ name: "Explorer" }) }, "probe", 16).members[0].toolDeny).toBe(undefined)
})

test("the member spawn passes the member's deny list to the harness, merged with the captain-only denial", async () => {
    const captured = []
    const ctx = {
        subagents: {
            getProvider: () => ({
                prepareContinuable: () => undefined,
                capabilities: { persona: true, toolFilter: true },
            }),
            // the spawn seam lives on ctx.subagents; the PROVIDER carries capabilities
            startContinuable: (payload) => {
                captured.push(payload)
                return { childId: "child-1" }
            },
        },
    }
    const selections = { withPending: (_parent, _label, _llm, fn) => fn() }
    const team = { id: "probe-team", name: "probe", tasks: [], members: [], captainSessionId: "session-captain" }
    const member = { name: "Explorer", role: "read-only exploration", toolDeny: READONLY_DENY }
    await spawnMember(
        ctx,
        { provider: "spawn", executionPrompt: "read-only" },
        selections,
        { provider: "deepseek-official", model: "deepseek-v4-flash" },
        { id: "session-captain" },
        team,
        member,
        join(".mpd", "team"),
        undefined,
    )
    expect(captured).toHaveLength(1)
    const deny = captured[0].request.toolFilter.deny
    for (const name of READONLY_DENY)
        expect(deny).toContain(name)
    for (const name of CAPTAIN_TOOL_NAMES)
        expect(deny).toContain(name)
    // A worker member with no `toolDeny` keeps only the captain-tool denial.
    captured.length = 0
    await spawnMember(
        ctx,
        { provider: "spawn", executionPrompt: "worker" },
        selections,
        { provider: "deepseek-official", model: "deepseek-v4-flash" },
        { id: "session-captain" },
        team,
        { name: "Senior Engineer", role: "implementation" },
        join(".mpd", "team"),
        undefined,
    )
    expect(captured[0].request.toolFilter.deny).toEqual([...CAPTAIN_TOOL_NAMES])
})

test("the shipped `mpd` profile marks exactly the six read-only members with the canonical names", () => {
    const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
    const READ_ONLY_MEMBERS = ["Architect", "Researcher", "Planner", "Explorer", "Plan Reviewer", "Vision Analyst"]
    const WORKER_MEMBERS = ["Lead", "Deep Worker", "Senior Engineer", "Junior Engineer", "Reviewer"]
    // Split the profile's member list into blocks, so each toolDeny is attributed to its member.
    const blocks = patch.split(/\n\s*- name: /).slice(1)
    const seen = new Map()
    for (const block of blocks) {
        const name = block.split("\n")[0].trim()
        const match = block.match(/toolDeny: \[(.*?)\]/)
        seen.set(name, match === null ? undefined : match[1].split(",").map((entry) => entry.trim()))
    }
    for (const name of READ_ONLY_MEMBERS) {
        expect(seen.get(name)).toEqual(READONLY_DENY)
    }
    for (const name of WORKER_MEMBERS) {
        expect(seen.get(name)).toBe(undefined)
    }
})

test("`agent_teams_add_member` exposes `toolDeny` so a runtime-added member can be read-only too", () => {
    const tools = new Map()
    const ctx = {
        tools: { register: (definition) => { tools.set(definition.name, definition) } },
        agents: { get: () => undefined, list: () => [] },
        subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
        effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }
    registerAgentTeamsTools(ctx, { stateDir: join(".mpd", "team") })
    // the adapter normalizes parameters into an object-rooted JSON schema
    const parameter = tools.get("agent_teams_add_member").parameters.properties.toolDeny
    expect(parameter).toBeDefined()
    expect(parameter.type).toBe("array")
})
