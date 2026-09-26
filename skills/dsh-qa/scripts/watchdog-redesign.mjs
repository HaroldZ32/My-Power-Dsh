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
//   bun skills/dsh-qa/scripts/watchdog-redesign.mjs --self-test
//   bun skills/dsh-qa/scripts/watchdog-redesign.mjs --help
//   bun skills/dsh-qa/scripts/watchdog-redesign.mjs [--red <tree>] [--green <tree>] [--row a,c]
//                                                    [--out <dir>] [--settle-ms <ms>] [--list] [--json]
// Evidence -> evidence/team-watchdog/redesign/lane/<timestamp>/{result.json,output.log,raw/}
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ImmutableOutputError, exitOnRefusal, refuseOverwrite, timestamp } from "./lib/immutable-output.mjs"
import { REPO, captureStdout, finish, say, selfTest, sha256, writeEvidence } from "./lib/watchdog-lane.mjs"

const SLUG = "watchdog-redesign"
const STATE_DIR = join(".mpd", "team")
const PLUGIN = join("packages", "mpd-team-watchdog-plugin")
const ADOPTED_LIB = join("packages", "mpd-agent-teams-plugin", "lib")
const EVIDENCE_BASE = join(REPO, "evidence", "team-watchdog", "redesign", "lane")
const RED_ROOT = join(REPO, ".mpd", "red-baseline")
const INCIDENTS = join(REPO, ".mpd", "team", "watchdog", "incidents.jsonl")
const SESSION = { id: "a1" }
const GUARD_TEXT = "is held by the team watchdog"

/** The contract's frozen legacy hashes (A2) — the RED tree must reproduce ALL of them. */
const CONTRACT_RED = {
  machine: "fc10fc41f404d79457660403f9645483fe123e588df6bfe5b8b55c4b8728c1ef",
  engine: "f529ca2cdef498eca8b60c441824aa5ab898689bc60c3c81ffc7da063f49281b",
  tools: "49025f4d9901fb2599f42bbb5233ead2a71837a65f51e1d6d95c567c002422d2",
}
/** §3: the frozen numbers the redesign must run with. */
const CONTRACT_KNOBS = { red: { warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" }, green: { warnSilenceMs: 600_000, warnStreakToEscalate: 6, actionOnEscalate: "warn-only" } }

const ROW_IDS = ["a", "b", "c", "d", "e", "f", "g"]
/** `pin` = the contract expects the same reading on both trees (§9 row e). */
const ROW_KIND = { a: "contrast", b: "contrast", c: "contrast", d: "contrast", e: "pin", f: "contrast", g: "contrast" }
/** Rows whose GREEN reading is decided by the channel fold (must show `predicateSource: channel`). */
const ROW_FOLD = { a: true, b: true, d: true }

// ── shared helpers ────────────────────────────────────────────────────────────────────────
const shellArg = (argv, name, fallback) => {
  const at = argv.indexOf(name)
  if (at >= 0 && typeof argv[at + 1] === "string" && !argv[at + 1].startsWith("--")) return argv[at + 1]
  const eq = argv.find((item) => item.startsWith(name + "="))
  return eq === undefined ? fallback : eq.slice(name.length + 1)
}
const fileSha = (path) => (existsSync(path) ? sha256(readFileSync(path)) : "(absent)")
const countBy = (rows, of) => rows.reduce((all, row) => { const key = String(of(row)); all[key] = (all[key] ?? 0) + 1; return all }, {})
const incidentKey = (row) => row.teamId + "|" + row.taskId + "|" + (row.attemptId ?? "")

function fingerprint(root) {
  return {
    machine: fileSha(join(root, PLUGIN, "src", "machine.ts")),
    engine: fileSha(join(root, PLUGIN, "src", "engine.ts")),
    channel: fileSha(join(root, PLUGIN, "src", "channel.ts")),
    team: fileSha(join(root, PLUGIN, "src", "team.ts")),
    dist: fileSha(join(root, PLUGIN, "dist", "index.js")),
    tools: fileSha(join(root, ADOPTED_LIB, "tools.js")),
  }
}

/** Load one tree's OWN watchdog modules. The generation is PROBED, never a hardcoded flag. */
async function loadTree(root, label) {
  const src = join(root, PLUGIN, "src")
  const machine = await import(pathToFileURL(join(src, "machine.ts")).href)
  const engine = await import(pathToFileURL(join(src, "engine.ts")).href)
  const paths = await import(pathToFileURL(join(src, "paths.ts")).href)
  const hasChannel = existsSync(join(src, "channel.ts"))
  const channel = hasChannel ? await import(pathToFileURL(join(src, "channel.ts")).href) : null
  return { label, root, generation: hasChannel ? "fold" : "legacy", machine, engine, paths, channel, defaults: machine.WATCHDOG_DEFAULTS }
}

/** The stub adapter: the only harness surface the engine uses (the shape the family's tests use). */
function stubAdapter(workspace) {
  const tools = new Map()
  const listeners = new Map()
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
        const list = listeners.get(event) ?? []
        list.push(handler)
        listeners.set(event, list)
        return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1) }
      },
      toolRuntime: () => ({ get: (name) => tools.get(name), execute: async () => undefined }),
      capabilities: () => ({}),
    },
    emit: (event, ...payload) => { let called = 0; for (const handler of listeners.get(event) ?? []) { handler(...payload); called += 1 } return called },
    listenerCount: (event) => (listeners.get(event) ?? []).length,
  }
}

