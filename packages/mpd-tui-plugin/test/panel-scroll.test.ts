// THE WORKMATE PAGE'S SCROLL WINDOW AND THE TWO SHARED RAILS — the L1 scroll-engine lane's own arms.
//
// WHAT THE USER REPORTED: dragging the sidebar page's scrollbar made the content jump and the text
// disappear. Three defects are visible from the RENDERED TREE, and every arm below drives the real
// component through a host-kit double (hooks keyed by position, as React keys them) rather than
// asserting a page's internals:
//   1. the WORKMATE page sliced its own window AND handed the one-element result to
//      `panelViewportBody`, which slices again — at any offset above zero the body was EMPTY while the
//      footer still printed a position. `panel-dag.ts` and `panel-watchdog.ts` already pass the full
//      child list plus a `rowWrapper`; this lane is the workmate page catching up.
//   2. both the workmate and the watchdog page budgeted their rows against the frame's interior
//      WITHOUT the one cell the gutter rail reserves as a row sibling (panel-core lays the rows and
//      the rail side by side), so the interior drew one cell too wide. The DAG page subtracts it.
//   3. the shared rail handlers committed an ABSOLUTE offset from the pointer position, so grabbing
//      the thumb anywhere but its top cell jumped the view. A drag must move the view by the pointer's
//      DELTA, anchored where the drag began.
//
// WHAT IS VERIFIED HERE AND WHAT IS NOT. These arms verify the RENDERED TREE the host receives: the
// body rows at a non-zero offset, every row's cell width against the frame's interior, the rail's
// mapped offsets and the wheel's propagation stopper. They do not claim a live TTY capture — a real
// terminal frame is outside this lane's evidence (the wave contract §7 states the same bound).
import { describe, expect, test } from "bun:test"
import { panelContentWidth, panelViewportBody, usePanelViewport, viewportGutter, viewportRail, type PanelKit } from "../src/panel-core"
import { createWorkmatePanelComponent, type WorkmateEntry, type WorkmateLibrary } from "../src/panel-workmate"
import { cellWidth } from "../src/sanitize"

// ── the host-kit double ─────────────────────────────────────────────────────

/** One rendered node: the component identity, its props and the children React would reconcile. */
interface FakeNode {
  /** The component or host tag the element was built with. */
  type: unknown
  /** The element's props, including its React `key`. */
  props: Record<string, unknown>
  /** The element's children, in draw order. */
  children: unknown[]
}

/** The double's own handle: the React/ui pair a page receives, plus the render-pass reset. */
interface FakeKit {
  /** The React double the page must use. */
  React: Record<string, unknown>
  /** The ui kit double the page must use. */
  ui: Record<string, unknown>
  /** Starts a new render pass, so hook slots are keyed from the same position again. */
  reset(): void
  /** Every state cell's value, in the order the cells were first created — what React would compare. */
  stateValues(): unknown[]
}

/**
 * A minimal host kit double: index-keyed hook state and refs, and a fixed reported geometry.
 *
 * `useEffect` is counted but never run on purpose: the workmate page's refresh tick would start a real
 * interval, and a key listener is not needed by any arm here (the wheel and the rail handlers are found
 * in the tree and called directly).
 * @param columns - the panel width the host reports through `useTerminalSize`.
 * @param rows - the panel height the host reports through `useTerminalSize`.
 * @returns the kit double.
 */
