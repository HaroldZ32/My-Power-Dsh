// MPD's own bilingual dictionary for the TUI strings the HOST gives no localized field.
//
// WHY THIS EXISTS AT ALL (measured, plan `docs/plan-webui-tui-i18n.md` §5): the installed
// dsh-tui exposes per-contribution localized FIELDS — `TuiSettingsField.descriptions` /
// `.hintDescriptions`, `TuiSettingsFieldOption.descriptions`, `TuiSettingsSection.descriptions`,
// `TuiCommandTreeProvider.descriptions`, `LocalCommand.descriptions` — and the host resolves each
// of them with `pick(text, descriptions) === descriptions?.[getLang()] ?? text` at render time
// (`lib/types/screens/Settings.js`). Those fields are the PRIMARY mechanism and this module must
// never be used for a string that HAS one.
//
// What they cannot cover, on dsh-tui 0.12.0: a scene `title`, a shortcut `description`, a status
// entry's `text`, a dialog's own title/labels and every literal this plugin renders itself. There
// is NO language seam for plugins (`TUI_SEAMS` names fifteen `tui*` services and none is i18n;
// `lib/types/api.d.ts` does not re-export `i18n.d.ts`), so MPD resolves the language itself,
// reusing the HOST'S OWN chain as shipped in `lib/types/i18n.js`:
//
//   1. `DSH_TUI_LANG` (`en`/`zh`) — pinned at process start, wins over everything
//      (`resolveStartupLang()`'s first branch);
//   2. the persisted `/lang` choice, `~/.dsh-tui/lang.json` (`{ "lang": "en" }`)
//      (`readLangPref()`, same default directory);
//   3. the OS locale guess — `LC_ALL` || `LC_MESSAGES` || `LANG`; a `zh` prefix is zh, any OTHER
//      stated locale is en, and an ABSENT locale is zh (`detectLocaleLang()`). The host's `||`
//      chain (not `??`) matters: an EMPTY locale variable means "unset" and falls through.
//   4. `zh` — the host's own hard-coded default.
//
// BINDING LIMITS, stated rather than papered over:
//
//   • Resolution happens AT USE — the next render or the next command — so it follows a restart
//     and follows the next use after a `/lang` switch, but it is NOT a per-frame subscription:
//     `subscribeLang()` lives in a host module plugins may not import, and no surface here may
//     claim a live repaint on a language switch. `resolveLang()` is therefore called at the point
//     a string is built, never cached in a module-level constant.
//   • `~/.dsh-tui` is an ABSOLUTE path under the user's HOME and is READ ONLY. MPD owns no language
//     preference of its own and never writes that directory: `/lang` stays the single switch. (Not
//     `DSH_HOME`: the host resolves its preference directory from the home directory, which is why
//     QA isolates by setting `HOME`.)
//   • A host using `cordis.yml`'s `lang` overrides this order from the top (the host's
//     `plugin.apply` reads it before `resolveStartupLang`). MPD cannot see that key from a plugin,
//     so a `cordis.yml`-pinned language is a KNOWN gap, not a silent one.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The two languages this bundle ships. */
export type TuiLang = "zh" | "en"

/** The host's own preference directory, resolved from the home directory (never `DSH_HOME`). */
export const HOST_PREFS_DIR = ".dsh-tui"

/** The host's preference file name inside {@link HOST_PREFS_DIR}. */
export const HOST_LANG_FILE = "lang.json"

/** The env var the host pins the startup language with, checked first. */
export const LANG_ENV = "DSH_TUI_LANG"

/** The locale variables the host consults, in ITS order (`LC_ALL` first, `||`-chained). */
export const LOCALE_ENV_VARS = ["LC_ALL", "LC_MESSAGES", "LANG"] as const

/** A string in both languages; the pair is the declaration, the language is chosen at use. */
export interface Bilingual {
  /** The 简体中文 text. */
  readonly zh: string
  /** The English text. */
  readonly en: string
}

/** What the language resolution reads; every input is injectable so a test needs no process state. */
export interface LangInputs {
  /** The process environment; `process.env` when omitted. */
  readonly env?: Record<string, string | undefined>
  /** The home directory the preference file hangs off; `homedir()` when omitted. */
  readonly home?: string
  /** The preference-file reader; every failure mode is the caller's to swallow. */
  readonly readFile?: (path: string) => string
}

/** Whether a value is one of the two shipped language tags (the host's own `isLang`). */
export function isLang(value: unknown): value is TuiLang {
  return value === "zh" || value === "en"
}

