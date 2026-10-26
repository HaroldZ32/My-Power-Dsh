// The PER-AGENT model routes of the `mpd` settings namespace: `agentRoutes.<Agent>` with NO default
// layer (contract `.mpd/plans/agent-routes-per-agent.md` §1), the 33 knobs of the ONE declaration
// (§7), a TOTAL resolver (§2), the tolerated legacy `teamModels` node (§1) and the file-level
// no-data-loss lock.
//
// THE 2026-10-23 DELETION LOCK IS DELIBERATELY REVERSED HERE (contract §9 + amendment 2 §4): the
// retired test asserted that `agentRoutes` was GONE and that only twelve `teamModels` slot knobs
// existed. The unit of configuration is the AGENT again, so this file now asserts the NEW shape —
// eleven per-agent entries, 33 `agentRoutes` knob rows, a typed resolver union and the legacy block
// tolerated ONLY as a migration input.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AGENT_UNCONFIGURED_CODE,
  agentRouteEntryOfMember,
  agentRouteOfMember,
  agentUnconfiguredMessage,
  apply,
  droppedFallbacksOf,
  resolveAgentRoute,
  stripJsonc,
} from "../src/index"
import { writeBackLeaves } from "../src/bridge"
import * as schemaNamespace from "../src/settings-schema"
import * as configNamespace from "../src/index"
import {
  AGENT_ROUTE_KNOBS,
  AGENT_ROUTES_SCHEMA,
  ROSTER_AGENT_NAMES,
  SETTINGS_KNOBS,
  SettingsSchema,
  TEAM_MODEL_FALLBACK_OPTIONS,
  TEAM_MODEL_SLOT_GROUPS,
  TEAM_MODEL_SLOT_IMPACT,
  TEAM_MODEL_SLOT_IMPACT_OVERRIDES,
  agentRouteLeafSentence,
  teamModelLeafSentence,
  teamModelMembers,
  teamModelSlotHeading,
  teamModelSlotImpact,
} from "../src/settings-schema"

// Sandbox directories created by the tests, removed in `afterEach` so a failure cannot leak temp state.
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
  delete process.env.DSH_WORKSPACE_ROOT
})

/** A sandbox workspace (`<dir>/ws`) plus an isolated user-home layer dir. */
function sandbox(): { root: string; file: string; home: string } {
  // One unique temp parent per call, so no two tests can ever share a config file.
  const dir = mkdtempSync(join(tmpdir(), "mpd-agent-routes-"))
  temps.push(dir)
  // The workspace the config layer is pointed at through `DSH_WORKSPACE_ROOT`.
  const root = join(dir, "ws")
  // The isolated `DSH_HOME`, so layer L1 resolves inside the sandbox and never the real home.
  const home = join(dir, "home")
  mkdirSync(join(root, ".mpd"), { recursive: true })
  mkdirSync(home, { recursive: true })
  return { root, file: join(root, ".mpd", "mpd.jsonc"), home }
}

/** Mount the row on the same stub-ctx harness the config tests use; returns the mpdConfig service and the tools. */
function mount(root: string, home: string, logs: string[] = []): { service: any; tools: any[] } {
  process.env.DSH_HOME = home
  process.env.DSH_WORKSPACE_ROOT = root
  // Every tool the row registered during this mount, so the real `mpd_config_get` execute can be called.
  const tools: any[] = []
  // The `mpdConfig` service value, assigned by the stub ctx `provide` while `apply` runs.
  let service: any = null
  apply({ tools: { register: (t: any) => tools.push(t) }, provide: (_n: string, v: any) => { service = v }, logger: { warn: (line: string) => logs.push(String(line)) } } as any, {})
  return { service, tools }
}

// The three route leaves, in the order every declared row must follow.
const ROUTE_LEAVES = ["provider", "model", "reasoningEffort"] as const

