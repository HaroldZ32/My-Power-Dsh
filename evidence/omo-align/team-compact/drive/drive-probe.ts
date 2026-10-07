
export const name = "t48-drive-probe"
export const inject = ["agents", "tools"]
export async function apply(ctx) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await sleep(1500)
  const agents = ctx.agents
  const list = typeof agents?.list === "function" ? agents.list() : []
  const report = { booted: true, liveAgents: list.length, members: [] }
  for (const agent of list) {
    const entry = { id: agent.id, status: agent.status, hasSession: agent.session !== undefined, runMaintenance: typeof agent.runMaintenance }
    // the engineering-hinge rule: the engine comes from the AGENT'S OWN scoped context
    try {
      const scoped = agent.ctx?.get?.("compaction")
      entry.scopedEngine = scoped === undefined ? "undefined" : typeof scoped
      entry.compactNow = typeof scoped?.compactNow
      if (typeof scoped?.compactNow === "function") {
        const result = await scoped.compactNow(agent, undefined)
        entry.compactNowAnswer = result === null ? "null" : "object"
      }
    } catch (error) {
      entry.driveError = String(error?.message ?? error)
    }
    // observability entry points the design relies on
    try {
      const session = agent.session
      entry.sessionLogReadable = typeof session?.log === "function" || typeof session?.log?.read === "function" || session?.log !== undefined
      entry.eventsSnapshotReadable = typeof session?.eventsSnapshot === "function" || session?.eventsSnapshot !== undefined
      if (typeof session?.log === "function") {
        const tail = await session.log({ limit: 5 })
        entry.logEntries = Array.isArray(tail) ? tail.length : typeof tail
      } else if (session?.log !== undefined && typeof session.log.slice === "function") {
        entry.logEntries = session.log.slice(-5).length
      }
      entry.sessionKeys = Object.keys(session ?? {}).slice(0, 24)
    } catch (error) {
      entry.observabilityError = String(error?.message ?? error)
    }
    report.members.push(entry)
  }
  console.log("[t48-drive] REPORT=" + JSON.stringify(report))
}
