import { countSessionEvents } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"
const root = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t8-reviewer-20260915T063140Z"
console.log(JSON.stringify(countSessionEvents(root, "mpd-tui/board-opened"), null, 1))
