#!/usr/bin/env bun
// verify-lane-b.mjs — t25's INDEPENDENT behaviour checks over the real adopted code.
//
// Written from scratch (not a re-run of the lane's own drivers): it registers the REAL
// `registerAgentTeamsTools` from `lib/tools.js` against a synthetic team state, injects a WORKING
// hold through the REAL reader shape (`ctx.get('mpdWatchdog', false)`), and asserts the wave-1
// claims that the register's most damaging friction (a hold that declined claim/update) is gone —
// plus the two deliverable channels (T-46 append, T-09 artifact) and the T-49 member tool.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/mpd-agent-teams-plugin")
const { registerAgentTeamsTools } = await import(join(PLUGIN, "lib", "tools.js"))
const { MEMBER_TOOL_NAMES } = await import(join(PLUGIN, "lib", "tool-names.js"))

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "t25-probe-team"
const MEMBER = "Architect"
const MEMBER_ID = "session-t25-member"
const results = []
const record = (id, ok, detail) => { results.push({ id, ok, detail }); console.log("[" + (ok ? "PASS" : "FAIL") + "] " + id + " — " + detail) }

const HOLD_VIEW = { held: true, holdId: "t25-hold-1", at: 1_700_000_000_000, reason: "t25 probe", source: "service" }

function teamRecord() {
  const now = Date.now()
  return {
    id: TEAM_ID, name: "t25 probe", captainSessionId: "session-t25-captain", createdAt: now, taskSeq: 3, phase: "running",
    members: [{ id: MEMBER_ID, name: MEMBER, role: "architect", status: "idle", joinedAt: now }],
    tasks: [
      { id: "t1", subject: "held write probe", status: "pending", assignee: MEMBER, dependencies: [], attempt: 0, createdAt: now, updatedAt: now },
      { id: "t2", subject: "terminal append probe", status: "completed", assignee: MEMBER, dependencies: [], attempt: 1, createdAt: now, updatedAt: now, output: "ORIGINAL-SUMMARY-PREFIX", attemptId: "attempt-t2" },
    ],
  }
}

function makeHarness() {
  const workspace = mkdtempSync(join(tmpdir(), "t25-lane-b-"))
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM_ID, "inbox"), { recursive: true })
  writeFileSync(join(stateRoot, TEAM_ID, "team.json"), JSON.stringify(teamRecord(), null, 2))
  const holdReads = []
  const watchdog = { isHeld: (teamId, ws) => { holdReads.push({ teamId, ws, frame: new Error().stack ?? "" }); return HOLD_VIEW } }
  const tools = new Map()
  const member = { id: MEMBER_ID, status: "idle", session: { header: { cwd: workspace } } }
  const captain = { id: "session-t25-captain", status: "idle", session: { header: { cwd: workspace } } }
  const ctx = {
    tools: { register: (def) => { tools.set(def.name, def); return () => tools.delete(def.name) }, get: () => undefined },
    agents: { get: (id) => (id === captain.id ? captain : id === member.id ? member : undefined), list: () => [captain, member] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    routes: { register: () => () => undefined },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => (name === "mpdWatchdog" ? watchdog : undefined),
  }
  registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  return { workspace, teamFile: join(stateRoot, TEAM_ID, "team.json"), tools, holdReads, member }
}