describe("§1 — the `agentRoutes` schema: one entry per agent, ZERO defaults", () => {
  test("the schema carries no route default: a workspace that configured nothing resolves eleven EMPTY entries", () => {
    // The resolved config of a workspace that declared nothing: eleven empty entry objects, never a
    // provider/model/effort — the built-in default layer this contract forbids.
    /** The resolved config of a workspace that declared nothing. */
    const resolved: any = (SettingsSchema as any)({})
    expect(Object.keys(resolved.agentRoutes)).toEqual([...ROSTER_AGENT_NAMES])
    for (const agent of ROSTER_AGENT_NAMES) expect(resolved.agentRoutes[agent]).toEqual({})
    // A partial declaration keeps ONLY the leaves the user wrote; no sibling leaf is filled in.
    const partial: any = (SettingsSchema as any)({ agentRoutes: { Architect: { model: "deepseek-v4-pro" } } })
    expect(partial.agentRoutes.Architect).toEqual({ model: "deepseek-v4-pro" })
  })

  test("ZERO `.default()` on any route leaf — the contract's real prohibition", () => {
    // The LEAF nodes are the subject: a `.default()` there would materialize a provider/model/effort
    // into the row config and beat the user's file. The container's implicit `{}` (the vendored
    // schemastery's object behaviour, measured long before this wave) is the empty-entry residue,
    // and `rowKnobLayer` strips it so an absent block stays ABSENT — asserted below and by the
    // `mpd_config_get` arms.
    /** The first agent entry node as the settings form reads it. */
    /** The first agent entry node as the settings form reads it. */
    const entry = (AGENT_ROUTES_SCHEMA as any).dict.Architect
    expect(Object.keys(entry.dict)).toEqual(["provider", "model", "reasoningEffort"])
    for (const leaf of ["provider", "model", "reasoningEffort"]) expect(entry.dict[leaf].meta?.default).toBeUndefined()
    // The semantic consequence: an absent declaration resolves an EMPTY entry, never a route.
    expect((SettingsSchema as any)({}).agentRoutes.Architect).toEqual({})
  })

  test("the legacy `teamModels` node is TOLERATED: it validates and passes through unchanged", () => {
    // A row config / profile patch from v0.15.5 declares the slot tree; the schema must accept it so
    // that boot succeeds, and it must keep the bytes as the migration source.
    const legacy = { slot1: { provider: "p", model: "m", reasoningEffort: "max" }, slot4: { provider: "v", model: "vm" } }
    /** The resolved config of a workspace whose file still declares the legacy block. */
    const resolved: any = (SettingsSchema as any)({ teamModels: legacy })
    expect(resolved.teamModels).toEqual(legacy)
    // Absent is ABSENT: a permissive node with no declaration materializes nothing.
    expect((SettingsSchema as any)({}).teamModels).toBeUndefined()
  })

  test("the eleven names come from the groups' own membership, in group order", () => {
    expect(ROSTER_AGENT_NAMES).toEqual([
      "Architect", "Planner", "Reviewer", "Lead", "Senior Engineer",
      "Researcher", "Explorer", "Plan Reviewer",
      "Deep Worker", "Junior Engineer",
      "Vision Analyst",
    ])
    // The groups survive, as DISPLAY/BULK-EDIT only — the roster's own name list above is the table's.
    expect(TEAM_MODEL_SLOT_GROUPS.slot1.members).toEqual(["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"])
    expect(TEAM_MODEL_SLOT_GROUPS.slot4.members).toEqual(["Vision Analyst"])
  })
})

describe("the 2026-10-23 DELETION LOCK, deliberately REVERSED (§9, amendment 2 §4)", () => {
  test("the agentRoutes layer EXISTS with the names, the schema and the knobs the retired test deleted", () => {
    // The module namespaces are the subject: the symbols the old lock asserted ABSENT must now exist
    // and carry the new shape, while the truly deleted default layer stays deleted.
    const schemaModule = schemaNamespace as Record<string, unknown>
    expect(schemaModule.TEAM_MODEL_SLOT_DEFAULTS).toBeUndefined()
    expect(Array.isArray(schemaModule.ROSTER_AGENT_NAMES)).toBe(true)
    expect((schemaModule.ROSTER_AGENT_NAMES as readonly string[]).length).toBe(11)
    expect(schemaModule.AGENT_ROUTES_SCHEMA).toBeDefined()
    expect(Array.isArray(schemaModule.AGENT_ROUTE_KNOBS)).toBe(true)
    expect((schemaModule.AGENT_ROUTE_KNOBS as readonly unknown[]).length).toBe(33)
    expect(typeof schemaModule.agentRouteLeafSentence).toBe("function")
    // The config module's own half of the reversal (and the still-deleted defaulting helper).
    const configModule = configNamespace as Record<string, unknown>
    expect(configModule.withTeamModelsDefaults).toBeUndefined()
    expect(typeof configModule.agentRouteEntryOfMember).toBe("function")
    expect(typeof configModule.resolveAgentRoute).toBe("function")
  })
})

