// w8 (t66) — THE FAULT-INJECTION FIXTURE for the team watchdog.
//
// WHAT THIS IS: the injectable, deterministic, credential-free fixture that the w9 QA
// lane drives. It is NOT the lane (`skills/**` is w9's single-writer slot this wave).
//
// ENTRY POINT (stable, documented, small — the lane imports exactly this):
//
//     import { runCase, runAll, CASES, scenarios, CLOCK } from
//       "../../../packages/mpd-team-watchdog-plugin/test/fixtures/inject.ts"
//
//     const result = await runCase("warn-90s")      // -> { case, ok, observation, lines }
//     const all    = await runAll({ print: true })  // every case, printing each observation
//
// `result.ok` is the case's own verdict; `result.observation` is structured evidence;
// `result.lines` is the human-readable observation (printed by `runAll({ print: true })`).
//
// WHAT IT DRIVES (nothing is simulated at the layer under test):
//   * the REAL adopted scheduler — `installTeamScheduler` from
//     `packages/mpd-agent-teams-plugin/lib/scheduler.ts`;
//   * the REAL watchdog plugin — its built `dist/index.js` mounted with `apply()`;
//   * the REAL halt path for the negative control — `haltTeamWork` imported from
//     `packages/mpd-agent-teams-plugin/lib/tools.ts` (the adopted mass-cancel).
// Only the HARNESS is stubbed (a ctx with a service store, an agent registry, a logger
// and a `subagents.prompt` collector) — the shape proven by the w7 driver.
//
// HOW THE FAULT IS INJECTED: this module WRITES the fault input itself — a team record,
// heartbeat JSONL stamps at controlled times, and hold records — using plain `fs`, at the
// documented on-disk shapes. The plugin's own code then reacts to it. The injector never
// reaches into the plugin's internals, and it never weakens a code path.
//
// THE CLOCK IS CONTROLLABLE (CLOCK below): every stamp carries an explicit `at`, and every
// tick is driven with an explicit `now`, so the FROZEN 90 000 ms silence threshold and the
// FROZEN 3-WARN streak are exercised in milliseconds instead of real time. The frozen
// defaults are asserted in every watchdog case (`knobs.warnSilenceMs === 90000`).
//
// HONEST LIMIT (W-3, binding): a GENUINE provider wedge is NOT reproducible here. These
// cases inject SILENCE — the absence of new heartbeats. No case may claim "a real wedge was
// caught"; every observation says `injected: "silence"`. See `NOT_CLAIMED` at the bottom.
//
// r6 ADDS A REAL-TIME PAIR (`long-tool-no-hold` / `long-tool-bound-disabled-control`):
// a GENUINE child process really burns the wall clock while the mounted row ticks through it, and
// the pre/post hooks are driven through the handlers the plugin itself registered on the harness
// event bus. Nothing about the predicate is simulated; the harness's tool registry (the caller of
// those waterfalls) is the only stubbed layer, and it is stubbed exactly as cordis calls it.
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** This file's own directory, so every path below resolves from the fixture's location. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** Repo root, resolved from this file's location (fixtures -> test -> package -> packages -> repo). */
export const REPO: string = resolve(HERE, "..", "..", "..", "..")
/** The adopted plugin's lib directory (driven, never edited). */
export const ADOPTED_LIB: string = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
/** The watchdog's built entry point (mounted, never edited). */
export const WATCHDOG_DIST: string = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")

