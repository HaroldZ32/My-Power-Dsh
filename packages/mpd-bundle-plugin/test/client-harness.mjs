// Drop-in harness for the bundle's combined web client: it reproduces the parts of
// the DSH client runtime the factory touches (module loader, require map, a minimal
// cordis-like ctx) so the sidebar tab registration and the workmate page can be
// exercised without a browser. Not a shipped artifact — QA reads it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.MPD_REPO_ROOT ?? process.cwd();

export function loadBundleClient() {
  // Resolved at CALL time, not import time: a test file sets MPD_REPO_ROOT after its import
  // (module evaluation runs first), so an import-time read silently ignores it and loads
  // whatever client.js `cwd` happens to point at — which made an earlier control-lane run
  // load the REAL client and pass while claiming to test a pre-fix build.
  const root = process.env.MPD_REPO_ROOT ?? ROOT;
  const source = readFileSync(join(root, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
  const factories = new Map();
  const bootstrap = {
    load: (registration) => factories.set(registration.id, registration.factory),
    create: () => ({ manifest: { plugins: [] } }),
    prefetch: async () => {},
  };
  const window = { __ModuleLoader__: bootstrap, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  // eslint-disable-next-line no-new-func
  new Function("window", source)(window);
  return { factories, window };
}

/** One React element record, enough to assert on what a component returns. */
function createElement(type, props, ...children) {
  const { key, ...rest } = props ?? {};
  return { type, key, props: { ...rest, children: children.length > 1 ? children : children[0] } };
}

/**
 * Minimal hook runtime: fixed-order slots, setters that schedule a re-render.
 * Enough to drive a page component until its fetched state settles, then read the
 * last rendered tree. Not a React substitute — just deterministic for assertions.
 */
export function createHookRuntime() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  const schedule = () => { dirty = true; };
  let effects = [];
  let cleanup = [];
  const react = {
    createElement,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      const set = (next) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
        schedule();
      };
      return [slots[index], set];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const key = JSON.stringify(deps ?? null);
      const previous = slots[index];
      if (previous === undefined || previous.key !== key) {
        slots[index] = { key };
        effects.push(fn);
      }
    },
    useCallback(fn) { cursor++; return fn; },
    useMemo(fn) { cursor++; return fn(); },
    /**
     * Minimal external store: subscribe once per slot and re-read the snapshot every
     * render (the store returns the same object until it really changes, so the render
     * loop converges). A store notification marks the tree dirty, which is what drives
     * the page's re-render after a poll lands.
     */
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (!(index in slots)) {
        const unsubscribe = subscribe(() => { schedule(); });
        slots[index] = { unsubscribe };
        cleanup.push(typeof unsubscribe === "function" ? unsubscribe : () => {});
      }
      return getSnapshot();
    },
  };
  return {
    react,
    reset() { cursor = 0; effects = []; },
    takeEffects() { const taken = effects; effects = []; return taken; },
    registerCleanup(fn) { cleanup.push(fn); },
    runCleanups() { for (const fn of cleanup.splice(0)) { try { fn(); } catch { /* harness */ } } },
    /**
     * Render until quiescent: keep re-rendering whenever a state setter was called
     * (fetch resolution lands in a later microtask), running pending effects between
     * passes, then return the final element tree.
     */
    async render(Component, props) {
      let current = null;
      for (let pass = 0; pass < 60; pass += 1) {
        dirty = false;
        cursor = 0;
        current = Component(props);
        for (const effect of this.takeEffects()) {
          const disposer = effect();
          if (typeof disposer === "function") this.registerCleanup(disposer);
        }
        // Let pending promises (fetch → setState) land before deciding to stop.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!dirty) break;
      }
      return current;
    },
    /**
     * Re-render the last component with an awaited flush, so a state update made OUTSIDE
     * the render loop — an event handler invoked by a test, e.g. a button click — reaches
     * the returned tree. `render()` alone cannot: it clears the dirty flag on entry.
     */
    async act(Component, props) {
      cursor = 0;
      const current = Component(props);
      for (const effect of this.takeEffects()) {
        const disposer = effect();
        if (typeof disposer === "function") this.registerCleanup(disposer);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      return current;
    },
  };
}

