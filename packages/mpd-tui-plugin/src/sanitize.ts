// Untrusted-input discipline for everything this plugin renders.
//
// The host sanitizes its own render path too (`src/dsh-adapter/sanitize.ts`),
// but this plugin feeds values it read from FILES (team.json, boulder.json,
// plan names, workmate meta) straight into that path, so it applies the same
// rules before handing anything over: strip C0/C1 control characters, collapse
// whitespace, clamp by terminal CELL, and accept scalars only — a non-scalar is
// dropped, never stringified into "[object Object]" on screen.

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
  let width = 0
  for (const character of value) width += WIDE.test(character) ? 2 : 1
  return width
}

/** Clamp a string to `maxCells` terminal cells without splitting a surrogate pair. */
export function clampCells(value: string, maxCells: number): string {
  if (maxCells <= 0) return ""
  let out = ""
  let width = 0
  for (const character of value) {
    const next = WIDE.test(character) ? 2 : 1
    if (width + next > maxCells) break
    out += character
    width += next
  }
  return out
}

/**
 * Normalize one untrusted scalar into renderable text.
 * @param value - the candidate value; strings, numbers and booleans are accepted.
 * @param maxCells - the cell clamp.
 * @returns the sanitized text, or undefined for a missing/non-scalar value.
 */
export function scalarText(value: unknown, maxCells = 200): string | undefined {
  const type = typeof value
  if (type !== "string" && type !== "number" && type !== "boolean") return undefined
  if (type === "number" && !Number.isFinite(value as number)) return undefined
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
export function scalarLines(value: unknown, maxLines = 100, maxCells = 400): string[] {
  const items = Array.isArray(value) ? value : [value]
  const lines: string[] = []
  for (const item of items) {
    if (lines.length >= maxLines) break
    const text = scalarText(item, maxCells)
    if (text !== undefined && text !== "") lines.push(text)
  }
  return lines
}

/** Read a bounded, sanitized field out of an untrusted payload. */
export function field(payload: unknown, key: string, maxCells = 200): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined
  return scalarText((payload as Record<string, unknown>)[key], maxCells)
}
