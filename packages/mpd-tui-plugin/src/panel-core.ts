// THE SHARED PANEL CORE — the disciplines every MPD sidebar page is built from.
//
// WHY THIS FILE EXISTS. The wave ships THREE independent pages (`panel.ts`, `panel-dag.ts`,
// `panel-workmate.ts`) and each of them must obey the SAME four hard rules. Copying those rules three
// times is how two surfaces begin to disagree about what "defensive" or "one hook call" means, so they
// live here once and every page imports them. The pages keep only what is theirs: what they project
// and how they lay it out.
//
// THE FOUR RULES THIS FILE IMPLEMENTS
//   · SINGLE-REACT. No `import React`, no ink: every hook and element goes through `props.React` /
//     `props.ui`, which the host hands its own instances of. A second React copy under the host's
//     reconciler is the failure this rule exists to prevent.
//   · DEFENSIVE NARROWING. The props arrive as `unknown` and are narrowed HERE: a host build that
//     hands no usable React, no ui kit, or no `host.snapshot` renders `null` instead of crashing the
//     reconciler (the host contains a throw, but the surface is lost). Every member read off the host
//     is feature-detected at its own use site, so a leaner host build degrades rather than throws.
//   · ONE HOOK CALL PER RENDER, IN A FIXED ORDER. `usePanelSize` is the single geometry hook, so the
//     hook order can never move between renders. Every hook this file calls goes through the SAME
//     branch: the props kit was already proved usable, so a number of hook calls is INVARIANT across
//     renders on a given host — that is what makes the early `null` return safe.
//   · SANITIZE BEFORE RENDER. Every string that came from a file or from the host crosses
//     `sanitize.ts` before it reaches a `ui.Text` (`panelText`).
//
// WHAT IT DELIBERATELY DOES NOT DO: NAME A `ctx.tui*` SERVICE. Registration goes through the
// `TuiAdapter` (`packages/mpd-tui-adapter-plugin`), which is the ONE place a DSH-TUI service may be
// named (AGENTS.md §6). The `ui`/`host` members this file reads are ordinary PANEL PROPS — the host's
// own props object — never a service lookup.
//
// WHY `useTheme` IS NOT CALLED. It is the one member of the host's `TuiPanelUi` this file leaves
// alone. A panel's colours are host THEME KEYS (`dag-theme.ts` `DAG_TONE_THEME` → `success`,
// `activity`, …), which the host's own `Text` resolves — that is what `graph.ts` and `scenes.ts`
// already do, and `useTheme()` returns `[name, setter]`, a palette NAME rather than the keys. Calling
// it would spend a hook slot (and a throw surface) for a value no surface here reads.
import { cellWidth, clampCells, collapse, stripControl } from "./sanitize.js"
import {
  DAG_ANIM,
  DAG_CHROME,
  DAG_PANEL_MIN_COLUMNS,
  DAG_STATE_TONES,
  DAG_TONE_GLYPH,
  DAG_TONE_THEME,
  WORKMATE_PANEL_MIN_COLUMNS,
  type DagTone,
} from "./dag-theme.js"

/** The cell budget of one drawn row — the bound the full-screen scenes apply to their own rows. */
export const PANEL_ROW_MAX_CELLS = 4000

/** The measured panel, with the documented fallback applied. */
export interface PanelMeasured {
  /** The column count the page lays itself out for. */
  cols: number
  /** The row count, or `undefined` when the host exposes no measurement at all. */
  rows: number | undefined
}

/** The React surface a panel component uses, as the host's own React must expose it. */
export interface PanelReactLike {
  /** Creates one element; the page never imports React itself. */
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  /** One state cell (the host React's own `useState`). */
  useState(initial: unknown): [unknown, (next: unknown) => void]
  /** One effect (the host React's own `useEffect`). */
  useEffect(effect: () => unknown, deps?: readonly unknown[]): void
  /** The host React's own `useRef`. */
  useRef(initial: unknown): { current: unknown }
}

/** The pieces of the host kit this file requires before a page may render at all. */
interface PanelKitRequired {
  /** The host's column box. */
  Box: unknown
  /** The host's text row. */
  Text: unknown
}

/** The full ui kit a panel component may use, as the host's own `TuiPanelUi` must expose it. */
export interface PanelUiLike extends PanelKitRequired {
  /** The host's scrollable column, when this build exposes it. */
  ScrollBox?: unknown
  /** The host's horizontal rule, when this build exposes it. */
  Divider?: unknown
  /** The host's image block, when this build exposes it. */
  Image?: unknown
  /** The panel-size hook; the ONLY geometry source a panel has. */
  useTerminalSize?(): { columns?: unknown; rows?: unknown }
  /** The panel's only legal timer; absent on a host that offers no animation. */
  useAnimationTime?(intervalMs: number | null): unknown
}

/** The host panel API members this file reads. */
export interface PanelHostLike {
  /** The host's curated read-only snapshot; re-read per render. */
  snapshot?(): unknown
  /** Whether this panel currently holds the keyboard focus. */
  focused?: unknown
  /** Sets this panel's badge; `unread` defaults to 0 on the host side. */
  notify?(level: string, unread?: number): unknown
  /** Clears this panel's badge. */
  clearBadge?(): unknown
  /** Subscribes a key listener; delivered only while the panel is focused. */
  onKey?(listener: (event: unknown) => void): unknown
  /** Pops a transient line in the host's own chrome. */
  toast?(text: string): unknown
}

/** One keyboard event, as the host's `TuiPanelKeyEvent` carries it. */
export interface PanelKeyEventLike {
  /** The raw characters the user typed (Enter arrives as an empty string). */
  input: string
  /** The host's own key flags. */
  key?: Record<string, unknown>
  /** Marks the key CONSUMED, so the host's fallback binding does not also act on it. */
  preventDefault?(): unknown
}

/** The narrow, structural panel props shape every page reads. */
export interface PanelPropsLike {
  /** The host's own React instance. */
  React?: unknown
  /** The host's panel ui kit. */
  ui?: unknown
  /** The host's panel host API. */
  host?: unknown
  /** Whether this page holds the keyboard focus, when the host reports it. */
  focused?: unknown
  /** Whether this page is on screen, when the host reports it. */
  visible?: unknown
}

/** The host kit, once the guard has proved both halves usable. */
export interface PanelKit {
  /** The host's React instance. */
  React: PanelReactLike
  /** The host's ui kit, with the two components the body requires already proved callable. */
  ui: PanelUiLike
}

/**
 * Prove the host handed a usable React instance and ui kit.
 *
 * Returning `undefined` is the ONE early exit a page takes, and it happens before any hook has run —
 * which is why the early `null` render cannot move the hook order.
 * @param React - the props' React field.
 * @param ui - the props' ui field.
 * @returns the two, typed, or undefined when the host kit is unusable.
 */
export function panelKit(React: unknown, ui: unknown): PanelKit | undefined {
  if (React === null || React === undefined || ui === null || ui === undefined) return undefined
  if (typeof (React as { createElement?: unknown }).createElement !== "function") return undefined
  /** The ui kit's own two required components, before anything is drawn with it. */
  const kit = ui as PanelUiLike
  if (typeof kit.Box !== "function" || typeof kit.Text !== "function") return undefined
  // The cast is sound because the members above were proved, and the host hands its own React and ui
  // kit across a JS boundary with no shared type. Every ADDITIONAL field read off them
  // (`ScrollBox`, `Divider`, `useAnimationTime`) is feature-detected at its own use site.
  return { React: React as PanelReactLike, ui: kit }
}

/**
 * Measure the panel through the host's own hook — ONCE per render, so the hook order never moves.
 *
 * The hook is called whenever the kit exposes it, INDEPENDENTLY of the result: a build that reports a
 * useless size still calls the hook, so the number of hook calls cannot depend on what it answered.
 * @param ui - the host ui kit, already proved usable.
 * @param fallbackCols - the width floor this page falls back to when nothing usable is reported.
 * @returns the measured geometry, with the documented fallback applied.
 */
export function usePanelSize(ui: PanelUiLike, fallbackCols: number): PanelMeasured {
  if (typeof ui.useTerminalSize !== "function") return { cols: fallbackCols, rows: undefined }
  try {
    /** The host's own measurement; a throwing hook degrades to the fallback. */
    const size = ui.useTerminalSize()
    /** The reported column count, kept only when it is a usable positive number. */
    const columns = size?.columns
    if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) return { cols: fallbackCols, rows: undefined }
    /** The reported row count, kept only when it is a usable positive number. */
    const rows = size?.rows
    return {
      cols: Math.floor(columns),
      rows: typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : undefined,
    }
  } catch {
    return { cols: fallbackCols, rows: undefined }
  }
}

/**
 * The running-node breathing phase for this render.
 *
 * MANDATORY DEGRADATION (frozen clause R8): a host that exposes no `useAnimationTime`, or one whose
 * timer answers a non-finite value, draws the STATIC frame. The hook is called whenever the kit
 * exposes it — the branch is inside, never around the call — so the hook count stays invariant; the
 * whole read is contained because an animation that throws would lose the entire panel.
 * @param ui - the host ui kit, already proved usable.
 * @param active - whether anything on screen is actually running (pauses the timer when nothing is).
 * @returns the frame index in `0..DAG_ANIM.frames-1`, clamped to the quantised cycle.
 */
