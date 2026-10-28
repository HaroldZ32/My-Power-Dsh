// Unit tests for the shared MCP binary resolver (wave-2 B8).
// Deterministic: every tier is a real temp directory; only the ast-grep
// `--version` probe is injected, except for the last test which measures the REAL
// toolchain wrappers (the whole point of the probe rule).
//
// Typing note: each case asserts a non-null resolution before reading `binary`/`source`, and the
// `!` non-null assertions below are the type-level expression of that assertion (erased at
// runtime, so the assertions themselves stay the check).
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveAstGrepBinary, resolveCodegraphBinary, probeAstGrep, bundleRootFrom, codegraphPlatformPackage, hasCodegraphPlatformBundle } from "./bin-resolve.ts"
import type { ResolvedBinary } from "./bin-resolve.ts"
import type { ResolverOptions } from "./bin-resolve.ts"

/** A fresh temp tree that already carries the `<bundle>/.toolchain/.../.bin` layout. */
function sandbox(): string {
  /** The temp root every tier of a case is built under. */
  const s = mkdtempSync(join(tmpdir(), "mpd-bin-resolve-"))
  mkdirSync(join(s, "bundle", ".toolchain", "node_modules", ".bin"), { recursive: true })
  return s
}

/** Create an empty file (with its parent directories) and return its path. */
function touch(p: string): string {
  mkdirSync(join(p, ".."), { recursive: true })
  writeFileSync(p, "")
  return p
}

/**
 * The files upstream's shim resolves inside a per-platform package, for the platform under test:
 * the POSIX launcher script, or — on win32 — the bundled runtime AND the app entry it runs.
 *
 * @param platform - The platform whose launcher files are wanted (defaults to this host's).
 * @returns The relative paths a complete install of the per-platform package carries.
 */
function platformLauncherFiles(platform: string = process.platform): string[] {
  return platform === "win32"
    ? ["node.exe", join("lib", "dist", "bin", "codegraph.js")]
    : [join("bin", "codegraph")]
}

/**
 * Create every launcher file of a per-platform package, so one fixture serves every host.
 *
 * @param packageDir - The per-platform package's directory.
 * @param platform - The platform whose launcher files to create (defaults to this host's).
 */
function touchPlatformLaunchers(packageDir: string, platform: string = process.platform): void {
  for (const file of platformLauncherFiles(platform)) touch(join(packageDir, file))
}

/** The injected acceptance probe for the ast-grep cases: accept only an `ast-grep` name. */
const okAstGrep = (p: string): boolean => p.endsWith("ast-grep")
/** A launcher URL that is never dereferenced, because every case injects its own bundle root. */
const launcher = "/nowhere/packages/mpd-mcp-astgrep/dist/launch.js"

test("ast-grep: $MPD_AST_GREP_BIN_DIR tier wins and prefers ast-grep over sg", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The upstream-contract binary directory, holding both names. */
  const dir = join(s, "cache")
  touch(join(dir, "ast-grep"))
  touch(join(dir, "sg"))
  /** The resolution this case asserts on. */
  const r = resolveAstGrepBinary(launcher, { env: { MPD_AST_GREP_BIN_DIR: dir }, probe: okAstGrep, bundleRoot: join(s, "bundle") })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("bin-dir")
  expect(r!.binary).toBe(join(dir, "ast-grep"))
})

test("ast-grep: a candidate that fails the ast-grep probe is skipped, never accepted by name", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The binary directory holding only the deprecated `sg` wrapper. */
  const dir = join(s, "cache")
  touch(join(dir, "sg")) // the deprecated wrapper: exists, but --version is not ast-grep
  /** The resolution, which must refuse the candidate the probe rejected. */
  const r = resolveAstGrepBinary(launcher, { env: { MPD_AST_GREP_BIN_DIR: dir }, probe: () => false, bundleRoot: join(s, "bundle") })
  expect(r).toBeNull()
})

test("ast-grep: createRequire tier resolves the packed optionalDependency", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** A fake installed `@ast-grep/cli` package directory. */
  const pkg = join(s, "profile", "node_modules", "@ast-grep", "cli")
  touch(join(pkg, "ast-grep"))
  /** The resolution through the injected require tier. */
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    probe: okAstGrep,
    bundleRoot: join(s, "bundle"),
    requireResolve: (spec) => (spec === "@ast-grep/cli/package.json" ? join(pkg, "package.json") : null),
  })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("require")
  expect(r!.binary).toBe(join(pkg, "ast-grep"))
})

