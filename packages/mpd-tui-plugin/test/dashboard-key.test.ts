// The language pin for this process: see `test/__dshtui-lang.ts` for WHY it is required.
import "./__dshtui-lang"
// The Ctrl+A takeover's contract, driven WITHOUT a terminal, a renderer or a live host.
//
// The three things these arms pin:
//   * the DECISION — intercept only for Ctrl+A while MPD's team projection has a team with at least
//     one task and the toggle is on; every other press must leave the event completely untouched, so
//     the host's own dashboard keeps opening (that half is the user's clause, not a courtesy);
//   * the BUS — the host's own emitter is prepended to, the listener is removed on unmount, and a
//     THROWING handler never escapes into the emitter's synchronous dispatch (which would break the
//     keyboard for the whole session);
//   * the CONTEXT SHAPE — a `useStdin()` result carrying `internal_querier` is the live provider's
//     and is attached to; the context DEFAULT (a foreign module instance) attaches NOTHING and says so
//     in one line, because a listener on that default's fresh emitter is a silent no-op.
import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createDashboardKeyComponent, DASHBOARD_KEY_MAX_ROWS, DASHBOARD_KEY_VIEW, interceptDashboardKey, readDashboardWorkflow, registerDashboardKey } from "../src/dashboard-key.js"
import type { DashboardKeyDeps, HostInputEmitter } from "../src/dashboard-key.js"
import type { Log } from "../src/log.js"
import type { SeamOutcome, TuiAdapter } from "../src/types.js"
import type { TeamTaskRow, TeamWorkflow } from "../src/team-state.js"

/** A log double: every line it received, by level. */
interface LogDouble extends Log {
  /** Every `debug` line, in call order. */
  debugLines: string[]
}

/** Build a log double that records instead of writing. */
function logDouble(): LogDouble {
  /** The debug lines the double captured. */
  const debugLines: string[] = []
  return {
    debugLines,
    /** No surface event is expected in these arms. */
    info: () => {},
    /** No degradation is expected in these arms. */
    warn: () => {},
    /** Records the line, which is what the arms assert on. */
    debug: (message: string) => {
      debugLines.push(message)
    },
  }
}

/** One DAG row; only the fields the decision reads are populated. */
function task(id: string): TeamTaskRow {
  return { id, subject: id, kind: "work", status: "pending", visual: "open", dependencies: [], failedDependencies: [], depth: 0 }
}