export function useRunningPhase(ui: PanelUiLike, active: boolean): number {
  if (typeof ui.useAnimationTime !== "function") return DAG_ANIM.staticPhase
  try {
    // `null` PAUSES the host's own frame loop — the documented contract of the one legal timer — so a
    // page with nothing running costs the host no frames at all.
    const time = ui.useAnimationTime(active ? DAG_ANIM.intervalMs : null)
    if (typeof time !== "number" || !Number.isFinite(time)) return DAG_ANIM.staticPhase
    /** The elapsed ticks, floored so a negative or fractional answer cannot escape the cycle. */
    const tick = Math.floor(Math.max(0, time) / DAG_ANIM.intervalMs)
    return tick % DAG_ANIM.frames
  } catch {
    return DAG_ANIM.staticPhase
  }
}

/**
 * Read the host's curated snapshot through its own API.
 *
 * The whole read is contained: a host build without `snapshot`, or a snapshot that throws, is "no
 * host rows" rather than a lost panel. The value is handed to a projection UNCHANGED — the projections
 * (`subagentSectionRows`) own the field reads, the empty state and the counts.
 * @param host - the panel props' `host` field.
 * @returns the snapshot, or undefined when this host exposes none.
 */
export function panelSnapshot(host: unknown): unknown {
  if (host === null || host === undefined) return undefined
  /** The host API, before its `snapshot` member is trusted. */
  const api = host as { snapshot?: unknown }
  if (typeof api.snapshot !== "function") return undefined
  try {
    // Called AS A METHOD on the host's own object: the documented form, and the one that cannot lose
    // a receiver the implementation may rely on.
    return (api as { snapshot: () => unknown }).snapshot()
  } catch {
    return undefined
  }
}

/**
 * One panel row as renderable text — the render boundary of every page.
 *
 * `stripControl` + `clampCells` (never `collapse`, which would eat the DAG's own indentation), the
 * same pair the full-screen scenes apply to every untrusted row.
 * @param value - the row text.
 * @param maxCells - the cell clamp; defaults to the row budget.
 * @returns the sanitized, clamped row; never throws.
 */
export function panelText(value: string, maxCells: number = PANEL_ROW_MAX_CELLS): string {
  try {
    return clampCells(stripControl(value), maxCells)
  } catch {
    return ""
  }
}

/**
 * One untrusted scalar as one renderable line.
 *
 * `collapse` is right HERE (a one-line field) and wrong for a drawing row: it removes the runs of
 * spaces a layout computes.
 * @param value - the candidate value.
 * @param maxCells - the cell clamp.
 * @returns the sanitized line, or undefined for a missing/non-scalar value.
 */
export function panelField(value: unknown, maxCells: number): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  if (typeof value === "number" && !Number.isFinite(value)) return undefined
  try {
    return clampCells(collapse(stripControl(String(value))), maxCells)
  } catch {
    return undefined
  }
}

/**
 * The host THEME KEY a DAG tone renders in.
 *
 * The mapping is READ from `dag-theme.ts` (frozen, captain-owned) rather than re-typed here, so a tone
 * can never drift from the contract's own table; an unknown tone falls back to the body text key.
 * @param tone - the tone a span carries.
 * @returns the host theme key to pass as `color`.
 */
export function toneColor(tone: string): string {
  /** The contract's own entry for this tone, if it declares one. */
  const key = (DAG_TONE_THEME as Record<string, string | undefined>)[tone]
  return typeof key === "string" && key !== "" ? key : DAG_TONE_THEME.blank
}

/**
 * The props one DAG span's `Text` carries: its tone's theme colour PLUS the non-colour emphasis AC5
 * requires.
 *
 * WHY THE EMPHASIS EXISTS AT ALL (measured): in the host's dark theme the drawing's grey-out is
 * `dim = inactive #8991A0` against `open = subtle #A6ADBA`, two greys that read as one, and `graphRow`
 * passed neither `bold` nor `dimColor` — so a pinned chain and the rest of the board were separated by
 * nothing a reader could see. The rule is one line each and it uses the HOST'S own channels (`bold`, and
 * the `dimColor` flag that resolves to the theme's `inactive`), never a new colour: a `focus` or `chain`
 * span is BOLD, a `dim` span carries `dimColor` ON TOP of its tone colour, and every other tone is drawn
 * exactly as it was.
 * @param tone - the tone a span carries, from `graph.ts`'s own vocabulary.
 * @returns the span's colour plus the emphasis this tone adds.
 */
function spanEmphasis(tone: string): { color: string; bold?: boolean; dimColor?: boolean } {
  /** The tone's own theme colour; the tones stay the drawing's, this only adds a channel to them. */
  const color = toneColor(tone)
  if (tone === "focus" || tone === "chain") return { color, bold: true }
  if (tone === "dim") return { color, dimColor: true }
  return { color }
}

/** The `key` prop every created element carries; React warns without one on a list child. */
export interface ElementKey {
  /** The element's stable key inside its parent's child list. */
  key: string
}

/**
 * One text row, sanitized, in a theme colour.
 *
 * @param kit - the proved host kit.
 * @param text - the row's text, already sanitized by the caller or sanitized here.
 * @param options - the row's key, tone, emphasis and continuation flags.
 * @returns the host `Text` element.
 */
export function textRow(
  kit: PanelKit,
  text: string,
  options: ElementKey & { tone?: string; dim?: boolean; bold?: boolean; maxCells?: number; joinNext?: boolean },
): unknown {
  /** The renderable text: sanitized and clamped to the row's own budget. */
  const shown = panelText(text, options.maxCells ?? PANEL_ROW_MAX_CELLS)
  // A CONTINUATION ROW KEEPS ONE TRAILING SPACE, added AFTER the sanitizer ON PURPOSE: the sanitizer
  // collapses whitespace (correctly — it is what stops an untrusted value being fed a layout row), so
  // the one space a wrapped sentence needs in order to read correctly would be exactly what it eats.
  // The row was wrapped with that cell reserved, so the budget still holds.
  return kit.React.createElement(
    kit.ui.Text,
    {
      key: options.key,
      ...(options.tone === undefined ? {} : { color: toneColor(options.tone) }),
      ...(options.dim === true ? { dimColor: true } : {}),
      ...(options.bold === true ? { bold: true } : {}),
    },
    options.joinNext === true ? `${shown} ` : shown,
  )
}

/**
 * Clamp a row's spans to the cells the panel actually has.
 *
 * DEFENSIVE AGAINST THE DRAWING, not against the host. A drawing module computes its own geometry and
 * is expected to clamp every row itself — but a row that came out wide by one cell (a label written
 * per character while the cursor advanced by CELL, which is what a wide CJK glyph does) would push the
 * host's renderer into wrapping, and a wrapped row breaks the drawing: the box loses its right border
 * and every row below it shifts. Clamping here is the last line of defence, and it is applied to what
 * the drawing produced rather than to the drawing's own grid, so a clamped row is still one row.
 * @param spans - the row's spans, in draw order.
 * @param cols - the cells the row may occupy.
 * @returns the spans, each one inside the budget.
 */
export function clampRowSpans(spans: readonly { text: string; tone: string }[], cols: number): { text: string; tone: string }[] {
  /** The usable width; a nonsense width still has to produce drawable spans. */
  const width = Number.isFinite(cols) ? Math.max(0, Math.floor(cols)) : 0
  if (width <= 0) return []
  /** The kept spans. */
  const kept: { text: string; tone: string }[] = []
  /** The cells used so far. */
  let used = 0
  for (const span of spans) {
    if (used >= width) break
    /** The cells this span may occupy. */
    const room = width - used
    /** This span's own width, measured by the plugin's cell rule. */
    const spanWidth = cellWidth(span.text)
    if (spanWidth <= room) {
      kept.push(span)
      used += spanWidth
      continue
    }
    kept.push({ text: clampCells(span.text, room), tone: span.tone })
    used = width
  }
  return kept
}

/**
 * One laid-out DAG row: its spans, each in its own theme colour, inside ONE outer row element.
 *
 * The spans go through WITHOUT a second cell clamp beyond {@link clampRowSpans}: `graph.ts` already
 * applies `clampCells(stripControl(...))` at layout time, and re-clamping a cell at a time would cut
 * the row's own multi-span geometry twice. The span-level clamp exists for the one-cell overflow a
 * wide glyph can still produce, which would otherwise make the host wrap the row.
 * Each span carries its tone's colour AND that tone's non-colour emphasis ({@link spanEmphasis}, AC5), so
 * a pinned chain is readable without colour at all.
 * @param kit - the proved host kit.
 * @param spans - the row's spans, in draw order.
 * @param options - the row's key, its cell budget and its optional click wiring.
 * @returns the row element (a clickable `Box` when the page wired a pointer handler).
 */
export function graphRow(
  kit: PanelKit,
  spans: readonly { text: string; tone: string }[],
  options: ElementKey & { cols: number; onClick?: (event: unknown) => void },
): unknown {
  /** The row's spans, inside this panel's own cell budget. */
  const fitted = clampRowSpans(spans, options.cols)
  /** One host `Text` per span: each tone keeps its own colour AND its own emphasis inside the single row. */
  const drawn = fitted.map((span, at) => kit.React.createElement(kit.ui.Text, { key: `s${at}`, ...spanEmphasis(span.tone) }, span.text))
  /** The row element itself. */
  const row = kit.React.createElement(kit.ui.Text, { key: `t-${options.key}` }, ...drawn)
  if (options.onClick === undefined || typeof kit.ui.Box !== "function") return row
  // A CLICKABLE ROW IS A BOX. `onClick` on the host's own `Box` receives the host's pointer event, and
  // the handler a page passes is a CLOSURE over the row it was built for — so no coordinate arithmetic
  // can drift from the layout that produced the row on screen.
  return kit.React.createElement(kit.ui.Box, { key: options.key, onClick: options.onClick, flexDirection: "row" }, row)
}

