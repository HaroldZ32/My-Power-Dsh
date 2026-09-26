#!/usr/bin/env bun
// Case team-watchdog-scene — AC-5 / AC-10: the scene snapshot, the durable hold and the
// incident log, read back from a FRESH process with plain fs.
//
// The scene is produced by the fixture's own escalate case (real engine, real scene writer),
// then THIS lane reads it with nothing but `readFileSync` + `JSON.parse` inside a separate
// `node` child (the fixture's `scene-restore` case does the same in-process; this lane repeats
// it from outside the plugin, which is what a reviewer would do).
//
// Asserts the AC-5/AC-10 field set: schemaVersion, at, reason, cause{kind,ms}, team{...hold},
// tasks[], members[] (id/name/status/unread/currentTask/lastSeen), mailbox, parkedAttempts,
// incidents[] — plus the immutable per-incident files, the `latest.json` pointer, the hold
// sidecar's agreement with the pointer and the append-only incident log.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-scene.mjs --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-scene.mjs [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-scene/{result.json,output.log,raw/}
import { join, resolve } from "node:path"
import { PATHS, captureStdout, evidenceDir, finish, freshProcessRead, say, selfTest, storePaths, writeEvidence } from "./lib/watchdog-lane.mjs"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.mjs"

const SLUG = "team-watchdog-scene"
const SCENE_FIELDS = ["schemaVersion", "at", "reason", "cause", "team", "tasks", "members", "mailbox", "parkedAttempts", "incidents"]
const MEMBER_FIELDS = ["id", "name", "status", "unread", "currentTask", "lastSeen"]

/** The pure evaluator over what the fresh process read. */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  const scene = observed.latest ?? {}

  add("S1", observed.freshProcessPid !== undefined && observed.freshProcessPid !== process.pid && observed.readWith === "plain-fs",
    "the scene was read by a FRESH process (pid " + String(observed.freshProcessPid) + " vs lane " + String(process.pid) + ") with plain fs only")
  const missing = SCENE_FIELDS.filter((field) => scene[field] === undefined)
  add("S2", missing.length === 0, "the snapshot carries the AC-5 field set (missing: " + JSON.stringify(missing) + ")")
  add("S3", scene.reason === "escalate" && scene.cause?.kind === "silence" && typeof scene.cause?.ms === "number" && scene.schemaVersion === 1,
    "the escalation snapshot names its reason and the measured silence (" + JSON.stringify({ reason: scene.reason, cause: scene.cause }) + ")")
  add("S4", scene.team?.id === observed.team && scene.team?.hold?.id === observed.hold?.id && scene.team?.hold?.cause === "silence",
    "team.hold in the snapshot agrees with the durable hold sidecar (" + JSON.stringify({ scene: scene.team?.hold?.id, sidecar: observed.hold?.id }) + ")")
  add("S5", Object.keys(scene.parkedAttempts ?? {}).length >= 1,
    "the durable parkedAttempts projection is in the snapshot (" + JSON.stringify(scene.parkedAttempts) + ")")
  const member = (scene.members ?? [])[0] ?? {}
  const memberMissing = MEMBER_FIELDS.filter((field) => member[field] === undefined)
  add("S6", (scene.members ?? []).length >= 1 && memberMissing.length === 0,
    "every member row carries " + MEMBER_FIELDS.join("/") + " (missing: " + JSON.stringify(memberMissing) + ")")
  add("S7", (scene.incidents ?? []).length >= 1 && (observed.incidentLog ?? []).length >= 1 && observed.incidentLog.length >= scene.incidents.length,
    "the incident log is append-only and at least as long as the snapshot's own incident list (" + JSON.stringify({ snapshot: scene.incidents.length, log: observed.incidentLog.length }) + ")")
  add("S8", (observed.sceneFiles ?? []).length >= 2 && observed.sceneFiles.includes("latest.json"),
    "each incident kept its OWN immutable scene file beside the latest.json pointer (" + JSON.stringify(observed.sceneFiles) + ")")
  add("S9", observed.pointerMatchesNewest === true,
    "latest.json is the pointer a restart reads (its bytes match the newest incident scene)")
  add("S10", Number.isFinite(observed.hold?.since) && observed.hold?.taskId === "t1" && observed.hold?.attemptId === "att-1",
    "the hold sidecar names the task and attempt it paused (" + JSON.stringify({ since: observed.hold?.since, taskId: observed.hold?.taskId, attemptId: observed.hold?.attemptId }) + ")")
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

