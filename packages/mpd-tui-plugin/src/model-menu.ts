// `/mpd-model` — the SELECTION-STYLE model settings menu, keyed by AGENT.
//
// WHAT THE USER GETS: one command that opens a real host pick-list and walks the chain
// group → scope (whole group / one agent) → provider → model → reasoning effort, then WRITES the
// picked route into the SAME `mpd-config` entry the `/settings` section edits — as
// `agentRoutes.<Agent>.<leaf>`, one entry PER AGENT. The four groups are only a BULK-EDIT shortcut
// (contract §1): a group write stores nothing of its own, it writes every member's own entry. The
// chain therefore also has a CONFIRMATION panel for a whole-group write (listing every affected agent
// with its current effective route) and a CLEAR branch for a single agent.
//
// WHAT IT IS NOT: the retired `teamModels.<slot>` block is never written here — it is a tolerated
// legacy node that the one-time migration consumes, and a display that still advertised it would point
// a reader at a block no spawn reads. `locateNamespace` picks the ONE namespace the write targets
// (the entry that already carries an `agentRoutes` block, else the config ENTRY), and every op lands
// under `agentRoutes`.
//
// THE TYPED READ IS THE CONFIG SERVICE'S: `agentRouteResolutionOf(member)` answers
// `{ok:true,route}` / `{ok:false,reason:"unconfigured"|"invalid"}` / `{ok:false,reason:"unrouted"}`
// and NEVER throws (contract §2), so every panel renders `<unconfigured>` / `<invalid>` /
// `<unavailable>` honestly; a read the composition does not provide degrades to `<unavailable>`, never
// to a throw. The seam is the package's own `dialogs.ts#createDialogs` wrapper over
// `TuiAdapter.dialogs()` — this file never names a `ctx.tui*` service (the `no-direct-tui-access` gate)
// and never writes to fd 1/2 (the `no-terminal-writes` gate).
//
// WHY A MENU WHEN THE SECTION ALREADY HAS THE ROWS: the host renders a `select` field by CYCLING a
// frozen option list and offers no pick-list dialog (measured; see `settings.ts`), so thirty-three
// route leaves can only be cycled one value at a time. The menu is the same writes with the choice
// made in one dialog per leaf — plus the two things a flat row list cannot express: a bulk edit and a
// clear.
//
// THE OPTION SOURCES ARE THE SECTION'S OWN (contract §4.1): the catalog is read through
// `settings.ts#resolveCatalogReader` → `tui.llmCatalog()`, and the option projection is the
// section's `teamModelOptionLists`, so the menu and the rows cannot disagree about what a
// provider, a model or an effort is. That matters because a value the panel offers but the
// schema rejects would refuse that agent's spawn LATER, naming the agent and the missing leaf.
//
// DEGRADATION IS EXPLICIT (contract §4). Three things can stop the chain, and each ends it with
// ONE sentence naming WHICH happened:
//   • the dialogs seam is absent (a headless embedder) — nothing is shown and nothing is written;
//   • the live catalog is absent or DEGRADED — the panels still open over the declared fallback
//     options, and the outcome sentence says the list is not the live catalog;
//   • a panel was cancelled (`undefined`) — the chain stops there and NOTHING is written.
//
// A CANCEL AT ANY PANEL WRITES NOTHING — including the confirmation panel, whose "not confirmed" is
// the same fact as a cancel. That is not a convention here: the write is the last statement of a
// straight-line chain, and every early return above it happens before the ops are built.
import type { PluginContextLike, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"
import { scalarText } from "./sanitize.js"
import { createDialogs } from "./dialogs.js"
import type { DialogSeam } from "./dialogs.js"
import { AGENT_ROUTES_PREFIX, AGENT_ROUTE_MEMBERS, BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, agentRouteDisplay, configServiceOf, resolveCatalogReader, teamModelOptionLists, SETTINGS_ENTRY } from "./settings.js"
import type { AgentRouteDisplay, AgentRouteServiceLike, CatalogReadSeam, SettingsOption, TeamModelOptionLists, TeamModelLeaf } from "./settings.js"
// THE SHARED DECLARATION, never a second copy of it: the group names/members the panels render, the ONE
// member-name normalizer (contract amendment 2 §2 — the same exported function, never re-implemented) and
// the members sentence the settings rows also use. This is the file's ONLY cross-package import line.
import { TEAM_MODEL_SLOT_GROUPS, TEAM_MODEL_SLOTS, agentNameKey, teamModelMembers } from "../../mpd-config-plugin/src/settings-schema"
import { MODEL_COMMAND, MODEL_COMMAND_DESCRIPTIONS, MODEL_COMMAND_DESCRIPTION } from "./command-trees.js"
import { effortLabel, pick, resolveLang } from "./i18n.js"
import type { Bilingual, TuiLang } from "./i18n.js"

export { MODEL_COMMAND, MODEL_COMMAND_DESCRIPTION, MODEL_COMMAND_DESCRIPTIONS }

/**
 * The LEGACY registered namespace the file bridge hangs off — NOT the write default.
 *
 * `mpd-config` registers this name for the `.mpd/mpd.jsonc` file-derived base, but on this harness the
 * settings machinery is keyed by profile ENTRY id, so a mutate addressed here is refused by the host
 * (`Plugin entry "mpd" is no longer configurable`). It is probed only because a value written by an
 * older surface may still live under it; {@link locateNamespace} falls back to `SETTINGS_ENTRY`.
 */
export const MODEL_NAMESPACE = "mpd"

/** The three leaves of one agent route, in the schema's path order (`agentRoutes.<Agent>.<leaf>`). */
const ROUTE_LEAVES: readonly TeamModelLeaf[] = ["provider", "model", "reasoningEffort"]

/** The scope option id that means "every member of the picked group" (the bulk edit). */
export const GROUP_SCOPE_ID = "group"

/** The action option id that opens the provider → model → effort chain. */
const ACTION_SET = "set"

/** The action option id that removes one agent's entry (the clear branch). */
const ACTION_CLEAR = "clear"

/** How many DISTINCT routes a group's option line prints before it collapses the rest into a count. */
const MAX_GROUP_ROUTES = 3

/** What `/mpd-model` needs from the rest of the plugin; every member is injectable for a test. */
export interface ModelMenuOptions {
  /** The dialog seam; the command's own wrapper when omitted. */
  readonly dialogs?: DialogSeam
  /** The catalog/settings seam; resolved from `ctx` through the section's reader when omitted. */
  readonly adapter?: CatalogReadSeam
  /** The context the default adapter and the config service are resolved from. */
  readonly ctx?: unknown
  /** The config service slice the panels' route sentences read; resolved from `ctx` when omitted. */
  readonly configService?: AgentRouteServiceLike
  /** The language resolution inputs (`DSH_TUI_LANG` / the preference file / the locale). */
  readonly langInputs?: Parameters<typeof resolveLang>[0]
}

/** The outcome of one `/mpd-model` invocation, as the command registry renders it. */
export type ModelMenuResult = { kind: "success"; text?: string } | { kind: "error"; text: string }

/** Where one write lands: the namespace, the revision fence, and that namespace's stored route table. */
export interface RouteTarget {
  /** The settings namespace the ops address. */
  readonly namespace: string
  /** The expected-revision fence the host compares, when the namespace exposes one. */
  readonly revision: number | undefined
  /** The namespace's stored `agentRoutes` table (empty when it carries none), read for key spellings. */
  readonly table: Record<string, unknown>
}

/** The host's time budget for one panel; a dialog that is never answered must not hang the command. */
const PANEL_TIMEOUT_MS = 120_000

/** The command's own copy, in both languages (the dialog titles and every option label are ours). */
const MENU_TEXT = {
  titleGroup: { zh: "MPD 模型分组", en: "MPD model group" },
  titleScope: { zh: "MPD 编辑范围", en: "MPD edit scope" },
  titleAction: { zh: "MPD 路由操作", en: "MPD route action" },
  titleProvider: { zh: "MPD 提供商 · {target}", en: "MPD provider · {target}" },
  titleModel: { zh: "MPD 模型 · {target}", en: "MPD model · {target}" },
  titleEffort: { zh: "MPD 推理强度 · {target}", en: "MPD reasoning effort · {target}" },
  titleConfirm: { zh: "把同一路由写入 {group} 的 {n} 个代理？", en: "write the same route to {n} agents in {group}?" },
  // THE GROUP LINE, contract §6.1: its members, then a compact current summary — the configured
  // count plus the DISTINCT routes, and the contract's own token when no member has one.
  groupMembers: { zh: "成员：{members}", en: "members: {members}" },
  groupCount: { zh: "已配置 {configured}/{total}", en: "{configured}/{total} configured" },
  groupRoutes: { zh: "当前：{routes}", en: "current: {routes}" },
  groupRoutesMore: { zh: "（另有 {n} 条不同路由）", en: " (+{n} more distinct)" },
  // The typed states of ONE agent, at the point of choice (see-before-you-edit).
  routeCurrent: { zh: "当前：{route}", en: "current: {route}" },
  routeFallbacks: { zh: "（另有 {n} 个回退）", en: " (+{n} fallbacks)" },
  routeUnconfigured: { zh: "当前：<unconfigured>", en: "current: <unconfigured>" },
  routeInvalid: { zh: "当前：<invalid>", en: "current: <invalid>" },
  routeUnavailable: { zh: "当前：<unavailable>", en: "current: <unavailable>" },
  unconfiguredToken: { zh: "<unconfigured>", en: "<unconfigured>" },
  // THE SCOPE PANEL, contract §6.2: the bulk edit or ONE agent — nothing else.
  scopeGroup: { zh: "整组（{n} 个代理）", en: "whole group ({n} agents)" },
  scopeGroupHint: {
    zh: "把同一路由写入全部 {n} 个代理；写入前会列出每个代理的当前路由并请求确认",
    en: "write the SAME route to all {n} agents — every current route is listed and confirmed before anything is written",
  },
  // THE CLEAR BRANCH, contract §6.7 — it states what a clear COSTS, not merely that it deletes.
  actionSet: { zh: "设置一条新路由", en: "set a new route" },
  actionSetHint: { zh: "接下来选择提供商、模型与推理强度", en: "choose a provider, a model and a reasoning effort next" },
  actionClear: { zh: "清除该代理的路由（移除 {key}）", en: "clear this agent's route (removes {key})" },
  actionClearHint: {
    // The failure is named by its CONSEQUENCE, not by a hand-copied error constant: the code and the
    // refusal sentence are `mpd-config-plugin`'s to state (`AGENT_UNCONFIGURED_CODE` /
    // `agentUnconfiguredMessage`), and this panel renders neither — it only has to make the cost clear.
    zh: "移除 {key} —— 之后该代理的每次派生都会被拒绝，直到重新配置",
    en: "removes {key} — every spawn of this agent is then REFUSED until it is configured again",
  },
  // THE CONFIRMATION PANEL, contract §6.6: what a group write DOES, then every affected agent with
  // its current effective route.
  confirmHead: {
    zh: "整组写入会用同一路由覆盖下列代理；下面列出的是覆盖前的当前生效路由。",
    en: "a whole-group write OVERWRITES the agents below with the same route; the routes listed are what is there NOW.",
  },
  confirmLine: { zh: "{agent}：{state}", en: "{agent}: {state}" },
  providerHint: { zh: "该代理的提供商；模型列表来自它", en: "this agent's provider; the model list comes from it" },
  modelHint: { zh: "该代理的模型", en: "this agent's model" },
  effortHint: { zh: "该代理的推理强度", en: "this agent's reasoning effort" },
  sealedByDialogs: {
    zh: "mpd-model: 该组合没有对话框接缝（无界面嵌入），未打开菜单，也未写入任何设置",
    en: "mpd-model: this composition has no dialogs seam (a headless embedder) — no menu was opened and nothing was written",
  },
  sealedByCancelGroup: { zh: "mpd-model: 已取消分组选择，未写入任何设置", en: "mpd-model: the group panel was cancelled — nothing was written" },
  sealedByCancelScope: { zh: "mpd-model: 已取消范围选择，未写入任何设置", en: "mpd-model: the scope panel was cancelled — nothing was written" },
  sealedByCancelAction: { zh: "mpd-model: 已取消操作选择，未写入任何设置", en: "mpd-model: the action panel was cancelled — nothing was written" },
  sealedByCancelProvider: { zh: "mpd-model: 已取消提供商选择，未写入任何设置", en: "mpd-model: the provider panel was cancelled — nothing was written" },
  sealedByCancelModel: { zh: "mpd-model: 已取消模型选择，未写入任何设置", en: "mpd-model: the model panel was cancelled — nothing was written" },
  sealedByCancelEffort: { zh: "mpd-model: 已取消推理强度选择，未写入任何设置", en: "mpd-model: the reasoning-effort panel was cancelled — nothing was written" },
  sealedByCancelConfirm: { zh: "mpd-model: 未确认整组写入，未写入任何设置", en: "mpd-model: the group write was not confirmed — nothing was written" },
  sealedByNoNamespace: {
    zh: "mpd-model: 该组合没有可写的设置接缝，未写入任何设置",
    en: "mpd-model: this composition exposes no settings write seam — nothing was written",
  },
  sealedByRefused: { zh: "mpd-model: 设置写入被拒绝（{error}）", en: "mpd-model: the settings write was refused ({error})" },
  sealedByNoGroup: { zh: "mpd-model: 未知分组“{group}”，未写入任何设置", en: "mpd-model: unknown group \"{group}\" — nothing was written" },
  sealedByNoAgent: { zh: "mpd-model: 未知代理“{agent}”，未写入任何设置", en: "mpd-model: unknown agent \"{agent}\" — nothing was written" },
  sealedByUnknownAction: { zh: "mpd-model: 未知操作“{action}”，未写入任何设置", en: "mpd-model: unknown action \"{action}\" — nothing was written" },
  catalogFallback: {
    zh: "实时模型目录不可用（{why}）——面板列出的是内置回退清单，不是实时目录",
    en: "the live model catalog is unavailable ({why}) — the panels list the declared fallback, not the live catalog",
  },
  catalogDegraded: { zh: "模型目录读取不完整", en: "the catalog read was incomplete" },
  catalogAbsent: { zh: "该组合没有 llmCatalog 接缝", en: "this composition exposes no llmCatalog seam" },
  catalogThrew: { zh: "读取抛错：{error}", en: "the read threw: {error}" },
  wroteAgent: {
    zh: "mpd-model: 代理 {agent} 已设置 提供商 {provider} · 模型 {model} · 推理强度 {effort}；{disclosure}。{notLost}",
    en: "mpd-model: agent {agent} set to provider {provider} · model {model} · reasoning effort {effort}; {disclosure}. {notLost}",
  },
  wroteGroup: {
    zh: "mpd-model: 分组 {group} 的 {n} 个代理已设置同一路由（{leaves} 个叶子写入各自 agentRoutes 条目）：提供商 {provider} · 模型 {model} · 推理强度 {effort}；{disclosure}。{notLost}",
    en: "mpd-model: group {group} — {n} agents set to the same route ({leaves} leaves under each agent's own agentRoutes entry): provider {provider} · model {model} · reasoning effort {effort}; {disclosure}. {notLost}",
  },
  cleared: {
    zh: "mpd-model: 代理 {agent} 的路由已清除（移除 {key}）—— 该代理的派生将被拒绝，直到重新配置；{disclosure}。{notLost}",
    en: "mpd-model: agent {agent} cleared (removed {key}) — spawns for this agent will be REFUSED until it is configured again; {disclosure}. {notLost}",
  },
} as const satisfies Record<string, Bilingual>

/**
 * Substitute the `{name}` placeholders of one localized sentence.
 * @param text - the sentence in the chosen language.
 * @param params - the values to substitute.
 * @returns the sentence with every named placeholder replaced.
 */
function fill(text: string, params: Readonly<Record<string, string>>): string {
  /** The sentence, mutated once per placeholder. */
  let out = text
  for (const [name, value] of Object.entries(params)) out = out.split(`{${name}}`).join(value)
  return out
}

/**
 * Localize one menu sentence and fill its placeholders.
 * @param key - the entry id in {@link MENU_TEXT}.
 * @param lang - the language, already resolved for this invocation.
 * @param params - the placeholder values.
 * @returns the sentence to render.
 */
function say(key: keyof typeof MENU_TEXT, lang: TuiLang, params: Readonly<Record<string, string>> = {}): string {
  return fill(pick(MENU_TEXT[key], lang), params)
}

/** The label the summaries use; clamped so one long id cannot push a sentence past the budget. */
function short(value: string): string {
  return scalarText(value, 60) ?? value
}

/**
 * The current-route sentence of one agent, for a panel's description or a confirmation line.
 *
 * THE TOKENS ARE THE CONTRACT'S OWN: an agent whose route the config service reports as
 * `unconfigured` shows the literal `<unconfigured>`, so the reader can tell "nothing is configured"
 * from "the read failed" (`<unavailable>`) and from a real route. Nothing here throws: the typed union
 * is the service's answer, and an absent method is its own state.
 * @param lang - the language to render the sentence in.
 * @param display - the typed agent-route answer (see `settings.ts#agentRouteDisplay`).
 * @returns the sentence a panel description or a confirmation line carries.
 */
export function agentRouteText(lang: TuiLang, display: AgentRouteDisplay): string {
  if (display.state === "ok") {
    return say("routeCurrent", lang, { route: display.route }) + (display.fallbacks > 0 ? say("routeFallbacks", lang, { n: String(display.fallbacks) }) : "")
  }
  if (display.state === "unconfigured") return pick(MENU_TEXT.routeUnconfigured, lang)
  if (display.state === "invalid") return pick(MENU_TEXT.routeInvalid, lang)
  return pick(MENU_TEXT.routeUnavailable, lang)
}

/**
 * The compact current summary of one group, for its option's description.
 *
 * Contract §6.1: the CONFIGURED COUNT plus the DISTINCT routes, and the literal `<unconfigured>` when
 * no member has one — the same token the per-agent sentences use, so the two cannot disagree about
 * what "nothing configured" looks like. The route list is CAPPED with an explicit `+N` marker rather
 * than silently truncated.
 * @param lang - the language to render in.
 * @param members - the group's members, in the group's own order.
 * @param displays - one typed answer per agent; omitted by an arm that only wants the member list.
 * @returns the summary sentence, empty when no typed answers were supplied.
 */
function groupSummary(lang: TuiLang, members: readonly string[], displays: Readonly<Record<string, AgentRouteDisplay>> | undefined): string {
  if (displays === undefined) return ""
  /** The members whose route resolves right now. */
  const configured = members.filter((member) => displays[member]?.state === "ok").length
  /** The DISTINCT route sentences, in the group's own order. */
  const routes: string[] = []
  for (const member of members) {
    /** This member's typed answer. */
    const display = displays[member]
    if (display === undefined || display.state !== "ok") continue
    if (!routes.includes(display.route)) routes.push(display.route)
  }
  /** The count half of the sentence. */
  const count = say("groupCount", lang, { configured: String(configured), total: String(members.length) })
  /** The routes half, or the contract's token when no member has a usable route. */
  const routeText = routes.length === 0
    ? say("groupRoutes", lang, { routes: pick(MENU_TEXT.unconfiguredToken, lang) })
    : say("groupRoutes", lang, {
      routes: routes.slice(0, MAX_GROUP_ROUTES).join(" · ") + (routes.length > MAX_GROUP_ROUTES ? say("groupRoutesMore", lang, { n: String(routes.length - MAX_GROUP_ROUTES) }) : ""),
    })
  return `${count} · ${routeText}`
}

/**
 * The group panel's options: one per group, labelled with the group name and described with its
 * members plus their current summary.
 *
 * The group names and member lists come from the shared schema (`TEAM_MODEL_SLOT_GROUPS`), which is the
 * same declaration the `/settings` row labels are built from, so the panel and the rows cannot name a
 * group's members differently.
 * @param lang - the language to render the labels in.
 * @param displays - the typed answers, keyed by agent; omitted by an arm that only wants labels.
 * @returns four options, the first group first.
 */
export function groupPanelOptions(
  lang: TuiLang,
  displays?: Readonly<Record<string, AgentRouteDisplay>>,
): { id: string; label: string; description: string }[] {
  return TEAM_MODEL_SLOTS.map((slot, index) => {
    /** The group's human identity, shared with the settings schema. */
    const group = TEAM_MODEL_SLOT_GROUPS[slot]
    /** The members sentence every option leads with. */
    const membersText = say("groupMembers", lang, { members: teamModelMembers(slot, lang) })
    /** This group's current summary, empty for a label-only call. */
    const summary = groupSummary(lang, group.members, displays)
    return {
      id: slot,
      label: `${index + 1}. ${lang === "en" ? group.en : group.zh}`,
      description: summary === "" ? membersText : `${membersText} · ${summary}`,
    }
  })
}

/**
 * The scope panel's options: the bulk edit first, then one option per member of the picked group.
 *
 * Contract §6.2 — the scope is EITHER the whole group OR exactly one agent, and nothing else: an
 * agent outside the picked group is unrepresentable here, so a group write can never silently widen.
 * @param lang - the language to render the labels in.
 * @param slot - the group the user picked.
 * @param displays - the typed answers, keyed by agent; omitted by an arm that only wants labels.
 * @returns the whole-group option followed by one option per member.
 */
export function scopePanelOptions(
  lang: TuiLang,
  slot: (typeof TEAM_MODEL_SLOTS)[number],
  displays?: Readonly<Record<string, AgentRouteDisplay>>,
): { id: string; label: string; description?: string }[] {
  /** The picked group's members, in the group's own order. */
  const members = TEAM_MODEL_SLOT_GROUPS[slot].members
  /** The bulk-edit option; its description states that a confirmation follows. */
  const out: { id: string; label: string; description?: string }[] = [{
    id: GROUP_SCOPE_ID,
    label: say("scopeGroup", lang, { n: String(members.length) }),
    description: say("scopeGroupHint", lang, { n: String(members.length) }),
  }]
  for (const member of members) {
    /** This member's typed answer, when the caller could read one. */
    const display = displays?.[member]
    out.push({ id: member, label: member, description: display === undefined ? undefined : agentRouteText(lang, display) })
  }
  return out
}

/**
 * The action panel's options for ONE agent: set a new route, or clear the entry it already has.
 *
 * Contract §6.7: the clear branch is offered only for a single agent that HAS an entry, and its own
 * description states the CONSEQUENCE — every later spawn of that agent is refused until it is
 * configured again — instead of promising a harmless delete.
 * @param lang - the language to render the labels in.
 * @param member - the agent whose entry the panel acts on.
 * @returns the set option first, then the clear option.
 */
export function actionPanelOptions(lang: TuiLang, member: string): { id: string; label: string; description: string }[] {
  /** The dotted entry the clear branch removes. */
  const key = `${AGENT_ROUTES_PREFIX}.${member}`
  return [
    { id: ACTION_SET, label: say("actionSet", lang), description: say("actionSetHint", lang) },
    { id: ACTION_CLEAR, label: say("actionClear", lang, { key }), description: say("actionClearHint", lang, { key }) },
  ]
}

/**
 * The confirmation panel's message: what a group write does, then every affected agent's CURRENT route.
 *
 * Contract §6.6 — the listing is the point: a reader sees exactly whom the write overwrites and what
 * each of them runs on now (`<unconfigured>` where nothing is configured, `<invalid>`/`<unavailable>`
 * where the entry cannot be used), before committing to it. The message is one line per agent, so a
 * long group stays readable.
 * @param lang - the language to render in.
 * @param members - every agent the write would overwrite, in the group's order.
 * @param displays - the typed answers, keyed by agent.
 * @returns the multi-line message the host's confirm dialog shows.
 */
export function confirmationLines(lang: TuiLang, members: readonly string[], displays: Readonly<Record<string, AgentRouteDisplay>>): string {
  /** The heading sentence: the write OVERWRITES, and the routes below are the current ones. */
  const head = pick(MENU_TEXT.confirmHead, lang)
  /** One line per affected agent, naming the agent and its current effective route. */
  const lines = members.map((member) => {
    /** This agent's typed answer; an unread one degrades to `<unavailable>`, never to a blank. */
    const display = displays[member] ?? { state: "unavailable" as const }
    return say("confirmLine", lang, { agent: member, state: agentRouteText(lang, display) })
  })
  return [head, ...lines].join("\n")
}

/**
 * Project the catalog into the three leaf panels' option lists.
 *
 * The provider list is the section's own ({@link teamModelOptionLists}); the model and effort
 * lists are narrowed to the chosen provider/model WHEN THE CATALOG IS KEYED, and fall back to the
 * union the section registers otherwise. Neither list can come back EMPTY: the panel that would
 * have no option on a keyed catalog (a provider with no models, a model with no efforts) uses the
 * union, which is exactly the list the `/settings` row offers for the same leaf.
 * @param lists - the section's option projection.
 * @param provider - the chosen provider id, when one was picked.
 * @param model - the chosen model id, when one was picked.
 * @param catalog - the raw catalog, read for the per-provider/per-model narrowing.
 * @returns the three option lists the panels render; the group and scope panels carry no catalog row.
 */
export function panelOptions(
  lists: TeamModelOptionLists,
  provider: string | undefined,
  model: string | undefined,
  catalog: unknown,
): { provider: SettingsOption[]; model: SettingsOption[]; reasoningEffort: SettingsOption[] } {
  /** The catalog's providers array, validated before it is walked. */
  const providers = isRecord(catalog) && Array.isArray(catalog.providers) ? catalog.providers : []
  /** The chosen provider's catalog row, when the catalog is keyed and knows this id. */
  const providerRow = provider === undefined ? undefined : providers.find((entry) => isRecord(entry) && entry.id === provider)
  /** The models the chosen provider offers, when the catalog is keyed. */
  const keyedModels: SettingsOption[] = []
  if (isRecord(providerRow) && Array.isArray(providerRow.models)) {
    for (const entry of providerRow.models) {
      if (isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0) {
        keyedModels.push({ value: entry.id, label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id })
      }
    }
  }
  /** The chosen model's catalog row, when the catalog is keyed and knows this id. */
  const modelRow = model === undefined ? undefined : findModel(providers, model)
  /** The efforts the chosen model offers, when the catalog is keyed. */
  const keyedEfforts: SettingsOption[] = []
  if (isRecord(modelRow) && Array.isArray(modelRow.efforts)) {
    for (const entry of modelRow.efforts) {
      if (isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0) {
        // The catalog's own name when it has one, else MPD's localized name for the id, else the id.
        keyedEfforts.push({ value: entry.id, label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : effortLabel(entry.id) })
      }
    }
  }
  return {
    provider: lists.provider,
    // NEVER empty: a keyed provider with no models falls back to the same union the row offers.
    model: keyedModels.length > 0 ? keyedModels : lists.model,
    // The DECLARED fallback keeps the labels the settings schema gives it. Relabelling it here was
    // REVERTED after measurement (2026-10-06): it made a path language-dependent whose arms are
    // deliberately language-neutral, one more arm failed under `DSH_TUI_LANG=zh` than it fixed, and the
    // fallback's own list is the one a reader checks against the settings rows — so it must show what
    // those rows show. The localization this feature needs lives on the catalog path above, where the
    // ids are the catalog's own and only the LABEL is MPD's.
    reasoningEffort: keyedEfforts.length > 0 ? keyedEfforts : lists.reasoningEffort,
  }
}

/**
 * Find one model's catalog row across every provider.
 * @param providers - the catalog's provider rows.
 * @param model - the model id to find.
 * @returns the first matching row, or undefined when the catalog does not key it.
 */
function findModel(providers: readonly unknown[], model: string): unknown {
  for (const provider of providers) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue
    for (const entry of provider.models) {
      if (isRecord(entry) && entry.id === model) return entry
    }
  }
  return undefined
}

