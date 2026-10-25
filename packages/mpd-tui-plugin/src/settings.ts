// Seam 6 — `ctx.tuiSettingsSections`: the `/settings` section of the mpd bundle.
//
// DISCLOSURE (read before trusting the writes): the fields below are the real
// `.mpd/mpd.jsonc` knobs — the runtime config layer the mpd plugins read through
// `packages/mpd-config-plugin`. That layer is NOT the harness settings document this
// screen writes to, and the bridge between them is NOT a file write (CodeRabbit #4 on
// PR #66, verified in `packages/mpd-config-plugin/src/index.ts`): this section is keyed by
// the config ENTRY (`mpd-config`), whose persistence is the HOST's — the entry-config
// listener re-loads the row's state and deliberately writes no file. The
// `<workspace>/.mpd/mpd.jsonc` write-back existed only for the LEGACY `mpd` namespace, and
// this harness REFUSES that registration (`settingsModelRetired = true`, one boot warning),
// so that path is dormant here. `BRIDGE_DISCLOSURE` states exactly this to the reader.
//
// LIVE REFRESH, PER KNOB GROUP (D-18, audit wave 2026-10-25): the config row arms a file
// watcher at mount AND subscribes to the entry-config document, so its `state` re-resolves on
// every settings save and on a watched edit of the project file. WHICH knobs that reaches in a
// RUNNING process is NOT blanket: the model routes this section edits (`teamModels`,
// `modelchain`), `watchdog.*`, `team.stateDir`, `team.gate`/`team.sensitivity`,
// `captain.investigation` and `delegation.gate` are read PER USE, so the next spawn, tick or
// guarded call carries them; `tui.dashboardKey` is live one way (false disables at once).
// A knob some plugin CAPTURED at its own mount — `hashline.*`, `commentChecker.*`, `ulw.*`,
// `memory.*`, `boulder.dir`, `goal.*` — still waits for the next boot, which
// `BRIDGE_RESTART_LIMIT` names, and SECTION_NOTICE below renders BOTH halves.
//
// SEE BEFORE YOU EDIT (R3): the section's own description carries
// `effectiveModelSummary` — the four effective slot routes and the configured
// `modelchain` chains — read from the `mpdConfig` service AT SECTION-REQUEST TIME,
// so every `/settings` open shows the effective config as of now. The per-member
// `agentRoutes` half is DELETED with the layer (slot-single-source §3).
//
// The disclosure is not only in this header and the READMEs — it is carried by
// the RENDERED METADATA too (t21): every field hint names its mpd.jsonc key, and
// the hints are built by one helper so the disclosure half cannot be dropped from a
// field silently (test/plugin.test.ts asserts it on the registered section).
//
// The namespace registration exists so the screen treats the section as
// available (an unregistered namespace is rendered as unavailable by design).
// `z` comes from the bundle's already-vendored schemastery copy. Same directory
// specifier rule as `index.ts`.
import type { PluginContextLike, SeamOutcome, SeamState, SettingsProviderLike, TuiAdapter, TuiSettingsFieldLike, TuiSettingsSectionLike } from "./types.js"
// ONE source for the namespace schema, the twenty-two knobs and the disclosure: `mpd-config-plugin`
// owns the namespace (design §10.1) and exports them; this package consumes them for its
// guarded FALLBACK registration and for the section it declares.
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, BRIDGE_RESTART_LIMIT, SettingsSchema, SETTINGS_KNOBS, SETTINGS_NS, TEAM_MODEL_FALLBACK_OPTIONS, TEAM_MODEL_SLOT_GROUPS, TEAM_MODEL_SLOTS, markVolatile } from "../../mpd-config-plugin/src/settings-schema"

// RE-EXPORTED so this row marks its OWN config volatile WITHOUT adding a second cross-package import
// edge (the coupling inventory pins ONE edge per file, and it may only shrink).
export { markVolatile }
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { DshAdapter, DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { Log } from "./log.js"
import { stripControl } from "./sanitize.js"
import { serviceOf } from "../../mpd-tui-adapter-plugin/src/index.js"

export { SETTINGS_NS }

/**
 * The ROW ID the harness's settings machinery serves the mpd knobs under: the loader gives the row
 * `options.id = "mpd-config"` (its `entry.id` is the address `include:mpd-config`). Section values
 * are resolved against this, not against the retired namespace name.
 */
export const SETTINGS_ENTRY = "mpd-config"

/** Re-exported so this package's tests and consumers keep one name for the schema. */
export { SettingsSchema }

/**
 * The disclosure a user must be able to read ON SCREEN (t21, reworded by t35).
 *
 * Every hint that names an `.mpd/mpd.jsonc` key carries this sentence, because the
 * screen is the only place a user learns what saving a field does. It has TWO parts
 * and both are load-bearing: the save IS written to the workspace file for the live
 * session workspace(s), and the BEHAVIOUR change still needs a restart because the
 * knobs are read at plugin mount. The old "not bridged" claim was true before t35 and
 * is now deleted, not softened — a hint that kept it would be a lie.
 */
export { BRIDGE_DISCLOSURE }
export { BRIDGE_NOT_LOST }
export { BRIDGE_RESTART_LIMIT }

/**
 * The runtime notice the surfaces show when the save had no live session workspace to
 * write to (design §D.2 "no live root at save time"). Exported so the same sentence is
 * used by every surface that reports a save outcome.
 */
export const BRIDGE_NO_WORKSPACE_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * One field hint, HUMAN SENTENCE FIRST: the knob's own human sentence (what it is and what
 * configuring it does) leads, then the real mpd.jsonc key — the pointer the reader looks up in the
 * file. The long disclosure (live-refresh truth plus the not-lost clause) is stated ONCE by the
 * section's own description, never per row. A knob with no human sentence keeps the pointer-only
 * hint byte-for-byte.
 */