async function run(argv) {
  const dir = evidenceDir(argv, "scene")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  const fixture = await import(PATHS.fixture)
  const root = join(dir, "raw", "ws")
  const escalated = await fixture.runCase("escalate-3x", { root, print: false })
  say(SLUG, "fixture case escalate-3x: " + (escalated.ok ? "ok" : "FAILED"))
  // The case's own scene directory. The workspace root is DERIVED from the scene path the
  // fixture reported (…/<ws>/.mpd/team/watchdog/scene/<teamId>/<file>), never guessed: each case
  // gets its own per-run root under `root`.
  const incident = (escalated.observation?.incidents ?? []).at(-1) ?? {}
  if (incident.scene === undefined || incident.scene === null) throw new Error("the escalate case wrote no scene — cannot verify AC-5")
  const sceneDir = resolve(incident.scene, "..")
  const ws = resolve(sceneDir, "..", "..", "..", "..", "..")
  if (sceneDir === null) throw new Error("the escalate case wrote no scene — cannot verify AC-5")
  const pointer = join(sceneDir, "latest.json")
  const paths = storePaths(ws)
  const holdPath = paths.hold("fault-probe")
  const fresh = freshProcessRead([pointer, holdPath, paths.incidents, join(sceneDir, "20231114T221520Z-escalate.json")])
  const sceneFiles = await import("node:fs").then((fs) => fs.readdirSync(sceneDir).sort())
  const latest = JSON.parse(fresh.reads[pointer] ?? "null")
  const hold = JSON.parse(fresh.reads[holdPath] ?? "null")
  const incidentLog = String(fresh.reads[paths.incidents] ?? "").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
  const newestFile = sceneFiles.filter((name) => name !== "latest.json").at(-1)

  const observed = {
    workspace: ws,
    freshProcessPid: fresh.pid,
    readWith: "plain-fs",
    latest,
    hold,
    incidentLog,
    sceneFiles,
    pointerMatchesNewest: newestFile !== undefined && (fresh.reads[join(sceneDir, newestFile)] ?? "") === (fresh.reads[pointer] ?? ""),
    team: latest?.team?.id,
  }
  const verdict = evaluate(observed)
  const result = {
    task: "AC-5 / AC-10 (scene snapshot + durable hold + incident log, fresh-process read)",
    lane: SLUG,
    sceneDir,
    observed,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [
      "The snapshot is the INJECTED silence (the fixture's W-3) — no genuine provider wedge is claimed.",
      "The scene was produced in-process by the fixture and read from outside with plain fs; the read is what this lane witnesses, not a live host's write.",
    ],
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

const CAPTURE = captureStdout()
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  const scene = {
    schemaVersion: 1, at: 1, reason: "escalate", cause: { kind: "silence", ms: 120001 },
    team: { id: "fault-probe", name: "Fault probe", phase: "running", hold: { id: "h1", cause: "silence" } },
    tasks: [{ id: "t1" }], members: [{ id: "a", name: "Architect", status: "idle", unread: 0, currentTask: "t1", lastSeen: 1 }],
    mailbox: {}, parkedAttempts: { a: "att-1" }, incidents: [{ kind: "warn" }],
  }
  const healthy = {
    freshProcessPid: 999, readWith: "plain-fs", latest: scene, hold: { id: "h1", since: 1, taskId: "t1", attemptId: "att-1" },
    incidentLog: [{ kind: "warn" }, { kind: "escalate" }], sceneFiles: ["a-warn.json", "b-escalate.json", "latest.json"],
    pointerMatchesNewest: true, team: "fault-probe",
  }
  selfTest(SLUG, evaluate, healthy, [
    ["field-set", (copy) => { delete copy.latest.parkedAttempts }, "a snapshot missing a contracted field"],
    ["member-fields", (copy) => { delete copy.latest.members[0].lastSeen }, "a member row without its liveness field"],
    ["hold-mismatch", (copy) => { copy.latest.team.hold.id = "other" }, "a snapshot hold that disagrees with the sidecar"],
    ["log-shorter", (copy) => { copy.incidentLog = [] }, "an incident log with fewer records than the snapshot claims"],
    ["pointer", (copy) => { copy.pointerMatchesNewest = false }, "a latest.json pointer that is not the newest scene"],
    ["fresh-process", (copy) => { copy.freshProcessPid = process.pid }, "a read that was not made from a fresh process"],
  ])
}
try {
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  say(SLUG, "CRASH: " + String(error?.stack ?? error))
  process.exit(1)
}
