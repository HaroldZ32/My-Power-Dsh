#!/usr/bin/env node
// Case team-route-rewire (Plan E / E4, updated for main-code adoption): prove the
// team-mode trigger surface points at the adopted dsh-agent-teams protocol AND that the
// plugin is served by the BUNDLE, not by an external npm dependency:
//   1) staged bundle install into an isolated profile via the official `dsh plugin add`
//      flow (no direct @nanmicoder declaration anywhere in the profile);
//   2) the agent-teams row loads the FIRST-CLASS MAIN-CODE entry
//      (@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js, no self-disabling
//      guard) and composes with stateDir .mpd/team;
//   3) profile-root resolution of the main-code entry succeeds (the guard expression
//      would FAIL on @nanmicoder/dsh-agent-teams - that failure was the original defect;
//      current evidence -> evidence/plan-e/e4-team-vendor/<ts>/);
//   4) real headless boot with the QA probe (deterministic, no model call): the
//      INSTALLED bundle serves the rewired preset + skill catalog (no $DSH_HOME
//      copy) and its texts point at agent_teams_*;
//   5) web profile route smoke: /plugins/dsh-agent-teams/state responds 200.
// Evidence -> evidence/plan-e/e4-team-vendor/<ts>/. --self-test is offline.
// Never touches the real ~/.dsh.
import { spawnSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const DEV = process.env.MPD_DEV_ROOT || repoRoot
const VENDOR = join(repoRoot, "packages", "mpd-agent-teams-plugin")

function selfTest() {
  const checks = []
  const mpdPreset = readFileSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "presets", "mpd", "agent.cordis.yml"), "utf8")
  const execute = readFileSync(join(repoRoot, "skills", "ulw-execute", "SKILL.md"), "utf8")
  const research = readFileSync(join(repoRoot, "skills", "ulw-research", "SKILL.md"), "utf8")
  checks.push(["mpd preset AGENT.md candidates", mpdPreset.includes("AGENT.md") && mpdPreset.includes("AGENTS.md") && mpdPreset.includes("instructionFileCandidates")])
  checks.push(["mpd preset: roster spawn + agent-teams team, no bespoke team", mpdPreset.includes("mpd_role_spawn") && mpdPreset.includes("agent_teams_create") && !mpdPreset.includes("mpd_team_spawn")])
  checks.push(["ulw-execute row: roster + agent-teams team, no bespoke team", execute.includes("mpd_role_spawn") && execute.includes("agent_teams_create") && !execute.includes("mpd_team_spawn")])
  checks.push(["ulw-research row: roster + agent-teams team, no bespoke team", research.includes("mpd_role_spawn") && research.includes("agent_teams_create") && research.includes("profile=\"mpd\"") && !research.includes("mpd_team_spawn") && !research.includes("selectable roles")])
  const vendorPkg = JSON.parse(readFileSync(join(VENDOR, "package.json"), "utf8"))
  checks.push(["main-code package 0.1.14 (renamed @mpd-dsh/agent-teams)", vendorPkg.version === "0.1.14" && vendorPkg.name === "@mpd-dsh/agent-teams"])
  checks.push(["lib + assets + closure present", existsSync(join(VENDOR, "lib", "index.js")) && existsSync(join(VENDOR, "assets", "ui.png")) && existsSync(join(VENDOR, "_deps", "schemastery", "lib", "index.mjs")) && existsSync(join(VENDOR, "_deps", "dsh-tools", "lib", "index.js")) && existsSync(join(VENDOR, "_deps", "dsh-llm", "lib", "index.js")) && existsSync(join(VENDOR, "_deps", "zod", "index.js"))])
  const libHead = readFileSync(join(VENDOR, "lib", "index.js"), "utf8").slice(0, 6000)
  checks.push(["no bare @deepseek-ai/schemastery import", !libHead.includes("from '@deepseek-ai/schemastery'") && libHead.includes("_deps/schemastery/lib/index.mjs")])
  const schemHead = readFileSync(join(VENDOR, "_deps", "schemastery", "lib", "index.mjs"), "utf8").slice(0, 600)
  checks.push(["schemastery cosmo import rewritten", !schemHead.includes('@deepseek-ai/cosmokit') && schemHead.includes("cosmokit/lib/index.js")])
  checks.push(["closure self-contained", !readFileSync(join(VENDOR, "_deps", "dsh-subagent", "lib", "index.js"), "utf8").includes('@deepseek-ai/dsh-tools') && !readFileSync(join(VENDOR, "lib", "index.js"), "utf8").slice(0, 60000).includes('from "@deepseek-ai')])
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  checks.push(["patch row main-code + guard gone", patch.includes("name: '@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js'") && !patch.includes("Self-disabling guard") && !patch.includes("@nanmicoder/dsh-agent-teams'")])
  checks.push(["patch web-compat self-row", patch.includes("id: mpd-web-compat") && patch.includes("name: '@mpd-dsh/mpd'")])
  const pack = readFileSync(join(repoRoot, "scripts", "pack-mpd.mjs"), "utf8")
  checks.push(["pack exports + combined client + no deps entry", pack.includes('"./packages/mpd-bundle-plugin/client.js"') && pack.includes('main: "packages/mpd-bundle-plugin/dist/index.js"') && pack.includes('".": "./packages/mpd-bundle-plugin/dist/index.js"') && pack.includes("agent-teams plugin (MIT provenance") && !pack.includes('dependencies: { "@nanmicoder')])
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) { console.error("[team-route-rewire self-test] FAIL: " + bad.join(" | ")); process.exit(1) }
  if (!existsSync(join(repoRoot, "dist", "mpd-package", "package.json"))) { console.error("[team-route-rewire self-test] FAIL: run node scripts/pack-mpd.mjs first"); process.exit(1) }
  console.log("[team-route-rewire self-test] ok: " + checks.length + " checks + staged bundle present")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[team-route-rewire] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-e", "e4-team-vendor", ts)
  mkdirSync(outDir, { recursive: true })
  const reloc = join(repoRoot, ".qa-reloc")
  mkdirSync(reloc, { recursive: true })
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
  // --store-dir keeps pnpm's store inside the sandbox (the machine's global store
  // may be unwritable under the QA sandbox policy).
  const store = join(reloc, "pnpm-store")
  const add = runSync("dsh", ["plugin", "--profile", "t", "add", "--store-dir", store, staged], { timeout: 600000 })
  steps.install = { ok: add.status === 0, exit: add.status }
  const dump = runSync("dsh", ["--profile", "t", "--dump-config"], { timeout: 120000 })
  const dumpOut = dump.out
  // The QA probe row legitimately names the checkout; mask it so the leak check
  // only fails on a real bundle row carrying a dev path.
  const dumpClean = dumpOut.split(home).join("<QAHOME>").split(join(repoRoot, "packages", "mpd-qa-roles-probe")).join("<QAPROBE>")
  steps.dump = { ok: dump.status === 0 && dumpOut.includes("agent-teams") && dumpOut.includes(".mpd/team") && dumpOut.includes("@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js") && !dumpOut.includes("@nanmicoder/dsh-agent-teams'") && !dumpClean.includes(DEV), exit: dump.status, leaked: dumpClean.includes(DEV) }
  const resCode = "const {createRequire}=require('module');const r=createRequire(process.argv[1]);try{console.log('MAINCODE_OK '+r.resolve('@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/package.json'))}catch(e){console.log('MAINCODE_FAIL '+e.code)};try{r.resolve('@nanmicoder/dsh-agent-teams/package.json');console.log('PKG_PRESENT')}catch(e){console.log('PKG_ABSENT')}"
  const res = runSync("node", ["-e", resCode, join(profile, "x.js")])
  steps.resolution = { ok: res.status === 0 && res.out.includes("MAINCODE_OK") && res.out.includes("PKG_ABSENT"), out: res.out.trim() }
  const installedBundle = join(profile, "node_modules", "@mpd-dsh", "mpd")
  // The headless profile has no stock agent-presets row: insert one rooted at the
  // INSTALLED bundle (bundle-served model — no $DSH_HOME/.agent-presets copy).
  // Deterministic boot proof (no model call: the QA machine has no model key):
  // the QA probe reads the live preset + roster + skill catalog out of the
  // INSTALLED package, so a broken route/row surfaces as a failed boot.
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: mpd\n        roots:\n          - path: " + JSON.stringify(join(installedBundle, "presets")) + "\n            trust: system\n"
    + "    - id: roles-probe\n      name: " + JSON.stringify(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  const live = runSync("dsh", ["--profile", "t", "ok"], { timeout: 600000, cwd: join(reloc, "ws-rewire") })
  const out = live.out
  steps.live = {
    ok: /roles-probe\] PASS/.test(out) && /PRESET_MPD=ok/.test(out)
      && !out.includes("ERR_MODULE_NOT_FOUND") && !out.includes("@nanmicoder") && !/agent-preset\/(not-found|invalid)/.test(out),
    exit: live.status,
  }
  // The installed package is a pnpm link: the provider resolves its own realpath,
  // so accept either the node_modules path or the linked package dir.
  steps.bootstrap = {
    ok: out.includes("mpd-bootstrap")
      && (out.includes(join(installedBundle, "skills")) || out.includes(join(staged, "skills"))),
  }
  // bundle-served: the texts come from the INSTALLED package, and the harness
  // home holds no skills/presets copy at all.
  const texts = [
    join(installedBundle, "skills", "ulw-research", "SKILL.md"),
    join(installedBundle, "skills", "ulw-execute", "SKILL.md"),
    join(installedBundle, "presets", "mpd", "agent.cordis.yml")
  ].filter((p) => existsSync(p)).map((p) => readFileSync(p, "utf8"))
  const allText = texts.join("\n")
  steps.installedTexts = { ok: texts.length === 3 && allText.includes("AGENT.md") && allText.includes("mpd_role_spawn") && allText.includes("agent_teams_create") && !allText.includes("selectable roles"), files: texts.length }
  const homeSkills = join(home, "skills")
  const homePresets = join(home, ".agent-presets")
  steps.noHomeCopy = {
    ok: (!existsSync(homeSkills) || readdirSync(homeSkills).length === 0) && (!existsSync(homePresets) || readdirSync(homePresets).length === 0),
    skills: existsSync(homeSkills) ? readdirSync(homeSkills) : [],
    presets: existsSync(homePresets) ? readdirSync(homePresets) : []
  }
  const webProfile = join(home, "profiles", "w")
  mkdirSync(webProfile, { recursive: true })
  writeFileSync(join(webProfile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  const addWeb = runSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, staged], { timeout: 600000 })
  const port = 3198
  // The route under test is registered by the agent-teams row alone, so the MCP
  // rows are disabled for this boot: a cold LSP daemon + codegraph init can push
  // the first web boot past any sane poll window on a clean sandbox.
  const webOverlay = join(reloc, "web-no-mcp.yml")
  writeFileSync(webOverlay, ["mcp-astgrep", "mcp-gitbash", "mcp-lsp", "mcp-codegraph", "mcp-context7", "mcp-grepapp"]
    .map((id) => "- id: " + id + "\n  disabled: true").join("\n") + "\n")
  const webLog = join(outDir, "web.log")
  const webFd = openSync(webLog, "w")
  const web = spawn("dsh", ["--profile", "w", "--patch", webOverlay, "--port", String(port), "--no-open"], { env, cwd: join(reloc, "ws-rewire"), detached: false, stdio: ["ignore", webFd, webFd] })
  let routeOk = false, routeStatus = null
  const t0 = Date.now()
  // Cold web boots in this sandbox (MCP servers + LSP daemon + client modules)
  // have been observed past two minutes; the poll is generous on purpose.
  while (Date.now() - t0 < 240000) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/plugins/dsh-agent-teams/state", { signal: AbortSignal.timeout(4000) })
      routeStatus = res.status
      await res.text()
      // The web app listens before the client plugin mounts its routes, so a
      // non-200 answer is "not ready yet", not a verdict: keep polling.
      if (res.status === 200) { routeOk = true; break }
    } catch { /* not up yet */ }
  }
  web.kill("SIGTERM")
  try { await new Promise((r) => setTimeout(r, 1500)) } catch {}
  steps.webRoute = { ok: addWeb.status === 0 && routeOk, status: routeStatus, addExit: addWeb.status }
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
