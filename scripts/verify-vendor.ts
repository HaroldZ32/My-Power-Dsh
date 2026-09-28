#!/usr/bin/env node
// Verify the vendor baseline: upstream commit/version are blockers; stats drift is a warning; asset counts are blockers.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

/** The upstream checkout's recorded statistics, whose drift is only a warning. */
interface VendorUpstreamStats {
  /** Number of tracked files at the recorded snapshot. */
  trackedFiles: number
  /** Σ `split("\n").length` over those files — the same method this gate recomputes. */
  trackedLoc: number
  /** ISO timestamp of the recording (provenance, not verified). */
  recordedAt: string
  /** Human note describing how `trackedLoc` was measured. */
  note: string
}

/** One vendored asset's fingerprint declaration. */
interface VendorAssetMeta {
  /** Required file count inside the asset; a mismatch is a blocker. */
  fileCount: number
  /** Fingerprint of a single-FILE asset; mutually exclusive with `treeSha`. */
  sha256?: string
  /** Fingerprint of a directory asset: sorted relpath + per-file sha256 fold. */
  treeSha?: string
  /** Where the asset came from (provenance note, not verified). */
  source?: string
}

/** The parsed `VENDOR_LOCK.json`: the pinned upstream identity plus the fingerprint table. */
interface VendorLock {
  /** Upstream repository slug (provenance). */
  upstream: string
  /** The pinned commit sha; a mismatch is a blocker. */
  upstreamCommitSha: string
  /** The pinned version string; a mismatch is a blocker. */
  upstreamVersion: string
  /** Recorded upstream statistics; drift is only a warning. */
  upstreamStats: VendorUpstreamStats
  /** Asset relpath → fingerprint, plus the `_`-prefixed string commentary keys. */
  assets: Record<string, VendorAssetMeta | string>
}

/** The upstream `package.json` subset this gate compares against the lock. */
interface UpstreamPackage {
  /** The upstream package version. */
  version: string
}

/** The repository root, derived from this gate's own URL (`<root>/scripts/verify-vendor.ts`). */
const repoRoot: string = repoRootFrom(import.meta.url)
// Legacy layout assumed repoRoot = <the upstream checkout>/.mpd/port/mpd-dsh. Auto-detect the
// pinned checkout at .mpd-dsh/upstream; point MPD_UPSTREAM_ROOT at the checkout explicitly
// when it lives elsewhere (or keep the old relative default).
/** The upstream checkout to verify: the explicit `MPD_UPSTREAM_ROOT`, else the auto-detected one. */
const upstreamRoot: string = process.env.MPD_UPSTREAM_ROOT || (existsSync(join(repoRoot, ".mpd-dsh", "upstream", ".git")) ? join(repoRoot, ".mpd-dsh", "upstream") : join(repoRoot, "..", "..", ".."))
if (!existsSync(join(upstreamRoot, ".git"))) {
  console.error("[verify-vendor] FAIL - upstream checkout not found at " + upstreamRoot)
  console.error("[verify-vendor] set MPD_UPSTREAM_ROOT to the oh-my-openagent checkout pinned to " + readJson<VendorLock>(join(repoRoot, "VENDOR_LOCK.json")).upstreamCommitSha)
  process.exit(1)
}
/** The parsed lock document every comparison below reads. */
const lock: VendorLock = readJson<VendorLock>(join(repoRoot, "VENDOR_LOCK.json"))

/** Run one git command in the pinned upstream checkout and return its trimmed stdout. */
function git(args: string[]): string {
  return execFileSync("git", args, { cwd: upstreamRoot, encoding: "utf8" }).trim()
}

/** Whether any blocker has failed so far; the process exit code is derived from it at the end. */
let failed: boolean = false
/** Record a blocking failure and keep going, so one run reports every violation. */
function fail(msg: string): void { console.error("[verify-vendor] FAIL -", msg); failed = true }
/** Record a non-blocking drift warning. */
function warn(msg: string): void { console.warn("[verify-vendor] WARN -", msg) }

// 1) commit lock
/** The upstream checkout's current HEAD, compared against the lock's pin. */
const head: string = git(["rev-parse", "HEAD"])
if (head !== lock.upstreamCommitSha) {
  fail("upstream commit mismatch: HEAD=" + head + " lock=" + lock.upstreamCommitSha)
} else {
  console.log("[verify-vendor] commit OK:", head)
}

// 2) version lock
/** The upstream package document, read only for its version. */
const upstreamPkg: UpstreamPackage = readJson<UpstreamPackage>(join(upstreamRoot, "package.json"))
if (upstreamPkg.version !== lock.upstreamVersion) {
  fail("upstream version mismatch: " + upstreamPkg.version + " vs " + lock.upstreamVersion)
} else {
  console.log("[verify-vendor] version OK:", upstreamPkg.version)
}

// 3) stats drift (warning)
/** Tracked file count in the upstream checkout (one line per path from `git ls-files`). */
const tracked: number = Number(git(["ls-files"]).split("\n").length)
/** Total lines across those tracked files; an unreadable file contributes 0, as before. */
const loc: number = Number(git(["ls-files", "-z"]).split("\0").filter(Boolean)
  .map((f: string): number => { try { return readFileSync(join(upstreamRoot, f), "utf8").split("\n").length } catch { return 0 } })
  .reduce((a: number, b: number): number => a + b, 0))
