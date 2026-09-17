#!/usr/bin/env node
// Derived re-pin helper for the corpus fingerprints in VENDOR_LOCK.json (friction item T-33).
//
// WHY: `skills/**` has ONE writer per wave, and every edit to it invalidates the corpus `treeSha`
// that scripts/verify-vendor.mjs checks as a BLOCKER, so the lock used to be hand-edited at commit
// time. This helper DERIVES that value from the working tree, prints the delta, and applies it only
// when explicitly asked. It defaults to DRY RUN.
//
// AUTHORITY: scripts/verify-vendor.mjs owns the algorithm. It exports nothing (it is a top-level
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
// USAGE: node scripts/repin-vendor.mjs [--lock <path>] [--check] [--write] [--json] [--self-test]
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
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = dirname(dirname(SELF))
const AUTHORITY_PATH = join(REPO_ROOT, "scripts", "verify-vendor.mjs")
const DEFAULT_LOCK = join(REPO_ROOT, "VENDOR_LOCK.json")
const OVERRIDE_FLAG = "--i-know-this-is-the-captains-step"
const TAG = "[repin-vendor]"
const USAGE = [
  "usage: node scripts/repin-vendor.mjs [--lock <path>] [--check] [--write] [--json] [--self-test]",
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

// ---------------------------------------------------------------------------------------------
// The mirrored algorithm (authority: scripts/verify-vendor.mjs)
// ---------------------------------------------------------------------------------------------

/** Marker line the mirror re-checks; see assertAuthorityShape(). */
const AUTHORITY_TOKENS = [
  '.replace(/\\r\\n?/g, "\\n")',
  'if (!buf.includes(0)) return Buffer.from(buf.toString("utf8")',
  'if (entry === "node_modules") continue',
  'if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue',
  'h.update(f + "\\n" + fh + "\\n")',
  '.update(readBytes(join(dir, f))).digest("hex")',
]

/** Fail loudly when scripts/verify-vendor.mjs no longer carries the algorithm this file mirrors. */
function assertAuthorityShape() {
  if (!existsSync(AUTHORITY_PATH)) throw new Refusal(`authority missing: ${AUTHORITY_PATH}`)
  const src = readFileSync(AUTHORITY_PATH, "utf8")
  const missing = AUTHORITY_TOKENS.filter((t) => !src.includes(t))
  if (missing.length > 0) {
    throw new Refusal(
      `scripts/verify-vendor.mjs changed shape - re-mirror the algorithm here before using this helper; missing token(s): ${missing.join(" | ")}`,
    )
  }
  return `mirror matches all ${AUTHORITY_TOKENS.length} decisive token(s) of scripts/verify-vendor.mjs`
}

/** Mirror of the authority's readBytes: text -> LF, binary (NUL present) -> raw bytes. */
function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

/** Mirror of the authority's listFiles (node_modules / __pycache__ / *.pyc / *.pyo are not corpus). */
function listFiles(dir) {
  if (statSync(dir).isFile()) return [dir]
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
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
function fingerprint(dir) {
  const files = listFiles(dir)
  const rels = files.map((f) => f.slice(dir.length + 1)).sort()
  const lf = createHash("sha256")
  const raw = createHash("sha256")
  let normalizedFiles = 0
  for (const rel of rels) {
    const p = join(dir, rel)
    const lfBytes = readBytes(p)
    const rawBytes = readFileSync(p)
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
function planAssets(lock) {
  const assets = lock.assets && typeof lock.assets === "object" ? lock.assets : {}
  const repins = []
  const skipped = []
  const problems = []
  for (const [asset, meta] of Object.entries(assets)) {
    if (asset.startsWith("_")) {
      skipped.push({ asset, reason: "POLICY (not a failure) - underscore-prefixed metadata key: the vendor gate skips these too, so this helper does not re-pin it" })
      continue
    }
    if (meta === null || typeof meta !== "object") {
      problems.push({ asset, reason: "asset entry is not an object" })
      continue
    }
    if (typeof meta.treeSha !== "string") {
      const kind = typeof meta.sha256 === "string"
        ? "single-file sha256 asset - a build artifact, so re-pin it by rebuilding (scripts/build-mcp.mjs), never by rewriting the lock"
        : "count-only asset - carries no fingerprint this helper can derive"
      skipped.push({ asset, reason: `POLICY (not a failure) - ${kind}` })
      continue
    }
    const path = join(REPO_ROOT, asset)
    if (!existsSync(path)) {
      problems.push({ asset, reason: "asset path missing under the working tree" })
      continue
    }
    if (!statSync(path).isDirectory()) {
      problems.push({ asset, reason: "treeSha declared on a plain file - refusing to fold a tree hash over it" })
      continue
    }
    if (typeof meta.fileCount !== "number") {
      problems.push({ asset, reason: "treeSha asset has no numeric fileCount - add it by hand once, then re-run" })
      continue
    }
    const computed = fingerprint(path)
    repins.push({
      asset,
      path,
      locked: { fileCount: meta.fileCount, treeSha: meta.treeSha },
      computed,
      drifted: computed.treeSha !== meta.treeSha || computed.fileCount !== meta.fileCount,
    })
  }
  return { repins, skipped, problems }
}

/** Index of the `}` closing the object that starts at `start`, string-aware. */
function matchBrace(text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
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
function spliceLock(text, repins) {
  let next = text
  const changed = []
  for (const repin of repins) {
    const wanted = [["fileCount", repin.locked.fileCount, repin.computed.fileCount], ["treeSha", repin.locked.treeSha, repin.computed.treeSha]]
      .filter(([, before, after]) => before !== after)
    if (wanted.length === 0) continue
    for (const [field, before, after] of wanted) {
      const key = JSON.stringify(repin.asset) + ":"
      const keyAt = next.indexOf(key)
      if (keyAt < 0 || next.indexOf(key, keyAt + 1) >= 0) throw new Refusal(`asset key ${JSON.stringify(repin.asset)} is not uniquely locatable in the lock`)
      const blockStart = next.indexOf("{", keyAt)
      const blockEnd = matchBrace(next, blockStart)
      const needle = JSON.stringify(field) + ": " + JSON.stringify(before)
      const at = next.indexOf(needle, blockStart)
      const duplicate = at < 0 ? -1 : next.indexOf(needle, at + 1)
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
function assertSpliceIsExact(text, next, repins) {
  const intended = JSON.parse(text)
  for (const repin of repins) {
    if (!repin.drifted) continue
    intended.assets[repin.asset].treeSha = repin.computed.treeSha
    intended.assets[repin.asset].fileCount = repin.computed.fileCount
  }
  const got = JSON.parse(next)
  if (JSON.stringify(got) !== JSON.stringify(intended)) throw new Refusal("spliced lock does not reparse to the intended document - refusing to write")
}

/** Line-aligned change report; `spliceLock` only replaces text inside a line, so line counts match. */
function reportChanges(before, after) {
  const a = before.split("\n")
  const b = after.split("\n")
  if (a.length !== b.length) return { linesChanged: -1, diff: [`line count changed: ${a.length} -> ${b.length}`] }
  const diff = []
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff.push(`- (line ${i + 1}) ${a[i]}`, `+ (line ${i + 1}) ${b[i]}`)
  const ab = Buffer.from(before)
  const bb = Buffer.from(after)
  let differingBytes = Math.abs(ab.length - bb.length)
  for (let i = 0; i < Math.min(ab.length, bb.length); i += 1) if (ab[i] !== bb[i]) differingBytes += 1
  return { linesChanged: diff.length / 2, diff, bytesBefore: ab.length, bytesAfter: bb.length, differingBytes }
}

function writeLock(lockPath, next) {
  const tmp = `${lockPath}.tmp-${process.pid}`
  writeFileSync(tmp, next)
  renameSync(tmp, lockPath)
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { lock: DEFAULT_LOCK, check: false, write: false, json: false, selfTest: false, override: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--lock") {
      const value = argv[i + 1]
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

function algorithmBanner(assetCount) {
  return [
    `${TAG} algorithm : MIRROR of scripts/verify-vendor.mjs (readBytes + listFiles + sorted-relpath tree fold); the authority exports nothing, assertAuthorityShape() guards the mirror`,
    `${TAG} normalize : LF - text files (no NUL byte) have CRLF/CR collapsed to LF; binary files (NUL present) are hashed RAW`,
    `${TAG} WARNING   : the vendor gate compares the LF-NORMALIZED value only. A raw-bytes reading would silently fail \`bun run verify:vendor\` on any corpus containing CRLF/CR bytes - both values are printed per asset below.`,
    `${TAG} assets    : ${assetCount} treeSha-bearing asset(s) derived from the working tree`,
  ]
}

function runCli(opts) {
  const authorityProof = assertAuthorityShape()
  const lockPath = opts.lock
  if (opts.write && lockPath === DEFAULT_LOCK && !opts.override) {
    throw new Refusal(
      `refusing to ${"--write"} the repository's own VENDOR_LOCK.json: this wave's single re-pin is the captain's commit-time step. Re-run with ${OVERRIDE_FLAG} if you really are that step, or pass --lock <scratch-copy> to exercise this helper.`,
    )
  }
  if (!existsSync(lockPath)) throw new Refusal(`lock file not found: ${lockPath}`)
  const text = readFileSync(lockPath, "utf8")
  const lock = JSON.parse(text)
  const plan = planAssets(lock)
  const rePinnable = plan.repins.length
  const drifted = plan.repins.filter((r) => r.drifted)
  const records = plan.repins.map((r) => ({
    asset: r.asset,
    locked: { fileCount: r.locked.fileCount, treeSha: r.locked.treeSha },
    computed: { fileCount: r.computed.fileCount, treeSha: r.computed.treeSha },
    lfNormalized: r.computed.treeSha,
    rawBytesVariant: r.computed.rawTreeSha,
    normalizedFiles: r.computed.normalizedFiles,
    drifted: r.drifted,
    action: r.drifted ? (opts.write ? "repinned" : "would-repin") : "unchanged",
  }))

  let writeResult = null
  if (opts.write && drifted.length > 0) {
    const { next, changed } = spliceLock(text, plan.repins)
    assertSpliceIsExact(text, next, plan.repins)
    const report = reportChanges(text, next)
    writeLock(lockPath, next)
    writeResult = { changed, report }
  }

  const zeroSubject = rePinnable === 0
  const checkRed = zeroSubject || plan.problems.length > 0 || drifted.length > 0
  const exitCode = opts.check ? (checkRed ? 1 : 0) : plan.problems.length > 0 ? 1 : 0

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      mode: opts.check ? "check" : opts.write ? "write" : "dry-run",
      lock: lockPath,
      algorithm: "MIRROR of scripts/verify-vendor.mjs (LF-normalized tree fold)",
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

  const out = (line) => process.stdout.write(`${line}\n`)
  const err = (line) => process.stderr.write(`${line}\n`)
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

function selfTest() {
  const arms = []
  const arm = (name, fn) => {
    try {
      arms.push({ arm: name, status: "PASS", reason: fn() })
    } catch (e) {
      arms.push({ arm: name, status: "FAIL", reason: e instanceof Error ? e.message : String(e) })
    }
  }
  const expect = (cond, msg) => { if (!cond) throw new Error(msg) }
  const run = (script, args) => {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }
  }
  const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
  const roots = []
  const mkroot = (name) => { const d = mkdtempSync(join(tmpdir(), `repin-vendor-${name}-`)); roots.push(d); return d }

  try {
    arm("authority-shape: mirror still matches scripts/verify-vendor.mjs", () => assertAuthorityShape())

    arm("hand-computed expectation: one-file tree fold (independent of fingerprint())", () => {
      const root = mkroot("hand")
      mkdirSync(join(root, "corpus"))
      writeFileSync(join(root, "corpus", "a.txt"), "x\ny\n")
      const expected = createHash("sha256")
        .update(`a.txt\n${createHash("sha256").update("x\ny\n").digest("hex")}\n`)
        .digest("hex")
      const got = fingerprint(join(root, "corpus"))
      expect(got.treeSha === expected, `tree fold mismatch: got ${got.treeSha} expected ${expected}`)
      expect(got.fileCount === 1, `fileCount ${got.fileCount} != 1`)
      return `sha256("a.txt\\n" + sha256("x\\ny\\n") + "\\n") = ${expected}`
    })

    arm("LF normalization: a CRLF file hashes exactly like its LF twin; a NUL file stays raw", () => {
      const root = mkroot("crlf")
      mkdirSync(join(root, "lf"))
      mkdirSync(join(root, "crlf"))
      writeFileSync(join(root, "lf", "f.txt"), "a\nb\n")
      writeFileSync(join(root, "crlf", "f.txt"), "a\r\nb\r\n")
      const lf = fingerprint(join(root, "lf"))
      const crlf = fingerprint(join(root, "crlf"))
      expect(lf.treeSha === crlf.treeSha, `CRLF twin diverged: ${crlf.treeSha} != ${lf.treeSha}`)
      expect(crlf.rawTreeSha !== crlf.treeSha, "raw variant must differ from the normalized one for a CRLF file")
      expect(crlf.normalizedFiles === 1, `normalizedFiles ${crlf.normalizedFiles} != 1`)
      mkdirSync(join(root, "bin"))
      writeFileSync(join(root, "bin", "d.bin"), Buffer.from([0, 1, 2, 255]))
      const bin = fingerprint(join(root, "bin"))
      expect(bin.treeSha === bin.rawTreeSha, "a NUL-bearing file must hash identically in both variants")
      return `CRLF twin == LF twin (${lf.treeSha.slice(0, 12)}...), NUL file raw in both`
    })

    const fixture = mkroot("cli")
    mkdirSync(join(fixture, "scripts"))
    copyFileSync(SELF, join(fixture, "scripts", "repin-vendor.mjs"))
    copyFileSync(AUTHORITY_PATH, join(fixture, "scripts", "verify-vendor.mjs"))
    const fixtureScript = join(fixture, "scripts", "repin-vendor.mjs")
    const fixtureAuthority = join(fixture, "scripts", "verify-vendor.mjs")
    mkdirSync(join(fixture, "corpus", "sub"), { recursive: true })
    mkdirSync(join(fixture, "corpus", "__pycache__"), { recursive: true })
    mkdirSync(join(fixture, "corpus", "node_modules"), { recursive: true })
    writeFileSync(join(fixture, "corpus", "alpha.txt"), "alpha\nline\n")
    writeFileSync(join(fixture, "corpus", "sub", "gamma.txt"), "gamma\n")
    writeFileSync(join(fixture, "corpus", "crlf.txt"), "crlf\r\nwindows\r\nbytes\r\n")
    writeFileSync(join(fixture, "corpus", "bin.dat"), Buffer.from([0, 7, 0, 255, 13, 10]))
    writeFileSync(join(fixture, "corpus", "__pycache__", "ignored.pyc"), "ignored")
    writeFileSync(join(fixture, "corpus", "node_modules", "ignored.js"), "ignored")
    const expected = fingerprint(join(fixture, "corpus"))
    expect(expected.fileCount === 4, `fixture fileCount ${expected.fileCount} != 4 (skip rules broken)`)
    const lockText = (treeSha) => `${JSON.stringify({
      assets: {
        corpus: { fileCount: expected.fileCount, source: "scratch fixture corpus", treeSha },
        "packages/x/dist/cli.js": { fileCount: 1, source: "build artifact", sha256: "de".repeat(32) },
        countonly: { fileCount: 3 },
      },
    }, null, 2)}\n`
    const good = join(fixture, "lock.json")
    const scratch = join(fixture, "scratch.json")
    writeFileSync(good, lockText(expected.treeSha))

    arm("(a) matching scrub fixture lock -> --check exits 0", () => {
      const r = run(fixtureScript, ["--check", "--lock", good])
      expect(r.code === 0, `exit ${r.code}, stderr=${r.err.trim()}`)
      expect(r.out.includes("CHECK     : GREEN"), `no GREEN line: ${r.out.trim()}`)
      expect(r.out.includes("POLICY (not a failure) - single-file sha256 asset"), "sha256 asset was not reported under the POLICY label")
      expect(r.out.includes("POLICY (not a failure) - count-only asset"), "count-only asset was not reported under the POLICY label")
      return `exit 0; ${expected.fileCount}-file corpus in sync; non-treeSha assets reported under the POLICY (not a failure) label`
    })

    arm("(b) drifted scratch lock -> --check exits 1 and prints the delta", () => {
      writeFileSync(scratch, lockText("0".repeat(64)))
      const r = run(fixtureScript, ["--check", "--lock", scratch])
      expect(r.code === 1, `exit ${r.code} (expected 1)`)
      expect(r.out.includes(`treeSha ${"0".repeat(64)} -> ${expected.treeSha}`), `delta line missing: ${r.out.trim()}`)
      expect(r.out.includes("CHECK     : RED"), "no RED line")
      return `exit 1; printed ${"0".repeat(12)}... -> ${expected.treeSha.slice(0, 12)}...`
    })

    arm("(c) --write mutates ONLY the treeSha field, and --check then exits 0", () => {
      const before = readFileSync(scratch, "utf8")
      const r = run(fixtureScript, ["--write", "--lock", scratch])
      expect(r.code === 0, `write exit ${r.code}, stderr=${r.err.trim()}`)
      const after = readFileSync(scratch, "utf8")
      const report = reportChanges(before, after)
      expect(report.linesChanged === 1, `linesChanged=${report.linesChanged} (expected exactly 1)`)
      expect(report.diff[0].includes("treeSha"), `changed line is not treeSha: ${report.diff.join(" | ")}`)
      const reparsed = JSON.parse(after)
      expect(reparsed.assets.corpus.treeSha === expected.treeSha, "written value != LF-normalized value")
      expect(reparsed.assets.corpus.treeSha !== expected.rawTreeSha, "written value is the RAW variant - normalization lost")
      expect(reparsed.assets.corpus.fileCount === expected.fileCount, "fileCount changed unexpectedly")
      expect(reparsed.assets["packages/x/dist/cli.js"].sha256 === "de".repeat(32), "sha256 asset was touched")
      expect(reparsed.assets.countonly.fileCount === 3, "count-only asset was touched")
      const check = run(fixtureScript, ["--check", "--lock", scratch])
      expect(check.code === 0, `--check after write exited ${check.code}`)
      return `1 line changed (${report.bytesBefore} -> ${report.bytesAfter} bytes, differingBytes=${report.differingBytes}); sha256+count-only assets untouched; --check GREEN after write`
    })

    arm("(d) default VENDOR_LOCK.json guard: --write refuses, real file byte-identical", () => {
      expect(existsSync(DEFAULT_LOCK), `real lock missing: ${DEFAULT_LOCK}`)
      const before = sha(DEFAULT_LOCK)
      const r = run(SELF, ["--write"])
      const after = sha(DEFAULT_LOCK)
      expect(r.code === 1, `guard exit ${r.code} (expected 1)`)
      expect(r.err.includes(OVERRIDE_FLAG), `guard message does not name the override flag: ${r.err.trim()}`)
      expect(before === after, `REAL LOCK MUTATED: ${before} -> ${after}`)
      const elsewhere = join(fixture, "nested", "VENDOR_LOCK.json")
      mkdirSync(dirname(elsewhere), { recursive: true })
      writeFileSync(elsewhere, lockText("0".repeat(64)))
      const r2 = run(fixtureScript, ["--write", "--lock", elsewhere])
      expect(r2.code === 0, `guard is name-scoped: a copy at a different path was refused (exit ${r2.code})`)
      expect(JSON.parse(readFileSync(elsewhere, "utf8")).assets.corpus.treeSha === expected.treeSha, "the elsewhere copy was not actually re-pinned")
      return `exit 1, override flag named, real sha256 ${before} unchanged; guard is path-scoped (a different path named VENDOR_LOCK.json is writable, exit 0)`
    })

    arm("(e) dry run mutates nothing", () => {
      const target = join(fixture, "dryrun.json")
      writeFileSync(target, lockText("0".repeat(64)))
      const before = sha(target)
      const r = run(fixtureScript, ["--lock", target])
      const after = sha(target)
      expect(r.code === 0, `dry run exit ${r.code}`)
      expect(before === after, `dry run mutated the lock: ${before} -> ${after}`)
      expect(r.out.includes("DRY RUN"), `no DRY RUN line: ${r.out.trim()}`)
      expect(r.out.includes("would be re-pinned"), "dry run did not report the pending delta")
      return `exit 0, sha256 ${before.slice(0, 12)}... unchanged, delta reported`
    })

    arm("(f) bad flag -> exit 1 + usage", () => {
      const r = run(fixtureScript, ["--nope"])
      expect(r.code === 1, `exit ${r.code} (expected 1)`)
      expect(r.err.includes("unknown flag: --nope"), `no unknown-flag message: ${r.err.trim()}`)
      expect(r.err.includes("usage: node scripts/repin-vendor.mjs"), "no usage text")
      const clash = run(fixtureScript, ["--check", "--write"])
      expect(clash.code === 1 && clash.err.includes("mutually exclusive"), `--check --write was accepted (exit ${clash.code})`)
      return "unknown flag and --check/--write clash both exit 1 with usage"
    })

    arm("(g) negative control: a tampered authority makes the mirror guard REFUSE", () => {
      const original = readFileSync(fixtureAuthority, "utf8")
      const realBefore = sha(AUTHORITY_PATH)
      try {
        writeFileSync(fixtureAuthority, original.replace('if (entry === "node_modules") continue', "if (false) continue"))
        expect(readFileSync(fixtureAuthority, "utf8") !== original, "tamper did not change the fixture authority")
        const r = run(fixtureScript, ["--check", "--lock", good])
        expect(r.code === 1, `tampered authority still exited ${r.code} - the guard is inert`)
        expect(r.err.includes("changed shape"), `no shape-refusal message: ${r.err.trim()}`)
      } finally {
        writeFileSync(fixtureAuthority, original)
      }
      expect(sha(AUTHORITY_PATH) === realBefore, "self-test touched the real scripts/verify-vendor.mjs")
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

  let failed = 0
  for (const a of arms) {
    if (a.status === "FAIL") failed += 1
    process.stdout.write(`${TAG} SELF-TEST ${a.status} - ${a.arm}\n${TAG}   ${a.reason}\n`)
  }
  process.stdout.write(`${TAG} SELF-TEST ${failed === 0 ? "PASS" : "FAIL"} - ${arms.length - failed}/${arms.length} arm(s) passed\n`)
  return failed === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------------------------

const opts = (() => {
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
