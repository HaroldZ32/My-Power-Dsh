// t6 / slot 4 — the FOUR configured `teamModels` slots are the DEFAULT route of the `mpd` roster.
//
// Two halves, both proved here without a live boot:
//   * profiles.js — a member may declare `tier` (positive integer) or `route`
//     ({provider, model, reasoningEffort?}); declaring BOTH is refused naming the member and both
//     keys; an unknown key is still refused; and the REAL `mpd` profile block in
//     packages/mpd-bundle/cordis.patch.yml survives the plugin's own Config schema with its `tier`
//     still attached, asserted key-by-key — Vision Analyst included, at tier 4.
//   * tools.js — initializeProfileTeam resolves each member template to one concrete route: an
//     explicit `route` verbatim, a `tier` from ctx.get("mpdConfig").get("teamModels.slot<N>"), and
//     today's captain-derived behaviour for a member with neither. An unusable slot fails LOUDLY
//     naming the member, the slot and the fix, writes NO team state, and never clamps an effort.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveTeamProfile } from "../lib/profiles.js"
import { Config } from "../lib/index.js"

const PATCH_PATH = join(import.meta.dir, "..", "..", "mpd-bundle", "cordis.patch.yml")
const STATE_DIR = join(".mpd", "team")
const FALLBACK = { provider: "deepseek-official", model: "deepseek-v4-flash" }
const VISION_ROUTE = { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" }
/** The frozen class mapping — tier 1/2/3 plus tier 4, the vision slot (Vision Analyst). */
const FROZEN_TIERS = {
    Architect: 1, Planner: 1, Reviewer: 1, Lead: 1, "Senior Engineer": 1,
    Researcher: 2, Explorer: 2, "Plan Reviewer": 2,
    "Deep Worker": 3, "Junior Engineer": 3,
    "Vision Analyst": 4,
}
/** Slot 4's DEFAULTS = Vision Analyst's former explicit route, so tier 4 is behaviour-preserving. */
const VISION_SLOT_DEFAULT = { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" }
/** The six read-only members carry the shared seven-name deny list; the five workers carry none. */
const READONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
const READONLY_MEMBERS = new Set(["Architect", "Researcher", "Planner", "Explorer", "Plan Reviewer", "Vision Analyst"])

/** The REAL `mpd` profile object out of the shipped bundle patch (never a copy that can drift). */
function realProfile() {
    if (typeof Bun === "undefined" || typeof Bun.YAML?.parse !== "function") {
        throw new Error("this test needs the Bun runtime (Bun.YAML.parse) to read the shipped patch")
    }
    const doc = Bun.YAML.parse(readFileSync(PATCH_PATH, "utf8"))
    for (const row of doc) {
        if (row?.config?.profiles?.mpd !== undefined) return row.config.profiles.mpd
        for (const item of row?.insert ?? []) {
            if (item?.config?.profiles?.mpd !== undefined) return item.config.profiles.mpd
        }
    }
    throw new Error(`the mpd profile block is missing from ${PATCH_PATH}`)
}

const profileOf = (members, extra = {}) => ({ mpd: { taskPlanning: "captain", members, ...extra } })

describe("B3 — the shipped bundle patch declares tiers, not literals", () => {
    test("all eleven members carry the frozen tier and no literal route keys", () => {
        const members = realProfile().members
        expect(members.length).toBe(11)
        for (const member of members) {
            // No member keeps a literal provider/model/reasoning_effort: the slot is the source.
            expect(member.provider).toBeUndefined()
            expect(member.model).toBeUndefined()
            expect(member.reasoning_effort).toBeUndefined()
            // role, executionPrompt and fallback survive; toolDeny survives exactly where it was.
            expect(typeof member.role).toBe("string")
            expect(typeof member.executionPrompt).toBe("string")
            expect(member.fallback).toEqual(FALLBACK)
            if (READONLY_MEMBERS.has(member.name)) {
                expect(member.toolDeny).toEqual(READONLY_DENY)
            } else {
                expect(member.toolDeny).toBeUndefined()
            }
            // Slot 4: the vision member is slot-routed like every other member — no exception.
            expect(member.tier).toBe(FROZEN_TIERS[member.name])
            expect(member.route).toBeUndefined()
        }
    })

    test("the plugin's own Config schema KEEPS `tier` and `route` (key-by-key, not merely no-throw)", () => {
        const profile = realProfile()
        const resolved = new Config({ profiles: { mpd: profile } })
        const kept = resolved.profiles.mpd.members
        expect(kept.length).toBe(11)
        for (let index = 0; index < kept.length; index += 1) {
            const name = profile.members[index].name
            // A future schema that starts stripping unknown keys reddens HERE instead of silently
            // routing every member by captain default — Vision Analyst's tier 4 included.
            expect("tier" in kept[index]).toBe(true)
            expect(kept[index].tier).toBe(FROZEN_TIERS[name])
            expect("route" in kept[index]).toBe(false)
        }
        // …and normalizeMember accepts those very members.
        const normalized = resolveTeamProfile(resolved.profiles, "mpd", 16)
        expect(normalized.members.map((member) => member.name)).toEqual(profile.members.map((member) => member.name))
        for (const member of normalized.members) {
            expect(member.tier).toBe(FROZEN_TIERS[member.name])
            expect(member.route).toBeUndefined()
        }
        const vision = normalized.members.find((member) => member.name === "Vision Analyst")
        expect(vision.tier).toBe(4)
    })
})

describe("B2 — profiles.js accepts `tier` and `route`", () => {
    const load = (members) => resolveTeamProfile(profileOf(members), "mpd", 16).members

    test("a positive-integer tier is carried", () => {
        const [member] = load([{ name: "Architect", role: "r", tier: 2 }])
        expect(member.tier).toBe(2)
        expect(member.route).toBeUndefined()
    })

    test("an all-or-nothing route is carried, with and without the optional effort", () => {
        const [withEffort] = load([{ name: "Route Literal", role: "r", route: VISION_ROUTE }])
        expect(withEffort.route).toEqual(VISION_ROUTE)
        const [without] = load([{ name: "Route Literal", role: "r", route: { provider: "deepseek-official", model: "m" } }])
        expect(without.route).toEqual({ provider: "deepseek-official", model: "m" })
        expect(Object.hasOwn(without.route, "reasoningEffort")).toBe(false)
    })

    test("declaring BOTH is refused, naming the member and both keys", () => {
        expect(() => load([{ name: "Architect", role: "r", tier: 1, route: VISION_ROUTE }]))
            .toThrow(/member "Architect" declares both "tier" and "route"/)
    })

    test("an unknown member key is still refused", () => {
        expect(() => load([{ name: "Architect", role: "r", tiers: 1 }])).toThrow(/is unknown/)
        expect(() => load([{ name: "Architect", role: "r", tier: 1, nope: true }])).toThrow(/nope is unknown/)
    })

    test("a tier that is not a positive integer is refused", () => {
        expect(() => load([{ name: "Architect", role: "r", tier: 0 }])).toThrow(/positive integer/)
        expect(() => load([{ name: "Architect", role: "r", tier: "1" }])).toThrow(/positive integer/)
    })

    test("a route missing provider/model, or carrying an unknown leaf, is refused", () => {
        expect(() => load([{ name: "Architect", role: "r", route: { provider: "deepseek-official" } }]))
            .toThrow(/route\.model must be a string/)
        expect(() => load([{ name: "Architect", role: "r", route: { provider: "deepseek-official", model: "" } }]))
            .toThrow(/route\.model must not be empty/)
        expect(() => load([{ name: "Architect", role: "r", route: { provider: "deepseek-official", model: "m", effort: "high" } }]))
            .toThrow(/route\.effort is unknown/)
    })
})

// ── the staging path ─────────────────────────────────────────────────────────────────────────
const captain = {
    id: "session-slot-routes",
    status: "idle",
    options: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    session: {
        header: { cwd: "/tmp" },
        requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" } }),
    },
}

/** A stub ctx exposing only what the staging loop touches: `ctx.get("mpdConfig")` and `ctx.llm`. */
function makeCtx({ teamModels, catalogs = {}, resolveCallConfig, hasService = true } = {}) {
    const mpdConfig = {
        get: (key) => key.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), { teamModels }),
    }
    return {
        get: (name) => (name === "mpdConfig" ? (hasService ? mpdConfig : undefined) : undefined),
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        llm: {
            listModels: async (provider) => catalogs[provider] ?? [],
            resolveCallConfig: resolveCallConfig ?? (async (request) => ({ ...request })),
        },
    }
}

