#!/usr/bin/env bun
// Case model-config-live-refresh — AC6/R5 of .mpd/plans/model-config-live-refresh.md:
// prove IN-PROCESS live refresh of a model route on a REAL boot. ONE dsh process (the web
// platform), four phases, NO restart between the saves and the spawns:
//
//   A  BASELINE — create a session; the local DeepSeek-Messages stub answers the parent's
//      first model step with ONE `mpd_role_spawn` tool call (role "Junior Engineer", slot 3);
//      the spawned child's own request runs on the workspace's CONFIGURED slot3 route
//      (deepseek-v4-flash): the contract deleted the built-in slot-default layer, so the sandbox's
//      `.mpd/mpd.jsonc` declares that route before the boot.
//   B  SAVE — `settings/mutate(ns="mpd-config", set teamModels.slot3.model = deepseek-v4-pro)`
//      over the host's authenticated gateway API: the SAME entry-config surface the web card
//      (`ctx.configForms.get("mpd-config")`) and the TUI settings section write through.
//   C  AFTER-SAVE — a SECOND session in the SAME process; another `mpd_role_spawn`; the
//      child's request must run on deepseek-v4-pro — the value phase B saved.
//   D  FILE-EDIT (control) — a HAND EDIT of the read root's `.mpd/mpd.jsonc`, the OTHER live
//      surface R1 names, driven the same way.
//
// MEASURED (2026-10-13, harness 0.1.7-rc.2): the baseline legs PASS (the spawn really consults the
// slot). The save and file-edit legs were RED while the L4 entry layer was composed from the entry
// document's stale `describe().value`: the harness accepts and PERSISTS the entry save and fires the
// update event (the row log carries the subscription's heartbeat), but `value` keeps projecting the
// apply-time fiber config, so the re-loaded L4 layer froze the materialised defaults above every
// other layer. `readEntryConfig` now composes that layer from `describe().user` — the entry's SAVED
// override, `{}` until something is saved (`describe().base` is the inherited layer UNDER it and
// never moves with a save) — so every leg is expected GREEN. A re-introduced `value`/`base`
// composition turns the after-save, provider-side and file-edit legs RED while the boot pid stays
// equal; this case FAILS LOUDLY, never skips, and its evidence names the exact leg that broke.
// See `packet.diagnosis` in result.json.
//
// WHAT CARRIES THE PROOF (never the model's prose — SKILL.md hard rule 6):
//   · the HARNESS session logs, decoded frame by frame (concatenated-zstd container, T-25):
//     the PARENT log's `tool/call mpd_role_spawn` + non-error `tool/result`, and the CHILD
//     log's first `request/header` whose `data.header.config.model` is the route the spawn
//     resolved AT THAT MOMENT;
//   · the mutate answer's namespace descriptor (resolved teamModels.slot3.model);
//   · the stub trace (the provider-side model of every LLM request it served);
//   · `bootChild.pid` recorded at phase A and phase C — equal, because the case never stops
//     the boot: the no-restart claim is a measured fact, not an assumption.
// The CHILD log is identified by a per-phase marker inside the spawn TASK text — the child's
// first user message carries the persona+task the roles row assembled — so "the child ran on
// the new route" cannot pass on the wrong session's header.
//
// WHY A STUB, NOT A REAL KEY (t5 captain decision, same as readonly-deny): the stub answers
// the parent model step deterministically with the tool call, so the spawn path really runs in
// a FRESH dsh process while no credential is spent; `DEEPSEEK_API_KEY` is a throwaway value
// and `settings.yaml` is deliberately NOT copied (a gateway default there would route the
// parent away from the stub). The credentials FILE is still seeded once, because the harness
// checks a credential exists BEFORE the child is composed (measured, readonly-deny).
//
// PREREQ: absent-dsh-binary dsh "install dsh (`npm i -g @deepseek-ai/dsh`) or run inside a checkout install"
// PREREQ: absent-bundle-dist packages/mpd-config-plugin/dist/index.js "bun build packages/mpd-config-plugin/src/index.ts --target node --format esm --outfile packages/mpd-config-plugin/dist/index.js"
//
// Usage:
//   bun skills/dsh-qa/scripts/model-config-live-refresh.ts --self-test
//   bun skills/dsh-qa/scripts/model-config-live-refresh.ts [--out <dir>] [--keep]
// Evidence -> evidence/model-config-live-refresh/<timestamp>/{result.json,output.log,raw/}
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:http"
import type { ServerResponse } from "node:http"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { zstdCompressSync, zstdDecompressSync } from "node:zlib"
import { messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse, type WireRequest } from "./lib/messages-sse.ts"
import { findToolCall, scanZstdFrames, type SessionRecord } from "./lib/session-evidence.ts"
import { assertSessionsSandboxed, projectKey, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { DSH_MISSING, dshCommand, type Env } from "./lib/dsh-launcher.ts"

/** The case slug, used in evidence paths, banners and the SKIP/FAIL markers. */
const SLUG = "model-config-live-refresh"
/** The repository root, derived from this file's own URL (`<root>/skills/dsh-qa/scripts/`). */
const REPO: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The roster member this case spawns: slot 3 routes it (with Deep Worker). */
const MEMBER = "Junior Engineer"
/** The slot leaf the save rewrites, as the settings op path spells it. */
const SLOT_PATH: readonly string[] = ["teamModels", "slot3", "model"]
/** The workspace's CONFIGURED slot3 model — the value the baseline spawn must carry (there is no default layer). */
const BASELINE_MODEL = "deepseek-v4-flash"
/** The model phase B saves and phase C's spawn must carry — a different catalog member. */
const AFTER_MODEL: string = "deepseek-v4-pro"
/** The provider every phase expects: the slot's configured provider, routed at the stub. */
const EXPECTED_PROVIDER = "deepseek-official"
/** The per-phase task markers, embedded in the spawn task text and searched for in the child log. */
const MARKER_BASE = "ac6-baseline-" + process.pid
/** The after-save marker; both are unique per run so two phases can never share a log. */
const MARKER_AFTER = "ac6-after-save-" + process.pid
/** The file-edit control's marker (phase D, the watched hand edit of the read root's mpd.jsonc). */
const MARKER_FILE = "ac6-file-edit-" + process.pid
/** How long the boot may take to print its token and authorize the cookie, in milliseconds. */
const BOOT_DEADLINE_MS = 180_000
/** How long one phase may take from prompt to the decoded non-error spawn result, in milliseconds. */
const PHASE_DEADLINE_MS = 180_000
/** The poll cadence for every wait loop below, in milliseconds. */
const POLL_MS = 1_500

/** Print one output line and mirror it into the run's log collector. */
const said: string[] = []
/** @param line The line to print and record. */
function say(line: string): void {
  console.log(line)
  said.push(line)
}

/** Fail the case loudly with a marker line; a SKIP must never travel this path. @param why The failure cause. */
function fail(why: string): never {
  console.error("[" + SLUG + "] FAIL: " + why)
  process.exit(1)
}

/** The SKIP marker grammar (SKILL.md "Absent prerequisites"): exit 0, one first-stdout line, never a pass. @param reason The reason code. @param prereq The probed prerequisite. @param remedy The remedy sentence. */
function skip(reason: string, prereq: string, remedy: string): never {
  console.log(`[mpd-qa] SKIP case=${SLUG} lane=real reason=${reason} prereq=${prereq} remedy="${remedy}"`)
  process.exit(0)
}

/** Whether one traced LLM request is the PARENT's first model step: it offers tools and has no tool result yet (pure, so the self-test drives it). @param wire The request as the shared reader sees it. @returns True exactly for the step the stub must answer with the spawn tool call. */
function isParentStep(wire: WireRequest): boolean {
  return wire.toolNames.length > 0 && wire.toolResults.length === 0
}

/** One stub-served LLM request: the model the harness asked for, and what the stub answered. */
interface StubTraceEntry {
  /** The request's `model` field, exactly as the harness sent it. */
  readonly model: string | undefined
  /** How many tool names the request offered. */
  readonly tools: number
  /** How many tool results the conversation already carried. */
  readonly results: number
  /** Whether the stub answered this request with the spawn tool call. */
  readonly answeredWithSpawn: boolean
  /** Wall-clock milliseconds since the stub was created. */
  readonly atMs: number
}

/** The local DeepSeek-Messages stub: its request trace and its lifecycle. */
interface StubServer {
  /** Every request the stub served, in call order. */
  readonly trace: StubTraceEntry[]
  /** Begin a new phase: the next parent step gets the spawn tool call carrying this task text. @param task The spawn task text (with the phase marker). */
  readonly armPhase: (task: string) => void
  /** Bind the stub to an ephemeral loopback port; resolves with that port. */
  readonly listen: () => Promise<number>
  /** Stop accepting requests. */
  readonly close: () => void
}

/**
 * The stub provider: every request is answered per the phase latch — the FIRST parent step of
 * the armed phase gets one `mpd_role_spawn` tool call, everything else (the child's own turn,
 * the follow-up step, the session-title side request) gets a short text answer.
 * @returns The stub's trace and lifecycle handles.
 */
function makeStub(): StubServer {
  // Every request the stub served, in call order.
  const trace: StubTraceEntry[] = []
  // The task text the armed phase's spawn call carries, or "" while none is armed.
  let armedTask = ""
  // Whether the armed phase's spawn call was already answered (one spawn per phase).
  let spawnAnswered = false
  // The HTTP server itself; every request body is read fully before it is answered.
  const server = createServer((req, res) => {
    // The accumulated request body bytes.
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      // The raw body text, decoded once for the reader and once for the model field.
      const body = Buffer.concat(chunks).toString("utf8")
      // The request in whichever wire shape the provider used.
      let wire: WireRequest = { toolNames: [], toolResults: [], messages: [] }
      try { wire = readWireRequest(body) } catch { /* an undecodable body reads as carrying nothing */ }
      // The model field, read defensively: it is this case's provider-side measurement.
      let model: string | undefined
      try { model = (JSON.parse(body) as { model?: unknown }).model as string | undefined } catch { model = undefined }
      // Whether this request is the one the armed phase answers with the spawn call.
      const answerSpawn = armedTask !== "" && !spawnAnswered && isParentStep(wire)
      if (answerSpawn) spawnAnswered = true
      trace.push({ model, tools: wire.toolNames.length, results: wire.toolResults.length, answeredWithSpawn: answerSpawn, atMs: Date.now() % 1_000_000 })
      if (answerSpawn) writeMessagesSse(res as ServerResponse, messagesToolUseEvents("call_" + SLUG + "_" + trace.length, "mpd_role_spawn", { role: MEMBER, task: armedTask }))
      else writeMessagesSse(res as ServerResponse, messagesTextEvents("stub-final-answer"))
    })
  })
  return {
    trace,
    armPhase: (task: string): void => { armedTask = task; spawnAnswered = false },
    listen: (): Promise<number> => new Promise<number>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        // `createServer` binds a TCP socket, so `address()` is an `AddressInfo` here.
        const address = server.address()
        resolve(typeof address === "object" && address !== null ? address.port : 0)
      })
    }),
    close: (): void => { server.close() },
  }
}

