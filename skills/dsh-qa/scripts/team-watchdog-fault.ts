#!/usr/bin/env bun
// Case team-watchdog-fault — the injected-silence chain (WARN → ESCALATE → scene → preserving
// pause) plus the §4 report-only surface, on TWO bases rather than one (t65, 2026-09-17):
//
//   (1) the VERIFIED fault fixture (`packages/mpd-team-watchdog-plugin/test/fixtures/inject.ts`):
//       it mounts the REAL watchdog dist, the REAL adopted scheduler/tools modules and the REAL
//       hold path on a stub harness and injects only SILENCE. Its cases are kept, but the lane no
//       longer pretends they all hold on the redesigned engine. The measured path (t65; t59's
//       wording is CORRECTED here): the fixture NEVER emits `session/event` (0 occurrences), so
//       for a team whose members DO carry ids the engine resolves the owner session and then finds
//       `fold.view(sessionId) === null` → `heartbeatFallback: true` → §4 REPORT-ONLY, which may
//       warn at most once per task+attempt generation and may NEVER escalate or hold. Five of its
//       cases therefore encode PRE-REDESIGN expectations (warn ×3 → escalate → hold), and this
//       lane DECLARES them stale with their readings instead of failing on them or hiding them.
//   (2) an IN-LANE ARM (`§1 escalation` + `§4 report-only`) that drives the REAL built dist
//       directly — `apply(ctx, config)` → `report.engine.tickOnce(now)` — on a REAL-SHAPED team
//       (member OBJECTS carrying ids, as real records have) with FOLDED events
//       (`turn/start` + `step/start`, no answer, no `step/end`) so the §1 ladder really runs:
//       consecutive OUTSTANDING observations past `warnSilenceMs` ⇒ `escalate` ⇒ hold sidecar +
//       scene file, with the scene-restore leg then READ from that hold by plain fs. The SAME arm
//       with no live member session pins §4: at most ONE warn per task+attempt generation
//       (`silence-heartbeat`), NEVER an escalate, NEVER a hold.
//
// The AC-17 CONTRAST is unchanged: the halt control runs the REAL `haltTeamWork` while the pause
// preserves (`sha256UnchangedAcrossHeldKicks`, `deliveriesWhileHeld: 0`). The fixture's
// `NOT_CLAIMED` entries are repeated VERBATIM; the lane's own limits are declared too.
//
// LABELS (t65/S2): the tuple the fixture injects (90 000 / 3 / `pause`) is the fixture's OWN
// PRE-REDESIGN ROW CONFIG, NOT the product's frozen defaults. The product's §3 defaults are
// 600 000 / 6 / `warn-only` — that is what the in-lane arm runs, and the lane says so wherever it
// prints the fixture's numbers.
//
// PREREQ: built dists (watchdog dist + the adopted lib). The fixture refuses loudly otherwise.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-fault.ts --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-fault.ts [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-fault/{result.json,output.log,raw/}
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PATHS, captureStdout, evidenceDir, finish, say, selfTest, sha256, writeEvidence } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"
import type { LaneCheck, LaneResult, LaneVerdict } from "./lib/watchdog-lane.ts"

/** The knob tuple a row config carries: the four values the ladder depends on. */
interface KnobTuple {
  /** Silence, in milliseconds, after which a silent member becomes OUTSTANDING. */
  readonly warnSilenceMs: number
  /** The engine's tick cadence, in milliseconds. */
  readonly tickIntervalMs: number
  /** How many consecutive silent observations escalate. */
  readonly warnStreakToEscalate: number
  /** The action at escalation: `pause` holds the team, `warn-only` does not. */
  readonly actionOnEscalate: string
}

/** The three knobs an arm reports it actually ran with. */
interface ArmKnobs {
  /** Silence threshold the arm ran with, in milliseconds. */
  readonly warnSilenceMs: number
  /** Consecutive silent observations needed to escalate in that arm. */
  readonly warnStreakToEscalate: number
  /** The escalation action the arm ran with. */
  readonly actionOnEscalate: string
}

/** One member of an arm's real-shaped team record (an OBJECT carrying an id). */
interface ArmTeamMember {
  /** The member's agent/session id, which the engine resolves the owner session by. */
  readonly id: string
  /** The member's display name, from which the heartbeat key is sanitized. */
  readonly name: string
  /** The member's roster role. */
  readonly role: string
  /** The member's run status. */
  readonly status: string
  /** When the member joined, in milliseconds since the epoch. */
  readonly joinedAt: number
  /** The task the member is currently on. */
  readonly currentTask: string
}

/** One task of an arm's real-shaped team record. */
interface ArmTeamTask {
  /** The task id. */
  readonly id: string
  /** The task's subject line. */
  readonly subject: string
  /** The task's description. */
  readonly description: string
  /** The task's status. */
  readonly status: string
  /** The member the task is assigned to. */
  readonly assignee: string
  /** The task ids this task waits for. */
  readonly dependencies: readonly string[]
  /** How many attempts the task has had. */
  readonly attempt: number
  /** The current attempt's id, which the heartbeat stamp names. */
  readonly attemptId: string
  /** When the task was created, in milliseconds since the epoch. */
  readonly createdAt: number
  /** When the task was last updated, in milliseconds since the epoch. */
  readonly updatedAt: number
}

/** A REAL-SHAPED team record: members are OBJECTS carrying ids, the way real records have them. */
interface ArmTeamRecord {
  /** The team id, which also names its state directory. */
  readonly id: string
  /** The team's display name. */
  readonly name: string
  /** The captain's session id. */
  readonly captainSessionId: string
  /** Creation instant, in milliseconds since the epoch. */
  readonly createdAt: number
  /** Last update instant, in milliseconds since the epoch. */
  readonly updatedAt: number
  /** The team's task-sequence high-water mark. */
  readonly taskSeq: number
  /** The team's phase (`running` while the arm drives it). */
  readonly phase: string
  /** Every member of the team. */
  readonly members: readonly ArmTeamMember[]
  /** Every task the team carries. */
  readonly tasks: readonly ArmTeamTask[]
}

/** The engine's own counters, as an arm reads them back. */
interface EngineStats {
  /** How many holds the engine applied (the §1 hold path's own counter). */
  holdsApplied?: number
  /** How many scene files the engine wrote. */
  readonly scenes?: number
  /** How many ticks the engine ran. */
  readonly ticks?: number
  /** Any further counter the engine reports. */
  readonly [extra: string]: unknown
}

/** The engine's suppression-predicate reading. */
interface PredicateReading {
  /** Which signal the predicate used: `channel` for the fold, `heartbeat` for the fallback. */
  source: string
  /** Per-session predicate states (OUTSTANDING / IN-FLIGHT / ALIVE / PARKED). */
  readonly states: Record<string, string>
  /** How many events the fold consumed; absent when the engine does not report it. */
  readonly events?: number
}

/** One decision the engine took, in the shape the arm reduces it to. */
interface TickDecision {
  /** The decision kind (`warn`, `escalate`, ...). */
  readonly type: unknown
  /** The cause the decision names, when it names one. */
  readonly cause?: unknown
  /** The consecutive-silence streak, when the decision reports one. */
  readonly streak?: unknown
  /** The member state the decision was taken on, when it reports one. */
  readonly state?: unknown
}

/** What one `tickOnce` returned. */
interface TickResult {
  /** Every decision the tick took, in order. */
  readonly decisions: readonly TickDecision[]
  /** The team ids the tick held. */
  readonly holds: readonly string[]
  /** Every scene the tick wrote. */
  readonly scenes: readonly unknown[]
}

/** One tick's reading, as an arm records it for the evidence file. */
interface TickReading {
  /** The tick's offset past the arm's `now`, in milliseconds. */
  readonly offset: number
  /** Every decision of that tick, reduced to the fields the lane asserts on. */
  readonly decisions: DecisionReading[]
  /** The team ids the tick held. */
  readonly holds: string[]
  /** How many scene files the tick wrote. */
  readonly scenes: number
}

/** One decision as an arm records it. */
interface DecisionReading {
  /** The decision kind. */
  type: unknown
  /** The cause the decision names, or `null` when it names none. */
  cause: unknown
  /** The consecutive-silence streak, or `null` when the decision reports none. */
  streak: unknown
  /** The member state, or `null` when the decision reports none. */
  state: unknown
}

/** The sliver of the built watchdog engine the arms drive. */
interface WatchdogEngine {
  /**
   * Run one tick against the given clock reading.
   * @param now The clock reading, in milliseconds since the epoch.
   * @returns Everything the tick decided, held and wrote.
   */
  tickOnce(now: number): Promise<TickResult>
  /** @returns The engine's own counters. */
  getStats(): EngineStats
  /** @returns The suppression-predicate reading, when the engine exposes one. */
  predicateStatus?(): PredicateReading
  /** Stop the engine's timer and release its resources. */
  stop(): void
}

