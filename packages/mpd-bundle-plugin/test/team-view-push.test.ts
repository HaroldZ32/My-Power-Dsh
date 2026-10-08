// Lane W — the PUSH refresh of the team view (contract `.mpd/plans/lane-w-web-push.md` §3, W-a..W-c).
//
// WHY THIS DRIVES TWO SEAMS. The subscription is a property of the SHIPPED BYTES, so W-a/W-b/W-c run
// against the built `packages/mpd-bundle-plugin/client.js` through the offline harness in
// `client-harness.ts` (the same one `sidebar-tab.test.ts` mounts the sidebar tabs with). The
// LIFECYCLE ACROSS A SESSION CHANGE is a property of the module's own `start` seam, which the
// source-level loader established in `team-view.test.ts`; that helper is file-private, so the same
// technique is repeated here rather than reaching into another file's internals.
//
// THE TIMER IS DRIVEN BY HAND. `setInterval` is replaced for the duration of a case, so "one frame
// refreshed the panel" and "the interval did not fire" are two NUMBERS this file reads, never an
// inference from a sleep: the fallback only runs when an arm fires its callback.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"
import { loadMpdClient, type ElementNode, type LoadedMpdClient, type TreeNode } from "./client-harness.ts"

/** The route the view reads; the canned answers below are keyed by the FULL url the view asks for. */
const STATE_PATH = "/plugins/mpd-team/state"
/** The staged-plan route the view reads in the same pass. */
const PLAN_PATH = "/plugins/mpd-team/plan"
/** The frozen-contract route the view reads in the same pass. */
const TASK_PATH = "/plugins/mpd-team/task"
/** The events route `web-client.ts` threads in as `eventsPath` (its `TEAM_EVENTS_PATH`). */
const EVENTS_PATH = "/plugins/mpd-team/events"
/** The slot key the harness right sidebar registers the team pane body under. */
const TEAM_SLOT_KEY = "@mpd-dsh/team-sidebar"
/** The session every arm mounts with, so the query the stream carries is assertable. */
const SESSION = "s1"
/** The workspace the fixture payload names, so a render has something real to draw. */
const WORKSPACE = "/w/lane-w"
/** How long one frame may take before it stops being a push (the user's own budget, 200 ms). */
const PUSH_BUDGET_MS = 200
/**
 * The team view's own poll period, in ms, as the client factory leaves it.
 *
 * EVERY OTHER interval this file records belongs to a DIFFERENT poller: the watchdog page registers
 * one at apply time with `WATCHDOG_POLL_MS = 15000` (`src/team-page.ts`), so the arms identify the
 * team view's timer by its period rather than by being the only one in the list.
 */
const VIEW_POLL_MS = 2000

/**
 * Build a state payload whose one member name carries `tag`.
 *
 * THE TAG IS THE INSTRUMENT: an arm swaps the canned answer and then reads the tag off the rendered
 * tree, so a read that did not PUBLISH is visible as well as a read that did not happen.
 * @param tag - the member name the panel will draw.
 * @returns the payload `/plugins/mpd-team/state` serves.
 */
function statePayload(tag: string): unknown {
  return {
    ok: true,
    workspace: WORKSPACE,
    team: { id: "team-w", name: "Lane W", description: "the push lane", phase: "active", approvedAt: "2026-10-08T07:00:00.000Z", links: 0 },
    counts: { total: 1, completed: 0, running: 1, ready: 1, blocked: 0, failed: 0, releasedByFailure: 0 },
    members: [{ id: "m1", name: tag, role: "Senior Engineer", status: "running", done: 0, total: 1, current: "subscribe" }],
    tasks: [{ id: "T1", subject: "Subscribe to the change feed", kind: "work", status: "running", visual: "running", owner: tag, attempt: 1, blockedBy: [], failedBy: [], depth: 0 }],
    cycles: [],
    executor: { kind: "native", reason: "ctx.subagents.startContinuable" },
    problems: [],
  }
}

