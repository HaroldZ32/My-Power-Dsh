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
// Plain JS, React.createElement only: there is no JSX transform in this bundle.
(require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");

  const TEAM_TAB_ID = "mpd-agent-teams";
  const TEAM_TAB_ORDER = 85;
  const TEAM_LOCALE_NAMESPACE = "mpdAgentTeams";

  // The watchdog's own routes, served by this bundle's main plugin (`src/watchdog-web.ts`).
  const WATCHDOG_STATE_URL = "/plugins/mpd-team-watchdog/state";
  const WATCHDOG_ACK_URL = "/plugins/mpd-team-watchdog/ack";
  const WATCHDOG_WEB_READER = "web-panel";
  const WATCHDOG_POLL_MS = 15000;

  const zh = {
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
  const en = {
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
  function activeLocale(ctx) {
    try {
      const locale = ctx !== undefined && ctx !== null ? (typeof ctx.get === "function" ? ctx.get("locale") : undefined) : undefined;
      const value = locale !== undefined && locale !== null && typeof locale.get === "function" ? locale.get() : undefined;
      if (typeof value === "string" && value !== "") return value;
    } catch {
      // fall through to the default
    }
    return "en";
  }

  /** A translator bound to this context's locale (a missing key falls back to the key). */
  function translatorFor(ctx) {
    const dict = activeLocale(ctx).toLowerCase().startsWith("zh") ? zh : en;
    return (key) => (dict[key] !== undefined ? dict[key] : key);
  }

  // ── the store the page renders (ONE payload, refreshed by ONE poller) ────────
  let store = { payload: null, error: undefined };
  const listeners = new Set();
  let pollTimer = null;
  let pollInFlight = false;
  let watchdogInFlight = false;

  function publish(patch) {
    store = Object.assign({}, store, patch);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // one bad subscriber must not stop the others
      }
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return store;
  }

  async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (response === undefined || response === null || response.ok !== true) {
      throw new Error("HTTP " + String(response === undefined || response === null ? "?" : response.status));
    }
    return await response.json();
  }

  /** One poll of the watchdog state route. Never throws into a render. */
  async function refreshWatchdog() {
    if (watchdogInFlight) return store.payload;
    watchdogInFlight = true;
    try {
      const payload = await fetchJson(WATCHDOG_STATE_URL);
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
  async function acknowledgeIncident(incidentTs) {
    try {
      const response = await fetch(WATCHDOG_ACK_URL, {
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

  function startPolling() {
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

  function stopPolling() {
    if (pollTimer === null) return;
    try {
      clearInterval(pollTimer);
    } catch {
      // already cleared
    }
    pollTimer = null;
  }

  // ── rendering ────────────────────────────────────────────────────────────────
  const PANEL_STYLE = { display: "flex", flexDirection: "column", gap: "6px", padding: "8px", fontFamily: "inherit" };
  const BANNER_STYLE = { padding: "6px 8px", borderRadius: "4px", border: "1px solid currentColor" };
  const MUTED_STYLE = { opacity: 0.7, fontSize: "0.9em" };
  const ROW_STYLE = { display: "flex", flexDirection: "column", gap: "2px", padding: "4px 0" };

  function formatTime(at) {
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
  function useStoreSnapshot() {
    const React = react;
    if (typeof React.useSyncExternalStore === "function") {
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }
    if (typeof React.useState === "function") {
      const state = React.useState(store);
      const setState = state[1];
      React.useEffect(() => subscribe(() => setState(getSnapshot())), []);
      return state[0];
    }
    return store;
  }

  /** The panel body. Pure over `state`; every failure has an on-screen answer. */
  function TeamPageView(props) {
    const t = props !== undefined && typeof props.t === "function" ? props.t : (key) => key;
    const state = useStoreSnapshot();
    const payload = state.payload;
    const rows = [];
    rows.push(react.createElement("div", { key: "subtitle", style: MUTED_STYLE }, t("panel.subtitle")));
    if (state.error !== undefined && payload === null) {
      rows.push(react.createElement("div", { key: "error", "data-watchdog-error": true },
        t("panel.error") + ": " + String((state.error !== null && state.error !== undefined && state.error.message !== undefined) ? state.error.message : state.error)));
    } else if (payload === null) {
      rows.push(react.createElement("div", { key: "loading", style: MUTED_STYLE }, t("panel.loading")));
    } else {
      const banner = payload.banner !== null && payload.banner !== undefined ? payload.banner : null;
      rows.push(react.createElement("div", {
        key: "banner",
        style: BANNER_STYLE,
        "data-watchdog-banner": banner === null ? "none" : String(banner.kind)
      }, banner === null
        ? t("panel.empty")
        : t("panel.stuck") + " · " + String(banner.teamId) + " · " + String(banner.cause) + " · " + t("panel.since") + " " + formatTime(banner.since)));
      const holds = Array.isArray(payload.held) ? payload.held : [];
      if (holds.length > 0) {
        rows.push(react.createElement("div", { key: "holds-title", style: MUTED_STYLE }, t("panel.hold")));
        for (const hold of holds) {
          rows.push(react.createElement("div", { key: "hold-" + String(hold.teamId), "data-watchdog-hold": String(hold.teamId) },
            String(hold.teamId) + " · " + String(hold.cause) + " · " + t("panel.since") + " " + formatTime(hold.since)));
        }
      }
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
              onClick: () => { void acknowledgeIncident(record.at); }
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
  function registerTeamSidebarTab(ctx, service) {
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
      const t = translatorFor(ctx);
      ctx.effect(() => ctx.locale.register(TEAM_LOCALE_NAMESPACE, { zh, en }), "mpd-agent-teams: dictionaries");
      ctx.effect(() => service.registerTab({
        id: TEAM_TAB_ID,
        title: () => t("tab.title"),
        icon: (size) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F6A8}"),
        order: TEAM_TAB_ORDER,
        single: true,
        createTab: () => ({ tab: { id: TEAM_TAB_ID, type: TEAM_TAB_ID, title: t("tab.title") } }),
        // The badge is the UNREAD count of the last poll: no fetch, never a throw.
        badge: () => {
          try {
            const payload = store.payload;
            if (payload === null || payload === undefined) return undefined;
            const unread = Array.isArray(payload.unread) ? payload.unread.length : 0;
            return unread > 0 ? unread : undefined;
          } catch {
            return undefined;
          }
        },
        component: (props) => react.createElement(TeamPageView, Object.assign({ t }, props))
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
  exports.__watchdogState = () => store;
  exports.__watchdogPoll = () => refreshWatchdog();
  exports.__watchdogAck = (incidentTs) => acknowledgeIncident(incidentTs);
  exports.__resetTeamPageForTests = () => {
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
