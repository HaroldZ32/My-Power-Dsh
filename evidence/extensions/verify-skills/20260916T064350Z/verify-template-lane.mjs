#!/usr/bin/env node

// t11 item 3 — re-read the template lane's four live claims OUT of the harness session
// log, independently of the lane's own result.json.
//
// The task is explicit: "a claim that only appears in prose is a FAIL". This driver
// decodes the RAW concatenated-zstd container the lane kept in its evidence dir (with
// the repo's own `session-evidence.mjs` frame scanner), binds every claim to ITS OWN
// call id, and reports the raw result head for each — so the verdict is traceable to
// `tool/call` + non-error `tool/result` records, not to a summary.
//
// Usage: node evidence/extensions/verify-skills/<stamp>/verify-template-lane.mjs [lane-evidence-dir]
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { decodeSessionLog, findToolCall, recordedToolNames } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const LANE_CASE = join(REPO, "evidence", "extensions", "extension-template")

const SKILL_NAME = "qa-template-skill"
const FLOW_ID = "qa-template-flow"
const ROLE_NAME = "qa-template reviewer"
const MCP_TOOL = "mcp__qa-template__describe_extension"
const CHILD_MARKER = "QA-TEMPLATE-CHILD"

function newestLaneDir() {
  const dirs = readdirSync(LANE_CASE)
    .map((name) => ({ name, dir: join(LANE_CASE, name) }))
    .filter((entry) => {
      try {
        return statSync(entry.dir).isDirectory() && existsSync(join(entry.dir, "result.json"))
      } catch {
        return false
      }
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1))
  return dirs[0]?.dir
}

/** Per-call-id result text, extracted HERE from the decoded records (not from the lane). */
function resultsByCallId(records) {
  const map = new Map()
  for (const record of records) {
    if (record?.type !== "tool/result") continue
    const blocks = record?.data?.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block?.type !== "tool-result") continue
      const parts = []
      for (const inner of Array.isArray(block.content) ? block.content : []) {
        if (typeof inner?.text === "string") parts.push(inner.text)
      }
      map.set(block.toolCallId, { isError: block.isError === true, text: parts.join("\n") })
    }
  }
  return map
}

const laneDir = process.argv[2] === undefined ? newestLaneDir() : resolve(process.argv[2])
const checks = []
const logs = []
const log = (text) => {
  logs.push(text)
  process.stdout.write(text + "\n")
}

function check(id, ok, detail) {
  checks.push({ id, status: ok ? "passed" : "failed", detail })
  log(`  ${ok ? "ok  " : "FAIL"} ${id} — ${detail}`)
  return ok
}

log(`verify-template-lane — lane evidence dir ${laneDir}`)

