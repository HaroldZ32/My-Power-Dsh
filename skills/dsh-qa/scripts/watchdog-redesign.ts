#!/usr/bin/env bun
// Case watchdog-redesign — FROZEN CONTRACT §9: the RED→GREEN driver for rows (a)–(f).
//
// The contract's §9 table is the whole subject: every row is an assertion that FAILS on
// `.mpd/red-baseline` (detached `75018a1`, no `channel.ts`) and PASSES on the working tree
// AFTER the redesign. This lane drives BOTH trees' OWN modules through the SAME scenario and
// an injected clock, and prints a per-row `red`/`green` verdict:
//
//   (a) a member streaming a long answer, no tool call, 10+ min  → no warn, no hold (ALIVE)
//   (b) a member whose open tasks are all dependency-blocked      → no warn, no hold (PARKED)
//   (c) a terminal `update_task` while a hold exists              → it SUCCEEDS on GREEN and is
//                                                                   REFUSED on RED
//   (d) an OUTSTANDING request with no response                   → first warn at the tree's own
//                                                                   `warnSilenceMs`, escalate per
//                                                                   the ladder (never a hold when
//                                                                   `actionOnEscalate` is warn-only)
//   (e) a tool call past `toolInFlightMaxMs`                      → exactly ONE `tool-expired`, no
//                                                                   hold — a PIN: the contract's own
//                                                                   RED column says r6 was already
//                                                                   green, so a red reading here is
//                                                                   the anomaly, not the goal
//   (f) zero attempts / only a pre-`createdAt` stamp              → never holdable
//
// Plus contract §9 item 3: the RECORDED INCIDENTS are replayed through each tree's own machine,
// reporting how many of the historical escalations the new predicate would produce. The replay
// is a labelled RECONSTRUCTION (the recorded rows carry no channel state), so its count is an
// UPPER BOUND, never "the recorded run replayed" — see `replay.bound` in the result.
//
// Argument-driven by design (t24 acceptance 3): `--red <tree>` / `--green <tree>` / `--out <dir>`
// are explicit, and this lane NEVER writes into another task's evidence path: the default output
// is a fresh `<repo>/evidence/team-watchdog/redesign/lane/<timestamp>/` and an EXISTING `--out`
// is refused with exit code 3 (T-53, the same class this wave fixes).
//
// Prerequisites: `bun` (the trees' TS sources are imported directly) and a built
// `.mpd/red-baseline` worktree. The RED pin is asserted from the contract's frozen hashes.
//
// Usage:
//   bun skills/dsh-qa/scripts/watchdog-redesign.ts --self-test
//   bun skills/dsh-qa/scripts/watchdog-redesign.ts --help
//   bun skills/dsh-qa/scripts/watchdog-redesign.ts [--red <tree>] [--green <tree>] [--row a,c]
//                                                    [--out <dir>] [--settle-ms <ms>] [--list] [--json]
// Evidence -> evidence/team-watchdog/redesign/lane/<timestamp>/{result.json,output.log,raw/}
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ImmutableOutputError, exitOnRefusal, refuseOverwrite, timestamp } from "./lib/immutable-output.ts"
import { REPO, captureStdout, finish, say, selfTest, sha256, writeEvidence, type LaneCheck, type LaneResult, type LaneVerdict, type StubEventHandler, type StubToolDefinition, type StdoutCapture } from "./lib/watchdog-lane.ts"

/** The lane slug, printed as every line's prefix and used in the evidence directory name. */
const SLUG: string = "watchdog-redesign"
/** The adopted team state dir, relative to a sandbox workspace. */
const STATE_DIR: string = join(".mpd", "team")
/** The watchdog plugin's directory, relative to a tree root. */
const PLUGIN: string = join("packages", "mpd-team-watchdog-plugin")
/** The adopted agent-teams plugin's lib directory, relative to a tree root. */
const ADOPTED_LIB: string = join("packages", "mpd-agent-teams-plugin", "lib")
/** Where this lane's evidence directories are created by default. */
const EVIDENCE_BASE: string = join(REPO, "evidence", "team-watchdog", "redesign", "lane")
/** The detached RED worktree the contrast rows are measured against. */
const RED_ROOT: string = join(REPO, ".mpd", "red-baseline")
/** The recorded incident log contract §9 item 3 replays. */
const INCIDENTS: string = join(REPO, ".mpd", "team", "watchdog", "incidents.jsonl")
/** The session reference the stub emits every scripted event for (the engine folds by session id). */
const SESSION: SessionRef = { id: "a1" }
/** The refusal sentence the hold guard carries, matched to tell a hold refusal from any other error. */
const GUARD_TEXT: string = "is held by the team watchdog"

/** One session reference the stub emits scripted events for. */
interface SessionRef {
  /** The harness session id the engine folds events by. */
  readonly id: string
}

/** The fields of the contract's frozen legacy hash table (A2) that this lane compares. */
interface ContractHashes {
  /** `src/machine.ts`'s sha256 on the detached RED commit. */
  readonly machine: string
  /** `src/engine.ts`'s sha256 on the detached RED commit. */
  readonly engine: string
  /** The adopted `lib/tools.ts` sha256 the RED tree (detached `75018a1`) ships — `.js`, not `.ts`. */
  readonly tools: string
}

/** The contract's frozen legacy hashes (A2) — the RED tree must reproduce ALL of them. */
const CONTRACT_RED: ContractHashes = {
  machine: "fc10fc41f404d79457660403f9645483fe123e588df6bfe5b8b55c4b8728c1ef",
  engine: "f529ca2cdef498eca8b60c441824aa5ab898689bc60c3c81ffc7da063f49281b",
  tools: "49025f4d9901fb2599f42bbb5233ead2a71837a65f51e1d6d95c567c002422d2",
}

/** The §3 predicate knobs one tree reports; every field a tree omits reads as `undefined`. */
interface KnobTuple {
  /** The silence window in milliseconds that earns the first warn. */
  warnSilenceMs?: number
  /** How many consecutive observations escalate after the first warn. */
  warnStreakToEscalate?: number
  /** What an escalation does: `pause` (legacy) or `warn-only` (§3). */
  actionOnEscalate?: string
  /** Any further knob the tree reports (never compared by the KNOBS check). */
  [extra: string]: unknown
}

/** The two knob tuples the contract names, one per tree. */
interface ContractKnobs {
  /** The legacy tuple the RED tree must still report. */
  readonly red: KnobTuple
  /** The redesigned tuple the working tree must report. */
  readonly green: KnobTuple
}

