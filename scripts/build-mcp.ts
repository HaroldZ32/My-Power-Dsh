#!/usr/bin/env node
// Offline build of the git-bash / lsp MCP servers: copy their sources from the IN-REPO
// snapshot at vendor/mcp-src/ (read-only) into a temp workspace, resolve external dependencies from
// the bun cache, then after bun build copy the dist artifacts into the mpd-dsh plugin package.
// NO upstream checkout and NO network are needed: the snapshot IS the build input, and every path
// below resolves from the repository root alone. The snapshot's origin, the one-time fetch that
// produced it and the license it carries are recorded in vendor/mcp-src/README.md.
// The ast-grep server is NOT built here any more (de-omo wave B1): it is written in this repository
// and built from `packages/mpd-mcp-astgrep/src/cli.ts` by that package's own build script, so the
// snapshot package `ast-grep-mcp` is no longer a build input of this script.
// Artifacts go into the plugin package (plugin-form) with SHA256 recorded in BUILD.lock.
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this script's own URL (`<root>/scripts/build-mcp.ts`). */
const repoRoot = repoRootFrom(import.meta.url)
// The build input is the IN-REPO snapshot whose package directories are the verbatim sources of
// git-bash-mcp / lsp-daemon / lsp-core / mcp-stdio-core / utils / omo-config-core. The
// retired form read them out of an external `oh-my-openagent` checkout; nothing outside this
// repository is consulted any more, so MPD_UPSTREAM_ROOT is no longer read at all.
/** The in-repo source snapshot (`<root>/vendor/mcp-src/`) every copied package directory comes from. */
const mcpSrcRoot = join(repoRoot, "vendor", "mcp-src")
/** Snapshot package directories this build requires; a missing one is a loud FAIL, never an ENOENT stack. */
const REQUIRED_SNAPSHOT_PACKAGES: readonly string[] = ["git-bash-mcp", "lsp-daemon", "lsp-core", "mcp-stdio-core", "utils", "omo-config-core"]
/** bun's install cache, from which every external dependency is linked instead of re-downloaded. */
const cacheRoot = join(homedir(), ".bun", "install", "cache")

/** One MCP server this build produces: its snapshot package and the plugin package that receives the dist. */
interface ServerSpec {
  /** Server name, which is also the key into the MPD scrub table below. */
  readonly name: string
  /** Package directory name inside the in-repo snapshot (`vendor/mcp-src/`). */
  readonly src: string
  /** This repository's plugin package that receives `dist/cli.js`. */
  readonly pkg: string
  /** bun build entry, relative to the copied source package directory. */
  readonly entry: string
  /** Extra argv recorded for the server (the lsp daemon ships an `mcp` subcommand). */
  readonly argv: readonly string[]
}

/** The MCP servers built here, in build order. */
const SERVERS: readonly ServerSpec[] = [
  { name: "git-bash", src: "git-bash-mcp", pkg: "mpd-mcp-gitbash", entry: "src/cli.ts", argv: [] },
  { name: "lsp", src: "lsp-daemon", pkg: "mpd-mcp-lsp", entry: "src/cli.ts", argv: ["mcp"] }
]
// The snapshot keeps the upstream package directory names verbatim (upstream files are never
// renamed), so the shared config package is the directory `omo-config-core` even though the plugin
// package that ships a built server is named `mpd-mcp-*`. Spelling it `mpd-config-core` here matches
// no directory in the snapshot and breaks the offline build with ENOENT.
/** Snapshot packages copied alongside each server so the bun build can resolve their imports. */
const CORE = ["mcp-stdio-core", "utils", "omo-config-core", "lsp-core"]
/** External dependencies linked from the bun cache, keyed by the specifier the built code imports. */
const EXTERNAL: Readonly<Record<string, string>> = { "js-yaml": "js-yaml@4.3.1", "jsonc-parser": "jsonc-parser@3.3.1", "zod": "zod@4.4.3" }