/**
 * A CALLER-SCOPED service, bound the way cordis binds one: the service's own `ctx` resolves to the
 * context that ASKED for the service, so a method that reads a dotted seam (`this.ctx.remote.session`)
 * is rejected unless the CALLER declared that inject. That is the MEASURED live failure behind the
 * settings card's one-provider defect: the host's model-directory resolver declares
 * `inject = ["sessions","remote","remote.session"]` and reads `this.ctx.remote.session` inside
 * `directoryFor()`, so a card that injected only `["modelDirectories","sessions"]` got
 * `cannot get property "remote.session" without inject` and silently rendered its declared lists.
 *
 * `reads` names the dotted seams the methods read (each must be in the CALLER's inject list);
 * `methods` receive the caller's ctx as their FIRST argument, the way `this.ctx` would, so a method
 * can only read what the caller declared. A method called with a missing seam throws that exact
 * error, so a test that asserts a LIVE result proves the chain was satisfied at the call site.
 */
export function callerScopedService({ reads = [], methods = {} } = {}) {
  return { __mpdCallerScoped: { reads: [...reads], methods: { ...methods } } };
}

/**
 * Bind a caller-scoped descriptor to the inject list of the ctx that resolved it: the returned view
 * carries the same non-method fields and method wrappers that THROW when a declared read is absent.
 * A plain service (no descriptor) passes through untouched, so existing fixtures are unaffected.
 */
function bindCallerScoped(value, deps) {
  const descriptor = value === null || typeof value !== "object" ? undefined : value.__mpdCallerScoped;
  if (descriptor === undefined) return value;
  const bound = {};
  for (const [name, field] of Object.entries(value)) {
    if (name !== "__mpdCallerScoped") bound[name] = field;
  }
  for (const [name, method] of Object.entries(descriptor.methods)) {
    bound[name] = (...args) => {
      const missing = descriptor.reads.find((read) => !deps.includes(read));
      if (missing !== undefined) throw new Error('cannot get property "' + missing + '" without inject');
      return method({ deps: [...deps] }, ...args);
    };
  }
  return bound;
}

/** Records how the page drives the sidebar's expand-on-content-open path. */
export function createCalls() {
  return { registerTab: [], registerFileViewer: [], effects: [], fetched: [], locale: [], openTab: [], pollStarts: [] };
}

/** The platform externals stub: just enough of the icon module the page resolves. */
export function createPrimitivesStub() {
  const IconChevronDownOutline14 = (props) => createElement("svg", { "data-icon": "chevron-down-14", size: props?.size });
  return { IconChevronDownOutline14 };
}

/**
 * A DSH-better-sidebar store stub. `reduce` is the ONLY lever a tab component has, so
 * the stub records every reduction — that is how the collapse control is proven to
 * close the panel through the sidebar's own state, not through a page-local flag.
 */
export function createSidebarStore(initial = {}) {
  let state = { panelOpen: true, ...initial };
  const reductions = [];
  return {
    state: () => state,
    reductions,
    reduce(reducer) { reductions.push(reducer); state = reducer(state); return state; },
    getSnapshot: () => state,
    subscribe: () => () => {},
  };
}

/**
 * Fake "@nanmicoder/dsh-agent-teams" module: the adopted views/store/locale surface the
 * sidebar page composes. The REAL adopted bundle is proven separately
 * (packages/mpd-agent-teams-plugin/test/export-bridge.test.mjs), so this stub only has to
 * be faithful about the contract the page relies on.
 */
