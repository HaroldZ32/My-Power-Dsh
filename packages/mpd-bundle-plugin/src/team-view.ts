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
    /** Blockers that FAILED — reported BESIDE the state, which is the OPT-1 rule. */
    failedBy: string[]
    /** Longest dependency path; the column the node is drawn in. */
    depth: number
  }

  /** The payload the route serves. */
  interface TeamState {
    /** The route's own success marker. */
    ok?: boolean
    /** The workspace the record was read from. */
    workspace?: string
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
    /** Its offset from the column's top edge. */
    top: number
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
    node: { position: "absolute", left: "4px", right: "4px", boxSizing: "border-box", height: "42px", overflow: "hidden", cursor: "pointer", border: "0.5px solid var(--dsw-alias-border-l2, #d8dde5)", borderRadius: "var(--dsw-radius-sm, 4px)", padding: "3px 5px", background: "var(--dsw-alias-bg-layer-1, transparent)", fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)", fontSize: "10px", lineHeight: 1.3 },
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

  /** The width of one rank column, in pixels — the whole "measuring pass" is this constant. */
  const COLUMN_W = 168
  /** How far a node's box sits inside its column, per side. */
  const NODE_INSET = 4
  /** One node box's height. */
  const NODE_H = 42
  /** The vertical gap between two nodes of one column. */
  const NODE_GAP = 10
  /** The vertical padding at the top and bottom of every column. */
  const COLUMN_PAD = 4
  /** How far an edge's lead-in and lead-out reach into the gap between two columns. */
  const EDGE_LEAD = 24
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
      layout: (tasks: TeamTask[]) => GraphGeometry
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
       * Compute the whole DAG geometry from the board alone: rank columns, node boxes, and the numbers
       * the drawn edges are placed with.
       *
       * `depth` is already the longest dependency path, so the columns are correct without re-deriving
       * a layout; a negative or non-finite depth falls back to rank 0 rather than dropping the task.
       * Every box is fixed, which is what lets an edge be arithmetic instead of a measurement.
       * @param tasks - the board, in the order the route served it.
       * @returns the columns, the canvas size and every node's box.
       */
      const layout = (tasks: TeamTask[]): GraphGeometry => {
        /** The board bucketed by rank, which is the graph's column axis. */
        const columns: TeamTask[][] = []
        for (const task of tasks) {
          /** The rank this task draws in; a negative or unknown depth falls back to the first. */
          const at = Number.isFinite(task.depth) && task.depth >= 0 ? task.depth : 0
          while (columns.length <= at) columns.push([])
          columns[at].push(task)
        }
        /** The grid's width in columns: one per rank, never zero. */
        const rankCount = Math.max(columns.length, 1)
        /** The tallest column, which is how tall the grid must be. */
        let tallest = 0
        for (const column of columns) tallest = Math.max(tallest, column.length)
        /** Every node's box, in column-major order. */
        const nodes: GraphNode[] = []
        for (let rank = 0; rank < columns.length; rank += 1) {
          for (let row = 0; row < columns[rank].length; row += 1) {
            nodes.push({ task: columns[rank][row], rank, row, top: COLUMN_PAD + row * (NODE_H + NODE_GAP) })
          }
        }
        return {
          columns,
          rankCount,
          width: rankCount * COLUMN_W,
          height: Math.max(tallest * (NODE_H + NODE_GAP) - NODE_GAP + COLUMN_PAD * 2, NODE_H + COLUMN_PAD * 2),
          gridTemplateColumns: "repeat(" + rankCount + ", " + COLUMN_W + "px)",
          nodes,
        }
      }

      /**
       * The transitive halo of one task: the hovered node, its ANCESTORS (what it rests on) and its
       * DESCENDANTS (what rests on it), along the drawn dependency edges.
       *
       * A chain is a RANK-MONOTONE path over the drawn edges: every hop to the left climbs to a strictly
       * lower `depth`, every hop to the right descends to a strictly higher one. That is the relation the
       * columns draw, and it is the only one that survives a diamond. Measured: walking the edges alone
       * lit `T1 → T2 → T3 → T4` up entirely when T2 was hovered, because T3 (a legitimate descendant) then
       * handed the walk its own dependent T4 — and a walk that let the two directions feed each other did
       * the same the other way round. The origin is the ONE exception, because a cycle resolves a
       * revisited node to rank 0, so a back-edge genuinely runs between two nodes of the same rank.
       *
       * Each frontier is worked as a QUEUE rather than a recursion, and `inHalo` holds it to one visit
       * per node, so a dependency cycle in the payload — which the route reports rather than repairs —
       * cannot spin this into a stack overflow.
       * @param tasks - the board.
       * @param from - the hovered task's id.
       * @returns the ids to tint; every other node is dimmed while a focus is held.
       */
      const focusChain = (tasks: TeamTask[], from: string): Record<string, boolean> => {
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
            // Strictly to the left — never a step back to the right, which is what keeps a cousin out.
            if (parent.depth >= byId[id].depth && !atOrigin && blockerId !== from) continue
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
            if (child.depth <= byId[id].depth && !atOrigin && childId !== from) continue
            seenDown[childId] = true
            focus[childId] = true
            down.push(childId)
          }
        }
        return focus
      }

      /**
       * The one drawn edge of a `blockedBy` entry: a horizontal lead-out, a vertical riser, a horizontal
       * lead-in. Three plain absolutely-positioned divs — no SVG, no measuring pass.
       * @param parent - the blocker's node box.
       * @param child - the dependant's node box.
       * @param tinted - whether this edge is inside the hover focus chain.
       * @returns the edge element and its three segments.
       */
      const edgeOf = (parent: GraphNode, child: GraphNode, tinted: boolean | undefined): unknown => {
        // The riser sits in the gap between the two columns, so it never crosses a node in either.
        //
        // MEASURED 2026-10-06, and this is why the two ends are computed rather than assumed: an edge
        // normally runs parent → child (the blocker in an EARLIER rank), but a dependency CYCLE produces
        // a back-edge whose parent sits in a LATER rank. The first shape fixed each horizontal stub at
        // `EDGE_LEAD` px from its own node, so on a back-edge neither stub reached the riser and the edge
        // drew as two disconnected dashes — non-negative and therefore contract-conformant, but not a
        // line a reader can follow. Both stubs now END AT the riser, so the path connects in either
        // direction without changing any width from what the contract already required.
        const riserX = child.rank * COLUMN_W - EDGE_LEAD
        /** The lead-out's left edge: the blocker column's right inset, where its node box ends. */
        const outLeft = parent.rank * COLUMN_W + COLUMN_W - NODE_INSET - EDGE_LEAD
        /** Which column's boundary the edge leaves from; the child's gap on a back-edge. */
        const leadOutLeft = outLeft < riserX ? outLeft : riserX + 1
        /** Where the arriving stub starts, measured back from the node it reaches. */
        const leadInLeft = riserX
        /** The blocker's vertical centre, where the edge leaves it. */
        const outY = parent.top + NODE_H / 2
        /** The dependant's vertical centre, where the edge arrives. */
        const inY = child.top + NODE_H / 2
        /** The riser's own box: between the two horizontal centres, however they are ordered. */
        const riserTop = Math.min(outY, inY)
        /** The colour every segment of this edge draws in; a focused edge reads brighter. */
        const base = tinted === true ? FOCUS_EDGE : CSS.edge.background
        /** One segment's style: the shared edge box, this edge's colour, then its own geometry. */
        const segment = (left: number, top: number, width: number, height: number): Record<string, string> =>
          ({ ...CSS.edge, background: base, left: left + "px", top: top + "px", width: width + "px", height: height + "px" })
        return react.createElement("div", {
          key: "edge:" + parent.task.id + ">" + child.task.id,
          // THE WITNESSABLE MARK: `capture.mts` (docker/ui) reads `data-mpd-edge` and counts `data-mpd-graph`'s
          // `edges=` against exactly these, so one edge per DRAWN dependency is what must appear here.
          "data-mpd-edge": child.task.id + "<-" + parent.task.id,
          style: CSS.edgeLayer,
        },
          react.createElement("div", { key: "out", style: segment(leadOutLeft, outY, Math.max(riserX - leadOutLeft + 1, 1), 1) }),
          react.createElement("div", { key: "riser", style: segment(riserX, riserTop, 1, Math.max(Math.abs(inY - outY), 1)) }),
          react.createElement("div", { key: "in", style: segment(leadInLeft, inY, EDGE_LEAD, 1) }),
        )
      }

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
        if (contract === undefined) {
          rows.push(react.createElement("div", { key: "d-contract-none", style: { ...CSS.dim, marginTop: "4px" } }, t("task.contract.none")))
        } else {
          rows.push(react.createElement("div", { key: "d-contract-head", style: CSS.subHead }, t("task.contract")))
          rows.push(react.createElement("div", { key: "d-contract", style: { ...CSS.card, marginTop: "2px", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, contract.description))
        }
        return react.createElement("div", { key: "task-detail", "data-mpd-detail": task.id, style: { marginTop: "10px" } }, rows)
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
        // THE TALLY SAYS WHAT A CAPTAIN ACTS ON, not just how far along the board is: how many tasks
        // a member could pick up RIGHT NOW, and how many of those are only ready because a
        // prerequisite FAILED (OPT-1 releases them, and that must not hide inside "ready").
        /** The line a captain reads: what is moving, what is pickable, what is held. */
        const tally = counts.running + " " + t("tally.running") + " · " + counts.ready + " " + t("tally.ready")
          + " · " + counts.blocked + " " + t("tally.blocked")
          + (counts.releasedByFailure === 0 ? "" : " · " + counts.releasedByFailure + " " + t("tally.released"))
        /** The focus halo of the hovered node — empty while nothing is hovered, so every node is full. */
        const focus: Record<string, boolean> = hover === null ? {} : focusChain(tasks, hover as string)
        /** Whether a hover is dimming the rest of the board. */
        const focusing = Object.keys(focus).length > 0
        // A CHAIN IS ACTIVE ONLY WITH A RELATED NODE: a hover whose halo holds nothing beyond the
        // hovered task itself relates to nothing, and a reader that counted that as a chain would be
        // reading a highlight that tinted one node and dimmed no other.
        /** Whether the hovered node's halo reaches at least one other node. */
        const chainActive = focusing && Object.keys(focus).length > 1
        /** The drawn edges, one per `blockedBy` entry naming a task ON THIS BOARD. */
        // A `blockedBy` id the board does not carry draws NOTHING: the payload serves the list raw,
        // while the rank projection drops unknown ids, so an entry naming a ghost is reachable in real
        // data — and an edge into a node that is not there would be a picture of a dependency that the
        // record does not have.
        const edges: unknown[] = []
        for (const node of graph.nodes) {
          for (const blockerId of node.task.blockedBy) {
            /** The blocker's own box; a blocker the board does not carry draws no edge. */
            const parent = nodeOf[blockerId]
            if (parent === undefined) continue
            edges.push(edgeOf(parent, node, focus[parent.task.id] === true && focus[node.task.id] === true))
          }
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
        // THE DAG, in the form a 380px column can carry: one rank column per `depth`, one node per task,
        // and one DRAWN edge (three absolutely-positioned divs) per `blockedBy` entry that names a task
        // on this board. The reference GUI draws SVG curves; at this width the arithmetic form is both
        // readable and impossible to disagree with the data.
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
            style: { ...CSS.scroll, width: "100%", height: Math.min(graph.height, 260) + "px" },
          },
            // The grid WRAPS the canvas: the wrapper carries the vertical breathing room as padding, so
            // the origin an edge's absolute coordinates are measured from stays the grid itself.
            react.createElement("div", { style: { position: "relative", width: graph.width + "px", padding: COLUMN_PAD + "px 0" } },
              react.createElement("div", { style: { ...CSS.grid, width: graph.width + "px", height: graph.height + "px", gridTemplateColumns: graph.gridTemplateColumns } },
                graph.columns.map((column, rank) => react.createElement("div", {
                  key: "col-" + rank,
                  "data-mpd-rank": String(rank),
                  style: { ...CSS.column, width: COLUMN_W + "px", height: graph.height + "px" },
                },
                column.map((task, row) => react.createElement("div", {
                  key: "node-" + task.id,
                  "data-mpd-node": task.id,
                  role: "button",
                  tabIndex: 0,
                  "aria-pressed": pinned === task.id,
                  title: task.subject + (task.attempt === undefined ? "" : " · " + t("task.attempt") + " " + task.attempt),
                  style: {
                    ...CSS.node,
                    top: (COLUMN_PAD + row * (NODE_H + NODE_GAP)) + "px",
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
                react.createElement("div", { key: "subject", style: { ...CSS.dim, marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, task.subject),
                ))),
              ),
              // THE EDGES LAYER IS THE GRAPH'S OWN SECOND CHILD, and the closers below it end the
              // column, the node, the grid, the wrapper and the graph in that order.
              react.createElement("div", { key: "edges", "data-edges": "1", style: { ...CSS.edgeLayer, width: graph.width + "px", height: graph.height + "px" } }, edges)))))
        }
        if (pinnedTask !== undefined) children.push(detailSection(pinnedTask, tasks, current.contracts[pinnedTask.id]))
        for (const problem of state.problems) {
          children.push(react.createElement("div", { key: "p-" + problem, style: { ...CSS.dim, marginTop: "6px" } }, problem))
        }
        return react.createElement("div", { "data-mpd-team-tab": team.id, style: CSS.panel }, children)
      }

      return { TeamView, start, read, layout }
    },
  }
}
