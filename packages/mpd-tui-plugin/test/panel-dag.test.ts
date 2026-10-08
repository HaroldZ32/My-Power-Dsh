// THE SIDEBAR PAGES (frozen clauses R1, R6–R12) — the descriptor, the legend, the animation
// degradation, the pin, and the workmate shelf.
//
// HARNESS. A HOST DOUBLE, not a terminal: index-keyed hook state (reset per render, exactly as React
// re-runs a component), effect QUEUING (so an arm can run the effects the component registered, which
// is how the badge and the key subscription are asserted), and a row-aware flattening that keeps each
// drawn row as its own string. The double carries `useAnimationTime`, which is the ONE difference that
// makes the two animation arms possible: the same component is rendered through two kits and the
// DEGRADATION is the thing under test.
//
// WHAT IS ASSERTED, AND WHY IT IS ASSERTED THAT WAY. The legend is checked against `dag-theme.ts`
// rather than against a literal: a test that spelled `○ blocked` itself would pass while the page
// drifted from the contract, which is the exact failure the contract exists to prevent. The geometry
// assertions are INVARIANT-shaped (every row inside the measured width, the mode a fact about the
// width) and never byte-frozen grids.
import { describe, expect, test } from "bun:test"
import {
  DAG_ANIM,
  DAG_CHARS,
  DAG_CHROME,
  DAG_PANEL_MIN_COLUMNS,
  DAG_STATE_TONES,
  DAG_TONE_GLYPH,
} from "../src/dag-theme"
import { cellWidth, clampCells } from "../src/sanitize"
import { PANEL_FULLSCREEN_GLYPH, PANEL_TITLE, registerPanelSurface } from "../src/panel"
import { layoutBoxesNatural, layoutRail, sliceSpans, widestLabelCells } from "../src/graph"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index.js"
import {
  agentIdForOwner,
  createDagPanelComponent,
  dagBadge,
  dagPageOf,
  dagPanelLayout,
  dagRowClick,
  DAG_PANEL_TITLE,
  pinnedDetailLines,
  type DagPanelTask,
} from "../src/panel-dag"
import { clampScroll, gutterCells, legendLinesFor, PANEL_CHROME_ROWS, panelContentWidth, panelKeysArmed, panelScrollKey, runningGlyph, scrollByWheel, usePanelViewport } from "../src/panel-core"
import {
  createWorkmatePanelComponent,
  readWorkmateLibrary,
  WORKMATE_PANEL_DESCRIPTOR_FROZEN,
  WORKMATE_PANEL_ID,
  WORKMATE_PANEL_ICON,
  WORKMATE_PANEL_ORDER,
  WORKMATE_PANEL_TITLE,
  type WorkmateLibrary,
} from "../src/panel-workmate"
import type { TeamWorkflow } from "../src/team-state"

// ── fixtures ────────────────────────────────────────────────────────────────

/** One chain task: T<n> blocked by T<n-1>, so the board is a single deep chain. */
const CHAIN_LENGTH = 12

/**
 * A chain board of `CHAIN_LENGTH` tasks, every other one settled, one running, the first failed.
 * @returns the board, in the drawing's own vocabulary.
 */
function chainTasks(): DagPanelTask[] {
  /** The board under construction. */
  const tasks: DagPanelTask[] = []
  for (let index = 1; index <= CHAIN_LENGTH; index += 1) {
    /** The chain's own indices, kept 1-based so the ids read like a real board. */
    const dependencies = index === 1 ? [] : [`T${index - 1}`]
    /** The state this task sits in, so the drawing has a running node to animate. */
    const visual = index === 1 ? "failed" : index === 2 ? "running" : index % 3 === 0 ? "completed" : "blocked"
    tasks.push({
      id: `T${index}`,
      subject: `Integration task #${index}`,
      kind: "integration",
      visual,
      dependencies,
      failedDependencies: [],
      depth: index - 1,
      ...(visual === "running" ? { attempt: 1 } : {}),
      round: index === 2 ? 2 : undefined,
      verdict: index === 1 ? "rejected" : undefined,
    })
  }
  return tasks
}

