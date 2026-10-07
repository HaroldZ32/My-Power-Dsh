#!/usr/bin/env node
// T-21 item 2 / T-60: measure the `session-start-team` two-sided arm against the gate predicate the
// lane ACTUALLY exercises, so its verdict is a recorded MEASUREMENT instead of a repeated claim.
//
// The lane boots a real `dsh` session per frozen prompt and counts `.mpd/team` records; a recorded
// reading of `complexTeams [1,0,1]` (t3's earlier batch) looked like a flake. This script evaluates
// the SAME prompt sets — read out of the lane's source, not re-typed — through the SAME predicate
// module the lane pins (`packages/mpd-agent-teams-plugin/lib/session-start.js`:
// `consumeExplicitFlag` + `evaluateComplexityGate`, where `trigger = explicitFlag || matchedSignals >= 1`
// and a "matched signal" is a satisfied C from its own 2-of-3 bar) and prints the per-prompt verdict
// the boot must agree with. Usage: node prompt-predicate-measurement.mjs [--json]
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const LANE = join(REPO, "skills", "dsh-qa", "scripts", "session-start-team.mjs")
const GATE = join(REPO, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")

function promptSet(source, name) {
  const start = source.indexOf("const " + name + " = [")
  if (start === -1) throw new Error("prompt set not found in the lane source: " + name)
  const open = source.indexOf("[", start)
  const close = source.indexOf("\n]", open)
  if (close === -1) throw new Error("unterminated prompt set: " + name)
  return JSON.parse("[" + source.slice(open + 1, close).replace(/,(\s*)$/, "$1") + "]")
}

const laneSource = readFileSync(LANE, "utf8")
const sets = { simple: promptSet(laneSource, "SIMPLE_PROMPTS"), complex: promptSet(laneSource, "COMPLEX_PROMPTS") }
const gate = await import(pathToFileURL(GATE).href)

const measurements = []
for (const [set, prompts] of Object.entries(sets)) {
  for (const [index, prompt] of prompts.entries()) {
    const consumed = gate.consumeExplicitFlag(prompt)
    const verdict = gate.evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact: false })
    measurements.push({
      set,
      index,
      prompt,
      explicitFlag: consumed.flagged === true,
      signalCount: verdict.signals.length,
      signals: verdict.signals,
      expectedTrigger: verdict.trigger === true,
      // the boot must agree: a triggered prompt provisions exactly ONE team; an untriggered one none.
      expectedTeams: verdict.trigger === true ? 1 : 0,
    })
  }
}

const problems = []
for (const entry of measurements) {
  if (entry.set === "simple" && entry.expectedTrigger) problems.push("a SIMPLE prompt triggered: " + JSON.stringify(entry.prompt))
  if (entry.set === "complex" && !entry.expectedTrigger) problems.push("a COMPLEX prompt did NOT trigger: " + JSON.stringify(entry.prompt))
}
if (!existsSync(GATE)) problems.push("the lane's predicate module is missing: " + GATE)

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ lane: LANE, gate: GATE, measurements, problems }, null, 2))
} else {
  console.log("[prompt-predicate] predicate = consumeExplicitFlag + evaluateComplexityGate (lib/session-start.js)")
  for (const entry of measurements) {
    console.log("  " + entry.set.padEnd(7) + " #" + entry.index + " expectedTeams=" + entry.expectedTeams +
      " explicitFlag=" + entry.explicitFlag + " signals=" + entry.signalCount + " :: " + JSON.stringify(entry.prompt.slice(0, 62)))
  }
}
if (problems.length > 0) {
  console.error("[prompt-predicate] FAIL:")
  for (const problem of problems) console.error("  - " + problem)
  process.exit(1)
}
console.log("[prompt-predicate] ok: the frozen sets are two-sided under the live predicate — every COMPLEX prompt triggers (>=1 satisfied C, or the consumed explicit flag), every SIMPLE prompt does not")
