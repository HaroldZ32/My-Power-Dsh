#!/usr/bin/env node
// docker/lib/rebuild.mjs — rebuild every `packages/*/dist` entry from source, from the REPO ROOT.
//
// WHY THIS IS A SCRIPT AND NOT A SHELL GLOB: the entry set is not "every .ts under src/" — most
// src/*.ts files are internal modules bundled INTO an entry (mpd-config-plugin/src/bridge.ts,
// mpd-tui-plugin/src/scenes.ts, ...) and own no dist sibling. `scripts/verify-dist-fresh.mjs` is
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
// Usage: node rebuild.mjs --repo <dir> [--json <file>]
// Output contract (the entrypoint greps these prefixes):
//   [rebuild] ENTRIES=<n>
//   [rebuild] BUILD_OK=<built>/<total>
//   [rebuild] BUILD_FAILED=<src>:exit<code>,...
//   [rebuild] NO_SRC=<pkg>=<reason>,...
//   [rebuild] OK=true|false
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const argv = process.argv.slice(2)
const arg = (flag, fallback = "") => {
  const index = argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
const repo = arg("repo")
if (repo === "") {
  process.stderr.write("[rebuild] usage: rebuild.mjs --repo <dir> [--json <file>]\n")
  process.exit(2)
}

/** Top-level `src/<name>.ts` files: never recursive, and `*.d.ts` is not a buildable entry. */
function srcEntries(pkgDir) {
  const dir = join(pkgDir, "src")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts"))
    .map((e) => basename(e.name, ".ts"))
}

/** dist/<name>.js files already committed in the tree under test. */
function distEntries(pkgDir) {
  const dir = join(pkgDir, "dist")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => basename(e.name, ".js"))
}

/** Entry names the package's own `scripts.build` declares through `--outfile dist/<name>.js`. */
function declaredEntries(pkgDir) {
  const manifestPath = join(pkgDir, "package.json")
  if (!existsSync(manifestPath)) return []
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) } catch { return [] }
  const found = new Set()
  for (const command of Object.values(manifest.scripts ?? {})) {
    if (typeof command !== "string") continue
    for (const match of command.matchAll(/--outfile\s+(\S+)/g)) found.add(basename(match[1], ".js"))
  }
  return [...found]
}

/** Packages that legitimately own no rebuildable src/, with the reason the repository records. */
function noSrcReason(pkg) {
  if (pkg === "mpd-agent-teams-plugin") return "adopted upstream main code under lib/ (no src/)"
  if (pkg === "mpd-mcp-codegraph") return "sha-pinned prebuilt vendored at pack time (no local src/)"
  if (pkg.startsWith("mpd-mcp-")) return "built offline by scripts/build-mcp.mjs from the upstream checkout (no local src/)"
  return "package has no src/ directory (dist is the only committed artifact)"
}

const packagesDir = join(repo, "packages")
if (!existsSync(packagesDir)) {
  process.stderr.write(`[rebuild] no packages/ under ${repo}\n`)
  process.exit(2)
}
const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
  .map((e) => e.name)
  .sort()

const targets = []
const noSrc = []
const skipped = []
for (const pkg of packages) {
  const pkgDir = join(packagesDir, pkg)
  if (!existsSync(join(pkgDir, "src"))) { noSrc.push({ pkg, reason: noSrcReason(pkg) }); continue }
  const available = new Set(srcEntries(pkgDir))
  const wanted = new Set([...distEntries(pkgDir), ...declaredEntries(pkgDir), "index"])
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

const built = []
const failed = []
for (const target of targets) {
  const result = spawnSync(
    "bun",
    ["build", target.src, "--target", "node", "--format", "esm", "--outfile", target.dist],
    { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`
  const distPath = join(repo, target.dist)
  const distBytes = existsSync(distPath) ? statSync(distPath).size : 0
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

const jsonPath = arg("json")
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
