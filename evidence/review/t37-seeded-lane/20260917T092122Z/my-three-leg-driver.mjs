#!/usr/bin/env node
// t40 (review of t37's seeded negative-control lane) — the REVIEWER'S OWN driver.
// It evaluates the pin's FOUR matcher strings (the same literals the lane asserts) in THREE legs:
//   A  SEEDED   — a scratch copy of lib/ OUTSIDE the workspace with the wave-1 line restored
//   B  SHIPPED  — the real module (control: all four must be TRUE)
//   C  UNSEEDED — a scratch copy that is byte-identical to shipped: the "pass without seeding" attempt
// The aim is falsification: leg C must show that no seed ⇒ no RED, i.e. the lane cannot pass without it.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { registerAgentTeamsTools } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/tools.js"

const PLUGIN = "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin"
const LIB = join(PLUGIN, "lib")
const DEPS = join(PLUGIN, "_deps")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "probe-team"
// The same literals the shipped pin/lane assert (quoted from the lane's source, by label).
const PREFIX = "Pause: agent-teams halt "
const FRAMING = "(one mechanism: agent_teams_halt"
const PEER = "· team watchdog hold:"
const DEFERRAL = "run session-watchdog-status"
const HOLD_VIEW = { held: true, holdId: "hold-probe-1", at: 1700000000000, reason: "silence probe", source: "service" }
const SHIPPED_PAUSE_LINE = /`Pause: agent-teams halt \$\{[^`]*?`,\n/u
const WAVE_ONE_PAUSE_LINE = "`Pause: agent-teams halt ${team.halted ? 'ACTIVE' : 'not active'} · team watchdog hold: not read on this surface — run session-watchdog-status (released only by its own session-watchdog-resume)`,\n"

const matchers = (text) => ({
  prefixPresent: text.includes(PREFIX),
  singleMechanismFraming: text.includes(FRAMING),
  peerWordingAbsent: !text.includes(PEER),
  deferralAbsent: !text.includes(DEFERRAL),
})

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), "mpd-t40-review-"))
  const teamDir = join(ws, STATE_DIR, TEAM_ID)
  mkdirSync(join(teamDir, "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(join(teamDir, "team.json"), JSON.stringify({
    id: TEAM_ID, name: "t40 probe", captainSessionId: "session-captain", createdAt: now, taskSeq: 1, phase: "running",
    members: [{ id: "session-member", name: "Architect", role: "architect", status: "idle", joinedAt: now }],
    tasks: [{ id: "t1", subject: "probe", status: "pending", assignee: "Architect", dependencies: [], attempt: 0, createdAt: now, updatedAt: now }],
  }, null, 2))
  return { ws, captain: { id: "session-captain", status: "idle", session: { header: { cwd: ws } } }, member: { id: "session-member", name: "Architect", status: "idle", session: { header: { cwd: ws } } } }
}

async function render(toolsModule, box) {
  const tools = new Map()
  const ctx = {
    tools: { register: (d) => { tools.set(d.name, d) } },
    agents: { get: (id) => (id === box.captain.id ? box.captain : id === box.member.id ? box.member : undefined), list: () => [box.captain, box.member] },
    subagents: { prompt: async () => ({ messageId: "m1" }), followup: () => {}, sendMessage: () => {} },
    effect: () => () => undefined,
    on: () => () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: (name) => (name === "mpdWatchdog" ? { isHeld: () => ({ ...HOLD_VIEW }) } : undefined),
  }
  toolsModule.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const status = tools.get("agent_teams_status")
  const value = await status.execute({}, { agent: box.member })
  return status.output.render({}, value)[0].text
}

const out = { instrument: "t40 reviewer driver (same four matcher literals as the lane)", legs: {} }

// LEG A — SEEDED: scratch copy outside the workspace, wave-1 line restored (one-occurrence assert)
{
  const scratch = mkdtempSync(join(tmpdir(), "mpd-t40-seed-"))
  cpSync(LIB, join(scratch, "lib"), { recursive: true })
  symlinkSync(DEPS, join(scratch, "_deps"), "dir")
  const copy = join(scratch, "lib", "tools.js")
  const src = readFileSync(copy, "utf8")
  const occurrences = (src.match(SHIPPED_PAUSE_LINE) ?? []).length
  writeFileSync(copy, src.replace(SHIPPED_PAUSE_LINE, WAVE_ONE_PAUSE_LINE))
  const seededPresent = readFileSync(copy, "utf8").includes(PEER)
  const box = workspace()
  const text = await render(await import(pathToFileURL(copy).href), box)
  out.legs.seeded = { scratch, occurrencesOfShippedLine: occurrences, seedPresent: seededPresent, pauseLine: text.split("\n").find((l) => l.startsWith("Pause:")), matchers: matchers(text) }
  rmSync(scratch, { recursive: true, force: true }); rmSync(box.ws, { recursive: true, force: true })
}

// LEG B — SHIPPED (control)
{
  const box = workspace()
  const text = await render({ registerAgentTeamsTools }, box)
  out.legs.shipped = { pauseLine: text.split("\n").find((l) => l.startsWith("Pause:")), matchers: matchers(text) }
  rmSync(box.ws, { recursive: true, force: true })
}

// LEG C — UNSEEDED copy (the "pass without seeding" attempt): identical bytes to shipped
{
  const scratch = mkdtempSync(join(tmpdir(), "mpd-t40-unseeded-"))
  cpSync(LIB, join(scratch, "lib"), { recursive: true })
  symlinkSync(DEPS, join(scratch, "_deps"), "dir")
  const box = workspace()
  const text = await render(await import(pathToFileURL(join(scratch, "lib", "tools.js")).href), box)
  out.legs.unseeded = { scratch, pauseLine: text.split("\n").find((l) => l.startsWith("Pause:")), matchers: matchers(text) }
  rmSync(scratch, { recursive: true, force: true }); rmSync(box.ws, { recursive: true, force: true })
}

// What the lane's assertions REQUIRE (from its source, by label):
out.laneRequirements = {
  seeded_prefixPresent_MUST_BE: true,
  seeded_singleMechanismFraming_MUST_BE: false,
  seeded_peerWordingAbsent_MUST_BE: false,
  seeded_deferralAbsent_MUST_BE: false,
  shipped_allFour_MUST_BE: true,
}
const req = out.laneRequirements
out.laneWouldPassOn = {
  seeded: out.legs.seeded.matchers.prefixPresent === req.seeded_prefixPresent_MUST_BE
    && out.legs.seeded.matchers.singleMechanismFraming === req.seeded_singleMechanismFraming_MUST_BE
    && out.legs.seeded.matchers.peerWordingAbsent === req.seeded_peerWordingAbsent_MUST_BE
    && out.legs.seeded.matchers.deferralAbsent === req.seeded_deferralAbsent_MUST_BE,
  shipped: Object.values(out.legs.shipped.matchers).every((v) => v === true),
  unseeded: Object.values(out.legs.unseeded.matchers).every((v) => v === true), // an unseeded copy can only satisfy "all TRUE" → the lane's FALSE-expectations FAIL
}
console.log(JSON.stringify(out, null, 1))
