#!/usr/bin/env node
// snake-driver.v3-blob.mts — the LANE-E2 black-box playability driver.
//
// WHY THIS FILE EXISTS: the acceptance question is not "did a model write a file somewhere" but "does
// the file that landed PLAY". NOTHING below reads the page's own source and no assertion is derived
// from it. Every verdict comes from VISIBLE page state — the body's innerText, the rendered screenshot,
// and the shapes the engine PAINTED (a canvas' pixels, or the boxes of laid-out elements) — plus REAL
// keyboard input into a real Chromium. A person looking at the screen has exactly this much
// information, which is what makes the driver independent of the agent that produced the artifact.
//
// THE ONE IDEA THE SENSOR RESTS ON: a game object is a REGION of the frame that is not board, and the
// SNAKE is the region that MOVED. Colour is never used to identify anything, because a real game
// animates — the live artifact's food pulses with a glow, so its pixels change every frame while its
// position does not. "Which colours changed?" calls that food the snake and finds no target at all;
// "which regions moved?" gets both right.
//
// WHERE IT RUNS: inside a container beside playwright (the project's own UI lane keeps playwright
// 1.49.1 + its Chromium in the `ui_ui-data` volume), writing rows and screenshots into the
// bind-mounted evidence directory. Invocation:
//   node snake-driver.v3-blob.mts --page <file path> --out <dir> --label <name> [--budget-ms N] [--note S]
//
// Exit code: 0 when every recorded row is true, 1 when any row is false, 2 when the browser never
// started. A row that could not be measured is `null` and never counts as a pass.
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

// The tiny slice of the DOM these callbacks touch, declared locally because this driver lives outside
// the repository's DOM type program (it is evidence tooling, not a package source). `declare` is
// type-only and erased by Node's type stripping.
declare const document: {
  body: { innerText: string } | null
  querySelector(selector: string): DomElementLike | null
  querySelectorAll(selector: string): ArrayLike<DomElementLike>
}
/** The style surface the DOM sensor reads, so a transparent wrapper cannot be mistaken for a cell. */
declare function getComputedStyle(element: DomElementLike): {
  /** `none` for an element that paints nothing. */
  display: string
  /** `hidden` for an element the user cannot see either. */
  visibility: string
  /** The painted background, as `rgb(...)` / `rgba(...)` / `transparent`. */
  backgroundColor: string
}
/** The element surface the in-page probes read. */
interface DomElementLike {
  /** The label a person would read on the control, when it renders one. */
  innerText?: string
  /** The text content, as a fallback for elements that render no layout box. */
  textContent?: string | null
  /** The canvas backing-store width in device pixels. */
  width?: number
  /** The canvas backing-store height in device pixels. */
  height?: number
  /** The element's painted box in viewport coordinates, which is what a person sees. */
  getBoundingClientRect?(): { left: number; top: number; width: number; height: number }
  /** A 2D rendering context, or null when the element cannot paint one. */
  getContext?(kind: "2d"): CanvasContext2dLike | null
}
/** The 2D context surface the pixel probe needs. */
interface CanvasContext2dLike {
  /** The RGBA buffer of the whole backing store, row-major. */
  getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> }
}

/** One assertion row, in the same NDJSON shape the Docker lane's `record()` writes. */
interface Row {
  /** Assertion name, e.g. `snake.scoreIncreased`. */
  name: string
  /** true pass, false fail, null not measurable. */
  ok: boolean | null
  /** Human-readable reason, so a reddening row needs no JSON digging. */
  reason: string
  /** The observed values the verdict rests on. */
  raw: string
}

/** Subset of playwright's `ConsoleMessage` this driver reads. */
interface ConsoleMessageLike {
  /** The console method that produced the line (`"error"`, `"warning"`, `"log"`, ...). */
  type(): string
  /** The message text as the page rendered it. */
  text(): string
}

/** Subset of playwright's `Request` this driver reads, for the self-containment assertion. */
interface RequestLike {
  /** The absolute URL the page asked for. */
  url(): string
}

/** Subset of playwright's `Page` this driver uses. */
interface PageLike {
  /** Navigate, resolving when the requested lifecycle event fired. */
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "commit"; timeout?: number }): Promise<unknown>
  /** Subscribe to an uncaught page error. */
  on(event: "pageerror", handler: (error: Error) => void): unknown
  /** Subscribe to a console message. */
  on(event: "console", handler: (message: ConsoleMessageLike) => void): unknown
  /** Subscribe to an outgoing request. */
  on(event: "request", handler: (request: RequestLike) => void): unknown
  /** The page's keyboard, for REAL key events. */
  keyboard: { press(key: string, options?: { delay?: number }): Promise<void> }
  /** Sleep inside the page's event loop. */
  waitForTimeout(milliseconds: number): Promise<void>
  /** Render a PNG of the current viewport. */
  screenshot(options?: { path?: string; type?: "png"; fullPage?: boolean }): Promise<Buffer>
  /** Evaluate a function in the page's context. */
  evaluate<T>(pageFunction: () => T): Promise<T>
  /** The page's current URL. */
  url(): string
  /** Tear the page down. */
  close(): Promise<void>
}

/** Subset of playwright's `Browser` this driver uses. */
interface BrowserLike {
  /** A fresh independent browsing context. */
  newContext(options?: { viewport?: { width: number; height: number } }): Promise<{
    /** A blank page in this context. */
    newPage(): Promise<PageLike>
  }>
  /** The engine's own version string, e.g. `131.0.6778.33`. */
  version(): string
  /** Shut the browser down. */
  close(): Promise<void>
}

/** Subset of playwright's `chromium` launcher object this driver uses. */
interface ChromiumLike {
  /** Start a browser process. */
  launch(options?: { headless?: boolean; args?: string[] }): Promise<BrowserLike>
}

/** One steering instruction of the blind fallback: which key, how many times, and the pause between. */
interface Step {
  /** A playwright key name (`ArrowRight`, `Enter`, ...). */
  key: string
  /** How many times the key is pressed in the short form. */
  repeat: number
  /** Milliseconds to wait after each press — roughly one game tick. */
  gapMs: number
}

/** The visible-number reading a score verdict is computed from. */
interface Reading {
  /** The number following a score-ish label, or null when no such label was visible. */
  labelled: number | null
  /** Every integer token in the visible text, in DOM order. */
  numbers: number[]
  /** The visible text itself, for the game-over checks. */
  text: string
}

/** A coarse colour map of the page's board — from a `<canvas>` or from laid-out elements. */
interface CanvasMap {
  /** Samples per row of the coarse grid. */
  cols: number
  /** Samples per column of the coarse grid. */
  rows: number
  /** The 15-bit quantised colour at each sample, row-major. */
  keys: number[]
}

