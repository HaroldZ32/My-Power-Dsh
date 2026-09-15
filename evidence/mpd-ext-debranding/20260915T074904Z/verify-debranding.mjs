#!/usr/bin/env node
// t33 evidence — de-branding verification.
//
// Checks, from the files on disk:
//   1. the docs' quoted snippets MATCH the shipped example verbatim (skill description, flow id /
//      title / description / whenToUse) — in BOTH languages;
//   2. the user-visible surface carries ZERO RTL/EDA tokens (the contract's exact grep, run here);
//   3. the shipped example still contributes the four kinds with the canonical names;
//   4. the canonical rename is complete: no old name survives in the user-visible surface;
//   5. .gitignore dropped exactly the two recorded patterns.
//
// Usage: node verify-debranding.mjs

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TOKENS = String.raw`\brtl\b|verilog|vhdl|verilator|cocotb|iverilog|yosys|netlist|systemverilog|数字IC`;
const GREP_TARGETS =
  "README.md README.zh-CN.md AGENTS.md docs/*.md packages/*/README.md packages/*/README.zh-CN.md extensions/ scripts/";
const OLD_NAMES = ["rtl-triage", "rtl-verilog", "verilog-reviewer", "rtl-lint", "rtl-demo", "Verilog Reviewer"];

const checks = [];
const ok = (id, detail) => checks.push({ id, status: "passed", detail });
const bad = (id, detail) => checks.push({ id, status: "failed", detail });
const read = (f) => readFileSync(f, "utf8");

const run = (cmd) => {
  try {
    return { out: execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), code: 0 };
  } catch (error) {
    return { out: `${(error.stdout ?? "").toString()}\n${(error.stderr ?? "").toString()}`.trim(), code: error.status ?? 1 };
  }
};

// 1. quoted-snippet parity -----------------------------------------------------------------
const skill = read("extensions/mpd-ext-example/skills/change-triage/SKILL.md");
const skillDescription = skill.match(/^description: "(.*)"$/m)?.[1] ?? "";
const skillName = skill.match(/^name: (.*)$/m)?.[1] ?? "";
const flow = JSON.parse(read("extensions/mpd-ext-example/flows/change-triage-flow.json"));
for (const doc of ["docs/extensions.md", "docs/extensions.zh-CN.md"]) {
  const text = read(doc);
  const missing = [];
  if (!text.includes(skillDescription)) missing.push("skill description verbatim");
  if (!text.includes(`name: ${skillName}`)) missing.push(`skill frontmatter name (${skillName})`);
  for (const key of ["id", "title", "description", "whenToUse"])
    if (!text.includes(`"${key}": "${flow[key]}"`)) missing.push(`flow ${key} verbatim`);
  if (missing.length === 0) ok(`quotes.${doc}`, "quoted snippets match the shipped example verbatim");
  else bad(`quotes.${doc}`, `missing: ${missing.join(", ")}`);
}

// 2. zero RTL/EDA tokens on the user-visible surface ----------------------------------------
const grep = run(`grep -rniE '${TOKENS}' ${GREP_TARGETS} | grep -v '^docs/plan-tui-edition' || true`);
if (grep.out === "") ok("grep.zero-rtl", "ZERO user-visible RTL/EDA hits");
else bad("grep.zero-rtl", `hits remain:\n${grep.out}`);

// 3. the shipped example still contributes all four kinds with canonical names ---------------
const manifest = JSON.parse(read("extensions/mpd-ext-example/mpd-ext.json"));
const kinds = Object.entries(manifest.contributes).filter(([, v]) => Array.isArray(v) && v.length > 0).map(([k]) => k).sort();
if (kinds.join(",") === "flows,mcp,roles,skills") ok("example.four-kinds", kinds.join(","));
else bad("example.four-kinds", `kinds: ${kinds.join(",")}`);
if (manifest.contributes.roles[0].name === "Code Reviewer") ok("example.role-name", "Code Reviewer");
else bad("example.role-name", manifest.contributes.roles[0].name);
if (manifest.contributes.mcp[0].serverName === "lint-mcp") ok("example.server-name", "lint-mcp");
else bad("example.server-name", manifest.contributes.mcp[0].serverName);
if (flow.id === "change-triage-flow") ok("example.flow-id", flow.id);
else bad("example.flow-id", flow.id);

// 4. no old name survives anywhere on the user-visible surface -------------------------------
const old = OLD_NAMES.filter((n) => run(`grep -rn -- '${n}' ${GREP_TARGETS} extensions/mpd-ext-example`).out !== "");
if (old.length === 0) ok("rename.no-old-names", `none of ${OLD_NAMES.join(", ")} survive on the user-visible surface`);
else bad("rename.no-old-names", `old names survive: ${old.join(", ")}`);

// 5. .gitignore: exactly the two recorded patterns dropped ------------------------------------
const gi = read(".gitignore");
const dropped = [".venv-rtl/", "simv_iverilog"];
const stillthere = dropped.filter((p) => gi.split("\n").some((line) => line.trim() === p));
if (stillthere.length === 0) ok("gitignore.dropped", `dropped ${dropped.join(", ")} (both absent from the workspace; .venv-rtl/ is subsumed by .venv*/)`);
else bad("gitignore.dropped", `still present: ${stillthere.join(", ")}`);
const kept = [".research/", ".venv*/", ".sim_build/", "sim_build/", "obj_dir/", "*.o", "*.a", "compile.log"];
const gone = kept.filter((p) => !gi.split("\n").some((line) => line.trim() === p));
if (gone.length === 0) ok("gitignore.kept", `kept ${kept.length} patterns`);
else bad("gitignore.kept", `unexpectedly removed: ${gone.join(", ")}`);

const report = {
  task: "t33 — de-brand the RTL/EDA surface",
  measuredAt: new Date().toISOString(),
  grepCommand: `grep -rniE '${TOKENS}' ${GREP_TARGETS} | grep -v '^docs/plan-tui-edition'`,
  grepOutput: grep.out === "" ? "(empty)" : grep.out,
  shippedExample: { skillDescription, flowId: flow.id, role: manifest.contributes.roles[0].name, server: manifest.contributes.mcp[0].serverName },
  checks,
};
const failed = checks.filter((c) => c.status === "failed");
report.verdict = failed.length === 0 ? "passed" : "failed";
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
