// mpd AgentTeams sidebar page (factory body, inlined into the combined client.js by
// scripts/build-mpd-client.mjs as the module id "@mpd-dsh/team-page").
//
// DSH-better-sidebar is the ONLY GUI surface for AgentTeams now: this page renders
// everything the adopted in-conversation card and the top-right floating panel used to
// render — the conversation's teams with members/live activity, task rows, the
// dependency map, the stop-team control and the staged-plan approval editor — inside a
// sidebar tab, for the tab's own conversation scope.
//
// VISUAL PARITY IS A REQUIREMENT, so the page reproduces the floater's own composition
// instead of inventing a layout: the same `aside` root carrying the adopted
// `panel`/`panelHead`/`panelTitle`/`panelDot`/`panelControls`/`iconButton`/`teams`/
// `emptyHint`/`archivedWrap`/`archiveLabel` class names, the same header markup
// (title + busy dot + collapse control) and the same TeamSections. Carrying `panel` is
// not cosmetic: that class is where the adopted CSS declares the `--dsw-alias-*` custom
// properties every team/member/task rule reads, so without it the sections render
// unstyled. Only two things are NOT reproduced, both by decision: the window-manager
// half (inline overrides below) and the historic-card branch — it was fed by the
// removed in-conversation card's registry, so it is unreachable by construction.
//
// It deliberately does NOT render the adopted ActivityPanel component itself: that
// component IS the window manager (it measures the shell overlay, writes the
// conversation-column shift and drags/resizes itself), which is exactly what the
// sidebar replaces. It composes the adopted VIEWS and CSS-module classes instead —
// TeamSection / the monitor store / the locale dictionaries — all reached through the
// additive export bridge (scripts/patch-agent-teams-client.mjs).
//
// Plain JS, React.createElement only: there is no JSX transform in this bundle.
(require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");
  const adopted = require("@nanmicoder/dsh-agent-teams");

  const TEAM_TAB_ID = "mpd-agent-teams";
  const TEAM_TAB_ORDER = 85;
  const TEAM_LOCALE_NAMESPACE = "mpdAgentTeams";
  const AUTO_OPEN_KEY = "autoOpenOnTeamActivity";
  // NO content seed. dsh-better-sidebar >= 0.19 routes any seed carrying `path` (or
  // `url`) to DSH's NATIVE right column through `surface.openResource(fileAddress(…))`
  // instead of opening this registered tab type ("An open carrying a `path` or `url`
  // goes through the native surface instead"), so the throwaway marker path this call
  // used to carry (`team-activity`) made the host resolve `<cwd>/team-activity`, fail
  // `realpath` with ENOENT and raise `cannot resolve target …` into the GUI — while
  // never opening the tab at all. A type-only seed lands the tab in its own surface and
  // expands it, which is exactly what auto-open means here.
  /** Page-settle window: teams restored on page load must never auto-open the panel. */
  const AUTO_OPEN_SETTLE_MS = 2500;

  // ── Stuck-team front door (the watchdog store's web reader) ────────────────
  // Both routes are served by OUR bundle package (src/watchdog-web.ts reads the watchdog
  // package's documented store contract; neither the adopted plugin nor the watchdog
  // package is edited). WATCHDOG_WEB_READER is the per-reader watermark key: it is stable,
  // and an acknowledge advances exactly this key in read-watermark.json.
  const WATCHDOG_STATE_URL = "/plugins/mpd-team-watchdog/state";
  const WATCHDOG_ACK_URL = "/plugins/mpd-team-watchdog/ack";
  const WATCHDOG_WEB_READER = "web-panel";
  /** Mirror of the adopted poll cadence; the FIRST poll happens on mount, without user action. */
  const WATCHDOG_POLL_MS = 15000;

  // Page-owned keys only. Everything the panel itself shows (title, empty hint,
  // collapse, panel aria) resolves through the adopted dictionaries, so the sidebar page
  // says exactly what the floater said.
  const zh = {
    "tab.title": "AgentTeams",
    "page.error": "团队状态读取失败：{message}",
    "page.unavailable": "团队视图不可用：{reason}",
    "settings.autoOpen.title": "团队出现时自动打开",
    "settings.autoOpen.desc": "本对话新建团队或有团队开始工作时，自动在侧栏打开 AgentTeams 页面。",
    "watchdog.banner.held": "团队已被看门狗暂停：{teamId}（{cause}）",
    "watchdog.banner.warned": "看门狗告警：{teamId}（{cause}）",
    "watchdog.banner.detail": "任务 {taskId} · 尝试 {attemptId} · 起始于 {since}",
    "watchdog.banner.ack": "确认",
    "watchdog.banner.acked": "已确认，不再重复显示",
    "watchdog.banner.error": "确认失败：{message}",
    "watchdog.record.title": "活动记录",
    "watchdog.record.escalate": "已升级（暂停）",
    "watchdog.record.warn": "告警",
    "watchdog.record.hold": "已暂停",
    "watchdog.record.meta": "{teamId} · {cause}",
    "watchdog.unacknowledged": "未确认：每次载入都会重新显示，直到你确认。",
  };
  const en = {
    "tab.title": "AgentTeams",
    "page.error": "Failed to read team state: {message}",
    "page.unavailable": "Team view unavailable: {reason}",
    "settings.autoOpen.title": "Auto-open when a team appears",
    "settings.autoOpen.desc": "Open the AgentTeams page in the sidebar when this conversation creates a team or a team starts working.",
    "watchdog.banner.held": "Team paused by the watchdog: {teamId} ({cause})",
    "watchdog.banner.warned": "Watchdog warning: {teamId} ({cause})",
    "watchdog.banner.detail": "task {taskId} · attempt {attemptId} · since {since}",
    "watchdog.banner.ack": "Acknowledge",
    "watchdog.banner.acked": "Acknowledged — it will not be shown again",
    "watchdog.banner.error": "Acknowledge failed: {message}",
    "watchdog.record.title": "Activity record",
    "watchdog.record.escalate": "escalated (paused)",
    "watchdog.record.warn": "warned",
    "watchdog.record.hold": "held",
    "watchdog.record.meta": "{teamId} · {cause}",
    "watchdog.unacknowledged": "Unacknowledged: it replays on every load until you acknowledge it.",
  };
  /** Inline SVG path of the platform's `IconChevronDownOutline14` (see chevronDown14). */
  const CHEVRON_DOWN_14_PATH = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

  function interpolate(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (_match, key) =>
      params && params[key] !== undefined ? String(params[key]) : "{" + key + "}");
  }

  /** The host's active locale, tolerating a minimal ctx (tests, older runtimes). */
  function activeLocale(ctx) {
    try {
      const active = ctx && ctx.locale && ctx.locale.getSnapshot && ctx.locale.getSnapshot().active;
      return active === "zh" ? "zh" : "en";
    } catch {
      return "en";
    }
  }

  /**
   * Translator for the page AND the adopted views it renders: our page keys plus the
   * adopted dictionaries (which is what TeamSection/StagingPlanEditor look up).
   */
  function translatorFor(ctx) {
    const locale = activeLocale(ctx);
    const adoptedDict = (locale === "zh" ? adopted.zh : adopted.en) || {};
    const ownDict = locale === "zh" ? zh : en;
    return (key, params) => {
      const value = ownDict[key] !== undefined ? ownDict[key] : adoptedDict[key];
      return interpolate(value === undefined ? key : value, params);
    };
  }

  // ── Shared team state (module-level singleton) ──────────────────────────────
  // One polling controller for the whole client: the adopted startActivityPolling is
  // NOT reference counted, so a second caller would double every request. The store is
  // also what the tab badge reads — the badge runs on every tab-bar render, including
  // while the sidebar is collapsed, so it must never fetch.
  // `watchdog` is the stuck-team slice: the payload the banner and the activity record
  // render from, plus the last error/ack outcome. It survives a failed poll (the previous
  // banner is kept) so a route blip can never hide a stuck team.
  let store = { teams: [], archivedTeams: [], error: undefined, sessionId: undefined, watchdog: { payload: null, error: undefined } };
  const storeListeners = new Set();
  let pollController = null;
  let pollSessionId = undefined;
  let pollUnsubscribe = null;
  // Auto-open bookkeeping: ids seen in a settled snapshot never auto-open (that is the
  // restore pass), and an id only ever opens once.
  let autoOpenArmed = false;
  let autoOpenTimer = null;
  const autoOpenSeen = new Set();
  const autoOpenFired = new Set();

  function publishSnapshot() {
    const snapshot = adopted.getActivitySnapshotsSnapshot();
    const next = {
      ...store,
      teams: Array.isArray(snapshot.teams) ? snapshot.teams : [],
      archivedTeams: Array.isArray(snapshot.archivedTeams) ? snapshot.archivedTeams : [],
      error: undefined,
    };
    store = next;
    for (const listener of storeListeners) listener();
  }

  function subscribeStore(listener) {
    storeListeners.add(listener);
    return () => { storeListeners.delete(listener); };
  }

  function getStoreSnapshot() {
    return store;
  }

  // ── Stuck-team state: fetch, publish, acknowledge ──────────────────────────
  // The watchdog slice rides the SAME store object as the team snapshot, so one render
  // subscription covers both and no second React store is introduced.
  let watchdogTimer = null;
  let watchdogInFlight = false;

  /** The state URL for THIS reader — the query names the watermark key, never a session. */
  function watchdogStateUrl() {
    return WATCHDOG_STATE_URL + "?reader=" + encodeURIComponent(WATCHDOG_WEB_READER);
  }

  function publishWatchdog(patch) {
    store = { ...store, watchdog: { ...(store.watchdog || {}), ...patch } };
    for (const listener of storeListeners) listener();
  }

  /**
   * One watchdog poll. A failure is recorded in the slice (and the previous banner is
   * KEPT, never cleared) so a transient route error cannot silently hide a stuck team.
   */
  async function refreshWatchdog() {
    if (watchdogInFlight) return store.watchdog;
    watchdogInFlight = true;
    try {
      const response = await globalThis.fetch(watchdogStateUrl(), { cache: "no-store" });
      if (response === undefined || response.ok !== true) {
        publishWatchdog({ error: "HTTP " + String(response === undefined ? "?" : response.status) });
        return store.watchdog;
      }
      const payload = await response.json();
      publishWatchdog({ payload, error: undefined, fetchedAt: Date.now() });
      return store.watchdog;
    } catch (error) {
      publishWatchdog({ error: String(error && error.message ? error.message : error) });
      return store.watchdog;
    } finally {
      watchdogInFlight = false;
    }
  }

  /** The FIRST poll is immediate: a user who was not watching still sees the replay. */
  function startWatchdogPolling() {
    void refreshWatchdog();
    if (watchdogTimer !== null) return;
    watchdogTimer = setInterval(() => { void refreshWatchdog(); }, WATCHDOG_POLL_MS);
    if (typeof watchdogTimer === "object" && watchdogTimer !== null && typeof watchdogTimer.unref === "function") {
      watchdogTimer.unref();
    }
  }

  function stopWatchdogPolling() {
    if (watchdogTimer === null) return;
    try { clearInterval(watchdogTimer); } catch { /* already cleared */ }
    watchdogTimer = null;
  }

  /**
   * The explicit acknowledge. It POSTs the incident timestamp, then re-polls: the banner
   * and the record disappear only because the SERVER's unread set is now empty for this
   * reader — never because the client hid them locally.
   */
  async function acknowledgeIncident(incidentTs) {
    try {
      const response = await globalThis.fetch(WATCHDOG_ACK_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reader: WATCHDOG_WEB_READER, incidentTs }),
      });
      const body = response !== undefined && typeof response.json === "function" ? await response.json() : {};
      if (response === undefined || response.ok !== true || body.ok !== true) {
        publishWatchdog({ ackError: String(body && body.error ? body.error : "HTTP " + String(response === undefined ? "?" : response.status)) });
        return false;
      }
      publishWatchdog({ ackError: undefined, lastAck: { reader: WATCHDOG_WEB_READER, watermark: body.after } });
      await refreshWatchdog();
      return true;
    } catch (error) {
      publishWatchdog({ ackError: String(error && error.message ? error.message : error) });
      return false;
    }
  }

  function stopPolling() {
    if (pollController !== null) {
      try { pollController.stop(); } catch { /* already stopped */ }
      pollController = null;
    }
    if (pollUnsubscribe !== null) {
      try { pollUnsubscribe(); } catch { /* already disposed */ }
      pollUnsubscribe = null;
    }
    stopWatchdogPolling();
    pollSessionId = undefined;
  }

  /**
   * Point the single controller at one conversation. The adopted controller performs an
   * immediate live+archive restore for a discovery session, then probes at a low
   * cadence and upgrades to the live cadence once that session owns a team.
   */
  function ensurePolling(sessionId) {
    const id = typeof sessionId === "string" ? sessionId.trim() : "";
    if (id === "") return;
    if (pollController !== null && pollSessionId === id) return;
    stopPolling();
    pollSessionId = id;
    try {
      pollUnsubscribe = adopted.subscribeActivitySnapshots(() => { publishSnapshot(); });
      pollController = adopted.startActivityPolling([], { discoverySessionId: id });
      store = { ...store, sessionId: id };
      // The stuck-team front door polls alongside the activity controller: the FIRST
      // fetch happens here, on mount, so a user who was not watching still gets the
      // unread replay without any interaction.
      startWatchdogPolling();
      void pollController.firstTick.then(
        () => { publishSnapshot(); armAutoOpen(); },
        (error) => {
          store = { ...store, error: String(error && error.message ? error.message : error) };
          for (const listener of storeListeners) listener();
        },
      );
    } catch (error) {
      store = { ...store, error: String(error) };
      for (const listener of storeListeners) listener();
    }
  }

  /** After the settle window, the current team set becomes the restore baseline. */
  function armAutoOpen(delayMs) {
    if (autoOpenTimer !== null) return;
    autoOpenTimer = setTimeout(() => {
      autoOpenTimer = null;
      for (const team of store.teams) autoOpenSeen.add(team.teamId);
      autoOpenArmed = true;
    }, delayMs === undefined ? AUTO_OPEN_SETTLE_MS : delayMs);
    if (typeof autoOpenTimer === "object" && autoOpenTimer !== null && typeof autoOpenTimer.unref === "function") {
      autoOpenTimer.unref();
    }
  }

  /** The auto-open policy lives in the descriptor's own plugin settings (no default there). */
  let autoOpenPolicyService = undefined;
  /**
   * The model directory service, resolved through
   * `ctx.inject(["modelDirectories", "remote.session"], …)`. It is
   * provided by ANOTHER plugin's fiber, so a bare `ctx.get` probe answers undefined forever (the
   * measured rule in src/web-client.js) — which is exactly the defect that left every staged
   * member's model picker on its declared list. `remote.session` is in the list because cordis
   * services are CALLER-scoped: the resolver reads `this.ctx.remote.session` on the ACCESSING ctx,
   * so `directoryFor` throws without it (measured in a real browser, evidence/web-card-catalog/).
   * `sessions` is deliberately NOT listed here: the settings card reads it for the bound session,
   * this page never does.
   */
  let modelDirectoryService = undefined;
  function autoOpenEnabled() {
    try {
      const snapshot = autoOpenPolicyService && typeof autoOpenPolicyService.getSnapshot === "function"
        ? autoOpenPolicyService.getSnapshot()
        : undefined;
      const prefs = snapshot ? snapshot.prefs : undefined;
      const settings = prefs && prefs.pluginSettings ? prefs.pluginSettings[TEAM_TAB_ID] : undefined;
      const value = settings ? settings[AUTO_OPEN_KEY] : undefined;
      // The sidebar declares no default for plugin-owned keys: an unwritten key is ON.
      return value === undefined ? true : value !== false;
    } catch {
      return true;
    }
  }

  /** Open the tab once for a team that appeared after the restore baseline. */
  function maybeAutoOpen() {
    if (!autoOpenArmed || autoOpenPolicyService === undefined) return;
    if (autoOpenEnabled() === false) return;
    try {
      if (autoOpenPolicyService.isTabEnabled && autoOpenPolicyService.isTabEnabled(TEAM_TAB_ID) === false) return;
    } catch {
      return;
    }
    for (const team of store.teams) {
      if (autoOpenSeen.has(team.teamId) || autoOpenFired.has(team.teamId)) continue;
      autoOpenSeen.add(team.teamId);
      autoOpenFired.add(team.teamId);
      try {
        autoOpenPolicyService.openTab({ type: TEAM_TAB_ID });
      } catch (error) {
        console.warn("[mpd] AgentTeams auto-open failed: " + String(error));
      }
      return;
    }
  }

  // ── Adopted-view helpers ────────────────────────────────────────────────────
  /** Live team count for one conversation — cheap, cached, never throws (badge path). */
  function liveTeamCount(sessionId) {
    if (typeof sessionId !== "string" || sessionId === "") return 0;
    let count = 0;
    for (const team of store.teams) {
      if (team.captainSessionId === sessionId) count += 1;
    }
    return count;
  }

  /**
   * The staged-plan approval editor needs a model directory, and the adopted
   * directoryFor() THROWS for an unknown session while StagingPlanEditor calls it during
   * render — so it is resolved defensively and degrades to no editor, never to a crash.
   *
   * The service comes from `modelDirectoryService`, which `registerTeamSidebarTab` fills through
   * `ctx.inject(["modelDirectories", "remote.session"], …)`. It is NEVER re-probed with
   * `ctx.get` here: the service
   * is provided by another plugin's fiber, so a bare probe answers undefined for the life of the
   * page and the picker would silently fall back to its declared list forever.
   */
  function directoryForTeam(team) {
    if (team === undefined || team.phase !== "staged") return undefined;
    try {
      const directories = modelDirectoryService;
      if (directories === undefined || directories === null || typeof directories.directoryFor !== "function") return undefined;
      return directories.directoryFor(team.captainSessionId);
    } catch {
      return undefined;
    }
  }

  /** Best-effort composer focus, mirroring the floater's "return to the conversation". */
  function focusComposer() {
    try {
      window.requestAnimationFrame(() => {
        const composer = document.querySelector("[data-composer-card] textarea");
        if (composer !== null) composer.focus();
      });
    } catch { /* no DOM (offline harness) */ }
  }

  /** Open one member's transcript, mirroring the adopted session-navigation helper. */
  function openMember(ctx, parentSessionId, childSessionId) {
    const sessions = ctx ? ctx.sessions : undefined;
    if (sessions === undefined || typeof sessions.open !== "function") return;
    if (sessions.openSubagent === undefined || sessions.refreshSubagents === undefined) {
      try { sessions.open(childSessionId); } catch (error) { console.warn("[mpd] member open failed: " + String(error)); }
      return;
    }
    Promise.resolve(sessions.refreshSubagents(parentSessionId)).then(() => {
      const retained = typeof sessions.subagentAddress === "function" ? sessions.subagentAddress(childSessionId) : undefined;
      sessions.openSubagent(retained && retained.parentSessionId === parentSessionId
        ? retained
        : { parentSessionId, childSessionId, mode: "continuable" });
    }).catch((error) => {
      console.warn("[mpd] member open failed: " + String(error));
      try { sessions.open(childSessionId); } catch { /* nothing else to do */ }
    });
  }

  // ── Shared helpers for the page ─────────────────────────────────────────────
  let chevronIcon = undefined;

  /**
   * The collapse control's glyph: the platform's own `IconChevronDownOutline14`, the
   * exact component the adopted panel renders, reached through the same client
   * externals module the adopted bundle (and DSH-better-sidebar itself) requires. If
   * that module cannot be resolved, the identical 14×14 path is rendered inline, so the
   * control is never glyph-less.
   */
  function ChevronDown14(props) {
    if (chevronIcon === undefined) {
      try {
        const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
        chevronIcon = primitives && primitives.IconChevronDownOutline14 ? primitives.IconChevronDownOutline14 : null;
      } catch {
        chevronIcon = null;
      }
    }
    if (chevronIcon !== null) return react.createElement(chevronIcon, props || {});
    return react.createElement("svg", {
      width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg",
    }, react.createElement("path", { d: CHEVRON_DOWN_14_PATH, fill: "currentColor" }));
  }

  /**
   * Close the sidebar panel — the sidebar's equivalent of the floater's "collapse
   * activity panel" button, since the tab is only visible while the panel is open.
   * Guarded so a store-less render (offline harness) still produces the same markup.
   */
  function collapsePanel(store) {
    try {
      if (store !== undefined && store !== null && typeof store.reduce === "function") {
        // The same next-state shape DSH-better-sidebar's own togglePanel computes.
        store.reduce((state) => ({ ...state, panelOpen: false }));
      }
    } catch (error) {
      console.warn("[mpd] AgentTeams collapse failed: " + String(error));
    }
  }

  // ── The page ────────────────────────────────────────────────────────────────
  // Everything the adopted floater's own `.panel` rule declares, minus the window
  // manager: the sidebar pane owns the box, so position/size are pinned to it, the
  // drag/resize affordances are gone (no handles are rendered and `data-compact`
  // selects the head's non-draggable cursor), and the floating frame —
  // border/radius/shadow/backdrop blur — is dropped because the pane is already a
  // framed surface. The class still has to stay on the root: it is what scopes the
  // adopted `--dsw-alias-*` custom properties for the whole subtree.
  const PANE_STYLE = {
    position: "relative", top: "auto", left: "auto",
    width: "100%", height: "100%", minHeight: 0, maxHeight: "none",
    flex: "1 1 auto",
    transform: "none", willChange: "auto", animation: "none",
    border: "none", borderRadius: 0, background: "transparent",
    boxShadow: "none", backdropFilter: "none", WebkitBackdropFilter: "none",
  };
  const UNAVAILABLE_STYLE = {
    padding: 10, fontSize: 12, lineHeight: 1.5, color: "rgba(128,128,128,0.95)",
    fontFamily: "system-ui, sans-serif", boxSizing: "border-box",
  };
  // The banner and the activity record reuse the panel's own class names where the adopted
  // CSS has one, and carry their own inline look otherwise: the stack is a
  // better-sidebar tab, so nothing here may depend on a floater frame.
  const WATCHDOG_BANNER_STYLE = {
    display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px",
    borderBottom: "1px solid rgba(220,120,60,0.45)", background: "rgba(220,120,60,0.14)",
    fontSize: 12, lineHeight: 1.45, fontFamily: "system-ui, sans-serif", color: "inherit",
  };
  const WATCHDOG_RECORD_STYLE = {
    display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px",
    borderLeft: "3px solid rgba(220,120,60,0.7)", background: "rgba(220,120,60,0.07)",
    fontSize: 12, lineHeight: 1.4, fontFamily: "system-ui, sans-serif", color: "inherit",
  };
  const WATCHDOG_BUTTON_STYLE = {
    alignSelf: "flex-start", marginTop: 2, padding: "2px 8px", fontSize: 12, cursor: "pointer",
    border: "1px solid rgba(220,120,60,0.6)", borderRadius: 4, background: "transparent", color: "inherit",
  };

  /** `12:34:56` in the reader's own zone; the raw epoch stays on the element's data attribute. */
  function clockOf(at) {
    try {
      return new Date(at).toLocaleTimeString();
    } catch {
      return String(at);
    }
  }

  /** The stuck-team banner's inputs: the payload's banner plus the reader's ack outcome. */
  function watchdogBannerModel(watchdog) {
    const payload = watchdog && watchdog.payload;
    if (payload === null || payload === undefined || payload.banner === null || payload.banner === undefined) return null;
    return {
      banner: payload.banner,
      reader: payload.reader,
      replay: payload.replay === true,
      unread: Array.isArray(payload.unread) ? payload.unread.length : 0,
    };
  }

  /**
   * The AgentTeams sidebar page: the adopted panel's interior, in the conversation the
   * tab belongs to. Live teams first, then the server-side archive, then — exactly like
   * the floater — the panel's own empty hint.
   */
  function TeamPageView(props) {
    const ctx = props.ctx;
    const scope = props.scope || {};
    const t = translatorFor(ctx);
    const state = react.useSyncExternalStore(subscribeStore, getStoreSnapshot);
    const sessionId = scope.sessionId;

    react.useEffect(() => { ensurePolling(sessionId); }, [sessionId]);

    // A hidden tab keeps no live view (the sidebar CSS-hides collapsed tabs rather than
    // unmounting them); the badge still reads the cached store.
    if (props.visible === false) return null;
    if (adopted.TeamSection === undefined || adopted.ACTIVITY_PANEL_CSS === undefined) {
      return react.createElement("div", { style: UNAVAILABLE_STYLE, "data-agent-teams-unavailable": true },
        t("page.unavailable", { reason: "adopted views missing" }));
    }

    const css = adopted.ACTIVITY_PANEL_CSS;
    const live = state.teams.filter((team) => team.captainSessionId === sessionId);
    const archived = state.archivedTeams.filter((team) =>
      team.captainSessionId === sessionId && !live.some((candidate) => candidate.teamId === team.teamId));
    const busy = live.some((team) => Array.isArray(team.members)
      && team.members.some((member) => member.activity === "working"));

    // ── Stuck-team surface ───────────────────────────────────────────────────
    // Both pieces are driven by the payload the route returned (never by a local flag):
    // the BANNER is the first child of the panel root, and ONE activity record per
    // unacknowledged incident heads the body. An acknowledge POSTs the record's own
    // timestamp and then re-polls, so the record disappears because the reader's unread
    // set is empty server-side — the honest fallback stays visible until then
    // (t("watchdog.unacknowledged")).
    const watchdog = state.watchdog || { payload: null, error: undefined };
    const watchdogPayload = watchdog.payload;
    const bannerModel = watchdogBannerModel(watchdog);
    const activity = watchdogPayload !== null && watchdogPayload !== undefined && Array.isArray(watchdogPayload.activity)
      ? watchdogPayload.activity
      : [];

    const recordElements = activity.map((record) => react.createElement("div", {
      key: "watchdog-record:" + String(record.id),
      style: WATCHDOG_RECORD_STYLE,
      "data-watchdog-activity": String(record.id),
      "data-watchdog-team": String(record.teamId),
      "data-watchdog-kind": String(record.kind),
      "data-watchdog-cause": String(record.cause),
      "data-watchdog-at": String(record.at),
      "data-watchdog-ack-required": record.ackRequired === true ? "1" : "0",
    },
      react.createElement("span", { style: { fontWeight: 600 } },
        t("watchdog.record.title") + " — " + t(record.kind === "escalate" ? "watchdog.record.escalate"
          : record.kind === "hold" ? "watchdog.record.hold" : "watchdog.record.warn")),
      react.createElement("span", null, t("watchdog.record.meta", { teamId: record.teamId, cause: record.cause })),
      react.createElement("span", { style: { opacity: 0.75 } },
        clockOf(record.at) + " · " + t("watchdog.unacknowledged")),
    ));

    const bannerElement = bannerModel === null ? null : react.createElement("div", {
      style: WATCHDOG_BANNER_STYLE,
      "data-watchdog-banner": bannerModel.banner.incidentId === null ? "hold" : "incident",
      "data-watchdog-stuck": "1",
      "data-watchdog-team": String(bannerModel.banner.teamId),
      "data-watchdog-kind": String(bannerModel.banner.kind),
      "data-watchdog-cause": String(bannerModel.banner.cause),
      "data-watchdog-hold": String(bannerModel.banner.holdId === null ? "" : bannerModel.banner.holdId),
      "data-watchdog-incident": String(bannerModel.banner.incidentId === null ? "" : bannerModel.banner.incidentId),
      "data-watchdog-reader": String(bannerModel.reader),
      "data-watchdog-replay": bannerModel.replay === true ? "1" : "0",
      "data-watchdog-unread": String(bannerModel.unread),
      role: "status",
    },
      react.createElement("span", { style: { fontWeight: 600 } },
        t(bannerModel.banner.kind === "warned" ? "watchdog.banner.warned" : "watchdog.banner.held",
          { teamId: bannerModel.banner.teamId, cause: bannerModel.banner.cause })),
      react.createElement("span", null, t("watchdog.banner.detail", {
        taskId: bannerModel.banner.taskId === null ? "—" : bannerModel.banner.taskId,
        attemptId: bannerModel.banner.attemptId === null ? "—" : bannerModel.banner.attemptId,
        since: clockOf(bannerModel.banner.since),
      })),
      watchdog.ackError !== undefined
        ? react.createElement("span", { "data-watchdog-ack-error": true },
          t("watchdog.banner.error", { message: watchdog.ackError }))
        : null,
      react.createElement("button", {
        type: "button",
        style: WATCHDOG_BUTTON_STYLE,
        "data-watchdog-ack": "1",
        onClick: () => { void acknowledgeIncident(bannerModel.banner.since); },
      }, t("watchdog.banner.ack")),
    );

    const body = [];
    if (state.error !== undefined) {
      // A failure mode the floater could not represent either (it simply had no teams):
      // the notice keeps the original body shape and styling.
      body.push(react.createElement("span", { key: "error", className: css.emptyHint, "data-agent-teams-error": true },
        t("page.error", { message: state.error })));
    } else if (live.length === 0 && archived.length === 0) {
      body.push(react.createElement("span", { key: "empty", className: css.emptyHint, "data-agent-teams-empty": true },
        t("activity.empty")));
    } else {
      for (const team of live) {
        body.push(react.createElement(adopted.TeamSection, {
          key: team.teamId,
          team,
          modelDirectory: directoryForTeam(team),
          onContinuePlanning: focusComposer,
          onDiscarded: focusComposer,
          onNavigate: (parentId, childId) => { openMember(ctx, parentId, childId); },
          t,
        }));
      }
      for (const team of archived) {
        // Historic conversation cards are INTENTIONALLY not rendered: the adopted panel's
        // historic-card branch was fed by the removed in-conversation card's
        // conversationEvents registry, which this harness does not provide, so no historic
        // card can exist any more (the bridge still exports historicCardTeam for parity).
        // Ended teams reach this page through the server-side archive below instead.
        //
        // `archivedWrap` is absent from the adopted class map although the adopted panel
        // reads it too, so the original renders a CLASS-LESS wrapper div — performing the
        // same lookup is what keeps this markup identical, and an upstream fix flows through
        // by itself (pinned by packages/mpd-agent-teams-plugin/test/export-bridge.test.mjs).
        body.push(react.createElement("div", {
          key: team.captainSessionId + ":" + team.teamId,
          className: css.archivedWrap,
          "data-team-id": team.teamId,
          "data-historic": true,
        },
          react.createElement("span", { className: css.archiveLabel },
            t(team.phase === "staged" ? "archive.discardedLabel" : "archive.label")),
          react.createElement(adopted.TeamSection, {
            team,
            onNavigate: (parentId, childId) => { openMember(ctx, parentId, childId); },
            t,
            historic: true,
          }),
        ));
      }
    }

    // The activity record heads the body (it is the same incident the banner announces),
    // so a stuck team is visible even when the conversation currently lists no teams.
    if (recordElements.length > 0) body.unshift(...recordElements);

    return react.createElement("aside", {
      className: css.panel,
      style: PANE_STYLE,
      "data-agent-teams-page": true,
      "data-agent-teams-activity": true,
      "data-team-count": String(live.length),
      // The stuck-team state as the panel itself sees it: asserted by the offline driver
      // from the RENDERED tree (a string in the source is not evidence).
      "data-watchdog-stuck": bannerModel === null ? "0" : "1",
      "data-watchdog-reader": WATCHDOG_WEB_READER,
      "data-watchdog-replay": bannerModel !== null && bannerModel.replay === true ? "1" : "0",
      // The floater's head is a drag handle; here it must not advertise a drag.
      "data-compact": true,
      "aria-label": t("activity.panelAria"),
    },
      // TOP of the panel, before the head: the banner is the first child by construction,
      // and when there is nothing stuck the children shape is EXACTLY the pre-banner one
      // (`aside > [head, teams body]`), so the page's visual parity is untouched.
      ...(bannerElement === null ? [] : [bannerElement]),
      react.createElement("header", { className: css.panelHead },
        react.createElement("span", { className: css.panelTitle },
          t("activity.title"),
          react.createElement("span", { className: css.panelDot, "data-busy": busy, "aria-hidden": true }),
        ),
        react.createElement("span", { className: css.panelControls },
          react.createElement("button", {
            type: "button",
            className: css.iconButton,
            "data-control": "collapse",
            onClick: () => { collapsePanel(props.store); },
            "aria-label": t("activity.collapse"),
            title: t("activity.collapse"),
          }, react.createElement(ChevronDown14, {})),
        ),
      ),
      react.createElement("div", { className: css.teams }, body),
    );
  }

  // ── Sidebar contribution ────────────────────────────────────────────────────
  /** Resolve a client service without ever declaring it (a pending entry kills the page). */
  function probe(ctx, name) {
    let viaGet;
    try {
      viaGet = ctx && typeof ctx.get === "function" ? ctx.get(name) : undefined;
    } catch {
      viaGet = undefined;
    }
    if (viaGet !== undefined) return viaGet;
    try {
      return ctx ? ctx[name] : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Register the single AgentTeams sidebar tab against an ALREADY-RESOLVED sidebar
   * service. The service is a parameter, never a probe: DSH-better-sidebar is provided by
   * another plugin whose fiber activates later than ours, so a `ctx.get` probe here answers
   * undefined (measured live) and the tab would never register. The caller resolves it
   * through `ctx.inject(['betterSidebar'], …)` — see mountSidebarPages in src/web-client.js.
   */
  function registerTeamSidebarTab(ctx, service) {
    try {
      if (service === undefined || service === null || typeof service.registerTab !== "function") {
        console.warn("[mpd] better-sidebar exposes no registerTab — the AgentTeams page has no host (no floating fallback by design)");
        return false;
      }
      autoOpenPolicyService = service;
      const t = translatorFor(ctx);
      ctx.effect(() => ctx.locale.register(TEAM_LOCALE_NAMESPACE, { zh, en }), "mpd-agent-teams: dictionaries");
      ctx.effect(() => service.registerTab({
        id: TEAM_TAB_ID,
        title: () => "AgentTeams",
        icon: (size) => react.createElement("span", {
          "aria-hidden": true,
          style: { fontSize: size, lineHeight: 1 },
        }, "\u{1F433}"),
        order: TEAM_TAB_ORDER,
        single: true,
        // Mint the tab ourselves so the auto-open content seed never lands on it.
        createTab: () => ({ tab: { id: TEAM_TAB_ID, type: TEAM_TAB_ID, title: "AgentTeams" } }),
        // Called on every tab-bar render, including while the panel is collapsed:
        // a cached count only — no fetch, no throw.
        badge: (_ctx, scope) => {
          try {
            const count = liveTeamCount(scope ? scope.sessionId : undefined);
            return count > 0 ? count : undefined;
          } catch {
            return undefined;
          }
        },
        settings: {
          pluginToggles: [{
            key: AUTO_OPEN_KEY,
            title: () => t("settings.autoOpen.title"),
            desc: () => t("settings.autoOpen.desc"),
            type: "switch",
          }],
        },
        component: (props) => react.createElement(TeamPageView, props),
      }), "mpd-agent-teams: sidebar tab");
      const pollCurrentSession = () => {
        try {
          const sessions = probe(ctx, "sessions");
          const current = sessions && sessions.list ? sessions.list.getSnapshot().current : undefined;
          ensurePolling(current);
        } catch { /* no sessions service: the page starts polling on mount instead */ }
      };
      ctx.effect(() => {
        pollCurrentSession();
        const sessions = probe(ctx, "sessions");
        if (sessions === undefined || sessions.list === undefined || typeof sessions.list.subscribe !== "function") {
          return () => { stopPolling(); };
        }
        const unsubscribe = sessions.list.subscribe(() => {
          pollCurrentSession();
          maybeAutoOpen();
        });
        return () => {
          unsubscribe();
          stopPolling();
        };
      }, "mpd-agent-teams: activity polling");
      // The model directory is provided by ANOTHER plugin's fiber: resolve it with the dynamic
      // `ctx.inject` form (which waits for the provider and never parks this entry) and cache it
      // for `directoryForTeam`. A bare `ctx.get` probe here answers undefined forever.
      // `remote.session` belongs in the list for the same measured reason as the settings card:
      // cordis services are CALLER-scoped, so the resolver's own read of `this.ctx.remote.session`
      // inside `directoryFor()` is rejected unless the CALLER declared that dotted seam — the
      // picker then silently fell back to its declared list. Dynamic only (never declared): a
      // declared-but-unregistered service parks the whole page.
      ctx.effect(() => {
        let catalogFiber;
        try {
          catalogFiber = ctx.inject(["modelDirectories", "remote.session"], (catalogCtx) => {
            modelDirectoryService = probe(catalogCtx, "modelDirectories");
          });
        } catch (error) {
          console.warn("[mpd] AgentTeams: the model directory could not be injected: " + String(error));
        }
        return () => {
          modelDirectoryService = undefined;
          try {
            if (catalogFiber !== undefined && catalogFiber !== null && typeof catalogFiber.dispose === "function") catalogFiber.dispose();
          } catch { /* the fiber may already be gone */ }
        };
      }, "mpd-agent-teams: model directory injection");
      ctx.effect(() => {
        const unsubscribe = subscribeStore(() => { maybeAutoOpen(); });
        return unsubscribe;
      }, "mpd-agent-teams: auto-open watcher");
      return true;
    } catch (error) {
      console.warn("[mpd] AgentTeams sidebar tab registration failed: " + String(error));
      return false;
    }
  }

  exports.registerTeamSidebarTab = registerTeamSidebarTab;
  exports.TeamPageView = TeamPageView;
  exports.SIDEBAR_TAB_ID = TEAM_TAB_ID;
  exports.SIDEBAR_TAB_ORDER = TEAM_TAB_ORDER;
  // Test seams: the offline harness pins the auto-open policy and the single-controller
  // rule against these instead of reaching into module internals.
  exports.__resetTeamPageForTests = () => {
    if (autoOpenTimer !== null) {
      try { clearTimeout(autoOpenTimer); } catch { /* ignore */ }
    }
    stopPolling();
    stopWatchdogPolling();
    watchdogInFlight = false;
    store = { teams: [], archivedTeams: [], error: undefined, sessionId: undefined, watchdog: { payload: null, error: undefined } };
    autoOpenArmed = false;
    autoOpenTimer = null;
    autoOpenSeen.clear();
    autoOpenFired.clear();
    autoOpenPolicyService = undefined;
    modelDirectoryService = undefined;
    chevronIcon = undefined;
  };
  exports.__armAutoOpen = armAutoOpen;
  exports.__maybeAutoOpen = maybeAutoOpen;
  // Stuck-team test seams: the offline driver polls and acknowledges through these
  // instead of reaching into module internals.
  exports.__watchdogState = () => store.watchdog;
  exports.__watchdogPoll = () => refreshWatchdog();
  exports.__watchdogAck = (incidentTs) => acknowledgeIncident(incidentTs);
  exports.WATCHDOG_STATE_URL = WATCHDOG_STATE_URL;
  exports.WATCHDOG_ACK_URL = WATCHDOG_ACK_URL;
  exports.WATCHDOG_WEB_READER = WATCHDOG_WEB_READER;
  return module.exports;
}