/** One connected region of samples that are NOT part of the board. */
interface Blob {
  /** How many samples the region covers. */
  size: number
  /** The sample indices it covers. */
  indices: number[]
  /** Its leftmost sample column. */
  minX: number
  /** Its topmost sample row. */
  minY: number
  /** Its rightmost sample column. */
  maxX: number
  /** Its bottommost sample row. */
  maxY: number
  /** The mean sample column. */
  meanX: number
  /** The mean sample row. */
  meanY: number
  /** How many of its samples were NOT an object in the previous frame. */
  fresh: number
  /** The colour the region is mostly painted in, for the evidence line only. */
  colour: number
}

/** The game's own objects, located in a coarse colour map. */
interface Scene {
  /** Grid index (into `keys`) of the snake's leading tip, or -1 when it could not be located. */
  head: number
  /** Grid index of the food, or -1 when it could not be located. */
  food: number
  /** The most common colour (the board background). */
  background: number
  /** The colour the snake's leading region is painted in, or -1. */
  snake: number
  /** The colour the food region is painted in, or -1. */
  foodColour: number
  /** How many samples the engine repainted since the previous frame — zero means a frozen board. */
  changed: number
}

// ── the blind fallback's patterns ─────────────────────────────────────────────
// Used only when the page exposes no readable board at all. Every pattern OPENS by pressing the
// direction the snake faces after a restart (right), because a reversal into its own neck is an instant
// death and would teach the sweep nothing. Horizontal legs are time-bounded (see `legMs`), so a board
// whose cell count and tick rate the driver cannot know in advance is still swept without suicide.

/** Boustrophedon walking downward: right, drop a row, left, drop a row. */
const PATTERN_SWEEP: Step[] = [
  { key: "ArrowRight", repeat: 9, gapMs: 110 },
  { key: "ArrowDown", repeat: 1, gapMs: 150 },
  { key: "ArrowLeft", repeat: 9, gapMs: 110 },
  { key: "ArrowDown", repeat: 1, gapMs: 150 }
]

/** The same sweep mirrored upward, so a second life explores the other half of the board. */
const PATTERN_WIDE: Step[] = [
  { key: "ArrowRight", repeat: 9, gapMs: 110 },
  { key: "ArrowUp", repeat: 1, gapMs: 150 },
  { key: "ArrowLeft", repeat: 9, gapMs: 110 },
  { key: "ArrowUp", repeat: 1, gapMs: 150 }
]

/** A tight loop: stresses the game's own turn handling and never approaches a wall. */
const PATTERN_LOOP: Step[] = [
  { key: "ArrowRight", repeat: 3, gapMs: 130 },
  { key: "ArrowDown", repeat: 3, gapMs: 130 },
  { key: "ArrowLeft", repeat: 3, gapMs: 130 },
  { key: "ArrowUp", repeat: 3, gapMs: 130 }
]

/** Every pattern, in the order the driver rotates them across attempts. */
const PATTERNS: readonly Step[][] = [PATTERN_SWEEP, PATTERN_WIDE, PATTERN_LOOP]

/** Matches a game-over announcement, in the languages a 简体中文-locale run may produce. */
const OVER_RE = /game\s*over|you\s*(lost|died|crashed)|游戏结束|游戏终止|\bgameover\b/i
/** Matches a restart affordance (a hint line or a control the page renders). */
const RESTART_RE = /restart|play\s*again|try\s*again|new\s*game|press\s+(enter|r\b|space)|按\s*(回车|r\b|空格)|重新开始|再玩/i
/** The key that undoes each direction; pressing it would reverse the snake into its own neck. */
const OPPOSITE: Record<string, string> = { ArrowRight: "ArrowLeft", ArrowLeft: "ArrowRight", ArrowUp: "ArrowDown", ArrowDown: "ArrowUp" }
/** The share of samples the board's colours must cover before the rest counts as an object. */
const BACKGROUND_COVER = 0.9
/** The largest share of the frame a colour may span and still be treated as board rather than an
 * object — a snake or a piece of food is compact, a board (even a gradient one) is not. */
const BOARD_SPAN = 0.3
/** The smallest region that can be a game object rather than sampling noise. */
const MIN_OBJECT_SAMPLES = 3
/** How many frames back the motion reference sits. A snake drawn as SEPARATE SEGMENTS only shows its
 * head moving between two consecutive frames; comparing against a frame this far back means the whole
 * chain has covered new ground, so every segment reads as snake and only the still food does not. */
const HISTORY_FRAMES = 10

/** Read `--<flag> <value>` off the command line, or `fallback` when absent/valueless. */
function arg(flag: string, fallback: string = ""): string {
  /** Index of the flag token, or -1 when the caller never passed it. */
  const index = process.argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1]
}

/** The UTF-8 sha256 of a buffer, as lowercase hex. */
function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex")
}

/** Every integer token in a string, in the order it appears. */
function integersIn(text: string): number[] {
  /** The collected values. */
  const out: number[] = []
  /** The shared matcher, reused so the loop allocates once. */
  const re = /-?\d+/g
  /** The current match, or null when the scan is done. */
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) out.push(Number(match[0]))
  return out
}

/** The number following a score-ish label, or null when the text carries no such label. */
function labelledScore(text: string): number | null {
  /** The first score/points label and the digits that follow it. */
  const match = text.match(/(?:score|points|得分|分数|分)\s*[:：=]?\s*(\d+)/i)
  return match === null ? null : Number(match[1])
}

/** Turn one snapshot of the visible text into a reading the score verdicts use. */
function readingOf(text: string): Reading {
  return { labelled: labelledScore(text), numbers: integersIn(text), text }
}

/** The paired-index increase between two readings of the same page, if exactly one token grew. */
function pairedIncrease(before: number[], after: number[]): { grew: boolean; index: number; from: number; to: number } {
  if (before.length !== after.length) return { grew: false, index: -1, from: 0, to: 0 }
  /** How many positions differ; more than one means the layout itself changed, not a counter. */
  let differing = 0
  /** The position that grew, or -1 while none has. */
  let grown = -1
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === after[index]) continue
    differing += 1
    if (after[index] > before[index]) grown = index
  }
  return differing === 1 && grown >= 0
    ? { grew: true, index: grown, from: before[grown], to: after[grown] }
    : { grew: false, index: -1, from: 0, to: 0 }
}

/** Read the page's visible text through the DOM the browser actually rendered. */
async function bodyText(page: PageLike): Promise<string> {
  return await page.evaluate(() => (document.body === null ? "" : document.body.innerText))
}

/** Read the visible text of every button-ish control, for the restart-affordance check. */
async function controlText(page: PageLike): Promise<string> {
  return await page.evaluate(() => {
    /** Every control whose label a user could read as an affordance. */
    const nodes = document.querySelectorAll("button, a, [role=button], [onclick]")
    /** The collected labels. */
    const labels: string[] = []
    for (let index = 0; index < nodes.length; index += 1) {
      /** The label the browser would render for this control. */
      const label = nodes[index].innerText ?? nodes[index].textContent ?? ""
      if (label.trim() !== "") labels.push(label.trim())
    }
    return labels.join(" | ")
  })
}

// ── the two board sensors ─────────────────────────────────────────────────────

