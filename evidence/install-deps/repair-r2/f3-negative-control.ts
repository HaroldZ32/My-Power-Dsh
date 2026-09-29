#!/usr/bin/env node
// t11 NEGATIVE CONTROL for repair R1: the fatal mode must really be reachable, so the
// ledger's green arms are a real assertion and not a predicate that can only answer one way.
//
// Composition: the package IS resolvable and the web plane IS present; a foreign sidebar row
// lives in `<profileDir>/cordis.patch.yml` (id `user-sidebar-probe`); an EXTRA `--patch`
// overlay carries the PRE-REPAIR guard row (the scalar banked by the t6 review at
// evidence/install-deps/review/guard.raw.txt, id `legacy-guard-probe`). The pre-repair guard
// scans only declared bundle layers, so it cannot see the profile-layer row and mounts →
// two registrations of /sidebar/api → the boot MUST die with `duplicate prefix route`.
//
// The shipped (repaired) guard, booted on the SAME composition shape, disables its own row
// (ledger arm `profile-layer-mount`): the only difference between the RED and the GREEN arm is
// the guard body under test.
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { seedSandboxCredentials } from "../../../skills/dsh-qa/scripts/lib/credentials.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const OUT = join(HERE, "runs", new Date().toISOString().replaceAll(":", "-"), "negative-control")
const SIDEBAR = "dsh-better-sidebar"
const OLD_GUARD = readFileSync(join(REPO, "evidence", "install-deps", "review", "guard.raw.txt"), "utf8").replace(/\n+$/, "")

async function main() {
  mkdirSync(OUT, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), "mpd-r2-negctl-"))
  const dshHome = join(root, "dsh")
  const userHome = join(root, "home")
  const ws = join(root, "ws")
  const profile = join(dshHome, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true,
    dependencies: { "@mpd-dsh/mpd": "link:" + REPO },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2) + "\n")
  writeFileSync(join(profile, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n")
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: user-sidebar-probe\n      name: '" + SIDEBAR + "'\n")
  const overlay = join(root, "legacy-guard.yml")
  writeFileSync(overlay, "- insert:\n    - id: legacy-guard-probe\n      name: '" + SIDEBAR + "'\n" + OLD_GUARD + "\n")
  seedSandboxCredentials(dshHome)
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))

  const logPath = join(OUT, "boot.log")
  const fd = openSync(logPath, "w")
  const port = 3421
  const args = ["--profile", "w", "--patch", overlay, "--port", String(port), "--no-open"]
  const child = spawn("dsh", args, { env: { ...process.env, DSH_HOME: dshHome, HOME: userHome }, cwd: ws, stdio: ["ignore", fd, fd] })
  const read = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  let token = null
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (read().includes("duplicate prefix route")) break
    if (/token=[A-Za-z0-9_-]+/.test(read())) { token = "printed"; break }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const text = read()
  child.kill("SIGTERM")
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const result = {
    case: "install-deps/repair-r2/f3-negative-control",
    bootCommand: "dsh " + args.join(" "),
    oldGuardSource: "evidence/install-deps/review/guard.raw.txt",
    composition: "package resolvable + web plane + foreign sidebar row in <profileDir>/cordis.patch.yml",
    expected: "the boot DIES with `duplicate prefix route` (the pre-repair guard cannot see the profile layer)",
    duplicatePrefixRoute: text.includes("duplicate prefix route"),
    failedToApplyLoaderEntry: text.includes("failed to apply loader entry"),
    tokenPrinted: token !== null,
    logTail: text.split("\n").filter(Boolean).slice(-6),
  }
  result.ok = result.duplicatePrefixRoute === true && result.tokenPrinted === false
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2) + "\n")
  rmSync(root, { recursive: true, force: true })
  console.log(JSON.stringify(result, null, 2))
  console.log("[f3-negative-control] " + (result.ok ? "RED reproduced as expected" : "FAIL: the control did not reproduce the fatal mode"))
  if (!result.ok) process.exit(1)
}

await main()
