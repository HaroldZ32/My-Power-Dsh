// mpd-tui — the DSH-TUI native surfaces of the @mpd-dsh/mpd bundle.
//
// This package gives the bundle a TUI face: a keyed status line, transcript
// renderers for the bundle's log-only session events, a `/settings` section, a
// full-screen board scene, a `/mpd` command with subcommand completion, keyboard
// shortcuts and mediated dialogs — plus the decision-event seam built READY but
// deliberately NOT ACTIVATED (see `decisions.ts`).
//
// It stands in for the web-only surfaces (agent-teams sidebar, workmate tab,
// bundle floater) with TUI-native equivalents; that is not a pixel/feature
// parity claim (plan NOT-CLAIMED W-3).
//
// ACTIVATION (T4-INERT-1): every optional service is reached through cordis's
// DEFERRED inject form — `ctx.inject(['<service>'], scoped => …)`. A plain
// `ctx.get(id, false)` at apply time returns undefined for a service the row has
// not injected, which is why the first version of this package registered nothing
// in a real boot (`evidence/tui/plugin/20260915T054343Z/mount-instrumentation/
// FINDING.md`). The BLOCKING `export const inject = [...]` form is NOT used: it
// leaves the optional `tui*` services absent and can leave the row pending.
//
// HONESTY: every seam reports a `SeamOutcome`; `confirmed` requires a host
// read-back, `requested` means "the host accepted the call but cannot confirm
// it", and nothing is inferred from a disposer's type (reviewer direction for
// T10-F1).
//
// Plugin contract (hard requirement of this row):
//   * pure ESM, `.js` suffixes on relative imports;
//   * `name` / `Config` (type) / `Config` (schemastery schema) / `apply`, and NO
//     default export;
//   * every config key defaulted, in the schema AND in the resolver;
//   * cleanup through `scoped.effect` (the injected scope's fiber);
//   * never a thrown boot failure — this row must be inert in a web composition
//     and live in a dsh-tui composition.
//
// The row id (`mpd-tui`) and the module specifier
// (`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`) belong to the bundle
// patch — this package deliberately ships NO `cordis.patch.yml`, because a second
// mount would duplicate a loader entry id.
import { homedir } from "node:os"
import { t } from "./i18n.js"
// The Config schema comes from the schemastery copy the bundle ALREADY vendors
// (packages/mpd-agent-teams-plugin/_deps/schemastery): this package declares no
// dependency of its own and resolves nothing over the network. It is the one
// relative specifier that names a PACKAGE DIRECTORY (resolved through that copy's
// own package.json, which carries both `exports.import` and `types`) — every
// relative FILE import in this package carries an explicit extension.
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { PluginContextLike, SeamOutcome, SessionLike, TuiAdapter } from "./types.js"
import { createLog, type Log } from "./log.js"
import { onService, reportOutcomes, resolveTuiAdapter, serviceOf } from "../../mpd-tui-adapter-plugin/src/index.js"
import { AMBIGUOUS_MULTI_ROOT_NOTICE, NO_LIVE_SESSION_NOTICE, readBoardState } from "./state.js"
import { registerStatus } from "./status.js"
import { registerRenderers } from "./renderers.js"
import { registerSettingsSection } from "./settings.js"
import { DASHBOARD_TAKEOVER_KNOB } from "./settings.js"
import { readDashboardWorkflow, registerDashboardKey } from "./dashboard-key.js"
import { registerPanelSurface, takeoverArmed } from "./panel.js"
import type { PanelOpenOutcome } from "./panel.js"
import { boardSummary, registerScene, type PlanActionOutcome, type PlanActions } from "./scenes.js"
import { readPlanView, type MpdPlanView } from "./team-state.js"
import { liveTeamViews, mpdTeamRecords, type MpdTeamsLike } from "./team-state.js"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"
import type { DshLiveAgent, DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { registerCommandTrees } from "./command-trees.js"
import { registerShortcuts } from "./shortcuts.js"
import { createDialogs } from "./dialogs.js"
import { attachWatchdogFrontDoor, composeNotices, type WatchdogFrontDoor } from "./watchdog.js"
import { attemptDecisionEvents } from "./decisions.js"
import { appendBoardOpened, registerCommands } from "./commands.js"
import { openModelMenu } from "./model-menu.js"
import { BOARD_OPENED_EVENT, registerLogOnlyEventType } from "./registration.js"
import { scalarText } from "./sanitize.js"

/** The plugin name (the bundle patch row id is `mpd-tui`). */
export const name = "mpd-tui"

/** Configurable knobs; every key has a default in both the schema and the resolver. */
export type Config = {
  /** Publish the keyed status-line contribution. */
  statusLine?: boolean
  /** Status refresh cadence in ms; 0 keeps it manual (shortcut/command only). */
  statusIntervalMs?: number
  /** Register transcript renderers for the bundle's log-only session events. */
  renderers?: boolean
  /** Declare the `/settings` section for the mpd.jsonc knobs. */
  settingsSection?: boolean
  /** Register the full-screen board scene. */
  scene?: boolean
  /** Register the `/mpd` command-tree completion provider. */
  commandTrees?: boolean
  /** Register the `/mpd` command itself (the scene entry point). */
  commands?: boolean
  /** Register the keyboard shortcuts. */
  shortcuts?: boolean
  /** Enable the mediated dialog facade. */
  dialogs?: boolean
  /**
   * Contribute the sidebar panel and route `alt+a` / `/mpd panel` through it (dsh-tui 0.13.0+). With
   * the surface off, both entry points keep the pre-panel path: the full-screen merged scene.
   */
  panel?: boolean
  /**
   * Enable the Ctrl+A takeover — MEANINGFUL ON OLD dsh-tui BUILDS ONLY.
   *
   * On a host WITHOUT the sidebar panel seam (every dsh-tui before 0.13.0) the takeover intercepts
   * Ctrl+A while MPD's team projection has a team with at least one task, opening MPD's merged view
   * instead of the host's own subagent dashboard; with no team the key passes through. On a host that
   * OFFERS the panel seam (0.13.0+) the contact stays INERT — Ctrl+A keeps its host dashboard meaning
   * and the merged view opens through `alt+a` / `/mpd panel`, both of which route through the panel
   * (see `panel.ts`). This key is the FLOOR of the toggle: a saved `tui.dashboardKey` (the /settings
   * row) outranks it per press.
   */
  dashboardKey?: boolean
  /** Append the log-only board-opened session record (only when verified safe). */
  sessionEvents?: boolean
  /** Attempt the mediated DecisionEvents registration (expected: refused). */
  decisionEvents?: boolean
  /** Diagnostic prefix. */
  logPrefix?: string
}

/**
 * Explicit annotation: the inferred schemastery type walks through cosmokit's
 * `Dict` under a virtual path, which is not portable in declaration emit; the
 * global `Schemastery` interface comes from schemastery's own declarations.
 */
export const Config: Schemastery<Config> = z.object({
  statusLine: z.boolean().default(true),
  statusIntervalMs: z.number().default(3000),
  renderers: z.boolean().default(true),
  settingsSection: z.boolean().default(true),
  scene: z.boolean().default(true),
  commandTrees: z.boolean().default(true),
  commands: z.boolean().default(true),
  shortcuts: z.boolean().default(true),
  dialogs: z.boolean().default(true),
  panel: z.boolean().default(true),
  dashboardKey: z.boolean().default(true),
  sessionEvents: z.boolean().default(true),
  decisionEvents: z.boolean().default(true),
  logPrefix: z.string().default("mpd-tui"),
})

/** A config with every key resolved (nothing optional left). */
export interface ResolvedConfig {
  /** Whether the keyed status contribution is published at all. */
  statusLine: boolean
  /** Refresh cadence in milliseconds; 0 keeps the line manual. */
  statusIntervalMs: number
  /** Whether the log-only session events get transcript renderers. */
  renderers: boolean
  /** Whether the `/settings` section and the `mpd` namespace are declared. */
  settingsSection: boolean
  /** Whether the board, team and plan scenes are registered. */
  scene: boolean
  /** Whether the `/mpd` completion provider is registered. */
  commandTrees: boolean
  /** Whether the `/mpd` command itself is registered. */
  commands: boolean
  /** Whether the keyboard bindings are registered. */
  shortcuts: boolean
  /** Whether the mediated dialog facade is enabled. */
  dialogs: boolean
  /** Whether the sidebar panel surface is contributed and the merged-view opens route through it. */
  panel: boolean
  /** Whether the Ctrl+A takeover may intercept at all (the per-press floor of the toggle). */
  dashboardKey: boolean
  /** Whether the log-only board-opened record may be appended. */
  sessionEvents: boolean
  /** Whether the mediated decision-event registration is attempted. */
  decisionEvents: boolean
  /** The `[tag]` prefix of every diagnostic this row emits. */
  logPrefix: string
}

/**
 * Apply the documented defaults to a (possibly partial) config.
 * @param config - the row config, already schema-validated by the loader.
 * @returns the resolved config with no optional key left.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  /** Coerces one optional boolean to the documented default. */
  const bool = (value: boolean | undefined, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback)
  /** Whether the configured cadence is a usable, non-negative finite number. */
  const valid = typeof config.statusIntervalMs === "number" && Number.isFinite(config.statusIntervalMs) && config.statusIntervalMs >= 0
  return {
    statusLine: bool(config.statusLine, true),
    statusIntervalMs: valid ? (config.statusIntervalMs as number) : 3000,
    renderers: bool(config.renderers, true),
    settingsSection: bool(config.settingsSection, true),
    scene: bool(config.scene, true),
    commandTrees: bool(config.commandTrees, true),
    commands: bool(config.commands, true),
    shortcuts: bool(config.shortcuts, true),
    dialogs: bool(config.dialogs, true),
    panel: bool(config.panel, true),
    dashboardKey: bool(config.dashboardKey, true),
    sessionEvents: bool(config.sessionEvents, true),
    decisionEvents: bool(config.decisionEvents, true),
    logPrefix: typeof config.logPrefix === "string" && config.logPrefix.length > 0 ? config.logPrefix : "mpd-tui",
  }
}