/** Sample the page's first `<canvas>` into a coarse colour map, or null when there is none to read. */
async function canvasMap(page: PageLike): Promise<CanvasMap | null> {
  return await page.evaluate(() => {
    /** The first canvas on the page, if the game paints one at all. */
    const canvas = document.querySelector("canvas")
    if (canvas === null || typeof canvas.width !== "number" || typeof canvas.height !== "number") return null
    if (typeof canvas.getContext !== "function") return null
    /** The 2D context, or null for a WebGL-only canvas the pixel probe cannot read. */
    const ctx = canvas.getContext("2d")
    if (ctx === null) return null
    /** The backing-store size, which is what the samples index into. */
    const width = canvas.width
    /** The backing-store height. */
    const height = canvas.height
    if (width < 8 || height < 8) return null
    /** The RGBA buffer of the whole canvas. */
    const image = ctx.getImageData(0, 0, width, height).data
    /** Samples along the longer axis. */
    const cols = width >= height ? 72 : Math.max(8, Math.round((72 * width) / height))
    /** Samples along the shorter axis, so a sample stays roughly square. */
    const rows = width >= height ? Math.max(8, Math.round((72 * height) / width)) : 72
    /** The quantised colour keys, row-major. */
    const keys: number[] = []
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        /** The sampled pixel, at the centre of this grid cell. */
        const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / cols))
        /** The sampled row. */
        const y = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / rows))
        /** The offset of that pixel in the row-major RGBA buffer. */
        const offset = (y * width + x) * 4
        // Five bits per channel: exact for flat fills, and it merges the antialiasing fringe of a
        // stroked grid or a rounded corner into one key.
        keys.push(((image[offset] >> 3) << 10) | ((image[offset + 1] >> 3) << 5) | (image[offset + 2] >> 3))
      }
    }
    return { cols, rows, keys }
  })
}

/**
 * Sample a page painted with ordinary ELEMENTS — no canvas — into the same coarse colour map.
 *
 * WHY THIS EXISTS: a snake drawn as positioned `<div>`s is just as playable as one drawn on a canvas,
 * and a driver that could only see a canvas would report its own blindness as the game's defect. The
 * input here is still only what a person sees — the PAINTED BOX of each element and the colour it was
 * painted in — never the code that positioned it. The frame is anchored on the smallest opaque box that
 * still holds the game's cells (the board), so it stays put while the snake moves and two frames stay
 * comparable.
 */
async function domBoxMap(page: PageLike): Promise<CanvasMap | null> {
  return await page.evaluate(() => {
    /** Every visible, opaque element with a painted box. */
    const raw: Array<{ x: number; y: number; w: number; h: number; key: number }> = []
    /** All elements, which is affordable because this path only runs when there is no canvas. */
    const nodes = document.querySelectorAll("*")
    for (let index = 0; index < nodes.length; index += 1) {
      /** The element under inspection. */
      const element = nodes[index]
      if (typeof element.getBoundingClientRect !== "function") continue
      /** Its painted box in viewport coordinates. */
      const rect = element.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) continue
      /** The resolved style, so a transparent wrapper is not mistaken for a game object. */
      const style = getComputedStyle(element)
      if (style.display === "none" || style.visibility === "hidden") continue
      /** The painted background, parsed; anything transparent or unparsable is skipped. */
      const match = style.backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/)
      if (match === null) continue
      /** Alpha below a half means the element paints essentially nothing of its own. */
      const alpha = match[4] === undefined ? 1 : Number(match[4])
      if (alpha < 0.5) continue
      raw.push({
        x: rect.left, y: rect.top, w: rect.width, h: rect.height,
        key: ((Number(match[1]) >> 3) << 10) | ((Number(match[2]) >> 3) << 5) | (Number(match[3]) >> 3)
      })
    }
    if (raw.length < 2) return null
    /** The box areas, used to separate game cells from their container. */
    const areas = raw.map((box) => box.w * box.h).sort((a, b) => a - b)
    /** The middle area: cells are uniform, so the median IS a cell. */
    const median = areas[Math.floor(areas.length / 2)]
    /** Anything at most three times the median is a cell. */
    const cellLimit = Math.max(median * 3, 36)
    /** The game's own boxes. */
    const cells = raw.filter((box) => box.w * box.h <= cellLimit)
    if (cells.length < 2) return null
    /** The SMALLEST box that is not a cell but still holds the cells: the board, not the page. The
     * page's own background would also qualify, and anchoring on it would spend most of the samples on
     * empty margin and leave a game cell under-sampled. */
    let anchor: { x: number; y: number; w: number; h: number; key: number } | null = null
    for (const box of raw) {
      if (box.w * box.h <= cellLimit) continue
      /** How many of the game's cells this box actually contains. */
      let inside = 0
      for (const cell of cells) {
        if (cell.x >= box.x && cell.x <= box.x + box.w && cell.y >= box.y && cell.y <= box.y + box.h) inside += 1
      }
      if (inside < cells.length * 0.8) continue
      if (anchor === null || box.w * box.h < anchor.w * anchor.h) anchor = box
    }
    if (anchor === null) {
      // No containing box: the game paints straight into the page, so use the biggest paint there is.
      for (const box of raw) {
        if (box.w * box.h <= cellLimit) continue
        if (anchor === null || box.w * box.h > anchor.w * anchor.h) anchor = box
      }
    }
    if (anchor === null) return null
    /** Samples along the longer side of the board. */
    const cols = anchor.w >= anchor.h ? 72 : Math.max(8, Math.round((72 * anchor.w) / anchor.h))
    /** Samples along the other side, keeping a sample roughly square. */
    const rows = anchor.w >= anchor.h ? Math.max(8, Math.round((72 * anchor.h) / anchor.w)) : 72
    /** The grid, pre-filled with the board's own colour so unmoved samples stay comparable. */
    const keys: number[] = new Array(cols * rows).fill(anchor.key)
    for (const cell of cells) {
      /** The first sample column the cell covers. */
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(((cell.x - anchor.x) / anchor.w) * cols)))
      /** The first sample row the cell covers. */
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(((cell.y - anchor.y) / anchor.h) * rows)))
      /** How many sample columns the cell spans, so a cell is not reduced to a single dot. */
      const spanX = Math.max(1, Math.round((cell.w / anchor.w) * cols))
      /** How many sample rows the cell spans. */
      const spanY = Math.max(1, Math.round((cell.h / anchor.h) * rows))
      for (let dy = 0; dy < spanY; dy += 1) {
        for (let dx = 0; dx < spanX; dx += 1) {
          /** The sample this cell corner lands on. */
          const x = gx + dx
          /** The sample row this cell corner lands on. */
          const y = gy + dy
          if (x < cols && y < rows) keys[y * cols + x] = cell.key
        }
      }
    }
    return { cols, rows, keys }
  })
}

// ── reading the scene out of a coarse colour map ───────────────────────────────

