import { readdirSync, existsSync, readFileSync } from "node:fs"
import zlib from "node:zlib"
const base = "/root/.dsh/sessions/--root-dshProj-my-power-dsh--"
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function decompressAll(buf) {
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) {
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length))) } catch { /* tail */ }
  }
  return Buffer.concat(parts).toString("utf8")
}
let hits = 0, total = 0
for (const d of readdirSync(base)) {
  const p = `${base}/${d}/session.jsonl.zstd`
  if (!existsSync(p)) continue
  total++
  let s
  try { s = decompressAll(readFileSync(p)) } catch { continue }
  const a = (s.match(/AgentTeams automatic task assignment/g) ?? []).length
  const b = (s.match(/AgentTeams delivered messages that were persisted/g) ?? []).length
  const c = (s.match(/You have joined the team/g) ?? []).length
  const f = (s.match(/followup to member/g) ?? []).length
  if (a || b || c || f) { hits++; console.log(`${d.slice(0, 20)} assignments=${a} mailFallback=${b} join=${c} followupWarn=${f}`) }
}
console.log(`scanned ${total} sessions; ${hits} with team traffic`)
