// Unit tests for the shared MCP binary resolver (wave-2 B8).
// Deterministic: every tier is a real temp directory; only the ast-grep
// `--version` probe is injected, except for the last test which measures the REAL
// toolchain wrappers (the whole point of the probe rule).
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveAstGrepBinary, resolveCodegraphBinary, probeAstGrep, bundleRootFrom } from "./bin-resolve.mjs"

function sandbox() {
  const s = mkdtempSync(join(tmpdir(), "mpd-bin-resolve-"))
  mkdirSync(join(s, "bundle", ".toolchain", "node_modules", ".bin"), { recursive: true })
  return s
}

function touch(p) {
  mkdirSync(join(p, ".."), { recursive: true })
  writeFileSync(p, "")
  return p
}

const okAstGrep = (p) => p.endsWith("ast-grep")
const launcher = "/nowhere/packages/mpd-mcp-astgrep/launch.mjs"

test("ast-grep: $MPD_AST_GREP_BIN_DIR tier wins and prefers ast-grep over sg", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  touch(join(dir, "ast-grep"))
  touch(join(dir, "sg"))
  const r = resolveAstGrepBinary(launcher, { env: { MPD_AST_GREP_BIN_DIR: dir }, probe: okAstGrep, bundleRoot: join(s, "bundle") })
  expect(r).not.toBeNull()
  expect(r.source).toBe("bin-dir")
  expect(r.binary).toBe(join(dir, "ast-grep"))
})

test("ast-grep: a candidate that fails the ast-grep probe is skipped, never accepted by name", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  touch(join(dir, "sg")) // the deprecated wrapper: exists, but --version is not ast-grep
  const r = resolveAstGrepBinary(launcher, { env: { MPD_AST_GREP_BIN_DIR: dir }, probe: () => false, bundleRoot: join(s, "bundle") })
  expect(r).toBeNull()
})

test("ast-grep: createRequire tier resolves the packed optionalDependency", () => {
  const s = sandbox()
  const pkg = join(s, "profile", "node_modules", "@ast-grep", "cli")
  touch(join(pkg, "ast-grep"))
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    probe: okAstGrep,
    bundleRoot: join(s, "bundle"),
    requireResolve: (spec) => (spec === "@ast-grep/cli/package.json" ? join(pkg, "package.json") : null),
  })
  expect(r).not.toBeNull()
  expect(r.source).toBe("require")
  expect(r.binary).toBe(join(pkg, "ast-grep"))
})

test("ast-grep: <bundle>/.toolchain tier resolves the link: checkout layout", () => {
  const s = sandbox()
  const toolchain = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "ast-grep"))
  const r = resolveAstGrepBinary(launcher, { env: {}, probe: okAstGrep, bundleRoot: join(s, "bundle") })
  expect(r).not.toBeNull()
  expect(r.source).toBe("toolchain")
  expect(r.binary).toBe(toolchain)
})

test("ast-grep: precedence is bin-dir > require > toolchain", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  const pkg = join(s, "profile", "node_modules", "@ast-grep", "cli")
  touch(join(dir, "ast-grep"))
  touch(join(pkg, "ast-grep"))
  touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "ast-grep"))
  const base = { probe: okAstGrep, bundleRoot: join(s, "bundle"), requireResolve: () => join(pkg, "package.json") }
  expect(resolveAstGrepBinary(launcher, { ...base, env: { MPD_AST_GREP_BIN_DIR: dir } }).source).toBe("bin-dir")
  expect(resolveAstGrepBinary(launcher, { ...base, env: {} }).source).toBe("require")
})

test("ast-grep: nothing resolvable returns null and never throws", () => {
  const s = sandbox()
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    probe: okAstGrep,
    bundleRoot: join(s, "bundle"),
    requireResolve: () => { throw new Error("no such package") },
  })
  expect(r).toBeNull()
})

test("codegraph: <bundle>/.toolchain tier resolves the link: checkout layout", () => {
  const s = sandbox()
  const bin = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "codegraph"))
  const r = resolveCodegraphBinary("/nowhere/packages/mpd-mcp-codegraph/launch.mjs", { bundleRoot: join(s, "bundle") })
  expect(r).not.toBeNull()
  expect(r.source).toBe("toolchain")
  expect(r.binary).toBe(bin)
})

test("codegraph: createRequire tier reads the package's own bin entry", () => {
  const s = sandbox()
  const pkg = join(s, "profile", "node_modules", "@colbymchenry", "codegraph")
  touch(join(pkg, "npm-shim.js"))
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@colbymchenry/codegraph", bin: { codegraph: "npm-shim.js" } }))
  const r = resolveCodegraphBinary("/nowhere/packages/mpd-mcp-codegraph/launch.mjs", {
    bundleRoot: join(s, "bundle"),
    requireResolve: (spec) => (spec === "@colbymchenry/codegraph/package.json" ? join(pkg, "package.json") : null),
  })
  expect(r).not.toBeNull()
  expect(r.source).toBe("require")
  expect(r.binary).toBe(join(pkg, "npm-shim.js"))
})

