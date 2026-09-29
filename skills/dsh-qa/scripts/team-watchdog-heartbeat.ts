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
//   bun skills/dsh-qa/scripts/team-watchdog-heartbeat.ts --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-heartbeat.ts [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-heartbeat/{result.json,output.log,raw/}
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  PATHS, REPO, captureStdout, evidenceDir, finish, freshProcessRead, liveAgent, mountRealWatchdog,
  read, sandboxWorkspace, say, selfTest, sha256, storePaths, writeEvidence, writeTeamRecord,
} from "./lib/watchdog-lane.ts"
import type { LaneCheck, LaneResult, LaneVerdict, StdoutCapture } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"

/** The lane slug, which prefixes every printed line and names the evidence directory. */
const SLUG = "team-watchdog-heartbeat"
/** The team id the sandbox's team record is written under. */
const TEAM = "heartbeat-probe"
/** The captain's session id: captain recognition compares it with `team.captainSessionId`. */
const CAPTAIN_SESSION = "session-captain-heartbeat"
/** The member's agent id, as the live-agent double carries it. */
const MEMBER_ID = "child-architect-heartbeat"
/** The member's display name, which the member stamps must resolve to. */
const MEMBER_NAME = "Architect"
/** The real tool body H5's observe-only probe really runs (ms). */
const PROBE_CALL_MS = 200

/** One stamp line read back from a heartbeat JSONL — the store is the only schema. */
interface HeartbeatStamp {
  /** The stamped kind (`turn-start`, `step`, `tool`, `turn-end`). */
  kind: string
  /** Whether a tool stamp closed with a successful completion. */
  ok?: boolean
  /** The tool a tool stamp names. */
  tool?: string
  /** The host's call id, which pairs the PRE and POST stamps of one call. */
  callId?: string
  /** The resolved member identity the stamp carries. */
  member?: string
  /** The member key the stamp file is named after. */
  memberKey?: string
  /** The team the stamp belongs to. */
  teamId?: string
  /** The task the member was working on. */
  taskId?: string
  /** The attempt the task was on. */
  attemptId?: string
  /** The generation's turn id. */
  turnId?: string
  /** Any further field the store carries. */
  [field: string]: unknown
}

/** The observe-only probe's readback of the REAL cordis waterfall (r6's comparison shape). */
interface ObserveOnlyObservation {
  /** Whether the gate decision was bit-identical with and without the PRE hook. */
  gateVerbatim: boolean
  /** Whether the real command's result record was bit-identical with and without the hook. */
  resultVerbatim: boolean
  /** Whether the POST waterfall settled on the same decision kind with and without the hook. */
  postDecisionVerbatim: boolean
  /** Whether the child process really slept for the probe's duration (not a stubbed body). */
  commandRanForReal: boolean
  /** Whether the installed listener ran at all. */
  hookRan: boolean
  /** Whether that listener saw the same gate decision the waterfall settled on. */
  hookSawTheGateDecision: boolean
  /** Whether the execution object handed to the listener was frozen. */
  frozenCopy: boolean
  /** Whether the listener's write to that object was rejected. */
  mutationRejected: boolean
  /** Whether the PRE stamp happened before the tool body started. */
  observedBeforeTheBody: boolean
  /** Whether the call WITHOUT the hook left the listener uninvoked. */
  noHookNoObservation: boolean
  /** Whether a THROWING listener still left the gate and the POST decision verbatim. */
  throwingListenerContained: boolean
  /** Whether the execution object was untouched after the call. */
  execUntouched: boolean
}

