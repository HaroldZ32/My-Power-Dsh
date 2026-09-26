#!/usr/bin/env node
// Offline probe: evaluate the session-start complexity gate against BOTH verbatim
// frozen prompt sets. Exits non-zero unless every SIMPLE prompt is untriggered and
// every COMPLEX prompt triggers — the two-sided falsifiability check the gate needs.
// Used by session-start-team.mjs --self-test so a gate that cannot fail one side
// cannot pass. Never touches the network or any DSH state.
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..", "..")
const modulePath = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
const gate = await import(pathToFileURL(modulePath).href)

const SIMPLE = [
  "Reply with exactly: hello-ok",
  "What does the git-master skill do? Answer in one sentence.",
  "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
const COMPLEX = [
  "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
  "team: fix the flaky test",
  "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]

const failures = []
function check(label, prompts, expect) {
  for (const prompt of prompts) {
    const consumed = gate.consumeExplicitFlag(prompt)
    const verdict = gate.evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact: false })
    const ok = verdict.trigger === expect
    console.log((ok ? "OK   " : "BAD  ") + label + " " + JSON.stringify(verdict) + " | " + JSON.stringify(prompt.slice(0, 40)))
    if (!ok) failures.push(label + ": " + prompt)
    // The explicit flag must be CONSUMED, never left in the goal text.
    if (consumed.flagged && consumed.text.includes("!team")) failures.push("flag not consumed: " + prompt)
    if (consumed.flagged && /^team:/i.test(consumed.text.trim())) failures.push("team: prefix not consumed: " + prompt)
  }
}
check("simple", SIMPLE, false)
check("complex", COMPLEX, true)
if (failures.length > 0) {
  console.error("[gate-probe] FAIL: " + failures.length + " two-sided violation(s)")
  for (const f of failures) console.error("  - " + f)
  process.exit(1)
}
console.log("[gate-probe] ok: SIMPLE all untriggered, COMPLEX all triggered, flags consumed")
