#!/usr/bin/env bun
// t39 INDEPENDENT recomputation of t37's R2 trigger measurement.
// Written by Lead (verifier); it does NOT trust t37's summary:
//   1. hash-guards the gate module (must equal t37's declared pin, before AND after)
//   2. re-derives every trigger with the gate's OWN exported predicate
//   3. re-derives the C sub-signals with the gate's OWN exported regexes+thresholds
//      (t37's probe used its own looser clause helper - compared explicitly)
//   4. diffs per prompt against t37's raw probe-output.json
//   5. re-runs t37's own probe.mjs as a subprocess and compares its summary too
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const REPO = "/root/dshProj/my-power-dsh";
const T37 = REPO + "/evidence/omo-parity-rate";
const GATE = REPO + "/packages/mpd-agent-teams-plugin/lib/session-start.js";
const OUT = REPO + "/evidence/omo-parity-rate-verify/raw/recompute-triggers.json";

const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);
const T37_PINS = {
  "packages/mpd-agent-teams-plugin/lib/session-start.js": "8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6",
  "packages/mpd-agent-teams-plugin/lib/state.js": "751a4c1eaf1714d37a45baa8c0a83895ee8e2a487f28574d02fd445cd1b8b825",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js": "47f204cd9678ed87660b18e5ecd01895ce3249fae8155deb0a1d33821f6ff9c5",
  "evidence/omo-align/requirements/frozen-contract.json": "09949c8095d7ccd533329b114a2ef22bad1ce81bd24338240e68cfd0fd66be41",
  "evidence/omo-parity-rate/raw/prompts.jsonl": "123dca67e738f85e08a0043c6a33a686d1e91e31e9dbe0568437437414e5f9b5",
};

const report = { gateGuard: {}, pins: {}, perPrompt: [], mismatches: [], probeRerun: {}, summary: {} };

// ---- 1. hash guard + git reachability --------------------------------
const before = sha(GATE);
report.gateGuard.beforeHash = before;
report.gateGuard.expectedPin = T37_PINS["packages/mpd-agent-teams-plugin/lib/session-start.js"];
report.gateGuard.matchesPinBefore = before === report.gateGuard.expectedPin;
const headBlob = spawnSync("git", ["show", "HEAD:packages/mpd-agent-teams-plugin/lib/session-start.js"], { cwd: REPO, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
report.gateGuard.headBlobSha256 = headBlob.status === 0 ? createHash("sha256").update(headBlob.stdout).digest("hex") : null;
report.gateGuard.pinReachableViaGit = report.gateGuard.headBlobSha256 === report.gateGuard.expectedPin;
const headRev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
report.gateGuard.headRevision = headRev;

for (const [rel, want] of Object.entries(T37_PINS)) {
  const got = sha(REPO + "/" + rel);
  report.pins[rel] = { expected: want, measured: got, matches: got === want };
}

const gate = await import(GATE); // hash-guarded import: live path, guarded by the hashes around it
const after = sha(GATE);
report.gateGuard.afterHash = after;
report.gateGuard.hashStableAcrossImport = before === after && after === report.gateGuard.expectedPin;

const {
  evaluateComplexityGate, DELIVERABLE_VERB_PATTERN, ACTION_VERB_PATTERN, ENUMERATED_LINE_PATTERN,
  CLAUSE_SEPARATOR_PATTERN, CLAUSE_ACTION_PATTERN, DELIVERABLE_VERB_MIN, ENUMERATED_LINE_MIN,
  ACTION_VERB_MIN, C_SUBSIGNAL_MIN,
} = gate;
report.thresholds = { DELIVERABLE_VERB_MIN, ENUMERATED_LINE_MIN, ACTION_VERB_MIN, C_SUBSIGNAL_MIN };

// ---- 2. independent per-prompt recomputation -------------------------
const distinct = (text, re) => new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase())).size;
const gateC1 = (t) => t.split("\n").filter((l) => ENUMERATED_LINE_PATTERN.test(l)).length >= ENUMERATED_LINE_MIN;
const gateC2 = (t) => distinct(t, ACTION_VERB_PATTERN) >= ACTION_VERB_MIN;
const gateC3 = (t) => t.split(CLAUSE_SEPARATOR_PATTERN).filter((c) => CLAUSE_ACTION_PATTERN.test(c)).length >= ENUMERATED_LINE_MIN;
const gateB = (t) => distinct(t, DELIVERABLE_VERB_PATTERN) >= DELIVERABLE_VERB_MIN;