/** §3: the frozen numbers the redesign must run with. */
const CONTRACT_KNOBS: ContractKnobs = { red: { warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" }, green: { warnSilenceMs: 600_000, warnStreakToEscalate: 6, actionOnEscalate: "warn-only" } }

/** The §9 row ids, in the order the contract's table names them. */
const ROW_IDS: readonly string[] = ["a", "b", "c", "d", "e", "f", "g"]
/** `pin` = the contract expects the same reading on both trees (§9 row e). */
const ROW_KIND: Record<string, string> = { a: "contrast", b: "contrast", c: "contrast", d: "contrast", e: "pin", f: "contrast", g: "contrast" }
/** Rows whose GREEN reading is decided by the channel fold (must show `predicateSource: channel`). */
const ROW_FOLD: Record<string, boolean> = { a: true, b: true, d: true }

/** The two sides a row is judged on: the pinned RED tree and the tree under test. */
type Side = "red" | "green"

/**
 * The value of a `--name <value>` or `--name=<value>` shell argument.
 * @param argv The argv tail to scan.
 * @param name The flag name, including its leading dashes.
 * @param fallback The value returned when the flag is absent; `null` marks "no default given".
 * @returns The flag's value, or the fallback when the flag is absent or carries no value.
 */
const shellArg = <T extends string | null>(argv: readonly string[], name: string, fallback: T): string | T => {
  // The position of the `--name` flag, or -1 when it was not spelled as a separate argument.
  const at = argv.indexOf(name)
  if (at >= 0 && typeof argv[at + 1] === "string" && !argv[at + 1].startsWith("--")) return argv[at + 1]
  // The `--name=value` spelling, when the flag was not given as a separate argument.
  const eq = argv.find((item) => item.startsWith(name + "="))
  return eq === undefined ? fallback : eq.slice(name.length + 1)
}
/**
 * @param path Absolute path of the file to fingerprint.
 * @returns The file's lowercase hex sha256, or `(absent)` when the path does not exist.
 */
const fileSha = (path: string): string => (existsSync(path) ? sha256(readFileSync(path)) : "(absent)")
/**
 * Fold a row list into one count per extracted key.
 * @param rows The rows to count.
 * @param of The key extractor; a row whose key is absent counts under the literal key `"undefined"`.
 * @returns One count per distinct key.
 */
const countBy = <T>(rows: readonly T[], of: (row: T) => string | undefined): Record<string, number> =>
  rows.reduce<Record<string, number>>((all: Record<string, number>, row: T): Record<string, number> => {
    // The key this row is counted under.
    const key = String(of(row))
    all[key] = (all[key] ?? 0) + 1
    return all
  }, {})
/**
 * @param row One recorded incident.
 * @returns The `team|task|attempt` identity the escalation sets are keyed by.
 */
const incidentKey = (row: IncidentRow): string => row.teamId + "|" + row.taskId + "|" + (row.attemptId ?? "")

/** One recorded incident row, as the append-only incident log stores it (only the fields the replay reads). */
interface IncidentRow {
  /** The record kind (`warn`, `escalate`, …). */
  readonly kind: string
  /** The instant the incident was recorded, in epoch milliseconds. */
  readonly at: number
  /** The team the incident belongs to. */
  readonly teamId: string
  /** The task the incident observed. */
  readonly taskId: string
  /** The generation token of that task; absent when the board carried none. */
  readonly attemptId?: string
  /** Whether the escalation applied a hold (`applied`), when the row records it. */
  readonly hold?: string
  /** Why the predicate fired, with the measured silence in milliseconds. */
  readonly cause?: { readonly kind: string; readonly ms: number }
}

/** A silence row whose measured silence the replay subtracts from its instant. */
interface SilenceRow extends IncidentRow {
  /** The measured silence, proven a number by the filter that selects these rows. */
  readonly cause: { readonly kind: string; readonly ms: number }
}

/** One file family's fingerprint inside a tree; `(absent)` marks a file the tree does not ship. */
interface TreeFingerprints {
  /** `src/machine.ts`'s digest. */
  machine: string
  /** `src/engine.ts`'s digest. */
  engine: string
  /** `src/channel.ts`'s digest — `(absent)` on the legacy generation. */
  channel: string
  /** `src/team.ts`'s digest. */
  team: string
  /** `dist/index.js`'s digest. */
  dist: string
  /** The adopted tools module's digest, in the `.ts`/`.js` spelling that tree ships. */
  tools: string
}

/**
 * The adopted plugin's tools module inside one tree, spelled the way THAT tree ships it.
 * The GREEN tree carries the converted `lib/tools.ts`; the frozen RED worktree (detached
 * `75018a1`) predates that rename and still ships `lib/tools.ts` — and the contract pins the
 * bytes of THAT file (`CONTRACT_RED.tools` == sha256 of `75018a1:lib/tools.ts`) — so the
 * extension is PROBED rather than hardcoded, which keeps ONE path expression correct on both
 * sides of the contrast.
 * @param root Absolute path of the tree.
 * @returns The absolute path of the tools module the tree ships, preferring the converted `.ts`.
 */
function adoptedToolsFile(root: string): string {
  /** The converted spelling the tree under test carries. */
  const converted: string = join(root, ADOPTED_LIB, "tools.ts")
  return existsSync(converted) ? converted : join(root, ADOPTED_LIB, "tools.js")
}

/**
 * @param root Absolute path of the tree to fingerprint.
 * @returns One sha256 (or `(absent)`) per source file the contract pins.
 */
function fingerprint(root: string): TreeFingerprints {
  return {
    machine: fileSha(join(root, PLUGIN, "src", "machine.ts")),
    engine: fileSha(join(root, PLUGIN, "src", "engine.ts")),
    channel: fileSha(join(root, PLUGIN, "src", "channel.ts")),
    team: fileSha(join(root, PLUGIN, "src", "team.ts")),
    dist: fileSha(join(root, PLUGIN, "dist", "index.js")),
    tools: fileSha(adoptedToolsFile(root)),
  }
}

/** The predicate knobs a tree's machine ships; only the knobs this lane configures are named. */
interface WatchdogKnobs {
  /** The kill switch the engine is configured with. */
  readonly enabled: boolean
  /** The silence window in milliseconds that earns the first warn. */
  readonly warnSilenceMs: number
  /** The tick cadence in milliseconds; must stay below `warnSilenceMs`. */
  readonly tickIntervalMs: number
  /** Consecutive observations for one task+attempt before ESCALATE. */
  readonly warnStreakToEscalate: number
  /** What ESCALATE does: `pause` (persist a hold) or `warn-only`. */
  readonly actionOnEscalate: string
  /** The hold TTL in milliseconds; absent on a tree whose knobs carry no TTL. */
  readonly holdTtlMs?: number
  /** The in-flight tool bound in milliseconds (r6); `0` disables the suppression. */
  readonly toolInFlightMaxMs: number
}

/** One decision the fold returned, as the replay counts it. */
interface MachineDecision {
  /** The decision kind (`warn`, `escalate`, `never-started`, `tool-expired`). */
  readonly type: string
}

/** One candidate the incident replay feeds the predicate. */
interface ReplayCandidate {
  /** The team the reconstructed candidate belongs to. */
  readonly teamId: string
  /** The task the reconstructed candidate observes. */
  readonly taskId: string
  /** The generation token the recorded row carried, or the empty string. */
  readonly attemptId: string
  /** The reconstructed owner name (the rows carry no assignee). */
  readonly assignee: string
  /** The reconstructed heartbeat file key. */
  readonly memberKey: string
  /** The newest stamp for this task+attempt, in epoch milliseconds. */
  readonly lastSeen: number
  /** The kind of that newest stamp. */
  readonly lastKind: string
  /** Whether any stamp for this task+attempt was ever written. */
  readonly everStampedForTask: boolean
  /** An unmatched PRE stamp's instant, or `null` when no call was in flight. */
  readonly inFlightSince: number | null
  /** The tool the unmatched PRE stamp named, or `null`. */
  readonly inFlightTool: string | null
  /** The reconstructed channel state: `OUTSTANDING` for the pessimistic arm, `null` for §4. */
  readonly channelState: string | null
  /** The instant the reconstructed request went outstanding, present on the pessimistic arm. */
  readonly outstandingSince?: number
  /** Whether the candidate is fed through the §4 report-only fallback. */
  readonly heartbeatFallback?: boolean
}

/** One machine instance, as the incident replay drives it. */
interface WatchdogMachine {
  /**
   * @param candidates The candidate window fed to the predicate.
   * @param at The evaluation instant, in epoch milliseconds.
   * @param knobs The knobs the tree's own defaults supply.
   * @returns The decisions the predicate produced, in candidate order.
   */
  observe(candidates: readonly ReplayCandidate[], at: number, knobs: WatchdogKnobs): MachineDecision[]
}

/** The machine module surface this lane consumes from one tree. */
interface MachineModule {
  /** The predicate defaults the tree ships — the §3 knobs are PROBED here, never assumed. */
  readonly WATCHDOG_DEFAULTS: WatchdogKnobs
  /** The fold's constructor, driven one recorded row at a time. */
  readonly WatchdogMachine: new () => WatchdogMachine
}

/** The engine instance surface this lane drives. */
interface WatchdogEngineInstance {
  /** @returns One disposer per event subscription the engine installed. */
  install(): Array<() => void>
  /**
   * @param at The instant to evaluate the store at, in epoch milliseconds.
   * @returns The decisions and the holds that tick produced.
   */
  tickOnce(at: number): Promise<EngineTick>
  /** The channel-fold provenance probe, present only on the fold generation. */
  predicateStatus?: () => PredicateStatus
  /** The engine's own counters, present only on the fold generation. */
  getStats?: () => EngineStats
  /** Stop the engine's timers. */
  stop(): void
}

/** One tick's result, as far as this lane reads it. */
interface EngineTick {
  /** The WARN/ESCALATE decisions the tick produced. */
  readonly decisions: MachineDecision[]
  /** Team ids this tick put under a preserving hold. */
  readonly holds: readonly string[]
}

/** The engine module surface this lane consumes from one tree. */
interface EngineModule {
  /** The engine constructor: the adapter double, the row ctx and the row config. */
  readonly WatchdogEngine: new (adapter: StubAdapter, ctx: EngineContext, config: EngineConfig) => WatchdogEngineInstance
}

/** The context the engine is constructed with: one event subscription plus the row logger. */
interface EngineContext {
  /**
   * @param event The harness event name to subscribe to.
   * @param handler The listener the engine installs.
   * @returns The disposer that removes the listener.
   */
  on(event: string, handler: StubEventHandler): () => void
  /** The logger the engine reports through; this lane deliberately drops every line. */
  logger: {
    /** A warning line. */
    warn(...args: unknown[]): void
    /** An informational line. */
    info(...args: unknown[]): void
    /** An error line. */
    error(...args: unknown[]): void
  }
}

/** The row config the engine is constructed with: the §3 knobs plus this lane's sandbox overrides. */
interface EngineConfig {
  /** The state dir, relative to the workspace (`<ws>/.mpd/team`). */
  readonly stateDir: string
  /** The kill switch. */
  readonly enabled: boolean
  /** The silence window in milliseconds. */
  readonly warnSilenceMs: number
  /** The tick cadence in milliseconds. */
  readonly tickIntervalMs: number
  /** Consecutive observations for one task+attempt before ESCALATE. */
  readonly warnStreakToEscalate: number
  /** What ESCALATE does. */
  readonly actionOnEscalate: string
  /** The hold TTL in milliseconds; `0` disables the TTL. */
  readonly holdTtlMs: number
  /** How long a parsed team record is reused, in milliseconds; `0` disables the cache. */
  readonly teamCacheMs: number
  /** How many heartbeat generations are kept. */
  readonly keepGenerations: number
  /** How long a dead team is tolerated, in milliseconds. */
  readonly deadTeamGraceMs: number
  /** The in-flight tool bound in milliseconds (r6). */
  readonly toolInFlightMaxMs: number
  /** Whether skipped ticks are logged verbosely. */
  readonly verboseSkips: boolean
  /** The log line prefix. */
  readonly logPrefix: string
}

/** The predicate's provenance, as the fold generation reports it (only the fields this lane reads). */
interface PredicateStatus {
  /** `channel` = the fold is the authority; `heartbeat` = the §4 report-only fallback. */
  readonly source: string
  /** The current channel state per known session id. */
  readonly states: Record<string, string>
}

/** The engine counters this lane's judges read; the engine's non-numeric fields are never read here. */
interface EngineStats {
  /** `tool-expired` reports recorded (r6's secondary bound fired). */
  toolExpired?: number
  /** Preserving holds persisted through the pause action. */
  holdsApplied?: number
  /** `never-started` observations recorded. */
  neverStarted?: number
  /** Members reported PARKED because every open task waits on an unfinished dependency. */
  channelDependencyBlocked?: number
  /** Any further numeric counter the engine reports. */
  [counter: string]: number | undefined
}

/** The paths module surface this lane consumes from one tree. */
interface PathsModule {
  /**
   * @param workspace Absolute path of the workspace the store lives in.
   * @param stateDir The relative state dir.
   * @param memberKey The member whose heartbeat log is wanted.
   * @returns Absolute path of that member's heartbeat JSONL.
   */
  heartbeatPath(workspace: string, stateDir: string, memberKey: string): string
}

/** The watchdog modules `loadTree` imported from one tree, plus the generation it probed. */
interface LoadedTree {
  /** The tree's label (`red` or `green`), used in sandbox names and printed lines. */
  readonly label: string
  /** The tree's absolute root. */
  readonly root: string
  /** `fold` when the tree ships a `channel.ts` (the redesigned generation), else `legacy`. */
  readonly generation: string
  /** The tree's own machine module. */
  readonly machine: MachineModule
  /** The tree's own engine module. */
  readonly engine: EngineModule
  /** The tree's own paths module. */
  readonly paths: PathsModule
  /** The tree's own channel module, or `null` on a tree that has none. */
  readonly channel: Record<string, unknown> | null
  /** The knobs the tree's machine ships. */
  readonly defaults: WatchdogKnobs
}

/** Load one tree's OWN watchdog modules. The generation is PROBED, never a hardcoded flag. */
async function loadTree(root: string, label: string): Promise<LoadedTree> {
  // The tree's watchdog source directory, which every module below is imported from.
  const src = join(root, PLUGIN, "src")
  // The tree's own machine module. The path is computed at runtime, so the module's shape is
  // asserted here: the probe below decides which generation the tree is.
  const machine = await import(pathToFileURL(join(src, "machine.ts")).href) as MachineModule
  // The tree's own engine module.
  const engine = await import(pathToFileURL(join(src, "engine.ts")).href) as EngineModule
  // The tree's own paths module.
  const paths = await import(pathToFileURL(join(src, "paths.ts")).href) as PathsModule
  // Whether the tree ships the channel module the fold generation is recognised by.
  const hasChannel = existsSync(join(src, "channel.ts"))
  // The tree's own channel module, loaded only when the tree actually has one.
  const channel = hasChannel ? await import(pathToFileURL(join(src, "channel.ts")).href) as Record<string, unknown> : null
  return { label, root, generation: hasChannel ? "fold" : "legacy", machine, engine, paths, channel, defaults: machine.WATCHDOG_DEFAULTS }
}

/** A tool definition as the stub registry stores it: the shared stub shape plus the executable entry. */
interface RegisteredTool extends StubToolDefinition {
  /**
   * @param args The tool arguments.
   * @param exec The per-call context: the agent the call is made as.
   * @returns The tool's value.
   */
  execute(args: Record<string, unknown>, exec: { agent: unknown }): Promise<unknown>
}

/** The adapter double the engine is constructed with: only the seams this lane's arm touches. */
interface StubAdapter {
  /** @returns The workspace root the engine resolves its state from. */
  workspaceRoot(): string
  /** @returns Every live workspace root; this lane serves one sandbox. */
  workspaceRootsAll(): string[]
  /** @returns The settings reader the engine probes (empty in this lane). */
  settingsReader(): { get(): unknown; describe(): unknown }
  /** @returns The settings-document subscription disposer. */
  onSettingsDocumentUpdated(): () => void
  /**
   * @param definition The tool definition to register.
   * @returns The disposer that removes it.
   */
  registerTool(definition: RegisteredTool): () => boolean
  /** @returns The pre-tool-execute subscription disposer. */
  onPreToolExecute(): () => void
  /** @returns The post-tool-execute subscription disposer. */
  onPostToolExecute(): () => void
  /**
   * @param event The event name to subscribe to.
   * @param handler The listener to install.
   * @returns The disposer that removes the listener.
   */
  onEvent(event: string, handler: StubEventHandler): () => void
  /** @returns The tool runtime the engine resolves definitions through. */
  toolRuntime(): { get(name: string): RegisteredTool | undefined; execute(...args: unknown[]): Promise<undefined> }
  /** @returns The adapter's capability flags (none claimed in this lane). */
  capabilities(): Record<string, unknown>
}

/** The stub harness `stubAdapter` returns: the adapter double plus the levers that fire events. */
interface StubHandle {
  /** The adapter double the engine is constructed with. */
  readonly adapter: StubAdapter
  /**
   * Fire a captured event the way the host would.
   * @param event The event name to fire.
   * @param payload The arguments the host would pass.
   * @returns How many listeners were invoked.
   */
  emit(event: string, ...payload: unknown[]): number
  /**
   * @param event The event name to count listeners for.
   * @returns How many listeners are installed for that event.
   */
  listenerCount(event: string): number
}

/** The stub adapter: the only harness surface the engine uses (the shape the family's tests use). */
function stubAdapter(workspace: string): StubHandle {
  // Every tool definition the mounted engine registered, by name.
  const tools: Map<string, RegisteredTool> = new Map()
  // Every captured event listener, keyed by the event it subscribed to.
  const listeners: Map<string, StubEventHandler[]> = new Map()
  return {
    adapter: {
      workspaceRoot: () => workspace,
      workspaceRootsAll: () => [workspace],
      settingsReader: () => ({ get: () => undefined, describe: () => undefined }),
      onSettingsDocumentUpdated: () => () => {},
      registerTool: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) },
      onPreToolExecute: () => () => {},
      onPostToolExecute: () => () => {},
      onEvent: (event, handler) => {
        // The listener list for this event, created on its first subscription.
        const list = listeners.get(event) ?? []
        list.push(handler)
        listeners.set(event, list)
        return () => {
          // The handler's position in that list, or -1 when it has already been removed.
          const index = list.indexOf(handler)
          if (index >= 0) list.splice(index, 1)
        }
      },
      toolRuntime: () => ({ get: (name) => tools.get(name), execute: async () => undefined }),
      capabilities: () => ({}),
    },
    emit: (event, ...payload) => {
      // How many listeners this emission actually invoked.
      let called = 0
      for (const handler of listeners.get(event) ?? []) { handler(...payload); called += 1 }
      return called
    },
    listenerCount: (event) => (listeners.get(event) ?? []).length,
  }
}

/** One synthetic engine event, in the shape `stub.emit` forwards to the engine's listeners. */
interface SyntheticEvent {
  /** The event type the engine switches on. */
  readonly type: string
  /** The per-session sequence number (always 1 in this lane). */
  readonly seq: number
  /** The instant the event happened, in epoch milliseconds. */
  readonly time: number
  /** The event's own payload. */
  readonly data: Record<string, unknown>
}

/**
 * @param type The event type.
 * @param data The event payload.
 * @param time The instant the event happened, in epoch milliseconds.
 * @returns One synthetic engine event.
 */
const ev = (type: string, data: Record<string, unknown> = {}, time: number = 0): SyntheticEvent => ({ type, seq: 1, time, data })
/** The live-agent double the stub hands the engine, carrying the workspace state resolves from. */
interface SceneAgent {
  /** The agent id the engine keys its per-session state by. */
  readonly id: string
  /** The session the agent belongs to; `header.cwd` is the workspace root. */
  readonly session: { readonly id: string; readonly header: { readonly cwd: string } }
}

/**
 * @param workspace The sandbox workspace the agent's session reports.
 * @returns One live-agent double in the shape the harness registry hands the adapter.
 */
const agentOf = (workspace: string): SceneAgent => ({ id: "a1", session: { id: "a1", header: { cwd: workspace } } })

/** The knobs of one heartbeat stamp line; `callId` and `tool` appear only when a caller names them. */
interface StampOptions {
  /** The workspace the stamp was written for. */
  workspace: string
  /** The team the stamp belongs to. */
  teamId?: string
  /** The member the stamp is filed under. */
  member?: string
  /** The task the stamp observes. */
  taskId?: string
  /** The generation token of that task; empty marks a pre-generation stamp. */
  attemptId?: string
  /** The tool call id, present only on a `tool-start` stamp. */
  callId?: string
  /** The tool name, present only on a `tool-start` stamp. */
  tool?: string
}

/**
 * One heartbeat line, exactly the fields the trees' readers consume.
 * @param kind The stamp kind (`step`, `tool-start`, …).
 * @param at The stamp instant, in epoch milliseconds.
 * @param options The team, member, task and optional call fields the line carries.
 * @returns The JSONL line, without its terminator.
 */
function stampLine(kind: string, at: number, { workspace, teamId = "team-a", member = "Architect", taskId = "t1", attemptId = "", callId, tool }: StampOptions): string {
  return JSON.stringify({
    kind, at, member, memberKey: member, teamId, taskId, attemptId, turnId: member + "#1",
    ...(callId === undefined ? {} : { callId }),
    ...(tool === undefined ? {} : { tool }),
    workspace,
  })
}

/** One task row in a synthetic team record: the id plus whatever else the record carries. */
interface TeamTask {
  /** The task id, which the arm's own lookups key on. */
  readonly id: string
  /** Any further field the task row carries. */
  readonly [extra: string]: unknown
}

/** The knobs of one synthetic team record. */
interface TeamRecordOptions {
  /** The record's creation instant in epoch milliseconds (the generation floor). */
  createdAt?: number
  /** The observed task's status. */
  taskStatus?: string
  /** The observed task's generation token. */
  attemptId?: string
  /** The observed task's dependency ids. */
  dependencies?: string[]
  /** Task rows prepended to the observed one. */
  extra?: TeamTask[]
}

/**
 * A team record shaped like the real ones (`members[].id` and `captainSessionId` present).
 * @param base The simulated "now" the record's stamps are derived from, in epoch milliseconds.
 * @param options The record's overrides.
 * @returns The team record document.
 */