function knobHint(key: string, semantics?: string): string {
  // The ROW hint is the knob's own sentence plus its dotted key. The bridge disclosure is stated
  // ONCE, in the section's own description (see SETTINGS_SECTION below) — inlining it per row is
  // what made the rows read as the same four lines (measured in docker/ui, `05b-mpd-section.png`).
  /** The dotted `.mpd/mpd.jsonc` key the row edits; the same pointer in both languages. */
  const pointer = `mpd.jsonc ${key}`
  return semantics === undefined || semantics.length === 0 ? pointer : `${semantics} (${pointer})`
}

/**
 * The hint pair the host resolves per render (`hintDescriptions` at use, the host's own `pick()`).
 *
 * Both halves are built by the SAME {@link knobHint}, so the zh hint cannot lose the `.mpd/mpd.jsonc`
 * pointer or the human sentence the EN one carries — it differs only in the language of the
 * sentence, which the shared schema declares twice (`semantics` / `semanticsZh`).
 */
function knobHintPair(knob: (typeof SETTINGS_KNOBS)[number]): { zh: string; en: string } {
  /** The dotted key both halves point at. */
  const key = knob.path.join(".")
  return { zh: knobHint(key, knob.semanticsZh), en: knobHint(key, knob.semantics) }
}

// ── the twelve team-model slot knobs: a SELECT with a live option list (A4) ─────
// The host renders `kind: "select"` by CYCLING a frozen option list — it deep-freezes the
// options at registration and offers no pick-list dialog — so a slot leaf must be
// registered with the list it should offer, and that list must never be empty (an empty
// list would leave a slot settable only by typing, which this front door does not allow).
// The list is therefore projected from the adapter's live model catalog BEFORE register.

/** The leaf names of one slot knob, in the schema's path order (`teamModels.<slot>.<leaf>`). */
const TEAM_MODEL_LEAVES = ["provider", "model", "reasoningEffort"] as const
/** The three leaf names of a team-model slot, in schema path order. */
export type TeamModelLeaf = (typeof TEAM_MODEL_LEAVES)[number]

/** One rendered option: the RAW id the settings document stores, plus its display label. */
export interface SettingsOption {
  /** The raw id the settings document stores, never a display name. */
  value: string
  /** The option's display label; the id itself when the catalog carries no name. */
  label: string
}

/**
 * Which source produced one leaf's option list. Exported because A4's evidence must record
 * the BRANCH (live catalog vs declared fallback), not merely that the list is non-empty.
 */
export type SlotOptionSource = "live" | "declared"

/** The three derived option lists the twelve slot knobs are registered with, plus their source. */
export interface TeamModelOptionLists {
  /** Provider options: the catalog's provider ids, else the declared list. */
  provider: SettingsOption[]
  /** Model options: the union of the catalog's model ids, else the declared list. */
  model: SettingsOption[]
  /** Effort options: the union of the catalog's effort ids, else the declared list. */
  reasoningEffort: SettingsOption[]
  /** Which branch produced each leaf's list, recorded because the A4 evidence needs the branch. */
  source: Record<TeamModelLeaf, SlotOptionSource>
}

/** First occurrence of each id wins, so the display order stays the catalog's own order. */
function dedupeOptions(pairs: readonly SettingsOption[]): SettingsOption[] {
  /** Ids already accepted, so the first occurrence (the catalog's own order) wins. */
  const seen = new Set<string>()
  /** The deduplicated options, in first-seen order. */
  const out: SettingsOption[] = []
  for (const pair of pairs) {
    if (pair.value.length === 0 || seen.has(pair.value)) continue
    seen.add(pair.value)
    out.push(pair)
  }
  return out
}

/** The declared fallback list of one leaf, as options (value = label = the raw id). */
function declaredOptions(leaf: TeamModelLeaf): SettingsOption[] {
  return TEAM_MODEL_FALLBACK_OPTIONS[leaf].map((value) => ({ value, label: value }))
}

/** A catalog label, falling back to the id so a nameless entry still renders. */
function optionLabel(name: unknown, id: string): string {
  return typeof name === "string" && name.length > 0 ? name : id
}

/**
 * Project the adapter catalog into the option lists of the twelve slot knobs (A4).
 *
 * LIVE: provider ids (label = the catalog's provider NAME), the UNION of every provider's
 * model ids (label = the model name), the UNION of every model's effort ids (label = the
 * effort name). Every value is the raw id the settings document stores.
 *
 * DECLARED: the frozen fallback of the shared schema, used when the catalog is absent, is
 * DEGRADED (a partial read is treated as no read: the fallback is the list this bundle can
 * verify, and `degraded` is exactly the adapter's "part of this read failed" signal) or
 * yields nothing for that leaf. So every returned list is NON-EMPTY by construction.
 *
 * The projection is TOTAL: a malformed catalog (non-array providers/models/efforts, an
 * entry without a string id) is skipped instead of throwing, so a hostile or half-built
 * catalog object can never stop the section from registering.
 */