function configWith(members) {
    return {
        stateDir: STATE_DIR,
        maxMembers: 16,
        memberProvider: "spawn",
        memberModel: "deepseek-v4-flash",
        executionPrompt: "do work",
        fallback: FALLBACK,
        memberMaxDepth: 1,
        profiles: profileOf(members),
        sessionTeamPolicy: { name: "MPD Default", approval: "required" },
    }
}

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-slot-routes-"))
    return {
        stateRoot: join(workspace, STATE_DIR),
        cleanup: () => rmSync(workspace, { recursive: true, force: true }),
    }
}

async function stage({ ctx, config, stateRoot, teamId = "mpd-slot-routes" }) {
    const { initializeProfileTeam } = await import("../lib/tools.js")
    return initializeProfileTeam({
        ctx,
        config,
        memberSelections: new Map(),
        captain,
        exec: { signal: undefined },
        stateRoot,
        teamName: teamId,
        teamId,
        profileName: "mpd",
        description: "slot route test",
        staged: true,
    })
}

const stagedMembers = (stateRoot, teamId) =>
    JSON.parse(readFileSync(join(stateRoot, teamId, "team.json"), "utf8")).members

const teamDirs = (stateRoot) => {
    try {
        return readdirSync(stateRoot).filter((name) => name !== "archive" && !name.startsWith("."))
    } catch {
        return []
    }
}

