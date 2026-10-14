#!/usr/bin/env node
// diff-harness.mjs — the B1 differential proof: OUR ast_grep server vs the VENDORED one it replaces.
//
// Both servers are driven over real stdio with the SAME request list, against the SAME fake engine
// (fake-sg.mjs), which records the argv of every invocation. The comparison is therefore two-fold:
//   (a) the CLI translation — the exact argv each server spawns, per pass; and
//   (b) the MCP surface — the exact JSON-RPC line each server writes back, byte for byte after
//       masking the two fields that CANNOT be equal by construction (wall-clock `durationMs`, and a
//       tool description, which this repository now writes in its own words).
// A missing ast-grep binary is the one scenario whose resolver TEXT differs by design; its message
// and hints are masked and its SHAPE is compared instead.
//
// usage: node diff-harness.mjs <oracle-cli.mjs> <new-cli.js> <result.json> <tmp-dir>
import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** Absolute path of the vendored server under test. */
const oraclePath = process.argv[2]
/** Absolute path of the replacement server under test. */
const newPath = process.argv[3]
/** Where the JSON result is written. */
const outPath = process.argv[4]
/** Scratch directory for per-run argv logs. */
const tmpDir = process.argv[5]

/** The fake engine the servers must spawn. */
const FAKE_SG = join(import.meta.dirname, "fake-sg.mjs")
/** Working directory handed to every tool call through MPD_AST_GREP_PROJECT_CWD. */
const PROJECT_CWD = process.argv[6]

/** A `search` call with captures, over a real path list. */
const searchCall = (extra = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "search", arguments: { pattern: "foo($A)", language: "typescript", paths: ["src"], ...extra } },
})

/** A `rewrite` call; `apply` decides which passes run. */
const rewriteCall = (extra = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "rewrite",
    arguments: { pattern: "foo($A)", rewrite: "qux($A)", language: "typescript", paths: ["src"], ...extra },
  },
})

/** A `scan` call over inline rules. */
const scanCall = (extra = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "scan", arguments: { inlineRules: "id: no-foo\nlanguage: TypeScript\nrule:\n  pattern: foo($A)\n", paths: ["src"], ...extra } },
})

