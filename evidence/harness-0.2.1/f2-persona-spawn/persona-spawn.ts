// Lane G probe: does a roster member spawned on 0.2.1-rc.2 actually RECEIVE its persona?
//
// WHY THIS PROBE EXISTS: the 0.2.1 subagent start request no longer carries `persona`/`toolFilter`,
// while `mpd-roles-plugin` / `mpd-workmate-plugin` still hand that field over. If the field is simply
// dropped, a roster member spawns WITHOUT its role instructions — and the roster IS the product, so
// that is a wave-level failure, not a bound.
//
// THE OBSERVATION IS THE CHILD'S OWN SESSION LOG, never the model's prose (§7): the harness records a
// `system/message` record whose text is the composed system prompt (measured 2026-10-17 on a real
// 0.2.1 boot: 23 records, one full system message). So the probe reads every session log the boot
// wrote, finds the one whose system prompt carries the Junior Engineer persona, and reports whether
// that text is present VERBATIM.
//
// USAGE
//   node evidence/harness-0.2.1/f2-persona-spawn/persona-spawn.ts [--keep]
//   Writes <slug>/<UTC stamp>/{result.json,output.log}.
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** The repository root, derived from this probe's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The 0.2.1-rc.2 closure's own dsh bin: the harness this probe certifies. */
const CLOSURE_BIN: string = join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
/** The QA library directory (credential + isolation helpers are reused, never re-implemented). */
const QA_LIB: string = join(REPO_ROOT, "skills", "dsh-qa", "scripts", "lib")
/** The probe's own directory, which names its evidence runs. */
const SLUG_DIR: string = dirname(fileURLToPath(import.meta.url))
/** The gitignored working area the sandbox is created inside (`evidence` + `sandbox`). */
const SANDBOX_ROOT: string = join(REPO_ROOT, "evidence", "harness-0.2.1", "sandbox")
/**
 * The roster persona marker: a phrase from `mpd_role_persona("Junior Engineer")` that no other
 * prompt in the composition carries, so a hit in a child's system prompt is attributable.
 */
const PERSONA_MARKER: string = "small-change executor"
/** The roster member this probe spawns; named by the roster NAME, never its internal id. */
const ROLE_NAME: string = "Junior Engineer"

/** Parse the probe's one flag. */
const keepSandbox: boolean = process.argv.slice(2).includes("--keep")

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

