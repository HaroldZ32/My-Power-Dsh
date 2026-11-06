// S1–S4 — THE FORCE SUPERVISOR: triggered by SILENCE, decided in TWO PHASES (grace, then kill).
//
// WHAT THESE ARMS PIN (updated 2026-11-06, contract `watchdog-force-silence.md`):
//   1. an owner stored as a SESSION ID resolves to its member, so the §4 report-only fallback — the
//      exact VEdit degradation — does NOT fire for a healthy team;
//   2. a member SILENT past `forceAfterMs` produces ONE `wedged` decision (after the S4 grace phase)
//      and the engine hands it to the team plane's force seam with the team's own lead authorising.
//      These arms pass `graceMs: 0` where they pin the KILL; the grace phase has its own arms below;
//   3. an OWNER WITH A `bash` CALL OPEN is exempt (no seam call) and ONE `long-bash` incident is
//      recorded at the boundary — with no age bound on the call;
//   4. the CAPTAIN is never a force target;
//   5. `forceAfterMs: 0` disables the rule, and a member with FRESH stamps is never forced however old
//      its row is (age alone is not a trigger any more);
//   6. a planeless composition (no `mpdTeamActions`) records `force: "not-applied"` and never throws.
//
// Every arm drives the REAL engine over the mpd RECORD plane (`mpdTeams.list`), because that is the
// plane the VEdit incident ran on and the one whose projection used to drop `startedAt`.
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { TaskStatus, TeamRecord as MpdTeamRecord } from "../../mpd-team-core-plugin/src/team-store"
import { WatchdogEngine, type EngineContext, type WedgeForceOutcome, type WedgeForceRequest, type WedgeForceSeam } from "../src/engine"
import { WATCHDOG_DEFAULTS, WatchdogMachine, type SilenceCandidate } from "../src/machine"
import { heartbeatPath } from "../src/paths"
import { readIncidents } from "../src/sidecars"
import type { HeartbeatStamp } from "../src/store"
import { forceSeamOf } from "../src/index"
import { readTeams } from "../src/team"
import { openOutstandingChannel, sandbox, stubAdapter, testConfig, type Sandbox } from "./support"
import { mkdirSync, writeFileSync } from "node:fs"

/** The mpd record's id space (the id `agent_teams_dispatch` asks the watchdog about). */
const TEAM_ID = "team-20261105120000"
/** The captain's own session: the authorising session, never a force target. */
const LEAD = "sess-lead"
/** The member's executor handle, which is ALSO the spelling a `claim` writes as the owner. */
const MEMBER = "sess-m1"
/** The member's board name, which is the heartbeat file's key. */
const MEMBER_NAME = "Senior Engineer"
/** The tick clock every arm uses (a fixed instant, never the wall clock). */
const NOW = 1_800_000_000_000
/** The frozen force bound (15 minutes), stated once so an arm's arithmetic reads like the contract. */
const FORCE_MS = 900_000

/** One mpd team record whose single task is owned, `in_progress` and stamped. */
function mpdRecord(overrides: { owner?: string; startedAt?: string; status?: TaskStatus } = {}): MpdTeamRecord {
  return {
    version: 1,
    teamId: TEAM_ID,
    name: "wave-force",
    description: "the force supervisor",
    leadSessionId: LEAD,
    phase: "active",
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    approvedAt: new Date(NOW - 86_400_000).toISOString(),
    members: [
      { id: "M1", name: MEMBER_NAME, description: "implements", status: "running", spawnedAt: new Date(NOW - 86_400_000).toISOString(), executorRef: MEMBER },
    ],
    tasks: [
      {
        id: "T1",
        subject: "the wedged row",
        description: "own the record",
        kind: "work",
        status: overrides.status ?? "in_progress",
        owner: overrides.owner ?? MEMBER,
        blockedBy: [],
        writeScopes: ["packages/a/**", "packages/b/**"],
        createdAt: new Date(NOW - 86_400_000).toISOString(),
        updatedAt: new Date(NOW - 60_000).toISOString(),
        startedAt: overrides.startedAt ?? new Date(NOW - FORCE_MS - 1_000).toISOString(),
        revision: 1,
      },
    ],
    nextMemberNumber: 2,
    nextTaskNumber: 2,
  }
}

/** A recording force seam: what the engine asked for, and what it was told. */
interface SeamRecorder {
  /** The seam handed to the engine. */
  seam: WedgeForceSeam
  /** Every request the engine made, in call order. */
  calls: WedgeForceRequest[]
  /** Replace the answer every subsequent call receives. */
  answer: (next: WedgeForceOutcome) => void
}

