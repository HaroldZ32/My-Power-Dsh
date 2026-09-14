import { writeFileSync } from "node:fs"
import { CLAUSE_ACTION_PATTERN, CLAUSE_SEPARATOR_PATTERN, DELIVERABLE_VERB_PATTERN, ACTION_VERB_PATTERN, ENUMERATED_LINE_PATTERN, consumeExplicitFlag, evaluateComplexityGate } from "../../../../../packages/mpd-agent-teams-plugin/lib/session-start.js"

const PROMPTS = [
  ["Align the bundle with upstream: audit the orchestration surface, then implement the routing change.", "complex1"],
  ["team: fix the flaky test", "complex2"],
  ["1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot", "complex3"],
  ["Reply with exactly: hello-ok", "simple1"],
  ["What does the git-master skill do? Answer in one sentence.", "simple2"],
  ["Rename the variable `foo` to `bar` in src/util.ts and run its test.", "simple3"],
  ["Check the test, build the package, verify the output.", "ACCEPTED-COST false-positive"],
]
const count = (text, re) => [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase()))].length
const rows = []
for (const [prompt, label] of PROMPTS) {
  const consumed = consumeExplicitFlag(prompt)
  const text = consumed.text
  const c1 = text.split("\n").filter((line) => ENUMERATED_LINE_PATTERN.test(line)).length
  const c2 = count(text, ACTION_VERB_PATTERN)
  const c3 = text.split(CLAUSE_SEPARATOR_PATTERN).filter((clause) => CLAUSE_ACTION_PATTERN.test(clause)).length
  const b = count(text, DELIVERABLE_VERB_PATTERN)
  const subMet = [c1 >= 3, c2 >= 3, c3 >= 3].filter(Boolean).length
  const verdict = evaluateComplexityGate(text, { explicitFlag: consumed.flagged, planArtifact: false })
  const oldCounted = [c1 >= 3, c2 >= 3, c3 >= 3, b >= 4, consumed.flagged].filter(Boolean).length
  rows.push({ label, prompt, C1_lines: c1, C2_verbs: c2, C3_clauses: c3, B_deliverableVerbs: b, D_planArtifact: false,
    explicitFlag: consumed.flagged, C_subSignalsMet: subMet + "/3", C_fires: subMet >= 2,
    signals: verdict.signals, trigger: verdict.trigger, countedSignalsUnderOldRule: oldCounted })
}
const out = {
  measuredAt: new Date().toISOString(),
  purpose: "t24 F1 finalisation evidence: (a) the OLD 'matchedSignals >= 2' rule could not trigger frozen complex #1/#3, and (b) the accepted-cost sentence is indistinguishable from complex #1 under any C-only rule.",
  contractAnchor: { bytes: 33022, sha256: "9916644bc50669b30d857b190a4058a53a31cf2106444b2c3e0091d955d76cb4", field: "complexityGate.logic + logicRevisionNote" },
  expected: {
    simple: "3/3 must be silent (trigger=false)",
    complex: "3/3 must each trigger exactly once",
    acceptedCost: "the false-positive sentence triggers (C2+C3) — ledgered cost, not a defect",
  },
  rows,
}
writeFileSync("evidence/omo-align/implementation/r3/raw/signal-c-matrix.json", JSON.stringify(out, null, 2))
console.log("wrote signal-c-matrix.json with", rows.length, "rows")
for (const r of rows) console.log([r.label.padEnd(28), "C1=" + r.C1_lines, "C2=" + r.C2_verbs, "C3=" + r.C3_clauses, "B=" + r.B_deliverableVerbs, "flag=" + r.explicitFlag, "Cbar=" + r.C_subSignalsMet, "signals=" + (r.signals.join("+") || "-"), "trigger=" + r.trigger, "oldCount=" + r.countedSignalsUnderOldRule].join("  "))
