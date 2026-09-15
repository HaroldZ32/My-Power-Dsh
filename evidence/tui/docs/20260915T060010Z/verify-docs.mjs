#!/usr/bin/env node
// t6 evidence: the gates this task must satisfy, plus the digests the docs cite.
//
// Gates (the plan's regression set, copied verbatim from AC-16/AC-17's lane commands):
//   R7  doc switch-link + linkage check
//   R8  NOT-CLAIMED disclosure check
// plus the task contract's own verify command (descriptor identity) and a wording guard for the
// vocabulary the upstream research forbids/requires.
//
// Usage: node verify-docs.mjs

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.cwd();
const run = (command) => {
  try {
    const stdout = execSync(command, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: "passed", exitCode: 0, stdout: stdout.trim() };
  } catch (error) {
    return {
      status: "failed",
      exitCode: error.status ?? 1,
      stdout: (error.stdout ?? "").toString().trim(),
      stderr: (error.stderr ?? "").toString().trim(),
    };
  }
};

const R7 = `node -e "const fs=require('fs');for(const f of ['docs/tui.md','docs/tui.zh-CN.md']){if(!/\\[(中文|English)\\]\\(\\.\\/tui\\./.test(fs.readFileSync(f,'utf8')))throw new Error('switch link missing in '+f)}for(const f of ['docs/index.md','docs/index.zh-CN.md','README.md','README.zh-CN.md']){if(!fs.readFileSync(f,'utf8').includes('tui'))throw new Error('TUI page not linked from '+f)}console.log('R7 PASS');"`;
const R8 = `node -e "const t=require('fs').readFileSync('docs/tui.md','utf8');for(const k of ['NOT-CLAIMED','decision-event','admission','0.1.5-rc.2','web-only'])if(!t.includes(k))throw new Error('docs/tui.md missing '+k);console.log('R8 PASS');"`;
const IDENTITY = `node -e "const d=require('./dsh-distribution.json'); if(!d.distribution||!d.distribution.id||!d.distribution.version) throw new Error('identity missing'); if(!Array.isArray(d.protocols)) throw new Error('protocols must be an array'); console.log('identity OK '+d.distribution.id+' '+d.distribution.version);"`;

const commands = {
  R7: run(R7),
  R8: run(R8),
  "descriptor-identity": run(IDENTITY),
  "descriptor-structural-check": run("node evidence/tui/docs/20260915T060010Z/descriptor-check.mjs"),
};

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
];
const requiredVocabulary = [
  "community draft",
  "tui-admission/0.15",
  "reference implementation",
  "experimental adaptation",
  "community-v0.15",
  "dsh-tui-admission-v0.15",
  "Draft",
];

const docs = ["docs/tui.md", "docs/tui.zh-CN.md"];
const wording = { forbiddenHits: [], requiredMisses: [] };
for (const file of docs) {
  const text = readFileSync(file, "utf8");
  for (const word of forbidden) if (text.includes(word)) wording.forbiddenHits.push({ file, word });
  for (const word of requiredVocabulary) if (!text.includes(word)) wording.requiredMisses.push({ file, word });
}
wording.status = wording.forbiddenHits.length === 0 && wording.requiredMisses.length === 0 ? "passed" : "failed";

// Evidence-path existence: every path the docs cite as backing must exist on disk.
const citedPaths = [
  "evidence/tui/composition/20260915T053445Z/ledger.json",
  "evidence/tui/composition/20260915T053445Z/ledger.md",
  "evidence/tui/composition/20260915T053445Z/raw/tool-list.json",
  "evidence/tui/composition/20260915T053445Z/raw/dsh-tui-dump-config.txt",
  "evidence/tui/composition/20260915T053445Z/raw/plugins-check.pane.txt",
  "evidence/tui/composition/20260915T053445Z/raw/admission-static.json",
  "evidence/tui/plugin/20260915T054343Z/result.json",
  "evidence/tui/plugin-followup/20260915T060032Z/result.json",
  "evidence/tui/plugin-followup/20260915T060032Z/disclosure.json",
  "evidence/tui/docs/20260915T060010Z/descriptor-check.json",
];
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const cited = [];
for (const path of citedPaths) {
  try {
    cited.push({ path, exists: true, sha256: sha256(path) });
  } catch {
    cited.push({ path, exists: false });
  }
}

const artifactDigests = {};
for (const path of [
  "dsh-distribution.json",
  "dsh-plugin.json",
  "docs/tui.md",
  "docs/tui.zh-CN.md",
  "docs/index.md",
  "docs/index.zh-CN.md",
  "README.md",
  "README.zh-CN.md",
  "packages/mpd-tui-plugin/dist/index.js",
  "packages/mpd-tui-plugin/src/settings.ts",
  ".mpd/plans/dsh-tui-edition.md",
])
  artifactDigests[path] = sha256(path);

const report = {
  task: "t6 — dsh-distribution.json + bilingual TUI documentation",
  measuredAt: new Date().toISOString(),
  revision: { gitHead: run("git rev-parse HEAD").stdout },
  commands,
  wording,
  citedEvidence: cited,
  artifactDigests,
  verdict:
    Object.values(commands).every((c) => c.status === "passed") &&
    wording.status === "passed" &&
    cited.every((c) => c.exists)
      ? "passed"
      : "failed",
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === "passed" ? 0 : 1);
