import { readFileSync } from "node:fs"
import zlib from "node:zlib"
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
export function readSession(path) {
  const buf = readFileSync(path)
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) {
    const seg = buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length)
    try { parts.push(zlib.zstdDecompressSync(seg)) } catch { /* partial tail frame */ }
  }
  return Buffer.concat(parts).toString("utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
if (process.argv[2]) {
  const events = readSession(process.argv[2])
  const t = (ms) => new Date(ms).toISOString().slice(11, 19)
  for (const e of events) {
    const time = e.time ?? e.data?.time ?? 0
    if (e.type === "user/message") {
      const d = e.data ?? {}
      const text = typeof d.content === "string" ? d.content : JSON.stringify(d.content ?? d)
      console.log(`[${t(time)}] user/message kind=${d.kind ?? d.source ?? "?"} :: ${text.slice(0, 500).replace(/\n/g, " ⏎ ")}`)
    } else if (e.type === "tool/call") {
      const d = e.data ?? {}
      console.log(`[${t(time)}] tool/call ${d.name} :: ${JSON.stringify(d.arguments ?? {}).slice(0, 300)}`)
    } else if (e.type === "turn/start" || e.type === "turn/end") {
      console.log(`[${t(time)}] ${e.type} ${JSON.stringify(e.data ?? {}).slice(0, 120)}`)
    }
  }
}
