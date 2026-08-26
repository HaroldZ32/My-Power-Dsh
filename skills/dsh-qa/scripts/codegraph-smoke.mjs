#!/usr/bin/env node
// Case codegraph-smoke: verify the full path in a temp project at the workspace root (avoiding the OMO exclusion for the .omo segment and /tmp):
// binary parse -> project init -> MCP serve -> a real call to mcp__codegraph__codegraph_explore.
// Delete the temp project afterwards. --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const workspaceRoot = join(repoRoot, "..", "..", "..")
const PROJ = join(workspaceRoot, ".cg-qa")
const TOOLCHAIN_BIN = join(repoRoot, ".toolchain/node_modules/.bin/codegraph")

function selfTest() {
  if (!workspaceRoot) { console.error("[codegraph-smoke self-test] FAIL"); process.exit(1) }
  if (PROJ.includes(".omo") || PROJ.startsWith("/tmp")) { console.error("[codegraph-smoke self-test] FAIL: temp project path violates the exclusion precondition"); process.exit(1) }
  console.log("[codegraph-smoke self-test] ok: project-path precondition verified on fixture")
}

function runReal() {
  if (!existsSync(TOOLCHAIN_BIN)) { console.error("[codegraph-smoke] missing toolchain codegraph; run npm install --prefix .toolchain first"); process.exit(1) }
  mkdirSync(join(PROJ, "src"), { recursive: true })
  writeFileSync(join(PROJ, "src/util.ts"), "export function norm(x:number){return x<0?0:x}\n")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const env = { ...process.env, DSH_HOME: sandbox, OMO_CODEGRAPH_PROJECT_CWD: PROJ }
  const fd = openSync(join(sandbox, "run.log"), "w")
  const args = ["--profile", "headless",
    "--patch", join(repoRoot, "packages/omo-dsh-bundle/cordis.patch.yml"),
    "--patch", join(repoRoot, "tests/overlays/codegraph-plugin.yml"),
    "Call the tool mcp__codegraph__codegraph_explore (pass parameters per the tool schema, targeting the norm function in src/util.ts), and report the returned content verbatim. Do not use bash."]
  const run = spawnSync("dsh", args, { env, encoding: "utf8", timeout: 360000, stdio: ["ignore", fd, fd] })
  closeSync(fd)
  const out = readFileSync(join(sandbox, "run.log"), "utf8")
  const ok = run.status === 0 && /init status=(ok|marker)/.test(out) && /mcp__codegraph__codegraph_explore/.test(out) && /norm|x<0/.test(out)
  const outDir = join(repoRoot, "evidence/dsh-qa/codegraph", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, exit: run.status }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  rmSync(PROJ, { recursive: true, force: true })
  console.log("[codegraph-smoke] ok=" + ok + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[codegraph-smoke] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
