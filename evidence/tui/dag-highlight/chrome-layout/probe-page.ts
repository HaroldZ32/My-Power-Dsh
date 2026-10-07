// THE SAME PROBE, AGAINST THE THREE REAL PAGES.
//
// It renders the plugin's OWN components (`createPanelComponent`, `createDagPanelComponent`,
// `createWorkmatePanelComponent`) with the INSTALLED host's ink and a fake stdout, so the question
// "does the `⤢` control occupy a cell on the title row, and at which column" is answered by a layout
// rather than by a prop record.
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { createPanelComponent } from "../../../../packages/mpd-tui-plugin/src/panel.ts"
import { createDagPanelComponent } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { createWorkmatePanelComponent } from "../../../../packages/mpd-tui-plugin/src/panel-workmate.ts"

/** The installed host package root. */
const HOST = process.env.MPD_PROBE_HOST ?? "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-harness-tui/dsh-tui"
/** A resolver anchored inside the host, so react resolves to the instance its ink uses. */
const requireHost = createRequire(HOST + "/lib/types/ui.js")
/** The host's React; the components are called with THIS instance, exactly as in production. */
const React = requireHost("react")
const inkRoot = await import(HOST + "/lib/types/ink/root.js")
// THE HOST'S OWN THEMED COMPONENTS, exactly the pair the panel adapter hands a plugin (`ui.Box` /
// `ui.Text` from `lib/types/ui.js`). The RAW ink components would be a different pair: ink's `Box` is
// wrapped in `React.memo`, so `typeof ui.Box === "function"` — the check `panelKit` performs on a host
// kit — fails against it and every page renders null. That is a property of THIS probe's harness, not
// of the plugin, and it is why the probe uses the same objects production does.
const uiKit = await import(HOST + "/lib/types/ui.js")
const Box = uiKit.Box
const Text = uiKit.Text
const ThemeProvider = uiKit.ThemeProvider

/** A stdout double: a TTY-shaped stream that keeps every chunk. */
class FakeStdout extends EventEmitter {
  columns: number
  rows: number
  chunks: string[] = []
  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
  frame(): string {
    return this.chunks.join("").replace(/\u001b\][^\u0007]*\u0007/gu, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
  }
}

/** Render one page at one width and return its frame lines. */
async function linesOf(page: (props: unknown) => unknown, columns: number): Promise<string[]> {
  const stdout = new FakeStdout(columns, 14)
  const root = await inkRoot.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
  const ui = { Box, Text, useTerminalSize: () => ({ columns, rows: 14 }) }
  const host = { snapshot: () => ({ subagents: [] }), focused: true, visible: true, onKey: () => () => {} }
  /** The page, inside the host's own theme provider — the context `ui.Box`/`ui.Text` read. */
  const mounted = React.createElement(ThemeProvider, null, React.createElement(page as never, { React, ui, host, focused: true, visible: true }))
  root.render(mounted)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const frame = stdout.frame()
  root.unmount()
  return frame.split("\n")
}

/** Report where the glyph sits on a page's title row. */
async function report(label: string, page: (props: unknown) => unknown, columns: number): Promise<void> {
  const lines = await linesOf(page, columns)
  console.log(`\n── ${label} @ ${columns} columns ─────────────────────`)
  for (const line of lines) console.log(JSON.stringify(line))
  // THE CONTENT ROW, not the frame's top border: the border also carries the title text, and reading it
  // would answer a question nobody asked. A content row is the one that starts with the vertical border.
  const title = lines.find((line) => line.startsWith("│") && line.includes("MPD"))
  const onTitle = title !== undefined && title.includes("⤢")
  const glyphCol = title === undefined ? -1 : [...title].indexOf("⤢")
  /** Where the row's own right border sits, so "at the right edge" is a measurement and not a claim. */
  const rightEdge = title === undefined ? -1 : [...title].length - 1
  console.log(`   title row: ${JSON.stringify(title)}\n   ⤢ ON THE TITLE ROW: ${onTitle} at column ${glyphCol} (row's right edge ${rightEdge})`)
}

for (const columns of [28, 40]) {
  await report("merged MPD", createPanelComponent(() => undefined, { openFullscreen: () => true }) as (props: unknown) => unknown, columns)
  await report("MPD DAG", createDagPanelComponent(() => undefined, { openFullscreen: () => true }) as (props: unknown) => unknown, columns)
  await report("MPD workmate", createWorkmatePanelComponent(() => ({ entries: [], archived: 0, root: "/tmp/home/.mpd/workmate", problems: [] }), { openFullscreen: () => true }) as (props: unknown) => unknown, columns)
}
