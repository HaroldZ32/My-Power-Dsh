// THE IDLE-MEMBER GUARD (contract `.mpd/plans/team-idle-member-guard.md` §3.1-3.3, §4 and Amendment 1).
//
// WHAT IS PROVEN HERE, offline: a live team's member with NO open board task is marked at its
// `agent/pre-step`, receives exactly ONE directive per idle turn, and has EVERY tool denied at the
// boundary with one line. A member holding a `pending`/`claimed`/`in_progress` task is not marked; an
// open task CLEARS a mark at the next pre-step (Amendment A2 — the path a cellwork dispatch takes,
// through `TeamExecutor.send`, which this row never observes as a tool call); the Lead and an EXPLICITLY
// registered control seat are exempt while an unregistered `cell-*` name is not; a terminal team never
// marks; and a member raised AFTER install is armed through `agent/created`.
//
// WHAT IS NOT PROVEN HERE: the live harness dispatch path (the row applies, the events fire, a real
// teammate receives a turn) — that is the QA case's subject
// (`skills/dsh-qa/scripts/team-idle-member-guard.ts`), never this file's. No arm touches the
// repository's own `.mpd`: every workspace is a fresh temp dir.
import { afterEach, describe, expect, test } from "bun:test"
import type { DshLiveAgent } from "../../mpd-dsh-adapter-plugin/src/index"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  IDLE_DENIAL_TEXT,
  IDLE_DIRECTIVE_TEXT,
  IDLE_PREAMBLE_TEXT,
  installIdleGuard,
  memberForSession,
  memberHasOpenTask,
  withIdlePreamble,
  type IdleGuardSeams,
} from "../src/idle-guard"
import {
  addTeamMember,
  addTeamTask,
  createTeam,
  updateTeamMember,
  updateTeamTask,
  withDerivedPhase,
  writeTeam,
  type TaskStatus,
  type TeamRecord,
} from "../src/team-store"

/** The frozen clock, so a seeded record's derived phase never races the wall clock. */
const NOW = new Date("2026-10-30T10:00:00.000Z")

/** One fake live agent: the session id the harness resolves, and its workspace-carrying header. */
interface FakeAgent {
  /** The agent id, which the adapter keeps equal to the session id. */
  id: string
  /** The session the guard resolves and the workspace header the adapter reads. */
  session: { id: string; header: { cwd: string } }
}

/** One pre-step listener the stub registry captured for an agent. */
type PreStepListener = (payload: { agent?: unknown; turn?: number; messages?: readonly unknown[] }, decision: { kind?: string; messages?: readonly unknown[] }) => { kind?: string; messages?: readonly unknown[] } | undefined

/** The harness one arm drives: a sandbox workspace, the stub seams, and the installed guard. */
interface Fixture {
  /** The sandbox workspace every record and root resolves to. */
  workspace: string
  /** The guard under test. */
  guard: ReturnType<typeof installIdleGuard>
  /** Every pre-step listener, keyed by the agent it was registered for. */
  listeners: Map<unknown, PreStepListener>
  /** Every event handler the stub bus captured, by event name. */
  bus: Map<string, Array<(...args: unknown[]) => unknown>>
  /** The process-wide tool guards the row installed. */
  guards: Array<(exec: { agent?: unknown; name?: string }) => string | undefined>
  /** The stable agent handle for a session id (one object per id, so listener identity holds). */
  agent: (sessionId: string) => FakeAgent
  /** Fire one agent's pre-step exactly as the harness would; throws when it was never registered. */
  step: (agent: FakeAgent, turn?: number, decision?: { kind?: string; messages?: readonly unknown[] }) => ReturnType<PreStepListener>
  /** The tool-boundary answer for one session calling one tool (a string is the denial). */
  toolAnswer: (sessionId: string, name: string) => string | undefined
  /** Fire one captured bus listener as the harness would. */
  emit: (event: string, payload: unknown) => void
}

/** The teams one arm seeded, removed with their sandbox after each test. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** The tool names the denial arm drives; the guard is name-independent by contract, so the list is wide. */
const DENIED_TOOLS: readonly string[] = ["read", "bash", "write", "edit", "agent_teams_mail", "agent_teams_task", "send_message", "mpd_memory_write"]

/**
 * Build the harness: a stub seam set that really registers a pre-step listener per agent and a tool
 * guard, a sandbox workspace, and the agents that are LIVE at install.
 * @param sessions - the session ids that already have a live agent when the guard installs.
 * @returns the fixture an arm drives.
 */
