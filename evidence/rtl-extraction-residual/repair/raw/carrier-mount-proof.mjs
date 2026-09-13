#!/usr/bin/env node
// t8 / R5.3 mount proof for the `rtl-ip` carrier hook — a REAL mounting boot, never --dump-config.
//
// Lane A (silicon present): a sandboxed DSH_HOME gets the bundle installed and a sibling
//   `@mpd-dsh/silicon` profile planted at the profile's node_modules path; the probe (mounted by an
//   overlay patch) calls the REAL `agent_teams_create` tool with profile `rtl-ip` — it can only
//   succeed if the carrier merged silicon's profile at apply() time — and again with `mpd` to prove
//   the mpd roster is intact.
// Lane B (silicon absent): the same boot without the planted profile: `rtl-ip` must be reported as
//   an unknown profile (the `{}` fallback), `mpd` must still resolve with its full roster, and the
//   boot must stay up (HTTP 200) — i.e. the absent file is normal, not an error.
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const SILICON_PROFILE = "/root/dshProj/my-power-dsh-silicon/presets/rtl-ip.profile.json"
const outDir = join(here, "mount-proof")
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// The probe must live INSIDE the bundle package: the loader resolves a patch row's module
// relative to the profile, and a path under evidence/** failed to resolve (measured: "path
// argument must be of type string ... Received undefined"). Same location class as roles-probe.
const PROFILE_JSON = JSON.parse(readFileSync(SILICON_PROFILE, "utf8"))
const SILICON_MEMBERS = Object.values(PROFILE_JSON)[0]?.members?.length ?? null

const PROBE_SOURCE = `export const name = "mpd-t8-carrier-probe"
export async function apply(ctx) {
  const fs = process.getBuiltinModule("node:fs")
  const OUT = "__OUT__"
  const log = (o) => fs.appendFileSync(OUT, JSON.stringify(o) + "\\n")
  let dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
  for (let wait = 0; !dsh && wait < 20; wait += 1) { await new Promise((r) => setTimeout(r, 500)); dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined }
  if (!dsh) {
    try {
      const { createDshAdapter } = await import("__ADAPTER__")
      dsh = createDshAdapter(ctx)
    } catch (error) { log({ error: "adapter unavailable: " + String(error?.message ?? error) }); return }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await sleep(1500)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rtl = await dsh.executeTool({ name: "agent_teams_create", arguments: { name: "carrier-probe-rtl", description: "t8 carrier mount proof (rtl-ip)", profile: "rtl-ip", approval: "required" } })
    log({ attempt, profile: "rtl-ip", ok: rtl.ok === true, error: rtl.error ?? null, members: rtl.value?.members?.length ?? null, returnedProfile: rtl.value?.profile ?? null })
    if (rtl.ok === true || String(rtl.error ?? "").includes("unknown AgentTeams profile")) break
    await sleep(500)
  }
  const mpd = await dsh.executeTool({ name: "agent_teams_create", arguments: { name: "carrier-probe-mpd", description: "t8 carrier mount proof (mpd)", profile: "mpd", approval: "required" } })
  log({ profile: "mpd", ok: mpd.ok === true, error: mpd.error ?? null, members: mpd.value?.members?.length ?? null, returnedProfile: mpd.value?.profile ?? null })
  fs.writeFileSync(OUT + ".done", "1")
}
`

