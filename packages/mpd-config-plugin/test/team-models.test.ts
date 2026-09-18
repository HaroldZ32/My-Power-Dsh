// The three team-model slots of the `mpd` settings namespace: the schema defaults (A1), the nine
// knobs of the ONE declaration (A3, plus the declaration half of A6) and the config layer's
// READ-PATH materialisation (A2). Plan of record §3.1; frozen contract §1.1/§2.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, withTeamModelsDefaults } from "../src/index"
import {
  BRIDGE_DISCLOSURE,
  BRIDGE_NOT_LOST,
  SETTINGS_KNOBS,
  SettingsSchema,
  TEAM_MODEL_FALLBACK_OPTIONS,
  TEAM_MODEL_SLOTS,
  TEAM_MODEL_SLOT_DEFAULTS,
  TEAM_MODEL_SLOT_GROUPS,
  TEAM_MODEL_SLOT_IMPACT,
  knobHint,
  teamModelLeafSentence,
  teamModelMembers,
  teamModelSlotHeading,
} from "../src/settings-schema"

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
  delete process.env.DSH_WORKSPACE_ROOT
})

/** A sandbox workspace (`<dir>/ws`) plus an isolated user-home layer dir. */
function sandbox(): { root: string; file: string; home: string } {
  const dir = mkdtempSync(join(tmpdir(), "mpd-team-models-"))
  temps.push(dir)
  const root = join(dir, "ws")
  const home = join(dir, "home")
  mkdirSync(join(root, ".mpd"), { recursive: true })
  mkdirSync(home, { recursive: true })
  return { root, file: join(root, ".mpd", "mpd.jsonc"), home }
}

/** Mount the row on the same stub-ctx harness the config tests use; returns the mpdConfig service and the tools. */
function mount(root: string, home: string): { service: any; tools: any[] } {
  process.env.DSH_HOME = home
  process.env.DSH_WORKSPACE_ROOT = root
  const tools: any[] = []
  let service: any = null
  apply({ tools: { register: (t: any) => tools.push(t) }, provide: (_n: string, v: any) => { service = v } } as any, {})
  return { service, tools }
}

const SLOT_LEAVES = ["provider", "model", "reasoningEffort"] as const
const KNOWN_CLASSES: Record<string, readonly string[]> = {
  slot1: ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"],
  slot2: ["Researcher", "Explorer", "Plan Reviewer"],
  slot3: ["Deep Worker", "Junior Engineer"],
}

describe("A1 — the schema carries the three slots with the frozen literal defaults", () => {
  test("the defaults are provider deepseek-official / model deepseek-v4-flash at max, high, high", () => {
    expect(TEAM_MODEL_SLOTS).toEqual(["slot1", "slot2", "slot3"])
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot1).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" })
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot2).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" })
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot3).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" })
  })

  test("the schema resolves those defaults when a config supplies nothing", () => {
    const resolved: any = (SettingsSchema as any)({})
    expect(resolved.teamModels).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
  })

  test("the schema merges a partial block over the per-slot defaults", () => {
    const resolved: any = (SettingsSchema as any)({ teamModels: { slot2: { model: "deepseek-v4-pro" } } })
    expect(resolved.teamModels.slot2).toEqual({ provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" })
    expect(resolved.teamModels.slot1).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
    expect(resolved.teamModels.slot3).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot3)
  })
})

