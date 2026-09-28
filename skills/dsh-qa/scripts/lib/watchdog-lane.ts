#!/usr/bin/env node
// Shared plumbing for the team-watchdog lanes (w9). Every lane in this family:
//   * drives REAL modules or reads REAL artifacts — never a source string as evidence;
//   * writes its evidence under evidence/team-watchdog/lanes/<timestamp>/;
//   * ships a `--self-test` whose NEGATIVE controls prove each assertion is falsifiable
//     (a mutated observation must make the lane's own evaluator FAIL).
//
// Nothing here touches packages/**: the lanes only READ the built artifacts, mount the real
// watchdog dist on a stub context and read the store back with plain fs.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// .../skills/dsh-qa/scripts/lib/watchdog-lane.ts -> this module's own directory.
const HERE = dirname(fileURLToPath(import.meta.url))
/** Repo root, resolved from this file (lib -> scripts -> dsh-qa -> skills -> repo). */
export const REPO: string = resolve(HERE, "..", "..", "..", "..")
/** Every lane's evidence lives here; each run gets its OWN timestamp directory. */
export const LANES_DIR: string = join(REPO, "evidence", "team-watchdog", "lanes")

/** The absolute paths every watchdog lane reads, so no lane hand-rolls a path. */
export interface WatchdogLanePaths {
  /** The built adapter dist, whose `createDshAdapter` the mount serves as `mpdDsh`. */
  readonly adapterDist: string
  /** The built watchdog dist this family really mounts. */
  readonly watchdogDist: string
  /** The watchdog plugin source, whose freshness some lanes assert. */
  readonly watchdogSrc: string
  /** The verified fault fixture the fault lane drives. */
  readonly fixture: string
  /** The built TUI plugin dist. */
  readonly tuiDist: string
  /** The TUI plugin's watchdog source. */
  readonly tuiWatchdog: string
  /** The combined web client bundle whose built bytes the notify lane reads. */
  readonly webClient: string
  /** The bundle plugin's watchdog web-route source. */
  readonly webRoute: string
  /** The config plugin's settings schema source. */
  readonly settingsSchema: string
  /** The offline web client harness the notify lane drives the built bytes through. */
  readonly webHarness: string
}

/** The paths every lane reads. */
export const PATHS: WatchdogLanePaths = {
  adapterDist: join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"),
  watchdogDist: join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js"),
  watchdogSrc: join(REPO, "packages", "mpd-team-watchdog-plugin", "src", "index.ts"),
  fixture: join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.ts"),
  tuiDist: join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js"),
  tuiWatchdog: join(REPO, "packages", "mpd-tui-plugin", "src", "watchdog.ts"),
  webClient: join(REPO, "packages", "mpd-bundle-plugin", "client.js"),
  webRoute: join(REPO, "packages", "mpd-bundle-plugin", "src", "watchdog-web.ts"),
  settingsSchema: join(REPO, "packages", "mpd-config-plugin", "src", "settings-schema.ts"),
  webHarness: join(REPO, "packages", "mpd-bundle-plugin", "test", "client-harness.ts"),
}
/** The adopted team state dir (the watchdog row's default too). */
export const STATE_DIR: string = join(".mpd", "team")

/** One file's fingerprint inside a hashed tree. */
export interface HashedFile {
  /** Lowercase hex sha256 of the file's bytes. */
  readonly sha256: string
  /** The file's length in bytes. */
  readonly bytes: number
}

/** One incident record parsed from the store, or a malformed-line count. */
export interface IncidentRead {
  /** Every successfully parsed incident line, in file order. */
  readonly records: unknown[]
  /** How many non-empty lines failed to parse, counted rather than guessed. */
  readonly malformed: number
}

