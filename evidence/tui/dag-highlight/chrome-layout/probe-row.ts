// A HEADLESS LAYOUT PROBE for the panel chrome row.
//
// WHY IT EXISTS: a prop-recording React double can prove that an element with a click handler was
// created; it cannot prove the element occupies a CELL. This probe renders real trees with the
// INSTALLED host's own ink (the host vendors it under `lib/types/ink/**`), writes into a fake stdout
// and prints the frame, so "is the glyph on the row, at which column" is MEASURED rather than assumed.
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"

/** The installed host package root, resolved from the launcher on PATH. */
const HOST = process.env.MPD_PROBE_HOST ?? "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-harness-tui/dsh-tui"
/** A resolver anchored inside the host, so `react` resolves to the instance the host's ink uses. */
const requireHost = createRequire(HOST + "/lib/types/ui.js")

/** A stdout double: a TTY-shaped stream that keeps every chunk it was written. */
class FakeStdout extends EventEmitter {
  columns: number
  rows: number
  chunks: string[] = []
  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }
  /** Accept one write; returns true as a stream would. */
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
  /** The last frame, with ANSI escapes stripped for reading. */
  frame(): string {
    const raw = this.chunks.join("")
    return raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
  }
}

/** The host's React, ink root, Box and Text, loaded from the host's own tree. */
const React = requireHost("react")
const inkRoot = await import(HOST + "/lib/types/ink/root.js")
const Box = (await import(HOST + "/lib/types/ink/components/Box.js")).default
const Text = (await import(HOST + "/lib/types/ink/components/Text.js")).default

/** Render one tree at one width and return the frame text. */
async function frameOf(build: () => unknown, columns: number, rows = 12): Promise<string> {
  const stdout = new FakeStdout(columns, rows)
  const root = await inkRoot.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
  root.render(build())
  await new Promise((resolve) => setTimeout(resolve, 60))
  const frame = stdout.frame()
  root.unmount()
  return frame
}

/** The kit the page components expect: the HOST's own React and host components. */
const ui = { Box, Text, useTerminalSize: () => ({ columns: 28, rows: 12 }) }
const kitReact = React

// ── candidate rows ──────────────────────────────────────────────────────────
/** A: the row this wave ships today (grow-title + shrink-0 control, width 100%). */
const rowA = (): unknown => React.createElement(Box, { key: "frame", flexDirection: "column", width: "100%", height: "100%", borderStyle: "single", borderText: { content: "MPD DAG", position: "top", align: "start" } },
  React.createElement(Box, { key: "title", flexDirection: "row", width: "100%", flexShrink: 0 },
    React.createElement(Box, { key: "t", flexGrow: 1, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { key: "tt" }, "MPD DAG")),
    React.createElement(Box, { key: "f", flexShrink: 0, marginLeft: 1 }, React.createElement(Text, { key: "g" }, "⤢"))),
  React.createElement(Text, { key: "body", dimColor: true }, "body"))

/** B: space-between, no explicit width on the row. */
const rowB = (): unknown => React.createElement(Box, { key: "frame", flexDirection: "column", width: "100%", height: "100%", borderStyle: "single", borderText: { content: "MPD DAG", position: "top", align: "start" } },
  React.createElement(Box, { key: "title", flexDirection: "row", justifyContent: "space-between" },
    React.createElement(Text, { key: "t", color: "gray" }, "MPD DAG"),
    React.createElement(Text, { key: "g", bold: true }, "⤢")),
  React.createElement(Text, { key: "body", dimColor: true }, "body"))

/** C: space-between with the control inside a Box (the clickable shape). */
const rowC = (): unknown => React.createElement(Box, { key: "frame", flexDirection: "column", width: "100%", height: "100%", borderStyle: "single", borderText: { content: "MPD DAG", position: "top", align: "start" } },
  React.createElement(Box, { key: "title", flexDirection: "row", justifyContent: "space-between" },
    React.createElement(Text, { key: "t", color: "gray" }, "MPD DAG"),
    React.createElement(Box, { key: "f", onClick: () => {} }, React.createElement(Text, { key: "g", bold: true }, "⤢"))),
  React.createElement(Text, { key: "body", dimColor: true }, "body"))

/** D: the shipped row WITHOUT `width: "100%"`. */
const rowD = (): unknown => React.createElement(Box, { key: "frame", flexDirection: "column", width: "100%", height: "100%", borderStyle: "single", borderText: { content: "MPD DAG", position: "top", align: "start" } },
  React.createElement(Box, { key: "title", flexDirection: "row", flexShrink: 0 },
    React.createElement(Box, { key: "t", flexGrow: 1, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { key: "tt" }, "MPD DAG")),
    React.createElement(Box, { key: "f", flexShrink: 0, marginLeft: 1 }, React.createElement(Text, { key: "g" }, "⤢"))),
  React.createElement(Text, { key: "body", dimColor: true }, "body"))

/** Print one labelled frame, with the glyph's column marked. */
async function show(label: string, build: () => unknown, columns: number): Promise<void> {
  const frame = await frameOf(build, columns)
  const lines = frame.split("\n")
  console.log(`\n── ${label} (${columns} cols) ──────────────────────────`)
  for (const line of lines) console.log(JSON.stringify(line))
  const titleLine = lines.find((line) => line.includes("MPD DAG") && line.includes("│"))
  console.log(`   glyph on the title row: ${titleLine !== undefined && titleLine.includes("⤢")}`)
}

for (const build of [rowA, rowB, rowC, rowD]) {
  await show((build as { name?: string }).name ?? "row", build, 28)
}
console.log("\nkit react === host react:", kitReact !== undefined && ui.Box !== undefined)
