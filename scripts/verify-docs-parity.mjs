#!/usr/bin/env node
// Repo gate: the bilingual documentation policy of AGENTS.md (Language policy section).
//
// WHY THIS EXISTS: the policy was previously unenforced — `scripts/pack-mpd.mjs` COPIES each
// package's README pair without asserting anything, and the QA lanes only read single docs. This
// gate was promoted from the prototype written during the docs task
// (`evidence/tui/docs-completeness/20260915T153835Z/docs-parity.mjs`, 87/87 on its five pairs).
//
// For every bilingual pair it asserts:
//   1. both files exist;
//   2. a switch link sits directly under the title and points at the twin;
//   3. the heading TREE (levels + order, fenced code excluded) is identical;
//   4. the zh-CN file actually carries CJK content (a copy-paste of the English file fails).
//
// Usage:
//   node scripts/verify-docs-parity.mjs [--root <dir>] [--json <path>]
//   node scripts/verify-docs-parity.mjs --self-test
//
// Exit: 0 when every checked pair passes (exemptions are reported, never silent), 1 otherwise.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Files the AGENTS.md Language policy exempts. An exemption means ONLY that a missing zh twin is
// not a violation; it never suppresses the checks for a pair that exists — an exempt file that
// GAINS a zh-CN twin is checked like any other pair (and must then satisfy all four rules).
const EXEMPT_LONE_FILES = new Map([
  ["docs/plan-c.md", "process record (AGENTS.md §3: plan-*.md)"],
  ["docs/plan-d.md", "process record (AGENTS.md §3: plan-*.md)"],
  ["docs/plan-e.md", "process record (AGENTS.md §3: plan-*.md)"],
  ["docs/plan-f.md", "process record (AGENTS.md §3: plan-*.md)"],
  ["docs/plan-tui-edition.md", "process record (AGENTS.md §3: plan-*.md)"],
  ["docs/decisions.md", "process record (AGENTS.md §3)"],
  ["docs/bline-report.md", "prior-phase report (AGENTS.md §3)"],
  ["docs/omo-parity-gap.md", "prior-phase report (AGENTS.md §3)"],
  ["docs/review-p0-p3.md", "prior-phase report (AGENTS.md §3)"],
  ["docs/track-a-report.md", "prior-phase report (AGENTS.md §3)"],
  ["docs/ulw-deepseek-optimization.md", "prior-phase report (AGENTS.md §3)"],
  ["docs/adder4.md", "internal QA/golden reference (AGENTS.md §3)"],
  ["docs/cnt8.md", "internal QA/golden reference (AGENTS.md §3)"],
  ["docs/tui-edition-report.md", "prior-phase report (the TUI edition delivery report) — named in the AGENTS.md Language-policy enumeration of exempt prior-phase reports (captain ruling on T60-F1)"],
  ["packages/mpd-agent-teams-plugin/README.md", "adopted upstream main code, kept verbatim as provenance"],
]);
const EXEMPT_WITHOUT_README = new Map([
  ["packages/mpd-mcp-shared", "ships source and tests only; its README pair is a recorded follow-up"],
]);
// `docs/plan-*.md` is a glob in the policy, so the exemption set is extended at discovery time.
const isExemptLone = (rel) => EXEMPT_LONE_FILES.has(rel) || /^docs\/plan-[^/]+\.md$/.test(rel);

const readIf = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const switchLinkUnderTitle = (text, twinBase) => {
  const head = text.split("\n").slice(0, 8).join("\n");
  if (!/^#\s+\S/m.test(head)) return false;
  return new RegExp(`\\]\\((?:\\./)?${twinBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`).test(head);
};
const headingTree = (text) => {
  const out = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (match !== null) out.push(match[1].length);
  }
  return out;
};
const hasCjk = (text) => /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);

