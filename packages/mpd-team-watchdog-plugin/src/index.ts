// mpd-team-watchdog — the bundle row that watches for a WEDGED team.
//
// The user's request (verbatim D1/D2/D3 in `.mpd/plans/team-watchdog.md`):
//   * heartbeat every model step AND every tool call, for members AND the captain;
//   * silence > 90 s (configurable) ⇒ WARN + a snapshot;
//   * the same task WARNing three consecutive times ⇒ ESCALATE;
//   * stop NEW dispatch into the affected TEAM only, preserving the scene (0.1.7: the official
//     Agent Teams service exposes no halt, so this preserving hold is the ONLY pause mechanism
//     this bundle implements; the retired plugin's `agent_teams_halt` is gone with its row).
//
// What this row owns (design of record: `evidence/team-watchdog/design/DESIGN.md`):
//   * the heartbeat store (`<stateDir>/watchdog/heartbeat/<key>.jsonl`), written on
//     `agent/pre-step`, on the adapter's PRE tool hook (the `tool-start` stamp that opens a
//     call, r6) and its POST hook (COMPLETION, never before dispatch — W-9), and on the
//     turn boundaries;
//   * the WARN→ESCALATE machine over the `mpd`-namespace knobs, re-read live (T-18, wave 2: the
//     workspace's `.mpd/mpd.jsonc` is a LIVE layer too — when that file is the layer that moved,
//     its values are applied in-process with no restart);
//   * the atomic, restorable scene snapshot;
//   * the durable hold + incident/read-watermark sidecars under `<stateDir>/watchdog/`;
//   * the plugin's OWN `session-watchdog-hold`/`-resume` actions — the pause implementation.
//
// What this row deliberately does NOT do (other waves own it):
//   * wire the dispatch gates / tool guards that honour the hold (w7);
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
import z from "../../mpd-schemastery"
import { rowLogLine, createDshAdapter, dshSeamInject, DSH_SEAM_AGENTS, DSH_SEAM_TOOLS, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { registerWatchdogActions } from "./actions.js"
import { registerWatchdogWeb, WATCHDOG_ROUTES, type WatchdogEffect } from "./web.js"
import { WatchdogEngine, type EngineConfig, type EngineContext, type EngineStats, type WedgeForceOutcome, type WedgeForceRequest, type WedgeForceSeam, type WedgeGraceOutcome, type WedgeGraceRequest } from "./engine.js"
import type { MpdTeamsRead } from "./team.js"
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
 *
 * Both NAMES come from the adapter's seam vocabulary, so a harness rename of either service is an
 * edit in ONE file (the adapter) rather than in every row that lists the id.
 */
export const inject: string[] = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_AGENTS)

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
  /** `pause` persists the watchdog's internal preserving hold; `warn-only` only records. */
  actionOnEscalate?: string
  /** This plugin's state directory (default `.mpd/team`, relative to the workspace). */
  stateDir?: string
  /** How long the live team readout stays cached between reads (0 disables). */
  teamCacheMs?: number
  /** How many heartbeat generations to keep per member file. */
  keepGenerations?: number
  /**
   * Dead-team fallback bound (r4): how long a team readout may go untouched before a tick skips
   * it when the live-agent registry cannot answer. 0 disables the bound (tick everything).
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
  /**
   * THE FORCE BOUND (S1), measured on SILENCE: how long a task's owner may produce no observable
   * activity before the two-phase force starts (grace directive, then interrupt/handoff/requeue/
   * split). `0` disables the whole rule.
   */
  forceAfterMs?: number
  /**
   * S2's OPT-IN age ceiling: force a task once it has been `in_progress` this long EVEN IF its owner
   * is active. `0` (the default) means NEVER. Turning it on reintroduces the 2026-11-06 failure mode
   * (four lanes killed at 904s–946s while working), so it is documented as dangerous.
   */
  maxTaskAgeMs?: number
  /** S4's grace window: the pause between the directive and the interrupt. `0` skips the phase. */
  graceMs?: number
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
  forceAfterMs: z.number().default(WATCHDOG_DEFAULTS.forceAfterMs),
  maxTaskAgeMs: z.number().default(WATCHDOG_DEFAULTS.maxTaskAgeMs),
  graceMs: z.number().default(WATCHDOG_DEFAULTS.graceMs),
  verboseSkips: z.boolean().default(false),
  logPrefix: z.string().default("mpd-team-watchdog"),
})

