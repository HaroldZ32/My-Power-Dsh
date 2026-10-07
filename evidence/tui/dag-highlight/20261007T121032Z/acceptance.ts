// RECON/EVIDENCE INSTRUMENT (not shipped). Runs the wave's acceptance criteria AC1..AC5 against the
// REAL plugin modules, headlessly, with a React double — the captain's own check, supplementary to the
// Verifier's independent lane. Contract: .mpd/plans/tui-dag-highlight.md
//
// Usage: bun .mpd/recon/termaid-revert/acceptance.ts <board.json> [columns] [rows]
import { createDagPanelComponent, dagPanelLayout, DAG_PANEL_ICON } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { DAG_ANIM, DAG_CHARS, DAG_PANEL_MIN_COLUMNS } from "../../../../packages/mpd-tui-plugin/src/dag-theme.ts"
import { PANEL_ICON } from "../../../../packages/mpd-tui-plugin/src/panel.ts"
import { WORKMATE_PANEL_ICON } from "../../../../packages/mpd-tui-plugin/src/panel-workmate.ts"
import { layoutBoxesNatural, layoutList, layoutRail, dependencyChain, hitTest } from "../../../../packages/mpd-tui-plugin/src/graph.ts"
import { cellWidth } from "../../../../packages/mpd-tui-plugin/src/sanitize.ts"

