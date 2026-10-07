#!/usr/bin/env node
// T-19/T-09/T-10 mounted-boot proof (t19 / lane B3): a READ-ONLY team seat — whose
// write/edit/bash are denied from its OWN profile data — must be able to deliver a LONG
// document through the artifact channel while a WRITER seat keeps its full tool list.
//
// Why a boot and not the in-process tests: those prove what THIS plugin composes (the deny
// list handed to the harness). Whether the harness then ADVERTISES the tool to the child is
// harness behaviour, witnessed only by a mounted boot — `dsh --dump-config` proves
// composition alone and never executes plugin code.
//
// Technique (the house pattern from `readonly-deny.mjs`): a local OpenAI-shaped STUB answers
// every model call, so no provider credential is needed and the flow is deterministic. The
// stub records the EXACT `tools[]` of every request the harness composes, which is the
// measured seat surface. A `mpd-headless` boot in an isolated DSH_HOME + sandbox HOME/workspace
// drives the captain through create → add_member (read-only Architect) → create_task → approve;
// the spawn then happens for real and the member's own first turn asks for the contract.
//
// Assertions:
//   A1 the CAPTAIN's request carries `agent_teams_approve` (seat classification works at all)
//   A2 the READ-ONLY MEMBER's request LISTS `agent_teams_update_task` (the artifact channel);
//      the contract tool is listed too — it is a member tool since t9 — but THIS driver never
//      CALLS it, and its header says so rather than claiming a session-log `tool/call` it does
//      not produce (t25's F1). The A4-shaped "the log records a tool/call for
//      `agent_teams_task_contract` with a non-error tool/result" claim belongs to the OTHER
//      driver, which really makes that call and is where that evidence lives:
//      `evidence/agent-teams/tools-boundaries/20260917T012056Z/driver.mjs` + `result.json`.
//   A3 the same member request does NOT list `agent_teams_approve`           <- discriminating
//   A4 this driver's A4 is the DENY contrast: `bash`/`write`/`edit` are absent from the
//      read-only member's tools[] while the captain's list keeps them (evidence: the run's
//      `result.json` assertions A3/A4/A5, decoded from the harness's own request payloads)
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..", "..")
const { decodeSessionLog } = await import(join(repoRoot, "skills", "dsh-qa", "scripts", "lib", "session-evidence.mjs"))
const { projectKey } = await import(join(repoRoot, "skills", "dsh-qa", "scripts", "lib", "workspace-isolation.mjs"))

const ARTIFACT_PATH = "evidence/t19-probe/full-document.md"
const ARTIFACT_TEXT = "FULL DELIVERABLE " + "z".repeat(9000)
const READONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
const CONTRACT_TOOL = "agent_teams_update_task"
const TEAM_NAME = "t19-artifact-channel-probe"
const TASK_SUBJECT = "T19 artifact delivery"
const CAPTAIN_MARKER = "agent_teams_approve"
const TASK_ID = "t1"

const result = {
  case: "agent-teams-deliverables-t19-mounted",
  startedAt: new Date().toISOString(),
  repoRoot,
  isolation: {},
  stub: { calls: [], totalCalls: 0 },
  captain: { steps: [], toolNames: [], hasContractTool: null },
  member: { requests: [], toolNames: [], hasContractTool: null, hasApproveTool: null, hasWriteTools: null },
  sessionLog: {},
  assertions: {},
  ok: false,
  bounds: [],
}

function log(line) {
  process.stdout.write(line + "\n")
}

