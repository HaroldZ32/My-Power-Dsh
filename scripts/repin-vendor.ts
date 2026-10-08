#!/usr/bin/env node
// Derived re-pin helper for the corpus fingerprints in VENDOR_LOCK.json (friction item T-33).
//
// WHY: `skills/**` has ONE writer per wave, and every edit to it invalidates the corpus `treeSha`
// that scripts/verify-vendor.ts checks as a BLOCKER, so the lock used to be hand-edited at commit
// time. This helper DERIVES that value from the working tree, prints the delta, and applies it only
// when explicitly asked. It defaults to DRY RUN.
//
// AUTHORITY: scripts/verify-vendor.ts owns the algorithm. It exports nothing (it is a top-level
// gate that reads the lock, shells out to git and exits), so this file MIRRORS it rather than
// importing it, and `assertAuthorityShape()` re-reads the authority's source on every run to prove
// the mirror still has the same decisive tokens - a divergence cannot land silently. The mirrored
// pieces, in the authority's own words:
//   readBytes(p)  - text (no NUL byte) normalized CRLF/CR -> LF; binary hashed raw
//                   (`.gitattributes` declares eol=lf, so a tree hash must be computed on
//                    LF-normalized bytes; a CRLF working copy would otherwise drift the lock)
//   listFiles(d)  - recursive walk skipping node_modules, __pycache__, *.pyc, *.pyo
//   tree fold     - sorted relpaths, sha256(relpath + "\n" + sha256(fileBytes) + "\n") folded
//
// USAGE: node scripts/repin-vendor.ts [--lock <path>] [--check] [--write] [--json] [--self-test]
//   (default)  dry run: print the delta it WOULD write, mutate nothing, exit 0
//   --check    exit 1 when a computed value differs from the lock, exit 0 when every one matches
//   --write    apply the re-pin to --lock; refuses the repository's own VENDOR_LOCK.json unless
//              --i-know-this-is-the-captains-step is ALSO passed (the wave's single re-pin is the
//              captain's commit-time step, so a stray --write must never touch the real lock)
//   --json     emit one JSON document on stdout instead of the human report
//   --self-test  run every arm in temp fixtures; exits non-zero if any arm fails
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"

/** This helper's own absolute path: the anchor every path below is derived from. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, i.e. the parent of the `scripts/` directory holding this helper. */
const REPO_ROOT: string = dirname(dirname(SELF))
/** The authority whose fingerprint algorithm this helper mirrors, re-read on every run. */
const AUTHORITY_PATH: string = join(REPO_ROOT, "scripts", "verify-vendor.ts")
/** The lock this helper re-pins when `--lock` is not given: the repository's own. */
const DEFAULT_LOCK: string = join(REPO_ROOT, "VENDOR_LOCK.json")
/** The flag that unlocks writing the repository's own lock, reserved for the captain's re-pin step. */
const OVERRIDE_FLAG: string = "--i-know-this-is-the-captains-step"
/** Prefix carried by every line of this helper's human report. */
const TAG: string = "[repin-vendor]"
/** The `--help` text: the flag table plus the POLICY caveat this helper never fails on. */
const USAGE: string = [
  "usage: node scripts/repin-vendor.ts [--lock <path>] [--check] [--write] [--json] [--self-test]",
  "  (no mode)  dry run - print the delta, mutate nothing",
  "  --check    exit 1 when a computed fingerprint differs from the lock",
  `  --write    apply the re-pin (the repository's own VENDOR_LOCK.json also needs ${OVERRIDE_FLAG})`,
  "  --lock <p> lock file to read (and to write with --write); defaults to <repo>/VENDOR_LOCK.json",
  "  --json     emit one JSON document instead of the human report",
  "  --self-test  every arm in temp fixtures; exits non-zero if any arm fails",
  "  assets this helper cannot derive are reported under a POLICY label (not a failure) - see plan T-71",
].join("\n")

/** A refusal is a loud, non-mutating abort: the helper never guesses where a value belongs. */
class Refusal extends Error {}

/** The field names a re-pin is allowed to splice, in report order. */
type RepinField = "fileCount" | "treeSha"

/** The two fingerprint values the lock declares and the working tree yields. */
interface RepinValues {
  /** Number of files inside the asset. */
  fileCount: number
  /** sha256 fold over the asset's sorted relpaths and LF-normalized per-file hashes. */
  treeSha: string
}

/** The four values one tree fold derives from an asset directory. */
interface TreeFingerprint {
  /** Number of files the walk collected after the skip rules. */
  fileCount: number
  /** The LF-normalized fold: the value the vendor gate compares against the lock. */
  treeSha: string
  /** The same fold over RAW bytes; printed for contrast and NEVER written to the lock. */
  rawTreeSha: string
  /** How many files the LF normalization changed (0 means the tree is pure LF or binary). */
  normalizedFiles: number
}

/** One treeSha-bearing asset the working tree can be re-pinned from. */
interface Repin {
  /** Asset relpath, i.e. its key in the lock's `assets` table. */
  asset: string
  /** Absolute path of the asset under the working tree. */
  path: string
  /** The fingerprint the lock currently declares. */
  locked: RepinValues
  /** The fingerprint derived from the working tree. */
  computed: TreeFingerprint
  /** Whether the two fingerprints differ, i.e. whether this asset needs a re-pin. */
  drifted: boolean
}

/** One asset reported without a re-pin: either deliberate POLICY or a blocking problem. */
interface AssetNote {
  /** Asset relpath, or the `_`-prefixed metadata key. */
  asset: string
  /** Why the asset was skipped, or what is wrong with its declaration. */
  reason: string
}

/** The scan's result: assets to re-pin, assets deliberately left alone, and blocking problems. */
interface AssetPlan {
  /** Every treeSha-bearing asset derivable from the working tree. */
  repins: Repin[]
  /** Assets this helper deliberately does not re-pin (POLICY, not a failure). */
  skipped: AssetNote[]
  /** Assets whose declaration cannot be honoured; any one of them fails the run. */
  problems: AssetNote[]
}