// ── the controllable clock, and the FROZEN thresholds it exercises ──────────
/** The frozen plan defaults; every watchdog case asserts these are what ran. */
export const FROZEN: { warnSilenceMs: number; tickIntervalMs: number; warnStreakToEscalate: number; actionOnEscalate: string } = { warnSilenceMs: 90_000, tickIntervalMs: 15_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" }
/** An injected clock: `at(offset)` is the only source of timestamps in this fixture. */
export const CLOCK: { base: number; at: (offsetMs: number) => number; tick: (previousMs: number) => number } = {
  base: 1_700_000_000_000,
  at: (offsetMs) => CLOCK.base + offsetMs,
  /** One tick interval past a previous tick. */
  tick: (previousMs) => previousMs + FROZEN.tickIntervalMs,
}
/** The watchdog row config a case mounts with — the frozen set, table-driven. */
export const ROW_CONFIG: { stateDir: string; enabled: boolean; warnSilenceMs: number; tickIntervalMs: number; warnStreakToEscalate: number; actionOnEscalate: string; teamCacheMs: number; keepGenerations: number; logPrefix: string } = {
  stateDir: join(".mpd", "team"),
  enabled: true,
  warnSilenceMs: FROZEN.warnSilenceMs,
  tickIntervalMs: FROZEN.tickIntervalMs,
  warnStreakToEscalate: FROZEN.warnStreakToEscalate,
  actionOnEscalate: FROZEN.actionOnEscalate,
  teamCacheMs: 0,
  keepGenerations: 3,
  logPrefix: "watchdog-fixture",
}

/** The team id every injected record carries; the hold and scene lookups key on it. */
const TEAM = "fault-probe"
/** The captain's agent id, recorded as the team record's `captainSessionId`. */
const CAPTAIN_ID = "session-captain-fault"
/** The single worker member's agent id, the one the silence cases watch. */
const MEMBER_ID = "child-architect-fault"
/** The neighbour team's member id, used by the AC-7 blast-radius leg. */
const NEIGHBOUR_MEMBER_ID = "child-reviewer-fault"
/** The second team in the SAME workspace, which must keep dispatching while its neighbour is held. */
const NEIGHBOUR_TEAM = "fault-neighbour"
/** The neighbour member's display name, exactly as the adopted record validator reads it. */
const NEIGHBOUR_MEMBER_NAME = "Reviewer"
/** The worker member's display name; its sanitized form is the heartbeat file key. */
const MEMBER_NAME = "Architect"
/** The exact decline wording the plugin emits while a team is held (the cases filter on it). */
const WATCHDOG_HELD = "held by the team watchdog"
/** The workspace-relative watchdog state root, matching the mounted row's own config. */
const STATE_DIR = join(".mpd", "team")

// ── lazily loaded real modules (so `CASES`/`scenarios` stay import-cheap) ────
/** The real modules, imported on the first case and reused; the type is the loader's own signature. */
let modules: Awaited<ReturnType<typeof realModules>> | null = null
/** Imports the adopted lib modules and the built watchdog row once, failing loudly when one is absent. */
async function realModules(): Promise<{
  scheduler: { installTeamScheduler: (ctx: unknown, options: { stateDir: string }) => { kickTeam: (workspace: string, teamId: string, captain: unknown) => Promise<unknown>; kickMember: (workspace: string, teamId: string, memberName: string, captain: unknown) => Promise<unknown> } }
  tools: { haltTeamWork: (request: { stateRoot: string; teamId: string; captain: unknown; ctx: unknown; signal: undefined }) => Promise<{ cancelledTasks: number; alreadyHalted: boolean }> }
  adapterCtx: { createAgentTeamsCtx: (ctx: unknown, options: { witness: () => void }) => unknown }
  watchdog: {
    apply: (ctx: unknown, config: Record<string, unknown>) => {
      engine: {
        tickOnce: (now: number) => { decisions: Array<{ type: string; streak?: number; silenceMs?: number; assignee?: string; memberKey?: string; taskId?: string }>; scenes: string[]; holds: unknown[]; skipped?: string }
        getStats: () => { ticks: number; scenes: number; incidents: number; holdsApplied: number; neverStarted: number; skippedTeams: number; toolStarts: number; toolExpired: number }
        getMachineState: () => { inFlightSuppressed: number; toolExpired: number }
        knownRoots: () => string[]
        stop: () => void
      }
      knobs: { enabled: boolean; warnSilenceMs: number; warnStreakToEscalate: number }
    }
  }
}> {
  if (modules !== null) return modules
  for (const required of [join(ADOPTED_LIB, "scheduler.js"), join(ADOPTED_LIB, "tools.js"), join(ADOPTED_LIB, "mpd-adapter-ctx.js"), WATCHDOG_DIST]) {
    if (!existsSync(required)) throw new Error("fault fixture: missing " + required + " (build the plugin dist / check the checkout)")
  }
  modules = {
    scheduler: await import(join(ADOPTED_LIB, "scheduler.js")),
    tools: await import(join(ADOPTED_LIB, "tools.js")),
    // The plugin's OWN facade (mpd-owned bridge module). The halt path below is a real
    // FACADE-shaped caller of the bridge's cancel-turn seam, so the fixture must hand it the
    // surface production hands it.
    adapterCtx: await import(join(ADOPTED_LIB, "mpd-adapter-ctx.js")),
    watchdog: await import(WATCHDOG_DIST),
  }
  return modules
}

// ── harness ────────────────────────────────────────────────────────────────
/**
 * A stub harness: the ONLY simulated layer.
 *
 * `get(name, strict)` mirrors cordis's inject-free lookup; `provide` is how the watchdog
 * row publishes `mpdWatchdog`. `subagents.prompt` records every delivery so a case can
 * prove that a held team received NONE.
 */
function makeHarness(workspace: string, { liveAgentsVisible = false }: { liveAgentsVisible?: boolean } = {}): {
  ctx: typeof ctx
  captain: Record<string, unknown>
  member: Record<string, unknown>
  deliveries: Array<Record<string, unknown>>
  warnings: string[]
  debugLines: string[]
  services: Map<unknown, unknown>
  tools: Map<string, { name: string; execute: (args: unknown, exec: unknown) => Record<string, unknown> }>
  handlers: Map<string, (...args: unknown[]) => unknown>
  disposeRow: () => void
  watchdog?: unknown
  watchdogApply?: (extra: Record<string, unknown>) => unknown
} {
  /** Every delivery the plugin made through `subagents.prompt`, so a case can prove zero while held. */
  const deliveries: Array<Record<string, unknown>> = []
  /** The notice lines the plugin logged (warn and info share this channel). */
  const warnings: string[] = []
  /** The debug-channel lines, where the skip reasons are reported. */
  const debugLines: string[] = []
  /** The service store the plugin's `get`/`provide` seam reads and writes. */
  const services: Map<unknown, unknown> = new Map()
  /** The registered tool definitions, keyed by tool name. */
  const tools: Map<string, { name: string; execute: (args: unknown, exec: unknown) => Record<string, unknown> }> = new Map()
  /** The live agent registry the plugin resolves member ids against. */
  const live: Map<string, Record<string, unknown>> = new Map()
  // The event bus, recorded the way cordis dispatches it: a handler subscribed with `on` is
  // invoked as `(…args, next)` for a waterfall. Before r6 nothing subscribed, so this was a
  // no-op; the pre/post tool hooks need it, and recording instead of dropping is the smallest
  // change that makes a waterfall reachable from a case.
  const handlers: Map<string, (...args: unknown[]) => unknown> = new Map()
  // The row's `ctx.effect` cleanup, kept so a case can DISPOSE the mounted row explicitly. The
  // r6 real-time cases need this: their knobs force a 100 ms cadence (the clamp), so the row's own
  // interval would otherwise tick concurrently with the case's manual ticks and make the streak
  // arithmetic non-deterministic.
  const effects: Array<() => unknown> = []
  /** The captain agent the scheduler and the real halt path are handed. */
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } }, cancel: () => {} }
  /** The worker member agent, live in the registry the plugin lists. */
  const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
  // The AC-7 leg needs a NEIGHBOUR team with its own dispatchable member in the SAME workspace.
  const neighbour = { id: NEIGHBOUR_MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
  live.set(CAPTAIN_ID, captain)
  live.set(MEMBER_ID, member)
  live.set(NEIGHBOUR_MEMBER_ID, neighbour)
  /** The stub cordis context: the ONLY simulated layer, shaped as the plugin consumes it. */
  const ctx: {
    get: (id: string) => unknown
    provide: (id: string, value: unknown) => void
    agents: { get: (id: string) => unknown; list: () => unknown[] }
    logger: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void }
    on: (event: string, handler: (...args: unknown[]) => unknown) => () => boolean
    effect: (callback: () => unknown) => void
    inject: () => () => void
    llm: { resolveCallConfig: (request: unknown) => Promise<unknown>; listModels: () => Promise<unknown[]> }
    systemPrompt: { section: () => void }
    tools: { register: (definition: { name: string; execute: (args: unknown, exec: unknown) => Record<string, unknown> }) => () => boolean; get: (name: string) => unknown; has: (name: string) => boolean }
    subagents: { prompt: (request: { childSessionId?: string; content?: Array<{ text?: string }> }) => Promise<{ messageId: string }>; interrupt: () => void; drainContinuableChildren: () => Promise<void> }
  } = {
    get: (id) => services.get(id),
    provide: (id, value) => {
      services.set(id, value)
    },
    agents: { get: (id) => live.get(id), list: () => [] },
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(" ")),
      info: (...args) => warnings.push(args.map(String).join(" ")),
      error: () => {},
      debug: (...args) => debugLines.push(args.map(String).join(" ")),
    },
    on: (event, handler) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    effect: (callback) => {
      effects.push(callback)
    },
    inject: () => () => {},
    llm: { resolveCallConfig: async (request) => request, listModels: async () => [] },
    systemPrompt: { section: () => {} },
    tools: {
      register: (definition) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      get: (name) => tools.get(name),
      has: (name) => tools.has(name),
    },
    subagents: {
      prompt: async (request) => {
        deliveries.push({ childId: request.childSessionId, text: (request.content ?? []).map((block) => block.text).join("") })
        return { messageId: "m" + deliveries.length }
      },
      interrupt: () => {},
      drainContinuableChildren: async () => {},
    },
  }
  // `list()` is empty by default (the adopted plugin attaches to every live agent at apply and
  // these stubs carry no session log); a liveness case opts in to exposing them.
  ctx.agents.list = () => (liveAgentsVisible ? [...live.values()] : [])
  return {
    ctx,
    captain,
    member,
    deliveries,
    warnings,
    debugLines,
    services,
    tools,
    handlers,
    /** Run the mounted row's `ctx.effect` cleanups (stops its interval, disposes its listeners). */
    disposeRow: () => {
      for (const callback of effects.splice(0)) {
        try {
          /** The cleanup's return value, called when the callback hands one back. */
          const result = callback()
          if (typeof result === "function") result()
        } catch {
          // a cleanup that throws must not take the case down
        }
      }
    },
  }
}
/** The exec the member-side tools are called with (agent id plus session cwd). */
const memberExec = (workspace: string): { agent: { id: string; session: { header: { cwd: string } } } } => ({ agent: { id: MEMBER_ID, session: { header: { cwd: workspace } } } })
/** The exec a captain-side call would use; kept beside the member's for symmetry. */
const captainExec = (workspace: string): { agent: { id: string; session: { header: { cwd: string } } } } => ({ agent: { id: CAPTAIN_ID, session: { header: { cwd: workspace } } } })
/** Invokes a registered tool by name, turning a throw into an `ok:false` observation. */
const callTool = async (harness: ReturnType<typeof makeHarness>, name: string, args: Record<string, unknown>, exec: unknown): Promise<{ ok: boolean; value?: Record<string, unknown>; error?: string }> => {
  /** The registered definition for this name, absent when the row never registered it. */
  const tool = harness.tools.get(name)
  if (tool === undefined) return { ok: false, error: "tool " + name + " is not registered" }
  try {
    return { ok: true, value: await tool.execute(args, exec) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ── the r6 tool-call drivers: the harness's two waterfalls, called as cordis calls them ──
/**
 * Fire `tools/pre-execute` through the handler the mounted row registered.
 *
 * CORDIS SEMANTICS: a waterfall listener is invoked as `(…args, next)`; the adapter's wrapper
 * awaits `next()` (the rest of the chain) and returns that decision verbatim. The stub supplies
 * the same inner fallback the harness does (`{kind:'allow'}`), so the gate a case observes is
 * the gate the real registry would consume.
 */
const firePre = async (harness: ReturnType<typeof makeHarness>, exec: unknown, gate: Record<string, unknown> = { kind: "allow" }): Promise<unknown> => {
  /** The waterfall listener the mounted row registered for this event. */
  const handler = harness.handlers.get("tools/pre-execute")
  if (handler === undefined) throw new Error("the mounted row did not subscribe tools/pre-execute")
  return await handler(exec, async () => gate)
}
/** Fire `tools/post-execute` the same way (the completion half of the pair). */
const firePost = async (harness: ReturnType<typeof makeHarness>, exec: unknown, result: Record<string, unknown> = { isError: false }): Promise<unknown> => {
  /** The waterfall listener the mounted row registered for this event. */
  const handler = harness.handlers.get("tools/post-execute")
  if (handler === undefined) throw new Error("the mounted row did not subscribe tools/post-execute")
  return await handler(exec, result, async () => ({ kind: "accept" }))
}
/**
 * A REAL long-running command: a genuine child process that really burns `ms` of wall clock.
 *
 * `setTimeout` in a child of the runtime already running this fixture — no shell, no external
 * binary, no busy loop. The elapsed time is measured, never assumed, so a case can assert that
 * the call really outlived the threshold it claims to have outlived.
 */
const runRealCommand = (ms: number): Promise<{ elapsed: number; status: number | null }> =>
  new Promise((resolve) => {
    /** Wall-clock start, so the measured elapsed time is real rather than assumed. */
    const started = Date.now()
    /** The child that burns the requested wall clock; its `exit` event resolves the measurement. */
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, " + ms + ")"], { stdio: "ignore" })
    child.on("exit", (status) => resolve({ elapsed: Date.now() - started, status }))
  })
/** Resolves after the given wall-clock delay, so the ticks can be spaced. */
const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ── on-disk injection (the fault input) ────────────────────────────────────
/** The `DSH_WORKSPACE_ROOT` value in force before the first case overrode it; `null` until then. */
let previousWorkspaceRoot: string | null = null
/**
 * A fresh fixture workspace, ANNOUNCED to the plugin the way a host announces one.
 *
 * The watchdog engine resolves the workspaces it ticks over PER CALL through the adapter
 * (calling session cwd -> `DSH_WORKSPACE_ROOT` -> `process.cwd()`), and learns more from
 * the stamps it writes itself. This fixture injects stamps straight to disk instead of
 * stamping through the engine, so without the override the tick would look at the process
 * cwd rather than at the fault. `DSH_WORKSPACE_ROOT` is the sanctioned override QA uses;
 * `runCase` restores the previous value when the case ends.
 */
function newWorkspace(root: string): string {
  /** The unique scratch workspace this case injects into. */
  const workspace = join(root, "fault-" + Math.random().toString(36).slice(2, 8))
  rmSync(workspace, { recursive: true, force: true })
  mkdirSync(join(workspace, STATE_DIR, TEAM, "inbox"), { recursive: true })
  if (previousWorkspaceRoot === null) previousWorkspaceRoot = process.env.DSH_WORKSPACE_ROOT ?? ""
  process.env.DSH_WORKSPACE_ROOT = workspace
  return workspace
}
/** Puts the previous `DSH_WORKSPACE_ROOT` back, so one case cannot leak into the next. */
function restoreWorkspaceRoot(): void {
  if (previousWorkspaceRoot === null) return
  if (previousWorkspaceRoot === "") delete process.env.DSH_WORKSPACE_ROOT
  else process.env.DSH_WORKSPACE_ROOT = previousWorkspaceRoot
  previousWorkspaceRoot = null
}
/** The adopted team record's path inside a workspace. */
const teamPath = (workspace: string): string => join(workspace, STATE_DIR, TEAM, "team.json")
/** The plugin's hold sidecar path for the fixture team. */
const holdPath = (workspace: string): string => join(workspace, STATE_DIR, "watchdog", "hold", TEAM + ".json")
/** The file's sha256, so byte identity can be asserted across an operation. */
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

/** Write the adopted team record (the documented shape the real scheduler reads). */
function injectTeam(workspace: string, tasks: ReadonlyArray<{ id: string; status: string; assignee: string; attempt?: number; attemptId?: string; output?: string; handoffId?: string; subject?: string }>, { halted = false, activityAt }: { halted?: boolean; activityAt?: number } = {}): Record<string, unknown> {
  /** The record's activity stamp: the supplied one, or the frozen clock base. */
  const now = activityAt ?? CLOCK.base
  /** The record written to disk, in the shape the real scheduler reads. */
  const record = {
    id: TEAM,
    name: "Fault probe",
    description: "w8 fault-injection fixture",
    captainSessionId: CAPTAIN_ID,
    createdAt: now,
    approvedAt: now,
    phase: "running",
    taskSeq: tasks.length,
    ...(halted ? { halted: true, haltedAt: now } : {}),
    members: [
      { name: MEMBER_NAME, id: MEMBER_ID, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: now, status: "idle" },
    ],
    tasks: tasks.map((task) => ({
      id: task.id,
      subject: task.subject ?? task.id,
      assignee: task.assignee,
      dependencies: [],
      status: task.status,
      attempt: task.attempt ?? 0,
      createdAt: now,
      updatedAt: now,
      ...(task.attemptId === undefined ? {} : { attemptId: task.attemptId }),
      ...(task.output === undefined ? {} : { output: task.output }),
      ...(task.handoffId === undefined ? {} : { handoffId: task.handoffId }),
    })),
  }
  writeFileSync(teamPath(workspace), JSON.stringify(record, null, 2) + "\n")
  return record
}

/**
 * Append one heartbeat stamp at an EXPLICIT time — the silence injector.
 *
 * The JSONL shape is the one the plugin documents (`<stateDir>/watchdog/heartbeat/<key>.jsonl`,
 * one object per line with `kind|at|member|memberKey|teamId|taskId|attemptId|turnId|workspace`).
 */
function injectStamps(workspace: string, memberName: string, stamps: ReadonlyArray<{ at: number; kind?: string; taskId?: string; attemptId?: string; member?: string; tool?: string; callId?: string; ok?: boolean }>): number {
  // The heartbeat FILE KEY is the plugin's sanitized segment (`src/paths.ts` safeSegment):
  // lowercase, NFC-normalized, every non-letter/digit run folded to `-`, trimmed. The
  // injector must produce the key the reader will look for, or the fault looks like
  // "never started" instead of "silence".
  const memberKey = sanitizeKeyLikePlugin(memberName)
  /** The heartbeat directory the plugin's reader scans for this member. */
  const dir = join(workspace, STATE_DIR, "watchdog", "heartbeat")
  mkdirSync(dir, { recursive: true })
  /** One JSONL line per stamp, in the plugin's documented field order. */
  const lines = stamps.map((stamp) =>
    JSON.stringify({
      kind: stamp.kind ?? "step",
      at: stamp.at,
      member: stamp.member ?? null,
      memberKey,
      teamId: TEAM,
      taskId: stamp.taskId ?? null,
      attemptId: stamp.attemptId ?? null,
      turnId: memberKey + "#1",
      ...(stamp.tool === undefined ? {} : { tool: stamp.tool }),
      ...(stamp.callId === undefined ? {} : { callId: stamp.callId }),
      ...(stamp.ok === undefined ? {} : { ok: stamp.ok }),
      workspace,
    }),
  )
  writeFileSync(join(dir, memberKey + ".jsonl"), lines.join("\n") + "\n")
  return lines.length
}

/** The plugin's own heartbeat-file key policy (`packages/mpd-team-watchdog-plugin/src/paths.ts` safeSegment). */
export function sanitizeKeyLikePlugin(name: string): string {
  return String(name).normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

/** Mount the real watchdog row on a harness; returns its apply report (engine + knobs). */
async function mountWatchdogWith(harness: ReturnType<typeof makeHarness>, overrides: Record<string, unknown> = {}): Promise<typeof report> {
  /** The built row's mount function, the only entry point this fixture uses. */
  const { watchdog } = await realModules()
  /** What the row's `apply` returned: its engine and the knobs it actually runs with. */
  const report = watchdog.apply(harness.ctx, { ...ROW_CONFIG, ...overrides })
  harness.watchdog = report
  harness.watchdogApply = (extra) => watchdog.apply(harness.ctx, { ...ROW_CONFIG, ...overrides, ...extra })
  return report
}
/** Installs the REAL adopted scheduler on the stub ctx; the return type is derived from that module's own signature. */
async function mountScheduler(harness: ReturnType<typeof makeHarness>, workspace: string): Promise<ReturnType<Awaited<ReturnType<typeof realModules>>["scheduler"]["installTeamScheduler"]>> {
  /** The adopted scheduler module whose factory is installed. */
  const { scheduler } = await realModules()
  return scheduler.installTeamScheduler(harness.ctx, { stateDir: STATE_DIR })
}

// ── the injected scenarios, as DATA (the lane can print/record them) ────────
/**
 * Every injected scenario, as plain data: the raw input each case feeds the plugin.
 * This is what the evidence records as "the injected scenario" — nothing here is
 * generated at run time except the temp workspace path.
 */
export function scenarios(): Record<string, { team: Record<string, unknown>; injection: string; ticks: Array<{ at: string; expect: string }> }> {
  return {
    "dead-team-suppressed": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "claimed", assignee: MEMBER_NAME }] },
      injection: "a record whose newest activity is ten days old, with no live agent for it",
      ticks: [{ at: "CLOCK.base", expect: "0 decisions, 0 incidents, 0 console lines; one debug skip line naming the grace bound" }],
    },
    "live-team-never-started": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "claimed", assignee: MEMBER_NAME }] },
      injection: "the SAME stale record, but the member resolves to a LIVE agent",
      ticks: [{ at: "CLOCK.base", expect: "the team IS ticked; the never-started task is recorded once and noticed (AC-2 intact)" }],
    },
    "second-team-dispatch": {
      team: { id: TEAM + " + " + NEIGHBOUR_TEAM, phase: "running", members: [MEMBER_NAME, NEIGHBOUR_MEMBER_NAME], tasks: [{ id: "t1", status: "pending", assignee: MEMBER_NAME }, { id: "t1", status: "pending", assignee: NEIGHBOUR_MEMBER_NAME }] },
      injection: "one team is HELD through the plugin's own action; the neighbour team in the SAME workspace is untouched",
      ticks: [{ at: "the same window", expect: "0 deliveries to the held team, 1 to the neighbour; the neighbour's record moves only because it was DISPATCHED" }],
    },
    "disabled-control": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "the same silence scenario with the watchdog row DISABLED (enabled:false)",
      ticks: [{ at: "4 ticks past the frozen thresholds", expect: "no WARN, no scene, no incident, no hold; every tick skipped 'disabled'" }],
    },
    "never-started-recorded": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "claimed", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "a CLAIMED task with NO heartbeat file for its owner, ever",
      ticks: [{ at: "warnSilenceMs + 1", expect: "one never-started decision, RECORDED as an incident (kind never-started, scene null) + a notice; NO scene, NO hold" }],
    },
    "completed-turn-idle": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "three step stamps, then a `turn-end` as the NEWEST stamp; the member is never re-dispatched",
      ticks: [{ at: "> 2x warnSilenceMs after the turn end", expect: "NO decision, no scene, no incident, no hold — a completed turn is idle, not wedged" }],
    },
    "mid-turn-stall": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "the SAME shape but the newest stamp is still a `step` (the turn began and never ended)",
      ticks: [{ at: "3 ticks", expect: "warn, warn, escalate + a hold — the wedge must STILL escalate" }],
    },
    "member-stops-stepping": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "three step stamps at base+0/+1000/+2000, then NO further stamp (the turn stops stepping)",
      ticks: [{ at: "lastStamp + 89_000", expect: "no decision" }, { at: "lastStamp + 90_001", expect: "one WARN" }],
    },
    "captain-wedge": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t9", status: "in_progress", assignee: "captain", attempt: 1, attemptId: "att-cap" }, { id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "the CAPTAIN holds t9, stamps once at base, then goes silent; the member keeps stamping (not a candidate); NO agent turn is driven — only the process-level tick",
      ticks: [{ at: "base + 90_001", expect: "one WARN attributed to memberKey 'captain'" }],
    },
    "warn-90s": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "one step stamp at base, then silence; ticks at base+89_999 (below the frozen 90 000) and base+90_001 (above it)",
      ticks: [{ at: "base + 89_999", expect: "no decision" }, { at: "base + 90_001", expect: "exactly ONE WARN with a snapshot" }],
    },
    "escalate-3x": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "one step stamp at base, then three consecutive ticks at +90_001/+105_001/+120_001, then a fourth at +135_001",
      ticks: [{ at: "3 ticks", expect: "warn, warn, escalate" }, { at: "4th tick", expect: "NOTHING (no fourth WARN, no second ESCALATE)" }],
    },
    "pause-preserves": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 3, attemptId: "att-live", output: "partial result", handoffId: "handoff-1" }] },
      injection: "the hold lands through the plugin's own session-watchdog-hold action while t1 is in flight",
      ticks: [{ at: "held kick", expect: "0 deliveries, the record byte-identical" }, { at: "after session-watchdog-resume", expect: "dispatch resumes" }],
    },
    "pause-preserves-halt-control": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 3, attemptId: "att-live", output: "partial result", handoffId: "handoff-1" }] },
      injection: "the SAME fixture, but the pause is performed by the REAL adopted haltTeamWork (the mass-cancel path) — imported, not stubbed",
      ticks: [{ at: "after haltTeamWork", expect: "t1 is CANCELLED, cancelledTasks >= 1, the record CHANGED" }],
    },
    "scene-restore": {
      team: { id: TEAM, phase: "running", members: [MEMBER_NAME], tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }] },
      injection: "silence to ESCALATE, then read the scene/hold/incidents back with plain fs (a fresh-process shape)",
      ticks: [{ at: "3 ticks", expect: "a scene + a hold + 3 incidents on disk, parsed without the plugin's reader" }],
    },
  }
}

