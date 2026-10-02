// THE terminal-silence sink (requirement R5, lane F).
//
// The user's requirement, verbatim: "MPD 的各种 Terminal 的回报的东西（类似于 Codegraph MCP）会把
// TUI 窗口搞得一团糟，这些东西落到 log 里别直接 print 给用户." — MPD's terminal output must land in a
// LOG FILE and never on the user's terminal while a TUI session is live.
//
// Why this file exists at all, MEASURED 2026-10-02:
//   * the harness builds every stdio MCP row as
//     `new StdioClientTransport({ command, args, env, cwd })` (dsh-mcp-client `createTransport`), with
//     NO `stderr` option;
//   * the MCP SDK's `StdioClientTransport.start()` then spawns the child with
//     `stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"]`, and its `stdio.d.mts` states
//     it: "The default is `"inherit"`, meaning messages to stderr will be printed to the parent
//     process's stderr."
//   * so the MCP child's fd 2 IS the dsh process's fd 2 — in a TUI session, the Ink alternate screen.
//
// The child therefore CANNOT rely on the parent to route its diagnostics anywhere. It takes its own
// stderr away from the terminal: `installTerminalSilence()` replaces the JS-level writers
// (`process.stderr.write` and the five `console` output methods) with writers into
// `<root>/.mpd/logs/<name>.log` BEFORE the adopted server module is imported, so even that module's
// load-time warnings are captured.
//
// WHAT THIS FILE IS ALLOWED TO TOUCH, and what it must never do:
//   * `process.stderr` and `console` ONLY. `process.stdout` is NEVER touched: it carries the MCP
//     protocol (fd 1 is a pipe owned by the harness), and a write there would corrupt the session.
//   * it NEVER throws and NEVER falls back to the terminal. An unwritable root means the lines are
//     dropped into a bounded in-memory ring, which is the honest trade: silence is the requirement, and
//     a diagnostic nobody can read is still better than one that wrecks the user's screen.
//   * the ring is NOT drained anywhere on purpose — draining it would mean writing to a terminal, which
//     is the one thing that must not happen. `ring()` exists so a test can prove what was kept.
//
// TWO LAYERS, because the writers alone are not enough:
//   * the WRITER layer replaces the JS objects (`process.stderr.write`, `console.*`). It catches
//     everything this process writes through JS, and it is what an in-process plugin row can reuse.
//   * the DESCRIPTOR layer rebinds file descriptor 2 itself onto the log file (POSIX; see
//     {@link StderrRebind}). It catches what the writer layer cannot: a GRANDCHILD spawned by adopted
//     code with `stdio: [..., "inherit"]` writes to the inherited descriptor directly. MEASURED
//     2026-10-02 on the adopted codegraph bridge, whose grandchild printed
//     `[CodeGraph MCP] File watcher active …` onto the TUI.
// A platform that refuses the rebind keeps the writer layer and reports the outcome honestly; nothing
// here ever falls back to the terminal.
//
// `openLogSink(...).fd()` is the documented hook for the OTHER direction — a child whose diagnostics are
// wanted is given this fd as its stdout/stderr, so the bytes land in the same log.
//
// `packages/mpd-mcp-shared/log-sink.ts` is the ONE file in the tree that owns these writers, and
// `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` pins that: every other hit in the
// runtime band is either EXEMPT (declared, with a reason), counted in the frozen sweep inventory, or a
// failure.
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { format } from "node:util"

/** One env bag: a launcher's live `process.env`, or a fixture standing in for it. */
export type SinkEnv = Record<string, string | undefined>

/** The env keys that name a log root, in precedence order (the documented chain below). */
export const LOG_ROOT_ENV_KEYS: readonly string[] = ["MPD_MCP_LOG_DIR", "DSH_WORKSPACE_ROOT"]

/** The sub-path appended to an accepted root: `<root>/.mpd/logs/<name>.log`. */
const LOG_SUBDIR = join(".mpd", "logs")