export function teamModelOptionLists(catalog: DshLlmCatalog | undefined): TeamModelOptionLists {
  /** Provider ids collected from the live catalog. */
  const providers: SettingsOption[] = []
  /** Model ids collected across every provider. */
  const models: SettingsOption[] = []
  /** Effort ids collected across every model. */
  const efforts: SettingsOption[] = []
  if (catalog !== undefined && catalog.degraded !== true) {
    /** The catalog's provider list, empty when that field is not an array. */
    const rawProviders = Array.isArray(catalog.providers) ? catalog.providers : []
    for (const provider of rawProviders) {
      if (typeof provider?.id !== "string" || provider.id.length === 0) continue
      providers.push({ value: provider.id, label: optionLabel(provider.name, provider.id) })
      /** This provider's model list, empty when that field is not an array. */
      const rawModels = Array.isArray(provider.models) ? provider.models : []
      for (const model of rawModels) {
        if (typeof model?.id !== "string" || model.id.length === 0) continue
        models.push({ value: model.id, label: optionLabel(model.name, model.id) })
        /** This model's effort list, empty when that field is not an array. */
        const rawEfforts = Array.isArray(model.efforts) ? model.efforts : []
        for (const effort of rawEfforts) {
          if (typeof effort?.id !== "string" || effort.id.length === 0) continue
          efforts.push({ value: effort.id, label: optionLabel(effort.name, effort.id) })
        }
      }
    }
  }
  /** The deduplicated live lists, one per leaf. */
  const live = { provider: dedupeOptions(providers), model: dedupeOptions(models), reasoningEffort: dedupeOptions(efforts) }
  /** The leaf's live list when it has one, else the declared fallback, so no list stays empty. */
  const pick = (leaf: TeamModelLeaf): SettingsOption[] => (live[leaf].length > 0 ? live[leaf] : declaredOptions(leaf))
  return {
    provider: pick("provider"),
    model: pick("model"),
    reasoningEffort: pick("reasoningEffort"),
    source: {
      provider: live.provider.length > 0 ? "live" : "declared",
      model: live.model.length > 0 ? "live" : "declared",
      reasoningEffort: live.reasoningEffort.length > 0 ? "live" : "declared",
    },
  }
}

/** The slot leaf a knob path addresses, or undefined for one of the other thirteen knobs. */
function slotLeafOf(path: readonly string[]): TeamModelLeaf | undefined {
  if (path[0] !== "teamModels") return undefined
  /** The path's leaf segment, matched against the three known names. */
  const leaf = path[2]
  return TEAM_MODEL_LEAVES.find((candidate) => candidate === leaf)
}

/**
 * Is the namespace already served? Probed through the provider's own read surface: `describe()`
 * is the documented way to enumerate served namespaces, with `get()` as the fallback for a
 * provider that answers only reads.
 */
function isServed(provider: SettingsProviderLike): boolean {
  try {
    if (typeof provider.describe === "function") {
      /** The provider's own namespace listing, when it can enumerate them. */
      const described = provider.describe()
      if (Array.isArray(described) && described.some((entry) => String((entry as { ns?: unknown })?.ns ?? "") === SETTINGS_NS)) return true
    }
  } catch {
    /* an unreadable describe must not be read as "unserved" by itself */
  }
  try {
    return typeof provider.get === "function" && provider.get(SETTINGS_NS) !== undefined
  } catch {
    return false
  }
}

/** Is the config plugin in this composition? Its `mpdConfig` service is the signal (design §10.1). */
function configPluginPresent(ctx: PluginContextLike): boolean {
  try {
    return typeof ctx.get === "function" && ctx.get("mpdConfig") !== undefined
  } catch {
    return false
  }
}

/**
 * The `mpdConfig` surface the DISPLAY paths read: the raw keyed read plus the typed slot answer.
 *
 * Both members are optional because the service is resolved from a foreign context: an older
 * composition may carry only `get` (the raw config) and a unit double may carry only one of them.
 */
export interface MpdConfigReadLike extends SlotResolutionServiceLike {
  /** The raw keyed config read (`teamModels`, `modelchain`, …). */
  get?(key?: string): unknown
}

/**
 * The typed answer a slot-configuration read gives (contract AMENDMENT 1).
 *
 * `ok` carries the route and how many fallbacks the slot declares; `unconfigured` names the missing
 * leaves; `invalid` is the service's own reject verdict; `unavailable` means the service cannot answer
 * at all (not composed, method absent, or an unreadable value) — the state a DISPLAY renders as
 * `<unavailable>` instead of inventing a route.
 */
export type SlotResolutionDisplay =
  | { state: "ok"; route: string; fallbacks: number }
  | { state: "unconfigured"; missing: string[] }
  | { state: "invalid" }
  | { state: "unavailable" }

/** The minimal config-service slice a slot display needs; `slotResolutionOf` is the whole of it. */
export interface SlotResolutionServiceLike {
  /** The member's typed slot answer; absent on a composition that predates the amendment. */
  slotResolutionOf?(member: string): unknown
}

