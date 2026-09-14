// t48 MOUNT PROOF — does the new row APPLY in a real boot, and are its tools registered?
//
// Why a boot and not `--dump-config`: `--dump-config` only COMPOSES rows and never executes
// plugin code (AGENTS.md §4), so it cannot witness a registered tool, a pending loader entry
// or an apply abort. This driver installs the bundle into an isolated profile exactly as
// bundle-lifecycle does, then boots the SAME web profile but HOLDS the process open until the
// QA probe reports, so the probe's own registration poll always finishes.
//
// The probe prints:
//   AGENT_TEAMS_TOOLS=<n>/7, TEAM_COMPACT_TOOLS=<n>/2, ADAPTER_SEAMS=..., PASS|FAIL
import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
// Resolve the repo root WITHOUT counting dirnames (the depth trap that has bitten this
// repo before): the harness checkout is whatever precedes the /evidence/ segment.
const repoRoot = here.slice(0, here.indexOf("/evidence/"))
const PROBE = join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")
const PKG = "@mpd-dsh/mpd"

function fail(message) {
  console.error("[t48-mount] FAIL: " + message)
  process.exit(1)
}
function runSync(command, args, env, cwd) {
  const result = spawnSync(command, args, { env, cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 })
  return { status: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

if (process.argv[2] === "--self-test") {
  const bundled = existsSync(PROBE) ? readFileSync(PROBE, "utf8") : ""
  for (const marker of ["TEAM_COMPACT_TOOLS", "mpd_team_compact_run", "mpd_team_compact_status"]) {
    if (!bundled.includes(marker)) fail(`probe bundle lacks the instrumentation marker ${marker}`)
  }
  if (repoRoot !== "/root/dshProj/my-power-dsh") fail(`repoRoot resolved to ${repoRoot}`)
  if (!readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8").includes("mpd-team-compact")) fail("bundle patch no longer names the mpd-team-compact row")
  console.log("[t48-mount self-test] ok: probe carries the compaction instrumentation, repo root resolves, bundle patch names the row")
  process.exit(0)
}

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t48-mount-"))
const home = join(sandbox, "home")
const userHome = join(sandbox, "userhome")
const workspace = join(sandbox, "ws")
const profile = join(home, "profiles", "w")
for (const dir of [profile, userHome, workspace]) mkdirSync(dir, { recursive: true })
const creds = join(homedir(), ".dsh", ".credentials.yaml")
if (!existsSync(creds)) fail("no credentials to sandbox")
// mode 600: the credentials row REFUSES a world-readable file and takes the tree down.
writeFileSync(join(home, ".credentials.yaml"), readFileSync(creds), { mode: 0o600 })
const env = { ...process.env, DSH_HOME: home, HOME: userHome }

writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-w", private: true, dependencies: {},
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
}, null, 2) + "\n")

const outDir = join(here, "..", "mount")
mkdirSync(outDir, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, "-")
const steps = {}

// 1) one-command install from the checkout (the same path bundle-lifecycle exercises)
// --store-dir is REQUIRED in a sandboxed HOME: without it pnpm resolves its store
// against the real home, the install exits 1, and every later step "fails" for a reason
// that has nothing to do with the row under test (measured: install exit 1, 0 composed rows).
const store = join(sandbox, "pnpm-store")
const add = runSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, repoRoot], env, sandbox)
const installed = join(profile, "node_modules", PKG)
steps.install = { ok: add.status === 0 && existsSync(installed), exit: add.status }

// 2) composition (recorded as COMPOSITION ONLY — never load evidence)
const dump = runSync("dsh", ["--profile", "w", "--dump-config"], env, sandbox)
steps.composition = {
  ok: dump.status === 0 && dump.out.includes("id: mpd-team-compact"),
  exit: dump.status,
  note: "COMPOSITION ONLY — never cited as load evidence (AGENTS.md §4)",
}
if (!steps.composition.ok) fail("the mpd-team-compact row is not composed")

// 3) the real mounted boot, held open until the probe reports
const probePatch = join(sandbox, "probe.yml")
writeFileSync(probePatch, "- insert:\n    - id: roles-probe\n      name: " + JSON.stringify(PROBE) + "\n")
const bootLog = join(outDir, `boot-${ts}.log`)
const fd = openSync(bootLog, "w")
const child = spawn("dsh", ["--profile", "w", "--patch", probePatch, "--port", "38501", "--no-open"], {
  env, cwd: workspace, detached: false, stdio: ["ignore", fd, fd],
})
let boot = ""
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  boot = readFileSync(bootLog, "utf8")
  if (/roles-probe\] (PASS|FAIL)/.test(boot)) break
}
child.kill("SIGTERM")
await new Promise((resolve) => setTimeout(resolve, 1500))
closeSync(fd)
boot = readFileSync(bootLog, "utf8")

const CRASH = ["unsupported JSON schema", "JsonSchemaError", "plugin tree failed to load", "failed to apply loader entry"]
const crashes = CRASH.filter((signature) => boot.includes(signature))
// A pending entry for OUR row is the failure mode this task must not ship.
const pendingLines = boot.split("\n").filter((line) => /pending \(waiting for service/.test(line))
const ourPending = pendingLines.filter((line) => line.includes("mpd-team-compact-plugin"))
const compactTools = /\[roles-probe\] TEAM_COMPACT_TOOLS=(\d+)\/(\d+)(?: MISSING=([^\s]*))?/.exec(boot)
const allTools = /\[roles-probe\] AGENT_TEAMS_TOOLS=(\d+)\/(\d+)(?: MISSING=([^\s]*))?/.exec(boot)

steps.mountedBoot = {
  ok: compactTools !== null && Number(compactTools[1]) === 2 && crashes.length === 0 && ourPending.length === 0,
  probeVerdict: /roles-probe\] PASS/.test(boot) ? "PASS" : /roles-probe\] FAIL/.test(boot) ? "FAIL" : "absent",
  compactTools: compactTools === null ? null : `${compactTools[1]}/${compactTools[2]}`,
  compactToolsMissing: compactTools?.[3] === undefined ? [] : compactTools[3].split(",").filter(Boolean),
  standingToolSet: allTools === null ? null : `${allTools[1]}/${allTools[2]}`,
  pendingEntries: pendingLines.map((line) => line.trim()),
  pendingForOurRow: ourPending.length,
  crashSignatures: crashes,
  loadEvidence: "real mounted boot of the installed bundle in an isolated DSH_HOME + sandbox HOME + sandbox workspace, held open until the QA probe's registration instrument reports; --dump-config is deliberately NOT cited as load evidence (AGENTS.md §4)",
}
fs_write(steps)
if (!steps.mountedBoot.ok) {
  fail(`mounted boot did not register the compaction tools (probe=${steps.mountedBoot.probeVerdict}, tools=${String(steps.mountedBoot.compactTools)}, pendingForOurRow=${ourPending.length}, crashes=${crashes.join(",") || "none"})`)
}
console.log(`[t48-mount] ok=true -> ${outDir}`)
for (const [label, step] of Object.entries(steps)) console.log("  " + label + ": " + JSON.stringify(step).slice(0, 300))
rmSync(sandbox, { recursive: true, force: true })
console.log("[t48-mount] PASS")

function fs_write(steps) {
  writeFileSync(join(outDir, `result-${ts}.json`), JSON.stringify({
    task: "t48",
    newRow: "mpd-team-compact",
    head: runSync("git", ["rev-parse", "HEAD"], env, repoRoot).out.trim(),
    steps,
  }, null, 2))
}
