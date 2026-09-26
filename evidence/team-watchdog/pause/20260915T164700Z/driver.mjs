// t62 (w7) evidence driver — THE PRESERVING PAUSE with the SERVICE-PRIMARY gate read.
//
// Supersedes the gate-read path in ../20260915T163526Z/ (which read the durable file
// from inside each gate). The gates now consult the watchdog's own `mpdWatchdog`
// service, which is the captain's binding instruction, and the file stays the durable
// record the SERVICE falls back to.
//
// Standalone and re-runnable: `bun driver.mjs` builds a fresh sandbox under `raw/ws`,
// drives the REAL adopted scheduler/plugin and the REAL watchdog dist through stub
// harness contexts, runs a real-cordis resolution experiment, and prints a JSON verdict.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const TEAMS_LIB = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
const CORDIS = join(REPO, "packages", "mpd-agent-teams-plugin", "_deps", "cordis", "lib", "index.js")
const WATCHDOG_DIST = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")
for (const required of [join(TEAMS_LIB, "scheduler.js"), join(TEAMS_LIB, "index.js"), CORDIS, WATCHDOG_DIST]) {
  if (!existsSync(required)) {
    console.error("FATAL: missing " + required + " — repo-root resolution or a missing dist/")
    process.exit(2)
  }
}

const { installTeamScheduler } = await import(join(TEAMS_LIB, "scheduler.js"))
const { apply: applyTeams } = await import(join(TEAMS_LIB, "index.js"))
const { apply: applyWatchdog } = await import(WATCHDOG_DIST)
const { Context } = await import(CORDIS)

const WS = join(HERE, "raw", "ws")
const STATE_DIR = join(".mpd", "team")
const TEAM = "pause-probe"
const CAPTAIN_ID = "session-captain-pause"
const MEMBER_ID = "child-architect-pause"
const STATE_ROOT = join(WS, STATE_DIR)
const TEAM_FILE = join(STATE_ROOT, TEAM, "team.json")
const HOLD_FILE = join(STATE_ROOT, "watchdog", "hold", TEAM + ".json")
const WATCHDOG_HELD = "held by the team watchdog"

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const watchdogLines = (warnings) => warnings.filter((line) => line.includes(WATCHDOG_HELD))

// ── fixture ─────────────────────────────────────────────────────────────────
function member(name, id, status = "idle") {
  return { name, id, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: Date.now(), status }
}
function task(id, subject, assignee, overrides = {}) {
  const now = Date.now()
  return { id, subject, assignee, dependencies: [], status: "pending", attempt: 0, createdAt: now, updatedAt: now, ...overrides }
}
function writeTeamRecord(tasks) {
  mkdirSync(join(STATE_ROOT, TEAM, "inbox"), { recursive: true })
  writeFileSync(
    TEAM_FILE,
    JSON.stringify(
      {
        id: TEAM,
        name: "Pause probe",
        description: "w7 preserving-pause fixture",
        captainSessionId: CAPTAIN_ID,
        createdAt: Date.now(),
        approvedAt: Date.now(),
        phase: "running",
        taskSeq: tasks.length,
        members: [member("Architect", MEMBER_ID)],
        tasks,
      },
      null,
      2,
    ) + "\n",
  )
}
function readTask() {
  return JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks.find((entry) => entry.id === "t1")
}
function writeHoldFile(shape) {
  mkdirSync(dirname(HOLD_FILE), { recursive: true })
  writeFileSync(HOLD_FILE, JSON.stringify(shape, null, 2) + "\n")
}
/** The singleton hold record w3 writes. */
function durableHold(id, taskId, attemptId) {
  return { id, teamId: TEAM, since: Date.now(), cause: "silence", taskId: taskId ?? null, attemptId: attemptId ?? null, sceneAt: Date.now() }
}

/**
 * The minimum ctx the scheduler and BOTH plugins touch, plus collectors.
 *
 * `get(name, strict)` mirrors cordis's inject-free lookup (the real-kernel experiment
 * at the end of this driver proves those semantics); `provide` is what the watchdog
 * row uses to publish `mpdWatchdog`.
 */
