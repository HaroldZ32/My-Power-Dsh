#!/usr/bin/env bun
// Case team-watchdog-fault — the injected-silence chain (WARN → ESCALATE → scene → preserving
// pause) plus the §4 report-only surface, on TWO bases rather than one (t65, 2026-09-17):
//
//   (1) the VERIFIED fault fixture (`packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs`):
//       it mounts the REAL watchdog dist, the REAL adopted scheduler/tools modules and the REAL
//       hold path on a stub harness and injects only SILENCE. Its cases are kept, but the lane no
//       longer pretends they all hold on the redesigned engine. The measured path (t65; t59's
//       wording is CORRECTED here): the fixture NEVER emits `session/event` (0 occurrences), so
//       for a team whose members DO carry ids the engine resolves the owner session and then finds
//       `fold.view(sessionId) === null` → `heartbeatFallback: true` → §4 REPORT-ONLY, which may
//       warn at most once per task+attempt generation and may NEVER escalate or hold. Five of its
//       cases therefore encode PRE-REDESIGN expectations (warn ×3 → escalate → hold), and this
//       lane DECLARES them stale with their readings instead of failing on them or hiding them.
//   (2) an IN-LANE ARM (`§1 escalation` + `§4 report-only`) that drives the REAL built dist
//       directly — `apply(ctx, config)` → `report.engine.tickOnce(now)` — on a REAL-SHAPED team
//       (member OBJECTS carrying ids, as real records have) with FOLDED events
//       (`turn/start` + `step/start`, no answer, no `step/end`) so the §1 ladder really runs:
//       consecutive OUTSTANDING observations past `warnSilenceMs` ⇒ `escalate` ⇒ hold sidecar +
//       scene file, with the scene-restore leg then READ from that hold by plain fs. The SAME arm
//       with no live member session pins §4: at most ONE warn per task+attempt generation
//       (`silence-heartbeat`), NEVER an escalate, NEVER a hold.
//
// The AC-17 CONTRAST is unchanged: the halt control runs the REAL `haltTeamWork` while the pause
// preserves (`sha256UnchangedAcrossHeldKicks`, `deliveriesWhileHeld: 0`). The fixture's
// `NOT_CLAIMED` entries are repeated VERBATIM; the lane's own limits are declared too.
//
// LABELS (t65/S2): the tuple the fixture injects (90 000 / 3 / `pause`) is the fixture's OWN
// PRE-REDESIGN ROW CONFIG, NOT the product's frozen defaults. The product's §3 defaults are
// 600 000 / 6 / `warn-only` — that is what the in-lane arm runs, and the lane says so wherever it
// prints the fixture's numbers.
//
// PREREQ: built dists (watchdog dist + the adopted lib). The fixture refuses loudly otherwise.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-fault.mjs [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-fault/{result.json,output.log,raw/}
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PATHS, captureStdout, evidenceDir, finish, say, selfTest, sha256, writeEvidence } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"

/**
 * The fixture's OWN injected row config (its `FROZEN`): the PRE-REDESIGN tuple, kept by the
 * fixture so its silence injection still exercises the old ladder shape. It is NOT the product's
 * default — the product's §3 defaults are `SECTION3_DEFAULTS` below.
 */
const FIXTURE_INJECTED_TUPLE = { warnSilenceMs: 90_000, tickIntervalMs: 15_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" }
/** FROZEN CONTRACT §3: the values the redesigned engine runs with (600 000 / 6 / `warn-only`). */
const SECTION3_DEFAULTS = { warnSilenceMs: 600_000, tickIntervalMs: 15_000, warnStreakToEscalate: 6, actionOnEscalate: "warn-only" }
/** The §1 hold path is OPT-IN: a hold is applied only when `actionOnEscalate` is `pause` (§3). */
const SECTION3_PAUSE = { ...SECTION3_DEFAULTS, actionOnEscalate: "pause" }
const STATE_DIR = join(".mpd", "team")
const ARM_TEAM = "redesign-probe"
const ARM_MEMBER_ID = "session-architect"
const ARM_MEMBER = "Architect"

/**
 * A stub ctx with exactly the surface the watchdog row uses during `apply` + `install()` — the
 * same shape the verified fixture's own harness builds, kept minimal on purpose so the arm's
 * evidence is the ROW's behaviour and not the harness's.
 */
function makeCtx(workspace, { liveMembers = true, memberId = ARM_MEMBER_ID, memberName = ARM_MEMBER } = {}) {
  const services = new Map()
  const handlers = new Map()
  const effects = []
  const deliveries = []
  const warnings = []
  const tools = new Map()
  const member = { id: memberId, status: "working", session: { id: memberId, header: { cwd: workspace } } }
  const ctx = {
    get: (id) => services.get(id),
    provide: (id, value) => { services.set(id, value) },
    agents: { get: (id) => (id === memberId ? member : undefined), list: () => (liveMembers ? [member] : []) },
    logger: { warn: (...args) => warnings.push(args.map(String).join(" ")), info: (...args) => warnings.push(args.map(String).join(" ")), error: () => {}, debug: () => {} },
    on: (event, handler) => { handlers.set(event, handler); return () => handlers.delete(event) },
    effect: (callback) => { effects.push(callback) },
    inject: () => () => {},
    llm: { resolveCallConfig: async (request) => request, listModels: async () => [] },
    systemPrompt: { section: () => {} },
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) }, get: (name) => tools.get(name), has: (name) => tools.has(name) },
    subagents: {
      prompt: async (request) => { deliveries.push({ childId: request.childSessionId, text: (request.content ?? []).map((block) => block.text).join("") }); return { messageId: "m" + deliveries.length } },
      interrupt: () => {},
      drainContinuableChildren: async () => {},
    },
  }
  return {
    ctx, member, handlers, deliveries, warnings, services, tools,
    dispose: () => { for (const callback of effects.splice(0)) { try { const cleanup = callback(); if (typeof cleanup === "function") cleanup() } catch { /* a cleanup that throws must not take the arm down */ } } },
  }
}