/** Whether a value is a non-null object, so a half-built catalog row never throws below. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * The `agentRoutes` table of one settings value, looked for at the root and under the two
 * host-document halves.
 * @param value - a namespace's resolved value.
 * @returns the stored route table, or an empty object when this value carries none.
 */
export function routeTableOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  for (const candidate of [value, value.user, value.value]) {
    if (!isRecord(candidate)) continue
    /** That candidate's `agentRoutes` block, when it is a table. */
    const routes = candidate[AGENT_ROUTES_PREFIX]
    if (isRecord(routes)) return routes
  }
  return {}
}

/**
 * The key an agent's entry is stored UNDER in one route table.
 *
 * A hand-written file may spell the name differently (`deep worker`, `SeniorEngineer`), and the roster
 * lookup is case- and separator-insensitive (contract §1), so the EXISTING spelling is resolved through
 * the shared normalizer: a write updates the entry the resolver reads instead of adding a second copy
 * nothing reads.
 * @param table - the namespace's stored route table.
 * @param member - the canonical roster name the panel picked.
 * @returns the document's own key when it carries one, else the canonical name.
 */
export function routeKeyFor(table: Record<string, unknown>, member: string): string {
  /** The member's normalized comparison key. */
  const key = agentNameKey(member)
  if (key === "") return member
  for (const candidate of Object.keys(table)) {
    if (agentNameKey(candidate) === key) return candidate
  }
  return member
}

