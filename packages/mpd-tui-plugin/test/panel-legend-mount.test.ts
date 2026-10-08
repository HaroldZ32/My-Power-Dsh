// C4 — THE ACCUMULATING LEGEND, measured the only way it can be measured: on a MOUNTED INSTANCE.
//
// WHY THIS FILE EXISTS AND WHY THE REST OF THE SUITE COULD NOT SEE IT. Every other arm in
// `panel-dag.test.ts` calls the page COMPONENT FUNCTION directly with a host double, so it asserts what
// the page HANDS React and never what React does with it. The user's defect lives entirely in that gap:
// two legend rows were keyed by their own truncated text, and the two lines the page then drew agreed
// for the key's whole 24-cell length (`✓ completed · ◐ running · ○ open · ✗ failed · ⊘ cancelled` — the
// drawing module's own five-state key, DELETED since — and this legend's own first wrapped line
// `✓ completed · ◐ running · ○ open=blocked · ✗ failed`). React, handed two children under one key
// inside a column it re-renders, drew the collided row AGAIN on each pass — one extra legend row per
// click until the page overflowed its window.
//
// THE MOUNT IS THE INSTALLED HOST'S OWN. React, the themed `Box`/`Text` and the ink root are imported
// from the real `@deepseek-harness-tui/dsh-tui` package on this machine, exactly as the host supplies
// them to a plugin panel, so a frame this file reads is the frame a user would see. An absent host
// THROWS rather than skipping: a skip here would be a vacuous pass on the one clause this file exists
// for.
//
// WHAT IS ASSERTED. The COUNT of legend rows in the frame, at every step of a click walk — not merely
// that a legend exists. The pre-fix code measured 4 rows after mount and 4,5,5,5,6,6,6,7,7 across eight
// clicks; the repaired code measured 4 at every step, and it measures 3 at every step now that the
// drawing module's redundant five-state key is gone (one arrow row + two wrapped contract-key rows at
// this terminal's 58-cell budget). The second arm pins the CAUSE, so a future edit that reintroduces a
// content-derived key reddens on the key rather than on a row count.
import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { legendLines } from "../src/graph"
import { legendLinesFor, panelContentWidth } from "../src/panel-core"
import { DAG_STATE_TONES, DAG_TONE_GLYPH } from "../src/dag-theme"
import { createDagPanelComponent } from "../src/panel-dag"
import { createWorkmatePanelComponent, type WorkmateLibrary } from "../src/panel-workmate"
import type { TeamWorkflow } from "../src/team-state"

/**
 * The installed DSH-TUI package root, resolved from the launcher on `PATH`.
 *
 * Resolved rather than hard-coded because the arms below are statements about the INSTALLED host: a
 * pinned path would keep passing against a package that is no longer the one being launched.
 * @returns the host package's absolute root directory.
 */
function hostRoot(): string {
  /** The launcher's path on `PATH`, or null when the host is not installed at all. */
  const launcher = Bun.which("dsh-tui")
  if (launcher === null) throw new Error("dsh-tui is not on PATH: the mounted-instance arms need the real host")
  /** The launcher's real path, with the symlink the package manager installs behind it resolved. */
  const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
  // `<root>/bin/dsh-tui.js` -> `<root>`: two directories up, the same shape every lane resolves.
  return dirname(dirname(real))
}

/** The installed host package root, read once for every arm below. */
const HOST = hostRoot()

/** The host's React, whose hooks and `createElement` the page receives as its kit. */
const hostReact = createRequire(join(HOST, "lib", "types", "ui.js"))("react") as Record<string, unknown> & {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}

/** The host's own rendering surface: the themed components a page draws with. */
const hostUi = (await import(join(HOST, "lib", "types", "ui.js"))) as { Box: unknown; Text: unknown; ThemeProvider: unknown }

/** The host's ink root, whose `createRoot` accepts a managed stdout — the same call the host makes. */
const hostInk = (await import(join(HOST, "lib", "types", "ink", "root.js"))) as {
  createRoot(options: Record<string, unknown>): Promise<{ render(node: unknown): unknown; unmount(): void }>
}