function teamRecord(base: number, { createdAt, taskStatus = "in_progress", attemptId = "att-1", dependencies = [], extra }: TeamRecordOptions = {}): Record<string, unknown> {
  // The member id the record's single member is filed under.
  const memberId = "a1"
  // The task the arm observes: an OPEN task whose owner is expected to be stepping.
  const task = {
    id: "t1", subject: "the observed task", description: "RED/GREEN probe", status: taskStatus,
    assignee: "Architect", dependencies, attempt: taskStatus === "pending" ? 0 : 1,
    ...(attemptId === undefined ? {} : { attemptId }),
    createdAt: base - 60_000, updatedAt: base - 60_000,
  }
  return {
    id: "team-a", name: "team-a", captainSessionId: "captain-1", createdAt: createdAt ?? base - 3_600_000,
    taskSeq: extra === undefined ? 1 : 2, phase: "running",
    members: [{ id: memberId, name: "Architect", role: "architect", status: "working", joinedAt: base - 3_600_000 }],
    tasks: extra === undefined ? [task] : [...extra, task],
  }
}

// ── the §9 rows, as DATA: one scenario, both trees ───────────────────────────────────────
/** The fields every §9 scenario arm carries, whatever arm drives it. */
interface ScenarioBase {
  /** The row id (`a`–`g`). */
  readonly id: string
  /** The human title printed and stored in the result. */
  readonly title: string
  /** The contract's requirement sentence for this row. */
  readonly required: string
  /** What the RED tree is predicted to do (the contrast this row falsifies). */
  readonly redPrediction: string
  /** The RED-side judge. */
  red: (reading: JudgedReading) => boolean
  /** The GREEN-side judge. */
  green: (reading: JudgedReading) => boolean
}

/** An engine-arm scenario (`contrast` or `pin`): it stages a store and drives the engine. */
interface EngineScenario extends ScenarioBase {
  /** `contrast` = the two trees must read differently; `pin` = they must read the same. */
  readonly kind: "contrast" | "pin"
  /**
   * @param base The simulated "now" in epoch milliseconds.
   * @returns The team record the arm stages.
   */
  record(base: number): Record<string, unknown>
  /**
   * @param base The simulated "now" in epoch milliseconds.
   * @param workspace Absolute path of the arm's sandbox workspace.
   * @returns The heartbeat lines the arm writes, in file order.
   */
  stamps(base: number, workspace: string): string[]
  /**
   * @param stub The stub harness the arm fires its scripted events through.
   * @param workspace Absolute path of the arm's sandbox workspace.
   * @param base The simulated "now" in epoch milliseconds.
   */
  events(stub: StubHandle, workspace: string, base: number): void
  /**
   * @param tree The tree whose own threshold decides the schedule.
   * @returns The tick offsets in milliseconds, relative to `base`.
   */
  ticks(tree: LoadedTree): number[]
}

/** The tools-arm scenario (row c): the REAL adopted tools driven under a REAL hold. */
interface ToolsScenario extends ScenarioBase {
  /** The arm discriminator. */
  readonly kind: "tools"
}

/** The suite-arm scenario (row g): the plugin's OWN instrument suite, re-run and verdict'd. */
interface SuiteScenario extends ScenarioBase {
  /** The arm discriminator. */
  readonly kind: "suite"
}

/** One §9 row: the scenario that stages it and the two readings it demands. */
type Scenario = EngineScenario | ToolsScenario | SuiteScenario

/** The §9 table as DATA: one entry per row, in contract order, each carrying its own two judges. */
const SCENARIOS: readonly Scenario[] = [
  {
    id: "a",
    title: "a member streaming a long answer, no tool call, 10+ min simulated",
    required: "NO warn, NO hold — the open step is ALIVE while the answer streams",
    redPrediction: "a stale-but-current stamp earns WARN at the legacy 90 s threshold and ESCALATE on the 3rd tick",
    kind: "contrast",
    record: (base) => teamRecord(base),
    stamps: (base, ws) => [stampLine("step", base - 3_600_000, { workspace: ws })],
    events: (stub, ws, base) => {
      stub.emit("session/event", SESSION, ev("turn/start", { turn: 1 }, base))
      stub.emit("session/event", SESSION, ev("step/start", { turn: 1, step: 1 }, base))
      for (let index = 0; index < 5; index += 1) {
        stub.emit("agent/assistant-stream", { agent: agentOf(ws), frame: { type: "start", turn: 1, step: 1, time: base + 1_000 + index } })
      }
    },
    ticks: () => [601_000, 700_000, 800_000],
    red: (reading) => reading.anyWarn && reading.anyEscalate && reading.holdOnDiskAtEnd,
    green: (reading) => !reading.anyWarn && !reading.anyHold && !reading.holdOnDiskAtEnd && reading.channelAlive,
  },
  {
    id: "b",
    title: "a member whose open tasks are all dependency-blocked",
    required: "NO warn, NO hold, and the member is reported PARKED (dependency projection)",
    redPrediction: "the old stamp is silence, so the ladder warns, escalates and HOLDS a team that is merely waiting",
    kind: "contrast",
    // The blocking task carries NO assignee on purpose: `dependencyBlocked()` is computed over
    // the member's OWN live tasks (`team.ts`), so a task of its own that is claimable would
    // clear the block — the recorded T-20 shape is "everything I hold waits on someone else".
    record: (base) => teamRecord(base, { dependencies: ["t9"], extra: [{ id: "t9", subject: "the blocking task", status: "pending", dependencies: [], attempt: 0, createdAt: base - 60_000, updatedAt: base - 60_000 }] }),
    stamps: (base, ws) => [stampLine("step", base - 3_600_000, { workspace: ws })],
    events: (stub, _ws, base) => {
      // A REAL outstanding channel on top: the suppression must be attributable to PARKED, so
      // the ticks below are chosen PAST the fold tree's own 600 s threshold (they are the same
      // offsets row (d) uses to make an OUTSTANDING member warn).
      stub.emit("session/event", SESSION, ev("turn/start", { turn: 1 }, base))
      stub.emit("session/event", SESSION, ev("step/start", { turn: 1, step: 1 }, base))
    },
    ticks: () => [601_000, 700_000, 800_000, 900_000],
    red: (reading) => reading.anyWarn && reading.holdOnDiskAtEnd,
    green: (reading) => !reading.anyWarn && !reading.anyHold && !reading.holdOnDiskAtEnd && (reading.stats?.channelDependencyBlocked ?? 0) >= 1,
  },
  {
    id: "c",
    title: "work finished on disk, terminal `update_task` pending, a hold on the team",
    required: "the terminal `update_task` SUCCEEDS while the hold exists (and `claim_task` too)",
    redPrediction: "`update_task` throws `team … is held by the team watchdog` at the tool boundary",
    kind: "tools",
    red: (reading) => reading.update.ok === false && new RegExp(GUARD_TEXT).test(String(reading.update.error)) && reading.claim.ok === false,
    green: (reading) => reading.update.ok === true && reading.update.mutated === true && reading.claim.ok === true && reading.claim.mutated === true && reading.holdReads.fromTools === 0 && reading.reinject.rejected === true,
  },
  {
    id: "d",
    title: "an OUTSTANDING request with no response — the ladder and its numbers",
    required: "first WARN only at this tree's `warnSilenceMs`, then ESCALATE per the ladder, and NO hold while `actionOnEscalate` is warn-only",
    redPrediction: "the first WARN fires at ~90 s and the 3rd consecutive tick escalates + holds",
    kind: "contrast",
    record: (base) => teamRecord(base),
    stamps: (base, ws) => [stampLine("step", base, { workspace: ws })],
    events: (stub, _ws, base) => {
      stub.emit("session/event", SESSION, ev("turn/start", { turn: 1 }, base))
      stub.emit("session/event", SESSION, ev("step/start", { turn: 1, step: 1 }, base))
    },
    // The schedule is each tree's OWN threshold: the legacy 90 s ladder, then the §3 600 s one.
    ticks: (tree) => (tree.generation === "fold"
      ? [599_000, 600_001, 610_000, 620_000, 630_000, 640_000, 650_000, 660_000]
      : [91_000, 181_000, 271_000]),
    red: (reading) => reading.firstWarnAt !== null && reading.firstWarnAt <= 91_000 && reading.anyEscalate && reading.holdOnDiskAtEnd,
    // The §3 ladder: N consecutive OUTSTANDING observations after the first warn. The 6th
    // observation is the ESCALATE, so 5 warns + 1 escalate is the exact green reading (and the
    // hold must NOT be applied while `actionOnEscalate` is warn-only).
    green: (reading) => reading.noWarnBelowThreshold === true && reading.firstWarnAt === 600_001 && (reading.counts.warn ?? 0) >= 5 && (reading.counts.escalate ?? 0) >= 1 && !reading.holdOnDiskAtEnd,
  },
  {
    id: "e",
    title: "a tool call past `toolInFlightMaxMs` — the r6 PIN",
    required: "exactly ONE `tool-expired`, never a hold (the contract's RED column says r6 was already green)",
    redPrediction: "PIN, not contrast: the same reading is REQUIRED on both trees, and a difference is itself the defect signal",
    kind: "pin",
    record: (base) => teamRecord(base),
    // A PRE stamp with NO matching POST: the killed-call shape. `tool-start` + `callId` is what
    // every tree's `inFlightFor` pairs against.
    stamps: (base, ws) => [stampLine("tool-start", base - 10_000, { workspace: ws, callId: "c1", tool: "bash" })],
    events: () => {},
    ticks: () => [900_001, 1_800_000],
    // The bound is reported through the engine's OWN counter (`stats.toolExpired`), not through
    // `tick.decisions` — measured on both trees: the tool-expired record lands in the store and
    // the stats, and the tick returns no decision for it. "Never a hold" is asserted on BOTH
    // counters (`holdsApplied`, the hold file) so the pin cannot pass on a partial reading.
    red: (reading) => (reading.stats?.toolExpired ?? 0) === 1 && (reading.stats?.holdsApplied ?? 0) === 0 && !reading.anyHold && !reading.holdOnDiskAtEnd,
    green: (reading) => (reading.stats?.toolExpired ?? 0) === 1 && (reading.stats?.holdsApplied ?? 0) === 0 && !reading.anyHold && !reading.holdOnDiskAtEnd,
  },
  {
    id: "f",
    title: "a team whose only evidence is a PREVIOUS generation's stamp (and a task nobody attempted)",
    required: "never holdable: no hold, no escalate, and the pre-`createdAt` stamp is reported never-started, not silence",
    redPrediction: "the pre-`createdAt` stamp leaks through the permissive rule and holds the team",
    kind: "contrast",
    record: (base) => teamRecord(base, {
      createdAt: base - 1_800_000,
      extra: [{ id: "t2", subject: "never dispatched", status: "pending", assignee: "Architect", dependencies: [], attempt: 0, createdAt: base - 60_000, updatedAt: base - 60_000 }],
    }),
    // One day old AND before the record's own `createdAt`; empty `attemptId` is the recorded leak shape.
    stamps: (base, ws) => [stampLine("step", base - 86_400_000, { workspace: ws, attemptId: "" })],
    events: () => {},
    ticks: (tree) => (tree.generation === "fold" ? [601_000, 700_000, 800_000, 900_000, 1_000_000, 1_100_000] : [1_000, 2_000, 3_000]),
    red: (reading) => reading.anyWarn && reading.anyEscalate && reading.holdOnDiskAtEnd,
    // The never-started verdict is the engine's own counter (`stats.neverStarted`), the same
    // attribution the incident store records: the pre-`createdAt` stamp can no longer make the
    // team SILENT, so no warn, no escalate and never a hold file — 6 ticks past the fold's own
    // 600 s threshold included.
    green: (reading) => (reading.stats?.neverStarted ?? 0) >= 1 && (reading.counts.escalate ?? 0) === 0 && !reading.holdOnDiskAtEnd,
  },
  {
    id: "g",
    title: "the KICK arm (T-48, frozen D-2): a HOLD stops NEW DELIVERY only",
    required: "while held: the kick is ANSWERED with a NAMED decline, ZERO deliveries, the team bytes untouched, and claim/update still SUCCEED; after the release the SAME kick delivers exactly ONCE",
    redPrediction: "the two negative controls: neutering the hold read delivers while held, and the re-injected pre-redesign tool guard REFUSES the same calls",
    kind: "suite",
    red: (reading) => testState(reading.tests?.kickControl) === "pass" && testState(reading.tests?.claimUpdateControl) === "pass",
    green: (reading) => testState(reading.tests?.readings) === "pass" && reading.exit === 0,
  },
]

/** The plugin's OWN T-48 instrument suite, which row (g) re-runs instead of inventing a second home. */
const KICK_INSTRUMENT: string = "packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts"
// The row's DRIVING is delegated to the plugin's OWN instrument (the instrument-home ruling): lane C's
// suite already carries the four D-2 readings AND both negative controls, so this row re-runs it and
// verdicts from ITS result instead of inventing a second home.
/** The instrument suite's four D-2 test names, keyed by the reading they carry. */
const KICK_TESTS: Record<string, string> = {
  readings: "held: the kick is ANSWERED with a NAMED decline, zero deliveries, team bytes untouched; claim+update still SUCCEED",
  kickControl: "CONTROL (kick): neutering the hold read site delivers while held — the KICK arm REDDENS",
  claimUpdateControl: "CONTROL (claim/update): re-injecting the pre-redesign tool guard REFUSES the same calls",
}
/**
 * @param entry One instrument test's reading.
 * @returns `pass`, `fail`, or `absent` when the suite printed no verdict line for it.
 */
function testState(entry: InstrumentTest | undefined): string {
  if (entry === undefined) return "absent"
  return entry.passed === true ? "pass" : "fail"
}
/** One instrument-suite test's verdict, read back from bun's own output line. */
interface InstrumentTest {
  /** The test name the suite printed. */
  name?: string
  /** Whether a pass/fail line for this test was found in the output. */
  present?: boolean
  /** Whether that line was a `(pass)`. */
  passed?: boolean
}
/** Row (g): run the plugin's own T-48 instrument and read ITS verdicts. Tree-independent by design. */
async function runKickRow(): Promise<RowReading> {
  // The instrument suite's own process, run with colours off so the verdict lines stay greppable.
  const proc = spawnSync("bun", ["test", KICK_INSTRUMENT], { cwd: REPO, encoding: "utf8", timeout: 600_000, env: { ...process.env, NO_COLOR: "1" } })
  // The suite's combined stdout and stderr, which carries the verdict lines.
  const text = String(proc.stdout ?? "") + String(proc.stderr ?? "")
  // One reading per contracted test name; `undefined` marks a test the suite did not report.
  const tests: Record<string, InstrumentTest | undefined> = {}
  for (const [key, name] of Object.entries(KICK_TESTS)) {
    // The pass/fail line this test printed, or nothing when the suite did not report it.
    const line = text.split("\n").find((entry) => entry.includes(name) && (entry.includes("(pass)") || entry.includes("(fail)")))
    tests[key] = line === undefined ? undefined : { name, present: true, passed: line.includes("(pass)") }
  }
  return {
    tree: "instrument-suite (tree-independent: the plugin's own test/** arm IS the instrument)",
    treeIndependent: true,
    instrument: KICK_INSTRUMENT,
    instrumentSha256: sha256(readFileSync(join(REPO, KICK_INSTRUMENT), "utf8")),
    exit: proc.status,
    tests,
    readingsHeld: testState(tests.readings),
    controlsDetected: [testState(tests.kickControl), testState(tests.claimUpdateControl)],
    suiteTail: text.trim().split("\n").slice(-6).join(" | ").slice(0, 600),
  }
}
/**
 * One row's reading: the engine arm, the tools arm, or the suite arm (cached — it is tree-independent).
 * @param tree The tree to read.
 * @param scenario The row to drive.
 * @param rawRoot The run's raw scratch root.
 * @param suiteReadings The per-run cache of the tree-independent suite reading.
 * @returns The row's reading for this tree.
 */
