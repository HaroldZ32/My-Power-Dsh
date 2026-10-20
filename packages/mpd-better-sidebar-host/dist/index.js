// packages/mpd-better-sidebar-host/src/index.ts
import { dirname, join as join2 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { resolve as resolve2 } from "node:path";

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var LOG_SUBDIR = join(".mpd", "logs");
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_MAX_LINE_BYTES = 8192;
var DEFAULT_RING_LINES = 64;
function truncationMarker(droppedBytes) {
  return ` … [mpd log sink: ${droppedBytes} more byte(s) truncated]`;
}
function resolveLogRoots(env = process.env, cwd) {
  let working = cwd;
  if (working === undefined) {
    try {
      working = process.cwd();
    } catch {
      working = undefined;
    }
  }
  const raw = [env.MPD_MCP_LOG_DIR, env.DSH_WORKSPACE_ROOT, working, tmpdir()];
  const roots = [];
  const seen = new Set;
  for (const candidate of raw) {
    if (typeof candidate !== "string" || candidate.trim().length === 0)
      continue;
    let absolute;
    try {
      absolute = resolve(candidate);
    } catch {
      continue;
    }
    if (seen.has(absolute))
      continue;
    seen.add(absolute);
    roots.push(absolute);
  }
  return roots;
}
function tryOpenRoot(root, name) {
  try {
    const dir = join(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.log`);
    return { fd: openSync(file, "a"), file };
  } catch {
    return null;
  }
}
function owningRoot(roots, file) {
  for (const root of roots) {
    if (file === root)
      return root;
    const rel = relative(root, file);
    if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
      return root;
  }
  return null;
}
var captured = null;
function openLogSink(name, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const ringLines = options.ringLines ?? DEFAULT_RING_LINES;
  const timestamps = options.timestamps ?? true;
  const roots = options.roots ?? resolveLogRoots(options.env ?? process.env);
  let open = null;
  for (const root of roots) {
    const attempt = tryOpenRoot(root, name);
    if (attempt !== null) {
      open = attempt;
      break;
    }
  }
  let size = 0;
  if (open !== null) {
    try {
      size = statSync(open.file).size;
    } catch {
      size = 0;
    }
  }
  let accepted = 0;
  let droppedCount = 0;
  let rotations = 0;
  const ring = [];
  let undoCapture = null;
  let rebindOutcome = "skipped";
  let rebind = null;
  const remember = (record) => {
    if (ring.length >= ringLines) {
      ring.shift();
      droppedCount += 1;
    }
    ring.push(record);
  };
  const rotate = () => {
    if (open === null)
      return;
    try {
      closeSync(open.fd);
      rmSync(`${open.file}.1`, { force: true });
      renameSync(open.file, `${open.file}.1`);
      open = { fd: openSync(open.file, "a"), file: open.file };
      size = 0;
      rotations += 1;
      sink.rebindNow();
    } catch {
      try {
        open = { fd: openSync(open.file, "a"), file: open.file };
      } catch {
        open = null;
      }
    }
  };
  const append = (record) => {
    if (open === null) {
      remember(record);
      return;
    }
    const bytes = Buffer.byteLength(record, "utf8");
    if (size > 0 && size + bytes > maxBytes)
      rotate();
    if (open === null) {
      remember(record);
      return;
    }
    try {
      writeSync(open.fd, record);
      size += bytes;
    } catch {
      remember(record);
    }
  };
  const acceptedRoot = open === null ? null : owningRoot(roots, open.file);
  const sink = {
    name,
    file: open?.file ?? null,
    root: acceptedRoot,
    write(line) {
      try {
        const body = line.endsWith(`
`) ? line.slice(0, -1) : line;
        const capped = Buffer.byteLength(body, "utf8") > maxLineBytes ? capLine(body, maxLineBytes) : body;
        const record = `${timestamps ? `[${new Date().toISOString()}] ` : ""}${capped}
`;
        accepted += 1;
        append(record);
      } catch {}
    },
    fd() {
      return open?.fd ?? null;
    },
    written() {
      return accepted;
    },
    dropped() {
      return droppedCount;
    },
    rotations() {
      return rotations;
    },
    ring() {
      return [...ring];
    },
    stderrRebind() {
      return rebindOutcome;
    },
    restore() {
      if (undoCapture === null)
        return;
      undoCapture();
      undoCapture = null;
      if (captured === sink)
        captured = null;
    }
  };
  sink.attachCapture = (undo, onRebind) => {
    undoCapture = undo;
    rebind = onRebind;
  };
  sink.rebindNow = () => {
    if (rebind === null)
      return;
    rebindOutcome = rebind();
  };
  sink.setRebindOutcome = (outcome) => {
    rebindOutcome = outcome;
  };
  return sink;
}
function capLine(body, maxLineBytes) {
  const kept = Buffer.from(body, "utf8").subarray(0, maxLineBytes).toString("utf8");
  return kept + truncationMarker(Buffer.byteLength(body, "utf8") - Buffer.byteLength(kept, "utf8"));
}
// packages/mpd-dsh-adapter-plugin/src/index.ts
var DSH_SEAM_TOOLS = "tools";
var DSH_SEAM_SESSIONS = "sessions";
var DSH_SEAM_WEB_SERVER = "webServer";
var DSH_SEAM_WEB_RUNTIME = "webRuntime";
function dshSeamInject(...names) {
  return [...names];
}
function sessionCwdOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
  } catch {
    return;
  }
}
function workspaceRootOfAgent(agent) {
  const session = sessionCwdOf(agent);
  if (session !== undefined)
    return resolve2(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve2(override);
  return process.cwd();
}
function workspaceRootOf(exec) {
  if (exec?.agent !== undefined && exec?.agent !== null)
    return workspaceRootOfAgent(exec.agent);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve2(override);
  return process.cwd();
}
var rowLogSinks = new Map;
function rowLogLine(name, line) {
  try {
    const root = workspaceRootOf(undefined);
    let entry = rowLogSinks.get(name);
    if (entry === undefined || entry.root !== root) {
      entry = { root, sink: openLogSink(name, { roots: [root] }) };
      rowLogSinks.set(name, entry);
    }
    entry.sink.write(line);
  } catch {}
}
var REPORTED_RETIRED_SPAWN_FIELDS = new Set;

// packages/mpd-better-sidebar-host/src/index.ts
var DSH_SEAM_WEB_APP = "webApp";
function probeSidebarSeam(ctx) {
  const webApp = softProbe(ctx, DSH_SEAM_WEB_APP);
  const webRuntime = softProbe(ctx, DSH_SEAM_WEB_RUNTIME);
  const appTrust = trustOf(webApp);
  const runtimeTrust = trustOf(webRuntime);
  const seen = `${DSH_SEAM_WEB_APP}=${describeService(webApp, appTrust)}, ${DSH_SEAM_WEB_RUNTIME}=${describeService(webRuntime, runtimeTrust)}`;
  if (appTrust !== undefined) {
    return { armed: "none", reason: "web-app-under-another-name", detail: `${seen} — the pinned host reads ctx.${DSH_SEAM_WEB_RUNTIME} by name, so arming ${DSH_SEAM_WEB_APP} would need a context view this row does not build` };
  }
  if (runtimeTrust !== undefined) {
    return { armed: "webRuntime", service: runtimeTrust, detail: seen };
  }
  if (webApp !== undefined) {
    return { armed: "none", reason: "web-app-without-member", detail: `${seen} — 0.2.1-rc.2's WebApp declares only getAdvertisedUrl() and no bind-dependent trustedHosts` };
  }
  return { armed: "none", reason: "absent", detail: `${seen} — neither the Web GUI service nor the older Web runtime service is provided in this composition` };
}
function softProbe(ctx, name) {
  try {
    return typeof ctx?.get === "function" ? ctx.get(name, false) : undefined;
  } catch {
    return;
  }
}
function trustOf(value) {
  if (typeof value !== "object" || value === null)
    return;
  const trusted = value.trustedHosts;
  if (!Array.isArray(trusted))
    return;
  if (!trusted.every((entry) => typeof entry === "string"))
    return;
  return value;
}
function describeService(value, trust) {
  if (value === undefined)
    return "absent";
  if (trust === undefined)
    return "present without trustedHosts";
  return `present with trustedHosts(${String(trust.trustedHosts.length)})`;
}
function hostUrl() {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundleRoot = join2(here, "..", "..", "..");
  return pathToFileURL(join2(bundleRoot, "node_modules", "dsh-better-sidebar", "lib", "index.js")).href;
}
var cached;
async function loadSidebarHost() {
  if (cached !== undefined)
    return cached;
  const url = hostUrl();
  try {
    cached = await import(url);
    return cached;
  } catch (error) {
    throw new Error(`mpd-better-sidebar-host: could not import the sidebar host at ${url}: ${String(error?.message ?? error)}`);
  }
}
var name = "mpd-better-sidebar-host";
var inject = dshSeamInject(DSH_SEAM_WEB_SERVER, DSH_SEAM_SESSIONS, DSH_SEAM_TOOLS);
function say(ctx, level, line) {
  const text = "[mpd-better-sidebar] " + line;
  try {
    rowLogLine("mpd-better-sidebar", text);
  } catch {}
  try {
    const logger = ctx?.logger;
    if (level === "warn")
      logger?.warn?.(text);
    else
      logger?.info?.(text);
  } catch {}
}
function messageOf(error) {
  return String(error?.message ?? error);
}
async function mountHost(host, scoped, config) {
  try {
    await host.apply(scoped, config);
    say(scoped, "info", "seam MOUNTED: the sidebar host applied inside the injected scope");
  } catch (error) {
    say(scoped, "warn", "seam NOT mounted: the sidebar host apply failed: " + messageOf(error));
  }
}
async function apply(ctx, config) {
  const decision = probeSidebarSeam(ctx);
  if (decision.armed === "none") {
    say(ctx, "warn", `disabled: ${decision.detail} [reason=${decision.reason}]`);
    return;
  }
  say(ctx, "info", `seam ARMED (decision only; the mount is reported separately): ${DSH_SEAM_WEB_RUNTIME}.trustedHosts (${String(decision.service.trustedHosts.length)} trusted authorities); ${decision.detail}`);
  let host;
  try {
    host = await loadSidebarHost();
  } catch (error) {
    say(ctx, "warn", "disabled: " + messageOf(error));
    return;
  }
  if (typeof host.apply !== "function")
    throw new Error("mpd-better-sidebar-host: the sidebar host exports no apply()");
  if (typeof ctx.inject !== "function") {
    say(ctx, "warn", "disabled: the row context has no inject channel, so the host cannot be given its scope");
    return;
  }
  try {
    ctx.inject([DSH_SEAM_WEB_RUNTIME], (scoped) => {
      mountHost(host, scoped, config);
    });
  } catch (error) {
    say(ctx, "warn", `seam NOT mounted: could not inject ${DSH_SEAM_WEB_RUNTIME}: ${messageOf(error)}`);
  }
}
export {
  DSH_SEAM_WEB_APP,
  apply,
  inject,
  loadSidebarHost,
  name,
  probeSidebarSeam
};
