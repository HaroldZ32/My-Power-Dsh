// THE WATCHDOG PAGE (`.mpd/plans/watchdog-tui-panel.md` §1–§7, §Definition of done).
//
// HARNESS. A HOST DOUBLE, not a terminal: index-keyed hook state with a replay step (as a fresh render
// does), effect QUEUING so an arm can run the key subscription the page registered, and a row-aware
// flattening that keeps each drawn row as its own string. The page is driven through its PUBLIC
// projection helpers where possible and through one render where the layout matters.
//
// WHAT THE ARMS PROVE, and each is one clause of the contract: the descriptor is a one-cell-icon,
// 28-column page ordered after the others; an empty view renders an explicit empty state; incidents
// render their kind, relative time, ack state, team/task/attempt, cause with ms and hold outcome; `a`
// advances the `mpd-tui` watermark exactly once per press; an absent service renders
// `watchdog: not available`; the scroll band reserves the rail's cell and stays inside the measured
// height; the title row's `⤢` is wired to the watchdog scene when one is supplied; and `/mpd watchdog`
// names the accepted host id when the panel opens (its routed fallback is the scene — see
// `scene-watchdog.test.ts`).
import { describe, expect, test } from "bun:test"

import {
  createWatchdogPanelComponent,
  incidentAge,
  registerWatchdogPanel,
  WATCHDOG_PANEL_DESCRIPTOR_FROZEN,
  WATCHDOG_PANEL_ICON,
  WATCHDOG_PANEL_ID,
  WATCHDOG_PANEL_ORDER,
  WATCHDOG_PANEL_TITLE,
  watchdogIncidentLines,
  watchdogTeamRows,
  type WatchdogAckResult,
  type WatchdogPanelDeps,
} from "../src/panel-watchdog"
import { panelContentWidth } from "../src/panel-core"
import type { WatchdogView } from "../src/watchdog"
import { registerCommands } from "../src/commands"
import { t } from "../src/i18n"
import { cellWidth } from "../src/sanitize"

/** One rendered element, in the double's own shape. */
interface Element {
  /** The element's component (a function of the double, or the string "Text"). */
  type: unknown
  /** The element's props. */
  props: Record<string, unknown>
  /** The element's children, in render order. */
  children: unknown[]
}

/** The host kit double one arm renders the page with. */
interface Kit {
  /** The React double the page must use. */
  React: Record<string, unknown>
  /** The ui kit double. */
  ui: Record<string, unknown>
  /** Restarts the hook index and replays the state updates, as a fresh render pass does. */
  reset(): void
  /** Runs every effect the last render registered. */
  runEffects(): void
  /** The row texts of one render, in DRAW order (empty rows dropped). */
  rows(tree: unknown): string[]
}

/**
 * Build the host kit double.
 * @param columns - the panel width the host reports.
 * @param rows - the panel height the host reports.
 * @returns the kit.
 */
function makeKit(columns: number = 60, rows: number = 40): Kit {
  /** Hook state, keyed by hook position, as React keys its own cells. */
  const store = new Map<string, unknown>()
  /** This pass's hook counter. */
  let index = 0
  /** The effects this render registered, in order. */
  const effects: Array<() => unknown> = []
  /** The React double: index-keyed hooks with a replayable store. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This cell's key, from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, initial)
      return [
        store.get(key),
        (next: unknown): void => {
          store.set(key, next)
        },
      ]
    },
    useEffect: (effect: () => unknown): void => {
      index += 1
      effects.push(effect)
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }
  /** The Text component: identity plus the children it renders. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Box component: a column to the flattening. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
  /** The ScrollBox component: a column to the flattening too. */
  const ScrollBox = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
  /** The nested-children flattener: a list of strings inside one Text is a COLUMN, not a run. */
  const inline = (node: unknown): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") return node
    if (typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(inline).join("")
    /** This node as an element, the only shape left after the guards. */
    const element = node as Element
    return inline(element.children)
  }
  /** Walks the tree one ROW at a time: a column contributes one row per child. */
  const rowsOf = (node: unknown, out: string[]): void => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) rowsOf(child, out)
      return
    }
    if (typeof node === "string" || typeof node === "number") {
      out.push(String(node))
      return
    }
    /** This node as an element. */
    const element = node as Element
    if (element.type === Box || element.type === ScrollBox) {
      for (const child of (element.props?.children as unknown[] | undefined) ?? element.children ?? []) rowsOf(child, out)
      return
    }
    out.push(inline(node))
  }
  return {
    React,
    ui: {
      Box,
      Text,
      ScrollBox,
      useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows }),
    },
    reset: (): void => {
      index = 0
      effects.length = 0
    },
    runEffects: (): void => {
      for (const effect of [...effects]) effect()
    },
    rows: (tree: unknown): string[] => {
      /** The collected rows. */
      const out: string[] = []
      rowsOf(tree, out)
      return out.filter((row) => row !== "")
    },
  }
}