async function produceReading(tree: LoadedTree, scenario: Scenario, rawRoot: string, suiteReadings: Map<string, RowReading>): Promise<RowReading> {
  if (scenario.kind === "tools") return runHoldRow(tree, rawRoot)
  if (scenario.kind === "suite") {
    if (!suiteReadings.has(scenario.id)) suiteReadings.set(scenario.id, await runKickRow())
    // The cached suite reading: the line above guarantees this key is present.
    return suiteReadings.get(scenario.id)!
  }
  return runScenario(tree, scenario, rawRoot)
}

// ── the engine arm: one scenario, one tree, one sandbox ──────────────────────────────────
/**
 * @param tree The tree whose own engine is mounted.
 * @param scenario The engine-arm scenario to stage.
 * @param rawRoot The run's raw scratch root.
 * @returns The summarised reading for this scenario on this tree.
 */
async function runScenario(tree: LoadedTree, scenario: EngineScenario, rawRoot: string): Promise<RowReading> {
  // The arm's own sandbox workspace, inside the run's raw scratch root.
  const workspace = mkdtempSync(join(rawRoot, scenario.id + "-" + tree.label + "-"))
  // The stub harness the engine is mounted on.
  const handle = stubAdapter(workspace)
  // The staged team record's directory.
  const teamDir = join(workspace, STATE_DIR, "team-a")
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  // The simulated "now" every offset below is measured from, in epoch milliseconds.
  const base = Date.now()
  writeFileSync(join(teamDir, "team.json"), JSON.stringify(scenario.record(base), null, 2) + "\n")
  // The staged team record's own path, re-read at the end to prove it was untouched.
  const teamFile = join(teamDir, "team.json")
  // The member's heartbeat log, resolved through the TREE'S OWN paths module.
  const heartbeat = tree.paths.heartbeatPath(workspace, STATE_DIR, "Architect")
  mkdirSync(dirname(heartbeat), { recursive: true })
  writeFileSync(heartbeat, scenario.stamps(base, workspace).join("\n") + "\n")
  // The tree's own engine, constructed exactly the way the row constructs it.
  const engine = new tree.engine.WatchdogEngine(handle.adapter, { on: () => () => {}, logger: { warn: () => {}, info: () => {}, error: () => {} } }, {
    stateDir: STATE_DIR,
    enabled: tree.defaults.enabled,
    warnSilenceMs: tree.defaults.warnSilenceMs,
    tickIntervalMs: tree.defaults.tickIntervalMs,
    warnStreakToEscalate: tree.defaults.warnStreakToEscalate,
    actionOnEscalate: tree.defaults.actionOnEscalate,
    holdTtlMs: tree.defaults.holdTtlMs ?? 0,
    teamCacheMs: 0,
    keepGenerations: 3,
    deadTeamGraceMs: 86_400_000,
    toolInFlightMaxMs: tree.defaults.toolInFlightMaxMs,
    verboseSkips: false,
    logPrefix: "redesign-" + tree.label,
  })
  // The engine's subscriptions, all removed before the arm returns.
  const disposers = engine.install()
  // One derived record per tick, in the order the schedule produced them.
  const ticks: TickReading[] = []
  try {
    scenario.events(handle, workspace, base)
    // The record's bytes before the ticks, compared after them.
    const bytesBefore = readFileSync(teamFile, "utf8")
    for (const offset of scenario.ticks(tree)) {
      // This tick's own result, at the simulated instant.
      const result = await engine.tickOnce(base + offset)
      ticks.push({
        offset,
        decisions: result.decisions.map((decision) => decision.type),
        holds: [...result.holds],
        holdOnDisk: existsSync(join(workspace, STATE_DIR, "watchdog", "hold", "team-a.json")),
      })
    }
    // The fold's provenance probe, present only on the fold generation.
    const status = typeof engine.predicateStatus === "function" ? engine.predicateStatus() : null
    return summarize({
      tree: tree.label,
      scenario: scenario.id,
      workspace,
      ticks,
      defaults: { warnSilenceMs: tree.defaults.warnSilenceMs, warnStreakToEscalate: tree.defaults.warnStreakToEscalate, actionOnEscalate: tree.defaults.actionOnEscalate, toolInFlightMaxMs: tree.defaults.toolInFlightMaxMs },
      predicateSource: status === null ? null : status.source,
      states: status === null ? null : status.states,
      stats: typeof engine.getStats === "function" ? engine.getStats() : null,
      teamBytesUntouched: readFileSync(teamFile, "utf8") === bytesBefore,
      eventListeners: { session: handle.listenerCount("session/event"), stream: handle.listenerCount("agent/assistant-stream") },
    })
  } finally {
    for (const off of disposers) off()
    engine.stop()
  }
}

/** One tick's reading inside a summarised row: what the tick produced and whether a hold file existed. */
interface TickReading {
  /** The tick's offset from the arm's own "now", in milliseconds. */
  offset: number
  /** The decision types this tick produced, in order. */
  decisions: string[]
  /** The holds this tick returned, in order. */
  holds: readonly unknown[]
  /** Whether the hold sidecar existed after this tick. */
  holdOnDisk: boolean
}

/** The un-summarised engine reading `summarize` folds into a judgeable row. */
interface TickedReading extends RowReading {
  /** The raw tick list, which every summarisable reading carries. */
  ticks: TickReading[]
}

/** The derived reading: decisions folded into counts + the decisive booleans. */
/**
 * @param raw The arm's raw reading, whose tick list the folding runs over.
 * @returns The reading extended with the counts and booleans every judge reads.
 */
function summarize(raw: TickedReading): RowReading {
  // How many decisions of each type the ticks produced.
  const counts: Record<string, number> = {}
  // The first tick offset that produced a `warn`, or `null` when none did.
  let firstWarnAt: number | null = null
  // The first tick offset that produced an `escalate`, or `null` when none did.
  let firstEscalateAt: number | null = null
  for (const tick of raw.ticks) {
    for (const type of tick.decisions) {
      counts[type] = (counts[type] ?? 0) + 1
      if (type === "warn" && firstWarnAt === null) firstWarnAt = tick.offset
      if (type === "escalate" && firstEscalateAt === null) firstEscalateAt = tick.offset
    }
  }
  // The fold's per-session states, or `null` on a tree that reported none.
  const states = raw.states ?? null
  return {
    ...raw,
    counts,
    firstWarnAt,
    firstEscalateAt,
    anyWarn: (counts.warn ?? 0) > 0,
    anyEscalate: (counts.escalate ?? 0) > 0,
    anyHold: raw.ticks.some((tick) => tick.holds.length > 0),
    holdOnDiskAtEnd: raw.ticks.length > 0 && raw.ticks[raw.ticks.length - 1].holdOnDisk,
    noWarnBelowThreshold: raw.ticks.length > 0 && !raw.ticks[0].decisions.includes("warn"),
    channelAlive: states !== null && Object.values(states).includes("ALIVE"),
    channelParked: states !== null && Object.values(states).includes("PARKED"),
  }
}

// ── row (c): the REAL adopted tools under a REAL hold ────────────────────────────────────
/**
 * The scratch re-injection control (the shape `self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` uses).
 * @param tree The tree whose adopted tools are copied and mutated.
 * @param rawRoot The run's raw scratch root.
 * @param workspace The sandbox workspace the probe call is made against.
 * @param captain The captain agent double the mutant registry serves.
 * @param member The member agent double the probe call is made as.
 * @returns The control's verdict: whether the re-injected guard refused the same call.
 */
async function runReinjection(tree: LoadedTree, rawRoot: string, workspace: string, captain: AgentDouble, member: AgentDouble): Promise<ReinjectResult> {
  // The adopted plugin's package root inside the tree.
  const pluginRoot = join(tree.root, "packages", "mpd-agent-teams-plugin")
  // The adopted plugin's lib directory, which the mutant copy is made from.
  const libDir = join(pluginRoot, "lib")
  // The scratch directory the mutant copy lives in.
  const scratch = mkdtempSync(join(rawRoot, "c-" + tree.label + "-reinject-"))
  mkdirSync(join(scratch, "lib"), { recursive: true })
  for (const entry of readdirSync(libDir, { withFileTypes: true })) if (entry.isFile()) cpSync(join(libDir, entry.name), join(scratch, "lib", entry.name))
  symlinkSync(join(pluginRoot, "_deps"), join(scratch, "_deps"), "junction")
  // The mutant tools module the deleted guard is re-injected into, under the tree's own spelling
  // (the scratch lib is a flat copy of the tree's lib, so the basename is the same).
  const scratchTools = join(scratch, "lib", basename(adoptedToolsFile(tree.root)))
  // The mutant's original source text.
  const source = readFileSync(scratchTools, "utf8")
  // The offset of the `update_task` registration the execute body is anchored to.
  const registration = source.indexOf("name: 'agent_teams_update_task'")
  // The offset of the execute body that follows that registration.
  const execute = source.indexOf("async execute(args, exec) {", registration)
  if (registration < 0 || execute < 0) return { ran: false, rejected: false, error: "the injection anchor was not found in lib/tools.ts (registration=" + registration + ", execute=" + execute + ")" }
  // The hold guard the redesign deleted, re-injected verbatim at the tool boundary.
  const guard = "\n            { const __held = watchdogHoldOf(ctx, freshTeamProbeId, workspaceOf(exec.agent)); if (__held !== undefined) throw new Error(`team ${freshTeamProbeId} is held by the team watchdog (hold ${__held.holdId}); the team must be released with the watchdog's own session-watchdog-resume action before any further work`); }"
  // The reader the injected guard resolves the watchdog service through.
  const reader = "const WATCHDOG_HOLD_SERVICE = 'mpdWatchdog';\nfunction watchdogHoldOf(ctx, teamId, workspace) {\n    try {\n        const watchdog = typeof ctx?.get === 'function' ? ctx.get(WATCHDOG_HOLD_SERVICE, false) : undefined;\n        const view = typeof watchdog?.isHeld === 'function' ? watchdog.isHeld(teamId, workspace) : undefined;\n        if (view === undefined || view === null || view.held !== true)\n            return undefined;\n        return { holdId: String(view.holdId ?? ''), at: 0, reason: String(view.reason ?? ''), source: null };\n    }\n    catch {\n        return undefined;\n    }\n}\nconst freshTeamProbeId = 'probe-team';\n"
  writeFileSync(scratchTools, reader + source.slice(0, execute + "async execute(args, exec) {".length) + guard + source.slice(execute + "async execute(args, exec) {".length))
  // Every tool definition the mutant registered, by name.
  const tools: Map<string, RegisteredTool> = new Map()
  // The plugin context the mutant registers its tools on.
  const ctx: PluginStubCtx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => (name === "mpdWatchdog" ? { isHeld: () => ({ held: true, holdId: "hold-probe-1", at: 0, reason: "reinject control" }) } : undefined),
  }
  try {
    // The mutant module, imported with a cache-busting query so the copy is really loaded.
    const mod = (await import(pathToFileURL(scratchTools).href + "?reinject=" + Date.now())) as AdoptedToolsModule
    mod.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    // The `update_task` definition the mutant registered.
    const definition = tools.get("agent_teams_update_task")
    if (definition === undefined) return { ran: true, rejected: false, error: "the injected copy registered no `agent_teams_update_task`" }
    await definition.execute({ task_id: "t2", status: "completed", output: "re-injection control", attempt_id: "att-2", acceptanceResults: [{ criterion: "probe", status: "passed" }], commandsRun: [{ command: "bun test", status: "passed" }] }, { agent: member })
    return { ran: true, rejected: false, error: "the re-injected guard did NOT refuse the same call" }
  } catch (error) {
    // The thrown value is `unknown` under strict mode; it is viewed as a message-bearing record so
    // a plain-object throw still reports its own `.message`, exactly as that expression did before.
    const text = String((error as { message?: unknown } | null)?.message ?? error)
    return { ran: true, rejected: new RegExp(GUARD_TEXT).test(text), error: text }
  }
}

/** A live-agent double in the shape the adopted plugin's registry hands its tools. */
interface AgentDouble {
  /** The agent id the registry is keyed by. */
  readonly id: string
  /** The agent's run status. */
  readonly status: string
  /** The session the agent belongs to; `header.cwd` is the workspace root. */
  readonly session: { readonly header: { readonly cwd: string } }
}

/** The adopted plugin's `lib/tools.ts` entry surface, as the row's probe consumes it. */
interface AdoptedToolsModule {
  /**
   * @param ctx The plugin context the tools register on.
   * @param config The row config the tools resolve their state dir from.
   */
  registerAgentTeamsTools(ctx: unknown, config: { stateDir: string }): void
}

/** The plugin context the adopted module registers on: only the seams its tools touch. */
interface PluginStubCtx {
  /** The stub tool registry. */
  readonly tools: { register(definition: RegisteredTool): () => boolean }
  /** The agent registry the adopted tools resolve agents through. */
  readonly agents: { get(id: string): AgentDouble | undefined; list(): AgentDouble[] }
  /** The subagent surface the adopted tools may call. */
  readonly subagents: { prompt(): Promise<{ messageId: string }>; followup(): void; sendMessage(): void }
  /** The cleanup hook the cordis context exposes. */
  readonly effect: () => () => undefined
  /** The event subscription hook the cordis context exposes. */
  readonly on: () => () => undefined
  /** The logger the cordis context exposes. */
  readonly logger: { warn(): void; info(): void; error(): void; debug(): void }
  /** The service lookup the adopted tools resolve `mpdWatchdog` through. */
  readonly get: (name: string) => unknown
}

/** The re-injection control's verdict: whether the mutant ran and refused the same calls. */
interface ReinjectResult {
  /** Whether the mutant module was imported and drove a call. */
  readonly ran: boolean
  /** Whether the re-injected guard refused the call. */
  rejected: boolean
  /** Why it did not refuse, or the refusal text itself; absent on a hand-written control reading. */
  readonly error?: string
  /** Any further field the control reports. */
  readonly [extra: string]: unknown
}