/**
 * Read one member's slot configuration into the DISPLAY shape, never throwing.
 *
 * THE SERVICE'S ANSWER IS NARROWED, NOT TRUSTED: a partial or older service may answer `undefined`, a
 * bare route object or a different union, and the display must degrade rather than crash a dialog. An
 * absent method — or a value that is none of the declared shapes — answers `unavailable`, which is the
 * token the reader sees; a declared `ok:false` with `reason: "unconfigured"` answers `unconfigured`.
 * @param service - the config service slice, or undefined when no config row is composed.
 * @param member - the roster member whose slot is asked about (the amendment's argument).
 * @returns the typed display answer.
 */
export function slotResolutionDisplay(service: SlotResolutionServiceLike | undefined, member: string): SlotResolutionDisplay {
  if (service === undefined || service === null || typeof service.slotResolutionOf !== "function") return { state: "unavailable" }
  /** The service's raw answer; a throw is the same fact as an absent answer for a display. */
  let raw: unknown
  try {
    raw = service.slotResolutionOf(member)
  } catch {
    return { state: "unavailable" }
  }
  if (!isPlainTable(raw)) return { state: "unavailable" }
  if (raw.ok === true) {
    /** The route block the service positively resolved. */
    const route = raw.route
    if (!isPlainTable(route) || typeof route.provider !== "string" || typeof route.model !== "string") return { state: "invalid" }
    // The effort is optional in the route; the fallback count is reported so a reader can tell a
    // single-route slot from one carrying backups.
    /** The effort fragment, when the route declares one. */
    const effort = typeof route.reasoningEffort === "string" && route.reasoningEffort !== "" ? ` / ${route.reasoningEffort}` : ""
    // THE ROUTE IS CONFIGURATION, NOT TRUSTED TEXT (CodeRabbit #14): every component comes from
    // `.mpd/mpd.jsonc`, and the composed sentence is handed to a dialog renderer this plugin does not
    // own. The repository's WHITESPACE-PRESERVING sanitizer is applied here — the " / " separators must
    // survive — so a control character in a provider or model id can never reach the terminal.
    /** The composed route sentence, control characters stripped. */
    const routeText = stripControl(`${route.provider} / ${route.model}${effort}`)
    return {
      state: "ok",
      route: routeText,
      fallbacks: Array.isArray(raw.fallbacks) ? raw.fallbacks.length : 0,
    }
  }
  if (raw.ok === false) {
    // THE SERVICE'S OWN DISCRIMINANT IS `status` (contract amendment 1: `unconfigured` | `invalid` |
    // `unrouted`), not a generic reason. `unrouted` means no slot decides this member — for a display
    // that is not an unconfigured SLOT, so it degrades to `<unavailable>` rather than claiming a slot
    // the roster does not route.
    if (raw.status === "invalid") return { state: "invalid" }
    if (raw.status !== "unconfigured") return { state: "unavailable" }
    // The missing leaves are REPORTED by the service; a value that carries none still says
    // `unconfigured`, with an empty list rather than an invented one.
    return {
      state: "unconfigured",
      missing: Array.isArray(raw.missing) ? raw.missing.filter((leaf): leaf is string => typeof leaf === "string") : [],
    }
  }
  return { state: "unavailable" }
}

/**
 * The `mpdConfig` service the effective summary reads, or undefined when this composition mounts
 * no config row (the guarded-fallback world) or the lookup refuses. Probed PER CALL — the row's
 * fiber may activate after this one, the same race `configPluginPresent` tolerates.
 * @param ctx - the plugin context the service is resolved from.
 * @returns the service slice, or undefined when it is not composed.
 */
export function configServiceOf(ctx: PluginContextLike): MpdConfigReadLike | undefined {
  try {
    /** The service double, read only for the members above. */
    const service = typeof ctx.get === "function" ? ctx.get("mpdConfig") : undefined
    return service !== null && typeof service === "object" ? (service as MpdConfigReadLike) : undefined
  } catch {
    return undefined
  }
}

/** Whether a value is a non-null, non-array object — the only shape a route table can be. */
function isPlainTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** One string leaf of a route block, "" when the block carries no non-empty string there. */
function summaryLeaf(block: unknown, leaf: string): string {
  /** The leaf's raw value, when the block carries one. */
  const found = isPlainTable(block) ? block[leaf] : undefined
  return typeof found === "string" && found.length > 0 ? found : ""
}

/**
 * The SEE-BEFORE-YOU-EDIT summary (R3): the current effective model config in one bounded line per
 * language — the four slot routes and the configured `modelchain` chains.
 *
 * THE PER-MEMBER OVERRIDE HALF IS GONE (`.mpd/plans/slot-single-source.md` §3): `agentRoutes` is
 * deleted, so a summary that still printed it would advertise a layer no spawn reads. A slot the
 * service reports as `unconfigured` prints the literal `<unconfigured>`; a composition whose service
 * predates the typed read falls back to the RAW stored leaves, and a raw block with neither provider
 * nor model is reported as `<unconfigured>` too — never as an invented route, and never as a throw.
 * @param config - the `mpdConfig` service double, or undefined when no config row is composed.
 * @returns the `{ en, zh }` pair the section's description carries; an explicit unavailability
 *   sentence when the service is absent.
 */
