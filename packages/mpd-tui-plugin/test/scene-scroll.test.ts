// L3 — THE FULL-SCREEN TEAM SCENE'S WINDOW: scrollbar, whole-body reachability and the breath.
//
// WHAT THIS FILE PINS (frozen contract `.mpd/plans/tui-panel-wave.md` §5.A4):
//   (a) content taller than the window yields DIFFERENT rendered rows at offset 0 and at a non-zero
//       offset, and the LAST row of the scene body is reachable — the tail rows (the legend and the
//       contract's state key) that used to be pushed unconditionally and clipped by the host;
//   (b) a VISIBLE vertical scrollbar exists, drawn from `panel-core.ts`'s `gutterCells`, and its cells
//       DIFFER between two offsets — the thumb tracks the window;
//   (c) two distinct animation phases draw DIFFERENT glyphs for a running row, through the SAME frame
//       table the sidebar breathes with (`DAG_ANIM.runningFrames`), while a body that fits draws no
//       scrollbar and keeps exactly the rows it always drew.
//
// WHAT IT DOES NOT CLAIM. No live TTY capture (contract §7.1): the proof is a rendered tree from a host
// double plus the package's gates. The kit is the same shape the package's other scene suites use, so
// the scene runs under its real hooks — only the terminal, the clock and the element tree are doubles.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index"
import { BOARD_SCENE_ID, TEAM_SCENE_ID, registerScene } from "../src/scenes"
import { RUNNING_FRAMES } from "../src/subagent-scene"
import { DAG_ANIM, DAG_CHROME, DAG_TONE_GLYPH } from "../src/dag-theme"
import { legendLines } from "../src/graph"
import { legendLinesFor } from "../src/panel-core"
import { cellWidth } from "../src/sanitize"

// ── the host double ─────────────────────────────────────────────────────────

/** One task a fixture record carries, with every field the projection reads. */
interface FixtureTask {
  /** The task id the drawing labels. */
  id: string
  /** The subject the detail pane prints when the task is focused. */
  subject: string
  /** The record's own status, which decides the row's tone (and therefore whether it breathes). */
  status: string
  /** The ids this task waits for; the drawing ranks by them, so a chain is what makes it TALL. */
  blockedBy?: string[]
}

/** A rendered element, as the React double produces it. */
interface Element {
  /** The component or tag the element was created with. */
  type: unknown
  /** The props the scene passed. */
  props: Record<string, unknown>
  /** The children, exactly as `createElement` received them. */
  children: unknown[]
}

/** The host kit double: index-keyed hooks, captured key handlers and the timer the scene asked for. */
interface Kit {
  /** The React instance the scene must use. */
  React: Record<string, unknown>
  /** The ui kit the scene must use. */
  ui: Record<string, unknown>
  /** The interval each `useAnimationFrame` call asked for; `null` is the documented pause. */
  intervals: Array<number | null>
  /** Resets the hook index for the next render pass. */
  begin(): void
  /** Runs the effects the last render queued; true when any ran. */
  flush(): boolean
  /** Dispatches one key to the most recently registered handler. */
  press(input: string, key?: Record<string, unknown>): void
  /** Flattens the tree into one string per drawn row. */
  rows(tree: unknown): string[]
  /** The last tree flattened. */
  last(): unknown
}

/**
 * A minimal host kit double for the scene kit.
 *
 * `useAnimationFrame` is present unless the arm asked for `timer: "none"`, because the scene's clock is
 * the SCENE kit's pair — the panel kit's `useAnimationTime` is exactly what a full-screen scene does not
 * get (contract §3), so the pause assertion reads the interval this double was handed.
 * @param options - the measured terminal, which timer the kit exposes and the clock it answers.
 * @returns the kit.
 */