/** The watchdog store's paths for one sandbox workspace. */
export interface WatchdogStorePaths {
  /** The store's own root (`<ws>/.mpd/team/watchdog`). */
  readonly root: string
  /**
   * @param teamId The team whose hold record is wanted.
   * @returns Absolute path of that team's hold file.
   */
  hold(teamId: string): string
  /** The directory holding every hold file. */
  readonly holdDir: string
  /** The append-only incident log. */
  readonly incidents: string
  /** The per-reader acknowledge watermark document. */
  readonly watermark: string
  /**
   * @param teamId The team whose scene directory is wanted.
   * @returns Absolute path of that team's scene directory.
   */
  scene(teamId: string): string
  /**
   * @param teamId The team whose latest-scene pointer is wanted.
   * @returns Absolute path of that team's `latest.json` pointer.
   */
  scenePointer(teamId: string): string
  /**
   * @param memberKey The member whose heartbeat log is wanted.
   * @returns Absolute path of that member's heartbeat JSONL.
   */
  heartbeat(memberKey: string): string
}

/** A tool definition as the stub registry stores it: only `name` is read back. */
export interface StubToolDefinition {
  /** The tool name the mounted plugin registered. */
  readonly name: string
  /** Every other field the registration carried, kept untyped on purpose. */
  readonly [extra: string]: unknown
}

/** A live-agent double in the shape the harness registry hands the adapter. */
export interface LiveAgentDouble {
  /** The agent id (`agentIds()` reads the agent id from here). */
  readonly id: string
  /** The agent's run status. */
  readonly status: string
  /** The session the agent belongs to; `session.id` is what captain recognition compares. */
  readonly session: { readonly id: string; readonly header: { readonly cwd: string } }
  /** The cancellation hook the harness exposes on a live agent. */
  cancel(): void
  /** Any further field a lane's double carries. */
  readonly [extra: string]: unknown
}

/** A stub event handler: the mounted modules' listeners, captured verbatim. */
export type StubEventHandler = (...args: unknown[]) => unknown

/** The stub cordis context: the ONLY simulated layer in this family. */
export interface StubCtx {
  /**
   * @param id The service id to resolve.
   * @param strict When `true`, a missing service throws the way the real context does.
   * @returns The service, or `undefined` when it is not provided.
   */
  get(id: string, strict?: boolean): unknown
  /**
   * @param id The service id to provide.
   * @param value The service instance.
   */
  provide(id: string, value: unknown): void
  /**
   * @param event The harness event name.
   * @param handler The listener to capture.
   * @returns The disposer that removes the captured listener.
   */
  on(event: string, handler: StubEventHandler): () => void
  /**
   * @param fn The effect body, run immediately.
   * @returns The disposer the body returned, or a no-op.
   */
  effect(fn: () => unknown): () => void
  /**
   * @param deps The service ids the callback waits for.
   * @param cb The callback, run immediately when every dependency is already provided.
   * @returns A no-op disposer.
   */
  inject(deps: readonly string[], cb: (ctx: StubCtx) => void): () => void
  /** The stub logger, whose warn/info lines the stub records for a lane to assert. */
  logger: {
    /** Record one warn line. */
    warn(...args: unknown[]): void
    /** Record one info line. */
    info(...args: unknown[]): void
    /** Swallow one error line. */
    error(...args: unknown[]): void
    /** Swallow one debug line. */
    debug(...args: unknown[]): void
  }
  /** The stub agent registry, backed by the lane's live-agent doubles. */
  agents: {
    /**
     * @param id The agent id to look up.
     * @returns The matching double, or `undefined`.
     */
    get(id: string): LiveAgentDouble | undefined
    /** @returns A copy of every registered double. */
    list(): LiveAgentDouble[]
  }
  /** The stub tool registry, which records every registration by name. */
  tools: {
    /**
     * @param definition The tool definition the mounted plugin registers.
     * @returns The disposer that removes the registration.
     */
    register(definition: StubToolDefinition): () => void
    /**
     * @param name The tool name to look up.
     * @returns The registered definition, or `undefined`.
     */
    get(name: string): StubToolDefinition | undefined
    /**
     * @param name The tool name to test.
     * @returns Whether a definition with that name is registered.
     */
    has(name: string): boolean
  }
  /** The stub subagent seam, whose prompt settles immediately. */
  subagents: {
    /** @returns A settled prompt receipt. */
    prompt(): Promise<{ messageId: string }>
  }
  /** The stub LLM seam, which echoes its request and lists no models. */
  llm: {
    /**
     * @param request The call config the mounted module asked for.
     * @returns The request, echoed unchanged.
     */
    resolveCallConfig(request: unknown): Promise<unknown>
    /** @returns An empty model list. */
    listModels(): Promise<unknown[]>
  }
  /** The stub system-prompt seam, which records nothing. */
  systemPrompt: {
    /** Accept and ignore one prompt section registration. */
    section(): void
  }
}

