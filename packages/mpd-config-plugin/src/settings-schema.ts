// The `mpd` settings namespace: ONE source for its schema, its knob metadata and the disclosure
// both front doors state.
//
// §10.1 places the REGISTRATION in this package (it is the only module that can supply the
// file-derived `base`); the TUI package keeps a guarded fallback for compositions without this
// plugin. Both therefore read the schema and the field list from HERE, so the two front doors
// cannot drift and the twenty-five knobs (thirteen mpd knobs + twelve team-model slot leaves) stay
// one declaration.
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"

/** The settings namespace the section and the Web card both edit. */
export const SETTINGS_NS = "mpd"

/** The four team-model slots, in display order (slot1 first). */
export const TEAM_MODEL_SLOTS = ["slot1", "slot2", "slot3", "slot4"] as const

/** One team-model slot: the provider, the model and the reasoning effort a member class stages on. */
export interface TeamModelSlot {
  /** Provider id the slot routes through, e.g. `deepseek-official`. */
  readonly provider: string
  /** Model id that provider must offer; slot 4's model MUST accept image input. */
  readonly model: string
  /** Reasoning effort (`off` / `low` / `high` / `max`); an unsupported level fails loudly, never clamped. */
  readonly reasoningEffort: string
}

/**
 * The four slot DEFAULTS — ONE literal declaration, so the schema defaults, the config layer's
 * READ-PATH materialisation and the tests cannot drift apart. Values are the frozen vocabulary of
 * the settings contract §1.1: provider `deepseek-official`, model `deepseek-v4-flash`, efforts
 * `max` / `high` / `high` for slot1 / slot2 / slot3 — i.e. the live behaviour of the member
 * classes before the slots existed. Slot 4 is the VISION slot and its default is Vision Analyst's
 * own route, unchanged by this option: `deepseek-v4-flash-vision-exp` at `high`.
 */
