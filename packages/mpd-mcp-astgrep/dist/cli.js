#!/usr/bin/env node

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

// packages/mpd-mcp-astgrep/src/protocol.ts
import { createInterface } from "node:readline";

// packages/mpd-mcp-astgrep/src/server.ts
import { existsSync as existsSync2 } from "node:fs";

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

// packages/mpd-mcp-astgrep/src/runner.ts
import { spawn } from "node:child_process";
var MAX_JSON_RECORD_BYTES = 1024 * 1024;
var MAX_STDERR_BYTES = 64 * 1024;
var MAX_MCP_PAYLOAD_BYTES = 4 * 1024 * 1024;
var MAX_MATCHES = 500;
var DEFAULT_MATCHES = 50;
var DEFAULT_TIMEOUT_MS = 300000;
var MAX_TIMEOUT_MS = 300000;

class SgRunnerError extends Error {
  code;
  stderr;
  durationMs;
  constructor(code, message, stderr = "", durationMs = 0) {
    super(message);
    this.name = "SgRunnerError";
    this.code = code;
    this.stderr = stderr;
    this.durationMs = durationMs;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes)
    return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 192) === 128)
    end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
function decodeStderr(bytes) {
  let start = bytes.length - 1;
  while (start >= 0 && (bytes[start] & 192) === 128 && bytes.length - start <= 3)
    start -= 1;
  const lead = bytes[start];
  const width = lead >= 194 && lead <= 223 ? 2 : lead >= 224 && lead <= 239 ? 3 : lead >= 240 && lead <= 244 ? 4 : 1;
  const complete = start >= 0 && width > bytes.length - start ? bytes.subarray(0, start) : bytes;
  return truncateUtf8(new TextDecoder().decode(complete), MAX_STDERR_BYTES);
}
async function spawnSgRunner(input) {
  const startedAt = performance.now();
  if (input.signal?.aborted)
    throw new SgRunnerError("ABORTED", "ast-grep request was aborted");
  return await new Promise((resolve3, reject) => {
    const maxMatches = input.maxMatches ?? DEFAULT_MATCHES;
    const child = spawn(input.sgPath, [...input.args], {
      cwd: input.workdir,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const records = [];
    let serializedRecordsBytes = 2;
    const stderrChunks = [];
    let stderrBytes = 0;
    let stderrLinePrefix = "";
    let hasSgErrorDiagnostic = false;
    let pending = Buffer.alloc(0);
    let malformed = false;
    let fatalError = null;
    let stopReason = null;
    let truncationReason = null;
    let killTimer;
    let settled = false;
    const duration = () => Math.max(0, Math.round(performance.now() - startedAt));
    const stderrText = () => decodeStderr(Buffer.concat(stderrChunks));
    const stop = (reason) => {
      if (stopReason === null)
        stopReason = reason;
      if (child.exitCode !== null || child.signalCode !== null)
        return;
      if (process.platform === "win32") {
        child.kill();
        return;
      }
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 1000);
      killTimer.unref();
    };
    const failOutput = (code) => {
      fatalError ??= code;
      stop("limit");
    };
    const parseLine = (line) => {
      const value = line.length > 0 && line[line.length - 1] === 13 ? line.subarray(0, -1) : line;
      if (value.length === 0)
        return true;
      if (value.length > MAX_JSON_RECORD_BYTES) {
        failOutput("OUTPUT_TOO_LARGE");
        return false;
      }
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(value);
      } catch {
        failOutput("ENCODING_ERROR");
        return false;
      }
      try {
        const parsed = JSON.parse(text);
        if (!isRecord(parsed))
          throw new Error("record is not an object");
        const serializedBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8");
        const nextAggregateBytes = serializedRecordsBytes + serializedBytes + (records.length > 0 ? 1 : 0);
        if (nextAggregateBytes > MAX_MCP_PAYLOAD_BYTES) {
          truncationReason = "output_cap";
          stop("limit");
          child.stdout.pause();
          return false;
        }
        records.push(parsed);
        serializedRecordsBytes = nextAggregateBytes;
        if (records.length > maxMatches) {
          records.length = maxMatches;
          truncationReason = "match_limit";
          stop("limit");
          child.stdout.pause();
          return false;
        }
      } catch {
        malformed = true;
      }
      return true;
    };
    const timeout = setTimeout(() => stop("timeout"), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeout.unref();
    const onAbort = () => stop("abort");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (stopReason === "limit")
        return;
      pending = Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        if (!parseLine(line))
          return;
        newline = pending.indexOf(10);
      }
      if (pending.length > MAX_JSON_RECORD_BYTES)
        failOutput("OUTPUT_TOO_LARGE");
    });
    child.stderr.on("data", (chunk) => {
      if (!hasSgErrorDiagnostic) {
        for (const byte of chunk) {
          if (byte === 10 || byte === 13) {
            stderrLinePrefix = "";
          } else if (stderrLinePrefix.length < 80) {
            stderrLinePrefix += String.fromCharCode(byte);
            if (/^[\t ]*(?:ERROR\b|error:)/.test(stderrLinePrefix))
              hasSgErrorDiagnostic = true;
          }
        }
      }
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      if (remaining <= 0)
        return;
      const kept = chunk.subarray(0, remaining);
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });
    child.once("error", (error) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer)
        clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(new SgRunnerError("SG_FAILED", error.message, stderrText(), duration()));
    });
    child.once("close", (exitCode) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer)
        clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      const stderr = stderrText();
      if (stopReason === "abort")
        return reject(new SgRunnerError("ABORTED", "ast-grep request was aborted", stderr, duration()));
      if (stopReason === "timeout")
        return reject(new SgRunnerError("TIMEOUT", "ast-grep request timed out", stderr, duration()));
      if (fatalError)
        return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()));
      if (stopReason !== "limit" && pending.length > 0)
        parseLine(pending);
      if (fatalError)
        return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()));
      const failedExit = exitCode !== 0 && exitCode !== 1;
      const diagnosedExitOne = exitCode === 1 && hasSgErrorDiagnostic;
      if (stopReason === null && (failedExit || diagnosedExitOne)) {
        return reject(new SgRunnerError("SG_FAILED", `ast-grep exited with code ${exitCode ?? "unknown"}`, stderr, duration()));
      }
      if (malformed && records.length === 0)
        return reject(new SgRunnerError("OUTPUT_PARSE_FAILED", "ast-grep produced no parseable JSON records", stderr, duration()));
      const limited = stopReason === "limit" && truncationReason !== null;
      const salvaged = malformed && records.length > 0;
      resolve3({
        records,
        truncated: limited || salvaged,
        reason: limited ? truncationReason : salvaged ? "sg_output_truncated" : null,
        salvagedRecords: salvaged ? records.length : 0,
        stderr,
        durationMs: duration(),
        atLeastMatches: limited ? records.length + 1 : records.length,
        maxPayloadBytes: MAX_MCP_PAYLOAD_BYTES,
        exitCode
      });
    });
  });
}

