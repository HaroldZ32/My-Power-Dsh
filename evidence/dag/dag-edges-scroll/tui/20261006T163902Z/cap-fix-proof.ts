// THE CAP-FIX INSTRUMENT: the PTY capture's own fixture, rendered through the REAL panel component at the
// capture's own widths, plus the label-cut and the C3 detail body. Graded where the capture graded it.
import { createDagPanelComponent, dagPanelLayout, pinnedDetailLines, type DagPanelTask } from "../../packages/mpd-tui-plugin/src/panel-dag"
import { layoutBoxesNatural } from "../../packages/mpd-tui-plugin/src/graph"
import { cellWidth } from "../../packages/mpd-tui-plugin/src/sanitize"

/** The capture's fixture subjects: the same real Chinese board, with acceptance text. */
const subjects = [
  "冻结验收契约与验收标准",
  "建立头部与进度条的双向滚轴",
  "绘制依赖图的连线与圆角节点盒",
  "修复被截断的成员路由中文对齐",
  "验证图内不得出现任何中文字符",
]
/** The board, in the page's own vocabulary, with the acceptance text the record carries. */
const board: DagPanelTask[] = subjects.map((subject, index) => ({
  id: `T${index + 1}`,
  subject,
  description: `验收说明 ${index + 1}：必须保持原样`,
  kind: "work",
  visual: index === 0 ? "completed" : "open",
  dependencies: index === 0 ? [] : [`T${index}`],
  failedDependencies: [],
  depth: index,
}))
/** The same board with ASCII subjects of the fixture's ~48-53 cells, which is what the cap must hold. */
const real: DagPanelTask[] = board.map((task, index) => ({
  ...task,
  subject: [
    "natural width and bidirectional panning for the DAG",
    "termaid rounded node boxes with rounded corners",
    "the graph-safe label rule on every drawing surface",
    "the horizontal window is the drawing's own",
    "prove the tip touches the border by arithmetic",
  ][index] ?? task.subject,
}))

/** A minimal host kit double, so the REAL component can be rendered. */
type El = { type: unknown; props: Record<string, unknown>; children: unknown[] }
/** Build one kit double. */
function makeKit(columns: number, rows: number): Record<string, unknown> {
  const store = new Map<string, unknown>()
  const pending: Array<{ key: string; value: unknown }> = []
  let index = 0
  const effects: Array<() => unknown> = []
  const React = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (n: unknown) => void] => {
      const key = `state:${index}`; index += 1
      if (!store.has(key)) store.set(key, initial)
      return [store.get(key), (n: unknown) => { store.set(key, n); pending.push({ key, value: n }) }]
    },
    useEffect: (e: () => unknown): void => { index += 1; effects.push(e) },
    useRef: (initial: unknown): { current: unknown } => {
      const key = `ref:${index}`; index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }
  const Text = (p: { children?: unknown }): El => ({ type: "Text", props: p as Record<string, unknown>, children: [p.children] })
  const Box = (p: { children?: unknown }): El => ({ type: "Box", props: p as Record<string, unknown>, children: [p.children] })
  return { React, ui: { Box, Text, ScrollBox: Box, Divider: (): El => ({ type: "Text", props: {}, children: ["─"] }), useTerminalSize: () => ({ columns, rows }), useAnimationTime: () => 0 }, reset: (): void => { index = 0; effects.length = 0; for (const u of pending) store.set(u.key, u.value) }, runEffects: (): void => { for (const e of [...effects]) e() } }
}
/** Every character inside one node. */
const inline = (n: unknown): string => {
  if (n === null || n === undefined) return ""
  if (typeof n === "string" || typeof n === "number") return String(n)
  if (Array.isArray(n)) return n.map(inline).join("")
  const e = n as El
  return inline(e.props?.children) + inline(e.children)
}