test("ast-grep: <bundle>/.toolchain tier resolves the link: checkout layout", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The linker's own `.bin` entry under the installer's private toolchain prefix. */
  const toolchain = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "ast-grep"))
  /** The resolution that must report the toolchain tier. */
  const r = resolveAstGrepBinary(launcher, { env: {}, probe: okAstGrep, bundleRoot: join(s, "bundle") })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("toolchain")
  expect(r!.binary).toBe(toolchain)
})

test("ast-grep: precedence is bin-dir > require > toolchain", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The env-contract binary directory. */
  const dir = join(s, "cache")
  /** A fake installed `@ast-grep/cli` package directory. */
  const pkg = join(s, "profile", "node_modules", "@ast-grep", "cli")
  touch(join(dir, "ast-grep"))
  touch(join(pkg, "ast-grep"))
  touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "ast-grep"))
  /** The options every tier of this case shares, so only the env differs. */
  const base: ResolverOptions = { probe: okAstGrep, bundleRoot: join(s, "bundle"), requireResolve: () => join(pkg, "package.json") }
  expect(resolveAstGrepBinary(launcher, { ...base, env: { MPD_AST_GREP_BIN_DIR: dir } })!.source).toBe("bin-dir")
  expect(resolveAstGrepBinary(launcher, { ...base, env: {} })!.source).toBe("require")
})

test("ast-grep: nothing resolvable returns null and never throws", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The resolution, which must swallow the failing require tier. */
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    probe: okAstGrep,
    bundleRoot: join(s, "bundle"),
    requireResolve: () => { throw new Error("no such package") },
  })
  expect(r).toBeNull()
})

test("codegraph: <bundle>/.toolchain tier resolves the link: checkout layout", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The linker's own `.bin` entry under the installer's private toolchain prefix. */
  const bin = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "codegraph"))
  /** The resolution that must report the toolchain tier (the bundle probe is pinned: this case is about precedence). */
  const r = resolveCodegraphBinary("/nowhere/packages/mpd-mcp-codegraph/dist/launch.js", { bundleRoot: join(s, "bundle"), platformBundle: () => true })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("toolchain")
  expect(r!.binary).toBe(bin)
})

test("codegraph: createRequire tier reads the package's own bin entry", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** A fake installed `@colbymchenry/codegraph` package directory. */
  const pkg = join(s, "profile", "node_modules", "@colbymchenry", "codegraph")
  touch(join(pkg, "npm-shim.js"))
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  /** The resolution through the injected require tier (the bundle probe is pinned: this case is about precedence). */
  const r = resolveCodegraphBinary("/nowhere/packages/mpd-mcp-codegraph/dist/launch.js", {
    bundleRoot: join(s, "bundle"),
    platformBundle: () => true,
    requireResolve: (spec) => (spec === "@colbymchenry/codegraph/package.json" ? join(pkg, "package.json") : null),
  })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("require")
  expect(r!.binary).toBe(join(pkg, "npm-shim.js"))
})

// --- D-3 (measured 2026-10-28): a codegraph shim is accepted only when its PER-PLATFORM bundle
// resolves. Upstream ships the executable as a thin `npm-shim.js` plus a per-platform OPTIONAL
// dependency, and npm counts an unfetchable optional dependency as success — so a registry mirror that
// skipped it leaves an existing shim that cannot start. Pinning such a shim is worse than a missing
// engine: the adopted resolver honours MPD_CODEGRAPH_BIN unconditionally and never reaches its own
// chain, so the row serves ZERO tools. The three one-click stamps whose npm toolchain install reported
// `added 4 packages` (instead of five) each lost `mcp__codegraph__codegraph_explore`; every
// `added 5` stamp kept it.
/** The per-platform package name this host's install would carry, split for a `node_modules` path. */
const platformParts = codegraphPlatformPackage(process.platform, process.arch).split("/")

/**
 * One install state: the main package (with its shim) present, the per-platform package present only
 * when `withBundle`. A FRESH tree per state, because resolution answers are memoised per directory —
 * a tree mutated between two calls would measure the memo, not the install state.
 *
 * @param withBundle - Whether the per-platform package (and its launcher file) is installed.
 * @returns The resolution, from the inputs a real launcher would hand the resolver.
 */