/** One decoded session log: its file, its frame count and its records in file order. */
interface DecodedLog {
  /** The absolute log file path. */
  readonly file: string
  /** How many zstd frames were decoded (0 for plain JSONL). */
  readonly frames: number
  /** Every record decoded from the log, in file order. */
  readonly records: SessionRecord[]
}

/**
 * Decode ONE session log file frame by frame (the concatenated-zstd container, T-25: a naive
 * single `zstdDecompressSync` sees the header frame only and reports an EMPTY store).
 * @param file The session log file (`session.v*.jsonl.zstd` or plain JSONL).
 * @returns The decoded records, or `undefined` when the file cannot be decoded.
 */
function decodeSessionLogFile(file: string): DecodedLog | undefined {
  // The container bytes, read once.
  const buf = readFileSync(file)
  // The plain-JSONL fast path: no zstd magic, so the lines ARE the records.
  if (!(buf.length > 4 && buf.readUInt32LE(0) === 4247762216)) {
    // The plain lines parsed as records; a malformed line throws, exactly as a corrupt store should.
    const records = buf.toString("utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as SessionRecord)
    return { file, frames: 0, records }
  }
  // Every decompressed frame's text, concatenated in file order.
  let text = ""
  // The frame count, recorded so the T-25 trap is visible in the evidence.
  let frames = 0
  // The structure-only frame scan, locating every complete frame without decompressing.
  const scan = scanZstdFrames(buf)
  for (const frame of scan.frames) {
    text += zstdDecompressSync(buf.subarray(frame.start, frame.end)).toString("utf8")
    frames += 1
  }
  // The concatenated text parsed per line; an undecodable line degrades to an empty record, reported by count.
  const records = text.split("\n").filter((line) => line.trim() !== "").map((line) => { try { return JSON.parse(line) as SessionRecord } catch { return {} as SessionRecord } })
  return { file, frames, records }
}

/** Every session log under one project key, oldest first by mtime. @param home The sandbox DSH_HOME. @param ws The workspace whose project key the logs live under. @returns The decoded logs that parsed. */
function decodeWorkspaceLogs(home: string, ws: string): DecodedLog[] {
  // The project-keyed session directory, empty when no boot wrote a store.
  const keyDir = join(home, "sessions", projectKey(ws))
  if (!existsSync(keyDir)) return []
  // Every session id directory under the key.
  const ids = readdirSync(keyDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(keyDir, e.name))
  // Every log file candidate with its mtime, so the caller can rely on order.
  const files: Array<{ file: string; mtimeMs: number }> = []
  for (const dir of ids) for (const name of readdirSync(dir)) if (/^session\..*jsonl(\.zstd)?$/.test(name)) files.push({ file: join(dir, name), mtimeMs: statSync(join(dir, name)).mtimeMs })
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  // The decoded logs in mtime order, the caller's "oldest first" contract.
  const out: DecodedLog[] = []
  // One decode per candidate file; `decoded` is that file's parse, skipped when it has none.
  for (const { file } of files) {
    // The candidate's own decode result, undefined when the file refused to parse.
    const decoded = decodeSessionLogFile(file)
    if (decoded !== undefined) out.push(decoded)
  }
  return out
}

/** The first `request/header` record's `data.header.config`, or undefined when the log carries none. @param records The decoded records of one session log. @returns The request config the harness logged (provider/model/…). */
function firstRequestConfig(records: readonly SessionRecord[]): Record<string, unknown> | undefined {
  for (const record of records) {
    if ((record.type as string | undefined) !== "request/header") continue
    // The header's config node (provider/model/…), the proof carrier this reader exists for.
    const config = (record.data as { header?: { config?: Record<string, unknown> } } | undefined)?.header?.config
    if (config !== undefined) return config
  }
  return undefined
}

/** Whether any decoded record mentions a marker string (the child's persona+task message). @param records The decoded records of one session log. @param marker The per-phase marker. @returns True when the log belongs to the phase that marker names. */
function logMentions(records: readonly SessionRecord[], marker: string): boolean {
  return records.some((record) => JSON.stringify(record).includes(marker))
}

/** One sandbox: the two homes, the workspace and the environment the boot child inherits. */
interface Sandbox {
  /** The sandbox root: homes and workspace live under it. */
  readonly sandbox: string
  /** The sandbox `DSH_HOME` — never the real home (asserted below). */
  readonly home: string
  /** The sandbox `HOME` — skill roots leak through HOME, so it is never the real one. */
  readonly userHome: string
  /** The sandbox workspace the sessions are created in. */
  readonly ws: string
  /** The child environment: sandbox homes plus the throwaway provider key. */
  readonly env: Env
}

/**
 * Build the isolated sandbox: two temp homes, a workspace, and a web profile that links THIS
 * checkout as the `@mpd-dsh/mpd` bundle (the same profile shape the settings-bridge lane boots).
 * @returns The sandbox paths and the boot child's environment.
 */
function makeSandbox(): Sandbox {
  // The sandbox root everything else lives under — INSIDE the workspace as the declared
  // `.qa-<slug>/` scratch root (T-77, covered by `/.qa-*`), because a `/tmp` root is FRESH per
  // bash call on this host (T-23) and an autopsy of a failed run needs the store to survive.
  // A RANDOM suffix, never the pid: every bash call gets a fresh PID namespace (measured: two
  // consecutive runs both saw pid 3), so a pid-named root collides with the previous run's kept
  // store and the second run dies on `EEXIST` while linking the bundle.
  const sandbox = mkdtempSync(join(REPO, ".qa-" + SLUG + "-"))
  // The sandbox `DSH_HOME`: the profile and the session store live under it.
  const home = join(sandbox, "home")
  // The sandbox `HOME`: skill roots and the workmate library resolve under it.
  const userHome = join(sandbox, "userhome")
  // The profile directory the bundle is linked into (`dsh --profile w`).
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  // The declared credential store, copied ONCE into the sandbox (never read from the real home at
  // run time). Deliberately NOT `settings.yaml`: a gateway default there would route the parent
  // away from this case's stub — the stub serves every step, so no gateway chain is needed.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(home, ".credentials.yaml"))
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "junction")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  // The sandbox workspace every session is created in.
  const ws = sandboxWorkspace(sandbox)
  if (home.startsWith(join(homedir(), ".dsh"))) fail("isolation assertion: DSH_HOME points at the real home")
  return { sandbox, home, userHome, ws, env: { ...process.env, DSH_HOME: home, HOME: userHome, DEEPSEEK_API_KEY: "sk-" + SLUG + "-local-stub" } }
}

