// ONE-OFF cleanup for the records the defect produced (r7, 2026-09-16).
//
// The pre-fix watchdog wrote a `never-started` incident for every task of a plan that was
// still STAGED, i.e. for tasks nobody had been handed. Those records are not history the
// watchdog can vouch for any more: the corrected classifier can no longer produce a
// `never-started` observation for a task with NO attempt id, so every such record on disk is
// a false positive by the current rule.
//
// WHAT IT DOES (nothing is deleted):
//   1. byte-copies `incidents.jsonl` to `incidents.jsonl.bak-<stamp>` (beside it) — the
//      evidence directory already holds a second byte copy (`before/incidents.before.jsonl`);
//   2. rewrites `incidents.jsonl` keeping every record the corrected classifier can still
//      produce: warn / escalate / tool-expired, and `never-started` records that DO carry an
//      attempt id (a real dispatch whose owner never stamped);
//   3. writes `read-watermark.json` with ONLY the web panel's own reader key
//      (`web-panel`, the key its ack route writes) advanced to the newest remaining incident,
//      so the panel stops re-displaying records that were produced by the defect. Other
//      readers' keys are untouched, and a missing file simply means an empty map.
//
// Usage: node prune-defect-records.mjs <workspace>
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const workspace = process.argv[2] ?? process.cwd()
const dir = join(workspace, ".mpd", "team", "watchdog")
const incidentsPath = join(dir, "incidents.jsonl")
const watermarkPath = join(dir, "read-watermark.json")
const reader = "web-panel"
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")

if (!existsSync(incidentsPath)) {
  console.log(JSON.stringify({ ok: false, reason: "no incidents log at " + incidentsPath }))
  process.exit(0)
}

const before = readFileSync(incidentsPath, "utf8").split("\n").filter((line) => line.trim() !== "")
const parsed = before.map((line) => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
})
const isDefectRecord = (record) => record !== null && record.kind === "never-started" && (record.attemptId === undefined || record.attemptId === "")
const defect = parsed.filter(isDefectRecord).length
const kept = before.filter((_line, index) => !isDefectRecord(parsed[index]))

const backup = incidentsPath + ".bak-" + stamp
copyFileSync(incidentsPath, backup)
writeFileSync(incidentsPath, kept.length === 0 ? "" : kept.join("\n") + "\n", "utf8")

const keptRecords = kept.map((line) => JSON.parse(line))
const newestKept = keptRecords.reduce((best, record) => Math.max(best, record.at ?? 0), 0)
let watermarkBefore = {}
if (existsSync(watermarkPath)) {
  try {
    watermarkBefore = JSON.parse(readFileSync(watermarkPath, "utf8"))
  } catch {
    watermarkBefore = {}
  }
}
writeFileSync(watermarkPath, JSON.stringify({ ...watermarkBefore, [reader]: newestKept }, null, 2) + "\n", "utf8")

const summary = {
  workspace,
  stamp,
  incidents: { before: before.length, removedDefectRecords: defect, after: kept.length, newestKept, backup },
  removedByKind: parsed.filter(isDefectRecord).reduce((acc, record) => ((acc[record.taskId] = (acc[record.taskId] ?? 0) + 1), acc), {}),
  keptByKind: keptRecords.reduce((acc, record) => ((acc[record.kind] = (acc[record.kind] ?? 0) + 1), acc), {}),
  watermark: { reader, before: watermarkBefore[reader] ?? 0, after: newestKept, path: watermarkPath },
}
console.log(JSON.stringify(summary, null, 2))