export const TEAM_MODEL_SLOT_DEFAULTS: Readonly<Record<(typeof TEAM_MODEL_SLOTS)[number], TeamModelSlot>> = {
  slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
  slot2: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot3: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot4: { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" },
}

/**
 * The DECLARED fallback option lists: what a front door offers for a slot leaf when its LIVE
 * option source (the TUI's server-side catalog, the Web card's client catalog) is unavailable or
 * degraded. The declared list is also the parity surface both front doors must agree on; the LIVE
 * lists are deliberately different sources, so a difference there is NOT drift (§A6).
 */
export const TEAM_MODEL_FALLBACK_OPTIONS = {
  provider: ["deepseek-official"],
  model: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"],
  reasoningEffort: ["off", "low", "high", "max"],
} as const

/** One slot's three leaves as a schema block whose defaults come from {@link TEAM_MODEL_SLOT_DEFAULTS}. */
function teamModelSlotSchema(slot: TeamModelSlot): Schemastery<TeamModelSlot> {
  return z.object({
    provider: z.string().default(slot.provider),
    model: z.string().default(slot.model),
    reasoningEffort: z.string().default(slot.reasoningEffort),
  })
}

/**
 * The mpd.jsonc knob schema (mirrors the keys `packages/mpd-config-plugin` consumes). The
 * defaults here are the design's L0 layer; the file-derived values arrive as the namespace `base`.
 */
export const SettingsSchema = z.object({
  hashline: z.object({ maxDiffChars: z.number().default(20000) }),
  commentChecker: z.object({ autoCheck: z.boolean().default(true) }),
  ulw: z.object({ maxRounds: z.number().default(6) }),
  memory: z.object({ vcs: z.union([z.const("git"), z.const("svn")]).default("git") }),
  team: z.object({ stateDir: z.string().default(".mpd/team") }),
  // NO DEFAULT — and that absence is the contract, not an oversight. The two consumers of this knob
  // (`readBoulderGate`, and the boulder row's own state root) treat the value as the directory whose
  // `.mpd/boulder.json` they read, and BOTH fall back to the calling session's workspace when it is
  // unset. A `.default(".mpd")` here therefore did NOT mean "the conventional state dir": the loader
  // materialises it into the ROW CONFIG, `rowKnobLayer` copies row knobs LAST, and the value then
  // WON over `.mpd/mpd.jsonc` — so the resolved root became `<ws>/.mpd` and both consumers joined
  // `.mpd/boulder.json` onto it, reading `<ws>/.mpd/.mpd/boulder.json` (MEASURED 2026-10-06: the
  // ledger at the contract path `<ws>/.mpd/boulder.json` read `active:false`, the same bytes at the
  // doubled path fired the gate, and `{"boulder":{"dir":"."}}` in the project file could not win).
  // Left optional, an unset knob resolves to `undefined` and the consumers' own workspace fallback
  // produces the contract path — while an explicitly set value still overrides both.
  // `required(false)` IS THE "UNSET" SPELLING of the vendored schemastery: a bare `z.string()` and
  // this form both leave the leaf ABSENT from the resolved row config (`{}`), which is what the two
  // consumers need to fall back to the session workspace; the explicit form is kept because this
  // leaf's whole point is that it has NO default, and `.default('')` would have materialised an
  // empty string that the consumers' guards would then read as a REAL root.
  boulder: z.object({ dir: z.string().required(false) }),
  // The four team-model slots (§3.1 of the plan of record): each is the DEFAULT route of one
  // member class — slot1 Architect/Planner/Reviewer/Lead/Senior Engineer, slot2 the analysts
  // Researcher/Explorer/Plan Reviewer, slot3 the executors Deep Worker/Junior Engineer, slot4 the
  // vision member Vision Analyst. The
  // schema default is the L0 layer a fresh workspace resolves to; the read path materialises it
  // (see `withTeamModelsDefaults`) so a consumer never has to apply defaults itself.
  teamModels: z.object({
    slot1: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot1),
    slot2: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot2),
    slot3: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot3),
    slot4: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot4),
  }),
  // The watchdog block is the §3 defaults table of the frozen contract and MUST stay byte-equal in
  // value to `packages/mpd-team-watchdog-plugin/src/machine.ts` `WATCHDOG_DEFAULTS` and to the
  // `mpd-team-watchdog` row config in `cordis.patch.yml` — those are the three
  // declaration layers, and the T-18 cross-layer check reads them side by side. `warnSilenceMs`
  // moved 90 s -> 10 min and `actionOnEscalate` defaults to `warn-only` because the redesign's
  // predicate (not wall-clock silence) owns the WARN, and a hold must not latch by default;
  // `holdTtlMs` is the T-17 bound that auto-releases a hold (`0` disables the expiry).
  watchdog: z.object({
    enabled: z.boolean().default(true),
    warnSilenceMs: z.number().default(600000),
    tickIntervalMs: z.number().default(15000),
    warnStreakToEscalate: z.number().default(6),
    actionOnEscalate: z.union([z.const("pause"), z.const("warn-only")]).default("warn-only"),
    toolInFlightMaxMs: z.number().default(900000),
    holdTtlMs: z.number().default(900000),
  }),
  // The DSH-TUI surface's own knob. It lives in THIS schema because this file is the single source
  // for the namespace schema and for the knob list both front doors render — a knob declared only
  // inside the TUI section would be drift. `dashboardKey` is the L0 default of the Ctrl+A takeover:
  // ON, i.e. the takeover applies whenever MPD's team projection has a team with at least one task,
  // and with no team the key keeps its host behaviour. IT IS MEANINGFUL ON OLD dsh-tui BUILDS ONLY:
  // a host that offers the sidebar panel seam (0.13.0+) keeps Ctrl+A for its own dashboard and opens
  // MPD's merged view through `alt+a` / `/mpd panel`, so the contact is never armed there.
  tui: z.object({ dashboardKey: z.boolean().default(true) }),
})

/** The two-part disclosure every surface must be able to show (§D.2, and the "not lost" clause). */
export const BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) — it applies at the next dsh boot, because the file-derived base is fixed for the running process's lifetime"