function makeKit(options: { columns?: number; rows?: number; timer?: "frame" | "none"; clock?: number } = {}): Kit {
  /** Hook state, keyed by hook position. */
  const store = new Map<string, unknown>()
  /** The key handlers the scene registered, most recent last. */
  const handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[] = []
  /** The interval each frame-loop call asked for. */
  const intervals: Array<number | null> = []
  /** Effects queued by the current render, run by `flush`. */
  let pending: (() => unknown)[] = []
  /** The hook counter of the current render pass. */
  let index = 0
  /** The last tree flattened. */
  let lastTree: unknown
  /** The React double: index-keyed hooks, effects deferred to `flush`. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This state cell's key, from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, typeof initial === "function" ? (initial as () => unknown)() : initial)
      return [
        store.get(key),
        (next: unknown) => store.set(key, typeof next === "function" ? (next as (prev: unknown) => unknown)(store.get(key)) : next),
      ]
    },
    useEffect: (fn: () => unknown): void => {
      /** This effect's key, from the hook position. */
      const key = `effect:${index}`
      index += 1
      if (store.has(key)) return
      store.set(key, true)
      pending.push(fn)
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
    useSyncExternalStore: (): void => {},
  }
  /** The Text component: a marker type the flattening recognises as ONE drawn row. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [] })
  /** The Box component: a marker type the flattening treats as a container. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [] })
  /** The clock a surface reading this kit sees, exactly as a host would answer it. */
  const clockValue = (): number => options.clock ?? 0
  /** The ui kit: a fixed measurement, a captured key hook and the timer this arm asked for. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    useInput: (handler: (input: string, key: Record<string, unknown> | undefined) => void): void => {
      handlers.push(handler)
    },
    useTerminalSize: (): { columns: number; rows: number } => ({ columns: options.columns ?? 100, rows: options.rows ?? 30 }),
  }
  if (options.timer !== "none") {
    ui.useAnimationFrame = (intervalMs: number | null): unknown => {
      intervals.push(intervalMs)
      return [undefined, clockValue()]
    }
  }

  return {
    React,
    ui,
    intervals,
    begin: (): void => {
      index = 0
    },
    flush: (): boolean => {
      /** The effects queued for this flush. */
      const list = pending
      pending = []
      for (const fn of list) fn()
      return list.length > 0
    },
    press: (input: string, key: Record<string, unknown> = {}): void => {
      /** The handler the scene last registered. */
      const handler = handlers[handlers.length - 1]
      if (handler !== undefined) handler(input, key)
    },
    rows: (tree: unknown): string[] => {
      lastTree = tree
      /** The drawn rows. */
      const out: string[] = []
      /** Every character inside one node; a row's spans join with nothing between them. */
      const inline = (node: unknown): string => {
        if (node === null || node === undefined) return ""
        if (typeof node === "string") return node
        if (typeof node === "number") return String(node)
        if (Array.isArray(node)) return node.map(inline).join("")
        /** This node as an element, the only shape left after the guards. */
        const element = node as Element
        return inline(element.props?.children) + inline(element.children ?? [])
      }
      /** Walk the tree one ROW at a time: a Text is a row, anything else is a container of rows. */
      const walk = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) {
          for (const child of node) walk(child)
          return
        }
        if (typeof node === "string" || typeof node === "number") {
          out.push(String(node))
          return
        }
        /** This node as an element. */
        const element = node as Element
        if (element.type === Text) {
          out.push(inline(node))
          return
        }
        for (const child of element.children ?? []) walk(child)
      }
      walk(tree)
      return out
    },
    last: (): unknown => lastTree,
  }
}

// ── fixtures, mounting and readers ──────────────────────────────────────────

/**
 * A team record with every field the projection reads.
 * @param tasks - the board's tasks, in record order.
 * @param overrides - record fields this arm states differently (the members, mostly).
 * @returns the record the fixture host serves.
 */
function fixtureRecord(tasks: readonly FixtureTask[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    teamId: "team-20261106230000",
    name: "scene-scroll",
    description: "the l3 window",
    leadSessionId: "lead-session-l3",
    phase: "running",
    createdAt: "2026-11-06T23:00:00.000Z",
    members: [
      { id: "M1", name: "Architect", description: "design", role: "design", status: "idle", spawnedAt: "2026-11-06T23:00:01.000Z" },
    ],
    tasks: tasks.map((task) => ({ blockedBy: [], ...task })),
    nextMemberNumber: 2,
    nextTaskNumber: tasks.length + 1,
    ...overrides,
  }
}

/**
 * A ten-rank chain, whose boxed drawing is TALLER than the scene's window on a 30-row terminal.
 * @returns the record the fixture host serves.
 */
