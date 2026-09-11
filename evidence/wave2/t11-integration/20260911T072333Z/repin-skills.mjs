// Wave-2 t11: recompute the `skills` asset fingerprint with verify-vendor.mjs's OWN algorithm
// (sorted relpath + per-file sha256, CRLF-normalized for text files) after the mcp-call edit.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = process.cwd()
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
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

const rel = process.argv[2] ?? "skills"
const meta = lock.assets[rel]
const dir = join(repoRoot, rel)
const files = listFiles(dir)
const rels = files.map((f) => f.slice(dir.length + 1)).sort()
const h = createHash("sha256")
for (const f of rels) h.update(f + "\n" + createHash("sha256").update(readBytes(join(dir, f))).digest("hex") + "\n")
const treeSha = h.digest("hex")
const before = { fileCount: meta.fileCount, treeSha: meta.treeSha }
meta.fileCount = rels.length
meta.treeSha = treeSha
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")
console.log(JSON.stringify({ asset: rel, before, after: { fileCount: meta.fileCount, treeSha }, changed: before.fileCount !== meta.fileCount || before.treeSha !== treeSha }, null, 1))
