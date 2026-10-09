#!/usr/bin/env node

// packages/mpd-mcp-lsp/src/launch.ts
import { pathToFileURL } from "node:url";

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

// packages/mpd-mcp-lsp/src/cclsp-config.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, statSync as statSync2, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join as join3 } from "node:path";

// packages/mpd-mcp-lsp/src/server-catalog.ts
var npmPage = (name) => `https://www.npmjs.com/package/${name}`;
var npmDoc = (name) => `https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`;
var repoDoc = (repo, path) => `https://raw.githubusercontent.com/${repo}/HEAD/${path}`;
var readme = (repo) => repoDoc(repo, "README.md");
var LANGUAGE_SERVERS = [
  {
    language: "typescript",
    displayName: "TypeScript / JavaScript",
    server: "typescript-language-server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("typescript-language-server/typescript-language-server", "LICENSE"),
    installCommand: "npm install -g typescript-language-server typescript",
    npmInstallable: true,
    caveat: "Ships with the bundle: the declared `cclsp` dependency carries it, so no user install is needed for TS/JS. The launcher points at that copy through the running node, never at a PATH one.",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"],
    command: ["typescript-language-server", "--stdio"],
    citations: [npmPage("typescript-language-server"), repoDoc("typescript-language-server/typescript-language-server", "LICENSE"), readme("typescript-language-server/typescript-language-server")],
    verification: "primary"
  },
  {
    language: "python",
    displayName: "Python",
    server: "pyright",
    licence: "MIT",
    licenceUrl: repoDoc("microsoft/pyright", "LICENSE.txt"),
    installCommand: "npm install -g pyright (the pip route is: pip install pyright)",
    npmInstallable: true,
    caveat: "`basedpyright` is a drop-in alternative with the same CLI shape; because the generated config names only the server this row carries, switching to it means naming `basedpyright-langserver` in a workspace `cclsp.json`.",
    extensions: ["py", "pyi"],
    command: ["pyright-langserver", "--stdio"],
    citations: [npmPage("pyright"), repoDoc("microsoft/pyright", "LICENSE.txt")],
    verification: "primary"
  },
  {
    language: "go",
    displayName: "Go",
    server: "gopls",
    licence: "BSD-3-Clause",
    licenceUrl: repoDoc("golang/tools", "LICENSE"),
    installCommand: "go install golang.org/x/tools/gopls@latest",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: it is the canonical Go-toolchain install but was NOT read verbatim from a project document in this session. `npm install -g gopls` is a TRAP — that package is a 0.0.1-security placeholder with no bin. The module path pins no version, so re-running the command is what updates gopls.",
    extensions: ["go"],
    command: ["gopls"],
    citations: [repoDoc("golang/tools", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "rust",
    displayName: "Rust",
    server: "rust-analyzer",
    licence: "MIT OR Apache-2.0",
    licenceUrl: repoDoc("rust-lang/rust-analyzer", "LICENSE-MIT"),
    installCommand: "rustup component add rust-analyzer",
    npmInstallable: false,
    caveat: "Shipped through rustup so it tracks your toolchain, which is the point: a standalone rust-analyzer that does not match the toolchain is the usual source of proc-macro errors.",
    extensions: ["rs"],
    command: ["rust-analyzer"],
    citations: [repoDoc("rust-lang/rust-analyzer", "LICENSE-MIT"), repoDoc("rust-lang/rust-analyzer", "LICENSE-APACHE"), "https://rust-analyzer.github.io/book/installation.html"],
    verification: "primary"
  },
  {
    language: "c-cpp",
    displayName: "C / C++",
    server: "clangd",
    licence: "Apache-2.0 WITH LLVM-exception",
    licenceUrl: repoDoc("llvm/llvm-project", "LICENSE.TXT"),
    installCommand: "Install your distribution's clangd package (apt install clangd, brew install llvm), or download a release from https://github.com/llvm/llvm-project/releases",
    npmInstallable: false,
    caveat: "clangd needs a compile-commands database to be useful: generate `compile_commands.json` (CMake: -DCMAKE_EXPORT_COMPILE_COMMANDS=ON) at the workspace root, or diagnostics stay at syntax level.",
    extensions: ["c", "cpp", "cc", "cxx", "c++", "h", "hpp", "hh", "hxx", "h++"],
    command: ["clangd", "--background-index", "--clang-tidy"],
    citations: [repoDoc("llvm/llvm-project", "LICENSE.TXT")],
    verification: "primary"
  },
  {
    language: "objective-c",
    displayName: "Objective-C",
    server: "clangd",
    licence: "Apache-2.0 WITH LLVM-exception",
    licenceUrl: repoDoc("llvm/llvm-project", "LICENSE.TXT"),
    installCommand: "Install your distribution's clangd package (apt install clangd, brew install llvm), or download a release from https://github.com/llvm/llvm-project/releases",
    npmInstallable: false,
    caveat: "This row resolves to the SAME clangd binary as the C/C++ row, so the two merge into one server process in the generated config; Xcode's own indexer is not involved.",
    extensions: ["m", "mm"],
    command: ["clangd", "--background-index", "--clang-tidy"],
    citations: [repoDoc("llvm/llvm-project", "LICENSE.TXT")],
    verification: "primary"
  },
  {
    language: "java",
    displayName: "Java",
    server: "Eclipse JDT LS",
    licence: "EPL-2.0",
    licenceUrl: repoDoc("eclipse-jdtls/eclipse.jdt.ls", "LICENSE"),
    installCommand: "Download and extract a milestone build from https://download.eclipse.org/jdtls/milestones/ and put the launcher on PATH",
    npmInstallable: false,
    caveat: "UNVERIFIED for the launcher name: the project README documents the download and extract steps but not the executable they yield, so the argv below is the community convention rather than a quoted command. NOT permissive: EPL-2.0 (weak copyleft) — spawned from the user's install, never redistributed here.",
    extensions: ["java"],
    command: ["jdtls"],
    citations: [repoDoc("eclipse-jdtls/eclipse.jdt.ls", "LICENSE"), readme("eclipse-jdtls/eclipse.jdt.ls")],
    verification: "unverified"
  },
  {
    language: "kotlin",
    displayName: "Kotlin",
    server: "kotlin-lsp",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("Kotlin/kotlin-lsp", "LICENSE.txt"),
    installCommand: "brew install JetBrains/utils/kotlin-lsp",
    npmInstallable: false,
    caveat: "JetBrains' own server, distributed today mainly as editor extensions and release zips; the Homebrew tap is the only one-command route its README quotes. The independently researched matrix carries `fwcd/kotlin-language-server` (MIT) for the same extensions; it is a real alternative, and switching to it means naming `kotlin-language-server` in a workspace `cclsp.json`.",
    extensions: ["kt", "kts"],
    command: ["kotlin-lsp"],
    citations: [repoDoc("Kotlin/kotlin-lsp", "LICENSE.txt"), readme("Kotlin/kotlin-lsp"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 6, the fwcd alternative)"],
    verification: "primary"
  },
  {
    language: "csharp",
    displayName: "C#",
    server: "csharp-ls",
    licence: "MIT",
    licenceUrl: repoDoc("razzmatazz/csharp-language-server", "LICENSE"),
    installCommand: "dotnet tool install --global csharp-ls",
    npmInstallable: false,
    caveat: "A community server rather than Microsoft's: it needs the .NET SDK on PATH and gives you a language service without the C# Dev Kit product. The researched matrix could not read a licence file at the old `Razor/csharp-ls` coordinates (404 today); the project's CURRENT home `razzmatazz/csharp-language-server` carries the MIT LICENSE cited here.",
    extensions: ["cs"],
    command: ["csharp-ls"],
    citations: [repoDoc("razzmatazz/csharp-language-server", "LICENSE"), readme("razzmatazz/csharp-language-server"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 8c — the coordinates it could not read)"],
    verification: "primary"
  },
  {
    language: "razor",
    displayName: "Razor / ASP.NET views",
    server: "C# Dev Kit language server (Microsoft)",
    licence: "proprietary",
    licenceUrl: "https://api.nuget.org/v3-flatcontainer/roslyn-language-server/5.12.0-1.26475.2/roslyn-language-server.nuspec",
    installCommand: "Install the C# Dev Kit extension in your editor (Visual Studio Code: ms-dotnettools.csdevkit), or the standalone NuGet tool with `dotnet tool install --global roslyn-language-server`",
    npmInstallable: false,
    caveat: "NOT permissive, and the nuance is recorded rather than flattened: the C# Dev Kit PRODUCT ships Microsoft's Roslyn-based language server under no licence file at all, while the standalone NuGet package `roslyn-language-server` declares MIT and the Roslyn COMPILER is MIT. Never write `Roslyn is proprietary` and never write `Roslyn is MIT` as if that covered the shipped C# Dev Kit server — the permissive C# path in this catalog is the `csharp-ls` row.",
    extensions: ["razor", "cshtml"],
    command: ["roslyn-language-server", "--stdio"],
    citations: ["https://api.nuget.org/v3-flatcontainer/roslyn-language-server/index.json", "https://api.nuget.org/v3-flatcontainer/roslyn-language-server/5.12.0-1.26475.2/roslyn-language-server.nuspec", repoDoc("dotnet/roslyn", "License.txt"), repoDoc("microsoft/vscode-csharp", "README.md")],
    verification: "primary"
  },
  {
    language: "swift",
    displayName: "Swift",
    server: "sourcekit-lsp",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("swiftlang/sourcekit-lsp", "LICENSE.txt"),
    installCommand: "Comes with the Swift toolchain: install one from https://swift.org/install/ (on macOS it is bundled with Xcode)",
    npmInstallable: false,
    caveat: "There is no separate install: if sourcekit-lsp is missing, the Swift toolchain is what to install, and on macOS `xcode-select --install` is what provides it.",
    extensions: ["swift"],
    command: ["sourcekit-lsp"],
    citations: [repoDoc("swiftlang/sourcekit-lsp", "LICENSE.txt"), readme("swiftlang/sourcekit-lsp")],
    verification: "primary"
  },
  {
    language: "ruby",
    displayName: "Ruby",
    server: "ruby-lsp",
    licence: "MIT",
    licenceUrl: repoDoc("Shopify/ruby-lsp", "LICENSE.txt"),
    installCommand: "gem install ruby-lsp",
    npmInstallable: false,
    caveat: "Shopify's server, published on RubyGems; a project with its own Gemfile usually wants the gem added there too, so the editor and the project agree on the version.",
    extensions: ["rb", "rake", "gemspec", "ru"],
    command: ["ruby-lsp"],
    citations: [repoDoc("Shopify/ruby-lsp", "LICENSE.txt"), "https://rubygems.org/api/v1/gems/ruby-lsp.json"],
    verification: "primary"
  },
  {
    language: "php",
    displayName: "PHP",
    server: "Intelephense",
    licence: "proprietary",
    licenceUrl: repoDoc("bmewburn/vscode-intelephense", "LICENSE.txt"),
    installCommand: "npm install -g intelephense",
    npmInstallable: true,
    caveat: "NOT permissive: the repository LICENSE.txt carries an MIT section for the CLIENT application and a separate `Intelephense Licence` for the server, where Premium Features need a purchased Licence Key. `phpactor` (MIT) is the permissive alternative, but switching is a hand-written `cclsp.json` because the generated config names one PHP server.",
    extensions: ["php"],
    command: ["intelephense", "--stdio"],
    citations: [npmPage("intelephense"), repoDoc("bmewburn/vscode-intelephense", "LICENSE.txt")],
    verification: "primary"
  },
  {
    language: "dart",
    displayName: "Dart / Flutter",
    server: "Dart SDK language server",
    licence: "BSD-3-Clause",
    licenceUrl: repoDoc("dart-lang/sdk", "LICENSE"),
    installCommand: "Comes with the Dart SDK: install one from https://dart.dev/get-dart",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the SDK repository does not document the language-server subcommand, so `dart language-server --lsp` is the convention published on dart.dev rather than a line quoted from the repository. Requires `dart` on PATH.",
    extensions: ["dart"],
    command: ["dart", "language-server", "--lsp"],
    citations: [repoDoc("dart-lang/sdk", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "elixir",
    displayName: "Elixir",
    server: "ElixirLS",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("elixir-lsp/elixir-ls", "LICENSE"),
    installCommand: "Download the release archive from https://github.com/elixir-lsp/elixir-ls/releases/latest and unzip it",
    npmInstallable: false,
    caveat: "The archive ships `language_server.sh`, which is the executable this row probes for — put that name on PATH; ElixirLS is distributed as a release directory rather than a single binary.",
    extensions: ["ex", "exs"],
    command: ["language_server.sh"],
    citations: [repoDoc("elixir-lsp/elixir-ls", "LICENSE"), readme("elixir-lsp/elixir-ls")],
    verification: "primary"
  },
  {
    language: "zig",
    displayName: "Zig",
    server: "zls",
    licence: "MIT",
    licenceUrl: repoDoc("zigtools/zls", "LICENSE"),
    installCommand: "See the install guide at https://zigtools.org/zls/install/ (prebuilt binaries and package-manager routes)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: the README points at an install PAGE rather than quoting a command. `npm install -g zls` is a TRAP — that package is a third-party wrapper (Sarvesh-SP/zls), not zigtools/zls. The release you download must target your Zig version: zls follows Zig master, and a mismatched pair refuses to start.",
    extensions: ["zig", "zon"],
    command: ["zls"],
    citations: [repoDoc("zigtools/zls", "LICENSE"), readme("zigtools/zls")],
    verification: "unverified"
  },
  {
    language: "lua",
    displayName: "Lua",
    server: "lua-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("LuaLS/lua-language-server", "LICENSE"),
    installCommand: "See the install instructions at https://luals.github.io/#install (community packages such as brew install lua-language-server)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the exact command: the repository README points at the project website for installation, so no install line could be quoted from it. The probed executable name is the project's own.",
    extensions: ["lua"],
    command: ["lua-language-server"],
    citations: [repoDoc("LuaLS/lua-language-server", "LICENSE"), readme("LuaLS/lua-language-server")],
    verification: "unverified"
  },
  {
    language: "bash",
    displayName: "Shell (bash / zsh)",
    server: "bash-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("bash-lsp/bash-language-server", "LICENSE"),
    installCommand: "npm install -g bash-language-server",
    npmInstallable: true,
    caveat: "Its linting is only as good as `shellcheck`: without shellcheck the server starts and answers, but the diagnostics are mostly empty.",
    extensions: ["sh", "bash", "zsh", "ksh"],
    command: ["bash-language-server", "start"],
    citations: [npmPage("bash-language-server"), repoDoc("bash-lsp/bash-language-server", "LICENSE")],
    verification: "primary"
  },
  {
    language: "yaml",
    displayName: "YAML",
    server: "yaml-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("redhat-developer/yaml-language-server", "LICENSE"),
    installCommand: "npm install -g yaml-language-server",
    npmInstallable: true,
    caveat: "Schema validation is opt-in: a `# yaml-language-server: $schema=<url>` comment at the top of a file is what turns a bare YAML parse into real diagnostics.",
    extensions: ["yaml", "yml"],
    command: ["yaml-language-server", "--stdio"],
    citations: [npmPage("yaml-language-server"), repoDoc("redhat-developer/yaml-language-server", "LICENSE")],
    verification: "primary"
  },
  {
    language: "json",
    displayName: "JSON / JSONC",
    server: "vscode-json-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"),
    installCommand: "npm i -g vscode-langservers-extracted",
    npmInstallable: true,
    caveat: "One npm package carries the JSON, HTML, CSS and Markdown servers, so installing it wires several rows here at once; it is a REPACKAGE of Microsoft's language servers rather than an official Microsoft release.",
    extensions: ["json", "jsonc"],
    command: ["vscode-json-language-server", "--stdio"],
    citations: [npmDoc("vscode-langservers-extracted"), repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"), readme("hrsh7th/vscode-langservers-extracted")],
    verification: "primary"
  },
  {
    language: "html",
    displayName: "HTML",
    server: "vscode-html-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"),
    installCommand: "npm i -g vscode-langservers-extracted",
    npmInstallable: true,
    caveat: "Same package as the JSON and CSS rows, so one install wires three languages; embedded CSS and JavaScript inside HTML is a known weak spot of this server.",
    extensions: ["html", "htm"],
    command: ["vscode-html-language-server", "--stdio"],
    citations: [npmDoc("vscode-langservers-extracted"), repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE")],
    verification: "primary"
  },
  {
    language: "css",
    displayName: "CSS / SCSS / Less",
    server: "vscode-css-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"),
    installCommand: "npm i -g vscode-langservers-extracted",
    npmInstallable: true,
    caveat: "Framework-specific at-rules (Tailwind directives, CSS modules) produce unknown-at-rule diagnostics with this server; a project that lives in them wants a framework-aware server instead, wired by hand in `cclsp.json`.",
    extensions: ["css", "scss", "less"],
    command: ["vscode-css-language-server", "--stdio"],
    citations: [npmDoc("vscode-langservers-extracted"), repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE")],
    verification: "primary"
  },
  {
    language: "markdown",
    displayName: "Markdown",
    server: "marksman",
    licence: "MIT",
    licenceUrl: repoDoc("artempyanykh/marksman", "LICENSE"),
    installCommand: "brew install marksman",
    npmInstallable: false,
    caveat: "Cross-file link completion is what marksman adds beyond a plain parser; it resolves wiki-style links within one directory tree, so a scattered documentation set gets less out of it.",
    extensions: ["md", "markdown"],
    command: ["marksman", "server"],
    citations: [repoDoc("artempyanykh/marksman", "LICENSE"), repoDoc("artempyanykh/marksman", "docs/install.md")],
    verification: "primary"
  },
  {
    language: "dockerfile",
    displayName: "Dockerfile",
    server: "dockerfile-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("rcjsuen/dockerfile-language-server", "License.txt"),
    installCommand: "npm install -g dockerfile-language-server-nodejs",
    npmInstallable: true,
    caveat: "cclsp routes by FILE EXTENSION and `Dockerfile` has none — only `name.dockerfile` reaches this row, so a plain `Dockerfile` stays unrouted and fails with cclsp's own message.",
    extensions: ["dockerfile"],
    command: ["docker-langserver", "--stdio"],
    citations: [npmPage("dockerfile-language-server-nodejs"), repoDoc("rcjsuen/dockerfile-language-server", "License.txt")],
    verification: "primary"
  },
  {
    language: "terraform",
    displayName: "Terraform / HCL",
    server: "terraform-ls",
    licence: "MPL-2.0",
    licenceUrl: repoDoc("hashicorp/terraform-ls", "LICENSE"),
    installCommand: "brew install hashicorp/tap/terraform-ls",
    npmInstallable: false,
    caveat: "NOT permissive: MPL-2.0 (file-level copyleft). HashiCorp's own server, spawned from the user's install and never redistributed here.",
    extensions: ["tf", "tfvars"],
    command: ["terraform-ls", "serve"],
    citations: [repoDoc("hashicorp/terraform-ls", "LICENSE"), repoDoc("hashicorp/terraform-ls", "docs/installation.md")],
    verification: "primary"
  },
  {
    language: "haskell",
    displayName: "Haskell",
    server: "haskell-language-server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("haskell/haskell-language-server", "LICENSE"),
    installCommand: "brew install haskell-language-server",
    npmInstallable: false,
    caveat: "It needs a GHC matching the project and a build plan (an hie.yaml, or plain cabal/stack layout); `ghcup install hls` is the usual route when the project pins its own GHC.",
    extensions: ["hs", "lhs"],
    command: ["haskell-language-server-wrapper", "--lsp"],
    citations: [repoDoc("haskell/haskell-language-server", "LICENSE"), repoDoc("haskell/haskell-language-server", "docs/installation.md")],
    verification: "primary"
  },
  {
    language: "julia",
    displayName: "Julia",
    server: "LanguageServer.jl",
    licence: "MIT",
    licenceUrl: repoDoc("julia-vscode/LanguageServer.jl", "LICENSE.md"),
    installCommand: `julia -e 'using Pkg; Pkg.add("LanguageServer")'`,
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the package README documents installing LanguageServer.jl, while the `runserver()` invocation below is the client convention rather than a quoted line. The project must be in the julia process's load path for cross-file facts.",
    extensions: ["jl"],
    command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
    citations: [repoDoc("julia-vscode/LanguageServer.jl", "LICENSE.md"), readme("julia-vscode/LanguageServer.jl")],
    verification: "unverified"
  },
  {
    language: "toml",
    displayName: "TOML",
    server: "taplo",
    licence: "MIT",
    licenceUrl: repoDoc("tamasfe/taplo", "LICENSE"),
    installCommand: "npm install -g @taplo/cli",
    npmInstallable: true,
    caveat: "UNVERIFIED for the argv: the package name, version and MIT licence are confirmed from the registry, but the `lsp stdio` subcommand was not quoted from a fetched document. Schema-aware completion comes from the file's own `#:schema` directive.",
    extensions: ["toml"],
    command: ["taplo", "lsp", "stdio"],
    citations: [npmDoc("@taplo/cli"), repoDoc("tamasfe/taplo", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "vue",
    displayName: "Vue",
    server: "Vue language server",
    licence: "MIT",
    licenceUrl: repoDoc("vuejs/language-tools", "LICENSE"),
    installCommand: "npm install -g @vue/language-server",
    npmInstallable: true,
    caveat: "Needs the project's own TypeScript for accurate types; a global install can drift from the version the project expects, so a pinned project-local copy named in `cclsp.json` is often the better wiring.",
    extensions: ["vue"],
    command: ["vue-language-server", "--stdio"],
    citations: [npmDoc("@vue/language-server"), repoDoc("vuejs/language-tools", "LICENSE")],
    verification: "primary"
  },
  {
    language: "svelte",
    displayName: "Svelte",
    server: "Svelte language server",
    licence: "MIT",
    licenceUrl: repoDoc("sveltejs/language-tools", "LICENSE"),
    installCommand: "npm install -g svelte-language-server",
    npmInstallable: true,
    caveat: "The executable is `svelteserver`, not the package name — that mismatch is why this row's probe names the binary rather than the package.",
    extensions: ["svelte"],
    command: ["svelteserver", "--stdio"],
    citations: [npmDoc("svelte-language-server"), repoDoc("sveltejs/language-tools", "LICENSE")],
    verification: "primary"
  },
  {
    language: "graphql",
    displayName: "GraphQL",
    server: "graphql-language-service",
    licence: "MIT",
    licenceUrl: npmPage("graphql-language-service-cli"),
    installCommand: "npm install -g graphql-language-service-cli",
    npmInstallable: true,
    caveat: "UNVERIFIED for the argv: the registry confirms the package, its MIT licence and its `graphql-lsp` binary, but the `server -m stream` subcommand was not quoted from a fetched README. The project schema is discovered through .graphqlrc rather than inferred.",
    extensions: ["graphql", "gql"],
    command: ["graphql-lsp", "server", "-m", "stream"],
    citations: [npmDoc("graphql-language-service-cli")],
    verification: "unverified"
  },
  {
    language: "sql",
    displayName: "SQL",
    server: "sql-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("joe-re/sql-language-server", "LICENSE"),
    installCommand: "npm install -g sql-language-server",
    npmInstallable: true,
    caveat: "UNVERIFIED for the argv: the package and its MIT licence are confirmed from the registry, while the `up --method stdio` subcommand comes from the repository README rather than a fetched line. Without a workspace config it answers with no schema.",
    extensions: ["sql"],
    command: ["sql-language-server", "up", "--method", "stdio"],
    citations: [npmDoc("sql-language-server"), repoDoc("joe-re/sql-language-server", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "cmake",
    displayName: "CMake",
    server: "cmake-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("regen100/cmake-language-server", "LICENSE"),
    installCommand: "pip install cmake-language-server",
    npmInstallable: false,
    caveat: "Deliberately NOT on npm — the project publishes on PyPI, which is why this row sets npm-eligibility false even though the server is Python-packaged.",
    extensions: ["cmake"],
    command: ["cmake-language-server"],
    citations: [repoDoc("regen100/cmake-language-server", "LICENSE"), readme("regen100/cmake-language-server")],
    verification: "primary"
  },
  {
    language: "protobuf",
    displayName: "Protocol Buffers",
    server: "protols",
    licence: "MIT",
    licenceUrl: repoDoc("coder3101/protols", "LICENSE"),
    installCommand: "cargo install protols",
    npmInstallable: false,
    caveat: "A young server: it parses proto2/proto3 with tree-sitter, so imports resolve relative to the workspace root rather than through a compiler's include path. LICENCE DISPUTE, recorded not silently resolved: the researched matrix reported NO licence file upstream and treated the project as all-rights-reserved, but the upstream repository is coder3101/protols — its LICENSE file was fetched here and reads MIT (c) 2024 Ashar. The URL the matrix checked (c4pt0r/protols) returns 404 and is a different repository. The permissive alternative with a vendor-backed licence is `buf` (Apache-2.0), wired in a workspace `cclsp.json`.",
    extensions: ["proto"],
    command: ["protols"],
    citations: [repoDoc("coder3101/protols", "LICENSE"), readme("coder3101/protols"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 41b — its coordinates 404; this read is the primary one)"],
    verification: "primary"
  },
  {
    language: "nix",
    displayName: "Nix",
    server: "nil",
    licence: "MIT OR Apache-2.0",
    licenceUrl: repoDoc("oxalica/nil", "LICENSE-MIT"),
    installCommand: "nix profile install nixpkgs#nil",
    npmInstallable: false,
    caveat: "`nixd` is the other maintained Nix server, aimed at flakes and nixpkgs evaluation, and it is NOT permissive (LGPL-3.0); this row carries nil (MIT OR Apache-2.0) because its install is one command on a machine that already runs Nix.",
    extensions: ["nix"],
    command: ["nil"],
    citations: [repoDoc("oxalica/nil", "LICENSE-MIT"), repoDoc("oxalica/nil", "LICENSE-APACHE"), readme("oxalica/nil")],
    verification: "primary"
  },
  {
    language: "clojure",
    displayName: "Clojure",
    server: "clojure-lsp",
    licence: "MIT",
    licenceUrl: repoDoc("clojure-lsp/clojure-lsp", "LICENSE"),
    installCommand: "brew install clojure-lsp/brew/clojure-lsp-native",
    npmInstallable: false,
    caveat: "The native image is the fast route; open the project at its root so the server can find the classpath, and give it a moment on the first run while it caches the analysis.",
    extensions: ["clj", "cljs", "cljc", "edn"],
    command: ["clojure-lsp"],
    citations: [repoDoc("clojure-lsp/clojure-lsp", "LICENSE"), repoDoc("clojure-lsp/clojure-lsp", "docs/installation.md")],
    verification: "primary"
  },
  {
    language: "erlang",
    displayName: "Erlang",
    server: "erlang_ls",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("erlang-ls/erlang_ls", "LICENSE"),
    installCommand: "Build from a checkout: `make` then `make install` (PREFIX=/path make install for a custom prefix)",
    npmInstallable: false,
    caveat: "Distributed as an escript you build yourself; it expects a rebar3 or erlang.mk project layout to find the OTP applications in the workspace.",
    extensions: ["erl", "hrl"],
    command: ["erlang_ls"],
    citations: [repoDoc("erlang-ls/erlang_ls", "LICENSE"), readme("erlang-ls/erlang_ls")],
    verification: "primary"
  },
  {
    language: "gleam",
    displayName: "Gleam",
    server: "Gleam CLI (`gleam lsp`)",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("gleam-lang/gleam", "LICENSE"),
    installCommand: "Install the Gleam CLI from https://gleam.run/getting-started/installing/",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the language server is a subcommand of the compiler CLI rather than a separate binary, and no install line for it could be quoted from a fetched document. Requires the Gleam CLI on PATH.",
    extensions: ["gleam"],
    command: ["gleam", "lsp"],
    citations: [repoDoc("gleam-lang/gleam", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "r",
    displayName: "R",
    server: "languageserver",
    licence: "MIT",
    licenceUrl: repoDoc("REditorSupport/languageserver", "DESCRIPTION"),
    installCommand: `R -e 'install.packages("languageserver")'`,
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the package DESCRIPTION declares `License: MIT + file LICENSE` and the README documents the CRAN install, while the `languageserver::run()` invocation is the client convention. The probe therefore looks for `R`, which must be on PATH.",
    extensions: ["r", "rmd"],
    command: ["R", "--slave", "-e", "languageserver::run()"],
    citations: [repoDoc("REditorSupport/languageserver", "DESCRIPTION"), repoDoc("REditorSupport/languageserver", "LICENSE"), readme("REditorSupport/languageserver")],
    verification: "unverified"
  },
  {
    language: "scala",
    displayName: "Scala",
    server: "Metals",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("scalameta/metals", "LICENSE"),
    installCommand: "See https://scalameta.org/metals/ for the install routes (the CLI route is `cs install metals`)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: the repository README points at the project website, so the coursier command could not be quoted from a fetched document. Metals also needs a build-server connection (Bloop or sbt) before cross-module questions answer.",
    extensions: ["scala", "sc", "sbt"],
    command: ["metals"],
    citations: [repoDoc("scalameta/metals", "LICENSE"), readme("scalameta/metals")],
    verification: "unverified"
  },
  {
    language: "ocaml",
    displayName: "OCaml",
    server: "ocaml-lsp-server",
    licence: "ISC",
    licenceUrl: repoDoc("ocaml/ocaml-lsp", "LICENSE.md"),
    installCommand: "opam install ocaml-lsp-server",
    npmInstallable: false,
    caveat: "Must be installed into the SAME opam switch the project builds in — the README says so explicitly, and a server from another switch reports the wrong modules.",
    extensions: ["ml", "mli"],
    command: ["ocamllsp"],
    citations: [repoDoc("ocaml/ocaml-lsp", "LICENSE.md"), readme("ocaml/ocaml-lsp")],
    verification: "primary"
  },
  {
    language: "verilog",
    displayName: "Verilog",
    server: "verible-verilog-ls",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("chipsalliance/verible", "LICENSE"),
    installCommand: "Download and extract the release binaries from https://github.com/chipsalliance/verible/releases",
    npmInstallable: false,
    caveat: "Ships as a release archive rather than through a package manager in most distributions, so `verible-verilog-ls` has to be put on PATH by hand; the repository also documents a Bazel build from source.",
    extensions: ["v", "vh"],
    command: ["verible-verilog-ls"],
    citations: [repoDoc("chipsalliance/verible", "LICENSE"), readme("chipsalliance/verible")],
    verification: "primary"
  },
  {
    language: "systemverilog",
    displayName: "SystemVerilog",
    server: "svls",
    licence: "MIT",
    licenceUrl: repoDoc("dalance/svls", "LICENSE"),
    installCommand: "cargo install svls (or: sudo snap install svls)",
    npmInstallable: false,
    caveat: "Indexes the workspace itself and is happy with plain SystemVerilog; a UVM project usually wants its include paths listed in a `svls.toml` beside the sources. The researched matrix also carries `@imc-trading/svlangserver` (MIT, npm-installable) for the same extensions; switching to it means naming `svlangserver` in a workspace `cclsp.json`.",
    extensions: ["sv", "svh"],
    command: ["svls"],
    citations: [repoDoc("dalance/svls", "LICENSE"), readme("dalance/svls"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 43b, the svlangserver alternative)"],
    verification: "primary"
  },
  {
    language: "fortran",
    displayName: "Fortran",
    server: "fortls",
    licence: "MIT",
    licenceUrl: repoDoc("fortran-lang/fortls", "LICENSE"),
    installCommand: "pip install fortls",
    npmInstallable: false,
    caveat: "The older `fortran-language-server` shares the same executable name — the project's own troubleshooting note says to uninstall it first, or the two shadow each other on PATH.",
    extensions: ["f90", "f95", "f03", "f08"],
    command: ["fortls"],
    citations: [repoDoc("fortran-lang/fortls", "LICENSE"), readme("fortran-lang/fortls")],
    verification: "primary"
  },
  {
    language: "nim",
    displayName: "Nim",
    server: "nimlangserver",
    licence: "MIT",
    licenceUrl: repoDoc("nim-lang/langserver", "LICENSE"),
    installCommand: "nimble install -g nimlangserver",
    npmInstallable: false,
    caveat: "Installed through Nim's own package manager, so the Nim toolchain has to exist first; the project is maintained by the Nim organisation rather than a third party.",
    extensions: ["nim", "nims"],
    command: ["nimlangserver"],
    citations: [repoDoc("nim-lang/langserver", "LICENSE")],
    verification: "primary"
  },
  {
    language: "crystal",
    displayName: "Crystal",
    server: "crystalline",
    licence: "MIT",
    licenceUrl: repoDoc("elbywan/crystalline", "LICENSE"),
    installCommand: "brew install crystalline",
    npmInstallable: false,
    caveat: "It compiles and indexes the project itself, so the first run on a large codebase is slow; it needs the Crystal compiler on PATH to resolve the standard library.",
    extensions: ["cr"],
    command: ["crystalline"],
    citations: [repoDoc("elbywan/crystalline", "LICENSE")],
    verification: "primary"
  },
  {
    language: "xml",
    displayName: "XML / XSD / XSL",
    server: "lemminx",
    licence: "EPL-2.0",
    licenceUrl: repoDoc("eclipse-lemminx/lemminx", "LICENSE"),
    installCommand: "Download the binary release from https://github.com/eclipse-lemminx/lemminx/releases, or use the XML extension that bundles it",
    npmInstallable: false,
    caveat: "NOT permissive: EPL-2.0 (weak copyleft) — spawned from the user's install, never redistributed here. Schema validation only happens when the document points at a schema (`xsi:noNamespaceSchemaLocation`, a DOCTYPE or a catalogue), so a bare XML file gets syntax checks only.",
    extensions: ["xml", "xsd", "xsl", "xslt", "svg"],
    command: ["lemminx"],
    citations: [repoDoc("eclipse-lemminx/lemminx", "LICENSE")],
    verification: "primary"
  },
  {
    language: "vim",
    displayName: "Vim script",
    server: "vim-language-server",
    licence: "MIT",
    licenceUrl: npmPage("vim-language-server"),
    installCommand: "npm i -g vim-language-server",
    npmInstallable: true,
    caveat: "Its MIT licence rests on the npm MANIFEST: the repository (iamcco/vim-language-server) has no root licence file to read, so treat the licence string as package-declared rather than repository-read.",
    extensions: ["vim"],
    command: ["vim-language-server", "--stdio"],
    citations: [npmDoc("vim-language-server")],
    verification: "primary"
  },
  {
    language: "assembly",
    displayName: "Assembly (GAS / NASM / MASM)",
    server: "asm-lsp",
    licence: "BSD-2-Clause",
    licenceUrl: repoDoc("bergercookie/asm-lsp", "LICENSE"),
    installCommand: "cargo install asm-lsp",
    npmInstallable: false,
    caveat: "Reads the assembler dialect from `.asm-lsp.toml` in the workspace; without that file it falls back to a generic parser and hover/completion stay coarse.",
    extensions: ["asm", "s"],
    command: ["asm-lsp"],
    citations: [repoDoc("bergercookie/asm-lsp", "LICENSE")],
    verification: "primary"
  },
  {
    language: "powershell",
    displayName: "PowerShell",
    server: "PowerShell Editor Services",
    licence: "MIT",
    licenceUrl: repoDoc("PowerShell/PowerShellEditorServices", "LICENSE"),
    installCommand: "Install the PowerShellEditorServices module (it runs as a PowerShell 7+ module rather than a standalone binary)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command and the argv: the project is distributed mainly inside the editor extension and runs as a module script, so no single install line and no standalone executable could be confirmed. The probe below therefore looks for the module's script name, and this row stays out of the generated config until that name is on PATH.",
    extensions: ["ps1", "psm1", "psd1"],
    command: ["Start-EditorServices.ps1"],
    citations: [repoDoc("PowerShell/PowerShellEditorServices", "LICENSE"), readme("PowerShell/PowerShellEditorServices")],
    verification: "unverified"
  },
  {
    language: "tex",
    displayName: "LaTeX / BibTeX",
    server: "texlab",
    licence: "GPL-3.0",
    licenceUrl: repoDoc("latex-lsp/texlab", "LICENSE"),
    installCommand: "Install from your package manager, or build with `cargo install --git https://github.com/latex-lsp/texlab --locked --tag <version>`",
    npmInstallable: false,
    caveat: "NOT permissive: GPL-3.0 (strong copyleft) — spawned from the user's install, never redistributed here. The README explicitly warns against the stale crates.io release, which is why the quoted command builds from the tagged git source.",
    extensions: ["tex", "bib"],
    command: ["texlab"],
    citations: [repoDoc("latex-lsp/texlab", "LICENSE"), readme("latex-lsp/texlab")],
    verification: "primary"
  },
  {
    language: "elm",
    displayName: "Elm",
    server: "elm-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("elm-tooling/elm-language-server", "LICENSE"),
    installCommand: "npm install -g @elm-tooling/elm-language-server",
    npmInstallable: true,
    caveat: "Needs `elm`, `elm-format` and `elm-test` on PATH for the features that call out to them; without elm-format the formatting requests fail rather than degrade quietly.",
    extensions: ["elm"],
    command: ["elm-language-server", "--stdio"],
    citations: [npmDoc("@elm-tooling/elm-language-server"), repoDoc("elm-tooling/elm-language-server", "LICENSE"), readme("elm-tooling/elm-language-server")],
    verification: "primary"
  },
  {
    language: "solidity",
    displayName: "Solidity",
    server: "solidity-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("NomicFoundation/hardhat-vscode", "LICENSE"),
    installCommand: "npm install -g @nomicfoundation/solidity-language-server",
    npmInstallable: true,
    caveat: "The executable is `nomicfoundation-solidity-language-server`, much longer than the package name; it works on a Foundry or Hardhat project and takes compiler settings from the project's own config.",
    extensions: ["sol"],
    command: ["nomicfoundation-solidity-language-server"],
    citations: [npmDoc("@nomicfoundation/solidity-language-server"), repoDoc("NomicFoundation/hardhat-vscode", "LICENSE")],
    verification: "primary"
  },
  {
    language: "prisma",
    displayName: "Prisma schema",
    server: "Prisma language server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("prisma/language-tools", "LICENSE"),
    installCommand: "npm install -g @prisma/language-server",
    npmInstallable: true,
    caveat: "Understands the schema language only: it formats and validates `schema.prisma`, while the generated client's types stay TypeScript's business.",
    extensions: ["prisma"],
    command: ["prisma-language-server", "--stdio"],
    citations: [npmDoc("@prisma/language-server"), repoDoc("prisma/language-tools", "LICENSE")],
    verification: "primary"
  },
  {
    language: "typst",
    displayName: "Typst",
    server: "tinymist",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("Myriad-Dreamin/tinymist", "LICENSE"),
    installCommand: "Download a prebuilt from https://github.com/Myriad-Dreamin/tinymist/releases",
    npmInstallable: false,
    caveat: "The fastest-moving Typst tooling and the engine behind the official editor extension; the release assets carry per-platform binaries, so pick the archive for your OS and put `tinymist` on PATH.",
    extensions: ["typ"],
    command: ["tinymist"],
    citations: [repoDoc("Myriad-Dreamin/tinymist", "LICENSE"), readme("Myriad-Dreamin/tinymist")],
    verification: "primary"
  },
  {
    language: "perl",
    displayName: "Perl",
    server: "PerlNavigator",
    licence: "MIT",
    licenceUrl: repoDoc("bscan/PerlNavigator", "LICENSE"),
    installCommand: "sudo npm install -g perlnavigator-server",
    npmInstallable: true,
    caveat: "The npm package is the editor-facing wrapper around the server; it needs `perl` on PATH and reads a `.perlnavigator.json` for include paths.",
    extensions: ["pl", "pm", "t"],
    command: ["perlnavigator"],
    citations: [npmDoc("perlnavigator-server"), repoDoc("bscan/PerlNavigator", "LICENSE"), readme("bscan/PerlNavigator")],
    verification: "primary"
  },
  {
    language: "groovy",
    displayName: "Groovy",
    server: "groovy-language-server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("GroovyLanguageServer/groovy-language-server", "LICENSE"),
    installCommand: "Build from a checkout with Gradle (`./gradlew build`) and run the produced jar",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: the project ships no package-manager route and its README documents a source build only, so no single install line could be quoted. Requires a JDK.",
    extensions: ["groovy", "gvy"],
    command: ["groovy-language-server"],
    citations: [repoDoc("GroovyLanguageServer/groovy-language-server", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "vhdl",
    displayName: "VHDL",
    server: "VHDL-LS",
    licence: "MPL-2.0",
    licenceUrl: repoDoc("VHDL-LS/rust_hdl", "LICENSE.txt"),
    installCommand: "Download a release from https://github.com/VHDL-LS/rust_hdl/releases, or build with `cargo install --path vhdl_ls` from a checkout",
    npmInstallable: false,
    caveat: "NOT permissive: MPL-2.0 (file-level copyleft). The binary is `vhdl_ls`; the README's install step builds `vhdl_lang` first, which is why the quoted command is the second of the two.",
    extensions: ["vhd", "vhdl"],
    command: ["vhdl_ls"],
    citations: [repoDoc("VHDL-LS/rust_hdl", "LICENSE.txt"), readme("VHDL-LS/rust_hdl")],
    verification: "primary"
  },
  {
    language: "nickel",
    displayName: "Nickel",
    server: "nls (built into the Nickel CLI)",
    licence: "MIT",
    licenceUrl: repoDoc("tweag/nickel", "LICENSE"),
    installCommand: "Install the Nickel CLI from https://nickel-lang.org",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the language server is a subcommand of the compiler CLI, and no install line for it could be quoted from a fetched document. Requires the `nickel` CLI on PATH.",
    extensions: ["ncl"],
    command: ["nickel", "lsp"],
    citations: [repoDoc("tweag/nickel", "LICENSE")],
    verification: "unverified"
  }
];

// packages/mpd-mcp-lsp/src/cclsp-config.ts
var GENERATED_CONFIG_RELATIVE_PATH = ".mpd/lsp/cclsp.json";
var FALLBACK_TYPESCRIPT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
function isExecutableFile(path) {
  try {
    const stats = statSync2(path);
    if (!stats.isFile())
      return false;
    if (process.platform === "win32")
      return true;
    return (stats.mode & 73) !== 0;
  } catch {
    return false;
  }
}
function probeExecutable(name, root) {
  const trimmed = name.trim();
  if (trimmed.length === 0)
    return null;
  if (isAbsolute(trimmed) || trimmed.includes("/")) {
    return isExecutableFile(trimmed) ? trimmed : null;
  }
  const local = join3(root, "node_modules", ".bin", trimmed);
  if (isExecutableFile(local))
    return local;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.trim().length === 0)
      continue;
    const candidate = join3(dir, trimmed);
    if (isExecutableFile(candidate))
      return candidate;
  }
  return null;
}
function buildConfigDocument(options) {
  const catalog = options.catalog ?? LANGUAGE_SERVERS;
  const probe = options.probe ?? ((name) => probeExecutable(name, options.root));
  const servers = [];
  const typescriptRow = catalog.find((entry) => entry.language === "typescript");
  if (options.typescriptCommand !== undefined && options.typescriptCommand !== null) {
    servers.push({
      extensions: typescriptRow?.extensions ?? FALLBACK_TYPESCRIPT_EXTENSIONS,
      command: options.typescriptCommand,
      rootDir: options.root
    });
  }
  const byCommand = new Map;
  for (const entry of catalog) {
    if (entry.language === "typescript")
      continue;
    const resolved = probe(entry.command[0]);
    if (resolved === null)
      continue;
    const command = [resolved, ...entry.command.slice(1)];
    const key = JSON.stringify(command);
    const existing = byCommand.get(key);
    if (existing === undefined) {
      const row = { extensions: [...entry.extensions], command, rootDir: options.root };
      byCommand.set(key, row);
      servers.push(row);
      continue;
    }
    for (const extension of entry.extensions) {
      if (!existing.extensions.includes(extension))
        existing.extensions.push(extension);
    }
  }
  return { servers };
}
function ensureConfigPath(options) {
  const configured = (options.env.CCLSP_CONFIG_PATH ?? "").trim();
  if (configured.length > 0) {
    return { path: configured, source: "env", serverCount: 0, wrote: false };
  }
  const projectConfig = join3(options.root, "cclsp.json");
  if (existsSync2(projectConfig)) {
    options.env.CCLSP_CONFIG_PATH = projectConfig;
    return { path: projectConfig, source: "workspace", serverCount: 0, wrote: false };
  }
  const generated = join3(options.root, GENERATED_CONFIG_RELATIVE_PATH);
  try {
    const document = options.build();
    const body = JSON.stringify(document, null, 2) + `
`;
    let existing;
    try {
      existing = readFileSync2(generated, "utf8");
    } catch {
      existing = null;
    }
    const stale = existing !== body;
    if (stale) {
      mkdirSync2(join3(options.root, ".mpd", "lsp"), { recursive: true });
      writeFileSync(generated, body);
    }
    options.env.CCLSP_CONFIG_PATH = generated;
    return { path: generated, source: "generated", serverCount: document.servers.length, wrote: stale };
  } catch {
    return { path: null, source: "unavailable", serverCount: 0, wrote: false };
  }
}

// packages/mpd-mcp-lsp/src/launch.ts
var DEPENDENCY = "cclsp";
var DEPENDENCY_BIN = "cclsp";
var TS_LANGUAGE_SERVER = "typescript-language-server";
var sink = installTerminalSilence("mpd-mcp-lsp");
var dependency = resolveDependencyEntry(import.meta.url, DEPENDENCY, DEPENDENCY_BIN);
function generatedConfig(configRoot, packageJson) {
  const languageServer = resolveDependencyEntry(pathToFileURL(packageJson).href, TS_LANGUAGE_SERVER, TS_LANGUAGE_SERVER);
  const command = languageServer === null ? null : [process.execPath, languageServer.entry, "--stdio"];
  return buildConfigDocument({ root: configRoot, typescriptCommand: command });
}
function publishConfigPath(root, packageJson) {
  const outcome = ensureConfigPath({
    root,
    env: process.env,
    build: () => generatedConfig(root, packageJson)
  });
  if (outcome.path === null) {
    sink.write("[mpd-mcp-lsp] could not supply a cclsp config under " + root + " (read-only workspace?)");
    return null;
  }
  sink.write("[mpd-mcp-lsp] cclsp config: " + outcome.path + " (" + describeSource(outcome) + ")");
  return outcome.path;
}
function describeSource(outcome) {
  if (outcome.source === "env")
    return "from CCLSP_CONFIG_PATH";
  if (outcome.source === "workspace")
    return "workspace root, left untouched";
  if (outcome.source === "generated") {
    return "generated, " + outcome.serverCount + " language server(s)" + (outcome.wrote ? "" : ", unchanged");
  }
  return "unavailable";
}
if (dependency === null) {
  await serveUnavailable(sink, {
    name: "mpd-mcp-lsp",
    reason: "the declared dependency " + DEPENDENCY + " is not installed in this profile",
    hint: "install the bundle's dependency closure (npm/pnpm install) and restart the session"
  });
  process.exitCode = 0;
} else {
  sink.write("[mpd-mcp-lsp] starting " + DEPENDENCY + "@" + dependency.version + " from " + dependency.entry);
  const root = resolveLogRoots()[0] ?? process.cwd();
  publishConfigPath(root, dependency.packageJson);
  const entry = dependency.entry;
  await import(entry);
}