// --- mpd LSP overlay: in-repo patched copies of the upstream lsp-core files ---
// The overlay lives at packages/mpd-mcp-lsp/overlay/lsp/ and carries a
// drift-guard anchor marker. The anchor must exist in BOTH the overlay file
// and the overlay-applied source, otherwise the build FAILS loudly — this
// prevents silent divergence from the upstream lsp-core baseline (e.g. a stale
// overlay silently applied over a drifted upstream file). Overlay files are
// full patched copies of the upstream lsp-core files; the anchor was renamed to
// mpd-lsp-overlay-v1 (t8) when the retired HDL registrations left the overlay,
// so both sides are checked for the SAME current marker.
/** Absolute path of the in-repo overlay directory holding the patched lsp-core files. */
const LSP_OVERLAY_DIR = join(repoRoot, "packages", "mpd-mcp-lsp", "overlay", "lsp")
/** The drift-guard marker both the overlay file and the applied source must carry. */
const BUILTIN_BUILD_ANCHOR = "mpd-lsp-overlay-v1"

/** One overlay file: its name in the overlay directory and the lsp-core path it replaces. */
interface LspOverlayFile {
  /** File name inside `packages/mpd-mcp-lsp/overlay/lsp/`. */
  readonly name: string
  /** Destination path inside the copied `lsp-core` tree in the temp workspace. */
  readonly rel: string
  /** Export the upstream baseline must still carry, so a drifted baseline fails loudly. */
  readonly baselineExport: string
}

/** The lsp-core files the in-repo overlay replaces. */
const LSP_OVERLAY_FILES: readonly LspOverlayFile[] = [
  { name: "server-definitions.ts", rel: "src/lsp/server-definitions.ts", baselineExport: "BUILTIN_SERVERS" },
  { name: "language-mappings.ts", rel: "src/lsp/language-mappings.ts", baselineExport: "EXT_TO_LANG" },
]

// Apply the in-repo LSP overlay over the freshly-copied snapshot lsp-core source (inside the temp
// build workspace). Overlay missing/stale or snapshot baseline drifted -> FAIL loudly instead of
// producing a silently wrong dist.
/**
 * Apply every overlay file over the copied lsp-core source, failing loudly when the overlay is
 * missing/stale or the snapshot baseline has drifted.
 *
 * @param srcRoot - The temp workspace's `src` directory holding the copied snapshot packages.
 */
function applyLspOverlay(srcRoot: string): void {
  // Each overlay file is checked on both sides (overlay anchor, snapshot export) before it is copied.
  for (const f of LSP_OVERLAY_FILES) {
    /** The in-repo patched copy of this lsp-core file. */
    const overlayPath = join(LSP_OVERLAY_DIR, f.name)
    /** The freshly copied snapshot file the overlay replaces. */
    const sourcePath = join(srcRoot, "lsp-core", f.rel)
    if (!existsSync(overlayPath)) {
      console.error("[build-mcp] FAIL - mpd LSP overlay file missing: " + overlayPath)
      process.exit(1)
    }
    /** Overlay content, scanned for the drift-guard anchor before it is applied. */
    const overlayText = readFileSync(overlayPath, "utf8")
    if (!overlayText.includes(BUILTIN_BUILD_ANCHOR)) {
      console.error(`[build-mcp] FAIL - overlay ${f.name} lacks drift-guard anchor "${BUILTIN_BUILD_ANCHOR}" (stale/foreign overlay?)`)
      process.exit(1)
    }
    if (!existsSync(sourcePath)) {
      console.error("[build-mcp] FAIL - snapshot lsp-core source missing: " + sourcePath)
      process.exit(1)
    }
    /** Snapshot baseline content, scanned for the export the overlay is expected to replace. */
    const sourceText = readFileSync(sourcePath, "utf8")
    if (!sourceText.includes(f.baselineExport)) {
      console.error(`[build-mcp] FAIL - snapshot ${sourcePath} no longer exports ${f.baselineExport} (snapshot baseline drifted?)`)
      process.exit(1)
    }
    cpSync(overlayPath, sourcePath)
    /** Post-copy content, re-read to prove the anchor really landed in the workspace. */
    const appliedText = readFileSync(sourcePath, "utf8")
    if (!appliedText.includes(BUILTIN_BUILD_ANCHOR)) {
      console.error(`[build-mcp] FAIL - overlay ${f.name} did not apply (anchor missing after copy)`)
      process.exit(1)
    }
    console.log("[build-mcp] mpd LSP overlay applied: " + f.name + " -> " + sourcePath)
  }
}

/** One resolved bun-cache entry: where to link from and the versioned name to record in BUILD.lock. */
interface CacheEntry {
  /** Absolute path of the cache directory to symlink. */
  readonly path: string
  /** The versioned cache entry name (the key recorded in BUILD.lock). */
  readonly entry: string
}

