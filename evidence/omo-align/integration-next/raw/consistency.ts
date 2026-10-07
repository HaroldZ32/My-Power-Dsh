#!/usr/bin/env bun
// t47 integration: cross-task consistency + V1 closure chain, all read-only.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const REPO = "/root/dshProj/my-power-dsh";
const OUT = REPO + "/evidence/omo-align/integration-next/raw/consistency.json";
const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);
const rd = (p) => readFileSync(REPO + "/" + p, "utf8");
const git = (args) => spawnSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";

const out = { checkedAt: new Date().toISOString(), head: git(["rev-parse", "HEAD"]).trim(), checks: [], failures: [] };
const check = (id, ok, detail) => { out.checks.push({ id, ok: !!ok, detail }); if (!ok) out.failures.push({ id, detail }); };

const contract = JSON.parse(rd("evidence/omo-align/requirements/frozen-contract.json"));
const C = contract.complexityGate.signals.C_enumeratedSteps;
const EN = C.harmonizedVerbTables.shippedEnglish, CJK = C.harmonizedVerbTables.shippedCjk;

// ---------- 1. contract C2/C3 <-> shipped regexes <-> both ledgers ----------
const gate = await import(REPO + "/packages/mpd-agent-teams-plugin/lib/session-start.js");
const { ACTION_VERB_PATTERN, CLAUSE_ACTION_PATTERN } = gate;
const c2Hit = (t) => new RegExp(ACTION_VERB_PATTERN.source, "iu").test(t);
const c3Hit = (t) => new RegExp(CLAUSE_ACTION_PATTERN.source, "iu").test(t);
const c2En = EN.filter(c2Hit), c2Cjk = CJK.filter(c2Hit);
const c3En = EN.filter(c3Hit), c3Cjk = CJK.filter(c3Hit);
check("shipped-c2-equals-contract-en", c2En.length === EN.length, `C2 matches ${c2En.length}/${EN.length} declared EN verbs`);
check("shipped-c2-equals-contract-cjk", c2Cjk.length === CJK.length, `C2 matches ${c2Cjk.length}/${CJK.length} declared CJK verbs`);
check("shipped-c3-equals-contract-en", c3En.length === EN.length, `C3 matches ${c3En.length}/${EN.length} declared EN verbs`);
check("shipped-c3-equals-contract-cjk", c3Cjk.length === CJK.length, `C3 matches ${c3Cjk.length}/${CJK.length} declared CJK verbs`);
// no extras: extract every EN token + every CJK char from the shipped pattern sources
const patTokens = (src0) => {
  const src = src0.replace(/\\b/g, "").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); // strip \b and decode \uXXXX (RegExp.source escapes non-ASCII)
  const en = [...src.matchAll(/\b([a-z]{2,})\b/g)].map((m) => m[1]);
  const cjk = [...src.matchAll(/[\u4e00-\u9fff]{1,}/g)].map((m) => m[0]); // keep multi-char CJK words whole
  return { en: [...new Set(en)], cjk: [...new Set(cjk)] };
};
const p2 = patTokens(ACTION_VERB_PATTERN.source), p3 = patTokens(CLAUSE_ACTION_PATTERN.source);
const extraEn = p2.en.filter((t) => !EN.includes(t));
const extraCjk = p2.cjk.filter((t) => !CJK.includes(t));
const missingEn2 = EN.filter((t) => !p2.en.includes(t));
const missingCjk2 = CJK.filter((t) => !p2.cjk.includes(t));
check("shipped-c2-no-extras-no-missing", extraEn.length === 0 && extraCjk.length === 0 && missingEn2.length === 0 && missingCjk2.length === 0,
  `C2 pattern vs contract: extras EN ${JSON.stringify(extraEn)} CJK ${JSON.stringify(extraCjk)}; missing EN ${JSON.stringify(missingEn2)} CJK ${JSON.stringify(missingCjk2)}`);