function fixture(sessions: readonly string[] = []): Fixture {
  /** The sandbox workspace every root answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-idle-guard-"))
  sandboxes.push(workspace)
  /** The stable agent handle per session id, so listener identity survives repeated lookups. */
  const agents = new Map<string, FakeAgent>()
  /** The stable agent handle for a session id. */
  const agent = (sessionId: string): FakeAgent => {
    /** The cached handle, when the arm asked before. */
    const known = agents.get(sessionId)
    if (known !== undefined) return known
    /** The new handle: the shared session/agent id and the workspace header the adapter reads. */
    const created: FakeAgent = { id: sessionId, session: { id: sessionId, header: { cwd: workspace } } }
    agents.set(sessionId, created)
    return created
  }
  /** The live agents the registry reports at install. */
  const live: FakeAgent[] = sessions.map(agent)
  /** The per-agent pre-step listeners. */
  const listeners = new Map<unknown, PreStepListener>()
  /** The event handlers the stub bus captured. */
  const bus = new Map<string, Array<(...args: unknown[]) => unknown>>()
  /** The tool guards the install registered. */
  const guards: Array<(exec: { agent?: unknown; name?: string }) => string | undefined> = []
  /** The structural adapter subset the installer needs (no full harness, no dsh spawn). */
  const dsh: IdleGuardSeams = {
    liveAgents: () => live,
    registerAgentPreStep: (target: unknown, listener: PreStepListener): (() => void) => {
      listeners.set(target, listener)
      return (): void => { listeners.delete(target) }
    },
    onEvent: (event: string, handler: (...args: unknown[]) => unknown): (() => void) => {
      /** The handlers already captured for this event. */
      const existing = bus.get(event) ?? []
      existing.push(handler)
      bus.set(event, existing)
      return (): void => {}
    },
    guardTool: (guard: (exec: { agent?: unknown }) => string | undefined): (() => void) => {
      guards.push(guard)
      return (): void => {}
    },
    workspaceRoot: (): string => workspace,
    rowLog: (): void => { /* silent in tests */ },
  }
  /** The installed guard. */
  const guard = installIdleGuard(dsh)
  return {
    workspace,
    guard,
    listeners,
    bus,
    guards,
    agent,
    step: (target: FakeAgent, turn?: number, decision?: { kind?: string; messages?: readonly unknown[] }): ReturnType<PreStepListener> => {
      /** The listener registered for that agent. */
      const listener = listeners.get(target)
      if (listener === undefined) throw new Error("no pre-step listener was registered for " + target.id)
      return listener({ agent: target, turn }, decision ?? { kind: "enter", messages: [] })
    },
    toolAnswer: (sessionId: string, name: string): string | undefined => {
      for (const guardFn of guards) {
        /** One guard's answer for a call made by that session. */
        const answer = guardFn({ agent: { session: { id: sessionId } }, name })
        if (typeof answer === "string") return answer
      }
      return undefined
    },
    emit: (event: string, payload: unknown): void => {
      for (const handler of bus.get(event) ?? []) handler(payload)
    },
  }
}

/**
 * Seed one live team: a Lead session, the named members with their executor handles, and one task.
 * @param fx - the fixture whose workspace receives the record.
 * @param options - the Lead session, the members, and an optional task `{owner, status, ownerSpelling}`.
 * @returns the record as written.
 */
function seedTeam(fx: Fixture, options: { lead: string; members: Array<{ name: string; session: string }>; task?: { owner: string; status: TaskStatus; ownerSpelling?: "name" | "handle" } }): TeamRecord {
  /** The record under construction. */
  let record = createTeam(fx.workspace, { name: "the wave", description: "one wave", leadSessionId: options.lead }, NOW)
  for (const member of options.members) {
    record = addTeamMember(record, { name: member.name, description: member.name }, NOW)
    record = updateTeamMember(record, member.name, { executorRef: member.session, status: "running" })
  }
  if (options.task !== undefined) {
    /** The owner spelling this record carries: the display name, or the executor handle. */
    const owner = options.task.ownerSpelling === "handle"
      ? options.members.find((member) => member.name === options.task?.owner)?.session ?? options.task.owner
      : options.task.owner
    record = addTeamTask(record, { subject: "work", description: "do the work", owner }, NOW)
    /** The minted task, whose status the arm sets when it is not `pending`. */
    const task = record.tasks[record.tasks.length - 1]
    if (options.task.status !== "pending") record = updateTeamTask(record, task.id, { status: options.task.status }, NOW)
  }
  record = withDerivedPhase(record)
  writeTeam(fx.workspace, record)
  return record
}