/** The knobs `stubCtx` accepts. */
export interface StubCtxOptions {
  /** Workspace root the mounted modules resolve their state from. */
  readonly workspace?: string
  /** The live-agent doubles the stub registry starts with. */
  readonly agents?: readonly LiveAgentDouble[]
  /** The initial `mpd` settings namespace document. */
  readonly namespace?: unknown
  /** The host's base settings document, echoed by `describe()`. */
  readonly base?: unknown
}

/** The stub harness a lane drives: the context plus the levers that fire captured events. */
export interface StubHarness {
  /** The stub cordis context handed to `apply`. */
  readonly ctx: StubCtx
  /** Every service the stub provides, by id. */
  readonly services: Map<string, unknown>
  /** Every event name that was subscribed to, in subscription order. */
  readonly events: string[]
  /** Every warn/info line the mounted modules logged. */
  readonly warnings: string[]
  /** Every tool definition the mounted modules registered, by name. */
  readonly registered: Map<string, StubToolDefinition>
  /**
   * Fire a captured event the way the host would — the live levers of every lane.
   * @param event The event name to fire.
   * @param args The arguments the host would pass.
   * @returns How many listeners were invoked.
   */
  fire(event: string, ...args: unknown[]): Promise<number>
  /**
   * @param value The new `mpd` namespace document.
   * @param revision The revision to stamp, or the previous one plus one.
   */
  setNamespace(value: unknown, revision?: number): void
  /** @returns The current `mpd` namespace document. */
  namespace(): unknown
  /**
   * @param list The doubles that replace every currently registered agent.
   */
  setAgents(list: readonly LiveAgentDouble[]): void
}

/** The built adapter dist's entry surface, as this lane consumes it. */
export type CreateDshAdapter = (ctx: unknown) => unknown

/** The built watchdog dist's entry surface, as this lane mounts it. */
export interface WatchdogModule {
  /**
   * @param ctx The context the row mounts on.
   * @param config The row config.
   * @returns Whatever the row's `apply` returns (a disposer or report).
   */
  apply(ctx: unknown, config: unknown): unknown
}

/** The knobs `mountRealWatchdog` accepts. */
export interface MountWatchdogOptions extends StubCtxOptions {
  /** The row config the built plugin is applied with. */
  readonly config?: unknown
}

/** What a real-dist mount returns: the harness levers plus the mounted artifacts. */
export interface MountedWatchdog extends StubHarness {
  /** The built watchdog module that was mounted. */
  readonly mod: WatchdogModule
  /** Whatever the row's `apply` returned. */
  readonly report: unknown
  /** The REAL adapter instance served as `mpdDsh`. */
  readonly adapter: unknown
}

/** One assertion a lane's evaluator reports. */
export interface LaneCheck {
  /** Stable check id, used to name a failing check and to build negative controls. */
  readonly id: string
  /** Whether the assertion held. */
  readonly ok: boolean
  /** Human-readable detail, printed beside the verdict. */
  readonly detail?: string
}

/** The verdict a lane's evaluator returns. */
export interface LaneVerdict {
  /** Whether every check passed. */
  readonly ok: boolean
  /** Every assertion the evaluator ran. */
  readonly checks: LaneCheck[]
}

/** The minimum every lane's result carries; each lane adds its own domain fields. */
export interface LaneResult {
  /** Whether every check passed. */
  readonly ok: boolean
  /** Every assertion the lane evaluated. */
  readonly checks: LaneCheck[]
  /** Items the lane explicitly does NOT claim, reprinted in the verdict. */
  readonly notClaimed?: readonly string[]
  /** The evidence file the lane wrote, when it wrote one. */
  readonly evidenceFile?: string
  /** Lane-specific evidence fields. */
  readonly [extra: string]: unknown
}

