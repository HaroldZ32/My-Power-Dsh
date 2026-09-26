// AC11 NEGATIVE CONTROL (task t8): boot the FULL bundle with the `mpd-dsh-adapter` row
// DISABLED, and prove the agent-teams plugin still applies and degrades with EXACTLY ONE
// fallback witness — i.e. that AC10's green is falsifiable rather than tautological.
//
// Precedent: evidence/omo-align/team-compact/raw/mount-proof-t48.mjs (the same
// sandbox-install + probe-overlay + held-open-boot pattern).
// Isolation (AGENTS.md §7): DSH_HOME=<sandbox> AND HOME=<sandbox userhome> AND an explicit
// sandbox workspace; credentials/settings are COPIED into the sandbox, never read in place
// beyond that copy; the real ~/.dsh is never written. The sandbox is KEPT (not removed) so
// the harness session store stays inspectable.
//
// Overlay patch (contract §11 E4): the patch layer's row key `disabled: true` (the same key
// `scripts/install-profile.mjs` writes) targets the bundle row by id, plus `insert:` for the
// two QA probes. If the id-target did NOT take effect, the boot log would still carry
// `[mpd-dsh-adapter] mpdDsh provided` and this case exits non-zero naming that.
import { spawn, spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { credentialEnv, seedSandboxCredentials } from "../../../../../skills/dsh-qa/scripts/lib/credentials.mjs"
import { assertSessionsSandboxed, sandboxWorkspace } from "../../../../../skills/dsh-qa/scripts/lib/workspace-isolation.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(join(here, "../../../../.."))
const OUT = here
const PKG = "@mpd-dsh/mpd"
const PORT = 38617
const ROLES_PROBE = join(REPO, "packages", "mpd-qa-roles-probe", "dist", "index.js")
const VERIF_PROBE = join(here, "verif-probe.mjs")

const checks = {}
const fail = (what) => { console.error("[adapter-disabled] FAIL: " + what); process.exit(1) }
const runSync = (cmd, args, env, opts = {}) => {
  const result = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 600_000, cwd: opts.cwd ?? REPO, stdio: ["ignore", "pipe", "pipe"] })
  return { status: result.status, out: (result.stdout || "") + (result.stderr || "") }
}

const creds = join(homedir(), ".dsh", ".credentials.yaml")
if (!existsSync(creds)) fail("missing credentials at " + creds)
if (!existsSync(ROLES_PROBE)) fail("missing roles probe dist: " + ROLES_PROBE)

const ts = new Date().toISOString().replaceAll(":", "-")
const sandbox = join(REPO, ".qa-reloc", "adapter-disabled-" + ts)
const home = join(sandbox, "home")
const userHome = join(sandbox, "userhome")
const store = join(sandbox, "pnpm-store")
const profile = join(home, "profiles", "w")
mkdirSync(profile, { recursive: true })
mkdirSync(userHome, { recursive: true })
seedSandboxCredentials(home, { credentialsFile: creds })
const qaSettings = join(homedir(), ".dsh", "settings.yaml")
if (existsSync(qaSettings)) cpSync(qaSettings, join(home, "settings.yaml"))
const env = credentialEnv({ ...process.env, DSH_HOME: home, HOME: userHome })
const ws = sandboxWorkspace(sandbox, "ws")
writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")

// ── the overlay: DISABLE the adapter row + mount the two probes ──────────────
const overlay = join(sandbox, "adapter-disabled.yml")
writeFileSync(overlay, "- id: mpd-dsh-adapter\n  disabled: true\n- insert:\n"
  + "    - id: roles-probe\n      name: " + JSON.stringify(ROLES_PROBE) + "\n"
  + "    - id: verif-probe\n      name: " + JSON.stringify(VERIF_PROBE) + "\n")

// ── install the bundle straight from the checkout ───────────────────────────
const add = runSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, REPO], env)
checks.install = { ok: add.status === 0, status: add.status }
writeFileSync(join(OUT, "install.log"), add.out)
if (!checks.install.ok) fail("bundle install failed (exit " + add.status + ") — see install.log")

