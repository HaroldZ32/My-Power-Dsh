#!/usr/bin/env node
// t29 evidence — verify the t27 repair against the BYTES, plus the /mpd commands-service disclosure.
//
// The task's dispatch says: verify against the bytes rather than re-editing. This script therefore
// re-derives, from the files on disk, every claim t29's acceptance makes:
//   item 1 — the 10th NOT-CLAIMED item for tuiRenderers in BOTH languages with both citations,
//            the 6-of-7 statement, the honest limits, and the softened renderer assertions;
//   item 2 — the §11 revision binding to manifest 84ed4a5d… + entry 5dce2563…, delivered lane
//            evidence per row, and ZERO occurrences of the superseded 710d3eef;
//   item 3 — the /mpd commands-service disclosure in docs/tui.md (the only doc in this task's
//            inScope) and the frozen manifest digest, which must NOT have moved.
//
// Usage: node doc-assertion-t29.mjs

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const MANIFEST = "dsh-plugin.json";
const MANIFEST_SHA = "84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9";
const DIST = "packages/mpd-tui-plugin/dist/index.js";
const DIST_SHA = "5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f";
const T27_EN_SHA = "1afda0fd7a88d8274cf67964f1da63856f1937a2db3d732daa429b7b13807a9c";
const T27_ZH_SHA = "6e7a61a9ffcf5d030e3633d66a5f815da1b38d4355eede3bdf937b186fa1c0e7";
const PENDING_T27 = ["docs/tui.zh-CN.md", "evidence/tui/docs/"];

const checks = [];
const ok = (id, detail) => checks.push({ id, status: "passed", detail });
const bad = (id, detail) => checks.push({ id, status: "failed", detail });
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const text = (f) => readFileSync(f, "utf8");

// --- the frozen anchors must not have moved ------------------------------------------------
if (sha(MANIFEST) === MANIFEST_SHA) ok("manifest-unmoved", `${MANIFEST} still ${MANIFEST_SHA.slice(0, 8)}…`);
else bad("manifest-unmoved", `${MANIFEST} moved: ${sha(MANIFEST)} (must stay ${MANIFEST_SHA})`);
if (sha(DIST) === DIST_SHA) ok("entry-unmoved", `${DIST} still ${DIST_SHA.slice(0, 8)}…`);
else bad("entry-unmoved", `${DIST} moved: ${sha(DIST)}`);