/** One fake change stream: the members the view uses, plus what an arm reads back. */
interface StreamDouble {
  /** The URL the view opened, session query included. */
  url: string
  /** The message hook the view installed; null before the effect runs. */
  onmessage: ((event: unknown) => void) | null
  /** The error hook NO view installs — its absence is the contract (the browser retries). */
  onerror: ((event: unknown) => void) | null
  /** Whether the view closed this stream. */
  closed: boolean
  /** How many `close()` calls landed, so a double close would be visible. */
  closeCalls: number
  /** Close the stream, as the browser's own `close()` does. */
  close: () => void
}

/** The fake `EventSource` one case installs, plus the restore for the process global. */
interface StreamDoubleState {
  /** Every stream the view opened, in mount order. */
  opened: StreamDouble[]
  /** Put the global `EventSource` back the way the case found it. */
  restore: () => void
}

/**
 * Install a fake `EventSource` and hand back every stream the view opens.
 *
 * The two members the view is allowed to touch (`onmessage`, `close`) are modelled; `onerror` exists
 * so an arm can fire a transport error at whatever the view installed — which is nothing.
 * @returns the recorded streams and the restore for the global.
 */
function installStreamDouble(): StreamDoubleState {
  /** Every stream this double hands the view. */
  const opened: StreamDouble[] = []
  /** The global scope this case replaces. */
  const scope = globalThis as unknown as { EventSource?: unknown }
  /** The value to put back afterwards; undefined on a host that never had one. */
  const saved = scope.EventSource
  /** The fake stream the view constructs and closes. */
  class FakeEventSource implements StreamDouble {
    /** The URL the view opened, session query included. */
    readonly url: string
    /** The message hook the view installs. */
    onmessage: ((event: unknown) => void) | null = null
    /** The error hook no view installs; kept null so the absence is assertable. */
    onerror: ((event: unknown) => void) | null = null
    /** Whether the view closed this stream. */
    closed = false
    /** How many `close()` calls landed. */
    closeCalls = 0
    /**
     * Register one opened stream.
     * @param url - the URL the view asked for.
     */
    constructor(url: string) {
      this.url = url
      opened.push(this)
    }
    /** Close the stream, as the browser's own `close()` does. */
    close(): void {
      this.closeCalls += 1
      this.closed = true
    }
  }
  scope.EventSource = FakeEventSource
  return { opened, restore: () => { scope.EventSource = saved } }
}

/**
 * Model a host with NO `EventSource` at all — the offline harness, a non-browser host.
 *
 * `node` and `bun` define none (measured), so this arm is the DEFAULT environment of every other
 * test in this package; the assignment makes the absence explicit rather than incidental.
 * @returns an empty stream record and the restore for the global.
 */
function installAbsentEventSource(): StreamDoubleState {
  /** The global scope this case clears. */
  const scope = globalThis as unknown as { EventSource?: unknown }
  /** The value to put back afterwards. */
  const saved = scope.EventSource
  scope.EventSource = undefined
  return { opened: [], restore: () => { scope.EventSource = saved } }
}

/** One interval the view registered, whose callback only an arm fires. */
interface IntervalDouble {
  /** The registered callback, exactly the one the view passed. */
  callback: () => void
  /** The period the view asked for, in ms — the fallback cadence under test. */
  ms: number
  /** How many times an arm fired it. */
  fired: number
}

/** The interval double one case installs, plus the restore for the two timer globals. */
interface IntervalDoubleState {
  /** Every interval registered while the double was installed, in creation order. */
  registered: IntervalDouble[]
  /** The handles the view cleared, in call order; a duplicate would be a double clear. */
  cleared: unknown[]
  /** Put `setInterval`/`clearInterval` back the way the case found them. */
  restore: () => void
}

/**
 * Replace the timer globals with a double that NEVER fires on its own.
 *
 * THIS IS WHAT MAKES W-a A MEASUREMENT: a read observed after a `data:` frame cannot have come from
 * the fallback, because the fallback callback is still sitting in `registered` with `fired = 0`.
 * @returns the recorded intervals, the clears and the restore.
 */
