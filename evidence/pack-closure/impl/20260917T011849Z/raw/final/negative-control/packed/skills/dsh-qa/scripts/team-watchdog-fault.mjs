#!/usr/bin/env bun
// Case team-watchdog-fault — AC-3 / AC-4 / AC-9 / AC-10 / AC-17: the injected-silence chain
// (WARN → ESCALATE → scene → preserving pause) driven through the VERIFIED fault fixture.
//
// The fixture is `packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs` (w8): it mounts
// the REAL watchdog dist, the REAL adopted scheduler/tools modules and the REAL hold path on a
// stub harness, and injects only SILENCE. This lane:
//   * runs every case in the fixture's own order (`runAll`) and asserts each case's OWN
//     observation fields (never a re-derivation): the 90 s WARN boundary, the 3-consecutive-WARN
//     escalation, the captain attribution, the preserving pause and the scene restore;
//   * exposes the AC-17 CONTRAST explicitly — the halt control runs the REAL `haltTeamWork`
//     (`cancelledTasks >= 1`, team.json CHANGED) while the pause preserves
//     (`sha256UnchangedAcrossHeldKicks`, `deliveriesWhileHeld: 0`) — i.e. AC-17 goes RED when the
//     pause is built on the halt path;
//   * REPEATS the fixture's `NOT_CLAIMED` entries VERBATIM in its own output and result: the
//     fixture's honest limits are never laundered into a lane pass.
//
// PREREQ: built dists (watchdog dist + the adopted lib). The fixture refuses loudly otherwise.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-fault.mjs [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-fault/{result.json,output.log,raw/}
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { PATHS, captureStdout, evidenceDir, finish, say, selfTest, sha256, writeEvidence } from "./lib/watchdog-lane.mjs"

const SLUG = "team-watchdog-fault"