/** What the built watchdog row's `apply` returned, as the arms consume it. */
interface WatchdogReport {
  /** The mounted engine, absent or `null` when the row refused to apply. */
  readonly engine?: WatchdogEngine | null
  /** Why the row applied no engine. */
  readonly error?: unknown
}

/** The built watchdog row's entry surface, as these arms mount it. */
interface WatchdogRow {
  /**
   * Mount the row on the stub context.
   * @param ctx The context the row mounts on.
   * @param config The row config.
   * @returns The apply report (or a disposer).
   */
  apply(ctx: unknown, config: unknown): WatchdogReport | undefined
}

/** The hold sidecar's fields this lane reads. */
interface HoldReading {
  /** The team the hold was applied to. */
  readonly teamId?: string
  /** The hold's own id, which the scene pointer must match. */
  readonly id?: string
  /** Any further field the sidecar carries. */
  readonly [extra: string]: unknown
}

/** The latest-scene pointer's fields this lane reads. */
interface ScenePointerReading {
  /** The reason the scene was written. */
  readonly reason?: unknown
  /** The team the scene belongs to, with the hold pointer inside it. */
  readonly team?: {
    /** The hold the scene points at. */
    readonly hold?: {
      /** The hold's id, which must equal the sidecar's. */
      readonly id?: unknown
    }
  }
}

/** One incident record as the store logs it (only the fields this lane reads are named). */
interface IncidentReading {
  /** The incident kind (`warn`, `escalate`, ...). */
  readonly kind?: unknown
  /** The hold outcome the incident records, when it records one. */
  readonly hold?: unknown
  /** Any further field the store's line carries. */
  readonly [extra: string]: unknown
}

/** The scene-restore leg's reading, taken from an arm's own hold with plain fs. */
interface SceneLegReading {
  /** How the leg read the store (the fresh-process shape, asserted as text). */
  readWith?: string
  /** The scene file names the store holds for the arm's team. */
  sceneFiles?: string[]
  /** The reason the latest scene pointer records. */
  latestReason?: unknown
  /** The hold id the latest pointer names. */
  pointerHoldId?: unknown
  /** The hold id the sidecar file carries. */
  sidecarHoldId?: unknown
  /** Whether the pointer's hold id exists and matches the sidecar's. */
  holdMatch?: boolean
  /** The incident kinds the log carries, in file order. */
  incidentKinds?: unknown[]
  /** The escalation incident record, or `null` when the log has none. */
  escalatedIncident?: IncidentReading | null
  /** Whether the hold sidecar exists at all. */
  holdFileExists?: boolean
}

/** One arm's reading: per-tick decisions, the hold sidecar, the scene files and the counters. */
interface ArmReading {
  /** The escalation action the arm ran with; a synthetic observation may omit it. */
  readonly arm?: string
  /** The arm's sandbox workspace; absent when the row applied no engine. */
  workspace?: string
  /** Why the row applied no engine; absent when it applied one. */
  error?: string
  /** The knobs the arm ran with. */
  knobs?: ArmKnobs
  /** Whether both folded events reached the `session/event` listener. */
  foldSubscribed?: boolean
  /** Whether the arm fed folded events at all. */
  folded?: boolean
  /** The engine's suppression-predicate reading, or `null` when it exposes none. */
  predicate?: PredicateReading | null
  /** One reading per tick, in tick order. */
  ticks?: TickReading[]
  /** Every decision kind the ticks produced, flattened. */
  kinds?: unknown[]
  /** The cause of every warn decision, flattened. */
  warnCauses?: unknown[]
  /** The scene file names the store holds for the arm's team. */
  sceneFiles?: string[]
  /** Whether the hold sidecar exists. */
  holdFileExists?: boolean
  /** The parsed hold sidecar, or `null` when the store has none. */
  hold?: HoldReading | null
  /** The engine's own counters. */
  stats?: EngineStats
}

/** One fixture case's reading, as the evaluator and the controls consume it. */
interface CaseObservation {
  /** The decision kinds the case's ticks produced. */
  kinds?: unknown[]
  /** Whether the case applied exactly one hold (its pre-redesign expectation). */
  holdAppliedOnce?: boolean
  /** How many holds the case's own reading reports. */
  holdsApplied?: number
  /** Whether the case applied exactly one escalate per task+attempt generation. */
  exactlyOneEscalatePerTaskAttempt?: boolean
  /** The engine counters the case read back. */
  stats?: EngineStats
  /** The failure text when the case's own expectation threw. */
  threw?: string
  /** The case's decisions, as the heterogeneous records the fixture writes. */
  decisions?: readonly unknown[]
  /** How many distinct stamp times the case injected. */
  distinctStampTimes?: number
  /** The tick reading above the silence threshold. */
  tickAboveThreshold?: {
    /** The decision kinds that tick produced. */
    decisions?: unknown[]
  }
  /** Whether the case measured silence from the member's LAST stamp. */
  measuredFromLastStamp?: boolean
  /** Whether the captain's own silence was flagged. */
  captainFlagged?: boolean
  /** Whether the still-stepping member was flagged. */
  memberFlagged?: boolean
  /** Whether the knobs that ran were the fixture's own frozen tuple. */
  knobsAreTheFrozenDefaults?: boolean
  /** Whether the warn arrived within the threshold plus 5 s. */
  warnLatencyWithinThresholdPlus5s?: boolean
  /** The tick reading below the silence threshold. */
  belowThreshold?: {
    /** How many decisions that tick produced (0 below the threshold). */
    decisions?: number
  }
  /** The tick reading above the silence threshold, with its warn count. */
  aboveThreshold?: {
    /** How many warns that tick produced. */
    warnCount?: number
    /** The silence the tick observed, in milliseconds. */
    silenceMs?: number
  }
  /** Whether the pause applied a hold. */
  holdApplied?: boolean
  /** Whether the pause preserved the record. */
  preserved?: boolean
  /** Whether anything was cancelled while held. */
  cancelled?: boolean
  /** Whether the team record's sha256 was unchanged across the held kicks. */
  sha256UnchangedAcrossHeldKicks?: boolean
  /** How many deliveries reached the held team. */
  deliveriesWhileHeld?: number
  /** The dispatch decline lines the held team produced. */
  declineLines?: string[]
  /** Whether dispatch worked again after the resume. */
  resumed?: boolean
  /** How many deliveries happened after the resume. */
  deliveriesAfterResume?: number
  /** The cancellation mechanism the halt control called. */
  mechanism?: string
  /** How many tasks the halt control cancelled. */
  cancelledTasks?: number
  /** Whether the record's sha256 changed under the halt control. */
  sha256Changed?: boolean
  /** Whether the fixture itself marks the halt control as reddening AC-17. */
  wouldReddenAC17?: boolean
}

/** One fixture case's result. */
interface FaultCase {
  /** The case name, which the evaluator matches against its declared lists. */
  case: string
  /** Whether the case's own expectations held. */
  ok: boolean
  /** The reading the case produced. */
  readonly observation: CaseObservation
}

/** The verified fault fixture's surface, as this lane drives it. */
interface FaultFixture {
  /** Every case name the fixture declares. */
  readonly CASES: readonly string[]
  /** The fixture's OWN injected row config (its `FROZEN`). */
  readonly FROZEN: KnobTuple
  /** The fixture's honest limits, repeated VERBATIM by the lane. */
  readonly NOT_CLAIMED: readonly string[]
  /**
   * Run every case under one evidence root.
   * @param options The evidence root and whether the fixture prints as it runs.
   * @returns One result per case, in the fixture's own order.
   */
  runAll(options: { readonly root: string; readonly print: boolean }): Promise<readonly FaultCase[]>
  /** @returns The scenarios the fixture declares, for the record. */
  scenarios(): unknown
}

/** The corrected labels the lane prints beside the fixture's numbers. */
interface LaneLabels {
  /** The tuple the fixture actually injects, as the run recorded it. */
  fixtureTuple: KnobTuple
  /** Whether the injected tuple is declared as the fixture's own pre-redesign config. */
  fixtureTupleIsPreRedesign: boolean
  /** The label text printed for the injected tuple. */
  fixtureTupleLabel: string
  /** The product's §3 defaults, which the in-lane arm runs. */
  productDefaults: KnobTuple
  /** Whether §3's numbers are declared as the product default. */
  section3IsProductDefault: boolean
  /** The label text printed for the product defaults. */
  productDefaultsLabel: string
}