describe("the spawn preamble (the prose layer, §3.3)", () => {
  test("the fixed preamble is prepended, followed by the caller's prompt", () => {
    expect(withIdlePreamble("You implement.")).toBe(IDLE_PREAMBLE_TEXT + "\n\nYou implement.")
  })
})

describe("§3.1 detection: a taskless member is marked, directed once, and denied every tool", () => {
  test("the pre-step marks the session, injects ONE directive, and preserves the downstream messages", () => {
    /** The harness under test, with the member already live at install. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    /** The step's answer, with a downstream message the directive must ADD to. */
    const decision = fx.step(worker, 1, { kind: "enter", messages: [{ id: "carried" }] })
    expect(decision?.kind).toBe("enter")
    expect(decision?.messages?.length).toBe(2)
    expect(decision?.messages?.[0]).toEqual({ id: "carried" })
    /** The injected message, read back through its content block. */
    const injected = decision?.messages?.[1] as { content?: Array<{ text?: string }>; role?: string }
    expect(injected.role).toBe("user")
    expect(injected.content?.[0]?.text).toBe(IDLE_DIRECTIVE_TEXT)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
  })

  test("EVERY tool is denied with the one line — read, bash, write, mail, claim alike", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    fx.step(worker, 1)
    for (const name of DENIED_TOOLS) expect(fx.toolAnswer(worker.id, name)).toBe(IDLE_DENIAL_TEXT)
  })

  test("a session that is in no live team is untouched, and no directive is injected", () => {
    /** The harness under test. */
    const fx = fixture(["sess-stranger"])
    /** A session no record names. */
    const stranger = fx.agent("sess-stranger")
    expect(fx.step(stranger, 1)).toBeUndefined()
    expect(fx.guard.isMarked(stranger.id)).toBe(false)
    expect(fx.toolAnswer(stranger.id, "read")).toBeUndefined()
  })
})

describe("§3.1/§6.4: an OPEN task keeps the member active", () => {
  for (const status of ["pending", "claimed", "in_progress"] as const) {
    test("a " + status + " task is open: not marked, tools allowed", () => {
      /** The harness under test. */
      const fx = fixture(["sess-worker"])
      /** The member handle. */
      const worker = fx.agent("sess-worker")
      seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }], task: { owner: "worker", status } })
      expect(fx.step(worker, 1)).toBeUndefined()
      expect(fx.guard.isMarked(worker.id)).toBe(false)
      expect(fx.toolAnswer(worker.id, "read")).toBeUndefined()
    })
  }
})

describe("§3.1/A4: only a TERMINAL task leaves the member idle", () => {
  for (const status of ["completed", "failed", "cancelled"] as const) {
    test("a " + status + "-only member IS marked and directed", () => {
      /** The harness under test. */
      const fx = fixture(["sess-worker"])
      /** The member handle. */
      const worker = fx.agent("sess-worker")
      seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }], task: { owner: "worker", status } })
      /** The pre-step answer. */
      const decision = fx.step(worker, 1)
      expect(decision?.messages?.length).toBe(1)
      expect(fx.guard.isMarked(worker.id)).toBe(true)
    })
  }
})

describe("A2: the mark is CLEARED by re-evaluation, the path a cellwork dispatch takes", () => {
  test("marked + a task assigned (delivered outside the board tools) + pre-step → cleared, tools allowed, no directive", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    /** The seeded record with no task. */
    const record = seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    // The spawn turn marks the member.
    expect(fx.step(worker, 1)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
    // The cellwork dispatch path delivers by executor message; the board gains the row and nothing in
    // team-core observes the send. The PRE-STEP must clear the mark, or the member can never claim.
    /** The record after the board gains the assigned row. */
    const assigned = addTeamTask(record, { subject: "next", description: "the next task", owner: "worker" }, NOW)
    writeTeam(fx.workspace, withDerivedPhase(assigned))
    expect(fx.step(worker, 2)).toBeUndefined()
    expect(fx.guard.isMarked(worker.id)).toBe(false)
    // The claim the member needs first is now allowed.
    expect(fx.toolAnswer(worker.id, "agent_teams_task")).toBeUndefined()
  })

  test("the clear is a re-evaluation, not a one-shot: a LATER terminal row re-marks", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    /** The record with an open task. */
    let record = seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }], task: { owner: "worker", status: "claimed" } })
    expect(fx.step(worker, 1)).toBeUndefined()
    // The member closes its row: the next turn finds nothing open again.
    record = updateTeamTask(record, record.tasks[0].id, { status: "completed" }, NOW)
    writeTeam(fx.workspace, withDerivedPhase(record))
    expect(fx.step(worker, 2)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
  })

  test("the owner may be spelled as the EXECUTOR HANDLE (settleMember's dual spelling)", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    /** The seeded record whose task owner is the handle, not the display name. */
    const record = seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }], task: { owner: "worker", status: "pending", ownerSpelling: "handle" } })
    expect(memberHasOpenTask(record, worker.id)).toBe(true)
    expect(fx.step(worker, 1)).toBeUndefined()
    expect(fx.guard.isMarked(worker.id)).toBe(false)
  })
})

