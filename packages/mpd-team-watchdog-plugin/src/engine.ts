// The watchdog engine: the writers (heartbeat + turn boundaries), the tick, and
// the WARN/ESCALATE fan-out (scene, hold, incident).
//
// Everything the engine touches goes through the adapter or the plugin's own
// store; nothing here reaches a harness service directly (AGENTS.md §6). The
// engine is a plain class so a test or a lane can drive `tickOnce(now)` with an
// injected clock and a stub adapter, without a boot.
import { type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { HOLD_TOOL, applyHold } from "./actions.js"
import type { HoldRegistry } from "./holds.js"
import { candidateFor, readKnobs, WatchdogMachine, type Decision, type ResolvedKnobs, type SilenceCandidate, type WatchdogKnobs } from "./machine.js"
import { sceneDir } from "./paths.js"
import { buildScene, mailboxUnread, writeScene, type SceneIncident } from "./scene.js"
import { appendIncident, readHold, readIncidents, readWatermarks, type IncidentRecord } from "./sidecars.js"
import { appendHeartbeat, message, readHeartbeats, rotateHeartbeats, type HeartbeatKind, type HeartbeatStamp } from "./store.js"
import { agentIds, CAPTAIN_KEY, currentTask, readTeams, resolveIdentity, teamOf, type TeamRecord } from "./team.js"

/** Fully-resolved engine configuration (no optional key left). */
export interface EngineConfig {
  stateDir: string
  enabled: boolean
  warnSilenceMs: number
  tickIntervalMs: number
  warnStreakToEscalate: number
  actionOnEscalate: "pause" | "warn-only"
  /** How long a parsed team record stays cached between reads (0 disables). */
  teamCacheMs: number
  /** How many heartbeat generations to keep per member file. */
  keepGenerations: number
  /**
   * DEAD-TEAM FALLBACK (r4): how long a record may go untouched before a tick skips it when the
   * live-agent registry cannot answer. 0 disables the bound (tick everything, the status quo).
   */
  deadTeamGraceMs: number
  /** Print skipped-team reasons to the console as well as the debug channel. */
  verboseSkips: boolean
  logPrefix: string
}

/** Engine counters; every one is evidence for AC-15's fail-safe claims. */
export interface EngineStats {
  ticks: number
  tickErrors: number
  tickSkips: number
  heartbeatWrites: number
  heartbeatFailures: number
  rotations: number
  scenes: number
  sceneFailures: number
  holdsApplied: number
  holdsFailed: number
  incidents: number
  incidentFailures: number
  neverStarted: number
  /** Teams a tick skipped because they cannot dispatch (r4). */
  skippedTeams: number
  lastError: string | null
}

/** The result of one tick. */
export interface TickResult {
  decisions: Decision[]
  scenes: string[]
  holds: string[]
  skipped?: string
}

/** The engine's context dependency: events, cleanup and an optional logger. */
export interface EngineContext {
  on?: (event: string, handler: (...args: any[]) => unknown) => unknown
  effect?: (callback: () => unknown) => unknown
  logger?: { warn?: (text: string) => void; info?: (text: string) => void }
  [key: string]: unknown
}

/** A settings namespace read through the adapter, never a direct service call. */
function readNamespaceKnobs(
  dsh: DshAdapter,
  env: Record<string, string | undefined>,
  defaults: WatchdogKnobs,
): ResolvedKnobs {
  try {
    const reader = dsh.settingsReader("mpd")
    return readKnobs(reader?.get(), env, defaults)
  } catch (error) {
    const base = readKnobs(undefined, env, defaults)
    return { ...base, issues: [...base.issues, { path: "watchdog", problem: "settings read failed: " + message(error), fallback: "defaults" }] }
  }
}

/** Unwrap the value a harness tool call returns. */
function toolValue(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object") return undefined
  const candidate = (raw as { value?: unknown }).value
  if (candidate !== null && typeof candidate === "object") return candidate as Record<string, unknown>
  return raw as Record<string, unknown>
}

/** One diagnostic line on stderr; never throws. */
function report(text: string): void {
  try {
    console.warn("[mpd-team-watchdog] " + text)
  } catch {
    // nothing left to report with
  }
}

/** Subscribe one event handler, returning a disposer that never throws. */
export function subscribe(
  ctx: EngineContext,
  event: string,
  handler: (...args: any[]) => unknown,
): () => void {
  try {
    const wrapped = (...args: any[]): unknown => {
      try {
        return handler(...args)
      } catch (error) {
        report("[" + event + "] handler threw: " + message(error))
        return undefined
      }
    }
    const disposer = ctx.on?.(event, wrapped)
    if (typeof disposer === "function") return disposer as () => void
    if (disposer !== undefined && typeof (disposer as { dispose?: unknown }).dispose === "function") {
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
  private readonly dsh: DshAdapter
  private readonly ctx: EngineContext
  private readonly config: EngineConfig
  private readonly machine = new WatchdogMachine()
  private readonly registry: HoldRegistry | undefined
  private readonly roots = new Set<string>()
  private readonly teamCache = new Map<string, { at: number; teams: TeamRecord[] }>()
  private knobs: ResolvedKnobs
  private ticking = false
  private stopped = false
  private turnSeq = 0
  /** Set by `apply` so a live cadence change can rebuild the single timer. */
  onKnobsChanged: ((knobs: ResolvedKnobs) => void) | undefined
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

  /** The current streak/escalate state (diagnostics). */
  getMachineState(): { streaks: Record<string, number>; escalated: string[] } {
    return this.machine.snapshot()
  }

  /** Every workspace root the engine will tick over. */
  knownRoots(): string[] {
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

  /** Re-read the knob set (called at apply and on `settings/document-updated`). */
  refreshKnobs(env: Record<string, string | undefined> = process.env): ResolvedKnobs {
    this.knobs = readNamespaceKnobs(this.dsh, env, this.knobDefaults())
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
    }
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

  private remember(workspace: string): void {
    if (typeof workspace === "string" && workspace !== "") this.roots.add(workspace)
  }

  private teams(workspace: string, now = Date.now()): TeamRecord[] {
    const key = workspace + "\u0000" + this.config.stateDir
    const cached = this.teamCache.get(key)
    if (this.config.teamCacheMs > 0 && cached !== undefined && now - cached.at < this.config.teamCacheMs) return cached.teams
    const teams = readTeams(workspace, this.config.stateDir)
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
    const ids = agentIds(agent)
    const workspace = this.workspaceOf(ids.cwd !== undefined ? agent : undefined)
    this.remember(workspace)
    const team = teamOf(this.teams(workspace), agent)
    const identity = resolveIdentity(team, agent)
    if (kind === "turn-start") this.turnSeq += 1
    const memberKey =
      identity.member ?? "session-" + (ids.sessionId.slice(0, 8) || ids.agentId.slice(0, 8) || "unknown")
    const task = team !== undefined && identity.member !== null ? currentTask(team, identity.member) : undefined
    const at = Date.now()
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
    const written = appendHeartbeat(workspace, this.config.stateDir, memberKey, stamp)
    if (written.ok) this.stats.heartbeatWrites += 1
    else {
      this.stats.heartbeatFailures += 1
      this.stats.lastError = written.error ?? "heartbeat write failed"
      this.warn("heartbeat write failed at " + written.path + ": " + String(written.error))
    }
    return stamp
  }

  /** Subscribe every heartbeat writer, the POST hook and the settings re-read. */
  install(): (() => void)[] {
    const disposers: (() => void)[] = []
    const agentOf = (payload: unknown): unknown => (payload as { agent?: unknown } | undefined)?.agent
    if (typeof this.ctx.on === "function") {
      // `agent/pre-step` IS A CORDIS WATERFALL, and a waterfall listener's return value
      // REPLACES the value being composed: cordis dispatches it as
      // `(cbs.shift() ?? inner)(...args)` with `next` appended, so a listener that returns
      // without calling `next()` VETOES the rest of the chain and its own return value
      // becomes the step decision (`@deepseek-ai/cordis` `EventsService.waterfall`).
      //
      // The bug this closes (measured 2026-09-16 on a real mpd session): the handler used
      // to be `(payload) => this.stamp("step", …)`, i.e. it returned a HeartbeatStamp.
      // That stamp — an object with no `messages` — BECAME the pre-step decision, so the
      // harness's own turn loop (and the adopted agent-teams pre-step listeners) read
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
        subscribe(this.ctx, "agent/pre-step", (payload: unknown, next: unknown) => {
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
        subscribe(this.ctx, "agent/session-start", (payload: unknown) => {
          this.stamp("turn-start", agentOf(payload) ?? payload)
        }),
      )
      disposers.push(
        subscribe(this.ctx, "agent/turn-stopping", (payload: unknown) => {
          const stamp = this.stamp("turn-end", agentOf(payload) ?? payload)
          const rotated = rotateHeartbeats(stamp.workspace, this.config.stateDir, stamp.memberKey, this.config.keepGenerations)
          if (rotated.rotated) this.stats.rotations += 1
        }),
      )
    } else {
      this.warn("this context exposes no event seam — heartbeat writers not installed")
    }

    // The POST hook stamps on COMPLETION only (W-9: there is no pre-dispatch stamp).
    const post = this.dsh.onPostToolExecute((exec) => {
      const name = typeof exec?.name === "string" ? exec.name : undefined
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

    if (typeof this.dsh.onSettingsDocumentUpdated === "function") {
      disposers.push(
        this.dsh.onSettingsDocumentUpdated("mpd", () => {
          try {
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
    const decisions: Decision[] = []
    const scenes: string[] = []
    const holds: string[] = []
    try {
      // Re-read the knobs on EVERY tick, not only on settings/document-updated. The
      // `mpd` namespace is registered DEFERRED (mpd-config parks its registration on
      // the settings service), so a row that applied first would otherwise keep its
      // row-config defaults until somebody edited settings. A per-tick read is one
      // tiny lookup and makes live tuning independent of the mount order.
      try {
        this.onKnobsChanged?.(this.refreshKnobs())
      } catch (error) {
        this.warn("knob re-read failed: " + message(error))
      }
      if (!this.knobs.enabled) return { decisions, scenes, holds, skipped: "disabled" }
      for (const workspace of this.knownRoots()) {
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
            decisions.push(decision)
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
   * THE SIGNAL, strongest first:
   *   1. LIVE AGENT. When the process's agent registry can answer (`capabilities().agents` and at
   *      least one live agent), a team is tickable only if its captain session or one of its
   *      member ids resolves to a LIVE agent. That is the strongest available signal, because it
   *      answers the actual question — can anything dispatch into this team? — from the same
   *      registry the stamp path already uses. A team whose sessions ended days ago has no live
   *      agent, so ticking it can only manufacture reports about a corpse.
   *   2. FRESHNESS FALLBACK. When the registry cannot answer (no `agents` seam, or no live agent at
   *      all in this process), the team is ticked while its newest record activity is within
   *      `deadTeamGraceMs`. Without this the harness/unit compositions (no live agents) would tick
   *      nothing, and a host with no live sessions would still flood. `deadTeamGraceMs = 0`
   *      disables the bound entirely (tick everything — the pre-r4 behaviour).
   *
   * FAILURE MODE (stated, not hidden): a team that is genuinely wedged for longer than the grace
   * window AND has no live agent is not reported. That is acceptable by construction — with no
   * live session nothing can dispatch into it, so there is no dispatch problem to explain — and the
   * skip is visible on the debug channel with its reason.
   *
   * @param team - the record under consideration.
   * @param now - the tick's clock.
   * @returns whether to tick it, and why not.
   */
  private liveness(team: TeamRecord, now: number): { tickable: boolean; reason: string } {
    const desc = "team " + team.id + " (phase " + (team.phase ?? "?") + ", " + team.tasks.length + " task(s))"
    let agentsKnown = false
    const live = new Set<string>()
    try {
      const capabilities = (this.dsh as { capabilities?: () => { agents?: boolean } }).capabilities?.()
      agentsKnown = capabilities?.agents === true
      if (agentsKnown) {
        for (const agent of this.dsh.liveAgents() ?? []) {
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
      const member = team.members.find((entry) => entry.id !== "" && live.has(entry.id))
      if (member !== undefined) return { tickable: true, reason: desc + " has the LIVE member " + member.name }
      return {
        tickable: false,
        reason: desc + " has NO live agent: neither the captain session nor any of its " + team.members.length + " member id(s) is in this process's live registry (" + live.size + " live agent(s))",
      }
    }
    const grace = this.config.deadTeamGraceMs
    if (grace <= 0 || team.activityAt === null) {
      return { tickable: true, reason: desc + " ticked: no usable liveness signal (registry " + (agentsKnown ? "empty" : "absent") + ", bound " + grace + "ms) — the pre-r4 behaviour" }
    }
    const age = now - team.activityAt
    if (age <= grace) return { tickable: true, reason: desc + " activity " + age + "ms ago is within the " + grace + "ms grace window" }
    return {
      tickable: false,
      reason: desc + " has no live agent and its newest activity is " + age + "ms old (> " + grace + "ms grace): a dead record, not a dispatch problem",
    }
  }

  /** A skipped team is SILENT to the user: debug channel only, console only when asked for. */
  private skipNote(team: TeamRecord, reason: string): void {
    try {
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

  /** The silence candidates of one team (design §0/GAP-1's candidate set). */
  private candidates(workspace: string, team: TeamRecord): SilenceCandidate[] {
    const cache = new Map<string, HeartbeatStamp[]>()
    const stampsOf = (memberKey: string): readonly HeartbeatStamp[] => {
      const cached = cache.get(memberKey)
      if (cached !== undefined) return cached
      const stamps = readHeartbeats(workspace, this.config.stateDir, memberKey)
      cache.set(memberKey, stamps)
      return stamps
    }
    return candidateFor({ id: team.id, tasks: team.tasks }, stampsOf, (assignee) => assignee)
  }

  /** Act on one WARN/ESCALATE decision. */
  private async act(
    workspace: string,
    team: TeamRecord,
    decision: Exclude<Decision, { type: "never-started" }>,
    now: number,
  ): Promise<{ scene: string | null; held: boolean }> {
    const alreadyHeld = readHold(workspace, this.config.stateDir, team.id)

    // The hold is persisted BEFORE the scene so the escalation scene can carry the
    // hold it creates (AC-5 asks for the watchdog's own hold inside the scene). The
    // scene write still happens even when the hold could not be persisted, and the
    // incident then says `not-applied` rather than claiming a pause (design §7).
    let holdState: IncidentRecord["hold"] = alreadyHeld === undefined ? "not-requested" : "applied"
    let held = alreadyHeld !== undefined
    let holdForScene = alreadyHeld ?? null
    if (decision.type === "escalate" && alreadyHeld === undefined && this.knobs.actionOnEscalate === "pause") {
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

    const incidents: SceneIncident[] = readIncidents(workspace, this.config.stateDir)
      .filter((record) => record.teamId === team.id)
      .map((record) => ({ id: record.id, kind: record.kind, at: record.at, taskId: record.taskId, attemptId: record.attemptId, scene: record.scene }))
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
      unread: (memberKey) => mailboxUnread(workspace, this.config.stateDir, team.id, memberKey, now),
    })

    // §7 idempotence: a team already held gets NO second scene and NO second hold.
    let scenePath: string | null = null
    if (alreadyHeld === undefined) {
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

    const incident: IncidentRecord = {
      id: decision.taskId + "@" + decision.attemptId + "#" + now,
      teamId: team.id,
      kind: decision.type,
      at: now,
      cause: { kind: "silence", ms: decision.silenceMs },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: scenePath,
      hold: holdState,
      acknowledgedBy: [],
    }
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
    const incident = {
      id: decision.taskId + "@" + decision.attemptId + "#never-started#" + now,
      teamId: team.id,
      // The durable kind vocabulary lives in sidecars.ts (`IncidentRecord.kind`), which is
      // outside this task's scope; the value is added here and the reader treats it as an
      // opaque string, so the cast is the honest record of that boundary rather than a
      // silent widening of an out-of-scope union.
      kind: "never-started" as unknown as IncidentRecord["kind"],
      at: now,
      cause: { kind: "never-started" as unknown as "silence", ms: 0 },
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      scene: null,
      hold: "not-requested" as IncidentRecord["hold"],
      acknowledgedBy: [],
    }
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

  /** Persist the hold through the plugin's own action, preferring the tool seam. */
  private async performHold(
    workspace: string,
    teamId: string,
    decision: Exclude<Decision, { type: "never-started" }>,
    now: number,
  ): Promise<{ applied: boolean; via: string; error?: string }> {
    const args = {
      team_id: teamId,
      task_id: decision.taskId,
      attempt_id: decision.attemptId,
      cause: "silence",
      scene_at: now,
    }
    try {
      const runtime = this.dsh.toolRuntime()
      if (runtime !== undefined && typeof runtime.execute === "function") {
        const value = toolValue(await runtime.execute({ name: HOLD_TOOL, arguments: args }))
        if (value !== undefined && value.applied === true) return { applied: true, via: "tool-seam" }
        if (value !== undefined && value.applied === false) {
          return { applied: false, via: "tool-seam", error: String(value.error ?? "hold action refused") }
        }
      }
    } catch (error) {
      this.warn("the hold action was unreachable through the tool seam (" + message(error) + ") — falling back to a direct write")
    }
    const direct = applyHold(workspace, this.config.stateDir, args, this.registry)
    if (direct.applied) return { applied: true, via: "direct" }
    return { applied: false, via: "direct", error: direct.error }
  }

  private warn(text: string): void {
    this.emit("warn", text)
  }

  private info(text: string): void {
    this.emit("info", text)
  }

  private emit(level: "warn" | "info", text: string): void {
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