function makeHarness(columns: number, rows: number): FakeKit {
  /** Hook cells and refs, keyed by their position in the render pass. */
  const store = new Map<string, unknown>()
  /** The hook counter of the current render pass. */
  let index = 0

  /** The React double: every hook call is one stable slot. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): FakeNode => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This state cell's key, derived from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, initial)
      return [
        store.get(key),
        (next: unknown): void => {
          store.set(key, next);
        },
      ]
    },
    useEffect: (): void => {
      index += 1
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, derived from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }

  /** The Text component: one host row. */
  const Text = (props: { children?: unknown }): FakeNode => ({ type: Text, props: props as Record<string, unknown>, children: [props?.children] })
  /** The Box component: the host's row container, flattened one child per row. */
  const Box = (props: { children?: unknown }): FakeNode => ({ type: Box, props: props as Record<string, unknown>, children: [props?.children] })

  /** The ui kit, with the fixed geometry this arm was built for. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    ScrollBox: Box,
    useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows }),
  }

  return {
    React,
    ui,
    reset: (): void => {
      index = 0
    },
    stateValues: (): unknown[] =>
      [...store.entries()].filter(([key]) => key.startsWith("state:")).map(([, value]) => value),
  }
}

/**
 * The kit double as `panel-core`'s own narrow contract sees it.
 * @param kit - the kit double.
 * @returns the same object, typed as the host kit.
 */
function coreKit(kit: FakeKit): PanelKit {
  return kit as unknown as PanelKit
}

/**
 * Render one page component, starting a fresh hook pass.
 * @param page - the component factory's component.
 * @param kit - the kit double.
 * @returns the rendered tree.
 */
function renderPage(page: (props: unknown) => unknown, kit: FakeKit): unknown {
  kit.reset()
  return page({ React: kit.React, ui: kit.ui, focused: false, visible: false })
}

/**
 * Every character inside one node, nested spans joined with nothing.
 * @param node - the node to flatten.
 * @returns the node's whole text.
 */
function inlineText(node: unknown): string {
  if (node === null || node === undefined) return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(inlineText).join("")
  /** This node as an element; the guards above leave only that shape. */
  const element = node as FakeNode
  return inlineText(element.props?.children) + inlineText(element.children ?? [])
}

/**
 * The drawn rows below one node, in DRAW order.
 *
 * A `Box` is the host's column, so each of its children is walked separately; anything else is one
 * host row and its own nested spans are joined into a single string.
 * @param node - the tree to walk.
 * @param kit - the kit whose `Box` identity marks a column.
 * @returns one string per drawn row.
 */
function drawnRows(node: unknown, kit: FakeKit): string[] {
  /** The rows, in draw order. */
  const out: string[] = []
  /** Walks one node. */
  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (const child of value) walk(child)
      return
    }
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value))
      return
    }
    /** This node as an element; the guards above leave only that shape. */
    const element = value as FakeNode
    if (element.type === kit.ui.Box) {
      for (const child of element.children ?? []) walk(child)
      return
    }
    out.push(inlineText(value))
  }
  walk(node)
  return out
}

/**
 * Find the first element carrying one React key.
 * @param node - the tree to search.
 * @param key - the React key to match.
 * @returns the element, or undefined when the tree carries no such key.
 */