/** One negative control: an id, a mutation of the healthy observation, and why it must redden. */
export type LaneMutation<T> = readonly [id: string, mutate: (copy: T) => void, why: string]

/** What `captureStdout` returns: the captured lines and the restore hook. */
export interface StdoutCapture {
  /** Every line `console.log` received while the capture was installed. */
  readonly lines: string[]
  /** Put the original `console.log` back. */
  restore(): void
}

/** One fresh-process read: the child's identity plus every path's bytes. */
export interface FreshProcessRead {
  /** The child process id, which proves the read came from a different process. */
  readonly pid: number
  /** The child's node version string. */
  readonly node: string
  /** The requested paths mapped to their text, or `null` when a path did not exist. */
  readonly reads: Record<string, string | null>
}

/** The adopted plugin's team record, as the lanes write it. */
export interface TeamRecord {
  /** The team id, which names the record's directory. */
  readonly id: string
  /** Any further field the adopted plugin's record carries. */
  readonly [extra: string]: unknown
}

/**
 * One line to stdout, prefixed so a reader can grep a lane's run.
 * @param prefix The lane slug.
 * @param text The line body.
 */
export function say(prefix: string, text: string): void {
  console.log("[" + prefix + "] " + text)
}

/**
 * A fresh evidence directory: `--out <dir>`, else evidence/team-watchdog/lanes/<utc-stamp>/.
 * @param argv The process argv to scan for `--out`.
 * @param slug Optional slug appended to the timestamped default.
 * @returns Absolute path of the evidence directory (not created here).
 */
export function evidenceDir(argv: readonly string[], slug?: string): string {
  // The position of the `--out` flag, or -1 when the caller named no target.
  const at = argv.indexOf("--out")
  if (at >= 0 && typeof argv[at + 1] === "string" && argv[at + 1] !== "") return resolve(argv[at + 1])
  // The filesystem-safe UTC stamp every default directory is named after.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  return join(LANES_DIR, stamp + (slug === undefined ? "" : "-" + slug))
}

/**
 * @param text The text to hash, or the bytes to hash.
 * @returns The lowercase hex sha256 digest.
 */
export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(typeof text === "string" ? Buffer.from(text, "utf8") : text).digest("hex")
}

/**
 * @param path Absolute path of the file to read.
 * @returns The file's UTF-8 text.
 */
export function read(path: string): string {
  return readFileSync(path, "utf8")
}

/**
 * @param path Absolute path of the JSON document to read.
 * @returns The parsed value, or `undefined` when the file is absent or malformed.
 */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(read(path))
  } catch {
    return undefined
  }
}

/**
 * A sandbox workspace inside the evidence directory (never the repo's own `.mpd`).
 * @param dir The lane's evidence directory.
 * @param tag The arm tag, which names the sandbox.
 * @returns Absolute path of the sandbox workspace.
 */
export function sandboxWorkspace(dir: string, tag: string): string {
  // The sandbox workspace root this arm's dsh boots resolve their state from.
  const ws = join(dir, "raw", "sandbox", tag, "ws")
  mkdirSync(join(ws, STATE_DIR, "watchdog"), { recursive: true })
  return ws
}

/**
 * The watchdog store's paths for one workspace.
 * @param ws Absolute path of the sandbox workspace.
 * @returns Every store path the lanes read or write.
 */
export function storePaths(ws: string): WatchdogStorePaths {
  // The watchdog store's own root inside the workspace.
  const root = join(ws, STATE_DIR, "watchdog")
  return {
    root,
    hold: (teamId) => join(root, "hold", teamId + ".json"),
    holdDir: join(root, "hold"),
    incidents: join(root, "incidents.jsonl"),
    watermark: join(root, "read-watermark.json"),
    scene: (teamId) => join(root, "scene", teamId),
    scenePointer: (teamId) => join(root, "scene", teamId, "latest.json"),
    heartbeat: (memberKey) => join(root, "heartbeat", memberKey + ".jsonl"),
  }
}