async function lane(label, plantSilicon) {
  const sandbox = join(outDir, label)
  const home = join(sandbox, "home")
  const ws = join(sandbox, "ws")
  mkdirSync(home, { recursive: true })
  mkdirSync(ws, { recursive: true })
  const userHome = join(sandbox, "userhome")
  const store = join(sandbox, "pnpm-store")
  const profileDir = join(home, "profiles", "w")
  mkdirSync(userHome, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  // mirror bundle-lifecycle: a pre-seeded profile manifest whose layer list is only appended to,
  // plus an explicit pnpm store inside the sandbox (no reliance on a global store).
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(home, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
  const env = { ...process.env, DSH_HOME: home, HOME: userHome, MPD_REPO_ROOT: repoRoot }
  const run = (cmd, args) => spawnSync(cmd, args, { env, cwd: ws, encoding: "utf8", timeout: 600000 })

  const probeOut = join(sandbox, "probe.jsonl")
  writeFileSync(probeOut, "")
  // The probe must live INSIDE the bundle package (loader resolution) and must NOT depend on env
  // propagation into the harness process (measured: CARRIER_PROBE_OUT did not reach the plugin), so
  // the output path is baked into the generated module.
  const PROBE = join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "carrier-probe-" + label + ".mjs")
  writeFileSync(PROBE, PROBE_SOURCE.replace("__OUT__", probeOut).replace("__ADAPTER__", join(repoRoot, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js")))
  const add = run("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, repoRoot])
  if (add.status !== 0) return { label, step: "install", exit: add.status, stderr: (add.stderr || "").slice(-800) }

  if (plantSilicon) {
    const target = join(home, "profiles", "w", "node_modules", "@mpd-dsh", "silicon", "presets")
    mkdirSync(target, { recursive: true })
    cpSync(SILICON_PROFILE, join(target, "rtl-ip.profile.json"))
  }

  const overlay = join(sandbox, "carrier-probe.patch.yml")
  writeFileSync(overlay, "- insert:\n    - id: carrier-probe\n      name: " + JSON.stringify(PROBE) + "\n")
  const bootLog = join(sandbox, "boot.log")
  const fd = openSync(bootLog, "w")
  const port = 39000 + (plantSilicon ? 1 : 2)
  const child = spawn("dsh", ["--profile", "w", "--patch", overlay, "--port", String(port), "--no-open"], { env, cwd: ws, detached: false, stdio: ["ignore", fd, fd] })

  let http = false
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/plugins/mpd-workmate/list", { signal: AbortSignal.timeout(4000) })
      if (res.status === 200) { http = true; await res.text(); break }
    } catch { /* not up yet */ }
    if (existsSync(probeOut + ".done")) break
  }
  const doneDeadline = Date.now() + 60000
  while (!existsSync(probeOut + ".done") && Date.now() < doneDeadline) await new Promise((r) => setTimeout(r, 1000))
  child.kill("SIGTERM")
  await new Promise((r) => setTimeout(r, 2000))
  const entries = readFileSync(probeOut, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  return { label, exit: 0, http, siliconPlanted: plantSilicon, probe: entries, bootTail: readFileSync(bootLog, "utf8").slice(-1200) }
}

process.on("exit", () => { for (const label of ["with-silicon", "without-silicon"]) { try { rmSync(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "carrier-probe-" + label + ".mjs"), { force: true }) } catch { /* best effort */ } } })

const withSilicon = await lane("with-silicon", true)
const withoutSilicon = await lane("without-silicon", false)

const pick = (laneResult, profile) => [...(laneResult.probe ?? [])].reverse().find((entry) => entry.profile === profile) ?? null
const aRtl = pick(withSilicon, "rtl-ip")
const aMpd = pick(withSilicon, "mpd")
const bRtl = pick(withoutSilicon, "rtl-ip")
const bMpd = pick(withoutSilicon, "mpd")

const checks = {
  "A: boot served HTTP": withSilicon.http === true,
  "A: rtl-ip profile resolved from the silicon file (members == silicon's list)": aRtl?.ok === true && aRtl.members === SILICON_MEMBERS,
  "A: mpd roster intact (11 members)": aMpd?.ok === true && aMpd.members === 11,
  "B: boot stayed up with silicon absent": withoutSilicon.http === true,
  "B: rtl-ip reported unknown ({} fallback)": String(bRtl?.error ?? "").includes("unknown AgentTeams profile"),
  "B: mpd roster still intact (11 members)": bMpd?.ok === true && bMpd.members === 11,
}
const result = { generatedAt: new Date().toISOString(), siliconMembers: SILICON_MEMBERS, lanes: { withSilicon, withoutSilicon }, checks, ok: Object.values(checks).every(Boolean) }
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
for (const [name, pass] of Object.entries(checks)) console.log((pass ? "PASS  " : "FAIL  ") + name)
console.log("carrier mount proof ok=" + result.ok)
process.exit(result.ok ? 0 : 1)