/** One tool call's outcome inside the hold-row probe. */
interface ToolCallOutcome {
  /** Whether the call resolved without throwing. */
  ok: boolean
  /** The failure message when the call threw. */
  error?: string
  /** The JSON echo of the resolved value, or its string form when it cannot be serialized. */
  value?: unknown
  /** Filled in from the team file after the call: whether the task bytes really moved. */
  mutated?: boolean
}

/** The hold sidecar the hold-row probe writes, in the shape the store keeps it. */
interface HoldRecord {
  /** The hold id. */
  readonly id: string
  /** The held team id. */
  readonly teamId: string
  /** When the hold was taken, in epoch milliseconds. */
  readonly since: number
  /** Why the hold was taken. */
  readonly cause: string
  /** The task the hold paused. */
  readonly taskId: string
  /** The attempt the hold paused. */
  readonly attemptId: string
  /** The scene instant the hold was taken at, in epoch milliseconds. */
  readonly sceneAt: number
  /** The hold's TTL in milliseconds. */
  readonly ttlMs: number
}

/** The hold view a reader consults through the watchdog service. */
interface HoldView {
  /** Whether the team is held. */
  readonly held: boolean
  /** The hold id. */
  readonly holdId: string
  /** When the hold was taken, in epoch milliseconds. */
  readonly at: number
  /** Why the hold was taken. */
  readonly reason: string
  /** Which surface answered the read. */
  readonly source: string
}

/** The watchdog service double the adopted tools resolve through `ctx.get('mpdWatchdog')`. */
interface WatchdogServiceDouble {
  /**
   * @param id The team id to test.
   * @param ws The workspace the reader resolved.
   * @returns The hold view when that team is held, else nothing.
   */
  isHeld(id: string, ws: string): HoldView | undefined
}

/** One hold read the adopted tools performed, with the frame that asked for it. */
interface HoldRead {
  /** The team id the reader asked about. */
  readonly teamId: string
  /** The workspace the reader resolved. */
  readonly workspace: string
  /** The stack frame the read came from (the re-injection check greps this). */
  readonly frame: string
}

/** The team file as the hold-row probe reads it back from disk. */
interface TeamFileOnDisk {
  /** The recorded task rows, absent when the file carries none. */
  readonly tasks?: Array<{ readonly id?: string; readonly status?: string; readonly attemptId?: string }>
}

/**
 * @param tree The tree whose adopted tools are driven.
 * @param rawRoot The run's raw scratch root.
 * @returns The tools arm's reading: both calls, the re-injection control and the hold reads.
 */
async function runHoldRow(tree: LoadedTree, rawRoot: string): Promise<RowReading> {
  // The arm's own sandbox workspace, inside the run's raw scratch root.
  const workspace = mkdtempSync(join(rawRoot, "c-" + tree.label + "-"))
  // The probed team id the hold sidecar and the service view both name.
  const teamId = "probe-team"
  // The simulated "now" the probe's timestamps are derived from, in epoch milliseconds.
  const now = Date.now()
  // The captain agent double; the hold must not stop its own delivery.
  const captain: AgentDouble = { id: "session-captain", status: "idle", session: { header: { cwd: workspace } } }
  // The member agent double every probed call is made as.
  const member: AgentDouble = { id: "session-member", status: "idle", session: { header: { cwd: workspace } } }
  // The staged team record's directory.
  const teamDir = join(workspace, STATE_DIR, teamId)
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  /**
   * @param id The task id.
   * @param status The task's status.
   * @param attemptId The task's generation token, or `undefined` when it has none.
   * @param attempt How many attempts the task carries.
   * @returns One probe task row carrying the completion coverage a terminal update needs.
   */
  const task = (id: string, status: string, attemptId: string | undefined, attempt: number): TeamTask => ({
    id, subject: "probe " + id, description: "hold probe", status, assignee: "Architect", dependencies: [],
    ...(attemptId === undefined ? {} : { attemptId }), attempt, createdAt: now - 60_000, updatedAt: now - 60_000,
    kind: "verification", acceptance: ["probe"], verify: ["bun test"], acceptanceResults: [], commandsRun: [],
  })
  // The staged team record's own path, re-read after the probed calls.
  const teamFile = join(teamDir, "team.json")
  writeFileSync(teamFile, JSON.stringify({
    id: teamId, name: "hold probe", captainSessionId: captain.id, createdAt: now - 60_000, taskSeq: 2, phase: "running",
    members: [{ id: member.id, name: "Architect", role: "architect", status: "idle", joinedAt: now - 60_000 }],
    tasks: [task("t1", "pending", undefined, 0), task("t2", "in_progress", "att-2", 1)],
  }, null, 2) + "\n")
  // The REAL hold sidecar (the disk truth a reader can consult) — plus the service shape the
  // deleted guard consumed, so BOTH sources of the hold are live in this probe.
  const hold: HoldRecord = { id: "hold-probe-1", teamId, since: now, cause: "silence", taskId: "t2", attemptId: "att-2", sceneAt: now, ttlMs: 900_000 }
  mkdirSync(join(workspace, STATE_DIR, "watchdog", "hold"), { recursive: true })
  writeFileSync(join(workspace, STATE_DIR, "watchdog", "hold", teamId + ".json"), JSON.stringify(hold, null, 2) + "\n")
  // Every hold read the adopted tools performed, in call order.
  const reads: HoldRead[] = []
  // The watchdog service double the adopted tools resolve their hold view through.
  const watchdog: WatchdogServiceDouble = {
    isHeld: (id, ws) => {
      reads.push({ teamId: id, workspace: ws, frame: ((new Error("hold-read").stack ?? "").split("\n")[2] ?? "").trim() })
      return id === teamId ? { held: true, holdId: hold.id, at: hold.since, reason: hold.cause, source: "service" } : undefined
    },
  }
  // Every tool definition the adopted module registered, by name.
  const tools: Map<string, RegisteredTool> = new Map()
  // The plugin context the adopted module registers its tools on.
  const ctx: PluginStubCtx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => (name === "mpdWatchdog" ? watchdog : undefined),
  }
  // The adopted tools module this tree ships (`.ts` on the working tree, `.js` on the RED one),
  // imported with the tree's own label as the cache key.
  const toolsPath = adoptedToolsFile(tree.root)
  // The adopted tools module, imported from the tree's own lib directory.
  const mod = (await import(pathToFileURL(toolsPath).href + "?tree=" + tree.label)) as AdoptedToolsModule
  mod.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  /**
   * Invoke one registered tool the way the harness would.
   * @param name The tool name to invoke.
   * @param args The tool arguments.
   * @param agent The agent the call is made as.
   * @returns The call's outcome: whether it resolved, and its JSON echo or its thrown message.
   */
  const call = async (name: string, args: Record<string, unknown>, agent: AgentDouble): Promise<ToolCallOutcome> => {
    // The registered definition, or nothing when this tree never registered the tool.
    const definition = tools.get(name)
    if (definition === undefined) return { ok: false, error: "tool not registered: " + name }
    try {
      // The tool's own value.
      const value = await definition.execute(args, { agent })
      // The JSON echo of the value, or its string form when it cannot be serialized.
      let echo: unknown = null
      try { echo = value === undefined ? null : JSON.parse(JSON.stringify(value)) } catch { echo = String(value) }
      return { ok: true, value: echo }
    } catch (error) {
      // The thrown value is `unknown` under strict mode; it is viewed as a message-bearing record so
      // a plain-object throw still reports its own `.message`, exactly as that expression did before.
      return { ok: false, error: String((error as { message?: unknown } | null)?.message ?? error) }
    }
  }
  // The terminal-update payload carries the completion coverage the quality gate requires
  // (`acceptanceResults` + `commandsRun`), so a GREEN refusal could only come from a hold guard:
  // the first diagnostic run of this lane measured exactly that gate's own message on GREEN
  // ("verification completion requires passed acceptanceResults …") and the payload was fixed.
  const TERMINAL_UPDATE: Record<string, unknown> = { task_id: "t2", status: "completed", output: "hold probe complete", attempt_id: "att-2", acceptanceResults: [{ criterion: "probe", status: "passed" }], commandsRun: [{ command: "bun test", status: "passed" }] }
  // The terminal `update_task` call, which must SUCCEED while the hold exists.
  const update = await call("agent_teams_update_task", TERMINAL_UPDATE, member)
  // The `claim_task` call, which must also succeed while the hold exists.
  const claim = await call("agent_teams_claim_task", { task_id: "t1" }, member)
  // The team file as the calls left it on disk.
  const onDisk = JSON.parse(readFileSync(teamFile, "utf8")) as TeamFileOnDisk
  // The task rows the file carries, or none when it carries no list.
  const tasksOnDisk = onDisk.tasks ?? []
  update.mutated = tasksOnDisk.find((entry) => entry.id === "t2")?.status === "completed"
  claim.mutated = String(tasksOnDisk.find((entry) => entry.id === "t1")?.attemptId ?? "") !== ""
  // The re-injection control: only the fold tree deleted the guard, so only there is it applicable.
  const reinject = tree.generation === "fold" ? await runReinjection(tree, rawRoot, workspace, captain, member) : { ran: false, rejected: false, error: "not run: the guard is present in this tree's lib/tools.ts, so the control is not applicable" }
  return {
    tree: tree.label,
    scenario: "c",
    workspace,
    registeredTools: [...tools.keys()].length,
    toolNames: [...tools.keys()].filter((name) => name.includes("claim_task") || name.includes("update_task")),
    update, claim, reinject,
    holdOnDisk: existsSync(join(workspace, STATE_DIR, "watchdog", "hold", teamId + ".json")),
    holdReads: { total: reads.length, fromTools: reads.filter((read) => read.frame.includes("lib/tools.ts") || read.frame.includes("/tools.js")).length, frames: reads.map((read) => read.frame) },
    guardInToolsSource: readFileSync(toolsPath, "utf8").includes(GUARD_TEXT),
  }
}

// ── contract §9 item 3: the recorded incidents, replayed through each tree's OWN machine ──
/** One reconstruction arm's counts and the historical holds it would have reproduced. */
interface ReplayArm {
  /** Which channel this arm was replayed with; absent on a hand-written report. */
  mode?: ReplayMode
  /** How many decisions of each type the replay produced. */
  counts: Record<string, number>
  /** How many recorded holds this arm reproduced. */
  heldEscalationsReproduced: number
  /** The reproduced held keys, with their recorded evidence. */
  heldKeysReproduced?: ReplayHeldEntry[]
}

/** One reconstructed arm as the local `replayed` helper builds it: the mode and key list are always set. */
interface ReplayArmResult extends ReplayArm {
  /** Which channel this arm was replayed with. */
  mode: ReplayMode
  /** The reproduced held keys, always materialized by the helper. */
  heldKeysReproduced: ReplayHeldEntry[]
}

/** One reproduced held key, with what the recorded rows said about it. */
interface ReplayHeldEntry {
  /** The `team|task|attempt` key. */
  key: string
  /** How many recorded rows this key carried. */
  recordedRows: number
  /** The longest recorded silence for this key, in milliseconds. */
  maxSilenceMs: number
  /** How many recorded rows of each kind this key carried. */
  kinds: Record<string, number>
}

/** The contract §9 item 3 replay: both machines driven over the recorded silence rows. */
interface ReplayReport {
  /** The incident log's absolute path. */
  path?: string
  /** The log's lowercase hex sha256. */
  sha256: string
  /** The log's size in bytes. */
  bytes?: number
  /** How many non-empty lines the log carries. */
  lines?: number
  /** How many lines parsed as rows. */
  rows: number
  /** How many non-empty lines failed to parse. */
  malformed?: number
  /** How many rows of each kind the log carries. */
  kinds?: Record<string, number>
  /** How many rows of each cause the log carries. */
  causes?: Record<string, number>
  /** How many rows are escalations. */
  escalateRows: number
  /** How many distinct escalations the log carries. */
  escalateDistinct?: number
  /** How many escalations applied a hold. */
  escalateHeld: number
  /** How many silence rows the replay replayed. */
  silenceRows: number
  /** How many distinct silence keys the log carries. */
  silenceDistinct: number
  /** Whether the result is a labelled reconstruction (it always is). */
  reconstruction: boolean
  /** What the reconstruction's numbers mean (the upper-bound sentence). */
  bound?: string
  /** The legacy machine's arm, replayed with the channel reconstructed pessimistically. */
  legacy: ReplayArm
  /** The fold machine's arm, replayed with the channel reconstructed pessimistically. */
  fold: ReplayArm
  /** The fold machine's §4 report-only arm, with no channel evidence at all. */
  foldReportOnly: ReplayArm
}

/** The replay as `replayIncidents` builds it: every arm carries its own key list. */
interface ReplayResult extends ReplayReport {
  /** The legacy machine's arm, with its key list materialized. */
  legacy: ReplayArmResult
  /** The fold machine's arm, with its key list materialized. */
  fold: ReplayArmResult
  /** The report-only arm, with its key list materialized. */
  foldReportOnly: ReplayArmResult
}

/** The two trees the replay drives, keyed by side. */
interface TreePair {
  /** The pinned RED tree, whose legacy machine is the faithful reconstruction check. */
  readonly red: LoadedTree
  /** The tree under test, whose fold machine is the predicate the count is about. */
  readonly green: LoadedTree
}

/** Which channel the reconstruction feeds the candidate: the pessimistic one, or §4 report-only. */
type ReplayMode = "channel" | "reportOnly"

/**
 * @param path Absolute path of the incident log to replay.
 * @param trees The two trees whose machines replay it.
 * @returns The replay report, with one arm per machine and reconstruction mode.
 */