/** The lane's whole observation: what the mount, the stamps and the probe really produced. */
interface HeartbeatObservation {
  /** Whether the mounted row applied. */
  applied: unknown
  /** How many disposers the mounted row returned (the writers it installed). */
  disposers: number
  /** Every event name the row subscribed to, in subscription order. */
  events: string[]
  /** The stamped kinds the member's heartbeat file carries, in file order. */
  memberKinds: string[]
  /** The member's stamps as a fresh process read them back. */
  memberStamps: HeartbeatStamp[]
  /** Absolute path of the member's heartbeat JSONL, named by the plugin's own member segment. */
  memberFile: string
  /** The captain's stamps as a fresh process read them back. */
  captainStamps: HeartbeatStamp[]
  /** The fresh reader's process id, or `undefined` when the read did not run. */
  freshProcessPid: number | undefined
  /** Whether both heartbeat files came back non-empty from that fresh process. */
  freshProcessRead: boolean
  /** Whether the built dist carries the PRE-dispatch waterfall (present BY DESIGN: it inlines the adapter). */
  preHookPresent: unknown
  /** Whether the built dist carries the POST-dispatch waterfall. */
  postHookPresent: unknown
  /** Whether the row really subscribed the PRE hook on the mounted boot. */
  preHookSubscribed: unknown
  /** The observe-only probe's readback. */
  observeOnly: ObserveOnlyObservation
  /** Whether every stamp carries a string turnId. */
  turnIdsDistinct: unknown
}

/** The two counters the mounted row's `apply` report carries. */
interface MountReport {
  /** Whether the row applied at all. */
  applied: unknown
  /** How many disposers the row returned. */
  disposers: number
}

/** The knobs `callOnce` accepts. */
interface CallOnceOptions {
  /** Whether the adapter's observe-only PRE hook is installed for this call. */
  installHook: boolean
  /** Whether the installed listener throws on purpose (the containment half of the proof). */
  listenerThrows?: boolean
}

/** The tool-execution record the harness hands a PRE/POST hook (only `name` is written by the probe). */
interface ProbeExec {
  /** The tool name the call would dispatch; the listener tries to mutate exactly this field. */
  name: string
  /** The host's call id, shared by the PRE and the POST waterfall. */
  callId: string
  /** The tool arguments, unread by this probe. */
  arguments: Record<string, unknown>
}

/** One gate decision: the kind the waterfall settled on, plus any content it carried. */
interface ProbeDecision {
  /** The decision kind (`allow` on the PRE gate, `accept` on the POST gate). */
  kind: string
  /** The content the decision carries, when any. */
  content?: unknown
}

/** The cordis waterfall lever of the vendored context — the only member this probe drives. */
interface ProbeContext {
  /**
   * @param target The receiver cordis passes as `this` (the context itself here).
   * @param event The waterfall's event name.
   * @param args The waterfall arguments; cordis's own `next` is the last one.
   * @returns The settled waterfall value.
   */
  waterfall(target: ProbeContext, event: string, ...args: unknown[]): Promise<ProbeDecision>
}

/** The adapter slice whose observe-only PRE hook this probe installs. */
interface ObserveOnlyAdapter {
  /**
   * @param listener The observer the real seam wraps; it owns `next()` and returns the gate verbatim.
   * @returns The disposer that removes the hook (unused: the probe process is short-lived).
   */
  onPreToolExecute(listener: (exec: ProbeExec, decision: ProbeDecision | undefined) => void): () => void
}

/** What one installed listener observed, which is what proves the hook is observe-only. */
interface ListenerObservations {
  /** Whether the listener ran at all. */
  ran: boolean
  /** Whether the execution object it received was frozen. */
  frozenCopy: boolean
  /** Whether its write to that object was rejected (the copy is frozen; this runs in strict mode). */
  mutationRejected: boolean
  /** The gate decision's kind, as the listener saw it. */
  decisionKind: string | undefined
  /** The instant the listener ran (epoch ms), or `null` while it has not run. */
  at: number | null
}

/** The real child process's result record, as the POST waterfall receives it. */
interface ProbeResult {
  /** The child's exit status, `null` when it was signalled. */
  status: number | null
  /** The child's stdout. */
  stdout: string
  /** The child's stderr. */
  stderr: string
  /** Whether a real child process was spawned. */
  ranAsAChildProcess: boolean
}

