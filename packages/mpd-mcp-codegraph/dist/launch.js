#!/usr/bin/env node

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { format } from "node:util";
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
function rebindStderr(file) {
  if (process.platform === "win32")
    return "unsupported";
  try {
    closeSync(2);
  } catch {
    return "failed";
  }
  let fd;
  try {
    fd = openSync(file, "a");
  } catch {
    return "failed";
  }
  if (fd === 2)
    return "rebound";
  try {
    closeSync(fd);
  } catch {}
  return "not-lowest";
}
function owningRoot(roots, file) {
  for (const root of roots) {
    if (file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`))
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
var CAPTURED_CONSOLE_METHODS = ["error", "warn", "log", "info", "debug"];
function installTerminalSilence(name, options = {}) {
  const sink = openLogSink(name, options);
  if (captured !== null)
    return sink;
  captured = sink;
  const stderr = process.stderr;
  const hadOwnWrite = Object.prototype.hasOwnProperty.call(stderr, "write");
  const previousOwnWrite = hadOwnWrite ? stderr.write : undefined;
  const consoleTarget = console;
  const previousConsole = new Map;
  let restored = false;
  const stderrWrite = (chunk, encodingOrCallback, callback) => {
    try {
      const text = typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : String(chunk);
      sink.write(text.endsWith(`
`) ? text.slice(0, -1) : text);
    } catch {}
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (typeof done === "function") {
      try {
        done(null);
      } catch {}
    }
    return true;
  };
  stderr.write = stderrWrite;
  for (const method of CAPTURED_CONSOLE_METHODS) {
    previousConsole.set(method, consoleTarget[method]);
    consoleTarget[method] = (...args) => {
      sink.write(format(...args));
    };
  }
  sink.attachCapture(() => {
    if (restored)
      return;
    restored = true;
    if (hadOwnWrite && previousOwnWrite !== undefined)
      stderr.write = previousOwnWrite;
    else
      delete stderr.write;
    for (const [method, previous] of previousConsole)
      consoleTarget[method] = previous;
  }, () => sink.file === null ? "skipped" : rebindStderr(sink.file));
  const envBag = options.env ?? process.env;
  if (options.rebindStderr ?? envBag.MPD_MCP_STDERR_REBIND !== "0") {
    sink.rebindNow();
  } else {
    sink.setRebindOutcome("disabled");
  }
  return sink;
}

// packages/mpd-mcp-shared/bin-resolve.ts
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
function pathSpellings(name, env = process.env, platform = process.platform) {
  if (platform !== "win32")
    return [name];
  const declared = String(env.PATHEXT ?? "").split(";").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  const suffixes = declared.length > 0 ? declared : [".exe", ".com", ".cmd", ".bat"];
  return [...suffixes.map((suffix) => name + suffix), name];
}
function bundleRootFrom(launcherUrl) {
  let dir = dirname(fileURLToPath(launcherUrl));
  for (let hop = 0;hop < 6; hop++) {
    try {
      const manifest = JSON.parse(readFileSync(join2(dir, "package.json"), "utf8"));
      if (manifest.name === "@mpd-dsh/mpd")
        return dir;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return resolve2(dirname(fileURLToPath(launcherUrl)), "..", "..");
}
function packageJsonFor(launcherUrl, spec, opts) {
  try {
    if (typeof opts.requireResolve === "function")
      return opts.requireResolve(spec);
    return createRequire(launcherUrl).resolve(spec);
  } catch {
    return null;
  }
}
function normalizeBinEntry(bin, pkgDir) {
  const rel = typeof bin === "string" ? bin : bin && typeof bin === "object" ? Object.values(bin)[0] : null;
  if (typeof rel !== "string" || rel.length === 0)
    return null;
  return isAbsolute(rel) ? rel : join2(pkgDir, rel.replace(/^\.\//, ""));
}
function firstAccepted(candidates, exists, probe) {
  for (const c of candidates) {
    if (!c.path || !exists(c.path))
      continue;
    if (probe && !probe(c.path))
      continue;
    return { binary: c.path, source: c.source };
  }
  return null;
}
function resolveCodegraphBinary(launcherUrl, opts = {}) {
  try {
    const env = opts.env ?? process.env;
    const platform = opts.platform ?? process.platform;
    const exists = opts.exists ?? existsSync;
    const bundleRoot = opts.bundleRoot ?? bundleRootFrom(launcherUrl);
    const candidates = [];
    const spellings = (name) => pathSpellings(name, env, platform);
    const pkgJson = packageJsonFor(launcherUrl, "@colbymchenry/codegraph/package.json", opts);
    if (pkgJson) {
      const pkgDir = dirname(pkgJson);
      let binPath = null;
      try {
        binPath = normalizeBinEntry(JSON.parse(readFileSync(pkgJson, "utf8")).bin, pkgDir);
      } catch {
        binPath = null;
      }
      for (const p of [binPath, join2(pkgDir, "bin", "codegraph.js"), join2(pkgDir, "npm-shim.js")]) {
        if (p)
          candidates.push({ path: p, source: "require" });
      }
    }
    for (const s of spellings("codegraph")) {
      candidates.push({ path: join2(bundleRoot, ".toolchain", "node_modules", ".bin", s), source: "toolchain" });
      candidates.push({ path: join2(bundleRoot, "node_modules", ".bin", s), source: "bundle-bin" });
    }
    const seen = new Set;
    return firstAccepted(candidates.filter((c) => seen.has(c.path) ? false : (seen.add(c.path), true)), exists, null);
  } catch {
    return null;
  }
}

// packages/mpd-mcp-codegraph/daemon-policy.ts
var POLICY_ENV = "MPD_CODEGRAPH_DAEMON";
var NO_DAEMON_ENV = "CODEGRAPH_NO_DAEMON";
var TRUTHY = new Set(["1", "true", "on", "yes", "daemon", "shared"]);
var FALSY = new Set(["0", "false", "off", "no", "in-process", "inprocess", "direct"]);
function parseDaemonSetting(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "")
    return null;
  if (TRUTHY.has(value))
    return true;
  if (FALSY.has(value))
    return false;
  return;
}
function resolveDaemonPolicy(env = {}) {
  const setting = parseDaemonSetting(env[POLICY_ENV]);
  const upstream = parseDaemonSetting(env[NO_DAEMON_ENV]);
  if (upstream === true) {
    return {
      noDaemon: true,
      reason: NO_DAEMON_ENV + "=1 is set: upstream's own opt-out is respected (in-process serving)",
      warning: setting === true ? POLICY_ENV + "=1 cannot override an explicit " + NO_DAEMON_ENV + "=1" : ""
    };
  }
  if (setting === undefined) {
    return {
      noDaemon: true,
      reason: POLICY_ENV + " has an unrecognized value " + JSON.stringify(String(env[POLICY_ENV])) + " — falling back to the default (in-process); use 1 for the shared daemon or 0 for in-process",
      warning: POLICY_ENV + "=" + String(env[POLICY_ENV]) + " is not a recognized value"
    };
  }
  if (setting === true) {
    return { noDaemon: false, reason: POLICY_ENV + "=1: upstream's shared daemon is enabled explicitly", warning: "" };
  }
  if (setting === false) {
    return { noDaemon: true, reason: POLICY_ENV + "=" + String(env[POLICY_ENV]) + ": in-process serving requested explicitly", warning: "" };
  }
  return {
    noDaemon: true,
    reason: "default: one engine per session (the shared daemon's lockfile arbitration is unreliable in" + " sandboxed/namespaced hosts and upstream reaps it after 30 idle minutes, which is what logged" + ' "Shared daemon connection lost … serving this session in-process"; set ' + POLICY_ENV + "=1 to share one daemon per project root)",
    warning: ""
  };
}
function applyDaemonPolicy(env, { log } = {}) {
  const policy = resolveDaemonPolicy(env);
  let changed = false;
  if (policy.noDaemon && env[NO_DAEMON_ENV] !== "1") {
    env[NO_DAEMON_ENV] = "1";
    changed = true;
  }
  const notice = changed || policy.warning ? "[mpd-mcp-codegraph] " + (policy.warning ? policy.warning + "; " : "") + (policy.noDaemon ? "serving codegraph in-process (no shared daemon): " + policy.reason : policy.reason) : "";
  if (notice && typeof log === "function")
    log(notice);
  return { ...policy, changed, notice };
}

// packages/mpd-mcp-codegraph/src/launch.ts
installTerminalSilence("mpd-mcp-codegraph");
if ((process.env.MPD_CODEGRAPH_BIN ?? "").trim().length === 0) {
  try {
    const resolved = resolveCodegraphBinary(import.meta.url);
    if (resolved)
      process.env.MPD_CODEGRAPH_BIN = resolved.binary;
  } catch {}
}
var UNAVAILABLE_SENTINEL = "/nonexistent/mpd-codegraph-unavailable";
var daemon = applyDaemonPolicy(process.env, { log: (line) => process.stderr.write(line + `
`) });
function stderrText(error) {
  if (error instanceof Error)
    return error.stack ?? error.message;
  return String(error);
}
async function serveUnavailable(reason) {
  process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback: ${reason}
`);
  process.stderr.write(`[mpd-mcp-codegraph] codegraph is unavailable on this host: dist/serve.js failed to load (the reason is above). This row exposes no tools; fix the cause and restart the session.
`);
  process.stdin.setEncoding("utf8");
  let buffer = "";
  const send = (message) => process.stdout.write(JSON.stringify(message) + `
`);
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf(`
`)) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim() === "")
        continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      if (request.method === "initialize") {
        send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codegraph", version: "unavailable" } } });
      } else if (request.method === "tools/list") {
        send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
      } else if (request.id !== undefined) {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "codegraph is unavailable on this host" } });
      }
    }
  }
}
function stdoutIsUntouched() {
  return (process.stdout.bytesWritten ?? 0) === 0;
}
var serve = null;
try {
  const ADOPTED_SERVE_ENTRY = "./serve.js";
  serve = await import(ADOPTED_SERVE_ENTRY);
} catch (error) {
  await serveUnavailable(stderrText(error));
  process.exitCode = 0;
}
try {
  if (serve !== null)
    process.exitCode = await serve.runCodegraphServe();
} catch (error) {
  process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback: ${stderrText(error)}
`);
  if (!stdoutIsUntouched()) {
    process.stderr.write(`[mpd-mcp-codegraph] the MCP stream was already open; not retrying
`);
    process.exitCode = 1;
  } else {
    process.env.MPD_CODEGRAPH_BIN = UNAVAILABLE_SENTINEL;
    try {
      process.exitCode = await serve.runCodegraphServe();
    } catch (retryError) {
      process.stderr.write(`[mpd-mcp-codegraph] unavailable fallback failed: ${stderrText(retryError)}
`);
      process.exitCode = 1;
    }
  }
}
