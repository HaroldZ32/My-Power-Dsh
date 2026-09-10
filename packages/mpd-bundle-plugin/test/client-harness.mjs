// Drop-in harness for the bundle's combined web client: it reproduces the parts of
// the DSH client runtime the factory touches (module loader, require map, a minimal
// cordis-like ctx) so the sidebar tab registration and the workmate page can be
// exercised without a browser. Not a shipped artifact — QA reads it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.MPD_REPO_ROOT ?? process.cwd();

export function loadBundleClient() {
  const source = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
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
  return { type, props: { ...(props ?? {}), children: children.length > 1 ? children : children[0] } };
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
  };
}

export function createHarness({ services = {}, responses = {}, requireMap = {} } = {}) {
  const calls = { registerTab: [], registerFileViewer: [], effects: [], fetched: [], locale: [] };
  const registry = new Map(Object.entries(services));
  const ctx = {
    get: (name) => (registry.has(name) ? registry.get(name) : undefined),
    effect: (fn, label) => {
      calls.effects.push(label ?? "effect");
      const disposer = fn();
      return typeof disposer === "function" ? disposer : () => {};
    },
    on: () => () => {},
    provide: (name, value) => { registry.set(name, value); return () => registry.delete(name); },
    inject: (_deps, cb) => { calls.injected = (calls.injected ?? []); calls.injected.push(cb); return { then: () => {} }; },
    slots: {
      inject: (key, cb) => { calls.slots = calls.slots ?? []; calls.slots.push(key); cb(); return () => {}; },
      register: (definition) => { calls.slotsRegistered = calls.slotsRegistered ?? []; calls.slotsRegistered.push(definition); return () => {}; },
    },
    locale: { register: (ns) => { calls.locale.push(ns); return () => {}; } },
    betterSidebar: {
      registerTab: (descriptor) => { calls.registerTab.push(descriptor); return () => {}; },
      registerFileViewer: (descriptor) => { calls.registerFileViewer.push(descriptor); return () => {}; },
    },
  };
  for (const [name, value] of Object.entries(services)) registry.set(name, value);
  const hooks = createHookRuntime();
  const react = hooks.react;
  const require = (name) => {
    if (name in requireMap) return requireMap[name];
    if (name === "react") return react;
    if (name === "@nanmicoder/dsh-agent-teams") return { apply: () => { calls.agentTeamsApplied = true; }, inject: [] };
    throw new Error("harness: unexpected require(" + name + ")");
  };
  const fetchImpl = async (url, options) => {
    calls.fetched.push({ url: String(url), options });
    const body = responses[String(url)];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { ctx, require, fetchImpl, calls, registry, hooks };
}

/** Load the bundle client and return its `@mpd-dsh/mpd` factory exports. */
export function loadMpdClient(options = {}) {
  const { factories } = loadBundleClient();
  const harness = createHarness(options);
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
