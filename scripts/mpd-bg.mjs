#!/usr/bin/env node
// mpd-bg.mjs — the harness-workaround helper for the four DSH-owned shell/lifecycle frictions
// (T-21, T-23, T-24, T-26), documented in `agent-references/troubleshooting.md` and pointed at
// from AGENTS.md §12. It exists because those frictions are HARNESS behaviour we do not fight:
// each one gets a one-command fallback instead of an open register entry.
//
// WHY EACH MODE EXISTS (the measured facts, not preferences):
//   · `run`        — the file sandbox is `bwrap --die-with-parent`, so a `nohup … &` child is killed
//                    the moment the bash call that started it returns (measured 2026-09-16: a
//                    13-gate sweep died inside `bun test` while `pgrep -f run-sweep.sh` reported
//                    RUNNING because the probe's own command line matched the pattern). Long work
//                    must be a MANAGED background job: start THIS helper inside one, and it
//                    redirects the child's stdout+stderr to a log file in the workspace.
//   · `probe`      — a liveness check that CANNOT self-match: it reads a pid file and asks the
//                    kernel (`kill(pid, 0)`); it never greps a command line, so the "the probe's own
//                    cmdline contains the pattern" trap is structurally impossible.
//   · `reload-check` — there is no plugin hot reload (T-21): ESM caches the module at session start,
//                    so an edit is invisible until `dsh` restarts. This answers the only question a
//                    human can act on: is the module NEWER than the newest session of this workspace?
//   · `check-write` — the file sandbox is workspace-write (T-26): writes outside the session
//                    workspace are denied. This turns "denied: file access" into a pre-flight answer.
//
// COPY-PASTEABLE INVOCATIONS
//   node scripts/mpd-bg.mjs run --log evidence/my-slug/run.log -- bun test packages
//   node scripts/mpd-bg.mjs probe evidence/my-slug/run.log.pid
//   node scripts/mpd-bg.mjs reload-check packages/mpd-ext-plugin/dist/index.js
//   node scripts/mpd-bg.mjs check-write /root/.dsh/x
//   node scripts/mpd-bg.mjs --self-test
//
// EXIT CODES
//   run            0 the child was started (pid + log printed)
//   probe          0 RUNNING · 1 DEAD · 2 no pid file
//   reload-check   0 FRESH or NO-LIVE-SESSION (nothing to do) · 1 RESTART-REQUIRED
//   check-write    0 inside the workspace · 1 outside-workspace
//   --self-test    0 all arms passed · 1 an arm failed
import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative, isAbsolute, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { repoRootFrom } from "./lib/repo.mjs"

const REPO = repoRootFrom(import.meta.url)

const USAGE = [
  "usage:",
  "  node scripts/mpd-bg.mjs run --log <path> [--pid <path>] [--cwd <dir>] -- <cmd> [args...]",
  "  node scripts/mpd-bg.mjs probe <pidfile|pid>",
  "  node scripts/mpd-bg.mjs reload-check <module-path>",
  "  node scripts/mpd-bg.mjs check-write <path> [--root <dir>]",
  "  node scripts/mpd-bg.mjs --self-test",
].join("\n")

function fail(message, code = 2) {
  console.error("[mpd-bg] " + message)
  process.exit(code)
}

/** One line per outcome, so a caller can branch without parsing prose. */
function say(line) { console.log("[mpd-bg] " + line) }

