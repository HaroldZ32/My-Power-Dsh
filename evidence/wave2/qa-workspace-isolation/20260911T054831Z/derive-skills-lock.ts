// B9-style re-pin helper for VENDOR_LOCK.assets.skills (t7 owns this wave's single
// skills re-pin). The treeSha/fileCount algorithm below is copied VERBATIM from
// scripts/verify-vendor.mjs (listFiles + readBytes + the sorted `relpath\nfileSha\n`
// hash chain) so the value is derived with the gate's own algorithm, never by hand.
//
// Usage: node .qa-reloc/t7/derive-skills-lock.mjs [assetRelPath]
// Prints { fileCount, treeSha } for the asset — paste into VENDOR_LOCK.json.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const rel = process.argv[2] ?? "skills"
const dir = join(repoRoot, rel)

function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

function listFiles(root) {
  if (statSync(root).isFile()) return [root]
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (entry === "node_modules") continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(root)
  return out
}

const files = listFiles(dir)
const rels = files.map((f) => f.slice(dir.length + 1)).sort()
const h = createHash("sha256")
for (const f of rels) {
  const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
  h.update(f + "\n" + fh + "\n")
}
console.log(JSON.stringify({ asset: rel, fileCount: files.length, treeSha: h.digest("hex") }, null, 2))
