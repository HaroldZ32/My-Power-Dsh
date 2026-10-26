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
// WRAPPED SEAMS (15 `tui*` services — the fourteen present since 0.12.0 plus the sidebar panel
// registry 0.13.0 added — plus `tuiPrompt`, the harness `commands` registry and the harness
// `settings` provider): see {@link TUI_SEAMS} for the single-source id table.
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
  /**
   * The sidebar panel registry — the sanctioned panel seam, ADDED BY dsh-tui 0.13.0.
   *
   * Its absence is not a failure but the version discriminator the legacy Ctrl+A host-input contact
   * arms on (see {@link TuiAdapter.panelSeamBound}).
   */
  panels: "tuiPanels",
  /**
   * The prompt-slot seam — a PHANTOM id: no dsh-tui build measured through 0.15.0 declares a
   * `tuiPrompt` service (a grep of the host's own `lib/**` finds none), so it stays in the table
   * ONLY so the inventory reports its absence explicitly instead of hiding it. See
   * {@link PHANTOM_SEAM_KEYS}.
   */
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
  "panels",
  "prompt",
  "commands",
  "settings",
]

/**
 * The seam ids NO measured host build provides — declared so the inventory can name their absence.
 *
 * A phantom seam is different from an absent one: an absent seam is missing from THIS composition,
 * while a phantom id is missing from EVERY host build (measured: `tuiPrompt` appears in no dsh-tui
 * `lib/**` declaration through 0.15.0). It stays in {@link TUI_SEAMS} because the aggregate
 * diagnostic prints one term per key in table order, and dropping the id would silently change that
 * contract; {@link TuiAdapter.seamOutcomes} reports it with this reason instead of a composition gap.
 */
export const PHANTOM_SEAM_KEYS: readonly TuiSeamKey[] = ["prompt"]

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
 * eighteen times.
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

// ── the SECOND host-internals contact: the live side-panel ENABLE list ──────────────────────────
//
// WHY A SECOND CONTACT IS UNAVOIDABLE, and which two contacts §6 counts. The host's sidebar paints a
// panel only when that panel's final id is in the `dsh-tui.sidePanel.panels` CSV, and that CSV lives
// in a module-level live setting inside the host package (`lib/types/tuiDisplayPrefs.js`) that NO
// seam exposes. MEASURED against the installed 0.13.0 host on a real PTY (evidence
// `evidence/dag/dag-edges-scroll/panel-visibility/20261006T145907Z/`, the probe's `CHANGE` records):
//   * +1056 ms — the host's OWN `tuiPanels.register` appends every successfully registered id
//     (`enablePanelIdInStore` in `lib/types/dsh-adapter/panels.js`), so the CSV becomes
//     `todo,jobs,agents,<id>,<id>,<id>`;
//   * +5403 ms — the `dsh-tui` row's apply path RE-APPLIES THE CONFIG value
//     (`applySidePanelPanels(config.sidePanel?.panels)` in `lib/types/dsh-adapter/plugin.js`,
//     reached through `Fiber._reload`), rewriting the CSV to the schema default `todo,jobs,agents`
//     and dropping all three ids — the sidebar then paints the host's three builtins only, which is
//     the reported defect (「只有任务/待办/代理」).
// The append is therefore TRANSIENT and nothing in the seam surface can make it stick, which is why
// this package — the ONE file allowed to reach host internals (§6) — carries the re-assert.
//
// SO THIS PACKAGE NOW HOLDS EXACTLY TWO host-internals contacts, and §6 counts that class on purpose
// so a new one cannot hide:
//   1. the `dashboard` contact — `<root>/lib/types/ui.js`'s `useStdin`, by absolute file URL since
//      0.12.0 ({@link probeHostInput}, {@link HOST_UI_MODULE}); and
//   2. THIS one — `<root>/lib/types/tuiDisplayPrefs.js`'s `getSidePanelPanels` /
//      `applySidePanelPanels` ({@link HOST_PREFS_MODULE}, {@link probeHostPrefs}).
// A THIRD contact must not be added without moving that count.
//
// The import goes through an ABSOLUTE FILE URL for the reason contact 1 already documents: the
// host's `exports` map has no `./lib/*` subpath, and Node caches ESM by resolved URL — which is also
// what guarantees this is the SAME store instance the host itself writes. A second instance would be
// its own empty list, and every read would answer the default while the real sidebar kept its own.

/** The host module owning the live side-panel enable CSV, relative to a host package root. */
export const HOST_PREFS_MODULE = "lib/types/tuiDisplayPrefs.js"

/** The host's live display-preference store, as the keeper uses it (one read, one write, one feed). */
export interface TuiHostPrefsLike {
  /** The enable CSV as it stands right now; anything at all, narrowed by the merge. */
  getSidePanelPanels(): unknown
  /** Applies one CSV and returns the value the store ended up holding. */
  applySidePanelPanels(value: unknown): unknown
  /**
   * The store's OWN change feed, when this host build exposes one.
   *
   * OPTIONAL BY MEASUREMENT, not by taste: the host's live setting notifies its listeners only when an
   * apply CHANGES the value, which is exactly the signal this bundle needs — a rewrite by the host's own
   * configuration mirror is observable here and nowhere in the seam surface. A build without the feed
   * keeps the bounded ladder below, so no composition loses the repair.
   * @param listener - called with no arguments whenever the stored CSV changes.
   * @returns the host's own unsubscribe, or undefined when the store returns none.
   */
  subscribeSidePanelPanels?(listener: () => void): unknown
}

/** What one enable-list contact probe found. */
export interface HostPrefsProbeResult {
  /** The host store, when a candidate exported both members as functions. */
  prefs?: TuiHostPrefsLike
  /** The host root the store was loaded from. */
  root?: string
  /**
   * The installed host package's own version, read from the SAME root the store bound ({@link
   * readHostPackageVersion}), for the C2 self-heal gate: a host at or past
   * {@link PANEL_CSV_SELF_HEAL_SINCE} unions registered ids back into the enable CSV itself, so the
   * enable-list keeper stands down instead of racing it. ABSENT (or empty, or unparseable) leaves the
   * keeper in its legacy behaviour — the degrade-safe half of the pair, never a guess.
   */
  hostVersion?: string
  /**
   * The host's CURRENT default enable list, read from the SAME module contact and normalized.
   *
   * It is the target the stale-default migration ({@link mergePanelEnableIds}) is defined against, so
   * it is read live and never hardcoded. ABSENT means this host build exposes no usable
   * `DEFAULT_SIDE_PANEL_IDS`; the migration is then inert and the plain merge path is unchanged.
   */
  defaultIds?: string
  /** The ONE reason no contact bound, when none did. */
  detail?: string
}

/**
 * Load the host's live display-preference store from the FIRST candidate that carries it.
 *
 * VERSION-GATED exactly like {@link probeHostInput}: an install that merely exists is not a contact,
 * a candidate whose module lacks EITHER member is a version-skew host, and an import that throws is
 * skipped. Every failure is a MISS carried back as a reason — never a throw, never a silent success.
 * A host without this module leaves the keeper `absent`, which is a LEGAL outcome: the panel is then
 * reachable only by enabling it by hand under `/settings`, exactly as before this contact existed.
 * @param candidates - the candidate host roots, in probe order.
 * @returns the bound store plus its root, or the ONE reason no contact bound.
 */
export async function probeHostPrefs(candidates: readonly string[]): Promise<HostPrefsProbeResult> {
  /** The last candidate that existed but could not provide the store, for the one-line reason. */
  let skew = ""
  if (candidates.length === 0) return { detail: `no candidate host root (no DSH profile carries ${HOST_PACKAGE_PATH.join("/")})` }
  for (const root of candidates) {
    /** The host module file this candidate would be loaded from. */
    const file = join(root, HOST_PREFS_MODULE)
    try {
      if (!statSync(file).isFile()) continue
    } catch {
      // Not this candidate; an unreadable path is a miss, never an error.
      continue
    }
    try {
      /** The host module namespace, loaded from this candidate by absolute file URL. */
      const mod = (await import(pathToFileURL(file).href)) as { getSidePanelPanels?: unknown; applySidePanelPanels?: unknown; subscribeSidePanelPanels?: unknown; DEFAULT_SIDE_PANEL_IDS?: unknown }
      if (typeof mod.getSidePanelPanels !== "function" || typeof mod.applySidePanelPanels !== "function") {
        skew = `${file} carries no getSidePanelPanels/applySidePanelPanels pair`
        continue
      }
      /** The host's reader, called with no receiver so a `this`-dependent export stays its own. */
      const read = mod.getSidePanelPanels as () => unknown
      /** The host's writer, called the same way. */
      const write = mod.applySidePanelPanels as (value: unknown) => unknown
      /** The host's change feed, when this build exports one. */
      const feed = typeof mod.subscribeSidePanelPanels === "function" ? (mod.subscribeSidePanelPanels as (listener: () => void) => unknown) : undefined
      // THE HOST'S OWN CURRENT DEFAULT comes from the SAME module contact as the store, never from a
      // constant in this bundle: it is the migration's target, so a host release that moves its default
      // must move this rule with it or the rule would restore a list the host no longer ships. A build
      // whose export is missing, of another type, or empty leaves the field ABSENT — the migration is
      // then inert, which is the safe half of the pair (see {@link stalePanelDefaultResidue}).
      /** The host's current default enable list, normalized and in the host's own order. */
      const hostDefault = normalizePanelCsv(typeof mod.DEFAULT_SIDE_PANEL_IDS === "string" ? mod.DEFAULT_SIDE_PANEL_IDS : "")
      return {
        prefs: {
          getSidePanelPanels: (): unknown => read(),
          applySidePanelPanels: (value: unknown): unknown => write(value),
          // Wrapped rather than forwarded: the host's `subscribe` returns a bare unsubscribe closure,
          // and a build that returned something else must degrade to "no way to unsubscribe" instead of
          // handing the keeper a value it would try to call.
          ...(feed === undefined ? {} : { subscribeSidePanelPanels: (listener: () => void): unknown => feed(listener) }),
        },
        root,
        // C2: the version rides the SAME probe answer the keeper decides from, so the gate is a fact
        // about the very host the store bound — not a second read that could name another candidate.
        hostVersion: readHostPackageVersion(root),
        ...(hostDefault === "" ? {} : { defaultIds: hostDefault }),
      }
    } catch (error) {
      skew = `${file}: ${String((error as Error)?.message ?? error)}`
    }
  }
  return { detail: skew.length > 0 ? skew : `no candidate carried a readable ${HOST_PREFS_MODULE} (${candidates.length} probed)` }
}

/** One merge of the host's live enable CSV with the ids this activation registered. */
export interface PanelEnableMerge {
  /**
   * The CSV to apply: the user's list in its ORIGINAL order, then every missing id, in OUR order.
   *
   * ON A MIGRATION IT IS THE MIGRATION TARGET INSTEAD — the host's current default in the host's own
   * order, then our ids in registration order — because the list it replaces is a stale schema default
   * rather than a position anybody took; see {@link staleDefault}.
   */
  csv: string
  /** The ids that were missing and are therefore appended; empty means "nothing to append". */
  added: readonly string[]
  /** The ids that were already enabled. */
  present: readonly string[]
  /** The user's tokens this merge KEEPS, in their original order — {@link csv} minus {@link added}. */
  kept: readonly string[]
  /**
   * The tokens dropped because they name one of OUR panels from an EARLIER boot.
   *
   * The host renumbers the `<pluginId>` half of a row-registered panel on every boot (`act1:team` this
   * boot, `act7:team` the next), so a list left behind by an earlier session names ids nothing can
   * answer — and the host's `SidePanelColumn` still builds a tab and draws a dot for each one. These are
   * the ONLY tokens this merge ever removes, and since repair round R1 they are recognised by PROVENANCE
   * ({@link panelTokenIsStaleMine}) rather than by a shared slug.
   */
  pruned: readonly string[]
  /**
   * The stale historical default this list was EXACTLY the residue of, when the migration ran.
   *
   * Empty on every other merge, which is the common case: the write target is then the ordinary
   * `kept ∪ added`. A non-empty value means {@link csv} is the host's current default ∪ our ids, and
   * that the entry named here is the stale default the user's list consisted of.
   */
  staleDefault: string
}

/**
 * The `<slug>` half of one composed panel id: everything after the FIRST colon.
 *
 * The host composes a loader row's panel id as `<pluginId>:<slug>` and validates it against its own
 * grammar (`/^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)*$/`), so the slug is what identifies OUR page while
 * the activation half is the host's to renumber. An id with no colon is its own slug — the host's
 * builtins are spelled that way.
 * @param id - one normalized panel id.
 * @returns the slug half.
 */
export function panelSlugOf(id: string): string {
  /** Where the activation half ends; -1 when the id carries none. */
  const at = id.indexOf(":")
  return at < 0 ? id : id.slice(at + 1)
}

/** The id shape the host composes for a loader row's panel: `<pluginId>:<slug>` with its `act<N>` fallback. */
const PANEL_ACT_ID_SHAPE = /^act\d+:/u

/**
 * How many PAST registration ids the panel-id record keeps: the LAST N, the oldest evicted.
 *
 * WHY A CAP IS PART OF THE RULE. The history is the ownership evidence the prune rests on, and the record
 * is rewritten on every boot, so an UNCAPPED list would grow for the life of the workspace while the ids
 * it can still match are only ever the last few boots' worth: the host renumbers the activation half on
 * EVERY boot, so a token from further back cannot be in a live CSV unless the file was hand-edited. 32
 * entries is roughly ten boots of slack — a bound that is STATED here rather than left to grow.
 */
export const PANEL_ID_HISTORY_LIMIT = 32

/**
 * The bounded history a record written NOW must carry: the previous history plus the previous boot's own
 * ids, minus everything live in this one, newest last.
 *
 * THE SHAPE FILTER IS LOAD-BEARING, and it is the same one {@link panelTokenIsStaleMine} applies: only an
 * id the host composes for a loader row (`act<N>:<slug>`) can ever be ours, so neither a foreign id nor a
 * value a hand edit put in the file can enter the history and make the prune delete a live panel.
 * @param current - the ids THIS activation registered, in registration order.
 * @param past - the previous record's history AND its current ids, oldest first.
 * @returns the bounded past registrations, oldest first.
 */
export function panelHistoryAfter(current: readonly string[], past: readonly string[]): string[] {
  /** The past ids that are ours, dead now, deduped and in the order they were first recorded. */
  const kept: string[] = []
  for (const id of past) {
    if (!PANEL_ACT_ID_SHAPE.test(id) || current.includes(id) || kept.includes(id)) continue
    kept.push(id)
  }
  return kept.slice(-PANEL_ID_HISTORY_LIMIT)
}