/** The host API double: records the key listeners the page subscribes. */
interface HostRecorder {
  /** The props' host object. */
  readonly host: Record<string, unknown>
  /** The key listeners the page registered. */
  readonly listeners: Array<(event: unknown) => void>
}

/**
 * Build the host API double.
 * @returns the recorder.
 */
function makeHost(): HostRecorder {
  /** The listeners the page subscribed through the host API. */
  const listeners: Array<(event: unknown) => void> = []
  return {
    listeners,
    host: {
      onSubmit: (): void => {},
      onKey: (listener: (event: unknown) => void): (() => void) => {
        listeners.push(listener)
        return (): void => {
          /** This listener's position, removed on dispose. */
          const at = listeners.indexOf(listener)
          if (at >= 0) listeners.splice(at, 1)
        }
      },
    },
  }
}

/**
 * Render one page through the double.
 * @param kit - the host kit double.
 * @param host - the host API double.
 * @param component - the page component under test.
 * @returns the rendered tree.
 */
function render(kit: Kit, host: HostRecorder, component: unknown): unknown {
  kit.reset()
  return (component as (props: unknown) => unknown)({ React: kit.React, ui: kit.ui, host: host.host, focused: true, visible: true })
}

/**
 * The first element in a rendered tree whose own key is `key`.
 *
 * The page's chrome and body are addressed BY KEY rather than by row index, so an arm can find the
 * window's own column, the rail or the full-screen control without pinning the flattening's row count.
 * @param tree - the rendered tree (a node, an element or an array of either).
 * @param key - the element key to find.
 * @returns the element, or undefined when this tree carries none.
 */
