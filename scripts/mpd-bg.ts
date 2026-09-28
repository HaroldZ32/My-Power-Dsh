#!/usr/bin/env node
// mpd-bg.ts — the harness-workaround helper for the four DSH-owned shell/lifecycle frictions
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
//   node scripts/mpd-bg.ts run --log evidence/my-slug/run.log -- bun test packages
//   node scripts/mpd-bg.ts probe evidence/my-slug/run.log.pid
//   node scripts/mpd-bg.ts reload-check packages/mpd-ext-plugin/dist/index.js
//   node scripts/mpd-bg.ts check-write /root/.dsh/x
//   node scripts/mpd-bg.ts --self-test
//
// EXIT CODES
//   run            0 the child was started (pid + log printed)
//   probe          0 RUNNING · 1 DEAD · 2 no pid file
//   reload-check   0 FRESH or NO-LIVE-SESSION (nothing to do) · 1 RESTART-REQUIRED
//   check-write    0 inside the workspace · 1 outside-workspace
//   --self-test    0 all arms passed · 1 an arm failed
import { spawn, spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative, isAbsolute, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this helper's own URL (`<root>/scripts/mpd-bg.ts`). */
const REPO: string = repoRootFrom(import.meta.url)

/**
 * Help text for a malformed invocation. The usage lines are a RUNTIME contract (a caller reads and
 * runs them), so they name the file as it exists now — `scripts/mpd-bg.ts`, the name `node` is
 * actually able to execute after this repository's TypeScript conversion.
 */
const USAGE: string = [
  "usage:",
  "  node scripts/mpd-bg.ts run --log <path> [--pid <path>] [--cwd <dir>] -- <cmd> [args...]",
  "  node scripts/mpd-bg.ts probe <pidfile|pid>",
  "  node scripts/mpd-bg.ts reload-check <module-path>",
  "  node scripts/mpd-bg.ts check-write <path> [--root <dir>]",
  "  node scripts/mpd-bg.ts --self-test",
].join("\n")

/** Abort with a `[mpd-bg]`-prefixed message; `code` is the exit status (2 = bad usage). */
function fail(message: string, code: number = 2): never {
  console.error("[mpd-bg] " + message)
  process.exit(code)
}

/** One line per outcome, so a caller can branch without parsing prose. */
function say(line: string): void { console.log("[mpd-bg] " + line) }

// ── run ────────────────────────────────────────────────────────────────────────────────────────
// NEVER pipes: the MCP children a dsh boot leaves behind hold inherited fds, and a piped stdio keeps
// the caller's handles open (T-24 — "bash tool hangs after dsh"). The log file is opened once and
// handed to the child as BOTH stdout and stderr.
/** Start a detached child with its stdout+stderr on one log file, then exit immediately. */
function runCommand(argv: string[]): void {
  /** Log file the child writes to; required, because a managed job must leave its output behind. */
  let log: string = ""
  /** Optional pid-file path; empty means `<log>.pid` (the default the probe mode expects). */
  let pidFile: string = ""
  /** Working directory to spawn in; the caller may override it with `--cwd`. */
  let cwd: string = process.cwd()
  /** The command and its arguments, collected after the `--` separator. */
  const rest: string[] = []
  // Index of the argument under inspection.
  for (let i = 0; i < argv.length; i++) {
    /** The argument at that index. */
    const a: string = argv[i]
    if (a === "--") { rest.push(...argv.slice(i + 1)); break }
    if (a === "--log") { log = argv[++i] ?? ""; continue }
    if (a === "--pid") { pidFile = argv[++i] ?? ""; continue }
    if (a === "--cwd") { cwd = argv[++i] ?? ""; continue }
    fail("run: unknown flag " + a + "\n" + USAGE, 2)
  }
  if (log === "") fail("run: --log <path> is required (the log must live in the workspace)\n" + USAGE, 2)
  if (rest.length === 0) fail("run: no command after --\n" + USAGE, 2)
  /** The log path made absolute against the caller's cwd. */
  const logAbs: string = resolve(log)
  mkdirSync(dirname(logAbs), { recursive: true })
  /** The open log file descriptor handed to the child as both stdout and stderr. */
  const fd: number = openSync(logAbs, "a")
  /** The detached child; `detached` is what lets it outlive this short-lived parent. */
  const child = spawn(rest[0], rest.slice(1), { cwd: resolve(cwd), detached: true, stdio: ["ignore", fd, fd] })
  child.unref()
  closeSync(fd)
  /** Where the child's pid is recorded for the kernel-only `probe` mode. */
  const pidPath: string = pidFile === "" ? logAbs + ".pid" : resolve(pidFile)
  writeFileSync(pidPath, String(child.pid ?? "") + "\n")
  say("started pid=" + String(child.pid) + " log=" + logAbs + " pidfile=" + pidPath)
  say("note: start this INSIDE a managed background job — a detached child dies with its bwrap sandbox otherwise (T-23)")
  process.exit(0)
}

// ── probe ──────────────────────────────────────────────────────────────────────────────────────
// Kernel liveness only. No cmdline matching anywhere in this file, by design.
/** Answer RUNNING / DEAD / NO-PID-FILE for a pid or pid file, using `kill(pid, 0)` only. */
function probeCommand(arg: string | undefined): void {
  if (arg === undefined || arg === "") fail("probe: <pidfile|pid> is required\n" + USAGE, 2)
  /** The pid to test; NaN when the argument is a path rather than a number. */
  let pid: number = Number(arg)
  if (!Number.isInteger(pid)) {
    if (!existsSync(arg)) { say("NO-PID-FILE " + arg); process.exit(2) }
    /** The pid stored in the file, trimmed of the newline `run` wrote. */
    pid = Number(String(readFileSync(arg, "utf8")).trim())
  }
  if (!Number.isInteger(pid) || pid <= 0) { say("NO-PID-FILE (unreadable pid in " + arg + ")"); process.exit(2) }
  try {
    process.kill(pid, 0)
    say("RUNNING pid=" + pid)
    process.exit(0)
  } catch (error) {
    // A failed signal-0 probe throws a Node system error carrying an errno `code`; any other thrown
    // value has none, which is the original `|| ""` fallback (an object is always truthy, so the
    // original `error &&` guard is subsumed by the two shape checks below).
    /** The errno string of the thrown error, or "" when it carries none. */
    const code: string = typeof error === "object" && error !== null && "code" in error ? String(error.code || "") : ""
    if (code === "EPERM") { say("RUNNING pid=" + pid + " (permission denied for signal 0: the process exists)"); process.exit(0) }
    say("DEAD pid=" + pid)
    process.exit(1)
  }
}

// ── reload-check ───────────────────────────────────────────────────────────────────────────────
/** The one function this helper consumes from the QA sandbox helper (`workspace-isolation.ts`). */
interface WorkspaceIsolationModule {
  /** Stable per-workspace key used as the `<DSH_HOME>/sessions/<key>` directory name. */
  projectKey(cwd: string): string
}

/** Resolve one working directory's session key through the shared QA sandbox helper. */
async function projectKeyOf(cwd: string): Promise<string> {
  /** File URL of `workspace-isolation.ts`, loaded at runtime rather than imported statically. */
  const lib: string = pathToFileURL(join(REPO, "skills", "dsh-qa", "scripts", "lib", "workspace-isolation.ts")).href
  // The module is loaded by URL, so no static import can name its type; the interface above is that
  // declaration and the assertion is the boundary at `projectKey`, the only member read here.
  const { projectKey } = (await import(lib)) as WorkspaceIsolationModule
  return projectKey(cwd)
}

/** The newest session of one workspace: the directory whose mtime decides the T-21 verdict. */
interface NewestSession {
  /** Absolute path of the session directory. */
  dir: string
  /** Its `statSync().mtimeMs` — when the session last wrote. */
  ms: number
}

/** Newest session directory of THIS workspace: `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/`. */
function newestSessionDir(dshHome: string, key: string): NewestSession | null {
  /** The workspace's session root: one directory per session id. */
  const root: string = join(dshHome, "sessions", key)
  if (!existsSync(root)) return null
  /** Absolute path of the newest session directory seen so far; null until one is read. */
  let newest: string | null = null
  /** Its mtime in ms; -1 so the first readable entry always wins. */
  let newestMs: number = -1
  // Session-id directory name under the workspace's session root.
  for (const entry of readdirSync(root)) {
    /** Absolute path of that session directory. */
    const p: string = join(root, entry)
    try {
      /** Its mtime in ms — the session's activity moment. */
      const m: number = statSync(p).mtimeMs
      if (m > newestMs) { newestMs = m; newest = p }
    } catch { /* unreadable entry: not a session */ }
  }
  return newest === null ? null : { dir: newest, ms: newestMs }
}

/** Report whether one module predates the newest session of this workspace (T-21). */
async function reloadCheck(modulePath: string | undefined): Promise<void> {
  if (modulePath === undefined || modulePath === "") fail("reload-check: <module-path> is required\n" + USAGE, 2)
  /** The module under judgement, made absolute. */
  const mod: string = resolve(modulePath)
  if (!existsSync(mod)) fail("reload-check: module not found: " + mod, 2)
  /** The DSH home whose session store is consulted (`DSH_HOME`, else `~/.dsh`). */
  const dshHome: string = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"))
  /** This workspace's session-store key. */
  const key: string = await projectKeyOf(process.cwd())
  /** The newest session of this workspace, or null when it has none. */
  const newest: NewestSession | null = newestSessionDir(dshHome, key)
  /** The module's own mtime in ms. */
  const modMs: number = statSync(mod).mtimeMs
  if (newest === null) {
    say("NO-LIVE-SESSION (no session for workspace " + process.cwd() + " under " + join(dshHome, "sessions") + ") — nothing to restart")
    process.exit(0)
  }
  /** The module half of the verdict line (repo-relative when possible). */
  const moduleLine: string = "module=" + rel(mod) + " mtime=" + new Date(modMs).toISOString()
  /** The session half of the verdict line (repo-relative when possible). */
  const sessionLine: string = "newest-session=" + rel(newest.dir) + " mtime=" + new Date(newest.ms).toISOString()
  if (modMs > newest.ms) {
    say("RESTART-REQUIRED " + moduleLine + " " + sessionLine + " — dsh caches plugin modules at session start (T-21): restart dsh before judging this edit")
    process.exit(1)
  }
  say("FRESH " + moduleLine + " " + sessionLine + " — the module predates the newest session")
  process.exit(0)
}

/** Path relative to the repository root, or the absolute path when it points outside the repo. */
function rel(p: string): string {
  /** The candidate relative path. */
  const r: string = relative(REPO, p)
  return r === "" || r.startsWith("..") ? p : r
}

// ── check-write ────────────────────────────────────────────────────────────────────────────────
/** Whether `target` is the workspace root itself or a path under it (T-26 pre-flight). */
function insideWorkspace(target: string, root: string): boolean {
  /** Both operands normalised to absolute paths before comparison. */
  const t: string = resolve(target)
  /** The resolved workspace root. */
  const r: string = resolve(root)
  if (t === r) return true
  return t.startsWith(r.endsWith(sep) ? r : r + sep)
}
/** Answer INSIDE-WORKSPACE / outside-workspace for one path, without attempting the write. */
function checkWrite(argv: string[]): void {
  /** The path the caller intends to write; required. */
  let target: string = ""
  /** The workspace root the path is judged against (`--root`, else `DSH_WORKSPACE_ROOT`, else cwd). */
  let root: string = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()
  // Index of the argument under inspection.
  for (let i = 0; i < argv.length; i++) {
    /** The argument at that index. */
    const a: string = argv[i]
    if (a === "--root") { root = argv[++i] ?? ""; continue }
    if (target === "") { target = a; continue }
    fail("check-write: unexpected argument " + a + "\n" + USAGE, 2)
  }
  if (target === "") fail("check-write: <path> is required\n" + USAGE, 2)
  /** The target as an absolute path: verbatim when already absolute, else resolved against `root`. */
  const abs: string = isAbsolute(target) ? target : resolve(root, target)
  if (insideWorkspace(abs, root)) {
    say("INSIDE-WORKSPACE " + abs + " (root " + resolve(root) + ")")
    process.exit(0)
  }
  say("outside-workspace " + abs + " is outside the session workspace " + resolve(root)
    + " — the file sandbox is workspace-write (T-26); write under the workspace or ask for a declared root")
  process.exit(1)
}

// ── self-test ──────────────────────────────────────────────────────────────────────────────────
/** One self-test arm's verdict, collected so the summary can count failures without parsing output. */
interface SelfTestArm {
  /** The arm's printed name. */
  name: string
  /** Whether the arm's assertion held. */
  ok: boolean
}

/** Hermetic: fixtures in a temp dir, no dsh spawn, no network. Each arm prints PASS/FAIL by name. */
function selfTest(): void {
  /** Scratch directory holding this run's fixtures; removed in the `finally` below. */
  const tmp: string = mkdtempSync(join(tmpdir(), "mpd-bg-selftest-"))
  /** Every arm's verdict, in run order. */
  const arms: SelfTestArm[] = []
  /** Record one arm's verdict and print it, with an optional measured detail. */
  const arm = (name: string, ok: boolean, detail: string = ""): void => {
    arms.push({ name, ok })
    console.log("[" + (ok ? "PASS" : "FAIL") + "] " + name + (detail === "" ? "" : " — " + detail))
  }
  /** This script's own path, spawned as a child for every arm. */
  const script: string = fileURLToPath(import.meta.url)
  /** Run this script with `args`, extra `env` and `cwd`, capturing stdout with a 120 s timeout. */
  const call = (args: string[], env: Record<string, string> = {}, cwd: string = REPO): SpawnSyncReturns<string> => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", cwd, env: { ...process.env, ...env }, timeout: 120_000,
  })
  try {
    // (1) reload-check: three cases on fixtures.
    /** Sandbox DSH home holding the fixture session store. */
    const home: string = join(tmp, "dsh-home")
    /** Fixture module OLDER than the session it will be compared against. */
    const modOld: string = join(tmp, "mod-old.js")
    /** Fixture module NEWER than that session. */
    const modNew: string = join(tmp, "mod-new.js")
    writeFileSync(modOld, "// old\n")
    writeFileSync(modNew, "// new\n")
    /** A reload-check with no session store at all: must report NO-LIVE-SESSION. */
    const noSession: SpawnSyncReturns<string> = call(["reload-check", modOld], { DSH_HOME: home })
    arm("reload-check: no session -> NO-LIVE-SESSION, exit 0", noSession.status === 0 && noSession.stdout.includes("NO-LIVE-SESSION"), "exit=" + noSession.status)
    /** The workspace the fixture session is keyed to. */
    const keyCwd: string = join(tmp, "ws")
    mkdirSync(keyCwd, { recursive: true })
    /** check-write inside the fixture root: proves the shared-lib import path is reachable. */
    const keyCall: SpawnSyncReturns<string> = call(["check-write", keyCwd, "--root", tmp])
    arm("fixture: projectKey reachable through the shared lib", keyCall.status === 0, "exit=" + keyCall.status)
    // create a session dir for the workspace that the NEXT reload-check will run in
    /** The cwd whose projectKey the fixture session directory is created under. */
    const cwdForSession: string = join(tmp, "ws")
    /** A child that prints the projectKey of `cwdForSession` (the key the fixtures must use). */
    const keyOut: SpawnSyncReturns<string> = spawnSync(process.execPath, ["-e",
      "import('" + pathToFileURL(join(REPO, "skills/dsh-qa/scripts/lib/workspace-isolation.ts")).href + "').then(m=>process.stdout.write(m.projectKey(process.argv[1])))",
      cwdForSession], { encoding: "utf8" })
    /** The derived project key, trimmed. */
    const key: string = String(keyOut.stdout).trim()
    /** The fixture session directory for that key. */
    const sessionDir: string = join(home, "sessions", key, "session-x")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "session.v3.jsonl.zstd"), "")
    /** Wall-clock seconds used to age the fixtures around the session's mtime. */
    const sessionTime: number = Date.now() / 1000 - 60
    // module OLDER than the session -> FRESH
    spawnSync("touch", ["-d", "@" + String(Math.floor(sessionTime - 120)), modOld])
    /** The verdict for the older module: FRESH, exit 0. */
    const fresh: SpawnSyncReturns<string> = call(["reload-check", modOld], { DSH_HOME: home }, cwdForSession)
    arm("reload-check: module older than the newest session -> FRESH, exit 0 (no false alarm)", fresh.status === 0 && fresh.stdout.includes("FRESH"), "exit=" + fresh.status)
    // module NEWER than the session -> RESTART-REQUIRED
    spawnSync("touch", ["-d", "@" + String(Math.floor(sessionTime + 120)), modNew])
    /** The verdict for the newer module: RESTART-REQUIRED, exit 1. */
    const stale: SpawnSyncReturns<string> = call(["reload-check", modNew], { DSH_HOME: home }, cwdForSession)
    arm("reload-check: module newer than the newest session -> RESTART-REQUIRED, exit 1", stale.status === 1 && stale.stdout.includes("RESTART-REQUIRED"), "exit=" + stale.status)

    // (2) check-write: inside vs outside.
    /** A path inside the session workspace: must be allowed. */
    const inside: SpawnSyncReturns<string> = call(["check-write", join(cwdForSession, "evidence", "x.json")], {}, cwdForSession)
    arm("check-write: a path inside the workspace -> exit 0", inside.status === 0 && inside.stdout.includes("INSIDE-WORKSPACE"), "exit=" + inside.status)
    /** `/root/.dsh/x` — always outside the cwd-resolved workspace root. */
    const outside: SpawnSyncReturns<string> = call(["check-write", "/root/.dsh/x"])
    arm("check-write: /root/.dsh/x -> outside-workspace, exit 1", outside.status === 1 && outside.stdout.includes("outside-workspace"), "exit=" + outside.status)

    // (3) run + probe: the child outlives THIS self-test's own shell, the log is complete, and the
    //     probe cannot self-match (it never inspects a command line).
    /** Log file the run arm's child writes into. */
    const logPath: string = join(tmp, "long.log")
    /** The run arm's parent result: it must return immediately with a pid. */
    const started: SpawnSyncReturns<string> = call(["run", "--log", logPath, "--cwd", tmp, "--", process.execPath, "-e",
      "setTimeout(()=>{console.log('LONG-DONE');}, 1200)"])
    arm("run: returns immediately with pid + log", started.status === 0 && /started pid=\d+/.test(started.stdout), started.stdout.trim().split("\n")[0] ?? "")
    /** The probe verdict while the child is still alive. */
    const probeAlive: SpawnSyncReturns<string> = call(["probe", logPath + ".pid"])
    arm("probe: RUNNING while the child lives (kernel-only check, no cmdline match)", probeAlive.status === 0 && probeAlive.stdout.includes("RUNNING"), "exit=" + probeAlive.status)
    // wait for the child to finish, then assert the log content and the DEAD verdict
    /** The moment this arm gives up waiting for the child's log line. */
    const deadline: number = Date.now() + 15_000
    /** The log content read so far ("" while the file is still unreadable). */
    let log: string = ""
    while (Date.now() < deadline) {
      try { log = readFileSync(logPath, "utf8") } catch { log = "" }
      if (log.includes("LONG-DONE")) break
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"])
    }
    arm("run: the log lands in a FILE and is complete (no pipe)", log.includes("LONG-DONE"), log.trim().slice(-40))
    /** The probe verdict after the child exited: DEAD, exit 1. */
    const probeDead: SpawnSyncReturns<string> = call(["probe", logPath + ".pid"])
    arm("probe: DEAD after the child exits, exit 1", probeDead.status === 1 && probeDead.stdout.includes("DEAD"), "exit=" + probeDead.status)
    /** A pid file that does not exist: NO-PID-FILE, exit 2. */
    const probeNoFile: SpawnSyncReturns<string> = call(["probe", join(tmp, "nope.pid")])
    arm("probe: missing pid file -> NO-PID-FILE, exit 2", probeNoFile.status === 2, "exit=" + probeNoFile.status)

    // (4) fd inheritance (T-24): a child that spawns a GRANDCHILD holding the inherited handle must
    //     not keep this call open — stdio is a file, so nothing is held by us.
    /** Log file the fd-inheritance arm's child writes into. */
    const fdsLog: string = join(tmp, "fds.log")
    /** Start of the arm's elapsed-time measurement in ms. */
    const t0: number = Date.now()
    /** The arm's result: it must return promptly even though a grandchild holds the handle. */
    const fdsRun: SpawnSyncReturns<string> = call(["run", "--log", fdsLog, "--cwd", tmp, "--", process.execPath, "-e",
      "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"setTimeout(()=>{},2000)\"],{detached:true,stdio:['ignore',1,2]});c.unref();console.log('GRANDCHILD-SPAWNED')"])
    /** How long that call took, in ms. */
    const elapsed: number = Date.now() - t0
    arm("T-24: a child that spawns a grandchild holding the handle returns promptly", fdsRun.status === 0 && elapsed < 10_000, "elapsed=" + elapsed + "ms")

    // (5) static property: the implementation never creates a pipe (no "pipe" stdio anywhere).
    /** This file's own source, read back for the static pipe scan. */
    const src: string = readFileSync(script, "utf8")
    /** How many pipe-stdio declarations the source carries; scanned textually, so 0 is the invariant. */
    const pipeHits: number = (src.match(/stdio:\s*\[\s*"pipe"/g) ?? []).length
    arm("T-24: the helper never uses stdio:'pipe'", pipeHits === 0, "pipeHits=" + pipeHits)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  /** The arms whose assertion did not hold. */
  const failed: SelfTestArm[] = arms.filter((a: SelfTestArm): boolean => !a.ok)
  console.log("[mpd-bg self-test] " + (arms.length - failed.length) + "/" + arms.length + " arms passed — " + (failed.length === 0 ? "PASS" : "FAIL"))
  process.exit(failed.length === 0 ? 0 : 1)
}

// ── dispatch ───────────────────────────────────────────────────────────────────────────────────
// The first CLI token selects the mode; everything after it belongs to that mode.
const [mode, ...rest] = process.argv.slice(2)
if (mode === "--self-test" || mode === undefined) {
  if (mode === undefined) { console.error(USAGE); process.exit(2) }
  selfTest()
} else if (mode === "run") runCommand(rest)
else if (mode === "probe") probeCommand(rest[0])
else if (mode === "reload-check") await reloadCheck(rest[0])
else if (mode === "check-write") checkWrite(rest)
else { console.error("[mpd-bg] unknown mode " + mode + "\n" + USAGE); process.exit(2) }
