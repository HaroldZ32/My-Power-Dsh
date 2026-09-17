#!/usr/bin/env node
// Dist-freshness gate (friction item T-37).
//
// WHY THIS EXISTS: every plugin is loaded from its COMMITTED `packages/*/dist/*.js`, not from
// `src/`. A stale dist therefore keeps the whole unit-test suite green — `bun test` imports the
// SOURCE — and only fails in a mounted boot, where the harness imports the committed bundle. The
// measured shape of the defect: edit `src/index.ts`, forget `bun build`, ship; every gate passes
// and the installed plugin silently runs last week's code. This gate closes that class by
// REBUILDING each covered entry into a temp dir and diffing it byte-for-byte against the
// committed artifact.
//
// WHAT A GREEN RUN ACTUALLY COVERS (stated so no reader over-reads it):
//   * every `packages/<pkg>/src/<entry>.ts` that owns a committed `packages/<pkg>/dist/<entry>.js`
//     — the mapping is DERIVED (same-name pairs) plus whatever the package's own
//     `scripts.build` declares (`--outfile dist/<name>.js`), never a hand-written list;
//   * the repo convention `src/index.ts` -> `dist/index.js`, which must exist for every package
//     that has the source: source present with no committed artifact is a MISSING finding;
//   * NON-.ts files under `src/` (internal modules, `vendor/`, `*.d.ts`) are deliberately NOT
//     demanded as entries: they are bundled into an entry, so they own no dist sibling.
//
// DETERMINISM IS ENFORCED, NOT ASSUMED: every target is built TWICE into two separate temp
// directories (same basename, different dir, so the comparison isolates build nondeterminism
// rather than an outfile-path embed) and the two builds must be byte-identical. A build pair that
// differs is reported NONDETERMINISTIC with both hashes, because a byte-diff against a
// nondeterministic build proves nothing.
//
// THE GATE NEVER WRITES INTO THE TREE IT VERIFIES: the build output always goes to a fresh
// `mkdtemp` directory and `assertOutsideTree()` refuses any outfile resolved inside the verified
// root, so a `--outfile` slip can never rewrite a committed `dist/`.
//
// COVERAGE IS LOUD: `dist` files that no target maps to are printed in a NOT COVERED section with
// a derived reason (adopted main code / built offline by scripts/build-mcp.mjs / sha-pinned
// prebuilt / build metadata / no local source). The list is the complete complement of the
// covered set, so a committed dist file can never be silently skipped — the reason only explains,
// it never decides whether the file is listed.
//
// Usage:
//   node scripts/verify-dist-fresh.mjs [--json] [--quiet] [--only <substr>] [--keep-tmp]
//   node scripts/verify-dist-fresh.mjs --self-test
//   --root <dir>  point the gate at another tree (fixtures / self-test / QA); default = repo root.
//                 It exists because the self-test must run the REAL gate against a fixture.
//
// --json prints one JSON document on stdout and nothing else (safe to pipe).
// --quiet drops the per-target lines and the header; findings, NOT COVERED and the summary stay.
// --only <substr> limits which targets are built/checked (substring of the package name, the
//   source path or the dist path); a filter that matches no target is a zero-subject failure.
// --keep-tmp keeps the build temp dir and prints its path.
//
// Exit: 0 when every covered target is FRESH, 1 on any finding (STALE / MISSING /
// NONDETERMINISTIC / BUILD_FAILED / TIMEOUT / UNREADABLE / NO_TARGETS) or a bad flag (usage is
// printed to stderr). Builds run with a 60 s timeout each; the whole tree finishes in ~1 s.
//
// Lives under scripts/ (NOT skills/**) on purpose: skills/** is VENDOR_LOCK fingerprinted, and
// editing it would force a treeSha re-pin in the same commit.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(HERE, "..")
const BUILD_BIN = "bun"
const BUILD_TIMEOUT_MS = 60_000
const TMP_PREFIX = "mpd-dist-fresh-"
// `index` is the repo-wide entry convention (AGENTS.md §6: `bun build src/index.ts ... --outfile
// dist/index.js`); all other entries are learned from the package's own `scripts.build`.
const CONVENTION_ENTRY = "index"

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")
const toPosix = (p) => p.split(sep).join("/")
const relPosix = (root, abs) => toPosix(relative(root, abs))

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

/** Immediate subdirectories of `dir`, sorted; `node_modules` and dot dirs are never packages. */
function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Entry names available under `src/`: top-level `src/<name>.ts` only, never recursive, and
 * `*.d.ts` is skipped (a declaration file is not a buildable entry).
 */