/**
 * The bordered panel frame every page draws inside (frozen clause R6).
 *
 * The border style and colour come from `DAG_CHROME` — the frozen contract — so the frame is one edit
 * there rather than a literal per page. A kit whose `Box` ignores border props simply draws the
 * children, which is the degradation this relies on.
 * @param kit - the proved host kit.
 * @param title - the border title, already sanitized and short enough for the width.
 * @param children - the frame's rows, in draw order.
 * @returns the frame element.
 */
export function panelFrame(kit: PanelKit, title: string, children: readonly unknown[]): unknown {
  return kit.React.createElement(
    kit.ui.Box,
    {
      key: "frame",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      borderStyle: DAG_CHROME.frameBorder,
      borderColor: toneColor("edge"),
      // THE BORDER TITLE IS AN OBJECT, NOT A STRING — measured against the installed host
      // (`lib/types/ink/render-border.js` `renderBorderToOutput`): the title is embedded only when
      // `style.borderText?.position === 'top'`, and a bare string has no `position`, so it takes the
      // plain-border branch and the title is SILENTLY DROPPED. A title-less frame in a sidebar whose native
      // panels all carry one is the "which page am I on?" defect this wave exists to remove, and no
      // "the prop is present" assertion can catch it — the arm for it asserts the SHAPE.
      ...(title === "" ? {} : { borderText: { content: panelText(title, 80), position: "top", align: "start" } }),
    },
    ...children,
  )
}

/**
 * The page body: the rows directly, or the same rows inside the host's own scrolling column.
 *
 * A page builds its rows as a flat `unknown[]` and hands them here, so the ONE call to `ScrollBox`
 * lives in the core rather than in each page, and a kit that never exposes `ScrollBox` draws exactly
 * the same rows without losing anything.
 *
 * `scrollable: true` means THE PAGE OWNS ITS OWN WINDOWING and the host's `ScrollBox` must NOT wrap it:
 * a windowed slice built to fit is a second scroller whose position the page cannot see, and a slice
 * that already fits would scroll inside a box the page believes is static. The pages that pass it drive
 * every position from one number (see {@link usePanelViewport}).
 * @param kit - the proved host kit.
 * @param children - the page's rows, in draw order.
 * @param options - `scrollable` when the page self-windows its body.
 * @returns the body's children as a row list, ready to spread into the page's frame.
 */
export function panelBody(kit: PanelKit, children: readonly unknown[], options: { scrollable?: boolean } = {}): unknown[] {
  if (options.scrollable === true) return [...children]
  if (typeof kit.ui.ScrollBox !== "function") return [...children]
  return [kit.React.createElement(kit.ui.ScrollBox, { key: "body" }, ...children)]
}

/**
 * How many cells a page may DRAW IN, given the width the host reported for its panel.
 *
 * THE FRAME'S BORDER IS INSIDE THAT WIDTH, WHICH IS THE WHOLE POINT (FINDING 11, measured on a real PTY at
 * 120 columns): the host reports the panel COLUMN's width, the page draws a bordered frame across it, and
 * the two border cells come OUT of that width — the captured `‹ MPD DAG ›` pane is 36 cells wide with a
 * 35-cell interior. A page that budgets its rows against the reported width therefore emits rows one cell
 * too wide, the terminal WRAPS them, the continuation line carries no border, and the frame's right edge
 * lands on a different column on exactly those rows. The user reads that as "the box is broken".
 *
 * ONE cell is subtracted for each vertical border the frame draws, so a page's rows are clamped to the
 * interior it actually owns. The floor is one cell: below that there is nothing honest to draw.
 * @param measuredColumns - the width the host reported through `ui.useTerminalSize()`.
 * @returns the interior width, in cells, never below one.
 */
export function panelContentWidth(measuredColumns: number): number {
  /** The reported width, floored; a nonsense value still has to produce a usable budget. */
  const columns = Math.floor(Number.isFinite(measuredColumns) ? measuredColumns : 0)
  // TWO cells for the frame's vertical borders — the left and right edges of `DAG_CHROME.frameBorder`.
  return Math.max(1, columns - 2)
}

/** The rows of chrome a self-windowing page draws OUTSIDE its scrolling window (header + key hints). */
export const PANEL_CHROME_ROWS = 2

/** What one wheel event carries that this plugin acts on: the vertical delta the host reports. */
export interface PanelWheelEvent {
  /** The vertical delta: positive scrolls the content UP (the next rows come into view). */
  deltaY?: unknown
  /** The horizontal delta, read only so a horizontal-only wheel is provably a no-op. */
  deltaX?: unknown
}

/**
 * Clamp a desired scroll offset into the only band that can render.
 *
 * This is the ONE place the band is computed, so no page can render a blank panel by driving the offset
 * past an end: an offset below zero reads as zero, and an offset past the last full page reads as the
 * last full page (`content - viewport`), which is zero when everything fits.
 * @param offset - the desired offset, in rows.
 * @param contentRows - how many rows the page has in total.
 * @param viewportRows - how many rows the panel can show at once.
 * @returns the clamped offset and the band it lives in.
 */
export function clampScroll(offset: number, contentRows: number, viewportRows: number): { offset: number; max: number; overflow: boolean } {
  /** The usable viewport: below one row there is nothing to render, which is treated as one row. */
  const viewport = Math.max(1, Math.floor(Number.isFinite(viewportRows) ? viewportRows : 1))
  /** The content height, floored and never negative. */
  const content = Math.max(0, Math.floor(Number.isFinite(contentRows) ? contentRows : 0))
  /** The furthest offset that still fills the viewport; zero when the content fits. */
  const max = Math.max(0, content - viewport)
  /** The requested offset, floored and made finite before it is clamped. */
  const wanted = Math.floor(Number.isFinite(offset) ? offset : 0)
  return { offset: Math.min(max, Math.max(0, wanted)), max, overflow: max > 0 }
}

/**
 * Apply one wheel event to a scroll offset.
 *
 * The host routes wheel events to `onWheel` handlers by hit test, and the SIGN CONVENTION is the one a
 * terminal reports: `deltaY > 0` is a wheel toward the user, which scrolls the content DOWN (later rows
 * come into view). A board that fits is a NO-OP — an offset that drifted on a page with nothing to
 * scroll would be a bug the user cannot even see, which is the worst kind.
 * @param event - the wheel event, as the host delivered it.
 * @param offset - the current offset.
 * @param contentRows - how many rows the page has in total.
 * @param viewportRows - how many rows the panel can show at once.
 * @returns the clamped next offset.
 */
export function scrollByWheel(event: unknown, offset: number, contentRows: number, viewportRows: number): number {
  /** The band this page is in right now. */
  const band = clampScroll(offset, contentRows, viewportRows)
  if (!band.overflow) return band.offset
  if (event === null || event === undefined || typeof event !== "object") return band.offset
  /** The event, before its delta is trusted. */
  const raw = event as PanelWheelEvent
  // NOT A NUMBER IS NOT A GESTURE: a host that reports no delta, or a non-numeric one, must leave the
  // offset exactly where it was rather than snapping the page to the top.
  if (typeof raw.deltaY !== "number" || !Number.isFinite(raw.deltaY)) return band.offset
  return clampScroll(band.offset + raw.deltaY, contentRows, viewportRows).offset
}

/**
 * Apply one HORIZONTAL wheel event to a column offset.
 *
 * The same discipline as {@link scrollByWheel}, on the axis the user's trackpad names `deltaX`: a page
 * that fits is a no-op, a non-numeric delta is not a gesture, and the result is clamped into the band
 * `clampScroll` computes from the drawing's own width. The two functions exist separately because the
 * DELTA they read is the axis (reading `deltaY` here would make a vertical wheel pan the picture
 * sideways, which is precisely the T4 defect in a different costume).
 * @param event - the wheel event, as the host delivered it.
 * @param offset - the current column offset.
 * @param contentCols - how many columns the drawing has in total.
 * @param viewportCols - how many columns the window shows at once.
 * @returns the clamped next column offset.
 */
export function scrollByWheelX(event: unknown, offset: number, contentCols: number, viewportCols: number): number {
  /** The band this drawing is in right now. */
  const band = clampScroll(offset, contentCols, viewportCols)
  if (!band.overflow) return band.offset
  if (event === null || event === undefined || typeof event !== "object") return band.offset
  /** The event, before its delta is trusted. */
  const raw = event as PanelWheelEvent
  if (typeof raw.deltaX !== "number" || !Number.isFinite(raw.deltaX)) return band.offset
  return clampScroll(band.offset + raw.deltaX, contentCols, viewportCols).offset
}

/**
 * The scrollbar gutter's cells, one per viewport row.
 *
 * THE HOST'S OWN SEMANTICS (`components/ScrollbarGutter`), because a panel cannot use its component:
 * the thumb shows POSITION *and* SIZE — its length is `viewport² / content`, so a nearly-fitting page
 * shows a long thumb and a huge page a short one — and it is positioned by `offset / (content −
 * viewport)`. The gutter is PERMANENT while the content overflows and absent entirely when it fits: the
 * host's own reason is that an auto-hiding gutter would rewrap every row the moment it appeared.
 * @param offset - the current (already clamped) offset.
 * @param contentRows - how many rows the page has in total.
 * @param viewportRows - how many rows the panel can show at once.
 * @returns one string per viewport row; empty when everything fits, so NO column is reserved.
 */export function gutterCells(offset: number, contentRows: number, viewportRows: number): string[] {
  /** The band this page is in right now. */
  const band = clampScroll(offset, contentRows, viewportRows)
  if (!band.overflow) return []
  /** The rendered viewport height, which is the number of gutter cells. */
  const viewport = Math.min(Math.max(1, Math.floor(viewportRows)), contentRows)
  /** The thumb's own length: the fraction of the content the viewport shows, at least one cell. */
  const thumb = Math.min(viewport, Math.max(1, Math.floor((viewport * viewport) / contentRows)))
  /** The band the thumb's TOP can occupy; zero when the thumb fills the gutter. */
  const travel = viewport - thumb
  /** How far down that band the thumb sits, from the offset's own fraction of the scrollable range. */
  const top = travel === 0 ? 0 : Math.round((band.offset / band.max) * travel)
  /** One cell per row: the thumb where it sits, the track everywhere else. */
  const cells: string[] = []
  for (let row = 0; row < viewport; row += 1) cells.push(row >= top && row < top + thumb ? DAG_CHROME.barFull : DAG_CHROME.barEmpty)
  return cells
}

