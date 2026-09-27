#!/usr/bin/env node
// Verify the vendor baseline: upstream commit/version are blockers; stats drift is a warning; asset counts are blockers.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = repoRootFrom(import.meta.url)
// Legacy layout assumed repoRoot = <the upstream checkout>/.mpd/port/mpd-dsh. Auto-detect the
// pinned checkout at .mpd-dsh/upstream; point MPD_UPSTREAM_ROOT at the checkout explicitly
// when it lives elsewhere (or keep the old relative default).
const upstreamRoot = process.env.MPD_UPSTREAM_ROOT || (existsSync(join(repoRoot, ".mpd-dsh", "upstream", ".git")) ? join(repoRoot, ".mpd-dsh", "upstream") : join(repoRoot, "..", "..", ".."))
if (!existsSync(join(upstreamRoot, ".git"))) {
  console.error("[verify-vendor] FAIL - upstream checkout not found at " + upstreamRoot)
  console.error("[verify-vendor] set MPD_UPSTREAM_ROOT to the oh-my-openagent checkout pinned to " + readJson(join(repoRoot, "VENDOR_LOCK.json")).upstreamCommitSha)
  process.exit(1)
}
const lock = readJson(join(repoRoot, "VENDOR_LOCK.json"))

function git(args) {
  return execFileSync("git", args, { cwd: upstreamRoot, encoding: "utf8" }).trim()
}

let failed = false
function fail(msg) { console.error("[verify-vendor] FAIL -", msg); failed = true }
function warn(msg) { console.warn("[verify-vendor] WARN -", msg) }

// 1) commit lock
const head = git(["rev-parse", "HEAD"])
if (head !== lock.upstreamCommitSha) {
  fail("upstream commit mismatch: HEAD=" + head + " lock=" + lock.upstreamCommitSha)
} else {
  console.log("[verify-vendor] commit OK:", head)
}

// 2) version lock
const upstreamPkg = readJson(join(upstreamRoot, "package.json"))
if (upstreamPkg.version !== lock.upstreamVersion) {
  fail("upstream version mismatch: " + upstreamPkg.version + " vs " + lock.upstreamVersion)
} else {
  console.log("[verify-vendor] version OK:", upstreamPkg.version)
}

// 3) stats drift (warning)
const tracked = Number(git(["ls-files"]).split("\n").length)
const loc = Number(git(["ls-files", "-z"]).split("\0").filter(Boolean)
  .map((f) => { try { return readFileSync(join(upstreamRoot, f), "utf8").split("\n").length } catch { return 0 } })
  .reduce((a, b) => a + b, 0))
if (tracked !== lock.upstreamStats.trackedFiles || loc !== lock.upstreamStats.trackedLoc) {
  warn("stats drift: tracked=" + tracked + " loc=" + loc + " (lock=" + lock.upstreamStats.trackedFiles + "/" + lock.upstreamStats.trackedLoc + ")")
} else {
  console.log("[verify-vendor] stats OK:", tracked, "files /", loc, "loc")
}

// 4) vendored assets: count + sha256, both blockers
import { createHash } from "node:crypto"
import { readdirSync, statSync } from "node:fs"
import { readJson, repoRootFrom } from "./lib/repo.mjs"

// Read a vendored file as bytes, normalizing text (no NUL) to LF. The repo's
// .gitattributes declares eol=lf for text files, so tree hashes must be
// computed on normalized bytes — otherwise a CRLF working copy drifts the lock
// even though git sees a clean tree. Binary files hash raw.
function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

function listFiles(dir) {
  // node-only file enumeration (no `find` dependency); handles single-file assets
  if (statSync(dir).isFile()) return [dir]
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
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
const assetEntries = Object.entries(lock.assets || {}).filter(([rel]) => !String(rel).startsWith("_"))
if (assetEntries.length === 0) {
  fail("zero-subject run: VENDOR_LOCK.json declares no vendored assets to fingerprint - refusing to report PASS")
}
for (const [rel, meta] of assetEntries) {
  const dir = join(repoRoot, rel)
  if (!existsSync(dir)) { fail("asset missing: " + rel); continue }
  const files = listFiles(dir)
  // An asset that failed any of its gates must never also report OK.
  let assetOk = true
  if (files.length !== meta.fileCount) {
    fail("asset " + rel + " count drifted: " + files.length + " vs " + meta.fileCount)
    assetOk = false
  }
  if (typeof meta.sha256 === "string") {
    const actual = createHash("sha256").update(readFileSync(dir)).digest("hex")
    if (actual !== meta.sha256) { fail("asset " + rel + " sha256 mismatch"); assetOk = false }
  }
  if (typeof meta.treeSha === "string") {
    // The fold input is the RELPATH, so it must be spelled the same on every platform: a native
    // separator would make one corpus hash two different values (Windows `a\\b` vs POSIX `a/b`)
    // and the lock could only ever satisfy one of them — measured: a clean Windows checkout
    // recomputed 4b4f37… for a corpus the lock pins as 220ddd2c…, i.e. this gate was permanently
    // RED here while the same bytes were GREEN on the POSIX machine that wrote the pin. Same
    // discipline as readBytes()'s LF normalization above: the fingerprint is of the CONTENT.
    const files2 = files.map((f) => f.slice(dir.length + 1).split(sep).join("/")).sort()
    const h = createHash("sha256")
    for (const f of files2) {
      const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
      h.update(f + "\n" + fh + "\n")
    }
    const actual = h.digest("hex")
    if (actual !== meta.treeSha) { fail("asset " + rel + " treeSha mismatch"); assetOk = false }
  }
  if (assetOk) console.log("[verify-vendor] asset OK:", rel, files.length, "files")
}

if (failed) process.exit(1)
console.log("[verify-vendor] PASS")