/** One OpenAI-shaped SSE stub; the flow is a per-class step machine. */
function makeStub() {
  const trace = []
  const sse = (res, payload) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
  }
  const text = (body, content) => sse(body, {
    id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  })
  const call = (body, name, args) => sse(body, {
    id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe",
    choices: [{
      index: 0,
      delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${name}_${trace.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
      finish_reason: null,
    }],
  })
  let captainCalls = 0
  let memberCalls = 0
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      let parsed = {}
      try { parsed = JSON.parse(body) } catch { /* non-JSON probe traffic */ }
      const tools = Array.isArray(parsed.tools) ? parsed.tools : []
      const toolNames = tools.map((entry) => entry?.function?.name ?? entry?.name).filter((name) => typeof name === "string")
      if (toolNames.length === 0) {
        // harness auxiliary requests (instruction pass / title) carry NO tools: never a seat
        trace.push({ call: trace.length + 1, seat: "aux", toolCount: 0, hasContractTool: false, hasApproveTool: false, hasBash: false, toolResultSnippets: [], contractResultSeen: false, _toolNames: [] })
        text(res, "ack")
        return
      }
      const isCaptain = toolNames.includes(CAPTAIN_MARKER)
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      const toolResults = messages.filter((message) => message?.role === "tool").map((message) => String(message?.content ?? ""))
      const entry = {
        call: trace.length + 1,
        seat: isCaptain ? "captain" : "member",
        toolCount: toolNames.length,
        hasContractTool: toolNames.includes(CONTRACT_TOOL),
        hasWriteTool: toolNames.includes("write"),
        hasEditTool: toolNames.includes("edit"),
        hasApproveTool: toolNames.includes(CAPTAIN_MARKER),
        hasBash: toolNames.includes("bash"),
        toolResultSnippets: toolResults.map((text) => text.slice(0, 160)),
        contractResultSeen: toolResults.some((text) => text.includes(TASK_SUBJECT) && text.includes("acceptance")),
        _toolNames: toolNames,
      }
      trace.push(entry)
      if (!isCaptain) {
        memberCalls += 1
        result.member.requests.push({ ...entry, _toolNames: undefined })
        const promptText = messages.map((message) => typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "")).join("\n")
        const attempt = /Attempt id: ([0-9a-f-]{36})/.exec(promptText)?.[1]
        if (attempt === undefined) {
          // the spawn WELCOME turn carries no capability: the seat cannot deliver yet (T-05's
          // claimable/blocked wording lives here) — wait for the assignment turn instead.
          text(res, "welcome received; waiting for an assignment")
          return
        }
        if (result.member.delivered === true) {
          text(res, "delivered")
          return
        }
        result.member.attemptIdSeen = attempt
        result.member.delivered = true
        call(res, CONTRACT_TOOL, { task_id: TASK_ID, status: "pending", attempt_id: attempt, artifact: { path: ARTIFACT_PATH, text: ARTIFACT_TEXT } })
        return
      }
      captainCalls += 1
      const step = captainCalls
      result.captain.steps.push({ step, toolCount: toolNames.length, toolResults: toolResults.length })
      if (step === 1) {
        call(res, "agent_teams_create", { name: TEAM_NAME, description: "T-49 read-only contract seat probe (stub-driven)", approval: "required" })
      }
      else if (step === 2) {
        call(res, "agent_teams_add_member", { name: "Architect", role: "architect", toolDeny: READONLY_DENY })
      }
      else if (step === 3) {
        call(res, "agent_teams_create_task", {
          subject: TASK_SUBJECT,
          description: "The member must READ this contract through agent_teams_task_contract.",
          assignee: "Architect",
          kind: "verification",
          objective: "prove a read-only seat can read a task contract",
          acceptance: ["the contract is readable through agent_teams_task_contract"],
          verify: ["bun test"],
        })
      }
      else if (step === 4) {
        call(res, "agent_teams_approve", { confirmation: "Approved for the local T-49 mounted probe; the stub is the only approver present." })
      }
      else if (step === 5) {
        call(res, "bash", { command: "sleep 25", description: "hold the process open while the member takes its first turn" })
      }
      else {
        text(res, "PROBE-CAPTAIN-DONE")
      }
    })
  })
  return {
    trace,
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => server.close(),
  }
}

function runAsync(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk) => { out += chunk })
    child.stderr.on("data", (chunk) => { out += chunk })
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch { /* gone */ } }, options.timeout ?? 600000)
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, out }) })
  })
}

