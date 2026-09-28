#!/usr/bin/env node
// Case relocate-smoke (Plan D / P5): prove the STAGED bundle package installs and
// runs with ZERO references to any fixed checkout path (fully relocatable):
//   1) pack -> copy the staged package to an unrelated location;
//   2) npm-install it into an isolated profile (file: dependency, bundle reconcile);
//   3) dump-config: no dev-path leak, @mpd-dsh/mpd rows present;
//   4) real headless boot: the RELOCATED bundle serves its preset root + skill
//      corpus by reference, with ZERO writes into the harness home.
// Evidence -> evidence/plan-d/relocate/<ts>/. --self-test is offline.
// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.ts
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The checkout the leak check forbids in the staged bytes; `MPD_DEV_ROOT` overrides it for a reviewer's copy. */
const DEV: string = process.env.MPD_DEV_ROOT || repoRoot

/** The evidence slug: the SKIP/FAIL marker and the output directory both carry it. */
const SLUG: string = "relocate-smoke"
/** The staged pack manifest; its presence is this case's ONLY skippable prerequisite. */
const PACK: string = join(repoRoot, "dist", "mpd-package", "package.json")
/** The staged-pack prerequisite record: reason code, proving path and remedy, all reported verbatim by `gate`. */
const PACK_PREREQ: PackPrereq = { reason: "absent-staged-pack", prereq: "dist/mpd-package/package.json", remedy: "node scripts/pack-mpd.ts" }
// Both strict spellings are normative (x2 v2 §6.5): the generic name and the case-specific name.
/** True when either strict flag turns an absent prerequisite from a SKIP into a FAIL. */
const STRICT: boolean = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

/** The staged-pack prerequisite: why this case cannot run, which file proves it, and how to produce it. */
interface PackPrereq {
  /** The machine-readable reason code the SKIP/FAIL marker reports. */
  readonly reason: string
  /** The repository-relative path whose absence was observed. */
  readonly prereq: string
  /** The command a human runs to satisfy the prerequisite. */
  readonly remedy: string
}

/** One asserted step of this case: the verdict plus the evidence fields the run reported for it. */
interface CaseStep {
  /** Whether this step's assertion held; every step's flag is folded into `allOk`. */
  readonly ok: boolean
  /** Any further evidence this step reports (exit status, counts, resolved paths). */
  readonly [field: string]: unknown
}

/** The profile manifest this case rewrites so the relocated pack mounts as a bundle layer. */
interface ProfileManifest {
  /** The harness profile section; the bundle layer list lives inside it. */
  dsh: {
    /** The profile block whose `bundles` array is pushed to after the install. */
    profile: {
      /** The composed bundle layer names, in load order; the relocated pack is appended. */
      bundles: string[]
    }
  }
  /** Any further manifest field (`name`, `private`, `dependencies`) carried through untouched. */
  [field: string]: unknown
}

/** The live boot's outcome: a real child result, or the launcher-missing shape that reports `DSH_MISSING` on stderr. */
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

/** AM1 (x2 v2 §7): a positive probe of the exact prerequisite. The ONLY skippable prerequisite
 *  of this case is the staged pack (§3.3): credentials are NOT part of the skip set and keep
 *  their existing loud failure. */
function absentPrereq(): PackPrereq | null {
  return existsSync(PACK) ? null : PACK_PREREQ
}

/** SKIP (exit 0) or, under either strict flag, FAIL (exit 1) — the same field values in both
 *  modes (AM2). The canonical marker is the FIRST stdout line (§4); human prose follows on
 *  stdout for a SKIP and on stderr for a FAIL. */
function gate(lane: string): void {
  /** The observed prerequisite record, or `null` when the staged pack is present. */
  const p = absentPrereq()
  if (p === null) return
  console.log(`[mpd-qa] ${STRICT ? "FAIL" : "SKIP"} case=${SLUG} lane=${lane} reason=${p.reason} prereq=${p.prereq} remedy="${p.remedy}"`)
  /** The human-readable follow-up, routed to stderr for a FAIL and to stdout for a SKIP. */
  const prose = `[${SLUG}] staged package absent at ${p.prereq}; ${STRICT ? "failing (strict flag)" : "skipping (not a failure)"}`
  if (STRICT) console.error(prose)
  else console.log(prose)
  process.exit(STRICT ? 1 : 0)
}