/** Every scenario: the canned engine answer, the requests, and how many response lines to expect. */
const CASES = [
  {
    id: "protocol-surface",
    sg: "search-match",
    expect: 7,
    requests: [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qa", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: {} },
      { jsonrpc: "2.0", id: 5, method: "no/such/method" },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope", arguments: {} } },
      "NOT JSON AT ALL",
    ],
  },
  { id: "search-match", sg: "search-match", expect: 1, requests: [searchCall()] },
  { id: "search-none", sg: "search-none", expect: 1, requests: [searchCall()] },
  { id: "search-all-flags", sg: "search-match", expect: 1, requests: [searchCall({ selector: "call_expression", strictness: "ast", globs: ["*.ts", "!*.test.ts"], maxMatches: 7, timeoutMs: 5000, includeHidden: true, followSymlinks: true, force: true, workdir: PROJECT_CWD })] },
  { id: "search-invalid-args", sg: "search-none", expect: 1, requests: [searchCall({ pattern: undefined })] },
  { id: "search-unknown-prop", sg: "search-none", expect: 1, requests: [searchCall({ nope: 1 })] },
  { id: "search-hint-reject", sg: "search-none", expect: 1, requests: [searchCall({ pattern: "foo($name)" })] },
  { id: "search-hint-force", sg: "search-match", expect: 1, requests: [searchCall({ pattern: "foo($name)", force: true })] },
  { id: "search-warn-alternation", sg: "search-match", expect: 1, requests: [searchCall({ pattern: "a|b" })] },
  { id: "search-truncated", sg: "search-truncate", expect: 1, requests: [searchCall({ maxMatches: 1 })] },
  { id: "search-sg-exit2", sg: "sgerr", expect: 1, requests: [searchCall()] },
  { id: "search-error-node", sg: "errornode", expect: 1, requests: [searchCall()] },
  { id: "search-malformed-salvage", sg: "malformed", expect: 1, requests: [searchCall()] },
  { id: "search-garbage-only", sg: "garbage", expect: 1, requests: [searchCall()] },
  { id: "rewrite-dry-run", sg: "rewrite-dry", expect: 1, requests: [rewriteCall()] },
  { id: "rewrite-apply", sg: "rewrite-apply", expect: 1, requests: [rewriteCall({ apply: true })] },
  { id: "rewrite-stale-preview", sg: "rewrite-stale", expect: 1, requests: [rewriteCall({ apply: true })] },
  { id: "rewrite-apply-no-match", sg: "search-none", expect: 1, requests: [rewriteCall({ apply: true })] },
  { id: "rewrite-unbound-metavar", sg: "rewrite-dry", expect: 1, requests: [rewriteCall({ rewrite: "qux($NOPE)" })] },
  { id: "rewrite-cardinality", sg: "rewrite-dry", expect: 1, requests: [rewriteCall({ pattern: "foo($A)", rewrite: "qux($$$A)" })] },
  { id: "rewrite-invalid-args", sg: "search-none", expect: 1, requests: [rewriteCall({ unknownFlag: true })] },
  { id: "scan-dry-run", sg: "scan-dry", expect: 1, requests: [scanCall()] },
  { id: "scan-apply", sg: "scan-apply", expect: 1, requests: [scanCall({ apply: true })] },
  { id: "scan-metadata-and-flags", sg: "scan-dry", expect: 1, requests: [scanCall({ includeMetadata: true, includeHidden: true, followSymlinks: true, globs: ["*.ts"], maxMatches: 3, timeoutMs: 4000 })] },
  { id: "scan-rule-file", sg: "scan-dry", expect: 1, requests: [scanCall({ inlineRules: undefined, ruleFile: "rules/no-foo.yml" })] },
  { id: "scan-both-sources", sg: "scan-dry", expect: 1, requests: [scanCall({ ruleFile: "rules/no-foo.yml" })] },
  { id: "scan-no-source", sg: "scan-dry", expect: 1, requests: [scanCall({ inlineRules: undefined })] },
  { id: "scan-rule-parse-failed", sg: "scan-ruleparse", expect: 1, requests: [scanCall()] },
  { id: "scan-deprecation-warning", sg: "scan-deprecated", expect: 1, requests: [scanCall()] },
  { id: "scan-unknown-prop", sg: "scan-dry", expect: 1, requests: [scanCall({ nope: 1 })] },
  { id: "no-binary-found", sg: "search-match", expect: 1, requests: [searchCall()], noBinary: true },
]

/** Replace every wall-clock duration with a fixed marker. */
function maskDurations(value) {
  if (Array.isArray(value)) return value.map(maskDurations)
  if (value !== null && typeof value === "object") {
    const out = {}
    for (const [key, inner] of Object.entries(value)) out[key] = key === "durationMs" ? "<ms>" : maskDurations(inner)
    return out
  }
  return value
}

/** Mask the tool descriptions of a `tools/list` result, and report which tools were masked. */
function maskDescriptions(parsed) {
  const masked = []
  if (parsed?.result && Array.isArray(parsed.result.tools)) {
    parsed.result.tools = parsed.result.tools.map((tool) => {
      masked.push(`${tool.name}:${typeof tool.description === "string" ? tool.description.length : 0}`)
      return { ...tool, description: "<description>" }
    })
  }
  return masked
}

/** Mask the resolver's own text on a BINARY_NOT_FOUND payload, keeping its shape. */
function maskResolverText(parsed) {
  if (!Array.isArray(parsed?.result?.content)) return
  parsed.result.content = parsed.result.content.map((block) => {
    if (block?.type !== "text" || typeof block.text !== "string") return block
    let payload
    try {
      payload = JSON.parse(block.text)
    } catch {
      return block
    }
    if (payload?.error?.code !== "BINARY_NOT_FOUND") return block
    payload.error.message = "<resolver message>"
    if (payload.error.details) payload.error.details = { hints: ["<hints>"] }
    return { ...block, text: JSON.stringify(payload) }
  })
}