function replayIncidents(path: string, trees: TreePair): ReplayResult {
  // The log's own text.
  const raw = readFileSync(path, "utf8")
  // The log's non-empty lines.
  const lines = raw.split("\n").filter((line) => line.trim() !== "")
  // Every line that parsed as a JSON row.
  const rows: IncidentRow[] = []
  // How many non-empty lines failed to parse.
  let malformed = 0
  for (const line of lines) { try { rows.push(JSON.parse(line) as IncidentRow) } catch { malformed += 1 } }
  // Every recorded escalation.
  const escalates = rows.filter((row) => row.kind === "escalate")
  // The keys of the escalations that actually held a team.
  const heldKeys = new Set(escalates.filter((row) => row.hold === "applied").map(incidentKey))
  // The chronological silence rows the replay reconstructs from; the predicate proves each one
  // carries the measured silence the reconstruction subtracts from its instant.
  const chrono = rows.filter((row): row is SilenceRow => row.cause?.kind === "silence" && typeof row.cause.ms === "number").sort((left: SilenceRow, right: SilenceRow): number => left.at - right.at)
  /**
   * Replay every silence row through one tree's own machine.
   * @param tree The tree whose machine is driven.
   * @param mode The channel the candidate is fed with.
   * @returns This arm's counts and the recorded holds it reproduced.
   */
  const replayed = (tree: LoadedTree, mode: ReplayMode): ReplayArmResult => {
    // The tree's own fold, fresh for each arm so no streak survives between arms.
    const machine = new tree.machine.WatchdogMachine()
    // The knobs the tree's own machine ships.
    const knobs = tree.machine.WATCHDOG_DEFAULTS
    // How many decisions of each type this arm produced.
    const counts: Record<string, number> = {}
    // The per-key evidence this arm accumulated.
    const seen: Map<string, ReplayHeldEntry> = new Map()
    // The held keys this arm reproduced.
    const reproduced: Set<string> = new Set()
    // How many recorded holds this arm reproduced.
    let heldReproduced = 0
    for (const row of chrono) {
      // The instant the reconstructed request went silent.
      const since = row.at - row.cause.ms
      // The `team|task|attempt` key this row belongs to.
      const key = incidentKey(row)
      // This key's accumulated evidence, created on its first row.
      const entry = seen.get(key) ?? { key, recordedRows: 0, maxSilenceMs: 0, kinds: {} }
      entry.recordedRows += 1
      entry.maxSilenceMs = Math.max(entry.maxSilenceMs, row.cause.ms)
      entry.kinds[row.kind] = (entry.kinds[row.kind] ?? 0) + 1
      seen.set(key, entry)
      // The reconstruction: the recorded row states only WHEN and HOW LONG the silence was, so
      // the candidate is fed the MOST PESSIMISTIC channel that exists — OUTSTANDING — and the
      // verdict is an upper bound on what the predicate would have done. The `reportOnly`
      // variant feeds the §4 shape instead (no channel evidence), which is the OTHER honest
      // bound: a member the fold cannot answer for may warn once and can never hold.
      const candidate: ReplayCandidate = {
        teamId: row.teamId, taskId: row.taskId, attemptId: row.attemptId ?? "", assignee: "reconstructed", memberKey: "reconstructed",
        lastSeen: since, lastKind: "step", everStampedForTask: true, inFlightSince: null, inFlightTool: null,
        ...(mode === "reportOnly" ? { channelState: null, heartbeatFallback: true } : { channelState: "OUTSTANDING", outstandingSince: since }),
      }
      for (const decision of machine.observe([candidate], row.at, knobs)) {
        counts[decision.type] = (counts[decision.type] ?? 0) + 1
        if (heldKeys.has(key) && decision.type === "escalate") { heldReproduced += 1; reproduced.add(key) }
      }
    }
    return {
      mode,
      counts,
      heldEscalationsReproduced: heldReproduced,
      // The reproduced keys' evidence: every key was inserted into `seen` when its first row was
      // folded, so the lookup cannot come back empty here.
      heldKeysReproduced: [...reproduced].sort().map((key) => seen.get(key)!),
    }
  }
  return {
    path, sha256: sha256(raw), bytes: Buffer.byteLength(raw, "utf8"), lines: lines.length, rows: rows.length, malformed,
    kinds: countBy(rows, (row) => row.kind), causes: countBy(rows, (row) => row.cause?.kind),
    escalateRows: escalates.length,
    escalateDistinct: new Set(escalates.map(incidentKey)).size,
    escalateHeld: escalates.filter((row) => row.hold === "applied").length,
    silenceRows: chrono.length,
    silenceDistinct: new Set(chrono.map(incidentKey)).size,
    reconstruction: true,
    bound: "the recorded rows carry no channel state, so each silence row is replayed as the MOST PESSIMISTIC candidate (OUTSTANDING since `at - cause.ms`); the counts are an UPPER BOUND on what that predicate would produce, never a replay of the recorded run — and the §4 variant (`foldReportOnly`) is the other bound, where the fold has no evidence at all",
    legacy: replayed(trees.red, "channel"),
    fold: replayed(trees.green, "channel"),
    foldReportOnly: replayed(trees.green, "reportOnly"),
  }
}

// ── the pure evaluator ───────────────────────────────────────────────────────────────────
/**
 * @param id The row id whose reading is described.
 * @param reading The summarised reading, or nothing when the row never ran.
 * @returns The one-line detail printed beside that row's verdict.
 */
function describe(id: string, reading: JudgedReading | null | undefined): string {
  if (reading === undefined || reading === null) return "no reading"
  if (id === "c") {
    return "update=" + (reading.update?.ok ? "resolved" : "rejected") + " claim=" + (reading.claim?.ok ? "resolved" : "rejected") +
      " holdReadsFromTools=" + reading.holdReads?.fromTools + " reInjectRejected=" + reading.reinject?.rejected +
      " guardInSource=" + reading.guardInToolsSource + " tools=" + reading.registeredTools +
      (reading.update?.ok === false ? " error=" + JSON.stringify(reading.update.error).slice(0, 140) : "")
  }
  if (id === "g") {
    return "instrument=" + reading.instrument + " exit=" + reading.exit +
      " readings=" + testState(reading.tests?.readings) + " kickControl=" + testState(reading.tests?.kickControl) +
      " claimUpdateControl=" + testState(reading.tests?.claimUpdateControl)
  }
  return "counts=" + JSON.stringify(reading.counts) + " firstWarnAt=" + reading.firstWarnAt + " firstEscalateAt=" + reading.firstEscalateAt +
    " holdFileAtEnd=" + reading.holdOnDiskAtEnd + " states=" + JSON.stringify(reading.states) +
    " depParked=" + (reading.stats?.channelDependencyBlocked ?? null) + " source=" + reading.predicateSource
}

/** One row reading as any arm produces or observes it: only the fields every arm shares are named. */
interface RowReading {
  /** The raw tick list, present on the two engine arms only. */
  ticks?: TickReading[]
  /** The derived decision counts, absent until the folding runs. */
  counts?: Record<string, number>
  /** The first tick offset that produced a `warn`, or `null` when none did. */
  firstWarnAt?: number | null
  /** The first tick offset that produced an `escalate`, or `null` when none did. */
  firstEscalateAt?: number | null
  /** Whether any tick produced a warn. */
  anyWarn?: boolean
  /** Whether any tick produced an escalate. */
  anyEscalate?: boolean
  /** Whether any tick returned a hold. */
  anyHold?: boolean
  /** Whether the hold sidecar existed after the last tick. */
  holdOnDiskAtEnd?: boolean
  /** Whether the first tick stayed below the tree's own warn threshold. */
  noWarnBelowThreshold?: boolean
  /** Whether the fold reported the observed member ALIVE. */
  channelAlive?: boolean
  /** Whether the fold reported the observed member PARKED. */
  channelParked?: boolean
  /** The fold's per-session states, or `null` when the tree reported none. */
  states?: Record<string, string> | null
  /** The engine's own counters, or `null` when the tree exposed none. */
  stats?: EngineStats | null
  /** The predicate's provenance (`channel` or the heartbeat fallback), or `null`. */
  predicateSource?: string | null
  /** The terminal `update_task` call result (tools arm). */
  update?: ToolCallOutcome
  /** The `claim_task` call result (tools arm). */
  claim?: ToolCallOutcome
  /** The re-injection control's verdict (tools arm). */
  reinject?: ReinjectResult
  /** How many hold reads came from the adopted tools, and the frames that asked (tools arm). */
  holdReads?: { total?: number; fromTools: number; frames?: readonly string[] }
  /** Whether the adopted tools source still carries the guard sentence (tools arm). */
  guardInToolsSource?: boolean
  /** How many tools the adopted module registered (tools arm). */
  registeredTools?: number
  /** The instrument suite's per-test verdicts (suite arm). */
  tests?: Record<string, InstrumentTest | undefined>
  /** The instrument suite's exit code (suite arm). */
  exit?: number | null
  /** The instrument path the suite arm ran (suite arm). */
  instrument?: string
  /** Any further arm field the reading carries. */
  [extra: string]: unknown
}

/**
 * Every field a judge may dereference without a guard: the union of the three arms' readings.
 * Each judge reads only the fields ITS OWN arm produces, and `judgeRow` asserts the derived ones
 * are materialized before a judge runs — which is why they are non-optional here.
 */
interface JudgedReading extends RowReading {
  /** How many decisions of each type the ticks produced. */
  counts: Record<string, number>
  /** The first tick offset that produced a `warn`, or `null` when none did. */
  firstWarnAt: number | null
  /** The first tick offset that produced an `escalate`, or `null` when none did. */
  firstEscalateAt: number | null
  /** Whether any tick produced a warn. */
  anyWarn: boolean
  /** Whether any tick produced an escalate. */
  anyEscalate: boolean
  /** Whether any tick returned a hold. */
  anyHold: boolean
  /** Whether the hold sidecar existed after the last tick. */
  holdOnDiskAtEnd: boolean
  /** Whether the first tick stayed below the tree's own warn threshold. */
  noWarnBelowThreshold: boolean
  /** Whether the fold reported the observed member ALIVE. */
  channelAlive: boolean
  /** Whether the fold reported the observed member PARKED. */
  channelParked: boolean
  /** The terminal `update_task` call result (read by row (c) only). */
  update: ToolCallOutcome
  /** The `claim_task` call result (read by row (c) only). */
  claim: ToolCallOutcome
  /** The re-injection control's verdict (read by row (c) only). */
  reinject: ReinjectResult
  /** How many hold reads came from the adopted tools (read by row (c) only). */
  holdReads: { total?: number; fromTools: number; frames?: readonly string[] }
  /** The instrument suite's exit code (read by row (g) only). */
  exit: number | null
}

/** One row's verdict label; the two RED-side labels are the contract's own vocabulary. */
type VerdictLabel = "missing" | "red" | "pin" | "not-reproduced" | "green" | "fail"

/** One row's verdict: the label plus the detail line printed beside it. */
interface RowVerdict {
  /** The verdict label. */
  readonly verdict: VerdictLabel
  /** The reading's own detail line. */
  readonly detail: string
}

/**
 * The per-row judge, shared by the printed run and by `evaluate` (both call the SAME rules).
 * @param id The row id to judge.
 * @param side Which tree's reading is judged.
 * @param reading The row's reading, or nothing when the row never ran.
 * @returns The verdict and its detail line.
 */
export function judgeRow(id: string, side: Side, reading: RowReading | null | undefined): RowVerdict {
  // The scenario this row id names, or nothing when the id is unknown.
  const scenario = SCENARIOS.find((entry) => entry.id === id)
  if (scenario === undefined) return { verdict: "missing", detail: "no such row: " + id }
  if (reading === undefined || reading === null) return { verdict: "missing", detail: "no reading for row " + id }
  // The judges read the DERIVED fields; a reading that carries raw ticks only (the self-test
  // fixtures, and any hand-written observation) is summarised here, so both callers share the
  // exact same rules and no caller can bypass them.
  // The cast asserts the two invariants this line establishes: `Array.isArray` has just proven a
  // tick list is present (so the folding may walk it), and a judge only ever reads the fields its
  // own arm produced — the derived ones materialized right here, the arm's own ones as produced.
  const prepared = (Array.isArray(reading.ticks) && reading.counts === undefined ? summarize(reading as TickedReading) : reading) as JudgedReading
  // Whether this side reproduced the reading the row demands.
  const holds = scenario[side](prepared) === true
  if (side === "red") return { verdict: holds ? (ROW_KIND[id] === "pin" ? "pin" : "red") : "not-reproduced", detail: describe(id, prepared) }
  return { verdict: holds ? "green" : "fail", detail: describe(id, prepared) }
}

/** One row's reading pair inside an observation (`red` = the pinned tree, `green` = the tree under test). */
interface ObservedRow {
  /** The row id. */
  readonly id: string
  /** The row's title, present on a run's own rows. */
  readonly title?: string
  /** The contract's requirement sentence, present on a run's own rows. */
  readonly required?: string
  /** What the RED tree was predicted to do, present on a run's own rows. */
  readonly redPrediction?: string
  /** The row kind, present on a run's own rows. */
  readonly kind?: string
  /** The RED verdict the run recorded. */
  readonly redVerdict?: string
  /** The GREEN verdict the run recorded. */
  readonly greenVerdict?: string
  /** The RED tree's reading, overwritten by the self-test's negative controls. */
  red: RowReading
  /** The GREEN tree's reading, overwritten by the self-test's negative controls. */
  green: RowReading
}

/** One tree's identity block inside an observation. */
interface TreeSummary {
  /** The tree's absolute root. */
  readonly root?: string
  /** The generation the tree probed as (`fold` or `legacy`). */
  readonly generation?: string
  /** The knobs the tree's machine ships, overwritten by the self-test's controls. */
  defaults?: KnobTuple
  /** The tree's file fingerprints. */
  readonly fingerprints?: Partial<TreeFingerprints>
}

/** One tree pair's fingerprints at one measurement moment. */
interface FingerprintPair {
  /** The RED tree's fingerprints. */
  readonly red?: Partial<TreeFingerprints>
  /** The GREEN tree's fingerprints. */
  readonly green?: Partial<TreeFingerprints>
}

/** Both trees' complete fingerprints at one measurement moment, as this lane measures them. */
interface MeasuredFingerprints {
  /** The RED tree's fingerprints. */
  readonly red: TreeFingerprints
  /** The GREEN tree's fingerprints. */
  readonly green: TreeFingerprints
}

/** The row scope one observation covers. */
interface ObservedScope {
  /** The row ids this observation verdicts. */
  readonly rows: readonly string[]
  /** Whether the FULL §9 contract scope ran. */
  readonly full: boolean
}

/** The document `evaluate` reads: a run's own observation, or the self-test's synthetic twin. */
interface Observation {
  /** The rows that ran, in the order the run produced them. */
  rows: ObservedRow[]
  /** The row scope this observation covers. */
  scope?: ObservedScope
  /** The RED tree's identity block. */
  red?: TreeSummary
  /** The GREEN tree's identity block. */
  green?: TreeSummary
  /** Whether the RED tree still matches the contract's frozen hashes. */
  redPinned?: boolean
  /** Whether the fingerprints were identical across the settle window; `null` when none was requested. */
  settled?: boolean | null
  /** The settle window in milliseconds. */
  settleMs?: number
  /** The incident replay section. */
  replay?: ReplayReport | null
  /** The file fingerprints before and after the run. */
  fingerprints?: { readonly before?: FingerprintPair; readonly after?: FingerprintPair }
  /** The instant the run started. */
  startedAt?: string
  /** The instant the run finished. */
  finishedAt?: string
  /** The contract hashes the run asserts. */
  contractRed?: ContractHashes
  /** What the run reconstructs (the incident log it replayed). */
  reconstructionOf?: { readonly incidents: string }
}