function elementByKey(tree: unknown, key: string): Element | undefined {
  if (tree === null || tree === undefined || typeof tree !== "object") return undefined
  if (Array.isArray(tree)) {
    for (const child of tree) {
      /** The match inside this child, when it has one. */
      const found = elementByKey(child, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  /** This node as an element. */
  const element = tree as Element
  if (element.props?.key === key) return element
  for (const child of element.children ?? []) {
    /** The match inside this child, when it has one. */
    const found = elementByKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Run one body in a pinned language and restore the environment afterwards.
 * @param lang - the language to pin.
 * @param body - the assertions to run under it.
 * @returns the body's result.
 */
function withLang<T>(lang: "en" | "zh", body: () => T): T {
  /** The previous value, restored whatever the body does. */
  const previous = process.env.DSH_TUI_LANG
  process.env.DSH_TUI_LANG = lang
  try {
    return body()
  } finally {
    if (previous === undefined) delete process.env.DSH_TUI_LANG
    else process.env.DSH_TUI_LANG = previous
  }
}

/**
 * Run one ASYNC body in a pinned language and restore the environment afterwards.
 *
 * The sync helper cannot be reused: an `await` inside the body yields control while the environment
 * is still pinned, so the restore must happen after the promise settles.
 * @param lang - the language to pin.
 * @param body - the async assertions to run under it.
 * @returns the body's result.
 */
async function withLangAsync<T>(lang: "en" | "zh", body: () => Promise<T>): Promise<T> {
  /** The previous value, restored whatever the body does. */
  const previous = process.env.DSH_TUI_LANG
  process.env.DSH_TUI_LANG = lang
  try {
    return await body()
  } finally {
    if (previous === undefined) delete process.env.DSH_TUI_LANG
    else process.env.DSH_TUI_LANG = previous
  }
}

/** A clock anchor so the relative time is deterministic. */
const NOW = Date.now()

/** One incident fixture with every field the contract names. */
function incident(overrides: Partial<WatchdogView["unread"][number]> = {}): WatchdogView["unread"][number] {
  return {
    id: "inc-1",
    teamId: "team-a",
    kind: "escalate",
    at: NOW - 65_000,
    cause: { kind: "silence-channel", ms: 90_000 },
    taskId: "T3",
    attemptId: "a1",
    scene: null,
    hold: "applied",
    acknowledgedBy: [],
    ...overrides,
  } as WatchdogView["unread"][number]
}

/**
 * Build the page deps over a mutable view, recording every acknowledgement.
 * @param options - the initial view, the availability and the acknowledge verdict.
 * @returns the deps, the acknowledgement log and the render-time setters.
 */
function depsDouble(options: {
  view?: WatchdogView
  available?: boolean
  ack?: (upTo: number) => WatchdogAckResult
} = {}): {
  readonly deps: WatchdogPanelDeps
  readonly acks: number[]
  setView(next: WatchdogView): void
  setAvailable(next: boolean): void
} {
  /** The view the page reads on every render. */
  let view: WatchdogView = options.view ?? { holds: [], unread: [] }
  /** Whether the service answered. */
  let available = options.available ?? true
  /** Every `upTo` the page asked the service to acknowledge. */
  const acks: number[] = []
  /** The deps handed to the page. */
  const deps: WatchdogPanelDeps = {
    enabled: true,
    available: (): boolean => available,
    read: (): WatchdogView => view,
    acknowledge: (upTo: number): WatchdogAckResult => {
      acks.push(upTo)
      return options.ack === undefined ? { ok: true, watermark: upTo } : options.ack(upTo)
    },
    readTeam: () => ({ id: "team-a", phase: "active" }),
    log: { info: (): void => {}, warn: (): void => {}, debug: (): void => {} },
  }
  return {
    deps,
    acks,
    setView: (next: WatchdogView): void => {
      view = next
    },
    setAvailable: (next: boolean): void => {
      available = next
    },
  }
}

describe("the watchdog page's descriptor (contract §1)", () => {
  test("one slug, one-cell icon, the 28-column floor, and an order after the other pages", () => {
    expect(WATCHDOG_PANEL_ID).toBe("watchdog")
    expect(WATCHDOG_PANEL_TITLE).toBe("MPD watchdog")
    // The host REJECTS a descriptor whose icon is not exactly one display cell.
    expect(cellWidth(WATCHDOG_PANEL_ICON)).toBe(1)
    expect(WATCHDOG_PANEL_DESCRIPTOR_FROZEN).toEqual({
      apiVersion: 1,
      id: "watchdog",
      title: "MPD watchdog",
      icon: WATCHDOG_PANEL_ICON,
      minColumns: 28,
      order: WATCHDOG_PANEL_ORDER,
    })
    // `order` 10 (the MPD panel) and 12 (the workmate page) are the existing pages; this one is after.
    expect(WATCHDOG_PANEL_ORDER).toBeGreaterThan(12)
  })

  test("registration goes through the adapter's registerPanel and the row's own config knob", () => {
    /** The descriptor the fake adapter captured. */
    const captured: { descriptor?: Record<string, unknown> } = {}
    /** The fake adapter: only `registerPanel`/`skipped` are touched at registration. */
    const tui = {
      registerPanel: (descriptor: Record<string, unknown>): { id: () => string; outcome: () => { state: string } } => {
        captured.descriptor = descriptor
        return { id: () => "act0:watchdog", outcome: () => ({ state: "confirmed" }) }
      },
      skipped: (): { outcome: () => { state: string; detail: string } } => ({ outcome: () => ({ state: "absent", detail: "skipped" }) }),
    }
    /** The seam, registered. */
    const seam = registerWatchdogPanel(tui as never, depsDouble().deps)
    expect(seam.id()).toBe("act0:watchdog")
    expect(seam.registered()).toBe(true)
    expect(captured.descriptor?.id).toBe("watchdog")
    // The component the host receives is CALLABLE, i.e. a page and not a placeholder.
    expect(typeof captured.descriptor?.component).toBe("function")
    // A disabled page never registers at all.
    /** The seam of a config-disabled page. */
    const disabled = registerWatchdogPanel(tui as never, { ...depsDouble().deps, enabled: false })
    expect(disabled.panel).toBeUndefined()
    expect(disabled.registered()).toBe(false)
  })
})

describe("the page's content (contract §2)", () => {
  test("an EMPTY view renders the explicit empty state and a zero header", () => {
    withLang("en", () => {
      /** The kit and host this arm renders through. */
      const kit = makeKit()
      /** The page under test. */
      const page = createWatchdogPanelComponent(depsDouble().deps)
      /** Every drawn row. */
      const rows = kit.rows(render(kit, makeHost(), page))
      expect(rows).toContain("watchdog · 0 held · 0 unread")
      expect(rows).toContain(t("watchdog.panelEmpty"))
      // The keys hint is the page's own footer, present in every state.
      expect(rows.join("\n")).toContain("a ack")
    })
  })

  test("an INCIDENT renders kind, relative time, ack state, team/task/attempt, cause+ms and hold outcome", () => {
    withLang("en", () => {
      /** The view: one held team and one unread incident on it. */
      const view: WatchdogView = { holds: ["team-a"], unread: [incident()] }
      /** The kit and host this arm renders through. */
      const kit = makeKit()
      /** The page under test. */
      const page = createWatchdogPanelComponent(depsDouble({ view }).deps)
      /** Every drawn row. */
      const rows = kit.rows(render(kit, makeHost(), page))
      /** The whole page as one grep-able string for the multi-field assertions. */
      const text = rows.join("\n")
      expect(text).toContain("watchdog · 1 held · 1 unread")
      // Per team: held state and phase (the phase comes from the team projection).
      expect(text).toContain("team team-a · held · phase active")
      // The incident: kind, relative age, ack marker, team/task/attempt, cause with ms, hold outcome.
      expect(text).toContain("escalate")
      expect(text).toContain("1m")
      expect(text).toContain("○")
      expect(text).toContain("team-a · T3 · a1")
      expect(text).toContain("cause silence-channel · 90000ms")
      expect(text).toContain("hold applied")
    })
  })

  test("an ACKNOWLEDGED incident shows the acked marker, and a release is named", () => {
    withLang("en", () => {
      // The record's own `acknowledgedBy` decides the marker: a record this reader already acknowledged
      // reads `✓`, one it has not reads `○`. A `hold-auto-released` cause carries its release path.
      /** One incident the reader acknowledged. */
      const acknowledged = incident({ id: "inc-a", acknowledgedBy: ["mpd-tui", "web"] })
      /** A second incident, unacknowledged and released by the activity path. */
      const released = incident({ id: "inc-b", kind: "hold-auto-released", cause: { kind: "hold-auto-released", ms: 0, release: "activity" }, hold: "not-applied", acknowledgedBy: [] })
      /** The line projection of each. */
      const first = watchdogIncidentLines(acknowledged, NOW)
      /** The second record's projection. */
      const second = watchdogIncidentLines(released, NOW)
      expect(first.first).toContain("✓")
      expect(first.third).toContain("hold applied")
      expect(second.first).toContain("○")
      expect(second.first).toContain("hold-auto-released")
      expect(second.third).toContain("hold not-applied")
      expect(second.third).toContain("release activity")
    })
  })

  test("the relative time is a compact, language-neutral age", () => {
    expect(incidentAge(NOW - 500, NOW)).toBe("<1s")
    expect(incidentAge(NOW - 12_000, NOW)).toBe("12s")
    expect(incidentAge(NOW - 65_000, NOW)).toBe("1m")
    expect(incidentAge(NOW - 3 * 3_600_000, NOW)).toBe("3h")
    expect(incidentAge(NOW - 2 * 86_400_000, NOW)).toBe("2d")
    expect(incidentAge(Number.NaN, NOW)).toBe("?")
    expect(incidentAge(0, NOW)).toBe("?")
  })

  test("per-team rows are the held teams PLUS every incident team, sorted; a foreign phase reads `?`", () => {
    // The workspace-wide hold ledger and the incident log are two sources of team ids: the page shows
    // the union, and only the project's own team can carry a phase.
    /** A view with two held teams and an incident on a third. */
    const view: WatchdogView = {
      holds: ["team-b", "team-a"],
      unread: [incident({ teamId: "team-c" })],
    }
    /** The rows, with a projection that describes only team-b. */
    const rows = watchdogTeamRows(view, () => ({ id: "team-b", phase: "active" }))
    expect(rows.map((row) => row.id)).toEqual(["team-a", "team-b", "team-c"])
    expect(rows.map((row) => row.held)).toEqual([true, true, false])
    expect(rows.map((row) => row.phase)).toEqual(["?", "active", "?"])
  })

  test("an ABSENT service renders `watchdog: not available`, never a blank page or a throw", () => {
    withLang("en", () => {
      /** The kit and host this arm renders through. */
      const kit = makeKit()
      /** A page whose service is not mounted. */
      const absent = depsDouble({ available: false })
      /** The page under test. */
      const page = createWatchdogPanelComponent(absent.deps)
      /** Every drawn row. */
      const rows = kit.rows(render(kit, makeHost(), page))
      expect(rows.join("\n")).toContain("watchdog: not available")
      // No key press may acknowledge against an absent service.
      /** The host recorder, which holds the key listener. */
      const host = makeHost()
      render(kit, host, createWatchdogPanelComponent(absent.deps))
      kit.runEffects()
      for (const listener of host.listeners) listener({ input: "a" })
      expect(absent.acks).toHaveLength(0)
    })
  })

  test("an unreadable reader degrades to the absent state instead of throwing into the host", () => {
    /** The kit and host this arm renders through. */
    const kit = makeKit()
    /** Deps whose reader throws: the page must contain the failure. */
    const deps: WatchdogPanelDeps = { ...depsDouble().deps, read: () => { throw new Error("store unreadable") } }
    /** The page under test. */
    const page = createWatchdogPanelComponent(deps)
    /** Every drawn row. */
    const rows = kit.rows(render(kit, makeHost(), page))
    // The row is CLAMPED to the content width, so the assertion is on the state's own prefix and the
    // service id the sentence names — not on the full localized string.
    expect(rows.join("\n")).toContain("watchdog:")
    expect(rows.join("\n")).toContain("mpdWatchdog")
  })
})

describe("the acknowledge key (contract §3)", () => {
  test("`a` advances the watermark ONCE, to the newest incident shown, and a second press is a no-op", () => {
    /** The two newest incidents, so `upTo` is the maximum. */
    const older = incident({ id: "inc-1", at: NOW - 120_000 })
    /** The newest incident shown. */
    const newer = incident({ id: "inc-2", at: NOW - 30_000 })
    /** The deps double, whose ack log records each watermark advance. */
    const double = depsDouble({ view: { holds: [], unread: [older, newer] } })
    /** The kit and host this arm renders through. */
    const kit = makeKit()
    /** The host recorder, which holds the key listener. */
    const host = makeHost()
    /** The page under test, rendered and with its effects run so the key listener is live. */
    render(kit, host, createWatchdogPanelComponent(double.deps))
    kit.runEffects()
    expect(host.listeners).toHaveLength(1)
    /** The single handler the page subscribed. */
    const press = host.listeners[0]
    // TWO PRESSES WITHOUT A RE-RENDER: the state closure still holds the same view, and the page's own
    // last-acknowledged latch is what stops the second write.
    press({ input: "a" })
    press({ input: "a" })
    expect(double.acks).toEqual([newer.at])
    // A RE-RENDER against the now-empty view: the press finds nothing new and writes nothing.
    double.setView({ holds: [], unread: [] })
    render(kit, host, createWatchdogPanelComponent(double.deps))
    kit.runEffects()
    host.listeners[0]({ input: "a" })
    expect(double.acks).toEqual([newer.at])
  })

  test("a REFUSED acknowledge is reported, never swallowed, and a later press may retry", () => {
    withLang("en", () => {
      /** The deps double whose first acknowledge fails. */
      const double = depsDouble({
        view: { holds: [], unread: [incident()] },
        ack: () => ({ ok: false, watermark: 0, error: "no workspace resolved" }),
      })
      /** The kit and host this arm renders through. */
      const kit = makeKit()
      /** The host recorder, which holds the key listener. */
      const host = makeHost()
      /** The page under test, rendered and with its effects run. */
      render(kit, host, createWatchdogPanelComponent(double.deps))
      kit.runEffects()
      host.listeners[0]({ input: "a" })
      /** The re-rendered page, carrying the failure line. */
      const rows = kit.rows(render(kit, host, createWatchdogPanelComponent(double.deps)))
      expect(rows.join("\n")).toContain("acknowledge failed")
      expect(rows.join("\n")).toContain("no workspace resolved")
      // The failed attempt did NOT latch the watermark, so the next press tries again.
      kit.runEffects()
      host.listeners[0]({ input: "a" })
      expect(double.acks).toHaveLength(2)
    })
  })

  test("`r` refreshes and the scroll keys move the window without throwing", () => {
    /** A view tall enough to overflow a short panel, so scrolling is observable. */
    const view: WatchdogView = { holds: [], unread: Array.from({ length: 12 }, (_value, index) => incident({ id: `inc-${String(index)}`, at: NOW - index * 60_000 })) }
    /** The deps double. */
    const double = depsDouble({ view })
    /** A SHORT panel, so the incident list overflows and the viewport reports it. */
    const kit = makeKit(40, 12)
    /** The host recorder, which holds the key listener. */
    const host = makeHost()
    /** The first render. */
    const first = kit.rows(render(kit, host, createWatchdogPanelComponent(double.deps)))
    kit.runEffects()
    // The overflow suffix is drawn once the page knows its window (`N/M`).
    expect(first.join("\n")).toMatch(/\d+\/\d+/)
    // The keys the contract names: up/down and j/k scroll, r re-renders, none of them throws.
    for (const event of [{ key: { downArrow: true } }, { key: { upArrow: true } }, { input: "j" }, { input: "k" }, { input: "r" }, { key: { pageDown: true } }, { key: { home: true } }]) {
      expect(() => host.listeners[0](event)).not.toThrow()
    }
  })

  test("after ONE scroll step the body still DRAWS the incidents (CodeRabbit #16/#18)", () => {
    /** A view tall enough to overflow a short panel, so scrolling actually moves the window. */
    const view: WatchdogView = { holds: [], unread: Array.from({ length: 12 }, (_value, index) => incident({ id: `inc-${String(index)}`, at: NOW - index * 60_000 })) }
    /** The deps double. */
    const double = depsDouble({ view })
    /** A SHORT panel, so the list overflows. */
    const kit = makeKit(40, 12)
    /** The host recorder, whose first listener is the page's key handler. */
    const host = makeHost()
    /** The page component under test. */
    const component = createWatchdogPanelComponent(double.deps)
    // The first render + its effects install the key listener and publish the viewport.
    kit.rows(render(kit, host, component))
    kit.runEffects()
    // ONE step down: offset 1. Before #16 the body sliced its own one-element window AGAIN and drew
    // NOTHING while the footer still reported a later position — so this arm renders again and reads
    // the rows, which the old "does not throw" assertion could never catch.
    host.listeners[0]({ input: "j" })
    /** The rows of the post-scroll render. */
    const afterScroll = kit.rows(render(kit, host, component)).join("\n")
    expect(afterScroll).toContain("escalate")
    expect(afterScroll).toContain("team-a")
  })
})

describe("the /mpd watchdog command (contract §4)", () => {
  /**
   * Register the commands over fake actions and return the `/mpd` handler.
   * @param openWatchdog - the routed-open answer for this arm.
   * @returns the registered `/mpd` command definition.
   */
  function captureCommand(openWatchdog: () => { outcome: "opened" | "fallback" | "refused" | "unavailable"; id: string | undefined; reason?: "seam-absent" | "disabled" | "not-yet"; sceneOpened?: boolean }): {
    handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }>
  } {
    /** Every command definition the adapter received, in order. */
    const commands: Array<{ name: string; handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }> }> = []
    /** The fake adapter: it only records the registrations. */
    const tui = {
      registerCommand: (definition: { name: string; handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }> }): { outcome: () => { state: string } } => {
        commands.push(definition)
        return { outcome: () => ({ state: "requested" }) }
      },
    }
    registerCommands(tui as never, { openWatchdog } as never)
    // `/mpd` is registered FIRST; `/mpd-model` second.
    return commands[0]
  }

  test("an accepted open names the DISCOVERED host id", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command. */
      const command = captureCommand(() => ({ outcome: "opened", id: "act0:watchdog" }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("success")
      expect(String(result.text)).toContain("act0:watchdog")
      expect(String(result.text)).toContain("mpd watchdog")
    })
  })

  test("an absent panel seam is reported in ONE line and does not throw", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command. */
      const command = captureCommand(() => ({ outcome: "unavailable", id: undefined }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("error")
      /** The one-line sentence. */
      const line = String(result.text)
      expect(line).toContain("no panel seam")
      expect(line.includes("\n")).toBe(false)
    })
    // A host that REFUSED the registration is a different fact, with its own line.
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command. */
      const command = captureCommand(() => ({ outcome: "refused", id: undefined }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("error")
      expect(String(result.text)).toContain("refused")
    })
  })

  test("a MISSING panel seam whose SCENE opened is a success naming the scene — never an absence", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command whose route fell back to the watchdog scene. */
      const command = captureCommand(() => ({ outcome: "unavailable", id: undefined, reason: "seam-absent", sceneOpened: true }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("success")
      /** The one-line sentence. */
      const line = String(result.text)
      expect(line).toContain("mpd watchdog")
      expect(line).toContain("full-screen watchdog scene")
      // THE DOOR IS NAMED: the scene really closes on `esc`/`q`, so the line says how to leave.
      expect(line).toContain("esc to return")
      // THE OLD ABSENCE WORDING MUST NOT SURVIVE: the scene is on screen, so "no panel seam" would be a
      // lie about the surface the reader is looking at (the clause this wave exists to remove).
      expect(line).not.toContain("no panel seam")
      expect(line.includes("\n")).toBe(false)
    })
  })

  test("a MISSING panel seam whose scene did NOT open keeps the absence line — the honest case the new branch must not swallow", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command whose route had NO scene to fall back to. */
      const command = captureCommand(() => ({ outcome: "unavailable", id: undefined, reason: "seam-absent", sceneOpened: false }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("error")
      // NOTHING OPENED, SO NOTHING IS CLAIMED: the pre-scene sentence is exactly right here.
      expect(String(result.text)).toContain("no panel seam")
      expect(String(result.text)).not.toContain("full-screen watchdog scene")
    })
  })

