// t13 skills-corpus re-pin: recompute assets.skills.fileCount + treeSha with the EXACT
// algorithm scripts/verify-vendor.mjs:69-89 (listFiles, incl. its node_modules / __pycache__
// / .pyc / .pyo skips) and :113-121 (sorted relative paths; sha256 over "relpath\n" +
// sha256(normalized bytes) + "\n" per file; then sha256 of that) uses, and print them.
//
// Read-only with respect to the corpus: it only READS skills/**; the caller applies the
// printed values to VENDOR_LOCK.json.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = "/root/dshProj/my-power-dsh"
const rel = process.argv[2] ?? "skills"
const dir = join(REPO, rel)

// verbatim from verify-vendor.mjs:63-67
function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

// verbatim from verify-vendor.mjs:69-90
function listFiles(dir) {
  if (statSync(dir).isFile()) return [dir]
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

const files = listFiles(dir)
const relative = files.map((f) => f.slice(dir.length + 1)).sort()
const h = createHash("sha256")
for (const f of relative) {
  const fh = createHash("sha256").update(readBytes(join(dir, f))).digest("hex")
  h.update(f + "\n" + fh + "\n")
}
const treeSha = h.digest("hex")

console.log(JSON.stringify({ asset: rel, fileCount: files.length, treeSha }, null, 2))
