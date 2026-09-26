// One-off MOUNT probe for the sidebar-guard fix (evidence artifact, NOT shipped code).
//
// WHY IT EXISTS: the sanctioned MOUNT lane (`skills/dsh-qa/scripts/bundle-lifecycle.mjs`) cannot
// start on this host — its own launcher precheck reads `env.PATH` from a plain `{...process.env}`
// copy, whose win32 key is `Path`, so it reports "no dsh launcher on PATH" before booting (an
// adjacent defect in skills/**, deliberately NOT fixed here). This probe boots the same thing the
// lane boots — the bundle's OWN web profile, isolated DSH_HOME + sandbox HOME — through the
// harness entry directly (no PATH lookup at all) and reads the sidebar mount guard's decision out
// of the boot log, which is the one line this fix changes.
//
// Usage: node mount-probe.mjs <harness-lib-bin.js> <label> <port>
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

function findRepoRoot(start) {
  let dir = start
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(dir, "package.json")
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === "@mpd-dsh/mpd") return dir
      } catch { /* keep walking */ }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error("repo root (@mpd-dsh/mpd) not found above " + start)
}

const HARNESS_BIN = process.argv[2]
const LABEL = process.argv[3] ?? "run"
const PORT = Number(process.argv[4] ?? 3411)
const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))
const stamp = new Date().toISOString().replaceAll(":", "-")
const sandbox = join(ROOT, ".qa-reloc", `sidebar-guard-mount-${LABEL}-${stamp}`)
const home = join(sandbox, "home")          // DSH_HOME
const userHome = join(sandbox, "userhome")  // HOME (workmate library isolation)
const profile = join(home, "profiles", "w")

mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(userHome, { recursive: true })

// The profile names the bundle as a link dependency and as a LAYER — the shape `dsh plugin add`
// produces, written directly so no launcher resolution is involved.
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-w",
  private: true,
  dependencies: { "@mpd-dsh/mpd": "link:" + ROOT.replaceAll("\\", "/") },
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
}, null, 2) + "\n")
const link = join(profile, "node_modules", "@mpd-dsh", "mpd")
try { rmSync(link, { recursive: true, force: true }) } catch { /* fresh sandbox */ }
symlinkSync(ROOT, link, "junction")

// Credentials/settings are copied only when present (AGENTS.md §7): a home whose chain comes from
// gateway providers needs settings.yaml or the boot falls back to a credential-less route.
const realCredentials = join(homedir(), ".dsh", ".credentials.yaml")
const realSettings = join(homedir(), ".dsh", "settings.yaml")
const seeded = { credentials: false, settings: false }
if (existsSync(realCredentials)) { cpSync(realCredentials, join(home, ".credentials.yaml")); seeded.credentials = true }
if (existsSync(realSettings)) { cpSync(realSettings, join(home, "settings.yaml")); seeded.settings = true }

const bootLog = join(sandbox, "boot.log")
const fd = openSync(bootLog, "w")
const child = spawn(process.execPath, [HARNESS_BIN, "--profile", "w", "--port", String(PORT), "--no-open"], {
  cwd: sandbox,
  // FILE stdio, never a pipe: a long-lived boot must not depend on a pipe this harness can close.
  stdio: ["ignore", fd, fd],
  env: { ...process.env, DSH_HOME: home, HOME: userHome },
})

const deadline = Date.now() + 150000
let text = ""
let guardLine = null
let urlLine = null
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2500))
  try { text = readFileSync(bootLog, "utf8") } catch { text = "" }
  guardLine = /^.*\[mpd-better-sidebar\] mount guard: .*$/m.exec(text)?.[0]?.trim() ?? null
  urlLine = /^.*dsh web: http.*$/m.exec(text)?.[0]?.trim() ?? null
  if (guardLine !== null && urlLine !== null) break
  if (child.exitCode !== null) break
}

try { child.kill() } catch { /* already gone */ }
await new Promise((resolve) => setTimeout(resolve, 1500))
try { if (child.exitCode === null) child.kill("SIGKILL") } catch { /* already gone */ }

const result = {
  label: LABEL,
  host: `${process.platform}-${process.arch}`,
  node: process.version,
  harnessBin: HARNESS_BIN,
  sandbox,
  profileLayerNotForeign: true,
  seeded,
  guardLine,
  urlLine,
  booted: urlLine !== null,
  childExitCode: child.exitCode,
  logBytes: text.length,
  // The proof this fix needs: the bundle's OWN row mounts the sidebar on win32 instead of being
  // disabled by the bogus "not resolvable from the profile node_modules" clause.
  decision: guardLine?.includes("ENABLED") ? "ENABLED" : guardLine?.includes("DISABLED") ? "DISABLED" : "NO-DECISION",
  logTail: text.split(/\r?\n/).slice(-12),
}
const outPath = join(dirname(fileURLToPath(import.meta.url)), `mount-probe-${LABEL}.result.json`)
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ label: LABEL, decision: result.decision, booted: result.booted, guardLine, urlLine, outPath }, null, 2))
process.exitCode = result.booted ? 0 : 1
