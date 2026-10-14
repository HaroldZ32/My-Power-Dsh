// LANE A · legend-redundancy — EVIDENCE TOOLING (not shipped code, not part of the test suite).
//
// WHY IT EXISTS. The acceptance artifact for the redundant legend is a FRAME the real host wrote, not a
// helper's return value. This script mounts the real DAG page component with the INSTALLED DSH-TUI
// host's own React, themed components and ink root — the same mount `panel-legend-mount.test.ts` uses —
// and dumps every row the renderer wrote, plus the rows that carry the composed legend.
//
// WHY IT IMPORTS FROM A SCRATCH TREE (`argv[2]`). The page is loaded from a COPY of the package source
// so the SAME harness renders both sides of the change: overwrite only that copy's `src/graph.ts` with
// the pre-fix revision and the frame is the pre-fix frame; leave the post-fix source in place and the
// frame is the post-fix frame. The repository's own `packages/**` is never written by this script.
//
// RUN: bun run frame-capture.ts <scratch-src-dir> <out-file> <columns>
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { writeFileSync } from "node:fs"

/** The scratch tree's `src` directory, whose page and legend functions are the subject. */
const SRC: string = process.argv[2] ?? ""
/** The report file this run writes. */
const OUT: string = process.argv[3] ?? ""
/** The terminal width the frame is laid out for (156 is the width of the shipped reference capture). */
const COLUMNS: number = Number(process.argv[4] ?? "156")
/** The terminal height: past the page's whole content, so no legend row can be scrolled out of frame. */
const ROWS = 120

/**
 * The installed DSH-TUI package root, resolved from the launcher on `PATH`.
 *
 * Resolved rather than hard-coded, exactly as the suite does: a pinned path would keep reporting
 * against a host that is no longer the one being launched.
 * @returns the host package's absolute root directory.
 */
function hostRoot(): string {
  /** The launcher's path on `PATH`, or null when the host is not installed. */
  const launcher = Bun.which("dsh-tui")
  if (launcher === null) throw new Error("dsh-tui is not on PATH: the mounted frame needs the real host")
  /** `<root>/bin/dsh-tui.js`'s real path, with the package manager's symlink resolved. */
  const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
  return dirname(dirname(real))
}

/** The installed host package root. */
const HOST = hostRoot()

/** The host's own React, whose hooks and `createElement` the page receives as its kit. */
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
   * @param columns - the width the renderer lays out for.
   * @param rows - the height the renderer lays out for.
   */
  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }
  /**
   * Accept one write, as a stream would.
   * @param chunk - the chunk the renderer wrote.
   * @returns true, so the renderer keeps writing.
   */
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
}

/**
 * Strip hyperlink and SGR escapes from one chunk, leaving its text.
 * @param value - the raw chunk.
 * @returns the chunk's text.
 */
function stripEscapes(value: string): string {
  return value.replace(/\u001b\][^\u0007]*\u0007/gu, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
}

/**
 * One frame row's own content: the frame borders, the scroll rail and the trailing padding removed.
 * @param row - one row of the rendered frame.
 * @returns the row's text.
 */
function rowContent(row: string): string {
  return stripEscapes(row).replace(/^│/u, "").replace(/│$/u, "").replace(/[█░▌▐]/gu, " ").replace(/\s+$/u, "")
}