/** The pure evaluator over the fixture's OWN case results. */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  const byCase = new Map((observed.cases ?? []).map((entry) => [entry.case, entry]))
  const expected = observed.expectedCases ?? []

  add("F1", expected.length > 0 && expected.every((name) => byCase.has(name)),
    "every fixture case ran (" + (observed.cases ?? []).length + " results for " + expected.length + " cases: " + expected.join(", ") + ")")
  const failed = (observed.cases ?? []).filter((entry) => entry.ok !== true).map((entry) => entry.case)
  add("F2", failed.length === 0, "every fixture case passed (failed: " + JSON.stringify(failed) + ")")

  const member = byCase.get("member-stops-stepping")?.observation ?? {}
  add("F11", member.distinctStampTimes === 3 && Array.isArray(member.tickAboveThreshold?.decisions) && member.tickAboveThreshold.decisions.includes("warn") && member.measuredFromLastStamp === true,
    "the member case measures silence FROM its last stamp: " + JSON.stringify({ stamps: member.distinctStampTimes, above: member.tickAboveThreshold?.decisions }))

  const warn = byCase.get("warn-90s")?.observation ?? {}
  add("F3", warn.belowThreshold?.decisions === 0 && (warn.aboveThreshold?.warnCount ?? 0) >= 1 && warn.warnLatencyWithinThresholdPlus5s === true && warn.knobsAreTheFrozenDefaults === true,
    "the 90 s boundary is exact and the FROZEN knobs are what ran: " + JSON.stringify({ below: warn.belowThreshold, above: warn.aboveThreshold, frozen: warn.knobsAreTheFrozenDefaults }))

  const escalate = byCase.get("escalate-3x")?.observation ?? {}
  add("F4", escalate.exactlyOneEscalatePerTaskAttempt === true && escalate.noFourthWarn === true && escalate.holdAppliedOnce === true && (escalate.stats?.scenes ?? 0) >= 3 && escalate.stats?.holdsApplied === 1,
    "the third consecutive WARN escalates ONCE, writes its scene and applies the hold once (kinds " + JSON.stringify(escalate.kinds) + ", stats " + JSON.stringify(escalate.stats) + ")")

  const captain = byCase.get("captain-wedge")?.observation ?? {}
  add("F5", captain.captainFlagged === true && captain.memberFlagged === false && captain.decisions?.[0]?.memberKey === "captain",
    "the CAPTAIN's own silence is attributed to memberKey 'captain' while the still-stepping member is NOT flagged (" + JSON.stringify({ captain: captain.captainFlagged, member: captain.memberFlagged }) + ")")

  const pause = byCase.get("pause-preserves")?.observation ?? {}
  add("F6", pause.sha256UnchangedAcrossHeldKicks === true && pause.deliveriesWhileHeld === 0 && pause.preserved === true && pause.cancelled === false,
    "the pause PRESERVES: team.json byte-unchanged across the held kicks, ZERO deliveries while held, nothing cancelled (" + JSON.stringify({ unchanged: pause.sha256UnchangedAcrossHeldKicks, deliveries: pause.deliveriesWhileHeld, preserved: pause.preserved }) + ")")
  add("F7", pause.resumed === true && (pause.deliveriesAfterResume ?? 0) >= 1 && pause.holdApplied === true,
    "after the resume dispatch works again (" + JSON.stringify(pause.deliveriesAfterResume) + " deliveries)")

  const halt = byCase.get("pause-preserves-halt-control")?.observation ?? {}
  add("F8", (halt.cancelledTasks ?? 0) >= 1 && halt.sha256Changed === true && halt.wouldReddenAC17 === true,
    "AC-17 CONTRAST: the halt control CALLS the real haltTeamWork (" + JSON.stringify(halt.mechanism) + ") — it cancels " + JSON.stringify(halt.cancelledTasks) + " task(s), the record CHANGES (" + JSON.stringify(halt.sha256Changed) + ") and the fixture itself marks wouldReddenAC17=" + JSON.stringify(halt.wouldReddenAC17))

  const scene = byCase.get("scene-restore")?.observation ?? {}
  add("F9", scene.latest?.reason === "escalate" && Object.keys(scene.latest?.parkedAttempts ?? {}).length >= 1 && scene.latest?.team?.hold?.id === scene.hold?.id && (scene.incidents ?? []).length >= 1 && String(scene.readWith ?? "").includes("plain fs"),
    "the scene restore leg re-reads the scene + hold + incidents with plain fs and the pointer's hold id matches the sidecar (" + JSON.stringify({ reason: scene.latest?.reason, holdMatch: scene.latest?.team?.hold?.id === scene.hold?.id, readWith: scene.readWith }) + ")")

  const echoed = observed.notClaimedEchoed ?? []
  add("F10", echoed.length === (observed.notClaimedSource ?? []).length && echoed.every((line, index) => line === (observed.notClaimedSource ?? [])[index]),
    "the fixture's NOT_CLAIMED entries are repeated VERBATIM (" + echoed.length + " entries, byte-identical)")
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

