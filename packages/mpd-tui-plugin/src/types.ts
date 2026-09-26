// Structural host types for the DSH-TUI seams.
//
// This package carries NO runtime dependency (AGENTS.md §6: zero runtime deps
// preferred) and does not import cordis or any `@deepseek-ai/*` package at type
// level either: the host's `Context` and its `tui*` services are consumed
// through the cordis DEFERRED inject form (`ctx.inject([id], scoped => …)`), so
// everything below is the minimal shape this plugin actually touches. A host
// release that reshapes a service therefore degrades here (the seam reports
// `absent`/`refused`) instead of failing to compile or to load.
//
// Harness seams (tools / skills / agent registry / subagents) never appear here —
// they go through packages/mpd-dsh-adapter-plugin. The `tui*` services,
// `ctx.commands` and `ctx.settings` are host services consumed through the same
// inject form, which is the host's documented idiom
// (see `.mpd/recon/spec-history/plugin-admission-and-development.md`).

/** A cleanup function; every seam registration returns one. */
export type Disposer = () => void

/** How one optional seam actually turned out, as measured rather than assumed. */
export type SeamState =
  /** A host read-back proves the registration (e.g. `tuiShortcuts.list()`). */
  | "confirmed"
  /** The host accepted the call but exposes no read-back; NOT claimed as registered. */
  | "requested"
  /** The service is reachable and the seam is request-based (nothing to register). */
  | "available"
  /** The service was never injected in this composition. */
  | "absent"
  /** The call threw, or a read-back shows the registration did not happen. */
  | "refused"

export interface SeamOutcome {
  state: SeamState
  detail?: string
}

/** The logging subset this plugin uses (cordis `ctx.logger(name)` or a bare logger). */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  debug?(message: string): void
  error?(message: string): void
}

/** The subset of the cordis context this plugin uses. */
export interface PluginContextLike {
  /**
   * `ctx.inject([id], scoped => …)` — the DEFERRED optional-seam form. The
   * callback runs when the service is composed; a service that never appears
   * never runs it. This is what makes a service reachable at all (T4-INERT-1).
   */
  inject?(dependencies: readonly string[], callback: (scoped: PluginContextLike) => void): unknown
  /** `ctx.get(id, false)` — soft probe, valid only for services the row injected. */
  get?(name: string, strict?: boolean): unknown
  /** `ctx.effect(() => cleanup, label)` — fiber-owned cleanup. */
  effect?(callback: () => Disposer | void, label?: string): unknown
  logger?: LoggerLike
  [key: string]: unknown
}

/** `ctx.tuiStatus` — keyed status-line contributions. */
export interface TuiStatusLike {
  set(key: string, text: string | number | boolean | undefined, identity?: unknown): Disposer | undefined
}

/** What a transcript renderer returns (host `TuiEntryRenderResult`). */
export interface TuiRenderResult {
  title?: string
  lines: string[]
}

/** `ctx.tuiRenderers` — log-only session event -> transcript text rows. */
export interface TuiRenderersLike {
  register(type: string, renderer: (payload: unknown) => TuiRenderResult | undefined, identity?: unknown): Disposer | undefined
}

/** `ctx.tuiSettingsSections` — one `/settings` section declaration. */
export interface TuiSettingsSectionLike {
  ns: string
  title: string
  descriptions?: Record<string, string>
  fields: readonly TuiSettingsFieldLike[]
}

export interface TuiSettingsFieldLike {
  path: readonly string[]
  label: string
  descriptions?: Record<string, string>
  hint?: string
  kind: "text" | "number" | "boolean" | "select"
  options?: readonly { value: string; label: string; descriptions?: Record<string, string> }[]
  placeholder?: string
}

export interface TuiSettingsSectionsLike {
  register(section: TuiSettingsSectionLike): Disposer | undefined
}

/** Props the host passes to a plugin scene (`TuiSceneProps`). */
export interface TuiScenePropsLike {
  /** The TUI's own React instance — every hook and element must use it. */
  React: any
  /** The TUI's ui kit (`Box`, `Text`, `useInput`, `useTerminalSize`, …). */
  ui: any
  /** Live session channel (observer only). */
  channel?: any
  /** Leave the scene. */
  close(): void
}

/** `ctx.tuiScenes` — full-screen plugin scenes. */
export interface TuiScenesLike {
  register(descriptor: { id: string; title?: string; component: unknown }, identity?: unknown): Disposer | undefined
  open(id: string): boolean
}

/** `ctx.tuiCommandTrees` — subcommand completion for one command root. */
export interface TuiCommandTreesLike {
  register(provider: {
    root: string
    descriptions?: Record<string, string>
    children(canonicalPath: readonly string[]): readonly { name: string; description: string; descriptions?: Record<string, string> }[]
  }): Disposer | undefined
}

/** `ctx.tuiShortcuts` — global keyboard bindings. */
export interface TuiShortcutsLike {
  register(combo: string, options: { description: string; handler: () => void | Promise<void> }, identity?: unknown): Disposer | undefined
  /** Read-back owned by the calling activation — the honest confirmation source. */
  list?(): readonly { combo: string; description: string }[]
}

/** `ctx.tuiDialogs` — host-managed modal dialogs. */
export interface TuiDialogsLike {
  select(request: {
    title: string
    options: readonly { id: string; label: string; description?: string }[]
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<string | undefined>
  confirm(request: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; timeoutMs?: number }): Promise<boolean | undefined>
  input(request: { title: string; placeholder?: string; initial?: string; timeoutMs?: number }): Promise<string | undefined>
}

/** `ctx.tuiPluginHost` — the mediated DecisionEvents activation surface. */
export interface TuiPluginHostLike {
  subscribeDecision(
    pluginCtx: unknown,
    event: string,
    listener: (payload: Record<string, unknown>) => unknown,
    options?: { scope?: string; order?: string },
  ): Disposer | undefined
  probeDecisionEvents?(): readonly string[]
  /**
   * Caller-safe grant facade. `allows` is the documented source of truth for
   * "is this activation authorised for permission@scope" — the ONE honest signal
   * that does not require calling a disposer as a probe (reviewer direction for
   * T10-F1).
   */
  grants?: {
    allows(pluginCtx: unknown, permission: string, scope: string): boolean
    defaultOf?(permission: string): "allow" | "deny"
  }
}

/** `ctx.commands` — the harness command registry (`/mpd`). */
export interface CommandsLike {
  register(definition: {
    name: string
    description: string
    handler: (invocation: { rawInput: string; agent?: { session?: SessionLike } }) =>
      | { kind: "success"; text?: string }
      | { kind: "error"; text: string }
      | Promise<{ kind: "success"; text?: string } | { kind: "error"; text: string }>
  }): Disposer | undefined
}

/** The live Session subset this plugin reads (append of a log-only event). */
export interface SessionLike {
  append?(type: string, data: unknown): unknown
  header?: { cwd?: string }
}

/** `ctx.settings` — the harness settings service (namespace registration). */
export interface SettingsProviderLike {
  register(ns: string, schema: unknown, options?: unknown): unknown
  /** The provider's read surface, used ONLY to probe whether a namespace is already served. */
  get?(ns: string): unknown
  /** Served namespaces, when the provider can enumerate them (the documented guard input). */
  describe?(): unknown
}
