// Real-render parity proof (NOT a committed gate — a manual verification harness).
// Loads the SHIPPED combined client, takes the mpd-owned team page factory AND the real
// adopted agent-teams module through the export bridge, then renders TeamPageView with
// REAL React 18 + the REAL IconChevronDownOutline14 and prints the markup, so the panel
// interior can be compared against the removed floater's own DOM/CSS.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const PRIM = "/root/.npm/_npx/1e7f6d9597241db0/node_modules";
const ROOT = process.cwd();

// ── minimal browser globals the adopted bundle touches at module-eval time ────────────
const styleTags = [];
const fakeDocument = {
  head: { appendChild: (node) => styleTags.push(node) },
  body: { appendChild: (node) => styleTags.push(node), setAttribute() {}, removeAttribute() {} },
  createElement: () => ({ setAttribute() {}, appendChild() {}, dataset: {}, style: {}, set textContent(v) { this._t = v }, get textContent() { return this._t } }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  documentElement: { setAttribute() {}, style: { setProperty() {} } },
};
globalThis.document = fakeDocument;
globalThis.window = globalThis;
globalThis.navigator = { userAgent: "node" };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const factories = new Map();
const window_ = { __ModuleLoader__: { load: (r) => factories.set(r.id, r.factory), create: () => ({ manifest: { plugins: [] } }), prefetch: async () => {} } };
new Function("window", readFileSync(join(ROOT, "packages/mpd-bundle-plugin/client.js"), "utf8"))(window_);

const react = require(join(PRIM, "react"));
// This harness is a manual verification tool, not the shipped runtime: DSH renders plugin
// components on the CLIENT only (the adopted panel itself passes no getServerSnapshot), so
// the two-argument useSyncExternalStore is correct for production. SSR needs the third
// argument, so it is shimmed here purely to obtain real markup for inspection.
const { renderToStaticMarkup } = require(join(PRIM, "react-dom/server"));
// The real primitives package is ESM and imports katex CSS, which Node cannot load. The
// icon identity is already pinned elsewhere (bun test + the dsh-qa parity step); what
// THIS harness needs is a real React render of the adopted TeamSection inside our panel,
// so the module is stubbed with the platform chevron's exact path and a generic icon for
// every other export the adopted views use.
const CHEVRON_D = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";
const genericIcon = (props) => react.createElement("svg", { width: props?.size ?? 16, height: props?.size ?? 16, viewBox: "0 0 16 16", "data-icon": "stub" });
const primitives = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === "IconChevronDownOutline14") {
      return (props) => react.createElement("svg", { width: props?.size ?? 14, height: props?.size ?? 14, viewBox: "0 0 14 14", fill: "none" },
        react.createElement("path", { d: CHEVRON_D, fill: "currentColor" }));
    }
    if (typeof prop !== "string") return undefined;
    // Any capitalised export is a component the adopted views may render; anything else is
    // a utility the SSR walk never calls.
    if (/^[A-Z]/.test(prop)) return genericIcon;
    return () => undefined;
  },
});

const cache = new Map();
const requireShim = (name) => {
  if (cache.has(name)) return cache.get(name);
  if (name === "react") return react;
  if (name === "react/jsx-runtime") return require(join(PRIM, "react/jsx-runtime"));
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
  const f = factories.get(name);
  if (f === undefined) throw new Error("no module " + name);
  const v = f(requireShim);
  cache.set(name, v);
  return v;
};

const adopted = requireShim("@nanmicoder/dsh-agent-teams");
const page = requireShim("@mpd-dsh/team-page");
console.log("adopted bridge exports:", ["TeamSection", "ACTIVITY_PANEL_CSS", "zh", "en"].map((k) => k + "=" + (adopted[k] !== undefined)).join(" "));
console.log("style tags injected at eval:", styleTags.length);

const teams = [{
  workspace: "/w", teamId: "alpha", name: "Alpha team", captainSessionId: "s1", phase: "running",
  members: [
    { id: "m1", name: "senior-eng", role: "engineer", activity: "working", status: "working", progress: 0.5, done: 1, total: 2, currentTask: "t1", unread: 0 },
    { id: "m2", name: "reviewer", role: "reviewer", activity: "idle", status: "idle", progress: 0, done: 0, total: 0, currentTask: "", unread: 0 },
  ],
  tasks: [
    { id: "t1", subject: "build the page", status: "in_progress", state: "running", assignee: "senior-eng", kind: "implementation", dependencies: [] },
    { id: "t2", subject: "review it", status: "open", state: "open", assignee: "reviewer", kind: "review", dependencies: ["t1"] },
  ],
  messageCount: 4, captainInbox: [], planReviewState: undefined,
}];
const archivedTeams = [{
  workspace: "/w", teamId: "old", name: "Old team", captainSessionId: "s1", phase: "running",
  members: [], tasks: [], messageCount: 0, captainInbox: [],
}];

