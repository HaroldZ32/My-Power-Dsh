#!/usr/bin/env node
// 校验 vendor 基线：上游 commit/version 为阻断项；stats 漂移为警告；资产计数为阻断项。
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const upstreamRoot = join(repoRoot, "..", "..", "..") // 原 omo 检出（repoRoot 位于 .omo/port/omo-dsh）
const lock = JSON.parse(readFileSync(join(repoRoot, "VENDOR_LOCK.json"), "utf8"))

function git(args) {
  return execFileSync("git", args, { cwd: upstreamRoot, encoding: "utf8" }).trim()
}

let failed = false
function fail(msg) { console.error("[verify-vendor] FAIL -", msg); failed = true }
function warn(msg) { console.warn("[verify-vendor] WARN -", msg) }

// 1) commit 锁定
const head = git(["rev-parse", "HEAD"])
if (head !== lock.upstreamCommitSha) {
  fail("upstream commit mismatch: HEAD=" + head + " lock=" + lock.upstreamCommitSha)
} else {
  console.log("[verify-vendor] commit OK:", head)
}

// 2) version 锁定
const upstreamPkg = JSON.parse(readFileSync(join(upstreamRoot, "package.json"), "utf8"))
if (upstreamPkg.version !== lock.upstreamVersion) {
  fail("upstream version mismatch: " + upstreamPkg.version + " vs " + lock.upstreamVersion)
} else {
  console.log("[verify-vendor] version OK:", upstreamPkg.version)
}

// 3) stats 漂移（警告）
const tracked = Number(git(["ls-files"]).split("\n").length)
const loc = Number(git(["ls-files", "-z"]).split("\0").filter(Boolean)
  .map((f) => { try { return readFileSync(join(upstreamRoot, f), "utf8").split("\n").length } catch { return 0 } })
  .reduce((a, b) => a + b, 0))
if (tracked !== lock.upstreamStats.trackedFiles || loc !== lock.upstreamStats.trackedLoc) {
  warn("stats drift: tracked=" + tracked + " loc=" + loc + " (lock=" + lock.upstreamStats.trackedFiles + "/" + lock.upstreamStats.trackedLoc + ")")
} else {
  console.log("[verify-vendor] stats OK:", tracked, "files /", loc, "loc")
}

// 4) 已 vendor 资产计数（阻断）
for (const [rel, meta] of Object.entries(lock.assets || {})) {
  const dir = join(repoRoot, rel)
  if (!existsSync(dir)) { fail("asset missing: " + rel); continue }
  const files = execFileSync("find", ["-L", dir, "-type", "f", "-not", "-path", "*/node_modules/*"], { encoding: "utf8" })
    .split("\n").filter(Boolean).length
  if (files !== meta.fileCount) fail("asset " + rel + " count drifted: " + files + " vs " + meta.fileCount)
  else console.log("[verify-vendor] asset OK:", rel, files, "files")
}

if (failed) process.exit(1)
console.log("[verify-vendor] PASS")
