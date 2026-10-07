#!/usr/bin/env node
// Assemble t27's evidence record from the artifacts this repair produced: the two arm-set runs (the
// reviewer's own arms, re-run before and after), the two Pinned verification runs, and the hashes of
// both checker revisions.
import { createHash } from "node:crypto"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const json = (p) => JSON.parse(readFileSync(join(HERE, p), "utf8"))
const sha = (rel) => createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex")
const size = (rel) => statSync(join(REPO, rel)).size

const before = json("arm-set-before.json")
const final = json("arm-set-final.json")
const movement = []
for (const id of Object.keys(before.arms)) {
  for (const revision of ["frozen", "durable"]) {
    const from = before.arms[id][revision].exitCode
    const to = final.arms[id][revision].exitCode
    if (from !== to) movement.push({ arm: id, revision, from, to })
  }
}
const selftest = json("run-selftest-final/result.json")
const plain = json("run-plain-final/result.json")
const counters = (report) => ({
  checks: `${report.passed}/${report.total}`,
  citations_checked: report.citations_checked,
  symbol_only_anchors_verified: report.symbol_only_anchors_verified,
  line_dependent_anchors_verified: report.line_dependent_anchors_verified,
  rot_line_number_only_anchors: report.rot_line_number_only_anchors,
})

const record = {
  task: "t27",
  kind: "repair",
  findings: ["t16-F3 (medium): symbol-first claims matched DOCUMENT-WIDE", "t16-F1 (low): hard-coded foreign attempt_id in every run record"],
  source: "independent review t17 (evidence/review/t17-symbol-first/20260917T074037Z/)",
  agent: "citation-checker-engineer",
  attemptId: "c85b2457-d39a-46d3-9b61-0362d49b6368",
  date: "2026-09-17",
  headline:
    "F3 closed by binding the line-free claim to the ANCHOR'S SITE (`claimForSite() ?? forPath[0]`): the t17 reviewer's own arm set moves exactly ONE exit code — `symbol-first-right-then-wrong [durable] 0 → 1` — with zero movement on the frozen revision and zero on any other arm; F1 closed by deleting the hard-coded `attempt_id` (grep for the old id in the checker and in every run record: 0). Counters unchanged (13/13, 249 citations, 19 symbol-first / 30 line-dependent / 0 rot); `--self-test` 21/21 → 22/22.",
  revisions: {
    frozen_evidence_side: { path: "evidence/extensions/docs-claims/check-citations.mjs", sha256: sha("evidence/extensions/docs-claims/check-citations.mjs"), bytes: size("evidence/extensions/docs-claims/check-citations.mjs"), state: "BYTE-UNTOUCHED by this repair (hash re-measured after the work)" },
    durable_before: { path: "scripts/check-citations.mjs", sha256: "d64dfeb52d3b6c9d18acee5c7e9d8685c82b847e44a4f6f4ef94f21eb1f45c13" },
    durable_after: { path: "scripts/check-citations.mjs", sha256: sha("scripts/check-citations.mjs"), bytes: size("scripts/check-citations.mjs") },
  },
  F3: {
    rule: "`symbolOnlyClaimCheck()` now resolves the claim through `claimForSite(citation, claims)` — the anchor's OWN site (|docLine delta| ≤ ROT_SITE_WINDOW = 1) — and falls back to the document-wide first claim ONLY when the anchor carries no claim of its own.",
    why_the_fallback_survives: "The form is opt-in per anchor; measured on the real subjects (probe-line-free-claim-distance.stdout): 160 line-free path citations, 141 with no claim at all, 16 claims at distance 0, 1 at distance 1, and 2 anchors verified by a claim 19/28 lines away that they cannot mean otherwise. Removing the fallback would have silently un-verified those 2 (a counter change with no defect behind it).",
    message_now_names_the_fix: "`the cited file does not contain the claim \\`X\\` (<path>) — cite a symbol the cited file declares (T-55), or drop the claim if this anchor is a plain path reference`",
    shipped_arm: "`negative-control:symbol-first-right-then-wrong` (fixture: correct claim first, WRONG claim later for the same path) — exit 1 with file, doc line and fix named; raw output `new-arm-raw.out`",
  },
  F1: {
    rule: "the hard-coded `attempt_id` line was REMOVED from the run report (no consumer reads the field: grepped `scripts/`, `skills/`, `packages/`)",
    proof: "`grep -c d1cf78ee scripts/check-citations.mjs` → 0; the key is absent from both pinned run records (`\"attempt_id\" in result.json` → false); no run record in this evidence dir contains the old id",
    replaced_by: "the revision identity `checker{path, sha256, supersedes}` (t16), which is the honest provenance",
  },
  reviewer_arm_set: {
    instrument: "the t17 reviewer's arms, copied from `evidence/review/t17-symbol-first/20260917T074037Z/my-fixture-runner.mjs` into this inScope dir (`reviewer-arm-set.mjs`); the arms and fixture shapes are verbatim, only the repo-root resolution and the output dir are mechanical changes (their directory is sealed and outside this task's inScope)",
    arms: Object.keys(before.arms).length,
    movements: movement,
    movement_total: movement.length,
    frozen_revision_movements: movement.filter((entry) => entry.revision === "frozen").length,
    raw: { before: "arm-set-before.json", final: "arm-set-final.json", stdout: "arm-set-final.stdout" },
  },
  verify: [
    { command: "node scripts/check-citations.mjs --self-test --out <inScope>", status: "passed", exitCode: 0, evidence: `${counters(selftest).checks} checks passed, 0 failed — 22/22 (was 21/21); 9 negative-control arms (was 8); ${counters(selftest).citations_checked} citations`, raw: "selftest-final.stdout" },
    { command: "node scripts/check-citations.mjs --out <inScope>", status: "passed", exitCode: 0, evidence: `${counters(plain).checks} checks passed, 0 failed — ${counters(plain).citations_checked} citation(s), ${counters(plain).symbol_only_anchors_verified} symbol-first, ${counters(plain).line_dependent_anchors_verified} line-dependent, ${counters(plain).rot_line_number_only_anchors} rot-flagged (UNCHANGED from the pre-repair reading)`, raw: "plain-final.stdout" },
  ],
  scope: {
    inScope: ["scripts/check-citations.mjs", "evidence/gates/**"],
    no_skills_touched: "no write to any `skills/**` path",
    no_repack: "`dist/mpd-package/**` untouched — `dist/mpd-package/EXTENSIONS-FOR-AGENTS.md` still carries its 2026-09-17T05:19:48Z pack stamp",
    frozen_copy_untouched: true,
  },
  artifacts: ["hashes-before.txt", "hashes-after.txt", "probe-line-free-claim-distance.mjs", "probe-line-free-claim-distance.stdout", "reviewer-arm-set.mjs", "arm-set-before.json", "arm-set-final.json", "arm-movement.txt", "arm-movement-final.txt", "new-arm-raw.out", "selftest-final.stdout", "plain-final.stdout", "run-selftest-final/", "run-plain-final/"],
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(record, null, 2) + "\n")
console.log("[t27] wrote result.json — durable " + record.revisions.durable_before.sha256.slice(0, 12) + "… → " + record.revisions.durable_after.sha256.slice(0, 12) + "…, movements: " + JSON.stringify(movement))
