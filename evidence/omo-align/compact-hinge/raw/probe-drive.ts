// t45 drive probe (host plane). Answers three questions in one real boot:
//   (1) does the host-plane `compaction` service resolve, and is it the SAME engine object
//       the member's own scoped context (`agent.ctx.get("compaction")`) sees?
//   (2) can a host-plane plugin drive a REAL compaction of an idle member — observing the
//       durable `compaction/start`/`compaction/end` events and the result fields?
//   (3) negative control: a concurrent second drive must report busy/loudly fail, never
//       silently succeed.
//
// The drive waits for `agent/session-start` (the registry is empty until a session exists).
export const name = "mpd-t45-compact-drive"
export const inject = []

const OUT = process.env.MPD_HINGE_OUT
const fs = () => process.getBuiltinModule("node:fs")
const rec = (o) => { try { fs().appendFileSync(OUT, JSON.stringify({ t: Date.now(), ...o }) + "\n") } catch {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sessionCounters(session) {
  try {
    const read = session.read
    if (typeof read !== "function") return null
    const ev = read.call(session)
    const arr = Array.isArray(ev) ? ev : [...ev]
    const types = arr.map((e) => e && (e.type || e.kind)).filter(Boolean)
    return {
      total: types.length,
      compactionStart: types.filter((t) => t === "compaction/start").length,
      compactionEnd: types.filter((t) => t === "compaction/end").length,
    }
  } catch (e) { return { readError: String((e && e.message) || e) } }
}

async function callCompact(engine, agent, signal) {
  const r = { threw: false }
  try {
    const call = engine.compactNow(agent, signal)
    r.returnedSync = true
    const result = call && typeof call.then === "function" ? await call : call
    r.returnedSync = false
    r.result = result === null ? "null" : {
      keys: result && typeof result === "object" ? Object.keys(result).slice(0, 12) : typeof result,
      shadowedTokenCount: result?.shadowedTokenCount ?? null,
      summarySeq: result?.summarySeq ?? null,
    }
  } catch (e) {
    r.threw = true
    r.error = String((e && e.message) || e)
    r.errorCode = (e && (e.code || e.name)) || null
  }
  return r
}

async function drive(ctx, get, agent) {
  let hostEngine = get("compaction")
  for (let i = 0; i < 80 && !hostEngine; i += 1) { await sleep(250); hostEngine = get("compaction") }
  let agentEngine
  try { agentEngine = typeof agent.ctx?.get === "function" ? agent.ctx.get("compaction") : undefined }
  catch (e) { rec({ kind: "agent-engine-threw", error: String((e && e.message) || e) }) }

  rec({
    kind: "identity",
    hostResolved: !!hostEngine,
    hostCompactNow: typeof hostEngine?.compactNow,
    hostName: hostEngine?.name ?? null,
    agentResolved: !!agentEngine,
    agentCompactNow: typeof agentEngine?.compactNow,
    agentName: agentEngine?.name ?? null,
    sameObject: hostEngine !== undefined && hostEngine === agentEngine,
    agentFields: {
      id: agent.id,
      hasSession: !!agent.session,
      hasRunMaintenance: typeof agent.runMaintenance === "function",
      hasCtx: !!agent.ctx,
      status: agent.status,
    },
    sessionKeys: agent.session && typeof agent.session === "object" ? Object.keys(agent.session).slice(0, 16) : null,
  })

  const engine = agentEngine ?? hostEngine
  if (!engine || typeof engine.compactNow !== "function") return rec({ kind: "cannot-drive", reason: "no engine with compactNow" })

  const countersBefore = sessionCounters(agent.session)
  rec({ kind: "before", status: agent.status, counters: countersBefore })

  // (2) real drive, plus (3) the concurrency control taken while the first call is in flight
  const ac = new AbortController()
  const first = callCompact(engine, agent, ac.signal)
  await sleep(120)
  rec({ kind: "mid-status", status: agent.status })
  const second = await callCompact(engine, agent, new AbortController().signal)
  const firstResult = await first
  await sleep(1500)

  rec({
    kind: "drive",
    firstResult,
    concurrentSecondCall: second,
    countersAfter: sessionCounters(agent.session),
    statusAfter: agent.status,
    droveRealCompaction: firstResult && firstResult.result !== "null" && !firstResult.threw,
  })
  rec({ kind: "done" })
}

export function apply(ctx) {
  const get = (k) => { try { return typeof ctx.get === "function" ? ctx.get(k) : undefined } catch (e) { rec({ kind: "get-threw", k, error: String((e && e.message) || e) }); return undefined } }
  const run = (tag) => {
    const agents = get("agents")
    const all = typeof agents?.list === "function" ? agents.list() : []
    rec({ kind: "agents", tag, count: all.length })
    if (all[0]) drive(ctx, get, all[0]).catch((e) => rec({ kind: "drive-threw", error: String((e && e.message) || e) }))
  }
  if (typeof ctx.on === "function") {
    ctx.on("agent/session-start", () => run("session-start"))
  }
  run("apply")
}
