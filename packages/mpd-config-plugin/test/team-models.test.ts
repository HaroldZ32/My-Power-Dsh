// The four team-model slots of the `mpd` settings namespace: NO default layer in the slot subtree
// (A1), the twelve knobs of the ONE declaration (A3) and a read path that contains only what the
// user wrote (A2). Contract `.mpd/plans/slot-single-source.md` §1-§2, §9, amendment 1.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, resolveTeamModelSlot, teamModelRouteOfMember, stripJsonc } from "../src/index"
import { writeBackLeaves } from "../src/bridge"
import * as schemaNamespace from "../src/settings-schema"
import * as configNamespace from "../src/index"
import {
  BRIDGE_DISCLOSURE,
  BRIDGE_NOT_LOST,
  BRIDGE_RESTART_LIMIT,
  BRIDGE_SECTION_NOTICE,
  SETTINGS_KNOBS,
  SettingsSchema,
  TEAM_MODEL_FALLBACK_OPTIONS,
  TEAM_MODEL_SLOTS,
  TEAM_MODEL_SLOT_GROUPS,
  TEAM_MODEL_SLOT_IMPACT,
  TEAM_MODEL_SLOT_IMPACT_OVERRIDES,
  knobHint,
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
  const dir = mkdtempSync(join(tmpdir(), "mpd-team-models-"))
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
function mount(root: string, home: string): { service: any; tools: any[] } {
  process.env.DSH_HOME = home
  process.env.DSH_WORKSPACE_ROOT = root
  // Every tool the row registers during this mount, so the real `mpd_config_get` execute can be called.
  const tools: any[] = []
  // The `mpdConfig` service value, assigned by the stub ctx `provide` while `apply` runs.
  let service: any = null
  apply({ tools: { register: (t: any) => tools.push(t) }, provide: (_n: string, v: any) => { service = v } } as any, {})
  return { service, tools }
}

// The three leaves of every slot, in the order the twelve declared rows must follow.
const SLOT_LEAVES = ["provider", "model", "reasoningEffort"] as const
// Member class per slot, as the README slot table declares it: a hint names its own members and no others.
const KNOWN_CLASSES: Record<string, readonly string[]> = {
  slot1: ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"],
  slot2: ["Researcher", "Explorer", "Plan Reviewer"],
  slot3: ["Deep Worker", "Junior Engineer"],
  slot4: ["Vision Analyst"],
}

describe("A1 — NO default layer anywhere in the slot subtree (contract §2)", () => {
  test("the schema carries no slot default: a workspace that configured nothing resolves four EMPTY slots", () => {
    // The resolved config of a workspace that declared nothing: four empty slot objects, never a
    // provider/model/effort — the built-in default layer this contract deletes.
    const resolved: any = (SettingsSchema as any)({})
    expect(Object.keys(resolved.teamModels)).toEqual([...TEAM_MODEL_SLOTS])
    for (const slot of TEAM_MODEL_SLOTS) expect(resolved.teamModels[slot]).toEqual({})
    // A partial declaration keeps ONLY the leaf the user wrote; no sibling leaf is filled in.
    const partial: any = (SettingsSchema as any)({ teamModels: { slot2: { model: "deepseek-v4-pro" } } })
    expect(partial.teamModels.slot2).toEqual({ model: "deepseek-v4-pro" })
  })

  test("the deleted layers stay deleted: no default table and no agentRoutes schema on the module", () => {
    // The module namespace is the subject: a resurrected `TEAM_MODEL_SLOT_DEFAULTS` or
    // `AGENT_ROUTES_SCHEMA` export reddens here instead of quietly re-entering the read path.
    const schemaModule = schemaNamespace as Record<string, unknown>
    expect(schemaModule.TEAM_MODEL_SLOT_DEFAULTS).toBeUndefined()
    expect(schemaModule.AGENT_ROUTES_SCHEMA).toBeUndefined()
    expect(schemaModule.AGENT_ROUTE_SCHEMA).toBeUndefined()
    expect(schemaModule.AGENT_ROUTE_KNOBS).toBeUndefined()
    expect(schemaModule.ROSTER_AGENT_NAMES).toBeUndefined()
    expect(schemaModule.agentRouteEntryOfMember).toBeUndefined()
    // The config module's own exports are the other half of the deletion.
    const configModule = configNamespace as Record<string, unknown>
    expect(configModule.withTeamModelsDefaults).toBeUndefined()
    expect(configModule.agentRouteEntryOfMember).toBeUndefined()
  })
})

describe("A3 — twelve knobs in the ONE declaration, in slot order", () => {
  // The twelve teamModels rows of the ONE declaration, which every A3 assertion below is about.
  const slotKnobs = SETTINGS_KNOBS.filter((knob) => knob.path[0] === "teamModels")

  test("exactly twelve new rows, after the original thirteen", () => {
    // 26 = the thirteen original knobs + the twelve slot leaves + the TUI surface's own
    // `tui.dashboardKey` (declared LAST, so every index-keyed assertion in this file keeps its
    // meaning). The thirty-three `agentRoutes` rows are GONE with the table itself (contract §3).
    expect(SETTINGS_KNOBS).toHaveLength(26)
    expect(slotKnobs).toHaveLength(12)
    // The deleted table leaves no row behind: no knob path may address `agentRoutes`.
    expect(SETTINGS_KNOBS.filter((knob) => knob.path[0] === "agentRoutes")).toHaveLength(0)
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
      // The leaf this row sets, used to look up the fallback option list the row must mirror.
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
      // Slot this row belongs to, narrowed to the four names the copy generators accept.
      const slot = String(knob.path[1]) as "slot1" | "slot2" | "slot3" | "slot4"
      // Leaf this row sets, narrowed to the three declared leaves for the sentence lookup.
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
      // The composed hint, read as text so a missing hint fails the assertion instead of the loop.
      const hint = String(knob.hint ?? "")
      expect(hint).toContain(`mpd.jsonc teamModels.${knob.path[1]}.${knob.path[2]}`)
      // The row must NOT repeat the surface's disclosure.
      expect(hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(hint).not.toContain(BRIDGE_NOT_LOST)
      for (const member of KNOWN_CLASSES[String(knob.path[1])]) expect(hint).toContain(member)
    }
    // ...and the one place that DOES state it — BOTH halves of the timing truth (D-18), never just
    // the promising one, then the not-lost clause.
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_DISCLOSURE)
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_RESTART_LIMIT)
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_NOT_LOST)
    // Vision Analyst is slot 4's member and the slots 1-3 sentences say which slot drives it.
    expect(String(slotKnobs[3].hint)).toContain("Vision Analyst")
    expect(String(slotKnobs[3].hint)).toContain("slot 4 drives it")
  })
})

