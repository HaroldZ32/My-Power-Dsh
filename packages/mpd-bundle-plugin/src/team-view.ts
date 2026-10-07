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
    /** Longest dependency path; the column the node is drawn in. */
    depth: number
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
    /** The grid's own height in pixels: the tallest column, never zero. */
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
    /** How many rows each rank's column holds: its boxes plus the rows reserved for long edges. */
    slots: number[]
    /**
     * Where the ranks came from: `true` when they were DERIVED from the `blockedBy` graph, `false`
     * when the graph resolved no blocker at all and the served `depth` was the only signal left.
     */
    ranksDerived: boolean
    /**
     * Blocker references nothing on this board carries, sorted and de-duplicated.
     *
     * THE UNION OF TWO SOURCES: the record's own `unresolvedBlockers` report and the view's
     * re-derivation over the served `blockedBy`. They agree on a board the current producer wrote, and
     * they differ exactly where it matters — a record whose references were repaired after the fact
     * still remembers what did not resolve, and a viewer must not be told it is all fine.
     *
     * NOT decorative: the served records really do carry them — our live board's `blockedBy` holds plan
     * ordinals while its ids are `T1..T10` — and the store silently filters them out, so a page can only
     * stop that data loss from being invisible if the view hands the list on.
     */
    unresolved: string[]
    /** The subset of {@link unresolved} the RECORD ITSELF reports; empty when the payload carries none. */
    unresolvedRecorded: string[]
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
    // edges routed against it. The node's background is OPAQUE so that a run can only ever be hidden
    // by a box, never show through it.
    node: { position: "absolute", boxSizing: "border-box", height: "42px", overflow: "hidden", cursor: "pointer", border: "0.5px solid var(--dsw-alias-border-l2, #d8dde5)", borderRadius: "var(--dsw-radius-sm, 4px)", padding: "3px 5px", background: "var(--dsw-alias-bg-layer-1, #ffffff)", fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)", fontSize: "10px", lineHeight: 1.3 },
    nodeTop: { display: "flex", gap: "4px", alignItems: "baseline", whiteSpace: "nowrap", overflow: "hidden" },
  }

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
  /** The y of a box's top, from its row inside the column — the SAME expression the node renders with. */
  const boxTop = (row: number): number => GEO.pad + row * (GEO.nodeHeight + GEO.nodeGap)
  /** The y of a box's vertical MIDDLE, which is where an edge attaches. */
  const boxMiddle = (row: number): number => boxTop(row) + GEO.nodeHeight / 2
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
     * @param deps - the React surface, the routes, the poll interval and the host's translator.
     * @returns the view component, its poller and the DAG layout the panel draws with.
     */
    createTeamView(deps: { react: ReactSurface; statePath: string; planPath?: string; taskPath?: string; pollMs?: number; t?: Translator }): {
      /** The component; the host calls it with ITS own props, which this view ignores but tolerates. */
      TeamView: (props?: unknown) => unknown
      /** Start polling for one session; returns a stop function the caller owns. */
      start: (sessionId: string, publish: (next: TeamStore) => void) => () => void
      /** Read the routes once, resolving to the payloads or a failure. */
      read: (sessionId: string) => Promise<TeamStore>
      /** The DAG geometry of one board, exposed so the layout is provable without rendering. */
      layout: (tasks: TeamTask[], radius?: number) => GraphGeometry
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
    } {
      /** The dependencies this closure reads on every call, plus the plan and task routes when given. */
      const { react, statePath, planPath, taskPath } = deps
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

      /** Poll until stopped; the interval is owned by the CALLER's effect. */
      /** Start polling; the returned function stops it. */
      /** Start polling; the returned function stops it. */
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
        return () => { live = false; clearInterval(timer) }
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
      /** The glyph of one rendered state; `?` is honest about a state this view has never seen. */
      const glyphOf = (visual: string): string => GLYPH[visual] ?? "?"
      /** The bilingual kind abbreviation of one task; empty when the task carries no kind. */
      const kindOf = (kind: string | undefined): string => {
        if (kind === undefined || kind === "") return ""
        /** The dictionary key this kind resolves through, when it is one of the five. */
        const key = KIND_KEY[kind]
        return key === undefined ? kind : t(key)
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
       * Compute the whole DAG geometry from the board alone: rank columns, node boxes, and every
       * drawn edge ROUTED as a chain of adjacent-rank hops.
       *
       * `depth` is already the longest dependency path, so the columns are correct without re-deriving
       * a layout; a negative or non-finite depth falls back to rank 0 rather than dropping the task.
       * Every box is fixed, which is what lets an edge be arithmetic instead of a measurement.
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
       *   1. DUMMY ROWS. An edge spanning more than one rank is expanded into a chain of adjacent-rank
       *      hops, one reserved row per intermediate rank. Nothing occupies that row, so each hop runs
       *      along a real corridor: the vertical runs stand in the gutters between columns and every
       *      crossing of an intermediate column happens at the reserved row. No edge can cross a box.
       *   2. A MEASURED GUTTER. The box inset is derived from the busiest gutter's lane count, so the
       *      gutter is wide enough for every lane; the spacing is then computed FROM that gutter. Two
       *      lanes can never share a column — and a lane that cannot be given one is COUNTED in
       *      `laneOverflow` rather than silently stacked.
       *   3. THE ROUTES TRAVEL OUT OF THIS FUNCTION, so the render paints them and a test can assert
       *      them: the geometry is one object, and `data-mpd-box`/`data-mpd-route` publish it.
       * @param tasks - the board, in the order the route served it.
       * @param radius - the corner radius the painted curves are built with, defaulting to
       *   {@link EDGE_RADIUS}; `0` is clause W6's control and emits the straight orthogonal polyline.
       * @returns the columns, the canvas size, every node's box and every routed edge.
       */
      const layout = (tasks: TeamTask[], radius: number = EDGE_RADIUS): GraphGeometry => {
        // ── R20: THE RANK IS DERIVED FROM THE `blockedBy` GRAPH, NOT TRUSTED FROM `depth` ──────────
        // WHAT WAS WRONG, and it is the defect the user photographed: this function bucketed the
        // columns by `task.depth` verbatim. `team-store.ts` resolves a blocker by exact task id or
        // exact subject and otherwise returns the reference UNCHANGED, and its `taskDepths` then
        // FILTERS the unresolvable ones out — so on our own live board (ids `T1..T10`, `blockedBy`
        // holding plan ordinals `["2"]`, `["2","3","4","6"]`, …) every task became a root, every depth
        // became 0, and the view drew ONE column with NO edges. A view that trusts that number
        // reproduces the lie; the TUI sibling (`mpd-tui-plugin/src/graph.ts`) already derives it, and
        // the two planes must agree or the same record reads differently in the sidebar and the
        // terminal. This is the same algorithm, inline because this file is ONE factory expression.
        /** Task lookup by id, so a blocker reference can be resolved at all. */
        const byId: Record<string, TeamTask> = {}
        for (const task of tasks) byId[task.id] = task
        /** A task's blocker references; a record may carry none at all, or carry something else. */
        const blockedOf = (task: TeamTask): string[] => (Array.isArray(task.blockedBy) ? task.blockedBy : [])
        /** Every blocker reference no task on the board carries, which is REPORTED rather than dropped. */
        const missing = new Set<string>()
        /** How many blocker references DO resolve to a task on the board. */
        let resolved = 0
        for (const task of tasks) {
          for (const reference of blockedOf(task)) {
            if (byId[reference] === undefined) missing.add(reference)
            else resolved += 1
          }
        }
        // THE UNRESOLVED REFERENCES ARE A RESULT, NOT A LOG LINE: the store's silent filter is what
        // produced the one-column board, so the view hands the list on (the page reports the count).
        // AND THE RECORD'S OWN REPORT IS READ BESIDE THE VIEW'S RE-DERIVATION (R18's reader side): the
        // producer stores what matched nothing at write time in `unresolvedBlockers`, a fact that
        // survives a later repair of the references — the live board was repaired that way — so a
        // viewer must see BOTH: what the record said then, and what the served references say now.
        /** The references the RECORD itself reports, task by task; empty when the payload carries none. */
        const recorded = new Set<string>()
        for (const task of tasks) {
          for (const reference of Array.isArray(task.unresolvedBlockers) ? task.unresolvedBlockers : []) recorded.add(reference)
        }
        /** The record's own report, sorted and de-duplicated. */
        const unresolvedRecorded = [...recorded].sort()
        /** The blocker references that resolve to nothing, from the record AND from the board. */
        const unresolved = [...new Set([...unresolvedRecorded, ...missing])].sort()
        /** The rank a served `depth` claims; a negative or non-finite depth is a root. */
        const servedRank = (task: TeamTask): number => (Number.isFinite(task.depth) && task.depth > 0 ? Math.floor(task.depth) : 0)
        /** Whether the served depths claim any structure at all. */
        const servedVaries = new Set(tasks.map((task) => servedRank(task))).size > 1
        // THE DERIVATION WINS; THE SERVED DEPTH IS THE NARROW FALLBACK, exactly as in the TUI engine: it
        // draws only when NOT ONE reference resolves AND the served depths still vary, i.e. when the
        // record knows about structure its references cannot express. Both arms matter — a genuinely
        // flat board served flat draws flat, and our broken board (nothing resolves, every depth 0, so
        // they do NOT vary) falls through to the derivation.
        /** Whether the ranks were DERIVED; `false` means the served depth was the only signal left. */
        const derived = !(resolved === 0 && servedVaries)
        /** The rank every task draws in. */
        const rankOf = new Map<string, number>()
        if (!derived) {
          for (const task of tasks) rankOf.set(task.id, servedRank(task))
        } else {
          /** The settled rank of every task. */
          const settled = new Map<string, number>()
          /** The tasks on the current walk, whose ranks are not settled yet. */
          const walking = new Set<string>()
          for (const root of tasks) {
            if (settled.has(root.id)) continue
            /** The walk's frames: the id, and how many of its blockers have been expanded. */
            const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }]
            walking.add(root.id)
            while (stack.length > 0) {
              /** The frame being worked. */
              const frame = stack[stack.length - 1]
              /** This task's blocker references that RESOLVE to a task on the board. */
              const blocked = blockedOf(byId[frame.id]).filter((reference) => byId[reference] !== undefined)
              if (frame.next < blocked.length) {
                /** The next blocker to expand. */
                const dependency = blocked[frame.next]
                frame.next += 1
                // A blocker already on the walk closes a CYCLE: it contributes nothing, so the walk
                // neither recurses nor settles it twice — and every rank stays finite.
                if (settled.has(dependency) || walking.has(dependency)) continue
                walking.add(dependency)
                stack.push({ id: dependency, next: 0 })
                continue
              }
              /** The longest chain under this task, one longer than its deepest blocker. */
              let deepest = 0
              for (const dependency of blocked) deepest = Math.max(deepest, (settled.get(dependency) ?? 0) + 1)
              settled.set(frame.id, deepest)
              walking.delete(frame.id)
              stack.pop()
            }
          }
          for (const task of tasks) rankOf.set(task.id, settled.get(task.id) ?? 0)
        }
        /** The board bucketed by rank, which is the graph's column axis. */
        const columns: TeamTask[][] = []
        for (const task of tasks) {
          /** The rank this task draws in, per the plan above — never a value off the record. */
          const at = Math.max(0, rankOf.get(task.id) ?? 0)
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
        /** Every node's box, before the reserved rows are known — its `row` is final, its `top` is not. */
        const nodes: GraphNode[] = []
        for (let rank = 0; rank < columns.length; rank += 1) {
          for (let row = 0; row < columns[rank].length; row += 1) {
            nodes.push({ task: columns[rank][row], rank, row, ordinal: ordinalOf[columns[rank][row].id] ?? 0, top: boxTop(row) })
          }
        }
        /** The node each task id names, so an edge resolves both of its boxes in one lookup. */
        const nodeOf: Record<string, GraphNode> = {}
        for (const node of nodes) nodeOf[node.task.id] = node

        // ── THE DEPENDENCIES TO DRAW ──────────────────────────────────────────────────────────────
        // One per `blockedBy` entry naming a task ON THIS BOARD. An id the board does not carry draws
        // NOTHING: the payload serves the list raw, so a ghost entry is reachable in real data, and an
        // edge into a node that is not there would be a picture of a dependency the record lacks.
        /** The dependencies to route, in board order. */
        const wants: Array<{ parent: GraphNode; child: GraphNode; key: string }> = []
        for (const node of nodes) {
          // A RECORD MAY CARRY NO BLOCKER LIST AT ALL (a minimal fixture, an older payload), so the
          // list is read defensively rather than trusted to be an array.
          /** This task's blocker references, empty when the record carries none. */
          const blocked = Array.isArray(node.task.blockedBy) ? node.task.blockedBy : []
          for (const blockerId of blocked) {
            /** The blocker's own box; a blocker the board does not carry draws no edge. */
            const parent = nodeOf[blockerId]
            if (parent === undefined) continue
            wants.push({ parent, child: node, key: parent.task.id + ">" + node.task.id })
          }
        }

        // ── DUMMY ROWS: one reserved row per (long edge × intermediate rank) ──────────────────────
        /** The reserved row each long edge owns in each rank it crosses. */
        const reserved = new Map<string, Map<number, number>>()
        /** How many rows each rank's column must hold: its boxes, plus the rows reserved inside it. */
        const slots: number[] = columns.map((column) => column.length)
        for (const want of wants) {
          /** The lower rank this edge touches. */
          const lo = Math.min(want.parent.rank, want.child.rank)
          /** The higher rank it touches. */
          const hi = Math.max(want.parent.rank, want.child.rank)
          if (hi - lo < 2) continue
          /** This edge's own reserved rows, one per rank strictly between its two ends. */
          const mine = reserved.get(want.key) ?? new Map<number, number>()
          for (let rank = lo + 1; rank < hi; rank += 1) {
            mine.set(rank, slots[rank])
            slots[rank] += 1
          }
          reserved.set(want.key, mine)
        }

        // ── LANES: one per hop, per gutter, always distinct ──────────────────────────────────────
        /** The edge keys crossing each gutter, gutter by gutter, in board order. */
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
        /** The lane index each edge takes in each gutter. */
        const laneIndex = new Map<string, number>()
        /** How many lanes the busiest gutter must carry, which is what sizes the inset. */
        let maxLanes = 0
        for (let rank = 0; rank < crossing.length; rank += 1) {
          maxLanes = Math.max(maxLanes, crossing[rank].length)
          crossing[rank].forEach((key, index) => laneIndex.set(rank + "@" + key, index))
        }
        // THE GUTTER IS DERIVED FROM THE LANES, not written down: a box keeps `inset` on each side of
        // its column, two neighbouring boxes therefore stand `2 * inset` apart, and the busiest gutter
        // asks for enough of that room to give every lane its preferred spacing plus a clearance.
        /** The inset every box keeps inside its column at this board's lane count. */
        const inset = Math.max(GEO.inset, Math.min(MAX_INSET, Math.ceil((maxLanes * LANE_STEP + LANE_CLEARANCE * 2) / 2)))
        /** The measured gutter between two neighbouring columns' boxes. */
        const gutter = inset * 2
        /** How far a lane may stand from a gutter's centre and still clear both boxes. */
        const halfBand = Math.max(0, inset - LANE_CLEARANCE)
        /** The most lanes one gutter can hold as DISTINCT columns at one pixel apart. */
        const capacity = halfBand * 2 + 1
        /** How many hops could not be given a distinct column, which a page must be able to report. */
        let laneOverflow = 0
        for (const keys of crossing) laneOverflow += Math.max(0, keys.length - capacity)
        // A same-rank dependency has no gutter between its ends, so it runs around the RIGHT of its
        // column, in the inset space no box occupies. Its lanes are counted here so an overflow there
        // is reported on the same terms.
        for (const keys of levelKeys) laneOverflow += Math.max(0, keys.length - halfBand)

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
          /** The x the edge leaves the blocker's own border at, at that border's middle. */
          const fromX = forward ? rightOf(want.parent.rank) : leftOf(want.parent.rank)
          /** The x it arrives at on the blocked task's border. */
          const toX = level ? rightOf(want.child.rank) : forward ? leftOf(want.child.rank) : rightOf(want.child.rank)
          /** The y it leaves at: the blocker's vertical middle. */
          const fromY = boxMiddle(want.parent.row)
          /** The y it arrives at: the blocked task's vertical middle. */
          const toY = boxMiddle(want.child.row)
          /** The reserved rows this edge owns, empty for an adjacent-rank edge. */
          const mine = reserved.get(want.key)
          /** The painted runs, in draw order. */
          const segments: Array<{ key: string; rect: EdgeRect }> = []
          /** The x the path currently stands at, starting on the blocker's border. */
          let x = fromX
          /** The y the path currently stands at, starting at the blocker's middle. */
          let y = fromY
          /** How many vertical runs have been painted, which numbers their keys. */
          let risers = 0
          /** How many intermediate-column crossings have been painted, which numbers their keys. */
          let crossings = 0
          /**
           * The route's own VERTICES, in travel order, starting on the blocker's border.
           *
           * Recorded here because this is where the route is walked: the painted curve is a
           * parametrisation of THESE points, never a second routing of its own, so a change to a lane or
           * a reserved row moves the picture and the assertion together.
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
          if (level) {
            // A SAME-RANK DEPENDENCY: no gutter lies between its ends, so the path leaves the blocker's
            // right border, steps into the inset space to the RIGHT of the column — which no box
            // occupies — runs down to the blocked task's row and comes back in on its right border.
            /** This edge's own slot in that inset space. */
            const slot = Math.max(0, Math.min(Math.max(0, halfBand - 1), levelKeys[want.parent.rank].indexOf(want.key)))
            /** The x that slot stands at, one clearance off the column's own boxes. */
            const lane = rightOf(want.parent.rank) + LANE_CLEARANCE + slot
            segments.push({ key: "out", rect: run(x, lane, y) })
            mark({ x: lane, y })
            segments.push({ key: "riser", rect: runV(lane, y, toY) })
            mark({ x: lane, y: toY })
            x = lane
            y = toY
          } else {
            /** The gutters this path walks, in walk order: downhill forward, uphill for a back edge. */
            const walk: number[] = []
            for (let rank = Math.min(want.parent.rank, want.child.rank); rank < Math.max(want.parent.rank, want.child.rank); rank += 1) walk.push(rank)
            if (!forward) walk.reverse()
            for (let index = 0; index < walk.length; index += 1) {
              /** The gutter this hop's vertical run stands in. */
              const lane = laneX(walk[index], want.key)
              // The horizontal run that reaches the lane: the LEAD-OUT leaves the blocker's border, and
              // a later one crosses an intermediate column at the row reserved in it — which is the
              // whole point of the reservation, and why no horizontal can meet a box.
              if (risers === 0) segments.push({ key: "out", rect: run(x, lane, y) })
              else {
                crossings += 1
                segments.push({ key: "cross" + crossings, rect: run(x, lane, y) })
              }
              mark({ x: lane, y })
              /** The y this hop ends at: the blocked task's middle last, a reserved row in between. */
              const next = index === walk.length - 1
                ? toY
                : boxMiddle(mine?.get(forward ? walk[index] + 1 : walk[index]) ?? 0)
              risers += 1
              segments.push({ key: risers === 1 ? "riser" : "riser" + risers, rect: runV(lane, y, next) })
              mark({ x: lane, y: next })
              x = lane
              y = next
            }
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

        /** The tallest column's slot count, which is how tall the grid must be. */
        let tallest = 0
        for (const count of slots) tallest = Math.max(tallest, count)
        return {
          columns,
          rankCount,
          width: rankCount * GEO.column,
          height: Math.max(tallest * (GEO.nodeHeight + GEO.nodeGap) - GEO.nodeGap + GEO.pad * 2, GEO.nodeHeight + GEO.pad * 2),
          gridTemplateColumns: "repeat(" + rankCount + ", " + GEO.column + "px)",
          nodes,
          edges,
          inset,
          gutter,
          maxLanes,
          laneOverflow,
          slots,
          ranksDerived: derived,
          unresolved,
          unresolvedRecorded,
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
       * @param tasks - the board.
       * @param from - the hovered task's id.
       * @param rankOf - the rank each task was DRAWN in, straight off the geometry's own nodes.
       * @returns the ids to tint; every other node is dimmed while a focus is held.
       */
      const focusChain = (tasks: TeamTask[], from: string, rankOf: Record<string, number>): Record<string, boolean> => {
        /** The task each id names, for the dependency lookups below. */
        const byId: Record<string, TeamTask> = {}
        for (const task of tasks) byId[task.id] = task
        /** The ids in the halo so far. */
        const focus: Record<string, boolean> = {}
        if (byId[from] === undefined) return focus
        /** What rests on each task, which is `blockedBy` read backwards. */
        const dependentsOf: Record<string, string[]> = {}
        for (const task of tasks) {
          for (const blockerId of task.blockedBy) {
            if (dependentsOf[blockerId] === undefined) dependentsOf[blockerId] = []
            dependentsOf[blockerId].push(task.id)
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
          for (const blockerId of byId[id].blockedBy) {
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
       * @returns the edge's group, its path and its arrival arrowhead.
       */
      const edgeOf = (edge: DrawnEdge, tinted: boolean): unknown => {
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
       * @param tasks - the whole board, for the dependents lookup.
       * @param contract - the frozen contract of this task, when the route served one.
       * @returns the detail element.
       */
      const detailSection = (task: TeamTask, tasks: TeamTask[], contract: { description: string; claimedBy: string; claimedAt: string; attempt: number } | undefined): unknown => {
        /** The tasks resting on this one, which is the reverse of `blockedBy`. */
        const dependents: string[] = []
        for (const other of tasks) if (other.blockedBy.indexOf(task.id) >= 0) dependents.push(other.id)
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
        rows.push(detailRow("d-blocked", "task.blockedBy", task.blockedBy.length === 0 ? "—" : task.blockedBy.join(", ")))
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
        // The handlers below are closures of THIS render, so they always write through this render's
        // setters; the factory-scope names are what the detail body and the edges reach.
        setPinned = setPinnedState as (next: string | null) => void
        setHover = setHoverState as (next: string | null) => void
        /** The store, narrowed out of the tuple above. */
        const current = store as TeamStore
        /** The last readable payload, or null while there is none. */
        const state = current.state
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
        /** The DAG geometry of this poll's board. */
        const graph = layout(tasks)
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
        // than the columns draw: the node's own `rank` IS the derived rank (R20), never the served value.
        /** The drawn rank of every task, straight off the geometry. */
        const drawnRank: Record<string, number> = {}
        for (const node of graph.nodes) drawnRank[node.task.id] = node.rank
        // THE TALLY SAYS WHAT A CAPTAIN ACTS ON, not just how far along the board is: how many tasks
        // a member could pick up RIGHT NOW, and how many of those are only ready because a
        // prerequisite FAILED (OPT-1 releases them, and that must not hide inside "ready").
        /** The line a captain reads: what is moving, what is pickable, what is held. */
        const tally = counts.running + " " + t("tally.running") + " · " + counts.ready + " " + t("tally.ready")
          + " · " + counts.blocked + " " + t("tally.blocked")
          + (counts.releasedByFailure === 0 ? "" : " · " + counts.releasedByFailure + " " + t("tally.released"))
        /** The focus halo of the hovered node — empty while nothing is hovered, so every node is full. */
        const focus: Record<string, boolean> = hover === null ? {} : focusChain(tasks, hover as string, drawnRank)
        /** Whether a hover is dimming the rest of the board. */
        const focusing = Object.keys(focus).length > 0
        // A CHAIN IS ACTIVE ONLY WITH A RELATED NODE: a hover whose halo holds nothing beyond the
        // hovered task itself relates to nothing, and a reader that counted that as a chain would be
        // reading a highlight that tinted one node and dimmed no other.
        /** Whether the hovered node's halo reaches at least one other node. */
        const chainActive = focusing && Object.keys(focus).length > 1
        /** The drawn edges, PAINTED FROM THE LAYOUT'S OWN ROUTES: one per dependency on the board. */
        // A `blockedBy` id the board does not carry draws NOTHING: the payload serves the list raw,
        // while the rank projection drops unknown ids, so an entry naming a ghost is reachable in real
        // data — and an edge into a node that is not there would be a picture of a dependency that the
        // record does not have. The layout already applied that rule, so the count here is the count
        // the `data-mpd-graph` witness announces.
        const edges: unknown[] = []
        for (const edge of graph.edges) {
          // THE TINT IS A HOVER FACT, so it is decided here and not in the geometry: an edge reads
          // brighter only while BOTH of its ends are inside the halo, which is what makes a chain
          // readable as a path rather than as two unrelated highlights.
          edges.push(edgeOf(edge, focus[edge.parent] === true && focus[edge.child] === true))
        }
        /** The pinned task's own record, or undefined when the pinned id left the board. */
        const pinnedTask = pinned === null ? undefined : tasks.find((candidate) => candidate.id === pinned)
        /** The panel's elements, in render order. */
        const children: unknown[] = [
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
              }, edges),
              graph.columns.map((column, rank) => react.createElement("div", {
                key: "col-" + rank,
                "data-mpd-rank": String(rank),
                style: { ...CSS.column, width: GEO.column + "px", height: graph.height + "px" },
              },
              column.map((task, row) => react.createElement("div", {
                key: "node-" + task.id,
                "data-mpd-node": task.id,
                // THE BOX'S OWN RECTANGLE, published so the geometry can be ASSERTED from what was
                // actually rendered: an edge's runs and every box come out of the same object, and a
                // test proves no run crosses a box without re-deriving a single number.
                "data-mpd-box": (rank * GEO.column + graph.inset) + "," + boxTop(row) + "," + (GEO.column - graph.inset * 2) + "," + GEO.nodeHeight,
                role: "button",
                tabIndex: 0,
                "aria-pressed": pinned === task.id,
                title: task.subject + (task.attempt === undefined ? "" : " · " + t("task.attempt") + " " + task.attempt),
                style: {
                  ...CSS.node,
                  // THE INSET IS THE LAYOUT'S, not the stylesheet's: it is the width the busiest
                  // gutter's lanes were paid for out of, so a fixed 4px here would detach every box
                  // from the geometry the edges were routed against.
                  left: graph.inset + "px",
                  right: graph.inset + "px",
                  top: boxTop(row) + "px",
                  borderColor: focusing && focus[task.id] !== true ? CSS.edge.background : toneOf(task.visual),
                  opacity: focusing && focus[task.id] !== true ? "0.4" : "1",
                  borderWidth: pinned === task.id ? "1px" : "0.5px",
                },
                  // THE HOVER CHAIN LIVES ON THE NODE ITSELF: the host drives it with a real mouse move,
                  // so `onMouseEnter`/`onMouseLeave` here are the only writers — no document listener,
                  // no layout effect, and therefore nothing that can outlive this element.
                  onMouseEnter: () => { if (setHover !== null) setHover(task.id) },
                  onMouseLeave: () => { if (setHover !== null) setHover(null) },
                  onClick: () => { if (setPinned !== null) setPinned(pinned === task.id ? null : task.id) },
                  onKeyDown: (event: { key?: string }) => {
                    if (event?.key !== "Enter" && event?.key !== " ") return
                    if (setPinned !== null) setPinned(pinned === task.id ? null : task.id)
                  },
                },
                react.createElement("div", { key: "node-top", style: CSS.nodeTop },
                  react.createElement("span", { key: "glyph", style: { color: toneOf(task.visual), fontWeight: 700 } }, glyphOf(task.visual)),
                  react.createElement("span", { key: "id", style: { fontWeight: 700 } }, task.id),
                  react.createElement("span", { key: "kind", style: CSS.dim }, kindOf(task.kind))),
                react.createElement("div", { key: "subject", style: { ...CSS.dim, marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, labelOf[task.id]),
                // The closers, in order: the node, the column's node map, the column, the grid's column
                // map, the grid, the padded wrapper, the graph element, and `children.push`.
                ))))))))
        }
        if (pinnedTask !== undefined) children.push(detailSection(pinnedTask, tasks, current.contracts[pinnedTask.id]))
        for (const problem of state.problems) {
          children.push(react.createElement("div", { key: "p-" + problem, style: { ...CSS.dim, marginTop: "6px" } }, problem))
        }
        return react.createElement("div", { "data-mpd-team-tab": team.id, style: CSS.panel }, children)
      }

      return { TeamView, start, read, layout, graphSafeLabel, curveOf }
    },
  }
}