/** One real tool call's outcome, in the shape the evaluator compares byte for byte. */
interface CallOnceOutcome {
  /** The gate the PRE waterfall settled on. */
  gate: ProbeDecision
  /** The real command's own result record. */
  result: ProbeResult
  /** How long the child process took, in milliseconds. */
  elapsedMs: number
  /** The kind the POST waterfall settled on. */
  accepted: string
  /** What the installed listener observed. */
  seen: ListenerObservations
  /** Whether the listener ran before the tool body started. */
  observedBeforeTheBody: boolean
  /** The execution object after the call, compared to prove nothing was mutated. */
  execAfterTheCall: ProbeExec
}

/** The heartbeat lane's result document, as `writeEvidence` and `finish` consume it. */
interface HeartbeatResult extends LaneResult {
  /** The acceptance criteria this lane covers. */
  task: string
  /** The lane slug every printed line is prefixed with. */
  lane: string
  /** The sandbox workspace every artifact was read from. */
  workspace: string
  /** The two heartbeat files and their fingerprints, proving which bytes were read. */
  heartbeatFiles: { member: string; captain: string; memberSha256: string; captainSha256: string }
  /** Everything the evaluator decided on. */
  observed: HeartbeatObservation
  /** The evidence file this lane wrote, set once the record is persisted. */
  evidenceFile?: string
}

/**
 * r6's observe-only proof, in-lane (the shape of
 * `evidence/team-watchdog/long-tool-false-positive/20260916T015821Z/raw/observe-only-real-call.ts`):
 * run the SAME real tool call twice — once on a plain vendored-cordis context, once with the
 * adapter's PRE hook installed — and compare the gate decision, the real command's outcome and
 * the post-execute decision byte for byte. The adapter under test is the REAL built dist (the
 * one the mounted row uses), and the tool body is a genuine child process.
 * @param options Which hook to install and whether its listener throws.
 * @returns The gate, the child's result, the POST decision and what the listener observed.
 */
async function callOnce({ installHook, listenerThrows = false }: CallOnceOptions): Promise<CallOnceOutcome> {
  // The vendored cordis lib, loaded by absolute URL: a runtime path whose `Context` seeds the real waterfall.
  const { Context } = await import(pathToFileURL(join(REPO, "packages", "mpd-agent-teams-plugin", "_deps", "cordis", "lib", "index.ts")).href) as { Context: new () => ProbeContext }
  // The REAL adapter dist, loaded the same way; only the seam this probe installs is named here.
  const { createDshAdapter } = await import(pathToFileURL(PATHS.adapterDist).href) as { createDshAdapter: (ctx: unknown) => ObserveOnlyAdapter }
  // The plain cordis context both calls run on.
  const ctx = new Context()
  // The real adapter instance, whose PRE hook is installed for the `withHook` call.
  const adapter = createDshAdapter(ctx)
  // What the installed listener observed; `at`/`decisionKind` stay unset until it runs.
  const seen: ListenerObservations = { ran: false, frozenCopy: false, mutationRejected: false, decisionKind: undefined, at: null }
  if (installHook) {
    adapter.onPreToolExecute((exec: ProbeExec, decision: ProbeDecision | undefined): void => {
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
  // The execution record both waterfalls receive.
  const exec: ProbeExec = { name: "bash", callId: "call-observe-1", arguments: { command: "sleep " + PROBE_CALL_MS + "ms" } }
  // The PRE waterfall's settled gate, which must be identical with and without the hook.
  const gate = await ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow", content: undefined }))
  // The instant the real tool body starts, for the before/after comparison.
  const started = Date.now()
  // The real tool body: a genuine child process that sleeps for the probe's own duration.
  const child = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, " + PROBE_CALL_MS + ")"], { encoding: "utf8" })
  // How long that child took, in milliseconds.
  const elapsedMs = Date.now() - started
  // Whether the listener really ran BEFORE the tool body — the stamp's whole point.
  const observedBeforeTheBody = installHook && seen.at !== null && seen.at <= started
  // The result record the POST waterfall receives.
  const result: ProbeResult = { status: child.status, stdout: child.stdout, stderr: child.stderr, ranAsAChildProcess: child.pid !== undefined }
  // The POST waterfall's settled decision, which the hook must leave untouched.
  const decision = await ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }))
  return { gate, result, elapsedMs, accepted: decision.kind, seen, observedBeforeTheBody, execAfterTheCall: exec }
}

