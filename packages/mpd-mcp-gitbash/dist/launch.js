#!/usr/bin/env node

// packages/mpd-mcp-shared/dependency-entry.ts
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function manifestFor(path, packageName) {
  const manifest = readManifest(path);
  return manifest !== null && manifest.name === packageName ? manifest : null;
}
function ownerManifest(from, packageName) {
  let dir = dirname(resolve(from));
  for (;; ) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate) && manifestFor(candidate, packageName) !== null)
      return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
}
function walkNodeModules(startDir, packageName) {
  let dir = resolve(startDir);
  for (;; ) {
    const candidate = join(dir, "node_modules", packageName, "package.json");
    if (existsSync(candidate) && manifestFor(candidate, packageName) !== null)
      return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
}
function startDirOf(from) {
  try {
    return dirname(fileURLToPath(from));
  } catch {
    return process.cwd();
  }
}
function declaredEntry(manifest, packageDir, binName) {
  if (binName !== undefined && typeof manifest.bin === "object" && manifest.bin !== null) {
    const binMap = manifest.bin;
    if (typeof binMap[binName] === "string")
      return resolve(packageDir, binMap[binName]);
  }
  if (typeof manifest.bin === "string")
    return resolve(packageDir, manifest.bin);
  if (typeof manifest.main === "string")
    return resolve(packageDir, manifest.main);
  return null;
}
function resolveDependencyEntry(from, packageName, binName) {
  const req = createRequire(from);
  const candidates = [];
  const consider = (path) => {
    if (path !== null && !candidates.includes(path))
      candidates.push(path);
  };
  try {
    const direct = req.resolve(packageName + "/package.json");
    consider(existsSync(direct) && manifestFor(direct, packageName) !== null ? direct : null);
  } catch {}
  try {
    consider(ownerManifest(req.resolve(packageName), packageName));
  } catch {}
  consider(walkNodeModules(startDirOf(from), packageName));
  for (const manifestPath of candidates) {
    const manifest = manifestFor(manifestPath, packageName);
    if (manifest === null)
      continue;
    const entry = declaredEntry(manifest, dirname(manifestPath), binName);
    if (entry === null || !existsSync(entry))
      continue;
    return {
      packageJson: manifestPath,
      entry,
      version: typeof manifest.version === "string" ? manifest.version : "unknown"
    };
  }
  return null;
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";
import { format } from "node:util";
var LOG_SUBDIR = join2(".mpd", "logs");
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
      absolute = resolve2(candidate);
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
    const dir = join2(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join2(dir, `${name}.log`);
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

// packages/mpd-mcp-shared/unavailable-server.ts
var FALLBACK_PROTOCOL_VERSION = "2024-11-05";
async function serveUnavailable(sink, options) {
  const prefix = "[" + options.name + "] unavailable fallback: ";
  sink.write(prefix + options.reason);
  sink.write(prefix + "this row exposes NO tools until the dependency loads; fix the cause and restart the session" + (options.hint === undefined ? "" : " — " + options.hint));
  process.stdin.setEncoding("utf8");
  let buffer = "";
  const send = (message) => {
    process.stdout.write(JSON.stringify(message) + `
`);
  };
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
        send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : FALLBACK_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: options.name, version: "unavailable" }
          }
        });
      } else if (request.method === "tools/list") {
        send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
      } else if (request.id !== undefined) {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: options.name + " is unavailable on this host" } });
      }
    }
  }
}

// packages/mpd-mcp-gitbash/src/launch.ts
var SERVERS = {
  git: {
    dependency: "@cyanheads/git-mcp-server",
    bin: "git-mcp-server",
    capability: "the git_* tool family"
  },
  shell: {
    dependency: "mcp-server-commands",
    bin: "mcp-server-commands",
    capability: "run_process (raw shell execution)"
  }
};
var sink = installTerminalSilence("mpd-mcp-gitbash");
var word = process.argv[2] === "shell" ? "shell" : "git";
var spec = SERVERS[word];
var dependency = resolveDependencyEntry(import.meta.url, spec.dependency, spec.bin);
if (dependency === null) {
  await serveUnavailable(sink, {
    name: "mpd-mcp-gitbash:" + word,
    reason: "the declared dependency " + spec.dependency + " is not installed in this profile",
    hint: "install the bundle's dependency closure (npm/pnpm install) — without it this row loses " + spec.capability
  });
  process.exitCode = 0;
} else {
  sink.write("[mpd-mcp-gitbash] starting " + spec.dependency + "@" + dependency.version + " (" + word + ") from " + dependency.entry);
  const entry = dependency.entry;
  await import(entry);
}