/** The offline arm: proves the STAGED patch carries no checkout path, so the pack is relocatable. */
function selfTest(): void {
  gate("self-test")
  /** The staged bundle patch, read from the packed tree rather than from the checkout. */
  const patch = readFileSync(join(repoRoot, "dist", "mpd-package", "cordis.patch.yml"), "utf8")
  if (patch.includes(DEV) || patch.includes("the upstream project")) { console.error("[relocate-smoke self-test] FAIL: dev path leak in staged patch"); process.exit(1) }
  console.log("[relocate-smoke self-test] ok: staged patch is path-clean")
}

/** The live arm: relocate the staged pack, install it into an isolated profile and boot it headless. */
async function runReal(): Promise<void> {
  gate("real")
  /** The real home's credential file, copied ONCE into the sandbox and never read again. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[relocate-smoke] missing credentials"); process.exit(1) }
  /** The run stamp that names the evidence directory (ISO time with `:` replaced, so it is path-safe). */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes `result.json` and `output.log` into. */
  const outDir = join(repoRoot, "evidence", "plan-d", "relocate", ts)
  mkdirSync(outDir, { recursive: true })
  /** The scratch root holding the relocated copy, the sandbox home and the workspace. */
  const reloc = join(repoRoot, ".qa-reloc")
  mkdirSync(reloc, { recursive: true })
  /** The relocated copy of the staged pack; every later assertion is anchored to this path. */
  const staged = join(reloc, "mpd-pkg-relocated")
  cpSync(join(repoRoot, "dist", "mpd-package"), staged, { recursive: true })
  /** The sandbox `DSH_HOME` the relocated pack is installed into. */
  const home = join(reloc, "home")
  /** The isolated harness profile (`t`) that holds the `file:` dependency on the relocated pack. */
  const profile = join(home, "profiles", "t")
  mkdirSync(profile, { recursive: true })
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
  mkdirSync(join(reloc, "ws"), { recursive: true })
  // NO `@nanmicoder/dsh-agent-teams` dependency: that npm package belonged to the RETIRED
  // vendored body (D5). The packed bundle declares its own runtime deps (the three official
  // Agent Teams packages) and the profile installs the relocated pack by `file:`, so the
  // retired name would only add an unresolvable dependency to the install.
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  /** The sandbox `HOME`, which keeps the workmate library and user skill roots out of the real home. */
  const userHome = join(reloc, "userhome")
  mkdirSync(userHome, { recursive: true })
  /** The sandboxed environment every child of this case inherits (sandbox credentials only). */
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: home, HOME: userHome  })
  if (env.DSH_HOME !== home || env.HOME !== userHome) { console.error("[relocate-smoke] isolation assertion failed"); process.exit(1) }
  /** Per-step verdicts, keyed by step name, serialised straight into `result.json`. */
  const steps: Record<string, CaseStep> = {}
  console.log("[relocate-smoke] npm install (relocated bundle + ast-grep + codegraph)...")
  /** The `npm install` of the relocated pack into the sandbox profile. */
  const inst = spawnSync("npm", ["install", "--prefix", profile, "--no-audit", "--no-fund", "--cache", join(reloc, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  steps.install = { ok: inst.status === 0, exit: inst.status }
  /** The written-back profile manifest: the relocated pack is appended as a layer, like a real install. */
  const manifest: ProfileManifest = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  manifest.dsh.profile.bundles.push("@mpd-dsh/mpd")
  writeFileSync(join(profile, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  // T-69: the wrapper is the sanctioned composer; `--json` puts the banner on stderr, so the
  // child's composed tree is read from `.stdout` and the banner can be asserted separately.
  /** The composition-only dump of the profile that now mounts the relocated pack. */
  const dump = spawnSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "t", "--json"], { env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
  /** The wrapper's composed tree, unwrapped from the JSON envelope it prints. */
  const dumpOut: string = ((): string => { try { return JSON.parse(dump.stdout || "{}").stdout ?? "" } catch { return dump.stdout || "" } })()
  // The QA scratch root (.qa-reloc) legitimately appears in the composed tree —
  // the profile overlay roots the roster at the RELOCATED package — so the leak
  // check masks it and only fails on a real checkout path.
  /** The dump with the sanctioned sandbox roots masked, so only a real checkout path reddens the leak check. */
  const dumpOutClean: string = dumpOut.split(home).join("<QAHOME>").split(reloc).join("<QARELOC>")
    .split(join(repoRoot, "packages", "mpd-qa-roles-probe")).join("<QAPROBE>")
  steps.dump = { ok: dump.status === 0 && dumpOut.includes("@mpd-dsh/mpd") && !dumpOutClean.includes(DEV), exit: dump.status, leaked: dumpOutClean.includes(DEV) }
  // The RELOCATED pack's OWN patch array supplies the `agent-preset-registry` id-target and
  // the `preset-mpd` row (0.1.7-rc.2), so the only overlay this lane needs is the QA probe.
  // The retired `agent-presets` row + `roots:`/`trust: system` overlay is GONE: that package
  // no longer exists, so inserting it would take the whole boot down.
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n"
    + "    - id: roles-probe\n      name: " + JSON.stringify(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  // Deterministic boot proof (no model call: the QA machine has no model key):
  // the probe reads the LIVE preset + skill catalog out of the relocated package.
  /** The resolved `dsh` launcher invocation for the headless boot, or `null` when none is on PATH. */
  const liveSpec = dshCommand(["--profile", "t", "ok"], env)
  /** The headless boot result; a missing launcher is reported instead of thrown. */
  const live: LiveOutcome = liveSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(liveSpec.command, liveSpec.args, { env, cwd: join(reloc, "ws"), encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  /** The boot's stdout and stderr concatenated: the probe lines this case asserts on. */
  const out: string = (live.stdout || "") + (live.stderr || "")
  /** The `PRESET_PATH=<path> trust=<value>` probe line: the relocated preset's resolved path and trust. */
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(out)
  /** The `SKILL_FIXTURE=` probe line: the loaded skill's state, name, resource base and body size. */
  const fixture = /SKILL_FIXTURE=(\w+) name=(\S+) base=(\S+) bytes=(\d+)/.exec(out)
  // 0.1.7-rc.2 ROW MODEL: the probe reports the preset's declaring PATCH FILE and
  // `trust=bundle` (there is no `system`-trust directory root any more, and no directory to
  // resolve). The lane's claim is "the RELOCATED pack serves its own preset" — so assert the
  // relocated path AND the row model's own trust value EXPLICITLY. Deliberately NOT
  // `trust !== undefined`: accepting any trust would stop distinguishing a relocated pack
  // from a home copy, which is the one thing this lane exists to tell apart.
  /** The relocated pack's preset patch in forward-slash form, the exact string the probe must report. */
  const relocatedPresetPatch = join(staged, "presets", "mpd.patch.yml").split("\\").join("/")
  steps.live = {
    ok: /roles-probe\] PASS/.test(out) && /PRESET_MPD=ok/.test(out)
      && String(presetPath?.[1] ?? "").split("\\").join("/") === relocatedPresetPatch && presetPath?.[2] === "bundle"
      && fixture !== null && fixture[1] === "ok" && String(fixture[3]).startsWith(staged),
    exit: live.status, preset: presetPath?.[1] ?? null, trust: presetPath?.[2] ?? null,
    expectedPreset: relocatedPresetPatch, fixtureBase: fixture?.[3] ?? null,
  }
  // bundle-served model: NOTHING is copied into the harness home …
  /** The harness home's preset root, which the bundle-served model must leave absent or empty. */
  const presets = join(home, ".agent-presets")
  /** The entries of that preset root: a non-empty list is a home copy and fails the next step. */
  const presetCopies: string[] = existsSync(presets) ? readdirSync(presets) : []
  steps.noPresetCopy = { ok: presetCopies.length === 0, count: presetCopies.length }
  /** The harness home's skill root, which must stay empty under the bundle-served model. */
  const userSkills = join(home, "skills")
  /** The discovered skill directories that really carry a SKILL.md; any entry fails the next step. */
  const skillDirs: string[] = existsSync(userSkills) ? readdirSync(userSkills).filter((d) => { try { return existsSync(join(userSkills, d, "SKILL.md")) } catch { return false } }) : []
  steps.noSkillCopy = { ok: skillDirs.length === 0, count: skillDirs.length }
  // … and both assets are served from the RELOCATED package.
  steps.servedFromRelocated = { ok: out.includes(join(staged, "skills")) && out.includes("provider mpd-bundle"), staged }
  steps.bootstrap = { ok: out.includes("mpd-bootstrap") }
  /** The case verdict: every step green, which is what the exit code below mirrors. */
  const allOk: boolean = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump ---\n" + dumpOut.slice(0, 20000))
  console.log("[relocate-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 200))
  if (!allOk) process.exit(1)
  console.log("[relocate-smoke] PASS")
}

/** The command line after the interpreter and script path: `--self-test` selects the offline arm. */
const argv: string[] = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
