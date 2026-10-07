#!/usr/bin/env bun
// read-session-store.mjs — t25: decode EVERY session log in the mount's own store with the QA
// library's frame-by-frame reader (AGENTS.md §7: a tool call is proven from the HARNESS's log, never
// from a driver's summary), and assert the read-only member really called
// `agent_teams_task_contract` with a NON-ERROR result.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const HERE = import.meta.dir
const REPO = "/root/dshProj/my-power-dsh"
const lib = await import(pathToFileURL(join(REPO, "skills/dsh-qa/scripts/lib/session-evidence.mjs")).href)

const root = join(HERE, "raw", "sessions")
const files = []
for (const proj of readdirSync(root)) {
  for (const id of readdirSync(join(root, proj))) {
    const f = join(root, proj, id, "session.v3.jsonl.zstd")
    try { files.push({ id, file: f, bytes: statSync(f).size }) } catch { /* no log */ }
  }
}
const sessions = []
for (const entry of files) {
  const decoded = lib.decodeSessionLog(entry.file)
  const records = []
  for (const line of decoded.text.split("\n")) {
    const t = line.trim(); if (t === "") continue
    try { records.push(JSON.parse(t)) } catch { /* undecodable line */ }
  }
  const calls = records.filter((r) => r?.type === "tool/call")
  const results = records.filter((r) => r?.type === "tool/result")
  const contractCall = calls.find((r) => String(r?.data?.name ?? "") === "agent_teams_task_contract")
  const contractResult = contractCall === undefined ? undefined
    : results.find((r) => String(r?.data?.callId ?? "") === String(contractCall?.data?.callId ?? ""))
  sessions.push({
    id: entry.id, bytes: entry.bytes, frames: decoded.frames, records: records.length,
    toolCalls: [...new Set(calls.map((r) => String(r?.data?.name ?? "")))],
    hasContractCall: contractCall !== undefined,
    contractResultFound: contractResult !== undefined,
    contractResultIsError: contractResult === undefined ? null : Boolean(contractResult?.data?.isError),
  })
}
sessions.sort((a, b) => b.records - a.records)
const report = { files: files.length, sessions }
console.log(JSON.stringify(report, null, 2))
const hitting = sessions.filter((s) => s.hasContractCall)
const ok = hitting.length > 0 && hitting.every((s) => s.contractResultFound && s.contractResultIsError === false)
console.log("[read-session-store] contract tool call in " + hitting.length + " session(s); non-error result: " + ok)
process.exit(ok ? 0 : 1)