/** The colour histogram of a map, as `[key, count]` pairs, most common first. */
function histogram(map: CanvasMap): Array<[number, number]> {
  /** Occurrences per quantised colour. */
  const counts = new Map<number, number>()
  for (const key of map.keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * The extent of one colour's samples in a frame.
 * @param map - The frame to measure in.
 * @param key - The colour to measure.
 * @returns Its bounding box in sample coordinates, or null when the colour is absent.
 */
function colourBounds(map: CanvasMap, key: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  /** The running bounds. */
  const state = { minX: Number.MAX_SAFE_INTEGER, minY: Number.MAX_SAFE_INTEGER, maxX: -1, maxY: -1 }
  for (let index = 0; index < map.keys.length; index += 1) {
    if (map.keys[index] !== key) continue
    /** The sample's column. */
    const x = index % map.cols
    /** The sample's row. */
    const y = (index - x) / map.cols
    if (x < state.minX) state.minX = x
    if (x > state.maxX) state.maxX = x
    if (y < state.minY) state.minY = y
    if (y > state.maxY) state.maxY = y
  }
  return state.maxX < 0 ? null : state
}

/**
 * The colours that make up the BOARD: the fewest most-common colours that explain most of the frame.
 *
 * A flat board, a board with a gradient, and a board with gridlines all reduce to the same idea — the
 * board is whatever the engine paints over and over, SPREAD ACROSS THE FRAME. The second condition is
 * load-bearing and was MEASURED: the live artifact paints an outer rectangle plus a slightly lighter
 * inner one, and a rule that took only the most common colour left the inner rectangle in the object
 * mask — where it became one huge region, swallowed the snake drawn on top of it, and was itself
 * filtered out as decoration, blinding the driver completely. The span test keeps that fix from also
 * swallowing the snake: a colour that covers a small part of the frame is an OBJECT however common.
 * @param palette - The frame's colours, most common first.
 * @param map - The frame the palette belongs to.
 * @returns The set of colours treated as board.
 */
function backgroundColours(palette: Array<[number, number]>, map: CanvasMap): Set<number> {
  /** The accumulating set. */
  const set = new Set<number>()
  /** How many samples the set explains so far. */
  let covered = 0
  for (const [key, count] of palette) {
    if (set.size > 0 && covered >= map.keys.length * BACKGROUND_COVER) break
    /** Where this colour sits. */
    const bounds = colourBounds(map, key)
    if (bounds === null) continue
    /** The share of the frame this colour's bounding box spans. */
    const span = ((bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1)) / (map.cols * map.rows)
    if (set.size > 0 && span < BOARD_SPAN) continue
    set.add(key)
    covered += count
  }
  return set
}

/**
 * Mark every sample that is not board.
 * @param map - The frame to mask.
 * @param background - The colours treated as board.
 * @returns One byte per sample: 1 where something is painted over the board.
 */
function objectMask(map: CanvasMap, background: Set<number>): Uint8Array {
  /** The mask. */
  const mask = new Uint8Array(map.keys.length)
  for (let index = 0; index < map.keys.length; index += 1) mask[index] = background.has(map.keys[index]) ? 0 : 1
  return mask
}

/**
 * Every connected region of an object mask, four-connected, at least `MIN_OBJECT_SAMPLES` big.
 *
 * CONNECTIVITY IS THE POINT. A snake drawn as one outline and a snake drawn as a chain of separate
 * cells both resolve into regions here, and so does an antialiased or glowing object whose pixels are
 * dozens of different colours — because the mask throws the colours away and keeps only "board or not".
 * @param map - The frame the mask belongs to.
 * @param mask - The object mask.
 * @returns The regions, in scan order.
 */
function blobsOf(map: CanvasMap, mask: Uint8Array): Blob[] {
  /** Whether a sample already belongs to a region. */
  const seen = new Uint8Array(map.keys.length)
  /** The regions found. */
  const blobs: Blob[] = []
  /** The frontier, reused between regions. */
  const stack: number[] = []
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (mask[seed] === 0 || seen[seed] === 1) continue
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1
    /** This region's samples. */
    const indices: number[] = []
    /** Its running extent and sums. */
    const state = { minX: Number.MAX_SAFE_INTEGER, minY: Number.MAX_SAFE_INTEGER, maxX: -1, maxY: -1, sumX: 0, sumY: 0 }
    /** How many samples of each colour it carries. */
    const colours = new Map<number, number>()
    while (stack.length > 0) {
      /** The sample being expanded. */
      const index = stack.pop() as number
      indices.push(index)
      /** Its column. */
      const x = index % map.cols
      /** Its row. */
      const y = (index - x) / map.cols
      state.sumX += x
      state.sumY += y
      if (x < state.minX) state.minX = x
      if (x > state.maxX) state.maxX = x
      if (y < state.minY) state.minY = y
      if (y > state.maxY) state.maxY = y
      /** The colour painted at this sample. */
      const colour = map.keys[index]
      colours.set(colour, (colours.get(colour) ?? 0) + 1)
      // Four-connected: two squares that only meet at a corner are not one object.
      /** The four neighbours, or -1 where the sample sits on an edge. */
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < map.cols - 1 ? index + 1 : -1,
        y > 0 ? index - map.cols : -1,
        y < map.rows - 1 ? index + map.cols : -1
      ]
      for (const neighbour of neighbours) {
        if (neighbour < 0 || mask[neighbour] === 0 || seen[neighbour] === 1) continue
        seen[neighbour] = 1
        stack.push(neighbour)
      }
    }
    if (indices.length < MIN_OBJECT_SAMPLES) continue
    /** The colour this region is mostly painted in. */
    let colour = -1
    /** The largest per-colour count seen. */
    let best = -1
    for (const [key, count] of colours) if (count > best) { best = count; colour = key }
    blobs.push({
      size: indices.length, indices,
      minX: state.minX, minY: state.minY, maxX: state.maxX, maxY: state.maxY,
      meanX: state.sumX / indices.length, meanY: state.sumY / indices.length,
      fresh: 0, colour
    })
  }
  return blobs
}

/**
 * Read the scene — head, food, palette — out of a coarse colour map and its predecessor.
 *
 * THE RULE THE DRIVER ACTUALLY USES: a game object is a REGION of the frame that is not board, and the
 * SNAKE is the region that MOVED — measured as samples it now covers that were board a moment ago.
 * Colour is never used to identify anything, because a real game animates: the live artifact's food
 * pulses with a glow, so its pixels change every single frame while its POSITION does not. A rule that
 * asked "which colours changed?" would call that food the snake and find no target at all; a rule that
 * asks "which regions moved?" gets both right.
 * @param previous - The frame sampled before this one, used only to detect a FROZEN board.
 * @param reference - A frame several samples back, used to decide what MOVED.
 * @param current - The frame sampled now.
 * @param facing - The direction the snake was last commanded to face.
 * @returns What the driver can see of the game right now.
 */
