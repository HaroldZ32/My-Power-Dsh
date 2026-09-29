// Anchored re-run proof: one file:line per claim, read from THIS run's raw session logs.
import { readFileSync, writeFileSync } from "node:fs"

const HERE = "/root/dshProj/my-power-dsh/evidence/extensions/t7-verify/20260916T050334Z"
const L = "/root/dshProj/my-power-dsh/evidence/extensions/extension-lifecycle/2026-09-16T05-03-47.115Z"
const M = "/root/dshProj/my-power-dsh/evidence/extensions/extension-mcp-bridge/2026-09-16T05-04-23.876Z"

const lines = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim() !== "")
const parse = (l) => { try { return JSON.parse(l) } catch { return null } }
const find = (f, needle) => { const i = lines(f).findIndex((l) => l.includes(needle)); return { line: i === -1 ? null : i + 1, needle, found: i !== -1 } }

function tool(f, name) {
  const recs = lines(f).map(parse)
  const ci = recs.findIndex((r) => r?.type === "tool/call" && r?.data?.name === name)
  if (ci === -1) return { tool: name, found: false }
  const cid = recs[ci].data.callId
  const ri = recs.findIndex((r) => r?.type === "tool/result" && (r.data?.message?.content ?? []).some((b) => b?.toolCallId === cid))
  const block = ri === -1 ? undefined : recs[ri].data.message.content.find((b) => b?.toolCallId === cid)
  const text = (block?.content ?? []).map((p) => p?.text ?? "").join("\n")
  return { tool: name, found: true, callLine: ci + 1, resultLine: ri === -1 ? null : ri + 1, isError: block?.isError === true, textHead: text.slice(0, 150).replaceAll("\n", " | ") }
}

function header(f) {
  const recs = lines(f).map(parse)
  const i = recs.findIndex((r) => r?.type === "request/header" && Array.isArray(r?.data?.header?.tools))
  const names = recs[i].data.header.tools.map((t) => t?.name).filter((n) => typeof n === "string")
  return { line: i + 1, count: names.length, names }
}

const lcRaw = `${L}/raw/main.session.decoded.jsonl`
const mcRaw = `${M}/raw/mcp.session.decoded.jsonl`
const lcNames = header(lcRaw).names
const mcNames = header(mcRaw).names

const proof = {
  runDirs: { lifecycle: L, mcpBridge: M },
  lifecycle: {
    mountLine: find(`${L}/output.log`, "[mpd-ext] mpdExtensions provided"),
    header: { line: header(lcRaw).line, count: lcNames.length },
    calls: {
      mpd_ext_list: tool(lcRaw, "mpd_ext_list"),
      mpd_ext_show: tool(lcRaw, "mpd_ext_show"),
      mpd_flow_show: tool(lcRaw, "mpd_flow_show"),
      skill: tool(lcRaw, "skill"),
      mpd_role_persona: tool(lcRaw, "mpd_role_persona"),
      mpd_role_spawn: tool(lcRaw, "mpd_role_spawn"),
    },
    markers: {
      projectId: find(lcRaw, "qa-ext-proj"),
      userId: find(lcRaw, "qa-ext-user"),
      projectRejection: find(lcRaw, "project-level extensions may contribute skills and flows only"),
      flowMarker: find(lcRaw, "QA-MARKER-FLOW-PROJ"),
      skillMarker: find(lcRaw, "QA-MARKER-SKILL-PROJ"),
      personaMarker: find(lcRaw, "QA-MARKER-PERSONA-USER"),
      roleChild: find(lcRaw, "QA-CHILD-MARKER-ROLE-OK"),
    },
    isolation: {
      sessionA: find(`${L}/raw/session-a.session.decoded.jsonl`, "qa-iso-a"),
      sessionB: find(`${L}/raw/session-b.session.decoded.jsonl`, "qa-iso-b"),
      decoyControl: find(`${L}/raw/decoy-cwd-control.session.decoded.jsonl`, "qa-iso-decoy"),
    },
  },
  mcpBridge: {
    mountLine: find(`${M}/output.log`, "[mpd-ext] mpdExtensions provided"),
    schemaPublishLine: find(`${M}/output.log`, "1 skipped, 1 downgraded"),
    liveCall: tool(mcRaw, "mcp__qa_mcp_live__status"),
    header: { line: header(mcRaw).line, count: mcNames.length },
    offered: {
      liveStatus: mcNames.includes("mcp__qa_mcp_live__status"),
      schemaBadOutput: mcNames.includes("mcp__qa_mcp_schema__bad_output"),
      schemaBadInput: mcNames.includes("mcp__qa_mcp_schema__bad_input"),
      deadServerTools: mcNames.filter((n) => n.startsWith("mcp__qa_mcp_dead__")).length,
      hangServerTools: mcNames.filter((n) => n.startsWith("mcp__qa_mcp_hang__")).length,
      dupServerTools: mcNames.filter((n) => n.startsWith("mcp__qa_mcp_dup__")).length,
    },
  },
}

writeFileSync(`${HERE}/proof.json`, JSON.stringify(proof, null, 2) + "\n")
console.log(JSON.stringify({
  lifecycle: {
    mountLine: proof.lifecycle.mountLine.line,
    header: proof.lifecycle.header,
    calls: Object.fromEntries(Object.entries(proof.lifecycle.calls).map(([k, v]) => [k, { call: v.callLine, result: v.resultLine, isError: v.isError }])),
    markers: Object.fromEntries(Object.entries(proof.lifecycle.markers).map(([k, v]) => [k, v.line])),
    isolation: Object.fromEntries(Object.entries(proof.lifecycle.isolation).map(([k, v]) => [k, v.line])),
  },
  mcpBridge: {
    mountLine: proof.mcpBridge.mountLine.line,
    schemaPublishLine: proof.mcpBridge.schemaPublishLine.line,
    liveCall: { call: proof.mcpBridge.liveCall.callLine, result: proof.mcpBridge.liveCall.resultLine, isError: proof.mcpBridge.liveCall.isError },
    header: proof.mcpBridge.header,
    offered: proof.mcpBridge.offered,
  },
}, null, 2))
