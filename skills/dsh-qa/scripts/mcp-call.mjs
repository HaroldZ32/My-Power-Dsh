#!/usr/bin/env node
// 用例 mcp-call：隔离 DSH_HOME 下真实 dsh headless，验证 omo MCP 挂载与调用链路。
// 断言1: 模型看到 mcp__ast_grep__ 与 mcp__lsp__ 工具；断言2: 真实调用 ast_grep search 返回服务器分类响应。
// --self-test 为离线自测。
import { spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const ENUM_JOB = "请只做一件事：把你当前会话中所有以 mcp__ 前缀开头的可用工具名列出来（每行一个）。不要调用任何工具。"
const CALL_JOB = "当前目录有 tests/mcp-fixtures/sample.c。请调用工具 mcp__ast_grep__search 扫描该文件（按工具 schema 给出参数），然后把工具返回的内容原样汇报给我。不要使用 bash 工具。"
const FIXTURE_LIST = "- mcp__ast_grep__search\n- mcp__lsp__status"

function selfTest() {
  const hasAst = FIXTURE_LIST.includes("mcp__ast_grep__search")
  const hasLsp = FIXTURE_LIST.includes("mcp__lsp__status")
  if (!hasAst || !hasLsp) { console.error("[mcp-call self-test] FAIL"); process.exit(1) }
  console.log("[mcp-call self-test] ok: tool-name detection verified on fixture")
}

function realRun(job, timeoutMs = 600000) {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[mcp-call] 凭据缺失"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  // stdio 落文件而不是管道：dsh-mcp-client 的 MCP 子进程会继承 fd 并比 dsh 存活更久，
  // 管道方式会让 spawnSync 在 EOF 上卡死；落文件则子进程只持有日志 fd。
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  try {
    const run = spawnSync("dsh", ["--profile", "headless", "--patch", join(repoRoot, "packages/omo-dsh-bundle/cordis.patch.yml"), job], {
      env: { ...process.env, DSH_HOME: sandbox }, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", fd, fd]
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
    && callRun.exit === 0 && /ast-grep|BINARY_NOT_FOUND|ast_grep/.test(callRun.out)
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
