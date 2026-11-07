// Throwaway diagnostic (never shipped): decode every surviving session log from the
// interrupted model-config-live-refresh sandbox and print the routing evidence the harness
// itself recorded — request headers (config.model), subagent descriptors, and tool calls.
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { decodeSessionLog } from "../../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

const root = process.argv[2]
if (root === undefined) throw new Error("usage: probe-routing.ts <DSH_HOME>")
const keys = readdirSync(join(root, "sessions"))
for (const key of keys) {
  const keyDir = join(root, "sessions", key)
  for (const id of readdirSync(keyDir)) {
    const file = join(keyDir, id, "session.v4.jsonl.zstd")
    let decoded
    try {
      decoded = decodeSessionLog(file)
    } catch (error) {
      console.log("SKIP " + id + " " + String(error))
      continue
    }
    const records = decoded.text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
    console.log("\n=== SESSION " + id + " frames=" + decoded.frames + " records=" + records.length)
    for (const record of records) {
      const type = String(record.type ?? "")
      const data = record.data ?? {}
      if (type === "request/header") {
        const header = data.header ?? {}
        const config = header.config ?? {}
        console.log("  request/header: model=" + String(config.model) + " provider=" + String(config.provider) + " effort=" + String(config.reasoningEffort))
      } else if (type === "subagent/descriptor") {
        console.log("  subagent/descriptor: " + JSON.stringify(data).slice(0, 400))
      } else if (type === "tool/call") {
        console.log("  tool/call: " + String(data.name) + " args=" + JSON.stringify(data.arguments ?? data.input ?? "").slice(0, 200))
      } else if (type === "tool/result") {
        console.log("  tool/result: " + JSON.stringify(data).slice(0, 300))
      } else if (type === "user/message") {
        const text = JSON.stringify(data).slice(0, 220)
        console.log("  user/message: " + text)
      }
    }
  }
}
