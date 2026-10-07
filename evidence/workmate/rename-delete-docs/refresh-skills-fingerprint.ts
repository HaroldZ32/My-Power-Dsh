#!/usr/bin/env node
// Refresh the VENDOR_LOCK.json fingerprint of the vendored `skills` tree after a
// skills/** edit (AGENTS.md §9 / contract §R3): recompute fileCount + treeSha with the
// gate's OWN algorithm — verify-vendor.mjs `readBytes` (LF-normalised text, raw binary)
// over the sorted relative paths — then write the lock and print old/new.
//
// Usage: node evidence/workmate/rename-delete-docs/refresh-skills-fingerprint.mjs [--write]
// Default is a dry run (prints the recomputed values, changes nothing).
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const lockPath = join(repoRoot, "VENDOR_LOCK.json")
const write = process.argv.includes("--write")

/** Byte-for-byte the same normalisation verify-vendor.mjs uses. */
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
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

function treeSha(dir) {
  const files = listFiles(dir).map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  for (const f of files) {
    const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
    h.update(f + "\n" + fh + "\n")
  }
  return { fileCount: files.length, treeSha: h.digest("hex") }
}

const dir = join(repoRoot, "skills")
const lock = JSON.parse(readFileSync(lockPath, "utf8"))
const prev = lock.assets.skills
const next = treeSha(dir)
console.log("skills fileCount:", prev.fileCount, "->", next.fileCount)
console.log("skills treeSha:  ", prev.treeSha)
console.log("skills treeSha:  ", next.treeSha)
if (!write) {
  console.log("[dry-run] nothing written (pass --write to update VENDOR_LOCK.json)")
  process.exit(0)
}
lock.assets.skills.fileCount = next.fileCount
lock.assets.skills.treeSha = next.treeSha
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")
console.log("[written] " + lockPath)
