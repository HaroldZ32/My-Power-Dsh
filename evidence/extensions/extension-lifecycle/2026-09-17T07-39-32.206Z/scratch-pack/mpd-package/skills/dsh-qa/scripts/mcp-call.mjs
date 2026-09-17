#!/usr/bin/env node
// Case mcp-call: run real dsh headless under an isolated DSH_HOME, verifying the MCP mount and call path.
// Assertion 1: the model sees the mcp__ast_grep__ and mcp__lsp__ tools; assertion 2: a real ast_grep search call returns the server's classified response.
// --self-test is the offline self-test.
//
// DEFECT (fixed 2026-09-14, same class as codegraph-smoke): both assertions used to
// read the model's FINAL ANSWER — a prose list of tool names, and prose that merely
// had to contain "ast-grep|ast_grep|match" while NOT containing BINARY_NOT_FOUND. A
// model that never made a call, or that narrated a tool it never reached, could pass;
// a model that made a perfect call but summarised it differently could fail. The
// evidence now comes from the harness's own session log (lib/session-evidence.mjs):
//   * enum arm  -> `request/header.data.header.tools[]` — the tool list the harness
//                  actually showed the model;
//   * call arm  -> a recorded `tool/call` to mcp__ast_grep__search plus a non-error
//                  `tool/result` carrying the fixture's matched source line.
// The prose checks remain in result.json as informational fields only.
import { spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { readSessionEvents, findToolCall, recordedToolNames } from "./lib/session-evidence.mjs"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const ENUM_JOB = "Do only one thing: list all available tool names in your current session that start with the mcp__ prefix (one per line). Do not call any tools."
const CALL_JOB = "The current directory has tests/mcp-fixtures/sample.c. Call the tool mcp__ast_grep__search to scan that file for the pattern return 0 (pass parameters per the tool schema), then report the tool's returned content verbatim. Do not use the bash tool."
const FIXTURE_LIST = "- mcp__ast_grep__search\n- mcp__lsp__status"
const AST_TOOL = "mcp__ast_grep__search"
const FIXTURE_LINE = "return 0"

function selfTest() {
  const hasAst = FIXTURE_LIST.includes("mcp__ast_grep__search")
  const hasLsp = FIXTURE_LIST.includes("mcp__lsp__status")
  if (!hasAst || !hasLsp) { console.error("[mcp-call self-test] FAIL"); process.exit(1) }
  // The asserted tool name must be COMPOSED by the profile this case boots (bundle
  // patch rows declare serverName astgrep -> mcp__ast_grep__…), otherwise the case
  // asserts a tool that can never be recorded.
  const patch = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  const row = patch.split(/\n\s*- id: /).find((chunk) => chunk.startsWith("mcp-astgrep"))
  if (row === undefined || !row.includes("serverName: ast_grep")) { console.error("[mcp-call self-test] FAIL: the mcp-astgrep row does not declare serverName: ast_grep"); process.exit(1) }
  if (AST_TOOL !== "mcp__ast_grep__search") { console.error("[mcp-call self-test] FAIL: the asserted tool name does not match the composed server name"); process.exit(1) }
  // The fixture content the call arm asserts on must exist, or the assertion is vacuous.
  const fixture = readFileSync(join(repoRoot, "tests", "mcp-fixtures", "sample.c"), "utf8")
  if (!fixture.includes(FIXTURE_LINE)) { console.error("[mcp-call self-test] FAIL: the fixture no longer contains " + JSON.stringify(FIXTURE_LINE)); process.exit(1) }
  console.log("[mcp-call self-test] ok: tool-name detection + composed ast_grep server name + fixture content verified on fixtures")
}

/** Read the harness-recorded tool list / tool call of one arm (never the model's prose). */
function sessionEvidence(sandbox, ws, toolName) {
  const store = readSessionEvents(sandbox, { workspace: ws })
  const names = recordedToolNames(store.records)
  const call = toolName === null ? null : findToolCall(store.records, toolName)
  return { store, names, call }
}

function realRun(job, timeoutMs = 600000) {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[mcp-call] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // Live-LLM cases must ALSO copy settings.yaml when present (AGENTS.md §7): homes whose
  // keys come from gateway providers (llm-pi-ai — opencode-go/scnet) configure the chain
  // there, and without it headless falls back to the base `deepseek-official` route and
  // dies with MISSING_CREDENTIAL — which masks the real result of the call this case
  // exists to make. (Copied, never moved; the sandbox is ephemeral either way.)
  const settings = join(homedir(), ".dsh", "settings.yaml")
  const hasSettings = existsSync(settings)
  if (hasSettings) cpSync(settings, join(sandbox, "settings.yaml"))
  // HOME is sandboxed too (wave-3, F-ENV-1): the MCP chain this case asserts is
  // resolved bundle-relatively by the B8 launcher (require chain -> <bundle>/
  // .toolchain) and the credentials come from DSH_HOME, so nothing under test
  // lives in the real HOME — but plugin state does (`~/.mpd`: codegraph's lock,
  // LSP daemon). With the real HOME the case could read/write real state (and on
  // a read-only `$HOME/.mpd` the codegraph child died before the assertion, see
  // F-B8-1); with it sandboxed the case is hermetic. Mirror credentials/settings
  // at the HOME-shaped location too (codegraph-smoke pattern) so either lookup
  // path finds them.
  mkdirSync(join(sandbox, ".dsh"), { recursive: true })
  cpSync(creds, join(sandbox, ".dsh", ".credentials.yaml"))
  if (hasSettings) cpSync(settings, join(sandbox, ".dsh", "settings.yaml"))
  // Write stdio to a file instead of a pipe: the dsh-mcp-client MCP subprocess inherits the fd and outlives dsh,
  // and a pipe would make spawnSync hang at EOF; writing to a file means the child only holds the log fd.
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  try {
    const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox  })
    if (env.DSH_HOME !== sandbox) { console.error("[mcp-call] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
    // NO MPD_AST_GREP_SG_PATH / MPD_CODEGRAPH_BIN pre-setting here (B8): this case
    // used to pin both to the checkout toolchain, which is exactly why it stayed
    // green while the deployed MCP tools were dead — the case manufactured its own
    // pass. It must exercise the real resolution chain instead.
    // Workspace isolation: the session workspace is the spawn cwd, so boot inside a
    // sandbox workspace (DSH_HOME alone does not isolate workspace-scoped state).
    const ws = sandboxWorkspace(sandbox)
    cpSync(join(repoRoot, "tests", "mcp-fixtures"), join(ws, "tests", "mcp-fixtures"), { recursive: true })
    // The bundle patch references rows as @mpd-dsh/mpd/... (Plan D staged layout):
    // stage the package into the sandbox profile with npm (relocate-smoke pattern;
    // `dsh plugin add` uses pnpm whose store is not writable in this sandbox).
    const staged = join(repoRoot, "dist", "mpd-package")
    if (!existsSync(staged)) { console.error("[mcp-call] missing staged bundle; run node scripts/pack-mpd.mjs first"); process.exit(1) }
    const profileDir = join(sandbox, "profiles", "headless")
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-headless", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
    const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund", "--cache", join(sandbox, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
    if (inst.status !== 0) { console.error("[mcp-call] FAIL: staged install\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
    const run = spawnSync("dsh", ["--profile", "headless", "--patch", join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), job], {
      env, cwd: ws, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", fd, fd]
    })
    assertSessionsSandboxed(sandbox, sandbox, { label: "mcp-call" })
    return { out: readFileSync(logFile, "utf8"), exit: run.status, sandbox, ws }
  } finally {
    closeSync(fd)
  }
}

function runReal() {
  const t0 = Date.now()
  const enumRun = realRun(ENUM_JOB)
  const callRun = realRun(CALL_JOB)
  const outDir = join(repoRoot, "evidence", "dsh-qa", "mcp-call", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  // Harness-side evidence decides both arms (see the header note).
  let enumEv = { names: [], error: "" }
  let callEv = { call: { called: false, succeeded: false, resultText: "", reason: "not read" }, error: "" }
  try { enumEv = { names: sessionEvidence(enumRun.sandbox, enumRun.ws, null).names, error: "" } } catch (error) { enumEv.error = String(error) }
  try { callEv = { call: sessionEvidence(callRun.sandbox, callRun.ws, AST_TOOL).call, error: "" } } catch (error) { callEv.error = String(error) }
  const enumOk = enumEv.names.some((n) => n.startsWith("mcp__ast_grep__")) && enumEv.names.some((n) => n.startsWith("mcp__lsp__"))
  const callResult = callEv.call?.resultText ?? ""
  const callOk = Boolean(callEv.call?.succeeded) && callResult.includes(FIXTURE_LINE) && !callResult.includes("BINARY_NOT_FOUND")
  const ok = enumRun.exit === 0 && enumOk && callRun.exit === 0 && callOk
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok, durationMs: Date.now() - t0,
    assertion: "harness-recorded tool list (request/header.header.tools) + harness-recorded tool/call with a non-error result carrying the fixture line",
    enum: {
      exit: enumRun.exit,
      recordedToolCount: enumEv.names.length,
      recordedMcpTools: enumEv.names.filter((n) => n.startsWith("mcp__")),
      hasAstGrep: enumEv.names.some((n) => n.startsWith("mcp__ast_grep__")),
      hasLsp: enumEv.names.some((n) => n.startsWith("mcp__lsp__")),
      sessionError: enumEv.error || null,
      // Informational ONLY: the prose list the model produced (the OLD assertion).
      proseListedBoth: /mcp__ast_grep__/.test(enumRun.out) && /mcp__lsp__/.test(enumRun.out),
    },
    call: {
      exit: callRun.exit,
      tool: AST_TOOL,
      called: Boolean(callEv.call?.called),
      succeeded: Boolean(callEv.call?.succeeded),
      resultChars: callResult.length,
      resultHasFixtureLine: callResult.includes(FIXTURE_LINE),
      resultHasBinaryNotFound: callResult.includes("BINARY_NOT_FOUND"),
      reason: callEv.call?.reason || null,
      sessionError: callEv.error || null,
      // Informational ONLY: the OLD prose assertions.
      proseHasAstGrepWord: /ast-grep|ast_grep|match/.test(callRun.out),
      proseHasBinaryNotFound: /BINARY_NOT_FOUND/.test(callRun.out),
    },
  }, null, 2))
  writeFileSync(join(outDir, "enum.log"), enumRun.out)
  writeFileSync(join(outDir, "call.log"), callRun.out)
  writeFileSync(join(outDir, "call.tool-result.txt"), callResult + "\n")
  for (const [name, run] of [["enum", enumRun], ["call", callRun]]) {
    try {
      const store = readSessionEvents(run.sandbox, { workspace: run.ws })
      if (store.file !== null) cpSync(store.file, join(outDir, name + ".session.jsonl.zstd"))
      if (store.records.length > 0) writeFileSync(join(outDir, name + ".session.decoded.jsonl"), store.records.map((r) => JSON.stringify(r)).join("\n") + "\n")
    } catch { /* the arms already recorded the read error in result.json */ }
  }
  console.log("[mcp-call] ok=" + ok + " (enum recorded tools=" + enumEv.names.length + ", ast_grep call " + (callEv.call?.succeeded ? "recorded" : "MISSING: " + callEv.call?.reason) + ") -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[mcp-call] PASS")
}

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
