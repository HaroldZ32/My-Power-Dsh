import type { HashlineEdit } from "./types"
import { toNewLines } from "./edit-text-normalization"
import { normalizeLineRef } from "./validation"

// Payload text in its canonical form — prefix-stripped lines rejoined by `\n` — so two spellings of the same edit share one key.
function normalizeEditPayload(payload: string | string[]): string {
  return toNewLines(payload).join("\n")
}

// Anchor in its canonical spelling; a missing anchor (an append or prepend without `pos`) becomes the empty string.
function canonicalAnchor(anchor: string | undefined): string {
  if (!anchor) return ""
  return normalizeLineRef(anchor)
}

// Identity of one edit for duplicate detection: op, canonical anchors and canonical payload, so textually different but equivalent edits collide.
function buildDedupeKey(edit: HashlineEdit): string {
  switch (edit.op) {
    case "replace":
      return `replace|${canonicalAnchor(edit.pos)}|${edit.end ? canonicalAnchor(edit.end) : ""}|${normalizeEditPayload(edit.lines)}`
    case "append":
      return `append|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`
    case "prepend":
      return `prepend|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`
    default:
      return JSON.stringify(edit)
  }
}

// Drop repeated edits, keeping the FIRST occurrence of each key in the caller's order and reporting how many were dropped.
export function dedupeEdits(edits: HashlineEdit[]): { edits: HashlineEdit[]; deduplicatedEdits: number } {
  // Keys already kept; the first edit with a given key wins and later ones are dropped.
  const seen = new Set<string>()
  // Survivors, in the order the caller supplied them.
  const deduped: HashlineEdit[] = []
  // How many repeats were dropped from the caller's list.
  let deduplicatedEdits = 0

  for (const edit of edits) {
    // Dedupe key of the edit currently under test.
    const key = buildDedupeKey(edit)
    if (seen.has(key)) {
      deduplicatedEdits += 1
      continue
    }
    seen.add(key)
    deduped.push(edit)
  }

  return { edits: deduped, deduplicatedEdits }
}
