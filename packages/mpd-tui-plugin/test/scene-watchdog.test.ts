// THE WATCHDOG SCENE (`packages/mpd-tui-plugin/src/scene-watchdog.ts`) — clause 3 / contract §5.A3.
//
// HARNESS. The same host-double discipline the sidebar page's suite uses: index-keyed hook state, effect
// QUEUING (the scene reads its view in an effect, so an arm must run the effects and re-render, exactly
// as a mount does), a key-listener recorder and a row-aware flattening. Both surfaces are rendered from
// the SAME fixture and their body rows compared, which is the acceptance criterion's own wording.
//
// WHAT THE ARMS PROVE: the scene is REGISTERED under `mpd-tui-watchdog` with the page's own title and a
// callable component; the open request reaches the host's `openScene`; and for identical input the scene
// draws the SAME body rows the sidebar page draws (one shared builder), including at a non-zero offset.
import { describe, expect, test } from "bun:test"

import {
  createWatchdogSceneComponent,
  registerWatchdogScene,
  WATCHDOG_SCENE_ID,
} from "../src/scene-watchdog"
import {
  createWatchdogPanelComponent,
  WATCHDOG_PANEL_TITLE,
  watchdogBodyRows,
  watchdogTeamRows,
  type WatchdogAckResult,
  type WatchdogPanelDeps,
} from "../src/panel-watchdog"
import type { WatchdogView } from "../src/watchdog"

/** One rendered element as the doubles produce it. */
interface Element {
  /** The element type (a host component reference). */
  type: unknown
  /** The element's props, `key` included (the panel kit carries it there). */
  props: Record<string, unknown>
  /** The element's children, in render order. */
  children: unknown[]
}

/** The host kit double one scene arm renders with. */
interface SceneKit {
  /** The React double the scene must use. */
  React: Record<string, unknown>
  /** The ui kit double. */
  ui: Record<string, unknown>
  /** Restarts the hook index and replays state, as a fresh render pass does. */
  reset(): void
  /** Runs every effect the last render registered, keeping the cleanups it returned. */
  runEffects(): void
  /** Runs the cleanups the last `runEffects` collected (the scene's refresh timer included). */
  runCleanups(): void
  /** The key listeners the scene registered, in registration order. */
  keys(): Array<(input: string, key: Record<string, unknown> | undefined) => void>
  /** The row texts of one render, in DRAW order (empty rows dropped). */
  rows(tree: unknown): string[]
}

/**
 * Build the scene kit double.
 * @param columns - the terminal width the host reports.
 * @param rows - the terminal height the host reports.
 * @returns the kit.
 */
function makeSceneKit(columns: number = 200, rows: number = 20): SceneKit {
  /** Hook state, keyed by hook position, as React keys its own cells. */
  const store = new Map<string, unknown>()
  /** This pass's hook counter. */
  let index = 0
  /** The effects this render registered, in order. */
  const effects: Array<() => unknown> = []
  /** The cleanups the last effect run returned. */
  const cleanups: Array<() => unknown> = []
  /** The key listeners the scene registered through the ui kit. */
  const keyHandlers: Array<(input: string, key: Record<string, unknown> | undefined) => void> = []
  /** The React double: index-keyed hooks with a replayable store. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This cell's key, from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, initial)
      return [store.get(key), (next: unknown): void => { store.set(key, next) }]
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
  /** The Box component: a column/row to the flattening. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
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
  /** Walks the tree one ROW at a time: a Box contributes one row per child. */
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
    if (element.type === Box) {
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
      useInput: (handler: (input: string, key: Record<string, unknown> | undefined) => void): void => {
        keyHandlers.push(handler)
      },
      useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows }),
    },
    reset: (): void => {
      index = 0
      effects.length = 0
    },
    runEffects: (): void => {
      for (const effect of [...effects]) {
        /** What the effect returned, when it asked to be cleaned up. */
        const cleanup = effect()
        if (typeof cleanup === "function") cleanups.push(cleanup as () => unknown)
      }
    },
    runCleanups: (): void => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
    keys: (): Array<(input: string, key: Record<string, unknown> | undefined) => void> => [...keyHandlers],
    rows: (tree: unknown): string[] => {
      /** The collected rows. */
      const out: string[] = []
      rowsOf(tree, out)
      return out.filter((row) => row !== "")
    },
  }
}

/** The fixture's own base instant, pinned at module load so every age is stable. */
const NOW = Date.now()

/**
 * One incident, shaped exactly as the front door reports it.
 * @param overrides - the fields this arm wants to change.
 * @returns the incident record.
 */
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
 * Build the deps over a fixed view, recording every acknowledgement.
 * @param view - the durable view the surfaces read.
 * @param available - whether the service answers.
 * @returns the deps and the acknowledgement log.
 */
