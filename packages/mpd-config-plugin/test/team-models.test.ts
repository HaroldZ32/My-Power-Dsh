// The four team-model slots of the `mpd` settings namespace: the schema defaults (A1), the twelve
// knobs of the ONE declaration (A3, plus the declaration half of A6) and the config layer's
// READ-PATH materialisation (A2). Plan of record §3.1; frozen contract §1.1/§2. Slot 4 is the
// vision slot: its default is Vision Analyst's own route, so the option is behaviour-preserving.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, withTeamModelsDefaults } from "../src/index"
import {
  BRIDGE_DISCLOSURE,
  BRIDGE_NOT_LOST,
  BRIDGE_SECTION_NOTICE,
  SETTINGS_KNOBS,
  SettingsSchema,
  TEAM_MODEL_FALLBACK_OPTIONS,
  TEAM_MODEL_SLOTS,
  TEAM_MODEL_SLOT_DEFAULTS,
  TEAM_MODEL_SLOT_GROUPS,
  TEAM_MODEL_SLOT_IMPACT,
  TEAM_MODEL_SLOT_IMPACT_OVERRIDES,
  knobHint,
  teamModelLeafSentence,
  teamModelMembers,
  teamModelSlotHeading,
  teamModelSlotImpact,
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
  slot4: ["Vision Analyst"],
}

describe("A1 — the schema carries the four slots with the frozen literal defaults", () => {
  test("the defaults are provider deepseek-official / model deepseek-v4-flash at max, high, high — plus the vision slot 4", () => {
    expect(TEAM_MODEL_SLOTS).toEqual(["slot1", "slot2", "slot3", "slot4"])
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot1).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" })
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot2).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" })
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot3).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" })
    // Behaviour-preserving by construction: slot 4's default IS Vision Analyst's former explicit route.
    expect(TEAM_MODEL_SLOT_DEFAULTS.slot4).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" })
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
    expect(resolved.teamModels.slot4).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot4)
  })
})

describe("A3 — twelve knobs in the ONE declaration, in slot order", () => {
  const slotKnobs = SETTINGS_KNOBS.filter((knob) => knob.path[0] === "teamModels")

  test("exactly twelve new rows, after the original thirteen", () => {
    expect(SETTINGS_KNOBS).toHaveLength(25)
    expect(slotKnobs).toHaveLength(12)
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
      "Slot 4 provider (vision member)", "Slot 4 model (vision member)", "Slot 4 reasoning effort (vision member)",
    ])
    expect(slotKnobs.map((knob) => knob.zh)).toEqual([
      "槽位 1 提供商（重推理成员）", "槽位 1 模型（重推理成员）", "槽位 1 推理强度（重推理成员）",
      "槽位 2 提供商（分析型成员）", "槽位 2 模型（分析型成员）", "槽位 2 推理强度（分析型成员）",
      "槽位 3 提供商（执行型成员）", "槽位 3 模型（执行型成员）", "槽位 3 推理强度（执行型成员）",
      "槽位 4 提供商（视觉成员）", "槽位 4 模型（视觉成员）", "槽位 4 推理强度（视觉成员）",
    ])
  })

  test("the slot copy states the group and its members: heading, impact and per-leaf sentences", () => {
    // The group table is the ONE input the copy interpolates — the member list in the group's own order.
    expect(TEAM_MODEL_SLOT_GROUPS.slot1.members).toEqual(["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"])
    expect(TEAM_MODEL_SLOT_GROUPS.slot2.members).toEqual(["Researcher", "Explorer", "Plan Reviewer"])
    expect(TEAM_MODEL_SLOT_GROUPS.slot3.members).toEqual(["Deep Worker", "Junior Engineer"])
    expect(TEAM_MODEL_SLOT_GROUPS.slot4).toEqual({ zh: "视觉成员", en: "vision member", members: ["Vision Analyst"] })
    expect(teamModelMembers("slot2", "zh")).toBe("Researcher、Explorer、Plan Reviewer")
    expect(teamModelMembers("slot2", "en")).toBe("Researcher, Explorer, Plan Reviewer")
    // The heading renders above a slot's three rows; the impact line is the one-line consequence.
    expect(teamModelSlotHeading("slot1", "en")).toBe("Slot 1 — heavy members (Architect, Planner, Reviewer, Lead, Senior Engineer)")
    expect(teamModelSlotHeading("slot2", "zh")).toBe("槽位 2 —— 分析型成员（Researcher、Explorer、Plan Reviewer）")
    expect(teamModelSlotHeading("slot3", "en")).toBe("Slot 3 — execution members (Deep Worker, Junior Engineer)")
    // Slot 4's heading/labels come from the SAME generator, so the group name is the only input.
    expect(teamModelSlotHeading("slot4", "en")).toBe("Slot 4 — vision member (Vision Analyst)")
    expect(teamModelSlotHeading("slot4", "zh")).toBe("槽位 4 —— 视觉成员（Vision Analyst）")
    expect(TEAM_MODEL_SLOT_IMPACT.zh).toContain("点名成员与槽位")
    expect(TEAM_MODEL_SLOT_IMPACT.en).toContain("fails team creation loudly")
    // Slots 1-3 share the impact line; slot 4 has its own (it names the image-input requirement).
    expect(teamModelSlotImpact("slot1", "en")).toBe(TEAM_MODEL_SLOT_IMPACT.en)
    expect(teamModelSlotImpact("slot3", "zh")).toBe(TEAM_MODEL_SLOT_IMPACT.zh)
    expect(teamModelSlotImpact("slot4", "en")).toBe(TEAM_MODEL_SLOT_IMPACT_OVERRIDES.slot4!.en)
    expect(teamModelSlotImpact("slot4", "en")).toContain("MUST accept image input")
    expect(teamModelSlotImpact("slot4", "zh")).toBe(
      "建队时 Vision Analyst 默认用本档的 提供商 · 模型 · 推理强度 启动；本档的模型必须支持图像输入，否则看图任务会失败；填错会让建队直接失败并点名成员与槽位。",
    )
    // The nine knobs carry their OWN sentence per leaf, in both languages, and the composed hint
    // LEADS with the English one.
    for (const knob of slotKnobs) {
      const slot = String(knob.path[1]) as "slot1" | "slot2" | "slot3" | "slot4"
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

  test("every hint names its dotted mpd.jsonc key and its member class, and the disclosure is stated ONCE", () => {
    // MEASURED (docker/ui, 2026-09-27): with the disclosure inlined, all 25 rows read as the same
    // four lines and each knob's own sentence was pushed off screen. The contract is now: the ROW
    // carries its sentence and its key; the SURFACE states the disclosure once.
    expect(knobHint("a.b")).toBe("mpd.jsonc a.b")
    for (const knob of slotKnobs) {
      const hint = String(knob.hint ?? "")
      expect(hint).toContain(`mpd.jsonc teamModels.${knob.path[1]}.${knob.path[2]}`)
      // The row must NOT repeat the surface's disclosure.
      expect(hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(hint).not.toContain(BRIDGE_NOT_LOST)
      for (const member of KNOWN_CLASSES[String(knob.path[1])]) expect(hint).toContain(member)
    }
    // ...and the one place that DOES state it.
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_DISCLOSURE)
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_NOT_LOST)
    // Vision Analyst is slot 4's member and the slots 1-3 sentences say which slot drives it.
    expect(String(slotKnobs[3].hint)).toContain("Vision Analyst")
    expect(String(slotKnobs[3].hint)).toContain("slot 4 drives it")
  })
})

