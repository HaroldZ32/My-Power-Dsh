// t62 (w7) evidence driver — the PRESERVING PAUSE, exercised against the REAL
// adopted code (lib/scheduler.js + lib/index.js, i.e. the registry-healed files).
//
// It is standalone and re-runnable: `bun driver.mjs` from this directory builds a
// fresh sandbox under `raw/ws`, drives both plugins through stub harness contexts,
// and prints a JSON verdict. Nothing here is a lane (skills/** is w9's) and nothing
// here imports the watchdog's SOURCE: the watchdog is mounted through its built
// dist, exactly as a host would.
//
// Coverage, one section per acceptance criterion:
//   A. the dispatch gates       (held team left alone + a named decline line)
//   B. preservation             (claimed/running attempt survives byte-for-byte)
//   C. the durable contract     (both documented spellings; fail-open on absence/garbage)
//   D. resume                   (clears + re-arms through the existing machinery)
//   E. the tool boundary        (claim_task/update_task refused loudly, records untouched)
//   F. idempotence              (no second hold; resume of a non-held team is a no-op)
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const TEAMS_LIB = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
const WATCHDOG_DIST = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")
for (const required of [join(TEAMS_LIB, "scheduler.js"), join(TEAMS_LIB, "index.js"), WATCHDOG_DIST]) {
  if (!existsSync(required)) {
    console.error("FATAL: missing " + required + " — repo-root resolution or a missing dist/")
    process.exit(2)
  }
}

const { installTeamScheduler } = await import(join(TEAMS_LIB, "scheduler.js"))
const { apply: applyTeams } = await import(join(TEAMS_LIB, "index.js"))
const { apply: applyWatchdog } = await import(WATCHDOG_DIST)

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
const check = (id, ok, detail) => {
  checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const warnLines = (warnings) => warnings.filter((line) => line.includes(WATCHDOG_HELD))

// ── fixture ─────────────────────────────────────────────────────────────────
function member(name, id, status = "idle") {
  return { name, id, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: Date.now(), status }
}
function task(id, subject, assignee, overrides = {}) {
  const now = Date.now()
  return { id, subject, assignee, dependencies: [], status: "pending", attempt: 0, createdAt: now, updatedAt: now, ...overrides }
}
function writeTeamRecord(tasks, phase = "running") {
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
        phase,
        taskSeq: tasks.length,
        members: [member("Architect", MEMBER_ID)],
        tasks,
      },
      null,
      2,
    ) + "\n",
  )
}
/** The minimum ctx the scheduler touches, plus delivery/warning collectors. */
function makeRuntime() {
  const deliveries = []
  const warnings = []
  const infos = []
  const handlers = new Map()
  const live = new Map()
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: WS } } }
  const liveMember = { id: MEMBER_ID, status: "idle", session: { header: { cwd: WS } } }
  live.set(CAPTAIN_ID, captain)
  live.set(MEMBER_ID, liveMember)
  const ctx = {
    agents: { get: (id) => live.get(id), list: () => [...live.values()] },
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(" ")),
      info: (...args) => infos.push(args.map(String).join(" ")),
      error: () => {},
      debug: () => {},
    },
    on: (name, cb) => {
      handlers.set(name, cb)
      return () => handlers.delete(name)
    },
    subagents: {
      prompt: async (request) => {
        deliveries.push({ childId: request.childSessionId, text: (request.content ?? []).map((block) => block.text).join("") })
        return { messageId: `message-${deliveries.length}` }
      },
    },
  }
  return { ctx, captain, liveMember, deliveries, warnings, infos, handlers }
}
/** The ctx `apply()` needs (tools.register is the collector that matters here). */
function makeApplyHarness() {
  const runtime = makeRuntime()
  const tools = new Map()
  const listeners = []
  const services = new Map()
  runtime.ctx.tools = {
    register: (definition) => {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
    get: (name) => tools.get(name),
    has: (name) => tools.has(name),
  }
  runtime.ctx.llm = { resolveCallConfig: async (request) => request, listModels: async () => [] }
  runtime.ctx.systemPrompt = { section: () => {} }
  runtime.ctx.effect = () => {}
  runtime.ctx.get = (id) => services.get(id)
  runtime.ctx.inject = () => () => {}
  runtime.ctx.provide = (id, value) => { services.set(id, value) }
  // `capabilities.js` attaches to every LIVE agent at apply; these stub agents carry no
  // session log, so the live LIST stays empty (the tools resolve their team from the
  // durable record via findTeamByParticipant, not from the live registry).
  runtime.ctx.agents = { get: (id) => runtime.live.get(id), list: () => [] }
  // The watchdog row resolves its adapter from `ctx.get("mpdDsh", false)`; without one it
  // builds its own over this ctx, and that is what we want here (no harness at all).
  runtime.ctx.on = (name, cb, options) => {
    listeners.push({ name, handler: cb })
    return () => {}
  }
  return { ...runtime, tools, listeners, services }
}

function writeHold(shape) {
  mkdirSync(dirname(HOLD_FILE), { recursive: true })
  writeFileSync(HOLD_FILE, JSON.stringify(shape, null, 2) + "\n")
}

rmSync(WS, { recursive: true, force: true })
mkdirSync(STATE_ROOT, { recursive: true })
const result = { task: "t62", fixture: { workspace: WS, stateDir: STATE_DIR, team: TEAM } }

// ═══ A: the dispatch gates ══════════════════════════════════════════════════
// A1 CONTROL: with no hold, the same fixture DOES dispatch (else A2 proves nothing).
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  check("A1 control: without a hold the member IS dispatched", rt.deliveries.length === 1, { deliveries: rt.deliveries.length })
}

