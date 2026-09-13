#!/usr/bin/env node
// Verify the vendor baseline: upstream commit/version are blockers; stats drift is a warning; asset counts are blockers.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// Legacy layout assumed repoRoot = <the upstream checkout>/.mpd/port/mpd-dsh. Auto-detect the
// pinned checkout at .mpd-dsh/upstream; point MPD_UPSTREAM_ROOT at the checkout explicitly
// when it lives elsewhere (or keep the old relative default).
const upstreamRoot = process.env.MPD_UPSTREAM_ROOT || (existsSync(join(repoRoot, ".mpd-dsh", "upstream", ".git")) ? join(repoRoot, ".mpd-dsh", "upstream") : join(repoRoot, "..", "..", ".."))
if (!existsSync(join(upstreamRoot, ".git"))) {
  console.error("[verify-vendor] FAIL - upstream checkout not found at " + upstreamRoot)
  console.error("[verify-vendor] set MPD_UPSTREAM_ROOT to the oh-my-openagent checkout pinned to " + JSON.parse(readFileSync(join(repoRoot, "VENDOR_LOCK.json"), "utf8")).upstreamCommitSha)
  process.exit(1)
}
const lock = JSON.parse(readFileSync(join(repoRoot, "VENDOR_LOCK.json"), "utf8"))

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
const upstreamPkg = JSON.parse(readFileSync(join(upstreamRoot, "package.json"), "utf8"))
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
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

for (const [rel, meta] of Object.entries(lock.assets || {})) {
  if (String(rel).startsWith("_")) continue
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
    const files2 = files.map((f) => f.slice(dir.length + 1)).sort()
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