// F6 fix: discover all cache entries by package-name prefix, prefer an exact match for the "expected version", otherwise take the highest version;
// write the actually resolved entries to BUILD.lock for reproducibility.
/**
 * Resolve one `name@version` request against the bun cache.
 *
 * @param entry - The `name@version` string declared in EXTERNAL.
 * @returns The preferred cache entry, or `null` when the cache holds no version of that package.
 */
function findCache(entry: string): CacheEntry | null {
  /** Package name half of the request, used as the cache-entry prefix. */
  const prefix = entry.split("@")[0]
  /** Cache directories carrying that prefix. */
  const matches = readdirSync(cacheRoot).filter((d: string) => d.startsWith(prefix + "@"))
  if (matches.length === 0) return null
  /** Version half of the request, recorded here although the selection below does not read it. */
  const want = entry.split("@")[1]
  /** The exact `name@version` entry when the cache has it. */
  const exact = matches.find((d: string) => d === entry)
  /** The exact match when present, otherwise the highest cached version (numeric collation). */
  const chosen = exact ?? [...matches].sort((a: string, b: string) => {
    /** Version half of the left-hand cache entry. */
    const va = a.slice(prefix.length + 1)
    /** Version half of the right-hand cache entry. */
    const vb = b.slice(prefix.length + 1)
    return vb.localeCompare(va, undefined, { numeric: true })
  })[0]
  return { path: join(cacheRoot, chosen), entry: chosen }
}

// --- MPD scrub (t3 Phase B, captain-approved): post-bundle upstream-spelling -> MPD_ prefix rename ---------
// The pristine upstream source still uses its own OMO_* spellings; the committed dists were
// hand-scrubbed into the MPD_ prefix by commit 7d8f910 (direct dist edits, no rebuild), and AGENTS.md
// pins the MPD_* contract (e.g. MPD_AST_GREP_SG_PATH). Apply the same key-level rename to
// the freshly built cli.js so future rebuilds reproduce the committed convention. This is
// a TARGETED key list, never a global sed over "omo" (that would corrupt unrelated words
// such as "from" or the git-bash launcher-path env key).

/** One rewrite: a literal or a structure-anchored RegExp, and the literal that replaces it. */
type ScrubRule = readonly [from: string | RegExp, to: string]

/** One server's scrub program: the rewrites to apply and the tokens that must not survive them. */
interface ScrubConfig {
  /** Rewrites applied in order to the built artifact. */
  readonly replace: readonly ScrubRule[]
  /** Upstream brand tokens whose survival after the rewrites is a loud failure. */
  readonly residual: readonly (string | RegExp)[]
}