/**
 * What one scroll gesture asks a page to do, on either axis.
 *
 * The four VERTICAL members are the ones {@link panelScrollKey} has always answered; the four `col*`
 * members are the second axis's, and they are named as their own members rather than folded into a
 * `{ axis, delta }` pair so a page's `switch` cannot silently fall through to the wrong axis when a
 * key is added.
 */
export type PanelScrollGesture = "top" | "bottom" | "pageUp" | "pageDown" | "colPageUp" | "colPageDown" | "colUp" | "colDown" | "colLeft" | "colRight"

/**
 * The HORIZONTAL gutter's cells: the same rail transposed into ONE row.
 *
 * THE ARITHMETIC IS `clampScroll`'S OWN, deliberately — the second axis must not have a second band
 * definition (clause T4). Three numbers in, three numbers out: `cols` is called `offset`,
 * `viewportCols` is called `contentRows` and `viewportRows` alike, and the thumb comes back the length
 * and at the position the vertical rail would have drawn. A caller that re-derived the band here would
 * be one edit away from a thumb that disagrees with the window it claims to describe.
 *
 * WHY IT IS DRAWN AT ALL (R8): the horizontal window belongs to the DAG DRAWING. The rail is what
 * tells a reader that the picture continues past the edge, and it is drawn directly BENEATH the
 * drawing rather than beneath the page, because every other row of the page is at its full width.
 * @param colOffset - the current (already clamped) column offset.
 * @param contentCols - how many columns the drawing has in total.
 * @param viewportCols - how many columns the window shows at once.
 * @returns the rail as one string of `viewportCols` cells; empty when the drawing fits.
 */
export function gutterCellsX(colOffset: number, contentCols: number, viewportCols: number): string {
  /** The window's width, floored; a window of no cells has no rail to draw. */
  const viewport = Math.max(1, Math.floor(Number.isFinite(viewportCols) ? viewportCols : 1))
  /** The band, from the ONE definition: the viewport width IS this axis's "content" length. */
  const band = clampScroll(colOffset, contentCols, viewport)
  if (!band.overflow) return ""
  /** The cells the rail shows, capped at the drawing's own length. */
  const span = Math.min(viewport, Math.max(1, Math.floor(Number.isFinite(contentCols) ? contentCols : 1)))
  /** The thumb's length: the fraction of the drawing the window shows, at least one cell. */
  const thumb = Math.min(span, Math.max(1, Math.floor((span * span) / Math.max(1, Math.floor(contentCols)))))
  /** The band the thumb's LEFT edge can occupy; zero when the thumb fills the rail. */
  const travel = span - thumb
  /** How far along that band the thumb sits, from the offset's own fraction of the range. */
  const left = travel === 0 ? 0 : Math.round((band.offset / band.max) * travel)
  /** One cell per column: the thumb where it sits, the track everywhere else. */
  let rail = ""
  for (let col = 0; col < span; col += 1) rail += col >= left && col < left + thumb ? DAG_CHROME.barFull : DAG_CHROME.barEmpty
  return rail
}

/**
 * The scroll gesture a key press asks for, when it asks for one.
 *
 * ONE ANSWERS THE WHOLE KEY MAP, both axes, because the two must not be able to disagree about which
 * key belongs to whom: `←/→` with Shift is the horizontal scroll, `↑/↓` with Shift is the vertical one,
 * `PgUp`/`PgDn` page vertically and their Shift forms horizontally, and `Home`/`End` are the vertical
 * ends. {@link panelScrollKey} keeps its old, vertical-only contract by filtering this one, so a page
 * that never opts into the second axis keeps exactly the behaviour it had.
 * @param event - the narrowed host key event, or undefined for a value that was not a key event.
 * @returns the gesture, or undefined when the key is not a scroll gesture.
 */
export function panelScrollGesture(event: unknown): PanelScrollGesture | undefined {
  if (event === null || event === undefined || typeof event !== "object") return undefined
  /** The event, before its members are trusted. */
  const raw = event as { input?: unknown; key?: unknown }
  /** The host's key flags, when this event carried any. */
  const flags = (raw.key !== null && raw.key !== undefined && typeof raw.key === "object" ? raw.key : {}) as Record<string, unknown>
  /** The typed characters, which are the fallback for a host that reports an escape sequence as text. */
  const input = typeof raw.input === "string" ? raw.input : ""
  /** Whether a modifier that changes a key's meaning was held. */
  const ctrl = flags.ctrl === true
  /** Whether the SHIFT modifier was held, which is what makes an arrow mean "scroll" rather than "move". */
  const shift = flags.shift === true
  // THE FLAG NAMES ARE THE HOST'S OWN. Its `SidePanelKeyFlags` carries `pageUp`/`pageDown`/`home`/`end`
  // for the arrow-less keys, and the ink generation underneath spells Enter as `return_`; `input` is
  // read only as the escape-sequence fallback, so a host that reports neither still answers `Home`.
  if (flags.pageUp === true || input === "\u001b[5~") return shift ? "colPageUp" : "pageUp"
  if (flags.pageDown === true || input === "\u001b[6~") return shift ? "colPageDown" : "pageDown"
  if (flags.home === true || (ctrl && input === "a")) return "top"
  if (flags.end === true || (ctrl && input === "e")) return "bottom"
  // THE ARROWS CARRY TWO MEANINGS AND SHIFT IS THE SWITCH (the scene's own convention, clause T5).
  // Without Shift they stay UNANSWERED on purpose: a page that moves a task focus with them must keep
  // them, and the `dag` panel's `←/→` are the host's own panel navigation.
  if (!shift) return undefined
  if (flags.upArrow === true || input === "K") return "colUp"
  if (flags.downArrow === true || input === "J") return "colDown"
  if (flags.leftArrow === true || input === "H") return "colLeft"
  if (flags.rightArrow === true || input === "L") return "colRight"
  return undefined
}

/**
 * The scroll gesture a key press asks for, when it asks for one.
 *
 * THE VERTICAL-ONLY CONTRACT, kept for every caller that never opted into the second axis. Only the
 * keys that are UNAMBIGUOUSLY viewport-only are handled: a page that also moves a TASK focus
 * with `↑↓`/`jk` must keep them (see `panel-dag.ts`, where focus movement auto-scrolls so the focused
 * node cannot leave the screen), so this function deliberately does not answer them. The keys it does
 * answer — `PgUp`, `PgDn`, `Home`, `End` — have no other meaning inside a panel.
 *
 * It is a FILTER over {@link panelScrollGesture} rather than a second key map, so the two can never
 * disagree about what `PgDn` means; the horizontal members are the ones it drops.
 * @param event - the narrowed host key event, or undefined for a value that was not a key event.
 * @returns the gesture, or undefined when the key is not a vertical scroll gesture.
 */
export function panelScrollKey(event: unknown): "top" | "bottom" | "pageUp" | "pageDown" | undefined {
  /** What the one key map answered. */
  const gesture = panelScrollGesture(event)
  if (gesture === "top" || gesture === "bottom" || gesture === "pageUp" || gesture === "pageDown") return gesture
  return undefined
}

/**
 * One viewport's render-time facts and handlers, from a single state cell.
 *
 * `offset` is the ONLY position this page has. The host's `ScrollBox` is deliberately NOT used on a
 * self-windowing page: its `ref` is stripped from the panel kit, so a page cannot read its position, and
 * a gutter drawn from a position it cannot read would be a confident lie.
 */