const rawContainer = join(laneDir, "raw", "template.session.jsonl.zstd")
if (!existsSync(rawContainer)) {
  check("container-present", false, `missing ${rawContainer}`)
  writeFileSync(join(HERE, "raw", "verify-template-lane.json"), JSON.stringify({ task: "t11", item: "3", lane_evidence_dir: laneDir, checks, failed: ["container-present"], passed: 0, total: 1 }, null, 2) + "\n")
  writeFileSync(join(HERE, "raw", "verify-template-lane.log"), logs.join("\n") + "\n")
  process.exitCode = 1
} else {
  const decoded = decodeSessionLog(rawContainer)
  const records = decoded.text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
  const results = resultsByCallId(records)
  const headerTools = new Set(recordedToolNames(records))

  check("container-decoded", records.length > 0, `${decoded.frames} zstd frame(s) -> ${records.length} record(s); tornStart=${String(decoded.tornStart)}`)

  const callOf = (name) => findToolCall(records, name)
  const bound = (name) => {
    const found = callOf(name)
    const texts = found.calls.map((call) => results.get(call.callId) ?? { isError: true, text: "" })
    const okTexts = found.calls
      .map((call) => ({ call, result: results.get(call.callId) }))
      .filter((entry) => entry.result !== undefined && entry.result.isError === false)
    return { found, okTexts, allText: texts.map((entry) => entry.text).join("\n") }
  }

  // 1) the skill loads: a `skill` call whose OWN result carries the skill heading
  const skill = bound("skill")
  check(
    "claim-skill-load",
    skill.found.succeeded && skill.okTexts.some((entry) => entry.result.text.includes("# " + SKILL_NAME)),
    `callIds=${JSON.stringify(skill.found.callIds)} succeeded=${skill.found.succeeded} head=${JSON.stringify((skill.okTexts[0]?.result.text ?? "").slice(0, 90))}`,
  )

  // 2) the flow is served: `mpd_flow_show` names the flow id and its skill
  const flow = bound("mpd_flow_show")
  check(
    "claim-flow",
    flow.found.succeeded && flow.okTexts.some((entry) => entry.result.text.includes(FLOW_ID) && entry.result.text.includes(SKILL_NAME)),
    `callIds=${JSON.stringify(flow.found.callIds)} succeeded=${flow.found.succeeded} head=${JSON.stringify((flow.okTexts[0]?.result.text ?? "").slice(0, 90))}`,
  )

  // 3) the role persona is readable and the role really spawns (child marker out of the call's own result)
  const persona = bound("mpd_role_persona")
  const spawn = bound("mpd_role_spawn")
  check(
    "claim-role-persona",
    persona.found.succeeded && persona.okTexts.some((entry) => entry.result.text.trim().length > 0),
    `callIds=${JSON.stringify(persona.found.callIds)} succeeded=${persona.found.succeeded} head=${JSON.stringify((persona.okTexts[0]?.result.text ?? "").slice(0, 90))}`,
  )
  check(
    "claim-role-spawn",
    spawn.found.succeeded && spawn.okTexts.some((entry) => entry.result.text.includes(CHILD_MARKER + "-OK")),
    `callIds=${JSON.stringify(spawn.found.callIds)} succeeded=${spawn.found.succeeded} markerSeen=${spawn.allText.includes(CHILD_MARKER + "-OK")}`,
  )

  // 4) the template's MCP tool: called AND non-error, offered by the harness header
  const mcp = bound(MCP_TOOL)
  check(
    "claim-mcp-tool-call",
    mcp.found.succeeded,
    `callIds=${JSON.stringify(mcp.found.callIds)} succeeded=${mcp.found.succeeded} reason=${JSON.stringify(mcp.found.reason)} head=${JSON.stringify((mcp.okTexts[0]?.result.text ?? "").slice(0, 120))}`,
  )
  check(
    "claim-mcp-tool-offered",
    headerTools.has(MCP_TOOL),
    `request/header tools include ${MCP_TOOL}: ${headerTools.has(MCP_TOOL)}; offered count=${headerTools.size}`,
  )

  // the extension is visible at all (the lane's first scripted call)
  const list = bound("mpd_ext_list")
  check("claim-ext-list", list.found.succeeded && list.allText.includes("qa-template"), `succeeded=${list.found.succeeded}`)

  // guard against a vacuous read: the log must carry more than the lane's own script
  check("log-not-vacuous", records.length > 20 && headerTools.size > 5, `${records.length} records, ${headerTools.size} tools offered`)

  const failed = checks.filter((entry) => entry.status === "failed")
  const report = {
    task: "t11",
    item: "3 — template lane re-read from the harness session log",
    attempt_id: "f488e6cf-997c-4899-b5bc-897ae67d869c",
    lane_evidence_dir: laneDir,
    raw_container: rawContainer,
    frames: decoded.frames,
    records: records.length,
    tools_offered: [...headerTools].sort(),
    checks,
    failed: failed.map((entry) => `${entry.id}: ${entry.detail}`),
    passed: checks.length - failed.length,
    total: checks.length,
  }
  writeFileSync(join(HERE, "raw", "verify-template-lane.json"), JSON.stringify(report, null, 2) + "\n")
  writeFileSync(join(HERE, "raw", "verify-template-lane.log"), logs.join("\n") + "\n")
  log(`[t11 item 3] ${report.passed}/${report.total} checks passed, ${failed.length} failed`)
  process.exitCode = failed.length === 0 ? 0 : 1
}
