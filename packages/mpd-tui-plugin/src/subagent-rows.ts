// THE ONE PLACE THE TUI BUILDS SUBAGENT ROWS — the MPD sidebar page (`panel-dag.ts`) and the
// full-screen merged scene (`subagent-scene.ts`) both render THIS module's rows, so the two surfaces
// cannot drift apart on what a subagent row says or on when it stops being drawn.
//
// WHY A SEPARATE MODULE (frozen contract `.mpd/plans/tui-panel-wave.md`, lane L4). The row projection
// has two jobs, they are the same on both surfaces, and both are owned here:
//   (a) BURN AFTER USE (clauses 1 / D1 / D2). The row source is the HOST's append-only child catalog
//       (`channel.subagents` and the panel host's `snapshot().subagents`), so filtering is a
//       PROJECTION: MPD stops DRAWING a row and never deletes anything from disk. Nothing here opens a
//       new host contact and nothing here adds a store — the correlation inputs are the session id and
//       the team projection the calling surface ALREADY received.
//   (b) COMPACT ROWS (clause 5 / D7). No `one-shot`/`continuable` word and no ISO-8601 instant is
//       drawn; ages render as `Ns`/`Nm`/`Nh`/`Nd`.
//
// THE BURN RULE (the captain's binding L4 directive), hidden iff EITHER arm holds:
//   ARM 1 — the row is TERMINAL (`completed` / `failed` / `cancelled`, or `unknown` WITH an end
//           instant) and its end instant (`endedAt ?? completedAt`) is older than
//           {@link SUBAGENT_ROW_GRACE_MS}. A terminal row the host reported no end instant for is
//           hidden AT ONCE — there is nothing to grace. The grace is DELIBERATE: a row that just
//           finished stays readable for one minute instead of vanishing under the reader's eyes.
//   ARM 2 — the row's `description` equals (EXACTLY, after trimming) the name of a member of a team of
//           THIS session whose record carries `endedAt`. An ambiguous match (the same name on two
//           ended teams) does not fire.
// NEVER HIDDEN, by either arm: a `starting`/`running` row; a row that still resolves to a LIVE team of
// this session; a row that PROVABLY belongs to another session's catalog.
//
// WHAT THIS CANNOT PROVE, and says so instead of pretending: MPD's consult records live in an
// in-process Map inside `mpd-roles-plugin` and are not readable from the TUI, so no surface can ask
// "did MPD spawn this row?". The rule above is decided from the row itself plus the session's own team
// projection, which is the strongest correlation these surfaces hold.
//
// DEFENSIVE RULES. `channel.subagents` / `snapshot().subagents` may be absent, frozen, or hold
// anything: every field is read as `unknown` and narrowed, an unrecognized status renders as `unknown`
// (never guessed into `completed`), and a hostile carrier degrades to "no rows" rather than a throw.
// Every external string crosses `sanitize.ts` before it can reach a row.
import { clampCells, stripControl } from "./sanitize.js"

/** The cell budget of ONE rendered row — the same bound the other scenes apply to their rows. */
export const MERGED_ROW_MAX_CELLS = 4000

/**
 * How long a TERMINAL row keeps being drawn after its end instant, in milliseconds.
 *
 * The chosen trade, stated plainly: a settled consult stays visible for up to a minute so the user can
 * READ its outcome, and only then stops being drawn. That is not an instant vanish, and it is not a
 * claim that a row disappears the moment it finishes.
 */
export const SUBAGENT_ROW_GRACE_MS = 60_000

/** Every status the host's own `SubagentStatus` union can carry, as data (never guessed). */
const KNOWN_STATUSES: readonly string[] = ["starting", "running", "completed", "failed", "cancelled", "unknown"]

/** Every durable mode the host's own `SubagentState['mode']` can carry, as data. */
const KNOWN_MODES: readonly string[] = ["one-shot", "continuable", "unknown"]

/**
 * The host's own `SubagentCard` glyphs, reused verbatim so the two surfaces read the same way.
 *
 * `unknown` is the HISTORICAL row: the host discovers an idle child it did not witness settle, and the
 * parent log alone cannot prove how its last epoch ended — so it is drawn as unknown, never as a
 * completed run.
 */
const SUBAGENT_GLYPHS = {
  /** A live run (`running`/`starting`). */
  live: "🟡",
  /** A row whose outcome the host cannot prove. */
  unknown: "⚪",
  /** A run that failed or was cancelled. */
  failed: "🔴",
  /** A run the host reports as completed. */
  completed: "🟢",
} as const

