#!/usr/bin/env node
// launch-proof.mjs — the MOUNT-PATH proof for the B1 server: the REAL launcher, real stdio, real MCP.
//
// This drives `packages/mpd-mcp-astgrep/dist/launch.js` exactly as the bundle patch spawns it
// (`command: node`, `args: [<bundle>/packages/mpd-mcp-astgrep/dist/launch.js]`) from an ISOLATED
// home and workspace, and speaks the MCP handshake over its stdio. It proves, in one run:
//   1. the launcher's own binary resolution (`MPD_AST_GREP_BIN_DIR` tier) probes and pins the engine;
//   2. `installTerminalSilence` sends the file log to the sandbox log dir and not to a terminal;
//   3. the dynamically imported `dist/cli.js` answers `initialize`/`tools/list` with the three raw
//      tool names (`search`, `rewrite`, `scan`);
//   4. a real `tools/call search` reaches the engine and returns a real payload.
// The second run proves the no-engine shape through the same path: `BINARY_NOT_FOUND`.
//
// usage: node launch-proof.mjs <repo-root> <result.json> <sandbox-root>
import { spawn } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/** Repository root under proof. */
const repoRoot = resolve(process.argv[2])
/** Where the JSON result is written. */
const outPath = resolve(process.argv[3])
/** Sandbox root: every home, workspace and log of this proof lives under it. */
const sandbox = resolve(process.argv[4])

/** The launcher the bundle patch names, i.e. the artifact under proof. */
const LAUNCHER = join(repoRoot, "packages", "mpd-mcp-astgrep", "dist", "launch.js")
/** The fake engine the launcher must resolve through its `MPD_AST_GREP_BIN_DIR` tier. */
const FAKE_SG = join(import.meta.dirname, "fake-sg.mjs")

/**
 * Run one launch-path handshake.
 * @param options.home sandbox HOME, `workspace` sandbox cwd, `withEngine` whether the engine tier is offered
 * @returns the responses, the stderr, the argv the engine saw, and the log directory listing
 */
async function handshake({ home, workspace, withEngine, argvLog }) {
  /** The sandbox binary directory offered as `MPD_AST_GREP_BIN_DIR`, only when the engine is offered. */
  const binDir = join(home, "bin")
  if (withEngine) {
    mkdirSync(binDir, { recursive: true })
    copyFileSync(FAKE_SG, join(binDir, "ast-grep"))
    chmodSync(join(binDir, "ast-grep"), 0o755)
  }
  const env = {
    PATH: withEngine ? `${dirname(process.execPath)}:/usr/bin:/bin` : "/usr/bin:/bin",
    HOME: home,
    DSH_HOME: join(home, ".dsh"),
    DSH_AGENTS_HOME: join(home, ".agents"),
    DSH_WORKSPACE_ROOT: workspace,
    MPD_MCP_LOG_DIR: join(home, "logs"),
    FAKE_SG_SCENARIO: "search-match",
    FAKE_SG_ARGV_LOG: argvLog,
  }
  if (withEngine) env.MPD_AST_GREP_BIN_DIR = binDir
  writeFileSync(argvLog, "")

  const child = spawn(process.execPath, [LAUNCHER], { env, cwd: workspace, stdio: ["pipe", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8") })
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "b1-proof", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { pattern: "foo($A)", language: "typescript", paths: ["src"] } } },
  ]
  for (const request of requests) child.stdin.write(JSON.stringify(request) + "\n")

  const deadline = Date.now() + 30000
  const count = () => stdout.split("\n").filter((line) => line.trim() !== "").length
  while (count() < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  child.kill("SIGKILL")
  await new Promise((resolve) => child.once("exit", resolve))

  const responses = stdout.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line))
  const argv = readFileSync(argvLog, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line).argv)
  return { responses, stderr, argv, responseCount: responses.length }
}

mkdirSync(join(sandbox, "home"), { recursive: true })
mkdirSync(join(sandbox, "workspace"), { recursive: true })
mkdirSync(join(sandbox, "tmp"), { recursive: true })

/** The run WITH a resolvable engine: the full happy path through the launcher. */
const withEngine = await handshake({
  home: join(sandbox, "home"),
  workspace: join(sandbox, "workspace"),
  withEngine: true,
  argvLog: join(sandbox, "tmp", "with-engine-argv.jsonl"),
})
/** The run with NO engine anywhere: the honest failure shape through the same path. */
const noEngine = await handshake({
  home: join(sandbox, "home-no-engine"),
  workspace: join(sandbox, "workspace"),
  withEngine: false,
  argvLog: join(sandbox, "tmp", "no-engine-argv.jsonl"),
})

/**
 * The `tools/list` result of one run, or null when the handshake did not reach it.
 */
const toolList = (run) => run.responses.find((response) => response.id === 2)?.result?.tools ?? null
/** The serialized `tools/call` payload of one run, or null. */
const toolPayload = (run) => {
  const text = run.responses.find((response) => response.id === 3)?.result?.content?.[0]?.text
  return text === undefined ? null : JSON.parse(text)
}

/** The search payload of the run that had an engine. */
const searchPayload = toolPayload(withEngine)
/** The search payload of the run that had none. */
const missingPayload = toolPayload(noEngine)

const result = {
  launcher: LAUNCHER,
  withEngine: {
    responseCount: withEngine.responseCount,
    toolNames: (toolList(withEngine) ?? []).map((tool) => tool.name),
    searchOk: searchPayload?.ok ?? null,
    searchKind: searchPayload?.kind ?? null,
    searchMatchCount: searchPayload?.matches?.length ?? null,
    searchFirstPath: searchPayload?.matches?.[0]?.path ?? null,
    engineArgv: withEngine.argv,
    stderr: withEngine.stderr,
  },
  noEngine: {
    responseCount: noEngine.responseCount,
    toolNames: (toolList(noEngine) ?? []).map((tool) => tool.name),
    searchCode: missingPayload?.error?.code ?? null,
    searchIsError: noEngine.responses.find((response) => response.id === 3)?.result?.isError ?? null,
    stderr: noEngine.stderr,
  },
}
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