function resolveFromInstallState(withBundle: boolean): ResolvedBinary | null {
  /** The temp tree this state lives in. */
  const s = sandbox()
  /** The main package's directory, where upstream's shim sits. */
  const pkg = join(s, "profile", "node_modules", "@colbymchenry", "codegraph")
  touch(join(pkg, "npm-shim.js"))
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  // The platform's OWN launcher files: win32 needs node.exe + the app entry, POSIX the script.
  if (withBundle) touchPlatformLaunchers(join(s, "profile", "node_modules", ...platformParts))
  return resolveCodegraphBinary("/nowhere/packages/mpd-mcp-codegraph/dist/launch.js", {
    bundleRoot: join(s, "bundle"),
    requireResolve: (spec: string) => (spec === "@colbymchenry/codegraph/package.json" ? join(pkg, "package.json") : null),
  })
}

test("codegraph: a shim whose per-platform bundle is missing is skipped, never pinned (the D-3 state)", () => {
  // `added 4 packages` in the one-click lane: NOTHING may be pinned, so the adopted chain can answer.
  expect(resolveFromInstallState(false)).toBeNull()
  // `added 5 packages` in the same lane: the identical inputs now accept the shim.
  /** The resolution of the complete install state. */
  const healthy = resolveFromInstallState(true)
  expect(healthy).not.toBeNull()
  expect(healthy!.source).toBe("require")
})

test("codegraph platform bundle: win32 needs BOTH the runtime and the app entry", () => {
  /** A resolver that answers for the specifiers in `available` and misses everything else. */
  const only = (...available: string[]): ((spec: string) => string | null) => (spec: string): string | null =>
    available.some((suffix) => spec.endsWith(suffix)) ? "/pretend/present" : null
  /** The runtime alone: the state a half-installed Windows bundle leaves (upstream then cannot start). */
  expect(hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/node.exe") })).toBe(false)
  /** The app alone has no runtime to run it. */
  expect(hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/lib/dist/bin/codegraph.js") })).toBe(false)
  /** Both, which is what upstream resolves before it spawns: accepted. */
  expect(hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: only("/node.exe", "/lib/dist/bin/codegraph.js") })).toBe(true)
})

test("codegraph platform bundle: the .bin symlink is anchored at its REAL location (nested layout)", () => {
  /** A temp tree holding an unhoisted install: the package lives under `vendor/`, `.bin` links to it. */
  const root = mkdtempSync(join(tmpdir(), "mpd-codegraph-nested-"))
  /** The real package directory, outside `node_modules`, as npm's `nested` layout leaves it. */
  const vendorPkg = join(root, "vendor", "@colbymchenry", "codegraph")
  touch(join(vendorPkg, "npm-shim.js"))
  writeFileSync(join(vendorPkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  /** The shim the `.bin` link points at. */
  const shim = join(vendorPkg, "npm-shim.js")
  // The platform package sits under the TARGET package's own node_modules, where only an anchored
  // search looks; the `.bin` directory has no copy of it.
  touchPlatformLaunchers(join(vendorPkg, "node_modules", ...platformParts))
  /** The `.bin` entry the resolver accepts by existence — a symlink, as every npm layout produces. */
  const binLink = join(root, "node_modules", ".bin", "codegraph")
  mkdirSync(join(binLink, ".."), { recursive: true })
  symlinkSync(relative(join(binLink, ".."), shim), binLink)
  // Anchored (the default): the question is asked from the shim's real location, so it is found.
  expect(hasCodegraphPlatformBundle(binLink)).toBe(true)
  // Identical inputs, searched from the symlink's own directory: rejected. This is the arm that makes
  // the anchor falsifiable — an unanchored probe would lose a usable shim.
  expect(hasCodegraphPlatformBundle(binLink, { anchor: (path: string): string => path })).toBe(false)
})

test("codegraph: an unusable first candidate falls THROUGH to the next usable tier", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The healthy linker tier, which must answer once the broken require tier is refused. */
  const bin = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "codegraph"))
  /** A require tier that proposes a candidate the probe will refuse. */
  const broken = touch(join(s, "profile", "node_modules", "@colbymchenry", "codegraph", "npm-shim.js"))
  writeFileSync(join(s, "profile", "node_modules", "@colbymchenry", "codegraph", "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  /** The resolution: only the toolchain candidate may be accepted. */
  const r = resolveCodegraphBinary("/nowhere/packages/mpd-mcp-codegraph/dist/launch.js", {
    bundleRoot: join(s, "bundle"),
    requireResolve: (spec) => (spec === "@colbymchenry/codegraph/package.json" ? join(s, "profile", "node_modules", "@colbymchenry", "codegraph", "package.json") : null),
    platformBundle: (shim) => shim !== broken,
  })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("toolchain")
  expect(r!.binary).toBe(bin)
})

test("codegraph platform bundle: the package name and the per-platform file are upstream's own", () => {
  expect(codegraphPlatformPackage("linux", "x64")).toBe("@colbymchenry/codegraph-linux-x64")
  expect(codegraphPlatformPackage("darwin", "arm64")).toBe("@colbymchenry/codegraph-darwin-arm64")
  expect(codegraphPlatformPackage("win32", "x64")).toBe("@colbymchenry/codegraph-win32-x64")
  /** The specifiers each platform's question uses, captured instead of resolved. */
  const asked: string[] = []
  /** A resolver that records the specifier and answers "installed". */
  const resolveUsable = (spec: string): string | null => {
    asked.push(spec)
    return "/pretend/installed"
  }
  expect(hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "win32", arch: "x64", resolve: resolveUsable })).toBe(true)
  expect(hasCodegraphPlatformBundle("/pretend/npm-shim.js", { platform: "linux", arch: "x64", resolve: resolveUsable })).toBe(true)
  expect(asked).toEqual([
    "@colbymchenry/codegraph-win32-x64/node.exe",
    "@colbymchenry/codegraph-win32-x64/lib/dist/bin/codegraph.js",
    "@colbymchenry/codegraph-linux-x64/bin/codegraph"
  ])
  // An absent shim is not an error: the question answers false and never throws.
  expect(hasCodegraphPlatformBundle(join(sandbox(), "absent", "npm-shim.js"))).toBe(false)
})