// ── the real boot, held open until both probes report ───────────────────────
const bootLogPath = join(OUT, "adapter-disabled-boot.log")
const fd = openSync(bootLogPath, "w")
const child = spawn("dsh", ["--profile", "w", "--patch", overlay, "--port", String(PORT), "--no-open"], {
  env, cwd: ws, detached: false, stdio: ["ignore", fd, fd],
})
let boot = ""
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  try { boot = readFileSync(bootLogPath, "utf8") } catch { boot = "" }
  if (/VERIF_DONE=true/.test(boot) && /roles-probe\] (PASS|FAIL)/.test(boot)) break
  await new Promise((r) => setTimeout(r, 500))
}
try { process.kill(-child.pid, "SIGTERM") } catch { try { child.kill("SIGTERM") } catch {} }
await new Promise((r) => setTimeout(r, 1500))
try { closeSync(fd) } catch {}
boot = readFileSync(bootLogPath, "utf8")

// ── the AC11 measurements ───────────────────────────────────────────────────
const countOf = (re) => (boot.match(re) ?? []).length
checks.adapterRowProvided = { ok: !/\[mpd-dsh-adapter\] mpdDsh provided/.test(boot), occurrences: countOf(/\[mpd-dsh-adapter\] mpdDsh provided/g) }
const absentWitness = countOf(/\[agent-teams\] adapter: mpdDsh ABSENT/g)
const pendingWitness = countOf(/\[agent-teams\] adapter: mpdDsh pending/g)
const mountedWitness = countOf(/\[agent-teams\] adapter: mpdDsh mounted/g)
checks.fallbackWitnesses = { ok: absentWitness + pendingWitness === 1, absent: absentWitness, pending: pendingWitness, mounted: mountedWitness }
const tools21 = /VERIF_AGENT_TEAMS_TOOLS=(\d+)\/21(?: MISSING=([^\s]*))?/.exec(boot)
checks.tools21 = { ok: tools21?.[1] === "21", line: tools21?.[0] ?? "absent" }
const scopeMembers = /VERIF_SCOPE_MEMBERS=([^\s]*)/.exec(boot)?.[1] ?? ""
const scopeIdentity = /VERIF_SCOPE_IDENTITY=(true|false)/.exec(boot)?.[1] ?? "absent"
checks.scopeShape = { ok: scopeMembers === "context,effect,on,tools" && scopeIdentity === "true" && /VERIF_SCOPE_NOTHROW=true/.test(boot) && !/VERIF_SCOPE=THREW/.test(boot), members: scopeMembers, identity: scopeIdentity }
checks.f1Signature = { ok: countOf(/agent-teams: member initialization failed/g) === 0, occurrences: countOf(/agent-teams: member initialization failed/g) }
const br1Substitution = countOf(/per-agent scope substituted a NO-OP/g)
checks.br1Witness = { lines: br1Substitution }
checks.presetProbe = { verdict: /roles-probe\] PASS/.test(boot) ? "PASS" : /roles-probe\] FAIL/.test(boot) ? "FAIL" : "absent" }

// ── isolation assertions (AGENTS.md §7) ─────────────────────────────────────
checks.isolation = { dshHome: home, userHome, workspace: ws, sessionsSandboxed: false }
if (resolve(home).startsWith(resolve(homedir(), ".dsh"))) fail("isolation: DSH_HOME points at the real home")
try {
  assertSessionsSandboxed(home, sandbox, { label: "adapter-disabled-boot" })
  checks.isolation.sessionsSandboxed = true
} catch (error) {
  checks.isolation.error = String(error?.message ?? error)
}

const ok = Object.values(checks).every((entry) => typeof entry !== "object" || entry.ok !== false)
  && checks.presetProbe.verdict !== "FAIL"
writeFileSync(join(OUT, "adapter-disabled-result.json"), JSON.stringify({ ok, sandbox, bootLog: bootLogPath, checks }, null, 2) + "\n")
console.log("[adapter-disabled] " + JSON.stringify(checks, null, 2))
console.log("[adapter-disabled] " + (ok ? "PASS" : "FAIL"))
process.exit(ok ? 0 : 1)
