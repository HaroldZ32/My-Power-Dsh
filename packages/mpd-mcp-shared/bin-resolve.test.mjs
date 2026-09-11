// Unit tests for the shared MCP binary resolver (wave-2 B8).
// Deterministic: every tier is a real temp directory; only the ast-grep
// `--version` probe is injected, except for the last test which measures the REAL
// toolchain wrappers (the whole point of the probe rule).
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

test("bundleRootFrom: <bundle>/packages/<pkg>/launch.mjs -> <bundle>", () => {
  expect(bundleRootFrom("file:///x/y/packages/mpd-mcp-astgrep/launch.mjs")).toBe("/x/y")
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
