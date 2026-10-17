// Lane G probe (corrected instrument): spawn ONE child on the 0.2.1-rc.2 closure and read what the
// CHILD itself recorded.
//
// WHAT THE PREVIOUS VERSION GOT WRONG, and why this file exists (captain's measurement, verified here):
//   1. it classified the child by "the session whose tool list includes mpd_role_spawn", which is TRUE
//      OF BOTH SESSIONS, so `childCount` was 0 on every run and the session it labelled `parent` was
//      actually the CHILD. The child is found by its OWN record: `subagent/descriptor`.
//   2. it looked for the persona in the child's `system/message` for one arm and in the first user
//      message for another. The claim is about the SEAM: the persona must arrive as a SYSTEM SECTION.
//      A persona that only arrives as PROMPT TEXT (what `mpd_role_spawn` has always done: prompt =
//      persona + "Task: …") is a FAIL for this claim, and this probe reports both channels separately
//      so the difference cannot be conflated again.
//   3. `request/header.data.header.tools` entries are DEFINITION OBJECTS; the name is `entry.name`.
//
// THE ARMS
//   --arm roster --role "Explorer"        a read-only roster member via `mpd_role_spawn`
//   --arm roster --role "Junior Engineer" the writable CONTROL (write tools must be PRESENT)
//   --arm workmate --role "Explorer"      a read-only WORKMATE child (`mpd_workmate_init` + `mpd_workmate_spawn`)
//   --arm unlabelled                      the generic `subagent` tool (no roster label — the seam must no-op)
//
// USAGE
//   node evidence/harness-0.2.1/f2-persona-spawn/spawn-probe.ts --arm roster --role Explorer [--keep]
//   Writes <slug>/run-<UTC>/{result.json,output.log,parent.log}.
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
/** The persona markers a roster child's SYSTEM prompt must carry, per role. */
const PERSONA_MARKERS: Readonly<Record<string, string>> = {
  "Junior Engineer": "small-change executor",
  "Explorer": "reconnaissance specialist",
  "Reviewer": "adversarial reader",
  "Senior Engineer": "primary implementation",
}
/** The write-capable tool names a READ-ONLY child must not see. */
const WRITE_CAPABLE: readonly string[] = ["write", "edit", "bash", "mpd_hashline_edit"]

/** Parse the probe's flags. */
const probeArgv: readonly string[] = process.argv.slice(2)
/** The arm to drive: `roster` (default), `workmate`, or `unlabelled`. */
const ARM: string = probeArgv.includes("--arm") ? String(probeArgv[probeArgv.indexOf("--arm") + 1] ?? "roster") : "roster"
/** The roster member (addressed by NAME) for the roster/workmate arms. */
const ROLE: string = probeArgv.includes("--role") ? String(probeArgv[probeArgv.indexOf("--role") + 1] ?? "Explorer") : "Explorer"
/** Whether the throwaway sandbox survives the run. */
const keepSandbox: boolean = probeArgv.includes("--keep")
/** The persona marker this arm must find in the child's SYSTEM prompt. */
const MARKER: string = PERSONA_MARKERS[ROLE] ?? ROLE

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
  /** The session id (its directory name). */
  readonly id: string
  /** Whether the session carries a `subagent/descriptor` record — the ONLY child discriminator. */
  readonly isChild: boolean
  /** The descriptor's `label` (a roster/workmate name), or `""` for an unlabelled child. */
  readonly label: string
  /** The descriptor record, verbatim, for the evidence. */
  readonly descriptor: string
  /** Whether the persona marker is in the child's own `system/message` text — the CLAIM. */
  readonly personaInSystem: boolean
  /** Whether the persona marker arrived as prompt text — reportable, never the claim. */
  readonly personaInPrompt: boolean
  /** The composed system prompt's length in bytes (JSON-encoded). */
  readonly systemBytes: number
  /** Every tool name the `request/header` offered (definition objects → `entry.name`). */
  readonly tools: string[]
  /** The write-capable tools visible to this session. */
  readonly writeCapable: string[]
  /** The model the request header names. */
  readonly model: string
}

/** The session-evidence module, loaded once. */
let evidenceCache: { decodeSessionLog: (file: string) => { text: string; frames: number } }

/**
 * Build the prompt for the chosen arm.
 * @returns The one-line task handed to the headless parent.
 */
function taskForArm(): string {
  const childTask = "Reply with the single word READY and nothing else."
  if (ARM === "workmate") {
    return "Do these two calls in order. 1) Call mpd_workmate_init with base \"" + ROLE + "\" and name \"qa-probe\". 2) Call mpd_workmate_spawn with name \"qa-probe\" and task " + JSON.stringify(childTask) + ". Then report both tools' returned text verbatim and stop."
  }
  if (ARM === "unlabelled") {
    return "Call the subagent tool exactly once with description \"qa unlabelled probe\" and prompt " + JSON.stringify("A child with no roster label. " + childTask) + ". Then report the tool's returned text verbatim and stop."
  }
  return "Call the tool mpd_role_spawn exactly once with role \"" + ROLE + "\" and task " + JSON.stringify(childTask) + ". Then report the tool's returned text verbatim and stop."
}

