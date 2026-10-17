// Lane G probe: spawn ONE roster member on the 0.2.1-rc.2 closure and prove what the CHILD really got.
//
// WHY THE CHILD'S OWN SESSION LOG IS THE OBSERVATION: the harness records, per session, the composed
// `system/message` (the full system prompt) and a `request/header` carrying the tool list and the model
// config. So "the persona reached the child" and "a read-only child cannot write" are both readable
// from the child's own records — never from the model's prose, and never from the parent's summary.
//
// THE THREE ARMS (captain's claim set for the 0.2.1 subagent seam):
//   1. a roster member's child carries its persona text verbatim in its composed system prompt;
//   2. a READ-ONLY roster member's child has NO write-capable tool in its request header;
//   3. a spawn still succeeds when the role's label carries no persona (checked by the caller running
//      this probe with a non-roster label; the arm here is simply "a child session exists").
//
// USAGE
//   node evidence/harness-0.2.1/f2-persona-spawn/spawn-probe.ts [--role "Junior Engineer"] [--keep]
//   Writes <slug>/run-<UTC>/…/{result.json,output.log,child-*.log}.
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
/** The persona markers that must appear VERBATIM in the child's system prompt, per roster role. */
const PERSONA_MARKERS: Readonly<Record<string, string>> = {
  "Junior Engineer": "small-change executor",
  "Explorer": "find files and code",
  "Reviewer": "adversarial reader",
}
/** The write-capable tool names a READ-ONLY child must not have in its header. */
const WRITE_CAPABLE: readonly string[] = ["write", "edit", "mpd_hashline_edit", "bash"]

/** Parse the probe's flags. */
const probeArgv: readonly string[] = process.argv.slice(2)
/** The roster member to spawn (addressed by NAME, never its internal id). */
const ROLE: string = probeArgv.includes("--role") ? String(probeArgv[probeArgv.indexOf("--role") + 1] ?? "Junior Engineer") : "Junior Engineer"
/** Whether the throwaway sandbox survives the run. */
const keepSandbox: boolean = probeArgv.includes("--keep")

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

/** One session the boot wrote, with the facts this probe judges. */
interface SessionFacts {
  /** The session id (the directory name). */
  readonly id: string
  /** Whether its composed system prompt carries the role's persona marker. */
  readonly hasPersonaMarker: boolean
  /** Total bytes of its composed system prompt. */
  readonly systemBytes: number
  /** The tool names its request header offered. */
  readonly tools: string[]
  /** Whether the parent-only `mpd_role_spawn` tool is present, which identifies the PARENT session. */
  readonly isParent: boolean
  /** The write-capable tools its header offered (must be empty for a read-only child). */
  readonly writeCapable: string[]
  /** The model the request header names. */
  readonly model: string
  /** Its record-type histogram, so a missing header is visible rather than silently absent. */
  readonly types: Record<string, number>
  /** The `session` record itself, so a child's identity is visible verbatim. */
  readonly sessionRecord: string
}

/** The session-evidence module, loaded once. */
let evidenceCache: { decodeSessionLog: (file: string) => { text: string; frames: number } }

