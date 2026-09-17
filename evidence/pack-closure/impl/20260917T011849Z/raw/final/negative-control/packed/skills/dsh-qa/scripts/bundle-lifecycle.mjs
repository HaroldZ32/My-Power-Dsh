#!/usr/bin/env node
// Case bundle-lifecycle: prove @mpd-dsh/mpd installs and uninstalls as ONE unit,
// skills included, with no residue in the harness home — and that the install is
// ONE command straight from the checkout (`dsh plugin add <repo>`), with no
// separate pack/build step.
//   1) offline self-test: the repo-root manifest IS the bundle (dsh.bundle.patch +
//      dsh.client + exports), the patch ships the bundle-served preset root, the
//      provisioning row registers a skill provider (no copy), pnpm is available;
//   2) real install through the OFFICIAL flow — `dsh plugin add <repo root>` into an
//      isolated profile: the dependency lands (link:<repo>) AND the bundle joins
//      dsh.profile.bundles; no pack-mpd run happens anywhere in this case;
//   3) real boot (web, sandboxed DSH_HOME + HOME) with the QA preset probe: the
//      mpd preset resolves FROM THE INSTALLED BUNDLE, the skill corpus is served
//      from the installed bundle, the adapter surface answers, and $DSH_HOME holds
//      NO skills/presets copy;
//   4) real uninstall — `dsh plugin remove`: dependency, bundle entry, installed
//      tree and the composed rows all go away, the stock preset row returns, and
//      the harness home + HOME keep no bundle residue.
// Evidence -> evidence/dsh-qa/bundle-lifecycle/<ts>/. Never touches the real ~/.dsh.
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PKG = "@mpd-dsh/mpd"
const PORT = 3197
const PROBE = join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")

function fail(message) { console.error("[bundle-lifecycle] FAIL: " + message); process.exit(1) }

function selfTest() {
  // The installable unit is the REPO ROOT manifest itself: no pack step is used
  // or required by this case.
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  if (rootManifest.name !== PKG) fail("self-test: repo root package must be named " + PKG + " (got " + String(rootManifest.name) + ")")
  if (rootManifest.dsh?.bundle?.patch !== "./packages/mpd-bundle/cordis.patch.yml") fail("self-test: repo root must declare dsh.bundle.patch")
  if (rootManifest.dsh?.client?.platform !== "web") fail("self-test: repo root must declare dsh.client (web)")
  for (const key of [".", "./packages/*", "./skills/*", "./presets/*", "./client"]) {
    if (rootManifest.exports?.[key] === undefined) fail("self-test: repo root exports missing " + key)
  }
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!/^- id: agent-presets$/m.test(patch) || !patch.includes("default: mpd")) fail("self-test: bundle-served preset row missing from the patch")
  if (!patch.includes('"/node_modules/@mpd-dsh/mpd/presets"')) fail("self-test: preset root expression missing from the patch")
  if (!patch.includes("id: mpd-bootstrap")) fail("self-test: mpd-bootstrap row missing from the patch")
  if (!patch.includes("id: mpd-dsh-adapter")) fail("self-test: mpd-dsh-adapter row missing from the patch")
  if (!existsSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"))) fail("self-test: repo-root presets/mpd missing")
  if (!existsSync(join(repoRoot, "skills", "svn-master", "SKILL.md"))) fail("self-test: repo-root skills corpus missing")
  const adapterDist = readFileSync(join(repoRoot, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"), "utf8")
  if (!adapterDist.includes("createDshAdapter") || !adapterDist.includes("registerTool")) fail("self-test: adapter dist missing its tool-plane surface")
  const dist = readFileSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "dist", "index.js"), "utf8")
  if (!dist.includes("registerProvider") || dist.includes("syncTree")) fail("self-test: mpd-bootstrap must serve the corpus (registerProvider), not copy it")
  if (!existsSync(PROBE)) fail("self-test: roles probe dist missing (bun build first)")
  if (spawnSync("pnpm", ["--version"], { encoding: "utf8" }).status !== 0) fail("self-test: pnpm is required for the official install flow")
  console.log("[bundle-lifecycle self-test] ok: repo root IS the bundle + bundle-served preset row + provider wiring + probe + pnpm")
}

