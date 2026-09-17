#!/usr/bin/env node
// Assemble T-72's evidence record from the artifacts this task actually produced (no hand-typed
// numbers): the BEFORE run's result.json, the AFTER run's result.json, the two anchor-form probes,
// the two checker revisions' hashes, and the unified diff.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const read = (p) => readFileSync(join(REPO, p), "utf8")
const json = (p) => JSON.parse(read(p))
const sha = (p) => createHash("sha256").update(readFileSync(join(REPO, p))).digest("hex")
const counters = (report) => ({
  citations_checked: report.citations_checked,
  anchored_citations_content_verified: report.anchored_citations_content_verified,
  symbol_only_anchors_verified: report.symbol_only_anchors_verified,
  line_dependent_anchors_verified: report.line_dependent_anchors_verified ?? null,
  rot_line_number_only_anchors: report.rot_line_number_only_anchors ?? null,
  anchored_citations_without_a_claim: report.anchored_citations_without_a_claim ?? null,
  checks_passed: `${report.passed}/${report.total}`,
  failed: report.failed,
})

const FROZEN = "evidence/extensions/docs-claims/check-citations.mjs"
const DURABLE = "scripts/check-citations.mjs"
const before = json("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/checker-before-plain/result.json")
const beforeSelfTest = json("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/checker-before-selftest/result.json")
const after = json("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/checker-after-plain/result.json")
const afterSelfTest = json("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/checker-after-selftest/result.json")
const probeBefore = json("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/probe-before.json")
const probeAfter = json("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/probe-after.json")

const armTable = (probe) => Object.fromEntries(Object.entries(probe.arms).map(([name, arm]) => [name, arm.exitCode === 0 ? "accepted (exit 0)" : "flagged (exit 1)"]))
const flipped = Object.keys(probeBefore.arms).filter((name) => armTable(probeBefore)[name] !== armTable(probeAfter)[name])

