// THE SHARED VISUAL SYSTEM, asserted on the surfaces that DRAW it.
//
// WHY THIS FILE EXISTS. Every scene, both text seams and the sidebar pages are supposed to be ONE
// visual system: the same tone table, the same chrome markers, the same border vocabulary, one legend.
// "Supposed to" is not a property a reviewer can read off four files, so the SHARED properties are
// pinned here and nowhere else:
//   · every colour a surface draws is a VALUE of the frozen contract's table (`dag-theme.ts`), so no
//     surface can invent a colour the palette does not carry — a private literal is the failure this
//     asserts against, not a difference of taste;
//   · every row a surface LAYS OUT (a drawing row, a legend line, the frame's border title) fits the
//     viewport it measured, and a CJK fixture does not shear that layout — asserted as "a boxed row
//     ENDS ON ITS BORDER COLUMN", because a length assertion alone cannot catch a cursor that advances
//     one SLOT per wide glyph (the defect class `visual-reviewer` measured in the shared drawing path);
//   · a host with no timer draws the STATIC frame, and one with a timer draws the phase it reports.
//
// WHAT THIS FILE DOES NOT ASSERT. The drawing engine's own geometry (`graph.ts`, dag-geometry), the WEB
// parity tables (`dag-fidelity.test.ts`, fidelity-verifier) and the panel pages (`panel-dag.test.ts`,
// panel-surface) are other lanes' contracts. This file asserts the SURFACES' consumption of the shared
// system — including the merged panel, which no other suite mounts over a real record.
//
// A PROSE ROW IS NOT A LAYOUT ROW. `boardLines`/`teamWorkflowLines`/`planProjectionLines` hand over
// sentences the HOST wraps at the row's width; asserting a cell budget on those would be asserting the
// terminal's job, not the scene's. The rows this file measures are the ones whose cells the SCENE
// computed: the DAG's own rows, the legend lines drawn under them, and the frame's border title.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index"
import { BOARD_SCENE_ID, PLAN_SCENE_ID, TEAM_SCENE_ID, registerScene } from "../src/scenes"
import {
  RUNNING_FRAMES,
  SUBAGENT_SCENE_ID,
  animPhase,
  barCells,
  chromeTitle,
  createSubagentSceneComponent,
  dominantTone,
  labelSplit,
  rowLabel,
  runningMarker,
  stateMarker,
  surfaceBodyRow,
  toneOfStatus,
  toneOfTally,
  type SubagentRowView,
  type SurfaceKit,
} from "../src/subagent-scene"
import { DAG_ANIM, DAG_CHARS, DAG_CHROME, DAG_STATE_TONES, DAG_TONE_GLYPH, DAG_TONE_THEME, type DagTone } from "../src/dag-theme"
import { GRAPH_THEME, layoutGraphNatural, legendLines } from "../src/graph"
import { legendLinesFor } from "../src/panel-core"
import { cellWidth } from "../src/sanitize"
import { readBoardState, statusLine } from "../src/state"
import { STATUS_MAX_CELLS, statusMarker, statusVisualLine } from "../src/status"
import { readRecordWorkflow } from "../src/team-state"

// ── the host double ─────────────────────────────────────────────────────────

/** One created element, as the double records it. */
interface Element {
  /** The component or tag the element was created with. */
  type: unknown
  /** The props the scene passed. */
  props: Record<string, unknown>
  /** The children, exactly as `createElement` received them. */
  children: unknown[]
}

/** The host kit double: index-keyed hooks, effects and a row-aware flattening. */
interface Kit {
  /** The React instance the scene must use. */
  React: Record<string, unknown>
  /** The ui kit the scene must use. */
  ui: Record<string, unknown>
  /** Resets the hook index for the next render pass. */
  begin(): void
  /** Drops every hook cell, for an arm that hands this kit a DIFFERENT component next. */
  reset(): void
  /** Runs the effects the last render queued; true when any ran. */
  flush(): boolean
  /** Flattens a rendered tree into one string per drawn row. */
  rows(tree: unknown): string[]
  /** The last tree `rows` flattened. */
  last(): unknown
}

/** The timer a kit exposes: the scene kit's frame pair, the panel kit's time, or none at all. */
type Timer = "frame" | "time" | "none"

/**
 * A minimal host kit double.
 *
 * `useAnimationFrame` and `useAnimationTime` are OPTIONAL here for the same reason they are optional on
 * a real host: the degradation arm has to be able to hand a scene a kit with NO timer at all.
 * @param options - the measured terminal, the clock the timer answers and which timer the kit exposes.
 * @returns the kit.
 */