export function createAdoptedStub(calls) {
  const listeners = new Set();
  let snapshot = { teams: [], archivedTeams: [] };
  // The class map the page composes. Names double as the identity under test: the page
  // must render the PANEL's own classes (visual parity), so the stub exposes the whole
  // set the floater's interior uses.
  const css = {
    panel: "aYQbCq_panel",
    panelHead: "aYQbCq_panelHead",
    panelTitle: "aYQbCq_panelTitle",
    panelDot: "aYQbCq_panelDot",
    panelControls: "aYQbCq_panelControls",
    iconButton: "aYQbCq_iconButton",
    teams: "aYQbCq_teams",
    emptyHint: "aYQbCq_emptyHint",
    archivedWrap: "aYQbCq_archivedWrap",
    archiveLabel: "aYQbCq_archiveLabel",
  };
  const publish = (update) => {
    const next = {
      teams: update.teams ?? snapshot.teams,
      archivedTeams: update.archivedTeams ?? snapshot.archivedTeams,
    };
    if (next.teams === snapshot.teams && next.archivedTeams === snapshot.archivedTeams) return snapshot;
    snapshot = next;
    for (const listener of listeners) listener();
    return snapshot;
  };
  return {
    inject: [],
    apply: () => { calls.agentTeamsApplied = true; },
    TeamSection: (props) => createElement("section", {
      "data-team-section": props.team.teamId,
      "data-historic": props.historic === true ? "1" : undefined,
      "data-model-directory": props.modelDirectory === undefined ? undefined : "present",
      "data-can-edit-plan": props.onContinuePlanning !== undefined && props.onDiscarded !== undefined ? "1" : undefined,
    }, [
      props.team.name,
      ...(props.team.members ?? []).map((member) => "member:" + member.name),
      ...(props.team.tasks ?? []).map((task) => "task:" + task.id),
    ]),
    historicCardTeam: (data, owner) => ({
      teamId: data.teamId, name: data.teamName, captainSessionId: data.captainSessionId || owner,
      phase: "running", members: [], tasks: [], archived: true,
    }),
    memberArtUrl: () => undefined,
    LEAD_ART: "lead-art",
    ACTIVITY_PANEL_CSS: css,
    AGENT_TEAMS_LOCALE_NAMESPACE: "agentTeams",
    zh: {
      "archive.label": "已归档", "archive.discardedLabel": "已丢弃",
      "activity.title": "AgentTeams 活动", "activity.empty": "暂无团队活动",
      "activity.collapse": "收起活动面板", "activity.panelAria": "AgentTeams 活动面板",
    },
    en: {
      "archive.label": "archived", "archive.discardedLabel": "discarded",
      "activity.title": "AgentTeams activity", "activity.empty": "No team activity",
      "activity.collapse": "Collapse activity panel", "activity.panelAria": "AgentTeams activity panel",
    },
    teamIsActive: (team) => (team.tasks ?? []).some((task) => task.status === "in_progress"),
    getActivitySnapshotsSnapshot: () => snapshot,
    subscribeActivitySnapshots: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    updateActivitySnapshots: publish,
    /** One deterministic tick (no interval) so tests never race a timer. */
    startActivityPolling: (targets, runtime = {}) => {
      calls.pollStarts.push({ targets, runtime });
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        const response = await globalThis.fetch("/plugins/dsh-agent-teams/state", { cache: "no-store" });
        if (response.ok !== true) return;
        const body = await response.json();
        if (Array.isArray(body.teams)) publish({ teams: body.teams });
        if (Array.isArray(body.archivedTeams)) publish({ archivedTeams: body.archivedTeams });
      };
      return { firstTick: tick(), stop: () => { stopped = true; } };
    },
    ACTIVITY_POLL_MS: 100000,
    ACTIVITY_PROBE_MS: 100000,
    ACTIVITY_STATE_URL: "/plugins/dsh-agent-teams/state",
    ACTIVITY_HALT_URL: "/plugins/dsh-agent-teams/halt",
  };
}

