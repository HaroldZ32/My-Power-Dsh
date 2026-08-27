#!/usr/bin/env node
// Case plan-f-leaf-e2e (Plan F / W3): prove the tree captain(0) -> member(1) -> leaf(2) via mpd_leaf_iterate.
//   1) staged bundle install into an isolated profile via `dsh plugin add`
//      (pnpm store redirected to the writable QA area — home is read-only here);
//   2) default preset switched to mpd-captain;
//   3) one real headless run: captain creates a 1-member team through
//      agent_teams_*, a task gets a terminal status, and the team is archived;
//   4) assert team state (.mpd/team/<teamId>/team.json + inbox) on disk.
// Evidence -> evidence/plan-f/w3/leaf-e2e/<ts>/. --self-test is offline.
// Never touches the real ~/.dsh.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PROMPT = "Use AgentTeams for a tiny verification: create team 'e2e' (description 'plan-f W3 leaf e2e'); add ONE member 'reviewer'; create task t1 'Use mpd_leaf_iterate with basePreset mpd-oracle to summarize the repo git log (last 5 commits) into 3 acceptance criteria; report the leaf evidence path' assigned to reviewer; approve the plan and let the scheduler run; call agent_teams_status once before finishing; then archive the team with agent_teams_delete. End with the team_id, the leaf evidence path, and archive path."

function fail(msg) { console.error("[plan-f-leaf-e2e] FAIL: " + msg); process.exit(1) }

function selfTest() {
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!patch.includes("name: '@mpd-dsh/mpd/packages/mpd-agent-teams'")) fail("bundle row is not first-party")
  if (!patch.includes("memberMaxDepth: 3")) fail("memberMaxDepth is not 3")
  if (!patch.includes("mpd-default")) fail("team profile mpd-default missing")
  if (!existsSync(join(repoRoot, "packages", "mpd-presets-plugin", "presets", "mpd-captain", "preset.yml"))) fail("captain preset missing")
  const captain = readFileSync(join(repoRoot, "packages", "mpd-presets-plugin", "presets", "mpd-captain", "agent.cordis.yml"), "utf8")
  if (!captain.includes("team-first") && !captain.includes("Team-first")) fail("captain persona not team-first")
  if (!existsSync(join(repoRoot, "dist", "mpd-package", "package.json"))) fail("run node scripts/pack-mpd.mjs first")
  console.log("[plan-f-captain-smoke self-test] ok: bundle/profile/preset checks + staged bundle present")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-f", "w3", "leaf-e2e", ts)
  mkdirSync(outDir, { recursive: true })
  const reloc = join(repoRoot, ".qa-reloc")
  mkdirSync(reloc, { recursive: true })
  const staged = join(reloc, "mpd-pkg-w3")
  cpSync(join(repoRoot, "dist", "mpd-package"), staged, { recursive: true })
  const home = join(reloc, "home-w3")
  const profile = join(home, "profiles", "t")
  mkdirSync(profile, { recursive: true })
  cpSync(creds, join(home, ".credentials.yaml"))
  const ws = join(reloc, "ws-w3")
  mkdirSync(ws, { recursive: true })
  const pnpmStore = join(reloc, ".pnpm-store-w3")
  const env = { ...process.env, DSH_HOME: home }
  const steps = {}
  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }

  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  const add = runSync("dsh", ["plugin", "--profile", "t", "add", staged, "--store-dir", pnpmStore], { timeout: 600000 })
  steps.install = { ok: add.status === 0, exit: add.status }
  const dump = runSync("dsh", ["--profile", "t", "--dump-config"], { timeout: 120000 })
  steps.dump = { ok: dump.status === 0 && dump.out.includes("agent-teams") && dump.out.includes(".mpd/team") && dump.out.includes("@mpd-dsh/mpd/packages/mpd-agent-teams"), exit: dump.status }
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: mpd-captain\n")
  const live = runSync("dsh", ["--profile", "t", PROMPT], { timeout: 900000, cwd: ws })
  const out = live.out
  const realError = out.includes("failed to read overlay") || /ERR_MODULE_NOT_FOUND\s+@/.test(out) || /Cannot find module/.test(out)
  steps.live = { ok: live.status === 0 && !realError, exit: live.status }

  const root = join(ws, ".mpd", "team")
  const archive = join(root, "archive")
  const activeIds = existsSync(root) ? readdirSync(root).filter((d) => d !== "archive" && d !== "retired-members.json" && existsSync(join(root, d, "team.json"))) : []
  const archiveIds = existsSync(archive) ? readdirSync(archive).filter((d) => existsSync(join(archive, d, "team.json"))) : []
  const ids = activeIds.length > 0 ? activeIds : archiveIds
  const teamJson = ids.map((id) => {
    const base = activeIds.length > 0 ? root : archive
    try { return JSON.parse(readFileSync(join(base, id, "team.json"), "utf8")) } catch { return null }
  })
  const inboxOk = ids.every((id) => {
    const base = activeIds.length > 0 ? root : archive
    const p = join(base, id, "inbox")
    return existsSync(p) && readdirSync(p).some((f) => f.endsWith(".jsonl"))
  })
  const taskTerminal = teamJson.some((t) => t && Array.isArray(t.tasks) && t.tasks.some((x) => ["completed", "failed", "cancelled"].includes(x.status)))
  steps.teamState = { ok: ids.length >= 1 && teamJson.every(Boolean) && inboxOk && taskTerminal, ids, taskTerminal, inboxOk }

  const leafRoot = join(ws, ".mpd", "leaf")
  const leafIds = existsSync(leafRoot) ? readdirSync(leafRoot).filter((d) => existsSync(join(leafRoot, d, "run.json"))) : []
  let leafOk = leafIds.length >= 1
  let leafMeta = { ids: leafIds }
  if (leafIds.length > 0) {
    try {
      const rec = JSON.parse(readFileSync(join(leafRoot, leafIds[0], "run.json"), "utf8"))
      leafOk = leafOk && rec.basePreset === "mpd-oracle" && (rec.records ?? []).length >= 1
      leafMeta = { ids: leafIds, basePreset: rec.basePreset, rounds: (rec.records ?? []).length }
    } catch { leafOk = false }
  }
  steps.leafState = { ok: leafOk, ...leafMeta }

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox: home, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 50000) + "\n\n--- dump ---\n" + dump.out.slice(0, 30000))
  console.log("[plan-f-leaf-e2e] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 260))
  if (!allOk) process.exit(1)
  console.log("[plan-f-leaf-e2e] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