/** One subagent row as the TUI renders it, projected without a single assumption. */
export interface SubagentRowView {
  /** The host's agent id, kept ONLY so the interrupt path has a target; absent when unreadable. */
  agentId?: string
  /** The sanitized description, or `(no description)` when the host reported none. */
  description: string
  /** `one-shot`, `continuable` or `unknown` — the host's own vocabulary, NEVER drawn (D7). */
  mode: string
  /** The host's own status when it is one this module knows, otherwise `unknown`. */
  status: string
  /** The real start instant in epoch milliseconds; undefined when the host reported none. */
  startedAt?: number
  /** The real end instant (`endedAt ?? completedAt`) in epoch milliseconds; undefined when unreported. */
  endedAt?: number
  /** True only for a live run (`running`/`starting`) — the host's own liveness test. */
  live: boolean
  /** True only for a terminal failure (`failed`/`cancelled`). */
  failed: boolean
  /**
   * The session that spawned this row, when the host reported one.
   *
   * NEVER DRAWN. It is the correlation field of the burn projection only: a row whose PARENT session is
   * provably not the one on screen belongs to another session's catalog and is never filtered out.
   */
  parentSessionId?: string
}

/** One projected row together with the raw host entry it came from. */
export interface SubagentRowEntry {
  /** The row the list draws. */
  view: SubagentRowView
  /** The raw element of `channel.subagents`, kept so the detail view re-reads the SAME entry. */
  entry: unknown
}

/** One drawn row of the subagent section, with the emphasis it must carry. */
export interface SubagentSectionRow {
  /** The row text, already sanitized at this boundary. */
  text: string
  /** True for the section's own header row. */
  header?: boolean
  /** True for the host's empty-state rows, which surfaces draw dimmed. */
  dim?: boolean
  /** The index into the DRAWN {@link SubagentRowView} list when this row IS a subagent, else absent. */
  rowIndex?: number
}

/** One team of THIS session, reduced to the two facts the burn projection needs. */
export interface SubagentTeamScope {
  /**
   * The roster's member names, exact.
   *
   * These are the names the captain addresses a member by, which is the identity a row's `description`
   * is correlated against (ARM 2).
   */
  readonly members: readonly string[]
  /**
   * True when the team RECORD this scope was projected from carries `endedAt`.
   *
   * The surfaces read the record through `TeamWorkflow`, whose `team.phase` is `"ended"` exactly while
   * `readRecordWorkflow` sees `record.endedAt !== undefined`, so the fact is the record's own.
   */
  readonly ended: boolean
}

/** Everything the burn projection needs — all of it already in the calling surface's hands. */
export interface SubagentRowFilter {
  /** The render clock in epoch milliseconds; ONE value per render, so two rows share an instant. */
  readonly now: number
  /** This session's own team scope(s); absent means "no team projection", which arms ARM 1 alone. */
  readonly teams?: readonly SubagentTeamScope[]
  /** The session whose catalog is being drawn; a row proven to name another session is never hidden. */
  readonly sessionId?: string
}

/**
 * The package's compact relative age: `<1s`, `12s`, `3m`, `2h`, `4d`.
 *
 * The same vocabulary and thresholds as `panel-watchdog.ts`'s `incidentAge`, carried here rather than
 * imported because THIS module is the row core of the TUI plane and must not depend on a panel file
 * another lane owns mid-wave; the shape is pinned by this module's own test.
 * @param at - the epoch-millisecond instant, or a value the host reported instead of one.
 * @param now - the render clock, in epoch milliseconds.
 * @returns the compact age, or `?` for an unusable instant (epoch 0 is a placeholder, not a start).
 */
export function subagentRowAge(at: number, now: number): string {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return "?"
  /** How long ago the instant was, floored at zero for a clock that ran backwards. */
  const delta = Math.max(0, now - at)
  if (delta < 1000) return "<1s"
  if (delta < 60_000) return `${String(Math.floor(delta / 1000))}s`
  if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))}m`
  if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))}h`
  return `${String(Math.floor(delta / 86_400_000))}d`
}

/**
 * Sanitize one external value into a row's own text.
 *
 * `stripControl` + `clampCells` (never a collapse, which would eat a description's own spacing). A
 * non-scalar is DROPPED rather than stringified, so a hostile payload can never reach `ui.Text` as
 * `[object Object]`.
 * @param value - the candidate, of unknown shape.
 * @returns the sanitized, clamped text; empty for a nullish or non-scalar value.
 */