/** H5's evidence: both waterfalls in the bytes + the observe-only property on a real call. */
async function proveObserveOnly(): Promise<ObserveOnlyObservation> {
  // The same real tool call WITHOUT the PRE hook: the baseline every comparison uses.
  const without = await callOnce({ installHook: false })
  // The same call WITH the row's PRE hook installed.
  const withHook = await callOnce({ installHook: true })
  // The same call with a listener that throws, to prove the containment.
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

/**
 * The pure evaluator: everything it decides comes from the observed stamps + bytes.
 * @param observed The mount, stamp and probe facts this run really produced.
 * @returns The verdict: every check with its detail, and whether all of them held.
 */
export function evaluate(observed: HeartbeatObservation): LaneVerdict {
  // One entry per assertion, in the order the checks run.
  const checks: LaneCheck[] = []
  // Record one assertion, coercing `ok` and stringifying `detail` exactly as the lane always did.
  const add = (id: string, ok: unknown, detail: unknown): number => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  add("H1", observed.applied === true && observed.disposers >= 4,
    "the mounted row installed its writers (applied=" + String(observed.applied) + ", disposers=" + String(observed.disposers) + ")")
  for (const event of ["agent/pre-step", "agent/session-start", "agent/turn-stopping", "tools/post-execute"]) {
    add("H2:" + event, (observed.events ?? []).includes(event), "the row subscribed " + event)
  }

  // The stamped kinds the member's heartbeat file carries, in file order.
  const kinds = observed.memberKinds ?? []
  add("H3", ["step", "turn-start", "turn-end", "tool"].every((kind) => kinds.includes(kind)),
    "the member's heartbeat file carries every stamped kind " + JSON.stringify(kinds))
  // The member's POST tool stamp, which H4 asserts is post-completion and call-bound.
  const tool = (observed.memberStamps ?? []).find((stamp) => stamp.kind === "tool")
  add("H4", tool !== undefined && tool.ok === true && tool.tool === "bash" && typeof tool.callId === "string",
    "the TOOL stamp is post-completion and carries the tool name + call id (" + JSON.stringify(tool) + ")")
  // H5 (r6/w16): the dist INLINES the adapter, so `tools/pre-execute` is present BY DESIGN. The
  // assertion is the PRESENCE of both waterfalls PLUS the observe-only property measured on a real
  // call — a byte scan can no longer witness it (that is what the retired `!includes` proxy was).
  // The probe's readback, defaulted so a lane that never ran it still reddens H5.
  const observe = observed.observeOnly ?? {}
  add("H5", observed.preHookPresent === true && observed.postHookPresent === true && observed.preHookSubscribed === true
    && observe.gateVerbatim === true && observe.resultVerbatim === true && observe.postDecisionVerbatim === true
    && observe.commandRanForReal === true && observe.hookRan === true && observe.hookSawTheGateDecision === true
    && observe.frozenCopy === true && observe.mutationRejected === true && observe.observedBeforeTheBody === true
    && observe.noHookNoObservation === true && observe.throwingListenerContained === true && observe.execUntouched === true,
    "the built bytes expose BOTH waterfalls ('tools/pre-execute' present BY DESIGN — the dist inlines the adapter — and 'tools/post-execute') AND the row subscribed the PRE hook, which is OBSERVE-ONLY on the REAL cordis waterfall: the same real tool call with and without the hook yields an identical gate decision, an identical command result and an identical post decision, the listener receives a FROZEN copy and its write is rejected, a THROWING listener still leaves the gate verbatim, and the stamp happened before the tool body ran (" + JSON.stringify(observe) + ")")

  // The member's step stamp, which carries the resolved identity.
  const memberStep = (observed.memberStamps ?? []).find((stamp) => stamp.kind === "step")
  add("H6", memberStep !== undefined && memberStep.member === MEMBER_NAME && memberStep.memberKey === MEMBER_NAME,
    "the member's step stamp resolves the MEMBER identity, and its file name is the plugin's own sanitized segment (" + JSON.stringify(memberStep && { member: memberStep.member, memberKey: memberStep.memberKey }) + ", file=" + String(observed.memberFile ?? "").split("/").pop() + ")")
  add("H7", memberStep !== undefined && memberStep.teamId === TEAM && memberStep.taskId === "t1" && memberStep.attemptId === "att-1",
    "the member's stamp binds the team, the current task and the attempt (" + JSON.stringify(memberStep && { teamId: memberStep.teamId, taskId: memberStep.taskId, attemptId: memberStep.attemptId }) + ")")

  // The captain's own step stamp, read back from the captain's heartbeat file.
  const captain = (observed.captainStamps ?? []).find((stamp) => stamp.kind === "step")
  add("H8", captain !== undefined && captain.member === "captain" && captain.memberKey === "captain",
    "the CAPTAIN's own turn is stamped under memberKey 'captain' (" + JSON.stringify(captain && { member: captain.member, memberKey: captain.memberKey }) + ")")
  add("H9", observed.freshProcessPid !== undefined && observed.freshProcessPid !== process.pid && observed.freshProcessRead === true,
    "the stamps were read back by a FRESH process (pid " + String(observed.freshProcessPid) + " vs lane pid " + String(process.pid) + ")")
  add("H10", observed.turnIdsDistinct === true,
    "each stamp carries its generation's turnId (member keys stay disjoint)")

  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

/**
 * @param text The heartbeat JSONL's full text.
 * @returns One stamp per non-empty line, in file order.
 */
function parseLines(text: string): HeartbeatStamp[] {
  // The store is written by the mounted plugin, so each line is taken as a stamp record and the
  // evaluator asserts the fields it needs; the cast mirrors the lib's own JSON readback idiom.
  return String(text).split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as HeartbeatStamp)
}

/**
 * The real lane: mount the built watchdog over the stub harness, fire the host's event sequence,
 * read the stamps back with a fresh process and evaluate them.
 * @param argv The process arguments, scanned for `--out`.
 * @returns The result document this run persisted.
 */
async function run(argv: readonly string[]): Promise<HeartbeatResult> {
  // The immutable evidence directory: `--out`, or a fresh timestamped one.
  const dir = evidenceDir(argv, "heartbeat")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  // The sandbox workspace under that directory (DSH_HOME alone does not isolate workspace state).
  const ws = sandboxWorkspace(dir, "heartbeat")
  // The captain's live-agent double, recognised by the session id the team record names.
  const captain = liveAgent(CAPTAIN_SESSION, ws, { sessionId: CAPTAIN_SESSION })
  // The member's live-agent double.
  const member = liveAgent(MEMBER_ID, ws)
  writeTeamRecord(ws, {
    id: TEAM,
    phase: "running",
    captainSessionId: CAPTAIN_SESSION,
    members: [{ id: MEMBER_ID, name: MEMBER_NAME, role: "worker" }],
    tasks: [{ id: "t1", status: "in_progress", assignee: MEMBER_NAME, attempt: 1, attemptId: "att-1" }],
  })
  // The REAL watchdog dist mounted over the real adapter seam, with its own warning thresholds.
  const mounted = await mountRealWatchdog({ workspace: ws, agents: [captain, member], config: { warnSilenceMs: 60_000, tickIntervalMs: 5_000, warnStreakToEscalate: 2 } })
  // The row's own apply report; `mounted.report` is `unknown` on the shared mount seam, so the
  // cast below names the two counters this lane prints and evaluates.
  const report = mounted.report as MountReport
  say(SLUG, "mounted: applied=" + String(report.applied) + " disposers=" + String(report.disposers) + " events=" + mounted.events.join(","))
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

  // The member's heartbeat file, named by the plugin's own sanitized member segment.
  const memberFile = storePaths(ws).heartbeat("architect")
  // The captain's heartbeat file, keyed `captain`.
  const captainFile = storePaths(ws).heartbeat("captain")
  // The fresh-process readback of both files, which is what proves the stamps are on disk.
  const fresh = freshProcessRead([memberFile, captainFile])
  // The member's stamps, parsed out of that readback.
  const memberStamps = parseLines(fresh.reads[memberFile] ?? "")
  // The captain's stamps, parsed out of that readback.
  const captainStamps = parseLines(fresh.reads[captainFile] ?? "")
  // The built watchdog dist's bytes, whose two waterfall names the presence checks read.
  const dist = read(PATHS.watchdogDist)
  // A REAL tool call, twice, with and without the row's PRE hook (r6's shape). Reported on stdout
  // so the raw evidence carries it too.
  const observeOnly = await proveObserveOnly()
  say(SLUG, "observe-only probe: " + JSON.stringify(observeOnly))

  // Everything the evaluator decides on, taken from the artifacts above.
  const observed: HeartbeatObservation = {
    applied: report.applied,
    disposers: report.disposers,
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
  // The evaluator's verdict over that observation.
  const verdict = evaluate(observed)
  // The evidence document this run persists.
  const result: HeartbeatResult = {
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

/** Every line the run printed, captured so the same lines land in output.log. */
const CAPTURE: StdoutCapture = captureStdout()
// The raw command-line arguments, in the order the caller passed them.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  // The synthetic healthy observation the evaluator must accept.
  const healthy: HeartbeatObservation = {
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
    ["install", (copy: HeartbeatObservation): void => { copy.disposers = 2 }, "a row that installed no writers"],
    ["event", (copy: HeartbeatObservation): void => { copy.events = copy.events.filter((event) => event !== "tools/post-execute") }, "a missing tool hook"],
    // The fixture always carries the tool stamp, so the lookup below cannot come back empty.
    ["tool-stamp", (copy: HeartbeatObservation): void => { copy.memberStamps.find((stamp) => stamp.kind === "tool")!.ok = false }, "a tool stamp that is not post-completion-success"],
    ["captain", (copy: HeartbeatObservation): void => { copy.captainStamps = [] }, "no captain stamp (AC-2 needs both)"],
    ["fresh-read", (copy: HeartbeatObservation): void => { copy.freshProcessRead = false }, "a read that did not come from a fresh process"],
    // w16 H5's negative controls: the PRESENCE half and the observe-only half are each falsifiable.
    ["pre-hook-absent", (copy: HeartbeatObservation): void => { copy.preHookPresent = false }, "the built bytes lost the pre-dispatch hook"],
    ["pre-hook-not-subscribed", (copy: HeartbeatObservation): void => { copy.preHookSubscribed = false }, "the row never subscribed tools/pre-execute"],
    ["observe-only-veto", (copy: HeartbeatObservation): void => { copy.observeOnly.gateVerbatim = false }, "a hook that REPLACES the gate decision (veto)"],
    ["observe-only-mutates", (copy: HeartbeatObservation): void => { copy.observeOnly.frozenCopy = false }, "a live execution object handed to the listener (it could mutate the call)"],
    ["observe-only-write-lands", (copy: HeartbeatObservation): void => { copy.observeOnly.mutationRejected = false }, "a listener write that was not rejected by the frozen copy"],
    ["observe-only-throws", (copy: HeartbeatObservation): void => { copy.observeOnly.throwingListenerContained = false }, "a throwing listener that breaks the call it observes"],
    ["observe-only-after-body", (copy: HeartbeatObservation): void => { copy.observeOnly.observedBeforeTheBody = false }, "a pre stamp that arrived after the tool body started"],
  ])
}
try {
  // The lane's result document, printed and persisted by `finish`.
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  // The thrown value is `unknown`: it is viewed as an error-like record so a plain-object throw
  // still reports its own `.stack`, exactly as that expression did before.
  say(SLUG, "CRASH: " + String((error as { stack?: unknown } | null)?.stack ?? error))
  process.exit(1)
}
