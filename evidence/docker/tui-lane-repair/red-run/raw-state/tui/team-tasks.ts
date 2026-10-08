// One `<id>\t<subject>` line per task in the lane's OWN team fixture: the assertions below read their
// expected values from the record, so no literal can stand in for a value the record does not carry.
import { readFileSync } from "node:fs"
const [recordPath] = process.argv.slice(2)
const record = JSON.parse(readFileSync(recordPath, "utf8"))
for (const task of record.tasks ?? []) process.stdout.write(`${task.id}\t${task.subject ?? ""}\n`)