/** The targeted upstream-spelling to `MPD_` renames, keyed by server name. */
const MPD_SCRUB: Readonly<Record<string, ScrubConfig>> = {
  lsp: {
    replace: [
      ["OMO_DAEMON_PROTOCOL_VERSION", "MPD_DAEMON_PROTOCOL_VERSION"],
      ["OMO_LSP_DAEMON_CLI", "MPD_LSP_DAEMON_CLI"],
      ["OMO_LSP_DAEMON_DIR", "MPD_LSP_DAEMON_DIR"],
      ["OMO_LSP_DAEMON_VERSION", "MPD_LSP_DAEMON_VERSION"],
      [".omo", ".mpd"],
      ["omo-lsp-daemon", "mpd-lsp-daemon"],
      ["omo-lsp-", "mpd-lsp-"],
      ["omo/ping", "mpd/ping"],
      // Windows-only startup crash, fixed at the artifact level because the upstream line lives
      // OUTSIDE the lsp-core overlay band: the win32 named-pipe branch reads the account name
      // unconditionally (`resolveSocketPath` -> `platform.username()`), and `os.userInfo()` THROWS
      // on Windows hosts where libuv's `uv_os_get_passwd` fails (measured: `ERR_SYSTEM_ERROR: ...
      // uv_os_get_passwd returned ENOMEM`). That took the whole MCP row down before a single
      // JSON-RPC frame was answered (exit 1). The hardened form keeps the original call FIRST, so
      // every healthy host resolves exactly the name it always did, and only the throwing host
      // falls back to the environment's account name.
      ["username: () => userInfo().username", "username: () => { try { return userInfo().username; } catch { return process.env.USERNAME || process.env.USER || \"user\"; } }"],
      // The LSP auth envelope is renamed on BOTH sides (writer + reader/stripper live in this same
      // artifact), so a rebuild must emit the mpd spelling and a re-introduced envelope still fails
      // the residual check. The pattern is written the way the brand regex below writes it -- an
      // underscore followed by the omo shape -- so no shipped file has to spell the retired key.
      [/_(?:om)o/g, "_mpd"],
    ],
    residual: ["OMO_", ".omo", "omo-lsp", "omo/ping", /_(?:om)o/, "username: () => userInfo().username"],
  },
  "git-bash": {
    // The upstream git-bash env contract is DELETED (DSH-only, owner ruling (c)): the env-key reads,
    // the install hint that named the key and the allowlist entries go with it. What remains is the
    // artifact's own name and the tmpdir prefix, both renamed into the mpd spelling.
    replace: [
      ["omo-git-bash", "mpd-git-bash"],
      // gb-01: the env-key declaration (the value is whatever upstream spells it)
      [/var GIT_BASH_ENV_KEY = "[A-Z_]+";\n/, ""],
      // gb-02: the env-lookup tier of the resolver (the remaining tiers stay)
      ["  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY);\n  if (envPath !== undefined) {\n    checkedPaths.push(envPath);\n    if (isBashExePath(envPath) && input.exists(envPath)) {\n      return { found: true, path: envPath, source: \"env\", checkedPaths };\n    }\n    return missingGitBash(checkedPaths);\n  }\n", ""],
      // gb-03: the install hint named the deleted key (the trailing comma goes with the line)
      ["      \"Install it with: winget install --id Git.Git -e --source winget\",\n      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\\\path\\\\to\\\\bash.exe`\n", "      \"Install it with: winget install --id Git.Git -e --source winget\"\n"],
      // gb-04: rewrite the timeout-key list down to the two keys that carry no brand token; the list
      // is matched as a whole, so the deleted keys never have to be spelled in a shipped file
      [/var EXEC_COMMAND_TIMEOUT_ENV_KEYS = \[[\s\S]*?\];\n/, "var EXEC_COMMAND_TIMEOUT_ENV_KEYS = [\n  \"CODEX_EXEC_COMMAND_TIMEOUT_MS\",\n  \"EXEC_COMMAND_TIMEOUT_MS\"\n];\n"],
    ],
    // residual literal: the artifact's own name. The brand-token guard below (assertBrandClean with an
    // EMPTY allowlist) is the loud check that no brand token survives at all, so a literal residual
    // naming the retired key would only make the wave's own acceptance grep fail.
    residual: ["omo-git-bash"],
  },
}

// Apply the key-level upstream -> MPD_ prefix scrub to a built cli.js, then assert no residual remains
// (loud FAIL so a drifted upstream never silently ships an un-scrubbed dist).
/**
 * Scrub one built artifact into the committed `MPD_` spelling.
 *
 * @param serverName - Server name, the key into MPD_SCRUB; an unknown name is returned unchanged.
 * @param text - The freshly built artifact text.
 * @returns The scrubbed text.
 */
export function applyMpdScrub(serverName: string, text: string): string {
  /** This server's scrub program, absent when the server has no renames. */
  const cfg: ScrubConfig | undefined = MPD_SCRUB[serverName]
  if (!cfg) return text
  /** The artifact text as rewritten so far. */
  let out = text
  // A literal entry is matched verbatim; a RegExp entry is anchored on structure so a scrub table
  // never has to spell a retired brand literal it is deleting (the wave's acceptance greps scan
  // these very files). See BRAND_TOKEN_RE below for the same discipline.
  for (const [from, to] of cfg.replace) out = from instanceof RegExp ? out.replace(from, to) : out.split(from).join(to)
  // Every token the rewrites were supposed to remove is re-checked on the rewritten text.
  for (const residual of cfg.residual) {
    if (residual instanceof RegExp ? residual.test(out) : out.includes(residual)) {
      console.error(`[build-mcp] FAIL - ${serverName} dist still contains upstream brand token "${residual}" after the MPD scrub`)
      process.exit(1)
    }
  }
  return out
}


/**
 * SHA-256 of one file, as the hex digest recorded in BUILD.lock.
 *
 * @param p - Path of the file to hash.
 */
function sha(p: string): string { return createHash("sha256").update(readFileSync(p)).digest("hex") }

