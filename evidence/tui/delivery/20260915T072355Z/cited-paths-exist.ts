#!/usr/bin/env node
// Captain-side independent check: every repo-relative path CITED by the delivery artifacts must
// exist on disk. Runs on the delivered text as-is (no rewriting of the artifacts), so it can
// falsify the "0 phantom references" self-check rather than repeat it.
//
// Usage: node cited-paths-exist.mjs <file...>    (exit 1 if any cited path is missing)

import { existsSync, readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node cited-paths-exist.mjs <file...>");
  process.exit(2);
}

// A citation is a backticked token that looks repo-relative: it starts with one of the four roots
// this repo uses and carries either a file extension or a trailing slash. Tokens carrying a
// placeholder (`<ts>`, `*`, `…`) are skipped: they are not addressable paths. Brace groups
// (`{a,b}.mjs`) are shell-style shorthand for several real paths, so they are expanded rather
// than skipped — each expansion must exist.
const ROOTS = ["evidence/", "docs/", "skills/", "packages/", "scripts/", "presets/", ".mpd/"];
// One documented exemption, never a silent drop: this token is a path INSIDE the external shape
// template `/root/dshProj/tui/plugin-template/` quoted by the plan's inventory table, not a path in
// this repository, so "missing" here is correct. Exemptions are printed.
const ILLUSTRATIVE = new Set(["skills/example-skill/"]);
const results = [];
let missingTotal = 0;
let exemptedTotal = 0;

function expandBraces(token) {
  const m = /\{([^{}]*)\}/.exec(token);
  if (m === null) return [token];
  return m[1]
    .split(",")
    .flatMap((part) => expandBraces(token.slice(0, m.index) + part + token.slice(m.index + m[0].length)));
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const cited = new Set();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim().replace(/[.,;:]$/, "");
    if (!ROOTS.some((r) => token.startsWith(r))) continue;
    if (/[<>*…]/.test(token.replace(/\{[^{}]*\}/g, ""))) continue;
    if (!/\.[a-z0-9]{1,5}$/.test(token) && !token.endsWith("/")) continue;
    for (const p of expandBraces(token)) cited.add(p);
  }
  const missing = [...cited].filter((p) => !ILLUSTRATIVE.has(p) && !existsSync(p.replace(/\/$/, "")));
  const exempt = [...cited].filter((p) => ILLUSTRATIVE.has(p));
  missingTotal += missing.length;
  exemptedTotal += exempt.length;
  results.push({ file, cited: cited.size, missing, exempt });
  console.log(
    `[cited-paths] ${file}: ${cited.size} repo-relative citations, ${missing.length} missing, ${exempt.length} exempt`,
  );
  for (const p of exempt) console.log(`  EXEMPT (documented): ${p}`);
  for (const p of missing) console.log(`  MISSING: ${p}`);
}

console.log(`[cited-paths] total missing: ${missingTotal} (exempt: ${exemptedTotal})`);
if (missingTotal > 0) process.exit(1);
console.log("[cited-paths] PASS");
