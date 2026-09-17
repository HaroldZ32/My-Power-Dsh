// mpd-team-watchdog — the bundle row that watches for a WEDGED team.
//
// The user's request (verbatim D1/D2/D3 in `.mpd/plans/team-watchdog.md`):
//   * heartbeat every model step AND every tool call, for members AND the captain;
//   * silence > 90 s (configurable) ⇒ WARN + a snapshot;
//   * the same task WARNing three consecutive times ⇒ ESCALATE;
//   * pause the affected TEAM only, preserve the scene, resume with one action.
//
// What this row owns (design of record: `evidence/team-watchdog/design/DESIGN.md`):
//   * the heartbeat store (`<stateDir>/watchdog/heartbeat/<key>.jsonl`), written on
//     `agent/pre-step`, on the adapter's PRE tool hook (the `tool-start` stamp that opens a
//     call, r6) and its POST hook (COMPLETION, never before dispatch — W-9), and on the
//     turn boundaries;
//   * the WARN→ESCALATE machine over the `mpd`-namespace knobs, re-read live;
//   * the atomic, restorable scene snapshot;
//   * the durable `watchdogHold` + incident/read-watermark sidecars beside `team.json`;
//   * the plugin's OWN `session-watchdog-hold`/`-resume` actions.
//
// What this row deliberately does NOT do (other waves own it):
//   * wire the adopted dispatch gates / tool guards that honour the hold (w7);
//   * render a Web banner, a TUI status row or a dialog (w7/w9);
//   * declare the knobs in `mpd-config`'s schema or the Web card's FIELDS list —
//     those are other packages' files. Because schemastery KEEPS unknown keys, the
//     `watchdog` section is readable through the `mpd` namespace before that
//     declaration lands; the declaration only makes it visible in the two front doors.
//
// Plugin contract (hard requirement of this row):
//   * pure ESM, `.js` suffixes on relative imports;
//   * `name` / `Config` (type + schemastery schema) / `apply`, and NO default export;
//   * every config key defaulted, in the schema AND in the resolver;
//   * cleanup through `ctx.effect`;
//   * never a thrown boot failure — a missing optional seam degrades with a warning;
//   * the harness contact goes through the ADAPTER only (AGENTS.md §6).
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"
import { createDshAdapter, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { registerWatchdogActions } from "./actions.js"
import { WatchdogEngine, type EngineConfig, type EngineContext, type EngineStats } from "./engine.js"
import { HOLD_GATE_CALL, HOLD_SERVICE, HoldRegistry } from "./holds.js"
import { readKnobs, WATCHDOG_DEFAULTS, type ResolvedKnobs } from "./machine.js"
import { DEFAULT_STATE_DIR } from "./paths.js"
import { message } from "./store.js"

/** The plugin name (the bundle patch row id is `mpd-team-watchdog`). */
export const name = "mpd-team-watchdog"

/**
 * The tool seam is declared because the row registers three tools through the
 * adapter (the adapter's `service("tools")` reads off THIS row's context). `agents`
 * is declared because the tick is PROCESS-LEVEL (AC-9: it must fire even when the
 * captain's own turn is the wedged one) and needs the live-session workspace list;
 * every harness profile that can run a session mounts `dsh-agent`, which is the
 * service's owner, so this inject cannot park the row.
 */
export const inject: string[] = ["tools", "agents"]

/** Configurable knobs; every key has a default in BOTH the schema and the resolver. */
export type Config = {
  /** The AC-10 kill switch (an env `MPD_DSH_TEAM_WATCHDOG=off` also forces it off). */
  enabled?: boolean
  /** Silence beyond this many ms is a WARN. */
  warnSilenceMs?: number
  /** Tick cadence; must be < warnSilenceMs. */
  tickIntervalMs?: number
  /** Consecutive WARNs for ONE task+attempt before ESCALATE. */
  warnStreakToEscalate?: number
  /** `pause` persists the preserving hold; `warn-only` only records. */
  actionOnEscalate?: string
  /** The adopted team state directory (default `.mpd/team`, relative to the workspace). */
  stateDir?: string
  /** How long a parsed team record stays cached between reads (0 disables). */
  teamCacheMs?: number
  /** How many heartbeat generations to keep per member file. */
  keepGenerations?: number
  /**
   * Dead-team fallback bound (r4): how long a team record may go untouched before a tick skips it
   * when the live-agent registry cannot answer. 0 disables the bound (tick everything).
   */
  deadTeamGraceMs?: number
  /**
   * The r6 secondary bound: how long ONE open tool call explains silence away. Past it the entry
   * is reported once as `tool-expired` (WARN-class only — never a scene, never a hold).
   * 0 disables the in-flight suppression entirely (the pre-r6, POST-only behaviour).
   */
  toolInFlightMaxMs?: number
  /**
   * T-17's hold TTL (§3): a hold a `pause` escalation persisted is auto-released after this
   * long, with a durable `hold-auto-released` incident. `0` = never expire.
   */
  holdTtlMs?: number
  /** Print skipped-team reasons to the console as well as the debug channel (default false). */
  verboseSkips?: boolean
  /** Diagnostic prefix. */
  logPrefix?: string
}

/** The schemastery schema the loader validates this row's config with. */
export const Config: Schemastery<Config> = z.object({
  enabled: z.boolean().default(true),
  warnSilenceMs: z.number().default(WATCHDOG_DEFAULTS.warnSilenceMs),
  tickIntervalMs: z.number().default(WATCHDOG_DEFAULTS.tickIntervalMs),
  warnStreakToEscalate: z.number().default(WATCHDOG_DEFAULTS.warnStreakToEscalate),
  actionOnEscalate: z.string().default(WATCHDOG_DEFAULTS.actionOnEscalate),
  stateDir: z.string().default(DEFAULT_STATE_DIR),
  teamCacheMs: z.number().default(2000),
  keepGenerations: z.number().default(3),
  deadTeamGraceMs: z.number().default(86_400_000),
  toolInFlightMaxMs: z.number().default(WATCHDOG_DEFAULTS.toolInFlightMaxMs),
  holdTtlMs: z.number().default(WATCHDOG_DEFAULTS.holdTtlMs),
  verboseSkips: z.boolean().default(false),
  logPrefix: z.string().default("mpd-team-watchdog"),
})

/** What `apply` reports (also the handle tests drive). */
export interface ApplyReport {
  applied: boolean
  engine: WatchdogEngine | null
  knobs: ResolvedKnobs
  intervalMs: number
  disposers: number
  /** The service id the w7 gates resolve, or null when `ctx.provide` is unavailable. */
  holdService: string | null
  /** How many durable holds the registry loaded at apply. */
  hydratedHolds: number
  error?: string
}

/** Apply the documented defaults to a (possibly partial) config. */
export function resolveConfig(config: Config = {}): EngineConfig {
  const bool = (value: boolean | undefined, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback)
  const num = (value: number | undefined, fallback: number, min: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback
  return {
    enabled: bool(config.enabled, WATCHDOG_DEFAULTS.enabled),
    warnSilenceMs: num(config.warnSilenceMs, WATCHDOG_DEFAULTS.warnSilenceMs, 1),
    tickIntervalMs: num(config.tickIntervalMs, WATCHDOG_DEFAULTS.tickIntervalMs, 1),
    warnStreakToEscalate: num(config.warnStreakToEscalate, WATCHDOG_DEFAULTS.warnStreakToEscalate, 1),
    // §3: the frozen DEFAULT is `warn-only`, and `pause` — the ONE action that persists a
    // hold — must be asked for explicitly by the row config. The comparison used to run the
    // other way round (anything that was not `warn-only` fell through to the default), which
    // would silently discard an explicit `pause` the moment the default stopped being `pause`.
    actionOnEscalate: config.actionOnEscalate === "pause" ? "pause" : "warn-only",
    stateDir: typeof config.stateDir === "string" && config.stateDir !== "" ? config.stateDir : DEFAULT_STATE_DIR,
    teamCacheMs: num(config.teamCacheMs, 2000, 0),
    keepGenerations: num(config.keepGenerations, 3, 1),
    deadTeamGraceMs: num(config.deadTeamGraceMs, 86_400_000, 0),
    toolInFlightMaxMs: num(config.toolInFlightMaxMs, WATCHDOG_DEFAULTS.toolInFlightMaxMs, 0),
    holdTtlMs: num(config.holdTtlMs, WATCHDOG_DEFAULTS.holdTtlMs, 0),
    verboseSkips: bool(config.verboseSkips, false),
    logPrefix: typeof config.logPrefix === "string" && config.logPrefix !== "" ? config.logPrefix : "mpd-team-watchdog",
  }
}

/** One line on stderr, never a throw. */
function warn(prefix: string, text: string): void {
  try {
    console.warn("[" + prefix + "] " + text)
  } catch {
    // nothing left to report with
  }
}

/**
 * Apply the row.
 *
 * @param ctx - the cordis plugin context.
 * @param config - the row config, already schema-validated by the loader.
 * @returns what was installed (never throws).
 */
export function apply(ctx: unknown, config: Config = {}): ApplyReport {
  const context = (ctx ?? {}) as EngineContext
  const resolved = resolveConfig(config)
  let dsh: DshAdapter
  try {
    // `ctx.get(id, false)` is the SOFT probe: it answers undefined instead of
    // throwing when the adapter row is absent (the plugin then falls back to its own
    // adapter over this ctx, which keeps the row usable in a unit test).
    dsh = ((context as { get?: (id: string, strict?: boolean) => unknown }).get?.("mpdDsh", false) as DshAdapter | undefined) ?? createDshAdapter(context)
  } catch (error) {
    warn(resolved.logPrefix, "no adapter available — the row is inert: " + message(error))
    return { applied: false, engine: null, knobs: readKnobs(undefined), intervalMs: 0, disposers: 0, holdService: null, hydratedHolds: 0, error: message(error) }
  }

  // The synchronous hold reader the w7 gates consult (plan AMENDMENT 2, A2-1, option (b)).
  const registry = new HoldRegistry(resolved.stateDir)
  let hydratedHolds = 0
  try {
    const roots = new Set<string>()
    try {
      for (const root of dsh.workspaceRootsAll() ?? []) roots.add(root)
    } catch {
      // an absent agent registry is not an error: the exec-less root still works
    }
    try {
      roots.add(dsh.workspaceRoot())
    } catch {
      // no root resolvable at apply: the first stamp/read hydrates instead
    }
    hydratedHolds = registry.hydrate([...roots])
  } catch (error) {
    warn(resolved.logPrefix, "hold hydration at apply failed (the file fallback still answers): " + message(error))
  }

  let engine: WatchdogEngine
  try {
    engine = new WatchdogEngine(dsh, context, resolved, registry)
  } catch (error) {
    warn(resolved.logPrefix, "engine construction failed — the row is inert: " + message(error))
    return { applied: false, engine: null, knobs: readKnobs(undefined), intervalMs: 0, disposers: 0, holdService: null, hydratedHolds, error: message(error) }
  }

  let holdService: string | null = null
  try {
    const provide = (context as { provide?: (id: string, value: unknown) => unknown }).provide
    if (typeof provide === "function") {
      // `mpdWatchdog` is the ONE seam w7 needs: a synchronous, non-throwing answer.
      // When this row is absent the service is absent, `isHeld` is never called and
      // dispatch behaves exactly as today (the fail-open rule, stated in the README).
      provide.call(context, HOLD_SERVICE, {
        isHeld: (teamId: string, workspace?: string) => registry.isHeld(teamId, workspace),
        holds: (teamId: string, workspace?: string) => registry.holds(teamId, workspace),
        list: () => registry.list(),
        hydratedRoots: () => registry.hydratedRoots(),
        hydrate: (roots?: string[]) => registry.hydrate(roots ?? engine.knownRoots()),
        // The front-door reads (w6b): the SAME service carries the durable store access the TUI
        // renders, so a consumer never imports this package's writers into its own build. Every
        // member is synchronous and non-throwing (it is called on a render path).
        heldTeams: (workspace?: string) => registry.heldTeams(workspace),
        unread: (reader: string, workspace?: string) => registry.unread(reader, workspace),
        acknowledge: (reader: string, upTo: number, workspace?: string) => registry.acknowledge(reader, upTo, workspace),
        view: (reader: string, workspace?: string) => registry.view(reader, workspace),
        gateCall: HOLD_GATE_CALL,
      })
      holdService = HOLD_SERVICE
    } else {
      warn(resolved.logPrefix, "ctx.provide is unavailable — the hold reader is not published and the w7 gates stay fail-open")
    }
  } catch (error) {
    warn(resolved.logPrefix, "publishing the " + HOLD_SERVICE + " service failed: " + message(error))
  }

  let disposers: (() => void)[] = []
  try {
    // The status tool reports WHICH predicate is running (§4) — a diagnostics provider,
    // never a decision input, and the engine is already constructed at this point.
    registerWatchdogActions(dsh, resolved.stateDir, registry, {
      predicate: () => engine.predicateStatus(),
      // §7.2: the per-knob live-vs-file reading the status view prints.
      knobs: () => engine.knobDivergence(),
      // T-17: a hold created without an explicit `ttl_ms` inherits the resolved `holdTtlMs`.
      holdTtlMs: () => engine.getKnobs().holdTtlMs,
    })
    disposers = engine.install()
  } catch (error) {
    warn(resolved.logPrefix, "registration degraded: " + message(error))
  }

  // Exactly ONE interval owns the cadence; a live knob change replaces it, never
  // adds a second one. `unref` keeps a pending watchdog from holding the host open.
  let timer: ReturnType<typeof setInterval> | undefined
  let intervalMs = engine.getKnobs().tickIntervalMs
  const stopTimer = (): void => {
    if (timer !== undefined) {
      try {
        clearInterval(timer)
      } catch {
        // already cleared
      }
      timer = undefined
    }
  }
  const startTimer = (next: number): void => {
    stopTimer()
    intervalMs = next
    try {
      timer = setInterval(() => {
        void engine.tickOnce().catch((error: unknown) => warn(resolved.logPrefix, "tick rejected: " + message(error)))
      }, next)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    } catch (error) {
      timer = undefined
      warn(resolved.logPrefix, "could not start the tick timer: " + message(error))
    }
  }
  engine.onKnobsChanged = (knobs: ResolvedKnobs): void => {
    if (knobs.enabled && knobs.tickIntervalMs !== intervalMs) startTimer(knobs.tickIntervalMs)
  }
  if (engine.getKnobs().enabled) startTimer(intervalMs)
  else warn(resolved.logPrefix, "disabled by configuration — no heartbeat tick will run")

  const cleanup = (): void => {
    stopTimer()
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // best effort: one bad disposer must not strand the others
      }
    }
    engine.stop()
  }
  try {
    if (typeof context.effect === "function") context.effect(() => cleanup)
  } catch (error) {
    warn(resolved.logPrefix, "ctx.effect unavailable (" + message(error) + ") — the tick will not be cleaned up on dispose")
  }

  const issues = engine.getKnobs().issues
  for (const issue of issues) warn(resolved.logPrefix, "knob " + issue.path + ": " + issue.problem + " — using " + JSON.stringify(issue.fallback))
  // The boot log line a mount lane greps: proof the row APPLIED (not merely composed).
  try {
    console.log(
      "[mpd-team-watchdog] applied: enabled=" + engine.getKnobs().enabled +
        " warnSilenceMs=" + engine.getKnobs().warnSilenceMs +
        " tickIntervalMs=" + intervalMs +
        " warnStreakToEscalate=" + engine.getKnobs().warnStreakToEscalate +
        " actionOnEscalate=" + engine.getKnobs().actionOnEscalate +
        " stateDir=" + resolved.stateDir +
        " disposers=" + disposers.length +
        " holdService=" + (holdService ?? "none") +
        " hydratedHolds=" + hydratedHolds +
        " deadTeamGraceMs=" + (resolved.deadTeamGraceMs === 0 ? "off" : resolved.deadTeamGraceMs) +
        " toolInFlightMaxMs=" + (resolved.toolInFlightMaxMs === 0 ? "off" : resolved.toolInFlightMaxMs) +
        " holdTtlMs=" + (resolved.holdTtlMs === 0 ? "off" : resolved.holdTtlMs) +
        " predicate=" + engine.predicateStatus().source +
        " enrichment=" + (engine.predicateStatus().enrichment ? "on" : "off"),
    )
  } catch {
    // stdout closed
  }
  return { applied: true, engine, knobs: engine.getKnobs(), intervalMs, disposers: disposers.length, holdService, hydratedHolds }
}

/** The engine counters, for a live handle (re-exported for lanes). */
export type { EngineStats }