/** The team projection the page reads: two tasks and one dependency, so the drawing has an edge. */
function workflowFixture(): Record<string, unknown> {
  return {
    workspace: "/tmp/lane-a-legend-frame",
    team: { id: "team-20261008073554", name: "legend-frame", phase: "active", staged: false, runnable: true, links: 1 },
    members: [],
    tasks: [
      { id: "T1", subject: "root task", kind: "work", status: "completed", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
      { id: "T2", subject: "dependent task", kind: "work", status: "pending", visual: "blocked", dependencies: ["T1"], failedDependencies: [], depth: 1 },
    ],
    counts: { total: 2, completed: 1, inProgress: 0, pending: 1, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/** The scratch tree's page factory, loaded by absolute path so the copy is the subject. */
const panelDag = (await import(join(SRC, "panel-dag.ts"))) as {
  createDagPanelComponent(source: () => unknown, deps: { openFullscreen: () => boolean }): unknown
}

/** The scratch tree's drawing module — its `legendLines` is the half this lane changes. */
const graph = (await import(join(SRC, "graph.ts"))) as { legendLines(cols: number): string[] }

/** The scratch tree's shared core — the composer that owns the state key. */
const core = (await import(join(SRC, "panel-core.ts"))) as {
  legendLinesFor(cols: number, arrowLines: readonly string[]): string[]
  panelContentWidth(measuredColumns: number): number
}

/** The scratch tree's contract tables, so the report names the glyphs the contract declares. */
const theme = (await import(join(SRC, "dag-theme.ts"))) as {
  DAG_STATE_TONES: readonly string[]
  DAG_TONE_GLYPH: Readonly<Record<string, string>>
}

/** The page component under capture. */
const component = panelDag.createDagPanelComponent(workflowFixture, { openFullscreen: () => true })

/** The fake terminal the renderer writes into. */
const stdout = new InkStdout(COLUMNS, ROWS)
/** The host's own root over it. */
const root = await hostInk.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
/** The host's measured geometry, reported exactly as the host reports it to a panel. */
const ui = { Box: hostUi.Box, Text: hostUi.Text, useTerminalSize: () => ({ columns: COLUMNS, rows: ROWS }) }
/** The host API a panel receives; every member the page reads is present. */
const host = {
  snapshot: () => ({ subagents: [] }),
  focused: true,
  visible: true,
  onKey: () => () => {},
  notify: () => {},
  clearBadge: () => {},
}
/** The props a panel component receives: the kit, the host API and the two state flags. */
const pageProps = { React: hostReact, ui, host, focused: true, visible: true }
// THE HOST'S OWN THEME PROVIDER wraps the page, because the themed `Box`/`Text` read that context.
await root.render(hostReact.createElement(hostUi.ThemeProvider, null, hostReact.createElement(component as never, pageProps as never)))
/** The renderer's own commit; 250 ms is far past it. */
await new Promise((resolve) => setTimeout(resolve, 250))

/** The width the page's own rows are budgeted against. */
const contentCols = core.panelContentWidth(COLUMNS)
/** The composed legend at this width, from the scratch tree's own two owners. */
const composed = core.legendLinesFor(contentCols, graph.legendLines(contentCols))
/** The contract's first state entry, read out of the frozen tables rather than re-typed. */
const firstEntry = `${theme.DAG_TONE_GLYPH[theme.DAG_STATE_TONES[0] ?? ""] ?? "?"} ${theme.DAG_STATE_TONES[0]}`
/** Every row the renderer last wrote, normalized; the padding is kept, the frame border is not. */
const rows = stripEscapes(stdout.chunks.at(-1) ?? "").split("\n").map((row) => rowContent(row))

/** The report lines this run writes. */
const report: string[] = []
report.push(`columns=${COLUMNS} rows=${ROWS} contentCols=${contentCols} frameRows=${rows.length}`)
report.push(`composedLegend[${composed.length}]:`)
composed.forEach((line, index) => report.push(`  ${index}|${line}`))
report.push(`drawingLegend[${graph.legendLines(contentCols).length}]:`)
graph.legendLines(contentCols).forEach((line, index) => report.push(`  ${index}|${line}`))
report.push("=== frame, one row per line")
rows.forEach((content, index) => report.push(`  ${index}|${content}`))
/** The frame rows whose content starts with the contract's first state entry. */
const stateRows = rows.map((content, index) => ({ content, index })).filter((row) => row.content.trimStart().startsWith(firstEntry))
report.push(`stateKeyRows[${stateRows.length}] (rows whose content starts with "${firstEntry}")`)
stateRows.forEach((row) => report.push(`  ${row.index}|${row.content}`))
/** The frame rows that carry one of the composed legend lines verbatim. */
const legendRows = rows.map((content, index) => ({ content, index })).filter((row) => composed.includes(row.content))
report.push(`composedLegendRows[${legendRows.length}]`)
legendRows.forEach((row) => report.push(`  ${row.index}|${row.content}`))

writeFileSync(OUT, report.join("\n") + "\n", "utf8")
root.unmount()
console.log(`wrote ${OUT}: ${rows.length} frame rows, ${stateRows.length} state-key rows, ${legendRows.length} composed-legend rows`)
