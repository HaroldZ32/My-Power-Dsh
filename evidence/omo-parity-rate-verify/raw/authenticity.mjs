#!/usr/bin/env bun
// t39 INDEPENDENT authenticity + provenance check of t37's prompt set.
// For EVERY row (>=10 required) it locates the prompt inside the real session log it
// names, records file+position+event metadata, and asserts the row is a HUMAN user
// turn. It then compares the whole set against the 6 frozen testPrompts to prove the
// dataset is not a rewrite of the calibration set.
// READ-ONLY on ~/.dsh (log files only; no credentials, no writes).
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "/root/dshProj/my-power-dsh";
const T37 = REPO + "/evidence/omo-parity-rate";
const OUT = REPO + "/evidence/omo-parity-rate-verify/raw/authenticity.json";
const KEY = "--root-dshProj-my-power-dsh--";
const SESS = join(homedir(), ".dsh", "sessions", KEY);

const report = { sessionStore: {}, frozenComparison: {}, rows: [], failures: [] };

const rows = readFileSync(T37 + "/raw/prompts.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ---- frozen calibration set (must NOT be reused as data) --------------
const contractPath = REPO + "/evidence/omo-align/requirements/frozen-contract.json";
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const frozen = [...contract.complexityGate.testPrompts.simple, ...contract.complexityGate.testPrompts.complex];
report.frozenComparison.contractSha256 = createHash("sha256").update(readFileSync(contractPath)).digest("hex");
report.frozenComparison.frozenPromptCount = frozen.length;
const norm = (s) => s.toLowerCase().replace(/\s+/g, "").replace(/[`"'.,:;!?()<>[\]{}]/g, "");
const toks = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? []);
const jaccard = (a, b) => { const A = toks(a), B = toks(b); const inter = [...A].filter((x) => B.has(x)).length; const uni = new Set([...A, ...B]).size; return uni === 0 ? 0 : +(inter / uni).toFixed(4); };

// ---- locate every prompt in its own session log -----------------------
const LOG_CACHE = new Map();
function logPathFor(session) {
  const uuid = session.replace(/^session-/, "");
  const candidates = [
    join(SESS, session, "session.v3.jsonl.zstd"),
    join(SESS, session, "session.jsonl.zstd"),
    join(SESS, uuid, "session.v3.jsonl.zstd"),
    join(SESS, uuid, "session.jsonl.zstd"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
function readLog(p) {
  if (LOG_CACHE.has(p)) return LOG_CACHE.get(p);
  let text = "";
  if (p.endsWith(".zstd")) {
    const d = spawnSync("zstd", ["-d", p, "-c"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    text = d.status === 0 ? d.stdout : "";
  } else {
    text = readFileSync(p, "utf8");
  }
  LOG_CACHE.set(p, text);
  return text;
}
/** longest literal run of >=8 chars that is not a placeholder and survives sanitization */
function needleFor(prompt) {
  const chunks = prompt.split(/<[^>]*>/).map((c) => c.trim()).filter((c) => c.length >= 8);
  chunks.sort((a, b) => b.length - a.length);
  return chunks.length > 0 ? chunks[0].slice(0, 40) : prompt.slice(0, 20);
}

report.sessionStore = { key: KEY, dir: SESS.replace(homedir(), "~"), sessionsOnDisk: existsSync(SESS) ? readdirSync(SESS).length : 0 };

let located = 0;
for (const r of rows) {
  const entry = { id: r.id, session: r.session, turn: r.turn, stratum: r.stratum, sourceLog: null, logLine: null, eventType: null, eventSeq: null, eventTurn: null, role: null, sourceKind: null, isHumanUserTurn: false, located: false, t37Sanitized: r.sanitized, textMatchOk: false };
  const lp = logPathFor(r.session);
  if (!lp) { entry.note = "session log not found under the repo project key"; report.failures.push({ id: r.id, why: entry.note }); report.rows.push(entry); continue; }
  entry.sourceLog = lp.replace(homedir(), "~");
  const raw = readLog(lp);
  const lines = raw.split("\n");
  const needle = needleFor(r.prompt);
  entry.needle = needle;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('"user/message"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const d = o.data ?? {};
    const content = d.content ?? d.message?.content ?? [];
    const text = Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join(" ") : "";
    if (!text.includes(needle)) continue;
    entry.logLine = i + 1;
    entry.eventType = o.type;
    entry.eventSeq = o.seq;
    entry.eventTurn = d.turn ?? null;
    entry.role = d.role ?? d.message?.role ?? null;
    entry.sourceKind = d.source?.kind ?? null;
    entry.textMatchOk = true;
    entry.located = true;
    entry.isHumanUserTurn = entry.role === "user" && (entry.sourceKind === "user" || entry.sourceKind === null);
    // the user/message event carries no turn field: derive it by counting turn/start
    // events up to this line, then compare with the row's recorded turn index.
    entry.derivedTurn = lines.slice(0, i + 1).filter((l) => l.includes('"turn/start"')).length;
    entry.derivedTurnMatchesRow = entry.derivedTurn === r.turn;
    // provenance cross-check: does the located raw text length equal the row's rawLen?
    entry.matchedTextLen = text.length;
    entry.rawLenMatchesRow = text.length === r.rawLen;
    break;
  }
  if (entry.located) located += 1; else report.failures.push({ id: r.id, why: "prompt text not found in the named session log", session: r.session, needle });
  report.rows.push(entry);
}

// ---- non-rewrite comparison -------------------------------------------
const overlaps = [];
for (const r of rows) {
  let best = 0, bestIdx = -1, exact = false;
  frozen.forEach((f, i) => {
    const j = jaccard(r.prompt, f);
    if (j > best) { best = j; bestIdx = i; }
    if (norm(r.prompt) === norm(f)) exact = true;
  });
  overlaps.push({ id: r.id, maxJaccardVsFrozen: best, nearestFrozenIndex: bestIdx + 1, normalizedExactMatch: exact });
}
report.frozenComparison.overlaps = overlaps;
report.frozenComparison.maxOverlap = Math.max(...overlaps.map((o) => o.maxJaccardVsFrozen));
report.frozenComparison.anyExactMatch = overlaps.some((o) => o.normalizedExactMatch);
report.frozenComparison.anyNearRewrite = overlaps.some((o) => o.maxJaccardVsFrozen >= 0.8);

report.summary = {
  rows: rows.length,
  located,
  humanUserTurns: report.rows.filter((r) => r.isHumanUserTurn).length,
  derivedTurnMatchesRow: report.rows.filter((r) => r.derivedTurnMatchesRow).length,
  rawLenMatchesRow: report.rows.filter((r) => r.rawLenMatchesRow).length,
  failures: report.failures.length,
  cjkRows: rows.filter((r) => r.hasCJK).length,
  latinOnlyRows: rows.filter((r) => /^[\x00-\x7F\s]+$/.test(r.prompt.trim())).length,
  sessionsUsed: [...new Set(rows.map((r) => r.session))].length,
  distinctSessionStartSessions: [...new Set(rows.filter((r) => r.stratum === "session-start").map((r) => r.session))].length,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log("session store:", JSON.stringify(report.sessionStore));
console.log("summary:", JSON.stringify(report.summary));
console.log("frozen overlap: max", report.frozenComparison.maxOverlap, "| exact", report.frozenComparison.anyExactMatch, "| nearRewrite>=0.8", report.frozenComparison.anyNearRewrite);
for (const r of report.rows) console.log(`  ${r.id} [${r.stratum}] located=${r.located} human=${r.isHumanUserTurn} line=${r.logLine} turn=${r.eventTurn} role=${r.role} src=${r.sourceKind} ${r.sourceLog ?? ""}`);
for (const f of report.failures) console.log("  FAILURE", JSON.stringify(f).slice(0, 200));