/** Run the probe: boot once, ask the parent to spawn the role, then judge the child's records. */
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
  const outDir = join(SLUG_DIR, "run-" + stamp)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(SANDBOX_ROOT, { recursive: true })
  const sandbox = mkdtempSync(join(SANDBOX_ROOT, "spawn-"))
  const home = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "user-home")
  const ws = isolationLib.sandboxWorkspace(sandbox)
  mkdirSync(home, { recursive: true })
  mkdirSync(userHome, { recursive: true })

  const seeded = credentialsLib.seedSandboxCredentials(home, { credentialsFile: join(homedir(), ".dsh", ".credentials.yaml") })
  const realSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(realSettings)) copyFileSync(realSettings, join(home, "settings.yaml"))
  const env: Record<string, string | undefined> = {
    ...credentialsLib.credentialEnv({ ...process.env, DSH_HOME: home }),
    HOME: userHome,
    DSH_HOME: home,
    PATH: join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", ".bin") + ":" + String(process.env.PATH ?? ""),
  }
  const harnessVersion = combined(spawnSync(process.execPath, [CLOSURE_BIN, "--version"], { env, encoding: "utf8", timeout: 120000 })).trim()
  const install = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "install-profile.ts"), "--yes", "--dsh-home", home, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })

  // THE TASK: one explicit spawn, then a verbatim report. The child's task asks it to take one action,
  // so a read-only child's refusal (if any) also lands in the parent's tool result text.
  const childTask = "Write the file probe.txt with content \"x\", then reply with the exact text the write tool returned. If you have no write tool, reply exactly NO-WRITE-TOOL."
  const task = "Call the tool mpd_role_spawn exactly once with role \"" + ROLE + "\" and task " + JSON.stringify(childTask) + ". Then report the tool's returned text verbatim and stop."
  const boot = spawnSync(process.execPath, [CLOSURE_BIN, "--profile", "mpd-headless", task], { env, cwd: ws, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  const log = combined(boot)
  writeFileSync(join(outDir, "parent.log"), log.slice(0, 200000))

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

  const marker = PERSONA_MARKERS[ROLE] ?? roleMarkerFallback(ROLE)
  const sessions: SessionFacts[] = files.map((file: string) => {
    const text = evidenceCache.decodeSessionLog(file).text
    const records: Array<{ type?: string; data?: Record<string, unknown> }> = []
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue
      try { records.push(JSON.parse(line) as { type?: string; data?: Record<string, unknown> }) } catch { /* torn tail */ }
    }
    const types: Record<string, number> = {}
    let system = ""
    let tools: string[] = []
    let model = ""
    let sessionRecord = ""
    for (const record of records) {
      types[record.type ?? "?"] = (types[record.type ?? "?"] ?? 0) + 1
      if (record.type === "system/message") {
        const message = (record.data ?? {}).message as { content?: unknown } | undefined
        system += JSON.stringify(message?.content ?? "")
      }
      if (record.type === "request/header") {
        const header = (record.data ?? {}).header as { tools?: Array<{ name?: string }>; config?: { model?: string } } | undefined
        tools = (header?.tools ?? []).map((tool) => String(tool.name ?? ""))
        model = String(header?.config?.model ?? "")
      }
      if (record.type === "session") sessionRecord = JSON.stringify(record.data ?? {})
    }
    const writeCapable = tools.filter((tool: string) => WRITE_CAPABLE.includes(tool))
    return {
      id: file.split("/").slice(-2, -1)[0] ?? file,
      hasPersonaMarker: system.includes(marker),
      systemBytes: system.length,
      tools,
      isParent: tools.includes("mpd_role_spawn"),
      writeCapable,
      model,
      types,
      sessionRecord,
    }
  })

  const children = sessions.filter((session) => !session.isParent)
  const childPersona = children.some((session) => session.hasPersonaMarker)
  const child = children[0]
  const result = {
    // THE CLAIM: a child session EXISTS, and its own system prompt carries the role's persona.
    ok: children.length > 0 && childPersona,
    harnessVersion,
    role: ROLE,
    personaMarker: marker,
    sandbox: { root: sandbox, home, ws, kept: keepSandbox },
    credentialsSeeded: seeded.wrote,
    installExit: install.status ?? null,
    bootExit: boot.status ?? null,
    sessionCount: sessions.length,
    childCount: children.length,
    childPersona,
    child: child === undefined ? null : { id: child.id, hasPersonaMarker: child.hasPersonaMarker, systemBytes: child.systemBytes, tools: child.tools, writeCapable: child.writeCapable, model: child.model, types: child.types, sessionRecord: child.sessionRecord },
    parent: sessions.find((session) => session.isParent)?.id ?? null,
    bootTail: log.slice(-2500),
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), JSON.stringify({ sessions, boot }, null, 2).slice(0, 400000))
  console.log(JSON.stringify({ ok: result.ok, harnessVersion, role: ROLE, sessionCount: result.sessionCount, childCount: result.childCount, childPersona, child: result.child, bootTail: result.bootTail.slice(0, 900) }, null, 2))
  if (!keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best effort */ } }
}

/**
 * A role with no declared marker: derive one from the first distinctive words the roster prints.
 * @param role The roster member's name.
 * @returns A marker guaranteed non-empty, so the assertion can never pass vacuously.
 */
function roleMarkerFallback(role: string): string {
  const fallback = "You are the " + role
  return fallback
}

await main()
