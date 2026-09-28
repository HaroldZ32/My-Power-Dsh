// The watchdog engine: the writers (heartbeat + turn boundaries), the tick, and
// the WARN/ESCALATE fan-out (scene, hold, incident).
//
// r6 adds the OTHER half of the tool heartbeat: a PRE-dispatch stamp (`tool-start`) from the
// adapter's observe-only `tools/pre-execute` hook, which marks a member's tool call IN FLIGHT
// until its POST stamp arrives. A member that spends longer than `warnSilenceMs` inside ONE
// call is then EXPLAINED activity — before r6 it looked exactly like a wedge and the tick
// paused a healthy team (measured on our own team). The POST stamp keeps its W-9 semantics
// (completion, never before dispatch); the PRE stamp is what makes the pair readable.
//
// Everything the engine touches goes through the adapter or the plugin's own
// store; nothing here reaches a harness service directly (AGENTS.md §6). The
// engine is a plain class so a test or a lane can drive `tickOnce(now)` with an
// injected clock and a stub adapter, without a boot.
import { type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { HOLD_TOOL, applyHold, applyResume } from "./actions.js"
import { ChannelFold, type ChannelView } from "./channel.js"
import { readWatchdogSection } from "./config-file.js"
import { heldTeamIds, type HoldRegistry } from "./holds.js"
import {
  candidateFor,
  knobReadings,
  overlayWatchdogSection,
  readKnobs,
  sectionDigest,
  WatchdogMachine,
  watchdogSectionOf,
  type ChannelState,
  type Decision,
  type KnobIssue,
  type KnobReading,
  type ResolvedKnobs,
  type SilenceCandidate,
  type WatchdogKnobs,
} from "./machine.js"
import { sceneDir } from "./paths.js"
import { buildScene, mailboxUnreadObservable, writeScene, type SceneIncident } from "./scene.js"
import { appendIncident, readHold, readIncidents, readWatermarks, type IncidentRecord } from "./sidecars.js"
import { appendHeartbeat, listHeartbeatKeys, message, readHeartbeats, rotateHeartbeats, type HeartbeatKind, type HeartbeatStamp } from "./store.js"
import { agentIds, CAPTAIN_KEY, currentTask, dependencyBlocked, readTeams, resolveIdentity, teamOf, type TeamRecord } from "./team.js"

/** Fully-resolved engine configuration (no optional key left). */
export interface EngineConfig {
  /** Team state directory, relative to the workspace. */
  stateDir: string
  /** The kill switch; a disabled engine records and holds nothing. */
  enabled: boolean
  /** OUTSTANDING age in ms that triggers the first WARN. */
  warnSilenceMs: number
  /** Tick cadence in ms, below `warnSilenceMs` by construction. */
  tickIntervalMs: number
  /** Consecutive OUTSTANDING observations for one task+attempt before ESCALATE. */
  warnStreakToEscalate: number
  /** What ESCALATE does: persist a hold (`pause`) or only record it. */
  actionOnEscalate: "pause" | "warn-only"
  /** How long the live team readout stays cached between reads (0 disables). */
  teamCacheMs: number
  /** How many heartbeat generations to keep per member file. */
  keepGenerations: number
  /**
   * DEAD-TEAM FALLBACK (r4): how long a record may go untouched before a tick skips it when the
   * live-agent registry cannot answer. 0 disables the bound (tick everything, the status quo).
   */
  deadTeamGraceMs: number
  /**
   * THE SECONDARY BOUND on the r6 in-flight rule: how long ONE open tool call may suppress the
   * silence rule. Past it the entry stops suppressing and is reported once as `tool-expired`
   * (WARN-class only). 0 disables the suppression entirely — the pre-r6 behaviour.
   */
  toolInFlightMaxMs: number
  /**
   * T-17's hold TTL (§3): how long a hold a `pause` escalation persisted may live before it is
   * auto-released with a durable incident. `0` = never expire.
   */
  holdTtlMs: number
  /** Print skipped-team reasons to the console as well as the debug channel. */
  verboseSkips: boolean
  /** Prefix of every console and logger line this engine writes. */
  logPrefix: string
}

/** Engine counters; every one is evidence for AC-15's fail-safe claims. */
export interface EngineStats {
  /** Tick bodies entered, including skipped and failed ones. */
  ticks: number
  /** Ticks that threw and were contained. */
  tickErrors: number
  /** Ticks skipped because the previous one was still running. */
  tickSkips: number
  /** Heartbeat stamps that reached disk. */
  heartbeatWrites: number
  /** Heartbeat stamps an unwritable location refused. */
  heartbeatFailures: number
  /** Heartbeat files rotated by the turn-end rule. */
  rotations: number
  /** Scene documents written. */
  scenes: number
  /** Scene writes that failed, each reported loudly and never fatal. */
  sceneFailures: number
  /** Preserving holds persisted through the pause action. */
  holdsApplied: number
  /** Hold attempts that did not land; no pause is announced for those. */
  holdsFailed: number
  /** Incident records appended durably. */
  incidents: number
  /** Incident appends that failed. */
  incidentFailures: number
  /** `never-started` observations recorded. */
  neverStarted: number
  /** Teams a tick skipped because they cannot dispatch (r4). */
  skippedTeams: number
  /** PRE-dispatch tool stamps written (r6) — proof the observe-only hook reached the store. */
  toolStarts: number
  /** `tool-expired` reports recorded (r6's secondary bound fired). */
  toolExpired: number
  /** `session/event` records folded into the four-state channel predicate (§1). */
  channelEvents: number
  /** Candidates whose owner session the fold could not answer for (§4 fallback). */
  channelFallbacks: number
  /** `agent/assistant-stream` start frames that flipped an OUTSTANDING step ALIVE. */
  streamFrames: number
  /** Members reported PARKED because their session is not attached (§1's PARKED row). */
  channelDetached: number
  /** T-20: members reported PARKED because every open task waits on an unfinished dependency. */
  channelDependencyBlocked: number
  /** T-17: holds released by the TTL or the activity path (each also wrote an incident). */
  holdsAutoReleased: number
  /** T-17: auto-release attempts that could not clear the hold (reported, never silent). */
  holdsAutoReleaseFailures: number
  /** `Error#message` of the newest contained failure, or null. */
  lastError: string | null
}

/** Which predicate concluded the states this process is running on (§4's honest answer). */
export interface PredicateStatus {
  /** `channel` = the §1 fold is the authority; `heartbeat` = the §4 report-only fallback. */
  source: "channel" | "heartbeat"
  /** Why the source is what it is (one line, for the status view and the boot log). */
  reason: string
  /** Whether the `agent/assistant-stream` enrichment is installed (§2). */
  enrichment: boolean
  /** Fold counters: events consumed and sessions known. */
  events: number
  /** How many member sessions the fold currently knows. */
  sessions: number
  /** The current state per known session id. */
  states: Record<string, ChannelState>
  /** Fallback announcements made (once per process, §4). */
  announced: boolean
}

/** The result of one tick. */
export interface TickResult {
  /** WARN and ESCALATE decisions this tick produced (the report-only kinds are not decisions). */
  decisions: Decision[]
  /** Paths of the scene files this tick wrote. */
  scenes: string[]
  /** Team ids this tick put under a preserving hold. */
  holds: string[]
  /** Why the tick did nothing, when it did nothing. */
  skipped?: string
}

/** The engine's context dependency: events, cleanup and an optional logger. */
export interface EngineContext {
  /** Subscribe to a harness event through the adapter's verbatim bridge. */
  on?: (event: string, handler: (...args: any[]) => unknown) => unknown
  /** Register a cleanup callback the host runs when the row is disposed. */
  effect?: (callback: () => unknown) => unknown
  /** Optional host logger; the console carries every line regardless. */
  logger?: { warn?: (text: string) => void; info?: (text: string) => void }
  [key: string]: unknown
}

/** A settings namespace read through the adapter, never a direct service call. */
function readNamespaceValue(dsh: DshAdapter): { value: unknown; error: string | null } {
  try {
    // The `mpd` settings reader, absent when that service is not mounted.
    const reader = dsh.settingsReader("mpd")
    return { value: reader?.get(), error: null }
  } catch (error) {
    return { value: undefined, error: message(error) }
  }
}

/** The §7.2 issue one failed namespace read leaves behind (the row defaults are used instead). */
function namespaceReadIssue(error: string): KnobIssue {
  return { path: "watchdog", problem: "settings read failed: " + error, fallback: "defaults" }
}

/** A settings namespace read through the adapter, never a direct service call. */
function readNamespaceKnobs(
  dsh: DshAdapter,
  env: Record<string, string | undefined>,
  defaults: WatchdogKnobs,
): ResolvedKnobs {
  // The namespace read and its error; exactly one of the two carries meaning.
  const { value, error } = readNamespaceValue(dsh)
  // The knobs read from the namespace value, before the read error is folded in.
  const base = readKnobs(value, env, defaults)
  if (error === null) return base
  return { ...base, issues: [...base.issues, namespaceReadIssue(error)] }
}

/** Unwrap the value a harness tool call returns. */
function toolValue(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object") return undefined
  // The `value` field a harness tool result wraps, when it carries one.
  const candidate = (raw as { value?: unknown }).value
  if (candidate !== null && typeof candidate === "object") return candidate as Record<string, unknown>
  return raw as Record<string, unknown>
}

/**
 * The session id a harness payload names.
 *
 * A `session/event` delivers the `Session` itself (`session.id`); an agent payload (the
 * `agent/assistant-stream` frame wrapper) delivers an agent whose own session carries it.
 * Only ids are read here — no event payload is ever written to disk.
 */
function sessionIdOf(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null
  // The payload as a record, so id and session can be probed safely.
  const record = value as Record<string, unknown>
  // The payload's own id, which a Session object carries directly.
  const direct = record.id
  if (typeof direct === "string" && direct !== "") return direct
  // The nested session an agent payload wraps.
  const session = record.session
  if (session !== null && typeof session === "object") {
    // The nested session's id, when it states one.
    const id = (session as Record<string, unknown>).id
    if (typeof id === "string" && id !== "") return id
  }
  return null
}

/** One diagnostic line on stderr; never throws. */
function report(text: string): void {
  try {
    console.warn("[mpd-team-watchdog] " + text)
  } catch {
    // nothing left to report with
  }
}

/**
 * Subscribe one harness EVENT, returning a disposer that never throws.
 *
 * The seam is the ADAPTER's `onEvent`, not the raw ctx: an event NAME is part of the
 * harness's surface, so a release that renames `agent/pre-step` must be absorbed in
 * `mpd-dsh-adapter` rather than in every listener here (AGENTS.md §6). The adapter
 * forwards the handler verbatim — cordis appends `next` for a waterfall, which is what
 * the pre-step delegate below depends on — and answers `undefined` when the composition
 * has no event bus.
 *
 * Containment stays HERE on purpose: the adapter's `onEvent` is a passthrough, so a
 * throwing handler would reach the bus. The wrapper keeps the plugin's own contract (a
 * heartbeat failure may never cost a step its decision) and is why the pre-step handler
 * ALSO delegates unconditionally in its own body.
 */
export function subscribe(
  dsh: Pick<DshAdapter, "onEvent">,
  event: string,
  handler: (...args: any[]) => unknown,
): () => void {
  try {
    // The handler wrapped so a throw becomes a report instead of a bus error.
    const wrapped = (...args: any[]): unknown => {
      try {
        return handler(...args)
      } catch (error) {
        report("[" + event + "] handler threw: " + message(error))
        return undefined
      }
    }
    // The subscription handle the adapter returned, of either supported shape.
    const disposer = dsh.onEvent(event, wrapped)
    if (typeof disposer === "function") return disposer as () => void
    if (disposer !== undefined && typeof (disposer as { dispose?: unknown }).dispose === "function") {
      // The handle read as an object exposing a `dispose()` method.
      const target = disposer as { dispose: () => void }
      return () => target.dispose()
    }
    return () => {}
  } catch (error) {
    report("could not subscribe to " + event + ": " + message(error))
    return () => {}
  }
}

/**
 * The watchdog engine. One instance per applied row.
 *
 * The engine owns the ONLY timers the package creates; `apply` installs the
 * single tick interval and clears it through `ctx.effect`.
 */
export class WatchdogEngine {
  /** The adapter: the ONE harness contact surface this engine uses. */
  private readonly dsh: DshAdapter
  /** The cordis plugin context: events, cleanup and the optional logger. */
  private readonly ctx: EngineContext
  /** The resolved engine configuration, i.e. the knobs' defaults layer. */
  private readonly config: EngineConfig
  /** The WARN/ESCALATE ladder; one per engine. */
  private readonly machine = new WatchdogMachine()
  /** The synchronous hold reader, when the row published one. */
  private readonly registry: HoldRegistry | undefined
  /** Workspace roots seen so far, taught by stamps and by reads. */
  private readonly roots = new Set<string>()
  /** Live team readout per workspace key, bounded by `teamCacheMs`. */
  private readonly teamCache = new Map<string, { at: number; teams: TeamRecord[] }>()
  /** The knobs the process is running with, refreshed on every tick. */
  private knobs: ResolvedKnobs
  /** Whether a tick body is running, which makes the next one skip. */
  private ticking = false
  /** Set by `stop()`; a stopped engine still answers reads. */
  private stopped = false
  /** Monotonic turn counter, used to give every turn its own id. */
  private turnSeq = 0
  /**
   * THE FOUR-STATE CHANNEL FOLD (contract §1): the process's single fold, fed by the
   * `session/event` firehose through the adapter. It is the ONE authority for a member's
   * state; the heartbeat stamps decide only the `tool-expired` bound and remain the §4
   * fallback source.
   */
  private readonly fold = new ChannelFold()
  /** Whether the §2 enrichment (`agent/assistant-stream`) is installed. */
  private enrichment = false
  /** The predicate source actually running, and why (named in the status view, §4). */
  private predicateSource: "channel" | "heartbeat" = "heartbeat"
  /** Why the running predicate source is what it is, in one line. */
  private predicateReason = "not installed yet"
  /** Whether the once-per-process §4 fallback announcement was made. */
  private fallbackAnnounced = false
  /** §7.3: whether the once-per-process knob-divergence warning was made. */
  private divergenceAnnounced = false
  /** §7.2: the last computed per-knob live-vs-file reading (for the status view). */
  private knobView: { readings: KnobReading[]; divergent: string[]; restartRequired: boolean; file: string | null; fileFound: boolean; fileApplied: boolean; liveLayer: "namespace" | "file" } = {
    readings: [],
    divergent: [],
    restartRequired: false,
    file: null,
    fileFound: false,
    fileApplied: false,
    liveLayer: "namespace",
  }
  /**
   * T-18 (wave 2, user ruling): the knob layers as LAST OBSERVED, so the engine can tell a file
   * edit from a settings edit and let the layer that MOVED win (the settings front door stays the
   * tie-breaker, and the mount-time rule is unchanged: the resolved namespace is authoritative).
   */
  private readonly layerDigests: { namespace: string | null; file: string | null } = { namespace: null, file: null }
  /** Whether both layer digests have been observed at least once (the mount call seeds them). */
  private layersSeen = false
  /** The layer the running values came from, and the file that supplied them when it is `file`. */
  private liveLayer: "namespace" | "file" = "namespace"
  /** The `.mpd/mpd.jsonc` that supplied the running knobs, when the file layer won. */
  private liveFile: string | null = null
  /** Set by `apply` so a live cadence change can rebuild the single timer. */
  onKnobsChanged: ((knobs: ResolvedKnobs) => void) | undefined
  /** The engine counters, exposed through `getStats()`. */
  private readonly stats: EngineStats = {
    ticks: 0,
    tickErrors: 0,
    tickSkips: 0,
    heartbeatWrites: 0,
    heartbeatFailures: 0,
    rotations: 0,
    scenes: 0,
    sceneFailures: 0,
    holdsApplied: 0,
    holdsFailed: 0,
    incidents: 0,
    incidentFailures: 0,
    neverStarted: 0,
    skippedTeams: 0,
    toolStarts: 0,
    toolExpired: 0,
    channelEvents: 0,
    channelFallbacks: 0,
    streamFrames: 0,
    channelDetached: 0,
    channelDependencyBlocked: 0,
    holdsAutoReleased: 0,
    holdsAutoReleaseFailures: 0,
    lastError: null,
  }

  /**
   * @param dsh - the adapter (the ONE harness contact surface).
   * @param ctx - the cordis plugin context (events, cleanup, logger).
   * @param config - the resolved engine configuration.
   */
  constructor(dsh: DshAdapter, ctx: EngineContext, config: EngineConfig, registry?: HoldRegistry) {
    this.dsh = dsh
    this.ctx = ctx
    this.config = config
    this.registry = registry
    this.knobs = readNamespaceKnobs(dsh, process.env, this.knobDefaults())
    this.remember(this.workspaceOf(undefined))
  }

  /** The resolved knobs (settings first, then the row config's kill switch). */
  getKnobs(): ResolvedKnobs {
    return this.knobs
  }

  /** The counters, copied so a caller cannot mutate them. */
  getStats(): EngineStats {
    return { ...this.stats }
  }

  /** The current streak/escalate/in-flight state (diagnostics). */
  getMachineState(): ReturnType<WatchdogMachine["snapshot"]> {
    return this.machine.snapshot()
  }

  /**
   * WHICH PREDICATE IS RUNNING, and what it concluded (§4: "the `session-watchdog-status`
   * output names the active predicate source"). A diagnostics read, never a decision input.
   */
  predicateStatus(): PredicateStatus {
    // The fold's own counters and its per-session state map.
    const snapshot = this.fold.snapshot()
    return {
      source: this.predicateSource,
      reason: this.predicateReason,
      enrichment: this.enrichment,
      events: snapshot.events,
      sessions: snapshot.sessions,
      states: snapshot.states,
      announced: this.fallbackAnnounced,
    }
  }

  /** The channel view of one member session, or null when the fold has no data (§4). */
  channelViewOf(sessionId: string): ChannelView | null {
    return this.fold.view(sessionId)
  }

  /** Every workspace root the engine will tick over. */
  knownRoots(): string[] {
    // The union of remembered, live and fallback roots, as a local copy.
    const roots = new Set(this.roots)
    try {
      for (const root of this.dsh.workspaceRootsAll() ?? []) roots.add(root)
    } catch {
      // an absent agent registry is not an error: stamps still teach us roots
    }
    try {
      roots.add(this.dsh.workspaceRoot())
    } catch {
      // process.cwd() is the adapter's own last resort
    }
    return [...roots].sort()
  }

  /**
   * Re-read the knob set (called at apply, on `settings/document-updated`, and once per tick).
   *
   * T-18 (wave 2, user ruling): `knobs are DATA, so T-21's module-cache limit does not apply`.
   * The namespace VALUE is the frozen part — a settings registration resolves a snapshot at mount
   * and a `.mpd/mpd.jsonc` edit reaches it only at the next boot (`mpd-config`'s own note). The
   * window's OWN file is parsed live by `config-file.ts` on every call, so this method lets the
   * layer that MOVED win:
   *
   *   * the settings namespace moved and the file did not  ⇒ the settings front door wins;
   *   * the FILE moved and the namespace did not           ⇒ the file's stated leaves win, live,
   *     in THIS process, with no restart (the measured T-18 case: `watchdog.warnSilenceMs = 600000`
   *     written to `.mpd/mpd.jsonc` and ignored until a boot);
   *   * neither, or BOTH (a settings write that also rewrites the file) ⇒ the last winner stays;
   *     on the very first call the namespace wins, so the mount-time rule is unchanged.
   *
   * The winner is sticky rather than re-decided per read, which is what keeps a file value from
   * being dropped on the next tick when neither layer moved again.
   */
  refreshKnobs(env: Record<string, string | undefined> = process.env): ResolvedKnobs {
    // The namespace read split into the two names the layer logic uses.
    const { value: namespaceValue, error } = readNamespaceValue(this.dsh)
    // Stable digest of the namespace's `watchdog` section; null when it states none.
    const namespaceDigest = sectionDigest(watchdogSectionOf(namespaceValue))
    // The workspace config file read: found flag, path and raw section.
    const file = readWatchdogSection(this.workspaceOf(undefined))
    // Digest of that file's section, or null when the file states none.
    const fileDigest = file.found ? sectionDigest(file.section) : null
    if (this.layersSeen) {
      // Whether the settings layer moved since the last observation.
      const namespaceChanged = namespaceDigest !== this.layerDigests.namespace
      // Whether the workspace file layer moved since the last observation.
      const fileChanged = fileDigest !== this.layerDigests.file
      if (fileChanged && !namespaceChanged) {
        this.liveLayer = "file"
        this.liveFile = file.path
      } else if (namespaceChanged) {
        // A settings write (alone, or together with its own write-back) is the front door and
        // outranks a file that did not move in the same window.
        this.liveLayer = "namespace"
        this.liveFile = null
      }
    } else {
      this.layersSeen = true
    }
    this.layerDigests.namespace = namespaceDigest
    this.layerDigests.file = fileDigest
    // The namespace value, with the file layer overlaid when the file is the live layer.
    const base = this.liveLayer === "file" && fileDigest !== null ? overlayWatchdogSection(namespaceValue, file.section) : namespaceValue
    // The knobs read from that base value.
    const resolved = readKnobs(base, env, this.knobDefaults())
    this.knobs = error === null ? resolved : { ...resolved, issues: [...resolved.issues, namespaceReadIssue(error)] }
    return this.knobs
  }

  /**
   * The row config as the knobs' DEFAULTS layer.
   *
   * The `mpd` namespace is the live authority (AC-11); the row's own keys are what a
   * composition gets when no `watchdog` section has been written, so a row can be
   * tuned without touching settings.
   */
  private knobDefaults(): WatchdogKnobs {
    return {
      enabled: this.config.enabled,
      warnSilenceMs: this.config.warnSilenceMs,
      tickIntervalMs: this.config.tickIntervalMs,
      warnStreakToEscalate: this.config.warnStreakToEscalate,
      actionOnEscalate: this.config.actionOnEscalate,
      toolInFlightMaxMs: this.config.toolInFlightMaxMs,
      holdTtlMs: this.config.holdTtlMs,
    }
  }

  /**
   * §4's degradation announcement: ONE warning line per process.
   *
   * A watchdog that goes quiet is worse than a noisy one, so the fallback is never silent —
   * but it is also not a per-tick stream: the callers that discover it run every tick, and
   * the announcement is what a user needs, not a flood.
   */
  private noteFallback(reason: string): void {
    this.stats.channelFallbacks += 1
    this.predicateSource = "heartbeat"
    this.predicateReason = reason
    if (this.fallbackAnnounced) return
    this.fallbackAnnounced = true
    this.warn(
      "PREDICATE FALLBACK (§4): " + reason +
        " — the engine now runs the heartbeat rule in REPORT-ONLY mode: it may WARN (cause `silence-heartbeat`) " +
        "and it can NEVER hold or escalate a team while this lasts. The `session/event` fold is the intended authority.",
    )
  }

  /**
   * The live-agent registry, with the `known` flag the liveness gate uses.
   *
   * `known` is deliberately conservative: it is true only when the adapter reports the
   * agents capability AND the registry returned at least one entry. An empty or absent
   * registry must never make the watchdog conclude "nobody is attached" — that would turn
   * a missing seam into a silent watchdog, the one failure mode this wave exists to remove.
   */
  private liveIds(): { known: boolean; ids: Set<string> } {
    // The live agent ids this process's registry reports.
    const ids = new Set<string>()
    // Whether the registry demonstrably knows agents: the capability is present and non-empty.
    let known = false
    try {
      // The adapter's capability flags, probed defensively.
      const capabilities = (this.dsh as { capabilities?: () => { agents?: boolean } }).capabilities?.()
      known = capabilities?.agents === true
      if (known) {
        for (const agent of this.dsh.liveAgents() ?? []) {
          // The live agent's id, when it carries a string one.
          const id = (agent as { id?: unknown } | undefined)?.id
          if (typeof id === "string" && id !== "") ids.add(id)
        }
      }
    } catch {
      return { known: false, ids: new Set<string>() }
    }
    return { known: known && ids.size > 0, ids }
  }

  /** Drop the team-record cache (tests and lanes use it after rewriting a record). */
  invalidate(): void {
    this.teamCache.clear()
  }

  /** Stop ticking (the ctx.effect cleanup path and the tests). */
  stop(): void {
    this.stopped = true
  }

  /** Whether the engine was stopped. */
  isStopped(): boolean {
    return this.stopped
  }

  /** Remember a workspace root so later ticks observe it. */
  private remember(workspace: string): void {
    if (typeof workspace === "string" && workspace !== "") this.roots.add(workspace)
  }

  /**
   * The live team readout for one workspace, cached for `teamCacheMs`.
   *
   * SOURCE (0.1.7): `dsh.teamLiveTeams()` — the OFFICIAL Agent Teams readout, folded by the
   * adapter over the live agent registry. There is no `<stateDir>/<teamId>/team.json` any more,
   * and the folded readout is the only truth about a roster and a board. The cache now bounds
   * two live service reads per tick (the fold is per live Lead), not a file parse.
   *
   * The workspace is still part of the cache key: the readout itself is process-wide, but a
   * per-workspace entry keeps the tick's accounting (and `invalidate()`) exactly as they were.
   */
  private teams(workspace: string, now: number = Date.now()): TeamRecord[] {
    // The cache key: workspace and state directory, so two rows never share an entry.
    const key = workspace + "\u0000" + this.config.stateDir
    // The cached readout for this workspace, when one is still fresh.
    const cached = this.teamCache.get(key)
    if (this.config.teamCacheMs > 0 && cached !== undefined && now - cached.at < this.config.teamCacheMs) return cached.teams
    // The live readout from the adapter, cached below for `teamCacheMs`.
    const teams = readTeams(this.dsh)
    this.teamCache.set(key, { at: now, teams })
    return teams
  }

  /** The workspace root for an agent (adapter precedence, never cached). */
  private workspaceOf(agent: unknown): string {
    return this.dsh.workspaceRoot(agent === undefined ? undefined : ({ agent } as never))
  }

  /**
   * Write one heartbeat stamp for an agent.
   *
   * @param kind - the heartbeat kind.
   * @param agent - the live agent (or a payload wrapping one).
   * @param extra - tool-specific fields.
   * @returns the stamp written; a failed write is counted and never thrown.
   */
  stamp(kind: HeartbeatKind, agent: unknown, extra: { tool?: string; callId?: string; ok?: boolean } = {}): HeartbeatStamp {
    // The agent's identity facts, read from whatever shape the caller passed.
    const ids = agentIds(agent)
    // The workspace root, resolved from the agent's own cwd when it has one.
    const workspace = this.workspaceOf(ids.cwd !== undefined ? agent : undefined)
    this.remember(workspace)
    // The live team this agent belongs to, when one resolves.
    const team = teamOf(this.teams(workspace), agent)
    // The agent's role inside that team: member, captain, or unattached.
    const identity = resolveIdentity(team, agent)
    if (kind === "turn-start") this.turnSeq += 1
    // The heartbeat file key: the member name, else a per-session key.
    const memberKey =
      identity.member ?? "session-" + (ids.sessionId.slice(0, 8) || ids.agentId.slice(0, 8) || "unknown")
    // The task the member currently owns, when both the team and the member resolve.
    const task = team !== undefined && identity.member !== null ? currentTask(team, identity.member) : undefined
    // The stamp's clock, read once so no two fields of one record can disagree.
    const at = Date.now()
    // The record that will be appended to the member's heartbeat file.
    const stamp: HeartbeatStamp = {
      kind,
      at,
      member: identity.member,
      memberKey,
      teamId: team?.id ?? null,
      taskId: task?.id ?? null,
      attemptId: task?.attemptId ?? null,
      turnId: memberKey + "#" + String(this.turnSeq),
      ...(extra.tool === undefined ? {} : { tool: extra.tool }),
      ...(extra.callId === undefined ? {} : { callId: extra.callId }),
      ...(extra.ok === undefined ? {} : { ok: extra.ok }),
      workspace,
    }
    // The append outcome; a failure is counted and reported, never thrown.
    const written = appendHeartbeat(workspace, this.config.stateDir, memberKey, stamp)
    if (written.ok) {
      this.stats.heartbeatWrites += 1
      if (kind === "tool-start") this.stats.toolStarts += 1
    } else {
      this.stats.heartbeatFailures += 1
      this.stats.lastError = written.error ?? "heartbeat write failed"
      this.warn("heartbeat write failed at " + written.path + ": " + String(written.error))
    }
    return stamp
  }

  /** Subscribe every heartbeat writer, the POST hook and the settings re-read. */
  install(): (() => void)[] {
    // Teardown callbacks for every subscription this install made.
    const disposers: (() => void)[] = []
    // Unwrap the live agent a harness payload carries.
    const agentOf = (payload: unknown): unknown => (payload as { agent?: unknown } | undefined)?.agent
    if (typeof this.dsh.onEvent === "function") {
      // `agent/pre-step` IS A CORDIS WATERFALL, and a waterfall listener's return value
      // REPLACES the value being composed: cordis dispatches it as
      // `(cbs.shift() ?? inner)(...args)` with `next` appended, so a listener that returns
      // without calling `next()` VETOES the rest of the chain and its own return value
      // becomes the step decision (`@deepseek-ai/cordis` `EventsService.waterfall`).
      //
      // The bug this closes (measured 2026-09-16 on a real mpd session): the handler used
      // to be `(payload) => this.stamp("step", …)`, i.e. it returned a HeartbeatStamp.
      // That stamp — an object with no `messages` — BECAME the pre-step decision, so the
      // harness's own turn loop (and the official team plugin's pre-step listeners) read
      // `decision.messages` as undefined and the turn died instantly, before any model
      // call, with `Cannot read properties of undefined (reading 'map')` (or `findLastIndex`
      // / `length`, depending on which consumer read the decision first). Every turn of
      // every session in the process failed; the harness recorded
      // `turn/end {reason:{kind:"error",code:"UNKNOWN"}}` and nothing else.
      //
      // A heartbeat is NOT a decision. This listener stamps the step and then DELEGATES:
      // it calls `next()` and returns whatever the rest of the chain produced, so the
      // decision (and every downstream listener) is untouched. The stamp happens first so
      // the heartbeat still records the step when a downstream listener throws.
      disposers.push(
        subscribe(this.dsh, "agent/pre-step", (payload: unknown, next: unknown) => {
          // The stamp is contained HERE, not only by `subscribe`'s wrapper: that wrapper
          // answers a thrown handler with `undefined` — which is itself a waterfall VETO
          // (the chain never reaches `next()`), so a heartbeat failure would cost the step
          // its decision. Report, then delegate regardless.
          try {
            this.stamp("step", agentOf(payload))
          } catch (error) {
            this.warn("pre-step heartbeat failed (the step decision is unaffected): " + message(error))
          }
          return typeof next === "function" ? (next as () => unknown)() : undefined
        }),
      )
      // `agent/session-start` is an EMIT and `agent/turn-stopping` a SERIAL dispatch
      // (`dsh-agent-loop`), so their return values are ignored / only `null`, `false` and
      // `undefined` do not bail; neither may be turned into a waterfall-style delegate.
      // Both handlers nevertheless return NOTHING on purpose: a heartbeat is not an answer
      // to any dispatch, and a stamp returned from a `serial` listener would BAIL the rest
      // of the chain (`isBailed`), so the vestigial `return stamp` is removed here too.
      disposers.push(
        subscribe(this.dsh, "agent/session-start", (payload: unknown) => {
          this.stamp("turn-start", agentOf(payload) ?? payload)
        }),
      )
      disposers.push(
        subscribe(this.dsh, "agent/turn-stopping", (payload: unknown) => {
          // The turn-end stamp, whose workspace and member key drive the rotation.
          const stamp = this.stamp("turn-end", agentOf(payload) ?? payload)
          // The rotation outcome; only a real change is counted.
          const rotated = rotateHeartbeats(stamp.workspace, this.config.stateDir, stamp.memberKey, this.config.keepGenerations)
          if (rotated.rotated) this.stats.rotations += 1
        }),
      )
    } else {
      this.warn("the adapter exposes no event seam — heartbeat writers not installed")
    }

    // ── THE PRIMARY SIGNAL (contract §2): the `session/event` firehose ───────────────
    // `session/event` is an EMIT (`@mode emit` in `dsh-session`'s own declaration), so a
    // listener's return value is IGNORED and this subscription can never veto a turn —
    // unlike `agent/pre-step`, whose waterfall semantics cost us the 2026-09-16 incident.
    // The fold is incremental and per session; the tick reads it, nothing else does.
    if (typeof this.dsh.onEvent === "function") {
      // The subscription handle for the `session/event` firehose.
      const offSession = this.dsh.onEvent("session/event", (session: unknown, event: unknown) => {
        try {
          // The session the event belongs to; an unreadable id drops the event.
          const sessionId = sessionIdOf(session)
          if (sessionId === null) return
          // The fold's conclusion after this event, or null when it had nothing to read.
          const view = this.fold.apply(sessionId, event)
          if (view === null) return
          this.stats.channelEvents += 1
        } catch (error) {
          // contained: a malformed event must never take the watchdog down
          this.warn("the session/event fold threw (the tick keeps its last state): " + message(error))
        }
      })
      if (typeof offSession === "function") {
        disposers.push(offSession)
        this.predicateSource = "channel"
        this.predicateReason = "session/event firehose subscribed (§1 fold is the authority)"
      } else {
        this.noteFallback("the adapter's onEvent seam answered undefined for session/event")
      }
    } else {
      this.noteFallback("the adapter exposes no onEvent seam")
    }

    // ── THE ENRICHMENT (contract §2, soft-probe, never required) ────────────────────
    // The `start` frame of `agent/assistant-stream` proves the model is DELIVERING a long
    // answer, which flips the open step to ALIVE while no `assistant/message` is committed
    // yet. Absent, the fold still works and §1 rule 3's asymmetry applies — stated in the
    // README and in AGENTS.md, never hidden here.
    if (typeof this.dsh.onEvent === "function") {
      // The subscription handle for the enrichment stream, when the adapter has the seam.
      const offStream = this.dsh.onEvent("agent/assistant-stream", (payload: unknown) => {
        try {
          // The payload as a record, since the stream frame arrives wrapped.
          const record = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
          // The session of the agent the streaming frame belongs to.
          const sessionId = sessionIdOf(record.agent)
          if (sessionId === null) return
          if (this.fold.noteStreamFrame(sessionId, record.frame ?? payload)) this.stats.streamFrames += 1
        } catch (error) {
          this.warn("the assistant-stream enrichment threw: " + message(error))
        }
      })
      if (typeof offStream === "function") {
        disposers.push(offStream)
        this.enrichment = true
      } else {
        this.info("enrichment unavailable (no agent/assistant-stream): a long streaming answer stays OUTSTANDING until its assistant/message commits (§1 rule 3)")
      }
    }

    // The POST hook stamps on COMPLETION only (W-9: it is the COMPLETION half of the pair —
    // the PRE half is the `tool-start` stamp installed above from the observe-only
    // `tools/pre-execute` hook, and the two are matched by `callId`).
    const post = this.dsh.onPostToolExecute((exec) => {
      // The tool's name, when the harness states one.
      const name = typeof exec?.name === "string" ? exec.name : undefined
      // The harness call id, of unknown type until checked.
      const rawCallId = (exec as { callId?: unknown } | undefined)?.callId
      this.stamp("tool", exec?.agent, {
        ...(name === undefined ? {} : { tool: name }),
        ...(typeof rawCallId === "string" ? { callId: rawCallId } : {}),
        ok: true,
      })
      // A tool call is never an input to the decision: always pass through.
      return undefined
    })
    if (typeof post === "function") disposers.push(post)

    // The PRE hook (r6): mark a tool call IN FLIGHT before it dispatches, so a call that
    // outlives `warnSilenceMs` is EXPLAINED activity instead of silence. The adapter owns
    // `next()` and returns the gate decision verbatim, so this observer can neither change
    // nor veto the call (proven in the adapter's own test on a real cordis waterfall).
    //
    // Soft-probed on BOTH sides: an adapter without the method, or a harness without the
    // event bus, degrades to a warning here and the pre-r6 behaviour (POST-only stamps),
    // never a failed row.
    if (typeof this.dsh.onPreToolExecute === "function") {
      // The subscription handle for the observe-only PRE hook.
      const pre = this.dsh.onPreToolExecute((exec, decision) => {
        // A DENIED call is never dispatched, so there is nothing to hold open. `allow` and
        // `ask` both continue (an approved `ask` dispatches, and a denied one still gets a
        // POST stamp through the harness's post-result path, which clears the entry).
        if (decision !== undefined && decision.kind === "deny") return
        // The tool's name, when the harness states one.
        const name = typeof exec?.name === "string" ? exec.name : undefined
        // The harness call id, of unknown type until checked.
        const rawCallId = (exec as { callId?: unknown } | undefined)?.callId
        this.stamp("tool-start", exec?.agent, {
          ...(name === undefined ? {} : { tool: name }),
          ...(typeof rawCallId === "string" ? { callId: rawCallId } : {}),
        })
      })
      if (typeof pre === "function") disposers.push(pre)
    } else {
      this.warn("the adapter exposes no pre-tool hook — a long tool call stays indistinguishable from silence (r6 unavailable)")
    }

    if (typeof this.dsh.onSettingsDocumentUpdated === "function") {
      disposers.push(
        this.dsh.onSettingsDocumentUpdated("mpd", () => {
          try {
            // The knobs after the re-read, logged and handed to the timer rebuild.
            const next = this.refreshKnobs()
            this.info(
              "knobs re-read (enabled=" + next.enabled + ", warnSilenceMs=" + next.warnSilenceMs + ", tickIntervalMs=" + next.tickIntervalMs + ", warnStreakToEscalate=" + next.warnStreakToEscalate + ", actionOnEscalate=" + next.actionOnEscalate + ")",
            )
            this.onKnobsChanged?.(next)
          } catch (error) {
            this.warn("knob re-read failed: " + message(error))
          }
        }),
      )
    } else {
      this.warn("the adapter exposes no settings/document-updated seam — live tuning unavailable")
    }
    return disposers
  }

  /**
   * Run the tick body once.
   *
   * Never throws: any error is caught, counted and logged (AC-15). A tick that
   * starts while the previous one is still running is SKIPPED rather than queued,
   * so no unbounded chain can form.
   */
  async tickOnce(now: number = Date.now()): Promise<TickResult> {
    if (this.ticking) {
      this.stats.tickSkips += 1
      return { decisions: [], scenes: [], holds: [], skipped: "previous tick still running" }
    }
    this.ticking = true
    this.stats.ticks += 1
    // The WARN/ESCALATE decisions of this tick.
    const decisions: Decision[] = []
    // Scene paths written during this tick.
    const scenes: string[] = []
    // Team ids put under a preserving hold during this tick.
    const holds: string[] = []
    try {
      // Re-read the knobs on EVERY tick, not only on settings/document-updated. The
      // `mpd` namespace is registered DEFERRED (mpd-config parks its registration on
      // the settings service), so a row that applied first would otherwise keep its
      // row-config defaults until somebody edited settings. A per-tick read is one
      // tiny lookup and makes live tuning independent of the mount order.
      try {
        // T-18 (wave 2): the re-read is NOT conditional on a wired `onKnobsChanged`. The
        // optional call `this.onKnobsChanged?.(this.refreshKnobs())` never evaluates its
        // argument when the field is unset, so a directly constructed engine (a lane, a test)
        // silently kept its boot values while the row-mounted one re-read — measured while
        // building this lane's instruments. Read first, hand the value out second.
        const next = this.refreshKnobs()
        this.onKnobsChanged?.(next)
      } catch (error) {
        this.warn("knob re-read failed: " + message(error))
      }
      if (!this.knobs.enabled) return { decisions, scenes, holds, skipped: "disabled" }
      // §7.3: the file layer of the `mpd` namespace is NOT live in this process, so a divergence
      // between it and the running values is announced ONCE per process, naming both values.
      try {
        this.noteKnobDivergence()
      } catch (error) {
        this.warn("knob divergence check failed: " + message(error))
      }
      for (const workspace of this.knownRoots()) {
        // T-17: a hold that outlived its TTL, or that a member's own stamps have disproved,
        // releases itself BEFORE the teams are observed — the pause stays PRESERVING (only the
        // hold sidecar and the incident log are written; no team state moves, and none can — the
        // official board lives in the Lead Session log, which this plugin never writes).
        try {
          await this.autoReleaseHolds(workspace, now)
        } catch (error) {
          this.warn("auto-release pass failed for " + workspace + ": " + message(error))
        }
        for (const team of this.teams(workspace, now)) {
          // ONE gate for EVERY decision path: a record that cannot dispatch is not observed at
          // all — no never-started record, no WARN, no ESCALATE, no hold (r4). Skipping here
          // rather than inside a branch is what stops a dead record leaking into any of them.
          const liveness = this.liveness(team, now)
          if (!liveness.tickable) {
            this.stats.skippedTeams += 1
            this.skipNote(team, liveness.reason)
            continue
          }
          for (const decision of this.machine.observe(this.candidates(workspace, team), now, this.knobs)) {
            if (decision.type === "never-started") {
              await this.recordNeverStarted(workspace, team, decision, now)
              continue
            }
            // r6's secondary bound. Recorded, NOT acted on: a `tool-expired` observation must
            // never write a scene, apply a hold or enter the escalate path — the whole point of
            // the bound is that a very long tool call and a hang are indistinguishable, so the
            // conservative action is to REPORT (durably, unread until acknowledged) and leave
            // the team alone.
            if (decision.type === "tool-expired") {
              await this.recordToolExpired(workspace, team, decision, now)
              continue
            }
            decisions.push(decision)
            // What acting on the decision produced: a scene path and/or a hold.
            const outcome = await this.act(workspace, team, decision, now)
            if (outcome.scene !== null) scenes.push(outcome.scene)
            if (outcome.held) holds.push(team.id)
          }
        }
      }
      return { decisions, scenes, holds }
    } catch (error) {
      this.stats.tickErrors += 1
      this.stats.lastError = message(error)
      this.warn("tick threw " + this.stats.tickErrors + " time(s): " + message(error))
      return { decisions, scenes, holds, skipped: "tick error: " + message(error) }
    } finally {
      this.ticking = false
    }
  }

  /**
   * Whether a tick should consider this team at all (r4 — the dead-team flood).
   *
   * 0.1.7 CHANGED THE INPUT, not the rule. The readout (`dsh.teamLiveTeams()`) folds only LIVE
   * Lead agents, so a team cannot appear in it without a live session: the "days-old record" the
   * r4 bound was written for is no longer READABLE at all, and `activityAt` is always `null`
   * (the official view carries no timestamps). The rule is kept because it still answers the
   * question that matters, in two ways:
   *   1. LIVE AGENT, re-checked. The readout and this re-check are TWO separate reads of the same
   *      registry, and a `teamCacheMs` window can outlive a session inside them, so a cached view
   *      whose Lead and members have all exited is still skipped rather than reported on.
   *   2. FRESHNESS FALLBACK. When the registry cannot answer (no `agents` seam, no live agent),
   *      the team is ticked: `activityAt` is `null`, which the code below reads as "no usable
   *      liveness signal" and therefore as TICKABLE — the fail-safe direction for a watchdog.
   *      `deadTeamGraceMs = 0` likewise means "tick everything".
   *
   * FAILURE MODE (stated, not hidden): a team is skipped only while no agent of it is live — and
   * with no live session nothing can dispatch into it, so there is no dispatch problem to explain.
   * Every skip is visible on the debug channel with its reason.
   *
   * @param team - the projected record under consideration.
   * @param now - the tick's clock.
   * @returns whether to tick it, and why not.
   */
  private liveness(team: TeamRecord, now: number): { tickable: boolean; reason: string } {
    // The team spelled for the debug line, with its phase and task count.
    const desc = "team " + team.id + " (phase " + (team.phase ?? "?") + ", " + team.tasks.length + " task(s))"
    // Whether the registry demonstrably knows live agents.
    let agentsKnown = false
    // The live agent ids this process reports.
    const live = new Set<string>()
    try {
      // The adapter's capability flags, probed defensively.
      const capabilities = (this.dsh as { capabilities?: () => { agents?: boolean } }).capabilities?.()
      agentsKnown = capabilities?.agents === true
      if (agentsKnown) {
        for (const agent of this.dsh.liveAgents() ?? []) {
          // The live agent's id, when it carries a string one.
          const id = (agent as { id?: unknown } | undefined)?.id
          if (typeof id === "string" && id !== "") live.add(id)
        }
      }
    } catch {
      agentsKnown = false
    }
    if (agentsKnown && live.size > 0) {
      if (team.captainSessionId !== undefined && live.has(team.captainSessionId))
        return { tickable: true, reason: desc + " has a LIVE captain session" }
      // The first roster member that is live, if any.
      const member = team.members.find((entry) => entry.id !== "" && live.has(entry.id))
      if (member !== undefined) return { tickable: true, reason: desc + " has the LIVE member " + member.name }
      return {
        tickable: false,
        reason: desc + " has NO live agent: neither the captain session nor any of its " + team.members.length + " member id(s) is in this process's live registry (" + live.size + " live agent(s))",
      }
    }
    // A missing/non-finite bound is treated as 0 (tick everything): the r4 grace exists to avoid
    // watching dead RECORDS, and "I have no bound" must never become "I watch nothing" — a
    // watchdog that stops observing is the one failure this whole package exists to prevent.
    // `team.activityAt` is ALWAYS null under the official readout, so this branch is the normal
    // path: a team whose registry answers nothing is ticked, which is the fail-safe reading.
    const configured = this.config.deadTeamGraceMs
    // The dead-team bound in ms; a non-finite value reads as 0, i.e. tick everything.
    const grace = typeof configured === "number" && Number.isFinite(configured) ? configured : 0
    if (grace <= 0 || team.activityAt === null) {
      return { tickable: true, reason: desc + " ticked: the live readout is the only source and the agent registry answered nothing (registry " + (agentsKnown ? "empty" : "absent") + ", bound " + grace + "ms)" }
    }
    // How long ago the team's newest activity was, in ms.
    const age = now - team.activityAt
    if (age <= grace) return { tickable: true, reason: desc + " activity " + age + "ms ago is within the " + grace + "ms grace window" }
    return {
      tickable: false,
      reason: desc + " has no live agent and its newest activity is " + age + "ms old (> " + grace + "ms grace): a dead record, not a dispatch problem",
    }
  }

  /**
   * T-17 (§6) — the two auto-release paths, and the ONLY thing that may clear a hold by itself.
   *
   * A hold is released when EITHER
   *   * `ttlMs > 0 && now - hold.since >= ttlMs` (cause `ttl`), or
   *   * any heartbeat stamp for THAT team is newer than `hold.since` (cause `activity`): a
   *     member that demonstrably worked has disproved the wedge the hold was raised for.
   *
   * Both paths write ONE durable `hold-auto-released` incident, log ONE line, and leave every
   * team byte untouched — the internal hold stays PRESERVING (the same promise the plugin's own
   * `session-watchdog-resume` command keeps). The hold sidecar is cleared through that same
   * `applyResume`, so the synchronous reader the w7 gates consult is updated in the same step the
   * file is.
   *
   * A hold that cannot be cleared is COUNTED and reported, never silently retried forever.
   */
  private async autoReleaseHolds(workspace: string, now: number): Promise<void> {
    // Team ids with a hold: the registry first, the disk index second.
    let held: string[] = []
    try {
      held = this.registry?.heldTeams(workspace) ?? []
    } catch {
      held = []
    }
    // The hold FILE is the durable truth and the only thing the release may trust: a process
    // whose registry was never hydrated (a fresh boot, a direct engine construction, a lane)
    // must still release an expired hold, or a stale pause would outlive every reader.
    if (held.length === 0) held = heldTeamIds(workspace, this.config.stateDir)
    if (held.length === 0) return
    // Every stamp in the store, read once and only when the activity path needs it.
    let stampsByTeam: HeartbeatStamp[] | null = null
    for (const teamId of held) {
      // The durable hold being considered for release.
      const hold = readHold(workspace, this.config.stateDir, teamId)
      if (hold === undefined) continue
      // How long the hold has existed, in ms.
      const age = now - hold.since
      // Which auto-release path fired, or null to keep the hold.
      let release: "ttl" | "activity" | null = null
      if (hold.ttlMs > 0 && age >= hold.ttlMs) release = "ttl"
      else {
        if (stampsByTeam === null) stampsByTeam = this.teamStamps(workspace)
        if (stampsByTeam.some((stamp) => stamp.teamId === teamId && Number.isFinite(stamp.at) && stamp.at > hold.since)) release = "activity"
      }
      if (release === null) continue
      // The resume outcome; a failure leaves the hold in force and is reported.
      const resumed = applyResume(workspace, this.config.stateDir, { team_id: teamId }, this.registry)
      if (!resumed.resumed) {
        this.stats.holdsAutoReleaseFailures += 1
        this.warn("hold auto-release FAILED for " + teamId + " (" + String(resumed.reason) + "): the internal hold is still persisted, so new dispatch into the team stays stopped")
        continue
      }
      this.stats.holdsAutoReleased += 1
      // The durable `hold-auto-released` record for this release.
      const incident: IncidentRecord = {
        id: teamId + "#hold-auto-released#" + release + "#" + now,
        teamId,
        kind: "hold-auto-released",
        at: now,
        cause: { kind: "hold-auto-released", ms: age, release },
        taskId: hold.taskId,
        attemptId: hold.attemptId,
        scene: null,
        hold: "not-requested",
        acknowledgedBy: [],
      }
      // The append outcome of that record.
      const logged = appendIncident(workspace, this.config.stateDir, incident)
      if (logged.ok) this.stats.incidents += 1
      else {
        this.stats.incidentFailures += 1
        this.warn("hold-auto-released incident append failed at " + logged.path + ": " + String(logged.error))
      }
      this.info(
        "HOLD AUTO-RELEASED team=" + teamId +
          " cause=" + release +
          " age=" + age + "ms" +
          " ttl=" + (hold.ttlMs === 0 ? "none" : hold.ttlMs + "ms") +
          " since=" + hold.since +
          " — the internal hold lifted itself; every team byte is untouched (PRESERVING)" +
          (logged.ok ? " record=" + logged.path : " record=FAILED"),
      )
    }
  }

  /** Every heartbeat stamp this workspace's store holds, in one pass (T-17's activity path). */
  private teamStamps(workspace: string): HeartbeatStamp[] {
    // Every stamp of the store, concatenated across member files.
    const out: HeartbeatStamp[] = []
    for (const key of listHeartbeatKeys(workspace, this.config.stateDir)) {
      for (const stamp of readHeartbeats(workspace, this.config.stateDir, key)) out.push(stamp)
    }
    return out
  }

  /**
   * §7.2/§7.3 — the per-knob live-vs-file reading, refreshed on every tick.
   *
   * The FILE value is the workspace's own `.mpd/mpd.jsonc` (never `DSH_HOME`). T-18 (wave 2) made
   * that file a LIVE layer when it is the layer that moved (see `refreshKnobs`), so what remains
   * here is the honest residue: a knob whose file value the running process is NOT using, with the
   * `restartRequired` flag. It is still reachable — a file edit that lands in the same observation
   * window as a settings write, or a file whose values arrived before this process observed them —
   * and when it fires, the bound it states is real.
   */
  private noteKnobDivergence(): void {
    // The workspace whose config file supplies the file layer.
    const workspace = this.workspaceOf(undefined)
    // The config read: whether it exists, where, and its raw watchdog section.
    const { found, path, section } = readWatchdogSection(workspace)
    // One live-versus-file reading per knob.
    const readings = knobReadings(this.knobs, section)
    // Names of the knobs whose file value the running process is not using.
    const divergent = readings.filter((reading) => reading.differs).map((reading) => reading.knob)
    // Whether the running values came from this exact file.
    const fileApplied = this.liveLayer === "file" && this.liveFile === path
    this.knobView = { readings, divergent, restartRequired: divergent.length > 0, file: path, fileFound: found, fileApplied, liveLayer: this.liveLayer }
    if (divergent.length === 0 || this.divergenceAnnounced) return
    this.divergenceAnnounced = true
    // The divergent knobs rendered for the one warning line.
    const detail = readings
      .filter((reading) => reading.differs)
      .map((reading) => reading.knob + ": live=" + String(reading.live) + " file=" + String(reading.file))
      .join(", ")
    this.warn(
      "KNOBS DIVERGE (§7.3): " + path + " states " + divergent.length + " value(s) the running process is NOT using (" + detail +
        ") — " + (fileApplied
          ? "the file layer was applied live for its other values; these could not be applied and wait for the next dsh boot"
          : "a .mpd/mpd.jsonc edit applies live once this process has observed the file, and at the NEXT dsh boot otherwise"),
    )
  }

  /** §7.2: the last per-knob live-vs-file reading (the status view prints it). */
  knobDivergence(): {
    readings: KnobReading[]
    divergent: string[]
    restartRequired: boolean
    file: string | null
    fileFound: boolean
    fileApplied: boolean
    liveLayer: "namespace" | "file"
  } {
    return { ...this.knobView, readings: this.knobView.readings.map((reading) => ({ ...reading })) }
  }

  /** A skipped team is SILENT to the user: debug channel only, console only when asked for. */
  private skipNote(team: TeamRecord, reason: string): void {
    try {
      // The host logger's debug channel, when it exposes one.
      const logger = this.ctx.logger as { debug?: (text: string) => void } | undefined
      if (typeof logger?.debug === "function") logger.debug("[mpd-team-watchdog] skipping " + reason)
    } catch {
      // a logger that throws must not break a tick
    }
    if (this.config.verboseSkips) {
      try {
        console.log("[" + this.config.logPrefix + "] skipped " + reason)
      } catch {
        // stdout closed
      }
    }
  }

  /**
   * The silence candidates of one team (design §0/GAP-1's candidate set), each carrying the
   * §1 CHANNEL VERDICT for its owner's session.
   *
   * This is the seam where the predicate becomes per-member. The candidate set itself (who
   * is worth looking at) is unchanged — the r7 dispatch precondition still decides it — but
   * what the machine CONCLUDES now comes from the fold, not from the age of a stamp. A
   * candidate whose owner session the fold cannot answer for is flagged
   * `heartbeatFallback`, which is §4's report-only degradation.
   */
  private candidates(workspace: string, team: TeamRecord): SilenceCandidate[] {
    // Per-member stamp cache, so one candidate set reads each file once.
    const cache = new Map<string, HeartbeatStamp[]>()
    // Read one member's stamps, memoized for this candidate set.
    const stampsOf = (memberKey: string): readonly HeartbeatStamp[] => {
      // The memoized stamps for this member key, when it was already read.
      const cached = cache.get(memberKey)
      if (cached !== undefined) return cached
      // The member's stamps, read once and cached below.
      const stamps = readHeartbeats(workspace, this.config.stateDir, memberKey)
      cache.set(memberKey, stamps)
      return stamps
    }
    // T-16 (§6): the projection carries the record's own generation floor, so a stamp from a
    // PREVIOUS generation of this team can never make a task silent (and therefore never hold).
    const base = candidateFor({ id: team.id, tasks: team.tasks, createdAt: team.createdAt, approvedAt: team.approvedAt }, stampsOf, (assignee) => assignee)
    // The live agent ids, which decide §1's detached-session PARKED row.
    const live = this.liveIds()
    // T-20 (§8): a member whose ONLY open tasks wait on unfinished dependencies has nothing
    // claimable — it is PARKED, not silent, and the silence rule is suppressed for it. Derived
    // from the record alone; no new member-facing wait tool exists.
    const blockedOf = new Map<string, { blocked: boolean; waiting: string[] }>()
    // Member name to Session id, which is how the fold is addressed per member.
    const memberSessions = new Map<string, string>()
    for (const member of team.members) if (member.id !== "" && member.name !== "") memberSessions.set(member.name, member.id)
    // §1's PARKED row ("member session not attached") may only be applied by a registry that
    // demonstrably knows THIS team's sessions — one of its own member ids is in it. An
    // absent/empty registry answers nothing, and "no answer" must never read as "not
    // attached": that would be exactly the silent watchdog this wave removes.
    const registryKnowsTeam = live.known && team.members.some((member) => member.id !== "" && live.ids.has(member.id))

    return base.map((candidate) => {
      // T-20 runs BEFORE every channel question: a blocked member is PARKED whether or not the
      // fold has data for it, and never falls into the §4 report-only path that could warn.
      let blocked = blockedOf.get(candidate.assignee)
      if (blocked === undefined) {
        blocked = dependencyBlocked(team, candidate.assignee)
        blockedOf.set(candidate.assignee, blocked)
      }
      if (blocked.blocked) {
        this.stats.channelDependencyBlocked += 1
        return {
          ...candidate,
          channelState: "PARKED",
          outstandingSince: null,
          channelInFlightSince: null,
          channelInFlightTool: null,
          heartbeatFallback: false,
        }
      }
      // The owner's session id, or null when the record cannot name one.
      const sessionId = candidate.assignee === CAPTAIN_KEY ? team.captainSessionId ?? null : memberSessions.get(candidate.assignee) ?? null
      if (sessionId === null) {
        this.noteFallback("team " + team.id + " carries no session id for task owner " + candidate.assignee)
        return { ...candidate, channelState: null, heartbeatFallback: true }
      }
      // The fold's conclusion for that session, or null with no fold data.
      const view = this.fold.view(sessionId)
      if (view === null) {
        this.noteFallback("no session/event fold data for member " + candidate.assignee + " (session " + sessionId + ")")
        return { ...candidate, channelState: null, heartbeatFallback: true }
      }
      // The fold's state, narrowed to PARKED when the session is not attached.
      const channelState: ChannelState =
        registryKnowsTeam && view.state !== "PARKED" && !live.ids.has(sessionId) ? "PARKED" : view.state
      if (channelState !== view.state) this.stats.channelDetached += 1
      return {
        ...candidate,
        channelState,
        outstandingSince: view.outstandingSince,
        channelInFlightSince: view.inFlightSince,
        channelInFlightTool: view.inFlightTool,
        heartbeatFallback: false,
      }
    })
  }

  /** Act on one WARN/ESCALATE decision. */
  private async act(
    workspace: string,
    team: TeamRecord,
    decision: Exclude<Decision, { type: "never-started" } | { type: "tool-expired" }>,
    now: number,
  ): Promise<{ scene: string | null; held: boolean }> {
    // The team's hold as it stands on disk, before this decision acts.
    const alreadyHeld = readHold(workspace, this.config.stateDir, team.id)

    // The hold is persisted BEFORE the scene so the escalation scene can carry the
    // hold it creates (AC-5 asks for the watchdog's own hold inside the scene). The
    // scene write still happens even when the hold could not be persisted, and the
    // incident then says `not-applied` rather than claiming a pause (design §7).
    let holdState: IncidentRecord["hold"] = alreadyHeld === undefined ? "not-requested" : "applied"
    // Whether the team is under a preserving hold after this decision.
    let held = alreadyHeld !== undefined
    // The hold the scene should carry, if any.
    let holdForScene = alreadyHeld ?? null
    if (decision.type === "escalate" && alreadyHeld === undefined && this.knobs.actionOnEscalate === "pause") {
      // The hold action's outcome, through the tool seam or the direct write.
      const applied = await this.performHold(workspace, team.id, decision, now)
      holdState = applied.applied ? "applied" : "not-applied"
      held = applied.applied
      holdForScene = applied.applied ? (readHold(workspace, this.config.stateDir, team.id) ?? null) : null
      if (applied.applied) this.stats.holdsApplied += 1
      else {
        this.stats.holdsFailed += 1
        this.warn("hold NOT applied for " + team.id + " (" + applied.via + "): " + String(applied.error))
      }
    }

    // The team's incident history, embedded in the scene.
    const incidents: SceneIncident[] = readIncidents(workspace, this.config.stateDir)
      .filter((record) => record.teamId === team.id)
      .map((record) => ({ id: record.id, kind: record.kind, at: record.at, taskId: record.taskId, attemptId: record.attemptId, scene: record.scene }))
    // The scene document built for this decision.
    const scene = buildScene({
      team,
      reason: decision.type,
      at: now,
      silenceMs: decision.silenceMs,
      hold: holdForScene,
      mailbox: readWatermarks(workspace, this.config.stateDir),
      incidents,
      streaks: this.machine.snapshot().streaks,
      heartbeat: (memberKey) => readHeartbeats(workspace, this.config.stateDir, memberKey),
      // The official peer mailbox is not observable through the adapter (see `scene.ts`), so the
      // scene records `unread: null` — "unknown" — instead of a fabricated count.
      unread: () => mailboxUnreadObservable(),
    })

    // §7 idempotence: a team already held gets NO second scene and NO second hold.
    let scenePath: string | null = null
    if (alreadyHeld === undefined) {
      // The scene write outcome; a failure is reported but does not stop the hold.
      const written = writeScene(workspace, this.config.stateDir, team.id, scene, now)
      if (written.ok) {
        this.stats.scenes += 1
        scenePath = written.path
      } else {
        this.stats.sceneFailures += 1
        this.stats.lastError = written.error ?? "scene write failed"
        this.warn(
          "scene write failed at " + sceneDir(workspace, this.config.stateDir, team.id) + ": " + String(written.error) + " — the hold was still attempted and the incident is still recorded",
        )
      }
    }

    // The durable incident record for this decision.
    const incident: IncidentRecord = {
      id: decision.taskId + "@" + decision.attemptId + "#" + now,
      teamId: team.id,
      kind: decision.type,
      at: now,
      cause: { kind: decision.cause, ms: decision.silenceMs },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: scenePath,
      hold: holdState,
      acknowledgedBy: [],
    }
    // The append outcome of that incident record.
    const logged = appendIncident(workspace, this.config.stateDir, incident)
    if (logged.ok) this.stats.incidents += 1
    else {
      this.stats.incidentFailures += 1
      this.warn("incident append failed at " + logged.path + ": " + String(logged.error))
    }

    // The notice-of-record is the durable incident record; the user-facing surfaces
    // read it (AC-14's three readers). It is attempted even when the scene failed.
    this.info(
      decision.type.toUpperCase() +
        " " + team.id +
        " task=" + decision.taskId +
        " member=" + decision.assignee +
        " cause=" + decision.cause +
        " state=" + (decision.state ?? "heartbeat") +
        " silence=" + decision.silenceMs + "ms" +
        " streak=" + decision.streak +
        " hold=" + holdState +
        (scenePath === null ? " scene=none" : " scene=" + scenePath),
    )
    return { scene: scenePath, held }
  }

  /**
   * Record a `never-started` observation durably and notice it (T69-ESCALATE-2).
   *
   * WHY THIS IS NOT SILENT ANY MORE: a claimed task whose owner never stamped is a
   * DISPATCH problem — the one thing a user staring at a stuck team needs explained — so
   * it takes the same durable path as a WARN: an incident record (kind `never-started`,
   * `scene: null` because there is nothing to snapshot yet) plus the notice line. It
   * still never holds the team and never escalates: withholding the PAUSE is a separate
   * decision from withholding the RECORD, and the reviewer's finding was about the
   * second one.
   *
   * The record is replayable exactly like the others: `readIncidents()` returns it and the
   * read-watermark replay surfaces it to every reader that has not acknowledged it.
   */
  private async recordNeverStarted(
    workspace: string,
    team: TeamRecord,
    decision: Extract<Decision, { type: "never-started" }>,
    now: number,
  ): Promise<void> {
    this.stats.neverStarted += 1
    // The durable `never-started` record for this observation.
    const incident: IncidentRecord = {
      id: decision.taskId + "@" + decision.attemptId + "#never-started#" + now,
      teamId: team.id,
      kind: "never-started",
      at: now,
      cause: { kind: "never-started", ms: 0 },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: null,
      hold: "not-requested",
      acknowledgedBy: [],
    }
    // The append outcome of that record.
    const logged = appendIncident(workspace, this.config.stateDir, incident)
    if (logged.ok) this.stats.incidents += 1
    else {
      this.stats.incidentFailures += 1
      this.warn("never-started record append failed at " + logged.path + ": " + String(logged.error))
    }
    this.info(
      "NEVER-STARTED " + team.id +
        " task=" + decision.taskId +
        " member=" + decision.assignee +
        " attempt=" + (decision.attemptId === "" ? "(none)" : decision.attemptId) +
        " — the owner never stamped this task: a dispatch problem, not a wedge; recorded for replay, NO hold, NO escalation" +
        (logged.ok ? " record=" + logged.path : " record=FAILED"),
    )
  }

  /**
   * Record the r6 secondary bound: an OPEN tool call older than `toolInFlightMaxMs`.
   *
   * WHY IT IS A RECORD AND NOT A PAUSE. At this point the watchdog knows only that a tool
   * call has been running for `toolInFlightMaxMs` — a legitimately slow build/boot/lane and a
   * hang inside the tool are indistinguishable from the stamp stream, and the pre-r6 design
   * proved the cost of guessing wrong: it PAUSED our own team for running a lane. So the
   * observation takes the durable WARN-class path (incident with the tool name, the age and
   * the start time, scene null because nothing was snapshotted, hold `not-requested` because
   * nothing was paused), it is reported ONCE per task+attempt, and it never escalates.
   *
   * The honest limit this leaves: a member wedged INSIDE a tool is not escalated, only
   * reported. That is stated in the ledger and in the README, not hidden here.
   */
  private async recordToolExpired(
    workspace: string,
    team: TeamRecord,
    decision: Extract<Decision, { type: "tool-expired" }>,
    now: number,
  ): Promise<void> {
    this.stats.toolExpired += 1
    // The durable `tool-expired` record for this observation.
    const incident: IncidentRecord = {
      id: decision.taskId + "@" + decision.attemptId + "#tool-expired#" + now,
      teamId: team.id,
      kind: "tool-expired",
      at: now,
      cause: {
        kind: "tool-expired",
        ms: decision.inFlightMs,
        ...(decision.tool === null ? {} : { tool: decision.tool }),
      },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: null,
      hold: "not-requested",
      acknowledgedBy: [],
    }
    // The append outcome of that record.
    const logged = appendIncident(workspace, this.config.stateDir, incident)
    if (logged.ok) this.stats.incidents += 1
    else {
      this.stats.incidentFailures += 1
      this.warn("tool-expired record append failed at " + logged.path + ": " + String(logged.error))
    }
    this.info(
      "TOOL-EXPIRED " + team.id +
        " task=" + decision.taskId +
        " member=" + decision.assignee +
        " tool=" + (decision.tool ?? "(unnamed)") +
        " inFlight=" + decision.inFlightMs + "ms (since " + decision.since + ", bound=" + this.knobs.toolInFlightMaxMs + "ms)" +
        " — the call outlived the in-flight bound; reported ONCE, NO hold, NO escalation, the team is left alone" +
        (logged.ok ? " record=" + logged.path : " record=FAILED"),
    )
  }

  /** Persist the hold through the plugin's own action, preferring the tool seam. */
  private async performHold(
    workspace: string,
    teamId: string,
    decision: Exclude<Decision, { type: "never-started" } | { type: "tool-expired" }>,
    now: number,
  ): Promise<{ applied: boolean; via: string; error?: string }> {
    // The hold arguments, carrying the resolved TTL snapshot.
    const args = {
      team_id: teamId,
      task_id: decision.taskId,
      attempt_id: decision.attemptId,
      cause: "silence",
      scene_at: now,
      // T-17: the escalation-driven hold carries the resolved snapshot of `holdTtlMs`, so the
      // bound travels with the hold through the tool seam AND the direct-write fallback.
      ttl_ms: this.knobs.holdTtlMs,
    }
    try {
      // The internal tool runtime, which prefers the tool seam over a direct write.
      const runtime = this.dsh.toolRuntime()
      if (runtime !== undefined && typeof runtime.execute === "function") {
        // The hold action's result value, when the seam answered with one.
        const value = toolValue(await runtime.execute({ name: HOLD_TOOL, arguments: args }))
        if (value !== undefined && value.applied === true) return { applied: true, via: "tool-seam" }
        if (value !== undefined && value.applied === false) {
          return { applied: false, via: "tool-seam", error: String(value.error ?? "hold action refused") }
        }
      }
    } catch (error) {
      this.warn("the hold action was unreachable through the tool seam (" + message(error) + ") — falling back to a direct write")
    }
    // The direct-write fallback, used when the tool seam is unreachable.
    const direct = applyHold(workspace, this.config.stateDir, args, this.registry)
    if (direct.applied) return { applied: true, via: "direct" }
    return { applied: false, via: "direct", error: direct.error }
  }

  /** Report a warning through the host logger and the console. */
  private warn(text: string): void {
    this.emit("warn", text)
  }

  /** Report an informational line through both channels. */
  private info(text: string): void {
    this.emit("info", text)
  }

  /** Write one prefixed line to the host logger and the console, swallowing a closed stream. */
  private emit(level: "warn" | "info", text: string): void {
    // The prefixed line both destinations receive.
    const line = "[" + this.config.logPrefix + "] " + text
    try {
      if (level === "warn" && typeof this.ctx.logger?.warn === "function") this.ctx.logger.warn(line)
      else if (level === "info" && typeof this.ctx.logger?.info === "function") this.ctx.logger.info(line)
    } catch {
      // a logger that throws must not break a heartbeat
    }
    try {
      if (level === "warn") console.warn(line)
      else console.log(line)
    } catch {
      // stdout closed: nothing left to do
    }
  }
}

/** The captain's mailbox key, re-exported so lanes do not import the team module. */
export { CAPTAIN_KEY }
