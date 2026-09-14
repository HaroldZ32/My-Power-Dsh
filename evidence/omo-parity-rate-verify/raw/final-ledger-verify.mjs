#!/usr/bin/env bun
// t39 FINAL pass: criteria 4 + 5 on the SETTLED post-t40 revision.
// Every check reads the files themselves; t40's closure table is treated as a claim to falsify.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const REPO = "/root/dshProj/my-power-dsh";
const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);
const rd = (p) => readFileSync(REPO + "/" + p, "utf8");
const out = { checkedAt: new Date().toISOString(), hashes: {}, checks: [], failures: [] };
const check = (id, ok, detail) => { out.checks.push({ id, ok: !!ok, detail }); if (!ok) out.failures.push({ id, detail }); };

const EN = rd("docs/omo-parity-ledger.md"), ZH = rd("docs/omo-parity-ledger.zh-CN.md");
const contract = JSON.parse(rd("evidence/omo-align/requirements/frozen-contract.json"));
const C = contract.complexityGate.signals.C_enumeratedSteps;
const BVERBS = ["align", "migrate", "refactor", "audit", "overhaul", "port", "rewrite", "consolidate", "对齐", "重构", "迁移", "审计", "移植", "梳理", "全量"];
const CEN = C.harmonizedVerbTables.shippedEnglish, CCJK = C.harmonizedVerbTables.shippedCjk;

out.hashes = {
  head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
  "docs/omo-parity-ledger.md": sha(REPO + "/docs/omo-parity-ledger.md"),
  "docs/omo-parity-ledger.zh-CN.md": sha(REPO + "/docs/omo-parity-ledger.zh-CN.md"),
  "docs/index.md": sha(REPO + "/docs/index.md"),
  "evidence/omo-align/requirements/frozen-contract.json": sha(REPO + "/evidence/omo-align/requirements/frozen-contract.json"),
  "packages/mpd-agent-teams-plugin/lib/session-start.js": sha(REPO + "/packages/mpd-agent-teams-plugin/lib/session-start.js"),
};
out.settledAgainstPass1 = out.hashes["docs/omo-parity-ledger.md"] === "1084feab272639603e4e271e0b4a1b90e84ed6ee2d9145d63b8a0847ae75726a" && out.hashes["docs/omo-parity-ledger.zh-CN.md"] === "d58a6d26fd7c7104190c14bb37ea7982193623a63bbd8be19bbe0e272dff7a32";
check("settled-hash", out.settledAgainstPass1, `ledger EN ${out.hashes["docs/omo-parity-ledger.md"].slice(0, 16)} / ZH ${out.hashes["docs/omo-parity-ledger.zh-CN.md"].slice(0, 16)} identical across the 55 s window`);

// ---------- criterion 4a: §3 sentence-by-sentence vs the contract ----------
const en3 = EN.slice(EN.indexOf("## 3."), EN.indexOf("## 4."));
const zh3 = ZH.slice(ZH.indexOf("## 3."), ZH.indexOf("## 4."));
check("s3-threshold-en", en3.includes("anyExplicitFlag OR (matchedSignals >= 1)"), "EN §3 states the ratified >= 1 predicate");
check("s3-threshold-zh", zh3.includes("anyExplicitFlag OR (matchedSignals >= 1)"), "ZH §3 states the ratified >= 1 predicate");
check("s3-no-stale-threshold", !/matchedSignals >= 2/.test(EN) && !/matchedSignals >= 2/.test(ZH), "no residual '>= 2' threshold statement in either language");
check("s3-c-single-signal-en", /C counts as ONE signal/i.test(en3) && /2-of-3/.test(en3), "EN §3: C is one signal, satisfied at 2-of-3");
check("s3-c-single-signal-zh", /C 只算一个信号/.test(zh3) && /2\/3|三.*两个/.test(zh3), "ZH §3: C is one signal, 2-of-3 in Chinese");
const en3B = BVERBS.filter((v) => en3.includes(v));
check("s3-b-table-complete", en3B.length === BVERBS.length, `EN §3 B row carries all ${BVERBS.length} contract B verbs (found ${en3B.length})`);
const en3C = [...CEN, ...CCJK].filter((v) => en3.includes(v));
check("s3-c-union-complete", en3C.length === CEN.length + CCJK.length, `EN §3 carries the harmonized C union: ${CEN.length} EN + ${CCJK.length} CJK contract verbs (found ${en3C.length})`);
const zh3C = [...CEN, ...CCJK].filter((v) => zh3.includes(v));
check("s3-c-union-complete-zh", zh3C.length === CEN.length + CCJK.length, `ZH §3 carries the harmonized C union (found ${zh3C.length}/${CEN.length + CCJK.length})`);
check("s3-a-row", /team:/.test(en3) && /!team/.test(en3) && /consumed/i.test(en3), "EN §3 A row: team:/!team with the consumed-prefix rule");
check("s3-d-row", /\.mpd\/plans/.test(en3), "EN §3 D row: .mpd/plans artifact");
check("s3-c1-c2-c3-named", /C1/.test(en3) && /C2/.test(en3) && /C3/.test(en3), "EN §3 names C1/C2/C3");

