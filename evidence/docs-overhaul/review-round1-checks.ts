#!/usr/bin/env node
/**
 * t10 review-gate mechanical checks (Reviewer, read-only w.r.t. every document).
 *
 * Emits one line per check with a PASS/FAIL token so the review report can cite the exact
 * command that produced each statement. It NEVER writes to the documents it reads.
 *
 * Usage: node evidence/docs-overhaul/review-round1-checks.mjs
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve as presolve, relative } from "node:path";

const ROOT = presolve(process.cwd());
const PAIRS = [
  ["README.md", "README.zh-CN.md"],
  ["docs/design.md", "docs/design.zh-CN.md"],
  ["docs/user-guide.md", "docs/user-guide.zh-CN.md"],
];
const DOCS = PAIRS.flat();
const results = [];
const record = (check, ok, detail) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}  ::  ${detail}`);
};
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// ---- check 1: the six judged files exist, with hashes -------------------------------
for (const f of DOCS) {
  const exists = existsSync(f);
  record(`exists ${f}`, exists, exists ? `sha256=${sha(f).slice(0, 16)} bytes=${statSync(f).size}` : "MISSING");
}

// ---- check 2: the legacy filenames are gone -----------------------------------------
for (const legacy of ["docs/architecture.md", "docs/architecture.zh-CN.md"]) {
  record(`legacy removed ${legacy}`, !existsSync(legacy), existsSync(legacy) ? "STILL PRESENT" : "absent");
}

// ---- check 3: patch ids — 25 inserts + 2 top-level id-targets -----------------------
const patch = readFileSync("packages/mpd-bundle/cordis.patch.yml", "utf8").split("\n");
const inserts = [];
const targets = [];
for (const line of patch) {
  const m = line.match(/^(\s*)-\s*id:\s*(\S+)/);
  if (!m) continue;
  // a top-level (column 0) `- id:` is an id-target/replace row; an indented one is inside an insert block
  if (m[1].length === 0) targets.push(m[2]);
  else inserts.push(m[2]);
}
record("patch insert rows == 25", inserts.length === 25, `${inserts.length}: ${inserts.join(",")}`);
record("patch top-level id-targets == 2", targets.length === 2, `${targets.length}: ${targets.join(",")}`);
record("patch total `- id:` entries == 27", inserts.length + targets.length === 27, `${inserts.length + targets.length}`);

// ---- check 4: every insert row id is named in README + design doc, both languages ---
const text = Object.fromEntries(DOCS.map((f) => [f, readFileSync(f, "utf8")]));
for (const f of ["README.md", "README.zh-CN.md"]) {
  const missing = inserts.filter((id) => !text[f].includes(id));
  record(`all 25 insert ids named in ${f}`, missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : "0 missing");
}
for (const f of ["docs/design.md", "docs/design.zh-CN.md"]) {
  const missing = inserts.filter((id) => !text[f].includes(id));
  const missingT = targets.filter((id) => !text[f].includes(id));
  record(`design inventory covers 25 inserts in ${f}`, missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : "0 missing");
  record(`design inventory covers 2 id-targets in ${f}`, missingT.length === 0, missingT.length ? `missing: ${missingT.join(",")}` : "0 missing");
}

// ---- check 5: relative links resolve, per file --------------------------------------
for (const f of DOCS) {
  const dir = dirname(f);
  const links = [...text[f].matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
  const rel = links.filter((l) => !/^[a-z]+:\/\//i.test(l) && !l.startsWith("mailto:"));
  const dead = [];
  for (const l of rel) {
    const target = l.split("#")[0];
    if (target === "") continue;
    if (!existsSync(presolve(ROOT, dir, decodeURIComponent(target)))) dead.push(l);
  }
  record(`${f}: relative links resolve`, dead.length === 0, `${rel.length} relative link(s), ${dead.length} dead${dead.length ? ": " + dead.join(",") : ""}`);
}

// ---- check 6: heading-tree parity inside each pair ----------------------------------
const headings = (s) => [...s.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((m) => `${m[1].length}:${m[2]}`);
for (const [en, zh] of PAIRS) {
  const he = headings(text[en]);
  const hz = headings(text[zh]);
  record(`heading count parity ${en} / ${zh}`, he.length === hz.length, `EN=${he.length} ZH=${hz.length}`);
  record(`heading LEVELS identical ${en} / ${zh}`, he.map((h) => h.split(":")[0]).join() === hz.map((h) => h.split(":")[0]).join(), "level sequence compare");
}

// ---- check 7: language switch link directly under the title -------------------------
for (const [en, zh] of PAIRS) {
  const enOk = new RegExp(`\\[中文\\]\\(\\./${zh.split("/").pop().replace(".", "\\.")}\\)`).test(text[en]);
  const zhOk = new RegExp(`\\[English\\]\\(\\./${en.split("/").pop().replace(".", "\\.")}\\)`).test(text[zh]);
  record(`switch link ${en} <-> ${zh}`, enOk && zhOk, `EN->zh ${enOk}, ZH->en ${zhOk}`);
}

// ---- check 8: CJK content present in the zh twins -----------------------------------
for (const [, zh] of PAIRS) {
  const cjk = (text[zh].match(/[\u4e00-\u9fff]/g) ?? []).length;
  record(`real CJK prose in ${zh}`, cjk > 500, `${cjk} CJK chars`);
}

// ---- check 9: no stale architecture.md pointer in the six judged files ---------------
for (const f of DOCS) {
  const hits = [...text[f].matchAll(/architecture(?:\.zh-CN)?\.md/g)].map((m) => m[0]);
  record(`no architecture.md pointer in ${f}`, hits.length === 0, hits.length ? `${hits.length} hit(s)` : "0 hits");
}

// ---- check 10: team-model slot count stated correctly (FOUR is authoritative) --------
for (const f of DOCS) {
  const body = text[f];
  const three = /\b(three|3)[\s-]*team-model slots\b|\bthree `?teamModels`? slots\b/i.test(body);
  const slot4 = body.includes("slot4") || /slot 4/i.test(body);
  record(`${f}: slot4/slot 4 documented`, slot4, slot4 ? "present" : "ABSENT");
  record(`${f}: no "three slots" claim`, !three, three ? "claims three" : "no three-slot claim");
}

// ---- check 11: user-guide recipe uses the schema key member_name ---------------------
{
  const ug = text["docs/user-guide.md"];
  const ugz = text["docs/user-guide.zh-CN.md"];
  const camel = (ug.match(/memberName/g) ?? []).length + (ugz.match(/memberName/g) ?? []).length;
  const snake = (ug.match(/member_name/g) ?? []).length + (ugz.match(/member_name/g) ?? []).length;
  record("user-guide uses member_name (never memberName)", camel === 0 && snake > 0, `member_name=${snake} memberName=${camel}`);
}

// ---- check 12: README acknowledgements credits traceable -----------------------------
{
  const credits = {
    "oh-my-openagent": /oh-my-openagent/i,
    "code-yeongyu": /code-yeongyu/i,
    "dsh-agent-teams": /dsh-agent-teams/i,
    NanmiCoder: /NanmiCoder/i,
    DeepSeek: /DeepSeek/i,
    "ast-grep": /ast-grep/i,
    codegraph: /codegraph/i,
    "comment-checker": /comment-checker/i,
  };
  for (const [name, re] of Object.entries(credits)) {
    const en = re.test(text["README.md"]);
    const zh = re.test(text["README.zh-CN.md"]);
    record(`credit ${name} in README pair`, en && zh, `EN=${en} ZH=${zh}`);
  }
  const ackEn = /^#{1,3}\s*.*Acknowledgements/im.test(text["README.md"]);
  const ackZh = /^#{1,3}\s*.*(致谢|鳴謝|鸣谢)/m.test(text["README.zh-CN.md"]);
  record("dedicated ACKNOWLEDGEMENTS section in README pair", ackEn && ackZh, `EN heading=${ackEn} ZH heading=${ackZh}`);
}

// ---- check 13: design doc declares the measured counts ------------------------------
{
  for (const f of ["docs/design.md", "docs/design.zh-CN.md"]) {
    const b = text[f];
    const t25 = /25\b/.test(b);
    const t27 = /27\b/.test(b);
    const t2 = /2\b/.test(b) && /id-target|id target|替换|替换目标|覆盖/.test(b);
    record(`${f}: states 25 install rows`, t25, t25 ? "25 present" : "25 absent");
    record(`${f}: states 27 total id entries`, t27, t27 ? "27 present" : "27 absent");
    record(`${f}: distinguishes id-target rows`, t2, t2 ? "id-target notion present" : "id-target notion absent");
  }
}

// ---- check 14: design doc notes residual gaps / baseline QA --------------------------
{
  for (const f of ["docs/design.md", "docs/design.zh-CN.md"]) {
    const b = text[f];
    const gaps = /residual|known limits|已知局限|残留/i.test(b);
    record(`${f}: has a known-limits / residual-gaps section`, gaps, gaps ? "present" : "ABSENT");
  }
}

// ---- check 15: README points at the design doc from a where-to-go table ---------------
{
  const r = text["README.md"];
  const z = text["README.zh-CN.md"];
  record("README links docs/design.md", r.includes("docs/design.md"), r.includes("docs/design.md") ? "present" : "ABSENT");
  record("README.zh-CN links docs/design.zh-CN.md", z.includes("docs/design.zh-CN.md"), z.includes("docs/design.zh-CN.md") ? "present" : "ABSENT");
}

// ---- summary ------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks PASS; ${failed.length} FAIL ===`);
for (const f of failed) console.log(`FAIL  ${f.check}  ::  ${f.detail}`);
process.exitCode = failed.length === 0 ? 0 : 1;