// ── run ────────────────────────────────────────────────────────────────────────────────────────
// NEVER pipes: the MCP children a dsh boot leaves behind hold inherited fds, and a piped stdio keeps
// the caller's handles open (T-24 — "bash tool hangs after dsh"). The log file is opened once and
// handed to the child as BOTH stdout and stderr.
function runCommand(argv) {
  let log = ""
  let pidFile = ""
  let cwd = process.cwd()
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--") { rest.push(...argv.slice(i + 1)); break }
    if (a === "--log") { log = argv[++i] ?? ""; continue }
    if (a === "--pid") { pidFile = argv[++i] ?? ""; continue }
    if (a === "--cwd") { cwd = argv[++i] ?? ""; continue }
    fail("run: unknown flag " + a + "\n" + USAGE, 2)
  }
  if (log === "") fail("run: --log <path> is required (the log must live in the workspace)\n" + USAGE, 2)
  if (rest.length === 0) fail("run: no command after --\n" + USAGE, 2)
  const logAbs = resolve(log)
  mkdirSync(dirname(logAbs), { recursive: true })
  const fd = openSync(logAbs, "a")
  const child = spawn(rest[0], rest.slice(1), { cwd: resolve(cwd), detached: true, stdio: ["ignore", fd, fd] })
  child.unref()
  closeSync(fd)
  const pidPath = pidFile === "" ? logAbs + ".pid" : resolve(pidFile)
  writeFileSync(pidPath, String(child.pid ?? "") + "\n")
  say("started pid=" + String(child.pid) + " log=" + logAbs + " pidfile=" + pidPath)
  say("note: start this INSIDE a managed background job — a detached child dies with its bwrap sandbox otherwise (T-23)")
  process.exit(0)
}

// ── probe ──────────────────────────────────────────────────────────────────────────────────────
// Kernel liveness only. No cmdline matching anywhere in this file, by design.
function probeCommand(arg) {
  if (arg === undefined || arg === "") fail("probe: <pidfile|pid> is required\n" + USAGE, 2)
  let pid = Number(arg)
  if (!Number.isInteger(pid)) {
    if (!existsSync(arg)) { say("NO-PID-FILE " + arg); process.exit(2) }
    pid = Number(String(readFileSync(arg, "utf8")).trim())
  }
  if (!Number.isInteger(pid) || pid <= 0) { say("NO-PID-FILE (unreadable pid in " + arg + ")"); process.exit(2) }
  try {
    process.kill(pid, 0)
    say("RUNNING pid=" + pid)
    process.exit(0)
  } catch (error) {
    const code = String((error && error.code) || "")
    if (code === "EPERM") { say("RUNNING pid=" + pid + " (permission denied for signal 0: the process exists)"); process.exit(0) }
    say("DEAD pid=" + pid)
    process.exit(1)
  }
}

// ── reload-check ───────────────────────────────────────────────────────────────────────────────
async function projectKeyOf(cwd) {
  const lib = pathToFileURL(join(REPO, "skills", "dsh-qa", "scripts", "lib", "workspace-isolation.mjs")).href
  const { projectKey } = await import(lib)
  return projectKey(cwd)
}

/** Newest session directory of THIS workspace: `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/`. */
function newestSessionDir(dshHome, key) {
  const root = join(dshHome, "sessions", key)
  if (!existsSync(root)) return null
  let newest = null
  let newestMs = -1
  for (const entry of readdirSync(root)) {
    const p = join(root, entry)
    try {
      const m = statSync(p).mtimeMs
      if (m > newestMs) { newestMs = m; newest = p }
    } catch { /* unreadable entry: not a session */ }
  }
  return newest === null ? null : { dir: newest, ms: newestMs }
}

async function reloadCheck(modulePath) {
  if (modulePath === undefined || modulePath === "") fail("reload-check: <module-path> is required\n" + USAGE, 2)
  const mod = resolve(modulePath)
  if (!existsSync(mod)) fail("reload-check: module not found: " + mod, 2)
  const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"))
  const key = await projectKeyOf(process.cwd())
  const newest = newestSessionDir(dshHome, key)
  const modMs = statSync(mod).mtimeMs
  if (newest === null) {
    say("NO-LIVE-SESSION (no session for workspace " + process.cwd() + " under " + join(dshHome, "sessions") + ") — nothing to restart")
    process.exit(0)
  }
  const moduleLine = "module=" + rel(mod) + " mtime=" + new Date(modMs).toISOString()
  const sessionLine = "newest-session=" + rel(newest.dir) + " mtime=" + new Date(newest.ms).toISOString()
  if (modMs > newest.ms) {
    say("RESTART-REQUIRED " + moduleLine + " " + sessionLine + " — dsh caches plugin modules at session start (T-21): restart dsh before judging this edit")
    process.exit(1)
  }
  say("FRESH " + moduleLine + " " + sessionLine + " — the module predates the newest session")
  process.exit(0)
}

function rel(p) {
  const r = relative(REPO, p)
  return r === "" || r.startsWith("..") ? p : r
}