function installIntervalDouble(): IntervalDoubleState {
  /** The intervals the view registered under the double. */
  const registered: IntervalDouble[] = []
  /** The handles `clearInterval` received. */
  const cleared: unknown[] = []
  /** The two globals this case replaces. */
  const saved = { set: globalThis.setInterval, clear: globalThis.clearInterval }
  globalThis.setInterval = ((callback: () => void, ms?: number): unknown => {
    /** The registered record, which is also the handle `clearInterval` gets back. */
    const entry: IntervalDouble = { callback, ms: Number(ms ?? 0), fired: 0 }
    registered.push(entry)
    return entry
  }) as unknown as typeof setInterval
  globalThis.clearInterval = ((handle: unknown): void => { cleared.push(handle) }) as unknown as typeof clearInterval
  return { registered, cleared, restore: () => { globalThis.setInterval = saved.set; globalThis.clearInterval = saved.clear } }
}

/** Let the pending read/publish chain settle: two macrotasks, the flush the hook runtime uses. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Flatten an element tree into its text, the way the rendered panel reads. */
function flatText(value: TreeNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(flatText).join(" ")
  if (typeof value === "object") {
    // The tree's own node shape: an element carries its children in `props`.
    /** The children of this element, when it is one. */
    const children = (value as ElementNode).props?.children
    return flatText(children as TreeNode)
  }
  return ""
}

/** Which of the two sidebar hosts an arm mounts the shared team view through. */
type HostKind = "better-sidebar" | "harness"

/** Everything one mounted panel case owns. */
interface MountedPanel {
  /** The loaded client; its `calls.fetched` is the read counter. */
  client: LoadedMpdClient
  /** The component the host mounts (the shared team view behind each host's own body). */
  component: Function
  /** The seat props the component is rendered with. */
  props: Record<string, unknown>
  /** The route bag the canned fetch reads PER CALL, so an arm can change an answer between reads. */
  routes: Record<string, unknown>
  /** The streams the view opened while mounted. */
  streams: StreamDoubleState
  /** The interval double: the fallback whose callback only an arm fires. */
  intervals: IntervalDoubleState
  /** The first rendered tree, after the effect's own immediate read settled. */
  tree: ElementNode
  /** How many `/state` reads the panel has made. */
  reads: () => number
  /** Tear the case down: the effect cleanups first (they close the stream), then every global. */
  teardown: () => void
}

/**
 * Mount the shared team view the way ONE sidebar host does, with the timer and the stream doubled.
 *
 * The canned answers are keyed by the FULL request URL (query included), because the harness's fetch
 * double resolves `responses[target]` on the whole URL — the route and the session are one key here,
 * which is also what makes a swapped answer per-session assertable.
 * @param options - the host, whether `EventSource` exists, and the session the seat shows.
 * @returns the mounted handles the arms assert on.
 */
async function mountPanel(options: { host?: HostKind; withEventSource?: boolean; sessionId?: string } = {}): Promise<MountedPanel> {
  /** The session this panel shows; the props and the canned URLs both use it. */
  const session = options.sessionId ?? SESSION
  /** The canned answers, keyed by the FULL URL the view requests. */
  const routes: Record<string, unknown> = {
    [STATE_PATH + "?sessionId=" + session]: statePayload("push-alpha"),
    [PLAN_PATH + "?sessionId=" + session]: { ok: true, workspace: WORKSPACE, plan: null },
    [TASK_PATH + "?sessionId=" + session]: { ok: true, workspace: WORKSPACE, contracts: [], hold: null },
  }
  /** The client, evaluated from the SHIPPED `client.js` bytes. */
  const client = loadMpdClient({ responses: routes, ...(options.host === "harness" ? { withoutSidebar: true } : {}) })
  /** The timer double, installed BEFORE the mount so only the view's own interval is recorded. */
  const intervals = installIntervalDouble()
  /** The stream double, or the absent global the fallback arm needs. */
  const streams = options.withEventSource === false ? installAbsentEventSource() : installStreamDouble()
  try {
    client.exports.apply(client.ctx)
    /** The component the requested host mounts. */
    const component = options.host === "harness" ? harnessSeat(client) : betterSidebarSeat(client)
    /** The seat props: the session the panel is showing, in the host's own spelling. */
    const props: Record<string, unknown> = { sessionId: session }
    /** The settled tree; `render` runs the effect, so the stream and the timer exist after it. */
    const tree = await client.hooks.render(component, props)
    return {
      client,
      component,
      props,
      routes,
      streams,
      intervals,
      tree,
      reads: () => client.calls.fetched.filter((call) => call.url.startsWith(STATE_PATH)).length,
      teardown: () => { client.hooks.runCleanups(); streams.restore(); intervals.restore(); client.restore() },
    }
  } catch (error) {
    streams.restore()
    intervals.restore()
    client.restore()
    throw error
  }
}