if (tracked !== lock.upstreamStats.trackedFiles || loc !== lock.upstreamStats.trackedLoc) {
  warn("stats drift: tracked=" + tracked + " loc=" + loc + " (lock=" + lock.upstreamStats.trackedFiles + "/" + lock.upstreamStats.trackedLoc + ")")
} else {
  console.log("[verify-vendor] stats OK:", tracked, "files /", loc, "loc")
}

// 4) vendored assets: count + sha256, both blockers
import { createHash } from "node:crypto"
import { readdirSync, statSync } from "node:fs"
import { readJson, repoRootFrom } from "./lib/repo.ts"

// Read a vendored file as bytes, normalizing text (no NUL) to LF. The repo's
// .gitattributes declares eol=lf for text files, so tree hashes must be
// computed on normalized bytes — otherwise a CRLF working copy drifts the lock
// even though git sees a clean tree. Binary files hash raw.
/** Read one asset file as bytes: LF-normalized when it is text, raw when it is binary. */
function readBytes(p: string): Buffer {
  /** The file's raw bytes, read once for both the NUL test and the hash. */
  const buf: Buffer = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

/** Enumerate one asset's files: a single file is its own list, a directory is walked recursively. */
function listFiles(dir: string): string[] {
  // node-only file enumeration (no `find` dependency); handles single-file assets
  if (statSync(dir).isFile()) return [dir]
  /** The collected absolute paths, in walk order. */
  const out: string[] = []
  /** Recursive walker over one directory of the asset. */
  const walk = (d: string): void => {
    // Entry name of the current directory's child.
    for (const entry of readdirSync(d)) {
      /** Absolute path of that child. */
      const p: string = join(d, entry)
      if (entry === "node_modules") continue
      // Bytecode caches are BUILD artifacts, not corpus content: `python3 -m py_compile`
      // (a documented verify command for the ast-grep helper) writes
      // `skills/ast-grep/scripts/__pycache__/*.pyc`, which used to drift the count
      // 297 -> 298 and fail this gate on a legitimately unchanged corpus, while the .pyc
      // itself is not gitignored and could be committed as corpus content (measured
      // 2026-09-14: RED "count drifted: 298 vs 297", GREEN after this skip).
      if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

// Guard-2 (t8 / R7.15): the fingerprint loop is the gate's subject. With `assets` empty (or
// every entry underscored) the run used to print PASS while checking zero fingerprints, so the
// exit code proved nothing. Refuse the zero-subject run by name instead.
// The lock's `_note` commentary key is the only non-asset entry and the filter drops every
// `_`-prefixed key before any fingerprint work, so the surviving entries are asset metadata; the
// assertion restates that JSON-boundary fact (the compiler cannot know a file's shape) and the
// filter itself is unchanged.
/** The asset entries this run fingerprints, i.e. every non-`_`-prefixed key of `assets`. */
const assetEntries: Array<[string, VendorAssetMeta]> = Object.entries(lock.assets || {}).filter(([rel]: [string, VendorAssetMeta | string]): boolean => !String(rel).startsWith("_")) as Array<[string, VendorAssetMeta]>
if (assetEntries.length === 0) {
  fail("zero-subject run: VENDOR_LOCK.json declares no vendored assets to fingerprint - refusing to report PASS")
}
for (const [rel, meta] of assetEntries) {
  /** The asset's path inside the repository. */
  const dir: string = join(repoRoot, rel)
  if (!existsSync(dir)) { fail("asset missing: " + rel); continue }
  /** Every file the asset currently contains. */
  const files: string[] = listFiles(dir)
  // An asset that failed any of its gates must never also report OK.
  /** Whether this asset has passed every fingerprint check so far. */
  let assetOk: boolean = true
  if (files.length !== meta.fileCount) {
    fail("asset " + rel + " count drifted: " + files.length + " vs " + meta.fileCount)
    assetOk = false
  }
  if (typeof meta.sha256 === "string") {
    /** The single file's sha256, computed on its RAW bytes (the lock's single-file rule). */
    const actual: string = createHash("sha256").update(readFileSync(dir)).digest("hex")
    if (actual !== meta.sha256) { fail("asset " + rel + " sha256 mismatch"); assetOk = false }
  }
  if (typeof meta.treeSha === "string") {
    // The fold input is the RELPATH, so it must be spelled the same on every platform: a native
    // separator would make one corpus hash two different values (Windows `a\\b` vs POSIX `a/b`)
    // and the lock could only ever satisfy one of them — measured: a clean Windows checkout
    // recomputed 4b4f37… for a corpus the lock pins as 220ddd2c…, i.e. this gate was permanently
    // RED here while the same bytes were GREEN on the POSIX machine that wrote the pin. Same
    // discipline as readBytes()'s LF normalization above: the fingerprint is of the CONTENT.
    /** The asset's relpaths, POSIX-spelled and sorted — the fold's input order. */
    const files2: string[] = files.map((f: string): string => f.slice(dir.length + 1).split(sep).join("/")).sort()
    /** The running fold hash over (relpath, per-file sha256) pairs. */
    const h = createHash("sha256")
    // Relpath of one file inside the asset, in sorted order.
    for (const f of files2) {
      /** That file's own sha256, over LF-normalized bytes. */
      const fh: string = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
      h.update(f + "\n" + fh + "\n")
    }
    /** The asset's folded tree fingerprint. */
    const actual: string = h.digest("hex")
    if (actual !== meta.treeSha) { fail("asset " + rel + " treeSha mismatch"); assetOk = false }
  }
  if (assetOk) console.log("[verify-vendor] asset OK:", rel, files.length, "files")
}

if (failed) process.exit(1)
console.log("[verify-vendor] PASS")
