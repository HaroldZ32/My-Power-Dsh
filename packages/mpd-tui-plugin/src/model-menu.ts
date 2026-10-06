// `/mpd-model` — the SELECTION-STYLE model settings menu (R3).
//
// WHAT THE USER GETS: one command that opens a real host pick-list and walks the chain
// slot → provider → model → reasoning effort, then WRITES the picked route into the SAME
// `mpd-config` entry the `/settings` section edits. The seam is the package's own
// `dialogs.ts#createDialogs` wrapper over `TuiAdapter.dialogs()` — this file never names a
// `ctx.tui*` service (the `no-direct-tui-access` gate) and never writes to fd 1/2 (the
// `no-terminal-writes` gate).
//
// WHY A MENU WHEN THE SECTION ALREADY HAS THE ROWS: the host renders a `select` field by
// CYCLING a frozen option list and offers no pick-list dialog (measured; see `settings.ts`), so
// twelve slot leaves can only be cycled one value at a time. The menu is the same twelve writes
// with the choice made in one dialog per leaf.
//
// THE OPTION SOURCES ARE THE SECTION'S OWN (contract §4.1): the catalog is read through
// `settings.ts#resolveCatalogReader` → `tui.llmCatalog()`, and the option projection is the
// section's `teamModelOptionLists`, so the menu and the rows cannot disagree about what a
// provider, a model or an effort is. That matters because a value the panel offers but the
// schema rejects would fail team creation LATER, naming a member and a slot.
//
// DEGRADATION IS EXPLICIT (contract §4). Four things can stop the chain, and each ends it with
// ONE sentence naming WHICH happened:
//   • the dialogs seam is absent (a headless embedder) — nothing is shown and nothing is written;
//   • the live catalog is absent or DEGRADED — the panels still open over the declared fallback
//     options, and the outcome sentence says the list is not the live catalog;
//   • a panel was cancelled (`undefined`) — the chain stops there and NOTHING is written;
//   • the write was refused (no settings seam, or the host rejected the mutation) — the outcome
//     says refused, with the host's own error text.
//
// A CANCEL AT ANY PANEL WRITES NOTHING. That is not a convention here: the write is the last
// statement of a straight-line chain, and every early return above it happens before the ops are
// built.
import type { SeamOutcome, TuiAdapter, TuiSettingsFieldLike } from "./types.js"
import type { Log } from "./log.js"
import { scalarText } from "./sanitize.js"
import { createDialogs } from "./dialogs.js"
import type { DialogSeam } from "./dialogs.js"
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, resolveCatalogReader, teamModelOptionLists, SETTINGS_ENTRY } from "./settings.js"
import type { CatalogReadSeam, SettingsOption, TeamModelOptionLists, TeamModelLeaf } from "./settings.js"
import { TEAM_MODEL_SLOT_GROUPS, TEAM_MODEL_SLOTS } from "../../mpd-config-plugin/src/settings-schema"
import { MODEL_COMMAND, MODEL_COMMAND_DESCRIPTIONS, MODEL_COMMAND_DESCRIPTION } from "./command-trees.js"
import { pick, resolveLang } from "./i18n.js"
import type { Bilingual, TuiLang } from "./i18n.js"

export { MODEL_COMMAND, MODEL_COMMAND_DESCRIPTION }

/**
 * The LEGACY registered namespace the file bridge hangs off — NOT the write default.
 *
 * `mpd-config` registers this name for the `.mpd/mpd.jsonc` file-derived base, but on this harness the
 * settings machinery is keyed by profile ENTRY id, so a mutate addressed here is refused by the host
 * (`Plugin entry "mpd" is no longer configurable`). It is probed only because a value written by an
 * older surface may still live under it; {@link locateNamespace} falls back to `SETTINGS_ENTRY`.
 */
export const MODEL_NAMESPACE = "mpd"

/** The settings path prefix of every slot leaf. */
const TEAM_MODELS_PREFIX = "teamModels"

/** What `/mpd-model` needs from the rest of the plugin; every member is injectable for a test. */
export interface ModelMenuOptions {
  /** The dialog seam; the command's own wrapper when omitted. */
  readonly dialogs?: DialogSeam
  /** The catalog/settings seam; resolved from `ctx` through the section's reader when omitted. */
  readonly adapter?: CatalogReadSeam
  /** The context the default adapter is resolved from. */
  readonly ctx?: unknown
  /** The language resolution inputs (`DSH_TUI_LANG` / the preference file / the locale). */
  readonly langInputs?: Parameters<typeof resolveLang>[0]
}

/** The outcome of one `/mpd-model` invocation, as the command registry renders it. */
export type ModelMenuResult = { kind: "success"; text?: string } | { kind: "error"; text: string }

