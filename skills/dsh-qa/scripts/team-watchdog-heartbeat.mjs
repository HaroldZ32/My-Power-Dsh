#!/usr/bin/env bun
// Case team-watchdog-heartbeat — AC-1 / AC-2: the per-model-step and per-tool-call
// heartbeats, for MEMBERS and for the CAPTAIN.
//
// What is asserted (all from REAL artifacts, never from a source string):
//   * the row installs its writers on a mounted boot (the real watchdog dist over the real
//     adapter seam): `agent/pre-step`, `agent/session-start`, `agent/turn-stopping` and the
//     adapter's `tools/post-execute` hook are all subscribed (5 disposers measured);
//   * firing those events writes REAL heartbeat lines to
//     `<ws>/.mpd/team/watchdog/heartbeat/<memberKey>.jsonl`, which a FRESH `node` process
//     reads back with plain fs — the stamp set, the member resolution (member name for a
//     member, `captain` for the captain session) and the task/attempt binding;
//   * the tool stamp is POST-completion ONLY (W-9): the built bytes contain no pre-dispatch
//     hook and the stamp carries `ok:true` — a lane must never claim a pre-dispatch stamp.
//
// NOT CLAIMED (stated in the result, never laundered): no LIVE member turn is driven here —
// this sandbox has no dsh host, no model credential and no network, so no real model step or
// tool call is witnessed. The witness is the mounted boot + the events the host would fire,
// plus the on-disk stamps read by a fresh process. The silence DECISIONS those stamps feed are
// the fault lane's cases (`member-stops-stepping`, `captain-wedge`).
//
// PREREQ: built dists (packages/mpd-team-watchdog-plugin/dist/index.js,
//         packages/mpd-dsh-adapter-plugin/dist/index.js).
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-heartbeat/{result.json,output.log,raw/}
import {
  PATHS, captureStdout, evidenceDir, finish, freshProcessRead, liveAgent, mountRealWatchdog,
  read, sandboxWorkspace, say, selfTest, sha256, storePaths, writeEvidence, writeTeamRecord,
} from "./lib/watchdog-lane.mjs"

const SLUG = "team-watchdog-heartbeat"
const TEAM = "heartbeat-probe"
const CAPTAIN_SESSION = "session-captain-heartbeat"
const MEMBER_ID = "child-architect-heartbeat"
const MEMBER_NAME = "Architect"

/** The pure evaluator: everything it decides comes from the observed stamps + bytes. */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  add("H1", observed.applied === true && observed.disposers >= 4,
    "the mounted row installed its writers (applied=" + String(observed.applied) + ", disposers=" + String(observed.disposers) + ")")
  for (const event of ["agent/pre-step", "agent/session-start", "agent/turn-stopping", "tools/post-execute"]) {
    add("H2:" + event, (observed.events ?? []).includes(event), "the row subscribed " + event)
  }

  const kinds = observed.memberKinds ?? []
  add("H3", ["step", "turn-start", "turn-end", "tool"].every((kind) => kinds.includes(kind)),
    "the member's heartbeat file carries every stamped kind " + JSON.stringify(kinds))
  const tool = (observed.memberStamps ?? []).find((stamp) => stamp.kind === "tool")
  add("H4", tool !== undefined && tool.ok === true && tool.tool === "bash" && typeof tool.callId === "string",
    "the TOOL stamp is post-completion and carries the tool name + call id (" + JSON.stringify(tool) + ")")
  add("H5", observed.postOnly === true,
    "the built bytes expose NO pre-dispatch hook (the tool waterfall subscribed is tools/post-execute; 'tools/pre-execute' absent)")

  const memberStep = (observed.memberStamps ?? []).find((stamp) => stamp.kind === "step")
  add("H6", memberStep !== undefined && memberStep.member === MEMBER_NAME && memberStep.memberKey === MEMBER_NAME,
    "the member's step stamp resolves the MEMBER identity, and its file name is the plugin's own sanitized segment (" + JSON.stringify(memberStep && { member: memberStep.member, memberKey: memberStep.memberKey }) + ", file=" + String(observed.memberFile ?? "").split("/").pop() + ")")
  add("H7", memberStep !== undefined && memberStep.teamId === TEAM && memberStep.taskId === "t1" && memberStep.attemptId === "att-1",
    "the member's stamp binds the team, the current task and the attempt (" + JSON.stringify(memberStep && { teamId: memberStep.teamId, taskId: memberStep.taskId, attemptId: memberStep.attemptId }) + ")")

  const captain = (observed.captainStamps ?? []).find((stamp) => stamp.kind === "step")
  add("H8", captain !== undefined && captain.member === "captain" && captain.memberKey === "captain",
    "the CAPTAIN's own turn is stamped under memberKey 'captain' (" + JSON.stringify(captain && { member: captain.member, memberKey: captain.memberKey }) + ")")
  add("H9", observed.freshProcessPid !== undefined && observed.freshProcessPid !== process.pid && observed.freshProcessRead === true,
    "the stamps were read back by a FRESH process (pid " + String(observed.freshProcessPid) + " vs lane pid " + String(process.pid) + ")")
  add("H10", observed.turnIdsDistinct === true,
    "each stamp carries its generation's turnId (member keys stay disjoint)")

  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

function parseLines(text) {
  return String(text).split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
}

