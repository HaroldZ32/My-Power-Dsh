
import { writeFileSync } from "node:fs"
export const name = "t48-drive-probe"
export const inject = ["agents", "tools"]
export async function apply(ctx) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const report = { phase: "started", liveAgents: 0, members: [] }
  const write = (extra = {}) => { try { writeFileSync("/root/dshProj/my-power-dsh/evidence/omo-align/team-compact/drive/report-2026-09-14T02-52-12-835Z.json", JSON.stringify({ ...report, ...extra }, null, 2)) } catch {} }
  write()
  for (let round = 0; round < 45; round += 1) {
    await sleep(1000)
    const list = typeof ctx.agents?.list === "function" ? ctx.agents.list() : []
    report.liveAgents = list.length
    const members = []
    for (const agent of list) {
      const entry = { id: agent.id, status: agent.status, hasSession: agent.session !== undefined, runMaintenance: typeof agent.runMaintenance }
      try {
        const scoped = agent.ctx?.get?.("compaction")
        entry.scopedEngineType = scoped === undefined ? "undefined" : typeof scoped
        entry.compactNowType = typeof scoped?.compactNow
        if (typeof scoped?.compactNow === "function") {
          const result = await scoped.compactNow(agent, undefined)
          entry.compactNowAnswer = result === null ? "null" : "object"
        }
      } catch (error) { entry.driveError = String(error?.message ?? error) }
      try {
        const session = agent.session
        entry.sessionKeys = Object.keys(session ?? {}).slice(0, 30)
        entry.logPresent = session?.log !== undefined
        entry.eventsSnapshotPresent = session?.eventsSnapshot !== undefined
        if (typeof session?.eventsSnapshot === "function") {
          const snap = await session.eventsSnapshot()
          entry.eventsSnapshotEntries = Array.isArray(snap) ? snap.length : typeof snap
        } else if (Array.isArray(session?.eventsSnapshot)) {
          entry.eventsSnapshotEntries = session.eventsSnapshot.length
        }
        if (typeof session?.log === "function") {
          const tail = await session.log({ limit: 5 })
          entry.logEntries = Array.isArray(tail) ? tail.length : typeof tail
        } else if (typeof session?.log?.read === "function") {
          const tail = await session.log.read({ limit: 5 })
          entry.logEntries = Array.isArray(tail) ? tail.length : typeof tail
        } else if (Array.isArray(session?.log)) {
          entry.logEntries = session.log.length
        }
      } catch (error) { entry.observabilityError = String(error?.message ?? error) }
      members.push(entry)
    }
    report.members = members
    write()
  }
}
