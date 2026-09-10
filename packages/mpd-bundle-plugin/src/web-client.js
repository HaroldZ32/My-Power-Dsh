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
  const TOGGLE_EVENT = "mpd:workmate:toggle";
  const WORKMATE_LOCALE_NAMESPACE = "mpdWorkmate";

  // Dictionary namespace for the workmate panel + sidebar toggle. zh is the
  // key-set source of truth; en is checked complete against it.
  const zh = {
    "panel.title": "Workmate 库（~/.mpd/workmate）",
    "panel.badgeAria": "打开 Workmate 库",
    "panel.close": "关闭",
    "panel.refresh": "刷新",
    "panel.loading": "加载中…",
    "panel.empty": "暂无 workmate — 请在下方初始化一个。",
    "panel.baseLabel": "Base（基础模板）",
    "panel.basePlaceholder": "base（例如 hephaestus）",
    "panel.nameLabel": "名称（可选）",
    "panel.namePlaceholder": "名称（可选）",
    "panel.init": "初始化",
    "panel.initBusy": "…",
    "panel.readonly": "只读",
    "panel.uses": "uses={count}",
    "toggle.aria": "Workmate 库",
    "toggle.label": "Workmates"
  };
  const en = {
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
    "panel.init": "Init",
    "panel.initBusy": "…",
    "panel.readonly": "readonly",
    "panel.uses": "uses={count}",
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

  function WorkmatePanel(props) {
    const t = translateFor(props);
    const [open, setOpen] = react.useState(false);
    const [workmates, setWorkmates] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [base, setBase] = react.useState("");
    const [name, setName] = react.useState("");
    const [busy, setBusy] = react.useState(false);
    const refresh = react.useCallback(() => {
      request(LIST_URL)
        .then((data) => { setWorkmates(data.workmates ?? []); setError(null); })
        .catch((e) => { setError(String(e?.message ?? e)); setWorkmates([]); });
    }, []);
    react.useEffect(() => {
      refresh();
      const onToggle = (event) => {
        const detail = event && event.detail;
        const next = detail && typeof detail.open === "boolean" ? detail.open : !workmateOpen;
        workmateOpen = next;
        setOpen(next);
        if (next) refresh();
      };
      window.addEventListener(TOGGLE_EVENT, onToggle);
      return () => window.removeEventListener(TOGGLE_EVENT, onToggle);
    }, [refresh]);
    const openPanel = () => { workmateOpen = true; setOpen(true); refresh(); };
    const closePanel = () => { workmateOpen = false; setOpen(false); };
    const submit = (ev) => {
      ev.preventDefault();
      if (busy) return;
      setBusy(true);
      const body = JSON.stringify({ base: base.trim(), name: name.trim() || undefined });
      request(INIT_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        .then(() => { setBusy(false); setName(""); refresh(); })
        .catch((e) => { setBusy(false); setError(String(e?.message ?? e)); });
    };
    if (!open) {
      return react.createElement("button", {
        type: "button",
        onClick: openPanel,
        "aria-label": t("panel.badgeAria"),
        title: t("panel.badgeAria"),
        style: { position: "absolute", top: 12, right: 12, zIndex: 20, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(128,128,128,0.35)", borderRadius: 18, background: "var(--color-bg-1, #fff)", color: "var(--color-text-1, #222)", cursor: "pointer", fontSize: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontFamily: "system-ui, sans-serif" }
      }, "\u{1F916}");
    }
    const rows = (workmates ?? []).map((w) =>
      react.createElement("div", { key: w.name, style: { padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.2)" } },
        react.createElement("div", { style: { fontWeight: 600 } },
          w.name,
          react.createElement("span", { style: { color: "rgba(128,128,128,0.9)", fontWeight: 400, marginLeft: 8 } },
            w.baseName, w.readonly ? " · " + t("panel.readonly") : "", " · " + t("panel.uses", { count: w.uses }), " · " + String(w.updatedAt ?? "").slice(0, 10)),
        ),
        react.createElement("div", { style: { color: "rgba(128,128,128,0.9)", fontSize: 12, whiteSpace: "pre-wrap" } }, String(w.note ?? "")),
      ),
    );
    return react.createElement("div", {
      role: "dialog",
      "aria-modal": "false",
      "aria-label": t("panel.title"),
      style: { position: "absolute", top: 12, right: 12, zIndex: 20, width: 420, maxWidth: "90vw", maxHeight: "80vh", overflowY: "auto", borderRadius: 10, padding: 14, background: "var(--color-bg-1, #fff)", color: "var(--color-text-1, #222)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "system-ui, sans-serif" }
    },
      react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
        react.createElement("span", { style: { fontWeight: 700 } }, t("panel.title")),
        react.createElement("button", { type: "button", onClick: closePanel, "aria-label": t("panel.close"), title: t("panel.close"), style: { border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "inherit" } }, "\u2715"),
      ),
      react.createElement("button", { type: "button", onClick: refresh, style: { marginBottom: 8, cursor: "pointer" } }, t("panel.refresh")),
      error ? react.createElement("div", { role: "alert", style: { color: "#c33", fontSize: 12, marginBottom: 6 } }, String(error)) : null,
      react.createElement("div", { style: { maxHeight: 320, overflowY: "auto", marginBottom: 8 } },
        error ? null
          : workmates === null ? react.createElement("div", { style: { color: "rgba(128,128,128,0.9)" } }, t("panel.loading"))
          : rows.length === 0 ? react.createElement("div", { style: { color: "rgba(128,128,128,0.9)" } }, t("panel.empty"))
          : rows,
      ),
      react.createElement("form", { onSubmit: submit, style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 8 } },
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.baseLabel")),
          react.createElement("input", { placeholder: t("panel.basePlaceholder"), value: base, onChange: (e) => setBase(e.target.value), style: { padding: 4 } }),
        ),
        react.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 } },
          react.createElement("span", null, t("panel.nameLabel")),
          react.createElement("input", { placeholder: t("panel.namePlaceholder"), value: name, onChange: (e) => setName(e.target.value), style: { padding: 4 } }),
        ),
        react.createElement("button", { type: "submit", disabled: busy || !base.trim(), style: { cursor: "pointer" } }, busy ? t("panel.initBusy") : t("panel.init")),
      ),
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
    // Workmate library: frame-wide floater + sidebar-foot toggle (mirrors the
    // agent-teams activity floater pattern: additive slots, no shipped-ui replacement).
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

  module.exports = { inject, apply };
  return module.exports;
}
