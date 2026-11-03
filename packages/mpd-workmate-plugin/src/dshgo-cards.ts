// The dsh-Go TOOL CARDS of the workmate row (wave contract D6).
//
// WHY A SEPARATE MODULE: a card builder must be PURE — no ctx, no I/O, no clock — so it can be linted
// and measured by a unit test (contract §4 D6: "a failed build returns {}"). Keeping the builders out
// of the row's `apply` makes that possible, and the wired `presentationMeta` consts below are the very
// objects the tool definitions carry, so the test asserts the shipped wiring rather than a copy.
//
// THE THREE RULES OF A TOOL CARD: v1 components only (an old app draws a grey placeholder for anything
// newer), no `$` data bindings (a card has no data model) and no `actions` (a card cannot call back).
// `toolCard()` enforces those plus the 8 KiB / 40 nodes / depth 6 budget, degrading to `{}` on any
// failure so the app falls back to its generic tool row.
import { table, metric, row, stack, text, toolCard, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"

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

/**
 * Build the `mpd_workmate_list` card: the library size, the readonly count and one row per instance.
 *
 * @param _args - the call's arguments; unused, a list card says nothing about them.
 * @param value - the tool value `{ workmates, count }`.
 * @returns a v1 stack titled "Workmates", inside the tool-card budget by construction (at most 20 rows).
 */
export function buildWorkmateListCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The instances the value reports. */
  const workmates = recordsAt(v, "workmates")
  /** How many instances are readonly (their write tools are denied at spawn). */
  const readonlyCount = workmates.filter((w) => w.readonly === true).length
  /** Uses summed across the library, so one glance shows how much reuse it carries. */
  const totalUses = workmates.reduce((sum, w) => sum + numberOf(w.uses), 0)
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Workmates", value: workmates.length }),
      metric({ label: "Readonly", value: readonlyCount }),
      metric({ label: "Total uses", value: totalUses }),
    ]),
  ]
  if (workmates.length === 0) {
    children.push(text("No workmates in the library."))
  } else {
    children.push(table({
      columns: ["Name", "Base", "Uses"],
      rows: workmates.slice(0, 20).map((w) => [clip(stringOf(w.name, "?"), 40), clip(stringOf(w.baseName, "?"), 24), numberOf(w.uses)]),
    }))
  }
  return stack(children, { title: "Workmates" })
}

/**
 * Build the `mpd_workmate_match` card: the match verdict, the threshold and the ranked candidates.
 *
 * @param _args - the call's arguments; unused, the task text is the caller's prompt, not the result.
 * @param value - the tool value `{ matched, threshold, matches, suggestion }`.
 * @returns a v1 stack titled "Workmate match", at most 10 candidate rows.
 */
export function buildWorkmateMatchCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The scored instances, best first. */
  const matches = recordsAt(v, "matches")
  /** Whether the best score cleared the threshold, i.e. whether reuse is advised. */
  const matched = v.matched === true
  /** The threshold the score was compared against. */
  const threshold = numberOf(v.threshold)
  /** The one-line recommendation the tool returns. */
  const suggestion = stringOf(v.suggestion, "")
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Matched", value: matched ? "yes" : "no", tone: matched ? "good" : "muted", caption: "threshold " + threshold }),
      metric({ label: "Candidates", value: matches.length }),
    ]),
  ]
  if (matches.length === 0) {
    children.push(text("No workmate note was scored."))
  } else {
    children.push(table({
      columns: ["Name", "Score", "Base", "Uses"],
      rows: matches.slice(0, 10).map((m) => [clip(stringOf(m.name, "?"), 32), numberOf(m.score), clip(stringOf(m.baseName, "?"), 20), numberOf(m.uses)]),
    }))
  }
  if (suggestion !== "") children.push(text(clip(suggestion, 300)))
  return stack(children, { title: "Workmate match" })
}

/** The `presentationMeta` of `mpd_workmate_list`: the card above, budget-checked and never throwing. */
export const WORKMATE_LIST_CARD = toolCard(buildWorkmateListCard)

/** The `presentationMeta` of `mpd_workmate_match`: the card above, budget-checked and never throwing. */
export const WORKMATE_MATCH_CARD = toolCard(buildWorkmateMatchCard)