const SLOTS = {
    slot1: { provider: "deepseek-official", model: "slot-one", reasoningEffort: "max" },
    slot2: { provider: "deepseek-official", model: "slot-two", reasoningEffort: "high" },
    slot3: { provider: "deepseek-official", model: "slot-three", reasoningEffort: "low" },
    slot4: { provider: "deepseek-official", model: "slot-four-vision", reasoningEffort: "max" },
}

describe("B4 — a staged team takes each member's route from its slot", () => {
    test("tier 1/2/3/4 resolve to slot1/slot2/slot3/slot4; an explicit route wins over any slot", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            const config = configWith([
                { name: "Architect", role: "r", tier: 1, fallback: FALLBACK },
                { name: "Researcher", role: "r", tier: 2, fallback: FALLBACK },
                { name: "Deep Worker", role: "r", tier: 3, fallback: FALLBACK },
                { name: "Vision Analyst", role: "r", tier: 4, fallback: FALLBACK },
                { name: "Route Literal", role: "r", route: VISION_ROUTE, fallback: FALLBACK },
            ])
            await stage({ ctx: makeCtx({ teamModels: SLOTS }), config, stateRoot })
            const members = stagedMembers(stateRoot, "mpd-slot-routes")
            expect(members.map((member) => [member.provider, member.model, member.reasoningEffort])).toEqual([
                ["deepseek-official", "slot-one", "max"],
                ["deepseek-official", "slot-two", "high"],
                ["deepseek-official", "slot-three", "low"],
                ["deepseek-official", "slot-four-vision", "max"],
                ["deepseek-official", "deepseek-v4-flash-vision-exp", "high"],
            ])
        } finally {
            cleanup()
        }
    })

    test("a changed slot changes the staged route (the slot is the source, not a coincidence)", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            const config = configWith([{ name: "Deep Worker", role: "r", tier: 3, fallback: FALLBACK }])
            await stage({ ctx: makeCtx({ teamModels: SLOTS }), config, stateRoot, teamId: "before" })
            await stage({
                ctx: makeCtx({ teamModels: { ...SLOTS, slot3: { provider: "deepseek-official", model: "changed-model", reasoningEffort: "max" } } }),
                config,
                stateRoot,
                teamId: "after",
            })
            expect(stagedMembers(stateRoot, "before")[0].model).toBe("slot-three")
            expect(stagedMembers(stateRoot, "after")[0].model).toBe("changed-model")
            expect(stagedMembers(stateRoot, "after")[0].reasoningEffort).toBe("max")
        } finally {
            cleanup()
        }
    })

    test("SLOT 4 — CHANGING slot4 moves Vision Analyst while slots 1-3 and their members stay put", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            // The profile read is the REAL shipped YAML (`packages/mpd-bundle/cordis.patch.yml`),
            // never a hand-built imitation: tiers come from the bundle, not from this test.
            const profile = realProfile()
            const config = { ...configWith([]), profiles: { mpd: profile } }
            const ctxWith = (slot4) => makeCtx({ teamModels: { ...SLOTS, slot4 } })
            await stage({ ctx: ctxWith(VISION_SLOT_DEFAULT), config, stateRoot, teamId: "vision-before" })
            await stage({
                ctx: ctxWith({ provider: "deepseek-official", model: "changed-vision-model", reasoningEffort: "low" }),
                config,
                stateRoot,
                teamId: "vision-after",
            })
            const before = stagedMembers(stateRoot, "vision-before")
            const after = stagedMembers(stateRoot, "vision-after")
            expect(before.map((member) => member.name)).toEqual(after.map((member) => member.name))
            const byName = (members) => new Map(members.map((member) => [member.name, member]))
            const triples = (member) => [member.provider, member.model, member.reasoningEffort]
            const beforeByName = byName(before)
            const afterByName = byName(after)
            // The slot's DEFAULT is the member's former explicit route: staging on it is behaviour-preserving.
            expect(triples(beforeByName.get("Vision Analyst"))).toEqual(["deepseek-official", "deepseek-v4-flash-vision-exp", "high"])
            // …and the slot is the SOURCE: changing it moves the vision member.
            expect(triples(afterByName.get("Vision Analyst"))).toEqual(["deepseek-official", "changed-vision-model", "low"])
            // Slots 1-3 are untouched, and so is every member they route.
            for (const name of ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer", "Researcher", "Explorer", "Plan Reviewer", "Deep Worker", "Junior Engineer"]) {
                expect(triples(afterByName.get(name))).toEqual(triples(beforeByName.get(name)))
            }
            // A spot check that the untouched half is not accidentally the same for a wrong reason:
            // slot 1's value is the stub's, and slot 3's too.
            expect(triples(afterByName.get("Architect"))).toEqual(["deepseek-official", "slot-one", "max"])
            expect(triples(afterByName.get("Deep Worker"))).toEqual(["deepseek-official", "slot-three", "low"])
        } finally {
            cleanup()
        }
    })

    test("a member with NEITHER tier nor route keeps today's behaviour, with no mpdConfig service", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            const config = configWith([
                { name: "Plain", role: "r", fallback: FALLBACK },
                { name: "Literal", role: "r", provider: "deepseek-official", model: "deepseek-v4-pro", reasoning_effort: "low", fallback: FALLBACK },
            ])
            // hasService:false — the unchanged path must not require the config service at all.
            await stage({ ctx: makeCtx({ hasService: false }), config, stateRoot })
            const members = stagedMembers(stateRoot, "mpd-slot-routes")
            // captain-derived: provider from the captain's current route, model from config.memberModel,
            // effort from the captain's same-route effort — byte-for-byte the pre-wave behaviour.
            expect([members[0].provider, members[0].model, members[0].reasoningEffort])
                .toEqual(["deepseek-official", "deepseek-v4-flash", "high"])
            // literal member: its own provider/model/effort, untouched.
            expect([members[1].provider, members[1].model, members[1].reasoningEffort])
                .toEqual(["deepseek-official", "deepseek-v4-pro", "low"])
        } finally {
            cleanup()
        }
    })
})

