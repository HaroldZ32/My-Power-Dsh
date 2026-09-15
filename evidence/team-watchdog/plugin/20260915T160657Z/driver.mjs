// t54 evidence driver — writer half.
//
// Runs the PLUGIN'S OWN code (src/, via bun's TS resolution) in THIS process:
//   * `apply()` with a stub adapter/ctx — the real row entry (config resolution,
//     action registration, the single tick interval);
//   * the real heartbeat writers through the installed event handlers and the
//     adapter's POST hook;
//   * the real tick, driven at an injected `now`.
//
// It then spawns `node reader.mjs` — a SEPARATE process that shares no code with
// the plugin — and reports both verdicts.
//
// Usage: bun driver.mjs
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const PKG = join(REPO, "packages", "mpd-team-watchdog-plugin")
if (!existsSync(join(PKG, "src", "index.ts"))) {
  console.error("FATAL: repo root resolution is wrong — " + join(PKG, "src", "index.ts") + " does not exist")
  process.exit(2)
}

const { apply } = await import(join(PKG, "src", "index.ts"))
const { readHeartbeats } = await import(join(PKG, "src", "store.ts"))
const { ackIncidents } = await import(join(PKG, "src", "sidecars.ts"))

const WS = join(HERE, "raw", "ws")
// An explicit stateDir, NOT the shipped `.mpd/team` default: `.mpd/` is
// gitignored at any depth, and this fixture must stay committed so a reader can
// inspect the real artifacts. The plugin resolves stateDir per call from its row
// config, and the shipped default IS exercised by the mounted boot and the unit
// suite.
const STATE_DIR = join("state", "team")
const TEAM = "team-a"

