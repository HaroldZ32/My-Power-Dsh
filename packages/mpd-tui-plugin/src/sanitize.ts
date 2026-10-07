// Untrusted-input discipline for everything this plugin renders.
//
// The host sanitizes its own render path too (`src/dsh-adapter/sanitize.ts`),
// but this plugin feeds values it read from FILES (team.json, boulder.json,
// plan names, workmate meta) straight into that path, so it applies the same
// rules before handing anything over: strip C0/C1 control characters, collapse
// whitespace, clamp by terminal CELL, and accept scalars only — a non-scalar is
// dropped, never stringified into "[object Object]" on screen.

/** C0 and C1 control characters, replaced by a space before anything is rendered. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu
// East-Asian wide / fullwidth ranges (the same intent as the host's cell
// measure): a CJK glyph occupies two cells, so a cell clamp must not treat it
// as one character.
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u

/** Strip C0/C1 control characters (replaced by a space, never removed blindly). */
export function stripControl(value: string): string {
  return value.replace(CONTROL, " ")
}

/** Collapse runs of whitespace and trim. */
export function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

/** Rendered width in terminal cells (wide glyphs count twice). */
export function cellWidth(value: string): number {
  /** Cell count accumulated so far; a wide glyph adds two. */
  let width = 0
  for (const character of value) width += WIDE.test(character) ? 2 : 1
  return width
}

/** Clamp a string to `maxCells` terminal cells without splitting a surrogate pair. */
export function clampCells(value: string, maxCells: number): string {
  if (maxCells <= 0) return ""
  /** The accepted characters, never split inside a surrogate pair. */
  let out = ""
  /** Cells taken by `out` so far. */
  let width = 0
  for (const character of value) {
    /** Cells this character needs: two for an East-Asian wide glyph, one otherwise. */
    const next = WIDE.test(character) ? 2 : 1
    if (width + next > maxCells) break
    out += character
    width += next
  }
  return out
}

/**
 * Cut one row to a COLUMN window, never splitting a wide glyph.
 *
 * THE INVARIANT, postcondition-shaped and asserted at every call site that draws a panned row: the
 * result occupies EXACTLY `cols` cells — the visible window is always full, never short and never
 * over, which is the only way a horizontal pan can keep a box's right border on its own column.
 *
 * The three decisions a per-character `slice` gets wrong, and this function's answer to each:
 *   - a character whose cells lie entirely BEFORE `offset` is dropped;
 *   - a wide glyph STRADDLING the left edge is not half-emitted — ONE SPACE takes its place, so the
 *     window keeps its cell count and shows a gap rather than a sheared glyph;
 *   - a wide glyph STRADDLING the right edge is DROPPED, and the row is space-padded to `cols`.
 * A window that runs past the text's own end is padding, and one of zero cells is the empty string.
 * @param text - the row's characters, in draw order.
 * @param offset - the first column to show, in cells; a negative value reads as zero.
 * @param cols - how many cells the window shows.
 * @returns exactly `cols` cells (fewer only when `cols` is not positive).
 */
export function sliceCells(text: string, offset: number, cols: number): string {
  /** The window's width, floored; below one cell there is nothing to show. */
  const width = Math.floor(Number.isFinite(cols) ? cols : 0)
  if (width <= 0) return ""
  /** The first visible column, floored; a window starting before the row is the row's own start. */
  const from = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0))
  /** The cells accepted so far. */
  let out = ""
  /** Cells emitted so far, padding included. */
  let used = 0
  /** The cells of the row consumed so far, over its WHOLE run and not only its visible part. */
  let cursor = 0
  for (const character of text) {
    if (used >= width) break
    /** The cells this glyph needs: two for an East-Asian wide glyph, one otherwise. */
    const span = WIDE.test(character) ? 2 : 1
    /** Where this glyph sits, relative to the window. */
    const at = cursor - from
    cursor += span
    // ENTIRELY BEFORE THE WINDOW: nothing of this glyph is visible, so it contributes nothing.
    if (at + span <= 0) continue
    // STRADDLING THE LEFT EDGE: its leading cells are off-window, and half a wide glyph is a sheared
    // glyph, so the visible half is drawn as a space instead.
    if (at < 0) {
      out += " "
      used += 1
      continue
    }
    // STRADDLING THE RIGHT EDGE: the glyph cannot be shown whole, so it is dropped and the row padded.
    if (used + span > width) break
    out += character
    used += span
  }
  return out + " ".repeat(width - used)
}

/**
 * Normalize one untrusted scalar into renderable text.
 * @param value - the candidate value; strings, numbers and booleans are accepted.
 * @param maxCells - the cell clamp.
 * @returns the sanitized text, or undefined for a missing/non-scalar value.
 */
export function scalarText(value: unknown, maxCells: number = 200): string | undefined {
  /** The candidate's runtime type, the only narrowing this helper trusts. */
  const type = typeof value
  if (type !== "string" && type !== "number" && type !== "boolean") return undefined
  if (type === "number" && !Number.isFinite(value as number)) return undefined
  /** The candidate as text: a string as-is, any other scalar through `String`. */
  const raw = type === "string" ? (value as string) : String(value)
  return clampCells(collapse(stripControl(raw)), maxCells)
}

/**
 * Normalize one untrusted scalar into a bounded line list.
 * @param value - the candidate value (an array is mapped, never stringified).
 * @param maxLines - the line cap.
 * @param maxCells - the per-line cell clamp.
 * @returns sanitized lines; entries that are not scalars are skipped.
 */
export function scalarLines(value: unknown, maxLines: number = 100, maxCells: number = 400): string[] {
  /** The candidates: an array is used as-is, anything else becomes a one-element list. */
  const items = Array.isArray(value) ? value : [value]
  /** The accepted lines, bounded by `maxLines`. */
  const lines: string[] = []
  for (const item of items) {
    if (lines.length >= maxLines) break
    /** This candidate's renderable form, undefined when it is not a scalar. */
    const text = scalarText(item, maxCells)
    if (text !== undefined && text !== "") lines.push(text)
  }
  return lines
}

/** Read a bounded, sanitized field out of an untrusted payload. */
export function field(payload: unknown, key: string, maxCells: number = 200): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined
  return scalarText((payload as Record<string, unknown>)[key], maxCells)
}