function makeHarness() {
  const deliveries = []
  const warnings = []
  const infos = []
  const handlers = new Map()
  const tools = new Map()
  const services = new Map()
  const listeners = []
  const live = new Map()
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: WS } } }
  const liveMember = { id: MEMBER_ID, status: "idle", session: { header: { cwd: WS } } }
  live.set(CAPTAIN_ID, captain)
  live.set(MEMBER_ID, liveMember)
  const ctx = {
    get: (id, _strict) => services.get(id),
    provide: (id, value) => {
      services.set(id, value)
    },
    agents: { get: (id) => live.get(id), list: () => [] },
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(" ")),
      info: (...args) => infos.push(args.map(String).join(" ")),
      error: () => {},
      debug: () => {},
    },
    on: (name, handler, options) => {
      handlers.set(name, handler)
      listeners.push({ name, handler, options })
      return () => handlers.delete(name)
    },
    tools: {
      register: (definition) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
      get: (name) => tools.get(name),
      has: (name) => tools.has(name),
    },
    subagents: {
      prompt: async (request) => {
        deliveries.push({ childId: request.childSessionId, text: (request.content ?? []).map((block) => block.text).join("") })
        return { messageId: `message-${deliveries.length}` }
      },
    },
    llm: { resolveCallConfig: async (request) => request, listModels: async () => [] },
    systemPrompt: { section: () => {} },
    effect: () => {},
    inject: () => () => {},
  }
  const call = async (toolName, args, exec) => {
    const tool = tools.get(toolName)
    if (tool === undefined) return { ok: false, error: "tool " + toolName + " is not registered" }
    try {
      return { ok: true, value: await tool.execute(args, exec) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ctx, captain, liveMember, deliveries, warnings, infos, tools, services, listeners, call }
}
const memberExec = () => ({ agent: { id: MEMBER_ID, session: { header: { cwd: WS } } } })
const kick = async (rt, { member = false } = {}) => {
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  // The member gate is a SEPARATE entry point (the idle edge drives it directly), so it
  // is exercised explicitly wherever the team is held.
  if (member) await scheduler.kickMember(WS, TEAM, "Architect", rt.captain)
}
/** Mount the watchdog row (publishes `mpdWatchdog`) and the teams row on one ctx. */
function mountBoth(rt, watchdogOverrides = {}) {
  const teams = applyTeams(rt.ctx, { stateDir: STATE_DIR, sessionTeamPolicy: { mode: "off" } })
  const watchdog = applyWatchdog(rt.ctx, { stateDir: STATE_DIR, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000, ...watchdogOverrides })
  return { teams, watchdog }
}

rmSync(WS, { recursive: true, force: true })
mkdirSync(STATE_ROOT, { recursive: true })
rmSync(HOLD_FILE, { force: true })
const result = { task: "t62", revision: null, gateRead: "ctx.get('mpdWatchdog', false)?.isHeld(teamId, workspace)?.held === true", fixture: { workspace: WS, stateDir: STATE_DIR, team: TEAM } }

// ═══ A/B: control and "service present but nothing held" ════════════════════
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  const rt = makeHarness()
  await kick(rt)
  check("A control: no watchdog row, no hold => the member IS dispatched", rt.deliveries.length === 1, { deliveries: rt.deliveries.length })
}
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  const rt = makeHarness()
  const mounted = mountBoth(rt)
  check("B0 the watchdog row publishes mpdWatchdog", rt.services.has("mpdWatchdog") && mounted.watchdog.holdService === "mpdWatchdog", { holdService: mounted.watchdog.holdService })
  await kick(rt)
  check("B service present, not held => dispatch proceeds", rt.deliveries.length === 1, { deliveries: rt.deliveries.length })
}