describe("B5 / F1-F5 — an unusable slot fails loudly and writes NO team state", () => {
    const cases = [
        {
            label: "F1 no mpdConfig service",
            ctx: () => makeCtx({ hasService: false }),
            pattern: /member "Deep Worker" is routed by teamModels\.slot3 but the mpdConfig service/,
        },
        {
            label: "F2 the slot is absent",
            ctx: () => makeCtx({ teamModels: { slot1: SLOTS.slot1, slot2: SLOTS.slot2 } }),
            pattern: /member "Deep Worker" is routed by teamModels\.slot3, which is NOT configured/,
        },
        {
            label: "F3 the slot provider is empty (never replaced by the schema default)",
            ctx: () => makeCtx({ teamModels: { ...SLOTS, slot3: { provider: "  ", model: "slot-three", reasoningEffort: "low" } } }),
            pattern: /member "Deep Worker" is routed by teamModels\.slot3, which is INCOMPLETE \(missing provider\)/,
        },
        {
            label: "F3 the slot effort is empty (never silently dropped)",
            ctx: () => makeCtx({ teamModels: { ...SLOTS, slot3: { provider: "deepseek-official", model: "slot-three", reasoningEffort: "" } } }),
            pattern: /member "Deep Worker" is routed by teamModels\.slot3, which is INCOMPLETE \(missing reasoningEffort\)/,
        },
        {
            label: "a tier outside the four configured slots",
            ctx: () => makeCtx({ teamModels: SLOTS }),
            pattern: /member "Deep Worker" declares tier 9, but this bundle configures teamModels\.slot1\.\.slot4/,
            tier: 9,
        },
    ]
    for (const entry of cases) {
        test(`${entry.label}: names the member, the slot and the fix, and stages nothing`, async () => {
            const { stateRoot, cleanup } = fixture()
            try {
                const config = configWith([{ name: "Deep Worker", role: "r", tier: entry.tier ?? 3, fallback: FALLBACK }])
                await expect(stage({ ctx: entry.ctx(), config, stateRoot })).rejects.toThrow(entry.pattern)
                // LOUD and inert: no team record, no inbox, nothing on disk.
                expect(teamDirs(stateRoot)).toEqual([])
                expect(existsSync(join(stateRoot, "mpd-slot-routes"))).toBe(false)
            } finally {
                cleanup()
            }
        })
    }

    test("F4 an unknown slot model reports the member, the slot AND the underlying catalog text", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            const config = configWith([{ name: "Researcher", role: "r", tier: 2, fallback: FALLBACK }])
            const ctx = makeCtx({
                teamModels: { ...SLOTS, slot2: { provider: "deepseek-official", model: "ghost-model", reasoningEffort: "high" } },
                catalogs: { "deepseek-official": [{ id: "deepseek-v4-flash" }] },
            })
            await expect(stage({ ctx, config, stateRoot })).rejects.toThrow(
                /member "Researcher" route from teamModels\.slot2 failed: unknown member model "ghost-model" for provider "deepseek-official" \(available: deepseek-v4-flash\)/,
            )
            expect(teamDirs(stateRoot)).toEqual([])
        } finally {
            cleanup()
        }
    })

    test("F5 an unsupported slot effort surfaces UNSUPPORTED_REASONING_EFFORT with the slot named and is NEVER clamped", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            const seen = []
            const ctx = makeCtx({
                teamModels: { ...SLOTS, slot1: { provider: "deepseek-official", model: "slot-one", reasoningEffort: "ultra" } },
                resolveCallConfig: async (request) => {
                    seen.push(request)
                    const error = new Error(`provider "deepseek-official" model "slot-one" does not support reasoning effort "ultra"`)
                    error.code = "UNSUPPORTED_REASONING_EFFORT"
                    throw error
                },
            })
            const config = configWith([{ name: "Architect", role: "r", tier: 1, fallback: FALLBACK }])
            await expect(stage({ ctx, config, stateRoot })).rejects.toThrow(
                /member "Architect" route from teamModels\.slot1 failed: provider "deepseek-official" model "slot-one" does not support reasoning effort "ultra"/,
            )
            // The effort reached the adapter verbatim: not clamped, not aliased, not replaced.
            expect(seen[0].reasoningEffort).toBe("ultra")
            expect(teamDirs(stateRoot)).toEqual([])
        } finally {
            cleanup()
        }
    })

    test("a failure on a NON-slot route is rethrown unchanged (no slot is invented)", async () => {
        const { stateRoot, cleanup } = fixture()
        try {
            const ctx = makeCtx({
                hasService: false,
                resolveCallConfig: async () => { throw new Error("plain failure text") },
            })
            const config = configWith([{ name: "Route Literal", role: "r", route: VISION_ROUTE, fallback: FALLBACK }])
            await expect(stage({ ctx, config, stateRoot })).rejects.toThrow(/^plain failure text$/)
        } finally {
            cleanup()
        }
    })
})
