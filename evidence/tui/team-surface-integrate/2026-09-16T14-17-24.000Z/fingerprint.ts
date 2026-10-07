// Independent recomputation of the `skills/**` corpus fingerprint for the captain's same-commit
// VENDOR_LOCK.json re-pin (task t5, acceptance #4).
//
// WHY THIS EXISTS: quoting a hash from another member's prose proves nothing. This script
// re-derives the fingerprint from the corpus bytes with the SAME algorithm verify-vendor.mjs
// uses (scripts/verify-vendor.mjs:63-122) and then ASSERTS the expected values, so "the only
// red is the un-re-pinned drift" is a measurement, not an assertion in prose.
//
// Usage: node fingerprint.mjs <expected-fileCount> <expected-treeSha>
//        node fingerprint.mjs            # print the current reading only
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

/** The repo root, resolved from this script's own location (evidence/… → four levels up). */
export const REPO_ROOT = resolve(import.meta.dirname, "../../../..")

// verify-vendor reads non-binary files with CRLF normalised to LF; binary files hash raw.
export function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

// verify-vendor's enumeration: skip node_modules and python bytecode caches.
export function listFiles(dir) {
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

/** The sorted-relpath + per-file-sha256 aggregation verify-vendor gates on. */
export function fingerprint(dir) {
  const files = listFiles(dir)
  const rel = files.map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  for (const f of rel) {
    const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
    h.update(f + "\n" + fh + "\n")
  }
  return { fileCount: files.length, treeSha: h.digest("hex") }
}

function main() {
  const [expectedCount, expectedSha] = process.argv.slice(2)
  const skillsDir = join(REPO_ROOT, "skills")
  const actual = fingerprint(skillsDir)
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, "VENDOR_LOCK.json"), "utf8")).assets.skills
  const reading = {
    skillsDir,
    actual,
    pinned: { fileCount: lock.fileCount, treeSha: lock.treeSha },
    drift: actual.fileCount !== lock.fileCount || actual.treeSha !== lock.treeSha,
  }
  console.log(JSON.stringify(reading, null, 2))
  if (expectedCount === undefined) return
  const okCount = String(actual.fileCount) === String(expectedCount)
  const okSha = actual.treeSha === expectedSha
  console.log(`\nASSERT fileCount ${actual.fileCount} === ${expectedCount}: ${okCount ? "PASS" : "FAIL"}`)
  console.log(`ASSERT treeSha  ${actual.treeSha} === ${expectedSha}: ${okSha ? "PASS" : "FAIL"}`)
  if (!okCount || !okSha) process.exit(1)
  console.log("\n[fingerprint] PASS — the reported corpus values are the MEASURED values")
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
