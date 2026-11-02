// The dsh-Go TOOL CARD of the boulder status tool (wave contract D6).
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
import { keyValue, metric, row, stack, table, text, toolCard, type DshGoView } from "../../../mpd-dsh-adapter-plugin/src/dshgo-view"

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
 * Build the `mpd_boulder_status` card: the ledger path, the counts and one row per resumable work.
 *
 * @param _args - the call's arguments; unused, the value reports the ledger it read.
 * @param value - the tool value `{ stateFile, activeWorks, resumeOptions, planProgress?, state? }`.
 * @returns a v1 stack titled "Boulder status", at most 10 work rows.
 */
export function buildBoulderStatusCard(_args: unknown, value: unknown): DshGoView {
  /** The tool value as a record; a malformed value yields an empty card rather than a throw. */
  const v = recordOf(value)
  /** Every work that is not terminal, as the ledger reports them. */
  const activeWorks = recordsAt(v, "activeWorks")
  /** The resumable works, each carrying the checklist progress of its plan. */
  const resumeOptions = recordsAt(v, "resumeOptions")
  /** The ledger's mirrored state, absent on a workspace that never started a work. */
  const state = recordOf(v.state)
  /** The optional per-plan progress, present only when the caller named a plan path. */
  const planProgress = recordOf(v.planProgress)
  /** The card's children, assembled below. */
  const children: DshGoView[] = [
    row([
      metric({ label: "Active works", value: activeWorks.length }),
      metric({ label: "Resumable", value: resumeOptions.length }),
    ]),
    keyValue([
      ["Ledger", tail(stringOf(v.stateFile, "(unknown)"), 72)],
      ["Active work", clip(stringOf(state.active_work_id, "none"), 32)],
      ["Status", stringOf(state.status, "idle")],
    ]),
  ]
  if (resumeOptions.length === 0) {
    children.push(text("No active boulder work in this workspace."))
  } else {
    children.push(table({
      columns: ["Plan", "Status", "Done"],
      rows: resumeOptions.slice(0, 10).map((option) => {
        /** This work's plan checklist progress, when the ledger carried one. */
        const progress = recordOf(option.progress)
        return [clip(stringOf(option.plan_name, "?"), 40), stringOf(option.status, "active"), numberOf(progress.completed) + "/" + numberOf(progress.total)]
      }),
    }))
  }
  if (Object.keys(planProgress).length > 0) {
    /** The error the progress reader returned, when the plan could not be read. */
    const error = typeof planProgress.error === "string" ? planProgress.error : ""
    if (error !== "") children.push(text(clip("plan unreadable: " + error, 300), { tone: "warn" }))
    else children.push(row([metric({ label: "Plan done", value: numberOf(planProgress.completed) + "/" + numberOf(planProgress.total), tone: planProgress.isComplete === true ? "good" : "muted" })]))
  }
  return stack(children, { title: "Boulder status" })
}

/** The `presentationMeta` of `mpd_boulder_status`: the card above, budget-checked and never throwing. */
export const BOULDER_STATUS_CARD = toolCard(buildBoulderStatusCard)
