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
    /** The tab icon factory; the host passes the icon size in pixels. */
    icon: (size: number) => unknown
    /** The tab's position among the host's tabs. */
    order: number
    /** Whether the host keeps at most one instance of this tab. */
    single: boolean
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
    /** Mount the card's own top-level settings section. */
    mountSettingsCard: (ctx: ClientContext) => unknown
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
      teamView = MPD_TEAM_VIEW.createTeamView({ react, statePath: TEAM_STATE_PATH })
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
    ctx.effect(() => sidebar.registerTab({
      id: TEAM_PAGE_TAB_ID,
      title: () => "Team",
      icon: () => "◆",
      order: TEAM_TAB_ORDER,
      single: true,
      component: (props: unknown) => view.TeamView(props),
    }), "mpd: team sidebar tab");
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
      ctx.effect(() => sidebar.registerTab({
        id: SIDEBAR_TAB_ID,
        title: () => SIDEBAR_TAB_TITLE,
        icon: (size: number) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F916}"),
        order: 90,
        single: true,
        component: (props: WorkmateLibraryProps | undefined) => react.createElement(WorkmateLibraryView, { t: translateFor({ t: props && props.t }) }),
      }), "mpd-workmate: sidebar tab");
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
    // The seat's own props are forwarded VERBATIM: the view reads the session id from whichever
    // spelling its host used, so nothing here needs to know which host this is.
    return view.TeamView(props);
  }

  /** The harness-sidebar Team tab, contributed by the bundle's ONE applied client module. */
  function mountHarnessSidebar(ctx: ClientContext): void {
    // DEGRADE, NEVER TAKE THE ENTRY DOWN. `ctx.inject` is a client-framework seam: a
    // composition (or the offline client harness) without it must simply not get this tab,
    // while the workmate page and the settings card still mount. Measured: an unguarded read
    // threw inside `apply`, and `bun test packages/mpd-bundle-plugin` reported
    // "Unhandled error between tests" for every arm that drives the real client bytes.
    // SILENT by design: the settings card's arms count the boot's console warnings, and an
    // optional tab that is simply absent is not a warning-worthy event (the same reading the
    // better-sidebar mount takes when its host never arrives).
    if (typeof ctx.inject !== "function" || typeof ctx.locale?.bind !== "function") return
    /** The translator bound to this tab's own locale namespace. */
    const t = ctx.locale.bind("mpdTeamSidebar");
    ctx.effect(() => ctx.locale.register("mpdTeamSidebar", {
      en: {
        "type.label": "Team",
        "guide.title": "Team",
        "guide.description": "Roster and shared task progress for this session",
      },
      zh: {
        "type.label": "团队",
        "guide.title": "团队",
        "guide.description": "本会话的名册与共享任务进度",
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
          console.info("[mpd] better-sidebar is mounted: the team view registers THERE, and the official right sidebar is left to its own tabs");
          return;
        }
      }
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
    sidebar.effect(() => sidebar.slots.register({
      name: "sidebar.right.pane.tab",
      key: TEAM_TAB_ID,
      locale: "mpdTeamSidebar",
      inject: (sessionId: unknown) => ({ sessionId }),
    }, TeamSidebarBody), "mpd-team-sidebar:body");
    });
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
    // The settings section: the Web HALF of the same `mpd` namespace the TUI /settings section
    // edits, mounted as its OWN top-level `MPD` section of the settings dialog (w14) — it no longer
    // rides the Plugins tab. Its mount is deferred (the settings scope is a plugin-provided
    // service, so it is awaited with ctx.inject, never declared here).
    try {
      loadSettingsCard().mountSettingsCard(ctx);
    } catch (error) {
      console.warn("[mpd] settings card mount failed: " + String(error));
    }
  }

  // zh is the key-set source of truth; en must stay key-complete against it. Exported so
  // the offline harness can assert that without a browser (contract §L A7).
  /** The page's dictionaries, frozen so an offline assertion cannot mutate them. */
  const dictionaries = { zh: Object.freeze({ ...zh }), en: Object.freeze({ ...en }) };

  // `inject`/`apply` are the client-module contract; the view plus the two pure helpers
  // (dictionaries and the §D failure mapper) are exported so the offline harness
  // (packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs) can pin them without a browser.
  module.exports = { inject, apply, WorkmateLibraryView, SIDEBAR_TAB_ID, describeFailure, failureReason, dictionaries, loadSettingsCard };
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
  createTeamView: (deps: { react: unknown; statePath: string; pollMs?: number }) => MpdTeamViewModule
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