// packages/mpd-mcp-astgrep/src/normalize.ts
import { posix, win32 } from "node:path";
function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`Invalid ${label}`);
  return value;
}
function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`Invalid ${label}`);
  return value;
}
function point(raw, byteOffset) {
  const value = object(raw, "range point");
  return {
    line: number(value.line, "line") + 1,
    column: number(value.column, "column"),
    byteOffset: number(byteOffset, "byte offset")
  };
}
function slash(value) {
  return value.replaceAll("\\", "/");
}
function isWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function stablePath(file, workdir) {
  if (isWindowsPath(file) || isWindowsPath(workdir)) {
    const root2 = win32.resolve(workdir);
    const absolute2 = win32.resolve(root2, file);
    const relative2 = win32.relative(root2, absolute2);
    const inside2 = relative2 === "" || !relative2.startsWith("..\\") && relative2 !== ".." && !win32.isAbsolute(relative2);
    return slash(inside2 ? relative2 || "." : absolute2);
  }
  const root = posix.resolve(workdir);
  const absolute = posix.resolve(root, file);
  const relative = posix.relative(root, absolute);
  const inside = relative === "" || !relative.startsWith("../") && relative !== ".." && !posix.isAbsolute(relative);
  return inside ? relative || "." : absolute;
}
function nodeText(value) {
  if (typeof value === "string")
    return value;
  const node = object(value, "metavariable node");
  return typeof node.text === "string" ? node.text : "";
}
function nodeByteRange(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const range = object(value.range, "metavariable range");
  const bytes = object(range.byteOffset, "metavariable byte range");
  return typeof bytes.start === "number" && typeof bytes.end === "number" ? { start: bytes.start, end: bytes.end } : null;
}
function normalizeMetavariables(raw, text, matchStart) {
  const meta = raw === undefined ? {} : object(raw, "metaVariables");
  const singles = meta.single === undefined ? {} : object(meta.single, "single metavariables");
  const multis = meta.multi === undefined ? {} : object(meta.multi, "multi metavariables");
  const single = {};
  const multi = {};
  for (const [name, value] of Object.entries(singles))
    single[name] = nodeText(value);
  for (const [name, value] of Object.entries(multis)) {
    if (!Array.isArray(value) || value.length === 0) {
      multi[name] = "";
      continue;
    }
    const first = nodeByteRange(value[0]);
    const last = nodeByteRange(value[value.length - 1]);
    const bytes = Buffer.from(text, "utf8");
    const start = (first?.start ?? matchStart) - matchStart;
    const end = (last?.end ?? matchStart) - matchStart;
    multi[name] = start >= 0 && end >= start && end <= bytes.length ? new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end)) : value.map(nodeText).join("");
  }
  return { single, multi };
}
function normalizeMatch(rawValue, workdir) {
  const raw = object(rawValue, "ast-grep record");
  const text = typeof raw.text === "string" ? raw.text : "";
  const file = typeof raw.file === "string" ? raw.file : "";
  const range = object(raw.range, "range");
  const bytes = object(range.byteOffset, "byte range");
  const startByte = number(bytes.start, "start byte offset");
  const normalized = {
    path: stablePath(file, workdir),
    ...typeof raw.language === "string" ? { language: raw.language.toLowerCase() } : {},
    text,
    range: {
      start: point(range.start, startByte),
      end: point(range.end, number(bytes.end, "end byte offset"))
    },
    metavariables: normalizeMetavariables(raw.metaVariables, text, startByte)
  };
  const consumed = new Set(["text", "range", "file", "lines", "language", "metaVariables", "charCount", "transformed"]);
  for (const [key, value] of Object.entries(raw))
    if (!consumed.has(key))
      normalized[key] = value;
  return normalized;
}
function normalizeRecords(records, workdir) {
  return records.map((record) => normalizeMatch(record, workdir)).sort((left, right) => {
    const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    return pathOrder || left.range.start.byteOffset - right.range.start.byteOffset;
  });
}