function findByKey(node: unknown, key: string): FakeNode | undefined {
  if (node === null || node === undefined) return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      /** The first match below this child, when it holds one. */
      const found = findByKey(child, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node !== "object") return undefined
  /** This node as an element. */
  const element = node as FakeNode
  if (element.props?.key === key) return element
  for (const child of element.children ?? []) {
    /** The first match below this child, when it holds one. */
    const found = findByKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Build one element through the kit double, typed for the elements these arms construct directly.
 *
 * The kit's `React` member is a plain record (the page receives it across the same untyped boundary the
 * host uses), so its `createElement` is `unknown` to the compiler; this helper is the ONE place the test
 * narrows it, instead of a cast at every arm.
 * @param kit - the kit double.
 * @param type - the component or tag the element is built with.
 * @param props - the element's props.
 * @param children - the element's children, in draw order.
 * @returns the rendered node.
 */
function buildNode(kit: FakeKit, type: unknown, props: Record<string, unknown>, ...children: unknown[]): FakeNode {
  return (kit.React.createElement as (...args: unknown[]) => FakeNode)(type, props, ...children)
}

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * The workmate library fixture: `count` instances, each drawn as five rows plus a separator.
 *
 * The description and the note are longer than any sidebar row on purpose: the page must CLAMP them,
 * which is what makes an over-budget row visible as an exact cell width instead of a happy accident.
 * @param count - how many instances the shelf holds.
 * @returns the library projection the page renders.
 */
function libraryFixture(count: number): WorkmateLibrary {
  /** The instances, in shelf order. */
  const entries: WorkmateEntry[] = []
  for (let index = 0; index < count; index += 1) {
    entries.push({
      key: `workmate-${index}`,
      name: `Workmate ${index}`,
      base: "Deep Worker",
      description: `description ${index} ${"d".repeat(120)}`,
      note: `note ${index} ${"n".repeat(120)}`,
      uses: index + 1,
      updatedAt: "2026-10-01",
      readonlyBase: false,
    })
  }
  return { entries, archived: 0, root: "/sandbox/.mpd/workmate", problems: [] }
}

/** The page component the arms drive, over a three-instance shelf. */
function workmatePage(): (props: unknown) => unknown {
  return createWorkmatePanelComponent(() => libraryFixture(3)) as (props: unknown) => unknown
}

/**
 * The body rows of one rendered workmate page — the windowed content, never its rail or the pinned
 * chrome, which is what the user sees disappear.
 * @param tree - the rendered page.
 * @param kit - the kit the page was rendered with.
 * @returns the drawn body rows, in order.
 */
function bodyRows(tree: unknown, kit: FakeKit): string[] {
  /** `panelViewportBody`'s rows column, the FIRST child of its window box. */
  const rowsBox = findByKey(tree, "window")?.children[0]
  return drawnRows(rowsBox, kit)
}

// ── (a) the double-sliced window ────────────────────────────────────────────

describe("(a) the workmate body at a non-zero offset", () => {
  test("stays NON-EMPTY and is the shelf shifted by exactly one row", () => {
    /** The kit: 12 rows tall, so the 9-row window is shorter than the 19-row shelf. */
    const kit = makeHarness(60, 12)
    /** The page under test. */
    const page = workmatePage()
    // Offset 0: the header and the first entries fill the window.
    /** The rendered page before any gesture. */
    const first = renderPage(page, kit)
    /** The body the reader sees at offset 0. */
    const before = bodyRows(first, kit)
    expect(before.length).toBe(9)
    // ONE wheel tick: `deltaY: 1` moves the view down by one row, which is the gesture that used to
    // leave the page blank. The handler is the body's OWN wrapper — the same element the host hit-tests.
    /** The body's wheel wrapper, as the page handed it to the host. */
    const wheelBox = findByKey(first, "scroll")
    expect(wheelBox).toBeDefined()
    expect(typeof wheelBox?.props.onWheel).toBe("function")
    ;(wheelBox?.props.onWheel as (event: unknown) => void)({ deltaY: 1 })
    // Re-render as the host does after the state update: same kit, same hook slots, live refs moved.
    /** The rendered page after the wheel tick. */
    const second = renderPage(page, kit)
    /** The body the reader sees at offset 1. */
    const after = bodyRows(second, kit)
    // THE DEFECT: before the fix this was `[]` — the page sliced its own rows into one wrapper element
    // and `panelViewportBody` sliced THAT one-element array at offset 1, so the window was empty while
    // the footer still printed `2/11`.
    expect(after.length).toBeGreaterThan(0)
    // THE WINDOW MOVED BY ONE ROW, not to some absolute guess: the rows both windows share are the rows
    // that sat one position lower before the gesture.
    expect(after.length).toBe(before.length)
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(1))
    // AND THE LAST ROW IS NEW: the window slid down the shelf instead of re-drawing the same page.
    expect(after[after.length - 1]).not.toBe(before[before.length - 1])
  })

  test("NEGATIVE CONTROL: the pre-fix call shape — ONE pre-sliced element — IS the empty body", () => {
    /** The kit. */
    const kit = makeHarness(60, 12)
    /** A page long enough to overflow, positioned one row in — exactly where the defect showed. */
    const viewport = usePanelViewport(coreKit(kit), () => ({ contentRows: 100, viewportRows: 10 }))
    viewport.scrollTo(1)
    /** The page's OLD shape: its own slice wrapped in ONE element, handed in as a one-element array. */
    const preSliced = buildNode(kit, kit.ui.Box, { key: "scroll" }, buildNode(kit, kit.ui.Text, { key: "row" }, "row one"))
    /** What the helper makes of that shape — the reported blank window, reproduced without any page. */
    const legacy = panelViewportBody(coreKit(kit), [preSliced], viewport)
    /** `panelViewportBody`'s rows column, the FIRST child of its window box. */
    const legacyRows = (legacy.find((node) => (node as FakeNode).props?.key === "window") as FakeNode | undefined)?.children[0]
    // THE DEFECT, PINNED: the helper slices the ONE element away, so the body is empty at offset 1.
    expect(drawnRows(legacyRows, kit)).toEqual([])
    // …and the SAME slice, taken by the helper over the whole row list as `rowWrapper` intends, is not.
    /** Two rows, as a page hands them over now: the FULL list, never its own window. */
    const flat = [buildNode(kit, kit.ui.Text, { key: "r0" }, "row one"), buildNode(kit, kit.ui.Text, { key: "r1" }, "row two")]
    /** The wrapper the fixed page passes, binding its wheel to the slice it receives. */
    const wrapper = (boundKit: PanelKit, rows: readonly unknown[]): unknown => boundKit.React.createElement(boundKit.ui.Box, { key: "scroll" }, ...rows)
    /** The fixed call shape. */
    const fixed = panelViewportBody(coreKit(kit), flat, viewport, true, wrapper)
    /** The rows column of the fixed body. */
    const fixedRows = (fixed.find((node) => (node as FakeNode).props?.key === "window") as FakeNode | undefined)?.children[0]
    expect(drawnRows(fixedRows, kit)).toEqual(["row two"])
  })
})

// ── (b) the gutter cell ─────────────────────────────────────────────────────

