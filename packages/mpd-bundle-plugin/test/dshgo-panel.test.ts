// THE LIVE DSH GO PANEL, proven without a phone: `.mpd/plans/mpd-drive-surface.md` §4.4 task E.
//
// WHAT A UNIT TEST CAN AND CANNOT PROVE HERE. The Flutter app is not in this workspace, so nothing
// below renders a pixel: the view tree is checked against the PROTOCOL v1 shape (the component
// catalog, the panel budget walk, the action-id pattern and the `actions` item shape taken from the
// upstream `sdk/plugin-kit/schema/view.schema.json`), the snapshot against the narrowing rules, and
// the taps against the three service doubles. A real device install stays the user's check.
//
// THE ONE ASSERTION THAT CATCHES A DEAD PANEL is the binding walk: every `{"$": "data.…"}` path the
// view carries is resolved against the snapshot the data function actually emitted. A view that binds
// a field the snapshot does not have renders an em dash on the device and nothing fails, so it is
// pinned here instead.
//
// The harness is deliberately MINIMAL: the adapter double exposes only the four DSH Go members the
// panel drives (plus the session-to-workspace lookup, supplied through the registration's own
// `workspace` seam), and the ctx double only ever answers `get(name, false)`. Nothing here imports
// `dist/`, so the case exercises the source under review rather than the last build.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index.ts"
import {
  DSHGO_MAX_OPTIONS,
  DSHGO_MAX_READY_ROWS,
  DSHGO_MAX_SNAPSHOT_BYTES,
  DSHGO_PANEL_ID,
  buildPanelView,
  readPanelSnapshot,
  registerDshGoPanel,
} from "../src/dshgo-panel.ts"
import type { PanelBridge, PanelScope, PanelServices, PanelSnapshot, PanelSpec } from "../src/dshgo-panel.ts"

/** The v1 component catalog: the ONLY node types a v1 view may carry (protocol v1 §components). */
const V1_COMPONENTS = new Set([
  "stack", "row", "text", "metric", "chart", "compare", "steps", "callout",
  "options", "confirm", "list", "keyValue", "progress", "table", "actions", "image",
])

/** The panel budget the app enforces: bytes, nodes, nesting depth and children per node. */
const PANEL_BUDGET = { maxBytes: 32768, maxNodes: 120, maxDepth: 8, maxChildren: 32 } as const

/** The key names a snapshot must never carry at any depth: a path or a secret is never rendered. */
const FORBIDDEN_KEY = /path|dir|root|workspace|cwd|file|token|secret|credential/i

/** One team task the double answers with. */
interface FakeTask {
  /** The board id (`T1`, …). */
  id: string
  /** The task title the panel lists. */
  subject: string
  /** The stored status; `pending` is what the ready projection reads. */
  status: string
  /** The blockers, resolved against the same board. */
  blockedBy: string[]
  /** The task kind, shown in the row caption. */
  kind?: string
  /** The owning member's display name, when one is assigned. */
  owner?: string
}

/** One team member the double answers with. */
interface FakeMember {
  /** The member id. */
  id: string
  /** The member display name. */
  name: string
  /** The member status; a `failed` row must not be counted. */
  status: string
}

/** One team record the `mpdTeams` double answers with. */
interface FakeTeam {
  /** The team id. */
  teamId: string
  /** The team name. */
  name: string
  /** The stored activity phase. */
  phase: string
  /** The approval instant, absent before approval. */
  approvedAt?: string
  /** The end instant, absent while live. */
  endedAt?: string
  /** The roster. */
  members: FakeMember[]
  /** The board. */
  tasks: FakeTask[]
}

/** One staged plan the `mpdTeams` double answers with. */
interface FakePlan {
  /** The plan id. */
  planId: string
  /** Whether an approval already committed. */
  approved: boolean
  /** Whether it was discarded instead. */
  discarded: boolean
  /** The members it would raise. */
  members: Array<{ name: string }>
  /** The tasks it would post. */
  tasks: Array<{ subject: string }>
}

/** One parked question the relay double answers with, in the relay's own shape. */
interface FakeParked {
  /** The parked id `answer` takes. */
  id: string
  /** The session that asked. */
  sessionId: string
  /** The parking instant. */
  createdAt: number
  /** The question items, whose ids the answer batch must carry. */
  questions: Array<{ id: string; question: string; options?: Array<{ label: string }> }>
}

/** One answer batch the relay double recorded. */
interface FakeAnswerCall {
  /** The parked id the tap answered. */
  id: string
  /** The batch as submitted, so the item id and the label can both be asserted. */
  answers: Array<{ id: string; selected: string[] }>
}

/** Everything a case mutates and asserts on: the doubles' state plus the bridge's own record. */
interface FakeState {
  /** The team the registry answers for the scoped session, or null. */
  team: FakeTeam | null
  /** The staged plan the registry answers, or null. */
  plan: FakePlan | null
  /** The parking lot the relay double answers. */
  parked: FakeParked[]
  /** What `approve` resolves to (a team action result). */
  approveOutcome: unknown
  /** What `dispatch` resolves to. */
  dispatchOutcome: unknown
  /** What `answer` returns; `true` is the relay's success. */
  answerOutcome: unknown
  /** Whether `approve` throws instead of answering. */
  approveThrows: boolean
  /** Whether `dispatch` throws instead of answering. */
  dispatchThrows: boolean
  /** Whether the relay's `answer` throws instead of answering. */
  answerThrows: boolean
  /** Every approve session id the service received. */
  approveCalls: string[]
  /** Every dispatch session id the service received. */
  dispatchCalls: string[]
  /** Every answer batch the relay received. */
  answerCalls: FakeAnswerCall[]
  /** Every workspace root the registry was asked about, so the resolution order can be asserted. */
  workspacesSeen: string[]
}

/** The host double: the bridge, the registry and the handles a case drives them through. */
interface FakeHost {
  /** The adapter face the module drives. */
  dsh: PanelBridge
  /** The service registry face the module reads. */
  ctx: PanelServices
  /** The mutable state behind both faces. */
  state: FakeState
  /** Every panel the bridge accepted, in publication order. */
  panels: Array<{ id: string; spec: PanelSpec }>
  /** Every `refresh` the module asked for, in call order. */
  refreshes: string[]
  /** Every `onServiceBound` registration's watched names. */
  bound: string[][]
  /** Whether the bridge answers `dshGoPresent()` with true. */
  setPresent: (present: boolean) => void
  /** Bind the bridge and wake every parked service-bound listener, as the runtime would. */
  bindBridge: () => void
  /** Remove one service from the registry, modelling a composition that mounts only some rows. */
  removeService: (name: string) => void
}

