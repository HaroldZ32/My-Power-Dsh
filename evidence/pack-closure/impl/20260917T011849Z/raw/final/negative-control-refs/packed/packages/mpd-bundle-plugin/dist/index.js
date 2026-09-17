// packages/mpd-bundle-plugin/src/watchdog-web.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
var WATCHDOG_STATE_PATH = "/plugins/mpd-team-watchdog/state";
var WATCHDOG_ACK_PATH = "/plugins/mpd-team-watchdog/ack";
var WATCHDOG_WEB_READER = "web-panel";
var DEFAULT_TEAM_STATE_DIR = join(".mpd", "team");
var MAX_ACTIVITY_RECORDS = 20;
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return;
  }
}
function watchdogDir(workspace, stateDir) {
  return join(workspace, stateDir, "watchdog");
}
function readHolds(workspace, stateDir) {
  const dir = join(watchdogDir(workspace, stateDir), "hold");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const holds = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json"))
      continue;
    const parsed = readJson(join(dir, name));
    if (parsed !== undefined && typeof parsed.id === "string" && typeof parsed.teamId === "string")
      holds.push(parsed);
  }
  return holds;
}
function readIncidents(workspace, stateDir) {
  let text;
  try {
    text = readFileSync(join(watchdogDir(workspace, stateDir), "incidents.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const raw of text.split(`
`)) {
    const line = raw.trim();
    if (line === "")
      continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.at === "number")
        out.push(parsed);
    } catch {}
  }
  return out;
}
function readWatermarks(workspace, stateDir) {
  const parsed = readJson(join(watchdogDir(workspace, stateDir), "read-watermark.json"));
  const out = {};
  if (parsed === undefined)
    return out;
  for (const [reader, value] of Object.entries(parsed))
    if (typeof value === "number")
      out[reader] = value;
  return out;
}
function readScenePointer(workspace, stateDir, teamId) {
  const path = join(watchdogDir(workspace, stateDir), "scene", teamId, "latest.json");
  return existsSync(path) ? path : null;
}
function describeCause(incident) {
  const kind = incident.cause !== null && typeof incident.cause === "object" ? String(incident.cause.kind) : "unknown";
  const ms = incident.cause !== null && typeof incident.cause === "object" ? incident.cause.ms : undefined;
  return typeof ms === "number" ? `${kind} for ${ms} ms` : kind;
}
function buildWatchdogState(options) {
  const { roots, stateDir, reader } = options;
  const errors = [];
  let held = [];
  let incidents = [];
  let watermarks = {};
  let home = null;
  for (const root of roots) {
    try {
      const rootHolds = readHolds(root, stateDir);
      const rootIncidents = readIncidents(root, stateDir);
      const rootWatermarks = readWatermarks(root, stateDir);
      if (rootHolds.length > 0 || rootIncidents.length > 0) {
        held = held.concat(rootHolds);
        incidents = incidents.concat(rootIncidents);
        watermarks = { ...rootWatermarks, ...watermarks };
        if (home === null)
          home = root;
      }
    } catch (error) {
      errors.push(`${root}: ${message(error)}`);
    }
  }
  const watermark = typeof watermarks[reader] === "number" ? watermarks[reader] : 0;
  const unreadIncidents = incidents.filter((incident) => incident.at > watermark).sort((a, b) => b.at - a.at);
  const activity = unreadIncidents.slice(0, MAX_ACTIVITY_RECORDS).map((incident) => ({
    id: incident.id,
    teamId: incident.teamId,
    kind: incident.kind,
    at: incident.at,
    label: incident.kind === "escalate" ? "escalated" : "warned",
    cause: describeCause(incident),
    ms: incident.cause !== null && typeof incident.cause === "object" && typeof incident.cause.ms === "number" ? incident.cause.ms : null,
    taskId: incident.taskId,
    attemptId: incident.attemptId,
    scene: incident.scene,
    hold: incident.hold,
    acknowledgedBy: Array.isArray(incident.acknowledgedBy) ? incident.acknowledgedBy : [],
    ackRequired: true,
    workspace: home ?? roots[0] ?? ""
  }));
  const newestHold = [...held].sort((a, b) => b.since - a.since)[0];
  const newestIncident = unreadIncidents[0];
  let banner = null;
  if (newestIncident !== undefined) {
    banner = {
      kind: newestIncident.kind === "escalate" ? "held" : "warned",
      teamId: newestIncident.teamId,
      holdId: newestHold !== undefined && newestHold.teamId === newestIncident.teamId ? newestHold.id : null,
      incidentId: newestIncident.id,
      cause: describeCause(newestIncident),
      since: newestIncident.at,
      taskId: newestIncident.taskId,
      attemptId: newestIncident.attemptId,
      scene: newestIncident.scene,
      workspace: home ?? roots[0] ?? ""
    };
  } else if (newestHold !== undefined) {
    banner = {
      kind: "held",
      teamId: newestHold.teamId,
      holdId: newestHold.id,
      incidentId: null,
      cause: newestHold.cause,
      since: newestHold.since,
      taskId: newestHold.taskId,
      attemptId: newestHold.attemptId,
      scene: readScenePointer(home ?? roots[0] ?? "", stateDir, newestHold.teamId),
      workspace: home ?? roots[0] ?? ""
    };
  }
  return {
    ok: true,
    reader,
    generatedAt: new Date(options.now === undefined ? Date.now() : options.now()).toISOString(),
    stateDir,
    workspaces: [...roots],
    workspace: home ?? roots[0] ?? null,
    stuck: held.length > 0 || unreadIncidents.length > 0,
    held,
    banner,
    activity,
    unread: unreadIncidents.map((incident) => incident.id),
    watermarks,
    replay: unreadIncidents.length > 0,
    errors
  };
}
function acknowledge(options) {
  const { workspace, stateDir, reader } = options;
  const path = join(watchdogDir(workspace, stateDir), "read-watermark.json");
  const current = readWatermarks(workspace, stateDir);
  const before = typeof current[reader] === "number" ? current[reader] : 0;
  const after = Math.max(before, Math.floor(options.upTo));
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temp = join(dirname(path), "." + basename(path) + ".tmp-" + String(process.pid));
    writeFileSync(temp, JSON.stringify({ ...current, [reader]: after }, null, 2) + `
`, "utf8");
    renameSync(temp, path);
    return { ok: true, reader, before, after, path };
  } catch (error) {
    return { ok: false, reader, before, after: before, path, error: message(error) };
  }
}
function registerWatchdogRoutes(webServer, deps) {
  const json = (res, status, body) => {
    const out = res;
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    out.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    let raw = "";
    const source = req;
    try {
      for await (const chunk of source)
        raw += String(chunk);
    } catch {
      return {};
    }
    if (raw === "")
      return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const readerOf = (req, fallback) => {
    const url = String(req.url ?? "");
    const at = url.indexOf("?");
    if (at < 0)
      return fallback;
    const query = new URLSearchParams(url.slice(at + 1));
    const value = query.get("reader");
    return value !== null && value.trim() !== "" ? value.trim() : fallback;
  };
  let state = false;
  let ack = false;
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_STATE_PATH,
      handler: (req, res) => {
        try {
          const payload = buildWatchdogState({
            roots: deps.roots(),
            stateDir: deps.stateDir(),
            reader: readerOf(req, WATCHDOG_WEB_READER)
          });
          json(res, 200, payload);
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-watchdog: internal error (${message(error)})` });
        }
      }
    }), "mpd-team-watchdog: web state route");
    state = true;
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_ACK_PATH,
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const reader = typeof body.reader === "string" && body.reader.trim() !== "" ? body.reader.trim() : readerOf(req, WATCHDOG_WEB_READER);
          const roots = deps.roots();
          const stateDir = deps.stateDir();
          const requested = typeof body.incidentTs === "number" ? body.incidentTs : undefined;
          const upTo = requested ?? Math.max(0, ...roots.flatMap((root) => readIncidents(root, stateDir).map((incident) => incident.at)));
          const target = typeof body.workspace === "string" && body.workspace !== "" ? String(body.workspace) : roots[0] ?? "";
          const result = acknowledge({ workspace: target, stateDir, reader, upTo });
          json(res, result.ok ? 200 : 500, result);
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-watchdog: internal error (${message(error)})` });
        }
      }
    }), "mpd-team-watchdog: web acknowledge route");
    ack = true;
  } catch {}
  return { state, ack };
}

// packages/mpd-bundle-plugin/src/index.ts
var name = "@mpd-dsh/mpd";
var inject = [];
function workspaceResolver(ctx) {
  const rootsAll = () => {
    try {
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined;
      const roots = typeof adapter?.workspaceRootsAll === "function" ? adapter.workspaceRootsAll() : undefined;
      if (Array.isArray(roots) && roots.length > 0) {
        return roots.filter((root2) => typeof root2 === "string" && root2 !== "");
      }
    } catch {}
    const fromEnv = typeof process.env.DSH_WORKSPACE_ROOT === "string" ? process.env.DSH_WORKSPACE_ROOT : "";
    return [fromEnv !== "" ? fromEnv : process.cwd()];
  };
  const root = () => {
    try {
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined;
      const one = typeof adapter?.workspaceRoot === "function" ? adapter.workspaceRoot() : undefined;
      if (typeof one === "string" && one !== "")
        return one;
    } catch {}
    return rootsAll()[0] ?? process.cwd();
  };
  return { workspaceRootsAll: rootsAll, workspaceRoot: root };
}
function stateDirResolver(ctx) {
  return () => {
    try {
      const config = typeof ctx?.get === "function" ? ctx.get("mpdConfig", false) : undefined;
      const value = typeof config?.get === "function" ? config.get("team.stateDir") : undefined;
      if (typeof value === "string" && value.trim() !== "")
        return value.trim();
    } catch {}
    return DEFAULT_TEAM_STATE_DIR;
  };
}
function apply(ctx) {
  let webServer;
  try {
    webServer = typeof ctx?.get === "function" ? ctx.get("webServer", false) : undefined;
  } catch {
    webServer = undefined;
  }
  if (webServer === undefined || typeof webServer.register !== "function")
    return;
  if (typeof ctx?.effect !== "function")
    return;
  const workspace = workspaceResolver(ctx);
  const result = registerWatchdogRoutes(webServer, {
    roots: () => workspace.workspaceRootsAll(),
    stateDir: stateDirResolver(ctx),
    effect: (fn, label) => ctx.effect(fn, label)
  });
  if (!result.state) {
    console.warn("[mpd] the web server refused the watchdog routes — the stuck-team banner has no data source");
  }
}
export {
  name,
  inject,
  apply,
  WATCHDOG_WEB_READER
};
