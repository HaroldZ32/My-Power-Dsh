// T-19 surface 2 (t21) — the pause-STATUS line: BEFORE/AFTER readings from the REAL tool.
//
// The acceptance asks for the rendered output quoted before and after the collapse, on the merged tree
// (t8 + t10 landed). This driver drives `agent_teams_status` in-process, exactly as the tool registers
// itself, across the four states an operator can meet:
//   1. running            — no halt, no hold (the watchdog service reports held:false)
//   2. halted             — `agent_teams_halt` engaged
//   3. held internally    — the watchdog's PRESERVING hold is active (hold id + reason present)
//   4. service absent     — the watchdog row is not loaded (fail-open: the read must not invent a hold)
//
// For each state it prints the RENDERED TEXT and the STRUCTURED PAYLOAD's pause-related fields, so a
// reader can compare the two revisions without re-running anything.
//
// Usage: bun evidence/agent-teams/pause-surface/<stamp>/driver.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../")
const STATE_DIR = join(".mpd", "team")
const TEAM_ID = "pause-surface-probe"
const CAPTAIN_ID = "session-captain-pause"
const MEMBER_ID = "member-pause"

function fixture({ halted = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t21-"))
    mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
    const now = Date.now()
    const teamFile = join(dir, STATE_DIR, TEAM_ID, "team.json")
    writeFileSync(teamFile, `${JSON.stringify({
        id: TEAM_ID,
        name: "pause surface probe",
        captainSessionId: CAPTAIN_ID,
        createdAt: now,
        approvedAt: now,
        phase: "running",
        taskSeq: 1,
        ...halted ? { halted: true, haltedAt: now } : {},
        members: [{ id: MEMBER_ID, name: "Architect", role: "worker", status: "idle", joinedAt: now }],
        tasks: [{
            id: "t1",
            subject: "done work",
            assignee: "Architect",
            dependencies: [],
            status: "completed",
            attempt: 1,
            attemptId: "attempt-t1-1",
            verdict: "pass",
            output: "the deliverable",
            createdAt: now,
            updatedAt: now,
        }],
    }, null, 2)}\n`)
    const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
    return { dir, teamFile, captain }
}

async function read({ label, halted = false, watchdog }) {
    const box = fixture({ halted })
    try {
        const tools = new Map()
        const ctx = {
            tools: { register: (definition) => { tools.set(definition.name, definition) } },
            agents: { get: (id) => (id === CAPTAIN_ID ? box.captain : undefined), list: () => [box.captain] },
            subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
            effect: () => () => undefined,
            on: () => () => undefined,
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
            get: (key) => (key === "mpdWatchdog" ? watchdog : undefined),
        }
        const { registerAgentTeamsTools } = await import(join(REPO, "packages/mpd-agent-teams-plugin/lib/tools.js"))
        registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
        const status = tools.get("agent_teams_status")
        const value = await status.execute({}, { agent: box.captain })
        const rendered = status.output.render({}, value)[0].text
        const pauseLines = rendered.split("\n").filter((line) => /Pause:/u.test(line))
        const payload = JSON.parse(JSON.stringify(value))
        return {
            label,
            pause_line: pauseLines,
            payload_halted: payload.halted,
            payload_pause: payload.pause === undefined ? "(absent)" : payload.pause,
        }
    }
    finally {
        rmSync(box.dir, { recursive: true, force: true })
    }
}

const heldView = {
    held: true,
    holdId: "hold-7f3a",
    at: 1789630000000,
    reason: "the wave's writers must quiesce before the re-pack",
    source: "record",
}
const notHeldView = { held: false, holdId: "", at: 0, reason: "", source: null }

const out = {
    driver: "pause-surface (T-19 surface 2 / t21)",
    tool: "agent_teams_status (registered by registerAgentTeamsTools, lib/tools.js)",
    states: [
        await read({ label: "1 running (halt: no, hold: none)", watchdog: { isHeld: () => notHeldView } }),
        await read({ label: "2 halted (halt: yes, hold: none)", halted: true, watchdog: { isHeld: () => notHeldView } }),
        await read({ label: "3 held internally (hold id + reason set)", watchdog: { isHeld: () => heldView } }),
        await read({ label: "4 watchdog service absent (fail-open read)", watchdog: undefined }),
    ],
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