describe("A3 — nine knobs in the ONE declaration, in slot order", () => {
  const slotKnobs = SETTINGS_KNOBS.filter((knob) => knob.path[0] === "teamModels")

  test("exactly nine new rows, after the original thirteen", () => {
    expect(SETTINGS_KNOBS).toHaveLength(22)
    expect(slotKnobs).toHaveLength(9)
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
    expect(slotKnobs.map((knob) => [...knob.path])).toEqual(
      TEAM_MODEL_SLOTS.flatMap((slot) => SLOT_LEAVES.map((leaf) => ["teamModels", slot, leaf])),
    )
  })

  test("every row is a select with the declared fallback list, and carries a label/zh pair", () => {
    expect([...TEAM_MODEL_FALLBACK_OPTIONS.provider]).toEqual(["deepseek-official"])
    expect([...TEAM_MODEL_FALLBACK_OPTIONS.model]).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    expect([...TEAM_MODEL_FALLBACK_OPTIONS.reasoningEffort]).toEqual(["off", "low", "high", "max"])
    for (const knob of slotKnobs) {
      const leaf = String(knob.path[2]) as keyof typeof TEAM_MODEL_FALLBACK_OPTIONS
      expect(knob.kind).toBe("select")
      expect([...(knob.options ?? [])]).toEqual([...TEAM_MODEL_FALLBACK_OPTIONS[leaf]])
      expect((knob.options ?? []).length).toBeGreaterThan(0)
      expect(knob.label.length).toBeGreaterThan(0)
      expect(knob.zh.length).toBeGreaterThan(0)
    }
    // The exact labels/zh the two front doors mirror (the card's FIELDS must match these element-wise).
    // Each label names the GROUP the slot routes, so a row says what the slot IS without a hint.
    expect(slotKnobs.map((knob) => knob.label)).toEqual([
      "Slot 1 provider (heavy members)", "Slot 1 model (heavy members)", "Slot 1 reasoning effort (heavy members)",
      "Slot 2 provider (analysis members)", "Slot 2 model (analysis members)", "Slot 2 reasoning effort (analysis members)",
      "Slot 3 provider (execution members)", "Slot 3 model (execution members)", "Slot 3 reasoning effort (execution members)",
    ])
    expect(slotKnobs.map((knob) => knob.zh)).toEqual([
      "槽位 1 提供商（重推理成员）", "槽位 1 模型（重推理成员）", "槽位 1 推理强度（重推理成员）",
      "槽位 2 提供商（分析型成员）", "槽位 2 模型（分析型成员）", "槽位 2 推理强度（分析型成员）",
      "槽位 3 提供商（执行型成员）", "槽位 3 模型（执行型成员）", "槽位 3 推理强度（执行型成员）",
    ])
  })

  test("the slot copy states the group and its members: heading, impact and per-leaf sentences", () => {
    // The group table is the ONE input the copy interpolates — the member list in the group's own order.
    expect(TEAM_MODEL_SLOT_GROUPS.slot1.members).toEqual(["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"])
    expect(TEAM_MODEL_SLOT_GROUPS.slot2.members).toEqual(["Researcher", "Explorer", "Plan Reviewer"])
    expect(TEAM_MODEL_SLOT_GROUPS.slot3.members).toEqual(["Deep Worker", "Junior Engineer"])
    expect(teamModelMembers("slot2", "zh")).toBe("Researcher、Explorer、Plan Reviewer")
    expect(teamModelMembers("slot2", "en")).toBe("Researcher, Explorer, Plan Reviewer")
    // The heading renders above a slot's three rows; the impact line is the one-line consequence.
    expect(teamModelSlotHeading("slot1", "en")).toBe("Slot 1 — heavy members (Architect, Planner, Reviewer, Lead, Senior Engineer)")
    expect(teamModelSlotHeading("slot2", "zh")).toBe("槽位 2 —— 分析型成员（Researcher、Explorer、Plan Reviewer）")
    expect(teamModelSlotHeading("slot3", "en")).toBe("Slot 3 — execution members (Deep Worker, Junior Engineer)")
    expect(TEAM_MODEL_SLOT_IMPACT.zh).toContain("点名成员与槽位")
    expect(TEAM_MODEL_SLOT_IMPACT.en).toContain("fails team creation loudly")
    // The nine knobs carry their OWN sentence per leaf, in both languages, and the composed hint
    // LEADS with the English one.
    for (const knob of slotKnobs) {
      const slot = String(knob.path[1]) as "slot1" | "slot2" | "slot3"
      const leaf = String(knob.path[2]) as "provider" | "model" | "reasoningEffort"
      expect(knob.semantics).toBe(teamModelLeafSentence(slot, leaf, "en"))
      expect(knob.semanticsZh).toBe(teamModelLeafSentence(slot, leaf, "zh"))
      expect(String(knob.hint).startsWith(String(knob.semantics))).toBe(true)
      expect(String(knob.hint).indexOf("mpd.jsonc ")).toBeGreaterThan(String(knob.semantics).length - 1)
    }
    // A slot's sentence names ITS OWN group's members, not another slot's.
    const slot2Provider = String(slotKnobs[3].semantics)
    expect(slot2Provider).toContain("analysis members (Researcher, Explorer, Plan Reviewer)")
    expect(slot2Provider).not.toContain("Architect")
    // and the zh sentence names the zh group.
    expect(String(slotKnobs[3].semanticsZh)).toContain("分析型成员（Researcher、Explorer、Plan Reviewer）")
  })

  test("every hint names its dotted mpd.jsonc key, the disclosure, the not-lost clause and its member class", () => {
    // The helper is the ONE builder the hints come from; without semantics it emits exactly the
    // prefix the TUI's local `knobHint` emits for the same path.
    expect(knobHint("a.b")).toBe(`mpd.jsonc a.b — ${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`)
    for (const knob of slotKnobs) {
      const hint = String(knob.hint ?? "")
      expect(hint).toContain(`mpd.jsonc teamModels.${knob.path[1]}.${knob.path[2]}`)
      expect(hint).toContain(BRIDGE_DISCLOSURE)
      expect(hint).toContain(BRIDGE_NOT_LOST)
      // One sentence of semantics on top of the two shared clauses, naming the member class.
      expect(hint.length).toBeGreaterThan(BRIDGE_DISCLOSURE.length + BRIDGE_NOT_LOST.length)
      for (const member of KNOWN_CLASSES[String(knob.path[1])]) expect(hint).toContain(member)
    }
    // Vision Analyst keeps an explicit route, so slot 2's sentence says so (the frozen clarification).
    expect(String(slotKnobs[3].hint)).toContain("Vision Analyst")
  })
})

