// BEFORE/AFTER driver for the DISPATCH PRECONDITION (r7).
//
// It mounts the REAL built plugin (`dist/index.js`, given as argv[2]) through the plugin's own
// `apply()`, seeds a sandbox workspace with a BYTE-COPY of the REAL staged plan record
// (`.mpd/team/mpd-default/team.json`, argv[3]) and ticks the engine once. Two records are run:
//
//   staged     — the record exactly as it was on disk (12 pending tasks, assignee set, NO attempt;
//                `phase:"staged"`, `planReviewState:"awaiting_review"`, no `approvedAt`)
//   dispatched — the SAME record with the attempt id the adopted scheduler writes at dispatch
//                (`beginTaskAttempt`) on every task, i.e. what a RUNNING team looks like
//
// Nothing is simulated at the layer under test: the real dist, the real engine, the real incident
// writer. The only stubs are the harness seams (`ctx.get/provide/on`), because a driver has no
// cordis host — the shape the plugin documents for a standalone unit test.
//
// Usage: bun dispatch-precondition-before-after.mjs <dist> <team.json> <label>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = dirname(dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))))
const [distPath, recordPath, label] = process.argv.slice(2)
if (distPath === undefined || recordPath === undefined || label === undefined) {
  console.error("usage: bun dispatch-precondition-before-after.mjs <dist> <team.json> <label>")
  process.exit(2)
}
if (!existsSync(distPath)) throw new Error("missing dist: " + distPath)
if (!existsSync(recordPath)) throw new Error("missing record: " + recordPath)

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const dist = { path: distPath, bytes: readFileSync(distPath).length, sha256: sha256(distPath) }
const recordBytes = readFileSync(recordPath, "utf8")

/** Run one record shape through one mounted dist, in its own sandbox workspace. */
async function run(shape) {
  const workspace = mkdtempSync(join(tmpdir(), "watchdog-r7-"))
  const teamDir = join(workspace, ".mpd", "team", "mpd-default")
  mkdirSync(teamDir, { recursive: true })
  const record = JSON.parse(recordBytes)
  if (shape === "dispatched") {
    // The dispatch stamp the adopted scheduler writes BEFORE the ticket is delivered.
    let generation = 0
    for (const task of record.tasks ?? []) {
      if (["completed", "failed", "cancelled"].includes(task.status)) continue
      generation += 1
      task.attempt = 1
      task.attemptId = "att-" + task.id + "-" + generation
    }
  }
  writeFileSync(join(teamDir, "team.json"), JSON.stringify(record, null, 2) + "\n")
  if (shape === "revoked") {
    // A task that WAS worked on and whose attempt was then revoked/amended back to `pending`
    // (lib/scheduler.js clears the id when a first delivery fails): the stamp names the EARLIER
    // generation, so it proves the task was handed out without satisfying the current one.
    // The REAL writer is used, so the member-key normalization (member keys are lowercased on
    // disk: `heartbeatPath` -> `safeSegment`) cannot be got wrong by this driver.
    const { appendHeartbeat } = await import(REPO + "/packages/mpd-team-watchdog-plugin/src/store.ts")
    const written = appendHeartbeat(workspace, join(".mpd", "team"), "Planner", {
      kind: "turn-start",
      at: Date.now() - 60_000,
      member: "Planner",
      memberKey: "Planner",
      teamId: "mpd-default",
      taskId: "t1",
      attemptId: "att-t1-1",
      turnId: "Planner#1",
      workspace,
    })
    if (!written.ok) throw new Error("heartbeat write failed: " + String(written.error))
  }

  // The adapter resolves the workspace root from the session header, then DSH_WORKSPACE_ROOT,
  // then process.cwd(). A driver has no session, so the env key IS the explicit root.
  process.env.DSH_WORKSPACE_ROOT = workspace

  const lines = []
  const ctx = {
    get: () => undefined,
    provide: () => {},
    on: () => () => {},
    effect: () => {},
    logger: { info: (text) => lines.push(text), warn: (text) => lines.push(text) },
  }
  const plugin = await import(distPath)
  const report = plugin.apply(ctx, {
    stateDir: join(".mpd", "team"),
    enabled: true,
    warnSilenceMs: 90_000,
    tickIntervalMs: 15_000,
    warnStreakToEscalate: 3,
    actionOnEscalate: "pause",
    teamCacheMs: 0,
    keepGenerations: 3,
    logPrefix: "mpd-team-watchdog",
  })
  if (report.applied !== true || report.engine === null) throw new Error("the row did not apply: " + String(report.error))
  const tick = await report.engine.tickOnce(Date.now())

  const incidentPath = join(workspace, ".mpd", "team", "watchdog", "incidents.jsonl")
  const incidents = existsSync(incidentPath)
    ? readFileSync(incidentPath, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
    : []
  const result = {
    shape,
    workspace,
    recordBytes: recordBytes.length,
    tasks: (record.tasks ?? []).length,
    tasksWithAttempt: (record.tasks ?? []).filter((task) => typeof task.attemptId === "string" && task.attemptId !== "").length,
    tick: { decisions: tick.decisions.length, scenes: tick.scenes.length, holds: tick.holds.length, skipped: tick.skipped ?? null },
    incidents: incidents.length,
    neverStarted: incidents.filter((incident) => incident.kind === "never-started").length,
    neverStartedTasks: incidents.filter((incident) => incident.kind === "never-started").map((incident) => incident.taskId),
    holds: incidents.filter((incident) => incident.hold === "applied").length,
    consoleLines: lines.length,
    lines: lines.map((line) => line.replace(workspace, "<sandbox>")),
  }
  rmSync(workspace, { recursive: true, force: true })
  return result
}

const out = { label, dist, record: recordPath, runs: [await run("staged"), await run("dispatched"), await run("revoked")] }
writeFileSync(join(dirname(new URL(import.meta.url).pathname), label + ".json"), JSON.stringify(out, null, 2) + "\n")
for (const run_ of out.runs) {
  console.log(
    "[" + label + "] shape=" + run_.shape +
      " tasks=" + run_.tasks + " dispatched=" + run_.tasksWithAttempt +
      " never-started=" + run_.neverStarted + " incidents=" + run_.incidents +
      " tickDecisions=" + run_.tick.decisions + " holds=" + run_.holds,
  )
  for (const line of run_.lines) console.log("    " + line)
}
console.log("[" + label + "] dist sha256=" + dist.sha256 + " bytes=" + dist.bytes)
