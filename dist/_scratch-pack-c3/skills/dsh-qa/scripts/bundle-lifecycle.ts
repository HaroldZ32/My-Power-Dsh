#!/usr/bin/env node
// Case bundle-lifecycle: prove @mpd-dsh/mpd installs and uninstalls as ONE unit,
// skills included, with no residue in the harness home — and that the install is
// ONE command straight from the checkout (`dsh plugin add <repo>`), with no
// separate pack/build step.
//   1) offline self-test: the repo-root manifest IS the bundle (dsh.bundle.patch +
//      dsh.client + exports), the main patch carries the SHIPPED preset-selection
//      contract (no `agent-preset-registry` id-target — a HOST-owned id — and no
//      row on the retired preset-ROOT package) while the preset patch still ships
//      the `mpd` composition as an ADDITIVE row, the provisioning row registers a
//      skill provider (no copy), pnpm is available;
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
import { credentialEnv, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import { DSH_MISSING, dshAppSpec, resolveOnPath, spawnSpec } from "./lib/dsh-launcher.ts"

/** The wrapper's `--json` envelope's `stdout` field, or the raw text when the wrapper printed none. */
const dumpJsonText = (text: string): string => { try { return JSON.parse(text).stdout ?? "" } catch { return String(text ?? "") } }
/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The bundle package name the repo root's manifest must carry. */
const PKG = "@mpd-dsh/mpd"
/** The fixed port the sandboxed web boot listens on; the poll below targets it. */
const PORT = 3197
/** The built QA roles probe the boot overlay mounts, at its absolute checkout path. */
const PROBE = join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")

/** Report a failed assertion and stop the process with a non-zero status. */
function fail(message: string): never { console.error("[bundle-lifecycle] FAIL: " + message); process.exit(1) }

/** The repo-root manifest fields the offline arm inspects; a field is optional so a MISSING
 *  value fails a check instead of crashing the reader. */
interface RootManifestFields {
  /** The package name, asserted to equal the bundle package name. */
  name?: string
  /** The harness install metadata declared by the manifest. */
  dsh?: {
    /** The bundle layer declaration: an ARRAY of patch files in 0.1.7-rc.2. */
    bundle?: { patch?: readonly string[] }
    /** The client plane declaration, which must name `web`. */
    client?: { platform?: string }
  }
  /** The subpath export map the loader resolves rows through. */
  exports?: Record<string, unknown>
}

/** The sandbox profile manifest fields this case rewrites and re-reads between steps. */
interface ProfileManifestFields {
  /** The profile's dependency map; the bundle must appear there as a `link:` entry. */
  dependencies?: Record<string, unknown>
  /** The harness profile section that lists the composed bundle layers. */
  dsh?: { profile?: { bundles?: string[] } }
}

/** The outcome of one synchronous child run: the exit status and the captured output. */
interface RunOutcome {
  /** The child's exit status, or `null` when it never ran (no launcher) or was signalled. */
  readonly status: number | null
  /** stdout and stderr concatenated, which is what the failure messages print. */
  readonly out: string
  /** stdout alone, for callers that parse a JSON envelope off it. */
  readonly stdout: string
}

/** Execution overrides for one child run; an unset field takes the case's own default. */
interface RunSyncOptions {
  /** Hard timeout in milliseconds; defaults to ten minutes. */
  readonly timeout?: number
  /** Working directory for the child; defaults to the repository root. */
  readonly cwd?: string
}

/** One asserted step of this case: the verdict plus the evidence fields the run reported for it. */
interface CaseStep {
  /** Whether this step's assertion held; every step's flag is folded into the final verdict. */
  readonly ok: boolean
  /** Any further evidence this step reports (exit status, dependency spec, counts, paths). */
  readonly [field: string]: unknown
}

/** One leg of the shipped preset-selection contract that does not hold over the bytes it was given. */
interface PresetContractViolation {
  /** Which leg broke: the host-owned id-target, the retired preset-ROOT package, or the additive preset row. */
  readonly leg: "id-target" | "retired-package" | "preset-row"
  /** The one-line reason, printed verbatim when the leg is violated. */
  readonly reason: string
}

/**
 * The SHIPPED preset-selection contract, as a pure predicate over patch TEXT so the
 * self-test can drive it with a deliberately broken copy (the three negative
 * controls below). Pure on purpose: the check it replaced read the two files
 * itself, so nothing could prove the check was able to fail.
 *
 * WHAT WOULD REDDEN IT NOW, leg by leg: (a) re-adding `- id: agent-preset-registry`
 * at column 0 to `cordis.patch.yml`; (b) re-adding a row whose `name:` is
 * `@deepseek-ai/dsh-agent-presets`; (c) dropping `id: preset-mpd`,
 * `name: '@deepseek-ai/dsh-agent-preset'` or `config.id: mpd` from the preset
 * patch. Leg (a) is the RETIRED expectation this case used to demand: `9e91beb3`
 * ("one adapter per plane, zero host overrides", 2026-10-03) removed that
 * id-target under the strict zero-override decision, because `agent-preset-registry`
 * is declared by a HOST layer (`@deepseek-ai/dsh-web-app`) and an id-target would
 * REPLACE the host's `default: standard`. Making `mpd` the deployment default is a
 * USER action (`docs/preset-default.md`), never a shipped override — and
 * `scripts/verify-no-host-override.ts` fails the build on any row that tries.
 *
 * @param mainPatch The bytes of the main bundle patch (`cordis.patch.yml`).
 * @param presetPatch The bytes of the declared preset patch (`presets/mpd.patch.yml`).
 * @returns One entry per violated leg, in contract order; an empty list means it holds.
 */
function presetContractViolations(mainPatch: string, presetPatch: string): PresetContractViolation[] {
  /** Every leg that does not hold, in the order the contract lists them. */
  const violations: PresetContractViolation[] = []
  if (/^- id: agent-preset-registry$/m.test(mainPatch)) {
    violations.push({ leg: "id-target", reason: "the main patch id-targets `agent-preset-registry` at column 0 — a HOST-owned id; this bundle is additive-only (docs/preset-default.md)" })
  }
  if (/^\s*name: '@deepseek-ai\/dsh-agent-presets'\s*$/m.test(mainPatch)) {
    violations.push({ leg: "retired-package", reason: "the main patch still declares a row on the retired @deepseek-ai/dsh-agent-presets package" })
  }
  if (!/id: preset-mpd$/m.test(presetPatch) || !/name: '@deepseek-ai\/dsh-agent-preset'$/m.test(presetPatch) || !/^\s+id: mpd$/m.test(presetPatch)) {
    violations.push({ leg: "preset-row", reason: "the preset patch must declare a `preset-mpd` row on '@deepseek-ai/dsh-agent-preset' with config.id: mpd" })
  }
  return violations
}

/** The offline arm: proves the repo-root manifest IS the bundle and that its declared assets exist. */
function selfTest(): void {
  // The installable unit is the REPO ROOT manifest itself: no pack step is used
  // or required by this case.
  /** The repo-root manifest, the one installable unit this case treats as the bundle. */
  const rootManifest: RootManifestFields = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  if (rootManifest.name !== PKG) fail("self-test: repo root package must be named " + PKG + " (got " + String(rootManifest.name) + ")")
  // 0.1.7-rc.2: `dsh.bundle.patch` is an ARRAY (the shipped-preset shape) — the
  // main bundle patch plus the preset patch that declares the `preset-mpd` row.
  /** The declared bundle patch files, whose element type the runtime check below establishes. */
  const declaredPatches = rootManifest.dsh?.bundle?.patch
  if (!Array.isArray(declaredPatches) || declaredPatches.length < 2) {
    fail("self-test: repo root dsh.bundle.patch must be an ARRAY of the main patch AND the preset patch (got " + JSON.stringify(declaredPatches) + ")")
  }
  for (const entry of declaredPatches) {
    if (typeof entry !== "string" || !existsSync(join(repoRoot, entry))) fail("self-test: declared bundle patch missing on disk: " + String(entry))
  }
  if (rootManifest.dsh?.client?.platform !== "web") fail("self-test: repo root must declare dsh.client (web)")
  for (const key of [".", "./packages/*", "./skills/*", "./presets/*", "./client"]) {
    if (rootManifest.exports?.[key] === undefined) fail("self-test: repo root exports missing " + key)
  }
  /** The main bundle patch, whose rows and provider wiring are asserted below. */
  const patch = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  // The preset patch is the declared patch that is not the main one; it is read HERE
  // (before the rows below) because the contract predicate takes both byte strings.
  /** The declared patch that is not the main bundle patch: the preset patch, by elimination. */
  const presetPatchEntry = declaredPatches.find((entry) => entry !== "./cordis.patch.yml")
  /** The preset patch's bytes, read to prove it declares the preset ROW. */
  const presetPatch = readFileSync(join(repoRoot, presetPatchEntry), "utf8")
  // THE SHIPPED CONTRACT, and the reason this arm is not merely a re-statement of the
  // patch: the same predicate is driven with three broken copies below, so a contract
  // that stopped being checked here would show up as a control that no longer reddens.
  /** The legs of the shipped preset-selection contract the real bytes violate; empty on a healthy tree. */
  const contractViolations = presetContractViolations(patch, presetPatch)
  if (contractViolations.length > 0) fail("self-test: " + contractViolations.map((entry) => "[" + entry.leg + "] " + entry.reason).join("; "))
  // NEGATIVE CONTROLS (the falsifier): each leg must go RED on a copy that breaks
  // exactly that leg, or the check above proves nothing.
  /** Control A replays the RETIRED expectation, the id-target this case used to demand. */
  const controlIdTarget = presetContractViolations("- id: agent-preset-registry\n  name: '@deepseek-ai/dsh-agent-preset-registry'\n  config:\n    default: mpd\n" + patch, presetPatch)
  if (!controlIdTarget.some((entry) => entry.leg === "id-target")) fail("self-test control: re-adding `- id: agent-preset-registry` at column 0 must redden the contract check")
  /** Control B brings the retired preset-ROOT package back as a ROW (a mention in a comment is not a row). */
  const controlRetiredRow = presetContractViolations(patch + "\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n", presetPatch)
  if (!controlRetiredRow.some((entry) => entry.leg === "retired-package")) fail("self-test control: a row on the retired @deepseek-ai/dsh-agent-presets package must redden the contract check")
  /** Control C drops the additive row's `config.id`, the half of the contract that must SURVIVE. */
  const controlPresetRow = presetContractViolations(patch, presetPatch.replace(/^\s+id: mpd\s*$/m, "        id: mpd-renamed"))
  if (!controlPresetRow.some((entry) => entry.leg === "preset-row")) fail("self-test control: a preset row without `config.id: mpd` must redden the contract check")
  if (!patch.includes("id: mpd-bootstrap")) fail("self-test: mpd-bootstrap row missing from the patch")
  if (!patch.includes("id: mpd-dsh-adapter")) fail("self-test: mpd-dsh-adapter row missing from the patch")
  // The official Agent Teams rows (mpd-owned ids, official package names).
  for (const row of ["mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team"]) {
    if (!patch.includes("id: " + row)) fail("self-test: official agent-team row missing from the patch: " + row)
  }
  // The preset patch also carries the inline child list the loader reads.
  if (!/^\s+plugins:$/m.test(presetPatch)) fail("self-test: the preset patch declares no inline `plugins:` child list")
  if (!existsSync(join(repoRoot, "presets", "mpd.patch.yml"))) fail("self-test: repo-root presets/mpd.patch.yml missing")
  if (!existsSync(join(repoRoot, "skills", "svn-master", "SKILL.md"))) fail("self-test: repo-root skills corpus missing")
  /** The built adapter dist, whose tool-plane surface the boot relies on. */
  const adapterDist = readFileSync(join(repoRoot, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"), "utf8")
  if (!adapterDist.includes("createDshAdapter") || !adapterDist.includes("registerTool")) fail("self-test: adapter dist missing its tool-plane surface")
  /** The built provisioning dist, which must SERVE the corpus instead of copying it. */
  const dist = readFileSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "dist", "index.js"), "utf8")
  if (!dist.includes("registerProvider") || dist.includes("syncTree")) fail("self-test: mpd-bootstrap must serve the corpus (registerProvider), not copy it")
  if (!existsSync(PROBE)) fail("self-test: roles probe dist missing (bun build first)")
  /** The resolved `pnpm` invocation, which the official install flow requires on PATH. */
  const pnpmProbe = spawnSpec("pnpm", ["--version"])
  if (spawnSync(pnpmProbe.command, pnpmProbe.args, { encoding: "utf8" }).status !== 0) fail("self-test: pnpm is required for the official install flow")
  console.log("[bundle-lifecycle self-test] ok: repo root IS the bundle + array dsh.bundle.patch (" + declaredPatches.length + " patch files) + preset-selection contract (NO host-owned agent-preset-registry id-target, no retired preset-ROOT row, preset-mpd row with config.id: mpd; 3 negative controls redden) + provider wiring + probe + pnpm")
}

/** Run one child synchronously with this case's defaults (ten minutes, repo-root cwd, no stdin). */
function runSync(cmd: string, args: string[], env: Env, opts: RunSyncOptions = {}): RunOutcome {
  // EVERY bare name is resolved (not just `dsh`): `pnpm` is a `.cmd` shim on win32 too, and node
  // refuses to exec a command script without a shell (measured 2026-09-22).
  if (cmd === "dsh" && resolveOnPath("dsh", env) === "") return { status: null, out: DSH_MISSING, stdout: "" }
  /** The `{command, args}` pair to spawn: the resolved launcher for `"dsh"`, the call as given otherwise. */
  const spec = spawnSpec(cmd, args, env)
  /** The completed child process; `spawnSync` reports a missing binary instead of throwing. */
  const result = spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 600000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
  return { status: result.status, out: (result.stdout || "") + (result.stderr || ""), stdout: result.stdout || "" }
}

/** The live arm: install, boot, re-install and uninstall the bundle in one isolated profile. */
async function runReal(): Promise<void> {
  /** The real home's credential file, copied ONCE into the sandbox and never read again. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials")
  /** The run stamp that names the evidence directory (ISO time with `:` replaced, so it is path-safe). */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes `result.json` and `output.log` into. */
  const outDir = join(repoRoot, "evidence", "dsh-qa", "bundle-lifecycle", ts)
  mkdirSync(outDir, { recursive: true })
  /** The scratch root holding the sandbox home, the user home and the pnpm store. */
  const sandbox = join(repoRoot, ".qa-reloc", "bundle-lifecycle-" + ts)
  /** The sandbox `DSH_HOME` the bundle is installed into. */
  const home = join(sandbox, "home")            // DSH_HOME
  /** The sandbox `HOME` that keeps the workmate library out of the real home. */
  const userHome = join(sandbox, "userhome")    // HOME (workmate library isolation)
  /** The pnpm store inside the sandbox, so the install writes nothing outside it. */
  const store = join(sandbox, "pnpm-store")
  /** The isolated harness profile (`w`) the whole lifecycle runs against. */
  const profile = join(home, "profiles", "w")
  mkdirSync(profile, { recursive: true })
  mkdirSync(userHome, { recursive: true })
  seedSandboxCredentials(home, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  /** The real home's model-chain settings, staged only when the host has one. */
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(home, "settings.yaml"))
  /** The sandboxed environment every child of this case inherits (sandbox credentials only). */
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: home, HOME: userHome  })
  /** The probe overlay written into the sandbox, mounting ONLY the QA roles probe. */
  const probePatch = join(sandbox, "probe.yml")
  // The probe overlay adds only the QA probe; the boot carries the FULL bundle
  // (every row enabled), so the evidence also proves the whole unit boots.
  writeFileSync(probePatch, "- insert:\n    - id: roles-probe\n      name: " + JSON.stringify(PROBE) + "\n")
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  /** Per-step verdicts, keyed by step name, serialised straight into `result.json`. */
  const steps: Record<string, CaseStep> = {}

  // ── 2) ONE-COMMAND install straight from the checkout ──────────────────────
  // No `node scripts/pack-mpd.ts` anywhere: the repo root IS the bundle package.
  /** The ONE-command install: `dsh plugin add <repo root>` into the sandbox profile. */
  const add = runSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, repoRoot], env)
  /** The profile manifest read back after the install. */
  const manifestAfterAdd: ProfileManifestFields = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  /** The installed bundle's location inside the profile, a pnpm link back to the checkout. */
  const installedBundle = join(profile, "node_modules", PKG)
  /** The composed bundle layers after the install; the box layers must survive the append. */
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
  // T-69: the wrapper composes (banner on stderr under --json, so the tree stays parseable).
  /** The composition-only dump after the install (never a load proof on its own). */
  const dumpAfterInstall = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "w", "--json"], env)
  /** The wrapper's composed tree, unwrapped from the JSON envelope it prints. */
  const composed = dumpJsonText(dumpAfterInstall.stdout)
  steps.composed = {
    ok: dumpAfterInstall.status === 0
      && ["mpd-dsh-adapter", "mpd-bootstrap", "mpd-web-compat", "mpd-tools", "mpd-roles", "mpd-workmate", "mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team", "mcp-astgrep"].every((id) => composed.includes("id: " + id))
      // 0.1.7-rc.2 preset model: the registry id-target AND the preset ROW itself
      // must both be composed — the row is the whole mpd composition now.
      && composed.includes("id: agent-preset-registry") && composed.includes("default: mpd")
      && composed.includes("id: preset-mpd") && composed.includes("@deepseek-ai/dsh-agent-preset"),
    exit: dumpAfterInstall.status,
  }

  // ── 3) real boot: preset + corpus served from the installed bundle ─────────
  /** The boot log path; stdio goes to this file, never a pipe (MCP children hold the fd). */
  const bootLog = join(outDir, "boot.log")
  /** The boot log's file descriptor, handed to the child as stdout and stderr. */
  const fd = openSync(bootLog, "w")
  // The app form of the launcher: a direct node child where the layout allows it, so the kill below
  // really disposes of it (a `.cmd`-spawned app is a CHILD of cmd.exe, survives the kill and keeps
  // the profile directory busy - measured 2026-09-22 as an uninstall residue and a held port).
  /** The web-app launcher invocation, or `null` when no launcher resolves on this host. */
  const webSpec = dshAppSpec(["--profile", "w", "--patch", probePatch, "--port", String(PORT), "--no-open"], env)
  if (webSpec === null) fail(DSH_MISSING)
  /** The web boot child whose port is polled below and disposed of after the poll. */
  const web = spawn(webSpec.command, webSpec.args, { env, cwd: sandbox, detached: false, stdio: ["ignore", fd, fd] })
  /** Whether the boot's own plugin route answered 200 within the deadline. */
  let up = false
  /** The wall-clock instant the liveness poll gives up at. */
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    try {
      // A bundle-owned plugin route answers without the session token (the root
      // page requires the `?token=` the boot log prints).
      /** The liveness probe against the bundle-owned workmate route. */
      const response = await fetch("http://127.0.0.1:" + PORT + "/plugins/mpd-workmate/list", { signal: AbortSignal.timeout(4000) })
      if (response.status === 200) { up = true; await response.text(); break }
    } catch { /* not up yet */ }
  }
  web.kill("SIGTERM")
  await new Promise((resolve) => setTimeout(resolve, 1500))
  web.kill("SIGKILL")
  if (process.platform === "win32" && typeof web.pid === "number") {
    // Best effort for the interpreter fallback: `/T` takes the tree (see lib/dsh-launcher.ts).
    try { spawnSync("taskkill", ["/PID", String(web.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* denied: the direct-child path needs no tree kill */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  /** The boot log, read back after the child was disposed of. */
  const boot = readFileSync(bootLog, "utf8")
  // The installed package is a pnpm link, so the plugin's own location resolves to
  // the real package dir; the skill corpus is the asset that still has a PATH (the
  // preset is a ROW now).
  //
  // The preset's MOUNT proof is `preset-conformance` (a real `session/create` on
  // the preset — AGENTS.md §4 assigns it there). What THIS case reads from the QA
  // probe is its registration instrumentation: the adapter seam set, the internal
  // tool call, and the probe's own verdict. The sub-assertions are reported
  // SEPARATELY so a red step names its subject instead of showing one opaque
  // `ok: false` (measured 2026-09-27: the probe answered `PRESET_MPD=fail:Unknown`
  // while every other boot assertion — corpus path, seams, internal tool call, no
  // `agent-preset/invalid` — was green, and the single boolean hid which half was
  // red).
  /** The installed package's real path, which the served corpus path must sit under. */
  const bundleReal = realpathSync(installedBundle)
  /** The bootstrap's `skill corpus served from` line, naming the directory the corpus is served out of. */
  const served = /\[mpd-bootstrap\] skill corpus served from ([^\s]+) \(provider mpd-bundle/.exec(boot)
  /** The served corpus path reported by that line, `""` when the line never appeared. */
  const corpusPath = String(served?.[1] ?? "")
  /** The `PRESET_PATH=<path> trust=<value>` probe line: the preset's resolved path and trust. */
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(boot)
  /** The QA probe's own PASS/FAIL verdict, `null` when it never reported one. */
  const probeVerdict = /roles-probe\] (PASS|FAIL)/.exec(boot)?.[1] ?? null
  /** The QA probe's `PRESET_MPD=` verdict, `null` when it never reported one. */
  const presetProbeLine = /roles-probe\] PRESET_MPD=(\S+)/.exec(boot)?.[1] ?? null
  /** The adapter's reported seam set, `""` when the adapter never reported one. */
  const seams = /ADAPTER_SEAMS=([^\s]+)/.exec(boot)?.[1] ?? ""
  /** Every boot assertion, kept separate so a red names its own subject. */
  const checks = {
    http: up,
    adapterProvided: /\[mpd-dsh-adapter\] mpdDsh provided/.test(boot),
    adapterSeams: seams.includes("toolsRegister") && seams.includes("subagentsSpawn") && seams.includes("skillsProvider"),
    adapterToolCall: /ADAPTER_TOOL_CALL=ok/.test(boot),
    corpusFromBundle: corpusPath.startsWith(bundleReal),
    // The preset ROWS must really MOUNT: an inactive child row makes the preset
    // registry refuse the whole preset (`agent-preset/invalid`).
    noPresetRefusal: !/agent-preset\/invalid/.test(boot) && !/did not activate/.test(boot),
    // The QA probe's OWN verdict — the half that depends on the adapter's preset
    // seam answering for the new row model.
    probePass: probeVerdict === "PASS",
    presetProbeOk: presetProbeLine === "ok",
  }
  steps.boot = {
    ok: Object.values(checks).every(Boolean),
    checks,
    failed: Object.entries(checks).filter(([, value]) => !value).map(([name]) => name),
    probeVerdict, presetProbeLine,
    http: up, corpus: served?.[1] ?? null,
    presetPath: presetPath?.[1] ?? null,
    bundleReal, adapterSeams: seams || null,
  }
  /** The harness home's skill root, which must stay absent or empty. */
  const homeSkills = join(home, "skills")
  /** The harness home's preset root, which must stay absent or empty. */
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
  /** The unrelated profile install that must not drop the bundle layer. */
  const plainInstall = runSync("pnpm", ["install", "--prefer-offline", "--store-dir", store], env, { cwd: profile })
  /** The profile manifest read back after that unrelated install. */
  const manifestAfterPlain: ProfileManifestFields = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  /** The composition-only dump repeated after the unrelated install. */
  const dumpAfterPlain = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "w", "--json"], env)
  /** That dump's composed tree, unwrapped from the JSON envelope. */
  const dumpAfterPlainText = dumpJsonText(dumpAfterPlain.stdout)
  steps.layerDurability = {
    ok: plainInstall.status === 0
      && manifestAfterPlain.dependencies?.[PKG] !== undefined
      && (manifestAfterPlain.dsh?.profile?.bundles ?? []).includes(PKG)
      && dumpAfterPlainText.includes("id: mpd-dsh-adapter")
      && dumpAfterPlainText.includes("id: agent-preset-registry")
      && dumpAfterPlainText.includes("id: preset-mpd"),
    exit: plainInstall.status,
    dependency: typeof manifestAfterPlain.dependencies?.[PKG] === "string",
    bundles: manifestAfterPlain.dsh?.profile?.bundles ?? [],
  }

  // ── 4) real uninstall: everything goes, nothing is left behind ─────────────
  /** The ONE-command uninstall of the bundle package from the profile. */
  const remove = runSync("dsh", ["plugin", "--profile", "w", "remove", "--store-dir", store, PKG], env)
  /** The profile manifest read back after the uninstall. */
  const manifestAfterRemove: ProfileManifestFields = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  /** The composition-only dump after the uninstall; every mpd row must be gone from it. */
  const dumpAfter = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "w", "--json"], env)
  /** That dump's composed tree, unwrapped from the JSON envelope. */
  const dumpAfterText = dumpJsonText(dumpAfter.stdout)
  /** Every install path that survived the uninstall; any entry fails the step. */
  const residue: string[] = []
  for (const candidate of [join(home, "skills"), join(home, ".agent-presets"), join(profile, "node_modules", "@mpd-dsh"), installedBundle]) {
    if (existsSync(candidate)) residue.push(candidate)
  }
  /** The sandbox `HOME`'s plugin-state root, which must keep no entry either. */
  const mpdState = join(userHome, ".mpd")
  /** The entries of that plugin-state root; any entry fails the step. */
  const mpdStateEntries = existsSync(mpdState) ? readdirSync(mpdState) : []
  steps.uninstall = {
    ok: remove.status === 0
      && manifestAfterRemove.dependencies?.[PKG] === undefined
      && !(manifestAfterRemove.dsh?.profile?.bundles ?? []).includes(PKG)
      && !dumpAfterText.includes("id: mpd-bootstrap")
      && !dumpAfterText.includes("id: mpd-dsh-adapter")
      && !dumpAfterText.includes("id: mpd-web-compat")
      // The preset patch is the SECOND declared bundle patch: its row must leave
      // with the bundle, and the web-app layer's own `default: standard` return.
      && !dumpAfterText.includes("id: preset-mpd")
      && !dumpAfterText.includes("id: mpd-agent-team")
      && /default: standard/.test(dumpAfterText)
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
