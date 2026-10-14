/**
 * MEASUREMENT 3 — THE DRAWN TERMINAL BOX, captured from a real render.
 *
 * The contract's honest bound says a constant LABEL width does not by itself prove the terminal BOX's
 * border never moves, because the box is laid out by the panel. This script CLOSES that bound rather
 * than restating it: it mounts the SHIPPED DAG panel component with the INSTALLED host's own React and
 * ink renderer (the same mount the package's own mounted-instance suite performs), forces each frame of
 * the animation in turn, and captures the RENDERED FRAME — every row, borders included.
 *
 * The three claims it measures on the real frame:
 *   B1. every row's CELL WIDTH is identical at every phase, so the frame's right edge never moves;
 *   B2. the ONLY difference between two phases' frames is a SINGLE CELL, and the character in it is a
 *       running frame — i.e. the animation changed the mark and nothing else;
 *   B3. the frames really did differ during capture (the animation ran, it was not a static render).
 *
 * THE ONE STAND-IN, DECLARED: the host seam `ui.useAnimationTime` is supplied by THIS harness (a
 * controllable clock) because the package's own test kit omits it. Everything else is the product: the
 * panel component, the drawing, the glyph substitution, `useRunningPhase` and the ink renderer are all
 * the shipped code paths. The clock only decides WHICH phase is drawn, which is exactly what a host's
 * timer does.
 */
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { writeFileSync } from "node:fs"

/** The repository root, resolved from this script's own location (evidence/.../harness). */
const ROOT = resolve(import.meta.dir, "../../../../..")
/**
 * The package source under measurement.
 *
 * `VERIFY_SRC` exists for the NEGATIVE CONTROL: the same harness is pointed at a one-literal mutant of
 * the tree (the PRE-FIX orbit, whose frames are 1/2/1/3 cells) and must then REPORT THE DEFECT. A
 * harness that cannot fail proves nothing when it passes.
 */
const SRC = process.env["VERIFY_SRC"] ?? join(ROOT, "packages/mpd-tui-plugin/src")
/** Whether this run is the control, so the verdict line says which subject it judged. */
const NEGATIVE_CONTROL = process.env["VERIFY_SRC"] !== undefined && process.env["VERIFY_SRC"] !== ""

/** The shipped DAG panel factory. */
const dag: Record<string, any> = await import(join(SRC, "panel-dag.ts"))
/** The frozen contract tables. */
const theme: Record<string, any> = await import(join(SRC, "dag-theme.ts"))
/** The package's own cell-width primitive. */
const san: Record<string, any> = await import(join(SRC, "sanitize.ts"))

/** The launched host package's root, resolved exactly as the package's own suite resolves it. */
function hostRoot(): string {
  /** The launcher on PATH, or null when the host is not installed. */
  const launcher = Bun.which("dsh-tui")
  if (launcher === null) throw new Error("dsh-tui is not on PATH: the drawn-frame measurement needs the real host")
  /** The launcher's real path, with the package manager's symlink resolved. */
  const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
  return dirname(dirname(real))
}

/** The installed host package root. */
const HOST = hostRoot()
/** The host's own React. */
const hostReact = createRequire(join(HOST, "lib", "types", "ui.js"))("react") as Record<string, any>
/** The host's themed components. */
const hostUi = (await import(join(HOST, "lib", "types", "ui.js"))) as Record<string, any>
/** The host's ink root. */
const hostInk = (await import(join(HOST, "lib", "types", "ink", "root.js"))) as { createRoot(options: Record<string, unknown>): Promise<{ render(node: unknown): unknown; unmount(): void }> }

/** A TTY-shaped stdout double that keeps every chunk the renderer wrote, in order. */
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
   * @param chunk - the text the renderer wrote.
   * @returns always true.
   */
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
}

/** Strip hyperlink and SGR escapes, leaving text. */
function stripEscapes(value: string): string {
  return value.replace(/\u001b\][^\u0007]*\u0007/gu, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
}

