// T11 n=15: the `depend` card renders a bare blocker-id STRING in `added` as the id, not an empty row.
import { agentTeamsTaskCard } from "../../../../packages/mpd-team-core-plugin/src/tool-cards.ts"
const bare = agentTeamsTaskCard({ action: "depend" }, { action: "depend", added: ["T9"] })
const rowsOf = (view: unknown): unknown[] => {
  const out: unknown[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== "object" || node === null) return
    const record = node as Record<string, unknown>
    if (record.type === "table" && Array.isArray(record.rows)) out.push(...record.rows)
    for (const key of ["children", "items"]) if (Array.isArray(record[key])) record[key].forEach(walk)
  }
  walk(view)
  return out
}
const rows = rowsOf(bare)
const recordRows = rowsOf(agentTeamsTaskCard({ action: "depend" }, { action: "depend", added: [{ id: "T9", subject: "Ship it" }] }))
const verdict = { bareRows: rows, bareShowsId: JSON.stringify(rows).includes("T9"), recordRows, recordShowsBoth: JSON.stringify(recordRows).includes("T9") && JSON.stringify(recordRows).includes("Ship it") }
console.log(JSON.stringify(verdict, null, 1))
if (!verdict.bareShowsId || !verdict.recordShowsBoth) throw new Error("n=15 behavioural check failed")
