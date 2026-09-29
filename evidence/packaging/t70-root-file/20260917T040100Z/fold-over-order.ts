#!/usr/bin/env node
// Reconcile a fold value by RE-DERIVING it over an externally supplied ordering (2026-09-17).
// The question this answers: does the shell form's value come from the same fold algorithm run
// over a different ORDER, or from a different record composition?
// usage: node fold-over-order.mjs <tree> <order-file>      (order-file = one relpath per line)
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const [tree, orderFile] = process.argv.slice(2)
const rels = readFileSync(orderFile, "utf8").trim().split("\n")
const h = createHash("sha256")
for (const rel of rels) {
  h.update(rel)
  h.update("\0")
  h.update(createHash("sha256").update(readFileSync(join(tree, rel))).digest("hex"))
  h.update("\n")
}
console.log("tree       :", tree)
console.log("order file :", orderFile)
console.log("records    :", rels.length)
console.log("first 3    :", JSON.stringify(rels.slice(0, 3)))
console.log("fold       :", h.digest("hex"))
console.log("targets    : 4131137d51d65b4255a6251c0f5af6294c1b447c2b8114156fe808e21cb5fb0f (byte/C order)")
console.log("             d30f7d19831d2fd6a3835c207ef508529ca574b4d9577bdc539b6970e0f13318 (mine, shell default locale)")