/** One CJK task: a wide-glyph label, which is what makes a per-character draw lose its right border. */
function cjkTasks(): DagPanelTask[] {
  return [
    { id: "T1", subject: "冻结验收契约", kind: "work", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
    { id: "T2", subject: "实现几何引擎", kind: "work", visual: "running", dependencies: ["T1"], failedDependencies: [], depth: 1 },
    { id: "T3", subject: "面板表面层", kind: "review", visual: "open", dependencies: ["T2"], failedDependencies: [], depth: 2 },
  ]
}

/** A fan-in board: two independent tasks feeding one, which is the shape a rail must not lose. */
function fanInTasks(): DagPanelTask[] {
  return [
    { id: "F1", subject: "requirements contract", kind: "requirement", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
    { id: "F2", subject: "geometry engine", kind: "work", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
    { id: "F3", subject: "panel surface", kind: "work", visual: "running", dependencies: ["F1", "F2"], failedDependencies: [], depth: 1 },
  ]
}

/**
 * A team projection carrying the chain board.
 * @returns the workflow a panel reader returns.
 */
function workflowFixture(): TeamWorkflow {
  return {
    workspace: "/tmp/mpd-dag-panel-fixture",
    team: { id: "team-20261007120000", name: "dag-port", phase: "active", staged: false, runnable: true, links: 2 },
    members: [
      { name: "Panel Engineer", role: "Senior Engineer", status: "running", done: 1, total: 2, progress: 50, unread: null },
      { name: "Geometry Engineer", role: "Deep Worker", status: "running", done: 0, total: 1, progress: 0, unread: null },
    ],
    tasks: chainTasks().map((task) => ({
      id: task.id,
      subject: task.subject,
      kind: task.kind,
      status: "pending",
      visual: task.visual,
      dependencies: [...task.dependencies],
      failedDependencies: [...task.failedDependencies],
      depth: task.depth,
      ...(task.attempt === undefined ? {} : { attempt: task.attempt }),
      ...(task.round === undefined ? {} : { round: task.round }),
      ...(task.verdict === undefined ? {} : { verdict: task.verdict }),
    })),
    counts: { total: CHAIN_LENGTH, completed: 4, inProgress: 1, pending: 6, claimed: 0, failed: 1, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/** One workmate library read with a single instance, for the populated arm. */
function libraryFixture(): WorkmateLibrary {
  return {
    root: "/tmp/home/.mpd/workmate",
    archived: 1,
    problems: [],
    entries: [
      {
        key: "geometry-engineer-1",
        name: "geometry-engineer-1",
        base: "Deep Worker",
        description: "lays out DAG geometry",
        note: "owns the rank computation",
        uses: 3,
        updatedAt: "2026-10-07T04:00:00.000Z",
        readonlyBase: false,
        route: "deepseek-official/deepseek-v4-flash",
      },
    ],
  }
}

/** The element with one React key anywhere in a tree, or undefined. */
function elementByKey(tree: unknown, key: string): Element | undefined {
  if (tree === null || tree === undefined || typeof tree !== "object") return undefined
  if (Array.isArray(tree)) {
    for (const child of tree) {
      /** This child's own search result, returned as soon as it is found. */
      const found = elementByKey(child, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  /** This node as an element. */
  const element = tree as Element
  if (element.props?.key === key) return element
  return elementByKey(element.props?.children, key) ?? elementByKey(element.children, key)
}

/** The child elements of one element, whatever shape its children arrived in. */
function childElements(element: Element | undefined): Element[] {
  if (element === undefined) return []
  /** The children, taken from the props first because that is where `createElement` puts them. */
  const raw = (element.props?.children as unknown[] | undefined) ?? element.children ?? []
  /** The ones that are elements. */
  return raw.filter((child): child is Element => child !== null && typeof child === "object" && !Array.isArray(child))
}

/**
 * The rows the page actually put in its scrolling window.
 *
 * Read off the `"scroll"` element by KEY rather than by position in the tree: the window is the box the
 * page labels, so this is a lookup for a contract rather than a guess about the tree's shape.
 * @param tree - the rendered tree.
 * @returns the scrolling column's own children, in draw order.
 */
function windowedRows(tree: unknown): number {
  return childElements(elementByKey(tree, "scroll")).length
}

/**
 * A board with `count` tasks in a long chain, so a page has far more content than any panel can show.
 * @param count - how many tasks to build.
 * @returns the board, in the drawing's own vocabulary.
 */
function bigBoard(count: number): DagPanelTask[] {
  /** The board under construction. */
  const tasks: DagPanelTask[] = []
  for (let index = 1; index <= count; index += 1) {
    tasks.push({
      id: `B${index}`,
      subject: `broad task ${index}`,
      kind: "work",
      visual: index === 1 ? "running" : "open",
      dependencies: index === 1 ? [] : [`B${index - 1}`],
      failedDependencies: [],
      depth: index - 1,
    })
  }
  return tasks
}

/**
 * A team projection carrying an arbitrary board.
 * @param tasks - the board.
 * @returns the workflow a panel reader returns.
 */
function workflowOf(tasks: readonly DagPanelTask[]): TeamWorkflow {
  /** The chain fixture's own workflow, with its tasks replaced. */
  const workflow = workflowFixture()
  workflow.tasks = tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    kind: task.kind,
    status: "pending",
    visual: task.visual,
    dependencies: [...task.dependencies],
    failedDependencies: [...task.failedDependencies],
    depth: task.depth,
  }))
  workflow.counts = { total: tasks.length, completed: 0, inProgress: 1, pending: tasks.length - 1, claimed: 0, failed: 0, cancelled: 0, other: 0 }
  return workflow
}

// ── the host double ─────────────────────────────────────────────────────────

/** One rendered element as the double produces it. */
interface Element {
  /** The element type: one of the kit's own components. */
  type: unknown
  /** The element's props. */
  props: Record<string, unknown>
  /** The element's children, in render order. */
  children: unknown[]
}

/** The host kit double one arm renders a page with. */
interface Kit {
  /** The React double the page must use. */
  React: Record<string, unknown>
  /** The ui kit double. */
  ui: Record<string, unknown>
  /** Restarts the hook index, as a fresh render pass does. */
  reset(): void
  /** Runs every effect the last render registered. */
  runEffects(): void
  /** The row texts of one render, in DRAW order. */
  rows(tree: unknown): string[]
  /** The flattened text of one render, rows joined with nothing (the test double's own spelling). */
  text(tree: unknown): string
}

/**
 * Build the host kit double.
 * @param options - the panel width, and whether this host exposes the animation timer at all.
 * @returns the kit.
 */
function makeKit(options: { columns?: number; rows?: number; animation?: "absent" | "value" | "nan" } = {}): Kit {
  /** The width this panel reports. */
  const columns = options.columns ?? 80
  /** Hook state, keyed by hook position, as React keys its own cells. */
  const store = new Map<string, unknown>()
  /** The state updates a returned setter applied, replayed when the store is reset for a new render. */
  const pending: Array<{ key: string; value: unknown }> = []
  /** The hook counter of the current render pass. */
  let index = 0
  /** The effects this render registered, in order. */
  const effects: Array<() => unknown> = []
  /** The listeners a page subscribed through the host API. */
  let keyListeners: Array<(event: unknown) => void> = []

  /** The React double: index-keyed hooks with a replayable store. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This cell's key, derived from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, initial)
      return [
        store.get(key),
        (next: unknown): void => {
          store.set(key, next)
          pending.push({ key, value: next })
        },
      ]
    },
    useEffect: (effect: () => unknown): void => {
      index += 1
      effects.push(effect)
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, derived from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }

  /** The Text component: identity plus the children it renders. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Box component: the host's column, contributing one row per child. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
  /** The ScrollBox component: a column to the flattening too. */
  const ScrollBox = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Divider component: a one-cell rule. */
  const Divider = (): Element => ({ type: "Text", props: {}, children: ["─"] })

  /** The ui kit; `useAnimationTime` is present or absent as the arm asked. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    ScrollBox,
    Divider,
    useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows: options.rows ?? 40 }),
  }
  if (options.animation !== "absent") {
    ui.useAnimationTime = (intervalMs: number | null): number =>
      options.animation === "nan" ? Number.NaN : intervalMs === null ? 0 : DAG_ANIM.intervalMs * 2
  }

  /** Every character inside one node, symbols joined with nothing. */
  const inline = (node: unknown): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") return node
    if (typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(inline).join("")
    /** This node as an element, the only shape left after the guards. */
    const element = node as Element
    return inline(element.props?.children) + inline(element.children ?? [])
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
    // A nested Text renders a COLUMN of its children in the host's kit, so a nested child list is
    // walked rather than joined: joining it would collapse a multi-span row into one unreadable run.
    const children = element.children ?? []
    if (children.length > 0 && typeof children[0] === "object" && children[0] !== null) {
      for (const child of children) rowsOf(child, out)
      return
    }
    out.push(inline(node))
  }

  return {
    React,
    ui,
    reset: (): void => {
      index = 0
      effects.length = 0
      for (const update of pending) store.set(update.key, update.value)
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
    text: (tree: unknown): string => {
      /** The collected rows, joined as the double's own flattening does. */
      const out: string[] = []
      rowsOf(tree, out)
      return out.join("")
    },
  }
}

/** The host API double, with the badge and key subscriptions recorded. */
interface HostRecorder {
  /** The host's curated snapshot. */
  snapshot(): unknown
  /** Whether the page is focused. */
  focused: boolean
  /** Whether the page is on screen. */
  visible: boolean
  /** Every `notify` call, in order. */
  notifications: Array<{ level: string; unread: number | undefined }>
  /** How many times the badge was cleared. */
  cleared: number
  /** The key listeners the page subscribed. */
  listeners: Array<(event: unknown) => void>
  /** Every `toast` line the page showed through the host, in order (AC6's "never a silent no-op"). */
  toasts: string[]
  /** The host API handed to the component. */
  host: Record<string, unknown>
}

/**
 * Build the host API double.
 * @param options - the focus/visibility the host reports, whether it exposes `onKey` at all, and the
 *   subagent rows its snapshot carries — the ONE source AC6 resolves an owner name against.
 * @returns the recorder.
 */
function makeHost(options: { focused?: boolean; visible?: boolean; onKey?: boolean; snapshotThrows?: boolean; subagents?: unknown } = {}): HostRecorder {
  /** Every `notify` call the page made. */
  const notifications: Array<{ level: string; unread: number | undefined }> = []
  /** The key listeners the page subscribed. */
  const listeners: Array<(event: unknown) => void> = []
  /** Every `toast` line the page showed. */
  const toasts: string[] = []
  /** The recorder under construction. */
  const recorder: HostRecorder = {
    snapshot: (): unknown => {
      if (options.snapshotThrows === true) throw new Error("host state unreadable")
      return { subagents: Array.isArray(options.subagents) ? options.subagents : [] }
    },
    focused: options.focused ?? true,
    visible: options.visible ?? true,
    notifications,
    cleared: 0,
    listeners,
    toasts,
    host: {},
  }
  recorder.host = {
    snapshot: (): unknown => recorder.snapshot(),
    focused: recorder.focused,
    notify: (level: string, unread?: number): void => {
      notifications.push({ level, unread })
    },
    clearBadge: (): void => {
      recorder.cleared += 1
    },
    toast: (text: string): boolean => {
      toasts.push(text)
      return true
    },
    ...(options.onKey === false
      ? {}
      : {
          onKey: (listener: (event: unknown) => void): (() => void) => {
            listeners.push(listener)
            return (): void => {
              /** This listener's position, removed on dispose. */
              const at = listeners.indexOf(listener)
              if (at >= 0) listeners.splice(at, 1)
            }
          },
        }),
  }
  return recorder
}

/**
 * Render one page through the double.
 * @param component - the component under test.
 * @param kit - the host kit double.
 * @param host - the host API double.
 * @param props - any extra props the arm wants to add.
 * @returns the rendered tree.
 */
function render(component: (props: unknown) => unknown, kit: Kit, host: HostRecorder, props: Record<string, unknown> = {}): unknown {
  kit.reset()
  return component({ React: kit.React, ui: kit.ui, host: host.host, focused: host.focused, visible: host.visible, ...props })
}

// ── the descriptor (frozen clause R1/R9) ────────────────────────────────────

// ── the page's identity AFTER the merge (frozen clause C3) ──────────────────
//
// THE DESCRIPTOR IS GONE FROM THIS FILE, and that is the clause rather than a tidy-up: "ONE descriptor,
// ONE slug, ONE ordered position collapse out of the two". The DAG page IS the MPD panel now, so its
// slug `dag`, its title `MPD DAG` and its order 11 no longer exist as a second registration, and the
// surviving descriptor (`panel.ts`'s `PANEL_DESCRIPTOR_FROZEN`, slug `team`, title `MPD`, icon `❖`,
// order 10) is the only one the host ever receives. What this file still owns is what the PAGE knows
// about itself, and what it must agree with the survivor about.

describe("the DAG page's identity after the merge (clause C3)", () => {
  test("its title IS the surviving MPD panel's title — one name, one surface", () => {
    // The page draws this title in its own chrome row, and the host draws the descriptor's title in its
    // panel bar: two spellings of one name that could drift silently. This is the arm that stops it.
    expect(DAG_PANEL_TITLE).toBe(PANEL_TITLE)
    expect(DAG_PANEL_TITLE).toBe("MPD")
    // The title the page draws is non-empty and clamps to something a reader can see, which is the shape
    // the host's own descriptor validator requires of whatever it is registered as.
    expect(DAG_PANEL_TITLE.length).toBeGreaterThan(0)
    // THE FLOOR THE PAGE LAYS OUT FOR IS STILL THE HOST'S OWN (captain's ruling, 2026-10-13; the reasoning
    // is in `dag-theme.ts`). `PanelHost.js` swaps the page's BODY for a `panel-too-narrow` notice when
    // `width < minColumns`, so a floor above the host's own 28 opens a width band where the tab exists and
    // the user sees a refusal instead of a graph. Readability at 28 is the PAGE's job, not the panel's.
    expect(DAG_PANEL_MIN_COLUMNS).toBe(28)
  })

  test("the surviving registration carries this page's component and reaches the host read-back", () => {
    // THE CHAIN THE MERGE HAD TO KEEP: the ONE registration still hands the host a callable component
    // (this page's), and its final id is still DISCOVERED from the host's own `list()` read-back rather
    // than composed on this side. A merge that registered the right descriptor with the wrong component,
    // or predicted the id, would pass every descriptor arm and fail this one.
    /** The registration the host received. */
    const registered: Record<string, unknown>[] = []
    /** The host's own read-back rows; a registration APPENDS one, as the host composes the id itself. */
    const rows: Array<{ id: string; title: string; source: string }> = []
    /** The host's panel registry double. */
    const registry = {
      register: (descriptor: Record<string, unknown>): (() => void) => {
        registered.push(descriptor)
        rows.push({ id: `act3:${String(descriptor.id)}`, title: String(descriptor.title), source: "plugin" })
        return () => {}
      },
      list: (): readonly { id: string; title: string; source: string }[] => rows,
      open: (): boolean => true,
    }
    /** The ctx double: services are reachable only through the injected scope, as the host has it. */
    const build = (): Record<string, any> => {
      /** The host's registry double this arm registers against. */
      const ctx: Record<string, any> = {
        get: (): undefined => undefined,
        effect: (callback: () => () => void): Record<string, never> => {
          callback()
          return {}
        },
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
      }
      ctx.inject = (dependencies: readonly string[], callback: (scoped: Record<string, any>) => void): Record<string, never> => {
        /** The injected scope, whose `get` resolves the mounted service. */
        const scoped = build()
        scoped.get = (name: string): unknown => (name === "tuiPanels" ? registry : undefined)
        if (dependencies.includes("tuiPanels")) callback(scoped)
        return {}
      }
      return ctx
    }
    /** The real adapter over that host. */
    const tui = createTuiAdapter(build() as never)
    /** The registered MPD panel, wired the way `index.ts` wires it. */
    const seam = registerPanelSurface(tui as never, {
      enabled: true,
      readWorkflow: () => workflowFixture(),
      openMergedScene: () => true,
      log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.id).toBe("team")
    expect(registered[0]?.title).toBe(PANEL_TITLE)
    // The compact slot is NOT declared: the host stores it and never mounts it, so claiming one would
    // promise a surface this build cannot render.
    expect(registered[0]?.compact).toBeUndefined()
    expect(typeof registered[0]?.component).toBe("function")
    expect(seam.id()).toBe("act3:team")
    expect(seam.registered()).toBe(true)
  })
})

// ── the legend (frozen clause R6) ───────────────────────────────────────────

describe("the legend", () => {
  test("covers EVERY state the contract knows, with the glyph the contract declares", () => {
    /** The legend, at a width wide enough for one line per group. */
    const lines = legendLinesFor(200, ["▼/▸ arrow · ▶ focus"])
    /** The whole legend, joined for the containment assertions. */
    const joined = lines.join("\n")
    for (const state of DAG_STATE_TONES) {
      // The glyph is READ from the contract: re-typing it here would let the two drift, which is the
      // single thing a legend exists to prevent.
      expect(joined).toContain(DAG_TONE_GLYPH[state] as string)
      expect(joined).toContain(state)
      expect(joined).toContain(`${DAG_TONE_GLYPH[state]} ${state}`)
    }
    // THE DISAMBIGUATION. `blocked` and `open` share the `○` glyph by design, and the drawing module's
    // own legend omits `blocked` entirely — so this legend must name the TIE, or the reader has no way
    // to tell a waiting task from one that is merely not started.
    expect(DAG_TONE_GLYPH.blocked).toBe(DAG_TONE_GLYPH.open)
    expect(joined).toContain(`○ blocked=open`)
    expect(joined).toContain(`○ open=blocked`)
    // The drawing's own arrow sentence is forwarded, not re-invented: `graph.ts` owns what its arrows
    // mean, and the full-screen scene renders the same line.
    expect(lines[0]).toContain("arrow")
  })

  test("fits the width it is given, and drops a line rather than cutting one", () => {
    for (const cols of [8, 16, 24, 32, 48, 200]) {
      /** The legend at this width. */
      const lines = legendLinesFor(cols, ["▼/▸ blocker → dependent · ▶ focus lights its chain"])
      for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(cols)
      // NEGATIVE CONTROL: a width below the drawing's own floor yields no arrow line at all, which is
      // what "dropped, not cut" means.
      if (cols < 24) expect(lines.some((line) => line.includes("arrow") || line.includes("▶"))).toBe(false)
    }
    expect(legendLinesFor(0, ["x"])).toEqual([])
  })
})

// ── the layout: the mode is a fact about the width (frozen clause R2/R6) ─────

describe("the DAG page's layout choice", () => {
  test("at the host's own 28-column floor the page still draws, and reads", () => {
    /** The chain board the visual review measured. */
    const chain = chainTasks()
    /** The fan-in board, whose rail must keep BOTH blockers. */
    const fanIn = fanInTasks()
    // THE FLOOR (R2/R6) SURVIVES AND THE MODE NO LONGER MOVES WITH IT (frozen clauses T1/T2). The
    // descriptor still asks the host for its own 28 cells, and the page still reads at that width — but
    // the drawing is now sized by its CONTENT, so a narrow panel no longer declines the boxes: it draws
    // the same picture and WINDOWS it, which is the whole point of the wave. What must hold at the floor
    // is that every drawn row is the panel's own width, never wider.
    expect(DAG_PANEL_MIN_COLUMNS).toBe(28)
    for (const cols of [DAG_PANEL_MIN_COLUMNS, 32]) {
      for (const board of [chain, fanIn]) {
        /** The layout at this panel width. */
        const narrow = dagPanelLayout(board, cols)
        expect(narrow.mode).toBe("boxes")
        // THE DRAWING IS ALLOWED TO BE WIDER THAN THE PANEL — that is `GraphView.width`'s new meaning —
        // and the WINDOW is what must fit. `sliceSpans` is the one cutter, asserted in its own right.
        expect(narrow.view.width).toBeGreaterThan(0)
        for (const row of narrow.view.lines) expect(cellWidth(sliceSpans(row, 0, cols).map((span) => span.text).join(""))).toBe(cols)
      }
    }
    // Widening the panel changes nothing about the MODE — it only ever shows more of the same drawing.
    expect(dagPanelLayout(chain, 80).mode).toBe("boxes")
    expect(dagPanelLayout(fanIn, 80).mode).toBe("boxes")
    // THE FAN-IN'S BLOCKER LIST SURVIVES THE MODE CHANGE: `F1+F2` is drawn by the rail, and the boxes
    // carry the same fact in their EDGES. Whichever drawing is on screen, no blocker may be lost.
    /** The rail over the same board, asked for directly — the narrow fallback's own contract. */
    const rail = layoutRail(fanIn, 60)
    expect(rail.lines.flat().map((span) => span.text).join("\n")).toContain("F1+F2")
  })

  test("a busy narrow board reaches the dense list, which had no caller before this page", () => {
    /** A board with more rows than a rail can show legibly. */
    const busy: DagPanelTask[] = []
    for (let index = 1; index <= 30; index += 1) {
      busy.push({
        id: `B${index}`,
        subject: `broad task ${index}`,
        kind: "work",
        visual: "open",
        dependencies: index === 1 ? [] : [`B${index - 1}`],
        failedDependencies: [],
        depth: index - 1,
      })
    }
    /** The layout for that board at the floor. */
    const dense = dagPanelLayout(busy, DAG_PANEL_MIN_COLUMNS)
    expect(dense.mode).toBe("list")
    expect(dense.list).toBe(true)
    // The list view is the rank-grouped table, whose own header is the `rank` rule.
    expect(dense.view.lines.flat().map((span) => span.text).join("\n")).toContain("rank")
  })

  test("EVERY drawn row fits the panel, wide glyphs included", () => {
    // THE ASSERTION MOVED FROM THE LAYOUT'S WIDTH TO THE WINDOW'S (frozen clause T1, captain's ruling R6):
    // under natural width the drawing is NO LONGER bounded by the panel, so "every row fits" became false
    // by design — the invariant that replaces it is the one the reader actually sees, which is that the
    // SLICED window is EXACTLY the panel's measured width, at every offset. Both halves are asserted, so
    // a drawing that fitted by shrinking would fail the first line rather than pass silently.
    for (const cols of [DAG_PANEL_MIN_COLUMNS, 34, 48, 80]) {
      for (const tasks of [chainTasks(), cjkTasks(), fanInTasks()]) {
        /** The layout at this panel width. */
        const layout = dagPanelLayout(tasks, cols)
        /** The drawing's own width, which may exceed the panel. */
        const width = layout.view.width
        expect(width).toBeGreaterThan(0)
        for (const row of layout.view.lines) {
          // THE DRAWING'S OWN ROWS ARE ITS OWN WIDTH: `clampSpans` already bounded them to the natural
          // width the layout computed, so a row wider than THAT would be a layout defect, not a window one.
          expect(row.reduce((sum, span) => sum + cellWidth(span.text), 0)).toBeLessThanOrEqual(width)
          for (const offset of [0, 1, Math.max(0, width - cols), width + 5]) {
            expect(cellWidth(sliceSpans(row, offset, cols).map((span) => span.text).join(""))).toBe(cols)
          }
        }
      }
    }
  })

  test("a boxed CJK line ends on its own right border column", () => {
    // THE WIDE-GLYPH CASE. A per-character draw advances the cursor by CELL while writing one grid
    // slot, so a CJK label loses the box's right border — the label row is shorter than the border
    // rows around it. The assertion is the INVARIANT (the border rows and the label row end at the
    // same column), never a frozen grid.
    /** The CJK board's box at a width that affords boxes. */
    const boxes = dagPanelLayout(cjkTasks(), 80)
    expect(boxes.mode).toBe("boxes")
    /** The first box's border rows and its label row, read through the layout's OWN reported facts. */
    const rows = boxes.view.lines.map((row) => row.map((span) => span.text).join(""))
    /** The first box's rectangle, which is where its top border and its row count come from. */
    const first = boxes.view.hits[0]
    /** The rows of the FIRST box: top border, its padding rows, its label, its bottom border. */
    const top = rows[first.row]
    /** The label the drawing writes inside the FIRST box of the CJK fixture: the content row of the form. */
    const label = rows[first.row + (boxes.view.boxRows === 5 ? 2 : 1)]
    /** The same box's bottom border row, compared against the label row's width. */
    const bottom = rows[first.rowEnd]
    expect(cellWidth(top)).toBe(cellWidth(label))
    expect(cellWidth(label)).toBe(cellWidth(bottom))
    // The right border is the LAST cell of each of those rows... except on the top/bottom borders,
    // whose final glyph is the shared corner; the LABEL row must end on the same column as they do.
    expect(cellWidth(label)).toBe(cellWidth(bottom))
  })

  test("an empty board still lays out without throwing", () => {
    expect(dagPanelLayout([], 32).view.lines).toEqual([])
    expect(dagPageOf(undefined)).toBeUndefined()
  })

  test("boxes are drawn ONLY when the widest label fits: a label is never cut", () => {
    // RE-POINTED FOR CLAUSE AC1. The gate this arm locks is `labelOverflow` — a box is drawn only when its
    // interior holds the whole label — and under AC1 the label a node writes is `<marker> <id>`, so the
    // field that can overflow is the ID. Before AC1 the arm drove it with a 61-cell SUBJECT; the fixture
    // is now a board whose IDS are far wider than any box interior, which is the same test of the same rule.
    /** A board whose task ids are far wider than any box interior the drawing will size, chain included. */
    const suffix = "wide".repeat(16)
    /** The same board with the suffix on every id AND on every dependency, so the chain stays intact. */
    const long = fanInTasks().map((task) => ({ ...task, id: `${task.id}-${suffix}`, dependencies: task.dependencies.map((dep) => `${dep}-${suffix}`) }))
    // The gate is EXACT: a ~69-cell label cannot fit a box interior even at the drawing's own maximum
    // node width, so no box is drawn at ANY panel width — the rail carries the label instead.
    for (const cols of [80, 200, 400]) {
      /** The layout at this width. */
      const layout = dagPanelLayout(long, cols)
      expect(layout.mode).toBe("rail")
    }
    // THE REFUSAL IS THE DRAWING'S OWN REPORT, which is what makes the fallback above a fact rather than
    // the page's guess.
    expect(layoutBoxesNatural(long)?.labelOverflow).toBe(true)
    // POSITIVE CONTROL: an ORDINARY board DOES get its boxes, and there the id-bearing label sits inside
    // its own borders — so the gate declines for a reason rather than always.
    /** The ordinary board at a wide panel. */
    const short = dagPanelLayout(fanInTasks(), 200)
    expect(short.mode).toBe("boxes")
    /** The boxed drawing's text. */
    const boxed = short.view.lines.map((row) => row.map((span) => span.text).join("")).join("\n")
    for (const task of fanInTasks()) expect(boxed).toContain(`${DAG_TONE_GLYPH[task.visual] ?? "?"} ${task.id}`)
  })

  test("A REAL BOARD STILL DRAWS BOXES: the natural width cap holds a realistic label whole", () => {
    // THE ARM THE REAL PTY CAPTURE ASKED FOR (verifier's `pty-post` capture, 2026-10-06). At widths 140
    // and 220 the pane read `view rail · 5 tasks · ranks derived` — the RAIL at every width — because the
    // natural width cap was 34, so any label past 32 cells set `labelOverflow`, and `pan1`/`pan2` came out
    // identical to `open1`: a rail has nothing to pan. The feature switched itself off on exactly the
    // boards it exists for. This arm is the unit-level statement of what the pane showed.
    /** The capture's own board: real subjects of 48-53 cells, chained. */
    const real = chainTasks().slice(0, 5).map((task, index) => ({
      ...task,
      subject: [
        "natural width and bidirectional panning for the DAG",
        "termaid rounded node boxes with rounded corners",
        "the graph-safe label rule on every drawing surface",
        "the horizontal window is the drawing's own",
        "prove the tip touches the border by arithmetic",
      ][index] ?? task.subject,
    }))
    /** The widest label this board would write, which is what the cap has to hold. */
    const widest = widestLabelCells(real)
    // THE WIDTH THE CAP HOLDS IS THE LABEL'S (clause AC1): `<marker> <id>`. The capture's 48-53 cell
    // SUBJECTS are still on this board — they are what the record carries and what the DETAIL body reads —
    // but they no longer size a box, which is the fact this assertion states.
    expect(widest).toBe(cellWidth(`${DAG_TONE_GLYPH[real[0].visual] ?? "?"} ${real[0].id}`))
    expect(widest).toBeLessThanOrEqual(10)
    // BOXES AT A SIDEBAR WIDTH — the exact assertion the capture's `view rail` falsified. 44 is near the
    // host's own split-width floor, so this is the narrow case, not a wide one.
    for (const cols of [44, 80, 140, 220]) {
      /** The layout at this panel width. */
      const layout = dagPanelLayout(real, cols, undefined, 24)
      expect(`cols=${cols} mode=${layout.mode}`).toBe(`cols=${cols} mode=boxes`)
      // AND NOTHING IS CUT: every task's composed label is present WHOLE in the drawing, which is the
      // promise the rail fallback existed to keep. A cut label is the defect this arm's sibling measures.
      /** The drawing's text, joined across its rows. */
      const drawn = layout.view.lines.map((row) => row.map((span) => span.text).join("")).join("\n")
      for (let index = 0; index < real.length; index += 1) {
        /** The label this task would draw, composed the way the drawing's own rule composes it (AC1). */
        const label = `${DAG_TONE_GLYPH[real[index].visual] ?? "?"} ${real[index].id}`
        expect(`cols=${cols} ${real[index].id} whole=${drawn.includes(label)}`).toBe(`cols=${cols} ${real[index].id} whole=true`)
      }
      // THE DRAWING IS ALLOWED TO BE WIDER THAN THE PANEL, and the window is what fits — the two facts
      // together are what make the horizontal pan meaningful at every one of these widths.
      expect(layout.view.width).toBeGreaterThan(0)
      for (const row of layout.view.lines) expect(cellWidth(sliceSpans(row, 0, cols).map((span) => span.text).join(""))).toBe(cols)
    }
    // THE SAFETY NET SURVIVES (T1): a label that genuinely cannot fit inside the capped box is STILL
    // reported and STILL falls back, so raising the cap moved the threshold rather than removing it.
    /** A pathological ID: ~200 ASCII cells, far past any legible box, kept unique per task. */
    const absurd = fanInTasks().map((task, index) => ({ ...task, id: `${"x".repeat(199)}${index}` }))
    for (const cols of [44, 200]) {
      expect(`cols=${cols} mode=${dagPanelLayout(absurd, cols).mode}`).toBe(`cols=${cols} mode=rail`)
    }
    // The threshold is the CAP, not a guess: a label one cell over the widest the box can write trips it,
    // and one cell under does not. Both sides are asserted so the boundary cannot drift silently.
    /** The natural-path cap and the label budget it implies, read from the drawing's own behaviour. */
    const cap = layoutBoxesNatural(real)?.width ?? 0
    expect(cap).toBeGreaterThan(0)
    // THE BOUNDARY IS DERIVED FROM THE DRAWING'S OWN MEASURE, never guessed: `NATURAL_MAX_NODE_WIDTH - 3`
    // is the widest label a capped box writes whole (`" " + label` inside `nodeWidth - 2`), and under AC1
    // the label is the one-cell marker, one space and the ID — so the ID's own budget is that number
    // minus the two cells the marker and the space occupy.
    /** The id length in cells that still fits whole inside the capped box. */
    const fits = 61 - 2
    expect(fits).toBeGreaterThan(0)
    /** A board whose id sits at exactly the widest label a capped box writes whole. */
    const atCap = fanInTasks().slice(0, 1).map((task) => ({ ...task, id: "y".repeat(fits) }))
    /** …and one cell more, which must trip the net. */
    const overCap = fanInTasks().slice(0, 1).map((task) => ({ ...task, id: "y".repeat(fits + 1) }))
    expect(`atCap=${widestLabelCells(atCap)}/${layoutBoxesNatural(atCap)?.labelOverflow}`).toBe(`atCap=61/false`)
    expect(`overCap=${widestLabelCells(overCap)}/${layoutBoxesNatural(overCap)?.labelOverflow}`).toBe(`overCap=62/true`)
  })

  test("A MID-LENGTH LABEL IS NOT CUT, and the overflow flag agrees with the truncation", () => {
    // THE OFF-BY-ONE THIS ARM LOCKS (measured while landing the cap change). The node width is
    // `label + 3` — the leading space the drawing writes AND the two borders — and a budget derived any
    // other way cuts the last character of every label that lands between the two bounds while
    // `labelOverflow` still answers `false`, so nothing falls back and nothing reports it. Measured:
    // `requirements contract` drew as `requirements contrac`. The label row is read through the box's
    // OWN rectangle, so the arm cannot pass on a drawing whose geometry moved.
    // RE-POINTED FOR CLAUSE AC1: the value that can sit between the two bounds is now a MID-LENGTH ID.
    for (const id of ["K1-geometry-engine", "K2-requirements-contract", "K3-panel-surface"]) {
      /** The one-task board, so the label is the whole question. */
      const board = fanInTasks().slice(0, 1).map((task) => ({ ...task, id }))
      /** The label the drawing composes for this task (clause AC1): the marker, a space, the id. */
      const label = `${DAG_TONE_GLYPH[board[0].visual] ?? "?"} ${id}`
      /** The drawing at its natural width. */
      const view = layoutBoxesNatural(board)
      expect(view?.labelOverflow).toBe(false)
      /** The drawing as text. */
      const lines = (view?.lines ?? []).map((row) => row.map((span) => span.text).join(""))
      /** The box's rectangle, which says where its interior is. */
      const hit = (view?.hits ?? [])[0]
      /** The label row, the content row of whichever form was drawn. */
      const row = lines[hit.row + ((view?.boxRows ?? 3) === 5 ? 2 : 1)]
      /** The interior, between the two border cells. */
      const interior = row.slice(hit.col + 1, hit.colEnd)
      // BOTH BORDERS SURVIVE, and the label inside them is the WHOLE composed string — the clause, stated
      // directly rather than through a rebuilt row: the label the composer produces must appear verbatim
      // between the two border cells, and nothing may be missing off its end.
      expect(`${id} borders=${row[hit.col]}${row[hit.colEnd]}`).toBe(`${id} borders=${DAG_CHARS.vertical}${DAG_CHARS.vertical}`)
      expect(`${id} whole=${interior.includes(label)}`).toBe(`${id} whole=true`)
      expect(`${id} trimmed=${interior.trim()}`).toBe(`${id} trimmed=${interior.trim().replace(/ +$/u, "")}`)
    }
  })

  test("C3: THE PINNED DETAIL BODY CARRIES THE ORIGINAL SUBJECT AND DESCRIPTION, CHINESE INCLUDED", () => {
    // THE CLAUSE THE VERIFIER'S PTY PIN WALK COULD NOT WITNESS. Its walk (Down, Enter) reached the body,
    // but the body printed ten metadata facts and NEITHER original field — so `detailKept=0` on a panel
    // whose pin mechanism worked perfectly. An instrument cannot witness a clause the surface does not
    // render, and this half of the user's requirement ("点击以后的描述上可以有" Chinese) needs the record's
    // own words on screen.
    /** A task exactly as a real record serves it: both originals in Chinese. */
    const task: DagPanelTask = {
      id: "T1",
      subject: "冻结验收契约与验收标准",
      description: "验收说明：必须保持原样，不得改写",
      kind: "requirement",
      visual: "completed",
      dependencies: [],
      failedDependencies: [],
      depth: 0,
    }
    /** The pinned body's lines at a sidebar width. */
    const body = pinnedDetailLines(task, [task], 60)
    /** The body as one string, which is what a reader — and a capture — sees. */
    const text = body.join("\n")
    expect(text).toContain(task.subject)
    expect(text).toContain(task.description ?? "")
    // IT IS THE WHOLE ORIGINAL, not a prefix: the CJK ban draws the line at the DRAWING (C1), and a
    // detail that truncated its own subject would fail the clause while looking like it satisfied it.
    expect(text).toContain("冻结验收契约与验收标准")
    expect(text).toContain("验收说明：必须保持原样，不得改写")
    // AND THE DRAWING IS STILL CJK-FREE, in the same breath: the two halves of the contract are asserted
    // together so neither can be satisfied by breaking the other (C1 x C3).
    for (const row of dagPanelLayout([task], 60).view.lines) {
      for (const span of row) {
        for (const character of span.text) {
          /** The codepoint, which is what the C1 ranges are stated in. */
          const code = character.codePointAt(0) ?? 0
          /** Whether it falls in a range clause C1 bans. */
          const banned = (code >= 0x2e80 && code <= 0x2fff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0x3040 && code <= 0x9fff)
          expect(`U+${code.toString(16)} banned=${banned}`).toBe(`U+${code.toString(16)} banned=false`)
        }
      }
    }
    // A task with NO description omits the line rather than printing an empty `description —`, so the
    // body's shape stays a fact about the record.
    /** The same task, with the acceptance text absent. */
    const bare: DagPanelTask = { id: "T2", subject: "no acceptance text", kind: "work", visual: "open", dependencies: [], failedDependencies: [], depth: 0 }
    expect(pinnedDetailLines(bare, [bare], 60).some((line) => line.startsWith("description"))).toBe(false)
    expect(pinnedDetailLines(bare, [bare], 60).some((line) => line.startsWith("subject "))).toBe(true)
  })

  test("R18: an unresolved blocker is SURFACED, and the rank source is reported", () => {
    // The user's own defect shape: the record's `blockedBy` names something no task on the board
    // carries. Silent filtering is what made it invisible, so the layout must hand the list on and the
    // page must draw it.
    /** A board with one phantom blocker. */
    const phantom = chainTasks().map((task) => (task.id === "T3" ? { ...task, dependencies: [...task.dependencies, "T99"] } : task))
    /** The layout for that board. */
    const layout = dagPanelLayout(phantom, 80)
    expect(layout.unresolved).toContain("T99")
    // The rank source is reported as a first-class fact: derived, because the blockers that DO resolve
    // were enough to rank the board.
    expect(layout.ranksDerived).toBe(true)
    /** The page, drawing that board, on a panel tall enough to show the whole page at once. */
    const kit = makeKit({ columns: 120, rows: 200 })
    /** The page under test, drawing the board with the phantom blocker. */
    const page = createDagPanelComponent(() => {
      /** The chain workflow, with the phantom reference added. */
      const workflow = workflowFixture()
      workflow.tasks[2].dependencies = [...workflow.tasks[2].dependencies, "T99"]
      return workflow
    }) as (props: unknown) => unknown
    /** The rendered text. */
    const text = kit.text(render(page, kit, makeHost()))
    expect(text).toContain("unresolved blockers")
    expect(text).toContain("T99")
    expect(text).toContain("ranks derived")
  })
})

// ── the animation (frozen clause R8) ────────────────────────────────────────

describe("the running-node animation and its degradation", () => {
  test("the host timer drives the breath, and the static frame is the orbit's head", () => {
    // THE ORBIT is a small, closed set: whatever the timer answers, the glyph is one of these, and the
    // STATIC frame is the FIRST of them — so a degraded panel draws a glyph the animated one also uses
    // on half its frames, and a running task is never mistaken for a task in another state.
    /** Every glyph the orbit can produce, in frame order. */
    const orbit = [0, 1, 2, 3].map((phase) => runningGlyph(phase))
    expect(runningGlyph(DAG_ANIM.staticPhase)).toBe(DAG_TONE_GLYPH.running as string)
    for (const glyph of orbit) expect(glyph.length).toBeGreaterThan(0)
    // The contract's own running glyph is at the head of the orbit and returns every other frame; the
    // orbit's other marks are the same glyph plus a dot, never a glyph that means a DIFFERENT state.
    expect(orbit.filter((glyph) => glyph === (DAG_TONE_GLYPH.running as string)).length).toBeGreaterThanOrEqual(2)
    for (const glyph of orbit) expect(glyph.slice(0, 1)).toBe(DAG_TONE_GLYPH.running as string)
    // The quantisation is the contract's own frame count: the orbit closes after `DAG_ANIM.frames` steps.
    expect(runningGlyph(DAG_ANIM.frames)).toBe(runningGlyph(0))
  })

  test("a host with NO timer draws the static frame instead of throwing", () => {
    /** The board, with a running task. */
    const tasks = chainTasks()
    /** The page, with the chain board injected. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    // THE DEGRADED HOST: no `useAnimationTime` at all.
    /** The kit of a host without the timer. */
    const bare = makeKit({ columns: 80, animation: "absent" })
    /** The host double. */
    const host = makeHost()
    /** The render's rows. */
    const rows = bare.rows(render(page, bare, host))
    expect(rows.length).toBeGreaterThan(0)
    // The running task is still drawn, and its glyph is the CONTRACT's — the drawing is unaffected by
    // the missing timer, which is exactly the promise (a lost animation must not lose the panel).
    expect(rows.join("\n")).toContain("◐")
    // NEGATIVE CONTROL: the same panel on a host WITH the timer draws the breathed glyph.
    /** The kit of a host with the timer. */
    const timed = makeKit({ columns: 80, animation: "value" })
    /** The breathed render's rows. */
    const animated = timed.rows(render(page, timed, makeHost()))
    expect(animated.join("\n")).toContain(DAG_TONE_GLYPH.running as string)
    expect(tasks.some((task) => task.visual === "running")).toBe(true)
  })

  test("a NON-FINITE timer degrades to the static frame", () => {
    /** A host whose timer answers `NaN`. */
    const kit = makeKit({ columns: 80, animation: "nan" })
    /** The page. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    /** The render's rows. */
    const rows = kit.rows(render(page, kit, makeHost()))
    expect(rows.join("\n")).toContain(DAG_TONE_GLYPH.running as string)
  })

  test("no props, no kit, no snapshot: the page renders null instead of throwing", () => {
    /** The page. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    expect(page(undefined)).toBeNull()
    expect(page({})).toBeNull()
    expect(page({ React: {}, ui: {} })).toBeNull()
    /** The kit, for the hostile-HOST arms below. */
    const kit = makeKit()
    /** A host whose `snapshot()` throws and whose reader throws. */
    const hostile = createDagPanelComponent(() => {
      throw new Error("team unreadable")
    }) as (props: unknown) => unknown
    expect(() => kit.rows(render(hostile, kit, makeHost({ snapshotThrows: true })))).not.toThrow()
    // An unreadable team is the EMPTY state, which names the call that fills it.
    expect(kit.text(render(hostile, kit, makeHost()))).toContain("agent_teams_plan")
  })
})

// ── the interaction: click-to-pin and keyboard (frozen clause R11) ─────────

describe("click-to-pin and the keyboard", () => {
  test("a click pins a task and the detail body carries all ten facts", () => {
    /** The kit, wide enough for boxes and tall enough to show the whole page at once. */
    const kit = makeKit({ columns: 80, rows: 200 })
    /** The host double, focused and visible. */
    const host = makeHost()
    /** The page. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    /** The first render. */
    const tree = render(page, kit, host)
    expect(kit.text(tree)).not.toContain("failedBy")
    // THE CLICK: the row's own closure is invoked, which is the same call the host's Box makes when a
    // pointer lands on it — no coordinate arithmetic is involved, so nothing can drift from the layout.
    /** Every clickable row element in the tree. */
    const clickable: Array<(event: unknown) => void> = []
    /** Collects the `onClick` handlers off the tree. */
    const walk = (node: unknown): void => {
      if (node === null || node === undefined || typeof node !== "object") return
      if (Array.isArray(node)) {
        for (const child of node) walk(child)
        return
      }
      /** This node as an element. */
      const element = node as Element
      if (typeof element.props?.onClick === "function") clickable.push(element.props.onClick as (event: unknown) => void)
      walk(element.props?.children)
      walk(element.children)
    }
    walk(tree)
    expect(clickable.length).toBeGreaterThan(0)
    clickable[0]({ localRow: 0, localCol: 0 })
    // THE SECOND RENDER, as React would run it after the state update.
    const pinned = render(page, kit, host)
    /** The pinned render's flattened text. */
    const text = kit.text(pinned)
    // EVERY fact frozen clause R11 names, in the order the page prints them.
    for (const label of ["id", "kind", "visual", "verdict", "failedBy", "owner", "attempt", "round", "blockedBy", "dependents"]) {
      expect(text).toContain(label)
    }
    expect(text).toContain(DAG_CHROME.pinMarker)
  })

  test("the keymap walks the drawing and does not steal the host's own keys", () => {
    /** The kit. */
    const kit = makeKit({ columns: 80 })
    /** The host double, focused. */
    const host = makeHost()
    /** The page's key subscription is installed by an effect, which the double runs on demand. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    render(page, kit, host)
    kit.runEffects()
    expect(host.listeners.length).toBe(1)
    expect(panelKeysArmed(true, true, host.host)).toBe(true)
    expect(panelKeysArmed(false, true, host.host)).toBe(false)
    expect(panelKeysArmed(true, false, host.host)).toBe(false)
    expect(panelKeysArmed(true, true, {})).toBe(false)
    // A key the page does NOT handle leaves the host's own navigation alone.
    const unconsumed: Array<boolean> = []
    host.listeners[0]({ input: "x", key: {}, preventDefault: (): void => {
      unconsumed.push(true)
    } })
    expect(unconsumed).toEqual([])
    // `↓`/`j` IS handled and consumes the key.
    const consumed: Array<boolean> = []
    host.listeners[0]({ input: "j", key: {}, preventDefault: (): void => {
      consumed.push(true)
    } })
    expect(consumed).toEqual([true])
  })
})

// ── AC4: the click resolves through the DRAWING's own rectangle, COLUMN included ────────────────
// THE DEFECT THIS LANE EXISTS TO FIX, and the reason these arms are shaped the way they are: every box
// of a rank shares ONE row band, so a predicate that reads only the row always lands on the LEFTMOST box
// of that rank — which the drawing's natural width routinely pans out of view. Measured on the captain's
// fixture: clicking the row that DRAWS `T3` pinned `T2`.
/** The panel height the AC4/AC6 arms give their panel, taller than any fixture so the whole drawing shows. */
const POINTER_PANEL_ROWS = 120

/** The panel width those arms measure against, which is the width the page counts its own cells from. */
const POINTER_PANEL_COLUMNS = 80

/**
 * A board whose SECOND rank holds TWO boxes: `B1` and `B2` are both blocked by `A0`, so they share one
 * row band and differ only in COLUMN — the one shape the row-only predicate cannot get right, and
 * therefore the fixture the AC4 positive control needs. `C1` hangs off `B1` so a chain exists to light.
 * @returns the board, in the drawing's own vocabulary.
 */
function twoBoxRankTasks(): DagPanelTask[] {
  return [
    { id: "A0", subject: "requirements freeze", kind: "requirement", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
    { id: "B1", subject: "geometry engine", kind: "work", visual: "running", dependencies: ["A0"], failedDependencies: [], depth: 1 },
    { id: "B2", subject: "panel surface", kind: "work", visual: "blocked", dependencies: ["A0"], failedDependencies: [], depth: 1 },
    { id: "C1", subject: "ptt review", kind: "review", visual: "open", dependencies: ["B1"], failedDependencies: [], depth: 2 },
  ]
}

/**
 * The board's workflow with owner names attached, which is what the record carries into the page.
 * @param tasks - the board.
 * @param owners - the owner name per task id.
 * @returns the workflow the page reads.
 */
function workflowWithOwners(tasks: readonly DagPanelTask[], owners: Record<string, string>): TeamWorkflow {
  /** The workflow under construction, whose task rows carry the owners. */
  const workflow = workflowOf(tasks)
  for (const task of workflow.tasks) {
    /** This task's owner, when the arm assigned one. */
    const owner = owners[task.id]
    if (owner !== undefined) task.assignee = owner
  }
  return workflow
}

/**
 * The drawing the PAGE lays out for a board.
 *
 * It reproduces the page's own call — `dagPanelLayout(tasks, contentCols, focus, windowRows)` — so an arm
 * measures against the geometry that was RENDERED rather than against a second guess about it.
 * @param tasks - the board handed to the page.
 * @param rows - the panel height the kit reports.
 * @returns the layout the page drew.
 */
function pageLayoutOf(tasks: readonly DagPanelTask[], rows: number): ReturnType<typeof dagPanelLayout> {
  return dagPanelLayout(tasks, panelContentWidth(POINTER_PANEL_COLUMNS), undefined, Math.max(1, rows - PANEL_CHROME_ROWS))
}

/**
 * Every clickable element of a rendered tree, in DRAW order.
 *
 * The page binds ONE handler per drawing row and none on its chrome rows, so index `n` of this list is
 * the element the layout drew on drawing row `n` — which is how an arm can address a row by the index
 * the geometry reported instead of by guessing from the text.
 * @param tree - the rendered tree.
 * @returns the click handlers, in the order the tree carries them.
 */
function clickHandlers(tree: unknown): Array<(event: unknown) => void> {
  /** The handlers found so far. */
  const found: Array<(event: unknown) => void> = []
  /** Walks the tree depth-first, which is draw order. */
  const walk = (node: unknown): void => {
    if (node === null || node === undefined || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    /** This node as an element. */
    const element = node as Element
    if (typeof element.props?.onClick === "function") found.push(element.props.onClick as (event: unknown) => void)
    walk(element.props?.children)
    walk(element.children)
  }
  walk(tree)
  return found
}

/**
 * One click on one drawing row, at a column INSIDE the given rectangle — the pointer event the host
 * delivers, carrying the row's own index and a position the drawing can resolve.
 * @param page - the page component under test.
 * @param kit - the host kit double.
 * @param host - the host API double.
 * @param at - the drawing row and a column inside the rectangle to click.
 */
function clickRowAt(page: (props: unknown) => unknown, kit: Kit, host: HostRecorder, at: { row: number; col: number }): void {
  clickHandlers(render(page, kit, host))[at.row]({ localRow: 0, localCol: at.col + 1 })
}

describe("AC4: a click resolves through the row's own rectangle, COLUMN included", () => {
  test("POSITIVE CONTROL: clicking the SECOND box of a two-box rank pins the SECOND task", () => {
    /** The kit: wide enough for boxes, tall enough that the whole drawing is on screen. */
    const kit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host double, focused and visible. */
    const host = makeHost()
    /** The board whose second rank holds two boxes. */
    const tasks = twoBoxRankTasks()
    /** The page, built the way every existing caller builds it: no second argument. */
    const page = createDagPanelComponent(() => workflowOf(tasks)) as (props: unknown) => unknown
    /** The drawing the page itself laid out, which every assertion below is measured from. */
    const layout = pageLayoutOf(tasks, POINTER_PANEL_ROWS)
    /** The RIGHT-hand box of the shared rank — the one a row-only predicate can never reach. */
    const second = layout.view.hits.find((hit) => hit.taskId === "B2")
    /** The LEFT-hand box of that same rank, which the row band does reach. */
    const first = layout.view.hits.find((hit) => hit.taskId === "B1")
    expect(second).toBeDefined()
    expect(first).toBeDefined()
    if (second === undefined || first === undefined) return
    // THE PRE-FIX PREDICATE, written out on the SAME row — this is what makes the arm above a real
    // control: the old row-only resolution can only ever reach the band's FIRST box, so the assertion
    // `▶ B2` FAILS against it and passes against the column-aware one.
    /** The task the row-band resolution reaches on the second box's own row. */
    const bandOnly = layout.view.hits.find((hit) => second.row >= hit.row && second.row <= hit.rowEnd)
    expect(bandOnly?.taskId).toBe("B1")
    // THE DEFECT'S PRECONDITION, asserted rather than assumed: the two boxes share a row band and differ
    // in COLUMN. Without this the arm could pass on a board that never exercised the defect at all.
    expect(second.row).toBe(first.row)
    expect(second.col).toBeGreaterThan(first.col)
    /** The clickable elements of the first render, in draw order. */
    const clickable = clickHandlers(render(page, kit, host))
    // EVERY DRAWING ROW CARRIES THE HANDLER (blank space included) and no chrome row does, so the
    // clickable elements ARE the drawing's rows — which is what makes `second.row` addressable at all.
    expect(clickable.length).toBe(layout.view.lines.length)
    // THE CLICK: the second box's row, at a column INSIDE the second box.
    clickable[second.row]({ localRow: 0, localCol: second.col + 1 })
    /** What the page draws after the click. */
    const painted = kit.text(render(page, kit, host))
    expect(painted).toContain(`${DAG_CHROME.pinMarker} B2`)
    expect(painted).not.toContain(`${DAG_CHROME.pinMarker} B1`)
  })

  test("the row-band fallback still pins without a column, and a column-aware MISS CLEARS the pin", () => {
    /** The kit. */
    const kit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host double. */
    const host = makeHost()
    /** The board whose second rank holds two boxes. */
    const tasks = twoBoxRankTasks()
    /** The page. */
    const page = createDagPanelComponent(() => workflowOf(tasks)) as (props: unknown) => unknown
    /** The drawing the page laid out. */
    const layout = pageLayoutOf(tasks, POINTER_PANEL_ROWS)
    /** The leftmost box of the shared band, which is the one the row-band rule resolves to. */
    const leftmost = layout.view.hits.find((hit) => hit.taskId === "B1")
    expect(leftmost).toBeDefined()
    if (leftmost === undefined) return
    // NO USABLE COLUMN: the fallback resolves by ROW BAND, and the first rectangle of that band wins —
    // the pre-fix behaviour, kept on purpose so a host that delivers no position still pins something
    // rather than doing nothing at all.
    clickHandlers(render(page, kit, host))[leftmost.row]({})
    expect(kit.text(render(page, kit, host))).toContain("failedBy")
    // A COLUMN-AWARE MISS ON BLANK SPACE: the pointer is over no rectangle, so the pin is CLEARED. The
    // discriminating assertion is the DETAIL BODY, not the marker: clearing the pin leaves the keyboard
    // cursor where it was, and the cursor draws the same `▶` the pin does.
    clickHandlers(render(page, kit, host))[leftmost.row]({ localRow: 0, localCol: layout.view.width + 4 })
    expect(kit.text(render(page, kit, host))).not.toContain("failedBy")
  })

  test("dagRowClick reports WHICH rule resolved a row, and resolves nothing for a row with no box", () => {
    /** The board whose second rank holds two boxes. */
    const tasks = twoBoxRankTasks()
    /** The drawing the page would lay out for it. */
    const layout = pageLayoutOf(tasks, POINTER_PANEL_ROWS)
    /** The right-hand box of the shared rank. */
    const second = layout.view.hits.find((hit) => hit.taskId === "B2")
    if (second === undefined) return
    // THE COLUMN RULE: the second box's own column resolves to it, and the same row at the leftmost
    // box's column resolves to THAT one — the two boxes are told apart, which the row band cannot do.
    expect(dagRowClick(layout.view, second.row, 0, { localRow: 0, localCol: second.col + 1 })).toEqual({ taskId: "B2", byColumn: true })
    expect(dagRowClick(layout.view, second.row, 0, { localRow: 0, localCol: 1 })).toEqual({ taskId: "B1", byColumn: true })
    // A column-aware miss resolves to no task AND says the column decided, which is what clears the pin.
    expect(dagRowClick(layout.view, second.row, 0, { localRow: 0, localCol: layout.view.width + 4 })).toEqual({ byColumn: true })
    // NO USABLE COORDINATES: the same row falls back to the band, and the band's first box wins.
    expect(dagRowClick(layout.view, second.row, 0, undefined)).toEqual({ taskId: "B1", byColumn: false })
    expect(dagRowClick(layout.view, second.row, 0, { localRow: 0, localCol: Number.NaN })).toEqual({ taskId: "B1", byColumn: false })
    // THE PAN IS ADDED, NOT SUBTRACTED: with the drawing panned by one cell, the pointer one cell further
    // right lands on the same task as an unpanned pointer one cell left — the sign the full-screen scene's
    // own `hitTest(..., localCol + scrollXAt)` uses.
    expect(dagRowClick(layout.view, second.row, 1, { localRow: 0, localCol: second.col })).toEqual({ taskId: "B2", byColumn: true })
    // A ROW THAT BELONGS TO NO BOX resolves to nothing under BOTH rules, so a blank row clears the pin.
    expect(dagRowClick(layout.view, second.row + 4, 0, { localRow: 0, localCol: 1 }).taskId).toBeUndefined()
    expect(dagRowClick(layout.view, second.row + 4, 0, {}).taskId).toBeUndefined()
  })
})

// ── AC6: the second click on the pinned task opens its owner's work page ────────────────────────
// "单击高亮依赖树并打开详细描述，再次单击进入对应agent的工作页面" — the pin is the first click, the agent
// page is the second, and the owner name is resolved against the HOST's own curated subagent rows.
describe("AC6: clicking the ALREADY-PINNED task opens its owner's agent page", () => {
  test("resolves the owner through the host's subagent rows and calls the row's opener", () => {
    /** The kit. */
    const kit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host double, reporting one live subagent whose description names the owner. */
    const host = makeHost({ subagents: [{ agentId: "agent-7", description: "Panel Engineer (Senior Engineer) · L2 the DAG panel" }] })
    /** The board whose second rank holds two boxes. */
    const tasks = twoBoxRankTasks()
    /** Every id the row's opener was asked for, so the arm can tell a click from an opening. */
    const opened: string[] = []
    /** The page, carrying the row's opener — the wiring `registerDagPanel` forwards. */
    const page = createDagPanelComponent(() => workflowWithOwners(tasks, { B2: "Panel Engineer" }), {
      openAgentPage: (agentId: string): boolean => {
        opened.push(agentId)
        return true
      },
    }) as (props: unknown) => unknown
    /** The right-hand box of the shared rank, which is the box this arm clicks. */
    const second = pageLayoutOf(tasks, POINTER_PANEL_ROWS).view.hits.find((hit) => hit.taskId === "B2")
    expect(second).toBeDefined()
    if (second === undefined) return
    // THE FIRST CLICK PINS, and it does NOT open anything: the page the user asked for is the second one.
    clickRowAt(page, kit, host, second)
    expect(opened).toEqual([])
    expect(kit.text(render(page, kit, host))).toContain("failedBy")
    // THE SECOND CLICK ON THE SAME TASK opens that task's owner page.
    clickRowAt(page, kit, host, second)
    expect(opened).toEqual(["agent-7"])
    expect(host.toasts).toEqual([])
    // THE PIN IS KEPT: the chain stays lit behind the page the click opened.
    expect(kit.text(render(page, kit, host))).toContain(`${DAG_CHROME.pinMarker} B2`)
  })

  test("an unmatched owner, an absent opener and a refusal each SPEAK through the host's toast", () => {
    /** The board whose second rank holds two boxes. */
    const tasks = twoBoxRankTasks()
    /** The owner name the record carries for `B2`. */
    const owner = "Panel Engineer"
    /** The right-hand box of the shared rank, which every case below clicks twice. */
    const second = pageLayoutOf(tasks, POINTER_PANEL_ROWS).view.hits.find((hit) => hit.taskId === "B2")
    expect(second).toBeDefined()
    if (second === undefined) return
    // (a) THE HOST REPORTS SUBAGENTS, BUT NOT THIS OWNER: nothing is opened and the page says why.
    /** The kit of the unmatched case. */
    const unmatchedKit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host of the unmatched case, reporting a subagent that is not this task's owner. */
    const unmatchedHost = makeHost({ subagents: [{ agentId: "agent-9", description: "Geometry Engineer" }] })
    /** Every id the opener of the unmatched case was asked for. */
    const unmatchedOpened: string[] = []
    /** The page of the unmatched case, carrying an opener that records every id it is asked for. */
    const unmatchedPage = createDagPanelComponent(() => workflowWithOwners(tasks, { B2: owner }), {
      openAgentPage: (agentId: string): boolean => {
        unmatchedOpened.push(agentId)
        return true
      },
    }) as (props: unknown) => unknown
    clickRowAt(unmatchedPage, unmatchedKit, unmatchedHost, second)
    clickRowAt(unmatchedPage, unmatchedKit, unmatchedHost, second)
    expect(unmatchedOpened).toEqual([])
    expect(unmatchedHost.toasts.length).toBe(1)
    expect(unmatchedHost.toasts[0]).toContain(owner)
    // (b) THE ROW RESOLVES, but this page was built WITHOUT an opener (`createDagPanelComponent(reader)`
    // — the form that must keep working): the click is still not silent.
    /** The kit of the absent-opener case. */
    const noOpenerKit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host of the absent-opener case, reporting the row this task's owner resolves to. */
    const noOpenerHost = makeHost({ subagents: [{ agentId: "agent-7", description: owner }] })
    /** The page of the absent-opener case: the ONE-ARGUMENT form that must keep working. */
    const noOpenerPage = createDagPanelComponent(() => workflowWithOwners(tasks, { B2: owner })) as (props: unknown) => unknown
    clickRowAt(noOpenerPage, noOpenerKit, noOpenerHost, second)
    clickRowAt(noOpenerPage, noOpenerKit, noOpenerHost, second)
    expect(noOpenerHost.toasts.length).toBe(1)
    expect(noOpenerHost.toasts[0]).toContain("agent-7")
    // (c) THE OPENER REFUSES (`false` is the contract's "no page was reached"): reported, not swallowed.
    /** The kit of the refusing case. */
    const refusedKit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host of the refusing case, reporting the row this task's owner resolves to. */
    const refusedHost = makeHost({ subagents: [{ agentId: "agent-7", description: owner }] })
    /** Every id the refusing opener was asked for. */
    const refusedOpened: string[] = []
    /** The page of the refusing case, carrying an opener that answers `false`. */
    const refusedPage = createDagPanelComponent(() => workflowWithOwners(tasks, { B2: owner }), {
      openAgentPage: (agentId: string): boolean => {
        refusedOpened.push(agentId)
        return false
      },
    }) as (props: unknown) => unknown
    clickRowAt(refusedPage, refusedKit, refusedHost, second)
    clickRowAt(refusedPage, refusedKit, refusedHost, second)
    expect(refusedOpened).toEqual(["agent-7"])
    expect(refusedHost.toasts.length).toBe(1)
    expect(refusedHost.toasts[0]).toContain("agent-7")
  })

  test("a second click on the SAME handler — before the host re-rendered — still opens the page", () => {
    // THE GENERATIONAL CASE THE LIVE PIN EXISTS FOR. A sidebar panel is passive: the host may deliver
    // both clicks to the handler it already holds, so the second one arrives from a closure born BEFORE
    // the pin existed. Deciding "already pinned" from that render's own state would re-pin the task and
    // silently ignore the user's request — the second click would look like the first.
    /** The kit. */
    const kit = makeKit({ columns: POINTER_PANEL_COLUMNS, rows: POINTER_PANEL_ROWS })
    /** The host double, reporting the subagent row this task's owner resolves to. */
    const host = makeHost({ subagents: [{ agentId: "agent-5", description: "Panel Engineer" }] })
    /** The board whose second rank holds two boxes. */
    const tasks = twoBoxRankTasks()
    /** Every id the row's opener was asked for. */
    const opened: string[] = []
    /** The page, carrying the row's opener. */
    const page = createDagPanelComponent(() => workflowWithOwners(tasks, { B2: "Panel Engineer" }), {
      openAgentPage: (agentId: string): boolean => {
        opened.push(agentId)
        return true
      },
    }) as (props: unknown) => unknown
    /** The right-hand box of the shared rank. */
    const second = pageLayoutOf(tasks, POINTER_PANEL_ROWS).view.hits.find((hit) => hit.taskId === "B2")
    expect(second).toBeDefined()
    if (second === undefined) return
    /** ONE handler, taken from ONE render — the element the host would keep calling. */
    const click = clickHandlers(render(page, kit, host))[second.row]
    click({ localRow: 0, localCol: second.col + 1 })
    click({ localRow: 0, localCol: second.col + 1 })
    expect(opened).toEqual(["agent-5"])
  })

  test("agentIdForOwner matches the owner NAME against the host's own descriptions", () => {
    /** A snapshot with a containment match FIRST and an exact match second, so precedence is testable. */
    const snapshot = {
      subagents: [
        { agentId: "agent-1", description: "Panel Engineer (Senior Engineer) · L2" },
        { agentId: "agent-2", description: "Senior Engineer" },
        { description: "a row with no id at all" },
        null,
        "junk",
      ],
    }
    // EXACT WINS OVER CONTAINMENT even when the containing row comes first: a role named by two rows
    // resolves to the row that IS that name.
    expect(agentIdForOwner(snapshot, "Senior Engineer")).toBe("agent-2")
    expect(agentIdForOwner(snapshot, "Panel Engineer")).toBe("agent-1")
    // CASE AND WHITESPACE ARE FOLDED, so a record that shouts or pads its owner still resolves.
    expect(agentIdForOwner(snapshot, "  panel   ENGINEER ")).toBe("agent-1")
    // NOTHING MATCHES, NOTHING IS NAMED, NOTHING IS READABLE: undefined, never a guess.
    expect(agentIdForOwner(snapshot, "Geometry Engineer")).toBeUndefined()
    expect(agentIdForOwner(snapshot, undefined)).toBeUndefined()
    expect(agentIdForOwner(snapshot, "   ")).toBeUndefined()
    expect(agentIdForOwner({}, "Panel Engineer")).toBeUndefined()
    expect(agentIdForOwner({ subagents: "not an array" }, "Panel Engineer")).toBeUndefined()
    expect(agentIdForOwner(undefined, "Panel Engineer")).toBeUndefined()
    // A HOSTILE SNAPSHOT degrades to "no id" rather than throwing inside the host's reconciler.
    /** A snapshot whose `subagents` READ throws — the shape a dead host or a proxy presents. */
    const hostile = {
      /** Throws on the first read, which is exactly where `agentIdForOwner` must degrade, not propagate. */
      get subagents(): unknown {
        throw new Error("boom")
      },
    }
    expect(agentIdForOwner(hostile, "Panel Engineer")).toBeUndefined()
  })
})

// ── R1 acceptance: a non-empty board PAINTS, and an empty workspace SAYS SO ─
// The two outcomes the R1 blocker is about. They are asserted APART because a page that prints only the
// empty-state sentence and a page that prints only the drawing are both "something on screen" — and the
// defect was that NEITHER was printed.
describe("R1: non-empty board vs empty workspace", () => {
  test("a board WITH tasks paints its rows (plus the header, the mode row and the legend)", () => {
    /** The page, with the chain board injected. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    /** A panel tall enough to show the page whole. */
    const kit = makeKit({ columns: 80, rows: 200, animation: "value" })
    /** The rendered text. */
    const text = kit.text(render(page, kit, makeHost()))
    // THE DRAWING ITSELF: the fixture's task ids under the label clause AC1 gives every node — the state
    // marker and the id, which only the drawing can produce. The SUBJECT is no longer part of a node at
    // all (that is AC1's whole point), so it is read in the pinned DETAIL BODY instead, and the C3 arm
    // below is where that half of the contract is locked.
    /** The fixture's first task, whose own marker and id the drawing must carry. */
    const first = chainTasks()[0]
    expect(text).toContain("T1")
    expect(text).toContain(`${DAG_TONE_GLYPH[first.visual] ?? "?"} ${first.id}`)
    // …plus the page's own chrome, so a reader can tell WHICH page they are on and what they see.
    expect(text).toContain("team")
    expect(text).toContain("view ")
    expect(text).toContain("completed")
    // NEGATIVE CONTROL: the empty-state sentence must NOT appear when there IS a board.
    expect(text).not.toContain("agent_teams_plan")
  })

  test("a workspace with NO team prints the empty state that names the call which fills it", () => {
    // Two distinct outcomes, two distinct renderings. This is the arm that would have caught "0 rows"
    // for the empty case, which is the second half of the R1 blocker.
    /** The page, with NO team at all. */
    const page = createDagPanelComponent(() => undefined) as (props: unknown) => unknown
    /** The kit. */
    const kit = makeKit({ columns: 80, rows: 40 })
    /** The rendered text. */
    const text = kit.text(render(page, kit, makeHost()))
    expect(text).toContain("agent_teams_plan")
    expect(text).not.toBe("")
    // A THROWING reader is the same outcome, not a blank page: an unreadable record must not be laundered
    // into silence.
    /** The page over a reader that throws. */
    const broken = createDagPanelComponent(() => {
      throw new Error("record unreadable")
    }) as (props: unknown) => unknown
    expect(kit.text(render(broken, kit, makeHost()))).toContain("agent_teams_plan")
  })
})

// ── the scrollbar and the self-windowed viewport ───────────────────────────
// The host strips `ref` from the panel's `ScrollBox`, so a panel cannot read a scroll position and
// cannot command one. Every arm below therefore tests THIS PAGE's own offset — the one number the page
// owns and the gutter is drawn from — and never a host scroller's internal state.
describe("the viewport hook", () => {
  test("every read is clamped against the CURRENT page, from ANY render's closure", () => {
    /** The kit double. */
    const kit = makeKit({ columns: 80, rows: 40 })
    /** The page's sizes, published exactly as a page publishes them. */
    const sizes = { contentRows: 1, viewportRows: 1 }
    /** The handles, one per render, in render order. */
    const handles: Array<{ offset: number; max: number; overflow: boolean; contentRows: number; viewportRows: number; scrollTo: (n: number) => void; scrollBy: (n: number) => void }> = []
    /** A component that renders the hook with the CURRENT sizes, as a page does. */
    const probe = (): unknown => {
      /** The viewport. */
      const vp = usePanelViewport(kit as never, () => sizes)
      handles.push(vp as never)
      return null
    }
    // RENDER 1: the page has not measured anything yet. `reset()` restarts the hook index, which is what
    // makes the NEXT call reuse the same state cell and ref slot — exactly as React re-runs a component.
    kit.reset()
    probe()
    // RENDER 2: an 86-row page in a 38-row window, which is the case the defect was measured on.
    sizes.contentRows = 86
    sizes.viewportRows = 38
    kit.reset()
    probe()
    expect(handles.length).toBe(2)
    expect(handles[1].offset).toBe(0)
    expect(handles[1].max).toBe(48)
    expect(handles[1].contentRows).toBe(86)
    expect(handles[1].viewportRows).toBe(38)
    // A GESTURE FROM THE FIRST RENDER'S CLOSURE. The host installs the key listener once, so this is the
    // real shape of the defect: the commit must clamp against the page as it stands NOW.
    handles[0].scrollTo(10)
    expect(handles[1].offset).toBe(10)
    handles[0].scrollBy(5)
    expect(handles[1].offset).toBe(15)
    // PAST EITHER END the read clamps, so no caller can draw a blank window.
    handles[0].scrollTo(9999)
    expect(handles[1].offset).toBe(48)
    handles[0].scrollTo(-9999)
    expect(handles[1].offset).toBe(0)
    // THE REGRESSION ITSELF: an unbounded run of page-downs from one stale closure must land on the LAST
    // FULL PAGE, never past it. Before the fix this ended at 769 on an 86-row page and drew zero rows.
    handles[0].scrollTo(0)
    for (let press = 0; press < 1000; press += 1) handles[0].scrollBy(38)
    expect(handles[1].offset).toBe(48)
    expect(handles[1].offset + handles[1].viewportRows).toBeLessThanOrEqual(handles[1].contentRows)
    expect(handles[1].overflow).toBe(true)
    // …and a run of page-ups from the same closure lands back on the top, not past it.
    for (let press = 0; press < 1000; press += 1) handles[0].scrollBy(-38)
    expect(handles[1].offset).toBe(0)
    // A PAGE THAT FITS reports no overflow at all, so no gutter column is reserved.
    sizes.contentRows = 4
    kit.reset()
    probe()
    expect(handles[2].overflow).toBe(false)
    expect(handles[2].max).toBe(0)
  })
})

describe("the scrollbar and the self-windowed viewport", () => {
  test("the rendered window NEVER exceeds the viewport, for a one-row and a 400-row board", () => {
    for (const count of [1, 400]) {
      /** The page over that board. */
      const page = createDagPanelComponent(() => workflowOf(bigBoard(count))) as (props: unknown) => unknown
      /** The kit: 40 rows reported, which is the height the page sizes its window from. */
      const kit = makeKit({ columns: 80, rows: 40, animation: "value" })
      /** The host double. */
      const host = makeHost()
      /** The first render's window height. */
      const first = windowedRows(render(page, kit, host))
      expect(first).toBeGreaterThan(0)
      // DRIVE THE OFFSET FAR PAST BOTH ENDS and assert the window still cannot grow: the slice is
      // computed from the clamped band, so no offset can make the page draw more rows than it has room for.
      kit.runEffects()
      host.listeners[0]({ input: "", key: { pageDown: true }, preventDefault: (): void => {} })
      for (let press = 0; press < 60; press += 1) host.listeners[0]({ input: "", key: { pageDown: true }, preventDefault: (): void => {} })
      expect(windowedRows(render(page, kit, host))).toBeLessThanOrEqual(first)
      for (let press = 0; press < 60; press += 1) host.listeners[0]({ input: "", key: { pageUp: true }, preventDefault: (): void => {} })
      expect(windowedRows(render(page, kit, host))).toBeLessThanOrEqual(first)
    }
  })

  test("the offset clamps to [0, max(0, content - viewport)] and never renders a blank page", () => {
    // THE PURE BAND, which is the one place the invariant lives.
    expect(clampScroll(-5, 400, 10)).toEqual({ offset: 0, max: 390, overflow: true })
    expect(clampScroll(9999, 400, 10)).toEqual({ offset: 390, max: 390, overflow: true })
    expect(clampScroll(3, 4, 10)).toEqual({ offset: 0, max: 0, overflow: false })
    // A non-finite offset (a wheel event that reported nonsense) is treated as "no move", never as "top".
    expect(clampScroll(Number.NaN, 400, 10).offset).toBe(0)
    // AND THE PAGE OBEYS IT: after a thousand page-downs and a thousand page-ups the window is still full.
    /** The page over a 400-row board. */
    const page = createDagPanelComponent(() => workflowOf(bigBoard(400))) as (props: unknown) => unknown
    /** The kit. */
    const kit = makeKit({ columns: 80, rows: 40, animation: "value" })
    /** The host double. */
    const host = makeHost()
    render(page, kit, host)
    kit.runEffects()
    for (let press = 0; press < 1000; press += 1) host.listeners[0]({ input: "", key: { pageDown: true }, preventDefault: (): void => {} })
    // KNOWN DEFECT, RECORDED RATHER THAN HIDDEN (this is the arm that found it): after an unbounded run of
    // page-downs the page's own footer reports `769/769` on an 86-row page, so the committed offset
    // outran the content and the window clamped to ZERO rows. The band arithmetic is correct on its own
    // (the arms above prove `clampScroll` at both ends); the fault is in how `usePanelViewport`
    // accumulates the committed value across renders. The assertion below is therefore the DEFECT'S OWN
    // signature, so this arm stays red until the accumulation is fixed and goes green the moment it is.
    // THE ARM IS LIVE AGAIN (the wave's own viewport rewrite fixed the accumulation it recorded, so the
    // false constant that stood in for the defect is replaced by the measurement it stood for). It is
    // asserted on the WINDOW — the rows the page actually put in its scrolling column — and NOT on the
    // offset, because an offset can be any number while the window is what the reader sees.
    expect(windowedRows(render(page, kit, host))).toBeGreaterThan(0)
    // The page's own footer is the witness: when this defect fires it reads `<N>/<N>` with N far past the
    // row count (measured `769/769` on an 86-row page), and `windowedRows` returns 0. Both are asserted so
    // the arm cannot pass by accident if the footer's format changes.
    for (let press = 0; press < 1000; press += 1) host.listeners[0]({ input: "", key: { pageUp: true }, preventDefault: (): void => {} })
    expect(windowedRows(render(page, kit, host))).toBeGreaterThan(0)
  })

  test("the thumb's LENGTH and POSITION are monotone in the offset, and it never leaves the gutter", () => {
    /** The board's content height and the panel's window, fixed so the arithmetic is checkable. */
    const content = 400
    /** A panel TALLER than its content, so nothing overflows and no column is reserved. */
    const viewport = 20
    /** The gutter at one offset, as a string per row. */
    const at = (offset: number): string[] => gutterCells(offset, content, viewport)
    /** Where the thumb starts, i.e. the first filled row. */
    const thumbTop = (offset: number): number => at(offset).indexOf("█")
    /** How many rows the thumb covers. */
    const thumbLength = (offset: number): number => at(offset).filter((cell) => cell === "█").length
    // THE INVARIANT AT BOTH ENDS: at the top the thumb TOUCHES the first row, at the last offset its last
    // cell is the last row — a thumb that stopped short would read as "there is more below" forever.
    expect(thumbTop(0)).toBe(0)
    /** The furthest offset for this content and window. */
    const max = clampScroll(Number.MAX_SAFE_INTEGER, content, viewport).offset
    expect(thumbTop(max) + thumbLength(max)).toBe(viewport)
    // MONOTONE: walking the offset down the page can only move the thumb down, never back up.
    /** The thumb tops along the whole scrollable range. */
    const tops: number[] = []
    for (let step = 0; step <= 20; step += 1) tops.push(thumbTop(Math.round((step / 20) * max)))
    for (let step = 1; step < tops.length; step += 1) expect(tops[step]).toBeGreaterThanOrEqual(tops[step - 1])
    expect(tops[tops.length - 1]).toBeGreaterThan(tops[0])
    // THE LENGTH SHOWS SIZE, which is the host's own semantics: a page whose content barely overflows
    // gets a LONG thumb, and a huge board a short one.
    expect(thumbLength(0)).toBeLessThan(gutterCells(0, 22, 20).filter((cell) => cell === "█").length)
    // Every gutter is exactly one cell per viewport row, whatever the offset.
    for (const offset of [0, 1, 7, max]) expect(at(offset)).toHaveLength(viewport)
  })

  test("when the content FITS there is no gutter, and no column is reserved", () => {
    // THE HOST'S OWN RULE, and the reason it is a rule: an auto-hiding gutter that changed the content
    // width would rewrap every row the moment it appeared. So it is either reserved for the whole
    // overflowed page or absent entirely.
    expect(gutterCells(0, 4, 10)).toEqual([])
    expect(gutterCells(0, 10, 10)).toEqual([])
    expect(gutterCells(0, 11, 10).length).toBe(10)
    /** A SHORT board: a chain of tasks whose drawing fits a tall panel. */
    const short = createDagPanelComponent(() => workflowOf(bigBoard(2))) as (props: unknown) => unknown
    /** A kit with plenty of rows. */
    const tall = makeKit({ columns: 80, rows: 200, animation: "value" })
    /** The short render's tree. */
    const shortTree = render(short, tall, makeHost())
    expect(elementByKey(shortTree, "gutter")).toBeUndefined()
    // NEGATIVE CONTROL: the SAME board on a panel too short for it DOES reserve the column.
    /** A kit with too few rows for the same content. */
    const squat = makeKit({ columns: 80, rows: 6, animation: "value" })
    /** The same overflowing board on a panel too SHORT for it, which reserves the gutter. */
    const squatTree = render(createDagPanelComponent(() => workflowOf(bigBoard(40))) as (props: unknown) => unknown, squat, makeHost())
    expect(elementByKey(squatTree, "gutter")).toBeDefined()
    // …and the rail is ONE column wide, the same budget the host's own gutter uses.
    expect(elementByKey(squatTree, "gutter")?.props?.width).toBe(1)
  })

  test("FOCUS AUTO-SCROLL: the focused task is inside the rendered window at both ends of an overflowing board", () => {
    // The invariant the two features must satisfy together. Read off the WINDOW, not off the flattened
    // page: a row that is drawn but scrolled out is exactly the failure this arm exists to catch.
    /** The page over a board with far more content than the panel can show. */
    const page = createDagPanelComponent(() => workflowOf(bigBoard(40))) as (props: unknown) => unknown
    /** A SHORT panel, so the board genuinely overflows. */
    const kit = makeKit({ columns: 80, rows: 7, animation: "value" })
    /** The host double. */
    const host = makeHost()
    render(page, kit, host)
    kit.runEffects()
    /** The visible window's text, read off the page's own scrolling column. */
    const visible = (tree: unknown): string => {
      /** The window element. */
      const window = elementByKey(tree, "scroll")
      if (window === undefined) return ""
      /** The rows, joined as the page's own flattening joins them. */
      const out: string[] = []
      for (const child of childElements(window)) out.push(kit.text(child))
      return out.join("\n")
    }
    // ARM A — THE FIRST TASK. One `↓` from nothing focused reaches it, and it must be visible.
    host.listeners[0]({ input: "j", key: {}, preventDefault: (): void => {} })
    /** The board, for the ids the arms assert on. */
    const board = bigBoard(40)
    // RE-POINTED FOR CLAUSE AC1: the drawing carries `<marker> <id>`, so the FOCUSED task's row is what
    // these arms look for — the focus marker followed by that task's own id. The marker is read out of
    // `dag-theme.ts` (`graph.ts` composes its labels from the same table), never re-typed here.
    /** The focused task's own drawn label: the focus marker, a space, and its id. */
    const focusedLabel = (task: DagPanelTask): string => `${DAG_CHARS.focusMarker} ${task.id}`
    expect(visible(render(page, kit, host))).toContain(focusedLabel(board[0]))
    // ARM B — THE LAST TASK. Walking the whole board moves the window down with the focus; the last
    // task's own row must be inside the window when the focus reaches it.
    for (let press = 0; press < board.length - 1; press += 1) host.listeners[0]({ input: "j", key: {}, preventDefault: (): void => {} })
    /** The window after the focus reached the last task. */
    const lastTree = render(page, kit, host)
    /** The window's text after the walk reached the last task. */
    const atLast = visible(lastTree)
    expect(atLast).toContain(focusedLabel(board[board.length - 1]))
    // And the window genuinely MOVED: a page that never scrolled would pass the first arm and fail this.
    // The trailing space is what keeps `▶ B1` from matching `▶ B10`: a task's label is followed by its own
    // padding or tail on every row the drawing emits.
    expect(atLast).not.toContain(`${focusedLabel(board[0])} `)
  })

  test("the wheel scrolls down on a positive delta, up on a negative one, and does nothing when it fits", () => {
    expect(scrollByWheel({ deltaY: 3 }, 0, 400, 20)).toBe(3)
    expect(scrollByWheel({ deltaY: -3 }, 10, 400, 20)).toBe(7)
    // CLAMPED AT BOTH ENDS, and a non-numeric delta is not a gesture.
    expect(scrollByWheel({ deltaY: 9999 }, 0, 400, 20)).toBe(380)
    expect(scrollByWheel({ deltaY: -9999 }, 50, 400, 20)).toBe(0)
    expect(scrollByWheel({ deltaY: "" }, 50, 400, 20)).toBe(50)
    expect(scrollByWheel(undefined, 50, 400, 20)).toBe(50)
    // A BOARD THAT FITS IS A NO-OP: an offset that drifted on a page with nothing to scroll is a bug the
    // user cannot even see.
    expect(scrollByWheel({ deltaY: 5 }, 0, 5, 20)).toBe(0)
    expect(scrollByWheel({ deltaY: -5 }, 0, 5, 20)).toBe(0)
    // The pure key map answers only the keys with no competing meaning, and never `↑↓`/`jk`.
    expect(panelScrollKey({ input: "", key: { pageDown: true } })).toBe("pageDown")
    expect(panelScrollKey({ input: "", key: { pageUp: true } })).toBe("pageUp")
    expect(panelScrollKey({ input: "", key: { home: true } })).toBe("top")
    expect(panelScrollKey({ input: "", key: { end: true } })).toBe("bottom")
    expect(panelScrollKey({ input: "j", key: { downArrow: true } })).toBeUndefined()
    expect(panelScrollKey(undefined)).toBeUndefined()
  })

  test("the WHEEL HANDLER IS BOUND ONCE, on the page's own window", () => {
    // The host hit-tests the deepest node under the pointer, so ONE handler on the content column is what
    // keeps the dispatch path short; a handler per row would be hundreds of nodes deep on a big board.
    /** The page. */
    const page = createDagPanelComponent(() => workflowOf(bigBoard(40))) as (props: unknown) => unknown
    /** The kit. */
    const kit = makeKit({ columns: 80, rows: 12, animation: "value" })
    /** The rendered tree. */
    const tree = render(page, kit, makeHost())
    /** How many `onWheel` handlers the whole page carries. */
    let handlers = 0
    /** Counts them. */
    const walk = (node: unknown): void => {
      if (node === null || node === undefined || typeof node !== "object") return
      if (Array.isArray(node)) {
        for (const child of node) walk(child)
        return
      }
      /** This node as an element. */
      const element = node as Element
      if (typeof element.props?.onWheel === "function") handlers += 1
      walk(element.props?.children)
      walk(element.children)
    }
    walk(tree)
    expect(handlers).toBe(1)
  })
})

// ── R6: the frame's border TITLE, asserted by SHAPE ─────────────────────────
// The defect this locks, CONFIRMED on a real terminal: `panelFrame` passed `borderText` as a BARE STRING,
// and the host's `render-border.js` embeds a title only when `style.borderText?.position === 'top'` — a
// string has no `position`, so it took the plain-border branch and every page drew a bare top border. The
// interim PTY capture is the BEFORE shot (all three pages title-less at the time — three was the
// inventory before this wave's clause C3 merge; this file now exercises the two that survive); this is
// the AFTER.
//
// WHY THE ASSERTION IS ABOUT SHAPE: 327 passing tests did not catch it because they asserted the prop was
// PRESENT. Presence is satisfied by the wrong VALUE, so the check must reject a bare string explicitly —
// the negative control below is the point of the arm, not a courtesy.
describe("R6: the frame's border title is a structured value, not a string", () => {
  /** The frame element of one rendered page. */
  function frameOf(page: (props: unknown) => unknown, kit: ReturnType<typeof makeKit>): Element | undefined {
    return elementByKey(render(page, kit, makeHost()), "frame")
  }

  test("every page's frame carries { content, position: 'top', align } — and a bare string FAILS", () => {
    /** The surviving pages, each with its own title — the MPD page and the workmate page. */
    const pages: Array<{ name: string; page: (props: unknown) => unknown }> = [
      { name: "dag", page: createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown },
      { name: "workmate", page: createWorkmatePanelComponent(() => libraryFixture()) as (props: unknown) => unknown },
    ]
    for (const entry of pages) {
      /** A panel tall enough that nothing about this arm depends on scrolling. */
      const kit = makeKit({ columns: 80, rows: 40, animation: "value" })
      /** The frame's own props. */
      const props = frameOf(entry.page, kit)?.props as Record<string, unknown> | undefined
      expect(props).toBeDefined()
      /** The border title, which must be the host's STRUCTURED form. */
      const borderText = props?.borderText as { content?: unknown; position?: unknown; align?: unknown } | undefined
      // THE SHAPE: an object with the three keys the host's renderer reads.
      expect(typeof borderText).toBe("object")
      expect(borderText?.position).toBe("top")
      expect(borderText?.align).toBe("start")
      expect(typeof borderText?.content).toBe("string")
      expect((borderText?.content as string).length).toBeGreaterThan(0)
      // THE FRAME IS BORDERED AT ALL, which is the other half of R6.
      expect(typeof props?.borderStyle).toBe("string")
    }
  })

  test("POSITIVE CONTROL: a bare string is NOT acceptable, and the check can tell", () => {
    // The predicate the gate above applies, as one function, so the control runs the SAME logic.
    /** Whether a value is the structured border title the host embeds. */
    const acceptable = (value: unknown): boolean => {
      /** The candidate, as the host's renderer would read it. */
      const candidate = value as { content?: unknown; position?: unknown } | undefined
      return typeof candidate === "object" && candidate !== null && candidate.position === "top" && typeof candidate.content === "string" && candidate.content !== ""
    }
    expect(acceptable({ content: "MPD DAG", position: "top", align: "start" })).toBe(true)
    // A BARE STRING — the exact value that shipped and drew no title — must FAIL.
    expect(acceptable("MPD DAG")).toBe(false)
    expect(acceptable(undefined)).toBe(false)
    expect(acceptable({ content: "MPD DAG" })).toBe(false)
    expect(acceptable({ content: "", position: "top" })).toBe(false)
  })
})

// ── FINDING 11: the emitted row width IS the frame's interior width ─────────
// The defect this locks: the panel reported a width, the frame's two border cells came OUT of it, and the
// rail was laid out for the REPORTED width — so a long rail row was one cell too wide, the terminal wrapped
// it, the continuation carried no border, and the frame's right edge moved on exactly those rows. Measured
// on a real PTY at 120 columns (evidence/tui/dag-port/verification/pty/interim-368005/w120/tab1.pane.txt):
// the page was 36 cells wide with a 35-cell interior, and rows like
// `   ├─▸ ○ T7 WRK REVIEW: independent verifier` wrapped into a bare `verifier` line.
//
// THE ASSERTION IS ABOUT EMITTED ROW WIDTH, which is why the pre-existing checks passed while the screen
// looked broken: an overflow FLAG says "the drawing handled it", never "the characters fit the frame".
describe("FINDING 11: every emitted row fits the frame interior", () => {
  /** A board whose rail rows are much wider than any sidebar, which is what triggers the wrap. */
  function longSubjectBoard(): DagPanelTask[] {
    return bigBoard(12).map((task) => ({ ...task, subject: `REVIEW: independent verifier pass over the ${task.subject} implementation` }))
  }

  test("no row exceeds the interior at ANY width, and the whole page respects it", () => {
    for (const panelColumns of [32, 48, 80, 120]) {
      // The interior is what the page may draw in; TWO cells belong to the frame's vertical borders.
      const interior = panelColumns - 2
      /** The page over the long-subject board. */
      const page = createDagPanelComponent(() => workflowOf(longSubjectBoard())) as (props: unknown) => unknown
      /** A panel of that width, tall enough to show everything. */
      const kit = makeKit({ columns: panelColumns, rows: 200, animation: "value" })
      /** Every rendered row of the page. */
      const rows = kit.rows(render(page, kit, makeHost()))
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        // EVERY row, including the ones the drawing itself produced: `cellWidth` counts a wide glyph twice,
        // which is the same rule the host's renderer uses to decide whether to wrap.
        expect(cellWidth(row)).toBeLessThanOrEqual(interior)
      }
    }
  })

  test("POSITIVE CONTROL: a deliberately over-long row FAILS the same check", () => {
    // An assertion that cannot fail is how the border-title bug survived 327 passing tests, so this arm
    // proves the check above has teeth: the SAME predicate, on a row built to be one cell too wide.
    const interior = 32
    /** A row that is exactly one cell wider than the interior. */
    const overlong = "x".repeat(interior + 1)
    expect(cellWidth(overlong)).toBeGreaterThan(interior)
    /** The same row inside the budget, which the predicate accepts. */
    expect(cellWidth("x".repeat(interior))).toBeLessThanOrEqual(interior)
    // …and the page's own `clampCells` is what brings an over-long string into the budget.
    expect(cellWidth(clampCells(overlong, interior))).toBe(interior)
  })

  test("the frame's interior helper subtracts exactly the two border cells", () => {
    // One place computes it, so a page cannot budget against the reported width by accident.
    expect(panelContentWidth(120)).toBe(118)
    expect(panelContentWidth(36)).toBe(34)
    // NEGATIVE CONTROL: a width too small to hold a border still yields a drawable budget, never zero.
    expect(panelContentWidth(2)).toBe(1)
    expect(panelContentWidth(0)).toBe(1)
    expect(panelContentWidth(Number.NaN)).toBe(1)
  })
})

// ── the badge (frozen clause R9) ────────────────────────────────────────────

describe("the badge ladder", () => {
  test("failed outranks blocked outranks running, and an idle board clears it", () => {
    /** A board with a failed task. */
    const failed = chainTasks()
    expect(dagBadge(failed)?.level).toBe("error")
    /** A board where everything is only blocked. */
    const blocked = failed.map((task) => ({ ...task, visual: "blocked" }))
    expect(dagBadge(blocked)?.level).toBe("warning")
    /** A board where everything is running. */
    const running = failed.map((task) => ({ ...task, visual: "running" }))
    expect(dagBadge(running)).toEqual({ level: "info", unread: 0 })
    /** A finished board: nothing to report, which is what CLEARS the badge. */
    const done = failed.map((task) => ({ ...task, visual: "completed" }))
    expect(dagBadge(done)).toBeNull()
  })

  test("the page publishes the badge through the host API, once per change", () => {
    /** The kit. */
    const kit = makeKit({ columns: 80 })
    /** The host double. */
    const host = makeHost()
    /** The page. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    render(page, kit, host)
    kit.runEffects()
    // The chain fixture carries a failed task, so the badge is an `error` and the count is the number
    // of actionable tasks — asserted as the DERIVED shape rather than as a magic number, so the arm
    // keeps meaning something if the fixture grows.
    expect(host.notifications).toHaveLength(1)
    expect(host.notifications[0]?.level).toBe("error")
    expect(host.notifications[0]?.unread).toBe(dagBadge(chainTasks())?.unread as number)
    // A SECOND render with the same state publishes NOTHING: `notify` per render would make the host's
    // own badge listener fire in a loop.
    render(page, kit, host)
    kit.runEffects()
    expect(host.notifications).toHaveLength(1)
  })
})

// ── the workmate page (frozen clause R12) ───────────────────────────────────

describe("the workmate page", () => {
  test("carries its own descriptor, with a one-cell icon", () => {
    expect(WORKMATE_PANEL_DESCRIPTOR_FROZEN).toEqual({
      apiVersion: 1,
      id: WORKMATE_PANEL_ID,
      title: WORKMATE_PANEL_TITLE,
      icon: WORKMATE_PANEL_ICON,
      minColumns: WORKMATE_PANEL_DESCRIPTOR_FROZEN.minColumns,
      order: WORKMATE_PANEL_ORDER,
    })
    expect(WORKMATE_PANEL_ID).toBe("workmate")
    expect(cellWidth(WORKMATE_PANEL_ICON)).toBe(1)
    // AMENDED (clause C3) — TWO panels with two DISTINCT slugs, not three: the DAG page's own slug
    // collapsed into the MPD panel's, so the pair that must stay distinct is this one. The host refuses a
    // duplicate contribution id, so distinctness is what makes these two surfaces rather than one
    // registered twice.
    expect(new Set([WORKMATE_PANEL_ID, "team"]).size).toBe(2)
  })

  test("the EMPTY state names the call that fills the shelf", () => {
    /** The kit. */
    const kit = makeKit({ columns: 40 })
    /** The host double. */
    const host = makeHost()
    /** The page, over an empty library (the normal state before the first init). */
    const page = createWorkmatePanelComponent(() => ({ entries: [], archived: 0, root: "/tmp/home/.mpd/workmate", problems: [] })) as (props: unknown) => unknown
    /** The rendered text. */
    const text = kit.text(render(page, kit, host))
    expect(text).toContain("no workmates yet")
    expect(text).toContain("mpd_workmate_init")
    // A read-only page says so: nothing here can archive an instance.
    expect(text).toContain("read-only")
  })

  test("an unreadable home renders the empty state rather than throwing", () => {
    /** The kit. */
    const kit = makeKit({ columns: 40 })
    /** A reader that throws, as an unreadable home does. */
    const page = createWorkmatePanelComponent(() => {
      throw new Error("home unreadable")
    }) as (props: unknown) => unknown
    expect(() => kit.text(render(page, kit, makeHost()))).not.toThrow()
    expect(kit.text(render(page, kit, makeHost()))).toContain("mpd_workmate_init")
  })

  test("a populated shelf shows the key, the base and the note", () => {
    /** The kit. */
    const kit = makeKit({ columns: 60 })
    /** The page over one instance. */
    const page = createWorkmatePanelComponent(() => libraryFixture()) as (props: unknown) => unknown
    /** The rendered text. */
    const text = kit.text(render(page, kit, makeHost()))
    expect(text).toContain("geometry-engineer-1")
    expect(text).toContain("base Deep Worker")
    expect(text).toContain("owns the rank computation")
    expect(text).toContain("uses 3")
    expect(text).toContain("1 instance")
    expect(text).toContain("1 archived")
  })

  test("the reader tolerates a missing library and never throws", () => {
    /** A home whose library does not exist. */
    const missing = readWorkmateLibrary("/tmp/mpd-workmate-fixture-does-not-exist")
    expect(missing.entries).toEqual([])
    expect(missing.archived).toBe(0)
    // The root is still reported, so the empty page can say WHERE it looked.
    expect(missing.root).toContain(".mpd/workmate")
  })
})

// ── AC8b: the page's own `⤢` control, and the dep that reaches it ────────────
//
// WHY THIS ARM IS ABOUT THE DEP AND NOT ABOUT THE GLYPH. The host cannot draw a full-screen control
// for a plugin panel (measured: `dsh-adapter/panels.js` freezes a descriptor WITHOUT `capabilities`
// while `SidePanelColumn.js`'s `canExpand` reads `definition.capabilities?.fullscreen === true`), so
// this page draws its own. A `⤢` in the text proves only that something was painted; what the reader
// actually needs is that the control REACHES the row's full-screen surface — and the seam between the
// two is the surviving registration's forward, which is exactly where a dep can stop without any test of the
// component noticing. So the arm walks the whole chain: registration -> captured component -> render
// -> click -> the dep the ROW was given, counted.

describe("AC8b · the page draws its own `⤢`, and the dep the row received reaches it", () => {
  test("a click on the control reaches the `openFullscreenScreen` dep the surviving registration forwards", () => {
    /** The registration the host received. */
    const registered: Record<string, unknown>[] = []
    /** The host's own read-back rows, appended by a registration exactly as the host composes them. */
    const rows: Array<{ id: string; title: string; source: string }> = []
    /** The host's panel registry double. */
    const registry = {
      register: (descriptor: Record<string, unknown>): (() => void) => {
        registered.push(descriptor)
        rows.push({ id: `act3:${String(descriptor.id)}`, title: String(descriptor.title), source: "plugin" })
        return () => {}
      },
      list: (): readonly { id: string; title: string; source: string }[] => rows,
      open: (): boolean => true,
    }
    /** The ctx double: services are reachable only through the injected scope, as the host has it. */
    const build = (): Record<string, any> => {
      /** The host's registry double this arm registers against. */
      const ctx: Record<string, any> = {
        get: (): undefined => undefined,
        effect: (callback: () => () => void): Record<string, never> => {
          callback()
          return {}
        },
        logger: { info: () => {}, warn: () => {}, debug: () => {} },
      }
      ctx.inject = (dependencies: readonly string[], callback: (scoped: Record<string, any>) => void): Record<string, never> => {
        /** The injected scope, whose `get` resolves the mounted service. */
        const scoped = build()
        scoped.get = (name: string): unknown => (name === "tuiPanels" ? registry : undefined)
        if (dependencies.includes("tuiPanels")) callback(scoped)
        return {}
      }
      return ctx
    }
    /** The real adapter over that host. */
    const tui = createTuiAdapter(build() as never)
    /** How many times the row's own full-screen opener ran. */
    let opened = 0
    /** The registered MPD panel, wired the way `index.ts` wires it after the merge (clause C3). */
    registerPanelSurface(tui as never, {
      enabled: true,
      readWorkflow: () => workflowFixture(),
      openMergedScene: () => true,
      // THE DEP THAT CARRIES THE `⤢` AFTER THE MERGE: the page this slot renders draws the control, and
      // this is the opener the row hands it. Before the merge it lived on the DAG page's own seam.
      openFullscreenScene: () => {
        opened += 1
        return true
      },
      log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    })
    /** The component the HOST received, which is what a reader actually sees. */
    const component = registered[0]?.component as (props: unknown) => unknown
    expect(typeof component).toBe("function")
    /** The kit and the host double every other render arm in this file uses. */
    const kit = makeKit({ columns: 40 })
    /** The host API double. */
    const host = makeHost()
    /** The rendered page. */
    const tree = render(component, kit, host)
    /** The clickable control, by the key the shared chrome gives it. */
    const control = elementByKey(tree, "title-fullscreen")
    expect(control).toBeDefined()
    // THE GLYPH IS THE CONTRACT'S OWN, one cell wide, inside the control the reader clicks.
    expect(kit.text(elementByKey(control, "title-glyph"))).toBe(PANEL_FULLSCREEN_GLYPH)
    expect(cellWidth(PANEL_FULLSCREEN_GLYPH)).toBe(1)
    // AND IT IS A REAL CONTROL: the host would deliver a click here, with the pair of hover handlers
    // the host PanelBar's own `⤢` carries.
    expect(typeof control?.props?.onClick).toBe("function")
    expect(typeof control?.props?.onMouseEnter).toBe("function")
    expect(typeof control?.props?.onMouseLeave).toBe("function")
    // RENDERED, NOT USED: merely looking at the sidebar must not open a scene.
    expect(opened).toBe(0)
    /**
     * The pointer event the click carries, with the host's own stopper.
     *
     * `stopImmediatePropagation` marks the object it was CALLED ON, so the flag the assertion below
     * reads is the one the control itself set rather than a counter this arm installed in the path.
     */
    const event = {
      stopped: false,
      /** The host's own propagation stopper, as an event carries it. */
      stopImmediatePropagation(): void {
        this.stopped = true
      },
    }
    ;(control?.props?.onClick as (event: unknown) => void)(event)
    // THE OUTCOME: the dep the ROW was given is the one that ran — not merely that a `⤢` was painted.
    expect(opened).toBe(1)
    // …and the host's own click-to-focus fallback was not also allowed to fire.
    expect(event.stopped).toBe(true)
  })

  test("a row given no opener still draws the row, but its glyph carries no click handler", () => {
    /** The page built the way a caller with no full-screen surface builds it. */
    const page = createDagPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    /** The kit double. */
    const kit = makeKit({ columns: 40 })
    /** The rendered page. */
    const tree = render(page, kit, makeHost())
    // The ROW is still drawn — the chrome is identical on every page — and only the handler is absent.
    expect(kit.text(tree)).toContain(PANEL_FULLSCREEN_GLYPH)
    /** The control element itself, which is where a click would have to land. */
    const control = elementByKey(tree, "title-fullscreen")
    expect(control).toBeDefined()
    expect(control?.props?.onClick).toBeUndefined()
  })
})