describe("§7 — thirty-three per-agent rows in the ONE declaration, in group order", () => {
  // The thirty-three agentRoutes rows of the ONE declaration, which every assertion below is about.
  const routeKnobs = SETTINGS_KNOBS.filter((knob) => knob.path[0] === "agentRoutes")

  test("exactly thirty-three new rows, after the original thirteen and before the TUI knob", () => {
    // 47 = the thirteen original knobs + the eleven agents' three leaves + `tui.dashboardKey` LAST.
    expect(SETTINGS_KNOBS).toHaveLength(47)
    expect(routeKnobs).toHaveLength(33)
    // The legacy slot tree leaves no row behind: no knob path may address `teamModels`.
    expect(SETTINGS_KNOBS.filter((knob) => knob.path[0] === "teamModels")).toHaveLength(0)
    expect(SETTINGS_KNOBS.slice(0, 13).map((knob) => [...knob.path])).toEqual([
      ["hashline", "maxDiffChars"],
      ["commentChecker", "autoCheck"],
      ["ulw", "maxRounds"],
      ["memory", "vcs"],
      ["team", "stateDir"],
      ["boulder", "dir"],
      ["watchdog", "enabled"],
      ["watchdog", "warnSilenceMs"],
      ["watchdog", "tickIntervalMs"],
      ["watchdog", "warnStreakToEscalate"],
      ["watchdog", "actionOnEscalate"],
      ["watchdog", "toolInFlightMaxMs"],
      ["watchdog", "holdTtlMs"],
    ])
    // Every agent, every leaf, in the roster's own order — the enumerated table, no free-typed key.
    expect(routeKnobs.map((knob) => [...knob.path])).toEqual(
      ROSTER_AGENT_NAMES.flatMap((agent) => ROUTE_LEAVES.map((leaf) => ["agentRoutes", agent, leaf])),
    )
    // The TUI surface's own knob stays LAST, so every index-keyed assertion keeps its meaning.
    expect([...SETTINGS_KNOBS[SETTINGS_KNOBS.length - 1].path]).toEqual(["tui", "dashboardKey"])
  })

  test("every row is a select with the declared fallback list and a label/zh pair", () => {
    expect([...TEAM_MODEL_FALLBACK_OPTIONS.provider]).toEqual(["deepseek-official"])
    expect([...TEAM_MODEL_FALLBACK_OPTIONS.reasoningEffort]).toEqual(["off", "low", "high", "max"])
    for (const knob of routeKnobs) {
      // The leaf this row sets, used to look up the fallback option list the row must mirror.
      const leaf = String(knob.path[2]) as keyof typeof TEAM_MODEL_FALLBACK_OPTIONS
      expect(knob.kind).toBe("select")
      expect([...(knob.options ?? [])]).toEqual([...TEAM_MODEL_FALLBACK_OPTIONS[leaf]])
      expect(knob.label.length).toBeGreaterThan(0)
      expect(knob.zh.length).toBeGreaterThan(0)
    }
    // The exact first row proves the label names the AGENT (the unit) plus its display group.
    expect(routeKnobs[0].label).toBe("Architect provider (heavy members)")
    expect(routeKnobs[0].zh).toBe("Architect 提供商（重推理成员）")
    expect(routeKnobs[32].label).toBe("Vision Analyst reasoning effort (vision member)")
  })

  test("every hint names its dotted mpd.jsonc key and carries the agent's own sentence", () => {
    for (const knob of routeKnobs) {
      // The agent this row configures, as a display name the sentence generator accepts.
      const agent = String(knob.path[1])
      // The leaf this row sets.
      const leaf = String(knob.path[2]) as keyof typeof TEAM_MODEL_FALLBACK_OPTIONS
      expect(knob.semantics).toBe(agentRouteLeafSentence(agent, leaf, "en"))
      expect(knob.semanticsZh).toBe(agentRouteLeafSentence(agent, leaf, "zh"))
      expect(String(knob.hint).startsWith(String(knob.semantics))).toBe(true)
      expect(String(knob.hint)).toContain(`mpd.jsonc agentRoutes.${agent}.${leaf}`)
    }
    // The sentence states the UNIT and refuses to let a missing leaf pass silently.
    expect(routeKnobs[0].semantics).toContain("Architect's own provider")
    expect(routeKnobs[0].semantics).toContain("AGENT_UNCONFIGURED")
    // The vision member's own rows state the image-input constraint.
    expect(agentRouteLeafSentence("Vision Analyst", "model", "en")).toContain("MUST accept image input")
  })

  test("the group copy survives for the bulk-edit panel, and names the group's own members", () => {
    expect(teamModelMembers("slot2", "en")).toBe("Researcher, Explorer, Plan Reviewer")
    expect(teamModelSlotHeading("slot1", "en")).toBe("Slot 1 — heavy members (Architect, Planner, Reviewer, Lead, Senior Engineer)")
    expect(teamModelSlotImpact("slot4", "en")).toBe(TEAM_MODEL_SLOT_IMPACT_OVERRIDES.slot4!.en)
    expect(teamModelSlotImpact("slot1", "en")).toBe(TEAM_MODEL_SLOT_IMPACT.en)
    // The group templates are still declared once and interpolate the group identity.
    expect(teamModelLeafSentence("slot2", "provider", "en")).toContain("analysis members (Researcher, Explorer, Plan Reviewer)")
  })
})