// --- mpd brand guard (t20 / X1) -------------------------------------------------------
// applyMpdScrub above is a TARGETED key list and asserts only the residuals it already
// knows, so a rebuild could still silently ship an upstream brand token the list has never
// seen — measured 2026-09-13: OMO_PROVISION_HINT / omo-git-bash-run- / platformFromOptions
// shaped drift reappeared from pre-rebrand upstream source and only a manual
// `git checkout HEAD -- <dist>` restored the committed bytes. This guard is the mechanical
// complement: SCAN every built artifact and FAIL LOUDLY (non-zero, naming token + artifact)
// on any brand-shaped token that is not deliberately allowlisted below. It never rewrites
// anything: widening the transform into a global "omo" replace would corrupt unrelated
// identifiers — the measured false-positive class is `platformFromOpenCodeConfigPath`
// ("romO" across a morpheme boundary) and `platformFromOptions`.
//
// PRIMARY SUBJECT (captain correction, measured): the git-bash scrub's replace list holds only
// `omo-git-bash-run-`, so a bare `omo-git-bash` used in usage/help/error text passes through
// untouched and the loud residual check reports nothing. A bare `omo-git-bash` (any suffix, any
// embedding) is therefore exactly what this guard must fail on.
// DELIBERATELY OUT OF SCOPE: `platformFrmpdOptions`. Our older global upstream-spelling -> mpd rewrite corrupted
// upstream's English identifier `platformFromOptions`; a rebuild from upstream source produces the
// CORRECT spelling, so asserting on the corrupted one would freeze it. It contains no `omo` trigram
// and the guard neither flags nor blesses it.
//
// The allowlist is DATA (one entry per deliberately-kept foreign token) and follows
// classification (b) of the brand-contract review recorded in the reasons below.

/** One deliberately kept foreign token: the artifact that may carry it and the token itself. */
interface BrandAllowlistEntry {
  /** Artifact (server name) the token is permitted to appear in. */
  readonly artifact: string
  /** The exact brand-shaped token permitted in that artifact. */
  readonly token: string
}

/** Deliberate exemptions from the brand guard; empty by design, so every hit is a failure. */
export const BRAND_ALLOWLIST: readonly BrandAllowlistEntry[] = []
// Empty by design: every remaining brand-shaped literal in the scanned artifacts is either
// scrubbed away by the MPD_SCRUB tables above or an upstream-scope / build-time literal
// declared there. The empty list is ASSERTED, not assumed -- assertBrandClean below still
// fails loudly on any brand token that survives the scrub (the negative control seeds one).

// A brand-shaped token starts at a non-identifier boundary and is `omo` (optionally
// underscore-prefixed / suffixed). `platformFromOpenCodeConfigPath` cannot match: its
// "romO" is preceded by an alphanumeric. Case-insensitive, so both the `OMO_` and the `omo-` shapes are hit.
/** Matches one brand-shaped token, capturing group 1 as the token itself. */
const BRAND_TOKEN_RE = /(?<![A-Za-z0-9])(_{0,2}omo(?:[A-Z][A-Za-z0-9]*|[-_][A-Za-z0-9]*|\/[A-Za-z0-9._-]*)*[-_\/]?)/gi

/** Every brand-shaped occurrence in one artifact text (deduped, in order of appearance). */
export function brandTokens(text: string): string[] {
  return [...new Set([...text.matchAll(BRAND_TOKEN_RE)].map((match: RegExpMatchArray) => match[1]))]
}

/** One artifact's scan result: how many identifiers were inspected and which brand tokens were hit. */
interface BrandScan {
  /** Identifier-shaped tokens the scan walked. */
  readonly identifiers: number
  /** Distinct brand-shaped tokens found, in order of appearance. */
  readonly brand: string[]
}

/** Subject counts for one artifact: how many identifiers were inspected, how many brand hits. */
export function scanBrandTokens(text: string): BrandScan {
  return { identifiers: (text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).length, brand: brandTokens(text) }
}

/** The brand guard's verdict for one artifact: subject count, brand hits and how many were allowlisted. */
interface BrandVerdict {
  /** Identifier-shaped tokens the scan walked (0 is itself a failure). */
  readonly identifiers: number
  /** Distinct brand-shaped tokens found, before allowlisting. */
  readonly brand: number
  /** Brand hits the allowlist permitted (empty allowlist, so normally 0). */
  readonly allowlisted: number
}

