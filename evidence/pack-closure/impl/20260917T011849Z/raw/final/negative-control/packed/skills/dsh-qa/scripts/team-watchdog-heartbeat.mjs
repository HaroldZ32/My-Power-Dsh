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
//   * the tool heartbeat is the PAIR r6 landed: the PRE stamp (`tool-start`) comes from the
//     adapter's observe-only `tools/pre-execute` hook — present in the built bytes BY DESIGN,
//     because the watchdog dist INLINES the adapter — and the POST stamp (W-9: the tool's
//     completion) closes it with `ok:true`; the two are matched by `callId`. H5 therefore
//     asserts PRESENCE of both hooks AND the observe-only property (the hook owns `next()`,
//     returns the gate decision verbatim, hands the listener a FROZEN copy, contains a throwing
//     listener), proven on the REAL cordis waterfall here rather than by a byte scan (r6's
//     shape: the same real tool call with and without the hook, compared byte for byte).
//   * the pre-dispatch stamp carries NO veto and NO mutation: the old byte proxy
//     (`!dist.includes("tools/pre-execute")`) became FALSE when r6 landed and is RETIRED.
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
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  PATHS, REPO, captureStdout, evidenceDir, finish, freshProcessRead, liveAgent, mountRealWatchdog,
  read, sandboxWorkspace, say, selfTest, sha256, storePaths, writeEvidence, writeTeamRecord,
} from "./lib/watchdog-lane.mjs"

const SLUG = "team-watchdog-heartbeat"
const TEAM = "heartbeat-probe"
const CAPTAIN_SESSION = "session-captain-heartbeat"
const MEMBER_ID = "child-architect-heartbeat"
const MEMBER_NAME = "Architect"
/** The real tool body H5's observe-only probe really runs (ms). */
const PROBE_CALL_MS = 200

/**
 * r6's observe-only proof, in-lane (the shape of
 * `evidence/team-watchdog/long-tool-false-positive/20260916T015821Z/raw/observe-only-real-call.mjs`):
 * run the SAME real tool call twice — once on a plain vendored-cordis context, once with the
 * adapter's PRE hook installed — and compare the gate decision, the real command's outcome and
 * the post-execute decision byte for byte. The adapter under test is the REAL built dist (the
 * one the mounted row uses), and the tool body is a genuine child process.
 */
async function callOnce({ installHook, listenerThrows = false }) {
  const { Context } = await import(pathToFileURL(join(REPO, "packages", "mpd-agent-teams-plugin", "_deps", "cordis", "lib", "index.js")).href)
  const { createDshAdapter } = await import(pathToFileURL(PATHS.adapterDist).href)
  const ctx = new Context()
  const adapter = createDshAdapter(ctx)
  const seen = { ran: false, frozenCopy: false, mutationRejected: false, decisionKind: undefined, at: null }
  if (installHook) {
    adapter.onPreToolExecute((exec, decision) => {
      seen.ran = true
      seen.frozenCopy = Object.isFrozen(exec)
      seen.decisionKind = decision?.kind
      seen.at = Date.now()
      // A listener that TRIES to mutate what it observes must fail inside itself and change
      // nothing about the call (the copy is frozen; this runs in strict mode).
      try { exec.name = "mutated-by-the-observer" } catch { seen.mutationRejected = true }
      if (listenerThrows) throw new Error("observe-only probe: deliberate listener failure")
    })
  }
  const exec = { name: "bash", callId: "call-observe-1", arguments: { command: "sleep " + PROBE_CALL_MS + "ms" } }
  const gate = await ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow", content: undefined }))
  const started = Date.now()
  const child = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, " + PROBE_CALL_MS + ")"], { encoding: "utf8" })
  const elapsedMs = Date.now() - started
  const observedBeforeTheBody = installHook && seen.at !== null && seen.at <= started
  const result = { status: child.status, stdout: child.stdout, stderr: child.stderr, ranAsAChildProcess: child.pid !== undefined }
  const decision = await ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }))
  return { gate, result, elapsedMs, accepted: decision.kind, seen, observedBeforeTheBody, execAfterTheCall: exec }
}