describe("A2 — the resolved config carries the slots, with defaults, on the READ path", () => {
  test("no teamModels anywhere: the service answers with the three complete defaults", () => {
    const { root, home } = sandbox()
    const { service } = mount(root, home)
    expect(service.get("teamModels")).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(service.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
    expect(service.get("teamModels.slot3.reasoningEffort")).toBe("high")
    // READ-path only: the parameterless service read stays the RAW merged file layers (the shape
    // an existing wiring test pins), and nothing was materialised onto disk.
    expect(service.get()).not.toHaveProperty("teamModels")
  })

  test("a file that sets only slot2.model merges over ITS defaults and leaves slot1/slot3 untouched", () => {
    const { root, file, home } = sandbox()
    writeFileSync(file, '{ "teamModels": { "slot2": { "model": "deepseek-v4-pro" } } }')
    const { service } = mount(root, home)
    expect(service.get("teamModels.slot2")).toEqual({ provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" })
    expect(service.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
    expect(service.get("teamModels.slot3")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot3)
  })

  test("project .mpd/mpd.jsonc outranks the user $DSH_HOME/mpd.jsonc layer, per leaf", () => {
    const { root, file, home } = sandbox()
    writeFileSync(join(home, "mpd.jsonc"), '{ "teamModels": { "slot1": { "provider": "user-provider", "model": "user-model" } } }')
    writeFileSync(file, '{ "teamModels": { "slot1": { "model": "project-model" } } }')
    const { service } = mount(root, home)
    // project wins the leaf it declares; the user value survives underneath for the leaf it does not
    expect(service.get("teamModels.slot1")).toEqual({ provider: "user-provider", model: "project-model", reasoningEffort: "max" })
  })

  test("materialisation is a pure READ-path projection: no mutation of the raw config", () => {
    const { root, file, home } = sandbox()
    const original = '{ "ulw": { "maxRounds": 3 } }'
    writeFileSync(file, original)
    const raw = { ulw: { maxRounds: 3 } }
    const resolved = withTeamModelsDefaults(raw)
    expect(raw).toEqual({ ulw: { maxRounds: 3 } }) // the input object is untouched
    expect(resolved.teamModels).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(resolved.ulw).toEqual({ maxRounds: 3 })
    const { service } = mount(root, home)
    expect(service.get("teamModels")).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    // a read never writes: the workspace file is byte-identical, so no default can leak into it
    expect(readFileSync(file, "utf8")).toBe(original)
  })

  test("the mpd_config_get payload carries the slots verbatim (no key), and by key", async () => {
    const { root, home } = sandbox()
    const { tools } = mount(root, home)
    const get = tools.find((tool) => tool.name === "mpd_config_get")
    const noKey = await get.execute({})
    expect(noKey.config.teamModels).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(JSON.parse(JSON.stringify(noKey))).toEqual(noKey) // host lossless round-trip
    const byKey = await get.execute({ key: "teamModels.slot3" })
    expect(byKey.value).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot3)
    expect(byKey.config.teamModels).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
  })
})