/** A REAL-SHAPED team record: `members` are OBJECTS carrying ids, the way real records have them. */
function armTeamRecord(now) {
  return {
    id: ARM_TEAM,
    name: "redesign probe",
    captainSessionId: "session-captain",
    createdAt: now - 3_600_000,
    updatedAt: now,
    taskSeq: 1,
    phase: "running",
    members: [{ id: ARM_MEMBER_ID, name: ARM_MEMBER, role: "architect", status: "working", joinedAt: now - 3_600_000, currentTask: "t1" }],
    tasks: [{
      id: "t1", subject: "the observed task", description: "§1 ladder probe", status: "in_progress",
      assignee: ARM_MEMBER, dependencies: [], attempt: 1, attemptId: "att-arm-1",
      createdAt: now - 60_000, updatedAt: now - 60_000,
    }],
  }
}

/**
 * The plugin's own heartbeat-file key policy (`packages/mpd-team-watchdog-plugin/src/paths.ts`
 * `safeSegment`), re-implemented the way the verified fixture re-implements it (`inject.mjs:350`):
 * the engine looks the file up by the SANITIZED member name, so a stamp written under the raw
 * name is invisible to it — measured in this lane's first report-only run, which then read
 * `neverStarted: 1` instead of the §4 warn.
 */
function safeSegment(name) {
  return String(name).normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
}

/** Write the team record + ONE current-generation heartbeat stamp at `stampAt`. */
function armInject(workspace, record, stampAt) {
  const teamDir = join(workspace, STATE_DIR, ARM_TEAM)
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  writeFileSync(join(teamDir, "team.json"), JSON.stringify(record, null, 2) + "\n")
  const heartbeatDir = join(workspace, STATE_DIR, "watchdog", "heartbeat")
  mkdirSync(heartbeatDir, { recursive: true })
  const memberKey = safeSegment(ARM_MEMBER)
  const stamp = {
    kind: "step", at: stampAt, member: ARM_MEMBER, memberKey, teamId: ARM_TEAM, taskId: "t1",
    attemptId: "att-arm-1", turnId: ARM_MEMBER + "#1", workspace,
  }
  writeFileSync(join(heartbeatDir, memberKey + ".jsonl"), JSON.stringify(stamp) + "\n")
}

/**
 * THE §1 ARM — a real-shaped team + FOLDED events (`turn/start`, `step/start`, no answer) and a
 * tick schedule past `warnSilenceMs`, against the REAL built row.
 *
 * @returns the reading: per-tick decisions/holds, the hold sidecar, the scene file, the stats.
 */