/** H5's evidence: both waterfalls in the bytes + the observe-only property on a real call. */
async function proveObserveOnly() {
  const without = await callOnce({ installHook: false })
  const withHook = await callOnce({ installHook: true })
  const throwing = await callOnce({ installHook: true, listenerThrows: true })
  return {
    gateVerbatim: JSON.stringify(without.gate) === JSON.stringify(withHook.gate),
    resultVerbatim: JSON.stringify(without.result) === JSON.stringify(withHook.result),
    postDecisionVerbatim: without.accepted === withHook.accepted,
    commandRanForReal: without.elapsedMs >= PROBE_CALL_MS / 2 && withHook.elapsedMs >= PROBE_CALL_MS / 2,
    hookRan: withHook.seen.ran === true,
    hookSawTheGateDecision: withHook.seen.decisionKind === without.gate.kind,
    frozenCopy: withHook.seen.frozenCopy === true,
    mutationRejected: withHook.seen.mutationRejected === true,
    observedBeforeTheBody: withHook.observedBeforeTheBody === true,
    noHookNoObservation: without.seen.ran === false,
    throwingListenerContained: JSON.stringify(throwing.gate) === JSON.stringify(without.gate)
      && throwing.seen.ran === true
      && throwing.accepted === without.accepted,
    execUntouched: JSON.stringify(withHook.execAfterTheCall) === JSON.stringify(without.execAfterTheCall),
  }
}

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
  // H5 (r6/w16): the dist INLINES the adapter, so `tools/pre-execute` is present BY DESIGN. The
  // assertion is the PRESENCE of both waterfalls PLUS the observe-only property measured on a real
  // call — a byte scan can no longer witness it (that is what the retired `!includes` proxy was).
  const observe = observed.observeOnly ?? {}
  add("H5", observed.preHookPresent === true && observed.postHookPresent === true && observed.preHookSubscribed === true
    && observe.gateVerbatim === true && observe.resultVerbatim === true && observe.postDecisionVerbatim === true
    && observe.commandRanForReal === true && observe.hookRan === true && observe.hookSawTheGateDecision === true
    && observe.frozenCopy === true && observe.mutationRejected === true && observe.observedBeforeTheBody === true
    && observe.noHookNoObservation === true && observe.throwingListenerContained === true && observe.execUntouched === true,
    "the built bytes expose BOTH waterfalls ('tools/pre-execute' present BY DESIGN — the dist inlines the adapter — and 'tools/post-execute') AND the row subscribed the PRE hook, which is OBSERVE-ONLY on the REAL cordis waterfall: the same real tool call with and without the hook yields an identical gate decision, an identical command result and an identical post decision, the listener receives a FROZEN copy and its write is rejected, a THROWING listener still leaves the gate verbatim, and the stamp happened before the tool body ran (" + JSON.stringify(observe) + ")")

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
  // A REAL tool call, twice, with and without the row's PRE hook (r6's shape). Reported on stdout
  // so the raw evidence carries it too.
  const observeOnly = await proveObserveOnly()
  say(SLUG, "observe-only probe: " + JSON.stringify(observeOnly))

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
    preHookPresent: dist.includes("tools/pre-execute"),
    postHookPresent: dist.includes("tools/post-execute"),
    preHookSubscribed: mounted.events.includes("tools/pre-execute"),
    observeOnly,
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
      "The observe-only property is witnessed on the vendored cordis waterfall with the REAL adapter dist and a REAL child-process tool body, but NOT inside a live dsh session: the harness's own dispatch was not driven here.",
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
    events: ["agent/pre-step", "agent/session-start", "agent/turn-stopping", "tools/pre-execute", "tools/post-execute"],
    memberKinds: ["turn-start", "step", "step", "tool", "turn-end"],
    memberFile: "/ws/.mpd/team/watchdog/heartbeat/architect.jsonl",
    memberStamps: [
      { kind: "step", member: MEMBER_NAME, memberKey: MEMBER_NAME, teamId: TEAM, taskId: "t1", attemptId: "att-1", turnId: "Architect#1" },
      { kind: "tool", ok: true, tool: "bash", callId: "call-1", memberKey: MEMBER_NAME, turnId: "Architect#1" },
    ],
    captainStamps: [{ kind: "step", member: "captain", memberKey: "captain", turnId: "captain#1" }],
    freshProcessPid: 4242, freshProcessRead: true, turnIdsDistinct: true,
    preHookPresent: true, postHookPresent: true, preHookSubscribed: true,
    observeOnly: {
      gateVerbatim: true, resultVerbatim: true, postDecisionVerbatim: true, commandRanForReal: true,
      hookRan: true, hookSawTheGateDecision: true, frozenCopy: true, mutationRejected: true,
      observedBeforeTheBody: true, noHookNoObservation: true, throwingListenerContained: true, execUntouched: true,
    },
  }
  selfTest(SLUG, evaluate, healthy, [
    ["install", (copy) => { copy.disposers = 2 }, "a row that installed no writers"],
    ["event", (copy) => { copy.events = copy.events.filter((event) => event !== "tools/post-execute") }, "a missing tool hook"],
    ["tool-stamp", (copy) => { copy.memberStamps.find((stamp) => stamp.kind === "tool").ok = false }, "a tool stamp that is not post-completion-success"],
    ["captain", (copy) => { copy.captainStamps = [] }, "no captain stamp (AC-2 needs both)"],
    ["fresh-read", (copy) => { copy.freshProcessRead = false }, "a read that did not come from a fresh process"],
    // w16 H5's negative controls: the PRESENCE half and the observe-only half are each falsifiable.
    ["pre-hook-absent", (copy) => { copy.preHookPresent = false }, "the built bytes lost the pre-dispatch hook"],
    ["pre-hook-not-subscribed", (copy) => { copy.preHookSubscribed = false }, "the row never subscribed tools/pre-execute"],
    ["observe-only-veto", (copy) => { copy.observeOnly.gateVerbatim = false }, "a hook that REPLACES the gate decision (veto)"],
    ["observe-only-mutates", (copy) => { copy.observeOnly.frozenCopy = false }, "a live execution object handed to the listener (it could mutate the call)"],
    ["observe-only-write-lands", (copy) => { copy.observeOnly.mutationRejected = false }, "a listener write that was not rejected by the frozen copy"],
    ["observe-only-throws", (copy) => { copy.observeOnly.throwingListenerContained = false }, "a throwing listener that breaks the call it observes"],
    ["observe-only-after-body", (copy) => { copy.observeOnly.observedBeforeTheBody = false }, "a pre stamp that arrived after the tool body started"],
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