/** A fresh state: one approved team with ready work, no staged plan, nothing parked. */
function fakeState(): FakeState {
  return {
    team: {
      teamId: "team-1",
      name: "Drive surface",
      phase: "active",
      approvedAt: "2026-11-02T00:00:00.000Z",
      members: [{ id: "M1", name: "Lead", status: "running" }, { id: "M2", name: "Worker", status: "inactive" }],
      tasks: [
        { id: "T1", subject: "Wire the panel", status: "in_progress", blockedBy: [], kind: "work", owner: "Worker" },
        { id: "T2", subject: "Prove the panel", status: "pending", blockedBy: ["T1"], kind: "work" },
        { id: "T3", subject: "Ship the panel", status: "pending", blockedBy: ["T0"], kind: "work" },
      ],
    },
    plan: null,
    parked: [],
    approveOutcome: { ok: true },
    dispatchOutcome: { ok: true },
    answerOutcome: true,
    approveThrows: false,
    dispatchThrows: false,
    answerThrows: false,
    approveCalls: [],
    dispatchCalls: [],
    answerCalls: [],
    workspacesSeen: [],
  }
}

/**
 * Build a host double.
 *
 * The bridge counts what the module published and nothing else; `setPresent`/`bindBridge` let a case
 * model both the "no bridge at all" profile and the "bridge binds after apply" race, which is the
 * behaviour the row's silence contract rests on.
 * @param initial - the state the doubles answer from; a fresh default when omitted.
 * @returns the bridge, the registry and the handles a case drives them with.
 */
function fakeHost(initial: FakeState = fakeState()): FakeHost {
  /** The mutable state every double closes over. */
  const state = initial
  /** The services the registry answers, keyed by id. */
  const services = new Map<string, unknown>()
  /** Whether the bridge is bound right now. */
  const record: FakeHost = {
    dsh: undefined as unknown as PanelBridge,
    ctx: undefined as unknown as PanelServices,
    state,
    panels: [],
    refreshes: [],
    bound: [],
    setPresent: (present: boolean): void => { presentNow = present },
    bindBridge: (): void => {
      presentNow = true
      for (const listener of listeners) listener.cb("dshGo")
    },
    removeService: (name: string): void => { services.delete(name) },
  }
  /** Whether `dshGoPresent()` answers true; flipped by a late bind. */
  let presentNow = false
  /** The parked service-bound listeners, as the runtime keeps them. */
  const listeners: Array<{ names: readonly string[]; cb: (name: string) => void }> = []
  services.set("mpdTeams", {
    active: (workspace: string, sessionId?: string): unknown => {
      state.workspacesSeen.push(workspace)
      return sessionId === "s1" ? state.team : undefined
    },
    planFor: (workspace: string, sessionId: string): unknown => ({ ok: true, workspace, sessionId, plan: state.plan }),
  })
  services.set("mpdTeamActions", {
    approve: async (input: { sessionId: string }): Promise<unknown> => {
      state.approveCalls.push(input.sessionId)
      if (state.approveThrows) throw new Error("the store is unreadable")
      return state.approveOutcome
    },
    dispatch: async (input: { sessionId: string }): Promise<unknown> => {
      state.dispatchCalls.push(input.sessionId)
      if (state.dispatchThrows) throw new Error("the executor is busy")
      return state.dispatchOutcome
    },
  })
  services.set("mpdQuestions", {
    list: (input: { sessionId?: string }): unknown => state.parked.filter((entry) => input.sessionId === undefined || entry.sessionId === input.sessionId),
    answer: (input: { id: string; answers: Array<{ id: string; selected: string[] }> }): unknown => {
      state.answerCalls.push({ id: input.id, answers: input.answers })
      if (state.answerThrows) throw new Error("the relay is gone")
      return state.answerOutcome
    },
  })
  record.ctx = {
    get: (name: string): unknown => services.get(name),
  }
  record.dsh = {
    dshGoPresent: (): boolean => presentNow,
    dshGoPanel: (id: string, spec: PanelSpec): boolean => {
      record.panels.push({ id, spec })
      return true
    },
    dshGoRefresh: (id: string): void => { record.refreshes.push(id) },
    onServiceBound: (names: readonly string[], callback: (name: string) => void): (() => void) => {
      record.bound.push([...names])
      /** The registered listener, removed when the caller releases it. */
      const entry = { names, cb: callback }
      listeners.push(entry)
      return (): void => {
        /** The listener's own position, so one release removes exactly one registration. */
        const at = listeners.indexOf(entry)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
  }
  return record
}

/** Install a fake interval clock, so a poll tick is a call rather than a two-second wait. */
interface FakeClock {
  /** The intervals created through the patch. */
  created: number
  /** The intervals cleared through the patch. */
  cleared: number
  /** The intervals that are still live. */
  live: number
  /** Run every live interval's callback once, as one poll period would. */
  tick: () => void
  /** Put the real timers back. */
  restore: () => void
}

/**
 * Replace `setInterval`/`clearInterval` for one case and count what the module owns.
 *
 * The cast is unavoidable and deliberate: `globalThis.setInterval` is typed as the real Node one, and
 * a stand-in that never fires cannot be described by that type. The patch is undone by
 * {@link FakeClock.restore}, which every case calls in `afterEach`.
 * @returns the counters plus the manual tick.
 */
function installFakeClock(): FakeClock {
  /** The real functions, put back by `restore`. */
  const real = { set: globalThis.setInterval, clear: globalThis.clearInterval }
  /** The live intervals, keyed by the handle the module holds. */
  const handles = new Map<number, () => void>()
  /** The next synthetic handle. */
  let next = 1
  /** The counters the cases assert on. */
  const clock: FakeClock = {
    created: 0,
    cleared: 0,
    /** The intervals still held: the leak assertion reads this, not the creation count. */
    get live(): number { return handles.size },
    tick: (): void => { for (const callback of [...handles.values()]) callback() },
    restore: (): void => {
      globalThis.setInterval = real.set
      globalThis.clearInterval = real.clear
    },
  }
  globalThis.setInterval = ((callback: () => void): number => {
    clock.created += 1
    handles.set(next, callback)
    return next++
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((handle: number): void => {
    if (handles.delete(handle)) clock.cleared += 1
  }) as unknown as typeof clearInterval
  return clock
}

/** The fake clock a case installs, restored after it even when the case throws. */
let clock: FakeClock | undefined
afterEach(() => {
  clock?.restore()
  clock = undefined
})

/** The log lines one registration wrote, captured instead of written to the row's file log. */
interface LogCapture {
  /** The sink to hand the registration. */
  log: (line: string) => void
  /** Every line the registration wrote, in order. */
  lines: string[]
}

/** A fresh log capture. */
function logCapture(): LogCapture {
  /** The captured lines, appended by the sink below. */
  const lines: string[] = []
  return { lines, log: (line: string): void => { lines.push(line) } }
}

/** The snapshot emitter one data subscription writes into. */
interface Emitter {
  /** The emit callback the module calls. */
  emit: (snapshot: PanelSnapshot) => void
  /** Every snapshot the module emitted, in order. */
  snapshots: PanelSnapshot[]
}

/** A fresh emitter. */
function emitter(): Emitter {
  /** The emitted snapshots, appended by the callback below. */
  const snapshots: PanelSnapshot[] = []
  return { snapshots, emit: (snapshot: PanelSnapshot): void => { snapshots.push(snapshot) } }
}

/** The data function of a published spec, typed for the test's calls. */
function dataOf(spec: PanelSpec): (scope: PanelScope, emit: (snapshot: PanelSnapshot) => void) => () => void {
  return spec.data as (scope: PanelScope, emit: (snapshot: PanelSnapshot) => void) => () => void
}

/** The view function of a published spec, typed for the test's calls. */
function viewOf(spec: PanelSpec): (scope: PanelScope) => Record<string, unknown> {
  return spec.view as (scope: PanelScope) => Record<string, unknown>
}

/** The actions map of a published spec, typed for the test's calls. */
function actionsOf(spec: PanelSpec): Record<string, (scope: unknown, event: unknown) => Promise<{ toast: string }>> {
  return spec.actions as Record<string, (scope: unknown, event: unknown) => Promise<{ toast: string }>>
}

/** One action button a view's `actions` node carries, in walk order. */
interface ViewActionButton {
  /** The button's label: a literal string, or a `$` binding node for an answer button. */
  label: unknown
  /** The action id the button reports on a tap. */
  action: string
}

/** Every action button a view tree carries, in walk order. */
function actionButtonsOf(view: unknown): ViewActionButton[] {
  /** The buttons collected so far. */
  const buttons: ViewActionButton[] = []
  walkNodes(view, 1, (node) => {
    if (node.type !== "actions") return
    for (const item of node.items as Array<{ label?: unknown; action?: string }>) buttons.push({ label: item.label, action: item.action ?? "" })
  })
  return buttons
}

/** The one panel a case registers, or a failure naming what went wrong instead. */
function onlyPanel(host: FakeHost): { id: string; spec: PanelSpec } {
  expect(host.panels).toHaveLength(1)
  return host.panels[0] as { id: string; spec: PanelSpec }
}

/** One node of a view tree, read structurally for the walks below. */
type ViewNode = Record<string, unknown>

/** Every child node an unknown value carries, flattened one level. */
function childNodesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

/** Walk a view tree, calling `visit` once per NODE (a `{type}` map) with its depth. */
function walkNodes(node: unknown, depth: number, visit: (node: ViewNode, depth: number) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkNodes(child, depth, visit)
    return
  }
  /** The value read as a plain record, or undefined when it is a scalar or binding. */
  const record = typeof node === "object" && node !== null ? (node as ViewNode) : undefined
  if (record === undefined) return
  if (typeof record.type === "string") visit(record, depth)
  for (const [key, value] of Object.entries(record)) {
    if (key === "type") continue
    if (key === "items" && record.type === "keyValue") continue
    if (key === "items" && record.type === "list") {
      // A bound `items` is a single binding node, not a list of nodes.
      walkNodes(value, depth + 1, visit)
      continue
    }
    if (key === "items" && record.type === "actions") continue
    walkNodes(childNodesOf(value), depth + 1, visit)
  }
}

/** Every `$` binding path a view tree carries, in walk order. */
function bindingPathsOf(view: unknown): string[] {
  /** The paths collected so far. */
  const paths: string[] = []
  /** Walk one value, collecting a path from every binding node. */
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry)
      return
    }
    /** The value read as a plain record. */
    const record = typeof value === "object" && value !== null ? (value as ViewNode) : undefined
    if (record === undefined) return
    if (typeof record.$ === "string") {
      paths.push(record.$)
      return
    }
    for (const entry of Object.values(record)) walk(entry)
  }
  walk(view)
  return paths
}