/**
 * The one adapter this row uses, resolved once at apply.
 *
 * `ctx.get("mpdDsh")` is the mounted instance (the normal case); the fallback keeps
 * this row standalone in unit tests. Every harness seam this package needs — the
 * workspace roots, the live-agent registry and the internal tool call — goes
 * through this ONE object (AGENTS.md §6).
 * @param ctx - the plugin context.
 * @returns the adapter.
 */
function resolveAdapter(ctx: PluginContextLike): ReturnType<typeof createDshAdapter> {
  try {
    /** The adapter instance another row mounted, when the probe can read it. */
    const mounted = serviceOf<ReturnType<typeof createDshAdapter>>(ctx, "mpdDsh")
    if (mounted !== undefined) return mounted
  } catch {
    // fall through to a standalone adapter
  }
  return createDshAdapter(ctx)
}

/**
 * Resolve the workspace root per call, never cached.
 *
 * The live session cwd is the authoritative workspace (AGENTS.md §6). This row is
 * agentless (a TUI surface, no tool exec), so it asks the adapter for the union
 * of live session workspaces and falls back to the adapter's exec-less
 * resolution (`DSH_WORKSPACE_ROOT` → process cwd).
 * @param ctx - the plugin context.
 * @param adapter - the resolved adapter (created here when omitted, for standalone use).
 * @returns the per-call workspace resolver.
 */
