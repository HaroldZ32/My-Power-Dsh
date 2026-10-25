// mpd settings section — the browser half of the `mpd` settings namespace (t35; moved to its own
// top-level section by w14/t83 at the user's request: "web的设置栏请单开一栏MPD设置，别混在插件栏里").
//
// WHERE THIS MOUNTS: its OWN top-level `MPD` section of the Web settings dialog. The same
// mpd.jsonc knobs (thirteen scalar knobs and the twelve team-model slot leaves) used to ride the
// Plugins tab's keyed per-namespace item slot; this file no longer
// registers anything there, so the Plugins tab shows no mpd card.
//
// THE PATTERN IS THE HOST'S OWN, MEASURED in the host's settings-models section
// (`@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:2936-2952`):
//   • `ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section",
//     id, order, label: () => t("nav"), inject, children }, Component))` — the settings shell
//     collects that LIST slot (`ctx.slots.entries("settings.section")`, sorted by `order`) and
//     renders the ACTIVE one (`dsh-client-ui-settings/lib/client.js:561-572`, `:167`);
//   • `label` is a FUNCTION resolved through the registration's locale dictionaries, so the nav
//     text lives in the `mpdSettings` dictionaries below (key `nav`);
//   • the host's own sections are `general` 0, `models` 10 and `plugins` 15; this section takes
//     `order: 20`, i.e. AFTER them, so no existing section moves;
//   • `children` is DELIBERATELY OMITTED: this section renders no nested slot (the host's `models`
//     section declares its provider card + footer there; ours has none), which is a declared
//     absence rather than a copy of their list;
//   • the component receives `{ t, edit, resetField, save, discard, use<X>Card }`, where `t` comes
//     from the registered `locale` dictionaries and `use<X>Card` is the hook the registration's
//     `inject()` result provides;
//   • the write goes through the PUBLIC client seam `ctx.configForms.get(namespace)`, whose
//     actions are `set`/`unset`/`mutate(ops, expectedRevision)` — i.e. the `settings/mutate` RPC
//     the bridge consumes. The client performs NO filesystem I/O and cannot.
// The host's `PluginCard`/`ValueField` are that package's PRIVATE components and are NOT imported
// here: this component is self-contained markup.
//
// WHAT IS CLAIMED (recorded in the lane/evidence): the registration is present in the BUILT and
// SERVED client, and the write path it drives (settings namespace -> bridge ->
// `<workspace>/.mpd/mpd.jsonc`) is proven by `web-settings-bridge.mjs` over the host's own
// authenticated API. WHAT IS NOT CLAIMED: that a browser renders this section or that a click
// produces the mutate — no browser exists in this environment; the user sees that in their own GUI.
//
// Labels/hints/zh descriptions are MIRRORED from the TUI section
// (`packages/mpd-tui-plugin/src/settings.ts`) and a test asserts the two lists stay identical, so
// the two front doors cannot drift.
//
// This file is a FACTORY BODY, not a module: the whole file is ONE arrow-function expression, which
// `scripts/build-mpd-client.ts` splices twice (as its own client module and as an IIFE inside the
// applied web client). Every type it needs is therefore declared INSIDE the factory: the file has
// no top-level import/export, no top-level type declaration, and nothing after its final `}`.
(require: (id: string) => unknown) => {
  /** The settings namespace this section edits (the `mpd` namespace of the settings document). */
  const NS = "mpd"
  /**
   * THE ENTRY the harness's settings machinery serves, which is NOT the namespace.
   *
   * MEASURED on a live boot (docker/ui, 2026-09-27): the loader gives the row
   * `entry.options.id = "mpd-config"` (its `entry.id` is the address `include:mpd-config`, and
   * `settings.describe()` reports it under `ns = "mpd-config"`). `configForms.get(ns)` resolves with
   * `entries().find(row => row.options.id === ns)` and THROWS `No configurable plugin entry "mpd"` for
   * a namespace no entry has — which is why every input on this card rendered empty.
   */
  const CONFIG_ENTRY = "mpd-config"
  /** The locale namespace the section's own labels live in. */
  const LOCALE_NS = "mpdSettings"
  /** The LIST slot the settings shell renders as top-level sections. */
  const SECTION_SLOT = "settings.section"
  /** This section's stable id (the shell keys the active section by it). */
  const SECTION_ID = "mpd"
  /** After `general` 0, `models` 10 and `plugins` 15 — so no existing section moves. */
  const SECTION_ORDER = 20
  /**
   * The bundle's server route serving the CURRENT EFFECTIVE model config from the `mpdConfig`
   * service (R3): the four slot STATES and the configured `modelchain` chains. Registered by `packages/mpd-bundle-plugin/src/model-config-web.ts`
   * on the host's web server; this card fetches it at mount, after card saves and on
   * settings-scope updates, and degrades to the settings document alone when the route is absent
   * (a webless profile).
   */
  const MODEL_CONFIG_PATH = "/plugins/mpd/model-config"

  /**
   * The disclosure both front doors state (byte-identical to the TUI's BRIDGE_DISCLOSURE and to the
   * shared schema's). REWORDED by wave fix/model-config-live-refresh: the config service now
   * re-resolves on every settings save (entry-config subscription) and on a watched edit of the
   * project file, and the model routes are read per use — so the old "takes effect … after a
   * restart" claim is deleted, not softened; a hint that kept it would be a lie.
   */
  const BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect in the RUNNING process — no restart: the config service re-resolves on every settings save and on a watched edit of the project file, and the model routes (teamModels, modelchain) are read per use, so the next spawn or resolve carries them"
  /**
   * The RESTART half of the truth (byte-identical to
   * `packages/mpd-config-plugin/src/settings-schema.ts` `BRIDGE_RESTART_LIMIT`) and rendered as the
   * card's second disclosure paragraph. What still waits for a boot after the live-refresh wave is
   * exactly one class of knob — one some plugin CAPTURED at its own mount instead of reading the
   * live config service per use — and the model routes this card edits are not such knobs; the
   * sentence says so instead of claiming the blanket restart the old text did.
   */
  const BRIDGE_RESTART_LIMIT = "the restart wording now applies only to a knob some plugin captured at its own mount instead of reading the live config service per use — the model routes above are not such knobs; a captured knob keeps its captured value until the next dsh boot"
  /** The third disclosure paragraph: what a save means when no session is live. */
  const NO_WORKSPACE_NOTICE = "if no session is live, the save stays in settings — not written to any .mpd/mpd.jsonc"
  // The clause that keeps a settings-only save from reading as a lost one (same sentence the TUI
  // hint and the status line carry).
  /** The not-lost clause rendered under the two disclosures. */
  const NOT_LOST = "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session"

  // ── types for the seams this factory crosses ────────────────────────────────
  /** The subset of React this card uses; the host injects the real module at boot. */
  interface ReactSurface {
    /** Create one element; `props` is null for a props-less element and children follow variadically. */
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
  }

  /** The event shape a text input or select hands its change handler. */
  interface ChangeEvent {
    /** The element the change came from, read only for its current value. */
    target: { value: string }
  }

  /** One knob the card renders (the mirror of the ONE shared knob declaration in settings-schema.ts). */
  interface FieldDescriptor {
    /** The dotted path of the knob inside the `mpd` namespace (the slot leaves are three deep). */
    path: string[]
    /** The English label. */
    label: string
    /** The Simplified-Chinese label. */
    zh: string
    /** The control kind: `number`, `boolean`, `select` or `text`. */
    kind: string
    /** The DECLARED option list of a select (the parity surface; the live list comes from the catalog). */
    options?: string[]
    /** The human sentence (what the knob is and what configuring it does), when it has one. */
    semantics?: string
    /** The same sentence in Simplified Chinese. */
    semanticsZh?: string
  }

  /** One leaf of a team-model slot, with the option list the parity contract declares for it. */
  interface SlotLeaf {
    /** The leaf name (`provider`, `model`, `reasoningEffort`). */
    leaf: string
    /** The English leaf label. */
    label: string
    /** The Simplified-Chinese leaf label. */
    zh: string
    /** The declared option list of the leaf's select. */
    options: string[]
  }

  /** The member group one slot routes (both locales, plus the member list the sentences interpolate). */
  interface SlotGroup {
    /** The English group name. */
    en: string
    /** The Simplified-Chinese group name. */
    zh: string
    /** The member names the English sentences interpolate. */
    members: string
    /** The member names the Chinese sentences interpolate. */
    membersZh: string
  }

  /** One localized sentence pair. */
  interface LocalizedText {
    /** The English sentence. */
    en: string
    /** The Simplified-Chinese sentence. */
    zh: string
  }

  /** One rendered option of a select (a `group` turns the list into optgroups). */
  interface FieldOption {
    /** The value written to the settings document. */
    value: string
    /** The human label rendered for it. */
    label: string
    /** The optgroup label, when the option belongs to a provider group. */
    group?: string
  }

  /** One catalog provider group, as the host's model-selection service projects it. */
  interface CatalogGroup {
    /** The provider id (the value the provider leaf writes). */
    id: string
    /** The provider's display name, when it has one. */
    name?: string
    /** The provider's models (a group without a list is filtered out before it reaches here). */
    models: CatalogModel[]
  }

  /** One catalog model. */
  interface CatalogModel {
    /** The model id (the value the model leaf writes). */
    id?: string
    /** The model's display name, when it has one. */
    name?: string
    /** The model's own reasoning efforts. */
    reasoning?: { efforts?: CatalogEffort[] }
  }

  /** One reasoning effort of one model (the runtime list is filtered for a usable id before use). */
  interface CatalogEffort {
    /** The effort id (the value the reasoning-effort leaf writes). */
    id: string
    /** The effort's display name, when it has one. */
    name?: string
  }

  /** The catalog state the card renders and announces. */
  interface CatalogInfo {
    /** `live` when the host's catalog answered, `fallback` otherwise. */
    mode: string
    /** How many providers the live catalog carries. */
    providers?: number
    /** How many models the live catalog carries. */
    models?: number
    /** The sentence stated with the state. */
    notice?: string
    /** Why the catalog is in fallback ("" when it is live). */
    reason?: string
    /** Whether this fallback is only the session list still enumerating (no warning yet). */
    pending?: boolean
  }

  /** The model directory of one session, as the host's service hands it over. */
  interface ModelDirectory {
    /** The directory's own snapshot store. */
    store?: {
      /** The store's current snapshot. */
      getSnapshot?: () => DirectorySnapshot | undefined
      /** Subscribe to the store; returns the unsubscribe function. */
      subscribe?: (listener: () => void) => () => void
    }
    /** Fetch the directory's catalog (a failed load keeps the last snapshot). */
    load?: () => unknown
  }

  /** The slice of a model-directory snapshot this card reads. */
  interface DirectorySnapshot {
    /** The provider groups the directory reports. */
    groups?: CatalogGroup[]
  }

  /** The host's model-directory service. */
  interface ModelDirectoryService {
    /** Resolve the directory of one session; throws for a session the host does not know. */
    directoryFor: (sessionId: string) => ModelDirectory | null | undefined
  }

  /** The client's session-list snapshot, as far as this card reads it. */
  interface SessionListSnapshot {
    /** The session ids (the MEASURED field). */
    ids?: unknown[]
    /** The session entries of another host build. */
    items?: Array<{ sessionId?: unknown; id?: unknown }>
    /** The snapshot's session map, keyed by session id. */
    byId?: Record<string, { blank?: boolean } | undefined>
    /** The session the app is showing: a plain string on the measured host, an object on older ones. */
    current?: string | { sessionId?: unknown; id?: unknown }
    /** The list's own phase (`ready` once enumeration finished). */
    phase?: string
  }

  /** The client's sessions service. */
  interface SessionsService {
    /** The session list and its store, when the service exposes one. */
    list?: {
      /** The list's current snapshot. */
      getSnapshot?: () => SessionListSnapshot | undefined
      /** Subscribe to the list; returns the unsubscribe function. */
      subscribe?: (listener: () => void) => () => void
    }
    /** Mint (or read) the scope of one session. */
    scope?: (id: string) => unknown
    /** Read the binding of one session. */
    binding?: (id: string) => unknown
  }

  /** The live model catalog the card follows. */
  interface LiveCatalog {
    /** Start the dynamic injection; false when the runtime exposes no `ctx.inject`. */
    start: () => boolean
    /** Release the directory, the subscriptions and the injection fiber. */
    dispose: () => void
    /** The catalog's current provider groups. */
    groups: () => CatalogGroup[]
    /** The catalog's current state. */
    info: () => CatalogInfo
    /** Subscribe to catalog changes; returns the unsubscribe function. */
    subscribe: (listener: () => void) => () => boolean
  }

  /** One control of one row, as `project()` renders it. */
  interface RowControl {
    /** The text the input shows. */
    text: string
    /** Whether the value is staged over the file/namespace value. */
    overridden?: boolean
    /** Whether the staged text is not a valid value for this knob. */
    invalid?: boolean
  }

  /** One staged edit of one row. */
  interface StagedEdit {
    /** The text the user typed. */
    text: string
    /** Whether the edit clears the knob instead of setting it. */
    clear?: boolean
  }

  /** A staged row's interpretation: a clear marker, a parsed value, or undefined for an invalid draft. */
  type ParsedEdit = { kind: string } | boolean | number | string | undefined

  /** One write a save would send (the harness's `settings/mutate` op). */
  interface WriteOp {
    /** `set` writes a parsed value, `unset` removes the knob. */
    op: "set" | "unset"
    /** The knob's path inside the namespace. */
    path: string[]
    /** The value to write, for a `set` op. */
    value?: unknown
  }

  /** The three disclosure strings the card states once at its top. */
  interface Disclosure {
    /** The bridge disclosure (a save writes the workspace's mpd.jsonc). */
    BRIDGE_DISCLOSURE: string
    /** The host's mount-time limitation. */
    BRIDGE_RESTART_LIMIT: string
    /** What a save means when no session is live. */
    NO_WORKSPACE_NOTICE: string
  }

  /** One slot's effect as the see-before-you-edit block renders it (R3): its state and its route. */
  interface EffectiveRoute {
    /** `configured` (a usable route), `unconfigured` (a required leaf is absent) or `invalid`. */
    status: "configured" | "unconfigured" | "invalid"
    /** The provider id in force; "" when the slot is not configured. */
    provider: string
    /** The model id in force; "" when the slot is not configured. */
    model: string
    /** The reasoning effort in force ("" when none is stated). */
    reasoningEffort: string
    /** The required leaves the slot is missing, in sentence order ([] when configured). */
    missing: string[]
    /** The offending path for an `invalid` state, e.g. `teamModels.slot4.model is not a string` (#4). */
    problem?: string
  }

  /**
   * The CURRENT EFFECTIVE model config the card renders above its rows (R3): the four slot states and
   * the configured `modelchain` entries. Read from the LIVE surfaces only — the settings form value
   * this card already binds, plus the `/plugins/mpd/model-config` route the bundle serves from the
   * `mpdConfig` service when a web server is composed — never a re-parse of mpd.jsonc, and never a
   * built-in default: an unconfigured slot renders `<unconfigured>` (contract §9).
   */
  interface EffectiveModelConfig {
    /** Which surface produced this projection: `service` (the live route answered) or `document` (the form value alone). */
    source: "service" | "document"
    /** The four slot states, keyed `slot1`…`slot4`. */
    slots: Record<string, EffectiveRoute>
    /** The configured `modelchain.<key>` chains ({} when the service route is unavailable). */
    modelchain: Record<string, Array<{ provider: string; model: string }>>
    /** Why the live service read is not behind this projection; "" when it is. */
    notice: string
  }

  /** The settings form's snapshot, as this card reads it. */
  interface ScopeSnapshot {
    /** The namespace's namespaced values. */
    value?: unknown
    /** The namespace's user-set values. */
    user?: unknown
    /** `ready` once the form has loaded. */
    status?: string
    /** Whether this page may write at all (false on a non-loopback page). */
    writable?: boolean
    /** The storage mode (`memory` on a non-loopback page). */
    mode?: string
    /** The revision the snapshot was read at (the mutate fence). */
    revision?: number
  }

  /** The per-namespace settings form this card drives. */
  interface SettingsScope {
    /** The form's current snapshot. */
    getSnapshot: () => ScopeSnapshot | undefined
    /** Subscribe to form changes (a scope without one throws, which the caller catches). */
    subscribe: (listener: () => void) => unknown
    /** Write staged ops with the revision fence. */
    mutate: (ops: WriteOp[], expectedRevision?: number) => unknown
    /** Release the form (a scope without one throws, which the caller catches). */
    dispose: () => void
  }

  /** The state the card component renders, published through its own store. */
  interface CardState {
    /** Whether the form has loaded. */
    available: boolean
    /** Whether this page may write. */
    writable: boolean
    /** The storage mode of the bound form. */
    mode: string
    /** Whether any row is staged. */
    dirty: boolean
    /** Whether any staged draft is invalid. */
    invalid: boolean
    /** Whether a save is in flight. */
    saving: boolean
    /** Whether the last save failed. */
    failed: boolean
    /** The last failure's message. */
    error: string
    /** Every row's control, keyed by the row's dotted knob key. */
    controls: Record<string, RowControl>
    /** The disclosure strings this render states at the top. */
    disclosure: Disclosure
    /** The catalog state this render used. */
    catalog: CatalogInfo
    /** The current effective model config this render shows above the rows (R3). */
    effective: EffectiveModelConfig
  }

  /** The store the card's hook reads (a minimal snapshot store, not the host's private one). */
  interface CardStore {
    /** The current state. */
    getSnapshot: () => CardState
    /** Subscribe a component; returns the unsubscribe function. */
    subscribe: (listener: () => void) => () => boolean
    /** Replace the state and wake every subscriber. */
    set: (next: CardState) => void
  }

  /** The face the slot registration injects into the component. */
  interface CardFace {
    /** The hook store the component reads its state from. */
    hooks: { mpdCard: CardStore }
    /** Stage one row's text. */
    edit: (key: string, text: string) => void
    /** Clear one row back to the file value. */
    resetField: (key: string) => void
    /** Save every staged edit. */
    save: () => void
    /** Discard every staged edit. */
    discard: () => void
  }

  /** The controller behind that face. */
  interface CardController {
    /** Build the face (the registration's `inject()` result). */
    inject: () => CardFace
    /** The card's own store (re-projected after an external change). */
    store: CardStore
    /** Re-project after an external change (the live catalog). */
    refresh: () => void
    /**
     * Publish one live-service read (R3): the `/plugins/mpd/model-config` body, or a notice for why
     * the read is not behind the projection. Stored and re-projected; never throws.
     */
    setLiveService: (body: unknown, notice: string) => void
    /** Release the bound scope. */
    dispose: () => void
  }

  /** The props the slot registration hands the card component. */
  interface CardComponentProps {
    /** The hook the registration's `inject()` result provides (a selector store hook). */
    useMpdCard: (selector: (snapshot: CardState) => CardState) => CardState
    /** The translator resolved through the registration's locale dictionaries. */
    t?: (key: string) => string
    /** Stage one row's text. */
    edit: (key: string, text: string) => void
    /** Clear one row back to the file value. */
    resetField: (key: string) => void
    /** Save every staged edit. */
    save: () => void
    /** Discard every staged edit. */
    discard: () => void
  }

  /** The harness's per-namespace settings forms service. */
  interface SettingsFormsService {
    /** Resolve the form of one configurable ENTRY id. */
    get: (namespace: string) => SettingsScope | undefined
  }

  /** The client context this card is mounted with (only the members it touches are named). */
  interface CardContext {
    /** The slot registry (required: the mount's first guard probes it). */
    slots: {
      /** Run a factory when the named slot is collected (the factory may be a generator). */
      inject: (slot: string, factory: unknown) => unknown
      /** Register one entry inside that factory; returns the unregister function. */
      register: (spec: Record<string, unknown>, component: unknown) => () => void
    }
    /** Declare service dependencies dynamically (never a declared dependency: see mountSettingsCard). */
    inject: (services: string[], callback: (scoped: CardContext) => unknown) => { dispose?: () => void } | null
    /** The locale registry (registered softly: an absent one is not fatal). */
    locale?: { register?: (namespace: string, dictionaries: unknown) => unknown }
    /** Resolve a service by name (a stub context serves services this way). */
    get?: (name: string) => unknown
    /** The settings forms, when the context exposes the service directly. */
    configForms?: SettingsFormsService
  }

  /** The mount options (the offline harness pins its own field list). */
  interface MountOptions {
    /** The knob list to render, when a caller pins one. */
    fields?: FieldDescriptor[]
    /**
     * The entry's JSON reader for the live-service half of the effective block (R3): the card
     * itself does NO I/O (a pin of this module's isolation), so the CLIENT ENTRY — the one module
     * allowed to reach the network — hands its reader in here. Absent (the offline harness, a
     * webless embedder), the block degrades to the settings-document branch and says so.
     */
    fetchJson?: (url: string) => Promise<unknown>
  }

  /**
   * The twenty-six knobs — the SAME fields the TUI `/settings` section declares (the thirteen
   * scalar knobs, the twelve team-model slot leaves and the TUI surface's own knob). The composed
   * hint LEADS with the knob's human sentence (`semantics`/`semanticsZh`) and then states its
   * mpd.jsonc key, exactly as the TUI builds it; a scalar knob keeps its declared metadata (the two
   * watchdog rows carry the sentence they always had). The slot leaves take their option lists from
   * the live catalog at render time instead. The per-member `agentRoutes` rows are GONE with the
   * table itself (contract `.mpd/plans/slot-single-source.md` §3).
   */
  /** The four team-model slots, in the order the card renders them. */
  const SLOT_SLOTS = ["slot1", "slot2", "slot3", "slot4"]
  /** The three leaves every slot carries, with their declared option lists. */
  const SLOT_LEAVES: ReadonlyArray<SlotLeaf> = [
    { leaf: "provider", label: "provider", zh: "提供商", options: ["deepseek-official"] },
    { leaf: "model", label: "model", zh: "模型", options: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"] },
    { leaf: "reasoningEffort", label: "reasoning effort", zh: "推理强度", options: ["off", "low", "high", "max"] },
  ]
  /**
   * What each slot IS — the member group it routes, in the group's own order (mirror of
   * `TEAM_MODEL_SLOT_GROUPS`). The group name and the member list are the only inputs the twelve
   * shared human sentences interpolate, so the card cannot drift from the declaration by accident:
   * the parity test compares every sentence and heading below with the shared declaration's own
   * builders. Slot 4 carries its OWN sentences/impact (an image-input constraint, not a
   * shared-route one), mirrored from `TEAM_MODEL_SLOT_LEAF_OVERRIDES` / `…_IMPACT_OVERRIDES`.
   */
  const SLOT_GROUPS: Record<string, SlotGroup> = {
    slot1: { en: "heavy members", zh: "重推理成员", members: "Architect, Planner, Reviewer, Lead, Senior Engineer", membersZh: "Architect、Planner、Reviewer、Lead、Senior Engineer" },
    slot2: { en: "analysis members", zh: "分析型成员", members: "Researcher, Explorer, Plan Reviewer", membersZh: "Researcher、Explorer、Plan Reviewer" },
    slot3: { en: "execution members", zh: "执行型成员", members: "Deep Worker, Junior Engineer", membersZh: "Deep Worker、Junior Engineer" },
    slot4: { en: "vision member", zh: "视觉成员", members: "Vision Analyst", membersZh: "Vision Analyst" },
  }
  /** The one-line impact under a slot's group heading (the shared text for slots 1-3). */
  const SLOT_IMPACT: Record<string, string> = {
    en: "When a team is created these members start on this slot's provider · model · reasoning effort; an unusable value fails team creation loudly, naming the member and the slot.",
    zh: "建队时这些成员默认用本档的 提供商 · 模型 · 推理强度 启动；填错会让建队直接失败并点名成员与槽位。",
  }
  /** The vision slot's OWN impact line (mirror of `TEAM_MODEL_SLOT_IMPACT_OVERRIDES.slot4`). */
  const SLOT_IMPACT_OVERRIDES: Record<string, Record<string, string>> = {
    slot4: {
      en: "When a team is created Vision Analyst starts on this slot's provider · model · reasoning effort; the model here MUST accept image input or image analysis fails; an unusable value fails team creation loudly, naming the member and the slot.",
      zh: "建队时 Vision Analyst 默认用本档的 提供商 · 模型 · 推理强度 启动；本档的模型必须支持图像输入，否则看图任务会失败；填错会让建队直接失败并点名成员与槽位。",
    },
  }
  /** Slot 4's OWN leaf sentences (mirror of `TEAM_MODEL_SLOT_LEAF_OVERRIDES.slot4`). */
  const SLOT_SENTENCE_OVERRIDES: Record<string, Record<string, LocalizedText>> = {
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
        en: "This slot's reasoning effort (off / low / high / max). It sets how much Vision Analyst thinks while reading an image. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot. EXCEPTION: a model whose catalog entry declares no reasoning efforts at all is sent none — its call still runs.",
        zh: "这一档的推理强度（off / low / high / max）。决定 Vision Analyst 读图时的思考深度。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。例外：若该模型的目录条目完全没有推理等级，则不发送任何等级——调用照常。",
      },
    },
  }
  /** The impact line of ONE slot: the slot's own override, else the shared sentence. */
  const impactOf = (slot: string, lang: string): string => (SLOT_IMPACT_OVERRIDES[slot] ?? SLOT_IMPACT)[lang]
  /** The HUMAN sentence of one slot leaf in both locales: what it IS, then what configuring it DOES. */
  function slotSentence(slot: string, leaf: string): LocalizedText {
    /** The slot's own override table, when it has one. */
    const override = SLOT_SENTENCE_OVERRIDES[slot]
    if (override !== undefined) return override[leaf]
    /** The member group this slot routes. */
    const group = SLOT_GROUPS[slot]
    if (leaf === "provider") {
      return {
        en: `The provider half of this slot. The slots are the default model route of team members: when a team is created, the ${group.en} (${group.members}) start on this slot's provider + model + reasoning effort. What changing it does: those members take the new route at the next team creation, and an unusable value makes team creation FAIL loudly, naming the member and the slot — it never silently substitutes another model. Vision Analyst is the vision member: slot 4 drives it.`,
        zh: `这一档的提供商。各槽位合起来是 team 成员的默认模型路由：建队时，${group.zh}（${group.membersZh}）会按本档的 提供商+模型+推理强度 启动。改它的影响：这些成员下次建队即走新路由；填成不可用会让建队直接失败并点名成员与槽位，不会静默换模型。Vision Analyst 是视觉成员：由槽位 4 驱动。`,
      }
    }
    if (leaf === "model") {
      return {
        en: `This slot's model. Together with the provider above, it decides the model the ${group.en} (${group.members}) start on. What changing it does: same as above — effective at the next team creation; a model the provider does not offer makes team creation fail with the member and slot named.`,
        zh: `这一档的模型。与上面的提供商共同决定 ${group.zh}（${group.membersZh}）建队时使用的模型。改它的影响：同上，下次建队生效；模型与提供商不匹配、或该提供商没有这个模型时，建队会点名失败。`,
      }
    }
    return {
      en: `This slot's reasoning effort (off / low / high / max). It sets how much the ${group.en} (${group.members}) think when a team is created: max is the strongest, high the usual balance, low cheaper, off disables reasoning. What changing it does: effective at the next team creation; an effort the chosen model does not support fails team creation and names this slot. EXCEPTION: a model whose catalog entry declares no reasoning efforts at all is sent none — its call still runs.`,
      zh: `这一档的推理强度（off / low / high / max）。它决定 ${group.zh}（${group.membersZh}）建队时的思考深度：max 最强、high 是常规平衡、low 更省、off 关闭思考。改它的影响：下次建队生效；该模型不支持的等级会在建队时报错并点名本槽位。例外：若该模型的目录条目完全没有推理等级，则不发送任何等级——调用照常。`,
    }
  }
  /** The group heading a slot renders above its three rows, e.g. `Slot 2 — analysis members (…)`. */
  function slotHeading(slot: string, index: number): LocalizedText {
    /** The member group this slot routes. */
    const group = SLOT_GROUPS[slot]
    return { en: `Slot ${index} — ${group.en} (${group.members})`, zh: `槽位 ${index} —— ${group.zh}（${group.membersZh}）` }
  }
  /** The twelve slot rows: the same order, paths and DECLARED option lists as the shared declaration. */
  const SLOT_FIELDS: FieldDescriptor[] = SLOT_SLOTS.flatMap((slot, index) => SLOT_LEAVES.map(({ leaf, label, zh, options }) => {
    /** The slot leaf's own human sentence, which the row's hint leads with. */
    const sentence = slotSentence(slot, leaf)
    return {
      path: ["teamModels", slot, leaf],
      label: `Slot ${index + 1} ${label} (${SLOT_GROUPS[slot].en})`,
      zh: `槽位 ${index + 1} ${zh}（${SLOT_GROUPS[slot].zh}）`,
      kind: "select",
      options,
      semantics: sentence.en,
      semanticsZh: sentence.zh,
    }
  }))

  /** Every knob the card renders, in the shared declaration's order (the deleted `agentRoutes` rows are gone). */
  const FIELDS: FieldDescriptor[] = [
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
    { path: ["watchdog", "toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", semantics: "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound" },
    { path: ["watchdog", "holdTtlMs"], label: "Hold TTL (ms, 0 = no expiry)", zh: "暂停持有有效期（毫秒，0 表示不设有效期）", kind: "number", semantics: "how long a watchdog hold may stay latched before it auto-releases: past this bound the hold releases itself and changes ZERO team bytes, and activity newer than the hold releases it sooner — `0` disables the expiry" },
    // The four team-model slots (twelve leaves, mirrors of the ONE knob declaration in
    // packages/mpd-config-plugin/src/settings-schema.ts). Every slot leaf is a `select`: the
    // options come from the live catalog at render time (see optionsFor) and fall back to the
    // declared lists below, so no slot value is ever typed. The DECLARED lists are the parity
    // surface with the TUI; the LIVE lists are a different source by construction. The labels and
    // the human sentences are built from SLOT_GROUPS below, so a slot's copy is stated once here
    // exactly as the shared declaration states it (a test compares the two element-wise).
    ...SLOT_FIELDS,
    // The TUI surface's own knob (the Ctrl+A takeover toggle): mirrored from the ONE declaration,
    // whose `hint` is the semantics sentence — the card renders it as `semantics`, exactly like the
    // two watchdog rows above.
    { path: ["tui", "dashboardKey"], label: "Ctrl+A dependency view (old dsh-tui builds)", zh: "Ctrl+A 依赖视图（旧版 dsh-tui）", kind: "boolean", semantics: "applies to hosts WITHOUT the sidebar panel seam (dsh-tui before 0.13.0) only: while MPD's team projection has a team with at least one task, Ctrl+A opens MPD's merged dependency view instead of the host's subagent dashboard, and with no team Ctrl+A keeps opening the host dashboard — on a host that offers the panel seam, Ctrl+A always keeps its host dashboard meaning and the merged view opens through alt+a and /mpd panel" },
  ]

  // The per-row hint, HUMAN SENTENCE FIRST: the knob's own `semantics` (what it is and what
  // configuring it does) leads in the row's locale, then the real mpd.jsonc key with the bridge
  // disclosure and the not-lost clause — byte-identical to the hint the TUI section builds for the
  // same knob, so the two front doors state the same thing in the same order. A knob with no
  // human sentence keeps the disclosure-only hint it always had.
  /**
   * One row's hint: its own sentence plus the dotted mpd.jsonc key. The bridge disclosure is stated
   * ONCE at the top of the card, not once per row — measured in a real browser (docker/ui,
   * 2026-09-27, `05b-mpd-section.png`): with it inlined, all 25 rows read as the same four lines and
   * each knob's own sentence was pushed off screen, while the card already repeated the same text
   * again at the bottom.
   */
  const keyOf = (field: FieldDescriptor): string => `mpd.jsonc ${field.path.join(".")}`
  /** One row's hint text: the human sentence first, then the dotted key in parentheses. */
  const hintOf = (field: FieldDescriptor, lang: string = "en"): string => {
    /** The knob's human sentence in the requested locale. */
    const sentence = lang === "zh" ? field.semanticsZh : field.semantics
    /** The dotted mpd.jsonc key this row edits. */
    const pointer = keyOf(field)
    return sentence === undefined || sentence.length === 0 ? pointer : `${sentence} (${pointer})`
  }
  /** The dictionary key of one row (the same dotted key the hint names). */
  const fieldKey = (field: FieldDescriptor): string => field.path.join(".")
  /** Walk a nested path into an untyped settings value (a missing or non-object step answers undefined). */
  const leafOf = (value: unknown, path: string[]): unknown => path.reduce<unknown>((acc, part) => (acc === null || acc === undefined ? undefined : (acc as Record<string, unknown>)[part]), value)

  /** Whether a value is a non-null, non-array object — the only shape a route table can be. */
  const isTable = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  /** One string leaf of a route block, read only when it is a non-empty string ("" otherwise). */
  const routeLeaf = (block: unknown, leaf: string): string => {
    /** The leaf's raw value, when the block carries one. */
    const found = isTable(block) ? block[leaf] : undefined
    return typeof found === "string" ? found : ""
  }
  /**
   * Project the CURRENT EFFECTIVE model config (R3) from the live surfaces only: the settings
   * document this card binds, plus the `/plugins/mpd/model-config` body when the bundle's route
   * answered. Precedence per piece: the SERVICE value (it sees the file layers and refreshes on every
   * save and watched edit) over the DOCUMENT value (entry config only). There is NO built-in default
   * floor any more (contract §2): a slot neither surface configures renders `<unconfigured>`, with
   * the required leaves it is missing named.
   * @param section - the settings form's namespace value (the surface the card binds).
   * @param live - the live-service read: the route body (or undefined) and why it is absent.
   * @returns the projection the card renders above its rows.
   */
  function effectiveModelConfigOf(section: unknown, live: { body: unknown; notice: string }): EffectiveModelConfig {
    /** The live body narrowed to the members the route serves ({} when it did not answer). */
    const body = isTable(live.body) ? live.body : {}
    /** The four slot states. */
    const slots: Record<string, EffectiveRoute> = {}
    for (const slot of SLOT_SLOTS) {
      // PER-SLOT precedence: the service's slot state (the authoritative live read), else the
      // document's block, else nothing at all — and NOTHING is the `<unconfigured>` state.
      /** The service's state for this slot, when the route body carries one. */
      const fromService = isTable(body.slots) ? body.slots[slot] : undefined
      /** The state the card renders for this slot. */
      slots[slot] = isTable(fromService) ? slotStateOf(fromService, slot) : slotStateOf(leafOf(section, ["teamModels", slot]), slot)
    }
    /** The configured modelchain chains, only ever from the service read (the document carries none). */
    const modelchain: Record<string, Array<{ provider: string; model: string }>> = {}
    if (isTable(body.modelchain)) {
      for (const [key, chain] of Object.entries(body.modelchain)) {
        if (!Array.isArray(chain)) continue
        /** This key's usable chain entries, in configured order. */
        const entries = chain
          .filter((hop): hop is { provider: string; model: string } => isTable(hop) && typeof hop.provider === "string" && typeof hop.model === "string")
          .map((hop) => ({ provider: hop.provider, model: hop.model }))
        if (entries.length > 0) modelchain[key] = entries
      }
    }
    return { source: isTable(live.body) ? "service" : "document", slots, modelchain, notice: isTable(live.body) ? "" : live.notice }
  }

  /**
   * One slot's state from the raw block a surface reported: the route it states and what it lacks.
   *
   * The SAME rule the config row's resolver applies (contract §7/§9), restated here because the card
   * may not import that package: `provider` and `model` must be non-blank strings — WHITESPACE-ONLY
   * counts as missing, exactly as the resolver trims (CodeRabbit #5) — while `reasoningEffort` is
   * optional and a present-but-blank one states no effort. A present non-string leaf, or a slot that
   * is not an object at all, is `invalid` with the offending path named (CodeRabbit #4).
   * @param block - the raw slot block, of unknown shape.
   * @param slot - the slot id the block belongs to, used only to spell an `invalid` problem path.
   * @returns the state the effective block renders.
   */
  function slotStateOf(block: unknown, slot?: string): EffectiveRoute {
    /** The slot's provider leaf, trimmed; whitespace alone is UNSET, as the resolver treats it. */
    const provider = routeLeaf(block, "provider").trim()
    /** The slot's model leaf, trimmed. */
    const model = routeLeaf(block, "model").trim()
    /** The slot's effort leaf, trimmed. */
    const reasoningEffort = routeLeaf(block, "reasoningEffort").trim()
    /** The required leaves the slot does not state. */
    const missing = [provider === "" ? "provider" : "", model === "" ? "model" : ""].filter((leaf) => leaf !== "")
    // A block that is neither absent nor an object is malformed at the SLOT level (the resolver's
    // `teamModels.slotN must be an object` refusal, mirrored here for the display).
    if (block !== undefined && block !== null && !isTable(block)) {
      return { status: "invalid", provider, model, reasoningEffort, missing, problem: "teamModels." + (slot ?? "slotN") + " is not an object" }
    }
    /** The leaf that is PRESENT but not a string, if any — a malformed slot, not a missing one. */
    const malformedLeaf = isTable(block)
      ? ["provider", "model", "reasoningEffort"].find((leaf) => block[leaf] !== undefined && block[leaf] !== null && typeof block[leaf] !== "string")
      : undefined
    if (malformedLeaf !== undefined) {
      return { status: "invalid", provider, model, reasoningEffort, missing, problem: "teamModels." + (slot ?? "slotN") + "." + malformedLeaf + " is not a string" }
    }
    if (missing.length > 0) return { status: "unconfigured", provider, model, reasoningEffort, missing }
    return { status: "configured", provider, model, reasoningEffort, missing: [] }
  }

  /** Substitute the `{name}` placeholders of one dictionary sentence with language-neutral fragments. */
  function interpolate(text: string, params: Record<string, string>): string {
    /** The sentence, mutated once per placeholder. */
    let out = text
    for (const [name, value] of Object.entries(params)) out = out.split(`{${name}}`).join(value)
    return out
  }

  /** One route as the language-neutral `provider / model / effort` fragment the effective lines render. */
  function routeText(route: { provider: string; model: string; reasoningEffort: string }): string {
    return `${route.provider} / ${route.model} / ${route.reasoningEffort === "" ? "-" : route.reasoningEffort}`
  }

  /**
   * The see-before-you-edit lines (R3): the four effective slot STATES — each a route or the
   * `<unconfigured>` sentence with the leaves it still needs (contract §9) — plus the configured
   * modelchain chains. Every word is localized through the dictionary; every value a neutral id.
   * @param effective - the projection this render shows.
   * @param t - the locale resolver the component renders through.
   * @param createElement - the host's React createElement.
   * @returns the block's child elements, in render order.
   */
  function effectiveChildrenOf(effective: EffectiveModelConfig, t: (key: string) => string, createElement: ReactSurface["createElement"]): unknown[] {
    /** The block's lines, in render order. */
    const lines: unknown[] = []
    for (const slot of SLOT_SLOTS) {
      /** This slot's state, defaulting to the "nothing configured" state when no surface carries it. */
      const state = effective.slots?.[slot] ?? { status: "unconfigured" as const, provider: "", model: "", reasoningEffort: "", missing: ["provider", "model"] }
      // A DISPLAY NEVER THROWS AND NEVER INVENTS A ROUTE (contract §9): a slot that is unusable —
      // or whose projected state is older than this renderer, which a mixed client rollout can
      // produce — renders as its OWN typed sentence, never as an empty string and never as a throw.
      /** The leaves this line names when the slot is not configured. */
      const missing = Array.isArray(state.missing) ? state.missing : ["provider", "model"]
      /** The sentence this line renders: the route, the malformed-slot text, or the unconfigured text. */
      const text = state.status === "configured"
        ? interpolate(t("effective.slot." + slot), { route: routeText(state) })
        // CodeRabbit #4: an `invalid` slot has its OWN sentence. It is NOT the `<unconfigured>` one:
        // provider and model may well be present, and what is wrong is a MALFORMED leaf (named).
        : state.status === "invalid"
          ? interpolate(t("effective.slotInvalid"), { problem: typeof state.problem === "string" && state.problem !== "" ? state.problem : "teamModels." + slot })
          : interpolate(t("effective.slotUnconfigured"), { leaves: missing.length === 0 ? "-" : missing.join(", ") })
      lines.push(createElement(
        "p",
        { key: "effective.slot." + slot, style: SKIN.helpText, "data-mpd-effective-slot": slot, "data-mpd-slot-status": state.status },
        text,
      ))
    }
    // The configured modelchain chains, in the service's own key order (bounded to the first three
    // hops per chain so one long chain cannot push the rest of the block off screen).
    /** The configured chain keys. */
    const chainKeys = Object.keys(effective.modelchain)
    if (chainKeys.length === 0) {
      lines.push(createElement("p", { key: "effective.no-chains", style: SKIN.helpText, "data-mpd-effective-chains": "none" }, t("effectiveNoChains")))
    } else {
      for (const key of chainKeys) {
        /** This chain's hops as neutral `provider/model` fragments. */
        const hops = effective.modelchain[key].slice(0, 3).map((hop) => `${hop.provider}/${hop.model}`).join(", ")
        lines.push(createElement(
          "p",
          { key: "effective.chain." + key, style: SKIN.helpText, "data-mpd-effective-chain": key },
          interpolate(t("effectiveChain"), { key, chain: hops }),
        ))
      }
    }
    // The source line: which live surface produced the block, and — on the document branch — why.
    lines.push(createElement(
      "p",
      { key: "effective.source", style: SKIN.note, "data-mpd-effective-source": effective.source },
      effective.source === "service"
        ? t("effectiveSourceService")
        : interpolate(t("effectiveSourceDocument"), { why: effective.notice === "" ? t("effectiveWhyUnknown") : effective.notice }),
    ))
    return lines
  }

  /** Parse the control's text into a value for this field, or undefined when it is not one. */
  function parse(kind: string, text: unknown): boolean | number | string | undefined {
    if (kind === "number") {
      /** The text as a number, which must be finite to count. */
      const n = Number(String(text).trim())
      return Number.isFinite(n) ? n : undefined
    }
    if (kind === "boolean") {
      /** The text normalized for the two boolean spellings. */
      const t = String(text).trim().toLowerCase()
      if (t === "true" || t === "1") return true
      if (t === "false" || t === "0") return false
      return undefined
    }
    /** Every other kind keeps its text (an empty one is "unset"). */
    const t = String(text)
    return t.length === 0 ? undefined : t
  }

  /** Render one settings value as the control's text (a missing value renders empty). */
  const format = (kind: string, value: unknown): string => (value === undefined || value === null ? "" : String(value))

  /**
   * The namespace sub-tree that renders as a DEPENDENT picker: for each slot the provider, the
   * model (grouped by provider) and the reasoning effort (the SELECTED model's own efforts) are
   * all selections, so no slot value is ever typed. The card MIRRORS this declaration instead of
   * importing the TypeScript plugin's knob list: the web client must not reference that symbol (a
   * QA gate pins it), and the parity test compares the mirror with the real one.
   */
  const TEAM_MODEL_SLOT = "teamModels"

  /**
   * The session the catalog binds to, read from the client's OWN list snapshot.
   *
   * MEASURED in a real browser against the live host (`evidence/web-card-catalog/20260918T073000Z/`):
   * `sessions.list.getSnapshot()` is `{ ids, byId, current, phase, subagentsByParent, jobsBySession,
   * currentAddress }`, and `current` is the session ID **STRING** — never an object. The host's own
   * consumers prove it: `dsh-client-ui-session` hands it straight to `sessions.binding(current)`, and
   * `dsh-api-session-controller`'s `followCurrent()` indexes `snapshot.byId[current]`.
   *
   * THE DEFECT THIS REPLACES: `current.sessionId ?? current.id` on a STRING is always `undefined`, so
   * a card with a live current session rendered `no session is bound` — the exact sentence measured in
   * the user's browser. The earlier acceptance missed it because its fixture INJECTED
   * `{ current: { sessionId } }`, i.e. it asserted the ASSUMED shape instead of the real one.
   *
   * The object form is still accepted (last) so an existing caller that injects `{ sessionId }` keeps
   * working. Guarded: a missing sessions service, a missing list or an unbound session answer
   * undefined instead of throwing.
   */
  function currentSessionIdOf(sessions: SessionsService | undefined): string | undefined {
    try {
      /** The client's session-list snapshot. */
      const snapshot = listSnapshotOf(sessions)
      if (snapshot === undefined || snapshot === null) return undefined
      /** The session the app is showing, in either the measured or the legacy spelling. */
      const current = snapshot.current
      if (typeof current === "string") return current.length === 0 ? undefined : current
      if (current !== null && typeof current === "object") {
        /** The id the object form carries. */
        const id = current.sessionId ?? current.id
        return typeof id === "string" && id.length > 0 ? id : undefined
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /** The client's session-list snapshot, or undefined when the service is absent or unreadable. */
  function listSnapshotOf(sessions: SessionsService | undefined): SessionListSnapshot | undefined {
    /** The list service, when the sessions service exposes one. */
    const list = sessions ? sessions.list : undefined
    // The service hands back its own untyped snapshot; the card reads only the fields declared above.
    return list && typeof list.getSnapshot === "function" ? list.getSnapshot() as SessionListSnapshot : undefined
  }

  /**
   * Every session id the list snapshot carries, in the snapshot's own order. `ids` is the MEASURED
   * field; `items` and `byId` are read too, so a snapshot from another host build still yields
   * candidates.
   */
  function listedSessionIds(snapshot: SessionListSnapshot): string[] {
    /** The candidate ids, deduplicated in first-seen order. */
    const ids: string[] = []
    /** Add one candidate id when it is a usable string and not already listed. */
    const push = (id: unknown): void => {
      if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id)
    }
    if (Array.isArray(snapshot.ids)) for (const id of snapshot.ids) push(id)
    if (Array.isArray(snapshot.items)) for (const item of snapshot.items) push(item === null || item === undefined ? undefined : (item.sessionId ?? item.id))
    if (snapshot.byId !== null && snapshot.byId !== undefined && typeof snapshot.byId === "object") for (const id of Object.keys(snapshot.byId)) push(id)
    return ids
  }

  /**
   * The session a model directory can actually be resolved FOR. The session the app is SHOWING wins
   * (`current`); when the app has no current session — measured: the settings dialog opens before any
   * conversation — every LISTED session is tried and the first for which BOTH `scope(id)` and
   * `binding(id)` resolve wins, because that pair is exactly the precondition the host's resolver
   * documents (`… resolved no scope` / `… resolved no binding`). A non-`blank` session is tried
   * first: a placeholder row is a poor thing to pin a catalog preview to.
   *
   * No `open()` is needed and none is performed: the host mints a listed session's scope lazily
   * (`eligible(id) = current === id || ids.includes(id)`, measured resolving for every listed id).
   */
  function boundSessionIdOf(sessions: SessionsService | undefined): string | undefined {
    /** The session the app is showing, when it has one. */
    const current = currentSessionIdOf(sessions)
    if (current !== undefined) return current
    try {
      if (sessions === null || sessions === undefined) return undefined
      if (typeof sessions.scope !== "function" || typeof sessions.binding !== "function") return undefined
      /** The client's session-list snapshot. */
      const snapshot = listSnapshotOf(sessions)
      if (snapshot === undefined || snapshot === null) return undefined
      /** Every session id the snapshot carries. */
      const ids = listedSessionIds(snapshot)
      /** The snapshot's session map, read for the `blank` placeholder flag. */
      const byId = snapshot.byId !== null && snapshot.byId !== undefined && typeof snapshot.byId === "object" ? snapshot.byId : {}
      /** The ids with the real sessions first (a blank placeholder is a poor catalog pin). */
      const ordered = [...ids.filter((id) => byId[id]?.blank !== true), ...ids.filter((id) => byId[id]?.blank === true)]
      for (const id of ordered) {
        try {
          if (sessions.scope(id) !== undefined && sessions.binding(id) !== undefined) return id
        } catch {
          /* an unresolvable id is not a candidate */
        }
      }
    } catch {
      /* an unreadable list is not a candidate */
    }
    return undefined
  }

  /** Read one service from a context that has it IN SCOPE (never throws). */
  function readService(ctx: CardContext | undefined, name: string): unknown {
    try {
      return ctx && typeof ctx.get === "function" ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  /** The data attribute carrying the branch that produced the option lists (assertable, no browser). */
  const CATALOG_ATTR = "data-mpd-catalog-state"
  /** The sentence a fallback MUST say out loud — a silent fallback is what hid this defect. */
  const CATALOG_FALLBACK_NOTICE = "declared fallback — live catalog unavailable"
  /** The state the card starts in, before any injection has resolved. */
  const FALLBACK_CATALOG: CatalogInfo = { mode: "fallback", providers: 0, models: 0, notice: CATALOG_FALLBACK_NOTICE, reason: "the model catalog injection has not resolved yet" }

  /** The one sentence the card renders for one catalog state: LIVE (with counts) or fallback. */
  function catalogNotice(info: CatalogInfo | undefined): string {
    /** The state to describe (the declared fallback when none was published yet). */
    const state = info ?? FALLBACK_CATALOG
    if (state.mode === "live") {
      /** How many providers the live catalog carries. */
      const providers = Number(state.providers ?? 0)
      /** How many models the live catalog carries. */
      const models = Number(state.models ?? 0)
      return "live catalog — " + String(providers) + (providers === 1 ? " provider" : " providers") + " · " + String(models) + (models === 1 ? " model" : " models")
    }
    /** The fallback's own reason, in parentheses, when it states one. */
    const reason = typeof state.reason === "string" && state.reason.length > 0 ? " (" + state.reason + ")" : ""
    return CATALOG_FALLBACK_NOTICE + reason
  }

  /**
   * The short trailing marker a SLOT row's hint carries while the catalog is in fallback: the third
   * surface of the same state, on the rows the user is actually looking at. Live renders nothing
   * here — the hint is not part of the front-door parity contract (the parity pin compares the
   * declaration), so the suffix is a render-time addition only.
   */
  function slotFallbackMarker(info: CatalogInfo | undefined): string {
    /** The state to describe (the declared fallback when none was published yet). */
    const state = info ?? FALLBACK_CATALOG
    if (state.mode === "live") return ""
    /** The fallback's own reason, or "" when it states none. */
    const reason = typeof state.reason === "string" && state.reason.length > 0 ? state.reason : ""
    return reason === "" ? " — declared fallback" : " — declared fallback: " + reason
  }

  /** The provider/model counts of one group list. */
  function catalogCounts(groups: CatalogGroup[]): { providers: number; models: number } {
    /** How many models every group contributes. */
    let models = 0
    for (const group of groups) models += Array.isArray(group.models) ? group.models.length : 0
    return { providers: groups.length, models }
  }

  /**
   * The LIVE model catalog: the host client's own provider groups
   * (`{ id, name, models: [{ id, name, reasoning?: { efforts: [{ id, name }] } }] }`).
   *
   * THE DEFECT THIS REPLACES (measured): a BARE `ctx.get` probe for `modelDirectories` can never
   * see the service — `@deepseek-ai/dsh-client-ui-model-selection` provides it from ANOTHER
   * plugin's
   * fiber, and cordis resolves services through the fiber's own scope, so the probe answered
   * `undefined` forever and the card silently rendered its DECLARED option lists (one provider).
   * The measured rule lives in this package's `src/web-client.ts` header; the answer is the
   * dynamic form `ctx.inject(["modelDirectories", "sessions", "remote.session"], …)`, which waits
   * for the providers
   * WITHOUT parking this boot entry. They must NEVER be added to the module's declared
   * `inject`/`REQUIRED_SERVICES` list: a declared-but-unregistered service is fatal to the whole
   * page (`assertEntriesActive` turns it into a `pending` entry).
   *
   * THE SECOND DEFECT (measured in a real browser, `evidence/web-card-catalog/`): the injection
   * alone is not enough, because cordis services are CALLER-scoped — the service's own `ctx`
   * resolves to the ACCESSING ctx. The host's model-directory resolver declares
   * `inject = ["sessions","remote","remote.session"]` and reads `this.ctx.remote.session` inside
   * `directoryFor()`, so a caller that injected only `["modelDirectories","sessions"]` is REJECTED
   * with `cannot get property "remote.session" without inject`, the card degrades, and the UI shows
   * the declared fallback while the browser's own catalog carries two providers. The caller must
   * therefore declare the same dotted chain it makes the service read: `remote.session` is
   * NECESSARY AND SUFFICIENT (measured: `["modelDirectories","sessions"]` throws,
   * `+ "remote"` throws, `+ "remote.session"` is ready with 2 providers / 31 models). `remote` is
   * NOT added: `this.ctx.remote` is a FIRST-LEVEL read, which a caller-scoped call re-roots at the
   * RESOLVER's own fiber (where its `static inject` satisfies it) — only DOTTED seams are re-rooted
   * at the CALLER's injection fiber, so `remote` would be one more activation precondition and
   * nothing else. The name stays in the DYNAMIC inject list only: a declared-but-unregistered
   * service on a loader ENTRY is page-fatal (`assertEntriesActive`), while a parked dynamic
   * injection merely never fires and the card keeps its declared fallback.
   *
   * LIVE, not a one-shot snapshot: once a directory exists for the bound session it is
   * SUBSCRIBED, `load()`ed (so the catalog is really fetched), and every store notification
   * re-projects the card's own store — a provider/model that appears while the page is open shows
   * up without a rebuild. `directoryFor` THROWS for a session the host does not know, so every
   * step is wrapped and degrades to the declared lists — with `info()` saying so out loud.
   */
  function createLiveCatalog(hostCtx: CardContext): LiveCatalog {
    /** The bound session's model directory, once one resolved. */
    let directory: ModelDirectory | undefined
    /** The session the directory is bound to (a switch rebinds it). */
    let boundSessionId: string | undefined
    /** The catalog's current provider groups. */
    let groups: CatalogGroup[] = []
    /** The catalog's current state. */
    let info: CatalogInfo = FALLBACK_CATALOG
    /** The directory store's unsubscribe function, while one is held. */
    let unsubscribeStore: (() => void) | null = null
    /** The session-list unsubscribe function, while one is held. */
    let unsubscribeSessions: (() => void) | null = null
    /** The dynamic-injection fiber, while the injection is live. */
    let fiber: { dispose?: () => void } | null = null
    /** Every subscriber the card's store forwards to. */
    const listeners = new Set<() => void>()

    /** Wake every subscriber (a broken one must not break the card). */
    function notify(): void {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          /* a broken listener must not break the card */
        }
      }
    }

    /**
     * The CONSOLE SIGNAL: a degraded read used to be visible ONLY in the card's own paragraph at
     * the TOP of the section, which a user looking at the three slot pickers at the BOTTOM never
     * sees — and the fallback path was console-silent, which is how a dead catalog read survived a
     * whole verification wave. Exactly ONE warning when the state BECOMES a fallback (never
     * repeated while it stays one; re-armed when it returns to live and degrades again) and ONE
     * info when it becomes live. The sentence is `catalogNotice`'s — never a second wording.
     */
    /**
     * Announce a state change ONCE per transition. `pending` marks a fallback that is only the
     * sessions list still ENUMERATING: the card starts with the plugin (measured — the injected
     * callback fires during app BOOT, long before any conversation exists), so announcing that first
     * "no session is bound" put a `[mpd]` WARNING into every healthy boot while nothing was wrong.
     * The rendered state is unchanged (the visible fallback paragraph still says exactly this); only
     * the CONSOLE announce waits for the list to settle, so a warning means a degrade again.
     */
    /** The mode the console last announced, so a transition is announced exactly once. */
    let announcedMode: string | undefined
    /** Publish one catalog state and announce a transition. */
    function publish(nextGroups: CatalogGroup[], nextInfo: CatalogInfo): void {
      groups = nextGroups
      info = nextInfo
      /** The mode this state renders as. */
      const mode = info !== null && info !== undefined && info.mode === "live" ? "live" : "fallback"
      /** Whether this fallback is only the session list still enumerating. */
      const pending = info !== null && info !== undefined && info.pending === true
      if (pending !== true && mode !== announcedMode) {
        announcedMode = mode
        /** The one sentence this state is announced with. */
        const sentence = catalogNotice(info)
        if (mode === "live") console.info("[mpd] model catalog:", sentence)
        else console.warn("[mpd] model catalog:", sentence)
      }
      notify()
    }

    /** Degrade to the declared lists, with the reason the card renders and announces. */
    function fallback(reason: string, pending?: boolean): void {
      publish([], { mode: "fallback", providers: 0, models: 0, notice: CATALOG_FALLBACK_NOTICE, reason, pending: pending === true })
    }

    /** Drop the bound directory and its store subscription (the catalog keeps its last state). */
    function releaseDirectory(): void {
      if (unsubscribeStore !== null) {
        try {
          unsubscribeStore()
        } catch {
          /* the store may already be gone */
        }
        unsubscribeStore = null
      }
      directory = undefined
    }

    /** Re-read the bound directory's store and republish (live: called on every notification). */
    function readStore(): void {
      try {
        /** The bound directory's store, when it has one. */
        const store = directory ? directory.store : undefined
        /** The store's current snapshot. */
        const snapshot = store && typeof store.getSnapshot === "function" ? store.getSnapshot() : undefined
        /** The groups the snapshot carries (an absent list counts as none). */
        const raw = snapshot && Array.isArray(snapshot.groups) ? snapshot.groups : []
        /** The groups that carry an id and a model list. */
        const next = raw.filter((group) => group !== null && typeof group === "object" && typeof group.id === "string" && Array.isArray(group.models))
        if (next.length === 0) {
          fallback("the model directory for this session reports no provider")
          return
        }
        /** The provider/model counts of the groups about to be published. */
        const counts = catalogCounts(next)
        publish(next, { mode: "live", providers: counts.providers, models: counts.models })
      } catch {
        fallback("the model directory could not be read")
      }
    }

    /** Bind (or rebind) the directory of the current session and follow its store. */
    function bindDirectory(directories: ModelDirectoryService | null | undefined, sessions: SessionsService | undefined, force: boolean): void {
      /** The session the directory should belong to. */
      const sessionId = boundSessionIdOf(sessions)
      // A session-list notification is not a reason to re-fetch an unchanged directory: only a
      // real SWITCH (or a provider remount, which passes force) rebinds and reloads.
      if (force !== true && sessionId !== undefined && sessionId === boundSessionId && directory !== undefined) return
      boundSessionId = sessionId
      releaseDirectory()
      try {
        if (directories === null || directories === undefined || typeof directories.directoryFor !== "function") {
          fallback("no model directory service is registered")
          return
        }
        if (sessionId === undefined) {
          // "the list has not enumerated yet" is NOT the same state as "the list is ready and offers
          // no bindable session": only the second is a degrade worth a console warning.
          /** The list snapshot, read only to tell enumeration from an empty list. */
          const snapshot = listSnapshotOf(sessions)
          /** Whether the list is still enumerating (its phase is not `ready` yet). */
          const enumerating = snapshot !== undefined && snapshot !== null && snapshot.phase !== "ready"
          fallback("no session is bound", enumerating)
          return
        }
        /** The directory the host resolved for that session. */
        const found = directories.directoryFor(sessionId)
        if (found === null || found === undefined) {
          fallback("the host resolved no model directory for this session")
          return
        }
        directory = found
        /** The directory's own store, when it has one. */
        const store = found.store
        if (store && typeof store.subscribe === "function") unsubscribeStore = store.subscribe(() => readStore())
        readStore()
        if (typeof found.load === "function") {
          try {
            Promise.resolve(found.load()).then(() => readStore(), () => { /* a failed load keeps the last snapshot */ })
          } catch {
            /* a synchronous throw keeps the last snapshot */
          }
        }
      } catch (error) {
        // directoryFor THROWS for a session the host does not know — and for a CALLER whose inject
        // list does not satisfy the service's own reads (`cannot get property "remote.session"
        // without inject`, the measured defect). Degrade, never crash the card, and NAME the cause:
        // a mislabeled fallback is what kept this defect invisible in the UI for a whole lane.
        /** The failure's own message, or "" when it carries none. */
        const detail = error !== null && error !== undefined && typeof (error as { message?: unknown }).message === "string" ? (error as { message?: unknown }).message as string : ""
        fallback("the host resolved no model directory for this session" + (detail === "" ? "" : ": " + detail.slice(0, 160)))
      }
    }

    /** Bind the catalog to the services of one injected scope. */
    function bind(scoped: CardContext): void {
      releaseDirectory()
      if (unsubscribeSessions !== null) {
        try {
          unsubscribeSessions()
        } catch {
          /* the list may be gone */
        }
        unsubscribeSessions = null
      }
      // Services come back untyped through the context probe; only the members declared above are read.
      /** The host's model-directory service, when this scope exposes one. */
      const directories = readService(scoped, "modelDirectories") as ModelDirectoryService | undefined
      /** The client's sessions service, when this scope exposes one. */
      const sessions = readService(scoped, "sessions") as SessionsService | undefined
      try {
        /** The session list, when the sessions service exposes one. */
        const list = sessions ? sessions.list : undefined
        // A session SWITCH re-binds the directory: the picker follows the session the page is on.
        if (list && typeof list.subscribe === "function") unsubscribeSessions = list.subscribe(() => bindDirectory(directories, sessions, false))
      } catch {
        unsubscribeSessions = null
      }
      // The injection itself is a (re)bind: a provider remount must never keep a stale directory.
      bindDirectory(directories, sessions, true)
    }

    return {
      /** Start the dynamic injection. The scoped ctx of the callback is what reads the services. */
      start(): boolean {
        if (typeof hostCtx?.inject !== "function") {
          fallback("the client runtime exposes no ctx.inject")
          return false
        }
        try {
          // The CALLER-SCOPED chain: `remote.session` is what the host's directory resolver reads on
          // ITS ctx, and cordis resolves a service's ctx to the ACCESSING ctx — so it must be
          // declared HERE (dynamically; never in the module's declared inject) or `directoryFor`
          // throws `cannot get property "remote.session" without inject`. Measured necessary AND
          // sufficient; see the class comment above.
          fiber = hostCtx.inject(["modelDirectories", "sessions", "remote.session"], (scoped) => bind(scoped))
        } catch (error) {
          console.warn("[mpd] settings section: the model catalog could not be injected: " + String(error))
          fallback("the model catalog injection failed")
          return false
        }
        return true
      },
      /** Release the directory, the session subscription and the injection fiber. */
      dispose(): void {
        releaseDirectory()
        if (unsubscribeSessions !== null) {
          try {
            unsubscribeSessions()
          } catch {
            /* the list may be gone */
          }
          unsubscribeSessions = null
        }
        if (fiber !== null && typeof fiber.dispose === "function") {
          try {
            fiber.dispose()
          } catch {
            /* the fiber may already be gone */
          }
        }
        fiber = null
        listeners.clear()
      },
      /** The catalog's current provider groups. */
      groups: (): CatalogGroup[] => groups,
      /** The catalog's current state. */
      info: (): CatalogInfo => info,
      /** Subscribe to catalog changes; the returned function unsubscribes. */
      subscribe(listener: () => void): () => boolean {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }

  /** The declared fallback options of one knob, in the { value, label } shape the card renders. */
  function declaredOptions(field: FieldDescriptor): FieldOption[] {
    return (Array.isArray(field.options) ? field.options : []).map((value) => ({ value, label: value }))
  }

  /** The catalog entry of one exact provider/model pair (the provider leaf picks the group). */
  function findModel(groups: CatalogGroup[], providerId: unknown, modelId: unknown): CatalogModel | undefined {
    /** The groups of the selected provider, which are searched first. */
    const preferred = groups.filter((group) => group.id === providerId)
    for (const group of [...preferred, ...groups.filter((group) => group.id !== providerId)]) {
      for (const model of group.models) if (model && model.id === modelId) return model
    }
    return undefined
  }

  /**
   * The options ONE field renders. Non-slot knobs keep their declared list. Slot leaves derive
   * theirs from the catalog and fall back to the declared list whenever the catalog is empty or
   * lacks the requested entry — a missing catalog degrades the OPTIONS, never the section:
   *   provider          -> the catalog's provider ids (label = the provider's display name)
   *   model             -> every provider's models, GROUPED by provider (optgroup label)
   *   reasoningEffort   -> the SELECTED model's own efforts, so changing the model re-derives them
   */
  function optionsFor(field: FieldDescriptor, groups: CatalogGroup[], controls: Record<string, RowControl> | undefined): FieldOption[] {
    /** The knob's declared options, which every degrade path returns. */
    const declared = declaredOptions(field)
    // The team-model slot rows pick from the live catalog; every other knob keeps its declared list.
    if (field.path[0] !== TEAM_MODEL_SLOT || groups.length === 0) return declared
    /** The slot's group key (`slot1`…`slot4`). */
    const groupKey = field.path[1]
    /** The leaf this row edits. */
    const leaf = field.path[2]
    if (leaf === "provider") return groups.map((group) => ({ value: group.id, label: typeof group.name === "string" && group.name.length > 0 ? group.name : group.id }))
    if (leaf === "model") {
      /** Every provider's models, in the catalog's own order. */
      const options: FieldOption[] = []
      for (const group of groups) {
        for (const model of group.models) if (model && typeof model.id === "string") options.push({ value: model.id, label: typeof model.name === "string" && model.name.length > 0 ? model.name : model.id, group: typeof group.name === "string" && group.name.length > 0 ? group.name : group.id })
      }
      return options.length > 0 ? options : declared
    }
    /** The text of one control of this route group, which the effort list derives from. */
    const textOf = (path: string[]): string | undefined => {
      /** The control the render is currently showing for that path. */
      const control = controls ? controls[path.join(".")] : undefined
      return control ? control.text : undefined
    }
    /** The model the provider and model controls of THIS row's group currently select. */
    const model = findModel(groups, textOf([field.path[0], groupKey, "provider"]), textOf([field.path[0], groupKey, "model"]))
    /** The selected model's own efforts (an absent list counts as none). */
    const efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : []
    /** Those efforts as rendered options. */
    const derived = efforts.filter((effort) => effort && typeof effort.id === "string").map((effort) => ({ value: effort.id, label: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id }))
    return derived.length > 0 ? derived : declared
  }

  /**
   * The option children of one select: `optgroup`s keyed by provider when the options carry a
   * group (the model control, where the provider is shown as a group), a flat list otherwise.
   */
  function optionElements(createElement: ReactSurface["createElement"], options: FieldOption[]): unknown[] {
    if (!options.some((option) => typeof option.group === "string")) {
      return options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))
    }
    /** The group labels, in first-seen order. */
    const labels: string[] = []
    /** The options of every group. */
    const byGroup = new Map<string, FieldOption[]>()
    for (const option of options) {
      /** The option's group label (an ungrouped option lands in the empty group). */
      const label = typeof option.group === "string" ? option.group : ""
      if (!byGroup.has(label)) {
        byGroup.set(label, [])
        labels.push(label)
      }
      // The `has`/`set` above is what makes the entry present; the assertion is type-level only.
      byGroup.get(label)!.push(option)
    }
    return labels.map((label) =>
      createElement(
        "optgroup",
        { key: label, label },
        ...byGroup.get(label)!.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
      ),
    )
  }

  /** A minimal snapshot store (the host's own is private): subscribe + getSnapshot, stable refs. */
  function createStore<T>(initial: T): { getSnapshot: () => T; subscribe: (listener: () => void) => () => boolean; set: (next: T) => void } {
    /** The current snapshot, replaced only by `set`. */
    let snapshot = initial
    /** Every subscriber the store wakes after a `set`. */
    const listeners = new Set<() => void>()
    return {
      /** The current snapshot (the same reference until the next `set`). */
      getSnapshot: (): T => snapshot,
      /** Subscribe a component; the returned function unsubscribes it. */
      subscribe(listener: () => void): () => boolean {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      /** Replace the snapshot and wake every subscriber. */
      set(next: T): void {
        snapshot = next
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* a broken listener must not break the card */
          }
        }
      },
    }
  }

  /**
   * The card's form controller: reads the bound settings scope, stages edits, and writes them with
   * `scope.mutate(ops, revision)` — nested paths included, which `scope.set(field, …)` cannot
   * express (it writes top-level fields only).
   */
  function createMpdCardController(scope: SettingsScope, fields: FieldDescriptor[] = FIELDS, disclosure: Disclosure = { BRIDGE_DISCLOSURE, BRIDGE_RESTART_LIMIT, NO_WORKSPACE_NOTICE }, catalogInfo: () => CatalogInfo = () => FALLBACK_CATALOG, afterSave: () => void = () => {}): CardController {
    /** Every staged edit, keyed by the row's dotted knob key. */
    const staged = new Map<string, StagedEdit>()
    // Declared BEFORE the first projection: `project()` reads all three, and a `let` below the
    // call site is a TDZ ReferenceError (measured by this module's own test).
    /** Whether a save is in flight. */
    let saving = false
    /** Whether the last save failed. */
    let failed = false
    /** The last failure's message. */
    let lastError = ""
    /**
     * The LIVE-SERVICE read behind the effective block (R3): the `/plugins/mpd/model-config` body
     * once it answered, or undefined while the route has not (the projection then falls back to
     * the settings document and says so through its `notice`).
     */
    let liveService: { body: unknown; notice: string } = { body: undefined, notice: "" }
    /** The card's own store, whose first projection is built from the bound scope. */
    const store = createStore(project())

    /** The bound form's snapshot and the namespace sub-tree this card reads values from. */
    function readScope(): { snapshot: ScopeSnapshot | undefined; section: unknown } {
      /** The form's current snapshot. */
      const snapshot = scope.getSnapshot()
      return { snapshot, section: snapshot?.value ?? snapshot?.user }
    }

    /** Project the whole card state (rows, flags, disclosures and catalog state). */
    function project(): CardState {
      /** The form snapshot and the namespace sub-tree of this projection. */
      const { snapshot, section } = readScope()
      /** Every row's control, keyed by the row's dotted knob key. */
      const controls: Record<string, RowControl> = {}
      /** Whether any row carries a staged edit. */
      let dirty = false
      /** Whether any staged draft is invalid. */
      let invalid = false
      for (const field of fields) {
        /** The row's dotted knob key. */
        const key = fieldKey(field)
        /** The row's staged edit, when the user typed one. */
        const stagedEdit = staged.get(key)
        if (stagedEdit !== undefined) {
          // A clear marker and a parsed value share this slot; only the marker carries `kind`, so
          // the access is asserted where it is read (type-level only).
          /** The staged draft's interpretation. */
          const parsed: ParsedEdit = stagedEdit.clear ? { kind: "clear" } : parse(field.kind, stagedEdit.text)
          controls[key] = { text: stagedEdit.text, overridden: (parsed as { kind?: string } | undefined)?.kind === "set", invalid: parsed === undefined }
          if (parsed === undefined) invalid = true
          dirty = true
          continue
        }
        controls[key] = { text: format(field.kind, leafOf(section, field.path)), overridden: leafOf(snapshot?.user, field.path) !== undefined, invalid: false }
      }
      return {
        available: snapshot?.status === "ready",
        writable: snapshot?.writable === true,
        mode: snapshot?.mode ?? "memory",
        dirty,
        invalid,
        saving,
        failed,
        error: lastError,
        controls,
        disclosure,
        // Which branch produced the slot option lists — LIVE (with counts) or the declared
        // fallback. It rides the card's OWN store, so a catalog change re-projects the card.
        catalog: catalogInfo() ?? FALLBACK_CATALOG,
        // R3: the effective model config projected from the bound document plus the live-service
        // read — rides the SAME store, so a save or a service refresh re-projects the block.
        effective: effectiveModelConfigOf(section, liveService),
      }
    }

    /** Re-project and publish the card state. */
    function publish(): void {
      store.set(project())
    }
    try {
      scope.subscribe(publish)
    } catch {
      /* a scope without subscribe still renders its first snapshot */
    }

    /** Every staged edit a save would write (an unparsable draft contributes no write). */
    function plan(): WriteOp[] {
      /** The ops a save would send. */
      const writes: WriteOp[] = []
      for (const field of fields) {
        /** The row's dotted knob key. */
        const key = fieldKey(field)
        /** The row's staged edit, when the user typed one. */
        const stagedEdit = staged.get(key)
        if (stagedEdit === undefined) continue
        if (stagedEdit.clear) {
          writes.push({ op: "unset", path: [...field.path] })
          continue
        }
        /** The staged draft's parsed value (an unparsable one contributes no write). */
        const parsed = parse(field.kind, stagedEdit.text)
        if (parsed === undefined) continue
        if (format(field.kind, leafOf(readScope().section, field.path)) === format(field.kind, parsed)) continue
        writes.push({ op: "set", path: [...field.path], value: parsed })
      }
      return writes
    }

    /** Write every staged edit through the scope's mutate, with the revision fence. */
    async function save(): Promise<void> {
      /** The ops this save would send. */
      const writes = plan()
      // A scope that is not writable (a non-loopback page keeps its snapshot in memory) must not
      // even ATTEMPT a write: the card renders the reason, and the edit stays staged for the user
      // rather than being silently dropped on the wire.
      if (saving || writes.length === 0 || readScope().snapshot?.writable !== true) return
      saving = true
      failed = false
      lastError = ""
      publish()
      try {
        // The revision fence: the scope reports the revision it read, so a concurrent change is a
        // conflict the user can retry rather than a silent overwrite.
        await scope.mutate(writes, scope.getSnapshot()?.revision)
        staged.clear()
      } catch (error) {
        failed = true
        lastError = String((error as { message?: unknown })?.message ?? error)
      }
      saving = false
      publish()
      // R3: a successful save is exactly when the effective model config CHANGED, so the mount
      // re-reads the live service here (a failed save changes nothing and skips the read).
      if (!failed) afterSave()
    }

    /** Stage one row's edit, clear the last failure and re-project. */
    function stage(key: string, edit: StagedEdit): void {
      staged.set(key, edit)
      failed = false
      lastError = ""
      publish()
    }

    return {
      /** The face the slot registration injects: one hook store plus the form actions. */
      inject(): CardFace {
        return {
          hooks: { mpdCard: store },
          edit: (key: string, text: string) => stage(key, { text, clear: false }),
          resetField: (key: string) => stage(key, { text: "", clear: true }),
          save: (): void => {
            void save()
          },
          discard: (): void => {
            if (staged.size === 0 && !failed) return
            staged.clear()
            failed = false
            lastError = ""
            publish()
          },
        }
      },
      store,
      /** Re-project after an EXTERNAL change (the live catalog): the card's store is the channel. */
      refresh: (): void => {
        publish()
      },
      /**
       * Publish one live-service read (R3): the `/plugins/mpd/model-config` body when the route
       * answered, or the notice for why it did not. Stored, then re-projected; never throws.
       */
      setLiveService: (body: unknown, notice: string): void => {
        liveService = { body, notice }
        publish()
      },
      /** Release the bound scope. */
      dispose: (): void => {
        try {
          scope.dispose()
        } catch {
          /* already disposed */
        }
      },
    }
  }

  // ── R2: the section renders on the harness's OWN settings-form tokens ───────────
  // WHAT THIS IS: the card's entire visual contract, read off the INSTALLED primitives —
  // `@deepseek-ai/dsh-client-ui-primitives/lib/settings-form/fields.module.css` (`.field`, `.field +
  // .field`, `.label`, `.hint`, `.input`, `.reset`) and `SettingsForm.module.css` (`.form`,
  // `.footer`, `.save`, `.readOnly`), with the alias VALUES and the focus ring taken from the theme
  // bundle (`dsh-client-ui-theme`: `body{…}` is the light theme, `body[data-ds-dark-theme]{…}` the
  // dark one, and its `focus.css` holds `:root{--dsw-focus-ring-width:2px}` plus the global
  // `:focus-visible` rule), and the section title/description from the settings plane's own
  // `dsh-client-ui-settings-models` (`.title` 16px/500/24px, `.description` 14px/24px). R2 is a
  // RESTYLE: nothing in this block reads, writes or re-keys a value — every key, attribute and
  // behaviour path below the styles is the one that shipped.
  //
  // FALLBACK DISCIPLINE (BINDING): an inline style gets no stylesheet default, and a bare
  // `var(--dsw-…)` that resolves to nothing paints an invisible control — so every token below is
  // read WITH a literal. A token this bundle ALREADY pairs keeps that exact literal
  // (`--dsw-alias-label-primary, #1c1c1e`, `-secondary, #5b6472`, `-tertiary, #8a94a6`,
  // `--dsw-alias-state-business-primary, #4d6bfe` — the vocabulary `team-view.ts` renders the team
  // panel with, so the two panels degrade identically); a token it does not pair yet carries the
  // token's own LIGHT-theme value from the theme bundle, which is what the token resolves to by
  // default. `--dsw-focus-ring-color` is DEFINED by that theme (as `transparent`, for pointer
  // modality), so its fallback is the host's own nested one rather than a literal.
  //
  // THE FOCUS RING IS NOT PAINTED HERE, deliberately: the host's global `:focus-visible` rule
  // already gives every focusable element `outline-width: var(--dsw-focus-ring-width)` in
  // `outline-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))` — the
  // exact pair the contract names — and a pseudo-class cannot be expressed as an inline style. Only
  // the CONTROL opts out, exactly as the host's `.input:focus-visible` does (border accent, no
  // outline), through the two listeners below.
  /** The radius the harness's `.field` / `.input` / `.button` all share (`--dsw-radius-md:12px`). */
  const RADIUS_MD = "var(--dsw-radius-md, 12px)"
  /** The control stroke (`.input`): 0.5px, light-theme literal. */
  const STROKE_CONTROL = "0.5px solid var(--dsw-alias-border-l4, #00000029)"
  /** The FIELD separator (`.field + .field`): 0.5px, light-theme literal. */
  const STROKE_FIELD = "0.5px solid var(--dsw-alias-border-l2, #0000001a)"
  /** The outlined action's stroke (`.button.outline`): 0.5px, light-theme literal. */
  const STROKE_BUTTON = "0.5px solid var(--dsw-alias-border-l3, #0000001f)"
  /** The label alias the host's `.label` colours with (the bundle's existing literal). */
  const LABEL_PRIMARY = "var(--dsw-alias-label-primary, #1c1c1e)"
  /** The muted alias (`.reset`, `.description`; the bundle's existing literal). */
  const LABEL_SECONDARY = "var(--dsw-alias-label-secondary, #5b6472)"
  /** The dimmest alias (`.hint`, `.readOnly`, `.failed`; the bundle's existing literal). */
  const LABEL_TERTIARY = "var(--dsw-alias-label-tertiary, #8a94a6)"
  /** The control fill (`.input` `--dsw-alias-bg-layer-3`, light-theme literal `#fff`). */
  const FILL_CONTROL = "var(--dsw-alias-bg-layer-3, #fff)"
  /** The focus/active accent (`.input:focus-visible`; the bundle's existing literal). */
  const ACCENT = "var(--dsw-alias-state-business-primary, #4d6bfe)"
  /** The pointer-hover wash (`.button.outline:hover`), light-theme literal. */
  const HOVER_WASH = "var(--dsw-alias-interactive-bg-hover, #2631480f)"
  /**
   * Every inline style bag the card renders with. The keys are the ROLES the harness names
   * (`.field`, `.label`, `.hint`, `.input`, `.help`, `.footer`, `.save`, `.reset`, `.readOnly`), so a
   * reviewer can diff one against its stylesheet rule directly.
   */
  const SKIN: Record<string, Record<string, string | number>> = {
    /** The host's `.form`: a plain column — the host's own sections have no panel chrome. */
    form: { display: "flex", flexDirection: "column" },
    /** `.field`: flex column, gap 6px, padding 12px 0. The separator is added per field below. */
    field: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 0" },
    /** The settings section title (`.title`: 16px/500/24px, label-primary). */
    title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: "24px", color: LABEL_PRIMARY },
    /** The section description (`.description`: 14px/24px, label-secondary). */
    description: { margin: "0 0 12px", fontSize: 14, lineHeight: "24px", color: LABEL_SECONDARY },
    /** `.readOnly` / `.unavailable`: the state notes, 12px/1.5 tertiary. */
    note: { margin: "0 0 12px", fontSize: 12, lineHeight: 1.5, color: LABEL_TERTIARY },
    /** `.help`: the disclosure block — 12px/1.6 stack, 8px between paragraphs. */
    help: { margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 8, paddingTop: 10 },
    /** One `.help > p`: 12px/1.6, the hint colour (the captain's R2 note: no wall of body text). */
    helpText: { margin: 0, fontSize: 12, lineHeight: 1.6, color: LABEL_TERTIARY },
    /** `.label`: 13px/500/1.5, label-primary. */
    label: { display: "block", fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: LABEL_PRIMARY },
    /** `.hint`: the row's human sentence — 12px/1.5 tertiary (the contract's hint row). */
    hint: { display: "block", fontSize: 12, lineHeight: 1.5, color: LABEL_TERTIARY },
    /** The block that stacks the sentence over its key, with the 2px the row always had. */
    hintBlock: { display: "block", marginBottom: 2 },
    /** The dotted key BENEATH a sentence: one step down (11px, dimmer) so it never competes. */
    key: { display: "block", fontSize: 11, lineHeight: 1.5, opacity: 0.6, color: LABEL_TERTIARY },
    /** The dotted key as a row's ONLY hint (a knob with no sentence): the hint size, still dim. */
    keyOnly: { display: "block", marginBottom: 2, fontSize: 12, lineHeight: 1.5, opacity: 0.6, color: LABEL_TERTIARY },
    /** `.input`: 34px, 0 12px padding, the control stroke, radius-md, layer-3 fill, 13px. */
    control: {
      boxSizing: "border-box",
      width: "100%",
      height: 34,
      padding: "0 12px",
      border: STROKE_CONTROL,
      borderRadius: RADIUS_MD,
      background: FILL_CONTROL,
      fontSize: 13,
      lineHeight: 1.5,
      color: LABEL_PRIMARY,
    },
    /** `.input:disabled`: a control the page refuses writes on greys its text and drops the cursor. */
    controlOff: { color: LABEL_TERTIARY, cursor: "default" },
    /** A slot's group heading: the label treatment, with the field rhythm's top padding. */
    groupHeading: { marginTop: 12, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: LABEL_PRIMARY },
    /** A slot's one-line impact: the hint treatment. */
    groupImpact: { margin: "2px 0 0", fontSize: 12, lineHeight: 1.5, color: LABEL_TERTIARY },
    /** The row's marker line (overridden / invalid) that carries the reset link. */
    resetNote: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, lineHeight: 1.5, color: LABEL_TERTIARY },
    /** `.reset`: a link-shaped button — no chrome, 12px/1.5, label-secondary. */
    reset: {
      border: "none",
      background: "none",
      padding: 0,
      fontFamily: "inherit",
      fontSize: 12,
      lineHeight: 1.5,
      color: LABEL_SECONDARY,
      cursor: "pointer",
    },
    /** `.footer`: one row, gap 8px, 16px above. */
    footer: { display: "flex", alignItems: "center", gap: 8, paddingTop: 16 },
    /** `.save`: radius-md pill, 5px 14px, 13px, label-primary fill with the layer-3 text colour. */
    save: {
      appearance: "none",
      border: "1px solid transparent",
      borderRadius: RADIUS_MD,
      padding: "5px 14px",
      fontFamily: "inherit",
      fontSize: 13,
      lineHeight: 1.5,
      cursor: "pointer",
      background: LABEL_PRIMARY,
      color: FILL_CONTROL,
    },
    /** `.button.outline`: the secondary action beside the save. */
    discard: {
      appearance: "none",
      border: STROKE_BUTTON,
      borderRadius: RADIUS_MD,
      padding: "5px 14px",
      fontFamily: "inherit",
      fontSize: 13,
      lineHeight: 1.5,
      cursor: "pointer",
      background: "transparent",
      color: LABEL_PRIMARY,
    },
    /** `.failed`: the save's own status line, 12px/1.5 tertiary, stretched like the host's. */
    status: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: LABEL_TERTIARY },
  }

  /** The field bag of the field at `index`: the separator lands on every field but the FIRST. */
  const fieldStyle = (index: number): Record<string, string | number> => (index === 0 ? SKIN.field : { ...SKIN.field, borderTop: STROKE_FIELD })

  /** The control bag of one row: a control the page refuses writes on takes `.input:disabled`. */
  const controlStyle = (off: boolean): Record<string, string | number> => (off ? { ...SKIN.control, ...SKIN.controlOff } : SKIN.control)

  /** The mutable inline-style bag a focus or hover listener writes to (a DOM element's `style`). */
  interface PaintStyle {
    /** One CSS property, written by its camel-cased name. */
    [property: string]: string
  }

  /** The event shape those listeners read: the element the event was dispatched on. */
  interface PaintEvent {
    /** The element itself, whose own `style` is the only thing a paint touches. */
    currentTarget: { style: PaintStyle }
  }

  /** Write one declaration set onto the element an event came from, so inline styles can react. */
  const paint = (event: PaintEvent, declarations: Record<string, string>): void => {
    for (const [property, value] of Object.entries(declarations)) event.currentTarget.style[property] = value
  }

  /** The control's focus pair: the host's `.input:focus-visible` on, and the token pair back off. */
  const CONTROL_FOCUS = {
    /** On focus: the business-primary border, with the ring opted out (the host's own rule). */
    onFocus: (event: PaintEvent): void => paint(event, { borderColor: ACCENT, outline: "none" }),
    /** On blur: clear both, so the inline `border` shorthand and the global ring apply again. */
    onBlur: (event: PaintEvent): void => paint(event, { borderColor: "", outline: "" }),
  }

  /** The reset link's hover pair (`.reset:hover` → label-primary), for a button that reads as a link. */
  const LINK_HOVER = {
    /** Enter: the link darkens to label-primary. */
    onMouseEnter: (event: PaintEvent): void => paint(event, { color: LABEL_PRIMARY }),
    /** Leave: back to label-secondary. */
    onMouseLeave: (event: PaintEvent): void => paint(event, { color: LABEL_SECONDARY }),
  }

  /** The outlined action's hover pair (`.button.outline:hover` → the interactive wash). */
  const BUTTON_HOVER = {
    /** Enter: the wash replaces the transparent fill. */
    onMouseEnter: (event: PaintEvent): void => paint(event, { background: HOVER_WASH }),
    /** Leave: back to transparent. */
    onMouseLeave: (event: PaintEvent): void => paint(event, { background: "transparent" }),
  }

  /** The card component: self-contained markup, no private host components. */
  function createCardComponent(react: ReactSurface, fields: FieldDescriptor[] = FIELDS, readGroups: () => unknown = () => []): (props: CardComponentProps) => unknown {
    /** The element factory, destructured once per component construction. */
    const { createElement } = react
    return function MpdSettingsCard(props: CardComponentProps): unknown {
      /** The card state this render is built from. */
      const state = props.useMpdCard((snapshot) => snapshot)
      /** The translator for this render, or the identity fallback when the host passed none. */
      const t = typeof props.t === "function" ? props.t : (key: string): string => key
      /** Whether every control renders disabled (a read-only page). */
      const disabled = !state.writable
      // The catalog branch this render used. Silent fallback is what hid the defect, so the state
      // is part of the rendered output (and of the data attributes) — never implicit.
      /** The catalog state this render used. */
      const catalog = state.catalog ?? FALLBACK_CATALOG
      /** The live provider groups the slot pickers derive their options from. */
      let groups: CatalogGroup[] = []
      try {
        /** The catalog probe's answer, which counts only when it is a list. */
        const probed = readGroups()
        if (Array.isArray(probed)) groups = probed as CatalogGroup[]
      } catch {
        /* a broken catalog probe degrades the OPTIONS, never the section */
      }
      /** One rendered row per knob, in declaration order (`index` picks the separator). */
      const rows = fields.map((field, index) => {
        /** The row's dotted knob key. */
        const key = fieldKey(field)
        /** The row's control (a knob with no projected control renders an empty input). */
        const control = state.controls[key] ?? { text: "" }
        /** The row's label. */
        const label = t(key)
        // The twelve slot rows carry the fallback marker; the scalar rows are untouched.
        /** The row's hint, with the slot rows carrying the fallback marker. */
        const hint = t(key + ".hint") + (field.path[0] === TEAM_MODEL_SLOT ? slotFallbackMarker(catalog) : "")
        // HUMAN SENTENCE FIRST, at full readability; the row's dotted KEY sits BENEATH it, dimmer.
        // The bridge DISCLOSURE is not here at all any more — it is stated once at the top of the
        // card. Repeating it per row is what buried every row's own sentence (measured in a real
        // browser: 2026-09-27, `05b-mpd-section.png`).
        /** Where the dotted key starts inside the hint. */
        const keyAt = hint.indexOf("mpd.jsonc " + key)
        // The key sits inside parentheses now, so drop the opening one the slice leaves behind.
        /** The human sentence half of the hint. */
        const human = keyAt > 0 ? hint.slice(0, keyAt).replace(/\(\s*$/, "").trim() : ""
        /** The dotted-key half of the hint. */
        const pointer = keyAt < 0 ? hint : hint.slice(keyAt).replace(/\)\s*$/, "").trim()
        /** The hint markup: sentence plus key, or the key alone for a knob with no sentence. */
        const hintNode = human.length === 0
          ? createElement("span", { style: SKIN.keyOnly, "data-mpd-row-key": key }, pointer)
          : createElement(
              "span",
              { style: SKIN.hintBlock },
              createElement("span", { style: SKIN.hint, "data-mpd-row-human": key }, human),
              createElement("span", { style: SKIN.key, "data-mpd-row-key": key }, pointer),
            )
        /** The row's options (select knobs only). */
        const options = field.kind === "select" ? optionsFor(field, groups, state.controls) : []
        /** The row's control markup: a select when options exist, else a text input. */
        const input = field.kind === "select" && options.length > 0
          ? createElement(
              "select",
              { value: control.text, disabled, onChange: (event: ChangeEvent) => props.edit(key, event.target.value), style: { ...controlStyle(disabled), cursor: disabled ? "default" : "pointer" }, ...CONTROL_FOCUS },
              createElement("option", { value: "" }, "—"),
              ...optionElements(createElement, options),
            )
          : createElement("input", {
              value: control.text,
              disabled,
              onChange: (event: ChangeEvent) => props.edit(key, event.target.value),
              style: controlStyle(disabled),
              ...CONTROL_FOCUS,
            })
        return createElement(
          "label",
          { key, style: fieldStyle(index) },
          createElement("span", { style: SKIN.label }, label),
          hintNode,
          input,
          createElement(
            "span",
            { style: SKIN.resetNote },
            (control.overridden ? "overridden · " : "") + (control.invalid ? "not a valid value · " : ""),
            createElement("button", { type: "button", disabled, onClick: () => props.resetField(key), style: SKIN.reset, ...LINK_HOVER }, t("reset")),
          ),
        )
      })
      // VISIBLE AT THE CONTROL: the four team-model pickers sit at the BOTTOM of the rows,
      // where the section's top notice is off-screen — so the SAME sentence renders again
      // immediately above the first slot row (between the 13 scalar rows and the twelve slot rows),
      // in BOTH states. It carries its own `data-mpd-catalog-state`; the top notice keeps its own.
      /** The index of the first slot row (-1 when the field list carries no slot leaf). */
      const slotStart = fields.findIndex((field) => field.path[0] === TEAM_MODEL_SLOT)
      /** The end of the team-model slot rows: the TUI surface's own knob closes the card. */
      const slotEndRaw = slotStart < 0 ? -1 : fields.findIndex((field, index) => index > slotStart && field.path[0] !== TEAM_MODEL_SLOT)
      /** The first row AFTER the twelve slot rows (-1 when nothing trails them). */
      const slotEnd = slotStart < 0 || slotEndRaw < 0 ? fields.length : slotEndRaw
      /** The thirteen scalar rows. */
      const scalarRows = slotStart < 0 ? rows : rows.slice(0, slotStart)
      /** The twelve slot rows. */
      const slotRows = slotStart < 0 ? [] : rows.slice(slotStart, slotEnd)
      /** The rows that trail the slot block (the TUI surface's own knob closes the card). */
      const tailRows = slotStart < 0 ? [] : rows.slice(slotEnd)
      /** The catalog line rendered immediately above the first slot row. */
      const slotLine = createElement(
        "p",
        { style: { ...SKIN.note, margin: "12px 0 4px" }, [CATALOG_ATTR]: catalog.mode, "data-mpd-catalog-notice": "slots" },
        catalogNotice(catalog),
      )
      // Above each slot's THREE rows: the group heading and its one-line impact, so a reader sees
      // who the slot routes before reading a single hint. The rows stay DIRECT children of the card
      // (the heading/impact are siblings, not a wrapper), so every existing row lookup still holds.
      /** The slot rows interleaved with one heading/impact pair per slot. */
      const slotChildren: unknown[] = []
      for (let index = 0; index < slotRows.length; index++) {
        /** The slot this row belongs to. */
        const slot = String(fields[slotStart + index].path[1])
        /** The slot of the row above ("" at the first slot row). */
        const previous = index === 0 ? "" : String(fields[slotStart + index - 1].path[1])
        if (slot !== previous) {
          slotChildren.push(createElement(
            "div",
            { key: "group." + slot, style: SKIN.groupHeading, "data-mpd-slot-group": slot },
            t("teamModels." + slot + ".heading"),
          ))
          slotChildren.push(createElement(
            "p",
            { key: "impact." + slot, style: SKIN.groupImpact, "data-mpd-slot-impact": slot },
            t("teamModels." + slot + ".impact"),
          ))
        }
        slotChildren.push(slotRows[index])
      }
      /** Whether the save is blocked (a read-only page, no staged edit, or an invalid draft). */
      const saveBlocked = disabled || !state.dirty || state.invalid
      return createElement(
        "div",
        { style: SKIN.form },
        createElement("h3", { style: SKIN.title }, t("title")),
        createElement("p", { style: SKIN.description }, t("intro")),
        // The preset explanation sits beside the intro: same hint treatment, one extra sentence.
        createElement("p", { style: SKIN.helpText, "data-mpd-preset-about": "1" }, t("presetAbout")),
        disabled
          ? createElement("p", { style: SKIN.note }, t("readOnly"))
          : null,
        createElement(
          "p",
          {
            style: SKIN.note,
            [CATALOG_ATTR]: catalog.mode,
            "data-mpd-catalog-providers": String(catalog.providers ?? 0),
            "data-mpd-catalog-models": String(catalog.models ?? 0),
          },
          catalogNotice(catalog),
        ),
        // THE DISCLOSURE, ONCE, in its own `.help` block: the same four sentences as before, at the
        // hint size and colour with the host's 8px between paragraphs, so they read as ONE note
        // instead of a second wall of body copy beside the fields.
        createElement(
          "div",
          { style: SKIN.help },
          createElement("p", { style: SKIN.helpText, "data-mpd-disclosure": "bridge" },
            state.disclosure?.BRIDGE_DISCLOSURE ?? ""),
          createElement("p", { style: SKIN.helpText, "data-mpd-disclosure": "restart" },
            state.disclosure?.BRIDGE_RESTART_LIMIT ?? ""),
          // The not-lost clause belongs to the same statement; it used to ride every row's hint.
          createElement("p", { style: SKIN.helpText, "data-mpd-disclosure": "not-lost" },
            NOT_LOST),
          createElement("p", { style: SKIN.helpText, "data-mpd-disclosure": "workspace" },
            state.disclosure?.NO_WORKSPACE_NOTICE ?? ""),
        ),
        // THE SEE-BEFORE-YOU-EDIT BLOCK (R3): the CURRENT EFFECTIVE model config — the four slot
        // routes, the member overrides that are set and the configured modelchain chains — stated
        // ABOVE the rows it describes, so a reader sees what a change modifies before editing.
        createElement(
          "div",
          { style: SKIN.help, "data-mpd-effective": "1" },
          createElement("h4", { style: SKIN.groupHeading }, t("effectiveTitle")),
          ...effectiveChildrenOf(state.effective, t, createElement),
        ),
        ...scalarRows,
        slotLine,
        ...slotChildren,
        ...tailRows,
        createElement(
          "div",
          { style: SKIN.footer },
          createElement("button", { type: "button", disabled: saveBlocked, onClick: () => props.save(), style: { ...SKIN.save, opacity: saveBlocked ? 0.4 : 1 } }, t("save")),
          createElement("button", { type: "button", disabled: !state.dirty, onClick: () => props.discard(), style: SKIN.discard, ...BUTTON_HOVER }, t("discard")),
          createElement("span", { style: SKIN.status }, state.saving ? t("saving") : state.failed ? state.error : state.dirty ? t("unsaved") : ""),
        ),
        state.mode === "memory"
          ? createElement("p", { style: SKIN.note }, t("memoryMode"))
          : null,
      )
    }
  }

  /** The zh/en dictionaries: the TUI section's labels and zh descriptions, plus the card's copy. */
  function dictionaries(fields: FieldDescriptor[] = FIELDS): { en: Record<string, string>; zh: Record<string, string> } {
    /** The English dictionary, extended below with one entry per field. */
    const en: Record<string, string> = {
      nav: "MPD",
      title: "MPD bundle",
      intro: "The mpd.jsonc knobs this bundle's plugins read. namespace mpd · live after save — the model routes resolve per use, no restart",
      // WHAT THIS BUNDLE'S PRESET IS — carried HERE because the preset picker cannot localize it.
      //
      // MEASURED on the installed harness (2026-10-06): a preset's `name`/`description` are plain
      // strings rendered verbatim by `dsh-client-ui-agent-preset`; only the harness's OWN four presets
      // are localized, through a FIXED id table (`BUILT_IN_PRESET_KEYS = { standard, ptc, minimal,
      // cordis }`) whose values are keys in the host client's own dictionary. A third-party preset has
      // no key and no slot, and §6 forbids patching the host's client code — so the MPD preset's own
      // English sentence stays English in every language. This row is the localized explanation on a
      // surface this bundle DOES own.
      presetAbout:
        "The \"MPD (Main Working Agent)\" preset is this bundle's main agent: it reads the project's AGENT.md/AGENTS.md/CLAUDE.md, works natively, consults the 11 specialists through mpd_role_spawn, and runs teams on the official Agent Teams plugin. Its description in the preset picker is supplied by the harness as plain text and is not localizable.",
      save: "Save",
      discard: "Discard",
      reset: "Reset to the file value",
      saving: "Saving…",
      unsaved: "Unsaved",
      readOnly: "This deployment stores settings read-only (a non-loopback page never reaches the host document).",
      memoryMode: "This page is not loopback: settings writes stay process-local and never reach the host document.",
    }
    /** The Simplified-Chinese dictionary, extended below with one entry per field. */
    const zh: Record<string, string> = {
      nav: "MPD",
      title: "MPD 插件包",
      intro: "本插件包读取的 mpd.jsonc 配置项。命名空间 mpd · 保存后即时生效——模型路由按次读取，无需重启",
      // 这个 bundles 的 preset 是什么 —— 放在这里，是因为 preset 选择器无法本地化它。
      presetAbout:
        "「MPD (Main Working Agent)」是本插件包的主工作 agent：读取项目的 AGENT.md/AGENTS.md/CLAUDE.md，原生工作，通过 mpd_role_spawn 一次性咨询 11 位专家，并用官方 Agent Teams 插件跑团队。它在 preset 选择器里的说明由宿主以纯文本提供，无法本地化。",
      save: "保存",
      discard: "放弃",
      reset: "重置为文件值",
      saving: "保存中…",
      unsaved: "未保存",
      readOnly: "当前部署以只读方式存储设置（非回环页面无法写入宿主文档）。",
      memoryMode: "该页面不是回环地址：设置写入仅保留在进程内，不会写入宿主文档。",
    }
    for (const field of fields) {
      /** The row's dotted knob key, which is also its dictionary key. */
      const key = fieldKey(field)
      en[key] = field.label
      zh[key] = field.zh
      en[key + ".hint"] = hintOf(field, "en")
      zh[key + ".hint"] = hintOf(field, "zh")
    }
    // The group heading and its one-line impact, per slot, in BOTH locales: the card renders them
    // above each slot's three rows, so a reader learns the group without parsing a hint sentence.
    for (const [index, slot] of SLOT_SLOTS.entries()) {
      /** The slot's group heading in both locales. */
      const heading = slotHeading(slot, index + 1)
      en["teamModels." + slot + ".heading"] = heading.en
      zh["teamModels." + slot + ".heading"] = heading.zh
      en["teamModels." + slot + ".impact"] = impactOf(slot, "en")
      zh["teamModels." + slot + ".impact"] = impactOf(slot, "zh")
    }
    // The see-before-you-edit block (R3): one composed line per effective slot state and per
    // configured chain. The line bodies are language-neutral ids ({route}, {leaves}, {key},
    // {chain}); every WORD is baked into these entries in the locale's own spelling, so both
    // locales read the same routes under their own words and the render substitutes only fragments.
    en.effectiveTitle = "Effective model config — what a change here modifies (read live, no restart)"
    zh.effectiveTitle = "当前生效的模型配置——改之前先看（实时读取，无需重启）"
    for (const [index, slot] of SLOT_SLOTS.entries()) {
      en["effective.slot." + slot] = `slot ${index + 1} · ${SLOT_GROUPS[slot].en}: {route}`
      zh["effective.slot." + slot] = `槽位 ${index + 1} · ${SLOT_GROUPS[slot].zh}：{route}`
    }
    // The <unconfigured> sentence of a slot line (contract §9): the leaves a slot still needs are NAMED,
    // so the state the spawn would refuse on is visible before it happens.
    en["effective.slotUnconfigured"] = "<unconfigured> — missing {leaves}; configure them here and save, or the next spawn is refused with SLOT_UNCONFIGURED"
    zh["effective.slotUnconfigured"] = "「未配置」——缺少 {leaves}；请在此填写并保存，否则下次生成会被 SLOT_UNCONFIGURED 拒绝"
    // The MALFORMED state is its own sentence (CodeRabbit #4): provider/model may be present, so
    // calling it <unconfigured> would send the reader looking for leaves that are already set.
    en["effective.slotInvalid"] = "<invalid> — {problem}; fix it here and save — until then the next spawn is refused with SLOT_UNCONFIGURED"
    zh["effective.slotInvalid"] = "「无效」——{problem}；请在此修正并保存 —— 在那之前下一次 spawn 会被 SLOT_UNCONFIGURED 拒绝"
    en.effectiveChain = "modelchain.{key} → {chain}"
    zh.effectiveChain = "modelchain.{key} → {chain}"
    en.effectiveNoChains = "modelchain: no configured chains — the shipped defaults are in force"
    zh.effectiveNoChains = "modelchain：未配置任何链——内置默认链生效"
    en.effectiveSourceService = "read from the live config service — refreshed at mount, after card saves, and on settings-document updates"
    zh.effectiveSourceService = "读取自实时配置服务——挂载时、卡片保存后与设置文档更新时刷新"
    en.effectiveSourceDocument = "read from this settings document — the live service route is unavailable ({why}), so the modelchain half is not shown"
    zh.effectiveSourceDocument = "读取自当前设置文档——实时配置路由不可用（{why}），因此未显示 modelchain 部分"
    en.effectiveWhyUnknown = "reason unstated"
    zh.effectiveWhyUnknown = "原因未知"
    return { en, zh }
  }

  /**
   * Mount the section. The namespace's form comes from the harness's `configForms` service, so
   * `ctx.inject` — never a declared dependency (a declared-but-absent service makes the whole page
   * fail as `entry: pending`; `web-client-adapt --self-test` asserts this rule against the built
   * client). One warning on absence, never a throw.
   * @param ctx - the client entry's context.
   * @returns true when the registration was attempted.
   */
  function mountSettingsCard(ctx: CardContext | null | undefined, options: MountOptions = {}): boolean {
    try {
      if (ctx === undefined || ctx === null || ctx.slots === undefined || typeof ctx.slots.inject !== "function") return false
      /** The knobs this mount renders (the shared list unless a caller pinned one). */
      const fields = options.fields ?? FIELDS
      /** The dictionaries this registration serves its labels from. */
      const dicts = dictionaries(fields)
      try {
        if (ctx.locale !== undefined && typeof ctx.locale.register === "function") ctx.locale.register(LOCALE_NS, dicts)
      } catch (error) {
        console.warn("[mpd] settings section: locale registration failed: " + String(error))
      }
      ctx.slots.inject(SECTION_SLOT, function* () {
        try {
          // THE FORM IS THE SCOPE. Until 2026-09-27 this block waited on
          // an injected `settingsScope` service, and that service exists NOWHERE in harness
          // 0.1.7-rc.2 (a grep over every @deepseek-ai/* client bundle returns nothing), so the
          // callback never fired: the Settings dialog rendered General / Models / Built-in
          // plugins / Agent presets with NO mpd section, and — because that path logged nothing
          // — the absence was silent. The harness's own sections reach their namespace through
          // `ctx.configForms.get(ns)`, whose controller carries the SAME shape this card already
          // used (`getSnapshot`, `subscribe`, `set`, `mutate`), so the card is unchanged and
          // only its host object moves.
          // Read it BOTH ways: a real client context exposes services as properties, while a
          // stub context (the offline harness) serves them through `get`. The card must not care
          // which one it is talking to.
          // STILL DEFERRED, and that is the point: `configForms` is provided by ANOTHER plugin's
          // fiber, so a one-shot probe at apply() races it. The DYNAMIC form waits for the
          // provider without parking this boot entry — a declared-but-absent service would turn
          // the whole page into `entry: pending` (the rule `web-client-adapt --self-test` pins).
          ctx.inject(["configForms"], (scoped) => {
            // The context probe answers an untyped service; only the members declared above are read.
            /** The settings forms service, from the property or through `get`. */
            const forms = ((typeof scoped.get === "function" ? scoped.get("configForms") : undefined) ?? scoped.configForms) as SettingsFormsService | undefined
            if (forms === undefined || forms === null || typeof forms.get !== "function") {
              console.warn("[mpd] settings section: this harness exposes no configForms service — the mpd section is not registered")
              return
            }
            /** The form of this section's own configurable entry. */
            const scope = forms.get(CONFIG_ENTRY)
            // ONE diagnostic line, and it is load-bearing: "the section renders but every input is
            // empty" has three possible causes that look identical on screen — the form lookup threw
            // (warned above), the store never fills, or it fills with a shape this card does not read.
            // Printing the snapshot's status and whether a value arrived tells them apart from a
            // capture, without a debugger.
            try {
              /** The form's first snapshot, printed so an empty card is diagnosable. */
              const first = scope?.getSnapshot?.()
              console.log("[mpd] settings section: form status=" + String(first?.status) + " value=" + (first?.value === undefined ? "absent" : "present") + " writable=" + String(first?.writable) + " mode=" + String(first?.mode))
              if (typeof scope?.subscribe === "function") scope.subscribe(() => {
                /** The form's snapshot after the change that fired this line. */
                const now = scope.getSnapshot?.()
                console.log("[mpd] settings section: form updated status=" + String(now?.status) + " value=" + (now?.value === undefined ? "absent" : "present"))
                // A settings-document change can come from ANOTHER front door (a TUI save, a hand
                // edit), not only from this card's own save, so the live-service read is re-run on
                // every scope update; the read's sequence guard keeps an older answer from clobbering
                // the fresher one.
                readLiveService()
              })
            } catch (error) {
              console.warn("[mpd] settings section: snapshot probe failed: " + String((error as { message?: unknown })?.message ?? error))
            }
            // The LIVE catalog: injected (never probed), subscribed, and re-projected into the
            // card's own store on every change. Started BEFORE the registration so the first
            // render already carries the real list when the providers are up.
            /** The live catalog this card follows. */
            const catalog = createLiveCatalog(ctx)
            /**
             * The live-service re-reader for the effective block (R3); assigned right after the
             * controller exists because the controller's SAVE HOOK must call it. Reads
             * `/plugins/mpd/model-config` — the route the bundle's server half serves from the
             * `mpdConfig` service — at mount, after every successful save and on every
             * settings-scope update, through the ENTRY's injected reader (this card does no I/O of
             * its own); without a reader the block degrades to the settings-document branch with a
             * notice.
             */
            /** The entry's JSON reader, when this client provides one. */
            const fetchJson = options.fetchJson
            /** The live-service re-reader; assigned right below, once the controller it calls exists. */
            let readLiveService: () => void = (): void => {}
            /**
             * The number of the newest live-service read. Concurrent reads (a mount, a save and a
             * settings-scope update can overlap) answer in arbitrary order, so each read takes a
             * ticket and only the newest ticket's answer is applied — a stale answer landing late
             * must not clobber a fresher projection.
             */
            let liveReadSeq = 0
            // An absent form is the probe path above (it renders its warning); the controller's own
            // guarded calls keep the same behaviour the untyped original had for that case.
            /** The card's form controller, bound to the resolved scope and the save hook. */
            const controller = createMpdCardController(scope as SettingsScope, fields, undefined, () => catalog.info(), () => { readLiveService() })
            readLiveService = (): void => {
              if (typeof fetchJson !== "function") {
                controller.setLiveService(undefined, "this runtime provides no reader for the live config route")
                return
              }
              /** This read's ticket: its answer applies only while it is still the newest read. */
              const seq = ++liveReadSeq
              fetchJson(MODEL_CONFIG_PATH)
                .then((body: unknown) => {
                  if (seq !== liveReadSeq) return
                  /** The body narrowed to the two fields the route serves. */
                  const parsed = (body !== null && typeof body === "object" ? body : {}) as { ok?: unknown; reason?: unknown }
                  if (parsed.ok === true) controller.setLiveService(body, "")
                  else controller.setLiveService(undefined, typeof parsed.reason === "string" && parsed.reason !== "" ? parsed.reason : "the route answered without a body")
                })
                .catch((error: unknown) => {
                  if (seq !== liveReadSeq) return
                  controller.setLiveService(undefined, String((error as { message?: unknown })?.message ?? error))
                })
            }
            readLiveService()
            /** The catalog subscription that re-projects the card. */
            const unsubscribeCatalog = catalog.subscribe(() => {
              controller.refresh()
            })
            catalog.start()
            // The slot leaves render their option lists from the LIVE catalog on every render.
            // The host's React module is untyped here, so its used surface is asserted (type-level).
            /** The card component, bound to the live catalog probe. */
            const Section = createCardComponent(require("react") as ReactSurface, fields, () => catalog.groups())
            // The host's descriptor: id + explicit order + a label resolved through this
            // registration's locale dictionaries. `children` is omitted because this section
            // renders no nested slot of its own.
            /** The unregister function the slot registry answered with. */
            const unregister = ctx.slots.register(
              { name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },
              Section,
            )
            return () => {
              try {
                unregister()
              } catch {
                /* the slot may be gone */
              }
              try {
                unsubscribeCatalog()
              } catch {
                /* already unsubscribed */
              }
              catalog.dispose()
              controller.dispose()
            }
          })
        } catch (error) {
          console.warn("[mpd] settings section: could not mount the mpd section: " + String(error))
        }
        yield undefined
      })
      return true
    } catch (error) {
      console.warn("[mpd] settings section: slot registration failed: " + String(error))
      return false
    }
  }

  /** Everything the offline harness and the bundle's client entry consume from this factory. */
  return {
    mountSettingsCard,
    createMpdCardController,
    createCardComponent,
    dictionaries,
    createLiveCatalog,
    catalogNotice,
    optionsFor,
    optionElements,
    FIELDS,
    effectiveModelConfigOf,
    effectiveChildrenOf,
    MODEL_CONFIG_PATH,
    SETTINGS_NS: NS,
    LOCALE_NS,
    SECTION_SLOT,
    SECTION_ID,
    SECTION_ORDER,
    BRIDGE_DISCLOSURE,
    BRIDGE_RESTART_LIMIT,
    NO_WORKSPACE_NOTICE,
    CATALOG_ATTR,
    CATALOG_FALLBACK_NOTICE,
  }
}