describe("§2 — `resolveAgentRoute`: pure, total, and independent per agent", () => {
  /** A config with two DIFFERENT routes, the cross-talk subject of the first arm. */
  const twoRoutes = {
    agentRoutes: {
      Architect: { provider: "p1", model: "m1", reasoningEffort: "max" },
      "Deep Worker": { provider: "p2", model: "m2", reasoningEffort: "high", fallbacks: [{ provider: "bp", model: "bm" }] },
    },
  }

  test("two agents with different routes resolve independently — no cross-talk", () => {
    expect(resolveAgentRoute("Architect", twoRoutes)).toEqual({ ok: true, agent: "Architect", route: { provider: "p1", model: "m1", reasoningEffort: "max" } })
    expect(resolveAgentRoute("Deep Worker", twoRoutes)).toEqual({
      ok: true,
      agent: "Deep Worker",
      route: { provider: "p2", model: "m2", reasoningEffort: "high", fallbacks: [{ provider: "bp", model: "bm" }] },
    })
    // The untouched members stay unconfigured: configuring one agent never configures another.
    expect(resolveAgentRoute("Planner", twoRoutes)).toMatchObject({ ok: false, reason: "unconfigured", agent: "Planner" })
  })

  test("lookup is case- and separator-insensitive on the member's functional NAME", () => {
    for (const spelling of ["Architect", "architect", "ARCHITECT", " architect "]) {
      expect(resolveAgentRoute(spelling, twoRoutes)).toMatchObject({ ok: true, agent: "Architect" })
    }
    // A hand-written KEY spelling matches too (the normalizer runs on both sides).
    const oddKeys = { agentRoutes: { "senior_engineer": { provider: "p", model: "m" } } }
    expect(resolveAgentRoute("Senior Engineer", oddKeys)).toEqual({ ok: true, agent: "Senior Engineer", route: { provider: "p", model: "m" } })
    expect(agentRouteEntryOfMember("senior-engineer", oddKeys)).toEqual({ provider: "p", model: "m" })
  })

  test("an absent entry => typed `unconfigured` naming BOTH missing leaf paths", () => {
    /** The typed resolution of an agent the workspace never configured. */
    const absent = resolveAgentRoute("Planner", {})
    expect(absent).toEqual({ ok: false, reason: "unconfigured", agent: "Planner", missing: ["agentRoutes.Planner.provider", "agentRoutes.Planner.model"] })
    // A half-filled entry reports only the leaf it still needs.
    const half = resolveAgentRoute("Planner", { agentRoutes: { Planner: { model: "m" } } })
    expect(half).toEqual({ ok: false, reason: "unconfigured", agent: "Planner", missing: ["agentRoutes.Planner.provider"] })
    // A non-roster name is NOT an unconfigured agent: it is unrouted (extension roles keep their chain).
    const unrouted = resolveAgentRoute("not-a-roster-member", {})
    expect(unrouted).toEqual({ ok: false, reason: "unrouted" })
    // THE ASYMMETRY, asserted on purpose: the unrouted arm carries no `agent` field.
    expect(Object.prototype.hasOwnProperty.call(unrouted, "agent")).toBe(false)
  })

  test("a malformed leaf => typed `invalid` with the offending path", () => {
    expect(resolveAgentRoute("Vision Analyst", { agentRoutes: { "Vision Analyst": { provider: "p", model: 7 } } }))
      .toEqual({ ok: false, reason: "invalid", agent: "Vision Analyst", problem: "agentRoutes.Vision Analyst.model" })
    expect(resolveAgentRoute("Vision Analyst", { agentRoutes: { "Vision Analyst": { provider: "p", model: "m", reasoningEffort: 9 } } }))
      .toEqual({ ok: false, reason: "invalid", agent: "Vision Analyst", problem: "agentRoutes.Vision Analyst.reasoningEffort" })
    // A non-object entry is invalid at the ENTRY path, never treated as absent.
    expect(resolveAgentRoute("Vision Analyst", { agentRoutes: { "Vision Analyst": "deepseek-v4-flash" } }))
      .toEqual({ ok: false, reason: "invalid", agent: "Vision Analyst", problem: "agentRoutes.Vision Analyst" })
    // `null` is the JSON spelling of "unset", not an invalid value.
    expect(resolveAgentRoute("Vision Analyst", { agentRoutes: { "Vision Analyst": { provider: "p", model: "m", reasoningEffort: null } } }))
      .toMatchObject({ ok: true, route: { provider: "p", model: "m" } })
  })

  test("the fallback chain is sanitized once: malformed entries are DROPPED, a non-array chain dropped whole", () => {
    /** The resolution of an entry whose chain carries malformed members. */
    const resolution = resolveAgentRoute("Architect", {
      agentRoutes: {
        Architect: {
          provider: "p",
          model: "m",
          fallbacks: [{ provider: "bp1", model: "bm1", reasoningEffort: "low" }, { provider: "bp2" }, { provider: "bp3", model: "bm3", reasoningEffort: 9 }],
        },
      },
    })
    expect(resolution).toMatchObject({ ok: true, route: { fallbacks: [{ provider: "bp1", model: "bm1", reasoningEffort: "low" }] } })
    // The dropped count is derived from the SAME sanitizer (the service reports it in one log line).
    expect(droppedFallbacksOf("Architect", {
      agentRoutes: {
        Architect: {
          provider: "p",
          model: "m",
          fallbacks: [{ provider: "bp1", model: "bm1", reasoningEffort: "low" }, { provider: "bp2" }, { provider: "bp3", model: "bm3", reasoningEffort: 9 }],
        },
      },
    })).toBe(2)
    expect(droppedFallbacksOf("Architect", { agentRoutes: { Architect: { provider: "p", model: "m", fallbacks: "nope" } } })).toBe(1)
    // A valid chain with no malformed entry reports nothing and resolves no `fallbacks` key at all.
    expect(droppedFallbacksOf("Architect", twoRoutes)).toBe(0)
    expect(resolveAgentRoute("Architect", { agentRoutes: { Architect: { provider: "p", model: "m", fallbacks: [] } } }))
      .toEqual({ ok: true, agent: "Architect", route: { provider: "p", model: "m" } })
  })

  test("`agentRouteOfMember` is TOTAL: it answers a route only for a usable entry", () => {
    expect(agentRouteOfMember("Architect", twoRoutes)).toEqual({ provider: "p1", model: "m1", reasoningEffort: "max" })
    expect(agentRouteOfMember("Planner", twoRoutes)).toBeUndefined()
    expect(agentRouteOfMember("Vision Analyst", { agentRoutes: { "Vision Analyst": { provider: 7 } } })).toBeUndefined()
    expect(agentRouteOfMember("not-a-roster-member", twoRoutes)).toBeUndefined()
    // NEVER throws: every malformed shape above answered a typed state instead of an exception.
    expect(() => resolveAgentRoute("Architect", null)).not.toThrow()
    expect(() => resolveAgentRoute("Architect", { agentRoutes: null })).not.toThrow()
  })

  test("the AGENT_UNCONFIGURED sentence names the agent, both recovery paths and the no-write fact", () => {
    expect(AGENT_UNCONFIGURED_CODE).toBe("AGENT_UNCONFIGURED")
    /** The ONE sentence a spawn applier would throw for that agent. */
    const sentence = agentUnconfiguredMessage("Planner", "missing agentRoutes.Planner.provider, agentRoutes.Planner.model")
    expect(sentence).toStartWith("AGENT_UNCONFIGURED: Planner is not usable")
    expect(sentence).toContain("agentRoutes.Planner.provider")
    expect(sentence).toContain("agentRoutes.Planner.model")
    expect(sentence).toContain("/mpd-model")
    expect(sentence).toContain("agentRoutes.Planner in .mpd/mpd.jsonc")
    expect(sentence).toContain("nothing was written and no child was started")
  })
})