/**
 * Every incident line, parsed; malformed lines are counted, never guessed.
 * @param ws Absolute path of the sandbox workspace.
 * @returns The parsed records plus the malformed-line count.
 */
export function readIncidents(ws: string): IncidentRead {
  // The append-only incident log's path.
  const path = storePaths(ws).incidents
  if (!existsSync(path)) return { records: [], malformed: 0 }
  // How many non-empty lines failed to parse.
  let malformed = 0
  // Every successfully parsed incident record.
  const records: unknown[] = []
  for (const line of read(path).split("\n")) {
    if (line.trim() === "") continue
    try {
      records.push(JSON.parse(line))
    } catch {
      malformed += 1
    }
  }
  return { records, malformed }
}

/**
 * @param ws Absolute path of the sandbox workspace.
 * @returns The acknowledge watermark document; `{}` when it is absent or malformed.
 */
export function readWatermarks(ws: string): Record<string, unknown> {
  // The parsed watermark document, or `undefined` when it is absent or malformed.
  const value = readJson(storePaths(ws).watermark)
  // The store's own watermark map; a non-object value would mean a corrupt store, so the
  // document's declared shape is asserted rather than re-validated on every read.
  return value === undefined ? {} : value as Record<string, unknown>
}

/**
 * @param ws Absolute path of the sandbox workspace.
 * @returns Every parsed hold record, sorted by file name; empty when the store has none.
 */
export function readHolds(ws: string): unknown[] {
  // The directory holding every hold file.
  const dir = storePaths(ws).holdDir
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(join(dir, name))).filter(Boolean)
}

/**
 * EVERY file under a directory, as repo/relative-ish keys with sha256 + bytes (the raw store).
 * @param dir Absolute path of the directory to hash.
 * @returns One entry per regular file, keyed by its path relative to `dir`.
 */
export function hashTree(dir: string): Record<string, HashedFile> {
  // The fingerprint map, keyed by the file's path relative to `dir`.
  const out: Record<string, HashedFile> = {}
  /**
   * @param current Absolute path of the directory being walked.
   * @param prefix The relative key prefix accumulated so far.
   */
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // Absolute path of this directory entry.
      const path = join(current, entry.name)
      // The entry's key relative to the hashed root.
      const key = prefix === "" ? entry.name : prefix + "/" + entry.name
      if (entry.isDirectory()) walk(path, key)
      else {
        // The file's raw bytes, hashed and measured.
        const bytes = readFileSync(path)
        out[key] = { sha256: sha256(bytes), bytes: bytes.length }
      }
    }
  }
  if (existsSync(dir)) walk(dir, "")
  return out
}

/**
 * Read a set of files from a FRESH process: a plain-`node` child prints JSON, so the lane's
 * own module state (caches, mounts, clocks) cannot make the read succeed. This is the
 * "plain fs from a fresh process" witness the scene lane is required to use.
 * @param paths Absolute paths the child must read.
 * @returns The child's identity plus each path's text (or `null`).
 * @throws When the child exits non-zero.
 */
