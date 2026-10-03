// Seam 6 — `ctx.tuiSettingsSections`: the `/settings` section of the mpd bundle.
//
// DISCLOSURE (read before trusting the writes): the fields below are the real
// `.mpd/mpd.jsonc` knobs — the runtime config layer the mpd plugins read through
// `packages/mpd-config-plugin`. That layer is NOT the harness settings document
// this screen writes to: the section declares and edits those knobs under the
// harness settings namespace `mpd`, and the two are BRIDGED (t35): `mpd-config`
// observes the namespace through the adapter's settings seam and rewrites the value
// into `<workspace>/.mpd/mpd.jsonc` with comments and key order preserved. The
// settings value is visible to the config layer immediately, while a RUNNING
// session's plugin behaviour changes only after a restart — every knob in this
// section is captured at plugin mount (design §D.1).
//
// T-18 HOST LIMITATION (the honest half, also rendered by the Web card as its second
// disclosure paragraph and exported as `BRIDGE_RESTART_LIMIT` from the shared schema):
// the FILE-derived base is read once at plugin mount and stays fixed for the process
// lifetime, so a hand edit of `.mpd/mpd.jsonc` applies at the next dsh boot and never
// mid-process. Only a change made through the settings document can reach a RUNNING
// plugin, and only where the plugin subscribes to the host's settings-document update
// (the watchdog engine does, `engine.ts` `onSettingsDocumentUpdated`); this change does
// not prove that seam is exposed on the installed host, so no surface claims a live
// reload — the per-field hints state the restart truth, and `BRIDGE_RESTART_LIMIT` carries
// the limitation on the Web card (this pane keeps its one-line hints free of it so the
// restart disclosure and the "never lost" clause stay legible).
//
// The disclosure is not only in this header and the READMEs — it is carried by
// the RENDERED METADATA too (t21): every field hint names its mpd.jsonc key and
// then states the marker, so a user reading `/settings` learns it at the point of
// use. The marker is a single exported constant and the hints are built by one
// helper, so it cannot be dropped from a field silently (test/plugin.test.ts
// asserts it on the registered section).
//
// The namespace registration exists so the screen treats the section as
// available (an unregistered namespace is rendered as unavailable by design).
// `z` comes from the bundle's already-vendored schemastery copy. Same directory
// specifier rule as `index.ts`.
import type { PluginContextLike, SeamOutcome, SeamState, SettingsProviderLike, TuiAdapter, TuiSettingsFieldLike, TuiSettingsSectionLike } from "./types.js"
// ONE source for the namespace schema, the twenty-two knobs and the disclosure: `mpd-config-plugin`
// owns the namespace (design §10.1) and exports them; this package consumes them for its
// guarded FALLBACK registration and for the section it declares.
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, SettingsSchema, SETTINGS_KNOBS, SETTINGS_NS, TEAM_MODEL_FALLBACK_OPTIONS } from "../../mpd-config-plugin/src/settings-schema"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { Log } from "./log.js"
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

/**
 * The runtime notice the surfaces show when the save had no live session workspace to
 * write to (design §D.2 "no live root at save time"). Exported so the same sentence is
 * used by every surface that reports a save outcome.
 */
export const BRIDGE_NO_WORKSPACE_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * One field hint, HUMAN SENTENCE FIRST: the knob's own human sentence (what it is and what
 * configuring it does) leads, then the real mpd.jsonc key PLUS both on-screen statements — the
 * bridge+restart truth AND the clause that keeps a settings-only save from reading as a lost one
 * (captain's ruling 1: with 0 or N live roots the value persists in the host settings document and
 * the read-in layer applies it to every workspace immediately). A knob with no human sentence
 * (every knob but the twelve team-model slot leaves) keeps the disclosure-only hint byte-for-byte.
 */
