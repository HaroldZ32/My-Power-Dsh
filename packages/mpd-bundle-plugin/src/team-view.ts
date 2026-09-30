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
    /** The last failure, kept so the panel renders a reason instead of an empty box. */
    error?: unknown
  }

  /** The style bag this view uses; the host supplies the tokens, the literals are fallbacks. */
  const CSS = {
    panel: { padding: "10px 12px 14px", fontSize: "12px", lineHeight: 1.45, overflowY: "auto", height: "100%" },
    dim: { color: "var(--dsw-alias-label-tertiary, #8a94a6)" },
    head: { fontSize: "13px", fontWeight: 600 },
    chip: { display: "inline-block", padding: "0 6px", borderRadius: "999px", fontSize: "11px", border: "1px solid var(--dsw-alias-line-normal, #d8dde5)" },
    row: { display: "flex", gap: "6px", alignItems: "baseline", padding: "2px 0" },
    node: { border: "1px solid var(--dsw-alias-line-normal, #d8dde5)", borderRadius: "6px", padding: "4px 6px", marginBottom: "4px", fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)", fontSize: "11px" },
    bar: { height: "6px", borderRadius: "3px", background: "var(--dsw-alias-bg-fill-neutral, #e6e8eb)", overflow: "hidden", marginTop: "6px" },
    barFill: { height: "100%", background: "var(--dsw-alias-state-success, #12a150)" },
  }

  /** The colour token each rendered state draws in — a MEANING mapped to a host token, never a literal. */
  const TONE: Record<string, string> = {
    completed: "var(--dsw-alias-state-success, #12a150)",
    running: "var(--dsw-alias-state-business-primary, #4d6bfe)",
    failed: "var(--dsw-alias-state-danger, #e5484d)",
    blocked: "var(--dsw-alias-state-warning, #e08700)",
    cancelled: "var(--dsw-alias-label-tertiary, #8a94a6)",
    open: "var(--dsw-alias-label-secondary, #5b6472)",
  }

  /** The glyph each rendered state draws with, so the panel reads without colour. */
  const GLYPH: Record<string, string> = { completed: "✓", running: "◐", failed: "✗", blocked: "○", cancelled: "⊘", open: "○" }

  /** The three-letter kind abbreviation, so a node stays narrow. */
  const KIND: Record<string, string> = { requirement: "REQ", work: "WRK", review: "REV", repair: "FIX", integration: "INT" }

  return {
    /**
     * Build the team view ONCE, so both sidebar hosts render the same component with the same
     * polling behaviour rather than two lookalikes that can drift.
     * @param deps - the React surface and the route path.
     * @returns the view component and its poller.
     */
    createTeamView(deps: { react: ReactSurface; statePath: string; planPath?: string; pollMs?: number }): {
      /** The component; the host calls it with ITS own props, which this view ignores but tolerates. */
      TeamView: (props?: unknown) => unknown
      /** Start polling for one session; returns a stop function the caller owns. */
      start: (sessionId: string, publish: (next: TeamStore) => void) => () => void
      /** Read the route once, resolving to the payload or a failure. */
      read: (sessionId: string) => Promise<TeamStore>
    } {
      /** The two dependencies this closure reads on every call. */
      /** The two dependencies this closure reads on every call. */
      /** The two dependencies this closure reads on every call, plus the plan route when given. */
      const { react, statePath, planPath } = deps
      /** How often the panel re-reads; the route is cheap and this is a status surface. */
      const pollMs = typeof deps.pollMs === "number" && deps.pollMs > 0 ? deps.pollMs : 2000

      /** Read the route once. Never rejects: a failure is a VALUE the panel renders. */
      /** The session suffix both routes take, so the two cannot address different sessions. */
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
      /** Read BOTH routes, never rejecting. */
      const read = async (sessionId: string): Promise<TeamStore> => {
        // BOTH ROUTES IN ONE PASS. They are two halves of one answer — the team as it exists after an
        // approval, and the plan that awaits one — and a panel that polled them separately could show a
        // staged plan beside a team that approval had already replaced.
        const [state, plan] = await Promise.all([
          readOne<TeamState>(statePath, sessionId),
          planPath === undefined ? Promise.resolve({ value: null as TeamPlan | null }) : readOne<TeamPlan>(planPath, sessionId),
        ])
        return { state: state.value, plan: plan.value === null ? null : plan.value.plan === null ? null : plan.value, error: state.error }
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
          react.createElement("div", { key: "p-id", style: CSS.dim }, plan.planId + " · staged · " + plan.approval + " approval"),
          react.createElement("div", { key: "p-desc", style: { marginTop: "4px" } }, plan.description),
          react.createElement("div", { key: "p-members-head", style: { marginTop: "8px", fontWeight: 600 } }, "Wants " + plan.members.length + " member(s)"),
        ]
        for (const member of plan.members) {
          rows.push(react.createElement("div", { key: "pm-" + member.name, style: CSS.row },
            react.createElement("span", { style: { flex: "1 1 auto" } }, member.name),
            react.createElement("span", { style: CSS.dim }, member.role ?? "")))
        }
        rows.push(react.createElement("div", { key: "p-tasks-head", style: { marginTop: "8px", fontWeight: 600 } }, "Wants " + plan.tasks.length + " task(s)"))
        for (const task of plan.tasks) {
          rows.push(react.createElement("div", {
            key: "pt-" + task.subject,
            style: { ...CSS.node, borderColor: undefined },
            title: task.description,
          },
          task.subject + (task.owner === undefined ? "" : " @" + task.owner),
          task.blockedBy.length === 0 ? null : react.createElement("div", { style: { ...CSS.dim, fontSize: "10px" } }, "⇠ " + task.blockedBy.join(","))))
        }
        // THE GATE, stated where the plan is read. The phrase is the PRE-approval identity, so it is
        // knowable the whole time the plan is staged — which a teamId would not be.
        rows.push(react.createElement("div", { key: "p-gate", style: { marginTop: "10px", fontWeight: 600 } }, "To approve, type:"))
        rows.push(react.createElement("div", { key: "p-phrase", style: { ...CSS.node, marginTop: "2px", fontWeight: 700 } }, plan.phrase))
        return react.createElement("div", { style: CSS.panel }, rows)
      }

      /**
       * The team panel.
       *
       * The session id comes from the host's own props when it offers one (both hosts do, in their
       * own spelling); without one the route answers the workspace's principal team, which is what a
       * panel opened outside a session should show.
       */
      const TeamView = (props?: unknown): unknown => {
        /** The host's props, read leniently: both hosts spell the session differently. */
        const seat = (props ?? {}) as { sessionId?: unknown; scope?: { sessionId?: unknown } }
        /** The session this panel addresses; empty asks the route for the workspace principal. */
        const sessionId = String(seat.sessionId ?? seat.scope?.sessionId ?? "")
        /** The polled store and its setter. */
        const [store, setStore] = react.useState({ state: null, plan: null, error: undefined } as TeamStore)
        // One poller per session: the effect re-runs when the host hands this panel a different one.
        react.useEffect(() => start(sessionId, setStore), [sessionId])
        /** The store, narrowed out of the tuple above. */
        const current = store as TeamStore
        /** The last readable payload, or null while there is none. */
        const state = current.state
        if (state === null) {
          return react.createElement("div", { style: { ...CSS.panel, ...CSS.dim } },
            current.error === undefined
              ? "Reading the team…"
              : "No team state is being served. The mpd team row may not be mounted in this profile.")
        }
        if (state.team === null) {
          // A STAGED PLAN WITH NO TEAM IS THE NORMAL PRE-APPROVAL STATE, not an empty one: the team
          // record is materialised AT approval, so before one there is nothing to show here and
          // everything to show in the plan. Returning the empty sentence would have hidden the very
          // thing the captain came to approve.
          if (current.plan !== null && current.plan.plan !== null) return planSection(current.plan.plan)
          return react.createElement("div", { style: { ...CSS.panel, ...CSS.dim } },
            "No team in this workspace yet. Stage one with agent_teams_plan, then approve it.")
        }
        /** The team head; non-null past the guard above. */
        const team = state.team
        /** The tally, in the record's own vocabulary. */
        const counts = state.counts
        /** The completion percentage, 0 while the board has no tasks. */
        const percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100)
        // THE TALLY SAYS WHAT A CAPTAIN ACTS ON, not just how far along the board is: how many tasks
        // a member could pick up RIGHT NOW, and how many of those are only ready because a
        // prerequisite FAILED (OPT-1 releases them, and that must not hide inside "ready").
        /** The line a captain reads: what is moving, what is pickable, what is held. */
        const tally = counts.running + " running · " + counts.ready + " ready · " + counts.blocked + " blocked"
          + (counts.releasedByFailure === 0 ? "" : " · " + counts.releasedByFailure + " released by a failed blocker")
        // THE DAG, in the form a 380px column can carry: rank columns left to right, one chip per
        // task, and each chip naming the blockers it rests on. The reference GUI draws this as an
        // SVG of Bezier edges; at this width that is unreadable, and the honest sidebar form is the
        // staged columns below.
        /** The board bucketed by rank, which is the graph's column axis. */
        const stages: TeamTask[][] = []
        for (const task of state.tasks) {
          /** The rank this task draws in; a negative or unknown depth falls back to the first. */
          const at = Number.isFinite(task.depth) && task.depth >= 0 ? task.depth : 0
          while (stages.length <= at) stages.push([])
          stages[at].push(task)
        }
        /** The panel's elements, in render order. */
        const children: unknown[] = [
          react.createElement("div", { key: "head", style: CSS.head }, team.name),
          react.createElement("div", { key: "sub", style: CSS.dim }, team.id + " · " + team.phase),
          react.createElement("div", { key: "tally", style: { ...CSS.dim, marginTop: "2px" } }, tally),
          react.createElement("div", { key: "bar", style: CSS.bar },
            react.createElement("div", { style: { ...CSS.barFill, width: percent + "%" } })),
          // THE EXECUTOR IS SHOWN, because which backend raises a member is exactly the fact that
          // explains a team behaving differently than expected — served by the same route.
          react.createElement("div", { key: "exec", style: { ...CSS.dim, marginTop: "4px" } },
            react.createElement("span", { style: CSS.chip }, state.executor.kind), " executor"),
          react.createElement("div", { key: "members-head", style: { marginTop: "10px", fontWeight: 600 } }, "Members (" + state.members.length + ")"),
        ]
        for (const member of state.members) {
          children.push(react.createElement("div", { key: "m-" + member.id, style: CSS.row },
            react.createElement("span", { style: { ...CSS.dim, width: "10px" } }, member.status === "running" ? "◐" : "○"),
            react.createElement("span", { style: { flex: "1 1 auto" } }, member.name),
            react.createElement("span", { style: CSS.dim }, member.done + "/" + member.total + (member.current === undefined ? "" : " · " + member.current)),
          ))
        }
        children.push(react.createElement("div", { key: "dag-head", style: { marginTop: "10px", fontWeight: 600 } },
          "Dependency map" + (state.cycles.length === 0 ? "" : " · CYCLE " + state.cycles.join(","))))
        for (let rank = 0; rank < stages.length; rank += 1) {
          /** This rank's chips, headed by its number. */
          const chips: unknown[] = [react.createElement("div", { key: "r" + rank, style: { ...CSS.dim, marginTop: "4px" } }, "rank " + rank)]
          for (const task of stages[rank]) {
            /** One node chip: marker, id, kind, subject, blockers, owner. */
            chips.push(react.createElement("div", {
              key: "t-" + task.id,
              style: { ...CSS.node, borderColor: task.visual === "open" ? undefined : TONE[task.visual] },
              title: task.subject + (task.attempt === undefined ? "" : " · attempt " + task.attempt),
            },
            react.createElement("span", { style: { color: TONE[task.visual], fontWeight: 700 } }, GLYPH[task.visual] ?? "?"),
            " " + task.id + " " + (KIND[task.kind ?? ""] ?? ""),
            react.createElement("div", { style: { ...CSS.dim, fontSize: "10px" } }, task.subject),
            task.blockedBy.length === 0 ? null : react.createElement("div", { style: { ...CSS.dim, fontSize: "10px" } },
              "⇠ " + task.blockedBy.join(",") + (task.failedBy.length === 0 ? "" : " · FAILED " + task.failedBy.join(","))),
            task.owner === undefined ? null : react.createElement("div", { style: { ...CSS.dim, fontSize: "10px" } }, "@" + task.owner),
            ))
          }
          children.push(react.createElement("div", { key: "stage-" + rank }, chips))
        }
        for (const problem of state.problems) {
          children.push(react.createElement("div", { key: "p-" + problem, style: { ...CSS.dim, marginTop: "6px" } }, problem))
        }
        return react.createElement("div", { style: CSS.panel }, children)
      }

      return { TeamView, start, read }
    },
  }
}
