// §9 ROWS (a), (b), (d) — RED before GREEN, on two trees, with a per-row verdict.
//
// Contract §9: "Every row is an assertion that FAILS on `.mpd/red-baseline` and PASSES after
// the change. The driver ... MUST print a per-row `red`/`green` verdict for both trees."
//
// This driver mounts EACH tree's own modules (its own `engine.ts`, `machine.ts`, `store.ts`)
// against an identical scenario, so the comparison is between two real engines and not between
// a real one and a re-implementation:
//
//   RED   = <repo>/.mpd/red-baseline           (detached HEAD 75018a1, hashes pinned)
//   GREEN = <repo>                            (the lane-A1 tree)
//
// The sandbox workspace is INSIDE this evidence directory: the driver never touches the repo's
// real `.mpd/team` (or any other task's evidence path).
//
// Usage: bun rows-driver.mjs [--out <dir>] [--settle-ms 50000]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const OUT = resolve(argOf("--out", HERE))
const SETTLE_MS = Number(argOf("--settle-ms", "50000"))
const REPO = resolve(HERE, "../../../../..")
const RED_ROOT = join(REPO, ".mpd", "red-baseline")
const PLUGIN = join("packages", "mpd-team-watchdog-plugin")
const SOURCES = ["src/machine.ts", "src/engine.ts", "src/channel.ts", "dist/index.js"]
/** The THIRD baseline file of the contract header — the adopted plugin's tool surface. */
const TOOLS = join("..", "mpd-agent-teams-plugin", "lib", "tools.js")
/**
 * The contract's three cited baseline hashes (header §16). A2 (captain amendment) requires them
 * re-measured from BOTH trees: the ROOT tree legitimately moves once the lane lands, so the
 * reproducible side is `.mpd/red-baseline` (detached 75018a1) — the driver reports both and the
 * per-file match, instead of asserting a value nobody can reproduce.
 */
const CONTRACT_RED = {
  machine: "fc10fc41f404d79457660403f9645483fe123e588df6bfe5b8b55c4b8728c1ef",
  engine: "f529ca2cdef498eca8b60c441824aa5ab898689bc60c3c81ffc7da063f49281b",
  tools: "49025f4d9901fb2599f42bbb5233ead2a71837a65f51e1d6d95c567c002422d2",
}

const lines = []
const log = (text) => {
  lines.push(text)
  console.log(text)
}

/** The pinned hashes of one tree (a missing file is reported as `(absent)`, never as a match). */
function hashes(root) {
  const out = {}
  for (const rel of SOURCES) {
    const path = join(root, PLUGIN, rel)
    out[rel] = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "(absent)"
  }
  const tools = join(root, PLUGIN, TOOLS)
  out["tools.js"] = existsSync(tools) ? createHash("sha256").update(readFileSync(tools)).digest("hex") : "(absent)"
  return out
}

/**
 * A2 (captain amendment 2026-09-17): re-measure the THREE baseline hashes the contract's header
 * cites, from the repo root AND from the RED worktree, and record the per-file match. Recorded
 * per tree so the reading is not a claim about "the hash is somewhere on disk".
 */
function baselineHashes(root) {
  const machine = hashes(root)["src/machine.ts"]
  const engine = hashes(root)["src/engine.ts"]
  const tools = hashes(root)["tools.js"]
  return {
    root,
    machine,
    engine,
    tools,
    matchesContract: {
      machine: machine === CONTRACT_RED.machine,
      engine: engine === CONTRACT_RED.engine,
      tools: tools === CONTRACT_RED.tools,
    },
    sha256sum: ["machine.ts=" + machine, "engine.ts=" + engine, "tools.js=" + tools],
  }
}