/**
 * Read the route leaves already stored for one agent.
 * @param value - a namespace's resolved value.
 * @param member - the agent whose entry is read.
 * @returns the stored triple, with only the keys the entry actually carries.
 */
export function storedAgentRoute(value: unknown, member: string): Partial<Record<TeamModelLeaf, string>> {
  /** The namespace's stored route table. */
  const table = routeTableOf(value)
  /** The entry under this agent's own key spelling. */
  const entry = table[routeKeyFor(table, member)]
  /** The three leaf values, each kept only when it is a usable string. */
  const out: Partial<Record<TeamModelLeaf, string>> = {}
  if (!isRecord(entry)) return out
  for (const leaf of ROUTE_LEAVES) {
    /** The stored leaf value, when this entry carries one. */
    const found = entry[leaf]
    if (typeof found === "string" && found.length > 0) out[leaf] = found
  }
  return out
}

/**
 * Whether either served namespace already carries an entry for one agent.
 *
 * THE CLEAR BRANCH HANGS OFF THIS (contract §6.7): clearing an agent that has no entry would write an
 * op that changes nothing and would tell the user an entry was removed. The probe reads the RAW
 * document, because the typed answer cannot tell "no entry" from "an entry that is unconfigured" —
 * both resolve `unconfigured` by design.
 * @param adapter - the catalog/settings seam.
 * @param member - the agent whose entry is probed.
 * @returns true when a served namespace stores an entry for this agent.
 */