export function effectiveModelSummary(config: MpdConfigReadLike | undefined): { en: string; zh: string } {
  if (config === undefined || config === null || typeof config.get !== "function") {
    return {
      en: "effective values unavailable (no mpdConfig service in this composition)",
      zh: "生效值不可用（该组合没有 mpdConfig 服务）",
    }
  }
  /** The slot routes, one fragment per slot in slot order. */
  const slotFragments: string[] = []
  try {
    /** The four slot blocks, read RAW: the schema layer above them is gone with the default layer. */
    const slots = config.get("teamModels")
    for (const slot of TEAM_MODEL_SLOTS) {
      /** The first member of the slot's group; the typed read is addressed by MEMBER (amendment 1). */
      const member = TEAM_MODEL_SLOT_GROUPS[slot].members[0] ?? ""
      /** This slot's typed answer; `unavailable` when the service has no typed read. */
      const display = slotResolutionDisplay(config, member)
      if (display.state === "ok") {
        slotFragments.push(`${slot}:${display.route}`)
        continue
      }
      if (display.state !== "unavailable") {
        slotFragments.push(`${slot}:<${display.state}>`)
        continue
      }
      /** This slot's RAW stored block, the fallback for an older composition. */
      const block = isPlainTable(slots) ? slots[slot] : undefined
      /** The raw provider leaf. */
      const provider = summaryLeaf(block, "provider")
      /** The raw model leaf. */
      const model = summaryLeaf(block, "model")
      // BOTH LEAVES EMPTY IS THE UNCONFIGURED STATE (the seed writes a full triple or nothing), so the
      // summary prints the contract's own token instead of a `//`-looking empty route.
      slotFragments.push(provider === "" && model === "" ? `${slot}:<unconfigured>` : `${slot}:${provider}/${model}/${summaryLeaf(block, "reasoningEffort") || "-"}`)
    }
  } catch {
    // An unreadable slot half renders as an explicit gap rather than a wrong route.
    slotFragments.length = 0
  }
  /** The configured chains as `key→provider/model` fragments (the first hop, plus a +N marker). */
  const chainFragments: string[] = []
  try {
    /** The configured modelchain table. */
    const chains = config.get("modelchain")
    if (isPlainTable(chains)) {
      for (const [key, chain] of Object.entries(chains)) {
        if (!Array.isArray(chain) || chain.length === 0) continue
        /** The first hop, when it carries a provider and a model. */
        const first = isPlainTable(chain[0]) && typeof chain[0].provider === "string" && typeof chain[0].model === "string" ? `${chain[0].provider as string}/${chain[0].model as string}` : ""
        if (first !== "") chainFragments.push(`${key}→${first}${chain.length > 1 ? ` (+${String(chain.length - 1)})` : ""}`)
      }
    }
  } catch {
    // An unreadable chains half renders as none-configured rather than as a wrong claim.
  }
  /** The slot half of the sentence; an explicit gap when the read failed. */
  const slotsText = slotFragments.length > 0 ? `slots ${slotFragments.join(" · ")}` : "slots unreadable"
  /** The chains half of the sentence. */
  const chainsText = chainFragments.length > 0 ? chainFragments.join(" · ") : "none configured"
  return {
    en: `effective now — ${slotsText}; modelchain: ${chainsText}`,
    zh: `当前生效 —— ${slotsText}；modelchain：${chainsText}`,
  }
}

/**
 * One knob's field metadata with its DECLARED options (the shared schema's lists).
 *
 * Every field is built here, so the thirteen non-slot knobs keep their paths, kinds and
 * labels byte-for-byte whatever the catalog says, and `SETTINGS_FIELDS` (the declared
 * baseline this package exports) and the registered section cannot drift apart.
 */
function declaredField(knob: (typeof SETTINGS_KNOBS)[number]): TuiSettingsFieldLike {
  /** The localized hint pair; the host resolves it per render (its own `pick()`, measured). */
  const hints = knobHintPair(knob)
  return {
    path: [...knob.path],
    label: knob.label,
    // `label` is the English base and `descriptions` carries the zh translation — the HOST'S OWN
    // pattern (measured in its `settings/definitions.js`: `descriptions: { zh: … }` with the
    // English living in the base field). An `en` twin would duplicate the base string and buy
    // nothing: the host's `pick(text, descriptions)` falls back to the base when the map has no
    // entry for the active language.
    descriptions: { zh: knob.zh },
    hint: hints.en,
    // `hintDescriptions` is the host's OWN localized hint field: its settings screen renders
    // `pick(field.hint, field.hintDescriptions)`, so the zh reader gets a zh sentence while the
    // rest of the screen is Chinese. Set only when the two differ, so a field whose hint is
    // language-neutral keeps one string.
    ...(hints.zh === hints.en ? {} : { hintDescriptions: { zh: hints.zh } }),
    kind: knob.kind,
    ...(knob.options === undefined ? {} : { options: knob.options.map((value) => ({ value, label: value })) }),
  }
}

// ── the ONE TUI-owned knob: the Ctrl+A takeover (W2) ────────────────────────────────────────────
//
// The knob is DECLARED in the shared schema (`mpd-config-plugin/src/settings-schema.ts`), which is the
// single source for the namespace schema and for the list BOTH front doors render: `SETTINGS_KNOBS`
// carries `tui.dashboardKey` (boolean, `hint` = the semantics sentence), `SettingsSchema` carries its
// L0 default (true), and this package renders it through the SAME `declaredField` path as every other
// row — so there is no locally-declared lookalike for the same path, and no count this file can drift
// from. The write path is unchanged: the section is keyed by the config ENTRY (`SETTINGS_ENTRY`), a
// save stores the leaf in the entry's section, the bridge writes it into the workspace's
// `.mpd/mpd.jsonc` as `tui.dashboardKey`, and the takeover reads it back through the `mpdConfig`
// service with the TUI row's own config (`dashboardKey`, default true) as the floor.