/** Resolve one `data.a.b.0.c` path against a snapshot, or undefined when any segment is missing. */
function resolveBinding(path: string, snapshot: PanelSnapshot): unknown {
  /** The path's segments, with the protocol's mandatory `data` root dropped. */
  const segments = path.split(".").slice(1)
  /** The value as the walk advances; undefined once a segment misses. */
  let current: unknown = snapshot
  for (const segment of segments) {
    if (Array.isArray(current)) {
      /** The array index this segment names. */
      const index = Number.parseInt(segment, 10)
      if (!Number.isFinite(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    /** The value read as a plain record for this step. */
    const record = typeof current === "object" && current !== null ? (current as Record<string, unknown>) : undefined
    if (record === undefined || !(segment in record)) return undefined
    current = record[segment]
  }
  return current
}

/** Collect every KEY name a value carries at any depth, so the narrowing assertion can walk it. */
function keysAtAnyDepth(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) keysAtAnyDepth(entry, out)
    return out
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out.push(key)
      keysAtAnyDepth(entry, out)
    }
  }
  return out
}

/** Collect every string a value carries at any depth, so a leaked path can be spotted. */
function stringsAtAnyDepth(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const entry of value) stringsAtAnyDepth(entry, out)
    return out
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value as Record<string, unknown>)) stringsAtAnyDepth(entry, out)
  }
  return out
}

/** One published, seeded subscription: what a case drives polling through. */
interface LivePanel {
  /** The host the panel was published on. */
  host: FakeHost
  /** The panel definition the bridge accepted. */
  spec: PanelSpec
  /** The app-side emitter. */
  emitter: Emitter
  /** The cancel function the data function returned. */
  cancel: () => void
  /** The registration's own report, for the dispose arm. */
  registration: ReturnType<typeof registerDshGoPanel>
}

/**
 * Publish the panel on a bridge-present host and subscribe its data function once.
 * @param state - the doubles' state; a fresh default when omitted.
 * @param sessionId - the scope the panel subscribes for.
 * @returns the live panel a case then mutates and ticks.
 */
