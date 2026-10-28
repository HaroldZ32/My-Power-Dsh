// Extract the harness's own `request/header` record (the model-facing tool list) verbatim.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { readSessionEvents } from "../skills/dsh-qa/scripts/lib/session-evidence.ts"
const root: string = process.argv[2] ?? ""
const outDir: string = process.argv[3] ?? ""
const store = readSessionEvents(join(root, "dshhome"), { workspace: join(root, "ws") })
/** Every request/header record in the selected store, in order. */
const headers = store.records.filter((record) => (record as { type?: string }).type === "request/header")
console.log("session store=" + store.file)
console.log("request/header records=" + String(headers.length))
const first = headers[0] as { data?: { header?: { tools?: Array<{ name?: string } | string> } } } | undefined
const tools = first?.data?.header?.tools ?? []
const names = tools.map((tool) => typeof tool === "string" ? tool : String(tool.name ?? ""))
console.log("tools=" + String(names.length) + " cellwork_*=" + JSON.stringify(names.filter((n) => n.startsWith("cellwork_")).sort()))
writeFileSync(join(outDir, "request-header-record.json"), JSON.stringify(headers[0], null, 2) + "\n")
writeFileSync(join(outDir, "request-header-tool-names.txt"), names.slice().sort().join("\n") + "\n")