/** One field actually replaced by `spliceLock`, as the human report prints it. */
interface FieldChange {
  /** Asset relpath whose block the field belongs to. */
  asset: string
  /** The JSON field name that changed. */
  field: RepinField
  /** The value the lock carried before the splice. */
  from: string | number
  /** The value written in its place. */
  to: string | number
}

/** The spliced lock text plus every field change it carries. */
interface SpliceResult {
  /** The lock text with the changed values replaced in place. */
  next: string
  /** The field changes applied, in splice order. */
  changed: FieldChange[]
}

/** The line/byte change report; the byte fields are absent when the line counts differ. */
interface ChangeReport {
  /** Number of changed lines, or -1 when the two texts do not have the same line count. */
  linesChanged: number
  /** Alternating `-`/`+` entries, one pair per changed line. */
  diff: string[]
  /** Byte length of the text before the splice, when the line counts match. */
  bytesBefore?: number
  /** Byte length of the text after the splice, when the line counts match. */
  bytesAfter?: number
  /** Positional byte differences plus the length delta, when the line counts match. */
  differingBytes?: number
}

/** What a `--write` run applied, or `null` when nothing needed re-pinning. */
interface WriteResult {
  /** The field-level changes written to the lock. */
  changed: FieldChange[]
  /** The applied edit's line/byte diff. */
  report: ChangeReport
}

/** The parsed command line: every mode is a boolean flag and `lock` is the resolved target path. */
interface CliOptions {
  /** Lock file to read, and to rewrite under `--write`. */
  lock: string
  /** `--check`: exit 1 on any divergence from the working tree. */
  check: boolean
  /** `--write`: apply the re-pin to `lock`. */
  write: boolean
  /** `--json`: one JSON document on stdout instead of the human report. */
  json: boolean
  /** `--self-test`: run every arm in temp fixtures and exit with its verdict. */
  selfTest: boolean
  /** `--i-know-this-is-the-captains-step`: allow writing the repository's own lock. */
  override: boolean
  /** `--help` / `-h`: print the usage text and exit 0. */
  help: boolean
}

/** One asset's report record: what the lock says, what the tree computes, and the verdict. */
interface AssetRecord {
  /** Asset relpath. */
  asset: string
  /** The fingerprint the lock declares. */
  locked: RepinValues
  /** The fingerprint derived from the working tree. */
  computed: RepinValues
  /** The LF-normalized value the lock must carry, printed next to the raw variant. */
  lfNormalized: string
  /** The raw-bytes variant, printed only to warn that it must never be written. */
  rawBytesVariant: string
  /** How many files the LF normalization changed inside this asset. */
  normalizedFiles: number
  /** Whether the lock and the working tree disagree about this asset. */
  drifted: boolean
  /** What this run did or would do: `unchanged`, `repinned` or `would-repin`. */
  action: string
}

/** The `VENDOR_LOCK.json` document as this helper reads it. */
interface RepinLock {
  /** Asset relpath → entry; every entry field is re-checked with `typeof` before use below. */
  assets?: unknown
}

/** A mutable view of the lock used only to build the INTENDED document for the splice self-check. */
interface MutableLock {
  /** Asset relpath → the fields a re-pin replaces. */
  assets: Record<string, { fileCount?: number; treeSha?: string }>
}

/** A fixture lock's shape, read back after a `--write` arm to prove what landed on disk. */
interface FixtureLock {
  /** Asset relpath → entry; the arms read `corpus` back and only assert the fields they wrote. */
  assets: Record<string, { fileCount?: number; treeSha?: string; sha256?: string; source?: string }>
}

/** One self-test arm's verdict, printed in the summary at the end of the run. */
interface ArmResult {
  /** The arm's name, printed verbatim. */
  arm: string
  /** Whether the arm's assertions held. */
  status: "PASS" | "FAIL"
  /** The arm's one-line proof, or the failure message that made it red. */
  reason: string
}

/** One spawned CLI run's exit status and captured streams. */
interface RunResult {
  /** The child's exit status, or `null` when a signal killed it. */
  code: number | null
  /** Captured stdout, empty when the child wrote none. */
  out: string
  /** Captured stderr, empty when the child wrote none. */
  err: string
}

// ---------------------------------------------------------------------------------------------
// The mirrored algorithm (authority: scripts/verify-vendor.ts)
// ---------------------------------------------------------------------------------------------

/** Marker line the mirror re-checks; see assertAuthorityShape(). */
const AUTHORITY_TOKENS: readonly string[] = [
  '.replace(/\\r\\n?/g, "\\n")',
  'if (!buf.includes(0)) return Buffer.from(buf.toString("utf8")',
  'if (entry === "node_modules") continue',
  'if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue',
  'h.update(f + "\\n" + fh + "\\n")',
  '.update(readBytes(join(dir, f))).digest("hex")',
  '.split(sep).join("/")',
]

/** Fail loudly when scripts/verify-vendor.ts no longer carries the algorithm this file mirrors. */
function assertAuthorityShape(): string {
  if (!existsSync(AUTHORITY_PATH)) throw new Refusal(`authority missing: ${AUTHORITY_PATH}`)
  /** The authority's full source, re-read on every run so a divergence cannot land silently. */
  const src: string = readFileSync(AUTHORITY_PATH, "utf8")
  /** The decisive tokens the mirror needs but the authority no longer carries. */
  const missing: string[] = AUTHORITY_TOKENS.filter((t: string): boolean => !src.includes(t))
  if (missing.length > 0) {
    throw new Refusal(
      `scripts/verify-vendor.ts changed shape - re-mirror the algorithm here before using this helper; missing token(s): ${missing.join(" | ")}`,
    )
  }
  return `mirror matches all ${AUTHORITY_TOKENS.length} decisive token(s) of scripts/verify-vendor.ts`
}