interface El { type: unknown; props: Record<string, unknown>; children: unknown[] }
/** One assertion's outcome, printed at the end. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []
/** Record one criterion's outcome. */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`)
}

const board = JSON.parse(await Bun.file(process.argv[2]).text()) as { tasks: Array<Record<string, unknown>>; name: string }
const columns = Number(process.argv[3] ?? 80)
const rows = Number(process.argv[4] ?? 40)
/** The board in the drawing's vocabulary. */
const tasks = board.tasks.map((t) => ({
  id: String(t.id),
  subject: String(t.subject ?? ""),
  description: String(t.description ?? ""),
  kind: typeof t.kind === "string" ? t.kind : "work",
  status: String(t.status ?? "pending"),
  visual: t.status === "completed" ? "completed" : (Array.isArray(t.blockedBy) && t.blockedBy.length > 0 ? "blocked" : "open"),
  assignee: typeof t.owner === "string" ? t.owner : "unassigned",
  dependencies: (Array.isArray(t.blockedBy) ? t.blockedBy : []).map(String),
  failedDependencies: [],
  depth: 0,
}))
/** The workflow shape the page reads. */
const workflow = {
  workspace: "/recon",
  team: { name: board.name, phase: "active" },
  counts: { completed: 0, total: tasks.length },
  members: [{ name: "verify" }],
  problems: [],
  tasks,
}

/** The React/ui double, the same shape the package's own suite uses. */
function makeKit(w: number, h: number) {
  const store = new Map<string, unknown>()
  const pending: Array<{ key: string; value: unknown }> = []
  let index = 0
  const effects: Array<() => unknown> = []
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      const key = `state:${index}`; index += 1
      if (!store.has(key)) store.set(key, initial)
      return [store.get(key), (next: unknown): void => { store.set(key, next); pending.push({ key, value: next }) }]
    },
    useEffect: (effect: () => unknown): void => { index += 1; effects.push(effect) },
    useRef: (initial: unknown): { current: unknown } => {
      const key = `ref:${index}`; index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }
  const Text = (props: Record<string, unknown>): El => ({ type: "Text", props, children: [props.children] })
  const Box = (props: Record<string, unknown>): El => ({ type: "Box", props, children: [props.children] })
  const ui: Record<string, unknown> = {
    Box, Text, ScrollBox: Box, Divider: (): El => ({ type: "Text", props: {}, children: ["─"] }),
    useTerminalSize: (): { columns: number; rows: number } => ({ columns: w, rows: h }),
    useAnimationTime: (): number => DAG_ANIM.intervalMs * 2,
  }
  return {
    React, ui,
    reset: (): void => { index = 0; effects.length = 0; for (const u of pending) store.set(u.key, u.value) },
    /** Every drawn span of the last render, in draw order, with its colour/style props. */
    spans(tree: unknown): Array<{ text: string; colour: string | undefined; bold: boolean; dim: boolean }> {
      const out: Array<{ text: string; colour: string | undefined; bold: boolean; dim: boolean }> = []
      const walk = (node: unknown, colour: string | undefined, bold: boolean, dim: boolean): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) { for (const c of node) walk(c, colour, bold, dim); return }
        if (typeof node === "string" || typeof node === "number") { out.push({ text: String(node), colour, bold, dim }); return }
        const el = node as El
        const nextColour = typeof el.props?.color === "string" ? (el.props.color as string) : colour
        const nextBold = el.props?.bold === true ? true : bold
        const nextDim = el.props?.dimColor === true || el.props?.dim === true ? true : dim
        for (const c of (el.children ?? [])) walk(c, nextColour, nextBold, nextDim)
      }
      walk(tree, undefined, false, false)
      return out
    },
    /** Every clickable element, with the text it draws and its handler. */
    clicks(tree: unknown): Array<{ text: string; onClick: (event: unknown) => void }> {
      const found: Array<{ text: string; onClick: (event: unknown) => void }> = []
      const inline = (v: unknown): string =>
        v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "number" ? String(v) : Array.isArray(v) ? v.map(inline).join("") : ((v as El).children ?? []).map(inline).join("")
      const walk = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) { for (const c of node) walk(c); return }
        if (typeof node !== "object") return
        const el = node as El
        if (typeof el.props?.onClick === "function") found.push({ text: inline(el.children), onClick: el.props.onClick as (event: unknown) => void })
        walk(el.children)
      }
      walk(tree)
      return found
    },
    /** The drawn rows of one render, as single strings. */
    rows(tree: unknown): string[] {
      const out: string[] = []
      const walk = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) { for (const c of node) walk(c); return }
        if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return }
        const el = node as El
        if (el.type === Box || el.type === "Box") { for (const c of (el.children ?? [])) walk(c); return }
        for (const c of (el.children ?? [])) walk(c)
      }
      walk(tree)
      return out
    },
  }
}

// ── AC1 / AC2 / AC3 — the DRAWING, straight from graph.ts ────────────────────
const view = layoutBoxesNatural(tasks, undefined, { rows })
if (view === undefined) {
  check("AC1", false, "layoutBoxesNatural refused the board — the drawing does not exist")
} else {
  const lines = view.lines.map((line) => line.map((s) => s.text).join("").replace(/\s+$/, ""))
  const drawn = lines.join("\n")
  const boxRows = (view as { boxRows?: number }).boxRows
  // AC1: EVERY box's own interior reads exactly `<marker> <id>`. The interior is located through the
  // drawing's OWN hit rectangles, never by stripping border characters off a row — a rank holds two or
  // three boxes on ONE row, so a row-shaped regex cannot tell their interiors apart.
  const allowedMarkers = ["✓", "◐", "○", "✗", "⊘", "▶"]
  const offShape: string[] = []
  let boxesChecked = 0
  for (const h of view.hits) {
    /** The rows this box occupies, top border included. */
    const band = lines.slice(h.row, h.rowEnd + 1)
    /** The row inside the band that carries the label. */
    const labelRow = band.find((line) => new RegExp(`[^A-Za-z0-9]${h.taskId}(\\s|$)`).test(line))
    if (labelRow === undefined) continue
    boxesChecked += 1
    /** This box's interior cells only: its own columns, borders excluded. */
    const interior = labelRow.slice(h.col + 1, h.colEnd).trim()
    if (!new RegExp(`^[${allowedMarkers.join("")}] ${h.taskId}$`, "u").test(interior)) offShape.push(`${h.taskId} -> ${JSON.stringify(interior)}`)
  }
  check("AC1", boxesChecked > 0 && offShape.length === 0, `boxes=${boxesChecked}/${view.hits.length} off-shape=${offShape.length}${offShape.length > 0 ? ` -> ${JSON.stringify(offShape.slice(0, 3))}` : ""}`)
  // AC2: rounded corners, exactly three rows per box, no padding row between the borders.
  const rounded = Object.values(DAG_CHARS).some((g) => g === "╭") && drawn.includes("╭") && drawn.includes("╮") && drawn.includes("╰") && drawn.includes("╯")
  const sharp = drawn.includes("┌") || drawn.includes("┐") || drawn.includes("└") || drawn.includes("┘")
  check("AC2", rounded && !sharp && boxRows === 3, `rounded=${rounded} sharpPresent=${sharp} boxRows=${String(boxRows)}`)
  // AC3: a rank with THREE boxes draws in <= 40 cells.
  const threeWide = layoutBoxesNatural(
    [{ id: "N1", subject: "x", visual: "open", dependencies: [], failedDependencies: [] },
     { id: "N2", subject: "x", visual: "open", dependencies: [], failedDependencies: [] },
     { id: "N3", subject: "x", visual: "open", dependencies: [], failedDependencies: [] }],
    undefined,
    { rows },
  )
  const threeWidth = threeWide?.width ?? Number.POSITIVE_INFINITY
  check("AC3", threeWidth <= 40, `three-box rank width=${String(threeWidth)} (<=40 required); panel column at ${String(columns)} cells`)
}

// ── AC4 / AC5 — the PANEL: click resolution and the visible highlight ────────
const kit = makeKit(columns, rows)
const host = { snapshot: (): unknown => ({ subagents: [] }), focused: true, notify: (): void => undefined, clearBadge: (): void => undefined, toast: (): boolean => true, onKey: (): (() => void) => (): void => undefined }
/** The agent-page dep the Interaction lane publishes; recorded so AC6 has a witness. */
const opened: string[] = []
const Page = createDagPanelComponent(() => workflow as never, undefined, (id: string) => { opened.push(id); return true })
const render = (): unknown => { kit.reset(); return (Page as (props: unknown) => unknown)({ React: kit.React, ui: kit.ui, host, focused: true, visible: true }) }
const first = render()
// ── choose a target: the SECOND box of a rank that holds TWO boxes ───────────
// This is the case the pre-fix row-only predicate gets wrong: both boxes share one row band, so the
// old code always pinned the leftmost. The control is a click at the SECOND box's own COLUMN.
/** The page's own content width, so the layout here is the layout the page drew. */
const contentCols = Math.max(8, Math.floor(Number.isFinite(columns) ? columns : 8) - 2)
/** The same page-level layout call the component makes. */
const pageLayout = dagPanelLayout(tasks as never, contentCols, undefined, Math.max(1, rows - 2))
/** The drawing the page drew. */
const view2 = pageLayout?.view
/** Boxes grouped by their row band. */
const bands = new Map<string, Array<{ taskId: string; col: number; colEnd: number }>>()
for (const h of view2?.hits ?? []) {
  const key = `${h.row}`
  bands.set(key, [...(bands.get(key) ?? []), { taskId: h.taskId, col: h.col, colEnd: h.colEnd }])
}
/** The widest rank of boxes, sorted left to right. */
const rank = [...bands.values()].sort((a, b) => b.length - a.length)[0] ?? []
const crowdedRank = rank.length >= 2 ? rank.slice().sort((a, b) => a.col - b.col) : undefined
if (crowdedRank === undefined) {
  check("AC4", false, `no rank holds two boxes (ranks=${bands.size}) — the control cannot be built on this board`)
} else {
  /** The SECOND box of that rank: the one the row-only predicate can never reach. */
  const target = crowdedRank[1]
  /** The clickable row whose text draws the target (it draws the whole rank, so both ids appear). */
  const hitRow = kit.clicks(first).find((row) => new RegExp(`[^A-Za-z0-9]${target.taskId}(\\s|│|$)`, "u").test(row.text))
  if (hitRow === undefined) {
    check("AC4", false, `no clickable row draws ${target.taskId} (drawing rows=${kit.clicks(first).length})`)
  } else {
    // The pointer column INSIDE the target's box, in the row's own coordinates. colOffset is 0 before
    // any pan, and the row element is the full panel width, so localCol maps 1:1 onto the drawing.
    const localCol = target.col + 1
    hitRow.onClick({ localRow: 0, localCol })
    const after = render()
    const painted = kit.spans(after).map((s) => s.text).join("")
    const firstId = crowdedRank[0].taskId
    const okPinned = new RegExp(`▶\\s${target.taskId}(\\s|│|$)`, "u").test(painted)
    const wrong = new RegExp(`▶\\s${firstId}(\\s|│|$)`, "u").test(painted)
    check("AC4", okPinned && !wrong, `clicked the SECOND box of the rank at localCol=${localCol}; pinned ${target.taskId}=${okPinned}, pinned the leftmost ${firstId}=${wrong}`)
    // AC5: the pinned task's spans and its chain are BOLD, and the rest carry dimColor.
    const chain = dependencyChain(tasks as never, target.taskId)
    const spans = kit.spans(after)
    const focusBold = spans.some((s) => s.bold && s.colour === "accentShimmer")
    const chainBold = spans.some((s) => s.bold && s.colour === "accent")
    const anyDim = spans.some((s) => s.dim)
    check("AC5", anyDim && focusBold && (chain.size === 0 || chainBold), `bold spans=${spans.filter((s) => s.bold).length} dim spans=${spans.filter((s) => s.dim).length} focusBold=${focusBold} chain=[${[...chain].join(",")}] chainBold=${chainBold}`)
  }
}

// ── AC6 — a second click on the PINNED task opens the agent work page ────────
// A click on the already-pinned task must reach `openAgentPage` with the AGENT ID resolved from the
// host's curated snapshot. The owner is matched against the subagent rows, so the double carries one.
{
  /** The agent id the double's snapshot exposes. */
  const AGENT = "agent-verify"
  const hostWith = {
    snapshot: (): unknown => ({ subagents: [{ agentId: AGENT, description: "verify the wave", status: "running", mode: "continuable" }] }),
    focused: true, notify: (): void => undefined, clearBadge: (): void => undefined, toast: (): boolean => true,
    onKey: (): (() => void) => (): void => undefined,
  }
  /** A board whose every task is owned by the member the snapshot carries. */
  const owned = tasks.map((t) => ({ ...t, assignee: "verify" }))
  const ownedWorkflow = { ...workflow, tasks: owned }
  const kit2 = makeKit(columns, rows)
  const openedIds: string[] = []
  const Page2 = createDagPanelComponent(() => ownedWorkflow as never, { openAgentPage: (id: string): boolean => { openedIds.push(id); return true } })
  const draw = (): unknown => { kit2.reset(); return (Page2 as (props: unknown) => unknown)({ React: kit2.React, ui: kit2.ui, host: hostWith, focused: true, visible: true }) }
  const r1 = draw()
  /** The first box of the board, which is alone in its rank, so its row resolves unambiguously. */
  const firstTask = owned[0].id
  const row1 = kit2.clicks(r1).find((row) => new RegExp(`[^A-Za-z0-9]${firstTask}(\\s|│|$)`).test(row.text))
  if (row1 === undefined) {
    check("AC6", false, `no clickable row draws ${firstTask}`)
  } else {
    row1.onClick({ localRow: 0, localCol: 3 })
    const r2 = draw()
    const pinnedNow = new RegExp(`▶\\s${firstTask}(\\s|│|$)`, "u").test(kit2.spans(r2).map((s) => s.text).join(""))
    /** The SAME task's row in the pinned render, clicked a SECOND time. */
    const row2 = kit2.clicks(r2).find((row) => new RegExp(`[^A-Za-z0-9]${firstTask}(\\s|│|$)`).test(row.text))
    if (row2 === undefined) {
      check("AC6", false, `pinned ${firstTask} but its row vanished from the clickable set`)
    } else {
      row2.onClick({ localRow: 0, localCol: 3 })
      check("AC6", pinnedNow && openedIds.length > 0 && openedIds[0] === AGENT, `pinned=${pinnedNow} openAgentPage called with ${JSON.stringify(openedIds)} (expected ["${AGENT}"])`)
    }
  }
}

// ── AC7 — both rails scrub under a DRAG ──────────────────────────────────────
// Run the page in a viewport SMALL enough that both axes overflow, then drive the drag handlers the
// host itself would drive and require the rendered window to move on each axis.
{
  // A board whose widest rank holds THREE tasks: its drawing is ~36 cells, so at a 28-cell panel the
  // horizontal rail genuinely exists — the rail is drawn ONLY on overflow, which is the contract.
  const narrow = DAG_PANEL_MIN_COLUMNS
  const wideWorkflow = {
    ...workflow,
    tasks: ["W1", "W2", "W3"].map((id) => ({
      id, subject: `t ${id}`, description: `t ${id}`, kind: "work", status: "pending", visual: "open",
      assignee: "unassigned", dependencies: [], failedDependencies: [], depth: 0,
    })),
  }
  const kit3 = makeKit(narrow, 12)
  const Page3 = createDagPanelComponent(() => wideWorkflow as never)
  const draw = (): unknown => { kit3.reset(); return (Page3 as (props: unknown) => unknown)({ React: kit3.React, ui: kit3.ui, host, focused: true, visible: true }) }
  /** Every element carrying a drag handler, with the handlers themselves. */
  const drags = (tree: unknown): Array<{ text: string; start: (e: unknown) => void; vertical: boolean }> => {
    const out: Array<{ text: string; start: (e: unknown) => void; vertical: boolean }> = []
    const inline = (v: unknown): string =>
      v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "number" ? String(v) : Array.isArray(v) ? v.map(inline).join("") : ((v as El).children ?? []).map(inline).join("")
    const walk = (node: unknown): void => {
      if (node === null || node === undefined) return
      if (Array.isArray(node)) { for (const c of node) walk(c); return }
      if (typeof node !== "object") return
      const el = node as El
      // The VERTICAL gutter is the one-column rail (`width: 1`, column direction); the HORIZONTAL rail
      // is the one-row track (`row` direction). Classified by the props the builders set, never by the
      // text, because a rail's cells are `█`/`░` on both axes.
      if (typeof el.props?.onDragStart === "function") {
        const vertical = el.props.width === 1 && el.props.flexDirection === "column"
        out.push({ text: inline(el.children), start: el.props.onDragStart as (e: unknown) => void, vertical })
      }
      walk(el.children)
    }
    walk(tree)
    return out
  }
  const before = draw()
  const beforeText = kit3.spans(before).map((s) => s.text).join("")
  const handles = drags(before)
  if (handles.length === 0) {
    check("AC7", false, `no element carries onDragStart at ${narrow}x12 — the rails are not draggable`)
  } else {
    /** The one-column rail: it scrubs on `localRow`. */
    const gutter = handles.find((h) => h.vertical)
    /** The one-row track: it scrubs on `localCol`. */
    const rail = handles.find((h) => !h.vertical)
    if (gutter === undefined || rail === undefined) {
      check("AC7", false, `need BOTH rails to carry drag handlers; got vertical=${gutter !== undefined} horizontal=${rail !== undefined} of ${handles.length}`)
    } else {
      // EACH RAIL IS DRIVEN ON ITS OWN AXIS, which is the whole point: a rail that read the wrong one
      // of the two would look draggable and scrub nothing.
      gutter.start({ localRow: 6, localCol: 0 })
      const afterVertical = kit3.spans(draw()).map((s) => s.text).join("")
      const verticalMoved = afterVertical !== beforeText
      rail.start({ localRow: 0, localCol: 20 })
      const afterHorizontal = kit3.spans(draw()).map((s) => s.text).join("")
      const horizontalMoved = afterHorizontal !== afterVertical
      check("AC7", verticalMoved && horizontalMoved, `two rails found (gutter+rail); dragging the gutter on localRow moved=${verticalMoved}, the rail on localCol moved=${horizontalMoved}, at ${narrow}x12`)
    }
  }
}

// ── AC8 — three distinct one-cell icons, and MPD's own ⤢ ─────────────────────
{
  /** The host's own tab icons, all seven, read from its `builtinPanels.js`. */
  const HOST_ICONS = ["≡", "▸", "◆", "ⓘ", "∿", "⌗", "♥"]
  const ours = [PANEL_ICON, DAG_PANEL_ICON, WORKMATE_PANEL_ICON]
  const widths = ours.map((icon) => cellWidth(icon))
  const distinct = new Set(ours).size === ours.length
  const collide = ours.filter((icon) => HOST_ICONS.includes(icon))
  const allOneCell = widths.every((w) => w === 1)
  const badge = kit.spans(first).map((s) => s.text).join("").includes("⤢")
  check("AC8", allOneCell && distinct && collide.length === 0 && badge, `icons=${JSON.stringify(ours)} widths=${JSON.stringify(widths)} distinct=${distinct} hostCollisions=${JSON.stringify(collide)} fullscreenGlyphRendered=${badge}`)
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} criteria PASS`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

// Keep the icon assertions imported so this instrument also fails loudly if a lane drops them.
void DAG_PANEL_MIN_COLUMNS
void hitTest
void layoutList
void layoutRail
void cellWidth
