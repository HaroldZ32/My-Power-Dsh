#!/usr/bin/env node
// Case codegraph-smoke: verify the full path in a temp project at the workspace root (avoiding the upstream exclusion for the .mpd segment and /tmp):
// binary parse -> project init -> MCP serve -> a real call to mcp__codegraph__codegraph_explore.
// Delete the temp project afterwards. --self-test is the offline self-test.
//
// DEFECT (measured 2026-09-14): this case asserted the tool-name literal against
// the model's FINAL ANSWER TEXT (`/mcp__codegraph__codegraph_explore/`). A run that
// really called the tool but reported only its RESULT — no tool name in the prose —
// then went RED (evidence/dsh-qa/codegraph/2026-09-14T10-35-00.286Z: `init status=ok`,
// the returned source quoted verbatim, exit 0, and `ok=false`), while a run whose
// answer merely MENTIONED the tool name went green. The assertion measured
// narration, not the tool call.
//
// The evidence now comes from the harness's own session log (lib/session-evidence.mjs):
// a recorded `tool/call` for the tool name plus a non-error `tool/result`, whose
// returned text must carry the indexed source. The prose checks stay in result.json
// as informational fields only.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { readSessionEvents, findToolCall } from "./lib/session-evidence.ts"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
// The temp project lives inside this checkout (sandbox-writable, and its path
// has no .mpd segment and is not under /tmp — the codegraph exclusion test).
const workspaceRoot = repoRoot
const PROJ = join(workspaceRoot, ".cg-qa")
const TOOLCHAIN_BIN = join(repoRoot, ".toolchain/node_modules/.bin/codegraph")
const TOOL_NAME = "mcp__codegraph__codegraph_explore"
const SERVER_NAME = "codegraph"

function selfTest() {
  if (!workspaceRoot) { console.error("[codegraph-smoke self-test] FAIL"); process.exit(1) }
  if (PROJ.includes(".mpd") || PROJ.startsWith("/tmp")) { console.error("[codegraph-smoke self-test] FAIL: temp project path violates the exclusion precondition"); process.exit(1) }
  // The asserted tool name must be COMPOSED by the profile this case boots: the
  // bundle patch's `mcp-codegraph` row declares `serverName: codegraph`, and the
  // harness derives `mcp__<serverName>__<tool>` from it. A renamed row would
  // otherwise leave the case asserting a tool that can never exist.
  const patch = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  const row = patch.split(/\n\s*- id: /).find((chunk) => chunk.startsWith("mcp-codegraph"))
  if (row === undefined) { console.error("[codegraph-smoke self-test] FAIL: no mcp-codegraph row in the bundle patch"); process.exit(1) }
  if (!row.includes("serverName: " + SERVER_NAME)) { console.error("[codegraph-smoke self-test] FAIL: the mcp-codegraph row does not declare serverName: " + SERVER_NAME); process.exit(1) }
  if (TOOL_NAME !== "mcp__" + SERVER_NAME + "__codegraph_explore") { console.error("[codegraph-smoke self-test] FAIL: the asserted tool name does not match the composed server name"); process.exit(1) }
  console.log("[codegraph-smoke self-test] ok: project-path precondition + composed codegraph server name (" + TOOL_NAME + ") verified on fixtures")
}

