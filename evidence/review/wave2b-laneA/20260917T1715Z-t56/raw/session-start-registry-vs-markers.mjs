import { readFileSync } from "node:fs"
const LIB = "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib"
const m = await import(LIB + "/mpd-deltas.js")
const rel = "packages/mpd-agent-teams-plugin/lib/session-start.js"
const entries = m.MPD_DELTAS.filter((e) => e.file === rel)
console.log("registry entries for session-start.js:", entries.length)
for (const e of entries) console.log("  registry id:", JSON.stringify(e.id), "| block?", typeof e.block === "string" && e.block.length > 0)
const markers = readFileSync(LIB + "/session-start.js", "utf8").split("\n").map((l, i) => { const h = /\/\/#region (mpd-delta [a-z0-9-]+)/.exec(l); return h === null ? null : { line: i + 1, id: h[1] } }).filter(Boolean)
console.log("live markers in session-start.js:", markers.length)
for (const x of markers) console.log("  marker:", JSON.stringify(x.id), "at line", x.line)
const regIds = new Set(entries.map((e) => e.id))
const liveIds = new Set(markers.map((x) => x.id))
console.log("IN LIVE BUT NOT REGISTRY:", [...liveIds].filter((i) => !regIds.has(i)))
console.log("IN REGISTRY BUT NOT LIVE:", [...regIds].filter((i) => !liveIds.has(i)))
