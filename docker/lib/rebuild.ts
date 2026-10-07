#!/usr/bin/env node
// docker/lib/rebuild.ts — rebuild every `packages/*/dist` entry from source, from the REPO ROOT.
//
// WHY THIS IS A SCRIPT AND NOT A SHELL GLOB: the entry set is not "every .ts under src/" — most
// src/*.ts files are internal modules bundled INTO an entry (mpd-config-plugin/src/bridge.ts,
// mpd-tui-plugin/src/scenes.ts, ...) and own no dist sibling. `scripts/verify-dist-fresh.ts` is
// the repository's authoritative discovery rule, and this helper mirrors it so a client install
// proves the same thing the gate does:
//   1. a same-name pair already on disk  -> src/<entry>.ts + dist/<entry>.js
//   2. an entry the package's own `scripts.build` declares with `--outfile dist/<name>.js`
//   3. the repo convention src/index.ts -> dist/index.js, for every package that has a src/ dir
// NON-.ts files under src/ are deliberately not demanded (they are bundled into an entry).
//
// The build command is the canonical one from AGENTS.md §6 — repo root, path-qualified args —
// because `bun build` embeds each bundled module's path RELATIVE TO CWD in the artifact, so a
// build run from a package directory is not the artifact the repository ships.
//
// Usage: node rebuild.ts --repo <dir> [--json <file>]
// Output contract (the entrypoint greps these prefixes):
//   [rebuild] ENTRIES=<n>
//   [rebuild] BUILD_OK=<built>/<total>
//   [rebuild] BUILD_FAILED=<src>:exit<code>,...
//   [rebuild] NO_SRC=<pkg>=<reason>,...
//   [rebuild] OK=true|false
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

/** One rebuildable entry: the package it lives in, its entry name, and the src→dist path pair. */
interface BuildTarget {
  /** The package directory name under `packages/`. */
  pkg: string
  /** The entry name shared by `src/<entry>.ts` and `dist/<entry>.js`. */
  entry: string
  /** Repo-relative source path handed to `bun build`. */
  src: string
  /** Repo-relative artifact path the build must produce. */
  dist: string
}

/** A package that legitimately owns no rebuildable `src/`, with the reason the repository records. */
interface NoSrcPackage {
  /** The package directory name under `packages/`. */
  pkg: string
  /** Why this package has no `src/` to rebuild. */
  reason: string
}

/** A package whose `src/` exists but declares no discoverable build entry. */
interface SkippedPackage {
  /** The package directory name under `packages/`. */
  pkg: string
  /** Why no entry could be discovered inside its `src/`. */
  reason: string
}

/** A failed build: the target, the child's exit code, the artifact size and the output tail. */
interface FailedBuild extends BuildTarget {
  /** The child's exit status (`null` when it was killed by a signal). */
  exit: number | null
  /** Size of the artifact on disk after the attempt; 0 means nothing was written. */
  bytes: number
  /** The last 1200 characters of the child's combined output, for the report. */
  output: string
}

/** The command line this script was invoked with, minus the node executable and script path. */
const argv: string[] = process.argv.slice(2)
/** Read `--<flag> <value>` off the command line, or `fallback` when the flag is absent/valueless. */
const arg = (flag: string, fallback: string = ""): string => {
  // Index of the flag token, or -1 when the caller never passed it.
  const index = argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
/** The repository root to rebuild — the tree is discovered by reading `packages/` under this path. */
const repo: string = arg("repo")
if (repo === "") {
  process.stderr.write("[rebuild] usage: rebuild.ts --repo <dir> [--json <file>]\n")
  process.exit(2)
}

/**
 * View an unknown JSON value as a string-keyed bag, so a parsed manifest can be read safely.
 *
 * @param value - A value produced by `JSON.parse` or read out of one.
 * @returns The value viewed as a bag, or `undefined` for a primitive (including `null`).
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the manifest is parsed JSON, so nothing about its shape is static.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/** Top-level `src/<name>.ts` files: never recursive, and `*.d.ts` is not a buildable entry. */
function srcEntries(pkgDir: string): string[] {
  // The package's source directory, which the caller has already confirmed exists.
  const dir = join(pkgDir, "src")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts"))
    .map((e) => basename(e.name, ".ts"))
}

/** dist/<name>.js files already committed in the tree under test. */
function distEntries(pkgDir: string): string[] {
  // The package's artifact directory; a package without one contributes no announced entry.
  const dir = join(pkgDir, "dist")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => basename(e.name, ".js"))
}

/** Entry names the package's own `scripts.build` declares through `--outfile dist/<name>.js`. */
function declaredEntries(pkgDir: string): string[] {
  // The package manifest that may carry a `scripts.build` command.
  const manifestPath = join(pkgDir, "package.json")
  if (!existsSync(manifestPath)) return []
  // The parsed manifest, kept `unknown` until its `scripts` block is narrowed below.
  let manifest: unknown
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) } catch { return [] }
  // Entry names declared by the package's own build commands, deduped by name.
  const found = new Set<string>()
  // The `scripts` block as a bag; a manifest without one declares no entries.
  const scripts = asRecord(asRecord(manifest)?.scripts)
  for (const command of Object.values(scripts ?? {})) {
    if (typeof command !== "string") continue
    for (const match of command.matchAll(/--outfile\s+(\S+)/g)) found.add(basename(match[1], ".js"))
  }
  return [...found]
}

