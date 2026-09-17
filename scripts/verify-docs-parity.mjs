#!/usr/bin/env node
// Repo gate: the bilingual documentation policy of AGENTS.md (Language policy section).
//
// WHY THIS EXISTS: the policy was previously unenforced — `scripts/pack-mpd.mjs` COPIES each
// package's README pair without asserting anything, and the QA lanes only read single docs. This
// gate was promoted from the prototype written during the docs task
// (`evidence/tui/docs-completeness/20260915T153835Z/docs-parity.mjs`, 87/87 on its five pairs).
//
// DISCOVERY (what a green run actually covers — stated so no reader over-reads it):
//   * the root `README.md` + `README.zh-CN.md`;
//   * EVERY `*.md` under `docs/` at ANY DEPTH (a recursive walk, so nesting cannot hide a pair),
//     with the AGENTS.md §3 process records exempted from the missing-twin rule;
//   * `extensions/**/README.md` at any depth, plus every `*.zh-CN.md` under `extensions/`; the other
//     `.md` files there (extension skills, personas) are ASSETS, not documentation, and are not
//     asked for a twin;
//   * `packages/*/README.md` + its zh twin. A package directory WITHOUT a README is a FAILURE unless
//     it is the one recorded exemption (`packages/mpd-mcp-shared`), so the census cannot stay green
//     while a package is undocumented.
//
// For every bilingual pair it asserts:
//   1. both files exist;
//   2. a switch link sits directly under the title and points at the twin;
//   3. the heading TREE (levels + order, fenced code excluded) is identical;
//   4. the zh-CN file actually carries CJK content (a copy-paste of the English file fails).
// It also runs the INVERSE scan: every `*.zh-CN.md` it discovers must have its non-zh twin; a
// zh-only document is reported as `zh-CN file has no EN twin` (an exempt path stays a reported
// exemption instead of a violation).
//
// EXEMPTION BOOKKEEPING (why the count can exceed what is live here): of the entries in
// `EXEMPT_LONE_FILES`, THIRTEEN correspond to files that exist in this tree today; `docs/adder4.md`
// and `docs/cnt8.md` are ANTICIPATORY entries kept BY DESIGN (t39, 2026-09-17): the manual no longer
// names them as examples — it named two paths that do not exist in this tree, and that stale citation
// was removed from BOTH ends in one change. This list is now their single source: a future addition of
// either file is exempted by design rather than by accident, and the census is unchanged. The run prints every exemption with its reason, so the count is never
// read as "N live paths" without the reasons beside it.
//
// Usage:
//   node scripts/verify-docs-parity.mjs [--root <dir>] [--json <path>]
//   node scripts/verify-docs-parity.mjs --self-test
//
// Exit: 0 when every checked pair passes and no violation is reported (exemptions are printed,
// never silent), 1 otherwise.

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
  ["docs/adder4.md", "internal QA/golden reference — ANTICIPATORY by design: the file does not exist in this tree yet and the manual no longer names it as an example; this list is the single source (t39)"],
  ["docs/cnt8.md", "internal QA/golden reference — ANTICIPATORY by design: the file does not exist in this tree yet and the manual no longer names it as an example; this list is the single source (t39)"],
  ["docs/tui-edition-report.md", "prior-phase report (the TUI edition delivery report) — named in the AGENTS.md Language-policy enumeration of exempt prior-phase reports (captain ruling on T60-F1)"],
  ["packages/mpd-agent-teams-plugin/README.md", "adopted upstream main code, kept verbatim as provenance"],
]);
const EXEMPT_WITHOUT_README = new Map([
  ["packages/mpd-mcp-shared", "ships source and tests only; its README pair is a recorded follow-up"],
]);
// `docs/plan-*.md` is a glob in the policy, so the exemption set is extended at discovery time.
const isExemptLone = (rel) => EXEMPT_LONE_FILES.has(rel) || /^docs\/plan-[^/]+\.md$/.test(rel);
const exemptReason = (rel) =>
  /^docs\/plan-/.test(rel) && !EXEMPT_LONE_FILES.has(rel) ? "process record (AGENTS.md §3: plan-*.md)" : EXEMPT_LONE_FILES.get(rel);

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

