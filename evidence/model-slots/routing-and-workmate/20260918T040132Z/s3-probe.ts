#!/usr/bin/env node
// t10 S3 probe: WHERE does the broken-slot provisioning failure surface? One isolated boot with a
// deliberately broken slot1, then a recursive scan of the whole side home (+ DSH_HOME) for the
// error needles, so the loud-failure claim is anchored to a real artifact instead of a guess.
// Writes s3-probe-files.txt + prints matches. Run with node.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(HERE, "../../../..")
const strip = (env) => { const clean = { ...env }; for (const k of Object.keys(clean)) if (/DEEPSEEK|OPENAI|ANTHROPIC|API_KEY/i.test(k)) delete clean[k]; return clean }

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t10-s3-"))
const install = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, env: { ...strip(process.env), DSH_HOME: sandbox } })
console.log("install exit=" + install.status)

const home = join(sandbox, "s3")
const ws = join(home, "ws")
mkdirSync(ws, { recursive: true })
cpSync(join(sandbox, "profiles"), join(home, "profiles"), { recursive: true })
cpSync(join(sandbox, "cordis.patch.yml"), join(home, "cordis.patch.yml"))
mkdirSync(join(ws, ".mpd"), { recursive: true })
writeFileSync(join(ws, ".mpd", "mpd.jsonc"), "{\n  \"teamModels\": {\n    \"slot1\": { \"provider\": \"deepseek-official\", \"model\": \"no-such-model-xyz\", \"reasoningEffort\": \"high\" }\n  }\n}\n")

const boot = spawnSync("dsh", ["--profile", "mpd-headless", "team: probe the broken slot failure surface"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: ws, env: strip({ ...process.env, DSH_HOME: home, HOME: home }), stdio: ["ignore", "pipe", "pipe"] })
const out = (boot.stdout || "") + (boot.stderr || "")
writeFileSync(join(HERE, "s3-probe-stdout.log"), out)
console.log("boot exit=" + boot.status + "  stdout bytes=" + out.length)

/** Every regular file under `root`, with a decoded text body when it is one. */
function walk(root, acc = []) {
  if (!existsSync(root)) return acc
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) { acc.push({ path: full, dir: true }); walk(full, acc) }
    else {
      let text = ""
      try {
        const raw = readFileSync(full)
        if (full.endsWith(".zstd")) {
          const dec = spawnSync("zstd", ["-d", full, "-c"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
          text = dec.status === 0 ? String(dec.stdout || "") : ""
        } else if (raw.length < 8 * 1024 * 1024) text = raw.toString("utf8")
      } catch { text = "" }
      acc.push({ path: full, size: statSync(full).size, text })
    }
  }
  return acc
}

const files = [...walk(home), ...walk(sandbox).filter((entry) => !entry.path.startsWith(home))]
writeFileSync(join(HERE, "s3-probe-files.txt"), files.map((entry) => (entry.dir ? "dir  " : "file ") + entry.path + (entry.size === undefined ? "" : " (" + entry.size + " B)")).join("\n"))

const NEEDLES = ["provisioning failed", "teamModels.slot1", "no-such-model-xyz", "unknown model", "is not available", "UNSUPPORTED_REASONING_EFFORT", "Architect"]
console.log("\n--- needle hits (file: needle -> first match window) ---")
let hits = 0
for (const file of files) {
  if (file.dir || !file.text) continue
  for (const needle of NEEDLES) {
    const at = file.text.indexOf(needle)
    if (at < 0) continue
    hits += 1
    console.log("\n" + file.path + "\n  [" + needle + "] ..." + file.text.slice(Math.max(0, at - 260), at + 320).replace(/\n/g, "\\n") + "...")
  }
}
console.log("\nneedle hits total=" + hits)