/**
 * Register the better-sidebar host (the preferred one) and answer the component it mounts.
 * @param client - the loaded client, whose tab registrations the injection fills.
 * @returns the team tab's own component.
 */
function betterSidebarSeat(client: LoadedMpdClient): Function {
  client.provideSidebar()
  /** The team tab descriptor, or undefined when this host took nothing. */
  const tab = client.calls.registerTab.find((entry) => entry.id === "mpd-team")
  if (tab === undefined) throw new Error("[lane-w] the shipped client registered no mpd-team tab on the better-sidebar host")
  return tab.component
}

/**
 * Publish the harness right sidebar (the fallback host) and answer the pane body it mounts.
 *
 * This is a DIFFERENT registration path from the better-sidebar tab — the seat's `inject` fires on
 * the two services below — so an arm reaching the view through it proves the subscription is not
 * attached to one host's wiring.
 * @param client - the loaded client, applied with `withoutSidebar` so the fallback branch is taken.
 * @returns the `sidebar.right.pane.tab` body registered for the team.
 */
function harnessSeat(client: LoadedMpdClient): Function {
  client.provideService("sidebarRightTabs", { register: () => (): void => {} })
  client.provideService("sidebarRight", { openTab: () => (): void => {} })
  /** The pane body the seat registered for the team tab. */
  const body = (client.calls.slotsRegistered ?? []).find((slot) => slot.name === "sidebar.right.pane.tab" && slot.key === TEAM_SLOT_KEY)
  if (body === undefined) throw new Error("[lane-w] the shipped client registered no sidebar.right.pane.tab body for " + TEAM_SLOT_KEY)
  return body.component
}

/** The one member of the evaluated factory's module the session-change arm drives. */
interface ViewSeam {
  /** Start one session's refresher; the returned function is the effect's cleanup. */
  start: (sessionId: string, publish: (next: unknown) => void) => () => void
}

/**
 * Read and evaluate the team-view factory the way the build does.
 *
 * COPIED FROM THE SIBLING `team-view.test.ts` ON PURPOSE: the two files must agree on the technique
 * (`typescript5`'s transpile is the same tool class the build's `stripTypeScriptTypes` comes from)
 * rather than on an export nothing but these two arms would ever use.
 * @returns the factory function the module evaluates to.
 */
function loadTeamViewFactory(): (deps: unknown) => { createTeamView: (deps: unknown) => ViewSeam } {
  /** The authoritative source, read as text so the arms read the bytes that ship. */
  const source = readFileSync(join(import.meta.dirname, "..", "src", "team-view.ts"), "utf8")
  /** The source with its type annotations erased, whitespace preserved. */
  const stripped = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  /** The evaluated expression, wrapped exactly as the build wraps it. */
  const value = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as unknown
  expect(typeof value).toBe("function")
  return value as (deps: unknown) => { createTeamView: (deps: unknown) => ViewSeam }
}

/**
 * Install a fetch that always fails, so a module-seam arm never reaches the network.
 *
 * The seam arm drives `start` directly, and `start`'s first tick reads the routes: without this the
 * read would issue a real request against a browser-relative URL.
 * @returns the restore for the global.
 */
function installOfflineFetch(): () => void {
  /** The global this case replaces. */
  const saved = globalThis.fetch
  globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => null })) as unknown as typeof fetch
  return () => { globalThis.fetch = saved }
}

