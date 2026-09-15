#!/usr/bin/env node
// Shared proof helpers for the extension QA cases (extension-lifecycle.mjs and
// extension-mcp-bridge.mjs), plus the multi-session isolation arm.
//
// WHY A LOCAL STUB MODEL (and why this is not a mock of the thing under test):
// `dsh` headless drives a REAL session — real plugin tree, real tool registry,
// real tool execution — but a provider credential is needed for the model step,
// and a QA sandbox must never depend on one (this environment has none: the real
// ~/.dsh holds no provider key and is read-only). So the model step is answered
// by a local OpenAI-shaped endpoint (the `software-smoke` pattern): the harness
// really executes the tool calls the stub scripts, and the results come back as
// real `tool` messages. NOTHING about the extension interface is mocked: the
// rows, the registry, the discovery, the providers, the bridge and the tools are
// the shipped ones, and every assertion is read from the HARNESS's own session
// log (`lib/session-evidence.mjs`) or from the request the harness really sent.
//
// Isolation (Hard rule 1): DSH_HOME + HOME + the session cwd are all under one
// temp sandbox, the launcher cwd is a decoy directory that must never leak into a
// session, and every boot is followed by `assertSessionsSandboxed`.
//
// This module is intentionally importable: it runs nothing until a case calls it,
// and its own `--self-test` is offline (stub protocol + fixtures + contract).
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { REPO_ROOT, projectKey, assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { readSessionEvents, findToolCall, recordedToolNames } from "./lib/session-evidence.mjs"

export const REPO = REPO_ROOT
export const EX_QA_HOME = "mpd-ext-qa"

function fail(message) {
  console.error("[extension-isolation] FAIL: " + message)
  process.exit(1)
}

// ── fixtures: extension directories ─────────────────────────────────────────

export const SKILL_MD = (name, marker, description = `QA extension skill ${name}`) => `---
name: ${name}
description: "${description}"
---

# ${name}

QA-MARKER-SKILL:${marker}
`

export const FLOW_JSON = (id, title, marker) => ({
  id,
  title,
  description: `QA extension flow ${id}`,
  whenToUse: "Use when the extension QA case asks for this flow.",
  steps: [
    { title: "Read the input", detail: `QA-MARKER-FLOW:${marker}`, tool: "read" },
    { title: "Report the findings", output: "A short list of findings." },
  ],
})

export const PERSONA_MD = (marker) => `You are a QA extension role. QA-MARKER-PERSONA:${marker}\n`

/** Write one extension directory (data plane) with optional assets. */
export function writeExtension(baseDir, id, manifest, assets = {}) {
  const dir = join(baseDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "mpd-ext.json"), JSON.stringify(manifest, null, 2) + "\n")
  for (const [name, content] of Object.entries(assets.skills ?? {})) {
    mkdirSync(join(dir, "skills", name), { recursive: true })
    writeFileSync(join(dir, "skills", name, "SKILL.md"), content)
  }
  for (const [name, content] of Object.entries(assets.flows ?? {})) {
    mkdirSync(join(dir, "flows"), { recursive: true })
    writeFileSync(join(dir, "flows", name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n")
  }
  for (const [name, content] of Object.entries(assets.files ?? {})) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

/** A minimal, contract-conforming descriptor. */
export function manifest(id, contributes = {}, extra = {}) {
  return { apiVersion: 1, id, description: `QA extension ${id}`, contributes, ...extra }
}

// ── the local OpenAI-shaped stub model ──────────────────────────────────────

/**
 * A deterministic OpenAI-shaped streaming endpoint.
 *
 * `script` is a list of steps:
 *   { tool: "<name>", args: {...} }   issue one real tool call
 *   { text: "..." }                   finish the turn with assistant text
 * A request whose conversation already contains a tool result advances the
 * script by the NUMBER OF TOOL RESULTS it sees, so the driver is stateless and
 * safe against a repeated request (the response is memoized by message hash).
 * A request carrying `childMarker` and NO tool results is a spawned subagent
 * (role spawn / workmate): it gets `childAnswer` immediately.
 */
export function makeStubModel({ script = [], childMarker = "", childAnswer = "QA-STUB-CHILD-OK", childScript = null, label = "stub" } = {}) {
  const trace = []
  const memo = new Map()
  let requests = 0
  const chunk = (delta, finish) => ({
    id: "chatcmpl-" + label,
    object: "chat.completion.chunk",
    created: 1,
    model: label,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  })
  const sse = (res, payload) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    res.write("data: " + JSON.stringify(payload) + "\n\n")
    res.write("data: [DONE]\n\n")
    res.end()
  }
  const textOf = (message) => {
    const content = message?.content
    if (typeof content === "string") return content
    if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("")
    return ""
  }
  /** Answer one request: a tool call while the script has steps, else plain text. */
  const decide = (offeredTools, toolResults, blob) => {
    if (offeredTools.length === 0) return { kind: "text", text: "QA-STUB-NO-TOOLS", why: "plain text (no tools offered)" }
    if (childMarker !== "" && blob.includes(childMarker) && toolResults.length === 0
      || (childMarker !== "" && blob.includes(childMarker) && childScript !== null && toolResults.length < childScript.length)) {
      if (childScript !== null) {
        const step = childScript[toolResults.length]
        if (step !== undefined && step.text === undefined) {
          return { kind: "tool", name: step.tool, args: step.args ?? {}, why: "spawned-child step " + step.tool }
        }
      }
      return { kind: "text", text: childScript !== null && childScript[toolResults.length]?.text !== undefined ? childScript[toolResults.length].text : childAnswer, why: "spawned-child answer" }
    }
    const step = script[toolResults.length]
    if (step === undefined || step.text !== undefined) {
      return { kind: "text", text: step?.text ?? "QA-STUB-SCRIPT-EXHAUSTED", why: "final text" }
    }
    return { kind: "tool", name: step.tool, args: step.args ?? {}, why: "tool call " + step.tool }
  }
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (piece) => { body += piece })
    req.on("end", () => {
      let parsed = {}
      try { parsed = JSON.parse(body) } catch { /* keep {} */ }
      const tools = Array.isArray(parsed.tools) ? parsed.tools : []
      const offeredTools = tools.map((entry) => entry?.function?.name ?? entry?.name).filter((name) => typeof name === "string")
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      const toolResults = messages.filter((message) => message?.role === "tool" || message?.role === "tool_result").map(textOf)
      const blob = JSON.stringify(messages)
      requests += 1
      const key = createHash("sha256").update(blob + "\u0000" + offeredTools.join(",")).digest("hex")
      const cached = memo.get(key)
      const decision = cached ?? decide(offeredTools, toolResults, blob)
      memo.set(key, decision)
      trace.push({
        request: requests,
        path: req.url ?? "",
        offeredTools,
        toolResultCount: toolResults.length,
        toolResults,
        decision: decision.why + (cached === undefined ? "" : " (memoized)"),
        decided: cached === undefined ? "fresh" : "memoized",
      })
      if (decision.kind === "text") return sse(res, chunk({ role: "assistant", content: decision.text }, "stop"))
      return sse(res, chunk({
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: "call_" + label + "_" + toolResults.length,
          type: "function",
          function: { name: decision.name, arguments: JSON.stringify(decision.args) },
        }],
      }))
    })
  })
  return {
    trace,
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    requests: () => requests,
  }
}

