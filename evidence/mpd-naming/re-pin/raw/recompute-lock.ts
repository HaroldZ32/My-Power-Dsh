#!/usr/bin/env node
// Recompute VENDOR_LOCK.json's fingerprint values from the CURRENT bytes, using the exact
// algorithm scripts/verify-vendor.mjs applies (listFiles skips node_modules dirs; tree assets
// fold sorted relpath + per-file sha256 over LF-normalized bytes; single-file assets hash raw).
// Read-only by default; --write refreshes VENDOR_LOCK.json in place.
//
// Usage: node evidence/mpd-naming/re-pin/raw/recompute-lock.mjs [--write]
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
const lockPath = join(repoRoot, "VENDOR_LOCK.json")
const lock = JSON.parse(readFileSync(lockPath, "utf8"))

function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

function listFiles(dir) {
  if (statSync(dir).isFile()) return [dir]
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (entry === "node_modules") continue
      // Mirror scripts/verify-vendor.mjs (hardened in commit 0cbf505): bytecode caches are
      // build artifacts, not corpus content.
      if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

function treeValue(dir) {
  const files = listFiles(dir)
  const rel = files.map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  const perFile = {}
  for (const f of rel) {
    const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
    perFile[f] = fh
    h.update(f + "\n" + fh + "\n")
  }
  return { fileCount: files.length, treeSha: h.digest("hex"), perFile }
}

const out = { repoRoot, assets: {} }
for (const [rel, meta] of Object.entries(lock.assets)) {
  if (rel.startsWith("_")) continue
  const dir = join(repoRoot, rel)
  if (!existsSync(dir)) {
    out.assets[rel] = { error: "missing" }
    continue
  }
  if (typeof meta.treeSha === "string") {
    const v = treeValue(dir)
    out.assets[rel] = {
      kind: "tree",
      locked: { fileCount: meta.fileCount, treeSha: meta.treeSha },
      current: { fileCount: v.fileCount, treeSha: v.treeSha },
      match: v.fileCount === meta.fileCount && v.treeSha === meta.treeSha
    }
    if (!out.assets[rel].match) {
      const sidecar = join(repoRoot, "evidence", "mpd-naming", "re-pin", "raw",
        rel.replace(/[^a-zA-Z0-9]+/g, "_") + "-perfile.json")
      writeFileSync(sidecar, JSON.stringify(v.perFile, null, 2) + "\n")
      out.assets[rel].current.perFileSidecar = sidecar.slice(repoRoot.length + 1)
    }
  } else if (typeof meta.sha256 === "string") {
    const actual = createHash("sha256").update(readFileSync(dir)).digest("hex")
    out.assets[rel] = {
      kind: "single",
      locked: { sha256: meta.sha256 },
      current: { sha256: actual },
      match: actual === meta.sha256
    }
  }
}

console.log(JSON.stringify(out, null, 2))

if (process.argv.includes("--write")) {
  for (const [rel, v] of Object.entries(out.assets)) {
    if (v.kind === "tree") {
      lock.assets[rel].fileCount = v.current.fileCount
      lock.assets[rel].treeSha = v.current.treeSha
    } else if (v.kind === "single") {
      lock.assets[rel].sha256 = v.current.sha256
    }
  }
  lock.lockedAt = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z")
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")
  console.error("[recompute-lock] wrote " + lockPath + " lockedAt=" + lock.lockedAt)
}