// ═══ C: held through the SERVICE => decline ═════════════════════════════════
writeTeamRecord([task("t1", "member-owned work", "Architect"), task("t2", "pooled work", undefined)])
{
  const rt = makeHarness()
  mountBoth(rt)
  const held = await rt.call("session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-1", cause: "silence" }, memberExec())
  check("C1 the service reports the hold it was given", rt.services.get("mpdWatchdog").isHeld(TEAM, WS).held === true, rt.services.get("mpdWatchdog").isHeld(TEAM, WS))
  const before = sha(TEAM_FILE)
  await kick(rt, { member: true })
  const lines = watchdogLines(rt.warnings)
  check("C2 held => NOTHING is dispatched", rt.deliveries.length === 0, { deliveries: rt.deliveries.length })
  check("C3 the decline is a named watchdog line from BOTH the team gate and the member gate", lines.length >= 2 && lines.every((line) => line.includes("held by the team watchdog")), { count: lines.length, lines: lines.slice(0, 2) })
  check("C4 the decline names the hold id the service returned", lines[0]?.includes(held.value?.hold?.id ?? "@@") === true, { holdId: held.value?.hold?.id, first: lines[0] })
  check("C5 the record is byte-identical after the decline", before === sha(TEAM_FILE))
  check("C6 the pooled task is left in the pool", readFileSync(TEAM_FILE, "utf8").includes('"status": "pending"'))
  // The THIRD gate sits INSIDE the team lock and re-asks after the lock is acquired, so a
  // hold that lands while a kick waits still wins. Drive it deterministically: the service
  // answers "not held" to the member gate and "held" to every later question.
  const realService = rt.services.get("mpdWatchdog")
  let asked = 0
  rt.services.set("mpdWatchdog", {
    isHeld: (teamId, workspace) => {
      asked += 1
      return asked === 1 ? { held: false } : realService.isHeld(teamId, workspace)
    },
  })
  const rtLocked = makeHarness()
  mountBoth(rtLocked)
  const realLocked = rtLocked.services.get("mpdWatchdog")
  let lockedAsked = 0
  rtLocked.services.set("mpdWatchdog", {
    isHeld: (teamId, workspace) => {
      lockedAsked += 1
      if (lockedAsked === 1) return { held: false }
      const view = realLocked.isHeld(teamId, workspace)
      // A distinct hold id keeps this refusal's reason string distinct from the one
      // section C already logged (noteDispatchDecline dedupes per team/member/reason).
      return { ...view, holdId: "hold-locked" }
    },
  })
  const schedulerLocked = installTeamScheduler(rtLocked.ctx, { stateDir: STATE_DIR })
  await schedulerLocked.kickMember(WS, TEAM, "Architect", rtLocked.captain)
  check(
    "C7 the IN-LOCK gate refuses a hold that lands while the kick waits",
    rtLocked.deliveries.length === 0 && lockedAsked >= 2 && watchdogLines(rtLocked.warnings).length >= 1 && (watchdogLines(rtLocked.warnings)[0] ?? "").includes("hold-locked"),
    { asked: lockedAsked, deliveries: rtLocked.deliveries.length, line: watchdogLines(rtLocked.warnings)[0] },
  )
  result.lockedGate = { serviceAsked: lockedAsked, deliveries: rtLocked.deliveries.length, line: watchdogLines(rtLocked.warnings)[0] ?? null }
  result.gateLines = lines.slice(0, 3)
  result.serviceView = rt.services.get("mpdWatchdog").isHeld(TEAM, WS)
}

// ═══ D: a hold file written by ANOTHER process, seen through the service ════
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  rmSync(HOLD_FILE, { force: true })
  const rt = makeHarness()
  mountBoth(rt)
  // The row hydrated at apply with no hold present; another process now writes one.
  writeHoldFile(durableHold("hold-foreign", "t1", "att-1"))
  const first = rt.services.get("mpdWatchdog").isHeld(TEAM, WS)
  const second = rt.services.get("mpdWatchdog").isHeld(TEAM, WS)
  await kick(rt)
  check("D1 the SERVICE answers a foreign hold with source:'file' on the first read", first.held === true && first.source === "file", first)
  check("D2 the same read is then served from memory (cross-process caveat)", second.source === "memory", second)
  await kick(rt, { member: true })
  check("D3 the gate declines on the foreign hold too", rt.deliveries.length === 0 && watchdogLines(rt.warnings).length >= 2, { deliveries: rt.deliveries.length })
  result.crossProcess = { first: first.source, second: second.source, holdId: first.holdId }
}

// ═══ E: FAIL-OPEN — the service is ABSENT and a hold-looking file is present ═
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  writeHoldFile(durableHold("hold-invisible", "t1", "att-1"))
  const rt = makeHarness()
  check("E0 no watchdog row => no mpdWatchdog service", rt.ctx.get("mpdWatchdog", false) === undefined)
  await kick(rt)
  check(
    "E1 FAIL-OPEN: with the service absent a hold-looking FILE alone changes nothing",
    rt.deliveries.length === 1 && watchdogLines(rt.warnings).length === 0,
    { deliveries: rt.deliveries.length, watchdogLines: watchdogLines(rt.warnings).length },
  )
  rmSync(HOLD_FILE, { force: true })
}

