#!/usr/bin/env node
// t64 (w6) evidence probe — the TUI front door, measured on real modules and a REAL process boundary.
//
// Legs:
//   1. seed a workspace through the watchdog package's OWN sidecar writers (a hold + two incidents);
//   2. FRESH PROCESS #1 reads the store from disk and reports what is unread (no in-process cache);
//   3. the real status publisher emits the line (captured from `tuiStatus.set`) with the notice
//      composed into it, and the same line after the team is resumed;
//   4. the real front door offers the replay dialog (captured request text) and acknowledges;
//   5. FRESH PROCESS #2 reads the store again: nothing unread, and the watermark bytes are shown.
//
// Usage: bun probe-tui-frontdoor.mjs --out <path>
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { appendIncident, clearHold, writeHold } from "../../../../../packages/mpd-team-watchdog-plugin/src/sidecars.ts"
import { DEFAULT_STATE_DIR, watermarkPath } from "../../../../../packages/mpd-team-watchdog-plugin/src/paths.ts"
import { createDialogs } from "../../../../../packages/mpd-tui-plugin/src/dialogs.ts"
import { createLog } from "../../../../../packages/mpd-tui-plugin/src/log.ts"
import { STATUS_KEY, registerStatus } from "../../../../../packages/mpd-tui-plugin/src/status.ts"
import { composeNotices, attachWatchdogFrontDoor } from "../../../../../packages/mpd-tui-plugin/src/watchdog.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..", "..")
const WS = join(HERE, "ws")
const STATE = DEFAULT_STATE_DIR
const outIndex = process.argv.indexOf("--out")
const OUT = outIndex === -1 ? join(HERE, "probe.json") : process.argv[outIndex + 1]

const report = { task: "t64 — TUI front door for the team watchdog", measuredAt: new Date().toISOString(), legs: {} }
const fsReadScript = `
import { unacknowledged, readWatermarks } from "${join(REPO, "packages/mpd-team-watchdog-plugin/src/sidecars.ts")}"
import { readdirSync } from "node:fs"
import { join } from "node:path"
const ws = process.env.PROBE_WS
const stateDir = process.env.PROBE_STATE
const holds = (() => { try { return readdirSync(join(ws, stateDir, "watchdog", "hold")) } catch { return [] } })()
console.log(JSON.stringify({ pid: process.pid, holds, unread: unacknowledged(ws, stateDir, "mpd-tui").map((r) => r.at), watermarks: readWatermarks(ws, stateDir) }))
`

rmSync(WS, { recursive: true, force: true })
mkdirSync(WS, { recursive: true })

// Leg 1 — seed through the owner's writers.
writeHold(WS, STATE, { id: "hold-1", teamId: "mpd-default-1", since: 1000, cause: "silence", taskId: "t1", attemptId: null, sceneAt: 1000 })
appendIncident(WS, STATE, { id: "inc-1000", teamId: "mpd-default-1", kind: "warn", at: 1000, cause: { kind: "silence", ms: 90000 }, taskId: "t1", attemptId: null, scene: null, hold: "not-requested", acknowledgedBy: [] })
appendIncident(WS, STATE, { id: "inc-2000", teamId: "mpd-default-1", kind: "escalate", at: 2000, cause: { kind: "silence", ms: 90000 }, taskId: "t1", attemptId: null, scene: null, hold: "applied", acknowledgedBy: [] })
report.legs.seed = {
  holdFile: "ws/.mpd/team/watchdog/hold/mpd-default-1.json",
  incidentsBytes: readFileSync(join(WS, STATE, "watchdog", "incidents.jsonl"), "utf8").trim().split("\n").length,
  watermarkFileExists: (() => { try { readFileSync(watermarkPath(WS, STATE), "utf8"); return true } catch { return false } })(),
}

// Leg 2 — FRESH PROCESS #1: read the flag from DISK.
const fresh1 = spawnSync("bun", ["-e", fsReadScript], { encoding: "utf8", cwd: REPO, env: { ...process.env, PROBE_WS: WS, PROBE_STATE: STATE } })
report.legs.freshProcessBefore = { exit: fresh1.status, stderr: fresh1.stderr.trim().slice(0, 400), ...(JSON.parse(fresh1.stdout.trim() || "{}")) }