/** The default rotation threshold: one megabyte per `<name>.log`, then one `.1` generation. */
const DEFAULT_MAX_BYTES = 1024 * 1024

/** The default per-line cap, so one stack trace cannot fill the file on its own. */
const DEFAULT_MAX_LINE_BYTES = 8192

/** The default ring capacity, used only when no candidate root was writable. */
const DEFAULT_RING_LINES = 64

/** The marker appended to a line that exceeded the per-line cap, naming the dropped byte count. */
function truncationMarker(droppedBytes: number): string {
  return ` … [mpd log sink: ${droppedBytes} more byte(s) truncated]`
}

/**
 * One installed sink: where the lines went, what has been written, and the ring that holds them when
 * nothing was writable.
 *
 * Every method is total: none of them throws, and none of them writes to a terminal.
 */
export interface LogSink {
  /** The sink's name, which is also the log file's base name (`<name>.log`). */
  readonly name: string
  /** Absolute path of the log file, or `null` when no candidate root was writable (ring mode). */
  readonly file: string | null
  /** The accepted root, or `null` in ring mode. */
  readonly root: string | null
  /**
   * Append one diagnostic line. A missing trailing newline is added; the per-line cap and the
   * rotation both apply. Never throws: a failed write degrades to the ring.
   *
   * @param line the line to record, with or without its trailing newline.
   */
  write(line: string): void
  /**
   * The append file descriptor, for handing a CHILD process its diagnostics
   * (`spawn(cmd, args, { stdio: ["ignore", fd, fd] })`), or `null` in ring mode.
   *
   * @returns the open append fd, or `null`.
   */
  fd(): number | null
  /** How many records were accepted (file or ring). */
  written(): number
  /** How many records were dropped because the ring was full (always `0` while a file is open). */
  dropped(): number
  /** How many times the log was rotated to `.1`. */
  rotations(): number
  /** The ring's contents, oldest first — an evidence hook, never drained to a terminal. */
  ring(): readonly string[]
  /**
   * What the descriptor rebind did (see {@link StderrRebind}): `"rebound"` means even a grandchild's
   * raw `stderr.write` lands in this log file, because fd 2 IS the file now.
   *
   * @returns the outcome recorded when the capture was installed.
   */
  stderrRebind(): StderrRebind
  /**
   * Restore the WRITERS this sink replaced; a no-op for a sink that never captured them.
   *
   * DECLARED LIMIT: a descriptor rebind is NOT undone — the original fd 2 was closed and a closed
   * descriptor cannot be resurrected from inside the process. A test therefore passes
   * `rebindStderr: false`, and a launcher never calls this at all.
   */
  restore(): void
}

/** The knobs of a sink; every one has a documented default so a caller passes only what it pins. */
export interface TerminalSilenceOptions {
  /** Root candidates, highest precedence first; defaults to {@link resolveLogRoots}. */
  roots?: readonly string[]
  /** The env bag the two env roots are read from; defaults to `process.env`. */
  env?: SinkEnv
  /** Rotation threshold in bytes; defaults to 1 MiB. */
  maxBytes?: number
  /** Per-line byte cap; defaults to 8 KiB. */
  maxLineBytes?: number
  /** Ring capacity used when no root is writable; defaults to 64 records. */
  ringLines?: number
  /** Whether every record carries an ISO-8601 prefix; defaults to `true`. */
  timestamps?: boolean
  /**
   * Whether the POSIX descriptor rebind is attempted; defaults to `true` and is ignored on win32.
   *
   * A caller turns it OFF only when it must keep the process's own fd 2 (a unit test sharing the
   * runner's stderr, where the rebind would outlive the sink and could not be undone).
   */
  rebindStderr?: boolean
}

