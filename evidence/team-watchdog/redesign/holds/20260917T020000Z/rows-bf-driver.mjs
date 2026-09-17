// §9 ROWS (b) and (f) — RED before GREEN, on two trees, with a per-row verdict (lane A2 / t13).
//
//   (b) a member whose open tasks are blocked on unfinished dependencies → NO warn, NO hold, and
//       the member is PARKED. RED (today's code): the member's stamp is old, so silence warns,
//       escalates and HOLDS a team that is merely WAITING (T-20).
//   (f) a team whose only evidence is a stamp from a PREVIOUS generation (empty attemptId, older
//       than the record's own `createdAt`), or a task nobody ever attempted → never holdable.
//       RED: the pre-`createdAt` stamp leaks through the permissive rule and holds the team (T-16).
//
// The two trees are driven by their OWN modules against the SAME scenario and an injected clock:
//   RED   = <repo>/.mpd/red-baseline   (detached 75018a1 — no `channel.ts`, no dependency
//                                       projection, no hold liveness)
//   GREEN = <repo>                     (lane A2)
//
// Usage: bun rows-bf-driver.mjs [--out <dir>] [--settle-ms 50000]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

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
const CONTRACT_RED = {
  machine: "fc10fc41f404d79457660403f9645483fe123e588df6bfe5b8b55c4b8728c1ef",
  engine: "f529ca2cdef498eca8b60c441824aa5ab898689bc60c3c81ffc7da063f49281b",
}