function knobHint(key: string, semantics?: string): string {
  // The ROW hint is the knob's own sentence plus its dotted key. The bridge disclosure is stated
  // ONCE, in the section's own description (see SETTINGS_SECTION below) — inlining it per row is
  // what made 25 rows read as the same four lines (measured in docker/ui, `05b-mpd-section.png`).
  const pointer = `mpd.jsonc ${key}`
  return semantics === undefined || semantics.length === 0 ? pointer : `${semantics} (${pointer})`
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
type TeamModelLeaf = (typeof TEAM_MODEL_LEAVES)[number]

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
 * One knob's field metadata with its DECLARED options (the shared schema's lists).
 *
 * Every field is built here, so the thirteen non-slot knobs keep their paths, kinds and
 * labels byte-for-byte whatever the catalog says, and `SETTINGS_FIELDS` (the declared
 * baseline this package exports) and the registered section cannot drift apart.
 */
function declaredField(knob: (typeof SETTINGS_KNOBS)[number]): TuiSettingsFieldLike {
  return {
    path: [...knob.path],
    label: knob.label,
    descriptions: { zh: knob.zh },
    hint: knobHint(knob.path.join("."), knob.semantics),
    kind: knob.kind,
    ...(knob.options === undefined ? {} : { options: knob.options.map((value) => ({ value, label: value })) }),
  }
}

/** The declared field list: every knob with its declared options (the pre-catalog baseline). */
export const SETTINGS_FIELDS: readonly TuiSettingsFieldLike[] = SETTINGS_KNOBS.map(declaredField)

/**
 * The field list the section is REGISTERED with: {@link declaredField} for every knob,
 * with the three leaves of each team-model slot replaced by {@link teamModelOptionLists}.
 * A slot field is therefore always a `select` with a non-empty option list.
 */
export function settingsFields(lists: TeamModelOptionLists): readonly TuiSettingsFieldLike[] {
  return SETTINGS_KNOBS.map((knob) => {
    /** The slot leaf this knob addresses, undefined for the thirteen non-slot knobs. */
    const leaf = slotLeafOf(knob.path)
    /** The knob's declared field, before any slot options are applied. */
    const field = declaredField(knob)
    return leaf === undefined ? field : { ...field, options: lists[leaf] }
  })
}

/**
 * The section this plugin declares.
 *
 * Every `hint` is built by {@link knobHint} and therefore carries
 * {@link BRIDGE_DISCLOSURE}: the user reading `/settings` learns at the point of
 * use that an edit here is written to the workspace file AND that its behaviour
 * change waits for a restart. The twelve team-model slot hints additionally LEAD with the
 * knob's own human sentence (which member group the slot routes and what configuring it
 * does) from the shared declaration (`knob.semantics`); the label carries the group name.
 *
 * This is the DECLARED shape (cloned per registration, with the slot options replaced by
 * the catalog projection). It is exported so the declared baseline stays inspectable.
 */
/** The one-sentence disclosure BOTH front doors state once, above their rows. */
export const SECTION_NOTICE = `${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`

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
  title: "MPD bundle",
  // The section's own description carries the disclosure ONCE; the 25 rows carry their own
  // sentences and their keys. `title` is the section header the host draws, so the sentence a
  // reader needs before touching any knob belongs here and nowhere else.
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
 */
function resolveCatalogReader(ctx: PluginContextLike): { llmCatalog?: () => Promise<DshLlmCatalog> } {
  try {
    /** The mounted adapter, when this row can read it. */
    const mounted = serviceOf<{ llmCatalog?: () => Promise<DshLlmCatalog> }>(ctx, "mpdDsh")
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
  adapterOverride?: { llmCatalog?: () => Promise<DshLlmCatalog> },
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
    // The A4 measurement line: WHICH branch produced each leaf's option list.
    log.info(`settings section ${SETTINGS_NS} slot options: provider=${lists.source.provider}(${lists.provider.length})`
      + ` model=${lists.source.model}(${lists.model.length})`
      + ` reasoningEffort=${lists.source.reasoningEffort}(${lists.reasoningEffort.length})`
      + ` catalog=${catalog === undefined ? "unavailable" : catalog.degraded === true ? "degraded" : "live"}`)
    section = { state: "requested", detail: `section ${SETTINGS_NS} requested (no host read-back; slot options ${lists.source.provider}/${lists.source.model}/${lists.source.reasoningEffort})` }
    return { ...SETTINGS_SECTION, fields: settingsFields(lists) }
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