export interface PanelViewport {
  /** The number of rows the page has in total, chrome included. */
  contentRows: number
  /** The number of rows the panel can show at once. */
  viewportRows: number
  /** The clamped offset, in rows. */
  offset: number
  /** The furthest offset that still fills the viewport; zero when everything fits. */
  max: number
  /** Whether anything overflows (and therefore whether the gutter column is reserved). */
  overflow: boolean
  /** Moves the offset by a delta, clamped into the band. */
  scrollTo(next: number): void
  /** Moves the offset by a relative amount, clamped into the band. */
  scrollBy(delta: number): void
  /**
   * The HORIZONTAL offset, in cells — the second axis, on the SAME handle.
   *
   * ON THE SAME HANDLE BY DESIGN (frozen clause T4): "a second scroller whose position the page cannot
   * see" is exactly what a second `usePanelViewport` would be, so both axes are committed through the
   * same `commit` and clamped through the same `clampScroll`. A page reads `colOffset` and draws its
   * window from it; nothing else may hold a column position.
   */
  readonly colOffset: number
  /** The furthest column offset that still fills the window; zero when the drawing fits. */
  readonly colMax: number
  /** Whether the drawing is wider than the window, and therefore whether the horizontal rail is drawn. */
  readonly colOverflow: boolean
  /** Moves the column offset to an absolute position, clamped into the band. */
  scrollToCol(next: number): void
  /** Moves the column offset by a relative amount, clamped into the band. */
  scrollColBy(delta: number): void
  /** The `onWheel` handler for a row that pans HORIZONTALLY (`deltaX`); `deltaY` is `onWheel`'s. */
  onWheelX(event: unknown): void
  /** The `onWheel` handler a scrollable row carries. */
  onWheel(event: unknown): void
  /**
   * Bind this render's MEASURED heights and return the SAME handle.
   *
   * The pages call it after they have built their rows, because the content height is a property of the
   * rows and the rows are a property of the render. It returns the handle rather than a copy so that the
   * page, its wheel closure and its key closure all address ONE object whose getters read the latest
   * numbers — a page that copied the handle would reintroduce exactly the staleness this exists to kill.
   * @param contentRows - the page's own row count for this render.
   * @param viewportRows - the rows the panel can show, when the page measured them; omitted keeps the
   *   previous height, so a page that only knows its content height still gets a correct band.
   * @returns the same handle, for chaining at the call site.
   */
  sync(contentRows: number, viewportRows?: number): PanelViewport
}
/**
 * The page's scroll state: ONE live offset, and every read clamped against the page's OWN sizes.
 *
 * THE DEFECT THIS SHAPE FIXES (measured: `PgDn` a thousand times on an 86-row page left the footer reading
 * `769/769` and the window clamped to ZERO rows — the same "I can't see it" symptom class the wave exists
 * to remove). The cause was GENERATIONAL: the committed offset was validated against one render's content
 * height and read against another's, so the number that reached the window had never been clamped against
 * the page on screen.
 *
 * The shape that avoids it: a ref holds the offset as the single live authority (a gesture between renders
 * must move the position the NEXT gesture measures from), the state cell exists only to make the host
 * re-render, and every clamp reads the page's sizes through `read()` so there is exactly ONE generation of
 * numbers — whichever render's closure is asking.
 *
 * NO SNAPSHOT IS RETURNED: `offset`, `max` and `max` are derived inside `band()`, which runs on every read
 * and every render, so a caller can never hold a stale copy of the position.
 *
 * THE SECOND AXIS IS ON THIS HANDLE, not on a second hook (frozen clause T4). It adds ONE more ref — the
 * live column offset — and NOT one more band definition: `colBand()` calls the same `clampScroll` with
 * the drawing's width in place of the page's height, which is all a horizontal band is. A page that
 * needed `contentCols`/`viewportCols` reports them on the same `read()`; a page that does not leaves them
 * undefined and the horizontal axis reads as "nothing overflows", which is the honest answer for a page
 * with one axis.
 * @param kit - the proved host kit (its `React` holds the ref and the state cell).
 * @param read - the page's live sizes: rows always, the DAG drawing's columns when the page pans
 *   horizontally. `contentCols`/`viewportCols` describe the DRAWING, never the page (captain's ruling R8).
 * @param initialOffset - where the window starts; zero for every page here.
 * @returns the viewport handle.
 */
export function usePanelViewport(
  kit: PanelKit,
  read: () => { contentRows: number; viewportRows: number; contentCols?: number; viewportCols?: number },
  initialOffset: number = 0,
): PanelViewport {
  // THE REF IS THE FIRST HOOK ON PURPOSE. It is the live authority, so it must occupy a stable slot that
  // nothing else can take; the state cell below is only the re-render trigger. An earlier shape created
  // the ref second, and a slot collision silently handed the page a fresh ref every render — the offset
  // was written into one object and read out of another.
  /** The live offset: what a gesture between renders moves, and what every read clamps. */
  const live = kit.React.useRef(initialOffset)
  // The SECOND axis is a second ref because it is a second POSITION, and the same argument applies to it:
  // it must occupy its own stable slot, created before any handler that reads it.
  /** The live COLUMN offset: the horizontal window's single authority. */
  const liveCol = kit.React.useRef(0)
  /** The state cell, whose value MIRRORS the ref and exists to make the host re-render this page. */
  const cell = kit.React.useState(initialOffset)
  /** The setter, proved callable before any handler is built around it. */
  const set = cell[1] as (next: number) => void
  /**
   * The page's sizes for THIS render, captured through a ref so a handler written in an earlier render
   * still clamps against the CURRENT page. The assignment runs on every render, which is what keeps it
   * from lagging behind the ref the offset lives in.
   */
  const facts = kit.React.useRef({ contentRows: 1, viewportRows: 1 }) as { current: { contentRows: number; viewportRows: number; contentCols?: number; viewportCols?: number } }
  /** The sizes the page is reporting right now. */
  const measured = read()
  if (facts !== null && facts !== undefined) facts.current = measured
  /** The current offset, re-proved on every read so a kit that hands back something odd cannot throw. */
  const position = (): number => (typeof live?.current === "number" && Number.isFinite(live.current) ? (live.current as number) : initialOffset)
  /** The current COLUMN offset, re-proved on every read for the same reason as the row one. */
  const colPosition = (): number => (typeof liveCol?.current === "number" && Number.isFinite(liveCol.current) ? (liveCol.current as number) : 0)
  /** The live sizes, re-proved on every read. */
  const sizes = (): { contentRows: number; viewportRows: number } => {
    /** The captured value, when the kit gave one back. */
    const value = facts?.current
    /** The content height, floored at one row: a page always has a header to draw. */
    const contentRows = typeof value?.contentRows === "number" && Number.isFinite(value.contentRows) ? Math.max(1, Math.floor(value.contentRows)) : 1
    /** The window height, floored at one row. */
    const viewportRows = typeof value?.viewportRows === "number" && Number.isFinite(value.viewportRows) ? Math.max(1, Math.floor(value.viewportRows)) : 1
    return { contentRows, viewportRows }
  }
  /**
   * This render's clamped band.
   *
   * Derived HERE, on every call, rather than captured at construction — that is what makes a getter on an
   * EARLY render's handle answer with the CURRENT position instead of the one that render was born with.
   * @returns the offset, the furthest offset and whether anything overflows.
   */
  const band = (): { offset: number; max: number; overflow: boolean } => {
    /** The live sizes. */
    const now = sizes()
    return clampScroll(position(), now.contentRows, now.viewportRows)
  }
  /**
   * This render's clamped COLUMN band, from the same three-number arithmetic as the row one.
   *
   * `clampScroll(offset, content, viewport)` is axis-agnostic, so the horizontal band IS that function
   * with the drawing's width as its "content". A page that reported no columns answers `{0, 0, false}` —
   * nothing overflows, nothing is reserved — which is what keeps every page that never opted in byte-for-
   * byte unchanged.
   * @returns the column offset, the furthest column offset and whether the drawing is wider than the window.
   */
  const colBand = (): { offset: number; max: number; overflow: boolean } => {
    /** The captured sizes. */
    const value = facts?.current
    /** The drawing's own width, floored at one cell. */
    const contentCols = typeof value?.contentCols === "number" && Number.isFinite(value.contentCols) ? Math.max(1, Math.floor(value.contentCols)) : 1
    /** The window's width, floored at one cell. */
    const viewportCols = typeof value?.viewportCols === "number" && Number.isFinite(value.viewportCols) ? Math.max(1, Math.floor(value.viewportCols)) : 1
    // NO COLUMNS REPORTED MEANS NO HORIZONTAL AXIS, not "a one-cell drawing": a page that never opted in
    // must not have a rail reserved for it, and `content === viewport === 1` is exactly "nothing overflows".
    if (value?.contentCols === undefined || value?.viewportCols === undefined) return { offset: 0, max: 0, overflow: false }
    return clampScroll(colPosition(), contentCols, viewportCols)
  }
  /** Record a new offset: the ref first (the live authority), then the cell (the re-render trigger). */
  const commit = (next: number): void => {
    /** The live sizes, so a request is clamped against the page as it stands. */
    const now = sizes()
    /** The clamped target. */
    const clamped = clampScroll(next, now.contentRows, now.viewportRows).offset
    if (live !== null && live !== undefined) live.current = clamped
    set(clamped)
  }
  /**
   * Record a new COLUMN offset, through the same two-step shape as {@link commit}.
   *
   * It writes the row cell's setter after the column ref, which is deliberate: the host re-renders on the
   * VALUE change, and a column move IS a state change the page must draw. Writing `liveCol` first keeps
   * the ref the authority, so a handler from an earlier render that reads `colOffset` sees the new number
   * even before the re-render lands.
   * @param next - the requested column offset.
   */
  const commitCol = (next: number): void => {
    /** The clamped target, from the live band. */
    const clamped = colBand()
    /** The requested column offset, floored and made finite. */
    const wanted = Math.floor(Number.isFinite(next) ? next : 0)
    /** Where the column position lands. */
    const target = Math.min(clamped.max, Math.max(0, wanted))
    if (liveCol !== null && liveCol !== undefined) liveCol.current = target
    set(target)
  }
  /**
   * The handle every caller addresses, with LIVE getters.
   *
   * Its numbers are derived on every access rather than captured at construction, because the host
   * installs a key listener ONCE and a handler may therefore belong to an early render.
   */
  const handle: PanelViewport = {
    /** The page's own content height for this render. */
    get contentRows(): number {
      return sizes().contentRows
    },
    /** The rows the panel can show for this render. */
    get viewportRows(): number {
      return sizes().viewportRows
    },
    /** The first content row the window draws, clamped into the band. */
    get offset(): number {
      return band().offset
    },
    /** The furthest offset that still fills the window; zero when the content fits. */
    get max(): number {
      return band().max
    },
    /** Whether anything overflows, and therefore whether the gutter column is reserved. */
    get overflow(): boolean {
      return band().overflow
    },
    scrollTo: (next: number): void => {
      commit(next)
    },
    scrollBy: (delta: number): void => {
      // RELATIVE TO THE LIVE POSITION, which is the whole reason the offset lives in a ref.
      commit(position() + delta)
    },
    /** The column offset the drawing's window starts at, clamped into its band. */
    get colOffset(): number {
      return colBand().offset
    },
    /** The furthest column offset that still fills the window; zero when the drawing fits. */
    get colMax(): number {
      return colBand().max
    },
    /** Whether the drawing is wider than the window, and therefore whether the rail is drawn. */
    get colOverflow(): boolean {
      return colBand().overflow
    },
    scrollToCol: (next: number): void => {
      commitCol(next)
    },
    scrollColBy: (delta: number): void => {
      commitCol(colPosition() + delta)
    },
    onWheel: (event: unknown): void => {
      /** The live sizes, so the wheel clamps exactly like every other gesture. */
      const now = sizes()
      commit(scrollByWheel(event, position(), now.contentRows, now.viewportRows))
    },
    onWheelX: (event: unknown): void => {
      /** The captured sizes, read once so the three numbers below belong to one generation. */
      const value = facts?.current
      if (value?.contentCols === undefined || value?.viewportCols === undefined) return
      /** The delta this event carries on the horizontal axis; a non-numeric one is not a gesture. */
      const raw = (event ?? {}) as PanelWheelEvent
      if (typeof raw.deltaX !== "number" || !Number.isFinite(raw.deltaX)) return
      commitCol(colPosition() + raw.deltaX)
    },
    /**
     * Kept for API compatibility, and now a NO-OP: the hook reads the page's sizes through `read()`, so
     * there is nothing left for a page to push in. It stays on the interface so the call sites written
     * against the older shape keep compiling while they are migrated, and returns the same handle.
     * @returns the same handle.
     */
    sync(): PanelViewport {
      return handle
    },
  }
  // The state cell is written by `commit` and read by NOTHING here: the ref is the authority, and the cell
  // is the host's reason to re-render. `void` makes that explicit for a reader of this function.
  void cell
  return handle
}

