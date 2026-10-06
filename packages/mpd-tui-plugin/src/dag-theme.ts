// THE DAG VISUAL CONTRACT — the ONE table every new TUI DAG surface reads (captain-owned, frozen).
//
// WHY THIS FILE EXISTS SEPARATELY. The wave's lanes run in parallel and may not share a file
// (AGENTS.md §5: one writer per file). The palette, the glyphs and the chrome markers are exactly the
// data two lanes would otherwise both need to edit, so the captain freezes them here BEFORE any lane
// starts and every lane imports instead of writing.
//
// THE WEB VIEW IS THE REFERENCE, NOT THE LAYOUT. `packages/mpd-bundle-plugin/src/team-view.ts`
// (the WEB dependency DAG) is the semantic source of truth for WHAT a state means and which colour
// family it takes; its PIXEL geometry (fixed 168px columns, 42px nodes) is deliberately NOT carried
// over — the user's decision for this wave is "纵向，但不要固定尺寸" (vertical ranks, no fixed sizes),
// so every size in the TUI layout is COMPUTED from the measured panel and never named here.
//
// WHY THE WEB HEXES ARE STILL RECORDED. They are provenance, not styling: a reviewer can see that the
// six host theme keys were chosen to mean the same thing as the WEB tones, and a test can assert the
// mapping is total and 1:1 without asserting a single size. A colour is a meaning; a size is a layout.
/**
 * The host THEME KEYS this contract is allowed to name.
 *
 * Declared as a literal union rather than imported as the host's whole `Theme` type, so this file has
 * NO import and no cross-lane dependency: the contract is the captain's, it must compile before any
 * other lane's file exists, and the host's 73-key `Theme` interface is another package's shape (the
 * adapter re-exports it, and `types.ts` belongs to a different writer this wave). Every member of this
 * union is a key the installed host declares — the six state keys, the two focus keys, the border and
 * background keys — which is what keeps a typo a compile-time error here in practice.
 */
export type DagThemeKey =
  | "success" | "activity" | "error" | "warning" | "inactive" | "subtle"
  | "accent" | "accentShimmer" | "promptBorder" | "text"

/**
 * Every tone a DAG surface may draw with.
 *
 * The first six are the TASK STATES, named exactly as the WEB view names them so the two surfaces
 * cannot drift in vocabulary; the last five are the DRAWING'S OWN tones (the ones the WEB view
 * expresses through opacity and CSS variables rather than through a state name).
 */
export type DagTone =
  | "completed" | "running" | "failed" | "blocked" | "cancelled" | "open"
  | "focus" | "chain" | "edge" | "dim" | "blank"

/** The six tones that name a task state, in legend print order (the drawing's own vocabulary). */
export const DAG_STATE_TONES: readonly DagTone[] = Object.freeze([
  "completed", "running", "open", "failed", "blocked", "cancelled",
])

/**
 * The host THEME KEY each tone renders in.
 *
 * Keys are the host's own (`Theme` in `types.ts`, 73 keys); a key that the host does not declare is a
 * compile-time error here rather than a silently unstyled span at runtime.
 */
export const DAG_TONE_THEME: Readonly<Record<DagTone, DagThemeKey>> = Object.freeze({
  completed: "success",
  running: "activity",
  failed: "error",
  blocked: "warning",
  cancelled: "inactive",
  open: "subtle",
  focus: "accentShimmer",
  chain: "accent",
  edge: "promptBorder",
  dim: "inactive",
  // UNTOUCHED CELLS ARE NOT `dim`, for the reason `graph.ts` records: a drawing is mostly background,
  // and calling that background dimmed makes the focus's own dimming signal unreadable.
  blank: "text",
})

/**
 * The WEB tone each theme key was chosen to mirror, as provenance.
 *
 * The hexes are the WEB view's own `TONE` constants. Nothing renders them; a reviewer and a fidelity
 * test read them to confirm the six states map 1:1 onto the six WEB tones and that no state silently
 * borrowed another state's colour.
 */