/** A team projection WITH a head and the given tasks — the takeover's positive case. */
function workflowWith(tasks: TeamTaskRow[]): TeamWorkflow {
  return {
    workspace: "/tmp/mpd-dashboard-key",
    team: { id: "team-1", name: "lead", phase: "active", staged: false, runnable: true, links: 0 },
    members: [],
    tasks,
    counts: { total: tasks.length, completed: 0, inProgress: 0, pending: tasks.length, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/** A projection of a workspace that holds NO team: the empty workflow has no head. */
function workflowWithoutTeam(): TeamWorkflow {
  return {
    workspace: "/tmp/mpd-dashboard-key",
    members: [],
    tasks: [],
    counts: { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/** One fake event, recording the calls the decision makes on it. */
interface EventDouble {
  /** Whatever the host's key parser produced for this press. */
  input: string
  /** The modifier flags of this press. */
  key: { ctrl?: boolean; meta?: boolean }
  /** Every `stopImmediatePropagation` call, timed against the scene open. */
  calls: string[]
  /** What the host's own emitter reads: true once immediate propagation was stopped. */
  stopped: boolean
  /** The host's own switch; absent when the arm removes it on purpose. */
  stopImmediatePropagation?: () => void
}

/** Build one event double; `withStop: false` models a foreign event object. */
function eventDouble(input: string, key: { ctrl?: boolean; meta?: boolean }, withStop: boolean = true): EventDouble {
  /** The calls both the stop and the open append to, so their ORDER is assertable. */
  const calls: string[] = []
  /** The double under construction. */
  const event: EventDouble = { input, key, calls, stopped: false }
  if (withStop) {
    event.stopImmediatePropagation = (): void => {
      event.stopped = true
      calls.push("stop")
    }
  }
  return event
}

/**
 * A bus with the HOST's own dispatch rule.
 *
 * A plain Node `EventEmitter` ignores `stopImmediatePropagation`, while the host's emitter subclass
 * breaks its listener loop once the dispatched event reports it (measured in
 * `lib/types/ink/events/emitter.js`). Modelling that rule here is what makes the prepend arm
 * FALSIFIABLE: without it, every listener would run and the test could not tell the takeover from a
 * no-op.
 * @returns an emitter whose `input` dispatch stops at the first stopping listener.
 */
function hostLikeBus(): EventEmitter {
  /** The ordinary emitter, whose other events keep Node's own semantics. */
  const bus = new EventEmitter()
  /** The inherited dispatch, used for every event name but `input`. */
  const base = bus.emit.bind(bus)
  bus.emit = ((type: string, ...args: unknown[]): boolean => {
    if (type !== "input") return base(type, ...args)
    /** The listeners in registration order, exactly as the host reads them. */
    const listeners = bus.rawListeners(type)
    if (listeners.length === 0) return false
    /** The event under dispatch, whose stop flag ends the loop. */
    const event = args[0] as { stopped?: boolean } | undefined
    for (const listener of listeners) {
      listener.apply(bus, args)
      if (event?.stopped === true) break
    }
    return true
  }) as typeof bus.emit
  return bus
}

/** The dependency set one arm runs against, with its call log. */
interface DepsDouble {
  /** The injected dependencies. */
  deps: DashboardKeyDeps
  /** Every scene open the decision requested. */
  opens: number
  /** The log double behind the dependencies. */
  log: LogDouble
}

/** Build the dependency double; every field can be overridden per arm. */
function depsDouble(overrides: Partial<DashboardKeyDeps> = {}): DepsDouble {
  /** The scene-open counter the arms assert on. */
  const state = { opens: 0 }
  /** The log double. */
  const log = logDouble()
  /** The dependencies under test. */
  const deps: DashboardKeyDeps = {
    enabled: () => true,
    mergedSceneAvailable: () => true,
    readWorkflow: () => workflowWith([task("T1")]),
    openMergedScene: () => {
      state.opens += 1
      return true
    },
    log,
    ...overrides,
  }
  return {
    deps,
    log,
    /** Read through a getter so the counter is never captured by value. */
    get opens(): number {
      return state.opens
    },
  }
}

/** The React double's bookkeeping: a mount runs the effects, an unmount runs their cleanups. */
interface ReactDouble {
  /** The instance handed to the component as `props.React`. */
  React: Record<string, unknown>
  /** Every element the component created, in call order. */
  elements: { type: unknown; props: Record<string, unknown>; children: unknown[] }[]
  /** Runs every cleanup the mount registered. */
  unmount(): void
}

/** Build a React double: hooks run synchronously, so "mount" is one call to the component. */
function reactDouble(): ReactDouble {
  /** The cleanups the mount registered, in effect order. */
  const cleanups: (() => void)[] = []
  /** The elements created, for the zero-row arm. */
  const elements: { type: unknown; props: Record<string, unknown>; children: unknown[] }[] = []
  return {
    elements,
    React: {
      /** A state pair whose setter is inert: no arm needs a re-render. */
      useState: <T,>(initial: T): [T, (next: T) => void] => [initial, () => {}],
      /** Runs the effect now and keeps its cleanup for {@link ReactDouble.unmount}. */
      useEffect: (effect: () => (() => void) | undefined): void => {
        /** The cleanup the effect returned, when it returned one. */
        const cleanup = effect()
        if (typeof cleanup === "function") cleanups.push(cleanup)
      },
      /** Records the element instead of rendering it. */
      createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): unknown => {
        elements.push({ type, props, children })
        return { type, props, children }
      },
    },
    unmount: (): void => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

/** The adapter double: the host contact, the settlement notification and the view registration. */
interface AdapterDouble {
  /** The adapter handed to the component and to the registration. */
  tui: TuiAdapter
  /** The descriptors the double received, in call order. */
  views: { key: string; maxRows?: number; component: unknown }[]
  /** The host bus this adapter's contact answers, when it has one at all. */
  bus: EventEmitter | undefined
  /**
   * Hands the double a host kit, exactly as `rememberHostKit` does on the real adapter.
   *
   * The wake is deferred by one microtask there (it runs inside a scene's React render), so it is
   * deferred here too — a test that asserts the arming must await one microtask first.
   */
  remember(kit: { useStdin: () => unknown }): void
}

/**
 * Build an adapter double.
 * @param options.bus - the host bus to answer with; omit for an adapter WITHOUT the input field.
 * @param options.stdin - the raw `useStdin()` result; the default is a LIVE context value.
 * @param options.hasContact - false models an adapter whose host contact never bound.
 * @returns the double.
 */
function adapterDouble(options: { bus?: EventEmitter; stdin?: unknown; hasContact?: boolean; deferContact?: boolean } = {}): AdapterDouble {
  /** The bus the contact answers, which the arms inspect for listeners. */
  const bus = options.bus ?? hostLikeBus()
  /** The descriptors the registration captured. */
  const views: { key: string; maxRows?: number; component: unknown }[] = []
  /** The value the fake `useStdin` returns; the LIVE shape carries a non-null `internal_querier`. */
  const stdin = options.stdin ?? { internal_querier: {}, internal_eventEmitter: bus }
  /** The adapter's own host contact, when this arm has one. */
  const contact: { useStdin: () => unknown } = { useStdin: () => stdin }
  /** The contact in force right now; `deferContact` starts it ABSENT so a kit can arm it later. */
  let current: { useStdin: () => unknown } | undefined = options.hasContact === false || options.deferContact === true ? undefined : contact
  /** The listeners waiting for a contact that has not arrived yet. */
  const waiters: ((input: unknown) => void)[] = []
  /** The adapter-shaped double; the cast is unavoidable because the real one builds 14 seam bindings. */
  const tui = {
    hostInput: () => current,
    whenHostInput: (listener: (input: unknown) => void) => {
      if (current === undefined && options.deferContact === true) {
        waiters.push(listener)
        return () => {
          /** The index of the still-waiting listener; -1 when it already ran. */
          const at = waiters.indexOf(listener)
          if (at >= 0) waiters.splice(at, 1)
        }
      }
      listener(current)
      return () => {}
    },
    registerStatusComponent: (view: { key: string; maxRows?: number; component: unknown }) => {
      views.push(view)
      return { outcome: (): SeamOutcome => ({ id: "tuiStatus", state: "requested", detail: view.key }), bound: () => true, record: () => {} }
    },
    openScene: () => true,
  } as unknown as TuiAdapter
  return {
    tui,
    views,
    bus,
    /** Takes a kit as the contact and wakes the waiters one microtask later, like the real adapter. */
    remember(kit: { useStdin: () => unknown }): void {
      current = kit
      void Promise.resolve().then(() => {
        /** The waiters present at wake time; a later subscription is served immediately instead. */
        const waiting = waiters.splice(0)
        for (const listener of waiting) listener(current)
      })
    },
  }
}

/** Mount the component once with the given doubles, returning the React double for the cleanups. */
function mountComponent(tui: TuiAdapter, deps: DashboardKeyDeps, react: ReactDouble): unknown {
  /** The component the registration would hand the host. */
  const component = createDashboardKeyComponent(tui, deps) as (props: { React?: unknown; ui?: unknown }) => unknown
  return component({ React: react.React, ui: { Box: (props: unknown) => props } })
}

describe("the Ctrl+A decision", () => {
  test("a team with tasks: the event is consumed and the merged panel is asked to open", () => {
    /** The arm's doubles. */
    const double = depsDouble()
    /** The Ctrl+A press. */
    const event = eventDouble("a", { ctrl: true })
    expect(interceptDashboardKey(event, double.deps)).toBe(true)
    // Order matters: the key is consumed BEFORE the panel is asked to open, so the host's own
    // handler can never draw its dashboard underneath ours.
    expect(event.calls).toEqual(["stop"])
    expect(double.opens).toBe(1)
  })

  test("every pass-through case leaves the event untouched and opens nothing", () => {
    /** The cases the takeover must NOT act on, each with its own reason. */
    const cases: { name: string; event: EventDouble; overrides: Partial<DashboardKeyDeps> }[] = [
      { name: "no team at all", event: eventDouble("a", { ctrl: true }), overrides: { readWorkflow: () => undefined } },
      { name: "a projection without a team head", event: eventDouble("a", { ctrl: true }), overrides: { readWorkflow: () => workflowWithoutTeam() } },
      { name: "a team with zero tasks", event: eventDouble("a", { ctrl: true }), overrides: { readWorkflow: () => workflowWith([]) } },
      { name: "the toggle is off", event: eventDouble("a", { ctrl: true }), overrides: { enabled: () => false } },
      { name: "the merged scene is not registered", event: eventDouble("a", { ctrl: true }), overrides: { mergedSceneAvailable: () => false } },
      { name: "a plain 'a' with no ctrl", event: eventDouble("a", {}), overrides: {} },
      { name: "ctrl+meta+a is not our chord", event: eventDouble("a", { ctrl: true, meta: true }), overrides: {} },
      { name: "another character", event: eventDouble("b", { ctrl: true }), overrides: {} },
    ]
    for (const arm of cases) {
      /** The arm's doubles, with this case's overrides applied. */
      const double = depsDouble(arm.overrides)
      expect(interceptDashboardKey(arm.event, double.deps)).toBe(false)
      expect(arm.event.calls).toEqual([])
      expect(double.opens).toBe(0)
    }
  })

  test("an event without the host's stop method is NOT consumed and opens nothing", () => {
    // A foreign event object cannot be stopped, so consuming it would open the panel UNDER the host's
    // own dashboard. The takeover declines instead — the honest half of "never break the host".
    /** The arm's doubles. */
    const double = depsDouble()
    expect(interceptDashboardKey(eventDouble("a", { ctrl: true }, false), double.deps)).toBe(false)
    expect(double.opens).toBe(0)
  })
})

/** A mounted view: the React double plus the two things React would do next. */
interface MountedView {
  /** Runs the last render's cleanups and renders the body again (what a state update causes). */
  flush(): unknown
  /** Runs every cleanup, as an unmount does. */
  unmount(): void
}

/**
 * Mount the keyhook's component with a React double that can RE-RENDER.
 *
 * The bootstrap path needs this: the contact can arrive after the mount, the view is woken through
 * `whenHostInput`, its state setter fires, and React re-renders — which is the only way the listener
 * can attach. The double models that sequence (cleanups, then the body again) without a reconciler.
 * @param props - the props the host would pass; `React` is supplied by the double.
 * @returns the mount, whose `flush` is one React re-render.
 */
function mountView(tui: TuiAdapter, deps: DashboardKeyDeps, props: { ui?: unknown } = {}): MountedView {
  /** The cleanups the last render registered. */
  const cleanups: (() => void)[] = []
  /** The React double itself, referenced by the body so a re-render sees the same hooks object. */
  const double: { React: Record<string, unknown> } = {
    React: {
      /** A state pair whose setter is inert: React's re-render is `flush`, not the setter. */
      useState: <T,>(initial: T): [T, (next: T) => void] => [initial, () => {}],
      /** Runs the effect now and keeps its cleanup for the next flush. */
      useEffect: (effect: () => (() => void) | undefined): void => {
        /** The cleanup this effect returned, when it returned one. */
        const cleanup = effect()
        if (typeof cleanup === "function") cleanups.push(cleanup)
      },
      /** Records the element instead of rendering it. */
      createElement: (type: unknown, elementProps: Record<string, unknown>, ...children: unknown[]): unknown => ({ type, props: elementProps, children }),
    },
  }
  /** One render pass: the body of the component the registration built. */
  const body = (): unknown => component({ React: double.React, ui: props.ui })
  /** The component under test, bound to the double above. */
  const component = createDashboardKeyComponent(tui, deps) as (props: { React?: unknown; ui?: unknown }) => unknown
  // The first mount keeps its cleanups, so a later flush removes them exactly as React would.
  body()
  return {
    flush: (): unknown => {
      for (const cleanup of cleanups.splice(0)) cleanup()
      return body()
    },
    unmount: (): void => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

describe("the zero-row status view", () => {
  test("a live host context value attaches a PREPENDED listener, removed on unmount", () => {
    /** The arm's doubles. */
    const adapter = adapterDouble()
    /** The deps double. */
    const { deps } = depsDouble()
    /** A listener already on the bus, standing in for the host's own Chat handler. */
    const earlier: string[] = []
    adapter.bus!.on("input", () => earlier.push("host"))
    /** The React double, kept so the cleanup can be run. */
    const react = reactDouble()
    mountComponent(adapter.tui, deps, react)
    expect(adapter.bus!.listenerCount("input")).toBe(2)
    /** The press that must be seen by the takeover FIRST. */
    const event = eventDouble("a", { ctrl: true })
    adapter.bus!.emit("input", event)
    // PREPENDED: the takeover decided before the listener that was already there, and the host's own
    // handler was stopped — which is the whole mechanism the takeover rests on.
    expect(event.calls).toEqual(["stop"])
    expect(earlier).toEqual([])
    // The host's handler is still attached (only the EVENT was stopped), and the unmount removes ours.
    react.unmount()
    expect(adapter.bus!.listenerCount("input")).toBe(1)
    adapter.bus!.emit("input", eventDouble("a", { ctrl: true }))
    expect(earlier).toEqual(["host"])
  })

  test("the context DEFAULT (no internal_querier) attaches nothing and reports ONE line", () => {
    // The silent-failure case: a second copy of the host module yields a context DEFAULT whose fresh
    // emitter nobody feeds. Attaching there would look healthy and do nothing, so the view declines.
    /** The arm's doubles, with the DEFAULT shape (the emitter is present and healthy — and dead). */
    const adapter = adapterDouble({ stdin: { internal_querier: null, internal_eventEmitter: hostLikeBus() } })
    /** The deps double. */
    const { deps, log } = depsDouble()
    /** The React double. */
    const react = reactDouble()
    mountComponent(adapter.tui, deps, react)
    expect(adapter.bus!.listenerCount("input")).toBe(0)
    expect(log.debugLines).toHaveLength(1)
    expect(log.debugLines[0]).toContain("DEFAULT")
    expect(log.debugLines[0]).toContain("internal_querier")
  })

  test("a contact that arrives AFTER the mount arms the view on the next render", async () => {
    // THE BOOTSTRAP PATH, and the one a user hits on a fresh session: the adapter has no contact yet
    // (the module resolved at load answers nothing on dsh-tui 0.12.0), a scene render later hands it
    // the host kit, the settle wakes this view, and React's re-render attaches the listener. Without
    // this path the take-over would stay inert for the whole session.
    /** The arm's doubles, with the contact deliberately ABSENT at mount time. */
    const adapter = adapterDouble({ deferContact: true })
    /** The deps double. */
    const deps = depsDouble()
    /** The mounted view. */
    const view = mountView(adapter.tui, deps.deps)
    expect(adapter.bus!.listenerCount("input")).toBe(0)
    // The host hands the kit over (a scene render), exactly as the adapter's `rememberHostKit` sees it.
    adapter.remember({ useStdin: () => ({ internal_querier: {}, internal_eventEmitter: adapter.bus }) })
    await Promise.resolve()
    // React's re-render is what attaches; the arm asserts it on the bus, not on a flag.
    view.flush()
    expect(adapter.bus!.listenerCount("input")).toBe(1)
    // …and the mounted listener then behaves: a Ctrl+A with a team is consumed, the panel is asked
    // to open, and the host's own handler is stopped.
    /** The Ctrl+A press. */
    const event = eventDouble("a", { ctrl: true })
    adapter.bus!.emit("input", event)
    expect(event.calls).toEqual(["stop"])
    expect(deps.opens).toBe(1)
    view.unmount()
    expect(adapter.bus!.listenerCount("input")).toBe(0)
  })

  test("an adapter without the host contact attaches nothing and never throws", () => {
    /** The arm's doubles: a composition where the probe never bound a host. */
    const adapter = adapterDouble({ hasContact: false })
    /** The deps double. */
    const { deps, log } = depsDouble()
    /** The React double. */
    const react = reactDouble()
    expect(() => mountComponent(adapter.tui, deps, react)).not.toThrow()
    expect(adapter.bus!.listenerCount("input")).toBe(0)
    // No contact is not a DEFAULT: there is no hook to call, and the line says so.
    expect(log.debugLines).toHaveLength(1)
    expect(log.debugLines[0]).toContain("no context value")
  })

  test("the view renders an empty Box: zero visible rows while staying mounted", () => {
    /** The arm's doubles. */
    const adapter = adapterDouble()
    /** The deps double. */
    const { deps } = depsDouble()
    /** The React double, whose created elements are inspected below. */
    const react = reactDouble()
    /** The element the component returned. */
    const rendered = mountComponent(adapter.tui, deps, react) as { children?: unknown[] } | null
    expect(react.elements).toHaveLength(1)
    expect(react.elements[0].children).toEqual([null])
    expect(rendered).not.toBeNull()
  })

  test("a throwing handler does not escape the host's dispatch, and logs one line", () => {
    /** The arm's doubles, with a toggle that throws. */
    const adapter = adapterDouble()
    /** The deps double whose `enabled()` throws — the failure a handler must contain. */
    const double = depsDouble({
      enabled: () => {
        throw new Error("toggle exploded")
      },
    })
    /** The React double. */
    const react = reactDouble()
    mountComponent(adapter.tui, double.deps, react)
    /** An unrelated listener, standing in for the rest of the host's keyboard. */
    const after: string[] = []
    adapter.bus!.on("input", () => after.push("after"))
    expect(() => adapter.bus!.emit("input", eventDouble("a", { ctrl: true }))).not.toThrow()
    // The emission CONTINUED: the host's other listeners still saw the key.
    expect(after).toEqual(["after"])
    expect(double.opens).toBe(0)
    expect(double.log.debugLines).toHaveLength(1)
    expect(double.log.debugLines[0]).toContain("toggle exploded")
  })
})

describe("registration", () => {
  test("the hook asks for a one-row view under its own key and reports the adapter's outcome", () => {
    /** The arm's doubles. */
    const adapter = adapterDouble()
    /** The deps double. */
    const { deps } = depsDouble()
    /** The hook's handle. */
    const seam = registerDashboardKey({}, adapter.tui, deps)
    expect(adapter.views).toHaveLength(1)
    expect(adapter.views[0].key).toBe(DASHBOARD_KEY_VIEW)
    // 1, not 0: the host validates `maxRows` as an integer 1..3 and REJECTS 0, so the zero comes from
    // the empty Box rather than from the row budget.
    expect(adapter.views[0].maxRows).toBe(DASHBOARD_KEY_MAX_ROWS)
    expect(typeof adapter.views[0].component).toBe("function")
    expect(seam.outcome().state).toBe("requested")
  })
})

describe("the team reader", () => {
  test("the mpd record wins over the official readout, and an unreadable read is no team", () => {
    /** A record-shaped principal whose single task id is what the projection must answer with. */
    const record = {
      id: "team-1",
      name: "lead",
      workspace: "/tmp/mpd-dashboard-key",
      createdAt: "2026-10-05T00:00:00.000Z",
      tasks: [{ id: "R1", subject: "record task", status: "pending", kind: "work", owner: "member", blockedBy: [], attempt: 1, round: 1 }],
      members: [],
    }
    /** The projection read from the RECORD, while the official readout would answer with another team. */
    const fromRecord = readDashboardWorkflow(() => "/tmp/mpd-dashboard-key", () => [], () => [], () => [record as never])
    expect(fromRecord?.tasks.map((row) => row.id)).toEqual(["R1"])
    /** The official fallback: no record at all, so the readout decides (and here it is empty). */
    const official = readDashboardWorkflow(() => "/tmp/mpd-dashboard-key", () => [], () => [], () => [])
    expect(official?.team).toBeUndefined()
    /** A reader that throws is "no team", never a broken keypress. */
    const broken = readDashboardWorkflow(() => "/tmp/mpd-dashboard-key", () => [], undefined, () => {
      throw new Error("record read exploded")
    })
    expect(broken === undefined || broken.tasks.length === 0).toBe(true)
  })
})
