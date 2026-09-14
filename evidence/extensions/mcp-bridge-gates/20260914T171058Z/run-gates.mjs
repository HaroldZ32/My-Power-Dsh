// The t3 gate run: every `verify` command of the task contract, executed here and
// recorded with its real exit code and output. Nothing in this file re-implements
// a check — it runs the commands and files what they printed.
//
// Run: bun evidence/extensions/mcp-bridge-gates/20260914T171058Z/run-gates.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = fileURLToPath(new URL("../../../../", import.meta.url))
mkdirSync(join(HERE, "raw"), { recursive: true })

// A deliberately broken extension for the negative control of `validate`.
const brokenRoot = mkdtempSync(join(tmpdir(), "mpd-ext-broken-"))
writeFileSync(join(brokenRoot, "mpd-ext.json"), JSON.stringify({
  apiVersion: 1,
  id: "broken-ext",
  typoKey: true,
  contributes: {
    skills: [{ root: "../outside" }],
    flows: [{ dir: "flows", rank: "high" }],
    mcp: [{ serverName: "not a name!", transport: "stdio", command: "node", surprise: 1 }],
    roles: [{ name: "Missing persona", persona: "personas/absent.md" }],
  },
}, null, 2))

const commands = [
  { label: "bun test packages/mpd-ext-plugin", argv: ["test", "packages/mpd-ext-plugin"], expect: 0 },
  { label: "bun scripts/mpd-ext.mjs --self-test", argv: ["scripts/mpd-ext.mjs", "--self-test"], expect: 0 },
  { label: "bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example", argv: ["scripts/mpd-ext.mjs", "validate", "extensions/mpd-ext-example"], expect: 0 },
  { label: "bun run typecheck", argv: ["run", "typecheck"], expect: 0, viaScript: true },
  { label: `bun scripts/mpd-ext.mjs validate ${brokenRoot} (negative control)`, argv: ["scripts/mpd-ext.mjs", "validate", brokenRoot], expect: 1 },
  // Not a mounted boot (that is the QA task t5's lane) — but the artifact a real
  // boot loads must at least import under NODE and its async apply must resolve.
  { label: "node evidence/extensions/mcp-bridge-gates/20260914T171058Z/dist-load.mjs", argv: ["evidence/extensions/mcp-bridge-gates/20260914T171058Z/dist-load.mjs"], expect: 0, viaNode: true },
]

const results = []
const log = []
for (const command of commands) {
  const argv = command.viaNode === true
    ? ["node", ...command.argv]
    : command.viaScript === true
      ? [process.execPath, command.argv[0], command.argv[1]]
      : [process.execPath, ...command.argv]
  const started = Date.now()
  const run = spawnSync(argv[0], argv.slice(1), { cwd: REPO, encoding: "utf8", timeout: 600000 })
  const elapsedMs = Date.now() - started
  const stdout = run.stdout ?? ""
  const stderr = run.stderr ?? ""
  results.push({
    command: command.label,
    argv: argv.join(" "),
    exitCode: run.status,
    expectedExitCode: command.expect,
    status: run.status === command.expect ? "passed" : "failed",
    elapsedMs,
    lastLines: stdout.trim().split("\n").slice(-8),
    stderrTail: stderr.trim().split("\n").slice(-6),
  })
  log.push(`$ ${command.label}`)
  log.push(`exit=${String(run.status)} expected=${command.expect} elapsed=${elapsedMs}ms`)
  log.push(stdout.trim())
  if (stderr.trim() !== "") log.push(`[stderr]\n${stderr.trim()}`)
  log.push("")
}
rmSync(brokenRoot, { recursive: true, force: true })

const failed = results.filter((result) => result.status === "failed")
const result = {
  task: "t3 — runtime stdio MCP bridge, dev CLI and the shipped reference extension",
  recordedAt: new Date().toISOString(),
  repo: REPO,
  verdict: failed.length === 0 ? "pass" : "fail",
  commands: results,
  negativeControl: "a deliberately broken extension makes `validate` exit 1 with per-item errors, so the exit-0 case is falsifiable",
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n")
writeFileSync(join(HERE, "raw", "output.log"), log.join("\n"))
console.log(JSON.stringify({ verdict: result.verdict, commands: results.map((r) => `${r.status} (exit ${String(r.exitCode)}) ${r.command}`) }, null, 2))
