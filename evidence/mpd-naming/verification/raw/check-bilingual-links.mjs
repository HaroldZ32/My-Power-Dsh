#!/usr/bin/env node
// t18 bilingual-pairing + link-resolution verifier.
// Input: a repo root plus an explicit list of markdown files to audit (the pairs this wave touched).
// Rules checked (AGENTS.md language policy):
//   R1 both sides of a bilingual pair exist (x.md <-> x.zh-CN.md)
//   R2 the EN file links [中文](./x.zh-CN.md) directly under its title
//   R3 the ZH file links [English](./x.md) directly under its title
//   R4 every link in docs/index*.md resolves to an existing file
//   R5 every relative link in the audited files resolves (dangling-reference sweep)
// Usage: node check-bilingual-links.mjs <repoRoot> [--broken=<file>]
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith("--")) ?? ".";
const brokenFlag = argv.find((a) => a.startsWith("--broken="));
const brokenList = brokenFlag
  ? new Set(fs.readFileSync(brokenFlag.split("=")[1], "utf8").split("\n").filter(Boolean))
  : new Set();

const TARGETS = [
  "docs/upstream-parity-ledger.md",
  "docs/upstream-parity-ledger.zh-CN.md",
  "docs/index.md",
  "docs/index.zh-CN.md",
  "README.md",
  "README.zh-CN.md",
  "docs/architecture.md",
  "docs/architecture.zh-CN.md",
  "docs/user-guide.md",
  "docs/user-guide.zh-CN.md",
  "docs/feature-audit.md",
  "docs/feature-audit.zh-CN.md",
  "packages/mpd-boulder-plugin/README.md",
  "packages/mpd-boulder-plugin/README.zh-CN.md",
  "packages/mpd-bundle/README.md",
  "packages/mpd-bundle/README.zh-CN.md",
  "packages/mpd-modelchain-plugin/README.md",
  "packages/mpd-modelchain-plugin/README.zh-CN.md",
  "packages/mpd-qa-roles-probe/README.md",
  "packages/mpd-qa-roles-probe/README.zh-CN.md",
  "packages/mpd-roles-plugin/README.md",
  "packages/mpd-roles-plugin/README.zh-CN.md",
  "packages/mpd-workmate-plugin/README.md",
  "packages/mpd-workmate-plugin/README.zh-CN.md",
];

const results = [];
let failures = 0;
const fail = (rule, file, detail) => {
  failures += 1;
  results.push({ rule, file, status: "FAIL", detail });
};
const ok = (rule, file, detail) => results.push({ rule, file, status: "OK", detail });

const docBroken = (rel) => brokenList.has(rel);
const readDoc = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  if (docBroken(rel)) return "# deliberately broken copy (negative control)\n\n";
  return fs.readFileSync(abs, "utf8");
};

for (const rel of TARGETS) {
  const text = readDoc(rel);
  if (text === null) {
    fail("R0-exists", rel, "file does not exist at the pinned revision");
    continue;
  }
  const isZh = rel.endsWith(".zh-CN.md");
  const pair = isZh ? rel.replace(/\.zh-CN\.md$/, ".md") : rel.replace(/\.md$/, ".zh-CN.md");
  if (!fs.existsSync(path.join(root, pair))) fail("R1-pair-exists", rel, `missing counterpart ${pair}`);
  else ok("R1-pair-exists", rel, `counterpart ${pair} present`);

  const lines = text.split("\n");
  const titleIdx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (titleIdx < 0) {
    fail("R2/R3-switch-link", rel, "no top-level title found");
  } else {
    const under = lines.slice(titleIdx + 1, titleIdx + 5).join("\n");
    const wantName = isZh ? path.basename(rel).replace(/\.zh-CN\.md$/, ".md") : path.basename(pair);
    const wantLabel = isZh ? "English" : "中文";
    const re = new RegExp(`\\[${wantLabel}\\]\\((\\./)?${wantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`);
    if (re.test(under)) ok("R2/R3-switch-link", rel, `[${wantLabel}](./${wantName}) sits under the title (line ${titleIdx + 2})`);
    else fail("R2/R3-switch-link", rel, `no [${wantLabel}](./${wantName}) within 4 lines under the title`);
  }

  // R4/R5: every relative markdown link resolves.
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  let checked = 0;
  while ((m = linkRe.exec(text)) !== null) {
    const target = m[1];
    if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
    const clean = target.split("#")[0];
    if (!clean) continue;
    checked += 1;
    const abs = path.resolve(path.join(root, path.dirname(rel)), clean);
    if (docBroken(path.relative(root, abs).split(path.sep).join("/"))) continue;
    if (!fs.existsSync(abs)) fail(rel.startsWith("docs/index") ? "R4-index-link-resolves" : "R5-link-resolves", rel, `dangling link -> ${target}`);
  }
  if (rel.startsWith("docs/index")) ok("R4-index-link-resolves", rel, `${checked} relative link(s) all resolve`);
  else ok("R5-link-resolves", rel, `${checked} relative link(s) all resolve`);
}

const out = {
  repoRoot: root,
  auditedFiles: TARGETS.length,
  negativeControl: brokenFlag ? brokenFlag.split("=")[1] : null,
  failures,
  verdict: failures === 0 ? "PASS" : "FAIL",
  results,
};
console.log(JSON.stringify(out, null, 2));
process.exit(0);