describe("A3b — the vision slot carries its own copy, verbatim, in both languages", () => {
  // The three slot-4 rows: the vision member copy, which must match its sentences verbatim.
  const slot4 = SETTINGS_KNOBS.filter((knob) => knob.path[1] === "slot4")
  // The exact English sentences slot 4 must carry, in provider/model/reasoningEffort order.
  const VISION_SENTENCES_EN = [
    "The provider half of this slot. It drives Vision Analyst only (the one member that reads images, diagrams and screenshots). What changing it does: effective at the next team creation; an unusable value fails team creation loudly, naming the member and the slot. The model here must be a vision model that accepts image input (for example deepseek-v4-flash-vision-exp) — a text-only model breaks image analysis.",
    "This slot's model. It MUST accept image input: Vision Analyst's whole value is reading images, and a text-only model makes its image tasks fail. What changing it does: effective at the next team creation.",
    "This slot's reasoning effort (off / low / high / max). It sets how much Vision Analyst thinks while reading an image. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot. EXCEPTION: a model whose catalog entry declares no reasoning efforts at all is sent none — its call still runs.",
  ]
  // The same three sentences in Chinese; a translation drift reddens here instead of shipping silently.
  const VISION_SENTENCES_ZH = [
    "这一档的提供商。它只驱动 Vision Analyst（唯一负责看图/读图/分析截图的成员）。改它的影响：下次建队生效；填成不可用会让建队直接失败并点名成员与槽位。注意本档的模型必须是支持图像输入的视觉模型（例如 deepseek-v4-flash-vision-exp），换成纯文本模型会让看图任务失败。",
    "这一档的模型。必须选支持图像输入的模型：Vision Analyst 的全部价值在于读图，纯文本模型会让它的读图任务直接失败。改它的影响：下次建队生效。",
    "这一档的推理强度（off / low / high / max）。决定 Vision Analyst 读图时的思考深度。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。例外：若该模型的目录条目完全没有推理等级，则不发送任何等级——调用照常。",
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

describe("A2 — the read path contains only what the user wrote (contract §2/§9)", () => {
  test("a fresh workspace: no teamModels key in the raw read, and a TYPED unconfigured resolution", () => {
    // Fresh workspace + isolated home: nothing the user could have declared.
    const { root, home } = sandbox()
    // The mounted config service, whose reads are the subject of every assertion below.
    const { service } = mount(root, home)
    expect(service.get("teamModels")).toBeUndefined()
    expect(service.get()).not.toHaveProperty("teamModels")
    // The TOTAL service surface (amendment 1): undefined, never an exception.
    expect(service.teamModelRouteOf("Architect")).toBeUndefined()
    expect(service.slotResolutionOf("Architect")).toMatchObject({ ok: false, status: "unconfigured", slot: "slot1", missing: ["provider", "model"] })
  })

  test("a file that sets only slot2.model keeps exactly that leaf — and is still unconfigured", () => {
    // Sandbox whose project file this test writes the partial slot2 block into.
    const { root, file, home } = sandbox()
    writeFileSync(file, '{ "teamModels": { "slot2": { "model": "deepseek-v4-pro" } } }')
    // Mounted AFTER the write, so the apply-time load sees the block.
    const { service } = mount(root, home)
    expect(service.get("teamModels.slot2")).toEqual({ model: "deepseek-v4-pro" })
    // Half-configured is UNCONFIGURED: the provider leaf is still missing, and it is named.
    expect(service.slotResolutionOf("Researcher")).toMatchObject({ ok: false, status: "unconfigured", missing: ["provider"] })
  })

  test("project .mpd/mpd.jsonc outranks the user $DSH_HOME/mpd.jsonc layer, per leaf", () => {
    // Sandbox for the precedence case: the SAME slot1 block is declared in both file layers.
    const { root, file, home } = sandbox()
    writeFileSync(join(home, "mpd.jsonc"), '{ "teamModels": { "slot1": { "provider": "user-provider", "model": "user-model" } } }')
    writeFileSync(file, '{ "teamModels": { "slot1": { "model": "project-model" } } }')
    // Mounted once both files exist; the per-leaf winner is what the reads must show.
    const { service } = mount(root, home)
    expect(service.get("teamModels.slot1")).toEqual({ provider: "user-provider", model: "project-model" })
    expect(service.slotResolutionOf("Architect")).toMatchObject({ ok: true, route: { provider: "user-provider", model: "project-model" } })
  })

  test("a READ never seeds and never writes: the workspace file stays byte-identical", () => {
    // Sandbox holding one raw config file, whose bytes must be unchanged when the test ends.
    const { root, file, home } = sandbox()
    // The exact bytes written to the project file, re-read at the end to prove nothing leaked to disk.
    const original = '{ "ulw": { "maxRounds": 3 } }'
    writeFileSync(file, original)
    // Mounting the row runs the one-time seed; with NO catalog seam in the stub it writes nothing.
    const { service } = mount(root, home)
    expect(service.get("teamModels")).toBeUndefined()
    expect(readFileSync(file, "utf8")).toBe(original)
  })

  test("the mpd_config_get payload is the RAW config: absent stays absent, declared is verbatim", async () => {
    // Sandbox for the tool surface; the payload is read through the registered tool, not the service.
    const { root, file, home } = sandbox()
    // Registered tools, where the real `mpd_config_get` row is looked up by name.
    const { tools } = mount(root, home)
    // The registered get tool; a missing row would make every later call throw.
    const get = tools.find((tool) => tool.name === "mpd_config_get")
    // Key-less read on a fresh workspace: NO materialised default layer may appear (§9).
    const noKey = await get.execute({})
    expect(noKey.config).not.toHaveProperty("teamModels")
    expect(JSON.parse(JSON.stringify(noKey))).toEqual(noKey) // host lossless round-trip
    // A declared block answers VERBATIM, fallback chain included — no leaf is rewritten.
    writeFileSync(file, '{ "teamModels": { "slot3": { "provider": "gateway", "model": "gpt-x", "fallbacks": [{ "provider": "backup", "model": "b" }] } } }')
    /** The keyed read of the declared slot. */
    const byKey = await get.execute({ key: "teamModels.slot3" })
    expect(byKey.value).toEqual({ provider: "gateway", model: "gpt-x", fallbacks: [{ provider: "backup", model: "b" }] })
    expect(byKey.config.teamModels.slot3).toEqual({ provider: "gateway", model: "gpt-x", fallbacks: [{ provider: "backup", model: "b" }] })
  })
})

describe("the deletion lock on the FILE (contract §3): a leftover agentRoutes block survives a save", () => {
  test("saving an unrelated leaf leaves the old block byte-identical (no data loss)", () => {
    // A workspace file shaped like an OLD one: an unrelated knob plus a full agentRoutes table.
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