/**
 * Normalize one response line: mask the two fields that cannot be equal by construction, in the
 * envelope AND inside the serialized text payload a `tools/call` result carries.
 */
function normalizeLine(line, noBinary) {
  const parsed = JSON.parse(line)
  if (noBinary) maskResolverText(parsed)
  const masked = maskDescriptions(parsed)
  if (Array.isArray(parsed?.result?.content)) {
    parsed.result.content = parsed.result.content.map((block) => {
      if (block?.type !== "text" || typeof block.text !== "string") return block
      let payload
      try {
        payload = JSON.parse(block.text)
      } catch {
        return block
      }
      return { ...block, text: JSON.stringify(maskDurations(payload)) }
    })
  }
  return { line: JSON.stringify(maskDurations(parsed)), masked }
}

/**
 * Run one server over one case.
 * @returns {Promise<{lines: string[], stderr: string, argv: unknown[]}>} the masked responses, stderr, argv log
 */
async function runServer(serverPath, testCase, label) {
  const argvLog = join(tmpDir, `${label}-${testCase.id}-argv.jsonl`)
  writeFileSync(argvLog, "")
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: process.env.HOME ?? "/tmp",
    MPD_MCP_LOG_DIR: tmpDir,
    MPD_AST_GREP_PROJECT_CWD: PROJECT_CWD,
    FAKE_SG_SCENARIO: testCase.sg,
    FAKE_SG_ARGV_LOG: argvLog,
  }
  if (!testCase.noBinary) env.MPD_AST_GREP_SG_PATH = FAKE_SG

  const child = spawn(process.execPath, [serverPath], { env, stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_CWD })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8") })
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  for (const request of testCase.requests) {
    child.stdin.write((typeof request === "string" ? request : JSON.stringify(request)) + "\n")
  }

  const deadline = Date.now() + 20000
  const count = () => stdout.split("\n").filter((line) => line.trim() !== "").length
  while (count() < testCase.expect && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill("SIGKILL")
  await new Promise((resolve) => child.once("exit", resolve))

  const masked = []
  const lines = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const normalized = normalizeLine(line, testCase.noBinary === true)
      if (normalized.masked.length > 0) masked.push(...normalized.masked)
      return normalized.line
    })
  const argv = readFileSync(argvLog, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
  return { lines, stderr, argv, masked, expected: testCase.expect, got: lines.length }
}

mkdirSync(tmpDir, { recursive: true })
const report = { oracle: oraclePath, replacement: newPath, cases: [], equal: 0, different: 0 }
for (const testCase of CASES) {
  const oracle = await runServer(oraclePath, testCase, "oracle")
  const replacement = await runServer(newPath, testCase, "new")
  const sameResponses = JSON.stringify(oracle.lines) === JSON.stringify(replacement.lines)
  const sameArgv = JSON.stringify(oracle.argv) === JSON.stringify(replacement.argv)
  const sameStderr = oracle.stderr === replacement.stderr
  const same = sameResponses && sameArgv && sameStderr && oracle.got === testCase.expect && replacement.got === testCase.expect
  if (same) report.equal += 1
  else report.different += 1
  report.cases.push({
    id: testCase.id,
    same,
    sameResponses,
    sameArgv,
    sameStderr,
    expectedResponses: testCase.expect,
    oracleResponses: oracle.got,
    replacementResponses: replacement.got,
    maskedDescriptions: replacement.masked,
    oracleArgv: oracle.argv.map((entry) => entry.argv),
    replacementArgv: replacement.argv.map((entry) => entry.argv),
    oracleResponsesText: oracle.lines,
    replacementResponsesText: replacement.lines,
  })
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
appendFileSync(outPath, "")
console.log(`cases=${report.cases.length} equal=${report.equal} different=${report.different}`)
for (const testCase of report.cases.filter((c) => !c.same)) {
  console.log(`DIFF ${testCase.id} responses=${testCase.sameResponses} argv=${testCase.sameArgv} stderr=${testCase.sameStderr} counts=${testCase.oracleResponses}/${testCase.replacementResponses} (expected ${testCase.expectedResponses})`)
}