describe("(b) the frame interior and the reserved gutter cell", () => {
  test("every workmate row fits interior − 1 while the rail is drawn", () => {
    /** The reported panel width; the frame's own two border cells come out of it. */
    const columns = 40
    /** The cells the frame leaves the page. */
    const interior = panelContentWidth(columns)
    expect(interior).toBe(38)
    /** The budget once the one-cell rail is laid out beside the rows. */
    const budget = interior - 1
    /** A panel short enough that the shelf overflows and the rail IS reserved. */
    const kit = makeHarness(columns, 12)
    /** The rendered page. */
    const tree = renderPage(workmatePage(), kit)
    /** The rail must be present for this arm to mean anything. */
    expect(findByKey(tree, "gutter")).toBeDefined()
    /** Every drawn row: the title row, the windowed body and the footer. */
    const rows = drawnRows(findByKey(tree, "frame"), kit)
    expect(rows.length).toBeGreaterThan(0)
    // THE DEFECT: the page budgeted 38 cells, so every clamped row was one cell wider than the room
    // the rows column actually had next to the rail — the host wrapped or clipped that cell.
    for (const row of rows) expect(cellWidth(row)).toBeLessThanOrEqual(budget)
    // THE BUDGET IS USED, not merely respected: a fixed row shorter than the budget would pass the
    // check above for the wrong reason.
    expect(rows.some((row) => cellWidth(row) === budget)).toBe(true)
  })
})

// ── (c) the rail drag moves by the pointer's delta ──────────────────────────

describe("(c) a grabbed rail moves the view by the pointer's delta", () => {
  test("a VERTICAL grab at the thumb's edge does not jump, and one cell moves one step", () => {
    /** The kit. */
    const kit = makeHarness(60, 12)
    /** A 100-row page in a 10-row window: `max = 90`, the thumb is 1 cell, the track is 9. */
    const viewport = usePanelViewport(coreKit(kit), () => ({ contentRows: 100, viewportRows: 10 }))
    // A mid-range position whose thumb top does NOT map back to itself: under the old ABSOLUTE
    // mapping, grabbing the thumb at row 5 would have committed `round(5 / 9 * 90) = 50`.
    viewport.scrollTo(45)
    /** The rail as this render draws it; its handlers are what the host hit-tests. */
    const startRail = viewportGutter(coreKit(kit), viewport)
    expect(startRail).toBeDefined()
    /** The handler set of a rendered rail. */
    const startProps = (startRail as FakeNode).props
    // THE REAL PROTOCOL SHAPE: the host opens a drag only on the FIRST MOTION (its own
    // `drag-event.js`: the session "stays dormant until the first drag motion — `dragstart` fires
    // then"), so the event carries BOTH the first-motion local cell and the press origin's absolute
    // pair. The finger went down at rail row 5 and the first motion reached row 6 (absolute row 30,
    // press row 29), and the old ABSOLUTE mapping would have committed `round(6 / 9 * 90) = 60` here.
    ;(startProps.onDragStart as (event: unknown) => void)({ localRow: 6, row: 30, startRow: 29 })
    // THE GRAB ITSELF COMMITS NOTHING: the pointer's position is an ANCHOR, not an offset.
    expect(viewport.offset).toBe(45)
    // A SECOND render's rail element: the anchor must survive the re-render the first move causes. A
    // per-render closure would lose it and fall back to the absolute mapping, which is the defect.
    /** The rail of the next render. */
    const movedRail = viewportGutter(coreKit(kit), viewport) as FakeNode
    ;(movedRail.props.onDragMove as (event: unknown) => void)({ localRow: 7, row: 31, startRow: 29 })
    // TWO cells from the PRESS ORIGIN (5), not from where `dragstart` happened to fire (6): 45 + 2/9.
    expect(viewport.offset).toBe(65)
    // The release phase keeps the same anchor until it clears it.
    ;(movedRail.props.onDragEnd as (event: unknown) => void)({ localRow: 7 })
    expect(viewport.offset).toBe(65)
    // THE ACCEPTANCE SHAPE — a ONE-CELL drag: press at 5, one motion, release at 6. It must move by
    // ONE step (10 rows), not jump to the absolute 60 a pointer at cell 6 would name, and not drop the
    // motion it started with.
    ;(movedRail.props.onDragStart as (event: unknown) => void)({ localRow: 6, row: 30, startRow: 29 })
    expect(viewport.offset).toBe(65)
    ;(movedRail.props.onDragEnd as (event: unknown) => void)({ localRow: 6 })
    expect(viewport.offset).toBe(75)
  })

  test("a HORIZONTAL grab at the thumb's edge does not jump either", () => {
    /** The kit. */
    const kit = makeHarness(60, 12)
    /** A 200-column drawing in a 40-column window: `colMax = 160`, the thumb is 8 cells, the track 32. */
    const viewport = usePanelViewport(coreKit(kit), () => ({ contentRows: 100, viewportRows: 10, contentCols: 200, viewportCols: 40 }))
    // 77 is deliberately off the thumb grid: the old absolute map of track cell 15 is 75, a 2-column
    // jump the reader would see the instant they grabbed the thumb.
    viewport.scrollToCol(77)
    /** The rail element of this render. */
    const startRail = viewportRail(coreKit(kit), viewport, 40)
    expect(startRail).toBeDefined()
    ;((startRail as FakeNode).props.onDragStart as (event: unknown) => void)({ localCol: 16, col: 40, startCol: 39 })
    // The press was at track cell 15; the first motion reached 16, so nothing is committed yet.
    expect(viewport.colOffset).toBe(77)
    /** The rail element of the NEXT render, carrying the same persisted anchor. */
    const movedRail = viewportRail(coreKit(kit), viewport, 40) as FakeNode
    ;(movedRail.props.onDragEnd as (event: unknown) => void)({ localCol: 16 })
    // ONE cell from the press origin: one thirty-second of the 160-column band, not the absolute 80.
    expect(viewport.colOffset).toBe(82)
  })
})