/**
 * Whether one token is a panel of OURS from an EARLIER boot — the only kind of token we may prune.
 *
 * OWNERSHIP IS PROVENANCE, NEVER A SLUG (repair round R1, CodeRabbit PR #35). The slug rule this
 * replaced was wrong in BOTH directions at once: a foreign plugin's live `act9:team` shares our `team`
 * slug and was pruned out of the user's sidebar, while one of our OWN dead ids whose page was retired or
 * renamed matched no live slug and was never pruned at all. THE THREE CONDITIONS:
 *   * the id has the shape the host composes for a loader row (`act<N>:<slug>`) — the only shape this
 *     bundle's own panels ever take, because a patch row has no Component identity;
 *   * the FULL id is in the record's bounded history ({@link panelHistoryAfter}), i.e. this bundle
 *     provably registered it in an earlier boot — the record's provenance rules are what make
 *     "provably" true;
 *   * the full id is NOT live right now. A current id is a live panel and is never removed.
 * A foreign id fails the second condition and is therefore never pruned — even one that shares our slug,
 * and even one shaped like an `act<N>` id (the counter is the host's, not ours). ACCEPTED BOUND, stated
 * rather than hidden: a foreign DEAD id lingering in the list is not ours to clean, so it stays.
 * @param token - one normalized token from the host's CSV.
 * @param ours - the ids this activation registered, in registration order.
 * @param past - the recorded past registrations, as {@link panelHistoryAfter} bounded them.
 * @returns true when the token is ours, stale, and therefore prunable.
 */
export function panelTokenIsStaleMine(token: string, ours: readonly string[], past: readonly string[]): boolean {
  if (!PANEL_ACT_ID_SHAPE.test(token)) return false
  if (ours.includes(token)) return false
  return past.includes(token)
}

/**
 * Normalize one CSV the way the host's own `normalizeSidePanelPanels` does for the parts this bundle
 * depends on: trim, lowercase and first-wins dedupe. Used by {@link mergePanelEnableIds} for its input
 * AND by the keeper for its post-write read-back, so the two sides of that comparison can never
 * disagree about what "the same list" means.
 * @param value - the CSV, or anything else at all (a non-string reads as the empty list).
 * @returns the normalized comma-joined list.
 */
export function normalizePanelCsv(value: unknown): string {
  /** The tokens, in first-seen order. */
  const tokens: string[] = []
  for (const token of (typeof value === "string" ? value : "").split(",")) {
    /** One normalized token; the empty string is dropped so a trailing comma adds no slot. */
    const id = token.trim().toLowerCase()
    if (id !== "" && !tokens.includes(id)) tokens.push(id)
  }
  return tokens.join(",")
}

/**
 * The historical side-panel enable lists this bundle KNOWS to be a stale schema default.
 *
 * WHY A LIST AND NOT A SINGLE VALUE: the rule is "a residue that is EXACTLY a default an older host
 * shipped", and an older host may have shipped more than one — so the constant is a set, and the ONLY
 * entry is the one that was measured against a real profile. `todo,jobs,agents` is dsh-tui 0.13.0's
 * default: a user layer that a 0.13.0-era `/settings` save materialized keeps those three and none of
 * the five builtins 0.14.0 added, and a user layer BEATS the schema default, so those five vanish from
 * the sidebar the moment any panel activity makes the list visible (the reported defect).
 *
 * EVERY ENTRY IS ALREADY NORMALIZED (see {@link normalizePanelCsv}): the comparison is against a
 * normalized residue, so an entry with a space or a capital could never match and would be dead weight.
 */
export const KNOWN_STALE_PANEL_DEFAULTS: readonly string[] = ["todo,jobs,agents"]

/**
 * The known stale default one residue is EXACTLY, when the stale-default migration applies.
 *
 * THE PREDICATE, in full (T1 of the frozen contract): the caller passes the current CSV with OUR ids
 * removed, and the answer is non-empty only when that residue is exactly a
 * {@link KNOWN_STALE_PANEL_DEFAULTS} entry AND that entry differs from the host's own current
 * {@link HostPrefsProbeResult.defaultIds}. The second half is what makes a 0.13.0 host — whose current
 * default IS the stale entry — byte-identical to before this rule existed: there the residue is the
 * host's own default and there is nothing to restore.
 *
 * AN UNREADABLE OR EMPTY HOST DEFAULT IS INERT, never a wildcard: without a target there is no list to
 * migrate TO, and a rule that guessed one would rewrite a user's sidebar on the strength of a missing
 * export. The keeper says so in ONE log line and otherwise behaves exactly as before.
 * @param residue - the user's own enable tokens, normalized, with our ids removed.
 * @param hostDefault - the host's current default, normalized; undefined when unreadable.
 * @returns the stale default matched, or the empty string when the migration must not run.
 */
export function stalePanelDefaultResidue(residue: string, hostDefault: string | undefined): string {
  if (hostDefault === undefined || hostDefault === "") return ""
  if (residue === "" || residue === hostDefault) return ""
  return KNOWN_STALE_PANEL_DEFAULTS.includes(residue) ? residue : ""
}

/**
 * Merge this activation's panel ids into the host's live enable CSV, pruning OUR OWN stale ids.
 *
 * THE INVARIANTS THIS PURE FUNCTION EXISTS TO HOLD. It NEVER reorders a token and NEVER removes one it
 * does not own: the user's list — panels of other plugins, the host's builtins, and ids this bundle has
 * never heard of — comes back in its original order, and our ids are APPENDED after it. The ONE removal
 * is a token that satisfies every condition of {@link panelTokenIsStaleMine}: an id of OURS that an
 * earlier boot composed under a different host activation, which no panel can answer any more, and which
 * the host's sidebar nevertheless draws a tab and a dot for (the reported mismatch, D1). Duplicates
 * collapse the way the host's own `normalizeSidePanelPanels` collapses them (trim + lowercase +
 * first-wins), so a merge never fights the host's normalizer into a second, different list.
 *
 * THE ONE EXCEPTION TO "NEVER REORDERS": the stale-default migration below. A list that consists of a
 * historical schema default (with or without our own ids in it) is not a position anybody took — a user
 * layer carrying it outranks the schema default, so five builtins the CURRENT host ships are silently
 * absent from the sidebar — and the merge answers it with the host's current default ∪ our ids, in the
 * host's own order, which is the axis the sidebar's tab order and its dots are read along. Every other
 * list, including a deliberate custom one, keeps its exact order and contents.
 *
 * A MIGRATION IS SELF-TERMINATING: once written, the residue IS the host's current default, so the very
 * next decision finds no stale default and takes the ordinary path (for a list that names any of ours,
 * that is the stand-down). It is deliberately NOT a one-shot latch: on a host whose configuration mirror
 * rewrites the CSV from the user layer later in the boot, the rewrite re-presents the stale default and
 * is migrated again — which is the whole repair, not a repeat of it.
 *
 * WHY THE PRUNE IS PART OF THE MERGE RATHER THAN A SECOND PASS: the keeper writes at most a handful of
 * times, and a repair that appended the current ids without removing the stale ones would leave the list
 * strictly WORSE — two ids per page, one of them dead. Removal is otherwise still not offered: a user who
 * turns one of our panels off in `/settings` loses nothing here, because the merge only ever finds the
 * id missing and appends it.
 * @param existing - the host's current CSV; anything at all (a non-string reads as the empty list).
 * @param ours - the ids this activation registered, in registration order.
 * @param past - the record's bounded past registrations, from {@link panelHistoryAfter}.
 * @param hostDefault - the host's current default, normalized, from {@link HostPrefsProbeResult}; omitted
 *   or empty leaves the stale-default migration inert and the target is then `kept ∪ added` as before.
 * @returns the CSV to apply, plus what was added, what was already there and what was pruned.
 */
export function mergePanelEnableIds(existing: unknown, ours: readonly string[], past: readonly string[], hostDefault?: string): PanelEnableMerge {
  /** The user's tokens, normalized and deduped exactly as the host normalizes them. */
  const tokens = normalizePanelCsv(existing).split(",").filter((id) => id !== "")
  /** Our tokens from an earlier boot; see {@link panelTokenIsStaleMine} for why only these may go. */
  const pruned = tokens.filter((token) => panelTokenIsStaleMine(token, ours, past))
  /** The user's list with only those tokens removed, in its original order. */
  const kept = tokens.filter((token) => !pruned.includes(token))
  /** The registered ids the kept list does not carry yet, in registration order. */
  const added = ours.filter((id) => !kept.includes(id))
  // THE MIGRATION PREDICATE reads the CURRENT list with OUR ids removed — the live ones and the
  // provably-dead ones alike, because both are ours and neither is part of anybody's position on which
  // builtins the sidebar should carry. What remains is the user's own list in the contract's words, and
  // it is compared to the host's current default by {@link stalePanelDefaultResidue}.
  /** The user's own list: the kept tokens that name none of our panels, normalized. */
  const residue = normalizePanelCsv(kept.filter((token) => !ours.includes(token)).join(","))
  // THE MIGRATION NEEDS SOMETHING OF OURS TO CARRY: its target is the host's default ∪ OUR ids, so with
  // nothing registered it would rewrite the user's list for no charter at all. The keeper arms on its
  // first registration and therefore never reaches this state, and the guard keeps that accident-proof:
  // an empty registration set behaves exactly as it did before the migration existed.
  /** The stale default this list consisted of, or the empty string when it is not a stale default. */
  const staleDefault = ours.length === 0 ? "" : stalePanelDefaultResidue(residue, hostDefault)
  /** The host's current default, as tokens; empty only when the migration did not run. */
  const defaultTokens = staleDefault === "" ? [] : (hostDefault ?? "").split(",").filter((id) => id !== "")
  /** The CSV this merge asks for: the host's default ∪ ours on a migration, `kept ∪ added` otherwise. */
  const csv = staleDefault === ""
    ? [...kept, ...added].join(",")
    : [...defaultTokens, ...ours.filter((id) => !defaultTokens.includes(id))].join(",")
  return { csv, added, present: ours.filter((id) => kept.includes(id)), kept, pruned, staleDefault }
}

/**
 * The first dsh-tui release whose host SELF-HEALS the sidebar enable CSV (measured,
 * `evidence/tui/dsh-tui-015/host-diff/FACTS.md`, V1/V3).
 *
 * From 0.15.0 on, `TuiPanelRuntime.register()` feeds `registeredPanelIds`, the boot/mirror apply
 * (`applyConfiguredSidePanelPanels`) unions registered ids back unless explicitly removed, `/settings`
 * live edits record removals session-wide (`applySidePanelPanelsFromSettings` + `removedPanelIds`),
 * and the only CSV writer left is that settings-apply hop. The enable-list keeper's charter — repair
 * the append the host's own re-apply dropped — therefore no longer exists there, and C2 re-specs it:
 * on these hosts the keeper STANDS DOWN and writes nothing, so it can never race (or undo) the host's
 * own union or re-add a panel the user explicitly removed. THE ONE EXCEPTION (S1,
 * `fix/sidebar-015-keeper-migration`): the union heals only REGISTERED PLUGIN ids, so the stale-default
 * migration still runs BEFORE the stand-down and on the belt's per-event re-check — the single write
 * class a self-healing host keeps from this keeper.
 */
export const PANEL_CSV_SELF_HEAL_SINCE = "0.15.0"

/**
 * Whether one host version self-heals the sidebar enable CSV, i.e. whether the enable-list keeper
 * must stand down (clause C2).
 *
 * DEGRADE-SAFE BY CONSTRUCTION: an empty, absent or unparseable version answers FALSE, so the keeper
 * keeps its full legacy behaviour on exactly the hosts whose behaviour it pinned — the gate can only
 * ever STAND THE KEEPER DOWN on a version it could actually read and compare.
 * @param version - the installed host package's version, from {@link readHostPackageVersion}; "" or
 *   garbage reads as "does not self-heal".
 * @returns true only when the version parses and is at or past {@link PANEL_CSV_SELF_HEAL_SINCE}.
 */
export function hostSelfHealsPanelCsv(version: string): boolean {
  return hostVersionAtLeast(version, PANEL_CSV_SELF_HEAL_SINCE)
}

/**
 * The first host release whose ENABLE LIST is OWNED by the host, for this bundle's purposes.
 *
 * 0.16.1 is the release that INTRODUCED host ownership — the behaviour this gate retires the keeper
 * for — so the constant keeps 0.16.1 forever: `TuiPanelRuntime.register()` enables a panel on
 * registration, `dispose()` removes it, and the boot and settings applies union every registered id
 * back. There is therefore NO enable-list state this adapter could still author — anything it wrote
 * would be a second writer racing the host's own merge, which is exactly the incident class
 * (`fix/sidebar-015-keeper-migration`) this gate retires. Which host the bundle is ADMITTED on is a
 * different fact, declared in `dsh-plugin.json` `compat.hosts` (0.17.0 since v0.15.5).
 */
export const PANEL_CSV_HOST_OWNED_SINCE = "0.16.1"

/**
 * Whether one host version OWNS the sidebar enable list, i.e. whether this adapter must be READ-ONLY.
 *
 * A STRICTER GATE THAN {@link hostSelfHealsPanelCsv}, and deliberately so: a self-healing host still
 * accepted the one stale-default migration write, while an OWNING host needs no write at all — not
 * even that one — because the list it keeps is the list its own registry produces. Degrade-safe in
 * the same direction: an unreadable version answers FALSE and keeps the older, pinned behaviour.
 * @param version - the installed host package's version, from {@link readHostPackageVersion}.
 * @returns true only when the version parses and is at or past {@link PANEL_CSV_HOST_OWNED_SINCE}.
 */
export function hostOwnsPanelCsv(version: string): boolean {
  return hostVersionAtLeast(version, PANEL_CSV_HOST_OWNED_SINCE)
}

/**
 * Whether one host version is at or past a `major.minor.patch` floor.
 *
 * ONE comparison for both panel-CSV gates, so the two releases they name can never be compared by
 * two subtly different rules. An unparseable version answers FALSE, which is the degrade-safe
 * direction for every caller: the keeper keeps its pinned legacy behaviour on exactly the hosts
 * whose behaviour it pinned.
 * @param version - the installed host package's version.
 * @param since - the first release the caller's rule applies to, as `major.minor.patch`.
 * @returns true only when the version parses and ranks at or past `since`.
 */