/**
 * One pointer event's position on ONE axis, as a rail's own handlers read it.
 *
 * The host recomputes `localRow`/`localCol` before each handler from the element's OWN rect (measured in
 * the installed dsh-tui 0.13.0: `ink/events/pointer-event.js`'s `_prepareForTarget` sets
 * `localCol = col - rect.x`, `localRow = row - rect.y`), so the number IS the cell inside the rail — no
 * arithmetic on the absolute pointer position is needed here. A missing or non-numeric coordinate reads
 * as the rail's FIRST cell, which is the default the rail's own click has always used.
 * @param event - the pointer event, as the host delivered it.
 * @param axis - the axis to read: `row` for a vertical rail, `col` for the horizontal one.
 * @returns the position, floored to a whole cell.
 */
function localCell(event: unknown, axis: "row" | "col"): number {
  /** This axis's own member, before it is trusted. */
  const raw = event === null || event === undefined ? undefined : (event as Record<string, unknown>)[axis === "row" ? "localRow" : "localCol"]
  return typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0
}

/**
 * The cell band a rail's thumb travels along — the mapping BOTH rails share.
 *
 * `extent - thumb`, with the SAME thumb length a rail's own drawing computes (`gutterCells` /
 * `gutterCellsX`): `floor(extent² / content)`, at least one cell and never longer than the rail.
 * `clampScroll` defines `max = content - extent`, so the content length is reconstructed from the two
 * numbers a rail already holds and this band can never disagree with the thumb drawn above it.
 * The rails need the NUMBER rather than the string because a drag maps a pointer position along this
 * band onto the offset band — which is the host's own arithmetic in `components/ScrollbarGutter.js`
 * (`const trackH = Math.max(1, viewport - thumbH)`, then `Math.round((y / trackH) * maxScroll)`).
 * @param extent - the rail's own length, in cells.
 * @param max - the furthest offset `clampScroll` allows, in the offset's own units.
 * @returns the travel, in cells; zero when the thumb fills the rail (there is nothing to scrub).
 */
function railTravel(extent: number, max: number): number {
  /** The rail's usable length; below one cell there is no rail to scrub. */
  const cells = Math.max(1, Math.floor(Number.isFinite(extent) ? extent : 1))
  /** The furthest offset, floored and never negative. */
  const span = Math.max(0, Math.floor(Number.isFinite(max) ? max : 0))
  /** The content length the thumb's size is a fraction of: `max = content - extent`, so `content = extent + max`. */
  const content = cells + span
  /** The thumb's length: the fraction of the content the rail shows, at least one cell. */
  const thumb = Math.min(cells, Math.max(1, Math.floor((cells * cells) / content)))
  return cells - thumb
}

/**
 * The ABSOLUTE offset a pointer's position on a rail asks for — one mapping for both rails, every phase.
 *
 * The position is read against the track band ALONE, never against the thumb's current placement, so no
 * grabbed-thumb offset can enter the gesture: this is the host's own rule for its reference rail
 * ("drag to point, no grabbed thumb offset" — `components/ScrollbarGutter.js`). The ends are pinned the
 * way the host pins them: the band's first cell is the offset's start, and any cell at or past the band's
 * end is the maximum.
 * @param position - the pointer's position along the rail, in cells.
 * @param travel - this rail's {@link railTravel}.
 * @param max - the furthest offset `clampScroll` allows.
 * @returns the offset to commit; always inside `[0, max]`.
 */
function railOffset(position: number, travel: number, max: number): number {
  /** The furthest offset, floored and never negative. */
  const span = Math.max(0, Math.floor(Number.isFinite(max) ? max : 0))
  if (span === 0) return 0
  /** The pointer's own cell, floored; a non-numeric position reads as the band's start. */
  const cell = Math.floor(Number.isFinite(position) ? position : 0)
  if (cell <= 0) return 0
  if (cell >= travel) return span
  return Math.round((cell / travel) * span)
}

/**
 * The gutter RAIL: the reserved column, drawn as a full-height box when the content overflows.
 *
 * It is a separate element from the rows so the column is reserved ONCE for the whole page rather than
 * per row (the host's own reason for a permanent gutter: a column that changed width would rewrap every
 * row). Clicking the rail scrolls to the clicked position, the classic track semantics — the host's own
 * `Box` keeps `onClick`, which is what makes that available to a plugin panel at all.
 *
 * THE RAIL DRAGS TOO (AC7): the same Box carries `onDragStart`/`onDragMove`/`onDragEnd`, each receiving
 * `{localRow}` recomputed from this Box's own rect by the host's drag protocol, and every phase maps
 * through the SAME arithmetic the click uses — a page that passed `onTrackClick` owns both, and a rail
 * without one maps the row itself through its own band ({@link railOffset}). A host whose `Box` ignores
 * the drag props renders exactly the rail it rendered before: the props are additive.
 * @param kit - the proved host kit.
 * @param viewport - this render's viewport.
 * @param onTrackClick - receives the clicked row offset inside the gutter, when the page wants track jumps.
 * @returns the rail element, or undefined when everything fits (and NO column is reserved).
 */
export function viewportGutter(kit: PanelKit, viewport: PanelViewport, onTrackClick?: (row: number) => void): unknown | undefined {
  /** The gutter's cells, one per viewport row. */
  const cells = gutterCells(viewport.offset, viewport.contentRows, viewport.viewportRows)
  if (cells.length === 0) return undefined
  /** One host row per cell, so the thumb is drawn where the arithmetic put it. */
  const rows = cells.map((cell, at) =>
    kit.React.createElement(
      kit.ui.Text,
      { key: `g${at}`, color: cell === DAG_CHROME.barFull ? toneColor("chain") : toneColor("dim") },
      cell,
    ),
  )
  /** The track band this rail's pointer positions scrub along. */
  const travel = railTravel(viewport.viewportRows, viewport.max)
  /**
   * One drag phase applied as an absolute offset.
   *
   * With a page callback the drag and the click stay ONE gesture — the page's own mapping decides both,
   * which is what stops the two from disagreeing about where a cell lands. Without one (the shape
   * {@link panelViewportBody} uses) the rail commits the mapped offset itself.
   * @param event - the host's drag event.
   */
  const scrubTo = (event: unknown): void => {
    /** The row the pointer is on inside this rail. */
    const row = localCell(event, "row")
    if (onTrackClick !== undefined) {
      onTrackClick(row)
      return
    }
    viewport.scrollTo(railOffset(row, travel, viewport.max))
  }
  /** The three drag phases the host's protocol delivers, all on the same absolute mapping. */
  const dragging = { onDragStart: scrubTo, onDragMove: scrubTo, onDragEnd: scrubTo }
  if (onTrackClick === undefined) return kit.React.createElement(kit.ui.Box, { key: "gutter", flexDirection: "column", width: 1, ...dragging }, ...rows)
  return kit.React.createElement(
    kit.ui.Box,
    {
      key: "gutter",
      flexDirection: "column",
      width: 1,
      onClick: (event: unknown): void => {
        /** The click's own row inside the rail, when the host reported one. */
        const row = typeof (event as { localRow?: unknown } | undefined)?.localRow === "number" ? Math.floor((event as { localRow: number }).localRow) : 0
        onTrackClick(row)
      },
      ...dragging,
    },
    ...rows,
  )
}

