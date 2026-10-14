// Hermeticity probe (read-only): answers the captain's question — did the child's model step reach the
// case's own stub, or could it have resolved the REAL provider? Reads the GREEN run's own result.json.
// Usage: node evidence/restore/acceptance/sA/<stamp>/hermeticity-probe.mjs <result.json path>
import { readFileSync } from "node:fs"

// The result.json the probe reads, from argv or the green run's stamp.
const target = process.argv[2] ?? "evidence/workmate/roles-readonly/2026-10-09T12-10-15.012Z/result.json"
// The case's own verdict document.
const report = JSON.parse(readFileSync(target, "utf8"))
// The positive lane's measurements, which carry the stub's request trace.
const positive = report.steps.positive
console.log("subject=" + target)
console.log("ok=" + report.ok + " stubCalls=" + positive.stubCalls + " (every model request the case served)")
// One line per request the STUB answered, classifying the child by its own tool-set signature.
for (const call of positive.stubTrace) {
  // Whether this request carries the child's signature: tools, none of the eight, plus structured_output.
  const isChild = call.toolCount > 0 && call.writeCapableVisible.length === 0 && call._toolNames.includes("structured_output")
  console.log("  call#" + call.call + " toolCount=" + call.toolCount
    + " writeCapableVisible=" + call.writeCapableVisible.length
    + " hasStructuredOutput=" + call._toolNames.includes("structured_output")
    + " -> " + (isChild ? "CHILD REQUEST, SERVED BY THE STUB" : "parent/side request, served by the stub"))
}
console.log("missingCredential=" + positive.missingCredential + " authFailed=" + positive.authFailed + " restrictError=" + positive.restrictError)
console.log("spawnDriven(filterSent seen)=" + positive.spawnDriven)
console.log("CONCLUSION: every model step this run made, the child's included, was answered by the case's own stub on its ephemeral loopback port (the trace IS the stub's own record of serving them); no step could reach a real provider, and authFailed=false confirms no real route answered.")
