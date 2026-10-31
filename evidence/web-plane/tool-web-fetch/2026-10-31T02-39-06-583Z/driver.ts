#!/usr/bin/env node
// Experiment driver: does `tool-web` with `fetch: true` give an `mpd`-preset session a
// REGISTERED and WORKING `web_fetch`?
//
// THREE ARMS, one isolated sandbox each, the ONLY inter-arm difference being the copied
// bundle's `presets/mpd.patch.yml` (positive: `fetch: true`; negative: byte-identical to the
// tracked file, i.e. `fetch: false`) — or, for the call arms, the model route:
//   positive     stub model, text-only answers       -> web_fetch must be in request/header tools[]
//   negative     stub model, text-only answers       -> web_fetch must be ABSENT (falsifiability)
//   realCall     the `mpd` bundle WITH fetch:true, a second boot:
//                 mode "live"  : the machine's own credentials, the real model decides to call
//                 mode "stub"  : a local stub asks for the call; the HARNESS still executes it
//
// Isolation (AGENTS.md §7): temp DSH_HOME + sandbox HOME + sandbox workspace cwd, credentials
// copied ONCE into the sandbox, every dsh child's stdio redirected to a FILE (T-24), and the
// tracked preset is never edited (every arm boots a COPY).
//
// Evidence comes from the HARNESS's own session store (lib/session-evidence.ts): a
// `request/header` record's `header.tools[]` for the tool LIST, and `tool/call` +
// `tool/result` for the CALL. A stub answer is never counted as tool evidence.
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { projectKey, sandboxWorkspace } from "../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { findToolCall, readSessionEvents, recordedToolNames, type SessionStore } from "../skills/dsh-qa/scripts/lib/session-evidence.ts"
import { messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse } from "../skills/dsh-qa/scripts/lib/messages-sse.ts"
import { DSH_MISSING, dshCommand } from "../skills/dsh-qa/scripts/lib/dsh-launcher.ts"
import { seedSandboxCredentials } from "../skills/dsh-qa/scripts/lib/credentials.ts"

/** This driver's own directory (`.qa-tool-web-fetch`); its parent is the repository root. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** The repository root the tracked preset and the QA libraries live under. */
const REPO: string = dirname(HERE)
/** The tracked preset the two bundle copies are derived from. */
const TRACKED_PRESET: string = join(REPO, "presets", "mpd.patch.yml")
/** The exact boolean line the positive copy flips, and the only line it may change. */
const FETCH_LINE = "fetch: false"
/** The tool this experiment is about. */
const TOOL = "web_fetch"
/** The URL the call arms ask for. */
const URL_UNDER_TEST = "https://example.com"
/** The prompt the registration arms send; deliberately tool-agnostic. */
const PROMPT_PLAIN = "Reply with the single word: ready."
/** The prompt the call arms send: it names the tool and the URL. */
const PROMPT_FETCH = "Use the web_fetch tool to fetch " + URL_UNDER_TEST + " and then report the text of the page's first heading. Call the tool; do not answer from memory."
/** The throwaway key the stub arms export, so no real credential is ever used there. */
const STUB_KEY = "sk-qa-local-stub"
/** Root entries of the repository that are NOT symlinked into a bundle copy (copied or omitted). */
const NOT_SYMLINKED: ReadonlySet<string> = new Set(["package.json", "cordis.patch.yml", "presets", ".git", "node_modules", "evidence", ".mpd", ".qa-tool-web-fetch"])

/** Every line this driver printed, kept for `output.log`. */
const CAPTURED: string[] = []

/**
 * Print one line, prefixing it with the experiment slug and keeping it for the evidence file.
 * @param text The line body.
 * @returns Nothing.
 */
function say(text: string): void {
  // The printed line, prefixed so a reader can grep this run out of a combined console.
  const line = "[tool-web-fetch] " + text
  CAPTURED.push(line)
  console.log(line)
}

/**
 * The lowercase hex sha256 of one file's bytes.
 * @param file Absolute path of the file to hash.
 * @returns 64 hex characters.
 */
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

/**
 * Redact credential-shaped material so a committed log can never carry a secret (AGENTS.md §10).
 * @param text The text to redact.
 * @returns The text with launch tokens, bearer values and key-shaped strings replaced.
 */
function redact(text: string): string {
  return text
    .replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1<redacted>")
}

/**
 * A free loopback TCP port, obtained by listening on port 0 and closing at once.
 * @returns The port number the OS handed out.
 */