describe("A3b — the vision slot carries its own copy, verbatim, in both languages", () => {
  const slot4 = SETTINGS_KNOBS.filter((knob) => knob.path[1] === "slot4")
  const VISION_SENTENCES_EN = [
    "The provider half of this slot. It drives Vision Analyst only (the one member that reads images, diagrams and screenshots). What changing it does: effective at the next team creation; an unusable value fails team creation loudly, naming the member and the slot. The model here must be a vision model that accepts image input (for example deepseek-v4-flash-vision-exp) — a text-only model breaks image analysis.",
    "This slot's model. It MUST accept image input: Vision Analyst's whole value is reading images, and a text-only model makes its image tasks fail. What changing it does: effective at the next team creation.",
    "This slot's reasoning effort (off / low / high / max). It sets how much Vision Analyst thinks while reading an image. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.",
  ]
  const VISION_SENTENCES_ZH = [
    "这一档的提供商。它只驱动 Vision Analyst（唯一负责看图/读图/分析截图的成员）。改它的影响：下次建队生效；填成不可用会让建队直接失败并点名成员与槽位。注意本档的模型必须是支持图像输入的视觉模型（例如 deepseek-v4-flash-vision-exp），换成纯文本模型会让看图任务失败。",
    "这一档的模型。必须选支持图像输入的模型：Vision Analyst 的全部价值在于读图，纯文本模型会让它的读图任务直接失败。改它的影响：下次建队生效。",
    "这一档的推理强度（off / low / high / max）。决定 Vision Analyst 读图时的思考深度。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。",
  ]

  test("exactly three slot-4 rows, in leaf order, with the declared sentences", () => {
    expect(slot4.map((knob) => [...knob.path])).toEqual([
      ["teamModels", "slot4", "provider"],
      ["teamModels", "slot4", "model"],
      ["teamModels", "slot4", "reasoningEffort"],
    ])
    expect(slot4.map((knob) => knob.semantics)).toEqual(VISION_SENTENCES_EN)
    expect(slot4.map((knob) => knob.semanticsZh)).toEqual(VISION_SENTENCES_ZH)
  })

  test("the hint is the human sentence, then the dotted key — and nothing else", () => {
    for (const knob of slot4) {
      expect(String(knob.hint)).toBe(`${String(knob.semantics)} (mpd.jsonc teamModels.slot4.${String(knob.path[2])})`)
    }
    // The image-input constraint is stated in ALL THREE rows, in both languages.
    for (const knob of slot4) {
      expect(String(knob.semantics)).toContain("Vision Analyst")
      expect(String(knob.semanticsZh)).toContain("Vision Analyst")
    }
    expect(String(slot4[1].semantics)).toContain("MUST accept image input")
    expect(String(slot4[0].semantics)).toContain("text-only model breaks image analysis")
    expect(String(slot4[0].semanticsZh)).toContain("换成纯文本模型会让看图任务失败")
  })
})

describe("A2 — the resolved config carries the slots, with defaults, on the READ path", () => {
  test("no teamModels anywhere: the service answers with the four complete defaults", () => {
    const { root, home } = sandbox()
    const { service } = mount(root, home)
    expect(service.get("teamModels")).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(service.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
    expect(service.get("teamModels.slot3.reasoningEffort")).toBe("high")
    expect(service.get("teamModels.slot4")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot4)
    expect(service.get("teamModels.slot4.model")).toBe("deepseek-v4-flash-vision-exp")
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