/** Everything the fault lane evaluates: the fixture's case results plus the in-lane arms. */
interface FaultObservation {
  /** Every case result the fixture returned. */
  cases: readonly FaultCase[]
  /** The case names the fixture declares, which every case result must cover. */
  expectedCases: readonly string[]
  /** The case names this lane declares stale. */
  staleFixtureCases?: readonly string[]
  /** The fixture's own NOT_CLAIMED list, the source of the verbatim echo. */
  notClaimedSource: readonly string[]
  /** The same list as the run actually printed it, asserted byte-identical. */
  notClaimedEchoed: readonly string[]
  /** The fixture file's sha256, anchoring the reading to the bytes that produced it. */
  fixtureSha256?: string
  /** The tuple the fixture injects, recorded with the reading. */
  frozen?: KnobTuple
  /** The scenarios the fixture declares. */
  scenarios?: unknown
  /** The §1 escalation arm's reading. */
  escalationArm: ArmReading
  /** The `warn-only` contrast arm's reading. */
  warnOnlyArm: ArmReading
  /** The §4 report-only arm's reading. */
  reportOnlyArm: ArmReading
  /** The scene-restore leg, read from the §1 arm's hold with plain fs. */
  sceneLeg: SceneLegReading | null
  /** The corrected labels printed beside the numbers. */
  labels: LaneLabels
  /** The lane's own declared limits. */
  laneLimits?: readonly string[]
}

/** The result `run` persists: the lane's identity, its observation and the verdict. */
type FaultResult = {
  /** What this lane asserts. */
  task: string
  /** The lane slug. */
  lane: string
  /** The scratch root the fixture and the arms ran under. */
  root: string
  /** Everything the verdict read. */
  observed: FaultObservation
  /** Whether every check held. */
  ok: boolean
  /** Every assertion the lane evaluated. */
  checks: LaneCheck[]
  /** Items the lane explicitly does NOT claim. */
  notClaimed: string[]
  /** The evidence file this run wrote, assigned once `writeEvidence` returns. */
  evidenceFile?: string
}

/** The member double the stub agent registry answers with. */
interface MemberDouble {
  /** The agent/session id the row resolves. */
  readonly id: string
  /** The member's run status. */
  readonly status: string
  /** The member's session, whose header carries the workspace. */
  readonly session: {
    /** The session id, which captain recognition compares. */
    readonly id: string
    /** The session header, whose `cwd` the row resolves state from. */
    readonly header: {
      /** The session workspace root. */
      readonly cwd: string
    }
  }
}

/** One tool definition as the stub registry stores it. */
interface StubToolDefinition {
  /** The tool name the row registered. */
  readonly name: string
  /** Every other field the registration carried. */
  readonly [extra: string]: unknown
}

/** The stub context one arm mounts the REAL row on: the ONLY simulated layer. */
interface ArmCtx {
  /**
   * @param id The service id to resolve.
   * @returns The service, or `undefined` when it is not provided.
   */
  get(id: string): unknown
  /**
   * @param id The service id to provide.
   * @param value The service instance.
   */
  provide(id: string, value: unknown): void
  /** The stub agent registry, backed by the arm's member double. */
  agents: {
    /**
     * @param id The agent id to look up.
     * @returns The member double when the id matches, else `undefined`.
     */
    get(id: string): MemberDouble | undefined
    /** @returns Every live member double (empty when the arm drives no live member). */
    list(): MemberDouble[]
  }
  /** The stub logger, whose warn/info lines the arm records for its assertions. */
  logger: {
    /** Record one warn line. */
    warn(...args: unknown[]): void
    /** Record one info line. */
    info(...args: unknown[]): void
    /** Swallow one error line. */
    error(...args: unknown[]): void
    /** Swallow one debug line. */
    debug(...args: unknown[]): void
  }
  /**
   * @param event The harness event name.
   * @param handler The listener to capture.
   * @returns The disposer that removes the captured listener.
   */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  /**
   * @param callback The effect body, pushed for disposal.
   */
  effect(callback: () => unknown): void
  /**
   * @param deps The service ids the callback waits for.
   * @param callback The callback, run immediately when every dependency is already provided.
   * @returns A no-op disposer.
   */
  inject(deps: readonly string[], callback: (ctx: ArmCtx) => void): () => void
  /** The stub LLM seam, which echoes its request and lists no models. */
  llm: {
    /**
     * @param request The call config the row asked for.
     * @returns The request, echoed unchanged.
     */
    resolveCallConfig(request: unknown): Promise<unknown>
    /** @returns An empty model list. */
    listModels(): Promise<unknown[]>
  }
  /** The stub system-prompt seam, which records nothing. */
  systemPrompt: {
    /** Accept and ignore one section registration. */
    section(): void
  }
  /** The stub tool registry, which records every registration by name. */
  tools: {
    /**
     * @param definition The tool definition the row registers.
     * @returns The disposer that removes the registration.
     */
    register(definition: StubToolDefinition): () => void
    /**
     * @param name The tool name to look up.
     * @returns The registered definition, or `undefined`.
     */
    get(name: string): StubToolDefinition | undefined
    /**
     * @param name The tool name to test.
     * @returns Whether a definition with that name is registered.
     */
    has(name: string): boolean
  }
  /** The stub subagent seam, whose prompt records the delivery. */
  subagents: {
    /**
     * @param request The prompt request the row sends.
     * @returns A settled prompt receipt.
     */
    prompt(request: { readonly childSessionId?: string; readonly content?: ReadonlyArray<{ readonly text?: string }> }): Promise<{ messageId: string }>
    /** Accept and ignore one interrupt. */
    interrupt(): void
    /** @returns A settled drain. */
    drainContinuableChildren(): Promise<void>
  }
}

/** One arm's harness: the stub context plus the levers and readings the lane uses. */
interface ArmHarness {
  /** The stub context handed to the REAL row's `apply`. */
  readonly ctx: ArmCtx
  /** The member double the stub registry answers with. */
  readonly member: MemberDouble
  /** Every captured listener, by event name. */
  readonly handlers: Map<string, (...args: unknown[]) => unknown>
  /** Every subagent prompt the row sent, as `{childId, text}`. */
  readonly deliveries: Array<{ childId: string | undefined; text: string }>
  /** Every warn/info line the row logged. */
  readonly warnings: string[]
  /** Every service the row provided, by id. */
  readonly services: Map<string, unknown>
  /** Every tool definition the row registered, by name. */
  readonly tools: Map<string, StubToolDefinition>
  /** Run every effect body's disposer, exactly once. */
  dispose(): void
}

/** The knobs `makeCtx` accepts. */
interface MakeCtxOptions {
  /** Whether the stub agent registry reports the arm's member as live. */
  readonly liveMembers?: boolean
  /** The agent/session id the member double carries. */
  readonly memberId?: string
  /** The member's display name. */
  readonly memberName?: string
}

/** The knobs one in-lane arm runs with. */
interface EscalationArmOptions {
  /** The escalation action under test (`pause` holds the team, `warn-only` does not). */
  readonly actionOnEscalate: string
  /** Whether the stub registry reports a live member session. */
  readonly liveMembers?: boolean
  /** The tick offsets past `now`, in milliseconds. */
  readonly ticks: readonly number[]
  /** Whether the arm feeds the fold `turn/start` + `step/start`. */
  readonly folded?: boolean
}

/** One declared-stale case's reading, whether or not the fixture still declares that case. */
interface StaleReading {
  /** The case name. */
  readonly name: string
  /** Whether the fixture still declares the case (false when the result is missing). */
  readonly declared?: boolean
  /** Whether the case actually ran. */
  readonly ran?: boolean
  /** Whether the case's own expectations failed. */
  readonly failed?: boolean
  /** Whether the reading still matches the declared pre-redesign signature. */
  readonly staleSignatureHolds?: boolean
  /** Why this reading counts as stale, or why the declaration must be re-checked. */
  readonly why?: string
  /** Why the case is missing from the results. */
  readonly reason?: string
}

/** One declared-stale case's signature check, over the reading the fixture produced. */
type StaleSignature = (observation: CaseObservation) => boolean

/**
 * The fixture's OWN injected row config (its `FROZEN`): the PRE-REDESIGN tuple, kept by the
 * fixture so its silence injection still exercises the old ladder shape. It is NOT the product's
 * default — the product's §3 defaults are `SECTION3_DEFAULTS` below.
 */
