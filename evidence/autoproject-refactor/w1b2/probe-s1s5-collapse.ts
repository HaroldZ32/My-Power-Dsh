// REVIEWER'S PROBE: the engine's boundary inputs vs the frozen predicate.
//
// The contract's predicate counts S1 (criteria > 12) and S5 (checklist > 8) as INDEPENDENT counter
// signals, requiring TWO of {S1,S4,S5,S6,S7} to escalate. The engine feeds `checklist: criteria.size`
// (src/engine.ts::considerEscalation — the only `checklist` occurrence in the file), and CUT 3 requires
// the plan checklist to be EMITTED from those same criteria — so S1 and S5 read one number twice and a
// 13-criteria run supplies TWO counters for ONE condition.
//
// Run: bun evidence/autoproject-refactor/w1b2/probe-s1s5-collapse.ts
import { ESCALATION_DEFAULTS, evaluateEscalation, topLevelScope } from "../../../packages/mpd-autoproject-plugin/src/escalation.ts"

/** A boundary with nothing else over the line: only the criteria/checklist pair varies below. */
const calm = {
  status: "complete",
  fruitlessWaves: 0,
  ledgerBytes: 1024,
  scopeTrees: 2,
  sameCriterionVerifyFails: 0,
  config: ESCALATION_DEFAULTS,
}

// 1. THE PURE PREDICATE, fed the test's own distinct checklist: one counter is not enough.
console.log("criteria=13 checklist=3  ->", JSON.stringify(evaluateEscalation({ ...calm, criteria: 13, checklist: 3 })))

// 2. THE SAME BOUNDARY, fed the ENGINE's mapping (checklist === criteria.size).
console.log("criteria=13 checklist=13 ->", JSON.stringify(evaluateEscalation({ ...calm, criteria: 13, checklist: 13 })))

// 3. Below the S1 threshold the S5 signal alone still behaves: one counter, no escalation.
console.log("criteria=9  checklist=9  ->", JSON.stringify(evaluateEscalation({ ...calm, criteria: 9, checklist: 9 })))

// 4. S6's input in the engine is `topLevelScope(evidence)` — evidence PATHS, not a declared write scope.
//    A doc-only evidence list already yields trees, so S6 can count report paths as scope.
const docPaths = [
  "docs/feature-audit.md :: audited", "docs/index.md :: linked", "agent-references/glossary.md :: read",
  "evidence/qa/run.log :: captured", "skills/dsh-qa/SKILL.md :: quoted", "packages/mpd-roles-plugin/README.md :: cited",
]
console.log("topLevelScope(doc-only evidence) ->", JSON.stringify(topLevelScope(docPaths)))