/** One readable excerpt of a rendered frame, for the evidence transcript. */
const frame = (tree: ElementNode): string => flatText(tree).replace(/\s+/g, " ").trim().slice(0, 200)

describe("W-a — one data frame refreshes the panel on the BUILT artifact", () => {
  test("one frame re-reads the routes while the fallback interval never fires", async () => {
    /** The mounted artifact case, with the fake stream and the hand-driven timer. */
    const panel = await mountPanel()
    try {
      /** The reads before the frame: the effect's own immediate poll, and nothing else. */
      const beforeFrame = panel.reads()
      /** The one stream this mount opened. */
      const stream = panel.streams.opened[0]
      expect(beforeFrame).toBe(1)
      expect(panel.streams.opened.length).toBe(1)
      expect(stream.url).toBe(EVENTS_PATH + "?sessionId=" + SESSION)
      expect(typeof stream.onmessage).toBe("function")
      /** The team view's own interval: the one registered with the view's period. */
      const registerdViewTimers = panel.intervals.registered.filter((entry) => entry.ms === VIEW_POLL_MS)
      expect(registerdViewTimers.length).toBe(1)
      expect(registerdViewTimers[0].fired).toBe(0)
      // THE ANSWER CHANGES BEFORE THE FRAME, so a read that fails to PUBLISH is visible too: the tree
      // after the frame must carry the new tag and no longer the old one.
      panel.routes[STATE_PATH + "?sessionId=" + SESSION] = statePayload("push-beta")
      /** When the frame was delivered, for the elapsed measurement below. */
      const startedAt = Date.now()
      stream.onmessage?.({ data: '{"rev":2}' })
      await flush()
      /** How long the frame took to reach a completed read. */
      const elapsedMs = Date.now() - startedAt
      /** The reads after the frame. */
      const afterFrame = panel.reads()
      /** The tree the pushed state rendered into. */
      const tree = await panel.client.hooks.act(panel.component, panel.props)
      console.log("[W-a] " + JSON.stringify({
        readsBefore: beforeFrame,
        readsAfter: afterFrame,
        elapsedMs,
        pushBudgetMs: PUSH_BUDGET_MS,
        intervalMs: registerdViewTimers[0].ms,
        intervalFired: registerdViewTimers[0].fired,
        streamUrl: stream.url,
        refreshedOnScreen: flatText(tree).includes("push-beta"),
        staleTagGone: flatText(tree).includes("push-alpha") === false,
      }))
      expect(afterFrame).toBe(beforeFrame + 1)
      expect(elapsedMs).toBeLessThan(PUSH_BUDGET_MS)
      expect(registerdViewTimers[0].fired).toBe(0)
      expect(flatText(tree)).toContain("push-beta")
      expect(flatText(tree)).not.toContain("push-alpha")
    } finally {
      panel.teardown()
    }
  })

  test("each MOUNT owns its own stream: both sidebar hosts, mounted together, hold one each", async () => {
    /** The better-sidebar mount. */
    const first = await mountPanel()
    try {
      /** The harness right-sidebar mount, alive at the same time as the one above. */
      const second = await mountPanel({ host: "harness" })
      try {
        console.log("[W-a:mounts] " + JSON.stringify({
          betterSidebar: first.streams.opened.map((entry) => entry.url),
          harnessRightSidebar: second.streams.opened.map((entry) => entry.url),
          openTotal: first.streams.opened.filter((entry) => !entry.closed).length + second.streams.opened.filter((entry) => !entry.closed).length,
        }))
        // TWO MOUNTS, TWO STREAMS: the component is created per mount by the effect, so there is no
        // shared store and no single stream behind the two hosts.
        expect(first.streams.opened.length).toBe(1)
        expect(second.streams.opened.length).toBe(1)
        expect(first.streams.opened[0]).not.toBe(second.streams.opened[0])
        expect(first.streams.opened[0].closed).toBe(false)
        expect(second.streams.opened[0].closed).toBe(false)
      } finally {
        second.teardown()
      }
    } finally {
      first.teardown()
    }
  })
})