// packages/mpd-mcp-astgrep/src/hints.ts
var LANGUAGES = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
]);
var LANG_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  py: "python",
  py3: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  ex: "elixir",
  hs: "haskell",
  sh: "bash",
  zsh: "bash",
  cc: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  cs: "csharp",
  yml: "yaml",
  sol: "solidity",
  golang: "go"
};
var RE_BACKSLASH = /\\w|\\d|\\s|\\b/;
var RE_DOT_STAR = /(?<!\$)\.\*|(?<!\$)\.\+/;
var RE_DOUBLE_DOLLAR = /(?<!\$)\$\$(?!\$)[A-Za-z_]/;
var RE_ANY_METAVAR = /(?<!\$)\$(?!\$)([A-Za-z_][A-Za-z0-9_]*)/g;
var RE_PY_TRAILING_COLON = /^\s*(?:def|class)\s+\$?\w+[^:]*:\s*$/m;
var RE_JS_INCOMPLETE = /^\s*(?:async\s+)?function\s+\$?\w+(?:\([^)]*\))?\s*$/m;
var RE_GO_INCOMPLETE = /^\s*func\s+\$?\w+(?:\([^)]*\))?\s*$/m;
var RE_RUST_INCOMPLETE = /^\s*fn\s+\$?\w+(?:\([^)]*\))?\s*$/m;
function isRegexCharClass(pattern) {
  const trimmed = pattern.trim();
  if (!/^\[\^?[^\]]+\]$/.test(trimmed))
    return false;
  const inner = trimmed.replace(/^\[\^?/, "").replace(/\]$/, "");
  if (inner.includes(","))
    return false;
  if (/[a-zA-Z0-9]-[a-zA-Z0-9]/.test(inner))
    return true;
  if (/^\[\^/.test(trimmed))
    return true;
  if (/[_. ]/.test(inner))
    return true;
  return false;
}
function normalizeLanguage(lang) {
  const lower = lang.toLowerCase();
  const canonical = LANG_ALIASES[lower] ?? lower;
  return LANGUAGES.has(canonical) ? canonical : null;
}
function findAlternation(pattern) {
  const stripped = pattern.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "");
  if (stripped.includes("||"))
    return false;
  return /(?:\w|\$\w+|\w+\(\))\s*\|\s*(?:\w|\$\w+|\w+\(\))/.test(stripped);
}
function isValidPaths(paths) {
  if (!Array.isArray(paths))
    return false;
  if (paths.length === 0)
    return false;
  return paths.every((path) => typeof path === "string" && path.length > 0);
}
function isValidLimit(limit) {
  return typeof limit === "number" && Number.isFinite(limit) && Number.isInteger(limit) && limit > 0;
}
function extractMetavars(text) {
  const single = new Set;
  const multi = new Set;
  let m;
  const reMulti = /\$\$\$([A-Z][A-Z0-9_]*)/g;
  while ((m = reMulti.exec(text)) !== null) {
    multi.add(m[1]);
  }
  const reSingle = /(?<!\$)\$(?!\$)([A-Z][A-Z0-9_]*)/g;
  while ((m = reSingle.exec(text)) !== null) {
    single.add(m[1]);
  }
  return { single, multi };
}
function validatePatternHints(pattern, language, opts = {}) {
  const force = opts.force ?? false;
  const hints = [];
  if (pattern.trim().length === 0) {
    hints.push({ code: "PATTERN_EMPTY", severity: "always-reject", message: "Pattern is empty." });
  }
  const canonical = normalizeLanguage(language);
  if (canonical === null) {
    hints.push({
      code: "LANGUAGE_UNSUPPORTED",
      severity: "always-reject",
      message: `Language '${language}' is not supported. Use one of the 25 ast-grep languages.`
    });
  }
  if (opts.paths !== undefined && !isValidPaths(opts.paths)) {
    hints.push({ code: "INVALID_PATH", severity: "always-reject", message: "Paths must be a non-empty array of non-empty strings." });
  }
  if (opts.limit !== undefined && !isValidLimit(opts.limit)) {
    hints.push({ code: "INVALID_LIMIT", severity: "always-reject", message: "Limit must be a positive finite integer." });
  }
  const alwaysReject = hints.find((hint) => hint.severity === "always-reject");
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints };
  }
  if (RE_BACKSLASH.test(pattern)) {
    hints.push({
      code: "REGEX_BACKSLASH_ESCAPE",
      severity: "reject",
      message: "Backslash escapes (\\w, \\d, \\s, \\b) are regex, not ast-grep. Use $VAR for identifiers."
    });
  }
  if (RE_DOT_STAR.test(pattern)) {
    hints.push({
      code: "REGEX_DOT_STAR",
      severity: "reject",
      message: "'.*' and '.+' are regex wildcards. Use $$$ for multiple nodes or $VAR for one."
    });
  }
  if (isRegexCharClass(pattern)) {
    hints.push({
      code: "REGEX_CHAR_CLASS",
      severity: "reject",
      message: "Character classes like [a-z] are regex syntax. ast-grep has no AST equivalent."
    });
  }
  if (canonical === "python" && RE_PY_TRAILING_COLON.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Python pattern has trailing ':'. Drop the colon: 'def $FUNC($$$)' or 'class $C($$$)'."
    });
  }
  if ((canonical === "javascript" || canonical === "typescript" || canonical === "tsx") && RE_JS_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "JS/TS function pattern is incomplete. Add params and body: 'function $NAME($$$) { $$$ }'."
    });
  }
  if (canonical === "go" && RE_GO_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Go function pattern is incomplete. Add params and body: 'func $NAME($$$) { $$$ }'."
    });
  }
  if (canonical === "rust" && RE_RUST_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Rust fn pattern is incomplete. Add params and body: 'fn $NAME($$$) -> $RET { $$$ }'."
    });
  }
  if (RE_DOUBLE_DOLLAR.test(pattern)) {
    hints.push({
      code: "METAVAR_DOUBLE_DOLLAR",
      severity: "reject",
      message: "$$NAME is invalid. Use $$$NAME for multi-node capture or $NAME for single."
    });
  }
  let m;
  RE_ANY_METAVAR.lastIndex = 0;
  while ((m = RE_ANY_METAVAR.exec(pattern)) !== null) {
    const name = m[1];
    if (name === "_")
      continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      hints.push({
        code: "INVALID_METAVAR_NAME",
        severity: "reject",
        message: `Metavariable name $${name} must be UPPERCASE (e.g. $${name.toUpperCase()}) or use $_ for wildcard.`
      });
      break;
    }
  }
  if (findAlternation(pattern)) {
    hints.push({
      code: "BARE_ALTERNATION",
      severity: "warn",
      message: "Literal '|' may be a TS union or bitwise-or. If regex alternation, use separate calls."
    });
  }
  const hardReject = hints.find((hint) => hint.severity === "reject");
  if (hardReject && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints };
  }
  return { ok: true, rejected: false, code: null, hints };
}
function validateRewriteHints(pattern, rewrite, language, opts = {}) {
  const force = opts.force ?? false;
  const patternResult = validatePatternHints(pattern, language, opts);
  const hints = [...patternResult.hints];
  if (patternResult.rejected && patternResult.code !== "PATTERN_HINT_REJECTED") {
    return patternResult;
  }
  const pm = extractMetavars(pattern);
  const rm = extractMetavars(rewrite);
  const patternNames = new Set([...pm.single, ...pm.multi]);
  const rewriteNames = new Set([...rm.single, ...rm.multi]);
  for (const name of rewriteNames) {
    if (!patternNames.has(name)) {
      hints.push({
        code: "REWRITE_UNBOUND_METAVARIABLE",
        severity: "always-reject",
        message: `Rewrite uses metavariable $${name} not captured by pattern.`
      });
      break;
    }
  }
  for (const name of rewriteNames) {
    if (!patternNames.has(name))
      continue;
    const pSingle = pm.single.has(name);
    const pMulti = pm.multi.has(name);
    const rSingle = rm.single.has(name);
    const rMulti = rm.multi.has(name);
    if (pSingle && !pMulti && rMulti && !rSingle || pMulti && !pSingle && rSingle && !rMulti) {
      hints.push({
        code: "REWRITE_CARDINALITY_MISMATCH",
        severity: "always-reject",
        message: `Metavariable ${name} cardinality mismatch between pattern and rewrite.`
      });
      break;
    }
  }
  const alwaysReject = hints.find((hint) => hint.severity === "always-reject");
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints };
  }
  if (patternResult.rejected && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints };
  }
  return { ok: true, rejected: false, code: null, hints };
}

// packages/mpd-mcp-astgrep/src/search.ts
var MAX_PATTERN_BYTES = 16 * 1024;
var MAX_GLOBS = 32;
var MAX_PATHS = 64;
var MIN_TIMEOUT_MS = 1000;
var MAX_PATH_LEN = 4096;
var MAX_GLOB_LEN = 1024;
var MAX_SELECTOR_LEN = 128;
var MAX_WORKDIR_LEN = 4096;
var SEARCH_TOOL_NAME = "search";
var SEARCH_TOOL_DESCRIPTION = "Search code by syntax shape with ast-grep. Write the pattern as code, not as a regular expression, and make it parse as ONE AST node in the required language; keep `paths` narrow. `$NAME` and `$_` capture a single whole node, `$$$NAME` and `$$$` capture zero or more nodes; a capture name must be UPPERCASE (`$$NAME` is invalid), a partial token never captures, and repeating a name requires identical code in every position. Wrap syntax that cannot stand alone, or name a `selector` to match a sub-node. A parse warning means the query failed — it does not mean the code is absent.";
var LANGUAGES2 = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
];
var STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"];

