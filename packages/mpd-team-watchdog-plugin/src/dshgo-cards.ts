// The dsh-Go TOOL CARD of the watchdog status tool (wave contract D6).
//
// WHY A SEPARATE MODULE: a card builder must be PURE — no ctx, no I/O, no clock — so a unit test can
// lint and measure it (contract §4 D6: "a failed build returns {}"). The exported `presentationMeta`
// const below is the very object the tool definition carries, so the test asserts the shipped wiring
// instead of a copy.
//
// THE THREE RULES OF A TOOL CARD: v1 components only (an old app draws a grey placeholder for anything
// newer), no `$` data bindings (a card has no data model) and no `actions` (a card cannot call back).
// `toolCard()` enforces those plus the 8 KiB / 40 nodes / depth 6 budget, degrading to `{}` on any
// failure so the app falls back to its generic tool row.
import { callout, keyValue, metric, row, stack, table, toolCard, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.js"

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

/** Clip text to `max` characters, marking the cut so a truncation is visible rather than implied. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…"
}

/**
 * Build the `session-watchdog-status` card: the predicate in force, the hold count and one row per team.
 *
 * @param _args - the call's arguments; unused, `team_id` only narrows the same store.
 * @param value - the tool value `{ workspace, predicate, knobs, paths, teams }`.
 * @returns a v1 stack titled "Watchdog status", at most 20 team rows.
 */
export function buildWatchdogStatusCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** The predicate the engine is running, and why it chose it. */
  const predicate = recordOf(v.predicate)
  /** The per-knob live-vs-file reading, present when the engine published one. */
  const knobs = recordOf(v.knobs)
  /** The teams this workspace knows about, each with its single pause state. */
  const teams = recordsAt(v, "teams")
  /** How many teams currently carry the watchdog's preserving hold. */
  const held = teams.filter((team) => team.held === true).length
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Teams", value: teams.length }),
      metric({ label: "Held", value: held, tone: held > 0 ? "warn" : "muted" }),
    ]),
    keyValue([
      ["Predicate", stringOf(predicate.source, "unknown")],
      ["Reason", clip(stringOf(predicate.reason, "(none)"), 100)],
    ]),
  ]
  if (teams.length > 0) {
    children.push(table({
      columns: ["Team", "Held", "Paused"],
      rows: teams.slice(0, 20).map((team) => {
        /** The team's pause state: the watchdog's preserving hold is the only pause this bundle has. */
        const pause = recordOf(team.pause)
        return [clip(stringOf(team.teamId, "?"), 32), team.held === true ? "yes" : "no", pause.paused === true ? "yes" : "no"]
      }),
    }))
  }
  if (knobs.restartRequired === true) {
    children.push(callout("a .mpd/mpd.jsonc edit is waiting for the next dsh boot", { tone: "warn" }))
  }
  return stack(children, { title: "Watchdog status" })
}

/** The `presentationMeta` of `session-watchdog-status`: the card above, budget-checked and never throwing. */
export const WATCHDOG_STATUS_CARD = toolCard(buildWatchdogStatusCard)
