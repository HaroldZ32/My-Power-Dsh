// Builds result.json for t16 / wave-2b lane B3. Kept with the evidence so the record is reproducible.
import { writeFileSync, statSync } from "node:fs";

const out = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const result = {
  task: "t16 — wave-2b lane B3 (docs & doctrine): 6 rows + 2 packed-file edits, pre-pack",
  attempt_id: "7c3927d3-f634-400d-9e79-1c7e7c85e6b5",
  owner: "docs-parity-engineer (lane B3)",
  head: "ca78033",
  generated_at: new Date().toISOString(),
  rows: {
    "T-28": "POLICY SENTENCE landed in the AGENTS.md Language policy: `agent-references/**` is the agent-facing English-only band the docs gate deliberately does NOT discover; the register shape `docs/agent/**` is explicitly NOT used, and that substitution is stated. Census proof: no agent-references/ path among the checked pairs.",
    "T-29": "DECLARED classification in scripts/verify-docs-parity.mjs: bands `docs/**` and `*/README.md` (extensions + templates) plus the promotion marker `<!-- docs-parity: doc -->`, which makes any *.md a doc wherever it lives. `templates/**` joined discovery, so the template pair is now POLICED; a misplaced promoted doc reddens; an unmarked non-README *.md stays an ASSET. Self-test arms: 3 (policed pair, asset stays asset, promoted doc reddens).",
    "T-30": "Exemptions are DERIVED from the file: the in-file marker `<!-- docs-parity: exempt <reason> -->`, the declared `docs/plan-*.md` pattern, and a tiny provenance map for bytes that must stay verbatim. The seven previously-mapped docs carry their own marker now; the TWO ANTICIPATORY paths are printed as their own class, so an exemption for a file that does not exist can never rot silently. Self-test arms: 3 (marker exempts, unmarked violates, anticipatory reported).",
    "T-47": "The templates/mpd-extension README PAIR quotes ALL 13 manifest field values verbatim (EN + zh-CN, same change), and section 6 was corrected from memory to measurement. Prober: BEFORE 2/13 quoted / 11 not-quoted -> AFTER 13/13 quoted / 0 not-quoted / 0 findings; prober --self-test 5/5 including the mutation arm.",
    "T-91": "AGENTS.md gains the Pack-closure row in the §4 gate table, the post-t26 BOUND paragraph (freshness read from the `expected-after-pack` membership at the re-pack, timestamp order, `--pack-stamp`; the closure gate's own self-test arms are the operative evidence), and §11 names the gate in the release sweep. Amendment A5 applied: AGENTS.md is NOT packed (packer comment read at scripts/pack-mpd.mjs:128) while `templates/**` IS in ROOT_ASSET_DIRS.",
    "T-90": "Doctrine landed in AGENTS.md §7: an ARTIFACT PATH is the anchor, the relay is secondary, a mailbox id is provenance rather than an anchor; the copy-the-quoted-bytes operational half; the CLASS clause and the calibration bound (31 of 31 shape-scan hits were false positives).",
    "T-88": "Doctrine landed in AGENTS.md §7: derived surfaces (`packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`) are DECLARED on the integration task at CREATION; the mid-wave escape is a HOP (one message, the exact amendment text, no work attached); a LANE must not declare a `dist/**` pattern for itself (the platform inScope-overlap refusal is quoted).",
  },
  packer_readings: {
    "templates packed?": "MEASURED: `templates` IS in scripts/pack-mpd.mjs ROOT_ASSET_DIRS (symbol read there), and dist/mpd-package/templates/mpd-extension exists in the canonical artifact.",
    "AGENTS.md packed?": "MEASURED FALSE: the packer comment at scripts/pack-mpd.mjs:128 — AGENTS.md deliberately stays out of the artifact (amendment A5).",
  },
  readings: {
    gate_live: "node scripts/verify-docs-parity.mjs exit 0 — pairs=38 failed=0 violations=0 exempt=19 derived=3 PASS (14:28:21Z, HEAD ca78033)",
    gate_selftest: "node scripts/verify-docs-parity.mjs --self-test exit 0 — 27/27 checks (6 new T-29/T-30 arms)",
    census: "--json census: pairs 38, violations 0, exemptNotes 19, ok true",
    budget: "node ./evidence/gates/agents-budget/20260917T011651Z/budget-check.mjs agents=AGENTS.md -> GREEN (full content injected); AGENTS.md 53,283 B against maxBytes 65,536",
    prober_before: "13 field-probes, quoted 2, not-quoted 11 (debranding-before.json)",
    prober_after: "13 field-probes, quoted 13, not-quoted 0, 0 findings (debranding-after.json); --self-test 5/5",
    closure_selftest_red: "node scripts/verify-pack-closure.mjs --self-test exit 1 — 33/34 arms; the failing arm is the negative control (same mutation, stamp pinned -> hard CONTENT-DRIFT, exit 1) which returned exit 0. CROSS-LANE RED: that gate is lane B write set, NOT this lane; recorded here per A2.1 and routed to lane B / integration, NOT in this lane verify list.",
  },
  changed_paths: [
    "scripts/verify-docs-parity.mjs",
    "AGENTS.md",
    "templates/mpd-extension/README.md",
    "templates/mpd-extension/README.zh-CN.md",
    "docs/decisions.md",
    "docs/bline-report.md",
    "docs/omo-parity-gap.md",
    "docs/review-p0-p3.md",
    "docs/track-a-report.md",
    "docs/ulw-deepseek-optimization.md",
    "docs/tui-edition-report.md",
  ],
  note: "The seven docs/** edits are the T-30 markers (one comment line, first line of each file). All seven are process records exempt from the bilingual rule; none gained a twin and none needed one.",
};

writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2) + "\n");
console.log("result.json written:", statSync(`${out}/result.json`).size, "bytes");
