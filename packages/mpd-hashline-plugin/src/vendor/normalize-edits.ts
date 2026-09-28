import type { AppendEdit, HashlineEdit, PrependEdit, ReplaceEdit } from "./types"

/** Operation names the tool surface accepts; the pre-anchor legacy edit format is not one of them. */
type HashlineToolOp = "replace" | "append" | "prepend"

/** One edit exactly as it arrived in the tool call, before anchors and lines are validated. */
export interface RawHashlineEdit {
  /** Operation discriminator; an absent value is rejected, so no op is ever defaulted. */
  op?: HashlineToolOp
  /** Primary anchor (`LINE#HASH`); required for `replace`, optional for append/prepend. */
  pos?: string
  /** Inclusive range end for `replace`; also accepted as the fallback anchor for append/prepend. */
  end?: string
  /** Text to write; `null` means an empty line list while `undefined` is a missing-field error. */
  lines?: string | string[] | null
}

/** Trim an anchor and collapse a blank string to undefined, so whitespace can never act as an anchor. */
function normalizeAnchor(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  // The anchor as written by the caller; still blank when it was only whitespace.
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/** Read the edit's `lines`, treating `null` as an explicit empty list and rejecting `undefined`. */
function requireLines(edit: RawHashlineEdit, index: number): string | string[] {
  if (edit.lines === undefined) {
    throw new Error(`Edit ${index}: lines is required for ${edit.op ?? "unknown"}`)
  }
  if (edit.lines === null) {
    return []
  }
  return edit.lines
}

/** Require an anchor for an op that cannot run without one, naming the offending edit index. */
function requireLine(anchor: string | undefined, index: number, op: HashlineToolOp): string {
  if (!anchor) {
    throw new Error(`Edit ${index}: ${op} requires at least one anchor line reference (pos or end)`)
  }
  return anchor
}

/** Convert one raw edit into a `ReplaceEdit`, attaching `end` only when the caller supplied it. */
function normalizeReplaceEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  // Normalized `pos` anchor; a blank or missing value falls back to `end`.
  const pos = normalizeAnchor(edit.pos)
  // Normalized `end` anchor; a blank or missing value means a single-line replace.
  const end = normalizeAnchor(edit.end)
  // The anchor the replace actually uses, so one of the two slots must be present.
  const anchor = requireLine(pos ?? end, index, "replace")
  // Replacement line list, already checked to be present.
  const lines = requireLines(edit, index)

  // The replace edit handed back to the caller; `end` is attached below only when supplied.
  const normalized: ReplaceEdit = {
    op: "replace",
    pos: anchor,
    lines,
  }
  if (end) normalized.end = end
  return normalized
}

/** Convert one raw edit into an `AppendEdit`, attaching `pos` only when an anchor was given. */
function normalizeAppendEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  // Normalized `pos` anchor, when the caller supplied one.
  const pos = normalizeAnchor(edit.pos)
  // Normalized `end` anchor, accepted as the fallback anchor for append.
  const end = normalizeAnchor(edit.end)
  // The anchor to insert after; `undefined` means append at end of file.
  const anchor = pos ?? end
  // Inserted line list, already checked to be present.
  const lines = requireLines(edit, index)

  // The append edit handed back to the caller; `pos` is attached below only when anchored.
  const normalized: AppendEdit = {
    op: "append",
    lines,
  }
  if (anchor) normalized.pos = anchor
  return normalized
}

/** Convert one raw edit into a `PrependEdit`, attaching `pos` only when an anchor was given. */
function normalizePrependEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  // Normalized `pos` anchor, when the caller supplied one.
  const pos = normalizeAnchor(edit.pos)
  // Normalized `end` anchor, accepted as the fallback anchor for prepend.
  const end = normalizeAnchor(edit.end)
  // The anchor to insert before; `undefined` means prepend at start of file.
  const anchor = pos ?? end
  // Inserted line list, already checked to be present.
  const lines = requireLines(edit, index)

  // The prepend edit handed back to the caller; `pos` is attached below only when anchored.
  const normalized: PrependEdit = {
    op: "prepend",
    lines,
  }
  if (anchor) normalized.pos = anchor
  return normalized
}

/** Normalize every raw edit in tool-call order, rejecting any op the tool does not support. */
export function normalizeHashlineEdits(rawEdits: RawHashlineEdit[]): HashlineEdit[] {
  return rawEdits.map((rawEdit, index) => {
    // Defensive: a null array slot normalizes to an edit with no op, which the switch below rejects.
    const edit = rawEdit ?? {}

    switch (edit.op) {
      case "replace":
        return normalizeReplaceEdit(edit, index)
      case "append":
        return normalizeAppendEdit(edit, index)
      case "prepend":
        return normalizePrependEdit(edit, index)
      default:
        throw new Error(
          `Edit ${index}: unsupported op "${String(edit.op)}". Legacy format was removed; use op/pos/end/lines.`
        )
    }
  })
}
