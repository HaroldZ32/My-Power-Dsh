// mpd bundle web client (factory body, inlined into the combined client.js by
// scripts/build-mpd-client.ts). Loaded as the client half of the @mpd-dsh/mpd bundle
// entry. It contributes the AgentTeams GUI as ONE DSH-better-sidebar tab (the page lives
// in src/team-page.ts, module id @mpd-dsh/team-page, composing the adopted views through
// the export bridge) plus the null slash-command admission row, and the WORKMATE LIBRARY
// as its own sidebar tab. Both features are sidebar-only: this file registers NO
// overlay, NO chat node and no footer toggle. The adopted agent-teams client is required
// for its views/store/locales/CSS, but its apply() is never called: that is what used to
// register the removed in-conversation card and the removed overlay activity floater.
// Plain JS, React.createElement only. This file is a FACTORY BODY, not a module: the whole
// file is ONE arrow-function expression plus the ambient declaration below, and
// `scripts/build-mpd-client.ts` splices it as `factory: <this file>`.
(require: (id: string) => unknown) => {
  /** The CommonJS-shaped module record the client loader keeps for this factory. */
  var module: { exports: Record<string, unknown> } = { exports: {} };
  /** The object every export below is written onto (`module.exports`). */
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  // The client loader hands back the host's own React module, and this bundle ships no React
  // typings, so the module boundary is described structurally and crossed with one cast.
  /** The React surface this factory renders with. */
  let react = require("react") as ReactSurface;
  // 0.1.7 REBASE: `require("@nanmicoder/dsh-agent-teams")` used to sit here. The retired
  // vendored client is NO LONGER required by any mpd client source: the official
  // `@deepseek-ai/dsh-experimental-client-ui-agent-team` client owns the roster/task-board UI,
  // and this bundle's own team surface is the WATCHDOG view (src/team-page.ts), which reads
  // only this bundle's own routes through `fetch`. Nothing in this factory touches the
  // harness's client modules.

  // ── types for the seams this factory crosses ───────────────────────────────
  // All of them are function-scoped: this file is a SCRIPT (no import/export), so a top-level
  // declaration would leak into the shared global scope of the client bundle.
  /** The subset of React this factory uses; the host injects the real module at boot. */
  interface ReactSurface {
    /** Create one element; `props` is null for a props-less element and children follow variadically. */
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
    /** Local component state: the current value plus a setter that also accepts an updater. */
    useState: <S>(initial: S) => [S, (next: S | ((prev: S) => S)) => void]
    /** Run an effect after render; a returned function becomes its cleanup. */
    useEffect: (effect: () => unknown, deps: unknown[]) => unknown
    /** A memoized callback, stable while its dependencies do not change. */
    useCallback: <F extends (...args: never[]) => unknown>(callback: F, deps: unknown[]) => F
  }

  /** An inline style object (React props are untyped here, so a style is an opaque record). */
  type Style = Record<string, unknown>

  /** A translator: a dictionary key plus optional interpolation parameters. */
  type Translate = (key: string, params?: Record<string, unknown>) => string

  /** A JSON object body: every call site narrows the fields it reads. */
  type ApiBody = { readonly [key: string]: unknown }

  /** The event shape a submit handler needs (a React synthetic event, structurally). */
  interface FormEvent {
    /** Cancel the browser's own form submit. */
    preventDefault: () => void
  }

  /** The event shape a text input or select hands its change handler. */
  interface ChangeEvent {
    /** The element the change came from, read only for its current value. */
    target: { value: string }
  }

  /** One blocking entry of an in-use refusal, as the route reports it. */
  interface BlockingEntry {
    /** The team that holds the workmate. */
    teamId?: unknown
    /** The member that holds it, when the refusal names one. */
    member?: unknown
  }

  /** A failed request: the HTTP status, the parsed body, and the §D reason when the body carried one. */
  interface RequestFailure extends Error {
    /** The HTTP status the route answered with. */
    status?: number
    /** The parsed response body (an empty record when the body was not a JSON object). */
    body?: ApiBody
    /** The machine-readable §D reason code the page branches on. */
    reason?: string
    /** The §E blocking `team/member` entries of an in-use refusal. */
    blocking?: BlockingEntry[]
  }

  /** One workmate as the library list reports it (the fields this page renders). */
  interface Workmate {
    /** The instance key (the directory name), which is also the display name. */
    name: string
    /** The roster BASE template the instance was initialized from. */
    baseName?: string
    /** Whether the instance carries the read-only discipline. */
    readonly?: boolean
    /** How many times the instance has been spawned. */
    uses?: number
    /** The instance's short note, when it has one. */
    note?: string
  }

  /** One roster BASE template as the library reports it. */
  interface RosterBase {
    /** The template's functional name (the only way a base is addressed). */
    name: string
    /** Whether the template is read-only. */
    readonly?: boolean
  }

  /** One workmate's full record, as `/get` answers it (the detail pane's fields). */
  interface WorkmateDetail extends Workmate {
    /** The instance's persona text. */
    persona?: unknown
    /** The instance's memory text. */
    memory?: unknown
    /** The summary of the instance's most recent task. */
    lastTask?: unknown
    /** When the instance was created. */
    createdAt?: unknown
    /** When the instance was last updated. */
    updatedAt?: unknown
    /** The provider the instance is routed to. */
    provider?: unknown
    /** The model the instance is routed to. */
    model?: unknown
  }

  /** The `/list` answer. */
  interface WorkmateListResponse {
    /** The library's instances, absent when the route answered an empty body. */
    workmates?: Workmate[]
  }

  /** The `/roster` answer. */
  interface RosterResponse {
    /** The BASE templates the roster offers, absent when it could not be read. */
    bases?: RosterBase[]
  }

  /** A mutation answer, read field by field by its own caller. */
  type MutationResponse = Record<string, unknown>

  /** The event shape a component receives from the host (only the props used are named). */
  interface FormEventProps {
    /** Cancel the browser's own submit. */
    preventDefault?: () => void
  }

  /** The props the workmate library page receives (the seat passes a translator). */
  interface WorkmateLibraryProps {
    /** The translator to render with; absent means the English dictionary is used. */
    t?: Translate
  }

  /** The slot registry the client framework exposes. */
  interface SlotRegistry {
    /** Register a slot entry inside an `inject` callback. */
    register: (spec: ApiBody, component: unknown) => unknown
    /** Run a registration when the named slot is collected. */
    inject: (slot: string, callback: () => unknown) => unknown
  }

  /** The locale registry this entry adds its dictionaries to. */
  interface LocaleRegistry {
    /** Register a namespace's dictionaries keyed by language. */
    register: (namespace: string, dictionaries: unknown) => unknown
    /** Bind a namespace to a translator function. */
    bind: (namespace: string) => Translate
  }

  /** The harness right sidebar this entry contributes its Team tab to. */
  interface SidebarRight {
    /** Open (or focus) the tab of this kind. */
    openTab: (kind: string) => unknown
  }

  /** A registry the harness exposes to plugins (shortcuts, right-sidebar tabs). */
  interface Registry {
    /** Register one entry. */
    register: (spec: ApiBody) => unknown
  }

  /** The client-side plugin context this entry is applied with (only the members used are named). */
  interface ClientContext {
    /** Resolve a service by name (a service that is not mounted answers undefined). */
    get: (name: string) => unknown
    /** Declare service dependencies; the callback runs once they are all present. */
    inject: (services: string[], callback: (scope: ClientContext) => unknown) => { dispose: () => void } | undefined
    /** Own a disposable for this fibre's lifetime. */
    effect: (setup: () => unknown, label: string) => unknown
    /** The slot registry (a declared dependency, so always present here). */
    slots: SlotRegistry
    /** The locale registry. */
    locale: LocaleRegistry
    /** The harness right sidebar (the Team tab's command opens a tab through it). */
    sidebarRight: SidebarRight
    /** The client shortcut registry. */
    shortcuts: Registry
    /** The harness right-sidebar tab registry. */
    sidebarRightTabs: Registry
  }

  /** The better-sidebar host's service, as the workmate page uses it. */
  interface SidebarService {
    /** Register a tab descriptor; the host throws on a duplicate id (probed before use). */
    registerTab: (descriptor: SidebarTabDescriptor) => unknown
    /** Look up a registered tab id, when the host supports the probe. */
    getTab?: (id: string) => unknown
  }

  /** The tab descriptor this bundle registers with the DSH-better-sidebar host. */
  interface SidebarTabDescriptor {
    /** The stable tab id (the host keys restored tabs on it and rejects a duplicate). */
    id: string
    /** The tab title. */
    title: () => string
    /** One-line purpose rendered under the title in the host's new-tab list (0.28). */
    description?: string | (() => string)
    /** The tab icon factory; the host passes the icon size in pixels. */
    icon: (size: number) => unknown
    /** The tab's position among the host's tabs. */
    order: number
    /** Whether the host keeps at most one instance of this tab. */
    single: boolean
    /** Bottom-workbench-only type (0.26+): offered in the plugin's own bottom menu and nowhere else. */
    bottomOnly?: boolean
    /** The tab body, any component the host will call with its own props. */
    component: unknown
  }

  /** The team-page module's surface: the one registration this entry calls on it. */
  interface TeamPageModule {
    /** Register the team watchdog tab with the better-sidebar host. */
    registerTeamSidebarTab: (ctx: ClientContext, service: SidebarService) => boolean
  }

  /** The settings card module's surface: the one method this entry calls on it. */
  interface SettingsCardModule {
    /**
     * Mount the card's own top-level settings section. The options mirror the card's own
     * `MountOptions`; the one member this entry provides is `fetchJson` — the ENTRY-owned JSON
     * reader the card's effective-value block reads the live `/plugins/mpd/model-config` route
     * through (the card itself does no I/O; this module is the one allowed to reach the network).
     */
    mountSettingsCard: (ctx: ClientContext, options?: { fetchJson?: (url: string) => Promise<unknown> }) => unknown
  }

  /** One teammate row of the shared board. */
  interface TeamMember {
    /** The member's identity (stable within the team). */
    id?: unknown
    /** The member's display name. */
    name?: unknown
    /** The member's role (`lead` for the captain). */
    role?: unknown
    /** The member's phase, used for the status dot; an unknown phase falls back to grey. */
    phase: string
    /** The member's last error, when it has one. */
    error?: unknown
  }

  /** One shared task row of the board. */
  interface TeamTask {
    /** The task's identity (stable within the team). */
    id?: unknown
    /** The task's subject line. */
    subject?: unknown
    /** The task's status, used for the status chip; an unknown status falls back to grey. */
    status: string
    /** The name of the member that owns the task, absent while it is unowned. */
    ownerName?: unknown
    /** Whether a teammate could pick the task up right now. */
    ready?: boolean
    /** The task ids this one waits on. */
    blockedBy?: unknown[]
  }

  /** The team projection the harness right sidebar exposes for one session. */
  interface TeamProjection {
    /** The team's members. */
    members?: TeamMember[]
    /** The team's shared tasks. */
    tasks?: TeamTask[]
    /** The team-level failure, when the team ended badly. */
    failure?: unknown
  }

  /** The client state slice the sessions hook selects from. */
  interface SessionsState {
    /** The per-session projections, keyed by session id. */
    projectionsBySession?: Record<string, { values?: { agentTeam?: TeamProjection } } | undefined>
  }

  /** The session snapshot the session hook selects from. */
  interface SessionSnapshot {
    /** The subagent half of the snapshot, where a teammate's parent address lives. */
    subagent?: { address?: { parentSessionId?: string } }
  }

  /** A client store hook: subscribe with a selector and return the selected slice. */
  type SessionsHook = (selector: (state: SessionsState) => TeamProjection | undefined) => TeamProjection | undefined

  /** The single-session store hook: subscribe with a selector and return the selected slice. */
  type SessionHook = (selector: (snapshot: SessionSnapshot) => string | undefined) => string | undefined

  /** The props the harness right sidebar hands the Team tab (its seat's `inject` result). */
  interface TeamSidebarProps {
    /** The session whose team the tab renders, as the seat resolved it. */
    sessionId?: string
    /** The sessions hook the seat provides (falls back to the primitives package). */
    useSessions?: SessionsHook
    /** The session hook the seat provides (falls back to the primitives package). */
    useSession?: SessionHook
  }

  // ── Version-tolerant client seams ──────────────────────────────────────────
  // The web boot hard-fails the WHOLE page when one entry stays `pending`:
  // `assertEntriesActive` reports `entry: pending (waiting for service: X)` and
  // throws "Failed to load plugins". A service this profile does not mount must
  // therefore never sit in `inject` — it would take the GUI down even though the
  // surface it feeds is optional.
  //
  // The other half of the rule is easy to get wrong and cost us the entire sidebar GUI:
  // cordis resolves services through the fiber's own scope, so a plugin-provided service
  // is INVISIBLE to a plain `ctx.get` probe — and because `notify()` only re-evaluates
  // fibers that DECLARE a dependency, a one-shot probe can never recover either. Services
  // owned by another plugin are reached with `ctx.inject` (mountSidebarPages), which waits
  // for the provider without parking this entry.
  //
  // Observed drift (dsh 0.1.2-rc.1): the frontend exposes `slots`, `locale`,
  // `sessions`, `layout`, `theme`, `timer`, `uiWorkspace`, `workspaces`,
  // `modelDirectories`; it does NOT expose `conversationEvents` (the adopted panel's
  // rc.9 seam, where the harness now speaks `conversationViews`). That missing seam is
  // why the adopted client half is no longer applied at all — its only use of
  // `conversationEvents` was the removed in-conversation card, and the sidebar team
  // page covers the same ground without it.
  /** The services this entry declares: both are host-owned and present in every web profile. */
  const REQUIRED_SERVICES = ["slots", "locale"];

  /**
  * Declared hard dependencies only. The web boot's `assertEntriesActive` turns any
  * declared-but-unregistered service into a fatal `pending` entry, so a seam this profile
  * may not mount must NOT be declared here.
  *
  * That restriction does NOT extend to services provided by another PLUGIN, which must be
  * reached through `ctx.inject` (see mountSidebarPages) — a one-shot `ctx.get` probe cannot
  * see them.
  */
  const inject = REQUIRED_SERVICES.slice();

  /**
  * Mount the AgentTeams GUI's non-sidebar surface: the null `conversation.chat.commandview`
  * row that hides the `/agent-teams` command result (the slash command's own result row would
  * duplicate the replayed user message; the adopted client hid it the same way). The team
  * PANEL is not mounted here — see mountSidebarPages.
  */
  function mountAgentTeams(ctx: ClientContext): void {
    // Contained like every other optional surface: a broken registration must degrade to one
    // warning, never throw out of the client entry (that would fail the whole web page).
    try {
      ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
        name: "conversation.chat.commandview",
        key: "agent-teams",
      }, () => null));
    } catch (error) {
      console.warn("[mpd] AgentTeams command view failed to mount: " + String(error));
    }
  }

  /**
  * Register both sidebar pages once DSH-better-sidebar is actually available.
  *
  * `betterSidebar` is provided by the better-sidebar plugin, whose fiber activates
  * independently of ours. A one-shot probe at apply() time therefore RACES it and loses:
  * measured on the live GUI, `ctx.get('betterSidebar')` answered `false` during apply and
  * `true` eight seconds later, so both pages silently registered nothing and the sidebar's
  * "+" menu offered no AgentTeams/Workmates row at all.
  *
  * `ctx.inject` is the runtime's own answer (better-sidebar uses exactly this for its
  * asynchronously-mounted `remote.session`): the callback runs when the service appears and
  * again after a provider remount, and it does NOT park this boot entry — a profile without
  * the sidebar simply never fires it, instead of becoming a fatal `pending` row.
  */
  function mountSidebarPages(ctx: ClientContext, teamPage: TeamPageModule): void {
    /** The injection fiber, when the runtime returned one. */
    let fiber;
    try {
      fiber = ctx.inject(["betterSidebar"], (sidebarCtx) => {
        /** The better-sidebar service this callback was waiting for. */
        const service = readService(sidebarCtx, "betterSidebar") as SidebarService | undefined;
        if (service === undefined || typeof service.registerTab !== "function") {
          console.warn("[mpd] better-sidebar exposes no registerTab — no mpd page is registered");
          return;
        }
        try {
          teamPage.registerTeamSidebarTab(sidebarCtx, service);
        } catch (error) {
          console.warn("[mpd] AgentTeams sidebar file failed to mount: " + String(error));
        }
        try {
          registerTeamSidebarTab(sidebarCtx, service);
        } catch (error) {
          console.warn("[mpd] the team tab registration failed: " + String(error));
        }
        try {
          registerWorkmateSidebarTab(sidebarCtx, service);
        } catch (error) {
          console.warn("[mpd] workmate sidebar tab registration failed: " + String(error));
        }
      });
    } catch (error) {
      console.warn("[mpd] sidebar pages could not be wired: " + String(error));
      return;
    }
    if (fiber !== undefined && typeof fiber.dispose === "function") {
      // The guard above is what makes the fiber non-null here; the assertion is type-level only
      // (a closure cannot keep the narrowing of a `let` that was assigned inside a `try`).
      ctx.effect(() => () => { fiber!.dispose(); }, "mpd: sidebar page injection");
    }
  }

  // ── THE TEAM VIEW (W4) ─────────────────────────────────────────────────────
  // INSIDE THE FACTORY, and that placement is load-bearing. This module is spliced into the client
  // as ONE ARROW EXPRESSION, so anything declared after the closing brace lands OUTSIDE the module
  // wrapper: the ambient `declare`s below survive that because they erase to nothing, but RUNTIME
  // code does not — measured: `const TEAM_STATE_PATH` sitting there broke the whole built client
  // with `Unexpected token 'const'`, in every arm that evaluates the served bytes.
  /** The route the team view polls; the host row registers the same path. */
  const TEAM_STATE_PATH = "/plugins/mpd-team/state"
  /**
   * The route serving the session's STAGED PLAN — the shared projection's other half.
   *
   * A SEPARATE ROUTE, and the view polls BOTH in one pass: a staged plan is what exists BEFORE an
   * approval and the team record is what exists AFTER one, so a panel that read only records showed
   * nothing for the state a captain most needs to act on.
   */
  const TEAM_PLAN_PATH = "/plugins/mpd-team/plan"

  /**
   * The route serving the session's FROZEN ACCEPTANCE CONTRACTS and the workspace hold.
   *
   * Passed to the view so a pinned task can quote the contract it was claimed under. Without it the
   * detail body correctly renders its "no contract was served" sentence — which is indistinguishable
   * on screen from a task that genuinely has none, so the route is threaded rather than left out.
   */
  const TEAM_TASK_PATH = "/plugins/mpd-team/task"

  /**
   * The route the team view SUBSCRIBES to (lane W), beside the three it reads.
   *
   * Server-Sent Events, owned by `mpd-team-core-plugin`'s `TEAM_EVENTS_PATH`: the view opens an
   * `EventSource` on it for the session it is showing and re-reads the routes above on every frame,
   * while its interval keeps running as the fallback. The path is named here rather than imported
   * because the browser artifact is assembled by SPLICING factory sources as text — a cross-package
   * import inside one would not resolve — so the name is the same fact recorded on the client side.
   */
  const TEAM_EVENTS_PATH = "/plugins/mpd-team/events"

  /**
   * The team view's own copy, in English — the fallback AND the key list.
   *
   * A view built by `teamViewOf()` runs in a render path with no `ctx`, so it can neither bind nor
   * register a locale namespace itself; it takes a translator as a dependency instead. This table is
   * what the translator answers with when the host's locale registry is absent or answers nothing,
   * which is why the view can never render a bare key. The same key set is registered below, so `zh`
   * resolves for a Chinese host and this table carries the English.
   */
  const TEAM_COPY_EN: Record<string, string> = {
    "header.approved": "approved",
    "header.workspace": "workspace",
    "header.complete": "complete",
    "progress.label": "Progress",
    "members.title": "MEMBERS",
    "members.empty": "No member was raised for this team.",
    "members.current": "current",
    "task.title": "TASKS",
    "task.empty": "No shared task yet — the captain posts them with agent_teams_plan {action:\"create_task\", blocked_by:[…]}.",
    "task.cycle": "CYCLE",
    "task.blockedBy": "blocked by",
    "task.dependents": "dependents",
    "task.attempt": "attempt",
    "task.round": "round",
    "task.verdict": "verdict",
    "task.owner": "owner",
    "task.consult": "consult",
    "task.status": "state",
    "task.started": "started",
    "task.elapsed": "elapsed",
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
    // Mirrored VERBATIM from `team-view.ts`'s own table (the view's English fallback and this host
    // dictionary are deliberately one text): a session with no team of its own now lists the
    // workspace's teams instead of claiming the workspace is empty.
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
    // ── D2: the hover card's vocabulary, verbatim from `team-view.ts`'s EN table ──
    // A rendered state is localized for the CARD only; the drawing keeps the payload's ASCII word.
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
    // THE ROSTER ROLES. These are product names carried by the record (`member.role`), so English is the
    // identity mapping and Chinese is a DISPLAY-only rendering — the record itself is never rewritten.
    // Without this the panel renders a Chinese shell around English role chips, which is the one place a
    // reader could still tell the panel was translated from somewhere else.
    "Lead": "Lead",
    "Architect": "Architect",
    "Researcher": "Researcher",
    "Planner": "Planner",
    "Deep Worker": "Deep Worker",
    "Senior Engineer": "Senior Engineer",
    "Explorer": "Explorer",
    "Reviewer": "Reviewer",
    "Plan Reviewer": "Plan Reviewer",
    "Vision Analyst": "Vision Analyst",
    "Junior Engineer": "Junior Engineer",
  }

  /**
   * The team view's copy in Simplified Chinese, keyed identically to {@link TEAM_COPY_EN}.
   *
   * `zh` is the meaning-authoritative half of the pair; the English file is its translation. The two
   * labels the capture driver asserts on (`members.title` / `task.title`) are deliberately kept as the
   * host's own convention shows them — an uppercase SECTION label — so a screenshot reads the same
   * structure in either language while the words behind it are local.
   */
  const TEAM_COPY_ZH: Record<string, string> = {
    "header.approved": "已批准",
    "header.workspace": "工作区",
    "header.complete": "已完成",
    "progress.label": "进度",
    "members.title": "成员",
    "members.empty": "该团队尚未拉起成员。",
    "members.current": "当前",
    "task.title": "任务",
    "task.empty": "暂无共享任务 — 队长用 agent_teams_plan {action:\"create_task\", blocked_by:[…]} 发布任务。",
    "task.cycle": "依赖环",
    "task.blockedBy": "前置",
    "task.dependents": "后继",
    "task.attempt": "认领次数",
    "task.round": "评审轮次",
    "task.verdict": "评审结论",
    "task.owner": "负责人",
    "task.consult": "咨询",
    "task.status": "状态",
    "task.started": "开始时间",
    "task.elapsed": "已用时间",
    "task.contract": "验收契约",
    "task.contract.none": "该任务没有已冻结的验收契约。",
    "task.close": "关闭",
    "tally.running": "进行中",
    "tally.ready": "可领取",
    "tally.blocked": "受阻",
    "tally.released": "因前置失败而释放",
    "state.reading": "正在读取团队…",
    "state.unavailable": "未提供团队状态。该配置可能没有挂载 mpd 团队行。",
    "state.none": "本工作区还没有团队。用 agent_teams_plan 拟定一个团队，然后批准它。",
    // ── D2：无会话归属时的团队清单 ────────────────────────────────
    // 会话未绑定团队时不再只显示一句空状态：这里列出本工作区自己的团队，并标出哪个属于当前会话。
    "workspace.title": "工作区团队",
    "workspace.hint": "当前会话未绑定团队。以下列出本工作区的团队 — 只有自己批准的那个才由当前会话驱动。",
    "workspace.active": "当前会话",
    "workspace.members": "成员",
    "workspace.stage": "用 agent_teams_plan 拟定一个团队，然后批准它。",
    "phase.staged": "已拟定",
    "phase.active": "进行中",
    "phase.idle": "空闲",
    "phase.ended": "已结束",
    "executor.label": "执行器",
    "plan.members": "需要 {n} 名成员",
    "plan.tasks": "需要 {n} 个任务",
    "plan.gate": "批准请键入：",
    "kind.req": "需求",
    "kind.wrk": "工作",
    "kind.rev": "评审",
    "kind.fix": "修复",
    "kind.int": "集成",
    // ── D2：悬停卡片的词汇 ────────────────────────────────────────
    "visual.completed": "已完成",
    "visual.running": "进行中",
    "visual.blocked": "受阻",
    "visual.failed": "失败",
    "visual.cancelled": "已取消",
    "visual.open": "未开始",
    "visual.planned": "计划中",
    "tip.status": "状态",
    "tip.owner": "负责人",
    "tip.elapsed": "耗时",
    "tip.task": "任务",
    "tip.progress": "进度",
    "tip.unassigned": "未分配",
    "tip.notStarted": "尚未开始",
    "Lead": "队长",
    "Architect": "架构师",
    "Researcher": "研究员",
    "Planner": "规划师",
    "Deep Worker": "深度执行者",
    "Senior Engineer": "高级工程师",
    "Explorer": "探索者",
    "Reviewer": "审查者",
    "Plan Reviewer": "计划审查者",
    "Vision Analyst": "视觉分析师",
    "Junior Engineer": "初级工程师",
  }

  /**
   * The translator the shared team view renders with.
   *
   * COMMITTED BY THE TAB'S OWN MOUNT, because that is the only place a bound translator exists: the
   * view is constructed inside a render path that has no `ctx`. Until that mount the fallback answers,
   * so the view is never left without one — and once committed, the bound translator is followed for
   * the rest of the session, which is what makes a host language switch take effect on the next render.
   */
  let teamTranslator: ((key: string) => string) | undefined

  /**
   * Resolve one team-view key, preferring the tab's bound translator and falling back to English.
   *
   * TOTAL by construction: an unbound translator, a throw inside the host's, or a host that answers
   * the key itself all end at {@link TEAM_COPY_EN}, so a missing translation degrades to readable
   * English rather than to a raw key on screen.
   * @param key - the dictionary key the view asked for.
   * @returns the localized string, the English fallback, or the key when even that is absent.
   */
  function teamSay(key: string): string {
    if (teamTranslator !== undefined) {
      try {
        /** What the host's translator answered for this key. */
        const answered = teamTranslator(key)
        // A host that echoes the key back has no entry for it; the English table is the better answer.
        if (typeof answered === "string" && answered.length > 0 && answered !== key) return answered
      } catch {
        // A throwing host translator costs the translation, never the panel.
      }
    }
    return TEAM_COPY_EN[key] ?? key
  }

  /** The session the team sidebar last announced, so the line is logged once per session, not per render. */
  let announcedSidebarSession: string | undefined

  /**
   * Whether the client entry already reported that NO sidebar host is carrying the mpd panels.
   *
   * ONE LINE PER ENTRY, and the reason it is a module-scope flag rather than a local: the two
   * moments that learn the fact are different — a seam missing at apply time, and the settle
   * check registered at the end of {@link mountHarnessSidebar} — and a user debugging a GUI with no
   * Team tab needs EXACTLY ONE line that says so instead of a stream of them per poll.
   */
  let harnessSidebarReported = false

  /** The harness right sidebar's own seam ids, named once so the report and the injection cannot drift. */
  const HARNESS_SIDEBAR_SERVICES = "sidebarRightTabs + sidebarRight"

  /**
   * How long the client waits for a sidebar host to take the panels before it reports that NONE did.
   *
   * WHY A BOUNDED WAIT AND NOT DISPOSAL ALONE (D1/F5). The entry disposer fires at page unload, so a
   * profile with no reachable seat reported the problem only after the user had already given up on an
   * empty right sidebar. This bound is DERIVED FROM MEASUREMENT rather than chosen: the sidebar's own
   * provider was measured arriving `true` eight seconds after `apply()` (see {@link mountSidebarPages}),
   * and the settle check runs after the injection callbacks have had that whole window — so a seat that
   * is merely LATE has already registered and this line stays silent, while a profile that has no seat
   * at all is reported while the user is looking at the page.
   *
   * Exported so a TEST can shorten it: an arm that waits the production bound would spend eight seconds
   * per case, and a private knob behind a public seam is how the assertion stays honest instead of
   * being deleted for being slow.
   */
  let settleTimeoutMsValue = 8000

  /**
   * Which host took the mpd panels on the last mount, for the diagnostic to NAME.
   *
   * The settle check's whole value is the sentence it prints, and "NOTHING took it" is only half of
   * what the reader needs: naming the host that DID take the panels (or that they are contested) turns
   * a mystery into a fact. Written by {@link mountHarnessSidebar}, read by the settle line below — the
   * reader that a snapshot of a mount's own tallies would otherwise lack.
   */
  let harnessSidebarHost = ""

  /**
   * Report, at most once per client entry, that neither sidebar host is carrying the mpd panels.
   *
   * THE SILENT MODE THIS CLOSES (D1). With `dsh-better-sidebar` absent BY DESIGN the mpd panels ride
   * the harness's own right sidebar, whose services are reached through `ctx.inject` — and a missing
   * seam there produces NOTHING: no tab, no error, and (before this line) no diagnostic either, so
   * the user sees an empty GUI and no reason for it. The line states the reason and leaves the reader
   * with the one thing that still works, the ROUTES.
   * @param reason - why no sidebar host took the panels, phrased as a clause.
   */
  function reportNoHarnessSidebar(reason: string): void {
    if (harnessSidebarReported) return
    harnessSidebarReported = true
    // WHICH HOST, when one arrived late: "nothing took the panels" is the claim, and naming the host
    // that DID take them (after the bound, or on a remount) is the difference between a mystery and a
    // fact for whoever reads the console. Empty when neither host ever published.
    /** The host that took the panels, as the mount recorded it, or an empty string. */
    const host = harnessSidebarHost
    console.warn("[mpd] no sidebar host took the mpd panels: " + reason + (host === "" ? "" : " (the host that did take them: " + host + ")") + ". The Team and Workmate tabs are NOT registered; the workspace teams and the staged plan are still served on " + TEAM_STATE_PATH + " and " + TEAM_PLAN_PATH + ".");
  }

  /** The shared team view, built once per client entry; undefined when the splice is absent. */
  let teamView: { TeamView: (props?: unknown) => unknown } | undefined

  /** The React surface `require("react")` answers with, or undefined. */
  function reactSurface(): unknown {
    try { return require("react") } catch { return undefined }
  }

  /**
   * Build (once) the team view both sidebar hosts render.
   *
   * ONE body for both hosts is the point: they are different extension APIs with different prop shapes,
   * and a view written against either works only there. Both can `fetch`, so both read this bundle's
   * own route (`/plugins/mpd-team/state`) — the mpd RECORD — instead of the official client projection
   * this view used to read, which is empty in exactly the compositions the split exists for.
   * @returns the view, or undefined when the host has no React or the splice produced nothing.
   */
  function teamViewOf(): { TeamView: (props?: unknown) => unknown } | undefined {
    if (teamView !== undefined) return teamView
    /** The host's React, which the factory body builds elements with. */
    const react = reactSurface()
    if (react === undefined) return undefined
    if (typeof MPD_TEAM_VIEW !== "object" || MPD_TEAM_VIEW === null) return undefined
    try {
      teamView = MPD_TEAM_VIEW.createTeamView({
        react,
        statePath: TEAM_STATE_PATH,
        planPath: TEAM_PLAN_PATH,
        // The task route is what lets a pinned node quote its frozen contract; the translator is the
        // view's only language source (it runs in a render path with no `ctx` of its own). The events
        // route is what turns the poll into a push: the view subscribes per MOUNT, so the two sidebar
        // hosts that render this component each own one stream.
        taskPath: TEAM_TASK_PATH,
        eventsPath: TEAM_EVENTS_PATH,
        t: teamSay,
      })
      return teamView
    } catch (error) {
      console.warn("[mpd] the team view could not be built: " + String(error))
      return undefined
    }
  }
  /** Read one service from a context that has it in scope (never throws). */
  function readService(ctx: ClientContext, name: string): unknown {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a sidebar service already holds a descriptor for `id`.
   *
   * A service WITHOUT `getTab` answers `false` (register as before), so this guard can only
   * ever remove a duplicate registration — never suppress the first one.
   */
  function sidebarAlreadyHasTab(service: SidebarService, id: string): boolean {
    try {
      return typeof service.getTab === "function" && service.getTab(id) !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * The suffix that turns one primary tab id into its bottom-workbench duplicate's id.
   *
   * A SEPARATE TYPE, not a second surface of one type: 0.28's `bottomOnly` keeps a type out of the
   * native right Sidebar, so the workbench twin must be its own registration and its own id. The
   * suffix makes the relationship readable in the host's tab list and in a diagnostic.
   */
  const BOTTOM_TAB_SUFFIX = ":bottom";

  /**
   * Register the bottom-workbench twin of one primary descriptor (0.28 `bottomOnly`).
   *
   * The twin carries the SAME body, title, icon, order and `single`, and differs only in its id and
   * `bottomOnly`; it is registered through the same `ctx.betterSidebar` path as the primary, so a
   * profile without that host never reaches this function at all. Idempotent PER ID: a provider
   * remount re-fires the injecting scope and the host throws on a duplicate id.
   * @param ctx - the injection scope, which owns the disposer.
   * @param sidebar - the better-sidebar service.
   * @param primary - the already-built primary descriptor to twin.
   * @param label - the effect label, so a teardown names the tab it removed.
   * @returns whether the duplicate was registered (or was already present).
   */
  function registerBottomTab(ctx: ClientContext, sidebar: SidebarService, primary: SidebarTabDescriptor, label: string): boolean {
    /** The duplicate's own id, derived from the primary so the pair can never drift apart. */
    const id = primary.id + BOTTOM_TAB_SUFFIX;
    if (sidebarAlreadyHasTab(sidebar, id)) return true;
    try {
      ctx.effect(() => sidebar.registerTab({ ...primary, id, bottomOnly: true }), label);
      return true;
    } catch (error) {
      console.warn("[mpd] bottom-workbench tab registration failed for " + id + ": " + String(error));
      return false;
    }
  }

  /** The `/list` route the library page reads. */
  const LIST_URL = "/plugins/mpd-workmate/list";
  /** The `/init` route that creates one workmate. */
  const INIT_URL = "/plugins/mpd-workmate/init";
  /** The `/roster` route that offers the BASE templates. */
  const ROSTER_URL = "/plugins/mpd-workmate/roster";
  /** The `/get` route that answers one workmate's detail record. */
  const GET_URL = "/plugins/mpd-workmate/get";
  // Contract §D: mutations are POST-only and answer with a machine-readable `reason`,
  // which is what the page branches on (see failureReason).
  /** The `/rename` route (POST). */
  const RENAME_URL = "/plugins/mpd-workmate/rename";
  /** The `/delete` route (POST; archive-first, purge with confirmation). */
  const DELETE_URL = "/plugins/mpd-workmate/delete";
  /** The locale namespace this page's dictionaries are registered under. */
  const WORKMATE_LOCALE_NAMESPACE = "mpdWorkmate";
  // The DSH-better-sidebar tab type this bundle registers. It is the ONLY GUI
  // surface for the workmate library: the sidebar owns layout/opening, we only
  // contribute the page.
  /** The workmate tab's stable id. */
  const SIDEBAR_TAB_ID = "mpd-workmate";
  // Tab-strip label. The sidebar renders outside our React tree, so the title is a
  // plain string resolved at registration time; the sidebar's own i18n already names
  // every tab in the same place.
  /** The workmate tab's title, resolved at registration time. */
  const SIDEBAR_TAB_TITLE = "Workmates";
  /**
   * The workmate surfaces' one-line purpose.
   *
   * ONE constant for the better-sidebar descriptor AND the official right sidebar's guide entry, so
   * the two secondary surfaces cannot describe the same page differently.
   */
  const SIDEBAR_TAB_DESCRIPTION = "Durable agents from your library";

  // Dictionary namespace for the workmate page. zh is the key-set source of truth;
  // en is checked complete against it.
  /** The Simplified-Chinese dictionary of the workmate page. */
  const zh: Record<string, string | undefined> = {
    "tab.title": "Workmates",
    "panel.title": "Workmate 库（~/.mpd/workmate）",
    "panel.refresh": "刷新",
    "panel.loading": "加载中…",
    "panel.empty": "暂无 workmate — 请在下方初始化一个。",
    "panel.baseLabel": "Base（专家模板）",
    "panel.basePlaceholder": "base（例如 Deep Worker）",
    "panel.nameLabel": "名称（可选）",
    "panel.namePlaceholder": "名称（可选）",
    "panel.noteLabel": "备注（可选）",
    "panel.notePlaceholder": "备注（可选）",
    "panel.init": "初始化",
    "panel.initBusy": "…",
    "panel.readonly": "只读",
    "panel.uses": "uses={count}",
    "panel.filter": "筛选（名称 / 备注）",
    "panel.detail": "详情",
    "panel.back": "返回列表",
    "panel.persona": "Persona",
    "panel.memory": "Memory",
    "panel.note": "Note",
    "panel.lastTask": "最近任务",
    "panel.created": "创建",
    "panel.updated": "更新",
    "panel.model": "模型",
    "panel.rosterUnavailable": "roster 不可用，请手填 base 名称",
    "mutate.renameTitle": "重命名",
    "mutate.renameLabel": "新名称（仅限 [a-z0-9_-]）",
    "mutate.renamePlaceholder": "新名称",
    "mutate.rename": "重命名",
    "mutate.renameBusy": "重命名中…",
    "mutate.renameHint": "目录名即标识，重命名会同步更新 meta、note 与索引。",
    "mutate.deleteTitle": "删除",
    "mutate.delete": "删除",
    "mutate.archiveHint": "默认先归档：实例移入 ~/.mpd/workmate/.archive/，之后仍可恢复。",
    "mutate.archive": "归档",
    "mutate.archiveBusy": "归档中…",
    "mutate.purgeHint": "彻底删除会永久移除该实例，无法恢复。",
    "mutate.purge": "彻底删除",
    "mutate.purgeConfirmLabel": "输入名称以确认彻底删除",
    "mutate.purgeConfirm": "确认彻底删除",
    "mutate.purgeBusy": "彻底删除中…",
    "mutate.cancel": "取消",
    "mutate.renamed": "已重命名 {from} → {to}",
    "mutate.archived": "已归档 {name}",
    "mutate.purged": "已彻底删除 {name}",
    "mutate.reason.invalidName": "名称无效：只能使用小写字母、数字、下划线和连字符（[a-z0-9_-]）",
    "mutate.reason.sameKey": "新名称与当前名称相同",
    "mutate.reason.confirmRequired": "彻底删除需要输入完整名称以确认",
    "mutate.reason.unknown": "找不到该 workmate：它可能已被删除或归档，请刷新列表。",
    "mutate.reason.collision": "该名称已被占用，请换一个名称。",
    "mutate.reason.inUse": "该 workmate 正在被使用，已拒绝操作；请先结束或归档这些团队：{blocking}",
    "mutate.reason.failed": "操作失败"
  };
  /** The English dictionary, key-complete against `zh`. */
  const en: Record<string, string | undefined> = {
    "tab.title": "Workmates",
    "panel.title": "Workmate library (~/.mpd/workmate)",
    "panel.refresh": "Refresh",
    "panel.loading": "Loading…",
    "panel.empty": "No workmates yet — initialize one below.",
    "panel.baseLabel": "Base (roster template)",
    "panel.basePlaceholder": "base (e.g. Deep Worker)",
    "panel.nameLabel": "Name (optional)",
    "panel.namePlaceholder": "name (optional)",
    "panel.noteLabel": "Note (optional)",
    "panel.notePlaceholder": "note (optional)",
    "panel.init": "Init",
    "panel.initBusy": "…",
    "panel.readonly": "readonly",
    "panel.uses": "uses={count}",
    "panel.filter": "Filter (name / note)",
    "panel.detail": "Detail",
    "panel.back": "Back to list",
    "panel.persona": "Persona",
    "panel.memory": "Memory",
    "panel.note": "Note",
    "panel.lastTask": "Last task",
    "panel.created": "Created",
    "panel.updated": "Updated",
    "panel.model": "Model",
    "panel.rosterUnavailable": "roster unavailable — type the base name",
    "mutate.renameTitle": "Rename",
    "mutate.renameLabel": "New name ([a-z0-9_-] only)",
    "mutate.renamePlaceholder": "new name",
    "mutate.rename": "Rename",
    "mutate.renameBusy": "Renaming…",
    "mutate.renameHint": "The directory name is the key: a rename also updates meta, note and index.",
    "mutate.deleteTitle": "Delete",
    "mutate.delete": "Delete",
    "mutate.archiveHint": "Archive-first by default: the instance moves to ~/.mpd/workmate/.archive/ and stays restorable.",
    "mutate.archive": "Archive",
    "mutate.archiveBusy": "Archiving…",
    "mutate.purgeHint": "Purge removes the instance permanently and cannot be undone.",
    "mutate.purge": "Purge",
    "mutate.purgeConfirmLabel": "Type the name to confirm the purge",
    "mutate.purgeConfirm": "Confirm purge",
    "mutate.purgeBusy": "Purging…",
    "mutate.cancel": "Cancel",
    "mutate.renamed": "Renamed {from} → {to}",
    "mutate.archived": "Archived {name}",
    "mutate.purged": "Purged {name}",
    "mutate.reason.invalidName": "Invalid name: use lower-case letters, digits, underscores or hyphens ([a-z0-9_-])",
    "mutate.reason.sameKey": "The new name equals the current name",
    "mutate.reason.confirmRequired": "A purge must be confirmed with the exact name",
    "mutate.reason.unknown": "No such workmate: it may already be deleted or archived — refresh the list.",
    "mutate.reason.collision": "That name is already taken — pick another one.",
    "mutate.reason.inUse": "Refused: the workmate is in use. Finish or archive these teams first: {blocking}",
    "mutate.reason.failed": "The operation failed"
  };

  /** Fill `{name}` placeholders from `params`; a missing parameter keeps the placeholder. */
  function interpolate(template: unknown, params?: Record<string, unknown>): string {
    return String(template).replace(/\{(\w+)\}/g, (_m, key) =>
      params && params[key] !== undefined ? String(params[key]) : "{" + key + "}");
  }
  /** The page's translator: the host's own `t` when it passed one, else the English dictionary. */
  function translateFor(props: { t?: Translate } | undefined): Translate {
    if (props && typeof props.t === "function") return props.t;
    return (key: string, params?: Record<string, unknown>): string => interpolate(en[key] ?? key, params);
  }

  /** One workmate API call; a non-OK answer becomes a `RequestFailure` carrying status and body. */
  function request<T>(url: string, options?: RequestInit): Promise<T> {
    return fetch(url, options).then(async (res) => {
      if (!res.ok) {
        /** The failure body, or null when the route answered no JSON. */
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        // The wire protocol (contract §D) carries a machine-readable `reason` — and, for an
        // in-use refusal, the blocking team/member list. Collapsing the body into a bare
        // message here is what made the page unable to branch or to name the blocker, so the
        // whole body plus the status ride on the error.
        throw requestError(res.status, body);
      }
      return res.json();
    });
  }

  /** One failed response as an error carrying status + reason + the rest of the body. */
  function requestError(status: number, body: unknown): RequestFailure {
    // A route body is an untyped JSON object, and only its own fields are read below.
    /** The body when it is an object, else an empty record. */
    const payload: ApiBody = body !== null && typeof body === "object" ? body as ApiBody : {};
    /** Whether the body carried the server's own message. */
    const described = typeof payload.error === "string" && payload.error.trim() !== "";
    // TypeScript does not carry the `described` alias into this expression, so the string the
    // check above proved is asserted here (type-level only).
    /** The failure the page will branch on. */
    const error: RequestFailure = new Error(described ? payload.error as string : "HTTP " + String(status));
    error.status = status;
    error.body = payload;
    if (typeof payload.reason === "string") error.reason = payload.reason;
    if (Array.isArray(payload.blocking)) error.blocking = payload.blocking;
    return error;
  }

  /** The §D reason code of a failure (undefined for anything else). */
  function failureReason(error: RequestFailure | null | undefined): string | undefined {
    if (error === null || error === undefined) return undefined;
    if (typeof error.reason === "string" && error.reason !== "") return error.reason;
    /** The parsed body, when the failure carried one. */
    const body = error.body;
    if (body !== null && typeof body === "object" && typeof body.reason === "string" && body.reason !== "") return body.reason;
    return undefined;
  }

  /** The §E blocking team/member list of an in-use refusal, as plain `team/member` pairs. */
  function blockingEntries(error: RequestFailure | null | undefined): string[] {
    /** The raw entries, from the error itself or from its parsed body. */
    const raw: BlockingEntry[] = error !== null && error !== undefined && Array.isArray(error.blocking)
      ? error.blocking
      : (error?.body !== null && typeof error?.body === "object" && Array.isArray(error.body.blocking) ? error.body.blocking : []);
    return raw
      .map((entry) => {
        /** The team half of the pair, or "" when the entry does not name one. */
        const teamId = entry !== null && typeof entry === "object" && entry.teamId !== undefined ? String(entry.teamId) : "";
        /** The member half of the pair, or "" when the entry does not name one. */
        const member = entry !== null && typeof entry === "object" && entry.member !== undefined ? String(entry.member) : "";
        if (teamId !== "" && member !== "") return teamId + "/" + member;
        return teamId !== "" ? teamId : member;
      })
      .filter((pair) => pair !== "");
  }

  /**
   * Turn one failed mutation into a readable, REASON-SPECIFIC message. The five wire
   * failures are 400 invalid-name (which includes the same-key rename), 400
   * confirm-required, 404 unknown, 409 collision and 409 in-use — the last one names the
   * blocking teams, because a refusal nobody can act on is not a refusal (§E).
   */
  function describeFailure(error: RequestFailure | null | undefined, t: Translate): string {
    /** The machine-readable reason the page branches on. */
    const reason = failureReason(error);
    // `""` is not text: the page must fall back to its own dictionary instead of rendering
    // an empty alert.
    /** The server's own message, or "" when it sent none. */
    const server = typeof error?.message === "string" && error.message !== "" ? error.message : "";
    /** The blocking pairs of an in-use refusal. */
    const blocking = blockingEntries(error);
    switch (reason) {
      case "invalid-name":
        // The server also uses this reason for a same-key rename; its own text says which.
        return server !== "" && server !== "HTTP " + String(error?.status) ? server : t("mutate.reason.invalidName");
      case "confirm-required":
        return t("mutate.reason.confirmRequired");
      case "unknown":
        return t("mutate.reason.unknown");
      case "collision":
        return t("mutate.reason.collision");
      case "in-use":
        return blocking.length > 0
          ? t("mutate.reason.inUse", { blocking: blocking.join(", ") })
          : t("mutate.reason.inUse", { blocking: t("mutate.reason.failed") });
      default:
        return server !== "" ? server : t("mutate.reason.failed");
    }
  }

  // ── Workmate library ───────────────────────────────────────────────────────
  // The library is contributed as a DSH-better-sidebar tab — the ONLY host, exactly
  // like the AgentTeams page: the sidebar owns layout, opening and enable/disable, and
  // this bundle contributes nothing else (no overlay floater, no footer toggle). A
  // profile without DSH-better-sidebar simply has no workmate GUI.
  /** The page's outer flex column, filling the tab body. */
  const SURFACE_STYLE: Style = {
    display: "flex", flexDirection: "column", gap: 8, minHeight: 0, height: "100%",
    padding: 10, fontSize: 13, color: "inherit", fontFamily: "system-ui, sans-serif", boxSizing: "border-box",
  };
  /** The secondary-text colour used for labels and hints. */
  const MUTED: Style = { color: "rgba(128,128,128,0.95)" };
  /** The outline button style every action in this page uses. */
  const BUTTON_STYLE: Style = { cursor: "pointer", border: "1px solid rgba(128,128,128,0.35)", borderRadius: 6, background: "transparent", color: "inherit", padding: "3px 8px", fontSize: 12 };
  /** The text-input style every field in this page uses. */
  const INPUT_STYLE: Style = { padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit", fontSize: 12, width: "100%", boxSizing: "border-box" };

  /** The library page: list + detail + initialize form. Host-agnostic. */
  function WorkmateLibraryView(props: WorkmateLibraryProps | undefined): unknown {
    /** The translator for this render. */
    const t = translateFor(props);
    /** The library's instances, or null until the first list answer. */
    const [workmates, setWorkmates] = react.useState<Workmate[] | null>(null);
    /** The roster's BASE templates, or null until the first roster answer. */
    const [bases, setBases] = react.useState<RosterBase[] | null>(null);
    /** The last page-level failure, rendered as an alert. */
    const [error, setError] = react.useState<string | null>(null);
    /** The list filter text. */
    const [filter, setFilter] = react.useState("");
    /** The BASE template the initialize form will use. */
    const [base, setBase] = react.useState("");
    /** The optional name for the instance being initialized. */
    const [name, setName] = react.useState("");
    /** The optional note for the instance being initialized. */
    const [note, setNote] = react.useState("");
    /** Whether the initialize request is in flight. */
    const [busy, setBusy] = react.useState(false);
    /** The key of the instance whose detail pane is open. */
    const [selected, setSelected] = react.useState<string | null>(null);
    /** The open instance's detail record, or null while it loads (or failed). */
    const [detail, setDetail] = react.useState<WorkmateDetail | null>(null);
    // Mutation surface: rename input, the explicit delete confirmation step (D1) and the
    // two message lanes. A mutation message outlives a refresh — only the next mutation
    // clears it — so it cannot share the load-error state.
    /** The rename field's value (it starts at the current key). */
    const [renameTo, setRenameTo] = react.useState("");
    /** Which delete outcome the confirmation step is showing, or null before the first click. */
    const [confirming, setConfirming] = react.useState<string | null>(null);
    /** The purge confirmation text, which must equal the instance name. */
    const [purgeText, setPurgeText] = react.useState("");
    /** Whether a mutation request is in flight. */
    const [mutating, setMutating] = react.useState(false);
    /** The last mutation failure, rendered as its own alert. */
    const [mutationError, setMutationError] = react.useState<string | null>(null);
    /** The last mutation success message. */
    const [notice, setNotice] = react.useState<string | null>(null);

    /** Reload the library list and the roster (both requests are independent). */
    const refresh = react.useCallback(() => {
      request<WorkmateListResponse>(LIST_URL)
        .then((data) => { setWorkmates(data.workmates ?? []); setError(null); })
        .catch((e) => { setError(String(e?.message ?? e)); setWorkmates([]); });
      request<RosterResponse>(ROSTER_URL)
        .then((data) => { setBases(data.bases ?? []); setBase((prev) => prev || String((data.bases ?? [])[0]?.name ?? "")); })
        .catch(() => setBases([]));
    }, []);
    react.useEffect(() => { refresh(); }, [refresh]);

    /** Open one instance's detail pane and load its record. */
    const openDetail = (workmateName: string): void => {
      setSelected(workmateName);
      setDetail(null);
      // A fresh load clears the previous failure: the pane renders its error state whenever
      // `detail` is null, so a stale error must not outlive the retry that fixes it (t8 L4).
      setError(null);
      // The rename field starts AT the current key: the directory name IS the key, so the
      // useful thing to show is the name being changed, not an empty box.
      setRenameTo(workmateName);
      setConfirming(null);
      request<WorkmateDetail>(GET_URL + "?name=" + encodeURIComponent(workmateName))
        .then((data) => setDetail(data))
        .catch((e) => {
          setError(String(e?.message ?? e));
          // A key that no longer resolves must not stay selected (contract §H: no stale
          // selection) — the rename/delete response is authoritative and lands here when
          // the instance is gone.
          if (failureReason(e) === "unknown") closeDetail();
        });
    };
    /** Create one workmate from the chosen BASE template. */
    const submit = (ev: FormEvent): void => {
      ev.preventDefault();
      /** The BASE template name, trimmed (an empty one disables the form). */
      const chosen = base.trim();
      if (busy || chosen === "") return;
      setBusy(true);
      /** The initialize request's JSON body (name and note are omitted when blank). */
      const body = JSON.stringify({ base: chosen, name: name.trim() || undefined, note: note.trim() || undefined });
      request<MutationResponse>(INIT_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        .then(() => { setBusy(false); setName(""); setNote(""); refresh(); })
        .catch((e) => { setBusy(false); setError(String(e?.message ?? e)); });
    };

    /** Leave the detail pane and reset the mutation surface (per-workmate state). */
    const closeDetail = (): void => {
      setSelected(null);
      setDetail(null);
      setRenameTo("");
      setConfirming(null);
      setPurgeText("");
      setMutationError(null);
    };

    /**
     * Run one library mutation. The detail pane must never keep pointing at a key that no
     * longer exists (contract §H): a rename follows the new key, a delete leaves detail.
     */
    const runMutation = (url: string, body: unknown, onSuccess: (data: MutationResponse) => void): void => {
      if (mutating) return;
      setMutating(true);
      setMutationError(null);
      setNotice(null);
      request<MutationResponse>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then((data) => {
          setMutating(false);
          setConfirming(null);
          setPurgeText("");
          setRenameTo("");
          onSuccess(data ?? {});
          refresh();
        })
        .catch((e) => {
          setMutating(false);
          setMutationError(describeFailure(e, t));
        });
    };

    /** Rename the selected instance (a same-key rename is refused locally, §M2). */
    const submitRename = (ev: FormEvent): void => {
      ev.preventDefault();
      if (selected === null) return;
      /** The requested new key, trimmed. */
      const next = renameTo.trim();
      if (next === "") return;
      // The same-key rename is refused HERE, which is what makes `mutate.reason.sameKey`
      // reachable: the server answers 400 invalid-name for this case, so without a local
      // check its dictionary entry could never be shown (t8 L1). A name that merely
      // SANITIZES to the current key (e.g. `GUI-alice`) still goes to the server, whose own
      // text is authoritative there (§M2).
      if (next === selected) {
        setNotice(null);
        setMutationError(t("mutate.reason.sameKey"));
        return;
      }
      /** The key being renamed away from. */
      const from = selected;
      runMutation(RENAME_URL, { name: from, new_name: next }, (data) => {
        /** The key the server actually landed on (its sanitized answer, else the request). */
        const to = typeof data.name === "string" && data.name !== "" ? data.name : next;
        setNotice(t("mutate.renamed", { from, to }));
        openDetail(to);
      });
    };

    /** Archive or purge the selected instance. */
    const submitDelete = (purge: boolean): void => {
      if (selected === null) return;
      /** The key being deleted. */
      const from = selected;
      runMutation(DELETE_URL, purge ? { name: from, purge: true, confirm: purgeText.trim() } : { name: from }, () => {
        setNotice(purge ? t("mutate.purged", { name: from }) : t("mutate.archived", { name: from }));
        closeDetail();
      });
    };

    /** The filter text, normalized once per render. */
    const needle = filter.trim().toLowerCase();
    /** The instances the filter keeps, matched on name, note and BASE name. */
    const rows = (workmates ?? []).filter((w) => needle === ""
      || String(w.name).toLowerCase().includes(needle)
      || String(w.note ?? "").toLowerCase().includes(needle)
      || String(w.baseName ?? "").toLowerCase().includes(needle));

    if (selected !== null) {
      /** The open instance's record (null while it loads or after a failure). */
      const d = detail;
      /** One detail section, or null when the record has no text for it. */
      const section = (title: string, body: unknown): unknown => body === undefined || body === null || String(body).trim() === "" ? null
        : react.createElement("div", { style: { marginTop: 8 } },
            react.createElement("div", { style: { fontWeight: 600, marginBottom: 2 } }, title),
            react.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "inherit", ...MUTED } }, String(body)),
          );
      return react.createElement("div", { style: SURFACE_STYLE },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          react.createElement("button", { type: "button", onClick: closeDetail, style: BUTTON_STYLE }, "← " + t("panel.back")),
          react.createElement("span", { style: { fontWeight: 700 } }, selected),
        ),
        error ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)) : null,
        notice !== null ? react.createElement("div", { role: "status", style: { ...MUTED, fontSize: 12 } }, String(notice)) : null,
        // ── Library administration (contract §D/§F/§M1) ──────────────────────
        // Rename and delete target THIS instance. A readonly workmate is a valid target:
        // the readonly discipline governs its own spawn, not the library it lives in.
        react.createElement("form", { onSubmit: submitRename, style: { display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 8 } },
          react.createElement("div", { style: { fontWeight: 600, fontSize: 12 } }, t("mutate.renameTitle")),
          react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("mutate.renameHint")),
          react.createElement("input", {
            value: renameTo, onChange: (e: ChangeEvent) => setRenameTo(e.target.value),
            placeholder: t("mutate.renamePlaceholder"), "aria-label": t("mutate.renameLabel"), style: INPUT_STYLE,
          }),
          react.createElement("button", {
            type: "submit", disabled: mutating || renameTo.trim() === "",
            style: { ...BUTTON_STYLE, opacity: mutating || renameTo.trim() === "" ? 0.5 : 1 },
          }, mutating ? t("mutate.renameBusy") : t("mutate.rename")),
        ),
        react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 8 } },
          react.createElement("div", { style: { fontWeight: 600, fontSize: 12 } }, t("mutate.deleteTitle")),
          // D1: nothing is removed on the FIRST click — the confirmation step is explicit
          // and says which of the two outcomes the button performs.
          confirming === null
            ? react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming("archive"); setPurgeText(""); setMutationError(null); }, style: BUTTON_STYLE }, t("mutate.delete")),
              )
            : confirming === "archive"
              ? react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                  react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("mutate.archiveHint")),
                  react.createElement("div", { style: { display: "flex", gap: 6 } },
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => submitDelete(false), style: BUTTON_STYLE },
                      mutating ? t("mutate.archiveBusy") : t("mutate.archive")),
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming(null); setPurgeText(""); }, style: BUTTON_STYLE }, t("mutate.cancel")),
                  ),
                )
              : react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                  react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("mutate.purgeHint")),
                  react.createElement("input", {
                    value: purgeText, onChange: (e: ChangeEvent) => setPurgeText(e.target.value),
                    placeholder: t("mutate.purgeConfirmLabel"), "aria-label": t("mutate.purgeConfirmLabel"), style: INPUT_STYLE,
                  }),
                  react.createElement("div", { style: { display: "flex", gap: 6 } },
                    react.createElement("button", {
                      type: "button", disabled: mutating || purgeText.trim() !== selected,
                      "aria-disabled": mutating || purgeText.trim() !== selected,
                      onClick: () => submitDelete(true),
                      style: { ...BUTTON_STYLE, opacity: mutating || purgeText.trim() !== selected ? 0.5 : 1 },
                    }, mutating ? t("mutate.purgeBusy") : t("mutate.purgeConfirm")),
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming("archive"); setPurgeText(""); }, style: BUTTON_STYLE }, t("mutate.archive")),
                    react.createElement("button", { type: "button", disabled: mutating, onClick: () => { setConfirming(null); setPurgeText(""); }, style: BUTTON_STYLE }, t("mutate.cancel")),
                  ),
                ),
          react.createElement("button", {
            type: "button",
            onClick: () => { setConfirming("purge"); setPurgeText(""); setMutationError(null); },
            style: { ...BUTTON_STYLE, borderColor: "rgba(200,60,60,0.5)" },
          }, t("mutate.purge")),
        ),
        mutationError !== null ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(mutationError)) : null,
        // t8 L4: a detail load that FAILED must say so. Rendering the loading text whenever
        // `detail` is null left the pane spinning forever beside the error banner for every
        // failure reason other than `unknown` — that one alone closes the pane (no stale
        // selection, contract §H), so every other reason needed its own visible outcome.
        d === null
          ? (error === null
            ? react.createElement("div", { style: MUTED }, t("panel.loading"))
            : react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)))
          : react.createElement("div", { style: { overflowY: "auto" } },
          react.createElement("div", { style: MUTED },
            String(d.baseName ?? ""),
            d.readonly ? " · " + t("panel.readonly") : "",
            d.uses !== undefined ? " · " + t("panel.uses", { count: d.uses }) : "",
          ),
          react.createElement("div", { style: { ...MUTED, fontSize: 12, marginTop: 2 } },
            t("panel.model") + ": " + String(d.provider ?? "") + " / " + String(d.model ?? ""),
            d.updatedAt ? " · " + t("panel.updated") + " " + String(d.updatedAt).slice(0, 10) : "",
          ),
          d.lastTask ? section(t("panel.lastTask"), d.lastTask) : null,
          section(t("panel.note"), d.note),
          section(t("panel.persona"), d.persona),
          section(t("panel.memory"), d.memory),
        ),
      );
    }

    return react.createElement("div", { style: SURFACE_STYLE },
      react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
        react.createElement("span", { style: { fontWeight: 700, flex: 1 } }, t("panel.title")),
        react.createElement("button", { type: "button", onClick: refresh, style: BUTTON_STYLE, title: t("panel.refresh") }, t("panel.refresh")),
      ),
      error ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)) : null,
      notice !== null ? react.createElement("div", { role: "status", style: { ...MUTED, fontSize: 12 } }, String(notice)) : null,
      react.createElement("input", {
        value: filter, onChange: (e: ChangeEvent) => setFilter(e.target.value), placeholder: t("panel.filter"),
        "aria-label": t("panel.filter"), style: INPUT_STYLE,
      }),
      react.createElement("div", { style: { flex: 1, minHeight: 80, overflowY: "auto" } },
        error ? null
          : workmates === null ? react.createElement("div", { style: MUTED }, t("panel.loading"))
          : rows.length === 0 ? react.createElement("div", { style: MUTED }, t("panel.empty"))
          : rows.map((w) => react.createElement("div", {
              key: w.name,
              style: { padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.2)", cursor: "pointer" },
              onClick: () => openDetail(w.name),
              title: t("panel.detail"),
            },
              react.createElement("div", { style: { fontWeight: 600 } },
                w.name,
                react.createElement("span", { style: { ...MUTED, fontWeight: 400, marginLeft: 8 } },
                  String(w.baseName ?? ""), w.readonly ? " · " + t("panel.readonly") : "", " · " + t("panel.uses", { count: w.uses })),
              ),
              react.createElement("div", { style: { ...MUTED, fontSize: 12, whiteSpace: "pre-wrap" } }, String(w.note ?? "")),
            )),
      ),
      react.createElement("form", { onSubmit: submit, style: { display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 8 } },
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.baseLabel")),
          (bases ?? []).length > 0
            ? react.createElement("select", { value: base, onChange: (e: ChangeEvent) => setBase(e.target.value), style: INPUT_STYLE, "aria-label": t("panel.baseLabel") },
                (bases ?? []).map((b) => react.createElement("option", { key: b.name, value: b.name }, b.name + (b.readonly ? " · " + t("panel.readonly") : ""))))
            : react.createElement("input", { placeholder: t("panel.basePlaceholder"), value: base, onChange: (e: ChangeEvent) => setBase(e.target.value), style: INPUT_STYLE }),
        ),
        bases !== null && (bases ?? []).length === 0 ? react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("panel.rosterUnavailable")) : null,
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.nameLabel")),
          react.createElement("input", { placeholder: t("panel.namePlaceholder"), value: name, onChange: (e: ChangeEvent) => setName(e.target.value), style: INPUT_STYLE }),
        ),
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.noteLabel")),
          react.createElement("input", { placeholder: t("panel.notePlaceholder"), value: note, onChange: (e: ChangeEvent) => setNote(e.target.value), style: INPUT_STYLE }),
        ),
        react.createElement("button", { type: "submit", disabled: busy || base.trim() === "", style: { ...BUTTON_STYLE, opacity: busy || base.trim() === "" ? 0.5 : 1 } }, busy ? t("panel.initBusy") : t("panel.init")),
      ),
    );
  }

  /**
   * Register the library as a DSH-better-sidebar tab. The sidebar service is passed in
   * because it must be RESOLVED through `ctx.inject` (see mountSidebarPages) — a probe at
   * apply() time races the provider and always loses. The descriptor owns the tab type, its
   * + menu entry and its page component; there is no floating fallback by decision,
   * mirroring the AgentTeams page.
   */
  // The tab id is named apart from the OFFICIAL sidebar's registration further down: the two hosts
  // keep separate id spaces, and reusing one name for both invited exactly the collision the compiler
  // caught. The watchdog page keeps its own `mpd-agent-teams` id, so all three are distinct.
  /** The better-sidebar tab id for the MPD team view. */
  const TEAM_PAGE_TAB_ID = "mpd-team";
  /** Where the team tab sits among the host's tabs: before the watchdog page, after the builtins. */
  const TEAM_TAB_ORDER = 80;
  /** The team tab's title, shared by the better-sidebar descriptor and its bottom-workbench twin. */
  const TEAM_TAB_TITLE = "Team";
  /**
   * The team surfaces' one-line purpose.
   *
   * The same sentence is the English `mpdTeamSidebar.guide.description` the official right sidebar's
   * guide entry resolves, so both secondary surfaces describe the page identically.
   */
  const TEAM_TAB_DESCRIPTION = "Roster and shared task progress for this session";

  /**
   * Register the MPD TEAM tab on `dsh-better-sidebar` — the PREFERRED host.
   *
   * ONE BODY, TWO HOSTS. The component is the shared team view ({@link teamViewOf}), which reads
   * this bundle's own route; a host that cannot fetch renders it as the empty state, and the tab
   * still opens. Where the two hosts differ is only registration.
   * @param ctx - the injection scope, which owns the disposer.
   * @param sidebar - the better-sidebar service.
   * @returns whether the tab was registered.
   */
  function registerTeamSidebarTab(ctx: ClientContext, sidebar: SidebarService): boolean {
    if (typeof sidebar.registerTab !== "function") return false;
    // IDEMPOTENT by descriptor presence: `ctx.inject` re-fires when the provider remounts and the
    // host's `registerTab` THROWS on a duplicate id (the same rule the workmate tab follows).
    if (sidebarAlreadyHasTab(sidebar, TEAM_PAGE_TAB_ID)) return true;
    /** The shared view, or undefined when this host has no React to build it with. */
    const view = teamViewOf();
    if (view === undefined) return false;
    /**
     * The PRIMARY descriptor. The bottom-workbench twin is derived from it verbatim, which is what
     * keeps title, icon, order, `single` and the body identical between the two surfaces.
     */
    const descriptor: SidebarTabDescriptor = {
      id: TEAM_PAGE_TAB_ID,
      title: () => TEAM_TAB_TITLE,
      description: TEAM_TAB_DESCRIPTION,
      icon: () => "◆",
      order: TEAM_TAB_ORDER,
      single: true,
      component: (props: unknown) => view.TeamView(props),
    };
    ctx.effect(() => sidebar.registerTab(descriptor), "mpd: team sidebar tab");
    registerBottomTab(ctx, sidebar, descriptor, "mpd: team bottom tab");
    return true;
  }

  /**
   * Register the library as a DSH-better-sidebar tab. The sidebar service is passed in
   * because it must be RESOLVED through `ctx.inject` (see mountSidebarPages) — a probe at
   * apply() time races the provider and always loses. The descriptor owns the tab type, its
   * + menu entry and its page component; there is no floating fallback by decision,
   * mirroring the AgentTeams page.
   */
  function registerWorkmateSidebarTab(ctx: ClientContext, sidebar: SidebarService): boolean {
    if (typeof sidebar.registerTab !== "function") return false;
    // IDEMPOTENT by descriptor presence: `ctx.inject` re-fires when the provider remounts,
    // and the sidebar's own `registerTab` THROWS on a duplicate id. Re-checking through the
    // service's own registry both absorbs a re-fire and RESTORES the tab after a remount
    // that lost it, instead of reporting a failure the user sees as "the tab is gone".
    if (sidebarAlreadyHasTab(sidebar, SIDEBAR_TAB_ID)) return true;
    try {
      /**
       * The PRIMARY descriptor. The bottom-workbench twin is derived from it verbatim, which is what
       * keeps title, icon, order, `single` and the body identical between the two surfaces.
       */
      const descriptor: SidebarTabDescriptor = {
        id: SIDEBAR_TAB_ID,
        title: () => SIDEBAR_TAB_TITLE,
        description: SIDEBAR_TAB_DESCRIPTION,
        icon: (size: number) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F916}"),
        order: 90,
        single: true,
        component: (props: WorkmateLibraryProps | undefined) => react.createElement(WorkmateLibraryView, { t: translateFor({ t: props && props.t }) }),
      };
      ctx.effect(() => sidebar.registerTab(descriptor), "mpd-workmate: sidebar tab");
      registerBottomTab(ctx, sidebar, descriptor, "mpd-workmate: bottom tab");
      return true;
    } catch (error) {
      console.warn("[mpd] workmate sidebar tab registration failed: " + String(error));
      return false;
    }
  }

  /**
   * Load the AgentTeams page module defensively: a missing or broken module must cost the
   * team page ONLY — never the workmate page beside it, and never the client entry.
   */
  function loadTeamPage(): TeamPageModule {
    try {
      // The module loader hands back its own registration; the shape is checked below, so the
      // cast is how an untyped `require` boundary enters the typed page contract.
      /** The sibling client module, whose surface is not trusted until it is probed. */
      const teamPage = require("@mpd-dsh/team-page") as TeamPageModule | null | undefined;
      if (teamPage !== undefined && teamPage !== null && typeof teamPage.registerTeamSidebarTab === "function") {
        return teamPage;
      }
      console.warn("[mpd] AgentTeams sidebar file exposes no registerTeamSidebarTab — the team page is unavailable");
    } catch (error) {
      console.warn("[mpd] AgentTeams sidebar file failed to load: " + String(error));
    }
    return { registerTeamSidebarTab: () => false };
  }

  /**
   * Load the mpd settings card module defensively. It is an ADDITIVE feature: a missing or broken
   * card must cost the card ONLY — never the sidebar pages and never the client entry (a throwing
   * client entry fails the whole page as `entry: pending`).
   */
  function loadSettingsCard(): SettingsCardModule {
    // THE SPLICED CARD FIRST. `require("@mpd-dsh/settings-card")` asks the module loader for a
    // SIBLING `__ModuleLoader__.load` block, and the loader's require map only serves the
    // modules it owns — measured on a real checkout install 2026-09-27: the Settings dialog
    // rendered General / Models / Built-in plugins / Agent presets and NO mpd section, because
    // the mount had degraded to its warn-and-return-false branch. The build now splices the
    // card's own factory body into THIS module (the one the registry actually APPLIES), so the
    // real app never needs the sibling lookup; the `require` path stays as the fallback the
    // offline harness uses.
    if (typeof MPD_SETTINGS_CARD === "object" && MPD_SETTINGS_CARD !== null) return MPD_SETTINGS_CARD;
    try {
      /** The sibling card module, whose surface is not trusted until it is probed. */
      const card = require("@mpd-dsh/settings-card") as SettingsCardModule | null | undefined;
      if (card !== undefined && card !== null && typeof card.mountSettingsCard === "function") return card;
      console.warn("[mpd] settings card module exposes no mountSettingsCard — the mpd card is unavailable");
    } catch (error) {
      console.warn("[mpd] settings card module failed to load: " + String(error));
    }
    return { mountSettingsCard: () => false };
  }

  /** The element factory, bound once for the Team tab's terser render tree. */
  const h = react.createElement;
  /** The workmate tab's stable id in the harness right sidebar's registry. */
  const WORKMATE_TAB_ID = "@mpd-dsh/workmate-sidebar";
  /** The workmate tab's kind (the tab registry keys open tabs on it). */
  const WORKMATE_TAB_KIND = "mpd-workmate";
  /** The shortcut that opens the workmate tab, named by its guide entry. */
  const WORKMATE_COMMAND_ID = "mpd-workmate.new";

  /**
   * The workmate library seat in the harness right sidebar.
   *
   * The library view reads only a translator, so this seat builds the same element the
   * better-sidebar descriptor does — one view, two hosts, exactly like the team tab beside it. The
   * seat's own props carry no translator, so the bound one from this module's locale is used.
   * @param props - seat props from `sidebar.right.pane.tab`.
   * @returns the library element.
   */
  function WorkmateSidebarBody(props: { t?: Translate } | undefined): unknown {
    return react.createElement(WorkmateLibraryView, { t: translateFor({ t: props && props.t }) });
  }
  /** The Team tab's stable id. */
  const TEAM_TAB_ID = "@mpd-dsh/team-sidebar";
  /** The Team tab's kind (the tab registry keys open tabs on it). */
  const TEAM_TAB_KIND = "mpd-team";

  /** Status → the colour a reader must be able to tell apart at a glance. */
  const STATUS_COLOR: Record<string, string | undefined> = {
    running: "#22a06b",
    active: "#22a06b",
    completed: "#22a06b",
    provisioning: "#c98a12",
    in_progress: "#2f6fed",
    inactive: "#8a8f98",
    pending: "#8a8f98",
    failed: "#d64545",
    deleted: "#c9ccd1",
  };

  /** The secondary text style of the team tab. */
  const dim: Style = { color: "var(--dsh-color-text-secondary, #8a8f98)", fontSize: "11px" };
  /** The single-line ellipsis style for member and task names. */
  const ellipsis: Style = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
  /** One member or task row of the board. */
  const rowStyle: Style = { display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", minWidth: 0 };
  /** A small status dot in the given colour. */
  const dot = (color: string): Style => ({ width: "7px", height: "7px", borderRadius: "50%", flex: "0 0 auto", background: color });
  /** A status chip in the given colour. */
  const chip = (color: string): Style => ({
    display: "inline-block", padding: "0 6px", borderRadius: "9px", fontSize: "10px", lineHeight: "16px",
    border: "1px solid " + color, color, whiteSpace: "nowrap", flex: "0 0 auto",
  });

  /**
   * The tab body: roster + shared task board + a completion bar.
   *
   * @param props - seat props from `sidebar.right.pane.tab`; `sessionId` comes from the seat's
   *   own `inject`, and `useSessions`/`useSession` from the primitives package.
   */
  function TeamSidebarBody(props: TeamSidebarProps): unknown {
    // ── ONE BODY, TWO HOSTS ────────────────────────────────────────────────────
    // This used to read the OFFICIAL client projection
    // (`useSessions(s => s.projectionsBySession[leadId].values.agentTeam)`), which is the last place
    // the official plugin was still the source of truth — and a store that is EMPTY in exactly the
    // compositions the split exists for, because a client store can only carry what a mounted
    // service projected. It now renders the SAME component the better-sidebar tab does, over this
    // bundle's own route, so the two hosts cannot disagree about what the team is.
    /** The shared team view, or undefined when this host has no React to build it with. */
    const view = teamViewOf();
    if (view === undefined) {
      return h("div", { style: { padding: "12px", fontSize: "12px", ...dim } },
        "The team view is unavailable in this client build.");
    }
    // ANNOUNCE THE SESSION THIS SEAT RENDERS, ONCE. The value is the only place the panel's own view
    // of "which session am I" is observable from outside, and a verification run needs exactly that:
    // MEASURED 2026-10-05, a capture that seeded a session IT created kept reading an empty panel,
    // because the app renders a session of its own choosing. One `[mpd…]` line lets the driver seed
    // the RIGHT session (the console collector already keeps every such line for the report).
    /** The session this seat's props name, whichever spelling the host used. */
    const seatSession = sessionIdOfSeat(props)
    if (seatSession !== "" && announcedSidebarSession !== seatSession) {
      announcedSidebarSession = seatSession
      console.info("[mpd] team sidebar session: " + seatSession)
    }
    // The seat's own props are forwarded VERBATIM, which is what makes the two hosts work with one
    // body: the harness right sidebar passes `sessionId` directly (verified in the DOM 2026-10-05 —
    // the prop bag carried `useSessions,useSessionStatus,useSessionRetainInfo,sessionId,useSession,…`
    // and the view fetched all three routes with that id), while the better-sidebar host spells the
    // same fact differently. Nothing here needs to know which host this is.
    return view.TeamView(props);
  }

  /**
   * Read the session id off a seat's props, whichever spelling the host used.
   *
   * The two sidebar hosts pass the same FACT in different shapes — the harness's right sidebar puts
   * `sessionId` on the props directly, while a nested `scope.sessionId` is the other spelling this
   * bundle has seen — so the reader tolerates both and answers "" when neither is present.
   * @param props - the seat props as the host supplied them.
   * @returns the session id, or an empty string when the props carry none.
   */
  function sessionIdOfSeat(props: unknown): string {
    /** The props as a bag, so an unknown host shape can be read without a cast at each use. */
    const bag = (props ?? {}) as { sessionId?: unknown; scope?: { sessionId?: unknown } }
    /** The direct spelling first, then the nested one. */
    const value = bag.sessionId ?? bag.scope?.sessionId
    return typeof value === "string" ? value : ""
  }

  /** Whether one harness-sidebar registration was accepted on the last mount — see the settle check below. */
  let harnessSidebarRegistered: number = 0

  /**
   * Whether `dsh-better-sidebar` took the panels on the last mount.
   *
   * The settle check asks "did NOTHING take the mpd panels?", and in a profile that mounts BOTH hosts
   * the harness seat resolves and its callback backs off deliberately — leaving the counter at zero
   * for a perfectly healthy composition. This latch is what tells those two states apart, so the loud
   * line is emitted exactly when the panels are really unreachable.
   *
   * Both are SNAPSHOTS of the last `mountHarnessSidebar` call, never its working state: the counters
   * it decides with are local to that call, so a teardown that lands after a later arm re-mounted the
   * sidebar cannot read that arm's numbers.
   */
  let betterSidebarPreferred: boolean = false

  /**
   * Publish what one mount settled on, so the exported diagnostics and the settle line read a
   * coherent set.
   *
   * Named rather than inlined because the mount now publishes from TWO points: the early preference
   * probe (which returns before the fallback runs) and the end of a completed mount, where a late
   * harness seat may have registered after the snapshot was already written.
   * @param preferred - whether `dsh-better-sidebar` took the panels on this mount.
   * @param registered - how many harness-sidebar registrations the seat accepted.
   */
  function publishSettle(preferred: boolean, registered: number): void {
    harnessSidebarRegistered = registered
    betterSidebarPreferred = preferred
    harnessSidebarHost = preferred ? "dsh-better-sidebar" : registered > 0 ? "the harness right sidebar" : ""
  }

  /** The harness-sidebar Team tab, contributed by the bundle's ONE applied client module. */
  function mountHarnessSidebar(ctx: ClientContext): void {
    // THIS CALL'S OWN TALLIES, not factory state: the settle check below closes over them, so what it
    // reports is what THIS mount did. A reload of the client module in an offline harness re-runs
    // `apply`, and a value shared across mounts would let one arm's outcome silence another's report.
    /** How many tab registrations this mount's fallback attempt got accepted. */
    let registered: number = 0
    /** Whether this mount found `dsh-better-sidebar` and deliberately left the fallback alone. */
    let preferred: boolean = false
    // ── THE PREFERENCE, PROBED EARLY AS WELL AS IN THE GATE ──────────────────────
    // The gate inside the `sidebarRightTabs + sidebarRight` callback is the AUTHORITATIVE check (the
    // latest knowable moment). This early probe answers the OTHER composition, and it is not a race:
    // `betterSidebar` is visible here exactly when that service is a plain registry entry — which is
    // how the client framework hands out a service that is up at apply time — while a plugin-fiber
    // service stays invisible to a bare probe and is caught by the callback instead. Without this
    // half, a profile mounting BOTH hosts but never publishing the harness SEAT would wait out the
    // bounded settle and report a problem neither host has (measured in the offline harness, where
    // the seat is exactly that absent).
    /** Whether `dsh-better-sidebar` is already visible to a plain probe. */
    const preferredEarly: boolean = typeof ctx.get === "function" && ((): boolean => {
      try { return ctx.get("betterSidebar") !== undefined && ctx.get("betterSidebar") !== null } catch { return false }
    })()
    if (preferredEarly) {
      // The preferred host owns the panels: latch it and leave the fallback (and the settle report) alone.
      preferred = true
      publishSettle(preferred, registered)
      return
    }
    // DEGRADE, NEVER TAKE THE ENTRY DOWN. `ctx.inject` is a client-framework seam: a
    // composition (or the offline client harness) without it must simply not get this tab,
    // while the workmate page and the settings card still mount. Measured: an unguarded read
    // threw inside `apply`, and `bun test packages/mpd-bundle-plugin` reported
    // "Unhandled error between tests" for every arm that drives the real client bytes.
    // LOUD, NOT SILENT (D1). Returning quietly here is the mode this file shipped with, and it is
    // the one a user cannot debug: the Team and Workmate tabs are simply absent with no reason
    // given. The line is emitted ONCE, names WHAT is missing, and states that the ROUTES still
    // serve the data, so the NEXT check is a hint rather than a hunch.
    if (typeof ctx.inject !== "function" || typeof ctx.locale?.bind !== "function") {
      /** Which of the two seam reads failed, as the report should read it. */
      const missing = typeof ctx.inject !== "function" ? "ctx.inject" : "ctx.locale.bind"
      reportNoHarnessSidebar("this client ctx exposes no " + missing)
      return
    }
    /** The translator bound to this tab's own locale namespace. */
    const t = ctx.locale.bind("mpdTeamSidebar");
    // COMMIT IT for the shared view, which is constructed by `teamViewOf()` in a render path that has
    // no `ctx` and therefore cannot bind a namespace itself. Wrapped so the view gets the full English
    // table for any key the host does not resolve, and so a throwing host translator cannot take the
    // panel down: the view receives `teamSay`, never the host's function directly.
    teamTranslator = (key: string): string => {
      try { return String(t(key)) } catch { return TEAM_COPY_EN[key] ?? key }
    };
    ctx.effect(() => ctx.locale.register("mpdTeamSidebar", {
      en: {
        "type.label": TEAM_TAB_TITLE,
        "guide.title": TEAM_TAB_TITLE,
        "guide.description": TEAM_TAB_DESCRIPTION,
        // The shared view's own copy. Registered from the SAME table the fallback reads, so the two
        // cannot drift: a key added to the view and forgotten here still renders English instead of
        // a raw key, which is the failure mode this pairing exists to make impossible.
        ...TEAM_COPY_EN,
      },
      zh: {
        "type.label": "团队",
        "guide.title": "团队",
        "guide.description": "本会话的名册与共享任务进度",
        ...TEAM_COPY_ZH,
      },
    }), "mpd-team-sidebar:copy");
    // The guide entry names a COMMAND, not a callback: that command is a client shortcut.
    ctx.inject(["shortcuts"], (scope) => {
      scope.effect(() => scope.shortcuts.register({
        id: "mpd-team.new",
        label: () => t("guide.title"),
        aliases: ["team", "open team tab"],
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => ({ status: "handled", run: () => ctx.sidebarRight.openTab(TEAM_TAB_KIND) }),
      }), "mpd-team-sidebar:command");
    });
    ctx.inject(["sidebarRightTabs", "sidebarRight"], (sidebar) => {
      // ── THE PREFERENCE, APPLIED AT THE ONE MOMENT IT CAN BE ──────────────────
      // `dsh-better-sidebar` FIRST, this official sidebar only as the FALLBACK (user decision,
      // 2026-09-30). The check runs HERE, when the official sidebar is ready to accept a
      // registration, because that is the latest moment at which the answer is knowable and the
      // earliest at which it matters: registering into both would put the same panel in two places
      // in a profile that mounts both hosts.
      if (typeof ctx.get === "function") {
        /** The better-sidebar service, when this profile has that host. */
        let primary: unknown;
        try { primary = ctx.get("betterSidebar"); } catch { primary = undefined; }
        if (primary !== undefined && primary !== null) {
          preferred = true;
          // PUBLISHED ON THIS BRANCH TOO (S9). A seat that is invisible to the bare probe at apply time
          // and visible here is the case this callback exists for, so returning without publishing left
          // the module snapshot on its apply-time values — `sidebarDiagnostics()` reported
          // `{host: "", preferred: false}` about a profile whose panels better-sidebar owns.
          publishSettle(preferred, registered);
          console.info("[mpd] better-sidebar is mounted: the team view registers THERE, and the official right sidebar is left to its own tabs");
          return;
        }
      }
    // THE SEAM IS REAL AND THIS IS THE FALLBACK'S TURN: every registration below is counted, so the
    // check at the end of this callback can tell "the host took the tabs" from "the host refused
    // them" — the second is a defect in THIS file and must not be silent either.
    try {
    sidebar.effect(() => sidebar.sidebarRightTabs.register({
      id: TEAM_TAB_ID,
      kind: TEAM_TAB_KIND,
      priority: "extension",
      title: () => t("type.label"),
      guide: [{
        id: "new",
        commandId: "mpd-team.new",
        order: 40,
        title: () => t("guide.title"),
        description: () => t("guide.description"),
      }],
    }), "mpd-team-sidebar:type");
    registered += 1;
    sidebar.effect(() => sidebar.slots.register({
      name: "sidebar.right.pane.tab",
      key: TEAM_TAB_ID,
      locale: "mpdTeamSidebar",
      inject: (sessionId: unknown) => ({ sessionId }),
    }, TeamSidebarBody), "mpd-team-sidebar:body");
    // ── THE WORKMATE LIBRARY, THE SAME WAY ───────────────────────────────────
    // The library was a better-sidebar-ONLY surface, so a profile with just the harness sidebar —
    // which is what a checkout install resolves, because `dsh-better-sidebar` is an optional peer —
    // had NO way to reach it at all. It is registered HERE, inside the same preference gate, so the
    // two hosts are two registrations of one feature rather than two features.
    sidebar.effect(() => sidebar.sidebarRightTabs.register({
      id: WORKMATE_TAB_ID,
      kind: WORKMATE_TAB_KIND,
      priority: "extension",
      // SAME strings as the better-sidebar descriptor above, by constant rather than by copy: the
      // fallback is a second surface of one page, not a second description of it.
      title: () => SIDEBAR_TAB_TITLE,
      guide: [{
        id: "new",
        commandId: WORKMATE_COMMAND_ID,
        order: 41,
        title: () => SIDEBAR_TAB_TITLE,
        description: () => SIDEBAR_TAB_DESCRIPTION,
      }],
    }), "mpd-workmate-sidebar:type");
    registered += 1;
    sidebar.effect(() => sidebar.slots.register({
      name: "sidebar.right.pane.tab",
      key: WORKMATE_TAB_ID,
      locale: WORKMATE_LOCALE_NAMESPACE,
      inject: () => ({}),
    }, WorkmateSidebarBody), "mpd-workmate-sidebar:body");
    } catch (error) {
      // A THROWING HOST IS NOT AN ABSENT HOST, and conflating the two is how a real defect reads as
      // an optional surface that simply is not there. The registration attempt stays contained (a
      // throw out of `apply` would fail the whole web page), and the report gate is the same single
      // line, so a broken fallback still produces exactly one diagnostic.
      reportNoHarnessSidebar("\"" + HARNESS_SIDEBAR_SERVICES + "\" is served but refused the registration: " + String(error))
      return
    }
    if (registered === 0) {
      // The seam resolved and both registrations were attempted, yet the host accepted none: reported
      // rather than left as an empty right sidebar.
      reportNoHarnessSidebar("\"" + HARNESS_SIDEBAR_SERVICES + "\" resolved but accepted no tab registration")
    }
    // PUBLISHED FROM INSIDE THE CALLBACK, because a seat that arrives AFTER `apply()` returned (the
    // live case, and every harness arm) would otherwise leave the diagnostics reading the pre-arrival
    // snapshot — `registered: 0, host: ""` about a profile whose panels are registered and fine.
    publishSettle(preferred, registered)
    });
    // ── THE SETTLE CHECK (D1) ───────────────────────────────────────────────────
    // The OTHER way this surface goes missing: the seat named above never resolves at all (a build
    // without the harness right sidebar, or a seat renamed by a newer host). `ctx.inject` parks its
    // callback and says NOTHING when its deps never arrive, so nothing inside the callback can learn
    // that. TWO moments ask the question and the report gate makes them ONE line:
    //   • a BOUNDED WAIT after this mount — the line a user staring at an empty right sidebar needs
    //     WHILE the page is open (F5: the disposer alone reported it only at unload);
    //   • the entry DISPOSER as the final backstop, for a page torn down before the bound elapsed.
    // Never a false line: with `dsh-better-sidebar` mounted the callback DOES resolve, takes the
    // preference branch above, and falls to the bottom with nothing registered — so `registered` alone
    // would report a problem neither host has. The `preferred` latch keeps that guarantee.
    /** The bounded-wait handle, cleared by the disposer below so a torn-down entry leaves no timer. */
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    if (typeof setTimeout === "function") {
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        if (registered === 0 && !preferred) {
          reportNoHarnessSidebar("neither \"" + HARNESS_SIDEBAR_SERVICES + "\" nor better-sidebar accepted a registration within " + settleTimeoutMsValue + "ms")
        }
      }, settleTimeoutMsValue)
    }
    ctx.effect(() => () => {
      // THE TIMER IS CLEARED FIRST: a disposed entry must not leave a pending callback behind, and a
      // page torn down inside the bound reports through the backstop below instead.
      if (settleTimer !== undefined) {
        clearTimeout(settleTimer)
        settleTimer = undefined
      }
      if (registered === 0 && !preferred) {
        reportNoHarnessSidebar("\"" + HARNESS_SIDEBAR_SERVICES + "\" was never published in this profile, and better-sidebar is not mounted either")
      }
    }, "mpd: harness sidebar report");
    // The command the workmate guide entry names. Registered in the same injected scope as the
    // team's, because both open a tab on the SAME registry and neither may run before it exists.
    ctx.inject(["shortcuts"], (scope) => {
      scope.effect(() => scope.shortcuts.register({
        id: WORKMATE_COMMAND_ID,
        label: () => "Workmates",
        aliases: ["workmate", "open workmate tab"],
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => ({ status: "handled", run: () => ctx.sidebarRight.openTab(WORKMATE_TAB_KIND) }),
      }), "mpd-workmate-sidebar:command");
    });
    // PUBLISH WHAT THIS MOUNT SETTLED ON. The two locals are what the settle checks DECIDE with; the
    // snapshots are what the settle line and the exported diagnostics READ (naming the host that won),
    // and the callback above publishes again on a late arrival so a settled value is never stale.
    publishSettle(preferred, registered)
  }

  // ── THE MPD WORKBENCH: the bundle's `conversation.view` full-page surface ──────────────────
  // WHY THIS SLOT. A mobile host (the DSH Go Android app) surfaces a plugin's `conversation.view`
  // entry as a full-page tab beside Chat/Trajectory, and it finds that tab by the entry's `id` +
  // `label`. It is the cheapest real mobile surface this bundle can offer, because the SAME code
  // renders in the desktop web app. The tab's POSITION is the registration order (the conversation
  // shell projects its list from `slots.entries("conversation.view")` and never reads `order`), so
  // this entry registers on the FIRST declaration of the slot instead of waiting for anything else.
  //
  // WHY IT READS ROUTES AND NOT A CLIENT STORE: same reason as `team-view.ts`. The mpd record is the
  // truth; a client store can only carry what a mounted service projected. The page reads the three
  // read-only routes below and POSTs the two fenced watchdog routes — nothing else.
  /** The LIST slot the conversation shell renders as one full page per registered entry. */
  const WORKBENCH_SLOT = "conversation.view"
  /** The stable entry id, short and unique among the slot's entries; the mobile host keys the tab on it. */
  const WORKBENCH_VIEW_ID = "mpd-workbench"
  /**
   * The tab label, CONSTANT on purpose.
   *
   * The mobile host matches the tab by `id` + `label`, so a label that moved with the page's locale
   * would stop matching on a device whose language differs from the web page's. The settings
   * section's own "MPD" label is the same precedent, and this one is short because a phone's tab
   * strip holds four at most.
   */
  const WORKBENCH_VIEW_LABEL = "Workbench"
  /** The locale namespace the page's own copy lives in (the label above is deliberately outside it). */
  const WORKBENCH_LOCALE_NS = "mpdWorkbench"
  /** How often the page re-reads its routes: they are cheap status reads, and the page has no stream. */
  const WORKBENCH_POLL_MS = 3000
  /** The watchdog state route: the ONE served payload that carries the live holds. */
  const WORKBENCH_WATCHDOG_PATH = "/plugins/mpd-team-watchdog/state"
  /** The fenced POST that pauses NEW dispatch into one team. */
  const WORKBENCH_HOLD_PATH = "/plugins/mpd-team-watchdog/hold"
  /** The fenced POST that clears one team's hold (a 200 no-op for a team that is not held). */
  const WORKBENCH_RESUME_PATH = "/plugins/mpd-team-watchdog/resume"
  /**
   * The cause a Pause from this page records in the hold sidecar.
   *
   * The route stores the body's `reason` as the hold's `cause`, and its own default is `silence` —
   * the watchdog's stall word. A human pressing Pause is not a stall, so the page says so, and a
   * later reader of `<stateDir>/watchdog/hold/<teamId>.json` can tell the two apart.
   */
  const WORKBENCH_HOLD_CAUSE = "workbench"

  /** The page's English copy — the fallback AND the key list the zh table stays complete against. */
  const WORKBENCH_COPY_EN: Record<string, string> = {
    "view.title": "MPD workbench",
    "header.members": "{count} members",
    "header.hold": "Hold",
    "hold.none": "not held",
    "hold.unknown": "unknown — the watchdog state could not be read",
    "hold.held": "held — {cause}",
    "hold.unknownCause": "(no cause recorded)",
    "tasks.empty": "This board has no tasks.",
    "actions.pause": "Pause",
    "actions.resume": "Resume",
    "actions.pausing": "Pausing…",
    "actions.resuming": "Resuming…",
    "empty.reading": "Reading the team routes…",
    "empty.unread": "The team routes could not be read.",
    "empty.noTeam": "No team in this session.",
    "empty.staged": "A plan is staged for this session — approve it to create the team.",
    "empty.nothing": "Nothing is staged here: stage a plan (agent_teams_plan), then approve it.",
    "empty.workspace": "This workspace has {count} other team(s): {teams}",
    "error.read": "Could not read {path}: {message}",
    "error.fence": "The host refused the request ({status}): this browser session is not allowed to write.",
    "error.method": "The route rejected the method (405): this server build has no such write route.",
    "error.write": "The {action} request failed.",
  }

  /** The page's 简体中文 copy, key-complete against the English table above. */
  const WORKBENCH_COPY_ZH: Record<string, string> = {
    "view.title": "MPD 工作台",
    "header.members": "{count} 名成员",
    "header.hold": "暂停状态",
    "hold.none": "未暂停",
    "hold.unknown": "未知 — 无法读取暂停状态",
    "hold.held": "已暂停 — {cause}",
    "hold.unknownCause": "（未记录原因）",
    "tasks.empty": "这块任务板是空的。",
    "actions.pause": "暂停",
    "actions.resume": "恢复",
    "actions.pausing": "暂停中…",
    "actions.resuming": "恢复中…",
    "empty.reading": "正在读取团队路由…",
    "empty.unread": "团队路由读取失败。",
    "empty.noTeam": "本会话没有团队。",
    "empty.staged": "本会话有一个已暂存的计划 — 批准它即可创建团队。",
    "empty.nothing": "这里也还没有计划：先调用 agent_teams_plan，再批准它。",
    "empty.workspace": "本工作区还有 {count} 个团队：{teams}",
    "error.read": "无法读取 {path}：{message}",
    "error.fence": "主机拒绝了该请求（{status}）：当前浏览器会话没有写权限。",
    "error.method": "路由拒绝了该方法（405）：这个服务端构建没有对应的写路由。",
    "error.write": "{action} 请求失败。",
  }

  /** The snapshot before the first read answers: nothing known, and nothing claimed. */
  const EMPTY_WORKBENCH: WorkbenchData = { team: null, tasks: [], workspace: [], staged: false, hold: null, holdKnown: false, loaded: false }

  /** One task row as `/plugins/mpd-team/state` serves it (only the three cells this page renders). */
  interface WorkbenchTaskPayload {
    /** The mpd task id (`T1`). */
    id?: unknown
    /** The owning member's display name, absent while the task is unowned. */
    owner?: unknown
    /** The stored status. */
    status?: unknown
    /** The RENDERED state the route derived (`blocked` included), preferred over the stored status. */
    visual?: unknown
  }

  /** One of the workspace's teams, as the state payload lists it. */
  interface WorkbenchWorkspacePayload {
    /** The mpd team id. */
    id?: unknown
    /** The team name the user reads. */
    name?: unknown
    /** `staged` | `active` | `idle` | `ended`. */
    phase?: unknown
    /** The roster size, already excluding members the store marked `failed`. */
    members?: unknown
  }

  /** The slice of `/plugins/mpd-team/state` this page reads. */
  interface WorkbenchStatePayload {
    /** The route's own success marker; a payload without it is treated as unreadable. */
    ok?: unknown
    /** The session's team head, or null when it has none. */
    team?: { id?: unknown; name?: unknown; phase?: unknown } | null
    /** The roster, counted for the header. */
    members?: unknown[]
    /** The board, in the route's own order. */
    tasks?: WorkbenchTaskPayload[]
    /** The workspace's teams, newest first — the answer for a session that has none of its own. */
    workspaceTeams?: { records?: WorkbenchWorkspacePayload[] }
  }

  /** The slice of `/plugins/mpd-team/plan` the empty state reads. */
  interface WorkbenchPlanPayload {
    /** The staged plan, or null when this session has none. */
    plan?: unknown
  }

  /** One hold sidecar, as the watchdog payload lists it (only the fields this page reads). */
  interface WorkbenchHoldPayload {
    /** The team the hold applies to; the page keeps only the one matching its own team. */
    teamId?: unknown
    /** The human-readable cause recorded with the hold. */
    cause?: unknown
    /** Epoch milliseconds the hold was applied. */
    since?: unknown
  }

  /** The slice of `/plugins/mpd-team-watchdog/state` this page reads. */
  interface WorkbenchWatchdogPayload {
    /** Every hold sidecar found across the searched roots (additive, so absent on an older host). */
    held?: WorkbenchHoldPayload[]
    /** The single banner the watchdog panel renders, used as the hold fallback on a host without `held`. */
    banner?: { kind?: unknown; teamId?: unknown; cause?: unknown; since?: unknown } | null
  }

  /** One team this page names: the session's own, or a workspace sibling in the empty state. */
  interface WorkbenchTeam {
    /** The mpd team id, which is also the `teamId` the write routes take. */
    id: string
    /** The team name the user reads (the id when the record carried no name). */
    name: string
    /** `staged` | `active` | `idle` | `ended`. */
    phase: string
    /** The roster size, counted from the payload's own member list. */
    members: number
  }

  /** One board row: the three cells this page renders, and nothing else. */
  interface WorkbenchTask {
    /** The task id (`T1`). */
    id: string
    /** The owning member's display name, or "" while the task is unowned. */
    owner: string
    /** The RENDERED state the route derived, falling back to the stored status. */
    status: string
  }

  /** The live hold on this page's team. */
  interface WorkbenchHold {
    /** Why the hold was raised (the recorded cause, or "" when none was). */
    cause: string
    /** Epoch milliseconds the hold was applied, or 0 when the payload carried no stamp. */
    since: number
  }

  /** Everything one poll pass yields, in ONE value so the header, the board and the hold cannot disagree. */
  interface WorkbenchData {
    /** The session's own team, or null when the route served none. */
    team: WorkbenchTeam | null
    /** That team's board, in the route's own order. */
    tasks: WorkbenchTask[]
    /** The workspace's OTHER teams, named by the empty state instead of a blank page. */
    workspace: WorkbenchTeam[]
    /** Whether a plan is staged for this session (the empty state names the next step after it). */
    staged: boolean
    /** The live hold on {@link WorkbenchData.team}, or null when the team is not held. */
    hold: WorkbenchHold | null
    /**
     * Whether the WATCHDOG route actually answered, i.e. whether {@link WorkbenchData.hold} is a fact.
     *
     * A failed `/plugins/mpd-team-watchdog/state` read yields `hold: null` too, and that value is
     * indistinguishable from a team nobody holds. This flag keeps the two apart: without it the page
     * would state "not held" about an UNKNOWN state and would offer Pause on an absent-fact. Pause
     * follows it; Resume does not, because the repository-owned resume route defines an absent hold
     * as a successful no-op.
     */
    holdKnown: boolean
    /** Whether the STATE route has answered at least once, so "no team" is never claimed before an answer. */
    loaded: boolean
  }

  /** A read failure: which route failed, and what it failed with. */
  interface WorkbenchFailure {
    /** The route path that failed. */
    path: string
    /** The failure value: a status record, a thrown error, or an unreadable body. */
    cause: unknown
  }

  /**
   * The props the conversation shell hands one `conversation.view` entry.
   *
   * TWO SOURCES, one object: the four owner props are passed by the shell at its own `renderSlot`
   * call site (`DefaultConversationViews`), while `sessionId` and `t` are the framework's standard kit
   * for a session-scope slot — the session binder publishes `{ sessionId }` and the renderer adds `t`
   * for an entry that declares `locale`.
   */
  interface WorkbenchProps {
    /** The session this view renders; "" on a host that passes none, which reads the workspace principal. */
    sessionId?: unknown
    /** The host translator bound to {@link WORKBENCH_LOCALE_NS}, absent on a host that binds none. */
    t?: Translate
    /** The one-shot focus request addressed to the selected view, or null when there is none. */
    viewRequest?: { view?: unknown; focus?: unknown } | null
    /** Acknowledge the current one-shot focus request. */
    completeViewRequest?: () => unknown
    /** Select a view and address an opaque focus identity to it; accepted and unread (this page opens nothing). */
    openView?: (view: string, focus: string) => unknown
    /** Open a tool call's inspector; accepted and unread (this page inspects no call). */
    inspectCall?: ((callId: string) => void) | undefined
  }

  /** One payload value as display text: a string verbatim, a number stringified, anything else "". */
  function workbenchText(value: unknown): string {
    if (typeof value === "string") return value
    return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
  }

  /** One payload value as a count: a finite non-negative number floored, anything else 0. */
  function workbenchCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  }

  /** A status word as the colour a reader can tell apart at a glance (an unknown word reads grey). */
  function workbenchStateColor(state: string): string {
    // `blocked` is DERIVED by the route rather than stored, so it is not in the shared status table.
    if (state === "blocked") return "#c98a12"
    return STATUS_COLOR[state] ?? "#8a8f98"
  }

  /** One hold instant as a short local time, or "" when the payload carried no usable stamp. */
  function workbenchTime(ms: number): string {
    if (ms <= 0) return ""
    try {
      return new Date(ms).toLocaleTimeString()
    } catch {
      return ""
    }
  }

  /** One failure as a phrase: an HTTP status for a refused read, else the thrown message. */
  function workbenchFailureText(cause: unknown): string {
    if (cause !== null && typeof cause === "object" && "status" in cause) {
      /** The status an unreadable-answer record carries. */
      const status = (cause as { status?: unknown }).status
      if (typeof status === "number") return "HTTP " + String(status)
    }
    if (cause instanceof Error) return cause.message
    return workbenchText(cause)
  }

  /**
   * The page's translator: the host's bound `t` when it passed one, else this page's English table.
   *
   * NOT `translateFor`, and the difference matters: that helper falls back to the WORKMATE page's
   * dictionary, so a workbench key it has never seen would render as the raw key. The host's own
   * translator wins whenever it exists, which is the case the `locale:` declaration buys.
   * @param props - the entry props the shell rendered with.
   * @returns the translator this render uses.
   */
  function workbenchSay(props: WorkbenchProps | undefined): Translate {
    if (props !== undefined && typeof props.t === "function") return props.t
    return (key: string, params?: Record<string, unknown>): string => interpolate(WORKBENCH_COPY_EN[key] ?? key, params)
  }

  /** The session suffix every read takes, so the three routes can never address different sessions. */
  function workbenchQuery(sessionId: string): string {
    return sessionId === "" ? "" : "?sessionId=" + encodeURIComponent(sessionId)
  }

  /**
   * Read ONE of the workbench's routes, never rejecting: a failure is a VALUE the page renders.
   *
   * The `ok: true` marker is REQUIRED, exactly as `team-view.ts`'s own reader requires it: a payload
   * without it is a route that failed, and rendering it as an empty team would claim "no team" about
   * a read that never happened. That reader lives inside `createTeamView`'s closure and cannot be
   * imported here, so the guard is repeated rather than re-derived.
   * @param path - the route to read.
   * @param sessionId - the session to address; "" omits the query and reads the workspace principal.
   * @returns the served payload, or null plus the failure that prevented it.
   */
  async function readWorkbenchRoute<T>(path: string, sessionId: string): Promise<{ value: T | null; error?: unknown }> {
    try {
      /** The host's own transport; the page never assumes a proxy. */
      const response = await fetch(path + workbenchQuery(sessionId), { headers: { accept: "application/json" } })
      if (!response.ok) return { value: null, error: { status: response.status } }
      /** The served payload, validated below rather than trusted. */
      const payload = await response.json() as T & { ok?: unknown }
      if (payload === null || typeof payload !== "object" || payload.ok !== true) return { value: null, error: { status: response.status, body: payload } }
      return { value: payload }
    } catch (error) {
      return { value: null, error }
    }
  }

  /**
   * The live hold on ONE team, from whichever half of the watchdog payload carries it.
   * @param payload - the watchdog state payload, or null when the route could not answer.
   * @param teamId - the team the page is showing.
   * @returns the hold, or null when this team is not held (or the payload names no hold for it).
   */
  function workbenchHoldOf(payload: WorkbenchWatchdogPayload | null, teamId: string): WorkbenchHold | null {
    for (const sidecar of payload?.held ?? []) {
      if (workbenchText(sidecar?.teamId) !== teamId) continue
      return { cause: workbenchText(sidecar?.cause), since: workbenchCount(sidecar?.since) }
    }
    /** The panel banner, which a host that serves no `held` list still answers for the held team. */
    const banner = payload?.banner ?? null
    if (banner !== null && workbenchText(banner.kind) === "held" && workbenchText(banner.teamId) === teamId) {
      return { cause: workbenchText(banner.cause), since: workbenchCount(banner.since) }
    }
    return null
  }

  /**
   * Read every route the workbench shows in ONE pass.
   * @param sessionId - the session to address; "" reads the workspace principal (no query is sent).
   * @returns the assembled snapshot plus the FIRST failure, so the page can say what it could not see.
   */
  async function readWorkbench(sessionId: string): Promise<{ data: WorkbenchData; failure: WorkbenchFailure | null }> {
    // THREE ROUTES IN ONE PASS: the deadline is one answer, and a page that polled them separately
    // could show a staged plan beside a team that approval had already replaced. `/plugins/mpd-team/
    // task` (the frozen acceptance contracts) is deliberately NOT read: this page renders no contract.
    const [state, plan, watchdog] = await Promise.all([
      readWorkbenchRoute<WorkbenchStatePayload>(TEAM_STATE_PATH, sessionId),
      readWorkbenchRoute<WorkbenchPlanPayload>(TEAM_PLAN_PATH, sessionId),
      readWorkbenchRoute<WorkbenchWatchdogPayload>(WORKBENCH_WATCHDOG_PATH, sessionId),
    ])
    /** The first route that failed, in the order the page reads them. */
    const failure: WorkbenchFailure | null =
      state.error !== undefined ? { path: TEAM_STATE_PATH, cause: state.error }
        : plan.error !== undefined ? { path: TEAM_PLAN_PATH, cause: plan.error }
          : watchdog.error !== undefined ? { path: WORKBENCH_WATCHDOG_PATH, cause: watchdog.error }
            : null
    /** The session's team head, when the route served one. */
    const head = state.value?.team ?? null
    /** The team this page renders; the roster is counted from the payload's own member list. */
    const team: WorkbenchTeam | null = head === null ? null : {
      id: workbenchText(head.id),
      name: workbenchText(head.name) === "" ? workbenchText(head.id) : workbenchText(head.name),
      phase: workbenchText(head.phase),
      members: Array.isArray(state.value?.members) ? state.value.members.length : 0,
    }
    /** The board rows; a row with no id is skipped rather than rendered blank. */
    const tasks: WorkbenchTask[] = []
    for (const row of state.value?.tasks ?? []) {
      /** The row's id, the one cell this page cannot invent. */
      const id = workbenchText(row?.id)
      if (id === "") continue
      /** The RENDERED state, which is what a reader can act on, with the stored status as the fallback. */
      const visual = workbenchText(row?.visual)
      tasks.push({ id, owner: workbenchText(row?.owner), status: visual === "" ? workbenchText(row?.status) : visual })
    }
    // THE WORKSPACE LISTING IS GATHERED ONLY FOR THE EMPTY STATE: when the session has a team of its
    // own the listing is noise, and this page is a workbench rather than a workspace browser.
    /** The workspace's teams, named by the empty state instead of a dead end. */
    const workspace: WorkbenchTeam[] = []
    if (team === null) {
      for (const record of state.value?.workspaceTeams?.records ?? []) {
        /** The listed team's id; an unreadable row is dropped rather than named blank. */
        const id = workbenchText(record?.id)
        if (id === "") continue
        workspace.push({
          id,
          name: workbenchText(record?.name) === "" ? id : workbenchText(record?.name),
          phase: workbenchText(record?.phase),
          members: workbenchCount(record?.members),
        })
      }
    }
    return {
      data: {
        team,
        tasks,
        workspace,
        staged: (plan.value?.plan ?? null) !== null,
        hold: team === null ? null : workbenchHoldOf(watchdog.value, team.id),
        // THE WATCHDOG READ'S OWN ANSWER, not a reading of `hold`: the reader above returns a value
        // ONLY for an `ok: true` payload, so null here means the route failed and the page knows
        // nothing about the hold — which is not the same claim as "not held".
        holdKnown: watchdog.value !== null,
        // `loaded` is the STATE route's own answer: a failed read is never reported as "no team".
        loaded: state.value !== null,
      },
      failure,
    }
  }

  /**
   * POST one of the two fenced write routes.
   *
   * NOTHING HERE THROWS AT THE PAGE: the caller turns every rejection — a 401 from the host fence, a
   * 405 from a server build without the route, a dead network — into the inline error line, so a
   * phone with an expired session still renders the whole board.
   * @param path - the route to POST.
   * @param body - the JSON body the route's own contract declares.
   * @returns the route's answer, or a `RequestFailure` carrying its status and body.
   */
  function writeWorkbench(path: string, body: ApiBody): Promise<ApiBody> {
    return request<ApiBody>(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    })
  }

  /**
   * One refused or failed write as the sentence the page shows inline.
   * @param error - whatever the write rejected with.
   * @param action - which action was attempted, for the generic fallback sentence.
   * @param say - the translator for this render.
   * @returns the message to render, never empty.
   */
  function workbenchWriteFailure(error: unknown, action: string, say: Translate): string {
    /** The HTTP status the route answered with, when the failure carried one. */
    const status = error !== null && typeof error === "object" && "status" in error ? (error as RequestFailure).status : undefined
    // THE FENCE IS THE FIRST THING A READER MUST KNOW ABOUT: 401/403 mean the host refused the write,
    // which is a different fix (re-open the page in a fenced session) from a server without the route.
    if (status === 401 || status === 403) return interpolate(say("error.fence"), { status: String(status) })
    if (status === 405) return say("error.method")
    if (error instanceof Error && error.message !== "") return error.message
    return interpolate(say("error.write"), { action })
  }

  /**
   * The MPD workbench: the bundle's full-page `conversation.view` surface.
   *
   * READ-ONLY except for TWO fenced POSTs (pause / resume), so a phone gets a real MPD surface with
   * no tool call. Every failure becomes a sentence on the page; nothing here throws.
   * @param props - the entry props the conversation shell renders with.
   * @returns the page element.
   */
  function WorkbenchView(props: WorkbenchProps | undefined): unknown {
    /** The translator for this render: the host's bound `t`, or the page's own English table. */
    const say = workbenchSay(props)
    /** The session addressed by every read; "" reads the workspace principal (the query is omitted). */
    const sessionId = sessionIdOfSeat(props)
    /** The last snapshot; the empty value until the first read answers. */
    const [data, setData] = react.useState<WorkbenchData>(EMPTY_WORKBENCH)
    /** Which write is in flight, or "" when none is: BOTH buttons are disabled while it is set. */
    const [busy, setBusy] = react.useState<"" | "hold" | "resume">("")
    /** The last READ failure, cleared by the next successful read. */
    const [readError, setReadError] = react.useState<string>("")
    /** The last WRITE failure, cleared when the next write starts — a poll must never erase it. */
    const [writeError, setWriteError] = react.useState<string>("")
    // ONE READ PATH AND ONE CLOCK. The effect owns the first read and the interval, and its disposer
    // stops both, so an unmounted page leaves no timer and no reader behind.
    react.useEffect(() => {
      /** Set once the effect is disposed, so a late answer never writes state into a dead component. */
      let stopped = false
      /** One poll pass: read every route, then publish the whole snapshot at once. */
      const tick = async (): Promise<void> => {
        /** This pass's answer, failures included. */
        const read = await readWorkbench(sessionId)
        if (stopped) return
        setData(read.data)
        setReadError(read.failure === null ? "" : interpolate(say("error.read"), { path: read.failure.path, message: workbenchFailureText(read.failure.cause) }))
      }
      void tick()
      /** The interval, cleared by the disposer below. */
      const timer = setInterval(() => { void tick() }, WORKBENCH_POLL_MS)
      return () => {
        stopped = true
        clearInterval(timer)
      }
    }, [sessionId])
    // THE ONE-SHOT FOCUS REQUEST. The shell may address a focus request to this tab; acknowledging it
    // is the whole protocol, and a request addressed to ANOTHER view is left for that view to consume.
    /** The request this render sees, if any. */
    const request = props?.viewRequest ?? null
    /** Its identity, so the effect fires once per request rather than on every render. */
    const requestKey = request === null ? "" : workbenchText(request.view) + ":" + workbenchText(request.focus)
    react.useEffect(() => {
      if (requestKey === "" || request === null || workbenchText(request.view) !== WORKBENCH_VIEW_ID) return
      if (typeof props?.completeViewRequest !== "function") return
      props.completeViewRequest()
    }, [requestKey])
    /**
     * Run ONE write, then re-read so the header flips without waiting out the poll.
     * @param kind - the action the buttons pressed.
     */
    const act = (kind: "hold" | "resume"): void => {
      /** The team the write addresses; a page with no team has nothing to hold. */
      const team = data.team
      if (team === null || busy !== "") return
      // THE GUARD THE BUTTON ALSO CARRIES, repeated HERE so a programmatic call cannot slip past it:
      // with the watchdog route unread, an absent hold may be a hold this page simply cannot see, so
      // Pause is refused.
      if (kind === "hold" && !data.holdKnown) return
      // THE MIRROR FOR RESUME, deliberately NOT symmetrical: a KNOWN-empty hold is nothing to clear, so
      // the call is refused exactly when the button is. An UNKNOWN state is NOT refused — the route
      // treats an absent hold as a successful no-op, which is why Resume stays live while it cannot be
      // read.
      if (kind === "resume" && data.holdKnown && data.hold === null) return
      setBusy(kind)
      setWriteError("")
      void (async (): Promise<void> => {
        try {
          // A HUMAN PAUSE CARRIES ITS OWN CAUSE. The hold route's `reason` IS the sidecar's recorded
          // `cause`, and omitting it would store the route's default (`silence`) — which would read
          // on disk as a watchdog stall that never happened. `resume` takes only the team id.
          await writeWorkbench(
            kind === "hold" ? WORKBENCH_HOLD_PATH : WORKBENCH_RESUME_PATH,
            kind === "hold" ? { teamId: team.id, reason: WORKBENCH_HOLD_CAUSE } : { teamId: team.id },
          )
          /** The answer the page re-renders with: the read is the truth, not the POST's echo. */
          const read = await readWorkbench(sessionId)
          setData(read.data)
        } catch (error) {
          setWriteError(workbenchWriteFailure(error, kind, say))
        } finally {
          setBusy("")
        }
      })()
    }
    /** The team the header names, when the read found one. */
    const team = data.team
    /** The phase chip's colour (an unknown phase reads grey, never invisible). */
    const phaseColor = team === null ? "#8a8f98" : STATUS_COLOR[team.phase] ?? "#8a8f98"
    /** The hold's stamped instant, or "" when the payload carried none. */
    const stamp = data.hold === null ? "" : workbenchTime(data.hold.since)
    /** The hold line: the UNKNOWN state first (a failed read is not "not held"), then cause, then none. */
    const holdText = !data.holdKnown
      ? say("hold.unknown")
      : data.hold === null
        ? say("hold.none")
        : interpolate(say("hold.held"), { cause: data.hold.cause === "" ? say("hold.unknownCause") : data.hold.cause }) + (stamp === "" ? "" : " · " + stamp)
    /** The error line: the WRITE channel first, because that is the action the user just took. */
    const errorText = writeError !== "" ? writeError : readError
    /** The empty-state headline, which is never a blank page. */
    const emptyTitle = data.loaded ? say("empty.noTeam") : errorText === "" ? say("empty.reading") : say("empty.unread")
    return h("div", { style: SURFACE_STYLE, "data-mpd-workbench": WORKBENCH_VIEW_ID },
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" } },
        h("span", { style: { fontWeight: 700, fontSize: "14px" } }, say("view.title")),
        team === null ? null : h("span", { style: chip(phaseColor) }, team.phase),
        team === null ? null : h("span", { style: { ...dim, fontFamily: "monospace" } }, team.id),
        team === null ? null : h("span", { style: dim }, interpolate(say("header.members"), { count: String(team.members) })),
      ),
      team === null ? null : h("div", { style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", flexWrap: "wrap" } },
        h("button", {
          type: "button",
          // PAUSE NEEDS A KNOWN HOLD: a failed watchdog read must not offer a write on an unknown state.
          disabled: busy !== "" || data.hold !== null || !data.holdKnown,
          style: { ...BUTTON_STYLE, opacity: busy !== "" || data.hold !== null || !data.holdKnown ? 0.5 : 1 },
          onClick: () => act("hold"),
        }, busy === "hold" ? say("actions.pausing") : say("actions.pause")),
        h("button", {
          type: "button",
          // RESUME STAYS LIVE WITHOUT A KNOWN HOLD: that route defines an absent hold as a successful
          // no-op, so it is refused only when the page KNOWS there is nothing to clear.
          disabled: busy !== "" || (data.holdKnown && data.hold === null),
          style: { ...BUTTON_STYLE, opacity: busy !== "" || (data.holdKnown && data.hold === null) ? 0.5 : 1 },
          onClick: () => act("resume"),
        }, busy === "resume" ? say("actions.resuming") : say("actions.resume")),
        h("span", { style: dim }, say("header.hold") + ": " + holdText),
      ),
      errorText === "" ? null : h("div", { role: "alert", style: { color: "#c33", fontSize: "12px", whiteSpace: "pre-wrap" } }, errorText),
      team === null
        ? h("div", { style: { ...dim, padding: "10px 0", fontSize: "12px", lineHeight: "18px", display: "flex", flexDirection: "column", gap: "4px" } },
            h("div", { style: { fontWeight: 600, color: "inherit" } }, emptyTitle),
            data.loaded ? h("div", null, data.staged ? say("empty.staged") : say("empty.nothing")) : null,
            data.workspace.length === 0 ? null : h("div", null, interpolate(say("empty.workspace"), {
              count: String(data.workspace.length),
              // The phase is omitted rather than invented when the record carried none: `x (…)` with
              // a borrowed word would read as a state the route never stated.
              teams: data.workspace.map((other) => other.phase === "" ? other.id : other.id + " (" + other.phase + ")").join(", "),
            })),
          )
        : h("div", { style: { display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" } },
            data.tasks.length === 0
              ? h("div", { style: { ...dim, padding: "6px 0" } }, say("tasks.empty"))
              : data.tasks.map((task) => h("div", { key: task.id, style: rowStyle },
                  h("span", { style: { ...dim, fontFamily: "monospace", flex: "0 0 auto" } }, task.id),
                  h("span", { style: { ...ellipsis, flex: "1 1 auto" } }, task.owner === "" ? "—" : task.owner),
                  h("span", { style: chip(workbenchStateColor(task.status)) }, task.status),
                )),
          ),
    )
  }

  /** Whether this client module load already emitted its one workbench diagnostic. */
  let workbenchReported: boolean = false

  /**
   * Report the workbench's absence ONCE, with the reason.
   * @param why - what could not be done, phrased as the console line should read.
   */
  function reportNoWorkbench(why: string): void {
    if (workbenchReported) return
    workbenchReported = true
    console.info("[mpd] the MPD workbench view is not registered: " + why)
  }

  /**
   * Register the MPD workbench as the bundle's ONE `conversation.view` entry.
   *
   * THE GATE, and why it is not a one-shot `ctx.get` probe: `conversation.view` is DECLARED by the
   * conversation shell's own `conversation.session` registration, so a probe at apply time races that
   * shell exactly the way the better-sidebar probe raced its host. `ctx.slots.inject` waits for the
   * declaration (running synchronously when it already exists) — and it says NOTHING when the slot
   * never arrives, so a bounded wait reports that absence in ONE line, the same shape as the sidebar's
   * settle check. Nothing in this function throws: a host build without the slot simply has no tab.
   * @param ctx - the client entry's context.
   */
  function mountWorkbenchView(ctx: ClientContext): void {
    // THE SERVICE PROBE. `slots` is a declared dependency of this entry, so this is a SHAPE check on
    // both seams the registration needs — never a guess about which host is mounted.
    if (ctx === null || ctx === undefined || ctx.slots === undefined
      || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
      reportNoWorkbench("this client ctx exposes no slots.inject")
      return
    }
    try {
      ctx.effect(() => ctx.locale.register(WORKBENCH_LOCALE_NS, { en: WORKBENCH_COPY_EN, zh: WORKBENCH_COPY_ZH }), "mpd-workbench: dictionaries")
    } catch (error) {
      // A locale seam that refuses the copy must not cost the TAB: the page then renders its English
      // literals, which is the same degrade every other surface in this file falls back to.
      console.info("[mpd] the workbench copy could not be registered: " + String(error))
    }
    /** Whether the registration was accepted on this mount. */
    let registered: boolean = false
    /** The bounded-wait handle, cleared when the registration lands or the entry is disposed. */
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    if (typeof setTimeout === "function") {
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        if (!registered) reportNoWorkbench("this host build never declared \"" + WORKBENCH_SLOT + "\" within " + settleTimeoutMsValue + "ms")
      }, settleTimeoutMsValue)
    }
    try {
      ctx.slots.inject(WORKBENCH_SLOT, () => {
        try {
          /** The unregister function the slot registry answered with. */
          const unregister = ctx.slots.register({
            name: WORKBENCH_SLOT,
            id: WORKBENCH_VIEW_ID,
            // A THUNK, because that is the shape the host resolves at read time (a string would be
            // read once and would then be unable to follow anything); the value itself is constant.
            label: () => WORKBENCH_VIEW_LABEL,
            locale: WORKBENCH_LOCALE_NS,
          }, WorkbenchView)
          registered = true
          if (settleTimer !== undefined) {
            clearTimeout(settleTimer)
            settleTimer = undefined
          }
          // NO SUCCESS LINE ON PURPOSE. This entry mounts on EVERY web boot, so a line here is noise
          // on a healthy page — and the repo's own arms capture the boot's console and pin it as
          // empty (settings-card's model-catalog arms measure exactly that). The presence of the tab
          // is what a user checks; the ABSENCE is what needs a line, and it has one below.
          return unregister
        } catch (error) {
          // A REFUSING REGISTRY IS NOT AN ABSENT SLOT, and conflating the two is how a real defect
          // reads as an optional surface. The attempt stays contained; the report gate is one line.
          reportNoWorkbench("the slot registry refused the registration: " + String(error))
          return undefined
        }
      })
    } catch (error) {
      reportNoWorkbench("the \"" + WORKBENCH_SLOT + "\" slot could not be awaited: " + String(error))
    }
    ctx.effect(() => () => {
      if (settleTimer !== undefined) {
        clearTimeout(settleTimer)
        settleTimer = undefined
      }
      if (!registered) reportNoWorkbench("\"" + WORKBENCH_SLOT + "\" was never declared in this profile")
    }, "mpd: workbench view report")
  }

  /** The client entry: mount the command row, both sidebar pages and the settings card. */
  function apply(ctx: ClientContext): void {
    // The slash-command admission row (not a GUI panel) goes in immediately: `slots` is a
    // declared dependency, so it is present.
    mountAgentTeams(ctx);
    // Register both page locale dictionaries (zh/en).
    ctx.effect(() => ctx.locale.register(WORKMATE_LOCALE_NAMESPACE, { zh, en }), "mpd-workmate: dictionaries");
    // The AgentTeams page and the workmate library are BOTH DSH-better-sidebar tabs, and
    // that sidebar arrives later than this entry — so both are registered from the
    // ctx.inject callback, never from a probe here (that race is what left the sidebar's
    // "+" menu with no mpd row at all). A profile without the sidebar fires nothing.
    mountSidebarPages(ctx, loadTeamPage());
    // THE HARNESS'S OWN RIGHT SIDEBAR. `dsh-better-sidebar` is a THIRD-PARTY host that a
    // checkout install does not resolve (measured: the profile's node_modules holds only
    // @mpd-dsh, so the bundle's own guard disables that row and NO mpd tab renders). The
    // harness ships a right sidebar with a tab registry of its own, and its Files / Terminal /
    // Browser tabs use it — so the Team view is registered THERE, from THIS module, because
    // this module is the one the client-module registry APPLIES (a sibling
    // `__ModuleLoader__.load` block is loaded as a module and never applied).
    mountHarnessSidebar(ctx);
    // THE FULL-PAGE SURFACE. A `conversation.view` entry is rendered by the conversation shell as one
    // page beside Chat/Trajectory — which is also what a mobile host projects as a tab — so the
    // workbench is registered THERE rather than as another sidebar panel. It is mounted last so the
    // two sidebar hosts keep their own registration order, and it is contained like every other
    // optional surface: a host build without the slot loses the tab and nothing else.
    mountWorkbenchView(ctx);
    // The settings section: the Web HALF of the same `mpd` namespace the TUI /settings section
    // edits, mounted as its OWN top-level `MPD` section of the settings dialog (w14) — it no longer
    // rides the Plugins tab. Its mount is deferred (the settings scope is a plugin-provided
    // service, so it is awaited with ctx.inject, never declared here). The ENTRY also hands the
    // card its JSON reader (R3): the card does no I/O of its own, so THIS module — the one allowed
    // to reach the network — lends it `request`, which the card uses for the live
    // `/plugins/mpd/model-config` read behind its effective-value block.
    try {
      loadSettingsCard().mountSettingsCard(ctx, {
        fetchJson: (url: string): Promise<unknown> => request(url, { headers: { accept: "application/json" } }),
      });
    } catch (error) {
      console.warn("[mpd] settings card mount failed: " + String(error));
    }
  }

  // zh is the key-set source of truth; en must stay key-complete against it. Exported so
  // the offline harness can assert that without a browser (contract §L A7).
  /** The page's dictionaries, frozen so an offline assertion cannot mutate them. */
  const dictionaries = { zh: Object.freeze({ ...zh }), en: Object.freeze({ ...en }) };

  /**
   * The client-entry diagnostics, exported for the OFFLINE harness.
   *
   * The settle line is a TIMED behaviour, so an arm that wants to assert it must be able to shorten
   * the bound (`settleTimeoutMs(ms)`) and to read WHAT the entry settled on (`sidebarDiagnostics()`:
   * whether it reported, which host took the panels, how many registrations were accepted, and whether
   * the better-sidebar preference fired). Without these two the only honest assertions would be an
   * eight-second sleep per case or a deleted one.
   * @param ms - the new settle bound in milliseconds, or undefined to READ the current one.
   * @returns the bound in force after the call.
   */
  const settleTimeoutMs = (ms?: number): number => {
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) settleTimeoutMsValue = ms
    return settleTimeoutMsValue
  }

  /**
   * What the last mount settled on, so a test can assert the DIAGNOSTIC and not only the console line.
   * @returns the reported flag, the host that won, the accepted registrations and the preference latch.
   */
  const sidebarDiagnostics = (): { reported: boolean; host: string; registered: number; preferred: boolean } => ({
    reported: harnessSidebarReported,
    host: harnessSidebarHost,
    registered: harnessSidebarRegistered,
    preferred: betterSidebarPreferred,
  })

  // `inject`/`apply` are the client-module contract; the view plus the two pure helpers
  // (dictionaries and the §D failure mapper) are exported so the offline harness
  // (packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs) can pin them without a browser.
  module.exports = { inject, apply, WorkmateLibraryView, SIDEBAR_TAB_ID, describeFailure, failureReason, dictionaries, loadSettingsCard, settleTimeoutMs, sidebarDiagnostics };
  return module.exports;
}


