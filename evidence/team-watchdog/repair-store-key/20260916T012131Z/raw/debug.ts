import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..", "..")
const { apply } = await import(join(REPO, "packages/mpd-team-watchdog-plugin/dist/index.js"))
const { readTeams, listTeamIds } = await import(join(REPO, "packages/mpd-team-watchdog-plugin/src/team.ts"))
console.log("REPO", REPO)
const WS = join(HERE, "ws")
console.log("roots:", listTeamIds(WS, join(".mpd","team")))
console.log("teams:", readTeams(WS, join(".mpd","team")).map(t => ({id:t.id, tasks:t.tasks.length})))
process.env.DSH_WORKSPACE_ROOT = WS
const services = new Map()
const ctx = { get:(i)=>services.get(i), provide:(i,v)=>services.set(i,v), agents:{get:()=>undefined,list:()=>[]}, logger:{warn:()=>{},info:()=>{},error:()=>{},debug:()=>{}}, on:()=>()=>{}, effect:()=>{}, inject:()=>()=>{}, tools:{register:()=>()=>{},get:()=>undefined,has:()=>false}, subagents:{prompt:async()=>({messageId:"m"})} }
const report = apply(ctx, { stateDir: join(".mpd","team"), teamCacheMs: 0, tickIntervalMs: 3600000 })
console.log("knobs:", JSON.stringify(report.knobs))
console.log("knownRoots:", report.engine.knownRoots())
const tick = await report.engine.tickOnce(1_000_000_000_001)
console.log("tick:", JSON.stringify(tick))
report.engine.stop()

// ── replicate the engine's own candidate computation ────────────────────────
const engine = report.engine
const ws = engine.knownRoots()[0]
for (const team of engine.teams(ws, 1_000_000_000_001)) {
  const cands = engine.candidates(ws, team)
  console.log("TEAM", team.id, "tasks:", JSON.stringify(team.tasks))
  console.log("  candidates:", JSON.stringify(cands))
}