export function workspaceResolver(ctx: PluginContextLike, adapter?: ReturnType<typeof createDshAdapter>): () => string {
  /** The adapter this resolver reads, undefined until one is supplied or created. */
  let resolved = adapter
  if (resolved === undefined) {
    try {
      resolved = resolveAdapter(ctx)
    } catch {
      resolved = undefined
    }
  }
  return () => {
    try {
      /** The union of live session workspaces; empty when no session is live. */
      const roots = resolved?.workspaceRootsAll() ?? []
      if (roots.length > 0) return roots[0]
    } catch {
      // fall through to the exec-less resolution
    }
    try {
      return resolved?.workspaceRoot() ?? process.cwd()
    } catch {
      return process.cwd()
    }
  }
}

/**
 * Build the approval executor: the plan surface's ONLY mutation path.
 *
 * Both mutations are ADOPTED tool calls through the adapter (frozen §6.1) — the TUI
 * never re-implements the runtime the Web route drives and never writes team state.
 * The calling agent is sourced from the adapter's own live registry and is passed as
 * the adapter's optional `agent`, which forwards it verbatim as `exec.agent` — the
 * adopted write tools require one (`lib/tools.ts:65-71`).
 *
 * IT MUST BE THE REGISTRY'S OWN OBJECT, never a look-alike. A hand-built
 * `{ session: { id } }` reached the harness and was refused by its session store
 * (`session "<id>" is not live in this store`), because a caller is authenticated by
 * IDENTITY against the live store (measured: evidence/tui/team-surface-h3-fixed/
 * 20260930T104228Z, arm 2 H4). So the resolution is `liveAgent(sessionId)`, else a
 * live entry whose own `session.id` matches, else the ONE live agent when the scene
 * carries no id at all — and an honest refusal when none of those names a caller.
 *
 * Every refusal is LOUD and never a fabricated success: an unregistered tool, no
 * matching live session (the Web route's own 409 case) and a tool error all come back
 * as `{ok:false, error}`, and the two caller-less cases are refused BEFORE the call.
 * @param adapter - the resolved adapter.
 * @param log - diagnostics.
 * @returns the executor.
 */
