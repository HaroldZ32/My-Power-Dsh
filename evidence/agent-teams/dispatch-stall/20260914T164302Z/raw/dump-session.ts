#!/usr/bin/env node
// Dump the user-facing message text (and tool calls) of one session, filtered
// by turn, so a delivered assignment prompt can be attributed to the turn that
// carried it. Read-only.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import zlib from "node:zlib"

const SESSIONS = "/root/.dsh/sessions/--root-dshProj-my-power-dsh--"
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decode(path) {
  const buf = readFileSync(path)
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) {
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length))) } catch { /* tail */ }
  }
  return Buffer.concat(parts).toString("utf8")
}

const id = process.argv[2]
const turnFilter = process.argv[3] === undefined ? undefined : Number(process.argv[3])
const limit = process.argv[4] === undefined ? 700 : Number(process.argv[4])
const rows = []
for (const line of decode(join(SESSIONS, id, "session.v3.jsonl.zstd")).split("\n")) {
  const t = line.trim()
  if (t === "") continue
  try { rows.push(JSON.parse(t)) } catch { /* partial */ }
}
for (const row of rows) {
  const type = row.type
  if (!/user\/message|tool\/call|turn\/(start|end)|agent\/inbox/.test(String(type))) continue
  const data = row.data ?? {}
  if (turnFilter !== undefined && data.turn !== undefined && data.turn !== turnFilter) continue
  const when = new Date(row.time).toISOString()
  if (type === "user/message") {
    const text = JSON.stringify(data.content ?? data)
    console.log(`\n### ${when} user/message turn=${data.turn ?? "?"}\n${text.slice(0, limit)}`)
  } else if (type === "tool/call") {
    const args = String(data.arguments ?? "")
    console.log(`${when} tool/call ${data.name} ${args.slice(0, 120)}`)
  } else if (type === "turn/start" || type === "turn/end") {
    console.log(`${when} ${type} turn=${data.turn} ${data.reason?.kind ?? ""}`)
  } else if (type === "agent/inbox/spliced" && Array.isArray(data.inserted) && data.inserted.length > 0) {
    const first = data.inserted[0]
    console.log(`${when} inbox+ ${String(first?.source?.kind ?? first?.kind ?? "")}`)
  }
}