// ── CodeRabbit #12 (PR #62): an open refusal, a registration refusal and a disabled page are
// THREE different facts, and each gets its own line ────────────────────────────────────────────
describe("the /mpd watchdog command keeps its refusals APART", () => {
  test("the host DECLINED THE OPEN — the line does not blame the registration", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command whose route refused the OPEN. */
      const command = captureCommand(() => ({ outcome: "fallback", id: "act0:watchdog" }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("error")
      expect(String(result.text)).toContain("declined this open")
      expect(String(result.text)).not.toContain("refused the panel registration")
    })
  })

  test("the REGISTRATION was refused — its own line, not the open one", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command whose registration settled `refused`. */
      const command = captureCommand(() => ({ outcome: "refused", id: undefined }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("error")
      expect(String(result.text)).toContain("refused the panel registration")
      expect(String(result.text)).not.toContain("declined this open")
    })
  })

  test("the page is DISABLED by its own knob — the line names `watchdog: false`, not a missing seam", async () => {
    await withLangAsync("en", async () => {
      /** The recorded `/mpd` command whose page its knob switched off. */
      const command = captureCommand(() => ({ outcome: "unavailable", id: undefined, reason: "disabled" }))
      /** The command's rendered result. */
      const result = await command.handler({ rawInput: "watchdog" })
      expect(result.kind).toBe("error")
      expect(String(result.text)).toContain("watchdog: false")
      expect(String(result.text)).not.toContain("no panel seam")
    })
  })
})
})

