#!/usr/bin/env bun
// Lane S evidence driver — the /plugins/mpd-team/events stream against a REAL mounted bundle.
//
// WHY TWO PHASES. S-e asks for a BEFORE/AFTER of the existing `/state` payload, and the honest
// "before" is not a re-render of the old projection in a test: it is the SAME route, mounted by the
// SAME row, from the dist that git currently has committed (the pre-change bytes), answering the SAME
// fixture, on the same sandbox. So the driver runs twice around the one rebuild:
//
//   node <this file> --phase seed       write the frozen team fixture into the sandbox workspace
//   node <this file> --phase before     install + boot the OLD dist, capture /state and probe /events
//   <rebuild dist with the pinned toolchain>
//   node <this file> --phase after      boot the NEW dist, compare /state, measure the SSE latency,
//                                       then run the refused-watch + re-arm arm in a second workspace
//   node <this file> --phase keepalive  boot the NEW dist on its own port and capture the 15 s `: ping`
//                                       (a 22 s raw `curl -i -N`) plus the response-head block
//   node <this file> --phase sweep      redact credentials out of the evidence logs; idempotent
//
// THE PHASES WITH A `before`/`after` IN THEM END WITH A CREDENTIAL SWEEP: the harness prints its web URL
// as `dsh web: http://127.0.0.1:<port>/?token=…` into the boot log this driver opened, so every phase
// redacts the logs and re-reads them before it returns (AGENTS.md §10).
//
// ISOLATION (AGENTS.md §7, skills/dsh-qa): a fresh DSH_HOME, a sandbox HOME, and a SANDBOXED
// WORKSPACE — the third one is the one that matters here, because every route resolves its workspace
// from the boot's own cwd, so an un-sandboxed boot would write the real checkout's `.mpd/team/**`.
// The real `~/.dsh` is never read or written; only its credentials are COPIED into the sandbox once.
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials, type Env } from "../../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { DSH_MISSING, dshAppSpec, spawnSpec } from "../../../../skills/dsh-qa/scripts/lib/dsh-launcher.ts"
import { assertSessionsSandboxed, sandboxWorkspace } from "../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"

/** This driver's own directory: the evidence directory for one UTC stamp. */
const OUT = dirname(fileURLToPath(import.meta.url))
/** The repository root, four levels up from this evidence directory. */
const REPO = join(OUT, "..", "..", "..", "..")
/** The bundle package name the profile install links to. */
const PKG = "@mpd-dsh/mpd"
/** The scratch root; `.qa-*` is the repository's declared ignore shape for a driver's sandbox. */
const SANDBOX = join(REPO, ".qa-change-feed", OUT.slice(OUT.lastIndexOf("/") + 1))
/** The sandbox `DSH_HOME` every boot inherits. */
const DSH_HOME = join(SANDBOX, "dsh-home")
/** The sandbox `HOME`; the skill and workmate roots leak through HOME, so it is isolated too. */
const SANDBOX_HOME = join(SANDBOX, "home")
/** The pnpm store the install resolves through, inside the sandbox. */
const STORE = join(SANDBOX, "store")
/** The workspace the S-e and S-a arms run in. */
const WS_A = sandboxWorkspace(SANDBOX, "ws-a")
/** The workspace the refused-watch and re-arm arms run in (it starts with `.mpd/team` as a FILE). */
const WS_B = sandboxWorkspace(SANDBOX, "ws-b")
/** The web port the first boot listens on (bundle-lifecycle owns 3197). */
const PORT_A = 3198
/** The web port the second, degradation boot listens on. */
const PORT_B = 3199
/** The web port the keep-alive arm listens on, so it never races a boot of another phase. */
const PORT_KEEPALIVE = 3200
/** How long the keep-alive arm waits for the `: ping`: the interval is 15 s, so 25 s is the arm's cap. */
const KEEPALIVE_IDLE_MS = 25000
/** The wall-clock budget of the RAW `curl -i` capture; the 15 s ping fits inside it with room to spare. */
const KEEPALIVE_RAW_SECONDS = 22
/** The keep-alive interval §3.2 of the LANE contract names, which the measured idle gap is judged against. */
const SSE_PING_INTERVAL_MS = 15000
/** The session the fixture record is bound to, so `/state?sessionId=…` answers it. */
const SESSION = "sess-lane-s"
/** How long a boot is given to answer its own route before the arm gives up. */
const BOOT_DEADLINE_MS = 180000

/** The phase this run performs, from argv. */
const PHASE = ((): string => {
  /** The `--phase` value, or "after" so a bare run does the measuring half. */
  const at = process.argv.indexOf("--phase")
  return at >= 0 ? String(process.argv[at + 1] ?? "after") : "after"
})()

