#!/usr/bin/env bun
// PTY DAG CAPTURE — the real-terminal half of the `dag-edges-scroll` wave's verification (clauses
// T1-T9 and C1-C4 of `evidence/dag/dag-edges-scroll/requirements.md`).
//
// WHO WROTE THIS AND WHY NOT A NEW HARNESS. This is the VERIFIER's driver, modelled line-for-line on the
// pattern the previous wave already trusted — `evidence/tui/dag-port/verification/pty/width-panel-capture.ts`
// — which drives the REPO'S OWN lifecycle helper `skills/dsh-qa/scripts/lib/tui-lane.ts` `runTuiSession`
// instead of a private tmux wrapper. So every capture below is produced by the exact machinery the shipped
// `tui-panels` / `tui-mount` cases use: a private tmux socket, `capture-pane -p -J`, sandbox DSH_HOME,
// sandbox HOME, and a SANDBOXED WORKSPACE (`ws/`) that is also the session's cwd.
//
// WHAT IT PROVES THAT A UNIT TEST CANNOT. A test can call `dagPanelLayout` and read a string; only a real
// terminal proves the HOST painted it — the sidebar split, the panel bar, the natural-width drawing, both
// scrollbar gutters, and a horizontal pan that actually MOVES the drawing under a real keystroke.
//
// WHY THE SAME BOARD IS DRIVEN AT THREE WIDTHS. Clause T1 makes the drawing size itself from its own
// content while the viewport stays whatever the host allotted, so the THREE regimes are different product
// surfaces, not three samples of one: at a wide terminal the drawing fits, at a narrow one it does not and
// the horizontal gutter + panning are the only way to reach the right-hand nodes. A capture at one width
// would leave one of those regimes unobserved.
//
// ISOLATION (dsh-qa hard rule 1, all THREE parts): `--sandbox-root` is explicit and never defaults into the
// repository's own `.mpd` state; the boot's DSH_HOME and HOME are inside it; the session's cwd is the
// sandbox `ws/`. The driver then re-reads the session store to assert no real-workspace key appeared.
//
// Usage:
//   bun <this-file> --sandbox-root <root> --widths 100,140,220 --out <dir>
//   bun <this-file> --self-test
// Output -> <out>/w<cols>/*.pane.txt + <out>/w<cols>/tui-pane.log + <out>/summary.json
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseSandboxArgs, runTuiSession, type TuiStep } from "../../../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"
import { assertSessionsSandboxed } from "../../../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { CHINESE_SUBJECTS, FIXTURE_TASKS, seedBoard } from "./seed-board.ts"

/** Where the captures land when the caller names no `--out`. */
const OUT_ROOT = join(import.meta.dir, "pty-run")

/** The three regimes clause T1 separates. The value is the tmux PANE width, in columns. */
const DEFAULT_WIDTHS = "100,140,220"

/** How long the first boot may take before the chat screen must have painted. */
const BOOT_WAIT_MS = 120_000

/** The keyed MPD status line; its presence proves the pane reached a real chat screen, not a splash. */
const STATUS_LINE: RegExp = /mpd:\s+(?:team|团队)/

/** Every glyph a DAG DRAWING is made of: box rules, block cells, geometry and the three state marks. */
const DRAWING_GLYPH: RegExp = /[\u2500-\u257f\u2580-\u259f\u25a0-\u25ff\u2298\u2713\u2717]/

/**
 * The BOX-DRAWING characters alone — `─│┌┐└┘├┤┬┴┼╭╮╰╯` and their siblings.
 *
 * This is the narrower set the clause C1 assertion is made over, and the choice is deliberate: it names
 * every glyph a node BOX or an EDGE RUN is built from, so a row matching it is either a box border, a box's
 * content row or an edge run — exactly the three things the clause forbids CJK in. The legend and the
 * footer use the wider geometry/dingbat marks (`▼ ▶ ✓`), which a terminal also paints for other purposes,
 * so they are REPORTED separately rather than folded into the assertion.
 */
const BOX_RULE: RegExp = /[\u2500-\u257f]/

/** A node box's vertical border — two of them on a row mean the row is INSIDE a box. */
const BOX_BORDER: RegExp = /[│┃]/g

/** The scrollbar cells (`DAG_CHROME.barFull` / `barEmpty`), shared by BOTH gutters by construction. */
const BAR_CELL: RegExp = /[\u2588\u2591]/