export function createPlanActions(adapter: ReturnType<typeof createDshAdapter>, log: Log): PlanActions {
  // ── THE EXECUTOR IS REAL AGAIN (W6) ────────────────────────────────────────
  // It used to be PERMANENTLY unavailable, on the premise that the two tools it called were retired
  // and the official plane had no replacement. That premise is half true and was read as wholly true:
  // the RETIRED vendored plugin's tools are gone, and the OFFICIAL plane has no approval — but THIS
  // BUNDLE registers one. `mpd-team-core` owns the staged plan and exposes
  // `agent_teams_plan {action:"approve"}`, which materialises the mpd record and raises the members
  // through the NATIVE executor. So the surface can act, and refusing was telling the user that
  // approval was impossible when it was one call away.
  /** The tool that owns the staged plan and its approval. */
  const PLAN_TOOL = "agent_teams_plan"
  /**
   * The session id a live registry entry serves, read defensively.
   *
   * The adapter types `session` as opaque (`DshLiveAgent.session: unknown`), so this is the
   * only place that assumes its documented `{ id }` shape — and it assumes nothing when the
   * shape is not there, returning undefined instead of a guess.
   * @param agent - one live registry entry.
   * @returns the session id, or undefined when this entry carries none.
   */
  const sessionIdOfAgent = (agent: DshLiveAgent): string | undefined => {
    /** The opaque `session` viewed as the record the harness serves. */
    const session = agent?.session as { id?: unknown } | undefined
    return typeof session?.id === "string" ? session.id : undefined
  }
  /**
   * The LIVE agent this call speaks as, or undefined when this composition cannot name one.
   *
   * The returned object is the registry's OWN entry — the harness authenticates a caller by
   * identity, so a structural copy (`{ session: { id } }`) is refused at the session store
   * exactly as the measured H4 failure was. Nothing here ever builds one.
   * @param sessionId - the session the scene acts for, when its live channel published one.
   * @returns the live agent, or undefined (the caller then refuses instead of pretending).
   */
  const liveAgentFor = (sessionId?: string): DshLiveAgent | undefined => {
    // An adapter build predating this seam cannot name a live agent at all; that is a refusal,
    // never a licence to hand the tool a stand-in.
    if (typeof adapter.liveAgent !== "function" || typeof adapter.liveAgents !== "function") return undefined
    /** The id to match, normalized so an empty string can never select a live entry. */
    const wanted = typeof sessionId === "string" ? sessionId : ""
    try {
      if (wanted !== "") {
        /** The registry's answer for that id; the id IS the shared session/agent id. */
        const byId = adapter.liveAgent(wanted)
        if (byId !== undefined) return byId
        // A host may key an agent by its OWN id while the TUI channel publishes the SESSION id, so
        // the scan below is the same match one level in — still a real Agent, still by identity.
        return adapter.liveAgents().find((candidate) => sessionIdOfAgent(candidate) === wanted)
      }
      /** Every live agent, for the scene that carries no id at all. */
      const live = adapter.liveAgents()
      // No id means nothing to match on, so only the UNAMBIGUOUS case is taken: one live agent is
      // this pane's session, while several would be a guess at another session's staged plan.
      return live.length === 1 ? live[0] : undefined
    } catch {
      // A throwing registry refuses the call; it must never escape into a render.
      return undefined
    }
  }
  /**
   * Call the plan tool and project its result into the scene's own outcome shape.
   * @param args - the tool arguments (the `action`, plus whatever that action needs).
   * @param sessionId - the session the scene acts for (its live channel's id, or the captain's).
   * @returns the outcome; a failure carries the tool's own message, never a fabricated success.
   */
  const call = async (args: Record<string, unknown>, sessionId?: string): Promise<PlanActionOutcome> => {
    // THE CALLER IS THE LIVE SESSION THE SCENE BELONGS TO. `agent_teams_plan` resolves its workspace
    // and session from the exec it is handed, so a call without one lands on the process cwd instead
    // of the caller's workspace — which is how a surface can appear to approve "nothing". And a call
    // with a hand-built stand-in is refused by the harness's liveness check. Both are worse than the
    // honest refusal below, which says what is missing and states that NOTHING was called.
    /** The live registry entry this call speaks as; undefined when no live one matches. */
    const agent = liveAgentFor(sessionId)
    if (agent === undefined) {
      /** The refusal's message, naming the missing caller and the fact that no call was made. */
      const error = typeof sessionId === "string" && sessionId !== ""
        ? `session "${scalarText(sessionId, 80) ?? sessionId}" is not live in this process — no live agent to speak as, so nothing was called`
        : "no live agent to speak as and no session id on this surface — nothing was called"
      log.warn(`plan ${String(args.action)} refused: ${scalarText(error, 200) ?? error}`)
      return { ok: false, error }
    }
    try {
      /** The harness's own result for this call; the LIVE agent rides it by identity. */
      const result = await adapter.executeTool({ name: PLAN_TOOL, arguments: args, agent })
      if (result.ok && !result.isError) return { ok: true, ...(result.value === undefined ? {} : { value: result.value }) }
      return { ok: false, error: typeof result.error === "string" ? result.error : JSON.stringify(result.error ?? result.raw ?? "the call failed") }
    } catch (error) {
      // A throwing seam must redden the outcome, never escape into a render.
      log.warn(`plan ${String(args.action)} failed: ${String((error as Error)?.message ?? error)}`)
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  }
  return {
    // AVAILABILITY IS ASKED, NOT ASSUMED. A composition without the team row has no plan tool, and
    // saying "available" there would render a gate whose chord can only fail.
    available: () => {
      try {
        return adapter.hasTool(PLAN_TOOL)
      } catch {
        return false
      }
    },
    // THE PHRASE GATE IS KEPT AND RE-POINTED (user decision, 2026-09-30): the scene demands the plan
    // id, and the confirmation travels with the call so a caller that skipped the gate is refused by
    // the tool rather than by this executor's good manners.
    approve: async (input: { teamId: string; confirmation: string; captainSessionId?: string; sessionId?: string }) =>
      call({ action: "approve", confirmation: input.confirmation }, input.sessionId ?? input.captainSessionId),
    // Discard archives the staged plan; `mpd-team-core` owns that action, and the scene arms it with
    // its own second-press window.
    discard: async (input: { captainSessionId?: string; sessionId?: string }) =>
      call({ action: "delete" }, input.sessionId ?? input.captainSessionId),
  }
}

/** The user's home directory — the workmate library lives under it by design. */
function homeDir(): string {
  /** The `HOME` environment value, preferred over the platform call for testability. */
  const env = process.env.HOME
  if (typeof env === "string" && env.length > 0) return env
  try {
    return homedir()
  } catch {
    return ""
  }
}

/** What `apply` publishes for diagnostics and for the tests. */
export interface ApplyReport {
  /** One line per seam/role, in wiring order. */
  outcomes: readonly { id: string; outcome: SeamOutcome }[]
  /** Whether the log-only event type verified as known to a live dsh-session copy. */
  sessionEventTypeKnown: boolean
}

/**
 * Wire every TUI surface of the bundle.
 * @param ctx - the cordis context (session services composed).
 * @param config - the validated row config (schema defaults applied).
 * @returns the per-seam outcome report (also logged).
 */
export function apply(ctx: PluginContextLike, config: Config = {}): ApplyReport {
  /** The config with every key resolved, so nothing optional is left below. */
  const resolved = resolveConfig(config)
  /** The one adapter every harness seam of this row goes through. */
  const adapter = resolveAdapter(ctx)
  /** The ONE DSH-TUI seam adapter: every `tui*` service, `commands` and `settings` goes through it. */
  const tui: TuiAdapter = resolveTuiAdapter(ctx)
  /** The per-call workspace resolver (the calling session's workspace, never the process cwd). */
  const workspaceRoot = workspaceResolver(ctx, adapter)
  /** The prefixed diagnostic sink: the host logger when present, else a FILE (never a terminal). */
  const log: Log = createLog(ctx?.logger, resolved.logPrefix, process.env, () => tui.diagnosticSink({ root: workspaceRoot }))
  /** The per-call home resolver; the workmate library lives under it by design. */
  const home = (): string => homeDir()
  // The OFFICIAL team readout for the CURRENT workspace, resolved per call through the adapter
  // (never cached: one host serves many sessions with different workspaces). Every team surface —
  // the board, the status line, the workflow scene and the plan scene — reads it through this ONE
  // provider, so a missing seam degrades them together (`[]`) instead of one at a time.
  const teamViews = (): readonly DshTeamView[] => liveTeamViews(adapter, workspaceRoot())
  // ── THE PRIMARY TEAM SOURCE: the mpd-owned record ────────────────────────
  // `mpdTeams` is another plugin's service, so it is reached with the deferred inject form (a
  // one-shot probe cannot see it, and a declared dependency would park this entry). It is read PER
  // CALL and never cached: one host serves many sessions with different workspaces.
  //
  // This is the difference that makes the team plane work at all in a `dsh-tui` composition, where
  // the official service cannot mount (`TeamService` registers through a ROOT-bound proxy and the
  // dsh-tui host refuses `root.effect` from a plugin activation). With the mpd row present the
  // scenes read a team that exists; with it absent they fall back to the official readout, so this
  // package still works mounted alone.
  let teamsService: MpdTeamsLike | undefined
  onService(ctx, "mpdTeams", (_scoped: PluginContextLike, service: unknown) => {
    teamsService = service as MpdTeamsLike
  })
  /** The mpd team records for the CURRENT workspace, resolved per call; `[]` when the row is absent. */
  const teamRecords = (): readonly TeamRecord[] => mpdTeamRecords(teamsService, workspaceRoot())
  // THE SHARED PLAN READER. The service face is the SAME projection the Web panel's `/plan` route
  // serves, so the two surfaces cannot disagree about what is staged or what phrase the gate demands.
  // The workspace is resolved per CALL (§6) and the session id comes from the scene's own live channel.
  /** Read the staged plan of one session, or undefined when this composition exposes no plan face. */
  // `teamsService` is a LATE-BOUND variable, not a function: the service arrives after apply, so it
  // is read at call time and may still be undefined — which `readPlanView` handles by returning
  // undefined rather than throwing.
  const planReader = (sessionId: string): MpdPlanView["plan"] | undefined => readPlanView(teamsService, workspaceRoot(), sessionId)

  // Measured once, at apply: an append is only safe when the event type is known
  // to a reachable dsh-session copy (iron rule 2).
  const sessionEventTypeKnown = resolved.sessionEvents ? registerLogOnlyEventType(BOARD_OPENED_EVENT, log) : false

  /** One entry per seam, in wiring order, for the aggregate diagnostic and the tests. */
  const outcomes: { id: string; outcome: SeamOutcome }[] = []
  /** Appends one seam handle's measured outcome to the report. */
  const record = (handle: { outcome(): SeamOutcome }): void => {
    /** The handle's own outcome, which carries the seam id it belongs to. */
    const measured = handle.outcome()
    outcomes.push({ id: measured.id, outcome: measured })
  }
  /** The outcome of a seam this row deliberately did not activate (a config switch). */
  const skipped = (key: Parameters<TuiAdapter["skipped"]>[0], detail: string): { outcome(): SeamOutcome } => tui.skipped(key, detail)

  // ── the seven activation-gated UI seams ───────────────────────────────────
  // The settings-bridge outcome, surfaced as a RUNTIME notice on the status line (§D.2 row 2):
  // a save with no live session workspace stays in settings and says so on screen. `mpdConfig`
  // is another plugin's service, so it is reached with the deferred inject form (a one-shot
  // probe cannot see it, and a declared dependency would park this entry).
  /**
   * The `mpdConfig` service's two members this row reads: the bridge's state (for the status-line
   * notice) and the resolved-config read (for the Ctrl+A toggle, which the settings section writes).
   */
  let configHandle: { states?: () => { writeback?: { skipped?: string } | null }; get?: (key?: string) => unknown } | undefined
  /** The settings-bridge notice for the status line, when a save could not be written. */
  const bridgeRead = (): string | undefined => {
    try {
      /** The write-back's skip reason, as the config layer recorded it. */
      const skipped = configHandle?.states?.()?.writeback?.skipped
      // Both refusal reasons are surfaced, each with its own sentence: a settings-only save must
      // never read as a lost one (captain's ruling 1).
      if (skipped === "no-live-session") return NO_LIVE_SESSION_NOTICE
      if (skipped === "ambiguous-multi-root") return AMBIGUOUS_MULTI_ROOT_NOTICE
      return undefined
    } catch {
      return undefined
    }
  }
  onService(ctx, "mpdConfig", (_scoped: PluginContextLike, service: unknown) => {
    configHandle = service as { states?: () => { writeback?: { skipped?: string } | null }; get?: (key?: string) => unknown }
  })

  // The watchdog front door's notice is composed into the SAME status value as the bridge notice
  // (w6): a held team and an unread-incident replay are line content, not a constant nobody renders.
  // It is built BEFORE the status seam so the FIRST publish already carries it; the acknowledge
  // callback reaches the status handle through a mutable reference (the seam is created below).
  const dialogs = createDialogs(tui, log)
  /** The status handle; mutable because the watchdog acknowledges through it. */
  let status: { outcome(): SeamOutcome; refresh(): void } = {
    ...tui.skipped("status", "not wired yet"),
    refresh: () => {},
  }
  /** The watchdog front door, attached before the status seam so its notice is published first. */
  const watchdogFrontDoor = attachWatchdogFrontDoor(ctx, tui, log, {
    workspaceRoot,
    dialogs,
    onAcknowledged: () => status.refresh(),
  })
  /** The status line's notice: the bridge notice and the watchdog notice, composed. */
  const noticeRead = (): string | undefined => composeNotices(bridgeRead(), watchdogFrontDoor.notice())

  status = resolved.statusLine
    ? registerStatus(ctx, tui, log, workspaceRoot, home, resolved.statusIntervalMs, noticeRead, teamViews, teamRecords)
    : { ...skipped("status", "disabled by config"), refresh: () => {} }
  // The two team surfaces (frozen §3): registered on the SAME `tuiScenes` seam as the
  // board. The hold row reads the watchdog's own durable view (never a fabricated "ok"),
  // and the plan surface mutates only through the adapter-backed executor.
  const scene = resolved.scene
    ? registerScene(
        ctx,
        tui,
        log,
        workspaceRoot,
        home,
        () => watchdogFrontDoor.view().holds,
        createPlanActions(adapter, log),
        planReader,
        teamViews,
        teamRecords,
        // THE KIT CLOSES THE MODULE-IDENTITY GAP. The host hands its own `ui` namespace only to a
        // scene, and THAT object's `useStdin` is the one resolving the live input context (measured
        // on dsh-tui 0.12.0: the module we can import by file URL answers nothing). Every scene
        // reports the kit per render and the adapter prefers it — so the Ctrl+A take-over arms once
        // an MPD scene has rendered in the session and stays inert before that.
        (ui: unknown) => tui.rememberHostKit(ui),
      )
    : {
        ...skipped("scenes", "disabled by config"),
        open: () => false,
        openScene: () => false,
        openTeam: () => false,
        openPlan: () => false,
        openSubagents: () => false,
      }
  // ── the sidebar panel (dsh-tui 0.13.0, frozen R2/R3) ─────────────────────
  // ONE panel, carrying the SAME merged view the full-screen scene draws: the host's curated
  // `host.snapshot().subagents` rows FIRST, then the MPD dependency DAG. The two surfaces share one
  // `readWorkflow` closure, so they cannot describe one team differently, and the descriptor is the
  // frozen one (`id: "team"`, `title: "MPD"`, `minColumns: 32`, `order: 10`, no icon, no `compact`).
  // Registering it is safe on every host build: the adapter's deferred binder queues the call until
  // the seam binds and settles it as `absent` where the host has no panel seam at all.
  const panel = registerPanelSurface(tui, {
    enabled: resolved.panel,
    // The panel reads the SAME projection the Ctrl+A contact reads (`readDashboardWorkflow`, the
    // scenes' own reader in its agentless form), so the sidebar and the full-screen scene cannot
    // describe one team differently.
    readWorkflow: () => readDashboardWorkflow(workspaceRoot, () => watchdogFrontDoor.view().holds, teamViews, teamRecords),
    // THE FALLBACK IS THE EXISTING SURFACE, never a silent no-op: every refusal lands on the scene
    // this wave must not lose (frozen R4/R5).
    openMergedScene: () => scene.openSubagents(),
    log,
  })
  // ── the Ctrl+A takeover (W2) ─────────────────────────────────────────────
  // The hook rides the SAME status seam and the SAME read path as the scenes; it mounts an empty-Box
  // view inside the Chat screen, prepends a listener on the host's own input bus through the adapter's
  // host contact, and intercepts Ctrl+A ONLY while MPD has a team with at least one task — otherwise
  // the key is left untouched and the host's dashboard opens exactly as it does today.
  //
  // THE TOGGLE IS READ PER PRESS, not at apply: the row config (`dashboardKey`, default true) is the
  // FLOOR, and a saved `tui.dashboardKey` (the /settings row -> the entry config -> `.mpd/mpd.jsonc`)
  // outranks it through the same `mpdConfig` service the bridge writes into. So a user can turn the
  // takeover off without a restart, and a composition that never saves keeps it on.
  /** Whether the takeover may intercept right now. */
  const dashboardKeyEnabled = (): boolean => {
    /** The live value from the resolved config layers, when the config row is composed. */
    let saved: boolean | undefined
    try {
      /** The config layer's own answer; a non-boolean leaves the row config in charge. */
      const live = configHandle?.get?.(DASHBOARD_TAKEOVER_KNOB)
      if (typeof live === "boolean") saved = live
    } catch {
      // An unreadable config layer leaves the row config's own value in charge.
    }
    // THE RULE LIVES IN `panel.ts` (`takeoverArmed`): the SEAM WINS over every configuration, and the
    // seam state is re-read here PER PRESS, never only at apply — the adapter binds it through a
    // DEFERRED inject, so a binding that lands after this row applied must still disarm the contact.
    return takeoverArmed(tui.panelSeamBound(), saved, resolved.dashboardKey)
  }
  // THE VERSION GATE (frozen R5/R4). The host-input contact exists for exactly ONE host generation:
  // a dsh-tui WITHOUT the panel seam, where Ctrl+A's own dashboard is the only way to reach the
  // merged view. On a host that OFFERS the panel seam the contact must stay INERT — Ctrl+A keeps the
  // host's own dashboard meaning, and MPD's own key (`alt+a`) plus `/mpd panel` are the entry points.
  // The apply-time test below is the FAST PATH — it keeps the status view and the input listener out
  // of a 0.13.0 session entirely. `dashboardKeyEnabled` repeats the same test PER PRESS, because the
  // adapter binds the seam through a DEFERRED inject and a binding that lands after this row applied
  // must still disarm the contact; the per-PRESS read of the `tui.dashboardKey` knob is unchanged.
  /** The hook's registration, or the explicit skip that says why the takeover is absent. */
  const dashboardKey = !tui.panelSeamBound()
    ? (resolved.dashboardKey
        ? registerDashboardKey(ctx, tui, {
            enabled: dashboardKeyEnabled,
            mergedSceneAvailable: () => resolved.scene && tui.scenes() !== undefined,
            readWorkflow: () => readDashboardWorkflow(workspaceRoot, () => watchdogFrontDoor.view().holds, teamViews, teamRecords),
            openMergedScene: () => scene.openSubagents(),
            log,
          })
        : tui.skipped("status", "the Ctrl+A takeover is disabled by the mpd-tui row config (dashboardKey: false)"))
    : tui.skipped(
        "status",
        "the host exposes the sidebar panel seam (dsh-tui 0.13.0+), so the legacy Ctrl+A host-input contact stays inert: Ctrl+A keeps its host dashboard meaning and the merged view opens through alt+a and /mpd panel",
      )
  /** The renderer seam result, or a config-disabled stub. */
  const renderers = resolved.renderers ? registerRenderers(ctx, tui, log) : skipped("renderers", "disabled by config")
  /** The settings-section seam result, or a config-disabled stub. */
  const settings = resolved.settingsSection ? registerSettingsSection(ctx, tui, log) : skipped("settingsSections", "disabled by config")
  /** The command-tree seam result, or a config-disabled stub. */
  const trees = resolved.commandTrees ? registerCommandTrees(tui) : skipped("commandTrees", "disabled by config")

  // ── supporting surfaces ──────────────────────────────────────────────────
  // THE ONE ROUTED OPEN (frozen R4): `alt+a` and `/mpd panel` both land here. The panel is the
  // surface when the host offers the seam and its registration was confirmed; the full-screen merged
  // scene is the surface everywhere else — a host without the seam, an id not yet discovered, or an
  // `openPanel` the host REFUSED. Nothing on this path is ever a silent no-op.
  /** Opens the sidebar panel, or the full-screen merged scene, and says which one it reached. */
  const openMergedPanel = (): PanelOpenOutcome & { id: string | undefined } => {
    /** The panel surface's own answer. */
    const routed = panel.openOrScene()
    return { ...routed, id: panel.id() }
  }
  /** The shortcut seam result, or a config-disabled stub. */
  const shortcuts = resolved.shortcuts
    ? registerShortcuts(ctx, tui, log, {
        openBoard: () => scene.open(),
        openTeam: () => scene.openTeam(),
        // `alt+a` — the DSH-TUI 0.13.0 entry point for the merged view, routed through the panel seam
        // with the full-screen scene as its declared fallback. The boolean is the shortcut's own
        // "did a surface open" contract, reported from the ROUTED result so a panel that declined and
        // took its scene fallback is still a `true`.
        openSubagents: () => {
          /** How the routed open ended, and the scene's own answer where it was the surface. */
          const route = openMergedPanel()
          return route.outcome === "opened" || route.sceneOpened
        },
        refreshStatus: () => status.refresh(),
        pickWorkmate: () => {
          void pickWorkmate(log, dialogs, workspaceRoot, home, scene, teamViews, teamRecords)
        },
      })
    : skipped("shortcuts", "disabled by config")

  /** The command seam result, or a config-disabled stub. */
  const commands = resolved.commands
    ? registerCommands(tui, {
        openBoard: () => scene.open(),
        openTeam: () => scene.openTeam(),
        openPlan: () => scene.openPlan(),
        // `/mpd subagents` keeps its pre-panel contract (a boolean: the merged view opened) while
        // riding the same routed open as `alt+a`.
        openSubagents: () => {
          /** How the routed open ended, and the scene's own answer where it was the surface. */
          const route = openMergedPanel()
          return route.outcome === "opened" || route.sceneOpened
        },
        // `/mpd panel` gets the FULL route result, so its printed line can name the surface the user
        // is looking at (the panel, the scene as a fallback, or a host with no panel seam).
        openPanel: () => {
          /** How the routed open ended, and the discovered host panel id. */
          const route = openMergedPanel()
          return { outcome: route.outcome, id: route.id }
        },
        statusText: () => boardSummary(workspaceRoot, home, teamViews, teamRecords),
        workmatesText: () => {
          /** The board projection the workmate text is rendered from. */
          const state = readBoardState(workspaceRoot(), home(), teamViews(), teamRecords())
          // Command output is read by a person at the moment it appears, so it is resolved here
          // rather than stored: `/lang` reaches it on the next invocation.
          return state.workmates.count === 0
            ? t("command.workmatesNone")
            : t("command.workmatesList", { count: String(state.workmates.count), names: state.workmates.names.join(", ") })
        },
        pickAction: () => pickAction(log, dialogs),
        // `/mpd-model`: the pick-list chain. It resolves the SAME catalog/settings seam the
        // `/settings` section registers its options from (`resolveCatalogReader`), so the menu and
        // the rows cannot name different providers.
        openModelMenu: () => openModelMenu(tui, log, { dialogs, ctx }),
        recordBoardOpened: (via: "command" | "shortcut", session: SessionLike | undefined) => {
          if (!resolved.sessionEvents) return
          appendBoardOpened(session, sessionEventTypeKnown, via, "board", log)
        },
      })
    : skipped("commands", "disabled by config")

  // ── the decision-event seam: attempt, expect refusal, disclose once ───────
  const decisions = resolved.decisionEvents
    ? attemptDecisionEvents(ctx, tui, log)
    : { ...skipped("pluginHost", "disabled by config"), attempts: () => [] }

  record(status)
  record(renderers)
  record(settings)
  record(scene)
  // The PANEL is reported under its own name as well as through the adapter's seam table: the
  // aggregate line then names the DISCOVERED host id, which is the one fact an operator cannot
  // reconstruct from the seam states (the host composes `<pluginId>:<slug>` from an activation name
  // this row does not carry — see `PanelRegistrationHandle.id`).
  outcomes.push({ id: "panel", outcome: panel.outcome() })
  log.debug(`sidebar panel id: ${panel.id() ?? "(not discovered)"}`)
  // The takeover ROLE is reported under its own name (it rides the status seam, which reports
  // separately above), so the aggregate line names it instead of hiding a second `status` entry.
  outcomes.push({ id: "dashboardKey", outcome: dashboardKey.outcome() })
  record(trees)
  record(shortcuts)
  record(dialogs)
  record(commands)
  // The decision-event ROLE is reported under its own name; the seam it rides is the mediated
  // plugin host's, which the adapter's own table reports separately.
  outcomes.push({ id: "decisionEvents", outcome: decisions.outcome() })

  // ── one aggregate diagnostic, honest about what was NOT confirmed ─────────
  // "Something happened" includes a REFUSED registration: the aggregate line
  // must be able to report a refusal instead of hiding it behind the
  // nothing-composed warning. The line itself lives in the adapter, which owns
  // the outcome vocabulary for this plane.
  reportOutcomes(log, outcomes.map((entry) => entry.outcome))
  log.debug(`session event type ${BOARD_OPENED_EVENT}: ${sessionEventTypeKnown ? "verified known" : "NOT verified (records will be skipped)"}`)

  return { outcomes, sessionEventTypeKnown }
}

/**
 * The bare-`/mpd` picker (conventions: bare command = picker). Returns undefined
 * when no dialog seam is composed, so the command falls back to its documented
 * default action instead of failing.
 */
async function pickAction(log: Log, dialogs: ReturnType<typeof createDialogs>): Promise<string | undefined> {
  if (!dialogs.available()) return undefined
  /** The user's pick; undefined when the picker was cancelled or unavailable. */
  const choice = await dialogs.select("mpd", [
    { id: "board", label: "Board", description: "team, tasks, boulder, plans, workmates" },
    { id: "team", label: "Team", description: "team workflow: phase, roster, task DAG" },
    { id: "plan", label: "Plan", description: "review and approve a staged plan" },
    { id: "subagents", label: "Subagents", description: "the host's subagent rows above the team panel" },
    { id: "panel", label: "Panel", description: "the sidebar panel (dsh-tui 0.13.0), or the full-screen fallback" },
    { id: "workmates", label: "Workmates", description: "list the durable workmate library" },
    { id: "status", label: "Status", description: "print the mpd status line" },
  ])
  if (choice !== undefined) log.debug(`/mpd picker chose ${scalarText(choice, 40) ?? "?"}`)
  return choice
}

/**
 * `alt+w`: select one workmate from the durable library, then open the board. An
 * absent dialog seam (or an empty library) degrades to opening the board.
 */
async function pickWorkmate(
  log: Log,
  dialogs: ReturnType<typeof createDialogs>,
  workspaceRoot: () => string,
  home: () => string,
  scene: ReturnType<typeof registerScene>,
  teamViews: () => readonly DshTeamView[],
  teamRecords: () => readonly TeamRecord[] = () => [],
): Promise<void> {
  /** The workmate display names read from the durable library. */
  const names = readBoardState(workspaceRoot(), home(), teamViews(), teamRecords()).workmates.names
  if (!dialogs.available() || names.length === 0) {
    scene.open()
    return
  }
  /** The picked workmate's key; undefined when the picker was cancelled. */
  const id = await dialogs.select(
    "mpd workmates",
    names.slice(0, 50).map((entry) => ({ id: entry, label: entry })),
  )
  if (id !== undefined) log.debug(`workmate picked: ${scalarText(id, 60) ?? "?"}`)
  scene.open()
}