/** Mirror of the authority's readBytes: text -> LF, binary (NUL present) -> raw bytes. */
function readBytes(p: string): Buffer {
  /** The file's raw bytes, read once for both the NUL test and the hash. */
  const buf: Buffer = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

/** Mirror of the authority's listFiles (node_modules / __pycache__ / *.pyc / *.pyo are not corpus). */
function listFiles(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir]
  /** The collected absolute paths, in walk order. */
  const out: string[] = []
  /** Recursive walker over one directory of the asset. */
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      /** Absolute path of the current entry. */
      const p: string = join(d, entry)
      if (entry === "node_modules") continue
      if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

/** Mirror of the authority's tree fold, for the LF-normalized value AND the raw-bytes variant. */
function fingerprint(dir: string): TreeFingerprint {
  /** Every file the walk collected, before the relpaths are sorted. */
  const files: string[] = listFiles(dir)
  /** The sorted POSIX-spelled relpaths: the fold's input order, platform-independent. */
  const rels: string[] = files.map((f: string): string => f.slice(dir.length + 1).split(sep).join("/")).sort()
  /** Running hash over the LF-normalized per-file hashes: the value the lock pins. */
  const lf = createHash("sha256")
  /** Running hash over the RAW per-file hashes: printed for contrast, never written. */
  const raw = createHash("sha256")
  /** Files whose bytes changed under LF normalization; a CRLF working copy would drift the lock. */
  let normalizedFiles: number = 0
  for (const rel of rels) {
    /** Absolute path of the file behind `rel`. */
    const p: string = join(dir, rel)
    /** That file's LF-normalized bytes. */
    const lfBytes: Buffer = readBytes(p)
    /** That file's untouched bytes. */
    const rawBytes: Buffer = readFileSync(p)
    if (!lfBytes.equals(rawBytes)) normalizedFiles += 1
    lf.update(rel + "\n" + createHash("sha256").update(lfBytes).digest("hex") + "\n")
    raw.update(rel + "\n" + createHash("sha256").update(rawBytes).digest("hex") + "\n")
  }
  return { fileCount: files.length, treeSha: lf.digest("hex"), rawTreeSha: raw.digest("hex"), normalizedFiles }
}

// ---------------------------------------------------------------------------------------------
// Planning and writing
// ---------------------------------------------------------------------------------------------

/**
 * Decide per asset: re-pin it (treeSha-bearing, derived from the working tree) or report it as a
 * POLICY exclusion. T-71: the skipped assets used to print "NOT REPINNED …", which reads like a
 * failure in a wave log even though it is deliberate policy; the label now says POLICY and the
 * reason says what to do instead. Single-file `sha256` and count-only assets are never rewritten.
 */
function planAssets(lock: RepinLock): AssetPlan {
  // The JSON boundary: `assets` was already tested as a non-null object, so the cast asserts only
  // that boundary - every entry field below is still re-checked with `typeof` before it is used.
  /** The `assets` table to scan; a missing or non-object table behaves like an empty one. */
  const assets: Record<string, unknown> = lock.assets && typeof lock.assets === "object" ? (lock.assets as Record<string, unknown>) : {}
  /** Assets that can and should be re-pinned from the working tree. */
  const repins: Repin[] = []
  /** Assets deliberately left alone, each carrying the POLICY reason. */
  const skipped: AssetNote[] = []
  /** Assets whose declaration makes a re-pin impossible; any one of them fails the run. */
  const problems: AssetNote[] = []
  for (const [asset, meta] of Object.entries(assets)) {
    if (asset.startsWith("_")) {
      skipped.push({ asset, reason: "POLICY (not a failure) - underscore-prefixed metadata key: the vendor gate skips these too, so this helper does not re-pin it" })
      continue
    }
    if (meta === null || typeof meta !== "object") {
      problems.push({ asset, reason: "asset entry is not an object" })
      continue
    }
    // The entry passed the object test above; its fields are read one by one and each is checked
    // with `typeof` before use, so this cast is the JSON boundary rather than a shape assertion.
    /** The entry as a field table, once the object test above has passed. */
    const entry = meta as Record<string, unknown>
    if (typeof entry.treeSha !== "string") {
      /** Which flavour of non-derivable asset this is, phrased for the POLICY line. */
      const kind: string = typeof entry.sha256 === "string"
        ? "single-file sha256 asset - a build artifact, so re-pin it by rebuilding the package that emits it, never by rewriting the lock"
        : "count-only asset - carries no fingerprint this helper can derive"
      skipped.push({ asset, reason: `POLICY (not a failure) - ${kind}` })
      continue
    }
    /** The asset's path under this repository's working tree. */
    const path: string = join(REPO_ROOT, asset)
    if (!existsSync(path)) {
      problems.push({ asset, reason: "asset path missing under the working tree" })
      continue
    }
    if (!statSync(path).isDirectory()) {
      problems.push({ asset, reason: "treeSha declared on a plain file - refusing to fold a tree hash over it" })
      continue
    }
    if (typeof entry.fileCount !== "number") {
      problems.push({ asset, reason: "treeSha asset has no numeric fileCount - add it by hand once, then re-run" })
      continue
    }
    /** The fingerprint this asset's directory produces right now. */
    const computed: TreeFingerprint = fingerprint(path)
    repins.push({
      asset,
      path,
      locked: { fileCount: entry.fileCount, treeSha: entry.treeSha },
      computed,
      drifted: computed.treeSha !== entry.treeSha || computed.fileCount !== entry.fileCount,
    })
  }
  return { repins, skipped, problems }
}

/** Index of the `}` closing the object that starts at `start`, string-aware. */
function matchBrace(text: string, start: number): number {
  /** Nesting depth of the `{`…`}` pairs seen so far, ignoring braces inside strings. */
  let depth: number = 0
  /** Whether the scanner is currently inside a double-quoted string. */
  let inString: boolean = false
  /** Whether the previous character inside a string was a backslash escape. */
  let escaped: boolean = false
  for (let i = start; i < text.length; i += 1) {
    /** The character under the scanner. */
    const c: string = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{") depth += 1
    else if (c === "}") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  throw new Refusal("unbalanced braces while locating an asset block")
}

/** Splice only the changed field values inside their own asset block; never re-serialize the lock. */
function spliceLock(text: string, repins: Repin[]): SpliceResult {
  /** The text with every changed field value spliced in, built left to right. */
  let next: string = text
  /** Every field actually replaced, in the order it was spliced. */
  const changed: FieldChange[] = []
  for (const repin of repins) {
    /** The `[field, lockedValue, computedValue]` triples to consider, in report order. */
    const candidates: Array<[RepinField, string | number, string | number]> = [
      ["fileCount", repin.locked.fileCount, repin.computed.fileCount],
      ["treeSha", repin.locked.treeSha, repin.computed.treeSha],
    ]
    /** The subset of `candidates` whose value differs; an unchanged field is never spliced. */
    const wanted: Array<[RepinField, string | number, string | number]> = candidates.filter(
      ([, before, after]: [RepinField, string | number, string | number]): boolean => before !== after,
    )
    if (wanted.length === 0) continue
    for (const [field, before, after] of wanted) {
      /** The asset's own key in the lock text, quoted exactly as the lock spells it. */
      const key: string = JSON.stringify(repin.asset) + ":"
      /** Where that key starts: the anchor every search below is scoped to. */
      const keyAt: number = next.indexOf(key)
      if (keyAt < 0 || next.indexOf(key, keyAt + 1) >= 0) throw new Refusal(`asset key ${JSON.stringify(repin.asset)} is not uniquely locatable in the lock`)
      /** Start of the asset's `{`…`}` block, at or after the key. */
      const blockStart: number = next.indexOf("{", keyAt)
      /** Index of the `}` closing that block. */
      const blockEnd: number = matchBrace(next, blockStart)
      /** The exact `"field": value` text to replace. */
      const needle: string = JSON.stringify(field) + ": " + JSON.stringify(before)
      /** Where that text occurs, or -1 when it is absent. */
      const at: number = next.indexOf(needle, blockStart)
      /** Where the same text occurs again, or -1; a second hit inside the block makes the splice ambiguous. */
      const duplicate: number = at < 0 ? -1 : next.indexOf(needle, at + 1)
      if (at < 0 || at > blockEnd || (duplicate >= 0 && duplicate < blockEnd)) {
        throw new Refusal(`cannot locate a unique ${field} = ${JSON.stringify(before)} inside asset ${repin.asset}`)
      }
      next = next.slice(0, at) + JSON.stringify(field) + ": " + JSON.stringify(after) + next.slice(at + needle.length)
      changed.push({ asset: repin.asset, field, from: before, to: after })
    }
  }
  return { next, changed }
}

/** Semantic self-check of a spliced lock: reparsed result must equal the lock with values replaced. */
function assertSpliceIsExact(text: string, next: string, repins: Repin[]): void {
  // The JSON boundary: the parsed lock is mutated field by field below, which is the only reason
  // the compiler cannot know its shape, so the cast is the comparison's own view of the document.
  /** The lock as it SHOULD read: the original document plus every drifted computed value. */
  const intended = JSON.parse(text) as MutableLock
  for (const repin of repins) {
    if (!repin.drifted) continue
    intended.assets[repin.asset].treeSha = repin.computed.treeSha
    intended.assets[repin.asset].fileCount = repin.computed.fileCount
  }
  /** The spliced text reparsed: the document the write would actually leave on disk. */
  const got: unknown = JSON.parse(next)
  if (JSON.stringify(got) !== JSON.stringify(intended)) throw new Refusal("spliced lock does not reparse to the intended document - refusing to write")
}

/** Line-aligned change report; `spliceLock` only replaces text inside a line, so line counts match. */
function reportChanges(before: string, after: string): ChangeReport {
  /** The before text split into lines, one entry per line. */
  const a: string[] = before.split("\n")
  /** The after text split into lines, one entry per line. */
  const b: string[] = after.split("\n")
  if (a.length !== b.length) return { linesChanged: -1, diff: [`line count changed: ${a.length} -> ${b.length}`] }
  /** One `-` line and one `+` line per position where the two texts differ. */
  const diff: string[] = []
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff.push(`- (line ${i + 1}) ${a[i]}`, `+ (line ${i + 1}) ${b[i]}`)
  /** The before text as bytes, for the byte-level difference count. */
  const ab: Buffer = Buffer.from(before)
  /** The after text as bytes, for the byte-level difference count. */
  const bb: Buffer = Buffer.from(after)
  /** Positional byte differences, starting from the length delta. */
  let differingBytes: number = Math.abs(ab.length - bb.length)
  for (let i = 0; i < Math.min(ab.length, bb.length); i += 1) if (ab[i] !== bb[i]) differingBytes += 1
  return { linesChanged: diff.length / 2, diff, bytesBefore: ab.length, bytesAfter: bb.length, differingBytes }
}

/** Replace the lock atomically: write a sibling temp file, then rename it over the target. */
function writeLock(lockPath: string, next: string): void {
  /** Sibling temp path unique to this process, so a concurrent run cannot collide with it. */
  const tmp: string = `${lockPath}.tmp-${process.pid}`
  writeFileSync(tmp, next)
  renameSync(tmp, lockPath)
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/** Parse the flag list into the option set every mode below reads. */
function parseArgs(argv: string[]): CliOptions {
  /** The default option set: a dry run against the repository's own lock. */
  const opts: CliOptions = { lock: DEFAULT_LOCK, check: false, write: false, json: false, selfTest: false, override: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    /** The flag under inspection. */
    const a: string = argv[i]
    if (a === "--lock") {
      /** The flag's value: undefined when `--lock` is the last argument. */
      const value: string | undefined = argv[i + 1]
      if (value === undefined || value.startsWith("--")) throw new Refusal(`--lock needs a path\n${USAGE}`)
      opts.lock = value
      i += 1
    } else if (a === "--check") opts.check = true
    else if (a === "--write") opts.write = true
    else if (a === "--json") opts.json = true
    else if (a === "--self-test") opts.selfTest = true
    else if (a === OVERRIDE_FLAG) opts.override = true
    else if (a === "--help" || a === "-h") opts.help = true
    else throw new Refusal(`unknown flag: ${a}\n${USAGE}`)
  }
  if (opts.check && opts.write) throw new Refusal(`--check and --write are mutually exclusive\n${USAGE}`)
  if ((opts.check || opts.write) && opts.selfTest) throw new Refusal(`--self-test runs on its own\n${USAGE}`)
  return opts
}

/** The four-line banner naming the mirrored algorithm, the normalization and the raw-bytes warning. */
function algorithmBanner(assetCount: number): string[] {
  return [
    `${TAG} algorithm : MIRROR of scripts/verify-vendor.ts (readBytes + listFiles + sorted-relpath tree fold); the authority exports nothing, assertAuthorityShape() guards the mirror`,
    `${TAG} normalize : LF - text files (no NUL byte) have CRLF/CR collapsed to LF; binary files (NUL present) are hashed RAW`,
    `${TAG} WARNING   : the vendor gate compares the LF-NORMALIZED value only. A raw-bytes reading would silently fail \`bun run verify:vendor\` on any corpus containing CRLF/CR bytes - both values are printed per asset below.`,
    `${TAG} assets    : ${assetCount} treeSha-bearing asset(s) derived from the working tree`,
  ]
}

/** Run the selected mode and return this process's exit code. */
function runCli(opts: CliOptions): number {
  /** The mirror-guard proof line, computed before anything else so a divergence aborts first. */
  const authorityProof: string = assertAuthorityShape()
  /** The lock this run reads, and rewrites only under `--write`. */
  const lockPath: string = opts.lock
  if (opts.write && lockPath === DEFAULT_LOCK && !opts.override) {
    throw new Refusal(
      `refusing to ${"--write"} the repository's own VENDOR_LOCK.json: this wave's single re-pin is the captain's commit-time step. Re-run with ${OVERRIDE_FLAG} if you really are that step, or pass --lock <scratch-copy> to exercise this helper.`,
    )
  }
  if (!existsSync(lockPath)) throw new Refusal(`lock file not found: ${lockPath}`)
  /** The lock's full text, byte length reported and spliced in place under `--write`. */
  const text: string = readFileSync(lockPath, "utf8")
  /** The parsed lock; `spliceLock` refuses to write anything that does not reparse as intended. */
  const lock: RepinLock = JSON.parse(text) as RepinLock
  /** The per-asset decision: what to re-pin, what to skip, what blocks. */
  const plan: AssetPlan = planAssets(lock)
  /** How many assets the run derived a fingerprint for; zero makes a check meaningless. */
  const rePinnable: number = plan.repins.length
  /** The derivable assets whose fingerprint no longer matches the lock. */
  const drifted: Repin[] = plan.repins.filter((r: Repin): boolean => r.drifted)
  /** One record per derivable asset, shared by the human report and the `--json` document. */
  const records: AssetRecord[] = plan.repins.map((r: Repin): AssetRecord => ({
    asset: r.asset,
    locked: { fileCount: r.locked.fileCount, treeSha: r.locked.treeSha },
    computed: { fileCount: r.computed.fileCount, treeSha: r.computed.treeSha },
    lfNormalized: r.computed.treeSha,
    rawBytesVariant: r.computed.rawTreeSha,
    normalizedFiles: r.computed.normalizedFiles,
    drifted: r.drifted,
    action: r.drifted ? (opts.write ? "repinned" : "would-repin") : "unchanged",
  }))

  /** What the write applied, or `null` while the run is not a write or nothing needed re-pinning. */
  let writeResult: WriteResult | null = null
  if (opts.write && drifted.length > 0) {
    /** The spliced lock text plus the field changes it carries. */
    const { next, changed } = spliceLock(text, plan.repins)
    assertSpliceIsExact(text, next, plan.repins)
    /** The applied edit's line/byte diff, reported after the rename below. */
    const report: ChangeReport = reportChanges(text, next)
    writeLock(lockPath, next)
    writeResult = { changed, report }
  }

  /** True when no treeSha-bearing asset exists: a check over zero subjects proves nothing. */
  const zeroSubject: boolean = rePinnable === 0
  /** The `--check` verdict: any problem, drift or zero-subject run is RED. */
  const checkRed: boolean = zeroSubject || plan.problems.length > 0 || drifted.length > 0
  /** The process exit code: `--check` fails on any red condition, every other mode only on problems. */
  const exitCode: number = opts.check ? (checkRed ? 1 : 0) : plan.problems.length > 0 ? 1 : 0

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      mode: opts.check ? "check" : opts.write ? "write" : "dry-run",
      lock: lockPath,
      algorithm: "MIRROR of scripts/verify-vendor.ts (LF-normalized tree fold)",
      normalization: "text (no NUL) CRLF/CR -> LF; binary raw",
      warning: "the vendor gate compares the LF-normalized value only; a raw-bytes reading would silently fail `bun run verify:vendor`",
      authority: authorityProof,
      assets: records,
      notRepinned: plan.skipped,
      problems: plan.problems,
      driftCount: drifted.length,
      exitCode,
    }, null, 2)}\n`)
    return exitCode
  }

  /** Print one line of the human report on stdout; the write's boolean is unused by every caller. */
  const out = (line: string): boolean => process.stdout.write(`${line}\n`)
  /** Print one line of the human report on stderr; the write's boolean is unused by every caller. */
  const err = (line: string): boolean => process.stderr.write(`${line}\n`)
  for (const line of algorithmBanner(rePinnable)) out(line)
  out(`${TAG} lock      : ${lockPath}  (${Buffer.byteLength(text)} bytes, ${rePinnable} treeSha asset(s))`)
  out(`${TAG} authority : ${authorityProof}`)
  out("")

  for (const r of records) {
    out(`${TAG} asset          : ${r.asset}`)
    out(`${TAG}   locked       : treeSha=${r.locked.treeSha} fileCount=${r.locked.fileCount}`)
    out(`${TAG}   computed (LF) : treeSha=${r.computed.treeSha} fileCount=${r.computed.fileCount} (${r.normalizedFiles} file(s) LF-normalized)`)
    out(`${TAG}   raw-bytes    : ${r.rawBytesVariant}   <- NEVER write this one`)
    if (r.drifted) {
      out(`${TAG}   DELTA        : treeSha ${r.locked.treeSha} -> ${r.computed.treeSha}`)
      if (r.locked.fileCount !== r.computed.fileCount) out(`${TAG}   DELTA        : fileCount ${r.locked.fileCount} -> ${r.computed.fileCount}`)
    } else {
      out(`${TAG}   in sync      : no change`)
    }
    out("")
  }
  for (const s of plan.skipped) out(`${TAG} ${s.asset}: ${s.reason}`)
  for (const p of plan.problems) err(`${TAG} PROBLEM ${p.asset}: ${p.reason}`)
  if (zeroSubject) err(`${TAG} zero-subject run: no treeSha-bearing asset found - refusing to report a clean check`)

  if (opts.write) {
    if (writeResult === null) {
      out(`${TAG} WRITE     : nothing to re-pin - ${lockPath} left byte-identical`)
    } else {
      out(`${TAG} WRITE     : applied ${writeResult.changed.length} field change(s) to ${lockPath}`)
      for (const c of writeResult.changed) out(`${TAG}   ${c.asset}.${c.field}: ${c.from} -> ${c.to}`)
      for (const line of writeResult.report.diff) out(`${TAG}   ${line}`)
      out(`${TAG} WRITE     : linesChanged=${writeResult.report.linesChanged} bytes ${writeResult.report.bytesBefore} -> ${writeResult.report.bytesAfter} (differingBytes=${writeResult.report.differingBytes})`)
    }
  } else if (opts.check) {
    out(`${TAG} CHECK     : ${checkRed ? "RED - lock does not match the working tree" : "GREEN - lock matches the working tree"} (drift=${drifted.length}, problems=${plan.problems.length})`)
  } else {
    out(`${TAG} DRY RUN   : ${drifted.length} asset(s) would be re-pinned; nothing was written`)
  }
  return exitCode
}

// ---------------------------------------------------------------------------------------------
// Self-test (every fixture lives in its own temp dir)
// ---------------------------------------------------------------------------------------------

/** Run every self-test arm in temp fixtures and return 0 when all of them passed. */
function selfTest(): number {
  /** One verdict per arm, printed in declaration order at the end of the run. */
  const arms: ArmResult[] = []
  /** Run one arm, recording PASS with its proof or FAIL with the thrown message. */
  const arm = (name: string, fn: () => string): void => {
    try {
      arms.push({ arm: name, status: "PASS", reason: fn() })
    } catch (e) {
      arms.push({ arm: name, status: "FAIL", reason: e instanceof Error ? e.message : String(e) })
    }
  }
  /** Assert one arm's condition, throwing the message recorded as the FAIL reason. */
  const expect = (cond: boolean, msg: string): void => { if (!cond) throw new Error(msg) }
  /** Spawn one CLI run and capture its status and streams. */
  const run = (script: string, args: string[]): RunResult => {
    /** The finished child; `encoding: "utf8"` types both captured streams as strings. */
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }
  }
  /** sha256 of one file's raw bytes, for the byte-identity guards below. */
  const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex")
  /** Every temp root this run created; the `finally` block below removes them all. */
  const roots: string[] = []
  /** Create one temp fixture root and remember it for the cleanup pass. */
  const mkroot = (name: string): string => {
    /** The freshly created temp directory holding one fixture tree. */
    const d = mkdtempSync(join(tmpdir(), `repin-vendor-${name}-`))
    roots.push(d)
    return d
  }

  try {
    arm("authority-shape: mirror still matches scripts/verify-vendor.ts", (): string => assertAuthorityShape())

    arm("hand-computed expectation: one-file tree fold (independent of fingerprint())", (): string => {
      /** The fixture root holding the one-file corpus. */
      const root = mkroot("hand")
      mkdirSync(join(root, "corpus"))
      writeFileSync(join(root, "corpus", "a.txt"), "x\ny\n")
      /** The same fold computed by hand, independent of `fingerprint()`. */
      const expected = createHash("sha256")
        .update(`a.txt\n${createHash("sha256").update("x\ny\n").digest("hex")}\n`)
        .digest("hex")
      /** The fold `fingerprint()` produces for the same directory. */
      const got = fingerprint(join(root, "corpus"))
      expect(got.treeSha === expected, `tree fold mismatch: got ${got.treeSha} expected ${expected}`)
      expect(got.fileCount === 1, `fileCount ${got.fileCount} != 1`)
      return `sha256("a.txt\\n" + sha256("x\\ny\\n") + "\\n") = ${expected}`
    })

    arm("LF normalization: a CRLF file hashes exactly like its LF twin; a NUL file stays raw", (): string => {
      /** The fixture root holding both twins and the binary tree. */
      const root = mkroot("crlf")
      mkdirSync(join(root, "lf"))
      mkdirSync(join(root, "crlf"))
      writeFileSync(join(root, "lf", "f.txt"), "a\nb\n")
      writeFileSync(join(root, "crlf", "f.txt"), "a\r\nb\r\n")
      /** The LF twin's fingerprint: the value a CRLF working copy must still produce. */
      const lf = fingerprint(join(root, "lf"))
      /** The CRLF twin's fingerprint, whose normalized value must equal the LF one. */
      const crlf = fingerprint(join(root, "crlf"))
      expect(lf.treeSha === crlf.treeSha, `CRLF twin diverged: ${crlf.treeSha} != ${lf.treeSha}`)
      expect(crlf.rawTreeSha !== crlf.treeSha, "raw variant must differ from the normalized one for a CRLF file")
      expect(crlf.normalizedFiles === 1, `normalizedFiles ${crlf.normalizedFiles} != 1`)
      mkdirSync(join(root, "bin"))
      writeFileSync(join(root, "bin", "d.bin"), Buffer.from([0, 1, 2, 255]))
      /** The NUL-bearing tree's fingerprint, whose two variants must agree. */
      const bin = fingerprint(join(root, "bin"))
      expect(bin.treeSha === bin.rawTreeSha, "a NUL-bearing file must hash identically in both variants")
      return `CRLF twin == LF twin (${lf.treeSha.slice(0, 12)}...), NUL file raw in both`
    })

    /** The scratch repository root every CLI arm below runs against. */
    const fixture = mkroot("cli")
    mkdirSync(join(fixture, "scripts"))
    copyFileSync(SELF, join(fixture, "scripts", "repin-vendor.ts"))
    copyFileSync(AUTHORITY_PATH, join(fixture, "scripts", "verify-vendor.ts"))
    // The scripts' shared primitives live in scripts/lib/ — the scratch tree must carry them,
    // or every CLI arm dies with ERR_MODULE_NOT_FOUND for a reason the arm is not about. The
    // staged copy keeps the `.ts` name at the SAME depth for the same reason: node resolves its
    // own `./lib/repo.ts` relative to the staged file, and strips types there exactly as here.
    mkdirSync(join(fixture, "scripts", "lib"))
    copyFileSync(join(dirname(SELF), "lib", "repo.ts"), join(fixture, "scripts", "lib", "repo.ts"))
    /** The staged copy of this helper, executed by every CLI arm below. */
    const fixtureScript = join(fixture, "scripts", "repin-vendor.ts")
    /** The staged authority the tamper arm rewrites and then restores. */
    const fixtureAuthority = join(fixture, "scripts", "verify-vendor.ts")
    mkdirSync(join(fixture, "corpus", "sub"), { recursive: true })
    mkdirSync(join(fixture, "corpus", "__pycache__"), { recursive: true })
    mkdirSync(join(fixture, "corpus", "node_modules"), { recursive: true })
    writeFileSync(join(fixture, "corpus", "alpha.txt"), "alpha\nline\n")
    writeFileSync(join(fixture, "corpus", "sub", "gamma.txt"), "gamma\n")
    writeFileSync(join(fixture, "corpus", "crlf.txt"), "crlf\r\nwindows\r\nbytes\r\n")
    writeFileSync(join(fixture, "corpus", "bin.dat"), Buffer.from([0, 7, 0, 255, 13, 10]))
    writeFileSync(join(fixture, "corpus", "__pycache__", "ignored.pyc"), "ignored")
    writeFileSync(join(fixture, "corpus", "node_modules", "ignored.js"), "ignored")
    /** The fixture corpus's own fingerprint: what every arm below compares against. */
    const expected = fingerprint(join(fixture, "corpus"))
    expect(expected.fileCount === 4, `fixture fileCount ${expected.fileCount} != 4 (skip rules broken)`)
    /** Build a fixture lock carrying a treeSha for `corpus` plus the two POLICY-only entries. */
    const lockText = (treeSha: string): string => `${JSON.stringify({
      assets: {
        corpus: { fileCount: expected.fileCount, source: "scratch fixture corpus", treeSha },
        "packages/x/dist/cli.js": { fileCount: 1, source: "build artifact", sha256: "de".repeat(32) },
        countonly: { fileCount: 3 },
      },
    }, null, 2)}\n`
    /** The scrub lock that already matches the fixture corpus. */
    const good = join(fixture, "lock.json")
    /** The scrub lock the mutate arms rewrite. */
    const scratch = join(fixture, "scratch.json")
    writeFileSync(good, lockText(expected.treeSha))

    arm("(a) matching scrub fixture lock -> --check exits 0", (): string => {
      /** The `--check` run of the staged sibling against the scrub lock. */
      const r = run(fixtureScript, ["--check", "--lock", good])
      expect(r.code === 0, `exit ${r.code}, stderr=${r.err.trim()}`)
      expect(r.out.includes("CHECK     : GREEN"), `no GREEN line: ${r.out.trim()}`)
      expect(r.out.includes("POLICY (not a failure) - single-file sha256 asset"), "sha256 asset was not reported under the POLICY label")
      expect(r.out.includes("POLICY (not a failure) - count-only asset"), "count-only asset was not reported under the POLICY label")
      return `exit 0; ${expected.fileCount}-file corpus in sync; non-treeSha assets reported under the POLICY (not a failure) label`
    })

    arm("(b) drifted scratch lock -> --check exits 1 and prints the delta", (): string => {
      writeFileSync(scratch, lockText("0".repeat(64)))
      /** The `--check` run against the deliberately drifted scratch lock. */
      const r = run(fixtureScript, ["--check", "--lock", scratch])
      expect(r.code === 1, `exit ${r.code} (expected 1)`)
      expect(r.out.includes(`treeSha ${"0".repeat(64)} -> ${expected.treeSha}`), `delta line missing: ${r.out.trim()}`)
      expect(r.out.includes("CHECK     : RED"), "no RED line")
      return `exit 1; printed ${"0".repeat(12)}... -> ${expected.treeSha.slice(0, 12)}...`
    })

    arm("(c) --write mutates ONLY the treeSha field, and --check then exits 0", (): string => {
      /** The scratch lock's text before the write, for the line report. */
      const before = readFileSync(scratch, "utf8")
      /** The `--write` run that must mutate the scratch lock only. */
      const r = run(fixtureScript, ["--write", "--lock", scratch])
      expect(r.code === 0, `write exit ${r.code}, stderr=${r.err.trim()}`)
      /** The scratch lock's text after the write. */
      const after = readFileSync(scratch, "utf8")
      /** The applied edit's line and byte diff. */
      const report = reportChanges(before, after)
      expect(report.linesChanged === 1, `linesChanged=${report.linesChanged} (expected exactly 1)`)
      expect(report.diff[0].includes("treeSha"), `changed line is not treeSha: ${report.diff.join(" | ")}`)
      // The JSON boundary: the written TEXT is the subject, so it is reparsed rather than read
      // back through the file, and its shape is the fixture lock's.
      /** The written text reparsed, to prove which values actually landed. */
      const reparsed = JSON.parse(after) as FixtureLock
      expect(reparsed.assets.corpus.treeSha === expected.treeSha, "written value != LF-normalized value")
      expect(reparsed.assets.corpus.treeSha !== expected.rawTreeSha, "written value is the RAW variant - normalization lost")
      expect(reparsed.assets.corpus.fileCount === expected.fileCount, "fileCount changed unexpectedly")
      expect(reparsed.assets["packages/x/dist/cli.js"].sha256 === "de".repeat(32), "sha256 asset was touched")
      expect(reparsed.assets.countonly.fileCount === 3, "count-only asset was touched")
      /** The `--check` run that must now be GREEN. */
      const check = run(fixtureScript, ["--check", "--lock", scratch])
      expect(check.code === 0, `--check after write exited ${check.code}`)
      return `1 line changed (${report.bytesBefore} -> ${report.bytesAfter} bytes, differingBytes=${report.differingBytes}); sha256+count-only assets untouched; --check GREEN after write`
    })

    arm("(d) default VENDOR_LOCK.json guard: --write refuses, real file byte-identical", (): string => {
      expect(existsSync(DEFAULT_LOCK), `real lock missing: ${DEFAULT_LOCK}`)
      /** The real lock's digest before the guard attempt; it must be identical afterwards. */
      const before = sha(DEFAULT_LOCK)
      /** The refused `--write` run against this helper's own default lock path. */
      const r = run(SELF, ["--write"])
      /** The real lock's digest after the refused run. */
      const after = sha(DEFAULT_LOCK)
      expect(r.code === 1, `guard exit ${r.code} (expected 1)`)
      expect(r.err.includes(OVERRIDE_FLAG), `guard message does not name the override flag: ${r.err.trim()}`)
      expect(before === after, `REAL LOCK MUTATED: ${before} -> ${after}`)
      /** A copy of the scratch lock at a different path, which the guard must allow. */
      const elsewhere = join(fixture, "nested", "VENDOR_LOCK.json")
      mkdirSync(dirname(elsewhere), { recursive: true })
      writeFileSync(elsewhere, lockText("0".repeat(64)))
      /** The `--write` run against that differently located copy. */
      const r2 = run(fixtureScript, ["--write", "--lock", elsewhere])
      expect(r2.code === 0, `guard is name-scoped: a copy at a different path was refused (exit ${r2.code})`)
      expect(readJson<FixtureLock>(elsewhere).assets.corpus.treeSha === expected.treeSha, "the elsewhere copy was not actually re-pinned")
      return `exit 1, override flag named, real sha256 ${before} unchanged; guard is path-scoped (a different path named VENDOR_LOCK.json is writable, exit 0)`
    })

    arm("(e) dry run mutates nothing", (): string => {
      /** The scratch lock the dry run is pointed at. */
      const target = join(fixture, "dryrun.json")
      writeFileSync(target, lockText("0".repeat(64)))
      /** The target's digest before the dry run. */
      const before = sha(target)
      /** The dry run itself, against the drifted scratch lock. */
      const r = run(fixtureScript, ["--lock", target])
      /** The target's digest after the dry run. */
      const after = sha(target)
      expect(r.code === 0, `dry run exit ${r.code}`)
      expect(before === after, `dry run mutated the lock: ${before} -> ${after}`)
      expect(r.out.includes("DRY RUN"), `no DRY RUN line: ${r.out.trim()}`)
      expect(r.out.includes("would be re-pinned"), "dry run did not report the pending delta")
      return `exit 0, sha256 ${before.slice(0, 12)}... unchanged, delta reported`
    })

    arm("(f) bad flag -> exit 1 + usage", (): string => {
      /** The run with an unknown flag, which must be refused with the usage text. */
      const r = run(fixtureScript, ["--nope"])
      expect(r.code === 1, `exit ${r.code} (expected 1)`)
      expect(r.err.includes("unknown flag: --nope"), `no unknown-flag message: ${r.err.trim()}`)
      expect(r.err.includes("usage: node scripts/repin-vendor.ts"), "no usage text")
      /** The run combining two mutually exclusive modes. */
      const clash = run(fixtureScript, ["--check", "--write"])
      expect(clash.code === 1 && clash.err.includes("mutually exclusive"), `--check --write was accepted (exit ${clash.code})`)
      return "unknown flag and --check/--write clash both exit 1 with usage"
    })

    arm("(g) negative control: a tampered authority makes the mirror guard REFUSE", (): string => {
      /** The fixture authority's pristine source, restored in the `finally` block below. */
      const original = readFileSync(fixtureAuthority, "utf8")
      /** The real authority's digest, which the tamper must leave untouched. */
      const realBefore = sha(AUTHORITY_PATH)
      try {
        writeFileSync(fixtureAuthority, original.replace('if (entry === "node_modules") continue', "if (false) continue"))
        expect(readFileSync(fixtureAuthority, "utf8") !== original, "tamper did not change the fixture authority")
        /** The `--check` run against the authority with one mirror token removed. */
        const r = run(fixtureScript, ["--check", "--lock", good])
        expect(r.code === 1, `tampered authority still exited ${r.code} - the guard is inert`)
        expect(r.err.includes("changed shape"), `no shape-refusal message: ${r.err.trim()}`)
      } finally {
        writeFileSync(fixtureAuthority, original)
      }
      expect(sha(AUTHORITY_PATH) === realBefore, "self-test touched the real scripts/verify-vendor.ts")
      /** The `--check` run after the authority was restored. */
      const restored = run(fixtureScript, ["--check", "--lock", good])
      expect(restored.code === 0, `restored authority no longer checks green (exit ${restored.code})`)
      return "tampered mirror token -> exit 1 with 'changed shape'; restored -> exit 0 (falsifiable guard; real authority sha unchanged)"
    })
  } finally {
    for (const root of roots) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch (e) {
        process.stderr.write(`${TAG} self-test cleanup failed for ${root}: ${e instanceof Error ? e.message : String(e)}\n`)
      }
    }
  }

  /** Number of arms that failed; the returned exit code is derived from it. */
  let failed: number = 0
  for (const a of arms) {
    if (a.status === "FAIL") failed += 1
    process.stdout.write(`${TAG} SELF-TEST ${a.status} - ${a.arm}\n${TAG}   ${a.reason}\n`)
  }
  process.stdout.write(`${TAG} SELF-TEST ${failed === 0 ? "PASS" : "FAIL"} - ${arms.length - failed}/${arms.length} arm(s) passed\n`)
  return failed === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------------------------

/** The parsed command line; `parseArgs` exits the process itself when a flag is invalid. */
const opts: CliOptions = ((): CliOptions => {
  try {
    return parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${TAG} ${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  }
})()

if (opts.help) {
  process.stdout.write(`${USAGE}\n`)
  process.exit(0)
}
if (opts.selfTest) process.exit(selfTest())
try {
  process.exit(runCli(opts))
} catch (e) {
  // Top-level CLI boundary: any refusal or unexpected failure is loud and never a partial write.
  process.stderr.write(`${TAG} FAIL - ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}
