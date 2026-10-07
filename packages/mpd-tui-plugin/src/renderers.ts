// Seam 13 — `ctx.tuiRenderers`: log-only session events -> transcript text rows.
//
// Registered types are the mpd bundle's own log-only vocabulary:
//   * `agent-teams/*` — appended by the adopted agent-teams client bundle for the
//     (web-side) conversation node; in the TUI they had no projection at all. The producer
//     package that used to be named here is DELETED (de-vendor wave); the client bundle that
//     still emits these events ships under packages/mpd-bundle-plugin/adopted/.
//   * `mpd-tui/board-opened` — appended by this plugin's `/mpd` command.
// A renderer maps the payload to plain text rows, is text-only by design (the
// host gives it no React), must never throw, and its output is clamped to the
// documented bounds (<= 100 lines x <= 400 cells) here as well as host-side.
//
// HONESTY (T10-F1 class): the host answers a refused registration with a NO-OP
// disposer, so a returned function proves nothing. This seam therefore reports
// `requested`, never `confirmed` — the host exposes no read-back for renderers.
//
// WHAT THIS SEAM CAN CARRY. A renderer returns `{title, lines}` of PLAIN TEXT: the transcript has no
// colour slot and no span slot (the host draws the result as text rows). So the shared visual system
// reaches these rows the only way it honestly can — through its MARKERS: the `kind` abbreviation a DAG
// node label carries (`DAG_KIND_ABBREV`), and the state glyph the contract publishes for a payload's
// own status (`DAG_TONE_GLYPH`). No glyph is invented for a status the contract does not publish, and
// the payload's own words stay on the row beside the mark.
import { TUI_SEAMS } from "./types.js"
import type { PluginContextLike, SeamOutcome, TuiAdapter, TuiRenderResult } from "./types.js"
import type { Log } from "./log.js"
import { field, scalarLines, scalarText } from "./sanitize.js"
import { DAG_KIND_ABBREV, DAG_TONE_GLYPH } from "./dag-theme.js"
import { BOARD_OPENED_EVENT } from "./registration.js"

/**
 * The VISUAL state a payload's official status maps onto, for the statuses the record's own
 * `taskVisualState` (team-state.ts) maps unconditionally.
 *
 * The `blocked` reading is deliberately ABSENT: the record derives it from the task's DEPENDENCIES,
 * and a transcript payload carries none — a row that guessed `blocked` from a bare `pending` would be
 * claiming a fact it never read.
 */
const STATUS_VISUAL: Readonly<Record<string, string>> = Object.freeze({
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  in_progress: "running",
})

/**
 * The state glyph one payload status draws as.
 * @param value - the payload's `status` field, of unknown shape.
 * @returns the contract's glyph, or undefined for a status this module cannot map without inventing.
 */
function statusGlyph(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  /** The visual state the record maps that status to, when it maps it at all. */
  const visual = STATUS_VISUAL[value]
  return visual === undefined ? undefined : DAG_TONE_GLYPH[visual]
}

/**
 * The three-letter kind abbreviation a payload kind draws as — the SAME abbreviation a DAG node label
 * carries, so a reader learns one vocabulary in the transcript and in the drawing.
 * @param value - the payload's `kind` field, of unknown shape.
 * @returns the abbreviation, or undefined for a kind the contract does not carry.
 */
function kindAbbrev(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return Object.prototype.hasOwnProperty.call(DAG_KIND_ABBREV, value) ? DAG_KIND_ABBREV[value] : undefined
}

/** Transcript event types this plugin renders. */
export const TRANSCRIPT_TYPES: readonly string[] = [
  "agent-teams/team-created",
  "agent-teams/member-added",
  "agent-teams/member-removed",
  "agent-teams/task-created",
  "agent-teams/task-updated",
  "agent-teams/team-halted",
  "agent-teams/team-resumed",
  "agent-teams/team-deleted",
  "agent-teams/plan-discarded",
  "agent-teams/message-sent",
  BOARD_OPENED_EVENT,
]