export function freshProcessRead(paths: readonly string[]): FreshProcessRead {
  // The child's CommonJS program: read each path and print one JSON envelope.
  const script = [
    'const { readFileSync, existsSync } = require("node:fs");',
    "const paths = JSON.parse(process.argv[1]);",
    "const out = {};",
    "for (const p of paths) out[p] = existsSync(p) ? readFileSync(p, 'utf8') : null;",
    "process.stdout.write(JSON.stringify({ pid: process.pid, node: process.version, reads: out }));",
  ].join("\n")
  // The child process, whose stdout is the whole envelope.
  const child = spawnSync(process.execPath, ["-e", script, JSON.stringify(paths)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (child.status !== 0) throw new Error("fresh-process read failed: " + String(child.stderr || child.status))
  // The child's envelope. The child is this module's own program, so its declared shape is
  // asserted here rather than re-validated field by field.
  return JSON.parse(child.stdout) as FreshProcessRead
}

// ─────────────────────────── mounting the REAL watchdog dist ───────────────────────────
/**
 * A stub cordis context: the ONLY simulated layer. The watchdog row, its engine, machine,
 * store, scene writer and hold registry are the REAL modules (its built dist), mounted here
 * exactly the way the plugin expects (`apply(ctx, config)`), with the adapter double served
 * through the documented `mpdDsh` service id.
 * @param options The stub's knobs: workspace, agent doubles, settings namespace and base.
 * @returns The harness object, with the levers a lane fires captured events through.
 */
export function stubCtx(options: StubCtxOptions = {}): StubHarness {
  // The workspace root the mounted modules resolve their state from.
  const workspace = options.workspace
  // Every service the stub provides, by id.
  const services = new Map<string, unknown>()
  // Every listener the mounted modules registered, by event name.
  const listeners = new Map<string, StubEventHandler[]>()
  // Every event name that was subscribed to, in subscription order.
  const events: string[] = []
  // Every tool definition the mounted modules registered, by name.
  const registered = new Map<string, StubToolDefinition>()
  // Every warn/info line the mounted modules logged.
  const warnings: string[] = []
  // The live-agent doubles the stub registry answers with.
  const liveAgents: LiveAgentDouble[] = [...(options.agents ?? [])]
  // The `mpd` settings namespace document plus its revision, as the adapter's reader sees it.
  const settingsState: { value: unknown; revision: number } = { value: options.namespace ?? {}, revision: 1 }
  // The host's settings document, as the adapter's `settingsReader` reads it.
  services.set("settings", {
    get: (ns: string) => (ns === "mpd" ? settingsState.value : undefined),
    describe: () => [{ ns: "mpd", value: settingsState.value, revision: settingsState.revision, user: settingsState.value, base: options.base }],
  })
  // The stub context itself; every mounted module receives exactly this object.
  const ctx: StubCtx = {
    get: (id, strict) => {
      // The provided service, or `undefined` when nothing provides that id.
      const value = services.get(id)
      if (value === undefined && strict === true) throw new Error("no service " + id)
      return value
    },
    provide: (id, value) => services.set(id, value),
    on: (event, handler) => {
      // The listener list for this event, created on first subscription.
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      events.push(event)
      return () => {
        // The listener list as it stands when the disposer runs.
        const current = listeners.get(event) ?? []
        listeners.set(event, current.filter((entry) => entry !== handler))
      }
    },
    effect: (fn) => {
      // The disposer the effect body returned, if it returned one.
      const disposer = typeof fn === "function" ? fn() : undefined
      // A callable disposer is returned VERBATIM (the same function object the body produced).
      // The `typeof` test narrows a disposer to `Function`, and the host's contract is a
      // zero-argument call, so the value is asserted to that signature rather than re-validated.
      return typeof disposer === "function" ? disposer as () => void : () => {}
    },
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps.every((dep) => services.has(dep))) cb(ctx)
      return () => {}
    },
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(" ")),
      info: (...args) => warnings.push(args.map(String).join(" ")),
      error: () => {},
      debug: () => {},
    },
    agents: {
      get: (id) => liveAgents.find((entry) => entry.id === id),
      list: () => [...liveAgents],
    },
    tools: {
      register: (definition) => {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
      get: (name) => registered.get(name),
      has: (name) => registered.has(name),
    },
    subagents: { prompt: async () => ({ messageId: "stub" }) },
    llm: { resolveCallConfig: async (request) => request, listModels: async () => [] },
    systemPrompt: { section: () => {} },
  }
  return {
    ctx, services, events, warnings, registered,
    /** Fire a captured event the way the host would — the live levers of every lane. */
    fire: async (event, ...args) => {
      // The listeners captured for that event, copied so a listener that unsubscribes is safe.
      const list = listeners.get(event) ?? []
      for (const handler of [...list]) await handler(...args)
      return list.length
    },
    /** Replace the settings namespace document, bumping the revision unless one is named. */
    setNamespace: (value, revision) => {
      settingsState.value = value
      settingsState.revision = typeof revision === "number" ? revision : settingsState.revision + 1
    },
    /** @returns The current settings namespace document. */
    namespace: () => settingsState.value,
    /** Replace every registered agent double. */
    setAgents: (list) => {
      liveAgents.length = 0
      liveAgents.push(...list)
    },
  }
}