/** The case names this fixture runs, in the order the plan lists them. */
export const CASES: readonly string[] = [
  // the dead/live pair for r4, then the two LEDGER legs (AC-7's neighbour, AC-10's control),
  // then the never-started surfacing and the two BOUNDARY cases (one must NOT escalate, the other MUST).
  "dead-team-suppressed",
  "live-team-never-started",
  "second-team-dispatch",
  "disabled-control",
  "never-started-recorded",
  "completed-turn-idle",
  "mid-turn-stall",
  "member-stops-stepping",
  "captain-wedge",
  "warn-90s",
  "escalate-3x",
  "pause-preserves",
  "pause-preserves-halt-control",
  "scene-restore",
  // r6: the real long-tool pair (with its falsifier), the completed-call boundary, and the bound.
  "long-tool-no-hold",
  "long-tool-bound-disabled-control",
  "completed-tool-not-in-flight",
  "tool-inflight-expired",
]

/** The boundary pair, so a lane can assert the CONTRAST explicitly (falsifiable both ways). */
export const BOUNDARY_CASES: readonly string[] = ["completed-turn-idle", "mid-turn-stall"]

// ── cases ──────────────────────────────────────────────────────────────────
/** The lower boundary: a member whose turn stops stepping is flagged one tick past the frozen window. */
async function caseMemberStopsStepping(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  /** Three step stamps one second apart, after which the member stops stepping. */
  const stamps = [0, 1_000, 2_000].map((offset) => ({ at: CLOCK.at(offset), taskId: "t1", attemptId: "att-1" }))
  injectStamps(workspace, MEMBER_NAME, stamps)
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** The newest stamp's time, from which every later silence is measured. */
  const last = stamps[stamps.length - 1].at
  /** The tick below the frozen window; it must produce no decision. */
  const before = await report.engine.tickOnce(last + 89_000)
  /** The tick past the frozen window; it must produce exactly one. */
  const after = await report.engine.tickOnce(last + 90_001)
  report.engine.stop()
  /** How many distinct stamp times the stream really carries. */
  const distinct = new Set(stamps.map((stamp) => stamp.at)).size
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    stamps: stamps.map((stamp) => stamp.at),
    distinctStampTimes: distinct,
    lastStampAt: last,
    tickBelowThreshold: { silenceMs: 89_000, decisions: before.decisions.map((d) => d.type) },
    tickAboveThreshold: { silenceMs: 90_001, decisions: after.decisions.map((d) => d.type) },
    measuredFromLastStamp: before.decisions.length === 0 && after.decisions.length === 1,
  }
  return {
    ok: distinct === 3 && observation.measuredFromLastStamp,
    observation,
    lines: [
      "the member's turn produced 3 step stamps at " + stamps.map((s) => s.at).join(", ") + " and then stopped stepping",
      "silence is measured from the LAST stamp (" + last + ")",
      "tick at +89 000 => decisions " + JSON.stringify(before.decisions.map((d) => d.type)) + " (below the frozen 90 000 threshold)",
      "tick at +90 001 => decisions " + JSON.stringify(after.decisions.map((d) => d.type)) + " (the fault is observed)",
    ],
  }
}

/** The captain's own silence is flagged while a still-stamping member is left alone. */
async function caseCaptainWedge(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [
    { id: "t9", status: "in_progress", assignee: "captain", attempt: 1, attemptId: "att-cap" },
    { id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" },
  ])
  // The captain stamped once and went silent; the member keeps stamping, so the member is
  // NOT a silence candidate and the captain is the ONLY one the tick can flag.
  injectStamps(workspace, "captain", [{ at: CLOCK.at(0), taskId: "t9", attemptId: "att-cap" }])
  injectStamps(workspace, MEMBER_NAME, [{ at: CLOCK.at(50_000), taskId: "t1", attemptId: "att-1" }])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** The tick whose decisions name who was flaggable. */
  const tick = await report.engine.tickOnce(CLOCK.at(90_001))
  /** The `mpdWatchdog` service the row published, checked for presence. */
  const view = harness.services.get("mpdWatchdog")
  /** The tick's decisions, the case's only evidence of who was flagged. */
  const decisions = tick.decisions
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    agentTurnsDriven: 0,
    decisions: decisions.map((d) => ({ type: d.type, assignee: d.assignee, memberKey: d.memberKey, taskId: d.taskId, silenceMs: d.silenceMs })),
    captainFlagged: decisions.some((d) => d.assignee === "captain"),
    memberFlagged: decisions.some((d) => d.assignee === MEMBER_NAME),
    scenesWritten: stats.scenes,
    incidents: stats.incidents,
    holdServicePublished: view !== undefined,
  }
  return {
    ok: observation.captainFlagged && !observation.memberFlagged && observation.scenesWritten === 1 && observation.incidents === 1,
    observation,
    lines: [
      "NO agent turn was driven: nothing but the process-level tick runs (agentTurnsDriven 0)",
      "the captain's own silence is flagged: " + JSON.stringify(observation.decisions),
      "the member is untouched (its stamp at 50 000 keeps it alive): memberFlagged=" + observation.memberFlagged,
      "scene written: " + observation.scenesWritten + ", incident recorded: " + observation.incidents,
    ],
  }
}