/**
 * The HORIZONTAL rail: the reserved row under a drawing wider than its window, made DRAGGABLE (AC7).
 *
 * The row form of {@link viewportGutter}, and the second rail the user asked to be scrubbable. Its CELLS
 * come from `gutterCellsX` — the ONE horizontal-gutter function (clause T4), so the thumb here and the
 * window drawn above it can never disagree — while its drag handlers come from the host's own protocol:
 * `onDragStart`/`onDragMove`/`onDragEnd` each receive `{localCol}` recomputed from THIS element's own
 * rect, and every phase commits an ABSOLUTE column offset ({@link railOffset}) — the same band arithmetic
 * the click uses, never a delta from where the thumb was grabbed.
 *
 * `cols` MUST be the window width the page reported as its horizontal viewport: `viewport.colMax` was
 * clamped against it, so the rail's own length and the band it maps through are one number. A drawing
 * that fits returns `undefined` and reserves NO row.
 * @param kit - the proved host kit.
 * @param viewport - this render's viewport; its COLUMN members are what the rail scrubs.
 * @param cols - the rail's own width in cells.
 * @returns the one-row rail element, or undefined when the drawing fits.
 */
export function viewportRail(kit: PanelKit, viewport: PanelViewport, cols: number): unknown | undefined {
  if (!viewport.colOverflow) return undefined
  /** The rail's own length, floored at one cell. */
  const extent = Math.max(1, Math.floor(Number.isFinite(cols) ? cols : 1))
  /** The drawing's width: `clampScroll` defines the column band's max as `contentCols - viewportCols`. */
  const contentCols = extent + viewport.colMax
  /** The rail's cells, from the ONE horizontal-gutter function (clause T4). */
  const cells = gutterCellsX(viewport.colOffset, contentCols, extent)
  if (cells === "") return undefined
  /** The track band this rail's pointer positions scrub along. */
  const travel = railTravel(extent, viewport.colMax)
  /**
   * One drag phase committed as an absolute column offset.
   * @param event - the host's drag event.
   */
  const scrubTo = (event: unknown): void => {
    viewport.scrollToCol(railOffset(localCell(event, "col"), travel, viewport.colMax))
  }
  // THE ROW IS DRAWN BY THE SAME BUILDER THE PAGES USED BEFORE (`textRow` + `gutterCellsX`), so the
  // gesture changes and the pixels do not; only the wrapping Box — the drag target the host captures —
  // is new. ONE ROW: the Text is the row, the Box is what carries the handlers.
  /** The rail's cells as the one row a reader sees. */
  const row = textRow(kit, cells, { key: "hrail", tone: "edge", maxCells: extent })
  return kit.React.createElement(kit.ui.Box, { key: "hrail-track", flexDirection: "row", onDragStart: scrubTo, onDragMove: scrubTo, onDragEnd: scrubTo }, row)
}

/**
 * Assemble a self-windowed body: the visible slice plus its reserved gutter column.
 *
 * The slice is `[offset, offset + viewportRows)`, so the page renders at most `viewportRows` content
 * rows no matter where the offset has been driven — the "never a blank panel" invariant is a property of
 * this function, not of a page's discipline.
 * @param kit - the proved host kit.
 * @param children - the page's rows, in draw order.
 * @param viewport - this render's viewport.
 * @param reserveGutter - whether to draw and reserve the gutter column (a page may draw its own rail).
 * @param rowWrapper - wraps the VISIBLE slice, when the page needs one element around the rows it drew
 *   (the `dag` page binds its single wheel handler this way). It is applied AFTER the slice, so the
 *   wrapper never participates in the windowing and cannot window the page a second time.
 * @returns the body's rows, ready to spread into the page's frame.
 */
export function panelViewportBody(
  kit: PanelKit,
  children: readonly unknown[],
  viewport: PanelViewport,
  reserveGutter: boolean = true,
  rowWrapper?: (kit: PanelKit, rows: readonly unknown[]) => unknown,
): unknown[] {
  // THE SLICE IS ONE PAGE TALL, and it is NOT called `window`: a local with that name shadows the
  // global one inside this function, which is a trap rather than a style preference — it made the rows
  // vanish across a whole debugging pass because every `window.x` read here answered `undefined`.
  /** The visible slice. */
  const visible = children.slice(viewport.offset, viewport.offset + viewport.viewportRows)
  // THE WRAPPER IS APPLIED HERE, to the SLICE — never around the whole column. A page that wrapped the
  // full list and handed that wrapper back in as the body (which is how the wheel was bound) windowed
  // TWICE: this function then sliced a one-element array at the row offset and rendered an EMPTY page,
  // measured as a blank panel whose footer still read `6/82`. One slice, one place, and the wrapper is
  // a parameter so the wheel can still be bound once in the dispatch path.
  /** The rows as the caller wants them drawn, the slice included. */
  const rows = (rowWrapper === undefined ? undefined : rowWrapper(kit, visible)) ?? undefined
  /** The body's own rows: the wrapped slice where the page asked for one, the bare slice otherwise. */
  const drawn: unknown[] = rowWrapper === undefined ? [...visible] : [rows]
  if (!reserveGutter) return drawn
  /** The rail, absent when everything fits. */
  const rail = viewportGutter(kit, viewport)
  if (rail === undefined) return drawn
  // THE ROWS AND THE RAIL ARE SIBLINGS in a row-direction box, so the rail reserves its ONE column for
  // the whole page: the rows keep their own widths and the gutter never rewraps them.
  return [kit.React.createElement(kit.ui.Box, { key: "window", flexDirection: "row" }, kit.React.createElement(kit.ui.Box, { key: "rows", flexDirection: "column" }, ...drawn), rail)]
}

/**
 * The per-render notification sink, as a page hands it to {@link useBadgeEffect}.
 *
 * Every member is optional because the host only guarantees `notify`/`clearBadge` on a 0.13.0 build:
 * a leaner composition renders the same page without a badge instead of throwing.
 */
export interface PanelHostNotify extends PanelHostLike {
  /** Sets this panel's badge level and unread count. */
  notify?(level: string, unread?: number): unknown
  /** Clears this panel's badge. */
  clearBadge?(): unknown
}

/**
 * The badge a page derives from its own state, as DATA (frozen clause R9).
 *
 * A pure value rather than an effect body, so the level ladder is assertable without a host: failed
 * work is `error`, a blocked task is `warning`, and anything else worth a glance is `info`.
 */
export interface PanelBadge {
  /** The host badge level. */
  level: "info" | "warning" | "error"
  /** How many items the badge counts. */
  unread: number
}

/**
 * Publish a page's badge through the host API, once per change.
 *
 * Called from an effect, with the previous value kept in a ref: `notify` on every render would make
 * the host's own badge listener fire in a loop, so the write happens only when the derived badge
 * actually differs.
 * @param host - the props' `host` field.
 * @param badge - the badge this render derived, or `null` for "nothing to report".
 * @param previous - the ref holding the last badge this page published.
 */
export function publishBadge(host: unknown, badge: PanelBadge | null, previous: { current: PanelBadge | null }): void {
  if (host === null || host === undefined) return
  /** The host API, before either member is trusted. */
  const api = host as PanelHostNotify
  /** The value the badge must now show: `null` means "clear it". */
  const next = badge === null ? null : { level: badge.level, unread: Math.max(0, Math.floor(badge.unread)) }
  /** The last published value, if any. */
  const last = previous.current
  if (last === next || (last !== null && next !== null && last.level === next.level && last.unread === next.unread)) return
  try {
    if (next === null) {
      if (typeof api.clearBadge === "function") api.clearBadge()
    } else if (typeof api.notify === "function") {
      api.notify(next.level, next.unread)
    } else {
      // A host that cannot show a badge must not record one as published: leaving the ref alone makes
      // the next render retry rather than believe a badge it never set.
      return
    }
    previous.current = next
  } catch {
    // The badge is a decoration: a refusing host costs the badge, never the page.
  }
}

/**
 * Subscribe a key listener for as long as the page is focused and on screen.
 *
 * The two gates are `focused && visible`, which is exactly the host's own delivery condition — asking
 * for keys while unfocused would rely on the host to withhold them, and a panelless host simply
 * answers `undefined` and the page keeps its click surface only.
 * @param kit - the proved host kit (its `React` runs the effect).
 * @param host - the props' `host` field.
 * @param active - whether this page may receive keys right now.
 * @param listener - the handler; called once per key event.
 */
export function usePanelKeys(kit: PanelKit, host: unknown, active: boolean, listener: (event: unknown) => void): void {
  // The listener travels in a ref so the subscription is installed ONCE per active flip rather than
  // re-registered on every render (a re-subscription per frame is what makes a panel feel laggy).
  const handlerRef = kit.React.useRef(listener)
  if (handlerRef !== null && handlerRef !== undefined) handlerRef.current = listener
  kit.React.useEffect(() => {
    if (!active || host === null || host === undefined) return undefined
    /** The host API, before `onKey` is trusted. */
    const api = host as PanelHostLike
    if (typeof api.onKey !== "function") return undefined
    try {
      /** The host's own disposer, when it returns one. */
      const dispose = api.onKey((event: unknown) => {
        // A page handler that throws must not take the host's key dispatcher (or the page) down.
        try {
          /** The ref's current listener, re-read per event so a stale closure is never used. */
          const live = handlerRef.current
          if (typeof live === "function") (live as (value: unknown) => void)(event)
        } catch {
          // A throwing handler consumes nothing and leaves the panel as it was.
        }
      })
      return () => {
        if (typeof dispose === "function") (dispose as () => void)()
      }
    } catch {
      return undefined
    }
  }, [active, host])
}