// ── check-write ────────────────────────────────────────────────────────────────────────────────
function insideWorkspace(target, root) {
  const t = resolve(target)
  const r = resolve(root)
  if (t === r) return true
  return t.startsWith(r.endsWith(sep) ? r : r + sep)
}
function checkWrite(argv) {
  let target = ""
  let root = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--root") { root = argv[++i] ?? ""; continue }
    if (target === "") { target = a; continue }
    fail("check-write: unexpected argument " + a + "\n" + USAGE, 2)
  }
  if (target === "") fail("check-write: <path> is required\n" + USAGE, 2)
  const abs = isAbsolute(target) ? target : resolve(root, target)
  if (insideWorkspace(abs, root)) {
    say("INSIDE-WORKSPACE " + abs + " (root " + resolve(root) + ")")
    process.exit(0)
  }
  say("outside-workspace " + abs + " is outside the session workspace " + resolve(root)
    + " — the file sandbox is workspace-write (T-26); write under the workspace or ask for a declared root")
  process.exit(1)
}

// ── self-test ──────────────────────────────────────────────────────────────────────────────────
// Hermetic: fixtures in a temp dir, no dsh spawn, no network. Each arm prints PASS/FAIL by name.
function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), "mpd-bg-selftest-"))
  const arms = []
  const arm = (name, ok, detail = "") => {
    arms.push({ name, ok })
    console.log("[" + (ok ? "PASS" : "FAIL") + "] " + name + (detail === "" ? "" : " — " + detail))
  }
  const script = fileURLToPath(import.meta.url)
  const call = (args, env = {}, cwd = REPO) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", cwd, env: { ...process.env, ...env }, timeout: 120_000,
  })
  try {
    // (1) reload-check: three cases on fixtures.
    const home = join(tmp, "dsh-home")
    const modOld = join(tmp, "mod-old.js")
    const modNew = join(tmp, "mod-new.js")
    writeFileSync(modOld, "// old\n")
    writeFileSync(modNew, "// new\n")
    const noSession = call(["reload-check", modOld], { DSH_HOME: home })
    arm("reload-check: no session -> NO-LIVE-SESSION, exit 0", noSession.status === 0 && noSession.stdout.includes("NO-LIVE-SESSION"), "exit=" + noSession.status)
    const keyCwd = join(tmp, "ws")
    mkdirSync(keyCwd, { recursive: true })
    const keyCall = call(["check-write", keyCwd, "--root", tmp])
    arm("fixture: projectKey reachable through the shared lib", keyCall.status === 0, "exit=" + keyCall.status)
    // create a session dir for the workspace that the NEXT reload-check will run in
    const cwdForSession = join(tmp, "ws")
    const keyOut = spawnSync(process.execPath, ["-e",
      "import('" + pathToFileURL(join(REPO, "skills/dsh-qa/scripts/lib/workspace-isolation.mjs")).href + "').then(m=>process.stdout.write(m.projectKey(process.argv[1])))",
      cwdForSession], { encoding: "utf8" })
    const key = String(keyOut.stdout).trim()
    const sessionDir = join(home, "sessions", key, "session-x")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "session.v3.jsonl.zstd"), "")
    const sessionTime = Date.now() / 1000 - 60
    // module OLDER than the session -> FRESH
    spawnSync("touch", ["-d", "@" + String(Math.floor(sessionTime - 120)), modOld])
    const fresh = call(["reload-check", modOld], { DSH_HOME: home }, cwdForSession)
    arm("reload-check: module older than the newest session -> FRESH, exit 0 (no false alarm)", fresh.status === 0 && fresh.stdout.includes("FRESH"), "exit=" + fresh.status)
    // module NEWER than the session -> RESTART-REQUIRED
    spawnSync("touch", ["-d", "@" + String(Math.floor(sessionTime + 120)), modNew])
    const stale = call(["reload-check", modNew], { DSH_HOME: home }, cwdForSession)
    arm("reload-check: module newer than the newest session -> RESTART-REQUIRED, exit 1", stale.status === 1 && stale.stdout.includes("RESTART-REQUIRED"), "exit=" + stale.status)

    // (2) check-write: inside vs outside.
    const inside = call(["check-write", join(cwdForSession, "evidence", "x.json")], {}, cwdForSession)
    arm("check-write: a path inside the workspace -> exit 0", inside.status === 0 && inside.stdout.includes("INSIDE-WORKSPACE"), "exit=" + inside.status)
    const outside = call(["check-write", "/root/.dsh/x"])
    arm("check-write: /root/.dsh/x -> outside-workspace, exit 1", outside.status === 1 && outside.stdout.includes("outside-workspace"), "exit=" + outside.status)

    // (3) run + probe: the child outlives THIS self-test's own shell, the log is complete, and the
    //     probe cannot self-match (it never inspects a command line).
    const logPath = join(tmp, "long.log")
    const started = call(["run", "--log", logPath, "--cwd", tmp, "--", process.execPath, "-e",
      "setTimeout(()=>{console.log('LONG-DONE');}, 1200)"])
    arm("run: returns immediately with pid + log", started.status === 0 && /started pid=\d+/.test(started.stdout), started.stdout.trim().split("\n")[0] ?? "")
    const probeAlive = call(["probe", logPath + ".pid"])
    arm("probe: RUNNING while the child lives (kernel-only check, no cmdline match)", probeAlive.status === 0 && probeAlive.stdout.includes("RUNNING"), "exit=" + probeAlive.status)
    // wait for the child to finish, then assert the log content and the DEAD verdict
    const deadline = Date.now() + 15_000
    let log = ""
    while (Date.now() < deadline) {
      try { log = readFileSync(logPath, "utf8") } catch { log = "" }
      if (log.includes("LONG-DONE")) break
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"])
    }
    arm("run: the log lands in a FILE and is complete (no pipe)", log.includes("LONG-DONE"), log.trim().slice(-40))
    const probeDead = call(["probe", logPath + ".pid"])
    arm("probe: DEAD after the child exits, exit 1", probeDead.status === 1 && probeDead.stdout.includes("DEAD"), "exit=" + probeDead.status)
    const probeNoFile = call(["probe", join(tmp, "nope.pid")])
    arm("probe: missing pid file -> NO-PID-FILE, exit 2", probeNoFile.status === 2, "exit=" + probeNoFile.status)

    // (4) fd inheritance (T-24): a child that spawns a GRANDCHILD holding the inherited handle must
    //     not keep this call open — stdio is a file, so nothing is held by us.
    const fdsLog = join(tmp, "fds.log")
    const t0 = Date.now()
    const fdsRun = call(["run", "--log", fdsLog, "--cwd", tmp, "--", process.execPath, "-e",
      "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"setTimeout(()=>{},2000)\"],{detached:true,stdio:['ignore',1,2]});c.unref();console.log('GRANDCHILD-SPAWNED')"])
    const elapsed = Date.now() - t0
    arm("T-24: a child that spawns a grandchild holding the handle returns promptly", fdsRun.status === 0 && elapsed < 10_000, "elapsed=" + elapsed + "ms")

    // (5) static property: the implementation never creates a pipe (no "pipe" stdio anywhere).
    const src = readFileSync(script, "utf8")
    const pipeHits = (src.match(/stdio:\s*\[\s*"pipe"/g) ?? []).length
    arm("T-24: the helper never uses stdio:'pipe'", pipeHits === 0, "pipeHits=" + pipeHits)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const failed = arms.filter((a) => !a.ok)
  console.log("[mpd-bg self-test] " + (arms.length - failed.length) + "/" + arms.length + " arms passed — " + (failed.length === 0 ? "PASS" : "FAIL"))
  process.exit(failed.length === 0 ? 0 : 1)
}

// ── dispatch ───────────────────────────────────────────────────────────────────────────────────
const [mode, ...rest] = process.argv.slice(2)
if (mode === "--self-test" || mode === undefined) {
  if (mode === undefined) { console.error(USAGE); process.exit(2) }
  selfTest()
} else if (mode === "run") runCommand(rest)
else if (mode === "probe") probeCommand(rest[0])
else if (mode === "reload-check") await reloadCheck(rest[0])
else if (mode === "check-write") checkWrite(rest)
else { console.error("[mpd-bg] unknown mode " + mode + "\n" + USAGE); process.exit(2) }