export function hostVersionAtLeast(version: string, since: string): boolean {
  /** The leading `major.minor.patch` of the version, when it carries a readable one. */
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (match === null) return false
  /** The floor, pre-split once so the comparison reads as a rank. */
  const floor = since.split(".").map((part) => Number.parseInt(part, 10))
  /** The parsed version, in the same rank order. */
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (let rank = 0; rank < 3; rank += 1) {
    if (parsed[rank] > floor[rank]) return true
    if (parsed[rank] < floor[rank]) return false
  }
  return true
}

/**
 * The settle ladder's delays, in milliseconds FROM ARMING — the DEGRADATION, used only on a host whose
 * live setting exposes no change feed.
 *
 * WHY THE FEED IS THE PRIMARY REPAIR AND THIS LADDER IS THE FALLBACK (this REPLACES the 0.13.0-era
 * decision, and the reason is measured rather than stylistic). The old code asserted that a bounded
 * ladder beats a subscription "because a subscription has to reason about every rewrite, including the
 * ones that ARE the user's decision". That reasoning had a hole, and the hole is the user's own defect
 * (「侧边栏挂掉了」, F5): the host's OWN `tuiPanels.register` appends every registered id to the CSV at
 * about +1056 ms, and this keeper ARMED on that registration — so its first tick, at +1000 ms after
 * arming, read a list that already named us and STOOD DOWN. The host's configuration mirror then
 * rewrote the CSV at about +5403 ms (`applySidePanelPanels(config.sidePanel?.panels)`, reached through
 * `Fiber._reload`), and the ladder was already finished, so MPD's panels left the sidebar and never
 * came back for the rest of the session. A read taken at arm time cannot tell "the host's own append"
 * from "the user enabled us", and that is exactly what the ladder decided on.
 *
 * The host's live setting DOES expose the distinction: `apply()` notifies its listeners only when an
 * apply CHANGES the value, so a rewrite by the configuration mirror is a signal, and our own write's
 * echo is recognisable (the keeper guards it). The change feed is therefore the repair, and this ladder
 * remains for a build that exposes no feed — it is still bounded, still stands down on a list that
 * names any of our ids, and still writes only ids its own activation registered.
 */
export const PANEL_KEEPER_LADDER_MS: readonly number[] = [1000, 2500, 5500, 9000, 16000, 25000]

/** How the sidebar enable-list keeper settled, as the adapter and a boot line report it. */
export interface PanelEnableOutcome {
  /** The keeper's measured state, in the same vocabulary every other surface uses. */
  state: SeamState
  /** What the last tick measured, as one line. */
  detail: string
  /** The ids this activation registered and is therefore allowed to re-assert. */
  ids: readonly string[]
  /** How many times the keeper actually WROTE the CSV (a clean read writes nothing). */
  reasserted: number
  /** How many ladder ticks ran; a keeper that never armed reports 0. */
  ticks: number
}

/** Everything {@link createPanelEnableKeeper} needs, with the clock, the store and the record injectable. */
export interface PanelEnableKeeperOptions {
  /** Loads the host store; retried on every tick, because a host may expose it late. */
  loadPrefs: () => Promise<HostPrefsProbeResult>
  /** Schedules one tick and returns its canceller (injectable so a test owns the clock). */
  schedule: (run: () => void, delayMs: number) => () => void
  /**
   * The ids this bundle registered in EARLIER boots — the ownership evidence the prune rests on.
   *
   * REQUIRED rather than defaulted, and read PER DECISION rather than cached: the mounted row passes
   * {@link readPanelIdRecordPast} (the record is rewritten on every boot, so a value sampled at
   * construction could already be a boot stale), while a unit arm states its own past explicitly — a
   * default would silently read the machine's real record and make an arm pass or fail by accident.
   * Callers must never throw: the keeper contains a throwing reader as "no proven past", which disables
   * the prune instead of guessing.
   * @returns the bounded past registrations, oldest first.
   */
  pastIds: () => readonly string[]
  /** Receives the ONE settle line; omitted means the keeper is silent. */
  log?: (line: string) => void
  /** The ladder to walk; defaults to {@link PANEL_KEEPER_LADDER_MS}. */
  ladder?: readonly number[]
  /**
   * Called whenever the keeper's own state changes (a new id observed, a tick settled).
   *
   * This is how the DISCOVERED ids leave the host process. The host composes a plugin panel's final
   * id from the caller's Component identity, and a loader ROW has none, so the id is the host's
   * `act<N>` fallback and is knowable ONLY from the host's own registration read-back at run time —
   * never from a source constant, and never from the plugin's package name. A remedy that has to
   * write the ids somewhere durable therefore reads them from this hook's consumer, not from a guess.
   * @param outcome - the keeper's state at the change.
   */
  onChange?: (outcome: PanelEnableOutcome) => void
}

/** The bounded re-assert of this activation's panel ids into the host's live enable CSV. */
export interface PanelEnableKeeper {
  /** Records one id this activation successfully registered, and arms the ladder on the first one. */
  observe(id: string): void
  /** The keeper's state right now, sampled. */
  outcome(): PanelEnableOutcome
  /**
   * Retires the keeper for good: no pending ladder tick runs and the host's change feed (when one was
   * installed) is unsubscribed. Called on scope disposal, so a hot reload leaves no listener behind.
   */
  stop(): void
}

/**
 * The verdict of the pre-stand-down stale-default migration on a self-healing host (R2.3).
 *
 * `"migrated"` — the write landed and read back. `"refused"` — the host did not retain the write
 * (`writeList` already settled `refused`); the stand-down must PRESERVE that outcome instead of
 * settling `confirmed` over a stale list the failed write left in place. `"none"` — there was nothing
 * to migrate (no readable host default, or the residue is not a known stale default), the ordinary
 * C2 stand-down.
 */
type PanelSelfHealMigration = "migrated" | "refused" | "none"

/**
 * Build the bounded re-assert that keeps this activation's panels in the host's enable CSV.
 *
 * WHY A LADDER RATHER THAN A SUBSCRIPTION. The host holds the CSV in a module-level store with no
 * owner, so a subscription has to reason about every rewrite, including the ones that ARE the user's
 * decision. A BOUNDED ladder that samples the store a few times instead reads the OUTCOME of those
 * rewrites, which is where the user's position actually becomes visible: a list that names ANY of our
 * ids is a configuration that has taken a position on this bundle, and the keeper stands down. The
 * repair therefore applies to exactly one shape — a list that names NONE of ours, which is what a
 * fresh profile's schema default looks like after the host re-applies it — and the ladder stops for
 * good after its last tick, so nothing here reopens a settled question later in the session.
 *
 * STANDING DOWN NO LONGER PROTECTS A DEAD TOKEN (repair round R1, CodeRabbit PR #35): a list that names
 * one of ours AND one of our provably-dead past ids is pruned of the dead id first, and only then the
 * keeper stands down without appending anything. See {@link PanelEnableKeeperOptions.pastIds} for the
 * ownership evidence that makes "provably dead" true, and {@link panelTokenIsStaleMine} for why a slug
 * is not evidence.
 *
 * Nothing here ever throws — a tick is contained, and a failure is recorded as the outcome.
 * @param options - the store loader, the clock, the ladder and the recorded past ids.
 * @returns the keeper.
 */
