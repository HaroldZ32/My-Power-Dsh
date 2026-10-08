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
// THE ONE IMPORT, and why it is safe: `sanitize.ts` is a leaf (it imports nothing), so this file's
// only edge is a one-way one and no cycle can form. It is needed because `DAG_CHARS` must prove its
// own glyphs are one CELL each — a wide glyph in that table would shear every border it touched, and
// re-deriving "how many cells is this character" here is exactly the drift `cellWidth` exists to stop.
//
// WHY THE WEB HEXES ARE STILL RECORDED. They are provenance, not styling: a reviewer can see that the
// six host theme keys were chosen to mean the same thing as the WEB tones, and a test can assert the
// mapping is total and 1:1 without asserting a single size. A colour is a meaning; a size is a layout.
import { cellWidth } from "./sanitize.js"

/**
 * The host THEME KEYS this contract is allowed to name.
 *
 * Declared as a literal union rather than imported as the host's whole `Theme` type, so this file
 * depends on NO other package: the contract is the captain's, it must compile before any other lane's
 * file exists, and the host's 73-key `Theme` interface is another package's shape (the adapter
 * re-exports it, and `types.ts` belongs to a different writer this wave). Every member of this
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
 * THE DAG's GLYPH TABLE — every box-drawing character the drawing may paint, as DECLARED DATA.
 *
 * WHY DATA AND NOT LITERALS AT THE CALL SITES. The rounded corners are the change the user asked for
 * ("渲染可以参考 fasouto/termaid"), and they touch the node borders, the edge turns and the legend at
 * once. A literal `╭` in the layout, another in the test that reads the box, and a third in the
 * fidelity instrument is three places to drift; here there is one. The key names follow the mask the
 * drawing ORs into a cell, so `graph.ts`'s `JUNCTION` table is BUILT from this object rather than
 * restating it.
 *
 * THE ROUNDED TWINS ARE THE SHARP ENTRIES' REPLACEMENTS, one for one: `╭` takes `┌` (`DOWN|RIGHT`),
 * `╮` takes `┐` (`DOWN|LEFT`), `╰` takes `└` (`UP|RIGHT`), `╯` takes `┘` (`UP|LEFT`). The runs and
 * tees are unchanged, because `─ │ ├ ┤ ┬ ┴ ┼` carry no corner and rounding them would be a lie about
 * the geometry.
 */
export const DAG_CHARS = Object.freeze({
  /** `DOWN|RIGHT`: a node's TOP-LEFT corner, and any edge turning from a downward into a rightward run. */
  cornerDownRight: "╭",
  /** `DOWN|LEFT`: a node's TOP-RIGHT corner. */
  cornerDownLeft: "╮",
  /** `UP|RIGHT`: a node's BOTTOM-LEFT corner. */
  cornerUpRight: "╰",
  /** `UP|LEFT`: a node's BOTTOM-RIGHT corner. */
  cornerUpLeft: "╯",
  /** `UP|DOWN`: a vertical run, one cell per row. */
  vertical: "│",
  /** `LEFT|RIGHT`: a horizontal run, one cell per column. */
  horizontal: "─",
  /** `UP|DOWN|RIGHT`: a vertical run branching right. */
  teeRight: "├",
  /** `UP|DOWN|LEFT`: a vertical run branching left. */
  teeLeft: "┤",
  /** `UP|LEFT|RIGHT`: the cell DIRECTLY BELOW a `▼`, on the dependent's own top border. */
  teeUp: "┴",
  /** `DOWN|LEFT|RIGHT`: a box's bottom border where an edge LEAVES, read as "this box has children". */
  teeDown: "┬",
  /** All four directions: a genuine crossing of two edges. */
  cross: "┼",
  /** The arrowhead every drawn edge ENDS in, at the dependent's entry cell. */
  arrowDown: "▼",
  /** The rail's directional marker: the same "into this task" reading in the rail's own geometry. */
  arrowRight: "▸",
  /** The marker a FOCUSED task draws instead of its state glyph. */
  focusMarker: "▶",
  /** The rail's elbow into the last child (`└─`) and into the others (`├─`); declared together so the
   * pair can never be half-rounded — the rail is T9's narrow fallback and keeps its SHARP elbows. */
  railElbowLast: "└─",
  /** The rail's elbow into a non-last child. */
  railElbowMid: "├─",
} as const)