/** The terminal geometry: the suites' own reference width, tall enough that nothing scrolls away. */
const COLUMNS = 60
/** The rows the fake terminal reports. */
const ROWS = 120

/** The team projection the DAG page reads: a six-task chain with one failed and one RUNNING node. */
function workflowFixture(): unknown {
  return {
    workspace: "/tmp/mpd-legend-and-animation-verify",
    team: { id: "team-20261008120000", name: "verify-animation", phase: "active", staged: false, runnable: true, links: 0 },
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
    problems: [],
    holds: [],
  }
}

/** The clock the harness's `useAnimationTime` stand-in reports; the phase is derived from it. */
let CLOCK = 0
/** How many renders the clock stand-in has forced (proves the render loop is live). */
let TICKS = 0

/**
 * The host seam the panel asks for its animation clock — the ONE stand-in this harness supplies.
 * @param intervalMs - the tick the panel asks for, or null to pause the loop.
 * @returns the harness clock's value, or null while paused.
 */
function useAnimationTime(intervalMs: number | null): number | null {
  /** A state cell whose update is the stand-in's whole re-render mechanism. */
  const cell = hostReact.useState(0) as [number, (next: number) => void]
  hostReact.useEffect(() => {
    if (intervalMs === null) return undefined
    const timer = setInterval(() => {
      TICKS += 1
      cell[1]((previous: number) => previous + 1)
    }, 25)
    return () => clearInterval(timer)
  }, [intervalMs])
  return intervalMs === null ? null : CLOCK
}

/** The fake terminal the renderer writes into. */
const stdout = new InkStdout(COLUMNS, ROWS)
/** The host's own root over it. */
const root = await hostInk.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
/** The host kit the page receives; `useAnimationTime` is the harness's declared stand-in. */
const ui = { Box: hostUi.Box, Text: hostUi.Text, useTerminalSize: () => ({ columns: COLUMNS, rows: ROWS }), useAnimationTime }
/** The host API a panel receives. */
const host = { snapshot: () => ({ subagents: [] }), focused: true, visible: true, onKey: () => () => {}, notify: () => {}, clearBadge: () => {} }
/** The props a panel component receives. */
const pageProps = { React: hostReact, ui, host, focused: true, visible: true }

/** The mounted DAG page over the fixture. */
const page = dag.createDagPanelComponent(() => workflowFixture(), { openFullscreen: () => true })
await root.render(hostReact.createElement(hostUi.ThemeProvider, null, hostReact.createElement(page as never, pageProps as never)))
await new Promise((done) => setTimeout(done, 400))

/**
 * Read the most recent COMPLETE frame out of the renderer's writes.
 *
 * The renderer diffs its output, so the newest write can be a partial update; a full frame is
 * recognized by carrying the legend row (which every complete frame contains) and at least ten rows.
 * @returns the frame's rows, plus whether the newest write was itself complete.
 */
function capture(): { rows: string[]; lastWriteWasComplete: boolean } {
  /** Every chunk, newest first. */
  const newestFirst = [...stdout.chunks].reverse()
  /** The most recent chunk that looks like a whole frame. */
  const complete = newestFirst.find((chunk) => stripEscapes(chunk).split("\n").length >= 10 && stripEscapes(chunk).includes("completed"))
  if (complete === undefined) throw new Error("no complete frame found in the renderer's writes")
  return { rows: stripEscapes(complete).split("\n"), lastWriteWasComplete: complete === newestFirst[0] }
}

/** The frame count of the cycle, read from the contract. */
const CYCLE: number = theme.DAG_ANIM.frames
/** The phases captured: two full cycles. */
const PHASES = Array.from({ length: CYCLE * 2 }, (_, index) => index)