// --- win32 name expansion -------------------------------------------------
// A win32 install names a candidate through %PATHEXT% (the linker writes
// `node_modules/.bin/ast-grep.exe`), while POSIX names it bare. Measured 2026-09-22:
// with only the bare spelling offered, the ast_grep MCP answered BINARY_NOT_FOUND
// on win32 although `.bin/ast-grep.exe --version` printed `ast-grep 0.45.2`.
/** The injected probe for the win32 cases: accept `ast-grep`, with or without a spawnable suffix. */
const okAstGrepSpelling = (p: string): boolean => /ast-grep(\.(exe|com))?$/.test(p)

test("ast-grep: win32 resolves the .exe spelling of a candidate", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The binary directory holding the native win32 spelling. */
  const dir = join(s, "cache")
  /** The `.exe` candidate the resolver must pick. */
  const exe = touch(join(dir, "ast-grep.exe"))
  /** The resolution that must name the `.exe`. */
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir },
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
  })
  expect(r).not.toBeNull()
  expect(r!.binary).toBe(exe)
})

test("ast-grep: win32 honours the caller's own PATHEXT order", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The binary directory holding both win32 spellings. */
  const dir = join(s, "cache")
  touch(join(dir, "ast-grep.exe"))
  /** The `.com` candidate, which the caller's PATHEXT order puts first. */
  const com = touch(join(dir, "ast-grep.com"))
  /** The resolution that must follow PATHEXT rather than a built-in order. */
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir, PATHEXT: ".COM;.EXE" },
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
  })
  expect(r!.binary).toBe(com)
})

test("ast-grep: win32 never offers a .cmd/.bat candidate (a shell-less spawn cannot start one)", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The binary directory holding only the two unrunnable shim spellings. */
  const dir = join(s, "cache")
  touch(join(dir, "ast-grep.cmd"))
  touch(join(dir, "ast-grep.bat"))
  /** The resolution, which must refuse both shims even though the existence probe passes. */
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir },
    platform: "win32",
    probe: () => true,
    bundleRoot: join(s, "bundle"),
  })
  expect(r).toBeNull()
})