export function createPanelEnableKeeper(options: PanelEnableKeeperOptions): PanelEnableKeeper {
  /** The ids registered by this activation, in registration order — the ONLY ids ever written. */
  const ours: string[] = []
  /** The ladder this keeper walks, from arming. */
  const ladder = options.ladder ?? PANEL_KEEPER_LADDER_MS
  /** Every pending tick's canceller, so `stop()` releases all of them. */
  const pending: (() => void)[] = []
  /** Whether the ladder was already armed; arming is once per keeper. */
  let armed = false
  /** How many ticks ran. */
  let ticks = 0
  /** How many ticks actually wrote the CSV. */
  let reasserted = 0
  /** Whether the host's own change feed is this keeper's repair path. */
  let onFeed = false
  /** The host's unsubscribe, once the change feed is in force. */
  let releaseFeed: (() => void) | undefined
  /** The observe-only belt's unsubscribe, once the C2 self-heal stand-down installed one. */
  let releaseBelt: (() => void) | undefined
  /**
   * Set while this keeper's own write is in flight.
   *
   * The host's live setting notifies on every apply that CHANGES the value, so our own write is heard
   * back immediately. This flag makes that echo a non-event, which is what bounds the repair: without it
   * a store that notifies synchronously would re-enter this decision from inside the write.
   */
  let writing = false
  /**
   * Whether {@link PanelEnableKeeper.stop} has retired this keeper (R2.2).
   *
   * Disposal is LATCHED rather than implied by the releases: a `loadPrefs()` promise can resolve
   * AFTER `stop()` returned, and the callbacks that resolution reaches — the migration, the belt
   * install, `decide` through the change feed — must not write the retired activation's ids into a
   * host that has already cleaned its scope, nor attach a belt subscription nothing will release.
   * Every write-bearing entry point checks this flag first.
   */
  let stopped = false
  /** The measured state; `requested` until the keeper has something to say. */
  let state: SeamState = "requested"
  /** The measured detail behind {@link state}. */
  let detail = "no panel registered yet"
  /** The ONE reason the host's change feed could not be installed, when it refused one. */
  let feedRefused = ""
  /**
   * Whether the ONE line about an unreadable host default has already been written.
   *
   * The stale-default migration needs the host's CURRENT default as its target, and a host build that
   * exposes no usable `DEFAULT_SIDE_PANEL_IDS` leaves the migration inert. That is a degrade, not an
   * event, so it is said ONCE per keeper — a ladder would otherwise repeat the same sentence on every
   * tick, and the sink is a file a reader has to scan. It goes to the adapter's own sink and never to a
   * terminal (requirement R5).
   */
  let defaultNoted = false

  /**
   * Record one tick's verdict and emit the ONE settle line when the ladder is exhausted.
   * @param next - the state this tick measured.
   * @param nextDetail - the one-line reason.
   */
  /** Hand the current state to the consumer's `onChange`; a throwing consumer cannot break a tick. */
  const announce = (): void => {
    if (options.onChange === undefined) return
    try {
      options.onChange({ state, detail, ids: [...ours], reasserted, ticks })
    } catch {
      // The consumer's own bookkeeping is never allowed to fail a registration or a tick.
    }
  }

  /**
   * Record one tick's verdict and emit the ONE settle line when the ladder is exhausted.
   * @param next - the state this tick measured.
   * @param nextDetail - the one-line reason.
   */
  const settle = (next: SeamState, nextDetail: string): void => {
    state = next
    // A REFUSED FEED IS NEVER LOST: the tick that found it still takes its ladder decision, and its own
    // sentence would otherwise overwrite the one reason the feed is not the repair path here. The note is
    // appended in ONE place so no settle site can forget it.
    detail = feedRefused === "" ? nextDetail : `${nextDetail}; the change feed was refused: ${feedRefused}`
    announce()
    if (ticks < ladder.length) return
    options.log?.(`mpd-tui panel enable keeper: ${next} — ${detail}; ${String(reasserted)} write(s) over ${String(ticks)} tick(s); ids ${ours.join(",") || "(none)"}`)
  }

  /**
   * Cancel every pending ladder tick, leaving the change feed (if one is in force) untouched.
   *
   * Split from {@link standDown} because the two are reached at different moments: the ladder is
   * cancelled the instant the feed takes over, while the keeper is still very much alive.
   */
  const cancelLadder = (): void => {
    for (const cancel of pending.splice(0)) {
      try {
        cancel()
      } catch {
        // A canceller that throws must not break an unload or a hand-off.
      }
    }
  }

  /**
   * Run the host's unsubscribe, once, tolerating a host that refused to return one.
   *
   * A store that returns nothing to call is not an error: the listener stays attached for the life of
   * the process, which is what the keeper did before feed support existed and is strictly better than
   * throwing during a scope disposal.
   */
  const releaseFeedNow = (): void => {
    /** The release in force, taken so a throwing one cannot be run twice. */
    const release = releaseFeed
    releaseFeed = undefined
    onFeed = false
    if (release === undefined) return
    try {
      release()
    } catch {
      // A host unsubscribe that throws must not break an unload.
    }
  }

  /**
   * Write ONE CSV into the host's live enable list and prove it landed.
   *
   * THE POST-WRITE READ-BACK (contract D1). Until the host's OWN reader answers the list this keeper
   * asked for, the write is a request and not a fact — and a keeper that reported success on a store
   * which dropped it would leave the sidebar showing whatever it had before, silently. The comparison
   * runs through the SAME normalizer the merge used, so a host that reorders or re-cases the tokens
   * is not mistaken for a host that refused them.
   *
   * It is ONE function because repair round R1 gave the keeper a SECOND write shape (a prune-only write
   * on the stand-down path): two copies of the echo guard and the read-back is how the two paths drift.
   * A write that LANDS settles nothing here — the CALLER owns the one line that describes the decision,
   * so a tick still announces exactly once (and the record is therefore written once per tick).
   * @param prefs - the bound host store.
   * @param csv - the exact list to apply.
   * @returns true when the list came back exactly; false when it did not (already settled as refused).
   */
  const writeList = (prefs: TuiHostPrefsLike, csv: string): boolean => {
    // THE GUARD IS WHAT MAKES THE ECHO FINITE: see {@link decide}'s own first line. The flag is set
    // around the write so the store's synchronous notification is a non-event, not a second repair.
    writing = true
    try {
      prefs.applySidePanelPanels(csv)
    } finally {
      writing = false
    }
    reasserted += 1
    /** What the host's reader answers AFTER the write, normalized the way the merge normalizes. */
    const landed = normalizePanelCsv(prefs.getSidePanelPanels())
    if (landed !== normalizePanelCsv(csv)) {
      settle("refused", `the enable list read back as ${landed === "" ? "(empty)" : landed} instead of the ${csv} just written`)
      return false
    }
    return true
  }

  /**
   * The ids this bundle provably registered in EARLIER boots, read PER DECISION.
   *
   * Never cached: the record is rewritten on every boot, so a value sampled at construction could
   * already be a boot stale. A throwing reader is "no proven past", which disables the prune instead of
   * guessing — shared by {@link decide} and the self-healing paths so they can never prune by two
   * different pasts.
   * @returns the bounded past registrations, oldest first; `[]` when the reader refused.
   */
  const provenPast = (): readonly string[] => {
    try {
      return options.pastIds()
    } catch {
      return []
    }
  }

  /**
   * Say the ONE degrade line about an unreadable host default, at most once per keeper.
   *
   * The stale-default migration needs the host's CURRENT default as its target, and a host build that
   * exposes no usable `DEFAULT_SIDE_PANEL_IDS` leaves the migration inert on EVERY path that evaluates
   * it — the legacy decision and the `>= 0.15.0` stand-down alike. That is a degrade, not an event, so
   * it is said ONCE through the shared {@link defaultNoted} flag: a ladder or a feed would otherwise
   * repeat the same sentence on every tick, and the sink is a file a reader has to scan. It goes to the
   * adapter's own sink and never to a terminal (requirement R5).
   * @param tail - how the caller's own path proceeds without a target, completing the sentence.
   */
  const noteInertDefault = (tail: string): void => {
    if (defaultNoted) return
    defaultNoted = true
    options.log?.(`mpd-tui panel enable keeper: the host exposes no readable DEFAULT_SIDE_PANEL_IDS, so the stale-default migration stays inert and ${tail}`)
  }

  /**
   * The ONE write a self-healing host still gets: the stale-default migration, evaluated BEFORE the C2
   * stand-down takes the keeper out (`fix/sidebar-015-keeper-migration`, S1).
   *
   * WHY THIS EXISTS — the regression this re-arms. The C2 stand-down returns from the tick BEFORE
   * {@link decide}, and `decide` is the only caller of {@link mergePanelEnableIds} — so on a
   * `>= 0.15.0` host the T1 stale-default migration was dead code, while the host's own self-heal
   * unions only REGISTERED PLUGIN ids back: a builtin pinned out by a 0.13.0-era user layer was healed
   * by no one. The predicate is therefore evaluated here with the SAME pure merge, and it fires only
   * when every T1 condition holds: the residue (the live list with our ids removed) is EXACTLY a
   * {@link KNOWN_STALE_PANEL_DEFAULTS} entry, the probed host default is readable, the two differ, and
   * at least one id of ours is registered. In EVERY other case this writes nothing and the keeper
   * stands down exactly as C2 specifies — a deliberate custom list, a current-default list, an
   * unreadable host default (its ONE degrade line) and an empty registration set are positions or
   * non-facts, never migration targets.
   *
   * The write target is the migration target {@link PanelEnableMerge.csv} already computes: the host's
   * current default in the host's own order, then our ids in registration order. It is
   * SELF-TERMINATING — the write leaves the residue equal to the host's own default, so no later read
   * of that list can fire the predicate again.
   * @param prefs - the bound host store, from the probe answer that carried the self-healing version.
   * @param hostDefault - the host's current default, normalized; `undefined` or empty when this build
   *   exposes none, which leaves the predicate inert.
   * @returns the {@link PanelSelfHealMigration} verdict: `"migrated"` when the write landed and read
   *   back; `"refused"` when the host did not retain it (already settled `refused` by
   *   {@link writeList}, and the stand-down must keep that outcome); `"none"` when there was nothing
   *   to migrate.
   */
  const migrateStaleDefaultOnSelfHealer = (prefs: TuiHostPrefsLike, hostDefault: string | undefined): PanelSelfHealMigration => {
    if (hostDefault === undefined || hostDefault === "") {
      noteInertDefault("the keeper stands down to the host's own union")
      return "none"
    }
    /** The decision, computed by the SAME pure merge the legacy path decides with. */
    const merge = mergePanelEnableIds(prefs.getSidePanelPanels(), ours, provenPast(), hostDefault)
    if (merge.staleDefault === "") return "none"
    if (!writeList(prefs, merge.csv)) {
      options.log?.(`mpd-tui panel enable keeper: the stale-default migration write was refused, so the keeper stands down without it; the belt retries on the host's next apply`)
      return "refused"
    }
    options.log?.(`mpd-tui panel enable keeper: migrated the stale default ${merge.staleDefault} to ${merge.csv} — the ONE write a self-healing host still gets, because its own union heals only registered plugin ids`)
    return "migrated"
  }

  /**
   * Decide once, from ONE read of the host's CSV — the single place both the change feed and the ladder
   * take their decision, so the two paths cannot drift into two different rules. (The self-healing
   * host's belt re-evaluates the SAME pure merge per event, but its write class is the stale-default
   * migration alone — see {@link standDownToHostUnion}.)
   *
   * THE CONDITION IS THE WHOLE CONTRACT, and it is what keeps the keeper from overruling its user:
   *   * NONE of our ids present — the host's own config mirror has restored a list that does not
   *     mention us at all (`todo,jobs,agents,info,…` on a fresh profile). That is the reported defect,
   *     and the whole set is appended in one write (with any provably-dead id of ours pruned in the same
   *     write).
   *   * ANY of our ids present, on a read the HOST asked for — the configuration NAMES US. Either the
   *     user enabled us through `/settings` or `scripts/mpd-tui-panels.ts`, or the user deliberately
   *     removed some of us and the rest survived the rewrite. Either way the user's position is READABLE
   *     from the CSV, so NOTHING IS APPENDED and the keeper STANDS DOWN for good. It therefore never
   *     re-adds an id a user removed on purpose, WITHOUT a third host-internals contact to ask for the
   *     configured value. A provably-dead past id in that same list IS still pruned first (repair round
   *     R1): standing down protects the user's SELECTION, and a token no panel can answer is not part of
   *     any selection — leaving it would keep drawing the orphaned tab this wave exists to remove.
   *   * THE STALE-DEFAULT RESIDUE IS THE ONE EXCEPTION to both branches (T1 of the frozen contract), and
   *     it is decided by {@link PanelEnableMerge.staleDefault}: when the list with our ids removed is
   *     EXACTLY a historical schema default that differs from the host's current one, the write target is
   *     the host's current default ∪ our ids instead of the list on the wire. That residue is not a
   *     position — it is a default an older host materialized — so it is migrated whether or not it also
   *     names us, and the migration does NOT retire the keeper: its own write leaves the host's default
   *     as the residue, so the NEXT read stands down by the ordinary rule, while a configuration mirror
   *     that rewrites the stale default later in the boot is migrated again rather than abandoned.
   *   * A partial write is never performed: the ids go in as a set, so a half-applied list cannot make
   *     the next read say "the configuration names one of us" and stand down mid-repair.
   *
   * ARM TIME IS THE ONE READ THAT CANNOT STAND DOWN, and that is the measured defect stated as code:
   * the host's own `tuiPanels.register` appends our ids at about +1056 ms, which is the SAME moment this
   * keeper arms, so a stand-down here is a stand-down on the host's own append — it would retire the
   * keeper about 4.3 s before the configuration mirror rewrites the CSV at about +5403 ms, which is
   * exactly how the panels left the sidebar and never returned (F5). At arm time the read may therefore
   * only REPAIR a list that names none of us (plus the same prune of provably-dead ids, which is not a
   * statement about anyone's selection); a list that names us is simply the state we are watching — and
   * a stale-default residue is migrated here too, because that repair restores builtins the CURRENT host
   * ships rather than overruling anything.
   *
   * NAMED RESIDUAL, not papered over: a user who removes ALL of ours on purpose leaves a CSV that is
   * INDISTINGUISHABLE from a fresh profile's, so a rewrite is repaired once more. Only the CONFIGURED
   * value can separate those two cases, and reading it would mean a third host-internals contact — a §6
   * count decision deliberately NOT taken in this wave. A user who deliberately configures EXACTLY a
   * {@link KNOWN_STALE_PANEL_DEFAULTS} list on a host whose own default differs is the second, smaller
   * residual: that state cannot be told from the stale pin, and the migration restores the host's
   * builtins. Both bounds are stated rather than hidden.
   * @param prefs - the bound host store.
   * @param atArm - true for the single read taken when the feed is installed.
   * @param hostDefault - the host's current default, normalized; undefined when the host build exposes
   *   none, which leaves the migration inert and the decision byte-identical to before it existed.
   */
  const decide = (prefs: TuiHostPrefsLike, atArm: boolean, hostDefault: string | undefined): void => {
    // R2.2 — A RETIRED KEEPER NEVER WRITES AGAIN. `stop()` releases the feed and cancels the ladder,
    // but a host that returned no unsubscribe leaves this decision reachable from a late event; the
    // ids it would assert belong to an activation the host no longer counts, so the decision is a
    // non-event. Checked before the echo guard because a retired keeper has no echo to ignore either.
    if (stopped) return
    // OUR OWN WRITE'S ECHO IS NOT A NEW FACT. The store notifies synchronously from inside
    // `applySidePanelPanels`, so this read would otherwise re-decide on the value this keeper had just
    // written — and the read would find our own ids and stand the keeper down. Dropping the echo is what
    // bounds the repair without needing our own write to end the keeper.
    if (writing) return
    ticks += 1
    try {
      // THE OWNERSHIP EVIDENCE IS READ PER DECISION, never cached: the record is rewritten on every boot,
      // and a value sampled at construction could already be a boot stale. A throwing reader is "no proven
      // past", which disables the prune rather than guessing.
      const past = provenPast()
      // THE DEGRADE IS SAID ONCE. Without the host's own default there is no migration target, so the
      // rule stays inert; one line records why, on the same file sink every other keeper line uses.
      if (hostDefault === undefined || hostDefault === "") noteInertDefault("the enable list is merged as before")
      /** What this read measured, before any decision is taken. */
      const merge = mergePanelEnableIds(prefs.getSidePanelPanels(), ours, past, hostDefault)
      if (merge.present.length > 0) {
        // THE STALE-DEFAULT RESIDUE OUTRANKS THE STAND-DOWN (T1). The list names us, but with our ids
        // removed what is left is a schema default an older host shipped — the shape a 0.13.0-era user
        // layer plus the host's own registration append produces — and nothing here is a position on this
        // bundle. It is migrated and the keeper keeps watching.
        if (merge.staleDefault !== "") {
          if (!writeList(prefs, merge.csv)) return
          settle("confirmed", `migrated the stale default ${merge.staleDefault} to ${merge.csv} (the list also named ${merge.present.join(",")}, so nothing else was appended)`)
          return
        }
        // R1.3: THE DEAD TOKEN GOES FIRST. The list names one of ours, so nothing is ever APPENDED here —
        // the deliberate partial selection stands — but a token in the record's history that is not live
        // is provably dead, and the prune-only write below is the ONE write this branch may make.
        /** What a prune did, for the ONE settle line below; empty when there was nothing to prune. */
        let prunedNote = ""
        if (merge.pruned.length > 0) {
          /** The list a prune-only write lands: the user's kept tokens, with no id of ours appended. */
          const prunedCsv = merge.kept.join(",")
          if (!writeList(prefs, prunedCsv)) return
          prunedNote = `pruned the stale ${merge.pruned.join(",")}, and appended nothing; `
        }
        if (atArm) {
          settle("confirmed", `${prunedNote}the enable list already names ${merge.present.join(",")}; the keeper now follows the host's own change feed instead of standing down on this read`)
          return
        }
        settle("confirmed", `${prunedNote}standing down: the enable list names ${merge.present.join(",")}, so the configuration has taken a position on this bundle`)
        standDown()
        return
      }
      if (merge.added.length === 0 && merge.pruned.length === 0) {
        // No id of ours is registered yet: there is nothing this keeper may write.
        settle("confirmed", "no id of ours is registered, so there is nothing to re-assert")
        return
      }
      if (!writeList(prefs, merge.csv)) return
      settle("confirmed", merge.staleDefault === ""
        ? `re-asserted ${merge.added.join(",")} (the list named none of our ids${merge.pruned.length === 0 ? "" : `; pruned the stale ${merge.pruned.join(",")}`})`
        : `migrated the stale default ${merge.staleDefault} to ${merge.csv} (the list named none of our ids, so the host's current default came back with ours)`)
    } catch (error) {
      settle("refused", String((error as Error)?.message ?? error))
    }
  }

  /**
   * Retire the keeper for good: no further ladder tick and no further feed notification.
   *
   * Called when a read the host asked for proves the configuration has taken a position on this
   * bundle, and from {@link PanelEnableKeeper.stop} on scope disposal.
   */
  const standDown = (): void => {
    cancelLadder()
    releaseFeedNow()
    releaseBeltNow()
  }

  /**
   * Release the observe-only belt's subscription, when one was installed.
   *
   * The belt is NOT the repair feed: on a self-healing host it observes every host apply (saying its
   * observe-only line once) and re-migrates a re-presented stale default (clause C2's belt, plus the
   * S1 re-check). It stays subscribed for the keeper's life, so this is the ONE release — `stop()`
   * calls it through {@link standDown} so a scope disposal never leaks a listener.
   */
  const releaseBeltNow = (): void => {
    if (releaseBelt === undefined) return
    /** The belt's unsubscribe, taken and cleared so a second call is a no-op. */
    const release = releaseBelt
    releaseBelt = undefined
    try {
      release()
    } catch {
      // Same tolerance as the repair feed: a host unsubscribe that throws never breaks a stop.
    }
  }

  /**
   * Stand the keeper down READ-ONLY because the HOST OWNS the enable list
   * (>= {@link PANEL_CSV_HOST_OWNED_SINCE}, repaired 2026-10-20).
   *
   * WHY THIS IS ITS OWN PATH RATHER THAN A FLAG ON {@link standDownToHostUnion}. A self-healing host
   * still accepted the ONE stale-default migration write, so its stand-down had to evaluate that
   * write and install the belt that re-evaluates it on every apply. An OWNING host accepts nothing:
   * its registry produces the list, so a migration here would race the host's own union AND would be
   * the recurring "our bundle rewrote the sidebar enable list" incident class
   * (`fix/sidebar-015-keeper-migration`) that this gap exists to end. Keeping it a separate function
   * makes "this adapter writes no enable-list state on a supported host" a property a reader and a
   * test can SEE, instead of a branch inside the one function that used to write.
   *
   * NOTHING IS LOST BUT THE WRITES: the ladder is cancelled, no feed or belt is installed, and
   * {@link settle} still announces the outcome — so the discovered ids keep reaching the
   * diagnostic record, which is the half a support run actually reads.
   * @param version - the host version the gate parsed, carried into the one line so a log reader can
   *   tell WHICH release made this adapter read-only.
   */
  const standDownOwnedByHost = (version: string): void => {
    ticks += 1
    settle("confirmed", `read-only: the host ${version} owns the enable list (>= ${PANEL_CSV_HOST_OWNED_SINCE}), so this keeper writes nothing — the stale-default migration included`)
    cancelLadder()
    releaseFeedNow()
    releaseBeltNow()
    options.log?.(`mpd-tui panel enable keeper: standing down READ-ONLY on host ${version} — the host owns the sidebar enable list (>= ${PANEL_CSV_HOST_OWNED_SINCE}); this keeper never writes it again`)
  }

  /**
   * Stand the keeper down because the HOST itself self-heals the enable CSV (clause C2).
   *
   * THE KEEPER WRITES NOTHING TO THE ENABLE-LIST CSV on this path — not on this tick, not on a later
   * feed notification — with ONE EXCEPTION (S1, `fix/sidebar-015-keeper-migration`): the stale-default
   * migration {@link migrateStaleDefaultOnSelfHealer} evaluated just before this call is the single
   * write a self-healing host still gets, because the host's own union heals only REGISTERED PLUGIN
   * ids and a builtin pinned out by a stale user layer is otherwise healed by no one. Everywhere else
   * the host's own `applyConfiguredSidePanelPanels` union is the only writer our ids need, an explicit
   * `/settings` removal is recorded by the host session-wide, and a repair from here could only race
   * the host's own merge or undo a removal the user asked for. The ladder is cancelled and the ONE
   * line says why the keeper is silent. The optional belt below then observes every host apply through
   * the store's own feed: non-stale events are logged (the FIRST one-line observation, then silence),
   * while an event that re-presents a KNOWN stale default is re-migrated — a behaviour assertion plus
   * the ONE migration write, never an append.
   *
   * THE BELT IS PERSISTENT, not one-shot: a configuration mirror, a `/settings` save or the host's
   * one-time import hop can re-present the stale pin MID-SESSION, long after this tick stood down, so
   * the belt stays subscribed for the keeper's life ({@link standDown} releases it) and re-evaluates
   * the SAME predicate on every event. No loop is possible: the belt's own migration write leaves the
   * residue equal to the host's current default — not a stale default — so the very next event takes
   * the observe-only branch.
   *
   * THE SCOPE OF "NOTHING" IS THE CSV, NOT THE FILESYSTEM, and the difference is observable rather than
   * rhetorical: this path still calls {@link settle}, whose `announce()` hands the outcome to the mounted
   * row's own `onChange` consumer, and THAT consumer writes the discovered-ids record
   * (`<root>/.mpd/logs/` + {@link PANEL_IDS_RECORD_NAME}) through {@link recordPanelIds}. So a reader
   * checking "did the stood-down keeper leave no file behind" would be looking at the wrong artifact:
   * the record is written on every settle, including this stand-down, and the CSV is the ONE thing this
   * path never touches (the migration exception above excepted).
   * @param prefs - the bound host store, from the probe answer that carried the version.
   * @param version - the host version the gate parsed; carried into the line so a log reader can
   *   tell WHICH host release stood the keeper down.
   * @param hostDefault - the host's current default, from the SAME probe answer, held for the belt's
   *   per-event re-evaluation of the stale-default predicate; `undefined` leaves the belt
   *   observe-only, which is the unreadable-default degrade.
   * @param migration - the {@link PanelSelfHealMigration} verdict of the migration this stand-down
   *   follows (R2.3): `"refused"` makes the stand-down settle `refused` — the stale list the failed
   *   write left in place is the outcome a reader must see, never a `confirmed` that hides it — while
   *   `"migrated"` and `"none"` settle `confirmed` exactly as before.
   */
  const standDownToHostUnion = (prefs: TuiHostPrefsLike, version: string, hostDefault: string | undefined, migration: PanelSelfHealMigration): void => {
    ticks += 1
    // R2.3 — A REFUSED MIGRATION IS THE OUTCOME, NOT A FOOTNOTE: the settle below used to say
    // `confirmed` unconditionally, which buried the `refused` the migration write had already settled
    // while the stale list remained on the host. The refusal is carried into this stand-down so
    // `panelEnableOutcome()` reports it; the belt is still installed, because its per-event re-check is
    // the retry path for exactly this refusal.
    settle(migration === "refused" ? "refused" : "confirmed", migration === "refused"
      ? `standing down: the host ${version} self-heals the enable CSV (>= ${PANEL_CSV_SELF_HEAL_SINCE}), but the stale-default migration write was refused, so the stale list remains; the belt re-evaluates on the host's next apply`
      : `standing down: the host ${version} self-heals the enable CSV (>= ${PANEL_CSV_SELF_HEAL_SINCE}), so this keeper leaves the list to the host's own union (the stale-default migration aside)`)
    cancelLadder()
    options.log?.(`mpd-tui panel enable keeper: standing down on host ${version} — the host self-heals the sidebar enable CSV, so this keeper never writes it again (the stale-default migration aside)`)
    // THE OBSERVE-ONLY BELT (persistent, S1): subscribe through the store's OWN feed and read every
    // change. A non-stale event is logged ONCE and then watched in silence; an event that re-presents
    // a known stale default is re-migrated — the ONE write the paragraph above carves out. No other
    // write path exists here.
    /** The store's subscribe member, narrowed once; absent on a feed-less build, which costs the belt only. */
    const subscribe = prefs.subscribeSidePanelPanels
    if (typeof subscribe !== "function") return
    /** Whether the belt has said its one observe-only line; later non-stale events stay silent. */
    let said = false
    try {
      /** The host's unsubscribe for the belt, when it returned one. */
      const release = subscribe((): void => {
        // R2.2 — A BELT THAT OUTLIVED ITS RELEASE STAYS SILENT: a host that returned no unsubscribe
        // keeps this listener attached past `stop()`, and a late feed event must not write the retired
        // activation's ids. Checked before the echo guard for the same reason `decide` checks it there.
        if (stopped) return
        // OUR OWN WRITE'S ECHO IS NOT A NEW FACT: the store notifies synchronously from inside the
        // apply, and the belt's own migration write below would otherwise re-enter this listener.
        if (writing) return
        try {
          /** The list as the host's own apply left it, normalized exactly as the merge reads it. */
          const csvNow = normalizePanelCsv(prefs.getSidePanelPanels())
          // THE BELT RE-CHECK (S1): the SAME stale-default predicate the tick migrated under,
          // re-evaluated on EVERY feed event, because the stand-down left `decide` out of the loop and
          // a stale pin can come back mid-session. The merge is the shared pure rule, so the belt and
          // the tick can never drift into two different migrations.
          /** This event's decision, by the SAME pure merge the tick decided with. */
          const merge = mergePanelEnableIds(csvNow, ours, provenPast(), hostDefault)
          if (merge.staleDefault !== "") {
            if (writeList(prefs, merge.csv)) {
              options.log?.(`mpd-tui panel enable keeper (stale-default belt): re-migrated the stale default ${merge.staleDefault} to ${merge.csv} after the host's own apply re-presented it`)
            } else {
              options.log?.(`mpd-tui panel enable keeper (stale-default belt): the re-migration write was refused; the next host apply is re-evaluated`)
            }
            return
          }
          if (said) return
          said = true
          /** Which of our ids the host's union kept. */
          const kept = ours.filter((id) => csvNow.split(",").includes(id))
          options.log?.(`mpd-tui panel enable keeper (observe-only): after the host's own apply the enable list is "${csvNow}"; ${kept.length === ours.length ? `it still carries every id of ours (${kept.join(",")})` : kept.length === 0 ? "it carries NONE of our ids — the host union did not re-add them" : `it carries only ${kept.join(",")} of our ids — the union did not re-add the rest`}`)
        } catch {
          // The belt is diagnostic: a throwing read costs its one line, never the boot.
        }
      })
      if (typeof release === "function") releaseBelt = release as () => void
    } catch {
      // A feed that refuses the belt costs the belt only — the stand-down above already stands.
    }
  }

  /**
   * Install the host's own change feed as this keeper's repair path.
   *
   * Read again only when the store refuses the subscription: a store that throws here is a store whose
   * read cannot be trusted either, so the refusal is recorded and the ladder below stays the path.
   * @param prefs - the bound host store, proved to expose the feed.
   * @param hostDefault - the host's current default the probe read from the SAME contact, held for every
   *   later feed notification: the feed is the repair path that must migrate the stale default when the
   *   configuration mirror rewrites the CSV, and the target cannot be re-derived from the store itself.
   * @returns true when the feed is in force.
   */
  const enterFeed = (prefs: TuiHostPrefsLike, hostDefault: string | undefined): boolean => {
    /** The host's subscribe member, narrowed once. */
    const subscribe = prefs.subscribeSidePanelPanels
    if (typeof subscribe !== "function") return false
    /** The host's own unsubscribe, when it returned one. */
    let release: unknown
    try {
      release = subscribe((): void => decide(prefs, false, hostDefault))
    } catch (error) {
      // RECORDED, NOT SWALLOWED, and the ladder keeps its ticks: a feed that refuses costs this keeper
      // the feed, never the repair.
      feedRefused = String((error as Error)?.message ?? error)
      settle("refused", "the host's change feed refused this keeper")
      return false
    }
    releaseFeed = typeof release === "function" ? (release as () => void) : undefined
    onFeed = true
    // THE LADDER IS DONE the moment the feed is in force: two repair paths racing one CSV is how a
    // half-applied list appears, and the feed is the one that observes the rewrite.
    cancelLadder()
    decide(prefs, true, hostDefault)
    return true
  }

  /**
   * Run one LADDER tick — the degradation for a host whose live setting exposes no change feed.
   *
   * The first tick is also where the feed is detected, so a host that has one never spends a ladder:
   * the probe is the same call either way. Every tick takes its host default from ITS OWN probe answer,
   * which is what puts the migration on this path as well as on the feed's.
   */
  const runTick = (): void => {
    void options.loadPrefs().then((probe) => {
      // R2.2 — A PROBE THAT RESOLVED AFTER `stop()` IS A NON-EVENT: the ladder's cancellers could not
      // cancel a promise already in flight, so this callback is the one place a retired keeper is
      // still reachable — and it reaches EVERY write path (the migration, the belt install, the feed
      // hand-off, `decide`). Returning here is what keeps a disposed scope from both migrating the
      // retired activation's ids and installing a belt subscription nothing will release.
      if (stopped) return
      // R2.1 — THE TICK'S BODY IS CONTAINED. The rejection handler below covers `loadPrefs` only, so
      // a throw from the side-panel read, the migration write or the post-write read inside this
      // callback used to reject the promise `.then` returned with no handler attached — an unhandled
      // rejection instead of the recorded refusal every other keeper failure settles as. `decide`
      // still contains itself; this catch is for the paths it does not own.
      try {
        if (probe.prefs === undefined) {
          ticks += 1
          settle("absent", probe.detail ?? "the host exposes no side-panel enable store")
          return
        }
        // C2 — THE HOST VERSION GATE comes BEFORE either repair path: a host at or past
        // PANEL_CSV_SELF_HEAL_SINCE unions our registered ids back itself (and records explicit
        // `/settings` removals session-wide), so every write this keeper could still make is a race
        // against the host's own merge — or the undo of a removal the user asked for. An unreadable,
        // empty or older version falls through to the legacy behaviour untouched, byte for byte.
        if (hostSelfHealsPanelCsv(probe.hostVersion ?? "")) {
          // 0.16.1+ — THE HOST OWNS THE LIST (G1 of the stateless-deployment wave): the adapter is
          // READ-ONLY here. No migration (the owning host's list is its own registry's), no belt (it
          // existed only to re-migrate) and no feed (no repair to make). This gate is checked FIRST so
          // no write-bearing path below can be reached on a supported host.
          if (hostOwnsPanelCsv(probe.hostVersion ?? "")) {
            standDownOwnedByHost(probe.hostVersion ?? "")
            return
          }
          // S1 — THE STALE-DEFAULT PREDICATE IS EVALUATED BEFORE THIS GATE RETURNS. The stand-down below
          // bypasses `decide` (the only caller of the merge), and the host's own union heals only
          // REGISTERED PLUGIN ids — so without this call a stale builtin pin on a self-healing host is
          // healed by no one. The helper writes ONLY when the full T1 predicate holds and returns;
          // every other case stands down untouched, so C2's "writes nothing" holds everywhere else.
          const migration = migrateStaleDefaultOnSelfHealer(probe.prefs, probe.defaultIds)
          standDownToHostUnion(probe.prefs, probe.hostVersion ?? "", probe.defaultIds, migration)
          return
        }
        // THE FEED OUTRANKS THE LADDER, and the hand-off is attempted on EVERY tick until it lands: a host
        // may expose the store late, and a store that gains the member later is still worth following.
        if (!onFeed && enterFeed(probe.prefs, probe.defaultIds)) return
        decide(probe.prefs, false, probe.defaultIds)
      } catch (error) {
        ticks += 1
        settle("refused", `the migration decision path threw: ${String((error as Error)?.message ?? error)}`)
      }
    }, (error: unknown) => {
      ticks += 1
      settle("absent", `the host store could not be read: ${String((error as Error)?.message ?? error)}`)
    })
  }

  /** Arm the ladder once, from the first observed registration. */
  const arm = (): void => {
    if (armed) return
    armed = true
    for (const delayMs of ladder) {
      try {
        pending.push(options.schedule(runTick, delayMs))
      } catch {
        // A clock that refuses a tick ends the ladder here rather than failing the registration.
        break
      }
    }
  }

  return {
    /** Records one id this activation successfully registered; see {@link PanelEnableKeeper.observe}. */
    observe(id: string): void {
      if (id.length === 0 || ours.includes(id)) return
      ours.push(id)
      state = "requested"
      detail = `settling ${String(ladder.length)} tick(s) for ${ours.join(",")}`
      arm()
      announce()
    },
    /** The keeper's state right now; see {@link PanelEnableKeeper.outcome}. */
    outcome(): PanelEnableOutcome {
      return { state, detail, ids: [...ours], reasserted, ticks }
    },
    /** Cancels every pending tick and detaches the change feed; see {@link PanelEnableKeeper.stop}. */
    stop(): void {
      // R2.2 — the latch is set BEFORE the releases, so no callback the releases miss (a `loadPrefs()`
      // promise resolving after this line, a belt the host never gave an unsubscribe for) can still
      // write or subscribe under the retired activation.
      stopped = true
      standDown()
    },
  }
}