describe("the mounted service: the typed read and the raw pass-through", () => {
  test("the service answers per agent from the LIVE file layers, and never throws", () => {
    /** One sandbox workspace whose config file this case controls. */
    const { root, file, home } = sandbox()
    writeFileSync(file, JSON.stringify({ agentRoutes: { Architect: { provider: "gateway", model: "gpt-x" } } }))
    /** The mounted row's `mpdConfig` service. */
    const { service } = mount(root, home)
    expect(service.agentRouteResolutionOf("Architect")).toEqual({ ok: true, agent: "Architect", route: { provider: "gateway", model: "gpt-x" } })
    expect(service.agentRouteOf("Architect")).toEqual({ provider: "gateway", model: "gpt-x" })
    // An absent entry and a non-roster name are typed states, not exceptions.
    expect(service.agentRouteResolutionOf("Planner")).toMatchObject({ ok: false, reason: "unconfigured", agent: "Planner" })
    expect(service.agentRouteResolutionOf("extension-role")).toEqual({ ok: false, reason: "unrouted" })
    expect(service.agentRouteOf("Planner")).toBeUndefined()
    // The retired names are GONE from the service surface, never aliased.
    expect(service.slotResolutionOf).toBeUndefined()
    expect(service.teamModelRouteOf).toBeUndefined()
  })

  test("a malformed fallback entry is dropped with exactly ONE log line", () => {
    /** One sandbox workspace whose config file this case controls. */
    const { root, file, home } = sandbox()
    writeFileSync(file, JSON.stringify({ agentRoutes: { Architect: { provider: "p", model: "m", fallbacks: [{ provider: "bp" }] } } }))
    /** Every log line the row emitted during this mount and read. */
    const logs: string[] = []
    /** The mounted row's service, wired to the log capture above. */
    const { service } = mount(root, home, logs)
    /** The typed read the service answered for the configured agent. */
    const resolution = service.agentRouteResolutionOf("Architect")
    // The malformed entry is DROPPED: the usable route carries no `fallbacks` key at all.
    expect(resolution).toEqual({ ok: true, agent: "Architect", route: { provider: "p", model: "m" } })
    /** The drop line the service reported, which must appear exactly once. */
    const dropLines = logs.filter((line) => line.includes("dropped 1 malformed fallback entry"))
    expect(dropLines).toHaveLength(1)
    expect(dropLines[0]).toContain("Architect")
  })

  test("the legacy block passes through `mpd_config_get` verbatim but is never read for routing", () => {
    /** One sandbox workspace whose config file this case controls. */
    const { root, file, home } = sandbox()
    writeFileSync(file, JSON.stringify({
      teamModels: { slot1: { provider: "legacy-p", model: "legacy-m" } },
      agentRoutes: { Architect: { provider: "new-p", model: "new-m" } },
    }))
    /** The mounted row's `mpdConfig` service. */
    const { service } = mount(root, home)
    // The raw pass-through: the legacy block is answerable, unchanged.
    expect(service.get("teamModels.slot1")).toEqual({ provider: "legacy-p", model: "legacy-m" })
    // Routing comes from the agent's OWN entry — the slot tree is not consulted.
    expect(service.agentRouteOf("Architect")).toEqual({ provider: "new-p", model: "new-m" })
    // A group whose legacy slot says something but whose agent entry is absent stays UNCONFIGURED.
    expect(service.agentRouteResolutionOf("Planner")).toMatchObject({ ok: false, reason: "unconfigured" })
  })

  test("`mpd_config_get`'s description names agentRoutes and no longer advertises the slot table", async () => {
    /** One sandbox workspace whose config file this case controls. */
    const { root, file, home } = sandbox()
    /** The mounted service and every tool the row registered. */
    const { service, tools } = mount(root, home)
    /** The config-read tool the row registered. */
    const tool = tools.find((candidate) => candidate.name === "mpd_config_get")
    expect(tool).toBeDefined()
    expect(String(tool.description)).toContain("agentRoutes.<Agent>")
    expect(String(tool.description)).not.toContain("teamModels.slot1|slot2|slot3|slot4")
    // The read is behaviourally whole: an absent block reads as ABSENT, a declared one verbatim.
    /** The tool's execute half, called here as a consumer would. */
    const get = tool as { execute: (args: Record<string, unknown>) => Promise<any> }
    /** The key-less read: an absent block must read as ABSENT. */
    const noKey = await get.execute({})
    expect(noKey.config).not.toHaveProperty("agentRoutes")
    expect(noKey.config).not.toHaveProperty("teamModels")
    expect(JSON.parse(JSON.stringify(noKey))).toEqual(noKey) // host lossless round-trip
    // A declared entry answers VERBATIM, fallback chain included — no leaf is rewritten.
    writeFileSync(file, '{ "agentRoutes": { "Architect": { "provider": "gateway", "model": "gpt-x", "fallbacks": [{ "provider": "backup", "model": "b" }] } } }')
    service.reload({ agent: { session: { header: { cwd: root } } } })
    /** The keyed read of the declared entry. */
    const byKey = await get.execute({ key: "agentRoutes.Architect" })
    expect(byKey.value).toEqual({ provider: "gateway", model: "gpt-x", fallbacks: [{ provider: "backup", model: "b" }] })
  })
})

