#!/usr/bin/env node
// t65 (w6b) evidence probe — the SAME observable behaviour, now with EVERY store access routed
// through the `mpdWatchdog` service (so the TUI dist carries no filesystem writer at all).
//
// Legs:
//   1. seed a workspace through the watchdog package's own sidecar writers;
//   2. FRESH PROCESS #1 reads the store from disk;
//   3. the service object the plugin publishes (`HoldRegistry` + the four front-door methods) is
//      injected as `mpdWatchdog`; the real status publisher emits the line with the notice composed
//      into it, and the same line after the team is resumed;
//   4. the real front door offers the replay dialog (captured request text) and acknowledges; the
//      watermark moves THROUGH THE SERVICE;
//   5. FRESH PROCESS #2 reads the store again: nothing unread, watermark bytes shown;
//   6. the `Later` arm: no watermark is written, and a restart still surfaces the incident;
//   7. the absent-service arm: no notice, no dialog, an acknowledge that reports failure.
//
// Usage: bun probe-tui-frontdoor.mjs --out <path>
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { appendIncident, clearHold, writeHold } from "../../../../../packages/mpd-team-watchdog-plugin/src/sidecars.ts"
import { HoldRegistry } from "../../../../../packages/mpd-team-watchdog-plugin/src/holds.ts"
import { DEFAULT_STATE_DIR, watermarkPath } from "../../../../../packages/mpd-team-watchdog-plugin/src/paths.ts"
import { createDialogs } from "../../../../../packages/mpd-tui-plugin/src/dialogs.ts"
import { createLog } from "../../../../../packages/mpd-tui-plugin/src/log.ts"
import { STATUS_KEY, registerStatus } from "../../../../../packages/mpd-tui-plugin/src/status.ts"
import { attachWatchdogFrontDoor, composeNotices, WATCHDOG_SERVICE } from "../../../../../packages/mpd-tui-plugin/src/watchdog.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..", "..")
const WS = join(HERE, "ws")
const STATE = DEFAULT_STATE_DIR
const outIndex = process.argv.indexOf("--out")
const OUT = outIndex === -1 ? join(HERE, "probe.json") : process.argv[outIndex + 1]

const report = { task: "t65 — every watchdog-store access behind the mpdWatchdog service", measuredAt: new Date().toISOString(), legs: {} }
const readerScript = `
import { unacknowledged, readWatermarks } from "${join(REPO, "packages/mpd-team-watchdog-plugin/src/sidecars.ts")}"
import { readdirSync } from "node:fs"
import { join } from "node:path"
const ws = process.env.PROBE_WS
const stateDir = process.env.PROBE_STATE
const holds = (() => { try { return readdirSync(join(ws, stateDir, "watchdog", "hold")) } catch { return [] } })()
console.log(JSON.stringify({ pid: process.pid, holds, unread: unacknowledged(ws, stateDir, "mpd-tui").map((r) => r.at), watermarks: readWatermarks(ws, stateDir) }))
`

function freshRead() {
  const run = spawnSync("bun", ["-e", readerScript], {
    encoding: "utf8",
    cwd: REPO,
    env: { ...process.env, PROBE_WS: WS, PROBE_STATE: STATE },
  })
  return { exit: run.status, stderr: run.stderr.trim().slice(0, 300), ...(JSON.parse(run.stdout.trim() || "{}")) }
}

function buildCtx(services) {
  return {
    get: () => undefined,
    effect: (callback) => {
      callback()
      return {}
    },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    inject: (dependencies, callback) => {
      const scoped = { get: (id) => services[id], ...services }
      if (dependencies.every((id) => services[id] !== undefined)) callback(scoped)
      return {}
    },
  }
}

function publishedService(registry) {
  // Exactly the object `packages/mpd-team-watchdog-plugin/src/index.ts` publishes for mpdWatchdog.
  return {
    isHeld: (teamId, workspace) => registry.isHeld(teamId, workspace),
    holds: (teamId, workspace) => registry.holds(teamId, workspace),
    list: () => registry.list(),
    hydratedRoots: () => registry.hydratedRoots(),
    hydrate: (roots) => registry.hydrate(roots ?? []),
    heldTeams: (workspace) => registry.heldTeams(workspace),
    unread: (reader, workspace) => registry.unread(reader, workspace),
    acknowledge: (reader, upTo, workspace) => registry.acknowledge(reader, upTo, workspace),
    view: (reader, workspace) => registry.view(reader, workspace),
  }
}