class SearchArgumentError extends Error {
  language;
  constructor(message, language) {
    super(message);
    this.name = "SearchArgumentError";
    this.language = language;
  }
}
function codePoints(value) {
  let count = 0;
  for (const _ of value)
    count++;
  return count;
}
function parseSearchInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SearchArgumentError("Input must be an object", "unknown");
  }
  const obj = input;
  const language = typeof obj.language === "string" ? obj.language : "unknown";
  if (typeof obj.pattern !== "string")
    throw new SearchArgumentError("pattern must be a string", language);
  if (obj.pattern.length === 0)
    throw new SearchArgumentError("pattern must be at least 1 character", language);
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES) {
    throw new SearchArgumentError("pattern must be at most 16384 bytes", language);
  }
  if (typeof obj.language !== "string" || !LANGUAGES2.includes(obj.language)) {
    throw new SearchArgumentError(`language must be one of: ${LANGUAGES2.join(", ")}`, language);
  }
  if (!Array.isArray(obj.paths))
    throw new SearchArgumentError("paths must be an array", language);
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) {
    throw new SearchArgumentError(`paths must have 1-${MAX_PATHS} entries`, language);
  }
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0)
      throw new SearchArgumentError("each path must be a non-empty string", language);
    if (codePoints(path) > MAX_PATH_LEN)
      throw new SearchArgumentError(`each path must be at most ${MAX_PATH_LEN} characters`, language);
  }
  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string")
      throw new SearchArgumentError("workdir must be a string", language);
    if (obj.workdir.length === 0)
      throw new SearchArgumentError("workdir must be at least 1 character", language);
    if (codePoints(obj.workdir) > MAX_WORKDIR_LEN)
      throw new SearchArgumentError(`workdir must be at most ${MAX_WORKDIR_LEN} characters`, language);
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs))
      throw new SearchArgumentError("globs must be an array", language);
    if (obj.globs.length > MAX_GLOBS)
      throw new SearchArgumentError(`globs must have at most ${MAX_GLOBS} entries`, language);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0)
        throw new SearchArgumentError("each glob must be a non-empty string", language);
      if (codePoints(glob) > MAX_GLOB_LEN)
        throw new SearchArgumentError(`each glob must be at most ${MAX_GLOB_LEN} characters`, language);
    }
  }
  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string")
      throw new SearchArgumentError("selector must be a string", language);
    if (obj.selector.length === 0)
      throw new SearchArgumentError("selector must be at least 1 character", language);
    if (codePoints(obj.selector) > MAX_SELECTOR_LEN)
      throw new SearchArgumentError(`selector must be at most ${MAX_SELECTOR_LEN} characters`, language);
  }
  let strictness = "smart";
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !STRICTNESS.includes(obj.strictness)) {
      throw new SearchArgumentError(`strictness must be one of: ${STRICTNESS.join(", ")}`, language);
    }
    strictness = obj.strictness;
  }
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      throw new SearchArgumentError(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`, language);
    }
    maxMatches = obj.maxMatches;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS || obj.timeoutMs > MAX_TIMEOUT_MS) {
      throw new SearchArgumentError(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`, language);
    }
    timeoutMs = obj.timeoutMs;
  }
  if (obj.includeHidden !== undefined && typeof obj.includeHidden !== "boolean") {
    throw new SearchArgumentError("includeHidden must be a boolean", language);
  }
  if (obj.followSymlinks !== undefined && typeof obj.followSymlinks !== "boolean") {
    throw new SearchArgumentError("followSymlinks must be a boolean", language);
  }
  if (obj.force !== undefined && typeof obj.force !== "boolean") {
    throw new SearchArgumentError("force must be a boolean", language);
  }
  const known = new Set([
    "pattern",
    "language",
    "paths",
    "workdir",
    "globs",
    "selector",
    "strictness",
    "maxMatches",
    "timeoutMs",
    "includeHidden",
    "followSymlinks",
    "force"
  ]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key))
      throw new SearchArgumentError(`Unknown property: ${key}`, language);
  }
  return {
    pattern: obj.pattern,
    language: obj.language,
    paths: obj.paths,
    workdir: obj.workdir,
    globs: obj.globs,
    selector: obj.selector,
    strictness,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden,
    followSymlinks: obj.followSymlinks,
    force: obj.force
  };
}
function buildSearchArgs(input) {
  const args = ["run", "-p", input.pattern, "--lang", input.language, "--json=stream"];
  args.push("--strictness", input.strictness ?? "smart");
  if (input.selector)
    args.push("--selector", input.selector);
  if (input.globs)
    for (const glob of input.globs)
      args.push("--globs", glob);
  if (input.includeHidden)
    args.push("--no-ignore", "hidden");
  if (input.followSymlinks)
    args.push("--follow");
  args.push(...input.paths);
  return args;
}
var RETRYABLE_CODES = new Set([
  "TIMEOUT",
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW"
]);
var ERROR_NODE_RE = /Pattern contains an ERROR node/i;
function detectPatternParseFailure(stderr) {
  return ERROR_NODE_RE.test(stderr);
}
function makeError(code, message, language, phase, stderr, hint, durationMs) {
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      message,
      retryable: RETRYABLE_CODES.has(code),
      phase,
      language,
      details: { stderr, hint }
    }
  };
}
var LIMIT_WARNING = "Result limit reached; narrow paths or globs.";
async function executeSearch(input, sgPath, signal) {
  const startedAt = performance.now();
  const workdir = input.workdir ?? process.cwd();
  const maxMatches = input.maxMatches ?? DEFAULT_MATCHES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const validation = validatePatternHints(input.pattern, input.language, {
    force: input.force,
    paths: input.paths,
    limit: maxMatches
  });
  if (validation.rejected) {
    const rejectHint = validation.hints.find((hint) => hint.severity === "always-reject" || hint.severity === "reject");
    return makeError(validation.code ?? "INVALID_ARGUMENT", rejectHint?.message ?? "Pattern validation failed", input.language, "preflight", "", validation.hints.map((hint) => hint.message).join("; "), Math.round(performance.now() - startedAt));
  }
  const args = buildSearchArgs(input);
  let runnerResult;
  try {
    runnerResult = await spawnSgRunner({
      sgPath,
      args,
      workdir,
      maxMatches,
      timeoutMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return makeError(error.code, error.message, input.language, "search", error.stderr, "", error.durationMs);
    }
    return makeError("SG_FAILED", error instanceof Error ? error.message : String(error), input.language, "search", "", "", Math.round(performance.now() - startedAt));
  }
  if (detectPatternParseFailure(runnerResult.stderr)) {
    return makeError("PATTERN_PARSE_FAILED", "Pattern did not parse as one " + input.language + " AST node.", input.language, "search", runnerResult.stderr, "Use a complete function, call, declaration, or wrapped context.", runnerResult.durationMs);
  }
  const warnings = validation.hints.map((hint) => hint.message);
  const matches = normalizeRecords(runnerResult.records, workdir);
  const fileSet = new Set(matches.map((match) => match.path));
  const returnedFiles = fileSet.size;
  const truncated = runnerResult.truncated;
  const reason = runnerResult.reason;
  const totalMatches = truncated ? null : matches.length;
  const totalFiles = truncated ? null : returnedFiles;
  if (truncated) {
    warnings.push(LIMIT_WARNING);
  }
  return {
    schemaVersion: 1,
    ok: true,
    kind: "search",
    workdir,
    matches,
    counts: {
      returnedMatches: matches.length,
      returnedFiles,
      totalMatches,
      totalFiles,
      atLeastMatches: runnerResult.atLeastMatches
    },
    truncation: {
      truncated,
      reason,
      maxMatches,
      maxPayloadBytes: runnerResult.maxPayloadBytes,
      salvagedRecords: runnerResult.salvagedRecords
    },
    warnings,
    durationMs: runnerResult.durationMs
  };
}

// packages/mpd-mcp-astgrep/src/rewrite.ts
var MAX_PATTERN_BYTES2 = 16 * 1024;
var MAX_REWRITE_BYTES = 64 * 1024;
var MAX_PATHS2 = 64;
var MAX_PATH_CHARS = 4096;
var MAX_GLOBS2 = 32;
var MAX_GLOB_CHARS = 1024;
var MAX_SELECTOR_CHARS = 128;
var MAX_WORKDIR_CHARS = 4096;
var MIN_TIMEOUT_MS2 = 1000;
var REWRITE_TOOL_NAME = "rewrite";
var REWRITE_TOOL_DESCRIPTION = "Preview an AST-aware rewrite, or apply it. The pattern obeys the same metavariable rules as `search`; the replacement may reference only metavariables the pattern captured, and an EMPTY replacement deletes the match. Nothing is written unless `apply` is true, and a truncated preview is refused rather than applied — narrow `paths` or raise `maxMatches`, then retry. Applying is two passes (a JSON preview, then a separate `--update-all` run), so the reported counts describe the preview, and a second apply is not guaranteed to be a no-op.";
var APPLY_PREVIEW_WARNING = "Mutation counts are based on the preview pass; sg update-all does not return equivalent JSON.";
var LANGUAGES3 = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
];
var STRICTNESS2 = ["cst", "smart", "ast", "relaxed", "signature"];
function codePointLength(value) {
  return [...value].length;
}
var KNOWN_KEYS = new Set([
  "pattern",
  "rewrite",
  "language",
  "paths",
  "workdir",
  "globs",
  "selector",
  "strictness",
  "apply",
  "maxMatches",
  "timeoutMs",
  "includeHidden",
  "followSymlinks",
  "force"
]);
function parseRewriteInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  const obj = input;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key))
      throw new Error(`Unknown property: ${key}`);
  }
  if (typeof obj.pattern !== "string" || obj.pattern.length === 0)
    throw new Error("pattern must be a non-empty string");
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES2)
    throw new Error("pattern must be at most 16KiB");
  if (typeof obj.rewrite !== "string")
    throw new Error("rewrite must be a string");
  if (Buffer.byteLength(obj.rewrite, "utf8") > MAX_REWRITE_BYTES)
    throw new Error("rewrite must be at most 64KiB");
  if (typeof obj.language !== "string" || !LANGUAGES3.includes(obj.language)) {
    throw new Error(`language must be one of: ${LANGUAGES3.join(", ")}`);
  }
  if (!Array.isArray(obj.paths))
    throw new Error("paths must be an array");
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS2)
    throw new Error(`paths must have 1-${MAX_PATHS2} entries`);
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0)
      throw new Error("each path must be a non-empty string");
    if (codePointLength(path) > MAX_PATH_CHARS) {
      throw new Error(`each path must be at most ${MAX_PATH_CHARS} characters`);
    }
  }
  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string" || obj.workdir.length === 0) {
      throw new Error("workdir must be a non-empty string");
    }
    if (codePointLength(obj.workdir) > MAX_WORKDIR_CHARS) {
      throw new Error(`workdir must be at most ${MAX_WORKDIR_CHARS} characters`);
    }
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs))
      throw new Error("globs must be an array");
    if (obj.globs.length > MAX_GLOBS2)
      throw new Error(`globs must have at most ${MAX_GLOBS2} entries`);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0)
        throw new Error("each glob must be a non-empty string");
      if (codePointLength(glob) > MAX_GLOB_CHARS) {
        throw new Error(`each glob must be at most ${MAX_GLOB_CHARS} characters`);
      }
    }
  }
  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string" || obj.selector.length === 0) {
      throw new Error("selector must be a non-empty string");
    }
    if (codePointLength(obj.selector) > MAX_SELECTOR_CHARS) {
      throw new Error(`selector must be at most ${MAX_SELECTOR_CHARS} characters`);
    }
  }
  let strictness = "smart";
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !STRICTNESS2.includes(obj.strictness)) {
      throw new Error(`strictness must be one of: ${STRICTNESS2.join(", ")}`);
    }
    strictness = obj.strictness;
  }
  if (obj.apply !== undefined && typeof obj.apply !== "boolean")
    throw new Error("apply must be a boolean");
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`);
    }
    maxMatches = obj.maxMatches;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS2 || obj.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS2} and ${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = obj.timeoutMs;
  }
  for (const flag of ["includeHidden", "followSymlinks", "force"]) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean")
      throw new Error(`${flag} must be a boolean`);
  }
  return {
    pattern: obj.pattern,
    rewrite: obj.rewrite,
    language: obj.language,
    paths: obj.paths,
    workdir: obj.workdir,
    globs: obj.globs,
    selector: obj.selector,
    strictness,
    apply: obj.apply ?? false,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden,
    followSymlinks: obj.followSymlinks,
    force: obj.force
  };
}
function scopeArgs(input) {
  const args = ["--strictness", input.strictness];
  if (input.selector)
    args.push("--selector", input.selector);
  if (input.globs)
    for (const glob of input.globs)
      args.push("--globs", glob);
  if (input.includeHidden)
    args.push("--no-ignore", "hidden");
  if (input.followSymlinks)
    args.push("--follow");
  return args;
}
function baseArgs(input) {
  return ["run", "-p", input.pattern, "-r", input.rewrite, "--lang", input.language];
}
function buildRewriteArgs(input) {
  return [...baseArgs(input), "--json=stream", ...scopeArgs(input), ...input.paths];
}
function buildRewriteApplyArgs(input) {
  return [...baseArgs(input), "--update-all", ...scopeArgs(input), ...input.paths];
}
var RETRYABLE = new Set([
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW",
  "TIMEOUT"
]);
var ERROR_NODE_RE2 = /Pattern contains an ERROR node/i;
function failure(code, message, phase, language, durationMs, details = {}) {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "rewrite",
    error: { code, message, retryable: RETRYABLE.has(code), phase, language, details },
    durationMs
  };
}
function toRewriteMatches(records, workdir) {
  return normalizeRecords(records, workdir).map((match) => ({
    ...match,
    replacement: typeof match.replacement === "string" ? match.replacement : ""
  }));
}
function preflightCode(code) {
  switch (code) {
    case "REWRITE_UNBOUND_METAVARIABLE":
      return "REWRITE_UNBOUND_METAVARIABLE";
    case "REWRITE_CARDINALITY_MISMATCH":
      return "REWRITE_METAVARIABLE_KIND_MISMATCH";
    case "LANGUAGE_UNSUPPORTED":
      return "UNSUPPORTED_LANGUAGE";
    case "PATTERN_HINT_REJECTED":
      return "PATTERN_HINT_REJECTED";
    default:
      return "INVALID_ARGUMENT";
  }
}
async function executeRewrite(rawInput, sgPath, signal, hooks) {
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  let input;
  try {
    input = parseRewriteInput(rawInput);
  } catch (error) {
    return failure("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), "preflight", typeof rawInput?.language === "string" ? rawInput.language : "unknown", elapsed());
  }
  const workdir = input.workdir ?? process.env.MPD_AST_GREP_PROJECT_CWD ?? process.cwd();
  const validation = validateRewriteHints(input.pattern, input.rewrite, input.language, {
    force: input.force,
    paths: input.paths,
    limit: input.maxMatches
  });
  if (validation.rejected) {
    const blocking = validation.hints.find((hint) => hint.severity === "always-reject" || hint.severity === "reject");
    return failure(preflightCode(validation.code), blocking?.message ?? "Rewrite preflight rejected the request.", "preflight", input.language, elapsed(), { hints: validation.hints.map((hint) => hint.message) });
  }
  const warnings = validation.hints.map((hint) => hint.message);
  let preview;
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildRewriteArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code, error.message, "preview", input.language, error.durationMs, {
        stderr: error.stderr
      });
    }
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "preview", input.language, elapsed());
  }
  if (ERROR_NODE_RE2.test(preview.stderr)) {
    return failure("PATTERN_PARSE_FAILED", "ast-grep reported an ERROR node while parsing the pattern; the query failed rather than finding nothing.", "preview", input.language, elapsed(), { stderr: preview.stderr });
  }
  const matches = toRewriteMatches(preview.records, workdir);
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords
  };
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size
  };
  const dryRun = (secondPassExitCode, extraWarnings = []) => ({
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed()
  });
  if (!input.apply)
    return dryRun(null);
  if (truncation.truncated) {
    return failure("PREVIEW_TRUNCATED", `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`, "preview", input.language, elapsed(), { stderr: preview.stderr });
  }
  if (matches.length === 0) {
    return dryRun(null, ["Nothing to apply: the preview found no matches."]);
  }
  await hooks?.onPreviewComplete?.();
  const remainingBudgetMs = input.timeoutMs - elapsed();
  if (remainingBudgetMs <= 0) {
    return failure("TIMEOUT", "The tool deadline expired before the mutation pass could start; nothing was modified.", "apply", input.language, elapsed(), { stderr: preview.stderr });
  }
  let applyExitCode;
  let applyStderr = "";
  try {
    const applied = await spawnSgRunner({
      sgPath,
      args: buildRewriteApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal
    });
    applyExitCode = applied.exitCode;
    applyStderr = applied.stderr;
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code, error.message, "apply", input.language, elapsed(), {
        stderr: error.stderr
      });
    }
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "apply", input.language, elapsed());
  }
  if (applyExitCode === 1) {
    return failure("REWRITE_STALE_PREVIEW", "The preview found matches but the mutation pass found none; the files or search scope changed between passes. Re-run the preview before applying.", "apply", input.language, elapsed(), { stderr: applyStderr });
  }
  return {
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode: applyExitCode
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING],
    durationMs: elapsed()
  };
}

// packages/mpd-mcp-astgrep/src/scan.ts
var MAX_PATHS3 = 64;
var MAX_GLOBS3 = 32;
var MIN_TIMEOUT_MS3 = 1000;
var MAX_PATH_LENGTH = 4096;
var MAX_GLOB_LENGTH = 1024;
var MAX_INLINE_RULE_BYTES = 64 * 1024;
var SCAN_TOOL_NAME = "scan";
var SCAN_TOOL_DESCRIPTION = "Run ast-grep YAML rules over files. Name exactly ONE rule source — `ruleFile` (a path) or `inlineRules` (the YAML text) — and never both; no ambient `sgconfig.yml` is consulted, so a scan is reproducible from its arguments alone. Nothing is written unless `apply` is true. `includeMetadata` adds each rule's metadata block to the matches. Applying runs a bounded JSON preview and then a separate plain `--update-all` pass, so the reported counts describe the preview; a truncated preview is never applied.";
function codePointLength2(value) {
  return [...value].length;
}
var KNOWN_KEYS2 = new Set([
  "ruleFile",
  "inlineRules",
  "paths",
  "workdir",
  "globs",
  "maxMatches",
  "timeoutMs",
  "includeHidden",
  "followSymlinks",
  "includeMetadata",
  "apply"
]);
function parseScanInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  const obj = input;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS2.has(key))
      throw new Error(`Unknown property: ${key}`);
  }
  const hasRuleFile = obj.ruleFile !== undefined;
  const hasInlineRules = obj.inlineRules !== undefined;
  if (hasRuleFile === hasInlineRules) {
    throw new Error("Exactly one of ruleFile or inlineRules must be provided");
  }
  if (hasRuleFile && (typeof obj.ruleFile !== "string" || obj.ruleFile.length === 0)) {
    throw new Error("ruleFile must be a non-empty string");
  }
  if (typeof obj.ruleFile === "string" && codePointLength2(obj.ruleFile) > MAX_PATH_LENGTH) {
    throw new Error(`ruleFile must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (hasInlineRules && (typeof obj.inlineRules !== "string" || obj.inlineRules.length === 0)) {
    throw new Error("inlineRules must be a non-empty string");
  }
  if (typeof obj.inlineRules === "string" && Buffer.byteLength(obj.inlineRules, "utf8") > MAX_INLINE_RULE_BYTES) {
    throw new Error("inlineRules must be at most 64KiB");
  }
  if (!Array.isArray(obj.paths))
    throw new Error("paths must be an array");
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS3) {
    throw new Error(`paths must have 1-${MAX_PATHS3} entries`);
  }
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0)
      throw new Error("each path must be a non-empty string");
    if (codePointLength2(path) > MAX_PATH_LENGTH)
      throw new Error(`each path must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (obj.workdir !== undefined && (typeof obj.workdir !== "string" || obj.workdir.length === 0)) {
    throw new Error("workdir must be a non-empty string");
  }
  if (typeof obj.workdir === "string" && codePointLength2(obj.workdir) > MAX_PATH_LENGTH) {
    throw new Error(`workdir must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs))
      throw new Error("globs must be an array");
    if (obj.globs.length > MAX_GLOBS3)
      throw new Error(`globs must have at most ${MAX_GLOBS3} entries`);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0)
        throw new Error("each glob must be a non-empty string");
      if (codePointLength2(glob) > MAX_GLOB_LENGTH)
        throw new Error(`each glob must be at most ${MAX_GLOB_LENGTH} characters`);
    }
  }
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`);
    }
    maxMatches = obj.maxMatches;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS3 || obj.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS3} and ${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = obj.timeoutMs;
  }
  for (const flag of ["includeHidden", "followSymlinks", "includeMetadata", "apply"]) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean")
      throw new Error(`${flag} must be a boolean`);
  }
  return {
    ruleFile: obj.ruleFile,
    inlineRules: obj.inlineRules,
    paths: obj.paths,
    workdir: obj.workdir,
    globs: obj.globs,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden,
    followSymlinks: obj.followSymlinks,
    includeMetadata: obj.includeMetadata ?? false,
    apply: obj.apply ?? false
  };
}
function sourceArgs(input) {
  return input.ruleFile !== undefined ? ["--rule", input.ruleFile] : ["--inline-rules", input.inlineRules];
}
function scopeArgs2(input) {
  const args = [];
  if (input.globs)
    for (const glob of input.globs)
      args.push("--globs", glob);
  if (input.includeHidden)
    args.push("--no-ignore", "hidden");
  if (input.followSymlinks)
    args.push("--follow");
  return args;
}
function buildScanArgs(input) {
  return [
    "scan",
    ...sourceArgs(input),
    ...input.includeMetadata ? ["--include-metadata"] : [],
    "--json=stream",
    ...scopeArgs2(input),
    ...input.paths
  ];
}
function buildScanApplyArgs(input) {
  return ["scan", ...sourceArgs(input), "--update-all", ...scopeArgs2(input), ...input.paths];
}
var RETRYABLE2 = new Set(["ABORTED", "OUTPUT_PARSE_FAILED", "TIMEOUT"]);
var RULE_PARSE_RE = /Cannot parse rule|not a valid ast-grep rule|Fail to parse yaml as RuleConfig/i;
var DEPRECATION_WARNING_RE = /^warning:.*\bsg\b.*deprecated/im;
var APPLY_PREVIEW_WARNING2 = "Mutation counts are based on the preview pass; sg scan --update-all does not return equivalent JSON.";
function failure2(code, message, phase, durationMs, details = {}) {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "scan",
    error: { code, message, retryable: RETRYABLE2.has(code), phase, details },
    durationMs
  };
}
function runnerFailure(error, phase) {
  if (RULE_PARSE_RE.test(error.stderr)) {
    return failure2("RULE_PARSE_FAILED", "ast-grep could not parse the explicit YAML rule source.", phase, error.durationMs, { stderr: error.stderr });
  }
  return failure2(error.code, error.message, phase, error.durationMs, { stderr: error.stderr });
}
function toScanMatches(records, workdir) {
  return normalizeRecords(records, workdir).map((normalized) => {
    const raw = normalized;
    const rule = {
      ruleId: typeof raw.ruleId === "string" ? raw.ruleId : "",
      ...typeof raw.severity === "string" ? { severity: raw.severity } : {},
      ...typeof raw.note === "string" ? { note: raw.note } : {},
      ...typeof raw.message === "string" ? { message: raw.message } : {},
      labels: Array.isArray(raw.labels) ? raw.labels : [],
      ...raw.metadata !== undefined ? { metadata: raw.metadata } : {}
    };
    const match = { ...raw };
    delete match.ruleId;
    delete match.severity;
    delete match.note;
    delete match.message;
    delete match.labels;
    delete match.metadata;
    return {
      ...match,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      rule
    };
  });
}
async function executeScan(rawInput, sgPath, signal) {
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  let input;
  try {
    input = parseScanInput(rawInput);
  } catch (error) {
    return failure2("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), "preflight", elapsed());
  }
  const workdir = input.workdir ?? process.env.MPD_AST_GREP_PROJECT_CWD ?? process.cwd();
  let preview;
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildScanArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError)
      return runnerFailure(error, "preview");
    return failure2("SG_FAILED", error instanceof Error ? error.message : String(error), "preview", elapsed());
  }
  const matches = toScanMatches(preview.records, workdir);
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords
  };
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size
  };
  const warnings = DEPRECATION_WARNING_RE.test(preview.stderr) ? [preview.stderr.trim()] : [];
  const dryRun = (extraWarnings = []) => ({
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      secondPassExitCode: null
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed()
  });
  if (!input.apply)
    return dryRun();
  if (preview.truncated) {
    return failure2("PREVIEW_TRUNCATED", `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`, "preview", elapsed(), { stderr: preview.stderr });
  }
  if (matches.length === 0)
    return dryRun(["Nothing to apply: the preview found no matches."]);
  const remainingBudgetMs = input.timeoutMs - elapsed();
  if (remainingBudgetMs <= 0) {
    return failure2("TIMEOUT", "The tool deadline expired during the preview pass; the mutation pass was not started.", "preview", elapsed(), { stderr: preview.stderr });
  }
  let applied;
  try {
    applied = await spawnSgRunner({
      sgPath,
      args: buildScanApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError)
      return runnerFailure(error, "apply");
    return failure2("SG_FAILED", error instanceof Error ? error.message : String(error), "apply", elapsed());
  }
  return {
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      secondPassExitCode: applied.exitCode
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING2],
    durationMs: elapsed()
  };
}

// packages/mpd-mcp-astgrep/src/server.ts
var AST_GREP_SERVER_NAME = "ast_grep";
var AST_GREP_SERVER_VERSION = "0.1.0";
var DEFAULT_PROTOCOL_VERSION = "2024-11-05";
var LANGUAGES4 = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
];
var STRICTNESS3 = ["cst", "smart", "ast", "relaxed", "signature"];
var PATTERN_BYTES_NOTE = "Max 16 KiB (16384 BYTES, UTF-8) — the limit counts bytes, not characters.";
var REWRITE_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters.";
var INLINE_RULES_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters.";
var pathsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: { type: "string", minLength: 1, maxLength: 4096 },
  description: "Files or directories to search. Required — there is no implicit '.' default."
};
var globsSchema = {
  type: "array",
  maxItems: 32,
  items: { type: "string", minLength: 1, maxLength: 1024 },
  description: "Optional include/exclude globs passed through to ast-grep."
};
var workdirSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  description: "Working directory for the sg process. Defaults to the server's cwd."
};
var maxMatchesSchema = {
  type: "integer",
  minimum: 1,
  maximum: 500,
  description: "Maximum matches to return (default 50)."
};
var timeoutMsSchema = {
  type: "integer",
  minimum: 1000,
  maximum: 300000,
  description: "Whole-call timeout budget in milliseconds (default 300000)."
};
var includeHiddenSchema = { type: "boolean", description: "Include hidden files (--no-ignore hidden)." };
var followSymlinksSchema = { type: "boolean", description: "Follow symlinks (--follow)." };
var AST_GREP_MCP_TOOLS = [
  {
    name: SEARCH_TOOL_NAME,
    description: SEARCH_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES4], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS3], description: "Match strictness (default smart)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." }
      },
      required: ["pattern", "language", "paths"],
      additionalProperties: false
    }
  },
  {
    name: REWRITE_TOOL_NAME,
    description: REWRITE_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        rewrite: { type: "string", description: `Replacement code; empty deletes the match. ${REWRITE_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES4], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS3], description: "Match strictness (default smart)." },
        apply: { type: "boolean", description: "Write the rewrite to disk. Default false (dry run)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." }
      },
      required: ["pattern", "rewrite", "language", "paths"],
      additionalProperties: false
    }
  },
  {
    name: SCAN_TOOL_NAME,
    description: SCAN_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ruleFile: { type: "string", minLength: 1, maxLength: 4096, description: "Path to a YAML rule file. Mutually exclusive with inlineRules." },
        inlineRules: {
          type: "string",
          minLength: 1,
          description: `Inline YAML rule text. Mutually exclusive with ruleFile. ${INLINE_RULES_BYTES_NOTE}`
        },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        includeMetadata: { type: "boolean", description: "Include rule metadata in each match." },
        apply: { type: "boolean", description: "Write rule fixes to disk. Default false (dry run)." }
      },
      required: ["paths"],
      additionalProperties: false
    }
  }
];
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonRpcId(value) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}
function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function toolResponse(id, payload, isError) {
  return successResponse(id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError
  });
}
function toolFailure(id, code, message, hints = [], extra = {}) {
  return toolResponse(id, {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      phase: "preflight",
      ...extra,
      details: hints.length > 0 ? { hints } : {}
    }
  }, true);
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function hintsOf(error) {
  if (!(error instanceof Error) || !("hints" in error))
    return [];
  const hints = error.hints;
  return Array.isArray(hints) ? hints.filter((hint) => typeof hint === "string") : [];
}
function requestedProtocolVersion(params) {
  if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string")
    return DEFAULT_PROTOCOL_VERSION;
  return params["protocolVersion"];
}
function resolveSgPath(options) {
  if (options.resolveSgPath !== undefined)
    return options.resolveSgPath();
  const pinned = (process.env.MPD_AST_GREP_SG_PATH ?? "").trim();
  if (pinned.length > 0 && existsSync2(pinned) && probeAstGrep(pinned))
    return pinned;
  const resolution = resolveAstGrepBinary(import.meta.url);
  if (resolution !== null)
    return resolution.binary;
  throw Object.assign(new Error("ast-grep executable not found: no candidate passed the --version probe, and no ast-grep this bundle can link"), {
    hints: [
      "Install the MIT engine with `npm install -g @ast-grep/cli`, or set MPD_AST_GREP_SG_PATH to the absolute path of the ast-grep executable.",
      "In a checkout, `node scripts/install-mcp.ts` installs it into <bundle>/.toolchain, which this server resolves automatically."
    ]
  });
}
async function handleAstGrepMcpRequest(input, options = {}) {
  if (!isPlainRecord(input))
    return errorResponse(null, -32600, "Invalid Request");
  const id = jsonRpcId(input["id"]);
  const method = input["method"];
  if (method === "notifications/initialized")
    return;
  if (method === "ping")
    return successResponse(id, {});
  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: AST_GREP_SERVER_NAME, version: AST_GREP_SERVER_VERSION },
      protocolVersion: requestedProtocolVersion(input["params"])
    });
  }
  if (method === "tools/list")
    return successResponse(id, { tools: [...AST_GREP_MCP_TOOLS] });
  if (method === "tools/call")
    return await handleToolCall(id, input["params"], options);
  return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}
