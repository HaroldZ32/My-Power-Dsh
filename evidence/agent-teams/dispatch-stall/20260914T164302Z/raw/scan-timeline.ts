#!/usr/bin/env node
// Decode the harness session logs of the LIVE stalled team (mpd-default,
// approved 2026-09-14T16:36:46.809Z) and print a timeline of the events that
// matter for the dispatch stall: turns, inbox splices, and the scheduler's own
// assignment prompt. Read-only: never writes session or team state.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import zlib from "node:zlib"

const SESSIONS = "/root/.dsh/sessions/--root-dshProj-my-power-dsh--"
const ASSIGNMENT_MARKER = "AgentTeams automatic task assignment"
const MEMBERS = {
  Captain: "session-dd12f72e-348d-4742-b7be-3f9c104a425e",
  Architect: "76a59b68-50a7-4e44-8e43-f356607802a9",
  Reviewer: "3fb17f89-6da3-4236-abe8-b754938fe8a3",
  Lead: "246ef4bb-1e90-48d1-9fdc-1f2aeeca2145",
  "Deep Worker": "8b59473c-b8c9-4fce-a448-a99fed464794",
  "Senior Engineer": "e9f82257-6fd2-443d-bd5c-dfb139214dee",
  "Junior Engineer": "16373694-57f8-490e-91d6-3fa5a6e2c253",
}

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decode(path) {
  const buf = readFileSync(path)
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) {
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length))) } catch { /* partial tail */ }
  }
  return Buffer.concat(parts).toString("utf8")
}

function events(name) {
  const dir = join(SESSIONS, MEMBERS[name])
  const file = join(dir, "session.v3.jsonl.zstd")
  if (!existsSync(file)) return { name, missing: true, rows: [] }
  const rows = []
  for (const line of decode(file).split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try { rows.push(JSON.parse(trimmed)) } catch { /* partial */ }
  }
  return { name, missing: false, rows }
}

function tsOf(row) {
  const t = row?.time ?? row?.ts ?? row?.data?.ts ?? row?.data?.at
  return typeof t === "number" ? new Date(t).toISOString() : String(t ?? "?")
}

const only = process.argv[2]
const summary = {}
for (const name of Object.keys(MEMBERS)) {
  if (only !== undefined && only !== name) continue
  const { rows, missing } = events(name)
  const interesting = []
  for (const row of rows) {
    const type = row.type ?? row.kind ?? "?"
    if (!/turn\/(start|end)|agent\/inbox|request\/header|agent\/status|session\/start/.test(String(type))) continue
    const data = row.data ?? {}
    interesting.push({ type, ts: tsOf(row), turn: data.turn, reason: data.reason?.kind, delivery: data.delivery, inserted: Array.isArray(data.inserted) ? data.inserted.length : undefined, removedCount: data.removedCount })
  }
  const assignmentRows = rows.filter((row) => JSON.stringify(row).includes(ASSIGNMENT_MARKER))
  summary[name] = {
    missing,
    rowCount: rows.length,
    turns: interesting.filter((i) => i.type === "turn/start").length,
    timeline: interesting,
    assignmentHits: assignmentRows.map((row) => ({ type: row.type, ts: tsOf(row) })),
    firstEventTs: rows.length > 0 ? tsOf(rows[0]) : undefined,
    lastEventTs: rows.length > 0 ? tsOf(rows[rows.length - 1]) : undefined,
  }
}
console.log(JSON.stringify(summary, null, 2))