describe("exemptions are EXPLICIT, never a name prefix", () => {
  test("the Lead is not marked even when a member row carries its handle", () => {
    /** The harness under test. */
    const fx = fixture(["sess-lead"])
    /** The Lead's handle, recorded as a member row on purpose. */
    const lead = fx.agent("sess-lead")
    seedTeam(fx, { lead: lead.id, members: [{ name: "lead-as-member", session: lead.id }] })
    expect(fx.step(lead, 1)).toBeUndefined()
    expect(fx.guard.isMarked(lead.id)).toBe(false)
  })

  test("a registered control seat keeps its tools; releasing the exemption re-marks it", () => {
    /** The harness under test. */
    const fx = fixture(["sess-dispatcher"])
    /** The dispatcher handle. */
    const dispatcher = fx.agent("sess-dispatcher")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "cell-dispatcher", session: dispatcher.id }] })
    /** The release the registration returned. */
    const release = fx.guard.registerControlSeat(dispatcher.id)
    expect(fx.step(dispatcher, 1)).toBeUndefined()
    expect(fx.guard.isMarked(dispatcher.id)).toBe(false)
    expect(fx.toolAnswer(dispatcher.id, "cellwork_dispatch")).toBeUndefined()
    release()
    expect(fx.step(dispatcher, 2)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(dispatcher.id)).toBe(true)
  })

  test("an UNREGISTERED `cell-*` name is NOT exempt (no name-prefix inheritance)", () => {
    /** The harness under test. */
    const fx = fixture(["sess-impostor"])
    /** A member whose name looks like a control seat but was never registered. */
    const impostor = fx.agent("sess-impostor")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "cell-dispatcher", session: impostor.id }] })
    expect(fx.step(impostor, 1)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(impostor.id)).toBe(true)
  })
})

describe("a terminal team never marks, and clears an existing mark", () => {
  test("the same member marked under a live team is released when the record ends", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    /** The seeded live record. */
    const record = seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    expect(fx.step(worker, 1)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
    writeTeam(fx.workspace, { ...record, phase: "ended" })
    expect(fx.step(worker, 2)).toBeUndefined()
    expect(fx.guard.isMarked(worker.id)).toBe(false)
    expect(fx.toolAnswer(worker.id, "read")).toBeUndefined()
  })
})

describe("the one-directive rule and the lifecycle route", () => {
  test("one directive per TURN; a second step in the same turn is silent; a new turn gets one", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    expect(fx.step(worker, 7)?.messages?.length).toBe(1)
    expect(fx.step(worker, 7)).toBeUndefined()
    expect(fx.step(worker, 8)?.messages?.length).toBe(1)
  })

  test("a member raised AFTER install is armed by `agent/created`, and `agent/disposed` releases it", () => {
    /** The harness under test with no live agent at install. */
    const fx = fixture()
    /** The member handle raised later. */
    const late = fx.agent("sess-late")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "late", session: late.id }] })
    expect(fx.listeners.has(late)).toBe(false)
    fx.emit("agent/created", { agent: late })
    expect(fx.listeners.has(late)).toBe(true)
    expect(fx.step(late, 1)?.messages?.length).toBe(1)
    fx.emit("agent/disposed", { agent: late })
    expect(fx.listeners.has(late)).toBe(false)
    expect(fx.guard.isMarked(late.id)).toBe(false)
  })
})

