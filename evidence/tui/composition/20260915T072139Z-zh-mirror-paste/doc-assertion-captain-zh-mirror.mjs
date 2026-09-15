#!/usr/bin/env node
// Captain-directed paste: the Chinese mirror of docs/tui.md §6.4 (+ the §4.1 pointer) into
// docs/tui.zh-CN.md, closing t30's T30-DOCS-1 (medium, unresolved) and the single failed check in
// t29's own doc-assertion.json (item3.docs/tui.zh-CN.md).
//
// The paste was a paste, not an authoring task: the payload is the pre-staged
// evidence/tui/composition/20260915T071619Z-docs-mpd-command/zh-6.4-snippet.md. This script
// therefore re-derives from the BYTES:
//   1. byte-exactness — every fenced block of the snippet is a literal substring of the doc;
//   2. the item3 intent — the harness `commands` service AND the `commands.dsh/v1alpha1` contract
//      are named in the Chinese page, and the §4.1 pointer is present;
//   3. the t29-predicate residual — t29's own positive branch is evaluated verbatim against BOTH
//      the document and the snippet it instructed to paste. It is FALSE for both, which is what
//      makes it a false negative by construction rather than a missing mirror; the corrected
//      predicate is the gate here, and the discrepancy is recorded, never rounded to "passed";
//   4. the invariants that must survive the paste — NOT-CLAIMED #10 in both languages, the absence
//      of the superseded digest, both language switch links, the forbidden wording, the four
//      frozen anchors, and t27's shipped checker re-run against the new bytes.
//
// Usage: node doc-assertion-captain-zh-mirror.mjs   (exit 0 = passed)

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const MANIFEST = "dsh-plugin.json";
const MANIFEST_SHA = "84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9";
const DIST = "packages/mpd-tui-plugin/dist/index.js";
const DIST_SHA = "5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f";
const PATCH = "packages/mpd-bundle/cordis.patch.yml";
const PATCH_SHA = "3866dc11b52aa3ae6fc49f8918d594729cd2bdc1144e1d563035ffee7db2e0cc";
const PRESET = "presets/mpd/agent.cordis.yml";
const PRESET_SHA = "0be8781f1570e9cac4e512bc26cbe30b4e398ac44a35141e3c2403869d910be1";

const SNIPPET = "evidence/tui/composition/20260915T071619Z-docs-mpd-command/zh-6.4-snippet.md";
const ZH = "docs/tui.zh-CN.md";
const EN = "docs/tui.md";
const BEFORE = "6e7a61a9ffcf5d030e3633d66a5f815da1b38d4355eede3bdf937b186fa1c0e7";

// t29's positive branch, transcribed verbatim from its doc-assertion-t29.mjs:102-110.
const T29_ZH_PREDICATE = /commands` service|commands 服务|commands 服务/;
// The corrected predicate: the command service name may be backticked (it is, in both languages).
const CORRECTED = /commands`? ?(service|服务)/;

const checks = [];
const ok = (id, detail) => checks.push({ id, status: "passed", detail });
const bad = (id, detail) => checks.push({ id, status: "failed", detail });
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const text = (f) => readFileSync(f, "utf8");

const zh = text(ZH);
const en = text(EN);
const snippet = text(SNIPPET);

// --- 1. the frozen anchors must not have moved -----------------------------------------------
for (const [label, file, want] of [
  ["manifest", MANIFEST, MANIFEST_SHA],
  ["entry", DIST, DIST_SHA],
  ["patch", PATCH, PATCH_SHA],
  ["preset", PRESET, PRESET_SHA],
]) {
  const got = sha(file);
  if (got === want) ok(`anchor.${label}`, `${file} still ${want.slice(0, 8)}…`);
  else bad(`anchor.${label}`, `${file} moved: ${got} (must stay ${want})`);
}

// --- 2. byte-exactness of the paste ----------------------------------------------------------
const blocks = [...snippet.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]);
if (blocks.length === 2) ok("paste.blocks-found", `snippet carries ${blocks.length} fenced payloads`);
else bad("paste.blocks-found", `expected 2 fenced payloads in ${SNIPPET}, found ${blocks.length}`);

blocks.forEach((block, i) => {
  const payload = block.replace(/\n+$/, "");
  const lines = payload.split("\n");
  const missingLines = lines.filter((l) => !zh.includes(l.replace(/\s+$/, "")));
  if (missingLines.length === 0)
    ok(`paste.block${i + 1}`, `${lines.length}/${lines.length} lines present verbatim in ${ZH}`);
  else bad(`paste.block${i + 1}`, `lines absent: ${JSON.stringify(missingLines.slice(0, 2))}`);
});