async function freePort(): Promise<number> {
  return new Promise<number>((done, fail) => {
    // The throwaway listener whose bound port is the answer.
    const probe = createServer()
    probe.once("error", fail)
    probe.listen(0, "127.0.0.1", () => {
      // The ephemeral port the kernel assigned.
      const address = probe.address()
      // The numeric port, or 0 when the address is not a TCP one (never for this call shape).
      const port = typeof address === "object" && address !== null ? address.port : 0
      probe.close(() => done(port))
    })
  })
}

/**
 * A delay helper.
 * @param ms Milliseconds to wait.
 * @returns A promise that settles after the delay.
 */
const sleep = (ms: number): Promise<void> => new Promise<void>((done) => setTimeout(done, ms))

/** What the local model stub offered/served, kept for the evidence file. */
interface StubTrace {
  /** 1-based request ordinal. */
  readonly n: number
  /** How many tools the request offered. */
  readonly toolCount: number
  /** Whether the request offered `web_fetch`. */
  readonly offeredFetch: boolean
  /** How many tool results the conversation already carried. */
  readonly toolResults: number
  /** The answer this request got: `text` or `tool_use:<name>`. */
  readonly answered: string
}

/** One local DeepSeek-Messages stub: its bound port, its trace and its lifecycle. */
interface Stub {
  /** The loopback port the provider's baseURL points at. */
  readonly port: number
  /** Every request the stub answered, in arrival order. */
  readonly trace: StubTrace[]
  /** Stop the listener. */
  readonly close: () => Promise<void>
}

/**
 * Start a local stub that speaks the pinned provider's Messages SSE protocol.
 * @param mode `text` answers every request with text; `tool` asks for one `web_fetch` call on the
 *   first request that offers the tool and carries no tool results yet, then answers with text.
 * @returns The stub's port and trace once the listener is bound.
 */