/**
 * Force a re-render on the host's own clock, so a page re-reads its source without user input.
 *
 * A sidebar panel is a PASSIVE surface: nothing re-renders it unless the host does, so a page that
 * reads its state per render must own a tick or it would show the moment the panel was opened forever.
 * The counter is local state and the interval is capped, so the cost is one integer per tick.
 * @param kit - the proved host kit (its `React` runs the effect).
 * @param intervalMs - the tick period in milliseconds.
 * @param enabled - whether the tick is wanted at all (a page may prefer render-time reads only).
 */
export function usePanelTick(kit: PanelKit, intervalMs: number, enabled: boolean = true): void {
  /** The state cell whose UPDATE is the whole mechanism: nothing reads its value. */
  const tick = kit.React.useState(0)
  /** The state cell's setter, proved callable before the effect is built. */
  const set = tick[1] as (next: number) => void
  kit.React.useEffect(() => {
    if (!enabled) return undefined
    try {
      /** The host's scheduled interval, absent when the host refuses to schedule one. */
      const timer = setInterval(() => {
        // The value itself is never read: the state UPDATE is the whole point, because it is what makes
        // the host re-render a page that has no other reason to.
        set(Date.now())
      }, intervalMs)
      return () => {
        try {
          clearInterval(timer)
        } catch {
          // already cleared
        }
      }
    } catch {
      // A host that refuses a timer renders once per host-driven render; nothing else is lost.
      return undefined
    }
  }, [enabled, intervalMs])
}

/**
 * Whether a key event should reach a page's own handler at all.
 *
 * Pure, so the arming rule is assertable without a host: the page must hold the focus AND be on
 * screen, and the host must expose `onKey`.
 * @param focused - the props' `focused` field.
 * @param visible - the props' `visible` field.
 * @param host - the props' `host` field.
 * @returns whether the page subscribes a key listener this render.
 */
export function panelKeysArmed(focused: unknown, visible: unknown, host: unknown): boolean {
  if (focused !== true || visible !== true) return false
  if (host === null || host === undefined) return false
  return typeof (host as PanelHostLike).onKey === "function"
}

/**
 * Narrow one host key event into the four facts a page's keymap reads.
 *
 * The host's own flag set is wide and version-dependent, so only the fields this plugin acts on are
 * read, each one feature-detected. Enter arrives as `input === ""` with a return flag, which is why
 * the empty input is not treated as "no key".
 * @param event - the host's event, as delivered.
 * @returns the narrowed event, or undefined when the value is not a key event at all.
 */
export function panelKeyEvent(event: unknown): PanelKeyEventLike | undefined {
  if (event === null || event === undefined || typeof event !== "object") return undefined
  /** The event, before its members are trusted. */
  const raw = event as { input?: unknown; key?: unknown; preventDefault?: unknown }
  /** The raw input, kept only when it is a string; a non-string input carries no keymap meaning. */
  const input = typeof raw.input === "string" ? raw.input : ""
  return {
    input,
    ...(raw.key !== null && raw.key !== undefined && typeof raw.key === "object" ? { key: raw.key as Record<string, unknown> } : {}),
    ...(typeof raw.preventDefault === "function" ? { preventDefault: () => (raw.preventDefault as () => unknown).call(raw) } : {}),
  }
}

/**
 * The frame index a running node's breathing dot draws this render.
 *
 * The animation is an ORBIT over the contract's own state glyph: the dot never becomes a glyph that
 * means something else (`DAG_TONE_GLYPH.running` stays at the head of the orbit, and the tail is the
 * already-anywhere `·`), so a running task cannot be misread as a task in another state.
 * @param phase - the frame index from {@link useRunningPhase}.
 * @returns the glyph to draw for a running node.
 */
export function runningGlyph(phase: number): string {
  /** The contract's own running glyph; `◐` when the contract stops declaring one. */
  const base = DAG_TONE_GLYPH.running ?? "◐"
  // THE ORBIT BEGINS AT THE BASE GLYPH AND NEVER DROPS IT: every frame carries the state mark, so a
  // frame can never read as "no state at all" — an earlier orbit whose last frame was a bare `·`
  // measured as a running task that vanished for a quarter of the cycle. The dot count rises and falls
  // from the base frame, which is what makes the cycle read as a breath rather than as a flicker.
  /** The breathing orbit, indexed by the quantised frame. */
  const orbit = [base, `${base}·`, base, `${base}··`]
  /** The frame index, floored and wrapped so any number is drawable. */
  const index = ((Math.floor(phase) % orbit.length) + orbit.length) % orbit.length
  return orbit[index]
}

/**
 * The glyph a task's VISUAL state draws.
 *
 * Read from the frozen contract (`DAG_TONE_GLYPH`), never re-typed: a page that spelled its own
 * glyphs would be a second source of truth for what a state means, and the two would drift the first
 * time the contract changed. `blocked` and `open` SHARE the `○` glyph by design — that is precisely
 * what the legend exists to disambiguate.
 * @param visual - the task's rendered visual state.
 * @returns the glyph, or `?` for a state the contract does not know.
 */
export function visualGlyph(visual: string): string {
  return DAG_TONE_GLYPH[visual] ?? "?"
}

/**
 * The TONE a task's VISUAL state renders in.
 *
 * The six state tones are the contract's own vocabulary; anything else draws as `dim` so an unknown
 * state is visibly unknown rather than silently taking a colour that means something.
 * @param visual - the task's rendered visual state.
 * @returns the tone to draw it in.
 */
export function visualTone(visual: string): DagTone {
  return (DAG_STATE_TONES as readonly string[]).includes(visual) ? (visual as DagTone) : "dim"
}

/**
 * The LEGEND: what this page's marks mean (frozen clause R6).
 *
 * TWO SOURCES, DELIBERATELY. The arrow/focus sentence is `graph.ts`'s `legendLines` — the drawing
 * module owns what its own arrows mean, and the full-screen scene renders the same lines, so the two
 * surfaces cannot describe an edge differently. The STATE KEY is built here from
 * `dag-theme.ts` `DAG_STATE_TONES` + `DAG_TONE_GLYPH`, and it is the whole reason this legend exists:
 * `blocked` and `open` share the `○` glyph, and the drawing module's own key lists five states and
 * omits `blocked`, so a legend that merely forwarded it would leave the reader unable to tell the two
 * apart. NO GLYPH IS SPELLED HERE — every mark is interpolated from the contract, so the legend
 * cannot drift from the drawing.
 * @param cols - the cells available on the page's rows.
 * @param arrowLines - the drawing module's own arrow/focus lines, already sanitized by its owner.
 * @returns the legend lines, each inside `cols`, in print order.
 */
export function legendLinesFor(cols: number, arrowLines: readonly string[]): string[] {
  /** The usable width; a width that is not a finite number says nothing about the row. */
  const width = Number.isFinite(cols) ? Math.floor(cols) : 0
  if (width <= 0) return []
  /** The lines, in print order: the drawing's own sentences first — the drawing exists for them. */
  const out: string[] = []
  /** Append one line, clamped to this row's cells; an empty line is dropped rather than printed blank. */
  const push = (line: string): void => {
    if (line !== "") out.push(clampCells(stripControl(line), width))
  }
  for (const line of arrowLines) push(line)
  // THE STATE KEY, widest wording first, DROPPED rather than cut: a legend that reads `✗ fai` is a
  // truncated falsehood, and dropping a whole line of a key is honest about what does not fit.
  /** Each state's `glyph name` entry, read out of the contract. */
  const entries: string[] = DAG_STATE_TONES.map((state) => {
    /** The state's own glyph, `?` when the contract stops declaring one. */
    const glyph = DAG_TONE_GLYPH[state] ?? "?"
    /** The glyph of the FIRST state this one shares a mark with, when they share one. */
    const twin = DAG_STATE_TONES.find((other) => other !== state && DAG_TONE_GLYPH[other] === DAG_TONE_GLYPH[state])
    /** The name as printed: a shared glyph names its twin, which is how `blocked` and `open` are told apart. */
    return twin === undefined ? `${glyph} ${state}` : `${glyph} ${state}=${twin}`
  })
  /** Every entry on one line; the widest wording of the key. */
  const oneLine = entries.join(" · ")
  if (cellWidth(oneLine) <= width) {
    push(oneLine)
    return out
  }
  // THE KEY WRAPS RATHER THAN SHRINKS. A legend exists to be unambiguous, so it packs as many entries
  // per line as fit and never abbreviates a state name.
  /** The entries accumulated on the line being built. */
  let current = ""
  for (const entry of entries) {
    /** The line this entry would produce. */
    const candidate = current === "" ? entry : `${current} · ${entry}`
    if (cellWidth(candidate) <= width) {
      current = candidate
      continue
    }
    push(current)
    current = entry
  }
  push(current)
  return out
}

/**
 * The width floor a page falls back to before the host has measured it.
 *
 * It is the CONTRACT's floor (`dag-theme.ts`), never a page's own constant: the descriptor asks the host
 * for exactly this width, so a page that fell back to anything else would lay itself out for a column it
 * cannot be handed. The merged page shares the DAG page's floor because both descriptors ask for it.
 * @param which - the page asking.
 * @returns the frozen floor for that page.
 */
export function panelFloorColumns(which: "dag" | "workmate" | "merged"): number {
  if (which === "dag") return DAG_PANEL_MIN_COLUMNS
  if (which === "workmate") return WORKMATE_PANEL_MIN_COLUMNS
  // The merged page's descriptor and the DAG page's ask the host for the SAME width, so they share the
  // contract's value rather than a second constant that could drift from it.
  return DAG_PANEL_MIN_COLUMNS
}