/**
 * The default root chain, in the documented precedence order:
 * `$MPD_MCP_LOG_DIR` -> `$DSH_WORKSPACE_ROOT` -> the process cwd -> `os.tmpdir()`.
 *
 * Empty entries are dropped, duplicates (after `resolve`) are collapsed, and a cwd that cannot even be
 * READ (`process.cwd()` throws on a deleted directory) contributes nothing. Writability is NOT decided
 * here: that is the acceptance step in {@link openLogSink}, so one unwritable candidate cannot hide the
 * next one.
 *
 * @param env the env bag to read; defaults to `process.env`.
 * @param cwd the working directory candidate; defaults to `process.cwd()`.
 * @returns the candidate roots, highest precedence first.
 */
export function resolveLogRoots(env: SinkEnv = process.env, cwd?: string): string[] {
  /** The cwd candidate: the caller's, or this process's, or none when it cannot be read. */
  let working: string | undefined = cwd
  if (working === undefined) {
    try {
      working = process.cwd()
    } catch {
      working = undefined
    }
  }
  /** The raw candidates, in precedence order; `undefined` entries are filtered below. */
  const raw: Array<string | undefined> = [env.MPD_MCP_LOG_DIR, env.DSH_WORKSPACE_ROOT, working, tmpdir()]
  /** The candidates kept so far, deduplicated by their resolved path. */
  const roots: string[] = []
  /** The resolved spellings already offered, so one directory is probed once. */
  const seen = new Set<string>()
  for (const candidate of raw) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) continue
    /** The absolute spelling of this candidate, or the candidate itself when `resolve` throws. */
    let absolute: string
    try {
      absolute = resolve(candidate)
    } catch {
      continue
    }
    if (seen.has(absolute)) continue
    seen.add(absolute)
    roots.push(absolute)
  }
  return roots
}

/** One accepted root: the open append fd and the file it points at. */
interface OpenLog {
  /** The append file descriptor, kept open for the process's lifetime. */
  fd: number
  /** The absolute log file path the fd points at. */
  file: string
}

/**
 * Try one root: create `<root>/.mpd/logs/` and open `<root>/.mpd/logs/<name>.log` for appending.
 *
 * The open IS the writability check — a `mkdirSync` that succeeds on a read-only filesystem would still
 * fail the `openSync` below, and probing with a separate temp file would leave litter behind.
 *
 * @param root the candidate root.
 * @param name the sink name, which is the file's base name.
 * @returns the open log, or `null` when this root is unusable.
 */
function tryOpenRoot(root: string, name: string): OpenLog | null {
  try {
    /** The `<root>/.mpd/logs` directory, created lazily on the first write attempt. */
    const dir = join(root, LOG_SUBDIR)
    mkdirSync(dir, { recursive: true })
    /** The absolute log file path. */
    const file = join(dir, `${name}.log`)
    return { fd: openSync(file, "a"), file }
  } catch {
    return null
  }
}

/**
 * What the POSIX descriptor rebind actually did. It is reported rather than assumed, because the
 * operation is irreversible and a claim that it worked would otherwise be unfalsifiable.
 */
export type StderrRebind =
  /** fd 2 now points at the log file: even a GRANDCHILD's raw `stderr.write` lands in the log. */
  | "rebound"
  /** Not attempted: this platform has no POSIX descriptor table (win32). */
  | "unsupported"
  /**
   * Turned OFF by the caller, so a human can still watch stderr by hand: either
   * `MPD_MCP_STDERR_REBIND=0` in the sink's env bag or `rebindStderr: false` — the guard is
   * `options.rebindStderr ?? env.MPD_MCP_STDERR_REBIND !== "0"`, and either opt-out reports this
   * value. ONLY the descriptor layer is skipped: the writer-based capture stays installed.
   */
  | "disabled"
  /** `openSync` did not hand back fd 2, so the rebind was rolled back instead of guessed. */
  | "not-lowest"
  /** Closing or opening failed; fd 2 may now be closed, which is still silent, never a terminal. */
  | "failed"
  /** Never attempted: there is no log file to rebind onto (ring mode), or no capture was installed. */
  | "skipped"

