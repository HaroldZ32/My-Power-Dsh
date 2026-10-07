// RECON ONLY (not shipped): render the DAG sidebar page headlessly, click a node, and print the
// COLOUR each drawing row carries before and after the click. Written to settle, with evidence,
// whether "click a task -> the rest dims and the chain lights" still reaches the drawing.
import { createDagPanelComponent, dagPageOf } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { DAG_ANIM } from "../../../../packages/mpd-tui-plugin/src/dag-theme.ts"
import { hitTest } from "../../../../packages/mpd-tui-plugin/src/graph.ts"

interface El { type: unknown; props: Record<string, unknown>; children: unknown[] }

const board = JSON.parse(await Bun.file(process.argv[2]).text()) as { tasks: Array<Record<string, unknown>>; name: string }
/** The workflow shape `dagPageOf` reads. */
const workflow = {
  workspace: "/recon",
  team: { name: board.name, phase: "active" },
  counts: { completed: 1, total: board.tasks.length },
  members: [{ name: "verify" }],
  problems: [],
  tasks: board.tasks.map((t) => ({
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
  })),
}

/** A React double: index-keyed hooks with a replayable store, exactly the shape the suite uses. */
function makeKit(columns: number, rows: number) {
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
    useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows }),
    useAnimationTime: (): number => DAG_ANIM.intervalMs * 2,
  }
  return {
    React, ui,
    reset: (): void => { index = 0; effects.length = 0; for (const update of pending) store.set(update.key, update.value) },
    /** Every drawn row of the LAST render, as (text, colour) spans. */
    paint(tree: unknown): Array<{ text: string; colour: string | undefined }> {
      const out: Array<{ text: string; colour: string | undefined }> = []
      const walk = (node: unknown, colour: string | undefined): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) { for (const child of node) walk(child, colour); return }
        if (typeof node === "string" || typeof node === "number") { out.push({ text: String(node), colour }); return }
        const element = node as El
        const next = typeof element.props?.color === "string" ? (element.props.color as string) : colour
        for (const child of (element.children ?? [])) walk(child, next)
      }
      walk(tree, undefined)
      return out
    },
  }
}

const kit = makeKit(Number(process.argv[3] ?? 80), Number(process.argv[4] ?? 40))
const host = { snapshot: (): unknown => ({ subagents: [] }), focused: true, notify: (): void => undefined, clearBadge: (): void => undefined, onKey: (): (() => void) => (): void => undefined }
const Page = createDagPanelComponent(() => workflow as never) as (props: unknown) => unknown
const render = (): unknown => { kit.reset(); return Page({ React: kit.React, ui: kit.ui, host, focused: true, visible: true }) }

/** Every clickable row element, with the text it draws. */
function clickableRows(tree: unknown): Array<{ text: string; onClick: (event: unknown) => void }> {
  const found: Array<{ text: string; onClick: (event: unknown) => void }> = []
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { for (const child of node) walk(child); return }
    if (typeof node !== "object") return
    const element = node as El
    if (typeof element.props?.onClick === "function") {
      const inline = (value: unknown): string =>
        value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(inline).join("") : ((value as El).children ?? []).map(inline).join("")
      found.push({ text: inline(element.children), onClick: element.props.onClick as (event: unknown) => void })
    }
    walk(element.children)
  }
  walk(tree)
  return found
}

/** Print the drawing rows of a render, with the colour each span carries. */
function show(label: string, tree: unknown): void {
  const paint = kit.paint(tree)
  let line = ""
  let colour: string | undefined
  console.log(`\n=== ${label} ===`)
  for (const span of paint) {
    if (span.colour !== colour || span.text.includes("\n")) {
      if (line !== "") console.log(`  [${String(colour)}] ${line}`)
      line = span.text; colour = span.colour
    } else line += span.text
  }
  if (line !== "") console.log(`  [${String(colour)}] ${line}`)
}

const first = render()
show("RENDER 1 (no pin)", first)
const rows = clickableRows(first)
console.log(`\nclickable rows: ${rows.length}`)
for (const row of rows.slice(0, 30)) console.log(`   ${JSON.stringify(row.text.replace(/\u001b/g, ""))}`)
const target = rows.find((row) => row.text.includes("T3"))
if (target === undefined) { console.log("\nNO CLICKABLE ROW CONTAINS T3"); process.exit(1) }
console.log(`\nCLICKING the row that DRAWS T3: ${JSON.stringify(target.text)}`)
target.onClick({ localRow: 0, localCol: 0 })
show("RENDER 2 (after clicking the row that draws T3)", render())
void dagPageOf
void hitTest
void host.focused
