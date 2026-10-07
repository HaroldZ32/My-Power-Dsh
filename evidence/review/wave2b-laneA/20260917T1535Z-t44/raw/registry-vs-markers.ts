import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
const LIB = "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib"
const m = await import(join(LIB, "mpd-deltas.js"))
const registryIds = new Set(m.MPD_DELTAS.map((e) => e.id))
const live = new Map() // id -> [file:line]
for (const name of readdirSync(LIB).sort()) {
  if (!name.endsWith(".js") || name === "mpd-deltas.js") continue
  const lines = readFileSync(join(LIB, name), "utf8").split("\n")
  lines.forEach((line, i) => {
    const hit = /\/\/#region (mpd-delta [a-z0-9-]+)/.exec(line)
    if (hit === null) return
    const id = hit[1]
    if (!live.has(id)) live.set(id, [])
    live.get(id).push(`${name}:${i + 1}`)
  })
}
const liveIds = new Set(live.keys())
const markersNotRegistered = [...liveIds].filter((id) => !registryIds.has(id))
const registryNotLive = [...registryIds].filter((id) => !liveIds.has(id))
const duplicates = [...live.entries()].filter(([, sites]) => sites.length > 1)
console.log(JSON.stringify({
  registryEntries: registryIds.size,
  liveMarkerIds: liveIds.size,
  markersNotRegistered: markersNotRegistered.map((id) => ({ id, sites: live.get(id) })),
  registryNotLive: registryNotLive,
  idsWithTwoMarkerSites: duplicates.map(([id, sites]) => ({ id, sites })),
}, null, 2))