/** The mpd.jsonc key of the Ctrl+A takeover toggle, in its dotted form (the shared knob's own path). */
export const DASHBOARD_TAKEOVER_KNOB = "tui.dashboardKey"

// ── the wheel-direction knob (contract D2, wave fix/sidebar-defects) ─────────────────────────────
//
// THE KNOB IS READ THROUGH THE SAME `mpdConfig` SERVICE the Ctrl+A toggle above uses, from the SAME
// resolved layer stack — the USER layer `$DSH_HOME/mpd.jsonc` under the PROJECT layer
// `<workspace>/.mpd/mpd.jsonc` — so an edit in the workspace file is what turns it on, exactly like
// every other mpd.jsonc knob.
//
// DECLARED SHAPE: unlike `tui.dashboardKey` this leaf is NOT yet carried by `SETTINGS_KNOBS` /
// `SettingsSchema` in `mpd-config-plugin/src/settings-schema.ts` — that package is OUTSIDE this lane's
// write scope (contract §"Lanes and scopes") — so the knob has no row in the `/settings` form and the
// bound is stated in `docs/tui.md` §6.2 rather than papered over. It is still a real mpd.jsonc knob: the
// resolution that matters (`mpd-config-plugin`'s `loadConfig`) returns the RAW merged layers and never
// strips an undeclared key, so `{ "tui": { "wheelInvert": true } }` in the workspace file reaches this
// reader and inverts the wheel. Declaring the leaf in the shared schema is the follow-up that adds the
// settings row; nothing here has to change when it lands.

/** The mpd.jsonc key of the wheel-direction toggle, in its dotted form (the layer path it is read at). */
export const WHEEL_INVERT_KNOB = "tui.wheelInvert"

/**
 * Resolve the wheel-direction setting from one resolved mpd config value.
 *
 * THE RULE, and it is the same one the Ctrl+A toggle follows: the SAVED leaf wins when it is a boolean,
 * and the row config's own value is the FLOOR when it is absent or not a boolean. A junk value (`"yes"`,
 * `1`, an object) therefore leaves today's behaviour in force instead of arming the inversion by
 * accident — the knob can only ever be turned on deliberately.
 *
 * WHY IT TAKES THE WHOLE CONFIG RATHER THAN THE LEAF: `mpdConfig.get()` with no key answers the RAW
 * merged layer stack, which is the value this function can be handed in a test without a live service —
 * so the arm that proves "the knob resolves from `<workspace>/.mpd/mpd.jsonc`" drives the REAL layer
 * resolution instead of restating this function's own dotted walk.
 * @param config - one resolved mpd config value, as `mpdConfig.get()` returns it.
 * @param floor - the row config's own value, used when the file layer says nothing usable.
 * @returns true when the wheel's sign must be inverted.
 */
export function wheelInvertFrom(config: unknown, floor: boolean): boolean {
  /** The `tui` section of the resolved layers, when the value is a plain object. */
  const tui = typeof config === "object" && config !== null ? (config as Record<string, unknown>).tui : undefined
  /** The leaf itself, when the section is a plain object. */
  const leaf = typeof tui === "object" && tui !== null ? (tui as Record<string, unknown>).wheelInvert : undefined
  return typeof leaf === "boolean" ? leaf : floor
}

/** The declared field list: every knob with its declared options (the pre-catalog baseline). */
export const SETTINGS_FIELDS: readonly TuiSettingsFieldLike[] = SETTINGS_KNOBS.map(declaredField)

/**
 * The field list the section is REGISTERED with: {@link declaredField} for every knob,
 * with the three leaves of each team-model slot replaced by {@link teamModelOptionLists}. A slot
 * field is therefore always a `select` with a non-empty option list.
 *
 * THE `agentRoutes` ROW FAMILY IS GONE: the per-member override layer is deleted by
 * `.mpd/plans/slot-single-source.md` §3, so the shared knob declaration no longer carries those
 * paths and this builder has no route family to match besides `teamModels`.
 */
export function settingsFields(lists: TeamModelOptionLists): readonly TuiSettingsFieldLike[] {
  return SETTINGS_KNOBS.map((knob) => {
    /** The slot leaf this knob addresses, undefined for the non-route knobs. */
    const leaf = slotLeafOf(knob.path)
    /** The knob's declared field, before any route options are applied. */
    const field = declaredField(knob)
    return leaf === undefined ? field : { ...field, options: lists[leaf] }
  })
}

/**
 * The section this plugin declares.
 *
 * Every `hint` is built by {@link knobHint} and names its mpd.jsonc key; the user reading
 * `/settings` learns at the point of use what an edit writes. The twelve team-model slot hints
 * LEAD with the knob's own human sentence from the shared declaration (`knob.semantics`); the
 * label carries the group name. The long disclosure
 * is stated ONCE by the section's own description (which also carries the R3 effective summary at
 * registration time), never per row.
 *
 * This is the DECLARED shape (cloned per registration, with the slot options replaced by
 * the catalog projection). It is exported so the declared baseline stays inspectable.
 */
