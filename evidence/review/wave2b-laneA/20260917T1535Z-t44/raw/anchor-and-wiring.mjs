import { readFileSync } from "node:fs"
const ANCHOR = "\n        && unsatisfiedDependencies([...tasks], task.dependencies).length === 0"
const test = readFileSync("/root/dshProj/my-power-dsh/packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts", "utf8")
const sched = readFileSync("/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/scheduler.js", "utf8")
console.log(JSON.stringify({
  "anchor occurrences in my test file": test.split(ANCHOR).length - 1,
  "anchor occurrences in scheduler.js (must be 1 for the arm to splice)": sched.split(ANCHOR).length - 1,
  "withdrawn probe note": "an earlier probe of this same anchor reported 0 by using a literal backslash-n (shell single quotes) — withdrawn; this probe uses a real newline",
}, null, 2))
