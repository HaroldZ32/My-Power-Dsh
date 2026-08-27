#!/usr/bin/env node
// Case plan-f-golden-leaf (Plan F / golden suite): prove the EXECUTOR leaf path
// (member -> mpd_leaf_iterate -> one-shot leaf at depth 2) on a real golden task.
// The leaf implements the task in the REAL repo workspace (dsh cwd = repoRoot) and
// the loop terminates when the declared gates (incl. golden:<task>) pass.
// Usage: node skills/dsh-qa/scripts/plan-f-golden-leaf.mjs --task <id> --base <preset>
//        --gates <csv> [--max-rounds N] [--self-test]
// Evidence -> evidence/plan-f/w3/golden-leaf/<task>/<ts>/. --self-test is offline.
// Never touches the real ~/.dsh (isolated DSH_HOME; repo workspace is the test target).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const args = process.argv.slice(2)
function argVal(name, def) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
if (process.argv.includes("--self-test")) {
  if (!existsSync(join(repoRoot, "dist", "mpd-package", "package.json"))) { console.error("[plan-f-golden-leaf self-test] FAIL: run node scripts/pack-mpd.mjs first"); process.exit(1) }
  for (const d of ["soft-ts-tokenizer", "hw-verilog-adder8"]) {
    if (!existsSync(join(repoRoot, "tests", "golden", d, "task.json"))) { console.error("[plan-f-golden-leaf self-test] FAIL: " + d + " missing"); process.exit(1) }
  }
  console.log("[plan-f-golden-leaf self-test] ok: staged bundle + golden tasks present")
  process.exit(0)
}
const TASK = argVal("--task", "soft-ts-tokenizer")
const BASE = argVal("--base", "mpd-sisyphus")
const GATES = (argVal("--gates", "bun-test,golden:" + TASK)).split(",")
const MAX_ROUNDS = Number(argVal("--max-rounds", "3"))
const specText = readFileSync(join(repoRoot, "tests", "golden", TASK, "SPEC.md"), "utf8").split("\n").slice(0, 6).join(" | ")
const PROMPT = "Use AgentTeams for a golden verification: create team 'g' (description 'plan-f golden leaf " + TASK + "'); add ONE member 'engineer'; create task t1 'Call mpd_leaf_iterate with objective: implement THE CURRENT golden task exactly per tests/golden/" + TASK + "/SPEC.md (create the required solution file in tests/golden/" + TASK + "/); basePreset: " + BASE + "; maxRounds: " + MAX_ROUNDS + "; gates: [" + GATES.join(",") + "]. Report the leaf evidence path.' assigned to engineer; approve; wait; call agent_teams_status once; archive the team with agent_teams_delete. End with the team_id and leaf evidence path."

function fail(msg) { console.error("[plan-f-golden-leaf] FAIL: " + msg); process.exit(1) }

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials")
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-f", "w3", "golden-leaf", TASK, ts)
  mkdirSync(outDir, { recursive: true })
  const reloc = join(repoRoot, ".qa-reloc")
  mkdirSync(reloc, { recursive: true })
  const staged = join(reloc, "mpd-pkg-golden")
  cpSync(join(repoRoot, "dist", "mpd-package"), staged, { recursive: true })
  const home = join(reloc, "home-golden")
  const profile = join(home, "profiles", "t")
  mkdirSync(profile, { recursive: true })
  cpSync(creds, join(home, ".credentials.yaml"))
  const pnpmStore = join(reloc, ".pnpm-store-golden")
  const env = { ...process.env, DSH_HOME: home }
  const steps = {}
  function runSync(cmd, cmdArgs, opts = {}) {
    const r = spawnSync(cmd, cmdArgs, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }

  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  const add = runSync("dsh", ["plugin", "--profile", "t", "add", staged, "--store-dir", pnpmStore], { timeout: 600000 })
  steps.install = { ok: add.status === 0, exit: add.status }
  const dump = runSync("dsh", ["--profile", "t", "--dump-config"], { timeout: 120000 })
  steps.dump = { ok: dump.status === 0 && dump.out.includes("agent-teams") && dump.out.includes(".mpd/team") && dump.out.includes("@mpd-dsh/mpd/packages/mpd-agent-teams"), exit: dump.status }
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: mpd-captain\n")
  const live = runSync("dsh", ["--profile", "t", PROMPT], { timeout: 1500000, cwd: repoRoot })
  const out = live.out
  steps.live = { ok: live.status === 0 && !out.includes("failed to read overlay"), exit: live.status }

  const teamRoot = join(repoRoot, ".mpd", "team")
  const archive = join(teamRoot, "archive")
  const activeIds = existsSync(teamRoot) ? readdirSync(teamRoot).filter((d) => d !== "archive" && d !== "retired-members.json" && existsSync(join(teamRoot, d, "team.json"))) : []
  const archiveIds = existsSync(archive) ? readdirSync(archive).filter((d) => existsSync(join(archive, d, "team.json"))) : []
  const ids = activeIds.length > 0 ? activeIds : archiveIds
  steps.teamState = { ok: ids.length >= 1, ids: activeIds, archived: archiveIds }

  const leafRoot = join(repoRoot, ".mpd", "leaf")
  const leafIds = existsSync(leafRoot) ? readdirSync(leafRoot).filter((d) => existsSync(join(leafRoot, d, "run.json"))).sort() : []
  let leafOk = leafIds.length >= 1
  let leafMeta = { ids: leafIds }
  if (leafIds.length > 0) {
    const latest = leafIds[leafIds.length - 1]
    try {
      const rec = JSON.parse(readFileSync(join(leafRoot, latest, "run.json"), "utf8"))
      leafOk = leafOk && rec.basePreset === BASE && (rec.records ?? []).length >= 1 && (rec.gatePassed === true || !rec.requireGate)
      leafMeta = { id: latest, basePreset: rec.basePreset, rounds: (rec.records ?? []).length, gatePassed: rec.gatePassed }
    } catch { leafOk = false }
  }
  steps.leafState = { ok: leafOk, ...leafMeta }

  const gr = runSync("node", ["tests/golden/run.mjs", "--task", TASK])
  steps.goldenTask = { ok: gr.status === 0, exit: gr.status, tail: gr.out.slice(-400) }

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, task: TASK, base: BASE, gates: GATES, maxRounds: MAX_ROUNDS, spec: specText, sandbox: home, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 60000))
  console.log("[plan-f-golden-leaf] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[plan-f-golden-leaf] PASS")
}
runReal()
