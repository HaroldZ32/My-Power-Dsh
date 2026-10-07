// RECON/EVIDENCE INSTRUMENT (not shipped) — lane L2's discriminating check for clause AC4.
//
// WHY IT EXISTS: the captain's `probe-click.ts` clicks the row that DRAWS T3 with the stub coordinate
// `{ localRow: 0, localCol: 0 }`. On a board whose rank holds two boxes, column 0 is INSIDE THE LEFT
// box, so that click is geometrically a click on T2 and the probe cannot tell the two boxes apart —
// before the fix and after it. This instrument clicks the SAME row at a column INSIDE THE SECOND box,
// which is the click the defect is about, and prints what each coordinate resolves to.
//
// Usage: bun evidence/tui/dag-highlight/20261007T1230Z/discriminate-click.ts <board.json> [columns] [rows]
import { createDagPanelComponent } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { DAG_ANIM } from "../../../../packages/mpd-tui-plugin/src/dag-theme.ts"
import { hitTest, layoutBoxesNatural } from "../../../../packages/mpd-tui-plugin/src/graph.ts"

/** One rendered element, the only shape the double's tree carries. */
interface El {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

/** The board file, in the replay record's own shape. */
const board = JSON.parse(await Bun.file(process.argv[2]).text()) as { tasks: Array<Record<string, unknown>>; name: string }
/** The panel width this run reports. */
const columns = Number(process.argv[3] ?? 80)
/** The panel height this run reports. */
const rows = Number(process.argv[4] ?? 40)
/** The board in the drawing's vocabulary, projected as the probe projects it. */
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
/** The workflow shape `dagPageOf` reads. */
const workflow = {
  workspace: "/recon",
  team: { name: board.name, phase: "active" },
  counts: { completed: 0, total: tasks.length },
  members: [{ name: "verify" }],
  problems: [],
  tasks,
}

/** The React double: index-keyed hooks with a replayable store, the same shape the package suite uses. */
const store = new Map<string, unknown>()
/** The state writes a re-render replays. */
const pending: Array<{ key: string; value: unknown }> = []
/** The hook index of the current render pass. */
let index = 0
const React: Record<string, unknown> = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El => ({ type, props: props ?? {}, children }),
  useState: (initial: unknown): [unknown, (next: unknown) => void] => {
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
  useEffect: (): void => {
    index += 1
  },
  useRef: (initial: unknown): { current: unknown } => {
    const key = `ref:${index}`
    index += 1
    if (!store.has(key)) store.set(key, { current: initial })
    return store.get(key) as { current: unknown }
  },
}
/** The Text component: identity plus the children it renders. */
const Text = (props: Record<string, unknown>): El => ({ type: "Text", props, children: [props.children] })
/** The Box component: the host's column, one row per child. */
const Box = (props: Record<string, unknown>): El => ({ type: "Box", props, children: [props.children] })
/** The ui kit; `useAnimationTime` present so the running node takes its animated frame. */
const ui: Record<string, unknown> = {
  Box,
  Text,
  ScrollBox: Box,
  Divider: (): El => ({ type: "Text", props: {}, children: ["-"] }),
  useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows }),
  useAnimationTime: (): number => DAG_ANIM.intervalMs * 2,
}
/** Every toast line the page showed, which AC6 must keep non-silent. */
const toasts: string[] = []
/** The host API double. */
const host = {
  snapshot: (): unknown => ({ subagents: [] }),
  focused: true,
  notify: (): void => undefined,
  clearBadge: (): void => undefined,
  toast: (text: string): void => {
    toasts.push(text)
  },
  onKey: (): (() => void) => (): void => undefined,
}
/** The page under test, built the way every existing caller builds it. */
const Page = createDagPanelComponent(() => workflow as never) as (props: unknown) => unknown
/** Render once, replaying the state writes of the previous pass. */
const render = (): unknown => {
  index = 0
  for (const update of pending) store.set(update.key, update.value)
  return Page({ React, ui, host, focused: true, visible: true })
}
/** Every character inside one node, symbols joined with nothing. */
const inline = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : Array.isArray(value)
          ? value.map(inline).join("")
          : inline((value as El).children ?? [])
/** Every clickable element, in draw order, with the text it draws. */
const clicks = (tree: unknown): Array<{ text: string; onClick: (event: unknown) => void }> => {
  const found: Array<{ text: string; onClick: (event: unknown) => void }> = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const element = node as El
    if (typeof element.props?.onClick === "function") found.push({ text: inline(element.children), onClick: element.props.onClick as (event: unknown) => void })
    walk(element.children)
  }
  walk(tree)
  return found
}

/** The drawing the page lays out for this board, which is the geometry the click resolves against. */
const drawn = layoutBoxesNatural(tasks as never, undefined, { rows })
if (drawn === undefined) {
  console.log("the drawing refused this board — nothing to click")
  process.exit(1)
}
/** The two boxes of the crowded rank, when the board has one. */
const boxes = drawn.hits
console.log(`${boxes.length} box(es): ${boxes.map((hit) => `${hit.taskId}[rows ${hit.row}-${hit.rowEnd} cols ${hit.col}-${hit.colEnd}]`).join(" ")}`)
/** The second of two boxes that share a row band, which is the coordinate pair under test. */
const first = boxes.find((hit) => boxes.some((other) => other !== hit && other.row === hit.row && other.col > hit.col))
const second = boxes.find((hit) => first !== undefined && hit.row === first.row && hit.col > first.col)
if (first === undefined || second === undefined) {
  console.log("this board has no rank holding two boxes — the instrument cannot discriminate on it")
  process.exit(1)
}
console.log(`shared row band: ${first.taskId} cols ${first.col}-${first.colEnd} and ${second.taskId} cols ${second.col}-${second.colEnd}, both on rows ${first.row}-${first.rowEnd}`)
console.log(`hitTest(row ${second.row}, col 0)        -> ${hitTest(drawn, second.row, 0)}   (the captain's stub coordinate, INSIDE the left box)`)
console.log(`hitTest(row ${second.row}, col ${second.col + 1})       -> ${hitTest(drawn, second.row, second.col + 1)}   (a column inside the SECOND box)`)
/** One handler from one render, so both clicks come from the same generation when asked to. */
const row = clicks(render())[second.row].onClick
row({ localRow: 0, localCol: second.col + 1 })
const afterSecond = inline(render())
console.log(`AFTER clicking the row that draws ${second.taskId} at localCol ${second.col + 1}: pinned marker present for ${second.taskId} = ${afterSecond.includes(`▶ ${second.taskId}`)}, for ${first.taskId} = ${afterSecond.includes(`▶ ${first.taskId}`)}`)
console.log(`toasts: ${JSON.stringify(toasts)}`)