function runSync(cmd, args, env, opts = {}) {
  const result = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 600000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
  return { status: result.status, out: (result.stdout || "") + (result.stderr || "") }
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials")
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "dsh-qa", "bundle-lifecycle", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = join(repoRoot, ".qa-reloc", "bundle-lifecycle-" + ts)
  const home = join(sandbox, "home")            // DSH_HOME
  const userHome = join(sandbox, "userhome")    // HOME (workmate library isolation)
  const store = join(sandbox, "pnpm-store")
  const profile = join(home, "profiles", "w")
  mkdirSync(profile, { recursive: true })
  mkdirSync(userHome, { recursive: true })
  cpSync(creds, join(home, ".credentials.yaml"))
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(home, "settings.yaml"))
  const env = { ...process.env, DSH_HOME: home, HOME: userHome }
  const probePatch = join(sandbox, "probe.yml")
  // The probe overlay adds only the QA probe; the boot carries the FULL bundle
  // (every row enabled), so the evidence also proves the whole unit boots.
  writeFileSync(probePatch, "- insert:\n    - id: roles-probe\n      name: " + JSON.stringify(PROBE) + "\n")
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  const steps = {}

  // ── 2) ONE-COMMAND install straight from the checkout ──────────────────────
  // No `node scripts/pack-mpd.mjs` anywhere: the repo root IS the bundle package.
  const add = runSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, repoRoot], env)
  const manifestAfterAdd = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  const installedBundle = join(profile, "node_modules", PKG)
  const bundlesAfterAdd = manifestAfterAdd.dsh?.profile?.bundles ?? []
  steps.install = {
    ok: add.status === 0 && String(manifestAfterAdd.dependencies?.[PKG] ?? "").startsWith("link:")
      && bundlesAfterAdd.includes(PKG) && existsSync(installedBundle)
      // the box bundles are NOT profile dependencies, so the layer list must only
      // ever be APPENDED to. A reconcile that recomputes the list from the
      // dependency set silently drops the base layers — the defect this asserts.
      && ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"].every((layer) => bundlesAfterAdd.includes(layer)),
    exit: add.status,
    dependency: manifestAfterAdd.dependencies?.[PKG] ?? null,
    bundles: bundlesAfterAdd,
    oneCommand: "dsh plugin --profile w add <repo root>",
  }
  if (!steps.install.ok) fail("install step failed: " + add.out.slice(-1500))
  // The composed tree is part of the unit too: every bundle row lands at once.
  const dumpAfterInstall = runSync("dsh", ["--profile", "w", "--dump-config"], env)
  const composed = dumpAfterInstall.out
  steps.composed = {
    ok: dumpAfterInstall.status === 0
      && ["mpd-dsh-adapter", "mpd-bootstrap", "mpd-web-compat", "mpd-tools", "mpd-roles", "mpd-workmate", "agent-teams", "mcp-astgrep"].every((id) => composed.includes("id: " + id))
      && composed.includes("id: agent-presets") && composed.includes("default: mpd")
      && composed.includes('"/node_modules/@mpd-dsh/mpd/presets"'),
    exit: dumpAfterInstall.status,
  }

  // ── 3) real boot: preset + corpus served from the installed bundle ─────────
  const bootLog = join(outDir, "boot.log")
  const fd = openSync(bootLog, "w")
  const web = spawn("dsh", ["--profile", "w", "--patch", probePatch, "--port", String(PORT), "--no-open"], { env, cwd: sandbox, detached: false, stdio: ["ignore", fd, fd] })
  let up = false
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      // A bundle-owned plugin route answers without the session token (the root
      // page requires the `?token=` the boot log prints).
      const response = await fetch("http://127.0.0.1:" + PORT + "/plugins/mpd-workmate/list", { signal: AbortSignal.timeout(4000) })
      if (response.status === 200) { up = true; await response.text(); break }
    } catch { /* not up yet */ }
  }
  web.kill("SIGTERM")
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const boot = readFileSync(bootLog, "utf8")
  // The installed package is a pnpm link, so the plugin's own location resolves to
  // the real package dir while the preset roster keeps the node_modules path —
  // both must point INTO the installed bundle.
  const bundleReal = realpathSync(installedBundle)
  const served = /\[mpd-bootstrap\] skill corpus served from ([^\s]+) \(provider mpd-bundle/.exec(boot)
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(boot)
  const corpusPath = String(served?.[1] ?? "")
  const presetFile = String(presetPath?.[1] ?? "")
  const seams = /ADAPTER_SEAMS=([^\s]+)/.exec(boot)?.[1] ?? ""
  steps.boot = {
    ok: up && /roles-probe\] PASS/.test(boot) && /PRESET_MPD=ok/.test(boot)
      && /\[mpd-dsh-adapter\] mpdDsh provided/.test(boot)
      && seams.includes("toolsRegister") && seams.includes("subagentsSpawn") && seams.includes("skillsProvider")
      && /ADAPTER_TOOL_CALL=ok/.test(boot)
      && corpusPath.startsWith(bundleReal)
      && (presetFile.startsWith(bundleReal) || presetFile.includes(join("node_modules", "@mpd-dsh", "mpd", "presets")))
      && presetPath?.[2] === "system",
    http: up, corpus: served?.[1] ?? null, preset: presetPath?.[1] ?? null, trust: presetPath?.[2] ?? null, bundleReal,
    adapterSeams: seams || null,
  }
  const homeSkills = join(home, "skills")
  const homePresets = join(home, ".agent-presets")
  steps.noHomeCopy = {
    ok: (!existsSync(homeSkills) || readdirSync(homeSkills).length === 0) && (!existsSync(homePresets) || readdirSync(homePresets).length === 0),
    skills: existsSync(homeSkills) ? readdirSync(homeSkills) : [],
    presets: existsSync(homePresets) ? readdirSync(homePresets) : [],
  }

  // ── 3b) the layer survives an unrelated install in the SAME profile ────────
  // The profile is a pnpm project: a manifest that no longer lists the bundle
  // loses it on the next install, and `dsh plugin` never re-adds a layer on its
  // own. This is the shape of the reported defect (our rows gone after another
  // dependency was installed), so the case asserts the layer is still composed.
  const plainInstall = runSync("pnpm", ["install", "--prefer-offline", "--store-dir", store], env, { cwd: profile })
  const manifestAfterPlain = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  const dumpAfterPlain = runSync("dsh", ["--profile", "w", "--dump-config"], env)
  steps.layerDurability = {
    ok: plainInstall.status === 0
      && manifestAfterPlain.dependencies?.[PKG] !== undefined
      && (manifestAfterPlain.dsh?.profile?.bundles ?? []).includes(PKG)
      && dumpAfterPlain.out.includes("id: mpd-dsh-adapter")
      && dumpAfterPlain.out.includes("id: agent-presets")
      && dumpAfterPlain.out.includes('"/node_modules/@mpd-dsh/mpd/presets"'),
    exit: plainInstall.status,
    dependency: typeof manifestAfterPlain.dependencies?.[PKG] === "string",
    bundles: manifestAfterPlain.dsh?.profile?.bundles ?? [],
  }

  // ── 4) real uninstall: everything goes, nothing is left behind ─────────────
  const remove = runSync("dsh", ["plugin", "--profile", "w", "remove", "--store-dir", store, PKG], env)
  const manifestAfterRemove = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  const dumpAfter = runSync("dsh", ["--profile", "w", "--dump-config"], env)
  const residue = []
  for (const candidate of [join(home, "skills"), join(home, ".agent-presets"), join(profile, "node_modules", "@mpd-dsh"), installedBundle]) {
    if (existsSync(candidate)) residue.push(candidate)
  }
  const mpdState = join(userHome, ".mpd")
  const mpdStateEntries = existsSync(mpdState) ? readdirSync(mpdState) : []
  steps.uninstall = {
    ok: remove.status === 0
      && manifestAfterRemove.dependencies?.[PKG] === undefined
      && !(manifestAfterRemove.dsh?.profile?.bundles ?? []).includes(PKG)
      && !dumpAfter.out.includes("id: mpd-bootstrap")
      && !dumpAfter.out.includes("id: mpd-dsh-adapter")
      && !dumpAfter.out.includes("id: mpd-web-compat")
      && /default: standard/.test(dumpAfter.out)
      && residue.length === 0
      && mpdStateEntries.length === 0,
    exit: remove.status,
    bundles: manifestAfterRemove.dsh?.profile?.bundles ?? [],
    residue,
    mpdState: mpdStateEntries,
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: Object.values(steps).every((step) => step.ok), sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), ["--- install ---", add.out.slice(-4000), "--- boot ---", boot.slice(0, 20000), "--- remove ---", remove.out.slice(-4000)].join("\n"))
  console.log("[bundle-lifecycle] ok=" + Object.values(steps).every((step) => step.ok) + " -> " + outDir)
  for (const [name, step] of Object.entries(steps)) console.log("  " + name + ": " + JSON.stringify(step).slice(0, 260))
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best-effort scratch cleanup */ }
  if (!Object.values(steps).every((step) => step.ok)) process.exit(1)
  console.log("[bundle-lifecycle] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