export function hasStoredRoute(adapter: CatalogReadSeam, member: string): boolean {
  /** The member's normalized comparison key. */
  const key = agentNameKey(member)
  if (key === "") return false
  for (const namespace of [SETTINGS_ENTRY, MODEL_NAMESPACE]) {
    /** This namespace's read surface, absent when the settings provider is not composed. */
    const reader = adapter.settingsReader?.(namespace)
    if (reader === undefined) continue
    /** This namespace's resolved value; an unreadable one is simply not an entry. */
    let value: unknown
    try {
      value = reader.get()
    } catch {
      continue
    }
    if (Object.keys(routeTableOf(value)).some((candidate) => agentNameKey(candidate) === key)) return true
  }
  return false
}

/**
 * Read every agent's stored leaves from whichever namespace serves them.
 * @param adapter - the catalog/settings seam.
 * @returns one partial triple per roster agent; an empty object per agent when nothing is stored yet.
 */
export function readStoredRoutes(adapter: CatalogReadSeam): Record<string, Partial<Record<TeamModelLeaf, string>>> {
  /** The first namespace value that carries an `agentRoutes` table, the entry one first. */
  let value: unknown
  for (const namespace of [SETTINGS_ENTRY, MODEL_NAMESPACE]) {
    /** This namespace's read surface, absent when the settings provider is not composed. */
    const reader = adapter.settingsReader?.(namespace)
    if (reader === undefined) continue
    try {
      value = reader.get()
    } catch {
      value = undefined
    }
    if (Object.keys(routeTableOf(value)).length > 0) break
  }
  /** Each agent's stored triple. */
  const out: Record<string, Partial<Record<TeamModelLeaf, string>>> = {}
  for (const member of AGENT_ROUTE_MEMBERS) out[member] = storedAgentRoute(value, member)
  return out
}