/** A stdout double: a TTY-shaped stream that keeps every chunk the renderer wrote, in order. */
class InkStdout extends EventEmitter {
  /** The columns this fake terminal reports. */
  columns: number
  /** The rows this fake terminal reports. */
  rows: number
  /** Every chunk written so far, one entry per renderer write. */
  chunks: string[] = []
  /**
   * Build the fake terminal at one geometry.
   *
   * `EventEmitter` is the base because the renderer subscribes to `resize`; no resize is ever emitted,
   * so the geometry the constructor was given is the one every frame is laid out for.
   * @param columns - the width the renderer lays out for.
   * @param rows - the height the renderer lays out for.
   */
  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }
  /** Accept one write, as a stream would. */
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
}

/** One element the page asked React to create, with the props that carry its key and its click handler. */
interface CreatedElement {
  /** The element's React key, which is the identity React reconciles children by. */
  key: string
  /** The element's props, the click handler included. */
  props: Record<string, unknown>
}

/** A mounted page: the renderer, the elements the page created, and the two drives the arms need. */
interface MountedPage {
  /** The frame the renderer wrote most recently, as rows. */
  frame(): string[]
  /** Click the drawing row at one index of the current render, then let the re-render settle. */
  clickRow(index: number): Promise<boolean>
  /** Every element the page created during the CURRENT render, in creation order. */
  created(): CreatedElement[]
  /** Tear the renderer down. */
  unmount(): void
}

/**
 * Mount one page component with the INSTALLED host's React and ink, and return the drives.
 *
 * The page receives a React object that forwards every hook to the host's own React and RECORDS each
 * element it creates, which is what lets an arm read the keys the page handed over — and call the click
 * handler the page attached to a drawing row — without a second renderer or a synthetic event bus.
 * @param component - the page component to mount, already built by its own factory.
 * @param columns - the terminal width the fake stdout reports.
 * @param rows - the terminal height the fake stdout reports.
 * @returns the mounted page, its renderer live until `unmount`.
 */
async function mountPage(component: unknown, columns: number, rows: number): Promise<MountedPage> {
  /** Every element created during the current render, cleared before each drive. */
  let seen: CreatedElement[] = []
  /**
   * The drawing rows the LAST render that drew one created.
   *
   * Kept across a click that changes no state, because React bails out of that re-render and creates no
   * elements at all — reading `seen` alone would then report "the page drew no rows" and stop the walk
   * for a reason that has nothing to do with the defect. The page's click handlers read the pin through
   * a ref that survives re-renders, so a handler from the previous render is exactly as live.
   */
  let lastRows: CreatedElement[] = []
  /** The host kit the page receives, with `createElement` recording what it was asked to build. */
  const kitReact: Record<string, unknown> = {
    ...hostReact,
    createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown => {
      /** The real element, built by the host's own React. */
      const element = hostReact.createElement(type, props, ...children)
      /** The element's key, read off the element rather than off the props React consumes it from. */
      const key = (element as { key?: unknown }).key
      seen.push({ key: key === null || key === undefined ? "" : String(key), props: (props ?? {}) as Record<string, unknown> })
      return element
    },
  }
  /** The fake terminal the renderer writes into. */
  const stdout = new InkStdout(columns, rows)
  /** The host's own root over it. */
  const root = await hostInk.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
  /** The host's measured geometry, reported exactly as the host reports it to a panel. */
  const ui = { Box: hostUi.Box, Text: hostUi.Text, useTerminalSize: () => ({ columns, rows }) }
  /** The host API a panel receives; every member the pages read is present. */
  const host = {
    snapshot: () => ({ subagents: [] }),
    focused: true,
    visible: true,
    onKey: () => () => {},
    notify: () => {},
    clearBadge: () => {},
  }
  /** The props a panel component receives: the kit, the host API and the two state flags. */
  const pageProps = { React: kitReact, ui, host, focused: true, visible: true }
  // THE HOST'S OWN THEME PROVIDER wraps the page, because the themed `Box`/`Text` read that context —
  // the same context the host supplies in production.
  await root.render(hostReact.createElement(hostUi.ThemeProvider, null, hostReact.createElement(component as never, pageProps as never)))
  /** The renderer's own commit; 150 ms is far past it and the walk below re-waits after every click. */
  await new Promise((resolve) => setTimeout(resolve, 150))
  return {
    /** The frame as the renderer last wrote it, split into rows; see {@link MountedPage.frame}. */
    frame(): string[] {
      /** The most recent write: the frame as it stands now. */
      const last = stdout.chunks.length === 0 ? "" : stdout.chunks[stdout.chunks.length - 1] ?? ""
      return stripEscapes(last).split("\n")
    },
    /** Click one drawing row and let the re-render settle; see {@link MountedPage.clickRow}. */
    async clickRow(index: number): Promise<boolean> {
      /** The drawing rows this render created, each with the handler the page attached. */
      const fresh = seen.filter((element) => element.key.startsWith("row-") && typeof element.props.onClick === "function")
      if (fresh.length > 0) lastRows = fresh
      /** The row this drive asked for, absent when the page has drawn fewer rows than the index. */
      const target = lastRows[index]
      if (target === undefined) return false
      // THE NEXT RENDER'S ELEMENTS ARE THE ONES THE CLICK PRODUCES, so the record starts empty here and
      // the caller reads it after the settle — the previous render's handlers are never re-recorded.
      seen = []
      ;(target.props.onClick as (event: unknown) => void)({ localCol: 2 })
      await new Promise((resolve) => setTimeout(resolve, 150))
      return true
    },
    /** Every element the current render's page created; see {@link MountedPage.created}. */
    created(): CreatedElement[] {
      return seen
    },
    /** Tear the renderer down; see {@link MountedPage.unmount}. */
    unmount(): void {
      root.unmount()
    },
  }
}