/**
 * The HOST LIMITATION half of the truth (T-18), stated where the user meets it rather than papered
 * over: the file-derived base is captured at plugin mount and stays fixed for the process lifetime,
 * so a hand edit of `.mpd/mpd.jsonc` (or of any file-backed value) can never reach the running
 * process — only the next `dsh` boot reads it. The settings document is the only path that can
 * reach a RUNNING plugin, and only where that plugin subscribes to the host's settings-document
 * update (the watchdog engine does, `engine.ts` `onSettingsDocumentUpdated`); nothing in this
 * change proves that seam is exposed on the installed host, so the sentence stays true by being
 * conditional instead of claiming a live reload the wave did not measure.
 */
export const BRIDGE_RESTART_LIMIT =
  "the file half is host-limited: a .mpd/mpd.jsonc edit is read once at plugin mount and stays fixed for the running process, so it applies at the next dsh boot and never mid-process; only a change made through this settings document can reach a running plugin, and only where the plugin subscribes to the host's settings-document update"

/**
 * The sentence that keeps a settings-only save from reading as a LOST save (captain's ruling 1):
 * the value lives in the host-global settings document and the read-in layer applies it to every
 * workspace's resolved config immediately, so a refusal is a persistence delay, never data loss.
 */
export const BRIDGE_NOT_LOST =
  "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session"