export function safeRow(value: unknown): string {
  /** The candidate's runtime type, the only narrowing this boundary trusts. */
  const type = typeof value
  if (type !== "string" && type !== "number" && type !== "boolean") return ""
  if (type === "number" && !Number.isFinite(value as number)) return ""
  /** The candidate as text: a string as-is, any other scalar through `String`. */
  const raw = type === "string" ? (value as string) : String(value)
  return clampCells(stripControl(raw), MERGED_ROW_MAX_CELLS)
}

/**
 * An epoch-millisecond instant, when the host reported a usable one.
 * @param value - the candidate field; only a finite number inside the ECMAScript time range is used.
 * @returns the instant in epoch milliseconds, or undefined when the host reported no usable one.
 */
function epochOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  // ±8.64e15 ms is the exact ECMAScript time-value range: outside it any Date arithmetic is nonsense,
  // and a range check keeps that nonsense out of the age formatter entirely.
  if (Math.abs(value) > 8.64e15) return undefined
  return value
}

/**
 * Project ONE host subagent entry into a row view.
 * @param entry - one element of the host's subagent array, of unknown shape.
 * @returns the row view, or undefined when the entry is not an object at all.
 */
export function subagentRowView(entry: unknown): SubagentRowView | undefined {
  if (entry === null || typeof entry !== "object") return undefined
  /** The entry as a record; every field stays `unknown` and is narrowed below. */
  const row = entry as Record<string, unknown>
  /** The status, kept only when it is one of the host's own six. */
  const status = typeof row.status === "string" && KNOWN_STATUSES.includes(row.status) ? row.status : "unknown"
  /** The durable mode, kept only when it is one of the host's own three. */
  const mode = typeof row.mode === "string" && KNOWN_MODES.includes(row.mode) ? row.mode : "unknown"
  /** The agent id, kept only when it is a usable non-empty string (it is an interrupt target). */
  const agentId = typeof row.agentId === "string" && row.agentId !== "" ? row.agentId : undefined
  /** The spawning session, kept only when the host reported a usable id. */
  const parentSessionId = typeof row.parentSessionId === "string" && row.parentSessionId !== "" ? row.parentSessionId : undefined
  /** The start instant, or undefined when the host reported none. */
  const startedAt = epochOf(row.startedAt)
  // `endedAt` is the host's settled end; `completedAt` is the older projection of the same fact.
  /** The end instant, or undefined for a row the host has not ended. */
  const endedAt = epochOf(row.endedAt ?? row.completedAt)
  return {
    ...(agentId === undefined ? {} : { agentId }),
    description: safeRow(row.description) || "(no description)",
    mode,
    status,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    live: status === "running" || status === "starting",
    failed: status === "failed" || status === "cancelled",
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
  }
}

/**
 * The host's own subagent rows for this render, each paired with its raw entry.
 *
 * This is the ONE reader of the host's subagent catalog: {@link subagentRows} derives the drawn rows
 * from it and the detail view re-reads the entry it was opened on, so the list, the counts and the
 * detail are three views of one projection and cannot disagree about a subagent.
 * @param source - the scene's channel or the panel host's snapshot, of unknown shape.
 * @returns one pair per readable row, in the host's own order; [] when the field is absent, hostile
 *   or not an array — this function never throws and never re-orders.
 */
export function subagentRowEntries(source: unknown): SubagentRowEntry[] {
  try {
    /** The host's own array, when this composition projects one at all. */
    const raw = (source as { subagents?: unknown } | undefined)?.subagents
    if (!Array.isArray(raw)) return []
    // NO CAP: the host's own dashboard maps its whole array through a ScrollBox, so capping here
    // would make this surface show less than the screen it mirrors — and a silently dropped row
    // would make every count below it a lie.
    /** The projected pairs, in the host's own order. */
    const pairs: SubagentRowEntry[] = []
    for (const entry of raw) {
      /** This entry's projection, skipped when it is not a readable object. */
      const view = subagentRowView(entry)
      if (view !== undefined) pairs.push({ view, entry })
    }
    return pairs
  } catch {
    // A hostile source (a throwing getter, a proxy) degrades to "no rows" rather than to a crash.
    return []
  }
}

/**
 * The host's own subagent rows for this render, UNFILTERED.
 * @param source - the scene's channel or the panel host's snapshot, of unknown shape.
 * @returns one view per readable row, in the host's own order; [] on any unreadable source.
 */
