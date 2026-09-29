const m = await import("/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js")
const list = m.MPD_DELTAS
const files = [...new Set(list.map((e) => e.file))]
console.log(JSON.stringify({ registryEntries: list.length, distinctIds: new Set(list.map((e) => e.id)).size, distinctFiles: files.length, files: files.map((f) => f.replace("packages/mpd-agent-teams-plugin/", "")) }, null, 1))