/** Run the probe: boot once, spawn one roster member, then read what its session really carried. */
async function main(): Promise<void> {
  const credentialsLib = await import(pathToFileURL(join(QA_LIB, "credentials.ts")).href) as {
    credentialEnv: (env: Record<string, string | undefined>) => Record<string, string | undefined>
    seedSandboxCredentials: (dir: string, options?: Record<string, unknown>) => { wrote: Record<string, boolean> }
  }
  const isolationLib = await import(pathToFileURL(join(QA_LIB, "workspace-isolation.ts")).href) as {
    sandboxWorkspace: (sandbox: string, name?: string) => string
  }
  const evidenceLib = await import(pathToFileURL(join(QA_LIB, "session-evidence.ts")).href) as {
    decodeSessionLog: (file: string) => { text: string; frames: number; tornStart: number | undefined }
  }
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(SLUG_DIR, "run-" + stamp)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(SANDBOX_ROOT, { recursive: true })
  const sandbox = mkdtempSync(join(SANDBOX_ROOT, "persona-"))
  const home = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "user-home")
  const ws = isolationLib.sandboxWorkspace(sandbox)
  mkdirSync(home, { recursive: true })
  mkdirSync(userHome, { recursive: true })

  // THE THREE ISOLATION LAYERS (§7), plus the sandboxed credentials the model call needs.
  const seeded = credentialsLib.seedSandboxCredentials(home, { credentialsFile: join(homedir(), ".dsh", ".credentials.yaml") })
  const realSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(realSettings)) copyFileSync(realSettings, join(home, "settings.yaml"))
  const env: Record<string, string | undefined> = {
    ...credentialsLib.credentialEnv({ ...process.env, DSH_HOME: home }),
    HOME: userHome,
    DSH_HOME: home,
    PATH: join(REPO_ROOT, ".mpd", "reference", "harness-021", "node_modules", ".bin") + ":" + String(process.env.PATH ?? ""),
  }

  const install = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "install-profile.ts"), "--yes", "--dsh-home", home, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000 })

  // THE TASK: one explicit tool call, then a plain report. The child needs no tools of its own.
  const task = "Call the tool mpd_role_spawn exactly once with role \"" + ROLE_NAME + "\" and task \"Reply with the single word READY and nothing else.\" Then report the tool's returned text verbatim and stop."
  const boot = spawnSync(process.execPath, [CLOSURE_BIN, "--profile", "mpd-headless", task], { env, cwd: ws, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  const log = combined(boot)

  // EVERY SESSION LOG THE BOOT WROTE: the parent's and, when the spawn really started a child, the
  // child's. Each is decoded frame by frame (a single zstdDecompressSync sees only the first frame).
  const sessionsDir = join(home, "sessions")
  const files: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (entry.startsWith("session.") && (entry.endsWith(".zstd") || entry.endsWith(".jsonl"))) files.push(full)
    }
  }
  walk(sessionsDir)
  const sessions = files.map((file: string) => {
    const decoded = evidenceLib.decodeSessionLog(file)
    // The decoded container is JSONL text (one record per line); a torn final line is skipped, and
    // the counts are reported so a damaged artifact can never read as "no persona".
    const records: Array<{ type?: string; data?: unknown }> = []
    let undecodable = 0
    for (const line of decoded.text.split(/\r?\n/)) {
      if (line.trim() === "") continue
      try { records.push(JSON.parse(line) as { type?: string; data?: unknown }) } catch { undecodable += 1 }
    }
    const systemTexts: string[] = []
    const userTexts: string[] = []
    const types = new Map<string, number>()
    for (const record of records) {
      types.set(record.type ?? "?", (types.get(record.type ?? "?") ?? 0) + 1)
      const data = record.data as { message?: { role?: string; content?: unknown } } | undefined
      const message = data?.message
      if (message?.role === "system") systemTexts.push(JSON.stringify(message.content ?? ""))
      if (message?.role === "user") userTexts.push(JSON.stringify(message.content ?? ""))
    }
    const system = systemTexts.join("\n")
    return {
      file: file.slice(home.length + 1),
      id: file.split("/").slice(-2, -1)[0],
      records: records.length,
      undecodable,
      frames: decoded.frames,
      types: Object.fromEntries([...types.entries()]),
      systemBytes: system.length,
      hasPersonaMarker: system.includes(PERSONA_MARKER),
      personaContext: system.includes(PERSONA_MARKER) ? system.slice(Math.max(0, system.indexOf(PERSONA_MARKER) - 120), system.indexOf(PERSONA_MARKER) + 160) : null,
      userTextBytes: userTexts.join("\n").length,
      systemHead: system.slice(0, 220),
    }
  })
  // THE SPAWN RESULT, read from the parent's own tool records rather than the model's prose.
  const parentHasSpawnCall = sessions.some((session) => (session.types["tool/call"] ?? 0) > 0)
  const personaInAChild = sessions.some((session) => session.hasPersonaMarker)

  const result = {
    // THE CLAIM: at least one session (the spawned child) carried the roster persona verbatim.
    ok: personaInAChild,
    harness: "0.2.1-rc.2",
    role: ROLE_NAME,
    personaMarker: PERSONA_MARKER,
    sandbox: { root: sandbox, home, ws, kept: keepSandbox },
    credentialsSeeded: seeded.wrote,
    installExit: install.status ?? null,
    bootExit: boot.status ?? null,
    sessionCount: sessions.length,
    parentHasSpawnCall,
    personaInAChild,
    sessions,
    bootOutputTail: log.slice(-4000),
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), "=== boot ===\n" + log + "\n\n=== sessions ===\n" + JSON.stringify(sessions, null, 2) + "\n")
  console.log(JSON.stringify({ ok: result.ok, sessionCount: result.sessionCount, personaInAChild, sessions: sessions.map((session) => ({ id: session.id, records: session.records, systemBytes: session.systemBytes, hasPersonaMarker: session.hasPersonaMarker, types: session.types })) }, null, 2))
  if (!keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best effort */ } }
}

await main()
