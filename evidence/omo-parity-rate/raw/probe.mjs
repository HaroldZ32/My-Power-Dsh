#!/usr/bin/env node
// t37 self-contained driver: re-runs the MEASUREMENT from raw/prompts.jsonl using
// the gate's OWN exported predicate (no re-implementation of the rule).
//
// Usage: node evidence/omo-parity-rate/raw/probe.mjs [--json]
// Third party: recompute the summary in place; the anchor hashes are printed so
// the reader can confirm which revision was measured.
import { readFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const GATE = join(REPO, "packages/mpd-agent-teams-plugin/lib/session-start.js")

const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null)
const ANCHORS = {
  "packages/mpd-agent-teams-plugin/lib/session-start.js": sha(GATE),
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js": sha(join(REPO, "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js")),
  "packages/mpd-agent-teams-plugin/lib/state.js": sha(join(REPO, "packages/mpd-agent-teams-plugin/lib/state.js")),
  "evidence/omo-align/requirements/frozen-contract.json": sha(join(REPO, "evidence/omo-align/requirements/frozen-contract.json")),
  "raw/prompts.jsonl": sha(join(HERE, "prompts.jsonl")),
}

const gate = await import(GATE)
const { evaluateComplexityGate, DELIVERABLE_VERB_PATTERN, ACTION_VERB_PATTERN,
        DELIVERABLE_VERB_MIN, ACTION_VERB_MIN, ENUMERATED_LINE_MIN } = gate

// C sub-signals, measured with the gate's own exported tables/thresholds. The
// gate folds C into ONE signal; these booleans expose which sub-signals carried it.
const distinct = (text, re) => new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase())).size
const clauseStarts = (text) => text.split(/[;:,.\n\r]/).filter((c) => /^\s*(?:(?:and|then|also)\s+)?(?:[a-z]|[\u4e00-\u9fff])/i.test(c)).length

const prompts = readFileSync(join(HERE, "prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const rows = prompts.map((p) => {
  const subC1 = p.prompt.split("\n").filter((l) => /^\s*(?:\d+[.)]|[-*|])\s/.test(l)).length >= ENUMERATED_LINE_MIN
  const subC2 = distinct(p.prompt, ACTION_VERB_PATTERN) >= ACTION_VERB_MIN
  const subC3 = clauseStarts(p.prompt) >= ENUMERATED_LINE_MIN
  const verdict = evaluateComplexityGate(p.prompt, { explicitFlag: false, planArtifact: false })
  return {
    id: p.id, session: p.session, turn: p.turn, stratum: p.stratum, hasCJK: p.hasCJK, sanitized: p.sanitized,
    promptPreview: p.prompt.slice(0, 90).replace(/\s+/g, " "),
    signals: verdict.signals, cSubSignals: { C1_enumeratedLines: subC1, C2_actionVerbs: subC2, C3_actionClauses: subC3 },
    trigger: verdict.trigger,
  }
})
const rate = (set) => {
  const hit = set.filter((r) => r.trigger).length
  return {
    total: set.length,
    triggered: hit,
    falsePositiveRate: +(hit / Math.max(1, set.length)).toFixed(4),
    oneInN: hit === 0 ? null : +(set.length / hit).toFixed(2),
    triggeredIds: set.filter((r) => r.trigger).map((r) => r.id),
  }
}
const ss = rows.filter((r) => r.stratum === "session-start")
const fu = rows.filter((r) => r.stratum === "follow-up")
const summary = {
  anchoredHashes: ANCHORS,
  predicate: "trigger = explicitFlag || signals.length >= 1 (Option A, ratified)",
  total: rows.length,
  cjk: rows.filter((r) => r.hasCJK).length,
  // The gate decides ONCE, at a session's first pre-step: only this stratum is the
  // quantity it actually controls. The follow-up stratum is context.
  sessionStart: rate(ss),
  followUp: rate(fu),
  overallFalsePositiveRate: +((ss.filter((r) => r.trigger).length + fu.filter((r) => r.trigger).length) / rows.length).toFixed(4),
  promptSetDigest: createHash("sha256").update(prompts.map((p) => p.prompt).join("\u0000")).digest("hex"),
}
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, rows }, null, 2))
} else {
  console.log("gate:", GATE)
  console.log("anchors:", JSON.stringify(ANCHORS, null, 2))
  console.log("\n" + rows.map((r) => `${r.id} [${r.stratum === "session-start" ? "SS" : "FU"}] ${r.trigger ? "TRIGGER   " : "no-trigger"} signals=[${r.signals}] C={${Object.entries(r.cSubSignals).filter(([, v]) => v).map(([k]) => k).join(",")}}  ${r.promptPreview}`).join("\n"))
  console.log("\nsummary:", JSON.stringify(summary, null, 2))
}