function readScene(previous: CanvasMap | null, reference: CanvasMap | null, current: CanvasMap, facing: string): Scene {
  /** How many samples the engine repainted at all, which is zero for a frozen board. */
  let changed = 0
  if (previous !== null && previous.keys.length === current.keys.length) {
    for (let index = 0; index < current.keys.length; index += 1) {
      if (current.keys[index] !== previous.keys[index]) changed += 1
    }
  }
  // WITHOUT A PREVIOUS FRAME THERE IS NOTHING TO DIFFERENCE, and motion is the only thing that tells
  // the snake from the food. So the first frame is deliberately classified as "nothing seen" and the
  // caller simply keeps the snake moving until a second frame exists.
  if (reference === null || reference.keys.length !== current.keys.length) {
    /** The first frames' palette, for the caller's evidence line only. */
    const firstPalette = histogram(current)
    return { head: -1, food: -1, background: firstPalette.length === 0 ? -1 : firstPalette[0][0], snake: -1, foodColour: -1, changed }
  }
  /** The palette, most common colour first. */
  const palette = histogram(current)
  /** The board's dominant colour, quoted in the evidence line. */
  const background = palette.length === 0 ? -1 : palette[0][0]
  /** What the board was several samples AGO, recomputed so the two frames are compared on equal terms. */
  const objectBefore = objectMask(reference, backgroundColours(histogram(reference), reference))
  /** What is painted on the board now. */
  const blobs = blobsOf(current, objectMask(current, backgroundColours(palette, current)))
  if (blobs.length === 0) return { head: -1, food: -1, background, snake: -1, foodColour: -1, changed }
  for (const blob of blobs) {
    /** How many of this region's samples were board a moment ago. */
    let fresh = 0
    for (const index of blob.indices) if (objectBefore[index] === 0) fresh += 1
    blob.fresh = fresh
  }
  /**
   * A region whose bounding box spans most of the board in BOTH directions is decoration: a grid, a
   * frame, a border. It is never a snake small enough to steer and never a single piece of food.
   * @param blob - The region to judge.
   * @returns True when the region is decoration.
   */
  const isDecoration = (blob: Blob): boolean =>
    (blob.maxX - blob.minX + 1) > 0.45 * current.cols && (blob.maxY - blob.minY + 1) > 0.45 * current.rows
  /** Every region that could be a game object. */
  const objects = blobs.filter((blob) => !isDecoration(blob))
  if (objects.length === 0) return { head: -1, food: -1, background, snake: -1, foodColour: -1, changed }
  // A region that covers ground it did not cover before has MOVED. Between two samples inside one game
  // tick nothing moves, so the fallback — the biggest object — is what carries those frames.
  /** The regions that moved. */
  const moved = objects.filter((blob) => blob.fresh > 0)
  /** The regions treated as the snake. */
  const snakeBlobs = moved.length > 0 ? moved : objects.slice().sort((a, b) => b.size - a.size).slice(0, 1)
  /** Every sample the snake covers. */
  const snakeSamples = new Set<number>()
  for (const blob of snakeBlobs) for (const index of blob.indices) snakeSamples.add(index)
  /** The bounding box of the whole snake, used to reject detail painted INSIDE it (eyes, highlights). */
  const snakeBox = {
    minX: Math.min(...snakeBlobs.map((blob) => blob.minX)),
    minY: Math.min(...snakeBlobs.map((blob) => blob.minY)),
    maxX: Math.max(...snakeBlobs.map((blob) => blob.maxX)),
    maxY: Math.max(...snakeBlobs.map((blob) => blob.maxY))
  }
  /**
   * How far along the direction the snake faces a sample lies; the largest value is the head.
   * @param index - The sample index to project.
   * @returns The projection, larger meaning more toward the front.
   */
  const projection = (index: number): number => {
    /** The sample's column. */
    const x = index % current.cols
    /** The sample's row. */
    const y = (index - x) / current.cols
    if (facing === "ArrowRight") return x
    if (facing === "ArrowLeft") return -x
    if (facing === "ArrowDown") return y
    return -y
  }
  /** The index of the leading tip, or -1. */
  let head = -1
  /** The best projection seen. */
  let best = -Infinity
  for (const index of snakeSamples) {
    /** This sample's projection onto the facing axis. */
    const score = projection(index)
    if (score > best) { best = score; head = index }
  }
  // The food is the smallest object that is neither the snake nor something painted inside the snake.
  // Smallest, because the food is always one piece while a growing snake is many — and because
  // decoration big enough to matter has already been filtered out above.
  /** The candidate food regions. */
  const candidates = objects
    .filter((blob) => !snakeBlobs.includes(blob))
    .filter((blob) => !(blob.meanX >= snakeBox.minX && blob.meanX <= snakeBox.maxX && blob.meanY >= snakeBox.minY && blob.meanY <= snakeBox.maxY))
    .filter((blob) => blob.size <= 0.25 * current.keys.length)
  /**
   * Sort the candidates: regions clear of the canvas edge first, then the smallest.
   * @param a - The left candidate.
   * @param b - The right candidate.
   * @returns Negative when `a` should be preferred.
   */
  const prefer = (a: Blob, b: Blob): number => {
    /** Whether a region touches the frame's border, where rounded corners leave their own fragments. */
    const edgeA = a.minX === 0 || a.minY === 0 || a.maxX === current.cols - 1 || a.maxY === current.rows - 1 ? 1 : 0
    /** The same for the right candidate. */
    const edgeB = b.minX === 0 || b.minY === 0 || b.maxX === current.cols - 1 || b.maxY === current.rows - 1 ? 1 : 0
    return edgeA === edgeB ? a.size - b.size : edgeA - edgeB
  }
  candidates.sort(prefer)
  /** The region chosen as the food, or null. */
  const foodBlob: Blob | null = candidates.length === 0 ? null : candidates[0]
  /** The food's sample position, converted to an index. */
  const food = foodBlob === null ? -1 : Math.round(foodBlob.meanY) * current.cols + Math.round(foodBlob.meanX)
  return {
    head, food, background,
    snake: snakeBlobs[0]?.colour ?? -1,
    foodColour: foodBlob === null ? -1 : foodBlob.colour,
    changed
  }
}

// ── the driver ────────────────────────────────────────────────────────────────

/** Absolute path of the page under test, as the caller passed it. */
const PAGE_PATH = resolve(arg("page"))
/** Evidence directory the rows and screenshots are written into. */
const OUT_DIR = resolve(arg("out", "."))
/** Label distinguishing this run's artifacts from the negative control's. */
const LABEL = arg("label", "run")
/** Wall-clock budget for the steering phase, in milliseconds. */
const BUDGET_MS = Number(arg("budget-ms", "90000"))
/** Optional free-text note recorded on every row, e.g. which artifact this run drove. */
const NOTE = arg("note", "")

mkdirSync(OUT_DIR, { recursive: true })
/** The NDJSON assertion ledger for this label. */
const ROW_FILE = join(OUT_DIR, LABEL + ".ndjson")
writeFileSync(ROW_FILE, "")

/** The accumulated rows, in emission order. */
const rows: Row[] = []