// ── sandbox + boot ──────────────────────────────────────────────────────────

/**
 * One temp sandbox: DSH_HOME (`dsh-home`), HOME (`run-home`) and the session
 * workspace (`ws`) plus a decoy directory (`decoy`) that holds the extension a
 * process-cwd-based (apply-time) discovery would wrongly show every session.
 */
export function createSandbox(slug) {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-" + slug + "-"))
  const dshHome = join(sandbox, "dsh-home")
  const runHome = join(sandbox, "run-home")
  const decoy = join(sandbox, "decoy")
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(runHome, { recursive: true })
  mkdirSync(decoy, { recursive: true })
  const ws = sandboxWorkspace(sandbox)
  const env = {
    ...process.env,
    DSH_HOME: dshHome,
    HOME: runHome,
    DEEPSEEK_API_KEY: "sk-extension-qa-local-stub",
  }
  if (dshHome.startsWith(join(process.env.HOME ?? "", ".dsh"))) fail(slug + ": isolation assertion — DSH_HOME is the real home")
  return { sandbox, dshHome, runHome, ws, decoy, env }
}

/** Install the bundle rows for the headless profile into the sandbox (checkout-absolute paths). */
export function installProfile({ sandbox, dshHome, env, timeoutMs = 900000 }) {
  return runAsync(process.execPath, [
    join(REPO, "scripts", "install-profile.mjs"),
    "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain",
  ], { env, cwd: sandbox, timeoutMs })
}