/**
 * Mount the REAL watchdog dist on a stub context, with the REAL adapter (createDshAdapter)
 * served through the documented `mpdDsh` service id — so the seams the row uses (event
 * subscription, the POST tool hook, the settings reader and its document-updated listener,
 * tool registration) are the production ones, over a stub harness.
 * @param options The stub knobs plus the row config the plugin is applied with.
 * @returns The mounted module, the apply report, the adapter and every harness lever.
 */
export async function mountRealWatchdog(options: MountWatchdogOptions): Promise<MountedWatchdog> {
  // The stub harness the built modules are mounted over.
  const harness = stubCtx(options)
  // The built adapter dist, loaded by absolute URL — a runtime path TS cannot resolve, so the
  // module's declared entry surface is asserted here instead of being resolved statically.
  const adapterModule = await import(pathToFileURL(PATHS.adapterDist).href) as { createDshAdapter: CreateDshAdapter }
  // The adapter factory the built dist exports.
  const { createDshAdapter } = adapterModule
  // The REAL adapter instance, built over the stub context.
  const adapter = createDshAdapter(harness.ctx)
  harness.ctx.provide("mpdDsh", adapter)
  // The built watchdog plugin, loaded by absolute URL for the same reason as the adapter.
  const mod = await import(pathToFileURL(PATHS.watchdogDist).href) as WatchdogModule
  // Whatever the row's `apply` returned.
  const report = mod.apply(harness.ctx, options.config ?? {})
  return { mod, report, adapter, ...harness }
}

/**
 * Write the adopted plugin's team record the way its own state.js would (the lane's INPUT).
 * @param ws Absolute path of the sandbox workspace.
 * @param team The team record to write.
 * @returns Absolute path of the record that was written.
 */
export function writeTeamRecord(ws: string, team: TeamRecord): string {
  // The team's own state directory inside the workspace.
  const dir = join(ws, STATE_DIR, team.id)
  mkdirSync(dir, { recursive: true })
  // The record file the watchdog reads.
  const path = join(dir, "team.json")
  writeFileSync(path, JSON.stringify(team, null, 2) + "\n", "utf8")
  return path
}

/**
 * A live-agent double in the shape the harness registry hands the adapter.
 * @param id The agent id.
 * @param workspace The session workspace the agent's header carries.
 * @param extras Further fields; a `sessionId` string overrides the session id.
 * @returns The agent double.
 */
export function liveAgent(id: string, workspace: string, extras: Record<string, unknown> = {}): LiveAgentDouble {
  // `agentIds()` reads the SESSION id from `session.id` and the agent id from `id` (measured):
  // a captain is recognised by `team.captainSessionId === session.id`, so the session id must
  // be carried explicitly or the stamp falls back to a session-derived key.
  const { sessionId, ...rest } = extras
  return { id, status: "idle", session: { id: typeof sessionId === "string" ? sessionId : id, header: { cwd: workspace } }, cancel: () => {}, ...rest }
}

// ─────────────────────────────── lane scaffolding ───────────────────────────────
/**
 * The shape every lane's `--self-test` uses: evaluate a healthy synthetic observation
 * (must PASS), then evaluate mutated copies (each must FAIL). A lane whose evaluator cannot
 * fail is not evidence, so this is mandatory, not decorative.
 * @param name The lane slug printed in the verdict.
 * @param evaluate The lane's own evaluator, driven by the healthy observation and its mutations.
 * @param healthy The synthetic healthy observation the evaluator must accept.
 * @param mutations One negative control per assertion family; each MUST redden the evaluator.
 */