async function makeStub(mode: "text" | "tool"): Promise<Stub> {
  // The requests the stub has answered, in arrival order.
  const trace: StubTrace[] = []
  // The listener that answers both the provider's POSTs and any catalog GET.
  const server = createServer((req, res) => {
    // The request body chunks, decoded as UTF-8 below.
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      // The whole request body, which the wire reader parses.
      const body = Buffer.concat(chunks).toString("utf8")
      if (req.method !== "POST") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ object: "list", data: [{ id: "deepseek-chat", object: "model", created: 0, owned_by: "local-stub" }] }))
        return
      }
      // The model request in whichever wire shape the provider used.
      const wire = readWireRequest(body)
      // Whether this request already carries a tool result, i.e. the call has been executed.
      const answeredTool = mode === "tool" && wire.toolNames.includes(TOOL) && wire.toolResults.length === 0
      trace.push({ n: trace.length + 1, toolCount: wire.toolNames.length, offeredFetch: wire.toolNames.includes(TOOL), toolResults: wire.toolResults.length, answered: answeredTool ? "tool_use:" + TOOL : "text" })
      if (answeredTool) writeMessagesSse(res, messagesToolUseEvents("call_stub_" + String(trace.length), TOOL, { url: URL_UNDER_TEST }))
      else writeMessagesSse(res, messagesTextEvents("stub answer #" + String(trace.length)))
    })
  })
  await new Promise<void>((ready, fail) => {
    server.once("error", fail)
    server.listen(0, "127.0.0.1", () => ready())
  })
  // The port the stub actually bound.
  const address = server.address()
  // The numeric port, or 0 when the address shape is unexpected.
  const port = typeof address === "object" && address !== null ? address.port : 0
  return {
    port,
    trace,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

/** One isolated sandbox: its paths, its bundle copy and the copied preset's provenance. */
interface Sandbox {
  /** The temp root every other path lives under. */
  readonly root: string
  /** The sandbox `DSH_HOME`. */
  readonly home: string
  /** The sandbox `HOME`, kept apart so skill roots cannot leak from the real home. */
  readonly userHome: string
  /** The sandbox workspace every session in this sandbox is created in. */
  readonly ws: string
  /** The copied bundle the profile's `node_modules/@mpd-dsh/mpd` resolves to. */
  readonly bundle: string
  /** The `fetch` boolean the copy carries (`true` for the positive arms). */
  readonly fetchConfigured: boolean
  /** sha256 of the tracked preset file. */
  readonly trackedSha: string
  /** sha256 of the copied preset file. */
  readonly copySha: string
  /** Every line the copy and the tracked file disagree on (`""` when identical). */
  readonly diffLines: string
  /** The sandbox child environment. */
  readonly env: Record<string, string | undefined>
}

/**
 * Build one isolated sandbox whose profile links to a COPY of this bundle.
 *
 * The copy is a directory of symlinks for everything except the three entries that decide
 * composition (`package.json`, `cordis.patch.yml`, `presets/mpd.patch.yml`), which are real files:
 * editing them can therefore never reach the tracked tree.
 * @param tag Short label naming the temp directory and the arm.
 * @param fetchValue The `fetch` boolean the copied preset must carry.
 * @param stubKey When set, the child environment exports this throwaway provider key.
 * @returns The sandbox paths plus the copied preset's provenance.
 */
function makeSandbox(tag: string, fetchValue: boolean, stubKey: string | null): Sandbox {
  // The temp sandbox root, fresh so no run can inherit another run's state.
  const root = mkdtempSync(join(tmpdir(), "mpd-toolweb-" + tag + "-"))
  // The sandbox `DSH_HOME` (profile, session store, credentials).
  const home = join(root, "home")
  // The sandbox `HOME`, separate from `home` so `~/.agents/skills` cannot leak in.
  const userHome = join(root, "userhome")
  mkdirSync(userHome, { recursive: true })
  mkdirSync(home, { recursive: true })
  // The sandbox workspace every session must be created in.
  const ws = sandboxWorkspace(root)
  // The copied bundle the profile resolves `@mpd-dsh/mpd` to.
  const bundle = join(root, "bundle")
  mkdirSync(join(bundle, "presets"), { recursive: true })
  cpSync(join(REPO, "package.json"), join(bundle, "package.json"))
  cpSync(join(REPO, "cordis.patch.yml"), join(bundle, "cordis.patch.yml"))
  // The tracked preset's text, which the positive copy flips on exactly one line.
  const trackedText = readFileSync(TRACKED_PRESET, "utf8")
  // The copied preset's text: byte-identical for the negative arm, one boolean flipped for the positive one.
  const copyText = fetchValue ? trackedText.replace(FETCH_LINE, "fetch: true") : trackedText
  if (fetchValue && copyText === trackedText) throw new Error("positive arm: the tracked preset carries no `" + FETCH_LINE + "` to flip")
  writeFileSync(join(bundle, "presets", "mpd.patch.yml"), copyText)
  // Every other root entry, so the copied package's exports resolve to the real sources.
  for (const entry of readdirSync(REPO)) {
    if (NOT_SYMLINKED.has(entry)) continue
    symlinkSync(join(REPO, entry), join(bundle, entry), "junction")
  }
  // The profile directory the web app boots from.
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  symlinkSync(bundle, join(profile, "node_modules", "@mpd-dsh", "mpd"), "junction")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w",
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  // The credential store, copied once into the sandbox (never read from again by this driver).
  seedSandboxCredentials(home, { credentialsFile: join(homedir(), ".dsh", ".credentials.yaml") })
  // The tracked and copied preset bytes, so the arms' provenance is recorded, not asserted.
  const trackedSha = sha256(TRACKED_PRESET)
  // The copy's own hash, read back from disk rather than from the in-memory text.
  const copySha = sha256(join(bundle, "presets", "mpd.patch.yml"))
  // The per-line disagreement between the copy and the tracked file, as one audit string.
  const diffLines = diffText(trackedText, copyText)
  // The child environment: sandbox home + user home, plus the throwaway key when one is needed.
  const env: Record<string, string | undefined> = { ...process.env, DSH_HOME: home, HOME: userHome, DEEPSEEK_API_KEY: stubKey ?? process.env.DEEPSEEK_API_KEY }
  return { root, home, userHome, ws, bundle, fetchConfigured: fetchValue, trackedSha, copySha, diffLines, env }
}

/**
 * The changed lines between two texts, as `- old` / `+ new` entries joined by newlines.
 * @param before The reference text.
 * @param after The candidate text.
 * @returns The audit string; `""` when the texts are equal.
 */
function diffText(before: string, after: string): string {
  // The line arrays of both texts.
  const a = before.split("\n")
  // The candidate's lines, same split.
  const b = after.split("\n")
  if (a.length !== b.length) return "line-count differs: " + String(a.length) + " -> " + String(b.length)
  // The changed lines, as `lineNo: -old | +new`.
  const changed: string[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(String(i + 1) + ": -" + a[i].trim() + " | +" + b[i].trim())
  return changed.join("\n")
}

/** One arm's raw observation, before the verdict is computed. */
interface ArmRun {
  /** The arm label. */
  readonly arm: string
  /** The sandbox the arm ran in. */
  readonly sandbox: Sandbox
  /** The boot log file. */
  readonly bootLog: string
  /** The boot URL line the app printed, redacted (`null` when it never printed one). */
  readonly bootUrl: string | null
  /** The session id the host created, or `null`. */
  readonly sessionId: string | null
  /** The preset the host reported for the session, or `null`. */
  readonly agentPreset: string | null
  /** The `session/create` HTTP status. */
  readonly createStatus: number
  /** The `session/create` body prefix. */
  readonly createRaw: string
  /** The `session/prompt` HTTP status, or `null` when no session existed. */
  readonly promptStatus: number | null
  /** The `session/prompt` body prefix, or `null`. */
  readonly promptRaw: string | null
  /** Whether a `turn/end` record appeared, and after how long. */
  readonly settle: { readonly ended: boolean; readonly waitedMs: number }
  /** The decoded store, or `null` when the boot wrote none. */
  readonly store: SessionStore | null
  /** The tool names each `request/header` offered, in record order. */
  readonly headers: Array<{ readonly index: number; readonly toolCount: number; readonly names: string[] }>
  /** The distinct tool names every header offered, in encounter order. */
  readonly toolNames: string[]
  /** The `web_fetch` call pairing. */
  readonly call: { readonly called: boolean; readonly succeeded: boolean; readonly resultText: string; readonly reason: string }
  /** The stub's own trace (empty for the live arm). */
  readonly stubTrace: StubTrace[]
  /** The session-store project key the store was read from. */
  readonly storeKey: string
  /** Error-ish lines found in the boot log (redacted), so a failure explains itself. */
  readonly errorLines: string[]
}

/**
 * Boot one sandbox, create an `mpd` session in it, prompt once and settle the turn.
 * @param tag The arm label, used for the sandbox and the log file names.
 * @param fetchValue The `fetch` boolean the arm's bundle copy carries.
 * @param mode The model route: a stub that answers text, a stub that asks for the call, or live.
 * @param prompt The task text sent as the session's first user message.
 * @param outDir The evidence directory the raw boot log is written under.
 * @returns The arm's observation.
 */
async function runArm(tag: string, fetchValue: boolean, mode: "text" | "tool" | "live", prompt: string, outDir: string): Promise<ArmRun> {
  // The stub, unless this arm uses the machine's real credentials.
  const stub = mode === "live" ? null : await makeStub(mode === "tool" ? "tool" : "text")
  // The isolated sandbox; the stub arms export a throwaway key so no real credential is used.
  const sandbox = makeSandbox(tag, fetchValue, stub === null ? null : STUB_KEY)
  try {
    // The per-arm raw directory, so each boot keeps its own log.
    mkdirSync(join(outDir, "raw"), { recursive: true })
    // The arm's OWN preset bytes, copied out of the (ephemeral) sandbox so the mutation is inspectable later.
    cpSync(join(sandbox.bundle, "presets", "mpd.patch.yml"), join(outDir, "raw", tag + "-preset.patch.yml"))
    // The file both of the child's output streams are redirected to (a FILE, never a pipe: T-24).
    const bootLog = join(outDir, "raw", tag + ".boot.log")
    // The launcher arguments: the stub arms point the deepseek provider at the local stub.
    const args = ["--profile", "w"]
    if (stub !== null) {
      // The launcher-level overlay that moves the provider's baseURL to the stub.
      const overlay = join(sandbox.root, "model-overlay.yml")
      writeFileSync(overlay, ["- id: llm-deepseek", "  config:", "    baseURL: http://127.0.0.1:" + String(stub.port) + "/v1", "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"))
      args.push("--patch", overlay)
    }
    // The loopback port the sandbox dsh serves on.
    const port = await freePort()
    args.push("--port", String(port), "--no-open")
    // The launcher plus argv, or `null` when no `dsh` resolves.
    const spec = dshCommand(args, sandbox.env)
    if (spec === null) throw new Error(DSH_MISSING)
    // The log file's descriptor, handed to both streams.
    const fd = openSync(bootLog, "w")
    // The real web app child.
    const child: ChildProcess = spawn(spec.command, spec.args, { env: sandbox.env, cwd: sandbox.ws, stdio: ["ignore", fd, fd] })
    /** @returns The boot log's text so far, or `""` when it cannot be read yet. */
    const readLog = (): string => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
    try {
      // The host's launch token, scraped from the app's own URL line.
      let token = ""
      // The session cookie minted by the token exchange.
      let cookie = ""
      // The instant the token wait gives up (a cold dsh boot takes tens of seconds).
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        await sleep(1200)
        // The token the log has printed by now, if any.
        const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
        if (match !== null) token = match[1]
        if (token === "") continue
        try {
          // The token exchange, whose Set-Cookie the RPC calls must carry.
          const auth = await fetch("http://127.0.0.1:" + String(port) + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
          cookie = (auth.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
          // The authorized root request, which proves the cookie is usable.
          const root = await fetch("http://127.0.0.1:" + String(port) + "/", { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
          if (cookie !== "" && root.status === 200) break
        } catch { /* not serving yet */ }
      }
      /**
       * One JSON-RPC call against the sandbox host.
       * @param method The RPC method name.
       * @param payload The RPC payload.
       * @param timeout The request timeout in milliseconds.
       * @returns The HTTP status and the raw body.
       */
      const rpc = async (method: string, payload: unknown, timeout: number = 60_000): Promise<{ status: number; body: string }> => {
        // The host's response to this call.
        const res = await fetch("http://127.0.0.1:" + String(port) + "/api/" + method, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }),
          signal: AbortSignal.timeout(timeout),
        }).catch((error) => ({ status: 0, text: async () => JSON.stringify({ transport: String(error?.cause?.code ?? error?.message ?? error) }) } as Response))
        return { status: res.status, body: await res.text().catch(() => "") }
      }
      // The session the host created, with the mpd preset named explicitly.
      const created = await rpc("session/create", { args: { request: { cwd: sandbox.ws, agentPreset: "mpd" } } })
      // The session id the host reported, or `null` when the call produced none.
      const sessionId: string | null = (() => {
        try {
          // The `result` half of the envelope, which is an object on success.
          const result = (JSON.parse(created.body) as { result?: unknown }).result as Record<string, unknown> | undefined
          if (result === undefined) return null
          // The value object the host nests the session fields under.
          const value = (result.value ?? result) as Record<string, unknown>
          // The reported session id, accepted only when it is a string.
          return typeof value.sessionId === "string" ? value.sessionId : null
        } catch { return null }
      })()
      // The preset the host reported for the session, or `null`.
      const agentPreset: string | null = (() => {
        try {
          // The `result` half of the envelope.
          const result = (JSON.parse(created.body) as { result?: unknown }).result as Record<string, unknown> | undefined
          // The value object carrying `agentPreset`.
          const value = (result?.value ?? result ?? {}) as Record<string, unknown>
          return typeof value.agentPreset === "string" ? value.agentPreset : null
        } catch { return null }
      })()
      // The prompt call, only when a session exists to prompt.
      const prompted = sessionId === null ? null : await rpc("session/prompt", { args: { request: { requestId: randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text: prompt }] } } })
      // The instant the settle wait began, so the arm records how long the turn took.
      const started = Date.now()
      // The store read back so far.
      let store: SessionStore | null = null
      // Whether a `turn/end` record has appeared.
      let ended = false
      // The instant the settle wait gives up.
      const settleDeadline = Date.now() + 240_000
      while (Date.now() < settleDeadline) {
        await sleep(2500)
        try {
          store = readSessionEvents(sandbox.home, { workspace: sandbox.ws })
        } catch { store = null }
        if (store !== null && store.records.some((record) => record.type === "turn/end")) { ended = true; break }
        // A session that never got past its creation header cannot recover by waiting longer.
        if (store !== null && store.records.some((record) => record.type === "session/end" || record.type === "turn/aborted")) { ended = true; break }
      }
      // The final store, re-read after the settle so a late flush is included.
      try { store = readSessionEvents(sandbox.home, { workspace: sandbox.ws }) } catch { /* keep the last reading */ }
      // The tool names the harness offered, from the request headers.
      const toolNames = store === null ? [] : recordedToolNames(store)
      // Every header record's own tool list, in record order.
      const headers = store === null ? [] : store.records.flatMap((record, index) => {
        if (record.type !== "request/header") return []
        // The header object the record carries.
        const header = (record.data as { header?: { tools?: unknown } } | undefined)?.header
        // The tool entries, kept only when the field really is an array.
        const tools = Array.isArray(header?.tools) ? header.tools as Array<{ name?: unknown }> : []
        return [{ index, toolCount: tools.length, names: tools.map((tool) => String(tool.name)) }]
      })
      // The call pairing for `web_fetch`.
      const call = store === null
        ? { called: false, succeeded: false, resultText: "", reason: "no session store" }
        : (() => {
          // The evidence object the library returns for this tool name.
          const found = findToolCall(store, TOOL)
          return { called: found.called, succeeded: found.succeeded, resultText: found.resultText, reason: found.reason }
        })()
      // The decoded records that carry this experiment's evidence, dumped verbatim so the store's
      // own bytes survive the ephemeral sandbox: every request header's tool list, and every tool
      // call/result pair.
      const evidenceRecords = store === null ? [] : store.records.flatMap((record) => {
        if (record.type === "request/header") {
          // The header object this record carries.
          const header = (record.data as { header?: { tools?: unknown } } | undefined)?.header
          // The tool entries, kept only when the field really is an array.
          const tools = Array.isArray(header?.tools) ? header.tools : []
          return [{ type: "request/header", seq: record.seq, toolCount: tools.length, tools }]
        }
        if (record.type === "tool/call" || record.type === "tool/result") return [record]
        return []
      })
      writeFileSync(join(outDir, "raw", tag + "-records.json"), JSON.stringify(evidenceRecords, null, 1))
      // The boot URL line, redacted before it reaches any artifact.
      const bootUrl = redact(/dsh web: http[^\s]*/.exec(readLog())?.[0] ?? "") || null
      // Lines in the boot log that report a failure, so a red arm explains itself.
      const errorLines = readLog().split(/\r?\n/).filter((line) => /error|failed|refus|MISSING_CREDENTIAL|unauthorized/i.test(line)).slice(0, 12).map((line) => redact(line).slice(0, 300))
      return {
        arm: tag,
        sandbox,
        bootLog,
        bootUrl,
        sessionId,
        agentPreset,
        createStatus: created.status,
        createRaw: redact(created.body).slice(0, 600),
        promptStatus: prompted?.status ?? null,
        promptRaw: prompted === null ? null : redact(prompted.body).slice(0, 600),
        settle: { ended, waitedMs: Date.now() - started },
        store,
        headers,
        toolNames,
        call,
        stubTrace: stub?.trace.slice() ?? [],
        storeKey: projectKey(sandbox.ws),
        errorLines,
      }
    } finally {
      // The child is torn down before the stub so no request lands on a closed listener.
      child.kill("SIGTERM")
      await sleep(1500)
      child.kill("SIGKILL")
      await sleep(300)
    }
  } finally {
    await stub?.close()
  }
}