export function subagentRows(source: unknown): SubagentRowView[] {
  return subagentRowEntries(source).map((pair) => pair.view)
}

/**
 * The glyph the host's own card draws for one row.
 * @param row - the projected row.
 * @returns the host's glyph for that state.
 */
export function glyphOf(row: SubagentRowView): string {
  if (row.live) return SUBAGENT_GLYPHS.live
  if (row.failed) return SUBAGENT_GLYPHS.failed
  if (row.status === "unknown") return SUBAGENT_GLYPHS.unknown
  return SUBAGENT_GLYPHS.completed
}

/**
 * True when the row's host status is terminal FOR THE BURN RULE.
 *
 * `completed`/`failed`/`cancelled` are terminal outright. `unknown` is terminal only when the host also
 * reported an end instant: the parent log then proves the run finished without proving HOW, which is
 * still a finished run. An `unknown` row with no end instant is NOT terminal and is never hidden.
 * @param row - the projected row.
 * @returns true when the row is in a terminal state.
 */
function terminalRow(row: SubagentRowView): boolean {
  if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") return true
  return row.status === "unknown" && row.endedAt !== undefined
}

/**
 * What the team arm says about one row, from the session's own team scope.
 *
 * EXACT matching only: the trimmed description must equal a member name outright, so a description that
 * merely CONTAINS a name (a task line, a route) never hides a row. A name that resolves to a LIVE team
 * wins over an ended one, because a row of a live team must never be hidden; two ended teams naming the
 * same member make the match AMBIGUOUS, and an ambiguous match does not fire.
 * @param description - the row's sanitized description.
 * @param teams - this session's team scopes, when the surface has a team projection.
 * @returns `ended` (hide), `live` (keep), or `none` (the team arm does not decide this row).
 */
function teamVerdict(description: string, teams: readonly SubagentTeamScope[] | undefined): "ended" | "live" | "none" {
  if (teams === undefined || teams.length === 0) return "none"
  /** The description in the form the roster stores a name, so the comparison is exact. */
  const wanted = description.trim()
  if (wanted === "") return "none"
  /** How many teams name this row as an ENDED member. */
  let ended = 0
  /** True once any team names this row as a member while it is still LIVE. */
  let live = false
  for (const team of teams) {
    /** True when this team's roster carries the exact name. */
    const named = team.members.some((name) => name.trim() === wanted)
    if (!named) continue
    if (team.ended) ended += 1
    else live = true
  }
  if (live) return "live"
  return ended === 1 ? "ended" : "none"
}

/**
 * True when the row PROVABLY belongs to another session's catalog.
 *
 * The panel snapshot carries no per-row parent id, so its rows are this session's by construction; the
 * scene channel's entries do carry one on hosts that report it. A row that names a DIFFERENT parent
 * session is another session's row and is never filtered — and a row whose parent is absent or equal is
 * this session's, because the carrier itself is session-scoped.
 * @param row - the projected row.
 * @param sessionId - the session whose catalog is on screen, when the surface could read one.
 * @returns true only when the row names a different, non-empty parent session.
 */
function foreignRow(row: SubagentRowView, sessionId: string | undefined): boolean {
  if (sessionId === undefined || row.parentSessionId === undefined) return false
  return row.parentSessionId !== sessionId
}

/**
 * Should this render DRAW the row? — the burn projection, one row at a time.
 *
 * With NO filter the answer is always true: the filter is OPT-IN so a caller that has not yet threaded
 * the team scope (or a unit fixture with no clock) keeps the historical unfiltered list rather than
 * silently losing settled rows. Every real surface passes a filter built by
 * {@link subagentRowFilter}.
 * @param view - the projected row.
 * @param filter - the render clock, the session id and the session's team scope.
 * @returns false only when the burn rule hides the row.
 */
export function subagentRowVisible(view: SubagentRowView, filter?: SubagentRowFilter): boolean {
  if (filter === undefined) return true
  // A RUN IN FLIGHT IS THE ONE THING THESE SURFACES EXIST TO SHOW: never hidden by either arm.
  if (view.live) return true
  // ANOTHER SESSION'S ROW IS NOT OURS TO BURN, even when it looks settled.
  if (foreignRow(view, filter.sessionId)) return true
  /** What this session's own team projection says about the row. */
  const team = teamVerdict(view.description, filter.teams)
  // A LIVE TEAM'S MEMBER ROW IS NEVER HIDDEN — it disappears when its team record ends, not before.
  if (team === "live") return true
  // ARM 2: an ended team's member row stops being drawn at once.
  if (team === "ended") return false
  // ARM 1: a terminal row follows the grace window.
  if (!terminalRow(view)) return true
  if (view.endedAt === undefined) return false
  // Visible while the end instant is INSIDE the grace; at or before one minute the row is still drawn.
  return filter.now - view.endedAt <= SUBAGENT_ROW_GRACE_MS
}

