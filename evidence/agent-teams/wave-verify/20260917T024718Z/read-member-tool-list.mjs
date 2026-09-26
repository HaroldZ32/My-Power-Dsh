#!/usr/bin/env bun
// read-member-tool-list.mjs — t25: the T-49 mount claim, asserted from the HARNESS's own records:
// `request/header.data.header.tools[]` is tool-list evidence (AGENTS.md §7). Decode both session logs,
// take every request header, and report which tool names each seat was ADVERTISED.
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const HERE = import.meta.dir, REPO = "/root/dshProj/my-power-dsh"
const lib = await import(pathToFileURL(join(REPO, "skills/dsh-qa/scripts/lib/session-evidence.mjs")).href)
const root = join(HERE, "raw", "sessions")
const out = []
for (const proj of readdirSync(root)) for (const id of readdirSync(join(root, proj))) {
  const f = join(root, proj, id, "session.v3.jsonl.zstd")
  try { statSync(f) } catch { continue }
  const d = lib.decodeSessionLog(f)
  const records = []
  for (const line of d.text.split("\n")) { const t = line.trim(); if (t) { try { records.push(JSON.parse(t)) } catch {} } }
  const headers = records.filter((r) => r?.type === "request/header")
  const lists = headers.map((h) => (h?.data?.header?.tools ?? []).map((t) => String(t?.name ?? t?.function?.name ?? t)))
  const last = lists[lists.length - 1] ?? []
  out.push({
    session: id, records: records.length, headers: headers.length, advertised: last.length,
    hasContractTool: last.includes("agent_teams_task_contract"),
    hasApprove: last.includes("agent_teams_approve"),
    hasBash: last.includes("bash"), hasWrite: last.includes("write"), hasEdit: last.includes("edit"),
    sample: last.slice(0, 8),
  })
}
console.log(JSON.stringify(out, null, 2))
const member = out.find((s) => s.advertised > 0 && s.advertised < 100 && !s.hasApprove)
const ok = member !== undefined && member.hasContractTool && !member.hasBash && !member.hasWrite && !member.hasEdit
console.log("[read-member-tool-list] read-only seat advertised=" + (member?.advertised ?? 0) + " contractTool=" + (member?.hasContractTool ?? false) + " noWriteTools=" + (member ? (!member.hasBash && !member.hasWrite && !member.hasEdit) : false))
process.exit(ok ? 0 : 1)