// ── a fresh fixture workspace ────────────────────────────────────────────────
rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, STATE_DIR, TEAM, "inbox"), { recursive: true })
const teamRecord = {
  id: TEAM,
  name: "Team A",
  phase: "running",
  captainSessionId: "sess-captain",
  members: [
    { id: "agent-architect", name: "Architect", status: "working" },
    { id: "agent-senior", name: "Senior Engineer", status: "working" },
  ],
  tasks: [
    // t1 is the escalation subject: its owner stamps and then goes silent.
    { id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" },
    // t2 is claimed but its owner NEVER stamps: the non-escalating `never-started` case.
    { id: "t2", status: "claimed", assignee: "Senior Engineer", attempt: 1, attemptId: "att-2" },
  ],
}
writeFileSync(join(WS, STATE_DIR, TEAM, "team.json"), JSON.stringify(teamRecord, null, 2))
// One UNREAD mailbox record, so members[].unread has something to mirror.
writeFileSync(
  join(WS, STATE_DIR, TEAM, "inbox", "architect.jsonl"),
  JSON.stringify({ id: "m1", from: "captain", text: "please continue" }) + "\n",
)
const teamBefore = createHash("sha256").update(readFileSync(join(WS, STATE_DIR, TEAM, "team.json"))).digest("hex")

// ── a minimal adapter + ctx (the ONLY harness surface the row uses) ──────────
const tools = new Map()
const postListeners = []
const settings = { watchdog: { warnSilenceMs: 90_000, tickIntervalMs: 15_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" } }
const adapter = {
  workspaceRoot: (exec) => exec?.agent?.session?.header?.cwd ?? WS,
  workspaceRootsAll: () => [WS],
  settingsReader: () => ({ get: () => settings, describe: () => undefined }),
  onSettingsDocumentUpdated: () => () => {},
  registerTool: (definition) => {
    tools.set(definition.name, definition)
    return () => tools.delete(definition.name)
  },
  onPostToolExecute: (listener) => {
    postListeners.push(listener)
    return () => {
      const index = postListeners.indexOf(listener)
      if (index >= 0) postListeners.splice(index, 1)
    }
  },
  toolRuntime: () => ({
    get: (toolName) => tools.get(toolName),
    execute: async (input) => {
      const definition = tools.get(input.name)
      if (definition === undefined) throw new Error("unknown tool " + input.name)
      return await definition.execute(input.arguments ?? {}, {})
    },
  }),
}
const handlers = new Map()
const ctx = {
  get: (id) => (id === "mpdDsh" ? adapter : undefined),
  on: (event, handler) => {
    handlers.set(event, handler)
    return () => handlers.delete(event)
  },
  effect: () => {},
  logger: { warn: (text) => console.error(text), info: (text) => console.log(text) },
}

// ── the real row entry ──────────────────────────────────────────────────────
const report = apply(ctx, { stateDir: STATE_DIR, teamCacheMs: 0 })
const engine = report.engine
const agent = (id, sessionId, cwd = WS) => ({ id, session: { id: sessionId, header: { cwd } } })

// ── the real writers ────────────────────────────────────────────────────────
const step = handlers.get("agent/pre-step")
const stopping = handlers.get("agent/turn-stopping")
const stepWait = () => new Promise((resolve) => setTimeout(resolve, 3))

handlers.get("agent/session-start")?.({ agent: agent("agent-architect", "sess-architect") })
for (let index = 0; index < 3; index += 1) {
  step?.({ agent: agent("agent-architect", "sess-architect"), turn: 1, step: index + 1 })
  await stepWait()
}
// The POST hook fires on COMPLETION: the listener is the plugin's tool stamp.
const postReturn = postListeners[0]?.({ name: "read", callId: "call-1", agent: agent("agent-architect", "sess-architect") }, { isError: false }, { kind: "accept" })
// The captain is an agent like any member and is stamped by the same code path. It
// holds no task in this fixture, so its stamps carry taskId null and it is not a
// silence candidate (a taskless captain cannot wedge a task).
handlers.get("agent/session-start")?.({ agent: agent("captain-agent", "sess-captain") })
step?.({ agent: agent("captain-agent", "sess-captain"), turn: 1, step: 1 })
await stepWait()
postListeners[0]?.({ name: "agent_teams_update_task", callId: "call-2", agent: agent("captain-agent", "sess-captain") }, { isError: false }, { kind: "accept" })

const architectStamps = readHeartbeats(WS, STATE_DIR, "Architect")
const silenceFrom = architectStamps[architectStamps.length - 1].at

// ── the real tick, at an injected now ───────────────────────────────────────
const tick1 = await engine.tickOnce(silenceFrom + 90_001)
const tick2 = await engine.tickOnce(silenceFrom + 90_002)
const tick3 = await engine.tickOnce(silenceFrom + 90_003)
const tick4 = await engine.tickOnce(silenceFrom + 90_004)
ackIncidents(WS, STATE_DIR, "web", tick1.decisions[0]?.lastSeen ?? silenceFrom + 90_001)

// The Senior Engineer's task never stamped: the machine reports it once as a
// non-escalating `never-started` observation, counted (never pushed into the
// WARN/ESCALATE decision list, because it must never escalate).
const neverStartedCounted = engine.getStats().neverStarted

// ── the SEPARATE reader process ─────────────────────────────────────────────
const reader = spawnSync(process.execPath, [join(HERE, "reader.mjs"), WS, STATE_DIR], { encoding: "utf8" })
const teamAfter = createHash("sha256").update(readFileSync(join(WS, STATE_DIR, TEAM, "team.json"))).digest("hex")
const teamBytesAfter = readFileSync(join(WS, STATE_DIR, TEAM, "team.json"), "utf8")

const engineStats = engine.getStats()
engine.stop()

// ── the `mpd` namespace is the AUTHORITY over the row config, and a live change
//    re-reads the knobs without a restart (the same real `apply`, a second mount) ──
function mount(settingsValue) {
  const tools2 = new Map()
  const post2 = []
  const listeners2 = []
  let value = settingsValue
  const adapter2 = {
    workspaceRoot: () => WS,
    workspaceRootsAll: () => [WS],
    settingsReader: () => ({ get: () => value, describe: () => undefined }),
    onSettingsDocumentUpdated: (_ns, listener) => {
      listeners2.push(listener)
      return () => {}
    },
    registerTool: (definition) => {
      tools2.set(definition.name, definition)
      return () => tools2.delete(definition.name)
    },
    onPostToolExecute: (listener) => {
      post2.push(listener)
      return () => {}
    },
    toolRuntime: () => ({ get: (n) => tools2.get(n), execute: async (input) => tools2.get(input.name)?.execute(input.arguments ?? {}, {}) }),
  }
  const ctx2 = {
    get: (id) => (id === "mpdDsh" ? adapter2 : undefined),
    on: () => () => {},
    effect: () => {},
    logger: { warn: () => {}, info: () => {} },
  }
  const report2 = apply(ctx2, { stateDir: STATE_DIR, teamCacheMs: 0 })
  return {
    report: report2,
    emit: (next) => {
      value = next
      for (const listener of listeners2) listener(2, "user")
    },
  }
}
const live = mount({ watchdog: { warnSilenceMs: 1_234, tickIntervalMs: 111, warnStreakToEscalate: 7, actionOnEscalate: "warn-only" } })
const liveBefore = live.report.knobs
live.emit({ watchdog: { warnSilenceMs: 4_321, tickIntervalMs: 222, warnStreakToEscalate: 2, actionOnEscalate: "pause" } })
const liveAfter = live.report.engine.getKnobs()
live.report.engine.stop()

const result = {
  task: "t54",
  plugin: "packages/mpd-team-watchdog-plugin",
  fixture: { workspace: WS, stateDir: STATE_DIR, team: TEAM },
  apply: { applied: report.applied, disposers: report.disposers, intervalMs: report.intervalMs, knobs: { enabled: report.knobs.enabled, warnSilenceMs: report.knobs.warnSilenceMs, tickIntervalMs: report.knobs.tickIntervalMs, warnStreakToEscalate: report.knobs.warnStreakToEscalate, actionOnEscalate: report.knobs.actionOnEscalate }, issues: report.knobs.issues },
  tools: [...tools.keys()].sort(),
  postHookReturn: postReturn === undefined ? "undefined (pass-through)" : String(postReturn),
  heartbeatArchitect: architectStamps.map((s) => ({ kind: s.kind, at: s.at, tool: s.tool, taskId: s.taskId, attemptId: s.attemptId })),
  ticks: [tick1, tick2, tick3, tick4].map((tick) => ({ decisions: tick.decisions.map((d) => ({ type: d.type, taskId: d.taskId, streak: d.streak, silenceMs: d.silenceMs })), scenes: tick.scenes.length, holds: tick.holds })),
  neverStartedObservations: neverStartedCounted,
  engineStats,
  adoptedRecordUnchanged: {
    sha256Before: teamBefore,
    sha256After: teamAfter,
    identical: teamBefore === teamAfter,
    bytes: teamBytesAfter.length,
  },
  reader: { exitCode: reader.status, stderr: reader.stderr.trim(), verdict: reader.stdout ? JSON.parse(reader.stdout) : null },
  namespaceAuthority: {
    note: "the mpd namespace OVERRIDES the row config (defaults layer), and a settings/document-updated re-read takes effect with no restart",
    readAtApply: { warnSilenceMs: liveBefore.warnSilenceMs, tickIntervalMs: liveBefore.tickIntervalMs, warnStreakToEscalate: liveBefore.warnStreakToEscalate, actionOnEscalate: liveBefore.actionOnEscalate, intervalMs: live.report.intervalMs },
    readAfterLiveEdit: { warnSilenceMs: liveAfter.warnSilenceMs, tickIntervalMs: liveAfter.tickIntervalMs, warnStreakToEscalate: liveAfter.warnStreakToEscalate, actionOnEscalate: liveAfter.actionOnEscalate },
  },
  ok:
    reader.status === 0 &&
    teamBefore === teamAfter &&
    tick1.decisions.filter((d) => d.type === "warn").length === 1 &&
    neverStartedCounted === 1 &&
    tick2.decisions.map((d) => d.type).join(",") === "warn" &&
    tick3.decisions.map((d) => d.type).join(",") === "escalate" &&
    tick4.decisions.length === 0,
  tickShape: {
    tick1: tick1.decisions.map((d) => d.type),
    tick2: tick2.decisions.map((d) => d.type),
    tick3: tick3.decisions.map((d) => d.type),
    tick4: tick4.decisions.map((d) => d.type),
  },
}
writeFileSync(join(HERE, "raw", "driver.result.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