/** A Chinese/full-width codepoint, exactly the ranges clause C1 forbids inside the drawing. */
const CJK: RegExp = /[\u2e80-\u2fff\u3000-\u303f\u3040-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/

/** The rounded corners clause T7 requires on a node box, and the square ones it replaces. */
const ROUND_CORNER: RegExp = /[\u256d\u256e\u2570\u256f]/

/**
 * The DAG panel's OWN frame title, which anchors the CJK scan to our drawing.
 *
 * Read off the baseline capture (`┌MPD DAG──…`), which is the page descriptor `{ id: "dag", label: "DAG" }`
 * the host frames for the sidebar. A capture that loses this anchor reports `dagPanelLocated: false` rather
 * than silently scanning the host's neighbouring panels instead.
 */
const DAG_TITLE: RegExp = /MPD[\s\u2500-\u257f]*DAG/i

/**
 * The mark that OPENS the pinned detail body inside the panel: `DAG_CHROME.pinMarker` (`◆`) in column 1.
 *
 * It is the boundary between clause C1's scope and clause C3's, and it is read off the pane rather than
 * assumed from a row count because the detail's own length depends on the pinned task.
 */
const DETAIL_MARK: RegExp = /[\u2502\s]\u25c6\s|^\s*\u25c6\s|[\u2502\s](?:subject|description)\s/

/** The `▼` head clause T7 requires, whose tip must touch the dependent's top border. */
const HEAD_DOWN = "\u25bc"

/** One width's verdict, every field read out of the panes that width really painted. */
export interface WidthVerdict {
  /** The tmux pane width in columns this verdict describes. */
  readonly cols: number
  /** True when the boot pane carried the keyed MPD status line. */
  readonly chatRendered: boolean
  /** True when any driven frame carried a sidebar split (a divider column with content to its right). */
  readonly splitPresent: boolean
  /** True when a frame carried the DAG panel's own frame title, i.e. the scan had a subject at all. */
  readonly dagPanelLocated: boolean
  /** True when the `/mpd dag` frame's own answer named the DAG page as opened. */
  readonly dagCommandOpened: boolean
  /** Every distinct panel-bar (tab strip) line the host painted, so the live enable list is legible. */
  readonly panelBars: readonly string[]
  /** True when the DAG page's badge/header was painted at all. */
  readonly graphHeaderSeen: boolean
  /** True when a rounded node-box corner (`╭╮╰╯`) was painted. */
  readonly roundedBoxSeen: boolean
  /** True when the tallest CLOSED box used the rounded corners T7 requires, false for the square form. */
  readonly boxRound: boolean
  /** True when a `▼` arrow head was painted. */
  readonly arrowHeadSeen: boolean
  /** True when the vertical scrollbar column (`█`/`░`) was painted in the panel body. */
  readonly verticalGutterSeen: boolean
  /** True when a horizontal scrollbar ROW (`█`/`░`) was painted below the drawing. */
  readonly horizontalGutterSeen: boolean
  /** True when a focused task's marker (`▶`) was painted. */
  readonly focusMarkerSeen: boolean
  /** The tallest node box the panel drew: `5` is the roomy termaid form, `3` the compressed fallback. */
  readonly boxRowsSeen: number
  /** True when the panel fell back to a rail/list rather than drawing boxes (clause T9's narrow ladder). */
  readonly railRendered: boolean
  /** The rows of the drawing frame that are NOT part of the box/edge drawing — the legend and the chrome. */
  readonly staticRows: readonly string[]
  /** R8: true when the non-drawing rows are byte-identical on the first and last panned frames. */
  readonly panStatic: boolean
  /** The drawing's own left-edge signature per pan step, so a pan that did not move is visible as `==`. */
  readonly panSignatures: readonly { readonly step: string; readonly signature: string }[]
  /** True when the drawing really MOVED between the first and the last rightward pan step. */
  readonly panMoved: boolean
  /** Every box/edge row that carried a CJK character — clause C1 requires this to be EMPTY. */
  readonly cjkInDrawing: readonly string[]
  /** The pinned detail body's rows that carry CJK — clause C3's own evidence, kept apart from C1. */
  readonly cjkInDetail: readonly string[]
  /** Every OTHER sidebar row carrying CJK, reported so the reader can see what the clause exempts. */
  readonly cjkOutsideDrawing: readonly string[]
  /** The Chinese fixture subjects found verbatim in a NON-box/edge row — clause C3's positive half. */
  readonly chineseSubjectsInDetail: readonly string[]
  /** The Chinese fixture subjects found inside a box/edge row — a clause C1 violation when non-empty. */
  readonly chineseSubjectsInBox: readonly string[]
  /** True when the pane carried the host's too-narrow notice instead of a panel body. */
  readonly tooNarrow: boolean
  /** Lifecycle failures `runTuiSession` reported for this width, verbatim. */
  readonly failures: readonly string[]
}

/**
 * Count the terminal cells in one pane line, CJK-aware.
 *
 * `String.length` would count a 12-character Chinese row as 12 cells while a terminal draws 24, which is
 * the exact shear this capture exists to measure, so width is read the way the terminal reads it.
 * @param line - one line of pane text, already ANSI-free.
 * @returns the line's display width in cells.
 */
export function cells(line: string): number {
  /** The running cell count. */
  let total = 0
  for (const char of line) {
    /** The codepoint of the current character. */
    const cp = char.codePointAt(0) ?? 0
    if (cp < 0x20 || cp === 0x7f) continue
    // The same wide ranges the pane classifier uses, so `cells` and `CJK` cannot disagree about which
    // characters a terminal draws twice as wide.
    total += CJK.test(char) ? 2 : 1
  }
  return total
}

/** Pad every row to the pane width, so column arithmetic is not defeated by tmux's trimmed trailing blanks. */
export function padRows(text: string, cols: number): string[] {
  return text.replace(/\n+$/, "").split("\n").map((row) => row + " ".repeat(Math.max(0, cols - cells(row))))
}

/** The sidebar's own anatomy, read out of a captured pane. */
export interface SidebarAnatomy {
  /** The pane column the sidebar's divider sits at, `-1` when the pane carries no split. */
  readonly divider: number
  /** The host's tab strip for the sidebar, trimmed; empty when none was painted. */
  readonly bar: string
  /**
   * The first row of the sidebar's BODY — the row AFTER the host's tab strip, `0` when there is none.
   *
   * The split is load-bearing for the gutter scans: a scrollbar column is all bar cells over the BODY, but
   * the tab strip above it carries letters, so a scan that started at the sidebar's first row would reject
   * every real gutter column on the strip's own text.
   */
  readonly bodyStart: number
  /** The sidebar's rows, divider EXCLUDED, already padded to the pane width. */
  readonly rows: readonly string[]
}

/**
 * Locate the sidebar inside a captured pane.
 *
 * The divider is the column carrying a vertical rule on the most rows; the sidebar is everything right of
 * it. The first non-blank row to the right of the divider that is not itself a rule is the host's panel
 * bar. A pane where nothing sits right of any rule has no split, and the anatomy says so with `divider: -1`.
 * @param text - the pane text exactly as `capture-pane -p -J` printed it.
 * @param cols - the pane width the capture was taken at.
 * @returns the divider column, the panel bar and the sidebar's rows.
 */
export function sidebarAnatomy(text: string, cols: number): SidebarAnatomy {
  /** The pane's rows, padded so every row is exactly `cols` cells wide. */
  const rows = padRows(text, cols)
  /** For each column, how many rows carry a vertical rule in it. */
  const ruleCount: number[] = new Array<number>(cols).fill(0)
  for (const row of rows) {
    const chars = [...row]
    for (let x = 0; x < cols; x += 1) if (chars[x] === "│" || chars[x] === "┃") ruleCount[x] = (ruleCount[x] ?? 0) + 1
  }
  /** The column with the most rules, and how many — a split needs a sustained rule, not one stray cell. */
  let divider = -1
  let best = 0
  for (let x = 0; x < cols; x += 1) {
    /** This column's rule count. */
    const count = ruleCount[x] ?? 0
    if (count > best) { best = count; divider = x }
  }
  // A rule on fewer than three rows is a coincidence (a box edge), not a sidebar divider.
  if (best < 3) return { divider: -1, bar: "", bodyStart: 0, rows: [] }
  /** The sidebar's rows: everything strictly right of the divider column. */
  const body = rows.map((row) => [...row].slice(divider + 1).join(""))
  /** The first row of the sidebar that carries content that is not a rule or a block cell. */
  const barAt = body.findIndex((row) => row.trim().length > 0 && !/^[\s─│┃]+$/.test(row))
  return { divider, bar: (body[barAt] ?? "").trim(), bodyStart: barAt + 1, rows: body }
}

/**
 * The rows of a pane that belong to the DAG DRAWING.
 *
 * Clause C1 names the drawing's parts — node box text, node row text, edge glyphs, legend lines — and
 * every one of them is painted with a glyph from {@link DRAWING_GLYPH}. A row carrying such a glyph is
 * therefore a drawing row by the contract's OWN definition, and the assertion this driver makes is that no
 * such row carries a CJK character. Chrome rows (key hints, the header's facts line) use `·`/`↑`/`⇧`, none
 * of which is in the set, so they are correctly excluded rather than silently excused.
 * @param rows - the sidebar's rows.
 * @returns the drawing rows, verbatim.
 */
export function drawingRows(rows: readonly string[]): string[] {
  return rows.filter((row) => DRAWING_GLYPH.test(row))
}

/**
 * The signature of a drawing's HORIZONTAL placement: the left edge of its ink on each drawing row.
 *
 * A pan that moved the drawing changes this string; a pan that did nothing leaves it identical. It is
 * deliberately independent of any scroll offset the plugin might report, because the claim under test is
 * about the DRAWING, not about a number.
 * @param rows - the sidebar's rows for one frame.
 * @returns a comma-joined list of ink offsets, one per drawing row.
 */
export function panSignature(rows: readonly string[]): string {
  return drawingRows(rows)
    .map((row) => {
      /** The first cell of the row that carries ink. */
      const ink = [...row].findIndex((char) => char !== " ")
      return ink < 0 ? "-" : String(ink)
    })
    .join(",")
}

/**
 * Find the horizontal scrollbar row, if the surface painted one.
 *
 * Both gutters share `DAG_CHROME.barFull`/`barEmpty` by construction (clause T4: two gutters, one
 * position), so the horizontal one is a row that is ALL bar cells and whose ink sits BELOW the lowest box
 * rule. The header's progress bar is excluded by position rather than by shape, because a shape test cannot
 * tell the two apart and a position test can.
 * @param rows - the sidebar's rows.
 * @returns the index of the horizontal gutter row, or `-1`.
 */
export function horizontalGutterRow(rows: readonly string[]): number {
  /** The last row carrying a box rule, i.e. the bottom of the drawing. */
  let lastRule = -1
  for (let i = 0; i < rows.length; i += 1) if (/[\u2500\u250c\u2510\u2514\u2518\u256d\u256e\u256f\u2570]/.test(rows[i] ?? "")) lastRule = i
  for (let i = lastRule + 1; i < rows.length; i += 1) {
    /** The row under inspection, with its trailing padding removed. */
    const row = rows[i] ?? ""
    /** Its non-space cells. */
    const ink = [...row].filter((char) => char !== " ")
    if (ink.length < 8) continue
    if (ink.every((char) => BAR_CELL.test(char))) return i
  }
  return -1
}

/**
 * Classify one width's frames into the verdict the report carries.
 *
 * Everything is read out of the panes; nothing is inferred from the source, so a surface that never painted
 * the DAG reports `false` here rather than inheriting an assumption from the implementation.
 * @param cols - the pane width this width was driven at.
 * @param bootPane - the capture taken once the chat screen was up.
 * @param frames - every driven capture of this width, by step name.
 * @param failures - the lifecycle failures `runTuiSession` reported.
 * @returns the verdict.
 */
export function classifyWidth(
  cols: number,
  bootPane: string,
  frames: readonly { readonly name: string; readonly text: string }[],
  failures: readonly string[],
): WidthVerdict {
  // THREE SCOPING RULES, each one paid for by a wrong reading of the first baseline capture:
  //
  //   1. THE SIDEBAR HOLDS SEVERAL PANELS. The host's own panels share the same divider column as ours, so
  //      "the frame with the widest sidebar" picked the host's panel and this driver reported a CJK-free
  //      drawing over a pane that plainly carried Chinese.
  //   2. THE DAG IS ANCHORED BY ITS OWN FRAME TITLE, not by position. The host's own frames also draw rules
  //      and Chinese chrome; scanning every box/edge row of the sidebar reported the HOST's panel title as
  //      a clause C1 violation of OUR drawing, which it is not.
  //   3. A VIOLATION IN ANY FRAME IS A VIOLATION. The scan is a UNION over the frames, not a reading of one
  //      chosen frame, so a width whose last frame happens to be blank cannot hide an earlier red.
  /** Each frame's sidebar, in drive order. */
  const panels = frames.map((frame) => ({ name: frame.name, ...sidebarAnatomy(frame.text, cols) }))
  /** Every distinct panel bar the host painted, so the live sidebar enable list is legible. */
  const panelBars: string[] = []
  for (const panel of panels) {
    if (panel.divider >= 0 && panel.bar.length > 0 && !panelBars.includes(panel.bar)) panelBars.push(panel.bar)
  }
  /** Each frame's DAG region split into THE DRAWING and THE PINNED DETAIL BODY. */
  const regions = panels.map((panel) => {
    /** This frame's region rows. */
    const rows = dagRegion(panel.rows)
    /** The row the pinned detail body opens on, or `-1` when nothing is pinned in this frame. */
    const at = rows.findIndex((row) => DETAIL_MARK.test(row))
    return { name: panel.name, rows, drawing: at < 0 ? rows : rows.slice(0, at), detail: at < 0 ? [] : rows.slice(at) }
  })
  /** True when at least one frame carried the DAG panel's title, i.e. the scan had a subject at all. */
  const dagPanelLocated = regions.some((region) => region.rows.length > 0)
  /** The DAG region that drew the most box/edge rows; the geometry claims are read off it. */
  const richestRows = regions.reduce((best, region) =>
    drawingRows(region.drawing).length > drawingRows(best).length ? region.drawing : best, [] as readonly string[])
  /** The rows of that region that belong to the DRAWING. */
  const drawing = drawingRows(richestRows)
  /**
   * The region BELOW the panel's title row.
   *
   * The title row is the FRAME's own border (`┌MPD DAG──…┐`) and its horizontal rule crosses the column a
   * scrollbar sits in, so a gutter scan that started at the title row rejected every real gutter column on
   * the frame's own rule.
   */
  const bodyRows = richestRows.slice(1)
  /** De-duplicate preserved-order, so one violation repeated across ten frames is reported once. */
  const unique = (rows: readonly string[]): string[] => rows.filter((row, at) => rows.indexOf(row) === at)
  /** The first `/mpd dag` frame, whose own answer line records how the routed open ended. */
  const opened = frames.find((frame) => frame.name.startsWith("open"))
  /**
   * The pan frames that REALLY drew the DAG, in drive order.
   *
   * A pan can only be measured where the drawing was on screen; a frame showing the host's own panel says
   * nothing about panning and is excluded rather than averaged in.
   */
  const panRegions = regions.filter((region) => region.name.startsWith("pan") && region.drawing.some((row) => BOX_RULE.test(row)))
  /** One signature per such frame, so the pan's own movement reads left-to-right. */
  const panSignatures = panRegions.map((region) => ({ step: region.name, signature: panSignature(region.drawing) }))
  /** The rows R8 pins in place: everything the drawing region holds that is NOT a box/edge row. */
  const staticRows = richestRows.filter((row) => !BOX_RULE.test(row) && row.trim().length > 0)
  /** Every non-box/edge row of one DAG region, which is what R8's comparison is made over. */
  const staticOf = (rows: readonly string[] | undefined): string[] =>
    (rows ?? []).filter((row) => !BOX_RULE.test(row) && row.trim().length > 0)
  /**
   * R8's comparison: the non-drawing rows of the FIRST and LAST pan frames that drew the DAG.
   *
   * The two ends of the PAN drive are compared, deliberately, and not the richest frame against the pan
   * frames: the claim under test is "while the DAG moved sideways, the rows AROUND it did not", so both
   * measurements have to come from frames where the DAG was on screen with the same panel around it.
   */
  const staticAtStart = staticOf(panRegions[0]?.drawing)
  /** The same rows on the LAST DAG-bearing pan frame. */
  const staticAtEnd = staticOf(panRegions[panRegions.length - 1]?.drawing)
  /**
   * The clause C3 lookup: for one subject, is it present in some frame's sidebar, and is the row carrying
   * it a box/edge row of the DAG? The two answers are kept apart on purpose — presence is C3's positive
   * half, and a box/edge row is C1's violation — because one occurrence cannot satisfy both clauses.
   */
  const locateSubject = (subject: string): { readonly found: boolean; readonly inBox: boolean } => {
    /**
     * Set once the subject was seen BELOW the drawing — the pinned detail body's own region.
     *
     * Clause C3 is about the CLICK/ PIN DETAIL, not about "Chinese anywhere on the pane": a subject that
     * only ever appeared inside a node box is the clause C1 violation, and counting it here as well would
     * let the two clauses be satisfied by the same wrong occurrence.
     */
    let found = false
    /** Set once the subject was seen on a row of the DAG region that is part of the BOX/EDGE drawing. */
    let inBox = false
    for (const region of regions) {
      for (const row of region.detail) if (row.includes(subject)) found = true
      for (const row of region.drawing) if (row.includes(subject) && BOX_RULE.test(row)) inBox = true
    }
    return { found, inBox }
  }
  /** Every box/edge row of a DAG region that carries CJK — clause C1 requires this to be EMPTY. */
  // CLAUSE C1 IS SCANNED OVER THE DRAWING ALONE, and the split is not cosmetic: the pinned detail body is
  // rendered INSIDE the panel's own frame, so its rows carry the frame's `│` and a scan that treated every
  // box-rule row as drawing text reported the DETAIL's own Chinese as a drawing violation. Clause C1 names
  // the drawing as "node box text, node row text, edge glyphs, legend lines"; clause C3 REQUIRES the detail
  // body to keep the original subject, so the two halves must be measured apart or they red each other.
  const cjkInDrawing = unique(regions.flatMap((region) => region.drawing.filter((row) => BOX_RULE.test(row) && CJK.test(row))))
  /** Every OTHER sidebar row carrying CJK: the legend, the pinned detail body and the panel's own chrome. */
  const cjkOutsideDrawing = unique(panels.flatMap((panel) =>
    panel.rows.filter((row) => !BOX_RULE.test(row) && row.trim().length > 0 && CJK.test(row))))
  /** The Chinese fixture subjects whose original text survives somewhere on the panel (clause C3). */
  const chineseInDetail = CHINESE_SUBJECTS.filter((subject) => locateSubject(subject).found)
  /** The Chinese fixture subjects appearing INSIDE a box/edge row of the DAG — clause C1 forbids these. */
  const chineseInBox = CHINESE_SUBJECTS.filter((subject) => locateSubject(subject).inBox)
  return {
    cols,
    chatRendered: STATUS_LINE.test(bootPane),
    splitPresent: panels.some((panel) => panel.divider >= 0),
    dagPanelLocated,
    dagCommandOpened: opened !== undefined && /已打开|opened|页面/.test(opened.text),
    panelBars,
    graphHeaderSeen: drawing.length > 0,
    roundedBoxSeen: boxShape(bodyRows).round,
    boxRound: boxShape(bodyRows).round,
    arrowHeadSeen: richestRows.some((row) => row.includes(HEAD_DOWN)),
    verticalGutterSeen: verticalGutterColumn(bodyRows) >= 0,
    horizontalGutterSeen: horizontalGutterRow(bodyRows) >= 0,
    focusMarkerSeen: richestRows.some((row) => row.includes("\u25b6")),
    boxRowsSeen: boxShape(bodyRows).rows,
    railRendered: /view rail|view list/.test(richestRows.join("\n")),
    panSignatures,
    panMoved: panSignatures.length >= 2 && panSignatures[0]?.signature !== panSignatures[panSignatures.length - 1]?.signature,
    staticRows,
    panStatic: panRegions.length >= 2 && staticAtStart.length > 0 && staticAtStart.join("\n") === staticAtEnd.join("\n"),
    cjkInDrawing,
    cjkInDetail: unique(regions.flatMap((region) => region.detail.filter((row) => CJK.test(row)))),
    cjkOutsideDrawing,
    chineseSubjectsInDetail: chineseInDetail,
    chineseSubjectsInBox: chineseInBox,
    tooNarrow: frames.some((frame) => /宽度不足|Too narrow \(needs/.test(frame.text)),
    failures,
  }
}

/**
 * The rows of a sidebar that belong to the DAG panel, anchored on the panel's OWN frame title.
 *
 * Anchoring is what keeps the scan about OUR drawing: the host's panels share the sidebar and draw rules
 * and Chinese chrome of their own, and a scan that started at the sidebar's first row reported the host's
 * `子代理面板` title as a violation of the DAG. The region runs from the title row DOWNWARD, because the
 * panel's body always follows its title.
 * @param rows - the sidebar's rows, divider excluded.
 * @returns the region's rows, or EMPTY when this sidebar carried no DAG panel.
 */
export function dagRegion(rows: readonly string[]): string[] {
  // THE ANCHOR IS THE FRAME'S BORDER ROW, not merely a row carrying the title. The sidebar's TAB STRIP
  // also spells `‹ MPD DAG ›`, so a text-only anchor starts the region one row too high — and that row is
  // what made the panel's own square frame countable as a "node box" on the first baseline reading.
  /** The FRAME BORDER row of the DAG panel, i.e. the row that carries the title AND both top corners. */
  const at = rows.findIndex((row) => DAG_TITLE.test(row) && /[\u250c\u256d]/.test(row) && /[\u2510\u256e]/.test(row))
  return at < 0 ? [] : rows.slice(at)
}

/**
 * The tallest CLOSED node box inside a region: its height, and whether its corners are the rounded set.
 *
 * Clause T7's two forms are 5 rows (roomy, with a padding row above and below the label) and 3 rows
 * (compressed), and the freeze makes the layout REPORT the form — this reads it back off the pane instead,
 * so the record's claim is about the DRAWING rather than about the report.
 *
 * CLOSURE IS REQUIRED, and both halves of that were measured rather than assumed: (a) the panel's own
 * FRAME also opens with a corner and does not close inside a short pane, so a rule that only paired the
 * first `┌` with the next `└` reported a 44-row box on the first baseline capture; (b) because the frame's
 * corners are SQUARE while a node box's are ROUND (`DAG_CHROME.nodeBorder`), the shape claim has to come
 * from a box that actually CLOSED — a bare `squareBoxSeen` scan matched the frame's title row and would
 * have reported the pre-wave square form present in a capture whose node boxes are all rounded.
 * @param rows - the sidebar's rows, or a DAG region's rows.
 * @returns the tallest closed box's row count (borders included) and whether its corners are rounded.
 */
export function boxShape(rows: readonly string[]): { readonly rows: number; readonly round: boolean } {
  /** The tallest closed box found so far. */
  let best: { rows: number; round: boolean } = { rows: 0, round: false }
  for (let i = 0; i < rows.length; i += 1) {
    /** The candidate top border. */
    const top = rows[i] ?? ""
    /** True when this row is a rounded top border. */
    const roundTop = /[\u256d\u256e]/.test(top)
    /** True when this row is a square top border. */
    const squareTop = /[\u250c\u2510]/.test(top)
    if (!roundTop && !squareTop) continue
    for (let j = i + 1; j < Math.min(rows.length, i + 8); j += 1) {
      /** The candidate bottom border. */
      const bottom = rows[j] ?? ""
      /** True when the bottom closes the rounded form. */
      const roundBottom = /[\u2570\u256f]/.test(bottom)
      /** True when the bottom closes the square form. */
      const squareBottom = /[\u2514\u2518]/.test(bottom)
      if ((roundTop && roundBottom) || (squareTop && squareBottom)) {
        if (j - i + 1 > best.rows) best = { rows: j - i + 1, round: roundTop }
        break
      }
      // A row carrying no vertical border means the box was left open: stop rather than keep looking.
      if (!/[\u2502\u2503]/.test(bottom)) break
    }
  }
  return best
}

/**
 * Find the vertical scrollbar column, if the surface painted one.
 *
 * Symmetric to {@link horizontalGutterRow}: a column whose non-space cells are ALL bar cells over at least
 * three rows. Three is the floor because a one- or two-cell run of `█` is far more likely to be a box
 * corner than a gutter.
 * @param rows - the sidebar's rows.
 * @returns the column index, or `-1`.
 */
export function verticalGutterColumn(rows: readonly string[]): number {
  /** The widest row, which bounds the columns to scan. */
  const width = rows.reduce((most, row) => Math.max(most, [...row].length), 0)
  for (let x = 0; x < width; x += 1) {
    /** The non-space cells of this column. */
    const ink: string[] = []
    for (const row of rows) {
      /** The cell at this column. */
      const char = [...row][x]
      if (char !== undefined && char !== " ") ink.push(char)
    }
    if (ink.length >= 3 && ink.every((char) => BAR_CELL.test(char))) return x
  }
  return -1
}

/**
 * The offline control: the classifier, run against fixtures whose answers are known.
 *
 * Without this arm a green matrix would only prove the driver ran. The NEGATIVE fixtures are the load-
 * bearing ones: a drawing row carrying Chinese must be caught, an unmoved pan must report `panMoved: false`,
 * and a header progress bar must NOT be read as a horizontal gutter.
 * @returns nothing; throws when an arm disagrees with its fixture.
 */
export function selfTest(): void {
  /** A pane row padded to a fixed width, the way tmux hands it over. */
  const row = (text: string, to: number = 60): string => text + " ".repeat(Math.max(0, to - cells(text)))
  /** A split sidebar whose DAG page is drawn with rounded boxes, a `▼`, both gutters and an ASCII label. */
  const good = [
    row("❯ mpd: team fixture"),
    row("", 30) + "│ ‹ MPD › ▸ DAG",
    row("", 30) + "│ ┌MPD DAG──────┐",
    row("", 30) + "│ ╭────────╮ █",
    row("", 30) + "│ │ T2 W1 n│ ░",
    row("", 30) + "│ ╰───┬────╯ ░",
    row("", 30) + "│     ▼       ",
    row("", 30) + "│  ████████░░ ",
    row("", 30) + "│ esc/q close ",
  ].join("\n")
  /** The same pane with ONE Chinese character inside a node box — the clause C1 violation. */
  const red = good.replace("T2 W1 n", CHINESE_SUBJECTS[0] ?? "")
  /** A pane whose drawing is identical before and after a "pan". */
  const v = classifyWidth(96, "mpd: team fixture", [{ name: "open", text: good }, { name: "pan1", text: good }, { name: "pan2", text: good }], [])
  if (!v.splitPresent || !v.roundedBoxSeen || !v.arrowHeadSeen || !v.boxRound) throw new Error("self-test: the good fixture was misclassified as box/arrow state")
  if (v.boxRowsSeen !== 3) throw new Error("self-test: the 3-row box was not measured (got " + v.boxRowsSeen + ")")
  if (!v.verticalGutterSeen || !v.horizontalGutterSeen) throw new Error("self-test: a painted gutter pair was not detected")
  if (v.cjkInDrawing.length !== 0) throw new Error("self-test: the ASCII drawing was reported as carrying CJK")
  if (v.panMoved) throw new Error("self-test: an unmoved drawing was reported as panned")
  /** The same classifier over the row that must redden. */
  const bad = classifyWidth(96, "mpd: team fixture", [{ name: "open", text: red }], [])
  if (bad.cjkInDrawing.length === 0) throw new Error("self-test: a Chinese character inside a node box was NOT caught")
  if (bad.chineseSubjectsInBox.length === 0) throw new Error("self-test: a Chinese subject inside a box row was not reported as a C1 violation")
  /** Clause C3: the same Chinese, outside the drawing, must be REPORTED rather than silently accepted. */
  const detail = good.split("\n").concat([row("", 30) + "│ ◆ T2", row("", 30) + "│ subject " + CHINESE_SUBJECTS[0]]).join("\n")
  const withDetail = classifyWidth(96, "mpd: team fixture", [{ name: "pin", text: detail }], [])
  if (withDetail.chineseSubjectsInDetail.length === 0) throw new Error("self-test: the pinned Chinese detail was not found outside the drawing")
  if (withDetail.chineseSubjectsInBox.length !== 0) throw new Error("self-test: a detail row outside the box/edge drawing was misreported as inside it")
  if (withDetail.cjkInDrawing.length !== 0) throw new Error("self-test: an exempted legend/detail row was folded into the box/edge assertion")
  if (CJK.test("AB") || !CJK.test("需求")) throw new Error("self-test: the CJK predicate is not discriminating")
  if (cells("冻结") !== 4 || cells("ab") !== 2) throw new Error("self-test: the cell counter is not CJK-aware")
  /** The width parser must refuse an empty list rather than run a vacuous matrix. */
  if (parseWidths(["--widths", ""]).length !== 0) throw new Error("self-test: an empty width list must parse to empty")
  // The fixture's own claim: T5 has NO printable ASCII run, so clause C4's `#5` fallback is its only label.
  /** The fixture task whose subject is pure Chinese. */
  const pureCjk = FIXTURE_TASKS.find((task) => task.id === "T5")
  if (pureCjk === undefined || /[\x20-\x7e]/.test(pureCjk.subject)) throw new Error("self-test: the fixture has no pure-CJK subject to exercise the #ordinal fallback")
  console.log("self-test PASS (13 arms: box+arrow state, gutter pair, ASCII drawing, unmoved pan, CJK-in-box caught, C1 subject-in-box, C3 detail found, C3 detail not-in-box, legend exemption, CJK predicate, cell width, empty width list, pure-CJK fixture)")
}

/**
 * Parse the width matrix out of a raw argv slice.
 *
 * Both the `--widths v` and `--widths=v` spellings are honoured because the repo's own harness parsers
 * accept both; an unparsable list returns EMPTY so the caller can REFUSE rather than run a matrix that
 * silently captures nothing (`[].every(...)` is true, so an empty matrix would otherwise look green).
 * @param argv - the process argv slice, without the runtime prefix.
 * @returns the pane widths to drive, in drive order.
 */
export function parseWidths(argv: readonly string[]): number[] {
  /** Where the flag sits, whichever spelling was used. */
  const at = argv.findIndex((arg) => arg === "--widths" || arg.startsWith("--widths="))
  /** The flag's own value. */
  const raw = at < 0
    ? DEFAULT_WIDTHS
    : (argv[at] ?? "").includes("=") ? (argv[at] ?? "").slice((argv[at] ?? "").indexOf("=") + 1) : (argv[at + 1] ?? "")
  return raw.split(",").map((token) => Number(token.trim())).filter((value) => Number.isInteger(value) && value > 0)
}

/** One value out of `--flag value`, or a fallback. */
function flag(argv: readonly string[], name: string, fallback: string): string {
  /** Where the flag sits. */
  const at = argv.findIndex((arg) => arg === name || arg.startsWith(name + "="))
  if (at < 0) return fallback
  return (argv[at] ?? "").includes("=") ? (argv[at] ?? "").slice(name.length + 1) : (argv[at + 1] ?? fallback)
}

/**
 * Drive one width and return its verdict, writing every pane this width painted.
 * @param root - the sandbox root.
 * @param cols - the tmux pane width to drive.
 * @param outRoot - the directory the width's own evidence directory is created under.
 * @returns the verdict for this width.
 */
function captureWidth(root: string, cols: number, outRoot: string): WidthVerdict {
  /** This width's evidence directory. */
  const outDir = join(outRoot, "w" + cols)
  mkdirSync(outDir, { recursive: true })
  // THE KEY PLAN. `/mpd dag` is asked FIRST and its own answer line is captured, so a routed open that
  // fell back to a full-screen surface is visible in the evidence rather than inferred. `C-b` then toggles
  // the host's sidebar split TWICE: the pane may or may not already carry the split, and driving it twice
  // means the split is present for every pan step whichever state the boot started in.
  /** The keystroke plan every width is driven with, so the widths differ ONLY in width. */
  const steps: TuiStep[] = [
    // THE DAG PAGE IS RE-ASKED AFTER EVERY SPLIT TOGGLE, and the reason is MEASURED rather than defensive:
    // with the host's sidebar split shut, `C-b` re-opens it on the HOST's default panel (`待办`), not on
    // ours — the first run of this driver captured empty `/mpd dag` frames for exactly that reason. Asking
    // again AFTER the toggle is what puts the DAG page back on screen whichever state the boot started in.
    { name: "open1", keys: ["/mpd dag", "Enter"], waitMs: 9000 },
    { name: "splitA", keys: ["C-b"], waitMs: 6000 },
    { name: "open2", keys: ["/mpd dag", "Enter"], waitMs: 9000 },
    { name: "splitB", keys: ["C-b"], waitMs: 6000 },
    { name: "open3", keys: ["/mpd dag", "Enter"], waitMs: 9000 },
    { name: "pan1", keys: ["S-Right", "S-Right", "S-Right"], waitMs: 3000 },
    { name: "pan2", keys: ["S-Right", "S-Right", "S-Right"], waitMs: 3000 },
    { name: "pan3", keys: ["S-Right", "S-Right", "S-Right"], waitMs: 3000 },
    { name: "panback", keys: ["S-Left", "S-Left", "S-Left", "S-Left", "S-Left", "S-Left", "S-Left", "S-Left", "S-Left"], waitMs: 3000 },
    // The pinned DETAIL body is clause C3's surface: `↑↓` moves focus, `Enter` pins. Four presses are
    // driven so the walk cannot stop on a task whose subject happens to be pure ASCII.
    { name: "pin", keys: ["Down", "Enter"], waitMs: 4000 },
    { name: "pin2", keys: ["Down", "Enter"], waitMs: 4000 },
    { name: "pin3", keys: ["Down", "Enter"], waitMs: 4000 },
    { name: "pin4", keys: ["Down", "Enter"], waitMs: 4000 },
  ]
  /** The full tmux lifecycle of this width, including every pane capture. */
  const session = runTuiSession({ lane: "dag-verify-w" + cols, root, outDir, steps, bootWaitMs: BOOT_WAIT_MS, paneWidth: cols, paneHeight: 50 })
  /** Every frame this width painted, by step name, in drive order. */
  const frames = session.panes.map((pane) => ({ name: pane.name, text: pane.text }))
  return classifyWidth(cols, session.bootPane ?? "", frames, session.failures ?? [])
}

/**
 * Drive the width matrix and write its summary.
 * @param argv - the process argv slice, without the runtime prefix.
 * @returns the process exit code: 0 when every width painted a CJK-free drawing and a moved pan.
 */
function main(argv: readonly string[]): number {
  if (argv.includes("--self-test")) { selfTest(); return 0 }
  // RE-CLASSIFY A SAVED RUN. The panes are the primary artefact and the classifier is a reading of them,
  // so the reading must be re-runnable WITHOUT re-booting a terminal: a classifier that could only be
  // exercised by a three-minute capture would be debugged by guessing.
  if (argv.includes("--classify")) {
    /** The directory a previous run wrote (`<out>/w<cols>/*.pane.txt`). */
    const dir = flag(argv, "--classify", "")
    /** The `w<cols>` directories under it, in ascending width. */
    const widthsFound = readdirSync(dir).filter((entry) => /^w[0-9]+$/.test(entry))
      .map((entry) => ({ entry, cols: Number(entry.slice(1)) })).sort((a, b) => a.cols - b.cols)
    /** One verdict per width directory found. */
    const verdicts: WidthVerdict[] = []
    for (const { entry, cols } of widthsFound) {
      /** That width's evidence directory. */
      const widthDir = join(dir, entry)
      /** Its captures, in the drive order the file names encode. */
      const frames = readdirSync(widthDir).filter((file) => file.endsWith(".pane.txt"))
        .map((file) => ({ name: file.replace(/\.pane\.txt$/, ""), text: readFileSync(join(widthDir, file), "utf8") }))
      verdicts.push(classifyWidth(cols, frames.find((frame) => frame.name === "boot")?.text ?? "", frames, []))
    }
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ root: dir, widths: widthsFound.map((entry) => entry.cols), verdicts }, null, 2) + "\n")
    if (argv.includes("--dump-region")) {
      /** The widths to dump, so the region rows can be read verbatim. */
      for (const { entry, cols } of widthsFound) {
        /** That width's frames. */
        const dir2 = join(dir, entry)
        for (const file of readdirSync(dir2).filter((name) => name.endsWith(".pane.txt"))) {
          /** The frame's pane text. */
          const text = readFileSync(join(dir2, file), "utf8")
          /** Its richest sidebar. */
          const panel = sidebarAnatomy(text, cols)
          /** Its DAG region. */
          const region = dagRegion(panel.rows)
          if (region.length === 0) continue
          console.log("[dag-verify] REGION " + entry + "/" + file + " divider=" + panel.divider + " bodyStart=" + panel.bodyStart)
          for (const row of region) console.log("    |" + row + "|")
        }
      }
      return 0
    }
    for (const verdict of verdicts) {
      console.log("[dag-verify] w" + verdict.cols + " split=" + verdict.splitPresent + " rail=" + verdict.railRendered
        + " boxRows=" + verdict.boxRowsSeen + " round=" + verdict.roundedBoxSeen + " head=" + verdict.arrowHeadSeen
        + " vGut=" + verdict.verticalGutterSeen + " hGut=" + verdict.horizontalGutterSeen
        + " panMoved=" + verdict.panMoved + " panStatic=" + verdict.panStatic
        + " dagPanelLocated=" + verdict.dagPanelLocated
        + " cjkInDrawing=" + verdict.cjkInDrawing.length + " detailKept=" + verdict.chineseSubjectsInDetail.length)
      for (const row of verdict.staticRows) console.log("    STATIC(R8):     " + JSON.stringify(row))
      console.log("    cjkInDetail=" + verdict.cjkInDetail.length + " (clause C3; EXPECTED > 0 when a Chinese task is pinned)")
      for (const row of verdict.cjkInDrawing) console.log("    CJK-IN-DRAWING: " + JSON.stringify(row))
      for (const row of verdict.cjkOutsideDrawing) console.log("    CJK-OUTSIDE:    " + JSON.stringify(row))
    }
    return 0
  }
  /** The sandbox root and any positional arguments the caller added. */
  const { root } = parseSandboxArgs(argv, "dag-verify")
  if (!existsSync(join(root, "dshhome", "profiles", "dsh-tui", "package.json"))) {
    console.error("[dag-verify] no provisioned dsh-tui profile under " + root + " — run `node skills/dsh-qa/scripts/tui-mount.ts --sandbox-root " + root + " --install` first")
    return 1
  }
  /** The widths to drive. */
  const widths = parseWidths(argv)
  if (widths.length === 0) {
    console.error("[dag-verify] FATAL: no width parsed out of " + JSON.stringify(argv) + " — refusing a vacuous matrix")
    return 1
  }
  /** Where the captures land. */
  const outRoot = flag(argv, "--out", OUT_ROOT)
  mkdirSync(outRoot, { recursive: true })
  // THE FIXTURE IS SEEDED BEFORE ANY BOOT, and the team directory was emptied by the seeder, so every
  // width below meets the SAME board — a width-to-width difference cannot be a fixture difference.
  /** The board record this run is judged against. */
  const board = seedBoard(join(root, "ws"))
  console.log("[dag-verify] board seeded at " + board + " (" + FIXTURE_TASKS.length + " tasks)")
  /** One verdict per width, in drive order. */
  const verdicts: WidthVerdict[] = []
  for (const cols of widths) {
    console.log("[dag-verify] capturing " + cols + " cols …")
    /** This width's verdict. */
    const verdict = captureWidth(root, cols, outRoot)
    verdicts.push(verdict)
    console.log("[dag-verify]   chat=" + verdict.chatRendered + " split=" + verdict.splitPresent + " dagOpen=" + verdict.dagCommandOpened
      + " round=" + verdict.roundedBoxSeen + " head=" + verdict.arrowHeadSeen + " vGut=" + verdict.verticalGutterSeen
      + " hGut=" + verdict.horizontalGutterSeen + " pan=" + verdict.panMoved + " cjkInDrawing=" + verdict.cjkInDrawing.length)
  }
  // THE REAL-WORKSPACE ASSERTION. `DSH_HOME` and `HOME` do not isolate workspace state on their own, so the
  // session store is re-read here: a `<DSH_HOME>/sessions/<projectKey(realCwd)>` key would mean the boot
  // wrote the REPOSITORY's own `.mpd` state while this driver claimed isolation.
  /** The isolation verdict for the boot these captures describe. */
  const isolation = assertSessionsSandboxed(join(root, "dshhome"), root, { label: "dag-verify" })
  writeFileSync(join(outRoot, "summary.json"), JSON.stringify({ root, widths, board, isolation, verdicts }, null, 2) + "\n")
  /** True when every width really booted, so an empty matrix cannot report the same PASS as a full one. */
  const captured = verdicts.length === widths.length && verdicts.length > 0
  /** The wave's own claims, each read off the panes rather than off the source. */
  const cjkClean = captured && verdicts.every((verdict) => verdict.cjkInDrawing.length === 0 && verdict.chineseSubjectsInBox.length === 0)
  /** Clause C3's positive half must be observed too, or a drawing with no detail at all would pass. */
  const detailKept = captured && verdicts.every((verdict) => verdict.chineseSubjectsInDetail.length > 0)
  console.log("[dag-verify] captured " + verdicts.length + "/" + widths.length + " widths; isolation=" + isolation.ok + " cjkClean=" + cjkClean + " detailKept=" + detailKept)
  if (!cjkClean) for (const verdict of verdicts) for (const row of verdict.cjkInDrawing) console.error("[dag-verify] CJK IN DRAWING w" + verdict.cols + ": " + JSON.stringify(row))
  return captured && cjkClean ? 0 : 1
}

process.exit(main(process.argv.slice(2)))
