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
// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.mjs
import { spawnSync, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const DEV = process.env.MPD_DEV_ROOT || repoRoot
const VENDOR = join(repoRoot, "packages", "mpd-agent-teams-plugin")

const SLUG = "team-route-rewire"
const PACK = join(repoRoot, "dist", "mpd-package", "package.json")
const PACK_PREREQ = { reason: "absent-staged-pack", prereq: "dist/mpd-package/package.json", remedy: "node scripts/pack-mpd.mjs" }
// Both strict spellings are normative (x2 v2 §6.5): the generic name and the case-specific name.
const STRICT = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

/** AM1 (x2 v2 §7): a positive probe of the exact prerequisite. The ONLY skippable prerequisite
 *  of this case is the staged pack (§3.3): credentials are NOT part of the skip set and keep
 *  their existing loud failure. */
function absentPrereq() {
  return existsSync(PACK) ? null : PACK_PREREQ
}

/** SKIP (exit 0) or, under either strict flag, FAIL (exit 1) — the same field values in both
 *  modes (AM2). The canonical marker is the FIRST stdout line (§4); human prose follows on
 *  stdout for a SKIP and on stderr for a FAIL. Called AFTER the prerequisite-independent
 *  offline checks (AM3b) and BEFORE the non-skippable credentials check. */
function gate(lane) {
  const p = absentPrereq()
  if (p === null) return
  console.log(`[mpd-qa] ${STRICT ? "FAIL" : "SKIP"} case=${SLUG} lane=${lane} reason=${p.reason} prereq=${p.prereq} remedy="${p.remedy}"`)
  const prose = `[${SLUG}] staged package absent at ${p.prereq}; ${STRICT ? "failing (strict flag)" : "skipping (not a failure)"}`
  if (STRICT) console.error(prose)
  else console.log(prose)
  process.exit(STRICT ? 1 : 0)
}

/** A pack that is PRESENT must also be USABLE (x2 v2 §7 AM3: "present but broken is always a
 *  FAIL, in every mode, with or without --no-skip"). The offline self-test cannot run the real
 *  `dsh plugin add` lane, so this is the strongest check it can honestly make: the staged tree
 *  must parse and carry the bundle identity the patch row resolves against. Without it the
 *  assertion was vacuous — a bare existsSync on package.json passed even for a garbage file,
 *  and the success line still claimed "staged bundle present" (measured 2026-09-13: this exact
 *  case exited 0 on a pack whose package.json was `name: broken`). */
function packUsable() {
  if (!existsSync(PACK)) return { ok: true, why: "absent (handled by the skip gate)" }
  let manifest = null
  try { manifest = JSON.parse(readFileSync(PACK, "utf8")) } catch (error) {
    return { ok: false, why: "package.json is not valid JSON: " + error.message }
  }
  if (manifest?.name !== "@mpd-dsh/mpd") return { ok: false, why: "package.json name is " + JSON.stringify(manifest?.name) + ", expected \"@mpd-dsh/mpd\"" }
  const patch = join(repoRoot, "dist", "mpd-package", "cordis.patch.yml")
  if (!existsSync(patch)) return { ok: false, why: "cordis.patch.yml is missing from the staged pack" }
  if (!readFileSync(patch, "utf8").includes("mpd-web-compat")) return { ok: false, why: "cordis.patch.yml carries no mpd-web-compat row (the client entry the bundle needs)" }
  const client = join(repoRoot, "dist", "mpd-package", "packages", "mpd-bundle-plugin", "client.js")
  if (!existsSync(client)) return { ok: false, why: "packages/mpd-bundle-plugin/client.js is missing from the staged pack" }
  return { ok: true, why: "parses and carries the bundle identity" }
}

function selfTest() {
  const checks = []
  const mpdPreset = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
  const execute = readFileSync(join(repoRoot, "skills", "ulw-execute", "SKILL.md"), "utf8")
  const research = readFileSync(join(repoRoot, "skills", "ulw-research", "SKILL.md"), "utf8")
  checks.push(["mpd preset AGENT.md candidates", mpdPreset.includes("AGENT.md") && mpdPreset.includes("AGENTS.md") && mpdPreset.includes("instructionFileCandidates")])
  checks.push(["mpd preset: roster spawn + agent-teams team, no bespoke team", mpdPreset.includes("mpd_role_spawn") && mpdPreset.includes("agent_teams_create") && !mpdPreset.includes("mpd_team_spawn")])
  checks.push(["ulw-execute row: roster + agent-teams team, no bespoke team", execute.includes("mpd_role_spawn") && execute.includes("agent_teams_create") && !execute.includes("mpd_team_spawn")])
  checks.push(["ulw-research row: roster + agent-teams team, no bespoke team", research.includes("mpd_role_spawn") && research.includes("agent_teams_create") && research.includes("profile=\"mpd\"") && !research.includes("mpd_team_spawn") && !research.includes("selectable roles")])
  const vendorPkg = JSON.parse(readFileSync(join(VENDOR, "package.json"), "utf8"))
  checks.push(["main-code package 0.1.16-rc.3-mpd (renamed @mpd-dsh/agent-teams)", vendorPkg.version === "0.1.16-rc.3-mpd" && vendorPkg.name === "@mpd-dsh/agent-teams"])
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
  // AM3: a PRESENT pack must be USABLE — without this the assertion was vacuous and the
  // success line still claimed "staged bundle present" off a bare existsSync.
  const packUsableResult = packUsable()
  checks.push(["staged pack present and usable (AM3)", packUsableResult.ok])
  if (!packUsableResult.ok) console.error("[" + SLUG + "] staged pack unusable: " + packUsableResult.why)
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) { console.error("[team-route-rewire self-test] FAIL: " + bad.join(" | ")); process.exit(1) }
  gate("self-test")
  console.log("[team-route-rewire self-test] ok: " + checks.length + " checks; staged pack usable")
}