/**
 * The disclosure BOTH front doors state once, above their rows: the live groups, then the
 * mount-captured exception, then the not-lost clause (D-18 — rendering only the promising half
 * would restore the blanket claim this section used to make). ONE description, not a second block:
 * the three sentences are concatenated into the section's own `descriptions` string.
 */
export const SECTION_NOTICE = `${BRIDGE_DISCLOSURE} ${BRIDGE_RESTART_LIMIT} ${BRIDGE_NOT_LOST}`

/** The declared section shape: cloned per registration, with the slot options replaced by the catalog projection. */
export const SETTINGS_SECTION: TuiSettingsSectionLike = {
  // THE SECTION IS KEYED BY THE ENTRY, not by the namespace.
  //
  // MEASURED on a live boot (docker/ui, 2026-09-27): the settings machinery is keyed by the loader
  // entry — `entry.options.id = "mpd-config"`, and `settings.describe()` reports it under
  // `ns = "mpd-config"` — while this section declared `ns = "mpd"`, a namespace no entry has. The
  // screen bound no value for any of its 25 rows and rendered `（未设置）` for all of them. The Web
  // front door had the same defect and the same fix (`configForms.get("mpd-config")`).
  ns: SETTINGS_ENTRY,
  // The section header the host draws. `title` is the English fallback AND the string every
  // non-localized reader (a log line, a test, an older host) still gets, so the two halves stay in
  // sync by construction: the en description IS this title.
  title: "MPD bundle",
  // The section's own description carries the disclosure ONCE; the 25 rows carry their own
  // sentences and their keys. Because `title` is the section header the host draws, the sentence a
  // reader needs before touching any knob belongs here and nowhere else — in BOTH languages, since
  // the host resolves `descriptions` with its own active language (`pick()`).
  descriptions: { zh: `MPD 插件包 · ${SECTION_NOTICE}`, en: `MPD bundle · ${SECTION_NOTICE}` },
  fields: SETTINGS_FIELDS,
}

/**
 * The catalog reader the section uses: the MOUNTED adapter when this row is composed,
 * else a standalone adapter over the SAME ctx.
 *
 * A standalone adapter still reads the host's `llm` service directly, so a transient
 * `mpdDsh` miss (rows are applied concurrently, cordis answers `undefined` for a
 * non-ACTIVE provider) cannot cost the section its live options. An adapter that predates
 * the `llmCatalog` seam simply reports no catalog, which is the declared-fallback branch.
 *
 * EXPORTED because the `/mpd-model` pick-list must read the catalog through the same
 * resolution: two readers could name different providers, which is the drift the menu's
 * whole contract forbids. The type is DERIVED from the adapter's own surface (only the three
 * members this package consumes), so it cannot drift from a hand-written copy of it — and each
 * member stays OPTIONAL, because that is what makes a partial double (a catalog and nothing
 * else) a legal override in a test.
 */
export type CatalogReadSeam = Partial<Pick<DshAdapter, "llmCatalog" | "settingsReader" | "settingsMutate">>

/** Resolve the shared catalog/settings read-write seam; see the doc comment above. */
export function resolveCatalogReader(ctx: PluginContextLike): CatalogReadSeam {
  try {
    /** The mounted adapter, when this row can read it. */
    const mounted = serviceOf<CatalogReadSeam>(ctx, "mpdDsh")
    if (mounted !== undefined) return mounted
  } catch {
    // fall through to a standalone adapter
  }
  return createDshAdapter(ctx)
}

/**
 * Activate the settings namespace and the `/settings` section.
 * @param ctx - the plugin context; the host records it as each registration's identity.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param adapterOverride - the adapter to read the model catalog through; when omitted the
 *   mounted `mpdDsh` is resolved here, with a standalone adapter over the same ctx as the
 *   fallback (it still reads the host's `llm` service, so a transient `mpdDsh` miss costs
 *   nothing but the mounted instance's config).
 * @returns the seam handle; the section outcome carries the namespace result too.
 */
