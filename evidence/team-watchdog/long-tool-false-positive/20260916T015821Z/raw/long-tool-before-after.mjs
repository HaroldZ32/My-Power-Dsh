// r6 BEFORE/AFTER — the SAME scenario measured against the PRE-FIX build and the FIXED build.
//
// WHY A SNAPSHOT AND NOT A STORY: "the fix works" is only worth something if the same input held
// the team before it. The pre-fix watchdog dist was byte-copied into `raw/dist-before/` BEFORE the
// rebuild (sha256 recorded in `raw/dist-before-sha256.txt`), so both halves run the REAL plugin
// code — the same engine, machine, store and tick — and differ ONLY by the build.
//
// WHAT IS REAL: a genuine child process really burns 1.6 s of wall clock; the ticks land inside it;
// the stamps are written by the plugin's own engine into its own JSONL store; each build is mounted
// with the same row config and the same injected `step` stamp.
// WHAT IS MODELLED: only the harness ctx (a stub, exactly as the fault fixture's), and — in the
// AFTER half only — the harness's `tools/pre-execute` waterfall, driven through the handler the
// mounted row itself registered. The PRE-FIX half is NOT hand-fed a `tool-start` stamp: its stamp
// stream is exactly what the old code produces on its own (a `step`, then nothing during the call).
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..", "..")
const BEFORE = join(HERE, "dist-before", "watchdog-index.js")
const AFTER = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")
const THRESHOLD = 300
const BOUND = 5_000
const COMMAND_MS = 1_600

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const runCommand = (ms) =>
  new Promise((done) => {
    const started = Date.now()
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, " + ms + ")"], { stdio: "ignore" })
    child.on("exit", (status) => done({ elapsedMs: Date.now() - started, status }))
  })

/** The stub harness: the SAME shape the fault fixture uses (the only modelled layer). */
function harnessFor(workspace) {
  const handlers = new Map()
  const effects = []
  const warnings = []
  const services = new Map()
  const member = { id: "child-architect-probe", status: "idle", session: { header: { cwd: workspace } } }
  const ctx = {
    get: (id) => services.get(id),
    provide: (id, value) => services.set(id, value),
    agents: { get: () => member, list: () => [] },
    logger: { warn: (...args) => warnings.push(args.map(String).join(" ")), info: () => {}, error: () => {}, debug: () => {} },
    on: (event, handler) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    effect: (callback) => effects.push(callback),
    inject: () => () => {},
    tools: { register: () => () => {}, get: () => undefined, has: () => false },
    subagents: { prompt: async () => ({}), interrupt: () => {}, drainContinuableChildren: async () => {} },
    systemPrompt: { section: () => {} },
  }
  return {
    ctx,
    handlers,
    warnings,
    disposeRow: () => {
      for (const callback of effects.splice(0)) {
        try {
          const result = callback()
          if (typeof result === "function") result()
        } catch {
          /* a cleanup that throws must not take the run down */
        }
      }
    },
  }
}

/** The injected fault: one team record and ONE `step` stamp two windows old. */
function inject(workspace) {
  const teamDir = join(workspace, ".mpd", "team", "r6-probe")
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  const now = Date.now()
  const record = {
    id: "r6-probe",
    name: "r6 probe",
    description: "the r6 before/after harness",
    captainSessionId: "session-captain-probe",
    createdAt: now,
    approvedAt: now,
    phase: "running",
    taskSeq: 1,
    members: [{ name: "Architect", id: "child-architect-probe", role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: now, status: "idle" }],
    tasks: [{ id: "t1", subject: "t1", assignee: "Architect", dependencies: [], status: "in_progress", attempt: 1, createdAt: now, updatedAt: now, attemptId: "att-1" }],
  }
  writeFileSync(join(teamDir, "team.json"), JSON.stringify(record, null, 2) + "\n")
  const dir = join(workspace, ".mpd", "team", "watchdog", "heartbeat")
  mkdirSync(dir, { recursive: true })
  const stamp = {
    kind: "step",
    at: now - THRESHOLD * 2,
    member: "Architect",
    memberKey: "architect",
    teamId: "r6-probe",
    taskId: "t1",
    attemptId: "att-1",
    turnId: "architect#1",
    workspace,
  }
  writeFileSync(join(dir, "architect.jsonl"), JSON.stringify(stamp) + "\n")
  return { opened: now, stepAt: stamp.at }
}