/**
 * The default tick clock: one `setTimeout`, `unref`ed so a keeper never holds a TUI process open.
 * @param run - the tick.
 * @param delayMs - the delay from arming.
 * @returns the canceller.
 */
function defaultPanelKeeperSchedule(run: () => void, delayMs: number): () => void {
  /** The pending timer; `unref` is optional so a non-Node clock still works. */
  const timer = setTimeout(run, delayMs)
  ;(timer as { unref?: () => void }).unref?.()
  return () => { clearTimeout(timer) }
}

/**
 * The file the keeper records the ids it discovered in, under the WORKSPACE.
 *
 * WHY A RECORD AND NOT A CONSTANT. A panel's final id is `<pluginId>:<slug>` and the `<pluginId>`
 * half is the HOST's: for a loader row with no Component identity the host composes its own `act<N>`
 * fallback, so `mpd-tui:team` — the spelling every document used before this was measured — is not
 * what the sidebar ever receives. The only authority on the id is the host's registration read-back,
 * which exists only DURING a boot; this record is how that reading survives the process, so
 * `scripts/mpd-tui-panels.ts` can write a settings value that actually names the running panels.
 * It sits beside the adapter's log because it is written by the same surface for the same reader.
 */
export const PANEL_IDS_RECORD_NAME = "mpd-tui-panels.json"

