#!/usr/bin/env node
// Case skill-load: under an isolated DSH_HOME, run real dsh headless to have the model load an omo skill via the skill tool and cite its identity.
// --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const JOB = "First use the skill tool to load the skill named ulw-plan, then cite its identity (Prometheus) and explain the skill's purpose in one sentence. Do not use bash or other tools."
const FIXTURE_ANSWER = "Prometheus — planning consultant"

function selfTest() {
  if (FIXTURE_ANSWER.includes("Prometheus") !== true) { console.error("[skill-load self-test] FAIL: fixture broken"); process.exit(1) }
  if ("not loaded".includes("Prometheus") !== false) { console.error("[skill-load self-test] FAIL: negative detection broken"); process.exit(1) }
  console.log("[skill-load self-test] ok: identity/flag detection verified on fixture")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[skill-load] missing credentials: " + creds); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const t0 = Date.now()
  const env = { ...process.env, DSH_HOME: sandbox }
  if (env.DSH_HOME !== sandbox) { console.error("[skill-load] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
  const run = spawnSync("dsh", ["--profile", "headless", "--patch", join(repoRoot, "packages/omo-dsh-bundle/cordis.patch.yml"), JOB], {
    env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000
  })
  const ms = Date.now() - t0
  const out = (run.stdout || "") + (run.stderr || "")
  const ok = run.status === 0 && /ulw-plan/.test(out) && /Prometheus/.test(out)
  const outDir = join(repoRoot, "evidence", "dsh-qa", "skill-load", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, durationMs: ms, exit: run.status, skillLoaded: /ulw-plan/.test(out), identityQuoted: /Prometheus/.test(out) }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[skill-load] ok=" + ok + " (" + ms + "ms, exit=" + run.status + ") -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[skill-load] PASS")
}

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
