import { existsSync, readFileSync } from "node:fs"
import zlib from "node:zlib"
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function decompressAll(buf) {
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) { try { parts.push(zlib.zstdDecompressSync(buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length))) } catch {} }
  return Buffer.concat(parts).toString("utf8")
}
const [path, pattern, win] = process.argv.slice(2)
const s = decompressAll(readFileSync(path))
const re = new RegExp(pattern, "g")
const n = Number(win ?? 300)
let m, count = 0
while ((m = re.exec(s)) && count < 12) { count++; console.log("---\n" + s.slice(Math.max(0, m.index - n), m.index + n).replace(/\\n/g, "\n")) }
console.log("total matches:", (s.match(re) ?? []).length)
