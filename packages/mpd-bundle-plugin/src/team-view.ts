// mpd bundle web client — THE TEAM VIEW, and the ONE body both sidebars render.
//
// WHY ONE BODY. The two sidebar hosts are different extension APIs with different prop shapes:
// `dsh-better-sidebar` hands a body `{ctx, store, scope, tab}`, while the harness's own right sidebar
// dispatches bodies through a keyed SLOT with its own injected props. A view written against either
// one works only there. Both can `fetch`, so both get the same JSON from this bundle's own route
// (`/plugins/mpd-team/state`) and render the same component.
//
// WHY OUR ROUTE AND NOT THE CLIENT STORE. Until W4 this view read the OFFICIAL client projection
// (`useSessions(s => s.projectionsBySession[leadId].values.agentTeam)`), which is the last place the
// official plugin was still the source of truth — and a store that is EMPTY in exactly the
// compositions the split exists for, because a client store can only carry what a mounted service
// projected. The route serves the mpd record, which carries `kind`, `attempt`, `round` and `verdict`
// — fields the official board has no column for.
//
// THE CHANGE FEED IS AN ADDITION, NOT A REPLACEMENT (lane W, 2026-10-08). The panel still polls
// (`pollMs`), and it ALSO subscribes to the team record's change stream when the composition threads
// a route in (`eventsPath`): every `data:` frame runs the SAME `tick` the interval runs, so the
// pushed and the polled frame can never disagree, and a host without `EventSource` — or a proxy that
// cuts the stream — keeps exactly the behaviour it had before. See `start` for the lifecycle.
//
// THE PANELS (the wave's R1 contract, docs/plan-webui-tui-i18n.md §3): a header carrying the
// team-level figures, a progress bar, one PLAIN card per member, the task-dependency DAG (rank
// columns, one drawn edge per `blockedBy`, a hover focus chain, a click-to-pin detail body) and an
// empty state that names the call which fills it. Every user-visible string resolves through
// `deps.t`, an OPTIONAL translator whose absence falls back to the English literal in the code below
// — so the view is never a crash away from being readable.
//
// Plain JS, React.createElement only: there is no JSX transform in this bundle. This file is a
// FACTORY BODY, not a module — the whole file is ONE arrow-function expression, spliced into
// `client.js` by `scripts/build-mpd-client.ts`, so it has no top-level import/export and every type
// it needs is declared inside the factory.
(require: (id: string) => unknown) => {
  /** The React surface a factory body builds with (the host's own copy, via `require`). */
  interface ReactSurface {
    /** Create one element; `props` is null for a props-less element and children follow variadically. */
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
    /** The effect primitive the poller owns its lifetime with. */
    useEffect: (effect: () => unknown, deps: unknown[]) => unknown
    /** The state primitive the poller publishes with. */
    useState: (initial: unknown) => [unknown, (next: unknown) => void]
    /**
     * The portal primitive, when the host's React copy exposes one.
     *
     * OPTIONAL because this factory also renders in the offline harness and in any host that hands it a
     * reduced React surface: the hover card then falls back to an inline fixed element at the panel
     * root, which is still outside `[data-mpd-graph]` and therefore outside the drawing's text rules.
     */
    createPortal?: (children: unknown, container: unknown) => unknown
  }

  /**
   * The translator the host binds to its own locale namespace.
   *
   * OPTIONAL by contract: `web-client.ts` owns the `ctx.locale.bind("mpdTeamSidebar")` call and threads
   * the bound function in, so this file stays renderable — and testable — with no locale seam at all,
   * in which case a missing translator reads the English source literal instead.
   */
  interface Translator {
    /** Resolve one key to the active language; the host answers the key itself when it misses. */
    (key: string): string
  }

  /**
   * The change stream the view subscribes to, narrowed to the TWO members it uses.
   *
   * DECLARED HERE RATHER THAN TAKEN FROM THE DOM LIB, so the factory compiles in the browser build
   * and in the offline harness alike: the view installs ONE message hook and closes the stream on
   * unmount, and reconnecting is the browser's own job (the route sends `retry: 1000`), so no other
   * member of the real `EventSource` is ever touched.
   */
  interface ChangeStream {
    /** The hook the view installs; the stream calls it once per `data:` frame. */
    onmessage: ((event: unknown) => void) | null
    /** Close the connection; the view calls it once, when the effect that opened it is disposed. */
    close: () => void
  }

  /** The constructor shape of the host's `EventSource`, read off the global at subscribe time. */
  interface ChangeStreamCtor {
    /** Open a stream on one URL; the browser reconnects on its own after a transport error. */
    new (url: string): ChangeStream
  }

  /** One member row, as the route serves it. */
  interface TeamMember {
    /** The mpd member id. */
    id: string
    /** Display name. */
    name: string
    /** Optional roster role label. */
    role?: string
    /** The member's own state (`running`, `idle`, …). */
    status: string
    /** Tasks this member owns that are completed. */
    done: number
    /** Tasks this member owns. */
    total: number
    /** The first unfinished task this member owns. */
    current?: string
    /** `provider/model`, when the roster resolved a slot. */
    route?: string
  }

  /** One task row, as the route serves it. */
  interface TeamTask {
    /** The mpd task id (`T1`). */
    id: string
    /** The task title. */
    subject: string
    /** `requirement` | `work` | `review` | `repair` | `integration`. */
    kind?: string
    /** The task's own state. */
    status: string
    /** The RENDERED state, with `blocked` derived by the store's OPT-1 rule. */
    visual: string
    /** The owning member's display name. */
    owner?: string
    /** Claim counter. */
    attempt?: number
    /** Review round. */
    round?: number
    /** Review verdict. */
    verdict?: string
    /** Blockers, in board order. */
    blockedBy: string[]
    /**
     * The blocker references that matched NOTHING when the record was written (R18's reader side).
     *
     * Mirrors the producer's own `TeamTaskRecord.unresolvedBlockers` field rather than inventing a
     * shape: `team-store.ts resolveBlockers` stores the entries that resolved in `blockedBy` — the
     * unresolvable ones INCLUDED, verbatim — and the ones that matched no task here, de-duplicated.
     * ABSENT when everything resolved, which is the whole reason it exists as a field: an absent key
     * plus an empty `blockedBy` means "this task has no blockers", while a present key means "this task
     * HAS blockers and the record could not name them". Those two states used to look identical.
     */
    unresolvedBlockers?: string[]
    /** Blockers that FAILED — reported BESIDE the state, which is the OPT-1 rule. */
    failedBy: string[]
    /** Longest dependency path; the OLDER-SERVER fallback for the column (see {@link TeamTask.rank}). */
    depth: number
    /**
     * The rank the HOST computed for this task, served beside the board.
     *
     * MAPPED FROM `GraphNode.depth`: the shared core's `GraphTask.depth` IS the boxes view's rank, so
     * a rank arriving under the name `depth` would read as a bug to the next reader — it is renamed
     * here, at the wire boundary, and nowhere else. ABSENT on a payload from an older server, which
     * is the documented degrade to {@link TeamTask.depth} in `layout`.
     */
    rank?: number
    /**
     * True when the PLAN declared this task and the board does not: a GHOST.
     *
     * A ghost is drawn as a normal box in the EXISTING `open` tone (no new glyph, no new colour), with
     * `visual: "planned"`. It carries no board row, so it has no status, attempt or detail contract.
     */
    planned?: boolean
    /**
     * ISO-8601 UTC instant the task entered `in_progress`, when the record stamped one.
     *
     * ABSENT for a task that never started (and for a payload from an older server). The elapsed time
     * the hover card shows is measured from THIS field, never from `updatedAt`, which is not a start.
     */
    startedAt?: string
    /**
     * ISO-8601 UTC instant the task entered `completed` or `failed`; removed if the task is reopened.
     *
     * ABSENT while the task is unfinished. A completed task without this stamp shows a dash rather
     * than an invented duration, because the record genuinely does not know when it ended.
     */
    finishedAt?: string
    /**
     * COARSE completion, 0-100, derived read-side by the route from the rendered state.
     *
     * It is a LABEL of the lifecycle (`completed` 100, `running` 50, `claimed` 10, anything else 0),
     * not measured work; the hover card prints the number beside its bar so a reader cannot mistake
     * it for a precise percentage.
     */
    progress?: number
  }

  /**
   * Where the hover card is and which task it describes.
   *
   * The position is the browser's own `clientX/clientY` plus a 14px offset, already clamped against
   * `window.innerWidth/innerHeight`; the card itself is `position: fixed`, so viewport coordinates are
   * the only thing it needs and no layout measurement is ever taken.
   */
  interface TipState {
    /** The hovered task's id, looked up in the DRAWN tasks (ghosts included). */
    id: string
    /** The viewport x the card is anchored at, in pixels. */
    x: number
    /** The viewport y the card is anchored at, in pixels. */
    y: number
  }

  /**
   * One of the WORKSPACE's teams, as `/plugins/mpd-team/state` lists it beside the session's own.
   *
   * Read for the session-less branch: a session that approved nothing still has a workspace, and the
   * teams in it are what the panel shows instead of the bare empty sentence.
   */
  interface WorkspaceTeam {
    /** The mpd team id (`<team-…>`). */
    id: string
    /** The team name the user reads. */
    name: string
    /** What the team is for. */
    description: string
    /** `staged` | `active` | `idle` | `ended`, as the store derives it. */
    phase: string
    /** ISO instant the plan was approved, when it was. */
    approvedAt?: string
    /** The task tally, so a finished wave reads differently from a running one. */
    tasks: { total: number; completed: number; failed: number }
    /** The roster size. */
    members: number
    /** Whether the workspace index binds this team to the session that asked. */
    active: boolean
  }

  /**
   * One node of the host's model, narrowed to what this drawing reads.
   *
   * The full node is `GraphNode` from `mpd-graph-core`; the fields below are the ones a box needs. A
   * node the PLAN declared and the board did not carries `planned: true` — the GHOST this view draws
   * so a plan edit changes the picture.
   */
  interface ServedGraphModelNode {
    /** The task id the box draws. */
    id: string
    /** The node's RANK: the core's `GraphTask.depth`, which is the column index. */
    depth: number
    /** The board's subject, when the board carries this node. */
    subject?: string
    /** The plan's own title, kept beside the board's subject. */
    title?: string
    /** `requirement` | `work` | `review` | `repair` | `integration`. */
    kind?: string
    /** The board's durable status, absent for a ghost. */
    status?: string
    /** Owner display name, absent when nobody holds it. */
    assignee?: string
    /** Ids this node is blocked by, merged from the board and the plan. */
    dependencies?: string[]
    /** True for a plan-only GHOST, which is drawn rather than dropped. */
    planned?: boolean
  }

  /** One dependency edge of the host's model: `from` must close before `to`. */
  interface ServedGraphModelEdge {
    /** The blocker id. */
    from: string
    /** The blocked id. */
    to: string
  }

  /**
   * The graph model the host serves beside the board, narrowed to what this drawing reads.
   *
   * THE FULL VALUE IS `GraphModel` FROM `mpd-graph-core` — `{ nodes, edges, ranks, cycles, report }`.
   * This factory reads the NODES (for plan-only ghosts and the report), the EDGES (so a plan-declared
   * dependency is drawn) and the REPORT. Each board task's served rank rides on the task entries as
   * {@link TeamTask.rank}, so no join is needed for a box's column; the rest of the model belongs to
   * planes that draw from it directly. A structural subset is deliberate: the factory body has no
   * imports, and a type is the only way to describe the wire without one.
   */
  interface ServedGraphModel {
    /** Every merged node, ghosts included; absent on a payload that carries no model. */
    nodes?: ServedGraphModelNode[]
    /** Every merged edge, plan-declared ones included; absent on a payload with no model. */
    edges?: ServedGraphModelEdge[]
    /**
     * What the merge decided: whether the ranks came from the dependency graph, and which blocker
     * references resolve to nothing — the report {@link GraphGeometry.ranksDerived} and
     * {@link GraphGeometry.unresolved} surface.
     */
    report: { ranksDerived: boolean; unresolved: string[] }
  }

  /** The payload the route serves. */
  interface TeamState {
    /** The route's own success marker. */
    ok?: boolean
    /** The workspace the record was read from. */
    workspace?: string
    /** The workspace's teams, newest first — absent on a payload from a route that did not read them. */
    workspaceTeams?: { records: WorkspaceTeam[]; activeId?: string }
    /** The team head, or null when the session has none. */
    team: { id: string; name: string; description: string; phase: string; approvedAt?: string; links: number } | null
    /** The tally, in the record's own vocabulary. */
    counts: { total: number; completed: number; running: number; ready: number; blocked: number; failed: number; releasedByFailure: number }
    /** The roster. */
    members: TeamMember[]
    /** The board, in rank order. */
    tasks: TeamTask[]
    /**
     * The graph model the HOST computed once with the shared core (`mpd-graph-core`).
     *
     * ADDITIVE, and the only model this plane may draw: `mpd-team-core-plugin` merges the live board
     * with the task plan and publishes the result here, so the browser derives NOTHING — a rank or an
     * edge it computed would be a second implementation free to drift from the TUI's. ABSENT on a
     * payload from an older server, the documented degrade {@link ServedGraphModel} describes.
     */
    model?: ServedGraphModel
    /** Task ids on a dependency cycle. */
    cycles: string[]
    /** Which backend raises this team's members, and why. */
    executor: { kind: string; reason: string }
    /** Bounded notes. */
    problems: string[]
  }

  /**
   * The route's per-task record, as `/plugins/mpd-team/task` serves it: the FROZEN acceptance
   * contracts, one per claimed task. Read for the pinned task's detail body, so the sidebar quotes the
   * text a reviewer holds the work to rather than a summary of it.
   */
  interface TeamTaskContracts {
    /** The route's own success marker. */
    ok?: boolean
    /** The frozen acceptance contracts, one per claimed task. */
    contracts: Array<{ taskId: string; subject: string; description: string; claimedBy: string; claimedAt: string; attempt: number; blockedBy: string[] }>
  }

  /** The staged plan, as `/plugins/mpd-team/plan` serves it — the SHARED projection's half. */
  interface TeamPlan {
    /** The route's own success marker. */
    ok?: boolean
    /** The staged plan, or null when this session has nothing awaiting approval. */
    plan: {
      /** The PRE-approval identity, and the phrase the gate demands is built from it. */
      planId: string
      /** The team name the user reads. */
      name: string
      /** What the team is for. */
      description: string
      /** `required` waits for an explicit approval. */
      approval: string
      /** ISO instant it was staged. */
      stagedAt: string
      /** The EXACT string a gate demands. SERVED by the shared projection, never re-derived here. */
      phrase: string
      /** Whether an approval already committed. */
      approved: boolean
      /** Whether it was discarded instead. */
      discarded: boolean
      /** The teammates it wants raised. */
      members: Array<{ name: string; description: string; role?: string; id?: string }>
      /** The tasks it wants posted. */
      tasks: Array<{ subject: string; description: string; owner?: string; blockedBy: string[]; id?: string }>
    } | null
  }

  /** What one poll produced: the last payload, or the last failure. */
  interface TeamStore {
    /** The last readable payload, or null before the first success. */
    state: TeamState | null
    /** The STAGED PLAN half, or null when nothing is staged or the route could not be read. */
    plan: TeamPlan | null
    /** The FROZEN contracts by task id; empty until the task route answers. */
    contracts: Record<string, { description: string; claimedBy: string; claimedAt: string; attempt: number }>
    /** The last failure, kept so the panel renders a reason instead of an empty box. */
    error?: unknown
  }

  /** One node's box inside its column, in pixels — the geometry the drawn edges are computed from. */
  interface GraphNode {
    /** The task this node draws. */
    task: TeamTask
    /** The rank column it sits in, which is the task's own `depth`. */
    rank: number
    /** Its row inside that column. */
    row: number
    /**
     * The task's 1-based position in the BOARD ORDER the layout was handed — clause C4's ordinal.
     *
     * Not the drawn row: the columns are re-ordered by rank and id, so a node that read its position
     * off the picture would number the picture. The fallback label `<glyph> <id> <KIND> #<ordinal>`
     * has to name the task's place in the board the reader is looking at.
     */
    ordinal: number
    /** Its offset from the column's top edge. */
    top: number
  }

  /** One painted rectangle of one drawn edge, in the canvas's own pixels. */
  interface EdgeRect {
    /** The left x. */
    left: number
    /** The top y. */
    top: number
    /** The width in pixels; a vertical run is one pixel wide. */
    width: number
    /** The height in pixels; a horizontal run is one pixel tall. */
    height: number
  }

  /** One point of a flattened curve, in the canvas's own pixels — the sample a containment test reads. */
  interface CurvePoint {
    /** The offset from the canvas's left edge, in pixels. */
    x: number
    /** The offset from the canvas's top edge, in pixels. */
    y: number
  }

  /**
   * One route's PAINTED form: the SVG path that draws it, the polyline that proves it, and its head.
   *
   * `points` is a flattened SAMPLE of exactly the path `d` describes — built in the same closed-form
   * call, at the same radius — so "this edge never enters a node box" is a statement about the DRAWN
   * curve that a test can prove arithmetically, without a browser, a canvas or a measuring pass. The
   * drawing and the proof are therefore one object rather than two that must agree.
   */
  interface EdgeCurve {
    /** The `<path>` `d`: the route's own vertices, filleted, with a cubic sweep into the final approach. */
    d: string
    /**
     * The FLATTENED polyline of exactly that path — W3's sample, and the one thing that makes the
     * drawing provable: consecutive points form segments a containment test can measure against a box's
     * interior, so "this edge never enters a node" is a statement about the PAINTED curve.
     *
     * A straight leg contributes its two ends and nothing else (a segment test is exact, so sampling a
     * line would only invent points); each `Q`/`C` arc contributes its own samples at ≤1px steps. At
     * `radius = 0` there are no arcs at all, so this list IS the route's waypoint list, point for point.
     */
    points: CurvePoint[]
    /** The ARRIVAL POINT the arrowhead's tip stands on, so W5 is a pure equality against `toX`/`toY`. */
    tip: CurvePoint
    /** The corner radius the path was built with, echoed so the `radius = 0` control is observable here. */
    radius: number
  }

  /**
   * One drawn dependency, ROUTED BEFORE IT IS PAINTED.
   *
   * The route is computed here, once, and the render only paints it — the single source of truth the
   * file's GEO comment demands. That is also what lets the geometry be ASSERTED: a test reads these
   * rectangles and proves no edge crosses a box, which is the mechanical meaning of "legible".
   */
  interface DrawnEdge {
    /** The blocker's task id. */
    parent: string
    /** The blocked task's id. */
    child: string
    /** The witness value `data-mpd-edge` carries, so the count and the drawing cannot disagree. */
    witness: string
    /** The painted runs, in draw order: the lead-out first, the lead-in last. */
    segments: Array<{ key: string; rect: EdgeRect }>
    /**
     * The PAINTED form of those same runs: one SVG path, its flattened polyline and its arrowhead.
     *
     * Derived from the SAME waypoints the segments were cut from, never re-routed: `segments` stay the
     * routing truth `data-mpd-route` publishes, and this is their parametrisation into a curve.
     */
    curve: EdgeCurve
    /** The arrival marker whose tip touches the blocked task's border, so the direction is readable. */
    marker: EdgeRect
    /** Whether the marker points LEFT, which is how a back edge (a cycle) arrives. */
    pointsLeft: boolean
  }

  /**
   * The whole DAG geometry, computed ONCE from the payload and never measured.
   *
   * A measuring pass would be a second source of truth (it can disagree with the data); fixed boxes
   * cannot, so every edge below is arithmetic over ranks and rows.
   */
  interface GraphGeometry {
    /** One column per rank, in rank order; each entry is that rank's tasks in board order. */
    columns: TeamTask[][]
    /** How many rank columns the grid draws. */
    rankCount: number
    /** The grid's own width in pixels: one fixed column per rank. */
    width: number
    /** The grid's own height in pixels, never zero and symmetric about {@link centerY}. */
    height: number
    /** The column-major grid template, so a column's left edge is `rank * columnWidth`. */
    gridTemplateColumns: string
    /** One entry per node, in column-major order. */
    nodes: GraphNode[]
    /** One routed edge per `blockedBy` entry naming a task on the board, in board order. */
    edges: DrawnEdge[]
    /** The inset every box keeps inside its column, widened by the lane count it must pay for. */
    inset: number
    /** The measured gutter between two neighbouring columns' boxes: `2 * inset`. */
    gutter: number
    /** How many vertical runs the busiest gutter must carry. */
    maxLanes: number
    /** How many lanes could NOT be given a distinct column, which a page must report (0 = all fit). */
    laneOverflow: number
    /**
     * How many boxes each rank's column holds.
     *
     * Long edges no longer reserve a row inside a column — they cross in the top/bottom band — so a
     * column's slot count is exactly its box count; the field survives because the layout's shape is
     * frozen and a reader of the web payload may still ask.
     */
    slots: number[]
    /**
     * Whether the SERVED model derived these ranks from the `blockedBy` graph.
     *
     * `false` means the payload carried no model (an older server, whose columns come from the served
     * `depth`) or the host's own rank derivation fell back to depth. Either way it is the HOST's
     * answer, never a decision made in this file.
     */
    ranksDerived: boolean
    /**
     * Blocker references that resolve to nothing, sorted and de-duplicated.
     *
     * THE UNION OF TWO SERVED SOURCES: the host model's `report.unresolved` (the shared core's
     * derivation over the served board) and the record's own `unresolvedBlockers` report. They differ
     * exactly where it matters — a record whose references were repaired after the fact still remembers
     * what did not resolve, and a viewer must not be told it is all fine. With no model, only the
     * record's own report remains: the documented degrade, not a second derivation.
     */
    unresolved: string[]
    /** The subset of {@link unresolved} the RECORD ITSELF reports; empty when the payload carries none. */
    unresolvedRecorded: string[]
    /**
     * The y every column's stack is CENTRED on, which is also the canvas's own horizontal midline.
     *
     * Derived from the tallest column's stack plus the crossing band's extent, never written down, so
     * the symmetry claim is testable against the geometry instead of against a literal: a column's
     * stack centre is `min(node.top) + stackHeight / 2`, and that must equal this value.
     */
    centerY: number
    /**
     * Every collinear overlap between two DIFFERENT edges' runs, by arithmetic.
     *
     * Empty is the promise: two edges may cross (that is a picture of dependencies, not a defect) and
     * may touch at a corner, but no two may share more than half a pixel of a horizontal or vertical
     * run, because a shared run reads as one thicker line and hides which dependency it belongs to.
     * Reported rather than silently repaired, so a board that defeats the router is visible.
     */
    overlaps: EdgeOverlap[]
  }

  /** One pair of different edges whose runs are collinear and share more than half a pixel. */
  interface EdgeOverlap {
    /** The witness (`<child><-<parent>`) of the first edge. */
    a: string
    /** The witness of the second edge. */
    b: string
    /** Whether the collinear runs are horizontal (they share a y) or vertical (they share an x). */
    orientation: "horizontal" | "vertical"
    /** The shared coordinate: the y of a horizontal pair, the x of a vertical one. */
    at: number
    /** How many pixels the two runs share. */
    overlap: number
  }

  /** The style bag this view uses; the host supplies the tokens, the literals are fallbacks. */
  const CSS = {
    panel: { padding: "10px 12px 14px", fontSize: "12px", lineHeight: 1.45, overflowY: "auto", height: "100%", width: "100%", boxSizing: "border-box" },
    dim: { color: "var(--dsw-alias-label-tertiary, #8a94a6)" },
    head: { fontSize: "13px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #1f2937)" },
    subHead: { marginTop: "10px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #1f2937)" },
    chip: { display: "inline-block", padding: "0 6px", borderRadius: "var(--dsw-radius-sm, 4px)", fontSize: "11px", border: "0.5px solid var(--dsw-alias-border-l2, #d8dde5)", color: "var(--dsw-alias-label-secondary, #5b6472)" },
    row: { display: "flex", gap: "6px", alignItems: "baseline", padding: "2px 0" },
    card: { border: "0.5px solid var(--dsw-alias-border-l2, #d8dde5)", borderRadius: "var(--dsw-radius-md, 8px)", padding: "6px 8px", marginBottom: "6px", background: "var(--dsw-alias-bg-layer-3, transparent)" },
    meta: { fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)", fontSize: "10px", color: "var(--dsw-alias-label-tertiary, #8a94a6)" },
    bar: { height: "6px", borderRadius: "var(--dsw-radius-sm, 4px)", background: "var(--dsw-alias-bg-layer-4, #e6e8eb)", overflow: "hidden", marginTop: "6px" },
    barFill: { height: "100%", background: "var(--dsw-alias-state-success-primary, #12a150)" },
    scroll: { position: "relative", overflow: "auto", marginTop: "6px" },    grid: { position: "relative", display: "grid" },
    column: { position: "relative" },
    edgeLayer: { position: "absolute", left: 0, top: 0, pointerEvents: "none" },
    edge: { position: "absolute", background: "var(--dsw-alias-border-l2, #d8dde5)" },
    // THE BOX INSET IS NOT WRITTEN HERE: it comes from the geometry (`graph.inset`), because the
    // busiest gutter's lanes are paid for out of it and a literal would detach every box from the
    // edges routed against it. THE BACKGROUND IS NOT INLINE EITHER: the frosted-glass class in
    // `DAG_CSS` owns it, and an inline background would beat the stylesheet and make the glass a lie.
    node: { position: "absolute", boxSizing: "border-box", height: "42px", overflow: "hidden", cursor: "pointer", border: "0.5px solid var(--dsw-alias-border-l2, #d8dde5)", borderRadius: "var(--dsw-radius-sm, 4px)", padding: "3px 5px", fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)", fontSize: "10px", lineHeight: 1.3 },
    nodeTop: { display: "flex", gap: "4px", alignItems: "baseline", whiteSpace: "nowrap", overflow: "hidden" },
  }

  /**
   * THE DAG'S SCOPED STYLESHEET, rendered ONCE at the panel root as `<style data-mpd-dag-css="1">`.
   *
   * WHY A STYLESHEET RATHER THAN MORE INLINE STYLE OBJECTS. Three effects the contract asks for cannot
   * be expressed inline: `backdrop-filter` needs a class the browser can gate on `@supports`-free
   * support, `@keyframes` need a rule block, and `prefers-reduced-motion` needs a media query. The
   * element is rendered OUTSIDE `[data-mpd-graph]` on purpose, so no drawing text rule applies to it.
   *
   * ASCII ONLY: this string is served into a DOM the CJK-free drawing sits in, and a stray full-width
   * codepoint here would be invisible in review while still failing the drawing's own range scan.
   *
   * The node keeps its inline border width/colour and opacity (pinned 1px, idle 0.5px, dimmed 0.4);
   * this stylesheet supplies the MATERIAL (glass, shadow, motion) and never the geometry. Position is
   * `translate3d(...)` from the render so a rank change animates instead of jumping.
   */
  const DAG_CSS = `
.mpd-dag-node { position: absolute; left: 0; top: 0; box-sizing: border-box; overflow: hidden; cursor: pointer; border: 0.5px solid rgba(17,24,39,.22); border-radius: 6px; padding: 3px 5px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 10px; line-height: 1.3; color: #111827; background: var(--dsw-alias-bg-layer-1, #ffffff); background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.62) 55%, rgba(238,243,251,.58) 100%); -webkit-backdrop-filter: blur(14px) saturate(1.25); backdrop-filter: blur(14px) saturate(1.25); box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(17,24,39,.06), 0 1px 2px rgba(16,24,40,.08), 0 6px 18px rgba(16,24,40,.12); transition: transform 420ms cubic-bezier(.2,.8,.2,1), opacity 200ms, border-color 200ms, box-shadow 200ms; will-change: transform; }
@keyframes mpd-dag-breathe { 0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(17,24,39,.06), 0 0 0 1px rgba(77,107,254,.55), 0 0 0 5px rgba(77,107,254,.20), 0 8px 24px rgba(77,107,254,.30); border-color: rgba(77,107,254,.75); } 50% { box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(17,24,39,.06), 0 0 0 2px rgba(77,107,254,.90), 0 0 0 9px rgba(77,107,254,.32), 0 10px 30px rgba(77,107,254,.40); border-color: rgba(77,107,254,.95); } }
.mpd-dag-node[data-visual="running"] { animation: mpd-dag-breathe 2.4s ease-in-out infinite; }
.mpd-dag-tip { position: fixed; z-index: 2147483000; pointer-events: none; box-sizing: border-box; padding: 8px 10px; border: 0.5px solid rgba(17,24,39,.45); border-radius: 10px; background: rgba(255,255,255,.78); color: #111; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; line-height: 1.4; box-shadow: 0 6px 22px rgba(16,24,40,.18); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.mpd-dag-tip[data-pinned="true"] { background: #ffffff; opacity: 1; }
.mpd-dag-tip-row { display: flex; gap: 6px; justify-content: space-between; white-space: nowrap; overflow: hidden; }
.mpd-dag-tip-label { color: #4b5563; }
.mpd-dag-tip-subject { display: block; flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; margin-top: 2px; text-align: right; }
.mpd-dag-tip-bar { height: 5px; border-radius: 3px; background: rgba(17,24,39,.12); overflow: hidden; margin-top: 4px; }
.mpd-dag-tip-fill { height: 100%; background: #111; }
@keyframes mpd-dag-dash { to { stroke-dashoffset: -12; } }
.mpd-dag-flow { stroke-dasharray: 6 6; animation: mpd-dag-dash 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .mpd-dag-node { transition: none; } .mpd-dag-node[data-visual="running"] { animation: none; } .mpd-dag-flow { animation: none; } }
`

  /** The colour token each rendered state draws in — a MEANING mapped to a host token, never a literal. */
  const TONE: Record<string, string> = {
    completed: "var(--dsw-alias-state-success, #12a150)",
    running: "var(--dsw-alias-state-business-primary, #4d6bfe)",
    failed: "var(--dsw-alias-state-error-primary, #e5484d)",
    blocked: "var(--dsw-alias-state-warn-primary, #e08700)",
    cancelled: "var(--dsw-alias-label-tertiary, #8a94a6)",
    open: "var(--dsw-alias-label-secondary, #5b6472)",
  }

  /** The glyph each rendered state draws with, so the panel reads without colour. */
  const GLYPH: Record<string, string> = { completed: "✓", running: "◐", failed: "✗", blocked: "○", cancelled: "⊘", open: "○" }

  /** The key each kind abbreviation resolves through, so the abbreviation is bilingual too. */
  const KIND_KEY: Record<string, string> = { requirement: "kind.req", work: "kind.wrk", review: "kind.rev", repair: "kind.fix", integration: "kind.int" }

  /** The key each RENDERED state resolves through in the hover card, so its status is localized. */
  const VISUAL_KEY: Record<string, string> = { completed: "visual.completed", running: "visual.running", blocked: "visual.blocked", failed: "visual.failed", cancelled: "visual.cancelled", open: "visual.open", planned: "visual.planned" }

  /** The key each lifecycle phase resolves through, so a phase label is localized like every other word. */
  const PHASE_KEY: Record<string, string> = { staged: "phase.staged", active: "phase.active", idle: "phase.idle", ended: "phase.ended" }

  /** The English a key falls back to when no translator is threaded in — the view's own words. */
  const EN: Record<string, string> = {
    "header.approved": "approved",
    "header.workspace": "workspace",
    "header.complete": "complete",
    "progress.label": "Progress",
    // The two panel headings stay UPPERCASE in English: the host's own capture asserts on those
    // literals (`checks.teamPanelShowsRoster`), and a green capture is worth more than a case change.
    "members.title": "MEMBERS",
    "members.empty": "No member was raised for this team.",
    "members.current": "current",
    "task.title": "TASKS",
    "task.empty": "No shared task yet — the captain posts them with team_task_create.",
    "task.cycle": "CYCLE",
    "task.blockedBy": "blocked by",
    "task.unresolved": "unresolved blockers",
    "task.dependents": "dependents",
    "task.attempt": "attempt",
    "task.round": "round",
    "task.verdict": "verdict",
    "task.owner": "owner",
    "task.contract": "acceptance contract",
    "task.contract.none": "No frozen acceptance contract was served for this task.",
    "task.close": "close",
    "tally.running": "running",
    "tally.ready": "ready",
    "tally.blocked": "blocked",
    "tally.released": "released by a failed blocker",
    "state.reading": "Reading the team…",
    "state.unavailable": "No team state is being served. The mpd team row may not be mounted in this profile.",
    "state.none": "No team in this workspace yet. Stage one with agent_teams_plan, then approve it.",
    // ── D2: the session-less workspace listing ────────────────────────────────
    // A session that approved nothing of its own still has a workspace, and a panel that answered it
    // with the sentence above claimed the WORKSPACE was empty about a workspace holding four teams.
    // These keys render the truth instead: what is here, and which of them this session drives.
    "workspace.title": "WORKSPACE TEAMS",
    "workspace.hint": "No team is bound to this session. The workspace's own teams are listed here — a session drives the one it approved itself.",
    "workspace.active": "this session",
    "workspace.members": "members",
    "workspace.stage": "Stage one with agent_teams_plan, then approve it.",
    "phase.staged": "staged",
    "phase.active": "active",
    "phase.idle": "idle",
    "phase.ended": "ended",
    "executor.label": "executor",
    "plan.members": "Wants {n} member(s)",
    "plan.tasks": "Wants {n} task(s)",
    "plan.gate": "To approve, type:",
    "kind.req": "REQ",
    "kind.wrk": "WRK",
    "kind.rev": "REV",
    "kind.fix": "FIX",
    "kind.int": "INT",
    // ── D2: the hover card's vocabulary ────────────────────────────────────────
    // The visual state is localized BESIDE the payload's own word: the record keeps `running`, while
    // the card prints the reader's language. Every key here has a zh twin in `web-client.ts`.
    "visual.completed": "completed",
    "visual.running": "running",
    "visual.blocked": "blocked",
    "visual.failed": "failed",
    "visual.cancelled": "cancelled",
    "visual.open": "open",
    "visual.planned": "planned",
    "tip.status": "status",
    "tip.owner": "owner",
    "tip.elapsed": "elapsed",
    "tip.task": "task",
    "tip.progress": "progress",
    "tip.unassigned": "unassigned",
    "tip.notStarted": "not started",
  }

  /**
   * THE GRAPH'S ONE GEOMETRY SOURCE — the boxes and the edges both read it.
   *
   * WHY IT EXISTS (reported from a screenshot 2026-10-06): the node's own place and its edge's endpoint
   * were computed from SEPARATE literals — the box from `COLUMN_PAD + row * (NODE_H + NODE_GAP)` and the
   * edge from its own `rank * COLUMN_W ± …` arithmetic. Two expressions that must agree, in two places,
   * is how a line ends up meeting a box at the wrong spot, and it is ALSO why any change to a size
   * detaches every edge: the endpoint stops tracking the box the moment one of the literals moves.
   *
   * Every position below is DERIVED from the four sizes, so an endpoint is the box's own border and
   * cannot drift from it. A size change (a different node height, a wider column, a text-scale factor)
   * therefore moves the boxes AND the edges together.
   */
  const GEO = {
    /** One rank column's width. */
    column: 168,
    /**
     * How far a node's box sits inside its column, per side — the box is `column - 2 * inset` wide.
     *
     * TWELVE, AND THE NUMBER IS LOAD-BEARING. Two neighbouring boxes stand `2 * inset` apart, and an
     * edge's vertical run stands in the MIDDLE of that gutter, so each of its two horizontal legs is
     * `inset` long — and `curveOf` clamps a fillet to half of its shorter leg. At the old base of 4 the
     * legs were 4px, the radius clamped to 2px, and the "curves" read as an orthogonal line with a nick
     * in it: the user's ask was a mermaid-style curve, and 2px does not discharge it. A base of 12 gives
     * an ordinary one-lane forward edge its FULL 6px fillet, which is the smallest change that makes the
     * declared radius visible. The price is 24px of the box (160 → 144 wide), paid knowingly because the
     * subject line is now the graph-safe ASCII label rather than a full task title.
     */
    inset: 12,
    /** One node box's height. */
    nodeHeight: 42,
    /** The vertical gap between two nodes of one column. */
    nodeGap: 10,
    /** The vertical padding at the top and bottom of every column. */
    pad: 4,
  }
  /** The preferred spacing between two lane columns, in pixels. */
  const LANE_STEP = 3
  /** The clearance every lane keeps off a box's border, so a line never lands on a border. */
  const LANE_CLEARANCE = 1
  /** The furthest a box may be pushed inside its column, so a busy board cannot shrink a box away. */
  const MAX_INSET = 24
  /** The arrival marker's width in pixels, which is how far its tip reaches into the gutter. */
  const MARK_W = 5
  /** The arrival marker's height in pixels, which is the triangle's base. */
  const MARK_H = 8
  /**
   * The preferred spacing between two PORTS of the SHIPPED capacity fallback, in pixels.
   *
   * Kept as the crowded tier's pitch: a node with seven to eleven incident edges still uses it, and
   * {@link portStepOf} widens the pitch for smaller fan-in (the D2 repair below) while every tier
   * stays a MULTIPLE OF FOUR so each spread offset is EVEN.
   */
  const PORT_STEP = 4
  /**
   * The port pitch for a node with `count` incident edges, in pixels.
   *
   * D2 REPAIR (Docker UI capture 2026-10-21): the old single 4px pitch put the two arrivals of a
   * 2-incoming fan-in 4px apart, so their 8px arrowheads merged into one thick arrow and the fan-in
   * read as a single dependency. The pitch now WIDENS for small fan-in and only falls back when the
   * 42px box cannot hold it. Every tier is a MULTIPLE OF FOUR, so every spread offset stays EVEN,
   * which is what leaves the rank-parity channel (`shift` below) systematic rather than a per-node
   * nudge. A node with one incident edge still attaches at its border middle.
   *
   *   2..4 edges  -> 12px: two arrivals sit at +/-6 (a 12px gap), three at -12/0/+12, four at
   *                  +/-6/+/-18 (all inside the +/-20 clamp; an 8px arrowhead cannot overlap).
   *   5..6 edges  -> 8px: five at 0/+/-8/+/-16, six at +/-4/+/-12/+/-20. On an ODD rank the +/-
   *                  20 offsets clamp to +/-18, so the two outermost gaps shrink to 6px — the
   *                  documented crowded-node bound; the ports stay distinct and `overlaps` stays [].
   *   7..11 edges -> the shipped 4px pitch (eleven ports, the last count that fits 4px).
   *   12+ edges   -> the 2px capacity fallback; its own collapse bound is {@link PORT_STEP}'s story.
   *
   * @param count - how many edges touch this node (incoming plus outgoing).
   * @returns the pitch in pixels; 0 for a node with fewer than two incident edges.
   */
  const portStepOf = (count: number): number => count < 2 ? 0 : count <= 4 ? 12 : count <= 6 ? 8 : count <= 11 ? PORT_STEP : 2
  /**
   * The vertical pitch of the crossing band's rows, in pixels.
   *
   * A rank-skipping edge crosses the intermediate columns ABOVE or BELOW every box, on its own row;
   * this is the distance between two such rows and between the nearest row and the box area. Eight
   * keeps two 1px runs visibly apart without spending a whole node height of canvas per long edge.
   */
  const BAND_STEP = 8
  /**
   * The corner radius every bend of a drawn edge is filleted with, in pixels — the ONE declared knob.
   *
   * Read only through {@link curveOf}'s `radius` argument, and echoed on every drawn curve so the control
   * is observable in the LAYOUT rather than only in the DOM. `radius = 0` collapses every fillet and the
   * closing sweep into plain `L` commands, which is what makes the curve's one non-trivial claim — that
   * a rounded path still stays inside the corridor its orthogonal route was proven to occupy —
   * falsifiable rather than assumed.
   *
   * The per-vertex clamp to HALF of the shorter adjacent leg is derived, never declared, and it is what
   * makes 6px safe here: two lanes in a crowded gutter stand `LANE_STEP` apart, so an unclamped radius
   * would overshoot into its neighbour's corridor.
   */
  const EDGE_RADIUS = 6
  /**
   * The shortest leg a SWEEP is drawn across, in pixels.
   *
   * Below it the final approach degrades to the orthogonal `L`+`L` the radius-0 control emits: a lane a
   * single pixel wide cannot carry a curve, and pretending it can would push the sweep's control points
   * out of the corridor the route was proven to occupy.
   */
  const EDGE_SWEEP_MIN = 2
  /** The x of the LEFT border of a node in one column, for a column inset — the box's own border. */
  const borderLeft = (rank: number, inset: number): number => rank * GEO.column + inset
  /** The x of the RIGHT border of a node in one column, for that same inset. */
  const borderRight = (rank: number, inset: number): number => rank * GEO.column + GEO.column - inset
  /**
   * Every collinear overlap between two DIFFERENT edges' runs, by pure arithmetic over the routes.
   *
   * This is the mechanical meaning of "the lines do not overlap": two horizontal runs collide when
   * they share a y and their x intervals share more than half a pixel; two vertical runs collide when
   * they share an x and their y intervals do. Half a pixel is the tolerance because a run is one pixel
   * thick and two runs that merely ABUT — a corner, or a run touching the lane its own riser stands on
   * — share a boundary, not a stretch; counting that would report every legitimate corner as a defect.
   * @param edges - the routed edges, in draw order.
   * @returns one entry per overlapping pair, in edge order and then in run order.
   */
  const overlapAudit = (edges: DrawnEdge[]): EdgeOverlap[] => {
    /** The overlaps found so far. */
    const found: EdgeOverlap[] = []
    for (let first = 0; first < edges.length; first += 1) {
      for (let second = first + 1; second < edges.length; second += 1) {
        for (const left of edges[first].segments) {
          for (const right of edges[second].segments) {
            /** The first run being compared. */
            const a = left.rect
            /** The second run. */
            const b = right.rect
            // A one-pixel run is horizontal when its height is 1 and vertical when its width is 1. A
            // degenerate run (both 1) qualifies as both, which is harmless: two dots on one point
            // really do coincide, and reporting them twice still means "not empty".
            if (a.height === 1 && b.height === 1 && Math.abs(a.top - b.top) < 0.5) {
              /** How much of the two x intervals is shared. */
              const shared = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
              if (shared > 0.5) found.push({ a: edges[first].witness, b: edges[second].witness, orientation: "horizontal", at: a.top, overlap: shared })
            }
            if (a.width === 1 && b.width === 1 && Math.abs(a.left - b.left) < 0.5) {
              /** How much of the two y intervals is shared. */
              const shared = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
              if (shared > 0.5) found.push({ a: edges[first].witness, b: edges[second].witness, orientation: "vertical", at: a.left, overlap: shared })
            }
          }
        }
      }
    }
    return found
  }
  /** How far a member's current task is truncated before it is drawn. */
  /**
   * Read the session id off the host's own sidebar DOM marker, as a LAST resort.
   *
   * WHY THIS EXISTS (MEASURED 2026-10-05, on the installed harness): the right sidebar renders a tab
   * body with an EMPTY props object — `renderSlot(seat, {}, …)` — so neither `props.sessionId` nor
   * `props.scope.sessionId` carries anything, and the panel addressed the workspace principal instead
   * of the session on screen. The host does publish the session, on
   * `[data-sidebar-right-session]` elements that are SIBLINGS of the pane rather than ancestors of the
   * body, so walking up cannot find it either. This is the host's own marker (its pane reports it and
   * the client uses it for hit-testing), and reading it is the only route from a tab body to its own
   * session without a prop the host does not pass.
   *
   * TOTAL and side-effect free: no `document` (a non-browser render, or a test) answers "", a marker
   * without the attribute answers "", and the first marker wins because a document holds one right
   * sidebar per session and the visible pane's is the one the browser reports first.
   * @returns the DOM-advertised session id, or "" when the page does not advertise one.
   */
  function sessionIdFromPane(): string {
    /** The page's document, or undefined outside a browser. */
    const doc = typeof document === "undefined" ? undefined : document
    if (doc === undefined || typeof doc.querySelector !== "function") return ""
    /** The first element carrying the host's session marker. */
    const marked = doc.querySelector("[data-sidebar-right-session]")
    if (marked === null) return ""
    /** The marker's value, when it is a non-empty string. */
    const value = marked.getAttribute("data-sidebar-right-session")
    return typeof value === "string" ? value : ""
  }

  /** How much of a task subject a node or a member card shows before it ellipsizes. */
  const SUBJECT_MAX = 30
  /** How far the hover card sits from the pointer, in pixels, on both axes. */
  const TIP_OFFSET = 14
  /** The hover card's fixed width, in pixels, so its subject can ellipsize instead of wrapping. */
  const TIP_WIDTH = 240
  /** The card's estimated height, in pixels, used only to clamp it inside a short viewport. */
  const TIP_HEIGHT = 104
  /** How much of a subject the hover card shows before its own ellipsis takes over. */
  const TIP_SUBJECT_MAX = 42
  /** The colour a focused edge draws in — a token with its literal fallback, like every other value here. */
  const FOCUS_EDGE = "var(--dsw-alias-label-secondary, #5b6472)"
  /**
   * The order two task ids draw in: NUMERIC, so `T2` precedes `T10` instead of following it (R19).
   *
   * `t10` sorts before `t2` character-wise, which is the opposite of how a reader counts tasks, so the
   * comparator is numeric rather than lexical — the same rule, and the same reference model, as the TUI
   * drawing engine's.
   */
  const ID_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

  return {
    /**
     * Build the team view ONCE, so both sidebar hosts render the same component with the same
     * polling behaviour rather than two lookalikes that can drift.
     * @param deps - the React surface, the routes (the change stream's included), the poll interval
     *   and the host's translator.
     * @returns the view component, its poller and the DAG layout the panel draws with.
     */
    createTeamView(deps: { react: ReactSurface; statePath: string; planPath?: string; taskPath?: string; eventsPath?: string; pollMs?: number; t?: Translator }): {
      /** The component; the host calls it with ITS own props, which this view ignores but tolerates. */
      TeamView: (props?: unknown) => unknown
      /** Start polling for one session; returns a stop function the caller owns. */
      start: (sessionId: string, publish: (next: TeamStore) => void) => () => void
      /** Read the routes once, resolving to the payloads or a failure. */
      read: (sessionId: string) => Promise<TeamStore>
      /** The DAG geometry of one board, exposed so the layout is provable without rendering. */
      layout: (tasks: TeamTask[], radius?: number, served?: ServedGraphModel) => GraphGeometry
      /**
       * The graph-safe label rule itself (clause C4), exposed so the drawing's one composer is provable.
       * @param subject - the subject as served.
       * @param ordinal - the task's 1-based position in the board order.
       * @returns the label the drawing writes.
       */
      graphSafeLabel: (subject: string, ordinal: number) => string
      /**
       * The curve builder itself, exposed so its `radius = 0` control can be driven directly (W6).
       * @param waypoints - the route's vertices, in travel order.
       * @param radius - the corner radius; `0` emits the straight orthogonal polyline.
       * @returns the path's `d` and the flattened polyline of exactly that path.
       */
      curveOf: (waypoints: CurvePoint[], radius: number) => { d: string; points: CurvePoint[] }
      /**
       * The overlap audit itself, exposed so a deliberately overlapping pair can be FED to it — the
       * positive control that proves the promise `overlaps === []` is falsifiable.
       * @param edges - the routed edges to audit.
       * @returns every collinear overlap between two different edges' runs.
       */
      overlapAudit: (edges: DrawnEdge[]) => EdgeOverlap[]
      /**
       * The elapsed-time formatter itself, exposed ADDITIVELY so the duration grammar is provable
       * without a browser (and so a host can reuse the same words the card shows).
       * @param task - the three fields the formatter reads: `startedAt`, `finishedAt`, `visual`.
       * @param nowMs - the clock for a running task; defaults to the current instant.
       * @returns `Xs`, `Xm Ys`, or `Xh Ym`, and `-` when the record cannot answer.
       */
      formatElapsed: (task: { startedAt?: string; finishedAt?: string; visual: string }, nowMs?: number) => string
    } {
      /** The dependencies this closure reads on every call, plus the plan, task and events routes when given. */
      const { react, statePath, planPath, taskPath, eventsPath } = deps
      /** How often the panel re-reads; the route is cheap and this is a status surface. */
      const pollMs = typeof deps.pollMs === "number" && deps.pollMs > 0 ? deps.pollMs : 2000
      /** The host's translator; absent in a bare mount, in which case the English literals below win. */
      const hostT = deps.t
      // BOTH SETTERS ARE DECLARED AT FACTORY SCOPE, not inside the component. The detail body and the
      // edge drawing are FUNCTION DECLARATIONS of this factory, so a name that only existed inside
      // `TeamView` would be a `ReferenceError` the moment a handler fired — measured: the detail
      // body's close button threw exactly that. The hook still owns the state; these two only carry
      // the setters the last render produced, and every reader below runs after a render.
      /** The pinned-task setter the last render produced; null until the first render runs. */
      let setPinned: ((next: string | null) => void) | null = null
      /** The hover setter the last render produced; null until the first render runs. */
      let setHover: ((next: string | null) => void) | null = null

      /** Read the routes, never rejecting: a failure is a VALUE the panel renders. */
      /** The session suffix every route takes, so they cannot address different sessions. */
      const queryOf = (sessionId: string): string => (sessionId === "" ? "" : "?sessionId=" + encodeURIComponent(sessionId))
      /** Read ONE route, never rejecting; a failure is a VALUE the panel renders. */
      const readOne = async <T,>(path: string, sessionId: string): Promise<{ value: T | null; error?: unknown }> => {
        try {
          /** The host's own transport; the panel never assumes a proxy. */
          const response = await fetch(path + queryOf(sessionId), { headers: { accept: "application/json" } })
          if (!response.ok) return { value: null, error: { status: response.status } }
          /** The served payload, validated below rather than trusted. */
          const payload = (await response.json()) as T & { ok?: boolean }
          // A payload without the route's own `ok` marker is treated as unreadable rather than rendered
          // as an empty team, which would claim "no team" about a route that failed.
          if (payload === null || typeof payload !== "object" || payload.ok !== true) return { value: null, error: { status: response.status, body: payload } }
          return { value: payload }
        } catch (error) {
          return { value: null, error }
        }
      }
      /** Read every route, never rejecting. One pass, so the halves cannot disagree. */
      const read = async (sessionId: string): Promise<TeamStore> => {
        // ALL THREE ROUTES IN ONE PASS. They are three halves of one answer — the team as it exists
        // after an approval, the plan that awaits one, and the frozen contracts the pinned detail body
        // quotes — and a panel that polled them separately could show a staged plan beside a team that
        // approval had already replaced.
        const [state, plan, contracts] = await Promise.all([
          readOne<TeamState>(statePath, sessionId),
          planPath === undefined ? Promise.resolve({ value: null as TeamPlan | null }) : readOne<TeamPlan>(planPath, sessionId),
          taskPath === undefined ? Promise.resolve({ value: null as TeamTaskContracts | null }) : readOne<TeamTaskContracts>(taskPath, sessionId),
        ])
        /** The frozen contracts, keyed by task id, so the detail body is a lookup and not a scan. */
        const byTask: Record<string, { description: string; claimedBy: string; claimedAt: string; attempt: number }> = {}
        for (const contract of contracts.value?.contracts ?? []) {
          byTask[contract.taskId] = { description: contract.description, claimedBy: contract.claimedBy, claimedAt: contract.claimedAt, attempt: contract.attempt }
        }
        return {
          state: state.value,
          plan: plan.value === null ? null : plan.value.plan === null ? null : plan.value,
          contracts: byTask,
          error: state.error,
        }
      }

      /**
       * The change-stream constructor this host exposes, or undefined when it has none.
       *
       * GUARDED, never assumed: the offline harness, a non-browser host and a browser with the API
       * unavailable all answer undefined here, and the interval below is then the whole story. The
       * GLOBAL READ is guarded too, because a host that defines `EventSource` as a throwing getter
       * must cost the push and nothing else.
       * @returns a constructor usable with `new`, or undefined when none is reachable.
       */
      const streamCtor = (): ChangeStreamCtor | undefined => {
        try {
          /** The global scope as an untyped bag, so this factory needs no DOM lib to compile. */
          const scope = globalThis as unknown as { EventSource?: unknown }
          /** Whatever the host exposes under that name. */
          const candidate = scope.EventSource
          return typeof candidate === "function" ? candidate as ChangeStreamCtor : undefined
        } catch {
          return undefined
        }
      }

      /**
       * Open one session's change stream, or answer undefined when this host has none.
       *
       * The URL is the route `web-client.ts` threads in PLUS THE SAME `?sessionId=` the state read
       * uses, so the stream can only ever follow the session the panel is showing. An absent
       * `eventsPath` means the composition has no events route at all: the poll stays the story.
       * @param sessionId - the session the panel addresses; "" asks for the workspace principal.
       * @returns the open stream, or undefined when there is none to open.
       */
      const openChangeStream = (sessionId: string): ChangeStream | undefined => {
        if (eventsPath === undefined) return undefined
        /** The constructor this host exposes, if any. */
        const ctor = streamCtor()
        if (ctor === undefined) return undefined
        try {
          return new ctor(eventsPath + queryOf(sessionId))
        } catch {
          // A host that refuses the URL (a relative-only shim, a policy block) loses the PUSH and
          // keeps the poll: the panel is never a crash away from rendering.
          return undefined
        }
      }

      /**
       * Subscribe one session's change stream to the EXISTING poll path.
       *
       * ONE READ PATH, which is the point: the frame handler calls the same `tick` the interval
       * calls, so a pushed and a polled frame cannot be built by two code paths that disagree. The
       * subscription lives exactly as long as the caller's effect — the disposer returned here
       * closes the stream, so an unmounted panel leaves no connection open, and a session change
       * closes the old stream before the new effect opens the next one.
       * @param sessionId - the session whose changes are followed.
       * @param onFrame - what each `data:` frame runs; the poller passes its own `tick`.
       * @returns the disposer the effect owns; it always closes the stream it opened.
       */
      const subscribeChanges = (sessionId: string, onFrame: () => void): (() => void) => {
        /** The stream for this session, or undefined when the push is unavailable here. */
        const stream = openChangeStream(sessionId)
        if (stream === undefined) return () => {}
        stream.onmessage = onFrame
        return () => {
          try {
            stream.close()
          } catch {
            // A close that throws must not break the unmount: the connection is the browser's to
            // reclaim, and the panel's teardown is not allowed to fail because of it.
          }
        }
      }

      /**
       * Start refreshing this panel: one immediate read, then the interval, then the change stream.
       *
       * THE INTERVAL IS THE FALLBACK AND IS UNCHANGED: a host without `EventSource`, a proxy that
       * cuts the stream or a composition whose `eventsPath` is absent behaves exactly as it did
       * before this feed existed. The push is an ADDITION — one extra read per frame, through the
       * same `tick`, and the browser owns the reconnect (no loop of ours to leak).
       * @param sessionId - the session to read; the stream follows the same one.
       * @param publish - where each read lands; the effect hands the panel's own state setter.
       * @returns the stop function the caller's effect owns; it clears the interval and the stream.
       */
      const start = (sessionId: string, publish: (next: TeamStore) => void): (() => void) => {
        /** Whether the caller still wants results; cleared by the returned stop function. */
        let live = true
        /** One poll: read, then publish only when still live. */
        const tick = async (): Promise<void> => {
          /** This poll's outcome, published only if the panel is still mounted. */
          const next = await read(sessionId)
          // A poll that lands after the panel unmounted must not publish: React would warn, and the
          // next mount would render a stale team for one frame.
          if (live) publish(next)
        }
        void tick()
        /** The interval the caller's effect stops; owned here, cleared on stop. */
        const timer = setInterval(() => { void tick() }, pollMs)
        /** The change subscription, if this host has a stream; disposed with the interval. */
        const stopStream = subscribeChanges(sessionId, () => { void tick() })
        return () => { live = false; clearInterval(timer); stopStream() }
      }

      /**
       * Resolve one key through the host's translator, or answer the English literal when there is no
       * translator or the translator has no entry (the host answers the KEY itself on a miss, which is
       * never what a reader should see, so a key that comes back unchanged falls back too).
       * @param key - the dictionary key.
       * @returns the string this render draws.
       */
      const t = (key: string): string => {
        if (typeof hostT !== "function") return EN[key] ?? key
        try {
          /** What the host answered for this key. */
          const answer = hostT(key)
          if (typeof answer === "string" && answer !== "" && answer !== key) return answer
        } catch {
          // A translator that throws is a broken locale, never a broken panel: the literal below is the
          // same fallback an absent translator gets.
        }
        return EN[key] ?? key
      }
      /** Resolve a key whose English carries one `{n}` placeholder. */
      const tn = (key: string, n: number): string => t(key).replace("{n}", String(n))
      /** Truncate one label for a fixed-width box (the CSS ellipsizes anything this misses). */
      const short = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max - 1) + "…")
      /** The last path segment of a workspace path, which is what the header names. */
      const baseName = (path: string): string => {
        /** The path's segments, with its trailing separators removed first. */
        const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/)
        return parts[parts.length - 1] === "" ? path : parts[parts.length - 1]
      }
      /** The status tone of one rendered state, falling back to the neutral label colour. */
      const toneOf = (visual: string): string => TONE[visual] ?? TONE.open
      /**
       * The glyph of one rendered state; `?` is honest about a state this view has never seen.
       *
       * A plan-only GHOST draws in the EXISTING open glyph: a plan edit must not invent a visual
       * vocabulary, so it borrows the one the drawing already carries.
       */
      const glyphOf = (visual: string): string => GLYPH[visual] ?? (visual === "planned" ? GLYPH.open : "?")
      /** The bilingual kind abbreviation of one task; empty when the task carries no kind. */
      const kindOf = (kind: string | undefined): string => {
        if (kind === undefined || kind === "") return ""
        /** The dictionary key this kind resolves through, when it is one of the five. */
        const key = KIND_KEY[kind]
        return key === undefined ? kind : t(key)
      }
      /**
       * The ASCII kind abbreviation the DRAWING prints (clause F1) — never the localized kind.
       *
       * WHY THIS EXISTS BESIDE `kindOf`. `kindOf` is the CHROME's word and is meant to be translated:
       * under a zh-CN locale the task detail body prints 评审, and that is correct there. A node legend
       * line is a DRAWING, and a drawing must stay locale-free (clauses C1/F1), so its `<KIND>` is the
       * ASCII `REQ | WRK | REV | FIX | INT`. Both functions read the ONE `KIND_KEY` table, so a new kind
       * is added in one place, but only this one is guaranteed ASCII: it never calls `t()`, which is what
       * the reported defect did and how 需求 reached the picture.
       * @param kind - the task's `kind` exactly as the route served it.
       * @returns the abbreviation, or the empty string for no kind — and also for a kind outside the
       * five the contract declares, because an unknown value is not drawn verbatim into a CJK-free plane.
       */
      const kindCodeOf = (kind: string | undefined): string => {
        if (kind === undefined || kind === "") return ""
        /** The dictionary key this kind resolves through, when it is one of the five. */
        const key = KIND_KEY[kind]
        return key === undefined ? "" : EN[key]
      }
      /** Resolve a rendered state through the translator, so the hover card never prints a raw enum. */
      const visualLabelOf = (visual: string): string => t(VISUAL_KEY[visual] ?? "visual.open")
      /**
       * Format a duration the way the hover card shows it: seconds, minutes+seconds, or hours+minutes.
       * @param milliseconds - the elapsed span; negative values are clamped to zero.
       * @returns `Xs`, `Xm Ys`, or `Xh Ym`.
       */
      const formatDuration = (milliseconds: number): string => {
        /** Whole seconds, never negative, so a clock skew cannot print a negative span. */
        const total = Math.max(0, Math.floor(milliseconds / 1000))
        if (total < 60) return total + "s"
        /** Whole minutes, with the remaining seconds for the sub-hour form. */
        const minutes = Math.floor(total / 60)
        if (minutes < 60) return minutes + "m " + (total % 60) + "s"
        return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m"
      }
      /**
       * The elapsed time of one task, in the card's own vocabulary.
       *
       * A RUNNING task measures `startedAt` -> `now` (the ticker's clock); a finished one measures
       * `startedAt` -> `finishedAt`. A dash is the honest answer when either needed stamp is absent
       * or malformed: `updatedAt` is not a finish stamp, and inventing a span from it would lie.
       * @param task - the task whose stamps are read; only the three fields the card needs are typed.
       * @param nowMs - the ticker's epoch milliseconds, defaulted for the direct test call.
       * @returns the formatted span, or `-` when the record cannot answer.
       */
      const formatElapsed = (task: { startedAt?: string; finishedAt?: string; visual: string }, nowMs: number = Date.now()): string => {
        if (typeof task.startedAt !== "string" || task.startedAt === "") return "-"
        /** The parsed start instant, or NaN when the record carries a malformed stamp. */
        const start = Date.parse(task.startedAt)
        if (!Number.isFinite(start)) return "-"
        if (task.visual === "running") {
          /** A running task ends at a stamped finish when one somehow exists, otherwise at `now`. */
          const runningEnd = typeof task.finishedAt === "string" && task.finishedAt !== "" ? Date.parse(task.finishedAt) : NaN
          return formatDuration((Number.isFinite(runningEnd) ? runningEnd : nowMs) - start)
        }
        if (typeof task.finishedAt !== "string" || task.finishedAt === "") return "-"
        /** The parsed finish instant, or NaN when the record carries a malformed stamp. */
        const finish = Date.parse(task.finishedAt)
        return Number.isFinite(finish) ? formatDuration(finish - start) : "-"
      }
      /**
       * The clamped coarse progress of one task, 0-100.
       * @param task - the task, whose served `progress` wins when it is a finite number.
       * @returns the integer percent, rounded and clamped; an absent field degrades to the coarse
       *   lifecycle mapping (completed 100, running 50, anything else 0) the route documents.
       */
      const progressOf = (task: TeamTask): number => {
        /** The served number, when the payload carried one. */
        const servedValue = typeof task.progress === "number" && Number.isFinite(task.progress) ? task.progress : undefined
        /** The older-server degrade, which mirrors the route's own coarse mapping. */
        const fallback = task.visual === "completed" ? 100 : task.visual === "running" ? 50 : 0
        return Math.max(0, Math.min(100, Math.round(servedValue ?? fallback)))
      }
      /**
       * The viewport anchor of the hover card: the event's own `clientX/clientY` plus the 14px offset.
       *
       * ALL DOM ACCESS IS GUARDED. The offline harness and a non-browser host have no `window`, and
       * the card then keeps the raw point; a browser clamps it so the fixed card cannot run off the
       * viewport. No measurement API is used, which is the prohibition that outlived the SVG amendment.
       * @param event - the React mouse/focus event, typed leniently because a synthetic host may pass
       *   nothing at all (the existing hover arms drive `onMouseEnter()` with no argument).
       * @returns the clamped `{ x, y }` viewport point.
       */
      const tipPoint = (event: unknown): { x: number; y: number } => {
        /** The event bag, narrowed leniently for exactly the two coordinates this card reads. */
        const source = (event ?? {}) as { clientX?: unknown; clientY?: unknown }
        /** The raw pointer x, 0 when the event carries none (a keyboard focus). */
        const rawX = typeof source.clientX === "number" && Number.isFinite(source.clientX) ? source.clientX : 0
        /** The raw pointer y, 0 when the event carries none (a keyboard focus). */
        const rawY = typeof source.clientY === "number" && Number.isFinite(source.clientY) ? source.clientY : 0
        /** The offset x, which is what an unclamped viewport would show. */
        let x = rawX + TIP_OFFSET
        /** The offset y, which is what an unclamped viewport would show. */
        let y = rawY + TIP_OFFSET
        try {
          if (typeof window !== "undefined") {
            /** The viewport width; unusable values are ignored rather than clamped against. */
            const width = window.innerWidth
            /** The viewport height; unusable values are ignored rather than clamped against. */
            const height = window.innerHeight
            if (Number.isFinite(width) && width > 0) x = Math.min(x, Math.max(TIP_OFFSET, width - TIP_WIDTH - TIP_OFFSET))
            if (Number.isFinite(height) && height > 0) y = Math.min(y, Math.max(TIP_OFFSET, height - TIP_HEIGHT - TIP_OFFSET))
          }
        } catch {
          // A host whose `window` getter throws keeps the unclamped point; the card still renders.
        }
        return { x: Math.max(0, x), y: Math.max(0, y) }
      }
      /**
       * Place the hover card OUTSIDE `[data-mpd-graph]`: into `document.body` when the host's React
       * copy exposes `createPortal` and a body exists, otherwise inline at the panel root.
       *
       * The inline fallback is still a SIBLING of the graph, never a descendant, which is what keeps
       * the raw subject in the card legal while the drawing itself stays CJK-free.
       * @param element - the card element to place.
       * @returns the portal when one was created, or the element itself.
       */
      const portalOf = (element: unknown): unknown => {
        /** The host's optional portal primitive. */
        const portal = react.createPortal
        if (typeof portal !== "function") return element
        try {
          /** The document body, or undefined outside a browser. */
          const body = typeof document === "undefined" ? undefined : document.body
          return body === undefined || body === null ? element : portal(element, body)
        } catch {
          return element
        }
      }
      /**
       * The hover card itself: localized status, owner, elapsed time, a truncated subject and a
       * coarse progress bar with its numeric percent.
       *
       * The card is `position: fixed` and `pointer-events: none`, so it follows the pointer without
       * stealing the hover that keeps it open. Its own material (semi-transparent vs opaque when the
       * task is pinned) lives in `DAG_CSS`; this function only publishes the anchor and the content.
       * @param task - the hovered task, looked up in the DRAWN tasks so a ghost works too.
       * @param at - the clamped viewport anchor from {@link tipPoint}.
       * @param isPinned - whether this task is the pinned one, which makes the card opaque.
       * @param nowMs - the ticker's clock, which keeps the elapsed row honest.
       * @returns the card element, portal-wrapped when the host supports it.
       */
      const tipCardOf = (task: TeamTask, at: { x: number; y: number }, isPinned: boolean, nowMs: number): unknown => {
        /** The clamped coarse completion this card prints and draws. */
        const percent = progressOf(task)
        /** The elapsed text; a dash means the record cannot answer. */
        const elapsed = formatElapsed(task, nowMs)
        /**
         * One label/value row of the card.
         * @param key - the row's React key.
         * @param label - the already-localized label.
         * @param value - the value text, which may be payload data.
         * @param title - the hover title, when the row has more to say (e.g. "not started").
         * @returns the row element.
         */
        const row = (key: string, label: string, value: string, title?: string): unknown => react.createElement("div", { key, className: "mpd-dag-tip-row", ...(title === undefined ? {} : { title }) },
          react.createElement("span", { key: "label", className: "mpd-dag-tip-label" }, label),
          react.createElement("span", { key: "value" }, value))
        /** The card: fixed anchor, fixed width, and the pinned flag the stylesheet reads. */
        const card = react.createElement("div", {
          key: "tip-card",
          "data-mpd-tip-card": "1",
          "data-pinned": isPinned ? "true" : "false",
          className: "mpd-dag-tip",
          style: { left: at.x + "px", top: at.y + "px", width: TIP_WIDTH + "px" },
        },
          row("tip-status", t("tip.status"), visualLabelOf(task.visual)),
          row("tip-owner", t("tip.owner"), task.owner === undefined || task.owner === "" ? t("tip.unassigned") : task.owner),
          row("tip-elapsed", t("tip.elapsed"), elapsed, elapsed === "-" ? t("tip.notStarted") : undefined),
          react.createElement("div", { key: "tip-subject-row", className: "mpd-dag-tip-row" },
            react.createElement("span", { key: "tip-subject-label", className: "mpd-dag-tip-label" }, t("tip.task")),
            react.createElement("span", { key: "tip-subject", className: "mpd-dag-tip-subject", title: task.subject }, short(task.subject, TIP_SUBJECT_MAX))),
          react.createElement("div", { key: "tip-progress", className: "mpd-dag-tip-row" }, t("tip.progress") + " " + percent + "%"),
          react.createElement("div", { key: "tip-bar", className: "mpd-dag-tip-bar" },
            react.createElement("div", { key: "tip-fill", className: "mpd-dag-tip-fill", style: { width: percent + "%" } })))
        return portalOf(card)
      }
      /** The style of one member's status dot: a CSS circle, never a raster avatar or a mascot. */
      const memberDot = (status: string): Record<string, string> => ({
        width: "7px",
        height: "7px",
        borderRadius: "999px",
        background: status === "running" ? TONE.running : status === "idle" ? TONE.open : toneOf(status),
        flex: "0 0 auto",
      })
      /** One label/value row of the task detail body. */
      const detailRow = (key: string, labelKey: string, value: string): unknown => react.createElement("div", { key, style: { ...CSS.row, ...CSS.meta } },
        react.createElement("span", { style: { minWidth: "72px", color: FOCUS_EDGE } }, t(labelKey)),
        react.createElement("span", { style: { flex: "1 1 auto", wordBreak: "break-word" } }, value))

      /**
       * The STAGED PLAN, drawn from the shared projection.
       *
       * Every string here comes from the payload — including the approval phrase, which is SERVED
       * rather than re-derived, so the Web panel and the TUI scene demand the same thing.
       * @param plan - the staged plan half of the payload.
       * @returns the section element.
       */
      const planSection = (plan: NonNullable<TeamPlan["plan"]>): unknown => {
        /** The plan's rows, in render order. */
        const rows: unknown[] = [
          react.createElement("div", { key: "p-head", style: CSS.head }, plan.name),
          react.createElement("div", { key: "p-sub", style: CSS.dim }, plan.planId + " · " + plan.approval),
          react.createElement("div", { key: "p-desc", style: { marginTop: "4px" } }, plan.description),
          react.createElement("div", { key: "p-members-head", style: CSS.subHead }, tn("plan.members", plan.members.length)),
        ]
        for (const member of plan.members) {
          rows.push(react.createElement("div", { key: "pm-" + member.name, style: CSS.row },
            react.createElement("span", { style: { flex: "1 1 auto" } }, member.name),
            react.createElement("span", { style: CSS.dim }, member.role ?? "")))
        }
        rows.push(react.createElement("div", { key: "p-tasks-head", style: CSS.subHead }, tn("plan.tasks", plan.tasks.length)))
        for (const task of plan.tasks) {
          rows.push(react.createElement("div", {
            key: "pt-" + task.subject,
            style: { ...CSS.card, borderColor: undefined },
            title: task.description,
          },
          task.subject + (task.owner === undefined ? "" : " @" + task.owner),
          task.blockedBy.length === 0 ? null : react.createElement("div", { style: CSS.meta }, "⇠ " + task.blockedBy.join(", "))))
        }
        // THE GATE, stated where the plan is read. The phrase is the PRE-approval identity, so it is
        // knowable the whole time the plan is staged — which a teamId would not be.
        rows.push(react.createElement("div", { key: "p-gate", style: CSS.subHead }, t("plan.gate")))
        rows.push(react.createElement("div", { key: "p-phrase", style: { ...CSS.card, marginTop: "2px", fontWeight: 700 } }, plan.phrase))
        return react.createElement("div", { style: CSS.panel }, rows)
      }

      /**
       * The GRAPH-SAFE label of one task: the printable-ASCII content of its subject, or its ordinal.
       *
       * THE RULE IS EXACT (clause C4): take the maximal runs of printable ASCII (`\x20`-`\x7E`), join
       * the runs with a single space, collapse whitespace, trim. A subject that leaves nothing — pure
       * CJK, punctuation, an empty string — draws `#<ordinal>` instead, so the node still carries a
       * number a reader can match against the board's own order rather than an empty line.
       *
       * WHY THE DRAWING AND NOT THE DATA: CJK is unreadable at these widths (the user's own report),
       * while the pinned detail body and the hover `title` keep the ORIGINAL subject — that is where
       * the Chinese belongs (clause C3). ONE composer, named the same on both surfaces, called by every
       * drawing site: a renderer that composed a label of its own from `subject` is exactly how the two
       * would come to disagree (clause C2).
       * @param subject - the subject exactly as the route served it.
       * @param ordinal - the task's 1-based position in the board order the surface was handed.
       * @returns the label to DRAW, never empty.
       */
      const graphSafeLabel = (subject: string, ordinal: number): string => {
        /** The subject as text, so a payload that served no string draws the ordinal instead of crashing. */
        const text = typeof subject === "string" ? subject : ""
        /** Every maximal run of printable ASCII in the subject, in order. */
        const runs = text.match(/[\x20-\x7E]+/g) ?? []
        /** Those runs joined, their whitespace collapsed and trimmed — the rule's whole arithmetic. */
        const label = runs.join(" ").replace(/\s+/g, " ").trim()
        return label === "" ? "#" + ordinal : label
      }

      /**
       * The painted form of one routed edge: an SVG path over the route's own vertices, plus its sample.
       *
       * THE GRAMMAR (clause W6). `M` starts on the blocker's border. Every INTERIOR vertex gets both its
       * legs shortened by `r = min(EDGE_RADIUS, legIn / 2, legOut / 2)` and the join is closed by a `Q`
       * through the corner itself — the exact circular-arc approximation at a right angle, with none of
       * an `A` command's sweep-flag bookkeeping across mixed directions. The corner that opens the FINAL
       * APPROACH is the one place a cubic earns its keep: from the same shortened entry point,
       * `C entry exit W` lands on the arrival border with a HORIZONTAL tangent, so the arrowhead points
       * into the box instead of arriving at an angle (the user's 入盒前一段曲线).
       *
       * `radius = 0` takes the `L` branch at every vertex, so `d` is a pure `M`/`L` orthogonal polyline
       * and `points` EQUALS the waypoint list — a byte-comparable control rather than a visual claim.
       * @param waypoints - the route's vertices, in travel order, every leg axis-aligned.
       * @param radius - the corner radius in pixels; `0` (or less) emits the straight polyline.
       * @returns the path's `d` and the flattened polyline of exactly that path.
       */
      const curveOf = (waypoints: CurvePoint[], radius: number): { d: string; points: CurvePoint[] } => {
        /** The path commands, in emission order. */
        const commands: string[] = []
        /** The flattened polyline: every vertex the pen reaches, plus the samples each arc appends. */
        const points: CurvePoint[] = []
        /**
         * One coordinate as the path writes it: absolute, two decimals, never `-0`, never an exponent.
         *
         * The formatting is FROZEN because an arm compares `data-mpd-curve` to `curve.d` by exact string
         * equality — leaving float printing to the renderer is how that comparison starts failing for
         * reasons that have nothing to do with the geometry.
         */
        const at = (value: number): string => {
          /** The value at the declared precision, with its negative zero normalised away. */
          const rounded = Math.round(value * 100) / 100
          return String(rounded === 0 ? 0 : rounded)
        }
        /** Append one vertex or sample to the polyline, as a copy. */
        const push = (point: CurvePoint): void => { points.push({ x: point.x, y: point.y }) }
        /** Lift the pen to a vertex without drawing it: the path's `M`. */
        const moveTo = (point: CurvePoint): void => {
          commands.push("M " + at(point.x) + " " + at(point.y))
          push(point)
        }
        /**
         * Draw a straight leg: its `L`, and the leg's own endpoint as the polyline's next vertex.
         *
         * NOTHING is sampled along it, on purpose. W3's instrument measures SEGMENTS between consecutive
         * samples, which is exact for a straight leg and needs no density assumption, while sampling
         * would break the radius-0 control's promise that `points` is the waypoint list itself.
         */
        const lineTo = (point: CurvePoint): void => {
          commands.push("L " + at(point.x) + " " + at(point.y))
          push(point)
        }
        /** Draw one corner's quadratic fillet: the `Q` through the corner, plus the arc's own samples. */
        const quadTo = (control: CurvePoint, point: CurvePoint): void => {
          /** The vertex the fillet starts from. */
          const from = points[points.length - 1]
          /** The control polygon's length, an upper bound of the arc, which sets the sample count. */
          const span = Math.abs(control.x - from.x) + Math.abs(control.y - from.y) + Math.abs(point.x - control.x) + Math.abs(point.y - control.y)
          /** How many samples the arc is cut into — a step of a pixel or less, whatever the leg's length. */
          const steps = Math.max(2, Math.ceil(span))
          for (let step = 1; step <= steps; step += 1) {
            /** The curve parameter at this sample. */
            const t = step / steps
            /** Its complement, so each weight costs one subtraction. */
            const s = 1 - t
            push({ x: s * s * from.x + 2 * s * t * control.x + t * t * point.x, y: s * s * from.y + 2 * s * t * control.y + t * t * point.y })
          }
          commands.push("Q " + at(control.x) + " " + at(control.y) + " " + at(point.x) + " " + at(point.y))
        }
        /** Draw the closing cubic sweep into the arrival border, with its own samples. */
        const cubicTo = (first: CurvePoint, second: CurvePoint, point: CurvePoint): void => {
          /** The vertex the sweep starts from. */
          const from = points[points.length - 1]
          /** The control polygon's length, an upper bound of the arc, which sets the sample count. */
          const span = Math.abs(first.x - from.x) + Math.abs(first.y - from.y) + Math.abs(second.x - first.x) + Math.abs(second.y - first.y) + Math.abs(point.x - second.x) + Math.abs(point.y - second.y)
          /** How many samples the arc is cut into. */
          const steps = Math.max(2, Math.ceil(span))
          for (let step = 1; step <= steps; step += 1) {
            /** The curve parameter at this sample. */
            const t = step / steps
            /** Its complement. */
            const s = 1 - t
            push({
              x: s * s * s * from.x + 3 * s * s * t * first.x + 3 * s * t * t * second.x + t * t * t * point.x,
              y: s * s * s * from.y + 3 * s * s * t * first.y + 3 * s * t * t * second.y + t * t * t * point.y,
            })
          }
          commands.push("C " + at(first.x) + " " + at(first.y) + " " + at(second.x) + " " + at(second.y) + " " + at(point.x) + " " + at(point.y))
        }
        /** The vertex the path leaves from: the blocker's own border. */
        const start = waypoints[0]
        moveTo(start)
        // EVERY VERTEX BUT THE FIRST AND LAST IS A CORNER. The last one opens the FINAL APPROACH and is
        // the only one that sweeps; the others are filleted, which is what turns the right angles the
        // route was computed from into the rounded elbows the user asked for.
        for (let index = 1; index < waypoints.length - 1; index += 1) {
          /** The vertex the leg into this corner came from. */
          const previous = waypoints[index - 1]
          /** The corner itself. */
          const corner = waypoints[index]
          /** The vertex the leg out of this corner runs to. */
          const next = waypoints[index + 1]
          /** The incoming leg's length — Manhattan, because every leg here is axis-aligned. */
          const legIn = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y)
          /** The outgoing leg's length, measured the same way. */
          const legOut = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y)
          /** The fillet actually drawn: the declared radius, clamped to half of the shorter leg. */
          const fillet = Math.max(0, Math.min(radius, legIn / 2, legOut / 2))
          /** Whether this corner is the one the closing sweep opens from. */
          const sweeping = index === waypoints.length - 2
          // THE `L` BRANCH: a zero radius, a leg too short to carry one, or — for the sweep alone — a
          // lane narrower than `EDGE_SWEEP_MIN`, where a curve's controls would leave the corridor.
          if (fillet <= 0 || (sweeping && (legIn < EDGE_SWEEP_MIN || legOut < EDGE_SWEEP_MIN))) { lineTo(corner); continue }
          /** The incoming leg's direction, as a unit vector. */
          const intoX = (corner.x - previous.x) / legIn
          /** That same direction's y. */
          const intoY = (corner.y - previous.y) / legIn
          /** The outgoing leg's direction, which the join's second control point follows. */
          const outX = (next.x - corner.x) / legOut
          /** That same direction's y. */
          const outY = (next.y - corner.y) / legOut
          /** The vertex the join begins at: the corner pulled back along the incoming leg. */
          const entry: CurvePoint = { x: corner.x - intoX * fillet, y: corner.y - intoY * fillet }
          /** The vertex it ends at: the corner pushed on along the outgoing leg. */
          const exit: CurvePoint = { x: corner.x + outX * fillet, y: corner.y + outY * fillet }
          lineTo(entry)
          if (sweeping) {
            // THE FINAL APPROACH. Both controls stand on the route's own legs — the entry on the riser,
            // the exit on the lead-in — so the curve leaves downward and lands horizontally: the
            // arrowhead points INTO the border rather than arriving at an angle.
            cubicTo(entry, exit, next)
          } else {
            quadTo(corner, exit)
          }
        }
        /** The route's last vertex: the border the dependency arrives at. */
        const end = waypoints[waypoints.length - 1]
        /** Where the polyline currently ends, which the sweep may already have carried to `end`. */
        const tail = points[points.length - 1]
        if (tail !== undefined && (tail.x !== end.x || tail.y !== end.y)) lineTo(end)
        return { d: commands.join(" "), points }
      }

      /**
       * Compute the whole DAG geometry from the board alone: rank columns, centred node boxes, and
       * every drawn edge ROUTED in the gutters, with the rank-skipping ones crossing a top/bottom band.
       *
       * THE RANKS ARE SERVED, NEVER RE-DERIVED HERE. The host computes them ONCE with the shared core
       * (`mpd-graph-core`) and publishes each task's rank beside the board; this function decides only
       * WHICH COLUMN a node lands in, never which rank it has. A task with no served rank — a payload
       * from an older server — draws from its served `depth`, the documented degrade; a negative or
       * non-finite value is rank 0 rather than a dropped task. Every box is fixed, which is what lets
       * an edge be arithmetic instead of a measurement.
       *
       * WHAT WAS WRONG (reported from a screenshot 2026-10-06: "依赖关系连线，根本看不清"):
       *   * a multi-rank edge took the space between its two END boxes and called it "the band the
       *     riser lives in" — but for an edge that skips a rank that band is the WHOLE INTERMEDIATE
       *     COLUMN, so the vertical run went straight down through the boxes standing in it, and the
       *     horizontal run did the same across the parent's row;
       *   * the lanes were `0, +3, -3, +6, -6` inside an 8px gutter, and the riser was CLAMPED into
       *     that band, so three edges leaving one column collapsed onto one or two pixels and read as
       *     a single thick bus;
       *   * the edge layer was the grid's LAST child, so even a correct line would have painted over
       *     the boxes rather than behind them.
       *
       * THE FIX, all of it standard layered-graph practice:
       *   1. BARYCENTER SWEEPS. Each column is ordered by the mean row of its neighbours (parents
       *      first, then children), stable on ties, so fewer edges cross — and R19's numeric order
       *      survives wherever no edge argues for a move.
       *   2. A CENTRED, SYMMETRIC BOARD. Every column's stack is centred on the graph's `centerY`, and
       *      the canvas is padded identically above and below, so a 1-node column in a 5-row graph
       *      stands on the midline instead of hugging the top.
       *   3. PORTS ON A COLUMN CHANNEL. A node with several incident edges spreads them over distinct
       *      ys inside its own height, ordered by the counterpart's y; one edge keeps the border
       *      middle. Every port also carries its column's PARITY CHANNEL (even ranks on odd pixels,
       *      odd ranks on even ones), so the two sides of any gutter can never produce the same attachment
       *      y — which is what makes "no two horizontal runs are collinear" a proof rather than a hope.
       *   4. A CROSSING BAND. An edge spanning more than one rank never passes through a column: it
       *      rises in the gutter beside its blocker, crosses the intermediate columns on its OWN row
       *      above or below every box (half the edges above, half below, mirrored by midpoint y), then
       *      descends beside its dependant. No route can enter a box.
       *   5. A MEASURED GUTTER. The box inset is derived from the busiest gutter's lane count, so the
       *      gutter is wide enough for every lane; the spacing is then computed FROM that gutter, and
       *      lanes are allocated in y order with mirrored offsets. A lane that cannot be given its own
       *      column is COUNTED in `laneOverflow` rather than silently stacked.
       *   6. THE ROUTES TRAVEL OUT OF THIS FUNCTION, so the render paints them and a test can assert
       *      them: the geometry is one object, and `data-mpd-box`/`data-mpd-route` publish it. The
       *      `overlaps` audit reports every collinear pair the router failed to separate.
       * @param tasks - the board, in the order the route served it.
       * @param radius - the corner radius the painted curves are built with, defaulting to
       *   {@link EDGE_RADIUS}; `0` is clause W6's control and emits the straight orthogonal polyline.
       * @param served - the host's model when the payload carried one; absent on an older server,
       *   which is the ONE signal that makes the `depth` degrade (and `ranksDerived: false`) coherent
       *   rather than looking like a model that lost its report.
       * @returns the columns, the canvas size, every node's box and every routed edge.
       */
      const layout = (tasks: TeamTask[], radius: number = EDGE_RADIUS, served?: ServedGraphModel): GraphGeometry => {
        /**
         * The board plus the model's plan-only GHOSTS — the tasks the drawing actually lays out.
         *
         * A node the plan declares and the board does not is DRAWN, never dropped: that is the user's
         * requirement ("改 task plan 就可以实时调整工程"), and a web that skipped it would show a plan
         * edit on the TUI only. A ghost is a normal box in the EXISTING `open` tone — no new glyph, no
         * new colour — carrying `visual: "planned"` and the rank the host derived for it.
         * @param board - the board, in the order the route served it.
         * @param model - the host's model, or undefined on an older server (which serves no ghosts).
         * @returns the board followed by one synthesized row per plan-only ghost, in model order.
         */
        const withGhosts = (board: TeamTask[], model: ServedGraphModel | undefined): TeamTask[] => {
          if (model === undefined || !Array.isArray(model.nodes)) return board
          /** The ids the board already carries, so a board node is never drawn twice. */
          const known = new Set(board.map((task) => task.id))
          /** One row per node only the plan carries. */
          const ghosts: TeamTask[] = []
          for (const node of model.nodes) {
            if (known.has(node.id) || node.planned !== true) continue
            ghosts.push({
              id: node.id,
              subject: node.title ?? node.subject ?? node.id,
              ...(node.kind === undefined ? {} : { kind: node.kind }),
              status: "planned",
              visual: "planned",
              ...(node.assignee === undefined ? {} : { owner: node.assignee }),
              blockedBy: Array.isArray(node.dependencies) ? [...node.dependencies] : [],
              failedBy: [],
              depth: node.depth,
              rank: node.depth,
              planned: true,
            })
          }
          return [...board, ...ghosts]
        }
        /** The board plus every plan-only ghost: what the columns and boxes are computed from. */
        const drawing = withGhosts(tasks, served)
        // ── R20, AMENDED: THE RANK IS SERVED BY THE HOST, NOT DERIVED HERE ────────────────────────
        // THE DEFECT, TWICE OVER. This function first bucketed the columns by `task.depth` verbatim —
        // the wrong number, because `team-store.ts` FILTERED unresolvable references out and left every
        // depth 0, so the live board drew ONE column with NO edges. It was then "fixed" by duplicating
        // the TUI's rank walk INLINE, which agreed with the sibling only until one copy moved: two
        // implementations of one derivation, in two planes, neither shared. The duplicate is what
        // Amendment 3 of `.mpd/plans/living-graph.md` deletes. The host (`mpd-team-core-plugin`) now
        // derives the rank ONCE with the shared core and serves it as `task.rank`, mapped from the
        // core's `GraphNode.depth` (a historical name; in the core's `GraphTask` it IS the rank). This
        // plane reads it. Nothing below walks `blockedBy`, and an unresolved reference arrives in the
        // core's report rather than being recomputed.
        /** The rank a served `depth` claims; the OLDER-SERVER degrade, and a negative/non-finite depth is a root. */
        const servedDepthRank = (task: TeamTask): number => (Number.isFinite(task.depth) && task.depth > 0 ? Math.floor(task.depth) : 0)
        /** The rank this task draws in: the SERVED one when present, else the documented `depth` degrade. */
        const rankOfTask = (task: TeamTask): number => (typeof task.rank === "number" && Number.isFinite(task.rank) ? Math.max(0, Math.floor(task.rank)) : servedDepthRank(task))
        // THE RECORD'S OWN REPORT IS READ BESIDE THE SERVED ONE (R18's reader side): the producer
        // stores what matched nothing when it accepted the task in `unresolvedBlockers`, a fact that
        // survives a later repair of the references — the live board was repaired that way — so a
        // viewer must see BOTH: what the record said then, and what the served references say now.
        /** The references the RECORD itself reports, task by task; empty when the payload carries none. */
        const recorded = new Set<string>()
        for (const task of tasks) {
          for (const reference of Array.isArray(task.unresolvedBlockers) ? task.unresolvedBlockers : []) recorded.add(reference)
        }
        /** The record's own report, sorted and de-duplicated. */
        const unresolvedRecorded = [...recorded].sort()
        /** The references the HOST reports as resolving to nothing; empty when no model arrived. */
        const servedUnresolved = served === undefined || served.report === undefined || !Array.isArray(served.report.unresolved) ? [] : served.report.unresolved
        /** The union of the host's report and the record's own, sorted and de-duplicated. */
        const unresolved = [...new Set([...unresolvedRecorded, ...servedUnresolved])].sort()
        // THE DEGRADE IS DECIDED BY THE PAYLOAD, NOT PER TASK: a payload with no model reads exactly as
        // the older server did — columns from `depth`, `ranksDerived: false` — instead of looking like
        // a model that lost its report. `served === undefined` is the ONE signal for that.
        /** Whether the SERVED model derived these ranks; `false` means the payload carried no model. */
        const ranksDerived = served !== undefined && served.report !== undefined && served.report.ranksDerived === true
        /** The board plus ghosts, bucketed by rank: the graph's column axis. */
        const columns: TeamTask[][] = []
        for (const task of drawing) {
          /** The rank this task draws in, served by the host — never a value this plane computed. */
          const at = rankOfTask(task)
          while (columns.length <= at) columns.push([])
          columns[at].push(task)
        }
        // R19 — WITHIN A COLUMN THE TASK ORDER IS NUMERIC, not the order the route happened to serve.
        // MEASURED before this comparator: a scrambled board drew `T10, T2, T1, T3, T20`, which is the
        // order a reader has to re-sort in their head; the TUI sibling derived the same rule from the
        // same reference model (`localeCompare(..., { numeric: true })`), and the two planes must agree
        // or the same board reads differently in the sidebar and the terminal.
        for (const column of columns) column.sort((left, right) => ID_ORDER.compare(left.id, right.id))
        /** The grid's width in columns: one per rank, never zero. */
        const rankCount = Math.max(columns.length, 1)
        /**
         * Each task's 1-based position in the board order this layout was handed.
         *
         * The ordinal clause C4's fallback label prints, taken HERE because this is the one place that
         * still holds the served order: `columns` is re-ordered by rank and id, so a node that read its
         * own position off the drawing would number the picture rather than the board.
         */
        const ordinalOf: Record<string, number> = {}
        for (let index = 0; index < tasks.length; index += 1) ordinalOf[tasks[index].id] = index + 1
        // A plan-only GHOST has no board position, so it numbers AFTER the board in the model's own node
        // order: a deterministic value, which is all clause C4's label fallback needs from it.
        /** The next ordinal a ghost may take, continuing the board's own numbering. */
        let nextOrdinal = tasks.length
        for (const task of drawing) {
          if (ordinalOf[task.id] !== undefined) continue
          nextOrdinal += 1
          ordinalOf[task.id] = nextOrdinal
        }
        // ── THE DEPENDENCY SET, AS IDS, BEFORE THE COLUMNS ARE ORDERED ────────────────────────────
        // The barycenter sweeps below need the edges, and they must run BEFORE the boxes are placed;
        // so the edge set is resolved to ids here, in the order the serving source gives it. The
        // model's edge set wins when one is served and the board's own `blockedBy` is the degrade —
        // the same rule the ranks follow.
        /** Every id the drawing contains, so an edge naming a box that is not there draws nothing. */
        const drawnIds = new Set(drawing.map((task) => task.id))
        /** Every dependency to route, as a parent id and a child id, in serving order. */
        const links: Array<{ parent: string; child: string }> = []
        if (served !== undefined && Array.isArray(served.edges)) {
          for (const edge of served.edges) {
            if (!drawnIds.has(edge.from) || !drawnIds.has(edge.to)) continue
            links.push({ parent: edge.from, child: edge.to })
          }
        } else {
          for (const column of columns) {
            for (const task of column) {
              // A RECORD MAY CARRY NO BLOCKER LIST AT ALL (a minimal fixture, an older payload), so
              // the list is read defensively rather than trusted to be an array.
              /** This task's blocker references, empty when the record carries none. */
              const blocked = Array.isArray(task.blockedBy) ? task.blockedBy : []
              for (const blockerId of blocked) if (drawnIds.has(blockerId)) links.push({ parent: blockerId, child: task.id })
            }
          }
        }
        /** The rank every id draws in, which is the bucket it landed in — never a second derivation. */
        const rankById = new Map<string, number>()
        columns.forEach((column, rank) => { for (const task of column) rankById.set(task.id, rank) })
        /** Where each id currently sits inside its column; the sweeps rewrite it as they re-order. */
        const rowById = new Map<string, number>()
        /** Read every row position off the CURRENT column order. */
        const reindex = (): void => {
          for (const column of columns) column.forEach((task, index) => rowById.set(task.id, index))
        }
        reindex()
        /**
         * Order ONE column by the barycenter of its neighbours in ONE adjacent rank.
         *
         * Stable on ties and on a node with no neighbour in that rank (its own row is the key), which is
         * what keeps R19's numeric within-column order intact wherever no edge argues for a move. Called
         * with `rank - 1` it orders by PARENTS, with `rank + 1` by CHILDREN.
         * @param rank - the column to re-order.
         * @param neighbourRank - the adjacent rank whose rows are averaged.
         * @returns nothing; `columns[rank]` is re-ordered in place and `rowById` re-read.
         */
        const barycenter = (rank: number, neighbourRank: number): void => {
          /** The mean row of one task's neighbours in `neighbourRank`, or its own row when it has none. */
          const weightOf = (task: TeamTask): number => {
            /** The sum of the neighbours' rows. */
            let total = 0
            /** How many neighbours contributed. */
            let count = 0
            for (const link of links) {
              // The counterpart this link joins to the task, from either end.
              /** The other end of this link, when it touches the task at all. */
              const counterpart = link.child === task.id ? link.parent : link.parent === task.id ? link.child : undefined
              if (counterpart === undefined || rankById.get(counterpart) !== neighbourRank) continue
              total += rowById.get(counterpart) ?? 0
              count += 1
            }
            return count === 0 ? (rowById.get(task.id) ?? 0) : total / count
          }
          /** One weight per task, read before the sort so the comparator sees a single snapshot. */
          const weight = new Map(columns[rank].map((task) => [task.id, weightOf(task)]))
          columns[rank] = [...columns[rank]].sort((left, right) => (weight.get(left.id) ?? 0) - (weight.get(right.id) ?? 0))
          columns[rank].forEach((task, index) => rowById.set(task.id, index))
        }
        // TWO ROUNDS, PARENTS THEN CHILDREN: the first pulls every column toward its blockers, the
        // second toward its dependants, and the second round lets the first's moves settle. The count
        // stays SMALL on purpose — a board is re-laid out on every poll, so an unbounded relaxation
        // would spend the reader's frame budget on a crossing count nobody asked to optimise.
        for (let round = 0; round < 2; round += 1) {
          for (let rank = 1; rank < columns.length; rank += 1) barycenter(rank, rank - 1)
          for (let rank = columns.length - 2; rank >= 0; rank -= 1) barycenter(rank, rank + 1)
        }
        // ── THE CROSSING BAND: HALF THE RANK-SKIPPING EDGES ABOVE, HALF BELOW ────────────────────
        /** The dependencies that skip at least one rank, which the crossing band must carry. */
        const longLinks = links.filter((link) => Math.abs((rankById.get(link.parent) ?? 0) - (rankById.get(link.child) ?? 0)) >= 2)
        /** How many long edges cross on the top band; the odd one out goes on top, mirroring by midpoint. */
        const topCount = Math.ceil(longLinks.length / 2)
        /** How many cross on the bottom band. */
        const bottomCount = longLinks.length - topCount
        /** The rows each band must hold; both bands are padded to the same count so the canvas is symmetric. */
        const bandRows = Math.max(topCount, bottomCount)
        /** How much vertical room ONE band takes, which is also how far the boxes move down for it. */
        const bandExtent = bandRows * BAND_STEP
        /** The tallest column's box count, which is what sets the box area's height. */
        let tallestBoxes = 0
        for (const column of columns) tallestBoxes = Math.max(tallestBoxes, column.length)
        /** The box area's height, never zero so an empty board still has one box's worth of canvas. */
        const boxAreaHeight = Math.max(tallestBoxes, 1) * GEO.nodeHeight + (Math.max(tallestBoxes, 1) - 1) * GEO.nodeGap
        /**
         * The y every column's stack is centred on, which is also the canvas's own horizontal midline.
         *
         * Derived, never written down: the box area is `boxAreaHeight` tall and sits below the top band,
         * so its centre is `pad + bandExtent + boxAreaHeight / 2`. At one row this is `pad + 21 = 25`,
         * which is exactly what keeps a single-node column's `top` at the frozen `4`.
         */
        const centerY = GEO.pad + bandExtent + boxAreaHeight / 2
        /**
         * The y a column's stack starts at, so that stack's own centre lands on {@link centerY}.
         * @param count - how many boxes the column holds.
         * @returns the `top` of that column's first box.
         */
        const stackTop = (count: number): number => centerY - (count * GEO.nodeHeight + (count - 1) * GEO.nodeGap) / 2
        /** Every node's box, its stack CENTRED on the graph's midline — `row` and `top` are now final. */
        const nodes: GraphNode[] = []
        for (let rank = 0; rank < columns.length; rank += 1) {
          for (let row = 0; row < columns[rank].length; row += 1) {
            nodes.push({
              task: columns[rank][row],
              rank,
              row,
              ordinal: ordinalOf[columns[rank][row].id] ?? 0,
              top: stackTop(columns[rank].length) + row * (GEO.nodeHeight + GEO.nodeGap),
            })
          }
        }
        /** The node each task id names, so an edge resolves both of its boxes in one lookup. */
        const nodeOf: Record<string, GraphNode> = {}
        for (const node of nodes) nodeOf[node.task.id] = node

        // ── THE DEPENDENCIES TO DRAW, NOW RESOLVED TO BOXES ───────────────────────────────────────
        // The ids above were already filtered to the drawing, so this is a lookup rather than a second
        // rule; the ORDER is the serving source's, which is what `data-mpd-edge` counts in.
        /** The dependencies to route, in the order the serving source gives them. */
        const wants: Array<{ parent: GraphNode; child: GraphNode; key: string }> = []
        for (const link of links) {
          /** The blocker's box; every drawn id has one, and the check is the defensive half. */
          const parent = nodeOf[link.parent]
          /** The blocked task's box. */
          const child = nodeOf[link.child]
          if (parent === undefined || child === undefined) continue
          wants.push({ parent, child, key: parent.task.id + ">" + child.task.id })
        }

        // ── PORTS: every incident edge gets its own attachment y inside the node ─────────────────
        // THE PRIMARY ANTI-OVERLAP DEVICE, in two halves. (a) A node with SEVERAL incident edges
        // spreads them over distinct ys inside its own height, ordered by the counterpart's y, so two
        // edges meeting one box never share a lead-out/lead-in y; one edge keeps the border middle.
        // (b) Every port carries its COLUMN's parity channel (see `shift` below), so the two
        // borders of any gutter can never share an anchor y either. Together they are what make
        // "no two different edges' horizontal runs are collinear" hold for every board shape.
        /** Every edge touching each node, with the counterpart whose row orders the ports. */
        const incident: Record<string, Array<{ key: string; counterpart: GraphNode }>> = {}
        for (const node of nodes) incident[node.task.id] = []
        for (const want of wants) {
          incident[want.parent.task.id].push({ key: want.key, counterpart: want.child })
          incident[want.child.task.id].push({ key: want.key, counterpart: want.parent })
        }
        /** The attachment y of each node's edge, keyed by task id and then by edge key. */
        const portOf: Record<string, Record<string, number>> = {}
        for (const node of nodes) {
          /** This node's incident edges, ordered by the counterpart's middle and then by key. */
          const ordered = [...incident[node.task.id]].sort((left, right) => {
            /** The difference of the two counterparts' vertical middles. */
            const delta = (left.counterpart.top + GEO.nodeHeight / 2) - (right.counterpart.top + GEO.nodeHeight / 2)
            if (delta !== 0) return delta
            return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
          })
          /** How many ports this node must spread. */
          const count = ordered.length
          /**
           * The pitch between two ports, widened for small fan-in and narrowed only when the box
           * needs the room (see {@link portStepOf}).
           */
          const step = portStepOf(count)
          /**
           * The parity of this node's spread offsets. EVERY tier above except the 2px capacity
           * fallback is a multiple of four, so each offset is EVEN and the spread parity is zero; a
           * two-pixel pitch is an odd multiple of one and inherits the COUNT's parity instead.
           */
          const spreadParity = step % 4 === 0 ? 0 : count % 2 === 0 ? 1 : 0
          /**
           * This column's PARITY CHANNEL: even ranks attach on odd pixels, odd ranks on even ones.
           *
           * THE HORIZONTAL ANTI-COLLINEARITY DEVICE, and it is systematic rather than a nudge. Every
           * box middle has the SAME parity — `centerY` is `pad + bandExtent + boxAreaHeight / 2` with an
           * odd half-area term, and a stack top subtracts an odd half-stack, so all middles are odd.
           * `shift` lifts this node's spread by 0 or 1 so that the FINAL parity depends only on the
           * RANK, however many ports the node has: `(rank − spreadParity) mod 2`. Two neighbouring
           * columns therefore can NEVER produce the same attachment y, and their nearest ys are a
           * whole pixel apart.
           *
           * Every horizontal run in a gutter is anchored at one of that gutter's two borders, each
           * border belongs to exactly ONE column, and within a column the boxes are disjoint — so two
           * runs anchored at the same border cannot share a y either. Therefore no two different
           * edges' horizontal runs can be collinear, which is precisely what `overlaps` measures.
           */
          const shift = ((node.rank - spreadParity) % 2 + 2) % 2
          /** The furthest a spread offset may stand, chosen with the offsets' OWN parity for the clamp. */
          let limit = 20 - shift
          if ((limit - spreadParity) % 2 !== 0) limit -= 1
          portOf[node.task.id] = {}
          ordered.forEach((entry, index) => {
            /** The spread offset from the border middle, clamped a pixel inside the box. */
            const base = Math.max(-limit, Math.min(limit, (index - (count - 1) / 2) * step))
            portOf[node.task.id][entry.key] = node.top + GEO.nodeHeight / 2 + base + shift
          })
        }
        /** The edge each key names, so a gutter's key list can be ordered by its run's y. */
        const wantOf = new Map(wants.map((want) => [want.key, want]))

        // ── THE CROSSING ROWS: half the long edges above the boxes, half below ───────────────────
        // This replaces the old DUMMY ROWS. A reserved row per intermediate column pushed every
        // rank-skipping edge BELOW the board and made the picture read as a one-sided comb; the band
        // splits them by midpoint y instead, so a symmetric board draws symmetric crossings.
        /** The midpoint of a long edge's two attachments, which is the y the band split is made on. */
        const midpointOf = (want: { parent: GraphNode; child: GraphNode; key: string }): number =>
          (portOf[want.parent.task.id][want.key] + portOf[want.child.task.id][want.key]) / 2
        /** The long edges, ordered by midpoint y and then by key, so the split is deterministic. */
        const longWants = wants
          .filter((want) => Math.abs(want.parent.rank - want.child.rank) >= 2)
          .sort((left, right) => midpointOf(left) - midpointOf(right) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
        /** The band row each long edge crosses on, keyed by its edge key. */
        const bandRow = new Map<string, number>()
        longWants.forEach((want, index) => {
          /** How far this edge's row stands from the box area: 1 is the nearest row. */
          const distance = index < topCount ? index + 1 : index - topCount + 1
          bandRow.set(want.key, index < topCount
            ? GEO.pad + bandExtent - distance * BAND_STEP
            : GEO.pad + bandExtent + boxAreaHeight + distance * BAND_STEP)
        })

        // ── LANES: one per hop, per gutter, always distinct ──────────────────────────────────────
        /** The edge keys crossing each gutter, gutter by gutter. */
        const crossing: string[][] = []
        for (let rank = 0; rank + 1 < rankCount; rank += 1) crossing.push([])
        /** The same-rank edges' own keys per column, which have no gutter between their ends. */
        const levelKeys: string[][] = columns.map(() => [])
        for (const want of wants) {
          /** The lower rank this edge touches. */
          const lo = Math.min(want.parent.rank, want.child.rank)
          /** The higher rank it touches. */
          const hi = Math.max(want.parent.rank, want.child.rank)
          if (hi === lo) {
            levelKeys[lo].push(want.key)
            continue
          }
          for (let rank = lo; rank < hi; rank += 1) if (crossing[rank] !== undefined) crossing[rank].push(want.key)
        }
        /**
         * The y at which one edge's vertical run stands in one gutter, which is the order the lanes are
         * allocated in: the lane nearest the gutter's centre belongs to the run nearest the midline.
         * @param want - the edge, resolved to its boxes.
         * @param gutter - the gutter's index.
         * @returns the run's midpoint y.
         */
        const hopY = (want: { parent: GraphNode; child: GraphNode; key: string }, gutter: number): number => {
          /** The attachment the edge leaves at. */
          const fromY = portOf[want.parent.task.id][want.key]
          /** The attachment it arrives at. */
          const toY = portOf[want.child.task.id][want.key]
          if (Math.abs(want.parent.rank - want.child.rank) < 2) return (fromY + toY) / 2
          /** The gutter at the parent's end, which is where the first riser stands. */
          const parentGutter = want.parent.rank < want.child.rank ? want.parent.rank : want.parent.rank - 1
          return gutter === parentGutter
            ? (fromY + (bandRow.get(want.key) ?? fromY)) / 2
            : ((bandRow.get(want.key) ?? toY) + toY) / 2
        }
        /** The lane index each edge takes in each gutter. */
        const laneIndex = new Map<string, number>()
        /** How many lanes the busiest gutter must carry, which is what sizes the inset. */
        let maxLanes = 0
        for (let rank = 0; rank < crossing.length; rank += 1) {
          // Y ORDER, because the allocation below mirrors its offsets about the gutter's centre: the
          // topmost run takes the centre lane and the rest alternate outward, so two runs that nearly
          // touch are never handed the same neighbour.
          crossing[rank] = [...crossing[rank]].sort((left, right) => {
            /** The first edge's run midpoint in this gutter. */
            const first = wantOf.get(left)
            /** The second edge's. */
            const second = wantOf.get(right)
            /** The difference of those midpoints. */
            const delta = (first === undefined ? 0 : hopY(first, rank)) - (second === undefined ? 0 : hopY(second, rank))
            if (delta !== 0) return delta
            return left < right ? -1 : left > right ? 1 : 0
          })
          maxLanes = Math.max(maxLanes, crossing[rank].length)
          crossing[rank].forEach((key, index) => laneIndex.set(rank + "@" + key, index))
        }
        // THE GUTTER IS DERIVED FROM THE LANES, not written down: a box keeps `inset` on each side of
        // its column, two neighbouring boxes therefore stand `2 * inset` apart, and the busiest gutter
        // asks for enough of that room to give every lane its preferred spacing plus a clearance.
        // A SAME-RANK EDGE also eats that room — it wraps around the right of its own column — so the
        // inset pays for the busier of the two demands. Measured on the flat one-column board (every
        // served depth 0): without this the fourteen wrap-around lanes collapsed onto the last pixel
        // and the audit reported four collinear vertical pairs.
        /** The most same-rank edges ONE column carries, which is the other claim on the inset. */
        let maxLevel = 0
        for (const keys of levelKeys) maxLevel = Math.max(maxLevel, keys.length)
        /**
         * How far the busiest gutter's lanes reach from its centre: the number of x values a same-rank
         * lane must dodge before the first free one. EXACT, so the level lanes below always find room
         * instead of silently clamping onto a crossing lane (a collinear vertical pair).
         */
        const laneReach = Math.max(0, Math.ceil((maxLanes - 1) / 2))
        /** The inset every box keeps inside its column, at this board's lane counts. */
        const inset = Math.max(
          GEO.inset,
          Math.min(MAX_INSET, Math.ceil((maxLanes * LANE_STEP + LANE_CLEARANCE * 2) / 2)),
          Math.min(MAX_INSET, maxLevel + laneReach + LANE_CLEARANCE),
        )
        /** The measured gutter between two neighbouring columns' boxes. */
        const gutter = inset * 2
        /** How far a lane may stand from a gutter's centre and still clear both boxes. */
        const halfBand = Math.max(0, inset - LANE_CLEARANCE)
        /** The most lanes one gutter can hold as DISTINCT columns at one pixel apart. */
        const capacity = halfBand * 2 + 1
        /** How many hops could not be given a distinct column, which a page must be able to report. */
        let laneOverflow = 0
        for (const keys of crossing) laneOverflow += Math.max(0, keys.length - capacity)

        /** The x of the LEFT border of a box in one column, at this board's inset. */
        const leftOf = (rank: number): number => borderLeft(rank, inset)
        /** The x of the RIGHT border of a box in one column, at this board's inset. */
        const rightOf = (rank: number): number => borderRight(rank, inset)
        /**
         * The x of one lane inside one gutter: the gutter's centre plus its alternating offset.
         * @param rank - the gutter's index, i.e. the column it sits to the right of.
         * @param key - the edge's key.
         * @returns the lane's x, always inside the gutter and never on a box's border.
         */
        const laneX = (rank: number, key: string): number => {
          /** How many lanes this gutter carries. */
          const count = crossing[rank]?.length ?? 1
          /** The furthest any lane of this gutter stands from the centre. */
          const reach = Math.max(0, Math.ceil((count - 1) / 2))
          /** The spacing the measured band pays for, so two lanes never share a column. */
          const step = reach === 0 ? 0 : Math.max(1, Math.floor(halfBand / reach))
          /** This lane's own index in the gutter. */
          const index = laneIndex.get(rank + "@" + key) ?? 0
          /** The alternating offset: 0, +1, -1, +2, -2 … the first lane stays nearest the centre. */
          const offset = index === 0 ? 0 : (index % 2 === 1 ? 1 : -1) * Math.ceil(index / 2)
          /** The furthest a lane may stand here, which only a REPORTED overflow reaches. */
          const bound = Math.max(0, Math.min(halfBand, reach * step))
          return (rank + 1) * GEO.column + Math.max(-bound, Math.min(bound, offset * step))
        }
        // A same-rank dependency has no gutter between its ends, so it runs around the RIGHT of its
        // column, in the inset space no box occupies. Its lane must be DISTINCT from every crossing
        // lane of that gutter — a shared x with an overlapping y is a collinear run — so it takes the
        // first free inset column rather than a fixed slot.
        /** Every x a crossing lane already took, which a same-rank lane must avoid. */
        const usedLaneX = new Set<number>()
        for (let rank = 0; rank < crossing.length; rank += 1) for (const key of crossing[rank]) usedLaneX.add(laneX(rank, key))
        /** The x each same-rank edge took, keyed by `<rank>@<edge key>`. */
        const levelLane = new Map<string, number>()
        for (let rank = 0; rank < levelKeys.length; rank += 1) {
          /** One column's same-rank edges, ordered by the parent's port so the picture is stable. */
          const ordered = [...levelKeys[rank]].sort((left, right) => {
            /** The first edge's departure y. */
            const first = wantOf.get(left)
            /** The second edge's departure y. */
            const second = wantOf.get(right)
            /** The difference of those departure ys. */
            const delta = (first === undefined ? 0 : portOf[first.parent.task.id][first.key])
              - (second === undefined ? 0 : portOf[second.parent.task.id][second.key])
            if (delta !== 0) return delta
            return left < right ? -1 : left > right ? 1 : 0
          })
          // THE CANDIDATES RUN FROM ONE CLEARANCE OFF THE BOX TO THE COLUMN'S LAST INSET PIXEL, which
          // is `halfBand` columns wide — the same room the inset above pays for, minus the clearance.
          /** The furthest inset column a same-rank lane may take. */
          const last = rightOf(rank) + halfBand
          for (const key of ordered) {
            /** The first inset column neither a crossing lane nor an earlier level edge took. */
            let x = rightOf(rank) + LANE_CLEARANCE
            while (x <= last && usedLaneX.has(x)) x += 1
            if (x > last) {
              // A gutter with no free inset column left: report it on the same terms as a lane overflow.
              laneOverflow += 1
              x = last
            }
            usedLaneX.add(x)
            levelLane.set(rank + "@" + key, x)
          }
        }
        /**
         * One horizontal run that STOPS where the next element starts, from either side.
         *
         * The end convention matters and is not cosmetic: a run that meets another RUN stops one pixel
         * short of it (the perpendicular element covers that pixel), which is what keeps two segments
         * from double-painting a corner and a lane's x exact.
         */
        const run = (fromX: number, toX: number, y: number): EdgeRect =>
          ({ left: Math.min(fromX, toX), top: y, width: Math.max(Math.abs(toX - fromX), 1), height: 1 })
        /**
         * One horizontal run that REACHES a box's border, covering that border's own pixel.
         *
         * The mirror of {@link run}: an end that meets a BOX must touch it, or a 1px line stops a pixel
         * short of the task it describes and the picture reads as a dependency that does not arrive.
         */
        const reach = (fromX: number, toX: number, y: number): EdgeRect =>
          ({ left: Math.min(fromX, toX), top: y, width: Math.abs(toX - fromX) + 1, height: 1 })
        /** One vertical run's rectangle, stopping just as a `run` does. */
        const runV = (x: number, fromY: number, toY: number): EdgeRect =>
          ({ left: x, top: Math.min(fromY, toY), width: 1, height: Math.max(Math.abs(toY - fromY), 1) })

        /** Every routed edge, in board order. */
        const edges: DrawnEdge[] = []
        for (const want of wants) {
          /** Whether the dependency runs downhill, which is the ordinary case. */
          const forward = want.parent.rank <= want.child.rank
          /** Whether both ends sit in the SAME column, which is a cyclic board's shape. */
          const level = want.parent.rank === want.child.rank
          /** The x the edge leaves the blocker's own border at; its y is the blocker's port below. */
          const fromX = forward ? rightOf(want.parent.rank) : leftOf(want.parent.rank)
          /** The x it arrives at on the blocked task's border. */
          const toX = level ? rightOf(want.child.rank) : forward ? leftOf(want.child.rank) : rightOf(want.child.rank)
          /** The y it leaves at: the blocker's own PORT for this edge, its middle when it has one edge. */
          const fromY = portOf[want.parent.task.id][want.key]
          /** The y it arrives at: the dependant's own port, its middle when it has one edge. */
          const toY = portOf[want.child.task.id][want.key]
          /** The painted runs, in draw order. */
          const segments: Array<{ key: string; rect: EdgeRect }> = []
          /** The x the path currently stands at, starting on the blocker's border. */
          let x = fromX
          /** The y the path currently stands at, starting on the blocker's port. */
          let y = fromY
          /**
           * The route's own VERTICES, in travel order, starting on the blocker's border.
           *
           * Recorded here because this is where the route is walked: the painted curve is a
           * parametrisation of THESE points, never a second routing of its own, so a change to a lane,
           * a port or a band row moves the picture and the assertion together.
           */
          const waypoints: CurvePoint[] = [{ x: fromX, y: fromY }]
          /**
           * Record one vertex, skipping a visit that did not MOVE the pen.
           *
           * A dependency whose two boxes sit on the same row walks to its lane and then "down" to the
           * row it never leaves, which used to append the SAME point twice: a no-op entry in `points`
           * and a redundant `L` in the radius-0 path. Nothing about containment depended on it (a
           * zero-length segment hides nothing); it is removed because a route with no repeated vertex is
           * the cleaner statement of what was walked. The RECTS are untouched by this — they are cut from
           * the pen's own arithmetic, not from this list — so `data-mpd-route` stays byte-identical.
           */
          const mark = (point: CurvePoint): void => {
            /** The vertex the list currently ends on, which is where the pen already stands. */
            const last = waypoints[waypoints.length - 1]
            if (last !== undefined && last.x === point.x && last.y === point.y) return
            waypoints.push(point)
          }
          /** The rank distance between the two boxes, which decides the route's SHAPE. */
          const span = Math.abs(want.parent.rank - want.child.rank)
          if (level) {
            // A SAME-RANK DEPENDENCY: no gutter lies between its ends, so the path leaves the blocker's
            // right border, steps into the inset space to the RIGHT of the column — which no box
            // occupies — runs down to the blocked task's port and comes back in on its right border.
            /** The x this edge's run stands at, chosen to avoid every crossing lane of that gutter. */
            const lane = levelLane.get(want.parent.rank + "@" + want.key) ?? rightOf(want.parent.rank) + LANE_CLEARANCE
            segments.push({ key: "out", rect: run(x, lane, y) })
            mark({ x: lane, y })
            segments.push({ key: "riser", rect: runV(lane, y, toY) })
            mark({ x: lane, y: toY })
            x = lane
            y = toY
          } else if (span >= 2) {
            // A RANK-SKIPPING EDGE CROSSES IN THE TOP OR BOTTOM BAND, never through a column: the path
            // leaves the blocker, rises (or falls) in the gutter beside it to THIS edge's own band row,
            // makes ONE run across every intermediate column on that row, then descends in the gutter
            // beside the dependant. The keys are the frozen vocabulary: out/riser/cross1/riser2/in.
            /** The gutter at the parent's end, where the first riser stands. */
            const firstGutter = forward ? want.parent.rank : want.parent.rank - 1
            /** The gutter at the child's end, where the second riser stands. */
            const lastGutter = forward ? want.child.rank - 1 : want.child.rank
            /** This edge's own crossing row, which no other long edge shares. */
            const row = bandRow.get(want.key) ?? GEO.pad + bandExtent
            /** The lane it rises in, beside its blocker. */
            const laneOut = laneX(firstGutter, want.key)
            /** The lane it descends in, beside its dependant. */
            const laneIn = laneX(lastGutter, want.key)
            segments.push({ key: "out", rect: run(x, laneOut, y) })
            mark({ x: laneOut, y })
            segments.push({ key: "riser", rect: runV(laneOut, y, row) })
            mark({ x: laneOut, y: row })
            segments.push({ key: "cross1", rect: run(laneOut, laneIn, row) })
            mark({ x: laneIn, y: row })
            segments.push({ key: "riser2", rect: runV(laneIn, row, toY) })
            mark({ x: laneIn, y: toY })
            x = laneIn
            y = toY
          } else {
            // AN ADJACENT-RANK DEPENDENCY: one gutter lies between the boxes, so the path leaves the
            // blocker's border, runs down (or up) that gutter's own lane and arrives in one hop.
            /** The gutter this hop's vertical run stands in. */
            const gutter = forward ? want.parent.rank : want.parent.rank - 1
            /** That gutter's own lane for this edge. */
            const lane = laneX(gutter, want.key)
            segments.push({ key: "out", rect: run(x, lane, y) })
            mark({ x: lane, y })
            segments.push({ key: "riser", rect: runV(lane, y, toY) })
            mark({ x: lane, y: toY })
            x = lane
            y = toY
          }
          // The lead-in lands ON the blocked task's border — covering that border's pixel, because this
          // end meets a BOX rather than another run — and the arrowhead's tip sits on the same x.
          segments.push({ key: "in", rect: reach(x, toX, y) })
          mark({ x: toX, y })
          // THE MARKER POINTS ALONG THE TRAVEL: it points LEFT when the path's last leg ran leftward,
          // which is what a back edge does and what a same-rank edge does when it comes back around its
          // own column. A marker that pointed the other way would read as an edge leaving the task.
          /** Whether the arrowhead points left, i.e. the edge arrives from the right. */
          const pointsLeft = level || toX < fromX
          /**
           * The arrowhead's BOUNDING BOX, whose tip end is the border the dependency arrives at.
           *
           * `headMax` is kept exactly as it was: `data-mpd-route` serializes this rect and clause W4 pins
           * that string, so the head's own geometry may not move underneath it. The clamp never binds on
           * a real board — the inset is capped far below a column's width — and the horizontal-scrollbar
           * intent it carries is now held by the canvas being exactly `graph.width` wide, one clipping
           * rule for the whole plane rather than a per-head correction.
           */
          const headMax = Math.max(0, rankCount * GEO.column - MARK_W)
          /** The x of the arrowhead's TIP, which IS the border the edge arrives at (clause W5). */
          const tipX = toX
          /** The arrowhead's own box: its tip on the arrival border, its base one head-length behind it. */
          const marker: EdgeRect = {
            left: Math.min(headMax, pointsLeft ? tipX : tipX - MARK_W),
            top: toY - Math.floor(MARK_H / 2),
            width: MARK_W,
            height: MARK_H,
          }
          // THE ARRIVAL IS A POINT (W5): `toX` is already the border this edge lands on in all three
          // cases — forward, same-rank and back — so the tip is the route's own last vertex and the
          // assertion is a pure equality with no knowledge of the head's width.
          /** The PAINTED form of this route: the same waypoints, filleted and swept (clause W6). */
          const shape = curveOf(waypoints, radius)
          edges.push({
            parent: want.parent.task.id,
            child: want.child.task.id,
            witness: want.child.task.id + "<-" + want.parent.task.id,
            segments,
            curve: { d: shape.d, points: shape.points, tip: { x: toX, y: toY }, radius },
            marker,
            pointsLeft,
          })
        }

        /** How many boxes each column holds; a long edge no longer reserves a row inside a column. */
        const slots = columns.map((column) => column.length)
        return {
          columns,
          rankCount,
          width: rankCount * GEO.column,
          // SYMMETRIC BY CONSTRUCTION: the same pad at both ends and the same band extent above and
          // below, so the canvas's own middle IS `centerY` — the value every stack is centred on.
          height: 2 * GEO.pad + 2 * bandExtent + boxAreaHeight,
          gridTemplateColumns: "repeat(" + rankCount + ", " + GEO.column + "px)",
          nodes,
          edges,
          inset,
          gutter,
          maxLanes,
          laneOverflow,
          slots,
          ranksDerived,
          unresolved,
          unresolvedRecorded,
          centerY,
          overlaps: overlapAudit(edges),
        }
      }

      /**
       * The transitive halo of one task: the hovered node, its ANCESTORS (what it rests on) and its
       * DESCENDANTS (what rests on it), along the drawn dependency edges.
       *
       * A chain is a RANK-MONOTONE path over the drawn edges: every hop to the left climbs to a strictly
       * lower rank, every hop to the right descends to a strictly higher one. That is the relation the
       * columns draw, and it is the only one that survives a diamond. Measured: walking the edges alone
       * lit `T1 → T2 → T3 → T4` up entirely when T2 was hovered, because T3 (a legitimate descendant) then
       * handed the walk its own dependent T4 — and a walk that let the two directions feed each other did
       * the same the other way round. The origin is the ONE exception, because a cycle resolves a
       * revisited node to rank 0, so a back-edge genuinely runs between two nodes of the same rank.
       *
       * THE RANKS ARE THE DRAWN ONES (R20). This walk used to compare the served `depth` values, which is
       * the same lie the columns trusted: on a board whose depths are all 0 the guard pruned EVERY hop
       * (`parent.depth >= byId[id].depth` is `0 >= 0`), so a hover lit one node and dimmed everything —
       * a halo that reaches nothing is exactly as wrong as a one-column drawing. The caller passes the
       * ranks the geometry actually drew, so the halo and the picture cannot disagree.
       *
       * Each frontier is worked as a QUEUE rather than a recursion, and `inHalo` holds it to one visit
       * per node, so a dependency cycle in the payload — which the route reports rather than repairs —
       * cannot spin this into a stack overflow.
       * @param tasks - the tasks the DRAWING contains: the board plus any plan-only ghost.
       * @param from - the hovered task's id.
       * @param rankOf - the rank each task was DRAWN in, straight off the geometry's own nodes.
       * @param edges - the edges the DRAWING routed (the served model's), when one arrived; absent
       *   means the board's own `blockedBy` is the only relationship available.
       * @returns the ids to tint; every other node is dimmed while a focus is held.
       */
      const focusChain = (tasks: TeamTask[], from: string, rankOf: Record<string, number>, edges?: ServedGraphModelEdge[]): Record<string, boolean> => {
        /** The task each id names, for the dependency lookups below. */
        const byId: Record<string, TeamTask> = {}
        for (const task of tasks) byId[task.id] = task
        /** The ids in the halo so far. */
        const focus: Record<string, boolean> = {}
        if (byId[from] === undefined) return focus
        // ONE SOURCE FOR BOTH DIRECTIONS. The halo must name the relationships the DRAWING routes, so
        // when a model arrived it reads the SERVED edges (`from` is the blocker, `to` the blocked task)
        // and falls back to the board's `blockedBy` only when none did — the SAME degrade the geometry
        // follows. Otherwise a plan-declared arrow would be painted while its hover called the
        // relationship nonexistent: the "picture disagrees with itself" class this wave exists to end.
        /** The blocker ids of one task, from the served edges or the board's own references. */
        const blockersOf = (id: string): string[] => {
          if (edges !== undefined) return edges.filter((edge) => edge.to === id).map((edge) => edge.from)
          return byId[id] === undefined ? [] : byId[id].blockedBy
        }
        /** What rests on each task, which is the same relationship read forwards. */
        const dependentsOf: Record<string, string[]> = {}
        if (edges !== undefined) {
          for (const edge of edges) {
            if (dependentsOf[edge.from] === undefined) dependentsOf[edge.from] = []
            dependentsOf[edge.from].push(edge.to)
          }
        } else {
          for (const task of tasks) {
            for (const blockerId of task.blockedBy) {
              if (dependentsOf[blockerId] === undefined) dependentsOf[blockerId] = []
              dependentsOf[blockerId].push(task.id)
            }
          }
        }
        focus[from] = true
        /** The ancestor frontier, seeded with the hovered node only; it keeps its OWN visited set. */
        const up: string[] = [from]
        /** Every id the ancestor chain has already visited. */
        const seenUp: Record<string, boolean> = { [from]: true }
        /** The descendant frontier, seeded with the hovered node only. */
        const down: string[] = [from]
        /** Every id the descendant chain has already visited. */
        const seenDown: Record<string, boolean> = { [from]: true }
        while (up.length > 0) {
          /** The id this pass expands. */
          const id = up.shift() as string
          /** The origin, whose own rank row the guard below is relaxed for (see the cycle note above). */
          const atOrigin = id === from
          for (const blockerId of blockersOf(id)) {
            if (seenUp[blockerId] === true) continue
            /** The blocker's own row; one the board does not carry draws no edge and tints nothing. */
            const parent = byId[blockerId]
            if (parent === undefined) continue
            // Strictly to the left — never a step back to the right, which is what keeps a cousin out —
            // measured in the ranks the DRAWING used, never in the served depth (see the note above).
            if ((rankOf[blockerId] ?? 0) >= (rankOf[id] ?? 0) && !atOrigin && blockerId !== from) continue
            seenUp[blockerId] = true
            focus[blockerId] = true
            up.push(blockerId)
          }
        }
        while (down.length > 0) {
          /** The id this pass expands. */
          const id = down.shift() as string
          /** The origin, whose own rank row the guard below is relaxed for. */
          const atOrigin = id === from
          for (const childId of dependentsOf[id] ?? []) {
            /** The dependent's own row, which must lie strictly to the right of the node expanded. */
            const child = byId[childId]
            if (child === undefined || seenDown[childId] === true) continue
            if ((rankOf[childId] ?? 0) <= (rankOf[id] ?? 0) && !atOrigin && childId !== from) continue
            seenDown[childId] = true
            focus[childId] = true
            down.push(childId)
          }
        }
        return focus
      }

      /**
       * Paint one routed edge: ONE SVG path over the layout's own waypoints, plus its arrowhead.
       *
       * NO GEOMETRY IS COMPUTED HERE. The layout routed the edge and derived its painted form — the
       * fillets, the closing sweep, the flattened polyline, the arrowhead's box — and this function only
       * decides the colour and emits the two elements, so the drawing and the asserted geometry cannot
       * drift apart. The SVG is a PAINTING plane, never a second source of truth: nothing below reads
       * the DOM, measures a box or resolves a style, which is the one prohibition that SURVIVES this
       * wave's contract amendment (the prohibition was always measurement, never SVG).
       * @param edge - the routed edge, straight off the geometry.
       * @param tinted - whether BOTH of its ends are inside the hover halo.
       * @param flowing - whether this edge is completed -> running, which adds the dash-flow class.
       * @returns the edge's group, its path and its arrival arrowhead.
       */
      const edgeOf = (edge: DrawnEdge, tinted: boolean, flowing: boolean): unknown => {
        /** The colour every run of this edge draws in; a focused edge reads brighter. */
        const base = tinted ? FOCUS_EDGE : CSS.edge.background
        /** The arrowhead's own box, whose tip end is the border the dependency arrives at. */
        const head = edge.marker
        /** The x of the TIP: the box's right end for a right-pointing head, its left one otherwise. */
        const tipX = edge.pointsLeft ? head.left : head.left + head.width
        /** The x its base stands at, which is the box's other end. */
        const baseX = edge.pointsLeft ? head.left + head.width : head.left
        /** The y the head is centred on, which is the arrival row. */
        const tipY = head.top + head.height / 2
        /** The arrowhead as an SVG polygon: the tip first, then the base's two corners. */
        const headShape = tipX + "," + tipY + " " + baseX + "," + head.top + " " + baseX + "," + (head.top + head.height)
        // THE TIP MARK IS A ZERO-WIDTH RECT (clause W4): `toX` is the border the edge lands on, and a
        // zero width means an arm can read the apex without knowing `MARK_W` — the width the old CSS
        // triangle published nowhere, which is exactly why the arrival was unreadable from the DOM.
        /** The arrival point, serialized in the same `left,top,width,height` grammar as every other mark. */
        const tipText = edge.curve.tip.x + "," + (edge.curve.tip.y - Math.floor(MARK_H / 2)) + ",0," + MARK_H
        return react.createElement("g", {
          key: "edge:" + edge.parent + ">" + edge.child,
          // THE WITNESSABLE MARK: `capture.mts` (docker/ui) reads `data-mpd-edge` and counts `data-mpd-graph`'s
          // `edges=` against exactly these, so one edge per DRAWN dependency is what must appear here.
          "data-mpd-edge": edge.witness,
          // STILL THE ROUTING TRUTH: the orthogonal runs the layout cut, in draw order, with the
          // direction and the arrowhead's box — the curve below is a parametrisation of these.
          "data-mpd-route": routeText(edge),
        },
          react.createElement("path", {
            key: "curve",
            // THE PAINTED FORM, published so a test can prove the drawn path is the proven one: the
            // flattened polyline the containment arm measures is built from exactly this `d`.
            "data-mpd-curve": edge.curve.d,
            d: edge.curve.d,
            // THE FLOW CLASS IS PIXEL-UNIT, ON PURPOSE (D2 repair, Docker 2026-10-21): the old
            // `pathLength="100"` normalisation shrank the 6px dashes to ~1.4px on a short hop, so it
            // was removed and `stroke-dasharray: 6 6` now reads at 6px ON EVERY EDGE LENGTH. A
            // non-flow edge carries NO class — it is static, as the contract requires.
            className: flowing ? "mpd-dag-flow" : undefined,
            fill: "none",
            // THE TINT IS THE STROKE (clause W7): the box this edge used to fill with a colour is now
            // painted by a line, so the focus halo has to travel through the stroke and the head's fill.
            stroke: base,
            strokeWidth: "1",
            strokeLinecap: "round",
          }),
          react.createElement("polygon", {
            key: "head",
            // THE HEAD IS A POLYGON, NOT A PATH, so "one `<path>` per drawn edge" stays countable.
            "data-mpd-head": "1",
            "data-mpd-tip": tipText,
            points: headShape,
            fill: base,
            stroke: "none",
          }),
        )
      }

      /**
       * The completed -> running motion overlay: a small arrow polygon riding the SAME `d` the main
       * path draws, as an SVG `animateMotion` in a separate `<g data-mpd-flow>`.
       *
       * SEPARATE ON PURPOSE. It carries none of the counted attributes (`data-mpd-edge`,
       * `data-mpd-curve`, `data-mpd-tip`, `data-mpd-head`), so "one path and one head per drawn edge"
       * stays a statement about the EDGE groups while this layer only adds motion. `rotate="auto"`
       * turns the arrow with the path's own tangent, and the 1.6s loop is the wave's declared tempo.
       * @param edge - the routed edge whose parent is completed and whose child is running.
       * @returns the overlay group; the caller appends it AFTER every edge group in the same SVG.
       */
      const flowOf = (edge: DrawnEdge): unknown => react.createElement("g", {
        key: "flow:" + edge.parent + ">" + edge.child,
        "data-mpd-flow": edge.witness,
      },
        react.createElement("polygon", {
          key: "flow-arrow",
          points: "-5,-4 5,0 -5,4",
          fill: TONE.running,
          stroke: "none",
        },
          react.createElement("animateMotion", {
            key: "flow-motion",
            path: edge.curve.d,
            dur: "1.6s",
            repeatCount: "indefinite",
            rotate: "auto",
          })))

      /**
       * One rectangle as the comma-joined text `data-mpd-route` publishes.
       * @param rect - the rectangle.
       * @returns `left,top,width,height`.
       */
      const rectText = (rect: EdgeRect): string => rect.left + "," + rect.top + "," + rect.width + "," + rect.height

      /**
       * One edge's whole route as the text `data-mpd-route` publishes, so a test asserts the geometry
       * that was DRAWN rather than re-deriving it: the runs in draw order, then `R`/`L`, then the
       * arrival marker's own box.
       * @param edge - the routed edge.
       * @returns the serialized route.
       */
      const routeText = (edge: DrawnEdge): string =>
        edge.segments.map((segment) => rectText(segment.rect)).join(";") + "|" + (edge.pointsLeft ? "L" : "R") + rectText(edge.marker)

      /**
       * The TASK DETAIL body of the pinned node: the record's own fields, its blockers and its
       * dependents, and — when the task route served one — the FROZEN acceptance contract, quoted
       * rather than summarized because that text is what a reviewer holds the work to.
       * @param task - the pinned task.
       * @param tasks - the whole board, for the dependents lookup when no model arrived.
       * @param contract - the frozen contract of this task, when the route served one.
       * @param edges - the edges the DRAWING routed (the served model's), when one arrived.
       * @returns the detail element.
       */
      const detailSection = (task: TeamTask, tasks: TeamTask[], contract: { description: string; claimedBy: string; claimedAt: string; attempt: number } | undefined, edges?: ServedGraphModelEdge[]): unknown => {
        // BLOCKERS AND DEPENDENTS COME FROM THE SAME SOURCE AS THE DRAWN EDGES. A plan-declared arrow
        // is painted, so the pinned body must name that relationship: with a model it reads the served
        // edges, and only without one does it fall back to the board's `blockedBy` — the same degrade.
        /** This task's blockers as the drawing routes them: served edges first, `blockedBy` as the degrade. */
        const blockers = edges === undefined ? task.blockedBy : edges.filter((edge) => edge.to === task.id).map((edge) => edge.from)
        /** The tasks resting on this one, which is the same relationship read forwards. */
        const dependents: string[] = []
        if (edges === undefined) {
          for (const other of tasks) if (other.blockedBy.indexOf(task.id) >= 0) dependents.push(other.id)
        } else {
          for (const edge of edges) if (edge.from === task.id) dependents.push(edge.to)
        }
        /** The detail's rows, in render order. */
        const rows: unknown[] = [
          react.createElement("div", { key: "d-top", style: CSS.row },
            react.createElement("span", { key: "d-subject", style: { flex: "1 1 auto", fontWeight: 600 } }, task.subject),
            react.createElement("span", {
              key: "d-close",
              "data-detail-close": task.id,
              style: { ...CSS.chip, cursor: "pointer" },
              onClick: () => { if (setPinned !== null) setPinned(null) },
            }, t("task.close"))),
          react.createElement("div", { key: "d-id", style: { ...CSS.meta, marginTop: "2px" } },
            task.id + " · " + kindOf(task.kind) + " · " + glyphOf(task.visual) + " " + task.visual
            + (task.failedBy.length === 0 ? "" : " · " + t("task.verdict") + " ✗ " + task.failedBy.join(", "))),
        ]
        if (task.owner !== undefined) rows.push(detailRow("d-owner", "task.owner", task.owner))
        if (task.attempt !== undefined) rows.push(detailRow("d-attempt", "task.attempt", String(task.attempt)))
        if (task.round !== undefined) rows.push(detailRow("d-round", "task.round", String(task.round)))
        if (task.verdict !== undefined) rows.push(detailRow("d-verdict", "task.verdict", task.verdict))
        rows.push(detailRow("d-blocked", "task.blockedBy", blockers.length === 0 ? "—" : blockers.join(", ")))
        rows.push(detailRow("d-dependents", "task.dependents", dependents.length === 0 ? "—" : dependents.join(", ")))
        // THE PRODUCER'S OWN REPORT, on the task it belongs to (R18's reader side): these references
        // matched nothing when the record was written, so naming them is what turns "this task looks
        // like it has no blockers" into "this task HAS blockers the record could not resolve".
        /** The references this record reports as unresolved, absent when everything resolved. */
        const recordedUnresolved = Array.isArray(task.unresolvedBlockers) ? task.unresolvedBlockers : []
        if (recordedUnresolved.length > 0) rows.push(detailRow("d-unresolved", "task.unresolved", recordedUnresolved.join(", ")))
        if (contract === undefined) {
          rows.push(react.createElement("div", { key: "d-contract-none", style: { ...CSS.dim, marginTop: "4px" } }, t("task.contract.none")))
        } else {
          rows.push(react.createElement("div", { key: "d-contract-head", style: CSS.subHead }, t("task.contract")))
          rows.push(react.createElement("div", { key: "d-contract", style: { ...CSS.card, marginTop: "2px", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, contract.description))
        }
        return react.createElement("div", { key: "task-detail", "data-mpd-detail": task.id, style: { marginTop: "10px" } }, rows)
      }

      /**
       * One language-independent word per lifecycle phase.
       *
       * The phase is the RECORD's own word (`staged`/`active`/`idle`/`ended`), and it stays
       * distinguishable from the other three even in a Chinese render, which is why it is translated
       * through a key table rather than echoed raw into a localized panel.
       * @param phase - the phase as the payload serves it.
       * @returns the localized label.
       */
      const phaseLabel = (phase: string): string => t(PHASE_KEY[phase] ?? phase)

      /**
       * The workspace's teams, listed for a session that has none of its own.
       *
       * THE DEAD END THIS REMOVES (D2): the record is session-scoped, so a panel in a session that
       * did not approve the workspace's team rendered "no team in this workspace yet" while the team
       * sat on disk — the exact state the user reported as "built but not used". Every row carries
       * `data-mpd-workspace-team=<id>`, so a driver can prove which teams were rendered rather than
       * trusting a screenshot.
       * @param records - the workspace's teams, newest first.
       * @param activeId - the team bound to THIS session, when the index binds one.
       * @returns the section element.
       */
      const workspaceSection = (records: WorkspaceTeam[], activeId: string | undefined): unknown => {
        /** The section's rows, in render order. */
        const rows: unknown[] = [
          react.createElement("div", { key: "w-title", style: CSS.subHead }, t("workspace.title")),
          react.createElement("div", { key: "w-hint", style: CSS.dim }, t("workspace.hint")),
        ]
        for (const team of records) {
          rows.push(react.createElement("div", {
            key: "w-" + team.id,
            "data-mpd-workspace-team": team.id,
            style: CSS.card,
            title: team.description,
          },
          react.createElement("div", { key: "w-top", style: CSS.row },
            react.createElement("span", { key: "w-name", style: { flex: "1 1 auto", fontWeight: 600 } }, team.name),
            // ACTIVE IS BOTH A WORD AND A MARKER: the chip says which session drives this team, and the
            // attribute makes it assertable without parsing the panel's text.
            team.active || team.id === activeId
              ? react.createElement("span", { key: "w-active", "data-mpd-workspace-active": team.id, style: CSS.chip }, t("workspace.active"))
              : null),
          react.createElement("div", { key: "w-meta", style: CSS.meta },
            team.id + " · " + phaseLabel(team.phase) + " · " + team.tasks.completed + "/" + team.tasks.total + " " + t("task.title").toLowerCase()
            + (team.tasks.failed === 0 ? "" : " · " + team.tasks.failed + " ✗")
            + " · " + team.members + " " + t("workspace.members"))))
        }
        rows.push(react.createElement("div", { key: "w-stage", style: { ...CSS.dim, marginTop: "6px" } }, t("workspace.stage")))
        return react.createElement("div", { "data-mpd-team-tab": "", "data-mpd-workspace-teams": String(records.length), style: CSS.panel }, rows)
      }

      /**
       * The team panel.
       *
       * The session id comes from the host's own props when it offers one (both hosts do, in their own
       * spelling); without one the route answers the workspace's principal team, which is what a panel
       * opened outside a session should show.
       */
      const TeamView = (props?: unknown): unknown => {
        /** The host's props, read leniently: both hosts spell the session differently. */
        const seat = (props ?? {}) as { sessionId?: unknown; scope?: { sessionId?: unknown } }
        /** The session this panel addresses; empty asks the route for the workspace principal. */
        const sessionId = String(seat.sessionId ?? seat.scope?.sessionId ?? "") || sessionIdFromPane()
        /** The polled store and its setter. */
        const [store, setStore] = react.useState({ state: null, plan: null, contracts: {}, error: undefined } as TeamStore)
        // One poller per session: the effect re-runs when the host hands this panel a different one.
        react.useEffect(() => start(sessionId, setStore), [sessionId])
        // HOVER AND PIN ARE DECLARED BEFORE EVERY EARLY RETURN on purpose: a hook's slot order must be
        // identical on every render path, or React's own state would shift the moment a team appears.
        /** The hovered task's id, which drives the focus chain; null when nothing is hovered. */
        const [hover, setHoverState] = react.useState(null as string | null)
        /** The pinned task's id, which drives the detail body; null when nothing is pinned. */
        const [pinned, setPinnedState] = react.useState(null as string | null)
        /** The hover card's state: which drawn task it describes and where the pointer is, or null. */
        const [tip, setTipState] = react.useState(null as TipState | null) as [TipState | null, (next: TipState | null) => void]
        /** The ticker's clock, read by the elapsed row; a number from the first render onward. */
        const [clock, setClockState] = react.useState(Date.now()) as [number, (next: number) => void]
        // The handlers below are closures of THIS render, so they always write through this render's
        // setters; the factory-scope names are what the detail body and the edges reach.
        setPinned = setPinnedState as (next: string | null) => void
        setHover = setHoverState as (next: string | null) => void
        /** The store, narrowed out of the tuple above. */
        const current = store as TeamStore
        /** The last readable payload, or null while there is none. */
        const state = current.state
        // THE CLOCK RUNS ONLY WHILE A RUNNING TASK IS VISIBLE: the card's elapsed row is the only
        // consumer, so an idle panel must not re-render once a second. The effect owns its cleanup,
        // which clears the interval on unmount or the moment the last running task settles.
        /** Whether any task on the served board is running, which is the ticker's whole reason to exist. */
        const runningVisible = state !== null && state.tasks.some((task) => task.visual === "running")
        react.useEffect(() => {
          if (!runningVisible) return undefined
          /** The one-second tick that keeps a running task's elapsed row honest. */
          const timer = setInterval(() => setClockState(Date.now()), 1000)
          return () => clearInterval(timer)
        }, [runningVisible])
        if (state === null) {
          // THE ROOT CARRIES THE TEAM ID, and `""` while there is none: the host asserts on a stable
          // marker for the tab, so every path out of this view writes it — including the two that have
          // no team yet.
          return react.createElement("div", { "data-mpd-team-tab": "", style: { ...CSS.panel, ...CSS.dim } },
            current.error === undefined ? t("state.reading") : t("state.unavailable"))
        }
        if (state.team === null) {
          // A STAGED PLAN WITH NO TEAM IS THE NORMAL PRE-APPROVAL STATE, not an empty one: the team
          // record is materialised AT approval, so before one there is nothing to show here and
          // everything to show in the plan. Returning the empty sentence would have hidden the very
          // thing the captain came to approve.
          if (current.plan !== null && current.plan.plan !== null) return planSection(current.plan.plan)
          // ── THE WORKSPACE'S OWN TEAMS (D2) ─────────────────────────────────────
          // The team record is SESSION-scoped, so a session that approved nothing rendered the empty
          // sentence even while the workspace held teams another session had built — which is exactly
          // what the user read as "建了但没用上". When the route served a non-empty listing, THAT is the
          // answer; the sentence below stays for the workspace that genuinely has no team yet.
          /** The workspace listing this payload carries, when the route read one. */
          const listed = state.workspaceTeams?.records ?? []
          if (listed.length > 0) return workspaceSection(listed, state.workspaceTeams?.activeId)
          return react.createElement("div", { "data-mpd-team-tab": "", style: { ...CSS.panel, ...CSS.dim } }, t("state.none"))
        }
        /** The team head; non-null past the guard above. */
        const team = state.team
        /** The tally, in the record's own vocabulary. */
        const counts = state.counts
        /** The board, which the figures, the graph and the detail body all read. */
        const tasks = state.tasks
        /** The completion percentage, 0 while the board has no tasks. */
        const percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100)
        /** The DAG geometry of this poll's board, drawn from the SERVED ranks (Amendment 3). */
        const graph = layout(tasks, EDGE_RADIUS, state.model)
        /** The node each task id draws in, so an edge is placed from the board alone. */
        const nodeOf: Record<string, GraphNode> = {}
        for (const node of graph.nodes) nodeOf[node.task.id] = node
        /**
         * The GRAPH-SAFE label of every node, keyed by task id — clause C4, composed in ONE place.
         *
         * Built here rather than inline because it is the ONLY text the drawing takes from a task: the
         * ordinal comes off the geometry's own nodes (which hold the served board's order), and the
         * pinned detail body and the hover `title` keep the original subject untouched (clause C3).
         */
        const labelOf: Record<string, string> = {}
        for (const node of graph.nodes) labelOf[node.task.id] = graphSafeLabel(node.task.subject, node.ordinal)
        // THE RANKS THE DRAWING USED, handed to the hover halo so it cannot measure a different relation
        // than the columns draw: the node's own `rank` is the SERVED rank this plane drew, never a value
        // recomputed here (R20, as amended by Amendment 3).
        /** The drawn rank of every task, straight off the geometry. */
        const drawnRank: Record<string, number> = {}
        for (const node of graph.nodes) drawnRank[node.task.id] = node.rank
        // THE DRAWING'S OWN TASK SET, GHOSTS INCLUDED: the halo walks what is ON SCREEN, not the board,
        // or a plan-only node could be painted yet never tint its neighbours.
        /** Every task the drawing contains: the board plus any plan-only ghost. */
        const drawingTasks = graph.nodes.map((node) => node.task)
        // THE TALLY SAYS WHAT A CAPTAIN ACTS ON, not just how far along the board is: how many tasks
        // a member could pick up RIGHT NOW, and how many of those are only ready because a
        // prerequisite FAILED (OPT-1 releases them, and that must not hide inside "ready").
        /** The line a captain reads: what is moving, what is pickable, what is held. */
        const tally = counts.running + " " + t("tally.running") + " · " + counts.ready + " " + t("tally.ready")
          + " · " + counts.blocked + " " + t("tally.blocked")
          + (counts.releasedByFailure === 0 ? "" : " · " + counts.releasedByFailure + " " + t("tally.released"))
        /** The focus halo of the hovered node — empty while nothing is hovered, so every node is full. */
        const focus: Record<string, boolean> = hover === null ? {} : focusChain(drawingTasks, hover as string, drawnRank, state.model?.edges)
        /** Whether a hover is dimming the rest of the board. */
        const focusing = Object.keys(focus).length > 0
        // A CHAIN IS ACTIVE ONLY WITH A RELATED NODE: a hover whose halo holds nothing beyond the
        // hovered task itself relates to nothing, and a reader that counted that as a chain would be
        // reading a highlight that tinted one node and dimmed no other.
        /** Whether the hovered node's halo reaches at least one other node. */
        const chainActive = focusing && Object.keys(focus).length > 1
        /** The RENDERED state of every drawn task, so the flow overlay reads what the boxes show. */
        const visualById: Record<string, string> = {}
        for (const node of graph.nodes) visualById[node.task.id] = node.task.visual
        /** The drawn edges, PAINTED FROM THE LAYOUT'S OWN ROUTES: one per dependency on the board. */
        // A `blockedBy` id the board does not carry draws NOTHING: the payload serves the list raw,
        // while the rank projection drops unknown ids, so an entry naming a ghost is reachable in real
        // data — and an edge into a node that is not there would be a picture of a dependency that the
        // record does not have. The layout already applied that rule, so the count here is the count
        // the `data-mpd-graph` witness announces.
        const edges: unknown[] = []
        /** The completed -> running overlays, appended AFTER every edge group so they paint on top. */
        const flows: unknown[] = []
        for (const edge of graph.edges) {
          // THE TINT IS A HOVER FACT, so it is decided here and not in the geometry: an edge reads
          // brighter only while BOTH of its ends are inside the halo, which is what makes a chain
          // readable as a path rather than as two unrelated highlights.
          /** Whether this dependency leaves a COMPLETED task for a RUNNING one — the one moving arrow. */
          const flowing = visualById[edge.parent] === "completed" && visualById[edge.child] === "running"
          edges.push(edgeOf(edge, focus[edge.parent] === true && focus[edge.child] === true, flowing))
          if (flowing) flows.push(flowOf(edge))
        }
        // THE PINNED LOOKUP SEARCHES WHAT IS DRAWN, not the board: a plan-only GHOST is clickable, and
        // a board-only lookup made the click set `aria-pressed` while `detailSection` never ran — the
        // pin fell through the same crack the halo and the edges were fixed for.
        /** The pinned node's own record, or undefined when the pinned id is no longer drawn. */
        const pinnedTask = pinned === null ? undefined : drawingTasks.find((candidate) => candidate.id === pinned)
        /** The hover card's task, also looked up in what is DRAWN; undefined closes the card. */
        const tipTask = tip === null ? undefined : drawingTasks.find((candidate) => candidate.id === tip.id)
        /** The panel's elements, in render order. */
        const children: unknown[] = [
          // ONE SCOPED STYLESHEET AT THE PANEL ROOT, outside `[data-mpd-graph]`: the material, the
          // keyframes and the reduced-motion block live here, never in the drawing's own subtree.
          react.createElement("style", { key: "dag-css", "data-mpd-dag-css": "1" }, DAG_CSS),
          react.createElement("div", { key: "head", style: CSS.head }, team.name),
          react.createElement("div", { key: "sub", style: CSS.row },
            react.createElement("span", { key: "phase", style: CSS.chip }, team.phase),
            react.createElement("span", { key: "id", style: CSS.dim }, team.id),
            team.approvedAt === undefined ? null : react.createElement("span", { key: "approved", style: CSS.dim }, t("header.approved") + " " + team.approvedAt),
            state.workspace === undefined ? null : react.createElement("span", { key: "ws", style: CSS.dim }, t("header.workspace") + " " + baseName(state.workspace))),
          react.createElement("div", { key: "tally", style: { ...CSS.dim, marginTop: "2px" } }, tally),
          react.createElement("div", { key: "figures", style: { ...CSS.dim, marginTop: "2px" } },
            counts.completed + "/" + counts.total + " " + t("header.complete")
            + " · " + counts.running + " " + t("tally.running") + " / " + counts.ready + " " + t("tally.ready")),
          react.createElement("div", { key: "bar", style: CSS.bar },
            react.createElement("div", { "data-progress": String(percent), style: { ...CSS.barFill, width: percent + "%" } })),
          react.createElement("div", { key: "progress", style: { ...CSS.meta, marginTop: "2px" } }, t("progress.label") + " " + percent + "%"),
          // THE EXECUTOR IS SHOWN, because which backend raises a member is exactly the fact that
          // explains a team behaving differently than expected — served by the same route.
          react.createElement("div", { key: "exec", style: { ...CSS.dim, marginTop: "4px" } },
            react.createElement("span", { style: CSS.chip }, state.executor.kind), " " + t("executor.label")),
          react.createElement("div", { key: "members-head", style: CSS.subHead }, t("members.title") + " (" + state.members.length + ")"),
        ]
        if (state.members.length === 0) {
          children.push(react.createElement("div", { key: "members-empty", style: { ...CSS.dim, marginTop: "2px" } }, t("members.empty")))
        }
        for (const member of state.members) {
          // ONE PLAIN CARD PER MEMBER (the user's ruling: 成员卡的 UI 不必那么花哨): a CSS status dot,
          // the name, the role chip, the route in tertiary text, the current task truncated, and the
          // fraction right-aligned. No avatar, no mascot, no state art.
          /** The card's rows, in render order. */
          const card: unknown[] = [
            react.createElement("div", { key: "c-top", style: CSS.row },
              react.createElement("span", { key: "dot", style: memberDot(member.status), title: member.status }),
              react.createElement("span", { key: "name", style: { flex: "1 1 auto", fontWeight: 600 } }, member.name),
              member.role === undefined || member.role === "" ? null : react.createElement("span", { key: "role", style: CSS.chip }, t(member.role)),
              react.createElement("span", { key: "frac", style: CSS.dim }, member.done + "/" + member.total)),
          ]
          if (member.route !== undefined && member.route !== "") {
            card.push(react.createElement("div", { key: "c-route", style: { ...CSS.meta, marginTop: "1px" } }, member.route))
          }
          if (member.current !== undefined && member.current !== "") {
            card.push(react.createElement("div", { key: "c-current", style: { ...CSS.meta, marginTop: "1px" }, title: member.current },
              t("members.current") + " " + short(member.current, SUBJECT_MAX)))
          }
          children.push(react.createElement("div", { key: "m-" + member.id, "data-member": member.id, style: CSS.card }, card))
        }
        // THE DAG, in the form a 380px column can carry: one rank column per rank, one node per task,
        // and one DRAWN edge per `blockedBy` entry that names a task on this board. The edge layer is a
        // PAINTING plane over the layout's own arithmetic — one SVG path per edge, no measurement
        // anywhere — so the curve cannot disagree with the data it was routed from.
        children.push(react.createElement("div", { key: "tasks-head", style: CSS.subHead }, t("task.title") + " (" + tasks.length + ")"))
        if (tasks.length === 0) {
          // The empty state NAMES THE CALL that fills it, so a captain reading an empty board knows
          // what to post rather than only that nothing is there.
          children.push(react.createElement("div", { key: "tasks-empty", style: { ...CSS.dim, marginTop: "2px" } }, t("task.empty")))
        }
        if (state.cycles.length > 0) {
          // A CYCLE IS REPORTED, NEVER HIDDEN: an unrenderable board still has to say what is wrong with
          // it, and the payload already carries the ids.
          children.push(react.createElement("div", { key: "cycles", style: { marginTop: "2px", color: TONE.blocked } },
            t("task.cycle") + " " + state.cycles.join(", ")))
        }
        if (tasks.length > 0) {
          children.push(react.createElement("div", {
            key: "graph",
            // THE WITNESSABLE MARK: the counts are of what is RENDERED below, so a screenshot's
            // `ranks=`/`edges=` cannot drift from the picture the panel actually drew.
            "data-mpd-graph": "ranks=" + graph.rankCount + " edges=" + edges.length,
            // A chain is active only when the halo holds a RELATED node, not merely the hovered one.
            "data-mpd-focus": chainActive ? "chain" : "none",
            // THE ONLY SCROLLER, ON PURPOSE (the user's ruling): the pan exists so the WHOLE DAG can be
            // seen, which is a property of this box alone. Its width stays the PANEL's — `100%` — while
            // the canvas inside it is `graph.width` wide, so a wide board scrolls HERE and never pushes
            // a sibling row sideways, never widens the panel and never clips the text around it.
            style: { ...CSS.scroll, width: "100%", height: Math.min(graph.height, 260) + "px" },
          },
            // The grid WRAPS the canvas: the wrapper carries the vertical breathing room as padding, so
            // the origin an edge's absolute coordinates are measured from stays the grid itself.
            react.createElement("div", { style: { position: "relative", width: graph.width + "px", padding: GEO.pad + "px 0" } },
              react.createElement("div", { style: { ...CSS.grid, width: graph.width + "px", height: graph.height + "px", gridTemplateColumns: graph.gridTemplateColumns } },
              // THE EDGES LAYER IS THE GRID'S FIRST CHILD, so every path paints BEHIND the boxes. The
              // routes no longer cross a box (the layout reserves a row for each long edge's hops),
              // but this is the safety net that makes an overlap impossible rather than merely
              // unlikely: a mis-routed line can only be hidden by a node, never cover a task.
              // ONE `<svg>` IS THE WHOLE PLANE: one canvas, one coordinate space — the layout's own —
              // with `width`/`height`/`viewBox` all saying the same thing, so a path's numbers ARE the
              // pixels the geometry was asserted in and SVG's default clipping keeps a head that sits
              // on the canvas edge from opening a scrollbar.
              react.createElement("svg", {
                key: "edges",
                "data-edges": "1",
                width: graph.width,
                height: graph.height,
                viewBox: "0 0 " + graph.width + " " + graph.height,
                style: { ...CSS.edgeLayer, width: graph.width + "px", height: graph.height + "px" },
              }, edges.concat(flows)),
              graph.columns.map((column, rank) => react.createElement("div", {
                key: "col-" + rank,
                "data-mpd-rank": String(rank),
                style: { ...CSS.column, width: GEO.column + "px", height: graph.height + "px" },
              },
              column.map((task) => react.createElement("div", {
                key: "node-" + task.id,
                "data-mpd-node": task.id,
                // THE FROSTED-GLASS CLASS AND THE RENDERED STATE both live on the card: the class is
                // the stylesheet's hook (`backdrop-filter`, breathing, transition), the attribute is
                // the data the breathing selector keys on. Neither changes the inline semantics below.
                className: "mpd-dag-node",
                "data-visual": task.visual,
                // THE BOX'S OWN RECTANGLE, published so the geometry can be ASSERTED from what was
                // actually rendered: an edge's runs and every box come out of the same object, and a
                // test proves no run crosses a box without re-deriving a single number.
                "data-mpd-box": (rank * GEO.column + graph.inset) + "," + nodeOf[task.id].top + "," + (GEO.column - graph.inset * 2) + "," + GEO.nodeHeight,
                // THE BOX'S RANK, published as its own value: `data-mpd-box` already carries it inside
                // the x coordinate, but a verifier comparing the served rank against the drawn rank
                // should not have to invert `rank * column + inset` to read it.
                "data-mpd-box-rank": String(rank),
                // A GHOST is a box the PLAN declared and the board does not. Published so a verifier can
                // tell it from a board task without inspecting the payload it came from.
                ...(task.planned === true ? { "data-mpd-planned": "true" } : {}),
                role: "button",
                tabIndex: 0,
                "aria-pressed": pinned === task.id,
                title: task.subject + (task.attempt === undefined ? "" : " · " + t("task.attempt") + " " + task.attempt),
                style: {
                  ...CSS.node,
                  // THE POSITION IS A TRANSFORM, not `left/top`, so a rank change is ANIMATED by the
                  // class's 420ms transition instead of jumping. The numbers are the LAYOUT's own:
                  // `left/top` zero the box inside its column, and `translate3d` carries the column's
                  // inset and the node's top — the same values `data-mpd-box` publishes below, so the
                  // asserted rectangle and the painted one cannot drift.
                  left: "0px",
                  top: "0px",
                  width: (GEO.column - graph.inset * 2) + "px",
                  transform: "translate3d(" + graph.inset + "px," + nodeOf[task.id].top + "px,0)",
                  borderColor: focusing && focus[task.id] !== true ? CSS.edge.background : toneOf(task.visual),
                  opacity: focusing && focus[task.id] !== true ? "0.4" : "1",
                  borderWidth: pinned === task.id ? "1px" : "0.5px",
                },
                  // THE HOVER CHAIN AND THE HOVER CARD LIVE ON THE NODE ITSELF: the host drives both
                  // with a real mouse move, so these handlers are the only writers — no document
                  // listener, no layout effect, and therefore nothing that can outlive this element.
                  //
                  // FOCUS DOES NOT OPEN THE CARD (D2 repair, Docker 2026-10-21): a FocusEvent has
                  // no `clientX/clientY`, so the old `onFocus` overwrote a real pointer anchor with
                  // the (14,14) fallback and parked the card in the viewport's top-left corner the
                  // moment a click focused the node. Keyboard access is the PIN (Enter/Space opens
                  // the detail body); `onBlur` still closes a card the pointer left open.
                  onMouseEnter: (event: unknown) => { if (setHover !== null) setHover(task.id); setTipState({ id: task.id, ...tipPoint(event) }) },
                  onMouseMove: (event: unknown) => { setTipState({ id: task.id, ...tipPoint(event) }) },
                  onMouseLeave: () => { if (setHover !== null) setHover(null); setTipState(null) },
                  onBlur: () => { setTipState(null) },
                  onClick: () => { if (setPinned !== null) setPinned(pinned === task.id ? null : task.id) },
                  onKeyDown: (event: { key?: string }) => {
                    if (event?.key !== "Enter" && event?.key !== " ") return
                    if (setPinned !== null) setPinned(pinned === task.id ? null : task.id)
                  },
                },
                react.createElement("div", { key: "node-top", style: CSS.nodeTop },
                  react.createElement("span", { key: "glyph", style: { color: toneOf(task.visual), fontWeight: 700 } }, glyphOf(task.visual)),
                  react.createElement("span", { key: "id", style: { fontWeight: 700 } }, task.id),
                  // THE LEGEND'S `<KIND>` IS ASCII (clause F1): the localized word belongs to the
                  // chrome (the pinned detail body), never to the CJK-free drawing plane.
                  react.createElement("span", { key: "kind", style: CSS.dim }, kindCodeOf(task.kind))),
                react.createElement("div", { key: "subject", style: { ...CSS.dim, marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, labelOf[task.id]),
                // The closers, in order: the node, the column's node map, the column, the grid's column
                // map, the grid, the padded wrapper, the graph element, and `children.push`.
                ))))))))
        }
        // THE HOVER CARD IS A SIBLING OF THE GRAPH, never a descendant: it portals to `document.body`
        // when the host supports that, and stays an inline `position: fixed` element otherwise. Either
        // way the raw subject it shows sits OUTSIDE the CJK-free drawing subtree, and the pinned task
        // makes the same card opaque (`data-pinned`) without a second component.
        if (tipTask !== undefined && tip !== null) children.push(tipCardOf(tipTask, tip, pinned === tipTask.id, clock))
        if (pinnedTask !== undefined) children.push(detailSection(pinnedTask, tasks, current.contracts[pinnedTask.id], state.model?.edges))
        for (const problem of state.problems) {
          children.push(react.createElement("div", { key: "p-" + problem, style: { ...CSS.dim, marginTop: "6px" } }, problem))
        }
        return react.createElement("div", { "data-mpd-team-tab": team.id, style: CSS.panel }, children)
      }

      return { TeamView, start, read, layout, graphSafeLabel, curveOf, overlapAudit, formatElapsed }
    },
  }
}