function runReal() {
  if (!existsSync(TOOLCHAIN_BIN)) { console.error("[codegraph-smoke] missing toolchain codegraph; run npm install --prefix .toolchain first"); process.exit(1) }
  // Always start from a CLEAN fixture: a leftover `.codegraph/` from a previous run
  // makes the boot report `init status=marker`, which would silently stop exercising
  // the binary-parse + init half of the path this case exists to prove.
  rmSync(PROJ, { recursive: true, force: true })
  mkdirSync(join(PROJ, "src"), { recursive: true })
  writeFileSync(join(PROJ, "src/util.ts"), "export function norm(x:number){return x<0?0:x}\n")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // The vendored serve.js builds its state dir under homedir() (~/.mpd since the
  // rename): isolate HOME too, and mirror the creds at the DSH home location.
  mkdirSync(join(sandbox, ".dsh"), { recursive: true })
  cpSync(creds, join(sandbox, ".dsh", ".credentials.yaml"))
  // DEFECT (measured 2026-09-14): this case copied ONLY the credentials, not
  // `settings.yaml`. On a home whose model chain is configured through gateway
  // providers (llm-pi-ai — opencode-go/scnet), the route lives in settings.yaml, so
  // the sandbox fell back to the base `deepseek-official` route and the boot died with
  // `MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`.
  // AGENTS.md §7 requires live cases to copy it when present — exactly the idiom the
  // passing cases use. Without this the case can never go green on such a home.
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  // MPD_CODEGRAPH_BIN is pinned here BY DESIGN, not as a masked defect: this case
  // exists to exercise the codegraph binary + MCP server + a real tool call, so it
  // deliberately points the adopted code at the known-good toolchain binary. Its
  // green therefore says NOTHING about the bundle's own B8 resolution chain — a
  // case that must prove THAT is mcp-call (no binary/CLI pin) and the launcher
  // resolver's own tests. Do not "clean this pin up": it is the documented intent.
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox, MPD_CODEGRAPH_PROJECT_CWD: PROJ, MPD_CODEGRAPH_BIN: TOOLCHAIN_BIN  })
  // The bundle patch references rows as @mpd-dsh/mpd/... (Plan D staged layout):
  // stage the package into the sandbox profile with npm before booting.
  const staged = join(repoRoot, "dist", "mpd-package")
  if (!existsSync(staged)) { console.error("[codegraph-smoke] missing staged bundle; run node scripts/pack-mpd.mjs first"); process.exit(1) }
  const profileDir = join(sandbox, "profiles", "headless")
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-headless", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund", "--cache", join(sandbox, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  if (inst.status !== 0) { console.error("[codegraph-smoke] FAIL: staged install\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
  const ws = sandboxWorkspace(sandbox)
  const fd = openSync(join(sandbox, "run.log"), "w")
  // The PROMPT must name the indexed project explicitly. The session workspace is a
  // /tmp sandbox (the workspace-isolation rule), and CodeGraph refuses an unindexed
  // project — including anything under /tmp (the documented exclusion) — so a call
  // that omits `projectPath` queries the SESSION WORKSPACE and gets the refusal
  // "The project at … isn't indexed with codegraph … don't call codegraph for it again
  // this session" instead of code. That is what the old prose-based assertion hid: the
  // model named the tool and paraphrased what it "should" have returned (measured
  // 2026-09-14, evidence/dsh-qa/codegraph/2026-09-14T08-56-10.102Z — a false GREEN — and
  // the 14-45-59Z session log, whose only recorded tool result is that refusal).
  const args = ["--profile", "headless",
    "--patch", join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"),
    "--patch", join(repoRoot, "tests/overlays/codegraph-plugin.yml"),
    "Call the tool mcp__codegraph__codegraph_explore with query \"norm src/util.ts\" and projectPath \"" + PROJ + "\", then report the returned content verbatim. Do not use bash."]
  const run = spawnSync("dsh", args, { env, cwd: ws, encoding: "utf8", timeout: 360000, stdio: ["ignore", fd, fd] })
  closeSync(fd)
  // Workspace isolation: the session workspace is the spawn cwd, so the boot must not
  // leave a session-store key for the real repo (DSH_HOME/HOME do not cover it).
  assertSessionsSandboxed(sandbox, sandbox, { label: "codegraph-smoke" })
  const out = readFileSync(join(sandbox, "run.log"), "utf8")
  // Harness-side tool evidence (the assertion that actually decides the case).
  let tool = { called: false, succeeded: false, reason: "the session log could not be read", resultText: "", calls: [] }
  let sessionFile = null
  let sessionError = ""
  let sessionRecords = []
  try {
    const store = readSessionEvents(sandbox, { workspace: ws })
    sessionFile = store.file
    sessionRecords = store.records
    tool = findToolCall(store.records, TOOL_NAME)
  } catch (error) {
    sessionError = error instanceof Error ? error.message : String(error)
    tool = { called: false, succeeded: false, reason: sessionError, resultText: "", calls: [] }
  }
  const initOk = /init status=(ok|marker)/.test(out)
  const resultHasNorm = tool.succeeded && /norm/.test(tool.resultText)
  const outHasToolName = new RegExp(TOOL_NAME).test(out)
  const ok = run.status === 0 && initOk && tool.succeeded && resultHasNorm
  const outDir = join(repoRoot, "evidence/dsh-qa/codegraph", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok,
    exit: run.status,
    // The deciding evidence, spelled out so a red is diagnosable from the file alone.
    assertion: "harness-recorded tool/call + non-error tool/result whose returned text carries the indexed source",
    initOk,
    tool: { name: TOOL_NAME, called: tool.called, succeeded: tool.succeeded, calls: tool.calls, resultChars: tool.resultText.length, reason: tool.reason || null },
    resultHasNorm,
    sessionFile,
    sessionError: sessionError || null,
    // Informational ONLY (never the verdict): whether the model echoed the tool name
    // in its prose — the drift that made this case red while the tool call was fine.
    outHasToolName,
  }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  // The session log IS the verdict's evidence, so it is filed WITH the verdict:
  // the raw artifact plus a decoded JSONL copy (readable without a zstd tool). A red
  // is then diagnosable from the evidence dir alone — which records existed, and what
  // the harness actually recorded for the call.
  if (sessionFile !== null && existsSync(sessionFile)) cpSync(sessionFile, join(outDir, "session.jsonl.zstd"))
  if (sessionRecords.length > 0) writeFileSync(join(outDir, "session.decoded.jsonl"), sessionRecords.map((r) => JSON.stringify(r)).join("\n") + "\n")
  // The recorded result itself: the refusal text ("isn't indexed with codegraph …")
  // or the returned source. Filed verbatim so a red needs no re-run to explain.
  writeFileSync(join(outDir, "tool-result.txt"), tool.resultText + "\n")
  rmSync(PROJ, { recursive: true, force: true })
  console.log("[codegraph-smoke] ok=" + ok + " (tool " + (tool.succeeded ? "recorded, result " + tool.resultText.length + " chars" : "MISSING: " + tool.reason) + ") -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[codegraph-smoke] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