/** What `apply` reports (also the handle tests drive). */
export interface ApplyReport {
  /** Whether the row installed its engine (false when it degraded to inert). */
  applied: boolean
  /** The live engine handle, or null when construction failed. */
  engine: WatchdogEngine | null
  /** The knobs the engine resolved at apply time. */
  knobs: ResolvedKnobs
  /** Cadence of the installed tick timer in ms; 0 when no timer runs. */
  intervalMs: number
  /** How many disposer callbacks `install()` registered. */
  disposers: number
  /** The service id the w7 gates resolve, or null when `ctx.provide` is unavailable. */
  holdService: string | null
  /** How many durable holds the registry loaded at apply. */
  hydratedHolds: number
  /** `Error#message` of the degradation; absent on a clean apply. */
  error?: string
}

/** Apply the documented defaults to a (possibly partial) config. */
export function resolveConfig(config: Config = {}): EngineConfig {
  // Coerce a config flag: only a real boolean is accepted, anything else takes the fallback.
  const bool = (value: boolean | undefined, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback)
  // Coerce a numeric knob: a finite value at or above `min` wins, anything else falls back.
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
    forceAfterMs: num(config.forceAfterMs, WATCHDOG_DEFAULTS.forceAfterMs, 0),
    // S2/S4: both floor at 0, which is a MEANINGFUL value for each (never / multi-phase off).
    maxTaskAgeMs: num(config.maxTaskAgeMs, WATCHDOG_DEFAULTS.maxTaskAgeMs, 0),
    graceMs: num(config.graceMs, WATCHDOG_DEFAULTS.graceMs, 0),
    verboseSkips: bool(config.verboseSkips, false),
    logPrefix: typeof config.logPrefix === "string" && config.logPrefix !== "" ? config.logPrefix : "mpd-team-watchdog",
  }
}

/**
 * Resolve the `mpdTeams` service face for ONE call.
 *
 * Resolved here, at the point of use, and never captured at apply — the service is provided by
 * another row, which may mount after this one, and a composition without it must read exactly as it
 * did before. The soft probe (`ctx.get(id, false)`) is what keeps an unmounted service from
 * throwing inside a tool call or a tick.
 *
 * @param ctx - the row's cordis context.
 * @returns the service face, or undefined when it is absent or of the wrong shape.
 */
function mpdTeamsOf(ctx: unknown): MpdTeamsRead | undefined {
  try {
    // The context's soft service probe; a minimal test context may not carry one.
    const get = (ctx as { get?: (id: string, strict?: boolean) => unknown })?.get
    if (typeof get !== "function") return undefined
    /** The service as the composition answers it, or undefined when it is not mounted. */
    const service = get.call(ctx, "mpdTeams", false)
    if (service === null || typeof service !== "object") return undefined
    return typeof (service as MpdTeamsRead).list === "function" ? (service as MpdTeamsRead) : undefined
  } catch {
    return undefined
  }
}

/**
 * The service id team-core publishes its team ACTIONS under.
 *
 * Spelled as a literal rather than imported: the cross-package coupling inventory is FROZEN and may
 * only shrink, so the watchdog resolves the service at runtime (the same rule `mpdTeams` follows).
 * The string is `TEAM_ACTIONS_SERVICE` in `mpd-team-core-plugin/src/team-actions.ts`.
 */
const TEAM_ACTIONS_SERVICE_ID = "mpdTeamActions"

/**
 * Normalise the team plane's force answer onto {@link WedgeForceOutcome}.
 *
 * The answer crosses a service boundary the watchdog does not type, so EVERY field is read
 * structurally: an unknown shape reads as a refusal, never as a success.
 *
 * @param answer - whatever the service's `force` member returned.
 * @returns the outcome the engine records and logs.
 */
function normaliseForceOutcome(answer: unknown): WedgeForceOutcome {
  // The answer as a plain record, the only shape a foreign service can be read through.
  const record = answer !== null && typeof answer === "object" ? (answer as Record<string, unknown>) : {}
  if (record.ok !== true) {
    return {
      ok: false,
      error: typeof record.error === "string" && record.error !== "" ? record.error : "the force action answered without a reason",
      ...(record.retryable === true ? { retryable: true } : {}),
    }
  }
  // The requeued row, when the answer names one.
  const requeued = record.requeued !== null && typeof record.requeued === "object" ? (record.requeued as Record<string, unknown>) : undefined
  // S6: the terminal-race answer, when the team plane reported one.
  const skipped = record.skipped !== null && typeof record.skipped === "object" ? (record.skipped as Record<string, unknown>) : undefined
  return {
    ok: true,
    ...(typeof record.handoff === "string" && record.handoff !== "" ? { handoff: record.handoff } : {}),
    ...(record.handoffSource === "member" || record.handoffSource === "supervisor" ? { handoffSource: record.handoffSource } : {}),
    ...(skipped === undefined || typeof skipped.status !== "string"
      ? {}
      : { skipped: { status: skipped.status, revision: typeof skipped.revision === "number" ? skipped.revision : 0 } }),
    ...(requeued === undefined || typeof requeued.taskId !== "string"
      ? {}
      : { requeued: { taskId: requeued.taskId, attempt: typeof requeued.attempt === "number" ? requeued.attempt : 0 } }),
    ...(Array.isArray(record.split) ? { split: record.split.filter((id: unknown): id is string => typeof id === "string") } : {}),
  }
}