// ── clause 2 + clause 3: the page's own scroll band and its enlarge control ──────────────────────
describe("clause 2 + clause 3: the page's scroll band and its enlarge control", () => {
  test("at a NON-ZERO offset the body is still drawn, the rail keeps its cell, and the frame stays inside the measured height", () => {
    withLang("en", () => {
      /** Twelve incidents, so the body is far taller than the window (three rows each). */
      const unread = Array.from({ length: 12 }, (_, index) => incident({ id: `inc-${index}`, at: NOW - 65_000 - index * 1_000 }))
      /** The view the page draws: one held team and twelve unread incidents. */
      const view: WatchdogView = { holds: ["team-a"], unread }
      /** The panel width the host reports. */
      const columns = 40
      /** The kit the page renders through, short enough that the body must scroll. */
      const kit = makeKit(columns, 20)
      /** The host double, which records the key subscription the page registers. */
      const host = makeHost()
      /** The page under test. */
      const page = createWatchdogPanelComponent(depsDouble({ view }).deps)
      // MOUNT AT THE TOP: the header and the first window position are the baseline the shift is read against.
      /** The mount render's drawn rows. */
      const atTop = kit.rows(render(kit, host, page))
      expect(atTop.join("\n")).toContain("watchdog · 1 held · 12 unread")
      expect(atTop.join("\n")).toContain("1/24")
      // …THEN THE KEYS: the subscription is an effect, exactly as a mounted page installs it.
      render(kit, host, page)
      kit.runEffects()
      expect(host.listeners.length).toBeGreaterThan(0)
      // THREE `↓` PRESSES: the page's own one-row gesture, read from its live viewport handle.
      for (let press = 0; press < 3; press += 1) {
        for (const listener of host.listeners) listener({ key: { downArrow: true } })
      }
      /** The re-render after the presses. */
      const tree = render(kit, host, page)
      /** Every drawn row, in the double's flattening. */
      const rows = kit.rows(tree)
      // THE BODY IS NON-EMPTY AT A NON-ZERO OFFSET (the user's symptom: "all the text disappears"), and it
      // is the SHIFTED window: the header has scrolled away, an incident line is on screen, and the pinned
      // footer proves the offset is exactly three rows (its token is `offset + 1` over `max + 1`).
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.join("\n")).not.toContain("watchdog · 1 held · 12 unread")
      expect(rows.join("\n")).toContain("escalate ·")
      expect(rows.join("\n")).toContain("4/24")
      // THE RAIL IS DRAWN AND ITS CELL IS RESERVED by the body's own width budget: the exact arithmetic is
      // asserted in the arm below, so this one only proves the bar is really on screen at this offset.
      expect(elementByKey(tree, "gutter")).toBeDefined()
      // THE FRAME STAYS INSIDE THE MEASURED HEIGHT: two border rows + the title + the window + the footer.
      // Before the repair the window was `rows - 3`, so the frame drew `rows + 1` lines and the host clipped
      // the footer's position token. The window's slice is the rows the page handed to its wheel wrapper
      // (key `scroll`), which is the ONE place that slices.
      /** The window's own slice: the rows `panelViewportBody` handed to the host. */
      const windowRows = elementByKey(tree, "scroll")?.children.length ?? 0
      expect(windowRows).toBeGreaterThan(0)
      expect(2 + 1 + windowRows + 1).toBe(20)
    })
  })

  test("the interior reserves the rail's cell — a row plus the bar is exactly the interior, never wider", () => {
    withLang("en", () => {
      /** Twelve incidents, so the window is full and the widest row is a clamped incident line. */
      const unread = Array.from({ length: 12 }, (_, index) => incident({ id: `inc-${index}`, at: NOW - 65_000 - index * 1_000 }))
      /** The view the page draws. */
      const view: WatchdogView = { holds: ["team-a"], unread }
      /** The panel width the host reports. */
      const columns = 40
      /** The frame's interior: the reported width minus its two border cells. */
      const interior = panelContentWidth(columns)
      /** The kit the page renders through. */
      const kit = makeKit(columns, 20)
      /** The page under test. */
      const page = createWatchdogPanelComponent(depsDouble({ view }).deps)
      /** Every drawn row of the full window. */
      const rows = kit.rows(render(kit, makeHost(), page))
      // THE WIDTH DEFECT, in its exact numbers: the long incident line is clamped to the interior MINUS
      // the bar's one cell, so a row plus the bar is exactly the interior and can never wrap the frame —
      // which is what the host did, and what the user read as the text jumping to the left edge.
      expect(interior).toBe(38)
      /** The widest drawn row, in cells. */
      const widest = Math.max(...rows.map((row) => cellWidth(row)))
      expect(widest).toBe(interior - 1)
    })
  })

  test("the frame fits the measured height — a full window draws exactly `rows` lines", () => {
    withLang("en", () => {
      /** Twelve incidents, so the window is full. */
      const unread = Array.from({ length: 12 }, (_, index) => incident({ id: `inc-${index}`, at: NOW - 65_000 - index * 1_000 }))
      /** The view the page draws. */
      const view: WatchdogView = { holds: ["team-a"], unread }
      /** The kit the page renders through. */
      const kit = makeKit(40, 20)
      /** The page under test. */
      const page = createWatchdogPanelComponent(depsDouble({ view }).deps)
      /** The rendered tree. */
      const tree = render(kit, makeHost(), page)
      // THE HEIGHT DEFECT, in its exact numbers: neither border row, the title nor the pinned footer is
      // inside the window, so a full window draws exactly `measured.rows` lines. The pre-fix budget was
      // `rows - 3`, one row too many, and the host clipped the footer — and its position token — away.
      /** The window's own slice: the rows `panelViewportBody` handed to the host. */
      const windowRows = elementByKey(tree, "scroll")?.children.length ?? 0
      expect(windowRows).toBe(16)
      expect(2 + 1 + windowRows + 1).toBe(20)
    })
  })

  test("the title row's `⤢` calls the watchdog scene opener — and carries no click target when no scene exists", () => {
    withLang("en", () => {
      /** How many times the page's own opener was asked to open the scene. */
      let opened = 0
      /** The kit the page renders through. */
      const kit = makeKit()
      /** The page WITH a scene opener, exactly as the wiring supplies it. */
      const page = createWatchdogPanelComponent(depsDouble().deps, { openFullscreen: (): boolean => { opened += 1; return true } })
      /** The rendered tree. */
      const tree = render(kit, makeHost(), page)
      /** The control the title row draws at its right edge. */
      const control = elementByKey(tree, "title-fullscreen")
      expect(control).toBeDefined()
      /** The click target the control carries. */
      const onClick = control?.props?.onClick as ((event: unknown) => void) | undefined
      expect(typeof onClick).toBe("function")
      // A CLICK REACHES THE SCENE: this is the dead-enlarge clause's whole point.
      onClick?.({})
      expect(opened).toBe(1)
      // THE ROW IS UNCONDITIONAL, ONLY THE TARGET IS NOT (the shared chrome rule): a page built with no
      // scene still draws the same chrome row and glyph, and nothing can be clicked.
      /** The same page built the way a unit arm builds it: no opener. */
      const bare = createWatchdogPanelComponent(depsDouble().deps)
      /** The bare page's tree, through its own kit so no hook cell is shared with the arm above. */
      const bareTree = render(makeKit(), makeHost(), bare)
      /** The bare page's control. */
      const bareControl = elementByKey(bareTree, "title-fullscreen")
      expect(bareControl).toBeDefined()
      expect(bareControl?.props?.onClick).toBeUndefined()
    })
  })
})