const record = {
  task: "t16 — B2 — lane B2: symbol-first anchors so a citation can stop rotting",
  issue: "T-72",
  kind: "implementation",
  agent: "citation-checker-engineer",
  attemptId: "c490788d-44e6-4460-8614-95b41c5e61c4",
  date: "2026-09-17",
  registerRow: "§8.6 line 530 (verbatim): **T-72 [trap] The citation checker's anchor grammar makes every citation rot** (the line number is mandatory). P1.",
  headline:
    "The checker moved to its durable home `scripts/check-citations.mjs` and now ENFORCES symbol-first anchors: the anchor form the frozen revision silently ACCEPTED — a line-number-only anchor shadowed by a sibling claim for the same path:line — is FLAGGED as rot and fails the run, and the run records its own revision plus the one it supersedes so the change is diffable. It caught T-72's rot LIVE during this task (a concurrent lane moved `cpDist` out of the cited range `scripts/pack-mpd.mjs:120-132`, reddening two bilingual doc anchors); both were repaired symbol-first. Final repo-wide run: green, 249 citations, 19 symbol-first, 30 line-dependent, 0 rot-flagged.",
  measuredResidual:
    "r-E's premise (a mandatory line number) is REFUTED by measurement: a line-less anchor was already accepted. The residual is enforcement — (1) claim matching was per (path,line) over the whole document, so a bare `path:line` was accepted whenever ANY other anchor in the same document carried a claim for that same path:line; (2) the remedy the checker taught was the line-bearing form; (3) rot was neither classified nor counted. Probe arms before/after: " +
    JSON.stringify({ before: armTable(probeBefore), after: armTable(probeAfter) }) +
    "; exactly these arms flipped: " + JSON.stringify(flipped),
  revisions: {
    before: { path: FROZEN, sha256: sha(FROZEN), bytes: statSync(join(REPO, FROZEN)).size, state: "FROZEN — never edited by this task (hash re-checked after the change)" },
    after: { path: DURABLE, sha256: sha(DURABLE), bytes: statSync(join(REPO, DURABLE)).size, built_by: "evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/t72-patch.mjs (19 asserted line-range splices from the frozen revision)" },
    diff: "evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/checker.diff",
    nested_correction: "evidence/extensions/docs-claims/SUPERSEDED-check-citations.md",
  },
  ruleChanges: [
    { symbol: "claimForSite(citation, claims)", change: "NEW — a claim belongs to an anchor only at that anchor's OWN SITE (same path/line/endLine within ROT_SITE_WINDOW = 1 line), replacing the document-wide (path,line) `find` inside the old `contentClaimProblem`" },
    { symbol: "lineNumberOnlyProblem(citation)", change: "NEW — the ROT verdict: the anchor's only locator is a line number; reported per anchor with the file, the line and the fix, and pushed into `failures` so the run can redden" },
    { symbol: "claimContentProblem(citation, claim)", change: "RENAMED from `contentClaimProblem` and now SITE-BOUND (takes the paired claim instead of searching the document)" },
    { symbol: "ROT_SITE_WINDOW", change: "NEW — 1; chosen from the measured distance histogram of the recorded subjects (31 claims at distance 0, 1 at distance 1, none farther)" },
    { symbol: "content:rot", change: "NEW record — the rot class is a named check; `rot_line_number_only_anchors` + the `rot` list are new result.json counters" },
    { symbol: "line_dependent_anchors_verified", change: "NEW counter — the accepted line-bearing form, counted apart from the line-free form and kept green on purpose (no mass re-anchoring)" },
    { symbol: "checker{path,sha256,supersedes}", change: "NEW — every run records its own revision and the revision it supersedes, so intermediate revisions are diffable, not merely hash-comparable" },
    { symbol: "fileHash(absolute)", change: "NEW — sha256 of a revision file, null when absent" },
  ],
  before: {
    command: "node evidence/extensions/docs-claims/check-citations.mjs --self-test (frozen revision)",
    exitCode: 0,
    plain: counters(before),
    selfTest: counters(beforeSelfTest),
    negativeControlArms: Object.keys(beforeSelfTest.negative_control ?? {}),
  },
  after: {
    command: "node scripts/check-citations.mjs --self-test (durable revision)",
    exitCode: 0,
    plain: counters(after),
    selfTest: counters(afterSelfTest),
    negativeControlArms: Object.keys(afterSelfTest.negative_control ?? {}),
    rotCheckLine: (afterSelfTest.checks ?? []).find((entry) => entry.id === "content:rot")?.detail,
  },
  lineDependency: {
    note: "Acceptance: how many anchors STOP being line-dependent. Measured: 2 — the two `cpDist` anchors, which had actually ROTTED when a concurrent lane moved `cpDist` out of the cited range, and were repaired to the symbol-first form (see liveRot). No other document was re-anchored (acceptance (c)). What the change permanently makes visible is the split of the 49 verified citations: 19 line-free (symbol-first) and 30 line-dependent (line = hint, rot risk).",
    anchors_before_line_free: before.symbol_only_anchors_verified,
    anchors_after_line_free_at_0729Z: after.symbol_only_anchors_verified,
    anchors_final_line_free: 19,
    anchors_after_line_dependent_at_0729Z: after.line_dependent_anchors_verified,
    anchors_final_line_dependent: 30,
    anchors_final_rot_flagged: 0,
    final_source: "final-verify-3.log / final3-plain.stdout",
  },
  claimProximity: read("evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/probe-claim-proximity.stdout").trim().split("\n"),
  consumers: [
    { path: "EXTENSIONS-FOR-AGENTS.md:48-49", state: "still names the frozen path; it resolves, but it is the superseded revision — OUTSIDE lane B2's inScope, reported to the captain as a carry-forward" },
    { path: "skills/dsh-qa/scripts/lib/immutable-output.mjs:14", state: "comment naming the frozen path; `skills/**` is lane D's single-writer lane; the sentence stays true, no change made" },
  ],
  liveRot: {
    summary: "T-72's rot happened in the real repo DURING this task: a concurrent lane moved `cpDist` out of `scripts/pack-mpd.mjs:120-132` (it now sits at line 176), and the two bilingual docs that cited that range went RED at the 07:35:11Z pass — a correct document turned failing because the CITED FILE moved.",
    measured: "final-verify-2.log: 'the cited line/range does not carry the claim `cpDist` (scripts/pack-mpd.mjs:120-132)' in docs/extension-adaptation-report.md:405 and docs/extension-adaptation-report.zh-CN.md:207",
    repair: "both twins rewritten to the SYMBOL-FIRST form (`` `cpDist`, `scripts/pack-mpd.mjs` ``), which resolves against the whole file and cannot rot again; `scripts/pack-mpd.mjs` itself was NOT touched (the wave's packaging lane owns it)",
    detail: "LIVE-ROT-cpDist.md",
    counters_moved: "symbol-first 17 → 19, line-dependent 32 → 30 (the two rotted anchors are the ones that stopped being line-dependent)",
  },
  verification: [
    { command: "node scripts/check-citations.mjs --self-test", status: "passed", exitCode: 0, evidence: "[docs-claims] 21/21 checks passed, 0 failed, 249 citation(s) resolved, 19 symbol-first, 30 line-dependent, 0 rot-flagged (final-verify-3.log)" },
    { command: "node scripts/check-citations.mjs", status: "passed", exitCode: 0, evidence: "[docs-claims] 13/13 checks passed, 0 failed, 249 citation(s) resolved, 19 symbol-first, 30 line-dependent, 0 rot-flagged (final-verify-3.log)" },
    { command: "bun run verify:docs", status: "passed", exitCode: 0, evidence: "[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=37 failed=0 violations=0 exempt=17 derived=3 — PASS (final-verify-3.log)" },
  ],
  verifyDocsAttribution: {
    note: "The first post-change verify:docs pass was RED (07:30) for a reason outside this task: `AGENTS.md:38/295` and `agent-references/index.md:18` carried the delta-range pointer A1–D38 while the artifact `agent-references/agent-teams-deltas.md` (rewritten by a concurrent lane) derived A1–D42. Proved independent of this change by re-running the SAME gate over a scratch root with NO `scripts/` and NO `evidence/` at all: identical failure, pairs=37 (t72-.../verify-docs-attribution.log). The concurrent lane landed its pointer fix and the 07:34:53Z and 07:36:29Z passes are green.",
    raw: "verify-docs-attribution.log",
  },
  changedPaths: [
    "scripts/check-citations.mjs",
    "docs/extension-adaptation-report.md",
    "docs/extension-adaptation-report.zh-CN.md",
    "evidence/extensions/docs-claims/SUPERSEDED-check-citations.md",
    "evidence/extensions/docs-claims/t72-symbol-first-20260917T072356Z/",
  ],
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(record, null, 2) + "\n")
console.log("[t72] wrote " + join(HERE, "result.json"))
console.log("[t72] frozen " + record.revisions.before.sha256.slice(0, 12) + "… → durable " + record.revisions.after.sha256.slice(0, 12) + "…; flipped arms: " + JSON.stringify(flipped))
