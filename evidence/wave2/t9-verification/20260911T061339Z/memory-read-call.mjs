#!/usr/bin/env bun
// t9 (Reviewer) memory-migration raw read evidence.
// Drives the SHIPPED mpd-memory plugin dist through its registered tools with a
// real session header cwd = the repo workspace, so the read call resolves the
// SAME root the live session uses (no hand-written file listing).
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { apply as applyMemory } from "/root/dshProj/my-power-dsh/packages/mpd-memory-plugin/dist/index.js"

const here = "/root/dshProj/my-power-dsh/evidence/wave2/t9-verification/20260911T061339Z"
const repoRoot = "/root/dshProj/my-power-dsh"

const registered = new Map()
const ctx = {
  tools: { register: (def) => { registered.set(def.name, def); return () => {} } },
  get: () => undefined,
}
applyMemory(ctx)

const names = [...registered.keys()].sort()
const exec = { agent: { session: { header: { cwd: repoRoot } } } }

const status = registered.get("mpd_memory_status")
const read = registered.get("mpd_memory_read")
if (!status || !read) throw new Error("mpd-memory tools not registered: " + names.join(","))

const statusRes = await status.execute({}, exec)
const allRes = await read.execute({ limit: 40 }, exec)
const queryRes = await read.execute({ query: "workmate", limit: 10 }, exec)

const text = (r) => (typeof r === "string" ? r : JSON.stringify(r))
const entryCount = allRes?.count
const queryCount = queryRes?.count

const MIGRATED = [
  "agentteams-gui-dsh-better-sidebar-agent-teams-si-mtuviju2.md",
  "agentteams-gui-dsh-better-sidebar-mtuyguxk.md",
  "agentteams-scheduler-stall-symptoms-salvage-and--mtva0wbm.md",
  "live-tool-registry-vs-patch-rows-how-to-test-too-mtv8xwzy.md",
  "six-low-findings-closed-and-a-falsifiability-lan-mtw8i46k.md",
  "workmate-rename-delete-agreed-requirements-2026--mtv8l9rl.md",
  "workmate-rename-delete-delivery-closed-two-traps-mtvngffj.md",
]
const files = (allRes?.entries ?? []).map((e) => e.file)
const surfaced = MIGRATED.map((file) => ({ file, surfaced: files.includes(file) }))
const queryFiles = (queryRes?.entries ?? []).map((e) => e.file)
const migratedInQuery = MIGRATED.filter((f) => queryFiles.includes(f))

const out = {
  task: "t9 memory-migration raw read evidence (dist-driven)",
  stamp: new Date().toISOString(),
  registeredTools: names,
  execWorkspace: repoRoot,
  status: text(statusRes),
  allReadEntryCount: entryCount,
  queryWorkmateEntryCount: queryCount,
  migratedSurfaced: surfaced,
  migratedInWorkmateQuery: migratedInQuery,
  allPass: entryCount === 27 && surfaced.every((s) => s.surfaced) && queryCount === 6
    && MIGRATED.filter((f) => f.startsWith("workmate-rename-delete")).every((f) => queryFiles.includes(f)),
  allReadExcerpt: files.slice(0, 4),
}
writeFileSync(join(here, "memory-read-call.result.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ status: out.status, allReadEntryCount: entryCount, queryWorkmateEntryCount: queryCount, migratedSurfaced: surfaced, migratedInWorkmateQuery: migratedInQuery, allPass: out.allPass }, null, 2))
process.exit(out.allPass ? 0 : 1)
