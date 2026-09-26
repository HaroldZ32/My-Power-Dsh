// INDEPENDENT reader: a plain node process with NO plugin code and NO test helper.
//
// It reads what the writer process left on disk and prints a JSON verdict. Because
// it shares nothing with the plugin except the file layout, a bug in the plugin's
// own reader cannot make this pass.
//
// Usage: node reader.mjs <workspace> <stateDir>
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const [workspace, stateDir] = process.argv.slice(2)
if (!workspace || !stateDir) {
  console.error("usage: node reader.mjs <workspace> <stateDir>")
  process.exit(2)
}

const watchdog = join(workspace, stateDir, "watchdog")
const out = { checks: [], failures: [], data: {} }
const check = (name, ok, detail) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) })
  if (!ok) out.failures.push(name)
}

const jsonl = (path) => {
  if (!existsSync(path)) return []
  const records = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      out.failures.push("unparseable line in " + path)
    }
  }
  return records
}

// ── 1. the heartbeat, per member AND the captain ─────────────────────────────
const architect = jsonl(join(watchdog, "heartbeat", "architect.jsonl"))
const captain = jsonl(join(watchdog, "heartbeat", "captain.jsonl"))
out.data.heartbeat = {
  files: existsSync(join(watchdog, "heartbeat")) ? readdirSync(join(watchdog, "heartbeat")) : [],
  architect: architect.map((s) => ({ kind: s.kind, at: s.at, tool: s.tool, taskId: s.taskId, attemptId: s.attemptId })),
  captain: captain.map((s) => ({ kind: s.kind, at: s.at, tool: s.tool, taskId: s.taskId, attemptId: s.attemptId })),
}
const steps = architect.filter((s) => s.kind === "step")
const tools = architect.filter((s) => s.kind === "tool")
check("member heartbeat has >= 3 distinct step timestamps", new Set(steps.map((s) => s.at)).size >= 3, [...new Set(steps.map((s) => s.at))])
check("member heartbeat has a POST tool stamp naming the tool", tools.length >= 1 && typeof tools[0].tool === "string", tools.map((s) => s.tool))
check("the tool stamp lands after the step that preceded it", tools.length > 0 && steps.length > 0 && tools[tools.length - 1].at >= steps[steps.length - 1].at)
check("member stamps carry the adopted task + attempt", steps.length > 0 && steps[0].taskId === "t1" && steps[0].attemptId === "att-1")
check("captain heartbeat has step AND tool stamps", captain.some((s) => s.kind === "step") && captain.some((s) => s.kind === "tool"), captain.map((s) => s.kind))
check("the captain holds no task here, so its stamps carry no task id", captain.every((s) => s.taskId === null || s.taskId === undefined), captain.map((s) => s.taskId))

// ── 2. the scene snapshot (AC-5 field set) ───────────────────────────────────
const sceneDir = join(watchdog, "scene", "team-a")
const sceneFiles = existsSync(sceneDir) ? readdirSync(sceneDir) : []
const latestPath = join(sceneDir, "latest.json")
const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : null
out.data.scene = { dir: sceneDir, files: sceneFiles, latest }
check("one immutable scene file per incident plus latest.json", sceneFiles.filter((f) => f.endsWith(".json")).length >= 4 && sceneFiles.includes("latest.json"), sceneFiles)
check("the latest scene parses and is the escalation scene", latest !== null && latest.reason === "escalate" && latest.schemaVersion === 1)
check("scene.cause is the silence cause with its ms", latest !== null && latest.cause?.kind === "silence" && typeof latest.cause?.ms === "number", latest?.cause)
check(
  "scene.team carries id/name/phase/halted/haltedAt/hold",
  latest !== null && typeof latest.team?.id === "string" && typeof latest.team?.name === "string" && "phase" in latest.team && "halted" in latest.team && "haltedAt" in latest.team && latest.team.hold !== null,
  latest?.team,
)
check("scene.tasks carry id/status/assignee/attempt/attemptId/lastSeen/streak", Array.isArray(latest?.tasks) && latest.tasks.length >= 2 && latest.tasks.every((t) => "id" in t && "status" in t && "assignee" in t && "attempt" in t && "attemptId" in t && "lastSeen" in t && "streak" in t), latest?.tasks)
check("scene.members carry id/name/status/unread/currentTask/lastSeen", Array.isArray(latest?.members) && latest.members.length >= 2 && latest.members.every((m) => "id" in m && "name" in m && "status" in m && "unread" in m && "currentTask" in m && "lastSeen" in m), latest?.members)
check("scene.mailbox is the read watermark map", latest !== null && typeof latest.mailbox === "object", latest?.mailbox)
check("scene.parkedAttempts maps a member id to an attempt id", latest !== null && Object.keys(latest.parkedAttempts ?? {}).length >= 2, latest?.parkedAttempts)
check("scene.incidents carry the WARN predecessors with their scene paths", Array.isArray(latest?.incidents) && latest.incidents.filter((i) => i.kind === "warn").length >= 2 && latest.incidents.some((i) => typeof i.scene === "string"), latest?.incidents?.map((i) => i.kind))

// ── 3. the hold sidecar, beside team.json and not inside it ──────────────────
const holdPath = join(watchdog, "hold", "team-a.json")
const hold = existsSync(holdPath) ? JSON.parse(readFileSync(holdPath, "utf8")) : null
out.data.hold = hold
check("the hold sidecar exists beside team.json", hold !== null, holdPath)
check("the hold carries id/teamId/since/cause/taskId/attemptId/sceneAt", hold !== null && ["id", "teamId", "since", "cause", "taskId", "attemptId", "sceneAt"].every((k) => k in hold), Object.keys(hold ?? {}))
check("the hold names the escalated task and attempt", hold?.taskId === "t1" && hold?.attemptId === "att-1", { taskId: hold?.taskId, attemptId: hold?.attemptId })

// ── 4. the incident log and the read watermark ───────────────────────────────
const incidents = jsonl(join(watchdog, "incidents.jsonl"))
out.data.incidents = incidents.map((i) => ({ kind: i.kind, at: i.at, taskId: i.taskId, hold: i.hold, scene: i.scene }))
const kinds = incidents.map((i) => i.kind)
check("exactly three incidents: warn, warn, escalate", kinds.filter((k) => k === "warn").length === 2 && kinds.filter((k) => k === "escalate").length === 1, kinds)
check("each WARN predecessor recorded its scene path", incidents.filter((i) => i.kind === "warn").every((i) => typeof i.scene === "string"))
check("the escalation incident says the hold was applied", incidents.find((i) => i.kind === "escalate")?.hold === "applied")
const watermarkPath = join(watchdog, "read-watermark.json")
const watermark = existsSync(watermarkPath) ? JSON.parse(readFileSync(watermarkPath, "utf8")) : null
out.data.watermark = watermark
check("the read watermark exists and is a per-reader map", watermark !== null && typeof watermark.web === "number" && watermark.web > 0, watermark)

// ── 5. the adopted record was never written by this package ──────────────────
const teamPath = join(workspace, stateDir, "team-a", "team.json")
const teamStat = existsSync(teamPath) ? statSync(teamPath) : null
out.data.team = { path: teamPath, mtimeMs: teamStat?.mtimeMs ?? null, bytes: teamStat?.size ?? null }
check("the adopted team.json still exists", teamStat !== null)

out.ok = out.failures.length === 0
console.log(JSON.stringify(out, null, 2))
process.exit(out.ok ? 0 : 1)