describe("W-b — the fallback: no stream, and a stream that errors", () => {
  test("with no EventSource global the panel renders and the interval still refreshes it", async () => {
    /** The mounted case on a host that offers no `EventSource`. */
    const panel = await mountPanel({ withEventSource: false })
    try {
      /** The frame the panel rendered with no push at all. */
      const rendered = flatText(panel.tree)
      expect(panel.streams.opened.length).toBe(0)
      expect(rendered).toContain("push-alpha")
      // THE ANSWER CHANGES, and only the INTERVAL may notice it.
      panel.routes[STATE_PATH + "?sessionId=" + SESSION] = statePayload("fallback-beta")
      /** The reads before the fallback fires. */
      const beforeTick = panel.reads()
      /** The view's own interval record, whose callback is the fallback. */
      const timer = panel.intervals.registered.filter((entry) => entry.ms === VIEW_POLL_MS)[0]
      timer.fired += 1
      timer.callback()
      await flush()
      /** The tree the fallback poll rendered into. */
      const tree = await panel.client.hooks.act(panel.component, panel.props)
      console.log("[W-b:absent] " + JSON.stringify({
        streamsOpened: panel.streams.opened.length,
        intervalMs: timer.ms,
        intervalFired: timer.fired,
        readsBeforeTick: beforeTick,
        readsAfterTick: panel.reads(),
        frameBefore: frame(panel.tree),
        frameAfter: frame(tree),
      }))
      expect(panel.reads()).toBe(beforeTick + 1)
      expect(flatText(tree)).toContain("fallback-beta")
    } finally {
      panel.teardown()
    }
  })

  test("a stream error costs the push and nothing else", async () => {
    /** The mounted case with a live stream. */
    const panel = await mountPanel()
    try {
      /** The stream the view opened. */
      const stream = panel.streams.opened[0]
      // NO ERROR HANDLER OF OURS: reconnecting is the browser's own job (the route sends `retry:
      // 1000`), so the absence here is the contract, not an omission.
      expect(stream.onerror).toBeNull()
      stream.onerror?.({ type: "error" })
      await flush()
      /** The tree after the transport error. */
      const afterError = await panel.client.hooks.act(panel.component, panel.props)
      expect(flatText(afterError)).toContain("push-alpha")
      // AND THE FALLBACK STILL WORKS AFTER THE ERROR.
      panel.routes[STATE_PATH + "?sessionId=" + SESSION] = statePayload("error-beta")
      /** The view's own interval record. */
      const timer = panel.intervals.registered.filter((entry) => entry.ms === VIEW_POLL_MS)[0]
      timer.fired += 1
      timer.callback()
      await flush()
      /** The tree the fallback poll rendered into. */
      const afterTick = await panel.client.hooks.act(panel.component, panel.props)
      // AND A LATER FRAME STILL WORKS TOO: the browser's retry resumes the push on the same stream.
      panel.routes[STATE_PATH + "?sessionId=" + SESSION] = statePayload("error-gamma")
      stream.onmessage?.({ data: '{"rev":3}' })
      await flush()
      /** The tree the post-error frame rendered into. */
      const afterFrame = await panel.client.hooks.act(panel.component, panel.props)
      console.log("[W-b:error] " + JSON.stringify({
        errorHookInstalled: stream.onerror !== null,
        closedByError: stream.closed,
        frameAfterError: frame(afterError),
        frameAfterTick: frame(afterTick),
        frameAfterFrame: frame(afterFrame),
      }))
      expect(flatText(afterTick)).toContain("error-beta")
      expect(flatText(afterFrame)).toContain("error-gamma")
      expect(stream.closed).toBe(false)
    } finally {
      panel.teardown()
    }
  })
})

