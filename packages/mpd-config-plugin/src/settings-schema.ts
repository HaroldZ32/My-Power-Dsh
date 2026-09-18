// The `mpd` settings namespace: ONE source for its schema, its knob metadata and the disclosure
// both front doors state.
//
// §10.1 places the REGISTRATION in this package (it is the only module that can supply the
// file-derived `base`); the TUI package keeps a guarded fallback for compositions without this
// plugin. Both therefore read the schema and the field list from HERE, so the two front doors
// cannot drift and the twenty-two knobs (thirteen mpd knobs + nine team-model slot leaves) stay
// one declaration.
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"

/** The settings namespace the section and the Web card both edit. */
export const SETTINGS_NS = "mpd"

/** The three team-model slots, in display order (slot1 first). */
export const TEAM_MODEL_SLOTS = ["slot1", "slot2", "slot3"] as const

/** One team-model slot: the provider, the model and the reasoning effort a member class stages on. */
export interface TeamModelSlot {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
}

/**
 * The three slot DEFAULTS — ONE literal declaration, so the schema defaults, the config layer's
 * READ-PATH materialisation and the tests cannot drift apart. Values are the frozen vocabulary of
 * the settings contract §1.1: provider `deepseek-official`, model `deepseek-v4-flash`, efforts
 * `max` / `high` / `high` for slot1 / slot2 / slot3 — i.e. the live behaviour of the member
 * classes before the slots existed.
 */
export const TEAM_MODEL_SLOT_DEFAULTS: Readonly<Record<(typeof TEAM_MODEL_SLOTS)[number], TeamModelSlot>> = {
  slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
  slot2: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot3: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
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
function teamModelSlotSchema(slot: TeamModelSlot) {
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
  boulder: z.object({ dir: z.string().default(".mpd") }),
  // The three team-model slots (§3.1 of the plan of record): each is the DEFAULT route of one
  // member class — slot1 Architect/Planner/Reviewer/Lead/Senior Engineer, slot2 the analysts
  // Researcher/Explorer/Plan Reviewer, slot3 the executors Deep Worker/Junior Engineer. The
  // schema default is the L0 layer a fresh workspace resolves to; the read path materialises it
  // (see `withTeamModelsDefaults`) so a consumer never has to apply defaults itself.
  teamModels: z.object({
    slot1: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot1),
    slot2: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot2),
    slot3: teamModelSlotSchema(TEAM_MODEL_SLOT_DEFAULTS.slot3),
  }),
  // The watchdog block is the §3 defaults table of the frozen contract and MUST stay byte-equal in
  // value to `packages/mpd-team-watchdog-plugin/src/machine.ts` `WATCHDOG_DEFAULTS` and to the
  // `mpd-team-watchdog` row config in `packages/mpd-bundle/cordis.patch.yml` — those are the three
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

/** The runtime notice for a save with several live roots: settings-only, per the refusal rule. */
export const BRIDGE_AMBIGUOUS_NOTICE = "saved to settings — not written to any file: several live workspaces, so the target is ambiguous (see the log for the candidates)"

/**
 * One knob hint: the real mpd.jsonc key, the bridge disclosure and the not-lost clause, plus —
 * for a knob whose effect is not self-evident — one sentence of semantics. The TUI section builds
 * the SAME prefix with its local `knobHint` (`packages/mpd-tui-plugin/src/settings.ts`) for every
 * knob it renders, so a hint declared HERE is byte-compatible with what a front door shows for the
 * same path, and a slot knob's semantics sentence (which member class the slot feeds) has exactly
 * one declaration.
 */
export function knobHint(key: string, semantics?: string): string {
  return `mpd.jsonc ${key} — ${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}${semantics === undefined ? "" : " " + semantics}`
}

/**
 * One sentence of SEMANTICS per slot, naming the member class the slot feeds (A3). The sentence
 * rides all three leaves of a slot because the SLOT routes the class while the LEAF names the
 * value; the leaf is identified by the label and by the dotted key inside the hint.
 */
const TEAM_MODEL_SLOT_SEMANTICS: Readonly<Record<(typeof TEAM_MODEL_SLOTS)[number], string>> = {
  slot1:
    "slot 1 is the default route of the slot-1 members (Architect, Planner, Reviewer, Lead, Senior Engineer): a member of that class that declares no explicit route of its own is staged on this provider/model/effort",
  slot2:
    "slot 2 is the default route of the slot-2 analysts (Researcher, Explorer, Plan Reviewer): a member of that class that declares no explicit route of its own is staged on this provider/model/effort, while Vision Analyst keeps its own explicit vision route",
  slot3:
    "slot 3 is the default route of the slot-3 executors (Deep Worker, Junior Engineer): a member of that class that declares no explicit route of its own is staged on this provider/model/effort",
}

/** The nine team-model knobs: every slot leaf, in slot order, each a `select` with a declared fallback list. */
const TEAM_MODEL_KNOBS: readonly SettingsKnob[] = TEAM_MODEL_SLOTS.flatMap((slot, index) => {
  const leaves: readonly { leaf: keyof typeof TEAM_MODEL_FALLBACK_OPTIONS; label: string; zh: string }[] = [
    { leaf: "provider", label: "provider", zh: "提供商" },
    { leaf: "model", label: "model", zh: "模型" },
    { leaf: "reasoningEffort", label: "reasoning effort", zh: "推理强度" },
  ]
  return leaves.map(({ leaf, label, zh }) => ({
    path: ["teamModels", slot, leaf] as const,
    label: `Slot ${index + 1} ${label}`,
    zh: `槽位 ${index + 1} ${zh}`,
    kind: "select" as const,
    options: TEAM_MODEL_FALLBACK_OPTIONS[leaf],
    hint: knobHint(`teamModels.${slot}.${leaf}`, TEAM_MODEL_SLOT_SEMANTICS[slot]),
  }))
})

/** One knob: the decoded settings path plus the labels both front doors render. */
export interface SettingsKnob {
  readonly path: readonly string[]
  readonly label: string
  readonly zh: string
  readonly kind: "number" | "boolean" | "select" | "text"
  readonly options?: readonly string[]
  /**
   * One sentence of SEMANTICS for a knob whose effect is not self-evident from its label
   * (w16). A front door renders it next to the row when it has room for a second line; the
   * label/zh above stay short because they are the row's title.
   */
  readonly hint?: string
}

/** The twenty-two knobs, in display order: the original thirteen, then the nine team-model slot leaves. */
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
]