/**
 * Which namespace a route write targets: the one that already stores this agent's entry, else the ENTRY.
 *
 * MEASURED on the installed harness, and the reason the fallback is `SETTINGS_ENTRY` and not
 * `MODEL_NAMESPACE`: the host resolves a mutate key against its own DESCRIPTOR LIST, which is keyed by
 * profile ENTRY id — `const descriptor = this.describe().find((row) => row.ns === ns)` and it throws
 * `Plugin entry "<ns>" is no longer configurable` when no row matches (`dsh-settings/lib/index.js`).
 * `"mpd"` is a namespace this bundle REGISTERS, never a profile entry, so a write addressed to it can
 * only ever be refused. `"mpd-config"` IS the entry (the loader gives the row `options.id = "mpd-config"`,
 * which is what both front doors read values through).
 *
 * The probe is still a read, so it can run safely before the user has confirmed anything, and an entry
 * already stored under the other name keeps winning — that is a fact about where the value LIVES, not a
 * preference. The returned table lets the caller keep the document's OWN key spelling
 * ({@link routeKeyFor}) instead of adding a second copy nothing reads.
 * @param adapter - the catalog/settings seam.
 * @param member - the roster agent whose existing entry decides the namespace.
 * @returns the namespace, the revision an expected-revision fence should use, and that namespace's
 *   stored `agentRoutes` table (empty when it carries none).
 */
