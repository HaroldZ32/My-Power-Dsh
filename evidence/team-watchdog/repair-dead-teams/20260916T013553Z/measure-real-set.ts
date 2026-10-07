// t81 evidence — the dead-team flood measured on the REAL record set.
//
// The six records under <repo>/.mpd/team are COPIED byte-for-byte into this evidence directory and
// the engine is pointed at the copy, so nothing under .mpd/** is written (the task forbids it).
// The live registry is modelled from the LIVE record's own ids (captain + members), which is what a
// real host's registry holds: the dead records' session/member ids are absent from it, exactly as
// they are absent from this process.
//
// Usage: bun measure-real-set.mjs <before|after>
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const REAL_TEAM_DIR = join(REPO, ".mpd", "team")
const label = process.argv[2] === "after" ? "after" : "before"
const WS = join(HERE, "raw", "ws-real-" + label)
const STATE_DIR = join(".mpd", "team")

// ── the copy: every record, byte-for-byte ───────────────────────────────────
rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, STATE_DIR), { recursive: true })
const copied = []
for (const entry of readdirSync(REAL_TEAM_DIR)) {
  const teamFile = join(REAL_TEAM_DIR, entry, "team.json")
  if (!existsSync(teamFile)) continue
  mkdirSync(join(WS, STATE_DIR, entry, "inbox"), { recursive: true })
  cpSync(teamFile, join(WS, STATE_DIR, entry, "team.json"))
  copied.push(entry)
}

// ── the heartbeat store: copied too, so the LIVE team's stamps are present ──
// Without it every assigned task of every team would look un-stamped, which would inflate the live
// team's own count. Only `heartbeat/` is copied (not incidents/scene/hold): the measurement must
// start from a clean incident log while keeping the stamps the engine actually reads.
const REAL_HEARTBEAT = join(REAL_TEAM_DIR, "watchdog", "heartbeat")
const copiedHeartbeats = existsSync(REAL_HEARTBEAT) ? readdirSync(REAL_HEARTBEAT) : []
if (copiedHeartbeats.length > 0) {
  mkdirSync(join(WS, STATE_DIR, "watchdog", "heartbeat"), { recursive: true })
  for (const entry of copiedHeartbeats) cpSync(join(REAL_HEARTBEAT, entry), join(WS, STATE_DIR, "watchdog", "heartbeat", entry))
}

// ── the live registry: ONLY the live team's ids (what a host really holds) ──
const live = new Map()
const liveRecord = JSON.parse(readFileSync(join(REAL_TEAM_DIR, "mpd-default", "team.json"), "utf8"))
const liveIds = [liveRecord.captainSessionId, ...(liveRecord.members ?? []).map((m) => m.id)].filter((id) => typeof id === "string" && id !== "")
for (const id of liveIds) live.set(id, { id, status: "idle", session: { header: { cwd: WS } } })

const { apply } = await import(join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js"))
const services = new Map()
const consoleLines = []
const debugLines = []
const ctx = {
  get: (id) => services.get(id),
  provide: (id, value) => services.set(id, value),
  agents: { get: (id) => live.get(id), list: () => [...live.values()] },
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: (...args) => debugLines.push(args.map(String).join(" ")) },
  on: () => () => {}, effect: () => {}, inject: () => () => {},
  tools: { register: () => () => {}, get: () => undefined, has: () => false },
  subagents: { prompt: async () => ({ messageId: "m" }), interrupt: () => {}, drainContinuableChildren: async () => {} },
}
process.env.DSH_WORKSPACE_ROOT = WS
const report = apply(ctx, { stateDir: STATE_DIR, teamCacheMs: 0, tickIntervalMs: 3_600_000 })
const engine = report.engine
const now = Date.now()
const originalLog = console.log
console.log = (...args) => consoleLines.push(args.map(String).join(" "))
let tick
try {
  tick = await engine.tickOnce(now)
} finally {
  console.log = originalLog
}
const stats = engine.getStats()
engine.stop()
delete process.env.DSH_WORKSPACE_ROOT

const incidentsPath = join(WS, STATE_DIR, "watchdog", "incidents.jsonl")
const incidents = existsSync(incidentsPath)
  ? readFileSync(incidentsPath, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
  : []
const perTeam = {}
for (const entry of copied) {
  perTeam[entry] = {
    incidents: incidents.filter((incident) => incident.teamId === entry).length,
    // exact attribution: `NEVER-STARTED <teamId> ` (a bare substring match would let
    // "mpd-default" absorb every line about "mpd-default-84e50f06").
    consoleLines: consoleLines.filter((line) => line.includes("NEVER-STARTED " + entry + " ") || line.includes("skipped team " + entry + " ")).length,
    decisions: tick.decisions.filter((d) => d.teamId === entry).map((d) => d.type),
  }
}
const verdict = {
  label,
  revision: "dist as it stands at this run",
  distSha256: (await import("node:crypto")).createHash("sha256").update(readFileSync(join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js"))).digest("hex"),
  copiedRecords: copied,
  copiedHeartbeatFiles: copiedHeartbeats,
  liveRegistryIds: liveIds.length,
  totals: {
    neverStarted: stats.neverStarted,
    skippedTeams: stats.skippedTeams,
    incidents: incidents.length,
    consoleLines: consoleLines.length,
    decisions: tick.decisions.length,
  },
  perTeam,
  consoleSample: consoleLines.slice(0, 3),
  debugSkipLines: debugLines.filter((line) => line.includes("skipping")).slice(0, 8),
}
writeFileSync(join(HERE, "raw", "real-set-" + label + ".json"), JSON.stringify(verdict, null, 2) + "\n")
console.log(JSON.stringify(verdict, null, 2))
