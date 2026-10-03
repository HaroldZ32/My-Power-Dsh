// packages/mpd-tui-adapter-plugin/src/index.ts
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
var name = "mpd-tui-adapter";
var inject = [];
var TUI_SEAMS = {
  scenes: "tuiScenes",
  status: "tuiStatus",
  renderers: "tuiRenderers",
  settingsSections: "tuiSettingsSections",
  shortcuts: "tuiShortcuts",
  dialogs: "tuiDialogs",
  commandTrees: "tuiCommandTrees",
  pluginHost: "tuiPluginHost",
  toast: "tuiToast",
  themes: "tuiThemes",
  pluginStorage: "tuiPluginStorage",
  messageObserver: "tuiMessageObserver",
  effectLedger: "tuiEffectLedger",
  workspaces: "tuiWorkspaces",
  prompt: "tuiPrompt",
  commands: "commands",
  settings: "settings"
};
var TUI_SEAM_KEYS = [
  "scenes",
  "status",
  "renderers",
  "settingsSections",
  "shortcuts",
  "dialogs",
  "commandTrees",
  "pluginHost",
  "toast",
  "themes",
  "pluginStorage",
  "messageObserver",
  "effectLedger",
  "workspaces",
  "prompt",
  "commands",
  "settings"
];
function describeOutcome(outcome) {
  return outcome.detail === undefined ? `${outcome.id}(${outcome.state})` : `${outcome.id}(${outcome.state}: ${outcome.detail})`;
}
function reportOutcomes(sink, outcomes) {
  const attempted = outcomes.some((outcome) => outcome.state !== "absent");
  if (!attempted) {
    sink.warn("no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped");
    return "warned";
  }
  sink.info(`mpd TUI surfaces: ${outcomes.map((outcome) => describeOutcome(outcome)).join(" · ")}`);
  return "reported";
}
var DEFAULT_LOG_NAME = "mpd-tui.log";
var DEFAULT_LOG_CAP_BYTES = 1048576;
function defaultLogRoot() {
  const env = process.env.DSH_WORKSPACE_ROOT;
  if (typeof env === "string" && env.length > 0)
    return env;
  return process.cwd();
}
function createFileSink(options) {
  const fileName = typeof options.name === "string" && options.name.length > 0 ? options.name : DEFAULT_LOG_NAME;
  const cap = typeof options.capBytes === "number" && options.capBytes > 0 ? options.capBytes : DEFAULT_LOG_CAP_BYTES;
  const rootOf = () => {
    try {
      const resolved = typeof options.root === "function" ? options.root() : options.root;
      return typeof resolved === "string" && resolved.length > 0 ? resolved : defaultLogRoot();
    } catch {
      return defaultLogRoot();
    }
  };
  const pathOf = () => join(rootOf(), ".mpd", "logs", fileName);
  return {
    path: pathOf,
    write(line) {
      try {
        const file = pathOf();
        mkdirSync(dirname(file), { recursive: true });
        try {
          if (statSync(file).size > cap) {
            const existing = readFileSync(file, "utf8");
            writeFileSync(file, existing.slice(Math.floor(existing.length / 2)), "utf8");
          }
        } catch {}
        appendFileSync(file, `${line}
`, "utf8");
      } catch {}
    }
  };
}
function readableService(scoped, id) {
  if (scoped === undefined || scoped === null)
    return;
  if (typeof scoped.get === "function") {
    try {
      const found = scoped.get(id, false);
      if (found !== undefined && found !== null)
        return found;
    } catch {}
  }
  try {
    const property = scoped[id];
    if (property !== undefined && property !== null)
      return property;
  } catch {}
  return;
}
function serviceOf(ctx, id) {
  if (ctx === undefined || ctx === null || typeof ctx.get !== "function")
    return;
  try {
    const found = ctx.get(id, false);
    return found === undefined || found === null ? undefined : found;
  } catch {
    return;
  }
}
function newBindingStatus() {
  return { registered: false, bound: false, pending: [] };
}
function bindSeam(ctx, id, status, onBound) {
  if (ctx === undefined || ctx === null || typeof ctx.inject !== "function")
    return;
  try {
    ctx.inject([id], (scoped) => {
      if (status.bound)
        return;
      const service = readableService(scoped, id);
      if (service === undefined)
        return;
      status.service = service;
      status.scope = scoped;
      status.bound = true;
      const queued = status.pending.splice(0);
      for (const work of queued) {
        try {
          work(service, scoped);
        } catch {}
      }
      try {
        onBound?.();
      } catch {}
    });
    status.registered = true;
  } catch (error) {
    status.error = String(error?.message ?? error);
  }
}
function onService(ctx, id, setup, onActivated) {
  const status = newBindingStatus();
  status.pending.push((service, scope) => {
    setup(scope, service);
  });
  bindSeam(ctx, id, status, onActivated);
}
function effectOn(scoped, cleanup, label) {
  try {
    if (typeof scoped.effect === "function")
      scoped.effect(() => cleanup, label);
  } catch {}
}
function createTuiAdapter(ctx) {
  const bindings = {};
  for (const key of TUI_SEAM_KEYS)
    bindings[key] = newBindingStatus();
  for (const key of TUI_SEAM_KEYS) {
    const id = TUI_SEAMS[key];
    const binding = bindings[key];
    bindSeam(ctx, id, binding);
    if (key !== "pluginHost")
      continue;
    if (binding.bound || !binding.registered)
      continue;
    const probed = serviceOf(ctx, id);
    if (probed === undefined)
      continue;
    binding.service = probed;
    binding.scope = ctx;
    binding.bound = true;
    const queued = binding.pending.splice(0);
    for (const work of queued) {
      try {
        work(probed, ctx);
      } catch {}
    }
  }
  const fallbackIdentity = ctx;
  const makeHandle = (key, initialDetail) => {
    const id = TUI_SEAMS[key];
    let outcome = { id, state: "absent", detail: initialDetail ?? `${id} was not injected` };
    return {
      outcome: () => outcome,
      bound: () => bindings[key].bound,
      record: (recorded) => {
        outcome = recorded.detail === undefined ? { id, state: recorded.state } : { id, state: recorded.state, detail: recorded.detail };
      }
    };
  };
  const whenBoundInternal = (key, work) => {
    const binding = bindings[key];
    if (binding.bound) {
      work(binding.service, binding.scope ?? ctx);
      return true;
    }
    binding.pending.push(work);
    return false;
  };
  const register = (key, handle, detail, call) => {
    whenBoundInternal(key, (service) => {
      try {
        call(service);
        handle.record({ state: "requested", detail });
      } catch (error) {
        handle.record({ state: "refused", detail: String(error?.message ?? error) });
      }
    });
  };
  const requestedDetail = (key, what) => `${what} requested for ${TUI_SEAMS[key]} (no host read-back)`;
  const adapter = {
    ctx,
    scenes: () => bindings.scenes.service,
    status: () => bindings.status.service,
    renderers: () => bindings.renderers.service,
    settingsSections: () => bindings.settingsSections.service,
    shortcuts: () => bindings.shortcuts.service,
    dialogs: () => bindings.dialogs.service,
    commandTrees: () => bindings.commandTrees.service,
    pluginHost: () => bindings.pluginHost.service,
    toast: () => bindings.toast.service,
    themes: () => bindings.themes.service,
    pluginStorage: () => bindings.pluginStorage.service,
    messageObserver: () => bindings.messageObserver.service,
    effectLedger: () => bindings.effectLedger.service,
    workspaces: () => bindings.workspaces.service,
    prompt: () => bindings.prompt.service,
    commands: () => bindings.commands.service,
    settings: () => bindings.settings.service,
    registerScene(descriptor, identity) {
      const handle = makeHandle("scenes");
      whenBoundInternal("scenes", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.scenes}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(descriptor, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.scenes.scope ?? ctx, disposer, `mpd-tui scene ${descriptor.id}`);
          handle.record({ state: "requested", detail: `${descriptor.id} requested (no host read-back)` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return {
        outcome: handle.outcome,
        bound: handle.bound,
        record: handle.record,
        openScene: (id) => adapter.openScene(id),
        closeScene: (id) => adapter.closeScene(id)
      };
    },
    openScene(id) {
      const registry = bindings.scenes.service;
      if (registry === undefined || typeof registry.open !== "function")
        return false;
      try {
        return registry.open(id) === true;
      } catch {
        return false;
      }
    },
    closeScene(id) {
      const registry = bindings.scenes.service;
      if (registry === undefined || typeof registry.close !== "function")
        return false;
      try {
        return registry.close(id) === true;
      } catch {
        return false;
      }
    },
    setStatus(key, text, identity) {
      const handle = makeHandle("status");
      whenBoundInternal("status", (service) => {
        const status = service;
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` });
          return;
        }
        try {
          const disposer = status.set(key, text, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.status.scope ?? ctx, disposer, `mpd-tui status ${key}`);
          handle.record({
            state: "requested",
            detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated"
          });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerStatusView(view) {
      const handle = makeHandle("status");
      let refresh = () => {};
      whenBoundInternal("status", (service, scope) => {
        const status = service;
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` });
          return;
        }
        let disposer;
        let timer;
        let published;
        const publish = () => {
          try {
            const text = view.render();
            if (text === published)
              return;
            published = text;
            disposer = status.set(view.key, text, view.identity ?? fallbackIdentity);
          } catch (error) {
            view.onError?.(error);
          }
        };
        publish();
        const intervalMs = typeof view.intervalMs === "number" ? view.intervalMs : 0;
        if (intervalMs > 0) {
          try {
            timer = setInterval(publish, intervalMs);
            timer.unref?.();
          } catch {
            timer = undefined;
          }
        }
        effectOn(scope, () => {
          if (timer !== undefined) {
            try {
              clearInterval(timer);
            } catch {}
            timer = undefined;
          }
          try {
            disposer?.();
          } catch {}
          try {
            status.set(view.key, undefined, view.identity ?? fallbackIdentity);
          } catch {}
        }, view.label ?? `mpd-tui status ${view.key}`);
        refresh = publish;
        handle.record({
          state: "requested",
          detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated"
        });
      });
      return { outcome: handle.outcome, bound: handle.bound, record: handle.record, refresh: () => refresh() };
    },
    registerRenderer(type, renderer, identity) {
      const handle = makeHandle("renderers");
      whenBoundInternal("renderers", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.renderers}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(type, renderer, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.renderers.scope ?? ctx, disposer, `mpd-tui renderer ${type}`);
          handle.record({
            state: "requested",
            detail: `${type} requested (no host read-back; a refusal also returns a disposer)`
          });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerSettingsSection(section, identity) {
      const handle = makeHandle("settingsSections");
      whenBoundInternal("settingsSections", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.settingsSections}.register is missing` });
          return;
        }
        const commit = (resolved) => {
          try {
            registry.register(resolved);
            handle.record({
              state: "requested",
              detail: `section ${resolved.ns} requested (no host read-back)`
            });
          } catch (error) {
            handle.record({ state: "refused", detail: String(error?.message ?? error) });
          }
        };
        if (typeof section !== "function") {
          commit(section);
          return;
        }
        handle.record({ state: "requested", detail: "section requested (awaiting the lazy section resolver)" });
        try {
          Promise.resolve(section()).then(commit, (error) => {
            handle.record({ state: "refused", detail: String(error?.message ?? error) });
          });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerShortcut(combo, options, identity) {
      const handle = makeHandle("shortcuts");
      whenBoundInternal("shortcuts", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.shortcuts}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(combo, options, identity ?? fallbackIdentity);
          if (typeof disposer === "function")
            effectOn(bindings.shortcuts.scope ?? ctx, disposer, `mpd-tui shortcut ${combo}`);
          handle.record({ state: "requested", detail: `${combo} requested` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
    registerCommandTree(provider) {
      const handle = makeHandle("commandTrees");
      register("commandTrees", handle, requestedDetail("commandTrees", `provider for /${provider.root}`), (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.commandTrees}.register is missing`);
        const disposer = service.register(provider);
        if (typeof disposer === "function")
          effectOn(bindings.commandTrees.scope ?? ctx, disposer, `mpd-tui command tree ${provider.root}`);
      });
      return handle;
    },
    requestDecisionEvent(event, listener, options = {}) {
      let supported = false;
      let granted;
      let disposerReturned = false;
      let error;
      let outcome = { id: TUI_SEAMS.pluginHost, state: "absent", detail: `${TUI_SEAMS.pluginHost} was not injected` };
      whenBoundInternal("pluginHost", (service, scope) => {
        const host = service;
        const identity = options.identity ?? fallbackIdentity;
        if (typeof host?.subscribeDecision !== "function") {
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `${TUI_SEAMS.pluginHost}.subscribeDecision is missing` };
          return;
        }
        supported = true;
        try {
          const facade = host.grants;
          if (facade !== undefined && typeof facade.allows === "function")
            granted = facade.allows(identity, event, options.scope ?? event) === true;
        } catch {
          granted = undefined;
        }
        try {
          const disposer = host.subscribeDecision(identity, event, listener, {
            ...options.scope === undefined ? {} : { scope: options.scope },
            ...options.order === undefined ? {} : { order: options.order }
          });
          disposerReturned = typeof disposer === "function";
          if (disposerReturned)
            effectOn(scope, disposer, `mpd-tui decision ${event}`);
        } catch (caught) {
          error = String(caught?.message ?? caught).replace(/\s+/gu, " ").trim().slice(0, 160);
          disposerReturned = false;
        }
        if (error !== undefined)
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: error };
        else if (!disposerReturned)
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: "subscribeDecision returned no disposer" };
        else if (granted === true)
          outcome = { id: TUI_SEAMS.pluginHost, state: "confirmed", detail: `${event} subscribed and authorised` };
        else if (granted === false)
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `no grant for ${event}` };
        else
          outcome = { id: TUI_SEAMS.pluginHost, state: "requested", detail: "grant state not queryable in this composition" };
      });
      return {
        supported: () => supported,
        granted: () => granted,
        disposerReturned: () => disposerReturned,
        error: () => error,
        outcome: () => outcome
      };
    },
    grantsAllows(permission, scope, identity) {
      const host = bindings.pluginHost.service;
      try {
        const facade = host?.grants;
        if (facade === undefined || typeof facade.allows !== "function")
          return;
        return facade.allows(identity ?? fallbackIdentity, permission, scope) === true;
      } catch {
        return;
      }
    },
    registerCommand(definition) {
      const handle = makeHandle("commands");
      register("commands", handle, `/${definition.name} requested (no host read-back at apply time)`, (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.commands}.register is missing`);
        const disposer = service.register(definition);
        if (typeof disposer === "function")
          effectOn(bindings.commands.scope ?? ctx, disposer, `mpd-tui command /${definition.name}`);
      });
      return handle;
    },
    registerSettingsNamespace(ns, schema, options) {
      const handle = makeHandle("settings");
      register("settings", handle, `namespace ${ns} requested (no host read-back)`, (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.settings}.register is missing`);
        service.register(ns, schema, options);
      });
      return handle;
    },
    whenBound(key, setup) {
      const handle = makeHandle(key);
      whenBoundInternal(key, (service, scope) => {
        handle.record({ state: "available", detail: "bound through the deferred inject form" });
        setup(service, scope, handle);
      });
      return handle;
    },
    skipped(key, detail) {
      const handle = makeHandle(key, detail);
      return handle;
    },
    capabilities() {
      const seams = {};
      let bound = 0;
      for (const key of TUI_SEAM_KEYS) {
        const live = bindings[key].bound;
        seams[key] = live;
        if (live)
          bound += 1;
      }
      return { seams, bound, total: TUI_SEAM_KEYS.length };
    },
    seamOutcomes() {
      return TUI_SEAM_KEYS.map((key) => {
        const binding = bindings[key];
        const id = TUI_SEAMS[key];
        if (binding.bound)
          return { id, state: "available", detail: "bound through the deferred inject form" };
        if (binding.error !== undefined)
          return { id, state: "refused", detail: binding.error };
        return { id, state: "absent", detail: "not composed in this profile" };
      });
    },
    diagnosticSink(options = {}) {
      const root = options.root ?? defaultLogRoot;
      return createFileSink({
        root,
        ...options.name === undefined ? {} : { name: options.name },
        ...options.capBytes === undefined ? {} : { capBytes: options.capBytes }
      });
    }
  };
  return adapter;
}
var SERVICE_NAME = "mpdTui";
function resolveTuiAdapter(ctx) {
  const get = ctx !== undefined && ctx !== null && typeof ctx.get === "function" ? ctx.get : undefined;
  if (get !== undefined) {
    try {
      const mounted = get.call(ctx, SERVICE_NAME);
      if (mounted !== undefined && mounted !== null)
        return mounted;
    } catch {}
  }
  return createTuiAdapter(ctx);
}
function createLazyTuiAdapter(ctx, options) {
  let fallback;
  let warned = false;
  const resolve = () => {
    const get = ctx?.get;
    if (typeof get === "function") {
      try {
        const mounted = get.call(ctx, SERVICE_NAME);
        if (mounted !== undefined && mounted !== null)
          return mounted;
      } catch {}
    }
    if (fallback === undefined)
      fallback = createTuiAdapter(ctx);
    if (!warned) {
      warned = true;
      const line = `[${options.label}] TUI ADAPTER FALLBACK: ${SERVICE_NAME} is not provided in this composition; this row runs on a` + " row-private adapter (the one-contact-surface rule, AGENTS.md §6). This boot keeps working, which is exactly why the" + " branch is loud — fix the ROW ORDER (this row must sit BELOW mpd-tui-adapter).";
      if (typeof options.warn === "function")
        options.warn(line);
      else {
        try {
          createFileSink({ root: defaultLogRoot }).write(line);
        } catch {}
      }
    }
    return fallback;
  };
  return new Proxy({}, {
    get(_target, property) {
      const impl = resolve();
      const value = impl[property];
      return typeof value === "function" ? value.bind(impl) : value;
    },
    has(_target, property) {
      return property in resolve();
    }
  });
}
function apply(ctx, config = {}) {
  const adapter = createTuiAdapter(ctx);
  try {
    const provide = ctx.provide;
    if (typeof provide === "function")
      provide.call(ctx, SERVICE_NAME, adapter);
  } catch {}
  if (config.quiet === true)
    return;
  try {
    const sink = createFileSink({ root: config.logRoot ?? defaultLogRoot });
    sink.write(`[mpd-tui-adapter] ${SERVICE_NAME} provided (one deferred inject per seam, inject-free row)`);
    sink.write(`TUI_SEAMS=${TUI_SEAM_KEYS.filter((key) => adapter.capabilities().seams[key]).map((key) => TUI_SEAMS[key]).join(",") || "(none composed)"}`);
  } catch {}
}
export {
  DEFAULT_LOG_CAP_BYTES,
  DEFAULT_LOG_NAME,
  SERVICE_NAME,
  TUI_SEAMS,
  TUI_SEAM_KEYS,
  apply,
  createFileSink,
  createLazyTuiAdapter,
  createTuiAdapter,
  defaultLogRoot,
  describeOutcome,
  effectOn,
  inject,
  name,
  onService,
  readableService,
  reportOutcomes,
  resolveTuiAdapter,
  serviceOf
};