// Leg 3 — the real status publisher, with the notice composed into the emitted value.
const log = createLog(undefined, "probe")
const statusSet = []
const dialogRequests = []
let answer
const services = {
  tuiStatus: { set: (key, text) => { statusSet.push({ key, text: String(text) }); return () => {} } },
  tuiDialogs: {
    select: async (request) => { dialogRequests.push(request); return answer },
    confirm: async () => undefined,
    input: async () => undefined,
  },
}
const ctx = {
  get: () => undefined,
  effect: (cb) => { cb(); return {} },
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
  inject: (deps, cb) => { const scoped = { get: (id) => services[id], ...services }; if (deps.every((d) => services[d] !== undefined)) cb(scoped); return {} },
}
const door = attachWatchdogFrontDoor(ctx, log, { workspaceRoot: () => WS, dialogs: createDialogs(ctx, log), replayOnAttach: false })
const status = registerStatus(ctx, log, () => WS, () => WS, 0, () => composeNotices(undefined, door.notice()))
report.legs.statusLineHeld = { key: statusSet.at(-1)?.key, expectedKey: STATUS_KEY, text: statusSet.at(-1)?.text }

// Leg 4 — the replay dialog: captured request text, then the acknowledge.
answer = "acknowledge"
const choice = await door.offer()
report.legs.dialog = { choice, request: dialogRequests[0] ?? null }

// The same line after the acknowledge, and after the team is resumed.
status.refresh()
report.legs.statusLineAfterAck = statusSet.at(-1)?.text
clearHold(WS, STATE, "mpd-default-1")
status.refresh()
report.legs.statusLineAfterResume = statusSet.at(-1)?.text

// Leg 5 — FRESH PROCESS #2: nothing unread; the watermark bytes are on disk.
const fresh2 = spawnSync("bun", ["-e", fsReadScript], { encoding: "utf8", cwd: REPO, env: { ...process.env, PROBE_WS: WS, PROBE_STATE: STATE } })
report.legs.freshProcessAfter = { exit: fresh2.status, stderr: fresh2.stderr.trim().slice(0, 400), ...(JSON.parse(fresh2.stdout.trim() || "{}")) }
report.legs.storeBytes = {
  incidents: readFileSync(join(WS, STATE, "watchdog", "incidents.jsonl"), "utf8").trim(),
  watermark: readFileSync(watermarkPath(WS, STATE), "utf8").trim(),
}
report.legs.notClaimed = {
  pane: "NOT-CLAIMED — no interactive TTY/tmux pane or keystroke leg was driven in this environment: the value the status publisher emits and the dialog request the host was handed are asserted instead, and the pane leg is explicitly not reported as passed.",
}

const checks = []
const ok = (id, pass, detail) => checks.push({ id, status: pass ? "passed" : "failed", detail: String(detail ?? "") })
ok("fresh-read-before", report.legs.freshProcessBefore.unread?.length === 2, JSON.stringify(report.legs.freshProcessBefore.unread))
ok("status-composed", String(report.legs.statusLineHeld?.text).includes("watchdog: held mpd-default-1") && String(report.legs.statusLineHeld?.text).includes("2 unread incidents"), report.legs.statusLineHeld?.text)
ok("status-resumed", !String(report.legs.statusLineAfterResume).includes("watchdog:"), report.legs.statusLineAfterResume)
ok("dialog-text", /watchdog: held mpd-default-1 · 2 unread incidents/.test(String(report.legs.dialog.request?.title)) && report.legs.dialog.request?.options?.[0]?.id === "acknowledge", String(report.legs.dialog.request?.title))
ok("ack-advanced-watermark", report.legs.freshProcessAfter.watermarks?.["mpd-tui"] === 2000, JSON.stringify(report.legs.freshProcessAfter.watermarks))
ok("fresh-read-after", report.legs.freshProcessAfter.unread?.length === 0, JSON.stringify(report.legs.freshProcessAfter.unread))
report.checks = checks
report.verdict = checks.every((c) => c.status === "passed") ? "passed" : "failed"
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`[probe] ${checks.filter((c) => c.status === "passed").length}/${checks.length} checks passed — ${report.verdict}`)
for (const check of checks.filter((c) => c.status === "failed")) console.log(`FAIL ${check.id} — ${check.detail}`)
console.log(`status line (held): ${report.legs.statusLineHeld.text}`)
console.log(`status line (after resume): ${report.legs.statusLineAfterResume}`)
console.log(`dialog title: ${report.legs.dialog.request?.title}`)
console.log(`fresh processes: before=${JSON.stringify(report.legs.freshProcessBefore.unread)} after=${JSON.stringify(report.legs.freshProcessAfter.unread)} watermarks-after=${JSON.stringify(report.legs.freshProcessAfter.watermarks)}`)
process.exit(report.verdict === "passed" ? 0 : 1)