const lines = []
const log = (text) => {
  lines.push(text)
  console.log(text)
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const fingerprint = (root) => ({
  machine: sha(join(root, PLUGIN, "src", "machine.ts")),
  engine: sha(join(root, PLUGIN, "src", "engine.ts")),
  channel: existsSync(join(root, PLUGIN, "src", "channel.ts")) ? sha(join(root, PLUGIN, "src", "channel.ts")) : "(absent)",
  team: sha(join(root, PLUGIN, "src", "team.ts")),
  tools: sha(join(root, "packages", "mpd-agent-teams-plugin", "lib", "tools.js")),
})

/** The stub adapter: the only harness surface the engine uses (same shape as the test support). */
function stubAdapter(workspace) {
  const tools = new Map()
  const listeners = new Map()
  const eventOf = (event) => {
    const list = listeners.get(event) ?? []
    return list
  }
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
      onPreToolExecute: () => () => {},
      onPostToolExecute: () => () => {},
      onEvent: (event, handler) => {
        const list = eventOf(event)
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
      for (const handler of eventOf(event)) {
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

/** Mount one tree's engine against one sandbox (each tree's own modules). */
async function mount(tree, workspace, stateDir) {
  const { WatchdogEngine } = await import(pathToFileURL(join(tree, PLUGIN, "src", "engine.ts")).href)
  const { WATCHDOG_DEFAULTS } = await import(pathToFileURL(join(tree, PLUGIN, "src", "machine.ts")).href)
  const { heartbeatPath } = await import(pathToFileURL(join(tree, PLUGIN, "src", "paths.ts")).href)
  const stub = stubAdapter(workspace)
  const engine = new WatchdogEngine(stub.adapter, ctxStub, {
    stateDir,
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
    logPrefix: "rows-bf",
  })
  const disposers = engine.install()
  return {
    stub,
    engine,
    defaults: WATCHDOG_DEFAULTS,
    heartbeatPath: (memberKey) => heartbeatPath(workspace, stateDir, memberKey),
    dispose: () => {
      for (const off of disposers) off()
      engine.stop()
    },
  }
}

/** The scenarios, expressed once and run against BOTH trees. */
const ROWS = [
  {
    id: "(b)",
    title: "a member whose only open tasks are dependency-blocked",
    required: "NO warn, NO hold, and the member is reported PARKED",
    // The member owns an in-progress task that DEPENDS on an unfinished one: nothing claimable.
    record: (base) => ({
      id: "team-a",
      name: "team-a",
      phase: "running",
      createdAt: base - 86_400_000,
      updatedAt: base,
      members: [{ id: "a1", name: "Architect", status: "running" }],
      tasks: [
        { id: "t9", status: "pending", updatedAt: base },
        { id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1", dependencies: ["t9"], updatedAt: base },
      ],
    }),
    // A stamp that is OLD and belongs to the current generation: on RED this is exactly what
    // makes the member look silent and holds the team.
    stampAt: (base) => base - 3_600_000,
    stampAttemptId: "att-1",
    // …and a genuinely OUTSTANDING channel on top, so the suppression cannot be credited to the
    // fold: GREEN must still park the member.
    channel: true,
    ticks: [91_000, 181_000, 271_000, 362_000],
  },
  {
    id: "(f)",
    title: "a team whose only evidence is a PREVIOUS generation's stamp (and a task nobody attempted)",
    required: "never holdable: no warn, no hold",
    record: (base) => ({
      id: "team-a",
      name: "team-a",
      phase: "running",
      // The record was created 30 minutes before the run: the stamp below PREDATES it.
      createdAt: base - 1_800_000,
      updatedAt: base,
      members: [{ id: "a1", name: "Architect", status: "running" }],
      tasks: [
        // A dispatched task whose owner never stamped in THIS generation…
        { id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1", updatedAt: base },
        // …and one nobody ever handed out (r7: not a candidate at all).
        { id: "t2", status: "pending", assignee: "Architect", updatedAt: base },
      ],
    }),
    // The measured leak shape: an empty `attemptId`, one day old, written before the record.
    stampAt: (base) => base - 86_400_000,
    stampAttemptId: "",
    channel: false,
    ticks: [1_000, 2_000, 3_000],
  },
]

/** Run one tree through one row and return the reading (never a verdict). */
async function runRow(tree, row) {
  const base = Date.now()
  const workspace = mkdtempSync(join(OUT, "sandbox-"))
  const stateDir = ".mpd/team"
  const handle = await mount(tree, workspace, stateDir)
  const ticks = []
  try {
    const teamDir = join(workspace, stateDir, "team-a")
    mkdirSync(join(teamDir, "inbox"), { recursive: true })
    const record = row.record(base)
    const teamPath = join(teamDir, "team.json")
    writeFileSync(teamPath, JSON.stringify(record, null, 2))
    const teamBytes = () => readFileSync(teamPath, "utf8")
    const bytesBefore = teamBytes()
    // The heartbeat stamp, at the path the TREE'S OWN helper computes.
    const heartbeat = handle.heartbeatPath("Architect")
    mkdirSync(dirname(heartbeat), { recursive: true })
    writeFileSync(
      heartbeat,
      JSON.stringify({
        kind: "step",
        at: row.stampAt(base),
        member: "Architect",
        memberKey: "Architect",
        teamId: "team-a",
        taskId: "t1",
        attemptId: row.stampAttemptId,
        turnId: "Architect#1",
        workspace,
      }) + "\n",
    )
    if (row.channel) {
      // A real OUTSTANDING channel: an open step with no committed answer.
      handle.stub.emit("session/event", { id: "a1" }, ev("turn/start", { turn: 1 }, base))
      handle.stub.emit("session/event", { id: "a1" }, ev("step/start", { turn: 1, step: 1 }, base))
    }
    for (const offset of row.ticks) {
      const result = await handle.engine.tickOnce(base + offset)
      ticks.push({
        offset,
        decisions: result.decisions.map((d) => d.type),
        holds: result.holds,
        heldOnDisk: existsSync(join(workspace, stateDir, "watchdog", "hold", "team-a.json")),
      })
    }
    const stats = handle.engine.getStats()
    const predicate = typeof handle.engine.predicateStatus === "function" ? handle.engine.predicateStatus() : null
    return {
      tree,
      defaults: { warnSilenceMs: handle.defaults.warnSilenceMs, warnStreakToEscalate: handle.defaults.warnStreakToEscalate, actionOnEscalate: handle.defaults.actionOnEscalate },
      ticks,
      anyWarn: ticks.some((tick) => tick.decisions.includes("warn")),
      anyEscalate: ticks.some((tick) => tick.decisions.includes("escalate")),
      anyHold: ticks.some((tick) => tick.heldOnDisk),
      neverStarted: stats.neverStarted,
      dependencyParked: stats.channelDependencyBlocked ?? 0,
      foldStates: predicate === null ? null : predicate.states,
      teamBytesUntouched: teamBytes() === bytesBefore,
    }
  } finally {
    handle.dispose()
    rmSync(workspace, { recursive: true, force: true })
  }
}

/** RED must FAIL the required reading; GREEN must PASS it. */
function verdict(row, reading) {
  if (row.id === "(b)") {
    return {
      red: reading.anyWarn || reading.anyHold ? "fail" : "pass",
      green: !reading.anyWarn && !reading.anyHold && reading.dependencyParked > 0 ? "pass" : "fail",
      detail:
        "warn=" + reading.anyWarn + " escalate=" + reading.anyEscalate + " hold=" + reading.anyHold +
        " dependencyParked=" + reading.dependencyParked + " foldState=" + JSON.stringify(reading.foldStates),
    }
  }
  return {
    red: reading.anyWarn || reading.anyHold ? "fail" : "pass",
    green: !reading.anyWarn && !reading.anyHold && reading.neverStarted >= 1 ? "pass" : "fail",
    detail:
      "warn=" + reading.anyWarn + " escalate=" + reading.anyEscalate + " hold=" + reading.anyHold +
      " neverStarted=" + reading.neverStarted,
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true })
const startedAt = new Date().toISOString()
log("[" + startedAt + "] §9 rows (b), (f) — RED (" + RED_ROOT + ") vs GREEN (" + REPO + ")")
const before = { red: fingerprint(RED_ROOT), green: fingerprint(REPO) }
for (const tree of ["red", "green"]) {
  log("baseline BEFORE [" + tree + "] machine=" + before[tree].machine + " team=" + before[tree].team + " channel=" + before[tree].channel)
}
const report = { startedAt, redRoot: RED_ROOT, greenRoot: REPO, fingerprintsBefore: before, rows: [], settleMs: SETTLE_MS }
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
  log("    ticks       : " + JSON.stringify(red.ticks.map((tick) => tick.offset + ":" + tick.decisions.join("|"))))
  log("  GREEN verdict : " + greenVerdict.green.toUpperCase() + "  (" + greenVerdict.detail + ")")
  log("    defaults    : " + JSON.stringify(green.defaults))
  log("    ticks       : " + JSON.stringify(green.ticks.map((tick) => tick.offset + ":" + tick.decisions.join("|"))))
  log("    team bytes untouched: " + green.teamBytesUntouched)
  log("  ROW RESULT    : " + (entry.ok ? "red-fails / green-passes ✅" : "NOT PROVEN ❌"))
}

log("")
log("settling " + SETTLE_MS + " ms before the settled-hash re-measurement …")
await new Promise((done) => setTimeout(done, SETTLE_MS))
const after = { red: fingerprint(RED_ROOT), green: fingerprint(REPO) }
report.fingerprintsAfter = after
report.settled = JSON.stringify(before) === JSON.stringify(after)
const redPinned = after.red.machine === CONTRACT_RED.machine && after.red.engine === CONTRACT_RED.engine && after.red.channel === "(absent)"
log("settled (identical before/after): " + report.settled)
log("RED tree matches the contract's frozen hashes and carries NO channel.ts: " + redPinned)
log("A2 — the fingerprint that carries the two new modules (green): " + JSON.stringify(after.green))
report.redPinned = redPinned
report.ok = report.rows.every((row) => row.ok) && report.settled && redPinned
log("")
log("DRIVER RESULT: " + (report.ok ? "PASS — every row fails RED and passes GREEN on settled hashes" : "FAIL — see the rows above"))
report.finishedAt = new Date().toISOString()
writeFileSync(join(OUT, "result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(OUT, "output.log"), lines.join("\n") + "\n")
process.exit(report.ok ? 0 : 1)