function makeKit(options: { columns?: number; rows?: number; clock?: number; timer?: Timer } = {}): Kit {
  /** Hook state and effects, keyed by hook position. */
  const store = new Map<string, unknown>()
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

  /** The Text component: a marker type the flattening recognises. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [] })
  /** The Box component: a marker type the flattening treats as a column. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [] })
  /** The ui kit: a fixed measurement, a no-op key hook and the timer this arm asked for. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    useInput: (): void => {},
    useTerminalSize: (): { columns: number; rows: number } => ({ columns: options.columns ?? 100, rows: options.rows ?? 30 }),
  }
  /** The clock a surface reading this kit sees, exactly as a host would answer it. */
  const clockValue = (): number => options.clock ?? 0
  if (options.timer === "frame") ui.useAnimationFrame = (): unknown => [undefined, clockValue()]
  if (options.timer === "time") ui.useAnimationTime = (): number => clockValue()

  return {
    React,
    ui,
    begin: (): void => {
      index = 0
    },
    reset: (): void => {
      // The host draws ONE scene at a time, so the double's hook cells are per COMPONENT and not per
      // process: without this, the board's `state:0` (a rows object) would be read back as the team
      // scene's projection, and the arm would measure that instead of a real render.
      store.clear()
      pending = []
      lastTree = undefined
      index = 0
    },
    flush: (): boolean => {
      /** The effects queued for this flush. */
      const list = pending
      pending = []
      for (const fn of list) fn()
      return list.length > 0
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
      /** Walk the tree one ROW at a time: a Box is a column, so each of its children is a row. */
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
          // A Text IS a drawn row; its spans join with nothing between them.
          out.push(inline(node))
          return
        }
        // Anything else is a CONTAINER (the scenes' Box, or an element created with a tag): a Box is a
        // column, so each of its children is the next row.
        for (const child of element.children ?? []) walk(child)
      }
      walk(tree)
      return out
    },
    last: (): unknown => lastTree,
  }
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
 * One drawn element by its React key.
 * @param tree - the tree to search.
 * @param key - the key to look for.
 * @returns the first element carrying it, or undefined.
 */
function elementByKey(tree: unknown, key: string): Element | undefined {
  /** The element found, when the walk reaches it. */
  let found: Element | undefined
  walkElements(tree, (element) => {
    if (found === undefined && element.props?.key === key) found = element
  })
  return found
}

/**
 * The React keys of one rendered tree, in draw order.
 * @param tree - the tree to walk.
 * @returns every string key, in the order the elements were drawn.
 */
function drawnKeys(tree: unknown): string[] {
  /** The keys seen. */
  const keys: string[] = []
  walkElements(tree, (element) => {
    if (typeof element.props?.key === "string") keys.push(element.props.key)
  })
  return keys
}

/**
 * The React keys of one rendered tree that match a pattern, in draw order.
 * @param tree - the tree to walk.
 * @param pattern - the key pattern to keep.
 * @returns the matching keys.
 */
function matchingKeys(tree: unknown, pattern: RegExp): string[] {
  return drawnKeys(tree).filter((key) => pattern.test(key))
}

/**
 * Every colour a rendered tree draws with, border colours included.
 * @param tree - the tree to walk.
 * @returns the colour values, in draw order.
 */
function drawnColors(tree: unknown): string[] {
  /** The colours seen. */
  const colors: string[] = []
  walkElements(tree, (element) => {
    if (typeof element.props?.color === "string") colors.push(element.props.color)
    if (typeof element.props?.borderColor === "string") colors.push(element.props.borderColor)
  })
  return colors
}

/**
 * The row text of one drawn element, its spans joined.
 * @param element - the drawn element.
 * @returns the characters the element draws.
 */
function rowText(element: Element): string {
  /** Every character inside the element. */
  const inline = (node: unknown): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") return node
    if (typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(inline).join("")
    /** This node as an element. */
    const el = node as Element
    return inline(el.props?.children) + inline(el.children ?? [])
  }
  return inline(element)
}

/** The pattern that matches ONE drawn row of the dependency drawing, on either surface. */
const GRAPH_ROW_KEY = /^(g\d+|graph-\d+)$/u

/** The pattern that matches the drawing's own legend lines, which it keys `legend-<i>`. */
const LEGEND_ROW_KEY = /^legend-\d+$/u

/** The pattern that matches the CONTRACT's appended state key, which this surface keys `state-key-<i>`. */
const STATE_KEY_ROW_KEY = /^state-key-\d+$/u

/**
 * Every drawn element whose key marks a LAYOUT row — a row whose cells the scene computed.
 *
 * The team scene keys its drawing rows `g<i>` and the merged panel keys its own `graph-<i>`; both are the
 * same drawing, so both are matched. The legend's two groups carry their two owners' keys.
 * @param tree - the tree to walk.
 * @returns the layout elements, in draw order.
 */
function layoutRows(tree: unknown): Element[] {
  /** The matched elements. */
  const rows: Element[] = []
  walkElements(tree, (element) => {
    /** This element's React key, when it carries one. */
    const key = element.props?.key
    if (typeof key !== "string") return
    if (GRAPH_ROW_KEY.test(key) || LEGEND_ROW_KEY.test(key) || STATE_KEY_ROW_KEY.test(key)) rows.push(element)
  })
  return rows
}

/**
 * The DAG rows of one render, as text, in draw order.
 * @param tree - the tree to walk.
 * @returns the drawing's rows.
 */
function graphRows(tree: unknown): string[] {
  /** The drawing's elements, in draw order. */
  const rows: Element[] = []
  walkElements(tree, (element) => {
    /** This element's React key, when it carries one. */
    const key = element.props?.key
    if (typeof key === "string" && GRAPH_ROW_KEY.test(key)) rows.push(element)
  })
  return rows.map((row) => rowText(row))
}

// ── the scenes, mounted from IN-MEMORY records ──────────────────────────────

/** One task on the fixture board, as a record carries it. */
interface FixtureTask {
  /** The task id the drawing labels. */
  id: string
  /** The subject a node prints. */
  subject: string
  /** The official status the record stores. */
  status: string
  /** The task kind, abbreviated on a node label. */
  kind?: string
  /** The owner's display name. */
  owner?: string
  /** The ids this task is blocked by. */
  blockedBy?: string[]
}

/**
 * A team record shaped exactly as `.mpd/team/teams/<id>.json` holds one.
 * @param tasks - the board.
 * @param overrides - the head fields this arm wants to differ.
 * @returns the record.
 */