/** Run the probe: boot once, drive the arm, then judge the CHILD's own records. */
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
  const outDir = join(SLUG_DIR, ARM + "-" + ROLE.replaceAll(" ", "-").toLowerCase() + "-" + stamp)
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

  const boot = spawnSync(process.execPath, [CLOSURE_BIN, "--profile", "mpd-headless", taskForArm()], { env, cwd: ws, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
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

  const sessions: SessionFacts[] = files.map((file: string) => {
    const text = evidenceCache.decodeSessionLog(file).text
    const records: Array<{ type?: string; data?: Record<string, unknown> }> = []
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue
      try { records.push(JSON.parse(line) as { type?: string; data?: Record<string, unknown> }) } catch { /* torn tail */ }
    }
    let system = ""
    let promptText = ""
    let tools: string[] = []
    let model = ""
    let descriptor = ""
    let label = ""
    for (const record of records) {
      const data = record.data ?? {}
      if (record.type === "system/message") {
        const message = data.message as { content?: unknown } | undefined
        system += JSON.stringify(message?.content ?? "")
      }
      if (record.type === "user/message" || record.type === "agent/inbox/spliced") promptText += JSON.stringify(data)
      if (record.type === "subagent/descriptor") {
        descriptor = JSON.stringify(data)
        label = String((data as { label?: unknown }).label ?? "")
      }
      if (record.type === "request/header") {
        // DEFINITION OBJECTS: the name is `entry.name`; taking the object itself reads as "[object Object]".
        const header = data.header as { tools?: Array<{ name?: string }>; config?: { model?: string } } | undefined
        tools = (header?.tools ?? []).map((tool) => String(tool.name ?? "")).filter((name: string) => name !== "")
        model = String(header?.config?.model ?? "")
      }
    }
    return {
      id: file.split("/").slice(-2, -1)[0] ?? file,
      isChild: descriptor !== "",
      label,
      descriptor,
      personaInSystem: system.includes(MARKER),
      personaInPrompt: promptText.includes(MARKER),
      systemBytes: system.length,
      tools,
      writeCapable: tools.filter((tool: string) => WRITE_CAPABLE.includes(tool)),
      model,
    }
  })

  // THE CHILD IS THE SESSION THAT CARRIES `subagent/descriptor` — never a field-position guess.
  const children = sessions.filter((session) => session.isChild)
  const control = sessions.find((session) => !session.isChild) ?? null
  const child = children[0] ?? null
  // The seam's own report line, searched on every surface the boot could have written it to.
  const rowLogDir = join(ws, ".mpd", "logs")
  let rowLogText = ""
  if (existsSync(rowLogDir)) for (const name of readdirSync(rowLogDir)) rowLogText += readFileSync(join(rowLogDir, name), "utf8") + "\n"
  // BOTH row spellings are contractual: the roster row logs `read-only child: …` and the workmate row
  // logs `read-only workmate child: …` (measured 2026-10-17), so the filter matches either and the
  // applied/could-not split is what decides the arm.
  const denyLines = (rowLogText + "\n" + log).split(/\r?\n/).filter((line: string) => /read-only\b.*child:/.test(line))
  const denyApplied = denyLines.some((line: string) => /applied \d+ denials/.test(line))
  const denyFailed = denyLines.some((line: string) => line.includes("could NOT be applied"))

  const result = {
    // THE ARMS' CLAIMS as ONE boolean each, so a reader cannot blend them:
    //   roster (read-only) / workmate (read-only): child exists, persona in SYSTEM, write tools ABSENT;
    //   roster (writable control):                 child exists, persona in SYSTEM, write tools PRESENT;
    //   unlabelled:                                a child exists (the seam's no-op must not break it).
    ok: ARM === "unlabelled"
      ? children.length > 0
      : child !== null && child.personaInSystem && (child.writeCapable.length === 0 ? denyApplied : child.writeCapable.length > 0),
    arm: ARM,
    role: ROLE,
    marker: MARKER,
    harnessVersion,
    sandbox: { root: sandbox, home, ws, kept: keepSandbox },
    credentialsSeeded: seeded.wrote,
    installExit: install.status ?? null,
    bootExit: boot.status ?? null,
    sessionCount: sessions.length,
    childCount: children.length,
    child: child === null ? null : {
      id: child.id,
      label: child.label,
      descriptor: child.descriptor,
      personaInSystem: child.personaInSystem,
      personaInPrompt: child.personaInPrompt,
      writeCapable: child.writeCapable,
      tools: child.tools.length,
      model: child.model,
      systemBytes: child.systemBytes,
    },
    control: control === null ? null : { id: control.id, writeCapable: control.writeCapable, tools: control.tools.length },
    denyLines,
    denyApplied,
    denyFailed,
    bootTail: log.slice(-2500),
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), JSON.stringify({ sessions, boot }, null, 2).slice(0, 400000))
  console.log(JSON.stringify({ ok: result.ok, arm: ARM, role: ROLE, harnessVersion, childCount: result.childCount, child: result.child, denyApplied, denyFailed, bootTail: result.bootTail.slice(0, 700) }, null, 2))
  if (!keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best effort */ } }
}

await main()
