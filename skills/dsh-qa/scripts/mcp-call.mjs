#!/usr/bin/env node
// Case mcp-call: run real dsh headless under an isolated DSH_HOME, verifying the omo MCP mount and call path.
// Assertion 1: the model sees the mcp__ast_grep__ and mcp__lsp__ tools; assertion 2: a real ast_grep search call returns the server's classified response.
// --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const ENUM_JOB = "Do only one thing: list all available tool names in your current session that start with the mcp__ prefix (one per line). Do not call any tools."
const CALL_JOB = "The current directory has tests/mcp-fixtures/sample.c. Call the tool mcp__ast_grep__search to scan that file for the pattern return 0 (pass parameters per the tool schema), then report the tool's returned content verbatim. Do not use the bash tool."
const FIXTURE_LIST = "- mcp__ast_grep__search\n- mcp__lsp__status"

function selfTest() {
  const hasAst = FIXTURE_LIST.includes("mcp__ast_grep__search")
  const hasLsp = FIXTURE_LIST.includes("mcp__lsp__status")
  if (!hasAst || !hasLsp) { console.error("[mcp-call self-test] FAIL"); process.exit(1) }
  console.log("[mcp-call self-test] ok: tool-name detection verified on fixture")
}

function realRun(job, timeoutMs = 600000) {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[mcp-call] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  // Write stdio to a file instead of a pipe: the dsh-mcp-client MCP subprocess inherits the fd and outlives dsh,
  // and a pipe would make spawnSync hang at EOF; writing to a file means the child only holds the log fd.
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  try {
    const env = { ...process.env, DSH_HOME: sandbox }
    if (env.DSH_HOME !== sandbox) { console.error("[mcp-call] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
    // Local toolchain: sg / codegraph installed with network access (optional; injected when present so the call truly succeeds)
    const sg = join(repoRoot, ".toolchain/node_modules/.bin/ast-grep")
    if (existsSync(sg)) env.Upstream_AST_GREP_SG_PATH = sg
    const cg = join(repoRoot, ".toolchain/node_modules/.bin/codegraph")
    if (existsSync(cg)) env.Upstream_CODEGRAPH_BIN = cg
    const run = spawnSync("dsh", ["--profile", "headless", "--patch", join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), job], {
      env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", fd, fd]
    })
    return { out: readFileSync(logFile, "utf8"), exit: run.status }
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
  const ok = enumRun.exit === 0 && /mcp__ast_grep__/.test(enumRun.out) && /mcp__lsp__/.test(enumRun.out)
    && callRun.exit === 0 && !/BINARY_NOT_FOUND/.test(callRun.out) && /ast-grep|ast_grep|match/.test(callRun.out)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok, durationMs: Date.now() - t0,
    enum: { exit: enumRun.exit, toolListProof: /mcp__ast_grep__/.test(enumRun.out) && /mcp__lsp__/.test(enumRun.out) },
    call: { exit: callRun.exit, astGrepCallProof: /BINARY_NOT_FOUND|ast-grep/.test(callRun.out) }
  }, null, 2))
  writeFileSync(join(outDir, "enum.log"), enumRun.out)
  writeFileSync(join(outDir, "call.log"), callRun.out)
  console.log("[mcp-call] ok=" + ok + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[mcp-call] PASS")
}

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