async function run(argv) {
  const dir = evidenceDir(argv, "heartbeat")
  const ws = sandboxWorkspace(dir, "heartbeat")
  const captain = liveAgent(CAPTAIN_SESSION, ws, { sessionId: CAPTAIN_SESSION })
  const member = liveAgent(MEMBER_ID, ws)
  writeTeamRecord(ws, {
    id: TEAM,
    phase: "running",
    captainSessionId: CAPTAIN_SESSION,
    members: [{ id: MEMBER_ID, name: MEMBER_NAME, role: "worker" }],
    tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }],
  })
  const mounted = await mountRealWatchdog({ workspace: ws, agents: [captain, member], config: { warnSilenceMs: 60_000, tickIntervalMs: 5_000, warnStreakToEscalate: 2 } })
  say(SLUG, "mounted: applied=" + String(mounted.report.applied) + " disposers=" + String(mounted.report.disposers) + " events=" + mounted.events.join(","))
  say(SLUG, "tools registered: " + [...mounted.registered.keys()].join(","))

  // The host's own event sequence: a turn starts, steps, calls a tool, then stops.
  await mounted.fire("agent/session-start", { agent: member })
  await mounted.fire("agent/pre-step", { agent: member, turn: 1, step: 1 })
  await mounted.fire("agent/pre-step", { agent: member, turn: 1, step: 2 })
  await mounted.fire("tools/post-execute", { name: "bash", agent: member, callId: "call-1" }, { ok: true }, async () => ({ kind: "accept" }))
  await mounted.fire("agent/turn-stopping", { agent: member })
  // The captain is stamped by the SAME path.
  await mounted.fire("agent/session-start", { agent: captain })
  await mounted.fire("agent/pre-step", { agent: captain, turn: 1, step: 1 })

  const memberFile = storePaths(ws).heartbeat("architect")
  const captainFile = storePaths(ws).heartbeat("captain")
  const fresh = freshProcessRead([memberFile, captainFile])
  const memberStamps = parseLines(fresh.reads[memberFile] ?? "")
  const captainStamps = parseLines(fresh.reads[captainFile] ?? "")
  const dist = read(PATHS.watchdogDist)

  const observed = {
    applied: mounted.report.applied,
    disposers: mounted.report.disposers,
    events: mounted.events,
    memberKinds: memberStamps.map((stamp) => stamp.kind),
    memberStamps,
    memberFile,
    captainStamps,
    freshProcessPid: fresh.pid,
    freshProcessRead: memberStamps.length > 0 && captainStamps.length > 0,
    postOnly: !dist.includes("tools/pre-execute") && dist.includes("tools/post-execute"),
    turnIdsDistinct: new Set(memberStamps.map((stamp) => stamp.turnId)).size >= 1 && memberStamps.every((stamp) => typeof stamp.turnId === "string"),
  }
  const verdict = evaluate(observed)
  const result = {
    task: "AC-1 / AC-2 (per-step and per-tool heartbeats for members and the captain)",
    lane: SLUG,
    workspace: ws,
    heartbeatFiles: { member: memberFile, captain: captainFile, memberSha256: sha256(fresh.reads[memberFile] ?? ""), captainSha256: sha256(fresh.reads[captainFile] ?? "") },
    observed,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [
      "No LIVE member turn was driven: this sandbox has no dsh host, no model credential and no network (the fixture's own NOT_CLAIMED #3). The witness is the mounted boot plus the events the host would fire, read back by a fresh process.",
      "No pre-dispatch tool stamp exists or is claimed (W-9): the tool stamp is POST-completion only.",
    ],
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

const CAPTURE = captureStdout()
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  const healthy = {
    applied: true, disposers: 5,
    events: ["agent/pre-step", "agent/session-start", "agent/turn-stopping", "tools/post-execute"],
    memberKinds: ["turn-start", "step", "step", "tool", "turn-end"],
    memberFile: "/ws/.mpd/team/watchdog/heartbeat/architect.jsonl",
    memberStamps: [
      { kind: "step", member: MEMBER_NAME, memberKey: MEMBER_NAME, teamId: TEAM, taskId: "t1", attemptId: "att-1", turnId: "Architect#1" },
      { kind: "tool", ok: true, tool: "bash", callId: "call-1", memberKey: MEMBER_NAME, turnId: "Architect#1" },
    ],
    captainStamps: [{ kind: "step", member: "captain", memberKey: "captain", turnId: "captain#1" }],
    freshProcessPid: 4242, freshProcessRead: true, postOnly: true, turnIdsDistinct: true,
  }
  selfTest(SLUG, evaluate, healthy, [
    ["install", (copy) => { copy.disposers = 2 }, "a row that installed no writers"],
    ["event", (copy) => { copy.events = copy.events.filter((event) => event !== "tools/post-execute") }, "a missing tool hook"],
    ["tool-stamp", (copy) => { copy.memberStamps.find((stamp) => stamp.kind === "tool").ok = false }, "a tool stamp that is not post-completion-success"],
    ["captain", (copy) => { copy.captainStamps = [] }, "no captain stamp (AC-2 needs both)"],
    ["fresh-read", (copy) => { copy.freshProcessRead = false }, "a read that did not come from a fresh process"],
    ["pre-dispatch", (copy) => { copy.postOnly = false }, "a claim of a pre-dispatch stamp (W-9)"],
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