/** Build a force seam that records its requests and answers the current scripted outcome. */
function seamRecorder(): SeamRecorder {
  // The requests seen so far.
  const calls: WedgeForceRequest[] = []
  // The outcome the next call answers; applied by default.
  let answer: WedgeForceOutcome = { ok: true, handoff: "/ws/.mpd/handoff/senior-engineer-T1-x.md", requeued: { taskId: "T1", attempt: 2 }, split: ["T2", "T3"] }
  return {
    calls,
    seam: {
      // S4's grace phase: these arms drive the KILL phase, so the directive is acknowledged and the
      // engine's own grace bookkeeping is what the arms that need it assert separately.
      graceWedged: async (): Promise<{ ok: boolean }> => ({ ok: true }),
      forceWedged: async (request: WedgeForceRequest): Promise<WedgeForceOutcome> => {
        calls.push(request)
        return answer
      },
    },
    answer: (next: WedgeForceOutcome): void => {
      answer = next
    },
  }
}

/** The engine context whose only service is the mpd team plane (the watchdog's only team source). */
function contextWith(record: MpdTeamRecord | undefined): EngineContext {
  return {
    on: () => () => {},
    get: (id: string) => (id === "mpdTeams" ? { list: (): MpdTeamRecord[] => (record === undefined ? [] : [record]) } : undefined),
  } as unknown as EngineContext
}

/** Mount the real engine over one mpd record, with a live registry and an optional force seam. */
function mount(box: Sandbox, record: MpdTeamRecord | undefined, seam?: WedgeForceSeam, overrides: Partial<Parameters<typeof testConfig>[0]> = {}): { stub: ReturnType<typeof stubAdapter>; engine: WatchdogEngine; dispose: () => void } {
  // The stub adapter: the record plane comes from the ctx, the registry from here.
  const stub = stubAdapter({
    workspace: box.workspace,
    liveAgents: [
      { id: LEAD, session: { id: LEAD, header: { cwd: box.workspace } } },
      { id: MEMBER, session: { id: MEMBER, header: { cwd: box.workspace } } },
    ],
  })
  // The engine under test, driven with an injected clock by each arm.
  const engine = new WatchdogEngine(
    stub.adapter,
    contextWith(record),
    testConfig({ stateDir: box.stateDir, warnSilenceMs: 600_000, actionOnEscalate: "warn-only", ...overrides }),
    undefined,
    seam,
  )
  // Teardown callbacks for the listeners the engine installed.
  const disposers = engine.install()
  return { stub, engine, dispose: (): void => { for (const off of disposers) off() } }
}

/** Write one member's heartbeat file through the plugin's OWN path (the key is sanitised there). */
function writeStamps(box: Sandbox, memberKey: string, stamps: HeartbeatStamp[]): void {
  // The plugin's own heartbeat path, so the key is sanitised exactly as production sanitises it.
  const path = heartbeatPath(box.workspace, box.stateDir, memberKey)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, stamps.map((entry) => JSON.stringify(entry)).join("\n") + "\n")
}

/** One heartbeat stamp of the wedged task, with the fields the arms vary. */
function stamp(at: number, overrides: Partial<HeartbeatStamp> = {}): HeartbeatStamp {
  return {
    kind: "step",
    at,
    member: MEMBER_NAME,
    memberKey: MEMBER_NAME,
    teamId: TEAM_ID,
    taskId: "T1",
    attemptId: "1",
    turnId: MEMBER_NAME + "#1",
    workspace: "/w",
    ...overrides,
  }
}

describe("D3.2 — the projection carries the force clock", () => {
  test("`startedAt` survives the mpd projection (it used to be dropped, so no duration existed)", () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The record whose row entered `in_progress` at a known instant.
      const record = mpdRecord()
      // The projected team, read through the plugin's own projection.
      const team = readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace, { list: (): MpdTeamRecord[] => [record] })[0]
      // THE PIN: the board's own start instant is the force rule's whole clock.
      expect(team.tasks[0].startedAt).toBe(Date.parse(String(record.tasks[0].startedAt)))
      expect(team.tasks[0].updatedAt).toBe(Date.parse(String(record.tasks[0].updatedAt)))
    } finally {
      box.cleanup()
    }
  })
})