const FIXTURE_INJECTED_TUPLE: KnobTuple = { warnSilenceMs: 90_000, tickIntervalMs: 15_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" }
/** FROZEN CONTRACT §3: the values the redesigned engine runs with (600 000 / 6 / `warn-only`). */
const SECTION3_DEFAULTS: KnobTuple = { warnSilenceMs: 600_000, tickIntervalMs: 15_000, warnStreakToEscalate: 6, actionOnEscalate: "warn-only" }
/** The §1 hold path is OPT-IN: a hold is applied only when `actionOnEscalate` is `pause` (§3). */
const SECTION3_PAUSE: KnobTuple = { ...SECTION3_DEFAULTS, actionOnEscalate: "pause" }
/** The workspace-relative store root the arms write their team state under. */
const STATE_DIR: string = join(".mpd", "team")
/** The arm's team id, which also names its state directory. */
const ARM_TEAM: string = "redesign-probe"
/** The arm member's agent/session id. */
const ARM_MEMBER_ID: string = "session-architect"
/** The arm member's display name, from which the heartbeat key is sanitized. */
const ARM_MEMBER: string = "Architect"

/**
 * The crash text for a thrown value, exactly as `String(error?.stack ?? error)` produced it.
 * @param error The thrown value.
 * @returns The `stack` when the value carries one, else the value itself stringified.
 */
function crashText(error: unknown): string {
  // A thrown object's `stack` member; a primitive has none, so the value itself is used.
  const stack = typeof error === "object" && error !== null ? (error as { stack?: unknown }).stack : undefined
  return String(stack ?? error)
}

/**
 * A stub ctx with exactly the surface the watchdog row uses during `apply` + `install()` — the
 * same shape the verified fixture's own harness builds, kept minimal on purpose so the arm's
 * evidence is the ROW's behaviour and not the harness's.
 * @param workspace The workspace root the mounted modules resolve their state from.
 * @param options The stub's knobs: the member's id/name and whether it reports as live.
 * @returns The harness, with the levers the arm fires captured events through.
 */
function makeCtx(workspace: string, { liveMembers = true, memberId = ARM_MEMBER_ID, memberName = ARM_MEMBER }: MakeCtxOptions = {}): ArmHarness {
  // Every service the stub provides, by id.
  const services = new Map<string, unknown>()
  // Every listener the row registered, by event name.
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  // Every effect body the row registered, for disposal at the end of the arm.
  const effects: Array<() => unknown> = []
  // Every subagent prompt the row sent.
  const deliveries: Array<{ childId: string | undefined; text: string }> = []
  // Every warn/info line the row logged.
  const warnings: string[] = []
  // Every tool definition the row registered, by name.
  const tools = new Map<string, StubToolDefinition>()
  // The member double the registry answers with.
  const member = { id: memberId, status: "working", session: { id: memberId, header: { cwd: workspace } } }
  // The stub context itself; the row receives exactly this object.
  const ctx: ArmCtx = {
    get: (id) => services.get(id),
    provide: (id, value) => { services.set(id, value) },
    agents: { get: (id) => (id === memberId ? member : undefined), list: () => (liveMembers ? [member] : []) },
    logger: { warn: (...args) => warnings.push(args.map(String).join(" ")), info: (...args) => warnings.push(args.map(String).join(" ")), error: () => {}, debug: () => {} },
    on: (event, handler) => { handlers.set(event, handler); return () => handlers.delete(event) },
    effect: (callback) => { effects.push(callback) },
    inject: () => () => {},
    llm: { resolveCallConfig: async (request) => request, listModels: async () => [] },
    systemPrompt: { section: () => {} },
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) }, get: (name) => tools.get(name), has: (name) => tools.has(name) },
    subagents: {
      prompt: async (request) => { deliveries.push({ childId: request.childSessionId, text: (request.content ?? []).map((block) => block.text).join("") }); return { messageId: "m" + deliveries.length } },
      interrupt: () => {},
      drainContinuableChildren: async () => {},
    },
  }
  return {
    ctx, member, handlers, deliveries, warnings, services, tools,
    dispose: () => {
      for (const callback of effects.splice(0)) {
        try {
          // The disposer the effect body returned, if it returned one.
          const cleanup = callback()
          // A callable disposer is invoked VERBATIM; the host's contract is a zero-argument call,
          // so the value is asserted to that signature rather than re-validated.
          if (typeof cleanup === "function") (cleanup as () => void)()
        } catch { /* a cleanup that throws must not take the arm down */ }
      }
    },
  }
}

/** A REAL-SHAPED team record: `members` are OBJECTS carrying ids, the way real records have them. */
function armTeamRecord(now: number): ArmTeamRecord {
  return {
    id: ARM_TEAM,
    name: "redesign probe",
    captainSessionId: "session-captain",
    createdAt: now - 3_600_000,
    updatedAt: now,
    taskSeq: 1,
    phase: "running",
    members: [{ id: ARM_MEMBER_ID, name: ARM_MEMBER, role: "architect", status: "working", joinedAt: now - 3_600_000, currentTask: "t1" }],
    tasks: [{
      id: "t1", subject: "the observed task", description: "§1 ladder probe", status: "in_progress",
      assignee: ARM_MEMBER, dependencies: [], attempt: 1, attemptId: "att-arm-1",
      createdAt: now - 60_000, updatedAt: now - 60_000,
    }],
  }
}

/**
 * The plugin's own heartbeat-file key policy (`packages/mpd-team-watchdog-plugin/src/paths.ts`
 * `safeSegment`), re-implemented the way the verified fixture re-implements it (`inject.ts:350`):
 * the engine looks the file up by the SANITIZED member name, so a stamp written under the raw
 * name is invisible to it — measured in this lane's first report-only run, which then read
 * `neverStarted: 1` instead of the §4 warn.
 * @param name The raw member name.
 * @returns The key the heartbeat file is named after.
 */
