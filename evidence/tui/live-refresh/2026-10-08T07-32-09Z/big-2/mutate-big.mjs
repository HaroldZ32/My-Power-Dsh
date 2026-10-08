// Flip two statuses and append one task on the BIG board: a change no renderer can miss.
import { readFileSync, writeFileSync } from "node:fs"
const [file, mode] = process.argv.slice(2)
const record = JSON.parse(readFileSync(file, "utf8"))
const now = new Date().toISOString()
const byId = new Map(record.tasks.map((t) => [t.id, t]))
if (mode === "big1") {
  for (const [id, status] of [["B07", "completed"], ["B08", "in_progress"], ["F03", "completed"]]) {
    const task = byId.get(id); task.status = status; task.updatedAt = now; task.revision = (task.revision ?? 1) + 1
  }
  record.tasks.push({ id: "F11", subject: "LiveProbe: appended on the big board (phase 1)", description: "Acceptance: appended", kind: "work", status: "pending", blockedBy: ["B03"], writeScopes: [], createdAt: now, updatedAt: now, revision: 1, owner: "ui-worker" })
} else {
  for (const [id, status] of [["B09", "in_progress"], ["F04", "in_progress"]]) {
    const task = byId.get(id); task.status = status; task.updatedAt = now; task.revision = (task.revision ?? 1) + 1
  }
  record.tasks.push({ id: "F12", subject: "LiveProbe: appended on the big board (phase 2)", description: "Acceptance: appended", kind: "integration", status: "pending", blockedBy: ["B04"], writeScopes: [], createdAt: now, updatedAt: now, revision: 1 })
}
writeFileSync(file, JSON.stringify(record, null, 2))
process.stdout.write(`${mode}: tasks=${record.tasks.length}\n`)