describe("the FILE no-data-loss lock: a live `agentRoutes` block survives an unrelated save", () => {
  test("saving an unrelated leaf leaves the old block byte-identical", () => {
    // A workspace file carrying an unrelated knob plus a full route table.
    /** The exact bytes a save of `ulw.maxRounds` must leave untouched around the block. */
    const original = `{\n  "ulw": { "maxRounds": 3 },\n  "agentRoutes": { "Deep Worker": { "provider": "gateway", "model": "deepseek-v4-pro" } }\n}\n`
    /** The file the writer targets (inside one sandbox workspace). */
    const { root, file } = sandbox()
    writeFileSync(file, original)
    // The settings-document save writes ONE leaf; it never rewrites the file wholesale.
    /** The writer's report for that single-leaf delta. */
    const report = writeBackLeaves([{ root, file }], [{ path: ["ulw", "maxRounds"], value: 11 }])
    expect(report.results[0]?.outcome).toBe("written")
    /** The bytes after the save, where the untouched block must still be present verbatim. */
    const text = readFileSync(file, "utf8")
    expect(text).toContain('"agentRoutes": { "Deep Worker": { "provider": "gateway", "model": "deepseek-v4-pro" } }')
    expect(JSON.parse(stripJsonc(text))).toEqual({
      ulw: { maxRounds: 11 },
      agentRoutes: { "Deep Worker": { provider: "gateway", model: "deepseek-v4-pro" } },
    })
  })
})