export function locateNamespace(adapter: CatalogReadSeam, member: string): RouteTarget {
  /** The member's normalized comparison key; an empty key matches no entry and picks the ENTRY. */
  const key = agentNameKey(member)
  /** The revision read from whichever namespace answered last, so the fence reflects the document. */
  let revision: number | undefined
  // The ENTRY is probed first: it is the only key the host can mutate, so a tie resolves toward it.
  for (const namespace of [SETTINGS_ENTRY, MODEL_NAMESPACE]) {
    /** This namespace's read surface, absent when the settings provider is not composed. */
    const reader = adapter.settingsReader?.(namespace)
    if (reader === undefined) continue
    // The revision is taken from EITHER namespace, whichever answers last, so the fence reflects the
    // document's current revision even when the namespace is picked by the loop's end.
    try {
      revision = reader.describe()?.revision
    } catch {
      // An unreadable descriptor costs the fence, not the write.
    }
    /** This namespace's resolved value; an unreadable one simply carries no entry. */
    let value: unknown
    try {
      value = reader.get()
    } catch {
      continue
    }
    /** That value's stored route table, looked for at the root and under the two document halves. */
    const table = routeTableOf(value)
    // An entry already stored somewhere WINS wherever it is: writing the other name instead would
    // persist a value no reader resolves.
    if (key !== "" && Object.keys(table).some((candidate) => agentNameKey(candidate) === key)) return { namespace, revision, table }
  }
  return { namespace: SETTINGS_ENTRY, revision, table: {} }
}

/**
 * The write target of a GROUP edit: the namespace that already stores ANY member of the group.
 *
 * A group write is one `settingsMutate` call, so it must land in ONE namespace — but the members' own
 * entries may all be absent, or one of them may already live under the legacy name. Probing member by
 * member keeps the same rule the single-agent path uses (a stored entry decides, otherwise the ENTRY),
 * while making sure a group whose FIRST member is unconfigured does not lose the namespace a later
 * member is stored in.
 * @param adapter - the catalog/settings seam.
 * @param members - every agent the group write would overwrite, in the group's order.
 * @returns the target of the first member with a stored entry, else the first member's own fallback.
 */
function routeTargetForGroup(adapter: CatalogReadSeam, members: readonly string[]): RouteTarget {
  // PASS 1 — the ENTRY namespace across EVERY member: it is the only key the host can mutate, so a
  // group whose first member is unconfigured (or stored only under the legacy name) must not drag the
  // write onto a namespace where a later member's real entry would become a dead duplicate.
  for (const member of members) {
    /** This member's target; its table is empty when no namespace stores the agent. */
    const located = locateNamespace(adapter, member)
    if (located.namespace === SETTINGS_ENTRY && Object.keys(located.table).length > 0) return located
  }
  // PASS 2 — the legacy namespace, for a group whose entries exist only there. A group with NO stored
  // entry anywhere falls through to the first member's own target (the ENTRY, with an empty table).
  for (const member of members) {
    /** This member's target; only a legacy-stored member can still answer with a non-empty table. */
    const located = locateNamespace(adapter, member)
    if (Object.keys(located.table).length > 0) return located
  }
  return locateNamespace(adapter, members[0] ?? "")
}

/**
 * Open the pick-list chain and write the chosen route.
 *
 * One invocation, one write (or, for a whole-group edit, one write carrying every affected agent's own
 * entry). The chain is straight-line: each panel settles an option id (Enter), and `undefined`
 * (Esc / Ctrl+C / timeout) returns with a sentence that names the cancelled panel and writes nothing —
 * the confirmation panel's "not confirmed" included.
 *
 * Contract §6 order: group → scope (whole group / one agent) → [action, for a single configured agent]
 * → provider → model → reasoning effort → [confirmation, required for a whole-group write] → write.
 * The clear branch detours before the provider chain (it has nothing to pick), and the action panel is
 * offered only for an agent that HAS an entry — with no entry, "set a route" is the only meaningful act.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param options - the injectable seams; a test supplies its own dialogs, adapter and config service.
 * @returns the command result the harness renders.
 */