/** The stub adapter: the ONLY harness surface the engine uses (same shape as the test support). */
function stubAdapter(workspace) {
  const tools = new Map()
  const listeners = new Map()
  const pre = []
  const post = []
  return {
    adapter: {
      workspaceRoot: () => workspace,
      workspaceRootsAll: () => [workspace],
      settingsReader: () => ({ get: () => undefined, describe: () => undefined }),
      onSettingsDocumentUpdated: () => () => {},
      registerTool: (definition) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      onPreToolExecute: (listener) => {
        pre.push(listener)
        return () => {}
      },
      onPostToolExecute: (listener) => {
        post.push(listener)
        return () => {}
      },
      onEvent: (event, handler) => {
        const list = listeners.get(event) ?? []
        list.push(handler)
        listeners.set(event, list)
        return () => {
          const index = list.indexOf(handler)
          if (index >= 0) list.splice(index, 1)
        }
      },
      toolRuntime: () => ({
        get: (name) => tools.get(name),
        execute: async (input) => {
          const definition = tools.get(input.name)
          if (definition === undefined) throw new Error("unknown tool " + input.name)
          return await definition.execute(input.arguments ?? {}, {})
        },
      }),
      capabilities: () => ({}),
    },
    emit: (event, ...payload) => {
      let called = 0
      for (const handler of listeners.get(event) ?? []) {
        handler(...payload)
        called += 1
      }
      return called
    },
  }
}

const ctxStub = { on: () => () => {}, logger: { warn: () => {}, info: () => {} } }
const agent = (workspace) => ({ id: "a1", session: { id: "a1", header: { cwd: workspace } } })
const ev = (type, data = {}, time = 0) => ({ type, seq: 1, time, data })

