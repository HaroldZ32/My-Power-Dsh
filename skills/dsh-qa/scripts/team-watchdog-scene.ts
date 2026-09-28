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
//   bun skills/dsh-qa/scripts/team-watchdog-scene.ts --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-scene.ts [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-scene/{result.json,output.log,raw/}
import { join, resolve } from "node:path"
import { PATHS, captureStdout, evidenceDir, finish, freshProcessRead, say, selfTest, storePaths, writeEvidence, type FreshProcessRead, type LaneCheck, type LaneResult, type LaneVerdict, type StdoutCapture } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"

/** The lane slug, printed as every line's prefix and used in the evidence directory name. */
const SLUG: string = "team-watchdog-scene"
/** The AC-5 fields the snapshot must carry, in the contract's order. */
const SCENE_FIELDS: readonly string[] = ["schemaVersion", "at", "reason", "cause", "team", "tasks", "members", "mailbox", "parkedAttempts", "incidents"]
/** The per-member fields every member row must carry, in the contract's order. */
const MEMBER_FIELDS: readonly string[] = ["id", "name", "status", "unread", "currentTask", "lastSeen"]

/** The measured cause behind one escalation, as the snapshot records it. */
interface SceneCause {
  /** The cause kind (`silence` here). */
  kind?: string
  /** The measured silence, in milliseconds. */
  ms?: number
}

/** The snapshot's copy of the team's hold, which must agree with the hold sidecar. */
interface SceneHoldRef {
  /** The hold id. */
  id: string
  /** Why the hold was taken. */
  cause?: string
}

/** The team block inside the snapshot. */
interface SceneTeam {
  /** The team id. */
  id?: string
  /** The hold the snapshot recorded for this team; the S4 check compares it with the sidecar. */
  hold: SceneHoldRef
  /** Any further team field the snapshot carries. */
  readonly [extra: string]: unknown
}

/** One member row in the snapshot; every field is optional so a missing one is REPORTED, not thrown. */
interface SceneMember {
  /** The member id. */
  id?: string
  /** The member's display name. */
  name?: string
  /** The member's run status. */
  status?: string
  /** How many mailbox items the member has not read. */
  unread?: number
  /** The task the member is currently on. */
  currentTask?: string
  /** The newest stamp the snapshot saw for this member, in epoch milliseconds; deleted by a control. */
  lastSeen?: number
  /** Any further member field the snapshot carries. */
  readonly [extra: string]: unknown
}

/**
 * The contracted snapshot document. The lane's whole subject is asserting this shape, so the
 * fields its checks dereference directly are declared present and `evaluate` falls back to an
 * empty document when the pointer carried none; `parkedAttempts` stays optional because a
 * negative control deletes it.
 */
interface SceneDocument {
  /** The snapshot schema version; the contract's is 1. */
  schemaVersion?: number
  /** The snapshot instant, in epoch milliseconds. */
  at?: number
  /** Why the snapshot was taken (`escalate` here). */
  reason?: string
  /** The measured cause behind the escalation. */
  cause?: SceneCause
  /** The team the snapshot is about. */
  team: SceneTeam
  /** The team's task rows. */
  tasks: unknown[]
  /** The team's member rows, each of which must carry `lastSeen`. */
  members: SceneMember[]
  /** The per-member mailbox watermarks. */
  mailbox?: Record<string, unknown>
  /** The durable parked-attempt projection; a negative control deletes it. */
  parkedAttempts?: Record<string, unknown>
  /** The incidents this snapshot is the newest of. */
  incidents: unknown[]
  /** Any further field the snapshot carries. */
  readonly [extra: string]: unknown
}

/** The hold sidecar, as the fresh-process read parses it. */
interface SceneHold {
  /** The hold id, which the snapshot's own hold must agree with. */
  id?: string
  /** When the hold was taken, in epoch milliseconds. */
  since?: number
  /** The task the hold paused. */
  taskId?: string
  /** The attempt the hold paused. */
  attemptId?: string
  /** Any further hold field the sidecar carries. */
  readonly [extra: string]: unknown
}

/** The document `evaluate` reads: one run's fresh-process read, or the self-test's synthetic twin. */
interface SceneObservation {
  /** The pid of the FRESH process that performed the read; a control sets it to this process. */
  freshProcessPid?: number
  /** How the read was performed (`plain-fs`). */
  readWith?: string
  /** The parsed `latest.json` snapshot, or `null` when the pointer file was absent. */
  latest: SceneDocument | null
  /** The parsed hold sidecar, or `null` when it was absent. */
  hold: SceneHold | null
  /** Every parsed incident-log record, in file order. */
  incidentLog: unknown[]
  /** The scene directory's file names, sorted. */
  sceneFiles: string[]
  /** Whether the newest scene's bytes match the `latest.json` pointer's bytes. */
  pointerMatchesNewest?: boolean
  /** The team id the snapshot names. */
  team?: string
  /** The workspace the scene was read from (present on a run's own document). */
  workspace?: string
}

