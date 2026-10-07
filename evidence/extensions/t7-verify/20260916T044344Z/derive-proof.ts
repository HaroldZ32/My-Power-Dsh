// t7 proof derivation — every claim in the t7 summary points at ONE line of ONE artifact.
//
// Reads the raw session logs the two lanes copied next to their evidence
// (`raw/<arm>.session.decoded.jsonl`) and emits proof.json with, per claim:
//   { artifact, line, recordType, value } — a 1-based line number in that file.
// Nothing here re-runs anything and nothing is inferred from the model's prose:
// only `tool/call`, `tool/result` and `request/header` records are read.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = join(HERE, "..", "..") // evidence/extensions

const LIFECYCLE = join(EXT, "extension-lifecycle", "2026-09-16T04-43-51.532Z", "raw")
const MCP = join(EXT, "extension-mcp-bridge", "2026-09-16T04-44-32.737Z", "raw")

function lines(file) {
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "")
}

function parse(line) {
  try { return JSON.parse(line) } catch { return null }
}

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

/** Pair one tool name's first `tool/call` with the `tool/result` carrying its callId. */
function toolClaim(file, toolName) {
  const records = lines(file).map(parse)
  const callIndex = records.findIndex((record) => record?.type === "tool/call" && record?.data?.name === toolName)
  if (callIndex === -1) return { artifact: file, found: false, tool: toolName }
  const callId = records[callIndex].data.callId
  const resultIndex = records.findIndex((record) => {
    if (record?.type !== "tool/result") return false
    const blocks = record?.data?.message?.content
    return Array.isArray(blocks) && blocks.some((block) => block?.toolCallId === callId)
  })
  const result = resultIndex === -1 ? undefined : records[resultIndex]
  const blocks = result?.data?.message?.content
  const block = Array.isArray(blocks) ? blocks.find((entry) => entry?.toolCallId === callId) : undefined
  const text = resultText(result ?? {})
  return {
    artifact: file,
    found: true,
    tool: toolName,
    callLine: callIndex + 1,
    callId,
    resultLine: resultIndex === -1 ? null : resultIndex + 1,
    isError: block?.isError === true,
    textHead: (text ?? "").slice(0, 200).replaceAll("\n", " | "),
  }
}

/** The offered tool list, read from the harness request header. */
function headerClaim(file) {
  const records = lines(file).map(parse)
  const index = records.findIndex((record) => record?.type === "request/header" && Array.isArray(record?.data?.header?.tools))
  if (index === -1) return { artifact: file, found: false }
  const names = records[index].data.header.tools.map((tool) => tool?.name).filter((name) => typeof name === "string")
  return { artifact: file, found: true, headerLine: index + 1, count: names.length, names }
}

function contains(file, needle) {
  const all = lines(file)
  const index = all.findIndex((line) => line.includes(needle))
  return { artifact: file, line: index === -1 ? null : index + 1, needle, found: index !== -1 }
}

const lifecycleMain = join(LIFECYCLE, "main.session.decoded.jsonl")
const mcpSession = join(MCP, "mcp.session.decoded.jsonl")

const proof = {
  lifecycle: {
    main: {
      extList: toolClaim(lifecycleMain, "mpd_ext_list"),
      extShow: toolClaim(lifecycleMain, "mpd_ext_show"),
      flowShow: toolClaim(lifecycleMain, "mpd_flow_show"),
      skill: toolClaim(lifecycleMain, "skill"),
      rolePersona: toolClaim(lifecycleMain, "mpd_role_persona"),
      roleSpawn: toolClaim(lifecycleMain, "mpd_role_spawn"),
      header: headerClaim(lifecycleMain),
    },
    markers: {
      projectId: contains(lifecycleMain, "qa-ext-proj"),
      userId: contains(lifecycleMain, "qa-ext-user"),
      projectRejection: contains(lifecycleMain, "project-level extensions may contribute skills and flows only"),
      flowMarker: contains(lifecycleMain, "QA-MARKER-FLOW-PROJ"),
      skillMarker: contains(lifecycleMain, "QA-MARKER-SKILL-PROJ"),
      personaMarker: contains(lifecycleMain, "QA-MARKER-PERSONA-USER"),
      roleChild: contains(lifecycleMain, "QA-CHILD-MARKER-ROLE-OK"),
    },
    isolation: {
      sessionA: contains(join(LIFECYCLE, "session-a.session.decoded.jsonl"), "qa-iso-a"),
      sessionB: contains(join(LIFECYCLE, "session-b.session.decoded.jsonl"), "qa-iso-b"),
      decoyControl: contains(join(LIFECYCLE, "decoy-cwd-control.session.decoded.jsonl"), "qa-iso-decoy"),
    },
  },
  mcpBridge: {
    liveCall: toolClaim(mcpSession, "mcp__qa_mcp_live__status"),
    extShowDead: toolClaim(mcpSession, "mpd_ext_show"),
    header: headerClaim(mcpSession),
    liveTextMarker: contains(mcpSession, "Configured LSP servers"),
  },
}

const headerNames = proof.mcpBridge.header.names ?? []
proof.mcpBridge.offered = {
  liveToolInHeader: headerNames.includes("mcp__qa_mcp_live__status"),
  badOutputInHeader: headerNames.includes("mcp__qa_mcp_schema__bad_output"),
  badInputInHeader: headerNames.includes("mcp__qa_mcp_schema__bad_input"),
  deadServerToolsInHeader: headerNames.filter((name) => name.startsWith("mcp__qa_mcp_dead__")).length,
  headerToolCount: headerNames.length,
}
const lcNames = proof.lifecycle.main.header.names ?? []
proof.lifecycle.main.offered = {
  mpdExtListInHeader: lcNames.includes("mpd_ext_list"),
  mpdFlowShowInHeader: lcNames.includes("mpd_flow_show"),
  mpdRolePersonaInHeader: lcNames.includes("mpd_role_persona"),
  mpdRoleSpawnInHeader: lcNames.includes("mpd_role_spawn"),
  headerToolCount: lcNames.length,
}

writeFileSync(join(HERE, "proof.json"), JSON.stringify(proof, null, 2) + "\n")
console.log(JSON.stringify(proof, null, 2))