/** Decode every session log under the sandbox store, classified by the seat's own tool list. */
function sessionLogs(dshHome, workspace) {
  const store = join(dshHome, "sessions", projectKey(workspace))
  const sessions = []
  if (!existsSync(store)) return { store, sessions }
  for (const id of readdirSync(store)) {
    const dir = join(store, id)
    if (!statSync(dir).isDirectory()) continue
    for (const name of readdirSync(dir)) {
      if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
      const file = join(dir, name)
      const decoded = decodeSessionLog(file)
      const records = []
      for (const line of decoded.text.split("\n")) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try { records.push(JSON.parse(trimmed)) } catch { /* undecodable line */ }
      }
      const header = records.find((record) => record?.type === "request/header")
      const tools = (header?.data?.header?.tools ?? []).map((entry) => entry?.function?.name ?? entry?.name).filter((value) => typeof value === "string")
      const recordTypes = [...new Set(records.map((record) => record?.type).filter((value) => typeof value === "string"))]
      const calls = records.filter((record) => record?.type === "tool/call").map((record) => record?.data?.name ?? record?.data?.call?.name)
      const toolRecords = records.filter((record) => typeof record?.type === "string" && record.type.startsWith("tool/")).map((record) => ({ type: record.type, name: record?.data?.name ?? record?.data?.call?.name ?? null, isError: record?.data?.isError === true, keys: Object.keys(record?.data ?? {}) }))
      const results = records.filter((record) => record?.type === "tool/result").map((record) => ({
        isError: record?.data?.isError === true || record?.data?.result?.isError === true,
        text: JSON.stringify(record?.data ?? {}).slice(0, 400),
      }))
      sessions.push({ id, file, records: records.length, frames: decoded.frames, toolCount: tools.length, tools, calls, results, toolRecords, recordTypes, isMember: !tools.includes(CAPTAIN_MARKER), hasContractTool: tools.includes(CONTRACT_TOOL) })
    }
  }
  return { store, sessions }
}