export function selfTest<T>(name: string, evaluate: (observation: T) => LaneVerdict, healthy: T, mutations: ReadonlyArray<LaneMutation<T>>): never {
  // One record per control that ran, printed in order below.
  const checks: LaneCheck[] = []
  // The evaluator's verdict on the unmutated observation.
  const good = evaluate(healthy)
  if (!good.ok) {
    checks.push({ id: "healthy-observation", ok: false, detail: "the healthy observation did not pass: " + JSON.stringify(good.checks.filter((entry) => !entry.ok)) })
  } else {
    checks.push({ id: "healthy-observation", ok: true, detail: good.checks.length + " checks passed on the healthy observation" })
  }
  for (const [id, mutate, why] of mutations) {
    // A deep copy of the healthy observation, so a mutation can never leak into the next control.
    const copy: T = JSON.parse(JSON.stringify(healthy)) as T
    mutate(copy)
    // The evaluator's verdict on the mutated copy, which must be a failure.
    const result = evaluate(copy)
    // The ids of the checks the mutation reddened.
    const failedIds = result.checks.filter((entry) => !entry.ok).map((entry) => entry.id)
    // Whether the mutation really reddened at least one check.
    const ok = result.ok === false && failedIds.length > 0
    checks.push({
      id: "negative:" + id,
      ok,
      detail: ok ? "the mutated observation FAILED its own check(s) " + JSON.stringify(failedIds) + " — " + why : "the mutation " + id + " did NOT fail any check (" + why + ")",
    })
  }
  // Whether every control passed, which is the lane's whole verdict.
  const ok = checks.every((entry) => entry.ok)
  for (const entry of checks) console.log("[self-test] " + (entry.ok ? "ok  " : "FAIL") + " " + entry.id + ": " + entry.detail)
  console.log("[self-test] " + (ok ? "PASS" : "FAIL") + " — " + name + " (" + checks.length + " checks, " + checks.filter((entry) => !entry.ok).length + " failed)")
  process.exit(ok ? 0 : 1)
}

/**
 * Write result.json + output.log for one lane run.
 * @param dir The lane's evidence directory.
 * @param result The lane's result object, extended with the evidence path and finish instant.
 * @param stdoutLines Every line the run printed.
 * @returns Absolute path of the `result.json` that was written.
 */
export function writeEvidence<R extends LaneResult>(dir: string, result: R, stdoutLines: readonly string[]): string {
  mkdirSync(dir, { recursive: true })
  // The persisted result: the lane's own fields plus where and when it finished.
  const payload = { ...result, evidenceDir: dir, finishedAt: new Date().toISOString() }
  writeFileSync(join(dir, "result.json"), JSON.stringify(payload, null, 2) + "\n", "utf8")
  writeFileSync(join(dir, "output.log"), stdoutLines.join("\n") + "\n", "utf8")
  return join(dir, "result.json")
}

/**
 * Capture stdout while a lane runs, so the same lines land in output.log.
 * @returns The captured line array plus the restore hook.
 */
export function captureStdout(): StdoutCapture {
  // Every line `console.log` receives while the capture is installed.
  const lines: string[] = []
  // The original `console.log`, restored by the returned hook.
  const original = console.log
  console.log = (...args: unknown[]) => {
    // The single captured line, joined the way the lane's readers expect.
    const text = args.map(String).join(" ")
    lines.push(text)
    original(text)
  }
  return { lines, restore: () => { console.log = original } }
}

/**
 * Print the verdict and exit with the lane's status.
 * @param slug The lane slug, printed as the line prefix.
 * @param result The lane's result object.
 * @param lines Every line the run printed (kept for a caller's evidence write).
 */
export function finish<R extends LaneResult>(slug: string, result: R, lines: readonly string[]): never {
  // The checks that did not hold, counted into the verdict line.
  const failed = result.checks.filter((entry) => !entry.ok)
  say(slug, (result.ok ? "PASS" : "FAIL") + " — " + result.checks.length + " checks, " + failed.length + " failed" + (result.evidenceFile === undefined ? "" : " (evidence: " + result.evidenceFile + ")"))
  if (result.notClaimed !== undefined) for (const item of result.notClaimed) say(slug, "NOT CLAIMED: " + item)
  process.exit(result.ok ? 0 : 1)
}