function livePanel(state: FakeState = fakeState(), sessionId: string = "s1"): LivePanel {
  /** The host double, with the bridge already present. */
  const host = fakeHost(state)
  host.setPresent(true)
  /** The captured log lines, so a case can assert the boot token. */
  const capture = logCapture()
  /** The registration that published the panel. */
  const registration = registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: capture.log, workspace: () => "/ws", pollMs: 2000 })
  /** The one published panel. */
  const panel = onlyPanel(host)
  /** The app-side emitter. */
  const sink = emitter()
  /** The cancel function the first subscription returned. */
  const cancel = dataOf(panel.spec)({ sessionId }, sink.emit)
  return { host, spec: panel.spec, emitter: sink, cancel, registration }
}

/**
 * Publish the panel on a bridge-present host WITHOUT subscribing its data function.
 *
 * This is the order the module itself documents: the app fetches the view first and subscribes
 * afterwards, so a view built here proves the panel does not depend on a seeded push cache.
 * @param state - the doubles' state; a fresh default when omitted.
 * @returns the host and the panel definition, with no data subscription and no interval.
 */
function unseededPanel(state: FakeState = fakeState()): { host: FakeHost; spec: PanelSpec } {
  /** The host double, with the bridge already present. */
  const host = fakeHost(state)
  host.setPresent(true)
  registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: logCapture().log, workspace: () => "/ws", pollMs: 2000 })
  /** The one published panel. */
  const panel = onlyPanel(host)
  return { host, spec: panel.spec }
}

describe("registration is lazy and silent", () => {
  test("no bridge: nothing is published, one log token, no throw, one subscription", () => {
    /** A host with no DSH Go bridge at all. */
    const host = fakeHost()
    /** The captured log lines. */
    const capture = logCapture()
    expect(() => registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: capture.log, workspace: () => "/ws" })).not.toThrow()
    expect(host.panels).toHaveLength(0)
    expect(host.refreshes).toHaveLength(0)
    expect(capture.lines).toHaveLength(1)
    expect(capture.lines[0]).toContain("dshGo=absent")
    expect(host.bound).toHaveLength(1)
    expect(host.bound[0]).toEqual(["dshGo"])
  })

  test("a second attempt while absent does not repeat the log line", () => {
    /** A host with no bridge, and a registration that already gave up once. */
    const host = fakeHost()
    /** The captured log lines. */
    const capture = logCapture()
    registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: capture.log, workspace: () => "/ws" })
    /** The registration's late-bind subscription, woken twice by a double bind. */
    host.bindBridge()
    host.bindBridge()
    expect(host.panels).toHaveLength(1)
    // absent -> panel is ONE transition, so exactly two lines are written in total.
    expect(capture.lines.filter((line) => line.includes("dshGo=absent"))).toHaveLength(1)
    expect(capture.lines.filter((line) => line.includes("dshGo=panel"))).toHaveLength(1)
  })

  test("a late dshGo bind publishes the panel exactly once and uses the manifest id", () => {
    /** A host whose bridge binds only after apply. */
    const host = fakeHost()
    /** The captured log lines. */
    const capture = logCapture()
    /** The apply-time report, which must say the panel is not published YET. */
    const registration = registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: capture.log, workspace: () => "/ws" })
    expect(registration.registered).toBe(false)
    host.bindBridge()
    expect(registration.registered).toBe(false)
    expect(host.panels).toHaveLength(1)
    expect(host.panels[0]?.id).toBe(DSHGO_PANEL_ID)
    expect(host.panels[0]?.id).toBe("mpd")
    // Idempotent: a rebind of the same service must not publish a second panel.
    host.bindBridge()
    expect(host.panels).toHaveLength(1)
    registration.dispose()
  })

  test("a bridge that is present at apply publishes immediately", () => {
    /** A host with the bridge bound before apply. */
    const host = fakeHost()
    host.setPresent(true)
    /** The captured log lines. */
    const capture = logCapture()
    /** The apply-time report. */
    const registration = registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: capture.log, workspace: () => "/ws" })
    expect(registration.registered).toBe(true)
    expect(host.panels).toHaveLength(1)
    expect(capture.lines).toEqual(["[mpd] dshGo=panel"])
    registration.dispose()
  })
})