// A2 HELD: the same kick delivers nothing, and says why by name.
{
  writeHold({ id: "hold-a2", teamId: TEAM, since: Date.now(), cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: Date.now() })
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  const before = sha(TEAM_FILE)
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  await scheduler.kickMember(WS, TEAM, "Architect", rt.captain)
  const named = warnLines(rt.warnings)
  check("A2 held: nothing is dispatched while the hold is present", rt.deliveries.length === 0, { deliveries: rt.deliveries.length })
  check("A2 held: the decline is a NAMED watchdog line", named.length >= 2, { lines: named.slice(0, 2) })
  check("A2 held: the decline names the hold id and reason", named[0]?.includes("hold-a2") === true && named[0]?.includes("silence") === true, { first: named[0] })
  check("A2 held: the team record is byte-identical after the decline", before === sha(TEAM_FILE))
  result.gateLines = named.slice(0, 3)
}

// A3 POOLED: a pooled (unassigned) ready task is left in the pool too.
{
  writeTeamRecord([task("t1", "member-owned work", "Architect"), task("t2", "pooled work", undefined)])
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  const before = sha(TEAM_FILE)
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  const record = JSON.parse(readFileSync(TEAM_FILE, "utf8"))
  check("A3 held: the pooled task is untouched too", rt.deliveries.length === 0 && before === sha(TEAM_FILE))
  check("A3 held: both tasks still pending", record.tasks.every((entry) => entry.status === "pending"), record.tasks.map((entry) => entry.status))
}

// ═══ B: preservation (AC-17's substance) ════════════════════════════════════
{
  writeTeamRecord([
    task("t1", "in-flight work", "Architect", { status: "in_progress", attempt: 3, attemptId: "att-live", output: "partial result", handoffId: "handoff-1" }),
  ])
  const before = sha(TEAM_FILE)
  const snapshot = JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks[0]
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  const after = JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks[0]
  check("B preservation: the adopted record's bytes are unchanged by the hold", before === sha(TEAM_FILE))
  check(
    "B preservation: status/attemptId/attempt/output/handoffId all survive",
    after.status === "in_progress" && after.attemptId === "att-live" && after.attempt === 3 && after.output === "partial result" && after.handoffId === "handoff-1",
    { before: { status: snapshot.status, attemptId: snapshot.attemptId }, after: { status: after.status, attemptId: after.attemptId } },
  )
  check("B preservation: no task was cancelled", !JSON.stringify(after).includes("cancelled"))
  result.preservation = { before: { status: snapshot.status, attemptId: snapshot.attemptId, attempt: snapshot.attempt }, after: { status: after.status, attemptId: after.attemptId, attempt: after.attempt } }
}

// ═══ C: the durable contract + fail-open ════════════════════════════════════
// C1 the READER-VIEW spelling is honoured as well as w3's durable spelling.
{
  writeTeamRecord([task("t1", "member-owned work", "Architect")])
  writeHold({ teamId: TEAM, holdId: "hold-view-spelling", at: Date.now(), reason: "silence", actor: "team-watchdog", source: "sidecar" })
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  const named = warnLines(rt.warnings)
  check("C1 contract: the {holdId,at,reason} spelling also enforces", rt.deliveries.length === 0 && named[0]?.includes("hold-view-spelling") === true, { first: named[0] })
}
// C2 FAIL-OPEN: a corrupt hold file is NOT a hold.
{
  rmSync(HOLD_FILE, { force: true })
  mkdirSync(dirname(HOLD_FILE), { recursive: true })
  writeFileSync(HOLD_FILE, "{ this is not json")
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  check("C2 fail-open: a corrupt hold file does NOT block dispatch", rt.deliveries.length === 1, { deliveries: rt.deliveries.length })
}
// C3 FAIL-OPEN: no file at all (the absent-watchdog shape).
{
  rmSync(HOLD_FILE, { force: true })
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt.captain)
  check("C3 fail-open: no hold file => dispatch behaves exactly as before", rt.deliveries.length === 1 && warnLines(rt.warnings).length === 0)
}
// C4 the cache honours a CHANGED hold (mtime-keyed, not sticky).
{
  writeHold({ id: "hold-c4", teamId: TEAM, since: Date.now(), cause: "silence", taskId: null, attemptId: null, sceneAt: 0 })
  const rt = makeRuntime()
  const scheduler = installTeamScheduler(rt.ctx, { stateDir: STATE_DIR })
  await scheduler.kickMember(WS, TEAM, "Architect", rt.captain)
  const heldDeliveries = rt.deliveries.length
  rmSync(HOLD_FILE, { force: true })
  await scheduler.kickMember(WS, TEAM, "Architect", rt.captain)
  check("C4 cache: clearing the file is observed without a restart", heldDeliveries === 0 && rt.deliveries.length === 1, { heldDeliveries, afterClear: rt.deliveries.length })
}