function listSrcEntries(srcDir) {
  try {
    return readdirSync(srcDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name))
      .map((e) => e.name.replace(/\.tsx?$/, ""))
      .sort()
  } catch {
    return []
  }
}

/**
 * The (source, output) pairs a package's own `scripts.build` declares. This is the ONLY thing the
 * gate reads `scripts.build` for — the build it runs is always its own (fixed flags, temp
 * outfile), never the package's command line.
 */
function declaredOutputs(pkgDir) {
  const manifest = join(pkgDir, "package.json")
  if (!existsSync(manifest)) return []
  let build
  try {
    build = JSON.parse(readFileSync(manifest, "utf8"))?.scripts?.build
  } catch {
    return []
  }
  if (typeof build !== "string" || build === "") return []
  const pairs = []
  for (const segment of build.split("&&")) {
    const outfile = segment.match(/--outfile\s+(\S+)/)
    if (outfile === null) continue
    const outName = basename(outfile[1])
    if (!outName.endsWith(".js")) continue
    const outBase = outName.slice(0, -3)
    const source = segment.match(/bun\s+build\s+(\S+)/)
    const srcBase = source === null ? outBase : basename(source[1]).replace(/\.tsx?$/, "")
    pairs.push({ srcBase, outBase })
  }
  return pairs
}

