#!/usr/bin/env node
// t27 evidence — the documentation assertion for the tuiRenderers disclosure and the revision binding.
//
// It FAILS when:
//   - either language lacks the tuiRenderers disclosure (surface named + both citations),
//   - either language still contains the superseded inline digest 710d3eef,
//   - either language lacks the delivered digest 5dce2563,
//   - either language lacks the delivered manifest digest 84ed4a5d,
//   - the four wiring gates (switch link, NOT-CLAIMED keys, forbidden wording, required vocabulary)
//     regress.
//
// Usage: node doc-assertion.mjs

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const DOCS = ["docs/tui.md", "docs/tui.zh-CN.md"];
const SUPERSEDED = "710d3eef";
const DELIVERED = "5dce2563";
const MANIFEST = "84ed4a5d";
const LANE = "evidence/tui/live/20260915T063140Z/result.json";
const CHECKER = "node evidence/tui/docs/20260915T060010Z/descriptor-check.mjs";

const checks = [];
const ok = (id, detail) => checks.push({ id, status: "passed", detail });
const bad = (id, detail) => checks.push({ id, status: "failed", detail });

const read = (file) => readFileSync(file, "utf8");

for (const file of DOCS) {
  const text = read(file);
  // The disclosure must name the surface, both citations and the 6-of-7 statement.
  if (text.includes("tuiRenderers")) ok(`${file}.names-surface`, "tuiRenderers named");
  else bad(`${file}.names-surface`, "tuiRenderers not named");
  if (text.includes("tuiRenderers\": false") || text.includes('"tuiRenderers": false'))
    ok(`${file}.cites-lane-result`, 'cites "tuiRenderers": false');
  else bad(`${file}.cites-lane-result`, "no tuiRenderers:false citation");
  if (text.includes("T8-LIVE-VERIFY.md:19")) ok(`${file}.cites-verify-line`, "cites T8-LIVE-VERIFY.md:19");
  else bad(`${file}.cites-verify-line`, "T8-LIVE-VERIFY.md:19 missing");
  if (/6\s*of\s*7|6\/7|6 of 7|七个中的六个|7 个中交付 6 个/.test(text) && /NOT-CLAIMED #10|明确不声明第 10 条|明确不\n?声明第 10 条/.test(text))
    ok(`${file}.six-of-seven-and-item-10`, "6-of-7 statement + NOT-CLAIMED #10 present");
  else bad(`${file}.six-of-seven-and-item-10`, "missing the 6-of-7 statement or the #10 item reference");
  if (/H1/.test(text) && /H2/.test(text) && /UNVERIFIED|尚未\s*证实/.test(text))
    ok(`${file}.h1-h2-limit`, "H1/H2 recorded as unverified");
  else bad(`${file}.h1-h2-limit`, "H1 vs H2 limit missing");

  if (!text.includes(SUPERSEDED)) ok(`${file}.no-superseded-digest`, `${SUPERSEDED} absent`);
  else bad(`${file}.no-superseded-digest`, `superseded digest ${SUPERSEDED} still inline`);
  if (text.includes(DELIVERED)) ok(`${file}.delivered-digest`, `${DELIVERED} present`);
  else bad(`${file}.delivered-digest`, `delivered digest ${DELIVERED} missing`);
  if (text.includes(MANIFEST)) ok(`${file}.manifest-digest`, `${MANIFEST} present`);
  else bad(`${file}.manifest-digest`, `manifest digest ${MANIFEST} missing`);
  if (text.includes("REVISION-BINDING.md")) ok(`${file}.points-at-chain`, "points at the revision-binding note");
  else bad(`${file}.points-at-chain`, "no pointer to the revision-binding note");

  // Wiring gates that must not regress (R7 switch link, R8 NOT-CLAIMED keys).
  if (/\[(中文|English)\]\(\.\/tui\./.test(text)) ok(`${file}.switch-link`, "language switch link present");
  else bad(`${file}.switch-link`, "switch link missing");
  const missing = ["NOT-CLAIMED", "decision-event", "admission", "0.1.5-rc.2", "web-only"].filter((k) => !text.includes(k));
  if (missing.length === 0) ok(`${file}.not-claimed-keys`, "R8 keys present");
  else bad(`${file}.not-claimed-keys`, `missing ${missing.join(", ")}`);

  // Wording guard (both languages).
  const forbidden = [
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
    "Fabric 就是标准实现",
    "所有 dsh 插件都必须遵守",
    "官方已经接受",
  ].filter((w) => text.includes(w));
  if (forbidden.length === 0) ok(`${file}.wording`, "0 forbidden phrases");
  else bad(`${file}.wording`, `forbidden: ${forbidden.join(", ")}`);

  const required = ["community draft", "tui-admission/0.15", "reference implementation", "experimental adaptation"];
  const missed = required.filter((w) => !text.includes(w));
  if (missed.length === 0) ok(`${file}.required-vocabulary`, "required vocabulary present");
  else bad(`${file}.required-vocabulary`, `missing ${missed.join(", ")}`);
}

// The panels row must no longer be "pending".
for (const file of DOCS) {
  const text = read(file);
  const pendingPanels = /panels lane \(t7\/t8\) is pending|面板通道（t7\/t8）[^）]*待完成/.test(text);
  if (pendingPanels) bad(`${file}.panels-not-pending`, "panels lane still marked pending");
  else ok(`${file}.panels-not-pending`, "panels lane no longer pending");
}

const report = {
  task: "t27 — tuiRenderers NOT-CLAIMED disclosure + revision binding",
  measuredAt: new Date().toISOString(),
  checks,
  digests: Object.fromEntries(
    [...DOCS, "dsh-plugin.json", "packages/mpd-tui-plugin/dist/index.js", "evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md"].map((f) => [
      f,
      createHash("sha256").update(readFileSync(f)).digest("hex"),
    ]),
  ),
  checker: CHECKER,
};
const failed = checks.filter((c) => c.status === "failed");
report.verdict = failed.length === 0 ? "passed" : "failed";
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