async function handleToolCall(id, params, options) {
  if (!isPlainRecord(params) || typeof params["name"] !== "string") {
    return errorResponse(id, -32602, "tools/call requires params.name");
  }
  const name = params["name"];
  const args = isPlainRecord(params["arguments"]) ? params["arguments"] : {};
  if (name !== SEARCH_TOOL_NAME && name !== REWRITE_TOOL_NAME && name !== SCAN_TOOL_NAME) {
    return toolFailure(id, "INVALID_ARGUMENT", `Unknown ast_grep tool: ${name}. Available tools: ${AST_GREP_MCP_TOOLS.map((tool) => tool.name).join(", ")}.`);
  }
  let sgPath;
  try {
    sgPath = resolveSgPath(options);
  } catch (error) {
    return toolFailure(id, "BINARY_NOT_FOUND", messageOf(error), hintsOf(error));
  }
  try {
    const payload = await dispatch(name, args, sgPath, options);
    return toolResponse(id, payload, payload.ok !== true);
  } catch (error) {
    if (error instanceof SearchArgumentError) {
      return toolFailure(id, "INVALID_ARGUMENT", error.message, [], { language: error.language });
    }
    return toolFailure(id, "SG_FAILED", messageOf(error));
  }
}
async function dispatch(name, args, sgPath, options) {
  if (name === SEARCH_TOOL_NAME) {
    return await executeSearch(parseSearchInput(args), sgPath, options.signal);
  }
  if (name === REWRITE_TOOL_NAME) {
    return await executeRewrite(args, sgPath, options.signal);
  }
  return await executeScan(args, sgPath, options.signal);
}

