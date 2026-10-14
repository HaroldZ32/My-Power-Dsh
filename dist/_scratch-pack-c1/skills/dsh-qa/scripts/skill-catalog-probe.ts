#!/usr/bin/env node
// Case skill-catalog-probe (Plan D, bundle-served since 0.3.0): prove the staged
// bundle installs AND its skill corpus is usable WITHOUT copying anything into
// the harness home. A real headless boot mounts the QA probe, which reads the
// live skill catalog through ctx.skills and loads `svn-master` (name, body,
// resource base) from <bundle>/skills — $DSH_HOME/skills stays absent.
// The proof is deterministic (no model call): the QA machine has no model
// credential, and delivery — not model behavior — is what this case asserts.
// Isolated DSH_HOME; evidence -> evidence/plan-d/skill-catalog/<ts>/.
// --self-test is offline (staged presence + provider wiring in the built dist).
// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.ts
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"

/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The canned task text kept with the case definition; the deterministic run below does not prompt a model. */
const TASK = "Call the skill tool with name 'svn-master' (the exact skill name from the session skill catalog), then reply in one line what this skill governs."

/** The evidence slug: the SKIP/FAIL marker and the output directory both carry it. */
const SLUG = "skill-catalog-probe"
/** The staged pack manifest; its presence is this case's ONLY skippable prerequisite. */
const PACK = join(repoRoot, "dist", "mpd-package", "package.json")
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

/** The profile manifest this case rewrites so the staged pack mounts as a bundle layer. */
interface ProfileManifest {
  /** The harness profile section; the bundle layer list lives inside it. */
  dsh: {
    /** The profile block whose `bundles` array is pushed to after the install. */
    profile: {
      /** The composed bundle layer names, in load order; the staged pack is appended. */
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
 *  stdout for a SKIP and on stderr for a FAIL. Called AFTER the prerequisite-independent
 *  offline checks (AM3b) and BEFORE the non-skippable credentials check. */
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

/** The names the harness's BUNDLED skill root discovers: a top-level directory bundle
 *  `<name>/SKILL.md` or a top-level flat `<name>.md` (dsh-skill-filesystem, nested
 *  `**&#47;SKILL.md` deliberately not discovered). Derived from the staged corpus on disk so
 *  no case pins a magic corpus size that rots when the corpus legitimately changes. */
function corpusSkillNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => (e.isDirectory() && existsSync(join(root, e.name, "SKILL.md"))) || (e.isFile() && e.name.endsWith(".md")))
    .map((e) => (e.isDirectory() ? e.name : e.name.slice(0, -3)))
    .sort()
}

/** The offline arm: proves the staged corpus is present and the BUILT provisioning plugin serves it. */
function selfTest(): void {
  /** The staged pack root the case reads its corpus list and presence marker from. */
  const staged = join(repoRoot, "dist", "mpd-package")
  /** The corpus marker whose absence means the staged pack was packed before the corpus was complete. */
  const marker = join(staged, "skills", "svn-master", "SKILL.md")
  // Prerequisite-independent checks first (AM3b): the built provisioning dist is tracked,
  // so a defect there is a FAIL in every mode — never a skip.
  // bundle-served model: the built provisioning plugin registers a skill provider
  // and no longer copies the corpus into the harness home.
  /** The built provisioning plugin, inspected for provider registration instead of corpus copying. */
  const dist = readFileSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "dist", "index.js"), "utf8")
  if (!dist.includes("registerProvider") || !dist.includes("skill corpus served from")) { console.error("[skill-catalog-probe self-test] FAIL: mpd-bootstrap dist does not register the corpus provider"); process.exit(1) }
  if (dist.includes("syncTree") || /cpSync\([^)]*skills/.test(dist)) { console.error("[skill-catalog-probe self-test] FAIL: mpd-bootstrap dist still copies the corpus (syncTree/cpSync)"); process.exit(1) }
  gate("self-test")
  // Present-but-broken pack (AM3): the prerequisite exists but the staged corpus is incomplete.
  if (!existsSync(marker)) { console.error("[skill-catalog-probe self-test] FAIL: staged skill corpus incomplete (missing skills/svn-master/SKILL.md; run node scripts/pack-mpd.ts)"); process.exit(1) }
  // The derived corpus list is the case's expected-catalog operand: prove it is NOT
  // vacuous (it must see the staged corpus and the loaded fixture) without pinning a size.
  /** The corpus names derived from the staged pack; used to prove the derivation is not vacuous. */
  const corpusNames = corpusSkillNames(join(staged, "skills"))
  if (corpusNames.length < 2 || !corpusNames.includes("svn-master") || !corpusNames.includes("dsh-qa")) { console.error("[skill-catalog-probe self-test] FAIL: corpus derivation does not see the staged corpus (expected svn-master + dsh-qa among " + corpusNames.length + ")"); process.exit(1) }
  console.log("[skill-catalog-probe self-test] ok: staged skill corpus present + provider wiring verified")
}