/** The 90 s boundary pair: 89 999 ms is silent, 90 001 ms is exactly one WARN. */
async function caseWarn90s(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  injectStamps(workspace, MEMBER_NAME, [{ at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" }])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** The knobs the row actually ran with, which must be the frozen defaults. */
  const knobs = report.knobs
  /** The tick one millisecond below the frozen threshold. */
  const below = await report.engine.tickOnce(CLOCK.at(FROZEN.warnSilenceMs - 1))
  /** The tick one millisecond past it, where the WARN must land. */
  const above = await report.engine.tickOnce(CLOCK.at(FROZEN.warnSilenceMs + 1))
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The snapshot the WARN wrote, or null when none was written. */
  const scenePath = above.scenes[0] ?? null
  /** The snapshot parsed with plain fs, as a downstream reader would see it. */
  const scene = scenePath === null ? null : JSON.parse(readFileSync(scenePath, "utf8"))
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    rootsTicked: report.engine.knownRoots(),
    heartbeatFiles: readdirSafe(join(workspace, STATE_DIR, "watchdog", "heartbeat")),
    frozenKnobsUsed: { warnSilenceMs: knobs.warnSilenceMs, warnStreakToEscalate: knobs.warnStreakToEscalate },
    knobsAreTheFrozenDefaults: knobs.warnSilenceMs === FROZEN.warnSilenceMs && knobs.warnStreakToEscalate === FROZEN.warnStreakToEscalate,
    belowThreshold: { at: CLOCK.at(FROZEN.warnSilenceMs - 1), decisions: below.decisions.length },
    aboveThreshold: { at: CLOCK.at(FROZEN.warnSilenceMs + 1), warnCount: above.decisions.filter((d) => d.type === "warn").length, silenceMs: above.decisions[0]?.silenceMs ?? null },
    warnLatencyWithinThresholdPlus5s: (above.decisions[0]?.silenceMs ?? 0) <= FROZEN.warnSilenceMs + 5_000,
    snapshot: scenePath,
    snapshotFields: scene === null ? null : { schemaVersion: scene.schemaVersion, reason: scene.reason, cause: scene.cause, tasks: scene.tasks.length, members: scene.members.length },
    scenesWritten: stats.scenes,
  }
  return {
    ok:
      observation.knobsAreTheFrozenDefaults &&
      below.decisions.length === 0 &&
      observation.aboveThreshold.warnCount === 1 &&
      observation.warnLatencyWithinThresholdPlus5s &&
      scenePath !== null &&
      scene.cause.kind === "silence",
    observation,
    lines: [
      "frozen knobs used: warnSilenceMs=" + knobs.warnSilenceMs + ", warnStreakToEscalate=" + knobs.warnStreakToEscalate,
      "tick at silence " + (FROZEN.warnSilenceMs - 1) + " ms => " + below.decisions.length + " decision(s)",
      "tick at silence " + observation.aboveThreshold.silenceMs + " ms => exactly " + observation.aboveThreshold.warnCount + " WARN",
      "snapshot: " + scenePath,
      "snapshot fields: " + JSON.stringify(observation.snapshotFields),
    ],
  }
}

/** The frozen 3-consecutive-WARN streak: warn, warn, escalate, then nothing. */
async function caseEscalate3x(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  injectStamps(workspace, MEMBER_NAME, [{ at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" }])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** One reading per tick, in the order the ticks were driven. */
  const ticks: Array<{ at: number; decisions: Array<{ type: string; streak?: number; silenceMs?: number }>; scenes: number; holds: number }> = []
  for (const offset of [90_001, 105_001, 120_001, 135_001]) {
    /** The decisions, scenes and holds this tick produced. */
    const tick = await report.engine.tickOnce(CLOCK.at(offset))
    ticks.push({ at: CLOCK.at(offset), decisions: tick.decisions.map((d) => ({ type: d.type, streak: d.streak, silenceMs: d.silenceMs })), scenes: tick.scenes.length, holds: tick.holds.length })
  }
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  /** The hold record read back from disk, or null when none was written. */
  const hold = existsSync(holdPath(workspace)) ? JSON.parse(readFileSync(holdPath(workspace), "utf8")) : null
  /** The durable incident records the engine wrote, read back with plain fs. */
  const incidents = readJsonl(join(workspace, STATE_DIR, "watchdog", "incidents.jsonl"))
  // The retry control: a NEW attemptId must start a CLEAN streak (no escalation).
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 2, attemptId: "att-2" }])
  /** Stamps for the retry attempt, which must start a clean streak. */
  const retryWorkspaceStamps = injectStamps(workspace, MEMBER_NAME, [{ at: CLOCK.at(200_000), taskId: "t1", attemptId: "att-2" }])
  /** The tick after a NEW attempt id; it must not escalate. */
  const retry = await report.engine.tickOnce(CLOCK.at(200_000 + FROZEN.warnSilenceMs + 1))
  report.engine.stop()
  /** The decision types of each tick, joined so the sequence reads as one string. */
  const kinds = ticks.map((tick) => tick.decisions.map((d) => d.type).join("|"))
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    ticks,
    kinds,
    exactlyOneEscalatePerTaskAttempt: kinds[2] === "escalate" && kinds[3] === "",
    noFourthWarn: ticks[3].decisions.length === 0,
    warnPredecessorsRecordedWithSnapshots: incidents.filter((i) => i.kind === "warn").length === 2 && incidents.filter((i) => i.kind === "warn").every((i) => typeof i.scene === "string"),
    incidents: incidents.map((i) => ({ kind: i.kind, scene: i.scene, hold: i.hold })),
    hold: hold === null ? null : { id: hold.id, taskId: hold.taskId, attemptId: hold.attemptId },
    holdAppliedOnce: stats.holdsApplied === 1,
    stats: { scenes: stats.scenes, incidents: stats.incidents, holdsApplied: stats.holdsApplied },
    retryWithNewAttemptId: { stamps: retryWorkspaceStamps, decisions: retry.decisions.map((d) => ({ type: d.type, streak: d.streak })) },
  }
  return {
    ok:
      observation.exactlyOneEscalatePerTaskAttempt &&
      observation.noFourthWarn &&
      observation.warnPredecessorsRecordedWithSnapshots &&
      observation.holdAppliedOnce &&
      observation.retryWithNewAttemptId.decisions.every((d) => d.type !== "escalate"),
    observation,
    lines: [
      "tick sequence => " + JSON.stringify(kinds) + " (warn, warn, escalate, NOTHING)",
      "exactly one ESCALATE for the task+attempt, no fourth WARN: " + observation.noFourthWarn,
      "predecessors recorded as WARNs with snapshot paths: " + observation.warnPredecessorsRecordedWithSnapshots,
      "hold applied once: " + observation.holdAppliedOnce + " " + JSON.stringify(observation.hold),
      "retry with a NEW attemptId starts a clean streak: " + JSON.stringify(observation.retryWithNewAttemptId.decisions),
    ],
  }
}

/** The shared preservation fixture: an in-flight attempt + a hold that lands on it. */
async function preservationFixture(root: string): Promise<{ workspace: string; harness: ReturnType<typeof makeHarness> }> {
  /** The scratch workspace the preservation pair shares. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 3, attemptId: "att-live", output: "partial result", handoffId: "handoff-1" }])
  /** The stub harness, with the row mounted and nothing done to it yet. */
  const harness = makeHarness(workspace)
  await mountWatchdogWith(harness)
  return { workspace, harness }
}

/** The preserving pause: the hold lands while t1 is in flight and nothing about it changes. */
async function casePausePreserves(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The shared in-flight fixture: one held attempt and the harness it was mounted on. */
  const { workspace, harness } = await preservationFixture(root)
  /** The hold action's own result, which must report itself applied. */
  const held = await callTool(harness, "session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-live", cause: "silence" }, memberExec(workspace))
  /** The record's bytes while the hold is in force, before the kicks. */
  const shaWhileHeldBefore = sha(teamPath(workspace))
  /** The REAL adopted scheduler, installed so the kicks go through production dispatch. */
  const scheduler = await mountScheduler(harness, workspace)
  /** The task BEFORE the held kicks, read from disk. */
  const before = JSON.parse(readFileSync(teamPath(workspace), "utf8")).tasks[0]
  await scheduler.kickTeam(workspace, TEAM, harness.captain)
  await scheduler.kickMember(workspace, TEAM, MEMBER_NAME, harness.captain)
  /** The task AFTER the held kicks, read from disk. */
  const after = JSON.parse(readFileSync(teamPath(workspace), "utf8")).tasks[0]
  /** The record's bytes after both kicks; a hold must leave them identical. */
  const shaAfterHeldKicks = sha(teamPath(workspace))
  /** The decline lines naming the watchdog hold, one per refused dispatch. */
  const declineLines = harness.warnings.filter((line) => line.includes(WATCHDOG_HELD))
  /** The delivery count while held; the preserving pause must keep it at zero. */
  const deliveriesWhileHeld = harness.deliveries.length
  /** The resume action's own result, which must report the hold cleared. */
  const resumed = await callTool(harness, "session-watchdog-resume", { team_id: TEAM }, memberExec(workspace))
  await scheduler.kickTeam(workspace, TEAM, harness.captain)
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    holdApplied: Boolean(held.value?.applied),
    sha256UnchangedAcrossHeldKicks: shaWhileHeldBefore === shaAfterHeldKicks,
    sha256AfterResume: shaAfterHeldKicks === sha(teamPath(workspace)) ? "unchanged" : "changed (the re-arm minted the next attempt)",
    deliveriesWhileHeld,
    declineLines: declineLines.slice(0, 2),
    before: { status: before.status, attemptId: before.attemptId, attempt: before.attempt, output: before.output, handoffId: before.handoffId },
    after: { status: after.status, attemptId: after.attemptId, attempt: after.attempt, output: after.output, handoffId: after.handoffId },
    cancelled: JSON.stringify(after).includes("cancelled"),
    resumed: Boolean(resumed.value?.resumed),
    deliveriesAfterResume: harness.deliveries.length - deliveriesWhileHeld,
  }
  /** The five preserved fields plus the cancel flag, combined into one predicate. */
  const preserved =
    observation.after.status === "in_progress" &&
    observation.after.attemptId === "att-live" &&
    observation.after.attempt === 3 &&
    observation.after.output === "partial result" &&
    observation.after.handoffId === "handoff-1" &&
    !observation.cancelled
  return {
    ok:
      observation.holdApplied &&
      preserved &&
      observation.sha256UnchangedAcrossHeldKicks &&
      deliveriesWhileHeld === 0 &&
      observation.deliveriesAfterResume >= 1 &&
      declineLines.length >= 1,
    observation: { ...observation, preserved },
    lines: [
      "the hold landed through the plugin's own action while t1 was in flight: " + observation.holdApplied,
      "sha256(team.json) unchanged across the held kicks: " + observation.sha256UnchangedAcrossHeldKicks + " (after the resume it is " + observation.sha256AfterResume + ")",
      "deliveries while held: " + deliveriesWhileHeld + " (each decline says: " + (declineLines[0] ?? "n/a") + ")",
      "task after the hold: " + JSON.stringify(observation.after),
      "resume cleared the hold and dispatch resumed: " + observation.resumed + " / deliveries " + observation.deliveriesAfterResume,
    ],
  }
}

/** The CONTRAST leg: the real halt path cancels the task, so AC-17 is falsifiable. */
async function casePausePreservesHaltControl(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The shared in-flight fixture: one held attempt and the harness it was mounted on. */
  const { workspace, harness } = await preservationFixture(root)
  /** The adopted tool registry and the plugin's own facade, both real. */
  const { tools, adapterCtx } = await realModules()
  // THE REAL PATH, imported — not stubbed, not weakened. This is the adopted mass-cancel.
  if (typeof tools.haltTeamWork !== "function") {
    return { ok: false, observation: { error: "haltTeamWork is not exported by the adopted lib" }, lines: ["FATAL: the real halt path is not importable"] }
  }
  /** The record's bytes before the real halt runs. */
  const shaBefore = sha(teamPath(workspace))
  /** The task before the halt, with its in-flight attempt fields. */
  const before = JSON.parse(readFileSync(teamPath(workspace), "utf8")).tasks[0]
  /** What the adopted mass-cancel reported: how many tasks it cancelled, and whether it was already halted. */
  const result = await tools.haltTeamWork({
    stateRoot: join(workspace, STATE_DIR),
    teamId: TEAM,
    captain: harness.captain,
    // The REAL halt path reaches the harness seam through the FACADE (the adopted lib's frozen §5
    // spelling routes it via the bridge, never through the raw ctx): a hand-built RAW ctx does not
    // carry that surface, so wrap it with the plugin's OWN facade — the surface it actually gets in
    // production — instead of special-casing the caller or weakening the halt path.
    ctx: adapterCtx.createAgentTeamsCtx(harness.ctx, { witness: () => {} }),
    signal: undefined,
  })
  /** The record's bytes after the halt; they must differ. */
  const shaAfter = sha(teamPath(workspace))
  /** The team record re-read after the halt. */
  const record = JSON.parse(readFileSync(teamPath(workspace), "utf8"))
  /** The task after the halt, which the mass-cancel must have cancelled. */
  const after = record.tasks[0]
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    mechanism: "haltTeamWork (the adopted mass-cancel path), imported from packages/mpd-agent-teams-plugin/lib/tools.ts and CALLED — never stubbed",
    cancelledTasks: result.cancelledTasks,
    alreadyHalted: result.alreadyHalted,
    halted: record.halted === true,
    sha256Changed: shaBefore !== shaAfter,
    before: { status: before.status, attemptId: before.attemptId, output: before.output, handoffId: before.handoffId },
    after: { status: after.status, attemptId: after.attemptId ?? null, output: after.output, handoffId: after.handoffId ?? null },
    cancelled: after.status === "cancelled",
    wouldReddenAC17: after.status === "cancelled" && result.cancelledTasks >= 1,
  }
  return {
    ok: observation.wouldReddenAC17 && observation.sha256Changed && after.attemptId === undefined,
    observation,
    lines: [
      "the SAME fixture, paused by the REAL haltTeamWork: cancelledTasks=" + result.cancelledTasks,
      "t1: " + JSON.stringify(observation.before) + "  =>  " + JSON.stringify(observation.after),
      "sha256(team.json) CHANGED: " + observation.sha256Changed + " (this is what reddens AC-17)",
      "AC-17 is falsifiable: the wrong mechanism leaves the task cancelled with cancelledTasks >= 1",
    ],
  }
}

