// mpd-tui-adapter: THE single place where this bundle touches DSH-TUI seams.
//
// WHY THIS PACKAGE EXISTS. The DSH plane already has one contact surface
// (`packages/mpd-dsh-adapter-plugin`), and AGENTS.md §6 makes that ONE file the place a host
// release is absorbed. The DSH-TUI plane had none: `packages/mpd-tui-plugin/src/**` spelled
// `tui*` service ids, the `commands` registry and the `settings` provider inline, so a dsh-tui
// release that renames or reshapes one of those seams had to be absorbed across thirteen files.
// This module is that missing surface. Every DSH-TUI seam the bundle uses is resolved, probed and
// reported HERE.
//
// WRAPPED SEAMS (14 `tui*` services plus `tuiPrompt`, the harness `commands` registry and the
// harness `settings` provider): see {@link TUI_SEAMS} for the single-source id table.
//
// THE BINDING DISCIPLINE IS MEASURED, NOT CHOSEN (T4-INERT-1, evidence at
// `evidence/tui/plugin/20260915T054343Z/mount-instrumentation/`): in this harness a plugin
// context reaches a service it has INJECTED and nothing else. An inject-free row gets
// `undefined` from `ctx.get(id, false)` for every `tui*` service, so a probe-then-register plugin
// registers NOTHING in a real boot. Therefore:
//
//   * the binder is ONE deferred `ctx.inject([id], scoped => …)` PER SEAM — never batched into a
//     single `ctx.inject([a, b, c], …)`, because cordis resolves the dependency list
//     all-or-nothing: one absent optional seam would suppress every other seam in the batch;
//   * the capability PROBE is `ctx.get(id, false)`, and it NEVER binds a seam by itself (a probe
//     that answers is not a channel — that is exactly the mistake the first version of the TUI
//     plugin made). The probe exists to report `capabilities()`, plus the ONE documented
//     exception in {@link TUI_SEAMS}' `pluginHost` rule;
//   * a seam that never binds reports `absent` and contributes to ONE aggregate warn-once line.
//     A missing optional seam NEVER fails a boot: a web or headless composition, where none of
//     these services exist, must stay completely inert;
//   * every host handle returned by a registration is owned by `scoped.effect(() => release(),
//     label)` on the INJECTED scope, so an unload or a hot reload cannot leave a stale
//     registration behind;
//   * where a host API takes a trailing `identity` argument, the CONSUMER's context is passed
//     through, so the host's effect ledger attributes the registration to the activating row
//     rather than to this adapter.
//
// NEVER A TERMINAL WRITE. A DSH-TUI session owns the terminal: one stray `console.log` corrupts
// the rendered frame, and the same is true of the `process.stderr` fallback the TUI plugin used
// to carry. This package therefore writes its own diagnostics (the provider boot line and the
// seam inventory) to a FILE sink under `<workspace>/.mpd/logs/`, and {@link createFileSink} is the
// sink every consumer's fallback uses. Nothing in this module writes to fd 1 or fd 2.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// ── the seam id table (the ONE place a DSH-TUI service NAME appears) ────────────────────────────

/** The plugin row name cordis mounts this module under (the bundle patch declares `mpd-tui-adapter`). */
export const name = "mpd-tui-adapter"

// No hard service dependency: every seam is bound through the DEFERRED inject form inside
// `createTuiAdapter`, so the row mounts in any composition order, in partial installs, and in a
// web/headless composition where none of these services exists.
export const inject: string[] = []

/**
 * The DSH-TUI seam ids, keyed by a short adapter-local name.
 *
 * This table is the SINGLE SOURCE of every DSH-TUI service name in the bundle: consumers address
 * a seam by its KEY (`tui.whenBound("pluginHost", …)`, `TUI_SEAMS.scenes`), never by the raw
 * service id, and `packages/mpd-tui-plugin/src/**` is gated on that by
 * `packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts`.
 *
 * The last three ids are HARNESS services rather than `tui*` services, but they are reached the
 * same way (a deferred inject) and they belong to the same plane: the TUI surfaces register the
 * `/mpd` command and the `mpd` settings namespace through them.
 */
export const TUI_SEAMS = {
  /** Full-screen plugin scenes. */
  scenes: "tuiScenes",
  /** The keyed status line above the prompt. */
  status: "tuiStatus",
  /** Transcript renderers for log-only session events. */
  renderers: "tuiRenderers",
  /** The `/settings` section registry. */
  settingsSections: "tuiSettingsSections",
  /** Global keyboard bindings. */
  shortcuts: "tuiShortcuts",
  /** Host-managed modal dialogs. */
  dialogs: "tuiDialogs",
  /** Subcommand completion for one command root. */
  commandTrees: "tuiCommandTrees",
  /** The mediated plugin-host surface (DecisionEvents + the grant facade). */
  pluginHost: "tuiPluginHost",
  /** Transient host toasts. */
  toast: "tuiToast",
  /** The theme registry. */
  themes: "tuiThemes",
  /** Per-plugin key/value storage. */
  pluginStorage: "tuiPluginStorage",
  /** The session message observer. */
  messageObserver: "tuiMessageObserver",
  /** The host's effect ledger (read-only). */
  effectLedger: "tuiEffectLedger",
  /** The workspace registry. */
  workspaces: "tuiWorkspaces",
  /** The prompt-slot seam — HOST-UNAVAILABLE on every measured dsh-tui build (docs/tui.md seam 2). */
  prompt: "tuiPrompt",
  /** The harness command registry (`/mpd`). */
  commands: "commands",
  /** The harness settings provider (namespace registration). */
  settings: "settings",
} as const

/** The adapter-local key of one seam; the vocabulary consumers use instead of the raw service id. */
export type TuiSeamKey = keyof typeof TUI_SEAMS

/** The service id one seam key resolves to, as it appears in the composition. */
export type TuiSeamId = (typeof TUI_SEAMS)[TuiSeamKey]

/**
 * Every seam key, in the table's declaration order.
 *
 * The order is the order of the aggregate diagnostic, so it is a contract, not an accident.
 */
export const TUI_SEAM_KEYS: readonly TuiSeamKey[] = [
  "scenes",
  "status",
  "renderers",
  "settingsSections",
  "shortcuts",
  "dialogs",
  "commandTrees",
  "pluginHost",
  "toast",
  "themes",
  "pluginStorage",
  "messageObserver",
  "effectLedger",
  "workspaces",
  "prompt",
  "commands",
  "settings",
]

// ── the outcome vocabulary (moved here from the TUI plugin's own host.ts/types.ts) ──────────────

/** How one optional seam actually turned out, as measured rather than assumed. */
export type SeamState =
  /** A host read-back proves the registration (e.g. `tuiShortcuts.list()`). */
  | "confirmed"
  /** The host accepted the call but exposes no read-back; NOT claimed as registered. */
  | "requested"
  /** The service is reachable and the seam is request-based (nothing to register). */
  | "available"
  /** The seam was never bound in this composition. */
  | "absent"
  /** The call threw, or a read-back shows the registration did not happen. */
  | "refused"

/** The measured result of one seam activation, carrying the seam it belongs to. */
export interface SeamOutcome {
  /** The service id this outcome describes (`tuiScenes`, `commands`, …). */
  id: string
  /** Which seam state this activation reached. */
  state: SeamState
  /** The measured detail behind the state, e.g. why a registration was refused. */
  detail?: string
}

/**
 * Render one outcome as the aggregate line's `id(state: detail)` term.
 * @param outcome - the measured outcome, carrying its own seam id.
 * @returns the one-term rendering used inside the aggregate diagnostic.
 */
export function describeOutcome(outcome: SeamOutcome): string {
  return outcome.detail === undefined ? `${outcome.id}(${outcome.state})` : `${outcome.id}(${outcome.state}: ${outcome.detail})`
}

/** The two-level sink the aggregate diagnostic needs (structurally satisfied by the TUI plugin's `Log`). */
export interface OutcomeSink {
  /** Receives the aggregate line when at least one seam did something. */
  info(line: string): void
  /** Receives the aggregate line when NO seam is composed (the web/headless composition). */
  warn(line: string): void
}

/**
 * Print the ONE aggregate diagnostic over a list of seam outcomes.
 *
 * The line is the moved verbatim behaviour of the TUI plugin's boot report: a REFUSED
 * registration counts as "something happened" (the line must be able to report a refusal instead
 * of hiding it behind the nothing-composed warning), and the warning is ONE line for the whole
 * plugin rather than one per seam — a TUI boot must not fill its log with the same expected miss
 * seventeen times.
 * @param sink - where the line goes (a host logger or the file sink; never a terminal fd).
 * @param outcomes - the outcomes to report, in wiring order.
 * @returns which branch printed, so a caller can assert the aggregate's shape.
 */
export function reportOutcomes(sink: OutcomeSink, outcomes: readonly SeamOutcome[]): "warned" | "reported" {
  /** Whether any seam reached a state other than `absent`. */
  const attempted = outcomes.some((outcome) => outcome.state !== "absent")
  if (!attempted) {
    sink.warn("no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped")
    return "warned"
  }
  sink.info(`mpd TUI surfaces: ${outcomes.map((outcome) => describeOutcome(outcome)).join(" · ")}`)
  return "reported"
}

// ── the file sink (the ONLY fallback a TUI diagnostic may use) ──────────────────────────────────

/** One sink that accepts an already-formatted line; no method of it may reach a terminal. */
export interface DiagnosticSink {
  /** Appends one line; never throws, never writes to fd 1 or fd 2. */
  write(line: string): void
}

/** The file sink's own configuration. */
export interface FileSinkOptions {
  /** The workspace root, resolved per write so one host serving many sessions stays correct. */
  root: string | (() => string)
  /** The file name under `<root>/.mpd/logs/`; defaults to `mpd-tui.log`. */
  name?: string
  /** The size cap in bytes; the file is rewritten with its tail once it is exceeded. */
  capBytes?: number
}

/** The default diagnostic file name under `<workspace>/.mpd/logs/`. */
export const DEFAULT_LOG_NAME = "mpd-tui.log"
/** The default size cap: 1 MiB, past which the sink keeps the tail of the file. */
export const DEFAULT_LOG_CAP_BYTES = 1_048_576

/**
 * Resolve the process-wide fallback workspace root for a diagnostic FILE.
 *
 * This is deliberately NOT the per-session resolution the adapter's seam work uses: a log file is
 * process-scoped, and it must exist even on a surface with no live session. The session-aware
 * caller passes its own resolver into {@link createFileSink} instead.
 * @returns `DSH_WORKSPACE_ROOT`, else the process cwd.
 */
export function defaultLogRoot(): string {
  /** The environment override, used when it is a non-empty string. */
  const env = process.env.DSH_WORKSPACE_ROOT
  if (typeof env === "string" && env.length > 0) return env
  return process.cwd()
}

/**
 * Build the append-only file sink a TUI diagnostic falls back to.
 *
 * WHY A FILE: a live TUI owns the terminal's alternate screen, so a fallback that writes to
 * stderr corrupts the rendered frame — the exact defect requirement R5 names. A file sink is
 * silent, survives the session, and is readable afterwards by a QA lane.
 * @param options - the root resolver, the file name and the size cap.
 * @returns the sink plus the path it writes to (resolved per write, for diagnostics).
 */