// ── (d) the wheel is swallowed ──────────────────────────────────────────────

describe("(d) the workmate page's wheel containment", () => {
  test("the BODY handler stops the event so one tick cannot reach the chat behind the panel", () => {
    /** The kit. */
    const kit = makeHarness(60, 12)
    /** The rendered page. */
    const tree = renderPage(workmatePage(), kit)
    /** The body's wheel wrapper. */
    const wheelBox = findByKey(tree, "scroll")
    expect(typeof wheelBox?.props.onWheel).toBe("function")
    /** How many times the event's own propagation stopper was called. */
    let swallowed = 0
    // THE DEFECT: the body handler called the scroller only, so the host's own wheel dispatch kept the
    // event and the chat behind the sidebar scrolled on the same tick.
    ;(wheelBox?.props.onWheel as (event: unknown) => void)({ deltaY: 1, stopPropagation: (): void => { swallowed += 1 } })
    expect(swallowed).toBe(1)
  })

  test("the FRAME handler keeps swallowing too, so the pinned chrome stays contained", () => {
    /** The kit. */
    const kit = makeHarness(60, 12)
    /** The rendered page. */
    const tree = renderPage(workmatePage(), kit)
    /** The frame's own wheel handler, the one that covers the title, border and footer cells. */
    const frame = findByKey(tree, "frame")
    expect(typeof frame?.props.onWheel).toBe("function")
    /** How many times the event's own propagation stopper was called. */
    let swallowed = 0
    ;(frame?.props.onWheel as (event: unknown) => void)({ deltaY: 1, stopPropagation: (): void => { swallowed += 1 } })
    expect(swallowed).toBe(1)
  })
})

// ── (e) the viewport's render trigger ───────────────────────────────────────

describe("(e) the viewport's render tick", () => {
  test("the SAME number committed on BOTH axes still advances the state cell", () => {
    /** The kit; both axes overflow, so neither commit below is clamped away from 1. */
    const kit = makeHarness(40, 10)
    /** 100 rows in a 10-row window, 200 cells in a 40-cell one: `scrollTo(1)` and `scrollToCol(1)` both land on 1. */
    const viewport = usePanelViewport(coreKit(kit), () => ({ contentRows: 100, viewportRows: 10, contentCols: 200, viewportCols: 40 }))
    /** The state cell's value before any commit. */
    const start = kit.stateValues()[0]
    // ONE COMMIT ALONE ADVANCES IT: the cell is the host's re-render trigger, so it must never sit still.
    viewport.scrollTo(1)
    /** The state cell's value after the row commit. */
    const afterRow = kit.stateValues()[0]
    expect(afterRow).not.toBe(start)
    expect(viewport.offset).toBe(1)
    // THE DEFECT: this second commit used to write the SAME number into an offset-valued cell, so React's
    // Object.is bail-out skipped the render and the horizontal move stayed invisible until something else
    // rendered. The cell now carries a tick, which advances on every commit on either axis.
    viewport.scrollToCol(1)
    /** The state cell's value after the column commit. */
    const afterCol = kit.stateValues()[0]
    expect(afterCol).not.toBe(afterRow)
    expect(viewport.offset).toBe(1)
    expect(viewport.colOffset).toBe(1)
  })
})
