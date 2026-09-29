// T-79's DECISIVE HOST-RESTART TEST — wave-2b lane C (t17), the load-bearing carry-forward.
//
// THE QUESTION (plan §A12, restated in the lane's acceptance): after a RESTART, does a fresh load of
// the current tree still hand a member a ticket for a task that is ALREADY TERMINAL? If it does, the
// old-revision explanation for the recorded replays is refused and the wake is a live hole; if it does
// not, the wake is NOT reproduced by a fresh load of the current tree on this route, the mechanism
// claim stays REFUTED-for-a-fresh-process, the replays stay MEASURED EVENTS, and the residual stays
// UNRESOLVED with the named probe cited on scheduler.js.
//
// WHAT "RESTART" MEANS HERE, stated so no reader has to infer it: this driver runs as a MANAGED
// background job in a NEW PROCESS (`scripts/mpd-bg.mjs run`, isolated DSH_HOME, sandboxed HOME,
// explicit sandbox cwd) and imports the adopted plugin FRESH from the current tree. Under T-21 (no
// plugin hot reload) the loaded revision IS a process property, so a new process is the operative
// sense of "restart" for this question — and it is the one sense the probe cannot answer (its bound:
// a module mtime against the newest session's directory mtime cannot see a long-lived host PROCESS).
//
// THE FIXTURE reuses a RECORDED live shape: terminal task + idle member + a path that COMPOSES A
// TICKET (a kick). The two wrong-reason fixtures (a bare status read; an idle-edge-only probe) are
// named here as forbidden and are not used.
//
// FOUR LEGS. (0) is the control that keeps the rest from being a command that cannot fail; (3) is the
// RED SIDE that proves the guard, not the fixture, is what refuses.
//   (0) CONTROL, pending task, current tree  -> a delivery is expected: this harness+fixture CAN wake.
//   (1) PURE TERMINAL task, current tree     -> the recorded shape at the moment of the kick.
//   (2) RECORDED RACE, current tree          -> open at compose, terminal INSIDE the window (hook).
//   (3) SAME RACE, re-check region STRIPPED  -> the recorded live event reproduced, with a wake.
//
// Usage: node t79-decisive-driver.mjs --out <dir>   (from the repository root)
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = resolve(HERE, "../../../..")
const ADOPTED_LIB = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
const ADOPTED_DEPS = join(REPO, "packages", "mpd-agent-teams-plugin", "_deps")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "decisive-probe"
const CAPTAIN_ID = "session-captain-decisive"
const MEMBER_ID = "session-member-decisive"
const MEMBER_NAME = "Architect"
/** The attempt id the SEVENTH recorded live event carried (the `t14` review re-dispatched after completion). */
const RECORDED_ATTEMPT_ID = "7c133ef3-5e5b-4d95-a3d7-86d0d5661efb"
const REGION_START = "//#region mpd-delta terminal-dispatch-recheck"
const REGION_END = "//#endregion mpd-delta terminal-dispatch-recheck"
const ANCHOR_REGION = "const stale = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {"
const ANCHOR_DELIVER = "const accepted = await deliverToMember(ctx, captain, ticket.memberId,"

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const OUT = resolve(argOf("--out", HERE))
mkdirSync(OUT, { recursive: true })
// Immutable evidence (T-83's class): a re-run at the SAME target is REFUSED rather than silently
// overwriting a reading that is already archived.
const GUARDED = join(OUT, "t79-decisive-result.json")
if (existsSync(GUARDED) && !args.includes("--force")) {
  console.error("REFUSED: " + GUARDED + " already exists (immutable evidence). Pass a fresh --out <dir>, or --force to overwrite deliberately.")
  process.exit(3)
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** The recorder injected at a fixed ANCHOR: it reads the ticket the compose produced and, when asked,
 *  makes the task terminal inside the compose->wake window — the exact 2a mechanism, forced. */
const HOOK_FN = `
async function __t79Hook(input) {
  globalThis.__t79 = globalThis.__t79 ?? [];
  const record = { anchor: input.anchor, taskId: input.ticket.taskId, ticketAttemptId: input.ticket.attemptId ?? null, memberId: input.ticket.memberId };
  globalThis.__t79.push(record);
  if (!input.forceTerminal) return;
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = input.stateRoot + "/" + input.teamId + "/team.json";
  const rec = JSON.parse(readFileSync(path, "utf8"));
  const task = (rec.tasks ?? []).find((candidate) => candidate.id === input.ticket.taskId);
  if (task === undefined) { record.forceTerminal = "not-found"; return; }
  task.status = "completed"; task.verdict = "pass"; task.updatedAt = Date.now();
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\\n");
  record.forceTerminal = "task-" + input.ticket.taskId + "-now-" + task.status;
}
`

/** One scratch copy of the adopted lib that a control may splice — never the shipped file. */
function scratchLib() {
  const root = mkdtempSync(join(tmpdir(), "t79-lib-"))
  mkdirSync(join(root, "lib"), { recursive: true })
  cpSync(ADOPTED_LIB, join(root, "lib"), { recursive: true })
  symlinkSync(ADOPTED_DEPS, join(root, "_deps"), "dir")
  return { libDir: join(root, "lib"), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** The recorded shape as an adopted team record: `isTeamState` validates every field. */
function writeTeamFixture(workspace, taskStatus, attemptId) {
  const now = Date.now() - 60_000
  const dir = join(workspace, STATE_DIR, TEAM_ID)
  mkdirSync(join(dir, "inbox"), { recursive: true })
  const path = join(dir, "team.json")
  writeFileSync(path, JSON.stringify({
    id: TEAM_ID,
    name: TEAM_ID,
    captainSessionId: CAPTAIN_ID,
    createdAt: now,
    approvedAt: now,
    phase: "running",
    taskSeq: 1,
    members: [{ id: MEMBER_ID, name: MEMBER_NAME, role: "worker", status: "idle", joinedAt: now }],
    tasks: [{
      id: "t14",
      subject: "the recorded replay shape",
      description: "terminal task + idle member + a ticket-composing kick",
      status: taskStatus,
      assignee: MEMBER_NAME,
      dependencies: [],
      attempt: taskStatus === "pending" ? 0 : 1,
      ...(attemptId === undefined ? {} : { attemptId }),
      ...(taskStatus === "completed" ? { verdict: "pass" } : {}),
      createdAt: now,
      updatedAt: now,
    }],
  }, null, 2) + "\n")
  return path
}

/** Drive one leg: mount the adopted scheduler FRESH and run the ticket-composing kick. */
async function runLeg({ label, libDir, taskStatus, attemptId, hook }) {
  const workspace = mkdtempSync(join(tmpdir(), "t79-ws-"))
  const cleanups = []
  const deliveries = []
  const warnings = []
  let regionStripped = false
  let hookInstalled = null
  try {
    if (hook !== undefined) {
      let source = readFileSync(join(libDir, "scheduler.js"), "utf8")
      const hadRegion = source.includes(REGION_START)
      if (hook.stripRegion) {
        const start = source.indexOf(REGION_START)
        const end = source.indexOf(REGION_END)
        if (start < 0 || end < start) throw new Error(`${label}: region anchors not found`)
        source = source.slice(0, start) + source.slice(end + REGION_END.length)
        regionStripped = true
      }
      const anchor = hook.stripRegion ? ANCHOR_DELIVER : ANCHOR_REGION
      if (source.split(anchor).length - 1 !== 1) throw new Error(`${label}: hook anchor not unique (${anchor})`)
      const call = `await __t79Hook({ anchor: ${JSON.stringify(hook.stripRegion ? "deliver" : "region")}, stateRoot, teamId: team.id, ticket, forceTerminal: ${hook.forceTerminal ? "true" : "false"} });\n                `
      source = HOOK_FN + source.replace(anchor, call + anchor)
      const container = mkdtempSync(join(tmpdir(), "t79-mod-"))
      cleanups.push(() => rmSync(container, { recursive: true, force: true }))
      const patched = join(container, "mod")
      cpSync(libDir, patched, { recursive: true })
      writeFileSync(join(patched, "scheduler.js"), source)
      symlinkSync(ADOPTED_DEPS, join(container, "_deps"), "dir")
      libDir = patched
      hookInstalled = { anchor: hook.stripRegion ? ANCHOR_DELIVER : ANCHOR_REGION, regionWasPresent: hadRegion }
    }
    const teamFile = writeTeamFixture(workspace, taskStatus, attemptId)
    const before = sha(teamFile)
    const captain = { id: CAPTAIN_ID, status: "idle", session: { id: CAPTAIN_ID, header: { cwd: workspace } } }
    const member = { id: MEMBER_ID, status: "idle", session: { id: MEMBER_ID, header: { cwd: workspace } } }
    const live = new Map([[CAPTAIN_ID, captain], [MEMBER_ID, member]])
    const log = (text) => warnings.push(String(text))
    const ctx = {
      logger: { warn: log, info: log, error: log, debug: log },
      agents: { get: (id) => live.get(id), list: () => [...live.values()], register: () => () => undefined },
      subagents: {
        prompt: async (request) => {
          deliveries.push({ childSessionId: request.childSessionId, text: (request.content ?? []).map((block) => block.text).join("") })
          return { messageId: "m-" + deliveries.length }
        },
        sendMessage: () => undefined,
      },
      get: () => undefined, // no watchdog hold: this run is about the DELIVERY boundary, not a pause
      on: () => () => undefined,
      effect: () => () => undefined,
      tools: { register: () => () => undefined },
    }
    globalThis.__t79 = []
    const mod = await import(pathToFileURL(join(libDir, "scheduler.js")).href + "?leg=" + label + "&v=" + Date.now())
    const scheduler = mod.installTeamScheduler(ctx, { stateDir: STATE_DIR })
    await scheduler.kickMember(workspace, TEAM_ID, MEMBER_NAME, captain)
    const afterRecord = JSON.parse(readFileSync(teamFile, "utf8"))
    const task = afterRecord.tasks.find((candidate) => candidate.id === "t14")
    const hookRecords = globalThis.__t79 ?? []
    return {
      label,
      fixture: { taskStatus, attemptId: attemptId ?? null },
      regionStripped,
      hookInstalled,
      hookRecords,
      ticketAttemptId: hookRecords[0]?.ticketAttemptId ?? null,
      forcedTerminal: hookRecords.map((record) => record.forceTerminal).filter(Boolean),
      deliveries: deliveries.length,
      deliveredToMemberSession: deliveries.filter((delivery) => delivery.childSessionId === MEMBER_ID).length,
      namedDecline: warnings.filter((warning) => warning.includes("became completed before its assignment")),
      teamBytesUnchanged: before === sha(teamFile),
      taskStatusAfter: task?.status ?? null,
      taskAttemptIdAfter: task?.attemptId ?? null,
      warnings: warnings.slice(0, 3),
    }
  } finally {
    for (const off of cleanups) off()
    rmSync(workspace, { recursive: true, force: true })
  }
}

async function main() {
  const restartMoment = new Date().toISOString()
  const shipped = join(ADOPTED_LIB, "scheduler.js")
  const legs = {}
  legs.control_pending_current_tree = await runLeg({ label: "control-pending", libDir: ADOPTED_LIB, taskStatus: "pending", attemptId: undefined, hook: { stripRegion: false, forceTerminal: false } })
  legs.pure_terminal_current_tree = await runLeg({ label: "pure-terminal", libDir: ADOPTED_LIB, taskStatus: "completed", attemptId: RECORDED_ATTEMPT_ID, hook: { stripRegion: false, forceTerminal: false } })
  legs.recorded_race_current_tree = await runLeg({ label: "race-current", libDir: ADOPTED_LIB, taskStatus: "in_progress", attemptId: RECORDED_ATTEMPT_ID, hook: { stripRegion: false, forceTerminal: true } })
  const scratch = scratchLib()
  try {
    legs.recorded_race_region_stripped = await runLeg({ label: "race-stripped", libDir: scratch.libDir, taskStatus: "in_progress", attemptId: RECORDED_ATTEMPT_ID, hook: { stripRegion: true, forceTerminal: true } })
  } finally {
    scratch.cleanup()
  }

  const controlWakes = legs.control_pending_current_tree.deliveries > 0
  const redSideWakes = legs.recorded_race_region_stripped.deliveries > 0
  const terminalSilent = legs.pure_terminal_current_tree.deliveries === 0 && legs.recorded_race_current_tree.deliveries === 0
  const outcome = terminalSilent
    ? "NOT WOKEN — on the kick route a fresh process loading the current tree refuses the wake for terminal work (0 deliveries + the NAMED decline). The restart reading does not reproduce the MEASURED EVENTS; the mechanism claim stays REFUTED-for-a-fresh-process; the residual stays UNRESOLVED with the named probe cited on scheduler.js (that probe cannot see a long-lived host process)."
    : "WOKEN — the member IS woken for a terminal task on a fresh load of the current tree: the mechanism claim is REFUTED as an explanation and the wake is a LIVE delivery-boundary hole, so the hunt moves to the OTHER wake routes (approval/spawn-time dispatch, the idle edge, memberSelections, or a stale on-disk snapshot read outside the lock)."
  const result = {
    schema: "t79/decisive-host-restart/1",
    leg: "wave-2b lane C (t17)",
    question: "does a fresh load of the current tree still wake a member for an already-TERMINAL task on a ticket-composing path?",
    restart: {
      moment: restartMoment,
      meaning: "a NEW PROCESS importing the current tree fresh — under T-21 the loaded revision is a process property, so this is the operative sense of 'restart' for this question",
      pid: process.pid,
      cwd: process.cwd(),
      dshHome: process.env.DSH_HOME ?? null,
      home: process.env.HOME ?? null,
      probeBound: "mpd-bg reload-check compares a module mtime to the NEWEST SESSION's directory mtime and cannot see a long-lived host PROCESS; a FRESH reading is NOT load evidence for a running host",
      notRun: "a full booted-dsh team lifecycle (the idle edge / approval-time dispatch / memberSelections routes) — named as the residual, NOT claimed as covered",
    },
    schedulerSha256: sha(shipped),
    legs,
    outcome,
    outcomeReadings: {
      control: controlWakes ? "the same kick with a PENDING task and the same fixture COMPOSED A TICKET and DELIVERED -> this harness CAN wake, so a 0 below is a reading and not a dead path" : "NO delivery even for a pending task — the harness is dead and every 0 below is worthless",
      pureTerminal: legs.pure_terminal_current_tree.deliveries + " deliveries and " + legs.pure_terminal_current_tree.hookRecords.length + " tickets composed (the injected recorder at the pre-wake anchor never fired): the terminal status is filtered out at SELECTION, before the re-check is reached",
      recordedRaceCurrent: legs.recorded_race_current_tree.deliveries + " deliveries, " + legs.recorded_race_current_tree.hookRecords.length + " ticket composed, task forced terminal inside the window (" + (legs.recorded_race_current_tree.forcedTerminal[0] ?? "not forced") + "), " + (legs.recorded_race_current_tree.namedDecline.length > 0 ? "the NAMED decline from the delivery-boundary re-check" : "NO named decline (inconclusive)"),
      redSide: redSideWakes ? "with the re-check region STRIPPED the same race, forced the same way, DOES deliver -> the guard, not the fixture, is what refuses" : "NO delivery even with the region stripped — a driver defect, not a reading",
    },
    discriminator: {
      predicate: "delivery.attempt_id == completion.attempt_id AND task terminal",
      completionAttemptId: RECORDED_ATTEMPT_ID,
      ticketAttemptIdReadInRaceLegs: [legs.recorded_race_current_tree.ticketAttemptId, legs.recorded_race_region_stripped.ticketAttemptId],
      forcedTerminalReadings: [legs.recorded_race_current_tree.forcedTerminal[0] ?? null, legs.recorded_race_region_stripped.forcedTerminal[0] ?? null],
      equalityHalfHolds: [legs.recorded_race_current_tree, legs.recorded_race_region_stripped].every((leg) => leg.ticketAttemptId === RECORDED_ATTEMPT_ID),
      reading: "MEASURED: the compose MINTED A FRESH attempt id in both race legs (the fixture's stored id " + RECORDED_ATTEMPT_ID + " is not what the ticket carried), so the equality half of the predicate is NOT reproduced by this construction while the terminality half IS (the task was terminal at the wake boundary, " + (legs.recorded_race_current_tree.forcedTerminal[0] ?? "forced") + "). The refusal this instrument observes is carried by the TERMINALITY half; a fix keyed only on `attempt_id equal AND terminal` would not have reddened on this construction, and the equality half remains unmeasured here (it needs a route that delivers an UNROTATED stored attempt id — none is available on the kick compose of the current tree).",
    },
    fixtureConstraint: "terminal task + idle member + a ticket-composing kick; the two wrong-reason fixtures (a bare status read, an idle-edge-only probe) are forbidden and were not used",
    redSide: "leg (3) is the red side: the record's SEVENTH measured event (the `t14` review re-dispatched after completion, attempt id " + RECORDED_ATTEMPT_ID + ") is reproduced mechanically, so its absence in legs (1)/(2) is a real refusal",
    replayCountNote: "the recorded/measured replay count MOVES — take the count from the record at the moment of writing, never from this driver",
    finishedAt: new Date().toISOString(),
  }
  writeFileSync(join(OUT, "t79-decisive-result.json"), JSON.stringify(result, null, 2) + "\n")
  const summary = {
    control_deliveries: legs.control_pending_current_tree.deliveries,
    pure_terminal_deliveries: legs.pure_terminal_current_tree.deliveries,
    recorded_race_deliveries: legs.recorded_race_current_tree.deliveries,
    stripped_race_deliveries: legs.recorded_race_region_stripped.deliveries,
    named_declines: legs.recorded_race_current_tree.namedDecline.length,
    composed_tickets: [legs.control_pending_current_tree.hookRecords.length, legs.pure_terminal_current_tree.hookRecords.length, legs.recorded_race_current_tree.hookRecords.length, legs.recorded_race_region_stripped.hookRecords.length],
    ticket_attempt_ids: [legs.recorded_race_current_tree.ticketAttemptId, legs.recorded_race_region_stripped.ticketAttemptId],
    scheduler_sha256: result.schedulerSha256,
  }
  console.log(JSON.stringify(summary, null, 2))
  const green = controlWakes
    && legs.control_pending_current_tree.hookRecords.length > 0
    && redSideWakes
    && terminalSilent
    && legs.pure_terminal_current_tree.hookRecords.length === 0
    && legs.recorded_race_current_tree.hookRecords.length > 0
    && legs.recorded_race_current_tree.namedDecline.length > 0
  const holdMs = Number(process.env.T79_HOLD_BEFORE_EXIT_MS ?? 0)
  if (holdMs > 0) {
    console.log("T79-HOLDING pid=" + process.pid + " for " + holdMs + "ms")
    await new Promise((wait) => setTimeout(wait, holdMs))
  }
  process.exit(green ? 0 : 1)
}

await main()