rmSync(WS, { recursive: true, force: true })
mkdirSync(WS, { recursive: true })

// Leg 1 — seed through the owner's writers.
writeHold(WS, STATE, { id: "hold-1", teamId: "mpd-default-1", since: 1000, cause: "silence", taskId: "t1", attemptId: null, sceneAt: 1000 })
appendIncident(WS, STATE, { id: "inc-1000", teamId: "mpd-default-1", kind: "warn", at: 1000, cause: { kind: "silence", ms: 90000 }, taskId: "t1", attemptId: null, scene: null, hold: "not-requested", acknowledgedBy: [] })
appendIncident(WS, STATE, { id: "inc-2000", teamId: "mpd-default-1", kind: "escalate", at: 2000, cause: { kind: "silence", ms: 90000 }, taskId: "t1", attemptId: null, scene: null, hold: "applied", acknowledgedBy: [] })
report.legs.seed = { holds: 1, incidents: 2, watermarkFileExists: existsSync(watermarkPath(WS, STATE)) }

// Leg 2 — FRESH PROCESS #1.
report.legs.freshProcessBefore = freshRead()

// Leg 3 — the real status publisher, with the notice composed through the SERVICE.
const log = createLog(undefined, "probe")
const statusSet = []
const dialogRequests = []
let answer
const registry = new HoldRegistry(STATE, WS)
const services = {
  [WATCHDOG_SERVICE]: publishedService(registry),
  tuiStatus: { set: (key, text) => { statusSet.push({ key, text: String(text) }); return () => {} } },
  tuiDialogs: {
    select: async (request) => { dialogRequests.push(request); return answer },
    confirm: async () => undefined,
    input: async () => undefined,
  },
}
const ctx = buildCtx(services)
const door = attachWatchdogFrontDoor(ctx, log, { workspaceRoot: () => WS, dialogs: createDialogs(ctx, log), replayOnAttach: false })
const status = registerStatus(ctx, log, () => WS, () => WS, 0, () => composeNotices(undefined, door.notice()))
report.legs.serviceAvailable = door.available()
report.legs.statusLineHeld = { key: statusSet.at(-1)?.key, expectedKey: STATUS_KEY, text: statusSet.at(-1)?.text }

// Leg 4 — the dialog + the acknowledge, both through the service.
answer = "acknowledge"
const choice = await door.offer()
report.legs.dialog = { choice, request: dialogRequests[0] ?? null }
status.refresh()
report.legs.statusLineAfterAck = statusSet.at(-1)?.text
clearHold(WS, STATE, "mpd-default-1")
status.refresh()
report.legs.statusLineAfterResume = statusSet.at(-1)?.text

// Leg 5 — FRESH PROCESS #2.
report.legs.freshProcessAfter = freshRead()
report.legs.storeBytes = {
  incidents: readFileSync(join(WS, STATE, "watchdog", "incidents.jsonl"), "utf8").trim(),
  watermark: readFileSync(watermarkPath(WS, STATE), "utf8").trim(),
}

// Leg 6 — `Later` writes no watermark and the incident comes back on a restart.
appendIncident(WS, STATE, { id: "inc-3000", teamId: "mpd-default-1", kind: "warn", at: 3000, cause: { kind: "silence", ms: 90000 }, taskId: "t1", attemptId: null, scene: null, hold: "not-requested", acknowledgedBy: [] })
const markBefore = readFileSync(watermarkPath(WS, STATE), "utf8")
answer = "later"
const laterChoice = await door.offer()
const markAfter = readFileSync(watermarkPath(WS, STATE), "utf8")
const restarted = attachWatchdogFrontDoor(ctx, log, { workspaceRoot: () => WS, dialogs: createDialogs(ctx, log), replayOnAttach: false })
report.legs.later = {
  choice: laterChoice,
  watermarkUnchanged: markBefore === markAfter,
  watermark: markAfter.trim(),
  unreadAfterRestart: restarted.view().unread.map((record) => record.at),
}