test("ast-grep: POSIX keeps the bare name as the only spelling", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The binary directory holding both the bare name and a win32-looking `.exe`. */
  const dir = join(s, "cache")
  /** The bare candidate a POSIX host must pick. */
  const bare = touch(join(dir, "ast-grep"))
  touch(join(dir, "ast-grep.exe"))
  /** The POSIX resolution. */
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir },
    platform: "linux",
    probe: okAstGrep,
    bundleRoot: join(s, "bundle"),
  })
  expect(r!.binary).toBe(bare)
})

test("ast-grep: <bundle>/node_modules/.bin tier resolves a bundle-root install", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The bundle-root `.bin` entry a `bun install` inside the checkout writes. */
  const exe = touch(join(s, "bundle", "node_modules", ".bin", "ast-grep.exe"))
  /** The resolution that must fall through to the bundle-root tier. */
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
    requireResolve: () => { throw new Error("no such package") },
  })
  expect(r).not.toBeNull()
  expect(r!.source).toBe("bundle-bin")
  expect(r!.binary).toBe(exe)
})

test("ast-grep: .toolchain still wins over the bundle-root tier", () => {
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** The installer's private toolchain entry, which outranks the bundle root. */
  const toolchain = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "ast-grep.exe"))
  touch(join(s, "bundle", "node_modules", ".bin", "ast-grep.exe"))
  /** The resolution that must report the toolchain tier. */
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
    requireResolve: () => { throw new Error("no such package") },
  })
  expect(r!.source).toBe("toolchain")
  expect(r!.binary).toBe(toolchain)
})

test("bundleRootFrom: the BUILT <bundle>/packages/<pkg>/dist/launch.js -> <bundle>", () => {
  // THE LAYOUT THE PACKED INSTALL RUNS. `dirname` plus two hops answers `<bundle>/packages` here, so a
  // hop-counting resolver silently returns the wrong root — measured 2026-10-03, when the launcher moved
  // to `dist/` to escape `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** A real bundle root, marked by the manifest the walk looks for. */
  const bundle = join(s, "bundle")
  writeFileSync(join(bundle, "package.json"), JSON.stringify({ name: "@mpd-dsh/mpd" }))
  /** The built launcher's own path, at the depth the packed install uses. */
  const built = join(bundle, "packages", "mpd-mcp-astgrep", "dist", "launch.js")
  touch(built)
  expect(bundleRootFrom(pathToFileURL(built).href)).toBe(bundle)
})

test("bundleRootFrom: the older <bundle>/packages/<pkg>/launch.ts depth still answers <bundle>", () => {
  // The pre-move depth, kept because a checkout that has not been rebuilt still carries it.
  /** The temp tree this case resolves inside. */
  const s = sandbox()
  /** A real bundle root, marked by the manifest the walk looks for. */
  const bundle = join(s, "bundle")
  writeFileSync(join(bundle, "package.json"), JSON.stringify({ name: "@mpd-dsh/mpd" }))
  /** The launcher at the deep-source depth. */
  const source = join(bundle, "packages", "mpd-mcp-astgrep", "launch.ts")
  touch(source)
  expect(bundleRootFrom(pathToFileURL(source).href)).toBe(bundle)
})

test("bundleRootFrom: a launcher outside any bundle falls back to two hops", () => {
  // Platform-neutral fixture: `new URL("file:///x/y")` is not a valid file URL on Windows (no drive
  // letter) and fileURLToPath throws, so the URL is built FROM a native absolute path.
  /** A native absolute `<bundle>` path to build the fixture URL from. */
  const bundle = resolve("/x/y")
  expect(bundleRootFrom(pathToFileURL(join(bundle, "packages", "mpd-mcp-astgrep", "launch.ts")).href)).toBe(bundle)
})

// The mandatory rule the captain re-measured: the real `.toolchain` `sg` entry is
// the DEPRECATED wrapper and fails the probe, while `ast-grep` passes it. This is
// the reason the resolver never names `.bin/sg` as an accepted candidate.
test("REAL toolchain probe: ast-grep passes, the deprecated sg wrapper fails", () => {
  /** The checkout's own toolchain `.bin`, where both real wrappers live. */
  const binDir = join(bundleRootFrom(import.meta.url), ".toolchain", "node_modules", ".bin")
  if (!existsSync(join(binDir, "ast-grep"))) {
    console.log("[bin-resolve test] toolchain absent — real-probe assertions skipped")
    return
  }
  expect(probeAstGrep(join(binDir, "ast-grep"))).toBe(true)
  expect(probeAstGrep(join(binDir, "sg"))).toBe(false)
})