/** The fresh-process shape: the scene, hold and incidents are read back with plain fs. */
async function caseSceneRestore(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  injectStamps(workspace, MEMBER_NAME, [{ at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" }])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  for (const offset of [90_001, 105_001, 120_001]) await report.engine.tickOnce(CLOCK.at(offset))
  report.engine.stop()
  // Read everything back with PLAIN fs + JSON.parse: the fresh-process shape (no plugin reader).
  const sceneDir = join(workspace, STATE_DIR, "watchdog", "scene", TEAM)
  /** The newest scene snapshot, parsed without the plugin's reader. */
  const latest = JSON.parse(readFileSync(join(sceneDir, "latest.json"), "utf8"))
  /** The hold record read back from disk, or null when none was written. */
  const hold = JSON.parse(readFileSync(holdPath(workspace), "utf8"))
  /** The durable incident records the engine wrote, read back with plain fs. */
  const incidents = readJsonl(join(workspace, STATE_DIR, "watchdog", "incidents.jsonl"))
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    readWith: "plain fs + JSON.parse (no plugin reader) — the fresh-process shape",
    sceneFiles: readdirSafe(sceneDir),
    latest: { schemaVersion: latest.schemaVersion, at: latest.at, reason: latest.reason, cause: latest.cause, team: latest.team, taskCount: latest.tasks.length, memberCount: latest.members.length, parkedAttempts: latest.parkedAttempts },
    hold: { id: hold.id, since: hold.since, cause: hold.cause, taskId: hold.taskId, attemptId: hold.attemptId },
    incidents: incidents.map((i) => ({ kind: i.kind, taskId: i.taskId, attemptId: i.attemptId, scene: i.scene, hold: i.hold })),
  }
  return {
    ok: observation.latest.reason === "escalate" && observation.latest.team.hold !== null && observation.hold.id === observation.latest.team.hold.id && observation.incidents.length === 3,
    observation,
    lines: [
      "scene files on disk: " + JSON.stringify(observation.sceneFiles),
      "latest.json (parsed with plain fs): reason=" + observation.latest.reason + ", team.hold=" + JSON.stringify(observation.latest.team.hold),
      "hold record: " + JSON.stringify(observation.hold),
      "incident log: " + observation.incidents.map((i) => i.kind).join(", "),
    ],
  }
}

/** Read a JSONL file, `[]` when it is absent (a failing case must REPORT, not throw). */
function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
}


/**
 * BOUNDARY A (T69-TEST-1 / T69-ESCALATE-1): a member COMPLETES its turn (the newest stamp
 * is `turn-end`) and is not re-dispatched for far longer than 2x warnSilenceMs. A completed
 * turn is a healthy idle member, NOT a wedge: no WARN, no ESCALATE, no scene, no incident,
 * no hold — and the record is untouched.
 */
async function caseCompletedTurnIdle(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  /** Three steps and a final `turn-end`: the turn completed, so nothing more is stamped. */
  const stamps = [
    { at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" },
    { at: CLOCK.at(1_000), taskId: "t1", attemptId: "att-1" },
    { at: CLOCK.at(2_000), taskId: "t1", attemptId: "att-1" },
    // THE BOUNDARY: the turn ENDS, and nothing is stamped after it.
    { kind: "turn-end", at: CLOCK.at(2_500), taskId: "t1", attemptId: "att-1" },
  ]
  injectStamps(workspace, MEMBER_NAME, stamps)
  /** The `turn-end` time, from which every later silence is measured. */
  const last = stamps[stamps.length - 1].at
  /** The record's bytes before the ticks; an idle member must leave them untouched. */
  const shaBefore = sha(teamPath(workspace))
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  // Every tick is past the frozen threshold; the LAST one is more than 2x it.
  const ticks: Array<{ silenceMs: number; decisions: string[]; scenes: number; holds: number }> = []
  for (const offset of [FROZEN.warnSilenceMs + 1, FROZEN.warnSilenceMs * 2 + 1, FROZEN.warnSilenceMs * 3 + 1]) {
    /** The decisions, scenes and holds this tick produced. */
    const tick = await report.engine.tickOnce(last + offset)
    ticks.push({ silenceMs: offset, decisions: tick.decisions.map((d) => d.type), scenes: tick.scenes.length, holds: tick.holds.length })
  }
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    newestStampKind: "turn-end",
    ticks,
    beyondTwiceTheThreshold: ticks[1].silenceMs > FROZEN.warnSilenceMs * 2,
    decisions: ticks.flatMap((tick) => tick.decisions),
    scenesWritten: stats.scenes,
    incidents: stats.incidents,
    holdsApplied: stats.holdsApplied,
    recordByteIdentical: shaBefore === sha(teamPath(workspace)),
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok =
    observation.beyondTwiceTheThreshold &&
    observation.decisions.length === 0 &&
    observation.scenesWritten === 0 &&
    observation.incidents === 0 &&
    observation.holdsApplied === 0 &&
    observation.recordByteIdentical
  return {
    ok,
    observation,
    lines: [
      "the member COMPLETED its turn: the newest stamp for t1/att-1 is `turn-end` at " + last,
      "ticks at silence " + ticks.map((tick) => tick.silenceMs).join("/") + " ms (the last is > 2x the frozen " + FROZEN.warnSilenceMs + ")",
      "decisions: " + JSON.stringify(observation.decisions) + " — NO WARN, NO ESCALATE",
      "scenes " + observation.scenesWritten + ", incidents " + observation.incidents + ", holds " + observation.holdsApplied + ", record byte-identical: " + observation.recordByteIdentical,
      "=> a completed turn with no re-dispatch is a healthy idle member, not a wedge (T69-ESCALATE-1 fixed)",
    ],
  }
}

/**
 * BOUNDARY B (the same shape, the OTHER way): the newest stamp is a mid-turn `step`, so the
 * turn stalled WITHOUT ending. This MUST still escalate — otherwise the boundary fix would
 * have silenced the very fault the wave exists for.
 */
async function caseMidTurnStall(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  /** Three steps with NO `turn-end`: the turn began and never ended. */
  const stamps = [
    { at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" },
    { at: CLOCK.at(1_000), taskId: "t1", attemptId: "att-1" },
    // THE BOUNDARY'S OTHER SIDE: still a `step`, i.e. the turn began and never ended.
    { at: CLOCK.at(2_000), taskId: "t1", attemptId: "att-1" },
  ]
  injectStamps(workspace, MEMBER_NAME, stamps)
  /** The newest stamp's time, from which every later silence is measured. */
  const last = stamps[stamps.length - 1].at
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** One reading per tick, in the order the ticks were driven. */
  const ticks: Array<{ silenceMs: number; decisions: string[]; scenes: number; holds: number }> = []
  for (const offset of [FROZEN.warnSilenceMs + 1, FROZEN.warnSilenceMs * 2 + 1, FROZEN.warnSilenceMs * 3 + 1]) {
    /** The decisions, scenes and holds this tick produced. */
    const tick = await report.engine.tickOnce(last + offset)
    ticks.push({ silenceMs: offset, decisions: tick.decisions.map((d) => d.type), scenes: tick.scenes.length, holds: tick.holds.length })
  }
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The hold record read back from disk, or null when none was written. */
  const hold = existsSync(holdPath(workspace)) ? JSON.parse(readFileSync(holdPath(workspace), "utf8")) : null
  /** The tick sequence flattened, so warn,warn,escalate reads as one string. */
  const kinds = ticks.flatMap((tick) => tick.decisions)
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    newestStampKind: "step",
    ticks,
    decisions: kinds,
    scenesWritten: stats.scenes,
    incidents: stats.incidents,
    holdsApplied: stats.holdsApplied,
    hold: hold === null ? null : { id: hold.id, taskId: hold.taskId, attemptId: hold.attemptId },
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok = kinds.join(",") === "warn,warn,escalate" && stats.holdsApplied === 1 && observation.scenesWritten === 3
  return {
    ok,
    observation,
    lines: [
      "the member STALLED mid-turn: the newest stamp for t1/att-1 is still a `step` at " + last,
      "ticks at silence " + ticks.map((tick) => tick.silenceMs).join("/") + " ms",
      "decisions: " + JSON.stringify(kinds) + " — the wedge STILL escalates",
      "hold applied: " + stats.holdsApplied + " " + JSON.stringify(observation.hold),
      "=> the boundary fix does not silence the fault the wave exists for",
    ],
  }
}


/**
 * T69-ESCALATE-2: a CLAIMED task whose owner never stamped is a DISPATCH problem, and it now
 * takes the same durable path as a WARN — an incident record (kind `never-started`, scene
 * null) plus a notice line — while still never holding the team and never escalating.
 */
async function caseNeverStartedRecorded(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "claimed", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  // NO heartbeat file for the owner at all: it never picked the task up.
  const shaBefore = sha(teamPath(workspace))
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** The decisions, scenes and holds this tick produced. */
  const tick = await report.engine.tickOnce(CLOCK.at(FROZEN.warnSilenceMs + 1))
  /** The next tick, which must repeat nothing. */
  const second = await report.engine.tickOnce(CLOCK.at(FROZEN.warnSilenceMs * 2 + 1))
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The durable incident records the engine wrote, read back with plain fs. */
  const incidents = readJsonl(join(workspace, STATE_DIR, "watchdog", "incidents.jsonl"))
  /** The NEVER-STARTED notice lines, which must exist exactly once. */
  const notices = harness.warnings.filter((line) => line.includes("NEVER-STARTED"))
  /** The durable record for the never-started task, or null when none was written. */
  const neverStartedIncident = incidents.find((incident) => incident.kind === "never-started") ?? null
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "no heartbeat ever written for the claimed task",
    decisions: tick.decisions.map((d) => d.type),
    decisionsOnSecondTick: second.decisions.map((d) => d.type),
    incidents: incidents.map((incident) => ({ kind: incident.kind, taskId: incident.taskId, attemptId: incident.attemptId, scene: incident.scene, hold: incident.hold })),
    recordedKind: neverStartedIncident === null ? null : neverStartedIncident.kind,
    recordedSceneIsNull: neverStartedIncident !== null && neverStartedIncident.scene === null,
    noticeLines: notices,
    noticeIsNotOnlyALogLine: neverStartedIncident !== null && notices.length === 1,
    scenesWritten: stats.scenes,
    holdsApplied: stats.holdsApplied,
    neverStartedCounted: stats.neverStarted,
    recordByteIdentical: shaBefore === sha(teamPath(workspace)),
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok =
    observation.recordedKind === "never-started" &&
    observation.recordedSceneIsNull &&
    observation.noticeLines.length === 1 &&
    observation.decisionsOnSecondTick.length === 0 &&
    observation.scenesWritten === 0 &&
    observation.holdsApplied === 0 &&
    observation.recordByteIdentical
  return {
    ok,
    observation,
    lines: [
      "the claimed task was never picked up: no heartbeat file exists for its owner",
      "tick => " + JSON.stringify(observation.decisions) + " (recorded once; the second tick repeats nothing: " + JSON.stringify(observation.decisionsOnSecondTick) + ")",
      "durable incident: " + JSON.stringify(observation.incidents),
      "notice: " + (notices[0] ?? "(none)"),
      "no scene (" + observation.scenesWritten + "), no hold (" + observation.holdsApplied + "), record byte-identical: " + observation.recordByteIdentical,
      "=> T69-ESCALATE-2: the dispatch problem is now RECORDED and NOTICED, not silent — while still never pausing the team",
    ],
  }
}


/**
 * AC-7's missing leg: the SECOND, untouched team in the SAME workspace keeps dispatching through
 * the window in which its neighbour is held. Without this the hold's blast radius is asserted from
 * one team only, and "team-scoped" is taken on trust.
 */
async function caseSecondTeamDispatch(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  // The held team, and a NEIGHBOUR with its own member and its own ready task.
  injectTeam(workspace, [{ id: "t1", status: "pending", assignee: MEMBER_NAME }])
  /** The neighbour team's directory, written by hand because no engine dispatched it. */
  const neighbourDir = join(workspace, STATE_DIR, NEIGHBOUR_TEAM)
  mkdirSync(join(neighbourDir, "inbox"), { recursive: true })
  writeFileSync(
    join(neighbourDir, "team.json"),
    JSON.stringify(
      {
        id: NEIGHBOUR_TEAM,
        name: "Neighbour",
        captainSessionId: CAPTAIN_ID,
        phase: "running",
        createdAt: CLOCK.base,
        approvedAt: CLOCK.base,
        taskSeq: 1,
        // `joinedAt` is REQUIRED by the adopted record validator (isTeamMember), so the
        // hand-written neighbour record must carry it or readTeam rejects the whole record.
        members: [{ name: NEIGHBOUR_MEMBER_NAME, id: NEIGHBOUR_MEMBER_ID, role: "worker", status: "idle", joinedAt: CLOCK.base }],
        tasks: [{ id: "t1", subject: "neighbour work", assignee: NEIGHBOUR_MEMBER_NAME, dependencies: [], status: "pending", attempt: 0, createdAt: CLOCK.base, updatedAt: CLOCK.base }],
      },
      null,
      2,
    ) + "\n",
  )
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  await mountWatchdogWith(harness)
  /** The REAL scheduler, so both teams are kicked through production dispatch. */
  const scheduler = await mountScheduler(harness, workspace)

  // Hold ONLY the first team, through the plugin's own action.
  const held = await callTool(harness, "session-watchdog-hold", { team_id: TEAM, task_id: "t1", cause: "silence" }, memberExec(workspace))
  /** The neighbour's record path, whose bytes must not change. */
  const neighbourTeamFile = join(neighbourDir, "team.json")
  /** The neighbour's bytes before the shared window's kicks. */
  const neighbourShaBefore = sha(neighbourTeamFile)

  // The SAME window: kick the held team, then its neighbour.
  await scheduler.kickTeam(workspace, TEAM, harness.captain)
  /** Deliveries made to the held team in the shared window. */
  const deliveriesToHeld = harness.deliveries.length
  await scheduler.kickTeam(workspace, NEIGHBOUR_TEAM, harness.captain)
  /** Deliveries made to the neighbour in the SAME window. */
  const deliveriesToNeighbour = harness.deliveries.length - deliveriesToHeld

  /** The decline lines produced by the held team's refused dispatch. */
  const declineLines = harness.warnings.filter((line) => line.includes(WATCHDOG_HELD))
  /** The neighbour's record after the window, which the hold must not have touched. */
  const neighbourRecord = JSON.parse(readFileSync(neighbourTeamFile, "utf8"))
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence",
    holdApplied: Boolean(held.value?.applied),
    holdsOnDisk: readdirSafe(join(workspace, STATE_DIR, "watchdog", "hold")),
    deliveriesToHeldTeam: deliveriesToHeld,
    deliveriesToNeighbourTeam: deliveriesToNeighbour,
    heldTeamDeclined: declineLines.some((line) => line.includes(TEAM)),
    declineLines,
    neighbourRecordByteIdentical: neighbourShaBefore === sha(neighbourTeamFile),
    neighbourTaskStatus: neighbourRecord.tasks[0].status,
    neighbourHalted: neighbourRecord.halted === true,
  }
  // The neighbour's record DID change — because it was DISPATCHED (the task moved to `claimed`),
  // which is the point: the hold moved nothing for it.
  const ok =
    observation.holdApplied === true &&
    observation.deliveriesToHeldTeam === 0 &&
    observation.deliveriesToNeighbourTeam === 1 &&
    observation.heldTeamDeclined === true &&
    observation.neighbourTaskStatus === "claimed" &&
    observation.neighbourHalted === false
  return {
    ok,
    observation,
    lines: [
      "team " + TEAM + " is HELD through the plugin's own action: " + observation.holdApplied + " (holds on disk: " + JSON.stringify(observation.holdsOnDisk) + ")",
      "deliveries in the same window — held team: " + observation.deliveriesToHeldTeam + ", NEIGHBOUR team: " + observation.deliveriesToNeighbourTeam,
      "the held team's decline: " + (observation.declineLines[0] ?? "(none)"),
      "the neighbour kept dispatching: task status " + observation.neighbourTaskStatus + ", halted=" + observation.neighbourHalted,
      "=> the hold is TEAM-scoped: a neighbour in the same workspace is untouched (AC-7)",
    ],
  }
}

/**
 * AC-10's missing leg at the FIXTURE level: the whole scenario with the watchdog DISABLED produces
 * no WARN, no scene and no hold. The engine-level control exists in the package suite; this is the
 * harness-level one the ledger records as missing.
 */
async function caseDisabledControl(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  injectStamps(workspace, MEMBER_NAME, [{ at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" }])
  /** The record's bytes before the disabled row's ticks. */
  const shaBefore = sha(teamPath(workspace))
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness, { enabled: false })
  /** One reading per tick, in the order the ticks were driven. */
  const ticks: Array<{ silenceMs: number; skipped: string | null; decisions: string[]; scenes: number; holds: number }> = []
  for (const offset of [FROZEN.warnSilenceMs + 1, FROZEN.warnSilenceMs * 2 + 1, FROZEN.warnSilenceMs * 3 + 1, FROZEN.warnSilenceMs * 4 + 1]) {
    /** What this tick did, including the `skipped` reason a disabled row reports. */
    const tick = await report.engine.tickOnce(CLOCK.at(offset))
    ticks.push({ silenceMs: offset, skipped: tick.skipped ?? null, decisions: tick.decisions.map((d) => d.type), scenes: tick.scenes.length, holds: tick.holds.length })
  }
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The watchdog state root, checked for the artifacts a disabled row must not create. */
  const watchdogRoot = join(workspace, STATE_DIR, "watchdog")
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "silence, watchdog DISABLED (row config enabled:false)",
    knobsEnabled: report.knobs.enabled,
    ticks,
    everyTickSkippedDisabled: ticks.every((tick) => tick.skipped === "disabled" && tick.decisions.length === 0),
    stats: { ticks: stats.ticks, scenes: stats.scenes, incidents: stats.incidents, holdsApplied: stats.holdsApplied, neverStarted: stats.neverStarted },
    sceneDirExists: existsSync(join(watchdogRoot, "scene")),
    holdDirContents: readdirSafe(join(watchdogRoot, "hold")),
    incidentsFileExists: existsSync(join(watchdogRoot, "incidents.jsonl")),
    heartbeatStillWritten: readdirSafe(join(watchdogRoot, "heartbeat")).length,
    recordByteIdentical: shaBefore === sha(teamPath(workspace)),
  }
  return {
    ok:
      observation.knobsEnabled === false &&
      observation.everyTickSkippedDisabled &&
      observation.stats.scenes === 0 &&
      observation.stats.incidents === 0 &&
      observation.stats.holdsApplied === 0 &&
      observation.sceneDirExists === false &&
      observation.holdDirContents.length === 0 &&
      observation.incidentsFileExists === false &&
      observation.recordByteIdentical === true,
    observation,
    lines: [
      "the watchdog row is DISABLED (knobs.enabled=" + observation.knobsEnabled + "): every tick reports skipped=" + JSON.stringify(ticks.map((t) => t.skipped)),
      "no WARN, no ESCALATE: " + JSON.stringify(ticks.map((t) => t.decisions)),
      "scenes " + observation.stats.scenes + ", incidents " + observation.stats.incidents + ", holds " + observation.stats.holdsApplied,
      "on disk: scene dir exists=" + observation.sceneDirExists + ", holds=" + JSON.stringify(observation.holdDirContents) + ", incidents file=" + observation.incidentsFileExists,
      "the team record is byte-identical: " + observation.recordByteIdentical,
      "=> the negative control is falsifiable at the FIXTURE level (AC-10)",
    ],
  }
}


/**
 * r4 — A DEAD RECORD IS SILENT. A team whose record nobody has touched for days (and whose
 * sessions are not in the live registry) produces no never-started observation, no incident and NO
 * console line; the skip is visible on the debug channel with its reason. `console.log` is captured
 * around the tick so the assertion is about what the USER would have seen, not about a source grep.
 */
async function caseDeadTeamSuppressed(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  /** Ten days before the frozen base: a record nobody has touched. */
  const STALE = CLOCK.base - 10 * 24 * 60 * 60 * 1000 // ten days untouched
  injectTeam(workspace, [{ id: "t1", status: "claimed", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }], { activityAt: STALE })
  // A stamp ten days old as well, so the task WOULD warn if the team were ticked: this case proves
  // the gate holds the WARN/ESCALATE path too, not only the never-started branch.
  injectStamps(workspace, MEMBER_NAME, [{ at: STALE, taskId: "t1", attemptId: "att-1" }])
  /** The harness with no live agents, so the freshness fallback is what decides. */
  const harness = makeHarness(workspace) // no live agents visible -> the freshness fallback decides
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** The console lines the tick emitted, captured because the USER must see none. */
  const captured: string[] = []
  /** The real `console.log`, restored in a `finally` even when the tick throws. */
  const originalLog = console.log
  console.log = (...args) => captured.push(args.map(String).join(" "))
  /** The tick under test, taken inside the console capture. */
  let tick: ReturnType<typeof report.engine.tickOnce>
  try {
    tick = await report.engine.tickOnce(CLOCK.base)
  } finally {
    console.log = originalLog
  }
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The durable incident records the engine wrote, read back with plain fs. */
  const incidents = readJsonl(join(workspace, STATE_DIR, "watchdog", "incidents.jsonl"))
  // THE FALSIFIER: the SAME stale record with the bound DISABLED (0) is ticked and DOES warn —
  // so the silence above is the gate's doing, not a vacuous fixture.
  const unbounded = makeHarness(workspace)
  /** The falsifier's mount: the SAME record with the dead-team grace bound disabled. */
  const unboundedReport = await mountWatchdogWith(unbounded, { deadTeamGraceMs: 0 })
  /** The falsifier's tick, which must warn where the bounded run stayed silent. */
  const unboundedTick = await unboundedReport.engine.tickOnce(CLOCK.base)
  unboundedReport.engine.stop()
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "a record ten days stale (with a ten-day-old stamp), no live agent for it",
    boundDisabledWouldWarn: unboundedTick.decisions.map((d) => d.type),
    boundDisabledSkippedTeams: unboundedReport.engine.getStats().skippedTeams,
    recordActivityAgeMs: CLOCK.base - STALE,
    decisions: tick.decisions.map((d) => d.type),
    decisionsRecorded: incidents.map((i) => i.kind),
    scenesWritten: stats.scenes,
    holdsApplied: stats.holdsApplied,
    neverStartedCounted: stats.neverStarted,
    skippedTeams: stats.skippedTeams,
    consoleLinesEmitted: captured,
    debugLines: harness.debugLines.filter((line) => line.includes("skip")),
  }
  return {
    ok:
      observation.decisions.length === 0 &&
      observation.decisionsRecorded.length === 0 &&
      observation.scenesWritten === 0 &&
      observation.holdsApplied === 0 &&
      observation.neverStartedCounted === 0 &&
      observation.skippedTeams === 1 &&
      observation.consoleLinesEmitted.length === 0 &&
      observation.debugLines.length >= 1 &&
      observation.boundDisabledWouldWarn.join(",") === "warn" &&
      observation.boundDisabledSkippedTeams === 0,
    observation,
    lines: [
      "the record's newest activity is " + observation.recordActivityAgeMs + " ms old (ten days) and no live agent exists for it",
      "decisions " + JSON.stringify(observation.decisions) + " · incidents " + JSON.stringify(observation.decisionsRecorded) + " · scenes " + observation.scenesWritten + " · holds " + observation.holdsApplied,
      "CONSOLE lines emitted during the tick: " + JSON.stringify(observation.consoleLinesEmitted) + " (silent to the user)",
      "debug channel: " + JSON.stringify(observation.debugLines),
      "FALSIFIER: with the bound disabled (deadTeamGraceMs 0) the SAME record is ticked and warns: " + JSON.stringify(observation.boundDisabledWouldWarn) + " — so the silence above is the gate, not a vacuous fixture",
      "=> a dead record is skipped, not reported, on EVERY decision path (r4)",
    ],
  }
}

/**
 * r4 — THE LIVE CASE STILL WORKS, through the LIVE-AGENT signal: the team's member IS in the live
 * registry, so the team is ticked even though its record is stale, and a genuinely never-started
 * task is still recorded once and replayable (AC-2's path is not muted).
 */
async function caseLiveTeamNeverStarted(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  /** Ten days before the frozen base, so only the live-agent signal keeps the team ticked. */
  const STALE = CLOCK.base - 10 * 24 * 60 * 60 * 1000
  injectTeam(workspace, [{ id: "t1", status: "claimed", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }], { activityAt: STALE })
  /** The harness with the member exposed as a live agent. */
  const harness = makeHarness(workspace, { liveAgentsVisible: true }) // the member resolves LIVE
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** The decisions, scenes and holds this tick produced. */
  const tick = await report.engine.tickOnce(CLOCK.base)
  /** The next tick, which must repeat nothing. */
  const second = await report.engine.tickOnce(CLOCK.base + 1)
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  report.engine.stop()
  /** The durable incident records the engine wrote, read back with plain fs. */
  const incidents = readJsonl(join(workspace, STATE_DIR, "watchdog", "incidents.jsonl"))
  /** The never-started records, of which exactly one is expected. */
  const neverStarted = incidents.filter((incident) => incident.kind === "never-started")
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "a stale record whose member IS live, with a claimed task that never stamped",
    recordActivityAgeMs: CLOCK.base - STALE,
    skippedTeams: stats.skippedTeams,
    neverStartedCounted: stats.neverStarted,
    warnDecisions: [...tick.decisions, ...second.decisions].map((d) => d.type),
    incidents: neverStarted.map((incident) => ({ kind: incident.kind, taskId: incident.taskId, scene: incident.scene, hold: incident.hold })),
    notices: harness.warnings.filter((line) => line.includes("NEVER-STARTED")).length,
    debugLines: harness.debugLines.filter((line) => line.includes("skip")),
  }
  return {
    ok:
      observation.skippedTeams === 0 &&
      observation.neverStartedCounted === 1 &&
      neverStarted.length === 1 &&
      neverStarted[0].taskId === "t1" &&
      observation.notices === 1 &&
      observation.warnDecisions.length === 0,
    observation,
    lines: [
      "the record is STALE (ten days) but its member resolves to a LIVE agent, so the team IS ticked (skippedTeams " + observation.skippedTeams + ")",
      "a claimed task that never stamped is still recorded ONCE: " + JSON.stringify(observation.incidents) + " with " + observation.notices + " notice line(s)",
      "no WARN/ESCALATE was manufactured: " + JSON.stringify(observation.warnDecisions),
      "debug skip lines (expected none): " + JSON.stringify(observation.debugLines),
      "=> AC-2's never-started record path is intact (r4)",
    ],
  }
}

/**
 * r6, THE ORIGINAL SCENARIO. A member inside ONE long tool call must produce NO WARN, NO ESCALATE
 * and NO HOLD — before r6 this exact shape PAUSED our own team.
 *
 * REAL: the child process really runs for `LONG.commandMs` wall-clock ms, the ticks land inside
 * it, the pre/post hooks are the handlers the mounted row registered on the event bus, and the
 * stamps are written by the plugin's own engine to its own JSONL store.
 * MODELLED: only the harness's tool registry (the caller of the waterfall).
 */
const LONG = { warnSilenceMs: 300, tickIntervalMs: 100, toolInFlightMaxMs: 5_000, commandMs: 1_600, tickWaits: [400, 400, 400] }

/** Drives the r6 long-tool shape once: a REAL command, the real hooks, and manual ticks driven inside it. */
async function longToolScenario(root: string, { boundDisabled }: { boundDisabled: boolean }): Promise<{
  workspace: string
  harness: ReturnType<typeof makeHarness>
  report: typeof report
  gate: typeof gate
  closed: typeof closed
  command: { elapsed: number; status: number | null }
  ticks: typeof ticks
  kinds: typeof kinds
  stats: typeof stats
  machine: typeof machine
  hold: { id: string; taskId: string; attemptId?: string } | null
  stampedKinds: unknown[]
  lastStampKinds: unknown[]
}> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  // The record's newest activity is NOW (the ticks below use the real clock), so the r4 liveness
  // gate cannot skip it — this case is about silence, not about dead teams.
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }], { activityAt: Date.now() })
  // The member's last REAL stamp: a `step` two silence windows old, so every tick below would
  // WARN on the pre-r6 rules — the in-flight rule is the ONLY thing that can explain it away.
  const opened = Date.now()
  injectStamps(workspace, MEMBER_NAME, [{ at: opened - LONG.warnSilenceMs * 2, taskId: "t1", attemptId: "att-1" }])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness, {
    warnSilenceMs: LONG.warnSilenceMs,
    tickIntervalMs: LONG.tickIntervalMs,
    ...(boundDisabled ? { toolInFlightMaxMs: 0 } : { toolInFlightMaxMs: LONG.toolInFlightMaxMs }),
  })
  /** The tool exec of the call that stays open across the ticks. */
  const exec = { name: "bash", callId: "call-lane-1", agent: { id: MEMBER_ID, session: { header: { cwd: workspace } } } }
  // The harness's gate: the observe-only hook must pass it AND open the call.
  const gate = await firePre(harness, exec)
  /** The heartbeat stamps the pre hook wrote, read back from the member's JSONL file. */
  const stampsAfterPre = readJsonl(join(workspace, STATE_DIR, "watchdog", "heartbeat", sanitizeKeyLikePlugin(MEMBER_NAME) + ".jsonl"))
  // Take the handlers, then DISPOSE the row: the case's knobs force a 100 ms cadence (the clamp),
  // so the row's own interval must not race the manual ticks below. The captured handlers stay
  // callable (the disposer only removes them from the bus).
  const preHandler = harness.handlers.get("tools/pre-execute")
  /** The completion hook the row registered; the pre hook above proved the row subscribed, and a missing handler would be a harness bug this case must crash on. */
  const postHandler = harness.handlers.get("tools/post-execute")!
  harness.disposeRow()
  /** The real command, started but not awaited, so the ticks land inside it. */
  const running = runRealCommand(LONG.commandMs)
  /** One reading per tick, in the order the ticks were driven. */
  const ticks: Array<{ silenceFromLastStamp: number; decisions: string[]; scenes: number; holds: number }> = []
  for (const wait of LONG.tickWaits) {
    await sleepMs(wait)
    /** The real clock reading this tick is driven with. */
    const now = Date.now()
    /** The decisions, scenes and holds this tick produced. */
    const tick = await report.engine.tickOnce(now)
    ticks.push({ silenceFromLastStamp: now - opened, decisions: tick.decisions.map((d) => d.type), scenes: tick.scenes.length, holds: tick.holds.length })
  }
  /** The measured command result: real elapsed ms and the child's exit status. */
  const command = await running
  /** What the completion hook returned; only its presence matters here. */
  const closed = await postHandler(exec, { isError: false, value: { ok: true } }, async () => ({ kind: "accept" }))
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  /** The machine's in-flight bookkeeping, where a suppression would show up. */
  const machine = report.engine.getMachineState()
  /** The hold record read back from disk, or null when none was written. */
  const hold = existsSync(holdPath(workspace)) ? JSON.parse(readFileSync(holdPath(workspace), "utf8")) : null
  report.engine.stop()
  /** The decision types of each tick, joined so the sequence reads as one string. */
  const kinds = ticks.map((tick) => tick.decisions.join("|"))
  return {
    workspace,
    harness,
    report,
    gate,
    closed,
    command,
    ticks,
    kinds,
    stats,
    machine,
    hold,
    stampedKinds: stampsAfterPre.map((stamp) => stamp.kind),
    lastStampKinds: readJsonl(join(workspace, STATE_DIR, "watchdog", "heartbeat", sanitizeKeyLikePlugin(MEMBER_NAME) + ".jsonl")).map((stamp) => stamp.kind),
  }
}