console.log("=".repeat(100))
console.log(`MEASUREMENT 3 — the DRAWN terminal box, captured from a real render (NEGATIVE CONTROL=${NEGATIVE_CONTROL})`)
console.log("=".repeat(100))
console.log(`subject source tree         = ${SRC}`)
console.log(`host                        = ${HOST}`)
console.log(`columns/rows                = ${COLUMNS}/${ROWS}`)
console.log(`DAG_ANIM.runningFrames      = ${JSON.stringify(theme.DAG_ANIM.runningFrames)}`)
console.log(`DAG_ANIM.intervalMs         = ${theme.DAG_ANIM.intervalMs}`)
console.log("")

/** One captured frame: the phase forced, and the rows the renderer drew. */
interface Captured {
  /** The animation phase the harness clock forced. */
  phase: number
  /** The frame's rows, escapes stripped. */
  rows: string[]
  /** Whether the newest renderer write was already a complete frame. */
  lastWriteWasComplete: boolean
  /** The renderer's total write count when this frame was read. */
  writes: number
}

/** Every captured phase, in capture order. */
const captured: Captured[] = []
for (const phase of PHASES) {
  // Force the phase, then let the stand-in clock's interval re-render the page at that phase.
  CLOCK = phase * theme.DAG_ANIM.intervalMs
  await new Promise((done) => setTimeout(done, 200))
  /** The frame read back for this phase. */
  const shot = capture()
  captured.push({ phase, rows: shot.rows, lastWriteWasComplete: shot.lastWriteWasComplete, writes: stdout.chunks.length })
  console.log(`phase ${phase}: captured ${shot.rows.length} rows after ${stdout.chunks.length} renderer writes (newest write complete=${shot.lastWriteWasComplete})`)
}
console.log("")

/** The legend row of a frame: the row carrying the state key's FIRST entry, read from the contract. */
function legendRowIndex(rows: readonly string[]): number {
  return rows.findIndex((row) => row.includes(`${theme.DAG_TONE_GLYPH.completed} completed`))
}
/** The box-drawing characters, so the node box's own right border column can be located exactly. */
const BOX_CHAR = /[\u2500-\u257F]/u
/**
 * The column of the node box's OWN right border: the first box character AFTER the running mark.
 * @param row - the drawn row carrying the running mark.
 * @param frame - the mark drawn on that row.
 * @returns the border's column index, or -1 when the row has none.
 */
function nodeBorderColumn(row: string, frame: string): number {
  /** The row's characters. */
  const chars = [...row]
  /** Where the animated mark sits. */
  const mark = chars.indexOf(frame)
  if (mark < 0) return -1
  for (let col = mark + 1; col < chars.length; col += 1) if (BOX_CHAR.test(chars[col]!)) return col
  return -1
}
/** The running frames, as the contract declares them. */
const FRAMES: string[] = [...theme.DAG_ANIM.runningFrames]
/**
 * The rows carrying a running mark that are NOT the legend — the running node's own drawn rows.
 * @param rows - a frame's rows.
 * @returns the indices of the node rows carrying a running frame.
 */
function runningNodeRows(rows: readonly string[]): number[] {
  /** The legend's own row index, excluded so the key's `◐ running` entry is not mistaken for a node. */
  const legend = legendRowIndex(rows)
  const out: number[] = []
  for (const [index, row] of rows.entries()) {
    if (index === legend) continue
    if (FRAMES.some((frame) => row.includes(frame))) out.push(index)
  }
  return out
}

// ── the raw frame, verbatim, at the phase the node was drawn in ─────────────────────────────────────
console.log("-".repeat(100))
console.log("THE RAW FRAME at phase 0 (the running node's rows marked with '>>')")
console.log("-".repeat(100))
/** The phase-0 frame, printed verbatim so the drawn box is visible in this artifact. */
const first = captured[0]!
/** The node rows of the phase-0 frame. */
const nodeRows0 = runningNodeRows(first.rows)
for (const [index, row] of first.rows.entries()) {
  console.log(`${nodeRows0.includes(index) ? ">>" : "  "} [${String(index).padStart(2)}] ${JSON.stringify(row)}`)
}
console.log("")

