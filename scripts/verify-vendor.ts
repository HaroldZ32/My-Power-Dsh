#!/usr/bin/env node
// Verify the vendored-asset fingerprints this repository SHIPS: every non-`_` asset entry in
// VENDOR_LOCK.json is checked by required file count plus its sha256 (single-file asset) or its
// treeSha (directory asset). Every mismatch is a BLOCKER, and a run with no asset subject at all is
// refused rather than reported green.
//
// WHAT THIS GATE NO LONGER IS (de-vendored 2026-10-07, wave `de-vendor-and-verify-law`): it checks
// NO upstream identity. The `code-yeongyu/oh-my-openagent` baseline's commit, version and statistics
// used to be blockers here, read out of a pinned checkout resolved from `MPD_UPSTREAM_ROOT` or
// `.mpd-dsh/upstream`. The composition no longer reads that checkout at all, so the baseline is now a
// HISTORICAL REFERENCE kept for attribution, never a checked subject. There is deliberately no
// resolution path, no identity section and no fallback: this gate reads VENDOR_LOCK.json and the
// working tree and nothing else, and it PRINTS that named fact on every run instead of skipping
// silently. A caller asking for the retired behaviour (`--require-upstream` and any other
// upstream-shaped flag) is REFUSED by name, because accepting and ignoring it would report a pass for
// a check that no longer exists.
//
// The remaining subject is the asset half: the bytes THIS repository ships (the served skill corpus,
// the in-repo MCP source snapshot, the committed MCP dists).
//
// The fingerprint algorithm below is MIRRORED by scripts/repin-vendor.ts, which re-reads this file on
// every run and refuses to work when one of its decisive tokens has moved. Edit the two together.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { readJson, repoRootFrom } from "./lib/repo.ts"

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

/** The parsed `VENDOR_LOCK.json`: the asset fingerprint table plus its `_`-prefixed commentary keys. */
interface VendorLock {
  /** Asset relpath → fingerprint, plus the `_`-prefixed string commentary keys. */
  assets: Record<string, VendorAssetMeta | string>
}

/** The repository root, derived from this gate's own URL (`<root>/scripts/verify-vendor.ts`). */
const repoRoot: string = repoRootFrom(import.meta.url)
/** The usage text, which also names the refusal this gate performs. */
const USAGE: string = [
  "usage: node scripts/verify-vendor.ts [--help]",
  "  (no flag)           fingerprint every asset VENDOR_LOCK.json declares; a mismatch is a blocker",
  "  --help              print this text and exit 0",
  "  --require-upstream  REFUSED: this gate has no upstream subject any more (see the header)",
].join("\n")

// The argv contract is part of the acceptance, not a nicety: the retired flag must FAIL LOUDLY and
// explain itself, so nobody can read a green exit code as "the upstream baseline was verified".
for (const arg of process.argv.slice(2)) {
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE)
    process.exit(0)
  }
  if (/upstream/i.test(arg)) {
    console.error("[verify-vendor] REFUSED - " + arg + ": this gate has NO upstream subject any more.")
    console.error("[verify-vendor] the oh-my-openagent checkout is retired from the composition (de-vendored 2026-10-07):")
    console.error("[verify-vendor]   * no MPD_UPSTREAM_ROOT is read, no .mpd-dsh/upstream is looked for, no fallback exists;")
    console.error("[verify-vendor]   * the upstream commit/version/statistics checks were DELETED, not skipped - nothing is left to require;")
    console.error("[verify-vendor]   * upstream attribution lives in LICENSE-NOTICES.md, README.md and README.zh-CN.md, where no gate owns it.")
    console.error("[verify-vendor] re-run without the flag to fingerprint the assets this repository ships, or revert the de-vendoring commit.")
    process.exit(1)
  }
  console.error("[verify-vendor] FAIL - unknown argument: " + arg)
  console.error(USAGE)
  process.exit(1)
}

// The named fact, printed on EVERY run: a green exit code here never means "the upstream was checked".
console.log("[verify-vendor] upstream identity: NOT CHECKED - no upstream subject exists (the pinned oh-my-openagent checkout is retired; see VENDOR_LOCK.json `_note`)")

/** The parsed lock document every comparison below reads. */
const lock: VendorLock = readJson<VendorLock>(join(repoRoot, "VENDOR_LOCK.json"))

/** Whether any blocker has failed so far; the process exit code is derived from it at the end. */
let failed: boolean = false
/** Record a blocking failure and keep going, so one run reports every violation. */
function fail(msg: string): void { console.error("[verify-vendor] FAIL -", msg); failed = true }

// The vendored-asset half: the ONE subject this gate still has. Everything below is the fingerprint
// algorithm scripts/repin-vendor.ts mirrors.

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
console.log("[verify-vendor] PASS - " + assetEntries.length + " shipped asset(s) fingerprinted, upstream identity not checked")