describe("the pure helpers the arms build on", () => {
  test("memberForSession matches `executorRef` only, and memberHasOpenTask reads both owner spellings", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    /** The seeded record with a pending task owned by the display name. */
    const record = seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }], task: { owner: "worker", status: "pending" } })
    expect(memberForSession(record, worker.id)?.name).toBe("worker")
    expect(memberForSession(record, "sess-unknown")).toBeUndefined()
    expect(memberHasOpenTask(record, worker.id)).toBe(true)
    expect(memberHasOpenTask(record, "sess-unknown")).toBe(false)
  })

  test("a member whose only task belongs to SOMEONE ELSE is idle", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }, { name: "other", session: "sess-other" }], task: { owner: "other", status: "in_progress" } })
    expect(fx.step(worker, 1)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
  })
})

describe("D2 (CodeRabbit #81): the dispatch window", () => {
  test("a window keeps a taskless member unmarked and undefended until it is released", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    /** The release the dispatch pass would hold around its send + claim write. */
    const release = fx.guard.beginDispatch(worker.id)
    expect(fx.step(worker, 1)).toBeUndefined()
    expect(fx.guard.isMarked(worker.id)).toBe(false)
    expect(fx.toolAnswer(worker.id, "agent_teams_task")).toBeUndefined()
    // The window is MOMENTARY: with no task on the board, the next step marks again.
    release()
    expect(fx.step(worker, 2)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
  })

  test("overlapping windows are counted: one release does not close the other", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    /** The first window. */
    const first = fx.guard.beginDispatch(worker.id)
    /** The second window for the SAME session. */
    const second = fx.guard.beginDispatch(worker.id)
    first()
    first()
    // A double release must not steal the second window.
    expect(fx.step(worker, 1)).toBeUndefined()
    expect(fx.guard.isMarked(worker.id)).toBe(false)
    second()
    expect(fx.step(worker, 2)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
  })

  test("a member marked BEFORE the window opens is cleared by the step inside it", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    expect(fx.step(worker, 1)?.messages?.length).toBe(1)
    expect(fx.guard.isMarked(worker.id)).toBe(true)
    /** The window a dispatch pass opens before its send. */
    const release = fx.guard.beginDispatch(worker.id)
    expect(fx.step(worker, 2)).toBeUndefined()
    expect(fx.guard.isMarked(worker.id)).toBe(false)
    expect(fx.toolAnswer(worker.id, "agent_teams_task")).toBeUndefined()
    release()
  })
})

describe("D3 (CodeRabbit #81): the downstream decision is preserved", () => {
  test("a `reject` stays a reject and no directive is injected into a refused step", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    /** The downstream decision the loop had already refused. */
    const refused = { kind: "reject" }
    /** The listener's answer. */
    const answer = fx.step(worker, 1, refused)
    // The SAME object: converting it to `enter` would run a step the harness refused.
    expect(answer).toBe(refused)
    expect(answer?.messages).toBeUndefined()
    // The mark still stands — the step was not run, but the session is still idle.
    expect(fx.guard.isMarked(worker.id)).toBe(true)
  })

  test("a decision with no `kind` still becomes an enter carrying the directive", () => {
    /** The harness under test. */
    const fx = fixture(["sess-worker"])
    /** The member handle. */
    const worker = fx.agent("sess-worker")
    seedTeam(fx, { lead: "sess-lead", members: [{ name: "worker", session: worker.id }] })
    /** The listener's answer for a decision the harness left kind-less. */
    const answer = fx.step(worker, 1, { messages: [{ id: "carried" }] })
    expect(answer?.kind).toBe("enter")
    expect(answer?.messages?.length).toBe(2)
  })
})

describe("D5 (CodeRabbit #81): a throwing tool-guard install", () => {
  test("installation does not throw, the warning names the tool guard, and the guard stays usable", () => {
    /** The warning lines the install produced. */
    const warnings: string[] = []
    /** The seams: everything works EXCEPT the tools registry, whose guard() throws. */
    const dsh: IdleGuardSeams = {
      liveAgents: (): readonly DshLiveAgent[] => [],
      registerAgentPreStep: (): (() => void) => () => {},
      onEvent: (): (() => void) => () => {},
      guardTool: (): (() => void) => { throw new Error("the tools service is absent") },
      workspaceRoot: (): string => "/nonexistent",
      rowLog: (line: string): void => { warnings.push(line) },
    }
    /** The install outcome, which must not throw out of the row's apply. */
    let installed: ReturnType<typeof installIdleGuard> | undefined
    expect(() => { installed = installIdleGuard(dsh) }).not.toThrow()
    expect(warnings.some((line) => line.includes("could not install its tool guard"))).toBe(true)
    // A clean degradation: the state is still published and reportable.
    expect(installed?.marked).toBeDefined()
    expect(installed?.isMarked("anything")).toBe(false)
  })
})
