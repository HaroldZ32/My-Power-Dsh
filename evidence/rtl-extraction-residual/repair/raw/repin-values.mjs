// Compute the values verify-vendor.mjs checks, using its own algorithm (readBytes LF
// normalization + sorted relative paths + "path\nsha\n" fold), so the single re-pin is
// derived rather than hand-written. Verification is the gate itself: it must exit 0 after.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
const repoRoot = "/root/dshProj/my-power-dsh"
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
const dir = join(repoRoot, "skills")
const files = listFiles(dir)
const files2 = files.map((f) => f.slice(dir.length + 1)).sort()
const h = createHash("sha256")
for (const f of files2) h.update(f + "\n" + createHash("sha256").update(readBytes(join(dir, f))).digest("hex") + "\n")
console.log(JSON.stringify({ skills: { fileCount: files.length, treeSha: h.digest("hex") } }, null, 2))
