#!/usr/bin/env node
// Case team-route-rewire (Plan F / W1): prove the team-mode trigger surface points at the
// FIRST-PARTY agent-teams protocol AND that the plugin is served by the BUNDLE, not by an
// external npm dependency:
//   1) staged bundle install into an isolated profile via the official `dsh plugin add`
//      flow (no direct @nanmicoder declaration anywhere in the profile);
//   2) the agent-teams row loads the first-party entry
//      (@mpd-dsh/mpd/packages/mpd-agent-teams, no self-disabling guard) and composes with
//      stateDir .mpd/team + memberMaxDepth 3;
//   3) profile-root resolution of the first-party entry succeeds (a plain npm name row
//      would FAIL - pnpm never links bundle transitives, evidence/plan-e/e1-team-route);
//   4) real headless boot: no module errors, mpd tools answer, mpd-bootstrap copies the
//      rewired skills/presets to $DSH_HOME whose texts point at agent_teams_*;
//   5) web profile route smoke: /plugins/dsh-agent-teams/state responds 200.
// Evidence -> evidence/plan-f/w1/team-route-rewire/<ts>/. --self-test is offline.
// Never touches the real ~/.dsh.
import { spawnSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const DEV = process.env.MPD_DEV_ROOT || "/home/haroldzhao/dshProj/my-power-dsh"
const VENDOR = join(repoRoot, "packages", "mpd-agent-teams")

function selfTest() {
  const checks = []
  const atlas = readFileSync(join(repoRoot, "packages", "mpd-presets-plugin", "presets", "mpd-atlas", "agent.cordis.yml"), "utf8")
  const execute = readFileSync(join(repoRoot, "skills", "ulw-execute", "SKILL.md"), "utf8")
  const research = readFileSync(join(repoRoot, "skills", "ulw-research", "SKILL.md"), "utf8")
  checks.push(["atlas agent_teams_*, no mpd_team_spawn", atlas.includes("agent_teams_create") && !atlas.includes("mpd_team_spawn")])
  checks.push(["ulw-execute row agent_teams_*", execute.includes("agent_teams_create") && !execute.includes("mpd_team_spawn")])
  checks.push(["ulw-research row agent_teams_* + maxMembers", research.includes("agent_teams_create") && research.includes("maxMembers: 8") && !research.includes("mpd_team_spawn")])
  const vendorPkg = JSON.parse(readFileSync(join(VENDOR, "package.json"), "utf8"))
  checks.push(["first-party package 0.1.14", vendorPkg.version === "0.1.14" && vendorPkg.name === "@mpd-dsh/agent-teams"])
  checks.push(["first-party lib + assets + closure present", existsSync(join(VENDOR, "lib", "index.js")) && existsSync(join(VENDOR, "assets", "ui.png")) && existsSync(join(VENDOR, "_deps", "schemastery", "lib", "index.mjs")) && existsSync(join(VENDOR, "_deps", "dsh-tools", "lib", "index.js")) && existsSync(join(VENDOR, "_deps", "dsh-llm", "lib", "index.js")) && existsSync(join(VENDOR, "_deps", "zod", "index.js"))])
  const libHead = readFileSync(join(VENDOR, "lib", "index.js"), "utf8").slice(0, 6000)
  checks.push(["no bare @deepseek-ai/schemastery import", !libHead.includes("from '@deepseek-ai/schemastery'") && libHead.includes("_deps/schemastery/lib/index.mjs")])
  const schemHead = readFileSync(join(VENDOR, "_deps", "schemastery", "lib", "index.mjs"), "utf8").slice(0, 600)
  checks.push(["schemastery cosmo import rewritten", !schemHead.includes('@deepseek-ai/cosmokit') && schemHead.includes("cosmokit/lib/index.js")])
  checks.push(["closure self-contained", !readFileSync(join(VENDOR, "_deps", "dsh-subagent", "lib", "index.js"), "utf8").includes('@deepseek-ai/dsh-tools') && !readFileSync(join(VENDOR, "lib", "index.js"), "utf8").slice(0, 60000).includes('from "@deepseek-ai')])
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  checks.push(["patch row first-party + guard gone", patch.includes("name: '@mpd-dsh/mpd/packages/mpd-agent-teams'") && !patch.includes("Self-disabling guard") && !patch.includes("@nanmicoder/dsh-agent-teams'")])
  const pack = readFileSync(join(repoRoot, "scripts", "pack-mpd.mjs"), "utf8")
  checks.push(["pack exports + client + no deps entry", pack.includes('"./packages/mpd-agent-teams"') && pack.includes('"./client"') && pack.includes("first-party") && !pack.includes('dependencies: { "@nanmicoder')])
  const clientHead = readFileSync(join(VENDOR, "lib", "client.js"), "utf8").slice(0, 400)
  checks.push(["client registers under entry id", clientHead.includes('id: "@mpd-dsh/mpd/packages/mpd-agent-teams"') && !clientHead.includes('id: "@nanmicoder/dsh-agent-teams"')])
  const buildScript = readFileSync(join(repoRoot, "scripts", "build-agent-teams.mjs"), "utf8")
  checks.push(["build script rewrites client id", buildScript.includes("client registration id") && buildScript.includes('ENTRY_ID = "@mpd-dsh/mpd/packages/mpd-agent-teams"')])
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) { console.error("[team-route-rewire self-test] FAIL: " + bad.join(" | ")); process.exit(1) }
  if (!existsSync(join(repoRoot, "dist", "mpd-package", "package.json"))) { console.error("[team-route-rewire self-test] FAIL: run node scripts/pack-mpd.mjs first"); process.exit(1) }
  console.log("[team-route-rewire self-test] ok: " + checks.length + " checks + staged bundle present")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[team-route-rewire] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-f", "w1", "team-route-rewire", ts)
  mkdirSync(outDir, { recursive: true })
  const reloc = join(repoRoot, ".qa-reloc")
  mkdirSync(reloc, { recursive: true })
  // Home is read-only in this sandbox, so the default pnpm store (~/.local/share/pnpm)
  // cannot open its sqlite index. Point pnpm's store at the writable QA area; `dsh plugin`
  // forwards args verbatim to pnpm.
  const pnpmStore = join(reloc, ".pnpm-store")
  const staged = join(reloc, "mpd-pkg-relocated")
  cpSync(join(repoRoot, "dist", "mpd-package"), staged, { recursive: true })
  const home = join(reloc, "home-rewire")
  const profile = join(home, "profiles", "t")
  mkdirSync(profile, { recursive: true })
  cpSync(creds, join(home, ".credentials.yaml"))
  mkdirSync(join(reloc, "ws-rewire"), { recursive: true })
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
  const dumpOut = dump.out
  const dumpClean = dumpOut.split(home).join("<QAHOME>")
  steps.dump = { ok: dump.status === 0 && dumpOut.includes("agent-teams") && dumpOut.includes(".mpd/team") && dumpOut.includes("@mpd-dsh/mpd/packages/mpd-agent-teams") && !dumpOut.includes("@nanmicoder/dsh-agent-teams'") && !dumpClean.includes(DEV), exit: dump.status, leaked: dumpClean.includes(DEV) }
  const resCode = "const {createRequire}=require('module');const r=createRequire(process.argv[1]);try{console.log('FIRSTPARTY_OK '+r.resolve('@mpd-dsh/mpd/packages/mpd-agent-teams/package.json'))}catch(e){console.log('FIRSTPARTY_FAIL '+e.code)};try{r.resolve('@nanmicoder/dsh-agent-teams/package.json');console.log('PKG_PRESENT')}catch(e){console.log('PKG_ABSENT')}"
  const res = runSync("node", ["-e", resCode, join(profile, "x.js")])
  steps.resolution = { ok: res.status === 0 && res.out.includes("FIRSTPARTY_OK") && res.out.includes("PKG_ABSENT"), out: res.out.trim() }
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: mpd-oracle\n")
  const live = runSync("dsh", ["--profile", "t", "Use mpd_config_get with key 'memory.vcs' then mpd_memory_status; report both values in one line."], { timeout: 600000, cwd: join(reloc, "ws-rewire") })
  const out = live.out
  steps.live = { ok: live.status === 0 && !out.includes("ERR_MODULE_NOT_FOUND") && !out.includes("@nanmicoder"), exit: live.status }
  steps.bootstrap = { ok: out.includes("mpd-bootstrap") }
  const userSkills = join(home, "skills")
  const texts = [
    join(userSkills, "ulw-research", "SKILL.md"),
    join(userSkills, "ulw-execute", "SKILL.md"),
    join(home, ".agent-presets", "mpd-atlas", "agent.cordis.yml"),
    join(home, ".agent-presets", "mpd-hephaestus", "agent.cordis.yml")
  ].filter((p) => existsSync(p)).map((p) => readFileSync(p, "utf8"))
  const allText = texts.join("\n")
  steps.installedTexts = { ok: texts.length === 4 && allText.includes("agent_teams_create") && !allText.includes("mpd_team_spawn") && allText.includes("Team member mode"), files: texts.length }
  const webProfile = join(home, "profiles", "w")
  mkdirSync(webProfile, { recursive: true })
  writeFileSync(join(webProfile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  const addWeb = runSync("dsh", ["plugin", "--profile", "w", "add", staged, "--store-dir", pnpmStore], { timeout: 600000 })
  const port = 3198
  const webLog = join(outDir, "web.log")
  const webFd = openSync(webLog, "w")
  const web = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env, cwd: join(reloc, "ws-rewire"), detached: false, stdio: ["ignore", webFd, webFd] })
  let routeOk = false, routeStatus = null, clientOk = false, clientId = ""
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/plugins/dsh-agent-teams/state", { signal: AbortSignal.timeout(4000) })
      routeStatus = res.status
      routeOk = res.status === 200
      await res.text()
      const cres = await fetch("http://127.0.0.1:" + port + "/plugins/@mpd-dsh/mpd/packages/mpd-agent-teams/client.js", { signal: AbortSignal.timeout(8000) })
      const ctext = await cres.text()
      const m = ctext.match(/id:\s*"([^"]+)"/)
      clientId = m ? m[1] : ""
      clientOk = cres.status === 200 && clientId === "@mpd-dsh/mpd/packages/mpd-agent-teams"
      break
    } catch { /* not up yet */ }
  }
  web.kill("SIGTERM")
  try { await new Promise((r) => setTimeout(r, 1500)) } catch {}
  steps.webRoute = { ok: addWeb.status === 0 && routeOk, status: routeStatus, addExit: addWeb.status }
  steps.clientBundle = { ok: clientOk, status: clientId ? 200 : null, registeredId: clientId }
  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox: home, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump ---\n" + dumpOut.slice(0, 30000))
  console.log("[team-route-rewire] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 220))
  if (!allOk) process.exit(1)
  console.log("[team-route-rewire] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
