// t7 attempt-2 proof derivation — every claim points at ONE line of ONE artifact.
// Reads only the raw harness session logs this run copied next to its own evidence dirs
// (declared below, taken from the console output of THIS run, not from a glob), and emits
// proof.json with { artifact, line, recordType, value } per claim. No prose is trusted.
import { readFileSync, writeFileSync } from "node:fs"

const HERE = "/root/dshProj/my-power-dsh/evidence/extensions/t7-verify/20260916T045829Z"
const LIFECYCLE = "/root/dshProj/my-power-dsh/evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z"
const MCP = "/root/dshProj/my-power-dsh/evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z"

const lines = (file) => readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "")
const parse = (line) => { try { return JSON.parse(line) } catch { return null } }

function resultText(record) {
  const blocks = record?.data?.message?.content
  if (!Array.isArray(blocks)) return undefined
  for (const block of blocks) {
    if (block?.type !== "tool-result") continue
    return (Array.isArray(block.content) ? block.content : [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
  }
  return undefined
}

function toolClaim(file, toolName) {
  const records = lines(file).map(parse)
  const callIndex = records.findIndex((r) => r?.type === "tool/call" && r?.data?.name === toolName)
  if (callIndex === -1) return { artifact: file, tool: toolName, found: false }
  const callId = records[callIndex].data.callId
  const resultIndex = records.findIndex((r) => {
    const blocks = r?.data?.message?.content
    return r?.type === "tool/result" && Array.isArray(blocks) && blocks.some((b) => b?.toolCallId === callId)
  })
  const result = resultIndex === -1 ? undefined : records[resultIndex]
  const block = result?.data?.message?.content?.find((b) => b?.toolCallId === callId)
  return {
    artifact: file, tool: toolName, found: true,
    callLine: callIndex + 1, callId,
    resultLine: resultIndex === -1 ? null : resultIndex + 1,
    isError: block?.isError === true,
    textHead: (resultText(result ?? {}) ?? "").slice(0, 190).replaceAll("\n", " | "),
  }
}

function headerClaim(file) {
  const records = lines(file).map(parse)
  const index = records.findIndex((r) => r?.type === "request/header" && Array.isArray(r?.data?.header?.tools))
  if (index === -1) return { artifact: file, found: false }
  const names = records[index].data.header.tools.map((t) => t?.name).filter((n) => typeof n === "string")
  return { artifact: file, found: true, headerLine: index + 1, count: names.length, names }
}

function contains(file, needle) {
  const index = lines(file).findIndex((line) => line.includes(needle))
  return { artifact: file, line: index === -1 ? null : index + 1, needle, found: index !== -1 }
}

const lc = `${LIFECYCLE}/raw/main.session.decoded.jsonl`
const mc = `${MCP}/raw/mcp.session.decoded.jsonl`

const proof = {
  runDirs: { lifecycle: LIFECYCLE, mcpBridge: MCP },
  lifecycle: {
    mountLine: contains(`${LIFECYCLE}/output.log`, "[mpd-ext] mpdExtensions provided"),
    header: headerClaim(lc),
    calls: {
      extList: toolClaim(lc, "mpd_ext_list"),
      extShow: toolClaim(lc, "mpd_ext_show"),
      flowShow: toolClaim(lc, "mpd_flow_show"),
      skill: toolClaim(lc, "skill"),
      rolePersona: toolClaim(lc, "mpd_role_persona"),
      roleSpawn: toolClaim(lc, "mpd_role_spawn"),
    },
    markers: {
      projectId: contains(lc, "qa-ext-proj"),
      userId: contains(lc, "qa-ext-user"),
      projectRejection: contains(lc, "project-level extensions may contribute skills and flows only"),
      flowMarker: contains(lc, "QA-MARKER-FLOW-PROJ"),
      skillMarker: contains(lc, "QA-MARKER-SKILL-PROJ"),
      personaMarker: contains(lc, "QA-MARKER-PERSONA-USER"),
      roleChild: contains(lc, "QA-CHILD-MARKER-ROLE-OK"),
    },
    isolation: {
      sessionA: contains(`${LIFECYCLE}/raw/session-a.session.decoded.jsonl`, "qa-iso-a"),
      sessionB: contains(`${LIFECYCLE}/raw/session-b.session.decoded.jsonl`, "qa-iso-b"),
      decoyControl: contains(`${LIFECYCLE}/raw/decoy-cwd-control.session.decoded.jsonl`, "qa-iso-decoy"),
    },
  },
  mcpBridge: {
    mountLine: contains(`${MCP}/output.log`, "[mpd-ext] mpdExtensions provided"),
    header: headerClaim(mc),
    schemaPublishLine: contains(`${MCP}/output.log`, "1 skipped, 1 downgraded"),
    liveCall: toolClaim(mc, "mcp__qa_mcp_live__status"),
    schemaShowText: (() => {
      const records = lines(mc).map(parse)
      const results = new Map()
      for (const r of records) {
        for (const b of (r?.data?.message?.content ?? [])) {
          if (b?.type === "tool-result") results.set(b.toolCallId, (Array.isArray(b.content) ? b.content : []).map((x) => x.text ?? "").join("\n"))
        }
      }
      const call = records.findIndex((r) => {
        if (r?.type !== "tool/call" || r?.data?.name !== "mpd_ext_show") return false
        let a = r.data.arguments
        if (typeof a === "string") { try { a = JSON.parse(a) } catch { a = null } }
        return a?.id === "qa-mcp-schema"
      })
      if (call === -1) return { artifact: mc, found: false }
      const cid = records[call].data.callId
      const text = results.get(cid) ?? ""
      return {
        artifact: mc, callLine: call + 1, found: true,
        hasBadInputSkip: text.includes('tool "bad_input" skipped'),
        hasBadOutputRewrite: text.includes('tool "bad_output": its outputSchema would have to be rewritten'),
        hasWithoutStructuredContent: text.includes("registered WITHOUT structuredContent"),
        tail: text.split("\n").filter((l) => l.startsWith("error")).join(" | ").slice(0, 300),
      }
    })(),
  },
}

const lcNames = proof.lifecycle.header.names ?? []
proof.lifecycle.offered = {
  headerToolCount: lcNames.length,
  mpdExtList: lcNames.includes("mpd_ext_list"),
  mpdExtShow: lcNames.includes("mpd_ext_show"),
  mpdFlowList: lcNames.includes("mpd_flow_list"),
  mpdFlowShow: lcNames.includes("mpd_flow_show"),
  mpdRolePersona: lcNames.includes("mpd_role_persona"),
  mpdRoleSpawn: lcNames.includes("mpd_role_spawn"),
}
const mcNames = proof.mcpBridge.header.names ?? []
proof.mcpBridge.offered = {
  headerToolCount: mcNames.length,
  liveStatus: mcNames.includes("mcp__qa_mcp_live__status"),
  schemaBadOutput: mcNames.includes("mcp__qa_mcp_schema__bad_output"),
  schemaBadInput: mcNames.includes("mcp__qa_mcp_schema__bad_input"),
  schemaGoodTool: mcNames.includes("mcp__qa_mcp_schema__good_tool"),
  deadServerTools: mcNames.filter((n) => n.startsWith("mcp__qa_mcp_dead__")).length,
  hangServerTools: mcNames.filter((n) => n.startsWith("mcp__qa_mcp_hang__")).length,
  dupServerTools: mcNames.filter((n) => n.startsWith("mcp__qa_mcp_dup__")).length,
}

writeFileSync(`${HERE}/proof.json`, JSON.stringify(proof, null, 2) + "\n")
console.log(JSON.stringify({
  runDirs: proof.runDirs,
  lifecycle: {
    mountLine: proof.lifecycle.mountLine.line,
    header: { line: proof.lifecycle.header.headerLine, count: proof.lifecycle.header.count },
    calls: Object.fromEntries(Object.entries(proof.lifecycle.calls).map(([k, v]) => [k, { call: v.callLine, result: v.resultLine, isError: v.isError }])),
    markers: Object.fromEntries(Object.entries(proof.lifecycle.markers).map(([k, v]) => [k, v.line])),
    isolation: Object.fromEntries(Object.entries(proof.lifecycle.isolation).map(([k, v]) => [k, v.line])),
    offered: proof.lifecycle.offered,
  },
  mcpBridge: {
    mountLine: proof.mcpBridge.mountLine.line,
    schemaPublishLine: proof.mcpBridge.schemaPublishLine.line,
    liveCall: { call: proof.mcpBridge.liveCall.callLine, result: proof.mcpBridge.liveCall.resultLine, isError: proof.mcpBridge.liveCall.isError, head: proof.mcpBridge.liveCall.textHead.slice(0, 60) },
    schemaShowText: proof.mcpBridge.schemaShowText,
    offered: proof.mcpBridge.offered,
  },
}, null, 2))