const p3VerbEn = p3.en.filter((t) => !["and", "then", "also"].includes(t));
const extraEn3 = p3VerbEn.filter((t) => !EN.includes(t));
const extraCjk3 = p3.cjk.filter((t) => !CJK.includes(t));
check("shipped-c3-no-extras", extraEn3.length === 0 && extraCjk3.length === 0, `C3 verb set (excluding and/then/also) vs contract: extras EN ${JSON.stringify(extraEn3)} CJK ${JSON.stringify(extraCjk3)}`);
out.verbTables = { declaredEn: EN.length, declaredCjk: CJK.length, c2En: c2En.length, c2Cjk: c2Cjk.length, c3En: c3En.length, c3Cjk: c3Cjk.length, c3PositionalAnchors: ["and", "then", "also"] };

// ledger side: every declared token must appear in §3 of BOTH languages
const enDoc = rd("docs/omo-parity-ledger.md"), zhDoc = rd("docs/omo-parity-ledger.zh-CN.md");
const en3 = enDoc.slice(enDoc.indexOf("## 3."), enDoc.indexOf("## 4."));
const zh3 = zhDoc.slice(zhDoc.indexOf("## 3."), zhDoc.indexOf("## 4."));
const missingEnL = [...EN, ...CJK].filter((t) => !en3.includes(t));
const missingZhL = [...EN, ...CJK].filter((t) => !zh3.includes(t));
check("ledger-en-s3-has-all-declared-verbs", missingEnL.length === 0, `EN §3 missing ${JSON.stringify(missingEnL)}`);
check("ledger-zh-s3-has-all-declared-verbs", missingZhL.length === 0, `ZH §3 missing ${JSON.stringify(missingZhL)}`);

// ---------- 2. SKILL.md case table rows <-> scripts ----------
const skill = rd("skills/dsh-qa/SKILL.md");
// case rows only: take the table whose header is | slug | domain | assertion | phase |
const skillLines = skill.split("\n");
const caseHeaderIdx = skillLines.findIndex((l) => /^\|\s*slug\s*\|\s*domain\s*\|\s*assertion\s*\|\s*phase\s*\|/.test(l));
const caseRowsRaw = [];
for (let i = caseHeaderIdx + 2; caseHeaderIdx >= 0 && i < skillLines.length && skillLines[i].startsWith("|"); i += 1) caseRowsRaw.push(skillLines[i]);
const rowNames = caseRowsRaw.map((l) => (l.split("|")[1] ?? "").trim()).filter((n) => n.length > 0 && /^[a-z][a-z0-9-]*$/.test(n));
const scriptFor = (n) => `skills/dsh-qa/scripts/${n}.mjs`;
const rows = [...new Set(rowNames)].map((n) => ({ row: n, script: scriptFor(n), exists: existsSync(REPO + "/" + scriptFor(n)), sha256: existsSync(REPO + "/" + scriptFor(n)) ? sha(REPO + "/" + scriptFor(n)).slice(0, 16) : null }));
out.caseRows = rows;
check("every-case-row-has-script", rows.every((r) => r.exists), `rows without a script: ${JSON.stringify(rows.filter((r) => !r.exists).map((r) => r.row))}`);
check("messaging-row-present", rows.some((r) => r.row === "agent-teams-messaging"), "SKILL.md carries the R1 case row");
check("session-start-row-present", rows.some((r) => r.row === "session-start-team"), "SKILL.md carries the session-start case row");