function longChain(status: string = "pending"): Record<string, unknown> {
  return fixtureRecord(Array.from({ length: 10 }, (_entry, index) => ({
    id: `w${index + 1}`,
    subject: `task ${index + 1}`,
    status: index === 9 ? status : "pending",
    blockedBy: index === 0 ? [] : [`w${index}`],
  })))
}

/** The scenes one mount produced, with the kit that renders them. */
interface Mounted {
  /** The team scene component. */
  component: unknown
  /** Every registered component, by scene id — the board scene's audit arm mounts through this. */
  components: Record<string, unknown>
  /** The kit to render it with. */
  kit: Kit
}

/**
 * Register the scenes over an in-memory record and hand back the team component.
 * @param record - the record the fixture workspace holds.
 * @param options - the measured terminal, the clock and which timer the kit exposes.
 * @returns the team component and its kit.
 */
function mount(record: Record<string, unknown>, options: { columns?: number; rows?: number; timer?: "frame" | "none"; clock?: number } = {}): Mounted {
  /** A throwaway workspace: the projection reads plans/boulder/workmates from it and finds none. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-scene-scroll-"))
  /** The registered components, by id. */
  const components: Record<string, unknown> = {}
  /** The services this composition exposes — the scene seam, and nothing else. */
  const services: Record<string, unknown> = {
    tuiScenes: {
      register: (descriptor: { id: string; component: unknown }) => {
        components[descriptor.id] = descriptor.component
      },
      open: () => true,
    },
  }
  /** The context double: it injects a scope only for the services it really holds. */
  const ctx = {
    inject: (deps: readonly string[], callback: (scoped: Record<string, unknown>) => void) => {
      if (deps.every((id) => services[id] !== undefined)) callback({ get: (name: string) => services[name] })
      return {}
    },
    get: () => undefined,
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  }
  registerScene(
    ctx as never,
    createTuiAdapter(ctx as never),
    { debug: () => {}, info: () => {}, warn: () => {} } as never,
    () => workspace,
    () => workspace,
    () => [],
    { available: () => false, approve: async () => ({ ok: false }), discard: async () => ({ ok: false }) },
    () => undefined,
    () => [],
    () => [record as never],
  )
  return { component: components[TEAM_SCENE_ID], components, kit: makeKit(options) }
}

/**
 * Render the scene until its effects settle.
 * @param kit - the host kit.
 * @param component - the scene component.
 * @returns one string per drawn row.
 */
function render(kit: Kit, component: unknown): string[] {
  /** The props a host passes to a scene. */
  const props = { React: kit.React, ui: kit.ui, close: () => {}, channel: undefined }
  /** The last rendered tree. */
  let tree: unknown
  for (let pass = 0; pass < 5; pass += 1) {
    kit.begin()
    tree = (component as (props: unknown) => unknown)(props)
    if (!kit.flush()) break
  }
  return kit.rows(tree)
}

/**
 * Every element of a rendered tree, parents before children.
 * @param node - the tree, one element or one child list of it.
 * @param visit - called once per element, in draw order.
 */
function walkElements(node: unknown, visit: (element: Element) => void): void {
  if (node === null || node === undefined || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visit)
    return
  }
  /** This node as an element. */
  const element = node as Element
  visit(element)
  for (const child of element.children ?? []) walkElements(child, visit)
}

/**
 * Every scrollbar cell the render drew, top to bottom.
 * @param tree - the tree the kit last flattened.
 * @returns the cells; empty when the body fits and no scrollbar is drawn.
 */
function scrollbarCells(tree: unknown): string[] {
  /** The cells, in row order. */
  const cells: Array<{ row: number; cell: string }> = []
  walkElements(tree, (element) => {
    /** This element's key, when it carries one. */
    const key = element.props?.key
    if (typeof key !== "string" || !key.startsWith("vbar-")) return
    /** The row this cell belongs to, from the key's own suffix. */
    const row = Number(key.slice("vbar-".length))
    /** The cell's own character, which the kit carries as the Text's only child. */
    const cell = element.children.map((child) => String(child)).join("")
    cells.push({ row, cell })
  })
  return cells.sort((left, right) => left.row - right.row).map((entry) => entry.cell)
}

/**
 * Everything the DAG BOX itself drew, its spans joined — the drawing, without the legend under it.
 * @param tree - the tree the kit last flattened.
 * @returns the drawing's characters; empty when this render drew no graph at all.
 */