/** The failures, so the exit code is the run's verdict. */
const failures: string[] = []
/**
 * Record one judged condition.
 * @param name - the condition being judged.
 * @param ok - whether it held.
 * @param detail - the evidence, printed either way.
 */
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(name)
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`)
}

// ── B0 — the capture itself is sound ───────────────────────────────────────────────────────────────
console.log("-".repeat(100))
console.log("B0 — THE CAPTURE IS SOUND (a frame was really drawn, at every phase)")
console.log("-".repeat(100))
console.log(`row counts per phase   = ${JSON.stringify(captured.map((shot) => shot.rows.length))}`)
console.log(`renderer writes        = ${JSON.stringify(captured.map((shot) => shot.writes))}`)
console.log(`stand-in clock ticks   = ${TICKS}`)
check(
  "B0 every phase produced a frame of the SAME row count",
  new Set(captured.map((shot) => shot.rows.length)).size === 1,
  `row counts = ${JSON.stringify([...new Set(captured.map((shot) => shot.rows.length))])}`,
)
check(
  "B0 the running node was drawn (a node row carrying a frame exists at every phase)",
  captured.every((shot) => runningNodeRows(shot.rows).length > 0),
  `node rows per phase = ${JSON.stringify(captured.map((shot) => runningNodeRows(shot.rows)))}`,
)
check(
  "B0 the stand-in clock's render loop really ran (the page re-rendered during capture)",
  TICKS > CYCLE,
  `ticks=${TICKS} > cycles=${CYCLE}`,
)

// ── B1 — every row's cell width is identical at every phase: the right edge never moves ────────────
console.log("-".repeat(100))
console.log("B1 — THE BORDER NEVER MOVES: every row's cell width is identical at every phase")
console.log("-".repeat(100))
/** Each phase's per-row cell widths, trailing whitespace trimmed so the DRAWING's width is measured. */
const rowWidths: number[][] = captured.map((shot) => shot.rows.map((row) => san.cellWidth(row.replace(/\s+$/u, ""))))
console.log("phase | per-row drawn widths (trailing blanks trimmed)")
for (const [index, shot] of captured.entries()) console.log(`${String(shot.phase).padStart(5)} | ${JSON.stringify(rowWidths[index])}`)
/** The first phase's width vector, the baseline every other phase must equal. */
const baselineWidths = rowWidths[0]!
check(
  "B1 the drawn width vector is IDENTICAL at every phase (the frame's right edge never moves)",
  rowWidths.every((widths) => JSON.stringify(widths) === JSON.stringify(baselineWidths)),
  `distinct width vectors = ${new Set(rowWidths.map((widths) => JSON.stringify(widths))).size}`,
)

/** The running node's own rows, as drawn at each phase. */
const nodeRowTexts: string[][] = captured.map((shot) => runningNodeRows(shot.rows).map((index) => shot.rows[index]!))
console.log("")
console.log("the running node's own drawn row(s) at each phase:")
for (const [index, shot] of captured.entries()) console.log(`  phase ${shot.phase}: ${JSON.stringify(nodeRowTexts[index])}`)
check(
  "B1 the running node's DRAWN ROW has the same cell width at every phase",
  new Set(nodeRowTexts.map((rows) => JSON.stringify(rows.map((row) => san.cellWidth(row.replace(/\s+$/u, "")))))).size === 1,
  `node row widths = ${JSON.stringify(nodeRowTexts.map((rows) => rows.map((row) => san.cellWidth(row.replace(/\s+$/u, "")))))}`,
)
check(
  "B1 the BOX AROUND the running node is byte-identical apart from the mark (same characters, same positions)",
  new Set(nodeRowTexts.map((rows) => JSON.stringify(rows.map((row) => [...row].map((char) => (FRAMES.includes(char) ? "<FRAME>" : char)).join(""))))).size === 1,
  `box-with-frames-masked per phase = ${JSON.stringify([...new Set(nodeRowTexts.map((rows) => rows.map((row) => [...row].map((char) => (FRAMES.includes(char) ? "<FRAME>" : char)).join(""))))])}`,
)

console.log("")
console.log("THE RUNNING NODE'S BOX — the right border's COLUMN, per phase (the literal user-visible claim)")
console.log("")
console.log("phase | drawn node row (verbatim) | mark column | node box right-border column | panel right-border column")
/** The node row index, the row the running mark is drawn on, resolved once from the capture. */
const nodeRow: number = runningNodeRows(first.rows)[0] ?? -1
console.log(`the running node is drawn at frame row ${nodeRow}; rows ${nodeRow - 1}..${nodeRow + 1} are its box`)
for (const [index, shot] of captured.entries()) {
  /** The drawn row carrying the mark at this phase. */
  const row = shot.rows[nodeRow] ?? ""
  /** The mark this phase drew. */
  const frame = FRAMES.find((candidate) => row.includes(candidate)) ?? ""
  console.log(`${String(shot.phase).padStart(5)} | ${JSON.stringify(row)} | ${String([...row].indexOf(frame)).padStart(11)} | ${String(nodeBorderColumn(row, frame)).padStart(28)} | ${String([...row].length - 2).padStart(25)}`)
}
/** The mark column at each phase. */
const markColumns = captured.map((shot) => [...(shot.rows[nodeRow] ?? "")].indexOf(FRAMES.find((candidate) => (shot.rows[nodeRow] ?? "").includes(candidate)) ?? ""))
/** The node box's own right-border column at each phase. */
const borderColumns = captured.map((shot) => nodeBorderColumn(shot.rows[nodeRow] ?? "", FRAMES.find((candidate) => (shot.rows[nodeRow] ?? "").includes(candidate)) ?? ""))
/** The box top row's closing corner column at each phase. */
const topCornerColumns = captured.map((shot) => [...(shot.rows[nodeRow - 1] ?? "")].findIndex((char) => char === "╮" || char === "┐"))
/** The box bottom row's closing corner column at each phase. */
const bottomCornerColumns = captured.map((shot) => [...(shot.rows[nodeRow + 1] ?? "")].findIndex((char) => char === "╯" || char === "┘"))
console.log("")
console.log(`mark column per phase          = ${JSON.stringify(markColumns)}`)
console.log(`node box right-border column   = ${JSON.stringify(borderColumns)}`)
console.log(`node box top corner column     = ${JSON.stringify(topCornerColumns)}`)
console.log(`node box bottom corner column  = ${JSON.stringify(bottomCornerColumns)}`)
check(
  "B1 the ANIMATED MARK sits in the SAME COLUMN at every phase",
  new Set(markColumns).size === 1,
  `mark columns = ${JSON.stringify(markColumns)}`,
)
check(
  "B1 the NODE BOX's right border is the SAME COLUMN at every phase (it never advances or retreats)",
  new Set(borderColumns).size === 1 && borderColumns[0] !== -1,
  `border columns = ${JSON.stringify(borderColumns)}`,
)
check(
  "B1 the NODE BOX's top and bottom corners are the SAME COLUMN at every phase",
  new Set(topCornerColumns).size === 1 && new Set(bottomCornerColumns).size === 1,
  `top = ${JSON.stringify(topCornerColumns)} bottom = ${JSON.stringify(bottomCornerColumns)}`,
)

// ── B2 — the only difference between phases is ONE CELL, and it is the running mark ────────────────
console.log("-".repeat(100))
console.log("B2 — THE ONLY MOVING THING IS THE MARK: exactly ONE CELL differs between phases")
console.log("-".repeat(100))
/** The phase-0 rows, the frame every other phase is compared against. */
const baselineRows = first.rows
for (const shot of captured) {
  /** Every (row, column) position where this phase's frame differs from phase 0's. */
  const diffs: Array<{ row: number; col: number; from: string; to: string }> = []
  for (const [rowIndex, row] of shot.rows.entries()) {
    /** The same row at the baseline. */
    const before = baselineRows[rowIndex] ?? ""
    /** The row's characters, so a multi-unit character cannot shift the comparison. */
    const now = [...row]
    /** The baseline row's characters. */
    const then = [...before]
    if (now.length !== then.length) {
      diffs.push({ row: rowIndex, col: -1, from: `length ${then.length}`, to: `length ${now.length}` })
      continue
    }
    for (const [col, char] of now.entries()) {
      if (char !== then[col]) diffs.push({ row: rowIndex, col, from: then[col]!, to: char })
    }
  }
  console.log(`  phase ${shot.phase}: ${diffs.length} differing cell(s) ${JSON.stringify(diffs)}`)
  // THE COMPARISON IS BY SLOT, NOT BY ABSOLUTE PHASE. Slot 0 draws the contract's static frame, so a
  // phase that lands on slot 0 (0, 4, 8 …) is EXPECTED to be byte-identical to the baseline; every other
  // slot must differ in exactly one cell, and that cell must carry a frame of the running orbit.
  /** The phase's slot within the cycle: slot 0 is the static frame the baseline captured. */
  const slot = shot.phase % CYCLE
  check(
    `B2 phase ${shot.phase} (slot ${slot}): ${slot === 0 ? "the static slot is byte-identical to the baseline (a zero diff is correct)" : "EXACTLY ONE cell differs, and it is a running mark"}`,
    slot === 0 ? diffs.length === 0 : diffs.length === 1 && FRAMES.includes(diffs[0]!.to!),
    `diffs = ${JSON.stringify(diffs)}`,
  )
  if (slot !== 0) {
    check(
      `B2 phase ${shot.phase}: the changed cell is the NODE's own mark column (row ${nodeRow}, col ${markColumns[0]})`,
      diffs.length === 1 && diffs[0]!.row === nodeRow && diffs[0]!.col === markColumns[0],
      `diff = ${JSON.stringify(diffs[0] ?? null)} vs node row ${nodeRow} col ${markColumns[0]}`,
    )
  }
}