function safeSegment(name: string): string {
  return String(name).normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

/**
 * Write the team record + ONE current-generation heartbeat stamp at `stampAt`.
 * @param workspace The arm's sandbox workspace.
 * @param record The real-shaped team record to write.
 * @param stampAt The stamp instant, in milliseconds since the epoch.
 */
function armInject(workspace: string, record: ArmTeamRecord, stampAt: number): void {
  // The team's own state directory.
  const teamDir = join(workspace, STATE_DIR, ARM_TEAM)
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  writeFileSync(join(teamDir, "team.json"), JSON.stringify(record, null, 2) + "\n")
  // The heartbeat directory the member's stamp goes into.
  const heartbeatDir = join(workspace, STATE_DIR, "watchdog", "heartbeat")
  mkdirSync(heartbeatDir, { recursive: true })
  // The SANITIZED member key the engine looks the stamp up by.
  const memberKey = safeSegment(ARM_MEMBER)
  // The current-generation stamp, written under the sanitized key.
  const stamp = {
    kind: "step", at: stampAt, member: ARM_MEMBER, memberKey, teamId: ARM_TEAM, taskId: "t1",
    attemptId: "att-arm-1", turnId: ARM_MEMBER + "#1", workspace,
  }
  writeFileSync(join(heartbeatDir, memberKey + ".jsonl"), JSON.stringify(stamp) + "\n")
}

/**
 * THE §1 ARM — a real-shaped team + FOLDED events (`turn/start`, `step/start`, no answer) and a
 * tick schedule past `warnSilenceMs`, against the REAL built row.
 *
 * @param root The scratch root the arm's workspace is created under.
 * @param options The arm's knobs: the escalation action, liveness, the tick schedule, folding.
 * @returns the reading: per-tick decisions/holds, the hold sidecar, the scene file, the stats.
 */
async function escalationArm(root: string, { actionOnEscalate, liveMembers = true, ticks, folded = true }: EscalationArmOptions): Promise<ArmReading> {
  // The arm's own sandbox workspace, unique per run.
  const workspace = join(root, "arm-" + actionOnEscalate + "-" + Math.random().toString(36).slice(2, 8))
  mkdirSync(workspace, { recursive: true })
  // The workspace-root env the row resolves state from, saved for restoration in `finally`.
  const previousRoot = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = workspace
  // The stub harness the REAL row is mounted over.
  const harness = makeCtx(workspace, { liveMembers })
  // The clock reading every tick offset is measured from.
  const now = Date.now()
  try {
    // The built watchdog row, loaded by ABSOLUTE PATH. The cast is unavoidable: the specifier is
    // a runtime path static analysis cannot resolve, so its surface is asserted here instead.
    const row = await import(PATHS.watchdogDist) as WatchdogRow
    // Whatever the row's `apply` returned.
    const report = row.apply(harness.ctx, { stateDir: STATE_DIR, enabled: true, teamCacheMs: 0, keepGenerations: 3, deadTeamGraceMs: 86_400_000, verboseSkips: false, logPrefix: "arm", ...SECTION3_DEFAULTS, actionOnEscalate })
    if (report?.engine === undefined || report?.engine === null) return { arm: actionOnEscalate, error: "the row applied no engine: " + JSON.stringify(report?.error ?? null) }
    armInject(workspace, armTeamRecord(now), now)
    // FOLDED EVENTS: an OPEN step with no committed answer and no `step/end` ⇒ OUTSTANDING.
    // With `folded: false` the fold stays EMPTY for a KNOWN session, which is §4's trigger:
    // the engine answers `channelState: null` + `heartbeatFallback: true` (report-only).
    // The `session/event` listener the row registered, if it registered one.
    const onSession = harness.handlers.get("session/event")
    // The session the folded events are attributed to.
    const session = { id: ARM_MEMBER_ID }
    // How many folded events actually reached the listener (2 = the fold is subscribed).
    const foldedEvents = folded && onSession !== undefined
      ? [onSession(session, { type: "turn/start", seq: 1, time: now, data: { turn: 1 } }), onSession(session, { type: "step/start", seq: 2, time: now, data: { turn: 1, step: 1 } })].length
      : 0
    // One reading per tick, in the order the schedule ran them.
    const readTicks: TickReading[] = []
    for (const offset of ticks) {
      // What that tick returned.
      const result = await report.engine.tickOnce(now + offset)
      readTicks.push({ offset, decisions: result.decisions.map((decision) => ({ type: decision.type, cause: decision.cause ?? null, streak: decision.streak ?? null, state: decision.state ?? null })), holds: [...result.holds], scenes: result.scenes.length })
    }
    // The hold sidecar the tick ladder must have written.
    const holdFile = join(workspace, STATE_DIR, "watchdog", "hold", ARM_TEAM + ".json")
    // The scene directory the ladder must have filled.
    const sceneDir = join(workspace, STATE_DIR, "watchdog", "scene", ARM_TEAM)
    // The engine's own counters.
    const stats = report.engine.getStats()
    // The suppression-predicate reading, when the engine exposes one.
    const status = typeof report.engine.predicateStatus === "function" ? report.engine.predicateStatus() : null
    report.engine.stop()
    return {
      arm: actionOnEscalate,
      workspace,
      knobs: { warnSilenceMs: SECTION3_DEFAULTS.warnSilenceMs, warnStreakToEscalate: SECTION3_DEFAULTS.warnStreakToEscalate, actionOnEscalate },
      foldSubscribed: foldedEvents === 2,
      folded: folded === true,
      predicate: status === null ? null : { source: status.source, states: status.states, events: status.events },
      ticks: readTicks,
      kinds: readTicks.flatMap((tick) => tick.decisions.map((decision) => decision.type)),
      warnCauses: readTicks.flatMap((tick) => tick.decisions.filter((decision) => decision.type === "warn").map((decision) => decision.cause)),
      sceneFiles: existsSync(sceneDir) ? readdirSync(sceneDir).sort() : [],
      holdFileExists: existsSync(holdFile),
      // The sidecar's declared shape is the plugin's own record; it is asserted here, not rebuilt.
      hold: existsSync(holdFile) ? JSON.parse(readFileSync(holdFile, "utf8")) as HoldReading : null,
      stats,
    }
  } finally {
    harness.dispose()
    if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = previousRoot
  }
}

/**
 * The scene-restore leg, read from the ARM's own sandbox with plain fs (the fresh-process shape).
 * @param workspace The §1 arm's sandbox workspace.
 * @returns The scene pointer, the sidecar hold and the incident log, as plain fs reads them.
 */
function sceneLeg(workspace: string): SceneLegReading {
  // The scene directory the ladder filled.
  const sceneDir = join(workspace, STATE_DIR, "watchdog", "scene", ARM_TEAM)
  // The latest-scene pointer the ladder wrote.
  const latestPath = join(sceneDir, "latest.json")
  // The hold sidecar the ladder wrote.
  const holdPath = join(workspace, STATE_DIR, "watchdog", "hold", ARM_TEAM + ".json")
  // The append-only incident log.
  const incidentsPath = join(workspace, STATE_DIR, "watchdog", "incidents.jsonl")
  // The latest-scene pointer, or `null` when the store has none; the store's own format is asserted.
  const latest: ScenePointerReading | null = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) as ScenePointerReading : null
  // The hold sidecar, or `null` when the store has none.
  const hold: HoldReading | null = existsSync(holdPath) ? JSON.parse(readFileSync(holdPath, "utf8")) as HoldReading : null
  // Every incident record, parsed line by line (the store's own line format is asserted).
  const incidents: IncidentReading[] = existsSync(incidentsPath)
    ? readFileSync(incidentsPath, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as IncidentReading)
    : []
  return {
    readWith: "plain fs + JSON.parse (no plugin reader) — the fresh-process shape",
    sceneFiles: existsSync(sceneDir) ? readdirSync(sceneDir).sort() : [],
    latestReason: latest?.reason ?? null,
    pointerHoldId: latest?.team?.hold?.id ?? null,
    sidecarHoldId: hold?.id ?? null,
    holdMatch: latest?.team?.hold?.id !== undefined && latest?.team?.hold?.id === hold?.id,
    incidentKinds: incidents.map((entry) => entry.kind),
    escalatedIncident: incidents.find((entry) => entry.kind === "escalate") ?? null,
    holdFileExists: hold !== null,
  }
}

/** The lane slug, used to name the evidence directory and to prefix every printed line. */
const SLUG = "team-watchdog-fault"

/**
 * The fixture cases whose expectations encode PRE-REDESIGN behaviour, each with the reading
 * signature that PROVES it (t65/S1). The measured cause: the fixture never emits `session/event`,
 * so with the member ids its records DO carry, the engine resolves the session and then finds no
 * fold data for it → `heartbeatFallback: true` → §4 report-only, where a hold can never be
 * applied. If one of these starts passing, its declaration must be re-checked instead of being
 * kept — that is what F2b's signature assertion enforces.
 */
const STALE_FIXTURE_CASES: Record<string, StaleSignature> = {
  "escalate-3x": (observation) => (observation.kinds ?? [])[0] === "warn" && observation.holdAppliedOnce !== true && (observation.stats?.holdsApplied ?? 0) === 0,
  "scene-restore": (observation) => typeof observation.threw === "string" && observation.threw.includes("hold/"),
  "mid-turn-stall": (observation) => (observation.decisions ?? [])[0] === "warn" && (observation.stats?.holdsApplied ?? 0) === 0,
  "long-tool-bound-disabled-control": (observation) => (observation.kinds ?? [])[0] === "warn" && (observation.stats?.holdsApplied ?? 0) === 0,
  "completed-tool-not-in-flight": (observation) => (observation.kinds ?? [])[0] === "warn" && (observation.stats?.holdsApplied ?? 0) === 0,
}

/**
 * The pure evaluator over the fixture's OWN case results PLUS the in-lane §1 / §4 arms.
 * @param observed Every reading this run produced: the fixture cases and the three arms.
 * @returns The verdict: whether every check held, plus the checks themselves.
 */