/**
 * Rebind file descriptor 2 onto the log file.
 *
 * WHY THIS EXISTS ON TOP OF THE WRITER REPLACEMENT: replacing `process.stderr.write` only silences
 * writes that go through THIS process's JS. A child spawned by adopted code with
 * `stdio: [..., "inherit"]` writes to the inherited fd 2 directly and bypasses the replacement
 * entirely — MEASURED 2026-10-02 on `packages/mpd-mcp-codegraph/dist/serve.js`
 * (`runBridgedCodegraphProcess` hardcodes that stdio) whose grandchild prints
 * `[CodeGraph MCP] File watcher active …` onto the TUI. Repointing the DESCRIPTOR fixes the class
 * without a second process and without an orphan risk: any later `inherit` hands out the log file.
 *
 * The whole operation is `closeSync(2)` then `openSync(file, "a")`: POSIX hands back the LOWEST free
 * descriptor, which is 2 immediately after that close, so the result is asserted instead of hoped for.
 * A failure is reported and never retried into a different file; fd 2 left closed is still SILENT,
 * which is the requirement, and never a terminal.
 *
 * @param file the already-open log file's absolute path.
 * @returns the outcome, as {@link StderrRebind}.
 */
function rebindStderr(file: string): StderrRebind {
  if (process.platform === "win32") return "unsupported"
  try {
    closeSync(2)
  } catch {
    return "failed"
  }
  /** The descriptor the reopen handed back: 2 means the rebind took, anything else means it did not. */
  let fd: number
  try {
    fd = openSync(file, "a")
  } catch {
    return "failed"
  }
  if (fd === 2) return "rebound"
  // The invariant did not hold (unreachable on POSIX, where 2 is free the instant it is closed, but
  // asserted anyway): release the unexpected descriptor and report the truth rather than pretend.
  try {
    closeSync(fd)
  } catch {
    // Nothing to release, or already gone; either way the outcome below is the honest one.
  }
  return "not-lowest"
}

/**
 * The candidate root a log file sits under, or `null` when none does.
 *
 * @param roots the candidate roots, in precedence order.
 * @param file the accepted log file's absolute path.
 * @returns the prefix root that owns `file`, or `null`.
 */
