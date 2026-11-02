// The dsh-Go TOOL CARDS of the memory row (wave contract D6).
//
// WHY A SEPARATE MODULE: a card builder must be PURE — no ctx, no I/O, no clock — so a unit test can
// lint and measure it (contract §4 D6: "a failed build returns {}"). The exported `presentationMeta`
// consts below are the very objects the tool definitions carry, so the test asserts the shipped
// wiring instead of a copy.
//
// THE THREE RULES OF A TOOL CARD: v1 components only (an old app draws a grey placeholder for anything
// newer), no `$` data bindings (a card has no data model) and no `actions` (a card cannot call back).
// `toolCard()` enforces those plus the 8 KiB / 40 nodes / depth 6 budget, degrading to `{}` on any
// failure so the app falls back to its generic tool row.
import { callout, keyValue, metric, row, stack, table, text, toolCard, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"

/** Whether a value is a plain JSON object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A JSON object from a tool value, or an empty record when the value is anything else. */
function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** The object members of the array at `key`, or no rows when the field is absent or not an array. */
function recordsAt(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  /** The field's value, of unknown shape because it came out of a tool result. */
  const raw = source[key]
  return Array.isArray(raw) ? raw.filter(isRecord) : []
}

/** A non-empty string field, or `fallback` when the field is absent or blank. */
function stringOf(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback
}

/** A finite number field, or 0 so a missing count still prints a number. */
function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** Clip text to `max` characters, marking the cut so a truncation is visible rather than implied. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…"
}

/** The tail of a long path, which names a file better than its root does inside a narrow card. */
function tail(value: string, max: number): string {
  return value.length <= max ? value : "…" + value.slice(value.length - (max - 1))
}

/**
 * Build the `mpd_memory_write` card: where the entry landed, its store and the reflection signal.
 *
 * @param _args - the call's arguments; unused, the result already names what was written.
 * @param value - the tool value `{ file, committedTo, reflectionDue, vcs, errors, scope }`.
 * @returns a v1 stack titled "Memory written".
 */
export function buildMemoryWriteCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The VCS backends that accepted the commit. */
  const committedTo = Array.isArray(v.committedTo) ? v.committedTo.map(String) : []
  /** The error lines of the backends that failed; a commit failure never fails the write. */
  const errors = Array.isArray(v.errors) ? v.errors.map(String).filter((line) => line !== "") : []
  /** Whether this write crossed the reflection threshold. */
  const reflectionDue = v.reflectionDue === true
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Scope", value: stringOf(v.scope, "workspace") }),
      metric({ label: "Reflection", value: reflectionDue ? "due" : "not due", tone: reflectionDue ? "warn" : "muted" }),
    ]),
    keyValue([
      ["File", tail(stringOf(v.file, "(unknown)"), 80)],
      ["VCS", stringOf(v.vcs, "git")],
      ["Committed to", committedTo.length === 0 ? "none" : committedTo.join(", ")],
    ]),
  ]
  if (errors.length > 0) children.push(callout(clip("commit failed: " + errors.join("; "), 400), { tone: "warn" }))
  return stack(children, { title: "Memory written" })
}

/**
 * Build the `mpd_memory_read` card: the page shape and one row per returned entry.
 *
 * @param _args - the call's arguments; unused, the value carries the paging state.
 * @param value - the tool value `{ entries, count, offset, returned, next_offset, scope }`.
 * @returns a v1 stack titled "Memory entries", at most 20 entry rows.
 */
export function buildMemoryReadCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The entries this page returned. */
  const entries = recordsAt(v, "entries")
  /** The next page start, or null when this page reached the end of the matched set. */
  const nextOffset = v.next_offset === null || v.next_offset === undefined ? "end" : String(v.next_offset)
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Matched", value: numberOf(v.count) }),
      metric({ label: "Returned", value: numberOf(v.returned) }),
      metric({ label: "Next offset", value: nextOffset }),
    ]),
  ]
  if (entries.length === 0) {
    children.push(text("No memory entries matched."))
  } else {
    children.push(table({
      columns: ["Kind", "Description"],
      rows: entries.slice(0, 20).map((entry) => [clip(stringOf(entry.kind, "note"), 12), clip(stringOf(entry.description, "(untitled)"), 80)]),
    }))
  }
  return stack(children, { title: "Memory entries" })
}

/**
 * Build the `mpd_memory_status` card: the store counts, the reflection state and where the store lives.
 *
 * @param _args - the call's arguments; unused, the value reports the store the call resolved.
 * @param value - the tool value `{ vcs, root, entries, journalLines, reflection, scope }`.
 * @returns a v1 stack titled "Memory status".
 */
export function buildMemoryStatusCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The reflection state, read defensively because an older store may omit fields. */
  const reflection = recordOf(v.reflection)
  /** Completed reflections, the counter that shows the loop is running. */
  const reflectionsCompleted = numberOf(reflection.reflectionsCompleted)
  /** Steps written since the last completed reflection. */
  const stepsSince = numberOf(reflection.stepsSinceReflection)
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Entries", value: numberOf(v.entries) }),
      metric({ label: "Journal lines", value: numberOf(v.journalLines) }),
      metric({ label: "Reflections", value: reflectionsCompleted }),
    ]),
    keyValue([
      ["VCS", stringOf(v.vcs, "git")],
      ["Scope", stringOf(v.scope, "workspace")],
      ["Root", tail(stringOf(v.root, "(unknown)"), 80)],
      ["Steps since reflection", stepsSince],
    ]),
  ]
  return stack(children, { title: "Memory status" })
}

/** The `presentationMeta` of `mpd_memory_write`: the card above, budget-checked and never throwing. */
export const MEMORY_WRITE_CARD = toolCard(buildMemoryWriteCard)

/** The `presentationMeta` of `mpd_memory_read`: the card above, budget-checked and never throwing. */
export const MEMORY_READ_CARD = toolCard(buildMemoryReadCard)

/** The `presentationMeta` of `mpd_memory_status`: the card above, budget-checked and never throwing. */
export const MEMORY_STATUS_CARD = toolCard(buildMemoryStatusCard)
