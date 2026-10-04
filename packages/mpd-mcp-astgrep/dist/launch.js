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
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
function executableSuffixes(env = process.env, platform = process.platform) {
  if (platform !== "win32")
    return [""];
  const declared = String(env.PATHEXT ?? "").split(";").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry === ".exe" || entry === ".com");
  return declared.length > 0 ? declared : [".exe", ".com"];
}
function candidateSpellings(name, env = process.env, platform = process.platform) {
  const suffixes = executableSuffixes(env, platform);
  if (suffixes.length === 1 && suffixes[0] === "")
    return [name];
  return [...suffixes.map((suffix) => name + suffix), name];
}
var AST_GREP_NAMES = ["ast-grep", "sg"];
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
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function probeAstGrep(binary) {
  try {
    const out = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000
    });
    return String(out).toLowerCase().includes("ast-grep");
  } catch {
    return false;
  }
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
function resolveAstGrepBinary(launcherUrl, opts = {}) {
  try {
    const env = opts.env ?? process.env;
    const platform = opts.platform ?? process.platform;
    const exists = opts.exists ?? existsSync;
    const probe = opts.probe ?? probeAstGrep;
    const bundleRoot = opts.bundleRoot ?? bundleRootFrom(launcherUrl);
    const candidates = [];
    const spellings = (name) => candidateSpellings(name, env, platform);
    const binDir = nonEmpty(env.MPD_AST_GREP_BIN_DIR);
    if (binDir) {
      for (const n of AST_GREP_NAMES)
        for (const s of spellings(n))
          candidates.push({ path: join2(binDir, s), source: "bin-dir" });
    }
    const pkgJson = packageJsonFor(launcherUrl, "@ast-grep/cli/package.json", opts);
    if (pkgJson) {
      const pkgDir = dirname(pkgJson);
      for (const n of AST_GREP_NAMES)
        for (const s of spellings(n))
          candidates.push({ path: join2(pkgDir, s), source: "require" });
    }
    const binDirs = [
      [join2(bundleRoot, ".toolchain", "node_modules", ".bin"), "toolchain"],
      [join2(bundleRoot, "node_modules", ".bin"), "bundle-bin"]
    ];
    for (const [bin, source] of binDirs) {
      for (const n of AST_GREP_NAMES)
        for (const s of spellings(n))
          candidates.push({ path: join2(bin, s), source });
    }
    return firstAccepted(candidates, exists, probe);
  } catch {
    return null;
  }
}

// packages/mpd-mcp-astgrep/src/launch.ts
installTerminalSilence("mpd-mcp-astgrep");
if ((process.env.MPD_AST_GREP_SG_PATH ?? "").trim().length === 0) {
  try {
    const resolved = resolveAstGrepBinary(import.meta.url);
    if (resolved)
      process.env.MPD_AST_GREP_SG_PATH = resolved.binary;
  } catch {}
}
var ADOPTED_ENTRY = "./cli.js";
await import(ADOPTED_ENTRY);