/**
 * The entries this render DRAWS, in the host's own order.
 * @param entries - the full projection from {@link subagentRowEntries}.
 * @param filter - the burn inputs; absent means no filtering.
 * @returns the surviving entries, order preserved.
 */
export function filterSubagentEntries(entries: readonly SubagentRowEntry[], filter?: SubagentRowFilter): SubagentRowEntry[] {
  if (filter === undefined) return [...entries]
  return entries.filter((pair) => subagentRowVisible(pair.view, filter))
}

/**
 * The host's subagent entries this render draws, projected and filtered in one step.
 * @param source - the scene's channel or the panel host's snapshot, of unknown shape.
 * @param filter - the burn inputs; absent means no filtering.
 * @returns the drawn entries, in the host's own order.
 */
export function visibleSubagentEntries(source: unknown, filter?: SubagentRowFilter): SubagentRowEntry[] {
  return filterSubagentEntries(subagentRowEntries(source), filter)
}

/**
 * The host's subagent rows this render draws.
 * @param source - the scene's channel or the panel host's snapshot, of unknown shape.
 * @param filter - the burn inputs; absent means no filtering.
 * @returns the drawn row views, in the host's own order.
 */
export function visibleSubagentRows(source: unknown, filter?: SubagentRowFilter): SubagentRowView[] {
  return visibleSubagentEntries(source, filter).map((pair) => pair.view)
}

/**
 * One subagent row, COMPACT (D7): description, status, and ONE relative age.
 *
 * The `mode` word is dropped (it is durable bookkeeping a reader does not act on) and the instants are
 * relative ages: a live row reports how long it has run, a settled row how long ago it ended.
 * @param row - the projected row.
 * @param now - the render clock, in epoch milliseconds; defaults to the wall clock.
 * @returns the sanitized row line.
 */
export function subagentRowLine(row: SubagentRowView, now: number = Date.now()): string {
  /** The row's fields, in render order: the description, the host's status, then at most one age. */
  const parts: string[] = [row.description, row.status]
  if (row.live) {
    if (row.startedAt !== undefined) parts.push(`started ${subagentRowAge(row.startedAt, now)}`)
  } else if (row.endedAt !== undefined) {
    parts.push(`ended ${subagentRowAge(row.endedAt, now)}`)
  } else if (row.startedAt !== undefined) {
    parts.push(`started ${subagentRowAge(row.startedAt, now)}`)
  }
  return safeRow(`${glyphOf(row)} ${parts.join(" · ")}`)
}

/**
 * The subagent section over an ALREADY-FILTERED row list: its header, its tallies, then the rows.
 *
 * The empty-state wording is the host's own English text (`SubagentDashboard` renders the i18n keys
 * `subagent-none` and `subagent-empty-hint` under its dim `○`). A plugin scene receives only the ui kit,
 * and the host's i18n module is NOT part of the scene props contract, so the strings are carried here
 * instead of being unreachable. The header is ALWAYS present, so a surface can draw its section title
 * unconditionally.
 * @param rows - the row views THIS render draws, in the host's own order.
 * @param now - the render clock used for the relative ages.
 * @returns the section's rows in render order; `rowIndex` indexes `rows`.
 */