// --- win32 name expansion -------------------------------------------------
// A win32 install names a candidate through %PATHEXT% (the linker writes
// `node_modules/.bin/ast-grep.exe`), while POSIX names it bare. Measured 2026-09-22:
// with only the bare spelling offered, the ast_grep MCP answered BINARY_NOT_FOUND
// on win32 although `.bin/ast-grep.exe --version` printed `ast-grep 0.45.2`.
const okAstGrepSpelling = (p) => /ast-grep(\.(exe|com))?$/.test(p)

test("ast-grep: win32 resolves the .exe spelling of a candidate", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  const exe = touch(join(dir, "ast-grep.exe"))
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir },
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
  })
  expect(r).not.toBeNull()
  expect(r.binary).toBe(exe)
})

test("ast-grep: win32 honours the caller's own PATHEXT order", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  touch(join(dir, "ast-grep.exe"))
  const com = touch(join(dir, "ast-grep.com"))
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir, PATHEXT: ".COM;.EXE" },
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
  })
  expect(r.binary).toBe(com)
})

test("ast-grep: win32 never offers a .cmd/.bat candidate (a shell-less spawn cannot start one)", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  touch(join(dir, "ast-grep.cmd"))
  touch(join(dir, "ast-grep.bat"))
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir },
    platform: "win32",
    probe: () => true,
    bundleRoot: join(s, "bundle"),
  })
  expect(r).toBeNull()
})

test("ast-grep: POSIX keeps the bare name as the only spelling", () => {
  const s = sandbox()
  const dir = join(s, "cache")
  const bare = touch(join(dir, "ast-grep"))
  touch(join(dir, "ast-grep.exe"))
  const r = resolveAstGrepBinary(launcher, {
    env: { MPD_AST_GREP_BIN_DIR: dir },
    platform: "linux",
    probe: okAstGrep,
    bundleRoot: join(s, "bundle"),
  })
  expect(r.binary).toBe(bare)
})

test("ast-grep: <bundle>/node_modules/.bin tier resolves a bundle-root install", () => {
  const s = sandbox()
  const exe = touch(join(s, "bundle", "node_modules", ".bin", "ast-grep.exe"))
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
    requireResolve: () => { throw new Error("no such package") },
  })
  expect(r).not.toBeNull()
  expect(r.source).toBe("bundle-bin")
  expect(r.binary).toBe(exe)
})

test("ast-grep: .toolchain still wins over the bundle-root tier", () => {
  const s = sandbox()
  const toolchain = touch(join(s, "bundle", ".toolchain", "node_modules", ".bin", "ast-grep.exe"))
  touch(join(s, "bundle", "node_modules", ".bin", "ast-grep.exe"))
  const r = resolveAstGrepBinary(launcher, {
    env: {},
    platform: "win32",
    probe: okAstGrepSpelling,
    bundleRoot: join(s, "bundle"),
    requireResolve: () => { throw new Error("no such package") },
  })
  expect(r.source).toBe("toolchain")
  expect(r.binary).toBe(toolchain)
})

test("bundleRootFrom: <bundle>/packages/<pkg>/launch.mjs -> <bundle>", () => {
  // Platform-neutral fixture: `new URL("file:///x/y")` is not a valid file URL on
  // Windows (no drive letter), and fileURLToPath throws "File URL path must be an
  // absolute path". Build the URL FROM a native absolute path instead, so the two
  // dirname hops are what is asserted on every platform.
  const bundle = resolve("/x/y")
  expect(bundleRootFrom(pathToFileURL(join(bundle, "packages", "mpd-mcp-astgrep", "launch.mjs")).href)).toBe(bundle)
})

// The mandatory rule the captain re-measured: the real `.toolchain` `sg` entry is
// the DEPRECATED wrapper and fails the probe, while `ast-grep` passes it. This is
// the reason the resolver never names `.bin/sg` as an accepted candidate.
test("REAL toolchain probe: ast-grep passes, the deprecated sg wrapper fails", () => {
  const binDir = join(bundleRootFrom(import.meta.url), ".toolchain", "node_modules", ".bin")
  if (!existsSync(join(binDir, "ast-grep"))) {
    console.log("[bin-resolve test] toolchain absent — real-probe assertions skipped")
    return
  }
  expect(probeAstGrep(join(binDir, "ast-grep"))).toBe(true)
  expect(probeAstGrep(join(binDir, "sg"))).toBe(false)
})
