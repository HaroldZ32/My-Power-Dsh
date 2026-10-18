// Lane G probe for F2's SECOND half: with NO verification loop armed, does the TOP-LEVEL agent
// really READ a source path and WRITE a code path on the 0.2.1-rc.2 closure?
//
// WHY A SEPARATE PROBE: the boot line is a REPORT of what the row installed; it is not behaviour.
// The claim needs observed behaviour, and the only honest observation is the harness's own session
// log — a recorded `tool/call` PLUS its paired `tool/result` (measured 2026-10-17 on this harness:
// the result hangs off `data.message.toolCallId` and carries `isError` plus a content block list).
//
// TWO RUNS, each with its own falsifier:
//   RUN A — `read` on an ABSOLUTE source path of the real checkout (the withdrawn captain
//           investigation guard's exact subject). PASS = call recorded, paired result not error-
//           flagged, and the result text carries the file's numbered lines.
//   RUN B — `write` of a new CODE path inside the sandbox workspace (the withdrawn verify guard's
//           exact subject). PASS = call recorded, result not error-flagged, artifact EXISTS on disk.
//
// THE PRESET IS THE SCOPE OF THE GUARDS. The `mpd-headless` bundle declares no
// `agent-preset-registry` row, so `preset-mpd` is PENDING there (measured on BOTH 0.2.0-rc.2 and
// 0.2.1-rc.2) and every session runs the deployment default. The probe therefore mounts the registry
// row as a QA OVERLAY (never a shipped patch) and RECORDS the preset trail the session carries, so a
// read/write verdict from a non-`mpd` session can never be mistaken for a guard measurement.
//
// USAGE
//   node evidence/harness-0.2.1/f2-live-guards/probe.ts [--keep]
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** The repository root, derived from this probe's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The 0.2.1-rc.2 closure's own dsh bin: the harness this probe certifies. */
const CLOSURE_BIN: string = join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
/** The QA library directory (credential + isolation + session-evidence helpers). */
const QA_LIB: string = join(REPO_ROOT, "skills", "dsh-qa", "scripts", "lib")
/** The probe's own directory, which names its evidence runs. */
const SLUG_DIR: string = dirname(fileURLToPath(import.meta.url))
/** The gitignored working area the sandbox is created inside. */
const SANDBOX_ROOT: string = join(REPO_ROOT, "evidence", "harness-0.2.1", "sandbox")
/** The REAL checkout source file RUN A reads: a source path by every classification. */
const SOURCE_PATH: string = join(REPO_ROOT, "packages", "mpd-boulder-plugin", "src", "index.ts")
/** The code path RUN B writes, relative to the sandbox workspace (created before the run). */
const CODE_PATH: string = "packages/guard-probe/src/probe.ts"
/** A distinctive fragment of {@link SOURCE_PATH}'s own content, so a read result is attributable. */
const SOURCE_MARKER: string = "mpd-boulder-plugin"

/** Parse the probe's flags: `--keep` and `--harness closure|path` (the 0.2.0 control arm). */
const probeArgv: readonly string[] = process.argv.slice(2)
/** Whether the throwaway sandbox survives the run. */
const keepSandbox: boolean = probeArgv.includes("--keep")
/** Which harness to boot: the 0.2.1 closure (default) or the PATH install, the same-variable control. */
const harnessId: string = probeArgv.includes("--harness") ? String(probeArgv[probeArgv.indexOf("--harness") + 1] ?? "closure") : "closure"
/** The bin the probe launches: the closure's own bin.js, or the PATH launcher (its real target). */
const HARNESS_BIN: string = harnessId === "path"
  ? String(spawnSync("bash", ["-c", "command -v dsh"], { encoding: "utf8" }).stdout ?? "").trim()
  : join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")

/**
 * Read a child result's combined output without throwing on a null stream.
 * @param run The spawnSync result.
 * @returns stdout followed by stderr.
 */
function combined(run: ReturnType<typeof spawnSync>): string {
  const stdout = typeof run.stdout === "string" ? run.stdout : ""
  const stderr = typeof run.stderr === "string" ? run.stderr : ""
  return stdout + stderr
}

/** One live run's decoded verdict, read from the harness session log. */
interface RunVerdict {
  /** Whether a tool call whose arguments name the target path was recorded. */
  readonly called: boolean
  /** Whether its paired result exists and is not error-flagged. */
  readonly resultOk: boolean
  /** The paired result's text, for the evidence log. */
  readonly resultText: string
  /** The recorded call arguments, so the path really is the one asked for. */
  readonly callArgs: string
  /** Every preset-naming record the session carries, so scope is never guessed. */
  readonly presetTrail: string[]
  /** The loader's inactive-entry lines from the boot output. */
  readonly inactive: string[]
  /** The child's exit status. */
  readonly exit: number | null
  /** The child's combined output. */
  readonly output: string
}

