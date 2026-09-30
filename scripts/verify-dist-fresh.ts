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
// a derived reason (adopted main code / built offline by scripts/build-mcp.ts / sha-pinned
// prebuilt / build metadata / no local source). The list is the complete complement of the
// covered set, so a committed dist file can never be silently skipped — the reason only explains,
// it never decides whether the file is listed.
//
// Usage:
//   node scripts/verify-dist-fresh.ts [--json] [--quiet] [--only <substr>] [--keep-tmp]
//   node scripts/verify-dist-fresh.ts --self-test
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
import type { Dirent } from "node:fs"
import { readJson } from "./lib/repo.ts"

/** Absolute directory holding this script, derived from its own module URL. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** The tree verified when `--root` is absent: the repository this script is installed in. */
const DEFAULT_ROOT: string = join(HERE, "..")
/**
 * The bundler every covered entry is rebuilt with; a package's own build script is never run.
 *
 * RESOLVED PER RUN, not taken from PATH (declared follow-up, closed 2026-09-30). The gate's byte
 * comparison is only reproducible under the PINNED toolchain, and the pin lives in the root
 * manifest's `buildToolchain` — but nothing made the two meet, so the honest way to run this gate
 * was to remember `export PATH="$PWD/.toolchain/node_modules/.bin:$PATH"` first. Measured cost of
 * forgetting it: one full wave reported 23/23 STALE, and the F1 arms of two other packages went red,
 * because bun 1.3.x and 1.4.x emit a different `export {}` helper preamble. A gate whose verdict
 * depends on the caller's shell is a gate that lies, so it now finds the pinned binary itself.
 */
const BUILD_BIN_DEFAULT: string = "bun"
/** Where the repository's own pinned toolchain installs its binaries. */
const TOOLCHAIN_BIN_DIR: string = join(".toolchain", "node_modules", ".bin")
/** Wall-clock cap for ONE build, in milliseconds; an overrun is a TIMEOUT finding, never a skip. */
const BUILD_TIMEOUT_MS: number = 60_000
/** Basename prefix of the build temp dir, so a `--keep-tmp` leftover stays identifiable. */
const TMP_PREFIX: string = "mpd-dist-fresh-"
// `index` is the repo-wide entry convention (AGENTS.md §6: `bun build src/index.ts ... --outfile
// dist/index.js`); all other entries are learned from the package's own `scripts.build`.
/** The entry stem every package is expected to ship (`src/index.ts` -> `dist/index.js`). */
const CONVENTION_ENTRY: string = "index"

/**
 * Lowercase hex SHA-256 of one artifact's bytes — the only equality this gate trusts.
 * @param buf the committed or freshly built artifact bytes.
 * @returns the 64-character hex digest of those bytes.
 */
const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex")

/**
 * Rewrite a path's separators to `/`, so printed paths and set keys are host-independent.
 * @param p a path in the host's own separator convention.
 * @returns the same path with every separator rendered as `/`.
 */
const toPosix = (p: string): string => p.split(sep).join("/")

/**
 * `abs` relative to `root`, in the POSIX spelling every message and JSON field uses.
 * @param root the tree the target lives under.
 * @param abs the absolute path to render.
 * @returns the root-relative POSIX path.
 */
const relPosix = (root: string, abs: string): string => toPosix(relative(root, abs))

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

/** One `src` -> `dist` pair a package's own `scripts.build` declares. */
interface DeclaredPair {
  /** Source stem the declared build reads, without its extension. */
  readonly srcBase: string
  /** Output stem the declared build writes, without its `.js` extension. */
  readonly outBase: string
}

/** A candidate entry of one package, with the fact that decided how it was learned. */
interface CandidateEntry {
  /** Source stem the candidate is built from. */
  readonly srcBase: string
  /** Whether the package's own `scripts.build` declared this entry. */
  readonly declared: boolean
  /** Present (and true) only for a same-name pair derived from the two directories on disk. */
  readonly derived?: boolean
}

/** One covered target: a `src/<entry>.ts` that must rebuild byte-identically to `dist/<entry>.js`. */
interface Target {
  /** Package directory name under `packages/`. */
  readonly pkg: string
  /** Entry stem shared by the source and the committed artifact. */
  readonly entry: string
  /** Repository-relative source path (`packages/<pkg>/src/<entry>.ts`). */
  readonly src: string
  /** Repository-relative committed artifact path (`packages/<pkg>/dist/<entry>.js`). */
  readonly dist: string
  /** Whether the package's own `scripts.build` named this entry. */
  readonly declared: boolean
  /** Whether the source exists while the committed artifact does not. */
  readonly missing: boolean
}

/** A committed `dist` file no target maps to, with the derived explanation for its absence. */
interface UncoveredFile {
  /** Repository-relative path of the committed artifact. */
  readonly path: string
  /** Why no target covers it; explanatory only, never a filter on the list. */
  readonly reason: string
}

/** The derived target set plus the complete complement of dist files it does not cover. */
interface Discovery {
  /** Every `src/<entry>.ts` -> `dist/<entry>.js` pair this run must check. */
  readonly targets: readonly Target[]
  /** Every committed dist file the target set does not cover. */
  readonly notCovered: readonly UncoveredFile[]
}

/** The discovery facts `uncoveredReason` needs while it explains a dist file. */
interface UncoveredContext {
  /** Artifact paths a package declares in `scripts.build` although its source is absent. */
  readonly declaredNoSource: ReadonlySet<string>
}

/** Immediate subdirectories of `dir`, sorted; `node_modules` and dot dirs are never packages. */
function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e: Dirent): boolean => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
      .map((e: Dirent): string => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Entry names available under `src/`: top-level `src/<name>.ts` only, never recursive, and
 * `*.d.ts` is skipped (a declaration file is not a buildable entry).
 */
function listSrcEntries(srcDir: string): string[] {
  try {
    return readdirSync(srcDir, { withFileTypes: true })
      .filter((e: Dirent): boolean => e.isFile() && /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name))
      .map((e: Dirent): string => e.name.replace(/\.tsx?$/, ""))
      .sort()
  } catch {
    return []
  }
}

/** The `package.json` fields this gate reads when it derives a package's declared outputs. */
interface PackageManifest {
  /** The manifest's `scripts` table, when it declares one. */
  readonly scripts?: {
    /** The declared `build` command line; read as `unknown` and narrowed by `typeof`. */
    readonly build?: unknown
  }
}

/**
 * The (source, output) pairs a package's own `scripts.build` declares. This is the ONLY thing the
 * gate reads `scripts.build` for — the build it runs is always its own (fixed flags, temp
 * outfile), never the package's command line.
 */
function declaredOutputs(pkgDir: string): DeclaredPair[] {
  // Absolute path of the manifest that may declare this package's build command line.
  const manifest: string = join(pkgDir, "package.json")
  if (!existsSync(manifest)) return []
  // The declared build command line, or a non-string when the field is absent or unparsable.
  let build: unknown
  try {
    build = readJson<PackageManifest>(manifest)?.scripts?.build
  } catch {
    return []
  }
  if (typeof build !== "string" || build === "") return []
  // The pairs recovered from every `--outfile` segment of the declared command line.
  const pairs: DeclaredPair[] = []
  // One `&&`-separated segment of the declared command line.
  for (const segment of build.split("&&")) {
    // The segment's `--outfile` argument, or null when the segment declares none.
    const outfile = segment.match(/--outfile\s+(\S+)/)
    if (outfile === null) continue
    // Output file name the segment writes, extension included.
    const outName = basename(outfile[1])
    if (!outName.endsWith(".js")) continue
    // Output stem the segment writes, without its `.js` extension.
    const outBase = outName.slice(0, -3)
    // The segment's `bun build` source argument, or null when the segment declares none.
    const source = segment.match(/bun\s+build\s+(\S+)/)
    // Source stem the segment builds; the output stem when the segment names no source argument.
    const srcBase = source === null ? outBase : basename(source[1]).replace(/\.tsx?$/, "")
    pairs.push({ srcBase, outBase })
  }
  return pairs
}

