#!/usr/bin/env node
// Extract the captain's tool calls (name + timestamp + a short argument digest)
// from the harness session log, so the stall window around the approval can be
// reconstructed against the members' turn timeline. Read-only.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import zlib from "node:zlib"

const SESSIONS = "/root/.dsh/sessions/--root-dshProj-my-power-dsh--"
const CAPTAIN = "session-dd12f72e-348d-4742-b7be-3f9c104a425e"
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

const rows = []
for (const line of decode(join(SESSIONS, CAPTAIN, "session.v3.jsonl.zstd")).split("\n")) {
  const t = line.trim()
  if (t === "") continue
  try { rows.push(JSON.parse(t)) } catch { /* partial */ }
}

const from = process.argv[2] ?? "2026-09-14T16:34:00.000Z"
const to = process.argv[3] ?? "2026-09-14T16:45:00.000Z"
const fromMs = Date.parse(from), toMs = Date.parse(to)
const out = []
for (const row of rows) {
  const ts = row.time ?? row.ts ?? row.data?.ts
  const ms = typeof ts === "number" ? ts : Date.parse(String(ts))
  if (!Number.isFinite(ms) || ms < fromMs || ms > toMs) continue
  const type = row.type ?? "?"
  if (!/tool\/(call|result)|turn\/(start|end)|user\/message|agent\/inbox/.test(String(type))) continue
  const data = row.data ?? {}
  let digest = ""
  if (type === "tool/call") {
    const args = data.arguments ?? data.args ?? {}
    const s = JSON.stringify(args)
    digest = `${data.name ?? "?"} ${s.length > 260 ? s.slice(0, 260) + "…" : s}`
  } else if (type === "tool/result") {
    const s = JSON.stringify(data.result ?? data.value ?? data)
    digest = s.length > 160 ? s.slice(0, 160) + "…" : s
  } else if (type === "user/message") {
    const s = JSON.stringify(data.content ?? data)
    digest = s.length > 160 ? s.slice(0, 160) + "…" : s
  } else {
    digest = `turn=${data.turn ?? ""} reason=${data.reason?.kind ?? ""} ins=${Array.isArray(data.inserted) ? data.inserted.length : ""}`
  }
  out.push(`${new Date(ms).toISOString()} ${type} ${digest}`)
}
console.log(out.join("\n"))
