#!/usr/bin/env node
// Soft-origin REPLAY (t17 repair evidence): drive the repaired predicates against the
// REAL artifact of the previously failing verification run, so the fix is proven on the
// exact live state that produced the false failure — not only on synthetic fixtures.
//
// Source artifact (read-only, another lane's evidence):
//   evidence/ulw/l6-verification/20260918T012345Z/session-start-team-2026-09-18T01-29-15.614Z/
//   sides/soft-complex/0/{team/upstream-routing-align/team.json, sessions/<key>/<sessionId>/}
//
// What it proves, in order:
//   1. that side's record is MODEL-staged (model-written description + id, its own
//      captainSessionId, and `agent_teams_create` tool calls in that session's own log);
//   2. `evaluateSide({expect:"advise", …})` now PASSES on it (previously: false FAILURE);
//   3. the SAME side with a PLUGIN-shaped record (the plugin's auto-route description, no
//      create call) still FAILS (clause 4 is still enforced), and an UNATTRIBUTABLE record
//      fails too — so the repaired arm did not simply stop checking.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { attributeOrigin, captainSessionEvidence, evaluateSide, PLUGIN_ROUTE_DESCRIPTION_PREFIX } from "../../../../skills/dsh-qa/scripts/session-start-team.mjs"
import { findToolCall } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.mjs"
import { projectKey } from "../../../../skills/dsh-qa/scripts/lib/workspace-isolation.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(dirname(dirname(dirname(here))))
const VERIFY_RUN = join(repoRoot, "evidence", "ulw", "l6-verification", "20260918T012345Z", "session-start-team-2026-09-18T01-29-15.614Z")
const SIDE = join(VERIFY_RUN, "sides", "soft-complex", "0")
const RECORD_PATH = join(SIDE, "team", "upstream-routing-align", "team.json")
const SESSIONS_ROOT = join(SIDE, "sessions")

const problems = []
const check = (condition, label) => { if (!condition) problems.push(label) }

const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"))
const sessionKeys = (() => { try { return readdirSync(SESSIONS_ROOT) } catch { return [] } })()
const sessionKey = sessionKeys[0]
check(sessionKeys.length === 1 && sessionKey === projectKey("/tmp/mpd-sst-6rkYoY/side/soft-complex/0/ws"), "the verifier store key must equal projectKey(original ws), got " + String(sessionKey))
const sessionId = record.captainSessionId
check(typeof sessionKey === "string" && sessionKey.length > 0, "the verifier's session store key could not be read")

// Rebuild a readable store whose project key matches the ORIGINAL workspace path, so the
// case's own `captainSessionEvidence` resolves it exactly as it did in the live run.
const sandbox = mkdtempSync(join(tmpdir(), "mpd-l5b-replay-"))
const home = join(sandbox, "dsh-home")
const ws = join(sandbox, "reconstructed", "side", "soft-complex", "0", "ws")
const originalWs = "/tmp/mpd-sst-6rkYoY/side/soft-complex/0/ws"
mkdirSync(join(home, "sessions", projectKey(originalWs)), { recursive: true })
cpSync(join(SESSIONS_ROOT, sessionKey, sessionId), join(home, "sessions", projectKey(originalWs), sessionId), { recursive: true })

const evidence = captainSessionEvidence(home, originalWs, sessionId)
const createCall = findToolCall(evidence.records, "agent_teams_create")
const sessionIdMatch = record.captainSessionId === evidence.sessionId
const attribution = attributeOrigin({ record, createCall, sessionIdMatch })

check(evidence.resolution === "session-id", "the captain's own session log must resolve by session id, got " + evidence.resolution)
check(createCall.called, "the side's log must record agent_teams_create tool calls")
check(createCall.callIds.length > 0, "the create calls must be enumerated")
check(sessionIdMatch, "the record's captainSessionId must be the session the log belongs to")
check(!String(record.description).startsWith(PLUGIN_ROUTE_DESCRIPTION_PREFIX), "the record's description must be the model's own text")
check(attribution.origin === "model", "the real record must be attributed to the MODEL, got " + attribution.origin)

const notice = { any: true, advisory: 1, provisioned: 0, signals: ["C"] }
const entries = [{ slot: "active", record }]
const repaired = evaluateSide({ expect: "advise", entries, notice, attributions: [attribution] })
check(repaired.ok, "the repaired advisory arm must PASS on the real model-staged state: " + repaired.problems.join("; "))

// Counterfactuals: the arm must still catch what clause 4 forbids.
const pluginShaped = { ...record, id: "mpd-default", description: PLUGIN_ROUTE_DESCRIPTION_PREFIX + " (sessionTeamPolicy.autoRoute; …)" }
const pluginAttribution = attributeOrigin({ record: pluginShaped, createCall: { called: false, callIds: [] }, sessionIdMatch: true })
check(pluginAttribution.origin === "plugin", "the plugin-shaped fixture must attribute to the plugin")
const pluginVerdict = evaluateSide({ expect: "advise", entries: [{ slot: "active", record: pluginShaped }], notice, attributions: [pluginAttribution] })
check(!pluginVerdict.ok, "a PLUGIN-staged record on the advisory path must still FAIL")
const unknownVerdict = evaluateSide({ expect: "advise", entries: [{ slot: "active", record: { ...record, captainSessionId: "session-other" } }], notice, attributions: [attributeOrigin({ record: { ...record, captainSessionId: "session-other" }, createCall: { called: false, callIds: [] }, sessionIdMatch: false })] })
check(!unknownVerdict.ok, "an unattributable record must still FAIL")

const result = {
  ok: problems.length === 0,
  sourceArtifact: RECORD_PATH,
  sessionStore: join(SESSIONS_ROOT, sessionKey),
  record: { id: record.id, phase: record.phase, captainSessionId: record.captainSessionId, description: String(record.description).slice(0, 200) },
  evidence: { resolution: evidence.resolution, sessionId: evidence.sessionId, records: evidence.records.length, frames: evidence.frames, createCalls: createCall.callIds.length, createCallReasons: createCall.reason },
  attribution,
  repairedVerdict: repaired,
  counterfactuals: { pluginStagedStillFails: !pluginVerdict.ok, unattributableStillFails: !unknownVerdict.ok, pluginProblems: pluginVerdict.problems, unknownProblems: unknownVerdict.problems },
  problems,
}
writeFileSync(join(here, "replay.result.json"), JSON.stringify(result, null, 2) + "\n")
console.log("[soft-origin-replay] ok=" + result.ok + " origin=" + attribution.origin + " createCalls=" + createCall.callIds.length + " repaired-verdict.ok=" + repaired.ok)
for (const problem of problems) console.error("  - " + problem)
rmSync(sandbox, { recursive: true, force: true })
if (!result.ok) process.exit(1)