// ═══ F: preservation while the service holds the team ═══════════════════════
writeTeamRecord([
  task("t1", "in-flight work", "Architect", { status: "in_progress", attempt: 3, attemptId: "att-live", output: "partial result", handoffId: "handoff-1" }),
])
{
  const rt = makeHarness()
  mountBoth(rt)
  await rt.call("session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-live" }, memberExec())
  const before = sha(TEAM_FILE)
  const snapshot = readTask()
  await kick(rt, { member: true })
  const after = readTask()
  check("F1 the adopted record's bytes are unchanged while held", before === sha(TEAM_FILE))
  check(
    "F2 status/attemptId/attempt/output/handoffId all survive the hold",
    after.status === "in_progress" && after.attemptId === "att-live" && after.attempt === 3 && after.output === "partial result" && after.handoffId === "handoff-1",
    { before: { status: snapshot.status, attemptId: snapshot.attemptId }, after: { status: after.status, attemptId: after.attemptId } },
  )
  check("F3 nothing was cancelled", !JSON.stringify(after).includes("cancelled"))
  result.preservation = { before: { status: snapshot.status, attemptId: snapshot.attemptId, attempt: snapshot.attempt }, after: { status: after.status, attemptId: after.attemptId, attempt: after.attempt } }
}

// ═══ G/H/I: the tool boundary, the resume and idempotence ══════════════════
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  const rt = makeHarness()
  mountBoth(rt)
  const exec = memberExec()
  check("G0 claim/update/hold/resume are all registered", ["agent_teams_claim_task", "agent_teams_update_task", "session-watchdog-hold", "session-watchdog-resume"].every((name) => rt.tools.has(name)))

  await rt.call("session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-1" }, exec)
  const beforeBytes = sha(TEAM_FILE)
  const claimHeld = await rt.call("agent_teams_claim_task", { task_id: "t1" }, exec)
  const updateHeld = await rt.call("agent_teams_update_task", { task_id: "t1", status: "in_progress", attempt_id: "att-1" }, exec)
  check("G1 claim_task is refused with a named watchdog reason", claimHeld.ok === false && claimHeld.error.includes(WATCHDOG_HELD) && claimHeld.error.includes("session-watchdog-resume"), { error: claimHeld.error })
  check("G2 update_task is refused with a named watchdog reason", updateHeld.ok === false && updateHeld.error.includes(WATCHDOG_HELD), { error: updateHeld.error })
  check("G3 the refusals changed NO record byte", beforeBytes === sha(TEAM_FILE))

  const holdBytes = readFileSync(HOLD_FILE, "utf8")
  const holdMtime = statSync(HOLD_FILE).mtimeMs
  const recordBeforeSecond = sha(TEAM_FILE)
  const again = await rt.call("session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-1" }, exec)
  check(
    "I1 a second hold writes no second hold and interrupts nothing",
    readFileSync(HOLD_FILE, "utf8") === holdBytes && statSync(HOLD_FILE).mtimeMs === holdMtime && recordBeforeSecond === sha(TEAM_FILE),
    { changed: again.value?.changed ?? null },
  )

  const resume = await rt.call("session-watchdog-resume", { team_id: TEAM }, exec)
  check("H1 session-watchdog-resume clears the hold", Boolean(resume.value?.resumed) && !existsSync(HOLD_FILE), resume.value ?? resume.error)
  check("H2 the service agrees the team is free", rt.services.get("mpdWatchdog").isHeld(TEAM, WS).held === false)
  await kick(rt)
  check("H3 dispatch resumes through the existing kick machinery", rt.deliveries.length === 1, { deliveries: rt.deliveries.length })
  const afterResume = readTask()
  check("H4 the resumed task carries a live attempt of its own", typeof afterResume.attemptId === "string" && afterResume.attemptId.length > 0, { attemptId: afterResume.attemptId, status: afterResume.status })
  const claimAfter = await rt.call("agent_teams_claim_task", { task_id: "t1" }, exec)
  check("G4 after the resume the boundary no longer reports the hold", claimAfter.ok === false ? !claimAfter.error.includes(WATCHDOG_HELD) : true, { error: claimAfter.error ?? "(allowed)" })
  const resumeAgain = await rt.call("session-watchdog-resume", { team_id: TEAM }, exec)
  check("I2 a resume for a non-held team is a {resumed:false, reason:'not-held'} no-op", resumeAgain.ok === true && resumeAgain.value?.resumed === false && resumeAgain.value?.reason === "not-held", resumeAgain.value)

  // H5 the still-claimed case: frozen while held, re-armed by the resume.
  writeTeamRecord([task("t1", "still-claimed work", "Architect", { status: "in_progress", attempt: 2, attemptId: "att-live-2", output: "kept" })])
  await rt.call("session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-live-2" }, exec)
  const rtHeld = makeHarness()
  const heldMount = mountBoth(rtHeld)
  await rtHeld.call("session-watchdog-hold", { team_id: TEAM, task_id: "t1", attempt_id: "att-live-2" }, memberExec())
  await kick(rtHeld)
  const whileHeld = readTask()
  await rtHeld.call("session-watchdog-resume", { team_id: TEAM }, memberExec())
  await kick(rtHeld)
  const afterReArm = readTask()
  check(
    "H5 a still-claimed attempt is frozen while held and RE-ARMED by the resume",
    rtHeld.deliveries.length === 1
      && whileHeld.status === "in_progress"
      && whileHeld.attemptId === "att-live-2"
      && whileHeld.attempt === 2
      && whileHeld.output === "kept"
      && afterReArm.attempt === 3
      && afterReArm.attemptId !== "att-live-2",
    { whileHeld: { status: whileHeld.status, attemptId: whileHeld.attemptId, attempt: whileHeld.attempt, output: whileHeld.output }, afterReArm: { status: afterReArm.status, attemptId: afterReArm.attemptId, attempt: afterReArm.attempt } },
  )
  result.reArm = { whileHeld: { status: whileHeld.status, attemptId: whileHeld.attemptId, attempt: whileHeld.attempt, output: whileHeld.output }, afterResume: { status: afterReArm.status, attemptId: afterReArm.attemptId, attempt: afterReArm.attempt } }
  result.toolRefusals = { claim: claimHeld.error ?? null, update: updateHeld.error ?? null }
  result.idempotence = { secondHoldChanged: again.value?.changed ?? null, secondResume: resumeAgain.value ?? null }
  void heldMount
}