/** The host's time budget for one panel; a dialog that is never answered must not hang the command. */
const PANEL_TIMEOUT_MS = 120_000

/** The command's own copy, in both languages (the dialog title and every option label are ours). */
const MENU_TEXT = {
  titleSlot: { zh: "MPD 模型槽位", en: "MPD model slot" },
  titleProvider: { zh: "MPD 提供商", en: "MPD provider" },
  titleModel: { zh: "MPD 模型", en: "MPD model" },
  titleEffort: { zh: "MPD 推理强度", en: "MPD reasoning effort" },
  slotHint: { zh: "该槽位驱动的成员组：{group}", en: "the member group this slot drives: {group}" },
  providerHint: { zh: "该槽位的提供商；模型列表来自它", en: "this slot's provider; the model list comes from it" },
  modelHint: { zh: "该槽位的模型", en: "this slot's model" },
  effortHint: { zh: "该槽位的推理强度", en: "this slot's reasoning effort" },
  sealedByDialogs: {
    zh: "mpd-model: 该组合没有对话框接缝（无界面嵌入），未打开菜单，也未写入任何设置",
    en: "mpd-model: this composition has no dialogs seam (a headless embedder) — no menu was opened and nothing was written",
  },
  sealedByCancelSlot: { zh: "mpd-model: 已取消槽位选择，未写入任何设置", en: "mpd-model: the slot panel was cancelled — nothing was written" },
  sealedByCancelProvider: { zh: "mpd-model: 已取消提供商选择，未写入任何设置", en: "mpd-model: the provider panel was cancelled — nothing was written" },
  sealedByCancelModel: { zh: "mpd-model: 已取消模型选择，未写入任何设置", en: "mpd-model: the model panel was cancelled — nothing was written" },
  sealedByCancelEffort: { zh: "mpd-model: 已取消推理强度选择，未写入任何设置", en: "mpd-model: the reasoning-effort panel was cancelled — nothing was written" },
  sealedByNoNamespace: {
    zh: "mpd-model: 该组合没有可写的设置接缝，未写入任何设置",
    en: "mpd-model: this composition exposes no settings write seam — nothing was written",
  },
  sealedByRefused: { zh: "mpd-model: 设置写入被拒绝（{error}）", en: "mpd-model: the settings write was refused ({error})" },
  sealedByNoSlot: { zh: "mpd-model: 未知槽位“{slot}”，未写入任何设置", en: "mpd-model: unknown slot \"{slot}\" — nothing was written" },
  catalogFallback: {
    zh: "实时模型目录不可用（{why}）——面板列出的是内置回退清单，不是实时目录",
    en: "the live model catalog is unavailable ({why}) — the panels list the declared fallback, not the live catalog",
  },
  catalogDegraded: { zh: "模型目录读取不完整", en: "the catalog read was incomplete" },
  catalogAbsent: { zh: "该组合没有 llmCatalog 接缝", en: "this composition exposes no llmCatalog seam" },
  catalogThrew: { zh: "读取抛错：{error}", en: "the read threw: {error}" },
  wrote: {
    zh: "mpd-model: 槽位 {slot} 已设置 提供商 {provider} · 模型 {model} · 推理强度 {effort}；{disclosure}。{notLost}",
    en: "mpd-model: slot {slot} set to provider {provider} · model {model} · reasoning effort {effort}; {disclosure}. {notLost}",
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

/** The label the model summary uses; clamped so one long id cannot push the sentence past the budget. */
function short(value: string): string {
  return scalarText(value, 60) ?? value
}

/**
 * The slot panel's options: one per slot, labelled with the MEMBER GROUP it drives.
 *
 * The group names come from the shared schema (`TEAM_MODEL_SLOT_GROUPS`), which is the same
 * declaration the `/settings` row labels are built from, so the panel and the row cannot name a
 * slot's group differently.
 * @param lang - the language to render the labels in.
 * @returns four options, `slot1` first.
 */
export function slotPanelOptions(lang: TuiLang): { id: string; label: string; description: string }[] {
  return TEAM_MODEL_SLOTS.map((slot, index) => {
    /** The slot's group identity, shared with the settings schema. */
    const group = TEAM_MODEL_SLOT_GROUPS[slot]
    return {
      id: slot,
      label: `${index + 1}. ${lang === "en" ? group.en : group.zh}`,
      description: say("slotHint", lang, { group: lang === "en" ? group.en : group.zh }),
    }
  })
}

/**
 * Project the catalog into the four panels' option lists.
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
 * @returns the four option lists the panels render; `slot` carries no catalog row of its own.
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
        keyedEfforts.push({ value: entry.id, label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id })
      }
    }
  }
  return {
    provider: lists.provider,
    // NEVER empty: a keyed provider with no models falls back to the same union the row offers.
    model: keyedModels.length > 0 ? keyedModels : lists.model,
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
 * Read the slot leaves already stored in one settings value.
 * @param value - a namespace's resolved value.
 * @param slot - the slot whose leaves are read.
 * @returns the stored triple, with only the keys the value actually carries.
 */
export function storedSlot(value: unknown, slot: string): Partial<Record<TeamModelLeaf, string>> {
  if (!isRecord(value)) return {}
  /** The slot block, from the value's root or from its `user`/`value` half. */
  const block = slotBlock(value, slot)
  /** The three leaf values, each kept only when it is a usable string. */
  const out: Partial<Record<TeamModelLeaf, string>> = {}
  if (!isRecord(block)) return out
  for (const leaf of ["provider", "model", "reasoningEffort"] as const) {
    /** The stored leaf value, when this slot block carries one. */
    const found = block[leaf]
    if (typeof found === "string" && found.length > 0) out[leaf] = found
  }
  return out
}

/**
 * The `teamModels.<slot>` block of one settings value, looked for at the root and under the two
 * host-document halves.
 * @param value - a namespace's resolved value.
 * @param slot - the slot name (`slot1`…`slot4`).
 * @returns the block, or undefined when this value does not carry the slot.
 */
function slotBlock(value: Record<string, unknown>, slot: string): unknown {
  for (const candidate of [value, value.user, value.value]) {
    if (!isRecord(candidate)) continue
    /** That candidate's `teamModels` block. */
    const teamModels = candidate[TEAM_MODELS_PREFIX]
    if (isRecord(teamModels) && teamModels[slot] !== undefined) return teamModels[slot]
  }
  return undefined
}

/**
 * Which namespace the write targets: the one that already carries this slot, else the ENTRY.
 *
 * MEASURED on the installed harness, and the reason the fallback is `SETTINGS_ENTRY` and not
 * `MODEL_NAMESPACE`: the host resolves a mutate key against its own DESCRIPTOR LIST, which is keyed by
 * profile ENTRY id — `const descriptor = this.describe().find((row) => row.ns === ns)` and it throws
 * `Plugin entry "<ns>" is no longer configurable` when no row matches (`dsh-settings/lib/index.js`).
 * `"mpd"` is a namespace this bundle REGISTERS, never a profile entry, so a write addressed to it can
 * only ever be refused. `"mpd-config"` IS the entry (the loader gives the row
 * `options.id = "mpd-config"`, which is what both front doors read values through).
 *
 * The probe is still a read, so it can run safely before the user has confirmed anything, and a slot
 * already stored under the other name keeps winning — that is a fact about where the value LIVES,
 * not a preference.
 * @param adapter - the catalog/settings seam.
 * @param slot - the slot being edited.
 * @returns the namespace name and the revision an expected-revision fence should use.
 */
export function locateNamespace(adapter: CatalogReadSeam, slot: string): { namespace: string; revision: number | undefined } {
  /** The revision read for the namespace the write lands in. */
  let revision: number | undefined
  // The ENTRY is probed first: it is the only key the host can mutate, so a tie resolves toward it.
  for (const namespace of [SETTINGS_ENTRY, MODEL_NAMESPACE]) {
    /** This namespace's read surface, absent when the settings provider is not composed. */
    const reader = adapter.settingsReader?.(namespace)
    if (reader === undefined) continue
    // The revision is taken from EITHER namespace, whichever answers last, so the fence reflects
    // the document's current revision even when the namespace is picked by the loop's end.
    try {
      revision = reader.describe()?.revision
    } catch {
      // An unreadable descriptor costs the fence, not the write.
    }
    /** Whether this namespace already carries the slot being edited. */
    const hasSlot = Object.keys(storedSlot(reader.get(), slot)).length > 0
    // A slot already stored somewhere WINS wherever it is: writing the other name instead would
    // persist a value no reader resolves.
    if (hasSlot) return { namespace, revision }
  }
  return { namespace: SETTINGS_ENTRY, revision }
}

/**
 * Open the pick-list chain and write the chosen route.
 *
 * One invocation, one write. The chain is straight-line: each panel settles an option id
 * (Enter), and `undefined` (Esc / Ctrl+C / timeout) returns with a sentence that names the
 * cancelled panel and writes nothing.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param options - the injectable seams; a test supplies its own dialogs and adapter.
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
  let catalogWhy: "absent" | "degraded" | string | undefined
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

  // ── panel 1: the slot, labelled with the member group it drives ────────────
  /** The picked slot; undefined means the chain was cancelled here. */
  const slot = await dialogs.select(say("titleSlot", lang), slotPanelOptions(lang), PANEL_TIMEOUT_MS)
  if (slot === undefined) return { kind: "error", text: say("sealedByCancelSlot", lang) }
  if (!TEAM_MODEL_SLOTS.includes(slot as "slot1")) return { kind: "error", text: say("sealedByNoSlot", lang, { slot: short(slot) }) }

  // ── panel 2: the provider ─────────────────────────────────────────────────
  /** The provider picked; undefined when the panel was cancelled. */
  const provider = await dialogs.select(
    say("titleProvider", lang),
    lists.provider.map((option) => ({ id: option.value, label: option.label, description: say("providerHint", lang) })),
    PANEL_TIMEOUT_MS,
  )
  if (provider === undefined) return { kind: "error", text: say("sealedByCancelProvider", lang) }

  // ── panel 3: the model — that provider's models, else the union, NEVER empty ──
  /** The model options this provider offers (or the union when the catalog cannot narrow). */
  const models = panelOptions(lists, provider, undefined, catalog).model
  /** The model picked; undefined when the panel was cancelled. */
  const model = await dialogs.select(
    say("titleModel", lang),
    models.map((option) => ({ id: option.value, label: option.label, description: say("modelHint", lang) })),
    PANEL_TIMEOUT_MS,
  )
  if (model === undefined) return { kind: "error", text: say("sealedByCancelModel", lang) }

  // ── panel 4: the reasoning effort — the model's efforts, union fallback ────
  /** The effort options the chosen model offers (or the union when the catalog cannot narrow). */
  const efforts = panelOptions(lists, provider, model, catalog).reasoningEffort
  /** The effort picked; undefined when the panel was cancelled. */
  const effort = await dialogs.select(
    say("titleEffort", lang),
    efforts.map((option) => ({ id: option.value, label: option.label, description: say("effortHint", lang) })),
    PANEL_TIMEOUT_MS,
  )
  if (effort === undefined) return { kind: "error", text: say("sealedByCancelEffort", lang) }

  // ── the write: the same path the section writes with ──────────────────────
  /** WHERE the write goes and the revision the fence uses. */
  const target = locateNamespace(adapter, slot)
  if (typeof adapter.settingsMutate !== "function") return { kind: "error", text: say("sealedByNoNamespace", lang) }
  /** The three ops one write carries — set each leaf of the picked slot. */
  const ops = (["provider", "model", "reasoningEffort"] as const).map((leaf) => ({
    op: "set" as const,
    path: [TEAM_MODELS_PREFIX, slot, leaf],
    value: leaf === "provider" ? provider : leaf === "model" ? model : effort,
  }))
  /** The write result; never a throw (the adapter's contract). */
  const written = await adapter.settingsMutate(target.namespace, ops, target.revision)
  if (!written.ok) return { kind: "error", text: say("sealedByRefused", lang, { error: short(written.error) }) }
  log.info(`/${MODEL_COMMAND} wrote ${target.namespace}.${TEAM_MODELS_PREFIX}.${slot} = ${provider}/${model}/${effort}`)

  /** What the outcome sentence says about the catalog the user picked from. */
  const fallback = catalogWhy === undefined ? "" : ` · ${say("catalogFallback", lang, { why: catalogWhy })}`
  // The disclosure is the SAME sentence the section carries (contract §4.6): the value IS saved,
  // its BEHAVIOUR change waits for a restart, and it is never lost.
  return {
    kind: "success",
    text: `${say("wrote", lang, {
      slot,
      provider: short(provider),
      model: short(model),
      effort: short(effort),
      disclosure: BRIDGE_DISCLOSURE,
      notLost: BRIDGE_NOT_LOST,
    })}${fallback}`,
  }
}

/**
 * Read every slot's stored leaves from whichever namespace serves them.
 * @param adapter - the catalog/settings seam.
 * @returns one partial triple per slot; an empty object per slot when nothing is stored yet.
 */
export function readStoredSlots(adapter: CatalogReadSeam): Record<string, Partial<Record<TeamModelLeaf, string>>> {
  /** The namespace read for the slots; the legacy one first, then the entry config. */
  let value: unknown
  for (const namespace of [MODEL_NAMESPACE, SETTINGS_ENTRY]) {
    /** This namespace's read surface, absent when the settings provider is not composed. */
    const reader = adapter.settingsReader?.(namespace)
    if (reader === undefined) continue
    try {
      value = reader.get()
    } catch {
      value = undefined
    }
    if (value !== undefined) break
  }
  /** Each slot's stored triple. */
  const out: Record<string, Partial<Record<TeamModelLeaf, string>>> = {}
  for (const slot of TEAM_MODEL_SLOTS) out[slot] = storedSlot(value, slot)
  return out
}