/** The r6 fix: a member inside ONE long real tool call produces no WARN and no hold. */
async function caseLongToolNoHold(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The shared r6 scenario, with the in-flight bound in force. */
  const run = await longToolScenario(root, { boundDisabled: false })
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "a REAL 1.6 s command inside ONE tool call, with the member's last stamp 2 windows old",
    hammeredWith: "the frozen arithmetic, at " + LONG.warnSilenceMs + " ms per window",
    reproduced: "the r6 defect: before the fix this SAME shape escalated and PAUSED our own team",
    gatePassedThrough: run.gate,
    realCommand: { elapsedMs: run.command.elapsed, exitStatus: run.command.status },
    ticks: run.ticks,
    kinds: run.kinds,
    silenceMsAtLastTick: run.ticks[run.ticks.length - 1].silenceFromLastStamp,
    beyondThreeWindows: run.ticks[run.ticks.length - 1].silenceFromLastStamp > LONG.warnSilenceMs * 3,
    stampWrittenByThePreHook: run.stampedKinds,
    stampStreamAfterCompletion: run.lastStampKinds,
    inFlightSuppressed: run.machine.inFlightSuppressed,
    stats: { holdsApplied: run.stats.holdsApplied, scenes: run.stats.scenes, incidents: run.stats.incidents, toolStarts: run.stats.toolStarts },
    hold: run.hold === null ? null : { id: run.hold.id, taskId: run.hold.taskId },
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok =
    observation.realCommand.elapsedMs >= 1_200 &&
    observation.beyondThreeWindows === true &&
    observation.ticks.every((tick) => tick.decisions.length === 0) &&
    observation.stats.holdsApplied === 0 &&
    observation.stats.scenes === 0 &&
    observation.stats.incidents === 0 &&
    observation.hold === null &&
    observation.stampWrittenByThePreHook.join(",") === "step,tool-start" &&
    observation.stampStreamAfterCompletion.join(",") === "step,tool-start,tool" &&
    observation.inFlightSuppressed >= 3
  return {
    ok,
    observation,
    lines: [
      "a REAL command ran " + observation.realCommand.elapsedMs + " ms (exit " + observation.realCommand.exitStatus + ") inside ONE tool call",
      "the pre hook stamped " + JSON.stringify(observation.stampWrittenByThePreHook) + " and the POST closed it: " + JSON.stringify(observation.stampStreamAfterCompletion),
      "ticks (silence from the member's last real stamp => decisions): " + JSON.stringify(observation.ticks.map((tick) => [tick.silenceFromLastStamp, tick.decisions])),
      "the LAST tick is " + observation.silenceMsAtLastTick + " ms past the last stamp, i.e. beyond 3 windows (" + LONG.warnSilenceMs * 3 + " ms): " + observation.beyondThreeWindows,
      "WARNs/ESCALATEs/holds/scenes/incidents: " + JSON.stringify(observation.stats) + " — hold file: " + String(observation.hold),
      "observations the in-flight rule explained away: " + observation.inFlightSuppressed,
      "=> r6: a member working inside a long tool call is NO LONGER PAUSED",
    ],
  }
}