describe("the emitted snapshot is narrow, bounded and change-driven", () => {
  test("it carries exactly the four narrowed sections and no path-shaped key", () => {
    /** A live panel over the default team state. */
    const live = livePanel()
    /** The seeded snapshot, which is the first thing the app shows. */
    const snapshot = live.emitter.snapshots[0] as PanelSnapshot
    expect(Object.keys(snapshot).sort()).toEqual(["alert", "counts", "memory", "plan", "question", "readyTasks", "team", "workmates"])
    expect(snapshot.team).toEqual({ id: "team-1", name: "Drive surface", status: "approved", phase: "active", members: 2, tasks: 3 })
    expect(snapshot.plan).toBeNull()
    expect(snapshot.question).toBeNull()
    for (const key of keysAtAnyDepth(snapshot)) expect(FORBIDDEN_KEY.test(key)).toBe(false)
    for (const text of stringsAtAnyDepth(snapshot)) {
      expect(text).not.toContain("/ws")
      expect(text).not.toContain(".mpd")
      expect(text).not.toContain("\\")
    }
    live.cancel()
  })

  test("T2 is not ready (T1 runs) and T3 is ready (its blocker names nothing)", () => {
    /** A live panel over the default board. */
    const live = livePanel()
    /** The seeded snapshot's ready rows. */
    const rows = (live.emitter.snapshots[0] as PanelSnapshot).readyTasks
    expect(rows.map((row) => row.title)).toEqual(["Ship the panel"])
    expect(rows).toHaveLength(1)
    live.cancel()
  })

  test("an unchanged tick emits nothing; a real change emits once", () => {
    clock = installFakeClock()
    /** A live panel over the default team. */
    const live = livePanel()
    expect(live.emitter.snapshots).toHaveLength(1)
    clock.tick()
    expect(live.emitter.snapshots).toHaveLength(1)
    /** The mutable state behind the doubles. */
    const state = live.host.state
    if (state.team !== null) state.team.phase = "idle"
    clock.tick()
    expect(live.emitter.snapshots).toHaveLength(2)
    expect((live.emitter.snapshots[1] as PanelSnapshot).team?.phase).toBe("idle")
    clock.tick()
    expect(live.emitter.snapshots).toHaveLength(2)
    live.cancel()
  })

  test("a huge board still emits under the bridge's 32 KiB cap and lists at most ten rows", () => {
    /** A state whose board is far larger than the panel will ever show. */
    const state = fakeState()
    state.team = {
      teamId: "team-big",
      name: "x".repeat(400),
      phase: "active",
      approvedAt: "2026-11-02T00:00:00.000Z",
      members: Array.from({ length: 40 }, (_entry, index) => ({ id: "M" + index, name: "member-" + index, status: "inactive" })),
      tasks: Array.from({ length: 80 }, (_entry, index) => ({ id: "T" + index, subject: "task-" + index + "-" + "y".repeat(300), status: "pending", blockedBy: [], kind: "work" })),
    }
    state.parked = [{ id: "q-big", sessionId: "s1", createdAt: 1, questions: [{ id: "item-big", question: "z".repeat(900), options: [{ label: "a".repeat(200) }, { label: "b".repeat(200) }, { label: "c".repeat(200) }, { label: "d".repeat(200) }] }] }]
    /** A live panel over that state. */
    const live = livePanel(state)
    /** The seeded snapshot. */
    const snapshot = live.emitter.snapshots[0] as PanelSnapshot
    expect(snapshot.readyTasks).toHaveLength(DSHGO_MAX_READY_ROWS)
    expect(snapshot.team?.name.length).toBeLessThanOrEqual(120)
    expect(snapshot.question?.question.length).toBeLessThanOrEqual(400)
    /** The emitted bytes, measured the way the bridge measures them. */
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length
    expect(bytes).toBeLessThan(DSHGO_MAX_SNAPSHOT_BYTES)
    live.cancel()
  })

  test("a service that throws reads as an empty section instead of breaking the tick", () => {
    /** The snapshot a broken registry answers. */
    const snapshot = readPanelSnapshot({
      services: { get: (): unknown => { throw new Error("no registry") } },
      workspace: "/ws",
      sessionId: "s1",
    })
    expect(snapshot).toEqual({ team: null, plan: null, question: null, readyTasks: [], counts: { ready: 0, active: 0, done: 0, total: 0, completion: 0, members: 0 }, alert: null, workmates: [], memory: null })
  })

  test("a panel with no conversation reads nothing at all", () => {
    /** A live panel subscribed without a session id. */
    const live = livePanel(fakeState(), "")
    expect(live.emitter.snapshots[0]).toEqual({ team: null, plan: null, question: null, readyTasks: [], counts: { ready: 0, active: 0, done: 0, total: 0, completion: 0, members: 0 }, alert: null, workmates: [], memory: null })
    live.cancel()
  })

  test("the adapter's session-to-workspace lookup outranks the injected fallback", () => {
    /** A host whose adapter can answer the session's root itself. */
    const host = fakeHost()
    host.setPresent(true)
    // The production adapter carries this seam; the fake need not, which is exactly the point.
    host.dsh.workspaceRootForSession = (sessionId: string): string => "/adapter-" + sessionId
    registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: logCapture().log, workspace: () => "/fallback", pollMs: 2000 })
    /** The published panel, whose data function performs the read. */
    const panel = onlyPanel(host)
    dataOf(panel.spec)({ sessionId: "s1" }, emitter().emit)
    expect(host.state.workspacesSeen).toEqual(["/adapter-s1"])
  })

  test("with neither resolution the panel reads nothing and shows the empty state", () => {
    /** A host with no workspace resolution at all. */
    const host = fakeHost()
    host.setPresent(true)
    registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: logCapture().log, pollMs: 2000 })
    /** The published panel. */
    const panel = onlyPanel(host)
    /** The app-side emitter. */
    const sink = emitter()
    dataOf(panel.spec)({ sessionId: "s1" }, sink.emit)
    expect(sink.snapshots[0]).toEqual({ team: null, plan: null, question: null, readyTasks: [], counts: { ready: 0, active: 0, done: 0, total: 0, completion: 0, members: 0 }, alert: null, workmates: [], memory: null })
    // Nothing was read: a guessed root would have asked the registry about another project's team.
    expect(host.state.workspacesSeen).toEqual([])
  })

  test("a staged plan and a parked question reach the snapshot", () => {
    /** A state with both a staged plan and a pending question. */
    const state = fakeState()
    state.plan = { planId: "plan-1", approved: false, discarded: false, members: [{ name: "Lead" }], tasks: [{ subject: "T" }] }
    state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Which branch?", options: [{ label: "main" }, { label: "dev" }] }] }]
    /** A live panel over that state. */
    const live = livePanel(state)
    /** The seeded snapshot. */
    const snapshot = live.emitter.snapshots[0] as PanelSnapshot
    expect(snapshot.plan).toEqual({ ready: true, members: 1, tasks: 1 })
    expect(snapshot.question).toEqual({ id: "q1", question: "Which branch?", options: [{ label: "main" }, { label: "dev" }] })
    live.cancel()
  })
})