/** Every FILE under `<root>/<dir>`, recursively (symlinks and dot/node_modules dirs skipped). */
function walkFiles(root, dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function discoverPairs(root) {
  const pairs = [];
  const exemptNotes = [];
  const violations = [];
  const inverse = [];
  const push = (en, zh) => pairs.push({ en, zh });

  if (existsSync(join(root, "README.md"))) push("README.md", "README.zh-CN.md");
  if (existsSync(join(root, "README.zh-CN.md"))) inverse.push("README.zh-CN.md");

  // docs/**: every *.md is documentation, at any depth.
  for (const rel of walkFiles(root, "docs")) {
    if (!rel.endsWith(".md")) continue;
    if (rel.endsWith(".zh-CN.md")) {
      inverse.push(rel);
      continue;
    }
    const twin = rel.replace(/\.md$/, ".zh-CN.md");
    if (!existsSync(join(root, twin)) && isExemptLone(rel)) {
      exemptNotes.push({ path: rel, reason: exemptReason(rel) });
      continue;
    }
    push(rel, twin);
  }

  // extensions/**: README files are documentation; other .md files are assets.
  for (const rel of walkFiles(root, "extensions")) {
    if (!rel.endsWith(".md")) continue;
    if (rel.endsWith(".zh-CN.md")) {
      inverse.push(rel);
      continue;
    }
    if (rel.split("/").at(-1) !== "README.md") continue;
    const twin = rel.replace(/\.md$/, ".zh-CN.md");
    if (!existsSync(join(root, twin)) && isExemptLone(rel)) {
      exemptNotes.push({ path: rel, reason: exemptReason(rel) });
      continue;
    }
    push(rel, twin);
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
        // An undocumented package is a FAILURE, not a note: silence here is the class this gate closes.
        violations.push({ id: `package-no-readme:packages/${entry.name}`, detail: `package directory ${entry.name} has no README (not an exempt package)` });
        continue;
      }
      if (!existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`)) && isExemptLone(rel)) {
        exemptNotes.push({ path: rel, reason: exemptReason(rel) });
        continue;
      }
      push(rel, `packages/${entry.name}/README.zh-CN.md`);
      if (existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`))) inverse.push(`packages/${entry.name}/README.zh-CN.md`);
    }
  }

  // The INVERSE scan: a zh-CN document whose EN twin does not exist.
  for (const zh of inverse) {
    const en = zh.replace(/\.zh-CN\.md$/, ".md");
    if (existsSync(join(root, en))) continue;
    if (isExemptLone(en)) {
      exemptNotes.push({ path: en, reason: `${exemptReason(en)} — its zh file exists, but an exempt record requires no EN twin` });
      continue;
    }
    violations.push({ id: `inverse:${zh}`, detail: `zh-CN file has no EN twin (${en} is missing)` });
  }

  return { pairs, exemptNotes, violations };
}

export function verifyDocsParity(root) {
  const { pairs, exemptNotes, violations } = discoverPairs(root);
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
  for (const violation of violations) add(violation.id, violation.id, false, violation.detail);
  return {
    pairs: summaries,
    violations,
    checks,
    exemptNotes,
    ok: summaries.every((s) => s.ok) && violations.length === 0,
  };
}