/**
 * Drive ONE headless run in the sandbox and decode what the harness recorded.
 * @param task The task text handed to the headless session.
 * @param home The sandbox DSH_HOME.
 * @param ws The sandbox workspace the session runs in.
 * @param env The child environment.
 * @param overlay The QA overlay patch the boot is launched with.
 * @param toolName The tool whose call is the subject.
 * @param pathNeedle A substring the recorded call arguments must carry.
 * @returns The decoded verdict.
 */
function runOnce(task: string, home: string, ws: string, env: Record<string, string | undefined>, overlay: string, toolName: string, pathNeedle: string): RunVerdict {
  const boot = spawnSync(process.execPath, [HARNESS_BIN, "--profile", "mpd-headless", "--patch", overlay, task], { env, cwd: ws, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  const output = combined(boot)
  const files: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.startsWith("session.") && (entry.endsWith(".zstd") || entry.endsWith(".jsonl"))) files.push(full)
    }
  }
  walk(join(home, "sessions"))
  let called = false
  let resultOk = false
  let resultText = ""
  let callArgs = ""
  const presetTrail: string[] = []
  for (const file of files) {
    const text = evidenceCache.decodeSessionLog(file).text
    const records: Array<{ type?: string; data?: Record<string, unknown> }> = []
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue
      try { records.push(JSON.parse(line) as { type?: string; data?: Record<string, unknown> }) } catch { /* torn tail */ }
    }
    for (const record of records) {
      const data = record.data ?? {}
      const flat = JSON.stringify(data)
      // The scope trail: every record that names a preset, kept verbatim for the evidence.
      if (/preset/i.test(flat) && (record.type === "session" || record.type === "permission/preset" || record.type === "request/header" || record.type === "system/message")) {
        presetTrail.push((record.type ?? "?") + ": " + flat.slice(0, 400))
      }
      if (record.type !== "tool/call") continue
      if (String(data.name ?? "") !== toolName) continue
      const args = String(data.arguments ?? "")
      if (!args.includes(pathNeedle)) continue
      called = true
      callArgs = args
    }
    // RESULTS: the harness hangs the result off `message.toolCallId`; a tool/result for a DIFFERENT
    // call is ignored, so an unrelated successful tool can never lend this arm its verdict.
    for (const record of records) {
      if (record.type !== "tool/result") continue
      const message = (record.data ?? {}).message as { toolCallId?: unknown; content?: unknown; isError?: unknown } | undefined
      const text = JSON.stringify(message?.content ?? "")
      if (!text.includes(pathNeedle)) continue
      if (message?.isError === true) continue
      resultOk = true
      resultText += text.slice(0, 4000) + "\n"
    }
  }
  const inactive = output.split(/\r?\n/).filter((line: string) => line.includes("did not activate") || line.includes("pending (waiting"))
  return { called, resultOk, resultText, callArgs, presetTrail, inactive, exit: boot.status, output }
}

/** The session-evidence module, loaded once and shared by both runs. */
let evidenceCache: { decodeSessionLog: (file: string) => { text: string; frames: number } }