/**
 * THE FALSIFIER for the case above: the SAME fixture, the SAME real command, the SAME ticks, with
 * `toolInFlightMaxMs: 0` (the pre-r6 behaviour). It MUST escalate and hold, or the silence in
 * `long-tool-no-hold` would be vacuous rather than earned.
 */
async function caseLongToolBoundDisabled(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The SAME scenario with `toolInFlightMaxMs: 0`, the pre-r6 behaviour. */
  const run = await longToolScenario(root, { boundDisabled: true })
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "the SAME real 1.6 s tool call, with the r6 in-flight bound DISABLED (toolInFlightMaxMs: 0)",
    gatePassedThrough: run.gate,
    realCommand: { elapsedMs: run.command.elapsed, exitStatus: run.command.status },
    ticks: run.ticks,
    kinds: run.kinds,
    stampWrittenByThePreHook: run.stampedKinds,
    inFlightSuppressed: run.machine.inFlightSuppressed,
    stats: { holdsApplied: run.stats.holdsApplied, scenes: run.stats.scenes },
    hold: run.hold === null ? null : { id: run.hold.id, taskId: run.hold.taskId, attemptId: run.hold.attemptId },
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok =
    observation.kinds.join(",") === "warn,warn,escalate" &&
    observation.stats.holdsApplied === 1 &&
    observation.hold !== null &&
    observation.hold.taskId === "t1" &&
    observation.inFlightSuppressed === 0
  return {
    ok,
    observation,
    lines: [
      "the pre hook STILL stamps tool-start (" + JSON.stringify(observation.stampWrittenByThePreHook) + ") — the rule is what is disabled, not the observation",
      "ticks => " + JSON.stringify(observation.kinds) + " (warn, warn, escalate) and a hold: " + JSON.stringify(observation.hold),
      "=> FALSIFIER: with the bound disabled the same scenario holds the team, so the silence in `long-tool-no-hold` is the RULE, not a vacuous fixture",
    ],
  }
}

