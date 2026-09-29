#!/usr/bin/env node
// t22 integration proof: seed an isolated workspace with 3 stale empty staged teams
// + 3 protected teams, then run a REAL dsh session in that workspace and assert the
// reclamation happened during the boot (not just in a unit test).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..", "..", "..")
const sandbox = join(here, "sandbox")
const stateDir = join(".mpd", "team")
const HOUR = 3600000
const log = []
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] })
  log.push("$ " + [cmd, ...args].join(" ") + "\n[[exit=" + r.status + "]]\n" + ((r.stdout || "") + (r.stderr || "")).slice(0, 4000))
  return r
}
// isolated install
mkdirSync(sandbox, { recursive: true })
cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(sandbox, ".credentials.yaml"))
const settings = join(homedir(), ".dsh", "settings.yaml")
if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
const env = { ...process.env, DSH_HOME: sandbox, HOME: sandbox }
const inst = run(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env })
if (inst.status !== 0) { console.log(JSON.stringify({ ok: false, step: "install" })); process.exit(1) }
// seed the workspace
const ws = join(sandbox, "ws")
const stateRoot = join(ws, stateDir)
const write = (id, record) => {
  mkdirSync(join(stateRoot, id, "inbox"), { recursive: true })
  writeFileSync(join(stateRoot, id, "team.json"), JSON.stringify({ id, name: id, captainSessionId: "session-seed", createdAt: Date.now(), taskSeq: 0, phase: "staged", members: [], tasks: [], ...record }, null, 2))
}
const old = Date.now() - 3 * HOUR
for (const id of ["seed-stale-1", "seed-stale-2", "seed-stale-3"]) write(id, { createdAt: old })
write("seed-with-tasks", { createdAt: old, tasks: [{ id: "t1", subject: "planned", status: "pending", dependencies: [], createdAt: old, updatedAt: old }] })
write("seed-approved", { createdAt: old, approvedAt: old + 1000 })
write("seed-running", { createdAt: old, phase: "running", approvedAt: old + 1000 })
const protectedBefore = Object.fromEntries(["seed-with-tasks", "seed-approved", "seed-running"].map((id) => [id, readFileSync(join(stateRoot, id, "team.json"), "utf8")]))
const liveBefore = readdirSync(stateRoot).filter((n) => n !== "archive" && !n.startsWith(".") && existsSync(join(stateRoot, n, "team.json"))).sort()
// run a REAL session whose prompt is simple (silent gate) so only the reclamation acts
const live = run("dsh", ["--profile", "mpd-headless", "Reply with exactly: hello-ok"], { env, cwd: ws, timeout: 600000 })
const liveAfter = readdirSync(stateRoot).filter((n) => n !== "archive" && !n.startsWith(".") && existsSync(join(stateRoot, n, "team.json"))).sort()
const archived = existsSync(join(stateRoot, "archive")) ? readdirSync(join(stateRoot, "archive")).sort() : []
const protectedIdentical = Object.entries(protectedBefore).every(([id, text]) => existsSync(join(stateRoot, id, "team.json")) && readFileSync(join(stateRoot, id, "team.json"), "utf8") === text)
const staleGone = ["seed-stale-1", "seed-stale-2", "seed-stale-3"].every((id) => !liveAfter.includes(id) && archived.includes(id))
const result = {
  ok: staleGone && protectedIdentical && ["seed-with-tasks", "seed-approved", "seed-running"].every((id) => liveAfter.includes(id)),
  step: "integration", sessionExit: live.status,
  liveBefore, liveAfter, archived,
  staleStagedArchived: staleGone, protectedByteIdentical: protectedIdentical,
  boundarySeen: log.some((entry) => entry.includes("stale staged team")),
}
writeFileSync(join(here, "result.json"), JSON.stringify(result, null, 2))
writeFileSync(join(here, "output.log"), log.join("\n\n---\n\n"))
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