function graphText(tree: unknown): string {
  /** The graph element, found by the key the scene gives it. */
  let graph: Element | undefined
  walkElements(tree, (element) => {
    if (graph === undefined && element.props?.key === "graph") graph = element
  })
  if (graph === undefined) return ""
  /** Every character inside one node, spans joined with nothing — the kit's own flattening rule. */
  const inline = (node: unknown): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") return node
    if (typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(inline).join("")
    /** This node as an element, the only shape left after the guards. */
    const element = node as Element
    return inline(element.props?.children) + inline(element.children ?? [])
  }
  return inline(graph.children ?? [])
}

// ── (a) the body is reachable, not just a slice of the drawing ──────────────

describe("the team scene windows its WHOLE body, not only the drawing", () => {
  test("content taller than the window draws different rows at offset 0 and at the far edge", () => {
    // The tail rows (the legend and the contract's state key) used to be pushed unconditionally and
    // clipped by the host; they are now inside the same window as the drawing, so they must be REACHED
    // by scrolling rather than merely existing below the frame.
    /** This arm's mount: a ten-rank chain on a 30-row terminal. */
    const { component, kit } = mount(longChain(), { columns: 100, rows: 30 })
    /** The scene at the top of the window. */
    const atTop = render(kit, component)
    // The legend is composed for the width the scrolling pass laid out for: the frame's border (2) and
    // padding (2) plus the scrollbar's own column (1) are not the drawing's cells.
    const budget = 100 - 5
    /** The composed legend, whose LAST line is the scene body's last row. */
    const composed = legendLinesFor(budget, legendLines(budget))
    /** The legend's own first line, which is the first tail row. */
    const firstLegend = legendLines(budget)[0] ?? ""
    /** The body's last row, which the state-key composer appends. */
    const lastBodyRow = composed.at(-1) ?? ""
    expect(firstLegend).not.toBe("")
    expect(lastBodyRow).not.toBe("")
    // AT THE TOP the drawing fills the window, so the tail is NOT drawn yet: this is the window doing
    // its job, not a missing row.
    expect(atTop.some((row) => row.includes(firstLegend))).toBe(false)
    expect(atTop.some((row) => row.includes(lastBodyRow))).toBe(false)
    // The FOOTER is pinned, so it is on screen in both frames — the keys that move the window never
    // scroll away from it.
    expect(atTop.join("\n")).toContain("esc/q close")
    // `End` moves the window to the far edge, where the drawing's first row has left and the LAST row
    // of the scene body is on screen: the whole body is reachable.
    kit.press("", { end: true })
    /** The scene at the far edge. */
    const atEnd = render(kit, component)
    expect(atEnd.some((row) => row.includes(lastBodyRow))).toBe(true)
    // THE RAIL IS ITS OWN COLUMN (the host lays it beside the body), so the double's row walk emits its
    // cells between the body's rows and the pinned footer. Cutting them off is what lets this arm read
    // the body's own order: the last row of the WINDOW carries the composed key's last line, which is
    // the whole point — the reader reached the bottom rather than a row short of it.
    /** The window's rows, with the rail's cells (a column, not rows) set aside. */
    const bodyRows = atEnd.slice(0, atEnd.length - 1 - scrollbarCells(kit.last()).length)
    expect(bodyRows.at(-1)).toContain(lastBodyRow)
    // The footer stayed PINNED at the bottom while the body moved.
    expect(atEnd.at(-1)).toContain("esc/q close")
    // The drawing's FIRST task has scrolled out and the LAST one is on screen, which is what makes this
    // a WINDOW over the body rather than a one-row nudge.
    expect(atTop.join("\n")).toContain("○ w1 ")
    // `w1`'s own label cell, which stops drawing once the window leaves the first rank; `w10` is still
    // on screen, so the assertion cannot pass by the drawing going blank.
    expect(atEnd.join("\n")).not.toContain("○ w1 ")
    expect(atEnd.join("\n")).toContain("○ w10 ")
    // The two frames are DIFFERENT row lists — the contract's own acceptance wording.
    expect(atEnd).not.toEqual(atTop)
    // And the window never draws a row wider than the terminal it measured.
    for (const row of atEnd) expect(cellWidth(row)).toBeLessThanOrEqual(100)
  })

  test("a body that fits draws NO scrollbar and keeps every row", () => {
    // A short board must be untouched by this wave: no rail over content that does not scroll, and the
    // legend and state key still appear under the drawing exactly as they did.
    /** This arm's mount: three tasks in a chain, well inside a 30-row terminal. */
    const { component, kit } = mount(fixtureRecord([
      { id: "t1", subject: "root", status: "completed" },
      { id: "t2", subject: "middle", status: "pending" },
      { id: "t3", subject: "leaf", status: "pending" },
    ]), { columns: 100, rows: 30 })
    /** The rendered rows. */
    const rows = render(kit, component)
    expect(scrollbarCells(kit.last())).toHaveLength(0)
    /** The composed legend at the width the scene lays out for when nothing scrolls (no rail column). */
    const composed = legendLinesFor(100 - 4, legendLines(100 - 4))
    for (const line of composed) expect(rows.some((row) => row.includes(line))).toBe(true)
  })
})