/**
 * Where the recorded panel ids were READ FROM — the provenance every record now carries.
 *
 * WHY THE RECORD NEEDS PROVENANCE AT ALL, MEASURED. `.mpd/logs/mpd-tui-panels.json` was overwritten on
 * 2026-10-08 with `act0:team,act0:dag,act0:workmate` — ids the INSTALLED host cannot compose, because
 * its `pluginIdFor` fallback counter PRE-INCREMENTS and the first bare activation is therefore `act1`.
 * A unit test run (its panel seam double labels its registrations `act0`) had driven the real recorder,
 * and `scripts/mpd-tui-panels.ts` reads that file to offer a write into the USER's settings layer — so a
 * test run could make the remedy name panels no boot can ever serve. The ids alone cannot say where they
 * came from; this block is what can.
 */
export interface PanelIdsRecordProvenance {
  /** Absolute path of the installed DSH-TUI package the enable store was bound from. */
  hostRoot: string
  /** That package's own `version`, read from its `package.json`. */
  hostVersion: string
  /** The host read-back the ids came from, e.g. `tuiPanels.list`; empty when none was used. */
  readBack: string
  /** The `<pluginId>` half every id shares, e.g. `act1`; empty when the ids do not agree. */
  activation: string
}

/** The on-disk record of the panel ids this activation discovered, as the remedy script reads it. */
export interface PanelIdsRecord {
  /** The record's own schema version; 2 added {@link PanelIdsRecordProvenance}, 3 added {@link history}. */
  version: number
  /** The final host panel ids, in registration order. */
  panelIds: string[]
  /** Each id's `<slug>` half, for a reader that wants the page rather than the activation. */
  slugs: string[]
  /** When the record was last written, ISO-8601. */
  updatedAt: string
  /** Where those ids were read from; the reader refuses a record it cannot prove is a real boot. */
  provenance: PanelIdsRecordProvenance
  /**
   * The ids this bundle registered in EARLIER boots — the ownership evidence both writers prune by.
   *
   * Bounded by construction ({@link PANEL_ID_HISTORY_LIMIT}, newest last) and never carrying a currently
   * live id: the writer folds the previous record's history and its own `panelIds` forward through
   * {@link panelHistoryAfter} on every boot. An absent field (a version-1/2 record) is simply "no proven
   * past", which disables the prune rather than guessing.
   */
  history: string[]
}

/**
 * Read the installed host package's own version.
 *
 * Never throws: an unreadable or version-less package is the EMPTY STRING, which the record's own guard
 * treats as "this record cannot be proved", so a missing version refuses the write instead of stamping a
 * blank field a reader would accept.
 * @param root - the host package root.
 * @returns the version, or "" when it could not be read.
 */
export function readHostPackageVersion(root: string): string {
  try {
    /** The host package's manifest. */
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }
    return typeof manifest.version === "string" ? manifest.version : ""
  } catch {
    return ""
  }
}

/**
 * Build the provenance of one keeper outcome, refusing anything it cannot prove.
 *
 * THE TWO REFUSALS ARE BOTH MEASURED, and they are the whole reason this function exists rather than the
 * caller stamping fields by hand:
 *   * no host root or no host version — the ids cannot be traced to an installed package, so the record
 *     would be a claim a reader has no way to check. A WHITESPACE-ONLY field counts as absent, which is
 *     the rule the consumer side (`scripts/mpd-tui-panels.ts`) already applies: the two sides of this
 *     file must agree on what a provable record is, or the writer and the reader disagree about the same
 *     bytes;
 *   * an `act0` activation — the installed host's `pluginIdFor` PRE-INCREMENTS its fallback counter, so
 *     the first bare activation it can compose is `act1` and `act0` is impossible in a real boot. That
 *     is exactly the shape a test double produced while driving the real recorder.
 * @param host - the host package the enable store was bound from, or undefined when none bound.
 * @param readBack - the host read-back the ids came from; empty when none was used.
 * @param ids - the ids this outcome carries.
 * @returns the provenance, or the ONE reason it cannot be proved.
 */
export function panelRecordProvenance(
  host: { root: string; version: string } | undefined,
  readBack: string,
  ids: readonly string[],
): { provenance: PanelIdsRecordProvenance } | { refused: string } {
  if (host === undefined || host.root.trim() === "" || host.version.trim() === "") {
    return { refused: "no installed host package could be named (root and version), so the ids cannot be traced to a boot" }
  }
  if (readBack.trim() === "" || ids.length === 0) {
    return { refused: "the ids did not come from a host read-back, so the record would name panels nothing verified" }
  }
  /** The `<pluginId>` half of the FIRST id; every other id must agree with it. */
  const activation = ids[0]!.slice(0, ids[0]!.indexOf(":"))
  for (const id of ids) {
    if (id.slice(0, id.indexOf(":")) !== activation) {
      return { refused: `the ids do not share one activation (${activation} and ${id.slice(0, id.indexOf(":"))}), so they cannot have come from one registration` }
    }
  }
  // THE HOST'S OWN COUNTER PRE-INCREMENTS, so `act0` is a value no real boot can produce; a record that
  // carries it would send the remedy script after panels the sidebar can never serve.
  if (/^act0$/u.test(activation)) {
    return { refused: `activation ${activation} is impossible: the host's pluginIdFor pre-increments its fallback counter, so the first composed activation is act1` }
  }
  return { provenance: { hostRoot: host.root, hostVersion: host.version, readBack, activation } }
}

/**
 * The non-empty strings of one unknown JSON field, in order.
 *
 * A record is DATA: every field is narrowed at the boundary rather than trusted, so a hand edit or an
 * older schema degrades to "nothing to read" instead of reaching a prune decision as a non-string.
 * @param value - the parsed field.
 * @returns its string entries, or the empty list for anything else.
 */
function stringIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
}

/**
 * Read the panel-id record's PROVABLE past registrations for one workspace root.
 *
 * The ownership evidence the prune rests on, so this reader enforces the WRITER's own refusals instead of
 * trusting the file: no `provenance` block, a blank `hostVersion`, no `readBack` or an `act0` activation
 * is "no proven past" ({@link panelRecordProvenance} is run over the record's current ids, so the two
 * sides of the file cannot disagree about what a provable record is). The record's CURRENT ids are
 * offered as past too — they were a previous boot's live set — and the `not live now` half of the rule
 * discards the ones that are still live. On top of that every candidate is filtered to the shape the host
 * composes for a loader row and capped, so neither a foreign id nor a hand edit can widen the prune.
 *
 * Never throws: an absent, unreadable or unprovable record means "no proven past", which disables the
 * prune rather than guessing — the keeper then behaves exactly as it did before this evidence existed.
 * @param root - the workspace root the record lives under; defaults to {@link defaultLogRoot}.
 * @returns the bounded past registrations, oldest first.
 */
export function readPanelIdRecordPast(root: string = defaultLogRoot()): string[] {
  try {
    /** The record's absolute path: the same `<root>/.mpd/logs/<name>` {@link recordPanelIds} writes. */
    const file = join(root, ".mpd", "logs", PANEL_IDS_RECORD_NAME)
    /** The parsed record; every field below is narrowed rather than trusted. */
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { panelIds?: unknown; history?: unknown; provenance?: unknown }
    /** The record's current ids, which are also the set the provenance rules are checked against. */
    const ids = stringIdsOf(parsed.panelIds)
    if (ids.length === 0) return []
    /** The record's own provenance block, read as fields rather than as a typed object. */
    const provenance = (typeof parsed.provenance === "object" && parsed.provenance !== null ? parsed.provenance : {}) as Partial<PanelIdsRecordProvenance>
    /** The ONE reason these ids cannot be traced to a boot; a refusal means no proven past at all. */
    const proved = panelRecordProvenance(
      typeof provenance.hostRoot === "string" && typeof provenance.hostVersion === "string" ? { root: provenance.hostRoot, version: provenance.hostVersion } : undefined,
      typeof provenance.readBack === "string" ? provenance.readBack : "",
      ids,
    )
    if ("refused" in proved) return []
    return panelHistoryAfter([], [...stringIdsOf(parsed.history), ...ids])
  } catch {
    return []
  }
}

/**
 * Write the discovered panel ids under the workspace, for the remedy script to read.
 *
 * Never throws: a record that cannot be written is a missing convenience, never a failed boot, and the
 * keeper's outcome is what the boot line reports either way. A record it cannot PROVE is not written at
 * all — see {@link panelRecordProvenance} — because the file's only reader offers to write its ids into
 * the user's settings layer.
 *
 * WHAT THIS WRITE ADDS (repair round R1): the record now carries the bundle's bounded PAST registrations
 * as well as its current ids, because that history is the only evidence that makes an earlier boot's
 * token provably ours. The history is folded through {@link panelHistoryAfter} — the previous record's
 * history plus its own current ids, minus everything live now, capped — and it is read back through
 * {@link readPanelIdRecordPast}, so a polluted record contributes NOTHING to it instead of propagating
 * ids a real boot cannot compose.
 * @param outcome - the keeper's state at the change.
 * @param host - the host package the enable store was bound from, or undefined when none bound.
 * @param readBack - the host read-back the ids came from; empty when none was used.
 */