/** Strip hyperlink and SGR escapes from one chunk, leaving its text. */
function stripEscapes(value: string): string {
  return value.replace(/\u001b\][^\u0007]*\u0007/gu, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
}

/**
 * One frame row's own content: the frame borders, the scroll rail and the padding removed.
 * @param row - one row of the rendered frame.
 * @returns the row's text, so it can be compared with a legend line the page computed.
 */
function rowContent(row: string): string {
  return stripEscapes(row).replace(/^│/u, "").replace(/│$/u, "").replace(/[█░▌▐]/gu, " ").replace(/\s+$/u, "")
}

/**
 * How many frame rows draw one of the legend's own lines.
 * @param frame - the frame's rows.
 * @param legend - the lines the page's own legend function produced for this width.
 * @returns the count of rows carrying a legend line, and the per-line breakdown.
 */
function legendRowCount(frame: readonly string[], legend: readonly string[]): { total: number; per: Map<string, number> } {
  /** How many rows carry each legend line. */
  const per = new Map<string, number>()
  for (const row of frame) {
    /** This row's content, normalized so a rail glyph cannot hide a legend line. */
    const content = rowContent(row)
    if (legend.includes(content)) per.set(content, (per.get(content) ?? 0) + 1)
  }
  /** Every legend row drawn anywhere in the frame. */
  let total = 0
  for (const count of per.values()) total += count
  return { total, per }
}

/** The terminal geometry the mounted arms use; tall enough that the window never hides the legend. */
const COLUMNS = 60

/** The rows the fake terminal reports: past the page's whole content, so scrolling cannot mask a row. */
const ROWS = 120