// Leg 7 — the absent-service arm: no notice, no dialog, an acknowledge that reports failure.
const noService = buildCtx({
  tuiStatus: services.tuiStatus,
  tuiDialogs: services.tuiDialogs,
})
const absentStatus = []
noService.inject = (deps, cb) => {
  const only = { tuiStatus: { set: (key, text) => { absentStatus.push(String(text)); return () => {} } }, tuiDialogs: services.tuiDialogs }
  const scoped = { get: (id) => only[id], ...only }
  if (deps.every((d) => only[d] !== undefined)) cb(scoped)
  return {}
}
const absentDoor = attachWatchdogFrontDoor(noService, log, { workspaceRoot: () => WS, dialogs: createDialogs(noService, log), replayOnAttach: false })
registerStatus(noService, log, () => WS, () => WS, 0, () => composeNotices(undefined, absentDoor.notice()))
const absentAck = absentDoor.acknowledge(9999)
report.legs.absentService = {
  available: absentDoor.available(),
  statusLine: absentStatus.at(-1),
  offer: await absentDoor.offer(),
  acknowledge: absentAck,
}

report.legs.notClaimed = {
  pane: "NOT-CLAIMED — no interactive TTY/tmux pane or keystroke leg was driven in this environment; the assertions are the value the status publisher emits, the dialog request the host was handed, and the store bytes.",
}

const checks = []
const ok = (id, pass, detail) => checks.push({ id, status: pass ? "passed" : "failed", detail: String(detail ?? "") })
ok("service-available", report.legs.serviceAvailable === true, report.legs.serviceAvailable)
ok("fresh-read-before", report.legs.freshProcessBefore.unread?.length === 2, JSON.stringify(report.legs.freshProcessBefore.unread))
ok("status-composed", String(report.legs.statusLineHeld?.text).includes("watchdog: held mpd-default-1") && String(report.legs.statusLineHeld?.text).includes("2 unread incidents"), report.legs.statusLineHeld?.text)
ok("dialog-text", /watchdog: held mpd-default-1 · 2 unread incidents/.test(String(report.legs.dialog.request?.title)) && report.legs.dialog.request?.options?.[1]?.id === "later" && report.legs.dialog.request?.options?.[0]?.id === "acknowledge", String(report.legs.dialog.request?.title))
ok("status-resumed", !String(report.legs.statusLineAfterResume).includes("watchdog:"), report.legs.statusLineAfterResume)
ok("ack-advanced-watermark", report.legs.freshProcessAfter.watermarks?.["mpd-tui"] === 2000, JSON.stringify(report.legs.freshProcessAfter.watermarks))
ok("fresh-read-after", report.legs.freshProcessAfter.unread?.length === 0, JSON.stringify(report.legs.freshProcessAfter.unread))
ok("later-writes-nothing", report.legs.later.watermarkUnchanged === true && report.legs.later.unreadAfterRestart.length === 1, JSON.stringify(report.legs.later))
ok("absent-service-safe", report.legs.absentService.available === false && report.legs.absentService.offer === undefined && report.legs.absentService.acknowledge.ok === false && !String(report.legs.absentService.statusLine).includes("watchdog"), JSON.stringify(report.legs.absentService))
report.checks = checks
report.verdict = checks.every((c) => c.status === "passed") ? "passed" : "failed"
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`[probe] ${checks.filter((c) => c.status === "passed").length}/${checks.length} checks passed — ${report.verdict}`)
for (const check of checks.filter((c) => c.status === "failed")) console.log(`FAIL ${check.id} — ${check.detail}`)
console.log(`status line (held): ${report.legs.statusLineHeld.text}`)
console.log(`status line (after resume): ${report.legs.statusLineAfterResume}`)
console.log(`dialog title: ${report.legs.dialog.request?.title}`)
console.log(`fresh processes: before=${JSON.stringify(report.legs.freshProcessBefore.unread)} after=${JSON.stringify(report.legs.freshProcessAfter.unread)} watermarks-after=${JSON.stringify(report.legs.freshProcessAfter.watermarks)}`)
console.log(`later arm: ${JSON.stringify(report.legs.later)}`)
console.log(`absent-service arm: ${JSON.stringify(report.legs.absentService)}`)
process.exit(report.verdict === "passed" ? 0 : 1)