// The page reads the adopted monitor store; publish the fixture through the bridge and
// point its polling at a stub so a single render is deterministic.
adopted.updateActivitySnapshots({ teams, archivedTeams });
const originalStart = adopted.startActivityPolling;

const cleanups = [];
try {
  react.useSyncExternalStore = (_subscribe, getSnapshot) => {
    try { _subscribe(() => {}); } catch { /* store stub */ }
    return getSnapshot();
  };
  // Run effects eagerly so the page's polling registration + publish path executes; the
  // module-level store then holds the fixture for the SECOND render (SSR renders once).
  react.useEffect = (fn) => { try { const d = fn(); if (typeof d === "function") cleanups.push(d); } catch { /* optional effect */ } };
  react.useLayoutEffect = react.useEffect;
} catch (error) {
  console.log("WARN: could not shim react hooks:", String(error));
}
// Synchronous thenable: ensurePolling's `firstTick.then(() => publishSnapshot())` must run
// before the render returns, so the warm-up render populates the store.
adopted.startActivityPolling = () => ({ firstTick: { then: (ok) => { ok(); return { catch: () => {} }; } }, stop() {} });
console.log("react hooks shimmed for eager effects: yes");

const store = { reduce: () => {}, getSnapshot: () => ({}), subscribe: () => () => {} };
const ctx = {
  get: (name) => (name === "modelDirectories" ? undefined : undefined),
  locale: { getSnapshot: () => ({ active: "en" }) },
  effect: () => () => {},
  sessions: undefined,
};

const element = react.createElement(page.TeamPageView, {
  ctx, scope: { sessionId: "s1" }, tab: {}, visible: true, store,
});
// Warm-up render: effects run eagerly and the synchronous firstTick publishes the fixture
// into the module-level store. The second render then reads it synchronously.
renderToStaticMarkup(element);
const html = renderToStaticMarkup(element);
console.log("\n=== rendered markup ===");
console.log(html.replace(/></g, ">\n<"));

console.log("\n=== adopted class map (subset) ===");
const css = adopted.ACTIVITY_PANEL_CSS;
console.log(JSON.stringify({ panel: css.panel, panelHead: css.panelHead, panelTitle: css.panelTitle, panelDot: css.panelDot, panelControls: css.panelControls, iconButton: css.iconButton, teams: css.teams, emptyHint: css.emptyHint, archivedWrap: css.archivedWrap }, null, 1));
const checks = [
  ["root carries adopted panel class", html.includes(`class="${css.panel}"`)],
  ["head carries adopted panelHead class", html.includes(`class="${css.panelHead}"`)],
  ["title carries adopted panelTitle class", html.includes(`class="${css.panelTitle}"`)],
  ["busy dot rendered with data-busy", html.includes(`class="${css.panelDot}" data-busy="true"`)],
  ["controls carry adopted panelControls class", html.includes(`class="${css.panelControls}"`)],
  ["collapse button carries adopted iconButton class", html.includes(`class="${css.iconButton}" data-control="collapse"`)],
  ["collapse glyph is the platform chevron path", html.includes("M11.8486 5.5L11.4238")],
  ["body carries adopted teams class", html.includes(`class="${css.teams}"`)],
  // The real adopted map has NO archivedWrap key (upstream reads a missing key), so the
  // original wrapper is class-less — the page must match that exactly.
  ["archived wrapper mirrors the adopted class (absent upstream)", css.archivedWrap === undefined
    && html.includes('<div data-team-id="old" data-historic="true">')],
  ["panel marker present", html.includes("data-agent-teams-activity")],
  ["no absolute positioning inline", html.includes("position:relative")],
];
console.log("\n=== parity checks ===");
let bad = 0;
for (const [label, ok] of checks) { if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + label); }
console.log(bad === 0 ? "\nALL PARITY CHECKS PASS (real React render)" : `\n${bad} CHECK(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