// packages/mpd-mcp-astgrep/src/protocol.ts
var PARENT_POLL_MS = 2000;
function parseLine(line) {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
function parseErrorResponse(data) {
  return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error", data } };
}
async function runStdioServer(options = {}) {
  const parentPid = process.ppid;
  let active = null;
  let closed = false;
  let draining = false;
  const queue = [];
  let idle = null;
  const write = (response) => {
    try {
      process.stdout.write(`${JSON.stringify(response)}
`);
    } catch {}
  };
  const drain = async () => {
    if (draining)
      return;
    draining = true;
    try {
      while (queue.length > 0) {
        const line = queue.shift();
        const parsed = parseLine(line);
        if (!parsed.ok) {
          write(parseErrorResponse(parsed.message));
          continue;
        }
        const controller = new AbortController;
        active = controller;
        try {
          const response = await handleAstGrepMcpRequest(parsed.value, { ...options, signal: controller.signal });
          if (response !== undefined)
            write(response);
        } catch (error) {
          write({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
        } finally {
          if (active === controller)
            active = null;
        }
      }
    } finally {
      draining = false;
    }
    if (closed && idle !== null) {
      const settle = idle;
      idle = null;
      settle();
    }
  };
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  reader.on("line", (line) => {
    if (line.length === 0)
      return;
    queue.push(line);
    drain();
  });
  reader.on("close", () => {
    closed = true;
    active?.abort(new Error("stdin closed"));
    drain();
  });
  const watchdog = setInterval(() => {
    if (process.ppid === parentPid)
      return;
    closed = true;
    reader.close();
    active?.abort(new Error("parent process exited"));
    drain();
  }, PARENT_POLL_MS);
  watchdog.unref();
  await new Promise((resolve3) => {
    if (closed && queue.length === 0 && active === null) {
      resolve3();
      return;
    }
    idle = resolve3;
  });
  clearInterval(watchdog);
  reader.close();
}

// packages/mpd-mcp-astgrep/src/cli.ts
function reportFatal(error) {
  const sink = openLogSink("mpd-mcp-astgrep");
  sink.write(error instanceof Error ? error.stack ?? error.message : String(error));
}
async function main() {
  await runStdioServer();
}
main().catch((error) => {
  reportFatal(error);
  process.exitCode = 1;
});