// ---------- criterion 4b: §8 flipped, numbers from raw data ----------
const en8 = EN.slice(EN.indexOf("## 8."));
const zh8 = ZH.slice(ZH.indexOf("## 8."));
/** body rows of the GATE table only (the Anchor table above it is not a gate table) */
const gateRows = (block, headerRe) => {
  const lines = block.split("\n");
  const start = lines.findIndex((l) => headerRe.test(l));
  if (start < 0) return [];
  const body = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i += 1) body.push(lines[i]);
  return body;
};
const enRows = gateRows(en8, /\|\s*Gate\s*\|\s*Command\s*\|\s*State\s*\|/i);
const zhRows = gateRows(zh8, /\|\s*门禁\s*\|\s*命令\s*\|\s*状态\s*\|/);
const stateCell = (r) => r.split("|").slice(-2)[0] ?? "";
check("s8-en-all-verified", enRows.length >= 8 && enRows.every((r) => /verified/i.test(stateCell(r))) && !/\|\s*pending\s*\|/i.test(en8), `EN §8 gate table: ${enRows.length} rows, all verified, 0 pending`);
check("s8-zh-all-verified", zhRows.length >= 8 && zhRows.every((r) => /已验证/.test(stateCell(r))) && !/待跑/.test(zh8), `ZH §8 gate table: ${zhRows.length} rows, all verified, 0 待跑`);
check("s8-row-count-parity", enRows.length === zhRows.length, `EN ${enRows.length} gate rows vs ZH ${zhRows.length} gate rows`);
const cmds = (rows) => rows.map((r) => (r.split("|")[2] ?? "").replace(/`/g, "").trim());
const enCmds = cmds(enRows), zhCmds = cmds(zhRows);
check("s8-command-order-parity", JSON.stringify(enCmds) === JSON.stringify(zhCmds), `gate commands identical and in the same order: ${enCmds.length} vs ${zhCmds.length}${JSON.stringify(enCmds) === JSON.stringify(zhCmds) ? "" : " DIFF: " + JSON.stringify(enCmds.filter((c, i) => c !== zhCmds[i]))}`);
check("s8-links-present", EN.includes("(./omo-parity-ledger.zh-CN.md)") && ZH.includes("(./omo-parity-ledger.md)"), "language switch links intact in both files");
check("s8-header-status", /\*\*VERIFIED/.test(EN) && /已验证/.test(ZH), "header status line flipped to VERIFIED in both languages");
check("s8-sha-anchors", ["09949c80", "8cfaef47", "751a4c1e", "123dca67"].every((h) => en8.includes(h)) && ["09949c80", "8cfaef47"].every((h) => zh8.includes(h)), "§8 anchor table pins the contract/gate/state/prompts content hashes in both languages");
// the rate row must agree with t37's raw data and with MY independent recompute (0 of 20)
check("s8-rate-number-matches-raw", /20\b[^|]*0\s*触|0\s*triggered|0 条触发/.test(en8) || /0\s*triggered/.test(en8), "EN §8 rate row carries the raw 0-of-20 result");
check("s8-rate-number-matches-raw-zh", /0 条触发|0\s*\/\s*20/.test(zh8), "ZH §8 rate row carries the raw 0-of-20 result");

// ---------- criterion 5: conflict closure ----------
check("cf1-closed", !/matchedSignals >= 2/.test(EN) && !/matchedSignals >= 2/.test(ZH), "CF-1: no >=2 statement survives in either ledger");
check("cf2-closed", !/enumerated lines.*\*\*or\*\*.*filter|行.*\*\*或\*\*/.test(en3) && /2-of-3/.test(en3), "CF-2: the 'lines OR verbs' C rule is gone; 2-of-3 present");
check("cf3b-closed", en3C.length === CEN.length + CCJK.length, "CF-3b: the C verb union is complete in the ledger");
check("cf4-closed", enRows.every((r) => /verified/i.test(r)) && zhRows.every((r) => /已验证/.test(r)), "CF-4: §8 no longer reports pending/待跑");
check("cf5-code-side", /RATIFIED Option A predicate/.test(rd("packages/mpd-agent-teams-plugin/lib/session-start.js")) && !/\* .*matchedSignals >= 2.*OR anyExplicitFlag/.test(rd("packages/mpd-agent-teams-plugin/lib/session-start.js").split("\n")[28] ?? ""), "CF-5: session-start.js docstring now documents Option A (line-29 check)");
const line29 = rd("packages/mpd-agent-teams-plugin/lib/session-start.js").split("\n")[28];
out.line29 = line29;
check("cf5-line29-wording", /Option A|>= 1/.test(line29), `line 29 reads: ${line29.trim().slice(0, 110)}`);
check("cf6a-closed", /TRANSITIVE DEPENDENTS/.test(EN) && /TRANSITIVE DEPENDENTS/.test(ZH), "CF-6a: §4 quotes the reconciled S2 assertion in both languages");
check("cf6b-closed", /O5/.test(EN) && /CLOSED|closed\/ reconciled|reconciled/.test(EN.slice(EN.indexOf("O5"), EN.indexOf("O5") + 400)), "CF-6b: O5 is marked closed/reconciled");
check("o3-o4-closed", /O3/.test(EN) && /O4/.test(EN) && !/O3.*open|O4.*open/.test(EN), "O3/O4 no longer described as open work");
check("l6-stale-fixed", /mode === "off"/.test(EN) && !/mode === "auto"/.test(EN), "L6 names mode === \"off\" and no stale mode === \"auto\" remains");

// ---------- t40's own closure table: ids accounted for ----------
const closure = rd("evidence/omo-align/ledger-fix/closure.md");
const t37Delta = rd("evidence/omo-parity-rate/ledger-delta.md");
const t37Ids = [...new Set([...t37Delta.matchAll(/CF-\d[a-z]?/g)].map((m) => m[0]))].sort();
const closureIds = [...new Set([...closure.matchAll(/CF-\d[a-z]?/g)].map((m) => m[0]))].sort();
// a parent id (CF-3, CF-6) is covered when its split children are present
const covered = (id) => closureIds.includes(id) || closureIds.some((c) => c.startsWith(id));
const unaccounted = t37Ids.filter((id) => !covered(id));
out.conflictIds = { t37Ids, closureIds, unaccounted };
check("closure-ids-complete", unaccounted.length === 0, `t37 ids ${t37Ids.join(",")}; closure ids ${closureIds.join(",")}; unaccounted ${JSON.stringify(unaccounted)} (CF-3/CF-6 are parent headings, covered by their a/b children)`);
const closureRows = closure.split("\n").filter((l) => /^\| \`CF-|^\| beyond t37|^\| accepted cost/.test(l));
const terminalMarkers = /corrected|checked, no change needed|not this task's scope|kept and documented|closed\/ reconciled/;
const rowsWithTerminal = closureRows.filter((r) => terminalMarkers.test(r));
check("closure-table-has-terminal-state", closureRows.length >= 10 && rowsWithTerminal.length === closureRows.length, `closure table rows: ${closureRows.length}, each carrying an explicit terminal state: ${rowsWithTerminal.length} (8 CF rows + beyond-t37 + accepted-cost)`);

// ---------- independent spot-check of §8 numbers ----------
// criterion 4 requires §8's numbers to match ITS RAW DATA, so compare against the
// pinned gate logs (and verify the logs are unmodified via result.json's sha256 claims);
// a run on the CURRENT tree is recorded separately because HEAD has moved since the anchor.
const t40 = JSON.parse(rd("evidence/omo-align/ledger-fix/result.json"));
const pinnedLog = rd("evidence/omo-align/ledger-fix/gates/plugin-tests.log");
const pinnedPass = pinnedLog.match(/(\d+)\s+pass/), pinnedFail = pinnedLog.match(/(\d+)\s+fail/), pinnedFiles = pinnedLog.match(/Ran (\d+) tests across (\d+) files/);
const claimedPass = (en8.match(/(\d+)\s*pass \/ 0 fail, (\d+) files/) ?? en8.match(/verified \((\d+) pass \/ 0 fail, (\d+) files\)/)) ?? [];
const logClaim = (t40.gates ?? []).find?.((g) => g?.log?.includes("plugin-tests")) ?? (t40.gates && !Array.isArray(t40.gates) ? t40.gates["plugin-tests"] : undefined);
const logShaClaim = logClaim?.logSha256 ?? (JSON.stringify(t40).match(/plugin-tests[\s\S]{0,300}?logSha256":"([0-9a-f]{64})/) ?? [])[1];
const actualLogSha = sha(REPO + "/evidence/omo-align/ledger-fix/gates/plugin-tests.log");
check("s8-number-matches-its-pinned-log", `${pinnedPass?.[1]}/${pinnedFail?.[1]}` === "161/0" && pinnedFiles?.[2] === "42" && en8.includes("161 pass / 0 fail, 42 files"), `§8 claims 161/0 across 42 files; its pinned raw log says ${pinnedPass?.[1]}/${pinnedFail?.[1]} across ${pinnedFiles?.[2]} files`);
check("s8-pinned-log-unmodified", actualLogSha === logShaClaim, `pinned log sha256 recomputed ${String(actualLogSha).slice(0, 16)} vs t40's claim ${String(logShaClaim).slice(0, 16)}`);
const tests = spawnSync("bun", ["test", "packages/mpd-agent-teams-plugin"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const testOut = (tests.stdout || "") + (tests.stderr || "");
const passM = testOut.match(/(\d+)\s+pass/), failM = testOut.match(/(\d+)\s+fail/), filesM = testOut.match(/Ran \d+ tests across (\d+) files/);
out.spotCheck = { pluginTestsAtAnchor: `${pinnedPass?.[1]}/${pinnedFail?.[1]}, ${pinnedFiles?.[2]} files`, pluginTestsOnCurrentTree: `${passM?.[1]}/${failM?.[1]}, ${filesM?.[1]} files`, pluginTestsCurrentTreeExit: tests.status, headNow: out.hashes.head, note: "The §8 number is anchored to the window HEAD 3096455->e89fa2a; the current tree has moved on (the comment/count drift is a property of HEAD moving, not of the number being wrong - see finding F4)." };
const vendor = spawnSync(process.execPath, ["scripts/verify-vendor.mjs"], { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
out.spotCheck.vendor = { exit: vendor.status, tail: (vendor.stdout || "").trim().split("\n").slice(-1)[0] };
check("s8-vendor-number-true", vendor.status === 0, `§8 claims verify-vendor PASS; an independent run exits ${vendor.status}`);

writeFileSync(REPO + "/evidence/omo-parity-rate-verify/raw/final-ledger-verify.json", JSON.stringify(out, null, 2));
console.log("HEAD", out.hashes.head);
console.log("settled:", out.settledAgainstPass1);
console.log("checks:", out.checks.filter((c) => c.ok).length + "/" + out.checks.length, "passing");
for (const f of out.failures) console.log("  FAIL", f.id, "-", String(f.detail).slice(0, 160));
console.log("line29:", line29.trim().slice(0, 120));
console.log("conflict unaccounted:", JSON.stringify(unaccounted));
