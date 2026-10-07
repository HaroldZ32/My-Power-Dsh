#!/usr/bin/env bun
// t39: read-only snapshot of the ledger <-> contract state at a point in time, used as the
// INVENTORY form of the contradiction-closure criterion while t40 is still running.
// It records hashes + per-conflict observable state; it does NOT judge closure.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const REPO = "/root/dshProj/my-power-dsh";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const EN = REPO + "/docs/omo-parity-ledger.md";
const ZH = REPO + "/docs/omo-parity-ledger.zh-CN.md";
const CONTRACT = REPO + "/evidence/omo-align/requirements/frozen-contract.json";
const en = readFileSync(EN, "utf8"), zh = readFileSync(ZH, "utf8");
const contract = JSON.parse(readFileSync(CONTRACT, "utf8"));

const count = (s, re) => (s.match(re) ?? []).length;
const en8 = en.slice(en.indexOf("## 8.")), zh8 = zh.slice(zh.indexOf("## 8."));
const snap = {
  schema: "mpd-omo-parity-rate-verify/ledger-snapshot/1",
  takenAt: new Date().toISOString(),
  note: "Mid-flight snapshot taken while t40 (ledger landing) was still in_progress. Closure is NOT judged here.",
  hashes: {
    "docs/omo-parity-ledger.md": sha(EN),
    "docs/omo-parity-ledger.zh-CN.md": sha(ZH),
    "evidence/omo-align/requirements/frozen-contract.json": sha(CONTRACT),
    "t37Pinned_ledger_en": "0454431a2efe064bf9062dddb282ee79c3883928548847309df4b9c56e2a1f08",
    "t37Pinned_ledger_zh": "7398ec2d62ea20db0a39cca6104d22d1a7db5066b1a343058b22abb0f5032cd4",
  },
  ledgerChangedSinceT37: { en: sha(EN) !== "0454431a2efe064bf9062dddb282ee79c3883928548847309df4b9c56e2a1f08", zh: sha(ZH) !== "7398ec2d62ea20db0a39cca6104d22d1a7db5066b1a343058b22abb0f5032cd4" },
  section3: {
    enHasThreshold1: en.includes("trigger = anyExplicitFlag OR (matchedSignals >= 1)"),
    enHasStaleThreshold2: /matchedSignals >= 2/.test(en),
    enStatesCSingleSignal: /C counts as ONE signal|never top-level signals of their own/.test(en),
    zhHasThreshold1: zh.includes("trigger = anyExplicitFlag OR (matchedSignals >= 1)"),
    zhHasStaleThreshold2: /matchedSignals >= 2/.test(zh),
    zhStatesCSingleSignal: /C 只算一个信号/.test(zh),
    contractLogic: contract.complexityGate.logic.slice(0, 120),
    enHarmonizedTableMentioned: en.includes("Harmonized verb tables"),
  },
  section8: {
    enPendingRows: count(en8, /\|\s*pending\s*\|/g),
    enVerifiedRows: count(en8, /\|\s*verified/g),
    zhPendingRows: count(zh8, /待跑/g),
    zhVerifiedRows: count(zh8, /已验证/g),
    enHeaderStatusLine: (en.match(/^> Wave: .*$/m) ?? [""])[0].slice(0, 140),
    zhHeaderStatusLine: (zh.match(/^> 波次：.*$/m) ?? [""])[0].slice(0, 140),
  },
  bilingualLinkage: {
    enLinksZh: en.includes("(./omo-parity-ledger.zh-CN.md)"),
    zhLinksEn: zh.includes("(./omo-parity-ledger.md)"),
    enLine2: en.split("\n")[1],
    zhLine2: zh.split("\n")[1],
  },
  conflictInventory: [
    { id: "CF-1", topic: ">=2 vs >=1 threshold", observableNow: "EN §3 and ZH §3 both read '>= 1'; the contract's logic also reads '>= 1' (code: signals.length >= 1). Corrected in the current snapshot.", judged: false },
    { id: "CF-2", topic: "C = 'lines OR verbs' vs 2-of-3", observableNow: "EN §3 states C counts as ONE signal satisfied at 2-of-3 sub-signals (C1/C2/C3). Corrected in the current snapshot.", judged: false },
    { id: "CF-3", topic: "stale/asymmetric verb tables", observableNow: "EN §3 carries a 'Harmonized verb tables (behaviour change, R3)' paragraph; B row unchanged (matches contract).", judged: false },
    { id: "CF-4", topic: "§8 all pending vs green gates", observableNow: "EN §8 still shows pending rows and ZH §8 still shows 待跑 rows; moreover the EN and ZH §8 tables currently have DIFFERENT row counts, and the header status line already claims VERIFIED while §8 rows say pending.", judged: false },
    { id: "CF-5", topic: "module docstring vs code (same file)", observableNow: "Resolved in code by t35: lib/session-start.js docstring now documents the ratified Option A predicate and names the superseded '>= 2'.", judged: false },
    { id: "CF-6", topic: "§4 S2 quote + §7 O5 lingering", observableNow: "§7 now carries an explicit 'O5 is CLOSED (reconciled, not lingering)' note and §4 quotes the frozen S2 assertion verbatim with the upstream-citation limitation recorded.", judged: false },
  ],
  contractSide: {
    testPromptsSimple: contract.complexityGate.testPrompts.simple.length,
    testPromptsComplex: contract.complexityGate.testPrompts.complex.length,
  },
};
writeFileSync(REPO + "/evidence/omo-parity-rate-verify/raw/ledger-snapshot.json", JSON.stringify(snap, null, 2));
console.log(JSON.stringify({ hashes: snap.hashes, section3: snap.section3, section8: snap.section8, linkage: snap.bilingualLinkage }, null, 1));