/** Point the harness's deepseek route at the local stub (appended to the composed home patch). */
export function useStubRoute(dshHome, port) {
  const patchFile = join(dshHome, "cordis.patch.yml")
  const patch = readFileSync(patchFile, "utf8") + [
    "",
    "- id: llm-deepseek",
    "  config:",
    "    baseURL: http://127.0.0.1:" + port + "/v1",
    "    apiKeyEnv: DEEPSEEK_API_KEY",
    "",
  ].join("\n")
  writeFileSync(patchFile, patch)
  return patchFile
}

export function runAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (piece) => { out += piece })
    child.stderr.on("data", (piece) => { out += piece })
    child.on("error", (error) => resolve({ status: -1, out: out + "\nspawn error: " + error.message }))
    child.on("close", (status) => resolve({ status, out }))
  })
}

/** One real headless session: a REAL dsh process whose model step the stub answers. */
export async function bootSession({ slug, env, cwd, prompt, stub, timeoutMs = 900000, extraArgs = [] }) {
  const started = Date.now()
  const run = await runAsync("dsh", ["--profile", "mpd-headless", ...extraArgs, prompt], { env, cwd, timeoutMs })
  return { ...run, durationMs: Date.now() - started, stubRequests: stub === undefined ? 0 : stub.requests() }
}

/** Read the harness-recorded evidence of one workspace's newest session. */
export function sessionEvidence(dshHome, ws, toolNames = []) {
  const store = readSessionEvents(dshHome, { workspace: ws })
  const names = recordedToolNames(store.records)
  const calls = {}
  for (const name of toolNames) calls[name] = findToolCall(store.records, name)
  return { store, names, calls }
}

/**
 * Per-call results: `findToolCall` joins every result of a tool name, which is
 * useless when one session calls the same tool several times with different
 * arguments (the MCP case calls `mpd_ext_show` once per extension). Pairing by
 * `toolCallId` keeps every assertion tied to the call it belongs to.
 */
export function toolResultsByCallId(store) {
  const map = new Map()
  for (const record of store?.records ?? []) {
    if (record?.type !== "tool/result") continue
    const blocks = record?.data?.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block?.type !== "tool-result") continue
      const text = (Array.isArray(block.content) ? block.content : [])
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
      map.set(block.toolCallId, { text, isError: block.isError === true })
    }
  }
  return map
}

/**
 * Every recorded call of one tool, with its arguments (in record order).
 * The harness records `tool/call.data.arguments` as a JSON STRING (measured:
 * `"arguments": "{\"id\":\"qa-mcp-dead\"}"`), so it is parsed here — comparing
 * against an object would silently match nothing and every per-call assertion
 * would then pass or fail for the wrong reason.
 */
export function callsOf(store, name) {
  return (store?.records ?? [])
    .filter((record) => record?.type === "tool/call" && record?.data?.name === name)
    .map((record) => {
      const raw = record.data.arguments
      let parsed = null
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw) } catch { parsed = null }
      } else if (raw !== undefined) parsed = raw
      return { callId: record.data.callId, arguments: parsed }
    })
}

export function isolationStep(dshHome, sandbox, label) {  try {
    return { ok: true, ...assertSessionsSandboxed(dshHome, sandbox, { label }) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** Copy the raw session log next to the evidence so the claim is auditable. */
export function keepRawSession(outDir, name, store) {
  try {
    if (store.file !== null && existsSync(store.file)) {
      mkdirSync(join(outDir, "raw"), { recursive: true })
      writeFileSync(join(outDir, "raw", name + ".session.jsonl.zstd"), readFileSync(store.file))
      writeFileSync(join(outDir, "raw", name + ".session.decoded.jsonl"), store.records.map((record) => JSON.stringify(record)).join("\n") + "\n")
    }
  } catch { /* evidence copy is best-effort; result.json carries the verdict */ }
}

export function writeEvidence(outDir, slug, payload, logText) {
  mkdirSync(outDir, { recursive: true })
  const ok = payload.ok
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, slug, ...payload }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), logText + "\n")
  console.log("[" + slug + "] ok=" + ok + " -> " + outDir)
  for (const [name, step] of Object.entries(payload.steps ?? {})) {
    console.log("  " + name + ": " + JSON.stringify(step).slice(0, 300))
  }
  return ok
}

export function timestamp() {
  return new Date().toISOString().replaceAll(":", "-")
}

export function cleanup(sandbox) {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best-effort scratch cleanup */ }
}

/** Crash signatures the boot log must never carry (AGENTS.md §12). */
export const APPLY_CRASH_SIGNATURES = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
]

/**
 * The house prerequisite gate (SKILL.md): a case whose prerequisite is absent
 * prints ONE `[mpd-qa] SKIP …` marker as its FIRST stdout line and exits 0, while
 * an explicit strict request (`--no-skip` / `--require-pack`) turns the same
 * absence into a loud FAIL. Call it before any other output.
 */