/** The runtime notice for a save that had no live session workspace to write (§D.2 row 2). */
export const BRIDGE_NO_WORKSPACE_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * Mark one schema node (and everything under it) as VOLATILE, the flag the harness's settings editor
 * reads.
 *
 * MEASURED out of the installed `dsh-settings@0.1.7-rc.2`: its `volatileForm(schema)` walks
 * `schema.meta.volatile`, `schema.dict`, `type`, `list` and `inner` — PLAIN DATA on a schema object —
 * and an entry whose schema carries no volatile node is not listed in the dialog at all. That is what
 * replaced the retired `settings.register(namespace, …)`.
 *
 * The harness's own `@deepseek-ai/schemastery` (3.18.4) is therefore NOT needed: it exists only
 * inside the harness install, it does not materialize into a profile on a `link:` install (measured:
 * declaring it in the bundle's dependencies changed nothing), and all the editor reads is this flag.
 * The vendored schemastery this file already imports carries `meta`/`dict`, so the flag can simply be
 * set.
 *
 * @param schema - a schemastery node.
 * @returns the same node, flagged.
 */
export function markVolatile<T>(schema: T): T {
  // The same node viewed as the plain-data carrier the harness's volatile walk reads.
  const node = schema as unknown as { meta?: Record<string, unknown>; dict?: Record<string, unknown>; inner?: unknown; list?: unknown }
  // A SCHEMASTERy NODE IS A FUNCTION, not an object: `Schema.prototype = Object.create(Function.prototype)`.
  // Guarding on `typeof !== "object"` returned early for every node and marked NOTHING — which is why
  // the entry stayed out of `settings.describe()` while a hand-written assignment on the same object
  // (typed as an object by the test that made it) persisted.
  const kind = typeof node
  if (node === null || (kind !== "object" && kind !== "function")) return schema
  // UNCONDITIONAL: a schemastery node builds its `meta` lazily, so at the moment this walk runs the
  // property can still be absent and a guarded write would skip exactly the nodes that need the flag
  // (measured: the built Config's own `hashline` node carried `{"default":{}}` with no `volatile`).
  try {
    node.meta = { ...(node.meta ?? {}), volatile: true }
  } catch {
    /* a frozen node cannot carry the flag; the entry simply stays unlisted */
  }
  if (node.dict !== undefined && typeof node.dict === "object") for (const child of Object.values(node.dict)) markVolatile(child)
  if (node.inner !== undefined) markVolatile(node.inner)
  if (Array.isArray(node.list)) for (const child of node.list) markVolatile(child)
  return schema
}

/** The runtime notice for a save with several live roots: settings-only, per the refusal rule. */
export const BRIDGE_AMBIGUOUS_NOTICE = "saved to settings — not written to any file: several live workspaces, so the target is ambiguous (see the log for the candidates)"

/**
 * One knob's ROW hint: its own human sentence plus the dotted mpd.jsonc key it writes. The long
 * bridge disclosure is NOT repeated here — see {@link BRIDGE_SECTION_NOTICE}.
 *
 * MEASURED (docker/ui, 2026-09-27, `05b-mpd-section.png`): with the disclosure inlined, all 25 rows
 * of the Web section read as four near-identical lines — `mpd.jsonc <key> — a save writes … and
 * takes effect … it applies at the next dsh boot … the value is never lost …` — which pushed each
 * knob's OWN sentence off screen and made the section unreadable, while the card already stated the
 * same text once at the bottom. One statement per surface, one sentence per row.
 *
 * The TUI section builds the same string with its local `knobHint`
 * (`packages/mpd-tui-plugin/src/settings.ts`) for every knob it renders, so a hint declared HERE is
 * byte-compatible with what a front door shows for the same path, and a slot knob's human sentence
 * (which member group the slot feeds) has exactly one declaration.
 */
export function knobHint(key: string, semantics?: string): string {
  // The mpd.jsonc key every hint names, spelled as the path a reader can look up in the file.
  const pointer = `mpd.jsonc ${key}`
  return semantics === undefined || semantics.length === 0 ? pointer : `${semantics} (${pointer})`
}

/**
 * The bridge disclosure, stated ONCE per settings surface: what a save writes, when it takes
 * effect, and what the host document holds meanwhile. Both front doors render this at the top of
 * their section instead of once per row.
 */
export const BRIDGE_SECTION_NOTICE = `${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`

/** One team-model slot's human identity: its group name in both languages and its members, in the group's own order. */
export interface TeamModelSlotGroup {
  /** The group name as the zh label and heading render it, e.g. `重推理成员`. */
  readonly zh: string
  /** The group name as the EN label and heading render it, e.g. `heavy members`. */
  readonly en: string
  /** The members this slot routes, in the group's own order — the order every sentence names them in. */
  readonly members: readonly string[]
}

/**
 * What each slot IS: one member group per slot (A3). The group name and the member list are the
 * ONLY inputs the shared per-leaf templates interpolate (slot 4 carries its own sentences below,
 * because it states an image-input constraint rather than a shared-route one), so a slot's copy is
 * declared once here and both front doors mirror it (the Web card cannot import this module).
 */
export const TEAM_MODEL_SLOT_GROUPS: Readonly<Record<(typeof TEAM_MODEL_SLOTS)[number], TeamModelSlotGroup>> = {
  slot1: { zh: "重推理成员", en: "heavy members", members: ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"] },
  slot2: { zh: "分析型成员", en: "analysis members", members: ["Researcher", "Explorer", "Plan Reviewer"] },
  slot3: { zh: "执行型成员", en: "execution members", members: ["Deep Worker", "Junior Engineer"] },
  slot4: { zh: "视觉成员", en: "vision member", members: ["Vision Analyst"] },
}

/**
 * The HUMAN sentence of one slot leaf, as a template: `{group}` is the slot's group name and
 * `{members}` its member list in the group's own order. The sentence states what the slot IS and
 * what configuring it DOES; it always renders BEFORE the mandatory disclosure, in both languages.
 */
const TEAM_MODEL_LEAF_TEMPLATES: Readonly<Record<keyof typeof TEAM_MODEL_FALLBACK_OPTIONS, { readonly en: string; readonly zh: string }>> = {
  provider: {
    en: "The provider half of this slot. The slots are the default model route of team members: when a team is created, the {group} ({members}) start on this slot's provider + model + reasoning effort. What changing it does: those members take the new route at the next team creation, and an unusable value makes team creation FAIL loudly, naming the member and the slot — it never silently substitutes another model. Vision Analyst is the vision member: slot 4 drives it.",
    zh: "这一档的提供商。各槽位合起来是 team 成员的默认模型路由：建队时，{group}（{members}）会按本档的 提供商+模型+推理强度 启动。改它的影响：这些成员下次建队即走新路由；填成不可用会让建队直接失败并点名成员与槽位，不会静默换模型。Vision Analyst 是视觉成员：由槽位 4 驱动。",
  },
  model: {
    en: "This slot's model. Together with the provider above, it decides the model the {group} ({members}) start on. What changing it does: same as above — effective at the next team creation; a model the provider does not offer makes team creation fail with the member and slot named.",
    zh: "这一档的模型。与上面的提供商共同决定 {group}（{members}）建队时使用的模型。改它的影响：同上，下次建队生效；模型与提供商不匹配、或该提供商没有这个模型时，建队会点名失败。",
  },
  reasoningEffort: {
    en: "This slot's reasoning effort (off / low / high / max). It sets how much the {group} ({members}) think when a team is created: max is the strongest, high the usual balance, low cheaper, off disables reasoning. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.",
    zh: "这一档的推理强度（off / low / high / max）。它决定 {group}（{members}）建队时的思考深度：max 最强、high 是常规平衡、low 更省、off 关闭思考。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。",
  },
}

/**
 * Slot 4's OWN leaf sentences. The shared templates above describe a member GROUP that shares a
 * route; the vision member needs the image-input constraint stated instead, because its whole
 * value is reading images. Declared once here and mirrored byte-for-byte by the Web card.
 */
const TEAM_MODEL_SLOT_LEAF_OVERRIDES: Partial<
  Record<(typeof TEAM_MODEL_SLOTS)[number], Readonly<Record<keyof typeof TEAM_MODEL_FALLBACK_OPTIONS, { readonly en: string; readonly zh: string }>>>
> = {
  slot4: {
    provider: {
      en: "The provider half of this slot. It drives Vision Analyst only (the one member that reads images, diagrams and screenshots). What changing it does: effective at the next team creation; an unusable value fails team creation loudly, naming the member and the slot. The model here must be a vision model that accepts image input (for example deepseek-v4-flash-vision-exp) — a text-only model breaks image analysis.",
      zh: "这一档的提供商。它只驱动 Vision Analyst（唯一负责看图/读图/分析截图的成员）。改它的影响：下次建队生效；填成不可用会让建队直接失败并点名成员与槽位。注意本档的模型必须是支持图像输入的视觉模型（例如 deepseek-v4-flash-vision-exp），换成纯文本模型会让看图任务失败。",
    },
    model: {
      en: "This slot's model. It MUST accept image input: Vision Analyst's whole value is reading images, and a text-only model makes its image tasks fail. What changing it does: effective at the next team creation.",
      zh: "这一档的模型。必须选支持图像输入的模型：Vision Analyst 的全部价值在于读图，纯文本模型会让它的读图任务直接失败。改它的影响：下次建队生效。",
    },
    reasoningEffort: {
      en: "This slot's reasoning effort (off / low / high / max). It sets how much Vision Analyst thinks while reading an image. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot.",
      zh: "这一档的推理强度（off / low / high / max）。决定 Vision Analyst 读图时的思考深度。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。",
    },
  },
}

/** The one-line IMPACT sentence a front door renders under a slot's group heading (the shared text for slots 1-3). */
export const TEAM_MODEL_SLOT_IMPACT: Readonly<Record<"en" | "zh", string>> = {
  en: "When a team is created these members start on this slot's provider · model · reasoning effort; an unusable value fails team creation loudly, naming the member and the slot.",
  zh: "建队时这些成员默认用本档的 提供商 · 模型 · 推理强度 启动；填错会让建队直接失败并点名成员与槽位。",
}

/** The vision slot's OWN impact line: it names the image-input requirement the other slots do not have. */
export const TEAM_MODEL_SLOT_IMPACT_OVERRIDES: Partial<Record<(typeof TEAM_MODEL_SLOTS)[number], Readonly<Record<"en" | "zh", string>>>> = {
  slot4: {
    en: "When a team is created Vision Analyst starts on this slot's provider · model · reasoning effort; the model here MUST accept image input or image analysis fails; an unusable value fails team creation loudly, naming the member and the slot.",
    zh: "建队时 Vision Analyst 默认用本档的 提供商 · 模型 · 推理强度 启动；本档的模型必须支持图像输入，否则看图任务会失败；填错会让建队直接失败并点名成员与槽位。",
  },
}

/** The impact line of ONE slot in `lang` — the shared sentence, or the slot's own override. */
export function teamModelSlotImpact(slot: (typeof TEAM_MODEL_SLOTS)[number], lang: "en" | "zh"): string {
  return (TEAM_MODEL_SLOT_IMPACT_OVERRIDES[slot] ?? TEAM_MODEL_SLOT_IMPACT)[lang]
}

/** One slot's members, joined in the group's own order with the separator the language uses. */
export function teamModelMembers(slot: (typeof TEAM_MODEL_SLOTS)[number], lang: "en" | "zh"): string {
  return TEAM_MODEL_SLOT_GROUPS[slot].members.join(lang === "zh" ? "、" : ", ")
}

/** One slot leaf's HUMAN sentence in `lang` — the sentence a front door renders BEFORE the disclosure. */
export function teamModelLeafSentence(
  slot: (typeof TEAM_MODEL_SLOTS)[number],
  leaf: keyof typeof TEAM_MODEL_FALLBACK_OPTIONS,
  lang: "en" | "zh",
): string {
  // Slot 4's OWN override wins; every other slot falls through to the shared template below.
  const override = TEAM_MODEL_SLOT_LEAF_OVERRIDES[slot]?.[leaf]
  if (override !== undefined) return override[lang]
  return TEAM_MODEL_LEAF_TEMPLATES[leaf][lang]
    .split("{group}")
    .join(TEAM_MODEL_SLOT_GROUPS[slot][lang])
    .split("{members}")
    .join(teamModelMembers(slot, lang))
}

/** The group heading a front door renders ABOVE a slot's three rows, e.g. `Slot 2 — analysis members (…)`. */
export function teamModelSlotHeading(slot: (typeof TEAM_MODEL_SLOTS)[number], lang: "en" | "zh"): string {
  // 1-based slot number: the heading names `Slot 1` … `Slot 4`, never the internal `slot1` id.
  const index = TEAM_MODEL_SLOTS.indexOf(slot) + 1
  // The slot's human identity: the zh/en group names the heading must render.
  const group = TEAM_MODEL_SLOT_GROUPS[slot]
  return lang === "zh"
    ? `槽位 ${index} —— ${group.zh}（${teamModelMembers(slot, "zh")}）`
    : `Slot ${index} — ${group.en} (${teamModelMembers(slot, "en")})`
}

/** The twelve team-model knobs: every slot leaf, in slot order, each a `select` with a declared fallback list. */
const TEAM_MODEL_KNOBS: readonly SettingsKnob[] = TEAM_MODEL_SLOTS.flatMap((slot) => {
  // 1-based slot number, so the knob labels below name the slot a user sees in the heading.
  const index = TEAM_MODEL_SLOTS.indexOf(slot) + 1
  // The slot's group name, appended to each leaf label so a row is attributable without its heading.
  const group = TEAM_MODEL_SLOT_GROUPS[slot]
  // The slot's three leaves, in the fixed order both front doors render them.
  const leaves: readonly { leaf: keyof typeof TEAM_MODEL_FALLBACK_OPTIONS; label: string; zh: string }[] = [
    { leaf: "provider", label: "provider", zh: "提供商" },
    { leaf: "model", label: "model", zh: "模型" },
    { leaf: "reasoningEffort", label: "reasoning effort", zh: "推理强度" },
  ]
  return leaves.map(({ leaf, label, zh }) => ({
    path: ["teamModels", slot, leaf] as const,
    label: `Slot ${index} ${label} (${group.en})`,
    zh: `槽位 ${index} ${zh}（${group.zh}）`,
    kind: "select" as const,
    options: TEAM_MODEL_FALLBACK_OPTIONS[leaf],
    semantics: teamModelLeafSentence(slot, leaf, "en"),
    semanticsZh: teamModelLeafSentence(slot, leaf, "zh"),
    hint: knobHint(`teamModels.${slot}.${leaf}`, teamModelLeafSentence(slot, leaf, "en")),
  }))
})

/** One knob: the decoded settings path plus the labels both front doors render. */
export interface SettingsKnob {
  /** Decoded settings path this knob edits, root segment first. */
  readonly path: readonly string[]
  /** The EN row title a front door renders; kept short because it IS the row's own label. */
  readonly label: string
  /** The zh row title, declared once here so both front doors render the same string. */
  readonly zh: string
  /** Which editor widget a front door must render for this leaf. */
  readonly kind: "number" | "boolean" | "select" | "text"
  /** The allowed values of a `select` knob, in display order; absent for every other kind. */
  readonly options?: readonly string[]
  /**
   * The knob's HUMAN sentence (EN): what the knob IS and what configuring it DOES. A front door
   * renders it BEFORE the disclosure half of {@link hint}; a knob with no non-obvious effect
   * leaves it undefined and keeps the disclosure-only hint.
   */
  readonly semantics?: string
  /** The same sentence in zh, for a front door rendering the zh locale (the Web card mirrors it). */
  readonly semanticsZh?: string
  /**
   * One sentence of SEMANTICS for a knob whose effect is not self-evident from its label
   * (w16). A front door renders it next to the row when it has room for a second line; the
   * label/zh above stay short because they are the row's title.
   */
  readonly hint?: string
}

/** The twenty-six knobs, in display order: the original thirteen, the twelve team-model slot leaves, then the TUI surface's own knob. */
export const SETTINGS_KNOBS: readonly SettingsKnob[] = [
  { path: ["hashline", "maxDiffChars"], label: "Inline diff limit", zh: "行内 diff 上限", kind: "number" },
  { path: ["commentChecker", "autoCheck"], label: "Comment checker", zh: "注释检查", kind: "boolean" },
  { path: ["ulw", "maxRounds"], label: "Ultrawork rounds", zh: "Ultrawork 轮数", kind: "number" },
  { path: ["memory", "vcs"], label: "Memory backend", zh: "记忆后端", kind: "select", options: ["git", "svn"] },
  { path: ["team", "stateDir"], label: "Team state directory", zh: "团队状态目录", kind: "text" },
  { path: ["boulder", "dir"], label: "Boulder directory", zh: "Boulder 目录", kind: "text" },
  { path: ["watchdog", "enabled"], label: "Watchdog enabled", zh: "看门狗启用", kind: "boolean" },
  { path: ["watchdog", "warnSilenceMs"], label: "Silence warning threshold (ms)", zh: "静默告警阈值（毫秒）", kind: "number" },
  { path: ["watchdog", "tickIntervalMs"], label: "Watchdog tick interval (ms)", zh: "看门狗轮询间隔（毫秒）", kind: "number" },
  { path: ["watchdog", "warnStreakToEscalate"], label: "Warn streak before escalation", zh: "升级前连续告警次数", kind: "number" },
  { path: ["watchdog", "actionOnEscalate"], label: "Action on escalation", zh: "升级时的动作", kind: "select", options: ["pause", "warn-only"] },
  { path: ["watchdog", "toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", hint: "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound" },
  { path: ["watchdog", "holdTtlMs"], label: "Hold TTL (ms, 0 = no expiry)", zh: "暂停持有有效期（毫秒，0 表示不设有效期）", kind: "number", hint: "how long a watchdog hold may stay latched before it auto-releases: past this bound the hold releases itself and changes ZERO team bytes, and activity newer than the hold releases it sooner — `0` disables the expiry" },
  ...TEAM_MODEL_KNOBS,
  // The TUI surface's own knob, LAST so every index-keyed assertion over the original thirteen and
  // the twelve slot leaves keeps its meaning. Its `hint` is the semantics sentence only — the
  // bridge/restart disclosure is appended by each front door's own hint builder, never hand-written.
  { path: ["tui", "dashboardKey"], label: "Ctrl+A dependency view (old dsh-tui builds)", zh: "Ctrl+A 依赖视图（旧版 dsh-tui）", kind: "boolean", hint: "applies to hosts WITHOUT the sidebar panel seam (dsh-tui before 0.13.0) only: while MPD's team projection has a team with at least one task, Ctrl+A opens MPD's merged dependency view instead of the host's subagent dashboard, and with no team Ctrl+A keeps opening the host dashboard — on a host that offers the panel seam, Ctrl+A always keeps its host dashboard meaning and the merged view opens through alt+a and /mpd panel" },
]
