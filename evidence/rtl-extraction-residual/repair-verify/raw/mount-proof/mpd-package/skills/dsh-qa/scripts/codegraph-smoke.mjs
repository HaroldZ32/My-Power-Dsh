#!/usr/bin/env node
// Case codegraph-smoke: verify the full path in a temp project at the workspace root (avoiding the upstream exclusion for the .mpd segment and /tmp):
// binary parse -> project init -> MCP serve -> a real call to mcp__codegraph__codegraph_explore.
// Delete the temp project afterwards. --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
// The temp project lives inside this checkout (sandbox-writable, and its path
// has no .mpd segment and is not under /tmp — the codegraph exclusion test).
const workspaceRoot = repoRoot
const PROJ = join(workspaceRoot, ".cg-qa")
const TOOLCHAIN_BIN = join(repoRoot, ".toolchain/node_modules/.bin/codegraph")

function selfTest() {
  if (!workspaceRoot) { console.error("[codegraph-smoke self-test] FAIL"); process.exit(1) }
  if (PROJ.includes(".mpd") || PROJ.startsWith("/tmp")) { console.error("[codegraph-smoke self-test] FAIL: temp project path violates the exclusion precondition"); process.exit(1) }
  console.log("[codegraph-smoke self-test] ok: project-path precondition verified on fixture")
}

function runReal() {
  if (!existsSync(TOOLCHAIN_BIN)) { console.error("[codegraph-smoke] missing toolchain codegraph; run npm install --prefix .toolchain first"); process.exit(1) }
  mkdirSync(join(PROJ, "src"), { recursive: true })
  writeFileSync(join(PROJ, "src/util.ts"), "export function norm(x:number){return x<0?0:x}\n")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  // The vendored serve.js builds its state dir under homedir() (~/.mpd since the
  // rename): isolate HOME too, and mirror the creds at the DSH home location.
  mkdirSync(join(sandbox, ".dsh"), { recursive: true })
  cpSync(creds, join(sandbox, ".dsh", ".credentials.yaml"))
  // MPD_CODEGRAPH_BIN is pinned here BY DESIGN, not as a masked defect: this case
  // exists to exercise the codegraph binary + MCP server + a real tool call, so it
  // deliberately points the adopted code at the known-good toolchain binary. Its
  // green therefore says NOTHING about the bundle's own B8 resolution chain — a
  // case that must prove THAT is mcp-call (no binary/CLI pin) and the launcher
  // resolver's own tests. Do not "clean this pin up": it is the documented intent.
  const env = { ...process.env, DSH_HOME: sandbox, HOME: sandbox, MPD_CODEGRAPH_PROJECT_CWD: PROJ, MPD_CODEGRAPH_BIN: TOOLCHAIN_BIN }
  // The bundle patch references rows as @mpd-dsh/mpd/... (Plan D staged layout):
  // stage the package into the sandbox profile with npm before booting.
  const staged = join(repoRoot, "dist", "mpd-package")
  if (!existsSync(staged)) { console.error("[codegraph-smoke] missing staged bundle; run node scripts/pack-mpd.mjs first"); process.exit(1) }
  const profileDir = join(sandbox, "profiles", "headless")
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-headless", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund", "--cache", join(sandbox, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  if (inst.status !== 0) { console.error("[codegraph-smoke] FAIL: staged install\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
  const fd = openSync(join(sandbox, "run.log"), "w")
  const args = ["--profile", "headless",
    "--patch", join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"),
    "--patch", join(repoRoot, "tests/overlays/codegraph-plugin.yml"),
    "Call the tool mcp__codegraph__codegraph_explore (pass parameters per the tool schema, targeting the norm function in src/util.ts), and report the returned content verbatim. Do not use bash."]
  const run = spawnSync("dsh", args, { env, cwd: sandboxWorkspace(sandbox), encoding: "utf8", timeout: 360000, stdio: ["ignore", fd, fd] })
  closeSync(fd)
  // Workspace isolation: the session workspace is the spawn cwd, so the boot must not
  // leave a session-store key for the real repo (DSH_HOME/HOME do not cover it).
  assertSessionsSandboxed(sandbox, sandbox, { label: "codegraph-smoke" })
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