/** Packages that legitimately own no rebuildable src/, with the reason the repository records. */
function noSrcReason(pkg: string): string {
  if (pkg === "mpd-mcp-codegraph") return "sha-pinned prebuilt vendored at pack time (no local src/)"
  if (pkg.startsWith("mpd-mcp-")) return "built offline by scripts/build-mcp.ts from the upstream checkout (no local src/)"
  return "package has no src/ directory (dist is the only committed artifact)"
}

/** The `packages/` directory of the tree under test; every discovery below starts here. */
const packagesDir = join(repo, "packages")
if (!existsSync(packagesDir)) {
  process.stderr.write(`[rebuild] no packages/ under ${repo}\n`)
  process.exit(2)
}
/** Package directory names to scan: dot-directories and `node_modules` are never packages. */
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
  .map((e) => e.name)
  .sort()

/** Entries to build: one per discovered src/dist pair across every package. */
const targets: BuildTarget[] = []
/** Packages with no `src/` at all, each with its recorded reason. */
const noSrc: NoSrcPackage[] = []
/** Packages whose `src/` declares no discoverable entry (nothing to build, nothing wrong). */
const skipped: SkippedPackage[] = []
for (const pkg of packages) {
  // The absolute directory of this package inside the tree under test.
  const pkgDir = join(packagesDir, pkg)
  if (!existsSync(join(pkgDir, "src"))) { noSrc.push({ pkg, reason: noSrcReason(pkg) }); continue }
  // Entry names this package could actually build (a same-name `src/<entry>.ts`).
  const available = new Set(srcEntries(pkgDir))
  // Entry names demanded by the tree: committed dist siblings, declared build commands, and `index`.
  const wanted = new Set([...distEntries(pkgDir), ...declaredEntries(pkgDir), "index"])
  // The demanded entries that exist in src/, sorted so the build order is stable across hosts.
  const entries = [...wanted].filter((entry) => available.has(entry)).sort()
  if (entries.length === 0) { skipped.push({ pkg, reason: "src/ exists but owns no discoverable build entry" }); continue }
  for (const entry of entries) {
    targets.push({
      pkg,
      entry,
      src: `packages/${pkg}/src/${entry}.ts`,
      dist: `packages/${pkg}/dist/${entry}.js`,
    })
  }
}

/** Targets that produced a non-empty artifact with exit 0. */
const built: BuildTarget[] = []
/** Targets that failed, with the child's exit code, artifact size and output tail. */
const failed: FailedBuild[] = []
for (const target of targets) {
  // The canonical repo-root build: path-qualified args, run with `cwd` at the tree root.
  const result = spawnSync(
    "bun",
    ["build", target.src, "--target", "node", "--format", "esm", "--outfile", target.dist],
    { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  // The child's combined output, kept only as a tail for a failure report.
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`
  // The artifact path the success criterion is measured on (non-empty output file).
  const distPath = join(repo, target.dist)
  // Artifact size in bytes, or 0 when the build wrote nothing.
  const distBytes = existsSync(distPath) ? statSync(distPath).size : 0
  // A build counts as OK only when the child exited 0 AND a non-empty artifact exists.
  const ok = result.status === 0 && distBytes > 0
  console.log(`[rebuild] ${ok ? "OK  " : "FAIL"} ${target.src} -> ${target.dist} (exit=${result.status} bytes=${distBytes})`)
  if (ok) built.push(target)
  else failed.push({ ...target, exit: result.status, bytes: distBytes, output: out.slice(-1200) })
}

console.log(`[rebuild] ENTRIES=${targets.length}`)
console.log(`[rebuild] BUILD_OK=${built.length}/${targets.length}`)
console.log(`[rebuild] BUILD_FAILED=${failed.map((f) => `${f.src}:exit${f.exit}`).join(",")}`)
console.log(`[rebuild] NO_SRC=${noSrc.map((n) => `${n.pkg}=${n.reason}`).join(",")}`)
console.log(`[rebuild] SKIPPED_SRC=${skipped.map((s) => `${s.pkg}=${s.reason}`).join(",")}`)
console.log(`[rebuild] OK=${failed.length === 0 && targets.length > 0}`)

/** Optional `--json <file>` destination for the machine-readable copy of the same verdict. */
const jsonPath: string = arg("json")
if (jsonPath !== "") {
  writeFileSync(jsonPath, JSON.stringify({
    ok: failed.length === 0 && targets.length > 0,
    repo,
    entries: targets.length,
    built: built.map((b) => b.dist),
    failed,
    noSrc,
    skipped,
  }, null, 2))
}
process.exit(failed.length === 0 && targets.length > 0 ? 0 : 1)