describe("the view tree is v1-only and inside the panel budget", () => {
  test("every component is from the v1 catalog, the budget holds, and the action ids exist", () => {
    /** A live panel with a question, so the conditional nodes are present too. */
    const live = livePanel((() => {
      /** A state carrying one question with two options. */
      const state = fakeState()
      state.plan = { planId: "p", approved: false, discarded: false, members: [{ name: "Lead" }], tasks: [] }
      state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }, { label: "dev" }] }] }]
      return state
    })())
    /** The view the bridge would render for this scope. */
    const view = viewOf(live.spec)({ sessionId: "s1" })
    /** Every node in the tree, collected with its depth. */
    const nodes: Array<{ node: ViewNode; depth: number }> = []
    walkNodes(view, 1, (node, depth) => { nodes.push({ node, depth }) })
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.length).toBeLessThanOrEqual(PANEL_BUDGET.maxNodes)
    for (const { node, depth } of nodes) {
      expect(V1_COMPONENTS.has(String(node.type))).toBe(true)
      expect(depth).toBeLessThanOrEqual(PANEL_BUDGET.maxDepth)
      if (Array.isArray(node.children)) expect(node.children.length).toBeLessThanOrEqual(PANEL_BUDGET.maxChildren)
      if (node.type === "actions") expect((node.items as unknown[]).length).toBeLessThanOrEqual(DSHGO_MAX_OPTIONS)
      if (node.type === "text") expect(String(node.text).length).toBeLessThanOrEqual(2000)
    }
    expect(String(view.title).length).toBeLessThanOrEqual(80)
    expect(new TextEncoder().encode(JSON.stringify(view)).length).toBeLessThan(PANEL_BUDGET.maxBytes)
    /** Every action id the view's buttons name. */
    const named = nodes.flatMap(({ node }) => node.type === "actions" ? (node.items as Array<{ action?: string }>).map((item) => item.action ?? "") : [])
    expect(named).toContain("approve")
    expect(named).toContain("dispatch")
    expect(named).toContain("answer:0")
    for (const id of named) expect(Object.keys(actionsOf(live.spec))).toContain(id)
    live.cancel()
  })

  test("every $ binding resolves in the snapshot the data function emitted", () => {
    /** A live panel carrying both a plan and a question, so no binding is trivially absent. */
    const live = livePanel((() => {
      /** A state carrying one question with two options. */
      const state = fakeState()
      state.plan = { planId: "p", approved: false, discarded: false, members: [{ name: "Lead" }], tasks: [{ subject: "T" }] }
      state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }, { label: "dev" }] }] }]
      return state
    })())
    /** The emitted snapshot the device would render against. */
    const snapshot = live.emitter.snapshots[0] as PanelSnapshot
    /** The view built from that same snapshot. */
    const view = viewOf(live.spec)({ sessionId: "s1" })
    /** Every binding path the view carries. */
    const paths = bindingPathsOf(view)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(path.startsWith("data.")).toBe(true)
      expect(resolveBinding(path, snapshot)).not.toBeUndefined()
    }
    live.cancel()
  })

  test("more than four options shows four buttons and says it truncated", () => {
    /** A live panel whose question offers six options. */
    const live = livePanel((() => {
      /** A state carrying one question with six options. */
      const state = fakeState()
      state.parked = [{
        id: "q1",
        sessionId: "s1",
        createdAt: 1,
        questions: [{ id: "item-1", question: "Pick one", options: ["a", "b", "c", "d", "e", "f"].map((label) => ({ label })) }],
      }]
      return state
    })())
    /** The view built for that scope. */
    const view = viewOf(live.spec)({ sessionId: "s1" })
    /** Every actions node the tree carries. */
    const actionsNodes: Array<{ items: Array<{ action: string }> }> = []
    walkNodes(view, 1, (node) => { if (node.type === "actions") actionsNodes.push(node as unknown as { items: Array<{ action: string }> }) })
    /** The answer buttons only, which is the node that must be capped. */
    const answers = actionsNodes.flatMap((node) => node.items).filter((item) => item.action.startsWith("answer:"))
    expect(answers).toHaveLength(DSHGO_MAX_OPTIONS)
    /** Every text node's text, searched for the truncation note. */
    const texts: string[] = []
    walkNodes(view, 1, (node) => { if (node.type === "text") texts.push(String(node.text)) })
    expect(texts.some((text) => text.includes("first four"))).toBe(true)
    live.cancel()
  })

  test("no question means no question nodes at all", () => {
    /** A live panel with nothing parked. */
    const live = livePanel()
    /** The view built for a scope with no question. */
    const view = buildPanelView(live.emitter.snapshots[0] as PanelSnapshot)
    /** Every binding path in that view. */
    const paths = bindingPathsOf(view)
    expect(paths.some((path) => path.startsWith("data.question"))).toBe(false)
    live.cancel()
  })
})

describe("refresh follows the question's IDENTITY, not its text", () => {
  test("one refresh per id or option change and none for a text-only change", () => {
    clock = installFakeClock()
    /** A live panel with one question parked. */
    const live = livePanel((() => {
      /** A state carrying one question with two options. */
      const state = fakeState()
      state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }, { label: "dev" }] }] }]
      return state
    })())
    // The subscription's own seed is not a change: the app just fetched the view.
    expect(live.host.refreshes).toHaveLength(0)
    // A TEXT-ONLY change (same parked id, same options) emits but must not re-fetch: the question
    // text is a BOUND node, so the data push carries it without a new tree.
    live.host.state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one, now", options: [{ label: "main" }, { label: "dev" }] }] }]
    clock.tick()
    expect(live.emitter.snapshots).toHaveLength(2)
    expect(live.host.refreshes).toHaveLength(0)
    // An OPTION change is structural: the buttons carry LITERAL labels (the kit's action builder takes
    // a string), so the tree must be rebuilt — this is the one content change that does re-fetch.
    live.host.state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one, now", options: [{ label: "main" }, { label: "dev" }, { label: "edge" }] }] }]
    clock.tick()
    expect(live.host.refreshes).toHaveLength(1)
    // A SET change (a different parked id) refreshes exactly once and names the panel.
    live.host.state.parked = [{ id: "q2", sessionId: "s1", createdAt: 2, questions: [{ id: "item-2", question: "Next?", options: [{ label: "yes" }] }] }]
    clock.tick()
    expect(live.host.refreshes).toEqual(["mpd", "mpd"])
    // Settling it empties the set: one more refresh, then quiet.
    live.host.state.parked = []
    clock.tick()
    expect(live.host.refreshes).toHaveLength(3)
    clock.tick()
    expect(live.host.refreshes).toHaveLength(3)
    live.cancel()
  })
})