export const DAG_TONE_WEB_HEX: Readonly<Record<DagTone, string>> = Object.freeze({
  completed: "#12a150",
  running: "#4d6bfe",
  failed: "#e5484d",
  blocked: "#e08700",
  cancelled: "#8a94a6",
  open: "#5b6472",
  focus: "#5b6472",
  chain: "#5b6472",
  edge: "#d8dde5",
  dim: "#8a94a6",
  blank: "",
})

/** The state glyph per rendered state; `?` is drawn for a state this contract does not know. */
export const DAG_TONE_GLYPH: Readonly<Record<string, string>> = Object.freeze({
  completed: "✓", running: "◐", failed: "✗", blocked: "○", cancelled: "⊘", open: "○",
})

/** The three-letter `kind` abbreviation a node label carries. */
export const DAG_KIND_ABBREV: Readonly<Record<string, string>> = Object.freeze({
  requirement: "REQ", work: "WRK", review: "REV", repair: "FIX", integration: "INT",
})

/**
 * The chrome every DAG surface draws with.
 *
 * `border` is a host style name (not a glyph), so a theme or a host build that renames the styles is
 * one edit here. The markers are written ONCE because the legend must name the same characters the
 * drawing paints — a legend that re-types a glyph is a second source of truth and drifts.
 */
export const DAG_CHROME = Object.freeze({
  /** The host border style for a node box. */
  nodeBorder: "round" as const,
  /** The host border style for the panel's outer frame; heavier than a node so the nesting reads. */
  frameBorder: "single" as const,
  /** The arrowhead an edge ENDS in, at the dependent's entry cell. */
  arrowDown: "▼",
  /** The rail's directional marker: the same "into this task" reading in the rail's own geometry. */
  arrowRight: "▸",
  /** The marker a FOCUSED task draws instead of its state glyph. */
  focusMarker: "▶",
  /** The pinned selection marker, drawn in the footer or a node's title. */
  pinMarker: "◆",
  /** The progress bar's filled and empty cells. */
  barFull: "█",
  barEmpty: "░",
} as const)

/**
 * The animation budget for a running node.
 *
 * `intervalMs` is the tick the host's `useAnimationTime` is asked for; a host that offers no timer
 * must draw the STATIC frame, so `staticPhase` is the phase a degraded surface renders.
 */
export const DAG_ANIM = Object.freeze({
  /** The tick interval; ~8fps is smooth enough for a breathing dot and cheap on a terminal. */
  intervalMs: 125,
  /** The number of distinct frames the breathing cycle is quantised to. */
  frames: 4,
  /** The frame index a surface draws when the host exposes no animation timer. */
  staticPhase: 0,
} as const)

/** The panel slug the DAG page registers under; the host prefixes it with this activation's id. */
export const DAG_PANEL_SLUG = "dag"

/** The panel slug the workmate page registers under. */
export const WORKMATE_PANEL_SLUG = "workmate"

/**
 * The width floor the DAG page ASKS THE HOST FOR: the host's own minimum, never more.
 *
 * WHY 28 AND NOT 32 (measured against the installed host 2026-10-13 — this is not a taste call).
 * `components/sidePanel/PanelHost.js` decides `const tooNarrow = def.minColumns !== undefined &&
 * width < def.minColumns` and, when true, renders a `panel-too-narrow` notice INSTEAD OF the page —
 * while `components/sidePanel/dimensions.js` puts the panel column at exactly its own
 * `PANEL_MIN_COLUMNS = 28` at the split threshold. A descriptor asking for 32 therefore creates a
 * whole BAND of terminal widths in which the sidebar opens, the tab is present, and the user is shown
 * a refusal message rather than a graph. Asking for the host's floor removes that band entirely.
 *
 * THE NARROW RENDERING IS STILL OURS TO HANDLE: readability at 28 columns is a LAYOUT decision
 * (boxes vs rail vs list), taken inside the page from the width it is actually given — not a claim
 * about how wide the host must make the column. `descriptor.minColumns` is a request to the host;
 * degrading well is the page's own job, and conflating the two is what produced the trap.
 */
export const DAG_PANEL_MIN_COLUMNS = 28

/** The width floor the workmate page asks the host for; the same reasoning as {@link DAG_PANEL_MIN_COLUMNS}. */
export const WORKMATE_PANEL_MIN_COLUMNS = 28