/** Append one row to the ledger and echo it to stdout. */
function record(name: string, ok: boolean | null, reason: string, raw: string): void {
  /** The row as recorded. */
  const row: Row = { name, ok, reason, raw: NOTE === "" ? raw : raw + " | note=" + NOTE }
  rows.push(row)
  appendFileSync(ROW_FILE, JSON.stringify(row) + "\n")
  console.log(`[${ok === true ? "PASS" : ok === false ? "FAIL" : "NULL"}] ${name}: ${reason} :: ${row.raw}`)
}

/** Screenshot into the evidence dir and return its path, hash and size. */
async function shoot(page: PageLike, name: string): Promise<{ path: string; sha: string; bytes: number }> {
  /** Where the PNG lands. */
  const path = join(OUT_DIR, LABEL + "-" + name + ".png")
  /** The rendered bytes. */
  const buffer = await page.screenshot({ path, type: "png" })
  return { path, sha: sha256(buffer), bytes: buffer.length }
}

// The playwright surface is loaded through `createRequire` on purpose: playwright is installed in the
// CONTAINER beside this file's `node_modules` symlink, never in the repository, so a static import
// could not resolve and would not typecheck.
/** CommonJS require bound to this module, so the container's playwright can be loaded by path. */
const requireFromHere = createRequire(import.meta.url)
/** The resolved playwright chromium launcher, or null when the toolchain is absent. */
let chromium: ChromiumLike | null = null
try {
  chromium = (requireFromHere("playwright") as { chromium: ChromiumLike }).chromium
} catch (error) {
  record("snake.driverStarted", false, "playwright did not resolve from this file's node_modules", String(error).slice(0, 300))
  console.log("driver-exit=2")
  process.exit(2)
}

/** The launcher, once the try/catch above proved it exists. */
const launcher: ChromiumLike = chromium as ChromiumLike

/** Uncaught errors the page raised over the whole run. */
const pageErrors: string[] = []
/** Console errors the page emitted (a page that throws into the console is not a healthy page). */
const consoleErrors: string[] = []
/** Every URL the page requested, in order. */
const requests: string[] = []

/** The browser, or null when the launch itself failed. */
let browser: BrowserLike | null = null
try {
  browser = await launcher.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
} catch (error) {
  record("snake.browserLaunched", false, "chromium did not start inside this container", String(error).slice(0, 400))
  console.log("driver-exit=2")
  process.exit(2)
}
/** The started browser. */
const running: BrowserLike = browser

/** A fresh context; the viewport is fixed so screenshots are comparable byte-for-byte. */
const context = await running.newContext({ viewport: { width: 900, height: 700 } })
/** The page under test. */
const page = await context.newPage()
page.on("pageerror", (error) => { pageErrors.push(String(error)) })
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
page.on("request", (request) => { requests.push(request.url()) })

record("snake.driverStarted", true, "chromium launched and the page opened in a real engine", `browser=${running.version()} page=${pathToFileURL(PAGE_PATH).href}`)

try {
  await page.goto(pathToFileURL(PAGE_PATH).href, { waitUntil: "load", timeout: 20000 })
} catch (error) {
  record("snake.loaded", false, "the page never reached its load event", String(error).slice(0, 300))
  await running.close()
  console.log("driver-exit=1")
  process.exit(1)
}
await page.waitForTimeout(1000)

/** The visible-text reading before any input. */
const startReading = readingOf(await bodyText(page))
/** The screenshot at rest, before the first key. */
const shotStart = await shoot(page, "01-start")

// ── assertion 1 (precondition of the score arm): a visible score number exists ─
record(
  "snake.scoreVisible",
  startReading.labelled !== null || startReading.numbers.length > 0,
  startReading.labelled !== null
    ? "a score-labelled number is visible on the page"
    : startReading.numbers.length > 0
      ? "no score label, but numeric counters are visible (the score arm falls back to paired-token growth)"
      : "the page shows NO number at all: a game whose score a player cannot see is a finding",
  `labelled=${startReading.labelled} numbers=[${startReading.numbers.join(",").slice(0, 120)}] chars=${startReading.text.length}`
)

// ── assertion (c) probe: the picture changes once the snake is driven ────────
await page.keyboard.press("ArrowRight")
await page.waitForTimeout(650)
/** The screenshot after the first real key press. */
const shotMoved = await shoot(page, "02-after-first-key")
/** Whether the rendered picture differs from the at-rest one. */
const moved = shotMoved.sha !== shotStart.sha

// ── the steering phase: eat, restarting dead lives, until the budget runs out ─
/** Epoch ms after which steering stops, whether or not the score grew. */
const deadline = Date.now() + BUDGET_MS
/** How many times a game-over state was seen and a restart was attempted. */
let restarts = 0
/** The reading the score comparisons are made against; refreshed after each restart. */
let baseline = startReading
/** Set once a strict score increase is observed. */
let scoreGrew = false
/** Which method established the increase. */
let scoreMethod = "none"
/** The before/after values quoted into the score row. */
let scoreDelta = "from=0 to=0"
/** When the score grew, the screenshot of that moment. */
let shotEaten: { path: string; sha: string; bytes: number } | null = null

/**
 * Judge one snapshot against the baseline, and on a strict increase latch the score verdict.
 * @param text - The page's visible text at this probe.
 * @returns True once a strict increase has been established.
 */
async function probe(text: string): Promise<boolean> {
  if (scoreGrew) return true
  /** The reading derived from this snapshot. */
  const now = readingOf(text)
  if (now.labelled !== null && baseline.labelled !== null && now.labelled > baseline.labelled) {
    scoreGrew = true
    scoreMethod = "labelled"
    scoreDelta = `from=${baseline.labelled} to=${now.labelled}`
    shotEaten = await shoot(page, "03-after-eating")
    return true
  }
  /** The paired-token increase, used when no score label is visible. */
  const paired = pairedIncrease(baseline.numbers, now.numbers)
  if (now.labelled === null && paired.grew) {
    scoreGrew = true
    scoreMethod = "paired-token"
    scoreDelta = `idx=${paired.index} from=${paired.from} to=${paired.to}`
    shotEaten = await shoot(page, "03-after-eating")
    return true
  }
  return false
}

/** Restart a finished life and re-baseline the score reading afterwards. */
async function restartLife(): Promise<void> {
  restarts += 1
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
  await page.keyboard.press("r")
  await page.waitForTimeout(700)
  baseline = readingOf(await bodyText(page))
}