/** A running web boot: its child, its log reader and the authorized cookie. */
interface BootHandle {
  /** The boot child process, whose pid is the no-restart proof. */
  readonly child: ChildProcess
  /** Reads the boot's redirected log file. */
  readonly readLog: () => string
  /** The authorized launch cookie, "" until the token exchange succeeded. */
  readonly cookie: string
}

/** A FREE loopback port, so a leftover listener can never turn this case's assertions into an ECONNREFUSED cascade. @returns A port the OS just reported as free. */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    // A throwaway listener whose only job is to have the OS report a free port.
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      // The bound socket address, whose port member is the free port the OS just chose.
      const address = probe.address()
      // The OS-assigned port, or 0 when the address carried none (never resolvable, but typed).
      const port = typeof address === "object" && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/** Sleep helper for the poll loops. @param ms Milliseconds to wait. */
const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Boot the bundle's web platform in the sandbox, patching the `llm-deepseek` row at the stub.
 * @param sandbox The sandbox whose profile the boot loads.
 * @param logPath The file the boot's stdout+stderr are redirected to (T-24: never pipes).
 * @param port The loopback port the web app listens on.
 * @param stubPort The stub's loopback port the provider row points at.
 * @returns The boot handle once the token exchange authorized the cookie.
 * @throws When the boot dies early, cannot listen, or never serves.
 */
async function boot(sandbox: Sandbox, logPath: string, port: number, stubPort: number): Promise<BootHandle> {
  // The id-targeted overlay that routes the deepseek-official provider at the stub (the same
  // overlay shape readonly-deny appends and the settings-bridge `disabled` scenario composes).
  const overlay = join(sandbox.sandbox, "llm-stub.yml")
  writeFileSync(overlay, ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${stubPort}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"))
  // The inherited log descriptor: stdout AND stderr go to one file, never a pipe.
  const fd = openSync(logPath, "w")
  // The {command, args} spec for `dsh`, or null when no launcher resolves on this host.
  const childSpec = dshCommand(["--profile", "w", "--patch", overlay, "--port", String(port), "--no-open"], sandbox.env)
  if (childSpec === null) throw new Error(DSH_MISSING)
  // The boot child itself, with a sandbox cwd so no workspace state can leak into the repo.
  const child = spawn(childSpec.command, childSpec.args, { env: sandbox.env, cwd: sandbox.sandbox, stdio: ["ignore", fd, fd] })
  // Read the boot log as it stands; a file the child has not created yet reads as empty.
  const readLog = (): string => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  // The launch token scraped from the log's `token=…` line, empty until the boot prints it.
  let token = ""
  // The launch-token cookie the authorize redirect sets, empty until the root answers.
  let cookie = ""
  // The wall-clock deadline for the whole wait loop.
  const deadline = Date.now() + BOOT_DEADLINE_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    // An early death (a taken port, a bad profile) must be reported as ITSELF.
    const started = readLog()
    if (/EADDRINUSE/.test(started)) throw new Error("the boot could not listen on 127.0.0.1:" + port + " (EADDRINUSE)")
    if (child.exitCode !== null && token === "") throw new Error("the boot exited early with code " + String(child.exitCode) + " before serving; log tail: " + started.split("\n").slice(-6).join(" | "))
    // The token match in the current log slice, absent until the boot prints its URL.
    const match = /token=([A-Za-z0-9_-]+)/.exec(started)
    if (match !== null) token = match[1]
    if (token === "") continue
    try {
      // The authenticate redirect whose Set-Cookie carries the launch cookie.
      const authorize = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      // The same root WITH the cookie: a 200 proves the cookie authorizes the API.
      const root = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
      if (cookie !== "" && root.status === 200) return { child, readLog, cookie }
    } catch { /* not serving yet */ }
  }
  throw new Error("the boot never served within " + BOOT_DEADLINE_MS + "ms; log tail: " + readLog().split("\n").slice(-8).join(" | "))
}

/** The four things a lane ever reads off an RPC answer, each null when the answer lacked it. */
interface RpcOutcome {
  /** The HTTP status; 0 when the request never reached the host. */
  readonly status: number
  /** The envelope's `result` payload, or null when the answer carried none. */
  readonly result: unknown
  /** The envelope's protocol error, or null when the call succeeded. */
  readonly error: unknown
  /** The transport failure the lane synthesised, or null when the request was answered. */
  readonly transport: unknown
}

/**
 * One host RPC over the authenticated web API — the same wire call the web settings section
 * emits (`{type:"client-request", rpcId, method, payload:{args}}`).
 * @param port - the port the sandboxed web app listens on.
 * @param cookie - the launch cookie.
 * @param method - the `namespace/verb` method name (`settings/mutate`, `session/create`).
 * @param args - the payload's `args`, of that method's own shape.
 * @param timeoutMs - the abort timeout in milliseconds.
 * @returns status, result, protocol error and transport error, each null when absent.
 */