describe("W-c — lifecycle: unmount and session change", () => {
  test("unmounting the panel closes the stream and clears the interval", async () => {
    /** The mounted case, alive until the cleanup below runs. */
    const panel = await mountPanel()
    try {
      /** The stream the mount opened. */
      const stream = panel.streams.opened[0]
      /** The team view's own interval record, read before the unmount clears it. */
      const viewTimer = panel.intervals.registered.filter((entry) => entry.ms === VIEW_POLL_MS)
      expect(stream.closed).toBe(false)
      // THE UNMOUNT, driven exactly as React runs an effect's cleanup.
      panel.client.hooks.runCleanups()
      console.log("[W-c:unmount] " + JSON.stringify({
        opened: panel.streams.opened.length,
        openAfterUnmount: panel.streams.opened.filter((entry) => !entry.closed).length,
        closeCalls: stream.closeCalls,
        registeredTimers: panel.intervals.registered.map((entry) => entry.ms),
        clearedTimers: panel.intervals.cleared.map((entry) => (entry as { ms?: number }).ms ?? null),
      }))
      expect(stream.closed).toBe(true)
      expect(stream.closeCalls).toBe(1)
      expect(panel.streams.opened.filter((entry) => !entry.closed).length).toBe(0)
      // THE VIEW'S OWN TIMER IS EXACTLY WHAT THE UNMOUNT CLEARED — once. The 15000 ms interval in the
      // list belongs to the watchdog page (another surface, another disposer) and is deliberately not
      // touched here.
      expect(viewTimer.length).toBe(1)
      expect(panel.intervals.cleared.length).toBe(1)
      expect(panel.intervals.cleared[0]).toBe(viewTimer[0])
    } finally {
      panel.teardown()
    }
  })

  test("a session change closes the old stream before the next one opens", async () => {
    /** The stream double the two subscribers below share. */
    const streams = installStreamDouble()
    /** The offline fetch, restored in the finally below. */
    const restoreFetch = installOfflineFetch()
    try {
      /** The factory's module, evaluated from the shipped source bytes. */
      const view = loadTeamViewFactory()({}).createTeamView({ react: null, statePath: STATE_PATH, planPath: PLAN_PATH, taskPath: TASK_PATH, eventsPath: EVENTS_PATH, pollMs: 60_000 })
      /** The first session's refresher: what the effect runs on mount. */
      const stopFirst = view.start(SESSION, () => {})
      expect(streams.opened.length).toBe(1)
      expect(streams.opened[0].url).toBe(EVENTS_PATH + "?sessionId=" + SESSION)
      // THE ORDER REACT USES on a deps change: the old cleanup first, then the new effect.
      stopFirst()
      expect(streams.opened[0].closed).toBe(true)
      /** The second session's refresher, as the re-run effect would start it. */
      const stopSecond = view.start("s2", () => {})
      console.log("[W-c:session-change] " + JSON.stringify({
        opened: streams.opened.map((entry) => entry.url),
        closedFlags: streams.opened.map((entry) => entry.closed),
        openAfterChange: streams.opened.filter((entry) => !entry.closed).length,
      }))
      expect(streams.opened.length).toBe(2)
      expect(streams.opened[1].url).toBe(EVENTS_PATH + "?sessionId=s2")
      expect(streams.opened.filter((entry) => !entry.closed).length).toBe(1)
      stopSecond()
      expect(streams.opened.filter((entry) => !entry.closed).length).toBe(0)
    } finally {
      restoreFetch()
      streams.restore()
    }
  })

  test("no events route means no stream: the composition is left exactly as it was", async () => {
    /** The stream double, which must stay empty. */
    const streams = installStreamDouble()
    /** The offline fetch, restored in the finally below. */
    const restoreFetch = installOfflineFetch()
    try {
      /** The factory's module, built WITHOUT `eventsPath`. */
      const view = loadTeamViewFactory()({}).createTeamView({ react: null, statePath: STATE_PATH, planPath: PLAN_PATH, taskPath: TASK_PATH, pollMs: 60_000 })
      /** The refresher for a module that was given no events route. */
      const stop = view.start(SESSION, () => {})
      console.log("[W-c:no-route] " + JSON.stringify({ opened: streams.opened.length }))
      expect(streams.opened.length).toBe(0)
      stop()
    } finally {
      restoreFetch()
      streams.restore()
    }
  })
})