export function gatePrereqs({ slug, prereqs }) {
  const strict = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")
  for (const prereq of prereqs) {
    if (prereq.present()) continue
    console.log("[mpd-qa] " + (strict ? "FAIL" : "SKIP")
      + " case=" + slug + " lane=real reason=" + prereq.code
      + " prereq=" + prereq.probe + ' remedy="' + prereq.remedy + '"')
    process.exit(strict ? 1 : 0)
  }
}

export function binaryPresent(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 60000 })
  return result.status === 0
}

export function crashSignatures(bootLog) {
  return APPLY_CRASH_SIGNATURES.filter((signature) => bootLog.includes(signature))
}

// ── the multi-session isolation arm ─────────────────────────────────────────

/**
 * Two sessions on ONE host root (same DSH_HOME + HOME), different session cwds,
 * plus a two-sided control:
 *   negative — a decoy extension in the LAUNCHER cwd is visible to no session
 *              (an apply-time/process-cwd discovery would show it to both);
 *   positive — the same decoy IS listed once a session's own cwd is that
 *              directory, so the negative arm cannot pass vacuously.
 */
export async function isolationArm({ slug, sandbox, dshHome, env, decoy, outDir }) {
  const steps = {}
  const logs = []
  const wsA = join(sandbox, "ws-a")
  const wsB = join(sandbox, "ws-b")
  mkdirSync(wsA, { recursive: true })
  mkdirSync(wsB, { recursive: true })
  writeExtension(join(wsA, ".mpd", "extensions"), "qa-iso-a", manifest("qa-iso-a", { skills: [{ root: "skills" }] }), {
    skills: { "qa-iso-a-skill": SKILL_MD("qa-iso-a-skill", "A") },
  })
  writeExtension(join(wsB, ".mpd", "extensions"), "qa-iso-b", manifest("qa-iso-b", { skills: [{ root: "skills" }] }), {
    skills: { "qa-iso-b-skill": SKILL_MD("qa-iso-b-skill", "B") },
  })
  writeExtension(join(decoy, ".mpd", "extensions"), "qa-iso-decoy", manifest("qa-iso-decoy", { skills: [{ root: "skills" }] }), {
    skills: { "qa-iso-decoy-skill": SKILL_MD("qa-iso-decoy-skill", "DECOY") },
  })

  for (const [name, cwd, expected, forbidden] of [
    ["session-a", wsA, "qa-iso-a", ["qa-iso-b", "qa-iso-decoy"]],
    ["session-b", wsB, "qa-iso-b", ["qa-iso-a", "qa-iso-decoy"]],
    ["decoy-cwd-control", decoy, "qa-iso-decoy", ["qa-iso-a", "qa-iso-b"]],
  ]) {
    const stub = makeStubModel({ script: [{ tool: "mpd_ext_list", args: {} }, { text: "isolation-" + name }], label: name })
    const port = await stub.listen()
    useStubRoute(dshHome, port)
    const run = await bootSession({ slug, env, cwd, prompt: "Call mpd_ext_list once and report the extension ids you received.", stub })
    const evidence = sessionEvidence(dshHome, cwd, ["mpd_ext_list"])
    await stub.close()
    keepRawSession(outDir, name, evidence.store)
    const resultText = evidence.calls.mpd_ext_list?.resultText ?? ""
    steps[name] = {
      ok: run.status === 0
        && Boolean(evidence.calls.mpd_ext_list?.succeeded)
        && resultText.includes(expected)
        && forbidden.every((id) => !resultText.includes(id)),
      exit: run.status,
      cwd,
      recorded: Boolean(evidence.calls.mpd_ext_list?.called),
      succeeded: Boolean(evidence.calls.mpd_ext_list?.succeeded),
      sawExpected: resultText.includes(expected),
      sawForbidden: forbidden.filter((id) => resultText.includes(id)),
      offeredExtTools: evidence.names.filter((name) => name.startsWith("mpd_ext_") || name.startsWith("mpd_flow_")),
      isolation: isolationStep(dshHome, sandbox, slug + ":" + name),
    }
    logs.push("=== " + name + " (cwd=" + cwd + ") ===\n" + run.out.slice(-4000))
  }
  steps.ok = Object.values(steps).every((step) => step.ok === true)
  return { steps, logs }
}

// ── self-test (offline) ─────────────────────────────────────────────────────