/** The sandbox environment every child of this driver inherits; sandbox credentials only. */
function sandboxEnv(): Env {
  if (existsSync(join(homedir(), ".dsh", "settings.yaml"))) {
    // The model chain lives in settings.yaml for gateway providers; without it a boot falls back to the
    // base route and dies with MISSING_CREDENTIAL (measured, AGENTS.md §7).
    try { writeFileSync(join(DSH_HOME, "settings.yaml"), readFileSync(join(homedir(), ".dsh", "settings.yaml"))) } catch { /* absent is fine */ }
  }
  seedSandboxCredentials(DSH_HOME)
  return credentialEnv({
    ...process.env,
    DSH_HOME,
    HOME: SANDBOX_HOME,
    DSH_AGENTS_HOME: join(SANDBOX_HOME, ".agents"),
    // MEASURED, and it is a sandbox fact rather than a repo one: pnpm places its store OPERATION LOCK
    // at `$XDG_RUNTIME_DIR/pnpm-store-operation-locks-<uid>`, defaulting to `/run/user/<uid>` — which is
    // mounted READ-ONLY inside a workspace-write file sandbox, so the install dies with
    // `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK … Read-only file system (os error 30)`. Pointing the
    // runtime dir into the sandbox is also the more isolated choice: no two lanes share a lock file.
    XDG_RUNTIME_DIR: join(SANDBOX, "run"),
  })
}