// The bare `primitives` global the host injects; this page reads its two store hooks. It is
// declared AFTER the factory on purpose: the build splices this file as ONE expression, and both
// this declaration and the interface above it erase to nothing — while a declaration placed
// before the factory would leave its statement-terminating `;` inside the spliced expression.
/** The two store hooks this page reads from the host's primitives package. */
interface PrimitivesGlobal {
  /** The sessions store hook (narrowed to the hook shape inside the factory). */
  useSessions: unknown
  /** The single-session store hook (narrowed to the hook shape inside the factory). */
  useSession: unknown
}

// The original source referenced the primitives package as a bare global and nothing in this
// bundle defines it, so the lookup — including its failure mode on a host that never injects the
// package — stays exactly as it was, and no runtime binding appears here.
declare const primitives: PrimitivesGlobal

// The build splices the card's factory body in as a function-scoped `var MPD_SETTINGS_CARD =
// (function () { ... })()` right before `loadSettingsCard` (`scripts/build-mpd-client.ts`), so the
// source declares the same name ambiently: the splice's own `var` shadows this declaration at
// runtime, and the source needs no runtime binding of its own.
/** The mpd settings card module the build splices into the client entry. */
interface MpdSettingsCardGlobal {
  /** Mount the card's own top-level settings section. */
  mountSettingsCard: (ctx: unknown) => unknown
}