/**
 * Projects selected payload fields into `key=value` transcript parts.
 * @param payload - the untrusted event payload.
 * @param keys - the field names to project, in display order.
 * @returns one part per field that renders; a field that does not is dropped.
 */
function bullet(payload: unknown, keys: readonly string[]): string[] {
  /** The rendered `key=value` parts, in key order. */
  const parts: string[] = []
  for (const key of keys) {
    /** This field's sanitized text, undefined when it is missing or not a scalar. */
    const value = field(payload, key, 120)
    if (value !== undefined && value !== "") parts.push(`${key}=${value}`)
  }
  return parts
}

/**
 * The renderer table, keyed by event type.
 *
 * Exported for the unit tests (the host never exposes a plugin's own registry),
 * and used verbatim by {@link registerRenderers}.
 */
export const TRANSCRIPT_RENDERERS: Record<string, (payload: unknown) => TuiRenderResult | undefined> = {
  "agent-teams/team-created": (payload) => ({
    title: "mpd team created",
    lines: [field(payload, "name", 80) ?? "?", `team ${field(payload, "teamId", 60) ?? "?"}`, ...bullet(payload, ["profile", "captainSessionId"])],
  }),
  "agent-teams/member-added": (payload) => ({
    title: "mpd team member added",
    lines: [field(payload, "name", 80) ?? "?", ...bullet(payload, ["role", "memberId"])],
  }),
  "agent-teams/member-removed": (payload) => ({
    title: "mpd team member removed",
    lines: [field(payload, "name", 80) ?? field(payload, "memberId", 60) ?? "?"],
  }),
  "agent-teams/task-created": (payload) => {
    /** The task id the row addresses; `?` when the payload does not name one. */
    const id = field(payload, "taskId", 40) ?? "?"
    /** The kind abbreviation a DAG node label would carry, when the payload's kind is a known one. */
    const abbrev = kindAbbrev((payload as { kind?: unknown } | null)?.kind)
    /** The subject, which is what the row is for. */
    const subject = field(payload, "subject", 160) ?? ""
    return {
      title: "mpd team task created",
      lines: [
        // THE ROW READS LIKE A DAG NODE LABEL: the state a fresh task holds in the drawing's own
        // vocabulary (`open`), its id, its kind abbreviation and its subject. The full kind name is not
        // repeated below — the abbreviation IS the shared vocabulary for it, and printing both would put
        // two spellings of one fact on one row.
        `${DAG_TONE_GLYPH.open ?? "○"} ${`${id}${abbrev === undefined ? "" : ` ${abbrev}`} ${subject}`.trim()}`,
        ...bullet(payload, ["assignee", "round"]),
      ],
    }
  },
  "agent-teams/task-updated": (payload) => {
    /** The task id the row addresses; `?` when the payload does not name one. */
    const id = field(payload, "taskId", 40) ?? "?"
    /** The status the payload reports; `?` when it reports none. */
    const status = field(payload, "status", 40) ?? "?"
    /** The contract's glyph for that status, when it is one the record maps unconditionally. */
    const glyph = statusGlyph((payload as { status?: unknown } | null)?.status)
    return {
      title: "mpd team task updated",
      lines: [
        // The transition line is FROZEN (this package's suite pins it word for word), so the state mark
        // goes on the line BELOW it rather than in front of it.
        `${id} -> ${status}`,
        `${glyph === undefined ? "" : `${glyph} `}${status}`,
        ...bullet(payload, ["assignee", "attempt", "verdict"]),
        ...scalarLines(field(payload, "output", 400) ?? [], 6, 400),
      ],
    }
  },
  "agent-teams/team-halted": (payload) => ({
    title: "mpd team halted",
    lines: [`cancelled ${field(payload, "cancelledTasks", 20) ?? "?"} task(s)`],
  }),
  "agent-teams/team-resumed": (payload) => ({
    title: "mpd team resumed",
    lines: [field(payload, "reason", 200) ?? "(no reason recorded)"],
  }),
  "agent-teams/team-deleted": (payload) => ({
    title: "mpd team deleted",
    lines: [field(payload, "teamId", 60) ?? "?"],
  }),
  "agent-teams/plan-discarded": (payload) => ({
    title: "mpd staged plan discarded",
    lines: [field(payload, "teamId", 60) ?? "?"],
  }),
  "agent-teams/message-sent": (payload) => ({
    title: "mpd team message",
    lines: [
      `${field(payload, "from", 60) ?? "?"} -> ${field(payload, "to", 60) ?? "?"}`,
      ...scalarLines(field(payload, "content", 400) ?? [], 12, 400),
    ],
  }),
  [BOARD_OPENED_EVENT]: (payload) => {
    /** Which board view was opened; `board` when the payload does not say. */
    const view = field(payload, "view", 120) ?? "board"
    /** How the board was opened (command or shortcut); `?` when the payload does not say. */
    const via = field(payload, "via", 20) ?? "?"
    // `new Date(NaN).toISOString()` throws: a number payload field is still
    // untrusted input, so only a finite timestamp is rendered.
    const stamp = (payload as { at?: unknown } | null)?.at
    /** The event's ISO timestamp, rendered only when the payload carries a finite number. */
    const at = typeof stamp === "number" && Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined
    return { title: "mpd board", lines: [`${view} opened via ${via}${at === undefined ? "" : ` at ${at}`}`] }
  },
}

