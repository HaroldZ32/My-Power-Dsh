// t45 host-plane probe. Loaded as a HOST-plane row (never inside the preset), it asks
// the one question the compaction design hinges on:
//   can a host-plane plugin resolve the compaction engine that serves a MEMBER session
//   (a preset isolate realm), and can it drive it?
//
// It observes only; it writes its findings as JSON to $MPD_HINGE_OUT and never mutates
// team state. `inject` is intentionally EMPTY so the mount itself is also evidence.
export const name = "mpd-t45-compact-hinge-probe"
export const inject = []

const OUT = process.env.MPD_HINGE_OUT

function fs() { return process.getBuiltinModule("node:fs") }

function report(entry) {
  if (!OUT) return
  try { fs().appendFileSync(OUT, JSON.stringify({ t: Date.now(), ...entry }) + "\n") }
  catch { /* a probe must never take the tree down */ }
}

function describe(engine) {
  if (engine === undefined) return { resolved: false, reason: "undefined" }
  if (engine === null) return { resolved: false, reason: "null" }
  if (typeof engine !== "object") return { resolved: false, reason: "typeof " + typeof engine }
  return {
    resolved: typeof engine.compactNow === "function",
    type: "object",
    compactNow: typeof engine.compactNow,
    keys: Object.keys(engine).slice(0, 20),
  }
}

export function apply(ctx) {
  report({ kind: "probe-applied", inject: [] })

  // (1) host plane, direct service lookup
  let hostEngine
  try { hostEngine = typeof ctx.get === "function" ? ctx.get("compaction") : undefined }
  catch (e) { report({ kind: "host-lookup-threw", error: String(e && e.message) }) }
  report({ kind: "host-plane-compaction", ...describe(hostEngine) })

  // (2) the agents registry, and per-agent scoped contexts
  const probeAgents = (tag) => {
    let agents
    try { agents = typeof ctx.get === "function" ? ctx.get("agents") : undefined }
    catch (e) { report({ kind: "agents-lookup-threw", tag, error: String(e && e.message) }); return }
    if (agents === undefined) { report({ kind: "agents-unavailable", tag }); return }
    let all = []
    try { all = typeof agents.list === "function" ? agents.list() : [] }
    catch (e) { report({ kind: "agents-list-threw", tag, error: String(e && e.message) }) }
    report({ kind: "agents-enumerated", tag, count: all.length, ids: all.map((a) => a && a.id).slice(0, 8) })
    for (const agent of all) {
      if (!agent || typeof agent !== "object") continue
      const fields = {
        id: agent.id,
        hasSession: agent.session !== undefined,
        hasRunMaintenance: typeof agent.runMaintenance === "function",
        hasCtx: agent.ctx !== undefined,
        status: typeof agent.status === "string" ? agent.status : typeof agent.status,
      }
      let agentEngine
      try { agentEngine = agent.ctx && typeof agent.ctx.get === "function" ? agent.ctx.get("compaction") : undefined }
      catch (e) { report({ kind: "agent-scope-lookup-threw", id: agent.id, error: String(e && e.message) }) }
      report({ kind: "member-agent", tag, fields, engineFromAgentScope: describe(agentEngine) })
    }
  }

  // At apply time agents may not exist yet; also observe on the first session start.
  probeAgents("apply")
  if (typeof ctx.on === "function") {
    ctx.on("agent/session-start", () => { try { probeAgents("session-start") } catch { /* observe only */ } })
  }
  report({ kind: "probe-ready" })
}