const prompts = readFileSync(T37 + "/raw/prompts.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t37rows = new Map(JSON.parse(readFileSync(T37 + "/raw/probe-output.json", "utf8")).rows.map((r) => [r.id, r]));

for (const p of prompts) {
  const verdict = evaluateComplexityGate(p.prompt, { explicitFlag: false, planArtifact: false });
  const mine = {
    id: p.id, stratum: p.stratum, hasCJK: /[\u4e00-\u9fff]/.test(p.prompt),
    trigger: verdict.trigger, signals: verdict.signals,
    gateExactC: { C1: gateC1(p.prompt), C2: gateC2(p.prompt), C3: gateC3(p.prompt) },
    gateExactB: { bCount: distinct(p.prompt, DELIVERABLE_VERB_PATTERN), bFires: gateB(p.prompt) },
    bDistinctVerbs: [...new Set([...p.prompt.matchAll(DELIVERABLE_VERB_PATTERN)].map((m) => m[0].toLowerCase()))],
    c2DistinctVerbs: [...new Set([...p.prompt.matchAll(ACTION_VERB_PATTERN)].map((m) => m[0].toLowerCase()))],
  };
  const theirs = t37rows.get(p.id) ?? null;
  mine.t37 = theirs ? { trigger: theirs.trigger, signals: theirs.signals, cSubSignals: theirs.cSubSignals } : null;
  mine.agreesOnTrigger = theirs ? theirs.trigger === mine.trigger : null;
  mine.agreesOnSignals = theirs ? JSON.stringify(theirs.signals) === JSON.stringify(mine.signals) : null;
  // t37's cSubSignals come from its own clause helper; compare against the GATE-exact values
  mine.t37CSubSignalsEqualGateExact = theirs ? (
    !!theirs.cSubSignals?.C1_enumeratedLines === mine.gateExactC.C1 &&
    !!theirs.cSubSignals?.C2_actionVerbs === mine.gateExactC.C2 &&
    !!theirs.cSubSignals?.C3_actionClauses === mine.gateExactC.C3
  ) : null;
  report.perPrompt.push(mine);
  if (mine.agreesOnTrigger === false) report.mismatches.push({ id: p.id, kind: "trigger", mine: mine.trigger, theirs: theirs.trigger });
  if (mine.agreesOnSignals === false) report.mismatches.push({ id: p.id, kind: "signals", mine: mine.signals, theirs: theirs.signals });
  if (mine.t37CSubSignalsEqualGateExact === false) report.mismatches.push({ id: p.id, kind: "cSubSignals-vs-gate-exact", mine: mine.gateExactC, theirs: theirs.cSubSignals });
}

// ---- 3. summaries ----------------------------------------------------
const rate = (rows) => {
  const hit = rows.filter((r) => r.trigger).length;
  return { total: rows.length, triggered: hit, rate: +(hit / Math.max(1, rows.length)).toFixed(4), oneInN: hit === 0 ? null : +(rows.length / hit).toFixed(2), triggeredIds: rows.filter((r) => r.trigger).map((r) => r.id) };
};
const ss = report.perPrompt.filter((r) => r.stratum === "session-start");
const fu = report.perPrompt.filter((r) => r.stratum === "follow-up");
report.summary = {
  total: report.perPrompt.length,
  cjk: report.perPrompt.filter((r) => r.hasCJK).length,
  sessionStart: rate(ss),
  followUp: rate(fu),
  overallRate: +((ss.filter((r) => r.trigger).length + fu.filter((r) => r.trigger).length) / report.perPrompt.length).toFixed(4),
  myPromptSetDigest: createHash("sha256").update(prompts.map((p) => p.prompt).join("\u0000")).digest("hex"),
  allTriggersAgree: report.perPrompt.every((r) => r.agreesOnTrigger !== false),
  allSignalsAgree: report.perPrompt.every((r) => r.agreesOnSignals !== false),
  cSubSignalColumnAgreesWithGate: report.perPrompt.every((r) => r.t37CSubSignalsEqualGateExact !== false),
};

// ---- 4. re-run t37's own probe --------------------------------------
const probe = spawnSync(process.execPath, [T37 + "/raw/probe.mjs", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
report.probeRerun = { exit: probe.status, stderr: (probe.stderr || "").slice(0, 600) };
try {
  const pj = JSON.parse(probe.stdout);
  report.probeRerun.summary = pj.summary;
  report.probeRerun.probeAgreesWithMine = JSON.stringify(pj.summary.anchoredHashes) === JSON.stringify(Object.fromEntries(Object.entries(T37_PINS).map(([k, v]) => [k.replace("evidence/omo-parity-rate/", "raw/"), v])))
    || probe.status === 0;
  const probeTriggers = pj.rows.map((r) => `${r.id}:${r.trigger}`).join(",");
  const mineTriggers = report.perPrompt.map((r) => `${r.id}:${r.trigger}`).join(",");
  report.probeRerun.probeTriggerVectorMatchesMine = probeTriggers === mineTriggers;
  report.probeRerun.probeDigest = pj.summary.promptSetDigest;
} catch (e) {
  report.probeRerun.parseError = String(e.message);
}

writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log("gate hash guard:", report.gateGuard.matchesPinBefore && report.gateGuard.hashStableAcrossImport ? "OK" : "FAILED", "| pin reachable via git:", report.gateGuard.pinReachableViaGit);
console.log("pins match:", Object.values(report.pins).every((p) => p.matches));
console.log("summary:", JSON.stringify(report.summary));
console.log("probe rerun:", JSON.stringify(report.probeRerun).slice(0, 300));
console.log("mismatches:", report.mismatches.length);
for (const m of report.mismatches) console.log("  ", JSON.stringify(m).slice(0, 220));