/**
 * The cells each declared glyph occupies, so the layout can prove what it paints.
 *
 * EVERY member must be ONE cell per character (`DAG_CHARS.arrowDown` is `▼`, one cell; the rail elbows
 * are two-character strings of two one-cell glyphs, which is why the measurement is per character and
 * not per string). A wide glyph sneaking into this table would shear every box border it touched, so
 * the fact is asserted rather than assumed.
 */
export const DAG_CHARS_ONE_CELL: boolean = Object.values(DAG_CHARS).every((glyph) =>
  [...glyph].every((character) => cellWidth(character) === 1),
)

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
 * The marks a RUNNING surface breathes through, in draw order — THE ONE TABLE EVERY ANIMATION READS
 * (the DAG page's node label and the subagent panel's row marker).
 *
 * IT IS DECLARED BEFORE `DAG_ANIM` ON PURPOSE: the cycle's frame COUNT is derived from this table, so
 * the count and the orbit are ONE fact. A literal count beside a table is a latent incoherence — add a
 * frame and the phase arithmetic can no longer reach it (or it aliases), and the symptom is a frame
 * that never draws rather than a crash.
 *
 * EVERY ENTRY IS EXACTLY ONE CELL: the DAG label EMBEDS its frame, so a frame of a different width
 * makes the label change width on the tick, which re-lays-out the box drawn around it — the right
 * border then advances and retreats, which is the user's report that the animation breaks the frame.
 * The head is the contract's own `running` glyph, so the frame a timer-less host draws
 * (`staticPhase`) is the character the legend names for this state; `?? "◐"` keeps the orbit
 * drawable rather than empty if the contract ever stops declaring a running glyph. No entry is a
 * mark another state owns (`✓ ✗ ○ ⊘`) and none is a bare space or dot, which would read as "no
 * state" for a quarter of the cycle.
 */
const RUNNING_FRAMES: readonly string[] = Object.freeze([
  DAG_TONE_GLYPH.running ?? "◐",
  `${DAG_TONE_GLYPH.running ?? "◐"}·`,
  DAG_TONE_GLYPH.running ?? "◐",
  `${DAG_TONE_GLYPH.running ?? "◐"}··`,
])

/**
 * The animation budget for a running node.
 *
 * `intervalMs` is the tick the host's `useAnimationTime` is asked for; a host that offers no timer
 * must draw the STATIC frame, so `staticPhase` is the phase a degraded surface renders.
 */
export const DAG_ANIM = Object.freeze({
  /** The tick interval; ~8fps is smooth enough for a breathing dot and cheap on a terminal. */
  intervalMs: 125,
  /** The number of distinct frames the breathing cycle is quantised to, DERIVED from `runningFrames`. */
  frames: RUNNING_FRAMES.length,
  /** The frame index a surface draws when the host exposes no animation timer; frame 0, the orbit's head. */
  staticPhase: 0,
  /** The marks a RUNNING surface breathes through, in draw order; see {@link RUNNING_FRAMES}. */
  runningFrames: RUNNING_FRAMES,
} as const)

// `DAG_PANEL_SLUG` STOOD HERE AND IS DELETED (wave `tui-014-adaptation`, clause C3), decided from the
// code rather than from taste: a repo-wide grep over `packages/`, `scripts/` and `skills/` found ZERO
// readers — its own declaration was the only occurrence — because the DAG page registers nothing any
// more. The ONE surviving slug is `panel.ts`'s `PANEL_SLUG` (`"team"`), which is the descriptor the host
// actually receives; keeping a second slug here would name a panel the sidebar cannot show.

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
