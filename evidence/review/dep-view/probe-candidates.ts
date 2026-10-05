// Why does a "no reachable host" probe still bind? Print the candidate list under a sandboxed
// HOME/DSH_HOME + a pinned nonexistent root, and name the candidate that actually resolves.
import { hostRootCandidates, probeHostInput, HOST_ROOT_ENV } from "../../../packages/mpd-tui-adapter-plugin/src/index"
const sandbox = "/tmp/mpd-review-no-such-sandbox"
process.env[HOST_ROOT_ENV] = sandbox + "/nothing-here"
process.env.DSH_HOME = sandbox
process.env.HOME = sandbox
const roots = hostRootCandidates()
console.log("HOME =", process.env.HOME, " DSH_HOME =", process.env.DSH_HOME)
console.log("candidates (" + roots.length + "):")
for (const r of roots) console.log("  " + r)
const result = await probeHostInput(roots)
console.log("probe result: bound=" + (result.input !== undefined) + " root=" + String(result.root) + " detail=" + String(result.detail))