/**
 * The other side of the boundary: a tool call that COMPLETED is not in flight. A member that
 * finished a tool and then went silent must still WARN and ESCALATE — otherwise "a tool was used"
 * would silently become a permission to wedge.
 */
async function caseCompletedToolNotInFlight(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  injectStamps(workspace, MEMBER_NAME, [
    { at: CLOCK.at(0), taskId: "t1", attemptId: "att-1" },
    { kind: "tool-start", tool: "bash", callId: "call-done-1", at: CLOCK.at(1_000), taskId: "t1", attemptId: "att-1" },
    // …and its completion 20 s later: the call is CLOSED, so nothing is in flight.
    { kind: "tool", tool: "bash", callId: "call-done-1", ok: true, at: CLOCK.at(21_000), taskId: "t1", attemptId: "att-1" },
  ])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness)
  /** One reading per tick, in the order the ticks were driven. */
  const ticks: Array<{ decisions: string[]; holds: number }> = []
  for (const offset of [21_000 + FROZEN.warnSilenceMs + 1, 21_000 + FROZEN.warnSilenceMs * 2 + 1, 21_000 + FROZEN.warnSilenceMs * 3 + 1]) {
    /** The decisions and holds this tick produced. */
    const tick = await report.engine.tickOnce(CLOCK.at(offset))
    ticks.push({ decisions: tick.decisions.map((d) => d.type), holds: tick.holds.length })
  }
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  /** The machine's in-flight bookkeeping, where a suppression would show up. */
  const machine = report.engine.getMachineState()
  /** The hold record read back from disk, or null when none was written. */
  const hold = existsSync(holdPath(workspace)) ? JSON.parse(readFileSync(holdPath(workspace), "utf8")) : null
  report.engine.stop()
  /** The decision types of each tick, joined so the sequence reads as one string. */
  const kinds = ticks.map((tick) => tick.decisions.join("|"))
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "a tool-start PAIRED with its tool completion (the call is closed), then silence",
    kinds,
    inFlightSuppressed: machine.inFlightSuppressed,
    stats: { holdsApplied: stats.holdsApplied, scenes: stats.scenes },
    hold: hold === null ? null : { id: hold.id, taskId: hold.taskId },
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok = observation.kinds.join(",") === "warn,warn,escalate" && observation.stats.holdsApplied === 1 && observation.inFlightSuppressed === 0
  return {
    ok,
    observation,
    lines: [
      "the newest stamp is the COMPLETION of call-done-1, so nothing is in flight",
      "ticks => " + JSON.stringify(observation.kinds) + " + a hold: " + JSON.stringify(observation.hold),
      "=> a completed tool call buys no silence: the wedge rule still fires (in-flight suppressions: " + observation.inFlightSuppressed + ")",
    ],
  }
}

/**
 * THE BOUND (r6's honest half): a PRE stamp whose POST never arrives (a killed tool, a pipeline
 * failure, a process that died mid-call) must not leave the member unwatchable forever. Past
 * `toolInFlightMaxMs` the entry stops suppressing and is recorded ONCE — a WARN-class incident,
 * never a scene, never a hold, never an escalate.
 */
async function caseToolInFlightExpired(root: string): Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The scratch workspace this case injects into and ticks. */
  const workspace = newWorkspace(root)
  injectTeam(workspace, [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }])
  injectStamps(workspace, MEMBER_NAME, [
    { at: CLOCK.base - 10_000, taskId: "t1", attemptId: "att-1" },
    // An OPEN call: no completion stamp for this callId exists anywhere.
    { kind: "tool-start", tool: "bash", callId: "call-killed-1", at: CLOCK.base, taskId: "t1", attemptId: "att-1" },
  ])
  /** The stub harness the real row is mounted on. */
  const harness = makeHarness(workspace)
  /** What the row reported when it was mounted: its engine and its knobs. */
  const report = await mountWatchdogWith(harness, { toolInFlightMaxMs: 600 })
  /** The tick inside the 600 ms bound, where the open call still explains the silence. */
  const inside = await report.engine.tickOnce(CLOCK.at(500))
  /** The tick past the bound, where the entry must stop suppressing and be reported once. */
  const expired = await report.engine.tickOnce(CLOCK.at(700))
  /** A much later tick, which must add no second report. */
  const repeated = await report.engine.tickOnce(CLOCK.at(60_000))
  /** The engine's counters as of this point in the case. */
  const stats = report.engine.getStats()
  /** The machine's in-flight bookkeeping, where a suppression would show up. */
  const machine = report.engine.getMachineState()
  report.engine.stop()
  /** The durable incident records the engine wrote, read back with plain fs. */
  const incidents = readJsonl(join(workspace, STATE_DIR, "watchdog", "incidents.jsonl"))
  /** The hold record read back from disk, or null when none was written. */
  const hold = existsSync(holdPath(workspace)) ? JSON.parse(readFileSync(holdPath(workspace), "utf8")) : null
  /** The structured evidence this case returns, one field per asserted reading. */
  const observation = {
    injected: "a `tool-start` with NO completion at all, bound toolInFlightMaxMs=600",
    insideBound: { decisions: inside.decisions.map((d) => d.type), holds: inside.holds.length },
    pastBound: { decisions: expired.decisions.map((d) => d.type), scenes: expired.scenes.length, holds: expired.holds.length },
    incidentCount: incidents.length,
    incidents: incidents.map((incident) => ({ kind: incident.kind, taskId: incident.taskId, attemptId: incident.attemptId, scene: incident.scene, hold: incident.hold, cause: incident.cause })),
    noRepeatOnALaterTick: incidents.length === 1,
    toolExpiredReports: stats.toolExpired,
    stats: { holdsApplied: stats.holdsApplied, scenes: stats.scenes, toolStarts: stats.toolStarts },
    machine: { toolExpired: machine.toolExpired, inFlightSuppressed: machine.inFlightSuppressed },
    hold: hold === null ? null : { id: hold.id },
  }
  /** The case's own verdict, computed only from the observation above. */
  const ok =
    observation.insideBound.decisions.length === 0 &&
    observation.insideBound.holds === 0 &&
    observation.pastBound.decisions.length === 0 &&
    observation.pastBound.scenes === 0 &&
    observation.pastBound.holds === 0 &&
    observation.incidentCount === 1 &&
    observation.incidents[0].kind === "tool-expired" &&
    observation.incidents[0].scene === null &&
    observation.incidents[0].hold === "not-requested" &&
    observation.toolExpiredReports === 1 &&
    observation.hold === null
  return {
    ok,
    observation,
    lines: [
      "inside the bound (500 ms): " + JSON.stringify(observation.insideBound) + " — still explained activity",
      "past the bound (700 ms > 600 ms): " + JSON.stringify(observation.pastBound) + " — the entry STOPS suppressing",
      "durable report: " + JSON.stringify(observation.incidents),
      "reported ONCE (a later tick at 60 s adds nothing): " + observation.noRepeatOnALaterTick,
      "holds/scenes: " + JSON.stringify(observation.stats) + " hold file: " + String(observation.hold),
      "=> the handover is bounded and fail-open: a killed tool can never leave a member permanently un-watchable, and the bound never PAUSES a team",
    ],
  }
}

/** Lists a directory, sorted, and answers `[]` instead of throwing when it is absent. */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

/** The case name to runner map; an unknown name resolves to `undefined` and is reported. */
const RUNNERS: Record<string, ((root: string) => Promise<{ ok: boolean; observation: Record<string, unknown>; lines: string[] }>) | undefined> = {
  "dead-team-suppressed": caseDeadTeamSuppressed,
  "live-team-never-started": caseLiveTeamNeverStarted,
  "second-team-dispatch": caseSecondTeamDispatch,
  "disabled-control": caseDisabledControl,
  "never-started-recorded": caseNeverStartedRecorded,
  "completed-turn-idle": caseCompletedTurnIdle,
  "mid-turn-stall": caseMidTurnStall,
  "member-stops-stepping": caseMemberStopsStepping,
  "captain-wedge": caseCaptainWedge,
  "warn-90s": caseWarn90s,
  "escalate-3x": caseEscalate3x,
  "pause-preserves": casePausePreserves,
  "pause-preserves-halt-control": casePausePreservesHaltControl,
  "scene-restore": caseSceneRestore,
  "long-tool-no-hold": caseLongToolNoHold,
  "long-tool-bound-disabled-control": caseLongToolBoundDisabled,
  "completed-tool-not-in-flight": caseCompletedToolNotInFlight,
  "tool-inflight-expired": caseToolInFlightExpired,
}

// ── the public entry points ────────────────────────────────────────────────
/**
 * Run ONE named case.
 *
 * @param name - one of {@link CASES}.
 * @param options - `{ root }` for the scratch workspace, `{ print }` to echo the observation.
 * @returns `{ case, ok, observation, lines }`; `ok:false` for a failed case or an unknown name.
 */
export async function runCase(name: string, options: { root?: string; print?: boolean } = {}): Promise<{ case: string; ok: boolean; observation: Record<string, unknown>; lines: string[] }> {
  /** The runner for this name, absent when the name is unknown. */
  const runner = RUNNERS[name]
  if (runner === undefined) {
    return { case: name, ok: false, observation: { error: "unknown case", known: CASES }, lines: ["unknown case " + name + " (known: " + CASES.join(", ") + ")"] }
  }
  /** The scratch root: the caller's, or the system temp directory. */
  const root = options.root ?? (await import("node:os")).tmpdir()
  mkdirSync(root, { recursive: true })
  /** The case's outcome, or a failed one when the runner threw. */
  let outcome: { ok: boolean; observation: Record<string, unknown>; lines: string[] }
  try {
    outcome = await runner(root)
  } catch (error) {
    // A lane must SEE a failed case, never crash on it.
    outcome = { ok: false, observation: { threw: error instanceof Error ? error.message : String(error) }, lines: ["case threw: " + (error instanceof Error ? error.message : String(error))] }
  } finally {
    restoreWorkspaceRoot()
  }
  /** The stable public result shape every consumer sees. */
  const result = { case: name, ok: outcome.ok === true, observation: outcome.observation, lines: outcome.lines }
  if (options.print !== false) {
    for (const line of result.lines) console.log("[" + name + "] " + line)
  }
  return result
}

/**
 * Run every case in the plan's order.
 *
 * @param options - `{ root, print }`; `print` defaults to true here.
 * @returns the array of case results.
 */
export async function runAll(options: { root?: string; print?: boolean } = {}): Promise<Array<{ case: string; ok: boolean; observation: Record<string, unknown>; lines: string[] }>> {
  /** Every case's result, in the plan's order. */
  const results: Array<{ case: string; ok: boolean; observation: Record<string, unknown>; lines: string[] }> = []
  for (const name of CASES) results.push(await runCase(name, { print: options.print !== false, root: options.root }))
  return results
}

// ── honest limits (W-3, binding) ───────────────────────────────────────────
/** The limits every consumer of this fixture must repeat. */
export const NOT_CLAIMED: readonly string[] = [
  "W-3: a GENUINE provider wedge is not reproducible here. Every case injects SILENCE (the absence of new heartbeats); no case may claim that a real wedge was caught.",
  "The harness is stubbed (ctx services, agents, subagents, logger). The scheduler, the watchdog engine/machine/store and the halt path are the REAL modules; the surrounding host is not.",
  "No live dsh host, no model credential, no network: the fixture never boots a session.",
  "`haltTeamWork` cancels; the fixture does not claim that the halt path is ever the RIGHT mechanism — it exists to show that AC-17 goes RED when the pause is built on it.",
]
