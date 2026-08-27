#!/usr/bin/env node
// Verify the vendor baseline: upstream commit/version are blockers; stats drift is a warning; asset counts are blockers.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// Legacy layout assumed repoRoot = <omo checkout>/.omo/port/mpd-dsh. The repo now lives
// anywhere; point MPD_UPSTREAM_ROOT at the omo checkout explicitly (or keep the old relative default).
const upstreamRoot = process.env.MPD_UPSTREAM_ROOT || join(repoRoot, "..", "..", "..")
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
for (const [rel, meta] of Object.entries(lock.assets || {})) {
  if (String(rel).startsWith("_")) continue
  const dir = join(repoRoot, rel)
  if (!existsSync(dir)) { fail("asset missing: " + rel); continue }
  const files = execFileSync("find", ["-L", dir, "-type", "f", "-not", "-path", "*/node_modules/*"], { encoding: "utf8" })
    .split("\n").filter(Boolean).length
  if (files !== meta.fileCount) fail("asset " + rel + " count drifted: " + files + " vs " + meta.fileCount)
  if (typeof meta.sha256 === "string") {
    const actual = createHash("sha256").update(readFileSync(dir)).digest("hex")
    if (actual !== meta.sha256) fail("asset " + rel + " sha256 mismatch")
  }
  if (typeof meta.treeSha === "string") {
    const files2 = execFileSync("find", ["-L", dir, "-type", "f", "-not", "-path", "*/node_modules/*"], { encoding: "utf8" })
      .split("\n").filter(Boolean).sort()
    const h = createHash("sha256")
    for (const f of files2) {
      const rel = f.slice(dir.length + 1)
      const fh = createHash("sha256").update(readFileSync(f)).digest("hex")
      h.update(rel + "\n" + fh + "\n")
    }
    const actual = h.digest("hex")
    if (actual !== meta.treeSha) fail("asset " + rel + " treeSha mismatch")
  }
  console.log("[verify-vendor] asset OK:", rel, files, "files")
}

if (failed) process.exit(1)
console.log("[verify-vendor] PASS")