async function selfTest() {
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }

  // 1) the stub protocol really answers an OpenAI-shaped request with a tool call.
  const stub = makeStubModel({ script: [{ tool: "mpd_ext_list", args: {} }, { text: "done" }], label: "selftest" })
  const port = await stub.listen()
  const askOnce = async (messages, tools) => {
    const response = await fetch("http://127.0.0.1:" + port + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "probe", stream: true, messages, tools }),
    })
    return await response.text()
  }
  const first = await askOnce([{ role: "user", content: "go" }], [{ type: "function", function: { name: "mpd_ext_list" } }])
  check(first.includes("mpd_ext_list"), "the stub did not answer with the scripted tool call")
  const second = await askOnce([
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "mpd_ext_list", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "[]" },
  ], [{ type: "function", function: { name: "mpd_ext_list" } }])
  check(second.includes("done"), "the stub did not advance to the final text after a tool result")
  const capped = await askOnce([{ role: "user", content: "no tools here" }], [])
  check(capped.includes("QA-STUB-NO-TOOLS"), "the stub must answer a tool-less request with plain text")
  const childStub = makeStubModel({ script: [{ tool: "x", args: {} }], childMarker: "QA-CHILD-MARKER", childAnswer: "QA-CHILD-ANSWER" })
  const childPort = await childStub.listen()
  const childText = await (await fetch("http://127.0.0.1:" + childPort + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "QA-CHILD-MARKER do it" }], tools: [{ type: "function", function: { name: "x" } }] }),
  })).text()
  check(childText.includes("QA-CHILD-ANSWER"), "a spawned child carrying the marker must get the child answer")
  await stub.close()
  await childStub.close()

  // 2) the fixtures this module writes satisfy the frozen descriptor contract.
  const sdkPath = join(REPO, "packages", "mpd-ext-plugin", "dist", "sdk.js")
  check(existsSync(sdkPath), "the extension SDK build artifact is missing (bun run build in the package)")
  if (existsSync(sdkPath)) {
    const sdk = await import(pathToFileURL(sdkPath).href)
    const contract = sdk.MPD_EXT_CONTRACT
    const sample = manifest("qa-sample", {
      skills: [{ root: "skills" }],
      flows: [{ dir: "flows", rank: 300 }],
      mcp: [{ serverName: "qa_lsp", transport: "stdio", command: "node", args: ["x.js"], cwd: "." }],
      roles: [{ name: "QA Reviewer", persona: "personas/r.md" }],
    })
    for (const key of Object.keys(sample)) check(contract.descriptorKeys.includes(key), "descriptor key outside the contract: " + key)
    for (const key of Object.keys(sample.contributes)) check(contract.contributesKeys.includes(key), "contributes key outside the contract: " + key)
    check(contract.apiVersion === 1, "the contract apiVersion must be 1")
    check(contract.defaultRank === 300, "the default rank must be 300")
    check(contract.projectKinds.join(",") === "skills,flows", "the project plane may contribute skills+flows only")
    check(contract.manifestFile === "mpd-ext.json", "the manifest file name changed")
  }

  // 3) the shipped reference extension is contract-conforming and still discovers its assets.
  const exampleDir = join(REPO, "extensions", "mpd-ext-example")
  check(existsSync(join(exampleDir, "mpd-ext.json")), "the shipped example extension is missing")
  if (existsSync(join(exampleDir, "mpd-ext.json"))) {
    const example = JSON.parse(readFileSync(join(exampleDir, "mpd-ext.json"), "utf8"))
    check(example.apiVersion === 1, "the shipped example must declare apiVersion 1")
    check(example.enabled === false, "the shipped example must stay disabled by default")
    check(existsSync(join(exampleDir, example.contributes.roles[0].persona)), "the example role persona is missing")
    check(existsSync(join(exampleDir, "flows", "change-triage-flow.json")), "the example flow file is missing")
  }

  // 4) the boot recipe this module depends on still exists and is wired.
  const installer = readFileSync(join(REPO, "scripts", "install-profile.mjs"), "utf8")
  check(installer.includes('"mpd-ext"'), "install-profile.mjs no longer writes the mpd-ext row")
  const patch = readFileSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch no longer carries the mpd-ext row")
  const lsp = join(REPO, "packages", "mpd-mcp-lsp", "dist", "cli.js")
  check(existsSync(lsp), "the repo's own stdio MCP server (packages/mpd-mcp-lsp/dist/cli.js) is missing")

  if (problems.length > 0) {
    for (const problem of problems) console.error("[extension-isolation self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[extension-isolation self-test] ok: stub protocol (tool call, advance, child marker, no-tools text) + descriptor contract + shipped example + boot recipe verified")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--self-test")) {
  await selfTest()
}