function recordPanelIds(outcome: PanelEnableOutcome, host: { root: string; version: string } | undefined, readBack: string): void {
  /** What this record can prove about where its ids came from. */
  const proved = panelRecordProvenance(host, readBack, outcome.ids)
  if ("refused" in proved) return
  try {
    /** The record's absolute path: `<root>/.mpd/logs/<name>`. */
    const file = join(defaultLogRoot(), ".mpd", "logs", PANEL_IDS_RECORD_NAME)
    mkdirSync(dirname(file), { recursive: true })
    /** The record, as ONE object so its shape and its writer cannot disagree. */
    const record: PanelIdsRecord = {
      version: 3,
      panelIds: [...outcome.ids],
      slugs: outcome.ids.map(panelSlugOf),
      updatedAt: new Date().toISOString(),
      provenance: proved.provenance,
      history: panelHistoryAfter(outcome.ids, readPanelIdRecordPast(defaultLogRoot())),
    }
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  } catch {
    // Never a failed boot for a convenience file.
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
  /**
   * Run the sidebar enable-list keeper (the second host-internals contact). OPT-IN and passed ONLY
   * by the mounted adapter row, for the same reason as {@link TuiAdapterOptions.probeHostContact}:
   * a row-private fallback adapter must not schedule timers or touch the user's live sidebar.
   */
  keepPanelEnable?: boolean
  /** Where the keeper's ONE settle line goes; defaults to {@link TuiAdapterOptions.hostInputLog}. */
  panelEnableLog?: (line: string) => void
  /** The ladder the keeper walks; defaults to {@link PANEL_KEEPER_LADDER_MS} (unit tests only). */
  panelEnableLadder?: readonly number[]
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
   * Closes whichever scene is ACTIVE — dsh-tui 0.15.0's `close()` takes NO id and returns void.
   *
   * The member is optional because a host build without it closes a scene through the `close()` on
   * its own props instead; {@link TuiAdapter.closeScene} then reports `false` rather than inventing
   * a member.
   */
  close?(): void
  /**
   * The scene currently replacing the conversation, when the host exposes the read (0.15.0 does).
   *
   * This is what makes an ID-addressed close honest: the host's `close()` names no scene, so the
   * adapter only reports a successful close for the id this read-back proves to be active.
   */
  active?: TuiSceneDescriptor | undefined
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
   * The host's read-only backend-admission probe (dsh-tui 0.15.0 added it to `TuiPluginHost`).
   *
   * DECLARED BUT DELIBERATELY UNCONSUMED: it is the evidence the host publishes its `Backend`
   * contribution contract on, and it registers, imports and writes nothing — but no mpd surface asks
   * for a backend today, so declaring the member documents the family without inventing a consumer.
   * @returns the probe's verdict facts; absent on every host build before 0.15.0.
   */
  probeBackendAdmission?(): TuiBackendAdmissionProbeLike
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

/** The facts dsh-tui 0.15.0's `BackendAdmissionProbe` reports (read-only; registers nothing). */
export interface TuiBackendAdmissionProbeLike {
  /** Entries the registry holds: the built-in seed plus every registration. */
  readonly registered: number
  /** How many of them a picker may offer (not `waiting_authorization`). */
  readonly offered: number
  /** What a synthetic third-party declaration was admitted as; the probe accepts only `compatible`. */
  readonly verdict: "compatible"
}

/**
 * `ctx.tuiToast` — transient host notifications.
 *
 * SHAPE RE-DERIVED from the installed dsh-tui 0.15.0 declaration
 * (`lib/types/dsh-adapter/toast.d.ts`): the plugin-facing runtime is `show(text, options) → boolean`,
 * NOT a `push(message)` returning a dismissal handle. No mpd surface calls a toast yet; the member is
 * declared so a later consumer compiles against the host's real contract, and a host build that
 * reshapes it degrades into `absent`/`refused` like every other seam here.
 */
export interface TuiToastLike {
  /**
   * Shows one transient toast.
   * @param text - the display text: a string, number or boolean (anything else is refused by the host).
   * @param options - the host's optional color key and auto-dismiss timeout (`[500, 12000]` ms).
   * @returns true when the host delivered the toast; false when it refused the input or dropped it
   * (no sink, rate limit) — the host never throws on a toast.
   */
  show(text: string | number | boolean, options?: { color?: "success" | "warning" | "error"; timeoutMs?: number }): boolean
}

/** The base palette a runtime theme overlays, exactly the 0.15.0 `TuiThemeBase` union. */
export type TuiThemeBaseLike = "light" | "dark" | "dark-ansi" | "claude-dark" | "claude-paper" | "codex-lavender" | "codex-paper"

/**
 * One runtime theme declaration, as dsh-tui 0.15.0's `TuiThemeDescriptor` carries it.
 *
 * `colors` is WIDENED to `string` keys on purpose: the host narrows them to its own `ThemeColorKey`
 * union, and duplicating that palette list here would let a host release that adds one key redden a
 * declaration that is otherwise correct.
 */
export interface TuiThemeDescriptorLike {
  /** The theme name this registration introduces. */
  name: string
  /** The picker label; the host defaults it to the name. */
  displayName?: string
  /** The built-in palette this theme overlays. */
  base: TuiThemeBaseLike
  /** Palette overrides, keyed by the host's own color keys. */
  colors?: Readonly<Partial<Record<string, string>>>
}

/**
 * `ctx.tuiThemes` — the runtime theme registry.
 *
 * SHAPE RE-DERIVED from 0.15.0 (`lib/types/dsh-adapter/themes.d.ts`): `register` takes a
 * DESCRIPTOR plus the optional trailing caller identity — not `(name, theme)` — and returns a
 * disposer (an invalid or duplicate declaration gets an inert one, never `undefined`). The old
 * `current()` member is gone: the 0.15.0 runtime exposes no read on the plugin face — `getSnapshot`/
 * `resolve` live on the host-only `getHostThemes()` facade.
 */
export interface TuiThemesLike {
  /**
   * Registers one immutable runtime palette, bound to the caller's activation.
   * @param descriptor - the theme declaration the host validates.
   * @param identity - the caller's own context; the host binds the registration to it.
   * @returns the disposer, inert when the host refused the declaration.
   */
  register(descriptor: TuiThemeDescriptorLike, identity?: unknown): Disposer
}

/** The per-namespace handle dsh-tui 0.15.0's `tuiPluginStorage.open(ctx)` returns. */
export interface TuiPluginStorageHandleLike {
  /**
   * Reads one key of the caller's own namespace.
   * @param input - the key to read.
   * @returns the stored value, or null when the key is absent.
   */
  get(input: { key: string }): Promise<{ value: unknown | null }>
  /**
   * Writes one key of the caller's own namespace.
   * @param input - the key and its exact-JSON value.
   * @returns `{stored: true}`; quota or validation failures reject with the host's error code.
   */
  set(input: { key: string; value: unknown }): Promise<{ stored: true }>
  /**
   * Deletes one key of the caller's own namespace.
   * @param input - the key to delete.
   * @returns whether a key was actually removed.
   */
  delete(input: { key: string }): Promise<{ deleted: boolean }>
}

/**
 * `ctx.tuiPluginStorage` — per-plugin durable key/value storage (the `storage.local` contract).
 *
 * SHAPE RE-DERIVED from 0.15.0 (`lib/types/dsh-adapter/plugin-storage.d.ts`): the service is not a
 * flat `get`/`set`; it OPENS a namespace for the caller's own verified activation and hands back an
 * async `{get,set,delete}` handle. The namespace is derived from the passed context, so there is no
 * parameter that could name another plugin.
 */
export interface TuiPluginStorageLike {
  /**
   * Opens the caller's private namespace.
   * @param pluginCtx - the caller's own activation context (the identity the namespace derives from).
   * @returns the handle whose calls are grant-checked per invocation.
   */
  open(pluginCtx: unknown): TuiPluginStorageHandleLike
}

/**
 * `ctx.tuiMessageObserver` — read-only observation of the session's message stream.
 *
 * SHAPE RE-DERIVED from 0.15.0 (`lib/types/dsh-adapter/message-observer.d.ts`): `subscribe` takes
 * the caller's context, the listener AND a REQUIRED `{scope}` object, and returns a plain disposer.
 * The exact scope string is what isolates one session's sensitive envelopes from another's; the old
 * one-argument `subscribe(listener)` shape named no scope and could not have matched this host.
 */
export interface TuiMessageObserverLike {
  /**
   * Subscribes to the observation envelopes of ONE scope.
   * @param pluginCtx - the caller's own activation context (the identity grants are checked against).
   * @param listener - receives each envelope addressed to `scope`; may return a promise.
   * @param options - the required `scope` (`session:<sessionId>`); delivery never crosses it.
   * @returns the subscription's disposer; a denied subscription gets a no-op one.
   */
  subscribe(pluginCtx: unknown, listener: (envelope: unknown) => void | Promise<void>, options: { scope: string }): Disposer
}

/**
 * One effect-ledger record, as dsh-tui 0.15.0's `LedgerEntry` declares it.
 *
 * The host fills the lifecycle triple (pluginId / activationInstance / runtimeGenerationId) itself,
 * so a caller never supplies it.
 */
export interface TuiEffectLedgerEntryLike {
  /** The effect's lifecycle operation. */
  operation: "create" | "bind" | "replace" | "release" | "cleanup-failed"
  /** The resource the record is about. */
  resource: { kind: string; id: string }
  /** The operation's outcome. */
  result: "applied" | "pending" | "failed"
  /** The contract error code when `result` is `failed`. */
  errorCode?: string
  /** What this record supersedes (`operation: "replace"`). */
  replaces?: { resourceId?: string; activationInstance?: string }
  /** `sha256:<64hex>` digest of an opaque value the record must reference. */
  valueDigest?: string
}

/**
 * `ctx.tuiEffectLedger` — the host's append-only journal of plugin-visible effects.
 *
 * SHAPE RE-DERIVED from 0.15.0 (`lib/types/dsh-adapter/effect-ledger.d.ts`): the plugin face is
 * `record(entry, identity?)`, not a readable `entries()` — nothing on the plugin side can list the
 * journal. MEASURED UNREACHABLE from a plugin activation in the probed build
 * (`evidence/tui/plugin/20260915T060934Z/mount/renderer-type-probe/FINDING-CORRECTION.md`), which is
 * why nothing in the bundle records either: binding and reporting the seam is the honest treatment of
 * a member set that exists in the composition but not on this channel.
 */
export interface TuiEffectLedgerLike {
  /**
   * Appends one record.
   * @param entry - the effect record the host validates before writing.
   * @param identity - the caller's own context (omitting it records `undeclared`, never a guess).
   * @returns nothing; recording is observability and never throws.
   */
  record(entry: TuiEffectLedgerEntryLike, identity?: unknown): void
}

/** One workspace target, as dsh-tui 0.15.0's `TuiWorkspaceTarget` declares it. */
export interface TuiWorkspaceTargetLike {
  /** Stable, user-pasteable target identifier. */
  uri: string
  /** The host-side cwd recorded in the session header. */
  cwd: string
  /** Compact picker/status label. */
  label: string
  /** Optional secondary picker copy. */
  description?: string
  /** Whether the target is a local path or a provider-owned location. */
  kind: "local" | "provider"
  /** Provider-owned compact badge; the TUI does not interpret it. */
  badge: string
}

/**
 * One workspace provider, as dsh-tui 0.15.0's `TuiWorkspaceProvider` declares it.
 *
 * The host's interface also carries optional `resolvePath`, `commandShell`, `rename` and `commands`
 * members; they are NOT declared here because nothing in the bundle registers a provider yet, and a
 * declaration nobody exercises is a claim this adapter cannot keep honest.
 */
export interface TuiWorkspaceProviderLike {
  /** URI schemes owned by this provider, without the trailing colon. */
  schemes: readonly string[]
  /**
   * Enumerates the targets this provider owns.
   * @param signal - cancels a slow discovery.
   * @returns the targets, in the provider's own order.
   */
  list(signal?: AbortSignal): Promise<readonly TuiWorkspaceTargetLike[]> | readonly TuiWorkspaceTargetLike[]
  /**
   * Resolves one provider URI.
   * @param uri - the reference to resolve.
   * @param signal - cancels the resolution.
   * @returns the target, or undefined when the scheme is not this provider's.
   */
  resolve(uri: string, signal?: AbortSignal): Promise<TuiWorkspaceTargetLike | undefined> | TuiWorkspaceTargetLike | undefined
  /**
   * Describes an already-recorded cwd without performing I/O.
   * @param cwd - the directory to describe.
   * @returns the target, or undefined when this provider does not own the cwd.
   */
  describe(cwd: string): TuiWorkspaceTargetLike | undefined
}

/**
 * `ctx.tuiWorkspaces` — the workspace registry.
 *
 * SHAPE RE-DERIVED from 0.15.0 (`lib/types/dsh-adapter/workspaces.d.ts`): `list` takes the CALLING
 * cwd (plus an optional abort signal) and answers a promise of `TuiWorkspaceTarget` objects, not a
 * synchronous list of path strings; `register` is the provider entry point.
 */
export interface TuiWorkspacesLike {
  /**
   * Registers one workspace provider, bound to the caller's activation.
   * @param provider - the provider whose targets join the picker.
   * @returns the disposer that drops the registration.
   */
  register(provider: TuiWorkspaceProviderLike): Disposer
  /**
   * Lists the targets this host serves for one calling cwd.
   * @param currentCwd - the caller's own cwd, which routes the local provider.
   * @param signal - cancels the enumeration.
   * @returns every target the host can offer from `currentCwd`.
   */
  list(currentCwd: string, signal?: AbortSignal): Promise<readonly TuiWorkspaceTargetLike[]>
}

/**
 * `ctx.tuiPanels` — the sidebar panel registry, ADDED BY dsh-tui 0.13.0.
 *
 * This is the seam the bundle's upstream panel ask was answered with: a plugin contributes a
 * right-hand sidebar panel (a `component` slot, plus a `compact` row slot the 0.13.0 host validates
 * and stores but does NOT mount), and the HOST owns admission, the per-plugin budget (≤4) , the
 * global budget (≤32) and crash isolation.
 *
 * Its ABSENCE is also the version discriminator the legacy Ctrl+A host-input contact arms on: a host
 * that offers this seam is a host where that contact must stay inert, because the panel is reachable
 * through MPD's own key instead ({@link TuiAdapter.panelSeamBound}).
 */
export interface TuiPanelsLike {
  /** Registers one panel; the host prefixes the slug with the calling activation's plugin id. */
  register(descriptor: TuiPanelDescriptorLike, identity?: unknown): Disposer | undefined
  /** The panels registered BY THE CALLING ACTIVATION — the read-back that proves a registration. */
  list?(): readonly TuiPanelSummaryLike[]
  /** Opens one of the caller's own panels; false when refused, rate-limited or unconsumed. */
  open?(id: string): boolean
  /** Closes one of the caller's own panels. */
  close?(id: string): boolean
  /** Sets or clears the caller's own panel badge. */
  badge?(id: string, badge: { level: string; unread: number } | null): boolean
}

/** One sidebar panel descriptor, as dsh-tui 0.13.0 validates it. */
export interface TuiPanelDescriptorLike {
  /** The host's panel API version; the host refuses every other value (0.13.0 accepts exactly 1). */
  apiVersion: 1
  /** A single lowercase slug; the host composes the final id as `<pluginId>:<slug>`. */
  id: string
  /** The display title (non-empty; the host sanitises it to at most 80 cells). */
  title: string
  /** Optional icon whose DISPLAY width must be exactly one cell. */
  icon?: string
  /** Optional sidebar width floor, an integer from 12 to 64 (the host's own default is 28). */
  minColumns?: number
  /** Optional ordering hint within the host's panel bar. */
  order?: number
  /** The full panel component, rendered BY THE HOST with its own React and ui kit. */
  component?: unknown
  /** The compact row slot: validated and stored by 0.13.0, NOT mounted (the host's own TODO §18.1). */
  compact?: { maxRows: 1 | 2 | 3; component: unknown }
}

/** One row of the host's panel read-back; the id is the `<pluginId>:<slug>` the HOST composed. */
export interface TuiPanelSummaryLike {
  /** The final id, host-prefixed. */
  id: string
  /** The title the host stored. */
  title: string
  /** `plugin` for every plugin-registered panel. */
  source: string
}

/**
 * `ctx.tuiPrompt` — a PHANTOM seam id (in {@link PHANTOM_SEAM_KEYS}).
 *
 * NO HOST DECLARES IT: a grep of dsh-tui 0.15.0's own `lib/**` finds no `tuiPrompt` service and no
 * `prompt`-slot registration surface, so this interface cannot be "re-derived" from anything — it is
 * a shape kept ONLY so the phantom id has a type and the inventory reports its absence as a fact
 * rather than a composition gap. `docs/tui.md` (seam 2) records the decision to claim nothing about
 * it. Nothing in the bundle calls it.
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
  /**
   * Closes a scene by id; false when this host build exposes no close member, or when the host owns
   * no active-scene read that names the id (its close() takes no id — see {@link TuiScenesLike.close}).
   */
  closeScene(id: string): boolean
}

/**
 * The handle a sidebar panel registration returns.
 *
 * `id()` is the FINAL host id (`<pluginId>:<slug>`), DISCOVERED from the host's own `list()`
 * read-back rather than composed here: the plugin-id half comes from a Component identity this
 * bundle's plain loader row does not carry, so the host falls back to a per-activation `act<N>`
 * name that cannot be predicted from this side. It stays undefined until the seam binds and a
 * read-back proves the registration.
 */
export interface PanelRegistrationHandle extends SeamBindingHandle {
  /** The final host panel id, or undefined while unbound, refused, or without a host read-back. */
  id(): string | undefined
  /** Releases the registration early; the activation's own teardown runs it too, exactly once. */
  dispose(): void
}

/**
 * The result of one panel-open request.
 *
 * `opened()` is the HOST's own answer whenever the seam was BOUND at call time: true means the
 * request reached the side panel, false means the host refused it (not this activation's panel, rate
 * limited to one open per 5000 ms, or no live panel consumer). It is undefined when the request was
 * QUEUED because the seam had not bound yet — so a caller that needs a synchronous routing decision
 * (panel or the legacy scene) tests {@link TuiAdapter.panelSeamBound} first.
 */
export interface PanelOpenResult extends SeamBindingHandle {
  /** The host's answer, or undefined when the request was queued instead of answered. */
  opened(): boolean | undefined
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
  /**
   * Retained for source compatibility and deliberately NOT forwarded: a mediated decision
   * subscription's identity must be the CALLING ACTIVATION, which this adapter supplies from the
   * bound injected scope (the same rule as {@link TuiAdapter.setStatus}). The host's
   * `assertCallerContext` compares the identity against the caller it resolved for THIS activation
   * and refuses anything else, so a consumer-supplied ctx here is a guaranteed refusal.
   */
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
  /**
   * The sidebar enable-list keeper's state. ALSO not a seam: it is the second — and, by §6's count,
   * the LAST — load-time reach into the installed DSH-TUI (see {@link probeHostPrefs}), reported
   * here so a boot can tell whether the panels were kept enabled without reading the pane.
   */
  panelEnable: PanelEnableOutcome
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
  /** The bound sidebar panel registry, or undefined on every host before dsh-tui 0.13.0. */
  panels(): TuiPanelsLike | undefined
  /** The bound prompt slot, or undefined — `tuiPrompt` is a PHANTOM id no measured host declares. */
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
  /**
   * Closes a scene by id; false when this host build exposes no close member, or when the host owns
   * no active-scene read that names the id (its close() takes no id — see {@link TuiScenesLike.close}).
   */
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
  /**
   * Registers the sidebar panel through the `panels` seam (dsh-tui 0.13.0+).
   *
   * Safe to call at apply time: with the deferred binder the call is queued until the seam binds, and
   * on a host that never offers the seam it settles as `absent` without a throw.
   * @param descriptor - the panel descriptor, as the host validates it (apiVersion exactly 1).
   * @returns the registration handle carrying the DISCOVERED final id.
   */
  registerPanel(descriptor: TuiPanelDescriptorLike): PanelRegistrationHandle
  /**
   * Asks the host to open one panel THIS activation registered.
   * @param id - the final id {@link PanelRegistrationHandle.id} discovered at registration.
   * @returns the request handle, whose `opened()` is the host's answer when the seam was bound.
   */
  openPanel(id: string): PanelOpenResult
  /**
   * Whether the sidebar panel seam is bound right now.
   *
   * NOT a capability report but the ARBITER between this bundle's two panel surfaces: `alt+a` and
   * `/mpd panel` route through the panel seam when this is true and through the legacy full-screen
   * scene when it is false, and the legacy Ctrl+A host-input contact arms ONLY while it is false.
   */
  panelSeamBound(): boolean
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
  /**
   * How the sidebar enable-list keeper settled: which ids this activation registered, whether the
   * host store bound, and how many times the enable CSV had to be re-asserted. Reported separately
   * from {@link TuiAdapter.seamOutcomes} because it is NOT a seam — see {@link probeHostPrefs}.
   */
  panelEnableOutcome(): PanelEnableOutcome
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

  // ── the sidebar enable-list keeper: the SECOND host-internals contact, armed by a registration ──
  //
  // The keeper is created for EVERY adapter but ARMS only when the mounted row opted in, so a
  // row-private fallback adapter schedules nothing and touches no sidebar. Its ONE settle line goes
  // to the same file sink the host-contact probe uses (never a terminal — requirement R5).
  /** The host package the enable store was last bound from, with its own version, for the record. */
  let panelHostProvenance: { root: string; version: string } | undefined
  /** The host read-back this activation's ids came from; empty until the host's own list produced one. */
  let panelIdReadBack = ""
  /** The ladder's clock; a caller-supplied one lets a unit test own the timing. */
  const panelKeeperOptions: PanelEnableKeeperOptions = {
    // The probe's own root is REMEMBERED, not re-derived: the record has to name the package the ids
    // were actually read from, and a second probe could bind a different candidate.
    loadPrefs: async (): Promise<HostPrefsProbeResult> => {
      /** This tick's probe answer. */
      const probe = await probeHostPrefs(hostRootCandidates())
      if (probe.root !== undefined) panelHostProvenance = { root: probe.root, version: readHostPackageVersion(probe.root) }
      return probe
    },
    schedule: defaultPanelKeeperSchedule,
    // THE OWNERSHIP EVIDENCE (repair round R1): the ids this bundle registered in earlier boots, read
    // from the record ON EVERY DECISION — the record is rewritten by this same boot, and a value sampled
    // once at construction could already be a boot stale. The reader never throws; a missing or
    // unprovable record means "no proven past", so the keeper simply never prunes.
    pastIds: (): readonly string[] => readPanelIdRecordPast(),
    ...(options.panelEnableLadder === undefined ? {} : { ladder: options.panelEnableLadder }),
    log: options.panelEnableLog ?? options.hostInputLog ?? defaultHostInputLog,
    // The DISCOVERED ids leave the host process through this record; the mounted row is the only
    // adapter that writes it, so a unit test never touches the workspace. The record is additionally
    // gated on PROVENANCE (see `recordPanelIds`): ids it cannot trace to an installed host package and a
    // real read-back are not written at all, because the file's only reader offers to write them into the
    // user's settings layer.
    onChange: options.keepPanelEnable === true
      ? (outcome): void => {
        // THE SCOPE CLEANUP IS INSTALLED ON THE FIRST OBSERVED ID, not at adapter construction: a
        // composition that never registers a panel has nothing to release, and an effect installed
        // anyway would be one durable registration a seam-less boot must not own.
        if (!panelKeeperOwned) {
          panelKeeperOwned = true
          effectOn(ctx, () => { panelKeeper.stop() }, "mpd-tui panel enable keeper")
        }
        recordPanelIds(outcome, panelHostProvenance, panelIdReadBack)
      }
      : undefined,
  }
  /** The bounded re-assert of the ids this activation registered; see {@link createPanelEnableKeeper}. */
  const panelKeeper: PanelEnableKeeper = options.keepPanelEnable === true
    ? createPanelEnableKeeper(panelKeeperOptions)
    : {
      observe: (): void => {
        // Not opted in: the id is deliberately forgotten, so `panelEnableOutcome()` reports `absent`
        // instead of a settler that could never have run.
      },
      outcome: (): PanelEnableOutcome => ({ state: "absent", detail: "this adapter did not keep the host panel enable list", ids: [], reasserted: 0, ticks: 0 }),
      stop: (): void => {},
    }
  /** Whether the keeper's own scope cleanup was installed; it is installed on the first observed id. */
  let panelKeeperOwned = false
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
    panels: () => bindings.panels.service as TuiPanelsLike | undefined,
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

    /**
     * Closes a scene; false when the seam is absent, the host build exposes no close member, or the
     * host's own `active` read does not name this id.
     *
     * dsh-tui 0.15.0's `close()` takes NO id and returns void — it closes whichever scene is ACTIVE.
     * The previous implementation guarded on `close(id) === true`, which a void call can never
     * satisfy, so it answered `false` on every 0.15.0 build; calling `close()` blind would instead
     * report success for a scene that was never open AND close the wrong scene. The active read-back
     * is therefore the discriminator: the call is made, and `true` returned, ONLY when the host
     * itself says this id is the active scene.
     */
    closeScene(id: string): boolean {
      /** The bound scene registry, absent when the seam never bound. */
      const registry = bindings.scenes.service as TuiScenesLike | undefined
      if (registry === undefined || typeof registry.close !== "function") return false
      /** The id the host reports as active; undefined when it exposes no read or reads nothing. */
      let activeId: unknown
      try {
        activeId = registry.active?.id
      } catch {
        activeId = undefined
      }
      if (activeId !== id) return false
      try {
        registry.close()
        return true
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

    /** Registers the sidebar panel; see {@link TuiAdapter.registerPanel}. */
    registerPanel(descriptor: TuiPanelDescriptorLike): PanelRegistrationHandle {
      /** The registration's handle. */
      const handle = makeHandle("panels")
      /** The final host-composed id, discovered from the host's own read-back. */
      let finalId: string | undefined
      /** The host's own disposer, kept so `dispose()` can release the panel before teardown. */
      let release: Disposer | undefined
      /** Whether the host's disposer already ran; keeps `dispose()` idempotent. */
      let disposed = false
      /** Releases the registration early; also run — exactly once — by the activation's teardown. */
      const dispose = (): void => {
        if (disposed) return
        disposed = true
        /** The host's disposer, captured before the field is cleared. */
        const call = release
        release = undefined
        finalId = undefined
        if (typeof call !== "function") return
        try {
          call()
        } catch {
          // A host disposer that throws must not break the activation's teardown.
        }
      }
      whenBoundInternal("panels", (service, scope) => {
        /** The bound panel registry, before `register` is trusted. */
        const registry = service as TuiPanelsLike
        if (typeof registry?.register !== "function") {
          handle.record({ state: "refused", detail: `${TUI_SEAMS.panels}.register is missing` })
          return
        }
        // The ids THIS activation had registered before the call, so the id the host composes can be
        // DISCOVERED from the read-back: the `<pluginId>` half is the host's, not ours to predict.
        /** The ids visible to this activation before the registration. */
        const before = new Set((typeof registry.list === "function" ? registry.list() ?? [] : []).map((row) => row.id))
        try {
          // The identity is the INJECTED SCOPE — the calling activation. The host's own
          // `requirePluginCaller` refuses a consumer ctx, and the same mistake made every
          // `tuiStatus` registration silently refuse on 0.12.0 (see `setStatus`).
          //
          // THE HOST'S RETURN IS NOT A PROOF. MEASURED against the installed 0.13.0 host
          // (`lib/types/dsh-adapter/panels.js`): `register()` returns the disposer ONLY on success
          // and `undefined` on EVERY refusal path (wrong apiVersion, bad id/title/icon/compact/
          // minColumns, the ≤4 per-plugin or ≤32 global budget, no live activation owner, a foreign
          // identity, a failed effect bind). The read-back below — not this return value — is what
          // distinguishes the two, which is why a missing new id is reported as REFUSED.
          /** The host's disposer, or `undefined` when the host refused the descriptor. */
          const disposer = registry.register(descriptor, scope)
          if (typeof disposer === "function") {
            release = disposer
            effectOn(scope, dispose, `mpd-tui panel ${descriptor.id}`)
          }
          /** The host's read-back, bound once: present only when the host exposes it at all. */
          const readBack = typeof registry.list === "function" ? registry.list.bind(registry) : undefined
          if (readBack !== undefined) {
            finalId = (readBack() ?? []).map((row) => row.id).find((id) => !before.has(id))
          }
          handle.record(finalId !== undefined
            ? { state: "confirmed", detail: `${finalId} registered` }
            : readBack !== undefined
              ? { state: "refused", detail: `${descriptor.id} refused (the host added no id to its own list() read-back)` }
              : { state: "requested", detail: `${descriptor.id} requested (the host exposes no panel read-back to prove it)` })
          // ONLY an id the host's own read-back produced is handed to the keeper. A descriptor whose
          // registration was refused (or a host without a read-back) contributes nothing, so the
          // keeper can never write an id this activation does not actually own.
          if (finalId !== undefined) {
            // THE READ-BACK IS NAMED, not merely used: the record carries where its ids came from, and
            // this is the one place that knows a host list answered rather than a component identity.
            panelIdReadBack = readBack !== undefined ? "tuiPanels.list" : ""
            panelKeeper.observe(finalId)
          }
        } catch (error) {
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return { ...handle, id: () => finalId, dispose }
    },

    /** Asks the host to open one of this activation's panels; see {@link TuiAdapter.openPanel}. */
    openPanel(id: string): PanelOpenResult {
      /** The request's handle. */
      const handle = makeHandle("panels")
      /** The host's answer; undefined while the request is queued or the seam never bound. */
      let opened: boolean | undefined
      whenBoundInternal("panels", (service) => {
        /** The bound panel registry, before `open` is trusted. */
        const registry = service as TuiPanelsLike
        if (typeof registry?.open !== "function") {
          // A BOUND SEAM WITH NO `open` MEMBER is a legal host shape (`open` is optional in
          // {@link TuiPanelsLike}), and it must not read as "queued forever": the request cannot be
          // made, so the answer is an explicit `false` — a caller that routes on `opened()` then
          // falls back to its other surface instead of waiting for an answer that never comes.
          opened = false
          handle.record({ state: "refused", detail: `${TUI_SEAMS.panels}.open is missing on this host build` })
          return
        }
        try {
          opened = registry.open(id) === true
          handle.record(opened
            ? { state: "confirmed", detail: `${id} handed to the side panel` }
            : { state: "refused", detail: `${id} refused (not this activation's panel, one open per 5000 ms, or no live panel consumer)` })
        } catch (error) {
          opened = false
          handle.record({ state: "refused", detail: String((error as Error)?.message ?? error) })
        }
      })
      return { ...handle, opened: () => opened }
    },

    /** Whether the sidebar panel seam is bound; the panel-vs-scene arbiter. */
    panelSeamBound: (): boolean => bindings.panels.bound,

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
        if (typeof host?.subscribeDecision !== "function") {
          outcome = { id: TUI_SEAMS.pluginHost, state: "refused", detail: `${TUI_SEAMS.pluginHost}.subscribeDecision is missing` }
          return
        }
        supported = true
        // THE IDENTITY IS THE CALLING ACTIVATION (the bound injected scope), never the consumer's
        // ctx: the host's `assertCallerContext(caller, …)` compares the identity against the caller
        // it resolved for THIS activation and refuses anything else, which is why every mediated
        // decision subscription threw before either ledger record site (MEASURED 2026-10-11, lane
        // `evidence/tui/dsh-tui-015/decision-fix/`: the ledger carried zero decision records while
        // STATUS records did carry the plugin id). Same rule as `setStatus` above: the `identity`
        // field of {@link TuiDecisionOptions} is kept for source compatibility only and is
        // deliberately NOT forwarded.
        // The grant facade is the honest authorization state and is read FIRST, exactly as the
        // caller-facing contract states it; undefined means the host cannot be asked, in which
        // case nothing may be reported as confirmed.
        try {
          /** The caller-safe grant facade, when the host exposes one. */
          const facade = host.grants
          if (facade !== undefined && typeof facade.allows === "function") granted = facade.allows(scope, event, options.scope ?? event) === true
        } catch {
          granted = undefined
        }
        try {
          /** The host's handle; a refusal returns a no-op disposer, never called as a probe. */
          const disposer = host.subscribeDecision(scope, event, listener, {
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
      return { seams, bound, total: TUI_SEAM_KEYS.length, hostInput: { ...hostState }, panelEnable: panelKeeper.outcome() }
    },

    /** How the sidebar enable-list keeper settled; see {@link PanelEnableOutcome}. */
    panelEnableOutcome(): PanelEnableOutcome {
      return panelKeeper.outcome()
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
        // A phantom id's absence is a HOST fact, never a gap in this profile's composition.
        if (PHANTOM_SEAM_KEYS.includes(key)) return { id, state: "absent" as const, detail: "phantom seam: no measured dsh-tui build declares this service" }
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
  // THE FALLBACK IS A REAL COMPOSITION, and it opts the enable keeper in.
  //
  // MEASURED (2026-10-06, evidence `evidence/dag/dag-edges-scroll/panel-visibility/20261006T145907Z/arm-c-fixed/`):
  // the loader applies sibling rows without a guaranteed order, so the consumer row can reach this
  // function BEFORE the adapter row's `apply()` has provided the service. It then keeps its OWN
  // adapter — and every registration lands on THAT instance, which is why the mounted adapter's id
  // record stayed 0 bytes while the host's `PanelStore` carried the three registered ids (three at the
  // time of that measurement, before this wave's clause C3 merge left two). Opting in
  // HERE as well as in `apply()` means the keeper runs on whichever instance actually registers,
  // instead of silently depending on a race. Only `createTuiAdapter` called DIRECTLY (a unit test, an
  // embedder) stays inert.
  return createTuiAdapter(ctx, { keepPanelEnable: true })
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
  // It is ALSO the one construction that arms the enable-list keeper — the second, and last, reach
  // (see {@link HOST_PREFS_MODULE} and §6's contact count).
  const adapter = createTuiAdapter(ctx, { probeHostContact: true, keepPanelEnable: true })
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