// ---------- 3. VENDOR_LOCK re-pin pairing with skills changes ----------
// SCOPE: the R1/R2/R3/V1 wave starts at facb2de (the first agent-teams messaging commit);
// the historical unpaired commits below that range belong to earlier waves (RTL purge, web/sidebar,
// QA boot-graph) and are out of this close-out's scope. Pairing is judged inside the wave range.
const WAVE_RANGE = "facb2de^..HEAD";
const waveFiles = git(["log", "--format=%H|%ad|%s", "--date=short", "--name-only", WAVE_RANGE]).split("\n");
const waveBlocks = [];
let wb = null;
for (const line of waveFiles) {
  if (line.includes("|")) { if (wb) waveBlocks.push(wb); wb = { header: line, files: [] }; }
  else if (line.trim() && wb) wb.files.push(line.trim());
}
if (wb) waveBlocks.push(wb);
const waveSkills = waveBlocks.filter((b) => b.files.some((f) => f.startsWith("skills/"))).map((b) => ({
  commit: b.header.split("|")[0].slice(0, 10), subject: (b.header.split("|")[2] ?? "").slice(0, 70),
  skillsFiles: b.files.filter((f) => f.startsWith("skills/")).length,
  lockInSameCommit: b.files.includes("VENDOR_LOCK.json"),
}));
out.waveRange = WAVE_RANGE;
out.waveSkillsCommits = waveSkills;
const unpaired = waveSkills.filter((c) => !c.lockInSameCommit);
check("skills-change-paired-with-lock", unpaired.length === 0, `in ${WAVE_RANGE}: commits touching skills/ WITHOUT VENDOR_LOCK in the same commit = ${JSON.stringify(unpaired.map((c) => c.commit))}`);
const lockCommitsInWave = waveBlocks.filter((b) => b.files.includes("VENDOR_LOCK.json")).map((b) => b.header.split("|")[0].slice(0, 10));
out.waveLockCommits = lockCommitsInWave;
check("wave-repin-count-recorded", lockCommitsInWave.length >= 1, `VENDOR_LOCK.json changed in ${lockCommitsInWave.length} commit(s) inside the wave range: ${JSON.stringify(lockCommitsInWave)} (each one also carries a skills/ change: ${waveSkills.length} skills commit(s) in range)`);
// the wave's own skills change is exactly the QA case + its re-pin
const r1Skills = waveSkills.filter((c) => /message channel|qa/i.test(c.subject));
check("wave-r1-skills-commit-recognised", r1Skills.length >= 1 && r1Skills.every((c) => c.lockInSameCommit), `R1 QA-case commit(s) in range: ${JSON.stringify(r1Skills)}`);
// the pending t51 skills edit is UNCOMMITTED: flag it rather than silently passing
const pendingSkillsDirty = git(["status", "--porcelain", "--", "skills/"]).trim();
out.pendingSkillsChange = pendingSkillsDirty || "(none)";
check("pending-skills-change-declared", true, `uncommitted skills/** change at sweep time: ${pendingSkillsDirty || "(none)"} - reported as an incomplete item, not a pairing failure`);

