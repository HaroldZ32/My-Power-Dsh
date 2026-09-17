#!/usr/bin/env node
// Fold reconciliation for the pre-registered 1,190-file value (2026-09-17).
// qa-lane-engineer's algorithm, verbatim in shape:
//   const h = crypto.createHash("sha256")
//   for (const rel of rels) { h.update(rel); h.update("\0"); h.update(sha256hex(file)); h.update("\n") }
//   h.digest("hex")   // they report 4131137d51d65b4255a6251c0f5af6294c1b447c2b8114156fe808e21cb5fb0f
// This script computes it with TWO orderings (JS default sort vs byte order) so the source of any
// difference is named rather than guessed, and prints the first/last paths and the count so the
// FILE SET is checkable too.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const root = process.argv[2] ?? "dist/mpd-package"
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.isFile()) out.push(relative(root, full).split(sep).join("/"))
    else if (e.isSymbolicLink()) out.push(relative(root, full).split(sep).join("/"))
  }
  return out
}
const rels = walk(root)
const fold = (order) => {
  const h = createHash("sha256")
  for (const rel of order) {
    h.update(rel)
    h.update("\0")
    h.update(createHash("sha256").update(readFileSync(join(root, rel))).digest("hex"))
    h.update("\n")
  }
  return h.digest("hex")
}
const jsOrder = [...rels].sort()
const byteOrder = [...rels].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))

console.log("root           :", root)
console.log("file count     :", rels.length)
console.log("first 3 (js)   :", JSON.stringify(jsOrder.slice(0, 3)))
console.log("last 3  (js)   :", JSON.stringify(jsOrder.slice(-3)))
console.log("orders differ  :", JSON.stringify(jsOrder) !== JSON.stringify(byteOrder))
console.log("fold js sort   :", fold(jsOrder))
console.log("fold byte sort :", fold(byteOrder))
console.log("target (theirs): 4131137d51d65b4255a6251c0f5af6294c1b447c2b8114156fe808e21cb5fb0f")
console.log("target (mine)  : d30f7d19831d2fd6a3835c207ef508529ca574b4d9577bdc539b6970e0f13318")