async function escalationArm(root, { actionOnEscalate, liveMembers = true, ticks, folded = true }) {
  const workspace = join(root, "arm-" + actionOnEscalate + "-" + Math.random().toString(36).slice(2, 8))
  mkdirSync(workspace, { recursive: true })
  const previousRoot = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = workspace
  const harness = makeCtx(workspace, { liveMembers })
  const now = Date.now()
  try {
    const row = await import(PATHS.watchdogDist)
    const report = row.apply(harness.ctx, { stateDir: STATE_DIR, enabled: true, teamCacheMs: 0, keepGenerations: 3, deadTeamGraceMs: 86_400_000, verboseSkips: false, logPrefix: "arm", ...SECTION3_DEFAULTS, actionOnEscalate })
    if (report?.engine === undefined || report?.engine === null) return { arm: actionOnEscalate, error: "the row applied no engine: " + JSON.stringify(report?.error ?? null) }
    armInject(workspace, armTeamRecord(now), now)
    // FOLDED EVENTS: an OPEN step with no committed answer and no `step/end` ⇒ OUTSTANDING.
    // With `folded: false` the fold stays EMPTY for a KNOWN session, which is §4's trigger:
    // the engine answers `channelState: null` + `heartbeatFallback: true` (report-only).
    const onSession = harness.handlers.get("session/event")
    const session = { id: ARM_MEMBER_ID }
    const foldedEvents = folded && onSession !== undefined
      ? [onSession(session, { type: "turn/start", seq: 1, time: now, data: { turn: 1 } }), onSession(session, { type: "step/start", seq: 2, time: now, data: { turn: 1, step: 1 } })].length
      : 0
    const readTicks = []
    for (const offset of ticks) {
      const result = await report.engine.tickOnce(now + offset)
      readTicks.push({ offset, decisions: result.decisions.map((decision) => ({ type: decision.type, cause: decision.cause ?? null, streak: decision.streak ?? null, state: decision.state ?? null })), holds: [...result.holds], scenes: result.scenes.length })
    }
    const holdFile = join(workspace, STATE_DIR, "watchdog", "hold", ARM_TEAM + ".json")
    const sceneDir = join(workspace, STATE_DIR, "watchdog", "scene", ARM_TEAM)
    const stats = report.engine.getStats()
    const status = typeof report.engine.predicateStatus === "function" ? report.engine.predicateStatus() : null
    report.engine.stop()
    return {
      arm: actionOnEscalate,
      workspace,
      knobs: { warnSilenceMs: SECTION3_DEFAULTS.warnSilenceMs, warnStreakToEscalate: SECTION3_DEFAULTS.warnStreakToEscalate, actionOnEscalate },
      foldSubscribed: foldedEvents === 2,
      folded: folded === true,
      predicate: status === null ? null : { source: status.source, states: status.states, events: status.events },
      ticks: readTicks,
      kinds: readTicks.flatMap((tick) => tick.decisions.map((decision) => decision.type)),
      warnCauses: readTicks.flatMap((tick) => tick.decisions.filter((decision) => decision.type === "warn").map((decision) => decision.cause)),
      sceneFiles: existsSync(sceneDir) ? readdirSync(sceneDir).sort() : [],
      holdFileExists: existsSync(holdFile),
      hold: existsSync(holdFile) ? JSON.parse(readFileSync(holdFile, "utf8")) : null,
      stats,
    }
  } finally {
    harness.dispose()
    if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = previousRoot
  }
}