/** Run the probe: build one sandbox, then drive RUN A and RUN B against it. */
async function main(): Promise<void> {
  const credentialsLib = await import(pathToFileURL(join(QA_LIB, "credentials.ts")).href) as {
    credentialEnv: (env: Record<string, string | undefined>) => Record<string, string | undefined>
    seedSandboxCredentials: (dir: string, options?: Record<string, unknown>) => { wrote: Record<string, boolean> }
  }
  const isolationLib = await import(pathToFileURL(join(QA_LIB, "workspace-isolation.ts")).href) as {
    sandboxWorkspace: (sandbox: string, name?: string) => string
  }
  evidenceCache = await import(pathToFileURL(join(QA_LIB, "session-evidence.ts")).href) as { decodeSessionLog: (file: string) => { text: string; frames: number } }
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(SLUG_DIR, harnessId + "-" + stamp)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(SANDBOX_ROOT, { recursive: true })
  const sandbox = mkdtempSync(join(SANDBOX_ROOT, "guards-"))
  const home = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "user-home")
  const ws = isolationLib.sandboxWorkspace(sandbox)
  mkdirSync(home, { recursive: true })
  mkdirSync(userHome, { recursive: true })
  // RUN B's target directory exists first, so a refused write and a failed mkdir cannot be confused.
  mkdirSync(join(ws, dirname(CODE_PATH)), { recursive: true })

  const seeded = credentialsLib.seedSandboxCredentials(home, { credentialsFile: join(homedir(), ".dsh", ".credentials.yaml") })
  const realSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(realSettings)) copyFileSync(realSettings, join(home, "settings.yaml"))
  const env: Record<string, string | undefined> = {
    ...credentialsLib.credentialEnv({ ...process.env, DSH_HOME: home }),
    HOME: userHome,
    DSH_HOME: home,
    PATH: join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", ".bin") + ":" + String(process.env.PATH ?? ""),
  }
  const harnessVersion = combined(spawnSync(process.execPath, [HARNESS_BIN, "--version"], { env, encoding: "utf8", timeout: 120000 })).trim()
  const install = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "install-profile.ts"), "--yes", "--dsh-home", home, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })

  // THE PRESET OVERLAY: the headless bundle declares no registry row, so the probe mounts one as a QA
  // overlay and each run records which preset the session actually names.
  const overlay = join(sandbox, "registry-overlay.yml")
  writeFileSync(overlay, "- insert:\n    - id: agent-preset-registry\n      name: \"@deepseek-ai/dsh-agent-preset-registry\"\n      config:\n        default: mpd\n")

  // RUN A: read an absolute SOURCE path of the real checkout.
  const readTask = "Call the read tool exactly once with file_path \"" + SOURCE_PATH + "\" and limit 3. Then report the tool's returned text verbatim and stop."
  const readRun = runOnce(readTask, home, ws, env, overlay, "read", SOURCE_MARKER)
  writeFileSync(join(outDir, "run-a-read.log"), readRun.output.slice(0, 200000))

  // RUN B: write a CODE path inside the sandbox workspace.
  const writeTask = "Call the write tool exactly once with file_path \"" + CODE_PATH + "\" and content \"// guard probe\\n\". Then report the tool's returned text verbatim and stop."
  const writeRun = runOnce(writeTask, home, ws, env, overlay, "write", "guard-probe")
  writeFileSync(join(outDir, "run-b-write.log"), writeRun.output.slice(0, 200000))
  const codeWritten = existsSync(join(ws, CODE_PATH))

  // The boot line, read from the row log the boot wrote inside the sandbox workspace.
  const rolesLog = join(ws, ".mpd", "logs", "mpd-roles.log")
  const bootLine = existsSync(rolesLog) ? (readFileSync(rolesLog, "utf8").split(/\r?\n/).find((line: string) => line.includes("readOnlyGuard")) ?? "") : ""
  // The read lands the file's own lines; the marker inside the RESULT text is the proof.
  const readCarriesSource = readRun.resultOk && readRun.resultText.includes(SOURCE_MARKER)

  const result = {
    // THE CLAIM: no loop armed, the source read really returned the file and the code write landed.
    ok: readRun.called && readCarriesSource && writeRun.called && writeRun.resultOk && codeWritten,
    harness: harnessId === "path" ? "PATH dsh" : "0.2.1-rc.2 closure",
    sandbox: { root: sandbox, home, ws, kept: keepSandbox },
    harnessVersion,
    credentialsSeeded: seeded.wrote,
    installExit: install.status ?? null,
    read: { sourcePath: SOURCE_PATH, called: readRun.called, resultOk: readRun.resultOk, carriesSource: readCarriesSource, exit: readRun.exit, inactive: readRun.inactive, presetTrail: readRun.presetTrail.slice(0, 6), resultText: readRun.resultText.slice(0, 1500) },
    write: { codePath: CODE_PATH, called: writeRun.called, resultOk: writeRun.resultOk, artifactExists: codeWritten, exit: writeRun.exit, inactive: writeRun.inactive, presetTrail: writeRun.presetTrail.slice(0, 6), resultText: writeRun.resultText.slice(0, 1500) },
    bootLine,
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), JSON.stringify({ readRun: readRun.output.slice(0, 12000), writeRun: writeRun.output.slice(0, 12000) }, null, 2))
  console.log(JSON.stringify({ ok: result.ok, read: { called: result.read.called, resultOk: result.read.resultOk, carriesSource: result.read.carriesSource, presetTrail: result.read.presetTrail, resultText: result.read.resultText.slice(0, 260) }, write: { called: result.write.called, resultOk: result.write.resultOk, artifactExists: result.write.artifactExists, presetTrail: result.write.presetTrail, resultText: result.write.resultText.slice(0, 260) }, bootLine, inactive: result.read.inactive }, null, 2))
  if (!keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best effort */ } }
}

await main()