describe("taps answer a toast and never reject", () => {
  test("approve, dispatch and an option answer each succeed against their service", async () => {
    /** A live panel with one question parked. */
    const live = livePanel((() => {
      /** A state carrying one question with two options. */
      const state = fakeState()
      state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }, { label: "dev" }] }] }]
      return state
    })())
    /** The actions map the bridge received. */
    const actions = actionsOf(live.spec)
    // The app renders a view before it can tap: the answer id indexes THAT view's capture.
    viewOf(live.spec)({ sessionId: "s1" })
    /** The panel tap event the app sends; `action` names the button. */
    const tap = (action: string): unknown => ({ surface: "panel", id: "mpd", action, locale: "en" })
    expect(await actions.approve?.({ sessionId: "s1" }, tap("approve"))).toEqual({ toast: "Approved" })
    expect(live.host.state.approveCalls).toEqual(["s1"])
    expect(await actions.dispatch?.({ sessionId: "s1" }, tap("dispatch"))).toEqual({ toast: "Dispatched" })
    expect(live.host.state.dispatchCalls).toEqual(["s1"])
    expect(await actions["answer:1"]?.({ sessionId: "s1" }, tap("answer:1"))).toEqual({ toast: "Answered" })
    // The bridge clips a toast at 40 characters, so every success toast must already fit.
    for (const text of ["Approved", "Dispatched", "Answered"]) expect(text.length).toBeLessThanOrEqual(40)
    // The batch carries the ITEM id and the LABEL — never an index, which the relay refuses.
    expect(live.host.state.answerCalls).toEqual([{ id: "q1", answers: [{ id: "item-1", selected: ["dev"] }] }])
    live.cancel()
  })

  test("no conversation answers the one documented toast", async () => {
    /** A live panel with no session id. */
    const live = livePanel(fakeState(), "")
    /** The actions map the bridge received. */
    const actions = actionsOf(live.spec)
    for (const id of ["approve", "dispatch", "answer:0"]) {
      expect(await actions[id]?.({}, { action: id })).toEqual({ toast: "Open a conversation first" })
      expect((await actions[id]?.({}, { action: id }))?.toast.length).toBeLessThanOrEqual(40)
    }
    expect(live.host.state.approveCalls).toHaveLength(0)
    live.cancel()
  })

  test("an absent service answers 'Unavailable here' and mutates nothing", async () => {
    /** A live panel whose three services are all unmounted. */
    const live = livePanel()
    live.host.removeService("mpdTeamActions")
    live.host.removeService("mpdQuestions")
    /** The actions map the bridge received. */
    const actions = actionsOf(live.spec)
    expect(await actions.approve?.({ sessionId: "s1" }, { action: "approve" })).toEqual({ toast: "Unavailable here" })
    expect(await actions.dispatch?.({ sessionId: "s1" }, { action: "dispatch" })).toEqual({ toast: "Unavailable here" })
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "Unavailable here" })
    expect(live.host.state.approveCalls).toHaveLength(0)
    expect(live.host.state.dispatchCalls).toHaveLength(0)
    expect(live.host.state.answerCalls).toHaveLength(0)
    live.cancel()
  })

  test("an ok:false outcome answers the refusal sentence as a bounded toast", async () => {
    /** A live panel whose two team actions refuse. */
    const live = livePanel()
    live.host.state.approveOutcome = { ok: false, error: "approve needs a live agent for session s1 and this route has none of its own" }
    live.host.state.dispatchOutcome = { ok: false, error: "the team holds no ready task" }
    /** The actions map the bridge received. */
    const actions = actionsOf(live.spec)
    /** The approve toast. */
    const approved = await actions.approve?.({ sessionId: "s1" }, { action: "approve" })
    /** The dispatch toast. */
    const dispatched = await actions.dispatch?.({ sessionId: "s1" }, { action: "dispatch" })
    expect(approved?.toast).not.toBe("Approved")
    expect(dispatched?.toast).not.toBe("Dispatched")
    expect(approved?.toast.length).toBeLessThanOrEqual(40)
    expect(dispatched?.toast.length).toBeLessThanOrEqual(40)
    expect(dispatched?.toast).toBe("the team holds no ready task")
    live.cancel()
  })

  test("a throwing service still answers a toast, and the promise resolves", async () => {
    /** A live panel whose three services throw. */
    const live = livePanel((() => {
      /** A state carrying one question, so the answer tap reaches the service. */
      const state = fakeState()
      state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }] }] }]
      state.approveThrows = true
      state.dispatchThrows = true
      state.answerThrows = true
      return state
    })())
    /** The actions map the bridge received. */
    const actions = actionsOf(live.spec)
    // The app renders the view first, so the answer tap resolves against its captured question.
    viewOf(live.spec)({ sessionId: "s1" })
    await expect(actions.approve?.({ sessionId: "s1" }, { action: "approve" })).resolves.toEqual({ toast: "the store is unreadable" })
    await expect(actions.dispatch?.({ sessionId: "s1" }, { action: "dispatch" })).resolves.toEqual({ toast: "the executor is busy" })
    await expect(actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).resolves.toEqual({ toast: "the relay is gone" })
    live.cancel()
  })

  test("a relay that answers false is 'Unavailable here', and an unknown option index is refused", async () => {
    /** A live panel with one question and a relay that refuses the answer. */
    const live = livePanel((() => {
      /** A state whose relay refuses to settle. */
      const state = fakeState()
      state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }] }] }]
      state.answerOutcome = false
      return state
    })())
    /** The actions map the bridge received. */
    const actions = actionsOf(live.spec)
    // The app renders the view first, so every answer tap below resolves against its capture.
    viewOf(live.spec)({ sessionId: "s1" })
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "Unavailable here" })
    // An index the question does not offer is refused BEFORE the service is called.
    live.host.state.answerCalls.length = 0
    expect(await actions["answer:3"]?.({ sessionId: "s1" }, { action: "answer:3" })).toEqual({ toast: "Unavailable here" })
    expect(live.host.state.answerCalls).toHaveLength(0)
    // A service that answers the OTHER refusal shape (`{ok:false, error}`) gets its own sentence.
    live.host.state.answerOutcome = { ok: false, error: "that option is no longer offered" }
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "that option is no longer offered" })
    live.cancel()
  })
})

describe("the first view is a live read, not the unseeded push cache", () => {
  test("a question parked before the app's first fetch renders its callout and one button per option", () => {
    /** A state whose question is already parked before any subscription exists. */
    const state = fakeState()
    state.plan = { planId: "plan-1", approved: false, discarded: false, members: [{ name: "Lead" }], tasks: [{ subject: "T" }] }
    state.parked = [{ id: "q1", sessionId: "s1", createdAt: 1, questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }, { label: "dev" }] }] }]
    /** The published panel whose data function was never subscribed: the app's view-first order. */
    const panel = unseededPanel(state)
    /** The first view the app would render, built with no seeded cache behind it. */
    const view = viewOf(panel.spec)({ sessionId: "s1" })
    /** Every callout the view carries; the v1 fallback flattens ALL tabs into one stack, so the
     *  overview's staged-plan notice rides beside the question's own callout. */
    const callouts: ViewNode[] = []
    walkNodes(view, 1, (node) => { if (node.type === "callout") callouts.push(node) })
    expect(callouts.length).toBeGreaterThanOrEqual(1)
    expect(callouts.map((node) => node.text)).toContainEqual({ $: "data.question.question" })
    /** The answer buttons alone, keyed by the ids the action map registers. */
    const answers = actionButtonsOf(view).filter((button) => button.action.startsWith("answer:"))
    expect(answers.map((button) => button.action)).toEqual(["answer:0", "answer:1"])
    // Labels are LITERAL now: the kit's action builder takes a string, and a label change refreshes
    // the view (the signature carries the labels), so a bound label would add nothing.
    expect(answers.map((button) => button.label)).toEqual(["main", "dev"])
    /** The live read of the SAME reader the push path uses, which every binding must resolve in. */
    const snapshot = readPanelSnapshot({ services: panel.host.ctx, workspace: "/ws", sessionId: "s1" })
    expect(snapshot.question?.question).toBe("Pick one")
    for (const path of bindingPathsOf(view)) expect(resolveBinding(path, snapshot)).not.toBeUndefined()
  })
})