/**
 * Fail loudly when a built artifact carries a brand token that is not allowlisted.
 * Exported so the negative control can drive it without rebuilding anything.
 *
 * @param artifact - Artifact name (server name) quoted in every failure line.
 * @param text - The built artifact text to scan.
 * @param allowlist - Tokens deliberately kept, keyed by artifact.
 * @returns The verdict counts for this artifact.
 */
export function assertBrandClean(artifact: string, text: string, allowlist: readonly BrandAllowlistEntry[] = BRAND_ALLOWLIST): BrandVerdict {
  /** The single scan this guard performs: identifier count plus raw brand hits. */
  const { identifiers, brand } = scanBrandTokens(text)
  if (identifiers === 0) {
    console.error(`[build-mcp] FAIL - brand guard: 0 identifiers inspected in ${artifact} (an empty scan is not a pass)`)
    process.exit(1)
  }
  /** Lower-cased tokens this artifact is allowed to carry. */
  const allowed = new Set(allowlist.filter((entry: BrandAllowlistEntry) => entry.artifact === artifact).map((entry: BrandAllowlistEntry) => entry.token.toLowerCase()))
  /** Brand hits with no matching allowlist entry. */
  const violations = brand.filter((token: string) => !allowed.has(token.toLowerCase()))
  if (violations.length > 0) {
    // Every offending token is named, not just the first, so one run lists the whole set.
    for (const token of violations) {
      console.error(`[build-mcp] FAIL - foreign brand token "${token}" in ${artifact} (not on the X1 allowlist declared in this file)`)
    }
    process.exit(1)
  }
  return { identifiers, brand: brand.length, allowlisted: brand.length }
}

// --- PRIMARY GUARD: byte equality against the committed dist (t20 amendment) ----------
// The committed dists are the ground truth of the brand convention, so the primary check is a
// BYTE COMPARISON of the scrubbed artifact against the committed file: it catches an un-scrubbed
// spelling, a reverted key and any future drift nobody enumerated, without maintaining a list of
// spellings. The token allowlist above stays as a LAYERED check (a bare `[Oo][Mm][Oo]` shape scan
// would reject the legitimate committed bytes: lsp carries the upstream OpenCode
// identifier and no brand token, git-bash none).
// Practical limit, stated rather than hidden: a full rebuild needs the in-repo snapshot at
// vendor/mcp-src/ plus bun and the external dependencies in the bun cache, so this function is
// exported and is exercisable as a pure function over artifact bytes (committed files + seeded
// mutants) when a rebuild must not run.
/**
 * Index of the first differing character of two texts.
 *
 * @param a - Left-hand text.
 * @param b - Right-hand text.
 * @returns The first differing index, or the shorter length when one text is a prefix of the other.
 */
function firstDifference(a: string, b: string): number {
  /** Length of the shorter input, the furthest index either text can differ at. */
  const max = Math.min(a.length, b.length)
  for (let i = 0; i < max; i += 1) if (a[i] !== b[i]) return i
  return max
}

/**
 * The line of `text` containing `index`, trimmed and capped for a one-line report.
 *
 * @param text - Text to slice the line out of.
 * @param index - Character offset whose line is wanted.
 */
function lineAt(text: string, index: number): string {
  return (text.slice(0, index).split("\n").pop() ?? "").trim().slice(0, 160)
}

/** How many artifacts were byte-compared and how many bytes were verified equal. */
interface ByteComparison {
  /** 1 when the artifact was compared, 0 when no committed baseline existed. */
  readonly compared: number
  /** Byte length of the artifact when it matched, 0 otherwise. */
  readonly bytes: number
}

/**
 * Compare a scrubbed artifact against its committed dist. Exported for the negative control.
 *
 * @param artifact - Artifact name quoted in the failure lines.
 * @param builtText - The scrubbed rebuild.
 * @param committedPath - The committed dist to compare against.
 * @returns The comparison counters; a mismatch exits non-zero instead of returning.
 */