// --- 3. the item3 intent, and the t29 predicate's false negative ------------------------------
const zhIntent = CORRECTED.test(zh) && zh.includes("commands.dsh/v1alpha1");
if (zhIntent) ok("item3.zh-intent", "Chinese page names the harness `commands` service and the contract");
else bad("item3.zh-intent", "Chinese page does not name both the service and the contract");

const t29OnZh = T29_ZH_PREDICATE.test(zh);
const t29OnSnippet = T29_ZH_PREDICATE.test(snippet);
if (!t29OnZh && !t29OnSnippet)
  ok(
    "item3.t29-predicate-is-false-negative",
    "t29's zh branch is false for the document AND for the snippet it instructed to paste, so the pasted text is not the cause",
  );
else if (t29OnZh)
  bad("item3.t29-predicate-is-false-negative", "t29's zh branch is true — re-check which text satisfied it");
else bad("item3.t29-predicate-is-false-negative", "t29's zh branch passes on the snippet but not on the doc — the paste differs");

const enIntent = CORRECTED.test(en) && en.includes("commands.dsh/v1alpha1");
if (enIntent) ok("item3.en-intent", "English page names the harness `commands` service and the contract");
else bad("item3.en-intent", "English page does not name both the service and the contract");

// --- 4. invariants that must survive the paste ----------------------------------------------
for (const file of [EN, ZH]) {
  const t = text(file);
  const missing = [];
  if (!/NOT-CLAIMED #10|明确不声明第 10 条|明确不\n?声明第 10 条/.test(t)) missing.push("NOT-CLAIMED #10");
  if (t.includes("710d3eef")) missing.push("superseded 710d3eef must be absent");
  if (!t.includes("84ed4a5d")) missing.push("manifest digest 84ed4a5d");
  if (!t.includes("5dce2563")) missing.push("entry digest 5dce2563");
  if (!/\[(中文|English)\]\(\.\/tui\./.test(t)) missing.push("switch link");
  if (!t.includes("tuiRenderers")) missing.push("tuiRenderers named");
  if (missing.length === 0) ok(`invariants.${file}`, "not-claimed item, digests, switch link intact");
  else bad(`invariants.${file}`, `missing/violations: ${missing.join(", ")}`);
}

for (const [w, label] of [
  ["官方认证", "official certification"],
  ["安全插件", "security plug-in"],
  ["无漏洞", "vulnerability-free"],
  ["兼容所有 DSH Host", "compatible with all DSH hosts"],
]) {
  if (zh.includes(w)) bad("wording.zh-CN", `forbidden phrase present: ${w} (${label})`);
}
ok("wording.zh-CN", "no forbidden certification wording in the pasted page");

// --- 5. the shipped checker, re-run against the new bytes ------------------------------------
const T27_CHECKER = "evidence/tui/docs/20260915T070743Z/doc-assertion.mjs";
if (existsSync(T27_CHECKER))
  ok("t27-checker.present", `${T27_CHECKER} present (run separately; its stdout is raw/t27-doc-assertion.json)`);
else bad("t27-checker.present", `${T27_CHECKER} absent`);

const report = {
  task: "captain-directed paste — Chinese mirror of §6.4 + the §4.1 pointer into docs/tui.zh-CN.md",
  closes: "t30 T30-DOCS-1 (medium, unresolved) / t29 doc-assertion item3.docs/tui.zh-CN.md",
  measuredAt: new Date().toISOString(),
  anchors: { manifest: sha(MANIFEST), entry: sha(DIST), patch: sha(PATCH), preset: sha(PRESET) },
  docs: {
    "docs/tui.md": { sha256: sha(EN), note: "unchanged by this paste (t29 landed the English half)" },
    "docs/tui.zh-CN.md": { sha256Before: BEFORE, sha256After: sha(ZH), advancedBy: "captain-directed paste" },
  },
  t29PredicateResidual: {
    predicate: String(T29_ZH_PREDICATE),
    onZhDocument: t29OnZh,
    onPreStagedSnippet: t29OnSnippet,
    reading:
      "t29's zh branch looks for `commands service` / `commands 服务` without the backtick the payload actually carries; it is false for the payload itself, so it cannot witness the mirror. Not a doc defect; recorded as a checker under-specification for the delivery report.",
  },
  checks,
};
const failed = checks.filter((c) => c.status === "failed");
report.verdict = failed.length === 0 ? "passed" : "failed";
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
