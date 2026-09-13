// Lane proof #2: the carrier's merge is observable in the session prompt composed at mount time.
// Boots the REAL headless profile (no credentials copied, so the model step fails fast) and greps the
// session log for the agent-teams profile directory text. The mpd `captainPrompt` section renders
// `formatProfilesForPrompt(config.profiles)`, so `rtl-ip` can only appear when the carrier merged it.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { zstdDecompressSync } from "node:zlib"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const SILICON_PROFILE = "/root/dshProj/my-power-dsh-silicon/presets/rtl-ip.profile.json"
const outDir = join(here, "prompt-proof")
rmSync(outDir, { recursive: true, force: true })

function sessionText(home) {
  const root = join(home, "sessions")
  if (!existsSync(root)) return ""
  const chunks = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith(".zstd")) {
        try { chunks.push(zstdDecompressSync(readFileSync(p)).toString("utf8")) } catch { /* skip */ }
      } else if (entry.name.includes("jsonl")) chunks.push(readFileSync(p, "utf8"))
    }
  }
  walk(root)
  return chunks.join("\n")
}

function lane(label, plantSilicon) {
  const sandbox = join(outDir, label)
  const home = join(sandbox, "home")
  const userHome = join(sandbox, "userhome")
  const ws = join(sandbox, "ws")
  const profileDir = join(home, "profiles", "headless")
  for (const d of [home, userHome, ws, profileDir]) mkdirSync(d, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-headless", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } }, null, 2) + "\n")
  const env = { ...process.env, DSH_HOME: home, HOME: userHome }
  const add = spawnSync("dsh", ["plugin", "--profile", "headless", "add", "--store-dir", join(sandbox, "pnpm-store"), repoRoot], { env, cwd: ws, encoding: "utf8", timeout: 600000 })
  if (add.status !== 0) return { label, step: "install", stderr: (add.stderr || "").slice(-400) }
  if (plantSilicon) {
    const target = join(profileDir, "node_modules", "@mpd-dsh", "silicon", "presets")
    mkdirSync(target, { recursive: true })
    cpSync(SILICON_PROFILE, join(target, "rtl-ip.profile.json"))
  }
  // No credentials copied on purpose: the model step fails fast, but the request header with the
  // composed system prompt is written to the session log first.
  const run = spawnSync("dsh", ["--profile", "headless", "reply with the single word ok"], { env, cwd: ws, encoding: "utf8", timeout: 240000 })
  const text = sessionText(home)
  return { label, siliconPlanted: plantSilicon, bootExit: run.status, hasRtlIp: text.includes("rtl-ip"), hasMpdProfile: text.includes("mpd"), sessionBytes: text.length, siliconNote: plantSilicon && text.includes("RTL IP design workflow") }
}

const withSilicon = lane("with-silicon", true)
const withoutSilicon = lane("without-silicon", false)
const checks = {
  "A: session composed with the silicon profile present lists rtl-ip": withSilicon.hasRtlIp === true,
  "A: the silicon profile body is present (RTL IP description)": withSilicon.siliconNote === true,
  "A: mpd profile still listed": withSilicon.hasMpdProfile === true,
  "B: without silicon, rtl-ip is NOT listed": withoutSilicon.hasRtlIp === false,
  "B: mpd profile still listed": withoutSilicon.hasMpdProfile === true,
}
const result = { generatedAt: new Date().toISOString(), withSilicon, withoutSilicon, checks, ok: Object.values(checks).every(Boolean) }
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
for (const [name, pass] of Object.entries(checks)) console.log((pass ? "PASS  " : "FAIL  ") + name)
console.log("carrier prompt proof ok=" + result.ok)
process.exit(result.ok ? 0 : 1)