// ── strategy A: read the game's own board and walk the head onto the food ────
// A GAME THAT ALREADY ENDED LOOKS EXACTLY LIKE A GAME THAT NEVER STARTED: a frozen board. Neither can
// be driven, and measuring the score arm against one of them would report the DRIVER's failure as the
// page's. So the driver guarantees a live board before it starts, and keeps checking while it plays.
if (OVER_RE.test(await bodyText(page))) {
  console.log("[sensor] the board was already finished when the driver arrived; restarting it once")
  await restartLife()
}
/** The direction the driver last commanded, which is also the direction the snake should face. */
let commanded = "ArrowRight"
/** WHICH SENSOR THIS PAGE ADMITS: the canvas it paints, the boxes it lays out, or neither. */
let mapSensor: "canvas" | "dom" | "none" = "none"
/** The previous coarse colour map, so the snake's region can be isolated by what MOVED. */
let previousMap: CanvasMap | null = await canvasMap(page)
/** The frames sampled so far, oldest first; the oldest one is the motion reference. */
const history: CanvasMap[] = []
if (previousMap !== null) mapSensor = "canvas"
if (previousMap === null) {
  previousMap = await domBoxMap(page)
  if (previousMap !== null) mapSensor = "dom"
}
/** Whether the page exposes a readable board at all; without one only the blind sweep is left. */
const hasSensor = mapSensor !== "none"
/** How many sensor-steering iterations ran. */
let sensorSteps = 0
/** How many of those found no head or no food. */
let sensorBlind = 0
/** How many consecutive frames repainted NOTHING. A frozen board is a finished or stalled game. */
let frozenFrames = 0
/** The last frame's classification, for the row's evidence. */
let lastPalette = "none"
/** The food the driver last saw, reused for a few frames when the target briefly disappears. */
let lastFood = -1
/** How many frames the last known food has been carried without being re-seen. */
let lastFoodAge = 0

if (hasSensor) {
  /** The sensor strategy's share of the budget; the blind sweep gets the rest as a second chance. */
  const sensorDeadline = Date.now() + Math.round(BUDGET_MS * 0.7)
  while (!scoreGrew && Date.now() < sensorDeadline) {
    /** The frame sampled now, through whichever sensor this page admits. */
    const current = mapSensor === "canvas" ? await canvasMap(page) : await domBoxMap(page)
    if (current === null) break
    /** Everything the driver can see of the game right now. */
    const scene = readScene(previousMap, history[0] ?? null, current, commanded)
    previousMap = current
    history.push(current)
    if (history.length > HISTORY_FRAMES) history.shift()
    sensorSteps += 1
    lastPalette = `bg=${scene.background} snake=${scene.snake} food=${scene.foodColour}`
    frozenFrames = scene.changed === 0 ? frozenFrames + 1 : 0
    if (frozenFrames >= 10) {
      // Nothing has been repainted for about a second. Either the game ended without saying so in
      // text, or it is waiting for something the driver cannot see; in both cases the only move left
      // is to ask for a fresh board and watch again.
      console.log(`[sensor] the board has been frozen for ${frozenFrames} frames; asking for a restart`)
      await restartLife()
      previousMap = null
      history.length = 0
      commanded = "ArrowRight"
      frozenFrames = 0
      continue
    }
    if (scene.head < 0) {
      sensorBlind += 1
      // Nothing to aim at yet: keep the snake alive and moving while the next frame is sampled.
      await page.keyboard.press(commanded)
      await page.waitForTimeout(80)
      if (sensorBlind > 60) break
      continue
    }
    // The food can vanish for a frame — it was just eaten, or the snake crawled over it — and going
    // blind exactly then would throw the run away. The LAST position is reused briefly, then dropped.
    if (scene.food >= 0) { lastFood = scene.food; lastFoodAge = 0 } else { lastFoodAge += 1 }
    /** The sample the driver aims at, or -1 when it has no idea where the food is. */
    const target = lastFoodAge <= 8 ? lastFood : -1
    /** The head's sample column. */
    const headX = scene.head % current.cols
    /** The head's sample row. */
    const headY = (scene.head - headX) / current.cols
    if (target < 0) {
      sensorBlind += 1
      await page.keyboard.press(commanded)
      await page.waitForTimeout(80)
      if (sensorBlind > 60) break
      continue
    }
    /** The food's sample column. */
    const foodX = target % current.cols
    /** The food's sample row. */
    const foodY = (target - foodX) / current.cols
    /** The horizontal gap to the food, in samples. */
    const dx = foodX - headX
    /** The vertical gap to the food. */
    const dy = foodY - headY
    /** The key that closes the larger gap. */
    const preferred = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "ArrowRight" : "ArrowLeft") : (dy >= 0 ? "ArrowDown" : "ArrowUp")
    /** The key that closes the other axis, used when the preferred one would reverse the snake. */
    const alternate = Math.abs(dx) >= Math.abs(dy) ? (dy >= 0 ? "ArrowDown" : "ArrowUp") : (dx >= 0 ? "ArrowRight" : "ArrowLeft")
    /** The key actually pressed. */
    const chosen = OPPOSITE[commanded] === preferred ? alternate : preferred
    commanded = chosen
    await page.keyboard.press(chosen)
    await page.waitForTimeout(70)
    // The score lives in the text, not in the board, so it is read on a cadence rather than per tick.
    if (sensorSteps % 6 === 0) {
      /** The visible text at this probe. */
      const text = await bodyText(page)
      if (await probe(text)) break
      if (OVER_RE.test(text) && !OVER_RE.test(startReading.text)) {
        await restartLife()
        previousMap = null
        history.length = 0
        commanded = "ArrowRight"
        lastFood = -1
        lastFoodAge = 0
      }
    }
  }
  console.log(`[sensor] steps=${sensorSteps} blind=${sensorBlind} sensor=${mapSensor} palette=${lastPalette} scoreGrew=${scoreGrew}`)
}

// ── strategy B: sweep blindly, restarting dead lives, shrinking the leg on death ─
/** Which pattern the sweep is currently walking. */
let patternIndex = 0
/** The sweep's steering attempts, for the row's evidence. */
let attempts = 0
/** Leg length in ms; a leg that ended in a wall was longer than the room in front of the snake. */
let legMs = 620
/** Consecutive cycles that ended without a death, which lengthen the leg again. */
let cleanCycles = 0

/**
 * Press one key repeatedly for a fixed wall-clock window, probing the score while it runs.
 * @param key - The key to hold.
 * @param milliseconds - How long to keep pressing it.
 * @returns True when the game ended during the leg.
 */
async function leg(key: string, milliseconds: number): Promise<boolean> {
  /** When this leg stops. */
  const until = Date.now() + milliseconds
  /** How many presses this leg has issued, so the score is probed on a cadence. */
  let presses = 0
  while (Date.now() < until && Date.now() < deadline) {
    await page.keyboard.press(key)
    presses += 1
    await page.waitForTimeout(55)
    if (presses % 5 !== 0) continue
    /** The visible text at this probe. */
    const text = await bodyText(page)
    if (await probe(text)) return true
    if (OVER_RE.test(text) && !OVER_RE.test(startReading.text)) return true
  }
  return false
}

