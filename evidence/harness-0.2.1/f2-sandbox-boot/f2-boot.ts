// Lane G (wave verification) driver: boot the bundle OUT OF the 0.2.1-rc.2 sandbox closure and
// capture what a real mount prints.
//
// WHY THIS FILE EXISTS: `--dump-config` proves COMPOSITION ONLY (AGENTS.md §4) — it never executes a
// plugin's apply(), so a schema abort or a rejected row is invisible to it. The only honest subject
// is a real boot, so this driver boots `dsh --profile mpd-headless` from
// `.mpd/reference/harness-021/node_modules/@deepseek-ai/dsh/lib/bin.js` (the 0.2.1-rc.2 closure) in
// THREE isolation layers (§7): a throwaway DSH_HOME, a sandbox HOME, and a sandbox workspace.
//
// WHERE THE BOOT LINE IS: `rowLogLine()` in the shipped rows writes through the MPD log sink
// (`openLogSink`), which lands in `<workspace>/.mpd/logs/<row>.log` — NOT on the process stdout
// (measured 2026-10-17: a headless boot prints only the answer and the loader's own warnings). So
// the guard line is read from the row log first, with stdout as the fallback, and BOTH are recorded.
//
// The machine's global dsh (0.2.0-rc.2) is never touched: every child is the closure's own bin.js run
// by this node, with PATH prefixed by the closure's .bin so any nested `dsh`/launcher resolution also
// lands on 0.2.1-rc.2 instead of the PATH install.
//
// USAGE
//   node evidence/harness-0.2.1/f2-sandbox-boot/f2-boot.ts [--harness closure|path] [--keep]
//     closure (default) — boot the 0.2.1-rc.2 closure (the wave's target)
//     path              — boot the PATH `dsh` (the machine's 0.2.0-rc.2), the same-variable control
//   Each run writes <slug>/<UTC stamp>/{result.json,output.log,row-logs/}.
//
// THE SANDBOX LIVES UNDER THE WORKSPACE, NEVER /tmp: a DSH bash call gets a FRESH /tmp (T-23), so a
// sandbox there is gone by the next call. `evidence/**/sandbox` is the gitignored working area the
// repository already reserves for exactly this.
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** The repository root, derived from this driver's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The sandbox closure the wave targets; its `@deepseek-ai/dsh` bin is the boot subject. */
const CLOSURE: string = join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", "@deepseek-ai")
/** The QA library directory (reused, never re-implemented: ONE credential resolver, §7/T-58). */
const QA_LIB: string = join(REPO_ROOT, "skills", "dsh-qa", "scripts", "lib")
/** The evidence slug this driver files its runs under. */
const SLUG_DIR: string = dirname(fileURLToPath(import.meta.url))
/** The gitignored working area (the `sandbox` directory under evidence) sandboxes are created in. */
const SANDBOX_ROOT: string = join(REPO_ROOT, "evidence", "harness-0.2.1", "sandbox")

/** One harness under test: what to boot and how the evidence names it. */
interface HarnessTarget {
  /** Short name used in the evidence path and the result body. */
  readonly id: string
  /** The launcher argument vector: `[bin, ...]` executed with this node. */
  readonly argv: string[]
  /** The PATH prefix that makes a NESTED dsh resolution agree with the booted harness. */
  readonly pathPrefix: string
}

/** The closure's own bin.js: the boot subject for the target harness. */
const CLOSURE_BIN: string = join(CLOSURE, "dsh", "lib", "bin.js")
/** The pinned version the wave certifies; a boot of anything else is not this claim's subject. */
const EXPECTED_VERSION: string = "0.2.1-rc.2"
/**
 * The withdrawn guards and the MODE SPELLINGS that mark one as still installed. After the rollback
 * each of these must print `absent reason=…`; printing one of these modes is a FINDING, never a pass.
 */
const WITHDRAWN: Readonly<Record<string, readonly string[]>> = {
  verifyGate: ["installed", "hard"],
  captainInvestigation: ["deny", "allow", "installed"],
  delegationGate: ["deny", "captain", "installed"],
}
/** The guards and states the rollback KEEPS (R3): each must still be present with its real state. */
const KEPT: Readonly<Record<string, readonly string[]>> = {
  readOnlyGuard: ["installed"],
  askUserQuestion: ["installed"],
  rosterSection: ["agent-scoped"],
  sessionGate: ["off"],
}

