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
// The evidence now comes from the harness's own session log (lib/session-evidence.ts):
// a recorded `tool/call` for the tool name plus a non-error `tool/result`, whose
// returned text must carry the indexed source. The prose checks stay in result.json
// as informational fields only.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { readSessionEvents, findToolCall, type RecordedToolCall, type SessionRecord, type ToolCallEvidence } from "./lib/session-evidence.ts"
import { credentialEnv, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
// The temp project lives inside this checkout (sandbox-writable, and its path
// has no .mpd segment and is not under /tmp — the codegraph exclusion test).
/** The root the temp project is created under: the checkout itself, whose path passes the exclusion test. */
const workspaceRoot = repoRoot
/** The throw-away indexed project; its path is the fixture the codegraph exclusion rule is exercised on. */
const PROJ = join(workspaceRoot, ".cg-qa")
/** The pinned codegraph binary this case exercises on purpose (see the MPD_CODEGRAPH_BIN note in `runReal`). */
const TOOLCHAIN_BIN = join(repoRoot, ".toolchain/node_modules/.bin/codegraph")
/** The harness-composed MCP tool name the session log must record a call for. */
const TOOL_NAME = "mcp__codegraph__codegraph_explore"
/** The `serverName` the bundle patch's row declares, from which the tool name above is derived. */
const SERVER_NAME = "codegraph"

/** The session-log evidence a failed or not-yet-attempted read leaves behind: fewer fields than
 *  `ToolCallEvidence` because no call id or tool name is known before the pairing runs. */
interface ToolEvidencePlaceholder {
  /** False: no recorded `tool/call` is known. */
  called: boolean
  /** False: no non-error `tool/result` is known. */
  succeeded: boolean
  /** Why the pairing is unknown (a read failure, or the initial placeholder text). */
  reason: string
  /** The joined result text; `""` before a successful read. */
  resultText: string
  /** The recorded calls; empty before a successful read. */
  calls: RecordedToolCall[]
}

/** The headless boot's outcome: a real child result, or the launcher-missing shape that reports `DSH_MISSING` on stderr. */
interface LiveOutcome {
  /** The boot's exit status; `null` when no launcher resolved or the child was signalled. */
  status: number | null
  /** Captured stdout; empty on the launcher-missing arm. */
  stdout: string
  /** Captured stderr; carries `DSH_MISSING` when no launcher resolved on this host. */
  stderr: string
  /** The spawn error, present only on the launcher-missing arm (kept for the recorded evidence shape). */
  error?: Error
}

/** The offline arm: proves the fixture path precondition and that the asserted tool name is composed. */
function selfTest(): void {
  if (!workspaceRoot) { console.error("[codegraph-smoke self-test] FAIL"); process.exit(1) }
  if (PROJ.includes(".mpd") || PROJ.startsWith("/tmp")) { console.error("[codegraph-smoke self-test] FAIL: temp project path violates the exclusion precondition"); process.exit(1) }
  // The asserted tool name must be COMPOSED by the profile this case boots: the
  // bundle patch's `mcp-codegraph` row declares `serverName: codegraph`, and the
  // harness derives `mcp__<serverName>__<tool>` from it. A renamed row would
  // otherwise leave the case asserting a tool that can never exist.
  /** The bundle patch whose `mcp-codegraph` row must declare the server name the tool name derives from. */
  const patch = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  /** That row's own chunk of the patch, split on the `- id: ` separators. */
  const row = patch.split(/\n\s*- id: /).find((chunk) => chunk.startsWith("mcp-codegraph"))
  if (row === undefined) { console.error("[codegraph-smoke self-test] FAIL: no mcp-codegraph row in the bundle patch"); process.exit(1) }
  if (!row.includes("serverName: " + SERVER_NAME)) { console.error("[codegraph-smoke self-test] FAIL: the mcp-codegraph row does not declare serverName: " + SERVER_NAME); process.exit(1) }
  if (TOOL_NAME !== "mcp__" + SERVER_NAME + "__codegraph_explore") { console.error("[codegraph-smoke self-test] FAIL: the asserted tool name does not match the composed server name"); process.exit(1) }
  console.log("[codegraph-smoke self-test] ok: project-path precondition + composed codegraph server name (" + TOOL_NAME + ") verified on fixtures")
}

/** The live arm: index a temp project, boot the MCP server and assert the harness-recorded tool call. */
function runReal(): void {
  if (!existsSync(TOOLCHAIN_BIN)) { console.error("[codegraph-smoke] missing toolchain codegraph; run npm install --prefix .toolchain first"); process.exit(1) }
  // Always start from a CLEAN fixture: a leftover `.codegraph/` from a previous run
  // makes the boot report `init status=marker`, which would silently stop exercising
  // the binary-parse + init half of the path this case exists to prove.
  rmSync(PROJ, { recursive: true, force: true })
  mkdirSync(join(PROJ, "src"), { recursive: true })
  writeFileSync(join(PROJ, "src/util.ts"), "export function norm(x:number){return x<0?0:x}\n")
  /** The real home's credential file, copied ONCE into the sandbox and never read again. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  /** The fresh temporary sandbox that serves as BOTH `DSH_HOME` and `HOME` for this run. */
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
  /** The real home's model-chain settings, staged only when the host has one. */
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  // MPD_CODEGRAPH_BIN is pinned here BY DESIGN, not as a masked defect: this case
  // exists to exercise the codegraph binary + MCP server + a real tool call, so it
  // deliberately points the adopted code at the known-good toolchain binary. Its
  // green therefore says NOTHING about the bundle's own B8 resolution chain — a
  // case that must prove THAT is mcp-call (no binary/CLI pin) and the launcher
  // resolver's own tests. Do not "clean this pin up": it is the documented intent.
  /** The sandboxed environment every child of this case inherits, with the deliberate binary pin. */
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox, MPD_CODEGRAPH_PROJECT_CWD: PROJ, MPD_CODEGRAPH_BIN: TOOLCHAIN_BIN  })
  // The bundle patch references rows as @mpd-dsh/mpd/... (Plan D staged layout):
  // stage the package into the sandbox profile with npm before booting.
  /** The staged pack the profile installs by `file:`; the patch's row paths resolve inside it. */
  const staged = join(repoRoot, "dist", "mpd-package")
  if (!existsSync(staged)) { console.error("[codegraph-smoke] missing staged bundle; run node scripts/pack-mpd.ts first"); process.exit(1) }
  /** The sandbox profile (`headless`) that holds the `file:` dependency on the staged pack. */
  const profileDir = join(sandbox, "profiles", "headless")
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-headless", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  /** The `npm install` of the staged pack into the sandbox profile. */
  const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund", "--cache", join(sandbox, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  if (inst.status !== 0) { console.error("[codegraph-smoke] FAIL: staged install\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
  /** The sandbox workspace the boot runs from; workspace-scoped state resolves from it. */
  const ws = sandboxWorkspace(sandbox)
  /** The run log's file descriptor: stdio goes to a FILE, never a pipe, because MCP children hold the fd. */
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
  /** The headless boot arguments: the staged profile, the bundle patch and the explicit-project prompt. */
  const args = ["--profile", "headless",
    "--patch", join(repoRoot, "cordis.patch.yml"),
    "--patch", join(repoRoot, "tests/overlays/codegraph-plugin.yml"),
    "Call the tool mcp__codegraph__codegraph_explore with query \"norm src/util.ts\" and projectPath \"" + PROJ + "\", then report the returned content verbatim. Do not use bash."]
  /** The resolved `dsh` launcher invocation for the headless boot, or `null` when none is on PATH. */
  const runSpec = dshCommand(args, env)
  /** The headless boot result; a missing launcher is reported instead of thrown. */
  const run: LiveOutcome = runSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(runSpec.command, runSpec.args, { env, cwd: ws, encoding: "utf8", timeout: 360000, stdio: ["ignore", fd, fd] })
  closeSync(fd)
  // Workspace isolation: the session workspace is the spawn cwd, so the boot must not
  // leave a session-store key for the real repo (DSH_HOME/HOME do not cover it).
  assertSessionsSandboxed(sandbox, sandbox, { label: "codegraph-smoke" })
  /** The boot log, read back from the fd's file after the child closed it. */
  const out = readFileSync(join(sandbox, "run.log"), "utf8")
  // Harness-side tool evidence (the assertion that actually decides the case).
  /** The paired tool evidence, or the placeholder until the session store is read. */
  let tool: ToolCallEvidence | ToolEvidencePlaceholder = { called: false, succeeded: false, reason: "the session log could not be read", resultText: "", calls: [] }
  /** The session log the evidence came from, or `null` when none was selected. */
  let sessionFile: string | null = null
  /** Why the session-log read failed (`""` when it succeeded); filed in result.json. */
  let sessionError = ""
  /** Every decoded session record, filed as a readable JSONL copy beside the raw log. */
  let sessionRecords: SessionRecord[] = []
  try {
    /** The session store selected for the sandbox workspace. */
    const store = readSessionEvents(sandbox, { workspace: ws })
    sessionFile = store.file
    sessionRecords = store.records
    tool = findToolCall(store.records, TOOL_NAME)
  } catch (error) {
    sessionError = error instanceof Error ? error.message : String(error)
    tool = { called: false, succeeded: false, reason: sessionError, resultText: "", calls: [] }
  }
  /** Whether the boot reported the codegraph index as initialized (or already present). */
  const initOk = /init status=(ok|marker)/.test(out)
  /** Whether the recorded result actually carried the indexed source (the `norm` fixture). */
  const resultHasNorm = tool.succeeded && /norm/.test(tool.resultText)
  /** Informational only: whether the model echoed the tool name in its prose. */
  const outHasToolName = new RegExp(TOOL_NAME).test(out)
  /** The case verdict: a clean exit, an initialized index and a recorded call returning the source. */
  const ok = run.status === 0 && initOk && tool.succeeded && resultHasNorm
  /** The evidence directory this run writes its verdict and session artifacts into. */
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

/** The command line after the interpreter and script path: `--self-test` selects the offline arm. */
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
