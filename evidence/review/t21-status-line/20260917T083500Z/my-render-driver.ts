#!/usr/bin/env node
// t32 (review of t21) — the REVIEWER'S OWN render driver. It drives the SHIPPED
// `packages/mpd-agent-teams-plugin/lib/tools.js` in-process (no copy, no author harness) and prints
// (a) the rendered pause line and the structured `pause` payload in every state the ruling cares
// about, and (b) the tool names the plugin registers — so clause 2 is measured, not assumed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerAgentTeamsTools } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "review-team"

function teamRecord(extra = {}) {
  const now = Date.now()
  return {
    id: TEAM_ID, name: "t32 review probe", captainSessionId: "session-captain", createdAt: now,
    taskSeq: 1, phase: "running", members: [{ id: "session-member", name: "Architect", role: "architect", status: "idle", joinedAt: now }],
    tasks: [{ id: "t1", subject: "probe", status: "pending", assignee: "Architect", dependencies: [], attempt: 0, createdAt: now, updatedAt: now }],
    ...extra,
  }
}

function build(holdMode) {
  const workspace = mkdtempSync(join(tmpdir(), "t32-review-"))
  const stateRoot = join(workspace, STATE_DIR, TEAM_ID)
  mkdirSync(join(stateRoot, "inbox"), { recursive: true })
  writeFileSync(join(stateRoot, "team.json"), JSON.stringify(teamRecord(holdMode.halted === true ? { halted: true } : {}), null, 2))
  const tools = new Map()
  const watchdog = holdMode.kind === "absent" || holdMode.kind === "throwing" ? undefined : { isHeld: () => (holdMode.kind === "held" ? { held: true, holdId: "hold-review-1", at: 1700000000000, reason: "review probe", source: "service" } : { held: false }) }
  const ctx = {
    tools: { register: (d) => { tools.set(d.name, d) } },
    agents: { get: (id) => ({ id, status: "idle", session: { header: { cwd: workspace } } }), list: () => [] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => {
      if (name !== "mpdWatchdog") return undefined
      if (holdMode.kind === "throwing") throw new Error("review probe: the watchdog service throws")
      return watchdog
    },
  }
  registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const member = { id: "session-member", name: "Architect", status: "idle", session: { header: { cwd: workspace } } }
  return { workspace, tools, ctx, member }
}

const clause = (label, ok, detail) => ({ label, ok, detail })
const results = []
const states = [
  { id: "held", kind: "held" },
  { id: "not-held", kind: "not-held" },
  { id: "absent", kind: "absent" },
  { id: "throwing", kind: "throwing" },
  { id: "halt-only", kind: "absent", halted: true },
]
const registered = new Set()
for (const state of states) {
  const box = build(state)
  for (const name of box.tools.keys()) registered.add(name)
  const status = box.tools.get("agent_teams_status")
  const value = await status.execute({}, { agent: box.member })
  const text = status.output.render({}, value)[0].text
  const line = text.split("\n").find((l) => l.startsWith("Pause:")) ?? "<no Pause: line>"
  results.push({ state: state.id, pauseLine: line, payload: value.pause, checks: [
    clause("one mechanism named", line.includes("(one mechanism: agent_teams_halt"), null),
    clause("hold = INTERNAL implementation", line.includes("PRESERVING hold is its INTERNAL implementation"), null),
    clause("old peer wording ABSENT", !line.includes("· team watchdog hold:"), null),
    clause("old deferral ABSENT", !line.includes("run session-watchdog-status"), null),
  ] })
  rmSync(box.workspace, { recursive: true, force: true })
}
console.log(JSON.stringify({ instrument: "t32 reviewer render driver (shipped lib/tools.js)", registeredToolNames: [...registered].sort(), states: results }, null, 1))
