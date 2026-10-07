import { countSessionEvents, readCommandRecords } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"
const root = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t8-reviewer-20260915T063140Z"
console.log("fresh:", JSON.stringify(countSessionEvents(root, "t8probe/fresh-0705")))
console.log("seen :", JSON.stringify(countSessionEvents(root, "mpd-tui/board-opened")))
const rec = readCommandRecords(root)
console.log("command records:", JSON.stringify((rec.dones ?? []).map(d => ({ text: String(d.text).slice(0, 60) })).slice(-4)))