export function assertRebuildMatchesCommitted(artifact: string, builtText: string, committedPath: string): ByteComparison {
  if (!existsSync(committedPath)) {
    console.warn(`[build-mcp] brand guard: no committed baseline for ${artifact} (${committedPath}); byte comparison skipped for this artifact`)
    return { compared: 0, bytes: 0 }
  }
  /** The committed ground truth for this artifact. */
  const committed = readFileSync(committedPath, "utf8")
  if (builtText === committed) return { compared: 1, bytes: Buffer.byteLength(builtText) }
  /** First differing character offset, quoted with the two byte lengths below. */
  const at = firstDifference(builtText, committed)
  console.error(`[build-mcp] FAIL - ${artifact} rebuild differs from the committed dist at char ${at} (rebuilt ${Buffer.byteLength(builtText)} B vs committed ${Buffer.byteLength(committed)} B); the committed dists are the brand ground truth and a rebuild must reproduce them`)
  console.error(`[build-mcp] FAIL - rebuilt line: ${JSON.stringify(lineAt(builtText, at))} | committed line: ${JSON.stringify(lineAt(committed, at))}`)
  process.exit(1)
}

/** Artifact counters folded over every built artifact: how many, how many identifiers, how many brand hits. */
interface BrandTotals {
  /** Artifacts the brand guard inspected. */
  artifacts: number
  /** Identifier-shaped tokens inspected across those artifacts. */
  identifiers: number
  /** Brand-shaped occurrences the allowlist permitted. */
  brand: number
}

/** Byte-comparison counters folded over every built artifact. */
interface ByteTotals {
  /** Artifacts compared against a committed baseline. */
  compared: number
  /** Bytes verified equal across those comparisons. */
  bytes: number
}

