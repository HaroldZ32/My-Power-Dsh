#!/usr/bin/env node
// Recompute the `skills` asset fingerprint with the vendor gate's OWN algorithm
// (scripts/verify-vendor.mjs: LF-normalized text, __pycache__/.pyc skipped, sorted
// relpaths, per-file sha256 into the tree hash). Run because this wave edits the
// skills corpus (two QA cases + one new lib helper + SKILL.md), which is exactly the
// single-re-pin condition AGENTS.md §9/§11 describe.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(dirname(dirname(here)))
const dir = join(repoRoot, "skills")

function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}
function listFiles(root) {
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
  walk(root)
  return out
}

const files = listFiles(dir).map((f) => f.slice(dir.length + 1)).sort()
const h = createHash("sha256")
for (const f of files) h.update(f + "\n" + createHash("sha256").update(readBytes(join(dir, f))).digest("hex") + "\n")
console.log(JSON.stringify({ fileCount: files.length, treeSha: h.digest("hex") }, null, 2))