// ── B3 — the animation really ran: the marks drawn were not always the same ────────────────────────
console.log("-".repeat(100))
console.log("B3 — THE ANIMATION RAN: the mark drawn changed across the captured phases")
console.log("-".repeat(100))
/** The distinct node-row marks drawn across the capture. */
const drawnMarks = [...new Set(nodeRowTexts.flat().flatMap((row) => [...row].filter((char) => FRAMES.includes(char))))]
console.log(`distinct marks drawn on the node row across the capture = ${JSON.stringify(drawnMarks)}`)
check(
  "B3 the node row really ANIMATED during capture (more than one distinct mark drawn)",
  drawnMarks.length > 1,
  `distinct marks = ${JSON.stringify(drawnMarks)}`,
)
check(
  "B3 every mark drawn is a frame of the contract's orbit",
  drawnMarks.every((mark) => FRAMES.includes(mark)),
  `marks = ${JSON.stringify(drawnMarks)} vs orbit = ${JSON.stringify(FRAMES)}`,
)

// ── the artifact ───────────────────────────────────────────────────────────────────────────────────
writeFileSync(join(import.meta.dir, "03-frames-raw.json"), `${JSON.stringify(captured.map((shot) => ({ phase: shot.phase, rows: shot.rows, nodeRows: runningNodeRows(shot.rows), widths: rowWidths[captured.indexOf(shot)] })), null, 2)}\n`)
root.unmount()

console.log("")
console.log("=".repeat(100))
console.log(`MEASUREMENT 3 VERDICT (${NEGATIVE_CONTROL ? "NEGATIVE CONTROL — the defect MUST be reported" : "REAL SUBJECT"}): ${failures.length === 0 ? "PASS — the drawn box was measured and the border never moved" : `${failures.length} check(s) FAILED`}`)
console.log("=".repeat(100))
if (failures.length > 0) {
  console.log("FAILED CHECKS:")
  for (const failure of failures) console.log(`  - ${failure}`)
}
process.exit(failures.length === 0 ? 0 : 1)
