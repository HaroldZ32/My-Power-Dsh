import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { addTeamMember, addTeamTask, bindActiveTeam, createTeam, endTeamRecord, readTeam, updateTeamMember, updateTeamTask, writeTeam, type TaskStatus } from "../src/team-store"
import { readMailbox, send } from "../src/mailbox-store"
import { decideWake, readWakeHistory, readWakeMatch } from "../src/captain-wake-store"

/** The tool executor as registered by the production row. */
interface Tool {
  /** Adapter-facing tool name. */
  readonly name: string
  /** Public argument path, with the fixture agent wired into the call context. */
  readonly execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** An explicit state from the public result, without casting away the receipt boundary. */
function registration(value: unknown): { readonly id: string; readonly state: string } {
  if (typeof value !== "object" || value === null || !("registration" in value)) throw new Error("missing registration")
  /** The action's structured result. */
  const row = value.registration
  if (typeof row !== "object" || row === null || !("id" in row) || !("state" in row) || typeof row.id !== "string" || typeof row.state !== "string") throw new Error("invalid registration")
  return { id: row.id, state: row.state }
}

/** Let the one coalesced feed window and scheduled callback run without model polling. */
async function settle(): Promise<void> {
  await Bun.sleep(60)
}

/** Mount a real Team row on an isolated durable board with a controlled host turn seam. */
function fixture(): {
  workspace: string
  captain: { id: string; status: string; session: { id: string; header: { cwd: string } } }
  submitted: unknown[]
  tool: (wake: unknown, signal?: AbortSignal) => Promise<unknown>
  call: (name: string, args: unknown, member?: boolean, signal?: AbortSignal) => Promise<unknown>
  steer: (kind: string, options?: { target?: "step" | "turn"; other?: boolean }) => void
  concluded: () => number
  listeners: () => number
  closeTask: (id: string, status: TaskStatus, at?: Date) => void
  closeTeam: (at: Date, reason: string) => void
  injectMail: (at: Date, otherTeam?: boolean) => void
  idle: () => void
  detach: () => void
  mount: () => void
  configure: (state: { accepted?: boolean; supported?: boolean; captainSupported?: boolean }) => void
  cleanup: () => void
} {
  /** Everything the case writes is isolated from the checkout. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-captain-wake-"))
  /** Switch global and exact next-turn support independently. */
  const host = { accepted: true, supported: true, captainSupported: true }
  /** Host hook presence is the adapter's exact-agent capability predicate. */
  const followup = (): void => {}
  /** The two pending host inbox destinations, exposed without consuming entries. */
  const inbox: { nextStep: unknown[]; nextTurn: unknown[] } = { nextStep: [], nextTurn: [] }
  /** The original captain and one addressable team member live in the same workspace. */
  const captain = { id: "captain", status: "running", inbox, session: { id: "captain", header: { cwd: workspace } },
    /** Existence of the captain's native submission hook can differ from another agent's. */
    get followup(): (() => void) | undefined { return host.supported && host.captainSupported ? followup : undefined } }
  /** The member's supported next-turn seam must never be mistaken for the captain's. */
  const member = { id: "member", status: "idle", followup, session: { id: "member", header: { cwd: workspace, origin: "subagent" } } }
  /** The production row supplies the tools and event listeners to this fixture. */
  const tools = new Map<string, Tool>()
  /** Host events and teardown follow the installed listeners. */
  const listeners = new Map<string, Set<(payload: unknown) => unknown>>()
  /** The host counts a conclusion requested on a queued next-turn follow-up. */
  let concluded = 0
  /** Emit one scoped event using the registry's original host agent object. */
  const emit = (event: string, payload: unknown): void => { for (const listener of listeners.get(event) ?? []) listener(payload) }
  /** Accepted attempts observed at the host boundary. */
  const submitted: unknown[] = []
  /** The current row's disposer. */
  let dispose = (): void => {}
  /** The real row exercises only these adapter members in the wake case. */
  const dsh = {
    registerTool: (tool: Tool): (() => void) => { tools.set(tool.name, tool); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    liveAgents: (): unknown[] => [captain, member],
    liveAgentExact: (id: string): unknown => id === captain.id ? captain : id === member.id ? member : undefined,
    capabilities: (): { turnSubmit: boolean } => ({ turnSubmit: host.supported }),
    onEvent: (event: string, handler: (payload: unknown) => unknown): (() => void) => {
      /** A single event can have multiple independent consumers. */
      const eventListeners = listeners.get(event) ?? new Set<(payload: unknown) => unknown>()
      eventListeners.add(handler)
      listeners.set(event, eventListeners)
      return () => { eventListeners.delete(handler) }
    },
    submitUserTurn: (target: unknown, message: unknown): boolean => {
      if (target !== captain) throw new Error("wrong agent")
      if (host.accepted) submitted.push(message)
      return host.accepted
    },
    teamMembership: (): undefined => undefined,
  }
  /** Mount this fixture without clearing its original session or durable state. */
  const mount = (): void => {
    apply({ get: (name: string): unknown => name === "mpdDsh" ? dsh : undefined, on: (name: string, fn: () => void): void => { if (name === "dispose") dispose = fn } })
  }
  mount()
  /** Three pending tasks and an addressable member on one Team record. */
  let team = createTeam(workspace, { name: "Wake", description: "Fixture", leadSessionId: captain.id }, new Date())
  for (const subject of ["One", "Two", "Unrelated"]) team = addTeamTask(team, { subject, description: "d" }, new Date())
  team = addTeamMember(team, { name: "Reader", description: "fixture" }, new Date())
  team = updateTeamMember(team, "M1", { executorRef: member.id })
  writeTeam(workspace, team)
  bindActiveTeam(workspace, captain.id, team.teamId)
  /** Call a tool through its actual team row registration. */
  const call = async (name: string, args: unknown, asMember: boolean = false, signal?: AbortSignal): Promise<unknown> => {
    /** Its registration is required for the case, even on a row reload. */
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`missing tool ${name}`)
    return tool.execute(args, { agent: asMember ? member : captain, signal, concludeTurn: () => { concluded += 1 } })
  }
  return {
    workspace, captain, submitted, mount, call,
    tool: (wake: unknown, signal?: AbortSignal): Promise<unknown> => call("agent_teams_control", { action: "wake", wake }, false, signal),
    steer: (kind, options): void => {
      /** Only an event for the exact captain comes with a pending input on this inbox. */
      const message = { role: "user", source: { kind } }
      if (options?.other !== true) (options?.target === "turn" ? inbox.nextTurn : inbox.nextStep).push(message)
      emit("agent/inbox/inserted", { agent: options?.other === true ? member : captain, message })
    },
    concluded: (): number => concluded,
    listeners: (): number => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    closeTask: (id: string, status: TaskStatus, at: Date = new Date()): void => {
      /** Re-read the board so consecutive commits do not overwrite one another. */
      const fresh = readTeam(workspace, team.teamId)
      if (fresh === undefined) throw new Error("missing team")
      writeTeam(workspace, updateTeamTask(fresh, id, { status }, at))
    },
    closeTeam: (at, reason): void => { endTeamRecord(workspace, team.teamId, reason, at) },
    injectMail: (at, otherTeam = false): void => {
      /** A direct store producer writes only canonical fixture mail, outside the Team tool hook. */
      const result = send(workspace, { teamId: otherTeam ? "foreign-team" : team.teamId,
        fromId: member.id, fromMemberId: "M1", fromName: "Reader", toId: captain.id, toName: "captain",
        memberIds: ["M1"], leadIds: [captain.id], subject: "Fixture", body: "Fixture" }, at)
      if (!result.ok) throw new Error(result.detail)
    },
    idle: (): void => {
      captain.status = "idle"
      for (const _event of [1, 2]) emit("agent/status", { agent: captain })
    },
    configure: (state): void => { Object.assign(host, state) },
    detach: (): void => { dispose() },
    cleanup: (): void => { dispose(); rmSync(workspace, { recursive: true, force: true }) },
  }
}

/** A grouped join wakes only after the exact targets settle and the captain yields. */
test("terminal group coalesces busy and duplicate events into one accepted follow-up", async () => {
  /** The registered Team tool and the host boundary it drives. */
  const f = fixture()
  try {
    /** The ID returned before any terminal work. */
    const armed = registration(await f.tool({ action: "arm", task_ids: ["T1", "T2"] }))
    expect(armed.state).toBe("waiting")
    expect(registration(await f.tool({ action: "arm", task_ids: ["T2", "T1", "T1"] })).id).toBe(armed.id)
    f.closeTask("T3", "completed")
    f.closeTask("T1", "failed")
    await settle()
    expect(registration(await f.tool({ action: "status", id: armed.id })).state).toBe("waiting")
    expect(f.submitted).toEqual([])
    f.closeTask("T2", "cancelled")
    await settle()
    expect(await f.tool({ action: "status", id: armed.id })).toMatchObject({ registration: { state: "ready", match: { tasks: { T1: "failed", T2: "cancelled" } } } })
    expect(f.submitted).toEqual([])
    f.idle()
    await settle()
    expect(f.submitted).toHaveLength(1)
    expect(f.submitted[0]).toMatchObject({ source: { kind: "mpd-team-wake", wakeId: armed.id } })
    expect(registration(await f.tool({ action: "status", id: armed.id })).state).toBe("submitted")
  } finally { f.cleanup() }
})

/** Cancellation wins before reservation; already-true conditions need no second turn. */
test("cancelled and already-satisfied registrations never submit", async () => {
  /** A normal active Team stands behind every call. */
  const f = fixture()
  try {
    /** An arm which would have matched any selected terminal task. */
    const armed = registration(await f.tool({ action: "arm", mode: "any", task_ids: ["T1", "T2"] }))
    await expect(f.call("agent_teams_control", { action: "wake", wake: { action: "cancel", id: armed.id } }, true)).rejects.toThrow("captain")
    expect(registration(await f.tool({ action: "cancel", id: armed.id })).state).toBe("cancelled")
    f.closeTask("T1", "failed")
    expect(registration(await f.tool({ action: "arm", mode: "any", task_ids: ["T1", "T2"] })).state).toBe("satisfied")
    f.idle()
    await settle()
    expect(f.submitted).toEqual([])
  } finally { f.cleanup() }
})

/** Reopen reconciles on-disk terminal data without needing the missed filesystem event. */
test("restart resumes an open wait and never retries an ambiguous submission", async () => {
  /** The same captain session is reopened across independent row mounts. */
  const f = fixture()
  try {
    /** The durable arm that survives row disposal. */
    const armed = registration(await f.tool({ action: "arm", task_ids: ["T1"] }))
    f.detach()
    f.closeTask("T1", "completed")
    f.idle()
    f.mount()
    await settle()
    expect(registration(await f.tool({ action: "status", id: armed.id })).state).toBe("submitted")
    /** Simulate interruption after the exclusive reservation and before the host receipt. */
    const second = registration(await f.tool({ action: "arm", task_ids: ["T2"] }))
    /** Persist only the reservation, in the same files the controller checks on reopen. */
    const scope = { workspace: f.workspace, sessionId: f.captain.session.id }
    /** The exact newly written wait. */
    const [record] = readWakeHistory(scope, 1)
    expect(decideWake(scope, record, { kind: "submit", match: { tasks: { T2: "completed" } } })).toBe(true)
    f.detach()
    f.mount()
    f.closeTask("T2", "completed")
    await settle()
    expect(registration(await f.tool({ action: "status", id: second.id })).state).toBe("delivery-unknown")
    expect(f.submitted).toHaveLength(1)
  } finally { f.cleanup() }
})

/** The host's lack of submission capability and an actual refused follow-up are distinct. */
test("reports unsupported arm and refused delivery without counting acceptance", async () => {
  /** A host can decline delivery after successfully admitting the wait. */
  const f = fixture()
  try {
    f.configure({ supported: false })
    await expect(f.tool({ action: "arm", task_ids: ["T1"] })).rejects.toThrow("unsupported")
    expect(await f.tool({ action: "status" })).toEqual({ registrations: [] })
    f.configure({ supported: true, accepted: false })
    /** The registered wake races no other waiter. */
    const armed = registration(await f.tool({ action: "arm", task_ids: ["T1"] }))
    f.idle()
    f.closeTask("T1", "completed")
    await settle()
    expect(await f.tool({ action: "status", id: armed.id })).toMatchObject({ registration: { state: "failed", reason: "the host refused the captain follow-up" } })
    expect(f.submitted).toEqual([])
  } finally { f.cleanup() }
})

/** A Team mail send is committed before it wakes a captain; text stays in the inbox. */
test("mail wake filters by sender and delivers a neutral notice", async () => {
  /** The canonical captain mailbox and member sender on the same Team. */
  const f = fixture()
  try {
    /** The wait selects the first mail from roster member M1. */
    const armed = registration(await f.tool({ action: "arm", event: "mail", from_member: "M1" }))
    f.idle()
    /** A self-addressed message cannot satisfy the requested sender. */
    await f.call("agent_teams_mail", { action: "send", to: "captain", subject: "self", body: "irrelevant" })
    await settle()
    expect(f.submitted).toEqual([])
    await f.call("agent_teams_mail", { action: "send", to: "captain", subject: "UNTRUSTED_SUBJECT", body: "UNTRUSTED_BODY" }, true)
    await settle()
    expect(f.submitted).toHaveLength(1)
    expect(JSON.stringify(f.submitted[0])).not.toContain("UNTRUSTED_")
    expect(await f.tool({ action: "status", id: armed.id })).toMatchObject({ registration: { state: "submitted", match: { messageId: expect.any(String) } } })
  } finally { f.cleanup() }
})

/** Committed task outcomes survive close, and events committed later cannot satisfy the wait. */
test.each(["all", "any"] as const)("wake close boundary preserves a pre-close %s task match", async (mode) => {
  /** The target returns even if the auto-end has already committed before the next feed batch. */
  const f = fixture()
  try {
    /** A pending terminal join observes only its chosen tasks. */
    const armed = registration(await f.tool({ action: "arm", mode, task_ids: ["T1", "T2"] }))
    /** Use distinct persisted timestamps, without depending on millisecond timer ordering. */
    const end = Date.now()
    f.closeTask("T1", "failed", new Date(end - 1))
    f.closeTask("T2", "cancelled", new Date(mode === "all" ? end : end + 1))
    f.closeTeam(new Date(end), "clean-terminal auto-end")
    f.idle()
    await settle()
    expect(f.submitted).toHaveLength(1)
    expect(await f.tool({ action: "status", id: armed.id })).toMatchObject({ registration: {
      state: "submitted", match: { tasks: mode === "all" ? { T1: "failed", T2: "cancelled" } : { T1: "failed" } },
    } })
  } finally { f.cleanup() }
})

/** Closing the team before the predicate holds must keep later work and mail from waking it. */
test.each(["tasks", "mail"] as const)("wake close boundary excludes post-close %s", async (event) => {
  /** Writes bypass the public live-team checks, as a cross-process producer could. */
  const f = fixture()
  try {
    /** The registered condition has seen nothing before close. */
    const armed = registration(await f.tool({ action: "arm", ...(event === "tasks" ? { task_ids: ["T1"] } : { event }) }))
    /** The foreign and late records share the same captain address but cannot satisfy the wait. */
    const end = Date.now()
    f.injectMail(new Date(end - 1), true)
    f.closeTeam(new Date(end), "explicit close before matching")
    if (event === "tasks") f.closeTask("T1", "completed", new Date(end + 1))
    else f.injectMail(new Date(end + 1))
    f.idle()
    await settle()
    expect(f.submitted).toEqual([])
    expect(await f.tool({ action: "status", id: armed.id })).toMatchObject({ registration: { state: "failed", reason: expect.stringContaining("ended before") } })
  } finally { f.cleanup() }
})

/** A different live agent advertising follow-up cannot stand in for the captain. */
test("wake arm requires exact captain follow-up and a known status", async () => {
  /** The global flag stays true because the other live agent can receive next-turn work. */
  const f = fixture()
  try {
    f.configure({ captainSupported: false })
    await expect(f.tool({ action: "arm", task_ids: ["T1"] })).rejects.toThrow("unsupported")
    f.configure({ captainSupported: true })
    f.captain.status = "unknown"
    await expect(f.tool({ action: "arm", task_ids: ["T1"] })).rejects.toThrow("unsupported")
    expect(await f.tool({ action: "status" })).toEqual({ registrations: [] })
  } finally { f.cleanup() }
})

/** A ready fact observed on the open team survives reload and a tied close timestamp. */
test("an already-recorded mail match survives close and restart", async () => {
  /** The matching mail is committed through the ordinary Team tool. */
  const f = fixture()
  try {
    /** The captain remains busy while the matching mail arrives. */
    const armed = registration(await f.tool({ action: "arm", event: "mail" }))
    await f.call("agent_teams_mail", { action: "send", to: "captain", subject: "sent", body: "matched" }, true)
    await settle()
    /** The original scope and persisted registration prove readiness without a submission. */
    const scope = { workspace: f.workspace, sessionId: f.captain.session.id }
    /** A close written in the same millisecond should still honor this observed fact. */
    const [record] = readWakeHistory(scope, 1)
    /** The mail receipt's persisted creation time and identity. */
    const [message] = readMailbox(f.workspace).messages
    if (message === undefined) throw new Error("expected Team mail")
    expect(readWakeMatch(scope, record)).toEqual({ messageId: message.id })
    expect(f.submitted).toEqual([])
    f.closeTeam(new Date(message.sentAt), "closed after the match was recorded")
    f.detach()
    f.idle()
    f.mount()
    await settle()
    expect(f.submitted).toHaveLength(1)
    expect(await f.tool({ action: "status", id: armed.id })).toMatchObject({ registration: { state: "submitted", match: { messageId: message.id } } })
  } finally { f.cleanup() }
})

/** An in-flight wait reads a committed predicate once, without injecting another turn. */
test("in-turn wait ignores unrelated Team and inbox events and resolves once on the join", async () => {
  /** The fixture drives the real registered tool and the original captain's host state. */
  const f = fixture()
  try {
    /** An abandoned promise is always released by fixture disposal. */
    const caller = new AbortController()
    /** Keep rejection observable during the deliberately quiet window. */
    let value: unknown
    /** Observe the original tool result without a second prompt. */
    const waiting = f.tool({ action: "wait", task_ids: ["T1", "T2"] }, caller.signal)
      .then((answer) => { value = answer }, (error: unknown) => { value = error })
    f.closeTask("T3", "completed")
    f.closeTask("T1", "failed")
    f.steer("goal", { target: "turn" })
    f.steer("user", { other: true })
    await settle()
    expect(value).toBeUndefined()
    expect(f.submitted).toEqual([])
    f.closeTask("T2", "cancelled")
    await waiting
    expect(value).toMatchObject({ wait: { state: "matched", match: { tasks: { T1: "failed", T2: "cancelled" } } } })
    expect(await f.tool({ action: "status" })).toEqual({ registrations: [] })
    expect(f.submitted).toEqual([])
  } finally { f.cleanup() }
})

/** Next-step steering and next-turn human follow-ups both open the parked tool. */
test.each(["step", "turn"] as const)("in-turn wait releases for exact human input queued for the next %s", async (target) => {
  /** A running captain has a valid host inbox and an abortable tool call. */
  const f = fixture()
  try {
    /** Keep the host events available until the wait is established. */
    const caller = new AbortController()
    /** The number of listeners the permanent Team row installed. */
    const count = f.listeners()
    /** Hold the return of this exact tool, not a future registration. */
    const waiting = f.tool({ action: "wait", task_ids: ["T1"] }, caller.signal)
    f.steer("user", { target })
    expect(await waiting).toMatchObject({ wait: { state: "steered" } })
    expect(f.concluded()).toBe(target === "turn" ? 1 : 0)
    expect(f.listeners()).toBe(count)
    expect(f.submitted).toEqual([])
  } finally { f.cleanup() }
})

/** Abort, plugin disposal and unsupported synchronous calls are observable boundaries. */
test("in-turn wait has clean abort, disposal and unsupported results", async () => {
  /** This fixture counts live host event listeners to catch failed setup leaks. */
  const f = fixture()
  try {
    /** The ordinary row's listeners are the baseline before any wait. */
    const before = f.listeners()
    expect(await f.tool({ action: "wait", task_ids: ["T1"] })).toMatchObject({ wait: { state: "unsupported" } })
    /** Use one signal per tool call. */
    const first = new AbortController()
    await expect(f.tool({ action: "wait", task_ids: ["nowhere"] }, first.signal)).rejects.toThrow("task_ids")
    expect(f.listeners()).toBe(before)
    /** A second wait is rejected without disturbing the first call's listeners. */
    const waiting = f.tool({ action: "wait", task_ids: ["T1"] }, first.signal)
    await expect(f.tool({ action: "wait", task_ids: ["T2"] }, first.signal)).rejects.toThrow("pending in-turn")
    await expect(f.tool({ action: "arm", task_ids: ["T2"] })).rejects.toThrow("pending in-turn")
    first.abort()
    expect(await waiting).toMatchObject({ wait: { state: "cancelled" } })
    expect(f.listeners()).toBe(before)
    /** A fresh wait should settle immediately when its row is unloaded. */
    const second = new AbortController()
    /** The reply resolves through the same tool call during plugin unload. */
    const closing = f.tool({ action: "wait", task_ids: ["T1"] }, second.signal)
    f.detach()
    expect(await closing).toMatchObject({ wait: { state: "disposed" } })
    expect(f.listeners()).toBe(0)
  } finally { f.cleanup() }
})

/** An arm must be cancelled before the captain opts into an in-turn wait. */
test("in-turn wait refuses pending arm and immediately matches a settled task", async () => {
  /** Both wait styles bind the same original captain. */
  const f = fixture()
  try {
    /** The already registered durable watch must not post a duplicate turn. */
    const armed = registration(await f.tool({ action: "arm", task_ids: ["T1"] }))
    /** Normal host execution proves that a tool call may wait. */
    const caller = new AbortController()
    await expect(f.tool({ action: "wait", task_ids: ["T1"] }, caller.signal)).rejects.toThrow(armed.id)
    await f.tool({ action: "cancel", id: armed.id })
    f.closeTask("T1", "completed")
    expect(await f.tool({ action: "wait", task_ids: ["T1"] }, caller.signal)).toMatchObject({ wait: { state: "matched" } })
    expect(f.submitted).toEqual([])
  } finally { f.cleanup() }
})