/**
 * Activate every transcript renderer.
 * @param ctx - the plugin context; the host records it as each registration's identity.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @returns the seam handle.
 */
export function registerRenderers(ctx: PluginContextLike, tui: TuiAdapter, log: Log): { outcome(): SeamOutcome } {
  /** The seam handle: the aggregate outcome is recorded once every renderer was requested. */
  const seam = tui.whenBound("renderers", (_service, _scope, handle) => {
    /** The bound renderer registry, before any registration is trusted. */
    const registry = tui.renderers()
    if (typeof registry?.register !== "function") {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.renderers}.register is missing` })
      return
    }
    /** Registrations the host did not throw on; a returned disposer is all it gives back. */
    let requested = 0
    /** Registrations that threw, the other half of the outcome's explanation. */
    let threw = 0
    for (const type of TRANSCRIPT_TYPES) {
      /** The renderer for this event type; types without one are skipped. */
      const render = TRANSCRIPT_RENDERERS[type]
      if (render === undefined) continue
      /** The adapter's handle for this one registration; the admission call happened there. */
      const registration = tui.registerRenderer(
        type,
        (payload: unknown) => {
          try {
            /** The renderer's raw result, undefined when it declines to render this payload. */
            const result = render(payload)
            if (result === undefined) return undefined
            /** The sanitized row title; an unusable title is dropped rather than rendered. */
            const title = scalarText(result.title, 120)
            return { ...(title === undefined ? {} : { title }), lines: scalarLines(result.lines, 100, 400) }
          } catch {
            return undefined
          }
        },
        ctx,
      )
      /** What that registration measured; a host that returned no callable handle counts as a refusal. */
      const measured = registration.outcome()
      if (measured.state === "requested") requested += 1
      else if (measured.state === "refused") {
        threw += 1
        log.debug(`transcript renderer ${type} refused: ${measured.detail ?? "unknown"}`)
      }
    }
    handle.record(
      requested === 0
        ? { state: "refused", detail: `every renderer registration was refused (${threw} threw)` }
        : { state: "requested", detail: `${requested}/${TRANSCRIPT_TYPES.length} renderer(s) requested (no host read-back; a refusal also returns a disposer)` },
    )
  })

  return { outcome: (): SeamOutcome => seam.outcome() }
}