/**
 * D3's FORCE SEAM: resolve `mpdTeamActions` at CALL time and adapt its force member.
 *
 * Resolved per call, never captured at apply: team-core may mount after this row, and a composition
 * without it must report and record the wedge instead of failing the tick. The authorising session
 * is the team's own recorded lead, which is the ONLY session the action will build a caller from.
 *
 * @param ctx - the row's cordis context.
 * @returns the seam the engine calls; it never throws (every failure is an `{ ok:false }` answer).
 */
export function forceSeamOf(ctx: unknown): WedgeForceSeam {
  /**
   * Normalise the team plane's grace answer onto {@link WedgeGraceOutcome}.
   *
   * EVERY field is read structurally, like the force answer: a foreign service's shape is untrusted,
   * and an answer that does not say `ok: true` is a refusal with a reason rather than a success.
   *
   * @param answer - whatever the service's `grace` member returned.
   * @returns the outcome the engine records.
   */
  const normaliseGrace = (answer: unknown): WedgeGraceOutcome => {
    // The answer as a plain record, the only shape a foreign service can be read through.
    const record = answer !== null && typeof answer === "object" ? (answer as Record<string, unknown>) : {}
    if (record.ok !== true) {
      return {
        ok: false,
        error: typeof record.error === "string" && record.error !== "" ? record.error : "the grace action answered without a reason",
      }
    }
    return {
      ok: true,
      ...(typeof record.directive === "string" && record.directive !== "" ? { directive: record.directive } : {}),
      ...(typeof record.path === "string" && record.path !== "" ? { path: record.path } : {}),
      ...(typeof record.mail === "string" && record.mail !== "" ? { mail: record.mail } : {}),
      ...(record.delivered === true ? { delivered: true } : {}),
    }
  }
  return {
    graceWedged: async (request: WedgeGraceRequest): Promise<WedgeGraceOutcome> => {
      try {
        // The context's soft service probe; a minimal test context may not carry one.
        const get = (ctx as { get?: (id: string, strict?: boolean) => unknown })?.get
        if (typeof get !== "function") return { ok: false, error: "the plugin context exposes no service lookup" }
        /** The team plane's action surface, or undefined when that row is not mounted. */
        const service = get.call(ctx, TEAM_ACTIONS_SERVICE_ID, false)
        /** The grace member, read structurally because the service is another package's value. */
        const grace = (service as { grace?: unknown } | undefined)?.grace
        if (typeof grace !== "function") return { ok: false, error: "the `mpdTeamActions` service is absent or exposes no grace()" }
        /** The request as the service's grace member takes it. */
        const input = {
          sessionId: request.sessionId,
          teamId: request.teamId,
          taskId: request.taskId,
          workspace: request.workspace,
          evidence: { member: request.member, attemptId: request.attemptId, silentMs: request.silentMs, graceMs: request.graceMs },
        }
        /** The service's raw answer, normalised above. */
        const answer = await (grace as (value: unknown) => Promise<unknown>).call(service, input)
        return normaliseGrace(answer)
      } catch (error) {
        return { ok: false, error: message(error) }
      }
    },
    forceWedged: async (request: WedgeForceRequest): Promise<WedgeForceOutcome> => {
      try {
        // The context's soft service probe; a minimal test context may not carry one.
        const get = (ctx as { get?: (id: string, strict?: boolean) => unknown })?.get
        if (typeof get !== "function") return { ok: false, error: "the plugin context exposes no service lookup" }
        /** The team plane's action surface, or undefined when that row is not mounted. */
        const service = get.call(ctx, TEAM_ACTIONS_SERVICE_ID, false)
        /** The force member, read structurally because the service is another package's value. */
        const force = (service as { force?: unknown } | undefined)?.force
        if (typeof force !== "function") return { ok: false, error: "the `mpdTeamActions` service is absent or exposes no force()" }
        // The evidence the team plane cannot read for itself: the watchdog's own clocks and the
        // handoff's tool history. Everything else (the board, the roster, the interrupt) is team-core's.
        /** The request as the service's force member takes it. */
        const input = {
          sessionId: request.sessionId,
          teamId: request.teamId,
          taskId: request.taskId,
          workspace: request.workspace,
          evidence: {
            member: request.member,
            attemptId: request.attemptId,
            startedAt: request.startedAt,
            elapsedMs: request.elapsedMs,
            // S5/S6: the measured idle duration, the grace instant, the tool calls WITH argument
            // excerpts and the last assistant message — everything the fallback handoff must carry.
            silentMs: request.silentMs,
            graceSentAt: request.graceSentAt,
            // F2: the CONFIGURED window, so the team plane's captain notice quotes the operator's
            // `graceMs` rather than assuming the 90 s default.
            graceMs: request.graceMs,
            lastToolCalls: request.lastToolCalls,
            toolCalls: request.toolCalls,
            assistantMessage: request.assistantMessage,
          },
        }
        /** The service's raw answer, normalised below. */
        const answer = await (force as (value: unknown) => Promise<unknown>).call(service, input)
        return normaliseForceOutcome(answer)
      } catch (error) {
        return { ok: false, error: message(error) }
      }
    },
  }
}