export function evaluate(observed: FaultObservation): LaneVerdict {
  // One assertion per invariant, printed in the order below.
  const checks: LaneCheck[] = []
  /**
   * Record one assertion.
   * @param id The stable check id (F1..F13).
   * @param ok Whether the assertion held.
   * @param detail The reading printed beside it.
   */
  const add = (id: string, ok: unknown, detail: unknown): void => { checks.push({ id, ok: Boolean(ok), detail: String(detail) }) }
  // The case results by name, so each assertion can read its own case.
  const byCase = new Map<string, FaultCase>((observed.cases ?? []).map((entry): [string, FaultCase] => [entry.case, entry]))
  // The case names the fixture declares, which every result must cover.
  const expected: readonly string[] = observed.expectedCases ?? []

  add("F1", expected.length > 0 && expected.every((name) => byCase.has(name)),
    "every fixture case ran (" + (observed.cases ?? []).length + " results for " + expected.length + " cases: " + expected.join(", ") + ")")

  // F2/F2b — the stale expectations are DECLARED and their staleness is MEASURED (t65/S1).
  // The case names this lane declares stale.
  const staleNames: string[] = Object.keys(STALE_FIXTURE_CASES)
  // The names of every case whose own expectations did not hold.
  const failedCases: string[] = (observed.cases ?? []).filter((entry) => entry.ok !== true).map((entry) => entry.case)
  // Those failures that are NOT declared stale, i.e. the ones that must be zero.
  const failedNonStale: string[] = failedCases.filter((name) => !staleNames.includes(name))
  add("F2", failedNonStale.length === 0,
    "every fixture case that does NOT encode a pre-redesign expectation passed (stale, declared: " + JSON.stringify(failedCases.filter((name) => staleNames.includes(name))) + "; unexpected failures: " + JSON.stringify(failedNonStale) + ")")
  // One reading per declared-stale case, proving the declared staleness still holds.
  const staleReading: StaleReading[] = staleNames.map((name): StaleReading => {
    // The case result, absent when the fixture no longer declares that case.
    const entry = byCase.get(name)
    if (entry === undefined) return { name, declared: false, reason: "case missing" }
    // Whether this case's reading still matches its declared pre-redesign signature.
    const stale = STALE_FIXTURE_CASES[name](entry.observation ?? {})
    return { name, ran: true, failed: entry.ok !== true, staleSignatureHolds: stale, why: stale ? "pre-redesign expectation vs report-only behaviour" : "the case now reads GREEN or differently — re-check the declaration" }
  })
  add("F2b", staleReading.every((entry) => entry.ran === true && entry.failed === true && entry.staleSignatureHolds === true),
    "each declared-stale fixture case STILL fails with its recorded signature (no `session/event` in the fixture ⇒ `fold.view(sessionId) === null` ⇒ `heartbeatFallback: true` ⇒ §4 report-only, which can never escalate or hold): " + JSON.stringify(staleReading))

  // The `member-stops-stepping` case's reading (silence measured from the member's last stamp).
  const member: CaseObservation = byCase.get("member-stops-stepping")?.observation ?? {}
  add("F11", member.distinctStampTimes === 3 && Array.isArray(member.tickAboveThreshold?.decisions) && member.tickAboveThreshold.decisions.includes("warn") && member.measuredFromLastStamp === true,
    "the member case measures silence FROM its last stamp: " + JSON.stringify({ stamps: member.distinctStampTimes, above: member.tickAboveThreshold?.decisions }))

  // F3 — LABEL FIX (t65/S2): the fixture's 90 000/3/`pause` is its OWN INJECTED PRE-REDESIGN ROW
  // CONFIG, never "the product's frozen defaults" (those are §3's 600 000/6/`warn-only`).
  // The `warn-90s` case's reading (the exact 90 s boundary).
  const warn: CaseObservation = byCase.get("warn-90s")?.observation ?? {}
  // The tuple the fixture actually injected, as this run recorded it.
  const fixtureTuple: Partial<KnobTuple> = observed.labels?.fixtureTuple ?? {}
  add("F3", warn.belowThreshold?.decisions === 0 && (warn.aboveThreshold?.warnCount ?? 0) >= 1 && warn.warnLatencyWithinThresholdPlus5s === true && warn.knobsAreTheFrozenDefaults === true &&
    fixtureTuple.warnSilenceMs === FIXTURE_INJECTED_TUPLE.warnSilenceMs && fixtureTuple.warnStreakToEscalate === FIXTURE_INJECTED_TUPLE.warnStreakToEscalate && fixtureTuple.actionOnEscalate === FIXTURE_INJECTED_TUPLE.actionOnEscalate,
    "the 90 s boundary is exact AND the knobs that ran are the FIXTURE'S INJECTED PRE-REDESIGN tuple (" + JSON.stringify(fixtureTuple) + "), not the product default: " + JSON.stringify({ below: warn.belowThreshold, above: warn.aboveThreshold }))

  // F4/F4b — THE §1 ESCALATION ARM (t65/S1): a real-shaped team + folded events, on the real row.
  // The §1 escalation arm's reading.
  const arm: ArmReading = observed.escalationArm ?? {}
  // Every decision kind the arm's ticks produced.
  const armKinds: readonly unknown[] = arm.kinds ?? []
  add("F4", arm.foldSubscribed === true && arm.predicate?.source === "channel" && Object.values(arm.predicate?.states ?? {}).includes("OUTSTANDING") &&
    armKinds.includes("escalate") && arm.holdFileExists === true && arm.hold?.teamId === ARM_TEAM && (arm.stats?.holdsApplied ?? 0) >= 1 && (arm.sceneFiles ?? []).length >= 1,
    "§1 LADDER END-TO-END on a real-shaped team (members as OBJECTS with ids) with FOLDED events (turn/start + step/start, no answer): the fold says OUTSTANDING, " + JSON.stringify(armKinds) + " escalates and a hold sidecar is written (" + JSON.stringify({ hold: arm.hold?.teamId ?? null, scenes: arm.sceneFiles?.length ?? 0, stats: arm.stats?.holdsApplied ?? null }) + ")")
  // The `warn-only` contrast arm's reading.
  const warnOnly: ArmReading = observed.warnOnlyArm ?? {}
  add("F4b", (warnOnly.kinds ?? []).includes("escalate") && warnOnly.holdFileExists === false && (warnOnly.stats?.holdsApplied ?? 0) === 0,
    "the §3 DEFAULT `warn-only` escalates and applies NO hold (kinds " + JSON.stringify(warnOnly.kinds) + ", holdFile " + JSON.stringify(warnOnly.holdFileExists) + ") — the hold path is opt-in")

  // The `captain-wedge` case's reading (the captain's own silence vs the stepping member).
  const captain: CaseObservation = byCase.get("captain-wedge")?.observation ?? {}
  // The fixture's `decisions` field is heterogeneous across cases (kind strings in some, the
  // attribution objects this one records in another), so `typeof` alone cannot narrow the element.
  const captainDecisions: readonly unknown[] = captain.decisions ?? []
  add("F5", captain.captainFlagged === true && captain.memberFlagged === false && (captainDecisions[0] as { readonly memberKey?: string } | undefined)?.memberKey === "captain",
    "the CAPTAIN's own silence is attributed to memberKey 'captain' while the still-stepping member is NOT flagged (" + JSON.stringify({ captain: captain.captainFlagged, member: captain.memberFlagged }) + ")")

  // The `pause-preserves` case's reading (the preserving hold, AC-17's positive leg).
  const pause: CaseObservation = byCase.get("pause-preserves")?.observation ?? {}
  add("F6", pause.sha256UnchangedAcrossHeldKicks === true && pause.deliveriesWhileHeld === 0 && pause.preserved === true && pause.cancelled === false,
    "the pause PRESERVES: team.json byte-unchanged across the held kicks, ZERO deliveries while held, nothing cancelled (" + JSON.stringify({ unchanged: pause.sha256UnchangedAcrossHeldKicks, deliveries: pause.deliveriesWhileHeld, preserved: pause.preserved, declines: pause.declineLines?.length ?? 0 }) + ")")
  add("F7", pause.resumed === true && (pause.deliveriesAfterResume ?? 0) >= 1 && pause.holdApplied === true,
    "after the resume dispatch works again (" + JSON.stringify(pause.deliveriesAfterResume) + " deliveries)")

  // The `pause-preserves-halt-control` case's reading (AC-17's contrast leg).
  const halt: CaseObservation = byCase.get("pause-preserves-halt-control")?.observation ?? {}
  add("F8", (halt.cancelledTasks ?? 0) >= 1 && halt.sha256Changed === true && halt.wouldReddenAC17 === true,
    "AC-17 CONTRAST: the halt control CALLS the real haltTeamWork (" + JSON.stringify(halt.mechanism) + ") — it cancels " + JSON.stringify(halt.cancelledTasks) + " task(s), the record CHANGES (" + JSON.stringify(halt.sha256Changed) + ") and the fixture itself marks wouldReddenAC17=" + JSON.stringify(halt.wouldReddenAC17))

  // F9 — the scene-restore leg, now read from the ARM's OWN hold (the fixture's `scene-restore`
  // case cannot produce one, which is exactly why it is declared stale above).
  // The scene-restore leg's reading, or `{}` when no arm produced one.
  const scene: SceneLegReading = observed.sceneLeg ?? {}
  add("F9", scene.latestReason === "escalate" && scene.holdMatch === true && scene.holdFileExists === true && scene.escalatedIncident?.hold === "applied" && String(scene.readWith ?? "").includes("plain fs"),
    "the scene restore leg re-reads the scene + hold + incidents with plain fs from the §1 ARM's hold: " + JSON.stringify({ reason: scene.latestReason, holdMatch: scene.holdMatch, incidentKinds: scene.incidentKinds, readWith: scene.readWith }))

  // The fixture's NOT_CLAIMED entries as the run echoed them.
  const echoed: readonly string[] = observed.notClaimedEchoed ?? []
  add("F10", echoed.length === (observed.notClaimedSource ?? []).length && echoed.every((line, index) => line === (observed.notClaimedSource ?? [])[index]),
    "the fixture's NOT_CLAIMED entries are repeated VERBATIM (" + echoed.length + " entries, byte-identical)")

  // F12 — THE §4 REPORT-ONLY PIN (t65/S1): no owner session ⇒ heartbeat fallback ⇒ at most ONE
  // warn per task+attempt generation, and NEVER an escalate or a hold.
  // The §4 report-only arm's reading.
  const reportOnly: ArmReading = observed.reportOnlyArm ?? {}
  // Every decision kind that arm's ticks produced.
  const reportKinds: readonly unknown[] = reportOnly.kinds ?? []
  // How many warns that arm produced (the pin allows exactly one).
  const warns: number = reportKinds.filter((kind) => kind === "warn").length
  add("F12", warns === 1 && reportKinds.includes("escalate") === false && (reportOnly.stats?.holdsApplied ?? 0) === 0 && reportOnly.holdFileExists === false && (reportOnly.warnCauses?.length ?? 0) > 0 && (reportOnly.warnCauses ?? []).every((cause) => cause === "silence-heartbeat"),
    "§4 REPORT-ONLY pinned: with no fold evidence the engine warns at most ONCE per task+attempt generation (cause `silence-heartbeat`) and NEVER escalates or holds — " + JSON.stringify({ ticks: reportKinds, warns, causes: reportOnly.warnCauses, holdsApplied: reportOnly.stats?.holdsApplied ?? null, holdFile: reportOnly.holdFileExists }))

  // F13 — the LABEL itself is asserted, so the pre-redesign tuple cannot be re-advertised as the
  // product's frozen defaults without this lane failing.
  // The labels the run printed beside the numbers.
  const labels: Partial<LaneLabels> = observed.labels ?? {}
  add("F13", labels.fixtureTupleIsPreRedesign === true && labels.section3IsProductDefault === true &&
    labels.productDefaults?.warnSilenceMs === 600_000 && labels.productDefaults?.warnStreakToEscalate === 6 && labels.productDefaults?.actionOnEscalate === "warn-only" &&
    String(labels.fixtureTupleLabel ?? "").includes("NOT the product default") && String(labels.productDefaultsLabel ?? "").includes("§3"),
    "the labels are the corrected ones: the injected tuple is declared as the fixture's own pre-redesign config and §3's 600 000/6/warn-only as the product default — " + JSON.stringify(labels.productDefaults))
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

/**
 * The real lane: run the verified fixture, then the in-lane §1/§3/§4 arms, then evaluate.
 * @param argv The process argv, scanned for `--out`.
 * @returns The result object `writeEvidence` persists.
 */
async function run(argv: readonly string[]): Promise<FaultResult> {
  // The lane's evidence directory: `--out <dir>`, else a fresh timestamped default.
  const dir = evidenceDir(argv, "fault")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  // The verified fault fixture, loaded by ABSOLUTE PATH. The cast is unavoidable: the specifier is
  // a runtime path static analysis cannot resolve, so its surface is asserted here instead.
  const fixture = await import(PATHS.fixture) as FaultFixture
  // The arm root: one scratch tree inside this run's own evidence directory.
  const root = join(dir, "raw", "ws")
  mkdirSync(root, { recursive: true })
  say(SLUG, "fixture: " + PATHS.fixture)
  say(SLUG, "cases: " + fixture.CASES.join(", "))
  say(SLUG, "fixture-INJECTED tuple (PRE-REDESIGN row config, NOT the product default): " + JSON.stringify(fixture.FROZEN))
  say(SLUG, "product §3 defaults (what the in-lane arm runs): " + JSON.stringify(SECTION3_DEFAULTS))
  say(SLUG, "declared-stale fixture cases (no `session/event` emitted ⇒ fold.view()===null ⇒ §4 report-only ⇒ no escalate, no hold): " + Object.keys(STALE_FIXTURE_CASES).join(", "))
  // Every fixture case's result, run under one root.
  const cases = await fixture.runAll({ root, print: false })
  for (const entry of cases) say(SLUG, "case " + entry.case + ": " + (entry.ok ? "ok" : "FAILED") + " " + JSON.stringify(entry.observation))

  // The fixture's honest limits, repeated VERBATIM (never paraphrased, never dropped).
  say(SLUG, "REPEATING the fixture's NOT_CLAIMED verbatim:")
  for (const line of fixture.NOT_CLAIMED) say(SLUG, "NOT CLAIMED: " + line)

  // ── the in-lane arms (t65/S1): the §1 escalation end-to-end, the warn-only contrast, §4 ──
  // The tick schedule the §1/§3 arms run (every offset is past the 600 s §3 threshold).
  const ladderTicks = [600_001, 615_001, 630_001, 645_001, 660_001, 675_001, 690_001, 705_001]
  say(SLUG, "§1 arm: applying the REAL row (built dist) with §3 numbers + `actionOnEscalate: pause` and FOLDED events …")
  // The §1 arm's reading: `pause` + folded events, through the whole ladder.
  const escalationArmReading = await escalationArm(root, { actionOnEscalate: "pause", ticks: ladderTicks })
  say(SLUG, "  §1 arm reading: " + JSON.stringify({ fold: escalationArmReading.foldSubscribed, predicate: escalationArmReading.predicate?.source, states: escalationArmReading.predicate?.states, kinds: escalationArmReading.kinds, holdFile: escalationArmReading.holdFileExists, holdsApplied: escalationArmReading.stats?.holdsApplied }))
  // The §3 contrast arm's reading: the product's own `warn-only` default.
  const warnOnlyArmReading = await escalationArm(root, { actionOnEscalate: SECTION3_DEFAULTS.actionOnEscalate, ticks: ladderTicks })
  say(SLUG, "  warn-only arm reading: " + JSON.stringify({ kinds: warnOnlyArmReading.kinds, holdFile: warnOnlyArmReading.holdFileExists, holdsApplied: warnOnlyArmReading.stats?.holdsApplied }))
  // The §4 arm's reading: no live member session and an empty fold.
  const reportOnlyArmReading = await escalationArm(root, { actionOnEscalate: "pause", liveMembers: false, folded: false, ticks: [601_000, 1_200_000, 1_800_000, 2_400_000] })
  say(SLUG, "  §4 report-only arm reading: " + JSON.stringify({ kinds: reportOnlyArmReading.kinds, warns: reportOnlyArmReading.warnCauses, holdsApplied: reportOnlyArmReading.stats?.holdsApplied, holdFile: reportOnlyArmReading.holdFileExists }))
  // The scene-restore leg, read from the §1 arm's own hold (or `null` when that arm failed).
  const scene = escalationArmReading.workspace === undefined ? null : sceneLeg(escalationArmReading.workspace)
  if (scene !== null) say(SLUG, "  scene-restore leg (from the §1 arm's hold): " + JSON.stringify(scene))

  // Everything the evaluator reads, exactly as this run measured it.
  const observed: FaultObservation = {
    cases,
    expectedCases: fixture.CASES,
    staleFixtureCases: Object.keys(STALE_FIXTURE_CASES),
    notClaimedSource: fixture.NOT_CLAIMED,
    notClaimedEchoed: fixture.NOT_CLAIMED,
    fixtureSha256: sha256(await import("node:fs").then((fs) => fs.readFileSync(PATHS.fixture))),
    frozen: fixture.FROZEN,
    scenarios: fixture.scenarios(),
    escalationArm: escalationArmReading,
    warnOnlyArm: warnOnlyArmReading,
    reportOnlyArm: reportOnlyArmReading,
    sceneLeg: scene,
    labels: {
      fixtureTuple: fixture.FROZEN,
      fixtureTupleIsPreRedesign: true,
      fixtureTupleLabel: "the fixture's OWN injected row config (" + JSON.stringify(FIXTURE_INJECTED_TUPLE) + ") — the PRE-REDESIGN tuple, NOT the product default",
      productDefaults: SECTION3_DEFAULTS,
      section3IsProductDefault: true,
      productDefaultsLabel: "FROZEN CONTRACT §3 — " + JSON.stringify(SECTION3_DEFAULTS),
    },
    laneLimits: [
      "the in-lane §1/§4 arms mount the REAL built row on a STUB ctx (the same shape the verified fixture uses): services, agents, logger, tools are simulated; the engine, machine, store, hold path and scene writer are real modules",
      "the arm's ticks are MANUAL (`report.engine.tickOnce(now)` with an injected clock); no wall clock is waited on",
      "the fixture's five declared-stale cases are REPORTED with their readings, never treated as passes",
    ],
  }
  // The verdict over that observation.
  const verdict = evaluate(observed)
  // The persisted result: the observation plus the verdict and the lane's declared limits.
  const result: FaultResult = {
    task: "AC-3 / AC-4 / AC-9 / AC-10 / AC-17 (injected silence) + §1 escalation end-to-end + §4 report-only pin (t65)",
    lane: SLUG,
    root,
    observed,
    checks: verdict.checks,
    ok: verdict.ok,
    // The `!` is justified: `observed` was built by this function two statements above, so its
    // `laneLimits` is always present here.
    notClaimed: [...fixture.NOT_CLAIMED, ...observed.laneLimits!],
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

/** The stdout capture installed at module load, so the same lines land in output.log. */
const CAPTURE = captureStdout()
// The argv this process was invoked with, minus the node binary and the script path.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  // The NOT_CLAIMED fixture the echo control repeats.
  const NOT = ["W-3: a GENUINE provider wedge is not reproducible here.", "The harness is stubbed.", "No live dsh host.", "`haltTeamWork` cancels."]
  // Every case name the fixture declares, in the fixture's own order.
  const ALL_CASES = ["dead-team-suppressed", "live-team-never-started", "second-team-dispatch", "disabled-control", "never-started-recorded", "completed-turn-idle", "mid-turn-stall", "member-stops-stepping", "captain-wedge", "warn-90s", "escalate-3x", "pause-preserves", "pause-preserves-halt-control", "scene-restore", "long-tool-no-hold", "long-tool-bound-disabled-control", "completed-tool-not-in-flight", "tool-inflight-expired"]
  // Every other case is a plain pass; the ones the evaluator reads get their own observation.
  const SPECIFIC: Record<string, { ok: boolean; observation: CaseObservation }> = {
    "member-stops-stepping": { ok: true, observation: { distinctStampTimes: 3, measuredFromLastStamp: true, tickAboveThreshold: { decisions: ["warn"] } } },
    "captain-wedge": { ok: true, observation: { captainFlagged: true, memberFlagged: false, decisions: [{ memberKey: "captain", assignee: "captain" }] } },
    "warn-90s": { ok: true, observation: { knobsAreTheFrozenDefaults: true, warnLatencyWithinThresholdPlus5s: true, belowThreshold: { decisions: 0 }, aboveThreshold: { warnCount: 1, silenceMs: 90001 } } },
    "pause-preserves": { ok: true, observation: { holdApplied: true, preserved: true, cancelled: false, sha256UnchangedAcrossHeldKicks: true, deliveriesWhileHeld: 0, declineLines: ["declined"], resumed: true, deliveriesAfterResume: 1 } },
    "pause-preserves-halt-control": { ok: true, observation: { mechanism: "haltTeamWork (the adopted mass-cancel path), imported and CALLED", cancelledTasks: 1, sha256Changed: true, wouldReddenAC17: true } },
    "escalate-3x": { ok: false, observation: { kinds: ["warn", "", "", ""], holdAppliedOnce: false, exactlyOneEscalatePerTaskAttempt: false, stats: { scenes: 1, holdsApplied: 0 } } },
    "scene-restore": { ok: false, observation: { threw: "ENOENT: no such file or directory, open '…/.mpd/team/watchdog/hold/fault-probe.json'" } },
    "mid-turn-stall": { ok: false, observation: { decisions: ["warn"], holdsApplied: 0, stats: { holdsApplied: 0 } } },
    "long-tool-bound-disabled-control": { ok: false, observation: { kinds: ["warn", "", ""], stats: { holdsApplied: 0 } } },
    "completed-tool-not-in-flight": { ok: false, observation: { kinds: ["warn", "", ""], stats: { holdsApplied: 0 } } },
  }
  // The synthetic healthy observation every control starts from.
  const healthy: FaultObservation = {
    expectedCases: ALL_CASES,
    staleFixtureCases: Object.keys(STALE_FIXTURE_CASES),
    cases: ALL_CASES.map((name) => ({ case: name, ok: SPECIFIC[name]?.ok ?? true, observation: SPECIFIC[name]?.observation ?? {} })),
    notClaimedSource: NOT,
    notClaimedEchoed: NOT,
    labels: {
      fixtureTuple: { ...FIXTURE_INJECTED_TUPLE },
      fixtureTupleIsPreRedesign: true,
      fixtureTupleLabel: "the fixture's OWN injected row config — the PRE-REDESIGN tuple, NOT the product default",
      productDefaults: { ...SECTION3_DEFAULTS },
      section3IsProductDefault: true,
      productDefaultsLabel: "FROZEN CONTRACT §3 — " + JSON.stringify(SECTION3_DEFAULTS),
    },
    escalationArm: {
      foldSubscribed: true,
      predicate: { source: "channel", states: { [ARM_MEMBER_ID]: "OUTSTANDING" } },
      kinds: ["warn", "warn", "warn", "warn", "warn", "escalate", ""],
      holdFileExists: true,
      hold: { teamId: ARM_TEAM },
      stats: { holdsApplied: 1 },
      sceneFiles: ["20260917T000000Z-warn.json", "latest.json"],
    },
    warnOnlyArm: { kinds: ["warn", "warn", "warn", "warn", "warn", "escalate"], holdFileExists: false, stats: { holdsApplied: 0 } },
    reportOnlyArm: { kinds: ["warn"], warnCauses: ["silence-heartbeat"], holdFileExists: false, stats: { holdsApplied: 0 } },
    sceneLeg: {
      readWith: "plain fs + JSON.parse (no plugin reader) — the fresh-process shape",
      latestReason: "escalate",
      holdMatch: true,
      holdFileExists: true,
      incidentKinds: ["warn", "warn", "escalate"],
      escalatedIncident: { kind: "escalate", hold: "applied" },
    },
  }
  // Every control's mutation starts from a deep copy of `healthy`. The `!` on a `find`/optional
  // lookup is justified: the healthy fixture above always carries the field the control mutates.
  selfTest(SLUG, evaluate, healthy, [
    ["non-stale-case-failed", (copy) => { copy.cases.find((entry) => entry.case === "member-stops-stepping")!.ok = false }, "a fixture case that is NOT declared stale failing"],
    ["stale-case-passes", (copy) => { copy.cases.find((entry) => entry.case === "escalate-3x")!.ok = true }, "a declared-stale case that now PASSES (the declaration must be re-checked)"],
    ["stale-signature-lost", (copy) => { copy.cases.find((entry) => entry.case === "escalate-3x")!.observation.holdAppliedOnce = true }, "a stale case whose reading no longer matches its declared signature"],
    ["warn-boundary", (copy) => { copy.cases.find((entry) => entry.case === "warn-90s")!.observation.belowThreshold!.decisions = 1 }, "a WARN below the 90 s threshold"],
    ["label-regressed", (copy) => { copy.labels.fixtureTupleLabel = "the FROZEN defaults" }, "the pre-redesign tuple re-advertised as the product's frozen defaults (t65/S2)"],
    ["product-defaults-wrong", (copy) => { copy.labels.productDefaults = { ...FIXTURE_INJECTED_TUPLE } }, "a lane that reports the injected tuple as the §3 product default"],
    ["no-escalation-arm", (copy) => { copy.escalationArm.kinds = ["warn", "warn"] }, "a §1 arm that never escalates (§1.2 of the contract)"],
    ["arm-not-fold", (copy) => { copy.escalationArm.predicate!.source = "heartbeat" }, "a §1 arm whose suppression came from the §4 fallback instead of the fold"],
    ["arm-no-hold", (copy) => { copy.escalationArm.holdFileExists = false }, "a §1 escalation that applied no hold (no scene leg either)"],
    ["warn-only-holds", (copy) => { copy.warnOnlyArm.holdFileExists = true }, "a hold applied while `actionOnEscalate` is warn-only"],
    ["report-only-escalates", (copy) => { copy.reportOnlyArm.kinds = ["warn", "escalate"] }, "a §4 report-only arm that escalates"],
    ["report-only-warns-twice", (copy) => { copy.reportOnlyArm.kinds = ["warn", "warn"] }, "a §4 report-only arm warning more than once per task+attempt generation"],
    ["report-only-holds", (copy) => { copy.reportOnlyArm.stats!.holdsApplied = 1 }, "a §4 report-only arm that held a team"],
    ["report-only-cause", (copy) => { copy.reportOnlyArm.warnCauses = ["silence-channel"] }, "a §4 warn not attributed to the heartbeat fallback"],
    ["scene-hold-mismatch", (copy) => { copy.sceneLeg!.holdMatch = false }, "a scene pointer whose hold disagrees with the sidecar"],
    ["scene-not-escalate", (copy) => { copy.sceneLeg!.latestReason = "warn" }, "a scene pointer that does not come from the escalation"],
    ["not-preserving", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves")!.observation.sha256UnchangedAcrossHeldKicks = false }, "a pause that mutated the team record"],
    ["deliveries", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves")!.observation.deliveriesWhileHeld = 1 }, "a dispatch that reached a held team"],
    ["no-contrast", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves-halt-control")!.observation.wouldReddenAC17 = false }, "a halt control that no longer shows AC-17 going red"],
    ["captain-missed", (copy) => { copy.cases.find((entry) => entry.case === "captain-wedge")!.observation.captainFlagged = false }, "a captain wedge that was not attributed"],
    ["not-claimed-dropped", (copy) => { copy.notClaimedEchoed = copy.notClaimedEchoed.slice(1) }, "a lane that silently dropped a NOT_CLAIMED entry"],
  ])
}
try {
  // The lane's result, persisted by `run` itself.
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  say(SLUG, "CRASH: " + crashText(error))
  process.exit(1)
}