/** What the REAL panel component rendered at one width. */
const componentRenders: Array<{ columns: number; modeLine: string; drawingLooksBoxed: boolean; rowCount: number; firstRows: string[] }> = []
for (const columns of [44, 140, 220]) {
  const kit = makeKit(columns, 40)
  const host = { focused: true, visible: true, host: { onKey: () => () => {}, notify: () => {}, clearBadge: () => {}, snapshot: () => ({}) } }
  const page = createDagPanelComponent(() => ({ workspace: "/tmp/ev", team: { id: "team-ev", name: "capture", phase: "active", staged: true, runnable: true, links: 5 }, members: [], tasks: real.map((t) => ({ id: t.id, subject: t.subject, description: t.description, kind: t.kind, status: "pending", visual: t.visual, dependencies: [...t.dependencies], failedDependencies: [], depth: t.depth })), counts: { total: 5, completed: 1, pending: 4 }, problems: [], holds: [] }) as never) as (p: unknown) => unknown
  ;(kit.reset as () => void)()
  const tree = page({ React: kit.React, ui: kit.ui, host: host.host, focused: true, visible: true })
  /** Every row the component emitted. */
  const rows: string[] = []
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || typeof n !== "object") return
    if (Array.isArray(n)) { for (const c of n) walk(c); return }
    const e = n as El
    if (e.type === (kit.ui as Record<string, unknown>).Text) rows.push(inline(e))
    walk(e.children)
  }
  walk(tree)
  // THE PAGE'S OWN MODE LINE IS THE GRADED FACT: the `dag` page does not draw a `task dependency graph`
  // header (that line belongs to the merged panel and the scenes) — it reports its mode through `view …`,
  // which is the exact string the real-PTY capture read as `view rail`.
  const modeLine = rows.find((r) => r.startsWith("view ")) ?? "(none)"
  const drawingLooksBoxed = rows.some((r) => r.includes("╭"))
  componentRenders.push({ columns, modeLine, drawingLooksBoxed, rowCount: rows.length, firstRows: rows.slice(0, 2) })
}

/**
 * The label-cut and the safety net, ONE CASE PER ROW, read from the box's own rectangle.
 *
 * The interior probe runs ONLY when a box was drawn: a rail row has no box rectangle, so reading
 * `hits[0]` there would measure a list row and report a border that does not exist. Reporting the MODE
 * alongside is what keeps that honest.
 */
const cut: Array<{ label: string; mode: string; nodeWidth: number; whole: boolean; overflow: boolean; borders: string }> = []
for (const subject of ["requirements contract", "W1 natural width and bidirectional panning", "x".repeat(200)]) {
  const one: DagPanelTask[] = [{ id: "F1", subject, kind: "requirement", visual: "open", dependencies: [], failedDependencies: [], depth: 0 }]
  const layout = dagPanelLayout(one, 44, undefined, 24)
  const lines = layout.view.lines.map((row) => row.map((span) => span.text).join(""))
  const hit = layout.view.hits[0]
  const boxed = layout.mode === "boxes"
  const row = boxed ? (lines[hit.row + (layout.view.boxRows === 5 ? 2 : 1)] ?? "") : ""
  const interior = boxed ? row.slice(hit.col + 1, hit.colEnd) : ""
  // THE OVERFLOW FACT COMES FROM THE BOXED ATTEMPT, never from whatever layout was chosen: when the page
  // falls back, `layout.view` is the RAIL, and a rail has no `labelOverflow` to report — reading it there
  // would print `false` beside a fallback the flag itself caused.
  /** The boxed attempt at its natural width, which is what carries the reported fact. */
  const boxedAttempt = layoutBoxesNatural(one, undefined, { rows: 24 })
  cut.push({
    label: subject.length > 40 ? `${subject.slice(0, 40)}…(${subject.length})` : subject,
    mode: layout.mode,
    nodeWidth: layout.view.width,
    whole: boxed ? interior.includes(subject) : false,
    overflow: boxedAttempt?.labelOverflow === true,
    borders: boxed ? `${row[hit.col] ?? "?"}${row[hit.colEnd] ?? "?"}` : "(no box)",
  })
}

console.log(JSON.stringify({
  probe: "the PTY capture's fixture, rendered through the REAL panel component",
  captureClaim: "view rail · 5 tasks · ranks derived at 140 and 220",
  componentRenders,
  dagPanelLayoutAt44: dagPanelLayout(real, 44, undefined, 24).mode,
  labelCut: cut,
  c3Detail: pinnedDetailLines(board[0], board, 60),
  c3SubjectKept: pinnedDetailLines(board[0], board, 60).some((l) => l.includes(board[0].subject)),
  c3DescriptionKept: pinnedDetailLines(board[0], board, 60).some((l) => l.includes(board[0].description ?? "")),
  drawingCjkFree: dagPanelLayout(board, 60).view.lines.every((row) => row.every((span) => [...span.text].every((ch) => {
    const code = ch.codePointAt(0) ?? 0
    return !((code >= 0x2e80 && code <= 0x2fff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0x3040 && code <= 0x9fff))
  }))),
  widestLabelAt44: cellWidth(board[0].subject),
}, null, 2))
