// Mutate the seeded team record IN PLACE: flip statuses and append a task, so the drawn board and any
// task count must both change. Usage: node mutate.mjs <record.json> <mode>
import { readFileSync, writeFileSync } from "node:fs"
const [file, mode] = process.argv.slice(2)
const record = JSON.parse(readFileSync(file, "utf8"))
const byId = new Map(record.tasks.map((t) => [t.id, t]))
const now = new Date().toISOString()
const flip = (id, status, extra = {}) => {
  const task = byId.get(id)
  if (task === undefined) throw new Error(`no task ${id}`)
  task.status = status; task.updatedAt = now; task.revision = (task.revision ?? 1) + 1; Object.assign(task, extra)
}
const append = (id, subject, opts = {}) => {
  record.tasks.push({
    id, subject, description: `Acceptance: ${subject}`, kind: opts.kind ?? "work", status: opts.status ?? "pending",
    blockedBy: opts.blockedBy ?? [], writeScopes: [], createdAt: now, updatedAt: now, revision: 1, ...(opts.owner ? { owner: opts.owner } : {}),
  })
}
if (mode === "scene") {
  flip("T2", "completed")
  flip("T4", "pending", { verdict: undefined })
  append("T7", "LiveProbe: appended while the SCENE was open", { blockedBy: ["T6"], owner: "ui-reviewer" })
} else if (mode === "panel") {
  flip("T4", "completed")
  flip("T6", "in_progress", { owner: "web-team-gui" })
  append("T8", "LiveProbe: appended while the SIDEBAR was open", { blockedBy: ["T7"], kind: "integration" })
} else { throw new Error(`unknown mode ${mode}`) }
writeFileSync(file, JSON.stringify(record, null, 2))
process.stdout.write(`${mode}: tasks=${record.tasks.length} ${record.tasks.map((t) => t.id + ":" + t.status).join(" ")}\n`)
