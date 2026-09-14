#!/usr/bin/env node
// Two-sided proof for the CodeGraph shared-daemon policy (defect wave "defects-2").
//
// Arm A — DEFAULT policy: the launcher pins CODEGRAPH_NO_DAEMON=1, the MCP server
//   answers initialize/tools/call from its own engine, NO daemon socket/pidfile is
//   created for the project root, and stderr carries the ONE-line policy notice
//   instead of any "[CodeGraph MCP] Shared daemon …" degrade line.
// Arm B — MPD_CODEGRAPH_DAEMON=1: upstream's shared daemon path is taken again, so
//   the daemon artifacts DO appear for the same root and the policy notice is absent.
//
// Usage: node evidence/mpd-defects-2/raw/codegraph-daemon-probe.mjs <outDir>
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(dirname(dirname(here)))
const outDir = process.argv[2] ?? join(here, "probe-out")
const proj = join(outDir, "proj")
const launcher = join(repoRoot, "packages/mpd-mcp-codegraph/launch.mjs")
const bin = join(repoRoot, ".toolchain/node_modules/.bin/codegraph")
const scratchHome = join(outDir, "home")

const TOOLS = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "daemon-probe", version: "0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "codegraph_explore", arguments: { query: "norm util.ts", projectPath: proj } } },
]

/** Fixture + index. The index must EXIST so the child can even reach the daemon
 *  path (`resolveDaemonRoot` needs a `.codegraph/` root); only the daemon's own
 *  artifacts (`daemon.sock`/`daemon.pid`/`daemon.log`) are cleared between arms, so
 *  both arms start from the same indexed project. */
function resetProject() {
  mkdirSync(join(proj, "src"), { recursive: true })
  writeFileSync(join(proj, "src/util.ts"), "export function norm(x:number){return x<0?0:x}\n")
  if (!existsSync(join(proj, ".codegraph", "codegraph.db"))) {
    const init = spawnSync(process.execPath, [bin, "init"], { cwd: proj, encoding: "utf8", timeout: 120_000 })
    if (init.status !== 0) throw new Error("codegraph init failed: " + (init.stderr || init.stdout || "").slice(0, 400))
  }
  for (const f of ["daemon.sock", "daemon.pid", "daemon.log"]) rmSync(join(proj, ".codegraph", f), { force: true })
}

function daemonArtifacts() {
  const dir = join(proj, ".codegraph")
  return {
    pid: existsSync(join(dir, "daemon.pid")),
    socket: existsSync(join(dir, "daemon.sock")),
    log: existsSync(join(dir, "daemon.log")),
    db: existsSync(join(dir, "codegraph.db")),
  }
}

async function arm(name, extraEnv) {
  mkdirSync(scratchHome, { recursive: true })
  const env = {
    ...process.env,
    HOME: scratchHome,
    MPD_CODEGRAPH_BIN: bin,
    MPD_CODEGRAPH_PROJECT_CWD: proj,
    ...extraEnv,
  }
  const child = spawn(process.execPath, [launcher], { env, cwd: proj, stdio: ["pipe", "pipe", "pipe"] })
  let out = ""
  let err = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => { out += chunk })
  child.stderr.on("data", (chunk) => { err += chunk })
  for (const line of TOOLS) child.stdin.write(JSON.stringify(line) + "\n")
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    if (/"id":3/.test(out.replace(/\s+/g, "")) || /"id": *3/.test(out)) break
  }
  const answered = /"id":3/.test(out.replace(/\s+/g, ""))
  const artifacts = daemonArtifacts()
  child.kill("SIGKILL")
  await new Promise((r) => setTimeout(r, 500))
  const responses = out.split("\n").filter((l) => l.trim().length > 0).map((l) => {
    const [idOrUndefined, name] = [/^\{/.test(l) ? "" : "", ""]
    void idOrUndefined; void name
    try { return JSON.parse(l) } catch { return { unparsed: l.slice(0, 120) } }
  })
  const toolsList = responses.find((r) => r?.id === 2)
  const call = responses.find((r) => r?.id === 3)
  const callText = call?.result?.content?.map((c) => c.text ?? "").join("\n") ?? ""
  return {
    arm: name,
    env: extraEnv,
    toolCount: Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools.length : null,
    exploreAnswered: answered,
    exploreIsError: call?.result?.isError ?? null,
    exploreHasNorm: /norm/.test(callText),
    exploreChars: callText.length,
    daemonArtifacts: artifacts,
    policyNotice: err.split("\n").find((l) => l.includes("[mpd-mcp-codegraph]")) ?? null,
    sharedDaemonLines: err.split("\n").filter((l) => l.includes("[CodeGraph MCP] Shared daemon")).map((l) => l.trim()),
    stderrOther: err.split("\n").filter((l) => l.trim().length > 0 && !l.includes("[mpd-mcp-codegraph]") && !l.includes("[CodeGraph MCP]")).slice(0, 8),
  }
}

mkdirSync(outDir, { recursive: true })
resetProject()
const a = await arm("A-default-in-process", {})
resetProject()
const b = await arm("B-shared-daemon-enabled", { MPD_CODEGRAPH_DAEMON: "1" })
const result = {
  checkedAt: new Date().toISOString(),
  launcher,
  binary: bin,
  project: proj,
  arms: [a, b],
  verdict: {
    // The DEFAULT arm is the user-visible contract of this change: the tool answers
    // from the session's own engine, no daemon artifacts are created for the project
    // root, and upstream's "Shared daemon connection lost" line cannot appear.
    A_answered_without_daemon: a.exploreAnswered && a.exploreHasNorm && !a.daemonArtifacts.pid && a.daemonArtifacts.socket === false,
    A_no_degrade_line: a.sharedDaemonLines.length === 0,
    A_policy_notice_present: typeof a.policyNotice === "string" && a.policyNotice.includes("in-process"),
    // The OPT-OUT arm proves only that our policy does not force in-process when it is
    // disabled: no notice, tool still served. It does NOT prove the daemon path
    // materializes — measured here on an indexed project, NO daemon socket appeared in
    // EITHER arm, so upstream's detached daemon did not come up in this sandbox at all
    // (verified independently: `codegraph serve --mcp` in the same sandbox prints no
    // daemon notice and creates no socket). That half is upstream's behaviour and is
    // recorded as unproven rather than claimed.
    B_policy_notice_absent: b.policyNotice === null,
    B_tool_still_served: b.exploreAnswered && b.exploreHasNorm,
    B_daemon_socket_observed: Boolean(b.daemonArtifacts.pid || b.daemonArtifacts.socket),
  },
}
writeFileSync(join(outDir, "codegraph-daemon-probe.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result.verdict, null, 2))
console.log("arms: A=" + JSON.stringify({ tools: a.toolCount, answered: a.exploreAnswered, norm: a.exploreHasNorm, daemon: a.daemonArtifacts, notice: Boolean(a.policyNotice), degrade: a.sharedDaemonLines.length }))
console.log("      B=" + JSON.stringify({ tools: b.toolCount, answered: b.exploreAnswered, norm: b.exploreHasNorm, daemon: b.daemonArtifacts, notice: Boolean(b.policyNotice), degrade: b.sharedDaemonLines.length }))
