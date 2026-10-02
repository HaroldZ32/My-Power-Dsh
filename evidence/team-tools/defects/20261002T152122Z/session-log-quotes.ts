// The LIVE evidence, quoted from the harness's own session log — the "red" this lane repairs was
// measured in a real session, and this script prints exactly the lines that recorded it:
//   * the four harness refusals and the two "not held" answers (defects 1, 2, 3);
//   * the ARGUMENTS of every `agent_teams_plan action:"create_task"` call (defects 4 and 5), which is
//     what shows the owner/blocked_by spelling the caller used and the tool did not read.
// Read-only: it decodes the log through the repo's own QA helper and prints.
import { decodeSessionLog } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

/** The captain session whose log recorded every defect. */
const LOG = "/home/haroldzhao/.dsh/sessions/--home-haroldzhao-MyProj-DshProj-My-Power-Dsh--/b6963085-59c4-480e-b64f-f81af1e5e28c/session.v4.jsonl.zstd"

const decoded = decodeSessionLog(LOG)
/** Every decoded record, parsed with a total fallback so a torn tail cannot abort the dump. */
const records: Array<Record<string, any>> = []
for (const line of decoded.text.split("\n")) {
  if (line.trim() === "") continue
  try {
    records.push(JSON.parse(line))
  } catch {
    // a torn tail line carries no record
  }
}

console.log(`session log frames=${decoded.frames} records=${records.length}`)
console.log("\n== the harness's own refusals and answers (defects 1, 2, 3) ==")
for (const seq of [154, 211, 213, 218, 219, 236, 237, 242, 243]) {
  /** The record at that sequence number. */
  const record = records.find((candidate) => candidate.seq === seq)
  if (record === undefined) {
    console.log(`seq ${seq}: (absent)`)
    continue
  }
  if (record.type === "tool/call") {
    console.log(`seq ${seq} CALL   ${record.data.name} ${JSON.stringify(record.data.arguments)}`)
    continue
  }
  /** The text blocks the result carried. */
  const text = (record.data?.message?.content ?? []).map((block: any) => (typeof block?.text === "string" ? block.text : JSON.stringify(block))).join(" | ")
  console.log(`seq ${seq} RESULT ${text.slice(0, 200)}`)
}

console.log("\n== every agent_teams_plan create_task ARGUMENT (defects 4, 5) ==")
for (const record of records) {
  if (record.type !== "tool/call" || record.data?.name !== "agent_teams_plan") continue
  /** The call's arguments, parsed from the recorded JSON string. */
  let args: any
  try {
    args = JSON.parse(record.data.arguments)
  } catch {
    continue
  }
  if (args?.action !== "create_task") continue
  console.log(`seq ${record.seq}: top-level keys=[${Object.keys(args).join(",")}] task keys=[${Object.keys(args.task ?? {}).join(",")}] top owner=${JSON.stringify(args.owner)} top blocked_by=${JSON.stringify(args.blocked_by)} nested owner=${JSON.stringify(args.task?.owner)}`)
}