export function subagentSectionOf(rows: readonly SubagentRowView[], now: number = Date.now()): SubagentSectionRow[] {
  /** The tallies the host's own dashboard header shows: one counter per state it names. */
  let live = 0
  /** Rows the host reports as completed. */
  let completed = 0
  /** Rows the host reports as failed or cancelled. */
  let failed = 0
  for (const row of rows) {
    if (row.live) live += 1
    if (row.status === "completed") completed += 1
    if (row.failed) failed += 1
  }
  /** The section's rows, in render order. */
  const section: SubagentSectionRow[] = [
    { text: `subagents  ${rows.length} total · ${live} running · ${completed} completed · ${failed} failed`, header: true },
  ]
  if (rows.length === 0) {
    section.push({ text: `${SUBAGENT_GLYPHS.unknown} No subagents in the current session`, dim: true })
    section.push({ text: "  Subagents appear here once the main agent starts Task delegations", dim: true })
    return section
  }
  // THE COUNTS ROW the host's own dashboard carries on top, in THIS module's row vocabulary: the same
  // three tallies the header names above, drawn with the same glyphs the rows below use. It exists
  // because Ctrl+A may open this panel INSTEAD of that dashboard (dashboard-key.ts), and a summary the
  // user could see before must not disappear. The buckets are the host's own states, so a status the
  // host reported that this module does not recognize lands in NONE of them (it is drawn as `unknown`
  // below and never folded into a completion the host never reported). It is drawn only when a row
  // exists: with an empty list the header's own zeroes are the whole truth.
  section.push({
    text: `${SUBAGENT_GLYPHS.live} ${live} running · ${SUBAGENT_GLYPHS.completed} ${completed} completed · ${SUBAGENT_GLYPHS.failed} ${failed} failed`,
    dim: true,
  })
  for (let index = 0; index < rows.length; index += 1) {
    /** The row at this index; `rowIndex` is what a surface's click and detail lookup address. */
    const row = rows[index]
    section.push({ text: subagentRowLine(row, now), rowIndex: index })
  }
  return section
}

/**
 * The subagent section for one render, projected and burn-filtered.
 *
 * The ONE entry point both surfaces call: it reads the host's catalog, drops the rows the burn rule
 * hides, and builds the section. With no filter it draws the historical unfiltered list.
 * @param source - the scene's channel or the panel host's snapshot, of unknown shape.
 * @param filter - the burn inputs, built by {@link subagentRowFilter}.
 * @returns the section's rows in render order; `rowIndex` indexes the DRAWN rows.
 */
export function subagentSectionRows(source: unknown, filter?: SubagentRowFilter): SubagentSectionRow[] {
  return subagentSectionOf(visibleSubagentRows(source, filter), filter?.now ?? Date.now())
}

/**
 * Project a `TeamWorkflow` into the scope the burn rule's team arm needs.
 *
 * The workflow is the SESSION-SCOPED projection the surface already holds (`readScopedWorkflow` resolves
 * it through the session's own record), and its `team.phase` is `"ended"` exactly while that record
 * carries `endedAt` — so this projection carries the record's own fact, not a second read of disk.
 * @param workflow - the surface's team projection, of unknown shape.
 * @returns the scope, or undefined when the projection names no team or no roster member.
 */
export function subagentTeamScope(workflow: unknown): SubagentTeamScope | undefined {
  try {
    /** The projection's team head, when it carries one. */
    const head = (workflow as { team?: unknown } | undefined)?.team
    if (head === null || typeof head !== "object") return undefined
    /** The projection's roster, when the readout carries it. */
    const raw = (workflow as { members?: unknown }).members
    if (!Array.isArray(raw)) return undefined
    /** The roster's member names, in the projection's own order. */
    const members: string[] = []
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object") continue
      /** This roster row's display name, kept only when it is a usable string. */
      const name = (entry as { name?: unknown }).name
      if (typeof name === "string" && name.trim() !== "") members.push(name)
    }
    // A team with no readable member can never name a row, so it contributes nothing to the rule.
    if (members.length === 0) return undefined
    return { members, ended: (head as { phase?: unknown }).phase === "ended" }
  } catch {
    // A hostile projection is "no team scope", which arms the terminal-row rule alone.
    return undefined
  }
}

/**
 * Build the burn filter from what a surface already holds.
 *
 * The ONE wiring call both surfaces make: the session-scoped workflow, the session id the surface read
 * off its own carrier, and the render clock. Absent facts stay absent, and an absent team scope simply
 * arms ARM 1 alone.
 * @param workflow - the surface's session-scoped `TeamWorkflow`, or undefined when it has none.
 * @param sessionId - the id of the session whose catalog is on screen, or undefined when unreadable.
 * @param now - the render clock in epoch milliseconds; defaults to the wall clock.
 * @returns the filter, ready for {@link subagentSectionRows}.
 */
export function subagentRowFilter(workflow: unknown, sessionId: string | undefined, now: number = Date.now()): SubagentRowFilter {
  /** The team scope the workflow projects, when it projects one at all. */
  const scope = subagentTeamScope(workflow)
  return {
    now,
    ...(scope === undefined ? {} : { teams: [scope] }),
    ...(sessionId === undefined || sessionId === "" ? {} : { sessionId }),
  }
}