/** The spliced settings card module, or undefined when the build did not splice one. */
declare const MPD_SETTINGS_CARD: MpdSettingsCardGlobal | undefined

/** The spliced team-view global's shape: the ONE factory both sidebar hosts build their body from. */
interface MpdTeamViewGlobal {
  /** Build the shared team view once, so both hosts render one component with one poller. */
  createTeamView: (deps: { react: unknown; statePath: string; planPath?: string; taskPath?: string; eventsPath?: string; pollMs?: number; t?: (key: string) => string }) => MpdTeamViewModule
}

/** The built team view. */
interface MpdTeamViewModule {
  /** The component both sidebar hosts render; each host passes its own props and the view tolerates them. */
  TeamView: (props?: unknown) => unknown
}

/**
 * The team view the build splices in (W4) — see {@link MPD_SETTINGS_CARD} for why it arrives as a
 * global rather than an import: only THIS module is applied as a client plugin, so a sibling
 * `load()` block would define the view where nothing applied can reach it.
 *
 * THE TYPE IS NAMED, and that is not style: a `declare const` carrying an INLINE multi-line object
 * type does not survive type stripping here — the stripped artifact keeps a stray `{`, which then
 * swallows the rest of the module as an object literal and fails the whole client with
 * `Unexpected token 'const'` a hundred lines later. Measured on this very declaration.
 */
declare const MPD_TEAM_VIEW: MpdTeamViewGlobal | undefined