function printReport(result, root) {
  for (const summary of result.pairs)
    console.log(`${summary.ok ? "ok  " : "FAIL"} ${summary.pair}${summary.ok ? "" : " — " + summary.problems.join("; ")}`);
  for (const violation of result.violations) console.log(`FAIL ${violation.id} — ${violation.detail}`);
  for (const note of result.exemptNotes) console.log(`skip ${note.path} — EXEMPT: ${note.reason}`);
  const pairs = result.pairs.length;
  const failed = result.pairs.filter((s) => !s.ok).length + result.violations.length;
  console.log(
    `\n[verify-docs-parity] root=${root} pairs=${pairs} failed=${failed} violations=${result.violations.length} exempt=${result.exemptNotes.length} — ${result.ok ? "PASS" : "FAIL"}`,
  );
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
  const zhGood = (title) => `# ${title}\n\n[English](./X.md)\n\n正文\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`;
  try {
    // 1. a clean fixture tree passes, including nested pairs and one non-doc asset.
    write("README.md", good("Root", "Hello").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("README.zh-CN.md", zhGood("根").replace("./X.md", "./README.md"));
    write("docs/guide.md", good("Guide", "Body").replace("./X.zh-CN.md", "./guide.zh-CN.md"));
    write("docs/guide.zh-CN.md", zhGood("指南").replace("./X.md", "./guide.md"));
    write("docs/guides/nested.md", good("Nested", "Body").replace("./X.zh-CN.md", "./nested.zh-CN.md"));
    write("docs/guides/nested.zh-CN.md", zhGood("嵌套").replace("./X.md", "./nested.md"));
    write("extensions/README.md", good("Ext", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/README.zh-CN.md", zhGood("扩展").replace("./X.md", "./README.md"));
    write("extensions/deep/README.md", good("DeepExt", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/deep/README.zh-CN.md", zhGood("深层扩展").replace("./X.md", "./README.md"));
    write("extensions/deep/skills/thing/SKILL.md", "# thing\n\nan asset, not a doc\n");
    write("packages/alpha/README.md", good("Alpha", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("packages/alpha/README.zh-CN.md", zhGood("甲").replace("./X.md", "./README.md"));
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
    cases.push({ case: "clean tree passes", ok: clean.ok, detail: `pairs=${clean.pairs.length} exempt=${clean.exemptNotes.length} violations=${clean.violations.length}` });

    // 1a. the RECURSIVE walk finds nested docs/ pairs and nested extensions/README pairs.
    const recursive = ["docs/guides/nested.md", "extensions/deep/README.md"].filter((rel) => clean.pairs.some((p) => p.pair === rel));
    cases.push({
      case: "recursive discovery: nested docs/ and extensions/ pairs are checked (nesting cannot hide a pair)",
      ok: recursive.length === 2,
      detail: `found: ${recursive.join(", ") || "(none)"}`,
    });
    // 1b. a non-README .md under extensions/ is an ASSET: no twin is demanded, so it is not a failure.
    cases.push({
      case: "an extensions ASSET (.md that is not a README) is not demanded a twin",
      ok: clean.ok && !clean.pairs.some((p) => p.pair === "extensions/deep/skills/thing/SKILL.md"),
      detail: "extensions/deep/skills/thing/SKILL.md left out of the pair set",
    });

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
      ["negative: nested pair with a mis-pointed switch link", "docs/guides/nested.md", (t) => t.replace("[中文](./nested.zh-CN.md)", "no link here")],
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

    // 4. the INVERSE scan: a zh-CN document with no EN twin is a violation.
    write("docs/orphan.zh-CN.md", "# 孤儿\n\n正文\n");
    const inverseBad = verifyDocsParity(sandbox);
    cases.push({
      case: "negative: a zh-CN file with no EN twin is a VIOLATION (inverse scan)",
      ok: inverseBad.ok === false && inverseBad.violations.some((v) => v.id === "inverse:docs/orphan.zh-CN.md"),
      detail: JSON.stringify(inverseBad.violations),
    });
    // ...and the same path is a reported EXEMPTION when the missing EN twin is an exempt record.
    write("docs/plan-orphan.zh-CN.md", "# 计划\n\n正文\n");
    const inverseExempt = verifyDocsParity(sandbox);
    cases.push({
      case: "an inverse orphan whose EN path is an exempt record is reported as an exemption, not a violation",
      ok: inverseExempt.violations.every((v) => v.id !== "inverse:docs/plan-orphan.zh-CN.md") && inverseExempt.exemptNotes.some((n) => n.path === "docs/plan-orphan.md"),
      detail: JSON.stringify(inverseExempt.exemptNotes.filter((n) => n.path === "docs/plan-orphan.md")),
    });

    // 5. a NON-exempt package without a README is a FAILURE; the exempt package stays a note.
    write("packages/silent/src/index.ts", "export {}\n");
    const silent = verifyDocsParity(sandbox);
    cases.push({
      case: "negative: a non-exempt package directory without a README is a FAILURE",
      ok: silent.ok === false && silent.violations.some((v) => v.id === "package-no-readme:packages/silent"),
      detail: JSON.stringify(silent.violations),
    });
    cases.push({
      case: "the exempt package (mpd-mcp-shared) is a reported note, not a violation",
      ok: silent.violations.every((v) => !v.id.includes("mpd-mcp-shared")) && silent.exemptNotes.some((n) => n.path === "packages/mpd-mcp-shared"),
      detail: "packages/mpd-mcp-shared stays on the exemption list",
    });
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
