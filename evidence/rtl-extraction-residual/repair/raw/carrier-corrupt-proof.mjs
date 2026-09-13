// R5.3 ruling V-hook-corrupt-fallthrough: the FIRST readable candidate DECIDES (real boots only).
// The hook resolves from the repo-side plugin path, so candidates are planted inside the repo's
// node_modules chain (gitignored): candidate #1 = require.resolve target
// (<repo>/node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json), farther = the walk-up level at
// <repo>/packages/node_modules/... . If the code CONTINUED past a corrupt candidate it would merge the
// farther valid copy and log NOTHING; the ruling's stop shows up as exactly one named warning.
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const SILICON_PROFILE = "/root/dshProj/my-power-dsh-silicon/presets/rtl-ip.profile.json"
// Resolution order measured on the loaded module path: <repo>/packages/node_modules comes FIRST
// (require.resolve walks up from packages/mpd-agent-teams-plugin/lib), <repo>/node_modules SECOND.
const NEAREST = join(repoRoot, "packages", "node_modules", "@mpd-dsh", "silicon", "presets", "rtl-ip.profile.json")
const FARTHER = join(repoRoot, "node_modules", "@mpd-dsh", "silicon", "presets", "rtl-ip.profile.json")
const BACKUP = join(here, "corrupt-proof", "nearest.backup.json")
const outDir = join(here, "corrupt-proof")
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const hadNearest = existsSync(NEAREST)
if (hadNearest) copyFileSync(NEAREST, BACKUP)

function setNearest(kind) {
  rmSync(NEAREST, { force: true, recursive: true })
  if (kind === "none") return
  mkdirSync(dirname(NEAREST), { recursive: true })
  if (kind === "valid") copyFileSync(SILICON_PROFILE, NEAREST)
  // NOTE: a chmod-000 file is NOT unreadable for root (measured: the lane merged the farther copy),
  // so an existing-but-unreadable candidate is simulated with a DIRECTORY at the candidate path
  // (readFileSync -> EISDIR, i.e. a non-ENOENT read failure).
  else if (kind === "unreadable") { mkdirSync(NEAREST, { recursive: true }) }
  else writeFileSync(NEAREST, '{"rtl-ip": {broken')
}
function setFarther(kind) {
  rmSync(FARTHER, { force: true })
  if (kind === "none") return
  mkdirSync(dirname(FARTHER), { recursive: true })
  copyFileSync(SILICON_PROFILE, FARTHER)
}

async function lane(label, nearest, farther) {
  setNearest(nearest); setFarther(farther)
  const sandbox = join(outDir, label)
  const home = join(sandbox, "home")
  const userHome = join(sandbox, "userhome")
  const ws = join(sandbox, "ws")
  const profileDir = join(home, "profiles", "w")
  for (const d of [home, userHome, ws, profileDir]) mkdirSync(d, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  const env = { ...process.env, DSH_HOME: home, HOME: userHome }
  const add = spawnSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", join(sandbox, "pnpm-store"), repoRoot], { env, cwd: ws, encoding: "utf8", timeout: 600000 })
  if (add.status !== 0) return { label, step: "install", stderr: (add.stderr || "").slice(-300) }
  const bootLog = join(sandbox, "boot.log")
  const fd = openSync(bootLog, "w")
  const port = 39600 + label.length
  const child = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env, cwd: ws, detached: false, stdio: ["ignore", fd, fd] })
  let http = false
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    try { const res = await fetch("http://127.0.0.1:" + port + "/plugins/mpd-workmate/list", { signal: AbortSignal.timeout(4000) }); if (res.status === 200) { http = true; await res.text(); break } } catch { /* not up */ }
  }
  child.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 1500))
  const boot = readFileSync(bootLog, "utf8")
  const warnings = boot.split("\n").filter((line) => line.includes("[mpd] agent-teams: ignoring the silicon rtl-ip profile"))
  return { label, nearest, farther, http, warnings: warnings.length, namesNearest: warnings.some((w) => w.includes(NEAREST)), sample: warnings[0] ?? null }
}

const lanes = []
lanes.push(await lane("valid-nearest", "valid", "none"))
lanes.push(await lane("all-absent", "none", "none"))
lanes.push(await lane("corrupt-nearest", "corrupt", "none"))
lanes.push(await lane("corrupt-nearest-valid-farther", "corrupt", "valid"))
lanes.push(await lane("unreadable-nearest-valid-farther", "unreadable", "valid"))

setNearest("none"); setFarther("none")
if (hadNearest) { mkdirSync(dirname(NEAREST), { recursive: true }); copyFileSync(BACKUP, NEAREST) }

const by = Object.fromEntries(lanes.map((l) => [l.label, l]))
const checks = {
  "valid nearest: boot up, zero warnings": by["valid-nearest"]?.http === true && by["valid-nearest"]?.warnings === 0,
  "all absent: boot up, zero warnings": by["all-absent"]?.http === true && by["all-absent"]?.warnings === 0,
  "corrupt nearest: boot up, exactly ONE warning naming it": by["corrupt-nearest"]?.http === true && by["corrupt-nearest"]?.warnings === 1 && by["corrupt-nearest"]?.namesNearest === true,
  "corrupt nearest + VALID farther: still ONE warning naming the corrupt candidate (no continue)": by["corrupt-nearest-valid-farther"]?.http === true && by["corrupt-nearest-valid-farther"]?.warnings === 1 && by["corrupt-nearest-valid-farther"]?.namesNearest === true,
  "unreadable-but-existing nearest + VALID farther: ONE warning naming it, no continue": by["unreadable-nearest-valid-farther"]?.http === true && by["unreadable-nearest-valid-farther"]?.warnings === 1 && by["unreadable-nearest-valid-farther"]?.namesNearest === true,
  "planted candidates cleaned up / pre-existing restored": !existsSync(FARTHER) && existsSync(NEAREST) === hadNearest,
}
const result = { generatedAt: new Date().toISOString(), hadNearest, lanes, checks, ok: Object.values(checks).every(Boolean) }
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
for (const [name, pass] of Object.entries(checks)) console.log((pass ? "PASS  " : "FAIL  ") + name)
console.log("carrier corrupt-fallthrough proof ok=" + result.ok)
process.exit(result.ok ? 0 : 1)