/** The web-related tool names a header offered: the subset this experiment reads. */
function webTools(names: readonly string[]): string[] {
  return names.filter((name) => /^web|fetch|search/i.test(name))
}

/**
 * The evidence-safe view of one arm: paths, observed tool lists, call pairing and verdict.
 * @param run The arm's raw observation.
 * @param expectFetch Whether `web_fetch` must be present for this arm to pass.
 * @returns The serialized arm record.
 */
function armRecord(run: ArmRun, expectFetch: boolean): Record<string, unknown> {
  // Whether the registration assertion held in the direction this arm expects.
  const registered = run.toolNames.includes(TOOL)
  // Whether the arm's evidence is non-vacuous: at least one request header really listed tools.
  const nonVacuous = run.headers.length > 0 && run.toolNames.length > 0
  // Whether the arm passes, arm-specific rules added by the caller through `verdictRules`.
  const ok = nonVacuous && registered === expectFetch
  return {
    ok,
    arm: run.arm,
    presetFetchConfigured: run.sandbox.fetchConfigured,
    trackedPresetSha256: run.sandbox.trackedSha,
    bundlePresetSha256: run.sandbox.copySha,
    bundlePresetDiffFromTracked: run.sandbox.diffLines,
    sandbox: run.sandbox.root,
    dshHome: run.sandbox.home,
    userHome: run.sandbox.userHome,
    workspace: run.sandbox.ws,
    bundleCopy: run.sandbox.bundle,
    sessionStoreKey: run.storeKey,
    bootLog: run.bootLog,
    bootUrl: run.bootUrl,
    sessionId: run.sessionId,
    agentPresetReported: run.agentPreset,
    createStatus: run.createStatus,
    createRaw: run.createRaw,
    promptStatus: run.promptStatus,
    promptRaw: run.promptRaw,
    turnEnded: run.settle.ended,
    settleMs: run.settle.waitedMs,
    store: run.store === null ? null : { file: run.store.file, records: run.store.records.length, frames: run.store.frames, sessions: run.store.sessions, undecodableLines: run.store.undecodableLines },
    requestHeaders: run.headers.length,
    toolCount: run.toolNames.length,
    toolNames: run.toolNames,
    webToolNames: webTools(run.toolNames),
    headers: run.headers,
    webFetchRegistered: registered,
    webFetchCall: { called: run.call.called, succeeded: run.call.succeeded, resultChars: run.call.resultText.length, resultExcerpt: run.call.resultText.slice(0, 600), reason: run.call.reason },
    stubTrace: run.stubTrace,
    bootErrors: run.errorLines,
    bound: expectFetch
      ? (run.call.succeeded ? "" : "registration proven; the fetch was not exercised in this arm")
      : "negative control: the same boot with the unmodified preset",
  }
}

