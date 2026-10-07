// t71 (repair round 2) evidence runner.
//
// Runs the w8 fault harness (all cases, including the two NEW boundary cases) and records:
//   * the two boundary cases BOTH ways (a completed turn must NOT escalate; a mid-turn stall MUST);
//   * the never-started record/notice surfacing (T69-ESCALATE-2);
//   * the registry non-reproduction note (T69-REGISTRY-1) so a green `--check` is never read
//     as a window-integrity proof.
//
// Usage: bun run-boundary.mjs
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const FIXTURE = join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.mjs")
if (!existsSync(FIXTURE)) {
  console.error("FATAL: fixture not found at " + FIXTURE)
  process.exit(2)
}
const { runCase, runAll, CASES, BOUNDARY_CASES, scenarios, NOT_CLAIMED, FROZEN, CLOCK } = await import(FIXTURE)

const scratch = join(HERE, "raw", "ws")
mkdirSync(scratch, { recursive: true })

// ── every case (the two boundary cases run first, by CASES order) ───────────
const results = await runAll({ root: scratch, print: true })
for (const result of results) {
  writeFileSync(join(HERE, "raw", result.case + ".json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(HERE, "raw", result.case + ".log"), result.lines.map((line) => "[" + result.case + "] " + line).join("\n") + "\n")
}

// ── THE BOUNDARY CONTRAST, asserted as a pair (falsifiable both ways) ───────
const boundary = Object.fromEntries(results.filter((r) => BOUNDARY_CASES.includes(r.case)).map((r) => [r.case, r.observation]))
const contrast = {
  completedTurnEscalated: (boundary["completed-turn-idle"]?.decisions ?? []).includes("escalate"),
  completedTurnWarned: (boundary["completed-turn-idle"]?.decisions ?? []).includes("warn"),
  completedTurnBeyond2xThreshold: boundary["completed-turn-idle"]?.beyondTwiceTheThreshold === true,
  midTurnStallEscalated: (boundary["mid-turn-stall"]?.decisions ?? []).includes("escalate"),
  midTurnStallHeld: (boundary["mid-turn-stall"]?.holdsApplied ?? 0) === 1,
}
contrast.ok =
  contrast.completedTurnBeyond2xThreshold === true &&
  contrast.completedTurnEscalated === false &&
  contrast.completedTurnWarned === false &&
  contrast.midTurnStallEscalated === true &&
  contrast.midTurnStallHeld === true

// ── T69-REGISTRY-1: the non-reproduction, recorded so nobody misreads `--check` ──
const registryNote = {
  finding: "T69-REGISTRY-1",
  claim: "The hand-mutated-registry refusal could NOT be reproduced in the steady state: when every region is present the applier has nothing to heal, so a mutated context window is never consulted.",
  consequence: "A GREEN `node scripts/patch-agent-teams-fixes.mjs --check` IS NOT A WINDOW-INTEGRITY PROOF. It proves the marked regions match the registry bytes; it does not re-derive that each entry's context pair is still unique on the region-stripped skeleton.",
  statusThisTask: "NOT FIXED, by the reviewer's own direction: a `--verify-windows` mode that re-derives each entry's context-pair uniqueness would be a NEW capability and must not be smuggled into `--check`'s semantics.",
  whatWasExercised: "The integrity that matters was exercised on the HEAL path instead (t69's re-declaration experiment produced loud refusals with the file left byte-untouched), and the 53 regions / 9 files registry is clean at `--check` exit 0.",
}

const summary = {
  task: "t71",
  repairRound: 2,
  fixture: "packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs",
  fixtureSha256: createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"),
  boundaryCases: BOUNDARY_CASES,
  allCases: CASES,
  clock: { base: CLOCK.base, frozen: FROZEN },
  boundaryContrast: contrast,
  boundaryObservations: boundary,
  registryNonReproduction: registryNote,
  results: results.map((r) => ({ case: r.case, ok: r.ok, observation: r.observation })),
  ok: results.every((r) => r.ok) && contrast.ok,
  notClaimed: NOT_CLAIMED,
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(summary, null, 2) + "\n")
writeFileSync(join(HERE, "scenario.json"), JSON.stringify({ injectedScenarios: scenarios(), clock: CLOCK, frozen: FROZEN, boundaryCases: BOUNDARY_CASES }, null, 2) + "\n")

const lines = []
lines.push("================================================================")
lines.push("t71 (repair round 2) — boundary + fail-safety evidence")
lines.push("repo: " + REPO)
lines.push("fixture sha256: " + summary.fixtureSha256)
lines.push("frozen thresholds: warnSilenceMs " + FROZEN.warnSilenceMs + " / warnStreakToEscalate " + FROZEN.warnStreakToEscalate + " (exercised on an INJECTED clock)")
lines.push("================================================================")
for (const result of results) {
  lines.push("")
  lines.push("── case " + result.case + " ── ok=" + result.ok + " ──")
  for (const line of result.lines) lines.push("  " + line)
}
lines.push("")
lines.push("── THE BOUNDARY PAIR (falsifiable both ways) ──")
lines.push("  " + JSON.stringify(contrast))
lines.push("")
lines.push("── T69-REGISTRY-1 (recorded, NOT fixed) ──")
lines.push("  " + registryNote.claim)
lines.push("  " + registryNote.consequence)
lines.push("")
lines.push("── verdicts ──")
for (const result of results) lines.push("  " + (result.ok ? "PASS" : "FAIL") + "  " + result.case)
lines.push("  " + (contrast.ok ? "PASS" : "FAIL") + "  boundary-contrast")
lines.push("")
lines.push("── NOT CLAIMED ──")
for (const limit of NOT_CLAIMED) lines.push("  - " + limit)
writeFileSync(join(HERE, "output.log"), lines.join("\n") + "\n")
console.log(lines.join("\n"))
process.exit(summary.ok ? 0 : 1)
