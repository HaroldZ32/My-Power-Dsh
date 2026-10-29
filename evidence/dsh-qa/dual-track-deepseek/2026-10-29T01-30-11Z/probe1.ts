// Diagnostic probe: reproduce the dual-track deepseek boot and dump its composition.
// Scratch artifact for the diagnosis; writes its sandbox under the per-call $TMPDIR.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { sandboxWorkspace } from "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { credentialEnv, seedSandboxCredentials, credentialDescriptor } from "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/skills/dsh-qa/scripts/lib/credentials.ts"
import { dshCommand } from "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/skills/dsh-qa/scripts/lib/dsh-launcher.ts"

/** Repository root of my-power-dsh. */
const repoRoot = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
/** Evidence directory this probe writes its logs into. */
const outDir = process.argv[2] ?? repoRoot + "/evidence/dsh-qa/dual-track-deepseek/probe-out"
/** The packed preset-root operand the rewrite replaces with the checkout's own `presets/`. */
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'
/** The packed baseUrl expression the rewrite strips out of every row operand. */
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? decodeURIComponent(baseUrl.replace(/^file:\\/\\/\\/(?=[A-Za-z]:)/, "").replace(/^file:\\/\\//, "")).replace(/\\/+$/, "") : "") + '
/** The case's own dev-flavor rewrite of the committed bundle patch. */
function devPatch(): string {
  const t = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  return t
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(join(repoRoot, "presets")))
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}
mkdirSync(outDir, { recursive: true })
/** Throwaway DSH_HOME for this one probe. */
const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
/** Credential seeding outcome, value-free. */
const credential = seedSandboxCredentials(sandbox, { credentialsFile: join(homedir(), ".dsh", ".credentials.yaml") })
/** The real home settings document the case would copy when present. */
const settings = join(homedir(), ".dsh", "settings.yaml")
/** Whether the real home carries a settings.yaml. */
const settingsPresent = existsSync(settings)
if (settingsPresent) cpSync(settings, join(sandbox, "settings.yaml"))
/** The sandbox-staged, boot-repaired bundle patch. */
const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
writeFileSync(bundlePatch, devPatch())
/** Child environment: sandbox DSH_HOME plus the resolved credential. */
const env = credentialEnv({ ...process.env, DSH_HOME: sandbox })
/** Sandbox workspace cwd (DSH_HOME alone does not isolate workspace state). */
const ws = sandboxWorkspace(sandbox)
/** The track's patch operands: repaired bundle, then the compat overlay. */
const baseArgs = ["--profile", "headless", "--patch", bundlePatch, "--patch", join(repoRoot, "tests/overlays/compat-track.yml")]
/** `dump` composes only; `live` runs the case's job against a real model. */
const mode = process.argv[3] ?? "dump"
/** A candidate settings document, when the caller wants one staged instead of the real home's. */
const overrideSettings = process.argv[4] === "-" || process.argv[4] === "" ? undefined : process.argv[4]
if (overrideSettings !== undefined) writeFileSync(join(sandbox, "settings.yaml"), readFileSync(overrideSettings))
/** An extra overlay appended after the compat overlay, used only for diagnostics. */
const extraPatch = process.argv[5]
if (extraPatch !== undefined) baseArgs.push("--patch", extraPatch)
const args = mode === "dump" ? [...baseArgs, "--dump-config"] : [...baseArgs, "List the files in the current working directory (first use the bash tool with pwd and ls), then answer only: which tools you called and how many files are in the directory."]
const spec = dshCommand(args, env)
if (spec === null) { console.error("no launcher"); process.exit(2) }
const t0 = Date.now()
const run = spawnSync(spec.command, spec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 })
const ms = Date.now() - t0
const out = (run.stdout ?? "") + (run.stderr ?? "")
writeFileSync(join(outDir, mode + ".log"), out)
// After the boot, the active profile patch shows whether the settings document was imported into it.
const profilePatch = join(sandbox, "profiles", "headless", "cordis.patch.yml")
const profilePatchText = existsSync(profilePatch) ? readFileSync(profilePatch, "utf8") : "(absent)"
writeFileSync(join(outDir, mode + ".profile-patch.yml"), profilePatchText)
console.log(JSON.stringify({ sandbox, ws, settingsPresent, overrideSettings: overrideSettings ?? null, credential: credentialDescriptor(credential), exit: run.status, ms, log: join(outDir, mode + ".log"), bytes: out.length }, null, 2))
