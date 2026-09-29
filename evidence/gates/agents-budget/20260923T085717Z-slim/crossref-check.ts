// CROSS-REFERENCE CHECK for the AGENTS.md slim.
//
// A compression that removed or RENUMBERED a section would silently break every `§N` citation pointing
// at it — from this manual, from code comments, from scripts and from the on-demand references. This
// check resolves them all:
//
//   (1) IN-MANUAL: every `§N` (including `§9/§11` and `§1`–`§13` range spellings) must name a section
//       that exists.
//   (2) REPO-WIDE: every explicit `AGENTS.md §N` citation OUTSIDE the manual — code comments, scripts,
//       QA cases, the reference files, docs — must name a section that exists.
//
// Only EXPLICIT `AGENTS.md §N` spellings are read outside the manual: a bare `§N` in another document
// may refer to that document's own sections, and treating it as a citation would be a false positive
// (that distinction is the difference between a check and a noise generator).
//
// Usage: node crossref-check.mjs [manual=AGENTS.md] [root=.]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf("=");
  return [a.slice(0, i), a.slice(i + 1)];
}));
const root = resolve(args.root ?? ".");
const manualRel = args.manual ?? "AGENTS.md";
const manual = readFileSync(join(root, manualRel), "utf8");

const existing = new Set([...manual.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1])));

// (1) in-manual citations, including `§9/§11` and `§1`–`§13` range spellings
const refs = [];
for (const m of manual.matchAll(/§(\d+)(?:\s*[–/-]\s*§?(\d+))?/g)) {
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) refs.push({ n, in: manualRel, spelling: m[0] });
}
const badInManual = refs.filter((r) => !existing.has(r.n));

// (2) repo-wide EXPLICIT `AGENTS.md §N` citations, outside the manual
const SKIP_DIRS = new Set(["node_modules", ".git", "evidence", ".mpd", "dist", ".toolchain", ".codegraph", ".qa-reloc", ".qa-sidebar", ".crush"]);
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(?:md|mjs|cjs|js|ts|yml|yaml|json|sh)$/.test(entry)) out.push(p);
  }
  return out;
};
const files = walk(root).filter((p) => resolve(p) !== resolve(join(root, manualRel)));
const outsideRefs = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/AGENTS\.md\s*(?:§|section\s*)(\d+)(?:\s*[/,]\s*§?(\d+))?/g)) {
    for (const n of [Number(m[1]), m[2] === undefined ? undefined : Number(m[2])]) {
      if (n === undefined) continue;
      outsideRefs.push({ n, in: file.slice(root.length + 1).replaceAll("\\", "/"), spelling: m[0] });
    }
  }
}
const badOutside = outsideRefs.filter((r) => !existing.has(r.n));

const result = {
  manual: manualRel,
  sectionsDefined: [...existing].sort((a, b) => a - b),
  inManualCitations: refs.length,
  inManualUnresolved: badInManual,
  filesScanned: files.length,
  outsideCitations: outsideRefs.length,
  outsideUnresolved: badOutside,
  verdict: badInManual.length === 0 && badOutside.length === 0 ? "PASS" : "FAIL",
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === "PASS" ? 0 : 1);