export function createHarness(options = {}) {
  const { services = {}, responses = {}, requireMap = {}, factories = null } = options;
  // `requestResponses` maps a REQUEST (method + path, no query) to a canned response so the
  // failure matrix of the workmate routes is expressible: mutation URLs are POSTed, and a
  // 409 in-use body cannot be keyed by URL alone. `responses` keeps its resolve-to-200 shape.
  const requestResponses = options.requestResponses ?? {};
  const calls = createCalls();
  const registry = new Map(Object.entries(services));
  const disabledTabs = options.disabledTabs ?? [];
  /**
   * DSH-better-sidebar publishes `betterSidebar` from ITS OWN plugin fiber, which activates
   * LATER than this entry — so the service is absent while `apply()` runs. That race is
   * modelled by default (the tests call `provideSidebar()` afterwards); `sidebarAtApply`
   * pre-registers it and `withoutSidebar` never provides it at all.
   */
  /**
   * Build ONE sidebar service. A remount hands the pages a FRESH service with an EMPTY tab
   * registry — that is the shape a test must be able to produce, which is why this is a factory
   * and not a single object.
   */
  const createSidebarService = () => {
    const tabs = new Map();
    return {
      // Faithful to dsh-better-sidebar 0.19.1: `registerTab` THROWS on a duplicate id and
      // `getTab(id)` answers the descriptor. Both matter here — the production registrar checks
      // `getTab` before registering, so a re-fire must be provably harmless instead of throwing.
      registerTab: (descriptor) => {
        if (tabs.has(descriptor.id)) throw new Error('[dsh-better-sidebar] tab type "' + descriptor.id + '" already registered');
        tabs.set(descriptor.id, descriptor);
        calls.registerTab.push(descriptor);
        return () => { if (tabs.get(descriptor.id) === descriptor) tabs.delete(descriptor.id); };
      },
      registerFileViewer: (descriptor) => { calls.registerFileViewer.push(descriptor); return () => {}; },
      // Auto-open capture: the page must expand the panel with a CONTENT seed.
      openTab: (seed, scope) => { calls.openTab.push({ seed, scope }); },
      isTabEnabled: (id) => !disabledTabs.includes(id),
      getTabs: () => [...tabs.values()],
      getTab: (id) => tabs.get(id),
      getSnapshot: () => ({ prefs: { pluginSettings: options.pluginSettings ?? {} } }),
    };
  };
  const sidebarService = createSidebarService();
  const sidebarProvided = options.withoutSidebar !== true;
  if (options.sidebarAtApply === true && sidebarProvided) registry.set("betterSidebar", sidebarService);
  /**
   * Injection fibers, the way cordis actually schedules them: a callback runs when every
   * declared dependency is registered, and `provide()` re-evaluates the parked ones. This is
   * the ONLY way a plugin-provided service can be consumed — a one-shot `ctx.get` probe
   * during apply() answers undefined, which is exactly the live failure this models.
   */
  const pendingInjections = [];
  /**
   * PROBE-INVISIBLE services: the exact shape of the live defect. A `hiddenServices` entry is
   * NOT in `registry`, so a bare `ctx.get(name)` probe answers undefined — only an injection
   * whose deps NAME it resolves, and that injection's callback receives a SCOPED ctx whose
   * `get` does see it. That is cordis' actual rule (a service provided by another plugin's
   * fiber is invisible to a plain probe, and `notify()` only re-evaluates fibers that DECLARE
   * the dependency), and it is what makes T-A falsifiable: on a bare-probe implementation the
   * pickers fall back even though the service exists and an injection can reach it.
   */
  const hidden = new Map(Object.entries(options.hiddenServices ?? {}));
  const scopedCtx = (deps) => ({
    ...ctx,
    // CALLER SCOPING: a service handed to this ctx is bound to THIS ctx's inject list, so a
    // caller-scoped method reading a seam the caller never declared throws (the measured live
    // failure — see `callerScopedService`). A visible registry service is bound the same way, so a
    // fixture can also prove the chain on a probe-visible service.
    get: (name) => {
      if (registry.has(name)) return bindCallerScoped(registry.get(name), deps);
      return deps.includes(name) && hidden.has(name) ? bindCallerScoped(hidden.get(name), deps) : undefined;
    },
  });
  const runInjections = () => {
    for (const entry of [...pendingInjections]) {
      if (entry.disposed) continue;
      const values = entry.deps.map((dep) => (registry.has(dep) ? registry.get(dep) : hidden.get(dep)));
      // An unsatisfied dependency parks the fiber; the entry is NOT dropped, because cordis
      // re-evaluates every fiber that DECLARES a dependency when its provider rebinds.
      if (values.some((value) => value === undefined)) continue;
      // A REBIND is a remount: the same deps naming a NEW service value must re-run the
      // callback (that is the documented `ctx.inject` behaviour the sidebar pages rely on).
      if (entry.fired === true && values.every((value, at) => value === entry.values[at])) continue;
      entry.fired = true;
      entry.values = values;
      calls.injected = calls.injected ?? [];
      calls.injected.push(entry.deps);
      entry.cb(scopedCtx(entry.deps));
    }
  };
  /**
   * Re-run every live injection against its CURRENT service values. A provider rebind re-fires
   * the callback even when the same service object is bound again, so a case needs to be able to
   * drive that re-fire explicitly instead of hoping a changed value causes one.
   */
  const refireInjections = () => {
    for (const entry of pendingInjections) {
      entry.fired = false;
      entry.values = undefined;
    }
    runInjections();
  };
  const ctx = {
    get: (name) => (registry.has(name) ? registry.get(name) : undefined),
    effect: (fn, label) => {
      calls.effects.push(label ?? "effect");
      const disposer = fn();
      return typeof disposer === "function" ? disposer : () => {};
    },
    on: () => () => {},
    provide: (name, value) => { registry.set(name, value); runInjections(); return () => registry.delete(name); },
    inject: (deps, cb) => {
      const entry = { deps: [...deps], cb, disposed: false };
      pendingInjections.push(entry);
      runInjections();
      return { dispose: () => {
        entry.disposed = true;
        const at = pendingInjections.indexOf(entry);
        if (at >= 0) pendingInjections.splice(at, 1);
      } };
    },
    slots: {
      // The host's own cards pass a GENERATOR to `slots.inject` (`function* () { yield
      // ctx.slots.register(...) }`), and the slot machinery drives it so the yielded
      // registrations/disposers are collected. The double models both shapes.
      inject: (key, cb) => {
        calls.slots = calls.slots ?? [];
        calls.slots.push(key);
        const returned = cb();
        if (returned !== null && returned !== undefined && typeof returned.next === "function") {
          let step = returned.next();
          while (step.done !== true) {
            calls.slotYields = calls.slotYields ?? [];
            calls.slotYields.push(step.value);
            step = returned.next();
          }
        }
        return () => {};
      },
      // `slots.register(options, component)` — the host's keyed-slot shape (its own cards pass the
      // options object and the component separately). The component is recorded too, so an offline
      // test can render a registered card in the hook runtime.
      register: (definition, component) => { calls.slotsRegistered = calls.slotsRegistered ?? []; calls.slotsRegistered.push({ ...definition, component }); return () => {}; },
    },
    // The dictionaries ride along: capturing only the namespace made the zh/en key-parity
    // assertion (contract §L A7) impossible offline. `calls.locale` stays the namespace list;
    // each entry also records `namespace` and `dictionaries`.
    locale: {
      register: (ns, dictionaries) => {
        calls.locale.push(ns);
        calls.localeDictionaries = calls.localeDictionaries ?? [];
        calls.localeDictionaries.push({ namespace: ns, dictionaries });
        return () => {};
      },
    },
  };
  for (const [name, value] of Object.entries(services)) registry.set(name, value);
  const hooks = createHookRuntime();
  const react = hooks.react;
  react.useLayoutEffect = react.useEffect;
  react.useId = () => "mpd-harness-id";
  const adoptedStub = services["@nanmicoder/dsh-agent-teams"] ?? createAdoptedStub(calls);
  /**
   * The platform icon module the page resolves its collapse glyph from (the adopted
   * panel renders the very same component). Stubbed so tests can prove the REAL
   * component is chosen rather than the inline fallback; pass `primitives: null` to
   * exercise the fallback.
   */
  const primitives = options.primitives === undefined ? createPrimitivesStub() : options.primitives;
  const moduleCache = new Map();
  const require = (name) => {
    if (moduleCache.has(name)) return moduleCache.get(name);
    if (name in requireMap) { moduleCache.set(name, requireMap[name]); return requireMap[name]; }
    if (name === "react") return react;
    if (name === "@nanmicoder/dsh-agent-teams") return adoptedStub;
    if (name === "@deepseek-ai/dsh-client-ui-primitives") {
      if (primitives === null) throw new Error("harness: platform primitives unavailable");
      return primitives;
    }
    const factory = factories && typeof factories.get === "function" ? factories.get(name) : undefined;
    if (factory !== undefined) {
      const value = factory(require);
      moduleCache.set(name, value);
      return value;
    }
    throw new Error("harness: unexpected require(" + name + ")");
  };
  /**
   * Canned fetch. Resolution order: an exact `method path` (or bare path) entry in
   * `requestResponses`, then the URL-keyed `responses` (200), else 404 {error}.
   * An entry is either a body, or `{ status, body }` so the failure matrix — 400
   * invalid-name / 400 confirm-required / 404 unknown / 409 collision / 409 in-use
   * (`blocking: [{teamId, member}]`) — is expressible per route.
   */
  const fetchImpl = async (url, options_) => {
    const target = String(url);
    const method = String(options_?.method ?? "GET").toUpperCase();
    calls.fetched.push({ url: target, method, options: options_ });
    const entry = requestResponses[method + " " + target] ?? requestResponses[target];
    if (entry !== undefined) {
      if (entry !== null && typeof entry === "object" && "status" in entry) {
        const status = Number(entry.status);
        const body = "body" in entry ? entry.body : { error: "HTTP " + String(status) };
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => entry };
    }
    const body = responses[target];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    return { ok: true, status: 200, json: async () => body };
  };
  return {
    ctx, require, fetchImpl, calls, registry, hooks, adoptedStub, primitives, sidebarService, sidebarProvided,
    createSidebarService,
    refireInjections,
    /** Publish the sidebar service the way its own plugin fiber does — after apply(). */
    provideSidebar: () => {
      if (!sidebarProvided) return false;
      registry.set("betterSidebar", sidebarService);
      runInjections();
      return true;
    },
    /** Publish any service and wake the parked injection fibers. */
    provideService: (name, value) => { registry.set(name, value); runInjections(); },
  };
}

/** Load the bundle client and return its `@mpd-dsh/mpd` factory exports. */
export function loadMpdClient(options = {}) {
  const { factories } = loadBundleClient();
  if (!factories.has("@mpd-dsh/team-page")) {
    throw new Error("harness: bundle client did not register @mpd-dsh/team-page (rebuild with node scripts/build-mpd-client.mjs)");
  }
  const harness = createHarness({ ...options, factories });
  const factory = factories.get("@mpd-dsh/mpd");
  if (factory === undefined) throw new Error("harness: bundle client did not register @mpd-dsh/mpd");
  // Install the stub fetch for the lifetime of this client: component effects call
  // the global `fetch` long after the factory returned, so restoring it here would
  // leave the page talking to the real network.
  const saved = globalThis.fetch;
  globalThis.fetch = harness.fetchImpl;
  const exports = factory(harness.require);
  harness.restore = () => { globalThis.fetch = saved; };
  return { exports, ...harness };
}
