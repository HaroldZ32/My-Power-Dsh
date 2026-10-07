#!/usr/bin/env node
// Machine-generate the t2 evidence summary from the ledger + per-composition
// result.json, so no number in the write-up is transcribed by hand.
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = process.argv[2]
if (!OUT_ROOT) { console.error("usage: summarize.mjs <evidence-dir>"); process.exit(2) }
const ledger = JSON.parse(readFileSync(join(OUT_ROOT, "ledger.json"), "utf8"))

console.log("## Ledger (author-run, ADVISORY)")
console.log("")
console.log("| composition | expectation | guard decision | sidebar rows in the entry list (last probe) | fatal signatures | HTTP | boot log sha256 | measured_at_utc |")
console.log("|---|---|---|---|---|---|---|---|")
for (const [name, meta] of Object.entries(ledger.compositions)) {
  const r = JSON.parse(readFileSync(join(OUT_ROOT, name, "result.json"), "utf8"))
  const guard = r.verdict?.guard_decisions?.join(" / ") ?? "-"
  const rows = r.verdict?.sidebar_rows_in_entry_list?.join(", ") ?? "-"
  const fatal = r.verdict?.fatal_signatures?.length ? r.verdict.fatal_signatures.join(", ") : "none"
  const http = r.http?.attempted
    ? `index ${r.http.index?.status} (${r.http.index?.bytes}B), sidebar client ${r.http.probes?.[0]?.status ?? "-"} (${r.http.probes?.[0]?.bytes ?? 0}B), /sidebar/api ${r.http.sidebarApi?.status}`
    : (r.paneChars ? `TUI pane ${r.paneChars} chars` : "-")
  console.log(`| ${name} | ${r.expectation} | ${guard} | ${rows} | ${fatal} | ${http} | ${(r.log_sha256 ?? "-").slice(0, 16)}… | ${r.measured_at_utc} |`)
}
console.log("")
console.log("## Source revision under test (sha256 read at the UTC instant shown)")
console.log("")
console.log("| path | sha256 | read_at_utc |")
console.log("|---|---|---|")
for (const [p, h] of Object.entries(ledger.source_hashes)) console.log(`| ${p} | ${h.sha256} | ${h.read_at_utc} |`)
console.log("")
console.log("ledger.at_utc = " + ledger.at_utc + "; kind = " + ledger.kind)
