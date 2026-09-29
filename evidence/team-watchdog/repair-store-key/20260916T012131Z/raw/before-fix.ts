// THE BEFORE OBSERVATION: the PRE-REBUILD dist still carries the un-scoped candidate filter, so
// the shipped artifact reproduces the FALSE NEGATIVE end to end (the wedged team is never flagged).
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..", "..")
const DIST = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")
const { apply } = await import(DIST)
const WS = join(HERE, "ws")
const STATE_DIR = join(".mpd", "team")
const SHARED_NAME = "Architect"
const RECENT = 1_000_000_000_000
const WEDGED_AT = RECENT - 10 * 90_000
const deliveries = []
const warnings = []
const services = new Map()
const live = new Map()
const captain = { id: "session-captain-t79", status: "idle", session: { header: { cwd: WS } }, cancel: () => {} }
live.set(captain.id, captain)
live.set("child-team-alpha", { id: "child-team-alpha", status: "idle", session: { header: { cwd: WS } } })
live.set("child-team-beta", { id: "child-team-beta", status: "idle", session: { header: { cwd: WS } } })
const ctx = {
  get: (id) => services.get(id), provide: (id, value) => services.set(id, value),
  agents: { get: (id) => live.get(id), list: () => [] },
  logger: { warn: (...a) => warnings.push(a.map(String).join(" ")), info: (...a) => warnings.push(a.map(String).join(" ")), error: () => {}, debug: () => {} },
  on: () => () => {}, effect: () => {}, inject: () => () => {},
  tools: { register: () => () => {}, get: () => undefined, has: () => false },
  subagents: { prompt: async (r) => (deliveries.push(r), { messageId: "m" }), interrupt: () => {}, drainContinuableChildren: async () => {} },
}
process.env.DSH_WORKSPACE_ROOT = WS
const report = apply(ctx, { stateDir: STATE_DIR, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 90_000, warnStreakToEscalate: 3, actionOnEscalate: "pause" })
const engine = report.engine
const ws = engine.knownRoots()[0]
const candidates = []
for (const team of engine.teams(ws, RECENT + 1)) for (const c of engine.candidates(ws, team)) candidates.push(c)
const tick = await engine.tickOnce(RECENT + 1)
engine.stop()
delete process.env.DSH_WORKSPACE_ROOT
const verdict = {
  dist: DIST.replace(REPO + "/", ""),
  candidates: candidates.map((c) => ({ teamId: c.teamId, taskId: c.taskId, lastSeen: c.lastSeen, everStampedForTask: c.everStampedForTask })),
  decisions: tick.decisions.map((d) => ({ type: d.type, teamId: d.teamId, silenceMs: d.silenceMs })),
  falseNegativeReproduced: tick.decisions.length === 0 && candidates.find((c) => c.teamId === "team-beta")?.lastSeen === RECENT,
  note: "team-beta is WEDGED (its newest stamp is 10 thresholds old) yet its candidate reports team-alpha's RECENT stamp and the engine raises NOTHING — the pre-repair behaviour, measured on the shipped artifact.",
}
writeFileSync(join(HERE, "before-fix.json"), JSON.stringify(verdict, null, 2) + "\n")
console.log(JSON.stringify(verdict, null, 2))
process.exit(verdict.falseNegativeReproduced ? 0 : 1)
