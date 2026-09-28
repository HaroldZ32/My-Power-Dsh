// mpd bundle web client — the bundle's OWN team surface: the TEAM WATCHDOG view.
//
// 0.1.7 REBASE (why this file is small now). Until 0.1.7 this page composed the RETIRED
// vendored `agent-teams` client's views (roster, task DAG, staged-plan cards, floater markup)
// into a DSH-better-sidebar tab, requiring `@nanmicoder/dsh-agent-teams` for its store,
// views, locales and CSS. Harness 0.1.7 ships an OFFICIAL Agent Teams client
// (`@deepseek-ai/dsh-experimental-client-ui-agent-team`, mounted by this bundle's
// `mpd-ui-agent-team` row) that owns the roster and task-board UI, so this page must NOT
// duplicate it. What remains OURS — and what no official client renders — is the team
// WATCHDOG: the hold per team, the newest WARN/ESCALATE banner and the unread incident
// replay, served by this bundle's own routes (`src/watchdog-web.ts`).
//
// The page therefore renders EXACTLY that: it polls `/plugins/mpd-team-watchdog/state`,
// shows the banner/hold/activity rows and acknowledges one incident through
// `/plugins/mpd-team-watchdog/ack`. It reads no team record, requires no adopted client and
// never registers an overlay, a chat node or a footer toggle (sidebar-only, as before).
//
// The module id, the factory shape and the exported names are UNCHANGED so the combined
// client (`scripts/build-mpd-client.mjs`) composes the same way; only the page's contents
// changed. The tab id is kept because the sidebar's `registerTab` throws on a duplicate and
// the host keys restored tabs on it.
//
// Plain JS, React.createElement only: there is no JSX transform in this bundle. This file is a
// FACTORY BODY, not a module: the whole file is ONE arrow-function expression, spliced into
// `client.js` as `factory: <this file>`, so it has no top-level import/export and every type it
// needs is declared inside the factory.
(require: (id: string) => unknown) => {
  /** The surface of the host's React module this page renders with (no React typings here). */
  interface ReactSurface {
    /** Create one element; `props` is null for a props-less element and children follow variadically. */
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
    /** Subscribe a component to an external store, when the host's React is new enough. */
    useSyncExternalStore?: (subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => WatchdogStore, getServerSnapshot?: () => WatchdogStore) => WatchdogStore
    /** The fallback subscription primitive for a React without `useSyncExternalStore`. */
    useState?: (initial: WatchdogStore) => [WatchdogStore, (next: WatchdogStore) => void]
    /** The effect primitive the fallback subscription uses to own its unsubscribe (always present). */
    useEffect: (effect: () => unknown, deps: unknown[]) => unknown
  }

  /** The one watchdog payload this page renders, or null before the first successful poll. */
  interface WatchdogStore {
    /** The last payload the route served, or null while nothing has been read. */
    payload: WatchdogPayload | null
    /** The last failure, kept so the page renders a reason instead of an empty panel. */
    error?: unknown
  }

  /** The watchdog state route's payload, read only as far as this page renders it. */
  interface WatchdogPayload {
    /** The route's own success marker; a payload without it is treated as unreadable. */
    ok?: boolean
    /** The newest unread WARN/ESCALATE (or the active hold), or null when the team is healthy. */
    banner?: WatchdogBanner | null
    /** Every durable hold the route reported, one row each. */
    held?: WatchdogHold[]
    /** The unread incident replay, newest first, one row each. */
    activity?: WatchdogActivity[]
    /** The unread incident ids, whose count is the tab badge. */
    unread?: unknown[]
    /** Whether the activity rows are a replay of incidents nobody acknowledged yet. */
    replay?: boolean
    /** The reader key the route answered for. */
    reader?: unknown
  }

  /** The banner row: the newest unread incident, or the hold that is currently in force. */
  interface WatchdogBanner {
    /** Which event produced the banner (`held`, `escalated` or `warned`). */
    kind: unknown
    /** The team the banner is about. */
    teamId: unknown
    /** The rendered cause sentence the watchdog stored. */
    cause: unknown
    /** Epoch milliseconds the banner's event happened at. */
    since: number
  }

  /** One durable hold, as the holds section lists it. */
  interface WatchdogHold {
    /** The team the hold parks. */
    teamId: unknown
    /** The rendered cause sentence the watchdog stored. */
    cause: unknown
    /** Epoch milliseconds the hold was applied at. */
    since: number
  }

  /** One activity row: an unread incident, or a hold without an incident. */
  interface WatchdogActivity {
    /** The incident id, used as the row key and as the acknowledge target. */
    id: unknown
    /** The human label, when the watchdog stored one; the kind is the fallback. */
    label?: unknown
    /** The incident kind, rendered when no label is present. */
    kind: unknown
    /** The team the incident is about. */
    teamId: unknown
    /** Epoch milliseconds the incident was recorded at (also the acknowledge watermark). */
    at: number
    /** The rendered cause sentence the watchdog stored. */
    cause: unknown
    /** How long the watched condition lasted, or null when the incident carries no duration. */
    ms?: number | null
  }

  /** The slice of the plugin context this page uses; the two services below are always present. */
  interface PageContext {
    /** Resolve a service by name; only the locale service is asked for, and only softly. */
    get?: (service: string) => LocaleService | undefined
    /** Own a disposable for this context's fibre lifetime (dictionaries and the poller). */
    effect: (setup: () => unknown, label: string) => unknown
    /** The locale registry this page adds its two dictionaries to. */
    locale: { register: (namespace: string, dictionaries: unknown) => unknown }
  }

  /** The locale service the page reads the active language from. */
  interface LocaleService {
    /** The active locale name (for example `zh-CN`), when the service knows one. */
    get?: () => unknown
  }

  /** The better-sidebar host's tab registry, as this page uses it. */
  interface SidebarService {
    /** Register a tab descriptor; the host throws on a duplicate id (probed before use). */
    registerTab: (descriptor: TabDescriptor) => unknown
    /** Look up a registered tab id, when the host supports the probe. */
    getTab?: (id: string) => unknown
  }

  /** The tab descriptor this page registers with the sidebar host. */
  interface TabDescriptor {
    /** The stable tab id (the host keys restored tabs on it and rejects a duplicate). */
    id: string
    /** The tab title, resolved through the page's translator on every render. */
    title: () => string
    /** The tab icon factory; the host passes the icon size in pixels. */
    icon: (size: number) => unknown
    /** The tab's position among the host's tabs. */
    order: number
    /** Whether the host keeps at most one instance of this tab. */
    single: boolean
    /** The one tab state the host opens on demand. */
    createTab: () => { tab: { id: string; type: string; title: string } }
    /** The unread count the host renders as a badge, or undefined for no badge. */
    badge: () => number | undefined
    /** The tab body factory; the host passes its own props through. */
    component: (props: unknown) => unknown
  }

  /** The props the sidebar host hands the page component (only the translator is read). */
  interface TeamPageProps {
    /** The translator for the active locale; absent means keys are rendered as they are. */
    t?: (key: string) => string
  }

  /** The CommonJS-shaped module record the client loader keeps for this factory. */
  var module: { exports: Record<string, unknown> } = { exports: {} };
  /** The object every export below is written onto (`module.exports`). */
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  // The loader hands back the host's own React module, and this bundle ships no React typings,
  // so the module boundary is described structurally and crossed with one cast.
  /** The React surface this page renders with. */
  let react = require("react") as ReactSurface;

  /** The tab id: the harness sidebar and the better-sidebar host both key this page on it. */
  const TEAM_TAB_ID = "mpd-agent-teams";
  /** The tab's position among the sidebar's own tabs. */
  const TEAM_TAB_ORDER = 85;
  /** The locale namespace this page's dictionaries are registered under. */
  const TEAM_LOCALE_NAMESPACE = "mpdAgentTeams";

  // The watchdog's own routes, served by this bundle's main plugin (`src/watchdog-web.ts`).
  /** The read-only state route the page polls. */
  const WATCHDOG_STATE_URL = "/plugins/mpd-team-watchdog/state";
  /** The acknowledge route that advances this reader's watermark. */
  const WATCHDOG_ACK_URL = "/plugins/mpd-team-watchdog/ack";
  /** The watermark key this page acknowledges as (the route's documented `web-panel` reader). */
  const WATCHDOG_WEB_READER = "web-panel";
  /** How often the poller re-reads the state route, in milliseconds. */
  const WATCHDOG_POLL_MS = 15000;

  /** The Simplified-Chinese dictionary (the page's own labels, not the harness's). */
  const zh: Record<string, string | undefined> = {
    "tab.title": "团队看门狗",
    "panel.subtitle": "只看门狗视图 —— 花名册与任务板由官方 Agent Teams 客户端提供。",
    "panel.loading": "加载中…",
    "panel.empty": "没有卡住的团队：没有 hold，也没有未读事件。",
    "panel.stuck": "有团队被暂停",
    "panel.hold": "hold",
    "panel.since": "自",
    "panel.activity": "未读事件",
    "panel.ack": "标记已读",
    "panel.reader": "读者",
    "panel.error": "看门狗状态不可读",
    "panel.replay": "（重放：这些事件尚未被确认）"
  };
  /** The English dictionary, key-complete against `zh` (the key-set source of truth). */
  const en: Record<string, string | undefined> = {
    "tab.title": "Team watchdog",
    "panel.subtitle": "Watchdog view only — the roster and task board belong to the official Agent Teams client.",
    "panel.loading": "Loading…",
    "panel.empty": "No stuck team: no hold and no unread incident.",
    "panel.stuck": "A team is paused",
    "panel.hold": "hold",
    "panel.since": "since",
    "panel.activity": "Unread incidents",
    "panel.ack": "Acknowledge",
    "panel.reader": "reader",
    "panel.error": "the watchdog state is unreadable",
    "panel.replay": "(replay: these incidents have not been acknowledged yet)"
  };

  /** The locale the browser is in, resolved through the host's own locale service. */
  function activeLocale(ctx: PageContext | undefined): string {
    try {
      /** The locale service, when this context exposes one. */
      const locale = ctx !== undefined && ctx !== null ? (typeof ctx.get === "function" ? ctx.get("locale") : undefined) : undefined;
      /** The service's own answer, which must be a non-empty locale name to count. */
      const value = locale !== undefined && locale !== null && typeof locale.get === "function" ? locale.get() : undefined;
      if (typeof value === "string" && value !== "") return value;
    } catch {
      // fall through to the default
    }
    return "en";
  }

  /** A translator bound to this context's locale (a missing key falls back to the key). */
  function translatorFor(ctx: PageContext | undefined): (key: string) => string {
    /** The dictionary for the active language: any `zh*` locale gets Chinese, everything else English. */
    const dict = activeLocale(ctx).toLowerCase().startsWith("zh") ? zh : en;
    return (key: string): string => (dict[key] !== undefined ? dict[key] : key);
  }

  // ── the store the page renders (ONE payload, refreshed by ONE poller) ────────
  /** The single store value the page renders and `useSyncExternalStore` compares by identity. */
  let store: WatchdogStore = { payload: null, error: undefined };
  /** Every subscribed component, notified after each publish. */
  const listeners = new Set<() => void>();
  /** The interval handle of the running poller, or null while it is stopped. */
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether a tick of the poller is currently awaiting the state route. */
  let pollInFlight = false;
  /** Whether a watchdog refresh (tick or manual) is currently in flight. */
  let watchdogInFlight = false;

  /** Replace the store with `patch` merged over it, then wake every subscriber. */
  function publish(patch: Partial<WatchdogStore>): void {
    store = Object.assign({}, store, patch);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // one bad subscriber must not stop the others
      }
    }
  }

  /** Subscribe a component to the store; the returned function unsubscribes it. */
  function subscribe(listener: () => void): () => boolean {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** The store as the subscription primitives read it (must be the SAME reference until a publish). */
  function getSnapshot(): WatchdogStore {
    return store;
  }

  /** One JSON GET/POST against a route; a non-OK answer throws so the caller can render a reason. */
  async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    // The route's answer, widened to null/undefined because this page stays defensive about a
    // host whose fetch resolves nothing (the checks below are the original ones, unchanged).
    /** The route's response object. */
    const response: Response | null | undefined = await fetch(url, init);
    if (response === undefined || response === null || response.ok !== true) {
      throw new Error("HTTP " + String(response === undefined || response === null ? "?" : response.status));
    }
    // A route body carries no static type here, so the parsed value stays `unknown` for the caller.
    /** The parsed body, narrowed by the caller. */
    return await response.json() as unknown;
  }

  /** One poll of the watchdog state route. Never throws into a render. */
  async function refreshWatchdog(): Promise<WatchdogPayload | null> {
    if (watchdogInFlight) return store.payload;
    watchdogInFlight = true;
    try {
      // The route answers this page's payload shape, and the `ok` marker in the condition below is
      // the runtime check; the cast is how an untyped HTTP body enters the typed store.
      /** The route's answer, read as a maybe-payload so its `ok` marker can be probed. */
      const payload = await fetchJson(WATCHDOG_STATE_URL) as WatchdogPayload | null;
      if (payload !== null && typeof payload === "object" && payload.ok === true) {
        publish({ payload, error: undefined });
        return payload;
      }
      publish({ payload: null, error: new Error("the watchdog route answered a non-ok payload") });
    } catch (error) {
      publish({ payload: null, error });
    } finally {
      watchdogInFlight = false;
    }
    return store.payload;
  }

  /** Acknowledge the replay up to ONE incident timestamp through the ack route. */
  async function acknowledgeIncident(incidentTs: number): Promise<boolean> {
    try {
      // Widened to null/undefined because the checks below are the original defensive ones.
      /** The acknowledgement request's answer. */
      const response: Response | null | undefined = await fetch(WATCHDOG_ACK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reader: WATCHDOG_WEB_READER, upTo: incidentTs })
      });
      if (response === undefined || response === null || response.ok !== true) {
        throw new Error("HTTP " + String(response === undefined || response === null ? "?" : response.status));
      }
      await refreshWatchdog();
      return true;
    } catch (error) {
      publish({ error });
      return false;
    }
  }

  /** Start the one poller, unless it is already running. */
  function startPolling(): void {
    if (pollTimer !== null) return;
    void refreshWatchdog();
    try {
      pollTimer = setInterval(() => {
        if (pollInFlight) return;
        pollInFlight = true;
        void refreshWatchdog().finally(() => {
          pollInFlight = false;
        });
      }, WATCHDOG_POLL_MS);
    } catch {
      pollTimer = null;
    }
  }

  /** Stop the poller, if one is running. */
  function stopPolling(): void {
    if (pollTimer === null) return;
    try {
      clearInterval(pollTimer);
    } catch {
      // already cleared
    }
    pollTimer = null;
  }

  // ── rendering ────────────────────────────────────────────────────────────────
  /** The panel's own flex column layout. */
  const PANEL_STYLE = { display: "flex", flexDirection: "column", gap: "6px", padding: "8px", fontFamily: "inherit" };
  /** The banner box: a bordered strip in the current text colour. */
  const BANNER_STYLE = { padding: "6px 8px", borderRadius: "4px", border: "1px solid currentColor" };
  /** Secondary text (subtitles, section titles, the reader line). */
  const MUTED_STYLE = { opacity: 0.7, fontSize: "0.9em" };
  /** One activity row: a two-line column. */
  const ROW_STYLE = { display: "flex", flexDirection: "column", gap: "2px", padding: "4px 0" };

  /** An epoch-millisecond instant as an ISO string; a non-date value falls back to its text form. */
  function formatTime(at: number): string {
    try {
      return new Date(at).toISOString();
    } catch {
      return String(at);
    }
  }

  /**
   * The store subscription, in the form every React of this vintage supports.
   *
   * A host WITHOUT `useSyncExternalStore` still renders: the component then reads the store
   * on each render and re-renders through the subscription.
   */
  function useStoreSnapshot(): WatchdogStore {
    /** The host's React module, under the name the original code used at this seam. */
    const React = react;
    if (typeof React.useSyncExternalStore === "function") {
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }
    if (typeof React.useState === "function") {
      /** The fallback subscription's state pair (value plus setter). */
      const state = React.useState(store);
      /** The setter half, which the subscription calls with a fresh snapshot. */
      const setState = state[1];
      React.useEffect(() => subscribe(() => setState(getSnapshot())), []);
      return state[0];
    }
    return store;
  }

  /** The panel body. Pure over `state`; every failure has an on-screen answer. */
  function TeamPageView(props: TeamPageProps | undefined): unknown {
    /** The translator for this render, or the identity fallback when the host passed none. */
    const t = props !== undefined && typeof props.t === "function" ? props.t : (key: string): string => key;
    /** The store snapshot this render is built from. */
    const state = useStoreSnapshot();
    /** The payload being rendered, or null while loading/failed. */
    const payload = state.payload;
    /** The panel's children, appended in render order. */
    const rows: unknown[] = [];
    rows.push(react.createElement("div", { key: "subtitle", style: MUTED_STYLE }, t("panel.subtitle")));
    if (state.error !== undefined && payload === null) {
      // The store keeps whatever was thrown, so its message is read through a structural cast
      // (the null/undefined guards in front of the cast are the original ones, kept as they were).
      rows.push(react.createElement("div", { key: "error", "data-watchdog-error": true },
        t("panel.error") + ": " + String((state.error !== null && state.error !== undefined && (state.error as { message?: unknown }).message !== undefined) ? (state.error as { message?: unknown }).message : state.error)));
    } else if (payload === null) {
      rows.push(react.createElement("div", { key: "loading", style: MUTED_STYLE }, t("panel.loading")));
    } else {
      /** The banner to render, or null when the route reported no stuck team. */
      const banner = payload.banner !== null && payload.banner !== undefined ? payload.banner : null;
      rows.push(react.createElement("div", {
        key: "banner",
        style: BANNER_STYLE,
        "data-watchdog-banner": banner === null ? "none" : String(banner.kind)
      }, banner === null
        ? t("panel.empty")
        : t("panel.stuck") + " · " + String(banner.teamId) + " · " + String(banner.cause) + " · " + t("panel.since") + " " + formatTime(banner.since)));
      /** Every hold the route reported (an absent list renders no section). */
      const holds = Array.isArray(payload.held) ? payload.held : [];
      if (holds.length > 0) {
        rows.push(react.createElement("div", { key: "holds-title", style: MUTED_STYLE }, t("panel.hold")));
        for (const hold of holds) {
          rows.push(react.createElement("div", { key: "hold-" + String(hold.teamId), "data-watchdog-hold": String(hold.teamId) },
            String(hold.teamId) + " · " + String(hold.cause) + " · " + t("panel.since") + " " + formatTime(hold.since)));
        }
      }
      /** The unread incident replay (an absent list renders no section). */
      const activity = Array.isArray(payload.activity) ? payload.activity : [];
      if (activity.length > 0) {
        rows.push(react.createElement("div", { key: "activity-title", style: MUTED_STYLE }, t("panel.activity") + " (" + activity.length + ")"));
        if (payload.replay === true) rows.push(react.createElement("div", { key: "replay", style: MUTED_STYLE }, t("panel.replay")));
        for (const record of activity) {
          rows.push(react.createElement("div", { key: "activity-" + String(record.id), style: ROW_STYLE, "data-watchdog-activity": String(record.id) },
            react.createElement("span", null, String(record.label !== undefined ? record.label : record.kind) + " · " + String(record.teamId) + " · " + formatTime(record.at)),
            react.createElement("span", { style: MUTED_STYLE }, String(record.cause) + (record.ms === null || record.ms === undefined ? "" : " " + String(record.ms) + "ms")),
            react.createElement("button", {
              key: "ack",
              type: "button",
              "data-watchdog-ack": String(record.id),
              onClick: (): void => { void acknowledgeIncident(record.at); }
            }, t("panel.ack"))));
        }
      }
      rows.push(react.createElement("div", { key: "reader", style: MUTED_STYLE }, t("panel.reader") + ": " + String(payload.reader)));
    }
    return react.createElement("div", { style: PANEL_STYLE, "data-mpd-team-watchdog-page": true }, rows);
  }

  /**
   * Register the watchdog sidebar tab once DSH-better-sidebar is available.
   * @param ctx - the better-sidebar-scoped context.
   * @param service - the `betterSidebar` service.
   * @returns true when the tab is registered (or already present).
   */
  function registerTeamSidebarTab(ctx: PageContext, service: SidebarService | null | undefined): boolean {
    if (service === undefined || service === null || typeof service.registerTab !== "function") {
      console.warn("[mpd] better-sidebar exposes no registerTab — the team watchdog page has no host");
      return false;
    }
    // IDEMPOTENT by descriptor presence: `ctx.inject` re-fires on a provider remount and the
    // sidebar's `registerTab` THROWS on a duplicate id.
    try {
      if (typeof service.getTab === "function" && service.getTab(TEAM_TAB_ID) !== undefined) return true;
    } catch {
      // a throwing getTab means "cannot tell": fall through and register as before
    }
    try {
      /** The translator this registration closes over (the title and body both use it). */
      const t = translatorFor(ctx);
      ctx.effect(() => ctx.locale.register(TEAM_LOCALE_NAMESPACE, { zh, en }), "mpd-agent-teams: dictionaries");
      ctx.effect(() => service.registerTab({
        id: TEAM_TAB_ID,
        title: () => t("tab.title"),
        icon: (size: number) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F6A8}"),
        order: TEAM_TAB_ORDER,
        single: true,
        createTab: () => ({ tab: { id: TEAM_TAB_ID, type: TEAM_TAB_ID, title: t("tab.title") } }),
        // The badge is the UNREAD count of the last poll: no fetch, never a throw.
        badge: (): number | undefined => {
          try {
            /** The last payload the poller published. */
            const payload = store.payload;
            if (payload === null || payload === undefined) return undefined;
            /** How many incidents this reader has not acknowledged yet. */
            const unread = Array.isArray(payload.unread) ? payload.unread.length : 0;
            return unread > 0 ? unread : undefined;
          } catch {
            return undefined;
          }
        },
        component: (props: unknown) => react.createElement(TeamPageView, Object.assign({ t }, props))
      }), "mpd-agent-teams: sidebar tab");
      ctx.effect(() => {
        startPolling();
        return () => { stopPolling(); };
      }, "mpd-agent-teams: watchdog polling");
      return true;
    } catch (error) {
      console.warn("[mpd] team watchdog sidebar tab registration failed: " + String(error));
      return false;
    }
  }

  exports.registerTeamSidebarTab = registerTeamSidebarTab;
  exports.TeamPageView = TeamPageView;
  exports.SIDEBAR_TAB_ID = TEAM_TAB_ID;
  exports.SIDEBAR_TAB_ORDER = TEAM_TAB_ORDER;
  // Test seams: the offline driver polls and acknowledges through these instead of reaching
  // into module internals.
  /** The test seam that reads the store without a render. */
  exports.__watchdogState = () => store;
  /** The test seam that runs one poll through the real route code. */
  exports.__watchdogPoll = () => refreshWatchdog();
  /** The test seam that acknowledges one incident timestamp. */
  exports.__watchdogAck = (incidentTs: number) => acknowledgeIncident(incidentTs);
  /** The test seam that returns the module to its just-loaded state (poller stopped, store empty). */
  exports.__resetTeamPageForTests = (): void => {
    stopPolling();
    pollInFlight = false;
    watchdogInFlight = false;
    store = { payload: null, error: undefined };
    listeners.clear();
  };
  exports.WATCHDOG_STATE_URL = WATCHDOG_STATE_URL;
  exports.WATCHDOG_ACK_URL = WATCHDOG_ACK_URL;
  exports.WATCHDOG_WEB_READER = WATCHDOG_WEB_READER;
  return module.exports;
}
