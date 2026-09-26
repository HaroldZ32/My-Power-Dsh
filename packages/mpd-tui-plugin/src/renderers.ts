// Seam 13 — `ctx.tuiRenderers`: log-only session events -> transcript text rows.
//
// Registered types are the mpd bundle's own log-only vocabulary:
//   * `agent-teams/*` — appended by packages/mpd-agent-teams-plugin for the
//     (web-side) conversation node; in the TUI they had no projection at all.
//   * `mpd-tui/board-opened` — appended by this plugin's `/mpd` command.
// A renderer maps the payload to plain text rows, is text-only by design (the
// host gives it no React), must never throw, and its output is clamped to the
// documented bounds (<= 100 lines x <= 400 cells) here as well as host-side.
//
// HONESTY (T10-F1 class): the host answers a refused registration with a NO-OP
// disposer, so a returned function proves nothing. This seam therefore reports
// `requested`, never `confirmed` — the host exposes no read-back for renderers.
import type { PluginContextLike, SeamOutcome, TuiRenderersLike, TuiRenderResult } from "./types.js"
import type { Log } from "./log.js"
import { effectOn, onService } from "./host.js"
import { field, scalarLines, scalarText } from "./sanitize.js"
import { BOARD_OPENED_EVENT } from "./registration.js"

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

function bullet(payload: unknown, keys: readonly string[]): string[] {
  const parts: string[] = []
  for (const key of keys) {
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
  "agent-teams/task-created": (payload) => ({
    title: "mpd team task created",
    lines: [
      `${field(payload, "taskId", 40) ?? "?"} ${field(payload, "subject", 160) ?? ""}`.trim(),
      ...bullet(payload, ["assignee", "kind", "round"]),
    ],
  }),
  "agent-teams/task-updated": (payload) => ({
    title: "mpd team task updated",
    lines: [
      `${field(payload, "taskId", 40) ?? "?"} -> ${field(payload, "status", 40) ?? "?"}`,
      ...bullet(payload, ["assignee", "attempt", "verdict"]),
      ...scalarLines(field(payload, "output", 400) ?? [], 6, 400),
    ],
  }),
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
    const view = field(payload, "view", 120) ?? "board"
    const via = field(payload, "via", 20) ?? "?"
    // `new Date(NaN).toISOString()` throws: a number payload field is still
    // untrusted input, so only a finite timestamp is rendered.
    const stamp = (payload as { at?: unknown } | null)?.at
    const at = typeof stamp === "number" && Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined
    return { title: "mpd board", lines: [`${view} opened via ${via}${at === undefined ? "" : ` at ${at}`}`] }
  },
}

/**
 * Activate every transcript renderer.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @returns the seam handle.
 */
export function registerRenderers(ctx: PluginContextLike, log: Log): { outcome(): SeamOutcome } {
  let outcome: SeamOutcome = { state: "absent", detail: "tuiRenderers was not injected" }

  onService(ctx, "tuiRenderers", (scoped, service) => {
    const renderers = service as TuiRenderersLike
    if (typeof renderers?.register !== "function") {
      outcome = { state: "refused", detail: "tuiRenderers.register is missing" }
      return
    }
    let requested = 0
    let threw = 0
    for (const type of TRANSCRIPT_TYPES) {
      const render = TRANSCRIPT_RENDERERS[type]
      if (render === undefined) continue
      try {
        const disposer = renderers.register(
          type,
          (payload: unknown) => {
            try {
              const result = render(payload)
              if (result === undefined) return undefined
              const title = scalarText(result.title, 120)
              return { ...(title === undefined ? {} : { title }), lines: scalarLines(result.lines, 100, 400) }
            } catch {
              return undefined
            }
          },
          scoped,
        )
        if (typeof disposer === "function") {
          requested += 1
          // The host answers a refusal with a no-op disposer, so the disposer is
          // owned for cleanup and NEVER treated as proof of registration.
          const release = disposer
          effectOn(scoped, () => release(), `mpd-tui renderer ${type}`)
        }
      } catch (error) {
        threw += 1
        log.debug(`transcript renderer ${type} refused: ${String((error as Error)?.message ?? error)}`)
      }
    }
    outcome =
      requested === 0
        ? { state: "refused", detail: `every renderer registration was refused (${threw} threw)` }
        : { state: "requested", detail: `${requested}/${TRANSCRIPT_TYPES.length} renderer(s) requested (no host read-back; a refusal also returns a disposer)` }
  })

  return { outcome: () => outcome }
}