async function main() {
  const dshHome = join(here, "sandbox", "dsh-home")
  const runHome = join(here, "sandbox", "home")
  const ws = join(here, "sandbox", "ws")
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  result.isolation = { dshHome, runHome, ws, realHomeUntouched: !dshHome.startsWith(homedir() + "/.dsh"), sandboxInsideEvidence: true }
  log(`[t49] sandbox DSH_HOME=${dshHome} HOME=${runHome} ws=${ws}`)
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(dshHome, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-probe-local-stub" }

  const install = await runAsync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { env, timeout: 600000 })
  result.isolation.installExit = install.status
  if (install.status !== 0) {
    result.reason = "install-profile failed"
    result.tail = install.out.slice(-4000)
    return
  }
  const patchPath = join(dshHome, "cordis.patch.yml")
  let patch = readFileSync(patchPath, "utf8")
  if (!/mpd-agent-teams-plugin\/lib\/index\.js/.test(patch)) {
    result.reason = "the sandbox profile does not compose the adopted agent-teams row; this probe measures the REAL profile"
    result.tail = patch.slice(0, 2000)
    return
  }
  const stub = makeStub()
  const port = await stub.listen()
  patch += ["", "- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n")
  writeFileSync(patchPath, patch)
  log(`[t49] stub listening on 127.0.0.1:${port}; booting the headless profile`)
  const run = await runAsync("dsh", ["--profile", "mpd-headless", "Run the T-49 probe exactly as the tool results instruct."], { env, cwd: ws, timeout: 600000 })
  stub.close()
  result.stub.calls = stub.trace.map((entry) => ({ ...entry, _toolNames: undefined }))
  result.stub.toolNamesBySeat = {
    captain: stub.trace.find((entry) => entry.seat === "captain")?._toolNames ?? [],
    member: stub.trace.find((entry) => entry.seat === "member")?._toolNames ?? [],
  }
  result.stub.totalCalls = stub.trace.length
  result.boot = { exit: run.status, tail: run.out.slice(-6000), applyCrash: /plugin tree failed to load|failed to apply loader entry|JsonSchemaError|unsupported JSON schema/.test(run.out) }
  log(`[t49] boot exit=${run.status} stubCalls=${stub.trace.length}`)

  const captainTrace = stub.trace.find((entry) => entry.seat === "captain")
  const memberTrace = stub.trace.find((entry) => entry.seat === "member")
  const memberTraceWithResult = stub.trace.find((entry) => entry.seat === "member" && entry.contractResultSeen)
  if (captainTrace) { result.captain.toolNames = captainTrace._toolNames; result.captain.hasContractTool = captainTrace.hasContractTool }
  if (memberTrace) {
    result.member.toolNames = memberTrace._toolNames
    result.member.hasContractTool = memberTrace.hasContractTool
    result.member.hasApproveTool = memberTrace.hasApproveTool
    result.member.hasWriteTools = memberTrace.hasBash
  }
  const artifactFile = join(ws, ARTIFACT_PATH)
  const artifactExists = existsSync(artifactFile)
  const artifactBody = artifactExists ? readFileSync(artifactFile, "utf8") : ""
  const teamDir = join(ws, ".mpd", "team", TEAM_NAME)
  const artifactRecorded = (() => {
    try {
      const teamFile = readdirSync(teamDir).find((name) => name === "team.json")
      if (teamFile === undefined) return false
      const record = JSON.parse(readFileSync(join(teamDir, teamFile), "utf8"))
      const task = (record.tasks ?? []).find((entry) => entry.id === TASK_ID)
      return (task?.artifacts ?? []).some((entry) => entry.path === ARTIFACT_PATH && entry.bytes === ARTIFACT_TEXT.length)
    } catch { return false }
  })()
  result.artifact = { path: ARTIFACT_PATH, exists: artifactExists, bytes: artifactBody.length, expectedBytes: ARTIFACT_TEXT.length, recorded: artifactRecorded, bodyHead: artifactBody.slice(0, 40) }
  const logs = sessionLogs(dshHome, ws)
  result.sessionLog = { store: logs.store, sessions: logs.sessions.map(({ id, records, frames, toolCount, calls, results, toolRecords, recordTypes, isMember, hasContractTool }) => ({ id, records, frames, isMember, hasContractTool, toolCount, calls, toolRecords, recordTypes, results: results.slice(0, 4) })) }
  const memberLog = logs.sessions.find((session) => session.isMember && session.id !== undefined)

  result.assertions = {
    A1_captain_seat_classified: Boolean(captainTrace),
    A2_member_lists_update_tool: memberTrace ? memberTrace.hasContractTool === true : false,
    A3_member_does_not_list_approve: memberTrace ? memberTrace.hasApproveTool === false : false,
    A4_member_denied_write_tools: memberTrace ? memberTrace.hasBash === false && memberTrace.hasWriteTool === false && memberTrace.hasEditTool === false : false,
    A5_captain_is_a_writer_seat: captainTrace ? captainTrace.hasBash === true && captainTrace.hasWriteTool === true : false,
    A6_artifact_written_from_the_readonly_seat: artifactExists && artifactBody.startsWith("FULL DELIVERABLE") && artifactBody.length === ARTIFACT_TEXT.length,
    A7_task_records_the_artifact_path: artifactRecorded,
  }
  result.member.requests = stub.trace.filter((entry) => entry.seat === "member").map(({ _toolNames, ...rest }) => rest)
  result.ok = Object.values(result.assertions).every((value) => value === true)
  result.bounds = [
    "One boot window, one stub-driven team (captain + ONE read-only member whose toolDeny is the seven-name read-only set), one 9 KB artifact.",
    "The artifact write is proven from the FILE ON DISK plus the task record the tool wrote, and the seat surfaces are read from the harness's own request payloads; the model itself is a local stub.",
    "The probe measures whether a read-only seat CAN deliver through the channel, never a real model's choice to.",
  ]
  result.finishedAt = new Date().toISOString()
  log(`[t49] assertions ${JSON.stringify(result.assertions)}`)
}

main().catch((error) => {
  result.error = String(error?.stack ?? error)
}).finally(async () => {
  writeFileSync(join(here, "result.json"), JSON.stringify(result, null, 2))
  log(`[t49] wrote ${join(here, "result.json")} ok=${result.ok}`)
  log(readFileSync(join(here, "result.json"), "utf8").slice(0, 2000))
  process.exit(result.ok ? 0 : 1)
})