const ev = (type, data = {}, time = 0) => ({ type, seq: 1, time, data })
const agentOf = (workspace) => ({ id: "a1", session: { id: "a1", header: { cwd: workspace } } })

/** One heartbeat line, exactly the fields the trees' readers consume. */
function stampLine(kind, at, { workspace, teamId = "team-a", member = "Architect", taskId = "t1", attemptId = "", callId, tool }) {
  return JSON.stringify({
    kind, at, member, memberKey: member, teamId, taskId, attemptId, turnId: member + "#1",
    ...(callId === undefined ? {} : { callId }),
    ...(tool === undefined ? {} : { tool }),
    workspace,
  })
}

/** A team record shaped like the real ones (`members[].id` and `captainSessionId` present). */
function teamRecord(base, { createdAt, taskStatus = "in_progress", attemptId = "att-1", dependencies = [], extra } = {}) {
  const memberId = "a1"
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
const SCENARIOS = [
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

const KICK_INSTRUMENT = "packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts"
// The row's DRIVING is delegated to the plugin's OWN instrument (the instrument-home ruling): lane C's
// suite already carries the four D-2 readings AND both negative controls, so this row re-runs it and
// verdicts from ITS result instead of inventing a second home.
const KICK_TESTS = {
  readings: "held: the kick is ANSWERED with a NAMED decline, zero deliveries, team bytes untouched; claim+update still SUCCEED",
  kickControl: "CONTROL (kick): neutering the hold read site delivers while held — the KICK arm REDDENS",
  claimUpdateControl: "CONTROL (claim/update): re-injecting the pre-redesign tool guard REFUSES the same calls",
}
function testState(entry) {
  if (entry === undefined) return "absent"
  return entry.passed === true ? "pass" : "fail"
}
/** Row (g): run the plugin's own T-48 instrument and read ITS verdicts. Tree-independent by design. */
async function runKickRow() {
  const proc = spawnSync("bun", ["test", KICK_INSTRUMENT], { cwd: REPO, encoding: "utf8", timeout: 600_000, env: { ...process.env, NO_COLOR: "1" } })
  const text = String(proc.stdout ?? "") + String(proc.stderr ?? "")
  const tests = {}
  for (const [key, name] of Object.entries(KICK_TESTS)) {
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
/** One row's reading: the engine arm, the tools arm, or the suite arm (cached — it is tree-independent). */
async function produceReading(tree, scenario, rawRoot, suiteReadings) {
  if (scenario.kind === "tools") return runHoldRow(tree, rawRoot)
  if (scenario.kind === "suite") {
    if (!suiteReadings.has(scenario.id)) suiteReadings.set(scenario.id, await runKickRow())
    return suiteReadings.get(scenario.id)
  }
  return runScenario(tree, scenario, rawRoot)
}

// ── the engine arm: one scenario, one tree, one sandbox ──────────────────────────────────
async function runScenario(tree, scenario, rawRoot) {
  const workspace = mkdtempSync(join(rawRoot, scenario.id + "-" + tree.label + "-"))
  const handle = stubAdapter(workspace)
  const teamDir = join(workspace, STATE_DIR, "team-a")
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  const base = Date.now()
  writeFileSync(join(teamDir, "team.json"), JSON.stringify(scenario.record(base), null, 2) + "\n")
  const teamFile = join(teamDir, "team.json")
  const heartbeat = tree.paths.heartbeatPath(workspace, STATE_DIR, "Architect")
  mkdirSync(dirname(heartbeat), { recursive: true })
  writeFileSync(heartbeat, scenario.stamps(base, workspace).join("\n") + "\n")
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
  const disposers = engine.install()
  const ticks = []
  try {
    scenario.events(handle, workspace, base)
    const bytesBefore = readFileSync(teamFile, "utf8")
    for (const offset of scenario.ticks(tree)) {
      const result = await engine.tickOnce(base + offset)
      ticks.push({
        offset,
        decisions: result.decisions.map((decision) => decision.type),
        holds: [...result.holds],
        holdOnDisk: existsSync(join(workspace, STATE_DIR, "watchdog", "hold", "team-a.json")),
      })
    }
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

/** The derived reading: decisions folded into counts + the decisive booleans. */
function summarize(raw) {
  const counts = {}
  let firstWarnAt = null
  let firstEscalateAt = null
  for (const tick of raw.ticks) {
    for (const type of tick.decisions) {
      counts[type] = (counts[type] ?? 0) + 1
      if (type === "warn" && firstWarnAt === null) firstWarnAt = tick.offset
      if (type === "escalate" && firstEscalateAt === null) firstEscalateAt = tick.offset
    }
  }
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
/** The scratch re-injection control (the shape `self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` uses). */
async function runReinjection(tree, rawRoot, workspace, captain, member) {
  const pluginRoot = join(tree.root, "packages", "mpd-agent-teams-plugin")
  const libDir = join(pluginRoot, "lib")
  const scratch = mkdtempSync(join(rawRoot, "c-" + tree.label + "-reinject-"))
  mkdirSync(join(scratch, "lib"), { recursive: true })
  for (const entry of readdirSync(libDir, { withFileTypes: true })) if (entry.isFile()) cpSync(join(libDir, entry.name), join(scratch, "lib", entry.name))
  symlinkSync(join(pluginRoot, "_deps"), join(scratch, "_deps"), "junction")
  const scratchTools = join(scratch, "lib", "tools.js")
  const source = readFileSync(scratchTools, "utf8")
  const registration = source.indexOf("name: 'agent_teams_update_task'")
  const execute = source.indexOf("async execute(args, exec) {", registration)
  if (registration < 0 || execute < 0) return { ran: false, rejected: false, error: "the injection anchor was not found in lib/tools.js (registration=" + registration + ", execute=" + execute + ")" }
  const guard = "\n            { const __held = watchdogHoldOf(ctx, freshTeamProbeId, workspaceOf(exec.agent)); if (__held !== undefined) throw new Error(`team ${freshTeamProbeId} is held by the team watchdog (hold ${__held.holdId}); the team must be released with the watchdog's own session-watchdog-resume action before any further work`); }"
  const reader = "const WATCHDOG_HOLD_SERVICE = 'mpdWatchdog';\nfunction watchdogHoldOf(ctx, teamId, workspace) {\n    try {\n        const watchdog = typeof ctx?.get === 'function' ? ctx.get(WATCHDOG_HOLD_SERVICE, false) : undefined;\n        const view = typeof watchdog?.isHeld === 'function' ? watchdog.isHeld(teamId, workspace) : undefined;\n        if (view === undefined || view === null || view.held !== true)\n            return undefined;\n        return { holdId: String(view.holdId ?? ''), at: 0, reason: String(view.reason ?? ''), source: null };\n    }\n    catch {\n        return undefined;\n    }\n}\nconst freshTeamProbeId = 'probe-team';\n"
  writeFileSync(scratchTools, reader + source.slice(0, execute + "async execute(args, exec) {".length) + guard + source.slice(execute + "async execute(args, exec) {".length))
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => (name === "mpdWatchdog" ? { isHeld: () => ({ held: true, holdId: "hold-probe-1", at: 0, reason: "reinject control" }) } : undefined),
  }
  try {
    const mod = await import(pathToFileURL(scratchTools).href + "?reinject=" + Date.now())
    mod.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
    const definition = tools.get("agent_teams_update_task")
    if (definition === undefined) return { ran: true, rejected: false, error: "the injected copy registered no `agent_teams_update_task`" }
    await definition.execute({ task_id: "t2", status: "completed", output: "re-injection control", attempt_id: "att-2", acceptanceResults: [{ criterion: "probe", status: "passed" }], commandsRun: [{ command: "bun test", status: "passed" }] }, { agent: member })
    return { ran: true, rejected: false, error: "the re-injected guard did NOT refuse the same call" }
  } catch (error) {
    const text = String(error?.message ?? error)
    return { ran: true, rejected: new RegExp(GUARD_TEXT).test(text), error: text }
  }
}

async function runHoldRow(tree, rawRoot) {
  const workspace = mkdtempSync(join(rawRoot, "c-" + tree.label + "-"))
  const teamId = "probe-team"
  const now = Date.now()
  const captain = { id: "session-captain", status: "idle", session: { header: { cwd: workspace } } }
  const member = { id: "session-member", status: "idle", session: { header: { cwd: workspace } } }
  const teamDir = join(workspace, STATE_DIR, teamId)
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  const task = (id, status, attemptId, attempt) => ({
    id, subject: "probe " + id, description: "hold probe", status, assignee: "Architect", dependencies: [],
    ...(attemptId === undefined ? {} : { attemptId }), attempt, createdAt: now - 60_000, updatedAt: now - 60_000,
    kind: "verification", acceptance: ["probe"], verify: ["bun test"], acceptanceResults: [], commandsRun: [],
  })
  const teamFile = join(teamDir, "team.json")
  writeFileSync(teamFile, JSON.stringify({
    id: teamId, name: "hold probe", captainSessionId: captain.id, createdAt: now - 60_000, taskSeq: 2, phase: "running",
    members: [{ id: member.id, name: "Architect", role: "architect", status: "idle", joinedAt: now - 60_000 }],
    tasks: [task("t1", "pending", undefined, 0), task("t2", "in_progress", "att-2", 1)],
  }, null, 2) + "\n")
  // The REAL hold sidecar (the disk truth a reader can consult) — plus the service shape the
  // deleted guard consumed, so BOTH sources of the hold are live in this probe.
  const hold = { id: "hold-probe-1", teamId, since: now, cause: "silence", taskId: "t2", attemptId: "att-2", sceneAt: now, ttlMs: 900_000 }
  mkdirSync(join(workspace, STATE_DIR, "watchdog", "hold"), { recursive: true })
  writeFileSync(join(workspace, STATE_DIR, "watchdog", "hold", teamId + ".json"), JSON.stringify(hold, null, 2) + "\n")
  const reads = []
  const watchdog = {
    isHeld: (id, ws) => {
      reads.push({ teamId: id, workspace: ws, frame: ((new Error("hold-read").stack ?? "").split("\n")[2] ?? "").trim() })
      return id === teamId ? { held: true, holdId: hold.id, at: hold.since, reason: hold.cause, source: "service" } : undefined
    },
  }
  const tools = new Map()
  const ctx = {
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => (name === "mpdWatchdog" ? watchdog : undefined),
  }
  const toolsPath = join(tree.root, ADOPTED_LIB, "tools.js")
  const mod = await import(pathToFileURL(toolsPath).href + "?tree=" + tree.label)
  mod.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const call = async (name, args, agent) => {
    const definition = tools.get(name)
    if (definition === undefined) return { ok: false, error: "tool not registered: " + name }
    try {
      const value = await definition.execute(args, { agent })
      let echo = null
      try { echo = value === undefined ? null : JSON.parse(JSON.stringify(value)) } catch { echo = String(value) }
      return { ok: true, value: echo }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
  // The terminal-update payload carries the completion coverage the quality gate requires
  // (`acceptanceResults` + `commandsRun`), so a GREEN refusal could only come from a hold guard:
  // the first diagnostic run of this lane measured exactly that gate's own message on GREEN
  // ("verification completion requires passed acceptanceResults …") and the payload was fixed.
  const TERMINAL_UPDATE = { task_id: "t2", status: "completed", output: "hold probe complete", attempt_id: "att-2", acceptanceResults: [{ criterion: "probe", status: "passed" }], commandsRun: [{ command: "bun test", status: "passed" }] }
  const update = await call("agent_teams_update_task", TERMINAL_UPDATE, member)
  const claim = await call("agent_teams_claim_task", { task_id: "t1" }, member)
  const onDisk = JSON.parse(readFileSync(teamFile, "utf8"))
  const tasksOnDisk = onDisk.tasks ?? []
  update.mutated = tasksOnDisk.find((entry) => entry.id === "t2")?.status === "completed"
  claim.mutated = String(tasksOnDisk.find((entry) => entry.id === "t1")?.attemptId ?? "") !== ""
  const reinject = tree.generation === "fold" ? await runReinjection(tree, rawRoot, workspace, captain, member) : { ran: false, rejected: false, error: "not run: the guard is present in this tree's lib/tools.js, so the control is not applicable" }
  return {
    tree: tree.label,
    scenario: "c",
    workspace,
    registeredTools: [...tools.keys()].length,
    toolNames: [...tools.keys()].filter((name) => name.includes("claim_task") || name.includes("update_task")),
    update, claim, reinject,
    holdOnDisk: existsSync(join(workspace, STATE_DIR, "watchdog", "hold", teamId + ".json")),
    holdReads: { total: reads.length, fromTools: reads.filter((read) => read.frame.includes("lib/tools.js") || read.frame.includes("/tools.js")).length, frames: reads.map((read) => read.frame) },
    guardInToolsSource: readFileSync(toolsPath, "utf8").includes(GUARD_TEXT),
  }
}

// ── contract §9 item 3: the recorded incidents, replayed through each tree's OWN machine ──
function replayIncidents(path, trees) {
  const raw = readFileSync(path, "utf8")
  const lines = raw.split("\n").filter((line) => line.trim() !== "")
  const rows = []
  let malformed = 0
  for (const line of lines) { try { rows.push(JSON.parse(line)) } catch { malformed += 1 } }
  const escalates = rows.filter((row) => row.kind === "escalate")
  const heldKeys = new Set(escalates.filter((row) => row.hold === "applied").map(incidentKey))
  const chrono = rows.filter((row) => row.cause?.kind === "silence" && typeof row.cause.ms === "number").sort((left, right) => left.at - right.at)
  const replayed = (tree, mode) => {
    const machine = new tree.machine.WatchdogMachine()
    const knobs = tree.machine.WATCHDOG_DEFAULTS
    const counts = {}
    const seen = new Map()
    const reproduced = new Set()
    let heldReproduced = 0
    for (const row of chrono) {
      const since = row.at - row.cause.ms
      const key = incidentKey(row)
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
      const candidate = {
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
      heldKeysReproduced: [...reproduced].sort().map((key) => seen.get(key)),
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
function describe(id, reading) {
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

/** The per-row judge, shared by the printed run and by `evaluate` (both call the SAME rules). */
export function judgeRow(id, side, reading) {
  const scenario = SCENARIOS.find((entry) => entry.id === id)
  if (scenario === undefined) return { verdict: "missing", detail: "no such row: " + id }
  if (reading === undefined || reading === null) return { verdict: "missing", detail: "no reading for row " + id }
  // The judges read the DERIVED fields; a reading that carries raw ticks only (the self-test
  // fixtures, and any hand-written observation) is summarised here, so both callers share the
  // exact same rules and no caller can bypass them.
  const prepared = Array.isArray(reading.ticks) && reading.counts === undefined ? summarize(reading) : reading
  const holds = scenario[side](prepared) === true
  if (side === "red") return { verdict: holds ? (ROW_KIND[id] === "pin" ? "pin" : "red") : "not-reproduced", detail: describe(id, prepared) }
  return { verdict: holds ? "green" : "fail", detail: describe(id, prepared) }
}

export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  const rows = Array.isArray(observed?.rows) ? observed.rows : []
  const byId = new Map(rows.map((row) => [row.id, row]))
  // A `--row` subset verdicts ONLY the rows it asked for, and says so: the full §9 verdict needs
  // all six rows, so a subset run reports the scope it actually covers instead of failing the
  // rows it never attempted (measured: `--row=e` reported 13 failures before this scope existed).
  const scope = observed?.scope ?? { rows: ROW_IDS, full: true }
  const scoped = scope.rows.filter((id) => ROW_IDS.includes(id))

  add("CLEAN", scoped.length === scope.rows.length && scoped.length > 0 && scoped.every((id) => byId.has(id)),
    "every row in scope ran exactly once, both trees (" + scoped.join(",") + " of " + ROW_IDS.join(",") + ")")

  for (const id of scoped) {
    const row = byId.get(id)
    const red = judgeRow(id, "red", row?.red)
    const green = judgeRow(id, "green", row?.green)
    const wantedRed = ROW_KIND[id] === "pin" ? ["pin"] : ["red"]
    add("R-" + id, wantedRed.includes(red.verdict),
      "row (" + id + ") RED " + (ROW_KIND[id] === "pin" ? "PIN " : "") + red.verdict + ": " + red.detail)
    add("G-" + id, green.verdict === "green", "row (" + id + ") GREEN " + green.verdict + ": " + green.detail)
  }
  add("SCOPE", scope.full === true || scoped.length > 0,
    scope.full === true ? "the FULL §9 contract scope ran (all " + ROW_IDS.length + " rows)" : "SUBSET run: only rows " + scoped.join(",") + " were verdicts — this is NOT the contract's full §9 verdict")

  const knobsOf = (side) => observed?.[side]?.defaults ?? {}
  const legacyNumbers = CONTRACT_KNOBS.red
  const frozenNumbers = CONTRACT_KNOBS.green
  add("KNOBS", knobsOf("red").warnSilenceMs === legacyNumbers.warnSilenceMs && knobsOf("red").warnStreakToEscalate === legacyNumbers.warnStreakToEscalate && knobsOf("red").actionOnEscalate === legacyNumbers.actionOnEscalate &&
    knobsOf("green").warnSilenceMs === frozenNumbers.warnSilenceMs && knobsOf("green").warnStreakToEscalate === frozenNumbers.warnStreakToEscalate && knobsOf("green").actionOnEscalate === frozenNumbers.actionOnEscalate,
    "the two trees carry the two tuples the contract names: RED " + JSON.stringify(knobsOf("red")) + " vs §3 " + JSON.stringify(knobsOf("green")))

  add("PIN-RED", observed?.redPinned === true,
    "the RED tree reproduces the contract's §0/A2 hashes and carries NO channel.ts (" + JSON.stringify(observed?.fingerprints?.after?.red ?? {}) + ")")
  add("SETTLED", observed?.settled !== false,
    observed?.settled === null ? "no settle window requested (--settle-ms 0): the fingerprints were taken once" : "fingerprints identical across the settle window: " + JSON.stringify(observed?.settled))

  const foldRows = ROW_IDS.filter((id) => ROW_FOLD[id]).filter((id) => scoped.includes(id))
  add("FOLD-AUTHORITY", observed?.green?.generation === "fold" && (foldRows.length === 0 || foldRows.every((id) => byId.get(id)?.green?.predicateSource === "channel")),
    foldRows.length === 0 ? "no fold-decided row in this subset" : "on the working tree the fold is the AUTHORITY for rows " + foldRows.join(",") + " (predicateSource " + JSON.stringify(foldRows.map((id) => byId.get(id)?.green?.predicateSource)) + "), so the suppression cannot be credited to the heartbeat fallback")

  const replay = observed?.replay
  const fold = replay?.fold
  const reportOnly = replay?.foldReportOnly
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
function evidenceDirFor(argv) {
  const explicit = shellArg(argv, "--out", null)
  const dir = explicit === null ? join(EVIDENCE_BASE, timestamp()) : resolve(explicit)
  refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  mkdirSync(dir, { recursive: true })
  return dir
}

function usage() {
  console.log("watchdog-redesign — FROZEN CONTRACT §9: the RED→GREEN driver for rows (a)–(f).")
  console.log("")
  console.log("Usage:")
  console.log("  bun " + "skills/dsh-qa/scripts/" + SLUG + ".mjs --self-test")
  console.log("  bun " + "skills/dsh-qa/scripts/" + SLUG + ".mjs --help | --list")
  console.log("  bun " + "skills/dsh-qa/scripts/" + SLUG + ".mjs [--red <tree>] [--green <tree>] [--row a,c] [--out <dir>] [--settle-ms <ms>] [--json]")
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

async function run(argv) {
  const opts = {
    red: resolve(shellArg(argv, "--red", RED_ROOT)),
    green: resolve(shellArg(argv, "--green", REPO)),
    rows: String(shellArg(argv, "--row", ROW_IDS.join(","))).split(",").map((id) => id.trim()).filter((id) => id !== ""),
    settleMs: Number(shellArg(argv, "--settle-ms", "0")) || 0,
    incidents: resolve(shellArg(argv, "--incidents", INCIDENTS)),
    json: argv.includes("--json"),
  }
  const unknown = opts.rows.filter((id) => !ROW_IDS.includes(id))
  if (unknown.length > 0) throw new Error("unknown row id(s): " + unknown.join(",") + " (known: " + ROW_IDS.join(",") + ")")
  const dir = evidenceDirFor(argv)
  const rawRoot = join(dir, "raw")
  mkdirSync(rawRoot, { recursive: true })
  const startedAt = new Date().toISOString()
  const redTree = await loadTree(opts.red, "red")
  const greenTree = await loadTree(opts.green, "green")
  const trees = { red: redTree, green: greenTree }
  say(SLUG, "[" + startedAt + "] contract §9 rows " + opts.rows.join(",") + " — RED " + opts.red + " vs GREEN " + opts.green)
  if (!existsSync(opts.red)) say(SLUG, "WARNING: the RED tree does not exist: " + opts.red)
  const before = { red: fingerprint(opts.red), green: fingerprint(opts.green) }
  say(SLUG, "generations: red=" + redTree.generation + " green=" + greenTree.generation)
  say(SLUG, "knobs: red " + JSON.stringify({ warnSilenceMs: redTree.defaults.warnSilenceMs, streak: redTree.defaults.warnStreakToEscalate, action: redTree.defaults.actionOnEscalate }) + " | green " + JSON.stringify({ warnSilenceMs: greenTree.defaults.warnSilenceMs, streak: greenTree.defaults.warnStreakToEscalate, action: greenTree.defaults.actionOnEscalate }))

  const rows = []
  const suiteReadings = new Map()
  for (const scenario of SCENARIOS) {
    if (!opts.rows.includes(scenario.id)) continue
    const red = await produceReading(redTree, scenario, rawRoot, suiteReadings)
    const green = await produceReading(greenTree, scenario, rawRoot, suiteReadings)
    const redJudge = judgeRow(scenario.id, "red", red)
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

  let replay = null
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
    await new Promise((done) => setTimeout(done, opts.settleMs))
  }
  const after = { red: fingerprint(opts.red), green: fingerprint(opts.green) }
  const redPinned = after.red.machine === CONTRACT_RED.machine && after.red.engine === CONTRACT_RED.engine && after.red.tools === CONTRACT_RED.tools && after.red.channel === "(absent)"
  const settled = opts.settleMs > 0 ? JSON.stringify(before) === JSON.stringify(after) : null
  say(SLUG, "")
  say(SLUG, "RED pin (contract §0/A2): machine=" + after.red.machine.slice(0, 8) + " engine=" + after.red.engine.slice(0, 8) + " tools=" + after.red.tools.slice(0, 8) + " channel=" + after.red.channel + " → redPinned=" + redPinned)
  say(SLUG, "settled=" + (settled === null ? "not requested (--settle-ms 0)" : settled) + " | green fingerprint: " + JSON.stringify({ machine: after.green.machine.slice(0, 12), engine: after.green.engine.slice(0, 12), channel: after.green.channel.slice(0, 12), tools: after.green.tools.slice(0, 12) }))

  const observed = {
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
  const verdict = evaluate(observed)
  const result = {
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
const CAPTURE = captureStdout()
const argv = process.argv.slice(2)

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
  const tick = (offset, decisions, holds = [], holdOnDisk = false) => ({ offset, decisions, holds, holdOnDisk })
  const reading = (overrides) => ({
    tree: "synthetic", scenario: "synthetic", ticks: [tick(1_000, [])],
    defaults: CONTRACT_KNOBS.green, predicateSource: "channel", states: { a1: "OUTSTANDING" },
    stats: { channelDependencyBlocked: 1, toolExpired: 1 }, teamBytesUntouched: true,
    ...overrides,
  })
  const greenFold = (overrides) => reading(overrides)
  const healthyReadings = {
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
  const healthy = {
    scope: { rows: [...ROW_IDS], full: true },
    red: { root: RED_ROOT, generation: "legacy", defaults: { ...CONTRACT_KNOBS.red, toolInFlightMaxMs: 900_000 }, fingerprints: { machine: CONTRACT_RED.machine, engine: CONTRACT_RED.engine, tools: CONTRACT_RED.tools, channel: "(absent)" } },
    green: { root: REPO, generation: "fold", defaults: { ...CONTRACT_KNOBS.green, toolInFlightMaxMs: 900_000 }, fingerprints: { machine: "9".repeat(64) } },
    fingerprints: {
      before: { red: { machine: CONTRACT_RED.machine, engine: CONTRACT_RED.engine, tools: CONTRACT_RED.tools, channel: "(absent)" }, green: {} },
      after: { red: { machine: CONTRACT_RED.machine, engine: CONTRACT_RED.engine, tools: CONTRACT_RED.tools, channel: "(absent)" }, green: { machine: "9".repeat(64) } },
    },
    redPinned: true, settled: true, settleMs: 50_000,
    rows: ROW_IDS.map((id) => ({ id, red: healthyReadings[id].red, green: healthyReadings[id].green })),
    replay: {
      rows: 184, sha256: "a".repeat(64), escalateRows: 30, escalateHeld: 18, silenceRows: 119, silenceDistinct: 96, reconstruction: true,
      legacy: { counts: { warn: 90, escalate: 30 }, heldEscalationsReproduced: 30 },
      fold: { counts: { warn: 79, escalate: 4 }, heldEscalationsReproduced: 3, heldKeysReproduced: [] },
      foldReportOnly: { counts: { warn: 18, escalate: 0 }, heldEscalationsReproduced: 0 },
    },
  }
  selfTest(SLUG, evaluate, healthy, [
    ["row-silent-on-red", (copy) => { copy.rows.find((row) => row.id === "a").red = greenFold({ ticks: [tick(601_000, []), tick(800_000, [], [], false)] }) }, "a RED row that reproduced nothing (the contrast is the contract's whole point)"],
    ["green-warns", (copy) => { copy.rows.find((row) => row.id === "d").green = greenFold({ ticks: [tick(599_000, []), tick(600_001, ["warn"]), tick(610_000, ["warn"]), tick(620_000, ["warn"]), tick(630_000, ["warn"]), tick(640_000, ["warn"]), tick(650_000, ["warn", "escalate"], ["team-a"], true)] }) }, "a GREEN ladder that warns below 600 000 and holds"],
    ["early-warn", (copy) => { const green = copy.rows.find((row) => row.id === "d").green; green.ticks[1] = tick(599_999, ["warn"]); green.ticks[0] = tick(599_999, []) }, "a first WARN before the frozen threshold"],
    ["vacuous-hold-row", (copy) => { copy.rows.find((row) => row.id === "c").green.reinject = { ran: true, rejected: false } }, "a hold row whose success could not be falsified (the re-injection control did not refuse)"],
    ["guard-read-from-tools", (copy) => { copy.rows.find((row) => row.id === "c").green.holdReads = { fromTools: 1 } }, "a tool-boundary hold read that survived the redesign"],
    ["pin-broken", (copy) => { copy.rows.find((row) => row.id === "e").green.stats = { toolExpired: 2, holdsApplied: 0 } }, "the r6 pin repeating the tool-expired bound or applying a hold"],
    ["red-drifted", (copy) => { copy.redPinned = false }, "a RED tree that no longer matches the contract's frozen hashes"],
    ["settle-moved", (copy) => { copy.settled = false }, "a tree that changed under the run"],
    ["fold-not-authoritative", (copy) => { copy.rows.find((row) => row.id === "a").green.predicateSource = "heartbeat" }, "a GREEN reading whose suppression came from the §4 fallback, not the fold"],
    ["knobs-drifted", (copy) => { copy.green.defaults = { warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" } }, "a working tree still carrying the legacy tuple"],
    ["replay-missing", (copy) => { copy.replay = null }, "no incident replay (contract §9 item 3)"],
    ["replay-regression", (copy) => { copy.replay.fold.heldEscalationsReproduced = copy.replay.escalateHeld }, "a fold predicate that would have reproduced every historical hold"],
    ["report-only-escalates", (copy) => { copy.replay.foldReportOnly = { counts: { escalate: 1 }, heldEscalationsReproduced: 1 } }, "a §4 report-only replay that escalates (the fallback is not permitted to)"],
    ["replay-unfaithful", (copy) => { copy.replay.legacy.counts = { warn: 0, escalate: 0 }; copy.replay.escalateHeld = 0 }, "a reconstruction that cannot even reproduce the recorded escalations"],
    ["row-missing", (copy) => { copy.rows = copy.rows.filter((row) => row.id !== "b") }, "a contract row that never ran"],
  ])
}
try {
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  if (error instanceof ImmutableOutputError) exitOnRefusal(error, "[" + SLUG + "]")
  say(SLUG, "CRASH: " + String(error?.stack ?? error))
  process.exit(1)
}