export function createFileSink(options: FileSinkOptions): DiagnosticSink & { path(): string } {
  /** The configured file name, defaulted. */
  const fileName = typeof options.name === "string" && options.name.length > 0 ? options.name : DEFAULT_LOG_NAME
  /** The configured size cap, defaulted. */
  const cap = typeof options.capBytes === "number" && options.capBytes > 0 ? options.capBytes : DEFAULT_LOG_CAP_BYTES
  /** Resolve the current workspace root for this write. */
  const rootOf = (): string => {
    try {
      /** The configured root, resolved when it is a function. */
      const resolved = typeof options.root === "function" ? options.root() : options.root
      return typeof resolved === "string" && resolved.length > 0 ? resolved : defaultLogRoot()
    } catch {
      return defaultLogRoot()
    }
  }
  /** The current log file path: `<root>/.mpd/logs/<name>`. */
  const pathOf = (): string => join(rootOf(), ".mpd", "logs", fileName)
  return {
    path: pathOf,
    /** Appends one line, rotating past the cap; never throws and never touches a terminal. */
    write(line: string): void {
      try {
        /** The path this line is appended to. */
        const file = pathOf()
        mkdirSync(dirname(file), { recursive: true })
        // Rotate BEFORE the append: a cap checked afterwards would let the file grow past it and
        // then keep growing, because the rewrite only ever keeps the tail.
        try {
          if (statSync(file).size > cap) {
            /** The existing content, read so its tail can be kept. */
            const existing = readFileSync(file, "utf8")
            writeFileSync(file, existing.slice(Math.floor(existing.length / 2)), "utf8")
          }
        } catch {
          // No file yet (or unreadable): the append below creates it.
        }
        appendFileSync(file, `${line}\n`, "utf8")
      } catch {
        // A diagnostic sink must never break a render or a boot: drop the line instead.
      }
    },
  }
}

// ── the host contact (the ONE load-time reach into the installed DSH-TUI) ───────────────────────
//
// WHY THIS IS ALSO THIS PACKAGE'S JOB. Everything else here wraps a seam the host OFFERS to plugins.
// There is one host capability a plugin cannot be granted: the host's OWN input bus. The Chat screen
// reads Ctrl+A from `useInput`, whose listener sits on the `internal_eventEmitter` of the host's
// `StdinContext`, and the host exposes no seam for that emitter. Measured on dsh-tui 0.12.0:
//   * `lib/types/ui.js` re-exports `useStdin` (`useContext(StdinContext)`), so a component the host
//     renders reads the LIVE context value — the SAME emitter `App.js` emits `input` on;
//   * the host package `exports` map has NO `./lib/*` subpath, so a PACKAGE-specifier import of a
//     host internal is refused. The absolute FILE URL is the only route, and it is also what makes
//     the import return the SAME module instance the host uses: Node caches ESM by resolved URL, and
//     a second instance would read a DIFFERENT React context object — i.e. the context DEFAULT, an
//     emitter that never receives input. That silent failure is why the probe verifies the shape and
//     why a consumer must never copy this logic.
// The probe is therefore EAGER (at row load), CACHED (one probe per adapter), and DEGRADING: every
// failure — no candidate, an unreadable candidate, an import error, a module without `useStdin` —
// leaves `hostInput()` undefined plus ONE diagnostic line, and a boot that never had the contact
// simply behaves as it did before this capability existed.

/**
 * The host package directory, relative to an install prefix.
 *
 * A candidate root is VALID only when `<root>/lib/types/ui.js` exists AND that module exports a
 * usable `useStdin`: a directory that merely looks like an install is not a contact.
 */
export const HOST_PACKAGE_PATH: readonly string[] = ["node_modules", "@deepseek-harness-tui", "dsh-tui"]

/** The host module the contact is loaded from, relative to a host package root. */
export const HOST_UI_MODULE = "lib/types/ui.js"

/** The env key that PINS the host root. A pin is EXCLUSIVE: see {@link hostRootCandidates}. */
export const HOST_ROOT_ENV = "MPD_DSH_TUI_HOST_ROOT"

/** Home roots whose `profiles/<name>` directories may hold an installed host. */
const HOST_HOME_DIRS: readonly string[] = [".dsh", ".dsh-tui"]

/** How many ancestor levels one anchor walks while looking for a `node_modules` install. */
const HOST_ANCHOR_LEVELS = 8

/**
 * The host's own input contact, as this adapter hands it to a consumer.
 *
 * `useStdin` is the HOST module's function, never a re-implementation: it reads the host's
 * `StdinContext` through the host's React instance, which is why a component the host renders gets
 * the LIVE context value. It is a React hook, so a consumer may call it only during a render.
 */
export interface TuiHostInput {
  /** The host's `useStdin` hook; its result is host-shaped and narrowed by the caller. */
  useStdin(): unknown
}

/** Where the host contact stands, as the capability read-out reports it. */
export interface HostInputState {
  /** `pending` until the contact settles, then `bound` or `absent`. */
  state: "pending" | "bound" | "absent"
  /** Which source armed the contact: the kit a scene render handed us, or the module resolved at load. */
  kit?: "remembered" | "probed"
  /** The host root the contact came from, when one was bound by the probe. */
  root?: string
  /** The ONE reason the contact is absent, or how it bound; never a fabricated success. */
  detail?: string
}

/**
 * The host's per-App input bus, as a consumer uses it (Node EventEmitter semantics).
 *
 * Declared HERE rather than by a consumer because the emitter is a host object reached through the
 * host's React context: the shape belongs to the contact surface, and a consumer only calls it.
 */
export interface HostInputEmitterLike {
  /** Registers a listener at the FRONT of the bus, ahead of every listener already attached. */
  prependListener(event: "input", listener: (event: unknown) => void): unknown
  /** Removes that listener again, so an unload leaves the bus exactly as it was found. */
  removeListener(event: "input", listener: (event: unknown) => void): unknown
  /** The ordinary registration form, proved present so a foreign object is never mistaken for a bus. */
  on(event: "input", listener: (event: unknown) => void): unknown
}

/**
 * The private field that tells a LIVE `StdinContext` value apart from the context DEFAULT.
 *
 * MEASURED on dsh-tui 0.12.0: `App.js` puts `internal_querier: this.querier` (never null) into the
 * context value it provides, while the context's own default — what a consumer reads when nothing
 * provides it, or when React module identity differs — carries `internal_querier: null` and a FRESH
 * `EventEmitter` that no `App` ever feeds. Both shapes look like a working emitter, so a listener
 * attached to the default is attached to nothing, with no error anywhere. This field is the cheapest
 * structural discriminator between the two, and it is WHY the takeover can report its own absence.
 */
export const HOST_LIVE_CONTEXT_MARKER = "internal_querier"

/** What one read of the host's stdin context produced: the live input bus, or the ONE reason it is not. */
export interface HostStdinValue {
  /** The host's input bus, present only for a value that is the LIVE provider's. */
  emitter?: HostInputEmitterLike
  /** Why no bus can be used, as one line; absent when `emitter` is present. */
  detail?: string
}

/**
 * Decide whether one `useStdin()` result is the LIVE host context value, and read its input bus.
 *
 * The read is intentionally narrow: the live-provider marker, the emitter field, and the three
 * emitter members. Nothing else of the host's context is touched, a getter that throws is contained,
 * and every refusal returns ONE sentence a consumer can log verbatim (the absence of the takeover
 * has no other symptom).
 * @param value - the value the host's own `useStdin` hook returned, or anything else.
 * @returns the bus, or the one reason it cannot be used.
 */
export function readHostStdinValue(value: unknown): HostStdinValue {
  try {
    if (typeof value !== "object" || value === null) return { detail: "the host stdin hook answered no context value" }
    /** The context value viewed as a record; only the two fields below are ever read. */
    const record = value as Record<string, unknown>
    /** The live-provider marker, absent (or null) on the context DEFAULT. */
    const marker = HOST_LIVE_CONTEXT_MARKER in record ? record[HOST_LIVE_CONTEXT_MARKER] : undefined
    if (marker === undefined || marker === null) {
      return {
        detail: `the host hook resolved the StdinContext DEFAULT (no ${HOST_LIVE_CONTEXT_MARKER}) — the host module instance is not the one the TUI runs; the take-over stays absent`,
      }
    }
    /** The bus the host's `App` publishes input on. */
    const emitter = record.internal_eventEmitter
    if (emitter === undefined || emitter === null) return { detail: "the host stdin context carries no input emitter" }
    /** The bus viewed structurally; all three members must be callable before it is handed out. */
    const bus = emitter as Partial<HostInputEmitterLike>
    if (typeof bus.prependListener !== "function") return { detail: "the host input emitter has no prependListener" }
    if (typeof bus.removeListener !== "function") return { detail: "the host input emitter has no removeListener" }
    if (typeof bus.on !== "function") return { detail: "the host input emitter has no on" }
    return { emitter: bus as HostInputEmitterLike }
  } catch (error) {
    return { detail: `the host stdin context could not be read: ${String((error as Error)?.message ?? error)}` }
  }
}

/** What one host-contact probe found. */
export interface HostInputProbeResult {
  /** The host contact, when a candidate carried a usable `useStdin`. */
  input?: TuiHostInput
  /** The host root the contact was loaded from. */
  root?: string
  /** The reason no contact was bound, as one line, when none was. */
  detail?: string
}

/**
 * Candidate host roots, most specific first.
 *
 * The anchor list follows the bundle's existing live-install resolution
 * (`packages/mpd-tui-plugin/src/registration.ts` `candidateAnchors`): the module's OWN location (in a
 * profile install the bundle sits inside `<profile>/node_modules`, so walking up finds the host next
 * to it), the running script (`process.argv[1]` — the dsh bin lives in the same profile), and every
 * installed profile under `$DSH_HOME`, `~/.dsh` and `~/.dsh-tui`.
 * @param env - environment (testing); `MPD_DSH_TUI_HOST_ROOT` PINS one root.
 * @param home - home directory (testing).
 * @returns deduplicated candidate roots; a candidate that does not exist is simply skipped later.
 */
