// packages/mpd-tui-adapter-plugin/src/index.ts
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  panels: "tuiPanels",
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
  "panels",
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
var HOST_PACKAGE_PATH = ["node_modules", "@deepseek-harness-tui", "dsh-tui"];
var HOST_UI_MODULE = "lib/types/ui.js";
var HOST_ROOT_ENV = "MPD_DSH_TUI_HOST_ROOT";
var HOST_HOME_DIRS = [".dsh", ".dsh-tui"];
var HOST_ANCHOR_LEVELS = 8;
var HOST_LIVE_CONTEXT_MARKER = "internal_querier";
function readHostStdinValue(value) {
  try {
    if (typeof value !== "object" || value === null)
      return { detail: "the host stdin hook answered no context value" };
    const record = value;
    const marker = HOST_LIVE_CONTEXT_MARKER in record ? record[HOST_LIVE_CONTEXT_MARKER] : undefined;
    if (marker === undefined || marker === null) {
      return {
        detail: `the host hook resolved the StdinContext DEFAULT (no ${HOST_LIVE_CONTEXT_MARKER}) — the host module instance is not the one the TUI runs; the take-over stays absent`
      };
    }
    const emitter = record.internal_eventEmitter;
    if (emitter === undefined || emitter === null)
      return { detail: "the host stdin context carries no input emitter" };
    const bus = emitter;
    if (typeof bus.prependListener !== "function")
      return { detail: "the host input emitter has no prependListener" };
    if (typeof bus.removeListener !== "function")
      return { detail: "the host input emitter has no removeListener" };
    if (typeof bus.on !== "function")
      return { detail: "the host input emitter has no on" };
    return { emitter: bus };
  } catch (error) {
    return { detail: `the host stdin context could not be read: ${String(error?.message ?? error)}` };
  }
}
function hostRootCandidates(env = process.env, home = homedir()) {
  const pinned = env[HOST_ROOT_ENV];
  if (typeof pinned === "string" && pinned.length > 0)
    return [pinned];
  const roots = [];
  const anchors = [];
  try {
    anchors.push(dirname(fileURLToPath(import.meta.url)));
  } catch {}
  const argv1 = process.argv[1];
  if (typeof argv1 === "string" && argv1.length > 0)
    anchors.push(dirname(argv1));
  for (const anchor of anchors) {
    let dir = anchor;
    for (let level = 0;level < HOST_ANCHOR_LEVELS; level += 1) {
      roots.push(join(dir, ...HOST_PACKAGE_PATH));
      const parent = dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
  }
  const homes = [];
  if (typeof env.DSH_HOME === "string" && env.DSH_HOME.length > 0)
    homes.push(env.DSH_HOME);
  for (const name2 of HOST_HOME_DIRS)
    homes.push(join(home, name2));
  for (const root of homes) {
    let entries = [];
    try {
      entries = readdirSync(join(root, "profiles"), { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isDirectory())
        roots.push(join(root, "profiles", entry.name, ...HOST_PACKAGE_PATH));
    }
  }
  return [...new Set(roots)];
}
async function probeHostInput(candidates) {
  let skew = "";
  if (candidates.length === 0)
    return { detail: `no candidate host root (no DSH profile carries ${HOST_PACKAGE_PATH.join("/")})` };
  for (const root of candidates) {
    const file = join(root, HOST_UI_MODULE);
    try {
      if (!statSync(file).isFile())
        continue;
    } catch {
      continue;
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      const hook = mod.useStdin;
      if (typeof hook !== "function") {
        skew = `${file} carries no useStdin export`;
        continue;
      }
      return { input: { useStdin: () => hook() }, root };
    } catch (error) {
      skew = `${file}: ${String(error?.message ?? error)}`;
    }
  }
  return { detail: skew.length > 0 ? skew : `no candidate carried a readable ${HOST_UI_MODULE} (${candidates.length} probed)` };
}
function defaultHostInputLog(line) {
  try {
    createFileSink({ root: defaultLogRoot }).write(line);
  } catch {}
}
var HOST_PREFS_MODULE = "lib/types/tuiDisplayPrefs.js";
async function probeHostPrefs(candidates) {
  let skew = "";
  if (candidates.length === 0)
    return { detail: `no candidate host root (no DSH profile carries ${HOST_PACKAGE_PATH.join("/")})` };
  for (const root of candidates) {
    const file = join(root, HOST_PREFS_MODULE);
    try {
      if (!statSync(file).isFile())
        continue;
    } catch {
      continue;
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.getSidePanelPanels !== "function" || typeof mod.applySidePanelPanels !== "function") {
        skew = `${file} carries no getSidePanelPanels/applySidePanelPanels pair`;
        continue;
      }
      const read = mod.getSidePanelPanels;
      const write = mod.applySidePanelPanels;
      const feed = typeof mod.subscribeSidePanelPanels === "function" ? mod.subscribeSidePanelPanels : undefined;
      return {
        prefs: {
          getSidePanelPanels: () => read(),
          applySidePanelPanels: (value) => write(value),
          ...feed === undefined ? {} : { subscribeSidePanelPanels: (listener) => feed(listener) }
        },
        root
      };
    } catch (error) {
      skew = `${file}: ${String(error?.message ?? error)}`;
    }
  }
  return { detail: skew.length > 0 ? skew : `no candidate carried a readable ${HOST_PREFS_MODULE} (${candidates.length} probed)` };
}
function mergePanelEnableIds(existing, ours) {
  const tokens = [];
  for (const token of (typeof existing === "string" ? existing : "").split(",")) {
    const id = token.trim().toLowerCase();
    if (id !== "" && !tokens.includes(id))
      tokens.push(id);
  }
  const added = ours.filter((id) => !tokens.includes(id));
  return { csv: [...tokens, ...added].join(","), added, present: ours.filter((id) => tokens.includes(id)) };
}
var PANEL_KEEPER_LADDER_MS = [1000, 2500, 5500, 9000, 16000, 25000];
function createPanelEnableKeeper(options) {
  const ours = [];
  const ladder = options.ladder ?? PANEL_KEEPER_LADDER_MS;
  const pending = [];
  let armed = false;
  let ticks = 0;
  let reasserted = 0;
  let onFeed = false;
  let releaseFeed;
  let writing = false;
  let state = "requested";
  let detail = "no panel registered yet";
  let feedRefused = "";
  const announce = () => {
    if (options.onChange === undefined)
      return;
    try {
      options.onChange({ state, detail, ids: [...ours], reasserted, ticks });
    } catch {}
  };
  const settle = (next, nextDetail) => {
    state = next;
    detail = feedRefused === "" ? nextDetail : `${nextDetail}; the change feed was refused: ${feedRefused}`;
    announce();
    if (ticks < ladder.length)
      return;
    options.log?.(`mpd-tui panel enable keeper: ${next} — ${detail}; ${String(reasserted)} write(s) over ${String(ticks)} tick(s); ids ${ours.join(",") || "(none)"}`);
  };
  const cancelLadder = () => {
    for (const cancel of pending.splice(0)) {
      try {
        cancel();
      } catch {}
    }
  };
  const releaseFeedNow = () => {
    const release = releaseFeed;
    releaseFeed = undefined;
    onFeed = false;
    if (release === undefined)
      return;
    try {
      release();
    } catch {}
  };
  const decide = (prefs, atArm) => {
    if (writing)
      return;
    ticks += 1;
    try {
      const merge = mergePanelEnableIds(prefs.getSidePanelPanels(), ours);
      if (merge.present.length > 0) {
        if (atArm) {
          settle("confirmed", `the enable list already names ${merge.present.join(",")}; the keeper now follows the host's own change feed instead of standing down on this read`);
          return;
        }
        settle("confirmed", `standing down: the enable list names ${merge.present.join(",")}, so the configuration has taken a position on this bundle`);
        standDown();
        return;
      }
      if (merge.added.length === 0) {
        settle("confirmed", "no id of ours is registered, so there is nothing to re-assert");
        return;
      }
      writing = true;
      try {
        prefs.applySidePanelPanels(merge.csv);
      } finally {
        writing = false;
      }
      reasserted += 1;
      settle("confirmed", `re-asserted ${merge.added.join(",")} (the list named none of our ids)`);
    } catch (error) {
      settle("refused", String(error?.message ?? error));
    }
  };
  const standDown = () => {
    cancelLadder();
    releaseFeedNow();
  };
  const enterFeed = (prefs) => {
    const subscribe = prefs.subscribeSidePanelPanels;
    if (typeof subscribe !== "function")
      return false;
    let release;
    try {
      release = subscribe(() => decide(prefs, false));
    } catch (error) {
      feedRefused = String(error?.message ?? error);
      settle("refused", "the host's change feed refused this keeper");
      return false;
    }
    releaseFeed = typeof release === "function" ? release : undefined;
    onFeed = true;
    cancelLadder();
    decide(prefs, true);
    return true;
  };
  const runTick = () => {
    options.loadPrefs().then((probe) => {
      if (probe.prefs === undefined) {
        ticks += 1;
        settle("absent", probe.detail ?? "the host exposes no side-panel enable store");
        return;
      }
      if (!onFeed && enterFeed(probe.prefs))
        return;
      decide(probe.prefs, false);
    }, (error) => {
      ticks += 1;
      settle("absent", `the host store could not be read: ${String(error?.message ?? error)}`);
    });
  };
  const arm = () => {
    if (armed)
      return;
    armed = true;
    for (const delayMs of ladder) {
      try {
        pending.push(options.schedule(runTick, delayMs));
      } catch {
        break;
      }
    }
  };
  return {
    observe(id) {
      if (id.length === 0 || ours.includes(id))
        return;
      ours.push(id);
      state = "requested";
      detail = `settling ${String(ladder.length)} tick(s) for ${ours.join(",")}`;
      arm();
      announce();
    },
    outcome() {
      return { state, detail, ids: [...ours], reasserted, ticks };
    },
    stop() {
      standDown();
    }
  };
}
function defaultPanelKeeperSchedule(run, delayMs) {
  const timer = setTimeout(run, delayMs);
  timer.unref?.();
  return () => {
    clearTimeout(timer);
  };
}
var PANEL_IDS_RECORD_NAME = "mpd-tui-panels.json";
function readHostPackageVersion(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}
function panelRecordProvenance(host, readBack, ids) {
  if (host === undefined || host.root === "" || host.version === "") {
    return { refused: "no installed host package could be named (root and version), so the ids cannot be traced to a boot" };
  }
  if (readBack === "" || ids.length === 0) {
    return { refused: "the ids did not come from a host read-back, so the record would name panels nothing verified" };
  }
  const activation = ids[0].slice(0, ids[0].indexOf(":"));
  for (const id of ids) {
    if (id.slice(0, id.indexOf(":")) !== activation) {
      return { refused: `the ids do not share one activation (${activation} and ${id.slice(0, id.indexOf(":"))}), so they cannot have come from one registration` };
    }
  }
  if (/^act0$/u.test(activation)) {
    return { refused: `activation ${activation} is impossible: the host's pluginIdFor pre-increments its fallback counter, so the first composed activation is act1` };
  }
  return { provenance: { hostRoot: host.root, hostVersion: host.version, readBack, activation } };
}
function recordPanelIds(outcome, host, readBack) {
  const proved = panelRecordProvenance(host, readBack, outcome.ids);
  if ("refused" in proved)
    return;
  try {
    const file = join(defaultLogRoot(), ".mpd", "logs", PANEL_IDS_RECORD_NAME);
    mkdirSync(dirname(file), { recursive: true });
    const record = {
      version: 2,
      panelIds: [...outcome.ids],
      slugs: outcome.ids.map((id) => id.slice(id.indexOf(":") + 1)),
      updatedAt: new Date().toISOString(),
      provenance: proved.provenance
    };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}
`);
  } catch {}
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
function createTuiAdapter(ctx, options = {}) {
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
  let hostContact = options.hostInput;
  let hostState = options.hostInput !== undefined ? { state: "bound", kit: "probed", detail: "injected by the caller" } : options.probeHostContact === true ? { state: "pending" } : { state: "absent", detail: "this adapter did not probe for the host contact" };
  const hostWaiters = [];
  let panelHostProvenance;
  let panelIdReadBack = "";
  const panelKeeperOptions = {
    loadPrefs: async () => {
      const probe = await probeHostPrefs(hostRootCandidates());
      if (probe.root !== undefined)
        panelHostProvenance = { root: probe.root, version: readHostPackageVersion(probe.root) };
      return probe;
    },
    schedule: defaultPanelKeeperSchedule,
    ...options.panelEnableLadder === undefined ? {} : { ladder: options.panelEnableLadder },
    log: options.panelEnableLog ?? options.hostInputLog ?? defaultHostInputLog,
    onChange: options.keepPanelEnable === true ? (outcome) => {
      if (!panelKeeperOwned) {
        panelKeeperOwned = true;
        effectOn(ctx, () => {
          panelKeeper.stop();
        }, "mpd-tui panel enable keeper");
      }
      recordPanelIds(outcome, panelHostProvenance, panelIdReadBack);
    } : undefined
  };
  const panelKeeper = options.keepPanelEnable === true ? createPanelEnableKeeper(panelKeeperOptions) : {
    observe: () => {},
    outcome: () => ({ state: "absent", detail: "this adapter did not keep the host panel enable list", ids: [], reasserted: 0, ticks: 0 }),
    stop: () => {}
  };
  let panelKeeperOwned = false;
  let rememberedHook;
  const currentHostInput = () => rememberedHook === undefined ? hostContact : { useStdin: () => rememberedHook?.() };
  const wakeHostWaiters = () => {
    const waiting = hostWaiters.splice(0);
    const input = currentHostInput();
    for (const listener of waiting) {
      try {
        listener(input);
      } catch {}
    }
  };
  const settleHostContact = (result) => {
    hostContact = result.input;
    hostState = result.input === undefined ? { state: "absent", ...result.root === undefined ? {} : { root: result.root }, detail: result.detail ?? "the installed DSH-TUI was not reachable" } : { state: "bound", kit: "probed", ...result.root === undefined ? {} : { root: result.root }, detail: "the host's own useStdin was loaded by file URL" };
    wakeHostWaiters();
    try {
      (options.hostInputLog ?? defaultHostInputLog)(result.input === undefined ? `[mpd-tui-adapter] host contact ABSENT: ${hostState.detail ?? ""} — the surfaces that need it stay inactive` : `[mpd-tui-adapter] host contact bound: ${hostState.root ?? "?"} (${HOST_UI_MODULE})`);
    } catch {}
  };
  if (options.hostInput === undefined && options.probeHostContact === true) {
    probeHostInput(hostRootCandidates()).then(settleHostContact, (error) => {
      settleHostContact({ detail: `host contact probe failed: ${String(error?.message ?? error)}` });
    });
  }
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
    panels: () => bindings.panels.service,
    prompt: () => bindings.prompt.service,
    commands: () => bindings.commands.service,
    settings: () => bindings.settings.service,
    hostInput: () => currentHostInput(),
    rememberHostKit(kit) {
      const hook = typeof kit === "object" && kit !== null ? kit.useStdin : undefined;
      if (typeof hook !== "function")
        return false;
      const first = rememberedHook === undefined;
      rememberedHook = hook;
      hostState = { state: "bound", kit: "remembered", detail: "the host's own ui kit (handed to a scene render) carries useStdin" };
      Promise.resolve().then(wakeHostWaiters);
      if (!first)
        return true;
      try {
        (options.hostInputLog ?? defaultHostInputLog)(`[mpd-tui-adapter] host contact bound: remembered kit (a scene render handed us the host ui kit)`);
      } catch {}
      return true;
    },
    whenHostInput(listener) {
      if (hostState.state !== "pending") {
        try {
          listener(currentHostInput());
        } catch {}
        return () => {};
      }
      hostWaiters.push(listener);
      return () => {
        const at = hostWaiters.indexOf(listener);
        if (at >= 0)
          hostWaiters.splice(at, 1);
      };
    },
    registerStatusComponent(view) {
      const handle = makeHandle("status");
      whenBoundInternal("status", (service, scope) => {
        const status = service;
        if (typeof status?.registerView !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.registerView is missing on this host build` });
          return;
        }
        try {
          const disposer = status.registerView({
            key: view.key,
            component: view.component,
            ...view.maxRows === undefined ? {} : { maxRows: view.maxRows }
          }, scope);
          if (typeof disposer !== "function") {
            handle.record({ state: "refused", detail: `the host refused view ${view.key} (see its own warning for the reason)` });
            return;
          }
          effectOn(scope, disposer, view.label ?? `mpd-tui status view ${view.key}`);
          handle.record({ state: "requested", detail: `view ${view.key} requested (no host read-back)` });
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return handle;
    },
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
      whenBoundInternal("status", (service, scope) => {
        const status = service;
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` });
          return;
        }
        try {
          const disposer = status.set(key, text, scope);
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
            disposer = status.set(view.key, text, scope);
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
            status.set(view.key, undefined, scope);
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
    registerShortcut(combo, options2, identity) {
      const handle = makeHandle("shortcuts");
      whenBoundInternal("shortcuts", (service) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.shortcuts}.register is missing` });
          return;
        }
        try {
          const disposer = registry.register(combo, options2, identity ?? fallbackIdentity);
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
    registerPanel(descriptor) {
      const handle = makeHandle("panels");
      let finalId;
      let release;
      let disposed = false;
      const dispose = () => {
        if (disposed)
          return;
        disposed = true;
        const call = release;
        release = undefined;
        finalId = undefined;
        if (typeof call !== "function")
          return;
        try {
          call();
        } catch {}
      };
      whenBoundInternal("panels", (service, scope) => {
        const registry = service;
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.panels}.register is missing` });
          return;
        }
        const before = new Set((typeof registry.list === "function" ? registry.list() ?? [] : []).map((row) => row.id));
        try {
          const disposer = registry.register(descriptor, scope);
          if (typeof disposer === "function") {
            release = disposer;
            effectOn(scope, dispose, `mpd-tui panel ${descriptor.id}`);
          }
          const readBack = typeof registry.list === "function" ? registry.list.bind(registry) : undefined;
          if (readBack !== undefined) {
            finalId = (readBack() ?? []).map((row) => row.id).find((id) => !before.has(id));
          }
          handle.record(finalId !== undefined ? { state: "confirmed", detail: `${finalId} registered` } : readBack !== undefined ? { state: "refused", detail: `${descriptor.id} refused (the host added no id to its own list() read-back)` } : { state: "requested", detail: `${descriptor.id} requested (the host exposes no panel read-back to prove it)` });
          if (finalId !== undefined) {
            panelIdReadBack = readBack !== undefined ? "tuiPanels.list" : "";
            panelKeeper.observe(finalId);
          }
        } catch (error) {
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return { ...handle, id: () => finalId, dispose };
    },
    openPanel(id) {
      const handle = makeHandle("panels");
      let opened;
      whenBoundInternal("panels", (service) => {
        const registry = service;
        if (typeof registry?.open !== "function") {
          opened = false;
          handle.record({ state: "refused", detail: `${TUI_SEAMS.panels}.open is missing on this host build` });
          return;
        }
        try {
          opened = registry.open(id) === true;
          handle.record(opened ? { state: "confirmed", detail: `${id} handed to the side panel` } : { state: "refused", detail: `${id} refused (not this activation's panel, one open per 5000 ms, or no live panel consumer)` });
        } catch (error) {
          opened = false;
          handle.record({ state: "refused", detail: String(error?.message ?? error) });
        }
      });
      return { ...handle, opened: () => opened };
    },
    panelSeamBound: () => bindings.panels.bound,
    requestDecisionEvent(event, listener, options2 = {}) {
      let supported = false;
      let granted;
      let disposerReturned = false;
      let error;
      let outcome = { id: TUI_SEAMS.pluginHost, state: "absent", detail: `${TUI_SEAMS.pluginHost} was not injected` };
      whenBoundInternal("pluginHost", (service, scope) => {
        const host = service;
        const identity = options2.identity ?? fallbackIdentity;
        if (typeof host?.subscribeDecision !== "function") {
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `${TUI_SEAMS.pluginHost}.subscribeDecision is missing` };
          return;
        }
        supported = true;
        try {
          const facade = host.grants;
          if (facade !== undefined && typeof facade.allows === "function")
            granted = facade.allows(identity, event, options2.scope ?? event) === true;
        } catch {
          granted = undefined;
        }
        try {
          const disposer = host.subscribeDecision(identity, event, listener, {
            ...options2.scope === undefined ? {} : { scope: options2.scope },
            ...options2.order === undefined ? {} : { order: options2.order }
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
    registerSettingsNamespace(ns, schema, options2) {
      const handle = makeHandle("settings");
      register("settings", handle, `namespace ${ns} requested (no host read-back)`, (service) => {
        if (typeof service?.register !== "function")
          throw new Error(`${TUI_SEAMS.settings}.register is missing`);
        service.register(ns, schema, options2);
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
      return { seams, bound, total: TUI_SEAM_KEYS.length, hostInput: { ...hostState }, panelEnable: panelKeeper.outcome() };
    },
    panelEnableOutcome() {
      return panelKeeper.outcome();
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
    diagnosticSink(options2 = {}) {
      const root = options2.root ?? defaultLogRoot;
      return createFileSink({
        root,
        ...options2.name === undefined ? {} : { name: options2.name },
        ...options2.capBytes === undefined ? {} : { capBytes: options2.capBytes }
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
  return createTuiAdapter(ctx, { keepPanelEnable: true });
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
  const adapter = createTuiAdapter(ctx, { probeHostContact: true, keepPanelEnable: true });
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
  HOST_LIVE_CONTEXT_MARKER,
  HOST_PACKAGE_PATH,
  HOST_PREFS_MODULE,
  HOST_ROOT_ENV,
  HOST_UI_MODULE,
  PANEL_IDS_RECORD_NAME,
  PANEL_KEEPER_LADDER_MS,
  SERVICE_NAME,
  TUI_SEAMS,
  TUI_SEAM_KEYS,
  apply,
  createFileSink,
  createLazyTuiAdapter,
  createPanelEnableKeeper,
  createTuiAdapter,
  defaultLogRoot,
  describeOutcome,
  effectOn,
  hostRootCandidates,
  inject,
  mergePanelEnableIds,
  name,
  onService,
  panelRecordProvenance,
  probeHostInput,
  probeHostPrefs,
  readHostPackageVersion,
  readHostStdinValue,
  readableService,
  reportOutcomes,
  resolveTuiAdapter,
  serviceOf
};
