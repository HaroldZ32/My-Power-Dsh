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
  const inject = ["slots", "conversationEvents", "sessions", "locale", "modelDirectories"];

  const LIST_URL = "/plugins/mpd-workmate/list";
  const INIT_URL = "/plugins/mpd-workmate/init";
  const TOGGLE_EVENT = "mpd:workmate:toggle";

  function request(url, options) {
    return fetch(url, options).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function WorkmatePanel(props) {
    const [workmates, setWorkmates] = react.useState(null);
    const [error, setError] = react.useState(null);
    const [base, setBase] = react.useState("");
    const [name, setName] = react.useState("");
    const [busy, setBusy] = react.useState(false);
    const refresh = () => {
      request(LIST_URL).then((data) => setWorkmates(data.workmates ?? [])).catch((e) => setError(String(e.message ?? e)));
    };
    react.useEffect(() => {
      refresh();
      const onToggle = () => {
        if (props.onClose) props.onClose();
        refresh();
      };
      window.addEventListener(TOGGLE_EVENT, onToggle);
      return () => window.removeEventListener(TOGGLE_EVENT, onToggle);
    }, []);
    const submit = (ev) => {
      ev.preventDefault();
      if (busy) return;
      setBusy(true);
      const body = JSON.stringify({ base: base.trim(), name: name.trim() || undefined });
      request(INIT_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        .then(() => { setBusy(false); setName(""); refresh(); })
        .catch((e) => { setBusy(false); setError(String(e.message ?? e)); refresh(); });
    };
    const rows = (workmates ?? []).map((w) =>
      react.createElement("div", { key: w.name, style: { padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.2)" } },
        react.createElement("div", { style: { fontWeight: 600 } },
          w.name,
          react.createElement("span", { style: { color: "rgba(128,128,128,0.9)", fontWeight: 400, marginLeft: 8 } },
            w.baseName, w.readonly ? " · readonly" : "", " · uses=" + w.uses, " · " + String(w.updatedAt ?? "").slice(0, 10)),
        ),
        react.createElement("div", { style: { color: "rgba(128,128,128,0.9)", fontSize: 12, whiteSpace: "pre-wrap" } }, String(w.note ?? "")),
      ),
    );
    return react.createElement("div", { style: { width: 420, maxWidth: "90vw", borderRadius: 10, padding: 14, background: "var(--color-bg-1, #fff)", color: "var(--color-text-1, #222)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "system-ui, sans-serif" } },
      react.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
        react.createElement("span", { style: { fontWeight: 700 } }, "Workmate library (~/.mpd/workmate)"),
        react.createElement("button", { onClick: () => props.onClose && props.onClose(), style: { border: "none", background: "none", cursor: "pointer", fontSize: 14 } }, "\u2715"),
      ),
      react.createElement("button", { onClick: refresh, style: { marginBottom: 8, cursor: "pointer" } }, "Refresh"),
      error ? react.createElement("div", { style: { color: "#c33", fontSize: 12, marginBottom: 6 } }, String(error)) : null,
      react.createElement("div", { style: { maxHeight: 320, overflowY: "auto", marginBottom: 8 } },
        workmates === null ? react.createElement("div", { style: { color: "rgba(128,128,128,0.9)" } }, "Loading\u2026")
          : rows.length === 0 ? react.createElement("div", { style: { color: "rgba(128,128,128,0.9)" } }, "No workmates yet \u2014 initialize one below.")
          : rows,
      ),
      react.createElement("form", { onSubmit: submit, style: { display: "flex", gap: 6, alignItems: "center" } },
        react.createElement("input", { placeholder: "base (e.g. hephaestus)", value: base, onChange: (e) => setBase(e.target.value), style: { flex: 1, padding: 4 } }),
        react.createElement("input", { placeholder: "name (optional)", value: name, onChange: (e) => setName(e.target.value), style: { flex: 1, padding: 4 } }),
        react.createElement("button", { type: "submit", disabled: busy || !base.trim(), style: { cursor: "pointer" } }, busy ? "\u2026" : "Init"),
      ),
    );
  }

  function WorkmateToggle() {
    return react.createElement("button", {
      style: { background: "none", border: "none", cursor: "pointer", color: "inherit" },
      title: "Workmate library",
      onClick: () => window.dispatchEvent(new Event(TOGGLE_EVENT)),
    }, "\u{1F916} Workmates");
  }

  function apply(ctx) {
    // Adopted agent-teams client half: team activity floater + team card + command view.
    agentTeams.apply(ctx);
    // Workmate library: frame-wide floater + sidebar-foot toggle (mirrors the
    // agent-teams activity floater pattern: additive slots, no shipped-ui replacement).
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: "mpd-workmate-library",
      order: 90,
      label: "Workmate library",
    }, (props) => react.createElement(WorkmatePanel, props)));
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
      name: "sidebar.footer.action",
      id: "mpd-workmate-toggle",
      order: 90,
      label: "Workmates",
    }, () => react.createElement(WorkmateToggle, null)));
  }

  module.exports = { inject, apply };
  return module.exports;
}