export async function openModelMenu(tui: TuiAdapter, log: Log, options: ModelMenuOptions = {}): Promise<ModelMenuResult> {
  /** The language for THIS invocation: resolved at use, never cached (see `i18n.ts`). */
  const lang = resolveLang(options.langInputs)
  /** The dialog seam: the command's own wrapper unless a caller supplied one. */
  const dialogs = options.dialogs ?? createDialogs(tui, log)
  if (!dialogs.available()) return { kind: "error", text: say("sealedByDialogs", lang) }

  // ── the live catalog, through the SAME reader the section uses ─────────────
  /** The catalog/settings seam; the section's own resolution when the caller named none. */
  const adapter = options.adapter ?? resolveCatalogReader(options.ctx as never)
  /** The catalog read result: the value when it landed, plus why it did not. */
  let catalog: { degraded?: boolean; providers?: unknown } | undefined
  /** Why the catalog is not the live one; undefined when it is. */
  let catalogWhy: string | undefined
  if (typeof adapter.llmCatalog !== "function") {
    catalogWhy = say("catalogAbsent", lang)
  } else {
    try {
      catalog = (await adapter.llmCatalog()) as { degraded?: boolean; providers?: unknown }
      if (catalog === undefined || catalog === null) catalogWhy = say("catalogAbsent", lang)
      else if (catalog.degraded === true) catalogWhy = say("catalogDegraded", lang)
    } catch (error) {
      catalogWhy = say("catalogThrew", lang, { error: String((error as Error)?.message ?? error) })
    }
  }
  /** The section's own projection of that catalog, so the panels and the rows agree. */
  const lists = teamModelOptionLists(catalog as never)
  log.info(`/${MODEL_COMMAND} catalog=${catalogWhy === undefined ? "live" : "fallback"}`
    + ` provider=${lists.source.provider}(${lists.provider.length}) model=${lists.source.model}(${lists.model.length})`
    + ` reasoningEffort=${lists.source.reasoningEffort}(${lists.reasoningEffort.length})`)

  /** The config service slice the panels' route sentences read; a test may inject its own. */
  const service = options.configService ?? configServiceOf(options.ctx as PluginContextLike)
  /** One typed answer per roster agent, read before the first panel so its descriptions are current. */
  const displays: Record<string, AgentRouteDisplay> = {}
  for (const member of AGENT_ROUTE_MEMBERS) displays[member] = agentRouteDisplay(service, member)

  // ── panel 1: the group, labelled with its members and their current summary ──
  /** The picked group id; undefined means the chain was cancelled here. */
  const slot = await dialogs.select(say("titleGroup", lang), groupPanelOptions(lang, displays), PANEL_TIMEOUT_MS)
  if (slot === undefined) return { kind: "error", text: say("sealedByCancelGroup", lang) }
  if (!(TEAM_MODEL_SLOTS as readonly string[]).includes(slot)) return { kind: "error", text: say("sealedByNoGroup", lang, { group: short(slot) }) }
  /** The picked group, as the shared declaration spells it. */
  const slotId = slot as (typeof TEAM_MODEL_SLOTS)[number]
  /** The picked group's declaration: its member list and its bilingual name. */
  const group = TEAM_MODEL_SLOT_GROUPS[slotId]
  /** The group's name in the resolved language, for the panel titles and the outcome sentence. */
  const groupName = lang === "en" ? group.en : group.zh

  // ── panel 2: the scope — the bulk edit, or exactly one agent of this group ──
  /** The picked scope id; undefined means the chain was cancelled here. */
  const scope = await dialogs.select(say("titleScope", lang), scopePanelOptions(lang, slotId, displays), PANEL_TIMEOUT_MS)
  if (scope === undefined) return { kind: "error", text: say("sealedByCancelScope", lang) }
  /** Whether the user picked the whole group (the bulk edit) rather than one agent. */
  const wholeGroup = scope === GROUP_SCOPE_ID
  /** The single agent the edit targets; undefined for a whole-group edit. */
  let member: string | undefined
  if (!wholeGroup) {
    member = group.members.find((candidate) => candidate === scope)
    // A panel answer outside the group the user picked is refused rather than widened into a write.
    if (member === undefined) return { kind: "error", text: say("sealedByNoAgent", lang, { agent: short(scope) }) }
  }

  // ── the action panel: only for ONE agent that already has an entry (the clear branch) ──
  /** What the single-agent edit does; a whole-group edit can only set. */
  let action: typeof ACTION_SET | typeof ACTION_CLEAR = ACTION_SET
  if (member !== undefined && hasStoredRoute(adapter, member)) {
    /** The picked action id; undefined means the chain was cancelled here. */
    const picked = await dialogs.select(say("titleAction", lang), actionPanelOptions(lang, member), PANEL_TIMEOUT_MS)
    if (picked === undefined) return { kind: "error", text: say("sealedByCancelAction", lang) }
    if (picked !== ACTION_SET && picked !== ACTION_CLEAR) return { kind: "error", text: say("sealedByUnknownAction", lang, { action: short(picked) }) }
    action = picked
  }

  /** What the outcome sentence says about the catalog the user picked from; empty for a live read. */
  const fallback = catalogWhy === undefined ? "" : ` · ${say("catalogFallback", lang, { why: catalogWhy })}`

  // ── the clear branch: ONE `unset` op, in the namespace the entry already lives in ──
  if (action === ACTION_CLEAR && member !== undefined) {
    /** WHERE the removal goes and the revision the fence uses (the legacy-aware namespace probe). */
    const clearTarget = locateNamespace(adapter, member)
    if (typeof adapter.settingsMutate !== "function") return { kind: "error", text: say("sealedByNoNamespace", lang) }
    /** The key this agent's entry is stored under, so the removal deletes the copy a reader resolves. */
    const clearKey = routeKeyFor(clearTarget.table, member)
    /** The single removal: the WHOLE entry, not one leaf, because the clear branch removes a route. */
    const cleared = await adapter.settingsMutate(clearTarget.namespace, [{ op: "unset", path: [AGENT_ROUTES_PREFIX, clearKey] }], clearTarget.revision)
    if (!cleared.ok) return { kind: "error", text: say("sealedByRefused", lang, { error: short(cleared.error) }) }
    log.info(`/${MODEL_COMMAND} cleared ${clearTarget.namespace}.${AGENT_ROUTES_PREFIX}.${clearKey}`)
    return {
      kind: "success",
      text: `${say("cleared", lang, {
        agent: member,
        key: `${AGENT_ROUTES_PREFIX}.${clearKey}`,
        disclosure: BRIDGE_DISCLOSURE,
        notLost: BRIDGE_NOT_LOST,
      })}${fallback}`,
    }
  }

  // ── panels 3-5: provider → model → effort, titled with WHOM they edit ─────
  /** The agent (or group) this edit writes, named on every leaf panel. */
  const targetName = wholeGroup ? groupName : member ?? ""
  /** The provider picked; undefined when the panel was cancelled. */
  const provider = await dialogs.select(
    say("titleProvider", lang, { target: short(targetName) }),
    lists.provider.map((option) => ({ id: option.value, label: option.label, description: say("providerHint", lang) })),
    PANEL_TIMEOUT_MS,
  )
  if (provider === undefined) return { kind: "error", text: say("sealedByCancelProvider", lang) }

  // ── panel 4: the model — that provider's models, else the union, NEVER empty ──
  /** The model options this provider offers (or the union when the catalog cannot narrow). */
  const models = panelOptions(lists, provider, undefined, catalog).model
  /** The model picked; undefined when the panel was cancelled. */
  const model = await dialogs.select(
    say("titleModel", lang, { target: short(targetName) }),
    models.map((option) => ({ id: option.value, label: option.label, description: say("modelHint", lang) })),
    PANEL_TIMEOUT_MS,
  )
  if (model === undefined) return { kind: "error", text: say("sealedByCancelModel", lang) }

  // ── panel 5: the reasoning effort — the model's efforts, union fallback ────
  /** The effort options the chosen model offers (or the union when the catalog cannot narrow). */
  const efforts = panelOptions(lists, provider, model, catalog).reasoningEffort
  /** The effort picked; undefined when the panel was cancelled. */
  const effort = await dialogs.select(
    say("titleEffort", lang, { target: short(targetName) }),
    efforts.map((option) => ({ id: option.value, label: option.label, description: say("effortHint", lang) })),
    PANEL_TIMEOUT_MS,
  )
  if (effort === undefined) return { kind: "error", text: say("sealedByCancelEffort", lang) }

  /** Every agent this write overwrites: the group's members, or the one agent picked. */
  const agents = wholeGroup ? group.members : [member ?? ""]

  // ── the REQUIRED confirmation of a whole-group write (contract §6.6) ──────
  if (wholeGroup) {
    /** The host's yes/no answer; anything but a positive one writes nothing. */
    const confirmed = await dialogs.confirm(
      say("titleConfirm", lang, { group: groupName, n: String(agents.length) }),
      confirmationLines(lang, agents, displays),
    )
    if (confirmed !== true) return { kind: "error", text: say("sealedByCancelConfirm", lang) }
  }

  // ── the write: `agentRoutes.<Agent>.<leaf>` in the document the section edits ──
  if (typeof adapter.settingsMutate !== "function") return { kind: "error", text: say("sealedByNoNamespace", lang) }
  /** WHERE the write goes, the revision fence, and the key spellings the document already uses. */
  const target = wholeGroup ? routeTargetForGroup(adapter, agents) : locateNamespace(adapter, agents[0] ?? "")
  /** The ops one write carries — three leaves under EVERY affected agent's own entry. */
  const ops: { op: "set"; path: string[]; value: string }[] = []
  for (const agent of agents) {
    /** The key this agent's entry is stored under in the picked namespace. */
    const key = routeKeyFor(target.table, agent)
    for (const leaf of ROUTE_LEAVES) {
      ops.push({ op: "set", path: [AGENT_ROUTES_PREFIX, key, leaf], value: leaf === "provider" ? provider : leaf === "model" ? model : effort })
    }
  }
  /** The write result; never a throw (the adapter's contract). */
  const written = await adapter.settingsMutate(target.namespace, ops, target.revision)
  if (!written.ok) return { kind: "error", text: say("sealedByRefused", lang, { error: short(written.error) }) }
  log.info(wholeGroup
    ? `/${MODEL_COMMAND} wrote ${target.namespace}.${AGENT_ROUTES_PREFIX} (${String(agents.length)} agents, ${String(ops.length)} leaves) = ${provider}/${model}/${effort}`
    : `/${MODEL_COMMAND} wrote ${target.namespace}.${AGENT_ROUTES_PREFIX}.${agents[0] ?? ""} = ${provider}/${model}/${effort}`)

  // The disclosure is the SAME sentence the section carries (contract §4.6): the value IS saved, it is
  // LIVE (the agent's next spawn or resolve carries it), and it is never lost.
  return {
    kind: "success",
    text: overallSentence(lang, { wholeGroup, groupName, agents, provider, model, effort, disclosure: BRIDGE_DISCLOSURE, notLost: BRIDGE_NOT_LOST }) + fallback,
  }
}

