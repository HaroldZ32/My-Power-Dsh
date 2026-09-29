// The four r6 fixture cases, run on their own and captured as JSON.
//
// The full 18-case run is what the fault lane does (`raw/lane-fault/result.json`, 11/11 checks); this
// driver exists so the r6 evidence is readable on its own, with each case's structured observation
// and the real wall-clock duration of the genuine command it ran.
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CASES, runCase, NOT_CLAIMED } from "../../../../../packages/mpd-team-watchdog-plugin/test/fixtures/inject.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const NEW = ["long-tool-no-hold", "long-tool-bound-disabled-control", "completed-tool-not-in-flight", "tool-inflight-expired"]
const root = join(HERE, "ws-new-cases")
const results = []
for (const name of NEW) results.push(await runCase(name, { root, print: false }))
const out = {
  fixture: "packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs",
  casesInFixture: CASES,
  r6Cases: NEW,
  results: results.map((entry) => ({ case: entry.case, ok: entry.ok, observation: entry.observation, lines: entry.lines })),
  notClaimed: NOT_CLAIMED,
  ok: results.every((entry) => entry.ok),
}
writeFileSync(join(HERE, "new-cases.json"), JSON.stringify(out, null, 2) + "\n")
for (const entry of results) {
  console.log((entry.ok ? "ok   " : "FAIL ") + entry.case)
  for (const line of entry.lines) console.log("       " + line)
}
console.log("casesInFixture=" + CASES.length + " allR6CasesOk=" + out.ok)
process.exit(out.ok ? 0 : 1)