/** Parse the driver's own two flags; everything else is ignored. */
const argv = process.argv.slice(2)
/** Which harness to boot: the closure by default, `path` for the same-variable control. */
const harnessId: string = argv.includes("--harness") ? String(argv[argv.indexOf("--harness") + 1] ?? "closure") : "closure"
/** Whether the throwaway sandbox survives the run (for a post-mortem read). */
const keepSandbox: boolean = argv.includes("--keep")

/**
 * Read a child result's combined output without ever throwing on a null stream.
 * @param run The spawnSync result.
 * @returns stdout followed by stderr.
 */
function combined(run: ReturnType<typeof spawnSync>): string {
  const stdout = typeof run.stdout === "string" ? run.stdout : ""
  const stderr = typeof run.stderr === "string" ? run.stderr : ""
  return stdout + stderr
}

/**
 * The one boot line the roles row emits, or `""` when the row never applied.
 * @param log A log that may carry the line.
 * @returns The line carrying the guard tokens.
 */
function guardLineIn(log: string): string {
  const match = /\[mpd-roles\] team plane: [^\n]*/.exec(log) ?? /readOnlyGuard=[^\n]*/.exec(log)
  return match?.[0]?.trim() ?? ""
}

/**
 * Every `key=value` token on the guard line, so a caller can assert a MODE without a substring trap.
 * @param line The guard line.
 * @returns A map from token name to its printed value.
 */
function guardTokens(line: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const match of line.matchAll(/([A-Za-z][A-Za-z0-9]*)=(\S+)/g)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) tokens[key] = value
  }
  return tokens
}

/**
 * Judge the guard line against the rollback contract (a SUPERSET, never an exact string): every
 * withdrawn install must print `absent`, every kept guard must print the state R3 keeps.
 * @param tokens The parsed guard tokens.
 * @returns Per-token verdicts plus the aggregate flag.
 */
function judgeGuardLine(tokens: Record<string, string>): { withdrawn: Record<string, string>; kept: Record<string, string>; ok: boolean } {
  const withdrawn: Record<string, string> = {}
  for (const [name, modes] of Object.entries(WITHDRAWN)) {
    const value = tokens[name]
    withdrawn[name] = value === undefined ? "MISSING" : value.startsWith("absent") ? "absent" : (modes.includes(value) ? "STILL-INSTALLED(" + value + ")" : "unexpected(" + value + ")")
  }
  const kept: Record<string, string> = {}
  for (const [name, allowed] of Object.entries(KEPT)) {
    const value = tokens[name]
    kept[name] = value === undefined ? "MISSING" : (allowed.includes(value) ? value : "unexpected(" + value + ")")
  }
  const ok = Object.values(withdrawn).every((verdict) => verdict === "absent") && Object.values(kept).every((verdict) => !verdict.startsWith("MISSING") && !verdict.startsWith("unexpected"))
  return { withdrawn, kept, ok }
}