/**
 * The value of one `--name=value` driver argument.
 * @param name The flag name without the leading dashes.
 * @returns The value, or `undefined` when the flag was not passed.
 */
function argValue(name: string): string | undefined {
  // The matching argv entry, if any.
  const hit = process.argv.slice(2).find((entry) => entry.startsWith("--" + name + "="))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}

/**
 * Run the experiment and write its evidence.
 * @returns Nothing; the process exits non-zero when an arm that must pass does not.
 */
async function main(): Promise<void> {
  // The arms this invocation runs; `--arms=` narrows it (used for a machinery smoke run).
  const selected = new Set((argValue("arms") ?? "positive,negative,call-live,call-stub").split(","))
  // The evidence directory: a caller's `--out`, else a fresh timestamped one under the evidence tree.
  const outDir = argValue("out") ?? join(REPO, "evidence", "web-plane", "tool-web-fetch", new Date().toISOString().replace(/[:.]/g, "-"))
  mkdirSync(join(outDir, "raw"), { recursive: true })
  // The resolved launcher, or `null` when no `dsh` is on PATH.
  const launcher = dshCommand(["--version"], process.env)
  // The harness version, printed by the launcher itself.
  const versionRun = launcher === null ? null : spawnSync(launcher.command, launcher.args, { encoding: "utf8" })
  // The version string, or `unknown` when the harness cannot be read.
  const harnessVersion = (versionRun?.stdout ?? "").trim() || "unknown"
  // The tracked preset's sha256 at the moment the experiment starts.
  const trackedSha = sha256(TRACKED_PRESET)
  say("harness=" + harnessVersion + " node=" + process.version)
  say("tracked preset " + TRACKED_PRESET + " sha256=" + trackedSha)
  say("evidence dir " + outDir)

  // The registration arms: identical boots, only the copied preset's boolean differs.
  const positive = selected.has("positive") ? await runArm("positive", true, "text", PROMPT_PLAIN, outDir) : null
  if (positive !== null) say("arm=positive fetchConfigured=true registered=" + String(positive.toolNames.includes(TOOL)) + " toolCount=" + String(positive.toolNames.length) + " headers=" + String(positive.headers.length) + " preset=" + String(positive.agentPreset))
  const negative = selected.has("negative") ? await runArm("negative", false, "text", PROMPT_PLAIN, outDir) : null
  if (negative !== null) say("arm=negative fetchConfigured=false registered=" + String(negative.toolNames.includes(TOOL)) + " toolCount=" + String(negative.toolNames.length) + " headers=" + String(negative.headers.length) + " preset=" + String(negative.agentPreset))

  // The call arm, live first: the real model decides whether to call the tool.
  const live = selected.has("call-live") ? await runArm("call-live", true, "live", PROMPT_FETCH, outDir) : null
  if (live !== null) say("arm=call-live called=" + String(live.call.called) + " succeeded=" + String(live.call.succeeded) + " preset=" + String(live.agentPreset) + " errors=" + String(live.errorLines.length))
  // The scripted fallback, run only when the live model produced no successful call.
  const scripted = live === null || live.call.succeeded || !selected.has("call-stub") ? null : await runArm("call-stub", true, "tool", PROMPT_FETCH, outDir)
  if (scripted !== null) say("arm=call-stub called=" + String(scripted.call.called) + " succeeded=" + String(scripted.call.succeeded))

  // The arm records, with the negative control's own falsifiability rule folded into its verdict.
  const positiveRecord: Record<string, unknown> = positive === null ? { ok: null, skipped: true } : armRecord(positive, true)
  const negativeRecord: Record<string, unknown> = negative === null ? { ok: null, skipped: true } : armRecord(negative, false)
  // The negative arm additionally fails when the SAME boot's web stack is entirely dead (a vacuous control).
  if (negative !== null) negativeRecord.ok = negativeRecord.ok === true && webTools(negative.toolNames).length > 0
  // The call arm: live when the real model called the tool, else the scripted fallback, else a declared failure.
  const callRun = live !== null && live.call.succeeded ? live : scripted
  // Whether the call evidence came from the real model or from a scripted tool_use.
  const callMode = live !== null && live.call.succeeded ? "live-model" : scripted?.call.succeeded === true ? "stub-scripted-tool_use" : "none"
  const callRecord: Record<string, unknown> = callRun === null ? { ok: null, skipped: live === null, bound: live === null ? "the call arms did not run in this invocation" : "no call was produced by any route" } : {
    ok: callRun.call.called && callRun.call.succeeded,
    mode: callMode,
    arm: callRun.arm,
    sessionId: callRun.sessionId,
    agentPresetReported: callRun.agentPreset,
    sandbox: callRun.sandbox.root,
    bootLog: callRun.bootLog,
    toolNames: callRun.toolNames,
    webFetchRegistered: callRun.toolNames.includes(TOOL),
    webFetchCall: { called: callRun.call.called, succeeded: callRun.call.succeeded, resultChars: callRun.call.resultText.length, resultExcerpt: callRun.call.resultText.slice(0, 1200), reason: callRun.call.reason },
    stubTrace: callRun.stubTrace,
    bootErrors: callRun.errorLines,
    bound: callMode === "live-model"
      ? "the model chose the call itself; the fetch result is the harness's own network outcome"
      : callMode === "stub-scripted-tool_use"
        ? "the tool_use frame was SCRIPTED by a local stub (the real model did not emit one); the tool execution, the HTTP fetch and the tool/result are the harness's own"
        : "no successful call evidence",
  }

  // The isolation assertions: the session store must be keyed by the sandbox workspace, per arm.
  const isolation = [positive, negative, live, scripted].flatMap((run) => run === null ? [] : [run]).map((run) => ({
    arm: run.arm,
    dshHome: run.sandbox.home,
    sandboxRoot: run.sandbox.root,
    workspace: run.sandbox.ws,
    storeKey: run.storeKey,
    storeKeyIsSandbox: run.storeKey === projectKey(run.sandbox.ws),
    storeUnderSandboxHome: run.store?.file === null || run.store?.file.startsWith(run.sandbox.home) === true,
  }))

  // The whole record, serialized as the run's `result.json`.
  const result = {
    experiment: "tool-web fetch:true on an mpd-preset session -> registered and working web_fetch",
    startedAt: new Date().toISOString(),
    harness: { version: harnessVersion, launcher: launcher?.command ?? null },
    node: process.version,
    repo: {
      root: REPO,
      head: (spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout ?? "").trim() || null,
      trackedPreset: { path: "presets/mpd.patch.yml", sha256: trackedSha, fetchValue: false },
      trackedPresetClean: (spawnSync("git", ["status", "--porcelain", "presets/", "cordis.patch.yml"], { cwd: REPO, encoding: "utf8" }).stdout ?? "").trim() === "",
    },
    profile: "a hand-built web profile (dsh-base + dsh-web-app + @mpd-dsh/mpd) inside a temp DSH_HOME, mirroring skills/dsh-qa/scripts/preset-conformance.ts; the TUI profile was NOT booted (it needs a terminal)",
    isolation,
    arms: { positive: positiveRecord, negative: negativeRecord, realCall: callRecord },
    verdict: {
      positive: positiveRecord.ok === null ? "SKIP" : positiveRecord.ok === true ? "PASS" : "FAIL",
      negative: negativeRecord.ok === null ? "SKIP" : negativeRecord.ok === true ? "PASS" : "FAIL",
      realCall: callRecord.ok === null ? "SKIP" : callRecord.ok === true ? "PASS" : "FAIL",
      claim: "tool-web with fetch:true registers web_fetch on an mpd-preset session",
    },
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2))
  writeFileSync(join(outDir, "output.log"), CAPTURED.join("\n") + "\n")
  say("verdict positive=" + result.verdict.positive + " negative=" + result.verdict.negative + " realCall=" + result.verdict.realCall + " (" + callMode + ")")
  say("wrote " + join(outDir, "result.json"))
  writeFileSync(join(outDir, "output.log"), CAPTURED.join("\n") + "\n")
  // The exit code answers the REGISTRATION question (positive + its negative control); the call arm
  // is reported on its own, because a model that declines to call the tool cannot redden the claim.
  if (result.verdict.positive === "FAIL" || result.verdict.negative === "FAIL") process.exitCode = 1
}

await main()