// ── (b) the scrollbar is VISIBLE and its thumb tracks the offset ────────────

describe("the vertical scrollbar is drawn, and its thumb tracks the window", () => {
  test("the cells DIFFER between two offsets, and the thumb's track is the contract's own", () => {
    /** This arm's mount: the same ten-rank chain. */
    const { component, kit } = mount(longChain(), { columns: 100, rows: 30 })
    render(kit, component)
    /** The scrollbar at the top of the window. */
    const atTop = scrollbarCells(kit.last())
    // A VISIBLE rail: one cell per row the window shows, drawn from `gutterCells` (so every cell is one
    // of the contract's two bar glyphs, never a literal spelled by the scene).
    expect(atTop.length).toBeGreaterThan(1)
    expect(atTop.every((cell) => cell === DAG_CHROME.barFull || cell === DAG_CHROME.barEmpty)).toBe(true)
    // The thumb is AT THE TOP: the first cell is the thumb's, the last cell is track.
    expect(atTop[0]).toBe(DAG_CHROME.barFull)
    expect(atTop[atTop.length - 1]).toBe(DAG_CHROME.barEmpty)
    kit.press("", { end: true })
    render(kit, component)
    /** The scrollbar at the far edge of the same window. */
    const atEnd = scrollbarCells(kit.last())
    expect(atEnd).toHaveLength(atTop.length)
    // The THUMB MOVED: the cells are different strings, and the thumb's own band starts lower.
    expect(atEnd).not.toEqual(atTop)
    expect(atEnd.lastIndexOf(DAG_CHROME.barFull)).toBeGreaterThan(atTop.lastIndexOf(DAG_CHROME.barFull))
    expect(atEnd[0]).toBe(DAG_CHROME.barEmpty)
    expect(atEnd[atEnd.length - 1]).toBe(DAG_CHROME.barFull)
  })
})

// ── (c) the breath, on the scene's OWN clock ────────────────────────────────