export function registerSettingsSection(
  ctx: PluginContextLike,
  tui: TuiAdapter,
  log: Log,
  adapterOverride?: CatalogReadSeam,
): { outcome(): SeamOutcome } {
  /** The namespace registration result, folded into the section outcome. */
  let namespace: { state: SeamState; detail?: string } = { state: "absent", detail: "settings was not injected" }
  /** The section result this file measured; `undefined` until a path decides it. */
  let section: { state: SeamState; detail?: string } | undefined
  /** The adapter whose `llmCatalog()` supplies the slot options. */
  const catalogReader = adapterOverride ?? resolveCatalogReader(ctx)

  // 1) Namespace: a GUARDED FALLBACK (design §10.1). `mpd-config-plugin` owns the registration,
  //    because only it can serve the file-derived `base`. This package registers ONLY when the
  //    namespace is genuinely unserved — duplicate registration fails loud on this host
  //    (`dsh-settings` `register()` throws `settings namespace "<ns>" is already registered`), so
  //    the probe below is the guard that keeps the two owners from colliding.
  tui.whenBound("settings", (service, _scope, handle) => {
    /** The bound service as the settings provider, before `register` is trusted. */
    const provider = service as SettingsProviderLike
    if (typeof provider?.register !== "function") {
      namespace = { state: "refused", detail: "settings.register is missing" }
      handle.record(namespace)
      return
    }
    // DETERMINISTIC owner check first: `mpd-config` provides the `mpdConfig` service, and a service
    // is visible to `ctx.get` once its provider's fiber is active. This row mounts AFTER the config
    // plugin, so its presence means the owner IS in this composition and will register the moment
    // the settings provider is up — the fallback must not race it (MEASURED in a real boot: both
    // plugins parked on `ctx.inject(["settings"])` and the fallback won, leaving the namespace with
    // no file-derived base).
    if (configPluginPresent(ctx)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is owned by mpd-config in this composition — the fallback registration was skipped` }
      log.info(`settings namespace ${SETTINGS_NS}: mpd-config owns the registration — fallback skipped (design §10.1)`)
      handle.record(namespace)
      return
    }
    if (isServed(provider)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is already served by mpd-config — the fallback registration was skipped` }
      log.info(`settings namespace ${SETTINGS_NS} is already served — fallback registration skipped (design §10.1)`)
      handle.record(namespace)
      return
    }
    /** The adapter's handle for this one registration; the host call itself happened there. */
    const registered = tui.registerSettingsNamespace(SETTINGS_NS, SettingsSchema, { applies: "restart" })
    /** What that registration measured. */
    const measured = registered.outcome()
    namespace =
      measured.state === "requested"
        ? { state: "requested", detail: `namespace ${SETTINGS_NS} requested by the fallback (no other registrant) (no host read-back)` }
        : { state: measured.state, detail: measured.detail }
    handle.record(namespace)
    if (namespace.state === "refused") log.warn(`settings namespace ${SETTINGS_NS} not registered: ${namespace.detail ?? ""}`)
  })

  // 2) Section: the mpd.jsonc fields. The twelve team-model slot knobs carry CATALOG-DERIVED
  //    options, and the host DEEP-FREEZES the option list at register time (it renders
  //    `select` by cycling that frozen list) — so the catalog is read BEFORE register, and
  //    because that read is async the registration is deferred by one microtask chain
  //    instead of registering the declared list first and never correcting it. The host
  //    registry is built for exactly this: `register()`/`subscribe()` are its
  //    late-registration seam ("a plugin (un)loading mid-session changes the list") and the
  //    screen re-reads the section list on every change event.
  //
  //    The adapter resolves this THUNK when the seam binds, which is what keeps the read from
  //    racing the frozen option list; this file still owns WHAT the section says.
  /** The section seam handle; its id is the adapter's, so this file names no seam. */
  const sectionHandle = tui.registerSettingsSection(async (): Promise<TuiSettingsSectionLike> => {
    /** The catalog the slot options are derived from; undefined means the declared fallback. */
    let catalog: DshLlmCatalog | undefined
    try {
      catalog = await catalogReader.llmCatalog?.()
    } catch {
      // A reader that throws is the same as an unavailable catalog: declared fallback.
      catalog = undefined
    }
    /** The projected option lists, plus which branch produced each leaf. */
    const lists = teamModelOptionLists(catalog)
    // The see-before-you-edit summary (R3): read from the LIVE `mpdConfig` service AT REQUEST TIME,
    // so every `/settings` open shows the effective routes as of now — after a save, after a
    // watched file edit — and never a stale mount-time copy.
    /** The effective-model-config summary carried by this request's section description. */
    const summary = effectiveModelSummary(configServiceOf(ctx))
    // The A4 measurement line: WHICH branch produced each leaf's option list.
    log.info(`settings section ${SETTINGS_NS} slot options: provider=${lists.source.provider}(${lists.provider.length})`
      + ` model=${lists.source.model}(${lists.model.length})`
      + ` reasoningEffort=${lists.source.reasoningEffort}(${lists.reasoningEffort.length})`
      + ` catalog=${catalog === undefined ? "unavailable" : catalog.degraded === true ? "degraded" : "live"}`)
    section = { state: "requested", detail: `section ${SETTINGS_NS} requested (no host read-back; slot options ${lists.source.provider}/${lists.source.model}/${lists.source.reasoningEffort})` }
    return {
      ...SETTINGS_SECTION,
      fields: settingsFields(lists),
      // The section's own description: the disclosure BOTH front doors state, PLUS the effective
      // summary — the one prose surface a TUI section has, so it is where R3's values render.
      descriptions: { zh: `MPD 插件包 · ${SECTION_NOTICE} · ${summary.zh}`, en: `MPD bundle · ${SECTION_NOTICE} · ${summary.en}` },
    }
  }, ctx)

  return {
    outcome: (): SeamOutcome => {
      /** What the adapter measured for the section seam (its own id and, on a refusal, its reason). */
      const measured = sectionHandle.outcome()
      // A REFUSAL always wins: it is the registration's measured truth, while `section` may still
      // hold the pre-registration state this file recorded.
      /** The section state this outcome reports. */
      const chosen = measured.state === "refused" ? { state: "refused" as const, detail: measured.detail } : (section ?? { state: measured.state, detail: measured.detail })
      return {
        id: measured.id,
        state: chosen.state,
        detail: `${chosen.detail ?? ""} · namespace ${SETTINGS_NS}: ${namespace.state}${namespace.detail === undefined ? "" : ` (${namespace.detail})`}`,
      }
    },
  }
}