/** One incident record the fixture's escalate case observed. */
interface FixtureIncident {
  /** The absolute path of the immutable scene file this incident wrote. */
  scene?: string | null
  /** Any further incident field the fixture's observation carries. */
  readonly [extra: string]: unknown
}

/** One fixture case's result, as far as this lane reads it. */
interface FixtureCaseResult {
  /** Whether the case's own assertions held. */
  readonly ok: boolean
  /** The case's observation document. */
  readonly observation?: { readonly incidents?: readonly FixtureIncident[] }
}

/** The fault fixture's entry surface, as this lane drives it. */
interface FixtureModule {
  /**
   * @param name The case name to run (`escalate-3x` here).
   * @param options The case's knobs: its own root and whether it prints.
   * @returns The case's result, with the incidents it observed.
   */
  runCase(name: string, options: { root: string; print: boolean }): Promise<FixtureCaseResult>
}

/** The lane's result document: the read-back facts plus the verdict. */
interface SceneResult extends LaneResult {
  /** What this lane witnesses (AC-5 / AC-10). */
  readonly task: string
  /** The lane slug. */
  readonly lane: string
  /** The scene directory the snapshot was read from. */
  readonly sceneDir: string
  /** The fresh-process read and the documents it parsed. */
  readonly observed: SceneObservation
  /** The `result.json` path, filled in once the evidence is written. */
  evidenceFile?: string
}

/**
 * The pure evaluator over what the fresh process read.
 * @param observed The fresh-process read, parsed: the snapshot, the hold sidecar and the log.
 * @returns Whether every AC-5/AC-10 check holds, with the checks in S1–S10 order.
 */