/** Run the driver's own boot arm and file the evidence. */
async function main(): Promise<void> {
  // The QA library is imported by FILE URL (an absolute POSIX path is parsed as a scheme on win32).
  const credentialsLib = await import(pathToFileURL(join(QA_LIB, "credentials.ts")).href) as {
    credentialEnv: (env: Record<string, string | undefined>) => Record<string, string | undefined>
    seedSandboxCredentials: (dir: string, options?: Record<string, unknown>) => { wrote: Record<string, boolean> }
  }
  const isolationLib = await import(pathToFileURL(join(QA_LIB, "workspace-isolation.ts")).href) as {
    sandboxWorkspace: (sandbox: string, name?: string) => string
    assertSessionsSandboxed: (home: string, root: string, options?: Record<string, unknown>) => { checked: number; keys: string[] }
  }
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(SLUG_DIR, harnessId + "-" + stamp)
  mkdirSync(join(outDir, "row-logs"), { recursive: true })
  mkdirSync(SANDBOX_ROOT, { recursive: true })
  const sandbox = mkdtempSync(join(SANDBOX_ROOT, harnessId + "-"))
  const home = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "user-home")
  const ws = isolationLib.sandboxWorkspace(sandbox)
  mkdirSync(home, { recursive: true })
  mkdirSync(userHome, { recursive: true })

  // THE THREE ISOLATION LAYERS, in the order AGENTS.md §7 states them.
  const realCredentials = join(homedir(), ".dsh", ".credentials.yaml")
  const seeded = credentialsLib.seedSandboxCredentials(home, { credentialsFile: realCredentials })
  const realSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(realSettings)) copyFileSync(realSettings, join(home, "settings.yaml"))
  const target: HarnessTarget = harnessId === "path"
    ? { id: "path", argv: [join(dirname(process.execPath), "dsh")], pathPrefix: dirname(process.execPath) }
    : { id: "closure", argv: [CLOSURE_BIN], pathPrefix: join(CLOSURE, "..", ".bin") }
  const env: Record<string, string | undefined> = {
    ...credentialsLib.credentialEnv({ ...process.env, DSH_HOME: home }),
    HOME: userHome,
    DSH_HOME: home,
    PATH: target.pathPrefix + ":" + String(process.env.PATH ?? ""),
  }

  // THE VERSION IS ASSERTED BEFORE THE BOOT: a run that silently fell back to another install would
  // certify the wrong harness, so the observed version is the first fact in the evidence. It is read
  // from the SAME launcher the boot uses (never a hardcoded path), so the control arm cannot lie.
  const versionRun = spawnSync(process.execPath, [target.argv[0] as string, ...target.argv.slice(1), "--version"], { env, encoding: "utf8", timeout: 120000 })
  const observedVersion = combined(versionRun).trim().split(/\r?\n/).pop() ?? ""

  // The dev/QA installer stages the bundle rows into the sandbox home (AGENTS.md §8 legacy flow);
  // it writes absolute paths, so no packed package name has to resolve.
  const install = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "install-profile.ts"), "--yes", "--dsh-home", home, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })
  const installOut = combined(install)

  // THE BOOT. Headless: one real session, every row applied, no port to poll and no browser needed.
  // The task is deliberately trivial — this arm measures the MOUNT and the boot line, not model quality.
  const boot = spawnSync(process.execPath, [target.argv[0] as string, ...target.argv.slice(1), "--profile", "mpd-headless", "Reply with exactly: F2-BOOT-PROBE"], { env, cwd: ws, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  const log = combined(boot)

  // THE ROW LOGS: `rowLogLine` writes to `<workspace>/.mpd/logs/<row>.log`, so the boot line lives
  // there. Every log is copied into the evidence dir (small text files), and the guard line is read
  // from the roles log first with the child stdout as the fallback.
  const rowLogDir = join(ws, ".mpd", "logs")
  const rowLogFiles = existsSync(rowLogDir) ? readdirSync(rowLogDir).filter((name: string) => name.endsWith(".log")) : []
  let rowLogText = ""
  for (const name of rowLogFiles) {
    copyFileSync(join(rowLogDir, name), join(outDir, "row-logs", name))
    rowLogText += readFileSync(join(rowLogDir, name), "utf8") + "\n"
  }
  const rowLogLine = guardLineIn(rowLogText)
  const line = rowLogLine !== "" ? rowLogLine : guardLineIn(log)
  const tokens = guardTokens(line)
  const judged = judgeGuardLine(tokens)

  // THE LOADER'S OWN FAILURE VOCABULARY. Each pattern was measured on this harness family; a hit is a
  // row that did not mount, which is exactly what this arm exists to catch.
  const failurePatterns: readonly string[] = ["failed to apply", "invalid config", "did not activate", "ERR_MODULE_NOT_FOUND", "Cannot find package", "already registered", "duplicate entry"]
  const failureLines = log.split(/\r?\n/).filter((text: string) => failurePatterns.some((pattern) => text.includes(pattern)))
  // THE LOADER NAMES EVERY INACTIVE ENTRY on the line after its count warning: `id (name): pending
  // (waiting for service: X)`. Parsing it is what lets this arm distinguish a REAL mount failure from
  // the `mpd-headless` profile's documented bound (nothing provides `agentPresets` there, measured
  // identically on 0.2.0-rc.2 and 0.2.1-rc.2), instead of failing blindly or passing blindly.
  const inactiveEntries = log.split(/\r?\n/)
    .map((text: string) => /^([^\s]+) \((.+)\): pending \(waiting for service: ([\w$]+)\)$/.exec(text.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ id: match[1] ?? "", name: match[2] ?? "", service: match[3] ?? "" }))
  // The headless profile's OWN composition fact, not a defect this wave introduces or fixes.
  const allowedInactive = [{ id: "preset-mpd", service: "agentPresets" }]
  const unexpectedInactive = inactiveEntries.filter((entry) => !allowedInactive.some((allowed) => allowed.id === entry.id && allowed.service === entry.service))
  const failureFree = failureLines.length === 0 || (failureLines.length === 1 && failureLines[0] === "dsh: warning: 1 entry did not activate" && unexpectedInactive.length === 0 && inactiveEntries.length === 1)
  let sessions: { checked: number; keys: string[] } | null = null
  try { sessions = isolationLib.assertSessionsSandboxed(home, sandbox) } catch { sessions = null }

  // TOOLS REGISTER (the claim's other half): the session's own `request/header` carries the tools the
  // harness offered that agent, so the registered set is read from the HARNESS's record, never from a
  // plugin's log line. A boot that mounts rows but registers no tools fails here.
  const sessionFiles: string[] = []
  const walkSessions = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walkSessions(full)
      else if (entry.startsWith("session.") && (entry.endsWith(".zstd") || entry.endsWith(".jsonl"))) sessionFiles.push(full)
    }
  }
  walkSessions(join(home, "sessions"))
  const tools: string[] = []
  for (const file of sessionFiles) {
    const text = (await import(pathToFileURL(join(QA_LIB, "session-evidence.ts")).href) as { decodeSessionLog: (path: string) => { text: string } }).decodeSessionLog(file).text
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes("request/header")) continue
      try {
        const record = JSON.parse(line) as { data?: { header?: { tools?: Array<{ name?: string }> } } }
        for (const tool of record.data?.header?.tools ?? []) if (tool.name !== undefined) tools.push(tool.name)
      } catch { /* torn tail */ }
    }
  }
  // The published tool surface this wave must keep registering (a subset chosen to span the planes).
  const expectedTools: readonly string[] = ["mpd_role_spawn", "mpd_roles_list", "mpd_verify_open", "mpd_team_compact_run", "mpd_workmate_init", "mpd_memory_write", "mpd_ulw", "agent_teams_plan", "team_task_create", "read", "write", "edit", "bash"]
  const missingTools = expectedTools.filter((name) => !tools.includes(name))

  const result = {
    // THE VERDICT OF THIS ARM: the harness is the pinned one, every row activated, the boot line
    // carries the rollback shape, and the session store never left the sandbox.
    ok: observedVersion === EXPECTED_VERSION && failureFree && line !== "" && judged.ok && sessions !== null && missingTools.length === 0,
    harness: { id: harnessId, expected: EXPECTED_VERSION, observed: observedVersion, matches: observedVersion === EXPECTED_VERSION },
    sandbox: { root: sandbox, home, userHome, ws, kept: keepSandbox },
    credentialsSeeded: seeded.wrote,
    installExit: install.status ?? null,
    bootExit: boot.status ?? null,
    bootLineSource: rowLogLine !== "" ? "row-log" : "stdout",
    guardLine: line,
    guardTokens: tokens,
    withdrawnGuards: judged.withdrawn,
    keptGuards: judged.kept,
    guardLineOk: judged.ok,
    failureLines,
    failureCount: failureLines.length,
    inactiveEntries,
    unexpectedInactive,
    failureFree,
    rowLogFiles,
    toolCount: tools.length,
    registeredMpdTools: tools.filter((name) => name.startsWith("mpd_")).length,
    missingTools,
    sessionsSandboxed: sessions !== null,
    sessionKeys: sessions?.keys ?? null,
    bootProbeAnswered: log.includes("F2-BOOT-PROBE"),
    logBytes: log.length,
  }
  writeFileSync(join(outDir, "output.log"), ["=== harness version ===", observedVersion, "", "=== install-profile (tail) ===", installOut.slice(-8000), "", "=== boot (stdout+stderr) ===", log, "", "=== row logs ===", rowLogText].join("\n"))
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ ok: result.ok, observedVersion, guardLine: line, withdrawnGuards: judged.withdrawn, keptGuards: judged.kept, failureLines, inactiveEntries, unexpectedInactive, rowLogFiles, toolCount: result.toolCount, registeredMpdTools: result.registeredMpdTools, missingTools, bootProbeAnswered: result.bootProbeAnswered, sandbox }, null, 2))
  if (!keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best effort */ } }
}

await main()