/** The scene-restore leg, read from the ARM's own sandbox with plain fs (the fresh-process shape). */
function sceneLeg(workspace) {
  const sceneDir = join(workspace, STATE_DIR, "watchdog", "scene", ARM_TEAM)
  const latestPath = join(sceneDir, "latest.json")
  const holdPath = join(workspace, STATE_DIR, "watchdog", "hold", ARM_TEAM + ".json")
  const incidentsPath = join(workspace, STATE_DIR, "watchdog", "incidents.jsonl")
  const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : null
  const hold = existsSync(holdPath) ? JSON.parse(readFileSync(holdPath, "utf8")) : null
  const incidents = existsSync(incidentsPath)
    ? readFileSync(incidentsPath, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
    : []
  return {
    readWith: "plain fs + JSON.parse (no plugin reader) — the fresh-process shape",
    sceneFiles: existsSync(sceneDir) ? readdirSync(sceneDir).sort() : [],
    latestReason: latest?.reason ?? null,
    pointerHoldId: latest?.team?.hold?.id ?? null,
    sidecarHoldId: hold?.id ?? null,
    holdMatch: latest?.team?.hold?.id !== undefined && latest?.team?.hold?.id === hold?.id,
    incidentKinds: incidents.map((entry) => entry.kind),
    escalatedIncident: incidents.find((entry) => entry.kind === "escalate") ?? null,
    holdFileExists: hold !== null,
  }
}

const SLUG = "team-watchdog-fault"

/**
 * The fixture cases whose expectations encode PRE-REDESIGN behaviour, each with the reading
 * signature that PROVES it (t65/S1). The measured cause: the fixture never emits `session/event`,
 * so with the member ids its records DO carry, the engine resolves the session and then finds no
 * fold data for it → `heartbeatFallback: true` → §4 report-only, where a hold can never be
 * applied. If one of these starts passing, its declaration must be re-checked instead of being
 * kept — that is what F2b's signature assertion enforces.
 */
const STALE_FIXTURE_CASES = {
  "escalate-3x": (observation) => (observation.kinds ?? [])[0] === "warn" && observation.holdAppliedOnce !== true && (observation.stats?.holdsApplied ?? 0) === 0,
  "scene-restore": (observation) => typeof observation.threw === "string" && observation.threw.includes("hold/"),
  "mid-turn-stall": (observation) => (observation.decisions ?? [])[0] === "warn" && (observation.stats?.holdsApplied ?? 0) === 0,
  "long-tool-bound-disabled-control": (observation) => (observation.kinds ?? [])[0] === "warn" && (observation.stats?.holdsApplied ?? 0) === 0,
  "completed-tool-not-in-flight": (observation) => (observation.kinds ?? [])[0] === "warn" && (observation.stats?.holdsApplied ?? 0) === 0,
}

/** The pure evaluator over the fixture's OWN case results PLUS the in-lane §1 / §4 arms. */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  const byCase = new Map((observed.cases ?? []).map((entry) => [entry.case, entry]))
  const expected = observed.expectedCases ?? []

  add("F1", expected.length > 0 && expected.every((name) => byCase.has(name)),
    "every fixture case ran (" + (observed.cases ?? []).length + " results for " + expected.length + " cases: " + expected.join(", ") + ")")

  // F2/F2b — the stale expectations are DECLARED and their staleness is MEASURED (t65/S1).
  const staleNames = Object.keys(STALE_FIXTURE_CASES)
  const failedCases = (observed.cases ?? []).filter((entry) => entry.ok !== true).map((entry) => entry.case)
  const failedNonStale = failedCases.filter((name) => !staleNames.includes(name))
  add("F2", failedNonStale.length === 0,
    "every fixture case that does NOT encode a pre-redesign expectation passed (stale, declared: " + JSON.stringify(failedCases.filter((name) => staleNames.includes(name))) + "; unexpected failures: " + JSON.stringify(failedNonStale) + ")")
  const staleReading = staleNames.map((name) => {
    const entry = byCase.get(name)
    if (entry === undefined) return { name, declared: false, reason: "case missing" }
    const stale = STALE_FIXTURE_CASES[name](entry.observation ?? {})
    return { name, ran: true, failed: entry.ok !== true, staleSignatureHolds: stale, why: stale ? "pre-redesign expectation vs report-only behaviour" : "the case now reads GREEN or differently — re-check the declaration" }
  })
  add("F2b", staleReading.every((entry) => entry.ran === true && entry.failed === true && entry.staleSignatureHolds === true),
    "each declared-stale fixture case STILL fails with its recorded signature (no `session/event` in the fixture ⇒ `fold.view(sessionId) === null` ⇒ `heartbeatFallback: true` ⇒ §4 report-only, which can never escalate or hold): " + JSON.stringify(staleReading))

  const member = byCase.get("member-stops-stepping")?.observation ?? {}
  add("F11", member.distinctStampTimes === 3 && Array.isArray(member.tickAboveThreshold?.decisions) && member.tickAboveThreshold.decisions.includes("warn") && member.measuredFromLastStamp === true,
    "the member case measures silence FROM its last stamp: " + JSON.stringify({ stamps: member.distinctStampTimes, above: member.tickAboveThreshold?.decisions }))

  // F3 — LABEL FIX (t65/S2): the fixture's 90 000/3/`pause` is its OWN INJECTED PRE-REDESIGN ROW
  // CONFIG, never "the product's frozen defaults" (those are §3's 600 000/6/`warn-only`).
  const warn = byCase.get("warn-90s")?.observation ?? {}
  const fixtureTuple = observed.labels?.fixtureTuple ?? {}
  add("F3", warn.belowThreshold?.decisions === 0 && (warn.aboveThreshold?.warnCount ?? 0) >= 1 && warn.warnLatencyWithinThresholdPlus5s === true && warn.knobsAreTheFrozenDefaults === true &&
    fixtureTuple.warnSilenceMs === FIXTURE_INJECTED_TUPLE.warnSilenceMs && fixtureTuple.warnStreakToEscalate === FIXTURE_INJECTED_TUPLE.warnStreakToEscalate && fixtureTuple.actionOnEscalate === FIXTURE_INJECTED_TUPLE.actionOnEscalate,
    "the 90 s boundary is exact AND the knobs that ran are the FIXTURE'S INJECTED PRE-REDESIGN tuple (" + JSON.stringify(fixtureTuple) + "), not the product default: " + JSON.stringify({ below: warn.belowThreshold, above: warn.aboveThreshold }))

  // F4/F4b — THE §1 ESCALATION ARM (t65/S1): a real-shaped team + folded events, on the real row.
  const arm = observed.escalationArm ?? {}
  const armKinds = arm.kinds ?? []
  add("F4", arm.foldSubscribed === true && arm.predicate?.source === "channel" && Object.values(arm.predicate?.states ?? {}).includes("OUTSTANDING") &&
    armKinds.includes("escalate") && arm.holdFileExists === true && arm.hold?.teamId === ARM_TEAM && (arm.stats?.holdsApplied ?? 0) >= 1 && (arm.sceneFiles ?? []).length >= 1,
    "§1 LADDER END-TO-END on a real-shaped team (members as OBJECTS with ids) with FOLDED events (turn/start + step/start, no answer): the fold says OUTSTANDING, " + JSON.stringify(armKinds) + " escalates and a hold sidecar is written (" + JSON.stringify({ hold: arm.hold?.teamId ?? null, scenes: arm.sceneFiles?.length ?? 0, stats: arm.stats?.holdsApplied ?? null }) + ")")
  const warnOnly = observed.warnOnlyArm ?? {}
  add("F4b", (warnOnly.kinds ?? []).includes("escalate") && warnOnly.holdFileExists === false && (warnOnly.stats?.holdsApplied ?? 0) === 0,
    "the §3 DEFAULT `warn-only` escalates and applies NO hold (kinds " + JSON.stringify(warnOnly.kinds) + ", holdFile " + JSON.stringify(warnOnly.holdFileExists) + ") — the hold path is opt-in")

  const captain = byCase.get("captain-wedge")?.observation ?? {}
  add("F5", captain.captainFlagged === true && captain.memberFlagged === false && captain.decisions?.[0]?.memberKey === "captain",
    "the CAPTAIN's own silence is attributed to memberKey 'captain' while the still-stepping member is NOT flagged (" + JSON.stringify({ captain: captain.captainFlagged, member: captain.memberFlagged }) + ")")

  const pause = byCase.get("pause-preserves")?.observation ?? {}
  add("F6", pause.sha256UnchangedAcrossHeldKicks === true && pause.deliveriesWhileHeld === 0 && pause.preserved === true && pause.cancelled === false,
    "the pause PRESERVES: team.json byte-unchanged across the held kicks, ZERO deliveries while held, nothing cancelled (" + JSON.stringify({ unchanged: pause.sha256UnchangedAcrossHeldKicks, deliveries: pause.deliveriesWhileHeld, preserved: pause.preserved, declines: pause.declineLines?.length ?? 0 }) + ")")
  add("F7", pause.resumed === true && (pause.deliveriesAfterResume ?? 0) >= 1 && pause.holdApplied === true,
    "after the resume dispatch works again (" + JSON.stringify(pause.deliveriesAfterResume) + " deliveries)")

  const halt = byCase.get("pause-preserves-halt-control")?.observation ?? {}
  add("F8", (halt.cancelledTasks ?? 0) >= 1 && halt.sha256Changed === true && halt.wouldReddenAC17 === true,
    "AC-17 CONTRAST: the halt control CALLS the real haltTeamWork (" + JSON.stringify(halt.mechanism) + ") — it cancels " + JSON.stringify(halt.cancelledTasks) + " task(s), the record CHANGES (" + JSON.stringify(halt.sha256Changed) + ") and the fixture itself marks wouldReddenAC17=" + JSON.stringify(halt.wouldReddenAC17))

  // F9 — the scene-restore leg, now read from the ARM's OWN hold (the fixture's `scene-restore`
  // case cannot produce one, which is exactly why it is declared stale above).
  const scene = observed.sceneLeg ?? {}
  add("F9", scene.latestReason === "escalate" && scene.holdMatch === true && scene.holdFileExists === true && scene.escalatedIncident?.hold === "applied" && String(scene.readWith ?? "").includes("plain fs"),
    "the scene restore leg re-reads the scene + hold + incidents with plain fs from the §1 ARM's hold: " + JSON.stringify({ reason: scene.latestReason, holdMatch: scene.holdMatch, incidentKinds: scene.incidentKinds, readWith: scene.readWith }))

  const echoed = observed.notClaimedEchoed ?? []
  add("F10", echoed.length === (observed.notClaimedSource ?? []).length && echoed.every((line, index) => line === (observed.notClaimedSource ?? [])[index]),
    "the fixture's NOT_CLAIMED entries are repeated VERBATIM (" + echoed.length + " entries, byte-identical)")

  // F12 — THE §4 REPORT-ONLY PIN (t65/S1): no owner session ⇒ heartbeat fallback ⇒ at most ONE
  // warn per task+attempt generation, and NEVER an escalate or a hold.
  const reportOnly = observed.reportOnlyArm ?? {}
  const reportKinds = reportOnly.kinds ?? []
  const warns = reportKinds.filter((kind) => kind === "warn").length
  add("F12", warns === 1 && reportKinds.includes("escalate") === false && (reportOnly.stats?.holdsApplied ?? 0) === 0 && reportOnly.holdFileExists === false && reportOnly.warnCauses?.length > 0 && reportOnly.warnCauses.every((cause) => cause === "silence-heartbeat"),
    "§4 REPORT-ONLY pinned: with no fold evidence the engine warns at most ONCE per task+attempt generation (cause `silence-heartbeat`) and NEVER escalates or holds — " + JSON.stringify({ ticks: reportKinds, warns, causes: reportOnly.warnCauses, holdsApplied: reportOnly.stats?.holdsApplied ?? null, holdFile: reportOnly.holdFileExists }))

  // F13 — the LABEL itself is asserted, so the pre-redesign tuple cannot be re-advertised as the
  // product's frozen defaults without this lane failing.
  const labels = observed.labels ?? {}
  add("F13", labels.fixtureTupleIsPreRedesign === true && labels.section3IsProductDefault === true &&
    labels.productDefaults?.warnSilenceMs === 600_000 && labels.productDefaults?.warnStreakToEscalate === 6 && labels.productDefaults?.actionOnEscalate === "warn-only" &&
    String(labels.fixtureTupleLabel ?? "").includes("NOT the product default") && String(labels.productDefaultsLabel ?? "").includes("§3"),
    "the labels are the corrected ones: the injected tuple is declared as the fixture's own pre-redesign config and §3's 600 000/6/warn-only as the product default — " + JSON.stringify(labels.productDefaults))
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

async function run(argv) {
  const dir = evidenceDir(argv, "fault")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  const fixture = await import(PATHS.fixture)
  const root = join(dir, "raw", "ws")
  mkdirSync(root, { recursive: true })
  say(SLUG, "fixture: " + PATHS.fixture)
  say(SLUG, "cases: " + fixture.CASES.join(", "))
  say(SLUG, "fixture-INJECTED tuple (PRE-REDESIGN row config, NOT the product default): " + JSON.stringify(fixture.FROZEN))
  say(SLUG, "product §3 defaults (what the in-lane arm runs): " + JSON.stringify(SECTION3_DEFAULTS))
  say(SLUG, "declared-stale fixture cases (no `session/event` emitted ⇒ fold.view()===null ⇒ §4 report-only ⇒ no escalate, no hold): " + Object.keys(STALE_FIXTURE_CASES).join(", "))
  const cases = await fixture.runAll({ root, print: false })
  for (const entry of cases) say(SLUG, "case " + entry.case + ": " + (entry.ok ? "ok" : "FAILED") + " " + JSON.stringify(entry.observation))

  // The fixture's honest limits, repeated VERBATIM (never paraphrased, never dropped).
  say(SLUG, "REPEATING the fixture's NOT_CLAIMED verbatim:")
  for (const line of fixture.NOT_CLAIMED) say(SLUG, "NOT CLAIMED: " + line)

  // ── the in-lane arms (t65/S1): the §1 escalation end-to-end, the warn-only contrast, §4 ──
  const ladderTicks = [600_001, 615_001, 630_001, 645_001, 660_001, 675_001, 690_001, 705_001]
  say(SLUG, "§1 arm: applying the REAL row (built dist) with §3 numbers + `actionOnEscalate: pause` and FOLDED events …")
  const escalationArmReading = await escalationArm(root, { actionOnEscalate: "pause", ticks: ladderTicks })
  say(SLUG, "  §1 arm reading: " + JSON.stringify({ fold: escalationArmReading.foldSubscribed, predicate: escalationArmReading.predicate?.source, states: escalationArmReading.predicate?.states, kinds: escalationArmReading.kinds, holdFile: escalationArmReading.holdFileExists, holdsApplied: escalationArmReading.stats?.holdsApplied }))
  const warnOnlyArmReading = await escalationArm(root, { actionOnEscalate: SECTION3_DEFAULTS.actionOnEscalate, ticks: ladderTicks })
  say(SLUG, "  warn-only arm reading: " + JSON.stringify({ kinds: warnOnlyArmReading.kinds, holdFile: warnOnlyArmReading.holdFileExists, holdsApplied: warnOnlyArmReading.stats?.holdsApplied }))
  const reportOnlyArmReading = await escalationArm(root, { actionOnEscalate: "pause", liveMembers: false, folded: false, ticks: [601_000, 1_200_000, 1_800_000, 2_400_000] })
  say(SLUG, "  §4 report-only arm reading: " + JSON.stringify({ kinds: reportOnlyArmReading.kinds, warns: reportOnlyArmReading.warnCauses, holdsApplied: reportOnlyArmReading.stats?.holdsApplied, holdFile: reportOnlyArmReading.holdFileExists }))
  const scene = escalationArmReading.workspace === undefined ? null : sceneLeg(escalationArmReading.workspace)
  if (scene !== null) say(SLUG, "  scene-restore leg (from the §1 arm's hold): " + JSON.stringify(scene))

  const observed = {
    cases,
    expectedCases: fixture.CASES,
    staleFixtureCases: Object.keys(STALE_FIXTURE_CASES),
    notClaimedSource: fixture.NOT_CLAIMED,
    notClaimedEchoed: fixture.NOT_CLAIMED,
    fixtureSha256: sha256(await import("node:fs").then((fs) => fs.readFileSync(PATHS.fixture))),
    frozen: fixture.FROZEN,
    scenarios: fixture.scenarios(),
    escalationArm: escalationArmReading,
    warnOnlyArm: warnOnlyArmReading,
    reportOnlyArm: reportOnlyArmReading,
    sceneLeg: scene,
    labels: {
      fixtureTuple: fixture.FROZEN,
      fixtureTupleIsPreRedesign: true,
      fixtureTupleLabel: "the fixture's OWN injected row config (" + JSON.stringify(FIXTURE_INJECTED_TUPLE) + ") — the PRE-REDESIGN tuple, NOT the product default",
      productDefaults: SECTION3_DEFAULTS,
      section3IsProductDefault: true,
      productDefaultsLabel: "FROZEN CONTRACT §3 — " + JSON.stringify(SECTION3_DEFAULTS),
    },
    laneLimits: [
      "the in-lane §1/§4 arms mount the REAL built row on a STUB ctx (the same shape the verified fixture uses): services, agents, logger, tools are simulated; the engine, machine, store, hold path and scene writer are real modules",
      "the arm's ticks are MANUAL (`report.engine.tickOnce(now)` with an injected clock); no wall clock is waited on",
      "the fixture's five declared-stale cases are REPORTED with their readings, never treated as passes",
    ],
  }
  const verdict = evaluate(observed)
  const result = {
    task: "AC-3 / AC-4 / AC-9 / AC-10 / AC-17 (injected silence) + §1 escalation end-to-end + §4 report-only pin (t65)",
    lane: SLUG,
    root,
    observed,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [...fixture.NOT_CLAIMED, ...observed.laneLimits],
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

const CAPTURE = captureStdout()
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  const NOT = ["W-3: a GENUINE provider wedge is not reproducible here.", "The harness is stubbed.", "No live dsh host.", "`haltTeamWork` cancels."]
  const ALL_CASES = ["dead-team-suppressed", "live-team-never-started", "second-team-dispatch", "disabled-control", "never-started-recorded", "completed-turn-idle", "mid-turn-stall", "member-stops-stepping", "captain-wedge", "warn-90s", "escalate-3x", "pause-preserves", "pause-preserves-halt-control", "scene-restore", "long-tool-no-hold", "long-tool-bound-disabled-control", "completed-tool-not-in-flight", "tool-inflight-expired"]
  // Every other case is a plain pass; the ones the evaluator reads get their own observation.
  const SPECIFIC = {
    "member-stops-stepping": { ok: true, observation: { distinctStampTimes: 3, measuredFromLastStamp: true, tickAboveThreshold: { decisions: ["warn"] } } },
    "captain-wedge": { ok: true, observation: { captainFlagged: true, memberFlagged: false, decisions: [{ memberKey: "captain", assignee: "captain" }] } },
    "warn-90s": { ok: true, observation: { knobsAreTheFrozenDefaults: true, warnLatencyWithinThresholdPlus5s: true, belowThreshold: { decisions: 0 }, aboveThreshold: { warnCount: 1, silenceMs: 90001 } } },
    "pause-preserves": { ok: true, observation: { holdApplied: true, preserved: true, cancelled: false, sha256UnchangedAcrossHeldKicks: true, deliveriesWhileHeld: 0, declineLines: ["declined"], resumed: true, deliveriesAfterResume: 1 } },
    "pause-preserves-halt-control": { ok: true, observation: { mechanism: "haltTeamWork (the adopted mass-cancel path), imported and CALLED", cancelledTasks: 1, sha256Changed: true, wouldReddenAC17: true } },
    "escalate-3x": { ok: false, observation: { kinds: ["warn", "", "", ""], holdAppliedOnce: false, exactlyOneEscalatePerTaskAttempt: false, stats: { scenes: 1, holdsApplied: 0 } } },
    "scene-restore": { ok: false, observation: { threw: "ENOENT: no such file or directory, open '…/.mpd/team/watchdog/hold/fault-probe.json'" } },
    "mid-turn-stall": { ok: false, observation: { decisions: ["warn"], holdsApplied: 0, stats: { holdsApplied: 0 } } },
    "long-tool-bound-disabled-control": { ok: false, observation: { kinds: ["warn", "", ""], stats: { holdsApplied: 0 } } },
    "completed-tool-not-in-flight": { ok: false, observation: { kinds: ["warn", "", ""], stats: { holdsApplied: 0 } } },
  }
  const healthy = {
    expectedCases: ALL_CASES,
    staleFixtureCases: Object.keys(STALE_FIXTURE_CASES),
    cases: ALL_CASES.map((name) => ({ case: name, ok: SPECIFIC[name]?.ok ?? true, observation: SPECIFIC[name]?.observation ?? {} })),
    notClaimedSource: NOT,
    notClaimedEchoed: NOT,
    labels: {
      fixtureTuple: { ...FIXTURE_INJECTED_TUPLE },
      fixtureTupleIsPreRedesign: true,
      fixtureTupleLabel: "the fixture's OWN injected row config — the PRE-REDESIGN tuple, NOT the product default",
      productDefaults: { ...SECTION3_DEFAULTS },
      section3IsProductDefault: true,
      productDefaultsLabel: "FROZEN CONTRACT §3 — " + JSON.stringify(SECTION3_DEFAULTS),
    },
    escalationArm: {
      foldSubscribed: true,
      predicate: { source: "channel", states: { [ARM_MEMBER_ID]: "OUTSTANDING" } },
      kinds: ["warn", "warn", "warn", "warn", "warn", "escalate", ""],
      holdFileExists: true,
      hold: { teamId: ARM_TEAM },
      stats: { holdsApplied: 1 },
      sceneFiles: ["20260917T000000Z-warn.json", "latest.json"],
    },
    warnOnlyArm: { kinds: ["warn", "warn", "warn", "warn", "warn", "escalate"], holdFileExists: false, stats: { holdsApplied: 0 } },
    reportOnlyArm: { kinds: ["warn"], warnCauses: ["silence-heartbeat"], holdFileExists: false, stats: { holdsApplied: 0 } },
    sceneLeg: {
      readWith: "plain fs + JSON.parse (no plugin reader) — the fresh-process shape",
      latestReason: "escalate",
      holdMatch: true,
      holdFileExists: true,
      incidentKinds: ["warn", "warn", "escalate"],
      escalatedIncident: { kind: "escalate", hold: "applied" },
    },
  }
  selfTest(SLUG, evaluate, healthy, [
    ["non-stale-case-failed", (copy) => { copy.cases.find((entry) => entry.case === "member-stops-stepping").ok = false }, "a fixture case that is NOT declared stale failing"],
    ["stale-case-passes", (copy) => { copy.cases.find((entry) => entry.case === "escalate-3x").ok = true }, "a declared-stale case that now PASSES (the declaration must be re-checked)"],
    ["stale-signature-lost", (copy) => { copy.cases.find((entry) => entry.case === "escalate-3x").observation.holdAppliedOnce = true }, "a stale case whose reading no longer matches its declared signature"],
    ["warn-boundary", (copy) => { copy.cases.find((entry) => entry.case === "warn-90s").observation.belowThreshold.decisions = 1 }, "a WARN below the 90 s threshold"],
    ["label-regressed", (copy) => { copy.labels.fixtureTupleLabel = "the FROZEN defaults" }, "the pre-redesign tuple re-advertised as the product's frozen defaults (t65/S2)"],
    ["product-defaults-wrong", (copy) => { copy.labels.productDefaults = { ...FIXTURE_INJECTED_TUPLE } }, "a lane that reports the injected tuple as the §3 product default"],
    ["no-escalation-arm", (copy) => { copy.escalationArm.kinds = ["warn", "warn"] }, "a §1 arm that never escalates (§1.2 of the contract)"],
    ["arm-not-fold", (copy) => { copy.escalationArm.predicate.source = "heartbeat" }, "a §1 arm whose suppression came from the §4 fallback instead of the fold"],
    ["arm-no-hold", (copy) => { copy.escalationArm.holdFileExists = false }, "a §1 escalation that applied no hold (no scene leg either)"],
    ["warn-only-holds", (copy) => { copy.warnOnlyArm.holdFileExists = true }, "a hold applied while `actionOnEscalate` is warn-only"],
    ["report-only-escalates", (copy) => { copy.reportOnlyArm.kinds = ["warn", "escalate"] }, "a §4 report-only arm that escalates"],
    ["report-only-warns-twice", (copy) => { copy.reportOnlyArm.kinds = ["warn", "warn"] }, "a §4 report-only arm warning more than once per task+attempt generation"],
    ["report-only-holds", (copy) => { copy.reportOnlyArm.stats.holdsApplied = 1 }, "a §4 report-only arm that held a team"],
    ["report-only-cause", (copy) => { copy.reportOnlyArm.warnCauses = ["silence-channel"] }, "a §4 warn not attributed to the heartbeat fallback"],
    ["scene-hold-mismatch", (copy) => { copy.sceneLeg.holdMatch = false }, "a scene pointer whose hold disagrees with the sidecar"],
    ["scene-not-escalate", (copy) => { copy.sceneLeg.latestReason = "warn" }, "a scene pointer that does not come from the escalation"],
    ["not-preserving", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves").observation.sha256UnchangedAcrossHeldKicks = false }, "a pause that mutated the team record"],
    ["deliveries", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves").observation.deliveriesWhileHeld = 1 }, "a dispatch that reached a held team"],
    ["no-contrast", (copy) => { copy.cases.find((entry) => entry.case === "pause-preserves-halt-control").observation.wouldReddenAC17 = false }, "a halt control that no longer shows AC-17 going red"],
    ["captain-missed", (copy) => { copy.cases.find((entry) => entry.case === "captain-wedge").observation.captainFlagged = false }, "a captain wedge that was not attributed"],
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