function owningRoot(roots: readonly string[], file: string): string | null {
  for (const root of roots) {
    if (file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`)) return root
  }
  return null
}

/**
 * The process-wide capture slot. ONE sink owns `process.stderr` and `console` at a time: a second
 * {@link installTerminalSilence} still opens its own file, but it does not double-wrap the writers
 * (double-wrapping would write every line twice and make `restore` order-dependent).
 */
let captured: LogSink | null = null

/**
 * Open a log sink: resolve the roots, take the first writable one, and hand back a writer.
 *
 * This is the NON-capturing half of the pair: it never touches `process.stderr` or `console`, so a
 * plugin that runs inside the dsh process (where silence would erase the HOST's own output) can still
 * route one diagnostic line into its own workspace log.
 *
 * @param name the sink name; it becomes `<name>.log` and every record's file is picked by it.
 * @param options the knobs; see {@link TerminalSilenceOptions}.
 * @returns the sink. It is always usable: ring mode when no root accepted the open.
 */
export function openLogSink(name: string, options: TerminalSilenceOptions = {}): LogSink {
  /** The rotation threshold in bytes. */
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  /** The per-line byte cap. */
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  /** The ring capacity used whenever the file is unavailable. */
  const ringLines = options.ringLines ?? DEFAULT_RING_LINES
  /** Whether records carry an ISO-8601 prefix. */
  const timestamps = options.timestamps ?? true
  /** The roots to try, in precedence order. */
  const roots = options.roots ?? resolveLogRoots(options.env ?? process.env)
  /** The first root whose open succeeded, or `null` in ring mode. */
  let open: OpenLog | null = null
  for (const root of roots) {
    /** This candidate's result; the first accepted root wins and the loop stops. */
    const attempt = tryOpenRoot(root, name)
    if (attempt !== null) {
      open = attempt
      break
    }
  }
  /** Bytes currently in the open file, maintained so the cap costs no `stat` per line. */
  let size = 0
  if (open !== null) {
    try {
      size = statSync(open.file).size
    } catch {
      size = 0
    }
  }
  /** Records accepted so far. */
  let accepted = 0
  /** Records dropped because the ring was full. */
  let droppedCount = 0
  /** Rotations performed. */
  let rotations = 0
  /** The bounded ring used when (or while) no file is writable; oldest first. */
  const ring: string[] = []
  /** The restored state of the replaced `process.stderr.write`, set only by the capturing install. */
  let undoCapture: (() => void) | null = null
  /** The descriptor rebind's outcome; `"skipped"` until the capturing install records one. */
  let rebindOutcome: StderrRebind = "skipped"
  /** The rebind thunk the rotation re-runs, installed with the capture; `null` means no rebind. */
  let rebind: (() => StderrRebind) | null = null

  /** Keep one record in the ring, evicting the oldest and counting the drop when it is full. */
  const remember = (record: string): void => {
    if (ring.length >= ringLines) {
      ring.shift()
      droppedCount += 1
    }
    ring.push(record)
  }

  /** Rotate the live file to `.1`: one generation, overwritten, and never a throw. */
  const rotate = (): void => {
    if (open === null) return
    try {
      closeSync(open.fd)
      // `rm` first: `renameSync` would otherwise fail on a platform that refuses to replace.
      rmSync(`${open.file}.1`, { force: true })
      renameSync(open.file, `${open.file}.1`)
      open = { fd: openSync(open.file, "a"), file: open.file }
      size = 0
      rotations += 1
      // The rotation renamed the old generation and reopened the live one, so a REBOUND fd 2 now points
      // at `<name>.log.1`; the rebind puts it back on the live file (a no-op when none happened).
      ;(sink as MutableSink).rebindNow()
    } catch {
      // A failed rotation is not fatal: reopen the same path so records keep flowing, and let the cap
      // become a soft bound rather than silencing the process.
      try {
        open = { fd: openSync(open.file, "a"), file: open.file }
      } catch {
        // The root became unwritable mid-run: the ring takes over, which is the documented degrade.
        open = null
      }
    }
  }

  /** Append one already-rendered record, rotating first when it would cross the cap. */
  const append = (record: string): void => {
    if (open === null) {
      remember(record)
      return
    }
    /** The record's size in bytes, which is what the cap counts. */
    const bytes = Buffer.byteLength(record, "utf8")
    if (size > 0 && size + bytes > maxBytes) rotate()
    if (open === null) {
      remember(record)
      return
    }
    try {
      writeSync(open.fd, record)
      size += bytes
    } catch {
      remember(record)
    }
  }

  /** The root that accepted the open, or `null` in ring mode. */
  const acceptedRoot = open === null ? null : owningRoot(roots, open.file)
  /** The sink handed to the caller; every member is total. */
  const sink: LogSink = {
    name,
    file: open?.file ?? null,
    root: acceptedRoot,
    /** Render one line into a record and hand it to the file, or to the ring when the file is gone. */
    write(line: string): void {
      try {
        /** The line without its trailing newline, so the record owns exactly one. */
        const body = line.endsWith("\n") ? line.slice(0, -1) : line
        /** The body after the per-line cap, with the marker naming what was dropped. */
        const capped = Buffer.byteLength(body, "utf8") > maxLineBytes ? capLine(body, maxLineBytes) : body
        /** The final record: an optional ISO-8601 prefix, the body, and exactly one newline. */
        const record = `${timestamps ? `[${new Date().toISOString()}] ` : ""}${capped}\n`
        accepted += 1
        append(record)
      } catch {
        // `write` is total by contract: a throwing diagnostic must never take the MCP server down.
      }
    },
    /** The live append fd, so a child process can be handed the same log as its stdout/stderr. */
    fd(): number | null {
      return open?.fd ?? null
    },
    /** Records accepted since this sink was opened; the evidence hook for a captured launch. */
    written(): number {
      return accepted
    },
    /** Records evicted by the bounded ring (always `0` while the file is open). */
    dropped(): number {
      return droppedCount
    },
    /** Full rotations to `.<name>.log.1`; more than one means one long-lived session. */
    rotations(): number {
      return rotations
    },
    /** The ring's records, oldest first; the ring is never drained to a terminal. */
    ring(): readonly string[] {
      return [...ring]
    },
    /** The descriptor rebind's recorded outcome: set by the capturing install, `"skipped"` otherwise. */
    stderrRebind(): StderrRebind {
      return rebindOutcome
    },
    /** Put the replaced writers back; a launcher never calls this, a test does. */
    restore(): void {
      if (undoCapture === null) return
      undoCapture()
      undoCapture = null
      if (captured === sink) captured = null
    },
  }
  // The capture is installed by `installTerminalSilence`; both hooks are recorded here so `restore`
  // owns the whole undo in one place and a ROTATION can re-run the descriptor rebind on the new file.
  ;(sink as MutableSink).attachCapture = (undo: () => void, onRebind: () => StderrRebind): void => {
    undoCapture = undo
    rebind = onRebind
  }
  /** Run the rebind thunk and record its outcome; a no-op for a non-capturing sink. */
  ;(sink as MutableSink).rebindNow = (): void => {
    if (rebind === null) return
    rebindOutcome = rebind()
  }
  /** Record an outcome decided WITHOUT running the rebind (the documented opt-out). */
  ;(sink as MutableSink).setRebindOutcome = (outcome: StderrRebind): void => {
    rebindOutcome = outcome
  }
  return sink
}

/** The internal widening that lets `installTerminalSilence` attach its hooks to a public sink. */
interface MutableSink extends LogSink {
  /**
   * Record the undo action that restores the replaced writers, plus the thunk that re-points fd 2.
   *
   * @param undo restores the replaced writers.
   * @param onRebind re-points fd 2 at the live file and reports the outcome.
   */
  attachCapture(undo: () => void, onRebind: () => StderrRebind): void
  /** Run the recorded rebind thunk now, recording its outcome; a no-op before `attachCapture`. */
  rebindNow(): void
  /**
   * Record an outcome the caller decided without running the rebind (the `MPD_MCP_STDERR_REBIND=0`
   * opt-out, and nothing else).
   *
   * @param outcome the outcome to report.
   */
  setRebindOutcome(outcome: StderrRebind): void
}

/**
 * Cap one line at `maxLineBytes` bytes of UTF-8, keeping the head and naming the dropped tail.
 *
 * @param body the line's text, without its newline.
 * @param maxLineBytes the byte cap.
 * @returns the capped text.
 */
function capLine(body: string, maxLineBytes: number): string {
  /** The text sliced at the cap; `Buffer` slicing is byte-accurate for multi-byte text. */
  const kept = Buffer.from(body, "utf8").subarray(0, maxLineBytes).toString("utf8")
  return kept + truncationMarker(Buffer.byteLength(body, "utf8") - Buffer.byteLength(kept, "utf8"))
}

/** The five `console` methods the capture owns; the rest of `console` is deliberately NOT replaced. */
const CAPTURED_CONSOLE_METHODS: readonly string[] = ["error", "warn", "log", "info", "debug"]

/**
 * Take this process's terminal writers away from the terminal and point them at a log file.
 *
 * Call this at the VERY TOP of an MCP launcher, before the adopted server module is imported: a
 * module-init warning is exactly the class of output that wrecks a TUI, and it cannot be captured after
 * the module has already run. The install is idempotent per process — a second call opens its own log
 * but leaves the first capture in place.
 *
 * Behaviour, in the order the requirement states it: the roots are resolved and probed for
 * writability; `<root>/.mpd/logs/<name>.log` is created lazily; records are appended with a 1 MiB cap
 * and one `.1` rotation; `process.stderr.write` and `console.{error,warn,log,info,debug}` are replaced;
 * and nothing ever throws or reaches the terminal — an unwritable root means the bounded ring.
 *
 * @param name the sink name, which is also the log file's base name.
 * @param options the knobs; see {@link TerminalSilenceOptions}.
 * @returns the installed sink.
 */
export function installTerminalSilence(name: string, options: TerminalSilenceOptions = {}): LogSink {
  /** The sink that will own the writers when this call is the first one. */
  const sink = openLogSink(name, options)
  if (captured !== null) return sink
  captured = sink
  /** The stderr object, widened because Node types `write` as a set of overloads. */
  const stderr = process.stderr as unknown as { write: (...args: unknown[]) => boolean }
  /** Whether `write` was already an own property, i.e. whether `restore` must reassign or delete. */
  const hadOwnWrite = Object.prototype.hasOwnProperty.call(stderr, "write")
  /** The own `write` that was replaced, when there was one. */
  const previousOwnWrite = hadOwnWrite ? stderr.write : undefined
  /** The console object, widened because indexing it by a `string` method name is not typed. */
  const consoleTarget = console as unknown as Record<string, unknown>
  /** The console methods this capture replaces, kept so `restore` puts the same ones back. */
  const previousConsole = new Map<string, unknown>()
  /** Whether the capture has already been undone, so a second `restore` is a no-op. */
  let restored = false

  /** Write one string chunk into the sink, reporting success to the caller. */
  const stderrWrite = (chunk: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean => {
    try {
      /** The chunk as text: a string is used as-is, bytes are decoded, anything else is stringified. */
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("utf8")
            : String(chunk)
      sink.write(text.endsWith("\n") ? text.slice(0, -1) : text)
    } catch {
      // Never propagate: a diagnostic must not break the caller.
    }
    /** The completion callback, whichever argument position carried it. */
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback
    if (typeof done === "function") {
      try {
        ;(done as (error?: Error | null) => void)(null)
      } catch {
        // A throwing callback is the caller's business; the sink stays silent.
      }
    }
    // `true` means "accepted": the record is already on disk (or in the ring), never buffered here.
    return true
  }

  stderr.write = stderrWrite

  for (const method of CAPTURED_CONSOLE_METHODS) {
    previousConsole.set(method, consoleTarget[method])
    // The cast above is what makes this assignment reachable: `console`'s methods have five different
    // signatures, and only an index-by-name write can replace them uniformly.
    consoleTarget[method] = (...args: unknown[]): void => {
      sink.write(format(...args))
    }
  }

  ;(sink as MutableSink).attachCapture((): void => {
    if (restored) return
    restored = true
    if (hadOwnWrite && previousOwnWrite !== undefined) stderr.write = previousOwnWrite
    else delete (stderr as { write?: unknown }).write
    for (const [method, previous] of previousConsole) consoleTarget[method] = previous
  }, (): StderrRebind => (sink.file === null ? "skipped" : rebindStderr(sink.file)))

  // The descriptor rebind runs AFTER the writers are replaced, so both layers agree even when the
  // rebind turns out to be impossible on this host. `openLogSink`'s rotation re-runs the same thunk,
  // which is what keeps a rebound fd 2 on the LIVE file after a `.1` rotation.
  //
  // The OPT-OUT exists for ONE case: a human debugging an MCP server by hand wants its stderr on their
  // terminal. `MPD_MCP_STDERR_REBIND=0` (read from the caller's env bag) skips ONLY this layer — the
  // writer-based sink stays installed — and is reported as `"disabled"` rather than silently ignored.
  /** The env bag the opt-out is read from: the caller's, or this process's. */
  const envBag = options.env ?? process.env
  if (options.rebindStderr ?? envBag.MPD_MCP_STDERR_REBIND !== "0") {
    ;(sink as MutableSink).rebindNow()
  } else {
    ;(sink as MutableSink).setRebindOutcome("disabled")
  }
  return sink
}
