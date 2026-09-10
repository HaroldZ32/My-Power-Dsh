// mpd bundle web client (factory body, inlined into the combined client.js by
// scripts/build-mpd-client.mjs). Loaded as the client half of the @mpd-dsh/mpd
// bundle entry: mounts the adopted agent-teams activity panel + team card (via
// require of the embedded @nanmicoder/dsh-agent-teams factory) and adds the
// WORKMATE LIBRARY floater + sidebar toggle. Plain JS, React.createElement only.
(require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  let react = require("react");
  const agentTeams = require("@nanmicoder/dsh-agent-teams");

  // ── Version-tolerant client seams ──────────────────────────────────────────
  // The web boot hard-fails the WHOLE page when one entry stays `pending`:
  // `assertEntriesActive` reports `entry: pending (waiting for service: X)` and
  // throws "Failed to load plugins". A service that this harness release does not
  // mount must therefore never sit in `inject` — it would take the GUI down even
  // though the surface it feeds is optional. The candidate set is intersected with
  // the services that are actually registered at apply time, and each optional
  // mount point also degrades on its own.
  //
  // Observed drift (dsh 0.1.2-rc.1): the frontend exposes `slots`, `locale`,
  // `sessions`, `layout`, `theme`, `timer`, `uiWorkspace`, `workspaces`; it does NOT
  // expose `conversationEvents` (the adopted panel's rc.9 seam, where the harness
  // now speaks `conversationViews`) and does NOT mount `modelDirectories`.
  const REQUIRED_SERVICES = ["slots", "locale"];
  const OPTIONAL_SERVICES = ["sessions", "conversationEvents", "modelDirectories"];
  // Services we consume opportunistically: never declared (a missing provider would
  // make the entry `pending` and fail the whole page), always probed with ctx.get.
  const PROBED_SERVICES = ["betterSidebar"];

  /** Whether a client service is resolvable now (never throws, never activates). */
  function serviceAvailable(ctx, name) {
    try {
      return ctx.get(name) !== undefined;
    } catch {
      return false;
    }
  }

  /** The optional seams this runtime actually provides, in candidate order. */
  function presentOptional(ctx) {
    return OPTIONAL_SERVICES.filter((name) => serviceAvailable(ctx, name));
  }

  /**
  * Declared hard dependencies only. The web boot's `assertEntriesActive` turns any
  * declared-but-unregistered service into a fatal `pending` entry, so an optional
  * seam must be awaited with `ctx.inject` instead of being declared here.
  */
  const inject = REQUIRED_SERVICES.slice();

  /**
  * Mount the adopted agent-teams panel once every seam it needs is live, and mount
  * nothing (with one warning) when this harness never provides them. Every failure
  * is contained: an optional surface must never take the boot down.
  */
  function mountAgentTeams(ctx) {
    const present = presentOptional(ctx);
    const missing = OPTIONAL_SERVICES.filter((name) => !present.includes(name));
    if (missing.length > 0) {
      console.warn("[mpd] agent-teams panel unavailable — harness does not provide: " + missing.join(", "));
      return;
    }
    try {
      agentTeams.apply(ctx);
    } catch (error) {
      console.warn("[mpd] agent-teams panel failed to mount: " + String(error));
    }
  }

  const LIST_URL = "/plugins/mpd-workmate/list";
  const INIT_URL = "/plugins/mpd-workmate/init";
  const ROSTER_URL = "/plugins/mpd-workmate/roster";
  const GET_URL = "/plugins/mpd-workmate/get";
  const TOGGLE_EVENT = "mpd:workmate:toggle";
  const WORKMATE_LOCALE_NAMESPACE = "mpdWorkmate";
  // The DSH-better-sidebar tab type this bundle registers. It is the primary GUI
  // surface for the workmate library: the sidebar owns layout/opening, we only
  // contribute the page.
  const SIDEBAR_TAB_ID = "mpd-workmate";
  // Tab-strip label. The sidebar renders outside our React tree, so the title is a
  // plain string resolved at registration time; the sidebar's own i18n already names
  // every tab in the same place.
  const SIDEBAR_TAB_TITLE = "Workmates";

  // Dictionary namespace for the workmate panel + sidebar toggle. zh is the
  // key-set source of truth; en is checked complete against it.
  const zh = {
    "tab.title": "Workmates",
    "panel.title": "Workmate 库（~/.mpd/workmate）",
    "panel.badgeAria": "打开 Workmate 库",
    "panel.close": "关闭",
    "panel.refresh": "刷新",
    "panel.loading": "加载中…",
    "panel.empty": "暂无 workmate — 请在下方初始化一个。",
    "panel.baseLabel": "Base（专家模板）",
    "panel.basePlaceholder": "base（例如 hephaestus）",
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
    "panel.rosterUnavailable": "roster 不可用，请手填 base id",
    "toggle.aria": "Workmate 库",
    "toggle.label": "Workmates"
  };
  const en = {
    "tab.title": "Workmates",
    "panel.title": "Workmate library (~/.mpd/workmate)",
    "panel.badgeAria": "Open Workmate library",
    "panel.close": "Close",
    "panel.refresh": "Refresh",
    "panel.loading": "Loading…",
    "panel.empty": "No workmates yet — initialize one below.",
    "panel.baseLabel": "Base (roster template)",
    "panel.basePlaceholder": "base (e.g. hephaestus)",
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
    "panel.rosterUnavailable": "roster unavailable — type the base id",
    "toggle.aria": "Workmate library",
    "toggle.label": "Workmates"
  };

  // Shared open state (single source of truth) between the overlay floater and
  // the sidebar-foot toggle, which render in different slot trees.
  let workmateOpen = false;

  function interpolate(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (_m, key) =>
      params && params[key] !== undefined ? String(params[key]) : "{" + key + "}");
  }
  function translateFor(props) {
    if (props && typeof props.t === "function") return props.t;
    return (key, params) => interpolate(en[key] ?? key, params);
  }

  function request(url, options) {
    return fetch(url, options).then(async (res) => {
      if (!res.ok) {
        let message = "HTTP " + res.status;
        try {
          const body = await res.json();
          if (body && typeof body.error === "string" && body.error.trim() !== "") message = body.error;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    });
  }

  // ── Workmate library: one view, two hosts ──────────────────────────────────
  // The library is contributed as a DSH-better-sidebar tab (the primary surface:
  // the sidebar owns layout, opening and enable/disable) and, when that sidebar is
  // absent, as the bundle's own floating overlay. Both render the same view.
  const SURFACE_STYLE = {
    display: "flex", flexDirection: "column", gap: 8, minHeight: 0, height: "100%",
    padding: 10, fontSize: 13, color: "inherit", fontFamily: "system-ui, sans-serif", boxSizing: "border-box",
  };
  const MUTED = { color: "rgba(128,128,128,0.95)" };
  const BUTTON_STYLE = { cursor: "pointer", border: "1px solid rgba(128,128,128,0.35)", borderRadius: 6, background: "transparent", color: "inherit", padding: "3px 8px", fontSize: 12 };
  const INPUT_STYLE = { padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.35)", background: "transparent", color: "inherit", fontSize: 12, width: "100%", boxSizing: "border-box" };

  /** The library page: list + detail + initialize form. Host-agnostic. */
  function WorkmateLibraryView(props) {
    const t = translateFor(props);
    const [workmates, setWorkmates] = react.useState(null);
    const [bases, setBases] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [filter, setFilter] = react.useState("");
    const [base, setBase] = react.useState("");
    const [name, setName] = react.useState("");
    const [note, setNote] = react.useState("");
    const [busy, setBusy] = react.useState(false);
    const [selected, setSelected] = react.useState(null);
    const [detail, setDetail] = react.useState(null);

    const refresh = react.useCallback(() => {
      request(LIST_URL)
        .then((data) => { setWorkmates(data.workmates ?? []); setError(null); })
        .catch((e) => { setError(String(e?.message ?? e)); setWorkmates([]); });
      request(ROSTER_URL)
        .then((data) => { setBases(data.bases ?? []); setBase((prev) => prev || String((data.bases ?? [])[0]?.id ?? "")); })
        .catch(() => setBases([]));
    }, []);
    react.useEffect(() => { refresh(); }, [refresh]);

    const openDetail = (workmateName) => {
      setSelected(workmateName);
      setDetail(null);
      request(GET_URL + "?name=" + encodeURIComponent(workmateName))
        .then((data) => setDetail(data))
        .catch((e) => setError(String(e?.message ?? e)));
    };
    const submit = (ev) => {
      ev.preventDefault();
      const chosen = base.trim();
      if (busy || chosen === "") return;
      setBusy(true);
      const body = JSON.stringify({ base: chosen, name: name.trim() || undefined, note: note.trim() || undefined });
      request(INIT_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        .then(() => { setBusy(false); setName(""); setNote(""); refresh(); })
        .catch((e) => { setBusy(false); setError(String(e?.message ?? e)); });
    };

    const needle = filter.trim().toLowerCase();
    const rows = (workmates ?? []).filter((w) => needle === ""
      || String(w.name).toLowerCase().includes(needle)
      || String(w.note ?? "").toLowerCase().includes(needle)
      || String(w.baseName ?? "").toLowerCase().includes(needle));

    if (selected !== null) {
      const d = detail;
      const section = (title, body) => body === undefined || body === null || String(body).trim() === "" ? null
        : react.createElement("div", { style: { marginTop: 8 } },
            react.createElement("div", { style: { fontWeight: 600, marginBottom: 2 } }, title),
            react.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "inherit", ...MUTED } }, String(body)),
          );
      return react.createElement("div", { style: SURFACE_STYLE },
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          react.createElement("button", { type: "button", onClick: () => { setSelected(null); setDetail(null); }, style: BUTTON_STYLE }, "← " + t("panel.back")),
          react.createElement("span", { style: { fontWeight: 700 } }, selected),
        ),
        error ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12 } }, String(error)) : null,
        d === null ? react.createElement("div", { style: MUTED }, t("panel.loading")) : react.createElement("div", { style: { overflowY: "auto" } },
          react.createElement("div", { style: MUTED },
            String(d.baseName ?? d.baseId ?? ""),
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
      react.createElement("input", {
        value: filter, onChange: (e) => setFilter(e.target.value), placeholder: t("panel.filter"),
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
            ? react.createElement("select", { value: base, onChange: (e) => setBase(e.target.value), style: INPUT_STYLE, "aria-label": t("panel.baseLabel") },
                (bases ?? []).map((b) => react.createElement("option", { key: b.id, value: b.id }, b.name + " (" + b.id + ")" + (b.readonly ? " · " + t("panel.readonly") : ""))))
            : react.createElement("input", { placeholder: t("panel.basePlaceholder"), value: base, onChange: (e) => setBase(e.target.value), style: INPUT_STYLE }),
        ),
        bases !== null && (bases ?? []).length === 0 ? react.createElement("div", { style: { ...MUTED, fontSize: 11 } }, t("panel.rosterUnavailable")) : null,
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.nameLabel")),
          react.createElement("input", { placeholder: t("panel.namePlaceholder"), value: name, onChange: (e) => setName(e.target.value), style: INPUT_STYLE }),
        ),
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.noteLabel")),
          react.createElement("input", { placeholder: t("panel.notePlaceholder"), value: note, onChange: (e) => setNote(e.target.value), style: INPUT_STYLE }),
        ),
        react.createElement("button", { type: "submit", disabled: busy || base.trim() === "", style: { ...BUTTON_STYLE, opacity: busy || base.trim() === "" ? 0.5 : 1 } }, busy ? t("panel.initBusy") : t("panel.init")),
      ),
    );
  }

  /**
  * Register the library as a DSH-better-sidebar tab. The sidebar publishes
  * `ctx.betterSidebar` with `registerTab(descriptor)`; the descriptor owns the tab
  * type, its + menu entry and its page component. Absent sidebar → not our problem
  * (the floater below still mounts).
  */
  function registerSidebarTab(ctx) {
    const sidebar = serviceAvailable(ctx, "betterSidebar")
      ? ctx.get("betterSidebar")
      : (() => { try { return ctx.betterSidebar; } catch { return undefined; } })();
    if (sidebar === undefined || typeof sidebar.registerTab !== "function") {
      console.warn("[mpd] better-sidebar not installed — keeping the workmate floater");
      return false;
    }
    try {
      ctx.effect(() => sidebar.registerTab({
        id: SIDEBAR_TAB_ID,
        title: () => SIDEBAR_TAB_TITLE,
        icon: (size) => react.createElement("span", { "aria-hidden": true, style: { fontSize: size, lineHeight: 1 } }, "\u{1F916}"),
        order: 90,
        single: true,
        component: (props) => react.createElement(WorkmateLibraryView, { t: translateFor({ t: props && props.t }) }),
      }), "mpd-workmate: sidebar tab");
      return true;
    } catch (error) {
      console.warn("[mpd] workmate sidebar tab registration failed: " + String(error));
      return false;
    }
  }

  /** The bundle's own floating overlay, used only when the sidebar is absent. */
  function WorkmatePanel(props) {
    const t = translateFor(props);
    const [open, setOpen] = react.useState(false);
    react.useEffect(() => {
      const onToggle = (event) => {
        const detail = event && event.detail;
        const next = detail && typeof detail.open === "boolean" ? detail.open : !workmateOpen;
        workmateOpen = next;
        setOpen(next);
      };
      window.addEventListener(TOGGLE_EVENT, onToggle);
      return () => window.removeEventListener(TOGGLE_EVENT, onToggle);
    }, []);
    if (!open) {
      return react.createElement("button", {
        type: "button",
        onClick: () => { workmateOpen = true; setOpen(true); },
        "aria-label": t("panel.badgeAria"),
        title: t("panel.badgeAria"),
        style: { position: "absolute", top: 12, right: 12, zIndex: 20, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(128,128,128,0.35)", borderRadius: 18, background: "var(--color-bg-1, #fff)", color: "var(--color-text-1, #222)", cursor: "pointer", fontSize: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontFamily: "system-ui, sans-serif" }
      }, "\u{1F916}");
    }
    return react.createElement("div", {
      role: "dialog",
      "aria-modal": "false",
      "aria-label": t("panel.title"),
      style: { position: "absolute", top: 12, right: 12, zIndex: 20, width: 420, maxWidth: "90vw", maxHeight: "80vh", display: "flex", borderRadius: 10, background: "var(--color-bg-1, #fff)", color: "var(--color-text-1, #222)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "system-ui, sans-serif" }
    },
      react.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" } },
        react.createElement(WorkmateLibraryView, { t }),
      ),
      react.createElement("button", {
        type: "button",
        onClick: () => { workmateOpen = false; setOpen(false); },
        "aria-label": t("panel.close"), title: t("panel.close"),
        style: { position: "absolute", top: 6, right: 8, border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "inherit" },
      }, "\u2715"),
    );
  }

  function WorkmateToggle(props) {
    const t = translateFor(props);
    const wide = props && props.wide !== false;
    return react.createElement("button", {
      type: "button",
      style: { background: "none", border: "none", cursor: "pointer", color: "inherit", display: "flex", alignItems: "center", gap: 6, padding: "4px 6px" },
      title: t("toggle.aria"),
      "aria-label": t("toggle.aria"),
      onClick: () => {
        const next = !workmateOpen;
        window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { open: next } }));
      },
    },
      react.createElement("span", { "aria-hidden": true, style: { fontSize: 16 } }, "\u{1F916}"),
      wide ? react.createElement("span", null, t("toggle.label")) : null,
    );
  }

  function apply(ctx) {
    // Adopted agent-teams client half (team activity floater + team card + command
    // view). It is the only part of this client with version-drifted seams, so it
    // waits for them instead of being a declared hard dependency: `ctx.inject`
    // re-runs when the services appear and simply never runs when they do not.
    ctx.inject(OPTIONAL_SERVICES, (scoped) => mountAgentTeams(scoped));
    // Register the workmate panel locale dictionaries (zh/en), mirroring the
    // agent-teams client locale registration.
    ctx.effect(() => ctx.locale.register(WORKMATE_LOCALE_NAMESPACE, { zh, en }), "mpd-workmate: dictionaries");
    // PRIMARY SURFACE — a DSH-better-sidebar tab, so the library lives where the
    // sidebar's own pages do (tab strip, + menu, enable/disable in its settings).
    const onSidebar = registerSidebarTab(ctx);
    if (onSidebar) return;
    // FALLBACK — no DSH-better-sidebar in this profile: keep the bundle's own
    // frame-wide floater + sidebar-foot toggle (additive slots, no shipped-ui
    // replacement). Both hosts render the same WorkmateLibraryView.
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: "mpd-workmate-library",
      order: 90,
      label: "Workmate library",
      locale: WORKMATE_LOCALE_NAMESPACE,
    }, (props) => react.createElement(WorkmatePanel, props)));
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
      name: "sidebar.footer.action",
      id: "mpd-workmate-toggle",
      order: 90,
      label: "Workmates",
      locale: WORKMATE_LOCALE_NAMESPACE,
    }, (props) => react.createElement(WorkmateToggle, props)));
  }

  // `inject`/`apply` are the client-module contract; the extra views are exported so
  // the offline harness (packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs) can
  // render the real page component without a browser.
  module.exports = { inject, apply, WorkmateLibraryView, WorkmatePanel, WorkmateToggle, SIDEBAR_TAB_ID };
  return module.exports;
}