// ═══ J: a THROWING reader is swallowed (never stops a team) ═════════════════
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  const rt = makeHarness()
  mountBoth(rt)
  rt.services.set("mpdWatchdog", {
    isHeld: () => {
      throw new Error("reader exploded")
    },
  })
  await kick(rt)
  check("J1 a THROWING service reader is swallowed and dispatch proceeds", rt.deliveries.length === 1, { deliveries: rt.deliveries.length })
}

// ═══ K: REAL cordis resolution (the semantics the gates rely on) ════════════
{
  const resolution = { providerSawConsumer: null, consumerGotService: null, absentService: null, threw: null }
  try {
    const root = new Context()
    let consumerView = null
    let absent = "unset"
    root.plugin({
      name: "watchdog-like-row",
      apply(ctx) {
        ctx.provide("mpdWatchdog", { isHeld: (teamId) => ({ held: teamId === "held-team", holdId: "h-real", at: 1, reason: "silence", source: "memory" }) })
      },
    })
    root.plugin({
      name: "adopted-like-row",
      apply(ctx) {
        consumerView = ctx.get("mpdWatchdog", false)
        absent = ctx.get("no-such-service", false)
      },
    })
    for (let tick = 0; tick < 50 && consumerView === null; tick += 1) await new Promise((resolve) => setTimeout(resolve, 2))
    resolution.consumerGotService = consumerView !== undefined && consumerView !== null
    resolution.crossRowHeld = consumerView?.isHeld("held-team")?.held === true
    resolution.crossRowNotHeld = consumerView?.isHeld("other-team")?.held === false
    resolution.absentService = absent === undefined ? "undefined (fail-open)" : String(absent)
  } catch (error) {
    resolution.threw = error instanceof Error ? error.message : String(error)
  }
  check(
    "K1 REAL cordis: a sibling row resolves the service with NO inject declaration",
    resolution.consumerGotService === true && resolution.crossRowHeld === true && resolution.crossRowNotHeld === true,
    resolution,
  )
  check("K2 REAL cordis: an absent service reads as undefined, not a throw", resolution.absentService === "undefined (fail-open)", resolution)
  result.cordisResolution = resolution
}

result.checks = checks
result.ok = checks.every((entry) => entry.ok)
writeFileSync(join(HERE, "raw", "driver.result.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