/** A fresh sandbox workspace INSIDE this evidence directory (never the repo's real state). */
function sandbox() {
  const workspace = mkdtempSync(join(OUT, "sandbox-"))
  return { workspace, stateDir: ".mpd/team", cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

/**
 * Write the adopted team record + (optionally) ONE heartbeat stamp by hand.
 *
 * The stamp is written to the path the TREE'S OWN `heartbeatPath()` computes — `safeSegment`
 * lowercases the member key, so a hand-built `<workspace>/…/Architect.jsonl` would sit beside
 * the real file and the candidate would read as `never-started` (measured while writing this
 * driver). A previous-generation stamp (empty `attemptId`) is what T-16 is about.
 */
function writeFixture(box, base, opts = {}) {
  const teamDir = join(box.workspace, box.stateDir, "team-a")
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  writeFileSync(
    join(teamDir, "team.json"),
    JSON.stringify(
      {
        id: "team-a",
        name: "team-a",
        phase: "running",
        createdAt: base - 86_400_000,
        updatedAt: base,
        members: [{ id: "a1", name: "Architect", status: "running" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1", updatedAt: base }],
      },
      null,
      2,
    ),
  )
  if (opts.stampAt === undefined) return
  const path = opts.heartbeatPath
  mkdirSync(dirname(path), { recursive: true })
  const stamp = {
    kind: "step",
    at: opts.stampAt,
    member: "Architect",
    memberKey: "Architect",
    teamId: "team-a",
    taskId: "t1",
    attemptId: opts.attemptId ?? "att-1",
    turnId: "Architect#1",
    workspace: box.workspace,
  }
  writeFileSync(path, JSON.stringify(stamp) + "\n")
}

/** Mount one tree's engine against one sandbox. */
async function mount(tree, box, base) {
  const engineUrl = pathToFileURL(join(tree, PLUGIN, "src", "engine.ts")).href
  const machineUrl = pathToFileURL(join(tree, PLUGIN, "src", "machine.ts")).href
  const pathsUrl = pathToFileURL(join(tree, PLUGIN, "src", "paths.ts")).href
  const { WatchdogEngine } = await import(engineUrl)
  const { WATCHDOG_DEFAULTS } = await import(machineUrl)
  const { heartbeatPath } = await import(pathsUrl)
  const stub = stubAdapter(box.workspace)
  const config = {
    stateDir: box.stateDir,
    enabled: true,
    warnSilenceMs: WATCHDOG_DEFAULTS.warnSilenceMs,
    tickIntervalMs: WATCHDOG_DEFAULTS.tickIntervalMs,
    warnStreakToEscalate: WATCHDOG_DEFAULTS.warnStreakToEscalate,
    actionOnEscalate: WATCHDOG_DEFAULTS.actionOnEscalate,
    holdTtlMs: WATCHDOG_DEFAULTS.holdTtlMs ?? 0,
    teamCacheMs: 0,
    keepGenerations: 3,
    deadTeamGraceMs: 86_400_000,
    toolInFlightMaxMs: WATCHDOG_DEFAULTS.toolInFlightMaxMs,
    verboseSkips: false,
    logPrefix: "rows-driver",
  }
  const engine = new WatchdogEngine(stub.adapter, ctxStub, config)
  const disposers = engine.install()
  void base
  return {
    engine,
    stub,
    config,
    defaults: WATCHDOG_DEFAULTS,
    heartbeatPath: (memberKey) => heartbeatPath(box.workspace, box.stateDir, memberKey),
    dispose: () => {
      for (const off of disposers) off()
      engine.stop()
    },
  }
}

const holdFile = (box) => join(box.workspace, box.stateDir, "watchdog", "hold", "team-a.json")

/** Run ONE tree through one row and return the reading (never a verdict). */
async function runRow(tree, row) {
  const base = Date.now()
  const box = sandbox()
  const handle = await mount(tree, box, base)
  const ticks = []
  try {
    // The record (and, for row (b), a PREVIOUS-generation stamp) has to exist before the
    // engine can attribute a stamp to a task — and before the tick can read the record.
    row.fixture(box, base, handle.heartbeatPath)
    // The engine's own stamp is what puts the task in the candidate set for BOTH trees (r7).
    if (row.stamp !== "handwritten") handle.engine.stamp("step", agent(box.workspace))
    for (const event of row.events) handle.stub.emit("session/event", { id: "a1" }, { ...event, time: base + event.offset })
    for (const event of row.frames ?? []) handle.stub.emit("agent/assistant-stream", { agent: agent(box.workspace), frame: { type: event.type, turn: 1, step: 1, revision: 1 } })
    for (const offset of row.ticks) {
      const result = await handle.engine.tickOnce(base + offset)
      ticks.push({
        offset,
        decisions: result.decisions.map((d) => d.type),
        causes: result.decisions.map((d) => d.cause ?? null),
        holds: result.holds,
        heldOnDisk: existsSync(holdFile(box)),
      })
    }
    const states = typeof handle.engine.predicateStatus === "function" ? handle.engine.predicateStatus().states : null
    const warnedAt = ticks.find((tick) => tick.decisions.includes("warn"))?.offset ?? null
    const escalatedAt = ticks.find((tick) => tick.decisions.includes("escalate"))?.offset ?? null
    return {
      tree,
      defaults: { warnSilenceMs: handle.defaults.warnSilenceMs, warnStreakToEscalate: handle.defaults.warnStreakToEscalate, actionOnEscalate: handle.defaults.actionOnEscalate },
      ticks,
      warnedAt,
      escalatedAt,
      anyWarn: warnedAt !== null,
      anyEscalate: escalatedAt !== null,
      anyHold: ticks.some((tick) => tick.heldOnDisk),
      states,
      stats: handle.engine.getStats(),
    }
  } finally {
    handle.dispose()
    box.cleanup()
  }
}

// ── The rows: identical scenarios, each tree's own engine ────────────────────────────────
const ROWS = [
  {
    id: "(a)",
    title: "a member streaming/writing a long answer, 12+ min simulated",
    required: "NO warn, NO hold",
    // 12 minutes of ONE streaming answer: the step is open, the answer is not committed, and
    // the enrichment's start frame says the model is delivering. Ticks land INSIDE the answer.
    // The record only: the candidate stamp comes from the engine's own `stamp()` below.
    fixture: (box, base) => writeFixture(box, base),
    events: [
      { type: "turn/start", data: { turn: 1 }, offset: 0 },
      { type: "step/start", data: { turn: 1, step: 1 }, offset: 0 },
    ],
    frames: [{ type: "start" }],
    ticks: [91_000, 181_000, 271_000, 12 * 60_000],
  },
  {
    id: "(b)",
    title: "a member whose only open task is dependency-blocked (turn closed, stale prior-generation stamp)",
    required: "NO warn, NO hold, and PARKED is the named state",
    // A day-old stamp of a PREVIOUS generation (empty attemptId): the exact shape that
    // leaked through the permissive rule and held a team (T-16's measured cause).
    fixture: (box, base, heartbeatPath) => writeFixture(box, base, { stampAt: base - 86_400_000, attemptId: "", heartbeatPath: heartbeatPath("Architect") }),
    stamp: "handwritten",
    // The member ran, answered and CLOSED its turn: nothing is outstanding. The only trace of
    // work is a stamp from a PREVIOUS generation (empty attemptId, a day old) — the exact shape
    // that leaked through the permissive rule and held a team (T-16).
    events: [
      { type: "turn/start", data: { turn: 1 }, offset: -86_400_000 },
      { type: "step/start", data: { turn: 1, step: 1 }, offset: -86_400_000 },
      { type: "assistant/message", data: { turn: 1, step: 1, message: {} }, offset: -86_399_000 },
      { type: "step/end", data: { turn: 1, step: 1 }, offset: -86_398_000 },
      { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } }, offset: -86_397_000 },
    ],
    ticks: [1_000, 2_000, 3_000],
  },
  {
    id: "(d)",
    title: "an OUTSTANDING request with no response",
    required: "first WARN only after warnSilenceMs (600 s), then ESCALATE per the frozen ladder",
    fixture: (box, base) => writeFixture(box, base),
    events: [
      { type: "turn/start", data: { turn: 1 }, offset: 0 },
      { type: "step/start", data: { turn: 1, step: 1 }, offset: 0 },
    ],
    // The 100 ms margins keep every tick decisively PAST a bound instead of exactly on it
    // (a stamp lands a millisecond or two after `base`, and `>` is strict).
    ticks: [1_000, 90_100, 599_999, 600_100, 600_101, 600_102, 600_103, 600_104, 600_105],
    probe: { warnAfterMs: 600_000, ladder: 6 },
  },
]

/** The verdict for one row: RED must FAIL the required reading, GREEN must PASS it. */
function verdict(row, reading) {
  if (row.id === "(b)") {
    const parked = reading.states === null ? "n/a" : reading.states.a1 ?? "(none)"
    return {
      red: reading.anyWarn || reading.anyHold ? "fail" : "pass",
      green: !reading.anyWarn && !reading.anyHold && parked === "PARKED" ? "pass" : "fail",
      detail: "warn=" + reading.anyWarn + " hold=" + reading.anyHold + " state=" + parked,
    }
  }
  if (row.id === "(d)") {
    return {
      // RED: today's code warns inside the 90 s bound and escalates on the third tick.
      red: reading.warnedAt !== null && reading.warnedAt <= 90_100 ? "fail" : "pass",
      // GREEN: the first warn is only past warnSilenceMs, and the ladder still escalates.
      green:
        reading.warnedAt !== null && reading.warnedAt >= 600_100 && reading.escalatedAt !== null
          ? "pass"
          : "fail",
      detail: "firstWarnAt=" + reading.warnedAt + "ms firstEscalateAt=" + reading.escalatedAt + "ms",
    }
  }
  return {
    red: reading.anyWarn || reading.anyHold ? "fail" : "pass",
    green: !reading.anyWarn && !reading.anyHold ? "pass" : "fail",
    detail: "warn=" + reading.anyWarn + " hold=" + reading.anyHold,
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true })
const startedAt = new Date().toISOString()
log("[" + startedAt + "] §9 rows (a), (b), (d) — RED (" + RED_ROOT + ") vs GREEN (" + REPO + ")")
const hashesBefore = { red: hashes(RED_ROOT), green: hashes(REPO) }
const baselineBefore = { red: baselineHashes(RED_ROOT), green: baselineHashes(REPO) }
const report = { startedAt, redRoot: RED_ROOT, greenRoot: REPO, hashesBefore, baselineHashes: { before: baselineBefore }, rows: [], settleMs: SETTLE_MS }
for (const tree of ["red", "green"]) {
  const reading = baselineBefore[tree]
  log("baseline BEFORE [" + tree + "] " + reading.root)
  log("  machine.ts = " + reading.machine + "  matchesContract=" + reading.matchesContract.machine)
  log("  engine.ts  = " + reading.engine + "  matchesContract=" + reading.matchesContract.engine)
  log("  tools.js   = " + reading.tools + "  matchesContract=" + reading.matchesContract.tools)
}
for (const row of ROWS) {
  const red = await runRow(RED_ROOT, row)
  const green = await runRow(REPO, row)
  const redVerdict = verdict(row, red)
  const greenVerdict = verdict(row, green)
  const entry = {
    id: row.id,
    title: row.title,
    required: row.required,
    red: { verdict: redVerdict, reading: red },
    green: { verdict: greenVerdict, reading: green },
    ok: redVerdict.red === "fail" && greenVerdict.green === "pass",
  }
  report.rows.push(entry)
  log("")
  log("ROW " + row.id + " — " + row.title)
  log("  required      : " + row.required)
  log("  RED   verdict : " + redVerdict.red.toUpperCase() + "  (" + redVerdict.detail + ")")
  log("    defaults    : " + JSON.stringify(red.defaults))
  log("    ticks       : " + JSON.stringify(red.ticks.map((t) => t.offset + ":" + t.decisions.join("|"))))
  log("    hold on disk: " + red.anyHold)
  log("  GREEN verdict : " + greenVerdict.green.toUpperCase() + "  (" + greenVerdict.detail + ")")
  log("    defaults    : " + JSON.stringify(green.defaults))
  log("    ticks       : " + JSON.stringify(green.ticks.map((t) => t.offset + ":" + t.decisions.join("|"))))
  log("    causes      : " + JSON.stringify(green.ticks.flatMap((t) => t.causes).filter(Boolean)))
  log("    states      : " + JSON.stringify(green.states))
  log("    hold on disk: " + green.anyHold)
  log("  ROW RESULT    : " + (entry.ok ? "red-fails / green-passes ✅" : "NOT PROVEN ❌"))
}

// The settled-hash window: an edit still landing during the run must not be able to produce a
// verdict about a tree that no longer exists (AGENTS.md §7).
log("")
log("settling " + SETTLE_MS + " ms before the settled-hash re-measurement …")
await new Promise((done) => setTimeout(done, SETTLE_MS))
const hashesAfter = { red: hashes(RED_ROOT), green: hashes(REPO) }
const baselineAfter = { red: baselineHashes(RED_ROOT), green: baselineHashes(REPO) }
report.hashesAfter = hashesAfter
report.baselineHashes.after = baselineAfter
report.settled = JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter)
const redPinned =
  hashesAfter.red["src/machine.ts"] === CONTRACT_RED.machine &&
  hashesAfter.red["src/engine.ts"] === CONTRACT_RED.engine &&
  hashesAfter.red["tools.js"] === CONTRACT_RED.tools &&
  hashesAfter.red["src/channel.ts"] === "(absent)"
log("hashes AFTER : red.machine=" + hashesAfter.red["src/machine.ts"])
log("hashes AFTER : red.engine =" + hashesAfter.red["src/engine.ts"])
log("hashes AFTER : green.machine=" + hashesAfter.green["src/machine.ts"])
log("hashes AFTER : green.engine =" + hashesAfter.green["src/engine.ts"])
log("hashes AFTER : green.channel=" + hashesAfter.green["src/channel.ts"])
log("settled (identical before/after): " + report.settled)
log("red tree carries NO channel.ts (pre-redesign): " + (hashesAfter.red["src/channel.ts"] === "(absent)"))

const contractRed = CONTRACT_RED
report.redMatchesContract = baselineAfter.red.matchesContract
report.greenMatchesContract = baselineAfter.green.matchesContract
log("A2 — baseline hashes re-measured from the ROOT tree (they MOVE by design once the lane lands):")
log("  green.machine=" + baselineAfter.green.machine + " (contract " + report.greenMatchesContract.machine + ")")
log("  green.engine =" + baselineAfter.green.engine + " (contract " + report.greenMatchesContract.engine + ")")
log("  green.tools  =" + baselineAfter.green.tools + " (contract " + report.greenMatchesContract.tools + ")")
log("A2 — baseline hashes re-measured from .mpd/red-baseline (the reproducible side):")
log("  red.machine  =" + baselineAfter.red.machine + " (contract " + report.redMatchesContract.machine + ")")
log("  red.engine   =" + baselineAfter.red.engine + " (contract " + report.redMatchesContract.engine + ")")
log("  red.tools    =" + baselineAfter.red.tools + " (contract " + report.redMatchesContract.tools + ")")

report.ok =
  report.rows.every((row) => row.ok) &&
  report.settled &&
  redPinned &&
  report.redMatchesContract.machine &&
  report.redMatchesContract.engine &&
  report.redMatchesContract.tools
log("")
log("DRIVER RESULT: " + (report.ok ? "PASS — every row fails RED and passes GREEN on settled hashes" : "FAIL — see the rows above"))
report.finishedAt = new Date().toISOString()
writeFileSync(join(OUT, "result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(OUT, "output.log"), lines.join("\n") + "\n")
process.exit(report.ok ? 0 : 1)