function fixtureRecord(tasks: readonly FixtureTask[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    teamId: "team-20261007120000",
    name: "wave-visuals",
    description: "the visual wave",
    leadSessionId: "lead-session-1",
    phase: "running",
    createdAt: "2026-10-07T12:00:00.000Z",
    members: [
      { id: "M1", name: "Architect", description: "design", role: "design", status: "running", spawnedAt: "2026-10-07T12:00:01.000Z" },
      { id: "M2", name: "Senior Engineer", description: "build", status: "idle", spawnedAt: "2026-10-07T12:00:02.000Z" },
    ],
    // EVERY field the projection reads is present: `readRecordWorkflow` trusts the record (it maps
    // `task.blockedBy` without a guard), so a fixture that omitted the field would render the scene's
    // "unreadable" branch and every assertion below would be measuring that instead.
    tasks: tasks.map((task) => ({ blockedBy: [], ...task })),
    nextMemberNumber: 3,
    nextTaskNumber: tasks.length + 1,
    ...overrides,
  }
}

/** The scene components one mount produced, with the workspace they read. */
interface Mounted {
  /** The registered components, by id. */
  components: Record<string, unknown>
  /** The kit to render them with. */
  kit: Kit
  /** The throwaway workspace the scenes resolve their state from. */
  workspace: string
}

/**
 * Mount the three full-screen scenes over an in-memory record.
 * @param record - the team record the workspace holds, or undefined for an empty workspace.
 * @param options - the measured terminal, the clock and which timer the kit exposes.
 * @returns the components, the kit and the workspace.
 */