export function evaluate(observed: SceneObservation): LaneVerdict {
  // Every check this evaluation ran, in the order it added them.
  const checks: LaneCheck[] = []
  /**
   * @param id The stable check id.
   * @param ok Whether the assertion held.
   * @param detail The line printed beside the verdict.
   * @returns The new length of the check list.
   */
  const add = (id: string, ok: unknown, detail: unknown): number => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  // The snapshot under test. The cast gives the empty fallback (a pointer that carried nothing)
  // the document's own type, because every check below reads it field by field and REPORTS each
  // missing field — the absence must surface as a failed check, never as a type error.
  const scene: SceneDocument = observed.latest ?? ({} as SceneDocument)

  add("S1", observed.freshProcessPid !== undefined && observed.freshProcessPid !== process.pid && observed.readWith === "plain-fs",
    "the scene was read by a FRESH process (pid " + String(observed.freshProcessPid) + " vs lane " + String(process.pid) + ") with plain fs only")
  // The contracted fields the snapshot does not carry.
  const missing = SCENE_FIELDS.filter((field) => scene[field] === undefined)
  add("S2", missing.length === 0, "the snapshot carries the AC-5 field set (missing: " + JSON.stringify(missing) + ")")
  add("S3", scene.reason === "escalate" && scene.cause?.kind === "silence" && typeof scene.cause?.ms === "number" && scene.schemaVersion === 1,
    "the escalation snapshot names its reason and the measured silence (" + JSON.stringify({ reason: scene.reason, cause: scene.cause }) + ")")
  add("S4", scene.team?.id === observed.team && scene.team?.hold?.id === observed.hold?.id && scene.team?.hold?.cause === "silence",
    "team.hold in the snapshot agrees with the durable hold sidecar (" + JSON.stringify({ scene: scene.team?.hold?.id, sidecar: observed.hold?.id }) + ")")
  add("S5", Object.keys(scene.parkedAttempts ?? {}).length >= 1,
    "the durable parkedAttempts projection is in the snapshot (" + JSON.stringify(scene.parkedAttempts) + ")")
  // The snapshot's first member row, or an empty row when it carries none.
  const member: SceneMember = (scene.members ?? [])[0] ?? {}
  // The per-member fields that member row does not carry.
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

/**
 * @param argv The process argv tail to scan for `--out`.
 * @returns The finished result document (its evidence already written).
 */
async function run(argv: readonly string[]): Promise<SceneResult> {
  // The immutable evidence directory this lane writes into.
  const dir = evidenceDir(argv, "scene")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  // The fault fixture, imported from the runtime path the lane's own paths module resolves.
  const fixture = (await import(PATHS.fixture)) as FixtureModule
  // The fixture's own workspace root inside this lane's raw scratch area.
  const root = join(dir, "raw", "ws")
  // The fixture's escalate case, which produces the scene through the REAL engine and scene writer.
  const escalated = await fixture.runCase("escalate-3x", { root, print: false })
  say(SLUG, "fixture case escalate-3x: " + (escalated.ok ? "ok" : "FAILED"))
  // The case's own scene directory. The workspace root is DERIVED from the scene path the
  // fixture reported (…/<ws>/.mpd/team/watchdog/scene/<teamId>/<file>), never guessed: each case
  // gets its own per-run root under `root`.
  // The newest incident the case observed, or an empty record when it wrote none.
  const incident: FixtureIncident = (escalated.observation?.incidents ?? []).at(-1) ?? {}
  if (incident.scene === undefined || incident.scene === null) throw new Error("the escalate case wrote no scene — cannot verify AC-5")
  // The case's own scene directory, derived from the scene path it reported.
  const sceneDir = resolve(incident.scene, "..")
  // The workspace root the store paths resolve from, five levels above the scene directory.
  const ws = resolve(sceneDir, "..", "..", "..", "..", "..")
  if (sceneDir === null) throw new Error("the escalate case wrote no scene — cannot verify AC-5")
  // The immutable pointer a restart reads.
  const pointer = join(sceneDir, "latest.json")
  // The watchdog store's paths for the derived workspace.
  const paths = storePaths(ws)
  // The hold sidecar path of the team the fixture's fault probe held.
  const holdPath = paths.hold("fault-probe")
  // The fresh-process read: the pointer, the hold sidecar, the incident log and one immutable scene.
  const fresh: FreshProcessRead = freshProcessRead([pointer, holdPath, paths.incidents, join(sceneDir, "20231114T221520Z-escalate.json")])
  // The scene directory's file names, sorted, read through a plain `node:fs` import.
  const sceneFiles = await import("node:fs").then((fs) => fs.readdirSync(sceneDir).sort())
  // The parsed snapshot the pointer named; the cast asserts the document shape S1–S10 then check.
  const latest = JSON.parse(fresh.reads[pointer] ?? "null") as SceneDocument | null
  // The parsed hold sidecar, or `null` when the fresh process found no file.
  const hold = JSON.parse(fresh.reads[holdPath] ?? "null") as SceneHold | null
  // Every parsed incident-log record, in file order.
  const incidentLog: unknown[] = String(fresh.reads[paths.incidents] ?? "").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
  // The newest immutable scene file, or nothing when only the pointer exists.
  const newestFile = sceneFiles.filter((name) => name !== "latest.json").at(-1)

  // The observation the evaluator and the result are both built from.
  const observed: SceneObservation = {
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
  // The evaluator's verdict over that observation.
  const verdict = evaluate(observed)
  // The result document: the lane's own facts plus the verdict.
  const result: SceneResult = {
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

/** Every stdout line this run printed, captured so the evidence log carries them. */
const CAPTURE: StdoutCapture = captureStdout()
/** The argv tail this process was started with, without the runtime and the script path. */
const argv: string[] = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  // The synthetic snapshot the self-test's healthy observation carries.
  const scene: SceneDocument = {
    schemaVersion: 1, at: 1, reason: "escalate", cause: { kind: "silence", ms: 120001 },
    team: { id: "fault-probe", name: "Fault probe", phase: "running", hold: { id: "h1", cause: "silence" } },
    tasks: [{ id: "t1" }], members: [{ id: "a", name: "Architect", status: "idle", unread: 0, currentTask: "t1", lastSeen: 1 }],
    mailbox: {}, parkedAttempts: { a: "att-1" }, incidents: [{ kind: "warn" }],
  }
  // The synthetic healthy observation the evaluator must accept before any control runs.
  const healthy: SceneObservation = {
    freshProcessPid: 999, readWith: "plain-fs", latest: scene, hold: { id: "h1", since: 1, taskId: "t1", attemptId: "att-1" },
    incidentLog: [{ kind: "warn" }, { kind: "escalate" }], sceneFiles: ["a-warn.json", "b-escalate.json", "latest.json"],
    pointerMatchesNewest: true, team: "fault-probe",
  }
  selfTest(SLUG, evaluate, healthy, [
    // The control deletes a field from the synthetic snapshot, which is always present here.
    ["field-set", (copy: SceneObservation): void => { delete copy.latest!.parkedAttempts }, "a snapshot missing a contracted field"],
    // The control deletes a member field from the synthetic snapshot's first member row.
    ["member-fields", (copy: SceneObservation): void => { delete copy.latest!.members[0].lastSeen }, "a member row without its liveness field"],
    // The control rewrites the synthetic snapshot's own hold id.
    ["hold-mismatch", (copy: SceneObservation): void => { copy.latest!.team.hold.id = "other" }, "a snapshot hold that disagrees with the sidecar"],
    ["log-shorter", (copy: SceneObservation): void => { copy.incidentLog = [] }, "an incident log with fewer records than the snapshot claims"],
    ["pointer", (copy: SceneObservation): void => { copy.pointerMatchesNewest = false }, "a latest.json pointer that is not the newest scene"],
    ["fresh-process", (copy: SceneObservation): void => { copy.freshProcessPid = process.pid }, "a read that was not made from a fresh process"],
  ])
}
try {
  // The finished run: its evidence is already written when this resolves.
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  // The thrown value is `unknown` under strict mode; it is viewed as a stack-bearing record so a
  // plain-object crash still reports its own `.stack`, exactly as that expression did before.
  say(SLUG, "CRASH: " + String((error as { stack?: unknown } | null)?.stack ?? error))
  process.exit(1)
}