async function run(argv) {
  const dir = evidenceDir(argv, "fault")
  const fixture = await import(PATHS.fixture)
  const root = join(dir, "raw", "ws")
  mkdirSync(root, { recursive: true })
  say(SLUG, "fixture: " + PATHS.fixture)
  say(SLUG, "cases: " + fixture.CASES.join(", "))
  say(SLUG, "FROZEN: " + JSON.stringify(fixture.FROZEN))
  const cases = await fixture.runAll({ root, print: false })
  for (const entry of cases) say(SLUG, "case " + entry.case + ": " + (entry.ok ? "ok" : "FAILED") + " " + JSON.stringify(entry.observation))

  // The fixture's honest limits, repeated VERBATIM (never paraphrased, never dropped).
  say(SLUG, "REPEATING the fixture's NOT_CLAIMED verbatim:")
  for (const line of fixture.NOT_CLAIMED) say(SLUG, "NOT CLAIMED: " + line)

  const observed = {
    cases,
    expectedCases: fixture.CASES,
    notClaimedSource: fixture.NOT_CLAIMED,
    notClaimedEchoed: fixture.NOT_CLAIMED,
    fixtureSha256: sha256(await import("node:fs").then((fs) => fs.readFileSync(PATHS.fixture))),
    frozen: fixture.FROZEN,
    scenarios: fixture.scenarios(),
  }
  const verdict = evaluate(observed)
  const result = {
    task: "AC-3 / AC-4 / AC-9 / AC-10 / AC-17 (injected silence: WARN, escalate, scene, preserving pause, halt contrast)",
    lane: SLUG,
    root,
    observed,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: fixture.NOT_CLAIMED,
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

const CAPTURE = captureStdout()
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  const NOT = ["W-3: a GENUINE provider wedge is not reproducible here.", "The harness is stubbed.", "No live dsh host.", "`haltTeamWork` cancels."]
  const healthy = {
    expectedCases: ["member-stops-stepping", "captain-wedge", "warn-90s", "escalate-3x", "pause-preserves", "pause-preserves-halt-control", "scene-restore"],
    cases: [
      { case: "member-stops-stepping", ok: true, observation: { distinctStampTimes: 3, measuredFromLastStamp: true, tickAboveThreshold: { decisions: ["warn"] } } },
      { case: "captain-wedge", ok: true, observation: { captainFlagged: true, memberFlagged: false, decisions: [{ memberKey: "captain", assignee: "captain" }] } },
      { case: "warn-90s", ok: true, observation: { knobsAreTheFrozenDefaults: true, warnLatencyWithinThresholdPlus5s: true, belowThreshold: { decisions: 0 }, aboveThreshold: { warnCount: 1, silenceMs: 90001 } } },
      { case: "escalate-3x", ok: true, observation: { kinds: ["warn", "warn", "escalate", ""], exactlyOneEscalatePerTaskAttempt: true, noFourthWarn: true, holdAppliedOnce: true, stats: { scenes: 3, incidents: 3, holdsApplied: 1 } } },
      { case: "pause-preserves", ok: true, observation: { holdApplied: true, preserved: true, cancelled: false, sha256UnchangedAcrossHeldKicks: true, deliveriesWhileHeld: 0, resumed: true, deliveriesAfterResume: 1 } },
      { case: "pause-preserves-halt-control", ok: true, observation: { mechanism: "haltTeamWork (the adopted mass-cancel path), imported and CALLED", cancelledTasks: 1, sha256Changed: true, wouldReddenAC17: true } },
      { case: "scene-restore", ok: true, observation: { readWith: "plain fs + JSON.parse (no plugin reader) — the fresh-process shape", latest: { reason: "escalate", parkedAttempts: { "child-architect-fault": "att-1" }, team: { hold: { id: "hold-1" } } }, hold: { id: "hold-1" }, incidents: [{ kind: "escalate" }] } },
    ],
    notClaimedSource: NOT,
    notClaimedEchoed: NOT,
  }
  selfTest(SLUG, evaluate, healthy, [
    ["case-failed", (copy) => { copy.cases.find((entry) => entry.case === "escalate-3x").ok = false }, "a fixture case that failed"],
    ["warn-boundary", (copy) => { copy.cases.find((entry) => entry.case === "warn-90s").observation.belowThreshold.decisions = 1 }, "a WARN below the 90 s threshold"],
    ["no-hold", (copy) => { copy.cases.find((entry) => entry.case === "escalate-3x").observation.holdAppliedOnce = false }, "an escalation that applied no hold"],
    ["not-preserving", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves").observation.sha256UnchangedAcrossHeldKicks = false }, "a pause that mutated the team record"],
    ["deliveries", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves").observation.deliveriesWhileHeld = 1 }, "a dispatch that reached a held team"],
    ["no-contrast", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves-halt-control").observation.wouldReddenAC17 = false }, "a halt control that no longer shows AC-17 going red"],
    ["captain-missed", (copy) => { copy.cases.find((entry) => entry.case === "captain-wedge").observation.captainFlagged = false }, "a captain wedge that was not attributed"],
    ["scene-hold-mismatch", (copy) => { copy.cases.find((entry) => entry.case === "scene-restore").observation.hold.id = "other" }, "a scene pointer whose hold disagrees with the sidecar"],
    ["not-claimed-dropped", (copy) => { copy.notClaimedEchoed = copy.notClaimedEchoed.slice(1) }, "a lane that silently dropped a NOT_CLAIMED entry"],
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