/**
 * @param observed The observation to verdict: both trees' readings and the run's own facts.
 * @returns Whether every check holds, with the checks in the order below.
 */
export function evaluate(observed: Observation): LaneVerdict {
  // Every check this evaluation ran, in the order it added them.
  const checks: LaneCheck[] = []
  /**
   * @param id The stable check id.
   * @param ok Whether the assertion held.
   * @param detail The line printed beside the verdict.
   * @returns The new length of the check list.
   */
  const add = (id: string, ok: unknown, detail: unknown): number => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  // The rows the run recorded; a missing list verdicts as no rows at all.
  const rows: ObservedRow[] = Array.isArray(observed?.rows) ? observed.rows : []
  // The recorded rows by id, which every check below looks its subject up in.
  const byId = new Map<string, ObservedRow>(rows.map((row): [string, ObservedRow] => [row.id, row]))
  // A `--row` subset verdicts ONLY the rows it asked for, and says so: the full §9 verdict needs
  // all six rows, so a subset run reports the scope it actually covers instead of failing the
  // rows it never attempted (measured: `--row=e` reported 13 failures before this scope existed).
  const scope = observed?.scope ?? { rows: ROW_IDS, full: true }
  // The rows in scope that the §9 table actually names.
  const scoped = scope.rows.filter((id) => ROW_IDS.includes(id))

  add("CLEAN", scoped.length === scope.rows.length && scoped.length > 0 && scoped.every((id) => byId.has(id)),
    "every row in scope ran exactly once, both trees (" + scoped.join(",") + " of " + ROW_IDS.join(",") + ")")

  for (const id of scoped) {
    // The recorded row this iteration verdicts.
    const row = byId.get(id)
    // The RED-side verdict for this row.
    const red = judgeRow(id, "red", row?.red)
    // The GREEN-side verdict for this row.
    const green = judgeRow(id, "green", row?.green)
    // The labels a RED reading of this row may carry (`pin` for the pinned row (e)).
    const wantedRed = ROW_KIND[id] === "pin" ? ["pin"] : ["red"]
    add("R-" + id, wantedRed.includes(red.verdict),
      "row (" + id + ") RED " + (ROW_KIND[id] === "pin" ? "PIN " : "") + red.verdict + ": " + red.detail)
    add("G-" + id, green.verdict === "green", "row (" + id + ") GREEN " + green.verdict + ": " + green.detail)
  }
  add("SCOPE", scope.full === true || scoped.length > 0,
    scope.full === true ? "the FULL §9 contract scope ran (all " + ROW_IDS.length + " rows)" : "SUBSET run: only rows " + scoped.join(",") + " were verdicts — this is NOT the contract's full §9 verdict")

  /**
   * @param side The tree whose knob tuple is wanted.
   * @returns The tuple that tree reported, or an empty tuple when it reported none.
   */
  const knobsOf = (side: Side): KnobTuple => observed?.[side]?.defaults ?? {}
  // The legacy tuple the contract pins.
  const legacyNumbers = CONTRACT_KNOBS.red
  // The §3 tuple the contract pins.
  const frozenNumbers = CONTRACT_KNOBS.green
  add("KNOBS", knobsOf("red").warnSilenceMs === legacyNumbers.warnSilenceMs && knobsOf("red").warnStreakToEscalate === legacyNumbers.warnStreakToEscalate && knobsOf("red").actionOnEscalate === legacyNumbers.actionOnEscalate &&
    knobsOf("green").warnSilenceMs === frozenNumbers.warnSilenceMs && knobsOf("green").warnStreakToEscalate === frozenNumbers.warnStreakToEscalate && knobsOf("green").actionOnEscalate === frozenNumbers.actionOnEscalate,
    "the two trees carry the two tuples the contract names: RED " + JSON.stringify(knobsOf("red")) + " vs §3 " + JSON.stringify(knobsOf("green")))

  add("PIN-RED", observed?.redPinned === true,
    "the RED tree reproduces the contract's §0/A2 hashes and carries NO channel.ts (" + JSON.stringify(observed?.fingerprints?.after?.red ?? {}) + ")")
  add("SETTLED", observed?.settled !== false,
    observed?.settled === null ? "no settle window requested (--settle-ms 0): the fingerprints were taken once" : "fingerprints identical across the settle window: " + JSON.stringify(observed?.settled))

  // The rows in scope whose GREEN reading the fold must be authoritative for.
  const foldRows = ROW_IDS.filter((id) => ROW_FOLD[id]).filter((id) => scoped.includes(id))
  add("FOLD-AUTHORITY", observed?.green?.generation === "fold" && (foldRows.length === 0 || foldRows.every((id) => byId.get(id)?.green?.predicateSource === "channel")),
    foldRows.length === 0 ? "no fold-decided row in this subset" : "on the working tree the fold is the AUTHORITY for rows " + foldRows.join(",") + " (predicateSource " + JSON.stringify(foldRows.map((id) => byId.get(id)?.green?.predicateSource)) + "), so the suppression cannot be credited to the heartbeat fallback")

  // The replay section, as the run recorded it.
  const replay = observed?.replay
  // The fold machine's pessimistic arm.
  const fold = replay?.fold
  // The fold machine's §4 report-only arm.
  const reportOnly = replay?.foldReportOnly
  // Whether this evaluation covers the full contract, i.e. whether the replay is required.
  const replayExpected = scope.full === true
  add("REPLAY", replayExpected ? (replay !== undefined && replay !== null && replay.rows > 0 && /^[0-9a-f]{64}$/.test(String(replay.sha256)) && replay.escalateHeld >= 1 &&
    (replay.legacy?.counts?.escalate ?? 0) > 0 &&
    typeof fold?.heldEscalationsReproduced === "number" && fold.heldEscalationsReproduced < replay.escalateHeld &&
    (reportOnly?.heldEscalationsReproduced ?? -1) === 0 && (reportOnly?.counts?.escalate ?? 0) === 0 &&
    (reportOnly?.counts?.warn ?? 0) > 0 && (reportOnly?.counts?.warn ?? 0) <= (replay.silenceDistinct ?? 0)) : true,
    replayExpected ? ("the recorded incidents were replayed through BOTH machines on the pinned file (" + replay?.rows + " rows, sha256 " + String(replay?.sha256).slice(0, 12) + "…): the legacy machine reproduces " + (replay?.legacy?.counts?.escalate ?? null) + " escalations (the reconstruction is faithful), while of the " + replay?.escalateHeld + " recorded escalations that HELD a team the fold predicate reproduces " + (fold?.heldEscalationsReproduced ?? null) + " when the channel is reconstructed pessimistically (OUTSTANDING) and " + (reportOnly?.heldEscalationsReproduced ?? null) + " under §4 report-only (no channel evidence)") : "not applicable: no incident replay in a --row subset (contract §9 item 3 is a full-run section)")

  return { ok: checks.every((check) => check.ok), checks }
}

// ── the run ──────────────────────────────────────────────────────────────────────────────
/**
 * @param argv The argv tail to scan for `--out`.
 * @returns The evidence directory, created if needed and refused when it already exists.
 */