/** The live arm: install the staged pack into an isolated profile and boot it headless to read the catalog. */
async function runReal(): Promise<void> {
  gate("real")
  /** The real home's credential file, copied ONCE into the sandbox and never read again. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[skill-catalog-probe] missing credentials"); process.exit(1) }
  /** The run stamp that names the evidence directory (ISO time with `:` replaced, so it is path-safe). */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes `result.json` and `output.log` into. */
  const outDir = join(repoRoot, "evidence", "plan-d", "skill-catalog", ts)
  mkdirSync(outDir, { recursive: true })
  /** The fresh temporary sandbox that serves as `DSH_HOME` for the whole run. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-skill-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // The live provider chain lives in settings.yaml (llm-pi-ai gateway providers);
  // without it the headless boot falls back to the base deepseek-official route
  // and fails with MISSING_CREDENTIAL (AGENTS.md §7).
  /** The real home's model-chain settings, staged only when the host has one. */
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  /** The sandboxed workspace the boot runs from (never the checkout, never the real home). */
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  /** The sandbox `HOME`, which keeps the workmate library out of the real home. */
  const userHome = join(sandbox, "userhome")
  mkdirSync(userHome, { recursive: true })
  /** The sandboxed environment every child of this case inherits (sandbox credentials only). */
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: userHome  })
  /** The staged pack the profile installs by `file:`; the boot must serve the corpus from here. */
  const staged = join(repoRoot, "dist", "mpd-package")
  /** The isolated harness profile (`t`) that holds the `file:` dependency on the staged pack. */
  const profileDir = join(sandbox, "profiles", "t")
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  /** Per-step verdicts, keyed by step name, serialised straight into `result.json`. */
  const steps: Record<string, CaseStep> = {}
  /** The `npm install` of the staged pack into the sandbox profile. */
  const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund", "--cache", join(sandbox, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  steps.install = { ok: inst.status === 0, exit: inst.status }
  // mount the bundle patch rows (mpd-bootstrap included), like a real install
  /** The written-back profile manifest: the staged pack is appended as a layer, like a real install. */
  const manifest: ProfileManifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"))
  manifest.dsh.profile.bundles.push("@mpd-dsh/mpd")
  writeFileSync(join(profileDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  // Boot overlay: mount ONLY the QA probe that reads the live catalog. The bundle
  // is added as a profile layer above, so its OWN patch array supplies the
  // `agent-preset-registry` id-target and the `preset-mpd` row — 0.1.7-rc.2 has no
  // preset ROOT to insert, and the retired `@deepseek-ai/dsh-agent-presets` row
  // would now fail to resolve and take the boot down with it.
  /** The one-row boot overlay that mounts the QA roles probe. */
  const overlay = join(sandbox, "qa-probe.yml")
  /** The installed pack location, resolved through realpath below so a link and a copy both pass. */
  const installedBundle = join(profileDir, "node_modules", "@mpd-dsh", "mpd")
  writeFileSync(overlay, "- insert:\n"
    + "    - id: roles-probe\n      name: " + JSON.stringify(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  /** The resolved `dsh` launcher invocation for the headless boot, or `null` when none is on PATH. */
  const liveSpec = dshCommand(["--profile", "t", "--patch", overlay, "ok"], env)
  /** The headless boot result; a missing launcher is reported instead of thrown. */
  const live: LiveOutcome = liveSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(liveSpec.command, liveSpec.args, { env, cwd: ws, encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  /** The boot's stdout and stderr concatenated: the probe lines this case asserts on. */
  const out: string = (live.stdout || "") + (live.stderr || "")
  // bundle-served model: the corpus is NOT copied into the harness home …
  /** The harness home's skill root, which must stay empty under the bundle-served model. */
  const userSkills = join(sandbox, "skills")
  /** The discovered skill directories that really carry a SKILL.md; any entry fails the next step. */
  const skillDirs: string[] = existsSync(userSkills) ? readdirSync(userSkills).filter((d) => existsSync(join(userSkills, d, "SKILL.md"))) : []
  steps.noHomeCopy = { ok: skillDirs.length === 0, count: skillDirs.length, path: userSkills }
  /** The harness home's preset root, which the bundle-served model must leave absent or empty. */
  const userPresets = join(sandbox, ".agent-presets")
  steps.noPresetCopy = { ok: !existsSync(userPresets) || readdirSync(userPresets).length === 0, path: userPresets }
  // … and it IS served from the installed bundle. The npm file: install links the
  // package, so the plugin's own location resolves to the real staged package dir
  // while a copied tree would have been under $DSH_HOME — accept either the
  // node_modules path or the package's realpath, never the harness home.
  /** The bootstrap's `skill corpus served from` line, naming the directory the corpus is served out of. */
  const served = /\[mpd-bootstrap\] skill corpus served from ([^\s]+) \(provider mpd-bundle/.exec(out)
  /** The served corpus path reported by that line, `""` when the line never appeared. */
  const servedPath: string = String(served?.[1] ?? "")
  /** The staged pack's own corpus directory, the other acceptable serve root beside node_modules. */
  const stagedReal = join(staged, "skills")
  steps.servedFromBundle = {
    ok: served !== null && servedPath.endsWith("skills")
      && (servedPath.includes(join("node_modules", "@mpd-dsh", "mpd", "skills")) || servedPath === stagedReal)
      && !servedPath.startsWith(sandbox),
    path: servedPath || null,
  }
  // proof: the probe read the LIVE catalog and loaded the fixture skill body.
  /** The probe's `SKILLS=<total> BUNDLED=<bundled>` line: the live catalog size through ctx.skills. */
  const catalog = /\[roles-probe\] SKILLS=(\d+) BUNDLED=(\d+)/.exec(out)
  /** The probe's `SKILL_FIXTURE=` line: the loaded skill's state, name, resource base and body size. */
  const fixture = /\[roles-probe\] SKILL_FIXTURE=(\w+) name=(\S+) base=(\S+) bytes=(\d+)/.exec(out)
  /** The installed pack's real path, which the fixture's resource base must sit under. */
  const installedReal = realpathSync(installedBundle)
  // The expected count is DERIVED from the corpus this staged pack ships, never a
  // magic number: the old hard-coded floor (`>= 20`) rotted silently while the corpus
  // legitimately shrank (RTL trees extracted, then the cross-agent session-finder skill
  // pruned by the DSH-only cleanup: 21 -> 19 -> 18).
  /** The staged corpus root the expected catalog size is derived from. */
  const corpusRoot = join(staged, "skills")
  /** The expected catalog size, derived from the staged corpus instead of pinned as a magic floor. */
  const expectedSkills = corpusSkillNames(corpusRoot).length
  steps.catalog = {
    ok: /roles-probe\] PASS/.test(out)
      && catalog !== null && Number(catalog[1]) === expectedSkills && Number(catalog[2]) === expectedSkills
      && fixture !== null && fixture[1] === "ok" && fixture[2] === "svn-master"
      && String(fixture[3]).startsWith(installedReal) && Number(fixture[4]) > 100,
    total: catalog ? Number(catalog[1]) : null,
    bundled: catalog ? Number(catalog[2]) : null,
    expected: expectedSkills,
    fixture: fixture ? { state: fixture[1], name: fixture[2], base: fixture[3], bytes: Number(fixture[4]) } : null,
    exit: live.status,
  }
  /** The case verdict: every step green, which is what the exit code below mirrors. */
  const allOk: boolean = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000))
  console.log("[skill-catalog-probe] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 200))
  if (!allOk) process.exit(1)
  console.log("[skill-catalog-probe] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