while (!scoreGrew && Date.now() < deadline) {
  /** The pattern this attempt walks. */
  const pattern = PATTERNS[patternIndex % PATTERNS.length]
  patternIndex += 1
  attempts += 1
  /** How many legs were walked before the life ended or the sweep was cut off. */
  let legs = 0
  /** Set when this attempt ended in a wall or a self-collision. */
  let died = false
  for (let round = 0; round < 12 && !scoreGrew && !died; round += 1) {
    for (const step of pattern) {
      if (scoreGrew || Date.now() > deadline) break
      /** A long horizontal leg is time-bounded by the adaptive length; the others keep their own. */
      const isLongHorizontal = (step.key === "ArrowLeft" || step.key === "ArrowRight") && step.repeat >= 5
      const ended = await leg(step.key, isLongHorizontal ? legMs : step.repeat * step.gapMs)
      if (scoreGrew) break
      if (ended) { died = true; legs += 1; break }
      if (isLongHorizontal) legs += 1
    }
    if (died) break
  }
  if (scoreGrew) break
  if (died) {
    // A wall ended the life. The death is evidence that the leg was longer than the room in front of
    // the snake, but the floor matters: legs that get too short stop covering ground at all.
    legMs = Math.max(320, Math.round(legMs * 0.8))
    cleanCycles = 0
    await restartLife()
  } else {
    cleanCycles += 1
    if (cleanCycles >= 2) { legMs = Math.min(1100, Math.round(legMs * 1.2)); cleanCycles = 0 }
  }
  console.log(`[drive] attempt=${attempts} pattern=${(patternIndex - 1) % PATTERNS.length} legMs=${legMs} restarts=${restarts} legs=${legs} at=${Date.now() - (deadline - BUDGET_MS)}ms`)
}

record(
  "snake.scoreIncreased",
  scoreGrew,
  scoreGrew
    ? `the visible score grew while the snake was driven with real key events (method=${scoreMethod})`
    : `the score never grew in ${BUDGET_MS}ms of driving — the snake never reached its own food`,
  `${scoreDelta} restarts=${restarts} attempts=${attempts} sensor=${mapSensor} sensorSteps=${sensorSteps} sensorBlind=${sensorBlind} palette=${lastPalette}`
)

record(
  "snake.visuallyMoved",
  moved,
  moved
    ? "the rendered viewport changed after a real key press (the snake is drawn where the game moved it)"
    : "the rendered viewport is IDENTICAL before and after a real key press — the picture never moved",
  `start=${shotStart.sha.slice(0, 16)}/${shotStart.bytes}B after=${shotMoved.sha.slice(0, 16)}/${shotMoved.bytes}B`
)

// ── assertion (d): steer into a wall and require a game-over state or a stop ──
/** The visible-text reading the wall drive starts from. */
let preWall = readingOf(await bodyText(page))
if (OVER_RE.test(preWall.text)) {
  // A life that has ALREADY ended cannot be steered into a wall, so the arm would measure the previous
  // death instead of this drive. Bring the game back first; the restart is counted like every other.
  await restartLife()
  preWall = readingOf(await bodyText(page))
}
/** The screenshot the wall drive starts from. */
const shotPreWall = await shoot(page, "04-before-wall")
/** Set when a game-over announcement appears that the resting page did not carry. */
let overSeen = false
/** The final visible text of the wall drive. */
let wallText = preWall.text
// Pressing the SAME direction cannot reverse the snake into itself, so the only thing this can end on
// is the wall the prompt promises — or nothing at all, which is itself the finding.
for (let press = 0; press < 45; press += 1) {
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(170)
  wallText = await bodyText(page)
  if (OVER_RE.test(wallText) && !OVER_RE.test(preWall.text)) { overSeen = true; break }
}
// A game that wraps at the wall (instead of dying) needs the self-collision route before the arm can
// be judged; a tight loop is the black-box way to ask for it without reading the source.
if (!overSeen) {
  for (let round = 0; round < 8 && !overSeen; round += 1) {
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press(key)
        await page.waitForTimeout(140)
        wallText = await bodyText(page)
        if (OVER_RE.test(wallText) && !OVER_RE.test(preWall.text)) { overSeen = true; break }
      }
      if (overSeen) break
    }
  }
}
/** The reading after the wall drive settled. */
const afterWall = readingOf(wallText)
/** Whether the score counter stopped over the wall drive. */
const scoreStopped = afterWall.labelled !== null && preWall.labelled !== null
  ? afterWall.labelled === preWall.labelled
  : JSON.stringify(afterWall.numbers) === JSON.stringify(preWall.numbers)
/** The controls visible after the wall drive. */
const afterControls = await controlText(page)
/** Whether a restart affordance is visible now. */
const restartAffordance = RESTART_RE.test(afterWall.text) || RESTART_RE.test(afterControls)
/** Which of the two contract branches carried the verdict. */
const overBranch = overSeen ? "game-over-text" : scoreStopped && restartAffordance ? "score-stopped+restart-affordance" : "none"
/** The screenshot of the final state, labelled by what it actually shows. */
const shotEnd = await shoot(page, overSeen ? "05-game-over" : "05-final")

record(
  "snake.gameOverOrRestart",
  overSeen || (scoreStopped && restartAffordance),
  overSeen
    ? "driving into the wall produced a game-over announcement the resting page did not carry"
    : scoreStopped && restartAffordance
      ? "the score stopped and the page offers a restart affordance"
      : "after steering into the wall the page neither announced a game over nor stopped the score with a restart affordance",
  `branch=${overBranch} overSeen=${overSeen} scoreStopped=${scoreStopped} restartAffordance=${restartAffordance} wallChars=${wallText.length} beforeWall=${shotPreWall.bytes}B`
)

// ── assertion (a): no uncaught page error over the whole run ─────────────────
record(
  "snake.noPageError",
  pageErrors.length === 0 && consoleErrors.length === 0,
  pageErrors.length === 0 && consoleErrors.length === 0
    ? "no uncaught page error and no console error over the whole run"
    : "the page raised errors while it was being played",
  `pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length} first=${(pageErrors[0] ?? consoleErrors[0] ?? "").slice(0, 160)}`
)

// ── E2-b support: the page is self-contained (it fetched nothing external) ───
/** Every request that is not a local file, an inline data URL or a blob. */
const external = requests.filter((url) => !/^(file|data|blob|about):/.test(url))
record(
  "snake.selfContained",
  external.length === 0,
  external.length === 0
    ? "the page requested nothing but local file/data URLs — no network fetch, no external file"
    : "the page fetched external resources, so it is not self-contained",
  `requests=${requests.length} external=${external.length} first=${(external[0] ?? "").slice(0, 160)}`
)

/** Only the screenshots of the three mandated moments, in order. */
const shots = [shotStart.path, (shotEaten ?? shotMoved).path, shotEnd.path]
record(
  "snake.screenshots",
  true,
  "the three mandated moments were captured (start / after eating or after the first key / final state)",
  shots.join(" , ")
)

await running.close()

/** How many rows came out FALSE; the exit code is derived from this and never from the browser's. */
const failed = rows.filter((row) => row.ok === false).length
console.log(`[snake-driver] label=${LABEL} rows=${rows.length} failed=${failed}`)
console.log("driver-exit=" + (failed === 0 ? 0 : 1))
process.exit(failed === 0 ? 0 : 1)