function evidenceDirFor(argv: readonly string[]): string {
  // The caller-named target, or `null` when the run must derive a timestamped one.
  const explicit = shellArg(argv, "--out", null)
  // The resolved evidence directory.
  const dir = explicit === null ? join(EVIDENCE_BASE, timestamp()) : resolve(explicit)
  refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Print the lane's usage text. */
function usage(): void {
  console.log("watchdog-redesign — FROZEN CONTRACT §9: the RED→GREEN driver for rows (a)–(f).")
  console.log("")
  console.log("Usage:")
  console.log("  bun " + "skills/dsh-qa/scripts/" + SLUG + ".ts --self-test")
  console.log("  bun " + "skills/dsh-qa/scripts/" + SLUG + ".ts --help | --list")
  console.log("  bun " + "skills/dsh-qa/scripts/" + SLUG + ".ts [--red <tree>] [--green <tree>] [--row a,c] [--out <dir>] [--settle-ms <ms>] [--json]")
  console.log("")
  console.log("  --red <tree>       the RED tree (default " + RED_ROOT + ")")
  console.log("  --green <tree>     the tree under test (default " + REPO + ")")
  console.log("  --row <ids>        a comma-separated subset of " + ROW_IDS.join(",") + " (default: all)")
  console.log("  --out <dir>        evidence directory; MUST NOT EXIST (T-53), default evidence/team-watchdog/redesign/lane/<ts>")
  console.log("  --settle-ms <ms>   re-measure the fingerprints after this window (default 0)")
  console.log("  --incidents <file> the incident log to replay (default " + INCIDENTS + ")")
  console.log("  --list             print the rows and exit")
  console.log("  --json             also print the result JSON")
}

/** The run's parsed options. */
interface RunOptions {
  /** The RED tree root (absolute). */
  readonly red: string
  /** The tree under test (absolute). */
  readonly green: string
  /** The row ids this run verdicts, in the order the caller gave them. */
  readonly rows: string[]
  /** The settle window in milliseconds; `0` means the fingerprints are taken once. */
  readonly settleMs: number
  /** The incident log to replay (absolute). */
  readonly incidents: string
  /** Whether the result JSON is also printed. */
  readonly json: boolean
}

/** The lane's result document: the observed run, the verdict, and where the evidence landed. */
interface RedesignResult extends Observation, LaneResult {
  /** The evidence directory this run wrote into. */
  readonly evidenceDir: string
  /** The `result.json` path, filled in once the evidence is written. */
  evidenceFile?: string
}

/**
 * @param argv The process argv tail.
 * @returns The finished result document (its evidence already written).
 */
async function run(argv: readonly string[]): Promise<RedesignResult> {
  // The run's options, every one of them argv-driven.
  const opts: RunOptions = {
    red: resolve(shellArg(argv, "--red", RED_ROOT)),
    green: resolve(shellArg(argv, "--green", REPO)),
    rows: String(shellArg(argv, "--row", ROW_IDS.join(","))).split(",").map((id) => id.trim()).filter((id) => id !== ""),
    settleMs: Number(shellArg(argv, "--settle-ms", "0")) || 0,
    incidents: resolve(shellArg(argv, "--incidents", INCIDENTS)),
    json: argv.includes("--json"),
  }
  // The requested row ids that the §9 table does not name.
  const unknown = opts.rows.filter((id) => !ROW_IDS.includes(id))
  if (unknown.length > 0) throw new Error("unknown row id(s): " + unknown.join(",") + " (known: " + ROW_IDS.join(",") + ")")
  // The immutable evidence directory this run writes into.
  const dir = evidenceDirFor(argv)
  // The raw scratch root the run's sandboxes live under.
  const rawRoot = join(dir, "raw")
  mkdirSync(rawRoot, { recursive: true })
  // The instant the run started.
  const startedAt = new Date().toISOString()
  // The RED tree's own modules.
  const redTree = await loadTree(opts.red, "red")
  // The tree under test's own modules.
  const greenTree = await loadTree(opts.green, "green")
  // The two trees, keyed by side.
  const trees: TreePair = { red: redTree, green: greenTree }
  say(SLUG, "[" + startedAt + "] contract §9 rows " + opts.rows.join(",") + " — RED " + opts.red + " vs GREEN " + opts.green)
  if (!existsSync(opts.red)) say(SLUG, "WARNING: the RED tree does not exist: " + opts.red)
  // The fingerprints before the run, re-measured after it.
  const before: MeasuredFingerprints = { red: fingerprint(opts.red), green: fingerprint(opts.green) }
  say(SLUG, "generations: red=" + redTree.generation + " green=" + greenTree.generation)
  say(SLUG, "knobs: red " + JSON.stringify({ warnSilenceMs: redTree.defaults.warnSilenceMs, streak: redTree.defaults.warnStreakToEscalate, action: redTree.defaults.actionOnEscalate }) + " | green " + JSON.stringify({ warnSilenceMs: greenTree.defaults.warnSilenceMs, streak: greenTree.defaults.warnStreakToEscalate, action: greenTree.defaults.actionOnEscalate }))

  // Every row that ran, with both sides' readings.
  const rows: ObservedRow[] = []
  // The per-run cache of the tree-independent suite reading.
  const suiteReadings: Map<string, RowReading> = new Map()
  for (const scenario of SCENARIOS) {
    if (!opts.rows.includes(scenario.id)) continue
    // This row's reading on the pinned RED tree.
    const red = await produceReading(redTree, scenario, rawRoot, suiteReadings)
    // This row's reading on the tree under test.
    const green = await produceReading(greenTree, scenario, rawRoot, suiteReadings)
    // The RED-side verdict for this row.
    const redJudge = judgeRow(scenario.id, "red", red)
    // The GREEN-side verdict for this row.
    const greenJudge = judgeRow(scenario.id, "green", green)
    rows.push({
      id: scenario.id, title: scenario.title, required: scenario.required, redPrediction: scenario.redPrediction, kind: scenario.kind,
      redVerdict: redJudge.verdict, greenVerdict: greenJudge.verdict, red, green,
    })
    say(SLUG, "")
    say(SLUG, "row (" + scenario.id + ") " + scenario.title)
    say(SLUG, "  required     : " + scenario.required)
    say(SLUG, "  RED   verdict: " + redJudge.verdict.toUpperCase() + " — " + redJudge.detail)
    say(SLUG, "  GREEN verdict: " + greenJudge.verdict.toUpperCase() + " — " + greenJudge.detail)
    say(SLUG, "  row verdict  : red=" + redJudge.verdict + " green=" + greenJudge.verdict)
  }

  // The incident replay, or nothing when this run did not cover the full contract.
  let replay: ReplayResult | null = null
  // Whether every §9 row ran, which is what the replay section requires.
  const fullRun = opts.rows.length === ROW_IDS.length
  if (existsSync(opts.incidents) && fullRun) {
    replay = replayIncidents(opts.incidents, trees)
    say(SLUG, "")
    say(SLUG, "incidents replay (" + replay.rows + " recorded rows, sha256 " + replay.sha256.slice(0, 12) + "…, " + replay.escalateHeld + " of " + replay.escalateRows + " escalations held a team):")
    say(SLUG, "  legacy machine: " + JSON.stringify(replay.legacy.counts) + " (held-key escalations reproduced " + replay.legacy.heldEscalationsReproduced + ")")
    say(SLUG, "  fold   machine: " + JSON.stringify(replay.fold.counts) + " (held-key escalations reproduced " + replay.fold.heldEscalationsReproduced + ")")
    for (const entry of replay.fold.heldKeysReproduced) {
      say(SLUG, "    reproduced " + entry.key + " — recorded rows " + entry.recordedRows + ", max recorded silence " + entry.maxSilenceMs + " ms (cause " + JSON.stringify(entry.kinds) + ")")
    }
    say(SLUG, "  fold   §4 report-only: " + JSON.stringify(replay.foldReportOnly.counts) + " (held-key escalations reproduced " + replay.foldReportOnly.heldEscalationsReproduced + ")")
    say(SLUG, "  bound: " + replay.bound)
  }

  if (opts.settleMs > 0) {
    say(SLUG, "")
    say(SLUG, "settling " + opts.settleMs + " ms before the settled-hash re-measurement …")
    await new Promise<void>((done): void => {
      setTimeout(done, opts.settleMs)
    })
  }
  // The fingerprints after the run, compared with the ones taken before it.
  const after: MeasuredFingerprints = { red: fingerprint(opts.red), green: fingerprint(opts.green) }
  // Whether the RED tree still matches every frozen hash the contract pins.
  const redPinned = after.red.machine === CONTRACT_RED.machine && after.red.engine === CONTRACT_RED.engine && after.red.tools === CONTRACT_RED.tools && after.red.channel === "(absent)"
  // Whether the tree changed under the run; `null` when no settle window was requested.
  const settled = opts.settleMs > 0 ? JSON.stringify(before) === JSON.stringify(after) : null
  say(SLUG, "")
  say(SLUG, "RED pin (contract §0/A2): machine=" + after.red.machine.slice(0, 8) + " engine=" + after.red.engine.slice(0, 8) + " tools=" + after.red.tools.slice(0, 8) + " channel=" + after.red.channel + " → redPinned=" + redPinned)
  say(SLUG, "settled=" + (settled === null ? "not requested (--settle-ms 0)" : settled) + " | green fingerprint: " + JSON.stringify({ machine: after.green.machine.slice(0, 12), engine: after.green.engine.slice(0, 12), channel: after.green.channel.slice(0, 12), tools: after.green.tools.slice(0, 12) }))

  // The observation the evaluator and the result are both built from.
  const observed: Observation = {
    startedAt,
    finishedAt: new Date().toISOString(),
    scope: { rows: [...opts.rows], full: fullRun },
    red: { root: opts.red, generation: redTree.generation, defaults: { ...redTree.defaults }, fingerprints: after.red },
    green: { root: opts.green, generation: greenTree.generation, defaults: { ...greenTree.defaults }, fingerprints: after.green },
    fingerprints: { before, after },
    settleMs: opts.settleMs,
    settled,
    redPinned,
    rows,
    replay,
    contractRed: CONTRACT_RED,
    reconstructionOf: { incidents: opts.incidents },
  }
  // The evaluator's verdict over that observation.
  const verdict = evaluate(observed)
  // The result document: the observation, the verdict and the run's own evidence path.
  const result: RedesignResult = {
    ...observed,
    ...verdict,
    evidenceDir: dir,
    ...(fullRun ? {} : { notClaimed: ["a --row subset run verdicts only the requested rows (" + opts.rows.join(",") + "); it is NOT the contract's full §9 verdict"] }),
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  if (opts.json) console.log(JSON.stringify({ ok: result.ok, checks: result.checks, rows: result.rows.map((row) => ({ id: row.id, red: judgeRow(row.id, "red", row.red).verdict, green: judgeRow(row.id, "green", row.green).verdict })) }, null, 2))
  return result
}

// ── self-test: the SAME evaluator, on synthetic readings, with negative controls ─────────
/** Every stdout line this run printed, captured so the evidence log carries them. */
const CAPTURE: StdoutCapture = captureStdout()
/** The argv tail this process was started with, without the runtime and the script path. */
const argv: string[] = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  CAPTURE.restore()
  usage()
  process.exit(0)
}
if (argv.includes("--list")) {
  CAPTURE.restore()
  for (const scenario of SCENARIOS) console.log("(" + scenario.id + ") [" + ROW_KIND[scenario.id] + "] " + scenario.title + " → " + scenario.required)
  process.exit(0)
}
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  /**
   * @param offset The tick's offset from the arm's "now", in milliseconds.
   * @param decisions The decision types this tick produced.
   * @param holds The holds this tick returned.
   * @param holdOnDisk Whether the hold sidecar existed after this tick.
   * @returns One synthetic tick reading.
   */
  const tick = (offset: number, decisions: string[], holds: string[] = [], holdOnDisk: boolean = false): TickReading => ({ offset, decisions, holds, holdOnDisk })
  /**
   * @param overrides The fields this synthetic reading overrides.
   * @returns One synthetic engine reading, in the fold generation's healthy shape.
   */
  const reading = (overrides: RowReading): RowReading => ({
    tree: "synthetic", scenario: "synthetic", ticks: [tick(1_000, [])],
    defaults: CONTRACT_KNOBS.green, predicateSource: "channel", states: { a1: "OUTSTANDING" },
    stats: { channelDependencyBlocked: 1, toolExpired: 1 }, teamBytesUntouched: true,
    ...overrides,
  })
  /**
   * @param overrides The fields this synthetic reading overrides.
   * @returns The same synthetic reading; the name records which side it stands for.
   */
  const greenFold = (overrides: RowReading): RowReading => reading(overrides)
  // One healthy reading per row, in the shape each arm's own judge accepts.
  const healthyReadings: Record<string, { red: RowReading; green: RowReading }> = {
    a: {
      red: greenFold({ ticks: [tick(601_000, ["warn"]), tick(700_000, ["warn"]), tick(800_000, ["warn", "escalate"], ["team-a"], true)], defaults: CONTRACT_KNOBS.red, predicateSource: null, states: null }),
      green: greenFold({ ticks: [tick(601_000, []), tick(700_000, []), tick(800_000, [], [], false)], states: { a1: "ALIVE" } }),
    },
    b: { red: greenFold({ defaults: CONTRACT_KNOBS.red, ticks: [tick(601_000, ["warn"]), tick(700_000, ["warn"]), tick(800_000, ["warn", "escalate"], ["team-a"], true)] }), green: greenFold({ ticks: [tick(601_000, []), tick(900_000, [], [], false)], stats: { channelDependencyBlocked: 1 } }) },
    c: {
      red: greenFold({ update: { ok: false, error: "team probe-team is held by the team watchdog (hold hold-probe-1); …" }, claim: { ok: false, error: "held" }, holdReads: { fromTools: 2 }, reinject: { ran: false, rejected: false }, guardInToolsSource: true, registeredTools: 30 }),
      green: greenFold({ update: { ok: true, mutated: true }, claim: { ok: true, mutated: true }, holdReads: { fromTools: 0 }, reinject: { ran: true, rejected: true }, guardInToolsSource: false, registeredTools: 30 }),
    },
    d: {
      red: greenFold({ defaults: CONTRACT_KNOBS.red, ticks: [tick(91_000, ["warn"]), tick(181_000, ["warn"]), tick(271_000, ["warn", "escalate"], ["team-a"], true)] }),
      green: greenFold({ ticks: [tick(599_000, []), tick(600_001, ["warn"]), tick(610_000, ["warn"]), tick(620_000, ["warn"]), tick(630_000, ["warn"]), tick(640_000, ["warn"]), tick(650_000, ["warn", "escalate"]), tick(660_000, ["warn"])] }),
    },
    e: { red: greenFold({ stats: { toolExpired: 1, holdsApplied: 0 }, ticks: [tick(900_001, []), tick(1_800_000, [])] }), green: greenFold({ stats: { toolExpired: 1, holdsApplied: 0 }, ticks: [tick(900_001, []), tick(1_800_000, [])] }) },
    f: {
      red: greenFold({ defaults: CONTRACT_KNOBS.red, ticks: [tick(1_000, ["warn"]), tick(2_000, ["warn"]), tick(3_000, ["warn", "escalate"], ["team-a"], true)] }),
      green: greenFold({ stats: { neverStarted: 1 }, ticks: [tick(601_000, []), tick(1_100_000, [])] }),
    },
    // Row (g) is SUITE-driven, so its fixture is the instrument's OWN verdict shape: the four D-2
    // readings held (green) and BOTH controls detected their mutant (red) — the same object serves
    // both sides because the instrument carries both directions in one run.
    g: {
      red: { instrument: "packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts", exit: 0, tests: { readings: { present: true, passed: true }, kickControl: { present: true, passed: true }, claimUpdateControl: { present: true, passed: true } } },
      green: { instrument: "packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts", exit: 0, tests: { readings: { present: true, passed: true }, kickControl: { present: true, passed: true }, claimUpdateControl: { present: true, passed: true } } },
    },
  }
  // The synthetic healthy observation the evaluator must accept before any control runs.
  const healthy: Observation = {
    scope: { rows: [...ROW_IDS], full: true },
    red: { root: RED_ROOT, generation: "legacy", defaults: { ...CONTRACT_KNOBS.red, toolInFlightMaxMs: 900_000 }, fingerprints: { machine: CONTRACT_RED.machine, engine: CONTRACT_RED.engine, tools: CONTRACT_RED.tools, channel: "(absent)" } },
    green: { root: REPO, generation: "fold", defaults: { ...CONTRACT_KNOBS.green, toolInFlightMaxMs: 900_000 }, fingerprints: { machine: "9".repeat(64) } },
    fingerprints: {
      before: { red: { machine: CONTRACT_RED.machine, engine: CONTRACT_RED.engine, tools: CONTRACT_RED.tools, channel: "(absent)" }, green: {} },
      after: { red: { machine: CONTRACT_RED.machine, engine: CONTRACT_RED.engine, tools: CONTRACT_RED.tools, channel: "(absent)" }, green: { machine: "9".repeat(64) } },
    },
    redPinned: true, settled: true, settleMs: 50_000,
    rows: ROW_IDS.map((id): ObservedRow => ({ id, red: healthyReadings[id].red, green: healthyReadings[id].green })),
    replay: {
      rows: 184, sha256: "a".repeat(64), escalateRows: 30, escalateHeld: 18, silenceRows: 119, silenceDistinct: 96, reconstruction: true,
      legacy: { counts: { warn: 90, escalate: 30 }, heldEscalationsReproduced: 30 },
      fold: { counts: { warn: 79, escalate: 4 }, heldEscalationsReproduced: 3, heldKeysReproduced: [] },
      foldReportOnly: { counts: { warn: 18, escalate: 0 }, heldEscalationsReproduced: 0 },
    },
  }
  selfTest(SLUG, evaluate, healthy, [
    // The control names row (a), which the healthy fixture above always records, so the lookup
    // cannot come back empty here.
    ["row-silent-on-red", (copy: Observation): void => { copy.rows.find((row) => row.id === "a")!.red = greenFold({ ticks: [tick(601_000, []), tick(800_000, [], [], false)] }) }, "a RED row that reproduced nothing (the contrast is the contract's whole point)"],
    // The control names row (d), which the healthy fixture above always records.
    ["green-warns", (copy: Observation): void => { copy.rows.find((row) => row.id === "d")!.green = greenFold({ ticks: [tick(599_000, []), tick(600_001, ["warn"]), tick(610_000, ["warn"]), tick(620_000, ["warn"]), tick(630_000, ["warn"]), tick(640_000, ["warn"]), tick(650_000, ["warn", "escalate"], ["team-a"], true)] }) }, "a GREEN ladder that warns below 600 000 and holds"],
    // The control names row (d), whose synthetic reading always carries a tick list.
    ["early-warn", (copy: Observation): void => {
      // The GREEN reading this control rewrites.
      const green = copy.rows.find((row) => row.id === "d")!.green
      green.ticks![1] = tick(599_999, ["warn"]); green.ticks![0] = tick(599_999, [])
    }, "a first WARN before the frozen threshold"],
    // The control names row (c), which the healthy fixture above always records.
    ["vacuous-hold-row", (copy: Observation): void => { copy.rows.find((row) => row.id === "c")!.green.reinject = { ran: true, rejected: false } }, "a hold row whose success could not be falsified (the re-injection control did not refuse)"],
    // The control names row (c), which the healthy fixture above always records.
    ["guard-read-from-tools", (copy: Observation): void => { copy.rows.find((row) => row.id === "c")!.green.holdReads = { fromTools: 1 } }, "a tool-boundary hold read that survived the redesign"],
    // The control names row (e), which the healthy fixture above always records.
    ["pin-broken", (copy: Observation): void => { copy.rows.find((row) => row.id === "e")!.green.stats = { toolExpired: 2, holdsApplied: 0 } }, "the r6 pin repeating the tool-expired bound or applying a hold"],
    ["red-drifted", (copy: Observation): void => { copy.redPinned = false }, "a RED tree that no longer matches the contract's frozen hashes"],
    ["settle-moved", (copy: Observation): void => { copy.settled = false }, "a tree that changed under the run"],
    // The control names row (a), which the healthy fixture above always records.
    ["fold-not-authoritative", (copy: Observation): void => { copy.rows.find((row) => row.id === "a")!.green.predicateSource = "heartbeat" }, "a GREEN reading whose suppression came from the §4 fallback, not the fold"],
    ["knobs-drifted", (copy: Observation): void => { copy.green!.defaults = { warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" } }, "a working tree still carrying the legacy tuple"],
    ["replay-missing", (copy: Observation): void => { copy.replay = null }, "no incident replay (contract §9 item 3)"],
    // The synthetic replay above is always present, so a control may dereference it directly.
    ["replay-regression", (copy: Observation): void => { copy.replay!.fold.heldEscalationsReproduced = copy.replay!.escalateHeld }, "a fold predicate that would have reproduced every historical hold"],
    ["report-only-escalates", (copy: Observation): void => { copy.replay!.foldReportOnly = { counts: { escalate: 1 }, heldEscalationsReproduced: 1 } }, "a §4 report-only replay that escalates (the fallback is not permitted to)"],
    // The synthetic replay above is always present, so a control may dereference it directly.
    ["replay-unfaithful", (copy: Observation): void => { copy.replay!.legacy.counts = { warn: 0, escalate: 0 }; copy.replay!.escalateHeld = 0 }, "a reconstruction that cannot even reproduce the recorded escalations"],
    ["row-missing", (copy: Observation): void => { copy.rows = copy.rows.filter((row) => row.id !== "b") }, "a contract row that never ran"],
  ])
}
try {
  // The finished run: its evidence is already written when this resolves.
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  if (error instanceof ImmutableOutputError) exitOnRefusal(error, "[" + SLUG + "]")
  // The thrown value is `unknown` under strict mode; it is viewed as a stack-bearing record so a
  // plain-object crash still reports its own `.stack`, exactly as that expression did before.
  say(SLUG, "CRASH: " + String((error as { stack?: unknown } | null)?.stack ?? error))
  process.exit(1)
}