describe("running markers breathe through the sidebar's own frame set", () => {
  /** A board whose only running task is visible in the drawing's first window. */
  const running = (): Record<string, unknown> => fixtureRecord([
    { id: "t1", subject: "work", status: "in_progress" },
    { id: "t2", subject: "next", status: "pending" },
  ])

  test("two distinct phases draw DIFFERENT glyphs for the running row", () => {
    // The SCENE kit exposes no `useAnimationTime`, so the breath is read off the scene's own clock —
    // the same `DAG_ANIM.runningFrames` table the sidebar walks, one frame per tick.
    /** The first frame's mount. */
    const first = mount(running(), { columns: 100, rows: 30, timer: "frame", clock: 0 })
    render(first.kit, first.component)
    /** The first frame's drawing. */
    const firstDraw = graphText(first.kit.last())
    /** The second frame's mount — one tick later on the same clock. */
    const second = mount(running(), { columns: 100, rows: 30, timer: "frame", clock: DAG_ANIM.intervalMs })
    render(second.kit, second.component)
    /** The second frame's drawing. */
    const secondDraw = graphText(second.kit.last())
    expect(firstDraw).not.toBe(secondDraw)
    // The frames are the CONTRACT's, not a private orbit: frame 0 is the published `running` glyph and
    // frame 1 is the table's second mark.
    expect(firstDraw).toContain(RUNNING_FRAMES[0] ?? "")
    expect(secondDraw).toContain(RUNNING_FRAMES[1] ?? "")
    expect(firstDraw).not.toContain(RUNNING_FRAMES[1] ?? "")
    expect(RUNNING_FRAMES[0]).toBe(DAG_TONE_GLYPH.running ?? "◐")
  })

  test("the host's frame loop is PAUSED when nothing runs and asks for the tick when something does", () => {
    // "The animation stops when nothing runs" is a property of the HOST's timer, not of the glyph: a
    // scene that kept the loop alive would page the host forever on a board with no live marker.
    /** A mount whose board is entirely settled and whose roster is idle. */
    const idle = mount(fixtureRecord([
      { id: "t1", subject: "done", status: "completed" },
      { id: "t2", subject: "wait", status: "pending" },
    ]), { columns: 100, rows: 30, timer: "frame", clock: 0 })
    render(idle.kit, idle.component)
    // `null` is the documented pause of the one legal scene timer.
    expect(idle.kit.intervals.length).toBeGreaterThan(0)
    expect(idle.kit.intervals.every((interval) => interval === null)).toBe(true)
    /** A mount with one live task, which is what must start the loop again. */
    const live = mount(running(), { columns: 100, rows: 30, timer: "frame", clock: 0 })
    render(live.kit, live.component)
    expect(live.kit.intervals.length).toBeGreaterThan(1)
    // THE FIRST PASS PREDATES THE PROJECTION (nothing is known to be running yet, so the loop stays
    // paused); once the read lands, every render asks for the tick.
    expect(live.kit.intervals[0]).toBe(null)
    expect(live.kit.intervals.at(-1)).toBe(DAG_ANIM.intervalMs)
    // With no timer at all the surface still renders, drawing the frozen static frame.
    /** A mount whose host exposes no timer. */
    const none = mount(running(), { columns: 100, rows: 30, timer: "none" })
    render(none.kit, none.component)
    /** Its drawing: the static frame, never a stalled intermediate. */
    const staticDraw = graphText(none.kit.last())
    expect(staticDraw).toContain(DAG_TONE_GLYPH.running ?? "◐")
  })
})

// ── the audit: the merged BOARD scene's window ──────────────────────────────

describe("the merged board scene windows its body too (contract §5.A4's audit item)", () => {
  test("a short terminal windows the board lines with the same rail, and the last line is reachable", () => {
    // THE DEFECT THIS LOCKS: the board scene had NO scroll at all — every line was pushed and the host
    // clipped the tail on a terminal shorter than the board. It now shares `windowedBody`/`gutterCells`
    // with the team scene, so one arithmetic and one rail describe both pages.
    /** This arm's mount at a terminal SHORTER than the board it draws. */
    const { components, kit } = mount(fixtureRecord([
      { id: "t1", subject: "root", status: "completed" },
      { id: "t2", subject: "leaf", status: "pending", blockedBy: ["t1"] },
    ]), { columns: 100, rows: 12 })
    /** The board scene. */
    const board = components[BOARD_SCENE_ID]
    /** The board at the top of its window. */
    const atTop = render(kit, board)
    /** The rail the board drew. */
    const rail = scrollbarCells(kit.last())
    // A VISIBLE rail, from the same helper and therefore the same glyphs as the team scene's.
    expect(rail.length).toBeGreaterThan(1)
    expect(rail.every((cell) => cell === DAG_CHROME.barFull || cell === DAG_CHROME.barEmpty)).toBe(true)
    // The FIRST board line is on screen at the top, and the last one is below the window.
    expect(atTop.join("\n")).toContain("workspace  ")
    expect(atTop.join("\n")).not.toContain("workmates")
    // `End` reaches the last line, and the pinned header/footer stayed put.
    kit.press("", { end: true })
    /** The board at the far edge. */
    const atEnd = render(kit, board)
    expect(atEnd.join("\n")).toContain("workmates")
    expect(atEnd.at(-1)).toContain("esc/q close")
    expect(atEnd.at(-1)).toContain("⇧↑↓ scroll")
    // The rail's thumb moved, which is what says the two frames are two POSITIONS of one body.
    expect(scrollbarCells(kit.last())).not.toEqual(rail)
  })
})
