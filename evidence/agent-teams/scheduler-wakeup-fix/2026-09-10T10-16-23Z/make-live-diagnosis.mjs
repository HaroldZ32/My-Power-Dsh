// Rebuild the live diagnosis from the durable artifacts of the stalled team.
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import zlib from "node:zlib"

const REPO = "/root/dshProj/my-power-dsh"
const TEAM = join(REPO, ".mpd/team/workmate-rename-delete")
const SESSIONS = "/root/.dsh/sessions/--root-dshProj-my-power-dsh--"
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function readSession(p) {
  const buf = readFileSync(p)
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) { try { parts.push(zlib.zstdDecompressSync(buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length))) } catch {} }
  return Buffer.concat(parts).toString("utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
const t = (ms) => new Date(ms).toISOString().slice(11, 19) + "Z"
const out = []
const say = (s = "") => out.push(s)

const team = JSON.parse(readFileSync(join(TEAM, "team.json"), "utf8"))
say("# LIVE DIAGNOSIS - team \"" + team.id + "\" (captain " + team.captainSessionId + ")")
say("# generated from the durable team record + the real session logs on this machine")
say()
say("## 1. Durable task graph after the stall")
for (const task of team.tasks) {
  say(`  ${task.id}  ${String(task.status).padEnd(10)} assignee=${String(task.assignee).padEnd(16)} attempt=${task.attempt ?? 0}  deps=[${task.dependencies.join(",")}]  ${task.subject}`)
}
say()
say("  t1 (Planner) and t2 (Researcher) completed; t3/t4/t5 depend only on the completed t1")
say("  and stayed 'pending' with attempt=0: the scheduler never even created a claim for them.")
say()

say("## 2. Member activity (real session logs): assignment prompts delivered vs not")
const members = team.members
for (const m of members) {
  const p = join(SESSIONS, m.id, "session.jsonl.zstd")
  if (!existsSync(p)) { say(`  ${m.name.padEnd(16)} (no session log)`); continue }
  const events = readSession(p)
  const turns = events.filter((e) => e.type === "turn/start").length
  const text = JSON.stringify(events)
  const assignments = (text.match(/AgentTeams automatic task assignment/g) ?? []).length
  const joinMsgs = (text.match(/You have joined the team/g) ?? []).length
  say(`  ${m.name.padEnd(16)} turns=${turns}  spawn-join-msg=${joinMsgs > 0}  SCHEDULER ASSIGNMENTS=${assignments}`)
}
say()
say("  Every member received the spawn prompt only. Planner/Researcher claimed t1/t2 by themselves")
say("  (the spawn prompt lists the assigned task count); no member ever received a scheduler")
say("  assignment, so the second batch could never start.")
say()

say("## 3. Captain's own delivery attempts (agent_teams_send_message results)")
const captainLog = join(REPO, "evidence/agent-teams/scheduler-wakeup-fix", process.env.TS ?? "", "captain-session-f333e946.jsonl")
if (existsSync(captainLog)) {
  const plain = readFileSync(captainLog, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  for (const e of plain) {
    if (e.type === "tool/call" && ["agent_teams_send_message", "agent_teams_status", "agent_teams_update_task"].includes(e.data?.name)) {
      say(`  [${t(e.time)}] CALL ${e.data.name} ${JSON.stringify(e.data.arguments ?? {}).slice(0, 120)}`)
    }
    if (e.type === "tool/result") {
      const blocks = (e.data?.message?.content ?? []).flatMap((c) => (c.content ?? []).map((x) => x.text ?? ""))
      const text = blocks.join(" | ")
      if (/delivered via/.test(text)) say(`  [${t(e.time)}]   -> ${text.slice(0, 160)}`)
    }
  }
} else {
  say("  (captain session dump not bundled)")
}
say()
say("  Every captain -> member message reports 'delivered via mailbox', i.e. deliverToMember")
say("  returned false. The mailbox records carry no deliveryClaimedAt/readAt afterwards:")
const inbox = join(TEAM, "inbox")
for (const f of readdirSync(inbox)) {
  const lines = readFileSync(join(inbox, f), "utf8").trim().split("\n").filter(Boolean)
  const unacked = lines.map((l) => JSON.parse(l)).filter((m) => m.readAt === undefined && m.deliveryClaimedAt === undefined).length
  if (unacked > 0) say(`  ${f}: ${unacked} message(s) still unclaimed/unread (never delivered)`)
}
say()

say("## 4. Host contract on THIS machine (dsh 0.1.2-rc.1)")
say("  installed @deepseek-ai/dsh-subagent service face (lib/typert.host.js) members:")
const host = "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh"
for (const line of readFileSync(join(host, "node_modules/@deepseek-ai/dsh-subagent/lib/typert.host.js"), "utf8").split("\n")) {
  const m = line.match(/"name": "([a-zA-Z]+)"/)
  if (m && !/^[A-Z]/.test(m[1])) say("    - " + m[1])
}
const impl = readFileSync(join(host, "node_modules/@deepseek-ai/dsh-subagent/lib/index.js"), "utf8")
say()
say("  followup method on the service: " + (/"followup"\(|^\s*followup\(/m.test(impl) ? "PRESENT" : "ABSENT"))
say("  symbol queue: " + (impl.includes('Symbol.for("dsh.subagent.queuePrompt")') ? "PRESENT (Symbol.for('dsh.subagent.queuePrompt'))" : "ABSENT"))
say("  `Agent` interface method: followup(message: UserMessage): void  (an Agent method, not a service method)")
say()
say("## 5. Root cause")
say("  lib/members.js#deliverToMember called ctx.subagents.followup(parent, childId, content, options) --")
say("  a method this Harness generation does not expose. It threw TypeError inside the catch,")
say("  returning false, so EVERY scheduler wakeup (task assignment AND captain guidance) was")
say("  dropped: the claim rolled back to pending, the member stayed idle, and the second batch")
say("  was never dispatched. The first batch ran only because the spawn prompt lists the tasks.")
writeFileSync(process.argv[2], out.join("\n") + "\n")
console.log(out.join("\n"))