/** The language a stated tag names, or undefined when it names neither (covers `zh-CN`, `EN`). */
function langPrefix(value: unknown): TuiLang | undefined {
  if (typeof value !== "string") return undefined
  /** The tag without any region/encoding suffix, lower-cased. */
  const head = value.split(/[._-]/u)[0]?.toLowerCase() ?? ""
  return head === "zh" ? "zh" : head === "en" ? "en" : undefined
}

/**
 * The OS-locale guess, mirroring the host's `detectLocaleLang()`.
 *
 * `||` (not `??`) is deliberate: an EMPTY locale variable means "unset" and must fall through to
 * the next one, which is also what makes a CI runner's `LANG=C.UTF-8` resolve to en.
 * @param env - the environment to read.
 * @returns the guessed language; zh when NO locale is stated (the host's own default).
 */
export function detectLocaleLang(env: Record<string, string | undefined>): TuiLang {
  /** The locale string the environment states; empty while no variable carries one. */
  let raw = ""
  for (const name of LOCALE_ENV_VARS) {
    /** The locale this variable states, when it is a non-empty string. */
    const stated = env[name]
    if (typeof stated === "string" && stated.length > 0) {
      raw = stated
      break
    }
  }
  /** The locale without its `.encoding` suffix, lower-cased. */
  const locale = raw.split(".")[0]?.toLowerCase() ?? ""
  if (locale === "") return "zh"
  return locale.startsWith("zh") ? "zh" : "en"
}

/**
 * The `/lang` preference the host persisted, when the file holds a valid tag.
 * @param inputs - the home directory and the reader.
 * @returns the persisted language, or undefined when the file is absent, unreadable or invalid.
 */