describe("a tap acts on the question its view rendered", () => {
  /** The parked question the view below is rendered from. */
  const firstQuestion = {
    id: "q1",
    sessionId: "s1",
    createdAt: 1,
    questions: [{ id: "item-1", question: "Pick one", options: [{ label: "main" }, { label: "dev" }] }],
  }

  test("still the same parked question: the tap carries the label the view rendered", async () => {
    /** A state with one parked question. */
    const state = fakeState()
    state.parked = [firstQuestion]
    /** The published panel, before any data subscription. */
    const panel = unseededPanel(state)
    // The app renders this view; the tap below must act on what the user SAW, not on the lot.
    viewOf(panel.spec)({ sessionId: "s1" })
    // A content-only change under the SAME parked id: no refresh fires, so the app keeps that view.
    state.parked = [{ ...firstQuestion, questions: [{ id: "item-1", question: "Pick one, now", options: [{ label: "main" }, { label: "edge" }] }] }]
    /** The actions map the bridge received. */
    const actions = actionsOf(panel.spec)
    expect(await actions["answer:1"]?.({ sessionId: "s1" }, { action: "answer:1" })).toEqual({ toast: "Answered" })
    expect(state.answerCalls).toEqual([{ id: "q1", answers: [{ id: "item-1", selected: ["dev"] }] }])
  })

  test("a new parked question: the tap toasts and never settles the question it never showed", async () => {
    /** A state whose question is `q1` at the moment the view is rendered. */
    const state = fakeState()
    state.parked = [firstQuestion]
    /** The published panel, before any data subscription. */
    const panel = unseededPanel(state)
    // The app renders and holds this view.
    viewOf(panel.spec)({ sessionId: "s1" })
    // A SET change: the app has not re-fetched yet, so its buttons still name `q1`'s options.
    state.parked = [{ id: "q2", sessionId: "s1", createdAt: 2, questions: [{ id: "item-2", question: "Next?", options: [{ label: "yes" }] }] }]
    /** The actions map the bridge received. */
    const actions = actionsOf(panel.spec)
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "That question is gone" })
    // The new question was never touched, and the panel asked the app for a fresh view.
    expect(state.answerCalls).toHaveLength(0)
    expect(panel.host.refreshes).toEqual([DSHGO_PANEL_ID])
  })

  test("a disappeared question: the tap toasts, refreshes and answers nothing", async () => {
    /** A state with one parked question. */
    const state = fakeState()
    state.parked = [firstQuestion]
    /** The published panel, before any data subscription. */
    const panel = unseededPanel(state)
    // The app renders and holds this view, then the question is settled from another client.
    viewOf(panel.spec)({ sessionId: "s1" })
    state.parked = []
    /** The actions map the bridge received. */
    const actions = actionsOf(panel.spec)
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "That question is gone" })
    expect(state.answerCalls).toHaveLength(0)
    expect(panel.host.refreshes).toEqual([DSHGO_PANEL_ID])
  })

  test("a view rendered with no question: an answer tap is a defensive toast", async () => {
    /** A published panel whose scope has nothing parked. */
    const panel = unseededPanel(fakeState())
    // The app renders the empty-state view: those buttons do not exist, and a stray tap still works.
    viewOf(panel.spec)({ sessionId: "s1" })
    /** The actions map the bridge received. */
    const actions = actionsOf(panel.spec)
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "No question on screen" })
    expect(panel.host.state.answerCalls).toHaveLength(0)
  })

  test("no view at all yet: an answer tap is the same defensive toast", async () => {
    /** A published panel whose view the app never fetched. */
    const panel = unseededPanel((() => {
      /** A state with a question parked, so only the missing view can refuse the tap. */
      const state = fakeState()
      state.parked = [firstQuestion]
      return state
    })())
    /** The actions map the bridge received. */
    const actions = actionsOf(panel.spec)
    expect(await actions["answer:0"]?.({ sessionId: "s1" }, { action: "answer:0" })).toEqual({ toast: "No question on screen" })
    expect(panel.host.state.answerCalls).toHaveLength(0)
  })
})

describe("nothing leaks after the release", () => {
  test("cancel clears the subscription's interval and dispose clears the rest", () => {
    clock = installFakeClock()
    /** A live panel with one subscription. */
    const live = livePanel()
    expect(clock.created).toBe(1)
    expect(clock.live).toBe(1)
    live.cancel()
    expect(clock.cleared).toBe(1)
    expect(clock.live).toBe(0)
    // A second subscription then a dispose: both the cancel and the release must leave zero behind.
    /** A second subscription on the same live panel. */
    const second = dataOf(live.spec)({ sessionId: "s1" }, emitter().emit)
    expect(clock.live).toBe(1)
    live.registration.dispose()
    expect(clock.live).toBe(0)
    second()
    expect(clock.cleared).toBe(clock.created)
  })

  test("a released registration also drops its late-bind subscription", () => {
    /** A host with no bridge, released before the bridge ever binds. */
    const host = fakeHost()
    /** The captured log lines. */
    const capture = logCapture()
    /** The registration under test. */
    const registration = registerDshGoPanel({ dsh: host.dsh, ctx: host.ctx, log: capture.log, workspace: () => "/ws" })
    registration.dispose()
    host.bindBridge()
    expect(host.panels).toHaveLength(0)
  })
})

describe("the bundle row wires the panel from apply", () => {
  test("apply publishes panel 'mpd' through the mounted adapter and nothing else", () => {
    /** A throwaway workspace root, so the row's own file log never lands in this checkout. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-dshgo-panel-"))
    /** The workspace override to restore after the arm. */
    const saved = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** Every panel the mounted adapter was asked to publish. */
      const published: Array<{ id: string; spec: PanelSpec }> = []
      /** The mounted adapter double: the four DSH Go members plus what apply() also probes. */
      const adapter = {
        webServerOf: (): undefined => undefined,
        onServiceBound: (): (() => void) => () => {},
        dshGoPresent: (): boolean => true,
        dshGoPanel: (id: string, spec: PanelSpec): boolean => {
          published.push({ id, spec })
          return true
        },
        dshGoRefresh: (): void => {},
      }
      /** The row context: `mpdDsh` resolves the mounted adapter, and no effect seam is offered. */
      const ctx = {
        get: (name: string, required?: boolean): unknown => (name === "mpdDsh" && required === true ? adapter : undefined),
        on: (): (() => void) => () => {},
      }
      apply(ctx)
      // TWO panels now (contract D2): the workbench and the team board, in that order.
      expect(published.map((panel) => panel.id)).toEqual([DSHGO_PANEL_ID, "mpd-team"])
      // The definition is the live panel: a view function, a data function and the tap map.
      expect(typeof published[0]?.spec.view).toBe("function")
      expect(typeof published[0]?.spec.data).toBe("function")
      expect(Object.keys(published[0]?.spec.actions ?? {}).sort()).toEqual(["answer-custom", "answer:0", "answer:1", "answer:2", "answer:3", "approve", "dispatch", "refresh"])
    } finally {
      if (saved === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = saved
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