/** One line on stderr, never a throw. */
function warn(prefix: string, text: string): void {
  try {
    rowLogLine("mpd-team-watchdog", "[" + prefix + "] " + text)
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
  // The loader hands `apply` an untyped ctx, so the engine's own context shape is asserted here.
  const context = (ctx ?? {}) as EngineContext
  // The row config with every documented default applied.
  const resolved = resolveConfig(config)
  // The adapter seam: the mounted `mpdDsh` when present, else a row-private one.
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
  // Durable holds loaded from disk at apply; stays 0 when hydration degrades.
  let hydratedHolds = 0
  try {
    // Every workspace root whose holds this apply should hydrate from.
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

  // The engine handle, assigned once construction succeeds; the catch below returns inert.
  let engine: WatchdogEngine
  try {
    // D3: the fifth seam is the team plane's force action, resolved per call inside `forceSeamOf`, so
    // a row that mounts later (or never) degrades to "report the wedge, act on nothing" — never to a
    // failed boot and never to a thrown tick.
    engine = new WatchdogEngine(dsh, context, resolved, registry, forceSeamOf(context))
  } catch (error) {
    warn(resolved.logPrefix, "engine construction failed — the row is inert: " + message(error))
    return { applied: false, engine: null, knobs: readKnobs(undefined), intervalMs: 0, disposers: 0, holdService: null, hydratedHolds, error: message(error) }
  }

  // The published hold-service id, or null when `ctx.provide` is unavailable.
  let holdService: string | null = null
  try {
    // The ctx's `provide` seam, read defensively because a minimal test ctx may lack it.
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

  // Teardown callbacks the engine registered; `cleanup` invokes each exactly once.
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
      // The status view names the AUTHORITATIVE plane's teams, read per call (T3).
      mpdTeams: () => mpdTeamsOf(context),
    })
    disposers = engine.install()
  } catch (error) {
    warn(resolved.logPrefix, "registration degraded: " + message(error))
  }

  // ── THE WEB MUTATIONS: pause/resume ONE team from a browser or a mobile client ────────────────
  // The two routes share the SAME `stateDir` and the SAME `HoldRegistry` as the tools above, so a
  // pause applied over HTTP is visible to the dispatch gates in this process at once. A composition
  // with no web server mounts nothing (the row stays tool-only) and never throws.
  try {
    /** The ctx's effect seam, passed as the row's route-lifetime owner; absent in a bare test ctx. */
    const effect: WatchdogEffect | undefined =
      typeof context.effect === "function" ? (register: () => unknown) => context.effect?.(register) : undefined
    /** Whether both routes mounted at apply; false is normal on a headless profile. */
    const mounted = registerWatchdogWeb(dsh, effect, {
      stateDir: resolved.stateDir,
      registry,
      holdTtlMs: () => engine.getKnobs().holdTtlMs,
      warn: (line: string) => warn(resolved.logPrefix, line),
    })
    if (mounted) warn(resolved.logPrefix, "web routes: " + WATCHDOG_ROUTES.join(" "))
  } catch (error) {
    warn(resolved.logPrefix, "web route registration degraded: " + message(error))
  }

  // Exactly ONE interval owns the cadence; a live knob change replaces it, never
  // adds a second one. `unref` keeps a pending watchdog from holding the host open.
  let timer: ReturnType<typeof setInterval> | undefined
  // Cadence the running interval was started with, used to detect a live knob change.
  let intervalMs = engine.getKnobs().tickIntervalMs
  // Clear the single cadence interval, tolerating an already-cleared handle.
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
  // Replace the cadence interval with one at `next` ms, so two never run at once.
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

  // Dispose the whole row: stop the tick, run every disposer, stop the engine.
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

  // Knob problems the resolver recorded, each reported once on stderr below.
  const issues = engine.getKnobs().issues
  for (const issue of issues) warn(resolved.logPrefix, "knob " + issue.path + ": " + issue.problem + " — using " + JSON.stringify(issue.fallback))
  // The boot log line a mount lane greps: proof the row APPLIED (not merely composed).
  try {
    rowLogLine("mpd-team-watchdog", 
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