/**
 * The outcome sentence of a successful route write, in the language the chain resolved.
 * @param lang - the language to render in.
 * @param write - what was written: the group name (or the single agent) and the three leaf values.
 * @returns the sentence the command registry renders.
 */
function overallSentence(
  lang: TuiLang,
  write: {
    /** Whether the write covered a whole group. */
    readonly wholeGroup: boolean
    /** The group's name, used only for a group write. */
    readonly groupName: string
    /** The agents the write covered, so a group write can count them. */
    readonly agents: readonly string[]
    /** The provider every written entry carries. */
    readonly provider: string
    /** The model every written entry carries. */
    readonly model: string
    /** The reasoning effort every written entry carries. */
    readonly effort: string
    /** The bridge disclosure, carried from `settings.ts` so the two surfaces cannot disagree. */
    readonly disclosure: string
    /** The not-lost clause, carried from `settings.ts` for the same reason. */
    readonly notLost: string
  },
): string {
  if (write.wholeGroup) {
    return say("wroteGroup", lang, {
      group: write.groupName,
      n: String(write.agents.length),
      leaves: String(ROUTE_LEAVES.length),
      provider: short(write.provider),
      model: short(write.model),
      effort: short(write.effort),
      disclosure: write.disclosure,
      notLost: write.notLost,
    })
  }
  return say("wroteAgent", lang, {
    agent: write.agents[0] ?? "",
    provider: short(write.provider),
    model: short(write.model),
    effort: short(write.effort),
    disclosure: write.disclosure,
    notLost: write.notLost,
  })
}