/** Every file under `<root>/<relDir>`, recursively; dot dirs and `node_modules` are skipped. */
function walkFiles(root, relDir, out = []) {
  let entries
  try {
    entries = readdirSync(join(root, relDir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const rel = `${relDir}/${entry.name}`
    if (entry.isDirectory()) walkFiles(root, rel, out)
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/**
 * Why a `dist` file maps to no target. Explanatory ONLY: a file reaches this function because it
 * is already in the uncovered complement, so no rule can hide one — an unknown shape falls
 * through to the generic "no local source" reason and is still listed.
 */
function uncoveredReason(root, pkg, dist, ctx) {
  if (pkg === "mpd-agent-teams-plugin") return "adopted upstream main code under lib/ (no src/, never rebuilt here)"
  if (pkg === "mpd-bundle") return "bundle patch/config only — not a build artifact"
  if (!dist.endsWith(".js")) return "build metadata, not a bun build artifact"
  if (ctx.declaredNoSource.has(dist)) return "declared by scripts.build but its source file is absent (no local source)"
  if (pkg === "mpd-mcp-codegraph") return "sha-pinned prebuilt vendored at pack time (packages/mpd-mcp-codegraph/README.md) — no local src/"
  if (pkg.startsWith("mpd-mcp-")) return "built offline by scripts/build-mcp.mjs from the upstream checkout — no local src/"
  if (!existsSync(join(root, "packages", pkg, "src"))) return "package has no src/ directory (dist is the only committed artifact)"
  return `no src/${basename(dist, ".js")}.ts for this dist file`
}

/**
 * Derive the target set, the missing-artifact findings' subjects and the uncovered dist files.
 * A target is `src/<entry>.ts` -> `dist/<entry>.js`, where `<entry>` is discovered from:
 *   1. the same-name pair that already exists on disk (this is what catches `src/sdk.ts`);
 *   2. the repo convention `index`;
 *   3. the package's own `scripts.build` declarations.
 */
export function discoverTargets(root) {
  const pkgRoot = join(root, "packages")
  const targets = []
  const coveredDist = new Set()
  const declaredNoSource = new Set()
  const distFiles = []

  for (const pkg of listDirs(pkgRoot)) {
    const pkgRel = `packages/${pkg}`
    const srcSet = new Set(listSrcEntries(join(root, pkgRel, "src")))
    const distDir = join(root, pkgRel, "dist")
    const files = walkFiles(root, `${pkgRel}/dist`)
    for (const file of files) distFiles.push(file)

    const candidates = new Map()
    if (srcSet.has(CONVENTION_ENTRY) || existsSync(join(distDir, `${CONVENTION_ENTRY}.js`))) {
      candidates.set(CONVENTION_ENTRY, { srcBase: CONVENTION_ENTRY, declared: false })
    }
    for (const pair of declaredOutputs(join(root, pkgRel))) {
      if (!candidates.has(pair.outBase)) candidates.set(pair.outBase, { srcBase: pair.srcBase, declared: true })
    }
    for (const name of srcSet) {
      if (existsSync(join(distDir, `${name}.js`)) && !candidates.has(name)) {
        candidates.set(name, { srcBase: name, declared: false, derived: true })
      }
    }

    for (const [entry, meta] of [...candidates].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const src = `${pkgRel}/src/${meta.srcBase}.ts`
      const dist = `${pkgRel}/dist/${entry}.js`
      const hasSrc = srcSet.has(meta.srcBase)
      const hasDist = files.includes(dist)
      // A declaration whose source AND artifact are both absent owns no file: there is nothing to
      // build and nothing to account for, so it is not a subject.
      if (!hasSrc && !hasDist) continue
      if (!hasSrc) {
        // A committed artifact no local source can produce: out of coverage, reported below with
        // its reason (this is the adopted/prebuilt shape).
        declaredNoSource.add(dist)
        continue
      }
      coveredDist.add(dist)
      targets.push({
        pkg,
        entry,
        src,
        dist,
        declared: meta.declared === true,
        missing: !hasDist,
      })
    }
  }

  const ctx = { declaredNoSource }
  const notCovered = distFiles
    .filter((rel) => !coveredDist.has(rel))
    .sort()
    .map((path) => ({ path, reason: uncoveredReason(root, path.split("/")[1], path, ctx) }))

  // Zero-subject guard (same discipline as verify-rows-parity): no derivable target is a degraded
  // run, never a pass.
  return { targets, notCovered }
}

// ---------------------------------------------------------------------------
// build + compare
// ---------------------------------------------------------------------------

/** The gate's own build command — fixed flags, temp outfile, never the package's outfile. */
function buildArgs(srcAbs, outAbs) {
  return ["build", srcAbs, "--target", "node", "--format", "esm", "--outfile", outAbs]
}

/**
 * Refuse to write a build output inside the tree being verified: this is the mechanical guarantee
 * that the gate can never rewrite a committed `dist/`.
 */
function assertOutsideTree(root, outAbs) {
  const rel = relative(root, outAbs)
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error(`refusing to build into the verified tree: ${outAbs}`)
  }
}

/** One bun build; a timeout, a missing binary and a non-zero exit are distinct loud outcomes. */
function runBuild(srcAbs, outAbs, cwd) {
  const started = Date.now()
  const result = spawnSync(BUILD_BIN, buildArgs(srcAbs, outAbs), {
    cwd,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  })
  const ms = Date.now() - started
  if (result.error && result.error.code === "ENOENT") {
    return { ok: false, kind: "BUILD_FAILED", ms, detail: `cannot spawn "${BUILD_BIN}" (${BUILD_BIN} is required to rebuild a dist)` }
  }
  if ((result.error && result.error.code === "ETIMEDOUT") || result.signal === "SIGTERM") {
    return { ok: false, kind: "TIMEOUT", ms, detail: `build exceeded ${BUILD_TIMEOUT_MS} ms and was killed` }
  }
  if (result.status !== 0) {
    const tail = String(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")
    return { ok: false, kind: "BUILD_FAILED", ms, detail: `exit ${result.status}${tail === "" ? "" : ` — ${tail}`}` }
  }
  return { ok: true, kind: "FRESH", ms, detail: "" }
}

/**
 * Rebuild one target twice and compare both builds against the committed artifact.
 * The committed file is read FIRST, so the expectation snapshot predates every build.
 */
function checkTarget(root, tmpRoot, target) {
  const base = { pkg: target.pkg, entry: target.entry, src: target.src, dist: target.dist }
  if (target.missing) {
    return {
      ...base,
      status: "MISSING",
      finding: { kind: "MISSING", ...base, detail: `${target.src} exists but there is no committed ${target.dist} (rebuild from the repository root — a package-directory build is flagged, because bun writes the entry path relative to cwd: bun build ${target.src} --target node --format esm --outfile ${target.dist})` },
    }
  }

  const distAbs = join(root, target.dist)
  let committed
  try {
    if (!statSync(distAbs).isFile()) throw new Error("not a regular file")
    committed = readFileSync(distAbs)
  } catch (error) {
    return {
      ...base,
      status: "UNREADABLE",
      finding: { kind: "UNREADABLE", ...base, detail: `cannot read the committed artifact: ${error.message}` },
    }
  }
  const committedSha = sha256(committed)

  const stem = `${target.pkg}__${target.entry}.js`
  const outA = join(tmpRoot, "run1", stem)
  const outB = join(tmpRoot, "run2", stem)
  const first = runBuild(join(root, target.src), outA, root)
  if (!first.ok) {
    return { ...base, status: first.kind, committedSha256: committedSha, buildMs: first.ms, finding: { kind: first.kind, ...base, detail: first.detail } }
  }
  const second = runBuild(join(root, target.src), outB, root)
  if (!second.ok) {
    return { ...base, status: second.kind, committedSha256: committedSha, buildMs: second.ms, finding: { kind: second.kind, ...base, detail: `${second.detail} (second build)` } }
  }

  const builtA = readFileSync(outA)
  const builtB = readFileSync(outB)
  const shaA = sha256(builtA)
  const shaB = sha256(builtB)
  const buildMs = first.ms + second.ms

  if (shaA !== shaB) {
    return {
      ...base,
      status: "NONDETERMINISTIC",
      committedSha256: committedSha,
      builtSha256: shaA,
      secondBuildSha256: shaB,
      buildMs,
      finding: {
        kind: "NONDETERMINISTIC",
        ...base,
        detail: `two builds of ${target.src} differ (run1 ${shaA.slice(0, 16)}…, run2 ${shaB.slice(0, 16)}…) — a byte-diff against a nondeterministic build proves nothing`,
      },
    }
  }

  if (shaA !== committedSha) {
    return {
      ...base,
      status: "STALE",
      committedSha256: committedSha,
      builtSha256: shaA,
      committedBytes: committed.length,
      builtBytes: builtA.length,
      buildMs,
      finding: {
        kind: "STALE",
        ...base,
        detail: `committed ${target.dist} (${committed.length} B, ${committedSha.slice(0, 16)}…) != fresh build of ${target.src} (${builtA.length} B, ${shaA.slice(0, 16)}…) — rebuild from the repository root (a package-directory build is flagged: bun writes the entry path relative to cwd): bun build ${target.src} --target node --format esm --outfile ${target.dist}`,
      },
    }
  }

  return {
    ...base,
    status: "FRESH",
    committedSha256: committedSha,
    builtSha256: shaA,
    secondBuildSha256: shaB,
    committedBytes: committed.length,
    buildMs,
  }
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

/** Statuses that are findings (i.e. turn the gate red). FRESH is the only green one. */
const FINDING_STATUSES = new Set(["STALE", "MISSING", "NONDETERMINISTIC", "BUILD_FAILED", "TIMEOUT", "UNREADABLE"])

/**
 * T-67: the FORM of a package's own `scripts.build` declarations. `bun build` writes EVERY bundled
 * module's path RELATIVE TO CWD into the artifact's path comments, so the package-directory form and
 * the repo-root form of the SAME source produce different bytes (measured on mpd-ext-plugin: 13 path
 * comments over 11 distinct modules, and ALL 13 differ — AGENTS.md §6). This gate rebuilds from the
 * repository root, so the form the packages DECLARE has to be that same form: otherwise a developer
 * who follows a package's own script lands on a dist this gate then flags STALE, which is the
 * disagreement T-67 names. The canonical string in the finding is DERIVED from the offending segment
 * (never a hard-coded entry name), so the message stays true when a package adds an entry.
 */
export function buildFormFindings(root) {
  const findings = []
  // The sanctioned cwd anchor. The canonical command's paths are repository-root-relative, so a
  // PACKAGE-DIRECTORY invocation (`cd packages/<pkg> && bun run build` — the round trip T-67 names as
  // decisive) only works when the script re-anchors itself first. Measured: without the anchor that
  // invocation dies `FileNotFound opening root directory "packages/<pkg>/src"`, and a script that
  // silently built from the wrong cwd would produce the OTHER path comments — the very bytes this gate
  // flags STALE.
  const ANCHOR = 'cd "$(git rev-parse --show-toplevel)"'
  for (const pkg of listDirs(join(root, "packages"))) {
    const pkgRel = `packages/${pkg}`
    const manifestPath = join(root, pkgRel, "package.json")
    if (!existsSync(manifestPath)) continue
    let build
    try {
      build = JSON.parse(readFileSync(manifestPath, "utf8"))?.scripts?.build
    } catch {
      continue
    }
    if (typeof build !== "string" || build.trim() === "") continue
    const segments = build.split("&&").map((s) => s.trim()).filter((s) => s !== "")
    let anchor = null
    if (segments.length > 0 && /^cd(\s|$)/.test(segments[0]) && !/bun\s+build/.test(segments[0])) anchor = segments.shift()
    const offenders = []
    if (anchor !== ANCHOR) offenders.push({ segment: anchor ?? "(no cwd anchor)", canonical: ANCHOR })
    for (const segment of segments) {
      const entry = segment.match(/bun\s+build\s+(\S+)/)
      const outfile = segment.match(/--outfile\s+(\S+)/)
      const canonicalise = (p) => (p.startsWith(pkgRel + "/") ? p : pkgRel + "/" + p.replace(/^\.\//, ""))
      const ok =
        entry !== null &&
        outfile !== null &&
        /--target\s+node/.test(segment) &&
        /--format\s+esm/.test(segment) &&
        entry[1].startsWith(pkgRel + "/") &&
        outfile[1].startsWith(pkgRel + "/")
      if (!ok) {
        offenders.push({
          segment,
          canonical: `bun build ${canonicalise(entry === null ? "src/<entry>.ts" : entry[1])} --target node --format esm --outfile ${canonicalise(outfile === null ? "dist/<entry>.js" : outfile[1])}`,
        })
      }
    }
    if (offenders.length === 0) continue
    findings.push({
      kind: "BUILD_FORM",
      pkg,
      detail: `${pkgRel}/package.json scripts.build is not the runnable canonical form: ${offenders.map((o) => JSON.stringify(o.segment)).join(", ")}. Required: the cwd anchor ${JSON.stringify(ANCHOR)} (so the same script works from the repository root AND from the package directory) followed by path-qualified bun builds — a package-directory build writes different path comments into the artifact (13 comments / 11 distinct modules in the mpd-ext-plugin build, ALL 13 different) and this gate would flag the result STALE. Run from the repository root: ${ANCHOR} && ${offenders.map((o) => o.canonical).join(" && ")} (T-67)`,
    })
  }
  return findings
}

/**
 * Rebuild-and-diff every covered target under `root`.
 * @param {string} root tree to verify
 * @param {{only?: string|null, keepTmp?: boolean, quiet?: boolean, log?: (line: string) => void}} options
 */
export function verifyDistFresh(root, options = {}) {
  const { only = null, keepTmp = false, quiet = false, log = () => {} } = options
  const started = Date.now()
  const discovery = discoverTargets(root)
  const findings = []
  for (const finding of buildFormFindings(root)) findings.push(finding)

  let targets = discovery.targets
  if (only !== null) {
    targets = targets.filter((t) => t.dist.includes(only) || t.src.includes(only) || t.pkg.includes(only))
    if (targets.length === 0) {
      findings.push({
        kind: "NO_TARGETS",
        pkg: "-",
        detail: `--only ${JSON.stringify(only)} matched no target (${discovery.targets.length} targets exist) — refusing to report PASS with nothing checked`,
      })
    }
  }
  if (discovery.targets.length === 0) {
    findings.push({ kind: "NO_TARGETS", pkg: "-", detail: `no covered target under ${root}: no packages/*/src/<entry>.ts maps to a packages/*/dist/<entry>.js — refusing to report PASS with nothing checked` })
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), TMP_PREFIX))
  const results = []
  try {
    for (const target of targets) {
      const result = checkTarget(root, tmpRoot, target)
      results.push(result)
      if (result.finding !== undefined) findings.push(result.finding)
      if (!quiet) {
        const ms = typeof result.buildMs === "number" ? ` ${result.buildMs}ms` : ""
        if (result.status === "FRESH") {
          log(`  FRESH   ${result.dist}  sha ${result.committedSha256.slice(0, 12)}…${ms}  <- ${result.src}`)
        } else {
          log(`  ${result.status}${" ".repeat(Math.max(0, 8 - result.status.length))}${result.dist}  <- ${result.src}`)
        }
      }
    }
  } finally {
    if (!keepTmp) rmSync(tmpRoot, { recursive: true, force: true })
  }

  const fresh = results.filter((r) => r.status === "FRESH").length
  const durationMs = Date.now() - started
  const ok = findings.length === 0 && results.length > 0
  const byStatus = {}
  for (const result of results) {
    if (FINDING_STATUSES.has(result.status)) byStatus[result.status] = (byStatus[result.status] ?? 0) + 1
  }
  // Per-target statuses first; when EVERY finding is a non-target rule (BUILD_FORM, NO_TARGETS), name
  // those kinds instead of printing an empty pair of parentheses over a red gate.
  const breakdown = Object.entries(byStatus).map(([kind, count]) => `${kind}: ${count}`).join(", ") || [...new Set(findings.map((f) => f.kind))].join(", ")
  const summary = ok
    ? `[verify-dist-fresh] ok: ${fresh}/${results.length} targets fresh (each rebuilt twice, byte-identical) — ${discovery.notCovered.length} NOT COVERED files listed — ${durationMs}ms`
    : findings.some((f) => f.kind === "NO_TARGETS")
      ? `[verify-dist-fresh] FAIL - ${findings.find((f) => f.kind === "NO_TARGETS").detail}`
      : `[verify-dist-fresh] FAIL - ${results.length - fresh} of ${results.length} targets not fresh (${breakdown}) — ${durationMs}ms`

  return {
    generatedAt: new Date().toISOString(),
    root,
    ok,
    durationMs,
    tmpRoot: keepTmp ? tmpRoot : null,
    counts: { targets: results.length, fresh, findings: findings.length, notCovered: discovery.notCovered.length },
    targets: results,
    findings,
    notCovered: discovery.notCovered,
    summary,
  }
}

// ---------------------------------------------------------------------------
// self-test (fixtures in temp dirs; the negative control seeds a real mismatch)
// ---------------------------------------------------------------------------

const FIXTURE_SOURCES = {
  "packages/alpha/src/index.ts": 'import { helper } from "./helper"\n\nexport const alphaValue: string = helper("alpha")\n',
  "packages/alpha/src/helper.ts": 'export function helper(name: string): string {\n  return `fixture:${name}`\n}\n',
  "packages/alpha/package.json": '{\n  "name": "alpha"\n}\n',
  "packages/delta/src/index.ts": 'export const deltaValue: string = "delta"\n',
  "packages/delta/src/sdk.ts": 'export const deltaSdk: number = 1\n',
  "packages/delta/package.json": '{\n  "name": "delta",\n  "scripts": {\n    "build": "cd \\\"$(git rev-parse --show-toplevel)\\\" && bun build packages/delta/src/index.ts --target node --format esm --outfile packages/delta/dist/index.js && bun build packages/delta/src/sdk.ts --target node --format esm --outfile packages/delta/dist/sdk.js"\n  }\n}\n',
  "packages/gamma/dist/thing.js": 'export const orphan = true\n',
}
const FIXTURE_DISTS = ["packages/alpha/dist/index.js", "packages/delta/dist/index.js", "packages/delta/dist/sdk.js"]

/** Create the parent directories and write one fixture file. */
function writeFixtureFile(sandbox, rel, text) {
  const abs = join(sandbox, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text)
}

/** Materialize the fixture tree; every committed dist is produced by the gate's own build. */
function buildFixture(sandbox) {
  for (const [rel, text] of Object.entries(FIXTURE_SOURCES)) writeFixtureFile(sandbox, rel, text)
  for (const dist of FIXTURE_DISTS) {
    const src = dist.replace("/dist/", "/src/").replace(/\.js$/, ".ts")
    const result = runBuild(join(sandbox, src), join(sandbox, dist), sandbox)
    if (!result.ok) throw new Error(`fixture build failed for ${src}: ${result.detail}`)
  }
}

/** Run the REAL CLI on a fixture root and return {status, stdout, stderr, json}. */
function runCli(args, scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", timeout: 120_000 })
  let json = null
  try {
    json = JSON.parse(String(result.stdout ?? ""))
  } catch {
    json = null
  }
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), json }
}

function selfTest(scriptPath) {
  const arms = []
  const record = (name, ok, reason) => {
    arms.push({ name, ok: Boolean(ok), reason })
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${reason === undefined || reason === "" ? "" : ` — ${reason}`}`)
  }
  const probe = spawnSync(BUILD_BIN, ["--version"], { encoding: "utf8" })
  if (probe.error || probe.status !== 0) {
    record("build tool available", false, `"${BUILD_BIN}" is not runnable — the gate cannot rebuild anything, so no arm can pass`)
    console.log(`\n[verify-dist-fresh self-test] 0/${arms.length} arms passed — FAIL`)
    process.exitCode = 1
    return
  }

  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dist-fresh-selftest-"))
  const alphaDist = join(sandbox, "packages/alpha/dist/index.js")
  try {
    buildFixture(sandbox)

    // (a) a matching fixture is green
    const clean = verifyDistFresh(sandbox)
    record("(a) matching fixture -> 0 findings, ok=true", clean.ok === true && clean.findings.length === 0, `ok=${clean.ok} findings=${clean.findings.length} targets=${clean.targets.length}`)
    const cleanExit = runCli(["--root", sandbox, "--json"], scriptPath)
    record("(a2) the spawned gate exits 0 on the clean fixture", cleanExit.status === 0 && cleanExit.json !== null && cleanExit.json.ok === true, `exit=${cleanExit.status} json.ok=${cleanExit.json === null ? "unparsable" : cleanExit.json.ok}`)

    // (b) THE negative control: a seeded mismatch must fail the real gate
    const before = readFileSync(alphaDist)
    const beforeSha = sha256(before)
    appendFileSync(alphaDist, "\n// seeded staleness (self-test arm b)\n")
    const stale = runCli(["--root", sandbox, "--json"], scriptPath)
    const staleHit = stale.json !== null && stale.json.findings.some((f) => f.kind === "STALE" && f.pkg === "alpha")
    record("(b) a mutated fixture dist -> STALE finding + exit 1", stale.status === 1 && staleHit, `exit=${stale.status} kinds=${stale.json === null ? "unparsable" : stale.json.findings.map((f) => f.kind).join(",")}`)
    writeFileSync(alphaDist, before)
    const afterSha = sha256(readFileSync(alphaDist))
    const restored = runCli(["--root", sandbox, "--json"], scriptPath)
    record("(b2) the restored fixture is green again and the bytes are identical", restored.status === 0 && afterSha === beforeSha, `sha ${beforeSha.slice(0, 12)}… -> ${afterSha.slice(0, 12)}… exit=${restored.status}`)

    // (c) source without a committed artifact
    writeFixtureFile(sandbox, "packages/beta/src/index.ts", 'export const betaValue: string = "beta"\n')
    const missing = runCli(["--root", sandbox, "--json"], scriptPath)
    const missingHit = missing.json !== null && missing.json.findings.some((f) => f.kind === "MISSING" && f.pkg === "beta")
    record("(c) src without dist -> MISSING finding", missing.status === 1 && missingHit, `exit=${missing.status} kinds=${missing.json === null ? "unparsable" : missing.json.findings.map((f) => f.kind).join(",")}`)

    // (d) a dist file no source maps to is listed loudly, and covered files are not
    const orphan = clean.notCovered.find((n) => n.path === "packages/gamma/dist/thing.js")
    record("(d) dist with no source -> NOT COVERED with a reason", orphan !== undefined && orphan.reason.length > 0, orphan === undefined ? "packages/gamma/dist/thing.js missing from the NOT COVERED list" : `reason="${orphan.reason}"`)
    const covered = clean.notCovered.every((n) => !FIXTURE_DISTS.includes(n.path))
    record("(d2) every mapped dist is covered, incl. the declared sdk entry", covered && clean.targets.some((t) => t.dist === "packages/delta/dist/sdk.js"), `targets=${clean.targets.map((t) => t.dist).join(", ")}`)

    // (e) --only narrows the checked set (and with it the findings)
    const only = runCli(["--root", sandbox, "--only", "alpha", "--json"], scriptPath)
    const onlyOk = only.status === 0 && only.json !== null && only.json.targets.length === 1 && !only.json.findings.some((f) => f.pkg === "beta")
    record("(e) --only filters to the matching target only", onlyOk, `exit=${only.status} targets=${only.json === null ? "unparsable" : JSON.stringify(only.json.targets.map((t) => t.dist))}`)
    const onlyNone = runCli(["--root", sandbox, "--only", "no-such-target", "--json"], scriptPath)
    const zeroSubject = onlyNone.json !== null && onlyNone.json.findings.some((f) => f.kind === "NO_TARGETS")
    record("(e2) a filter matching nothing is a zero-subject failure", onlyNone.status === 1 && zeroSubject, `exit=${onlyNone.status}`)

    // (f) a bad flag is a usage error, never a silent green
    const bad = runCli(["--definitely-not-a-flag"], scriptPath)
    record("(f) bad flag -> exit 1 + usage on stderr", bad.status === 1 && /usage/i.test(bad.stderr) && bad.stdout === "", `exit=${bad.status} stderr=${JSON.stringify(bad.stderr.split("\n")[0] ?? "")}`)

    // (g) T-67: the FORM a package DECLARES. A `scripts.build` in the package-directory form must be
    // flagged, and the canonical command must be DERIVED into the message (never a hard-coded entry);
    // switching the same manifest to the canonical form must clear the finding, so the arm proves the
    // check discriminates instead of always complaining.
    const ghostPkg = (build) => JSON.stringify({ name: "ghost", scripts: { build } }, null, 2)
    const anchor = 'cd "$(git rev-parse --show-toplevel)"'

    writeFixtureFile(sandbox, "packages/ghost/package.json", ghostPkg("bun build src/index.ts --target node --format esm --outfile dist/index.js"))
    const ghostForm = runCli(["--root", sandbox, "--json"], scriptPath)
    const formHit =
      ghostForm.json !== null &&
      ghostForm.json.findings.some(
        (f) => f.kind === "BUILD_FORM" && f.pkg === "ghost" && f.detail.includes(anchor + " && bun build packages/ghost/src/index.ts --target node --format esm --outfile packages/ghost/dist/index.js"),
      )
    record("(g) package-directory scripts.build -> BUILD_FORM + derived canonical command", ghostForm.status === 1 && formHit, `exit=${ghostForm.status} kinds=${ghostForm.json === null ? "unparsable" : ghostForm.json.findings.map((f) => f.kind).join(",")}`)
    writeFixtureFile(sandbox, "packages/ghost/package.json", ghostPkg(anchor + " && bun build packages/ghost/src/index.ts --target node --format esm --outfile packages/ghost/dist/index.js"))
    const ghostCanonical = runCli(["--root", sandbox, "--json"], scriptPath)
    const formClear = (ghostCanonical.json?.findings ?? []).every((f) => f.kind !== "BUILD_FORM")
    // A green exit is impossible here by construction: arm (c) left `beta` as src-without-dist, so the
    // only finding this arm tolerates is that known one. Naming it keeps the assertion from going
    // tautological the day another rule starts firing in this sandbox.
    const knownBeta = (ghostCanonical.json?.findings ?? []).some((f) => f.kind === "MISSING" && f.pkg === "beta")
    record("(g2) canonical repo-root scripts.build -> no BUILD_FORM finding", formClear && knownBeta, `exit=${ghostCanonical.status} kinds=${ghostCanonical.json === null ? "unparsable" : ghostCanonical.json.findings.map((f) => f.kind).join(",")}`)
  } catch (error) {
    record("self-test harness", false, error.stack ?? String(error))
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  const passed = arms.filter((a) => a.ok).length
  const ok = passed === arms.length
  console.log(`\n[verify-dist-fresh self-test] ${passed}/${arms.length} arms passed — ${ok ? "PASS" : "FAIL"}`)
  // exitCode (never process.exit) so a piped stdout is never truncated.
  process.exitCode = ok ? 0 : 1
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `usage: node scripts/verify-dist-fresh.mjs [--json] [--quiet] [--only <substr>] [--keep-tmp]
       node scripts/verify-dist-fresh.mjs --self-test
       node scripts/verify-dist-fresh.mjs [--root <dir>]

Rebuild every packages/*/src entry twice into a temp dir and diff it byte-for-byte against its
committed packages/*/dist file. Exit 0 when every covered target is fresh; 1 on any finding
(STALE / MISSING / NONDETERMINISTIC / BUILD_FAILED / TIMEOUT / UNREADABLE), on a zero-subject run,
or on a bad flag. dist files no target maps to are always printed in a NOT COVERED section.`

function parseArgs(argv) {
  const options = { json: false, quiet: false, only: null, selfTest: false, keepTmp: false, root: DEFAULT_ROOT }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--json") options.json = true
    else if (arg === "--quiet") options.quiet = true
    else if (arg === "--self-test") options.selfTest = true
    else if (arg === "--keep-tmp") options.keepTmp = true
    else if (arg === "--only" || arg === "--root") {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith("--")) return { error: `${arg} requires a value`, options }
      i += 1
      if (arg === "--only") options.only = value
      else options.root = value
    } else if (arg === "--help" || arg === "-h") return { help: true, options }
    else return { error: `unknown flag: ${arg}`, options }
  }
  return { options }
}

function printReport(result, options) {
  const log = (line) => console.log(line)
  if (!options.quiet) log(`[verify-dist-fresh] root: ${result.root}  (build: ${BUILD_BIN} build <src> --target node --format esm --outfile <tmp>/<entry>.js)`)
  for (const finding of result.findings) log(`  ${finding.kind}: ${finding.pkg === "-" ? "" : `${finding.dist} — `}${finding.detail}`)
  log(result.notCovered.length === 0
    ? "[verify-dist-fresh] NOT COVERED (0): every committed packages/*/dist file maps to a covered target"
    : `[verify-dist-fresh] NOT COVERED (${result.notCovered.length}) — committed dist files no target maps to, listed so nothing is silently skipped:`)
  for (const note of result.notCovered) log(`  ${note.path} — ${note.reason}`)
  if (result.tmpRoot !== null) log(`[verify-dist-fresh] temp kept: ${result.tmpRoot}`)
  log(result.summary)
}

function main() {
  const { options, error, help } = parseArgs(process.argv.slice(2))
  if (error !== undefined) {
    console.error(`[verify-dist-fresh] ${error}`)
    console.error(USAGE)
    // exitCode (never process.exit) so a piped stderr is never truncated.
    process.exitCode = 1
    return
  }
  if (help === true) {
    console.log(USAGE)
    return
  }
  if (options.selfTest) {
    selfTest(fileURLToPath(import.meta.url))
    return
  }

  const result = verifyDistFresh(options.root, {
    only: options.only,
    keepTmp: options.keepTmp,
    quiet: options.quiet || options.json,
    log: (line) => console.log(line),
  })
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else printReport(result, options)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