function depsDouble(view: WatchdogView = { holds: [], unread: [] }, available: boolean = true): { deps: WatchdogPanelDeps; acks: number[] } {
  /** Every `upTo` a surface asked the service to acknowledge. */
  const acks: number[] = []
  return {
    acks,
    deps: {
      enabled: true,
      available: (): boolean => available,
      read: (): WatchdogView => view,
      acknowledge: (upTo: number): WatchdogAckResult => {
        acks.push(upTo)
        return { ok: true, watermark: upTo }
      },
      readTeam: () => ({ id: "team-a", phase: "active" }),
      log: { info: (): void => {}, warn: (): void => {}, debug: (): void => {} },
    },
  }
}

/**
 * Render one scene through the double.
 * @param kit - the scene kit double.
 * @param component - the scene component under test.
 * @param close - the host's close callback (recorded by the arm that needs it).
 * @returns the rendered tree.
 */
function renderScene(kit: SceneKit, component: unknown, close: () => void = (): void => {}): unknown {
  kit.reset()
  return (component as (props: unknown) => unknown)({ React: kit.React, ui: kit.ui, close })
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

describe("the watchdog scene's registration (clause 3 / A3)", () => {
  test("it registers `mpd-tui-watchdog` with the page's own title and a callable component, and the open request reaches the host", () => {
    /** The descriptor the fake host was handed. */
    const captured: { descriptor?: Record<string, unknown> } = {}
    /** Every scene id the seam's open asked the host for. */
    const opened: string[] = []
    /** The fake adapter: only `registerScene` and `skipped` are touched at registration. */
    const tui = {
      registerScene: (descriptor: Record<string, unknown>, identity?: unknown): { outcome: () => { state: string; id: string; detail: string }; openScene: (id: string) => boolean } => {
        captured.descriptor = descriptor
        // THE IDENTITY IS FORWARDED: the host's own caller check refuses a registration without it, so a
        // seam that dropped it would look registered here and be refused in production.
        expect(identity).toBe("ctx")
        return { outcome: () => ({ state: "requested", id: "tuiScenes", detail: `${String(descriptor.id)} requested` }), openScene: (id: string) => { opened.push(id); return true } }
      },
      skipped: (): { outcome: () => { state: string; id: string; detail: string } } => ({ outcome: () => ({ state: "absent", id: "tuiScenes", detail: "skipped" }) }),
    }
    /** The scene's seam, registered. */
    const seam = registerWatchdogScene(tui as never, "ctx" as never, depsDouble().deps)
    expect(WATCHDOG_SCENE_ID).toBe("mpd-tui-watchdog")
    expect(captured.descriptor?.id).toBe("mpd-tui-watchdog")
    // THE TITLE IS THE PAGE'S OWN: the sidebar tab and the scene header must not name one surface twice.
    expect(captured.descriptor?.title).toBe(WATCHDOG_PANEL_TITLE)
    // The component the host receives is CALLABLE, i.e. a scene and not a placeholder.
    expect(typeof captured.descriptor?.component).toBe("function")
    expect(seam.registered()).toBe(true)
    expect(seam.open()).toBe(true)
    expect(opened).toEqual(["mpd-tui-watchdog"])
    // A config-disabled scene never registers at all, and its opens answer false rather than throwing.
    /** The seam with this row's `scene` knob off. */
    const disabled = registerWatchdogScene(tui as never, "ctx" as never, { ...depsDouble().deps, enabled: false })
    expect(disabled.scene).toBeUndefined()
    expect(disabled.registered()).toBe(false)
    expect(disabled.open()).toBe(false)
    expect(disabled.outcome().state).toBe("absent")
  })
})

describe("the scene draws the SAME body as the sidebar page (clause 3 / A3)", () => {
  test("for identical input the scene's body rows EQUAL the page's body rows, in the same order", () => {
    withLang("en", () => {
      /** The view both surfaces are handed: one held team and one unread incident. */
      const view: WatchdogView = { holds: ["team-a"], unread: [incident()] }
      /** The panel's kit (a wide terminal, so neither surface clamps a fixture line). */
      const panelKit = makeSceneKit(200, 30)
      /** The scene's kit. */
      const sceneKit = makeSceneKit(200, 30)
      /** The page's deps. */
      const panelDeps = depsDouble(view).deps
      /** The scene's deps — the SAME reads, which is what makes the comparison meaningful. */
      const sceneDeps = depsDouble(view).deps
      /** The body lines the shared builder produces for this input. */
      const expected = watchdogBodyRows({
        view,
        available: true,
        teams: watchdogTeamRows(view, () => ({ id: "team-a", phase: "active" })),
        now: Date.now(),
      }).map((row) => row.text)
      // THE PAGE FIRST: rendered through its own kit, exactly as the sidebar mounts it.
      /** The page's component. */
      const page = createWatchdogPanelComponent(panelDeps)
      /** The page's drawn rows. */
      const panelRows = panelKit.rows(renderScene(panelKit, page))
      // THE SCENE: its read lives in an effect, so the effects run and the page re-renders — a real mount.
      /** The scene's component. */
      const scene = createWatchdogSceneComponent(sceneDeps)
      renderScene(sceneKit, scene)
      sceneKit.runEffects()
      /** The scene's drawn rows after the mount read. */
      const sceneRows = sceneKit.rows(renderScene(sceneKit, scene))
      try {
        // BOTH SURFACES REALLY DREW THE SHARED BODY: an empty list would make the equality vacuous.
        expect(expected.length).toBeGreaterThan(4)
        for (const line of expected) {
          expect(panelRows).toContain(line)
          expect(sceneRows).toContain(line)
        }
        // …AND THE BODY ROWS ARE EQUAL IN ORDER, not merely present: filtering each surface to the shared
        // vocabulary is the strongest form of "scene rows equal panel rows for identical input".
        /** One surface's rows, restricted to the shared body vocabulary, in draw order. */
        const bodyOf = (rows: readonly string[]): string[] => rows.filter((row) => expected.includes(row))
        expect(bodyOf(sceneRows)).toEqual(expected)
        expect(bodyOf(panelRows)).toEqual(expected)
        expect(bodyOf(sceneRows)).toEqual(bodyOf(panelRows))
      } finally {
        // THE SCENE'S REFRESH TIMER IS CLEANED UP: a leaked interval would keep this process alive.
        sceneKit.runCleanups()
      }
    })
  })

  test("a tall view scrolls: at a non-zero offset the scene still draws the body and the pinned footer says where", () => {
    withLang("en", () => {
      /** Twelve incidents, so the body is far taller than a 20-row terminal. */
      const unread = Array.from({ length: 12 }, (_, index) => incident({ id: `inc-${index}`, at: NOW - 65_000 - index * 1_000 }))
      /** The view the scene draws. */
      const view: WatchdogView = { holds: ["team-a"], unread }
      /** The scene kit, short enough that the body must scroll. */
      const kit = makeSceneKit(120, 20)
      /** The scene's component. */
      const scene = createWatchdogSceneComponent(depsDouble(view).deps)
      /** Whether the host's close callback ran — the `q`/esc path, asserted below. */
      let closed = 0
      /** The mount render, which carries no body yet (the read is an effect). */
      renderScene(kit, scene, (): void => { closed += 1 })
      kit.runEffects()
      try {
        /** The rows after the mount read: the top of the body. */
        const atTop = kit.rows(renderScene(kit, scene, (): void => { closed += 1 }))
        expect(atTop.join("\n")).toContain("watchdog · 1 held · 12 unread")
        expect(atTop.join("\n")).toContain("1/25")
        // ONE PAGE DOWN: the window moves a whole viewport, so the header scrolls away and an incident is
        // on screen — the body is NON-EMPTY at a non-zero offset, which is the defect clause this asserts.
        /** The scene's live key listener (the LAST render's, as a mounted scene would hold). */
        const listener = kit.keys().at(-1)
        expect(listener).toBeDefined()
        listener?.("", { pageDown: true })
        /** The rows after the page-down. */
        const scrolled = kit.rows(renderScene(kit, scene, (): void => { closed += 1 }))
        expect(scrolled.length).toBeGreaterThan(0)
        expect(scrolled.join("\n")).not.toContain("watchdog · 1 held · 12 unread")
        expect(scrolled.join("\n")).toContain("escalate ·")
        // THE PINNED FOOTER PROVES THE OFFSET: its token is `offset + 1` over `max + 1`, and it is drawn
        // outside the window (the row a clipped frame used to lose).
        expect(scrolled.join("\n")).toContain("16/25")
        // …AND ESC LEAVES THE SCENE, never a no-op: the door a full-screen surface must have.
        listener?.("", { escape: true })
        expect(closed).toBe(1)
      } finally {
        kit.runCleanups()
      }
    })
  })
})

// ── the scene's rail is DRAGGABLE (frozen criteria I1/I2/I3) ────────────────
//
// THE USER'S REPORT class: a scene rail that cannot be dragged. This surface drew its rail as a plain
// `Box` with no pointer props, which the host's drag protocol cannot hit-test at all. The arm below
// drives the element the scene RENDERED — the shared `panel-core.ts` builder — and reads the position
// out of the scene's own footer token (`offset + 1 / max + 1`), so every step is a NUMBER: a DELTA
// commit is `anchor.offset + round(1 / travel * max)`, while the absolute mapping this wave removes
// would have jumped to the pointer's own cell.

/**
 * The element a rendered tree carries under one key, parents before children.
 * @param node - the tree (or one element/child list of it), of unknown shape.
 * @param key - the React key the element was created with.
 * @returns the element, or undefined when this render drew none.
 */
function elementByKey(node: unknown, key: string): Element | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      /** This child's own answer, when it holds the element. */
      const found = elementByKey(child, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  /** This node as an element. */
  const element = node as Element
  if (element.props?.key === key) return element
  return elementByKey(element.children ?? [], key)
}

describe("the watchdog scene's rail answers the pointer", () => {
  test("a grab parks, one cell moves by the DELTA, a click jumps, and the footer proves each step", () => {
    withLang("en", () => {
      /** Twelve incidents, so the body is far taller than a 20-row terminal. */
      const unread = Array.from({ length: 12 }, (_entry, index) => incident({ id: `inc-${index}`, at: NOW - 65_000 - index * 1_000 }))
      /** The view the scene draws: 39 body rows in a 15-row window, so `max = 24`. */
      const view: WatchdogView = { holds: ["team-a"], unread }
      /** The scene kit, short enough that the body must scroll. */
      const kit = makeSceneKit(120, 20)
      /** The scene's component. */
      const scene = createWatchdogSceneComponent(depsDouble(view).deps)
      renderScene(kit, scene)
      kit.runEffects()
      try {
        /** The rows after the mount read, at the top of the window. */
        const atTop = kit.rows(renderScene(kit, scene))
        // THE POSITION TOKEN IS THE MEASUREMENT: `1/25` is offset 0 of a 24-row band.
        expect(atTop.join("\n")).toContain("1/25")
        /** The rail element this render drew. */
        const rail = elementByKey(renderScene(kit, scene), "gutter")
        expect(rail).toBeDefined()
        // THE THREE DRAG PHASES AND THE CLICK (criteria I1/I3) are all on the element the host hit-tests.
        for (const prop of ["onDragStart", "onDragMove", "onDragEnd", "onClick"] as const) {
          expect(typeof rail?.props?.[prop]).toBe("function")
        }
        // THE BAND, in numbers: 15 rail cells, the thumb is `floor(15² / 39) = 5` of them, so the track
        // the pointer scrubs along is 10 cells over a 24-row offset band.
        expect(kit.rows(renderScene(kit, scene)).join("\n")).toContain("1/25")
        // THE GRAB COMMITS NOTHING: press far from the thumb with the press origin's absolute pair.
        ;(rail?.props?.onDragStart as (event: unknown) => void)({ localRow: 8, row: 40, startRow: 40 })
        expect(kit.rows(renderScene(kit, scene)).join("\n")).toContain("1/25")
        // THE ANCHOR SURVIVES THE RE-RENDER: the move arrives through the SECOND element.
        /** The next render's rail. */
        const nextRail = elementByKey(renderScene(kit, scene), "gutter")
        expect(nextRail).not.toBe(rail)
        ;(nextRail?.props?.onDragMove as (event: unknown) => void)({ localRow: 9, row: 41, startRow: 40 })
        /** The footer after one cell of pointer travel. */
        const dragged = kit.rows(renderScene(kit, scene)).join("\n")
        // ONE DELTA STEP: `0 + round(1 / 10 * 24) = 2`, so the token reads `3/25`. The ABSOLUTE mapping
        // would have committed `round(9 / 10 * 24) = 22` — the `23/25` this assertion excludes.
        expect(dragged).toContain("3/25")
        expect(dragged).not.toContain("23/25")
        // THE RELEASE CLEARS THE ANCHOR AND KEEPS THE POSITION.
        ;(nextRail?.props?.onDragEnd as (event: unknown) => void)({ localRow: 9 })
        expect(kit.rows(renderScene(kit, scene)).join("\n")).toContain("3/25")
        // A CLICK NAMES A DESTINATION (criterion I3): the track's fifth cell is `round(5 / 10 * 24) = 12`.
        ;(nextRail?.props?.onClick as (event: unknown) => void)({ localRow: 5 })
        expect(kit.rows(renderScene(kit, scene)).join("\n")).toContain("13/25")
      } finally {
        kit.runCleanups()
      }
    })
  })
})
