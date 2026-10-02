// Throwaway recon: dump every `agent_teams_plan` tool call's ARGUMENTS from the live captain session
// log, so "did the model actually send owner/blocked_by?" is answered from harness-recorded evidence
// rather than from either side's prose. Read-only: it writes nothing and only prints.
import { decodeSessionLog } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

/** The captain session log decoded above. */
const LOG = "/home/haroldzhao/.dsh/sessions/--home-haroldzhao-MyProj-DshProj-My-Power-Dsh--/b6963085-59c4-480e-b64f-f81af1e5e28c/session.v4.jsonl.zstd"

/** One decoded JSONL line, parsed with a total fallback so a torn tail cannot abort the dump. */
function parseLine(line: string): Record<string, unknown> | undefined {
  if (line.trim() === "") return undefined
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const decoded = decodeSessionLog(LOG)
console.log(`frames=${decoded.frames} tornStart=${String(decoded.tornStart)} chars=${decoded.text.length}`)

/** Plan-tool calls with their recorded arguments, in log order. */
const calls: Array<{ type: string; args: unknown }> = []
for (const line of decoded.text.split("\n")) {
  const record = parseLine(line)
  if (record === undefined) continue
  const data = record["data"] as Record<string, unknown> | undefined
  if (data === undefined) continue
  if (data["name"] === "agent_teams_plan" && typeof data["arguments"] === "object" && data["arguments"] !== null) {
    calls.push({ type: String(record["type"] ?? ""), args: data["arguments"] })
  }
  // The plan tool result, which carries the plan JSON the tool returned.
  const message = data["message"] as { content?: Array<Record<string, unknown>> } | undefined
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      if (block["toolCallId"] !== undefined && typeof block["text"] === "string" && block["text"].includes("planId")) {
        const text = block["text"] as string
        if (text.includes("W2-T") || text.includes("W1-T")) calls.push({ type: "RESULT", args: text.slice(0, 400) })
      }
    }
  }
}

console.log(`plan-call-like records: ${calls.length}`)
for (const [index, call] of calls.entries()) {
  const serialised = JSON.stringify(call.args)
  console.log(`--- ${index} ${call.type} ---`)
  console.log(serialised.length > 1800 ? serialised.slice(0, 1800) + "…" : serialised)
}