// ═══ D+E+F: the watchdog's OWN actions and the tool boundary ════════════════
writeTeamRecord([task("t1", "member-owned work", "Architect")])
{
  const rt = makeApplyHarness()
  applyTeams(rt.ctx, { stateDir: STATE_DIR, sessionTeamPolicy: { mode: "off" } })
  const watchdogReport = applyWatchdog(rt.ctx, { stateDir: STATE_DIR, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
  const claim = rt.tools.get("agent_teams_claim_task")
  const update = rt.tools.get("agent_teams_update_task")
  const hold = rt.tools.get("session-watchdog-hold")
  const resume = rt.tools.get("session-watchdog-resume")
  check("E0 tools: claim/update/hold/resume are all registered", [claim, update, hold, resume].every((tool) => tool !== undefined), { registered: [...rt.tools.keys()].filter((n) => /claim_task|update_task|session-watchdog/.test(n)) })

  const memberExec = { agent: { id: MEMBER_ID, session: { header: { cwd: WS } } } }
  const call = async (tool, args) => {
    try {
      return { ok: true, value: await tool.execute(args, memberExec) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // D1 the watchdog's own hold action is what the gates read.
  const holdResult = await call(hold, { team_id: TEAM, task_id: "t1", attempt_id: "att-1", cause: "silence" })
  check("D1 the plugin's own session-watchdog-hold writes the durable hold", Boolean(holdResult.value?.applied) && existsSync(HOLD_FILE), holdResult.value ?? holdResult.error)

  // E1/E2 the tool boundary refuses BOTH tools, loudly and by name, and writes nothing.
  const beforeBytes = sha(TEAM_FILE)
  const claimHeld = await call(claim, { task_id: "t1" })
  const updateHeld = await call(update, { task_id: "t1", status: "in_progress", attempt_id: "att-1" })
  check("E1 claim_task is refused with a named watchdog reason", claimHeld.ok === false && claimHeld.error.includes(WATCHDOG_HELD) && claimHeld.error.includes("session-watchdog-resume"), { error: claimHeld.error })
  check("E2 update_task is refused with a named watchdog reason", updateHeld.ok === false && updateHeld.error.includes(WATCHDOG_HELD) && updateHeld.error.includes("session-watchdog-resume"), { error: updateHeld.error })
  check("E3 the refusals changed NO record byte", beforeBytes === sha(TEAM_FILE))

  // D2 the scheduler gate sees the SAME hold (one contract, two readers).
  const rt2 = makeRuntime()
  const scheduler = installTeamScheduler(rt2.ctx, { stateDir: STATE_DIR })
  await scheduler.kickTeam(WS, TEAM, rt2.captain)
  check("D2 the dispatch gate and the tool boundary read ONE hold", rt2.deliveries.length === 0 && warnLines(rt2.warnings).length >= 1)

  // D3 idempotence: a second hold writes NO second hold.
  const firstHoldBytes = readFileSync(HOLD_FILE, "utf8")
  const firstHoldStat = statSync(HOLD_FILE).mtimeMs
  const recordBeforeSecondHold = sha(TEAM_FILE)
  const holdAgain = await call(hold, { team_id: TEAM, task_id: "t1", attempt_id: "att-1", cause: "silence" })
  check(
    "F1 a second hold on an already-held team writes no second hold and interrupts nothing",
    readFileSync(HOLD_FILE, "utf8") === firstHoldBytes && statSync(HOLD_FILE).mtimeMs === firstHoldStat && recordBeforeSecondHold === sha(TEAM_FILE),
    { changed: holdAgain.value?.changed ?? null, holdId: holdAgain.value?.hold?.id ?? null },
  )

  // D4 resume: the hold clears, and the EXISTING machinery dispatches again.
  const resumeResult = await call(resume, { team_id: TEAM })
  check("D4 session-watchdog-resume clears the hold", Boolean(resumeResult.value?.resumed) && !existsSync(HOLD_FILE), resumeResult.value ?? resumeResult.error)
  const rt3 = makeRuntime()
  const scheduler3 = installTeamScheduler(rt3.ctx, { stateDir: STATE_DIR })
  await scheduler3.kickTeam(WS, TEAM, rt3.captain)
  check("D5 dispatch resumes through the existing kick machinery after the resume", rt3.deliveries.length === 1, { deliveries: rt3.deliveries.length })
  const resumedRecord = JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks[0]
  check("D6 the resumed delivery carries a live attempt of its own", typeof resumedRecord.attemptId === "string" && resumedRecord.attemptId.length > 0, { attemptId: resumedRecord.attemptId, status: resumedRecord.status })
  result.resume = { deliveriesAfterResume: rt3.deliveries.length, task: { status: resumedRecord.status, attempt: resumedRecord.attempt, attemptId: resumedRecord.attemptId } }

  // E4 after the resume the boundary opens again (the refusal was the hold, not the tool).
  const claimAfter = await call(claim, { task_id: "t1" })
  check("E4 after the resume the tool boundary no longer reports the hold", claimAfter.ok === false ? !claimAfter.error.includes(WATCHDOG_HELD) : true, { error: claimAfter.error ?? "(allowed)" })

  // F2 a resume for a non-held team is a no-op, not an error.
  const resumeAgain = await call(resume, { team_id: TEAM })
  check("F2 a resume for a non-held team is a {resumed:false, reason:'not-held'} no-op", resumeAgain.ok === true && resumeAgain.value?.resumed === false && resumeAgain.value?.reason === "not-held", resumeAgain.value)

  // D7 the case that matters most: a task that is CLAIMED (an in-flight attempt) when the
  // hold lands. Held => frozen; resumed => the EXISTING kick machinery re-arms it, minting
  // the next attempt generation of the same task (beginTaskAttempt) and PARKING it so a
  // failed re-delivery restores the previous generation instead of spending unbounded ones.
  writeTeamRecord([
    task("t1", "still-claimed work", "Architect", { status: "in_progress", attempt: 2, attemptId: "att-live-2", output: "kept" }),
  ])
  const claimedBefore = JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks[0]
  await call(hold, { team_id: TEAM, task_id: "t1", attempt_id: "att-live-2", cause: "silence" })
  const rtHeld = makeRuntime()
  const heldScheduler = installTeamScheduler(rtHeld.ctx, { stateDir: STATE_DIR })
  await heldScheduler.kickTeam(WS, TEAM, rtHeld.captain)
  const claimedWhileHeld = JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks[0]
  await call(resume, { team_id: TEAM })
  const rtResumed = makeRuntime()
  const resumedScheduler = installTeamScheduler(rtResumed.ctx, { stateDir: STATE_DIR })
  await resumedScheduler.kickTeam(WS, TEAM, rtResumed.captain)
  const claimedAfterResume = JSON.parse(readFileSync(TEAM_FILE, "utf8")).tasks[0]
  check(
    "D7 a still-claimed attempt is frozen while held and RE-ARMED by the resume",
    rtHeld.deliveries.length === 0
      && claimedWhileHeld.status === claimedBefore.status
      && claimedWhileHeld.attemptId === "att-live-2"
      && claimedWhileHeld.attempt === 2
      && claimedWhileHeld.output === "kept"
      && rtResumed.deliveries.length === 1
      && claimedAfterResume.attempt === 3
      && claimedAfterResume.attemptId !== "att-live-2",
    {
      whileHeld: { status: claimedWhileHeld.status, attemptId: claimedWhileHeld.attemptId, attempt: claimedWhileHeld.attempt, output: claimedWhileHeld.output },
      afterResume: { status: claimedAfterResume.status, attemptId: claimedAfterResume.attemptId, attempt: claimedAfterResume.attempt },
    },
  )
  result.reArm = {
    whileHeld: { status: claimedWhileHeld.status, attemptId: claimedWhileHeld.attemptId, attempt: claimedWhileHeld.attempt, output: claimedWhileHeld.output },
    afterResume: { status: claimedAfterResume.status, attemptId: claimedAfterResume.attemptId, attempt: claimedAfterResume.attempt, output: claimedAfterResume.output ?? null },
  }

  result.watchdog = { applied: watchdogReport.applied, holdService: watchdogReport.holdService, tools: [...rt.tools.keys()].length }
  result.toolRefusals = { claim: claimHeld.error ?? null, update: updateHeld.error ?? null }
  result.idempotence = { holdChanged: holdAgain.value?.changed ?? null, secondResume: resumeAgain.value ?? null }
}

result.checks = checks
result.ok = checks.every((entry) => entry.ok)
writeFileSync(join(HERE, "raw", "driver.result.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