const H = makeHarness()
try {
  // ── D2: a LIVE hold must not decline claim_task / update_task ───────────────────────────────
  H.holdReads.length = 0
  const claim = H.tools.get("agent_teams_claim_task")
  const update = H.tools.get("agent_teams_update_task")
  record("T-48/D2: the real claim_task tool exists", typeof claim?.execute === "function", typeof claim?.execute)
  const claimed = await claim.execute({ task_id: "t1" }, { agent: H.member })
  record("D2: claim_task SUCCEEDS while a working hold is live", claimed?.status === "claimed" && typeof claimed?.attempt_id === "string", "status=" + claimed?.status + " attempt=" + String(claimed?.attempt_id).slice(0, 8))
  const updated = await update.execute({ task_id: "t1", status: "in_progress", attempt_id: claimed.attempt_id, output: "recorded while held (t25)" }, { agent: H.member })
  record("D2: update_task SUCCEEDS while the same hold is live", updated?.status === "in_progress", "status=" + updated?.status)
  const onDisk = JSON.parse(readFileSync(H.teamFile, "utf8"))
  const t1 = onDisk.tasks.find((t) => t.id === "t1")
  record("D2: the durable record really moved", t1?.status === "in_progress" && t1?.output === "recorded while held (t25)", "status=" + t1?.status)
  const nonSchedulerReads = H.holdReads.filter((r) => !String(r.frame).includes("scheduler.js"))
  record("D2: every hold read came from the DISPATCH half (scheduler.js), none from the tool boundary",
    H.holdReads.length > 0 && nonSchedulerReads.length === 0,
    "reads=" + H.holdReads.length + " nonScheduler=" + nonSchedulerReads.length)

  // ── T-46: a LONG document survives; a byte-dropping replacement is refused ──────────────────
  const LONG = "L".repeat(9_500) + "-TAIL-MARKER"
  const t2Before = JSON.parse(readFileSync(H.teamFile, "utf8")).tasks.find((t) => t.id === "t2")
  const appended = await update.execute({ task_id: "t2", status: "completed", attempt_id: "attempt-t2", output_append: LONG }, { agent: H.member })
  const t2After = JSON.parse(readFileSync(H.teamFile, "utf8")).tasks.find((t) => t.id === "t2")
  const stored = String(t2After?.output ?? "")
  record("T-46: output_append extends a TERMINAL task's summary with a >8 KB document",
    stored.startsWith(String(t2Before.output)) && stored.includes("-TAIL-MARKER") && stored.length >= 9_500,
    "before=" + String(t2Before.output).length + "B after=" + stored.length + "B prefixKept=" + stored.startsWith(String(t2Before.output)))
  let refused = null
  try {
    await update.execute({ task_id: "t2", status: "completed", attempt_id: "attempt-t2", output: "SHORT" }, { agent: H.member })
  } catch (error) { refused = error }
  const stillThere = String(JSON.parse(readFileSync(H.teamFile, "utf8")).tasks.find((t) => t.id === "t2")?.output ?? "")
  record("T-46: a byte-dropping plain `output` replacement is REFUSED and the bytes survive",
    refused !== null && stillThere.includes("-TAIL-MARKER"), "refusal=" + String(refused?.message ?? refused).slice(0, 90))

  // ── T-09: the artifact channel carries the full text and records path + bytes ───────────────
  const ART_TEXT = "ARTIFACT-START\n" + "A".repeat(9_017) + "\nARTIFACT-END"
  const withArtifact = await update.execute({ task_id: "t2", status: "completed", attempt_id: "attempt-t2", artifact: { path: "evidence/t25/artifact.md", text: ART_TEXT } }, { agent: H.member })
  const artPath = String(withArtifact?.artifact_path ?? "")
  const onDiskArt = artPath === "" ? "" : readFileSync(join(H.workspace, artPath), "utf8")
  record("T-09: the artifact channel returns artifact_path + artifact_bytes",
    artPath.includes("evidence/t25/artifact.md") && Number(withArtifact?.artifact_bytes) === Buffer.byteLength(ART_TEXT),
    "path=" + artPath + " bytes=" + String(withArtifact?.artifact_bytes))
  record("T-09: the artifact file on disk holds the FULL text (byte-exact)",
    onDiskArt === ART_TEXT, "disk=" + Buffer.byteLength(onDiskArt) + "B expected=" + Buffer.byteLength(ART_TEXT) + "B")

  // ── T-49: the read-only seat can read a contract ────────────────────────────────────────────
  const contract = H.tools.get("agent_teams_task_contract")
  record("T-49: agent_teams_task_contract is a MEMBER tool name", MEMBER_TOOL_NAMES.includes("agent_teams_task_contract"), "memberTools=" + MEMBER_TOOL_NAMES.length)
  const view = await contract?.execute({ task_id: "t2" }, { agent: H.member })
  record("T-49: the contract tool answers a member call with the declared contract",
    typeof view === "object" && view !== null && (view.task_id === "t2" || view.id === "t2" || String(JSON.stringify(view)).includes("t2")),
    "view=" + JSON.stringify(view).slice(0, 120))
} finally {
  rmSync(H.workspace, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
writeFileSync(join(import.meta.dir, "verify-lane-b.result.json"), JSON.stringify({
  ok: failed.length === 0, at: new Date().toISOString(), plugin: PLUGIN, cases: results,
}, null, 2) + "\n")
console.log("[verify-lane-b] " + (results.length - failed.length) + "/" + results.length + " cases passed — " + (failed.length === 0 ? "PASS" : "FAIL"))
process.exit(failed.length === 0 ? 0 : 1)