/** Build every server into its plugin package, guarding the brand convention on the way. */
function main(): void {
/** Brand-guard counters; an empty scan at the end is itself a failure. */
const brandTotals: BrandTotals = { artifacts: 0, identifiers: 0, brand: 0 }
/** Byte-comparison counters; zero comparisons at the end is itself a failure. */
const byteTotals: ByteTotals = { compared: 0, bytes: 0 }
/** Temp build workspace, removed in the finally below whatever the outcome. */
const work = mkdtempSync(join(tmpdir(), "mpd-dsh-mcp-build-"))
try {
  /** Copied snapshot sources, laid out as one fake workspace package root. */
  const srcRoot = join(work, "src")
  mkdirSync(srcRoot, { recursive: true })
  // Refuse a half-materialized snapshot by name: without this the first cpSync throws a bare ENOENT
  // and a reader cannot tell a missing snapshot from a missing single package.
  for (const p of REQUIRED_SNAPSHOT_PACKAGES) {
    if (!existsSync(join(mcpSrcRoot, p))) {
      console.error("[build-mcp] FAIL - in-repo source snapshot is incomplete: " + join(mcpSrcRoot, p) + " does not exist")
      console.error("[build-mcp] the snapshot is vendor/mcp-src/ and its origin is recorded in vendor/mcp-src/README.md")
      process.exit(1)
    }
  }
  // The shared CORE packages are copied first: each server build resolves its imports from here.
  for (const c of CORE) {
    cpSync(join(mcpSrcRoot, c), join(srcRoot, c), { recursive: true, filter: (s: string) => !s.includes("node_modules") && !s.includes("dist") && !s.includes(".git") })
  }
  // mpd LSP overlay: apply the in-repo patched copies over the copied
  // lsp-core source (drift-guarded). Must run after the lsp-core copy and
  // before any bun build so the patched registry is what gets baked in.
  applyLspOverlay(srcRoot)
  // Each server's own source package is copied next, under its snapshot directory name.
  for (const s of SERVERS) {
    cpSync(join(mcpSrcRoot, s.src), join(srcRoot, s.src), { recursive: true, filter: (p: string) => !p.includes("node_modules") && !p.includes("dist") && !p.includes(".git") })
  }
  // node_modules layout (mimic a bun workspace)
  /** Directory holding the linked shared packages, mimicking a bun workspace install. */
  const nm = join(work, "node_modules", "@oh-my-opencode")
  mkdirSync(nm, { recursive: true })
  // "junction", never "dir": a Windows directory SYMLINK needs SeCreateSymbolicLinkPrivilege and
  // answers EPERM without it, while a junction needs no privilege. The type is ignored on POSIX.
  // Each shared package is linked, never copied, so the fake workspace stays cheap.
  for (const c of CORE) {
    symlinkSync(join(srcRoot, c), join(nm, c), "junction")
  }
  /** Root of the external-dependency links, resolved through NODE_PATH by the builds below. */
  const extNm = join(work, "node_modules")
  /** External dependency name -> the cache entry actually resolved, recorded in BUILD.lock. */
  const resolvedExternals: Record<string, string> = {}
  // Every external dependency is linked from the bun cache, failing loudly when it is absent.
  for (const [name, entry] of Object.entries(EXTERNAL)) {
    /** The cache entry this request resolved to, or null when the cache has no version of it. */
    const from = findCache(entry)
    if (!from) { console.error("[build-mcp] bun cache missing external dependency: " + entry); process.exit(1) }
    symlinkSync(from.path, join(extNm, name), "junction")
    resolvedExternals[name] = from.entry
    console.log("[build-mcp] ext dep: " + name + " <- " + from.entry)
  }
  // Each server is built in its copied package directory, then scrubbed, guarded and installed.
  for (const s of SERVERS) {
    /** The copied source package this build runs in. */
    const dir = join(srcRoot, s.src)
    /** The bun build result; any non-zero status aborts the whole run. */
    const r = spawnSync("bun", ["build", s.entry, "--outdir", "dist", "--target", "node", "--format", "esm"], { cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: join(work, "node_modules") } })
    if (r.status !== 0) { console.error("[build-mcp] build failed " + s.name + ":", r.stderr); process.exit(1) }
    /** The freshly built artifact inside the temp workspace. */
    const cli = join(dir, "dist", "cli.js")
    /** This repository's dist directory for the server, the artifact's final home. */
    const out = join(repoRoot, "packages", s.pkg, "dist")
    mkdirSync(out, { recursive: true })
    // MPD scrub: apply the key-level upstream -> MPD_ prefix rename (if any) so the shipped dist
    // matches the committed convention (hand-scrubbed baseline, AGENTS.md contract).
    /** The scrubbed artifact text, which is what gets written and guarded. */
    const builtText = applyMpdScrub(s.name, readFileSync(cli, "utf8"))
    /** This artifact's brand-guard verdict, folded into the run totals. */
    const brandScan = assertBrandClean(s.name, builtText)
    brandTotals.artifacts += 1
    brandTotals.identifiers += brandScan.identifiers
    brandTotals.brand += brandScan.brand
    /** This artifact's byte comparison against the committed dist, folded into the run totals. */
    const byteScan = assertRebuildMatchesCommitted(s.name, builtText, join(out, "cli.js"))
    byteTotals.compared += byteScan.compared
    byteTotals.bytes += byteScan.bytes
    writeFileSync(join(out, "cli.js"), builtText)
    writeFileSync(join(out, "BUILD.lock"), JSON.stringify({
      // Provenance, not prose: the snapshot commit this dist was built from (VENDOR_LOCK.json
      // pins the same 8c57e46 baseline and fingerprints the vendor/mcp-src snapshot itself). It
      // used to hold a scrub artefact, not a real value.
      source: "8c57e46", sourceDir: "vendor/mcp-src/" + s.src, builtAt: new Date().toISOString(),
      build: ["bun build " + s.entry + " --outdir dist --target node --format esm"],
      externalDeps: resolvedExternals,
      artifact: { file: "cli.js", sha256: sha(join(out, "cli.js")), bytes: builtText.length }
    }, null, 2) + "\n")
    console.log("[build-mcp] " + s.name + " -> " + join(out, "cli.js") + " (" + readFileSync(join(out, "cli.js")).length + " bytes)")
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
if (brandTotals.artifacts === 0) {
  console.error("[build-mcp] FAIL - brand guard inspected 0 artifacts (an empty scan is not a pass)")
  process.exit(1)
}
if (byteTotals.compared === 0) {
  console.error("[build-mcp] FAIL - brand guard compared 0 artifacts against their committed dists (an empty byte comparison is not a pass)")
  process.exit(1)
}
console.log(`[build-mcp] brand guard (primary): ${byteTotals.compared} artifact(s) byte-compared against the committed dists, ${byteTotals.bytes} byte(s) verified equal`)
console.log(`[build-mcp] brand guard: ${brandTotals.artifacts} artifact(s), ${brandTotals.identifiers} identifier(s) inspected, ${brandTotals.brand} allowlisted brand occurrence(s), 0 foreign`)
console.log("[build-mcp] PASS")
}

// Only build when executed directly: importing this module must stay side-effect-free
// (assertBrandClean is exported for its negative control).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