/** The team projection the DAG page reads, a six-task chain with one failed and one running node. */
function workflowFixture(): TeamWorkflow {
  return {
    workspace: "/tmp/mpd-legend-mount",
    team: { id: "team-20261008020000", name: "legend-mount", phase: "active", staged: false, runnable: true, links: 0 },
    members: [],
    tasks: [1, 2, 3, 4, 5, 6].map((index) => ({
      id: `T${index}`,
      subject: `Integration task #${index}`,
      kind: "work",
      status: "pending",
      visual: index === 1 ? "failed" : index === 2 ? "running" : index % 2 === 0 ? "completed" : "blocked",
      dependencies: index === 1 ? [] : [`T${index - 1}`],
      failedDependencies: [],
      depth: index - 1,
    })),
    counts: { total: 6, completed: 3, inProgress: 1, pending: 2, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/** A workmate library whose two problems agree for the whole 24 cells the old key was cut from. */
function collidingProblemsFixture(): WorkmateLibrary {
  /** The shared prefix, longer than the 24 cells the removed content key was cut to. */
  const shared = "cannot read /home/user/.mpd/workmate/very-long-instance-name/"
  // ONE ENTRY, because the page draws its problem list past the empty-state branch — an empty library
  // is a different page, and a fixture that took it would assert nothing about the problem rows.
  return {
    root: "/tmp/home/.mpd/workmate",
    archived: 0,
    problems: [`${shared}meta.json`, `${shared}note.md`],
    entries: [
      {
        key: "geometry-engineer-1",
        name: "geometry-engineer-1",
        base: "Deep Worker",
        description: "lays out DAG geometry",
        note: "owns the rank computation",
        uses: 3,
        updatedAt: "2026-10-08T02:00:00.000Z",
        readonlyBase: false,
        route: "deepseek-official/deepseek-v4-flash",
      },
    ],
  }
}

/**
 * The NEGATIVE CONTROL page: the PRE-FIX key shape, reproduced in a minimal page of the same kind.
 *
 * WHY A CONTROL IS REQUIRED HERE RATHER THAN PROSE. The arms above assert an ABSENCE — no growth, no
 * duplicate key — and an absence is exactly the shape a broken harness reports as success: a mount that
 * rendered nothing, a click that never reached a handler, or a frame reader that counted nothing would
 * all leave those arms green while proving nothing. This page is the smallest thing that carries the
 * removed defect, so if the harness can see the defect this page ACCUMULATES and the arm below says so.
 *
 * WHY THE CLICK INSERTS ROWS ABOVE THE COLLIDED PAIR. Measured while building this control: two
 * same-keyed siblings alone do NOT grow, while the real page did — because the real page's click inserts
 * the pin detail body ABOVE the legend, so the list it hands React is TWO DIFFERENT LENGTHS across the
 * two renders and the duplicate key is what stops React matching the old children to the new ones. The
 * control reproduces that trigger, which is the part of the real page's shape the defect depends on.
 * @param props - the host kit, exactly as a panel receives it.
 * @returns the element tree, keyed the way the pre-fix code keyed it.
 */
function preFixKeyedPage(props: Record<string, unknown>): unknown {
  /** The host's React, narrowed to the two members this page uses. */
  const React = props.React as {
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
    useState(initial: unknown): [unknown, (next: unknown) => void]
  }
  /** The host's themed components. */
  const ui = props.ui as { Box: unknown; Text: unknown }
  /** The click counter, whose only job is to force this column to re-render. */
  const clicks = React.useState(0)
  /**
   * The two rows the pre-fix key could not tell apart: they agree for their first 24 cells.
   *
   * The first is the drawing module's own five-state key, DELETED since with the redundant legend; it
   * stays spelled out here because this control must reproduce the PRE-FIX shape, or the falsifier
   * below would prove nothing about whether the harness can still see the defect.
   */
  const lines = [
    "✓ completed · ◐ running · ○ open · ✗ failed · ⊘ cancelled",
    "✓ completed · ◐ running · ○ open=blocked · ✗ failed",
  ]
  /** The rows above the legend: one per click, exactly as a pin body grows the real column. */
  const above: unknown[] = []
  for (let index = 0; index < (clicks[0] as number); index += 1) {
    above.push(React.createElement(ui.Text, { key: `pin-${index}` }, `pinned detail ${index}`))
  }
  /** The rows, keyed by their own truncated text exactly as the removed code keyed them. */
  const rows: unknown[] = lines.map((line) => React.createElement(ui.Text, { key: `legend-${line.slice(0, 24)}` }, line))
  rows.push(React.createElement(ui.Box, { key: "row-0", onClick: () => clicks[1]((clicks[0] as number) + 1) }, React.createElement(ui.Text, null, "click me")))
  return React.createElement(ui.Box, { key: "control", flexDirection: "column" }, ...above, ...rows)
}

/**
 * How many frame rows draw one exact line.
 * @param frame - the frame's rows.
 * @param line - the line to count.
 * @returns the number of rows whose normalized content is that line.
 */
function exactRowCount(frame: readonly string[], line: string): number {
  /** The rows that carry it. */
  let total = 0
  for (const row of frame) if (rowContent(row) === line) total += 1
  return total
}

describe("C4 · the negative control — this harness CAN see an accumulating row", () => {
  test("the pre-fix key shape accumulates, so the green arms above are falsifiable", async () => {
    /** One of the two colliding lines, used as the row this control counts. */
    const colliding = "✓ completed · ◐ running · ○ open · ✗ failed · ⊘ cancelled"
    /** The mounted control page, rendered by the installed host like every other page here. */
    const page = await mountPage(preFixKeyedPage, COLUMNS, ROWS)
    try {
      /** The row count at every step: the mount, then each click. */
      const counts: number[] = [exactRowCount(page.frame(), colliding)]
      for (let click = 0; click < 6; click += 1) {
        /** Whether this step really reached a clickable row; the walk stops when it did not. */
        const clicked = await page.clickRow(0)
        if (!clicked) break
        counts.push(exactRowCount(page.frame(), colliding))
      }
      // THE CONTROL MUST HAVE REALLY MOVED: a walk that never re-rendered would prove nothing about
      // whether this harness can see growth.
      expect(counts.length).toBeGreaterThanOrEqual(5)
      // THE FALSIFIER, ASSERTED: the collided row is drawn more than once, and it keeps growing. If this
      // ever stops holding, the harness has stopped being able to see the defect and the two green arms
      // above must be re-derived rather than trusted.
      expect(counts[counts.length - 1]).toBeGreaterThan(counts[0] ?? 0)
      expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(3)
    } finally {
      page.unmount()
    }
  })
})

describe("C4 · the legend does not accumulate across the click/pin interaction (mounted instance)", () => {
  test("the legend's row count is STABLE across N clicks — 3 after the mount (arrow + wrapped key) and 3 after every click", async () => {
    /** The lines the page's own legend function produces at this width — the target count. */
    const expected = legendLinesFor(panelContentWidth(COLUMNS), legendLines(panelContentWidth(COLUMNS)))
    // The legend is multi-row at this width — the arrow sentence plus the contract's key, WRAPPED — so
    // the walk below really counts several rows and the arm is not vacuous. The two same-prefix rows of
    // the original defect are gone with the drawing module's own key; what this arm still proves is that
    // the count is STABLE across a re-render.
    expect(expected.length).toBeGreaterThan(1)
    /** The mounted page, rendered by the installed host. */
    const page = await mountPage(createDagPanelComponent(workflowFixture, { openFullscreen: () => true }), COLUMNS, ROWS)
    try {
      /** The row count at every step: the mount, then each click, so a growth is visible as a sequence. */
      const counts: number[] = [legendRowCount(page.frame(), expected).total]
      for (let click = 0; click < 8; click += 1) {
        // THE CLICK IS THE INTERACTION THE DEFECT NEEDED: it moves the pin, which re-renders the page,
        // which is when a collided key makes React draw the row a second time.
        const clicked = await page.clickRow(click)
        if (!clicked) break
        counts.push(legendRowCount(page.frame(), expected).total)
      }
      // The walk must have really driven clicks: fewer than four steps means the page drew no rows.
      expect(counts.length).toBeGreaterThanOrEqual(5)
      // THE WHOLE SEQUENCE, not just its ends: the pre-fix code reached this assertion as
      // [4,5,5,5,6,6,6,7,7] and the repaired code as [4,4,4,4,4,4,4,4,4].
      expect(counts).toEqual(counts.map(() => expected.length))
    } finally {
      page.unmount()
    }
  })

  test("the legend and the pin body key every row distinctly among their own siblings", async () => {
    /** The lines the page's own legend function produces at this width — the legend's sibling count. */
    const expected = legendLinesFor(panelContentWidth(COLUMNS), legendLines(panelContentWidth(COLUMNS)))
    /** The mounted page, rendered by the installed host. */
    const page = await mountPage(createDagPanelComponent(workflowFixture, { openFullscreen: () => true }), COLUMNS, ROWS)
    /** Every legend key and every pin key the walk created — both families are siblings in one column. */
    const legendKeys: string[] = []
    /** The pin body's keys, collected over the same walk. */
    const pinKeys: string[] = []
    try {
      /** Collect the two families out of one render's created elements. */
      const collect = (): void => {
        for (const element of page.created()) {
          if (element.key.startsWith("legend-")) legendKeys.push(element.key)
          if (element.key.startsWith("pin-")) pinKeys.push(element.key)
        }
      }
      collect()
      for (let click = 0; click < 4; click += 1) {
        /** Whether this step really reached a clickable row; the walk stops when it did not. */
        const clicked = await page.clickRow(click)
        if (!clicked) break
        collect()
      }
      // THE LEGEND IS REALLY DRAWN, one row per contract line: an empty list would make the uniqueness
      // claim below vacuous, and a SHORTER list would mean the page dropped a line the contract owns.
      expect(new Set(legendKeys).size).toBe(expected.length)
      // THE CAUSE, PINNED DIRECTLY: pre-fix, these four rows lived under three distinct keys because the
      // drawing's own state line and the legend's first wrapped line shared a 24-cell prefix. Distinct
      // keys number exactly the contract's lines, and EVERY render in the walk drew that many rows —
      // which is the same stability the frame-counting arm above reads, measured one level lower.
      expect(new Set(legendKeys).size).toBe(expected.length)
      expect(legendKeys.length % expected.length).toBe(0)
      // THE PIN BODY IS THE SAME KIND OF LIST and must be keyed the same way; the walk must have produced
      // one, or this half of the arm proves nothing.
      expect(pinKeys.length).toBeGreaterThan(0)
      expect(new Set(pinKeys).size).toBe(pinKeys.length)
    } finally {
      page.unmount()
    }
  })

  test("the workmate page keys two same-prefix problems as two rows, not one key twice", async () => {
    /** The mounted workmate page, fed a library whose two problems agree for 24+ cells. */
    const page = await mountPage(createWorkmatePanelComponent(collidingProblemsFixture, { openFullscreen: () => true }), COLUMNS, ROWS)
    try {
      /** The keys of every problem row the page created. */
      const problemKeys = page.created().filter((element) => element.key.startsWith("p-")).map((element) => element.key)
      // BOTH problems must reach React — a page that dropped one would pass a uniqueness check while
      // losing a row the reader needs, which is the opposite defect.
      expect(problemKeys.length).toBe(2)
      expect(new Set(problemKeys).size).toBe(2)
    } finally {
      page.unmount()
    }
  })
})

// ── A1: the state key is printed EXACTLY ONCE — read off the FRAME, at the reference width ─────────
//
// WHY A FRAME AND NOT A HELPER RETURN. What the user reported was a ROW the reader saw, so the acceptance
// artifact is the frame the installed host's ink root wrote, and what this arm counts is ROWS. The
// pre-fix frame at this width carried TWO rows starting with the contract's first state entry (the
// drawing module's own five-state key and the contract's six-state key); the post-fix frame carries ONE.
// This lane's evidence records both readings: `frame-before.txt` stateKeyRows[2], `frame-after.txt`
// stateKeyRows[1].
describe("A1 · the composed legend prints the state key exactly once (mounted instance, 156 columns)", () => {
  test("exactly ONE frame row starts with the contract's first state entry", async () => {
    /** The terminal width the shipped reference capture was taken at. */
    const columns = 156
    /** The first state the contract prints, read out of the frozen table rather than re-typed. */
    const firstState = DAG_STATE_TONES[0] as string
    /** That state's own glyph, `?` when the contract stops declaring one. */
    const firstGlyph = DAG_TONE_GLYPH[firstState] ?? "?"
    /** The contract's first state entry, which is how a state-key row identifies itself. */
    const firstEntry = `${firstGlyph} ${firstState}`
    /** The mounted DAG page over the fixture team, at the reference width. */
    const page = await mountPage(createDagPanelComponent(workflowFixture, { openFullscreen: () => true }), columns, ROWS)
    try {
      /** The frame's own rows, normalized exactly as the row-count arms above normalize them. */
      const rows = page.frame().map((row) => rowContent(row))
      /** Every frame row whose content STARTS with the contract's first state entry. */
      const stateRows = rows.filter((content) => content.startsWith(firstEntry))
      // ONE, PRECISELY. The pre-fix frame drew two — the drawing module's five-state key first — and a
      // frame that drew NONE would be the other failure this count catches.
      expect(stateRows).toHaveLength(1)
      // AND THE SURVIVOR NAMES THE SHARED MARK ONCE, NAMING BOTH CARRIERS: `blocked` and `open` are
      // drawn as the same `○`, so the mounted key must contain ONE entry for that mark carrying both
      // names. The pre-fix key printed the pair twice (`○ open=blocked · ○ blocked=open`) with an `=`
      // asserting they are each other; this is the reading the user reported as a duplicate.
      /** The entries the mounted key row opens with the shared mark. */
      const sharedEntries = stateRows[0].split(" · ").filter((entry) => entry.startsWith(`${DAG_TONE_GLYPH.blocked ?? "?"} `))
      expect(sharedEntries).toHaveLength(1)
      expect(sharedEntries[0] ?? "").toContain("blocked")
      expect(sharedEntries[0] ?? "").toContain("open")
      expect(stateRows[0]).not.toContain("=")
      /** The composed legend at this width: every line the page is supposed to draw under the DAG. */
      const composed = legendLinesFor(panelContentWidth(columns), legendLines(panelContentWidth(columns)))
      // THE LEGEND REALLY REACHED THE FRAME, line for line — otherwise the count above could be read off
      // a page that drew no legend at all, which is the vacuous shape of an absence assertion.
      expect(legendRowCount(page.frame(), composed).total).toBe(composed.length)
    } finally {
      page.unmount()
    }
  })
})