async function measure(label, distPath, { firePreHook }) {
  const workspace = join(HERE, "ws-" + label)
  rmSync(workspace, { recursive: true, force: true })
  mkdirSync(workspace, { recursive: true })
  process.env.DSH_WORKSPACE_ROOT = workspace
  const { opened, stepAt } = inject(workspace)
  const harness = harnessFor(workspace)
  const plugin = await import(distPath)
  const report = plugin.apply(harness.ctx, {
    stateDir: join(".mpd", "team"),
    enabled: true,
    warnSilenceMs: THRESHOLD,
    tickIntervalMs: 100,
    warnStreakToEscalate: 3,
    actionOnEscalate: "pause",
    teamCacheMs: 0,
    keepGenerations: 3,
    logPrefix: "r6-probe",
    toolInFlightMaxMs: BOUND,
  })
  const subscribed = { pre: harness.handlers.has("tools/pre-execute"), post: harness.handlers.has("tools/post-execute") }
  // The row's own 100 ms interval must not race the manual ticks.
  const preHandler = harness.handlers.get("tools/pre-execute")
  harness.disposeRow()

  let gate = null
  if (firePreHook) {
    if (preHandler === undefined) throw new Error(label + ": the pre hook was expected but the row registered none")
    gate = await preHandler({ name: "bash", callId: "call-probe-1", agent: { id: "child-architect-probe", session: { header: { cwd: workspace } } } }, async () => ({ kind: "allow" }))
  }

  const command = runCommand(COMMAND_MS)
  const ticks = []
  for (const wait of [400, 400, 400]) {
    await sleep(wait)
    const now = Date.now()
    const tick = await report.engine.tickOnce(now)
    ticks.push({ silenceFromLastStamp: now - stepAt, decisions: tick.decisions.map((d) => d.type), scenes: tick.scenes.length, holds: tick.holds.length })
  }
  const real = await command
  const stats = report.engine.getStats()
  const holdPath = join(workspace, ".mpd", "team", "watchdog", "hold", "r6-probe.json")
  const hold = existsSync(holdPath) ? JSON.parse(readFileSync(holdPath, "utf8")) : null
  const heartbeat = readFileSync(join(workspace, ".mpd", "team", "watchdog", "heartbeat", "architect.jsonl"), "utf8")
    .split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line).kind)
  const incidents = existsSync(join(workspace, ".mpd", "team", "watchdog", "incidents.jsonl"))
    ? readFileSync(join(workspace, ".mpd", "team", "watchdog", "incidents.jsonl"), "utf8").split("\n").filter((line) => line.trim() !== "")
    : []
  return {
    label,
    dist: { path: distPath, bytes: readFileSync(distPath).length, sha256: sha256(distPath) },
    subscribedWaterfalls: subscribed,
    gatePassedThrough: gate,
    realCommand: real,
    ticks,
    decisionKinds: ticks.map((tick) => tick.decisions.join("|")),
    beyondThreeWindows: ticks[ticks.length - 1].silenceFromLastStamp > THRESHOLD * 3,
    stampStream: heartbeat,
    stats: { holdsApplied: stats.holdsApplied, scenes: stats.scenes, incidents: stats.incidents, toolStarts: stats.toolStarts, toolExpired: stats.toolExpired },
    incidentKinds: incidents.map((line) => JSON.parse(line).kind),
    hold: hold === null ? null : { id: hold.id, taskId: hold.taskId, attemptId: hold.attemptId, cause: hold.cause },
    rowBootLine: harness.warnings.find((line) => line.includes("applied:")) ?? (report.applied ? "(applied)" : "(not applied)"),
  }
}

const before = await measure("BEFORE", BEFORE, { firePreHook: false })
const after = await measure("AFTER", AFTER, { firePreHook: true })
const verdict = {
  beforeHeldTheTeam: before.decisionKinds.join(",") === "warn,warn,escalate" && before.hold !== null && before.stats.holdsApplied === 1,
  afterHeldNothing: after.decisionKinds.every((kind) => kind === "") && after.hold === null && after.stats.holdsApplied === 0,
  beforeHadNoPreHook: before.subscribedWaterfalls.pre === false,
  afterHasThePreHook: after.subscribedWaterfalls.pre === true,
  sameRealCommandDuration: Math.abs(before.realCommand.elapsedMs - after.realCommand.elapsedMs) < 700,
}
const result = { before, after, verdict, ok: Object.values(verdict).every(Boolean) }
writeFileSync(join(HERE, "long-tool-before-after.json"), JSON.stringify(result, null, 2) + "\n")
console.log("BEFORE dist " + before.dist.bytes + " B " + before.dist.sha256.slice(0, 12) + " pre-hook subscribed: " + before.subscribedWaterfalls.pre)
console.log("BEFORE stamp stream: " + JSON.stringify(before.stampStream) + " decisions: " + JSON.stringify(before.decisionKinds) + " hold: " + JSON.stringify(before.hold && before.hold.cause))
console.log("AFTER  dist " + after.dist.bytes + " B " + after.dist.sha256.slice(0, 12) + " pre-hook subscribed: " + after.subscribedWaterfalls.pre)
console.log("AFTER  stamp stream: " + JSON.stringify(after.stampStream) + " decisions: " + JSON.stringify(after.decisionKinds) + " hold: " + JSON.stringify(after.hold))
console.log("real command (before/after): " + before.realCommand.elapsedMs + " / " + after.realCommand.elapsedMs + " ms; beyond 3 windows at the last tick: " + before.beyondThreeWindows + " / " + after.beyondThreeWindows)
console.log("verdict: " + JSON.stringify(verdict) + " ok=" + result.ok)
process.exit(result.ok ? 0 : 1)