// --- item 1: the tuiRenderers disclosure, both languages ------------------------------------
for (const file of ["docs/tui.md", "docs/tui.zh-CN.md"]) {
  const t = text(file);
  const missing = [];
  if (!t.includes("tuiRenderers")) missing.push("tuiRenderers named");
  if (!t.includes('"tuiRenderers": false')) missing.push('"tuiRenderers": false');
  if (!t.includes("T8-LIVE-VERIFY.md:19")) missing.push("T8-LIVE-VERIFY.md:19");
  if (!/6 of 7|6\/7|七个中的六个|7 个中交付 6 个/.test(t)) missing.push("6-of-7 statement");
  if (!/H1/.test(t) || !/H2/.test(t) || !/UNVERIFIED|尚未\s*证实/.test(t)) missing.push("H1/H2 limit");
  if (!/NOT-CLAIMED #10|明确不声明第 10 条|明确不\n?声明第 10 条/.test(t)) missing.push("#10 reference");
  if (t.includes("710d3eef")) missing.push("superseded 710d3eef must be absent");
  if (!t.includes("5dce2563")) missing.push("delivered 5dce2563 absent");
  if (missing.length === 0) ok(`item1.${file}`, "renderer disclosure, citations, limits present; no superseded digest");
  else bad(`item1.${file}`, `missing/!ok: ${missing.join(", ")}`);
}

// The softened assertions: the §1 table and the equivalence row must not present the renderer as delivered.
for (const file of ["docs/tui.md", "docs/tui.zh-CN.md"]) {
  const t = text(file);
  const softened =
    !/status line, transcript renderers,/.test(t) &&
    !/状态行、转写渲染器、/.test(t) &&
    /not projected by the host|宿主未投影|宿主不投影/.test(t);
  if (softened) ok(`item1.softened.${file}`, "renderer no longer asserted as a delivered surface");
  else bad(`item1.softened.${file}`, "renderer still presented as delivered");
}

// --- item 2: revision binding ---------------------------------------------------------------
for (const file of ["docs/tui.md", "docs/tui.zh-CN.md"]) {
  const t = text(file);
  const missing = [];
  if (!t.includes("84ed4a5d")) missing.push("manifest digest 84ed4a5d");
  if (!t.includes("5dce2563")) missing.push("entry digest 5dce2563");
  if (!t.includes("62bb7e7") === false) {
    /* full manifest hex is only in the en doc's binding block; the prefix check above is the gate */
  }
  if (!/REVISION-BINDING\.md/.test(t)) missing.push("pointer to REVISION-BINDING.md");
  if (!/evidence\/tui\/live\/20260915T063140Z/.test(t)) missing.push("t8 live lane evidence");
  if (!/evidence\/tui\/conformance\/20260915T064521Z/.test(t)) missing.push("t9 conformance evidence");
  if (/panels lane \(t7\/t8\) is pending|面板通道（t7\/t8）[^）]*待完成/.test(t)) missing.push("panels lane still pending");
  if (missing.length === 0) ok(`item2.${file}`, "bound to delivered digests + delivered lane evidence; no pending panels row");
  else bad(`item2.${file}`, `missing/!ok: ${missing.join(", ")}`);
}
if (existsSync("evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md")) {
  const rb = text("evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md");
  if (rb.includes("710d3eef") && rb.includes("695f68c4") && rb.includes("5dce2563") && /histor/i.test(rb))
    ok("item2.chain-note", "the full chain is recorded as history in REVISION-BINDING.md");
  else bad("item2.chain-note", "REVISION-BINDING.md does not carry the full chain as history");
} else bad("item2.chain-note", "REVISION-BINDING.md missing");

// --- item 3: the /mpd commands-service disclosure (docs-side, in-scope doc) -----------------
{
  const t = text("docs/tui.md");
  const missing = [];
  if (!/commands` service|commands service/.test(t)) missing.push("harness `commands` service");
  if (!t.includes("commands.dsh/v1alpha1")) missing.push("commands.dsh/v1alpha1 contract");
  if (!t.includes("contributes.commands: []")) missing.push("contributes.commands: []");
  if (!/commands\.invoke/.test(t)) missing.push("commands.invoke permission");
  if (!/undeclared/.test(t)) missing.push("undeclared ledger consequence");
  if (!/src\/commands\.ts:53-60/.test(t)) missing.push("src/commands.ts:53-60");
  if (!/review\/t12\/REVIEW\.md:62/.test(t)) missing.push("t12 citation");
  if (missing.length === 0) ok("item3.docs/tui.md", "commands-service rationale sharpened docs-side");
  else bad("item3.docs/tui.md", `missing: ${missing.join(", ")}`);

  const zh = text("docs/tui.zh-CN.md");
  if (/commands` service|commands 服务|commands 服务/.test(zh) && zh.includes("commands.dsh/v1alpha1")) {
    ok("item3.docs/tui.zh-CN.md", "zh mirror landed");
  } else {
    bad(
      "item3.docs/tui.zh-CN.md",
      "zh mirror NOT landed — docs/tui.zh-CN.md is not in this task's inScope; the ready-to-paste Chinese text is zh-6.4-snippet.md in this evidence directory",
    );
  }
}

// --- wiring gates must not regress ---------------------------------------------------------
for (const file of ["docs/tui.md", "docs/tui.zh-CN.md"]) {
  const t = text(file);
  const missing = [];
  if (!/\[(中文|English)\]\(\.\/tui\./.test(t)) missing.push("switch link");
  for (const k of ["NOT-CLAIMED", "decision-event", "admission", "0.1.5-rc.2", "web-only"])
    if (!t.includes(k)) missing.push(`R8 key ${k}`);
  for (const w of [
    "官方认证",
    "official certification",
    "安全插件",
    "security plug-in",
    "无漏洞",
    "vulnerability-free",
    "兼容所有 DSH Host",
    "compatible with all DSH hosts",
    "官方标准规定",
    "dsh 官方认证",
    "TUI 验证所以安全",
  ])
    if (t.includes(w)) missing.push(`forbidden ${w}`);
  if (missing.length === 0) ok(`wiring.${file}`, "switch link, R8 keys, wording clean");
  else bad(`wiring.${file}`, `missing/violations: ${missing.join(", ")}`);
}

const report = {
  task: "t29 — repair-round-3 verification (bytes) + /mpd commands-service disclosure",
  measuredAt: new Date().toISOString(),
  anchors: { manifest: sha(MANIFEST), entry: sha(DIST) },
  docDigestsAtT27: { "docs/tui.md": T27_EN_SHA, "docs/tui.zh-CN.md": T27_ZH_SHA },
  docDigestsNow: { "docs/tui.md": sha("docs/tui.md"), "docs/tui.zh-CN.md": sha("docs/tui.zh-CN.md") },
  pendingAmendmentForT27Scope: PENDING_T27,
  checks,
};
const failed = checks.filter((c) => c.status === "failed");
report.verdict = failed.length === 0 ? "passed" : "failed";
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