export function hostRootCandidates(env: Record<string, string | undefined> = process.env, home: string = homedir()): string[] {
  /** The explicit override. A PIN IS EXCLUSIVE — no discovered anchor is probed — so a QA lane that
   *  stages one install proves exactly that install, and a pinned root that is wrong reports its own
   *  path instead of silently binding some other profile's host. */
  const pinned = env[HOST_ROOT_ENV]
  if (typeof pinned === "string" && pinned.length > 0) return [pinned]
  /** The candidate roots, in probe order, deduplicated before they are returned. */
  const roots: string[] = []
  /** The directories the install is discovered from: this module and the running script. */
  const anchors: string[] = []
  try {
    anchors.push(dirname(fileURLToPath(import.meta.url)))
  } catch {
    // A non-file module URL (a bundled embedder): the remaining anchors still apply.
  }
  /** The script path node was started with, the bundle's second anchor. */
  const argv1 = process.argv[1]
  if (typeof argv1 === "string" && argv1.length > 0) anchors.push(dirname(argv1))
  for (const anchor of anchors) {
    /** The anchor directory this walk is at, moved one level up per iteration. */
    let dir = anchor
    for (let level = 0; level < HOST_ANCHOR_LEVELS; level += 1) {
      roots.push(join(dir, ...HOST_PACKAGE_PATH))
      /** The parent directory; equal to `dir` at the filesystem root, which ends the walk. */
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  /** The DSH home roots whose installed profiles may hold the host. */
  const homes: string[] = []
  if (typeof env.DSH_HOME === "string" && env.DSH_HOME.length > 0) homes.push(env.DSH_HOME)
  for (const name of HOST_HOME_DIRS) homes.push(join(home, name))
  for (const root of homes) {
    /** This home's profile entries; empty when it has no profiles directory to probe. */
    let entries: Dirent[] = []
    try {
      entries = readdirSync(join(root, "profiles"), { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.isDirectory()) roots.push(join(root, "profiles", entry.name, ...HOST_PACKAGE_PATH))
    }
  }
  return [...new Set(roots)]
}

/**
 * Load the host's input contact from the FIRST candidate that carries a usable `useStdin`.
 *
 * Never throws and never fails a boot: an unreadable candidate is skipped, an import that throws is
 * skipped, and a candidate whose `ui.js` carries no `useStdin` function is a version-skew host —
 * remembered as the reason, and the probe keeps looking at the remaining candidates.
 * @param candidates - the candidate host roots, in probe order.
 * @returns the bound contact plus its root, or the ONE reason no contact bound.
 */
export async function probeHostInput(candidates: readonly string[]): Promise<HostInputProbeResult> {
  /** The last candidate that existed but could not provide the contact, for the one-line reason. */
  let skew = ""
  if (candidates.length === 0) return { detail: `no candidate host root (no DSH profile carries ${HOST_PACKAGE_PATH.join("/")})` }
  for (const root of candidates) {
    /** The host module file this candidate would be loaded from. */
    const file = join(root, HOST_UI_MODULE)
    try {
      if (!statSync(file).isFile()) continue
    } catch {
      // Not this candidate; an unreadable path is a miss, never an error.
      continue
    }
    try {
      // The import is by ABSOLUTE FILE URL: the host's `exports` map has no `./lib/*` subpath, and a
      // package specifier would also risk a second module instance (a different React context).
      /** The host module namespace, loaded from this candidate. */
      const mod = (await import(pathToFileURL(file).href)) as { useStdin?: unknown }
      /** The host's own hook, accepted only when it is callable. */
      const hook = mod.useStdin
      if (typeof hook !== "function") {
        skew = `${file} carries no useStdin export`
        continue
      }
      // Called with no receiver: the host exports it as a module-level arrow function, so binding a
      // receiver would add nothing while a `this`-dependent export would still be its own module's.
      return { input: { useStdin: (): unknown => (hook as () => unknown)() }, root }
    } catch (error) {
      skew = `${file}: ${String((error as Error)?.message ?? error)}`
    }
  }
  return { detail: skew.length > 0 ? skew : `no candidate carried a readable ${HOST_UI_MODULE} (${candidates.length} probed)` }
}

/** Write the probe's ONE degradation line to the file sink (never a terminal, requirement R5). */
function defaultHostInputLog(line: string): void {
  try {
    createFileSink({ root: defaultLogRoot }).write(line)
  } catch {
    // A diagnostic must never break a boot; the capability read-out is the authority anyway.
  }
}

/** Options of {@link createTuiAdapter}: the host-contact wiring plus the test seams. */
export interface TuiAdapterOptions {
  /** The host contact to use instead of probing (unit tests, embedders). */
  hostInput?: TuiHostInput
  /**
   * Run the load-time host probe. Deliberately OPT-IN, and only the mounted adapter ROW passes it:
   * a row-private fallback adapter is a degraded composition, and every extra probe would repeat
   * filesystem work and emit its own line for the same missing host.
   */
  probeHostContact?: boolean
  /** Where the probe's ONE degradation line goes; defaults to the file sink. */
  hostInputLog?: (line: string) => void
}

// ── the host service shapes (moved here from the TUI plugin's types.ts) ─────────────────────────

/** A cleanup function; every seam registration returns one. */
export type Disposer = () => void

/** The logging subset the TUI surfaces use (cordis `ctx.logger(name)` or a bare logger). */
export interface LoggerLike {
  /** Records a normal surface event on the host logger. */
  info?(message: string): void
  /** Records a degradation or a refusal. */
  warn?(message: string): void
  /** Records a wiring detail, typically gated behind a debug switch. */
  debug?(message: string): void
  /** Records a failure the host logger should not filter. */
  error?(message: string): void
}

/** The subset of the cordis context every seam of this plane uses. */
export interface PluginContextLike {
  /**
   * `ctx.inject([id], scoped => …)` — the DEFERRED optional-seam form. The
   * callback runs when the service is composed; a service that never appears
   * never runs it. This is what makes a service reachable at all (T4-INERT-1).
   */
  inject?(dependencies: readonly string[], callback: (scoped: PluginContextLike) => void): unknown
  /** `ctx.get(id, false)` — soft probe, valid only for services the row injected. */
  get?(name: string, strict?: boolean): unknown
  /** `ctx.effect(() => cleanup, label)` — fiber-owned cleanup. */
  effect?(callback: () => Disposer | void, label?: string): unknown
  /** The context's logger, absent in a bare test context (the fallback is the file sink). */
  logger?: LoggerLike
  [key: string]: unknown
}

/** `ctx.tuiStatus` — keyed status-line contributions plus the bounded rich companion. */
export interface TuiStatusLike {
  /** Publishes this key's contribution, or clears it with `undefined`; returns its handle. */
  set(key: string, text: string | number | boolean | undefined, identity?: unknown): Disposer | undefined
  /**
   * Registers one compact React view above the prompt (host `TuiStatusViewDescriptor`).
   *
   * OPTIONAL member: a host build without it refuses the rich form by ABSENCE, which is exactly how
   * this adapter reports it. The host validates the key against the same grammar as `set`, requires
   * `maxRows` to be an INTEGER FROM 1 TO 3 (0 is rejected), requires `component` to be a function,
   * refuses a key already registered by text or by view, and applies a six-row aggregate budget.
   * A refusal returns `undefined` (the host warns on its own logger); a success returns the
   * registration's disposer.
   */
  registerView?(descriptor: TuiStatusViewDescriptorLike, identity?: unknown): Disposer | undefined
}

/** One rich status view, as the host accepts it (the shape `registerStatusComponent` takes). */
export interface TuiStatusViewDescriptorLike {
  /** The view key: the host key grammar, shared with the text namespace of `set`. */
  key: string
  /** The component the host renders with `{React, ui}`; the host clips its rows. */
  component: unknown
  /** Rows the host reserves and clips the view to; the host accepts 1..3 and defaults to 1. */
  maxRows?: number
}

/** What a transcript renderer returns (host `TuiEntryRenderResult`). */
export interface TuiRenderResult {
  /** The optional first row of the rendered entry. */
  title?: string
  /** The entry's body rows; the host clamps them to 100 lines of 400 cells. */
  lines: string[]
}

/** `ctx.tuiRenderers` — log-only session event -> transcript text rows. */
export interface TuiRenderersLike {
  /** Registers one event type's renderer; a refusal still returns a no-op disposer. */
  register(type: string, renderer: (payload: unknown) => TuiRenderResult | undefined, identity?: unknown): Disposer | undefined
}

/** One editable field of a `/settings` section. */
export interface TuiSettingsFieldLike {
  /** The field's location inside the namespace, one element per segment. */
  path: readonly string[]
  /** The field's display label. */
  label: string
  /** Localized labels, keyed by language tag. */
  descriptions?: Record<string, string>
  /** The help text under the field; the TUI plugin states the restart contract there. */
  hint?: string
  /**
   * Localized help text, keyed by language tag; the host renders `hintDescriptions[lang] ?? hint`.
   *
   * Declared because the installed host HAS the field
   * (`adapter/ports/channel-settings.d.ts` → `hintDescriptions?: LocalizedDescriptions`), USES it
   * (`screens/Settings.js` → `pick(field.hint, field.hintDescriptions)` with
   * `pick = descriptions?.[getLang()] ?? text`) and its own definitions ship the pattern
   * (`settings/definitions.js` → an English `hint` plus `hintDescriptions: { zh }`). Without this
   * line the section could not carry it: `TuiSettingsFieldLike` governs the object literal a
   * consumer builds, so the alternative would be a cast smuggling an undeclared key past the
   * adapter — the exact reach this interface exists to prevent. Adding an OPTIONAL key changes no
   * runtime path and no seam id; a consumer that omits it behaves exactly as before.
   */
  hintDescriptions?: Record<string, string>
  /** How the host renders and edits the value. */
  kind: "text" | "number" | "boolean" | "select"
  /** The frozen option list of a `select` field; absent for the other kinds. */
  options?: readonly { value: string; label: string; descriptions?: Record<string, string> }[]
  /** Placeholder shown while a text field is empty. */
  placeholder?: string
}

/** `ctx.tuiSettingsSections` — one `/settings` section declaration. */
export interface TuiSettingsSectionLike {
  /** The settings namespace this section edits, e.g. `mpd`. */
  ns: string
  /** The section's display title. */
  title: string
  /** Localized section titles, keyed by language tag. */
  descriptions?: Record<string, string>
  /** The editable fields, in display order. */
  fields: readonly TuiSettingsFieldLike[]
}

/** `ctx.tuiSettingsSections` — the section registry of the `/settings` screen. */
export interface TuiSettingsSectionsLike {
  /** Declares one section; a refusal still returns a no-op disposer. */
  register(section: TuiSettingsSectionLike): Disposer | undefined
}

/** Props the host passes to a plugin scene (`TuiSceneProps`). */
export interface TuiScenePropsLike {
  /** The TUI's own React instance — every hook and element must use it. */
  React: any
  /** The TUI's ui kit (`Box`, `Text`, `useInput`, `useTerminalSize`, …). */
  ui: any
  /** Live session channel (observer only). */
  channel?: any
  /** Leave the scene. */
  close(): void
}

/** One scene descriptor as the host's scene registry accepts it. */
export interface TuiSceneDescriptor {
  /** The scene id the host opens by. */
  id: string
  /** The title shown in the scene header. */
  title?: string
  /** The scene component, built from `props.React`/`props.ui`. */
  component: unknown
}

/** `ctx.tuiScenes` — full-screen plugin scenes. */
export interface TuiScenesLike {
  /** Registers one scene descriptor; a refusal still returns a no-op disposer. */
  register(descriptor: TuiSceneDescriptor, identity?: unknown): Disposer | undefined
  /** Opens a registered scene; false when this composition has none. */
  open(id: string): boolean
  /**
   * Closes a scene by id, WHEN the host build carries the member at all.
   *
   * The measured dsh-tui build exposes no close: a scene leaves by calling the `close()` on its
   * own props. The member is therefore optional here and {@link TuiAdapter.closeScene} reports
   * `false` instead of inventing one.
   */
  close?(id: string): boolean
}

/** One command-tree completion provider (host `TuiCommandTreeProvider`). */
export interface TuiCommandTreeProvider {
  /** The command root the completion applies to, e.g. `mpd`. */
  root: string
  /** Localized descriptions of the root, keyed by language tag. */
  descriptions?: Record<string, string>
  /** The children of one canonical path; an empty list claims nothing below it. */
  children(canonicalPath: readonly string[]): readonly { name: string; description: string; descriptions?: Record<string, string> }[]
}

/** `ctx.tuiCommandTrees` — subcommand completion for one command root. */
export interface TuiCommandTreesLike {
  /** Declares the completion provider for one command root. */
  register(provider: TuiCommandTreeProvider): Disposer | undefined
}

/** `ctx.tuiShortcuts` — global keyboard bindings. */
export interface TuiShortcutsLike {
  /** Binds one combo; a refused combo still returns a no-op disposer. */
  register(combo: string, options: { description: string; handler: () => void | Promise<void> }, identity?: unknown): Disposer | undefined
  /** Read-back owned by the calling activation — the honest confirmation source. */
  list?(): readonly { combo: string; description: string }[]
}

/** `ctx.tuiDialogs` — host-managed modal dialogs. */
export interface TuiDialogsLike {
  /** Parks a pick-one request; resolves undefined when cancelled or never answered. */
  select(request: {
    title: string
    options: readonly { id: string; label: string; description?: string }[]
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<string | undefined>
  /** Parks a yes/no request; resolves undefined when cancelled or never answered. */
  confirm(request: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; timeoutMs?: number }): Promise<boolean | undefined>
  /** Parks a free-text request; resolves undefined when cancelled or never answered. */
  input(request: { title: string; placeholder?: string; initial?: string; timeoutMs?: number }): Promise<string | undefined>
}

/** `ctx.tuiPluginHost` — the mediated DecisionEvents activation surface. */
export interface TuiPluginHostLike {
  /** Attempts the mediated interception subscription; a refusal still returns a no-op disposer. */
  subscribeDecision(
    pluginCtx: unknown,
    event: string,
    listener: (payload: Record<string, unknown>) => unknown,
    options?: { scope?: string; order?: string },
  ): Disposer | undefined
  /** Lists the intercept points the host exposes, when it can enumerate them at all. */
  probeDecisionEvents?(): readonly string[]
  /**
   * Caller-safe grant facade. `allows` is the documented source of truth for
   * "is this activation authorised for permission@scope" — the ONE honest signal
   * that does not require calling a disposer as a probe (reviewer direction for
   * T10-F1).
   */
  grants?: {
    allows(pluginCtx: unknown, permission: string, scope: string): boolean
    defaultOf?(permission: string): "allow" | "deny"
  }
}

/**
 * `ctx.tuiToast` — transient host notifications.
 *
 * MINIMAL SHAPE, NO CLAIMED SEMANTICS: no mpd surface registers a toast yet, so this interface is
 * the structural minimum (`push` returning a dismissal handle). A host build that reshapes it
 * degrades into `absent`/`refused` like every other seam here; nothing in the bundle depends on
 * the member beyond the read surface.
 */
export interface TuiToastLike {
  /** Shows one transient message and returns its dismissal handle. */
  push(message: string, options?: { level?: string; timeoutMs?: number }): Disposer | undefined
}

/**
 * `ctx.tuiThemes` — the theme registry.
 *
 * MINIMAL SHAPE, NO CLAIMED SEMANTICS: registered for the same reason as the other unused seams —
 * the seam is bound, probed and reported in ONE place, so a later mpd surface can use it without
 * reopening this closure.
 */
export interface TuiThemesLike {
  /** Registers one named theme; a refusal still returns a no-op disposer. */
  register(name: string, theme: Record<string, unknown>): Disposer | undefined
  /** The currently selected theme name, when the host exposes a read. */
  current?(): string | undefined
}

/** `ctx.tuiPluginStorage` — per-plugin durable key/value storage. */
export interface TuiPluginStorageLike {
  /** Reads one key of this plugin's own storage. */
  get(key: string): unknown
  /** Writes one key of this plugin's own storage. */
  set(key: string, value: unknown): void
}

/** `ctx.tuiMessageObserver` — read-only observation of the session's message stream. */
export interface TuiMessageObserverLike {
  /** Subscribes to message events; the returned disposer is the only unsubscribe path. */
  subscribe(listener: (message: unknown) => void): Disposer | undefined
}

/**
 * `ctx.tuiEffectLedger` — the host's ledger of plugin effects.
 *
 * MEASURED UNREACHABLE from a plugin activation in the probed build
 * (`evidence/tui/plugin/20260915T060934Z/mount/renderer-type-probe/FINDING-CORRECTION.md`), which
 * is why nothing in the bundle reads it: binding and reporting it here is the honest treatment of
 * a seam that exists in the composition but not on this channel.
 */
export interface TuiEffectLedgerLike {
  /** The ledger's rows, when the host exposes them at all. */
  entries?(): readonly unknown[]
}

/** `ctx.tuiWorkspaces` — the workspace registry. */
export interface TuiWorkspacesLike {
  /** The workspace roots this host currently serves. */
  list?(): readonly string[]
}

/**
 * `ctx.tuiPrompt` — the prompt-slot seam.
 *
 * HOST-UNAVAILABLE: every measured dsh-tui build omits this service, and `docs/tui.md` (seam 2)
 * records the decision to claim nothing about it. It stays in the table so the inventory reports
 * its absence explicitly rather than hiding it.
 */
export interface TuiPromptLike {
  /** Contributes one prompt section, when a future host build provides the slot. */
  register?(section: { id: string; text: string }): Disposer | undefined
}

/** `ctx.commands` — the harness command registry (`/mpd`). */
export interface CommandsLike {
  /** Registers the command; the harness throws instead of returning a failure sentinel. */
  register(definition: TuiCommandDefinition): Disposer | undefined
}

/** One harness command definition, as the TUI plugin's `/mpd` surface registers it. */
export interface TuiCommandDefinition {
  /** The command name, without the leading slash. */
  name: string
  /** Model-facing description of what the command does. */
  description: string
  /** Runs the command for one invocation and returns its rendered result. */
  handler: (invocation: { rawInput: string; agent?: { session?: SessionLike } }) =>
    | { kind: "success"; text?: string }
    | { kind: "error"; text: string }
    | Promise<{ kind: "success"; text?: string } | { kind: "error"; text: string }>
}

/** The live Session subset the TUI surfaces read (append of a log-only event). */
export interface SessionLike {
  /** Appends one log-only session record, when the session exposes the writer. */
  append?(type: string, data: unknown): unknown
  /** The session header, read for the calling workspace's `cwd`. */
  header?: { cwd?: string }
}

/** `ctx.settings` — the harness settings service (namespace registration). */
export interface SettingsProviderLike {
  /** Declares one settings namespace with its schema; a duplicate registration throws. */
  register(ns: string, schema: unknown, options?: unknown): unknown
  /** The provider's read surface, used ONLY to probe whether a namespace is already served. */
  get?(ns: string): unknown
  /** Served namespaces, when the provider can enumerate them (the documented guard input). */
  describe?(): unknown
}

// ── the binder primitives (moved here from the TUI plugin's own host.ts) ─────────────────────────

/**
 * Read one service from an INJECTED scope.
 *
 * Inside the `ctx.inject` callback the service is reachable both as a property
 * and through the soft probe; both forms are guarded because a foreign context
 * can throw on either.
 * @param scoped - the injected scope.
 * @param id - the service id.
 * @returns the service, or undefined when it is not readable.
 */
export function readableService<T>(scoped: PluginContextLike, id: string): T | undefined {
  if (scoped === undefined || scoped === null) return undefined
  if (typeof scoped.get === "function") {
    try {
      /** The service the soft probe returned; null and undefined both mean "not readable here". */
      const found = scoped.get(id, false)
      if (found !== undefined && found !== null) return found as T
    } catch {
      // fall through to the property form
    }
  }
  try {
    /** The service as a property of the injected scope, the host's second exposure form. */
    const property = (scoped as Record<string, unknown>)[id]
    if (property !== undefined && property !== null) return property as T
  } catch {
    // not readable in this context
  }
  return undefined
}

/**
 * Read one optional service OUTSIDE a seam.
 *
 * This does NOT work for a service the row has not injected: the whole point of
 * {@link onService} is that the inject declaration is what makes a service
 * reachable (T4-INERT-1).
 * @param ctx - the plugin context.
 * @param id - the service id.
 * @returns the service, or undefined when this context cannot reach it.
 */
export function serviceOf<T>(ctx: PluginContextLike, id: string): T | undefined {
  if (ctx === undefined || ctx === null || typeof ctx.get !== "function") return undefined
  try {
    /** The probed service; null and undefined both mean this row cannot reach it. */
    const found = ctx.get(id, false)
    return found === undefined || found === null ? undefined : (found as T)
  } catch {
    return undefined
  }
}

/** How one deferred binding call turned out, kept as ONE mutable record per seam. */
interface BindingStatus {
  /** The service the inject callback handed back; undefined until (and unless) the seam binds. */
  service?: unknown
  /** The injected scope that owns every effect registered on this seam. */
  scope?: PluginContextLike
  /** Whether the inject REGISTRATION was accepted (false when the ctx cannot inject, or it threw). */
  registered: boolean
  /** The message a throwing `ctx.inject` produced; absent when it did not throw. */
  error?: string
  /** Whether the seam bound: the callback ran and the injected scope could read the service. */
  bound: boolean
  /** Work waiting for the seam, in call order; drained by the binding callback. */
  pending: ((service: unknown, scope: PluginContextLike) => void)[]
}

/** Build the mutable record one seam's binding needs, before anything is injected. */
function newBindingStatus(): BindingStatus {
  return { registered: false, bound: false, pending: [] }
}

/**
 * Register ONE deferred binding for one service id.
 *
 * This is the single binder: it wraps the raw `ctx.inject([id], scoped => …)` call, keeps the
 * injected scope for effect ownership, drains the work queued while the seam was not yet bound,
 * and contains every failure — a ctx that cannot inject, an `inject` call that throws, and a
 * callback that throws all leave the seam `absent` instead of breaking the boot.
 * @param ctx - the plugin context.
 * @param id - the service id to bind.
 * @param status - the mutable record this binding fills in.
 * @param onBound - called once, after the seam bound and its queue was drained.
 * @returns nothing; `status` carries the result.
 */
function bindSeam(ctx: PluginContextLike, id: string, status: BindingStatus, onBound?: () => void): void {
  if (ctx === undefined || ctx === null || typeof ctx.inject !== "function") return
  try {
    ctx.inject([id], (scoped: PluginContextLike) => {
      if (status.bound) return
      /** The injected service, absent when the scope cannot read it back. */
      const service = readableService(scoped, id)
      if (service === undefined) return
      status.service = service
      status.scope = scoped
      status.bound = true
      /** The work queued while the seam was absent, drained in call order. */
      const queued = status.pending.splice(0)
      for (const work of queued) {
        try {
          work(service, scoped)
        } catch {
          // One registration's failure must never suppress the seam's other registrations.
        }
      }
      try {
        onBound?.()
      } catch {
        // A consumer's readiness hook must never break the boot.
      }
    })
    status.registered = true
  } catch (error) {
    status.error = String((error as Error)?.message ?? error)
  }
}

/**
 * Bind one service and run `setup` when it binds.
 *
 * The generic form kept for consumer-specific work — a loop over host facts, an asynchronous
 * precondition, a readiness signal. Registrations go through the adapter's own named methods
 * instead; this exists so a consumer never has to call `ctx.inject` itself.
 * @param ctx - the plugin context.
 * @param id - the service id to bind.
 * @param setup - receives the injected scope and the service.
 * @param onActivated - called after `apply` returned, when the activation was late.
 */
export function onService(
  ctx: PluginContextLike,
  id: string,
  setup: (scoped: PluginContextLike, service: unknown) => void,
  onActivated?: () => void,
): void {
  /** The binding record for this one-off call. */
  const status = newBindingStatus()
  // QUEUE FIRST, THEN BIND. `ctx.inject` fires synchronously when the service is already mounted,
  // so a setup queued after the binding call would never run; queued before it, the same setup is
  // drained by whichever path binds the seam.
  status.pending.push((service: unknown, scope: PluginContextLike) => {
    setup(scope, service)
  })
  bindSeam(ctx, id, status, onActivated)
}

/**
 * Own a cleanup on an INJECTED scope's fiber.
 *
 * The host's registration services return a disposer scoped to the CALLER (a
 * service method cannot see the caller's fiber), so the seam hands it back to
 * `scoped.effect`; disposing that scope (plugin unload, hot reload) then runs it.
 * @param scoped - the injected scope.
 * @param cleanup - the disposer the host returned.
 * @param label - the label the host's effect ledger records.
 */
export function effectOn(scoped: PluginContextLike, cleanup: Disposer, label: string): void {
  try {
    if (typeof scoped.effect === "function") scoped.effect(() => cleanup, label)
  } catch {
    // A disposed scope cannot own new effects; nothing durable was registered.
  }
}

// ── the registration handles ────────────────────────────────────────────────────────────────────

/** The handle every activation returns: what actually happened, and whether it is live. */
export interface SeamBindingHandle {
  /** The measured outcome, carrying the seam's own id. */
  outcome(): SeamOutcome
  /** Whether the seam is bound right now (the honest activation test, never a disposer's type). */
  bound(): boolean
  /** Replaces the outcome with the consumer's own measured result for this seam. */
  record(outcome: { state: SeamState; detail?: string }): void
}

/** The handle a status view returns: its outcome plus the manual refresh path. */
export interface StatusViewHandle extends SeamBindingHandle {
  /** Recomputes the line and republishes it when it changed. */
  refresh(): void
}

/**
 * The handle a scene registration returns.
 *
 * It carries the two navigation calls as well, so a consumer that registers a scene can open and
 * close it without reaching for the adapter a second time (the shape the TUI package's own scene
 * seam already exposes).
 */
export interface SceneRegistrationHandle extends SeamBindingHandle {
  /** Opens a registered scene by id; false when the seam is absent or the host does not know it. */
  openScene(id: string): boolean
  /** Closes a scene by id; false when this host build exposes no close member. */
  closeScene(id: string): boolean
}

/** The consumer-facing shape of one status view, owned by {@link TuiAdapter.registerStatusView}. */
export interface TuiStatusView {
  /** The status key the host validates against its key grammar. */
  key: string
  /** Builds the current line; the adapter publishes only when it CHANGED. */
  render(): string | number | boolean | undefined
  /** Refresh cadence in ms; 0 (the default) keeps the view manual. */
  intervalMs?: number
  /**
   * Retained for source compatibility; the adapter does NOT forward it.
   *
   * A status registration's identity must be the CALLING ACTIVATION (the bound injected scope), and
   * the host refuses any other value — so this field cannot be honoured, even though the host's own
   * documentation calls the trailing identity "attribution only" (MEASURED: doc and implementation
   * disagree, and the implementation wins).
   */
  identity?: unknown
  /** The effect label the injected scope records. */
  label?: string
  /** Called with anything `render()` throws, so the consumer can log it where it likes. */
  onError?(error: unknown): void
}

/** Options of {@link TuiAdapter.registerSettingsSection}'s lazy section resolver. */
export type TuiSectionResolver = () => TuiSettingsSectionLike | Promise<TuiSettingsSectionLike>

/**
 * One rich status VIEW a consumer registers through {@link TuiAdapter.registerStatusComponent}.
 *
 * The component form is how a surface gets a component rendered INSIDE the host's Chat screen with
 * no visible content of its own: an empty `ui.Box` costs zero rendered rows while still mounting,
 * which is what a listener-only hook needs (the host mounts every registered view whenever no image
 * preview is open). The host's own descriptor shape stays private to this adapter — a consumer
 * states the key, the component and (optionally) the row budget.
 */
export interface TuiStatusComponentView {
  /** The view key the host validates against its key grammar (shared with the text namespace). */
  key: string
  /** The component the host renders with `{React, ui}`; the host clips it to `maxRows`. */
  component: unknown
  /** Rows the host reserves for the view: an integer 1..3 (the host rejects 0); defaults to 1. */
  maxRows?: number
  /** The consumer context handed to the host as the contribution's identity. */
  identity?: unknown
  /** The effect label the injected scope records. */
  label?: string
}

/** Options one mediated decision subscription is registered with. */
export interface TuiDecisionOptions {
  /** The register-time scope tag the host records for this intercept point (the event id). */
  scope?: string
  /** The listener order the host applies. */
  order?: string
  /** The consumer context handed to the host as the registration identity. */
  identity?: unknown
}

/** What one attempted decision-event subscription produced, as measured facts. */
export interface TuiDecisionSubscription {
  /** Whether the bound host carries `subscribeDecision` at all. */
  supported(): boolean
  /** Whether the grant facade answered `true`; undefined when it cannot be asked. */
  granted(): boolean | undefined
  /** Whether the host returned a disposer (a refusal also returns a no-op one). */
  disposerReturned(): boolean
  /** The message a throwing subscription produced; absent when it did not throw. */
  error(): string | undefined
  /** The subscription's own outcome; see {@link TuiDecisionSubscription} in the README. */
  outcome(): SeamOutcome
}

/** The capability probe's answer for this composition. */
export interface TuiCapabilities {
  /** One boolean per seam key: true when the deferred inject bound the service. */
  seams: Record<TuiSeamKey, boolean>
  /** How many seams bound; 0 in a web or headless composition. */
  bound: number
  /** How many seams the adapter knows about (the fixed table size). */
  total: number
  /**
   * The host-contact probe's state. NOT a seam: it is the ONE load-time reach into the installed
   * DSH-TUI (see {@link TuiHostInput}), reported here so QA can see whether the contact bound
   * without guessing from a consumer's behaviour.
   */
  hostInput: HostInputState
}

/** The DSH-TUI seam adapter: typed members, registrations and the capability/outcome readouts. */
export interface TuiAdapter {
  /** The context this adapter binds its seams on. */
  readonly ctx: PluginContextLike
  /** The bound scene registry, or undefined when the seam never bound. */
  scenes(): TuiScenesLike | undefined
  /** The bound status service, or undefined when the seam never bound. */
  status(): TuiStatusLike | undefined
  /** The bound renderer registry, or undefined when the seam never bound. */
  renderers(): TuiRenderersLike | undefined
  /** The bound `/settings` section registry, or undefined when the seam never bound. */
  settingsSections(): TuiSettingsSectionsLike | undefined
  /** The bound shortcut registry, or undefined when the seam never bound. */
  shortcuts(): TuiShortcutsLike | undefined
  /** The bound dialog service, or undefined when the seam never bound. */
  dialogs(): TuiDialogsLike | undefined
  /** The bound command-tree registry, or undefined when the seam never bound. */
  commandTrees(): TuiCommandTreesLike | undefined
  /** The bound mediated plugin host, or undefined when the seam never bound. */
  pluginHost(): TuiPluginHostLike | undefined
  /** The bound toast service, or undefined when the seam never bound. */
  toast(): TuiToastLike | undefined
  /** The bound theme registry, or undefined when the seam never bound. */
  themes(): TuiThemesLike | undefined
  /** The bound plugin storage, or undefined when the seam never bound. */
  pluginStorage(): TuiPluginStorageLike | undefined
  /** The bound message observer, or undefined when the seam never bound. */
  messageObserver(): TuiMessageObserverLike | undefined
  /** The bound effect ledger, or undefined when the seam never bound. */
  effectLedger(): TuiEffectLedgerLike | undefined
  /** The bound workspace registry, or undefined when the seam never bound. */
  workspaces(): TuiWorkspacesLike | undefined
  /** The bound prompt slot, or undefined (host-unavailable on every measured build). */
  prompt(): TuiPromptLike | undefined
  /** The bound harness command registry, or undefined when the seam never bound. */
  commands(): CommandsLike | undefined
  /** The bound harness settings provider, or undefined when the seam never bound. */
  settings(): SettingsProviderLike | undefined
  /**
   * The host's own input contact, when the load-time probe bound one.
   *
   * Undefined is a NORMAL outcome (a web/headless composition, a host build without the module, a
   * probe that has not settled yet, or a row-private adapter that never probed). A consumer that
   * needs certainty about WHEN the answer is final subscribes with {@link whenHostInput} instead of
   * polling this member from a render.
   */
  hostInput(): TuiHostInput | undefined
  /**
   * Take the host kit a SCENE render receives (`props.ui`) as the preferred input contact.
   *
   * WHY THIS EXISTS. The module this adapter can import by file URL is not always the instance the
   * running host renders with: MEASURED on dsh-tui 0.12.0, `hostInput()?.useStdin()` answered nothing
   * from inside a status view while the very same call on the kit the host handed a scene resolved the
   * live `StdinContext` value. A kit whose `useStdin` is callable is therefore remembered and
   * PREFERRED; every other value is ignored and the method reports whether it took one.
   *
   * THE CONSEQUENCE, stated plainly: the take-over arms once the host has handed us its kit — i.e.
   * after any MPD scene or panel render in the session — and until then the contact falls back to the
   * probed module, which this host answers with nothing. A consumer must therefore treat "no contact"
   * as normal on a fresh session, and `capabilities().hostInput.kit` says which source is in force.
   * @param kit - the `ui` object a scene component received; anything without a callable `useStdin` is refused.
   * @returns whether the kit was taken.
   */
  rememberHostKit(kit: unknown): boolean
  /**
   * Subscribe to the host contact's settlement.
   *
   * The callback runs EXACTLY ONCE: immediately when the contact is already settled (bound or
   * absent), otherwise at the settle. This is what lets a consumer component attach its listener on
   * a later render instead of racing the probe. The returned disposer cancels a still-waiting
   * subscription and is a no-op afterwards.
   */
  whenHostInput(listener: (input: TuiHostInput | undefined) => void): Disposer
  /** Registers one rich status view (the rich companion of {@link TuiAdapter.setStatus}). */
  registerStatusComponent(view: TuiStatusComponentView): SeamBindingHandle
  /** Registers one full-screen scene. */
  registerScene(descriptor: TuiSceneDescriptor, identity?: unknown): SceneRegistrationHandle
  /** Opens a registered scene; false when the seam is absent or the host does not know the id. */
  openScene(id: string): boolean
  /** Closes a scene; false when this host build exposes no close member. */
  closeScene(id: string): boolean
  /**
   * Publishes one status-line value now (or as soon as the seam binds).
   *
   * `identity` is retained for source compatibility and NOT forwarded: a status registration's
   * identity must be the CALLING ACTIVATION, which this adapter supplies (the bound injected scope),
   * because the host's `assertCallerContext` refuses the consumer's ctx.
   */
  setStatus(key: string, text: string | number | boolean | undefined, identity?: unknown): SeamBindingHandle
  /** Publishes a status line from a renderer, with an optional refresh cadence. */
  registerStatusView(view: TuiStatusView): StatusViewHandle
  /** Registers one transcript renderer for a log-only event type. */
  registerRenderer(type: string, renderer: (payload: unknown) => TuiRenderResult | undefined, identity?: unknown): SeamBindingHandle
  /** Declares the `/settings` section, resolving a lazy section at bind time. */
  registerSettingsSection(section: TuiSettingsSectionLike | TuiSectionResolver, identity?: unknown): SeamBindingHandle
  /** Binds one keyboard combo. */
  registerShortcut(combo: string, options: { description: string; handler: () => void | Promise<void> }, identity?: unknown): SeamBindingHandle
  /** Declares the completion provider of one command root. */
  registerCommandTree(provider: TuiCommandTreeProvider): SeamBindingHandle
  /** Subscribes one mediated decision intercept point. */
  requestDecisionEvent(
    event: string,
    listener: (payload: Record<string, unknown>) => unknown,
    options?: TuiDecisionOptions,
  ): TuiDecisionSubscription
  /** Asks the host's grant facade whether an activation is authorised; undefined when it cannot be asked. */
  grantsAllows(permission: string, scope: string, identity?: unknown): boolean | undefined
  /** Registers one harness command (`/mpd`). */
  registerCommand(definition: TuiCommandDefinition): SeamBindingHandle
  /** Declares one harness settings namespace. */
  registerSettingsNamespace(ns: string, schema: unknown, options?: unknown): SeamBindingHandle
  /** Runs `setup` when one seam binds, handing it the handle to record its own outcome on. */
  whenBound(
    key: TuiSeamKey,
    setup: (service: unknown, scope: PluginContextLike, handle: SeamBindingHandle) => void,
  ): SeamBindingHandle
  /** The outcome of a seam the caller deliberately did NOT activate (a config switch). */
  skipped(key: TuiSeamKey, detail: string): SeamBindingHandle
  /** Which seams this composition exposes, probed at call time. */
  capabilities(): TuiCapabilities
  /** One outcome per seam key, in table order: `available` when bound, `absent` otherwise. */
  seamOutcomes(): readonly SeamOutcome[]
  /** The file sink a consumer's diagnostics fall back to; never throws, never writes a terminal. */
  diagnosticSink(options?: { root?: string | (() => string); name?: string; capBytes?: number }): DiagnosticSink
}

/**
 * Build a row-private adapter over one context.
 *
 * The adapter binds EACH seam with its own deferred inject as soon as it is constructed, so a
 * consumer that resolves this adapter early still receives every registration: a registration
 * made before the seam binds is queued and drained by the binding callback.
 *
 * It writes NOTHING anywhere: the boot lines belong to {@link apply}, so a row-private fallback
 * created inside a unit test — or inside a consumer resolving the mounted adapter — is silent.
 * The ONE exception is the opted-in host-contact probe ({@link TuiAdapterOptions.probeHostContact}),
 * whose absence is reported by ONE line because a missing takeover has no other symptom.
 * @param ctx - the plugin context whose seams are bound.
 * @param options - the host-contact wiring (probe opt-in, an injected contact, the diagnostic sink).
 * @returns the adapter.
 */
export function createTuiAdapter(ctx: PluginContextLike, options: TuiAdapterOptions = {}): TuiAdapter {
  /** One mutable binding record per seam key. */
  const bindings = {} as Record<TuiSeamKey, BindingStatus>
  for (const key of TUI_SEAM_KEYS) bindings[key] = newBindingStatus()

  // ── the per-seam deferred bindings: ONE ctx.inject per seam, never a batch ──
  for (const key of TUI_SEAM_KEYS) {
    /** The service id this seam key resolves to. */
    const id: string = TUI_SEAMS[key]
    /** The binding record, captured so the closure below writes to the right one. */
    const binding = bindings[key]
    bindSeam(ctx, id, binding)
    if (key !== "pluginHost") continue
    // THE ONE PROBE-FIRST SEAM, following the HOST's own rule for this service. The mediated
    // plugin host is composed by dsh-tui before any plugin row applies, and its own documentation
    // exposes it through the soft probe; the deferred inject stays as the fallback for a
    // composition that mounts it later. The probe is only consulted when this context HAS an
    // inject channel at all — otherwise (T4-INERT-1) there is no activation channel, and a probe
    // answering must not manufacture a binding.
    if (binding.bound || !binding.registered) continue
    /** The soft probe's answer, when this context can answer at all. */
    const probed = serviceOf<unknown>(ctx, id)
    if (probed === undefined) continue
    binding.service = probed
    binding.scope = ctx
    binding.bound = true
    /** The work queued before the probe bound the seam. */
    const queued = binding.pending.splice(0)
    for (const work of queued) {
      try {
        work(probed, ctx)
      } catch {
        // Same containment as the inject path: one registration never suppresses its siblings.
      }
    }
  }

  /** The consumer context handed to the host as `identity` when a caller supplies none. */
  const fallbackIdentity: unknown = ctx

  // ── the host contact: probed ONCE here, never on a render path ──────────────────────────────────
  /** The bound host contact, when the caller injected one or the probe finds one. */
  let hostContact: TuiHostInput | undefined = options.hostInput
  /** Where the contact stands right now, sampled by `capabilities()`. */
  let hostState: HostInputState = options.hostInput !== undefined
    // An injected contact SUBSTITUTES for the module import, so the capability read-out names it the
    // same way: it is a caller-supplied hook, not the kit a scene render handed us.
    ? { state: "bound", kit: "probed", detail: "injected by the caller" }
    : options.probeHostContact === true
      ? { state: "pending" }
      : { state: "absent", detail: "this adapter did not probe for the host contact" }
  /** Listeners waiting for the contact; each runs once and is then dropped. */
  const hostWaiters: ((input: TuiHostInput | undefined) => void)[] = []
  /**
   * The `useStdin` hook of the host kit a SCENE render handed us (see `rememberHostKit`).
   *
   * MEASURED on dsh-tui 0.12.0: the module we can import by file URL is NOT the instance the host
   * renders with, so ITS hook answers nothing from inside a status view, while the kit the host
   * itself passes to a scene resolves the live context value. The kit therefore OUTRANKS the probed
   * module wherever both exist.
   */
  let rememberedHook: (() => unknown) | undefined
  /** The host contact in force right now: the remembered kit first, the probed module second. */
  const currentHostInput = (): TuiHostInput | undefined =>
    rememberedHook === undefined ? hostContact : { useStdin: (): unknown => rememberedHook?.() }
  /** Wake every waiter once, handing it the contact in force at that moment. */
  const wakeHostWaiters = (): void => {
    /** The waiters present right now; a listener added later is served immediately instead. */
    const waiting = hostWaiters.splice(0)
    /** The contact this wake hands out, sampled once so every listener sees the same one. */
    const input = currentHostInput()
    for (const listener of waiting) {
      try {
        listener(input)
      } catch {
        // A consumer's listener must never break the probe (or the boot that is waiting on it).
      }
    }
  }
  /** Publish the probe's answer: record it, wake every waiter, and report the outcome once. */
  const settleHostContact = (result: HostInputProbeResult): void => {
    hostContact = result.input
    hostState = result.input === undefined
      ? { state: "absent", ...(result.root === undefined ? {} : { root: result.root }), detail: result.detail ?? "the installed DSH-TUI was not reachable" }
      : { state: "bound", kit: "probed", ...(result.root === undefined ? {} : { root: result.root }), detail: "the host's own useStdin was loaded by file URL" }
    wakeHostWaiters()
    // ONE line, either way: a bound contact is what a QA lane greps for to prove the takeover
    // armed, and an absent one is the only symptom a missing takeover has. It goes to the file sink
    // (never a terminal, R5) and is never allowed to break a boot.
    try {
      ;(options.hostInputLog ?? defaultHostInputLog)(
        result.input === undefined
          ? `[mpd-tui-adapter] host contact ABSENT: ${hostState.detail ?? ""} — the surfaces that need it stay inactive`
          : `[mpd-tui-adapter] host contact bound: ${hostState.root ?? "?"} (${HOST_UI_MODULE})`,
      )
    } catch {
      // A diagnostic must never break a boot.
    }
  }
  if (options.hostInput === undefined && options.probeHostContact === true) {
    // Fire-and-forget: the probe never blocks the boot, and every failure path ends in `absent`.
    void probeHostInput(hostRootCandidates()).then(settleHostContact, (error: unknown) => {
      settleHostContact({ detail: `host contact probe failed: ${String((error as Error)?.message ?? error)}` })
    })
  }

  /** Build a handle over one seam key, with the `absent` detail the vocabulary uses before a bind. */
  const makeHandle = (key: TuiSeamKey, initialDetail?: string): SeamBindingHandle => {
    /** The service id this handle reports on. */
    const id: string = TUI_SEAMS[key]
    /** The measured outcome; `absent` until a bind or a registration changes it. */
    let outcome: SeamOutcome = { id, state: "absent", detail: initialDetail ?? `${id} was not injected` }
    return {
      outcome: () => outcome,
      bound: () => bindings[key].bound,
      record: (recorded: { state: SeamState; detail?: string }) => {
        outcome = recorded.detail === undefined ? { id, state: recorded.state } : { id, state: recorded.state, detail: recorded.detail }
      },
    }
  }

  /**
   * Run `work` now when the seam is bound, otherwise as soon as it binds.
   * @param key - the seam key.
   * @param work - the registration work, receiving the service and the injected scope.
   * @returns whether the work ran immediately.
   */
  const whenBoundInternal = (key: TuiSeamKey, work: (service: unknown, scope: PluginContextLike) => void): boolean => {
    /** The binding record for this seam. */
    const binding = bindings[key]
    if (binding.bound) {
      work(binding.service, binding.scope ?? ctx)
      return true
    }
    binding.pending.push(work)
    return false
  }

  /**
   * Perform one host registration and record its outcome on a handle.
   * @param key - the seam key.
   * @param handle - the handle whose outcome records the result.
   * @param detail - the `requested` detail when the host accepted the call.
   * @param call - the host call, receiving the bound service.
   * @returns nothing; the handle carries the result.
   */
  const register = <T>(
    key: TuiSeamKey,
    handle: SeamBindingHandle,
    detail: string,
    call: (service: T) => void,
  ): void => {
    whenBoundInternal(key, (service) => {
      try {
        call(service as T)
        handle.record({ state: "requested", detail })
      } catch (error) {
        handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
      }
    })
  }

  /** The per-key `requested` detail for a registration whose host exposes no read-back. */
  const requestedDetail = (key: TuiSeamKey, what: string): string => `${what} requested for ${TUI_SEAMS[key]} (no host read-back)`

  /** The adapter this call returns, built over the bindings above. */
  const adapter: TuiAdapter = {
    ctx,
    // ── the typed members: each resolves at CALL time, never a cached snapshot ──
    scenes: () => bindings.scenes.service as TuiScenesLike | undefined,
    status: () => bindings.status.service as TuiStatusLike | undefined,
    renderers: () => bindings.renderers.service as TuiRenderersLike | undefined,
    settingsSections: () => bindings.settingsSections.service as TuiSettingsSectionsLike | undefined,
    shortcuts: () => bindings.shortcuts.service as TuiShortcutsLike | undefined,
    dialogs: () => bindings.dialogs.service as TuiDialogsLike | undefined,
    commandTrees: () => bindings.commandTrees.service as TuiCommandTreesLike | undefined,
    pluginHost: () => bindings.pluginHost.service as TuiPluginHostLike | undefined,
    toast: () => bindings.toast.service as TuiToastLike | undefined,
    themes: () => bindings.themes.service as TuiThemesLike | undefined,
    pluginStorage: () => bindings.pluginStorage.service as TuiPluginStorageLike | undefined,
    messageObserver: () => bindings.messageObserver.service as TuiMessageObserverLike | undefined,
    effectLedger: () => bindings.effectLedger.service as TuiEffectLedgerLike | undefined,
    workspaces: () => bindings.workspaces.service as TuiWorkspacesLike | undefined,
    prompt: () => bindings.prompt.service as TuiPromptLike | undefined,
    commands: () => bindings.commands.service as CommandsLike | undefined,
    settings: () => bindings.settings.service as SettingsProviderLike | undefined,

    /** The host's own input contact, or undefined while it is unprobed / absent. */
    hostInput: (): TuiHostInput | undefined => currentHostInput(),

    /** Takes the host kit a scene render received; see {@link TuiAdapter.rememberHostKit}. */
    rememberHostKit(kit: unknown): boolean {
      /** The kit's own hook, accepted only when it is callable — anything else is ignored. */
      const hook = typeof kit === "object" && kit !== null ? (kit as { useStdin?: unknown }).useStdin : undefined
      if (typeof hook !== "function") return false
      /** Whether this call is the FIRST to bind a kit (the only case that earns a diagnostic line). */
      const first = rememberedHook === undefined
      rememberedHook = hook as () => unknown
      hostState = { state: "bound", kit: "remembered", detail: "the host's own ui kit (handed to a scene render) carries useStdin" }
      // THE WAKE IS DEFERRED BY ONE MICROTASK. `rememberHostKit` runs INSIDE a scene's React render,
      // and waking a status view synchronously would call another component's setState from that
      // render — exactly what React forbids. A microtask lands after the render's commit.
      void Promise.resolve().then(wakeHostWaiters)
      if (!first) return true
      try {
        ;(options.hostInputLog ?? defaultHostInputLog)(`[mpd-tui-adapter] host contact bound: remembered kit (a scene render handed us the host ui kit)`)
      } catch {
        // A diagnostic must never break a boot.
      }
      return true
    },

    /** Wakes `listener` once, now when the contact is already settled, else at the settle. */
    whenHostInput(listener: (input: TuiHostInput | undefined) => void): Disposer {
      // A listener that throws is contained on BOTH paths: it must never break the probe dispatch
      // (which runs inside the adapter's promise chain) nor the caller's render.
      if (hostState.state !== "pending") {
        try {
          listener(currentHostInput())
        } catch {
          // The listener's own failure is not the adapter's to propagate.
        }
        return () => {}
      }
      hostWaiters.push(listener)
      return () => {
        /** The index of the still-waiting listener; -1 when it already ran. */
        const at = hostWaiters.indexOf(listener)
        if (at >= 0) hostWaiters.splice(at, 1)
      }
    },

    /** Registers one rich status view: an empty Box costs no rows while still mounting. */
    registerStatusComponent(view: TuiStatusComponentView): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("status")
      whenBoundInternal("status", (service, scope) => {
        /** The bound status service, before its rich form is trusted. */
        const status = service as TuiStatusLike
        if (typeof status?.registerView !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.registerView is missing on this host build` })
          return
        }
        // The host validates the key grammar, requires an integer 1..3, refuses a duplicate key and
        // enforces a six-row aggregate budget; a refusal is `undefined`, never a throw.
        try {
          /** The host's handle for this view, absent when the host refused the registration. */
          const disposer = status.registerView(
            {
              key: view.key,
              component: view.component,
              ...(view.maxRows === undefined ? {} : { maxRows: view.maxRows }),
            },
            // THE IDENTITY IS THE CALLING ACTIVATION, NOT THE CONSUMER'S CTX. The host runs
            // `assertCallerContext(caller, identity, …)` and the caller it sees is the service shadow
            // bound to THIS injected scope, so a consumer's ctx is a different fiber and every
            // registration is refused (MEASURED on dsh-tui 0.12.0: `registerView` returned undefined
            // for one fresh key with no identity, with `view.identity`, and with the consumer ctx —
            // and returned a real disposer when the bound scope was passed). `view.identity` is kept
            // in the consumer API for source compatibility only; it is deliberately NOT forwarded.
            scope,
          )
          if (typeof disposer !== "function") {
            handle.record({ state: "refused", detail: `the host refused view ${view.key} (see its own warning for the reason)` })
            return
          }
          effectOn(scope, disposer, view.label ?? `mpd-tui status view ${view.key}`)
          handle.record({ state: "requested", detail: `view ${view.key} requested (no host read-back)` })
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return handle
    },

    /** Registers one full-screen scene; the handle also opens and closes it. */
    registerScene(descriptor: TuiSceneDescriptor, identity?: unknown): SceneRegistrationHandle {
      /** The registration's handle. */
      const handle = makeHandle("scenes")
      whenBoundInternal("scenes", (service) => {
        /** The bound scene registry, before `register` is trusted. */
        const registry = service as TuiScenesLike
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.scenes}.register is missing` })
          return
        }
        try {
          /** The host's handle; a refusal is a no-op disposer, never proof of registration. */
          const disposer = registry.register(descriptor, identity ?? fallbackIdentity)
          if (typeof disposer === "function") effectOn(bindings.scenes.scope ?? ctx, disposer, `mpd-tui scene ${descriptor.id}`)
          handle.record({ state: "requested", detail: `${descriptor.id} requested (no host read-back)` })
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return {
        outcome: handle.outcome,
        bound: handle.bound,
        record: handle.record,
        openScene: (id: string) => adapter.openScene(id),
        closeScene: (id: string) => adapter.closeScene(id),
      }
    },

    /** Opens a registered scene; false when the seam is absent or the id is unknown. */
    openScene(id: string): boolean {
      /** The bound scene registry, absent when the seam never bound. */
      const registry = bindings.scenes.service as TuiScenesLike | undefined
      if (registry === undefined || typeof registry.open !== "function") return false
      try {
        return registry.open(id) === true
      } catch {
        return false
      }
    },

    /** Closes a scene; false when this host build exposes no close member. */
    closeScene(id: string): boolean {
      /** The bound scene registry, absent when the seam never bound. */
      const registry = bindings.scenes.service as TuiScenesLike | undefined
      if (registry === undefined || typeof registry.close !== "function") return false
      try {
        return registry.close(id) === true
      } catch {
        return false
      }
    },

    /** Publishes one status value now, or as soon as the seam binds. */
    setStatus(key: string, text: string | number | boolean | undefined, identity?: unknown): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("status")
      whenBoundInternal("status", (service, scope) => {
        /** The bound status service, before `set` is trusted. */
        const status = service as TuiStatusLike
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` })
          return
        }
        try {
          // THE IDENTITY IS THE CALLING ACTIVATION (the bound injected scope), never the consumer's
          // ctx: the host's `assertCallerContext` compares it against the caller it resolved for THIS
          // activation and refuses anything else — which is why the keyed STATUS LINE never rendered
          // on dsh-tui 0.12.0 (MEASURED). The `identity` parameter is kept for source compatibility
          // only and is deliberately NOT forwarded; see `registerStatusComponent` for the full rule.
          /** The host's contribution handle, owned for cleanup only. */
          const disposer = status.set(key, text, scope)
          if (typeof disposer === "function") effectOn(bindings.status.scope ?? ctx, disposer, `mpd-tui status ${key}`)
          handle.record({
            state: "requested",
            detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated",
          })
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return handle
    },

    /** Publishes a status line from a renderer, with an optional refresh cadence. */
    registerStatusView(view: TuiStatusView): StatusViewHandle {
      /** The view's handle. */
      const handle = makeHandle("status")
      /** Publishes the current line on demand; a no-op until the seam is active. */
      let refresh: () => void = (): void => {}
      whenBoundInternal("status", (service, scope) => {
        /** The bound status service, before `set` is trusted. */
        const status = service as TuiStatusLike
        if (typeof status?.set !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.status}.set is missing` })
          return
        }
        /** The host's handle for the current contribution, replaced on every publish. */
        let disposer: Disposer | undefined
        /** The cadence timer, absent in the manual (`intervalMs` 0) mode. */
        let timer: ReturnType<typeof setInterval> | undefined
        /** The text last handed to the host, so an identical line is not republished. */
        let published: string | number | boolean | undefined
        /** Recomputes the line and publishes it only when it changed. */
        const publish = (): void => {
          try {
            /** The rendered status text, built by the consumer's own renderer. */
            const text = view.render()
            // Only publish a CHANGED line: the host records every set() as a `replace status`
            // ledger effect, so a fixed-cadence republish would churn the ledger for an
            // identical string.
            if (text === published) return
            published = text
            // The consumer's context is the contribution's identity, so the effect ledger
            // attributes it to the activating row.
            // Same identity rule as `setStatus`: the bound injected scope IS the calling activation.
            disposer = status.set(view.key, text, scope)
          } catch (error) {
            view.onError?.(error)
          }
        }
        publish()
        /** The configured cadence; 0 or a negative value keeps the view manual. */
        const intervalMs = typeof view.intervalMs === "number" ? view.intervalMs : 0
        if (intervalMs > 0) {
          try {
            timer = setInterval(publish, intervalMs)
            // Never keep the host process alive for a status line.
            ;(timer as unknown as { unref?: () => void }).unref?.()
          } catch {
            timer = undefined
          }
        }
        effectOn(
          scope,
          () => {
            if (timer !== undefined) {
              try {
                clearInterval(timer)
              } catch {
                // already cleared
              }
              timer = undefined
            }
            try {
              disposer?.()
            } catch {
              // best effort
            }
            try {
              // The clearing write carries the same activation identity as the publish above.
              status.set(view.key, undefined, scope)
            } catch {
              // best effort
            }
          },
          view.label ?? `mpd-tui status ${view.key}`,
        )
        refresh = publish
        handle.record({
          state: "requested",
          detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated",
        })
      })
      return { outcome: handle.outcome, bound: handle.bound, record: handle.record, refresh: () => refresh() }
    },

    /** Registers one transcript renderer for a log-only event type. */
    registerRenderer(type: string, renderer: (payload: unknown) => TuiRenderResult | undefined, identity?: unknown): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("renderers")
      whenBoundInternal("renderers", (service) => {
        /** The bound renderer registry, before `register` is trusted. */
        const registry = service as TuiRenderersLike
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.renderers}.register is missing` })
          return
        }
        try {
          /** The host's handle; a refusal is a no-op disposer, never proof of registration. */
          const disposer = registry.register(type, renderer, identity ?? fallbackIdentity)
          if (typeof disposer === "function") effectOn(bindings.renderers.scope ?? ctx, disposer, `mpd-tui renderer ${type}`)
          handle.record({
            state: "requested",
            detail: `${type} requested (no host read-back; a refusal also returns a disposer)`,
          })
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return handle
    },

    /** Declares the settings section, resolving a lazy section at bind time. */
    registerSettingsSection(section: TuiSettingsSectionLike | TuiSectionResolver, identity?: unknown): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("settingsSections")
      whenBoundInternal("settingsSections", (service) => {
        /** The bound section registry, before `register` is trusted. */
        const registry = service as TuiSettingsSectionsLike
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.settingsSections}.register is missing` })
          return
        }
        /** Register the resolved section; the host freezes a `select` field's options here. */
        const commit = (resolved: TuiSettingsSectionLike): void => {
          try {
            registry.register(resolved)
            handle.record({
              state: "requested",
              detail: `section ${resolved.ns} requested (no host read-back)`,
            })
          } catch (error) {
            handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
          }
        }
        if (typeof section !== "function") {
          commit(section)
          return
        }
        // THE LAZY FORM: a caller that derives the section from an asynchronous read (the model
        // catalog behind the slot options) resolves it AFTER the seam bound, which is what keeps
        // the read from racing the host's frozen option list.
        handle.record({ state: "requested", detail: "section requested (awaiting the lazy section resolver)" })
        try {
          Promise.resolve(section()).then(commit, (error: unknown) => {
            handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
          })
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return handle
    },

    /** Binds one keyboard combo. */
    registerShortcut(combo: string, options: { description: string; handler: () => void | Promise<void> }, identity?: unknown): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("shortcuts")
      whenBoundInternal("shortcuts", (service) => {
        /** The bound shortcut registry, before `register` is trusted. */
        const registry = service as TuiShortcutsLike
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.shortcuts}.register is missing` })
          return
        }
        try {
          /** The host's handle; a REFUSED combo also returns a no-op disposer. */
          const disposer = registry.register(combo, options, identity ?? fallbackIdentity)
          if (typeof disposer === "function") effectOn(bindings.shortcuts.scope ?? ctx, disposer, `mpd-tui shortcut ${combo}`)
          handle.record({ state: "requested", detail: `${combo} requested` })
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return handle
    },

    /** Declares the completion provider of one command root. */
    registerCommandTree(provider: TuiCommandTreeProvider): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("commandTrees")
      register("commandTrees", handle, requestedDetail("commandTrees", `provider for /${provider.root}`), (service: TuiCommandTreesLike) => {
        if (typeof service?.register !== "function") throw new Error(`${TUI_SEAMS.commandTrees}.register is missing`)
        /** The host's handle, owned for cleanup; a refused provider also returns one. */
        const disposer = service.register(provider)
        if (typeof disposer === "function") effectOn(bindings.commandTrees.scope ?? ctx, disposer, `mpd-tui command tree ${provider.root}`)
      })
      return handle
    },

    /** Subscribes one mediated decision intercept point. */
    requestDecisionEvent(
      event: string,
      listener: (payload: Record<string, unknown>) => unknown,
      options: TuiDecisionOptions = {},
    ): TuiDecisionSubscription {
      /** Whether the bound host carries the mediated subscription member. */
      let supported = false
      /** The grant facade's answer; undefined when it could not be asked. */
      let granted: boolean | undefined
      /** Whether the host returned a disposer. */
      let disposerReturned = false
      /** The failure message of a throwing call; absent when nothing threw. */
      let error: string | undefined
      /** The subscription's outcome, rewritten when the seam binds. */
      let outcome: SeamOutcome = { id: TUI_SEAMS.pluginHost, state: "absent", detail: `${TUI_SEAMS.pluginHost} was not injected` }

      whenBoundInternal("pluginHost", (service, scope) => {
        /** The bound mediated host, before any of its members is trusted. */
        const host = service as TuiPluginHostLike
        /** The consumer context handed to the host as the activation identity. */
        const identity = options.identity ?? fallbackIdentity
        if (typeof host?.subscribeDecision !== "function") {
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `${TUI_SEAMS.pluginHost}.subscribeDecision is missing` }
          return
        }
        supported = true
        // The grant facade is the honest authorization state and is read FIRST, exactly as the
        // caller-facing contract states it; undefined means the host cannot be asked, in which
        // case nothing may be reported as confirmed.
        try {
          /** The caller-safe grant facade, when the host exposes one. */
          const facade = host.grants
          if (facade !== undefined && typeof facade.allows === "function") granted = facade.allows(identity, event, options.scope ?? event) === true
        } catch {
          granted = undefined
        }
        try {
          /** The host's handle; a refusal returns a no-op disposer, never called as a probe. */
          const disposer = host.subscribeDecision(identity, event, listener, {
            ...(options.scope === undefined ? {} : { scope: options.scope }),
            ...(options.order === undefined ? {} : { order: options.order }),
          })
          disposerReturned = typeof disposer === "function"
          if (disposerReturned) effectOn(scope, disposer as Disposer, `mpd-tui decision ${event}`)
        } catch (caught) {
          error = String((caught as Error)?.message ?? caught).replace(/\s+/gu, " ").trim().slice(0, 160)
          disposerReturned = false
        }
        if (error !== undefined) outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: error }
        else if (!disposerReturned) outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: "subscribeDecision returned no disposer" }
        else if (granted === true) outcome = { id: TUI_SEAMS.pluginHost, state: "confirmed", detail: `${event} subscribed and authorised` }
        else if (granted === false) outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `no grant for ${event}` }
        else outcome = { id: TUI_SEAMS.pluginHost, state: "requested", detail: "grant state not queryable in this composition" }
      })

      return {
        supported: () => supported,
        granted: () => granted,
        disposerReturned: () => disposerReturned,
        error: () => error,
        outcome: () => outcome,
      }
    },

    /** Asks the host grant facade whether an activation is authorised. */
    grantsAllows(permission: string, scope: string, identity?: unknown): boolean | undefined {
      /** The bound mediated host, absent when the seam never bound. */
      const host = bindings.pluginHost.service as TuiPluginHostLike | undefined
      try {
        /** The caller-safe grant facade, when the host exposes one. */
        const facade = host?.grants
        if (facade === undefined || typeof facade.allows !== "function") return undefined
        return facade.allows(identity ?? fallbackIdentity, permission, scope) === true
      } catch {
        return undefined
      }
    },

    /** Registers the harness command this plane owns. */
    registerCommand(definition: TuiCommandDefinition): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("commands")
      register("commands", handle, `/${definition.name} requested (no host read-back at apply time)`, (service: CommandsLike) => {
        if (typeof service?.register !== "function") throw new Error(`${TUI_SEAMS.commands}.register is missing`)
        /** The host's handle, owned for cleanup. */
        const disposer = service.register(definition)
        if (typeof disposer === "function") effectOn(bindings.commands.scope ?? ctx, disposer, `mpd-tui command /${definition.name}`)
      })
      return handle
    },

    /** Declares one harness settings namespace. */
    registerSettingsNamespace(ns: string, schema: unknown, options?: unknown): SeamBindingHandle {
      /** The registration's handle. */
      const handle = makeHandle("settings")
      register("settings", handle, `namespace ${ns} requested (no host read-back)`, (service: SettingsProviderLike) => {
        if (typeof service?.register !== "function") throw new Error(`${TUI_SEAMS.settings}.register is missing`)
        service.register(ns, schema, options)
      })
      return handle
    },

    /** Runs a setup when one seam binds, handing it the handle to record its outcome on. */
    whenBound(
      key: TuiSeamKey,
      setup: (service: unknown, scope: PluginContextLike, handle: SeamBindingHandle) => void,
    ): SeamBindingHandle {
      /** The binding's handle, created BEFORE the callback so an immediate bind cannot hit a TDZ. */
      const handle = makeHandle(key)
      whenBoundInternal(key, (service, scope) => {
        handle.record({ state: "available", detail: "bound through the deferred inject form" })
        setup(service, scope, handle)
      })
      return handle
    },

    /** The outcome of a seam the caller deliberately did not activate. */
    skipped(key: TuiSeamKey, detail: string): SeamBindingHandle {
      /** The skipped seam's handle: `absent` with the caller's reason. */
      const handle = makeHandle(key, detail)
      return handle
    },

    /** Which seams this composition exposes, probed at call time. */
    capabilities(): TuiCapabilities {
      /** One boolean per seam key, sampled now. */
      const seams = {} as Record<TuiSeamKey, boolean>
      /** How many seams answered true. */
      let bound = 0
      for (const key of TUI_SEAM_KEYS) {
        /** Whether this seam is bound right now. */
        const live = bindings[key].bound
        seams[key] = live
        if (live) bound += 1
      }
      return { seams, bound, total: TUI_SEAM_KEYS.length, hostInput: { ...hostState } }
    },

    /** One outcome per seam key, in table order: `available` when bound, `absent` otherwise. */
    seamOutcomes(): readonly SeamOutcome[] {
      return TUI_SEAM_KEYS.map((key) => {
        /** The binding record for this seam. */
        const binding = bindings[key]
        /** The service id this entry reports on. */
        const id: string = TUI_SEAMS[key]
        if (binding.bound) return { id, state: "available" as const, detail: "bound through the deferred inject form" }
        if (binding.error !== undefined) return { id, state: "refused" as const, detail: binding.error }
        return { id, state: "absent" as const, detail: "not composed in this profile" }
      })
    },

    /** The file sink a consumer's diagnostics fall back to; the fs work lives HERE, not in consumers. */
    diagnosticSink(options: { root?: string | (() => string); name?: string; capBytes?: number } = {}): DiagnosticSink {
      // The sink is created per call and cached by its resolved root, so a consumer that logs on a
      // render path pays one string join per line and never rebuilds the sink.
      /** The resolved root this sink writes under: the caller's, else DSH_WORKSPACE_ROOT/cwd. */
      const root = options.root ?? defaultLogRoot
      return createFileSink({
        root,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.capBytes === undefined ? {} : { capBytes: options.capBytes }),
      })
    },
  }

  return adapter
}

// ── the mounted service and its resolution helpers ──────────────────────────────────────────────

/** Service name other rows resolve with `ctx.get("mpdTui")`. */
export const SERVICE_NAME = "mpdTui"

/**
 * The mounted adapter when this composition provides one, else a row-private fallback.
 *
 * THE ONE RESOLUTION EVERY ROW USES — the DSH plane's `resolveDshAdapter` counterpart. The eager
 * read is deliberate: a row that both REGISTERS through the adapter and CALLS it later must get
 * the same instance both times, and a lazily re-resolved proxy would send its later calls to an
 * adapter that never saw the registrations.
 *
 * This never throws: a ctx whose `get` is broken (a scoped proxy, a test double) falls back.
 * @param ctx - the plugin context.
 * @returns the mounted adapter, or a row-private one over the same ctx.
 */
export function resolveTuiAdapter(ctx: PluginContextLike): TuiAdapter {
  /** The ctx's own `get`, captured so it is called with the ctx as its receiver. */
  const get = ctx !== undefined && ctx !== null && typeof ctx.get === "function" ? ctx.get : undefined
  if (get !== undefined) {
    try {
      /** The mounted adapter when one is provided and ACTIVE, else undefined. */
      const mounted = get.call(ctx, SERVICE_NAME)
      if (mounted !== undefined && mounted !== null) return mounted as TuiAdapter
    } catch {
      // A ctx that cannot answer is a miss, never a crash.
    }
  }
  return createTuiAdapter(ctx)
}

/** Options for {@link createLazyTuiAdapter}: the row label and an optional warning sink. */
export interface LazyTuiAdapterOptions {
  /** Row label used in the one-line warning (e.g. "mpd-tui"). */
  label: string
  /** Warning sink; defaults to the file sink, because a TUI boot has no terminal to spare. */
  warn?: (line: string) => void
}

/**
 * Resolve `mpdTui` LAZILY on every member use instead of once at apply.
 *
 * The T-50 shape: the loader applies sibling rows CONCURRENTLY, so a provider whose fiber is not
 * ACTIVE yet answers `undefined` — and an eager resolution would hand that row a private adapter
 * for the whole session. The proxy re-probes on every member read and warns ONCE when it has to
 * fall back, which is the diagnosable case (a row mounted ABOVE the adapter row).
 * @param ctx - the plugin context.
 * @param options - the row label and the warning sink.
 * @returns an adapter-shaped proxy over whichever instance is current at call time.
 */
export function createLazyTuiAdapter(ctx: unknown, options: LazyTuiAdapterOptions): TuiAdapter {
  /** The row-private fallback, created at most once so its own seam bindings are not duplicated. */
  let fallback: TuiAdapter | undefined
  /** Whether the fallback warning was already emitted (one line per row, not per member read). */
  let warned = false
  /** Resolve the adapter this call must use. */
  const resolve = (): TuiAdapter => {
    /** The ctx's own `get`, captured so it is called with the ctx as its receiver. */
    const get = (ctx as PluginContextLike | undefined)?.get
    if (typeof get === "function") {
      try {
        /** The mounted adapter when one is provided and ACTIVE, else undefined. */
        const mounted = get.call(ctx, SERVICE_NAME)
        if (mounted !== undefined && mounted !== null) return mounted as TuiAdapter
      } catch {
        // Fall through to the row-private adapter.
      }
    }
    if (fallback === undefined) fallback = createTuiAdapter(ctx as PluginContextLike)
    if (!warned) {
      warned = true
      /** The one-line warning every fallback branch emits. */
      const line = `[${options.label}] TUI ADAPTER FALLBACK: ${SERVICE_NAME} is not provided in this composition; this row runs on a`
        + " row-private adapter (the one-contact-surface rule, AGENTS.md §6). This boot keeps working, which is exactly why the"
        + " branch is loud — fix the ROW ORDER (this row must sit BELOW mpd-tui-adapter)."
      if (typeof options.warn === "function") options.warn(line)
      else {
        try {
          createFileSink({ root: defaultLogRoot }).write(line)
        } catch {
          // A diagnostic must never break a boot.
        }
      }
    }
    return fallback
  }
  return new Proxy({} as TuiAdapter, {
    /** Resolve one member through the current adapter, binding methods so their receiver stays correct. */
    get(_target: TuiAdapter, property: string | symbol): unknown {
      /** The resolved adapter viewed as a plain record for the member read. */
      const impl = resolve() as unknown as Record<PropertyKey, unknown>
      /** The member at that key, bound below when it is a method. */
      const value = impl[property as keyof typeof impl]
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(impl) : value
    },
    /** Report a member as present only when the current adapter actually carries it. */
    has(_target: TuiAdapter, property: string | symbol): boolean {
      return property in (resolve() as unknown as Record<PropertyKey, unknown>)
    },
  })
}

/**
 * Provide the adapter as the `mpdTui` service, and write the ONE stable boot line to the FILE sink.
 *
 * The line is deliberately a snapshot-free statement: the loader applies sibling rows
 * concurrently, so a capability snapshot taken here would under-report. `capabilities()` and
 * `seamOutcomes()` are the authority, read at use time. Nothing here writes to fd 1 or fd 2 —
 * a DSH-TUI session owns the alternate screen, and the seam inventory is meant to be read from
 * the log file by a QA lane (requirement R5).
 * @param ctx - the plugin context.
 * @param config - `quiet` silences the boot lines; `logRoot` overrides the diagnostic root.
 */
export function apply(
  ctx: PluginContextLike,
  config: { quiet?: boolean; logRoot?: string | (() => string) } = {},
): void {
  /** The adapter instance every later `ctx.get("mpdTui")` resolves. */
  // THIS is the one construction that probes for the host contact: the mounted row owns the single
  // load-time reach into the installed DSH-TUI, and a row-private fallback adapter stays silent.
  const adapter = createTuiAdapter(ctx, { probeHostContact: true })
  try {
    /** The context's `provide`, when this composition exposes one. */
    const provide = (ctx as { provide?: unknown }).provide
    if (typeof provide === "function") (provide as (name: string, value: unknown) => void).call(ctx, SERVICE_NAME, adapter)
  } catch {
    // A ctx that cannot provide still gets a working row-private adapter for its own consumers.
  }
  if (config.quiet === true) return
  try {
    /** The sink the adapter's own boot lines are written to. */
    const sink = createFileSink({ root: config.logRoot ?? defaultLogRoot })
    sink.write(`[mpd-tui-adapter] ${SERVICE_NAME} provided (one deferred inject per seam, inject-free row)`)
    sink.write(`TUI_SEAMS=${TUI_SEAM_KEYS.filter((key) => adapter.capabilities().seams[key]).map((key) => TUI_SEAMS[key]).join(",") || "(none composed)"}`)
  } catch {
    // A diagnostic must never fail a boot; the capability readout is the authority anyway.
  }
}