async function runReal() {
  gate("real")
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
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(home, "settings.yaml"))
  mkdirSync(join(reloc, "ws-rewire"), { recursive: true })
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  const userHome = join(reloc, "userhome-rewire")
  mkdirSync(userHome, { recursive: true })
  const env = { ...process.env, DSH_HOME: home, HOME: userHome }
  if (env.DSH_HOME !== home || env.HOME !== userHome) { console.error("[team-route-rewire] isolation assertion failed"); process.exit(1) }
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
  let routeOk = false, routeStatus = null, cookie = null, authExchange = 0
  const t0 = Date.now()
  // Cold web boots in this sandbox (MCP servers + LSP daemon + client modules)
  // have been observed past two minutes; the poll is generous on purpose.
  // The host authenticates EVERY non-static route through a browser session
  // (`dsh-client-connection`): the process launch token is accepted ONLY on `GET /`,
  // which mints an authority-bound signed cookie, so a bare route GET answers 401
  // (measured 2026-09-14: the case's old expectation of an unauthenticated 200 was
  // stale against the installed harness). Exchange the token from the boot log once,
  // then poll the route WITH the cookie.
  while (Date.now() - t0 < 240000) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      if (cookie === null) {
        const token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(webLog, "utf8"))?.[1]
        if (token === undefined) continue
        const root = await fetch("http://127.0.0.1:" + port + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(4000) })
        const setCookies = typeof root.headers.getSetCookie === "function" ? root.headers.getSetCookie() : []
        cookie = String(setCookies[0] ?? root.headers.get("set-cookie") ?? "").split(";")[0] || ""
        authExchange = root.status
        await root.text()
        continue
      }
      const res = await fetch("http://127.0.0.1:" + port + "/plugins/dsh-agent-teams/state", { headers: { cookie }, signal: AbortSignal.timeout(4000) })
      routeStatus = res.status
      await res.text()
      // The web app listens before the client plugin mounts its routes, so a
      // non-200 answer is "not ready yet", not a verdict: keep polling.
      if (res.status === 200) { routeOk = true; break }
    } catch { /* not up yet */ }
  }
  web.kill("SIGTERM")
  try { await new Promise((r) => setTimeout(r, 1500)) } catch {}
  steps.webRoute = { ok: addWeb.status === 0 && routeOk && cookie !== null, status: routeStatus, authExchange, cookieMinted: cookie !== null && cookie !== "", addExit: addWeb.status }
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