async function rpc(port: number, cookie: string, method: string, args: unknown, timeoutMs: number = 60_000): Promise<RpcOutcome> {
  // The per-call correlation id, unique enough for a lane that issues a handful of calls.
  const rpcId = SLUG + "-" + method.replace("/", "-") + "-" + String(Date.now())
  // The POST reduced to `{status, json}`, so a transport failure reads as status 0.
  const response = await fetch(`http://127.0.0.1:${port}/api/${method.split("/")[0]}/${method.split("/")[1]}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
      // The rejection viewed as the error-like record this detail reads; no shape is declared for one.
    const failure = error as { readonly cause?: { readonly code?: unknown }, readonly message?: unknown } | null | undefined
    return { status: 0, json: async () => ({ transport: String(failure?.cause?.code ?? failure?.message ?? error) }) }
  })
  // The host's own envelope, or an empty object when the body did not parse as JSON.
  const envelope = await response.json().catch(() => ({})) as Record<string, unknown>
  return { status: response.status, result: envelope.result ?? null, error: envelope.error ?? null, transport: envelope.transport ?? null }
}

/** The value at a string-key path inside an arbitrary JSON record (a cast per dynamic key). @param value The JSON value to walk. @param path The leaf path, e.g. `["teamModels","slot3","model"]`. @returns The leaf, or undefined when any step is absent. */
function leafOf(value: unknown, path: readonly string[]): unknown {
  // The walk accumulator, starting at the whole value and narrowing per path step.
  let acc: unknown = value
  for (const part of path) acc = acc === null || acc === undefined ? undefined : (acc as Record<string, unknown>)[part]
  return acc
}

/** Find one namespace descriptor anywhere in an RPC result (the envelope's nesting is the host's business). @param payload The parsed RPC result to search. @param ns The namespace name a candidate node must carry. @returns The matching node, or undefined. */
function findNamespaceDescriptor(payload: unknown, ns: string): Record<string, unknown> | undefined {
  // The nodes already visited, so a cyclic object cannot loop the walk.
  const seen: Set<object> = new Set()
  // The depth-first work list, seeded with the whole payload.
  const stack: unknown[] = [payload]
  while (stack.length > 0) {
    // The node under inspection; `undefined` only if the stack emptied since the length test.
    const node = stack.pop()
    if (node === null || node === undefined || typeof node !== "object" || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) { for (const item of node) if (item !== null && typeof item === "object") stack.push(item); continue }
    // The node as a plain JSON record: an arbitrary envelope has no declared key names.
    const record = node as Record<string, unknown>
    if (String(record.ns ?? "") === ns) return record
    for (const value of Object.values(record)) if (value !== null && typeof value === "object") stack.push(value)
  }
  return undefined
}

/** What one measured phase says: the spawn's harness-side evidence and the provider-side trace. */
interface PhaseEvidence {
  /** The marker this phase embedded in the spawn task. */
  readonly marker: string
  /** The parent session log file that carries the `mpd_role_spawn` tool call. */
  readonly parentLog: string
  /** Whether the parent log carries the tool call AND a non-error result (harness-side pairing). */
  readonly spawnCalledAndOk: boolean
  /** The spawn call's recorded arguments, exactly as the harness logged them. */
  readonly spawnArgs: unknown
  /** The child session log file identified by the phase marker. */
  readonly childLog: string | undefined
  /** The child's first request config (provider/model/…) from its own session log. */
  readonly childConfig: Record<string, unknown> | undefined
  /** The provider-side models the stub served between this phase's arm and its completion. */
  readonly stubModels: Array<string | undefined>
}

/**
 * Drive ONE phase: arm the stub, create a session, prompt it, wait until the parent log carries
 * the spawn tool call with a non-error result, then collect the harness-side and provider-side
 * evidence for that phase.
 * @param label The phase's label, for banners and evidence.
 * @param marker The per-phase marker embedded in the spawn task.
 * @param sandbox The sandbox (its ws the session is created in).
 * @param port The web app's port.
 * @param cookie The authorized cookie.
 * @param stub The stub whose next parent step answers with the spawn call.
 * @returns The phase's measured evidence.
 * @throws When the RPCs are refused or the deadline passes without the decoded spawn result.
 */
async function drivePhase(label: string, marker: string, sandbox: Sandbox, port: number, cookie: string, stub: StubServer): Promise<PhaseEvidence> {
  // The spawn task the stub's answer carries, with the phase marker inside.
  const task = "Say only 'phase done'. Marker " + marker
  // Arm the phase: the NEXT parent step is answered with the spawn tool call.
  stub.armPhase(task)
  // The trace index the phase starts at, so `stubModels` covers only this phase's requests.
  const traceFrom = stub.trace.length
  // The session created in the sandbox workspace, with the bundle's `mpd` agent preset. A
  // refusal answers `result:{ok:false,error}` with an HTTP 200 (measured), so both shapes count.
  const created = await rpc(port, cookie, "session/create", { request: { cwd: sandbox.ws, agentPreset: "mpd" } }, 90_000)
  // The create's refusal payload, which answers result:{ok:false,error} on an HTTP 200.
  const createRefusal = leafOf(created.result, ["error"])
  if (created.status !== 200 || created.error !== null || createRefusal !== undefined && createRefusal !== null) throw new Error(label + ": session/create refused (status " + created.status + "): " + JSON.stringify(created.error ?? createRefusal ?? created.transport))
  // The created session's id, read structurally from the result envelope: the host wraps the
  // create answer as `{ok, value:{sessionId, agentPreset}}` (measured), but a bare `{sessionId}`
  // shape is honoured too so a host envelope change degrades loudly, not silently.
  const sessionId = leafOf(created.result, ["value", "sessionId"]) ?? leafOf(created.result, ["sessionId"])
  if (typeof sessionId !== "string" || sessionId === "") throw new Error(label + ": session/create answered no sessionId: " + JSON.stringify(created.result).slice(0, 300))
  // The user prompt — the stub decides the step's answer, but the turn still needs a message.
  // MEASURED on the installed gateway: the args must be wrapped as `{request:{…}}` and a
  // REFUSAL answers `result:{ok:false,error:{…}}` with an HTTP 200, so both are checked.
  const prompted = await rpc(port, cookie, "session/prompt", { request: { requestId: SLUG + "-" + marker, sessionId, mode: "queue", content: [{ type: "text", text: "Run the one-shot spawn now." }] } })
  // The prompt's refusal payload, which answers result:{ok:false,error} on an HTTP 200.
  const promptRefusal = leafOf(prompted.result, ["error"])
  if (prompted.status !== 200 || prompted.error !== null || promptRefusal !== undefined && promptRefusal !== null) throw new Error(label + ": session/prompt refused (status " + prompted.status + "): " + JSON.stringify(prompted.error ?? promptRefusal ?? prompted.transport))
  // Wait until the PARENT log of THIS phase decodes a non-error tool/result for mpd_role_spawn —
  // the harness-side completion signal, never the stub's view of it. The parent log is tied to
  // the phase by its MARKER (the recorded tool-call arguments carry the task text), so phase C
  // can never mistake phase A's older parent log for its own.
  const deadline = Date.now() + PHASE_DEADLINE_MS
  // The decoded parent log of this phase, refreshed by every poll.
  let parent: DecodedLog | undefined
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    for (const log of decodeWorkspaceLogs(sandbox.home, sandbox.ws)) {
      // The shared judge's pairing verdict for this candidate log.
      const evidence = findToolCall(log.records, "mpd_role_spawn")
      if (evidence.called && evidence.succeeded && logMentions(log.records, marker)) { parent = log; break }
    }
    if (parent !== undefined) break
  }
  if (parent === undefined) {
    // The autopsy a timeout owes its reader: what the store holds, which record types each log
    // carries, and every request config the harness logged — so "the stub saw nothing" is
    // diagnosable from the failure alone instead of demanding a rerun with a kept sandbox.
    const logs = decodeWorkspaceLogs(sandbox.home, sandbox.ws)
    // The per-log digest: file, frame count, the record types present, and every request config.
    const autopsy = logs.map((log) => ({ file: log.file, frames: log.frames, types: [...new Set(log.records.map((record) => String(record.type)))], requestConfigs: log.records.filter((record) => record.type === "request/header").map((record) => (record.data as { header?: { config?: unknown } } | undefined)?.header?.config) }))
    throw new Error(label + ": no decoded parent log carries a non-error mpd_role_spawn result within " + PHASE_DEADLINE_MS + "ms (stub calls: " + stub.trace.length + "; logs: " + JSON.stringify(autopsy).slice(0, 1200) + ")")
  }
  // The harness-side pairing and the recorded spawn arguments.
  const pairing = findToolCall(parent.records, "mpd_role_spawn")
  // The child log: the one whose decoded records mention the phase marker.
  const child = decodeWorkspaceLogs(sandbox.home, sandbox.ws).find((log) => log.file !== parent.file && logMentions(log.records, marker))
  return {
    marker,
    parentLog: parent.file,
    spawnCalledAndOk: pairing.called && pairing.succeeded,
    spawnArgs: pairing.calls[0]?.arguments,
    childLog: child?.file,
    childConfig: child === undefined ? undefined : firstRequestConfig(child.records),
    stubModels: stub.trace.slice(traceFrom).map((entry) => entry.model),
  }
}

/** The offline self-test: every pure judge plus the shipped-contract pins. */
// The naive zstd read's line count on this runtime, informational (see the fixture below).
let naiveCount = -1
// The offline self-test body: every pure judge plus the shipped-contract pins.
function selfTest(): void {
  // Every assertion label paired with its verdict, so one run reports each break by name.
  const checks: Array<[string, boolean]> = []
  // The shipped settings schema source, whose slot shape and declared option lists this case mirrors.
  const schemaSrc = readFileSync(join(REPO, "packages", "mpd-config-plugin", "src", "settings-schema.ts"), "utf8")
  // The config plugin's source, whose live-refresh machinery and TOTAL slot service this case exercises.
  const pluginSrc = readFileSync(join(REPO, "packages", "mpd-config-plugin", "src", "index.ts"), "utf8")
  // The roster plugin's source, whose spawn tool must carry NO caller model override.
  const rolesSrc = readFileSync(join(REPO, "packages", "mpd-roles-plugin", "src", "index.ts"), "utf8")
  // The slot builder's OWN body (brace-terminated at column 0), so a default introduced inside it is caught.
  const slotBuilder = /function teamModelSlotSchema\(\)[^\n]*\{[\s\S]*?\n\}/.exec(schemaSrc)?.[0] ?? ""
  // The slot resolution's OWN body, so "never throws" is asserted on the function, not on a comment.
  const resolveSlotBody = /export function resolveTeamModelSlot\([\s\S]*?\n\}/.exec(pluginSrc)?.[0] ?? ""
  // The seed coordinator's OWN body, so the marker-first / declared-second order is asserted.
  const seedBody = /export function seedTeamModelsOnce\([\s\S]*?\n\}/.exec(pluginSrc)?.[0] ?? ""
  // The mpd_role_spawn parameter list, cut at `required:` so only the declared properties are scanned.
  const spawnParams = /name: "mpd_role_spawn"[\s\S]*?properties: \{([\s\S]*?)\}, required:/.exec(rolesSrc)?.[1] ?? ""
  // The three slot leaves exactly as the new contract spells them: present-but-optional, never defaulted.
  const slotLeaves = ["provider: z.string().required(false)", "model: z.string().required(false)", "reasoningEffort: z.string().required(false)"]
  // The declared model option list, which BASELINE_MODEL and AFTER_MODEL must both belong to.
  const modelOptions = /model: \[([^\]]*)\]/.exec(schemaSrc)?.[1] ?? ""
  // The declared provider option list, which EXPECTED_PROVIDER must belong to.
  const providerOptions = /provider: \[([^\]]*)\]/.exec(schemaSrc)?.[1] ?? ""
  // Where the seed's durable-marker guard sits in its body — the FIRST guard of the one-time seed.
  const markerGuardAt = seedBody.indexOf('if (existsSync(markerFile)) return { status: "marked" }')
  // The declared-block guard's position, which must come AFTER the marker guard (a deleted block is not re-seeded).
  const declaredGuardAt = seedBody.indexOf('if (declared === "declared")')

  // ── THE NEW CONTRACT: NO BUILT-IN DEFAULT LAYER, NO PER-MEMBER ROUTE TABLE (contract §2/§3) ──
  checks.push(["the shipped schema has NO built-in slot default table (TEAM_MODEL_SLOT_DEFAULTS is gone)", !schemaSrc.includes("TEAM_MODEL_SLOT_DEFAULTS")])
  checks.push(["the shipped sources DECLARE no per-member agentRoutes table (the doc comment naming its absence is not a declaration)", !/\bagentRoutes\s*:/.test(schemaSrc) && !/\bagentRoutes\s*:/.test(pluginSrc)])
  checks.push(["the slot subtree's three leaves are .required(false) with NO .default()", slotBuilder !== "" && slotLeaves.every((needle) => slotBuilder.includes(needle)) && !slotBuilder.includes(".default(")])
  checks.push(["the four slots are built by teamModelSlotSchema(), never by an inline default literal", /teamModels: z\.object\(\{[\s\S]*?slot4: teamModelSlotSchema\(\)/.test(schemaSrc) && !/slot[1-4]: *\{ *provider:/.test(schemaSrc)])
  checks.push(["BASELINE_MODEL is a declared model option", modelOptions.includes('"' + BASELINE_MODEL + '"')])
  checks.push(["AFTER_MODEL is a declared model option", modelOptions.includes('"' + AFTER_MODEL + '"')])
  checks.push(["EXPECTED_PROVIDER is a declared provider option", providerOptions.includes('"' + EXPECTED_PROVIDER + '"')])
  checks.push(["BASELINE_MODEL and AFTER_MODEL differ (the save changes the route)", BASELINE_MODEL !== AFTER_MODEL])

  // ── THE SERVICE IS TOTAL: a typed union and a route-or-undefined read, never an exception ──
  checks.push(["the service exposes the per-call TOTAL slotResolutionOf (typed SlotResolution)", pluginSrc.includes("slotResolutionOf: (member: string): SlotResolution => resolveTeamModelSlot(member, state.config)")])
  checks.push(["the resolution union is exported as ok:true | ok:false arms", pluginSrc.includes("export type SlotResolution = SlotResolved | SlotUnusable | SlotUnrouted")])
  checks.push(["the slot resolution RETURNS every refusal — its body carries no throw", resolveSlotBody !== "" && !resolveSlotBody.includes("throw")])
  checks.push(["the service exposes the TOTAL teamModelRouteOf read (route or undefined)", pluginSrc.includes("teamModelRouteOf: (member: string): TeamModelRoute | undefined => teamModelRouteOfMember(member, state.config)")])
  checks.push(["the route read answers undefined for every unusable slot, never throws", pluginSrc.includes("return resolution.ok ? resolution.route : undefined")])

  // ── THE SPAWN HAS NO CALLER MODEL OVERRIDE: its route comes from the slot, nowhere else ──
  checks.push(["mpd_role_spawn declares NO `model` parameter", spawnParams !== "" && spawnParams.includes("role:") && spawnParams.includes("task:") && !/\bmodel\s*:/.test(spawnParams)])
  checks.push(["mpd_role_spawn's model comes from the resolved slot route", rolesSrc.includes("const model = run.route.model")])

  // ── THE ONE-TIME SEED: a durable marker, and a deleted block is NEVER re-seeded (contract §10) ──
  checks.push(["the seed marker file name is model-config-seed.json", pluginSrc.includes('export const SEED_MARKER_FILE = "model-config-seed.json"')])
  checks.push(["the marker path is <ws>/.mpd/model-config-seed.json", pluginSrc.includes('return join(root, ".mpd", SEED_MARKER_FILE)')])
  checks.push(["the seed consults the MARKER first (a deleted block is never re-seeded)", markerGuardAt >= 0 && declaredGuardAt > markerGuardAt])
  checks.push(["a declared teamModels block is the user's own and is never rewritten", seedBody.includes('return { status: "declared" }')])

  // The machinery under test: the entry-config subscription and the per-call slot read.
  checks.push(["the plugin subscribes the ENTRY config document ('mpd-config')", pluginSrc.includes('onSettingsDocumentUpdated(ENTRY_CONFIG_ID') && pluginSrc.includes('ENTRY_CONFIG_ID = "mpd-config"')])
  checks.push(["the plugin re-loads state on the entry-config update, no restart", pluginSrc.includes("entry-config update: state re-loaded")])

  // The decode helper on a SYNTHETIC concatenated-zstd store: 3 frames, one record each, so the
  // T-25 trap (naive single-frame read) is proven absent from this case's reader.
  const tempHome = mkdtempSync(join(tmpdir(), "mpd-" + SLUG + "-st-"))
  try {
    // The records one child log would carry: header, request/header (the model proof), tool pair.
    const records: Array<Record<string, unknown>> = [
      { type: "session", version: 4 },
      { type: "request/header", data: { header: { config: { provider: EXPECTED_PROVIDER, model: AFTER_MODEL } } } },
      { type: "tool/call", data: { callId: "c1", name: "mpd_role_spawn", arguments: { role: MEMBER, task: "Marker " + MARKER_AFTER } } },
      { type: "tool/result", data: { message: { role: "tool", toolCallId: "c1", isError: false, content: [{ type: "text", text: "ok" }] } } },
    ]
    // The container file: each record its own zstd frame, exactly as the harness flushes.
    const sessionDir = join(tempHome, "sessions", projectKey(join(tempHome, "ws")), "sess-st")
    mkdirSync(sessionDir, { recursive: true })
    // The container file every arm below reads back through the case's own decoder.
    const file = join(sessionDir, "session.v4.jsonl.zstd")
    writeFileSync(file, Buffer.concat(records.map((record) => zstdCompressSync(Buffer.from(JSON.stringify(record) + "\n")))))
    // The naive single-frame read, measured INFORMATIONALLY: on bun 1.4.0 `zstdDecompressSync`
    // happens to decode every concatenated frame (measured while building this case), while the
    // T-25 trap was recorded against a stack whose naive read stopped at the header frame. The
    // trap is therefore RUNTIME-BOUND and is NOT asserted here; what IS asserted is that THIS
    // case's reader decodes frame by frame and yields every record on any stack.
    const naiveLocal = (() => { try { return zstdDecompressSync(readFileSync(file)).toString("utf8").split("\n").filter((l) => l.trim() !== "").length } catch { return 0 } })()
    naiveCount = naiveLocal
    // The case's own reader's verdict on the synthetic store.
    const decoded = decodeSessionLogFile(file)
    checks.push(["the reader decodes every frame of the synthetic store (4 frames, 4 records)", decoded !== undefined && decoded.frames === 4 && decoded.records.length === 4])
    if (decoded !== undefined) {
      // The child-config extraction: the FIRST request/header's model is the proof carrier.
      const config = firstRequestConfig(decoded.records)
      checks.push(["firstRequestConfig reads provider+model off the decoded header", config?.model === AFTER_MODEL && config?.provider === EXPECTED_PROVIDER])
      // The tool pairing through the shared judge.
      const pairing = findToolCall(decoded.records, "mpd_role_spawn")
      checks.push(["the decoded tool call pairs with a non-error result", pairing.called && pairing.succeeded && pairing.resultText === "ok"])
      checks.push(["the marker search finds the phase's own log", logMentions(decoded.records, MARKER_AFTER) && !logMentions(decoded.records, MARKER_BASE)])
    }
  } finally { rmSync(tempHome, { recursive: true, force: true }) }

  // The stub's parent-step classifier, driven on synthetic wire bodies.
  checks.push(["isParentStep: tools and no results is the parent step", isParentStep({ toolNames: ["mpd_role_spawn"], toolResults: [], messages: [] })])
  checks.push(["isParentStep: a request carrying tool results is NOT the parent step", !isParentStep({ toolNames: ["mpd_role_spawn"], toolResults: ["child answered"], messages: [] })])
  checks.push(["isParentStep: a request without tools is NOT the parent step", !isParentStep({ toolNames: [], toolResults: [], messages: [] })])

  // Falsifiability pins on this case's own source: the assertions that must stay load-bearing.
  const own = readFileSync(fileURLToPath(import.meta.url), "utf8")
  checks.push(["the case asserts the CHILD's request config model from the decoded log", own.includes("childConfig?.model") || own.includes(".childConfig?.model")])
  checks.push(["the case asserts the baseline model BEFORE the save (negative baseline)", own.includes("BASELINE_MODEL") && own.includes("baselineChildModel")])
  checks.push(["the case asserts the after-save model AFTER the save, same boot pid", own.includes("afterChildModel") && own.includes("pidAtBaseline === bootHandle.child.pid")])
  checks.push(["the case asserts three-way session isolation", own.includes("assertSessionsSandboxed(")])
  // The needle is assembled from parts so the check's own bytes cannot satisfy it vacuously.
  const entryNsNeedle = "ns: " + JSON.stringify("mpd" + "-config")
  checks.push(["the case drives the save through the mpd-config ENTRY config (ns)", own.includes('"settings/mut' + 'ate"') && own.includes(entryNsNeedle)])
  // The failures first (so a red run never prints an "ok" banner), then the green banner.
  const bad = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (bad.length > 0) fail("self-test: " + bad.join(" | "))
  console.log("[" + SLUG + " self-test] ok: " + checks.length + " checks (naive zstd read on this runtime decoded " + String(naiveCount) + "/4 — informational, the T-25 trap is runtime-bound)")
}

/** The real run: one boot, four phases, the evidence packet. @param argv The case's own command line (only --out/--keep are inspected). @returns The process exit code. */
async function runReal(argv: readonly string[]): Promise<number> {
  // The evidence directory: caller-supplied (refused when it exists, T-53/T-83) or fresh.
  const outAt = argv.indexOf("--out")
  // The evidence directory itself: the caller's value when given, else a fresh timestamped one.
  const outDir = outAt >= 0 && typeof argv[outAt + 1] === "string" && argv[outAt + 1] !== "" ? argv[outAt + 1] : join(REPO, "evidence", SLUG, new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"))
  if (existsSync(outDir)) fail("evidence directory already exists: " + outDir + " (T-53: pass a new --out or omit it)")
  mkdirSync(join(outDir, "raw"), { recursive: true })
  // The run's start instant and its log collector path.
  const startedAt = new Date().toISOString()
  // The run's own log file, written once at the end beside the result packet.
  const logFile = join(outDir, "output.log")
  say("[" + SLUG + "] start " + startedAt + " -> " + outDir)

  // Prerequisite probes (SKILL.md "Absent prerequisites"): positively probed, never caught.
  if (dshCommand(["--version"], process.env) === null) skip("absent-dsh-binary", "dsh", "install dsh (`npm i -g @deepseek-ai/dsh`) or run inside a checkout install")
  if (!existsSync(join(REPO, "packages", "mpd-config-plugin", "dist", "index.js"))) skip("absent-bundle-dist", "packages/mpd-config-plugin/dist/index.js", "bun build packages/mpd-config-plugin/src/index.ts --target node --format esm --outfile packages/mpd-config-plugin/dist/index.js")

  // The isolated sandbox and the two servers this case drives.
  const sandbox = makeSandbox()
  // THE BASELINE ROUTE IS CONFIGURED, NOT DEFAULTED: the contract deleted the built-in slot-default
  // layer (`.mpd/plans/slot-single-source.md` §2), so the read root DECLARES slot3's route before the
  // boot. Phase A then measures the workspace's own configuration, phase B moves the model through the
  // ENTRY config and phase D through this same file — the two live surfaces this case compares.
  const rootConfig = join(sandbox.sandbox, ".mpd", "mpd.jsonc")
  mkdirSync(dirname(rootConfig), { recursive: true })
  writeFileSync(rootConfig, "{\n  // ac6 baseline: the configured slot3 route\n  \"teamModels\": { \"slot3\": { \"provider\": \"" + EXPECTED_PROVIDER + "\", \"model\": \"" + BASELINE_MODEL + "\" } }\n}\n")
  // The stub provider that answers every model step this case drives.
  const stub = makeStub()
  // The stub's ephemeral loopback port, which the provider overlay points at.
  const stubPort = await stub.listen()
  // The web app's loopback port, picked free so a leftover listener cannot confuse the boot.
  const port = await freePort()
  say("[" + SLUG + "] sandbox " + sandbox.sandbox + " web=127.0.0.1:" + port + " stub=127.0.0.1:" + stubPort)
  // The boot's own log file, inside the evidence dir (redacted quotes only reach result.json).
  const bootLogPath = join(outDir, "raw", "boot.log")
  // The running boot: child, log reader and cookie, once the token exchange authorized.
  const bootHandle = await boot(sandbox, bootLogPath, port, stubPort)
  // The no-restart anchor: the boot child's pid, captured BEFORE the baseline phase.
  const pidAtBaseline = bootHandle.child.pid
  say("[" + SLUG + "] boot served (pid " + String(pidAtBaseline) + ")")

  // The evidence packet, filled phase by phase and written once at the end.
  const phases: Record<string, unknown> = {}
  // The result packet every phase fills and the end writes once, verdicts included.
  const packet: Record<string, unknown> = { case: SLUG, startedAt, ok: false, boot: { pid: pidAtBaseline, port, stubPort, workspace: sandbox.ws }, phases }

  // PHASE A — baseline: the slot resolves the workspace's CONFIGURED route before any save.
  const baseline = await drivePhase("baseline", MARKER_BASE, sandbox, port, bootHandle.cookie, stub)
  // The baseline child's model, read from its own decoded request header.
  const baselineChildModel = baseline.childConfig?.model as string | undefined
  say("[" + SLUG + "] baseline: spawn ok=" + String(baseline.spawnCalledAndOk) + " child model=" + JSON.stringify(baselineChildModel) + " (child log: " + String(baseline.childLog) + ")")
  phases.baseline = { ...baseline, childModel: baselineChildModel }

  // PHASE B — the save through the mpd-config ENTRY config (the front doors' own surface).
  const saved = await rpc(port, bootHandle.cookie, "settings/mutate", { ns: "mpd-config", ops: [{ op: "set", path: [...SLOT_PATH], value: AFTER_MODEL }] })
  // The mutate answer's refusal shape (result:{ok:false,error} on an HTTP 200) and its descriptor
  // for the entry, whose RESOLVED value must carry the save.
  // The mutate's refusal payload, which answers result:{ok:false,error} on an HTTP 200.
  const savedRefusal = leafOf(saved.result, ["error"])
  // The entry's descriptor inside the mutate answer, wherever the host nested it.
  const descriptor = findNamespaceDescriptor(saved.result, "mpd-config")
  // The descriptor's RESOLVED slot leaf — the surface every front door reads back.
  const savedResolved = descriptor === undefined ? undefined : leafOf(descriptor.value, SLOT_PATH)
  // The SAME leaf in the descriptor's `user` half: the override a save writes, and the layer the
  // config row now composes its L4 knobs from.
  const savedUserSlot = descriptor === undefined ? undefined : leafOf(descriptor.user, SLOT_PATH)
  // The SAME leaf in the descriptor's `base` half: the inherited layer BELOW the override, which a
  // save never moves (recorded so the composition choice is a measured fact of the run).
  const savedBaseSlot = descriptor === undefined ? undefined : leafOf(descriptor.base, SLOT_PATH)
  say("[" + SLUG + "] save: status " + saved.status + " resolved slot3.model=" + JSON.stringify(savedResolved) + " user=" + JSON.stringify(savedUserSlot) + " base=" + JSON.stringify(savedBaseSlot) + (saved.error !== null || savedRefusal !== undefined && savedRefusal !== null ? " error=" + JSON.stringify(saved.error ?? savedRefusal) : ""))
  packet.save = { status: saved.status, error: saved.error ?? null, resolved: savedResolved ?? null, userSlot: savedUserSlot ?? null, baseSlot: savedBaseSlot ?? null, revision: (descriptor?.revision as number | undefined) ?? null }

  // PHASE C — after-save, SAME process: the next spawn carries the saved route.
  const pidAtAfter = bootHandle.child.pid
  // The after-save phase's measurements, driven in the SAME process as the baseline.
  const after = await drivePhase("after-save", MARKER_AFTER, sandbox, port, bootHandle.cookie, stub)
  // The after-save child's model: the leg AC6 exists to prove (or to name its blocker).
  const afterChildModel = after.childConfig?.model as string | undefined
  say("[" + SLUG + "] after-save: spawn ok=" + String(after.spawnCalledAndOk) + " child model=" + JSON.stringify(afterChildModel) + " (child log: " + String(after.childLog) + ")")
  phases.afterSave = { ...after, childModel: afterChildModel }

  // PHASE D — the OTHER live surface R1 names, as the LOCALIZING CONTROL: a HAND EDIT of the
  // read root's `<root>/.mpd/mpd.jsonc`, observed by L1's mount-armed watcher (no settings
  // document involved). MEASURED (2026-10-13, harness 0.1.7-rc.2): this phase was RED while the L4
  // row-knob layer (`entryKnobs`) was composed from the stale entry VALUE — L4 SITS ON TOP of every
  // file layer, so the frozen materialised defaults buried a file edit exactly as they buried the
  // entry save. With the layer composed from `describe().user` (SAVED leaves only) the file edit
  // stays visible; the boot-pid equality proves neither surface ever reached a restart.
  // The hand edit REPLACES the file's slot3 route — provider included, so the route stays whole under
  // the schema that no longer invents a default — with the same model phase B saved through the entry.
  mkdirSync(dirname(rootConfig), { recursive: true })
  writeFileSync(rootConfig, "{\n  // ac6 phase D: the watched hand edit\n  \"teamModels\": { \"slot3\": { \"provider\": \"" + EXPECTED_PROVIDER + "\", \"model\": \"" + AFTER_MODEL + "\" } }\n}\n")
  // The watcher's documented quiet period is a 150 ms debounce plus the reload; settle generously.
  await sleep(2_000)
  // The boot pid read again at the file-edit phase, the last no-restart anchor.
  const pidAtFileEdit = bootHandle.child.pid
  // The file-edit phase's measurements, still the SAME process.
  const fileEdit = await drivePhase("file-edit", MARKER_FILE, sandbox, port, bootHandle.cookie, stub)
  // The file-edit child's model: red together with the C-phase names the ONE root cause.
  const fileEditChildModel = fileEdit.childConfig?.model as string | undefined
  say("[" + SLUG + "] file-edit: spawn ok=" + String(fileEdit.spawnCalledAndOk) + " child model=" + JSON.stringify(fileEditChildModel) + " (child log: " + String(fileEdit.childLog) + ")")
  phases.fileEdit = { ...fileEdit, childModel: fileEditChildModel, file: rootConfig }

  // The row's own log under the read root — the entry-config subscription's heartbeat and the
  // watcher's reloads land there, quoted so the evidence shows WHICH refresh path fired.
  const rowLog = ((): string => { try { return readFileSync(join(sandbox.sandbox, ".mpd", "logs", "mpd-config.log"), "utf8") } catch { return "" } })()
  packet.rowLog = rowLog.split("\n").slice(-12)

  // Isolation, asserted on the REAL store the boot wrote.
  const isolation = assertSessionsSandboxed(sandbox.home, sandbox.sandbox, { label: SLUG })
  // Stop the boot: the phases are measured, nothing may write anymore.
  try { bootHandle.child.kill("SIGTERM") } catch { /* already gone */ }
  await sleep(2_000)
  try { bootHandle.child.kill("SIGKILL") } catch { /* already gone */ }
  stub.close()

  // The verdict, every leg asserted — a miss names the leg that failed.
  const verdicts: Array<[string, boolean, string]> = [
    ["baseline: the parent log carries the spawn call + non-error result", baseline.spawnCalledAndOk, "the harness must record the tool call AND its non-error result (parent log " + baseline.parentLog + ")"],
    ["baseline: the child log was found by its phase marker", baseline.childLog !== undefined, "a session log under " + sandbox.ws + " must carry the marker " + MARKER_BASE],
    ["baseline (negative): the child ran on the workspace's CONFIGURED slot3 model before any save", baselineChildModel === BASELINE_MODEL, "decoded child request config.model=" + JSON.stringify(baselineChildModel) + ", expected " + JSON.stringify(BASELINE_MODEL)],
    ["save: the entry-config mutate was accepted", saved.status === 200 && saved.error === null && (savedRefusal === undefined || savedRefusal === null), "settings/mutate(ns=mpd-config) status " + saved.status + " error " + JSON.stringify(saved.error ?? savedRefusal)],
    ["save: the descriptor's SAVED OVERRIDE (user) carries the saved model — the layer the config row composes", savedUserSlot === AFTER_MODEL, "user=" + JSON.stringify(savedUserSlot) + ", expected " + JSON.stringify(AFTER_MODEL) + " (value=" + JSON.stringify(savedResolved) + ", base=" + JSON.stringify(savedBaseSlot) + " — T-93: the descriptor's value/base stay apply-time/inherited on harness 0.1.7-rc.2, so `user` is the only half a save moves)"],
    ["no restart: the boot pid is the SAME process across baseline and after-save", pidAtBaseline === pidAtAfter, "pid at baseline " + String(pidAtBaseline) + " vs at after-save " + String(pidAtAfter)],
    ["after-save: the parent log carries the spawn call + non-error result", after.spawnCalledAndOk, "the harness must record the tool call AND its non-error result (parent log " + after.parentLog + ")"],
    ["after-save: the child log was found by its phase marker", after.childLog !== undefined, "a session log under " + sandbox.ws + " must carry the marker " + MARKER_AFTER],
    ["after-save: the child ran on the SAVED model, no restart", afterChildModel === AFTER_MODEL, "decoded child request config.model=" + JSON.stringify(afterChildModel) + ", expected " + JSON.stringify(AFTER_MODEL)],
    ["after-save: the child's provider is the slot provider", (after.childConfig?.provider as string | undefined) === EXPECTED_PROVIDER, "decoded child request config.provider=" + JSON.stringify(after.childConfig?.provider)],
    ["isolation: every session-store key stayed inside the sandbox", isolation.ok, "assertSessionsSandboxed checked " + String(isolation.checked) + " key(s)"],
  ]
  // The provider-side cross-check: the stub served a request for the saved model after the save.
  const stubServedAfterModel = after.stubModels.includes(AFTER_MODEL)
  verdicts.push(["provider-side: the stub served a request for the saved model after the save", stubServedAfterModel, "stub models after the save: " + JSON.stringify(after.stubModels)])
  // The LOCALIZING CONTROL's legs: the file edit is expected to stay frozen by the SAME root
  // cause (the stale entry VALUE sits as L4 above every file layer), the entry subscription's
  // heartbeat proves the plugin-side machinery DID run, and the boot pid never changed.
  verdicts.push(["file-edit (control): the child ran on the FILE-EDITED model, no restart", fileEditChildModel === AFTER_MODEL, "decoded child request config.model=" + JSON.stringify(fileEditChildModel) + ", expected " + JSON.stringify(AFTER_MODEL) + " — a red here with a red C-phase names the ONE root cause: the stale entry VALUE re-loaded as the L4 row-knob layer overrides the file edit too"])
  verdicts.push(["no restart across every phase (baseline → save → file-edit)", pidAtBaseline === pidAtFileEdit, "pid at baseline " + String(pidAtBaseline) + " vs at file-edit " + String(pidAtFileEdit)])
  verdicts.push(["the entry-config subscription FIRED (its heartbeat is on the row log)", rowLog.includes("entry-config update: state re-loaded"), "row log tail: " + JSON.stringify(rowLog.split("\n").slice(-3))])

  // The decoded quotes the report cites (T-90: an artifact path plus the bytes it carried).
  const quotes = {
    baselineChildHeader: baseline.childConfig ?? null,
    afterSaveChildHeader: after.childConfig ?? null,
    spawnArgsBaseline: baseline.spawnArgs ?? null,
    spawnArgsAfterSave: after.spawnArgs ?? null,
  }
  packet.quotes = quotes
  // The measured diagnosis this case pins (harness 0.1.7-rc.2): the settings service ACCEPTS the
  // entry save and persists it to the profile patch, and the entry subscription FIRES
  // ("entry-config update: state re-loaded", row log) — but the entry document's `value` keeps
  // projecting the APPLY-TIME fiber config and `base` is the inherited layer BELOW the override, so
  // ONLY `user` (the override half) moves with a save. The L4 entry-knob layer is therefore composed
  // from `describe().user`: the save reaches the next spawn with no restart, and a layer of
  // materialised defaults can no longer bury a lower-layer file edit.
  packet.diagnosis = "harness 0.1.7-rc.2: settings/mutate(ns=mpd-config) persists to the profile patch and fires settings/document-updated, but the entry document's resolved value keeps projecting the apply-time fiber config and base stays the inherited layer below the override — only user, the SAVED override, moves with the save. The L4 entry-knob layer is composed from describe().user, so the save reaches the next spawn with no restart and a materialised default cannot bury a lower-layer file edit. Measured at the save: value=" + JSON.stringify(savedResolved) + " user=" + JSON.stringify(savedUserSlot) + " base=" + JSON.stringify(savedBaseSlot) + "."
  packet.stubTrace = stub.trace.map((entry) => ({ model: entry.model, tools: entry.tools, results: entry.results, spawn: entry.answeredWithSpawn }))
  packet.isolation = isolation
  packet.checks = verdicts.map(([name, ok, detail]) => ({ name, ok, detail }))
  packet.ok = verdicts.every(([, ok]) => ok)
  packet.elapsedMs = Date.now() - Date.parse(startedAt)
  writeFileSync(join(outDir, "result.json"), JSON.stringify(packet, null, 2))
  // The boot log's tail, redacted of token lines (no secret material in evidence).
  const bootTail = bootHandle.readLog().split("\n").filter((line) => !/token=/.test(line)).slice(-40).join("\n")
  writeFileSync(logFile, [...said, "", "== boot.log tail (token lines redacted) ==", bootTail].join("\n") + "\n")
  for (const [name, ok, detail] of verdicts) if (!ok) say("[" + SLUG + "] RED: " + name + " — " + detail)
  say("[" + SLUG + "] " + (packet.ok ? "PASS" : "FAIL") + " evidence=" + outDir)
  return packet.ok ? 0 : 1
}

// The entry: --self-test offline, otherwise the real run (a crash is the case's own FAIL).
const argv: string[] = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else {
  try {
    process.exit(await runReal(argv))
  } catch (error) {
    console.error("[" + SLUG + "] CRASH: " + String((error as { stack?: unknown } | null)?.stack ?? error))
    process.exit(1)
  }
}
