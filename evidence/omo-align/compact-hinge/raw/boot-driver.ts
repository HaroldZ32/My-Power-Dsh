#!/usr/bin/env node
// t45 boot driver: a REAL mounted boot in an isolated DSH_HOME + sandbox HOME + sandbox
// workspace, from this checkout, with the t45 probe added as a HOST-plane row.
// `--dump-config` is deliberately NOT used as load evidence.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync, appendFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(dirname(dirname(dirname(HERE))))          // <repo>
const PROBE = join(HERE, process.env.MPD_HINGE_PROBE || "probe-host.mjs")
const TAG = process.argv[2] || "default"
const INJECT = process.argv[3] || "[]"                             // "[]" or "['compaction']"

const sandbox = mkdtempSync(join(tmpdir(), `mpd-t45-${TAG}-`))
const out = join(HERE, `probe-${TAG}.jsonl`)
writeFileSync(out, "")
const ws = join(sandbox, "ws")
mkdirSync(ws, { recursive: true })
// credentials so the boot gets past credential resolution (not the subject under test)
if (existsSync(join(homedir(), ".dsh", ".credentials.yaml")))
  cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(sandbox, ".credentials.yaml"))
if (existsSync(join(homedir(), ".dsh", "settings.yaml")))
  cpSync(join(homedir(), ".dsh", "settings.yaml"), join(sandbox, "settings.yaml"))

// 1) isolated install: profile + preset
const install = spawnSync(process.execPath, [
  join(repoRoot, "scripts", "install-profile.mjs"), "--yes",
  "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain",
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, env: { ...process.env, DSH_HOME: sandbox } })

// 2) add the probe as a HOST-plane row (the home patch, NOT the preset plane)
const patch = join(sandbox, "cordis.patch.yml")
const row = `\n- insert:\n    - id: t45-hinge-probe\n      name: '${PROBE}'\n      config:\n        injectDeclared: ${JSON.stringify(INJECT)}\n`
if (existsSync(patch)) appendFileSync(patch, row)
else writeFileSync(patch, row)

// 3) REAL boot (headless one-shot). A prompt is supplied so a session/agent really exists.
const boot = spawnSync("dsh", ["--profile", "mpd-headless", "Reply with exactly: hinge-ok"], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: ws,
  env: { ...process.env, DSH_HOME: sandbox, HOME: sandbox, MPD_HINGE_OUT: out },
  stdio: ["ignore", "pipe", "pipe"],
})

const CRASH = ["unsupported JSON schema", "JsonSchemaError", "plugin tree failed to load",
  "failed to apply loader entry", "cannot get property"]
const log = (boot.stdout || "") + (boot.stderr || "")
const summary = {
  tag: TAG, injectDeclared: INJECT,
  sandbox,
  installExit: install.status,
  bootExit: boot.status,
  crashSignatures: CRASH.filter((s) => log.includes(s)),
  pendingEntries: [...log.matchAll(/pending \(waiting for service[^)]*\)/g)].map((m) => m[0]).slice(0, 5),
  probeLines: existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
  workspaceKeys: null,
  logHead: log.split("\n").slice(0, 25).join("\n"),
}
writeFileSync(join(HERE, `boot-${TAG}.json`), JSON.stringify(summary, null, 2))
writeFileSync(join(HERE, `boot-${TAG}.log`), log)
console.log(JSON.stringify({ tag: TAG, install: install.status, boot: boot.status, crash: summary.crashSignatures, probeLines: summary.probeLines.length }, null, 1))