function mountScenes(
  record: Record<string, unknown> | undefined,
  options: { columns?: number; rows?: number; timer?: Timer; clock?: number } = {},
): Mounted {
  /** A throwaway workspace: the projection reads plans/boulder/workmates from it and finds none. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-visuals-"))
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
    record === undefined ? () => [] : () => [record as never],
  )
  return { components, kit: makeKit(options), workspace }
}

/**
 * Render a scene component until its effects settle.
 * @param kit - the host kit.
 * @param component - the scene component.
 * @param channel - the channel the host would pass, when an arm wants one.
 * @returns the drawn rows.
 */
function render(kit: Kit, component: unknown, channel?: unknown): string[] {
  /** The props a host passes to a scene. */
  const props = { React: kit.React, ui: kit.ui, close: () => {}, channel }
  /** The last rendered tree. */
  let tree: unknown
  for (let pass = 0; pass < 5; pass += 1) {
    kit.begin()
    tree = (component as (props: unknown) => unknown)(props)
    if (!kit.flush()) break
  }
  return kit.rows(tree)
}

// ── ONE table: every colour a surface draws is the contract's ───────────────

describe("every surface draws the frozen contract's colours", () => {
  test("the drawing engine's table and the contract's table agree tone for tone", () => {
    // `graph.ts` paints the DAG's own spans and `dag-theme.ts` is what the panels and the scenes read;
    // clause R14 holds only while the two are the SAME table, so this arm turns a divergence into a red
    // test rather than into a colour that quietly differs between two surfaces.
    /** The contract's tones, as the union's runtime form. */
    const tones = Object.keys(DAG_TONE_THEME) as DagTone[]
    expect(tones).toHaveLength(11)
    for (const tone of tones) expect(GRAPH_THEME[tone]).toBe(DAG_TONE_THEME[tone])
  })

  test("the board, the team, the plan and the merged scene draw only contract colours", () => {
    /** The fixture board: a completed, a running and a pending task, one CJK subject among them. */
    const record = fixtureRecord([
      { id: "t1", subject: "冻结验收契约", status: "completed", kind: "requirement" },
      { id: "t2", subject: "build the scenes", status: "in_progress", kind: "work", owner: "Senior Engineer", blockedBy: ["t1"] },
      { id: "t3", subject: "review it", status: "pending", kind: "review", blockedBy: ["t2"] },
    ])
    /** The contract's own palette: every key a surface may draw with. */
    const palette = new Set<string>(Object.values(DAG_TONE_THEME))
    /** Every colour every surface drew, with the surface that drew it. */
    const drawn: Array<{ scene: string; color: string }> = []
    for (const timer of ["frame", "none"] as const) {
      /** This arm's mount. */
      const { components, kit, workspace } = mountScenes(record, { timer })
      for (const id of [BOARD_SCENE_ID, TEAM_SCENE_ID, PLAN_SCENE_ID]) {
        kit.reset()
        render(kit, components[id])
        for (const color of drawnColors(kit.last())) drawn.push({ scene: id, color })
      }
      // The merged panel rides the same system through its own factory, over the SAME projection.
      /** The merged panel, reading the record through the real projection. */
      const merged = createSubagentSceneComponent(() => readRecordWorkflow(workspace, [], record as never))
      kit.reset()
      render(kit, merged, { subagents: [{ agentId: "a1", description: "lane", status: "running", mode: "continuable" }] })
      for (const color of drawnColors(kit.last())) drawn.push({ scene: SUBAGENT_SCENE_ID, color })
    }
    expect(drawn.length).toBeGreaterThan(0)
    for (const entry of drawn) expect(palette.has(entry.color)).toBe(true)
  })

  test("no surface module spells a colour of its own", async () => {
    // The strongest form of the rule is a SOURCE scan: a colour literal reaching `ui.Text` without the
    // contract is exactly what "a scene must not invent a colour the palette does not carry" forbids, and
    // a rendered-tree assertion cannot see a branch this fixture never takes.
    for (const file of ["scenes.ts", "subagent-scene.ts", "status.ts", "renderers.ts"]) {
      /** The module's source. */
      const source = await Bun.file(join(import.meta.dir, "..", "src", file)).text()
      expect(source).not.toMatch(/color:\s*["']/u)
    }
  })
})

// ── the viewport ────────────────────────────────────────────────────────────

describe("every layout row fits the viewport it was laid out for", () => {
  test("the drawing and the legend fit at 100, 60 and 40 columns", () => {
    /** A board with a dependency and a subject long enough to be clamped at the narrow widths. */
    const record = fixtureRecord([
      { id: "t1", subject: "freeze the acceptance contract and publish it", status: "completed", kind: "requirement" },
      { id: "t2", subject: "build it", status: "in_progress", kind: "work", blockedBy: ["t1"] },
    ])
    for (const columns of [100, 60, 40]) {
      /** This width's mount. */
      const { components, kit } = mountScenes(record, { columns, timer: "none" })
      render(kit, components[TEAM_SCENE_ID])
      /** This render's layout rows. */
      const rows = layoutRows(kit.last())
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(cellWidth(rowText(row))).toBeLessThanOrEqual(columns)
    }
  })

  test("the frame carries a border TITLE the host can actually render", () => {
    // The host embeds a border title only when it is the `{content, position, align}` OBJECT its own
    // `borderText` contract declares (`ink/render-border.js` reads `style.borderText.position` and
    // `.content`): a bare string is silently ignored, which is a frame that looks like it lost its title.
    /** This arm's mount. */
    const { components, kit } = mountScenes(fixtureRecord([{ id: "t1", subject: "x", status: "completed" }]), { columns: 100, timer: "none" })
    for (const id of [BOARD_SCENE_ID, TEAM_SCENE_ID, PLAN_SCENE_ID]) {
      kit.reset()
      render(kit, components[id])
      /** This scene's frame. */
      const frame = elementByKey(kit.last(), "frame")
      /** The border text options the frame passed. */
      const borderText = frame?.props?.borderText as { content?: unknown; position?: unknown; align?: unknown } | undefined
      expect(typeof borderText).toBe("object")
      expect(typeof borderText?.content).toBe("string")
      expect(borderText?.position).toBe("top")
      expect(borderText?.align).toBe("start")
      // And the border vocabulary is the contract's, never a literal per scene.
      expect(frame?.props?.borderStyle).toBe(DAG_CHROME.frameBorder)
      /** The frame's border colour, as the key the contract declares. */
      const borderColor = String(frame?.props?.borderColor ?? "")
      expect(Object.values(DAG_TONE_THEME).map((key) => String(key))).toContain(borderColor)
      // The title is clamped by CELL before the host measures it: the frame's corners and padding are
      // not the title's cells.
      expect(cellWidth(String(borderText?.content ?? ""))).toBeLessThanOrEqual(94)
    }
  })

  test("the DAG a scene draws never exceeds the width it was laid out for", () => {
    /** A wide board: four parallel roots, so the drawing is as wide as the geometry can make it. */
    const record = fixtureRecord([
      { id: "t1", subject: "one", status: "completed" },
      { id: "t2", subject: "two", status: "completed" },
      { id: "t3", subject: "three", status: "pending" },
      { id: "t4", subject: "four", status: "pending" },
    ])
    for (const columns of [100, 60, 40]) {
      /** This width's mount. */
      const { components, kit, workspace } = mountScenes(record, { columns, timer: "none" })
      /** The merged panel over the same record, which lays its drawing out for the same measurement. */
      const merged = createSubagentSceneComponent(() => readRecordWorkflow(workspace, [], record as never))
      for (const component of [components[TEAM_SCENE_ID], merged]) {
        kit.reset()
        render(kit, component, { subagents: [] })
        /** This render's drawing rows. */
        const rows = graphRows(kit.last())
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      }
    }
  })
})

// ── CJK: a boxed row ends on its border column ──────────────────────────────

describe("a CJK fixture does not shear the layout", () => {
  test("every boxed node row ENDS ON ITS BORDER COLUMN, wide glyphs included", () => {
    // THE ASSERTION THE REVIEWER ASKED FOR, and the reason a length check alone cannot replace it: a
    // cursor that advances one SLOT per wide glyph leaves the right border UNWRITTEN. The row is then not
    // too long — it is missing its border, and only "the last cell IS the border column" catches that.
    //
    // IT IS ASSERTED ON THE DRAWING, NOT ON THE WINDOWED SCENE ROW (re-pointed for clauses T1/T2): under
    // natural width the viewport may CUT a row before its right border, so a scene row legitimately ends
    // on whatever cell the window reached. The shear this arm exists to catch is a property of the
    // drawing, so it is read from the layout itself — and the windowed rows get their own invariant in
    // the second half, which is that the window is EXACTLY the viewport.
    /** A board whose subjects are entirely wide characters. */
    const record = fixtureRecord([
      { id: "T1", subject: "冻结验收契约", status: "completed", kind: "requirement" },
      { id: "T2", subject: "构建插件表面", status: "in_progress", kind: "work", blockedBy: ["T1"] },
    ])
    for (const columns of [120, 80, 48, 32]) {
      /** This width's mount. */
      const { components, kit } = mountScenes(record, { columns, timer: "none" })
      render(kit, components[TEAM_SCENE_ID])
      /** The drawing as the SCENE windowed it: every row is the viewport's own width. */
      const drawn = graphRows(kit.last())
      for (const row of drawn) expect(cellWidth(row)).toBeLessThanOrEqual(columns)
      // THE DRAWING ITSELF, read from the layout, where the borders are still closed. The board is the
      // SAME one the scene drew, in the drawing's own vocabulary — built here rather than read back out
      // of the record, whose `blockedBy` is the STORE's field name and not the layout's.
      /** The two wide-subject tasks, as the drawing sees them: `T2` depends on `T1`. */
      const tasks = [
        { id: "T1", subject: "冻结验收契约", kind: "requirement", visual: "completed", dependencies: [] as string[], depth: 0 },
        { id: "T2", subject: "构建插件表面", kind: "work", visual: "open", dependencies: ["T1"], depth: 1 },
      ]
      /** The boxed drawing. */
      const view = layoutGraphNatural(tasks)
      if (view === undefined) continue
      /** The drawing as text, one string per line. */
      const lines = view.lines.map((row) => row.map((span) => span.text).join(""))
      /** The rows that are a boxed line: they must close at both ends. */
      const boxed = lines.filter((row) => [DAG_CHARS.cornerDownRight, DAG_CHARS.cornerUpRight, DAG_CHARS.vertical].some((mark) => row.startsWith(mark)))
      expect(boxed.length).toBeGreaterThan(0)
      for (const row of boxed) {
        /** The row's final character. */
        const last = [...row].at(-1)
        if (row.startsWith(DAG_CHARS.cornerDownRight) || row.startsWith(DAG_CHARS.cornerUpRight)) {
          // A box's top or bottom border closes on its own corner.
          expect(([DAG_CHARS.cornerDownLeft, DAG_CHARS.cornerUpLeft] as readonly string[]).includes(String(last))).toBe(true)
        } else if (row.startsWith(DAG_CHARS.vertical)) {
          // A body row closes on ITS OWN right border — the cell a sheared cursor leaves blank. A row cut
          // by the WINDOW is excluded by this same test: the window pads with spaces, never with a `│`.
          expect(last).toBe(DAG_CHARS.vertical)
        }
        expect(cellWidth(row)).toBeLessThanOrEqual(view.width)
      }
    }
  })

  test("a wide-glyph label survives the clamps the scene applies", () => {
    // The scene clamps what IT lays out (the border title, the legend, the hints); a wide glyph must
    // survive that clamp whole, and the CJK text must still read.
    /** A board with a CJK subject, under a CJK team name. */
    const record = fixtureRecord([{ id: "t1", subject: "冻结验收契约", status: "in_progress", kind: "work" }], { name: "视觉波次" })
    /** This arm's mount. */
    const { components, kit } = mountScenes(record, { columns: 60, timer: "none" })
    /** The team scene's rows. */
    const rows = render(kit, components[TEAM_SCENE_ID])
    // THE DRAWING NO LONGER CARRIES THE CJK SUBJECT, AND THAT IS THE WAVE'S CONTRACT (clauses C1/C4):
    // the node's label is the graph-safe form of the subject, so a pure-CJK subject draws its composer's
    // fallback instead. What this arm proves is the part that outlives the rule — the WIDE-GLYPH clamp:
    // the CJK still reads in the CHROME, where the panel's own text is allowed (clause C3), and it
    // survives the scene's clamps whole rather than shearing.
    expect(rows.join("\n")).not.toContain("冻结验收契约")
    /** The DAG's own rows as one string, which is the drawing the CJK ban is asserted over. */
    const drawn = graphRows(kit.last()).join("\n")
    expect(drawn).not.toContain("冻结验收契约")
    for (const row of layoutRows(kit.last())) expect(cellWidth(rowText(row))).toBeLessThanOrEqual(60)
    /** The border title, which carries the CJK team name. */
    const title = String((elementByKey(kit.last(), "frame")?.props?.borderText as { content?: string } | undefined)?.content ?? "")
    expect(title).toContain("视觉波次")
    expect(cellWidth(title)).toBeLessThanOrEqual(54)
  })

  test("a hostile team name cannot reach a border title unclamped", () => {
    // `borderText` is drawn by the HOST's border renderer, which does not sanitize: what the scene hands
    // it lands in the frame's cells, so the scene's own boundary is what has to have stripped it.
    /** A record whose name carries an escape sequence and a control character. */
    const record = fixtureRecord([{ id: "t1", subject: "x", status: "pending" }], { name: "\u001b[31mRED\u0007" })
    /** This arm's mount. */
    const { components, kit } = mountScenes(record, { timer: "none" })
    render(kit, components[TEAM_SCENE_ID])
    /** The title the frame passed to the host. */
    const title = String((elementByKey(kit.last(), "frame")?.props?.borderText as { content?: string } | undefined)?.content ?? "")
    expect(title).not.toContain("\u001b")
    expect(title).not.toContain("\u0007")
  })
})

// ── the animation, and its degradation ──────────────────────────────────────

describe("the running mark breathes on a timer and freezes without one", () => {
  /** One in-flight task, so every arm below has something to animate. */
  const running = (): Record<string, unknown> => fixtureRecord([{ id: "t1", subject: "work", status: "in_progress", kind: "work" }])

  test("a host with NO timer draws the STATIC frame", () => {
    /** This arm's mount: no timer at all. */
    const { components, kit } = mountScenes(running(), { timer: "none" })
    /** The team scene's title row. */
    const title = render(kit, components[TEAM_SCENE_ID]).find((row) => row.includes("MPD team"))
    expect(title).toBeDefined()
    // The static phase IS the contract's running glyph — the frame the legend already explains — so a
    // degraded surface never draws a stalled intermediate the legend does not describe.
    expect(String(title)).toContain(DAG_TONE_GLYPH.running ?? "◐")
    expect(runningMarker(DAG_ANIM.staticPhase)).toBe(DAG_TONE_GLYPH.running ?? "◐")
  })

  test("a host WITH a timer draws the phase its clock reports, and every frame is CELL-STABLE", () => {
    /** The four ticks one breathing cycle is quantised to. */
    const ticks = [0, DAG_ANIM.intervalMs, 2 * DAG_ANIM.intervalMs, 3 * DAG_ANIM.intervalMs]
    /** The mark each tick drew, read as the first cell of the title row. */
    const marks = ticks.map((tick) => {
      /** This tick's own mount: the scene kit's `useAnimationFrame` pair, answering that clock. */
      const { components, kit } = mountScenes(running(), { timer: "frame", clock: tick })
      /** This render's title row. */
      const title = render(kit, components[TEAM_SCENE_ID]).find((row) => row.includes("MPD team"))
      /** The mark the row opens with. */
      const mark = (title ?? "").slice(0, 1)
      // EVERY FRAME IS ONE CELL WIDE: a breathing mark that changed the row's width would shift the whole
      // title twice a second, which is the layout shear this wave exists to remove.
      expect(cellWidth(mark)).toBe(1)
      return mark
    })
    expect(marks).toEqual([...RUNNING_FRAMES])
    expect(new Set(marks).size).toBeGreaterThan(1)
  })

  test("a NON-FINITE clock degrades to the static frame instead of throwing", () => {
    // A host that answers `NaN` is a host with no usable timer: the phase falls back, and the surface
    // still renders.
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(animPhase(time)).toBe(DAG_ANIM.staticPhase)
    }
    // A NON-FINITE phase has no frame to wrap to and takes the static one; a finite NEGATIVE phase is a
    // clock before zero rather than a missing timer, so it WRAPS instead of pretending to be frozen.
    for (const phase of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(runningMarker(phase)).toBe(RUNNING_FRAMES[DAG_ANIM.staticPhase])
    }
    expect(runningMarker(-1)).toBe(RUNNING_FRAMES[RUNNING_FRAMES.length - 1])
    /** The fixture the merged panel reads, drawn by a kit whose timer answers `NaN`. */
    const record = running()
    /** This arm's mount. */
    const { components, kit, workspace } = mountScenes(record, { timer: "time", clock: Number.NaN })
    /** The merged panel over that record. */
    const merged = createSubagentSceneComponent(() => readRecordWorkflow(workspace, [], record as never))
    /** The rows a NaN clock still produced: a degraded frame, never an exception. */
    const rows = render(kit, merged, { subagents: [] })
    expect(rows.length).toBeGreaterThan(0)
    expect(stateMarker("running", animPhase(Number.NaN))).toBe(DAG_TONE_GLYPH.running ?? "◐")
    kit.reset()
    expect(render(kit, components[TEAM_SCENE_ID]).length).toBeGreaterThan(0)
  })

  test("the mark draws the state's own glyph for every non-running tone", () => {
    for (const tone of DAG_STATE_TONES) {
      expect(stateMarker(tone, 3)).toBe(tone === "running" ? RUNNING_FRAMES[3] : DAG_TONE_GLYPH[tone])
    }
    // A drawing tone has no published state glyph, and `?` is what this contract says to draw for one.
    expect(stateMarker("edge", 0)).toBe("?")
  })
})

// ── the legend, composed by its two owners ──────────────────────────────────

describe("the legend is composed, and it disambiguates the two states that share a glyph", () => {
  test("the drawing's arrow line is forwarded, and the contract's ONE state key follows it", () => {
    /** A board with a dependency, so the drawing has an edge to explain. */
    const record = fixtureRecord([
      { id: "t1", subject: "root", status: "completed" },
      { id: "t2", subject: "leaf", status: "pending", blockedBy: ["t1"] },
    ])
    /** This arm's mount at 100 columns. */
    const { components, kit, workspace } = mountScenes(record, { columns: 100, timer: "none" })
    /** The merged panel over the same record. */
    const merged = createSubagentSceneComponent(() => readRecordWorkflow(workspace, [], record as never))
    // The team scene lays its drawing out for `width - 4`; the merged panel lays its own out for the
    // measured width. Each legend is composed for ITS OWN budget, which keeps it under its own DAG.
    for (const [component, budget] of [[components[TEAM_SCENE_ID], 96], [merged, 100]] as const) {
      kit.reset()
      render(kit, component, { subagents: [] })
      /** The drawing's own line for that budget. */
      const arrow = legendLines(budget)
      /** The composed legend: `legendLinesFor` appends the contract's six-state key. */
      const composed = legendLinesFor(budget, arrow)
      // THE DRAWING CONTRIBUTES EXACTLY ITS OWN LINE — no state key: this module's five-state key was
      // deleted with the redundant legend, so the drawing group is one row at any width with room.
      expect(arrow).toHaveLength(1)
      expect(matchingKeys(kit.last(), LEGEND_ROW_KEY)).toHaveLength(arrow.length)
      // THE STATE KEY IS THE COMPOSER'S ROWS, AND THERE IS ONLY EVER ONE GROUP OF THEM.
      expect(matchingKeys(kit.last(), STATE_KEY_ROW_KEY)).toHaveLength(composed.length - arrow.length)
      expect(composed.length).toBeGreaterThan(arrow.length)
      // THE CONTRACT'S KEY NAMES EVERY STATE EXACTLY ONCE, AND A SHARED MARK'S ENTRY NAMES EVERY
      // CARRIER — the whole reason it exists: `○ blocked` and `○ open` are the same character, so the
      // reader is told that one mark stands for both. The pre-fix key printed that pair twice, under
      // an `=` that claimed the two states are each other.
      /** The contract's own key line, the last line the composer produced. */
      const stateKey = composed.at(-1) ?? ""
      for (const state of DAG_STATE_TONES) {
        /** How many times this key NAMES the state, counted as a whole word so `blocked` != `blocker`. */
        const named = (stateKey.match(new RegExp(`\\b${state}\\b`, "g")) ?? []).length
        expect(`${state} named=${named}`).toBe(`${state} named=1`)
      }
      /** The entries the key opens with the shared mark; one entry must name BOTH of its carriers. */
      const sharedEntries = stateKey.split(" · ").filter((entry) => entry.startsWith(`${DAG_TONE_GLYPH.blocked ?? "?"} `))
      expect(sharedEntries).toHaveLength(1)
      expect(sharedEntries[0] ?? "").toContain("blocked")
      expect(sharedEntries[0] ?? "").toContain("open")
      expect(stateKey).not.toContain("=")
      for (const line of composed) expect(cellWidth(line)).toBeLessThanOrEqual(budget)
    }
  })

  test("the legend sits UNDER its DAG and stays dimmed", () => {
    /** A board with two ranks. */
    const record = fixtureRecord([
      { id: "t1", subject: "root", status: "completed" },
      { id: "t2", subject: "leaf", status: "pending", blockedBy: ["t1"] },
    ])
    /** This arm's mount. */
    const { kit, workspace } = mountScenes(record, { columns: 100, timer: "none" })
    /** The merged panel over the same record. */
    const merged = createSubagentSceneComponent(() => readRecordWorkflow(workspace, [], record as never))
    render(kit, merged, { subagents: [] })
    /** Every drawn key, in draw order. */
    const keys = drawnKeys(kit.last())
    /** Where the drawing ends and the legend begins. */
    const lastGraph = keys.reduce((at, key, index) => (GRAPH_ROW_KEY.test(key) ? index : at), -1)
    /** The draw index of the drawing's first legend line, which must follow the drawing. */
    const firstLegend = keys.findIndex((key) => LEGEND_ROW_KEY.test(key))
    expect(lastGraph).toBeGreaterThan(-1)
    expect(firstLegend).toBeGreaterThan(lastGraph)
    // A legend explains the drawing; it never competes with it. Both groups are dimmed, and the second
    // group is the row group the CONTRACT owns.
    for (const key of ["legend-0", "state-key-0"]) expect(elementByKey(kit.last(), key)?.props?.dimColor).toBe(true)
  })
})

// ── the vocabulary the surfaces share ───────────────────────────────────────

describe("the body-row vocabulary is one table, and a surface never re-words a row", () => {
  test("a label row splits byte-for-byte, and prose is left whole", () => {
    for (const line of ["tasks      3 total · 1 done", "watchdog   HELD (t1)", "team       wave (team-1)", "note       cycle t1,t2", "workspace  /w"]) {
      /** This row's split, when it has one. */
      const split = labelSplit(line)
      expect(split).toBeDefined()
      expect(`${split?.label}${split?.rest}`).toBe(line)
      expect(split?.label.trimEnd()).toBe(rowLabel(line))
    }
    // A nested row and a CJK sentence are NOT label rows: toning them by position would colour a FACT.
    expect(labelSplit("  Architect · design · running")).toBeUndefined()
    expect(labelSplit("当前工作区没有团队")).toBeUndefined()
    expect(labelSplit("")).toBeUndefined()
    expect(rowLabel("t2 [work] subject · pending")).toBeUndefined()
    /** The row vocabulary the shared tone table is keyed on. */
    const labels = ["workspace", "team", "phase", "plan", "captain", "staged", "watchdog", "team-hold", "members", "roster", "tasks", "boulder", "plans", "workmates", "mail", "note", "confirm", "required", "runnable"]
    for (const label of labels) expect(rowLabel(`${label}  value`)).toBe(label)
  })

  test("the label column draws in the label's own tone", () => {
    // The tone table IS the point: a reader learns that `watchdog` is a warning and `team` is the subject
    // of the screen from the colour, on every surface, without reading the words.
    /** A kit to build rows with. */
    const kit = makeKit()
    /** The surface kit the builders take. */
    const surface = { React: kit.React, ui: kit.ui } as unknown as SurfaceKit
    /** A drawn `tasks` row. */
    const row = surfaceBodyRow(surface, "r", "tasks      3 total · 1 done") as Element
    /** The row's label span, which is its first child. */
    const label = (row.children ?? [])[0] as Element
    expect(rowText(label)).toBe("tasks      ")
    expect(label.props?.color).toBe(DAG_TONE_THEME.running)
    /** The value span, which keeps the plain text colour. */
    const value = (row.children ?? [])[1] as Element
    expect(rowText(value)).toBe("3 total · 1 done")
    expect(value.props?.color).toBeUndefined()
    // A row whose tone depends on a VALUE is overridden by its caller, never guessed from its label.
    /** The same row with the tally's own tone. */
    const overridden = surfaceBodyRow(surface, "r2", "tasks      3 total · 3 done", { tasks: "completed" }) as Element
    expect(((overridden.children ?? [])[0] as Element).props?.color).toBe(DAG_TONE_THEME.completed)
    // A nested row is DIMMED rather than toned: it is detail under a heading the surface already toned.
    /** An indented member row. */
    const nested = surfaceBodyRow(surface, "r3", "  Architect · design · running") as Element
    expect(nested.props?.dimColor).toBe(true)
    // And a row is never BOTH toned and dimmed: the host resolves an explicit colour over `dimColor`, so
    // asking for both would silently drop one of the two signals.
    /** A toned row. */
    const toned = surfaceBodyRow(surface, "r4", "note       broken") as Element
    expect(((toned.children ?? [])[0] as Element).props?.color).toBe(DAG_TONE_THEME.blocked)
    expect(((toned.children ?? [])[0] as Element).props?.dimColor).toBeUndefined()
  })

  test("the tally tone ladder reports the loudest state the board carries", () => {
    expect(toneOfTally({ total: 0, completed: 0, inProgress: 0, failed: 0 }, [])).toBe("open")
    expect(toneOfTally({ total: 3, completed: 3, inProgress: 0, failed: 0 }, ["completed", "completed", "completed"])).toBe("completed")
    expect(toneOfTally({ total: 3, completed: 2, inProgress: 1, failed: 0 }, [])).toBe("running")
    expect(toneOfTally({ total: 3, completed: 2, inProgress: 1, failed: 1 }, [])).toBe("failed")
    // `blocked` is read off the DRAWN states — the record resolved it already, so nothing is re-derived.
    expect(toneOfTally({ total: 2, completed: 0, inProgress: 0, failed: 0 }, ["blocked", "blocked"])).toBe("blocked")
    expect(toneOfTally({ total: 2, completed: 1, inProgress: 0, failed: 0 }, ["completed", "open"])).toBe("open")
    // The surface's own precedence: a failure outranks a live run, and a live run outranks a finished board.
    expect(dominantTone(["open", "running"])).toBe("running")
    expect(dominantTone(["running", "failed"])).toBe("failed")
    expect(dominantTone(["completed", "running"])).toBe("running")
    expect(dominantTone([])).toBe("dim")
  })

  test("the host's own subagent states map onto the same six tones", () => {
    /** One row per state this surface can see, in the host's own vocabulary. */
    const rows: SubagentRowView[] = [
      { description: "live", mode: "continuable", status: "running", live: true, failed: false },
      { description: "done", mode: "one-shot", status: "completed", live: false, failed: false },
      { description: "dead", mode: "one-shot", status: "failed", live: false, failed: true },
      { description: "odd", mode: "unknown", status: "unknown", live: false, failed: false },
    ]
    expect(rows.map((row) => toneOfStatus(row))).toEqual(["running", "completed", "failed", "dim"])
  })

  test("the progress bar is drawn from the contract's own cells", () => {
    expect(barCells(0, 0, 8)).toBe(DAG_CHROME.barEmpty.repeat(8))
    expect(barCells(4, 4, 8)).toBe(DAG_CHROME.barFull.repeat(8))
    expect(barCells(2, 4, 8)).toBe(`${DAG_CHROME.barFull.repeat(4)}${DAG_CHROME.barEmpty.repeat(4)}`)
    // A bar that has STARTED always lights a cell, and every hostile input stays inside its width.
    expect(barCells(1, 1000, 8)).toBe(`${DAG_CHROME.barFull}${DAG_CHROME.barEmpty.repeat(7)}`)
    for (const [filled, total, cells] of [
      [Number.NaN, Number.NaN, 8],
      [-4, -1, 4],
      [2, 4, Number.NaN],
      [2, 4, -3],
      [Number.POSITIVE_INFINITY, 4, 6],
    ] as const) {
      /** The bar this input draws. */
      const bar = barCells(filled, total, cells)
      expect(cellWidth(bar)).toBeLessThanOrEqual(Math.max(0, Number.isFinite(cells) ? Math.floor(cells) : 0))
      expect(bar).not.toContain("NaN")
      expect(bar).not.toContain("Infinity")
    }
  })

  test("the chrome title joins what exists and never leaves a dangling separator", () => {
    expect(chromeTitle(["a", undefined, "", "b"])).toBe("a · b")
    expect(chromeTitle([undefined, ""])).toBe("")
  })
})

// ── the two text seams ──────────────────────────────────────────────────────

describe("the text-only surfaces stay inside their budgets", () => {
  test("the status row publishes at most its documented cells, and never shears a wide glyph", () => {
    /** A workspace with no team, so the mark has nothing to report. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-visuals-status-"))
    /** The projection the status family renders. */
    const empty = readBoardState(workspace, workspace, [], [])
    /** The published row. */
    const line = statusVisualLine(empty)
    expect(cellWidth(line)).toBeLessThanOrEqual(STATUS_MAX_CELLS)
    // The FACTS are `state.ts`'s own sentence: this row clamps and sanitizes, it never re-renders.
    expect(line).toBe(statusLine(empty))
    // With no team there is no state to mark, and the contract publishes no glyph for `dim`.
    expect(statusMarker(empty)).toBe("?")
    // A CJK sentence at the budget's edge is cut by CELL, so the width stays EVEN: an odd width would mean
    // a wide glyph was cut in half — the exact shear the budget exists to prevent.
    const wide = statusVisualLine(empty, "冻".repeat(300))
    expect(cellWidth(wide)).toBeLessThanOrEqual(STATUS_MAX_CELLS)
    expect(wide).not.toContain("\u0000")
    expect(cellWidth(wide) % 2).toBe(0)
  })

  test("the status mark reports the workspace's dominant state, in the contract's glyphs", () => {
    /** The workspace both arms read. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-visuals-done-"))
    /** A record whose only task is finished. */
    const finished = fixtureRecord([{ id: "t1", subject: "a", status: "completed" }], { phase: "completed" })
    expect(statusMarker(readBoardState(workspace, workspace, [], [finished as never]))).toBe(DAG_TONE_GLYPH.completed)
    /** A record with one task in flight. */
    const running = fixtureRecord([{ id: "t1", subject: "a", status: "in_progress" }])
    expect(statusMarker(readBoardState(workspace, workspace, [], [running as never]))).toBe(DAG_TONE_GLYPH.running)
  })
})