function discoverPairs(root) {
  const pairs = [];
  const exemptNotes = [];
  const push = (en, zh) => pairs.push({ en, zh });
  if (existsSync(join(root, "README.md"))) push("README.md", "README.zh-CN.md");
  for (const dir of ["docs", "extensions"]) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".zh-CN.md")) continue;
      const rel = `${dir}/${entry.name}`;
      const twin = `${dir}/${entry.name.replace(/\.md$/, ".zh-CN.md")}`;
      if (!existsSync(join(root, twin)) && isExemptLone(rel)) {
        exemptNotes.push({ path: rel, reason: /^docs\/plan-/.test(rel) ? "process record (AGENTS.md §3: plan-*.md)" : EXEMPT_LONE_FILES.get(rel) });
        continue;
      }
      push(rel, twin);
    }
  }
  const pkgs = join(root, "packages");
  if (existsSync(pkgs)) {
    for (const entry of readdirSync(pkgs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const rel = `packages/${entry.name}/README.md`;
      if (!existsSync(join(root, rel))) {
        if (EXEMPT_WITHOUT_README.has(`packages/${entry.name}`)) {
          exemptNotes.push({ path: `packages/${entry.name}`, reason: EXEMPT_WITHOUT_README.get(`packages/${entry.name}`) });
          continue;
        }
        exemptNotes.push({ path: `packages/${entry.name}`, reason: "NO README — not exempt; reported as a finding by this gate" });
        continue;
      }
      if (!existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`)) && isExemptLone(rel)) {
        exemptNotes.push({ path: rel, reason: EXEMPT_LONE_FILES.get(rel) });
        continue;
      }
      push(rel, `packages/${entry.name}/README.zh-CN.md`);
    }
  }
  return { pairs, exemptNotes };
}

export function verifyDocsParity(root) {
  const { pairs, exemptNotes } = discoverPairs(root);
  const checks = [];
  const add = (pair, id, ok, detail) => checks.push({ pair, id, ok: Boolean(ok), detail: String(detail) });
  const summaries = [];
  for (const { en, zh } of pairs) {
    const enText = readIf(join(root, en));
    const zhText = readIf(join(root, zh));
    const failed = [];
    if (enText === null) failed.push("missing EN file");
    if (zhText === null) failed.push("missing zh-CN file");
    if (enText !== null && zhText !== null) {
      const zhBase = zh.split("/").at(-1);
      const enBase = en.split("/").at(-1);
      if (!switchLinkUnderTitle(enText, zhBase)) failed.push("EN switch link missing/not under the title");
      if (!switchLinkUnderTitle(zhText, enBase)) failed.push("zh-CN switch link missing/not under the title");
      const a = headingTree(enText);
      const b = headingTree(zhText);
      if (a.length !== b.length || a.some((level, index) => level !== b[index]))
        failed.push(`heading tree differs: EN [${a.join(",")}] vs zh [${b.join(",")}]`);
      if (!hasCjk(zhText)) failed.push("zh-CN file carries no CJK content (copy-paste of the EN file?)");
    }
    add(en, `pair:${en}`, failed.length === 0, failed.length === 0 ? "ok" : failed.join("; "));
    summaries.push({ pair: en, ok: failed.length === 0, problems: failed });
  }
  return { pairs: summaries, checks, exemptNotes, ok: summaries.every((s) => s.ok) };
}

function printReport(result, root) {
  for (const summary of result.pairs)
    console.log(`${summary.ok ? "ok  " : "FAIL"} ${summary.pair}${summary.ok ? "" : " — " + summary.problems.join("; ")}`);
  for (const note of result.exemptNotes) console.log(`skip ${note.path} — EXEMPT: ${note.reason}`);
  const pairs = result.pairs.length;
  const failed = result.pairs.filter((s) => !s.ok).length;
  console.log(`\n[verify-docs-parity] root=${root} pairs=${pairs} failed=${failed} exempt=${result.exemptNotes.length} — ${result.ok ? "PASS" : "FAIL"}`);
}

function selfTest() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-docs-parity-selftest-"));
  const cases = [];
  const write = (rel, text) => {
    const abs = join(sandbox, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const good = (title, marker) =>
    `# ${title}\n\n**English** | [中文](./X.zh-CN.md)\n\n${marker}\n\n## One\n\ntext\n\n### Deep\n\nmore\n\n## Two\n\nend\n`;
  try {
    // 1. a clean fixture tree passes, including an extensions pair.
    write("README.md", good("Root", "Hello").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("README.zh-CN.md", `# 根\n\n[English](./README.md)\n\n你好\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`);
    write("docs/guide.md", good("Guide", "Body").replace("./X.zh-CN.md", "./guide.zh-CN.md"));
    write("docs/guide.zh-CN.md", `# 指南\n\n[English](./guide.md)\n\n正文\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`);
    write("extensions/README.md", good("Ext", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/README.zh-CN.md", `# 扩展\n\n[English](./README.md)\n\n正文\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`);
    write("packages/alpha/README.md", good("Alpha", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("packages/alpha/README.zh-CN.md", `# 甲\n\n[English](./README.md)\n\n正文\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`);
    write("docs/decisions.md", "# Decisions\n\nno twin needed\n");
    for (const rel of [
      "docs/plan-c.md", "docs/plan-d.md", "docs/plan-e.md", "docs/plan-f.md", "docs/plan-tui-edition.md",
      "docs/bline-report.md", "docs/omo-parity-gap.md", "docs/review-p0-p3.md", "docs/track-a-report.md",
      "docs/ulw-deepseek-optimization.md", "docs/adder4.md", "docs/cnt8.md", "docs/tui-edition-report.md",
    ])
      write(rel, `# ${rel}\n\nprocess record, no twin by policy\n`);
    write("packages/mpd-mcp-shared/src/index.ts", "export {}\n");
    write("packages/mpd-agent-teams-plugin/README.md", "# upstream verbatim\n");
    const clean = verifyDocsParity(sandbox);
    cases.push({ case: "clean tree passes", ok: clean.ok, detail: `pairs=${clean.pairs.length} exempt=${clean.exemptNotes.length}` });
    const expectedExempt = [
      ...["docs/plan-c.md", "docs/plan-d.md", "docs/plan-e.md", "docs/plan-f.md", "docs/plan-tui-edition.md",
        "docs/bline-report.md", "docs/omo-parity-gap.md", "docs/review-p0-p3.md", "docs/track-a-report.md",
        "docs/ulw-deepseek-optimization.md", "docs/adder4.md", "docs/cnt8.md", "docs/tui-edition-report.md",
        "docs/decisions.md", "packages/mpd-agent-teams-plugin/README.md", "packages/mpd-mcp-shared"],
    ];
    const missingExempt = expectedExempt.filter((rel) => !clean.exemptNotes.some((n) => n.path === rel));
    cases.push({
      case: "EVERY documented exemption is asserted (reported with its reason, never a silent skip)",
      ok: missingExempt.length === 0,
      detail: missingExempt.length === 0 ? `${expectedExempt.length} exemption paths reported` : `missing: ${missingExempt.join(", ")}`,
    });

    // 2. NEGATIVE CONTROLS — each mutant must fail the gate.
    const mutants = [
      ["negative: missing switch link", "docs/guide.md", (t) => t.replace("[中文](./guide.zh-CN.md)", "no link here")],
      ["negative: re-levelled heading", "docs/guide.zh-CN.md", (t) => t.replace("## 二", "# 二")],
      ["negative: pure-ASCII zh file", "README.zh-CN.md", () => "# Root\n\n[English](./README.md)\n\nHello there\n\n## One\n\ntext\n\n### Deep\n\nmore\n\n## Two\n\nend\n"],
    ];
    for (const [name, rel, mutate] of mutants) {
      const original = readFileSync(join(sandbox, rel), "utf8");
      writeFileSync(join(sandbox, rel), mutate(original));
      const result = verifyDocsParity(sandbox);
      cases.push({ case: name, ok: result.ok === false, detail: result.ok ? "gate still passed (WRONG)" : result.pairs.filter((p) => !p.ok).map((p) => `${p.pair}: ${p.problems.join("; ")}`).join(" | ") });
      writeFileSync(join(sandbox, rel), original);
    }

    // 3. an exempt file that GAINS a zh twin is checked like any other pair.
    write("docs/decisions.zh-CN.md", "# 决定\n\n[English](./decisions.md)\n\n正文\n\n## 一\n\ntext\n");
    const twins = verifyDocsParity(sandbox);
    cases.push({
      case: "exempt file gaining a zh twin is checked (its missing heading parity fails)",
      ok: twins.pairs.some((p) => p.pair === "docs/decisions.md" && !p.ok),
      detail: JSON.stringify(twins.pairs.find((p) => p.pair === "docs/decisions.md") ?? null),
    });
    const withGoodTwin = `# 决定\n\n[English](./decisions.md)\n\n正文\n\n## 二\n\ntext\n`;
    write("docs/decisions.md", `# Decisions\n\n**English** | [中文](./decisions.zh-CN.md)\n\nBody\n\n## Two\n\ntext\n`);
    write("docs/decisions.zh-CN.md", withGoodTwin);
    const twins2 = verifyDocsParity(sandbox);
    cases.push({ case: "exempt file with a CONFORMANT twin passes", ok: twins2.pairs.some((p) => p.pair === "docs/decisions.md" && p.ok) });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  for (const item of cases) console.log(`${item.ok ? "ok  " : "FAIL"} ${item.case}${item.detail ? " — " + item.detail : ""}`);
  const ok = cases.every((c) => c.ok);
  console.log(`\n[verify-docs-parity self-test] ${cases.filter((c) => c.ok).length}/${cases.length} checks passed — ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex === -1 ? join(HERE, "..") : argv[rootIndex + 1];
  const jsonIndex = argv.indexOf("--json");
  const jsonPath = jsonIndex === -1 ? null : argv[jsonIndex + 1];
  const result = verifyDocsParity(root);
  if (jsonPath !== null) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), root, ...result }, null, 2) + "\n");
  }
  printReport(result, root);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