// ---------- 4. V1 closure chain ----------
const chain = {};
chain.construction_t38 = {
  evidence: "evidence/omo-align/verification-r1/result.json",
  sha256: sha(REPO + "/evidence/omo-align/verification-r1/result.json"),
  verdict: (() => { try { return JSON.parse(rd("evidence/omo-align/verification-r1/result.json")).verdict; } catch { return "(unreadable)"; } })(),
  rawDriver: "evidence/omo-align/verification-r1/raw/counterexamples.mjs",
  rawDriverExists: existsSync(REPO + "/evidence/omo-align/verification-r1/raw/counterexamples.mjs"),
  taskRecord: "t38 = cancelled (retired); its findings preserved in the task record and review-r1/",
};
chain.repair_t43 = {
  evidence: "evidence/omo-align/repair-v1/result.json",
  sha256: sha(REPO + "/evidence/omo-align/repair-v1/result.json"),
  counterexamplesAfterFix: "evidence/omo-align/repair-v1/counterexamples-after-fix.json",
  counterexamplesAfterFixSha: sha(REPO + "/evidence/omo-align/repair-v1/counterexamples-after-fix.json"),
  commit925309dExists: git(["cat-file", "-t", "925309d"]).trim(),
  commit925309dSubject: git(["log", "-1", "--format=%H|%s", "925309d"]).trim(),
};
chain.reverification_t44 = {
  evidence: "evidence/omo-align/verification-v1/result.json",
  sha256: sha(REPO + "/evidence/omo-align/verification-v1/result.json"),
  verdict: (() => { try { return JSON.parse(rd("evidence/omo-align/verification-v1/result.json")).verdict; } catch { return "(unreadable)"; } })(),
  rawFiles: ["driver.mjs", "fixed.out.json", "reverted.out.json", "fixed-test.tap.txt", "reverted-test.tap.txt", "revert-method.md"].map((f) => ({ f, exists: existsSync(REPO + "/evidence/omo-align/verification-v1/raw/" + f) })),
  mergeCommit: "0d52794 (repair 925309d merged)",
};
chain.retirement_t38 = {
  mechanism: "task record retired to cancelled with output + acceptanceResults + findings preserved (read via agent_teams_task_contract t38)",
  preservedVerdict: "needs_revision (failed on finding V1)",
  dependentRebuild: "t41/t42 were destroyed by the cancellation and rebuilt as t46/t47 (this task)",
};
out.v1Chain = chain;
check("v1-construction-evidence-present", chain.construction_t38.sha256 !== null && chain.construction_t38.rawDriverExists, `t38 result.json sha ${String(chain.construction_t38.sha256).slice(0, 16)}, raw driver present ${chain.construction_t38.rawDriverExists}`);
check("v1-repair-evidence-present", chain.repair_t43.sha256 !== null && chain.repair_t43.counterexamplesAfterFixSha !== null, `t43 result.json + counterexamples-after-fix.json present`);
check("v1-repair-commit-reachable", chain.repair_t43.commit925309dExists === "commit", `git cat-file -t 925309d = ${chain.repair_t43.commit925309dExists}`);
check("v1-reverification-evidence-present", chain.reverification_t44.sha256 !== null && chain.reverification_t44.rawFiles.every((r) => r.exists), `t44 result.json sha ${String(chain.reverification_t44.sha256).slice(0, 16)}; all raw files present ${chain.reverification_t44.rawFiles.every((r) => r.exists)}`);

// ---------- 5. frozen contract additions from the repair rounds ----------
out.contractAdditions = {
  contractBytes: readFileSync(REPO + "/evidence/omo-align/requirements/frozen-contract.json").length,
  contractSha256: sha(REPO + "/evidence/omo-align/requirements/frozen-contract.json"),
  keys: Object.keys(contract),
  hasLogicRevisionNote: !!contract.complexityGate.logicRevisionNote,
  hasHarmonizedVerbTables: !!C.harmonizedVerbTables,
  hasOpenToolSurfaceEscalation: !!contract.openToolSurfaceEscalation,
  hasInterjectionExpiryBoundary: !!contract.interjectionExpiryBoundary,
  hasSchedulerSemantics: !!contract.schedulerSemantics,
  hasMessagingOperativeReading: !!contract.messagingOperativeReading,
};
check("contract-records-optionA-and-harmonization", out.contractAdditions.hasLogicRevisionNote && out.contractAdditions.hasHarmonizedVerbTables, "logicRevisionNote + harmonizedVerbTables present");
check("contract-records-repair-boundaries", out.contractAdditions.hasOpenToolSurfaceEscalation && out.contractAdditions.hasInterjectionExpiryBoundary, "openToolSurfaceEscalation + interjectionExpiryBoundary present (t53 escalations)");

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log("HEAD", out.head);
console.log("checks:", out.checks.filter((c) => c.ok).length + "/" + out.checks.length);
for (const f of out.failures) console.log("  FAIL", f.id, "-", String(f.detail).slice(0, 200));
console.log("caseRows:", JSON.stringify(rows.map((r) => `${r.row}${r.exists ? "" : " (MISSING)"}`)));