/** Every file under `<root>/<relDir>`, recursively; dot dirs and `node_modules` are skipped. */
function walkFiles(root: string, relDir: string, out: string[] = []): string[] {
  // This directory's entries; an unreadable directory returns what has been collected so far.
  let entries: Dirent[]
  try {
    entries = readdirSync(join(root, relDir), { withFileTypes: true })
  } catch {
    return out
  }
  // One entry of the directory currently being walked.
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    // Path of this entry relative to the verified root, always in POSIX form.
    const rel = `${relDir}/${entry.name}`
    if (entry.isDirectory()) walkFiles(root, rel, out)
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/** The root `package.json` field this gate reads to report the pinned build toolchain. */
interface RootManifest {
  /** The pinned build-toolchain record (`bun@<version>`), or a non-string when absent. */
  readonly buildToolchain?: unknown
}

/** The build toolchain as observed here, against the one the root manifest records. */
interface ToolchainReport {
  /** The bundler binary this run invoked, recorded so a report names what produced the bytes. */
  readonly bin: string
  /** How the binary was found, so the report can say whether the PINNED toolchain was used. */
  readonly source: "toolchain" | "path"
  /** Version of the bun rebuilding here, or null when the version probe did not exit 0. */
  readonly current: string | null
  /** Version the root manifest pins, or null when it records none. */
  readonly pinned: string | null
  /** Whether a recorded pin disagrees with the observed bun (the byte comparison's caveat). */
  readonly drift: boolean
  /** The reviewer-facing explanation of the pin's state; empty when there is nothing to say. */
  readonly note: string
}

/** Where the run's bundler came from, so a reader knows which bytes were certified. */
interface BuildBinResolution {
  /** The binary (or absolute path) every build in this run invoked. */
  readonly bin: string
  /** The pinned version from the root manifest, or null when it records none. */
  readonly pinned: string | null
  /** How the binary was found: the repository's own toolchain, or whatever PATH answers. */
  readonly source: "toolchain" | "path"
}

/**
 * Resolve the bundler for this run, preferring the repository's OWN pinned toolchain.
 *
 * The order is deliberate: a local `.toolchain/node_modules/.bin/bun` that REPORTS the pinned
 * version wins, because that is the binary the committed bytes were produced by. Anything else —
 * no local toolchain, or one whose version disagrees with the manifest — falls back to PATH and
 * says so, since a silent fallback is exactly the failure this closes.
 * @param root the tree whose root manifest records the pin.
 * @returns the resolved binary, the pinned version and how it was found.
 */
function resolveBuildBin(root: string): BuildBinResolution {
  /** The pinned version, or null when the manifest records none. */
  let pinned: string | null = null
  try {
    /** The root manifest, read only for the `buildToolchain` field. */
    const manifest = readJson<RootManifest>(join(root, "package.json"))
    /** The `buildToolchain` field when it is a string, else the empty marker for "absent". */
    const declared = typeof manifest.buildToolchain === "string" ? manifest.buildToolchain : ""
    if (declared.startsWith("bun@")) pinned = declared.slice(4)
  } catch { /* no root manifest: reported as an absent pin, never as a pass */ }
  /** The repository's own toolchain binary, when it is installed. */
  const local = join(root, TOOLCHAIN_BIN_DIR, "bun")
  if (existsSync(local)) {
    /** The local binary's own version, or null when the probe could not run it. */
    const probe = spawnSync(local, ["--version"], { encoding: "utf8", timeout: 60_000 })
    /** The version token the local binary printed, or null. */
    const version = probe.status === 0 ? (String(probe.stdout ?? "").trim().split(/\s+/).pop() ?? null) : null
    // A local binary that AGREES with the pin is the one the committed bytes came from; one that
    // disagrees is not preferred, because preferring it would certify the bytes under the wrong bun.
    if (version !== null && (pinned === null || version === pinned)) return { bin: local, pinned, source: "toolchain" }
  }
  return { bin: BUILD_BIN_DEFAULT, pinned, source: "path" }
}

/**
 * The build toolchain this run used, against the one `package.json` records (`buildToolchain`,
 * never `packageManager`: pnpm REFUSES to run in a project that declares another package manager,
 * and the harness's own profile installs go through pnpm - measured 2026-09-22, bundle-lifecycle's
 * "pnpm is required for the official install flow" arm went red the moment the pin was added).
 *
 * WHY A PIN AT ALL (measured 2026-09-22): the committed corpus had been built by an older bun
 * whose injected helper preamble differs from the current one, so 18 of 20 targets compared
 * STALE by kilobytes (mpd-config-plugin: 122963 B committed vs 117361 B rebuilt) with no
 * semantic difference - the gate and the F1 arms of mpd-ext-plugin/mpd-roles-plugin read that as
 * a defect. The pin makes the byte comparison reproducible; this record makes a drift VISIBLE
 * in the run instead of leaving it to a future bisect.
 * @param root the tree whose root manifest records the pin.
 * @returns the observed and recorded toolchain, plus the drift note a reader needs.
 */
function buildToolchain(root: string, resolution: BuildBinResolution): ToolchainReport {
  // The `bun --version` probe whose output names the toolchain doing the rebuilding.
  const probe = spawnSync(resolution.bin, ["--version"], { encoding: "utf8", timeout: 60_000 })
  // Version of the bun rebuilding here, or null when the probe did not exit 0. `pop()` is
  // `string | undefined`; a successful `--version` always prints one token, so a missing token is
  // normalised to the declared null ("cannot tell") rather than leaving an undefined behind.
  const current = probe.status === 0 ? (String(probe.stdout ?? "").trim().split(/\s+/).pop() ?? null) : null
  // The pinned version, resolved with the binary so the two can never be read from different places.
  const pinned = resolution.pinned
  // Whether a recorded pin disagrees with the bun actually rebuilding here.
  const drift = pinned !== null && current !== null && pinned !== current
  // The run-visible explanation of the pin's state; empty when pin and observed binary agree.
  const note =
    pinned === null
      ? `no buildToolchain record in ${root}/package.json: the committed dist bytes depend on whichever bun runs here`
      : drift
        ? `the recorded build toolchain (bun@${pinned}) differs from the bun rebuilding here (${current}): a different bun minor rewrites the injected helper preamble and minifier variable names, so the byte comparison below certifies these bytes under THIS bun only`
        : ""
  return { bin: resolution.bin, source: resolution.source, current, pinned, drift, note }
}

/**
 * Why a `dist` file maps to no target. Explanatory ONLY: a file reaches this function because it
 * is already in the uncovered complement, so no rule can hide one — an unknown shape falls
 * through to the generic "no local source" reason and is still listed.
 */
function uncoveredReason(root: string, pkg: string, dist: string, ctx: UncoveredContext): string {
  if (pkg === "mpd-agent-teams-plugin") return "adopted upstream main code under lib/ (no src/, never rebuilt here)"
  if (pkg === "mpd-bundle") return "documentation package for the root cordis.patch.yml layer — no code, not a build artifact"
  if (!dist.endsWith(".js")) return "build metadata, not a bun build artifact"
  if (ctx.declaredNoSource.has(dist)) return "declared by scripts.build but its source file is absent (no local source)"
  if (pkg === "mpd-mcp-codegraph") return "sha-pinned prebuilt vendored at pack time (packages/mpd-mcp-codegraph/README.md) — no local src/"
  if (pkg.startsWith("mpd-mcp-")) return "built offline by scripts/build-mcp.ts from the upstream checkout — no local src/"
  if (!existsSync(join(root, "packages", pkg, "src"))) return "package has no src/ directory (dist is the only committed artifact)"
  return `no src/${basename(dist, ".js")}.ts for this dist file`
}

/**
 * Derive the target set, the missing-artifact findings' subjects and the uncovered dist files.
 * A target is `src/<entry>.ts` -> `dist/<entry>.js`, where `<entry>` is discovered from:
 *   1. the same-name pair that already exists on disk (this is what catches `src/sdk.ts`);
 *   2. the repo convention `index`;
 *   3. the package's own `scripts.build` declarations.
 * @param root the tree whose `packages/` directory is scanned.
 * @returns the covered targets and the complete complement of uncovered dist files.
 */
export function discoverTargets(root: string): Discovery {
  // Absolute path of the `packages/` directory holding every plugin package.
  const pkgRoot: string = join(root, "packages")
  // The covered targets derived so far.
  const targets: Target[] = []
  // Repository-relative dist paths some candidate entry maps to (the covered set).
  const coveredDist: Set<string> = new Set()
  // Dist paths a package's `scripts.build` declares while no local source can produce them.
  const declaredNoSource: Set<string> = new Set()
  // Every committed file under `packages/*/dist`, collected for the NOT COVERED complement.
  const distFiles: string[] = []

  // One package directory name under `packages/`.
  for (const pkg of listDirs(pkgRoot)) {
    // Package path relative to the verified root, always in POSIX form.
    const pkgRel = `packages/${pkg}`
    // Entry stems available under this package's `src/` (top level, `.ts`/`.tsx` only).
    const srcSet: Set<string> = new Set(listSrcEntries(join(root, pkgRel, "src")))
    // Absolute path of this package's committed `dist/` directory.
    const distDir = join(root, pkgRel, "dist")
    // This package's committed dist files, relative to the verified root.
    const files = walkFiles(root, `${pkgRel}/dist`)
    // One committed dist file of this package, accumulated for the complement below.
    for (const file of files) distFiles.push(file)

    // Candidate entries of this package, keyed by output stem.
    const candidates: Map<string, CandidateEntry> = new Map()
    if (srcSet.has(CONVENTION_ENTRY) || existsSync(join(distDir, `${CONVENTION_ENTRY}.js`))) {
      candidates.set(CONVENTION_ENTRY, { srcBase: CONVENTION_ENTRY, declared: false })
    }
    // A `scripts.build` declaration of this package, which outranks the derived same-name pair.
    for (const pair of declaredOutputs(join(root, pkgRel))) {
      if (!candidates.has(pair.outBase)) candidates.set(pair.outBase, { srcBase: pair.srcBase, declared: true })
    }
    // A same-name `src/<name>.ts` + `dist/<name>.js` pair already present on disk.
    for (const name of srcSet) {
      if (existsSync(join(distDir, `${name}.js`)) && !candidates.has(name)) {
        candidates.set(name, { srcBase: name, declared: false, derived: true })
      }
    }

    // One candidate entry, with the metadata that decided how it was learned; sorted by stem so
    // the target order (and therefore the report) is independent of discovery order.
    for (const [entry, meta] of [...candidates].sort((a: [string, CandidateEntry], b: [string, CandidateEntry]): number => (a[0] < b[0] ? -1 : 1))) {
      // Repository-relative source path the candidate is built from.
      const src = `${pkgRel}/src/${meta.srcBase}.ts`
      // Repository-relative artifact path the candidate must reproduce byte-for-byte.
      const dist = `${pkgRel}/dist/${entry}.js`
      // Whether the candidate's source exists under `src/`.
      const hasSrc = srcSet.has(meta.srcBase)
      // Whether the candidate's artifact exists under `dist/`.
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

  // The facts `uncoveredReason` needs while the complement is derived.
  const ctx: UncoveredContext = { declaredNoSource }
  // Every committed dist file no target covers, sorted, each with its derived reason.
  const notCovered: UncoveredFile[] = distFiles
    .filter((rel: string): boolean => !coveredDist.has(rel))
    .sort()
    .map((path: string): UncoveredFile => ({ path, reason: uncoveredReason(root, path.split("/")[1], path, ctx) }))

  // Zero-subject guard (same discipline as verify-rows-parity): no derivable target is a degraded
  // run, never a pass.
  return { targets, notCovered }
}

// ---------------------------------------------------------------------------
// build + compare
// ---------------------------------------------------------------------------

/** Every class of defect this gate can report; the value is printed verbatim as the finding kind. */
type FindingKind = "STALE" | "MISSING" | "NONDETERMINISTIC" | "BUILD_FAILED" | "TIMEOUT" | "UNREADABLE" | "BUILD_FORM" | "NO_TARGETS"

/** One reported defect: what is wrong, on which subject, and how a developer repairs it. */
interface Finding {
  /** The defect class, printed before the detail. */
  readonly kind: FindingKind
  /** The package the finding belongs to, or `"-"` for a run-level finding. */
  readonly pkg: string
  /** The explanation and remedy printed after the kind. */
  readonly detail: string
  /** Entry stem, present on a per-target finding. */
  readonly entry?: string
  /** Source path, present on a per-target finding. */
  readonly src?: string
  /** Artifact path, present on a per-target finding (never set on a run-level finding). */
  readonly dist?: string
}

/** The four identity fields every per-target finding and result repeats from its target. */
interface TargetIdentity {
  /** Package directory name under `packages/`. */
  readonly pkg: string
  /** Entry stem shared by the source and the artifact. */
  readonly entry: string
  /** Repository-relative source path that was rebuilt. */
  readonly src: string
  /** Repository-relative committed artifact path the build was compared against. */
  readonly dist: string
}

/** The identity fields plus the measurements a target result optionally adds. */
interface TargetResultBase extends TargetIdentity {
  /** Combined wall-clock cost of this target's builds, absent when nothing was built. */
  readonly buildMs?: number
  /** The finding this target contributes, absent only for a FRESH target. */
  readonly finding?: Finding
}

/** A target whose source exists while no committed artifact does: there is nothing to compare. */
interface MissingResult extends TargetResultBase {
  /** The finding class; always MISSING for this shape. */
  readonly status: "MISSING"
  /** Always present: the absent artifact is itself the finding. */
  readonly finding: Finding
}

/** A target whose committed artifact could not be read as a regular file. */
interface UnreadableResult extends TargetResultBase {
  /** The finding class; always UNREADABLE for this shape. */
  readonly status: "UNREADABLE"
  /** Always present: the unreadable artifact is itself the finding. */
  readonly finding: Finding
}

/** A target whose rebuild failed or timed out before any byte comparison was possible. */
interface BuildFailureResult extends TargetResultBase {
  /** The build failure class, which is also the finding kind. */
  readonly status: "BUILD_FAILED" | "TIMEOUT"
  /** SHA-256 of the committed bytes, recorded so a failure still names the expectation. */
  readonly committedSha256: string
  /** Wall-clock cost of the failed build, in milliseconds. */
  readonly buildMs: number
  /** Always present: the failed build is itself the finding. */
  readonly finding: Finding
}

/** A target whose two rebuilds disagreed with each other, so neither can certify anything. */
interface NondeterministicResult extends TargetResultBase {
  /** The finding class; always NONDETERMINISTIC for this shape. */
  readonly status: "NONDETERMINISTIC"
  /** SHA-256 of the committed bytes, the expectation the comparison could not reach. */
  readonly committedSha256: string
  /** SHA-256 of the first fresh build. */
  readonly builtSha256: string
  /** SHA-256 of the second fresh build, which differs from {@link builtSha256}. */
  readonly secondBuildSha256: string
  /** Combined wall-clock cost of both builds, in milliseconds. */
  readonly buildMs: number
  /** Always present: the disagreement is itself the finding. */
  readonly finding: Finding
}

/** A target whose deterministic rebuild still differs from the committed artifact. */
interface StaleResult extends TargetResultBase {
  /** The finding class; always STALE for this shape. */
  readonly status: "STALE"
  /** SHA-256 of the committed bytes. */
  readonly committedSha256: string
  /** SHA-256 of the two byte-identical fresh builds. */
  readonly builtSha256: string
  /** Size of the committed artifact, in bytes, quoted beside the rebuilt size. */
  readonly committedBytes: number
  /** Size of the fresh build, in bytes. */
  readonly builtBytes: number
  /** Combined wall-clock cost of both builds, in milliseconds. */
  readonly buildMs: number
  /** Always present: the byte disagreement is itself the finding. */
  readonly finding: Finding
}

/** A target whose committed artifact is byte-identical to two fresh, mutually identical builds. */
interface FreshResult extends TargetResultBase {
  /** The finding class; always FRESH, the only green one. */
  readonly status: "FRESH"
  /** SHA-256 of the committed bytes, equal to {@link builtSha256}. */
  readonly committedSha256: string
  /** SHA-256 of the fresh builds. */
  readonly builtSha256: string
  /** SHA-256 of the second build, equal to {@link builtSha256} by the determinism check. */
  readonly secondBuildSha256: string
  /** Size of the committed artifact, in bytes. */
  readonly committedBytes: number
  /** Combined wall-clock cost of both builds, in milliseconds. */
  readonly buildMs: number
}

/** One target's outcome; `status` discriminates which measurement fields the result carries. */
type TargetResult = FreshResult | StaleResult | NondeterministicResult | BuildFailureResult | UnreadableResult | MissingResult

/** The gate's own build command — fixed flags, temp outfile, never the package's outfile. */
function buildArgs(srcAbs: string, outAbs: string): string[] {
  return ["build", srcAbs, "--target", "node", "--format", "esm", "--outfile", outAbs]
}

/**
 * Refuse to write a build output inside the tree being verified: this is the mechanical guarantee
 * that the gate can never rewrite a committed `dist/`.
 */
function assertOutsideTree(root: string, outAbs: string): void {
  // `outAbs` relative to the verified root; a `..` prefix (or an absolute result) means outside.
  const rel = relative(root, outAbs)
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error(`refusing to build into the verified tree: ${outAbs}`)
  }
}

/** A build that wrote its artifact, so the byte comparison can proceed. */
interface BuildSucceeded {
  /** Always true; the discriminant of a build that produced the artifact. */
  readonly ok: true
  /** Always FRESH; a successful build is not a finding. */
  readonly kind: "FRESH"
  /** Wall-clock duration of the build, in milliseconds. */
  readonly ms: number
  /** Always empty: a successful build has nothing to explain. */
  readonly detail: ""
}

/** A build that did not write its artifact; the failure class is also the finding kind. */
interface BuildFailed {
  /** Always false; the discriminant of a build that produced nothing comparable. */
  readonly ok: false
  /** Which failure this was: a spawn/exit failure or the 60 s timeout. */
  readonly kind: "BUILD_FAILED" | "TIMEOUT"
  /** Wall-clock duration of the build, in milliseconds. */
  readonly ms: number
  /** The explanation carried into the finding. */
  readonly detail: string
}

/** The result of one `bun build` invocation. */
type BuildOutcome = BuildSucceeded | BuildFailed

/** One bun build; a timeout, a missing binary and a non-zero exit are distinct loud outcomes. */
function runBuild(srcAbs: string, outAbs: string, cwd: string, bin: string): BuildOutcome {
  // Epoch milliseconds when the build was started, so its cost is measured rather than estimated.
  const started = Date.now()
  // The finished child's captured streams, exit status and spawn facts.
  const result = spawnSync(bin, buildArgs(srcAbs, outAbs), {
    cwd,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  })
  // Wall-clock duration of the build, in milliseconds.
  const ms = Date.now() - started
  // The runtime error is errno-shaped; `Error` declares no `code`, so the standard errno view is used.
  const spawnError = result.error as NodeJS.ErrnoException | undefined
  if (spawnError && spawnError.code === "ENOENT") {
    return { ok: false, kind: "BUILD_FAILED", ms, detail: `cannot spawn "${bin}" (a bun binary is required to rebuild a dist)` }
  }
  if ((spawnError && spawnError.code === "ETIMEDOUT") || result.signal === "SIGTERM") {
    return { ok: false, kind: "TIMEOUT", ms, detail: `build exceeded ${BUILD_TIMEOUT_MS} ms and was killed` }
  }
  if (result.status !== 0) {
    // Last three stderr lines, joined, so a failure names its reason without flooding the report.
    const tail = String(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")
    return { ok: false, kind: "BUILD_FAILED", ms, detail: `exit ${result.status}${tail === "" ? "" : ` — ${tail}`}` }
  }
  return { ok: true, kind: "FRESH", ms, detail: "" }
}

/**
 * Rebuild one target twice and compare both builds against the committed artifact.
 * The committed file is read FIRST, so the expectation snapshot predates every build.
 * @param root the verified tree, and the cwd every build runs from.
 * @param tmpRoot the temp directory the two builds are written into.
 * @param target the `src` -> `dist` pair to rebuild and compare.
 * @param bin the resolved bundler this run builds with.
 * @returns the target's outcome, carrying the finding it contributes (if any).
 */
function checkTarget(root: string, tmpRoot: string, target: Target, bin: string): TargetResult {
  // The identity fields every result of this target repeats.
  const base: TargetIdentity = { pkg: target.pkg, entry: target.entry, src: target.src, dist: target.dist }
  if (target.missing) {
    return {
      ...base,
      status: "MISSING",
      finding: { kind: "MISSING", ...base, detail: `${target.src} exists but there is no committed ${target.dist} (rebuild from the repository root — a package-directory build is flagged, because bun writes the entry path relative to cwd: bun build ${target.src} --target node --format esm --outfile ${target.dist})` },
    }
  }

  // Absolute path of the committed artifact the rebuilds are compared against.
  const distAbs = join(root, target.dist)
  // The committed artifact's bytes, read BEFORE any build so the snapshot predates them.
  let committed: Buffer
  try {
    if (!statSync(distAbs).isFile()) throw new Error("not a regular file")
    committed = readFileSync(distAbs)
  } catch (error) {
    // The read failure as a message; `error` is `unknown` under strict, so a non-Error is stringified.
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ...base,
      status: "UNREADABLE",
      finding: { kind: "UNREADABLE", ...base, detail: `cannot read the committed artifact: ${reason}` },
    }
  }
  // SHA-256 of the committed artifact, the expectation both builds are compared against.
  const committedSha = sha256(committed)

  // File name both temp builds share, so the comparison isolates build bytes, not the outfile path.
  const stem = `${target.pkg}__${target.entry}.js`
  // Absolute path of the first build's output.
  const outA = join(tmpRoot, "run1", stem)
  // Absolute path of the second build's output (a different directory, same basename).
  const outB = join(tmpRoot, "run2", stem)
  // The first rebuild of the target's source.
  const first = runBuild(join(root, target.src), outA, root, bin)
  if (!first.ok) {
    return { ...base, status: first.kind, committedSha256: committedSha, buildMs: first.ms, finding: { kind: first.kind, ...base, detail: first.detail } }
  }
  // The second rebuild of the same source, which must be byte-identical to the first.
  const second = runBuild(join(root, target.src), outB, root, bin)
  if (!second.ok) {
    return { ...base, status: second.kind, committedSha256: committedSha, buildMs: second.ms, finding: { kind: second.kind, ...base, detail: `${second.detail} (second build)` } }
  }

  // Bytes of the first fresh build.
  const builtA = readFileSync(outA)
  // Bytes of the second fresh build.
  const builtB = readFileSync(outB)
  // SHA-256 of the first build, the digest compared against the committed artifact.
  const shaA = sha256(builtA)
  // SHA-256 of the second build, compared with the first to prove determinism.
  const shaB = sha256(builtB)
  // Combined wall-clock cost of both builds, in milliseconds.
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
const FINDING_STATUSES: ReadonlySet<string> = new Set(["STALE", "MISSING", "NONDETERMINISTIC", "BUILD_FAILED", "TIMEOUT", "UNREADABLE"])

/** One `scripts.build` segment that is not in the canonical, runnable form. */
interface FormOffender {
  /** The offending segment text, or `(no cwd anchor)` when the anchor itself is missing. */
  readonly segment: string
  /** The canonical replacement, derived from that segment rather than hard-coded. */
  readonly canonical: string
}

/**
 * T-67: the FORM of a package's own `scripts.build` declarations. `bun build` writes EVERY bundled
 * module's path RELATIVE TO CWD into the artifact's path comments, so the package-directory form and
 * the repo-root form of the SAME source produce different bytes (measured on mpd-ext-plugin: 13 path
 * comments over 11 distinct modules, and ALL 13 differ — AGENTS.md §6). This gate rebuilds from the
 * repository root, so the form the packages DECLARE has to be that same form: otherwise a developer
 * who follows a package's own script lands on a dist this gate then flags STALE, which is the
 * disagreement T-67 names. The canonical string in the finding is DERIVED from the offending segment
 * (never a hard-coded entry name), so the message stays true when a package adds an entry.
 * @param root the tree whose `packages/<pkg>/package.json` files are inspected.
 * @returns one BUILD_FORM finding per package whose declared form is not canonical.
 */
export function buildFormFindings(root: string): Finding[] {
  // The findings collected so far, one per offending package.
  const findings: Finding[] = []
  // The sanctioned cwd anchor. The canonical command's paths are repository-root-relative, so a
  // PACKAGE-DIRECTORY invocation (`cd packages/<pkg> && bun run build` — the round trip T-67 names as
  // decisive) only works when the script re-anchors itself first. Measured: without the anchor that
  // invocation dies `FileNotFound opening root directory "packages/<pkg>/src"`, and a script that
  // silently built from the wrong cwd would produce the OTHER path comments — the very bytes this gate
  // flags STALE.
  const ANCHOR = 'cd "$(git rev-parse --show-toplevel)"'
  // One package directory name under `packages/`.
  for (const pkg of listDirs(join(root, "packages"))) {
    // Package path relative to the verified root, always in POSIX form.
    const pkgRel = `packages/${pkg}`
    // Absolute path of the manifest that carries this package's `scripts.build`.
    const manifestPath = join(root, pkgRel, "package.json")
    if (!existsSync(manifestPath)) continue
    // The declared build command line, or a non-string when the field is absent or unparsable.
    let build: unknown
    try {
      build = readJson<PackageManifest>(manifestPath)?.scripts?.build
    } catch {
      continue
    }
    if (typeof build !== "string" || build.trim() === "") continue
    // The command line's non-empty `&&` segments, trimmed, in declared order.
    const segments = build.split("&&").map((s: string): string => s.trim()).filter((s: string): boolean => s !== "")
    // The leading cwd anchor segment when the command line declares one, else undefined.
    let anchor: string | undefined = undefined
    if (segments.length > 0 && /^cd(\s|$)/.test(segments[0]) && !/bun\s+build/.test(segments[0])) anchor = segments.shift()
    // The segments that are not canonical, each with the canonical replacement derived from it.
    const offenders: FormOffender[] = []
    if (anchor !== ANCHOR) offenders.push({ segment: anchor ?? "(no cwd anchor)", canonical: ANCHOR })
    // One `&&` segment of the declared command line, checked in declared order.
    for (const segment of segments) {
      // The segment's `bun build` source argument, or null when the segment declares none.
      const entry = segment.match(/bun\s+build\s+(\S+)/)
      // The segment's `--outfile` argument, or null when the segment declares none.
      const outfile = segment.match(/--outfile\s+(\S+)/)
      // Render a declared path in the path-qualified form the canonical command requires.
      const canonicalise = (p: string): string => (p.startsWith(pkgRel + "/") ? p : pkgRel + "/" + p.replace(/^\.\//, ""))
      // Whether the segment is the canonical, path-qualified, repo-root form.
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
      detail: `${pkgRel}/package.json scripts.build is not the runnable canonical form: ${offenders.map((o: FormOffender): string => JSON.stringify(o.segment)).join(", ")}. Required: the cwd anchor ${JSON.stringify(ANCHOR)} (so the same script works from the repository root AND from the package directory) followed by path-qualified bun builds — a package-directory build writes different path comments into the artifact (13 comments / 11 distinct modules in the mpd-ext-plugin build, ALL 13 different) and this gate would flag the result STALE. Run from the repository root: ${ANCHOR} && ${offenders.map((o: FormOffender): string => o.canonical).join(" && ")} (T-67)`,
    })
  }
  return findings
}

/** Options accepted by one verification run. */
interface VerifyOptions {
  /** Substring filter over package name, source path and dist path; null checks every target. */
  readonly only?: string | null
  /** Keep the temp build directory and report its path instead of removing it. */
  readonly keepTmp?: boolean
  /** Suppress the header and per-target lines while keeping findings, NOT COVERED and summary. */
  readonly quiet?: boolean
  /** Sink for the per-target progress lines; silence when the caller passes none. */
  readonly log?: (line: string) => void
}

/** The run's census, carried in the JSON document for a reviewer or a wrapping script. */
interface VerifyCounts {
  /** Targets checked — a filtered run counts only the targets it actually checked. */
  readonly targets: number
  /** Targets whose two rebuilds matched the committed bytes. */
  readonly fresh: number
  /** Findings collected, including run-level ones no target produced. */
  readonly findings: number
  /** Committed dist files no target maps to. */
  readonly notCovered: number
}

/** One verification run's complete result; `--json` prints exactly this document. */
interface VerifyResult {
  /** ISO-8601 instant the run finished, so a stored result is anchored in time. */
  readonly generatedAt: string
  /** The tree that was verified. */
  readonly root: string
  /** Whether every checked target was fresh and at least one target was checked. */
  readonly ok: boolean
  /** Wall-clock duration of the whole run, in milliseconds. */
  readonly durationMs: number
  /** The kept temp build directory, or null when it was removed. */
  readonly tmpRoot: string | null
  /** The run's census. */
  readonly counts: VerifyCounts
  /** The toolchain that rebuilt here, against the one the root manifest records. */
  readonly toolchain: ToolchainReport
  /** One entry per target that was checked. */
  readonly targets: readonly TargetResult[]
  /** Every finding, in the order it was collected. */
  readonly findings: readonly Finding[]
  /** The complete complement of committed dist files the target set does not cover. */
  readonly notCovered: readonly UncoveredFile[]
  /** The one-line verdict, printed last. */
  readonly summary: string
}

/**
 * Rebuild-and-diff every covered target under `root`.
 * @param root tree to verify
 * @param options filter, temp-dir retention, quiet mode and the progress sink
 * @returns the run's complete result document.
 */
export function verifyDistFresh(root: string, options: VerifyOptions = {}): VerifyResult {
  // The four option values, each defaulted to what the CLI documents when it is not passed.
  const { only = null, keepTmp = false, quiet = false, log = (): void => {} } = options
  // Epoch milliseconds when the run started, so its duration is measured rather than estimated.
  const started = Date.now()
  // The derivable target set and the dist files it does not cover.
  const discovery: Discovery = discoverTargets(root)
  // Every finding collected, in the order it was collected.
  const findings: Finding[] = []
  // One declared-build-form finding per offending package, which no target produces.
  for (const finding of buildFormFindings(root)) findings.push(finding)

  // The targets this run will check: every derived target, or the `--only` subset of them.
  let targets: readonly Target[] = discovery.targets
  if (only !== null) {
    targets = targets.filter((t: Target): boolean => t.dist.includes(only) || t.src.includes(only) || t.pkg.includes(only))
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

  // THE BUNDLER, resolved ONCE per run and before anything builds: the repository's own pinned
  // toolchain when it is installed, PATH otherwise. Every build below and the toolchain record
  // itself read this one value, so a run cannot report one bun and build with another.
  const buildBin: BuildBinResolution = resolveBuildBin(root)
  /** The toolchain record for this run, read from the SAME resolution the builds use. */
  const toolchain: ToolchainReport = buildToolchain(root, buildBin)
  // The fresh temp directory both builds of every target are written into.
  const tmpRoot = mkdtempSync(join(tmpdir(), TMP_PREFIX))
  // One outcome per target that was checked.
  const results: TargetResult[] = []
  try {
    // One covered target, in the sorted discovery order.
    for (const target of targets) {
      // This target's outcome, carrying the finding it contributes.
      const result = checkTarget(root, tmpRoot, target, buildBin.bin)
      results.push(result)
      if (result.finding !== undefined) findings.push(result.finding)
      if (!quiet) {
        // The build cost suffix, printed only when this target actually ran a build.
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

  // The toolchain that rebuilt here, against the pin the root manifest records.

  // How many checked targets were byte-identical to two fresh builds.
  const fresh = results.filter((r: TargetResult): boolean => r.status === "FRESH").length
  // Wall-clock duration of the whole run, in milliseconds.
  const durationMs = Date.now() - started
  // Whether this run is green: no finding of any kind, and at least one target checked.
  const ok = findings.length === 0 && results.length > 0
  // Finding counts per status, for the summary's breakdown.
  const byStatus: Record<string, number> = {}
  // One checked target's status, counted only when that status is a finding.
  for (const result of results) {
    if (FINDING_STATUSES.has(result.status)) byStatus[result.status] = (byStatus[result.status] ?? 0) + 1
  }
  // Per-target statuses first; when EVERY finding is a non-target rule (BUILD_FORM, NO_TARGETS), name
  // those kinds instead of printing an empty pair of parentheses over a red gate.
  const breakdown = Object.entries(byStatus).map(([kind, count]: [string, number]): string => `${kind}: ${count}`).join(", ") || [...new Set(findings.map((f: Finding): FindingKind => f.kind))].join(", ")
  // The run-level zero-subject finding, when this run has one; the summary branch below is taken
  // only in that case, which is what lets the branch read its detail without an assertion.
  const noTargetsFinding = findings.find((f: Finding): boolean => f.kind === "NO_TARGETS")
  // The one-line verdict a reader (and the self-test) reads last.
  const summary = ok
    ? `[verify-dist-fresh] ok: ${fresh}/${results.length} targets fresh (each rebuilt twice, byte-identical) — ${discovery.notCovered.length} NOT COVERED files listed — ${durationMs}ms`
    : noTargetsFinding !== undefined
      ? `[verify-dist-fresh] FAIL - ${noTargetsFinding.detail}`
      : `[verify-dist-fresh] FAIL - ${results.length - fresh} of ${results.length} targets not fresh (${breakdown}) — ${durationMs}ms`

  return {
    generatedAt: new Date().toISOString(),
    root,
    ok,
    durationMs,
    tmpRoot: keepTmp ? tmpRoot : null,
    counts: { targets: results.length, fresh, findings: findings.length, notCovered: discovery.notCovered.length },
    toolchain,
    targets: results,
    findings,
    notCovered: discovery.notCovered,
    summary,
  }
}

// ---------------------------------------------------------------------------
// self-test (fixtures in temp dirs; the negative control seeds a real mismatch)
// ---------------------------------------------------------------------------

/** The fixture tree's source files, keyed by their path relative to the fixture root. */
const FIXTURE_SOURCES: Record<string, string> = {
  "packages/alpha/src/index.ts": 'import { helper } from "./helper"\n\nexport const alphaValue: string = helper("alpha")\n',
  "packages/alpha/src/helper.ts": 'export function helper(name: string): string {\n  return `fixture:${name}`\n}\n',
  "packages/alpha/package.json": '{\n  "name": "alpha"\n}\n',
  "packages/delta/src/index.ts": 'export const deltaValue: string = "delta"\n',
  "packages/delta/src/sdk.ts": 'export const deltaSdk: number = 1\n',
  "packages/delta/package.json": '{\n  "name": "delta",\n  "scripts": {\n    "build": "cd \\\"$(git rev-parse --show-toplevel)\\\" && bun build packages/delta/src/index.ts --target node --format esm --outfile packages/delta/dist/index.js && bun build packages/delta/src/sdk.ts --target node --format esm --outfile packages/delta/dist/sdk.js"\n  }\n}\n',
  "packages/gamma/dist/thing.js": 'export const orphan = true\n',
}
/** The fixture artifacts the gate itself must produce before any arm can compare anything. */
const FIXTURE_DISTS: readonly string[] = ["packages/alpha/dist/index.js", "packages/delta/dist/index.js", "packages/delta/dist/sdk.js"]

/** Create the parent directories and write one fixture file. */
function writeFixtureFile(sandbox: string, rel: string, text: string): void {
  // Absolute path of the fixture file to write.
  const abs = join(sandbox, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text)
}

/** Materialize the fixture tree; every committed dist is produced by the gate's own build. */
function buildFixture(sandbox: string, bin: string): void {
  // One fixture source file's relative path and its exact text.
  for (const [rel, text] of Object.entries(FIXTURE_SOURCES)) writeFixtureFile(sandbox, rel, text)
  // One fixture artifact the gate must produce for the arms to have something to compare.
  for (const dist of FIXTURE_DISTS) {
    // Source path the artifact's name maps to (`/dist/` -> `/src/`, `.js` -> `.ts`).
    const src = dist.replace("/dist/", "/src/").replace(/\.js$/, ".ts")
    // The fixture build's outcome; a failure invalidates every arm, so it throws instead of a record.
    const result = runBuild(join(sandbox, src), join(sandbox, dist), sandbox, bin)
    if (!result.ok) throw new Error(`fixture build failed for ${src}: ${result.detail}`)
  }
}

/** One spawned-CLI run's captured streams and parsed JSON document. */
interface CliRun {
  /** Child exit status, or null when it never exited (spawn error or a signal). */
  readonly status: number | null
  /** Everything the child wrote to stdout. */
  readonly stdout: string
  /** Everything the child wrote to stderr. */
  readonly stderr: string
  /** The parsed JSON document, or null when stdout was not one. */
  readonly json: VerifyResult | null
}

/** Run the REAL CLI on a fixture root and return {status, stdout, stderr, json}. */
function runCli(args: readonly string[], scriptPath: string): CliRun {
  // The finished child's captured streams and exit status.
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", timeout: 120_000 })
  // The parsed JSON document, or null when stdout carried anything but JSON.
  let json: VerifyResult | null = null
  try {
    // The spawned gate prints its own VerifyResult document under --json, so that is the shape
    // meant here: JSON.parse is untyped, this cast is the boundary, and the catch below demotes
    // any non-JSON stdout (a usage error, for instance) to null.
    json = JSON.parse(String(result.stdout ?? "")) as VerifyResult
  } catch {
    json = null
  }
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), json }
}

/** One self-test arm's outcome, kept for the trailing census. */
interface SelfTestArm {
  /** The arm's name, printed beside PASS/FAIL. */
  readonly name: string
  /** Whether the arm's assertion held. */
  readonly ok: boolean
  /** The measured evidence printed after the verdict, absent when an arm has nothing to add. */
  readonly reason?: string
}

/**
 * Run the fixture arms against the REAL gate (spawned as a child, so the CLI is exercised too).
 * @param scriptPath this script's own path, handed to every child so a run re-enters the same code.
 */
function selfTest(scriptPath: string): void {
  // Every arm's outcome, in the order the arms ran.
  const arms: SelfTestArm[] = []
  // Record one arm's verdict and echo it immediately, so a crash still shows the arms that passed.
  const record = (name: string, ok: boolean, reason?: string): void => {
    arms.push({ name, ok: Boolean(ok), reason })
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${reason === undefined || reason === "" ? "" : ` — ${reason}`}`)
  }
  // The toolchain probe that decides whether ANY arm can be meaningful. The SELF-TEST resolves its
  // bundler the same way a real run does — over the SANDBOX, which has no `.toolchain` of its own, so
  // this arm exercises the PATH fallback branch rather than a constant.
  const probe = spawnSync(BUILD_BIN_DEFAULT, ["--version"], { encoding: "utf8" })
  if (probe.error || probe.status !== 0) {
    record("build tool available", false, `"${BUILD_BIN_DEFAULT}" is not runnable — the gate cannot rebuild anything, so no arm can pass`)
    console.log(`\n[verify-dist-fresh self-test] 0/${arms.length} arms passed — FAIL`)
    process.exitCode = 1
    return
  }

  // THE RESOLVER ITSELF (declared follow-up, closed 2026-09-30): the branch that matters is the one a
  // bare-PATH run never takes, so it is asserted here rather than left to a reader's shell. A tree
  // with `.toolchain/node_modules/.bin/bun` that reports the recorded version must WIN, and one whose
  // local bun disagrees must FALL BACK — preferring the wrong bun would certify the bytes under it.
  {
    /** A sandbox shaped like a checkout with its own toolchain installed. */
    const toolchainSandbox = mkdtempSync(join(tmpdir(), TMP_PREFIX + "bin-"))
    /** A stand-in bundler that answers a FIXED version, so the arm does not depend on a real bun. */
    const fakeBin = (version: string): string => {
      /** The stand-in's path, shimmed as an executable the probe can spawn. */
      const at = join(toolchainSandbox, TOOLCHAIN_BIN_DIR)
      mkdirSync(at, { recursive: true })
      /** The shim's path; a shell script is enough for a `--version` probe. */
      const shim = join(at, "bun")
      writeFileSync(shim, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
      writeFileSync(join(toolchainSandbox, "package.json"), JSON.stringify({ buildToolchain: "bun@9.9.9" }))
      return shim
    }
    fakeBin("9.9.9")
    /** The resolution over a tree whose local bun AGREES with the pin. */
    const agreeing = resolveBuildBin(toolchainSandbox)
    record("(h4) a local toolchain that AGREES with the pin is preferred over PATH", agreeing.source === "toolchain" && agreeing.bin.includes(TOOLCHAIN_BIN_DIR) && agreeing.pinned === "9.9.9")
    fakeBin("1.0.0")
    /** The resolution over the same tree with a DISAGREEING local bun. */
    const disagreeing = resolveBuildBin(toolchainSandbox)
    record("(h5) a local toolchain that DISAGREES with the pin falls back to PATH and says so", disagreeing.source === "path" && disagreeing.bin === BUILD_BIN_DEFAULT)
    rmSync(toolchainSandbox, { recursive: true, force: true })
  }

  // The temp fixture root every arm builds its tree under.
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dist-fresh-selftest-"))
  // The alpha artifact arm (b) mutates and then restores.
  const alphaDist = join(sandbox, "packages/alpha/dist/index.js")
  try {
    buildFixture(sandbox, BUILD_BIN_DEFAULT)

    // (a) a matching fixture is green
    const clean = verifyDistFresh(sandbox)
    record("(a) matching fixture -> 0 findings, ok=true", clean.ok === true && clean.findings.length === 0, `ok=${clean.ok} findings=${clean.findings.length} targets=${clean.targets.length}`)
    // The same fixture through the real CLI, so the spawned gate's exit code is witnessed too.
    const cleanExit = runCli(["--root", sandbox, "--json"], scriptPath)
    record("(a2) the spawned gate exits 0 on the clean fixture", cleanExit.status === 0 && cleanExit.json !== null && cleanExit.json.ok === true, `exit=${cleanExit.status} json.ok=${cleanExit.json === null ? "unparsable" : cleanExit.json.ok}`)

    // (b) THE negative control: a seeded mismatch must fail the real gate
    // The committed artifact's original bytes, restored at the end of the arm.
    const before = readFileSync(alphaDist)
    // SHA-256 of those bytes, compared after the restore to prove the restore was byte-exact.
    const beforeSha = sha256(before)
    appendFileSync(alphaDist, "\n// seeded staleness (self-test arm b)\n")
    // The real gate's run against the seeded mismatch.
    const stale = runCli(["--root", sandbox, "--json"], scriptPath)
    // Whether the run reported STALE against the mutated alpha package.
    const staleHit = stale.json !== null && stale.json.findings.some((f: Finding): boolean => f.kind === "STALE" && f.pkg === "alpha")
    record("(b) a mutated fixture dist -> STALE finding + exit 1", stale.status === 1 && staleHit, `exit=${stale.status} kinds=${stale.json === null ? "unparsable" : stale.json.findings.map((f: Finding): FindingKind => f.kind).join(",")}`)
    writeFileSync(alphaDist, before)
    // SHA-256 after the restore; equality with `beforeSha` proves the mutation left no residue.
    const afterSha = sha256(readFileSync(alphaDist))
    // The real gate's run against the restored fixture.
    const restored = runCli(["--root", sandbox, "--json"], scriptPath)
    record("(b2) the restored fixture is green again and the bytes are identical", restored.status === 0 && afterSha === beforeSha, `sha ${beforeSha.slice(0, 12)}… -> ${afterSha.slice(0, 12)}… exit=${restored.status}`)

    // (c) source without a committed artifact
    writeFixtureFile(sandbox, "packages/beta/src/index.ts", 'export const betaValue: string = "beta"\n')
    // The real gate's run against a tree that now has a src-without-dist package.
    const missing = runCli(["--root", sandbox, "--json"], scriptPath)
    // Whether the run reported MISSING against the new beta package.
    const missingHit = missing.json !== null && missing.json.findings.some((f: Finding): boolean => f.kind === "MISSING" && f.pkg === "beta")
    record("(c) src without dist -> MISSING finding", missing.status === 1 && missingHit, `exit=${missing.status} kinds=${missing.json === null ? "unparsable" : missing.json.findings.map((f: Finding): FindingKind => f.kind).join(",")}`)

    // (d) a dist file no source maps to is listed loudly, and covered files are not
    // The NOT COVERED entry for the orphan fixture artifact, when the gate listed it.
    const orphan = clean.notCovered.find((n: UncoveredFile): boolean => n.path === "packages/gamma/dist/thing.js")
    record("(d) dist with no source -> NOT COVERED with a reason", orphan !== undefined && orphan.reason.length > 0, orphan === undefined ? "packages/gamma/dist/thing.js missing from the NOT COVERED list" : `reason="${orphan.reason}"`)
    // Whether every artifact the gate DID build stayed out of the NOT COVERED list.
    const covered = clean.notCovered.every((n: UncoveredFile): boolean => !FIXTURE_DISTS.includes(n.path))
    record("(d2) every mapped dist is covered, incl. the declared sdk entry", covered && clean.targets.some((t: TargetResult): boolean => t.dist === "packages/delta/dist/sdk.js"), `targets=${clean.targets.map((t: TargetResult): string => t.dist).join(", ")}`)

    // (e) --only narrows the checked set (and with it the findings)
    // The real gate's run filtered to the alpha package.
    const only = runCli(["--root", sandbox, "--only", "alpha", "--json"], scriptPath)
    // Whether that run checked exactly the one matching target and dropped the beta finding.
    const onlyOk = only.status === 0 && only.json !== null && only.json.targets.length === 1 && !only.json.findings.some((f: Finding): boolean => f.pkg === "beta")
    record("(e) --only filters to the matching target only", onlyOk, `exit=${only.status} targets=${only.json === null ? "unparsable" : JSON.stringify(only.json.targets.map((t: TargetResult): string => t.dist))}`)
    // The real gate's run whose filter matches nothing at all.
    const onlyNone = runCli(["--root", sandbox, "--only", "no-such-target", "--json"], scriptPath)
    // Whether that run refused to report PASS with nothing checked.
    const zeroSubject = onlyNone.json !== null && onlyNone.json.findings.some((f: Finding): boolean => f.kind === "NO_TARGETS")
    record("(e2) a filter matching nothing is a zero-subject failure", onlyNone.status === 1 && zeroSubject, `exit=${onlyNone.status}`)

    // (f) a bad flag is a usage error, never a silent green
    // The real gate's run with an unknown flag.
    const bad = runCli(["--definitely-not-a-flag"], scriptPath)
    record("(f) bad flag -> exit 1 + usage on stderr", bad.status === 1 && /usage/i.test(bad.stderr) && bad.stdout === "", `exit=${bad.status} stderr=${JSON.stringify(bad.stderr.split("\n")[0] ?? "")}`)

    // (g) T-67: the FORM a package DECLARES. A `scripts.build` in the package-directory form must be
    // flagged, and the canonical command must be DERIVED into the message (never a hard-coded entry);
    // switching the same manifest to the canonical form must clear the finding, so the arm proves the
    // check discriminates instead of always complaining.
    /** Render a `ghost` package manifest whose `scripts.build` is the given command line. */
    const ghostPkg = (build: string): string => JSON.stringify({ name: "ghost", scripts: { build } }, null, 2)
    // The fixture's own spelling of the sanctioned cwd anchor, asserted inside the finding detail.
    const anchor = 'cd "$(git rev-parse --show-toplevel)"'

    writeFixtureFile(sandbox, "packages/ghost/package.json", ghostPkg("bun build src/index.ts --target node --format esm --outfile dist/index.js"))
    // The real gate's run against the package-directory form of the ghost manifest.
    const ghostForm = runCli(["--root", sandbox, "--json"], scriptPath)
    // Whether the run reported BUILD_FORM for ghost AND derived the path-qualified canonical command.
    const formHit =
      ghostForm.json !== null &&
      ghostForm.json.findings.some(
        (f: Finding): boolean => f.kind === "BUILD_FORM" && f.pkg === "ghost" && f.detail.includes(anchor + " && bun build packages/ghost/src/index.ts --target node --format esm --outfile packages/ghost/dist/index.js"),
      )
    record("(g) package-directory scripts.build -> BUILD_FORM + derived canonical command", ghostForm.status === 1 && formHit, `exit=${ghostForm.status} kinds=${ghostForm.json === null ? "unparsable" : ghostForm.json.findings.map((f: Finding): FindingKind => f.kind).join(",")}`)
    writeFixtureFile(sandbox, "packages/ghost/package.json", ghostPkg(anchor + " && bun build packages/ghost/src/index.ts --target node --format esm --outfile packages/ghost/dist/index.js"))
    // The real gate's run against the canonical form of the same ghost manifest.
    const ghostCanonical = runCli(["--root", sandbox, "--json"], scriptPath)
    // Whether switching the SAME manifest to the canonical form cleared the BUILD_FORM finding.
    const formClear = (ghostCanonical.json?.findings ?? []).every((f: Finding): boolean => f.kind !== "BUILD_FORM")
    // A green exit is impossible here by construction: arm (c) left `beta` as src-without-dist, so the
    // only finding this arm tolerates is that known one. Naming it keeps the assertion from going
    // tautological the day another rule starts firing in this sandbox.
    // Whether the run still carries exactly the known beta MISSING finding.
    const knownBeta = (ghostCanonical.json?.findings ?? []).some((f: Finding): boolean => f.kind === "MISSING" && f.pkg === "beta")
    record("(g2) canonical repo-root scripts.build -> no BUILD_FORM finding", formClear && knownBeta, `exit=${ghostCanonical.status} kinds=${ghostCanonical.json === null ? "unparsable" : ghostCanonical.json.findings.map((f: Finding): FindingKind => f.kind).join(",")}`)
    // (h) the build-toolchain record: a drifted pin, an exact pin and an absent pin must be
    // DISTINGUISHABLE in the result - the pin is only worth having if a run reports it.
    /** Render the fixture root manifest: a pin when one is given, no record when null. */
    const rootManifest = (buildToolchain: string | null): string => JSON.stringify(buildToolchain === null ? { name: "fixture" } : { name: "fixture", buildToolchain }, null, 2)
    // Write the given root manifest and return the toolchain section of the gate's own report.
    const toolchainOf = (buildToolchain: string | null): ToolchainReport | null => {
      writeFixtureFile(sandbox, "package.json", rootManifest(buildToolchain))
      // The real gate's run under the freshly written root manifest.
      const run = runCli(["--root", sandbox, "--json", "--only", "alpha"], scriptPath)
      return run.json?.toolchain ?? null
    }
    // The report produced under a pin that cannot match the bun running here.
    const drifted = toolchainOf("bun@0.0.1")
    // The report produced under a pin that matches the observed bun exactly.
    const exact = toolchainOf("bun@" + (drifted?.current ?? "0.0.1"))
    record("(h) an exact buildToolchain record reports drift=false", exact !== null && exact.pinned === exact.current && exact.drift === false && exact.note === "", `pinned=${exact?.pinned} current=${exact?.current} drift=${exact?.drift}`)
    record("(h2) a drifted record reports drift=true + a note", drifted !== null && drifted.pinned === "0.0.1" && drifted.drift === true && drifted.note.includes("bun@0.0.1"), `pinned=${drifted?.pinned} current=${drifted?.current} drift=${drifted?.drift}`)
    // The report produced with no `buildToolchain` record at all.
    const unpinned = toolchainOf(null)
    record("(h3) an absent record is named, never treated as green", unpinned !== null && unpinned.pinned === null && unpinned.drift === false && unpinned.note.includes("no buildToolchain record"), `pinned=${unpinned?.pinned} note=${JSON.stringify(unpinned?.note ?? "")}`)
  } catch (error) {
    // A thrown arm invalidates the census, so it is recorded as its own failed arm.
    record("self-test harness", false, error instanceof Error ? (error.stack ?? String(error)) : String(error))
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  // How many arms held; the census below is red unless every arm did.
  const passed = arms.filter((a: SelfTestArm): boolean => a.ok).length
  // Whether every arm passed.
  const ok = passed === arms.length
  console.log(`\n[verify-dist-fresh self-test] ${passed}/${arms.length} arms passed — ${ok ? "PASS" : "FAIL"}`)
  // exitCode (never process.exit) so a piped stdout is never truncated.
  process.exitCode = ok ? 0 : 1
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The usage text printed for `--help` and for a rejected flag (the latter to stderr). */
const USAGE = `usage: node scripts/verify-dist-fresh.ts [--json] [--quiet] [--only <substr>] [--keep-tmp]
       node scripts/verify-dist-fresh.ts --self-test
       node scripts/verify-dist-fresh.ts [--root <dir>]

Rebuild every packages/*/src entry twice into a temp dir and diff it byte-for-byte against its
committed packages/*/dist file. Exit 0 when every covered target is fresh; 1 on any finding
(STALE / MISSING / NONDETERMINISTIC / BUILD_FAILED / TIMEOUT / UNREADABLE), on a zero-subject run,
or on a bad flag. dist files no target maps to are always printed in a NOT COVERED section.`

/** The parsed command line, with the defaults the CLI documents. */
interface CliOptions {
  /** Whether to print one JSON document on stdout and nothing else. */
  json: boolean
  /** Whether to drop the header and the per-target lines while keeping findings and the summary. */
  quiet: boolean
  /** Substring limiting which targets are built and checked, or null for every target. */
  only: string | null
  /** Whether to run the fixture self-test instead of verifying a tree. */
  selfTest: boolean
  /** Whether to keep the build temp directory instead of removing it. */
  keepTmp: boolean
  /** The tree to verify; defaults to the repository root. */
  root: string
}

/** The parse result: the options always, plus whichever terminal flag ended the scan. */
interface ParsedArgs {
  /** The options collected so far, valid even when a flag was rejected. */
  readonly options: CliOptions
  /** The usage error that ended the scan, when a flag was unknown or missing its value. */
  readonly error?: string
  /** Whether `--help`/`-h` asked for the usage text instead of a run. */
  readonly help?: boolean
}

/** Parse the CLI arguments; the first bad flag ends the scan and is reported, never ignored. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // The options as collected, starting from the documented defaults.
  const options: CliOptions = { json: false, quiet: false, only: null, selfTest: false, keepTmp: false, root: DEFAULT_ROOT }
  // Index of the argument currently being scanned.
  for (let i = 0; i < argv.length; i += 1) {
    // The argument at index `i`, compared against the flag table below.
    const arg = argv[i]
    if (arg === "--json") options.json = true
    else if (arg === "--quiet") options.quiet = true
    else if (arg === "--self-test") options.selfTest = true
    else if (arg === "--keep-tmp") options.keepTmp = true
    else if (arg === "--only" || arg === "--root") {
      // The flag's value, taken from the argument that follows it.
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

/** Print the human-readable report: header, findings, NOT COVERED, kept temp dir, summary. */
function printReport(result: VerifyResult, options: CliOptions): void {
  // The report's own sink, so every line goes through one call site.
  const log = (line: string): void => console.log(line)
  if (!options.quiet) log(`[verify-dist-fresh] root: ${result.root}  (build: bun build <src> --target node --format esm --outfile <tmp>/<entry>.js)`)
  if (!options.quiet) {
    // The toolchain section, naming both the observed binary and the recorded pin.
    const toolchain = result.toolchain
    // THE SOURCE IS PRINTED, so a reader can tell a run that used the PINNED toolchain from one that
    // fell back to PATH — the distinction the whole resolver exists to make visible.
    log(`[verify-dist-fresh] build toolchain: bun ${toolchain.current ?? "unavailable"} from ${toolchain.source === "toolchain" ? "the repository toolchain" : "PATH"} (${toolchain.bin}) · recorded buildToolchain ${toolchain.pinned === null ? "(none)" : "bun@" + toolchain.pinned}${toolchain.note === "" ? "" : " — NOTE: " + toolchain.note}`)
  }
  for (const finding of result.findings) log(`  ${finding.kind}: ${finding.pkg === "-" ? "" : `${finding.dist} — `}${finding.detail}`)
  log(result.notCovered.length === 0
    ? "[verify-dist-fresh] NOT COVERED (0): every committed packages/*/dist file maps to a covered target"
    : `[verify-dist-fresh] NOT COVERED (${result.notCovered.length}) — committed dist files no target maps to, listed so nothing is silently skipped:`)
  for (const note of result.notCovered) log(`  ${note.path} — ${note.reason}`)
  if (result.tmpRoot !== null) log(`[verify-dist-fresh] temp kept: ${result.tmpRoot}`)
  log(result.summary)
}

/** Gate entry point: parse the flags, then self-test, JSON output or the human report. */
function main(): void {
  // The parsed command line: options always, plus whichever terminal flag ended the scan.
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

  // The completed verification run this invocation reports on.
  const result = verifyDistFresh(options.root, {
    only: options.only,
    keepTmp: options.keepTmp,
    quiet: options.quiet || options.json,
    log: (line: string): void => console.log(line),
  })
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else printReport(result, options)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
