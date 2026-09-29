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
// The Config schema comes from the schemastery copy the bundle ALREADY vendors
// (packages/mpd-agent-teams-plugin/_deps/schemastery): this package declares no
// dependency of its own and resolves nothing over the network. It is the one
// relative specifier that names a PACKAGE DIRECTORY (resolved through that copy's
// own package.json, which carries both `exports.import` and `types`) — every
// relative FILE import in this package carries an explicit extension.
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { PluginContextLike, SeamOutcome, SessionLike } from "./types.js"
import { createLog, type Log } from "./log.js"
import { describeOutcome, onService, serviceOf } from "./host.js"
import { AMBIGUOUS_MULTI_ROOT_NOTICE, NO_LIVE_SESSION_NOTICE, readBoardState } from "./state.js"
import { registerStatus } from "./status.js"
import { registerRenderers } from "./renderers.js"
import { registerSettingsSection } from "./settings.js"
import { boardSummary, PLAN_MUTATION_UNAVAILABLE, registerScene, type PlanActions } from "./scenes.js"
import { liveTeamViews } from "./team-state.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { registerCommandTrees } from "./command-trees.js"
import { registerShortcuts } from "./shortcuts.js"
import { createDialogs } from "./dialogs.js"
import { attachWatchdogFrontDoor, composeNotices, type WatchdogFrontDoor } from "./watchdog.js"
import { attemptDecisionEvents } from "./decisions.js"
import { appendBoardOpened, registerCommands } from "./commands.js"
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
 * The calling agent is sourced from the adapter's own live registry
 * (`liveAgent(captainSessionId)`, else `liveAgents()[0]` when the record carries no
 * id) and passed as the adapter's optional `agent`, which forwards it verbatim as
 * `exec.agent` — the adopted write tools require one (`lib/tools.ts:65-71`).
 *
 * Every refusal is LOUD and never a fabricated success: an unregistered tool, an
 * unattached captain session (the Web route's own 409 case) and a tool error all
 * come back as `{ok:false, error}`.
 * @param adapter - the resolved adapter.
 * @param log - diagnostics.
 * @returns the executor.
 */
export function createPlanActions(adapter: ReturnType<typeof createDshAdapter>, log: Log): PlanActions {
  // 0.1.7: the two tools this executor used to call are RETIRED and the official plane has no
  // replacement (see `PLAN_MUTATION_UNAVAILABLE`), so the production executor is PERMANENTLY
  // unavailable and says exactly why. It is deliberately not a fake that "might work": the plan
  // surface tells the user the truth, and no tool name that no longer exists is looked up.
  void adapter
  void log
  return {
    available: () => false,
    approve: async () => ({ ok: false, error: PLAN_MUTATION_UNAVAILABLE }),
    discard: async () => ({ ok: false, error: PLAN_MUTATION_UNAVAILABLE }),
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
  /** The prefixed diagnostic sink, backed by `ctx.logger` when the context has one. */
  const log: Log = createLog(ctx?.logger, resolved.logPrefix)
  /** The one adapter every harness seam of this row goes through. */
  const adapter = resolveAdapter(ctx)
  /** The per-call workspace resolver (the calling session's workspace, never the process cwd). */
  const workspaceRoot = workspaceResolver(ctx, adapter)
  /** The per-call home resolver; the workmate library lives under it by design. */
  const home = (): string => homeDir()
  // The OFFICIAL team readout for the CURRENT workspace, resolved per call through the adapter
  // (never cached: one host serves many sessions with different workspaces). Every team surface —
  // the board, the status line, the workflow scene and the plan scene — reads it through this ONE
  // provider, so a missing seam degrades them together (`[]`) instead of one at a time.
  const teamViews = (): readonly DshTeamView[] => liveTeamViews(adapter, workspaceRoot())

  // Measured once, at apply: an append is only safe when the event type is known
  // to a reachable dsh-session copy (iron rule 2).
  const sessionEventTypeKnown = resolved.sessionEvents ? registerLogOnlyEventType(BOARD_OPENED_EVENT, log) : false

  /** One entry per seam, in wiring order, for the aggregate diagnostic and the tests. */
  const outcomes: { id: string; outcome: SeamOutcome }[] = []
  /** Appends one seam's outcome to the report. */
  const record = (id: string, outcome: SeamOutcome): void => {
    outcomes.push({ id, outcome })
  }

  // ── the seven activation-gated UI seams ───────────────────────────────────
  // The settings-bridge outcome, surfaced as a RUNTIME notice on the status line (§D.2 row 2):
  // a save with no live session workspace stays in settings and says so on screen. `mpdConfig`
  // is another plugin's service, so it is reached with the deferred inject form (a one-shot
  // probe cannot see it, and a declared dependency would park this entry).
  let configHandle: { states?: () => { writeback?: { skipped?: string } | null } } | undefined
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
    configHandle = service as { states?: () => { writeback?: { skipped?: string } | null } }
  })

  // The watchdog front door's notice is composed into the SAME status value as the bridge notice
  // (w6): a held team and an unread-incident replay are line content, not a constant nobody renders.
  // It is built BEFORE the status seam so the FIRST publish already carries it; the acknowledge
  // callback reaches the status handle through a mutable reference (the seam is created below).
  const dialogs = createDialogs(ctx, log)
  /** The status handle; mutable because the watchdog acknowledges through it. */
  let status: { outcome(): SeamOutcome; refresh(): void } = {
    outcome: () => ({ state: "absent" as const, detail: "not wired yet" }),
    refresh: () => {},
  }
  /** The watchdog front door, attached before the status seam so its notice is published first. */
  const watchdogFrontDoor = attachWatchdogFrontDoor(ctx, log, {
    workspaceRoot,
    dialogs,
    onAcknowledged: () => status.refresh(),
  })
  /** The status line's notice: the bridge notice and the watchdog notice, composed. */
  const noticeRead = (): string | undefined => composeNotices(bridgeRead(), watchdogFrontDoor.notice())

  status = resolved.statusLine
    ? registerStatus(ctx, log, workspaceRoot, home, resolved.statusIntervalMs, noticeRead, teamViews)
    : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }), refresh: () => {} }
  // The two team surfaces (frozen §3): registered on the SAME `tuiScenes` seam as the
  // board. The hold row reads the watchdog's own durable view (never a fabricated "ok"),
  // and the plan surface mutates only through the adapter-backed executor.
  const scene = resolved.scene
    ? registerScene(ctx, log, workspaceRoot, home, () => watchdogFrontDoor.view().holds, createPlanActions(adapter, log), teamViews)
    : {
        outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }),
        open: () => false,
        openScene: () => false,
        openTeam: () => false,
        openPlan: () => false,
      }
  /** The renderer seam result, or a config-disabled stub. */
  const renderers = resolved.renderers ? registerRenderers(ctx, log) : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }) }
  /** The settings-section seam result, or a config-disabled stub. */
  const settings = resolved.settingsSection ? registerSettingsSection(ctx, log) : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }) }
  /** The command-tree seam result, or a config-disabled stub. */
  const trees = resolved.commandTrees ? registerCommandTrees(ctx, log) : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }) }

  // ── supporting surfaces ──────────────────────────────────────────────────
  const shortcuts = resolved.shortcuts
    ? registerShortcuts(ctx, log, {
        openBoard: () => scene.open(),
        openTeam: () => scene.openTeam(),
        refreshStatus: () => status.refresh(),
        pickWorkmate: () => {
          void pickWorkmate(log, dialogs, workspaceRoot, home, scene, teamViews)
        },
      })
    : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }) }

  /** The command seam result, or a config-disabled stub. */
  const commands = resolved.commands
    ? registerCommands(ctx, log, {
        openBoard: () => scene.open(),
        openTeam: () => scene.openTeam(),
        openPlan: () => scene.openPlan(),
        statusText: () => boardSummary(workspaceRoot, home, teamViews),
        workmatesText: () => {
          /** The board projection the workmate text is rendered from. */
          const state = readBoardState(workspaceRoot(), home(), teamViews())
          return state.workmates.count === 0
            ? "mpd workmates: none"
            : `mpd workmates (${state.workmates.count}): ${state.workmates.names.join(", ")}`
        },
        pickAction: () => pickAction(log, dialogs),
        recordBoardOpened: (via: "command" | "shortcut", session: SessionLike | undefined) => {
          if (!resolved.sessionEvents) return
          appendBoardOpened(session, sessionEventTypeKnown, via, "board", log)
        },
      })
    : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }) }

  // ── the decision-event seam: attempt, expect refusal, disclose once ───────
  const decisions = resolved.decisionEvents
    ? attemptDecisionEvents(ctx, log)
    : { outcome: (): SeamOutcome => ({ state: "absent" as const, detail: "disabled by config" }), attempts: () => [] }

  record("tuiStatus", status.outcome())
  record("tuiRenderers", renderers.outcome())
  record("tuiSettingsSections", settings.outcome())
  record("tuiScenes", scene.outcome())
  record("tuiCommandTrees", trees.outcome())
  record("tuiShortcuts", shortcuts.outcome())
  record("tuiDialogs", dialogs.outcome())
  record("commands", commands.outcome())
  record("decisionEvents", decisions.outcome())

  // ── one aggregate diagnostic, honest about what was NOT confirmed ─────────
  // "Something happened" includes a REFUSED registration: the aggregate line
  // must be able to report a refusal instead of hiding it behind the
  // nothing-composed warning.
  const attempted = outcomes.filter((entry) => entry.outcome.state !== "absent")
  if (attempted.length === 0) {
    log.warn("no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped")
  } else {
    log.info(`mpd TUI surfaces: ${outcomes.map((entry) => describeOutcome(entry.id, entry.outcome)).join(" · ")}`)
  }
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
): Promise<void> {
  /** The workmate display names read from the durable library. */
  const names = readBoardState(workspaceRoot(), home(), teamViews()).workmates.names
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