describe("D3.1 — owner identity: a claim that wrote the SESSION ID still resolves", () => {
  test("an owner stored as a SESSION ID announces NO §4 report-only fallback", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The record whose owner is the member's SESSION, exactly as a member's own claim writes it.
      const record = mpdRecord({ owner: MEMBER })
      // The stub adapter (the live registry the detached-session row reads).
      const { stub, engine, dispose } = mount(box, record)
      try {
        // Fold evidence for the member's session: a real request with no answer yet.
        openOutstandingChannel(stub, MEMBER, NOW - 60_000)
        // One stamp so the candidate is observed as WORKED rather than never-started.
        writeStamps(box, MEMBER_NAME, [stamp(NOW - 60_000)])
        // ONE tick: the identity resolution happens while the candidate set is built.
        await engine.tickOnce(NOW)
        // THE PIN: the name-keyed lookup used to miss this spelling and degrade the whole watchdog.
        expect(engine.getStats().channelFallbacks).toBe(0)
        expect(engine.predicateStatus().source).toBe("channel")
        expect(engine.predicateStatus().reason).not.toContain("no session/event fold data")
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("FALSIFIER: the same record with an owner naming NOBODY still falls back", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // An owner that is neither a name nor a live roster handle: the honest degradation case.
      const record = mpdRecord({ owner: "sess-unknown" })
      // The engine under test.
      const { engine, dispose } = mount(box, record)
      try {
        // One tick with no fold evidence for anybody.
        await engine.tickOnce(NOW)
        // The fallback STILL fires for an owner the record cannot name — the degradation is intact,
        // it just never fires on the healthy spelling.
        expect(engine.getStats().channelFallbacks).toBeGreaterThan(0)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("D3.2 — the 15-minute force decision", () => {
  test("a task past the bound is decided ONCE and handed to the team plane with the lead as authoriser", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record (owner = session id, started 15 min + 1 s ago).
      const record = mpdRecord()
      // The recording seam the engine must call exactly once.
      const recorder = seamRecorder()
      // The engine under test, with the GRACE phase off so this arm pins the KILL alone.
      const { engine, dispose } = mount(box, record, recorder.seam, { graceMs: 0 })
      try {
        // S1: the member's last observable activity is older than the silence bound — that, not the
        // row's age, is what makes it a force target.
        writeStamps(box, MEMBER_NAME, [stamp(NOW - FORCE_MS - 60_000)])
        // One tick past the bound.
        await engine.tickOnce(NOW)
        expect(recorder.calls.length).toBe(1)
        // The request carries the record's own facts: the task, the member handle and the LEAD session.
        expect(recorder.calls[0]).toMatchObject({ taskId: "T1", attemptId: "1", member: MEMBER, sessionId: LEAD, teamId: TEAM_ID })
        expect(recorder.calls[0].elapsedMs).toBeGreaterThanOrEqual(FORCE_MS)
        // The applied incident is the durable statement that a member was stopped.
        const incidents = readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force")
        expect(incidents.length).toBe(1)
        expect(incidents[0]).toMatchObject({ teamId: TEAM_ID, taskId: "T1", force: "applied", handoff: "/ws/.mpd/handoff/senior-engineer-T1-x.md" })
        expect(engine.getStats().forced).toBe(1)
        // ONE decision per task+attempt: a second tick at the same clock does not force again.
        await engine.tickOnce(NOW + 1_000)
        expect(recorder.calls.length).toBe(1)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a task BELOW the bound is not forced, and the silence ladder is unchanged", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // Started 14 minutes ago: inside the bound.
      const record = mpdRecord({ startedAt: new Date(NOW - FORCE_MS + 60_000).toISOString() })
      // The recording seam that must stay empty.
      const recorder = seamRecorder()
      // The engine under test.
      const { stub, engine, dispose } = mount(box, record, recorder.seam)
      try {
        // A turn that is answered nothing yet, so the candidate is observable.
        openOutstandingChannel(stub, MEMBER, NOW - 30_000)
        writeStamps(box, MEMBER_NAME, [stamp(NOW - 30_000)])
        // One tick.
        await engine.tickOnce(NOW)
        expect(recorder.calls).toEqual([])
        expect(engine.getStats().forced).toBe(0)
        // No force record of any kind was written.
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force")).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("FALSIFIER: forceAfterMs 0 disables the whole rule", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record, which the disabled knob must leave alone.
      const record = mpdRecord()
      // The recording seam that must stay empty.
      const recorder = seamRecorder()
      // The engine under test, with the rule switched off.
      const { engine, dispose } = mount(box, record, recorder.seam, { forceAfterMs: 0 })
      try {
        // One tick past the bound.
        await engine.tickOnce(NOW)
        expect(recorder.calls).toEqual([])
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force")).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("an absent team plane records `not-applied` and the tick NEVER throws", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record, now decided without a seam (a composition with no team-core row).
      const record = mpdRecord()
      // The engine under test, mounted WITHOUT a force seam, and with the grace phase off.
      const { engine, dispose } = mount(box, record, undefined, { graceMs: 0 })
      try {
        // A member that has been silent past the bound.
        writeStamps(box, MEMBER_NAME, [stamp(NOW - FORCE_MS - 60_000)])
        // The tick must resolve, not reject.
        await expect(engine.tickOnce(NOW)).resolves.toBeDefined()
        // The honest record: the wedge was seen and nothing was forced.
        const incidents = readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force")
        expect(incidents.length).toBe(1)
        expect(incidents[0].force).toBe("not-applied")
        expect(engine.getStats().forceFailures).toBe(1)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a RETRYABLE refusal re-arms the task while the incident stays ONE per attempt", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record.
      const record = mpdRecord()
      // The recording seam, scripted to refuse retryably (a handoff write failure).
      const recorder = seamRecorder()
      recorder.answer({ ok: false, error: "handoff write failed", retryable: true })
      // The engine under test, with the grace phase off.
      const { engine, dispose } = mount(box, record, recorder.seam, { graceMs: 0 })
      try {
        // A member that has been silent past the bound.
        writeStamps(box, MEMBER_NAME, [stamp(NOW - FORCE_MS - 60_000)])
        // Two ticks: the first fails retryably, the second is decided again.
        await engine.tickOnce(NOW)
        await engine.tickOnce(NOW + 15_000)
        expect(recorder.calls.length).toBe(2)
        // ... but the durable incident is written ONCE for this attempt, never per tick.
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force").length).toBe(1)
        expect(engine.getStats().forceFailures).toBe(2)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("D3.3 — the ONLY exemption: an in-flight bash call", () => {
  test("a wedged member with bash OPEN is NOT forced and ONE long-bash incident is recorded", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record.
      const record = mpdRecord()
      // The recording seam that must stay empty.
      const recorder = seamRecorder()
      // The engine under test.
      const { engine, dispose } = mount(box, record, recorder.seam)
      try {
        // A bash call opened two hours ago and never closed: NO age bound exempts it (§D3.3).
        writeStamps(box, MEMBER_NAME, [stamp(NOW - 7_200_000, { kind: "tool-start", tool: "bash", callId: "call-1" })])
        // One tick past the bound.
        await engine.tickOnce(NOW)
        expect(recorder.calls).toEqual([])
        expect(engine.getStats().forced).toBe(0)
        // The boundary report: the bound WAS crossed and the exemption was taken.
        const exempt = readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "long-bash")
        expect(exempt.length).toBe(1)
        expect(exempt[0]).toMatchObject({ teamId: TEAM_ID, taskId: "T1", cause: { kind: "long-bash", tool: "bash" } })
        expect(engine.getStats().longBash).toBe(1)
        // ONE report per generation: a second tick does not append another.
        await engine.tickOnce(NOW + 15_000)
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "long-bash").length).toBe(1)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the SAME wedged member with a NON-bash tool open IS forced (the exemption is bash only)", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record.
      const record = mpdRecord()
      // The recording seam.
      const recorder = seamRecorder()
      // The engine under test, with the grace phase off.
      const { engine, dispose } = mount(box, record, recorder.seam, { graceMs: 0 })
      try {
        // A long `mpd_role_spawn` is NOT an exemption: D3 is the supervisor for exactly that case.
        writeStamps(box, MEMBER_NAME, [stamp(NOW - 7_200_000, { kind: "tool-start", tool: "mpd_role_spawn", callId: "call-1" })])
        // One tick past the bound.
        await engine.tickOnce(NOW)
        expect(recorder.calls.length).toBe(1)
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "long-bash")).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("D3.4 — the decider/actor seam (`mpdTeamActions`)", () => {
  test("the resolver forwards the record's own ids and normalises an applied answer", async () => {
    // Every request the fake service receives, in call order.
    const forwarded: unknown[] = []
    // The team plane's published surface, as team-core publishes it.
    const service = {
      force: async (input: unknown): Promise<unknown> => {
        forwarded.push(input)
        return { ok: true, handoff: "/ws/.mpd/handoff/x.md", requeued: { taskId: "T1", attempt: 2 }, split: ["T2"] }
      },
    }
    // The row context whose only service is the team plane's action surface.
    const ctx = { get: (id: string) => (id === "mpdTeamActions" ? service : undefined) }
    // The seam the engine would call.
    const outcome = await forceSeamOf(ctx).forceWedged({
      workspace: "/ws",
      teamId: "team-1",
      taskId: "T1",
      attemptId: "1",
      member: "sess-m1",
      sessionId: LEAD,
      startedAt: NOW - FORCE_MS,
      elapsedMs: FORCE_MS,
      silentMs: FORCE_MS,
      graceSentAt: NOW - FORCE_MS,
      lastToolCalls: ["bash"],
      toolCalls: [],
      assistantMessage: null,
    })
    expect(outcome).toMatchObject({ ok: true, handoff: "/ws/.mpd/handoff/x.md", requeued: { taskId: "T1", attempt: 2 }, split: ["T2"] })
    // The request carries the AUTHORISING session and the watchdog's evidence, nothing invented.
    expect(forwarded).toEqual([
      {
        sessionId: LEAD,
        teamId: "team-1",
        taskId: "T1",
        workspace: "/ws",
        evidence: {
          member: "sess-m1",
          attemptId: "1",
          startedAt: NOW - FORCE_MS,
          elapsedMs: FORCE_MS,
          // S5/S6: the measured idle, the grace instant, the tool calls WITH excerpts and the last
          // assistant message travel with the request so the fallback handoff can carry the work.
          silentMs: FORCE_MS,
          graceSentAt: NOW - FORCE_MS,
          lastToolCalls: ["bash"],
          toolCalls: [],
          assistantMessage: null,
        },
      },
    ])
  })

  test("an ABSENT service and a REFUSAL are both { ok:false } — the seam never throws", async () => {
    // One request, reused by both arms (only the service under the context changes).
    const request: WedgeForceRequest = { workspace: "/ws", teamId: "t", taskId: "T1", attemptId: "1", member: "m", sessionId: LEAD, startedAt: 0, elapsedMs: 0, silentMs: 0, graceSentAt: 0, lastToolCalls: [], toolCalls: [], assistantMessage: null }
    // A context with no team plane mounted at all.
    const bare = { get: (): undefined => undefined }
    await expect(forceSeamOf(bare).forceWedged(request)).resolves.toMatchObject({ ok: false })
    // A service whose force member refuses with a sentence.
    const refusing = { get: (id: string) => (id === "mpdTeamActions" ? { force: async (): Promise<unknown> => ({ ok: false, error: "the lead is not live", retryable: false }) } : undefined) }
    await expect(forceSeamOf(refusing).forceWedged(request)).resolves.toMatchObject({ ok: false, error: "the lead is not live" })
  })
})

describe("D3.3 (review F3) — the tool NAME is the exemption, never a clock", () => {
  test("an OPEN bash with NO start stamp is still EXEMPT (and reports inFlightMs 0)", () => {
    // The machine, driven directly: this is the shape the engine cannot always clock.
    const machine = new WatchdogMachine()
    // A wedged task whose owner has an open `bash` that carried no start instant at all.
    const candidate: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      // S1: the bound is SILENCE, so the stale stamp is what put this candidate at the boundary.
      lastSeen: NOW - FORCE_MS - 60_000,
      lastKind: "tool-start",
      everStampedForTask: true,
      inFlightSince: null,
      inFlightTool: "bash",
      status: "in_progress",
      startedAt: NOW - FORCE_MS - 1_000,
    }
    // One observation past the bound: the exemption applies and NOTHING is forced.
    const decisions = machine.observe([candidate], NOW, { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS })
    expect(decisions.map((decision) => decision.type)).toEqual(["long-bash"])
    expect(decisions[0]).toMatchObject({ inFlightMs: 0, tool: "bash" })
  })

  test("... and the SAME holds when only the FOLD names the tool and states no start instantly", () => {
    // The machine, driven directly.
    const machine = new WatchdogMachine()
    // The shape a `session/event` fold produces when it saw the call but not its start instant:
    // the tool name lives on the fold's fields, and the candidate's own stamp fields are null.
    const candidate: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      // S1/S3: the fold's open call is the bound's clock, so the call itself must be old.
      lastSeen: NOW - FORCE_MS - 60_000,
      lastKind: "tool-start",
      everStampedForTask: true,
      inFlightSince: null,
      inFlightTool: null,
      channelState: "IN-FLIGHT",
      // The call's start, which is S3's clock: two hours open, i.e. far past the bound.
      channelInFlightSince: NOW - 7_200_000,
      channelInFlightTool: "bash",
      status: "in_progress",
      startedAt: NOW - FORCE_MS - 1_000,
    }
    // One observation past the bound.
    const decisions = machine.observe([candidate], NOW, { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS })
    expect(decisions.map((decision) => decision.type)).toEqual(["long-bash"])
    // THE FOLD'S CLOCK IS MEASURED: the call has been open for two hours, so the report states it
    // instead of the 0 the clockless arm above honestly reports.
    expect(decisions[0]).toMatchObject({ inFlightMs: 7_200_000, tool: "bash" })
  })
})

describe("D3.5 — the captain is never a force target", () => {
  test("a task owned by the LEAD session is never forced, however old it is", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The record whose row is owned by the captain's own session.
      const record = mpdRecord({ owner: LEAD })
      // The recording seam that must stay empty.
      const recorder = seamRecorder()
      // The engine under test.
      const { stub, engine, dispose } = mount(box, record, recorder.seam)
      try {
        // The captain's own request, open and unanswered.
        openOutstandingChannel(stub, LEAD, NOW - 60_000)
        // A stamp so the row is observable.
        writeStamps(box, "lead", [stamp(NOW - 60_000, { member: "lead", memberKey: "lead" })])
        // One tick past the bound.
        await engine.tickOnce(NOW)
        expect(recorder.calls).toEqual([])
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force")).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("D3.6 — a force that produced NO new revision must not silence the ladder", () => {
  test("MACHINE: the SAME generation gets no second force, and the silence ladder resumes", () => {
    // The machine, driven directly: this is the branch a NON-retryable refusal leaves behind.
    const machine = new WatchdogMachine()
    // A wedged row whose owner's request has been OUTSTANDING past the warn bound as well.
    const candidate: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      lastSeen: NOW - FORCE_MS - 900_000,
      lastKind: "step",
      everStampedForTask: true,
      inFlightSince: null,
      inFlightTool: null,
      channelState: "OUTSTANDING",
      outstandingSince: NOW - FORCE_MS - 900_000,
      status: "in_progress",
      startedAt: NOW - FORCE_MS - 1_000,
    }
    // The knobs the engine resolves for this rule.
    // `graceMs: 0` so this arm pins the KILL decision itself; the grace phase is covered separately.
    const knobs = { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS, graceMs: 0 }
    // Tick 1: the wedge CONSUMES the candidate — ONE force decision and no WARN in the same tick.
    expect(machine.observe([candidate], NOW, knobs).map((decision) => decision.type)).toEqual(["wedged"])
    // Tick 2, the SAME generation (the force produced no new revision): no second force ...
    /** The second observation past the bound. */
    const second = machine.observe([candidate], NOW + 15_000, knobs)
    expect(second.filter((decision) => decision.type === "wedged")).toEqual([])
    // ... and the silence ladder is NOT suppressed any more.
    expect(second.map((decision) => decision.type)).toEqual(["warn"])
  })

  test("ENGINE: a NON-retryable refusal is recorded ONCE, and the ladder resumes on the next tick", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The wedged record, which the refused force leaves untouched.
      const record = mpdRecord()
      // The recording seam, scripted to refuse WITHOUT a retry (a stale owner, a moved generation).
      const recorder = seamRecorder()
      recorder.answer({ ok: false, error: "task T1 is no longer owned by Senior Engineer", retryable: false })
      // The engine under test, with the grace phase off so the refusal is the FIRST decision.
      const { stub, engine, dispose } = mount(box, record, recorder.seam, { graceMs: 0 })
      try {
        // A member whose request went OUTSTANDING long before the force bound.
        openOutstandingChannel(stub, MEMBER, NOW - FORCE_MS - 900_000)
        writeStamps(box, MEMBER_NAME, [stamp(NOW - FORCE_MS - 900_000)])
        // Tick 1: the FORCE is decided and refused — the deciding tick carries no WARN.
        /** The first tick's result. */
        const first = await engine.tickOnce(NOW)
        expect(recorder.calls.length).toBe(1)
        expect(first.decisions.filter((decision) => decision.type === "warn")).toEqual([])
        // The refusal is on the durable record, once.
        expect(readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-force").length).toBe(1)
        // Tick 2: NO second force for the same generation ...
        /** The second tick's result. */
        const second = await engine.tickOnce(NOW + 15_000)
        expect(recorder.calls.length).toBe(1)
        // ... and the task is no longer silenced: the WARN ladder names it.
        expect(second.decisions.map((decision) => decision.type)).toEqual(["warn"])
        expect(second.decisions[0]).toMatchObject({ taskId: "T1", attemptId: "1" })
        expect(engine.getStats().forceFailures).toBe(1)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})

describe("S1–S4 (2026-11-06) — silence, not age; grace, then kill", () => {
  test("AC1: an ANCIENT row with FRESH activity is never forced", () => {
    // The machine, driven directly with a row that entered `in_progress` a day ago.
    const machine = new WatchdogMachine()
    // A candidate whose stamps are FRESH: activity is the trigger, and there is plenty of it.
    const candidate: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      lastSeen: NOW - 30_000,
      lastKind: "step",
      everStampedForTask: true,
      inFlightSince: null,
      inFlightTool: null,
      status: "in_progress",
      startedAt: NOW - 86_400_000,
    }
    // NO wedge decision of any kind: age alone is not a trigger (S2's ceiling is off by default).
    const decisions = machine.observe([candidate], NOW, { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS })
    expect(decisions.map((decision) => decision.type)).not.toContain("wedged")
    expect(decisions.map((decision) => decision.type)).not.toContain("grace")
  })

  test("AC2: the SAME row with STALE stamps crosses: grace first, then ONE kill after graceMs", () => {
    // The machine, driven directly.
    const machine = new WatchdogMachine()
    // The same row, now SILENT past the bound (no activity for 20 minutes).
    const candidate: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      lastSeen: NOW - FORCE_MS - 300_000,
      lastKind: "step",
      everStampedForTask: true,
      inFlightSince: null,
      inFlightTool: null,
      status: "in_progress",
      startedAt: NOW - FORCE_MS - 300_000,
    }
    /** The knobs this rule runs with: the frozen 90 s grace window. */
    const knobs = { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS }
    // Tick 1: the GRACE directive is decided, and the kill is NOT.
    const first = machine.observe([candidate], NOW, knobs)
    expect(first.map((decision) => decision.type)).toEqual(["grace"])
    expect(first[0]).toMatchObject({ silentMs: FORCE_MS + 300_000, deadline: NOW + 90_000 })
    // Tick 2, inside the window: consumed, so neither a second directive nor a kill.
    expect(machine.observe([candidate], NOW + 60_000, knobs).map((decision) => decision.type)).toEqual([])
    // Tick 3, past the window: exactly ONE kill, carrying the grace instant and the measured silence.
    const third = machine.observe([candidate], NOW + 90_001, knobs)
    expect(third.map((decision) => decision.type)).toEqual(["wedged"])
    // The silence is measured at the tick's own clock, so it has grown by the 90 s spent waiting.
    expect(third[0]).toMatchObject({ silentMs: FORCE_MS + 300_000 + 90_001, graceSentAt: NOW })
    // ... and a fourth tick never decides it again (one kill per generation).
    expect(machine.observe([candidate], NOW + 180_000, knobs).filter((decision) => decision.type === "wedged")).toEqual([])
  })

  // F3 (CodeRabbit, branch `fix/watchdog-force-silence`): a recovered member gets a NEW grace window.
  test("F3: activity resets the grace window, so a later crossing sends a NEW directive and kills once", () => {
    // The machine, driven directly.
    const machine = new WatchdogMachine()
    // The silent row: no activity for 20 minutes, so it crosses the force bound.
    const silent: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      lastSeen: NOW - FORCE_MS - 300_000,
      lastKind: "step",
      everStampedForTask: true,
      inFlightSince: null,
      inFlightTool: null,
      status: "in_progress",
      startedAt: NOW - FORCE_MS - 300_000,
    }
    // THE SAME row once activity came back: the newest stamp is fresh again, so it does not cross.
    const recovered: SilenceCandidate = { ...silent, lastSeen: NOW - 5_000 }
    /** The knobs this rule runs with: the frozen 90 s grace window. */
    const knobs = { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS }
    // Crossing 1: exactly one directive.
    expect(machine.observe([silent], NOW, knobs).map((decision) => decision.type)).toEqual(["grace"])
    // The member produced activity, so the bound is no longer crossed and the stored window is DROPPED.
    expect(machine.observe([recovered], NOW + 10_000, knobs).map((decision) => decision.type)).toEqual([])
    expect(machine.snapshot().grace).toEqual({})
    // Crossing 2 starts a NEW window: another directive, and NO kill (the old, expired instant must
    // not send the decision straight to the interrupt phase).
    const second = machine.observe([silent], NOW + 120_000, knobs)
    expect(second.map((decision) => decision.type)).toEqual(["grace"])
    expect(second[0]).toMatchObject({ deadline: NOW + 120_000 + 90_000 })
    expect(Object.values(machine.snapshot().grace)).toEqual([NOW + 120_000])
    // Still inside the NEW window: consumed, so no kill.
    expect(machine.observe([silent], NOW + 120_000 + 60_000, knobs).map((decision) => decision.type)).toEqual([])
    // Past the NEW window: exactly ONE kill, stamped with the NEW grace instant.
    const kill = machine.observe([silent], NOW + 120_000 + 90_001, knobs)
    expect(kill.filter((decision) => decision.type === "wedged").length).toBe(1)
    expect(kill[0]).toMatchObject({ graceSentAt: NOW + 120_000 })
  })

  test("AC3: a NON-bash tool INSIDE its bound suppresses; the SAME call past the bound does not", () => {
    // Two machines, one per half of the clause.
    const inside = new WatchdogMachine()
    /** The second machine, which observes the SAME call once it is past its bound. */
    const elapsed = new WatchdogMachine()
    // A silent row whose only open call is a `read`, five minutes old.
    const young: SilenceCandidate = {
      teamId: TEAM_ID,
      taskId: "T1",
      attemptId: "1",
      assignee: MEMBER,
      memberKey: MEMBER_NAME,
      lastSeen: NOW - FORCE_MS - 300_000,
      lastKind: "tool-start",
      everStampedForTask: true,
      inFlightSince: NOW - 300_000,
      inFlightTool: "read",
      status: "in_progress",
      startedAt: NOW - FORCE_MS - 300_000,
    }
    /** The frozen knobs, with the in-flight bound at 15 minutes. */
    const knobs = { ...WATCHDOG_DEFAULTS, forceAfterMs: FORCE_MS, toolInFlightMaxMs: 900_000 }
    // Inside the bound: the call IS activity, so nothing is decided (not even grace).
    expect(inside.observe([young], NOW, knobs).map((decision) => decision.type)).toEqual([])
    // Past the bound: the call stops being activity, so the grace phase is due.
    const old: SilenceCandidate = { ...young, inFlightSince: NOW - 1_800_000 }
    expect(elapsed.observe([old], NOW, knobs).map((decision) => decision.type)).toEqual(["grace"])
  })

  test("AC4: the ENGINE sends the directive and interrupts NOTHING on the first crossing", async () => {
    // A sandboxed workspace, cleaned up even when an assertion fails.
    const box = sandbox()
    try {
      // The silent record.
      const record = mpdRecord()
      // The recording seam: the grace call and the force call are counted separately.
      const graces: unknown[] = []
      /** Every KILL request the seam received: it must stay empty until the grace window expires. */
      const forces: unknown[] = []
      // The seam is built by hand so this arm can watch BOTH phases.
      const watched: WedgeForceSeam = {
        graceWedged: async (request): Promise<{ ok: boolean }> => {
          graces.push(request)
          return { ok: true }
        },
        forceWedged: async (request): Promise<WedgeForceOutcome> => {
          forces.push(request)
          return { ok: true, handoff: "/ws/h.md", handoffSource: "supervisor", requeued: { taskId: "T1", attempt: 2 }, split: [] }
        },
      }
      // The engine under test.
      const { engine, dispose } = mount(box, record, watched)
      try {
        // A member silent past the bound.
        writeStamps(box, MEMBER_NAME, [stamp(NOW - FORCE_MS - 60_000)])
        // Tick 1: the directive goes out, and NOBODY is interrupted.
        await engine.tickOnce(NOW)
        expect(graces.length).toBe(1)
        expect(forces).toEqual([])
        expect(engine.getStats().graceSent).toBe(1)
        // The durable GRACE record carries the deadline the kill is due at.
        const grace = readIncidents(box.workspace, box.stateDir).filter((entry) => entry.kind === "wedged-grace")
        expect(grace.length).toBe(1)
        expect(grace[0]).toMatchObject({ taskId: "T1", graceSentAt: NOW, deadline: NOW + 90_000 })
        // Tick 2, past the grace window: exactly ONE interrupt decision.
        await engine.tickOnce(NOW + 90_001)
        expect(forces.length).toBe(1)
        expect(engine.getStats().forced).toBe(1)
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})