export function readLangPref(inputs: LangInputs = {}): TuiLang | undefined {
  /** The reader; a missing injectable falls back to the real filesystem. */
  const read = inputs.readFile ?? ((path: string): string => readFileSync(path, "utf8"))
  /** The host's preference directory for this home. */
  const dir = join(inputs.home ?? homedir(), HOST_PREFS_DIR)
  /** The raw preference text the file read produced. */
  let text: string
  try {
    text = read(join(dir, HOST_LANG_FILE))
  } catch {
    return undefined
  }
  try {
    /** The parsed document, validated as an object before its `lang` is trusted. */
    const parsed: unknown = JSON.parse(text)
    /** The tag the document states. */
    const tag = typeof parsed === "object" && parsed !== null ? (parsed as { lang?: unknown }).lang : undefined
    return isLang(tag) ? tag : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the language AT USE, through the host's own precedence chain.
 *
 * Call this where a string is built (a render, a command, a dialog request). Do not cache the
 * result in a module-level constant: the host exposes no language subscription to plugins, so a
 * cached value would silently outlive a `/lang` switch.
 * @param inputs - the environment, the home directory and the preference reader.
 * @returns the language to render with.
 */
export function resolveLang(inputs: LangInputs = {}): TuiLang {
  /** The environment this resolution reads. */
  const env = inputs.env ?? process.env
  /** The pinned startup language, when the host (or a QA script) set one. */
  const pinned = env[LANG_ENV]
  if (isLang(pinned)) return pinned
  return readLangPref(inputs) ?? detectLocaleLang(env)
}

/**
 * Pick one half of a bilingual string.
 * @param text - the pair.
 * @param lang - the language, ALREADY resolved by the caller.
 * @returns the text in that language.
 */
export function pick(text: Bilingual, lang: TuiLang): string {
  return lang === "en" ? text.en : text.zh
}

/**
 * Render a bilingual pair by RESOLVING the language now.
 *
 * This is the one-call form for a surface that has no other use for the language tag. A surface
 * that builds several strings (a whole panel) should call {@link resolveLang} once and
 * {@link pick} per string, so one render cannot mix two languages.
 * @param text - the pair.
 * @param inputs - the resolution inputs; process state when omitted.
 * @returns the text in the active language.
 */
export function bilingual(text: Bilingual, inputs: LangInputs = {}): string {
  return pick(text, resolveLang(inputs))
}

/** The user-visible strings this module owns, keyed by a stable id. */
export const TUI_TEXT = {
  /** Scene titles: the host draws a scene's `title` verbatim and localizes nothing. */
  "scene.board": { zh: "MPD 面板", en: "MPD board" },
  "scene.team": { zh: "MPD 团队", en: "MPD team" },
  "scene.plan": { zh: "MPD 计划审批", en: "MPD plan approval" },
  "scene.subagents": { zh: "MPD 子代理 · 团队", en: "MPD subagents · team" },
  /** The `/mpd` command's own output sentences (what a user ACTS on). */
  "command.boardMissing": { zh: "mpd: 该组合不提供面板场景", en: "mpd: the board scene is not available in this composition" },
  "command.teamMissing": { zh: "mpd: 该组合不提供团队工作流场景", en: "mpd: the team workflow scene is not available in this composition" },
  "command.subagentsMissing": { zh: "mpd: 该组合不提供子代理与团队合并面板", en: "mpd: the subagents + team panel is not available in this composition" },
  "command.planMissing": { zh: "mpd: 该组合不提供计划审批场景", en: "mpd: the plan approval scene is not available in this composition" },
  "command.unknownAction": { zh: "mpd: 未知动作“{action}” —— 用法：{usage}", en: "mpd: unknown action \"{action}\" — usage: {usage}" },
  "command.workmatesNone": { zh: "mpd workmates：无", en: "mpd workmates: none" },
  "command.workmatesList": { zh: "mpd workmates（{count}）：{names}", en: "mpd workmates ({count}): {names}" },
  /**
   * The sidebar PANEL's own status sentences (`/mpd panel`).
   *
   * One per outcome the routed open can produce, because the seam's own answers must not read as
   * one: the panel was opened; the panel DECLINED the open and the full-screen scene opened
   * instead; the host bound the seam but REFUSED the registration (a different fact from a missing
   * seam, and a different fix); or this host has no panel seam at all and the scene IS the surface.
   */
  // R26 — THE HONEST SENTENCE. It used to say the panel had "opened", which is a claim the command
  // cannot make: `tuiPanels.open(id)` returns a DELIVERY ack that is true whenever a Chat consumer is
  // attached, while the host's own `useSidePanel` DROPS the request for an id that is not enabled in the
  // display-prefs CSV. Measured: the panel frame after `/mpd panel` had NO divider while the very next
  // `Ctrl+B` frame did. So the sentence states only what was measured (the host accepted the id AND the
  // request) and names the step that actually makes the panel visible — the two host switches this wave
  // root-caused. All THREE pages inherit it through `panelStatusLine`, so there is one wording, not three.
  "panel.opened": {
    zh: "mpd 侧栏面板：宿主已接受 {id}；若没有出现面板，请在 /settings → 侧栏里把 {id} 加入面板列表，并按 Ctrl+B 展开（或开启“启动时展开侧栏”）",
    en: "mpd sidebar panel: the host accepted {id}; if no panel appeared, add {id} to the panel list in /settings → side panel, then press Ctrl+B (or turn on \"Side panel starts open\")",
  },
  "panel.fallback": { zh: "mpd 侧栏面板：宿主拒绝了打开请求（{id}），已改为全屏面板", en: "mpd sidebar panel: the host refused the open request ({id}); opened the full-screen panel instead" },
  "panel.refused": { zh: "mpd 侧栏面板：宿主拒绝了该面板的注册，已改为全屏面板", en: "mpd sidebar panel: the host refused the panel registration; opened the full-screen panel instead" },
  "panel.unavailable": { zh: "mpd 侧栏面板：该宿主不提供面板接缝，使用全屏面板", en: "mpd sidebar panel: this host exposes no panel seam; using the full-screen panel" },
  /** The scene's own notices (a refused open, a missing precondition). */
  "scene.planNeedsStaged": { zh: "计划审批需要一个待定计划", en: "plan approval needs a staged team" },
  "scene.planMissing": { zh: "该组合不提供计划审批界面", en: "the plan approval surface is not available in this composition" },
  /** The board's empty states — each names the call that fills it. */
  "board.noTeam": { zh: "团队       （本工作区无）", en: "team       (none in this workspace)" },
  "board.noBoulder": { zh: "boulder    （无工作台账）", en: "boulder    (no work ledger)" },
  /** The status line: rebuilt on every refresh, so it follows the language at the next publish. */
  "status.teamRow": { zh: "团队 {name} {members}·{done}/{total}", en: "team {name} {members}·{done}/{total}" },
  "status.teamNone": { zh: "团队 -", en: "team -" },
  "status.failed": { zh: "失败 {n}", en: "failed {n}" },
  "status.boulder": { zh: "boulder {active}/{works}", en: "boulder {active}/{works}" },
  "status.plans": { zh: "计划 {n}", en: "plans {n}" },
  "status.workmates": { zh: "workmate {n}", en: "workmates {n}" },
  "status.notes": { zh: "提示 {n}", en: "notes {n}" },
  /** The watchdog front door: its notice is the status line's other actionable content. */
  "watchdog.notice": { zh: "看门狗：{parts}", en: "watchdog: {parts}" },
  "watchdog.held": { zh: "已暂停 {teams}", en: "held {teams}" },
  "watchdog.unread": { zh: "{n} 条未读事件", en: "{n} unread incidents" },
  "watchdog.unreadOne": { zh: "{n} 条未读事件", en: "{n} unread incident" },
  "watchdog.holdDetail": { zh: "团队 {teams} 被团队看门狗暂停（有成员静默）。", en: "Team {teams} is held by the team watchdog (a member went silent)." },
  "watchdog.replayDetail": { zh: "团队看门狗在无人观看时记录了事件。", en: "The team watchdog recorded incidents while nobody was watching." },
  "watchdog.acknowledge": { zh: "确认", en: "Acknowledge" },
  "watchdog.acknowledgeHint": { zh: "把这些事件标记为已读，不再重复提示", en: "mark these incidents as read so they stop being replayed" },
  "watchdog.later": { zh: "稍后", en: "Later" },
  "watchdog.laterHint": { zh: "保持未读，下次启动再显示", en: "keep them unread; they will be shown again on the next start" },
} as const satisfies Record<string, Bilingual>

/** One key of {@link TUI_TEXT}. */
export type TuiTextKey = keyof typeof TUI_TEXT

/**
 * The `{name}` placeholders one text may carry, substituted after the language is chosen.
 *
 * A value is a string OR a number: a count is naturally a number at the call site
 * (`{ members: state.team.members }`), and forcing every caller to stringify it by hand is how a
 * placeholder ends up rendered as the wrong thing. The substitution joins either shape.
 */
export type TuiTextParams = Readonly<Record<string, string | number>>

/**
 * Localize one dictionary entry at use and substitute its placeholders.
 * @param key - the entry id.
 * @param params - the placeholder values, when the entry has any.
 * @param inputs - the resolution inputs; process state when omitted.
 * @returns the text in the active language.
 */
/**
 * The DISPLAY names of the reasoning-effort ids a catalog reports.
 *
 * WHY A SEPARATE MAP, and why it is honest: the panel's option list carries the catalog's own labels,
 * and a catalog that reports an effort merely as `off`/`low`/`high`/`max` has no localized name to
 * show — so a Chinese screen displayed `Off` above a Chinese description, which reads half-translated
 * (the reviewer flagged it as F5). The map changes ONLY the label; the VALUE written to the settings
 * document is always the raw id, because that is what the model route accepts.
 *
 * An effort id this map does not know keeps its raw id as its label — the map ADDS names, it never
 * guesses one.
 */
export const EFFORT_LABELS: Record<string, Bilingual> = {
  off: { zh: "关闭", en: "off" },
  low: { zh: "低", en: "low" },
  medium: { zh: "中", en: "medium" },
  high: { zh: "高", en: "high" },
  max: { zh: "最高", en: "max" },
}

/**
 * The label one reasoning-effort option shows.
 * @param id - the raw effort id the catalog reported (also the value that gets written).
 * @param inputs - the resolution inputs; process state when omitted.
 * @returns the localized name when one is known, else the raw id.
 */
export function effortLabel(id: string, inputs: LangInputs = {}): string {
  /** The known name for this id, when there is one. */
  const known = EFFORT_LABELS[id]
  return known === undefined ? id : pick(known, resolveLang(inputs))
}

/**
 * Localize one dictionary entry at use and substitute its placeholders.
 * @param key - the entry id.
 * @param params - the placeholder values, when the entry has any.
 * @param inputs - the resolution inputs; process state when omitted.
 * @returns the text in the active language.
 */
export function t(key: TuiTextKey, params?: TuiTextParams, inputs: LangInputs = {}): string {
  return substitute(pick(TUI_TEXT[key], resolveLang(inputs)), params)
}

/**
 * Substitute `{name}` placeholders in an already-localized text.
 * @param text - the localized sentence.
 * @param params - the placeholder values; an absent name is left verbatim.
 * @returns the sentence with every known placeholder replaced.
 */
export function substitute(text: string, params?: TuiTextParams): string {
  if (params === undefined) return text
  /** The text with each named placeholder replaced. */
  let out = text
  for (const [name, value] of Object.entries(params)) out = out.split(`{${name}}`).join(String(value))
  return out
}