/** Run one command to completion and report its status plus the merged output tail. */
function run(cmd: string, args: string[], env: Env, cwd: string = REPO): { status: number; out: string } {
  /** The resolved `{command, args}`, so a `.cmd` shim on win32 is handled by the shared helper. */
  const spec = spawnSpec(cmd, args, env)
  /** The finished child. */
  const result = spawnSync(spec.command, spec.args, { env, cwd, encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  return { status: result.status ?? -1, out: String(result.stdout ?? "") + String(result.stderr ?? "") }
}

/** Boot the web profile on one port with one workspace, and resolve once a team route answers. */
async function boot(name: string, port: number, workspace: string): Promise<{ child: ChildProcess; logPath: string }> {
  mkdirSync(workspace, { recursive: true })
  /** The boot log path; stdio goes to a FILE, never a pipe (a long-lived MCP child holds the fd). */
  const logPath = join(OUT, "boot-" + name + ".log")
  /** The log's descriptor, handed to the child as stdout and stderr. */
  const fd = openSync(logPath, "w")
  /** The environment, seeded once per boot so a phase never inherits a stale one. */
  const env = sandboxEnv()
  /** The app-form launcher; a direct node child, so the kill below really disposes of it. */
  const spec = dshAppSpec(["--profile", "w", "--port", String(port), "--no-open"], env)
  if (spec === null) throw new Error(DSH_MISSING)
  /** The boot child, whose cwd IS the sandbox workspace every route will resolve. */
  const child = spawn(spec.command, spec.args, { env, cwd: workspace, detached: false, stdio: ["ignore", fd, fd] })
  /** The instant the wait gives up at. */
  const deadline = Date.now() + BOOT_DEADLINE_MS
  while (Date.now() < deadline) {
    await sleep(1000)
    try {
      /** The liveness probe: the team route this lane owns, which answers without a session token. */
      const response = await fetch(`http://127.0.0.1:${port}/plugins/mpd-team/state`, { signal: AbortSignal.timeout(3000) })
      if (response.status === 200) { await response.text(); return { child, logPath } }
    } catch { /* not up yet */ }
  }
  child.kill("SIGKILL")
  throw new Error("the boot never answered /plugins/mpd-team/state; log tail:\n" + tail(readFileSync(logPath, "utf8"), 40))
}

/** Stop a boot child and give the port a moment to be released before the next one takes it. */
async function shutdown(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM")
  await sleep(1500)
  try { child.kill("SIGKILL") } catch { /* already gone */ }
  await sleep(500)
}

/** The last `n` lines of a log, so a failure carries the boot's own words. */
function tail(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n")
}

/** Wait `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Read one HTTP body through `curl`, so the request path is the one a user would take. */
function curl(url: string): { status: number; body: string } {
  // The body lands in a FILE and the status code on stdout: `-o /dev/stdout` mixes the two streams and
  // a reader that splits them by hand answers an empty body for a perfectly good 200 — measured here.
  /** The body's scratch path, inside the driver's own sandbox. */
  const bodyPath = join(SANDBOX, "curl-body.out")
  /** The finished curl, which prints only the status code. */
  const result = spawnSync("curl", ["-sS", "-o", bodyPath, "-w", "%{http_code}", "--max-time", "20", url], { encoding: "utf8" })
  return { status: Number(String(result.stdout ?? "").trim() || "0"), body: existsSync(bodyPath) ? readFileSync(bodyPath, "utf8") : "" }
}

/** One captured SSE frame: the instant it arrived, and its bytes. */
interface Frame {
  /** Epoch ms the chunk carrying this frame was read from curl's stdout. */
  at: number
  /** The frame's raw bytes. */
  text: string
}

/** Whether one frame is the connect announcement rather than a change. */
function isHello(frame: Frame): boolean {
  return frame.text.includes("event: hello")
}

/**
 * Whether one frame is a CHANGE frame: a `data:` line with NO `event:` name, which is the unnamed
 * `message` event a browser's `EventSource` listens to. The `hello` frame carries a `data:` line too,
 * so matching on `data:` alone would call the connect a change — MEASURED: the first version of this
 * driver killed its own stream on the connect frame and then measured nothing at all.
 */
function isChange(frame: Frame): boolean {
  return /^data: /.test(frame.text)
}

/** One live SSE connection: the frames as they arrive, and the two things an arm does with them. */
interface StreamHandle {
  /** The URL that was opened. */
  url: string
  /** The instant before curl was spawned. */
  openedAt: number
  /** Every frame, in arrival order. */
  frames: Frame[]
  /** Resolve on the first frame seen so far that matches, or `undefined` at the cap. */
  waitFor: (match: (frame: Frame) => boolean, timeoutMs: number) => Promise<Frame | undefined>
  /** Kill curl and let the connection go. */
  stop: () => Promise<void>
}

/**
 * Open one SSE stream with `curl -N` and hand back a LIVE handle on it.
 *
 * LIVE, not "collect until done": an arm has to do something to the workspace WHILE the stream is
 * open — that is the entire measurement — so the connection cannot be a call that blocks until its own
 * stop condition is met. That shape was the first version's defect and it measured nothing.
 *
 * `-N` is load-bearing: without it curl block-buffers a pipe and a frame can sit in its buffer for
 * kilobytes, which would make the measured latency a measurement of curl rather than of the feed.
 * @param url - the events route, query included.
 * @returns the handle; the caller owns {@link StreamHandle.stop}.
 */
function openStream(url: string): StreamHandle {
  /** The frames seen so far, shared with the handle the caller holds. */
  const frames: Frame[] = []
  /** The curl child; `-N` disables its own output buffering. */
  const child = spawn("curl", ["-N", "-sS", "--max-time", "60", url], { stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.setEncoding("utf8")
  /** The bytes that have arrived but not yet been split into whole frames. */
  let pending = ""
  child.stdout.on("data", (chunk: string) => {
    pending += chunk
    /** Frame boundaries are the blank line the SSE wire format uses. */
    const parts = pending.split("\n\n")
    pending = parts.pop() ?? ""
    for (const part of parts) {
      if (part.trim() === "") continue
      frames.push({ at: Date.now(), text: part + "\n\n" })
    }
  })
  return {
    url,
    openedAt: Date.now(),
    frames,
    waitFor: async (match: (frame: Frame) => boolean, timeoutMs: number): Promise<Frame | undefined> => {
      /** The instant the wait gives up at. */
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        /** The first matching frame, by arrival order. */
        const found = frames.find(match)
        if (found !== undefined) return found
        await sleep(2)
      }
      return undefined
    },
    stop: async (): Promise<void> => {
      if (child.exitCode === null) child.kill("SIGKILL")
      await sleep(120)
    },
  }
}

/** Write a team record the way ANOTHER PROCESS does: straight to disk, temp file plus rename. */
function writeRecordFromAnotherProcess(workspace: string, teamId: string, marker: string): { at: number; out: string } {
  /** The writer, a separate node process on purpose — nothing it does passes through this one. */
  const script = [
    'const { mkdirSync, writeFileSync, renameSync } = require("node:fs")',
    'const { join } = require("node:path")',
    'const dir = join(process.argv[1], ".mpd", "team", "teams")',
    'mkdirSync(dir, { recursive: true })',
    'const path = join(dir, process.argv[2] + ".json")',
    'const temp = path + ".tmp-" + process.pid',
    'writeFileSync(temp, JSON.stringify({ version: 1, teamId: process.argv[2], marker: process.argv[3], members: [], tasks: [] }, null, 2) + "\\n")',
    'renameSync(temp, path)',
    'process.stdout.write("WROTE_MS=" + Date.now() + "\\n")',
  ].join("\n")
  /** The finished writer. */
  const result = spawnSync(process.execPath, ["-e", script, workspace, teamId, marker], { encoding: "utf8" })
  /** The instant the writer reported, parsed back out of its own stdout. */
  const at = Number(/WROTE_MS=(\d+)/.exec(String(result.stdout ?? ""))?.[1] ?? "0")
  return { at, out: String(result.stdout ?? "") + String(result.stderr ?? "") }
}

/**
 * Write the sandbox's team fixture ONCE, through the store's own writers.
 *
 * Deterministic on purpose: both phases must answer `/state` from byte-identical state, or a diff
 * between the two bodies would prove nothing about the code under test.
 */
async function seed(): Promise<void> {
  mkdirSync(SANDBOX, { recursive: true })
  mkdirSync(SANDBOX_HOME, { recursive: true })
  // The pnpm runtime dir the install's store operation lock lives in (see `sandboxEnv`).
  mkdirSync(join(SANDBOX, "run"), { recursive: true })
  writeFileSync(join(SANDBOX, "probe.yml"), "- insert:\n    - id: lane-s-probe\n      name: " + JSON.stringify(join(REPO, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  if (!existsSync(join(WS_A, ".mpd", "team", "teams"))) {
    /** The fixture writer: the plugin's OWN store, so the fixture cannot drift from the real shape. */
    // THE ARGUMENTS TRAVEL IN THE ENVIRONMENT, not in argv: `bun -e <script> a b` puts the extras at
    // argv[1] and argv[2] while `node -e` puts them at argv[2] and argv[3], so a positional reader
    // silently takes the SESSION as the workspace and writes the fixture into a relative path — which
    // is exactly what happened here once, into a stray `<repo>/sess-lane-s/` directory.
    const script = [
      'import { createTeam, addTeamMember, addTeamTask, updateTeamTask, writeTeam, bindActiveTeam } from "' + join(REPO, "packages", "mpd-team-core-plugin", "src", "team-store.ts") + '"',
      'const workspace = process.env.MPD_LANE_S_WORKSPACE',
      'const session = process.env.MPD_LANE_S_SESSION',
      'const NOW = new Date("2026-10-08T07:00:00.000Z")',
      'let team = createTeam(workspace, { name: "lane-s", description: "publish changes", leadSessionId: session }, NOW)',
      'team = addTeamMember(team, { name: "Senior Engineer", description: "implements", role: "Senior Engineer" }, NOW)',
      'team = addTeamTask(team, { subject: "ship the feed", description: "publish", kind: "requirement", owner: "Senior Engineer" }, NOW)',
      'team = updateTeamTask(team, "T1", { status: "completed", attempt: 1 }, NOW)',
      'team = { ...team, approvedAt: NOW.toISOString() }',
      'writeTeam(workspace, team)',
      'bindActiveTeam(workspace, session, team.teamId)',
      'process.stdout.write(JSON.stringify({ teamId: team.teamId }) + "\\n")',
    ].join("\n")
    /** The writer's result, kept in the evidence so the fixture is reproducible. */
    const written = spawnSync("bun", ["-e", script], { encoding: "utf8", cwd: REPO, env: { ...process.env, MPD_LANE_S_WORKSPACE: WS_A, MPD_LANE_S_SESSION: SESSION } })
    writeFileSync(join(OUT, "fixture.json"), String(written.stdout ?? "") + String(written.stderr ?? ""))
    if (written.status !== 0) throw new Error("the fixture write failed:\n" + String(written.stderr ?? ""))
  }
  // The degradation workspace: `.mpd` exists and is writable, but `.mpd/team` is a FILE, so BOTH
  // `mkdirSync(teamRoot)` (EEXIST) and `mkdirSync(teamsDir)` (ENOTDIR) refuse — the real filesystem
  // refusal this arm needs, with no injected stub anywhere.
  // The path is reset first, because a previous run of this driver ENDS with the re-arm arm having
  // turned it into a real directory.
  rmSync(join(WS_B, ".mpd", "team"), { recursive: true, force: true })
  mkdirSync(join(WS_B, ".mpd"), { recursive: true })
  writeFileSync(join(WS_B, ".mpd", "team"), "this is a file where the team root belongs\n")
}

/** The `/state` body of one boot, plus the events route's answer at that moment. */
async function captureState(port: number, label: string): Promise<void> {
  /** The state route, asked about the fixture's session. */
  const state = curl(`http://127.0.0.1:${port}/plugins/mpd-team/state?sessionId=${SESSION}`)
  writeFileSync(join(OUT, label + "-state.json"), state.body)
  /** The events route probed the same way, which is how "before" shows the route did not exist. */
  const events = spawnSync("curl", ["-sS", "-o", join(OUT, label + "-events-body.txt"), "-w", "%{http_code}", "--max-time", "5", `http://127.0.0.1:${port}/plugins/mpd-team/events`], { encoding: "utf8" })
  writeFileSync(join(OUT, label + "-events-http.txt"), "HTTP " + String(events.stdout ?? "") + "\n")
  // THE SIX ROUTES ARE PROBED TOO, so "the family still answers" is measured rather than assumed.
  /** One line per route: its name and its status. */
  const family: string[] = []
  for (const route of ["state", "plan", "task", "mail", "events"]) {
    /** That route's status, taken with the fixture session attached where it matters. */
    const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", `http://127.0.0.1:${port}/plugins/mpd-team/${route}?sessionId=${SESSION}`], { encoding: "utf8" })
    family.push(`${route}=${String(probe.stdout ?? "").trim()}`)
  }
  writeFileSync(join(OUT, label + "-routes.txt"), family.join(" ") + "\n")
}

/** Why a captured stream capture ends with curl's exit code 28 rather than 0. */
const CURL_TIMEOUT_EXIT = 28

/** One header's value out of a captured response-head block, matched case-insensitively. */
function headerOf(block: string, name: string): string | null {
  /** The head: everything before the blank line that separates it from the body. */
  const head = block.split("\r\n\r\n")[0] ?? block
  for (const line of head.split(/\r?\n/)) {
    /** Where the header's name ends. */
    const at = line.indexOf(":")
    if (at < 0) continue
    if (line.slice(0, at).trim().toLowerCase() === name.toLowerCase()) return line.slice(at + 1).trim()
  }
  return null
}

/** The marker a redacted value is replaced with; it is deliberately not a value anyone can reuse. */
const REDACTED = "<redacted>"

/**
 * The credential shapes an evidence log can carry, each capturing the VALUE in group 2 so one pattern
 * serves both the redaction and the "did anything survive" re-read.
 */
const SECRET_PATTERNS: Array<{ value: RegExp; replacement: string }> = [
  // A credential in a URL query — the harness's own `dsh web: http://…?token=…` boot line is the one
  // that actually landed in this lane's evidence.
  { value: /([?&](?:token|access_token|api[_-]?key|apikey|auth|password|passwd|secret)=)([^&\s"'`]+)/gi, replacement: "$1" + REDACTED },
  // A credential in an Authorization header, in either the header or the `name: value` log shape.
  { value: /((?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?(?:bearer|basic|token)\s+)([^\s"',}]+)/gi, replacement: "$1" + REDACTED },
  // A bare `Bearer …` in a line that never names the header.
  { value: /\b(bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi, replacement: "$1" + REDACTED },
]

/** The credential-shaped VALUES one text carries, so a redaction can be checked against what it removed. */
function secretValues(text: string): string[] {
  /** Every captured value, across every pattern. */
  const found: string[] = []
  for (const pattern of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern.value)) {
      /** The captured value; group 1 is the parameter or scheme name and is deliberately kept. */
      const value = match[2]
      // `<redacted>` satisfies the pattern it replaced (it is a non-empty value), so it is skipped:
      // counting it would make the sweep report its own marker as a surviving secret on every re-run.
      if (value !== undefined && value !== "" && value !== REDACTED) found.push(value)
    }
  }
  return found
}

/** Replace every credential-shaped value with the fixed marker `<redacted>`, keeping the parameter name. */
function redactSecrets(text: string): string {
  /** The text with every pattern applied; the replacement is not itself a match, so this is idempotent. */
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern.value, pattern.replacement)
  return out
}

/**
 * Sweep the evidence logs: redact every credential-shaped value, then RE-READ to prove none survived.
 *
 * WHY THIS RUNS AFTER EVERY PHASE. The `?token=…` is printed by the HARNESS into the boot log this
 * driver opens, so a lane that re-runs must not re-leak one; the sweep is idempotent, and the check is
 * a re-read of the bytes on disk rather than a promise about them (AGENTS.md §10). The values never
 * leave this function — only their count does, because a redaction report that quotes what it removed
 * is a second leak.
 * @returns what was swept: the logs rewritten, the values replaced, and whether the re-read was clean.
 */
function redactEvidenceLogs(): { logs: number; occurrences: number; distinctValues: number; verified: boolean } {
  /** Every credential-shaped value seen, so the re-read can be checked against the exact strings. */
  const seen = new Set<string>()
  /** How many log files were rewritten. */
  let logs = 0
  /** How many values were replaced, counting one per occurrence. */
  let occurrences = 0
  for (const name of readdirSync(OUT).filter((entry) => entry.endsWith(".log"))) {
    /** That log's path and its bytes. */
    const path = join(OUT, name)
    const before = readFileSync(path, "utf8")
    /** The values this file carried, collected before they are removed. */
    const values = secretValues(before)
    if (values.length === 0 && redactSecrets(before) === before) continue
    for (const value of values) seen.add(value)
    occurrences += values.length
    writeFileSync(path, redactSecrets(before))
    logs += 1
  }
  /** Whether a re-read of every log still finds one of the values that were removed. */
  let verified = true
  for (const name of readdirSync(OUT).filter((entry) => entry.endsWith(".log"))) {
    /** The rewritten bytes, re-read from disk. */
    const after = readFileSync(join(OUT, name), "utf8")
    for (const value of seen) if (after.includes(value)) verified = false
    if (secretValues(after).length > 0) verified = false
  }
  return { logs, occurrences, distinctValues: seen.size, verified }
}

// ── the phases ───────────────────────────────────────────────────────────────

/** Phase `seed`: build the sandbox and its frozen fixture, and touch nothing else. */
async function phaseSeed(): Promise<void> {
  await seed()
  process.stdout.write("seed: sandbox=" + SANDBOX + "\n")
}

/**
 * Install the bundle into the sandbox profile, once, through the profile mechanism.
 *
 * THIS DRIVER MUST BE RUN WITH `node`, not bun — MEASURED: `dshAppSpec` spawns the harness app with
 * `process.execPath`, so a bun-hosted driver launches `lib/bin.js` under bun, and the harness app dies
 * with either `bun is unable to write files to tempdir: EROFS` or a V8-symbol load failure. Node is the
 * interpreter the launcher itself uses (`#!/usr/bin/env node`), so the app is spawned the way it ships.
 */
async function ensureInstalled(): Promise<void> {
  if (existsSync(join(DSH_HOME, "profiles", "w", "node_modules", PKG))) return
  // A previous attempt may have left a HALF-installed profile behind (a refusal mid-add), and a
  // reconcile against that residue reports the bundle composed while nothing resolves.
  rmSync(join(DSH_HOME, "profiles", "w"), { recursive: true, force: true })
  mkdirSync(join(DSH_HOME, "profiles", "w"), { recursive: true })
  writeFileSync(join(DSH_HOME, "profiles", "w", "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
  /** The ONE-command install straight from the checkout, through the profile mechanism. */
  const install = run("dsh", ["plugin", "--profile", "w", "add", "--store-dir", STORE, REPO], sandboxEnv())
  writeFileSync(join(OUT, "install.log"), install.out)
  if (install.status !== 0) throw new Error("install failed:\n" + tail(install.out, 30))
}

/** Phase `before`: install the bundle, boot the dist git has committed, and capture /state. */
async function phaseBefore(): Promise<void> {
  await seed()
  await ensureInstalled()
  /** The boot under test. */
  const { child } = await boot("before", PORT_A, WS_A)
  try {
    await captureState(PORT_A, "before")
  } finally {
    await shutdown(child)
  }
  /** The isolation verdict, recorded so the arm states its own containment. */
  const verdict = assertSessionsSandboxed(DSH_HOME, SANDBOX, { label: "change-feed-before" })
  writeFileSync(join(OUT, "before-isolation.txt"), JSON.stringify(verdict, null, 2) + "\n")
  process.stdout.write("before: captured /state and the route family\n")
}

/** Phase `after`: compare /state, measure the SSE latency, then run the degradation and re-arm arm. */
async function phaseAfter(): Promise<void> {
  await seed()
  await ensureInstalled()
  // ── S-e: the SAME route, the SAME fixture, ONE rebuild later ────────────────
  /** The boot under test. */
  const first = await boot("after", PORT_A, WS_A)
  try {
    await captureState(PORT_A, "after")
    // ── S-a: the stream, and one write made by ANOTHER process ────────────────
    /** The LIVE events stream; it stays open across the write below, which is the whole measurement. */
    const stream = openStream(`http://127.0.0.1:${PORT_A}/plugins/mpd-team/events?sessionId=${SESSION}`)
    /** The connect frame, which is what "the stream opened" means. */
    const hello = await stream.waitFor(isHello, 15000)
    // THE WRITE HAPPENS AFTER THE HELLO FRAME and on the LIVE stream, so the measured delta is between
    // a write and the frame it caused — never between a connect and a frame that was already queued.
    /** The external writer's own report; a separate process, so nothing it does passes through the boot. */
    const wrote = writeRecordFromAnotherProcess(WS_A, "team-lane-s-external", "s-a")
    /** The change frame that write produced. */
    const dataFrame = await stream.waitFor((frame) => isChange(frame) && frame.at >= wrote.at, 10000)
    await stream.stop()
    writeFileSync(join(OUT, "after-sse.txt"), stream.frames.map((frame) => `[+${frame.at - stream.openedAt}ms] ${JSON.stringify(frame.text)}`).join("\n") + "\n")
    /** The measurement S-a is judged on. */
    const measurement = {
      url: stream.url,
      openedAt: stream.openedAt,
      helloAt: hello?.at ?? null,
      helloText: hello?.text ?? null,
      writeAt: wrote.at,
      writerOutput: wrote.out.trim(),
      frameAt: dataFrame?.at ?? null,
      frameText: dataFrame?.text ?? null,
      deltaMs: dataFrame === undefined ? null : dataFrame.at - wrote.at,
      under200: dataFrame !== undefined && dataFrame.at - wrote.at < 200,
    }
    writeFileSync(join(OUT, "after-latency.json"), JSON.stringify(measurement, null, 2) + "\n")
  } finally {
    await shutdown(first.child)
  }
  // ── S-d (real): a REFUSED watch, and the re-arm that ends it ────────────────
  // The row log is append-only ACROSS boots, so it is cleared here: the count this arm reports is then
  // the count THIS boot wrote, not the sum of every previous run's.
  rmSync(join(WS_B, ".mpd", "logs"), { recursive: true, force: true })
  /** The boot whose workspace cannot host a watch (`.mpd/team` is a file). */
  const second = await boot("refused", PORT_B, WS_B)
  try {
    /** The stream opened against the refused workspace: it must still answer its hello frame. */
    const opened = openStream(`http://127.0.0.1:${PORT_B}/plugins/mpd-team/events`)
    /** That connect frame, which is what proves the refusal did not take the stream down with it. */
    const openedHello = await opened.waitFor(isHello, 8000)
    await opened.stop()
    // Now make the workspace watchable FROM OUTSIDE, exactly as another process would: drop the file
    // that stands where the directory belongs, then create the real root and a record.
    rmSync(join(WS_B, ".mpd", "team"), { force: true })
    writeRecordFromAnotherProcess(WS_B, "team-lane-s-first", "created-after-the-refusal")
    // A SECOND connection, on the same workspace, is what retries the arming: without it the feed
    // would have stopped watching forever the moment the directory appeared.
    /** The stream opened after the workspace became watchable. */
    const stream = openStream(`http://127.0.0.1:${PORT_B}/plugins/mpd-team/events`)
    /** The connect frame of that second stream, which is the instant the re-arm was attempted. */
    const streamHello = await stream.waitFor(isHello, 8000)
    /** The write that must be seen only by the re-armed WATCH — a different process made it. */
    const wrote = writeRecordFromAnotherProcess(WS_B, "team-lane-s-second", "seen-by-the-watch")
    /** That write's frame. */
    const dataFrame = await stream.waitFor((frame) => isChange(frame) && frame.at >= wrote.at, 10000)
    await stream.stop()
    /** The row log the plugin writes its bounded diagnostics to. */
    const rowLog = join(WS_B, ".mpd", "logs", "mpd-team-core.log")
    /** The watch-off lines the row log carries, which are the ONE line the contract asks for. */
    const watchOff = existsSync(rowLog) ? readFileSync(rowLog, "utf8").split("\n").filter((line) => line.includes("no filesystem watch")) : []
    /** The arming lines, which are what a successful retry must produce. */
    const armed = existsSync(rowLog) ? readFileSync(rowLog, "utf8").split("\n").filter((line) => line.includes("watch armed")) : []
    writeFileSync(join(OUT, "refused-sse.txt"), [
      "OPENED (hello expected, watch refused):",
      ...opened.frames.map((frame) => `[+${frame.at - opened.openedAt}ms] ${JSON.stringify(frame.text)}`),
      "",
      "AFTER THE RE-ARM (a change frame expected):",
      ...stream.frames.map((frame) => `[+${frame.at - stream.openedAt}ms] ${JSON.stringify(frame.text)}`),
    ].join("\n") + "\n")
    writeFileSync(join(OUT, "after-refused.json"), JSON.stringify({
      helloArrivedWithTheWatchRefused: openedHello !== undefined,
      openedHelloText: openedHello?.text ?? null,
      reArmHelloAt: streamHello?.at ?? null,
      rowLogPath: rowLog,
      watchOffLines: watchOff,
      watchOffLineCount: watchOff.length,
      armedLines: armed,
      writeAt: wrote.at,
      frameAt: dataFrame?.at ?? null,
      frameText: dataFrame?.text ?? null,
      deltaMs: dataFrame === undefined ? null : dataFrame.at - wrote.at,
      reArmProven: dataFrame !== undefined && dataFrame.at - wrote.at < 200,
    }, null, 2) + "\n")
  } finally {
    await shutdown(second.child)
  }
  /** The isolation verdict for the second boot, recorded the same way. */
  const verdict = assertSessionsSandboxed(DSH_HOME, SANDBOX, { label: "change-feed-after" })
  writeFileSync(join(OUT, "after-isolation.txt"), JSON.stringify(verdict, null, 2) + "\n")
  process.stdout.write("after: measured the stream, the refusal and the re-arm\n")
}

/**
 * Phase `keepalive`: the 15 s `: ping` comment and the response HEAD, both captured from the boot.
 *
 * WHY THIS IS AN ARM AND NOT A UNIT TEST. The keep-alive is a 15 s timer on a live socket and the head
 * is what a proxy reads, so neither can be witnessed by an arm that finishes in 75 ms — the longest
 * capture this lane had. Three captures, all against the SAME mounted route:
 *
 *   1. `curl -D` — the response-head block alone, written by curl itself (`after-keepalive-headers.txt`).
 *   2. `curl -i -N` for 22 s, stdout landed in a file untouched — ONE raw artifact carrying the head AND
 *      the `: ping` line (`after-keepalive-body.txt`).
 *   3. a LIVE handle, frame by frame with arrival instants — which turns "a ping appeared" into "the
 *      stream was idle for N ms" (`after-keepalive-sse.txt`).
 *
 * Both curl calls end with exit 28 (the stream never ends on its own; `--max-time` ends it), which is
 * recorded rather than smoothed over.
 */
async function phaseKeepalive(): Promise<void> {
  await seed()
  await ensureInstalled()
  /** The boot under test: the primary workspace, so the fixture is the team this stream follows. */
  const { child } = await boot("keepalive", PORT_KEEPALIVE, WS_A)
  try {
    /** The events route, session attached exactly as every other route takes it. */
    const url = `http://127.0.0.1:${PORT_KEEPALIVE}/plugins/mpd-team/events?sessionId=${SESSION}`
    // ── capture 1: the head, by curl itself ────────────────────────────────────
    /** Where `-D` writes the response-head block; the body goes to the sandbox and is dropped. */
    const headPath = join(OUT, "after-keepalive-headers.txt")
    /** The head capture; `--max-time 2` ends a stream that would otherwise stay open. */
    const headRun = spawnSync("curl", ["-sS", "-N", "-D", headPath, "-o", join(SANDBOX, "keepalive-head-body.out"), "--max-time", "2", url], { encoding: "utf8" })
    /** The captured block, read back so every check below runs against the bytes on disk. */
    const headBlock = existsSync(headPath) ? readFileSync(headPath, "utf8") : ""
    // ── capture 2: the raw 22 s idle stream, curl's own bytes ──────────────────
    /** The raw capture's path: the artifact the report points at for BOTH claims. */
    const rawPath = join(OUT, "after-keepalive-body.txt")
    /** The instant the raw capture started, so its elapsed time is measured rather than assumed. */
    const rawStart = Date.now()
    /** The raw capture: `-i` prepends the head, `-N` keeps curl from buffering, `-o` keeps it verbatim. */
    const rawRun = spawnSync("curl", ["-sS", "-i", "-N", "-o", rawPath, "--max-time", String(KEEPALIVE_RAW_SECONDS), url], { encoding: "utf8" })
    /** The instant it ended. */
    const rawEnd = Date.now()
    /** The captured bytes, read back for the frame checks below. */
    const rawText = existsSync(rawPath) ? readFileSync(rawPath, "utf8") : ""
    // ── capture 3: the live timeline, so the gap is a duration ─────────────────
    /** The live handle on a FRESH connection; the raw capture above is over by now. */
    const stream = openStream(url)
    /** The connect frame, which is the instant the idle window opens at. */
    const hello = await stream.waitFor(isHello, 10000)
    /** The keep-alive comment, matched on the written bytes rather than on a parsed frame kind. */
    const ping = await stream.waitFor((frame) => frame.text.includes(": ping"), KEEPALIVE_IDLE_MS)
    /** Every frame the handle saw, copied before the handle is dropped. */
    const frames = [...stream.frames]
    await stream.stop()
    writeFileSync(join(OUT, "after-keepalive-sse.txt"), frames.map((frame) => `[+${frame.at - stream.openedAt}ms] ${JSON.stringify(frame.text)}`).join("\n") + "\n")
    /** The four header values §3.2 of the contract names, exactly as the capture holds them. */
    const headers = {
      "content-type": headerOf(headBlock, "content-type"),
      "cache-control": headerOf(headBlock, "cache-control"),
      "connection": headerOf(headBlock, "connection"),
      "x-accel-buffering": headerOf(headBlock, "x-accel-buffering"),
    }
    /** The idle window the live handle measured between the connect frame and the keep-alive. */
    const idleGapMs = ping !== undefined && hello !== undefined ? ping.at - hello.at : null
    writeFileSync(join(OUT, "after-keepalive.json"), JSON.stringify({
      url,
      how: "ONE boot on port " + String(PORT_KEEPALIVE) + " serving the fixture workspace; three captures of the same route — the head by `curl -D`, a raw 22 s `curl -i -N`, and a live frame timeline",
      headerCapture: {
        file: "after-keepalive-headers.txt",
        curlExit: headRun.status ?? -1,
        curlExitNote: "exit " + String(CURL_TIMEOUT_EXIT) + " is the `--max-time 2` that ends a stream which never ends on its own",
        headers,
        allFourPresent: Object.values(headers).every((value) => value !== null),
        headBlock,
      },
      rawCapture: {
        file: "after-keepalive-body.txt",
        curlExit: rawRun.status ?? -1,
        elapsedMs: rawEnd - rawStart,
        bytes: Buffer.byteLength(rawText),
        carriesHead: rawText.includes("content-type: text/event-stream"),
        carriesHello: rawText.includes("event: hello"),
        carriesPing: rawText.includes(": ping"),
        pingLines: rawText.split("\n").filter((line) => line.trim() === ": ping").length,
        idleSeconds: Math.round((rawEnd - rawStart) / 100) / 10,
        over16s: rawEnd - rawStart > 16000,
      },
      liveTimeline: {
        file: "after-keepalive-sse.txt",
        openedAt: stream.openedAt,
        helloAt: hello?.at ?? null,
        helloText: hello?.text ?? null,
        pingAt: ping?.at ?? null,
        pingText: ping?.text ?? null,
        idleGapMs,
        idleGapAtLeastPingInterval: idleGapMs !== null && idleGapMs >= SSE_PING_INTERVAL_MS,
        framesBeforePing: ping === undefined ? null : frames.filter((frame) => frame.at < ping.at).length,
        changeFramesBeforePing: ping === undefined ? null : frames.filter((frame) => frame.at < ping.at && isChange(frame)).length,
        everyFrame: frames.map((frame) => ({ offsetMs: frame.at - stream.openedAt, text: frame.text })),
      },
    }, null, 2) + "\n")
  } finally {
    await shutdown(child)
  }
  /** The isolation verdict, recorded for this boot the same way the other phases record theirs. */
  const verdict = assertSessionsSandboxed(DSH_HOME, SANDBOX, { label: "change-feed-keepalive" })
  writeFileSync(join(OUT, "after-keepalive-isolation.txt"), JSON.stringify(verdict, null, 2) + "\n")
  process.stdout.write("keepalive: captured the head block and the idle `: ping`\n")
}

/** Phase `sweep`: redact the evidence logs and touch nothing else (the sweep itself runs in the finally). */
async function phaseSweep(): Promise<void> {
  process.stdout.write("sweep: the evidence logs are the subject; the sweep runs in this phase's finally\n")
}

/** The phase dispatch, so one file serves all three steps of the lane. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  try {
    if (PHASE === "seed") await phaseSeed()
    else if (PHASE === "before") await phaseBefore()
    else if (PHASE === "keepalive") await phaseKeepalive()
    else if (PHASE === "sweep") await phaseSweep()
    else await phaseAfter()
  } finally {
    // THE LEAK IS THE HARNESS'S, THE FIX IS OURS: `dsh web:` prints a live `?token=…` into a boot log
    // this driver opened, so EVERY phase ends by sweeping the evidence logs and re-reading them.
    /** The sweep's own report; no secret value is part of it. */
    const swept = redactEvidenceLogs()
    process.stdout.write("secret sweep: " + String(swept.occurrences) + " value(s) in " + String(swept.distinctValues) + " distinct form(s) redacted across " + String(swept.logs) + " log(s); re-read clean: " + String(swept.verified) + "\n")
  }
}

await main()
